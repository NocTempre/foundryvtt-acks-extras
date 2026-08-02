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

const lib = () => globalThis.acksLib;

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
    }
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

const OCCUPANT_COLUMNS = ["smallCot", "mediumCot", "mediumTownhouse", "largeTownhouse", "generalStreet"];

function entryOf(docId, tableId, subId) {
  const key = subId ? `${docId}.${tableId}.${subId}` : `${docId}.${tableId}`;
  return { docId, tableId, subId, key, label: key, rollable: isRollable(docId, tableId, subId) };
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
        text: r.special ? `${r.occupation} — ${r.special}` : r.occupation,
      })),
    };
  }
  if (entry.subId && tableId === "cultures") {
    const names = data?.names ?? [];
    return {
      formula: `1d${Math.max(1, names.length)}`,
      results: names.map((n, i) => ({ range: [i + 1, i + 1], text: n })),
    };
  }
  if (entry.subId && tableId === "classDistribution") {
    if (entry.subId === "buckets") {
      return {
        formula: "1d100",
        results: (data?.buckets ?? []).map((b) => ({ range: [b.min ?? 1, b.max ?? b.min ?? 100], text: b.id })),
      };
    }
    return {
      formula: "1d100",
      results: (data?.rows ?? []).map((r) => ({ range: [r.min ?? 1, r.max ?? r.min ?? 100], text: r.class })),
    };
  }
  if (entry.subId && tableId === "occupationTypes") {
    const col = data?.column;
    const results = [];
    for (const r of data?.rows ?? []) {
      const b = r.bands?.[col];
      if (!b || b.min == null) continue;
      const label = r.type.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/\b\w/g, (c) => c.toUpperCase());
      results.push({ range: [b.min, b.max ?? b.min], text: r.special ? `${label} — ${r.special}` : label });
    }
    return { formula: "1d100", results: results.sort((a, b) => a.range[0] - b.range[0]) };
  }
  if (entry.subId && tableId === "classPercentages") {
    const weights = data?.weights ?? {};
    let at = 0;
    const results = [];
    for (const [cls, w] of Object.entries(weights)) {
      if (!(w > 0)) continue;
      results.push({ range: [at + 1, at + w], text: cls, weight: w });
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
        return { range, text: data.labels?.[id] ?? id };
      }),
    };
  }
  if (docId === "rarity" && tableId === "randomHenchmanLevel") {
    return {
      formula: "1d20",
      results: (data.rows ?? []).map((r) => ({
        range: [r.min ?? 1, r.max ?? 20],
        text: `Level ${r.level}`,
      })),
    };
  }
  return null;
}

/** Parse a RollTable back into the entry's ruledata shape. */
function parseRollTable(entry, table) {
  const results = [...table.results].sort((a, b) => (a.range?.[0] ?? 0) - (b.range?.[0] ?? 0));
  const textOf = (r) => String(r.description ?? r.text ?? "").trim();
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

async function ensureFolder() {
  return (
    game.folders.find((f) => f.type === "RollTable" && f.name === FOLDER_NAME) ??
    (await Folder.create({ name: FOLDER_NAME, type: "RollTable" }))
  );
}

async function ensureJournal() {
  return (
    game.journal.find((j) => j.name === JOURNAL_NAME) ?? (await JournalEntry.create({ name: JOURNAL_NAME }))
  );
}

/**
 * Materialize an entry as a world document PREFILLED with its current
 * effective data. Re-export updates the same document.
 * @returns {{uuid: string, kind: "rolltable"|"journal"}}
 */
export async function exportEntry(entry) {
  const data = entryData(entry);
  if (entry.rollable) {
    const spec = rollTableSpec(entry, data);
    const folder = await ensureFolder();
    const existing = game.tables.find((t) => t.name === entry.key);
    if (existing) {
      await existing.deleteEmbeddedDocuments("TableResult", existing.results.map((r) => r.id));
      await existing.createEmbeddedDocuments("TableResult", spec.results);
      await existing.update({ formula: spec.formula });
      return { uuid: existing.uuid, kind: "rolltable" };
    }
    const table = await RollTable.create({
      name: entry.key,
      folder: folder.id,
      formula: spec.formula,
      description: game.i18n.format("ACKS-LOCATION.tables.exportedFrom", { key: entry.key }),
      results: spec.results,
    });
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
 * in the module). Prefilled exports reuse/update matching existing documents
 * by name; tables that consumers EXPECT (acksLib.tables.expectedTables) but
 * that no import provided get an EMPTY placeholder — first of its kind only
 * — which the GM can fill by hand or replace by drag-drop.
 * @returns {{exported: number, placeholders: number}}
 */
export async function materializeAll() {
  let exported = 0;
  let placeholders = 0;
  for (const entry of listEntries()) {
    try {
      await exportEntry(entry);
      exported++;
    } catch (err) {
      console.warn(`${MODULE_ID} | materialize failed for ${entry.key}`, err);
    }
  }
  const t = lib()?.tables;
  const entries = listEntries();
  const have = new Set(entries.map((e) => `${e.docId}.${e.tableId}`));
  for (const { docId, tableIds } of t?.expectedTables?.() ?? []) {
    for (const tableId of tableIds) {
      const key = `${docId}.${tableId}`;
      if (have.has(key)) continue;
      const journal = await ensureJournal();
      if (journal.pages.find((p) => p.name === key)) continue; // reuse the existing one
      await journal.createEmbeddedDocuments("JournalEntryPage", [
        {
          name: key,
          type: "text",
          text: {
            content: `<p><em>${game.i18n.localize("ACKS-LOCATION.tables.placeholderHint")}</em></p><pre><code>{}</code></pre>`,
            format: CONST.JOURNAL_ENTRY_PAGE_FORMATS?.HTML ?? 1,
          },
        },
      ]);
      placeholders++;
    }
  }
  // Retire stale journal pages: a table that now materializes as
  // RollTables (its entries all have sub-ids) leaves its old whole-table
  // JSON page behind — delete pages that match no current entry key and
  // no expected placeholder.
  const journal = game.journal.find((j) => j.name === JOURNAL_NAME);
  if (journal) {
    const valid = new Set(entries.filter((e) => !e.rollable).map((e) => e.key));
    for (const { docId, tableIds } of t?.expectedTables?.() ?? [])
      for (const tableId of tableIds) if (!have.has(`${docId}.${tableId}`)) valid.add(`${docId}.${tableId}`);
    const stale = [...journal.pages].filter((p) => !valid.has(p.name)).map((p) => p.id);
    if (stale.length) await journal.deleteEmbeddedDocuments("JournalEntryPage", stale);
  }
  return { exported, placeholders };
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
