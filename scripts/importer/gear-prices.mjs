/**
 * Gear + clothing PRICE extraction (RR p131 Adventuring Equipment, p132
 * Clothing) → a name→{cost,weight6} map that enriches the gear/clothing
 * cookbook items (which carry names + @PdfText descriptions but no price).
 *
 * These pages are TWO-COLUMN price grids (left Item/Cost/Enc, right
 * Item/Cost/Enc). Same IP posture as the weapon/armour tables: geometry ships,
 * the prices materialize per-seat from the reader's own book. Cost is in gp;
 * the book prints gp/sp/cp (1gp = 10sp = 100cp — verified against core).
 */
import { rowsByY, joinRuns } from "./table-extract.mjs";

/**
 * Drop only footnote marks — NOT the weapon module's stripNoise, which also
 * eats single-letter runs matching the EQUIPMENT side-tab and so would swallow
 * a small-capped first letter ("Target" → "arget"). The running "EQUIPMENT"
 * header sits at the top margin (its own y-row, no price) and is filtered out
 * by the price requirement anyway, so nothing here needs the side-tab strip.
 */
function dropMarks(items) {
  return items.filter((it) => it.str && it.str.trim() && !/^[*†‡]+$/.test(it.str.trim()));
}

/** Column layout for one side of a two-column grid. */
const SIDE = (nameX0, nameX1, costX, encX) => ({ nameX0, nameX1, costX, encX });

/**
 * Run gap (in page units) above which two runs of a name are separate words.
 * A name arrives as several runs and the space between words is geometry, not
 * a character: joined with no threshold the rows read "Saddle andtack,draft",
 * and at too fine a threshold the kerning inside a word splits it ("d raft").
 * Measured against the grid: anything from ~0.3 to ~1.5 reproduces the printed
 * spacing exactly, so this sits in the middle of that band.
 */
const NAME_GAP = 1;

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
 * comma-separated part, which extracts lowercase ("cloak, Linen or Wool" →
 * "Cloak, Linen or Wool"). Only that letter is restored — title-casing the
 * rest would be inventing capitals the page does not print.
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
    .replace(/\(.*?\)/g, "") // drop "(1 lb)", "(1 pint)" qualifiers
    .replace(/[^a-z0-9]+/g, "");
}

/**
 * Look up a gear/clothing entry's price. Exact key first; then an UNAMBIGUOUS
 * prefix (exactly one priced variant whose key extends the entry's — e.g.
 * "Torch" → "Torches (6)"). A general category with several priced variants
 * ("Army Emblem" → Silver + Gold) returns null: those are not one priced item,
 * and guessing a variant would be wrong. Honest over a fabricated number.
 * @returns {{cost:number|null, weight6:number|null}|null}
 */
export function priceFor(map, name) {
  const k = priceKey(name);
  if (!k) return null;
  if (map.has(k)) return map.get(k);
  const variants = [...map.keys()].filter((gk) => gk.startsWith(k) && gk.length > k.length);
  return variants.length === 1 ? map.get(variants[0]) : null;
}

/** "10gp"→10, "3sp"→0.3, "2cp"→0.02, "5gp/60gp value"→5; "Varies"/blank→null. */
export function parseCost(text) {
  // Thousands separators go first: matched as part of the number they would
  // end it early, and "1,200gp" would price at 200.
  // No \b after the group: the unit follows the digits with no boundary
  // between them ("1,500gp"), so anchoring on one leaves the separator in and
  // the number reads from after it.
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

/** Encumbrance (stone) → weight6. "1/6"→1, "2"→12; "-"/blank→null. */
function encToWeight6(enc) {
  const s = String(enc ?? "").trim();
  if (!s || s === "-") return null;
  const frac = s.match(/^(\d+)\s*\/\s*(\d+)$/);
  if (frac) return Math.round((Number(frac[1]) / Number(frac[2])) * 6);
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 6) : null;
}

/**
 * The whole cell at an x-anchor: every run within tol, in x order, joined.
 *
 * Taking only the NEAREST run silently truncates a price split across runs —
 * "1,200gp" arrives as "1" and ",200gp", and the nearest of the two is the
 * one without the thousands digit. That reads as 200gp: an order of magnitude
 * off, in the direction that looks like a plausible price.
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
 * A price page can stack several SECTIONS under one grid — the second one
 * prints clothing, then livestock, then provisions — and what a row IS is
 * stated by the heading above it and nowhere else on the row. A grid row
 * carries the last heading seen, so a caller that has to decide what kind of
 * thing a row becomes has the page's own answer instead of the row's name.
 * The section is whatever the page printed, verbatim; nothing here knows or
 * declares which headings mean anything.
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
      // A long name reaches into the price column, so its own price can be
      // read as part of the name ("Gown, Duchess 1,000gp"). It is the row's
      // price wherever it landed: taken off the name, and used as the cost
      // when the cost column itself came back empty. This happens BEFORE the
      // name is tidied, because the tidier treats a comma as separating parts
      // of a name and a thousands separator is not that.
      // Spaces are allowed inside the figure: the same run gap that separates
      // words also lands between a thousands comma and the digits after it,
      // so the price prints here as "1, 500gp".
      const bled = /(\d[\d\s,]*(?:\.\d+)?\s*(?:gp|sp|cp))\s*$/i.exec(raw);
      const name = tidyRowName(bled ? raw.slice(0, bled.index).replace(/[\s,]+$/, "") : raw);
      if (!name || name.length < 2) continue;
      names[names.length - 1] = name;
      // The bled reading wins when there is one. It begins at the price's
      // first digit, whereas the cost column starts wherever its own tolerance
      // does — which for these rows is past the leading digit, so the column
      // reads "1,500gp" as 500 while the name holds the whole figure.
      const cost = (bled ? parseCost(bled[1]) : null) ?? parseCost(cellAt(r.items, side.costX));
      const weight6 = side.encX != null ? encToWeight6(cellAt(r.items, side.encX)) : null;
      // A real row must carry a price; header/section rows do not.
      if (cost == null && weight6 == null) continue;
      priced++;
      out.push({ name, cost, weight6, section });
    }
    // A SECTION HEADING, not a row: nothing on the line is priced, and only
    // the first column carries text. The column-heading line under it repeats
    // across every column, so it can never be read as one; a data row whose
    // price failed to parse always has its neighbour column beside it.
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
    if (key && !map.has(key)) map.set(key, { name: row.name, cost: row.cost, weight6: row.weight6 });
  }
  return map;
}

/**
 * Every printed price row, in page order, keeping the name each was printed
 * under and the section it was printed in. The map above folds these to one
 * entry per key; the row list is what a caller needs to make an ITEM out of a
 * row, which requires its name and what kind of thing the page says it is.
 *
 * `table` is the RECIPE that read the row; `section` is the heading the page
 * printed it under. They are not the same fact and the second page is why:
 * one recipe reads a grid that stacks clothing, livestock and provisions.
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
