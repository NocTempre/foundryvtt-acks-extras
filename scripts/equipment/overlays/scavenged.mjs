/* global game */
/**
 * Overlay: scavenged equipment (RR p. 160; equipment RULES.md §11).
 * Gated by the `overlayScavenged` world setting.
 *
 * A condition table plus a planner (`toItemUpdates`) that returns updates on
 * fields core already owns: damage formula, `bonus.attack`, `weight6`,
 * `ac.value`. There is no runtime layer and nothing to intercept.
 *
 * Every figure is read from the Judge's own copy at import: the condition
 * grids, each row's effect and resale fraction, and the cap on stacked attack
 * and armour class penalties. This file holds the procedure only: which d20
 * band a result lands in, that a reroll row spawns two more rolls, that
 * effects accumulate. With a table not imported a roll refuses; with the cap
 * not read, nothing is capped. An item that breaks is recorded as a flag for
 * the Judge, never destroyed.
 * See docs/equipment/MODEL.md, "Scavenged condition (RR p. 160)".
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { bracketRow, citeOf, getDoc, getLayer, getTable, hasDoc, isMissingRow, PRIORITY } from "../../lib/tables.mjs";
import { attackBonusOf, damageFormulaOf } from "../properties.mjs";

/* -------------------------------------------------------------------------- */
/*  The IMPORTED tables (importer extraction → lib ruledata registry)  */
/* -------------------------------------------------------------------------- */

/** The ruledata document the scavenged tables and caps live in. */
export const RULEDATA_DOC = "equipment";

/** Condition table keys → the ruledata table ids the importer extracts (RR p. 160). */
export const RULEDATA_TABLES = Object.freeze({
  piercingSlashing: "scavengedPiercingSlashing",
  bludgeoning: "scavengedBludgeoning",
  armourEquipment: "scavengedArmorEquipment",
  vesselsVehicles: "scavengedVesselsVehicles",
});

/** The ruledata table holding the one figure that bounds stacked attack and armour class penalties. */
export const CAPS_TABLE = "scavengedCaps";

/**
 * The imported condition table for this key, or null when none is there.
 * Read through the lib ruledata registry, where a Judge's override wins.
 * @returns {object|null} rows keyed by d20 band max: {category, effect, value, min, max}
 */
export function importedTable(tableKey) {
  const id = RULEDATA_TABLES[tableKey];
  if (!id || !hasDoc(RULEDATA_DOC)) return null;
  try {
    const t = getTable(RULEDATA_DOC, id);
    return t && Object.keys(t).length ? t : null;
  } catch {
    return null; // the doc exists but not this table
  }
}

/**
 * Where a condition table's rows came from, for the control that offers them:
 * `judge` (set in the Ruledata Browser), `page` (read from the book; `cite` is
 * the page the importer recorded, or null), or `none` (not imported).
 * @returns {{state:"judge"|"page"|"none", cite:string|null}}
 */
export function scavengedSource(tableKey) {
  const id = RULEDATA_TABLES[tableKey];
  if (!id || !importedTable(tableKey)) return { state: "none", cite: null };
  if (getLayer(RULEDATA_DOC, PRIORITY.OVERRIDE)?.tables?.[id] != null) return { state: "judge", cite: null };
  return { state: "page", cite: citeOf(RULEDATA_DOC, id) };
}

/**
 * The floor attack and armour class penalties may not pass, as a negative
 * number, or null while the figure is not imported (nothing is then capped).
 * A Judge may type it with either sign; it is always a floor.
 */
export function scavengedPenaltyFloor() {
  if (!hasDoc(RULEDATA_DOC)) return null;
  const raw = getDoc(RULEDATA_DOC)?.tables?.[CAPS_TABLE]?.penalty;
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? -Math.abs(n) : null;
}

/** A signed integer captured by `re` from `text`, or 0. */
const signed = (text, re) => {
  const m = re.exec(text);
  return m ? parseInt(m[1].replace(/^\+/, ""), 10) : 0;
};

/**
 * Translate ONE imported row into the mechanical effects the module applies.
 * The row's own words are parsed into numbers; a phrase this does not recognise
 * is kept verbatim as a note for the Judge.
 */
