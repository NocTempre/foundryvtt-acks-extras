/* global game, CONFIG, Hooks, libWrapper, ChatMessage */
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
 * feature's per-weapon modifiers, and whatever else a feature registers. A
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
 *
 * A spell's damage rides the same pipeline as a fourth kind of attack,
 * `MAGIC_ATTACK_TYPE`, through a CARRIER: an unsaved weapon parented to the
 * caster, known by identity (`isSpellCarrier`), never by a flag. For a carrier
 * the weapon questions answer the one kind, the attack throw is built from
 * the row's delivery kind while the context keeps the kind `magic`, and the
 * damage starts from nothing but the carrier's own formula and the rows a
 * caller passed. A contributor sees a carrier's attack or damage only where
 * it declared `carriers` for that question. See docs/lib/DECISIONS.md, "A
 * spell's damage is a fourth attack type on a carrier".
 */
import { MODULE_ID } from "../constants.mjs";
import { DAMAGE_TYPES, ITEM_TYPE } from "../vocab.mjs";

/** The attack kind a spell's damage is made under. Core has three; this is the fourth, registered by this seam. */
export const MAGIC_ATTACK_TYPE = "magic";

/** The key under `flags[MODULE_ID]` that marks an attack card a spell's cast already owns. */
export const MAGIC_ATTACK_FLAG = "magicAttack";

/** The core damage mode the carrier's formula is read in. */
const BASE_MODE = "base";

/** Where core's translations keep the label of an attack kind, by path. */
const TYPE_LABEL_PATH = `ACKS.throw.attackType.${MAGIC_ATTACK_TYPE}`;

/**
 * Fired as an attack begins, with `(actor, ctx)`, before the system builds the
 * throw. `ctx.terms` and `ctx.damageTerms` are mutable lists of `{label,
 * value}` rows added to the attack throw and the damage roll whatever the
 * attack's kind turns out to be; `ctx.item`, `ctx.target` and `ctx.options`
 * are what the attack was asked with and `ctx.token` is the attacker's token. A contributor that needs the attack's
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
 *   ready()                                 → a promise the attack waits for before
 *                                              it is built: what the contributor
 *                                              answers from must have loaded
 *   carriers: ["attack"|"damage"]           → the questions it answers for a spell
 *                                              carrier's attack; absent, it is
 *                                              never asked for one
 *
 * Each receives the list so far and returns the list to go on with, so a
 * contributor may add rows, drop rows, or reorder. A row is `{label, value}`,
 * `value` a number or a signed formula fragment, as the system's own are.
 * For a carrier's attack, `attackType` is the DELIVERY kind (`melee` or
 * `missile`), and `ctx.type` stays `magic`.
 */
const contributors = [];

/** Register a contributor; the same object is registered once. */
export function addAttackContributor(contributor) {
  if (contributor && typeof contributor === "object" && !contributors.includes(contributor)) contributors.push(contributor);
}

/**
 * Run one question through every contributor that answers it. A contributor
 * that throws is skipped for that question. `carried` names the question of a
 * spell carrier's attack being answered; only a contributor that listed it in
 * `carriers` is asked.
 */
function ask(question, args, initial, carried = null) {
  let out = initial;
  for (const c of contributors) {
    if (typeof c[question] !== "function") continue;
    if (carried && !(Array.isArray(c.carriers) && c.carriers.includes(carried))) continue;
    try {
      const next = c[question](...args, out);
      if (Array.isArray(next) || typeof next === "string") out = next;
    } catch (err) {
      console.error(`${MODULE_ID} | an attack contributor failed on ${question}; its answer is left out`, err);
    }
  }
  return out;
}

/**
 * Resolves once every contributor that declares `ready()` says it can answer.
 * A contributor whose wait throws is reported and no longer holds the attack.
 */
async function contributorsReady() {
  await Promise.all(
    contributors.map(async (c) => {
      if (typeof c.ready !== "function") return;
      try {
        await c.ready();
      } catch (err) {
        console.error(`${MODULE_ID} | an attack contributor failed to get ready; the attack does not wait for it`, err);
      }
    }),
  );
}

/** `{label, value}` rows from a hook's term list, dropping what carries no number or formula. */
const rows = (terms) =>
  (terms ?? [])
    .filter((t) => t && (typeof t.value === "number" ? Number.isFinite(t.value) : typeof t.value === "string" && t.value.trim()))
    .map((t) => ({ label: String(t.label ?? ""), value: t.value }));

