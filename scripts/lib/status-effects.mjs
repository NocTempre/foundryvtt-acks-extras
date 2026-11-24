/* global CONFIG, Hooks, game, ui */
/**
 * Conditions on the table: the status effects a token can carry, and the
 * seams that put their math on a roll (RR 291-303, 507-515).
 *
 * The palette is the catalogue in `conditions.mjs` and three states the engine
 * needs beside it, in the order and with the additions the Judge arranged
 * (`status-palette.mjs`). The system's own conditions and combat states are
 * registered beside it from `CONFIG.ACKS`, and Foundry's generic list is off
 * it until the system's setting or the Judge puts a status back. This module
 * is the one writer of `CONFIG.statusEffects`. Nothing here stores a modifier
 * on an effect. Each roll reads the roller's statuses — and the target's, for
 * an attack — at the moment it is made, so a condition
 * applies its math whoever created the effect that carries it, and a figure
 * imported later reaches conditions already in place.
 *
 * Rolls the system makes from stored fields (saving throws, adventuring
 * throws, morale, the surprise roll, core's own attack) take the figure as a
 * shift of that field held only across the synchronous read, then put back:
 * the roll sees it and no document ever stores it.
 */
import { MODULE_ID, LANG_PREFIX, STATES_LOST_HOOK, TURN_BEGAN_HOOK, TURN_ENDED_HOOK, FLAG_TURN_LIFE } from "./constants.mjs";
import { readTurnLife, turnLifeStep, turnEdges } from "./turn-life.mjs";
import { endedBy } from "./ends-on.mjs";
import { expectTables } from "./tables.mjs";
import { signed } from "./frame-model.mjs";
import { isPrimaryGM, numOrNull } from "./util.mjs";
import { saveKindOf } from "./actor-compat.mjs";
import { sizeRank } from "./actor-read.mjs";
import { STATUS_RUNNING } from "./perception.mjs";
import { addAttackContributor, POST_ATTACK_HOOK } from "./patches/attack-throw.mjs";
import { sheetSaveShift, tellRollMods } from "./roll-mods.mjs";
import {
  CONDITIONS, CONDITIONS_DOC, CONDITIONS_TABLE, STACKS_FLAG,
  attackMath, rollMath, speedMath, subjectOf, endingAt, endingAtTurn, giverOf, lostTo,
} from "./conditions.mjs";
import { isArranged, normalizePalette, resolvePalette } from "./status-palette.mjs";
import { sideOfPool, sumOfParts, surpriseAgainst } from "./surprise-parts.mjs";

/** The system's own marker for a defeated combatant, kept as Foundry names it. */
export const STATUS_DEAD = "dead";
/** Foundry's invisibility status, which its detection modes read. */
export const STATUS_INVISIBLE = "invisible";

/** The i18n key naming one condition. */
export const conditionNameKey = (id) => `${LANG_PREFIX}.condition.${id}`;

/**
 * The palette entries that are not Appendix B conditions: each is here because
 * the tracker, the detection modes or the senses model reads its id.
 */
const STATES = Object.freeze([
  { id: STATUS_DEAD, name: "EFFECT.StatusDead", img: "icons/svg/skull.svg" },
  { id: STATUS_INVISIBLE, name: "EFFECT.StatusInvisible", img: "icons/svg/invisible.svg" },
  { id: STATUS_RUNNING, name: `${LANG_PREFIX}.status.running`, img: "icons/svg/wingfoot.svg" },
]);

/**
 * The Foundry status ids the system keeps registered whatever its "Include
 * Foundry core status effects" setting says. Mirrors `KEPT_CORE_STATUS_IDS` in
 * the system's `module/status-effects.mjs`, which is module-private. They stay
 * registered here as there, and the system's setting never turns them on, so
 * neither does the palette.
 */
const SYSTEM_KEPT_STATUS_IDS = Object.freeze(["dead", "invisible", "fly", "burrow", "hover"]);

/** The system's world setting that keeps Foundry's own statuses on its list. */
const SYSTEM_CORE_STATUSES_SETTING = "core-status-effects";

