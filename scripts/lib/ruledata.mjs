/**
 * Foundry-side ruledata loader (FAMILY.md §3a). Fetches a module's shipped
 * `ruledata/<id>.json` files and registers each into the tables registry.
 * A missing file is a NORMAL state (extraction-program ruling 1 — book
 * tables are imported per world, not shipped): it is reported, never thrown,
 * so callers can surface one notice and degrade to stubs.
 */
import { registerTable, PRIORITY } from "./tables.mjs";

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
