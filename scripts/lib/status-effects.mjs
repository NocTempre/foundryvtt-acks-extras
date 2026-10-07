/* global CONFIG, Hooks, game, ui, fromUuid */
/**
 * Conditions on the table: the status effects a token can carry, and the
 * seams that put their math on a roll (RR 507-515, Appendix B).
 *
 * The palette is the catalogue in `conditions.mjs` and three states the engine
 * needs beside it; Foundry's generic list is replaced, not extended. Nothing
 * here stores a modifier on an effect. Each roll reads the roller's statuses
 * — and the target's, for an attack — at the moment it is made, so a condition
 * applies its math whoever created the effect that carries it, and a figure
 * imported later reaches conditions already in place.
 *
 * Rolls the system makes from stored fields (saving throws, adventuring
 * throws, morale, the surprise roll, core's own attack) take the figure as a
 * shift of that field held only across the synchronous read, then put back:
 * the roll sees it and no document ever stores it.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { expectTables } from "./tables.mjs";
import { isPrimaryGM, numOrNull } from "./util.mjs";
import { getMonsterExtras } from "./senses.mjs";
import { STATUS_HIDDEN, STATUS_RUNNING } from "./perception.mjs";
import { fixEach, registerRepairCheck, worldActors } from "./repair.mjs";
import { PRE_ATTACK_HOOK, wrapRollAttack } from "./patches/attack-roll.mjs";
import {
  CONDITIONS, CONDITIONS_DOC, CONDITIONS_TABLE,
  attackMath, rollMath, speedMath, subjectOf, endingAt,
} from "./conditions.mjs";

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
 * Status ids other packages wrote, each with the condition it stood for:
 * Foundry's generic list, and this module's earlier id for Hidden.
 */
const LEGACY_STATUS_IDS = Object.freeze({
  [`${MODULE_ID}.hiding`]: STATUS_HIDDEN,
  blind: "blinded",
  deaf: "deafened",
  fear: "frightened",
  paralysis: "paralyzed",
  restrain: "restrained",
  sleep: "slumbering",
  bless: "blessed",
  // The senses read this id as a creature that cannot hear.
  silence: "deafened",
});

const loc = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.conditionRoll.${key}`, data);
const nameOf = (id) => game.i18n.localize(conditionNameKey(id));
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
const sum = (parts) => parts.reduce((total, p) => total + p.value, 0);

/**
 * Make the token palette the conditions and nothing else, point Foundry's
 * blindness at the Blinded condition, and declare the table the figures come
 * from. At `init`: a token drawn before this runs offers the generic list.
 */
export function registerStatusEffects() {
  const palette = [
    ...Object.entries(CONDITIONS).map(([id, c]) => ({ id, name: conditionNameKey(id), img: c.img })),
    ...STATES,
  ];
  CONFIG.statusEffects.length = 0;
  CONFIG.statusEffects.push(...palette);
  CONFIG.specialStatusEffects.BLIND = "blinded";
  expectTables(CONDITIONS_DOC, [CONDITIONS_TABLE]);
}

/* -------------------------------------------- */
/*  Reading a roll's parties                     */
/* -------------------------------------------- */

/** How an attack is made, from the roll type and the weapon's own two flags. */
function attackKind(item, type) {
  const sys = item?.system ?? {};
  if (type === "missile") return sys.melee ? "thrown" : "missile";
  if (type === "melee") return "melee";
  return sys.missile && !sys.melee ? "missile" : "melee";
}

/** The size a character with no stat block of its own is. */
const CHARACTER_SIZE = "man";

/**
 * A creature's size as its place in the monsters feature's size ladder, or
 * null when no ladder or no size is known.
 */
function sizeRank(actor) {
  const order = Object.keys(globalThis.acksExtras?.monsters?.config?.SIZES ?? {});
  if (!order.length || !actor) return null;
  const size = getMonsterExtras(actor)?.size ?? (actor.type === "character" ? CHARACTER_SIZE : null);
  return size && order.includes(size) ? order.indexOf(size) : null;
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

/** Conditions already reported as unpriced this session. */
const reportedUnpriced = new Set();

/** A condition's name as a term carries it: the target's are marked as the target's. */
const termLabel = (part) => (part.side === "target" ? loc("term.target", { name: nameOf(part.condition) }) : nameOf(part.condition));

const list = (ids) => [...new Set(ids)].map(nameOf).join(", ");
const partList = (parts) => parts.map((p) => `${termLabel(p)} ${signed(p.value)}`).join(", ");

/** Say once per session that a condition in play has no figures registered. */
function reportUnpriced(ids) {
  const fresh = ids.filter((id) => !reportedUnpriced.has(id));
  if (!fresh.length) return;
  for (const id of fresh) reportedUnpriced.add(id);
  ui.notifications?.warn(loc("notice.unpriced", { conditions: list(fresh) }));
}

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
 * The remodeled roll's listener: each figure becomes a labelled term on the
 * attacker's stack, the damage rows and factor ride the context, and an attack
 * that needs no throw is marked with the condition that waives it.
 */
function onPreAttack(actor, ctx) {
  let math;
  try {
    math = attackConditions(actor, ctx.targetActor, ctx.item, ctx.type);
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read an attack; it rolls without them`, err);
    return;
  }
  if (!math) return;
  for (const part of math.terms) {
    ctx.terms.push({ key: `condition.${part.side}.${part.condition}`, value: part.value, label: termLabel(part) });
  }
  for (const part of math.damage) ctx.damageTerms.push({ value: part.value, label: nameOf(part.condition) });
  ctx.damageFactor *= math.damageFactor;
  if (math.autoHit) ctx.autoHit = nameOf(math.autoHit);
  reportAttackBars(actor, ctx.targetName, math);
  reportPending(actor.name, math.pending);
  reportUnpriced(math.unpriced);
}

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

