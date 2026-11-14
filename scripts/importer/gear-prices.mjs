/**
 * Gear + clothing PRICE extraction (RR p131 Adventuring Equipment, p132
 * Clothing) → a name→{cost,weight6} map that enriches the gear/clothing
 * cookbook items (which carry names + descriptions but no price).
 *
 * These pages are two-column price grids (Item/Cost/Enc on each side). The
 * geometry ships; the prices come from the reader's own book. Cost is in gp,
 * converted from the gp/sp/cp the book prints.
 */
import { rowsByY, joinRuns } from "./table-extract.mjs";
import { encToWeight6 } from "./weapon-tables.mjs";

/**
 * Drop only footnote marks, never the weapon tables' `stripNoise`: it also eats
 * single-letter runs matching the side-tab and would swallow a small-capped
 * first letter. The running header has no price and is filtered out by the
 * price requirement.
 */
function dropMarks(items) {
  return items.filter((it) => it.str && it.str.trim() && !/^[*†‡]+$/.test(it.str.trim()));
}

/** Column layout for one side of a two-column grid. */
const SIDE = (nameX0, nameX1, costX, encX) => ({ nameX0, nameX1, costX, encX });

/**
 * Run gap (in page units) above which two runs of a name are separate words.
 * A name arrives as several runs and the space between words is geometry, not
 * a character: with no threshold words run together, and at too fine a
 * threshold the kerning inside a word splits it. The value sits in the middle
 * of the band that reproduces the printed spacing.
 */
const NAME_GAP = 1;

/**
 * The price grids by recipe name: the printed page each is read from, the
 * anchors that identify the page, the row tolerance, and the column bands of
 * each side (`SIDE`).
 */
export const PRICE_TABLES = Object.freeze({
  gear: {
    page: 131,
    anchors: ["Adventuring Equipment", "Adventurer"],
    rowTol: 3,
    sides: [SIDE(70, 222, 232, 290), SIDE(322, 472, 479, 537)],
  },
  clothing: {
    page: 132,
    anchors: ["Clothing", "Belt"],
    rowTol: 3,
    sides: [SIDE(45, 242, 247, null), SIDE(296, 488, 493, null)],
  },
});

/**
 * The printed name as a name: the grid small-caps the opening letter of each
 * comma-separated part, which extracts lowercase (RR p. 130). Only that letter
 * is restored; no other capital is added.
 */
export function tidyRowName(name) {
  return String(name ?? "")
    .split(",")
    .map((part) => part.trim().replace(/^([a-z])/, (c) => c.toUpperCase()))
    .filter(Boolean)
    .join(", ");
}

/** Normalise a name to a lookup key (matches the gear entries). */
export function priceKey(name) {
  return String(name ?? "")
    .toLowerCase()
    .replace(/\(.*?\)/g, "") // drop parenthetical qualifiers
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Look up a gear/clothing entry's price. Exact key first; then an unambiguous
 * prefix: exactly one priced variant whose key extends the entry's. A category
 * with several priced variants returns null, since it is not one priced item.
 * @returns {{cost:number|null, weight6:number|null}|null}
 */
export function priceFor(map, name) {
  const k = priceKey(name);
  if (!k) return null;
  if (map.has(k)) return map.get(k);
  const variants = [...map.keys()].filter((gk) => gk.startsWith(k) && gk.length > k.length);
  return variants.length === 1 ? map.get(variants[0]) : null;
}

/** A price in gp from a gp/sp/cp amount (a trailing note is ignored); null for "Varies" or a blank cell. */
export function parseCost(text) {
  // Thousands separators go first: left in, they end the number early.
  // No \b after the group: the unit follows the digits with no boundary.
  const s = String(text ?? "").replace(/(\d)[,\s]+(?=\d{3}(?!\d))/g, "$1").trim();
  if (!s || /var/i.test(s)) return null;
  const m = s.match(/(\d+(?:\.\d+)?)\s*(gp|sp|cp)/i);
  if (!m) {
    const bare = s.match(/(\d+(?:\.\d+)?)/);
    return bare ? Number(bare[1]) : null;
  }
  const n = Number(m[1]);
  const unit = m[2].toLowerCase();
  return unit === "sp" ? n / 10 : unit === "cp" ? n / 100 : n;
}

/**
 * The stone a row's printed label says its item holds, or null when the label
 * states none: a parenthetical that opens "holds", then a whole, decimal or
 * fractional figure and "stone" or "st.". Only the pattern ships; the figure
 * is the reader's page.
 */
export function labelCapacity(name) {
  const m = /\(\s*holds\s+(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?\s*(?:stones?|st)\b\.?\s*\)/i.exec(String(name ?? ""));
  if (!m) return null;
  const stone = m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]);
  return Number.isFinite(stone) && stone >= 0 ? stone : null;
}

