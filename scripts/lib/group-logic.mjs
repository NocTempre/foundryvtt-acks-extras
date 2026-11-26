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
import { OCCUPANT_KIND, ancestorUuids, descendantUuids, indexPlaces, wouldCycle } from "./place-logic.mjs";

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

/**
 * The range a group's officer morale bonus (`unit.officerMoraleBonus`) takes, signed:
 * a warband modifier may lower morale as well as raise it. It mirrors the field's own
 * maximum, as the signed range `unit.loyalty` takes, and is the one range the data
 * model's field, the beastman organisation roll's check and a hire's write all read.
 */
export const OFFICER_MORALE_RANGE = Object.freeze({ min: -4, max: 4 });

/**
 * An officer morale figure held to `OFFICER_MORALE_RANGE`, or null where there is no
 * figure to hold (an unread one stays unread and is never made a zero).
 * @param {number|null|undefined} value
 * @returns {number|null}
 */
export function clampOfficerMoraleBonus(value) {
  if (!Number.isFinite(value)) return null;
  return Math.min(OFFICER_MORALE_RANGE.max, Math.max(OFFICER_MORALE_RANGE.min, Math.trunc(value)));
}

/** Token/flag keys linking a deployed token back to its group, stack, and member. */
export const GROUP_FLAG = "group"; // on the token: the group actor's uuid
/** The token flag holding the stack's key within the group. */
export const STACK_FLAG = "stack";
/** The token flag holding the roster member's key. */
export const MEMBER_FLAG = "member";

/**
 * The tokens on `scenes` that stand for `group`'s own bodies, found by the group
 * flag every deployed body carries. Reads only. A group inside this one has its
 * own bodies, which `deployedTree` adds.
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

/* -------------------------------------------- */
/*  A group inside a group                       */
/* -------------------------------------------- */

/**
 * Every group actor in the world, or none where no world is loaded. The one read
 * the tree walks below start from.
 * @returns {object[]}
 */
export function worldGroups() {
  const actors = globalThis.game?.actors;
  return typeof actors?.[Symbol.iterator] === "function" ? [...actors].filter(isGroupActor) : [];
}

/**
 * The nodes the one walker reads, `{uuid, parentUuid}` over each group's
 * `unit.parentGroupUuid`: place-logic's `ancestorUuids`, `descendantUuids` and
 * `wouldCycle` are the walker, and a group's nesting uses it as a place's and a
 * faction's do.
 * @param {object[]} [groups] defaults to every group in the world
 * @returns {{uuid: string, parentUuid: string, name: string, own: number}[]} `own` is the
 *   bodies the group holds in its own stacks
 */
export function groupNodes(groups = worldGroups()) {
  return groups
    .filter((g) => g?.uuid)
    .map((g) => ({ uuid: g.uuid, parentUuid: g.system?.unit?.parentGroupUuid ?? "", name: g.name ?? "", own: ownBodies(g) }));
}

/**
 * The uuids of every group inside `group`, nearest first, however deep. The walk
 * ends on its own where data loops.
 * @param {object} group
 * @param {{uuid: string, parentUuid: string}[]} [nodes]
 * @returns {string[]}
 */
export function groupDescendants(group, nodes = groupNodes()) {
  return group?.uuid ? descendantUuids(group.uuid, nodes) : [];
}

/**
 * The uuids of every group `group` stands inside, nearest first.
 * @param {object} group
 * @param {{uuid: string, parentUuid: string}[]} [nodes]
 * @returns {string[]}
 */
export function groupAncestors(group, nodes = groupNodes()) {
  return group?.uuid ? ancestorUuids(group.uuid, indexPlaces(nodes)) : [];
}

/**
 * Would putting `uuid` inside `parentUuid` close a loop? Putting a group inside
 * itself counts, and a parent this client cannot see does not.
 * @param {string} uuid
 * @param {string} parentUuid
 * @param {{uuid: string, parentUuid: string}[]} [nodes]
 */
export function wouldCycleGroup(uuid, parentUuid, nodes = groupNodes()) {
  return wouldCycle(uuid, parentUuid, indexPlaces(nodes));
}

/**
 * A group and every group inside it, as actors: the group first, then those
 * inside it nearest first. A group nothing is inside is a tree of itself.
 * @param {object} group
 * @returns {object[]}
 */
