/* global game */
/**
 * Overlay: special maneuvers (RR pp. 305–306; equipment RULES.md §10).
 * Gated by the `overlayManeuvers` world setting.
 *
 * Core models no maneuvers. This is a pure calculator plus a macro: it
 * computes the attack penalty and the target's saving-throw modifier, then
 * hands the attack to the system's own attack throw, the manoeuvre declared
 * through `options.acksLib.maneuver` and its penalty riding the throw as a
 * labelled row. Core's roll is not replaced.
 *
 * The procedure ships: which manoeuvres exist, which save each allows, whether
 * it deals damage, whether size adjusts it, and what stacks on the penalty.
 * Every size is the Judge's import (the `equipment` document's
 * `maneuverDisarm`, `maneuverPenalties`, `combatTrickery`, `maneuverQualities`
 * and `hookedWeapon` tables); a part not read leaves the figure it sizes null.
 *
 * What stacks:
 *   - the manoeuvre's own penalty (sunder's depends on what is sundered);
 *   - Combat Trickery (the chosen maneuver): the penalty is reduced and the
 *     target's save worsens; a maneuver that affords no save has the other,
 *     larger reduction instead (RR p. 109);
 *   - weapon qualities (Entangling: knock down and wrestle; Flexible: disarm
 *     and knock down; Incapacitating: incapacitate), each a bonus (RR p. 127);
 *   - MM hooked weapons: as Combat Trickery, for disarm;
 *   - disarm: the target's save improves against a two-handed grip.
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS, EFFECT_DOMAINS } from "../constants.mjs";
import { collectStringFlags } from "../effects.mjs";
import { hasDoc, getDoc } from "../../lib/tables.mjs";
import { RULEDATA_DOC } from "./scavenged.mjs";

/**
 * The `equipment` tables this overlay reads. The ids are written as literals in
 * `module.mjs` `expectTables`, because the producers gate reads that call from
 * source. Disarm's folio is its own table; the rest of the manoeuvres share one.
 */
export const MANEUVER_TABLES = Object.freeze({
  disarm: "maneuverDisarm",
  penalties: "maneuverPenalties",
  trickery: "combatTrickery",
  qualities: "maneuverQualities",
  hooked: "hookedWeapon",
});

/**
 * Maneuver table. `save` null = no saving throw (Combat Trickery then takes
 * the no-save reduction). `damage` = deals normal damage first. `shaftVariant`
 * marks the one manoeuvre whose penalty depends on the target's weapon (sunder).
 * No entry states a penalty: those are `maneuverFigures()`.
 */
export const MANEUVERS = Object.freeze({
  disarm: { label: "Disarm", save: "paralysis", damage: true, sizeAdjusted: false },
  forceBack: { label: "Force Back", save: "paralysis", damage: true, sizeAdjusted: true },
  incapacitate: { label: "Incapacitate", save: null, damage: true, nonlethal: true },
  knockDown: { label: "Knock Down", save: "paralysis", damage: true, sizeAdjusted: true },
  overrun: { label: "Overrun", save: "paralysis", damage: false, sizeAdjusted: false },
  sunder: { label: "Sunder", save: "paralysis", damage: true, sizeAdjusted: false, shaftVariant: true },
  wrestling: { label: "Wrestle", save: "paralysis", damage: false, sizeAdjusted: true, ignoresArmourAC: true },
});

/** The weapon qualities that grant a bonus to specific maneuvers (RR p. 127). */
const QUALITY_BONUS = Object.freeze({
  entangling: ["knockDown", "wrestling"],
  flexible: ["disarm", "knockDown"],
  incapacitating: ["incapacitate"],
});

/** Whether the `overlayManeuvers` world setting is on. */
export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_MANEUVERS);