const loc = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.conditionRoll.${key}`, data);
const nameOf = (id) => game.i18n.localize(conditionNameKey(id));

/* -------------------------------------------- */
/*  The palette                                  */
/* -------------------------------------------- */

/** The world setting that holds the Judge's arrangement of the palette. */
export const STATUS_PALETTE_SETTING = "statusPalette";

/** What `CONFIG.statusEffects` held when this module took the palette, by id. */
const foreignAtInit = new Map();
/** What another package registered after that, by id. */
const foreignSince = new Map();
/** The ids this module last wrote to `CONFIG.statusEffects`. */
const written = new Set();
let paletteTaken = false;

/** The stored arrangement; an empty one where the setting cannot be read. */
function storedPalette() {
  try {
    return game.settings.get(MODULE_ID, STATUS_PALETTE_SETTING) ?? {};
  } catch {
    return {};
  }
}

/** True when the system's setting keeps Foundry's own statuses on its list; false where it cannot be read. */
function systemKeepsFoundryStatuses() {
  try {
    return game.settings.get("acks", SYSTEM_CORE_STATUSES_SETTING) === true;
  } catch {
    return false;
  }
}

/**
 * Every status the palette can offer, with where it comes from and whether it
 * is on the palette before the Judge arranges anything.
 *
 * The catalogue, the engine's states and the Judge's own statuses are always
 * registered, because code toggles them by id. The system's combat states and
 * conditions (`CONFIG.ACKS`) are registered too, because its tracker and its
 * macros toggle them by id, and are off the palette until the Judge puts them
 * on, carrying the system's own effect `changes`. The statuses Foundry and
 * earlier packages offered are registered only while they are on the palette,
 * and Foundry's are on it by default exactly when the system's setting keeps
 * them; the few the system keeps whatever that setting says
 * (`SYSTEM_KEPT_STATUS_IDS`) stay registered off the palette. A status another package registered after this module took the
 * palette is on it by default and stays registered off it. An id already
 * offered is not offered a second time, so the catalogue's entry stands where
 * the system names the same condition.
 *
 * @param {object} [setting]  the arrangement whose Judge-made statuses to include
 * @returns {import("./status-palette.mjs").KnownStatus[]}
 */
export function knownStatuses(setting = storedPalette()) {
  // Anything on the list that this module did not write arrived from outside.
  for (const status of [...CONFIG.statusEffects]) {
    if (status?.id && !written.has(status.id)) foreignSince.set(status.id, status);
  }
  const known = [];
  const seen = new Set();
  const offer = (entry) => {
    if (!entry.id || seen.has(entry.id)) return;
    seen.add(entry.id);
    known.push(entry);
  };
  for (const [id, c] of Object.entries(CONDITIONS)) {
    offer({ id, source: "condition", name: conditionNameKey(id), img: c.img, defaultOn: true, keep: true });
  }
  for (const state of STATES) offer({ ...state, source: "state", defaultOn: true, keep: true });
  for (const c of normalizePalette(setting).custom) {
    offer({ id: c.id, source: "custom", name: c.name, img: c.img, defaultOn: true, keep: true, data: c.effect });
  }
  const outside = (source, status, defaultOn, keep) => {
    if (!status?.id) return;
    const name = status.name ?? status.label ?? status.id;
    offer({ id: status.id, source, name, img: status.img ?? status.icon, defaultOn, keep, data: status });
  };
  // Whether a status shows on the HUD is the palette's to say, so the system's own `hud` is not carried.
  const ofSystem = ({ hud: _hud, ...status }) => outside("system", status, false, true);
  for (const status of CONFIG.ACKS?.combatStates ?? []) ofSystem(status);
  for (const status of CONFIG.ACKS?.conditions ?? []) ofSystem(status);
  // The later registration first: a package that registers an id again means it.
  for (const status of foreignSince.values()) outside("foreign", status, true, true);
  const foundryOn = systemKeepsFoundryStatuses();
  for (const status of foreignAtInit.values()) {
    const kept = SYSTEM_KEPT_STATUS_IDS.includes(status?.id);
    outside("foreign", status, foundryOn && !kept, kept);
  }
  return known;
}

/**
 * Every id a new status cannot take: the known ones.
 *
 * @param {object} [setting]  the arrangement whose Judge-made statuses count as known
 * @returns {Set<string>}
 */
export function takenStatusIds(setting = storedPalette()) {
  return new Set(knownStatuses(setting).map((status) => status.id));
}

/**
 * The palette as stored: every known status with whether it is on the
 * palette, at which place, and whether it is registered.
 *
 * @returns {ReturnType<typeof resolvePalette>}
 */
export function readStatusPalette() {
  const stored = storedPalette();
  return resolvePalette(stored, knownStatuses(stored));
}

/**
 * A palette entry as `CONFIG.statusEffects` holds it: kept off the HUD when
 * off the palette, and carrying its place when the palette has an order. With
 * no place the HUD lists by name.
 */
function statusConfig(entry, arranged) {
  const { order: _order, ...data } = entry.data ?? {};
  const config = { ...data, id: entry.id, name: entry.name, img: entry.img };
  if (!entry.on) config.hud = false;
  else if (arranged) config.order = entry.order;
  return config;
}

/**
 * Write the palette to `CONFIG.statusEffects`: every registered status, the
 * ones on the palette carrying their place. Called again whenever the stored
 * arrangement changes.
 *
 * @returns {ReturnType<typeof resolvePalette>} the palette written
 */
export function applyStatusPalette() {
  const stored = storedPalette();
  const arranged = isArranged(stored);
  const palette = resolvePalette(stored, knownStatuses(stored));
  const registered = palette.filter((entry) => entry.registered);
  CONFIG.statusEffects.length = 0;
  CONFIG.statusEffects.push(...registered.map((entry) => statusConfig(entry, arranged)));
  written.clear();
  for (const entry of registered) written.add(entry.id);
  return palette;
}

/** The stored arrangement changed: rewrite the palette and redraw an open token HUD. */
export function onStatusPaletteChange() {
  applyStatusPalette();
  const hud = globalThis.canvas?.tokens?.hud;
  if (hud?.rendered) hud.render();
}

/**
 * Take the token palette: remember what the system, Foundry and earlier
 * packages offered, write the palette in the Judge's arrangement, and declare
 * the table the figures come from. At `init`, after the arrangement's setting
 * is registered and after the system's own `init` has written its list: a
 * token drawn before this runs offers the generic list. The system points
 * Foundry's blindness at the Blinded condition itself.
 */
export function registerStatusEffects() {
  if (!paletteTaken) {
    paletteTaken = true;
    for (const status of [...CONFIG.statusEffects]) if (status?.id) foreignAtInit.set(status.id, status);
    // Emptied here so what was just remembered is not read back as arriving later.
    CONFIG.statusEffects.length = 0;
  }
  applyStatusPalette();
  expectTables(CONDITIONS_DOC, [CONDITIONS_TABLE]);
}

/* -------------------------------------------- */
/*  Stacks of one condition                      */
/* -------------------------------------------- */

/** The actor's effect that carries status `id`, or null. Spread first: an embedded collection is not an array. */
const effectCarrying = (actor, id) => [...(actor?.effects ?? [])].find((e) => e?.statuses?.has?.(id)) ?? null;

/**
 * How many causes the actor's effect for condition `id` stands for: 0 when no
 * effect carries it, and 1 for an effect that records no count (a condition
 * toggled by hand), the same reading `subjectOf` gives it.
 */
export function conditionStacksOf(actor, id) {
  const effect = effectCarrying(actor, id);
  if (!effect) return 0;
  return Math.max(1, Math.floor(numOrNull(effect.flags?.[MODULE_ID]?.[STACKS_FLAG]) ?? 1));
}

/**
 * Put the actor's condition `id` at `n` stacks. At zero or below the status is
 * lifted; otherwise it is switched on when absent and its effect records the
 * count. The effect is found by the status it carries, so it is the one a
 * token's palette toggles.
 *
 * @returns {Promise<number>} the stacks the actor carries afterwards
 */
export async function setConditionStacks(actor, id, n) {
  if (!actor) return 0;
  const want = Math.max(0, Math.floor(Number(n) || 0));
  let effect = effectCarrying(actor, id);
  if (want <= 0) {
    if (effect) await actor.toggleStatusEffect(id, { active: false });
    return 0;
  }
  if (!effect) {
    await actor.toggleStatusEffect(id, { active: true });
    effect = effectCarrying(actor, id);
  }
  if (!effect) return 0;
  if (numOrNull(effect.flags?.[MODULE_ID]?.[STACKS_FLAG]) !== want) await effect.setFlag(MODULE_ID, STACKS_FLAG, want);
  return want;
}

/* -------------------------------------------- */
/*  Reading a roll's parties                     */
/* -------------------------------------------- */

/**
 * How an attack is made: the system's own kind (melee, missile, thrown) as
 * the throw was asked with, else what the weapon's two flags say.
 */
function attackKind(item, type) {
  if (type === "melee" || type === "missile" || type === "thrown") return type;
  const sys = item?.system ?? {};
  return sys.missile && !sys.melee ? "missile" : "melee";
}

/** The conditions' reading of one attack, or null when neither side has any. */
function attackConditions(actor, targetActor, item, type) {
  const attacker = subjectOf(actor);
  const target = subjectOf(targetActor);
  if (!attacker?.statuses?.size && !target?.statuses?.size) return null;
  const kind = attackKind(item, type);
  return {
    kind,
    ...attackMath({ attacker, target, kind, attackerSize: sizeRank(actor), targetSize: sizeRank(targetActor) }),
  };
}

/* -------------------------------------------- */
/*  Telling the table                            */
/* -------------------------------------------- */

/** A condition's name as a term carries it: the target's are marked as the target's. */
const termLabel = (part) => (part.side === "target" ? loc("term.target", { name: nameOf(part.condition) }) : nameOf(part.condition));

const list = (ids) => [...new Set(ids)].map(nameOf).join(", ");
const partList = (parts) => parts.map((p) => `${termLabel(p)} ${signed(p.value)}`).join(", ");

/** The figures an opposing carrier imposes on a roll, each named by its source and its page. */
const importedList = (parts) =>
  parts.map((p) => loc(p.cite ? "term.imposedCited" : "term.imposed", { source: p.source, cite: p.cite, value: signed(p.value) })).join(", ");

/** Say which figures a roll could not place, each with the circumstance it waits on. */
function reportPending(name, pending) {
  if (!pending.length) return;
  const rows = pending.map((p) => `${nameOf(p.condition)} ${signed(p.value)} (${loc(`when.${p.when}`)})`).join(", ");
  ui.notifications?.info(loc("notice.pending", { name, rows }));
}

/** Say what a shifted roll took, where the roll's own card cannot. */
function reportApplied(name, roll, parts) {
  if (!parts.length) return;
  ui.notifications?.info(loc("notice.applied", { name, roll: loc(`roll.${roll}`), rows: partList(parts) }));
}

/* -------------------------------------------- */
/*  The attack throw                             */
/* -------------------------------------------- */

/** Warn of an attack its maker's or its target's conditions rule out. */
function reportAttackBars(actor, targetName, math) {
  if (math.forbidden.length) {
    ui.notifications?.warn(loc("notice.forbidden", { name: actor.name, conditions: list(math.forbidden) }));
  }
  if (math.shielded.length) {
    ui.notifications?.warn(
      loc("notice.shielded", { name: actor.name, target: targetName ?? "", conditions: list(math.shielded) }),
    );
  }
}

/**
 * The conditions' reading of the attack in flight, for one kind of attack.
 * Read once per attack and kind — the dialog's preview asks again on every
 * keystroke — and told to the table the first time: the bars, the rows that
 * wait on a circumstance, and what the system's throw has no place for (a
 * scaled damage roll, a waived throw), which is applied by hand.
 */
function conditionsOf(ctx, attackType) {
  ctx.conditions ??= {};
  if (attackType in ctx.conditions) return ctx.conditions[attackType];
  let math = null;
  try {
    math = attackConditions(ctx.actor, ctx.targetActor, ctx.item, attackType);
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read an attack; it rolls without them`, err);
  }
  ctx.conditions[attackType] = math;
  if (math && !ctx.conditionsTold) {
    ctx.conditionsTold = true;
    reportAttackBars(ctx.actor, ctx.targetName, math);
    reportPending(ctx.actor.name, math.pending);
    const unplaced = [...math.damageFactorBy, ...(math.autoHit ? [math.autoHit] : [])];
    if (unplaced.length) ui.notifications?.warn(loc("notice.unplaced", { name: ctx.actor.name, conditions: list(unplaced) }));
  }
  return math;
}

