/**
 * Reads social-roll modifiers out of the abilities feature's effect model —
 * `item.flags["acks-extras"].extras.effects[]`, in the lib subsystem's
 * vocabulary — so abilities imported by the importer drive the roller without
 * anyone hand-authoring an Active Effect.
 *
 * The second of two sources. The first, in actor-data.mjs, reads ActiveEffect
 * documents keyed `flags.acks-extras.<family>` — the escape hatch for
 * homebrew and for overriding an import. Both sources normalize to one row
 * shape carrying the lib subsystem's scope fields, so `scopeApplies()`
 * decides both.
 *
 * The abilities sheet is not required: the extras are plain data on an item
 * flag, readable without it, which the importer writes without ever opening
 * that sheet.
 */
import { CHANGE_KEY_FAMILY, ROLL_FAMILY } from "./constants.mjs";
import { resolveLevelValue } from "../lib/vocab.mjs";

const ABILITIES_FLAG = "acks-extras";

/** The roll families this roller hosts, keyed by the lib subsystem's MODIFIER_TARGETS. */
const SOCIAL_TARGETS = new Set([ROLL_FAMILY.REACTION, ROLL_FAMILY.LOYALTY, ROLL_FAMILY.MORALE]);

/** A character's class level, for resolving level-scaling values. */
function actorLevel(actor) {
  const level = Number(actor?.system?.details?.level);
  return Number.isFinite(level) && level > 0 ? level : 1;
}

/**
 * Social-roll modifiers from an actor's abilities.
 *
 * `skipItemIds` names items already counted through the ActiveEffect path,
 * so an item carrying both is not counted twice. See
 * docs/influence/DECISIONS.md, "A hand-added Active Effect overrides an
 * imported ability's own".
 *
 * @param {Actor|null} actor
 * @param {Set<string>} [skipItemIds]
 * @returns {Array} rows in the shared modifier shape (see actor-data.mjs)
 */
export function getAbilityReactionMods(actor, skipItemIds = new Set()) {
  if (!actor?.items) return [];
  const level = actorLevel(actor);
  const out = [];

  for (const item of actor.items) {
    if (skipItemIds.has(item.id)) continue;
    const extras = item.getFlag?.(ABILITIES_FLAG, "extras") ?? item.flags?.[ABILITIES_FLAG]?.extras;
    const effects = extras?.effects;
    if (!Array.isArray(effects) || !effects.length) continue;

    let idx = 0;
    for (const effect of effects) {
      const i = idx++;
      if (effect?.type !== "modifier") continue;
      if (!SOCIAL_TARGETS.has(effect.target)) continue;

      // A level ladder resolves against THIS actor's level. See
      // docs/influence/DECISIONS.md, "An unknown is not a modifier".
      const value = resolveLevelValue(effect.value, level, { level, rank: 1 });
      if (!Number.isFinite(value) || value === 0) continue;

      out.push({
        id: `abil:${item.id}:${i}`,
        itemId: item.id,
        label: item.name || "Ability",
        value,
        family: effect.target,
        // Whose roll this modifies; carried through unapplied for a future
        // opposed mode. See docs/influence/DECISIONS.md, "The subject of an
        // effect is carried, not folded in".
        appliesTo: effect.appliesTo || "self",
        // A free-text `condition` marks a situational modifier; an audited
        // effect with none applies unconditionally.
        situational: Boolean(effect.condition) || Boolean(extras.unaudited),
        // Scope fields are already the lib subsystem's vocabulary — passed
        // straight to scopeApplies with no translation, unlike the AE path.
        vsKinds: (effect.vsKinds ?? []).map((k) => String(k).toLowerCase()),
        vsAlignment: effect.vsAlignment || null,
        vsAlignmentMode: effect.vsAlignmentMode || "gate",
        tones: effect.tones ?? [],
        optionalRule: effect.optionalRule || null,
        kickerAt: Number.isFinite(effect.kickerAt) ? effect.kickerAt : null,
        kickerNote: effect.kickerNote || "",
        // Machine-classified, not chef-audited. See
        // docs/influence/DECISIONS.md, "Modifiers are offered, never
        // asserted".
        unaudited: Boolean(extras.unaudited),
        source: "ability",
      });
    }
  }
  return out;
}

/**
 * Item ids whose ActiveEffects already feed the roller, so the abilities model
 * stands aside for them and nothing is counted twice.
 *
 * Only effects carrying a social change key count. An item with an unrelated
 * Active Effect — a speed bonus, a damage rider — has not spoken about social
 * rolls at all, and must not suppress what its abilities model says about them.
 *
 * @param {Actor|null} actor
 * @returns {Set<string>}
 */
export function itemsWithReactionEffects(actor) {
  const ids = new Set();
  for (const effect of actor?.appliedEffects ?? actor?.effects ?? []) {
    if (effect.disabled) continue;
    const social = (effect.changes ?? []).some((c) => Object.hasOwn(CHANGE_KEY_FAMILY, String(c.key ?? "")));
    if (!social) continue;
    // Only an effect riding an item claims one; an effect written straight onto
    // the actor has no item, and its parent's id is the actor's.
    if (effect.parent?.documentName === "Item") ids.add(effect.parent.id);
  }
  return ids;
}
