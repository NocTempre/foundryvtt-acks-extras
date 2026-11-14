/* global Hooks */
/**
 * The Foundry-FREE half of the group lifecycle: the pure decisions, split out so
 * they import under Node and are unit-tested offline (the same split as
 * vocab.mjs vs the Foundry-only fields.mjs). group.mjs re-exports these and adds
 * the document-writing operations around them.
 *
 * Nothing here touches a Foundry global at module-eval time; `Hooks` is guarded
 * and `structuredClone` is a standard built-in in both Node and the browser.
 */
import { MODULE_ID } from "./constants.mjs";
import { appearingFormula, sideFormula } from "./encounter-line.mjs";

/** The registered actor sub-type a stack is stored as. */
export const GROUP_ACTOR_TYPE = `${MODULE_ID}.group`;

/**
 * Is this actor a stack? The TYPE-ONLY test, for consumers that must not pull in
 * the data model — group-data.mjs subclasses a Foundry class at module scope, so
 * importing it from a Foundry-free module (or from one loaded under a partial
 * mock) evaluates that subclassing. group.mjs's `isGroup` is the richer test and
 * defers to this one.
 */
export function isGroupActor(actor) {
  return actor?.type === GROUP_ACTOR_TYPE;
}

/** Token/flag keys linking a deployed token back to its group, stack, and member. */
export const GROUP_FLAG = "group"; // on the token: the group actor's uuid
/** The token flag holding the stack's key within the group. */
export const STACK_FLAG = "stack";
/** The token flag holding the roster member's key. */
export const MEMBER_FLAG = "member";

/**
 * The tokens on `scenes` that stand for `group`'s bodies, found by the group
 * flag every deployed body carries. Reads only.
 * @param {object} group the group actor
 * @param {Iterable<Scene>} scenes
 * @returns {TokenDocument[]}
 */
export function deployedBodies(group, scenes) {
  const bodies = [];
  if (!group?.uuid) return bodies;
  for (const scene of scenes ?? []) {
    for (const token of scene?.tokens ?? []) {
      if (token?.getFlag?.(MODULE_ID, GROUP_FLAG) === group.uuid) bodies.push(token);
    }
  }
  return bodies;
}

/**
 * How many BODIES an actor stands for: a stack stands for its living bodies
 * across every stack it holds, and any other actor stands for itself.
 *
 * This is the one place that answers "how many people is this row?", so a
 * formation cell, a headcount and a marching block all agree. Reads the derived
 * total when the data model is live and falls back to summing the raw stacks, so
 * a plain source object answers the same.
 */
export function bodyCount(actor) {
  if (!isGroupActor(actor)) return actor ? 1 : 0;
  const sys = actor.system ?? {};
  if (typeof sys.totalCurrent === "number") return Math.max(0, sys.totalCurrent);
  return (sys.stacks ?? []).reduce((n, s) => n + Math.max(0, s?.size?.current ?? 0), 0);
}

/**
 * The next never-used ordinal for a STACK. Ordinals are assigned once and never
 * reused within a stack, so "#7" always means the same body even after #3 dies —
 * the report stays legible.
 * @param {object} stack - a stack (or anything with `.roster`)
 */
export function nextOrdinal(stack) {
  const roster = stack?.roster ?? [];
  return roster.reduce((max, m) => Math.max(max, m.ordinal ?? 0), 0) + 1;
}

/** Roster order within one band: by ordinal, so "#3 fell" stays legible. */
export const byOrdinal = (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0);

/**
 * A member's display name: its own name, else the stack's template label +
 * ordinal ("Swordsman #7").
 * @param {object} stack - a stack with `.template.label`
 * @param {object} member - a roster entry
 */
export function memberName(stack, member) {
  if (member?.name) return member.name;
  const label = stack?.template?.label || "Member";
  return `${label} #${member?.ordinal ?? "?"}`;
}

/**
 * The stack on a group that a crossing stack joins: the one over the same base
 * actor, so every record's delta still overlays what it was written against. A
 * stack with no base matches none, and a shared label never matches.
 * @param {object[]} stacks - the receiving group's stacks
 * @param {object} stack - the stack crossing
 * @returns {object|null}
 */
export function matchingStack(stacks, stack) {
  const uuid = stack?.template?.uuid;
  return (uuid && stacks?.find((s) => s.template?.uuid === uuid)) || null;
}

/**
 * Fold a crossing stack into one over the same base, in place. Its records take
 * this stack's next ordinals in their own order, since a number here already
 * means a body, and both counts add, so bodies that fell stay counted as fallen.
 * An empty stack nothing sized takes the crossing stack's roll with its count.
 * @param {object} into - the stack receiving, a plain source
 * @param {object} stack - the stack crossing, a plain source
 * @returns {object} `into`
 */
export function mergeStack(into, stack) {
  let ordinal = nextOrdinal(into);
  const records = [...(stack.roster ?? [])].sort(byOrdinal).map((m) => ({ ...m, ordinal: ordinal++ }));
  into.roster = [...(into.roster ?? []), ...records];
  if (into.rolled?.total == null && !into.size.current && !into.size.initial) {
    into.rolled = structuredClone(stack.rolled);
    into.size.formula = stack.size?.formula ?? "";
  }
  into.size.current = (into.size.current ?? 0) + (stack.size?.current ?? 0);
  into.size.initial = (into.size.initial ?? 0) + (stack.size?.initial ?? 0);
  return into;
}