/**
 * The attack seam's contributor: each figure is a labelled modifier on the
 * attacker's throw (the target's rows marked as the target's) or on the
 * damage roll.
 */
const conditionContributor = {
  // A spell's carrier is asked for its attack throw only; its damage is the spell's own.
  carriers: ["attack"],
  attack(ctx, attackType, modifiers) {
    const math = conditionsOf(ctx, attackType);
    if (!math) return modifiers;
    return [...modifiers, ...math.terms.map((part) => ({ label: termLabel(part), value: part.value }))];
  },
  damage(ctx, attackType, modifiers) {
    const math = conditionsOf(ctx, attackType);
    if (!math) return modifiers;
    return [...modifiers, ...math.damage.map((part) => ({ label: nameOf(part.condition), value: part.value }))];
  },
};

/** Hold `delta` on `cell[key]` while `run` reads it, then put the field back. */
function withShift(cell, key, delta, run) {
  const was = cell?.[key];
  if (!delta || numOrNull(was) == null) return run();
  cell[key] = Number(was) + delta;
  try {
    return run();
  } finally {
    cell[key] = was;
  }
}

/* -------------------------------------------- */
/*  The rolls core makes from stored fields      */
/* -------------------------------------------- */

/**
 * One of the creature's own rolls, read and reported; null when nothing
 * applies. `options.save` names the saving throw, for the rows that reach
 * only some.
 */
