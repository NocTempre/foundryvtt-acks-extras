/**
 * The cast's per-tradition procedure seam. A tradition kind registers one
 * procedure, and a cast of a spell cast under that kind runs it at fixed points
 * of the cast: the fields and the band the dialog draws, the verdicts it adds
 * to the plan, the casting time it reads, a `perform` step that runs after the
 * cast has its id and before its first row, a `lost` step when a declaration of
 * it is lost, and a `revert` the Judge presses on the card. FOUNDRY-FREE.
 *
 * Every member is optional, and a kind registers only the ones it needs:
 *
 * - `fields(ctx, answer)`: field specs (`lib/field-spec.mjs`) the dialog draws
 *   in its Invocation band; a spec's answer is read back under its `key`.
 * - `band(ctx, answer)`: `{template, context}`, a partial and its context, for a
 *   band no field spec can say. A control in it named `procedure.<key>` is read
 *   back under `<key>` of the procedure's answer.
 * - `verdicts(ctx, answer)`: `[{key, notice}]`, findings with the text a seat
 *   reads; the plan (`castVerdicts`) gives each its severity.
 * - `castingTime(ctx, answer)`: a casting time as the spell's flag holds one
 *   (`{shape, value, unit}`), or nothing to leave the spell's own.
 * - `perform(ctx, answer)`: `{proceed, section, rolls, undo}`.
 * - `lost(ctx, declaration)` and `revert(ctx, undo)`.
 * - `buckets(ctx)`: `[{key, policy, initial}]`, the inventory buckets the cast
 *   asks for; the answer carries them as `buckets`.
 *
 * The procedure's answer is one plain object: the field values and the band's
 * controls by key, with the reserved key `buckets` holding `{bucketKey: [{uuid,
 * qty, fit}]}`. A `ctx` is `{actor, spell, tradition, classItem, invocationLevel,
 * casterLevel, isGM, moment, combat, source, roll, now}`; a ctx whose `source` is
 * not `spell` is never given a procedure.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { traditionFor } from "./cast-capacity.mjs";
import { usableSpecs, coerceData } from "../lib/field-spec.mjs";

/** The members a procedure may carry. */
export const PROCEDURE_MEMBERS = Object.freeze(["fields", "band", "verdicts", "castingTime", "perform", "lost", "revert", "buckets"]);

/** The source a ctx has where it names none. */
const SPELL_SOURCE = "spell";

/** The registered procedures by tradition kind. */
const registry = new Map();

/** The casts whose `lost` has run on this client. */
const lostRan = new Set();

/** Run a member of a procedure; a throw is logged and answers `fallback`, so a faulty procedure never takes the dialog down. */
function guard(member, fn, fallback) {
  try {
    return fn();
  } catch (err) {
    console.error(`${MODULE_ID} | a cast procedure's ${member} threw`, err);
    return fallback;
  }
}

/**
 * Register the procedure of a tradition kind. One procedure stands per kind: a
 * second registration of the kind replaces the first, and the first's handle then
 * does nothing.
 *
 * @param {string} kind  a casting tradition's kind
 * @param {object} procedure  see the file header
 * @returns {() => void} removes this registration
 */
export function registerCastProcedure(kind, procedure) {
  const key = String(kind ?? "").trim();
  if (!key) throw new TypeError("registerCastProcedure: a tradition kind is required");
  if (!procedure || typeof procedure !== "object") throw new TypeError(`registerCastProcedure(${key}): a procedure object is required`);
  for (const member of PROCEDURE_MEMBERS) {
    if (procedure[member] !== undefined && typeof procedure[member] !== "function") throw new TypeError(`registerCastProcedure(${key}): ${member} must be a function`);
  }
  const own = Object.freeze({ ...procedure });
  registry.set(key, own);
  return () => {
    if (registry.get(key) === own) registry.delete(key);
  };
}

/** The procedure registered for a kind, or null. */
export const procedureOfKind = (kind) => registry.get(String(kind ?? "")) ?? null;

/**
 * The procedure a cast runs: the one registered for its tradition's kind, or
 * null where there is none or the ctx's source is not a spell.
 * @param {{source?: string, tradition?: {kind?: string}|null}} ctx
 */
export function procedureFor(ctx) {
  if ((ctx?.source ?? SPELL_SOURCE) !== SPELL_SOURCE) return null;
  return procedureOfKind(ctx?.tradition?.kind);
}

/**
 * The kind of the registered procedure a spell's tradition has, or null. The
 * claimants read it synchronously: `classFor(actor)` is the class item of the
 * spell's holder (the classes feature's `classForActor`, injected), and the
 * tradition is the one that cast the spell (`traditionFor`).
 *
 * @param {object} item  a spell item
 * @param {((actor: object) => object|null)|null} classFor
 * @returns {string|null}
 */
export function spellProcedureKind(item, classFor) {
  if (!registry.size || typeof classFor !== "function" || !item?.parent) return null;
  return guard("claim", () => {
    const classItem = classFor(item.parent) ?? null;
    const extras = item.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {};
    const found = traditionFor(classItem?.system?.casting, { extras, lvl: item.system?.lvl, class: item.system?.class });
    const kind = found?.tradition?.kind;
    return kind && registry.has(kind) ? kind : null;
  }, null);
}

/**
 * Where the procedure holds one entry of an answer's `buckets`: normalized to
 * `{bucketKey: [{uuid, qty, fit}]}` with an entry that names no document dropped.
 * @param {*} raw
 */
