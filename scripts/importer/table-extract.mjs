/**
 * Table extraction — materialize a ruledata TABLE from the seat's own PDF.
 *
 * Doctrine (docs/importer/COOKBOOK.md, docs/importer/RECIPES.md): the recipe ships **geometry
 * and patterns, never values**. A recipe says which book, which page, where
 * the row labels stop and the cells begin, and how to parse each cell — all
 * derived structural metadata that reproduces nothing without the source.
 * The dice, numbers and wages are read live from the reader's book and only
 * ever persist in their world (via the ruledata-import contract).
 *
 * Pure module: no Foundry imports. Runs in the browser (against a connected
 * PDF's pageItems) and in Node (tools/verification against the reference PDFs).
 */

/** Cluster a page's text items into rows by y proximity. */
export function rowsByY(items, tol = 3) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && Math.abs(it.y - last.y) <= tol) {
      last.items.push(it);
      last.y = (last.y * (last.items.length - 1) + it.y) / last.items.length;
    } else {
      rows.push({ y: it.y, items: [it] });
    }
  }
  for (const r of rows) r.items.sort((a, b) => a.x - b.x);
  return rows;
}

/**
 * Join a row's runs into one string.
 *
 * Runs concatenate BLIND by default, because a small-cap opening letter is one
 * word split across two runs ("c" + "rusader") and a space there would be wrong.
 *
 * `gapMin` opts a recipe into a GAP-AWARE join: where the next run starts more
 * than that many points past the end of the previous one, the page is showing a
 * word space the text layer does not carry, so one is inserted. The JJ sets its
 * class lists in small caps, and "dwarven craftpriest" arrives as four runs —
 * joined blind it reads "dwarvencraftpriest", which no consumer can match. In
 * that printing the intra-word gap is ~0.1pt and the word gap ~1.9pt, so the
 * threshold is a recipe's own number rather than a constant here: it is page
 * geometry, like every other bound in a recipe.
 */
export const joinRuns = (runs, gapMin = null) => {
  if (gapMin == null) return runs.map((r) => r.str).join("").replace(/\s+/g, " ").trim();
  let out = "";
  let prev = null;
  for (const run of runs) {
    if (prev && run.x - (prev.x + (prev.w ?? 0)) > gapMin) out += " ";
    out += run.str;
    prev = run;
  }
  return out.replace(/\s+/g, " ").trim();
};

/**
 * Stable camelCase key for a printed row/column label, shared by the grid
 * executor, the template compiler and the importer so the same label always
 * yields the same key. Parentheticals carrying digits or no letters are
 * dropped ("Old (101-200 years)" → "old", "Poison (*)" → "poison"); purely
 * alphabetic ones are kept ("Speed (Land)" → "speedLand", which must not
 * collide with "Speed (Fly)"). Trailing colons and XP-star marks never
 * contribute ("8*****" → "8").
 */
export function slugLabel(label) {
  let s = String(label ?? "").trim().replace(/:\s*$/, "");
  // Parentheticals that are ANNOTATION drop (roll bands "(101-200 years)",
  // cost marks "(*)", "(1/2)", "(varies)", "(* or more)"); purely alphabetic
  // qualifiers stay ("Speed (Land)" must not collide with "Speed (Fly)").
  s = s.replace(/\(([^)]*)\)/g, (_, inner) => {
    const t = inner.trim();
    return /\d/.test(t) || !/[a-z]/i.test(t) || /varies/i.test(t) || /^[^a-z]/i.test(t) ? " " : ` ${t} `;
  });
  const words = s.split(/[^a-zA-Z0-9]+/).filter(Boolean);
  return words.map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase())).join("");
}