/** One figure of an `equipment` table as a finite number, or null when the table, the field or its number is not there. */
function figureOf(table, field) {
  const row = hasDoc(RULEDATA_DOC) ? getDoc(RULEDATA_DOC)?.tables?.[table] : null;
  const raw = row && typeof row === "object" ? row[field] : null;
  if (raw == null || raw === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

/** Maneuvers the actor has Combat Trickery for (lowercased tokens). */
export function trickeryFor(actor) {
  return collectStringFlags(actor, EFFECT_DOMAINS.MANEUVER_TRICKERY);
}

/** The sum of two parts, null while either is not read. */
const plus = (total, part) => (total == null || part == null ? null : total + part);

/** A modifier with its sign, for the notes. */
const sign = (n) => (n > 0 ? `+${n}` : String(n));

/**
 * Compute the modifiers for attempting a maneuver from the Judge's imported
 * figures. A part that applies and is not imported leaves `attackPenalty` (or
 * `targetSaveMod`) null, never the sum of the parts that did read, and its
 * table field is named in `missing`.
 * @param {Actor} actor
 * @param {object} profile resolved weapon profile (profiles.classifyWeapon)
 * @param {string} key MANEUVERS key
 * @param {object} [opts]
 * @param {boolean} [opts.targetTwoHanded] disarm: target grips its weapon in both hands
 * @param {boolean} [opts.targetShaft] sunder: target weapon is a staff/spear/polearm
 * @param {boolean} [opts.hooked] MM hooked weapon (disarm)
 * @returns {{attackPenalty:number|null, targetSaveMod:number|null, save:string|null,
 *   notes:string[], missing:string[], parts:{part:string, value:number, table:string}[]}|null}
 *   `parts` are the attack penalty's read parts (`base`, `trickery`, `hooked`, or
 *   a weapon quality's key) with the `equipment` table each came from; `missing`
 *   is `<table>.<field>` for every part needed and not read. Null for an unknown key.
 */
export function maneuverMods(actor, profile, key, opts = {}) {
  const m = MANEUVERS[key];
  if (!m) return null;
  const notes = [];
  const missing = [];
  const parts = [];
  const read = (table, field) => {
    const v = figureOf(table, field);
    if (v == null) missing.push(`${table}.${field}`);
    return v;
  };

  // The manoeuvre's own penalty (sunder depends on what is being sundered).
  const sundersShaft = m.shaftVariant && opts.targetShaft;
  const baseTable = key === "disarm" ? MANEUVER_TABLES.disarm : MANEUVER_TABLES.penalties;
  const baseField = sundersShaft ? `${key}Shaft` : key;
  const base = read(baseTable, baseField);
  if (base != null) {
    parts.push({ part: "base", value: base, table: baseTable });
    notes.push(`${m.label} base ${sign(base)}`);
  }
  let attackPenalty = base;
  let targetSaveMod = 0;

  // Combat Trickery reduces the penalty and worsens the target's save; a
  // maneuver that affords no save takes the other reduction.
  const hasTrickery = trickeryFor(actor).has(key.toLowerCase());
  if (hasTrickery) {
    const reduction = read(MANEUVER_TABLES.trickery, m.save ? "reduction" : "noSaveReduction");
    attackPenalty = plus(attackPenalty, reduction);
    if (reduction != null) {
      parts.push({ part: "trickery", value: reduction, table: MANEUVER_TABLES.trickery });
      notes.push(`Combat Trickery (${m.label}) ${sign(reduction)}`);
    }
    if (m.save) targetSaveMod = plus(targetSaveMod, read(MANEUVER_TABLES.trickery, "saveMod"));
  }

  // MM hooked weapons behave as Combat Trickery for disarm.
  if (key === "disarm" && opts.hooked && !hasTrickery) {
    const reduction = read(MANEUVER_TABLES.hooked, "reduction");
    attackPenalty = plus(attackPenalty, reduction);
    if (reduction != null) {
      parts.push({ part: "hooked", value: reduction, table: MANEUVER_TABLES.hooked });
      notes.push(`hooked weapon ${sign(reduction)}`);
    }
    targetSaveMod = plus(targetSaveMod, read(MANEUVER_TABLES.hooked, "saveMod"));
  }

  // Weapon qualities.
  for (const [quality, keys] of Object.entries(QUALITY_BONUS)) {
    if (!keys.includes(key) || !(profile?.special ?? []).includes(quality)) continue;
    const bonus = read(MANEUVER_TABLES.qualities, quality);
    attackPenalty = plus(attackPenalty, bonus);
    if (bonus != null) {
      parts.push({ part: quality, value: bonus, table: MANEUVER_TABLES.qualities });
      notes.push(`${quality} weapon ${sign(bonus)}`);
    }
  }

  // Disarm: a two-handed grip is harder to break.
  if (key === "disarm" && opts.targetTwoHanded) {
    const bonus = read(MANEUVER_TABLES.disarm, "twoHandedSave");
    targetSaveMod = plus(targetSaveMod, bonus);
    if (bonus != null) notes.push(`target wields two-handed: saves ${sign(bonus)}`);
  }

  return { attackPenalty, targetSaveMod, save: m.save, notes, missing, parts };
}
