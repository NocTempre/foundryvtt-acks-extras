/* global game */
/**
 * Overlay: scavenged equipment (RR p. 160; acks-rules/acks-equipment/RULES.md §11).
 * Gated by the `overlayScavenged` world setting.
 *
 * Reuse first: every RAW result is expressible in fields core already has —
 * "-1 damage" is a "1d6-1" damage string, "-1 to attacks" is `system.bonus`,
 * "+1 stone encumbrance" is `weight6`, "-1 AC" is `aac.value`. So this is a
 * table plus a planner that returns core-field updates; there is no runtime
 * layer and nothing to intercept.
 *
 * Effects are cumulative: a 19-20 result rolls twice more. Damage penalties
 * cannot take a weapon below 1 point, and AC/attack penalties cannot exceed -5.
 * Items that "break" are destroyed on an unmodified 1 when used (long weapons on
 * 1-3) — recorded as a flag for the Judge rather than auto-destroying.
 */
import { MODULE_ID, SETTINGS } from "../constants.mjs";

/** d20 → condition. `reroll` means roll twice more and apply both (19-20). */
export const SCAVENGED_TABLES = Object.freeze({
  piercingSlashing: [
    { max: 2, label: "Serviceable", value: 1 },
    { max: 6, label: "Blade dented", damage: -1, value: 0.67 },
    { max: 10, label: "Blade rusty", damage: -1, value: 0.67 },
    { max: 14, label: "Off balance", attack: -1, value: 0.67 },
    { max: 16, label: "Loose hilt/haft", initiative: -1, value: 0.67 },
    { max: 18, label: "Shoddy construction", breaks: true, value: 0.67 },
    { max: 20, label: "Roll again twice", reroll: true },
  ],
  bludgeoning: [
    { max: 2, label: "Serviceable", value: 1 },
    { max: 6, label: "Soft head", damage: -1, value: 0.67 },
    { max: 10, label: "Wobbly head", damage: -1, value: 0.67 },
    { max: 14, label: "Off balance", attack: -1, value: 0.67 },
    { max: 16, label: "Fragile haft", initiative: -1, value: 0.67 },
    { max: 18, label: "Shoddy construction", breaks: true, value: 0.67 },
    { max: 20, label: "Roll again twice", reroll: true },
  ],
  armourEquipment: [
    { max: 2, label: "Serviceable", value: 1 },
    { max: 6, label: "Broken straps", encumbrance: 1, value: 0.67 },
    { max: 10, label: "Rattles if moved", cannotSneak: true, value: 0.67 },
    { max: 14, label: "Dented/rotting", ac: -1, breaks: true, value: 0.67 },
    { max: 16, label: "Makeshift work", ac: -1, breaks: true, value: 0.67 },
    { max: 18, label: "Torn/ripped", breaks: true, value: 0.67 },
    { max: 20, label: "Roll again twice", reroll: true },
  ],
});

/** RAW caps: attack/AC penalties never worse than -5; damage never below 1. */
export const SCAVENGED_CAPS = Object.freeze({ attack: -5, ac: -5, minDamage: 1 });

/* -------------------------------------------------------------------------- */
/*  The IMPORTED table (acks-content extraction → acks-lib ruledata registry)  */
/* -------------------------------------------------------------------------- */

/** Our table keys → the ruledata table ids acks-content extracts (RR p160). */
export const RULEDATA_DOC = "equipment";
export const RULEDATA_TABLES = Object.freeze({
  piercingSlashing: "scavengedPiercingSlashing",
  bludgeoning: "scavengedBludgeoning",
  armourEquipment: "scavengedArmorEquipment",
  vesselsVehicles: "scavengedVesselsVehicles",
});

/**
 * The GM's OWN imported condition table for this key, or null.
 *
 * Read through acks-lib's ruledata registry, which is where acks-content lands
 * the table it extracted from the reader's own book. No values ship here — this
 * is the seat's own page — so when it is present it OUTRANKS the built-in table.
 * @returns {object|null} rows keyed by d20 band max: {category, effect, value, min, max}
 */
export function importedTable(tableKey) {
  const id = RULEDATA_TABLES[tableKey];
  const reg = globalThis.acksLib?.tables;
  if (!id || !reg?.hasDoc?.(RULEDATA_DOC)) return null;
  try {
    const t = reg.getTable(RULEDATA_DOC, id);
    return t && Object.keys(t).length ? t : null;
  } catch {
    return null; // the doc exists but not this table
  }
}

/** A signed integer captured by `re` from `text`, or 0. */
const signed = (text, re) => {
  const m = re.exec(text);
  return m ? parseInt(m[1].replace(/^\+/, ""), 10) : 0;
};

