/**
 * `proseValues` read paragraph by paragraph (`rowsFrom`): a page that prints a
 * run of run-in titled paragraphs, each rule stated under a heading the page
 * sets at the head of its first line. The recipe names no heading. A heading is
 * found on the page's own runs (a line that opens at its column's left edge
 * with a Title-Case phrase and a colon or a period, text following on the same
 * line), and is bound to a row two ways:
 *
 * - `rowsFrom.grid`: a `gridRows` recipe for a table on the same page. Each of
 *   its rows is minted by the grid's own `keyByLabel`, and a paragraph belongs
 *   to the row whose label its heading folds to (letters only, a plural
 *   tolerated), so the key is the table's key and no label is written here.
 * - `rowsFrom.runins`: every heading found is a row, its key the `slugLabel`
 *   of the heading.
 *
 * A paragraph runs from its heading to the next heading found, or the end of
 * its window. The figures read inside it are the recipe's `values`, read by the
 * one reader every `proseValues` recipe uses, so an anchor phrase and a `take`
 * mean here what they mean there; the paragraph is the whole text window.
 * `windows` bounds the text read from each page of a span (`recipe.span`).
 * `vocab` is a `gridRows` recipe on the span's first page whose row labels (the
 * roles) and column keys (the breeds) a take may name a figure by; `itemsFrom`
 * is a recipe of this shape whose headings are the items a take may name.
 *
 * Output is `{[rowKey]: {label, ...figures}}`, a figure the paragraph does not
 * print absent. The headings and the paragraphs are the reader's page and are
 * never a string of this repo.
 */
import { roleKeyOf } from "./leader-roles.mjs";
import { glyphTypes } from "./weapon-binding.mjs";

/** Reading order within a window: left column, then right, each top to bottom. */
const byColumn = (split) => (a, b) => ((a.x < split ? 0 : 1) - (b.x < split ? 0 : 1)) || (a.y - b.y) || (a.x - b.x);

/** Letters and digits only, lowercased. */
export const fold = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]/gu, "");

/** Whether two folded words are one word, a plural tolerated either way. */
const sameWord = (a, b) => !!a && !!b && (a === b || a === `${b}s` || b === `${a}s` || a === `${b}es` || b === `${a}es`);

/** Words a heading may carry in lower case between its capitalised ones. */
const SMALL = "a|an|and|as|at|by|for|in|of|on|or|the|to|with";
const HEADING = new RegExp(
  `^(\\p{Lu}[\\p{L}\\p{N}'’-]*(?:\\s+(?:\\p{Lu}[\\p{L}\\p{N}'’-]*|${SMALL})){0,7})\\s*[:.]\\s+(?=\\S)`,
  "u",
);

/**
 * The text a recipe's windows read from the pages of its span, with the lines
 * that open at a column's left edge. A window is `{page, column, yMin, yMax}`
 * (the page an index of the span); the recipe's own geometry fills any gap.
 * @returns {{text: string, lines: {start: number, edge: boolean, str: string}[], breaks: number[]}}
 */
function readWindows(recipe, span) {
  const split = recipe.colSplit ?? 300;
  const windows = recipe.windows ?? [{ page: 0 }];
  let text = "";
  const lines = [];
  const breaks = [];
  for (const w of windows) {
    const { xMin = recipe.column?.xMin ?? 20, xMax = recipe.column?.xMax ?? 600 } = w.column ?? {};
    const yMin = w.yMin ?? recipe.yMin ?? 55;
    const yMax = w.yMax ?? recipe.yMax ?? 765;
    const runs = (span[w.page ?? 0] ?? [])
      .filter((i) => i.x >= xMin && i.x < xMax && i.y >= yMin && i.y <= yMax && String(i.str).trim())
      .sort(byColumn(split));
    if (text) breaks.push(text.length + 1);
    const edge = [Infinity, Infinity];
    for (const r of runs) edge[r.x < split ? 0 : 1] = Math.min(edge[r.x < split ? 0 : 1], r.x);
    let line = null;
    for (const r of runs) {
      const side = r.x < split ? 0 : 1;
      const str = String(r.str).replace(/\s+/g, " ").trim();
      if (!line || line.side !== side || Math.abs(r.y - line.y) > 2) {
        line = { side, y: r.y, start: text.length + (text ? 1 : 0), edge: r.x <= edge[side] + 4, runs: [] };
        lines.push(line);
      }
      text += `${text ? " " : ""}${str}`;
      line.runs.push(str);
    }
  }
  for (const l of lines) l.str = l.runs.join(" ");
  return { text, lines, breaks };
}

