/**
 * Typed modifiers: which of an ability's imported `modifier` specs change a
 * number on the actor by themselves, and by how much.
 *
 * The importer materializes each ability's mechanics into
 * `flags["acks-extras"].extras.effects` (the shape `fields.mjs` `effectField`
 * declares). This file decides, per spec, what happens to it:
 *
 *   standing     written onto a core field by the equipment loadout effect
 *   gated        standing while a registered gate answers yes
 *   atRoll       scoped to a roll's context (a creature kind, an alignment,
 *                a tone, one save, an opponent's attack); listed, not applied
 *   situational  a free-text condition, or a gate nothing can decide; listed
 *   consumed     read by the feature that owns the roll (influence, the
 *                ability's own throws, henchmen, markets)
 *   unsupported  no field to write, or a mode that is not an addition
 *
 * It then resolves what the standing ones are worth on one actor and how they
 * meet: copies of one definition count once, valued at rank; abilities that
 * provide one capability, and pairs a spec names in `notStacksWith`, do not
 * stack, and the larger applies; a pair named in `stacksWith` adds whatever
 * else they share; everything else adds. An ability whose own enabled Active
 * Effect writes the field stands aside for that field.
 *
 * Characters only: a monster's stat line is the total its page prints.
 * Every number comes from the spec; this file ships the procedure and the
 * map from a target to the field it writes. Foundry-free.
 */
import { resolveLevelValue, scopeApplies, satisfies, abilitySlug } from "./vocab.mjs";
import { cookbookId } from "./library.mjs";
import { RELEASED_SAVE_KEYS } from "./actor-compat.mjs";

const FLAG_SCOPE = "acks-extras";

/**
 * The field each self-targeted modifier writes, by actor type. A list means
 * one spec writes every path in it (an attack throw bonus the page does not
 * narrow to melee or missile reaches both). `type` is the change type: a
 * saving throw is a target number, so a bonus to one lowers it.
 */
export const MODIFIER_PATHS = Object.freeze({
  character: Object.freeze({
    ac: [{ path: "system.ac.mod", type: "add" }],
    save: [{ path: "system.save.mod", type: "add" }],
    initiative: [{ path: "system.initiative.mod", type: "add" }],
    surprise: [{ path: "system.surprise.avoidsurprise", type: "add" }],
    cleaves: [{ path: "system.fight.cleaves", type: "add" }],
    attackThrow: [
      { path: "system.attack.mod.melee", type: "add", delivery: "melee" },
      { path: "system.attack.mod.missile", type: "add", delivery: "missile" },
    ],
    damage: [
      { path: "system.damage.mod.melee", type: "add", delivery: "melee" },
      { path: "system.damage.mod.missile", type: "add", delivery: "missile" },
    ],
  }),
});

/**
 * The field an opponent-targeted modifier writes on the character imposing
 * it. Core's surprise matrix adds the highest `surpriseothers` among a side's
 * opponents to each of their rolls, so a penalty the character imposes is
 * stored with its own sign.
 */
export const OPPONENT_PATHS = Object.freeze({
  character: Object.freeze({
    surprise: [{ path: "system.surprise.surpriseothers", type: "add" }],
  }),
});

/** Targets another feature reads off the spec itself, by the feature that reads it. */
export const CONSUMED_TARGETS = Object.freeze({
  reaction: "influence",
  morale: "influence",
  loyalty: "influence",
  proficiencyThrow: "abilities",
  marketClass: "henchmen",
  retainBonus: "henchmen",
  baseLoyalty: "henchmen",
  henchmanMorale: "henchmen",
  marketImpact: "markets",
});

/** Dispositions, as `modifierDisposition` names them. */
export const DISPOSITION = Object.freeze({
  STANDING: "standing",
  GATED: "gated",
  AT_ROLL: "atRoll",
  SITUATIONAL: "situational",
  CONSUMED: "consumed",
  UNSUPPORTED: "unsupported",
});