/* -------------------------------------------- */
/*  Spell carriers                               */
/* -------------------------------------------- */

/**
 * The spell carriers made, by item. Membership is the whole of "is a carrier":
 * a flag survives a copy or a drag, and a real weapon answering as a carrier
 * would lose the rows its own features add.
 */
const carriers = new WeakMap();

/** The delivery kinds a carrier can be thrown as; anything else is read as the first. */
const DELIVERY_KINDS = ["melee", "missile"];
const deliveryKind = (delivery) => (DELIVERY_KINDS.includes(delivery) ? delivery : DELIVERY_KINDS[0]);

/** The core damage-type key for a row's own (`varies` is the system's `variesByWeapon`); unknown keys are dropped. */
const coreDamageTypes = (types) =>
  [...new Set(Array.from(types ?? []).filter((t) => typeof t === "string" && DAMAGE_TYPES[t]).map((t) => (t === "varies" ? "variesByWeapon" : t)))];

/**
 * The creation data of a spell's carrier: a weapon named and drawn as the
 * spell, a melee or missile weapon by the row's delivery, and a base damage
 * that is the row's own formula, damage types and extraordinary mark. The
 * formula is always written, blank for a row with none.
 *
 * @param {object} row  a spell's effect row
 * @param {{spell?: {name?: string, img?: string}, delivery?: string}} [from]
 */
export function carrierData(row, { spell = null, delivery = null } = {}) {
  const kind = deliveryKind(delivery ?? row?.delivery);
  return {
    name: spell?.name ?? "",
    img: spell?.img,
    type: ITEM_TYPE.weapon,
    system: {
      melee: kind === "melee",
      missile: kind === "missile",
      damage: {
        base: {
          formula: typeof row?.roll === "string" ? row.roll : "",
          types: coreDamageTypes(row?.damage),
          extraordinary: row?.extraordinary === true,
        },
      },
    },
  };
}

/**
 * Build a spell's carrier: an unsaved weapon parented to the caster, recorded
 * by identity. `cast` is `{spell, castId, rowKey, delivery}`; the delivery
 * defaults to the row's.
 *
 * @param {Actor} actor  the caster
 * @param {object} row  the effect row being rolled
 * @param {{spell?: Item, spellUuid?: string, castId?: string, rowKey?: string, delivery?: string}} [cast]
 * @returns {Item}
 */
export function spellCarrier(actor, row, cast = {}) {
  const delivery = deliveryKind(cast.delivery ?? row?.delivery);
  const item = new CONFIG.Item.documentClass(carrierData(row, { spell: cast.spell, delivery }), { parent: actor });
  carriers.set(
    item,
    Object.freeze({
      castId: cast.castId ?? null,
      rowKey: cast.rowKey ?? row?.key ?? "",
      spellUuid: cast.spell?.uuid ?? cast.spellUuid ?? null,
      delivery,
      row: { ...row },
    }),
  );
  return item;
}

/** Whether `item` is a carrier `spellCarrier` made, by identity. */
export const isSpellCarrier = (item) => carriers.has(item);

/** What a carrier was made for, `{castId, rowKey, spellUuid, delivery, row}`, or null for anything else. */
export const carrierOf = (item) => carriers.get(item) ?? null;

/** The carrier a context's attack of this kind is made with, or null: only the `magic` kind of a carrier. */
const carrierAttack = (ctx, attackType) => (attackType === MAGIC_ATTACK_TYPE && ctx?.item ? carrierOf(ctx.item) : null);

/**
 * The attack throw's modifiers for an attacker's data model: the system's
 * own, then every contributor's, then the rows the pre-attack hook placed.
 * With no attack in flight the system's answer stands. For a spell carrier
 * `base` is the system's answer for the DELIVERY kind, the contributors that
 * opted in are asked with that kind, and `ctx.type` stays `magic`.
 *
 * @param {object} system  the attacker's data model (`this` in `getAttackThrowModifiers`)
 * @param {string} attackType
 * @param {Array<{label: string, value: number|string}>} base  the model's own rows
 */
export function attackThrowModifiersFor(system, attackType, base) {
  const ctx = attackInFlight(system?.parent);
  if (!ctx) return base;
  const carrier = carrierAttack(ctx, attackType);
  if (carrier) return [...ask("attack", [ctx, carrier.delivery], [...(base ?? [])], "attack"), ...rows(ctx.terms)];
  ctx.type = attackType;
  return [...ask("attack", [ctx, attackType], [...(base ?? [])]), ...rows(ctx.terms)];
}