/**
 * Every heading in the text: `{label, at, end}` where `at` opens the heading
 * and `end` closes it and its punctuation.
 */
function headingsOf(read) {
  const out = [];
  for (const line of read.lines) {
    if (!line.edge) continue;
    const m = HEADING.exec(line.str);
    if (m) out.push({ label: m[1].replace(/\s+/g, " "), at: line.start, end: line.start + m[0].length });
  }
  return out;
}

/**
 * The headings of a recipe's own windows over `span`, as `{key, label}` rows in
 * print order, keyed by `slugLabel`.
 */
export function headingRows(recipe, span, slugLabel) {
  const read = readWindows(recipe, span);
  const seen = new Set();
  const rows = [];
  for (const h of headingsOf(read)) {
    const key = slugLabel(h.label);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    rows.push({ key, label: h.label });
  }
  return rows;
}

/** The first sentence of a window: up to the first full stop that is followed by a space or ends it. */
const firstSentence = (window) => window.split(/\.(?:\s|$)/)[0];

/** The words of a text as folded groups of one to `n` neighbours, each with its words. */
function wordGroups(text, n) {
  const words = text.split(/[\s,;()]+/).filter(Boolean);
  const groups = [];
  for (let i = 0; i < words.length; i++) {
    for (let k = 1; k <= n && i + k <= words.length; k++) groups.push(fold(words.slice(i, i + k).join("")));
  }
  return groups;
}

/** The keys of `rows` whose label a group of `text`'s words folds to, in the order the text names them. */
function namedRows(text, rows, n = 3) {
  const found = [];
  for (const g of wordGroups(text, n)) {
    const hit = rows.find((r) => sameWord(g, fold(r.label)));
    if (hit && !found.includes(hit.key)) found.push(hit.key);
  }
  return found;
}

const GAP = String.raw`[^;.]*?`;

/** A figure written "N" or "NdM" with an optional modifier, as printed without its spacing. */
const DICE_TOKEN = /\d*d\d+(?:[-+]\d+)?|\d+/g;

/** A number word or digits to a number. */
const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10 };

/**
 * The takes a paragraph needs beyond `takeProse`'s: figures that name the
 * rows, breeds or items of the recipe's `vocab`, and clauses read whole. A
 * `window` is the lowercased text after (or before) the anchor.
 * @returns {*|undefined}
 */