/**
 * Translate ONE imported row into the mechanical effects the module applies.
 *
 * The row carries the reader's own printed words ("-1 damage", "Breaks",
 * "+1 stone encumbrance", "-33%"); this reads that small, fixed vocabulary into
 * numbers. It is a parse of the page, not an interpretation of intent — an
 * effect phrase it does not recognise is preserved verbatim as a note for the
 * Judge rather than silently dropped.
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
  // Percentage of normal value: "100%" → 1, "-33%" → 0.67.
  const v = /(-?\d+)\s*%/.exec(String(row?.value ?? ""));
  if (v) {
    const n = parseInt(v[1], 10);
    out.value = n < 0 ? 1 + n / 100 : n / 100;
  }
  // Anything the vocabulary above did not claim (the vessel table's cargo,
  // speed and structural-hp effects) rides along as a note.
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
  const reg = globalThis.acksLib?.tables;
  const hit = reg?.bracketRow?.(rows, roll) ?? rows.find((r) => roll >= Number(r.min) && roll <= Number(r.max));
  return hit ?? null;
}

/** Accumulate imported rows into one condition, mirroring `accumulate`. */
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
  out.attack = Math.max(SCAVENGED_CAPS.attack, out.attack);
  out.ac = Math.max(SCAVENGED_CAPS.ac, out.ac);
  return out;
}

/** Does an imported row at this d20 result call for two more rolls? */
export function importedNeedsReroll(tableKey, roll) {
  const row = importedRow(tableKey, roll);
  return row ? /roll\s+again/i.test(String(row.category ?? "")) : false;
}

export function overlayEnabled() {
  return !!game.settings.get(MODULE_ID, SETTINGS.OVERLAY_SCAVENGED);
}

/** Which table applies to an item. */
export function tableFor(item, profile) {
  if (item?.type === "armor") return "armourEquipment";
  if (item?.type === "weapon") {
    const type = String(profile?.type ?? "").toLowerCase();
    return type === "bludgeoning" ? "bludgeoning" : "piercingSlashing";
  }
  return "armourEquipment";
}

/** Look up one d20 result on a table. */
export function lookup(tableKey, roll) {
  const rows = SCAVENGED_TABLES[tableKey];
  if (!rows) return null;
  return rows.find((r) => roll <= r.max) ?? rows[rows.length - 1];
}

/**
 * Accumulate results (rerolls included) into one condition.
 * @param {string} tableKey
 * @param {number[]} rolls d20 results, in order
 * @returns {{labels:string[], damage:number, attack:number, initiative:number,
 *            encumbrance:number, ac:number, breaks:boolean, cannotSneak:boolean,
 *            valueMultiplier:number}}
 */
export function accumulate(tableKey, rolls) {
  const out = { labels: [], damage: 0, attack: 0, initiative: 0, encumbrance: 0, ac: 0, breaks: false, cannotSneak: false, valueMultiplier: 1 };
  for (const roll of rolls) {
    const row = lookup(tableKey, roll);
    if (!row || row.reroll) continue; // the reroll row itself contributes nothing
    out.labels.push(row.label);
    out.damage += row.damage ?? 0;
    out.attack += row.attack ?? 0;
    out.initiative += row.initiative ?? 0;
    out.encumbrance += row.encumbrance ?? 0;
    out.ac += row.ac ?? 0;
    out.breaks ||= !!row.breaks;
    out.cannotSneak ||= !!row.cannotSneak;
    out.valueMultiplier *= row.value ?? 1;
  }
  out.attack = Math.max(SCAVENGED_CAPS.attack, out.attack);
  out.ac = Math.max(SCAVENGED_CAPS.ac, out.ac);
  return out;
}

/** How many d20s a result set needs (each 19-20 spawns two more rolls). */
export function needsReroll(tableKey, roll) {
  return !!lookup(tableKey, roll)?.reroll;
}

/**
 * Translate an accumulated condition into updates on fields CORE already owns —
 * no runtime overlay required.
 * @returns {object} a Foundry update object for the item
 */
export function toItemUpdates(item, cond) {
  const updates = {};
  if (item.type === "weapon") {
    if (cond.attack) updates["system.bonus"] = Number(item.system?.bonus ?? 0) + cond.attack;
    if (cond.damage) {
      const base = String(item.system?.damage ?? "1d6");
      updates["system.damage"] = `${base}${cond.damage}`; // e.g. "1d6" + "-1"
    }
  }
  if (item.type === "armor" && cond.ac) {
    updates["system.aac.value"] = Math.max(0, Number(item.system?.aac?.value ?? 0) + cond.ac);
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