/**
 * The damage roll's modifiers for an attacker's data model; see
 * `attackThrowModifiersFor`. A spell carrier's damage starts from nothing: the
 * system's answer for the `magic` kind is left out, the contributors that
 * opted in are asked, and the rows a caller passed follow.
 */
export function damageModifiersFor(system, attackType, base) {
  const ctx = attackInFlight(system?.parent);
  if (!ctx) return base;
  if (carrierAttack(ctx, attackType)) return [...ask("damage", [ctx, attackType], [], "damage"), ...rows(ctx.damageTerms)];
  return [...ask("damage", [ctx, attackType], [...(base ?? [])]), ...rows(ctx.damageTerms)];
}

/**
 * A base list and labelled modifiers as one formula, as the system's own
 * modified formula writes it: each value carries an explicit sign, a
 * zero-valued one is left out, and the parts are joined by spaces
 * (`1d4 + 2 - 1`).
 *
 * @param {string} base  a dice formula
 * @param {Array<{label: string, value: number|string|null}>} modifiers
 * @returns {{formula: string, modifiers: Array<{label: string, value: string}>}}
 */
export function modifiedFormula(base, modifiers = []) {
  const effective = [];
  for (const { label, value } of modifiers ?? []) {
    const signed = signedValue(value);
    if (signed && Number(signed) !== 0) effective.push({ label, value: signed });
  }
  const parts = [base];
  for (const { value } of effective) parts.push(value.charAt(0), value.slice(1).trim());
  return { formula: parts.join(" "), modifiers: effective };
}

/** A modifier value as text with an explicit sign, or "" when it is empty. */
function signedValue(value) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return value < 0 ? `${value}` : `+${value}`;
  const text = `${value}`.trim();
  if (!text) return "";
  return text.startsWith("+") || text.startsWith("-") ? text : `+${text}`;
}

/**
 * The damage roll a carrier would make with no attack throw, in the shape
 * the system's builder gives a roll (`{formula, data, modifiers, types,
 * extraordinary}`), or null when the carrier has no formula. It asks the
 * same two questions the builder asks, `getDamageModifiers("magic")` on the
 * caster and `getDamageModifiers()` on the carrier, with an attack context
 * held around them and no target in it, so a contributor that opted in answers
 * as it would inside a throw. No damage floor applies: the printed floor is
 * an attack's.
 *
 * @param {Actor} actor  the caster
 * @param {Item} carrier  a carrier `spellCarrier` made
 * @param {{terms?: Array<{label: string, value: number|string}>}} [extra]  damage rows from the caller
 */
export async function magicDamageSpec(actor, carrier, { terms = [] } = {}) {
  if (!actor || !isSpellCarrier(carrier)) return null;
  const formula = String(carrier.system?.getDamageFormula?.(BASE_MODE) ?? "").trim();
  if (!formula) return null;
  await contributorsReady();
  const ctx = attackContext(actor, { item: carrier, attackType: MAGIC_ATTACK_TYPE, acksLib: { damageTerms: terms } });
  // A no-throw damage has nobody it is thrown at; the conditions' reading of a target is not asked.
  ctx.target = null;
  ctx.targetActor = null;
  ctx.targetName = null;
  ctx.conditionsTold = true;
  const prior = inFlight.get(actor) ?? null;
  inFlight.set(actor, ctx);
  let modifiers;
  try {
    modifiers = [...(actor.system?.getDamageModifiers?.(MAGIC_ATTACK_TYPE) ?? []), ...(carrier.system?.getDamageModifiers?.() ?? [])];
  } finally {
    if (prior) inFlight.set(actor, prior);
    else inFlight.delete(actor);
  }
  const base = carrier.system?.damage?.base;
  const made = modifiedFormula(formula, modifiers);
  return {
    formula: made.formula,
    data: actor.getRollData?.() ?? {},
    modifiers: made.modifiers,
    types: Array.from(base?.types ?? []),
    extraordinary: base?.extraordinary === true,
  };
}

/* -------------------------------------------- */
/*  The attack card a cast owns                  */
/* -------------------------------------------- */

/** The carrier attacks in flight, by the attacker's uuid: `{castId, rowKey, spellUuid}`. */
const carrierInFlight = new Map();

/**
 * Whether a chat message about to be created is the attack card of a carrier
 * attack in flight: the speaker's actor has one, and the content is the
 * system's attack card. Pure over what it is given.
 *
 * @param {{actorUuid?: string|null, content?: string}} data  the speaker's actor and the message's content
 * @param {Map<string, {castId: string|null, rowKey: string, spellUuid: string|null}>} byUuid
 * @returns {{castId: string|null, rowKey: string, spellUuid: string|null}|null}
 */
