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
 * commander's level: a 3rd+ level leader may personally lead a platoon (30
 * infantry / 15 cavalry), 2nd a half-platoon (15), 1st a squad. Cavalry count
 * double toward the limit, so the group's strength and this capacity are both in
 * infantry-equivalents. 0th level cannot lead mercenaries into danger at all.
 *
 * NOTE the squad (1st-level) size is not in the local RR extract; 7 is used as a
 * documented interpretation (half of a half-platoon) until the Domains at War
 * value is confirmed. It only bites a 1st-level PC personally leading — hired
 * mercenary officers are all 4th+ level, so they always grant the full platoon.
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
 * An effect a deployed member picked up as DERIVED state — a module-managed
 * loadout effect, a re-appliable buff — must not be baked into the resting
 * record on recall, or it re-applies forever. The general marker: any effect
 * flagged `flags.<namespace>.managed = true`. Authored effects (a curse the
 * Judge put on this one kobold, with no managed marker) are kept.
 *
 * The specific markers each consuming module uses (e.g. acks-equipment's loadout
 * effect) are taught to this predicate through the `acksLibGroupIsDerivedEffect`
 * hook rather than the library hardcoding module ids.
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
 * The ONE ecology reader, and the ONLY consumption of acks-monsters data:
 * a monster's number-appearing → a size formula, soft-read so acks-monsters
 * stays an optional dependency. Returns a dice string; nothing auto-rolls it
 * (the Judge decides when a group is sized), and a source with no ecology data
 * returns null so the Judge types the size. The richer seams — lair chance,
 * supply cost, battle rating — are documented in group-data.mjs and deliberately
 * unread for now.
 *
 * @param {object} source - a prototype actor (may carry acks-monsters extras)
 * @param {"wilderness"|"dungeon"} [context]
 * @returns {string|null} a dice formula, or null if unstated
 */
export function sizeFromEcology(source, context = "wilderness") {
  if (!source) return null;
  const extras = source.getFlag?.("acks-monsters", "extras");
  const side = extras?.encounter?.[context];
  const rich = side?.wandering?.number || side?.lair?.number;
  if (rich) return String(rich).trim();
  const core = source.system?.details?.appearing?.[context === "dungeon" ? "d" : "w"];
  return core ? String(core).trim() : null;
}
