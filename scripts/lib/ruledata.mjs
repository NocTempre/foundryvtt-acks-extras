/**
 * Foundry-side ruledata loader (contracts: docs/lib/API.md). Fetches a module's shipped
 * `ruledata/<id>.json` files and registers each into the tables registry. A missing
 * file is reported, never thrown, so callers can surface one notice and degrade to stubs.
 */
import { registerTable, PRIORITY, missingCoverage } from "./tables.mjs";

/**
 * @param {string} moduleId - module whose ruledata/ dir to read
 * @param {string[]} ids - document ids (one per <id>.json file)
 * @param {object} [opts]
 * @param {number} [opts.priority] - registry layer (default SAMPLE)
 * @returns {Promise<{loaded: string[], missing: string[]}>}
 */
export async function loadRuledata(moduleId, ids, { priority = PRIORITY.SAMPLE } = {}) {
  const loaded = [];
  const missing = [];
  for (const id of ids) {
    try {
      const doc = await foundry.utils.fetchJsonWithTimeout(`modules/${moduleId}/ruledata/${id}.json`);
      registerTable(doc, { priority, source: moduleId });
      loaded.push(id);
    } catch {
      missing.push(id);
    }
  }
  return { loaded, missing };
}

/**
 * The GM-facing list of documents a feature still needs imported, ready to drop
 * into a notice: a document nothing supplied is named alone, one only part of
 * an import reached is named with how much of it arrived. A document whose
 * tables all arrived but that holds rows the import could not read is named
 * apart, with the tables and how many rows (never their content). Empty when
 * every declared table is present and complete — the caller then shows nothing.
 *
 * @param {string[]} docIds - the feature's ruledata documents
 * @returns {string[]} localized list items, in the order given
 */
export function missingTablesList(docIds) {
  return missingCoverage(docIds).flatMap(({ docId, expected, present, missing, incomplete }) => {
    const items = [];
    if (missing.length || (!expected.length && !incomplete.length)) {
      items.push(
        present.length
          ? game.i18n.format("ACKS-LIB.tables.partialDoc", { doc: docId, have: present.length, total: expected.length })
          : docId,
      );
    }
    if (incomplete.length) {
      items.push(
        game.i18n.format("ACKS-LIB.tables.partialRows", {
          doc: docId,
          tables: incomplete.map((t) => t.tableId).join("/"),
          count: incomplete.reduce((n, t) => n + t.rows.length, 0),
        }),
      );
    }
    return items;
  });
}