/* ---------------------------------------------------------------------- */
/*  Gates                                                                  */
/* ---------------------------------------------------------------------- */

const GATES = new Map();

/**
 * Register the evaluator for one gate kind. `evaluate(actor, gate, ctx)`
 * answers true (the spec applies now), false (it does not), or null (it
 * cannot decide: an argument the import did not read, a context it lacks).
 * A later registration of the same kind replaces the earlier one.
 */
export function registerGate(kind, evaluate) {
  if (!kind || typeof evaluate !== "function") return;
  GATES.set(String(kind), evaluate);
}

/** Whether a gate kind has an evaluator. */
export const hasGate = (kind) => GATES.has(String(kind ?? ""));

/**
 * One gate's verdict for one actor: true, false, or null when no evaluator is
 * registered for its kind or the evaluator could not decide or threw.
 */
export function gateVerdict(actor, gate, ctx = {}) {
  const evaluate = GATES.get(String(gate?.kind ?? ""));
  if (!evaluate) return null;
  try {
    const verdict = evaluate(actor, gate, ctx);
    return verdict === true || verdict === false ? verdict : null;
  } catch {
    return null;
  }
}

// A status gate needs nothing but the actor: whether it carries the status.
registerGate("status", (actor, gate) => {
  if (!gate.status) return null;
  const statuses = actor?.statuses;
  if (!statuses) return null;
  return typeof statuses.has === "function" ? statuses.has(gate.status) : [...statuses].includes(gate.status);
});

/* ---------------------------------------------------------------------- */
/*  One spec                                                               */
/* ---------------------------------------------------------------------- */

/**
 * A stable key for one spec, from its content rather than its position:
 * Update Abilities rewrites `extras.effects`, so an index names a different
 * spec after a re-import.
 */
export function specKey(spec) {
  const { from: _from, ...rest } = spec ?? {};
  const text = JSON.stringify(rest, Object.keys(rest).sort());
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  return `m${(h >>> 0).toString(36)}`;
}

/** A spec carries a gate when its `kind` is set. */
const gateOf = (spec) => (spec?.gate?.kind ? spec.gate : null);

/** The save a `forWhat` names, as the system's key, or null. */
function saveKeyOf(forWhat) {
  const s = String(forWhat ?? "").toLowerCase().replace(/[^a-z]/g, "");
  if (!s) return null;
  return RELEASED_SAVE_KEYS.find((k) => s === k || s === `${k}s` || s === `${k}es`) ?? null;
}

/**
 * The fields a spec writes on an actor of `actorType`: `[{path, type}]`,
 * empty when the target has no field there. A `forWhat` of "melee" or
 * "missile" narrows an attack or damage modifier to that path; any other
 * activity on one leaves it for the roll. A `forWhat` naming one saving throw
 * writes that throw's target instead of the all-save modifier.
 */
export function modifierPaths(spec, actorType) {
  const opponent = spec?.appliesTo === "opponent";
  const table = (opponent ? OPPONENT_PATHS : MODIFIER_PATHS)[actorType];
  const rows = table?.[spec?.target];
  if (!rows) return [];
  const forWhat = String(spec.forWhat ?? "").trim().toLowerCase();
  if (spec.target === "save" && forWhat) {
    const k = saveKeyOf(forWhat);
    return k ? [{ path: `system.saves.${k}.value`, type: "subtract" }] : [];
  }
  if (rows.some((r) => r.delivery) && forWhat) {
    const one = rows.filter((r) => r.delivery === forWhat);
    return one;
  }
  return rows.map(({ path, type }) => ({ path, type }));
}

/** True when a spec states a scope a roll must settle. */
function hasRollScope(spec) {
  return (spec.vsKinds?.length ?? 0) > 0 || !!spec.vsAlignment || (spec.tones?.length ?? 0) > 0;
}