export function carrierCardMatch({ actorUuid = null, content = "" } = {}, byUuid = carrierInFlight) {
  if (!actorUuid || typeof content !== "string" || !content.includes("attack-throw-card")) return null;
  return byUuid.get(actorUuid) ?? null;
}

/**
 * An attack card's markup without its apply-damage button, and without the
 * button group that button leaves empty. The system's chat handler would write
 * raw hit points from it, outside the one amount path of the cast.
 */
export function stripApplyDamage(html) {
  return String(html ?? "")
    .replace(/<button\b[^>]*data-action="applyDamage"[^>]*>[\s\S]*?<\/button>/g, "")
    .replace(/<div\b[^>]*class="[^"]*\bcard-buttons\b[^"]*"[^>]*>\s*<\/div>/g, "");
}

/** Before a message is stored: the card of a carrier attack in flight loses its Apply and is marked. */
function onPreCreateMessage(message) {
  try {
    const actor = ChatMessage.getSpeakerActor(message?.speaker);
    const info = carrierCardMatch({ actorUuid: actor?.uuid ?? null, content: message?.content }, carrierInFlight);
    if (!info) return;
    message.updateSource({
      content: stripApplyDamage(message.content),
      [`flags.${MODULE_ID}.${MAGIC_ATTACK_FLAG}`]: { ...info },
    });
  } catch (err) {
    console.error(`${MODULE_ID} | a spell's attack card could not be marked; it keeps its apply button`, err);
  }
}

/**
 * Write core's label for the `magic` kind into the translations at core's own
 * key, unless the system already has one. The dialog and the card read it by
 * that key.
 */
function writeMagicLabel() {
  const i18n = game.i18n;
  if (!i18n?.translations || i18n.has?.(TYPE_LABEL_PATH)) return;
  const keys = TYPE_LABEL_PATH.split(".");
  let node = i18n.translations;
  for (const key of keys.slice(0, -1)) {
    if (node[key] === undefined) node[key] = {};
    if (node[key] === null || typeof node[key] !== "object") return;
    node = node[key];
  }
  node[keys.at(-1)] = i18n.localize("ACKS-LIB.attack.type.magic");
}

/**
 * The token an actor acts through: the one the actor is the synthetic actor of,
 * else its first of its active tokens on the scene in view (`getActiveTokens`
 * reads the canvas's own), else null. A sheet rolling for a world actor names no
 * token, so the scene's own is the best answer there is. The one reader of that
 * token: an attack's context and a cast's caster both ask it.
 */
export function actorToken(actor) {
  if (actor?.token) return actor.token;
  try {
    return actor?.getActiveTokens?.()?.[0]?.document ?? null;
  } catch {
    return null;
  }
}

/**
 * The context one attack carries. Built once per `makeAttackThrow` and handed
 * to every hook and contributor for that attack. `token` is the attacker's
 * TokenDocument, or null where none can be found.
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
    token: actorToken(actor),
    item,
    weapon: item?.type === ITEM_TYPE.weapon ? item : null,
    target,
    targetActor: target?.actor ?? null,
    targetName: target?.name ?? null,
    type: options.attackType ?? (isSpellCarrier(item) ? MAGIC_ATTACK_TYPE : null),
    options,
    terms: rows(own.terms),
    damageTerms: rows(own.damageTerms),
    damageMode: own.damageMode ?? null,
    maneuver: own.maneuver ?? null,
  };
}

/**
 * MIXED wrapper around `AcksActor#makeAttackThrow`: refuses an attacker whose
 * attack throw is no number and rolls nothing; otherwise waits for the
 * contributors, holds the context and fires the hooks.
 */
