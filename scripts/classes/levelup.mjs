/* global game, foundry, ui, Hooks, Actor, Roll, ChatMessage, CONFIG */
/**
 * Level-up: watching XP cross the threshold, and the wizard that applies a
 * gained level — never automatically.
 *
 * HP follows the user-confirmed RAW: reroll the FULL Hit Dice for the new
 * level (Constitution applying per die, never to the printed flat bonus past
 * 9th) and keep at least one point over the old maximum. The additive house
 * rule (one new die, or the flat delta past 9th) is a world setting, never
 * the default.
 *
 * Awards for the new level come off the class document's ladder: fixed
 * grants materialize as owned ability items (deduped by cookbook ref);
 * choice awards open their ChoiceSpec's options inside the wizard.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { classForActor, findByRef } from "./registry.mjs";
import { applyClass, normalizeHd } from "./apply.mjs";
import { choiceOptions } from "../lib/choice-spec.mjs";

export const HP_MODE_SETTING = "levelUpHpMode";

/** The ref a world item is addressed by (the importer's stamp, else uuid). */
const refOf = (item) => item.flags?.["acks-importer"]?.cookbook?.id ?? `uuid:${item.uuid}`;

/** "9d8+4" → {dice: 9, sides: 8, flat: 4}; null when unparseable. */
export function parseHd(formula) {
  const m = /^(\d+)d(\d+)(?:\+(\d+))?$/.exec(String(formula ?? "").replace(/\s+/g, ""));
  return m ? { dice: parseInt(m[1], 10), sides: parseInt(m[2], 10), flat: m[3] ? parseInt(m[3], 10) : 0 } : null;
}

/** Does the actor already own an ability carrying this ref? */
const ownsRef = (actor, ref) =>
  actor.items.some(
    (i) => refOf(i) === ref || (ref.startsWith("uuid:") && i.uuid === ref.slice(5)),
  );

/** Create one granted ability on the actor from a world item ref. */
async function grantAbility(actor, ref, grants) {
  if (!ref || ownsRef(actor, ref)) return;
  const source = findByRef(ref);
  if (!source) {
    grants.push({ ref, name: ref, missing: true });
    return;
  }
  const data = source.toObject();
  delete data._id;
  await actor.createEmbeddedDocuments("Item", [data]);
  grants.push({ ref, name: source.name });
}