export function groupTree(group) {
  if (!isGroupActor(group)) return [];
  const all = worldGroups();
  const byUuid = new Map(all.map((g) => [g.uuid, g]));
  const inside = groupDescendants(group, groupNodes(all)).map((u) => byUuid.get(u)).filter(Boolean);
  return [group, ...inside];
}

/**
 * The tokens on `scenes` that stand for the bodies of `group` and of every group
 * inside it. What a token's fight sends out, gathers and puts back, and what a
 * formation reads for a member that holds a nested group.
 * @param {object} group
 * @param {Iterable<Scene>} scenes
 * @returns {TokenDocument[]}
 */
export function deployedTree(group, scenes) {
  const uuids = new Set(groupTree(group).map((g) => g.uuid));
  if (!uuids.size && group?.uuid) uuids.add(group.uuid);
  const bodies = [];
  for (const scene of scenes ?? []) {
    for (const token of scene?.tokens ?? []) {
      if (uuids.has(token?.getFlag?.(MODULE_ID, GROUP_FLAG))) bodies.push(token);
    }
  }
  return bodies;
}

/**
 * A fight's bodies cut into gangs, one set of tokens per group in `group`'s tree. A
 * body belongs to the group its group flag names, the group itself first and the groups
 * inside it after, nearest first. Only a body that is a combatant counts, since the
 * system's grouping refuses a token that is not, and a group with fewer than two such
 * bodies is left out, since the system refuses a group of one.
 * @param {object} group the group actor whose token joined
 * @param {Iterable<TokenDocument>} bodies the tokens of the group's tree on the scene
 * @param {Set<string>} fighting the ids of the tokens that are combatants in the combat
 * @returns {{group: object, tokens: TokenDocument[]}[]}
 */
export function gangPartition(group, bodies, fighting) {
  const held = [...bodies].filter((b) => fighting.has(b.id));
  return groupTree(group)
    .map((owner) => ({ group: owner, tokens: held.filter((b) => b.getFlag?.(MODULE_ID, GROUP_FLAG) === owner.uuid) }))
    .filter((gang) => gang.tokens.length > 1);
}

/**
 * The living bodies one group holds in its own stacks, none for an emptied one.
 * Reads the derived total when the data model is live and falls back to summing
 * the raw stacks, so a plain source object answers the same.
 * @param {object} actor a group
 */
export function ownBodies(actor) {
  const sys = actor?.system ?? {};
  if (typeof sys.totalCurrent === "number") return Math.max(0, sys.totalCurrent);
  return (sys.stacks ?? []).reduce((n, s) => n + Math.max(0, s?.size?.current ?? 0), 0);
}

/**
 * How many BODIES an actor stands for: a group stands for its living bodies across
 * every stack it holds and every group inside it, read now and never from a
 * stored figure; an emptied group stands for none. Any other actor stands for
 * itself.
 *
 * This is the one place that answers "how many people is this row?", so a
 * formation cell, a headcount and a marching block all agree.
 * @param {object} actor
 * @param {{uuid: string, parentUuid: string}[]} [nodes] the groups to walk, default every group in the world
 */
export function bodyCount(actor, nodes = null) {
  if (!isGroupActor(actor)) return actor ? 1 : 0;
  return ownBodies(actor) + treeBodies(actor, nodes);
}

/**
 * The figures a group's sheet reads across its whole tree: the living bodies
 * (`bodyCount`), the pristine ones and the casualties of the group and every
 * group inside it, and the parts that make the living figure, each once and in
 * the order they add: the group's own stacks by creature label, then each group
 * inside it by name with the bodies it holds in its own stacks.
 * @param {object} group
 * @returns {{current: number, pristine: number, dead: number, parts: {label: string, current: number}[]}}
 */
export function treeTotals(group) {
  const tree = groupTree(group);
  const figure = (g, key) => (typeof g?.system?.[key] === "number" ? g.system[key] : 0);
  const own = (group?.system?.stacks ?? []).map((s) => ({ label: s.template?.label ?? "", current: s.size?.current ?? 0 }));
  const inside = tree.slice(1).map((g) => ({ label: g.name ?? "", current: ownBodies(g) }));
  return {
    current: bodyCount(group),
    pristine: tree.reduce((n, g) => n + figure(g, "totalPristine"), 0),
    dead: tree.reduce((n, g) => n + figure(g, "totalDead"), 0),
    parts: [...own, ...inside],
  };
}