function ownRoll(actor, on, options = {}) {
  const subject = subjectOf(actor);
  if (!subject?.statuses?.size) return null;
  const math = rollMath(on, subject, undefined, options);
  reportPending(actor.name, math.pending);
  reportApplied(actor.name, on, math.parts);
  if (math.exempt.length) {
    ui.notifications?.warn(loc("notice.exempt", { name: actor.name, conditions: list(math.exempt) }));
  }
  return math;
}

/**
 * The figure a roll's records (`roll-mods.mjs`) take off a saving throw's
 * number: the saver's save parts that hold for this throw (`save`, the system's
 * key). A scoped part depends on what is resisted, which this roll does not
 * name, so it is told and left out.
 */
function recordSaveShift(actor, save) {
  try {
    const mods = sheetSaveShift(actor, { save });
    tellRollMods(mods.told);
    return mods.total;
  } catch (err) {
    console.error(`${MODULE_ID} | a record's saving-throw figure could not be read; the throw rolls without it`, err);
    return 0;
  }
}

/**
 * A saving throw: a bonus lowers the number to roll. `save` is the system's
 * key for the throw, which is not always the conditions' name for it. A throw
 * that comes up under the number it was rolled against takes away the states
 * a failed save costs. This wrapper is the method's one owner: the conditions'
 * figure and the records' figure are read here and nowhere else.
 */