/**
 * Take a crossing stack onto a group's stacks, in place: into its match, else
 * whole under `key`, its roll, its records and their ordinals as they stand.
 * @param {object[]} stacks - the receiving group's stacks, plain sources
 * @param {object} stack - the stack crossing, a plain source
 * @param {string} key - the key it stands under where it matches nothing
 * @returns {{stack: object, merged: boolean}} the stack that holds it now
 */
export function receiveStack(stacks, stack, key) {
  const match = matchingStack(stacks, stack);
  if (match) return { stack: mergeStack(match, stack), merged: true };
  const added = { ...stack, key };
  stacks.push(added);
  return { stack: added, merged: false };
}

/**
 * Why a stack cannot move from one group to another now, or null. Both sides are
 * written, so a seat must be able to write both. A token's own copy would write
 * its stacks to that token's delta. A deployed body stays with its group, because
 * its token's flags name the group, the stack and the record that recall and the
 * deletion hook fold it back through.
 * @param {object} from - the group it leaves
 * @param {object} to - the group it joins
 * @param {object|null} stack - the stack on `from`, already read
 * @returns {{reason: string, name?: string, n?: number}|null}
 */
export function moveRefusal(from, to, stack) {
  if (!isGroupActor(from) || !isGroupActor(to) || !stack) return { reason: "gone" };
  if (from.uuid === to.uuid) return { reason: "same" };
  const shut = [from, to].find((group) => !group.isOwner || group.compendium?.locked);
  if (shut) return { reason: "notOwner", name: shut.name ?? "" };
  if (from.isToken || to.isToken) return { reason: "unlinked" };
  const out = (stack.roster ?? []).filter((m) => m.state === "deployed").length;
  return out ? { reason: "deployed", name: stack.template?.label ?? "", n: out } : null;
}

/**
 * RR 169 "personally led" command capacity, in INFANTRY-EQUIVALENTS, by the
 * commander's level. Cavalry count double toward the limit, so the group's
 * strength and this capacity are both in infantry-equivalents. 0th level
 * cannot lead mercenaries into danger at all. The 1st-level (squad) figure is
 * a documented interpretation pending confirmation — see docs/lib/DECISIONS.md,
 * "The squad command-capacity figure is an interpretation, not a printed
 * number".
 */
export function platoonCapacity(level) {
  const L = Number(level) || 0;
  if (L >= 3) return 30;
  if (L === 2) return 15;
  if (L === 1) return 7;
  return 0;
}

/**
 * Is this effect DERIVED state that must not survive a recall (vs. an authored
 * effect, kept)? See docs/lib/GROUPS.md, "Derived effects do not survive
 * recall".
 */
export function isDerivedEffect(effectData) {
  const flags = effectData?.flags ?? {};
  for (const ns of Object.values(flags)) {
    if (ns && typeof ns === "object" && ns.managed === true) return true;
  }
  let derived = false;
  if (typeof Hooks !== "undefined") {
    Hooks.callAll?.("acksLibGroupIsDerivedEffect", effectData, (v) => {
      derived = derived || !!v;
    });
  }
  return derived;
}

/** Strip derived effects out of an ActorDelta source object (returns a copy). */
export function cleanDelta(delta) {
  const copy = structuredClone(delta ?? {});
  if (Array.isArray(copy.effects)) {
    copy.effects = copy.effects.filter((e) => !isDerivedEffect(e));
    if (!copy.effects.length) delete copy.effects;
  }
  return copy;
}

/**
 * A source's monster extras: a live actor's flag, or a stack snapshot's, which
 * is a plain object.
 * @param {object} [source] a prototype actor or its snapshot
 * @returns {object|null}
 */
export function ecologyOf(source) {
  return source?.getFlag?.(MODULE_ID, "extras") ?? source?.flags?.[MODULE_ID]?.extras ?? null;
}

/**
 * A monster's number-appearing → a size dice formula, or null if unstated. With
 * no `state` this is the first side that states a count. With a `state` it is
 * that side alone, and a line that states a count anywhere never falls through
 * to core's field, which holds the first count and so never a lair's.
 * @param {object} source - a prototype actor or its snapshot
 * @param {"wilderness"|"dungeon"} [context]
 * @param {"wandering"|"lair"|null} [state]
 * @returns {string|null} a dice formula, or null if unstated
 */
export function sizeFromEcology(source, context = "wilderness", state = null) {
  if (!source) return null;
  const line = ecologyOf(source)?.encounter?.[context];
  const rich = state ? sideFormula(line?.[state]) : appearingFormula(line);
  if (rich) return rich;
  if (state && (line?.wandering?.number || line?.lair?.number || state === "lair")) return null;
  const core = source.system?.details?.appearing?.[context === "dungeon" ? "d" : "w"];
  return core ? String(core).trim() : null;
}