/** Apply a cell pattern to a joined string. Patterns are a fixed library. */
export function applyCellPattern(text, pattern = "raw") {
  const t = text.trim();
  switch (pattern) {
    case "raw":
      return t;
    case "int": {
      const m = t.match(/-?\d[\d,]*/);
      return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
    }
    case "num": {
      const m = t.match(/-?\d[\d,]*(?:\.\d+)?/);
      return m ? Number(m[0].replace(/,/g, "")) : null;
    }
    case "dashNull":
      return t === "-" || t === "—" || t === "" ? null : t;
    case "intDash": {
      if (t === "-" || t === "—" || t === "") return null;
      const m = t.match(/[+-]?\d[\d,]*/);
      return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
    }
    case "refListLower": {
      // "Crusader, Mage, Thief, Venturer" -> ["crusader","mage",...]
      return t.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
    }
    case "spreadBand": {
      // "2, 3, 4" | "5, 6" | "14+" (a name may trail) -> {min, max};
      // an open "+" spread leaves max null.
      const open = t.match(/^(\d+)\s*\+/);
      if (open) return { min: +open[1], max: null };
      const nums = [...t.matchAll(/\d+/g)].map((m) => +m[0]);
      if (!nums.length) return undefined;
      return { min: Math.min(...nums), max: Math.max(...nums) };
    }
    case "rollBand": {
      // "11-16" | "10 or lower" | "19–20" -> {min?, max?}
      const range = t.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (range) {
        let min = +range[1], max = +range[2];
        if (max < min) max += 100; // d100 bands print "91–00" for 91–100
        return { min, max };
      }
      const lower = t.match(/(\d+)\s*or lower/i);
      if (lower) return { max: +lower[1] };
      const higher = t.match(/(\d+)\s*(?:\+|or higher)/i);
      if (higher) return { min: +higher[1] };
      const single = t.match(/^(\d+)$/);
      return single ? { min: +single[1], max: +single[1] } : null;
    }
    case "wagePeriod": {
      const m = t.match(/day|week|month|year/i);
      return m ? m[0].toLowerCase() : null;
    }
    case "gpPerUnit": {
      // "250gp/month" | "2sp/page" | "1gp/day/patient" -> {wage, wageUnit}
      const m = t.match(/([\d,.]+)\s*(gp|sp)\s*\/\s*(.+)/i);
      if (!m) return null;
      const wage = Number(m[1].replace(/,/g, "")) * (m[2].toLowerCase() === "sp" ? 0.1 : 1);
      return { wage, wageUnit: m[3].trim().replace(/\s+/g, "") };
    }
    case "diceFormula": {
      // "1d6+15gp" amid prose -> "1d6+15"; "1d3gp" -> "1d3"
      const m = t.match(/\d+d\d+(?:\s*[+x×]\s*\d+)?/);
      return m ? m[0].replace(/\s+/g, "") : null;
    }
    case "agePlus": {
      // Age-ladder cell: "44" | "44+" (column cap) | "-" (class caps earlier).
      // Stray superscript footnote glyphs y-merge in — letters are never data.
      const s = t.replace(/[^\d+\-]/g, "");
      if (!s || s === "-") return null;
      const m = s.match(/^(\d+)\+?$/);
      return m ? Number(m[1]) : null;
    }
    case "ageBand": {
      // "9-12" -> [9,12]; "88+" -> [88,999] (open-ended top band)
      const range = t.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (range) return [Number(range[1]), Number(range[2])];
      const open = t.match(/(\d+)\s*\+/);
      return open ? [Number(open[1]), 999] : null;
    }
    case "hdCell": {
      // "1/4 H|d|(1 hp)" drop-cap runs -> "1/4 HD (1 hp)"
      return t.replace(/\s*h\s*d\s*/i, " HD ").replace(/\s*\(/, " (").replace(/\s+/g, " ").trim() || null;
    }
    case "romanClass": {
      // "... c lass VI" (drop-caps) -> 6; takes the LAST roman numeral
      const m = [...t.matchAll(/lass\s*([IVX]+)/gi)].pop();
      if (!m) return null;
      const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
      return ROMAN[m[1].toUpperCase()] ?? null;
    }
    case "milesBand": {
      // A distance band label, the shape the Wilderness Search ladder prints:
      // "11 miles or less" -> {min:0,max:11}; "12 - 23 miles" -> {min:12,max:23};
      // "192 miles or more" -> {min:192,max:null} (open top).
      const n = (v) => Number(String(v).replace(/,/g, ""));
      const less = t.match(/(\d[\d,]*)\s*miles?\s*or\s*less/i);
      if (less) return { min: 0, max: n(less[1]) };
      const more = t.match(/(\d[\d,]*)\s*miles?\s*or\s*more/i);
      if (more) return { min: n(more[1]), max: null };
      const range = t.match(/(\d[\d,]*)\s*[–—-]\s*(\d[\d,]*)\s*miles?/i);
      return range ? { min: n(range[1]), max: n(range[2]) } : null;
    }
    case "costBand": {
      // "1gp or less" -> {minCost:0,maxCost:1}; "2 – 10gp" -> {minCost:2,maxCost:10};
      // "10,001gp or more" -> {minCost:10001,maxCost:null} (open top)
      const n = (s) => Number(s.replace(/,/g, ""));
      const less = t.match(/(\d[\d,]*)\s*gp\s*or\s*less/i);
      if (less) return { minCost: 0, maxCost: n(less[1]) };
      const more = t.match(/(\d[\d,]*)\s*gp\s*(?:\+|or\s*more)/i);
      if (more) return { minCost: n(more[1]), maxCost: null };
      const range = t.match(/(\d[\d,]*)\s*[–-]\s*(\d[\d,]*)\s*gp/i);
      return range ? { minCost: n(range[1]), maxCost: n(range[2]) } : null;
    }
    case "familiesBand": {
      // "Large city (5,000 – 9,999)" -> {min,max}; "(40,000+)" -> open top
      const range = t.match(/\((\d[\d,]*)\s*[–-]\s*(\d[\d,]*)\)/);
      if (range) return { min: Number(range[1].replace(/,/g, "")), max: Number(range[2].replace(/,/g, "")) };
      const open = t.match(/\((\d[\d,]*)\s*\+\)/);
      return open ? { min: Number(open[1].replace(/,/g, "")), max: null } : null;
    }
    default:
      return t;
  }
}

/**
 * Find the PDF page for a recipe by locating its header text. `readPage(n)`
 * returns that page's `{items}` (the caller wires it to pageItems + the book).
 * Searches a window around the cited printed page first, then the whole book.
 */
export async function findPage(recipe, numPages, readPage) {
  const guess = recipe.pdfPage ?? recipe.printedPage ?? 1;
  const order = [];
  for (let d = 0; d <= (recipe.searchRadius ?? 8); d++) {
    if (guess + d <= numPages) order.push(guess + d);
    if (d && guess - d >= 1) order.push(guess - d);
  }
  const seen = new Set(order);
  for (let p = 1; p <= numPages; p++) if (!seen.has(p)) order.push(p);
  for (const p of order) {
    const { items } = await readPage(p);
    const text = items.map((i) => i.str).join(" ");
    if (text.includes(recipe.locate)) return { page: p, items };
  }
  return null;
}

/**
 * `gridRows`: a label column followed by N market-class cells, with optional
 * `leading` columns (container, price…) before the grid and `trailing`
 * columns (wage etc.) after it. Runs left of `labelMaxX` form the row label
 * (drop-caps split a label across runs — they all sit in the label band);
 * the remaining runs, in x order, are the cells.
 *
 * Row selection is by ordered label regexes so stray marker runs ("*", "†")
 * between rows are ignored: each spec claims the next row whose joined label
 * matches, scanning downward from the previous claim.
 */
export function extractGridRows(items, recipe) {
  const { xMin = 0, xMax = Infinity } = recipe.column ?? {};
  items = items.filter((it) => it.x >= xMin && it.x <= xMax);
  const rows = rowsByY(items, recipe.rowTol ?? 3);
  const out = {};
  let cursor = 0;
  // startAfter: a page may STACK two grids in the same print column (RR p160
  // sets Armor and Equipment directly below Piercing/Slashing, both sharing the
  // left column and the same d20 row labels). Skipping to the marker row is what
  // stops the upper grid from answering for the lower one. Same convention the
  // pairs/bandGrid shapes already use.
  if (recipe.startAfter) {
    const idx = rows.findIndex((r) => r.items.some((it) => it.str.includes(recipe.startAfter)));
    if (idx >= 0) cursor = idx + 1;
  }
  for (const spec of recipe.rows) {
    const re = new RegExp(spec.labelRe, "i");
    let matched = null;
    let matchedLabel = "";
    for (let i = cursor; i < rows.length; i++) {
      const label = joinRuns(rows[i].items.filter((it) => it.x < recipe.labelMaxX));
      if (label && re.test(label)) {
        // minCells: a prose line can echo a row label (JJ repeats tier names
        // in running text) — a real grid row must actually carry its cells.
        if (recipe.minCells) {
          const n = rows[i].items.filter((it) => it.x >= recipe.labelMaxX && !/^[*†‡]+$/.test(it.str.trim())).length;
          if (n < recipe.minCells) continue;
        }
        matched = rows[i];
        matchedLabel = label;
        cursor = i + 1;
        break;
      }
    }
    if (!matched) {
      out[spec.key] = { __missing: true };
      continue;
    }
    // Footnote markers (*, †, ‡) sit between rows and can y-merge into one;
    // they are never a cell value, so drop lone-marker runs from the band.
    let cellRuns = matched.items.filter((it) => it.x >= recipe.labelMaxX && !/^[*†‡]+$/.test(it.str.trim()));
    // joinCellGap: the book's small-caps face splits a cell's initial glyph
    // into its own run ("c"+"rates"). A gap smaller than joinCellGap is a
    // glyph boundary, not a column gutter — merge those runs into one cell.
    if (recipe.joinCellGap != null) {
      const sorted = [...cellRuns].sort((a, b) => a.x - b.x);
      cellRuns = [];
      for (const r of sorted) {
        const prev = cellRuns[cellRuns.length - 1];
        if (prev && r.x - (prev.x + (prev.w ?? 0)) < recipe.joinCellGap) {
          prev.str += r.str;
          prev.w = r.x + (r.w ?? 0) - prev.x;
        } else cellRuns.push({ ...r });
      }
    }
    const cells = cellRuns.map((r) => r.str.trim());
    let row;
    if (recipe.cellColumns) {
      // X-anchored columns: sparse rows may omit their dash cells entirely
      // (RR cataphract row), so positions lie — bind each run to the nearest
      // declared column x instead. `row: true` entries land on the row.
      const obj = {};
      row = recipe.cellsKey ? { [recipe.cellsKey]: obj } : (row = {});
      const tol = recipe.columnTol ?? 14;
      const windowed = {};
      const pointCands = {};
      for (const run of cellRuns) {
        let best = null;
        for (const col of recipe.cellColumns) {
          // Windowed columns (`w`) JOIN every run in [x, x+w] — for cells
          // whose text spans several drop-cap runs; point columns bind the
          // nearest single run.
          if (col.w != null) {
            if (run.x >= col.x - 2 && run.x < col.x + col.w) best = { col, d: 0 };
            continue;
          }
          const d = Math.abs(run.x - col.x);
          if (d <= tol && (!best || d < best.d)) best = { col, d };
        }
        if (!best) continue;
        if (best.col.w != null) {
          (windowed[best.col.key] ??= { col: best.col, runs: [] }).runs.push(run);
          continue;
        }
        // Nearest run wins the column: a footnote glyph y-merged into the row
        // sits off-grid and must not displace the real cell beside it.
        const prev = pointCands[best.col.key];
        if (!prev || best.d < prev.d) pointCands[best.col.key] = { col: best.col, d: best.d, run };
      }
      for (const { col, run } of Object.values(pointCands)) {
        const v = applyCellPattern(run.str, col.pattern ?? recipe.cellPattern ?? "intDash");
        if (v == null && recipe.omitNullCells && !col.row) continue;
        if (col.row) row[col.key] = v;
        else obj[col.key] = v;
      }
      for (const { col, runs } of Object.values(windowed)) {
        const sorted = runs.sort((a, b) => a.x - b.x);
        // A joinGap makes the windowed join GAP-AWARE: a run starting a real
        // word-space past its neighbour keeps the space, a small-caps weld
        // (near-zero gap) glues — "Herd"+"a"+"nimal" reads "Herd animal",
        // not "Herdanimal". Without one the historical glue-all join stands,
        // which existing recipes' bindings repair themselves.
        const gap = col.joinGap ?? recipe.joinGap;
        const joined = gap != null
          ? joinRuns(sorted, gap)
          : sorted.map((r) => r.str).join("").replace(/\s+/g, " ").trim();
        const v = applyCellPattern(joined, col.pattern ?? "raw");
        if (col.row) row[col.key] = v;
        else obj[col.key] = v;
      }
      if (recipe.cellsKey) row[recipe.cellsKey] = obj;
    } else if (recipe.cellKeys) {
      // Named cells → an object under cellsKey (classPercentages weights,
      // mercenary per-race wages). omitNullCells drops dash cells so sparse
      // race columns emit only the races the book prices.
      const obj = {};
      recipe.cellKeys.forEach((k, i) => {
        const v = applyCellPattern(cells[i] ?? "", recipe.cellPattern ?? "int");
        if (v == null && recipe.omitNullCells) return;
        obj[k] = v;
      });
      row = recipe.cellsKey ? { [recipe.cellsKey]: obj } : obj;
      (recipe.trailing ?? []).forEach((tspec, i) => {
        const raw = cells[recipe.cellKeys.length + i];
        row[tspec.key] = raw == null ? null : applyCellPattern(raw, tspec.pattern ?? "raw");
      });
    } else {
      // Positional cells → an array (market-class grids), with optional
      // leading columns (container, price…) before it and trailing after.
      const lead = recipe.leading ?? [];
      const marketN = recipe.marketCells ?? cells.length - lead.length - (recipe.trailing?.length ?? 0);
      const market = cells.slice(lead.length, lead.length + marketN).map((c) => applyCellPattern(c, recipe.cellPattern ?? "dashNull"));
      row = { [recipe.cellsKey ?? "byMarketClass"]: market };
      lead.forEach((lspec, i) => {
        const raw = cells[i];
        row[lspec.key] = raw == null ? null : applyCellPattern(raw, lspec.pattern ?? "raw");
      });
      (recipe.trailing ?? []).forEach((tspec, i) => {
        const raw = cells[lead.length + marketN + i];
        const v = raw == null ? null : applyCellPattern(raw, tspec.pattern ?? "raw");
        if (tspec.expand && v && typeof v === "object") Object.assign(row, v);
        else row[tspec.key] = v;
      });
    }
    // labelPattern: the label itself carries data (a cost band) — parsed
    // fields merge onto the row beside the cells.
    if (spec.labelPattern) Object.assign(row, applyCellPattern(matchedLabel, spec.labelPattern) ?? {});
    if (spec.set) Object.assign(row, spec.set);
    out[spec.key] = row;
  }
  return out;
}

/**
 * `pairs`: a two-column key→value table (e.g. the Henchmen Monthly Wage
 * ladder: level → gp). Label band left of `labelMaxX`, the single value run
 * to its right.
 */
export function extractPairs(items, recipe) {
  // `parts`: independent column bands (side-by-side ladder halves) merged
  // into one keyed object; each part carries its own column + rows.
  if (recipe.parts) {
    const out = {};
    for (const part of recipe.parts) Object.assign(out, extractPairs(items, { ...recipe, ...part, parts: null }));
    return out;
  }
  const { xMin = 0, xMax = Infinity } = recipe.column ?? {};
  const inCol = items.filter((it) => it.x >= xMin && it.x <= xMax);
  const rows = rowsByY(inCol, recipe.rowTol ?? 3);
  const out = {};
  // startAfter: skip everything above the marker row (a page may stack an
  // identically-labeled table above this one — the JS screen does).
  let cursor = 0;
  if (recipe.startAfter) {
    const idx = rows.findIndex((r) => r.items.some((it) => it.str.includes(recipe.startAfter)));
    if (idx >= 0) cursor = idx + 1;
  }
  for (const spec of recipe.rows) {
    const re = new RegExp(spec.labelRe, "i");
    for (let i = cursor; i < rows.length; i++) {
      const label = joinRuns(rows[i].items.filter((it) => it.x < recipe.labelMaxX));
      if (label && re.test(label)) {
        const valRuns = rows[i].items.filter((it) => it.x >= recipe.labelMaxX);
        const value = applyCellPattern(joinRuns(valRuns, recipe.joinGap), recipe.cellPattern ?? "int");
        // labelPattern: the label itself carries data (a roll band); the
        // value lands under valueKey beside it.
        out[spec.key] = spec.labelPattern
          ? { ...applyCellPattern(label, spec.labelPattern), [recipe.valueKey ?? "value"]: value }
          : value;
        cursor = i + 1;
        break;
      }
    }
  }
  return out;
}

/**
 * `nameList`: a culture's name lists (RR People) — `Male Names:`,
 * `Female Names:`, `Surnames:` each a comma list that wraps across lines. The
 * page is two-column, so `column` bounds the culture's side; each field runs
 * from its label to the next field's label (the last one until the list stops
 * looking like names). Names are DATA and persist; the surrounding appearance
 * PROSE is never touched. A valid name is one capitalized token (accents ok).
 */
// Full Unicode letters: the books print Buǧra, Mătine, Tϋlay — extraction
// keeps them as printed (the seat's book is authoritative over any
// hand-typed transliteration).
const NAME_RE = /^[\p{L}][\p{L}'’-]*$/u;

export function extractNameList(items, recipe) {
  const { xMin = 0, xMax = Infinity } = recipe.column ?? {};
  const inCol = items.filter((it) => it.x >= xMin && it.x <= xMax);
  const rows = rowsByY(inCol, recipe.rowTol ?? 3);
  // Labels match on the ROW's joined text (drop-caps split "M ale Names:"
  // across runs; joining repairs it), searching below an optional anchor so
  // stacked culture blocks in one column pick the right one.
  const rowText = (r) => r.items.map((it) => it.str).join("").replace(/\s+/g, " ").trim();
  let from = 0;
  if (recipe.startAfter) {
    const idx = rows.findIndex((r) => rowText(r).includes(recipe.startAfter));
    if (idx >= 0) from = idx;
  }
  const fields = recipe.fields.map((f) => {
    const labelBare = f.label.replace(/\s+/g, "");
    const rowIdx = rows.findIndex((r, i) => i >= from && rowText(r).replace(/\s+/g, "").startsWith(labelBare));
    return { ...f, rowIdx };
  });
  const out = {};
  fields.forEach((f, fi) => {
    if (f.rowIdx < 0) { out[f.key] = []; return; }
    const nextIdx = fields.slice(fi + 1).map((n) => n.rowIdx).find((i) => i > f.rowIdx);
    const endIdx = nextIdx ?? rows.length;
    // Tokenize PER ROW: the list's last line and the following prose join
    // without a comma, so a text-level split would glue the final name into
    // a prose token and lose it. A row contributes its valid name prefix;
    // the first invalid token ends the whole list.
    const names = [];
    let done = false;
    let openComma = false;
    for (let ri = f.rowIdx; ri < endIdx && !done; ri++) {
      // A display-size row is the next culture's heading — the list is over
      // (a lone capitalized heading would otherwise pass as a name).
      if (ri > f.rowIdx && rows[ri].items.some((it) => it.h >= 11)) break;
      // Cross into a stitched continuation page only when the previous line
      // ended mid-list (trailing comma) — else the list was complete and the
      // next page's margin furniture must not append.
      if (rows[ri].items.some((it) => it._p2) && !openComma) break;
      let line = rowText(rows[ri]);
      openComma = line.trim().endsWith(",");
      if (ri === f.rowIdx) {
        let li = 0, bi = 0;
        const bare = f.label.replace(/\s+/g, "");
        while (li < line.length && bi < bare.length) {
          if (line[li] !== " ") bi++;
          li++;
        }
        line = line.slice(li);
      }
      for (const raw of line.split(",").map((s) => s.trim()).filter(Boolean)) {
        // Drop-cap repair: a line-initial name splits as "U nnhild" — fuse
        // the lone letter back on (uppercased; the glyph extracts lowercase).
        const t = /^[\p{L}]\s[\p{Ll}'’-]/u.test(raw) ? raw[0].toUpperCase() + raw.slice(2) : raw;
        if (NAME_RE.test(t)) names.push(t);
        else { done = true; break; }
      }
    }
    out[f.key] = names;
  });
  return out;
}

/**
 * `bandGrid`: the JS-screen double-d100 class grid — a header row of bucket
 * d100 bands over columns, and body rows whose LABEL is the second-d100 band.
 * Both band sets and every class token are read from the page; `classMap` is
 * a token→key assist table (short print names → registry class keys).
 * Emits the reference `classDistribution` shape: buckets[{id,min,max,rows}].
 */
export function extractBandGrid(items, recipe) {
  const { xMin = 0, xMax = Infinity } = recipe.column ?? {};
  const inCol = items.filter((it) => it.x >= xMin && it.x <= xMax);
  const rows = rowsByY(inCol, recipe.rowTol ?? 4);
  const tol = recipe.columnTol ?? 20;
  const colOfRun = (run) => {
    let best = null;
    for (const col of recipe.cellColumns) {
      const d = Math.abs(run.x - col.x);
      if (d <= tol && (!best || d < best.d)) best = { col, d };
    }
    return best?.col ?? null;
  };
  // header row: the bucket bands, one per column
  const headIdx = rows.findIndex((r) => r.items.some((it) => it.str.includes(recipe.headerMark)));
  const bands = {};
  if (headIdx >= 0) {
    const byCol = {};
    for (const run of rows[headIdx].items) {
      const col = colOfRun(run);
      if (col) (byCol[col.key] ||= []).push(run);
    }
    for (const [key, runs] of Object.entries(byCol)) {
      bands[key] = applyCellPattern(runs.map((r) => r.str).join(""), "rollBand");
    }
  }
  // body rows: band label + one class token per column
  const buckets = recipe.cellColumns.map((c) => ({ id: c.key, ...(bands[c.key] ?? {}), rows: [] }));
  let cursor = headIdx + 1;
  for (const spec of recipe.rows) {
    const re = new RegExp(spec.labelRe, "i");
    for (let i = cursor; i < rows.length; i++) {
      const label = joinRuns(rows[i].items.filter((it) => it.x < recipe.labelMaxX));
      if (label && re.test(label)) {
        const range = applyCellPattern(label, "rollBand") ?? {};
        const byCol = {};
        // Accumulated PER COLUMN, so a gap-aware join measures the distance to
        // the previous run of the same cell rather than to whatever sat left of
        // it in the row (see joinRuns: the JJ's small-cap class names arrive as
        // several runs with no space between them).
        const prevRun = {};
        for (const run of rows[i].items.filter((it) => it.x >= recipe.labelMaxX)) {
          const col = colOfRun(run);
          if (!col) continue;
          const prev = prevRun[col.key];
          const spaced = prev && recipe.joinGap != null && run.x - (prev.x + (prev.w ?? 0)) > recipe.joinGap;
          byCol[col.key] = (byCol[col.key] ?? "") + (spaced ? " " : "") + run.str;
          prevRun[col.key] = run;
        }
        for (const bucket of buckets) {
          const token = (byCol[bucket.id] ?? "").trim();
          if (!token) continue;
          const key = recipe.classMap?.[token] ?? token.toLowerCase();
          bucket.rows.push({ ...range, class: key });
        }
        cursor = i + 1;
        break;
      }
    }
  }
  return { buckets };
}

/**
 * `harvestPairs`: label→text rows harvested structurally rather than by an
 * enumerated spec — used where the row KEYS are themselves page content (the
 * JJ occupation→proficiency packages, ~100 rows over four pages). A row with
 * a label starts an entry; a row with only value-band runs continues the
 * previous entry's wrapped list; a label-only row (section heading) closes
 * the entry. Values split on commas into tokens, keeping parentheticals
 * ("Craft (scribe)").
 */
export function extractHarvestPairs(items, recipe) {
  const { xMin = 0, xMax = Infinity } = recipe.column ?? {};
  const inCol = items.filter((it) => it.x >= xMin && it.x <= xMax);
  const rows = rowsByY(inCol, recipe.rowTol ?? 3);
  const out = {};
  let openKey = null;
  const push = (key, text) => {
    if (!key) return;
    out[key] = ((out[key] ?? "") + " " + text).trim();
  };
  for (const row of rows) {
    const labelRuns = row.items.filter((it) => it.x < recipe.labelMaxX);
    const valueRuns = row.items.filter((it) => it.x >= recipe.labelMaxX);
    const label = joinRuns(labelRuns);
    const value = valueRuns.map((r) => r.str).join("").replace(/\s+/g, " ").trim();
    if (label && value) {
      // Keys normalize to lowercase alphanumerics: drop-cap gluing makes raw
      // labels unstable ("Bath a ttendant/Masseuse"), and consumers look up
      // with the same normalization.
      openKey = label.toLowerCase().replace(/[^a-z0-9]/g, "");
      out[`__label:${openKey}`] = label.replace(/\s+/g, " ").trim();
      push(openKey, value);
    } else if (!label && value && openKey) {
      push(openKey, value); // wrapped continuation of the open entry
    } else {
      openKey = null; // heading or blank: close the entry
    }
  }
  const packs = {};
  const labels = {};
  for (const [key, text] of Object.entries(out)) {
    // Junk guards: a real occupation label is short and sentence-free —
    // prose pages interleave the table and must not mint entries.
    if (key.split(/\s+/).length > (recipe.maxKeyWords ?? 3)) continue;
    if (/[.:;!?]/.test(key)) continue;
    // Split on commas OUTSIDE parentheses: "Weapon Proficiency (axes,
    // bludgeons)" is one token.
    const tokens = [];
    let depth = 0, buf = "";
    for (const ch of text) {
      if (ch === "(") depth++;
      else if (ch === ")") depth = Math.max(0, depth - 1);
      if (ch === "," && depth === 0) { tokens.push(buf.trim()); buf = ""; }
      else buf += ch;
    }
    if (buf.trim()) tokens.push(buf.trim());
    const clean = tokens.filter(Boolean);
    if (clean.some((t) => t.split(/\s+/).length > 7 || /\./.test(t))) continue; // prose, not a token list
    if (clean.length >= (recipe.minTokens ?? 1)) {
      packs[key] = clean;
      labels[key] = out[`__label:${key}`] ?? key;
    }
  }
  if (Object.keys(labels).length) packs._labels = labels;
  return packs;
}

/**
 * `bandList`: one occupation sub-table (JJ) — a header row ("Laborer
 * Occupation") then rows of d100-band | occupation | optional special note.
 * The caller supplies items already stitched into a single virtual left
 * column (reading order, R halves shifted); extraction starts below
 * `startAfter` (the header), harvests every banded row, and stops at the
 * first row that neither parses a band nor continues an open name — so the
 * next sub-table's header or prose ends it.
 */
export function extractBandList(items, recipe) {
  const rows = rowsByY(items, recipe.rowTol ?? 3);
  const rowStr = (r) => r.items.map((it) => it.str).join("").replace(/\s+/g, " ").trim();
  let from = 0;
  if (recipe.startAfter) {
    const bare = recipe.startAfter.replace(/\s+/g, "").toLowerCase();
    // Prefer the real table header (it shares its row with "1d100") — the
    // type table repeats sub-table names in its routing column on the same
    // page and must not anchor us. Compares are case-blind: drop-caps print
    // leading letters lowercase.
    const bareRow = (r) => rowStr(r).replace(/\s+/g, "").toLowerCase();
    let idx = rows.findIndex((r) => bareRow(r).includes(bare) && bareRow(r).includes("1d100"));
    if (idx < 0) idx = rows.findIndex((r) => bareRow(r).includes(bare));
    if (idx >= 0) from = idx + 1;
  }
  const bandW = recipe.bandWindow ?? [60, 115];
  const occW = recipe.occWindow ?? [115, 232];
  const spW = recipe.specialWindow ?? [232, 320];
  const out = [];
  let started = false;
  for (let ri = from; ri < rows.length; ri++) {
    const bandTxt = rows[ri].items.filter((it) => it.x >= bandW[0] && it.x < bandW[1]).map((it) => it.str).join("");
    const band = applyCellPattern(bandTxt, "rollBand");
    if (!band || band.min == null) {
      // Non-band rows: skip this table's own continuation headers ("1d100…"
      // or a repeat of our anchor); STOP at another sub-table's header or at
      // prose once rows have started.
      const txt = rowStr(rows[ri]);
      if (!txt) continue;
      // A row living entirely in the note window is the previous entry's
      // WRAPPED trade note (Mercantile Interest columns) — append and go on.
      if (started && rows[ri].items.every((it) => it.x >= spW[0])) {
        if (out.length) out[out.length - 1].special = ((out[out.length - 1].special ?? "") + " " + txt).trim();
        continue;
      }
      const bareTxt = txt.replace(/\s+/g, "").toLowerCase();
      const bareAnchor = (recipe.startAfter ?? "").replace(/\s+/g, "").toLowerCase();
      if (bareTxt.includes("1d100") || (bareAnchor && bareTxt.includes(bareAnchor))) continue;
      if (started) break;
      continue;
    }
    started = true;
    const occ = rows[ri].items.filter((it) => it.x >= occW[0] && it.x < occW[1]).sort((a, b) => a.x - b.x).map((it) => it.str).join("").replace(/\s+/g, " ").trim();
    const special = rows[ri].items.filter((it) => it.x >= spW[0] && it.x < spW[1]).sort((a, b) => a.x - b.x).map((it) => it.str).join("").replace(/\s+/g, " ").trim();
    if (!occ) continue;
    const row = { ...band, occupation: occ };
    if (special && special !== "-") row.special = special;
    out.push(row);
  }
  return { rows: out };
}

/**
 * `proseValues`: values the book states in running prose rather than a grid
 * (BTA caste percentages, JJ slavery costs). Each capture is an ANCHOR PHRASE
 * (never containing the value) plus a `take` micro-pattern applied to the
 * text window after it (or before, with `before: true`). Repeated phrasings
 * disambiguate by `occurrence` in reading order. The page is flattened
 * two-column reading order (L then R at `colSplit`), lowercased, whitespace
 * collapsed — the same normalization drop-caps and line wraps need anyway.
 */
const WORD_INTS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };

/**
 * Shape/texture/filler words that share a colour sentence's comma list
 * ("eyes are large, round, and black"; "hair is straight or wavy, and
 * colored…"). English descriptor vocabulary — module config, not book data.
 */
const NON_COLOUR =
  /^(?:the|with|of|in|a|an|and|or|either|usually|sometimes|seen|colou?r(?:ed|ation)?|shaped?|set|deep|deep-set|large|small|round|round-shaped|oval|almond|almond-shaped|wide|narrow|open|straight|wavy|curly|tightly curled|curled|ringlets?|ringleted|glossy|thick|fine|very deep set|men|women)$/i;

function takeProse(window, take) {
  const num = (s) => Number(s.replace(/,/g, ""));
  switch (take) {
    case "int": {
      const m = window.match(/-?\d[\d,]*/);
      return m ? num(m[0]) : undefined;
    }
    case "gp": {
      const m = window.match(/(-?[\d,]+)\s*gp/);
      return m ? num(m[1]) : undefined;
    }
    case "sp": {
      const m = window.match(/(-?[\d,]+)\s*sp/);
      return m ? num(m[1]) : undefined;
    }
    case "pct": {
      const m = window.match(/(\d+)\s*%/);
      return m ? num(m[1]) : undefined;
    }
    case "pct2": {
      const m = window.match(/(\d+)\s*%[^%]*?(\d+)\s*%/);
      return m ? [num(m[1]), num(m[2])] : undefined;
    }
    case "gpRange": {
      const m = window.match(/([\d,]+)\s*gp\s*to\s*([\d,]+)\s*gp/);
      return m ? { min: num(m[1]), max: num(m[2]) } : undefined;
    }
    case "signedInt": {
      const m = window.match(/-\s?\d+|\+\s?\d+|\d+/);
      return m ? num(m[0].replace(/\s/g, "")) : undefined;
    }
    case "wordInt": {
      const m = window.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten)\b/);
      return m ? WORD_INTS[m[1]] : undefined;
    }
    case "wagePeriod": {
      // The prose counterpart of the `wagePeriod` cell pattern: a wage span
      // written into a sentence ("a week's pay") rather than tabulated.
      const m = window.match(/\b(day|week|month|year)\b/);
      return m ? m[1] : undefined;
    }
    case "rarityTier": {
      // rarity ladder word → camel key ("very rare" → "veryRare")
      const m = window.match(/\b(ubiquitous|common|uncommon|very rare|extremely rare|rare|legendary)\b/);
      if (!m) return undefined;
      return m[1].replace(/ (\w)/g, (_, c) => c.toUpperCase());
    }
    case "dice": {
      const m = window.match(/\d+d\d+/);
      return m ? m[0] : undefined;
    }
    case "band": {
      const m = window.match(/(\d+)\s*[-–]\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2])] : undefined;
    }
    case "colorList": {
      // "…are deep-set and round, with coloration varying between blue-grey,
      // grey, …, and dark brown." → the COLOUR clause only. The sentence
      // opens with shape/texture words ("straight or wavy", "almond-shaped")
      // — the colour list starts at the LAST colour lead-in
      // (colored / coloration / colour of / with), so cut there, then split
      // on commas and the trailing and/or.
      const sentence = window.split(".")[0];
      // FIRST lead-in: a trailing "…but sometimes colored a striking green"
      // must extend the list, not replace it. Sentences with no lead-in at
      // all ("eyes are large, round, and black") keep the whole predicate —
      // the shape/texture words drop out in the filter below.
      const LEAD = /\b(?:colou?red|colou?ration|varying|between|colou?rs?|of|with|either|usually|sometimes|but|occasionally|seen|a|an|striking|to)\b/gi;
      const lead = sentence.match(/\b(?:colou?red|colou?ration|colou?rs?\s+of|with)\b/i);
      const body = lead ? sentence.slice(lead.index) : sentence.replace(/^\s*(?:are|is)\b/i, "");
      // Split on commas and every connective, then strip lead-in vocabulary
      // from EACH part — a clause can carry its own ("…but sometimes colored
      // a striking green", "…with coloration of blue").
      const parts = body
        .split(/,|\band\b|\bor\b|\bbut\b/)
        .map((s) =>
          s
            .replace(LEAD, " ")
            .replace(/[^a-z\- ]/gi, " ")
            .replace(/\s+/g, " ")
            .replace(/\s+in$/i, "")
            .trim()
        )
        .filter((s) => s && s.length < 24 && !NON_COLOUR.test(s));
      return parts.length ? [...new Set(parts)] : undefined;
    }
    case "phrase": {
      const s = window.split(".")[0].replace(/\s+/g, " ").trim();
      return s || undefined;
    }
    case "window": {
      // The raw span, periods and all — for anchors whose values live in
      // SEVERAL sentences (the JJ Ready-for-Play build paragraphs); the
      // consumer parses the window mechanically.
      const s = window.replace(/\s+/g, " ").trim();
      return s || undefined;
    }
    case "sexWord": {
      // class-description opening: "…are human women who…" / "…are men…"
      const m = window.match(/\b(women|woman|female|men|man|male)\b/);
      if (!m) return undefined;
      return /wom|female/.test(m[1]) ? "female" : "male";
    }
    case "alignmentWord": {
      const m = window.match(/\b(lawful|neutral|chaotic)\b/);
      return m ? m[1] : undefined;
    }
    default:
      return undefined;
  }
}

