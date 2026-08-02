/**
 * Reads social-roll modifiers out of the **acks-abilities effect model** —
 * `item.flags["acks-abilities"].extras.effects[]`, in the acks-lib vocabulary —
 * so abilities imported by acks-content drive the roller without anyone
 * hand-authoring an Active Effect.
 *
 * This is the second of two sources. The first, in actor-data.mjs, reads
 * ActiveEffect documents keyed `flags.acks-influence.<family>`; that path stays
 * as the escape hatch for homebrew and for overriding an import. Both sources
 * normalize to ONE row shape carrying acks-lib scope fields, so
 * `scopeApplies()` decides both and there is a single place gating can be wrong.
 *
 * acks-abilities itself is NOT required: the extras are plain data on an item
 * flag, readable whether or not that module is active — which matters, because
 * acks-content writes the flag during import and a seat may not have installed
 * the sheet. acks-lib IS required, for the level-value and scope semantics.
 */
import { CHANGE_KEY_FAMILY, ROLL_FAMILY } from "./constants.mjs";

const ABILITIES_FLAG = "acks-abilities";

/** The roll families this roller hosts, keyed by acks-lib MODIFIER_TARGETS. */
const SOCIAL_TARGETS = new Set([ROLL_FAMILY.REACTION, ROLL_FAMILY.LOYALTY, ROLL_FAMILY.MORALE]);

/** A character's class level, for resolving level-scaling values. */
function actorLevel(actor) {
  const level = Number(actor?.system?.details?.level);
  return Number.isFinite(level) && level > 0 ? level : 1;
}

/**
 * Social-roll modifiers from an actor's abilities.
 *
 * `skipItemIds` are items that already contributed through the ActiveEffect
 * path. An item carrying both an AE and extras would otherwise be counted
 * twice, and the AE wins: a GM who hand-added one to an imported ability meant
 * to override what the import classified.
 *
 * @param {Actor|null} actor
 * @param {Set<string>} [skipItemIds]
 * @returns {Array} rows in the shared modifier shape (see actor-data.mjs)
 */
export function getAbilityReactionMods(actor, skipItemIds = new Set()) {
  if (!actor?.items) return [];
  // acks-lib's ladder authority, reached through the public global (as abilities
  // does for the same resolveLevelValue) rather than a static deep import, so a
  // missing or late-loading lib degrades to "no ability-sourced mods" instead of
  // throwing at module load. acks-lib is a hard requirement, so in a correctly
  // configured world this is always present.
  const resolveLevelValue = globalThis.acksLib?.resolveLevelValue;
  if (!resolveLevelValue) return [];
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

      // A level ladder resolves against THIS actor's level; a scale the effect
      // needs but nobody supplied resolves to null, and a modifier whose value
      // is unknown is not a modifier — skip rather than treat it as zero.
      const value = resolveLevelValue(effect.value, level, { level, rank: 1 });
      if (!Number.isFinite(value) || value === 0) continue;

      out.push({
        id: `abil:${item.id}:${i}`,
        label: item.name || "Ability",
        value,
        family: effect.target,
        // Whose roll this modifies. The roller resolves ONE actor's social
        // roll, so an effect aimed at an opponent or an ally is not a modifier
        // on it — storing it as one is the inversion EFFECT_SUBJECTS exists to
        // prevent. Carried through so a future opposed mode can use it.
        appliesTo: effect.appliesTo || "self",
        // A machine-classified effect carries a free-text condition it could
        // not structure; that is precisely a situational modifier. An effect
        // the chef audited and left unconditional applies on its own.
        situational: Boolean(effect.condition) || Boolean(extras.unaudited),
        // Scope fields are already acks-lib vocabulary — passed straight to
        // scopeApplies with no translation, unlike the AE path.
        vsKinds: (effect.vsKinds ?? []).map((k) => String(k).toLowerCase()),
        vsAlignment: effect.vsAlignment || null,
        vsAlignmentMode: effect.vsAlignmentMode || "gate",
        tones: effect.tones ?? [],
        optionalRule: effect.optionalRule || null,
        kickerAt: Number.isFinite(effect.kickerAt) ? effect.kickerAt : null,
        kickerNote: effect.kickerNote || "",
        // The mechanics were classified by a generic scan, not read against the
        // page by a chef. A wrong sign or a missed condition must present as
        // unverified rather than as the book's ruling, so the row is badged and
        // never pre-checked (see #buildModConfig).
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
    const parentId = effect.parent?.id;
    if (parentId) ids.add(parentId);
  }
  return ids;
}
