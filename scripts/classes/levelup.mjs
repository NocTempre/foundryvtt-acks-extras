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
 *
 * Every write that moves a bound character's experience or level passes
 * `guardLevelWrite` first, whichever surface made it — either sheet's fields,
 * core's experience award, Deal XP, the API. It caps a gain at one level
 * (RR ch. 6, experience from adventuring) and makes a lowered level reopen
 * what the climbs above it closed.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { classForActor, classForActorAsync, findByRef } from "./registry.mjs";
import { applyClass, classUpdateData } from "./apply.mjs";
import { normalizeHd, parseHd, rollHitDice } from "./hitpoints.mjs";
import { awardKeyLevel, awardsAt, grantAbility } from "./grants.mjs";
import { closesRung, grantableRefs, readRungs, rungLabel, rungOptions, rungSelectHtml } from "./picks.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { elementOf } from "../lib/util.mjs";

export const HP_MODE_SETTING = "levelUpHpMode";

export { parseHd };

/** Operation-option key that exempts one write's experience from the cap. */
const UNCAPPED_XP = "uncappedXp";

/**
 * The update options for a write whose experience is not an award and so is
 * not capped — a successor's starting experience, which the wizard then
 * climbs as far as it reaches.
 */
export const uncappedXp = () => ({ [MODULE_ID]: { [UNCAPPED_XP]: true } });

/**
 * The most experience one award may leave a character standing at `level`
 * with: one short of the threshold two levels above it. Null where the class
 * prints no such threshold — the last level or two of the ladder, where no
 * second level is left to skip.
 * @param {{nextXp: (level: number) => number|null}} classSystem the class document's system
 */
export function xpCeiling(classSystem, level) {
  const threshold = classSystem?.nextXp?.(level + 1);
  return Number.isFinite(threshold) ? threshold - 1 : null;
}

/**
 * Where a write's experience lands under `ceiling`. Only a gain is capped:
 * a write that lowers experience is left alone, and experience already past
 * the ceiling is never taken away.
 * @returns {{value: number, lost: number}} the experience to store, and what the cap kept off it
 */
export function capXpGain(before, after, ceiling) {
  if (ceiling == null || !(after > before) || after <= ceiling) return { value: after, lost: 0 };
  const value = Math.max(before, ceiling);
  return { value, lost: after - value };
}

/** The level an actor stands at, 1 for one with none set. */
const levelOf = (actor) => Math.max(1, Number(actor.system?.details?.level) || 1);

/** Characters whose wizard is open on this client — one at a time each. */
const climbing = new Set();

/**
 * Run the level-up wizard for one character. Rolls HP up front so the dialog
 * SHOWS the roll it will apply; nothing writes until the wizard confirms. A
 * second open while one is up does nothing, and a wizard whose character's
 * level moved while it was open writes nothing.
 */
export async function openLevelUp(actor) {
  if (climbing.has(actor.uuid)) return;
  climbing.add(actor.uuid);
  try {
    await runLevelUp(actor);
  } finally {
    climbing.delete(actor.uuid);
  }
}

