/**
 * Armour/shield/helmet/barding TABLE extraction → core `armor` items
 * (RR PDF p. 130). The recipe ships column GEOMETRY and canonical row NAMES
 * (locators); AC, encumbrance and cost materialize per-seat from the reader's
 * own book. Reuses the row primitives of weapon-tables.mjs (stripNoise,
 * bindRowCells).
 */
import { rowsByY, joinRuns } from "./table-extract.mjs";
import { stripNoise, bindRowCells, encToWeight6 } from "./weapon-tables.mjs";
import { MODULE_ID, DEFAULT_IMG } from "./constants.mjs";
import { bookText } from "./prose.mjs";

/** The armour table's recipe: its page, the anchors that identify it, and its column geometry. */
export const ARMOR_TABLE = Object.freeze({
  book: "rr",
  page: 130,
  anchors: ["Armor and Barding", "Leather Armor"], // section title + a known row
  labelMaxX: 175,
  rowTol: 3,
  // The category column is centered, so it is read as a band, not a point value.
  typeBand: { x0: 176, x1: 250 },
  columns: [
    { key: "ac", x: 262, tol: 12 },
    { key: "enc", x: 309, tol: 14 },
    { key: "cost", x: 356, tol: 20 },
    { key: "special", x: 500, w: 90 },
  ],
});

/**
 * Canonical armour rows — the shipped NAME list (locators). `re` matches the
 * extracted label band through the small-caps first-letter drop ("Ring Mail" →
 * "ing Mail", "Chain Mail" → "hain Mail"). Order is the printed table order.
 */
export const ARMOR_NAMES = [
  { name: "Hide and Fur Armor", re: /hide and fur/i },
  { name: "Padded Armor", re: /padded/i },
  { name: "Leather Armor", re: /^leather|[^,]leather armor/i },
  { name: "Arena Armor, Light", re: /arena armor, ?light/i },
  { name: "Ring Mail", re: /^r?ing mail/i },
  { name: "Scale Armor", re: /^scale/i },
  { name: "Chain Mail Armor", re: /^c?hain mail/i },
  { name: "Laminated Linen Armor", re: /laminated/i },
  { name: "Arena Armor, Heavy", re: /arena armor, ?heavy/i },
  { name: "Banded Plate Armor", re: /banded/i },
  { name: "Lamellar Armor", re: /^lamellar/i },
  { name: "Plate Armor", re: /^plate armor/i },
  { name: "Shield", re: /^shield$|^shield[^,]/i },
  { name: "Shield, Mirror", re: /shield, ?mirror/i },
  { name: "Helmet, Heavy", re: /helmet, ?heavy/i },
  { name: "Helmet, Light", re: /helmet, ?light/i },
  { name: "Barding, Leather", re: /barding, ?leather/i },
  { name: "Barding, Scale", re: /barding, ?scale/i },
  { name: "Barding, Chain", re: /barding, ?c?hain/i },
  { name: "Barding, Lamellar", re: /barding, ?lamellar/i },
  { name: "Barding, Plate", re: /barding, ?plate/i },
  { name: "Barding, Spiked", re: /barding, ?spiked/i },
];

/** Category text → core `armor` system.type; barding maps by its material. */
function armorType(category, name) {
  const c = String(category ?? "").toLowerCase();
  if (c.includes("shield")) return "shield";
  if (c.includes("very light")) return "veryLight";
  if (c.includes("light")) return "light";
  if (c.includes("heavy")) return "heavy";
  if (c.includes("medium")) return "medium";
  if (c.includes("barding")) {
    // Barding has no core armour category; map by material to the nearest.
    const n = String(name ?? "").toLowerCase();
    if (/plate|lamellar/.test(n)) return "heavy";
    if (/scale|chain/.test(n)) return "medium";
    return "light";
  }
  return "light";
}

/** AC cell → ac.value: its number, or 0 for a dash or a blank. */
function acValue(ac) {
  const m = String(ac ?? "").match(/[+-]?\d+/);
  const n = m ? Number(m[0]) : 0;
  return n < 0 ? 0 : n; // a dash grants no AC
}

/** Cost cell → gp. First number only; a "varies" or percentage cell → null. */
function costGp(cost) {
  const s = String(cost ?? "");
  if (/var|%/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)/);
  return m ? Number(m[1]) : null;
}