/**
 * Core's own attack roll, when the remodeled one is off. Core reads its base
 * attack bonus and its damage adjustment into the formula before it awaits
 * anything, so the figures ride those two fields across that read. Core's
 * card names no term, so what was applied is told beside it.
 */
function coreRollAttack(wrapped, attData, options = {}) {
  const type = options.type ?? "melee";
  let math = null;
  try {
    math = attackConditions(this, attData?.roll?.target?.actor ?? null, attData?.item, type);
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read an attack; it rolls without them`, err);
  }
  if (!math) return wrapped(attData, options);
  reportAttackBars(this, attData?.roll?.target?.name, math);
  reportPending(this.name, math.pending);
  reportUnpriced(math.unpriced);
  reportApplied(this.name, "attack", math.terms);
  reportApplied(this.name, "damage", math.damage);
  // Core's roll has no place for a scaled damage roll or a waived throw.
  const unplaced = [...math.damageFactorBy, ...(math.autoHit ? [math.autoHit] : [])];
  if (unplaced.length) ui.notifications?.warn(loc("notice.unplaced", { name: this.name, conditions: list(unplaced) }));
  const sys = this.system;
  return withShift(sys.thac0, "bba", sum(math.terms), () =>
    withShift(sys.damage?.mod, type, sum(math.damage), () => wrapped(attData, options)),
  );
}

/* -------------------------------------------- */
/*  The rolls core makes from stored fields      */
/* -------------------------------------------- */

/** One of the creature's own rolls, read and reported; null when nothing applies. */
function ownRoll(actor, on) {
  const subject = subjectOf(actor);
  if (!subject?.statuses?.size) return null;
  const math = rollMath(on, subject);
  reportPending(actor.name, math.pending);
  reportUnpriced(math.unpriced);
  reportApplied(actor.name, on, math.parts);
  if (math.exempt.length) {
    ui.notifications?.warn(loc("notice.exempt", { name: actor.name, conditions: list(math.exempt) }));
  }
  return math;
}

/** A saving throw: a bonus lowers the number to roll. */
function onRollSave(wrapped, save, ...rest) {
  let math = null;
  try {
    math = ownRoll(this, "save");
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read a saving throw; it rolls without them`, err);
  }
  return withShift(this.system?.saves?.[save], "value", -(math?.total ?? 0), () => wrapped(save, ...rest));
}

/**
 * Run an adventuring throw with the creature's conditions on it: a bonus
 * lowers the number to roll, held on the stored target for as long as `run`
 * reads it. Called by the adventuring throw's one wrapper
 * (`patches/adventuring-roll.mjs`), which owns that method.
 *
 * @param {Actor} actor   the creature rolling
 * @param {string} advKey the `system.adventuring` key thrown against
 * @param {() => *} run   the roll; it reads the target before it awaits anything
 */
