/* global game, foundry, CONST, RollTable, JournalEntry, Folder, fromUuid */
/**
 * Imported tables ⇄ Foundry documents.
 *
 * Every imported ruledata table can be EXPORTED as a world document
 * (prefilled with the imported default) for audit and tweaking, and a world
 * document can be dropped back to OVERRIDE the table (registry priority 30,
 * above world imports — see acks-lib tables.mjs). Two shapes:
 *
 *  - ROLLABLE tables (a single d-range → entry list) round-trip through a
 *    native RollTable — tweak weights/entries in the RollTable UI.
 *  - Everything else (grids, ladders, prose values) round-trips through a
 *    JournalEntry page holding pretty-printed JSON in a code block.
 *
 * No table values ship in this module: exports read whatever the WORLD
 * imported from the GM's own books.
 */
import { MODULE_ID } from "./constants.mjs";

const FOLDER_NAME = "ACKS Imported Tables";
const JOURNAL_NAME = "ACKS Ruledata (Imported)";

/** Stamped on every document materialized here (folders, the journal) so the
 * remove sweep finds them without trusting names. */
const FLAG_DOCS = "ruledataDocs";
/** A RollTable's entry key — its identity across renames and refiling. */
const FLAG_KEY = "tableKey";

const lib = () => globalThis.acksExtras?.lib;

/**
 * Result text as the reader means it, with HTML entities decoded.
 *
 * A result's description is an HTML field: a bare `&` in a book's own wording
 * ("grain & vegetables", "armor & weapons") is not valid markup and comes back
 * from storage normalized to `&amp;`. That matters twice — comparing a
 * freshly rendered spec against the stored form never matched, so those tables
 * deleted and recreated their whole result set on EVERY materialize pass
 * (invisibly, since the text still displayed correctly); and a table dropped
 * back as an override would write the entity into the rules data itself.
 * Decoding is for reading and comparing only — what is STORED is unchanged.
 */