/** Read every armour data row (drops the section title, sub-headers, side-tab). */
export function extractArmorRows(items, recipe = ARMOR_TABLE) {
  const rows = rowsByY(stripNoise(items), recipe.rowTol ?? 3);
  const out = [];
  for (const r of rows) {
    const label = joinRuns(r.items.filter((it) => it.x < recipe.labelMaxX)).replace(/\s+/g, " ").trim();
    if (!label) continue;
    const category = joinRuns(r.items.filter((it) => it.x >= recipe.typeBand.x0 && it.x < recipe.typeBand.x1)).trim();
    const cells = bindRowCells(r.items.filter((it) => it.x >= recipe.typeBand.x1), recipe.columns);
    // A real armour row has a category AND an AC or cost; the "Armor" header,
    // the "Barding" sub-header and the "*" note have no category.
    if (!category) continue;
    if (!cells.ac && !cells.cost) continue;
    out.push({ label, category, cells });
  }
  return out;
}

/** Attach canonical names to the extracted rows by label match. */
export function extractArmor(items, recipe = ARMOR_TABLE, names = ARMOR_NAMES) {
  const rows = extractArmorRows(items, recipe);
  const used = new Set();
  const out = [];
  for (const spec of names) {
    const i = rows.findIndex((r, idx) => !used.has(idx) && spec.re.test(r.label));
    if (i < 0) continue;
    used.add(i);
    out.push({ name: spec.name, category: rows[i].category, cells: rows[i].cells });
  }
  return out;
}

/** True when a page is the armour-table page (both anchors present). */
export function isArmorPage(items, recipe = ARMOR_TABLE) {
  const joined = items.map((i) => i.str).join(" ");
  return (recipe.anchors ?? []).every((a) => joined.includes(a));
}

/** Locate the armour page by anchor (edition-independent) and extract. */
export async function extractArmorFromDoc(doc, readPage, recipe = ARMOR_TABLE) {
  const guess = recipe.page ?? 1;
  const order = [];
  for (let d = 0; d <= 14; d++) {
    if (guess + d <= doc.numPages) order.push(guess + d);
    if (d && guess - d >= 1) order.push(guess - d);
  }
  const seen = new Set(order);
  for (let p = 1; p <= doc.numPages; p++) if (!seen.has(p)) order.push(p);
  for (const p of order) {
    const { items } = await readPage(doc, p);
    if (isArmorPage(items, recipe)) return extractArmor(items, recipe);
  }
  return [];
}

/** Barding material from its name ("Barding, Scale" → "scale"), for the model. */
function bardingMaterial(name) {
  const m = String(name).match(/barding,\s*(\w+)/i);
  return m ? m[1].toLowerCase() : null;
}

/**
 * Build a core `armor` item from a materialized row.
 *
 * A barding row's encumbrance and cost depend on the mount's size, so the item
 * carries its AC and a `sizeScales` flag (with its material) that a consumer
 * resolves once a mount is known. Spiked barding is a cost multiplier and an
 * attack rider, not a base suit: it carries no AC and is flagged `modifier`.
 */
export function bindArmorRow(row, id, cite) {
  const c = row.cells ?? {};
  const type = armorType(row.category, row.name);
  const isHelmet = /helmet/i.test(row.name);
  const isBarding = /barding/i.test(row.name);
  const isSpiked = /spiked/i.test(row.name);
  const system = {
    description: bookText([], cite, { id, book: ARMOR_TABLE.book, page: ARMOR_TABLE.page }),
    ac: { value: acValue(c.ac) },
    type,
    equipped: false,
  };
  const weight6 = encToWeight6(c.enc);
  const cost = costGp(c.cost);
  if (weight6 != null) system.weight6 = weight6;
  if (cost != null) system.cost = cost;

  const armorFlag = { helmet: isHelmet, barding: isBarding, category: row.category };
  if (isBarding) {
    // Stated on the sheet and in the flag: cost and encumbrance come from the mount.
    system.description += `<p><em>${
      isSpiked
        ? "Adds +1 damage per die to the mount's natural attacks; cost +50%."
        : "Encumbrance and cost vary by the mount's size (RAW: “Varies”)."
    }</em></p>`;
    armorFlag.sizeScales = !isSpiked;
    armorFlag.material = bardingMaterial(row.name) ?? (isSpiked ? "spiked" : null);
    if (isSpiked) {
      armorFlag.modifier = true; // a rider on other barding, not a base suit
      armorFlag.costMultiplier = 1.5;
      armorFlag.bonusDamagePerDie = 1;
    }
  }

  return {
    name: row.name,
    type: "armor",
    img: type === "shield" ? DEFAULT_IMG.SHIELD : DEFAULT_IMG.ARMOR,
    system,
    flags: {
      [MODULE_ID]: { cookbook: { id, cite }, minted: true, armor: armorFlag },
    },
  };
}
