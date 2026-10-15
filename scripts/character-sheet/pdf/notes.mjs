/* global game */
/**
 * The block an import writes into the character's notes: everything the sheet
 * said that the character has no field for, and the domain page as tables.
 * The exact block is kept in the import's record, so a second import replaces
 * the first one's block instead of stacking another beside it; a block the
 * reader has since edited no longer matches and the new one is appended.
 */
import { makeLoc } from "../../lib/util.mjs";
import { LANG } from "../constants.mjs";

const loc = makeLoc(LANG);

const escape = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const cell = (v) => (v === true ? "✓" : escape(v).replace(/\n/g, "<br>"));

/** The domain page's tables: which keys a row is made of, in column order. */
const DOMAIN_TABLES = Object.freeze({
  structure: ["0", "1", "2", "3", "4"],
  income: ["label", "land", "families", "total"],
  expense: ["perFamily", "families", "total"],
  vassal: ["name", "domain", "favors", "duties", "tax"],
  hex: ["number", "land", "families", "revenue"],
});

/** One domain table as rows of cells, only the rows that hold something. */
function domainTable(domain, table) {
  const columns = DOMAIN_TABLES[table];
  const rows = new Map();
  for (const [key, value] of Object.entries(domain)) {
    const m = new RegExp(`^domain\\.${table}\\.(\\d+)\\.(\\w+)$`).exec(key);
    if (!m) continue;
    if (!rows.has(m[1])) rows.set(m[1], {});
    rows.get(m[1])[m[2]] = value;
  }
  if (table === "structure") {
    const total = Object.fromEntries(columns.map((c) => [c, domain[`domain.structure.total.${c}`]]).filter(([, v]) => v));
    if (Object.keys(total).length) rows.set("total", total);
  }
  return { columns, rows: [...rows.entries()].sort(([a], [b]) => (a === "total" ? 1 : b === "total" ? -1 : Number(a) - Number(b))) };
}

/** The domain page as HTML: its single boxes as lines, its tables as tables. */
function domainHtml(domain) {
  const entries = Object.entries(domain ?? {});
  if (!entries.length) return "";
  const parts = [`<h4>${escape(loc("pdf.notes.domain"))}</h4>`];
  const tabled = (key) => Object.keys(DOMAIN_TABLES).some((t) => key.startsWith(`domain.${t}.`));
  for (const [key, value] of entries) {
    if (tabled(key)) continue;
    const [, field, n] = /^domain\.(\w+)(?:\.(\w+))?$/.exec(key) ?? [];
    if (!field) continue;
    const label = field === "region" ? loc("pdf.domain.region", { n: Number(n) + 1 }) : loc(`pdf.domain.${n ? `${field}.${n}` : field}`);
    parts.push(`<p><strong>${escape(label)}:</strong> ${cell(value)}</p>`);
  }
  for (const table of Object.keys(DOMAIN_TABLES)) {
    const { columns, rows } = domainTable(domain, table);
    if (!rows.length) continue;
    const head = columns.map((c) => `<th>${escape(loc(`pdf.domain.col.${table}.${c}`))}</th>`).join("");
    const body = rows
      .map(([r, row]) => {
        const label = r === "total" ? loc("pdf.domain.total") : String(Number(r) + 1);
        return `<tr><td>${escape(label)}</td>${columns.map((c) => `<td>${row[c] === undefined ? "" : cell(row[c])}</td>`).join("")}</tr>`;
      })
      .join("");
    parts.push(`<p><strong>${escape(loc(`pdf.domain.table.${table}`))}</strong></p><table><thead><tr><th></th>${head}</tr></thead><tbody>${body}</tbody></table>`);
  }
  return parts.join("");
}

/**
 * The notes block for one import, or "" when the sheet said nothing the
 * character keeps no field for.
 * @param {object} block
 * @param {Array<{label: string, text: string}>} block.rows label / text lines
 * @param {Record<string, string|boolean>} [block.domain] the domain page's keys → values
 */
export function notesBlock({ rows = [], domain = {} } = {}) {
  const lines = rows.map((r) => `<p><strong>${escape(r.label)}:</strong> ${cell(r.text)}</p>`).join("");
  const dom = domainHtml(domain);
  if (!lines && !dom) return "";
  return `<h3>${escape(loc("pdf.notes.heading"))}</h3>${lines}${dom}`;
}

/**
 * The notes with the last import's block swapped for this one's: replaced
 * where the last block still stands as it was written, appended otherwise.
 */
export function replaceNotesBlock(notes, previous, block) {
  const now = String(notes ?? "");
  if (previous && now.includes(previous)) return now.replace(previous, () => block);
  if (!block) return now;
  return now ? `${now}${block}` : block;
}