const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'" };
const plainText = (s) => String(s ?? "").replace(/&(amp|lt|gt|quot|apos|#39);/g, (_, e) => ENTITIES[e]);

/** "classPercentages" → "Class Percentages"; digits keep their place. */
const humanize = (s) =>
  String(s)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[._]+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * The reader-facing name for an entry key. The raw dotted key
 * ("people.classPercentages.level.0") is machine identity and stays in flags
 * and the export-description; the sidebar shows "Class Percentages — Level 0"
 * inside a folder named for the doc, because a list of dotted keys in one flat
 * folder is unreadable at exactly the moment a GM goes looking for a table.
 */
export function entryLabel(key) {
  const [, tableId, ...rest] = String(key).split(".");
  if (!tableId) return humanize(key);
  return rest.length ? `${humanize(tableId)} — ${humanize(rest.join(" "))}` : humanize(tableId);
}

/* ------------------------- entry enumeration ------------------------- */

/**
 * Flatten the registry into browser entries. occupationSubTables expands
 * into one entry per category (each category IS one d100 list).
 * @returns {{docId,tableId,subId,key,label,rollable}[]}
 */
export function listEntries() {
  const t = lib()?.tables;
  if (!t) return [];
  const out = [];
  const seen = new Set();
  for (const { id: docId, priority } of t.docInfo()) {
    if (priority !== t.PRIORITY.WORLD) continue; // enumerate what imports provided
    let doc;
    try {
      doc = t.getDoc(docId);
    } catch {
      continue;
    }
    for (const [tableId, data] of Object.entries(doc.tables ?? {})) {
      if (tableId === "occupationSubTables" && data?.categories) {
        for (const subId of Object.keys(data.categories)) {
          out.push(entryOf(docId, tableId, subId));
        }
        continue;
      }
      if (docId === "people" && tableId === "cultures" && data?.list) {
        // one NAME TABLE per culture per list (male/female/surnames)
        for (const [cultureId, c] of Object.entries(data.list)) {
          for (const field of ["male", "female", "surnames"]) {
            if (Array.isArray(c[field]) && c[field].length) out.push(entryOf(docId, tableId, `${cultureId}.${field}`));
          }
        }
        continue;
      }
      if (docId === "rarity" && tableId === "classDistribution" && Array.isArray(data?.buckets)) {
        // the double-d100: one bucket table + one class table per bucket
        out.push(entryOf(docId, tableId, "buckets"));
        for (const b of data.buckets) out.push(entryOf(docId, tableId, `bucket.${b.id}`));
        continue;
      }
      if (docId === "people" && tableId === "occupationTypes" && Array.isArray(data?.rows)) {
        // one d100 occupant table per building column
        for (const col of OCCUPANT_COLUMNS) out.push(entryOf(docId, tableId, col));
        continue;
      }
      if (docId === "people" && tableId === "classPercentages" && Array.isArray(data?.rows)) {
        // one weighted class table per level row
        for (const r of data.rows) out.push(entryOf(docId, tableId, `level.${r.minLevel}`));
        continue;
      }
      out.push(entryOf(docId, tableId, null));
      seen.add(`${docId}.${tableId}`);
    }
  }

  // Every table the engine ASKS for but nothing has supplied, so a world that
  // has never run an importer still has a list to work from. Without this the
  // browser was empty until an import happened, which made hand-authoring
  // impossible: there was nothing to export, no shape to copy, and no way to
  // discover that a table was wanted at all.
  for (const { docId, tableIds } of t.expectedTables?.() ?? []) {
    for (const tableId of tableIds ?? []) {
      if (seen.has(`${docId}.${tableId}`)) continue;
      seen.add(`${docId}.${tableId}`);
      out.push(entryOf(docId, tableId, null, { absent: true }));
    }
  }

  return out.sort((a, b) => a.key.localeCompare(b.key));
}

const OCCUPANT_COLUMNS = ["smallCot", "mediumCot", "mediumTownhouse", "largeTownhouse", "generalStreet"];

function entryOf(docId, tableId, subId, { absent = false } = {}) {
  const key = subId ? `${docId}.${tableId}.${subId}` : `${docId}.${tableId}`;
  return {
    docId, tableId, subId, key, label: entryLabel(key),
    rollable: isRollable(docId, tableId, subId),
    /** True when the engine asks for this table and nothing has supplied it. */
    absent,
  };
}

/** Current EFFECTIVE data for an entry (override layer included). */
export function entryData({ docId, tableId, subId }) {
  const data = lib().tables.getTable(docId, tableId);
  if (subId == null) return data;
  if (tableId === "occupationSubTables") return data?.categories?.[subId];
  if (tableId === "cultures") {
    const [cultureId, field] = subId.split(".");
    return { names: data?.list?.[cultureId]?.[field] ?? [] };
  }
  if (tableId === "classDistribution") {
    if (subId === "buckets") return { buckets: (data?.buckets ?? []).map(({ id, min, max }) => ({ id, min, max })) };
    return (data?.buckets ?? []).find((b) => b.id === subId.split(".")[1]) ?? null;
  }
  if (tableId === "occupationTypes") return { column: subId, rows: data?.rows ?? [] };
  if (tableId === "classPercentages") return (data?.rows ?? []).find((r) => String(r.minLevel) === subId.split(".")[1]) ?? null;
  return data;
}

/* ------------------------- rollable kinds ------------------------- */

/**
 * A table is rollable when its data is one (range|weight) → text list:
 *  - occupationSubTables categories: d100 rows {min,max,occupation,special?}
 *  - cultures name lists: uniform draws (one table per culture per list)
 *  - classDistribution: bucket d100 bands + per-bucket class d100s
 *  - occupationTypes: one d100 occupant table per building column
 *  - classPercentages: weighted class table per level
 *  - dwarvenCastes: caste → percentage weights (remainder caste = null)
 *  - randomHenchmanLevel: d20 bands {min,max,level}
 */
export function isRollable(docId, tableId, subId) {
  if (subId != null)
    return ["occupationSubTables", "cultures", "classDistribution", "occupationTypes", "classPercentages"].includes(tableId);
  return (docId === "people" && tableId === "dwarvenCastes") || (docId === "rarity" && tableId === "randomHenchmanLevel");
}

function rollTableSpec(entry, data) {
  const { docId, tableId } = entry;
  if (entry.subId && tableId === "occupationSubTables") {
    const rows = data?.rows ?? [];
    return {
      formula: "1d100",
      results: rows.map((r) => ({
        range: [r.min ?? 1, r.max ?? r.min ?? 100],
        description: r.special ? `${r.occupation} — ${r.special}` : r.occupation,
      })),
    };
  }
  if (entry.subId && tableId === "cultures") {
    const names = data?.names ?? [];
    return {
      formula: `1d${Math.max(1, names.length)}`,
      results: names.map((n, i) => ({ range: [i + 1, i + 1], description: n })),
    };
  }
  if (entry.subId && tableId === "classDistribution") {
    if (entry.subId === "buckets") {
      return {
        formula: "1d100",
        results: (data?.buckets ?? []).map((b) => ({ range: [b.min ?? 1, b.max ?? b.min ?? 100], description: b.id })),
      };
    }
    return {
      formula: "1d100",
      results: (data?.rows ?? []).map((r) => ({ range: [r.min ?? 1, r.max ?? r.min ?? 100], description: r.class })),
    };
  }
  if (entry.subId && tableId === "occupationTypes") {
    const col = data?.column;
    const results = [];
    for (const r of data?.rows ?? []) {
      const b = r.bands?.[col];
      if (!b || b.min == null) continue;
      const label = r.type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
      results.push({ range: [b.min, b.max ?? b.min], description: r.special ? `${label} — ${r.special}` : label });
    }
    return { formula: "1d100", results: results.sort((a, b) => a.range[0] - b.range[0]) };
  }
  if (entry.subId && tableId === "classPercentages") {
    const weights = data?.weights ?? {};
    let at = 0;
    const results = [];
    for (const [cls, w] of Object.entries(weights)) {
      if (!(w > 0)) continue;
      results.push({ range: [at + 1, at + w], description: cls, weight: w });
      at += w;
    }
    return { formula: `1d${Math.max(1, at)}`, results };
  }
  if (docId === "people" && tableId === "dwarvenCastes") {
    const order = data.order ?? Object.keys(data.labels ?? {});
    const known = order.map((id) => data[`${id}Pct`]).filter((v) => typeof v === "number");
    const remainder = Math.max(0, 100 - known.reduce((a, b) => a + b, 0));
    let at = 0;
    return {
      formula: "1d100",
      results: order.map((id) => {
        const w = typeof data[`${id}Pct`] === "number" ? data[`${id}Pct`] : remainder;
        const range = [at + 1, at + Math.max(1, w)];
        at += Math.max(1, w);
        return { range, description: data.labels?.[id] ?? id };
      }),
    };
  }
  if (docId === "rarity" && tableId === "randomHenchmanLevel") {
    return {
      formula: "1d20",
      results: (data.rows ?? []).map((r) => ({
        range: [r.min ?? 1, r.max ?? 20],
        description: `Level ${r.level}`,
      })),
    };
  }
  return null;
}

/** Parse a RollTable back into the entry's ruledata shape. */
function parseRollTable(entry, table) {
  const results = [...table.results].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
  // Decoded, because the rules data this rebuilds holds the words themselves:
  // a table dropped back after editing would otherwise write "grain &amp;
  // vegetables" into the registry, where every later reader — including the
  // name-matching below — sees the entity rather than the "&" it stands for.
  const textOf = (r) => plainText(r.description ?? r.text).trim();
  if (entry.subId && entry.tableId === "occupationSubTables") {
    const rows = results.map((r) => {
      const [min, max] = r.range ?? [1, 100];
      const [occupation, ...rest] = textOf(r).split(" — ");
      const row = { min, max, occupation: occupation.trim() };
      if (rest.length) row.special = rest.join(" — ").trim();
      return row;
    });
    // whole-table override: replace this category, keep the others as-is
    const current = lib().tables.getTable(entry.docId, entry.tableId);
    return { categories: { ...(current?.categories ?? {}), [entry.subId]: { rows } } };
  }
  if (entry.subId && entry.tableId === "cultures") {
    // names in table order — the drop rewrites ONE culture's ONE list
    const [cultureId, field] = entry.subId.split(".");
    const current = foundry.utils.deepClone(lib().tables.getTable(entry.docId, entry.tableId));
    const names = results.map(textOf).filter(Boolean);
    current.list = { ...(current.list ?? {}) };
    current.list[cultureId] = { ...(current.list[cultureId] ?? {}), [field]: names };
    return current;
  }
  if (entry.subId && entry.tableId === "classDistribution") {
    const current = foundry.utils.deepClone(lib().tables.getTable(entry.docId, entry.tableId));
    if (entry.subId === "buckets") {
      const byId = Object.fromEntries((current.buckets ?? []).map((b) => [b.id, b]));
      current.buckets = results.map((r) => {
        const [min, max] = r.range ?? [1, 100];
        const id = textOf(r);
        return { ...(byId[id] ?? { id, rows: [] }), id, min, max };
      });
      return current;
    }
    const bucketId = entry.subId.split(".")[1];
    const bucket = (current.buckets ?? []).find((b) => b.id === bucketId);
    if (!bucket) throw new Error(`unknown bucket: ${bucketId}`);
    bucket.rows = results.map((r) => {
      const [min, max] = r.range ?? [1, 100];
      return { min, max, class: textOf(r) };
    });
    return current;
  }
  if (entry.subId && entry.tableId === "occupationTypes") {
    // rewrite ONE building column's bands; row identity matches by type label
    const col = entry.subId;
    const current = foundry.utils.deepClone(lib().tables.getTable(entry.docId, entry.tableId));
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
    const byType = Object.fromEntries((current.rows ?? []).map((r) => [norm(r.type), r]));
    for (const r of current.rows ?? []) if (r.bands) delete r.bands[col];
    for (const res of results) {
      const label = textOf(res).split(" — ")[0];
      const row = byType[norm(label)];
      if (!row) continue;
      const [min, max] = res.range ?? [1, 100];
      row.bands = { ...(row.bands ?? {}), [col]: { min, max } };
    }
    return current;
  }
  if (entry.subId && entry.tableId === "classPercentages") {
    const level = Number(entry.subId.split(".")[1]);
    const current = foundry.utils.deepClone(lib().tables.getTable(entry.docId, entry.tableId));
    const row = (current.rows ?? []).find((r) => r.minLevel === level);
    if (!row) throw new Error(`unknown level row: ${level}`);
    const weights = {};
    for (const r of results) {
      const [min, max] = r.range ?? [0, 0];
      const w = Number(r.weight) || Math.max(0, max - min + 1);
      if (w > 0) weights[textOf(r)] = w;
    }
    row.weights = weights;
    return current;
  }
  if (entry.docId === "people" && entry.tableId === "dwarvenCastes") {
    const current = lib().tables.getTable(entry.docId, entry.tableId);
    const labelToId = Object.fromEntries(Object.entries(current.labels ?? {}).map(([id, l]) => [String(l).toLowerCase(), id]));
    const out = { ...current };
    const order = [];
    let total = 0;
    for (const r of results) {
      const [min, max] = r.range ?? [0, 0];
      total += Math.max(0, max - min + 1);
    }
    for (const r of results) {
      const label = textOf(r);
      const id = labelToId[label.toLowerCase()] ?? label.toLowerCase().replace(/[^a-z0-9]/g, "");
      const [min, max] = r.range ?? [0, 0];
      const w = Math.max(0, max - min + 1);
      out[`${id}Pct`] = total > 0 ? Math.round((w * 100) / total) : 0;
      out.labels = { ...(out.labels ?? {}), [id]: label };
      order.push(id);
    }
    out.order = order;
    return out;
  }
  if (entry.docId === "rarity" && entry.tableId === "randomHenchmanLevel") {
    const rows = results.map((r) => {
      const [min, max] = r.range ?? [1, 20];
      const level = Number(textOf(r).match(/\d+/)?.[0] ?? 0);
      return { min, max, level };
    });
    return { rows };
  }
  throw new Error(`not a rollable entry: ${entry.key}`);
}

/* ------------------------- journal round-trip ------------------------- */

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function jsonPageContent(data) {
  return `<pre><code>${esc(JSON.stringify(data, null, 2))}</code></pre>`;
}

export function parseJsonContent(html) {
  const m = String(html).match(/<code[^>]*>([\s\S]*?)<\/code>/);
  const raw = (m ? m[1] : String(html))
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ");
  return JSON.parse(raw.trim());
}

/* ------------------------- export ------------------------- */

/**
 * The root folder plus one child per ruledata doc ("People", "Rarity", …), so
 * the sidebar groups tables the way the registry does. Both are flagged; a
 * root created before the flag existed is adopted by name and stamped.
 *
 * Every missing child is created in ONE call: folders must exist before the
 * tables that name them, so this is the one place the batch pass has to wait,
 * and waiting once beats waiting per doc.
 *
 * @param {string[]} docIds  ruledata doc ids needing a folder
 * @returns {Promise<Map<string, Folder>>} docId → the folder its tables go in
 */
async function ensureFolders(docIds) {
  const out = new Map();
  if (!docIds.length) return out;
  let root =
    game.folders.find((f) => f.type === "RollTable" && !f.folder && f.getFlag(MODULE_ID, FLAG_DOCS)) ??
    game.folders.find((f) => f.type === "RollTable" && !f.folder && f.name === FOLDER_NAME);
  if (!root) root = await Folder.create({ name: FOLDER_NAME, type: "RollTable", flags: { [MODULE_ID]: { [FLAG_DOCS]: true } } });
  else if (!root.getFlag(MODULE_ID, FLAG_DOCS)) await root.setFlag(MODULE_ID, FLAG_DOCS, true);
  const children = new Map(
    game.folders.filter((f) => f.type === "RollTable" && f.folder?.id === root.id).map((f) => [f.name, f]),
  );
  const missing = [];
  for (const docId of docIds) {
    const name = humanize(docId);
    const child = children.get(name);
    if (child) out.set(docId, child);
    else if (!missing.some((m) => m.name === name)) missing.push({ docId, name });
  }
  if (missing.length) {
    const created = await Folder.createDocuments(
      missing.map(({ name }) => ({
        name,
        type: "RollTable",
        folder: root.id,
        sorting: "a",
        flags: { [MODULE_ID]: { [FLAG_DOCS]: true } },
      })),
    );
    created.forEach((folder, i) => out.set(missing[i].docId, folder));
  }
  return out;
}

/** One doc's folder — the single-entry path (the browser's Export button). */
const ensureFolder = async (docId) => (await ensureFolders([docId])).get(docId);

async function ensureJournal() {
  let journal = game.journal.find((j) => j.getFlag(MODULE_ID, FLAG_DOCS)) ?? game.journal.find((j) => j.name === JOURNAL_NAME);
  if (!journal) journal = await JournalEntry.create({ name: JOURNAL_NAME, flags: { [MODULE_ID]: { [FLAG_DOCS]: true } } });
  else if (!journal.getFlag(MODULE_ID, FLAG_DOCS)) await journal.setFlag(MODULE_ID, FLAG_DOCS, true);
  return journal;
}

/**
 * The world table that IS this entry, or null.
 *
 * Identity is the flagged key; the raw-key NAME is the legacy form, and
 * matching it is what migrates a pre-flag world (rename + refile + stamp) on
 * its next materialize instead of duplicating every table.
 */
const findTable = (key) =>
  game.tables.find((t) => t.getFlag(MODULE_ID, FLAG_KEY) === key) ?? game.tables.find((t) => t.name === key) ?? null;

/**
 * Does this table already hold exactly these results?
 *
 * Re-materialize is mostly a no-op — the same registry data rendered again —
 * and rebuilding a result set costs two embedded round trips that cannot be
 * batched across tables. Comparing first turns the steady state into zero
 * writes.
 *
 * As a MULTISET, never by position. An embedded collection does not hand back
 * the array it was given, so a rebuilt table reads back in some other order —
 * and a positional comparison calls that a change, rebuilds, gets another
 * order, and never stops. Position also carries no meaning to anyone: a draw
 * resolves by range, and the table sheet sorts by range for display, so two
 * orderings of the same rows are the same table.
 *
 * Text is compared decoded (see `plainText`) — storage normalizes it, and a
 * comparison that does not account for that never matches either.
 */
function resultsMatch(table, results) {
  const current = [...table.results];
  if (current.length !== results.length) return false;
  const norm = (r) => `${r.range?.[0]}|${r.range?.[1]}|${r.weight ?? 1}|${plainText(r.description)}`;
  const stored = current.map(norm).sort();
  const wanted = results.map(norm).sort();
  return stored.every((row, i) => row === wanted[i]);
}

/** The creation data for one entry's RollTable. */
const tableCreateData = (entry, spec, folderId) => ({
  name: entry.label,
  folder: folderId,
  formula: spec.formula,
  description: game.i18n.format("ACKS-LOCATION.tables.exportedFrom", { key: entry.key }),
  results: spec.results,
  flags: { [MODULE_ID]: { [FLAG_KEY]: entry.key } },
});

/** The document-level update for an entry's existing RollTable (not results). */
const tableUpdateData = (entry, spec, folderId, id) => ({
  _id: id,
  name: entry.label,
  folder: folderId,
  formula: spec.formula,
  [`flags.${MODULE_ID}.${FLAG_KEY}`]: entry.key,
});

/**
 * Does the table already say what this entry would write?
 *
 * Checked so an unchanged pass writes NOTHING. Issuing the update anyway
 * would be one batched call either way, but it stamps `_stats.modifiedTime`
 * on every table on every import — which shows the whole sidebar as
 * just-touched and dirties a world backup that holds no new information.
 */
const tableIsCurrent = (table, entry, spec, folderId) =>
  table.name === entry.label &&
  (table.folder?.id ?? null) === folderId &&
  table.formula === spec.formula &&
  table.getFlag(MODULE_ID, FLAG_KEY) === entry.key;

/** The starting page for a table nobody has supplied: a hint and an empty object. */
function placeholderContent() {
  return `<p><em>${game.i18n.localize("ACKS-LOCATION.tables.placeholderHint")}</em></p><pre><code>{}</code></pre>`;
}

/**
 * Materialize an entry as a world document PREFILLED with its current
 * effective data. Re-export updates the same document.
 *
 * The single-entry path, for the browser's per-row Export button;
 * `materializeAll` batches the same decisions rather than calling this in a
 * loop.
 * @returns {{uuid: string, kind: "rolltable"|"journal"}}
 */
export async function exportEntry(entry) {
  // A table the engine wants but nothing has supplied exports as a BLANK page
  // to author into — decided BEFORE the data is read, because reading an
  // absent table throws rather than answering null. Without this a GM who
  // never runs an importer has nothing to begin from at all.
  let data = null;
  try {
    data = entry.absent ? null : entryData(entry);
  } catch {
    data = null;
  }
  if (entry.absent || data == null) {
    const journal = await ensureJournal();
    const content = placeholderContent();
    const page = journal.pages.find((p) => p.name === entry.key);
    if (page) return { uuid: page.uuid, kind: "journal" };
    const [made] = await journal.createEmbeddedDocuments("JournalEntryPage", [
      { name: entry.key, type: "text", text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 } },
    ]);
    return { uuid: made.uuid, kind: "journal", blank: true };
  }

  if (entry.rollable) {
    const spec = rollTableSpec(entry, data);
    const folder = await ensureFolder(entry.docId);
    const existing = findTable(entry.key);
    if (existing) {
      if (!resultsMatch(existing, spec.results)) {
        await existing.deleteEmbeddedDocuments("TableResult", existing.results.map((r) => r.id));
        await existing.createEmbeddedDocuments("TableResult", spec.results);
      }
      await existing.update(tableUpdateData(entry, spec, folder.id, existing.id));
      return { uuid: existing.uuid, kind: "rolltable" };
    }
    const table = await RollTable.create(tableCreateData(entry, spec, folder.id));
    return { uuid: table.uuid, kind: "rolltable" };
  }
  const journal = await ensureJournal();
  const content = jsonPageContent(data);
  const page = journal.pages.find((p) => p.name === entry.key);
  if (page) {
    await page.update({ "text.content": content });
    return { uuid: page.uuid, kind: "journal" };
  }
  const [created] = await journal.createEmbeddedDocuments("JournalEntryPage", [
    { name: entry.key, type: "text", text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 } },
  ]);
  return { uuid: created.uuid, kind: "journal" };
}