async function onMakeAttackThrow(wrapped, options = {}) {
  const throwValue = this.system?.attack?.throw;
  if (typeof throwValue !== "number" || !Number.isFinite(throwValue)) {
    globalThis.ui?.notifications?.warn(game.i18n.format("ACKS-LIB.attack.noThrow", { name: this.name }));
    return null;
  }
  await contributorsReady();
  const ctx = attackContext(this, options);
  try {
    Hooks.callAll(PRE_ATTACK_HOOK, this, ctx);
  } catch (err) {
    console.error(`${MODULE_ID} | a pre-attack listener failed; the attack rolls without it`, err);
  }
  const prior = inFlight.get(this) ?? null;
  inFlight.set(this, ctx);
  // A carrier's attack is marked for the card it will post (`onPreCreateMessage`).
  const carried = carrierOf(ctx.item);
  const priorCarried = carried ? (carrierInFlight.get(this.uuid) ?? null) : null;
  if (carried) carrierInFlight.set(this.uuid, { castId: carried.castId, rowKey: carried.rowKey, spellUuid: carried.spellUuid });
  let outcome = null;
  try {
    outcome = await wrapped({ ...options, item: ctx.item, attackType: ctx.type ?? undefined });
  } finally {
    if (inFlight.get(this) === ctx) {
      if (prior) inFlight.set(this, prior);
      else inFlight.delete(this);
    }
    if (carried) {
      if (priorCarried) carrierInFlight.set(this.uuid, priorCarried);
      else carrierInFlight.delete(this.uuid);
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

/**
 * WRAPPER around a system actor model's `getAttackThrowModifiers`. A spell
 * carrier's attack is built from the system's rows for its delivery kind.
 */
function onActorAttackModifiers(wrapped, attackType) {
  const delivery = carrierAttack(attackInFlight(this?.parent), attackType)?.delivery ?? attackType;
  return attackThrowModifiersFor(this, attackType, wrapped(delivery) ?? []);
}

/** WRAPPER around a system actor model's `getDamageModifiers`. */
function onActorDamageModifiers(wrapped, attackType) {
  return damageModifiersFor(this, attackType, wrapped(attackType) ?? []);
}

/** WRAPPER around the weapon model's `getAttackTypes`; a carrier answers the one kind. */
function onWeaponAttackTypes(wrapped) {
  const own = wrapped() ?? [];
  if (isSpellCarrier(this.parent)) return [MAGIC_ATTACK_TYPE];
  return ask("attackTypes", [this.parent], [...own]);
}

/** WRAPPER around the weapon model's `getDamageModes`; a carrier keeps the system's answer. */
function onWeaponDamageModes(wrapped, attackType) {
  const own = [...(wrapped(attackType) ?? [])];
  return isSpellCarrier(this.parent) ? own : ask("damageModes", [this.parent, attackType], own);
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
  const own = wrapped(mode) ?? "";
  const formula = isSpellCarrier(this.parent) ? own : ask("damageFormula", [this.parent, mode], own);
  if (typeof formula !== "string" || !formula.trim() || globalThis.Roll?.validate?.(formula) !== false) return formula;
  const item = this.parent;
  const key = `${item?.uuid}|${formula}`;
  if (!reportedDamage.has(key)) {
    reportedDamage.add(key);
    globalThis.ui?.notifications?.warn(game.i18n.format("ACKS-LIB.attack.badDamage", { item: item?.name ?? "", formula }));
  }
  return "";
}

/** Register one wrapper, naming what is lost when the target is absent; a wrapper that may skip `wrapped` is `"MIXED"`. */
function wrap(path, wrapper, type = "WRAPPER") {
  try {
    const target = path.split(".").reduce((o, k) => o?.[k], globalThis);
    if (typeof target !== "function") {
      console.warn(`${MODULE_ID} | ${path} not found; the attack seam does not reach it.`);
      return false;
    }
    libWrapper.register(MODULE_ID, path, wrapper, type);
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
  const ok = wrap("CONFIG.Actor.documentClass.prototype.makeAttackThrow", onMakeAttackThrow, "MIXED");
  for (const type of Object.keys(CONFIG.Actor.dataModels ?? {})) {
    if (type.includes(".")) continue; // a module sub-type answers for itself
    wrap(`CONFIG.Actor.dataModels.${type}.prototype.getAttackThrowModifiers`, onActorAttackModifiers);
    wrap(`CONFIG.Actor.dataModels.${type}.prototype.getDamageModifiers`, onActorDamageModifiers);
  }
  wrap(`CONFIG.Item.dataModels.${ITEM_TYPE.weapon}.prototype.getAttackTypes`, onWeaponAttackTypes);
  wrap(`CONFIG.Item.dataModels.${ITEM_TYPE.weapon}.prototype.getDamageModes`, onWeaponDamageModes);
  wrap(`CONFIG.Item.dataModels.${ITEM_TYPE.weapon}.prototype.getDamageFormula`, onWeaponDamageFormula);
  // The card of a carrier's attack loses its Apply before it is stored, and core gets a label for the kind.
  globalThis.Hooks?.on?.("preCreateChatMessage", onPreCreateMessage);
  writeMagicLabel();
  return ok;
}
