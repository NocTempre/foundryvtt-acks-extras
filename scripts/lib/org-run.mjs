/* global Actor, fromUuid */
/**
 * The executor of an organisation write plan (docs/lib/ORGANISATION.md, "The
 * executor"): it carries the ordered ops of `org-write-logic.mjs`'s Roll and Add
 * out over the world through lib's own writers (`group.mjs`, `place.mjs`), with a
 * ref map that turns each `"new:<id>"` the plan names into the uuid of the
 * document made for it.
 *
 * Lib knows no creature, family or unit word, so the two things that need one are
 * the caller's, handed in as callbacks:
 *
 *  - `mint(spec, {key})` finds or makes the world actor of one prototype spec and
 *    answers `{actor, made}`. It is called only when a stack first names the
 *    prototype, so a creature nothing but a leader used is never made twice.
 *  - `makeLeader(op, spec, mount)` makes the one actor of a unit's leader, from the
 *    prototype spec and the figures the op carries, and answers it.
 *
 * Every id made is returned, on a refusal and on a failure too, so a caller can
 * track and sweep what a run left. A plan is carried out in order and a write
 * that fails stops the run; what landed stands.
 */
import { MODULE_ID } from "./constants.mjs";
import { GROUP_ACTOR_TYPE } from "./group-logic.mjs";
import { addLabelledStack, addStack, patchStack, setParentGroup, setStackPrototype } from "./group.mjs";
import { addOccupant } from "./place.mjs";

/** The ops this executor carries out. */
const OPS = new Set(["prototype", "createGroup", "parent", "addStack", "addLabelledStack", "makeActor", "setOfficer", "setStack", "update", "addOccupant"]);

const isRef = (v) => typeof v === "string" && v.startsWith("new:");

/** A refusal before anything was written. */
const refused = (reason, extra = {}) => ({ ok: false, reason, done: 0, created: [], made: { groups: [], prototypes: [], leaders: [] }, refs: {}, ...extra });

/**
 * Carry a plan out.
 *
 * @param {{ok: boolean, ops: object[]}} plan an `org-write-logic.mjs` plan
 * @param {object} [provider]
 * @param {(spec: object, info: {key: string}) => Promise<{actor: object, made: boolean}|null>} [provider.mint]
 * @param {(op: object, spec: object, mount: {uuid?: string, label?: string}|null) => Promise<object|null>} [provider.makeLeader]
 * @returns {Promise<{ok: boolean, reason?: string, error?: string, done: number, created: string[], made: {groups: string[], prototypes: string[], leaders: string[]}, reused: string[], refs: Object<string, string>}>}
 */
