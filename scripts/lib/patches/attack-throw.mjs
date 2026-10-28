/* global game, CONFIG, Hooks, libWrapper */
/**
 * The attack throw's seam: what this module adds to the system's own attack
 * pipeline, and the two hooks other features hang off it.
 *
 * The system rolls every attack through `AcksActor#makeAttackThrow`, which
 * builds the throw from LABELLED MODIFIERS it asks the data models for —
 * `getAttackThrowModifiers(attackType)` and `getDamageModifiers(attackType)`
 * on the attacker's model, the same pair with no argument on the weapon's —
 * and from the weapon's `getAttackTypes()`, `getDamageModes(attackType)` and
 * `getDamageFormula(mode)`. The dialog's live preview and the skipped-dialog
 * roll ask the same questions, so one answer serves both.
 *
 * This file wraps those questions (one libWrapper WRAPPER per method) and
 * answers them from a set of CONTRIBUTORS: the conditions, the equipment
 * feature's per-weapon modifiers, and whatever a later feature registers. A
 * contributor sees the attack in flight — attacker, weapon, target, options —
 * because `makeAttackThrow` is wrapped too, and the wrapper holds the attack's
 * context for the attacker while the system builds and rolls it. A sheet
 * rendering its attack boxes asks the same questions with no attack in
 * flight, and gets the system's own answer.
 *
 * What the system's throw has no place for — a damage roll scaled by a
 * factor, a throw waived outright — is told to the table as a notice, never
 * faked as a large bonus. See docs/lib/DECISIONS.md, "The attack seam rides
 * the system's labelled modifiers".
 */
import { MODULE_ID } from "../constants.mjs";
import { ITEM_TYPE } from "../vocab.mjs";

/**
 * Fired as an attack begins, with `(actor, ctx)`, before the system builds the
 * throw. `ctx.terms` and `ctx.damageTerms` are mutable lists of `{label,
 * value}` rows added to the attack throw and the damage roll whatever the
 * attack's kind turns out to be; `ctx.item`, `ctx.target` and `ctx.options`
 * are what the attack was asked with. A contributor that needs the attack's
 * kind registers through `addAttackContributor` instead.
 */
export const PRE_ATTACK_HOOK = "acksLibPreAttackRoll";

/**
 * Fired once the attack has RESOLVED, with `(actor, ctx, outcome)` — the seam
 * for consequences that hang off an attack having happened at all (ammunition
 * spent, the mounted overlay's staying-mounted saves). `outcome` is the
 * system's `TAttackThrowOutcome`; listeners must not mutate it. A cancelled
 * dialog fires nothing.
 */
export const POST_ATTACK_HOOK = "acksLibPostAttackRoll";

/** The attacks in flight, by attacker. */
const inFlight = new WeakMap();

/**
 * The attack an actor is making right now, or null. A contributor asked a
 * question outside an attack (a sheet drawing its attack boxes) reads null.
 */
export const attackInFlight = (actor) => (actor ? (inFlight.get(actor) ?? null) : null);

/**
 * The registered contributors, in registration order. Each is an object with
 * any of:
 *
 *   attack(ctx, attackType, modifiers)      → modifiers for the attack throw
 *   damage(ctx, attackType, modifiers)      → modifiers for the damage roll
 *   attackTypes(item, types)                → the kinds of attack a weapon offers
 *   damageModes(item, attackType, modes)    → the grips a weapon offers, first is the default
 *   damageFormula(item, mode, formula)      → the die a grip deals
 *
 * Each receives the list so far and returns the list to go on with, so a
 * contributor may add rows, drop rows, or reorder. A row is `{label, value}`,
 * `value` a number or a signed formula fragment, as the system's own are.
 */
const contributors = [];

/** Register a contributor; the same object is registered once. */
export function addAttackContributor(contributor) {
  if (contributor && typeof contributor === "object" && !contributors.includes(contributor)) contributors.push(contributor);
}

