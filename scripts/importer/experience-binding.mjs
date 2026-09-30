/**
 * Experience assembly: the raw RR ch. 1 Key Attribute read and the RR ch. 6
 * reserve, funeral and bank percentages → the engine-shaped `experience`
 * ruledata tables acks-extras declares.
 *
 * The Key Attribute page prints score bands beside a percentage adjustment;
 * the band edges and the percentages are printed values, read here from the
 * reader's own book. Which attribute governs a class with two is the rule's
 * shape and lives in `classes/xp-bonus.mjs`; how the reserve, a funeral and a
 * will use their percentages lives in `classes/legacy-logic.mjs`. Like every
 * binding here, no value ships.
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
  [EXPERIENCE_DOC_ID]: {
    keyAttributeXp: "keyAttributeRaw",
    reserveRate: "reserveProse",
    funeralRate: "funeralProse",
    bankFee: "bankProse",
  },
});

/** "+5%" → 5, "-10%" → -10, "0" → 0; null when the cell holds no figure. */
export function parseAdjustment(text) {
  const m = /([+\-–−]?)\s*(\d+(?:\.\d+)?)/.exec(String(text ?? ""));
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] && m[1] !== "+" ? -n : n;
}

/**
 * The engine tables from the raw ones: `keyAttributeXp` as `[{min, max,
 * bonus}]`, and `reserveRate`, `funeralRate`, `bankFee` as percentages. A row
 * or figure the extractor could not read is left out rather than guessed.
 * Pure — the committed tests feed it invented reads.
 */
export function assembleExperienceTables(raw = {}) {
  const rows = Object.values(raw.keyAttributeRaw ?? {})
    .filter((r) => r && !r.__missing && Number.isFinite(r.min))
    .map((r) => ({ min: r.min, max: Number.isFinite(r.max) ? r.max : null, bonus: parseAdjustment(r.adjustment) }))
    .filter((r) => r.bonus != null)
    .sort((a, b) => a.min - b.min);
  const out = rows.length ? { keyAttributeXp: rows } : {};
  // Each percentage stands alone: a page that would not parse costs its own
  // table, never the others.
  const pct = (v) => (Number.isFinite(v) && v >= 0 && v <= 100 ? v : null);
  const reserve = pct(raw.reserveProse?.rate);
  if (reserve != null) out.reserveRate = reserve;
  const funeral = pct(raw.funeralProse?.rate);
  if (funeral != null) out.funeralRate = funeral;
  const fee = pct(raw.bankProse?.fee);
  if (fee != null) out.bankFee = fee;
  return out;
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