/**
 * What happens to one spec on an actor of `actorType`, before any value is
 * resolved: `{kind, reason?, consumer?, paths}`. `kind` is a `DISPOSITION`
 * value; `reason` is a short machine word a surface localizes. Null for a
 * spec that is not a modifier.
 */
export function modifierDisposition(spec, { actorType = "character" } = {}) {
  if (spec?.type !== "modifier") return null;
  const paths = [];
  const out = (kind, extra = {}) => ({ kind, paths, ...extra });
  if (!MODIFIER_PATHS[actorType]) return out(DISPOSITION.UNSUPPORTED, { reason: "actorType" });
  const consumer = CONSUMED_TARGETS[spec.target];
  if (consumer) return out(DISPOSITION.CONSUMED, { consumer });
  if (spec.appliesToRoll) return out(DISPOSITION.CONSUMED, { consumer: "abilities" });
  if (spec.mode && spec.mode !== "add") return out(DISPOSITION.UNSUPPORTED, { reason: "mode" });
  if (spec.appliesTo && spec.appliesTo !== "self" && spec.appliesTo !== "opponent") {
    return out(DISPOSITION.UNSUPPORTED, { reason: "subject" });
  }
  if (hasRollScope(spec)) return out(DISPOSITION.AT_ROLL, { reason: "scope" });
  paths.push(...modifierPaths(spec, actorType));
  if (!paths.length) {
    // A target the actor has a field for, narrowed past it, waits on the roll;
    // a target with no field at all is not applied anywhere.
    const known = (spec.appliesTo === "opponent" ? OPPONENT_PATHS : MODIFIER_PATHS)[actorType]?.[spec.target];
    if (known) return out(DISPOSITION.AT_ROLL, { reason: "narrowed" });
    return out(spec.appliesTo === "opponent" ? DISPOSITION.AT_ROLL : DISPOSITION.UNSUPPORTED, {
      reason: spec.appliesTo === "opponent" ? "opponent" : "field",
    });
  }
  const gate = gateOf(spec);
  if (gate) {
    return hasGate(gate.kind) ? out(DISPOSITION.GATED, { gate }) : out(DISPOSITION.SITUATIONAL, { reason: "gate", gate });
  }
  if (spec.condition) return out(DISPOSITION.SITUATIONAL, { reason: "condition" });
  return out(DISPOSITION.STANDING);
}

/* ---------------------------------------------------------------------- */
/*  One actor                                                              */
/* ---------------------------------------------------------------------- */

const extrasOf = (item) => item?.getFlag?.(FLAG_SCOPE, "extras") ?? item?.flags?.[FLAG_SCOPE]?.extras ?? null;

/** The definition a copy is of: its import's id, else its name without a pick. */
const definitionKey = (item) => cookbookId(item) || `name:${abilitySlug(item)}`;

/**
 * Whether an ability's mechanics came from the prose scan rather than a
 * recipe: its import's `effectsFrom` stamp says "scan".
 */
export function isUnverified(item) {
  return (extrasOf(item) ?? {}).effectsFrom === "scan";
}

/** The paths an item's own enabled Active Effects write. */
function ownEffectPaths(item) {
  const out = new Set();
  for (const effect of [...(item?.effects ?? [])]) {
    if (effect?.disabled) continue;
    for (const change of effect.changes ?? []) if (change?.key) out.add(String(change.key));
  }
  return out;
}

/** The actor's level for a value ladder; 1 where it states none. */
function levelOf(actor) {
  const raw = Number(actor?.system?.details?.level ?? actor?.system?.level);
  return Number.isFinite(raw) && raw > 0 ? raw : 1;
}

/** The ability's rank on this actor: the abilities feature's count when live, else the copies and stated count. */
function rankFor(actor, item, copies) {
  const api = globalThis.acksExtras?.abilities;
  if (api?.rankOf) {
    try {
      const r = Number(api.rankOf(actor, item));
      if (Number.isFinite(r) && r >= 1) return r;
    } catch {
      /* fall through */
    }
  }
  const qty = Number(extrasOf(item)?.qty);
  return Math.max(copies, Number.isFinite(qty) && qty >= 1 ? qty : 1);
}