function onRollSave(wrapped, save, ...rest) {
  let math = null;
  try {
    math = ownRoll(this, "save", { save: saveKindOf(save) });
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read a saving throw; it rolls without them`, err);
  }
  const cell = this.system?.saves?.[save];
  const shift = -((math?.total ?? 0) + recordSaveShift(this, save));
  const target = numOrNull(cell?.value) == null ? null : Number(cell.value) + shift;
  const rolled = withShift(cell, "value", shift, () => wrapped(save, ...rest));
  if (target != null && lostTo(this.statuses, "save").length) void loseOnFailedSave(this, rolled, target);
  return rolled;
}

/**
 * Run an adventuring throw with the creature's conditions on it: a bonus
 * lowers the number to roll, held on the stored target for as long as `run`
 * reads it. Called by the adventuring throw's one wrapper
 * (`patches/adventuring-roll.mjs`), which owns that method.
 *
 * A stated `target` is the figure the throw is made against in place of the
 * stored one, BEFORE conditions: the conditions are applied to it here, once,
 * and the stored field is put back after.
 *
 * @param {Actor} actor   the creature rolling
 * @param {string} advKey the `system.adventuring` key thrown against
 * @param {() => *} run   the roll; it reads the target before it awaits anything
 * @param {object} [opts]
 * @param {number} [opts.target] the pre-condition figure to throw against
 */
export function withAdventuringConditions(actor, advKey, run, { target } = {}) {
  let math = null;
  try {
    math = ownRoll(actor, "throw");
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read an adventuring throw; it rolls without them`, err);
  }
  const cell = actor?.system?.adventuring;
  const shift = -(math?.total ?? 0);
  if (numOrNull(target) == null || !cell) return withShift(cell, advKey, shift, run);
  const was = cell[advKey];
  cell[advKey] = Number(target) + shift;
  try {
    return run();
  } finally {
    cell[advKey] = was;
  }
}

/**
 * Run the system's morale roll with the creature's conditions on it: the
 * figure joins the morale score the roll adds, for as long as `run` reads it.
 * Called by the morale roll's one wrapper (`patches/morale-roll.mjs`), which
 * owns that method.
 *
 * @param {Actor} actor  the creature rolling
 * @param {() => *} run  the system's roll
 */
export function withMoraleConditions(actor, run) {
  let math = null;
  try {
    math = ownRoll(actor, "morale");
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read a morale roll; it rolls without them`, err);
  }
  return withShift(actor?.system?.details, "morale", math?.total ?? 0, run);
}

/**
 * A character's speeds after core computes them from its load: every speed
 * keeps the share its conditions leave it.
 */
function onCalculateMovement(wrapped, ...args) {
  const result = wrapped(...args);
  try {
    const subject = subjectOf(this);
    if (!subject?.statuses?.size) return result;
    const { factor } = speedMath(subject);
    if (factor >= 1) return result;
    const keep = (v) => Math.floor(Number(v) * factor * 10) / 10;
    const speeds = this.system.movementacks;
    for (const key of ["exploration", "combat", "chargerun", "expedition"]) {
      if (numOrNull(speeds?.[key]) != null) speeds[key] = keep(speeds[key]);
    }
    if (numOrNull(this.system.movement?.base) != null) this.system.movement.base = keep(this.system.movement.base);
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read a speed; core's value stands`, err);
  }
  return result;
}

/**
 * Hold every combatant's surprise figure on the field the Surprise Matrix
 * reads, for as long as `run` takes: its own conditions' figure, and the sum of
 * what the opposing side's carriers impose (`surprise-parts.mjs`), each named by
 * its source and page. A combatant whose actor re-prepared in that time has a
 * fresh field, which is left alone. Which side rolls is the matrix's to decide
 * and is not visible from here, so the figures are told once, as what is held,
 * for whoever does roll.
 *
 * @param {object} pools the matrix's combatant pools, by disposition
 * @param {() => Promise<*>} run core's roll
 */