/** The living bodies of every group inside `actor`, each counted once. */
function treeBodies(actor, nodes) {
  const all = nodes ?? groupNodes();
  const inside = new Set(groupDescendants(actor, all));
  return all.filter((n) => inside.has(n.uuid)).reduce((sum, n) => sum + (n.own ?? 0), 0);
}

/**
 * Roster or member rows with each group row's count read now. A row naming a
 * group that resolves is a group row whatever its stored `kind` says, and its
 * `quantity` is that group's `bodyCount`, nested groups included and none for an
 * emptied one. A group's bodies are counted once however many rows reach it: a
 * row whose group stands inside another row's group keeps its own figure and is
 * marked `covered`, which `headcount` counts as none. A row
 * that does not resolve (a group deleted, a pack not loaded) keeps what it
 * stored, and every other row is left as it is.
 * @param {object[]} rows plain rows with `uuid`, `kind`, `quantity`
 * @param {(uuid: string) => object|null} [resolve] a row's actor, default the world's
 * @returns {object[]}
 */
export function liveRows(rows, resolve = worldActor) {
  const list = rows ?? [];
  const groups = list.map((row) => {
    const actor = row?.uuid ? resolve(row.uuid) : null;
    return isGroupActor(actor) ? actor : null;
  });
  const nodes = groupNodes(worldGroups());
  const held = new Set(groups.filter(Boolean).map((g) => g.uuid));
  return list.map((row, i) => {
    const group = groups[i];
    if (!group) return row;
    const inside = groupAncestors(group, nodes).some((u) => held.has(u));
    return { ...row, kind: OCCUPANT_KIND.GROUP, quantity: bodyCount(group, nodes), covered: inside };
  });
}