/** The default resolver: the classes feature's, which completes class progressions, else lib's. */
const defaultResolve = (value, level, scales) => (globalThis.acksExtras?.classes?.resolveLevelValue ?? resolveLevelValue)(value, level, scales);

/** A value as a finite number at `scales`, or null. */
function resolveValue(value, scales, resolve) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value == null) return null;
  let n = null;
  try {
    n = resolve(value, scales.level, scales);
  } catch {
    return null;
  }
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * One spec's value for the actor holding `item`, as `standingModifiers` values
 * it: at the actor's level and the ability's rank (the copies of its
 * definition the actor holds). Null when it does not resolve.
 *
 * @param {object} actor
 * @param {object} item the ability carrying the spec
 * @param {object} spec
 * @param {{resolve?: Function}} [options]
 * @returns {{value: number|null, level: number, rank: number}}
 */
export function modifierValue(actor, item, spec, { resolve = defaultResolve } = {}) {
  const key = definitionKey(item);
  const copies = [...(actor?.items ?? [])].filter((i) => i?.type === "ability" && definitionKey(i) === key).length || 1;
  const scales = { level: levelOf(actor), rank: rankFor(actor, item, copies) };
  return { value: resolveValue(spec?.value, scales, resolve), level: scales.level, rank: scales.rank };
}

/**
 * Whether two parts on one field stack. A pair either part names in
 * `stacksWith` adds. Otherwise two abilities that provide one capability do
 * not stack, nor does a pair either part names in `notStacksWith`.
 */
function conflicts(a, b) {
  const named = (part, refs) => (refs ?? []).some((ref) => satisfies([part.ref], ref));
  if (named(b, a.stacksWith) || named(a, b.stacksWith)) return false;
  if (named(b, a.notStacksWith) || named(a, b.notStacksWith)) return true;
  const capsA = new Set(a.caps);
  return b.caps.some((c) => capsA.has(c));
}

/** The capabilities an ability provides, its own id's included, folded. */
function capabilitiesOf(ref) {
  const out = [];
  if (ref.id) {
    const tail = String(ref.id).split(".").slice(2).join("").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (tail) out.push(`kw:${tail}`);
  }
  for (const p of ref.provides ?? []) out.push(String(p).toLowerCase());
  return out;
}

/**
 * The parts on one field that apply after stacking: the largest first, each
 * kept unless it conflicts with one already kept. Returns the kept parts in
 * their input order and the dropped ones, each carrying the part it yielded to.
 */
export function resolveStacking(parts) {
  const order = [...parts].sort((x, y) => y.value - x.value);
  const kept = [];
  const dropped = [];
  for (const part of order) {
    const over = kept.find((k) => conflicts(k, part));
    if (over) dropped.push({ ...part, yieldsTo: over.label });
    else kept.push(part);
  }
  return { kept: parts.filter((p) => kept.includes(p)), dropped };
}

/**
 * Every typed modifier an actor's abilities carry, resolved for this actor.
 *
 * `parts` are the contributions to write, after stacking and stand-aside:
 * `[{path, type, value, itemId, index, key, label, target, unverified,
 * gated}]`, in item and spec order. `listed` are the specs that carry a
 * number for a field this actor has and are not applied, each with its
 * `kind` and `reason` (a gate that answered no, a condition, a roll scope, a
 * value that did not resolve, a stand-aside, a larger peer), for a surface
 * that names what it leaves out.
 *
 * @param {object} actor
 * @param {{ctx?: object, resolve?: Function}} [options] `ctx` reaches every
 *   gate evaluator (the loadout, for one); `resolve(value, level, scales)`
 *   replaces the level-value resolver.
 */
