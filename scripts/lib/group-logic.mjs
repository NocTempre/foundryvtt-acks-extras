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
 * v0 → v1 group reshape (pure, idempotent): a single-stack group carried
 * `template`/`size`/`roster` at the top level; fold them into `stacks[0]`. A
 * fixed key ("primary") keeps the migration stable across the reloads before it
 * is next saved. GroupData.migrateData wraps this and then defers to super; the
 * pure half is here so it is offline-testable (the model needs Foundry to
 * construct). Mutates and returns `source`.
 */
export function migrateGroupSource(source) {
  if (source && typeof source === "object" && !Array.isArray(source.stacks)) {
    if (source.template || source.roster || source.size) {
      source.stacks = [
        {
          key: "primary",
          template: source.template ?? {},
          size: source.size ?? {},
          roster: Array.isArray(source.roster) ? source.roster : [],
        },
      ];
    }
  }
  return source;
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
 * A monster's number-appearing → a size dice formula, or null if unstated. See
 * docs/lib/GROUPS.md, "Ecology runway — READ only, deliberately unimplemented".
 * @param {object} source - a prototype actor (may carry monster extras)
 * @param {"wilderness"|"dungeon"} [context]
 * @returns {string|null} a dice formula, or null if unstated
 */
export function sizeFromEcology(source, context = "wilderness") {
  if (!source) return null;
  const extras = source.getFlag?.("acks-extras", "extras");
  const side = extras?.encounter?.[context];
  const rich = side?.wandering?.number || side?.lair?.number;
  if (rich) return String(rich).trim();
  const core = source.system?.details?.appearing?.[context === "dungeon" ? "d" : "w"];
  return core ? String(core).trim() : null;
}