/** A world document by uuid, or null: `fromUuidSync` throws on a pack that is not loaded. */
function worldActor(uuid) {
  try {
    return typeof globalThis.fromUuidSync === "function" ? (globalThis.fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
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

/** Was this stack made by the generator? Its `gen` names the recipe part. */
export const isGeneratedStack = (stack) => !!stack?.gen?.part;

/**
 * The stack on a group that a crossing stack joins: the one over the same base
 * actor, so every record's delta still overlays what it was written against. A
 * stack with no base matches none, and a shared label never matches. Two
 * generated stacks never match, since each stands for one unit's part and the
 * same creature in two units is two rows.
 * @param {object[]} stacks - the receiving group's stacks
 * @param {object} stack - the stack crossing
 * @returns {object|null}
 */
export function matchingStack(stacks, stack) {
  const uuid = stack?.template?.uuid;
  const made = isGeneratedStack(stack);
  return (uuid && stacks?.find((s) => s.template?.uuid === uuid && !(made && isGeneratedStack(s)))) || null;
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

/** The answer of `platoonCapacity` for an officer ranked below every rung read: no unit is theirs to lead. */
export const BELOW_EVERY_RUNG = Object.freeze({ below: true });

/** A command rung as read: a whole minimum leader level and a whole count of each arm above zero. */
const isRung = (r) => Number.isInteger(r?.level) && r.level >= 0 && Number.isInteger(r?.infantry) && r.infantry > 0 && Number.isInteger(r?.cavalry) && r.cavalry > 0;

/**
 * The rung of the personally-led command ladder (RR 169) an officer of `level`
 * stands on: the highest rung whose minimum level the officer meets. The
 * rungs are the imported ones (`{level, infantry, cavalry}`, any order); this
 * module holds no level and no count. Three answers, kept apart: the rung in
 * force; `BELOW_EVERY_RUNG` for an officer under the lowest minimum; and null
 * where no usable rung is imported, which is an absence and never a limit of
 * zero. See docs/lib/DECISIONS.md, "The command capacity is read off the page,
 * all three rungs".
 * @param {number} level - the officer's level
 * @param {{level: number, infantry: number, cavalry: number}[]} rungs
 * @returns {{level: number, infantry: number, cavalry: number}|typeof BELOW_EVERY_RUNG|null}
 */
export function platoonCapacity(level, rungs) {
  const usable = (Array.isArray(rungs) ? rungs : []).filter(isRung);
  if (!usable.length) return null;
  const L = Number(level) || 0;
  const met = usable.filter((r) => r.level <= L);
  if (!met.length) return BELOW_EVERY_RUNG;
  return met.reduce((best, r) => (r.level > best.level ? r : best));
}

/**
 * Whether a unit is larger than its officer can personally lead (RR 169), or
 * null where no rung is imported, so a caller shows nothing. Infantry and
 * cavalry are each held to their own count of the rung in force; a unit of
 * both is over when the two shares of their counts add past one, which is the
 * pure unit's comparison exactly. Under every rung, any body is over. Returns
 * `{over, rung}` where `rung` is the rung in force or null below every rung.
 * @param {{infantry: number, cavalry: number}} counts - living bodies by arm
 * @param {number} level - the officer's level
 * @param {{level: number, infantry: number, cavalry: number}[]} rungs
 * @returns {{over: boolean, rung: {level: number, infantry: number, cavalry: number}|null}|null}
 */
export function commandStatus(counts, level, rungs) {
  const standing = platoonCapacity(level, rungs);
  if (standing === null) return null;
  const infantry = Math.max(0, Number(counts?.infantry) || 0);
  const cavalry = Math.max(0, Number(counts?.cavalry) || 0);
  if (standing === BELOW_EVERY_RUNG) return { over: infantry + cavalry > 0, rung: null };
  // infantry/capI + cavalry/capC > 1, cleared of its denominators so the test is exact.
  return { over: infantry * standing.cavalry + cavalry * standing.infantry > standing.infantry * standing.cavalry, rung: standing };
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

const SIZE_EPSILON = 1e-6;
const isNumber = (v) => typeof v === "number" && Number.isFinite(v);
const sameNumber = (a, b) => Math.abs(a - b) <= SIZE_EPSILON;

/** A roster record's `tokenSize` that remembers nothing. */
export const noTokenSize = () => ({ width: null, height: null, scaleX: null, scaleY: null });

/**
 * The size a hand gave a body's token, as a roster record keeps it across a
 * gather; each part is null where it is not kept.
 *
 * Width and height are kept as a pair, since the footprint lock freezes both
 * axes, and only where the pair differs from the prototype's and a hand set it:
 * the token is locked, or it carries a stamp (the size the module last wrote)
 * that the pair differs from. A token with neither lock nor stamp is no body
 * this module has sized, so none of its size is kept. The scale pair is kept
 * where it differs from the prototype's, because nothing automatic writes scale.
 *
 * @param {object} stored  the token's `_source`: `width`, `height`, `texture.scaleX/scaleY`
 * @param {object} proto  the prototype token the deploy builds from, in the same shape
 * @param {{locked?: boolean, stamp?: {width: number, height: number}|null}} [hand]
 *   `locked` is the token's footprint lock; `stamp` is its size stamp
 * @returns {{width: number|null, height: number|null, scaleX: number|null, scaleY: number|null}}
 */
export function keptTokenSize(stored, proto, { locked = false, stamp = null } = {}) {
  const kept = noTokenSize();
  if (!stored || !proto) return kept;
  const { width, height } = stored;
  if (isNumber(width) && isNumber(height) && isNumber(proto.width) && isNumber(proto.height)) {
    const offProto = !sameNumber(width, proto.width) || !sameNumber(height, proto.height);
    const stamped = isNumber(stamp?.width) && isNumber(stamp?.height);
    const offStamp = stamped && (!sameNumber(width, stamp.width) || !sameNumber(height, stamp.height));
    if (offProto && (locked || offStamp)) Object.assign(kept, { width, height });
  }
  const scaleX = stored.texture?.scaleX;
  const scaleY = stored.texture?.scaleY;
  const protoX = proto.texture?.scaleX;
  const protoY = proto.texture?.scaleY;
  if (isNumber(scaleX) && isNumber(scaleY) && isNumber(protoX) && isNumber(protoY) && (!sameNumber(scaleX, protoX) || !sameNumber(scaleY, protoY))) {
    Object.assign(kept, { scaleX, scaleY });
  }
  return kept;
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