export function extractProseValues(items, recipe) {
  const split = recipe.colSplit ?? 300;
  const { xMin = 20, xMax = 600 } = recipe.column ?? {};
  const its = items
    .filter((i) => i.x >= xMin && i.x < xMax && i.y >= (recipe.yMin ?? 55) && i.y <= (recipe.yMax ?? 765))
    .sort((a, b) => ((a.x < split ? 0 : 1) - (b.x < split ? 0 : 1)) || (a.y - b.y) || (a.x - b.x));
  const text = its.map((i) => i.str).join(" ").replace(/\s+/g, " ").toLowerCase();
  const out = {};
  for (const v of recipe.values) {
    const find = v.find.toLowerCase();
    let idx = -1;
    for (let n = v.occurrence ?? 1; n > 0; n--) {
      idx = text.indexOf(find, idx + 1);
      if (idx < 0) break;
    }
    if (idx < 0) continue; // absent, not undefined: page-span merges keep earlier pages' captures
    const span = v.span ?? 90;
    const window = v.before ? text.slice(Math.max(0, idx - span), idx) : text.slice(idx + find.length, idx + find.length + span);
    let val = takeProse(window, v.take ?? "int");
    if (v.before && val !== undefined) {
      // before-windows want the LAST match, not the first
      let last;
      const re = { pct: /(\d+)\s*%/g, gp: /(-?[\d,]+)\s*gp/g, int: /-?\d[\d,]*/g, signedInt: /[-+]\s?\d+/g }[v.take ?? "int"];
      if (re) {
        for (const m of window.matchAll(re)) last = m[1] ?? m[0];
        if (last !== undefined) val = Number(String(last).replace(/[,\s]/g, ""));
      }
    }
    if (val !== undefined) out[v.key] = val;
  }
  return out;
}


