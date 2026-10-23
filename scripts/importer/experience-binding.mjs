/**
 * Experience assembly: the raw RR ch. 1 Key Attribute read, the RR ch. 6
 * reserve, funeral and bank percentages, what 0th level takes to leave (RR
 * ch. 6, JJ ch. 9) and the implicit general slots (RR ch. 3) → the
 * engine-shaped `experience` ruledata tables acks-extras declares.
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
    zeroLevelXp: ["zeroLevelProse", "zeroLevelAdvance"],
    implicitSlots: "implicitSlotsProse",
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
 * bonus}]`; `reserveRate`, `funeralRate`, `bankFee` as percentages;
 * `zeroLevelXp` as `{assumed?, base?, perProficiency?}`; `implicitSlots` as a
 * count. A row or figure the extractor could not read is left out rather than
 * guessed.
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
  // What 0th level takes to leave: the Judges Journal's figures where it was
  // read, and the Rulebook's flat figure standing in for an unknown count
  // where it was not. The formula is kept only whole.
  const count = (v) => (Number.isFinite(v) && v >= 0 ? v : null);
  const advance = raw.zeroLevelAdvance ?? {};
  const assumed = count(advance.assumed) ?? count(raw.zeroLevelProse?.xp);
  const base = count(advance.base);
  const perProficiency = count(advance.perProficiency);
  const formula = base != null && perProficiency != null ? { base, perProficiency } : {};
  if (assumed != null || formula.base != null) out.zeroLevelXp = { ...(assumed != null ? { assumed } : {}), ...formula };
  const slots = count(raw.implicitSlotsProse?.slots);
  if (slots != null) out.implicitSlots = slots;
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