/** Run one question through every contributor that answers it. A contributor that throws is skipped for that question. */
function ask(question, args, initial) {
  let out = initial;
  for (const c of contributors) {
    if (typeof c[question] !== "function") continue;
    try {
      const next = c[question](...args, out);
      if (Array.isArray(next) || typeof next === "string") out = next;
    } catch (err) {
      console.error(`${MODULE_ID} | an attack contributor failed on ${question}; its answer is left out`, err);
    }
  }
  return out;
}

/** `{label, value}` rows from a hook's term list, dropping what carries no number or formula. */
const rows = (terms) =>
  (terms ?? [])
    .filter((t) => t && (typeof t.value === "number" ? Number.isFinite(t.value) : typeof t.value === "string" && t.value.trim()))
    .map((t) => ({ label: String(t.label ?? ""), value: t.value }));

/**
 * The attack throw's modifiers for an attacker's data model: the system's
 * own, then every contributor's, then the rows the pre-attack hook placed.
 * With no attack in flight the system's answer stands.
 *
 * @param {object} system  the attacker's data model (`this` in `getAttackThrowModifiers`)
 * @param {string} attackType
 * @param {Array<{label: string, value: number|string}>} base  the model's own rows
 */
export function attackThrowModifiersFor(system, attackType, base) {
  const ctx = attackInFlight(system?.parent);
  if (!ctx) return base;
  ctx.type = attackType;
  return [...ask("attack", [ctx, attackType], [...(base ?? [])]), ...rows(ctx.terms)];
}

/** The damage roll's modifiers for an attacker's data model; see `attackThrowModifiersFor`. */
export function damageModifiersFor(system, attackType, base) {
  const ctx = attackInFlight(system?.parent);
  if (!ctx) return base;
  return [...ask("damage", [ctx, attackType], [...(base ?? [])]), ...rows(ctx.damageTerms)];
}

/**
 * The context one attack carries. Built once per `makeAttackThrow` and handed
 * to every hook and contributor for that attack.
 *
 * @param {Actor} actor
 * @param {object} options  `makeAttackThrow`'s own `{item, attackType, skipDialog}`,
 *   plus an optional `acksLib: {terms, damageTerms, damageMode, maneuver}` a
 *   caller adds for this one attack: rows for the throw and the damage, the
 *   grip to open on, a manoeuvre declared with the attack.
 */
export function attackContext(actor, options = {}) {
  const targets = game.user?.targets ? Array.from(game.user.targets) : [];
  const target = targets[0]?.document ?? null;
  const item = options.item ?? null;
  const own = options.acksLib ?? {};
  return {
    actor,
    item,
    weapon: item?.type === ITEM_TYPE.weapon ? item : null,
    target,
    targetActor: target?.actor ?? null,
    targetName: target?.name ?? null,
    type: options.attackType ?? null,
    options,
    terms: rows(own.terms),
    damageTerms: rows(own.damageTerms),
    damageMode: own.damageMode ?? null,
    maneuver: own.maneuver ?? null,
  };
}

/** WRAPPER around `AcksActor#makeAttackThrow`: hold the context, fire the hooks. */
async function onMakeAttackThrow(wrapped, options = {}) {
  const ctx = attackContext(this, options);
  try {
    Hooks.callAll(PRE_ATTACK_HOOK, this, ctx);
  } catch (err) {
    console.error(`${MODULE_ID} | a pre-attack listener failed; the attack rolls without it`, err);
  }
  const prior = inFlight.get(this) ?? null;
  inFlight.set(this, ctx);
  let outcome = null;
  try {
    outcome = await wrapped({ ...options, item: ctx.item, attackType: ctx.type ?? undefined });
  } finally {
    if (inFlight.get(this) === ctx) {
      if (prior) inFlight.set(this, prior);
      else inFlight.delete(this);
    }
  }
  if (outcome) {
    try {
      Hooks.callAll(POST_ATTACK_HOOK, this, ctx, outcome);
    } catch (err) {
      console.error(`${MODULE_ID} | a post-attack listener failed`, err);
    }
  }
  return outcome;
}