export async function withSurpriseConditions(pools, run) {
  const held = [];
  try {
    const against = surpriseAgainst(pools);
    for (const [pool, combatants] of Object.entries(pools ?? {})) {
      const imposed = against.imposedOn[sideOfPool(pool)] ?? [];
      for (const combatant of combatants ?? []) {
        const actor = combatant?.actor;
        const cell = actor?.system?.surprise;
        if (!cell || numOrNull(cell.avoidsurprise) == null) continue;
        const subject = subjectOf(actor);
        const own = subject?.statuses?.size ? rollMath("surprise", subject) : null;
        if (own) reportPending(actor.name, own.pending);
        const shift = (own?.total ?? 0) + sumOfParts(imposed);
        if (!shift) continue;
        held.push({ actor, cell, was: cell.avoidsurprise, parts: own?.parts ?? [], imposed });
        cell.avoidsurprise = Number(cell.avoidsurprise) + shift;
      }
    }
    if (held.length) {
      const rows = held.map((h) => [`${h.actor.name}: `, [partList(h.parts), importedList(h.imposed)].filter(Boolean).join(", ")].join("")).join("; ");
      ui.notifications?.info(loc("notice.surprise", { rows }));
    }
    if (against.left.length) {
      const rows = against.left.map((n) => `${n.bearer}: ${n.source}`).join(", ");
      ui.notifications?.info(loc("notice.surpriseLeft", { rows }));
    }
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read a surprise roll; it rolls without them`, err);
  }
  try {
    return await run();
  } finally {
    for (const { actor, cell, was } of held) if (actor.system?.surprise === cell) cell.avoidsurprise = was;
  }
}

/* -------------------------------------------- */
/*  The tracker lifting what it ends             */
/* -------------------------------------------- */

/**
 * Take the statuses `ids` off an actor, one at a time, through the system's own
 * toggle so every effect carrying a status goes with it. A status that cannot
 * be lifted is logged and the rest still are.
 */
export async function lift(actor, ids) {
  for (const id of ids) {
    try {
      await actor.toggleStatusEffect(id, { active: false });
    } catch (err) {
      console.error(`${MODULE_ID} | could not lift ${id} from ${actor.name}`, err);
    }
  }
}

/**
 * For each state on `actor` that another combatant of `combat` gave it, that
 * giver's combatant id.
 */
function giversIn(actor, combat) {
  const givers = {};
  for (const effect of actor.effects ?? []) {
    if (effect?.disabled) continue;
    for (const status of effect.statuses ?? []) {
      if (!CONDITIONS[status]?.given) continue;
      const giver = giverOf(effect, actor);
      if (giver && combat.combatants.get(giver.id) === giver) givers[status] = giver.id;
    }
  }
  return givers;
}

/** Whether no effect putting `status` on `actor` was made in round `round` of a fight or later. */
function carriedInto(actor, status, round) {
  return [...(actor.effects ?? [])].every((e) => e?.disabled || !e.statuses?.has(status) || !(e.start?.round >= round));
}

/**
 * As a combatant's turn begins, take off every combatant what ends there: its
 * own states that end with a turn, and the states it gave the others. With
 * `before`, only what was carried into that round: the turn is already over,
 * and what was taken up during it stands.
 */
async function liftAtTurn(combat, acting, { before = null } = {}) {
  if (!acting) return;
  const seen = new Set();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    const ending = endingAtTurn(actor.statuses, { self: combatant.id, acting, givers: giversIn(actor, combat) });
    const ids = before == null ? ending : ending.filter((id) => carriedInto(actor, id, before));
    // One actor behind two combatants is lifted once.
    await lift(actor, ids.filter((id) => !seen.has(`${actor.uuid}:${id}`)));
    for (const id of ids) seen.add(`${actor.uuid}:${id}`);
  }
}

/**
 * Per fight, the round that opened before its initiative was rolled and has
 * not begun. The system clears initiative as a round opens, and until it is
 * rolled the tracker's current combatant is not acting: the tracker only
 * follows the roll. Held by the lifting client; a reload in that window
 * forgets it.
 */
const unrolled = new Map();

/** Whether any combatant of `combat` is still without an initiative. */
const awaitsRoll = (combat) => combat.combatants.some((c) => c.initiative == null);

/** Run a turn hook's call; a listener that throws costs only itself. */
function tellListeners(call) {
  try {
    call();
  } catch (err) {
    console.error(`${MODULE_ID} | a turn listener failed`, err);
  }
}

/**
 * Apply a turn event (`began` or `ended`, for `combatantId`) to every record of
 * `combat` carrying a `turnLife` flag, on the actor of any combatant of it: a
 * record whose count is reached is deleted by id, and any other that counted
 * the turn has its `seen` written, once. A fight's records are its own: a
 * record of another fight is never touched. A record in a fight that is
 * deleted stays, and the flag clock ends it.
 */
async function liftTurnLife(combat, combatantId, kind) {
  const event = { kind, combatId: combat.id, combatantId };
  const done = new Set();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    if (!actor) continue;
    // One actor behind two combatants holds each record once.
    for (const effect of [...(actor.effects ?? [])]) {
      const record = readTurnLife(effect?.flags?.[MODULE_ID]?.[FLAG_TURN_LIFE]);
      const key = effect?.uuid ?? effect;
      if (!record || done.has(key)) continue;
      done.add(key);
      const step = turnLifeStep(record, event);
      try {
        if (step.lift) await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
        else if (step.seen !== record.seen) await effect.setFlag(MODULE_ID, FLAG_TURN_LIFE, { ...record, seen: step.seen });
      } catch (err) {
        console.error(`${MODULE_ID} | could not step a record's turn count on ${actor.name}`, err);
      }
    }
  }
}

/**
 * A turn begins: the records that end as it starts go first, then what ends
 * with the turn, then the hook. With `counts` false the tracker is on a turn
 * that already began (the Judge stepped back, or the order moved under it),
 * which lifts what the turn lifts and is no new turn for a record or a listener.
 */
async function beginTurn(combat, combatantId, { before = null, counts = true } = {}) {
  if (!combatantId) return;
  if (counts) await liftTurnLife(combat, combatantId, "began");
  await liftAtTurn(combat, combatantId, before == null ? {} : { before });
  if (counts) tellListeners(() => Hooks.callAll(TURN_BEGAN_HOOK, combat, combatantId));
}

/** A turn ends: the records that end with it, then the hook. */
async function endTurn(combat, combatantId) {
  if (!combatantId) return;
  await liftTurnLife(combat, combatantId, "ended");
  tellListeners(() => Hooks.callAll(TURN_ENDED_HOOK, combat, combatantId));
}

/**
 * The tracker changed who is current. A round that opened unrolled begins when
 * every combatant has rolled, or when the Judge moves the tracker on without
 * that; in between, a change of the current combatant is the roll re-sorting
 * the order and no turn. The turn the tracker leaves ends before the next one
 * begins, and a round that opens unrolled still ends the turn it was
 * advanced from; a turn the Judge passed over by hand begins and ends as it
 * is passed.
 */