export function withAdventuringConditions(actor, advKey, run) {
  let math = null;
  try {
    math = ownRoll(actor, "throw");
  } catch (err) {
    console.error(`${MODULE_ID} | conditions could not read an adventuring throw; it rolls without them`, err);
  }
  return withShift(actor?.system?.adventuring, advKey, -(math?.total ?? 0), run);
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
    const { factor, unpriced } = speedMath(subject);
    reportUnpriced(unpriced);
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
 * reads, for as long as `run` takes. A combatant whose actor re-prepared in
 * that time has a fresh field, which is left alone. Which side rolls is the
 * matrix's to decide and is not visible from here, so the figures are told
 * once, as what is held, for whoever does roll.
 *
 * @param {object} pools the matrix's combatant pools, by disposition
 * @param {() => Promise<*>} run core's roll
 */
export async function withSurpriseConditions(pools, run) {
  const held = [];
  try {
    for (const combatant of Object.values(pools ?? {}).flat()) {
      const actor = combatant?.actor;
      const cell = actor?.system?.surprise;
      if (!cell || numOrNull(cell.avoidsurprise) == null) continue;
      const subject = subjectOf(actor);
      if (!subject?.statuses?.size) continue;
      const math = rollMath("surprise", subject);
      reportPending(actor.name, math.pending);
      reportUnpriced(math.unpriced);
      if (!math.total) continue;
      held.push({ actor, cell, was: cell.avoidsurprise, parts: math.parts });
      cell.avoidsurprise = Number(cell.avoidsurprise) + math.total;
    }
    if (held.length) {
      const rows = held.map((h) => `${h.actor.name}: ${partList(h.parts)}`).join("; ");
      ui.notifications?.info(loc("notice.surprise", { rows }));
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

/** Take off an actor every condition that ends at `moment`. */
async function liftEnding(actor, moment) {
  if (!actor) return;
  for (const id of endingAt(actor.statuses, moment)) {
    try {
      await actor.toggleStatusEffect(id, { active: false });
    } catch (err) {
      console.error(`${MODULE_ID} | could not lift ${id} from ${actor.name}`, err);
    }
  }
}

/* -------------------------------------------- */
/*  Earlier ids                                  */
/* -------------------------------------------- */

/** Register the repair check that renames earlier status ids to their conditions. */
function registerStatusIdCheck() {
  const key = (name) => `${LANG_PREFIX}.repair.check.statusIds.${name}`;
  registerRepairCheck({
    id: "lib.statusIds",
    label: key("label"),
    hint: key("hint"),
    order: 60,
    scan: () => {
      const out = [];
      for (const actor of worldActors()) {
        for (const effect of actor.effects ?? []) {
          const old = [...(effect.statuses ?? [])].filter((s) => LEGACY_STATUS_IDS[s]);
          if (!old.length) continue;
          out.push({
            key: effect.uuid,
            uuid: effect.uuid,
            name: `${actor.name} → ${effect.name}`,
            detail: game.i18n.format(key("detail"), {
              from: old.join(", "),
              to: old.map((s) => nameOf(LEGACY_STATUS_IDS[s])).join(", "),
            }),
          });
        }
      }
      return out;
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const effect = await fromUuid(f.uuid);
        if (!effect) return;
        const statuses = [...new Set([...effect.statuses].map((s) => LEGACY_STATUS_IDS[s] ?? s))];
        await effect.update({ statuses });
      }),
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
 * class is final there.
 *
 * @param {object} opts
 * @param {boolean} opts.remodeledAttack whether the remodeled attack roll is
 *   installed; when it is not, core's roll carries the figures instead.
 */
export function installConditionRolls({ remodeledAttack = true } = {}) {
  if (remodeledAttack) Hooks.on(PRE_ATTACK_HOOK, onPreAttack);
  else wrapRollAttack(coreRollAttack);
  wrapActorMethod("rollSave", onRollSave);
  wrapActorMethod("_calculateMovement", onCalculateMovement);

  // One client lifts, so two Judges at the table do not both delete an effect.
  Hooks.on("combatTurnChange", (combat, _prior, current) => {
    if (!isPrimaryGM()) return;
    liftEnding(combat.combatants.get(current?.combatantId)?.actor, "turn");
  });
  Hooks.on("deleteCombat", (combat) => {
    if (!isPrimaryGM()) return;
    for (const combatant of combat.combatants) liftEnding(combatant.actor, "combat");
  });

  registerStatusIdCheck();
}