/**
 * The capacity a price lookup states for the entry `name`: the matched row's
 * own, and only when that row IS the entry. `priceFor` falls back to the one
 * variant whose key extends the entry's, and a variant's label states the
 * variant's capacity, not the entry's.
 * @param {{name:string, capacity?:number|null}|null} priced what `priceFor` returned
 * @returns {number|null}
 */
export function capacityFor(priced, name) {
  return priced?.capacity != null && priceKey(priced.name) === priceKey(name) ? priced.capacity : null;
}

/**
 * The whole cell at an x-anchor: every run within tol, in x order, joined.
 * The nearest run alone truncates a price split across runs.
 */
function cellAt(runs, x, tol = 16) {
  return runs
    .filter((r) => Math.abs(r.x - x) <= tol)
    .sort((a, b) => a.x - b.x)
    .map((r) => r.str.trim())
    .join("")
    .trim();
}

/**
 * Extract every {name, cost, weight6, section} from a price grid (both columns).
 *
 * A price page can stack several sections under one grid, and the heading
 * above a row is the only statement of what the row is. Each row carries the
 * last heading seen, verbatim; nothing here knows which headings mean anything.
 * @returns {{name:string, cost:number|null, weight6:number|null, section:string}[]}
 */
export function extractPrices(items, recipe) {
  const rows = rowsByY(dropMarks(items), recipe.rowTol ?? 3);
  const out = [];
  let section = "";
  for (const r of rows) {
    const names = [];
    let priced = 0;
    for (const side of recipe.sides) {
      names.push("");
      const nameRuns = r.items.filter((it) => it.x >= side.nameX0 && it.x < side.nameX1);
      const raw = joinRuns(nameRuns, recipe.nameGap ?? NAME_GAP).replace(/\s+/g, " ").trim();
      if (!raw || raw.length < 2) continue;
      // A long name reaches into the price column (a comma-bearing clothing
      // row with a four-digit price, RR p. 130), so its price can read as part
      // of the name. It is taken off the name and used as the cost when the
      // cost column came back empty. This runs before the name is tidied, since
      // the tidier treats a comma as separating name parts. Spaces are allowed
      // inside the figure: the run gap also lands after a thousands comma.
      const bled = /(\d[\d\s,]*(?:\.\d+)?\s*(?:gp|sp|cp))\s*$/i.exec(raw);
      const name = tidyRowName(bled ? raw.slice(0, bled.index).replace(/[\s,]+$/, "") : raw);
      if (!name || name.length < 2) continue;
      names[names.length - 1] = name;
      // The bled reading wins when there is one: it begins at the price's first
      // digit, while the cost column's tolerance can start past it.
      const cost = (bled ? parseCost(bled[1]) : null) ?? parseCost(cellAt(r.items, side.costX));
      const weight6 = side.encX != null ? encToWeight6(cellAt(r.items, side.encX)) : null;
      // A real row must carry a price; header/section rows do not.
      if (cost == null && weight6 == null) continue;
      priced++;
      out.push({ name, cost, weight6, section, capacity: labelCapacity(name) });
    }
    // A section heading: nothing on the line is priced and only the first
    // column carries text. The column-heading line repeats across every column,
    // and a data row whose price failed to parse has its neighbour beside it.
    if (!priced && names[0] && names.slice(1).every((n) => !n)) section = names[0];
  }
  return out;
}

/** True when a page is the given price grid (all anchors present). */
export function isPricePage(items, recipe) {
  const joined = items.map((i) => i.str).join(" ");
  return (recipe.anchors ?? []).every((a) => joined.includes(a));
}

/**
 * Build the combined name→{cost,weight6} price map from the reader's book,
 * across every PRICE_TABLES page. `readPage(doc,n)→{items}` is injected.
 * @returns {Promise<Map<string,{cost:number|null,weight6:number|null}>>}
 */
export async function extractPriceMapFromDoc(doc, readPage) {
  const map = new Map();
  for (const row of await extractPriceRowsFromDoc(doc, readPage)) {
    const key = priceKey(row.name);
    if (key && !map.has(key)) map.set(key, { name: row.name, cost: row.cost, weight6: row.weight6, capacity: row.capacity ?? null });
  }
  return map;
}

/**
 * Every printed price row, in page order, keeping the name each was printed
 * under and the section it was printed in. The map above folds these to one
 * entry per key. `table` is the recipe that read the row; `section` is the
 * heading the page printed it under, and one recipe can read several.
 * @returns {Promise<{name:string, cost:number|null, weight6:number|null, section:string, table:string}[]>}
 */
export async function extractPriceRowsFromDoc(doc, readPage) {
  const out = [];
  for (const [table, recipe] of Object.entries(PRICE_TABLES)) {
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
      if (!isPricePage(items, recipe)) continue;
      for (const row of extractPrices(items, recipe)) out.push({ ...row, table });
      break; // found this recipe's page
    }
  }
  return out;
}