export function normalizeBuckets(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, list] of Object.entries(raw)) {
    if (!Array.isArray(list)) continue;
    out[key] = list
      .filter((e) => e && typeof e.uuid === "string" && e.uuid)
      .map((e) => ({ uuid: e.uuid, qty: Number(e.qty) > 0 ? Number(e.qty) : 1, fit: String(e.fit ?? "") }));
  }
  return out;
}

/** Every document uuid an answer's buckets name, once each. */
export const bucketUuids = (answer) => [...new Set(Object.values(normalizeBuckets(answer?.buckets)).flat().map((e) => e.uuid))];

/**
 * A procedure answer as a declaration stores it: plain data, with the buckets
 * normalized; null where there is none.
 * @param {*} v
 * @returns {object|null}
 */
export function storedProcedure(v) {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const plain = JSON.parse(JSON.stringify(v));
  if ("buckets" in plain) plain.buckets = normalizeBuckets(plain.buckets);
  return plain;
}

/**
 * What the dialog draws of a procedure for one answer: the field specs the
 * procedure offers, the answer coerced to them (a key the specs do not mention is
 * kept, so a band's controls and the buckets survive), and the band.
 *
 * @param {object|null} procedure
 * @param {object} ctx
 * @param {object} [raw]  the answer as the seat holds it
 * @returns {{specs: object[], answer: object, band: {template: string, context: object}|null}|null} null where there is no procedure
 */
export function procedureView(procedure, ctx, raw = {}) {
  if (!procedure) return null;
  const held = raw && typeof raw === "object" ? raw : {};
  const specs = procedure.fields ? usableSpecs(guard("fields", () => procedure.fields(ctx, held), [])).fields : [];
  const answer = coerceData(specs, held);
  const made = procedure.band ? guard("band", () => procedure.band(ctx, answer), null) : null;
  const band = made && typeof made.template === "string" && made.template ? { template: made.template, context: made.context ?? {} } : null;
  return { specs, answer, band };
}

/**
 * The findings a procedure adds to a cast, as `{key, notice}`; the plan gives
 * each its severity.
 * @returns {Array<{key: string, notice: string}>}
 */
export function procedureVerdicts(procedure, ctx, answer) {
  if (!procedure?.verdicts) return [];
  const found = guard("verdicts", () => procedure.verdicts(ctx, answer), []);
  return (Array.isArray(found) ? found : []).filter((v) => v && typeof v.key === "string" && v.key).map((v) => ({ key: v.key, notice: String(v.notice ?? "") }));
}

/** The casting time of a cast: the procedure's, else `own`, the spell's. */
export function procedureTime(procedure, ctx, answer, own = null) {
  const time = procedure?.castingTime ? guard("castingTime", () => procedure.castingTime(ctx, answer), null) : null;
  return time && typeof time === "object" ? time : own;
}

/**
 * Run the procedure's `perform`. `proceed` is false where it says so and where it
 * throws; a throw leaves no section, and says so as `failed`.
 *
 * @returns {Promise<{proceed: boolean, section: object|null, rolls: object[], undo: *, failed: boolean}>}
 */
export async function runPerform(procedure, ctx, answer) {
  if (!procedure?.perform) return { proceed: true, section: null, rolls: [], undo: null, failed: false };
  try {
    const out = (await procedure.perform(ctx, answer)) ?? {};
    return {
      proceed: out.proceed !== false,
      section: out.section && typeof out.section === "object" && Array.isArray(out.section.rows) ? out.section : null,
      rolls: Array.isArray(out.rolls) ? out.rolls : [],
      undo: out.undo ?? null,
      failed: false,
    };
  } catch (err) {
    console.error(`${MODULE_ID} | a cast procedure's perform threw`, err);
    return { proceed: false, section: null, rolls: [], undo: null, failed: true };
  }
}

/**
 * The Judge's revert of a performed step. Only a Judge reverts, only a card that
 * carries undo data, and only once.
 *
 * @param {{procedure?: {kind: string, undo: *, reverted?: boolean}}} card
 * @param {object} ctx  carries `isGM`
 * @returns {Promise<{ok: boolean, reason?: "notGM"|"nothing"|"noRevert"|"threw"}>}
 */
export async function runRevert(card, ctx) {
  const done = card?.procedure;
  if (ctx?.isGM !== true) return { ok: false, reason: "notGM" };
  if (!done || done.undo === null || done.undo === undefined || done.reverted === true) return { ok: false, reason: "nothing" };
  const procedure = procedureOfKind(done.kind);
  if (!procedure?.revert) return { ok: false, reason: "noRevert" };
  try {
    await procedure.revert({ ...ctx, source: SPELL_SOURCE }, done.undo);
    return { ok: true };
  } catch (err) {
    console.error(`${MODULE_ID} | a cast procedure's revert threw`, err);
    return { ok: false, reason: "threw" };
  }
}

/**
 * Run the procedure's `lost` for a declaration that was lost, once for each cast
 * on this client. The kind comes from the declaration's own record.
 *
 * @param {{castId: string, pending?: {procedureKind?: string|null}}} declaration  a pending record as `spellEffectOf` reads it
 * @param {object} ctx
 * @returns {Promise<boolean>} whether it ran
 */
export async function runLost(declaration, ctx) {
  const castId = declaration?.castId;
  const procedure = procedureOfKind(declaration?.pending?.procedureKind);
  if (!castId || !procedure?.lost || lostRan.has(castId)) return false;
  lostRan.add(castId);
  try {
    await procedure.lost({ ...ctx, source: SPELL_SOURCE }, declaration);
  } catch (err) {
    console.error(`${MODULE_ID} | a cast procedure's lost threw`, err);
  }
  return true;
}
