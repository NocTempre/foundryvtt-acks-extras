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
 *   asks for; the answer carries them as `buckets`. `initial` is the list a bucket
 *   opens holding (`[{uuid, qty?, fit?}]`) until the seat changes it. A `policy`
 *   is lib's (`lib/bucket.mjs`), with these members of the cast's own, each over
 *   the held rows `[{uuid, qty, fit, doc}]` (`doc` the document the uuid names,
 *   read synchronously through `ctx.resolve`): `pick: "one"` makes the rows radios
 *   and the pick rides the answer as `picked[key]`; `opens(rows, ctx)` is the uuid
 *   the pick opens on; `usable(row, ctx)` says whether a row may be the pick;
 *   `rowView(entry, row)` is a row's caption, diamonds, dimming and reason;
 *   `verdicts(rows, picked, ctx)` are `[{key, notice}]` findings the plan ranks;
 *   `legend`, `icon`, `dropText` and `emptyText` word the bucket, already localized.
 * - `label`: a lang key, owned by the tradition, that names the band's heading
 *   ("Invocation" and its kin); a string, not a function. Without one the
 *   heading is the tradition's own label (`procedureHeading`).
 *
 * The procedure's answer is one plain object: the field values and the band's
 * controls by key, with the reserved key `buckets` holding `{bucketKey: [{uuid,
 * qty, fit}]}` and the reserved key `picked` holding `{bucketKey: uuid}` for each
 * `pick: "one"` bucket. A bucket's entry exists only by a drag of a real document
 * (lib's `bucket.entryFromDrop`): no control and no field writes `buckets`, so
 * a typed or free-text entry has no path in. A `ctx` is `{actor, spell,
 * tradition, classItem, invocationLevel, casterLevel, moment, combat,
 * source, roll, now, resolve}` (`resolve(uuid)` reads a document synchronously); a ctx whose `source` is not `spell` is never given a
 * procedure.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { traditionFor } from "./cast-capacity.mjs";
import { usableSpecs, coerceData } from "../lib/field-spec.mjs";

/** The members a procedure may carry. */
export const PROCEDURE_MEMBERS = Object.freeze(["fields", "band", "verdicts", "castingTime", "perform", "lost", "revert", "buckets"]);

/** The answer's reserved key for the inventory buckets; no field spec and no control named `procedure.<key>` may take it. */
export const BUCKETS_KEY = "buckets";

/** The answer's reserved key for the pick of each `pick: "one"` bucket, `{bucketKey: uuid}`; it too is no field's and no control's. */
export const PICKED_KEY = "picked";

/** The prefix of a bucket entry's uuid that names a ledger power, not a document; such an entry is never read as a missing item. */
const POWER_PREFIX = "power:";

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
  if (procedure.label !== undefined && (typeof procedure.label !== "string" || !procedure.label.trim())) throw new TypeError(`registerCastProcedure(${key}): label must be a lang key`);
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
 * An answer's buckets without one document: its entry leaves every bucket that
 * holds it and each bucket keeps its key, possibly empty, so a stored write that
 * merges objects still lands. Idempotent: a uuid the answer does not name changes
 * nothing.
 *
 * @param {{buckets?: object}|null} answer
 * @param {string} uuid  the document that left its holder
 * @returns {{changed: boolean, buckets: Record<string, object[]>, keys: string[]}} the normalized buckets without the entry, and the keys of the buckets that lost it
 */
export function withoutUuid(answer, uuid) {
  const buckets = normalizeBuckets(answer?.buckets);
  const keys = [];
  if (typeof uuid === "string" && uuid) {
    for (const [key, list] of Object.entries(buckets)) {
      const kept = list.filter((e) => e.uuid !== uuid);
      if (kept.length === list.length) continue;
      buckets[key] = kept;
      keys.push(key);
    }
  }
  return { changed: keys.length > 0, buckets, keys };
}

/**
 * An answer's buckets without the entries whose document the world no longer
 * holds. A ledger power names no document and stays. With no `holds` every entry
 * is taken as present.
 *
 * @param {{buckets?: object}|null} answer
 * @param {((uuid: string) => Promise<boolean>|boolean)|null} holds
 * @returns {Promise<Record<string, object[]>>}
 */
export async function withoutMissing(answer, holds) {
  const buckets = normalizeBuckets(answer?.buckets);
  if (typeof holds !== "function") return buckets;
  const seen = new Map();
  const present = async (uuid) => {
    if (uuid.startsWith(POWER_PREFIX)) return true;
    if (!seen.has(uuid)) seen.set(uuid, (await holds(uuid)) !== false);
    return seen.get(uuid);
  };
  for (const [key, list] of Object.entries(buckets)) {
    const kept = [];
    for (const entry of list) if (await present(entry.uuid)) kept.push(entry);
    buckets[key] = kept;
  }
  return buckets;
}

/**
 * The buckets a procedure asks for, read against an answer: each with the rows it
 * holds (the stored list, else its `initial`; a uuid the world cannot resolve is
 * left out), the pick it stands on and the findings its policy makes. The pick is
 * the seat's where that row is still held and usable, else the policy's `opens`.
 * A member of the policy that throws is logged and left out.
 *
 * @param {object|null} procedure
 * @param {object} ctx  carries `resolve(uuid)`; with none, every listed uuid is taken as held
 * @param {object} [held]  the answer as the seat holds it
 * @returns {Array<{key: string, policy: object, rows: object[], list: object[], picked: string|null, findings: Array<{key: string, notice: string}>}>}
 */
export function bucketStates(procedure, ctx, held = {}) {
  if (!procedure?.buckets) return [];
  const asked = guard("buckets", () => procedure.buckets(ctx), []);
  const stored = normalizeBuckets(held?.[BUCKETS_KEY]);
  const pickedBy = held?.[PICKED_KEY] && typeof held[PICKED_KEY] === "object" ? held[PICKED_KEY] : {};
  const reads = typeof ctx?.resolve === "function";
  const out = [];
  for (const spec of Array.isArray(asked) ? asked : []) {
    if (!spec || typeof spec.key !== "string" || !spec.key || !spec.policy || typeof spec.policy !== "object") continue;
    const { key, policy } = spec;
    const list = key in stored ? stored[key] : (normalizeBuckets({ [key]: spec.initial })[key] ?? []);
    const rows = [];
    for (const entry of list) {
      const power = entry.uuid.startsWith(POWER_PREFIX);
      const doc = reads && !power ? guard("resolve", () => ctx.resolve(entry.uuid), null) : null;
      if (reads && !power && !doc) continue;
      rows.push({ ...entry, doc: doc ?? null });
    }
    let picked = null;
    if (policy.pick === "one") {
      const row = rows.find((r) => r.uuid === pickedBy[key]);
      const stands = row && guard("usable", () => policy.usable?.(row, ctx) !== false, true);
      picked = stands ? row.uuid : (guard("opens", () => policy.opens?.(rows, ctx), null) ?? null);
    }
    const found = guard("verdicts", () => policy.verdicts?.(rows, picked, ctx), []);
    const findings = (Array.isArray(found) ? found : []).filter((v) => v && typeof v.key === "string" && v.key).map((v) => ({ key: v.key, notice: String(v.notice ?? "") }));
    out.push({ key, policy, rows, list: rows.map(({ uuid, qty, fit }) => ({ uuid, qty, fit })), picked, findings });
  }
  return out;
}

/**
 * The heading of the procedure's band. A procedure's own `label` (a lang key the
 * tradition owns) names it; with none, or one the language has no string for,
 * the heading is the tradition's own label, and `fallback` where it has none.
 *
 * @param {{label?: string, traditionLabel?: string}|null} named  `label` as the procedure supplied it, `traditionLabel` the cast's tradition's label
 * @param {{localize: (key: string) => string, fallback?: string}} o
 * @returns {string}
 */
export function procedureHeading(named, { localize, fallback = "" } = {}) {
  const key = typeof named?.label === "string" ? named.label.trim() : "";
  if (key && typeof localize === "function") {
    const text = localize(key);
    if (typeof text === "string" && text && text !== key) return text;
  }
  const own = String(named?.traditionLabel ?? "").trim();
  return own || fallback;
}

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
 * @returns {{specs: object[], answer: object, band: {template: string, context: object}|null, buckets: ReturnType<typeof bucketStates>, findings: Array<{key: string, notice: string}>}|null} null where there is no procedure; `findings` are the buckets' own verdicts
 */
export function procedureView(procedure, ctx, raw = {}) {
  if (!procedure) return null;
  const held = raw && typeof raw === "object" ? raw : {};
  // A field spec cannot take the buckets' key: the buckets are filled by a drag alone.
  const specs = procedure.fields ? usableSpecs(guard("fields", () => procedure.fields(ctx, held), [])).fields.filter((s) => s.key !== BUCKETS_KEY && s.key !== PICKED_KEY) : [];
  const answer = coerceData(specs, held);
  if (BUCKETS_KEY in answer) answer[BUCKETS_KEY] = normalizeBuckets(answer[BUCKETS_KEY]);
  // The buckets answer for themselves: the list each holds (its opening list included) and the pick it stands on, so a seat that never touches one still answers what the cast reads.
  const buckets = bucketStates(procedure, ctx, answer);
  if (buckets.length) {
    answer[BUCKETS_KEY] = { ...normalizeBuckets(answer[BUCKETS_KEY]), ...Object.fromEntries(buckets.map((b) => [b.key, b.list])) };
    answer[PICKED_KEY] = Object.fromEntries(buckets.filter((b) => b.picked).map((b) => [b.key, b.picked]));
  }
  const made = procedure.band ? guard("band", () => procedure.band(ctx, answer), null) : null;
  const band = made && typeof made.template === "string" && made.template ? { template: made.template, context: made.context ?? {} } : null;
  return { specs, answer, band, buckets, findings: buckets.flatMap((b) => b.findings) };
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
 * The revert of a performed step. Only a seat that owns the caster reverts, only
 * a card that carries undo data, and only once. The ownership answer is the
 * caller's (`ownsCaster`); it gates the revert here and is not handed on, so a
 * procedure's `ctx` carries no seat. The revert writes the caster, never the
 * card: stamping the card reverted is the caller's, on whichever client can.
 *
 * @param {{procedure?: {kind: string, undo: *, reverted?: boolean}}} card
 * @param {object} ctx  a procedure's ctx, with `ownsCaster` (the seat owns the caster)
 * @returns {Promise<{ok: boolean, reason?: "notOwner"|"nothing"|"noRevert"|"threw"}>}
 */
export async function runRevert(card, ctx) {
  const done = card?.procedure;
  const { ownsCaster, ...rest } = ctx ?? {};
  if (ownsCaster !== true) return { ok: false, reason: "notOwner" };
  if (!done || done.undo === null || done.undo === undefined || done.reverted === true) return { ok: false, reason: "nothing" };
  const procedure = procedureOfKind(done.kind);
  if (!procedure?.revert) return { ok: false, reason: "noRevert" };
  try {
    await procedure.revert({ ...rest, source: SPELL_SOURCE }, done.undo);
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