async function onTurnChange(combat, prior, current) {
  const now = combat.combatants.get(current?.combatantId);
  if (!now) return;
  const opening = prior?.round !== current.round;
  // Read before an opening overwrites it: leaving a round that never began ends no turn.
  const edges = turnEdges(prior, current, { unrolled: unrolled.get(combat.id) ?? null });
  if (opening && now.initiative == null) {
    unrolled.set(combat.id, current.round);
    await endTurn(combat, edges.ended);
    return;
  }
  let { ended, began } = edges;
  let passed = null;
  if (!opening && unrolled.get(combat.id) === current.round) {
    const advanced = current.turn > prior.turn;
    if (!advanced && awaitsRoll(combat)) return;
    if (advanced) passed = prior.combatantId;
    // The round's first turn begins here, forward or back; the position the tracker held was no turn.
    began = true;
    ended = null;
  }
  unrolled.delete(combat.id);
  // Moved on by hand: the turn the tracker left has passed.
  if (passed) {
    await beginTurn(combat, passed, { before: current.round });
    await endTurn(combat, passed);
  }
  await endTurn(combat, ended);
  await beginTurn(combat, now.id, { counts: began });
}

/**
 * An initiative was rolled in a round that opened unrolled. When the last one
 * lands with the tracker already on the round's first combatant, no turn
 * change follows, and that turn begins here.
 */
function onInitiativeRolled(combat) {
  if (!unrolled.has(combat?.id)) return;
  // The tracker re-sorts after the combatants' own update hooks.
  setTimeout(() => {
    if (unrolled.get(combat.id) !== combat.round || combat.turn !== 0 || awaitsRoll(combat)) return;
    unrolled.delete(combat.id);
    void beginTurn(combat, combat.combatant?.id);
  }, 0);
}

/* -------------------------------------------- */
/*  States lost before they end                  */
/* -------------------------------------------- */

/** The operation key under which a pre-update tells the update that hit points fell. */
const HP_FELL = "hpFell";

/** The loss in flight, by the losing actor's uuid: `{cause, ids}` for as long as `loseStates` is lifting. */
const LOSING = new Map();

/**
 * The loss `loseStates` is lifting for this actor right now, `{cause, ids}`, or
 * null. A delete hook fired by that lift runs on this client while the loss is
 * held, so it can name what cost the state; once `loseStates` has finished (or
 * thrown) there is nothing to read. `STATES_LOST_HOOK` fires after the lift and
 * cannot serve.
 */
export const lossInFlight = (actor) => LOSING.get(actor?.uuid) ?? null;

/**
 * Take off an actor the states `cause` costs it, say so, and fire
 * `STATES_LOST_HOOK` with `(actor, ids, cause)` when anything was lost. Run by
 * the client that made the change, which is one client and holds the rights
 * the change itself needed. `cause` is a `lostTo` cause: `damage`, `save` or
 * `moved`.
 *
 * @returns {Promise<string[]>} the status ids taken off
 */
export async function loseStates(actor, cause) {
  const ids = lostTo(actor?.statuses, cause);
  if (!ids.length) return [];
  // The delete hooks `lift` fires on this client read the cause while it runs.
  const mine = { cause, ids };
  LOSING.set(actor.uuid, mine);
  try {
    await lift(actor, ids);
  } finally {
    if (LOSING.get(actor.uuid) === mine) LOSING.delete(actor.uuid);
  }
  ui.notifications?.info(loc("notice.lost", { name: actor.name, conditions: list(ids), cause: loc(`lost.${cause}`) }));
  try {
    Hooks.callAll(STATES_LOST_HOOK, actor, ids, cause);
  } catch (err) {
    console.error(`${MODULE_ID} | a states-lost listener failed`, err);
  }
  return ids;
}

/**
 * Delete, by id, the actor's records that end on `cause` (`damage` or `attack`,
 * the words of a record's `endsOn` flag) and say so. The ids are read from the
 * actor as it stands when this runs, so a record an earlier loss already took
 * is not asked for twice; a delete that fails is logged and ends nothing. Run
 * by the client that made the change, as `loseStates` is.
 *
 * @param {Actor} actor
 * @param {string} cause
 * @returns {Promise<string[]>} the ids deleted
 */
export async function loseRecords(actor, cause) {
  const effects = [...(actor?.effects ?? [])];
  const ids = endedBy(effects, cause);
  if (!ids.length) return [];
  const names = effects.filter((e) => ids.includes(e.id)).map((e) => e.name).filter(Boolean);
  try {
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  } catch (err) {
    console.error(`${MODULE_ID} | could not end ${actor.name}'s records on ${cause}`, err);
    return [];
  }
  ui.notifications?.info(loc("notice.recordsLost", { name: actor.name, records: names.join(", "), cause: loc(`lost.${cause}`) }));
  return ids;
}