async function runLevelUp(actor) {
  const classItem = await classForActorAsync(actor);
  if (!classItem) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.levelup.noClass`, { name: actor.name }));
    return;
  }
  const sys = classItem.system;
  const level = levelOf(actor);
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
        options: rungOptions(a.choice, classItem, actor, null, { level: next }),
      }),
    )
    .join("");
  const fixedList = fixed
    .map((a) => `<li>${foundry.utils.escapeHTML(findByRef(a.ref)?.name ?? a.name ?? a.ref)}</li>`)
    .join("");

  // Boxed: the subsystem's hint rule reaches a `.hint` only inside a named
  // box (styles/classes.css), and a bare one in a dialog body falls to the
  // vendored micro-annotation step — present, styled, and too small to read
  // as the sentence it is.
  const content = `
    <div class="acks-extras-classes-levelup-body">
    <p>${game.i18n.format(`${LANG_PREFIX}.levelup.prompt`, { name: actor.name, class: classItem.name, level: next })}</p>
    <p><strong>${game.i18n.localize(`${LANG_PREFIX}.levelup.hp`)}:</strong> ${oldMax} → ${newMax}${
      hpRoll ? ` <span class="acks-extras-classes-refname">(${hpRoll.formula}: ${hpRoll.total}${conMod ? `, CON ${conMod > 0 ? "+" : ""}${conMod}/die` : ""})</span>` : ""
    }</p>
    ${fixedList ? `<p><strong>${game.i18n.localize(`${LANG_PREFIX}.levelup.granted`)}:</strong></p><ul>${fixedList}</ul>` : ""}
    ${choiceBlocks}
    ${choiceBlocks ? `<p class="hint">${game.i18n.localize(`${LANG_PREFIX}.levelup.openHint`)}</p>` : ""}
    </div>`;

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
  // Another seat, or the picker, may have moved the level while the wizard was
  // open; climbing from a level the character no longer holds would write the
  // wrong rung and the wrong hit points.
  if (levelOf(actor) !== level) {
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.levelup.moved`, { name: actor.name, level: levelOf(actor) }));
    return;
  }

  // The level lands first and everything else only once it has: an apply that
  // is refused (a stub class, a dismissed election) leaves no grant and no hit
  // points behind for a level that never arrived. The rungs this wizard closed
  // are recorded with it, so the picker — which asks for the WHOLE ladder up
  // to a level — does not put every question a played character has already
  // answered to them a second time.
  const applied = await applyClass(actor, classItem, {
    level: next,
    confirm: false,
    answered: choices.filter((_, index) => closesRung(picked[index])).map((c) => c.key),
  });
  if (!applied?.applied) return;

  const grants = [];
  for (const a of fixed) await grantAbility(actor, a.ref, grants, { upTo: a.copies });
  for (const ref of grantableRefs(picked)) await grantAbility(actor, ref, grants);

  // The maximum held on each side of the climb is recorded, so lowering the
  // level again (`guardLevelWrite`) can put back the one this climb replaced.
  const oldValue = Number(actor.system?.hp?.value) || 0;
  const hpAt = (actor.getFlag(MODULE_ID, FLAG_CLASSES)?.hpAt ?? []).filter((r) => r.level < level);
  await actor.update({
    "system.hp.max": newMax,
    "system.hp.value": oldValue + Math.max(0, newMax - oldMax),
    [`flags.${MODULE_ID}.${FLAG_CLASSES}.hpAt`]: [...hpAt, { level, max: oldMax }, { level: next, max: newMax }],
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

/**
 * The guard on a write to a bound character's experience or level, run on
 * the writing client before the write leaves it (`preUpdateActor`), folding
 * its corrections into the same write.
 *
 * - **A gain stops at one level.** Experience raised by a write that leaves
 *   the level where it is stops at `xpCeiling` of the level held, and the
 *   writer is told what was kept off. A write that also sets the level (the
 *   picker, chargen, a sheet import) sets the experience that goes with it,
 *   and `uncappedXp()` exempts a write whose experience is not an award.
 * - **A level set by hand carries its class row** (`followLevel`), raised or
 *   lowered. An apply's own write (it records `appliedLevel`) already does.
 * - **A lowered level reopens what the climbs above it closed.** Rung keys
 *   above the new level leave `awardsTaken`, so the next climb asks them again
 *   (an option still held is offered first, and answering with it grants
 *   nothing); the ready notice may fire again; and where a climb recorded the
 *   maximum the character held at the new level, it is put back, current hit
 *   points capped beneath it — unless the write sets the maximum itself.
 *   Abilities the higher rungs granted stay on the sheet.
 * - **A rebuilt maximum ends the record.** A write that sets the level and the
 *   maximum together has rolled a fresh total, and the climbs' record is
 *   replaced by that one figure.
 */
export function guardLevelWrite(actor, changes, options) {
  if (actor?.type !== ACTOR_TYPE.character) return;
  const { getProperty, setProperty } = foundry.utils;
  const writtenLevel = getProperty(changes, "system.details.level");
  const writtenXp = getProperty(changes, "system.details.xp.value");
  if (writtenLevel === undefined && writtenXp === undefined) return;
  const classItem = classForActor(actor);
  if (!classItem) return;
  const held = levelOf(actor);
  // A form submits every field, so a level equal to the held one sets nothing.
  const level = writtenLevel === undefined ? held : Math.max(1, Number(writtenLevel) || 1);
  const flagPath = `flags.${MODULE_ID}.${FLAG_CLASSES}`;
  const flag = actor.getFlag(MODULE_ID, FLAG_CLASSES) ?? {};

  if (writtenXp !== undefined && level === held && !options?.[MODULE_ID]?.[UNCAPPED_XP]) {
    const before = Number(actor.system?.details?.xp?.value) || 0;
    const { value, lost } = capXpGain(before, Number(writtenXp) || 0, xpCeiling(classItem.system, held));
    if (lost) {
      setProperty(changes, "system.details.xp.value", value);
      ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.levelup.capped`, { name: actor.name, xp: value, lost }));
    }
  }

  if (level === held) return;
  if (getProperty(changes, `${flagPath}.appliedLevel`) === undefined) followLevel(actor, classItem, changes, level);
  // Likewise a maximum equal to the one held was submitted, not rebuilt.
  const writtenMax = getProperty(changes, "system.hp.max");
  const setsMax = writtenMax !== undefined && Number(writtenMax) !== Number(actor.system?.hp?.max);
  if (setsMax) setProperty(changes, `${flagPath}.hpAt`, [{ level, max: Number(writtenMax) || 0 }]);
  if (level > held) return;

  const taken = getProperty(changes, `${flagPath}.awardsTaken`) ?? flag.awardsTaken ?? [];
  const kept = taken.filter((key) => (awardKeyLevel(key) ?? 0) <= level);
  if (kept.length !== taken.length) setProperty(changes, `${flagPath}.awardsTaken`, kept);
  if (Number(flag.notifiedLevel) >= level) setProperty(changes, `${flagPath}.notifiedLevel`, null);
  if (setsMax) return;
  const record = flag.hpAt ?? [];
  const restored = Number(record.find((r) => r.level === level)?.max);
  if (Number.isFinite(restored) && restored > 0) {
    const value = Number(getProperty(changes, "system.hp.value") ?? actor.system?.hp?.value) || 0;
    setProperty(changes, "system.hp.max", restored);
    setProperty(changes, "system.hp.value", Math.min(value, restored));
  }
  setProperty(changes, `${flagPath}.hpAt`, record.filter((r) => r.level <= level));
}

/** Does a written value equal the held one, a blank matching an unset field? */
const sameValue = (written, held) => String(written ?? "") === String(held ?? "");

/**
 * Fold the bound class's row for `level` into a write that sets the level by
 * hand: saves, attack throw, title, XP to next, hit dice, cleaves, the damage
 * bonus under the character's standing election, and the slot grid. The
 * typed level and the class name stay as written. A path the write sets to a
 * value other than the held one keeps it, while a value a form merely
 * submitted gives way. What is folded in joins the applied ledger, so the
 * next apply does not mark it as a hand edit. Hit points and abilities are
 * not touched: the wizard and the picker roll and grant them.
 */
function followLevel(actor, classItem, changes, level) {
  const { getProperty, setProperty } = foundry.utils;
  const flagPath = `flags.${MODULE_ID}.${FLAG_CLASSES}`;
  const classKey = classItem.system.key || classItem.name.toLowerCase();
  const standing = actor.getFlag(MODULE_ID, FLAG_CLASSES)?.damageBonus;
  const election = standing?.class === classKey ? standing.applies : null;
  const { update, level: rowLevel } = classUpdateData(actor, classItem, level, { election });
  for (const [path, value] of Object.entries(update)) {
    if (path === "system.details.level" || path === "system.details.class") continue;
    const written = getProperty(changes, path);
    if (written !== undefined && !sameValue(written, getProperty(actor, path))) continue;
    setProperty(changes, path, value);
    setProperty(changes, `${flagPath}.applied.${path}`, value);
  }
  setProperty(changes, `${flagPath}.appliedLevel`, rowLevel);
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
  const root = elementOf(element);
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

/** Register the write guard, the XP watch and the sheet control (called once from classes/module.mjs). */
export function registerLevelUp() {
  Hooks.on("preUpdateActor", guardLevelWrite);
  Hooks.on("updateActor", onActorUpdate);
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
}