export function standingModifiers(actor, { ctx = {}, resolve = defaultResolve } = {}) {
  const result = { parts: [], listed: [] };
  const actorType = actor?.type;
  if (!MODIFIER_PATHS[actorType] || !actor?.items) return result;
  const level = levelOf(actor);

  // Copies of one definition are one ability at a rank.
  const groups = new Map();
  for (const item of actor.items) {
    if (item?.type !== "ability") continue;
    const effects = extrasOf(item)?.effects;
    if (!Array.isArray(effects) || !effects.some((e) => e?.type === "modifier")) continue;
    const key = definitionKey(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  const candidates = [];
  for (const copies of groups.values()) {
    const item = copies[0];
    const extras = extrasOf(item) ?? {};
    const ref = { id: cookbookId(item) || null, provides: extras.provides ?? [] };
    const caps = capabilitiesOf(ref);
    const scales = { level, rank: rankFor(actor, item, copies.length) };
    const standAside = new Set(copies.flatMap((c) => [...ownEffectPaths(c)]));
    const unverified = isUnverified(item);
    const label = String(item.name ?? "");
    extras.effects.forEach((spec, index) => {
      const disposition = modifierDisposition(spec, { actorType });
      if (!disposition || !disposition.paths.length) {
        if (disposition && (disposition.kind === DISPOSITION.AT_ROLL || disposition.kind === DISPOSITION.SITUATIONAL)) {
          result.listed.push({ itemId: item.id, index, label, target: spec.target, kind: disposition.kind, reason: disposition.reason, unverified });
        }
        return;
      }
      const base = { itemId: item.id, index, key: specKey(spec), label, target: spec.target, unverified };
      const value = resolveValue(spec.value, scales, resolve);
      // A field an enabled effect of the ability's own writes is listed as stood
      // aside whatever else would list it: that effect, not this row, is what
      // the field carries, a started quick effect included.
      const listAll = (kind, reason) => {
        for (const p of disposition.paths) result.listed.push({ ...base, path: p.path, kind, reason: standAside.has(p.path) ? "standAside" : reason, value });
      };
      if (value === null || value === 0) return listAll(disposition.kind, "unresolved");
      if (disposition.kind === DISPOSITION.SITUATIONAL) return listAll(disposition.kind, disposition.reason);
      let gated = false;
      if (disposition.kind === DISPOSITION.GATED) {
        const verdict = gateVerdict(actor, disposition.gate, ctx);
        if (verdict === null) return listAll(DISPOSITION.SITUATIONAL, "gate");
        if (verdict === false) return listAll(disposition.kind, "gateOff");
        gated = true;
      }
      for (const p of disposition.paths) {
        if (standAside.has(p.path)) {
          result.listed.push({ ...base, path: p.path, kind: disposition.kind, reason: "standAside", value });
          continue;
        }
        candidates.push({ ...base, path: p.path, type: p.type, value, gated, ref, caps, stacksWith: spec.stacksWith ?? [], notStacksWith: spec.notStacksWith ?? [] });
      }
    });
  }

  // Stacking is decided per field, among the parts that reach it.
  const byPath = new Map();
  for (const c of candidates) {
    if (!byPath.has(c.path)) byPath.set(c.path, []);
    byPath.get(c.path).push(c);
  }
  const kept = new Set();
  for (const parts of byPath.values()) {
    const { kept: k, dropped } = resolveStacking(parts);
    for (const p of k) kept.add(p);
    for (const d of dropped) {
      result.listed.push({ itemId: d.itemId, index: d.index, key: d.key, label: d.label, target: d.target, path: d.path, kind: DISPOSITION.STANDING, reason: "notStacking", value: d.value, yieldsTo: d.yieldsTo, unverified: d.unverified });
    }
  }
  for (const c of candidates) {
    if (!kept.has(c)) continue;
    const { ref: _r, caps: _c, stacksWith: _s, notStacksWith: _n, ...part } = c;
    result.parts.push(part);
  }
  return result;
}