/* ------------------------- bulk materialization ------------------------- */

/**
 * Materialize EVERY imported table as a Foundry document (user directive:
 * imported tables are saved as Foundry tables and journals, not just stored
 * in the module). Prefilled exports reuse/update matching existing documents;
 * tables that consumers EXPECT (acksLib.tables.expectedTables) but that no
 * import provided get an EMPTY placeholder — first of its kind only — which
 * the GM can fill by hand or replace by drag-drop.
 *
 * Writes are BATCHED, because this runs automatically after every import: one
 * document at a time meant a round trip each, and a real six-book world
 * materializes 208 entries — minutes of them. Each kind of write is collected
 * and issued once. What cannot be batched across documents is an embedded
 * collection, so result sets are compared first and rebuilt only where they
 * actually differ; a re-materialize that changes nothing now writes nothing.
 *
 * Ordering is load-bearing: folders exist before the tables that name them,
 * and the stale-page sweep runs after the page writes have landed, or it
 * measures the world as it was before this pass.
 * @returns {{exported: number, placeholders: number}}
 */
export async function materializeAll() {
  const entries = listEntries();
  const t = lib()?.tables;
  let exported = 0;
  let placeholders = 0;

  /* --- RollTables: one folder pass, one create, one update, rebuilds only
     where the results actually moved. --- */
  const rollable = entries.filter((e) => e.rollable);
  const folders = await ensureFolders([...new Set(rollable.map((e) => e.docId))]);
  const creates = [];
  const updates = [];
  const rebuilds = [];
  for (const entry of rollable) {
    try {
      const spec = rollTableSpec(entry, entryData(entry));
      if (!spec) throw new Error("no rollable spec");
      const folderId = folders.get(entry.docId)?.id ?? null;
      const existing = findTable(entry.key);
      if (existing) {
        if (!tableIsCurrent(existing, entry, spec, folderId)) updates.push(tableUpdateData(entry, spec, folderId, existing.id));
        if (!resultsMatch(existing, spec.results)) rebuilds.push({ table: existing, results: spec.results });
      } else {
        creates.push(tableCreateData(entry, spec, folderId));
      }
      exported++;
    } catch (err) {
      console.warn(`${MODULE_ID} | materialize failed for ${entry.key}`, err);
    }
  }
  if (creates.length) await RollTable.createDocuments(creates);
  if (updates.length) await RollTable.updateDocuments(updates);
  // Per table, necessarily: embedded documents batch only within one parent.
  // Read the ids before deleting — `table.results` is live.
  for (const { table, results } of rebuilds) {
    try {
      await table.deleteEmbeddedDocuments("TableResult", [...table.results].map((r) => r.id));
      await table.createEmbeddedDocuments("TableResult", results);
    } catch (err) {
      console.warn(`${MODULE_ID} | rebuilding results for "${table.name}" failed`, err);
    }
  }

  /* --- Journal pages: every create in one call, every changed page in
     another, and only then the stale sweep. --- */
  // An ABSENT entry is the placeholder loop's business, not the export loop's:
  // `listEntries` reports what the engine asks for as well as what it has, and
  // counting an unsupplied table as "have" left it with neither a real page nor
  // a placeholder.
  const pageEntries = entries.filter((e) => !e.rollable && !e.absent);
  const have = new Set(entries.filter((e) => !e.absent).map((e) => `${e.docId}.${e.tableId}`));
  const expected = [];
  for (const { docId, tableIds } of t?.expectedTables?.() ?? []) {
    for (const tableId of tableIds) {
      const key = `${docId}.${tableId}`;
      if (!have.has(key)) expected.push(key);
    }
  }
  // Only CREATE the journal if there is something to put in it — an empty
  // "ACKS Ruledata (Imported)" is clutter a world with no JSON tables never
  // asked for. An existing one is still picked up when there is nothing to
  // write, because its pages have all just become stale and the sweep below
  // is what retires them.
  const journal =
    pageEntries.length || expected.length
      ? await ensureJournal()
      : (game.journal.find((j) => j.getFlag(MODULE_ID, FLAG_DOCS)) ?? game.journal.find((j) => j.name === JOURNAL_NAME) ?? null);
  if (journal) {
    const pageCreates = [];
    const pageUpdates = [];
    const queued = new Set();
    const pageOf = (name) => journal.pages.find((p) => p.name === name);
    const textPage = (name, content) => ({
      name,
      type: "text",
      text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1 },
    });
    for (const entry of pageEntries) {
      try {
        const content = jsonPageContent(entryData(entry));
        const page = pageOf(entry.key);
        // Same content, same page: writing it back would only churn _stats.
        if (page) {
          if (page.text?.content !== content) pageUpdates.push({ _id: page.id, "text.content": content });
        } else if (!queued.has(entry.key)) {
          pageCreates.push(textPage(entry.key, content));
          queued.add(entry.key);
        }
        exported++;
      } catch (err) {
        console.warn(`${MODULE_ID} | materialize failed for ${entry.key}`, err);
      }
    }
    for (const key of expected) {
      if (pageOf(key) || queued.has(key)) continue; // reuse the existing one
      pageCreates.push(textPage(key, placeholderContent()));
      queued.add(key);
      placeholders++;
    }
    if (pageCreates.length) await journal.createEmbeddedDocuments("JournalEntryPage", pageCreates);
    if (pageUpdates.length) await journal.updateEmbeddedDocuments("JournalEntryPage", pageUpdates);

    // Retire stale journal pages: a table that now materializes as
    // RollTables (its entries all have sub-ids) leaves its old whole-table
    // JSON page behind — delete pages that match no current entry key and
    // no expected placeholder.
    const valid = new Set([...pageEntries.map((e) => e.key), ...expected]);
    const stale = [...journal.pages].filter((p) => !valid.has(p.name)).map((p) => p.id);
    if (stale.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", stale);
  }
  return { exported, placeholders };
}