export function rowToEffects(row) {
  const category = String(row?.category ?? "").trim();
  const effect = String(row?.effect ?? "").trim();
  const e = effect.toLowerCase();
  const out = { label: category, damage: 0, attack: 0, initiative: 0, encumbrance: 0, ac: 0, breaks: false, cannotSneak: false, reroll: false, value: 1, notes: [] };
  if (/roll\s+again/i.test(category)) return { ...out, reroll: true };

  out.damage = signed(e, /([+-]?\d+)\s*damage/);
  out.attack = signed(e, /([+-]?\d+)\s*to\s*attacks?/);
  out.initiative = signed(e, /([+-]?\d+)\s*to\s*initiative/);
  out.encumbrance = signed(e, /([+-]?\d+)\s*stone/);
  // Small caps put "AC" into the text layer as "Ac" — match case-insensitively.
  out.ac = signed(e, /([+-]?\d+)\s*a\s*c\b/);
  out.breaks = /break/.test(e);
  out.cannotSneak = /cannot\s+sneak/.test(e);
  // A percentage of the normal value; a negative one is a reduction.
  const v = /(-?\d+)\s*%/.exec(String(row?.value ?? ""));
  if (v) {
    const n = parseInt(v[1], 10);
    out.value = n < 0 ? 1 + n / 100 : n / 100;
  }
  // Anything the patterns above did not claim rides along as a note.
  if (effect && effect !== "-" && !out.damage && !out.attack && !out.initiative && !out.encumbrance && !out.ac && !out.breaks && !out.cannotSneak) {
    out.notes.push(effect);
  }
  return out;
}

/** The imported row covering a d20 result, or null. */
export function importedRow(tableKey, roll) {
  const table = importedTable(tableKey);
  if (!table) return null;
  const rows = Object.values(table);
  return bracketRow(rows, roll) ?? null;
}

/**
 * Accumulate imported rows (rerolls included) into one condition. Attack and
 * armour class penalties stop at the imported floor (`scavengedPenaltyFloor`);
 * with no floor imported they are not capped.
 * @param {string} tableKey
 * @param {number[]} rolls d20 results, in order
 * @returns {{labels:string[], damage:number, attack:number, initiative:number,
 *            encumbrance:number, ac:number, breaks:boolean, cannotSneak:boolean,
 *            notes:string[], valueMultiplier:number}}
 */
export function accumulateImported(tableKey, rolls) {
  const out = { labels: [], damage: 0, attack: 0, initiative: 0, encumbrance: 0, ac: 0, breaks: false, cannotSneak: false, notes: [], valueMultiplier: 1 };
  for (const roll of rolls) {
    const row = importedRow(tableKey, roll);
    if (!row) continue;
    const e = rowToEffects(row);
    if (e.reroll) continue; // the reroll row itself contributes nothing
    out.labels.push(e.label);
    out.damage += e.damage;
    out.attack += e.attack;
    out.initiative += e.initiative;
    out.encumbrance += e.encumbrance;
    out.ac += e.ac;
    out.breaks ||= e.breaks;
    out.cannotSneak ||= e.cannotSneak;
    out.notes.push(...e.notes);
    out.valueMultiplier *= e.value;
  }
  const floor = scavengedPenaltyFloor();
  if (floor != null) {
    out.attack = Math.max(floor, out.attack);
    out.ac = Math.max(floor, out.ac);
  }
  return out;
}

/** Does an imported row at this d20 result call for two more rolls? */
export function importedNeedsReroll(tableKey, roll) {
  const row = importedRow(tableKey, roll);
  return row ? /roll\s+again/i.test(String(row.category ?? "")) : false;
}

/** Whether the `overlayScavenged` world setting is on. */
export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_SCAVENGED);

/** Which table applies to an item. */
export function tableFor(item, profile) {
  if (item?.type === ITEM_TYPE.armor) return "armourEquipment";
  if (item?.type === ITEM_TYPE.weapon) {
    const type = String(profile?.type ?? "").toLowerCase();
    return type === "bludgeoning" ? "bludgeoning" : "piercingSlashing";
  }
  return "armourEquipment";
}

/**
 * Translate an accumulated condition into updates on fields core already owns.
 * @returns {object} a Foundry update object for the item
 */
export function toItemUpdates(item, cond) {
  const updates = {};
  if (item.type === ITEM_TYPE.weapon) {
    if (cond.attack) updates["system.bonus.attack"] = attackBonusOf(item) + cond.attack;
    if (cond.damage) {
      const base = damageFormulaOf(item) || "1d6";
      updates["system.damage.base.formula"] = `${base}${cond.damage}`; // e.g. "1d6" + "-1"
    }
  }
  if (item.type === ITEM_TYPE.armor && cond.ac) {
    updates["system.ac.value"] = Math.max(0, Number(item.system?.ac?.value ?? 0) + cond.ac);
  }
  if (cond.encumbrance) {
    updates["system.weight6"] = Math.max(0, Number(item.system?.weight6 ?? 0) + cond.encumbrance * 6);
  }
  updates[`flags.${MODULE_ID}.scavenged`] = {
    labels: cond.labels,
    breaks: cond.breaks,
    cannotSneak: cond.cannotSneak,
    initiative: cond.initiative,
    valueMultiplier: Number(cond.valueMultiplier.toFixed(2)),
  };
  return updates;
}