export function rowTake(window, take, spec, recipe) {
  const vocab = recipe?.vocabulary ?? {};
  switch (take) {
    case "text":
      return window.replace(/\s+/g, " ").trim() || undefined;
    case "ordinalWord": {
      const m = window.match(/\b(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)\b/);
      return m ? ORDINALS[m[1]] : undefined;
    }
    case "roundWord": {
      const m = window.match(/\bround(?:ed)?\s+(up|down)\b/);
      return m ? m[1] : undefined;
    }
    case "cite": {
      const m = window.match(/([a-z]+)\s*p\.\s*(\d+)/);
      return m ? `${m[1].toUpperCase()} p.${m[2]}` : undefined;
    }
    case "ratio": {
      const m = window.match(/(\d+)\s*:\s*(\d+)/);
      return m ? [Number(m[1]), Number(m[2])] : undefined;
    }
    case "ranks": {
      // The rank words the first sentence names, as the module's own role keys.
      const keys = [];
      for (const g of wordGroups(firstSentence(window), 2)) {
        const key = roleKeyOf(g) ?? roleKeyOf(g.replace(/s$/, ""));
        if (key && key !== "standard" && !keys.includes(key)) keys.push(key);
      }
      return keys.length ? keys : undefined;
    }
    case "troops": {
      const keys = namedRows(firstSentence(window), vocab.rows ?? []);
      return keys.length ? keys : undefined;
    }
    case "kinds": {
      // The unit kinds the first sentence names.
      const kinds = [];
      for (const g of wordGroups(firstSentence(window), 1)) {
        const kind = g.replace(/s$/, "");
        if ((spec.kinds ?? []).includes(kind) && !kinds.includes(kind)) kinds.push(kind);
      }
      return kinds.length ? kinds : undefined;
    }
    case "chances": {
      // Every percentage the paragraph prints as a chance to carry: `{pct}`, with
      // `perHitDie` where "per Hit Die" follows it and `scope` where an "each
      // <unit>" opens its clause.
      const out = [];
      for (const m of window.matchAll(/(\d+)\s*%/g)) {
        const before = window.slice(Math.max(0, m.index - 48), m.index);
        const after = window.slice(m.index + m[0].length, m.index + m[0].length + 40);
        const scope = /\b(?:each|every)\s+(?:[a-z]+\s+)?(gang|warband|village|lair)\b[^%]*$/.exec(before.split(/\.\s/).pop())?.[1];
        out.push({
          pct: Number(m[1]),
          ...(/^\s*(?:chance\s+)?per\s+(?:hit\s+die|hd)\b/.test(after) ? { perHitDie: true } : {}),
          ...(scope ? { scope } : {}),
        });
      }
      return out.length ? out : undefined;
    }
    case "itemShares": {
      // `{itemKey: pct}` for each item (a heading of `itemsFrom`) named in the
      // sentence tail after a percentage.
      const out = {};
      for (const m of window.matchAll(/(\d+)\s*%/g)) {
        const tail = window.slice(m.index + m[0].length).split(/\.(?:\s|$)/)[0];
        for (const key of namedRows(tail, vocab.items ?? [], 3)) out[key] ??= Number(m[1]);
      }
      return Object.keys(out).length ? out : undefined;
    }
    case "byBreed": {
      // `{breedKey: text}`: after each breed word, the text following `spec.verb`
      // up to the clause's end.
      const out = {};
      for (const breed of vocab.breeds ?? []) {
        const re = new RegExp(`\\b${breed.toLowerCase()}s?\\b${GAP}\\b${spec.verb}\\s+([^;.]+)`);
        const m = re.exec(window);
        if (m) out[breed] = m[1].trim();
      }
      return Object.keys(out).length ? out : undefined;
    }
    case "breedDice": {
      // `{breedKey: [figure, ...]}`: each clause names its breeds before `spec.verb`
      // and prints a run of figures after it, one per attack, as the page prints them.
      const out = {};
      const verb = new RegExp(`\\b${spec.verb}\\b`);
      for (const clause of window.split(/[;.]/)) {
        const at = verb.exec(clause);
        if (!at) continue;
        const breeds = namedRows(clause.slice(0, at.index), (vocab.breeds ?? []).map((b) => ({ key: b, label: b })), 1);
        const figures = clause.slice(at.index + at[0].length).split(/\bdamage\b/)[0].replace(/\s+/g, "").match(DICE_TOKEN);
        if (!breeds.length || !figures) continue;
        for (const breed of breeds) out[breed] = [...figures];
      }
      return Object.keys(out).length ? out : undefined;
    }
    case "respectively": {
      // `{breedKey: n}`: the breeds the text names, in its order, each paired with
      // the n-th figure in `spec.unit` before the word "respectively".
      const head = window.split(/\brespectively\b/)[0].split(/\.\s/).pop();
      const breeds = namedRows(head, (vocab.breeds ?? []).map((b) => ({ key: b, label: b })), 1);
      const sizes = [...head.matchAll(new RegExp(`(\\d+)\\s*${spec.unit}\\b`, "g"))].map((m) => Number(m[1]));
      if (!breeds.length || breeds.length !== sizes.length) return undefined;
      return Object.fromEntries(breeds.map((b, i) => [b, sizes[i]]));
    }
    case "matches": {
      // Every match of `spec.re`, as an object over `spec.fields`, a figure a number. A field
      // named `types` holds the damage types the icons in its group stand for.
      const out = [];
      for (const m of window.matchAll(new RegExp(spec.re, "g"))) {
        const row = {};
        spec.fields.forEach((f, i) => {
          const raw = m[i + 1];
          row[f] = f === "types" ? glyphTypes(raw ?? "") : /^\d+$/.test(raw) ? Number(raw) : raw;
        });
        out.push(row);
      }
      return out.length ? out : undefined;
    }
    default:
      return undefined;
  }
}

