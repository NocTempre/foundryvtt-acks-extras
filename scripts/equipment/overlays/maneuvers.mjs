/* global game */
/**
 * Overlay: special maneuvers (RR pp. 305–306; acks-rules/acks-equipment/RULES.md §10).
 * Gated by the `overlayManeuvers` world setting.
 *
 * Core models no maneuvers at all, so this is genuinely new rules code rather
 * than a correction to core behaviour. It stays a pure calculator plus a macro:
 * it computes the attack penalty and the target's saving-throw modifier, then
 * hands the actual attack to core's own rollAttack (through the same throwaway
 * plain-item copy the roll wrapper uses). Nothing about core's roll is replaced.
 *
 * RAW inputs that stack:
 *   - base penalty: −4 (sunder is −4 against staffs/spears/polearms, −6 otherwise)
 *   - Combat Trickery (chosen maneuver): penalty reduced by 2 AND the target
 *     saves at −2; if the maneuver affords no save, the penalty is reduced by 4
 *   - weapon qualities: Entangling +2 (knock down / wrestle), Flexible +2
 *     (disarm / knock down), Incapacitating +2 (incapacitate)
 *   - MM hooked weapons: as Combat Trickery for disarm
 *   - disarm: the target saves at +4 when wielding its weapon two-handed
 */
import { MODULE_ID, SETTINGS, EFFECT_DOMAINS } from "../constants.mjs";
import { collectStringFlags } from "../effects.mjs";

/**
 * RAW maneuver table. `save` null = no saving throw (Combat Trickery then
 * reduces the penalty by 4 rather than 2). `damage` = deals normal damage first.
 */
export const MANEUVERS = Object.freeze({
  disarm: { label: "Disarm", penalty: -4, save: "paralysis", damage: true, sizeAdjusted: false },
  forceBack: { label: "Force Back", penalty: -4, save: "paralysis", damage: true, sizeAdjusted: true },
  incapacitate: { label: "Incapacitate", penalty: -4, save: null, damage: true, nonlethal: true },
  knockDown: { label: "Knock Down", penalty: -4, save: "paralysis", damage: true, sizeAdjusted: true },
  overrun: { label: "Overrun", penalty: -4, save: "paralysis", damage: false, sizeAdjusted: false },
  sunder: { label: "Sunder", penalty: -6, penaltyVsShaft: -4, save: "paralysis", damage: true, sizeAdjusted: false },
  wrestling: { label: "Wrestle", penalty: -4, save: "paralysis", damage: false, sizeAdjusted: true, ignoresArmourAC: true },
});

/** Weapon qualities granting +2 to specific maneuvers (RR p. 127). */
const QUALITY_BONUS = Object.freeze({
  entangling: ["knockDown", "wrestling"],
  flexible: ["disarm", "knockDown"],
  incapacitating: ["incapacitate"],
});

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_MANEUVERS);
}

/** Maneuvers the actor has Combat Trickery for (lowercased tokens). */
export function trickeryFor(actor) {
  return collectStringFlags(actor, EFFECT_DOMAINS.MANEUVER_TRICKERY);
}

/**
 * Compute the RAW modifiers for attempting a maneuver.
 * @param {Actor} actor
 * @param {object} profile resolved weapon profile (profiles.classifyWeapon)
 * @param {string} key MANEUVERS key
 * @param {object} [opts]
 * @param {boolean} [opts.targetTwoHanded] disarm: target grips its weapon in both hands
 * @param {boolean} [opts.targetShaft] sunder: target weapon is a staff/spear/polearm
 * @param {boolean} [opts.hooked] MM hooked weapon (disarm)
 * @returns {{attackPenalty:number, targetSaveMod:number, save:string|null, notes:string[]}|null}
 */
export function maneuverMods(actor, profile, key, opts = {}) {
  const m = MANEUVERS[key];
  if (!m) return null;
  const notes = [];

  // Base penalty (sunder depends on what is being sundered).
  let attackPenalty = key === "sunder" && opts.targetShaft ? m.penaltyVsShaft : m.penalty;
  notes.push(`${m.label} base ${attackPenalty}`);

  let targetSaveMod = 0;

  // Combat Trickery: −4 → −2 (or to 0 when the maneuver affords no save), and
  // the opponent saves at −2.
  const trickery = trickeryFor(actor);
  const hasTrickery = trickery.has(key.toLowerCase());
  if (hasTrickery) {
    attackPenalty += m.save ? 2 : 4;
    if (m.save) targetSaveMod -= 2;
    notes.push(`Combat Trickery (${m.label}) ${m.save ? "+2, target saves −2" : "+4"}`);
  }

  // MM hooked weapons behave as Combat Trickery for disarm.
  if (key === "disarm" && opts.hooked && !hasTrickery) {
    attackPenalty += 2;
    targetSaveMod -= 2;
    notes.push("hooked weapon +2, target saves −2");
  }

  // Weapon qualities.
  for (const [quality, keys] of Object.entries(QUALITY_BONUS)) {
    if (keys.includes(key) && (profile?.special ?? []).includes(quality)) {
      attackPenalty += 2;
      notes.push(`${quality} weapon +2`);
    }
  }

  // Disarm: a two-handed grip is harder to break.
  if (key === "disarm" && opts.targetTwoHanded) {
    targetSaveMod += 4;
    notes.push("target wields two-handed: saves +4");
  }

  return { attackPenalty, targetSaveMod, save: m.save, notes };
}