/* ------------------------- removal ------------------------- */

/**
 * Everything materialization has put in this world: the flagged RollTables,
 * the folder tree, and the JSON journal. Name fallbacks cover worlds
 * materialized before the flags existed (raw-key table names, the unflagged
 * root folder and journal).
 */
export function listMaterializedDocs() {
  const folderIds = new Set(
    game.folders
      .filter((f) => f.type === "RollTable" && (f.getFlag(MODULE_ID, FLAG_DOCS) || (!f.folder && f.name === FOLDER_NAME)))
      .map((f) => f.id),
  );
  for (const f of game.folders) {
    if (f.type === "RollTable" && f.folder && folderIds.has(f.folder.id)) folderIds.add(f.id);
  }
  return {
    tables: game.tables.filter((t) => t.getFlag(MODULE_ID, FLAG_KEY) || (t.folder && folderIds.has(t.folder.id))),
    folders: game.folders.filter((f) => folderIds.has(f.id)),
    journal: game.journal.find((j) => j.getFlag(MODULE_ID, FLAG_DOCS)) ?? game.journal.find((j) => j.name === JOURNAL_NAME) ?? null,
  };
}

/** How many documents removeMaterializedDocs would delete. */
export function countMaterializedDocs() {
  const { tables, folders, journal } = listMaterializedDocs();
  return tables.length + folders.length + (journal ? 1 : 0);
}

