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
import { applyClass } from "./apply.mjs";
import { normalizeHd, parseHd, rollHitDice } from "./hitpoints.mjs";
import { awardsAt, grantAbility } from "./grants.mjs";
import { closesRung, grantableRefs, readRungs, rungLabel, rungOptions, rungSelectHtml } from "./picks.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

export const HP_MODE_SETTING = "levelUpHpMode";

export { parseHd };

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
    // Constitution applies to each die and cannot take any of them below one
    // (hitpoints.mjs) — the same arithmetic the picker's rebuild uses, so a
    // character built at 5th and one levelled to 5th are rolled alike.
    const rolled = await rollHitDice(hd, conMod);
    hpRoll = rolled.roll;
    newMax = Math.max(rolled.total, oldMax + 1);
  } else {
    newMax = oldMax + 1;
  }

  // The rung this level climbs, carrying the keys the picker remembers rungs
  // by — so a question answered here is one the picker does not ask again.
  const takenAlready = actor.getFlag(MODULE_ID, FLAG_CLASSES)?.awardsTaken ?? [];
  const { fixed, choices } = awardsAt(actor, classItem, next, takenAlready);
  const choiceBlocks = choices
    .map((a, index) =>
      rungSelectHtml({
        name: `choice-${index}`,
        label: rungLabel(a, "levelup.pick"),
        options: rungOptions(a.choice, classItem, actor),
      }),
    )
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

  // The wizard's body is a list — one line per fixed award, one picker per
  // choice — so it grows with the class it is climbing. `acks-extras-scroll`
  // is the module's scroll contract (styles/lib.css): without it core's
  // `.window-content { overflow: hidden }` amputates the content past the
  // window, footer buttons first, and the wizard cannot be answered at all.
  const picked = await foundry.applications.api.DialogV2.prompt({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: game.i18n.localize(`${LANG_PREFIX}.levelup.title`), resizable: true },
    content,
    ok: {
      // Position-preserving, empties included — the position is what says which
      // rung an answer belongs to, and a rung left open has to keep its place.
      label: game.i18n.localize(`${LANG_PREFIX}.levelup.apply`),
      callback: (_event, button) => readRungs(button.form, "choice-", choices.length),
    },
    rejectClose: false,
  });
  if (!picked) return;

  const grants = [];
  for (const a of fixed) await grantAbility(actor, a.ref, grants);
  for (const ref of grantableRefs(picked)) await grantAbility(actor, ref, grants);

  const oldValue = Number(actor.system?.hp?.value) || 0;
  await actor.update({ "system.hp.max": newMax, "system.hp.value": oldValue + Math.max(0, newMax - oldMax) });
  // The rungs this wizard closed are recorded with the level it wrote, so the
  // picker — which asks for the WHOLE ladder up to a level — does not put every
  // question a played character has already answered to them a second time.
  await applyClass(actor, classItem, {
    level: next,
    confirm: false,
    answered: choices.filter((_, index) => closesRung(picked[index])).map((c) => c.key),
  });

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
  if (!(actor instanceof Actor) || actor.type !== ACTOR_TYPE.character) return;
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
  if (!(doc instanceof Actor) || doc.type !== ACTOR_TYPE.character || !doc.isOwner) return;
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