/**
 * `indentTree`: every row of a printed taxonomy, with its depth taken from
 * how far the cell is indented.
 *
 * THE POINT OF THIS SHAPE is that it names nothing. The other shapes select
 * their rows by label — a list of the strings to look for — which for a
 * taxonomy would mean shipping the taxonomy. Here the recipe carries only
 * geometry: where the region starts, which x-bands hold which column, and the
 * indent step that turns a cell's x into its place in the tree. What the rows
 * SAY is read from the reader's own book and never enters this repo.
 *
 * Depth is `round((x - baseX) / step)`, so a cell one step in is a child of
 * the last cell one step out. Rows whose first run sits left of `baseX` — a
 * heading, a drop-cap, a footnote marker — are dropped, as are runs taller
 * than `bodyMaxH`, which is what keeps the section title and the page
 * furniture out of the tree.
 *
 * @returns {{rows: {depth: number, parent: number|null, …columns}[]}}
 */
export function extractIndentTree(items, recipe) {
  const { baseX = 0, step = 36, bodyMaxH = 10, yMin = 0, yMax = Infinity } = recipe;
  const body = items.filter((it) => it.h < bodyMaxH && it.y >= yMin && it.y <= yMax);
  const rows = rowsByY(body, recipe.rowTol ?? 3);
  const out = [];
  // One open ancestor per depth, so a row's parent is whatever last stood one
  // step to its left — which is what an indent MEANS on a printed tree.
  const openAt = [];
  for (const r of rows) {
    const cells = {};
    for (const col of recipe.columns ?? []) {
      const text = r.items
        .filter((it) => it.x >= col.xMin && it.x <= col.xMax)
        .map((it) => it.str)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text) cells[col.key] = text;
    }
    const first = r.items.find((it) => it.x >= baseX - 1);
    if (!first || !Object.keys(cells).length) continue;
    const depth = Math.max(0, Math.round((first.x - baseX) / step));
    openAt.length = depth;
    const parent = depth > 0 ? (openAt[depth - 1] ?? null) : null;
    openAt[depth] = out.length;
    out.push({ depth, parent, ...cells });
  }
  return { rows: out };
}