/** WRAPPER around a system actor model's `getAttackThrowModifiers`. */
function onActorAttackModifiers(wrapped, attackType) {
  return attackThrowModifiersFor(this, attackType, wrapped(attackType) ?? []);
}

/** WRAPPER around a system actor model's `getDamageModifiers`. */
function onActorDamageModifiers(wrapped, attackType) {
  return damageModifiersFor(this, attackType, wrapped(attackType) ?? []);
}

/** WRAPPER around the weapon model's `getAttackTypes`. */
function onWeaponAttackTypes(wrapped) {
  return ask("attackTypes", [this.parent], [...(wrapped() ?? [])]);
}

/** WRAPPER around the weapon model's `getDamageModes`. */
function onWeaponDamageModes(wrapped, attackType) {
  return ask("damageModes", [this.parent, attackType], [...(wrapped(attackType) ?? [])]);
}

/** The weapons already reported as holding a damage that is not dice, by uuid and text. */
const reportedDamage = new Set();

/**
 * WRAPPER around the weapon model's `getDamageFormula`, whose only caller is
 * the system's attack-throw builder. A formula that does not parse is answered
 * as none, so the attack rolls no damage: the system parses it only on a hit,
 * and its throw there escapes every sheet's click handler, so the hit would post
 * no card at all. The Judge is told once per weapon and text.
 */
function onWeaponDamageFormula(wrapped, mode) {
  const formula = ask("damageFormula", [this.parent, mode], wrapped(mode) ?? "");
  if (typeof formula !== "string" || !formula.trim() || globalThis.Roll?.validate?.(formula) !== false) return formula;
  const item = this.parent;
  const key = `${item?.uuid}|${formula}`;
  if (!reportedDamage.has(key)) {
    reportedDamage.add(key);
    globalThis.ui?.notifications?.warn(game.i18n.format("ACKS-LIB.attack.badDamage", { item: item?.name ?? "", formula }));
  }
  return "";
}

/** Register one wrapper, naming what is lost when the target is absent. */
function wrap(path, wrapper) {
  try {
    const target = path.split(".").reduce((o, k) => o?.[k], globalThis);
    if (typeof target !== "function") {
      console.warn(`${MODULE_ID} | ${path} not found; the attack seam does not reach it.`);
      return false;
    }
    libWrapper.register(MODULE_ID, path, wrapper, "WRAPPER");
    return true;
  } catch (err) {
    console.error(`${MODULE_ID} | could not wrap ${path}; the attack seam does not reach it`, err);
    return false;
  }
}

/**
 * Install the seam. At `ready`: the system's actor class and data models are
 * final there. The module's own creature models (animal, group, template)
 * answer through `attackThrowModifiersFor` / `damageModifiersFor` directly
 * and need no wrapper.
 */
export function installAttackThrowPatch() {
  if (game.system?.id !== "acks") return false;
  if (!globalThis.libWrapper?.register) {
    console.error(`${MODULE_ID} | libWrapper is not active; the attack seam is not installed.`);
    return false;
  }
  const ok = wrap("CONFIG.Actor.documentClass.prototype.makeAttackThrow", onMakeAttackThrow);
  for (const type of Object.keys(CONFIG.Actor.dataModels ?? {})) {
    if (type.includes(".")) continue; // a module sub-type answers for itself
    wrap(`CONFIG.Actor.dataModels.${type}.prototype.getAttackThrowModifiers`, onActorAttackModifiers);
    wrap(`CONFIG.Actor.dataModels.${type}.prototype.getDamageModifiers`, onActorDamageModifiers);
  }
  wrap(`CONFIG.Item.dataModels.${ITEM_TYPE.weapon}.prototype.getAttackTypes`, onWeaponAttackTypes);
  wrap(`CONFIG.Item.dataModels.${ITEM_TYPE.weapon}.prototype.getDamageModes`, onWeaponDamageModes);
  wrap(`CONFIG.Item.dataModels.${ITEM_TYPE.weapon}.prototype.getDamageFormula`, onWeaponDamageFormula);
  return ok;
}
