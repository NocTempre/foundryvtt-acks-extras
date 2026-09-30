/**
 * Experience assembly: the raw RR ch. 1 Key Attribute read → the engine-shaped
 * `experience` ruledata table acks-extras declares.
 *
 * The page prints score bands beside a percentage adjustment. The band edges
 * and the percentages are both printed values, so both are read here from the
 * reader's own book; which attribute governs a class with two is the rule's
 * shape and lives in `classes/xp-bonus.mjs`. Like every binding here, no value
 * ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { assembledDoc } from "./produces.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const EXPERIENCE_DOC_ID = "experience";

/**
 * The engine tables this binding assembles, each with the raw table it is read
 * from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [EXPERIENCE_DOC_ID]: { keyAttributeXp: "keyAttributeRaw" },
});

/** "+5%" → 5, "-10%" → -10, "0" → 0; null when the cell holds no figure. */
export function parseAdjustment(text) {
  const m = /([+\-–−]?)\s*(\d+(?:\.\d+)?)/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] && m[1] !== "+" ? -n : n;
}

/**
 * The engine table from the raw one: `[{min, max, bonus}]`, bonus a percentage.
 * A row the extractor could not read, or whose cell holds no figure, is left
 * out rather than guessed. Pure — the committed tests feed it invented rows.
 */
export function assembleExperienceTables(raw = {}) {
  const rows = Object.values(raw.keyAttributeRaw ?? {})
    .filter((r) => r && !r.__missing && Number.isFinite(r.min))
    .map((r) => ({ min: r.min, max: Number.isFinite(r.max) ? r.max : null, bonus: parseAdjustment(r.adjustment) }))
    .filter((r) => r.bonus != null)
    .sort((a, b) => a.min - b.min);
  return rows.length ? { keyAttributeXp: rows } : {};
}

/** Assemble and register, or report nothing assembled. */
export async function applyExperienceImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(EXPERIENCE_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleExperienceTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[EXPERIENCE_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