const SHAPES = { indentTree: extractIndentTree, gridRows: extractGridRows, pairs: extractPairs, nameList: extractNameList, bandGrid: extractBandGrid, harvestPairs: extractHarvestPairs, bandList: extractBandList, proseValues: extractProseValues };

/**
 * Shape the raw keyed extraction into the ruledata table's JSON, per
 * `recipe.emit`: `{container:"rows", keyField}` → `{rows:[{<keyField>, …}]}`
 * (each spec key becomes a row); `{wrap:"byMarketClass"}` → `{byMarketClass:
 * <keyed>}`; absent → the keyed object as-is.
 */
export function extractTable(items, recipe) {
  const fn = SHAPES[recipe.shape];
  if (!fn) throw new Error(`table-extract: unknown shape "${recipe.shape}"`);
  const raw = fn(items, recipe);
  if (recipe.emit?.container) {
    const kf = recipe.emit.keyField;
    return { [recipe.emit.container]: recipe.rows.map((s) => (kf ? { [kf]: s.key, ...raw[s.key] } : raw[s.key])) };
  }
  if (recipe.emit?.wrap) return { [recipe.emit.wrap]: raw };
  if (recipe.emit?.path) {
    // Nest the keyed result at a path, deep-merging any static structure
    // (module labels etc. — structure, never book values).
    let out = raw;
    for (const key of [...recipe.emit.path].reverse()) out = { [key]: out };
    const merge = (a, b) => {
      for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === "object" && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
      return a;
    };
    return recipe.emit.merge ? merge(out, recipe.emit.merge) : out;
  }
  if (recipe.emit?.wrapCulture) {
    const { cultureId, ...meta } = recipe.emit.wrapCulture;
    return { list: { [cultureId]: { ...meta, ...raw } } };
  }
  return raw;
}