/** After a saving throw resolves: one that came up under its number costs what a failed save costs. */
async function loseOnFailedSave(actor, rolled, target) {
  try {
    const roll = await rolled;
    if (numOrNull(roll?.total) != null && roll.total < target) await loseStates(actor, "save");
  } catch (err) {
    console.error(`${MODULE_ID} | could not read a saving throw's result for ${actor?.name}`, err);
  }
}

/**
 * Before an actor's update: mark the operation when it lowers the hit points
 * of a creature with a state or a record damage costs. The earlier value
 * exists only here.
 */
function notePriorHp(actor, changed, options) {
  const next = numOrNull(changed?.system?.hp?.value ?? changed?.["system.hp.value"]);
  const prior = numOrNull(actor?.system?.hp?.value);
  if (next == null || prior == null || next >= prior) return;
  if (!lostTo(actor.statuses, "damage").length && !endedBy(actor.effects, "damage").length) return;
  options[MODULE_ID] = { ...options[MODULE_ID], [HP_FELL]: true };
}

/**
 * What damage costs a creature: its records that end on damage first, then the
 * states it loses to damage. In order, because a record may carry a state and
 * the second reads what is left.
 */
async function loseToDamage(actor) {
  try {
    await loseRecords(actor, "damage");
    await loseStates(actor, "damage");
  } catch (err) {
    console.error(`${MODULE_ID} | could not take away what damage costs ${actor?.name}`, err);
  }
}

/** Listen for what takes a state away early: damage, an attack made, and a token moved out of its turn. */
function registerLosses() {
  Hooks.on("preUpdateActor", notePriorHp);
  // A token actor's update runs preUpdateActor; a write to its ActorDelta document runs the delta's.
  Hooks.on("preUpdateActorDelta", (delta, changed, options) => notePriorHp(delta?.syntheticActor, changed, options));
  Hooks.on("updateActor", (actor, _changed, options, userId) => {
    if (userId !== game.user?.id || !options?.[MODULE_ID]?.[HP_FELL]) return;
    void loseToDamage(actor);
  });
  // The hook fires on the attacker's own client, after the attack has resolved, so the attacker's
  // records are its own to end; a spell carrier's attack counts like any other.
  Hooks.on(POST_ATTACK_HOOK, (actor) => void loseRecords(actor, "attack"));
  // A token that moves while another combatant acts was moved, or spent what it held.
  // Before a round's initiative is rolled nobody acts, and a move there costs nothing.
  Hooks.on("moveToken", (token, movement, _operation, user) => {
    if (!user?.isSelf || movement?.method === "undo") return;
    const combat = game.combat;
    if (!combat?.started || !token?.actor) return;
    const acting = combat.combatant;
    if (acting?.initiative == null) return;
    const own = combat.combatants.find((c) => c.tokenId === token.id && c.sceneId === token.parent?.id);
    if (!own || acting === own) return;
    void loseStates(token.actor, "moved");
  });
}

/* -------------------------------------------- */
/*  Installation                                 */
/* -------------------------------------------- */

/**
 * Wrap one method of the system's actor class, through libWrapper where it is
 * present. A registration that fails costs that one roll its conditions and
 * nothing else.
 */
function wrapActorMethod(name, wrapper) {
  const proto = CONFIG.Actor.documentClass?.prototype;
  if (typeof proto?.[name] !== "function") {
    console.warn(`${MODULE_ID} | ${name} not found on the actor class; conditions do not reach it.`);
    return;
  }
  try {
    if (globalThis.libWrapper?.register) {
      globalThis.libWrapper.register(MODULE_ID, `CONFIG.Actor.documentClass.prototype.${name}`, wrapper, "WRAPPER");
      return;
    }
    const core = proto[name];
    proto[name] = function (...args) {
      return wrapper.call(this, (...inner) => core.apply(this, inner), ...args);
    };
  } catch (err) {
    console.error(`${MODULE_ID} | could not wrap ${name}; conditions do not reach it`, err);
  }
}

/**
 * Put the conditions on every roll they reach. At `ready`: the system's actor
 * class is final there. The attack throw is reached through the attack seam
 * (`patches/attack-throw.mjs`), which carries the figures as labelled
 * modifiers on the system's own throw.
 */
export function installConditionRolls() {
  addAttackContributor(conditionContributor);
  wrapActorMethod("rollSave", onRollSave);
  wrapActorMethod("_calculateMovement", onCalculateMovement);

  // One client lifts, so two Judges at the table do not both delete an effect.
  Hooks.on("combatTurnChange", (combat, prior, current) => {
    if (!isPrimaryGM()) return;
    void onTurnChange(combat, prior, current);
  });
  Hooks.on("updateCombatant", (combatant, changed) => {
    if (!isPrimaryGM() || changed?.initiative == null) return;
    onInitiativeRolled(combatant.combat);
  });
  Hooks.on("deleteCombat", (combat) => {
    unrolled.delete(combat.id);
    if (!isPrimaryGM()) return;
    for (const combatant of combat.combatants) {
      if (combatant.actor) void lift(combatant.actor, endingAt(combatant.actor.statuses, "combat"));
    }
  });
  registerLosses();
}