/** Resolve a ChoiceSpec's options against this class doc and the world. */
function optionsForChoice(choice, classItem) {
  const generalRefs = (game.items ?? [])
    .filter((i) => i.type === "ability" && i.system.proficiencytype === "general")
    .map(refOf);
  const refs = choiceOptions(choice, {
    inventory: classItem.system.inventory,
    generalRefs,
    spellRefs: [],
  });
  return refs
    .map((ref) => ({ ref, name: findByRef(ref)?.name ?? ref }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Run the level-up wizard for one character. Rolls HP up front so the dialog
 * SHOWS the roll it will apply; nothing writes until the wizard confirms.
 */
export async function openLevelUp(actor) {
  const classItem = classForActor(actor);
  if (!classItem) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.levelup.noClass`, { name: actor.name }));
    return;
  }
  const sys = classItem.system;
  const level = Math.max(1, Number(actor.system?.details?.level) || 1);
  const next = level + 1;
  if (next > (sys.maximumLevel || 14)) {
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.levelup.atCap`, { name: actor.name, max: sys.maximumLevel }));
    return;
  }
  const nextRow = sys.levelRow(next);
  const hd = parseHd(normalizeHd(nextRow?.hd)) ?? parseHd(`${Math.min(next, 9)}d${(sys.hitDie.match(/d(\d+)/) ?? [])[1] ?? 8}`);
  const conMod = Number(actor.system?.scores?.con?.mod) || 0;
  const oldMax = Number(actor.system?.hp?.max) || 0;
  const mode = game.settings.get(MODULE_ID, HP_MODE_SETTING);

  let hpRoll = null;
  let newMax;
  if (mode === "additive" && hd) {
    const prevHd = parseHd(normalizeHd(sys.levelRow(level)?.hd));
    if (next <= 9) {
      hpRoll = await new Roll(`1d${hd.sides}`).evaluate();
      newMax = oldMax + Math.max(1, hpRoll.total + conMod);
    } else {
      newMax = oldMax + Math.max(1, hd.flat - (prevHd?.flat ?? 0));
    }
  } else if (hd) {
    hpRoll = await new Roll(`${hd.dice}d${hd.sides}`).evaluate();
    newMax = Math.max(hpRoll.total + hd.dice * conMod + hd.flat, oldMax + 1);
  } else {
    newMax = oldMax + 1;
  }

  const awards = (sys.awards ?? []).filter((a) => a.atLevel === next);
  const fixed = awards.filter((a) => a.kind === "fixed" && a.ref);
  const choices = awards.filter((a) => a.kind === "choice");
  const choiceBlocks = choices
    .map((a, index) => {
      const options = optionsForChoice(a.choice, classItem);
      const label = a.choice.label || game.i18n.localize(`${LANG_PREFIX}.levelup.pick`);
      const opts = options
        .map((o) => `<option value="${foundry.utils.escapeHTML(o.ref)}">${foundry.utils.escapeHTML(o.name)}</option>`)
        .join("");
      return `<div class="form-group"><label>${foundry.utils.escapeHTML(label)}</label><select name="choice-${index}">${opts}</select></div>`;
    })
    .join("");
  const fixedList = fixed
    .map((a) => `<li>${foundry.utils.escapeHTML(findByRef(a.ref)?.name ?? a.name ?? a.ref)}</li>`)
    .join("");

  const content = `
    <p>${game.i18n.format(`${LANG_PREFIX}.levelup.prompt`, { name: actor.name, class: classItem.name, level: next })}</p>
    <p><strong>${game.i18n.localize(`${LANG_PREFIX}.levelup.hp`)}:</strong> ${oldMax} → ${newMax}${
      hpRoll ? ` <span class="acks-extras-classes-refname">(${hpRoll.formula}: ${hpRoll.total}${conMod ? `, CON ${conMod > 0 ? "+" : ""}${conMod}/die` : ""})</span>` : ""
    }</p>
    ${fixedList ? `<p><strong>${game.i18n.localize(`${LANG_PREFIX}.levelup.granted`)}:</strong></p><ul>${fixedList}</ul>` : ""}
    ${choiceBlocks}`;

  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.levelup.title`) },
    content,
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.levelup.apply`),
      callback: (_event, button) =>
        choices.map((_, index) => button.form.elements[`choice-${index}`]?.value).filter(Boolean),
    },
    rejectClose: false,
  });
  if (!picked) return;

  const grants = [];
  for (const a of fixed) await grantAbility(actor, a.ref, grants);
  for (const ref of picked) await grantAbility(actor, ref, grants);

  const oldValue = Number(actor.system?.hp?.value) || 0;
  await actor.update({ "system.hp.max": newMax, "system.hp.value": oldValue + Math.max(0, newMax - oldMax) });
  await applyClass(actor, classItem, { level: next, confirm: false });

  const grantNames = grants.map((g) => (g.missing ? `${g.name} (?)` : g.name));
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.levelup.chat`, {
      name: actor.name,
      class: classItem.name,
      level: next,
      hp: `${oldMax} → ${newMax}`,
    })}</p>${grantNames.length ? `<p>${grantNames.map((n) => foundry.utils.escapeHTML(n)).join(", ")}</p>` : ""}`,
  });
}

/** Notify (once per level) when a character's XP reaches its threshold. */
function onActorUpdate(actor, changes, _options, userId) {
  if (userId !== game.userId) return;
  if (!(actor instanceof Actor) || actor.type !== "character") return;
  if (foundry.utils.getProperty(changes, "system.details.xp.value") === undefined) return;
  const classItem = classForActor(actor);
  if (!classItem) return;
  const level = Math.max(1, Number(actor.system?.details?.level) || 1);
  const threshold = classItem.system.nextXp(level);
  if (threshold == null) return;
  const xp = Number(actor.system?.details?.xp?.value) || 0;
  const flag = actor.getFlag(MODULE_ID, FLAG_CLASSES) ?? {};
  if (xp >= threshold && flag.notifiedLevel !== level) {
    ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.levelup.ready`, { name: actor.name, level: level + 1 }));
    actor.update({ [`flags.${MODULE_ID}.${FLAG_CLASSES}.notifiedLevel`]: level });
  }
}

/** Inject the level-up control beside the class picker when XP qualifies. */
function onRenderCharacterSheet(app, element) {
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const doc = app.document;
  if (!(doc instanceof Actor) || doc.type !== "character" || !doc.isOwner) return;
  const pick = root.querySelector(".acks-extras-classes-pick");
  if (!pick || pick.parentElement.querySelector(".acks-extras-classes-levelup")) return;
  const classItem = classForActor(doc);
  if (!classItem) return;
  const level = Math.max(1, Number(doc.system?.details?.level) || 1);
  const threshold = classItem.system.nextXp(level);
  if (threshold == null || (Number(doc.system?.details?.xp?.value) || 0) < threshold) return;
  const btn = document.createElement("a");
  btn.className = "acks-extras-classes-levelup";
  btn.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.levelup.tooltip`);
  btn.innerHTML = '<i class="fa-solid fa-arrow-up-right-dots"></i>';
  btn.addEventListener("click", (event) => {
    event.preventDefault();
    openLevelUp(doc);
  });
  pick.insertAdjacentElement("afterend", btn);
}

/** Register the XP watch + sheet control (called once from classes/module.mjs). */
export function registerLevelUp() {
  Hooks.on("updateActor", onActorUpdate);
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