export async function runPlan(plan, { mint = null, makeLeader = null } = {}) {
  if (!plan?.ok) return refused(plan?.reason ?? "noPlan");
  if (plan.ops.some((op) => !OPS.has(op.op))) return refused("badOp");

  const refs = new Map();
  const specs = new Map();
  const minted = new Map();
  const made = { groups: [], prototypes: [], leaders: [] };
  const reused = [];
  const docs = new Map();
  const result = (extra) => ({ done, created: [...made.groups, ...made.prototypes, ...made.leaders], made, reused, refs: Object.fromEntries(refs), ...extra });
  let done = 0;

  const uuidOf = (v) => (isRef(v) ? refs.get(v) : v);
  const docOfUuid = async (uuid) => {
    if (!uuid) return null;
    if (!docs.has(uuid)) docs.set(uuid, (await fromUuid(uuid).catch(() => null)) ?? null);
    return docs.get(uuid);
  };
  const docOfRef = (v) => docOfUuid(uuidOf(v));

  // Every document a plan writes that already exists must be there, and writable, before the first write.
  for (const op of plan.ops) {
    const target = op.op === "update" ? op.uuid : op.op === "addOccupant" ? op.place : op.op === "setStack" || op.op === "setOfficer" ? op.group : null;
    if (!target || isRef(target)) continue;
    const doc = await docOfUuid(target);
    if (!doc) return refused("missing");
    if (!doc.isOwner) return refused("notOwner", { name: doc.name ?? "" });
  }

  /** The value with every ref replaced by its uuid; a ref nothing made is a refusal, never a written string. */
  const substitute = (value) => {
    if (isRef(value)) {
      if (!refs.has(value)) throw new Error(`unresolved ${value}`);
      return refs.get(value);
    }
    if (Array.isArray(value)) return value.map(substitute);
    if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitute(v)]));
    return value;
  };

  /** The world actor a stack copies: a library uuid, or a prototype minted when first named. */
  const sourceOf = async (ref) => {
    if (!isRef(ref)) return docOfUuid(ref);
    if (minted.has(ref)) return minted.get(ref);
    const held = specs.get(ref);
    if (!held || held.spec.kind === "label" || typeof mint !== "function") return null;
    const hit = await mint(held.spec, { key: held.key });
    if (!hit?.actor) return null;
    minted.set(ref, hit.actor);
    refs.set(ref, hit.actor.uuid);
    (hit.made ? made.prototypes : reused).push(hit.actor.uuid);
    return hit.actor;
  };

  /** A mount as a stack or a leader records it: the creature's uuid and name, or the printed word alone. */
  const mountOf = async (ref) => {
    if (!ref) return null;
    const held = isRef(ref) ? specs.get(ref) : null;
    if (held?.spec.kind === "label") return { label: held.spec.label };
    const actor = await sourceOf(ref);
    return actor ? { uuid: actor.uuid, label: actor.name ?? "" } : null;
  };

  try {
    for (const op of plan.ops) {
      if (op.op === "prototype") {
        specs.set(op.ref, { key: op.key, spec: op.spec });
      } else if (op.op === "createGroup") {
        const group = await Actor.implementation.create({ name: op.name, type: GROUP_ACTOR_TYPE });
        if (!group) return result({ ok: false, reason: "failed", error: `no group made for ${op.ref}` });
        refs.set(op.ref, group.uuid);
        docs.set(group.uuid, group);
        made.groups.push(group.uuid);
      } else if (op.op === "parent") {
        const outcome = await setParentGroup(await docOfRef(op.uuid), uuidOf(op.parentUuid));
        if (!outcome.ok && outcome.reason !== "same") return result({ ok: false, reason: outcome.reason });
      } else if (op.op === "addStack") {
        const group = await docOfRef(op.group);
        const source = await sourceOf(op.prototype);
        if (!group || !source) return result({ ok: false, reason: "noPrototype", error: String(op.prototype) });
        const gen = { ...op.gen };
        if (op.mount) gen.mount = { ...(await mountOf(op.mount.prototype)), perBody: op.mount.perBody ?? 1 };
        if (op.carry) gen.carry = { ...op.carry };
        if (op.speakers != null) gen.speakers = op.speakers;
        const key = await addStack(group, source, { count: op.count, gen, fixedHp: op.fixedHp ?? null });
        if (!key) return result({ ok: false, reason: "failed", error: "addStack" });
      } else if (op.op === "addLabelledStack") {
        const key = await addLabelledStack(await docOfRef(op.group), { label: op.label, count: op.count, gen: op.gen });
        if (!key) return result({ ok: false, reason: "failed", error: "addLabelledStack" });
      } else if (op.op === "makeActor") {
        const held = isRef(op.spec) ? specs.get(op.spec) : { spec: { kind: "entry", uuid: op.spec } };
        if (!held || typeof makeLeader !== "function") return result({ ok: false, reason: "noPrototype", error: String(op.spec) });
        const actor = await makeLeader(op, held.spec, await mountOf(op.mount?.prototype));
        if (!actor) return result({ ok: false, reason: "failed", error: `no leader made for ${op.ref}` });
        refs.set(op.ref, actor.uuid);
        docs.set(actor.uuid, actor);
        made.leaders.push(actor.uuid);
      } else if (op.op === "setOfficer") {
        const group = await docOfRef(op.group);
        await group.update({ "system.unit.officerUuid": uuidOf(op.officer), "system.unit.officerMoraleBonus": op.moraleBonus ?? null });
      } else if (op.op === "setStack") {
        const group = await docOfRef(op.group);
        if (!group) return result({ ok: false, reason: "missing" });
        if (op.prototype !== undefined) {
          const source = await sourceOf(op.prototype);
          if (!source || !(await setStackPrototype(group, op.stack, source))) return result({ ok: false, reason: "noPrototype", error: String(op.prototype) });
        }
        if (op.count !== undefined) {
          const hit = await patchStack(group, op.stack, (s) => {
            const n = Math.max(Math.floor(Number(op.count)) || 0, (s.roster ?? []).length);
            s.size.current = n;
            s.size.initial = n;
            // A thrown count is the stack's rolled one again: the record `byHandOf` compares the count with. A roster that floors the count
            // leaves a total the dice did not give, so no dice are recorded beside it.
            if (Array.isArray(op.thrown)) s.gen = { ...s.gen, rolled: n, thrown: n === Math.max(Math.floor(Number(op.count)) || 0, 0) ? [...op.thrown] : [] };
          });
          if (!hit) return result({ ok: false, reason: "noStack", error: String(op.stack) });
        }
      } else if (op.op === "update") {
        const target = await docOfRef(op.uuid);
        if (!target) return result({ ok: false, reason: "missing" });
        await target.update(substitute(op.update));
      } else if (op.op === "addOccupant") {
        const place = await docOfUuid(op.place);
        const actor = await docOfRef(op.actor);
        await addOccupant(place, actor);
        if (!(place.system.roster ?? []).some((r) => r.uuid === actor.uuid)) return result({ ok: false, reason: "failed", error: "addOccupant" });
      }
      done++;
    }
  } catch (err) {
    console.warn(`${MODULE_ID} | an organisation plan failed`, err);
    return result({ ok: false, reason: "failed", error: String(err?.message ?? err) });
  }
  return result({ ok: true });
}