/**
 * Delete every materialized document. DOCUMENTS only: the imported table DATA
 * in the world store stays registered, so automation keeps its values and the
 * next materialize rebuilds the documents from them.
 */
export async function removeMaterializedDocs() {
  const { tables, folders, journal } = listMaterializedDocs();
  const total = tables.length + folders.length + (journal ? 1 : 0);
  // Tables before folders: a folder deleted first would orphan its contents
  // to the sidebar root, where the table filter no longer finds them.
  if (tables.length) await RollTable.deleteDocuments(tables.map((t) => t.id));
  if (journal) await journal.delete();
  if (folders.length) await Folder.deleteDocuments(folders.map((f) => f.id));
  return total;
}

/* ------------------------- override via drop ------------------------- */

/**
 * Parse a dropped document into the entry's ruledata shape.
 * Accepts a RollTable (rollable entries) or a JournalEntry/Page whose code
 * block carries JSON (any entry).
 */
export async function parseDrop(entry, dropData) {
  const doc = await fromUuid(dropData?.uuid ?? "");
  if (!doc) throw new Error("drop: document not found");
  const type = doc.documentName;
  if (type === "RollTable") {
    if (!entry.rollable) throw new Error(game.i18n.localize("ACKS-LOCATION.tables.notRollable"));
    return { data: parseRollTable(entry, doc), sourceUuid: doc.uuid, sourceName: doc.name };
  }
  if (type === "JournalEntryPage") {
    return { data: reshapeJson(entry, parseJsonContent(doc.text?.content ?? "")), sourceUuid: doc.uuid, sourceName: doc.name };
  }
  if (type === "JournalEntry") {
    const page = doc.pages.find((p) => p.name === entry.key) ?? doc.pages.find((p) => p.type === "text");
    if (!page) throw new Error("drop: journal has no text page");
    return { data: reshapeJson(entry, parseJsonContent(page.text?.content ?? "")), sourceUuid: page.uuid, sourceName: page.name };
  }
  throw new Error(game.i18n.format("ACKS-LOCATION.tables.badDropType", { type }));
}

/** JSON drops for a sub-table entry carry just that category. */
function reshapeJson(entry, parsed) {
  if (!entry.subId) return parsed;
  if (entry.tableId === "occupationSubTables") {
    const current = lib().tables.getTable(entry.docId, entry.tableId);
    const category = parsed?.categories ? parsed.categories[entry.subId] : parsed;
    return { categories: { ...(current?.categories ?? {}), [entry.subId]: category } };
  }
  // Other sub-entries (culture lists, distribution buckets, occupant
  // columns, level weights): a JSON drop must carry the WHOLE table's shape
  // — partial JSON merges are ambiguous; use a RollTable drop for one slice.
  return parsed;
}