/**
 * The paragraphs of a `rowsFrom` recipe. See the file header.
 * @param {object[][]} span the pages of the span, the located page first
 * @param {object} recipe the recipe
 * @param {object} deps `{extractGridRows, extractProseValues, slugLabel, tidyRowName}`, handed in
 *   by `table-extract.mjs` so this file holds no import of it
 */
export function extractProseRows(span, recipe, deps) {
  const { extractGridRows, extractProseValues, slugLabel, tidyRowName } = deps;
  const grid = recipe.rowsFrom?.grid ? extractGridRows(span[0], recipe.rowsFrom.grid) : null;
  const gridRows = grid ? Object.entries(grid).filter(([, r]) => r && !r.__missing && r.label).map(([key, r]) => ({ key, label: r.label })) : null;
  const vocabGrid = recipe.vocab ? extractGridRows(span[0], recipe.vocab) : null;
  const vocabulary = {
    rows: vocabGrid ? Object.entries(vocabGrid).filter(([, r]) => r && !r.__missing && r.label).map(([key, r]) => ({ key, label: r.label })) : [],
    breeds: vocabGrid ? [...new Set(Object.values(vocabGrid).flatMap((r) => Object.keys(r).filter((k) => k !== "label" && k !== "__missing")))] : [],
    items: recipe.itemsFrom ? headingRows(recipe.itemsFrom, span, slugLabel) : [],
  };
  const read = readWindows(recipe, span);
  const heads = headingsOf(read);
  const out = {};
  heads.forEach((h, i) => {
    let key;
    let label;
    if (gridRows) {
      const row = gridRows.find((r) => sameWord(fold(h.label), fold(r.label)));
      if (!row) return;
      ({ key, label } = row);
    } else {
      key = slugLabel(h.label);
      label = tidyRowName(h.label);
    }
    if (!key || Object.hasOwn(out, key)) return;
    const stop = Math.min(heads[i + 1]?.at ?? read.text.length, read.breaks.find((b) => b > h.end) ?? Infinity);
    const paragraph = read.text.slice(h.end, stop).trim();
    const row = { label };
    const deferred = (recipe.defer ?? []).find((d) => fold(d.locate) === fold(h.label));
    if (deferred) row.figuresFrom = deferred.table;
    const figures = extractProseValues([{ str: paragraph, x: 0, y: 0, h: 9 }], {
      values: recipe.values,
      column: { xMin: -Infinity, xMax: Infinity },
      yMin: -Infinity,
      yMax: Infinity,
      vocabulary,
    });
    // A paragraph another recipe reads figures from keeps only the kinds `defer.keep` names.
    const kept = deferred?.keep ? Object.fromEntries(Object.entries(figures).filter(([k]) => deferred.keep.includes(k))) : figures;
    out[key] = { ...row, ...kept };
  });
  // A grid row whose paragraph the page lacks is still a row, its label alone, in the grid's order.
  return gridRows ? Object.fromEntries(gridRows.map((r) => [r.key, out[r.key] ?? { label: r.label }])) : out;
}
