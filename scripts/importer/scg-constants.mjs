/**
 * The System Compatibility Guide's conversion constants, read from the reader's
 * own copy.
 *
 * The conversion PROCEDURE is structural and lives in ose-convert.mjs: which
 * lineage inverts its armour class about a constant, which printed bonus
 * subtracts from which throw, which direction each runs. The CONSTANTS those
 * sentences carry are printed values, so they are extracted at run time and
 * passed in as arguments — the same shape as formation/jumping.mjs taking its
 * printed numbers rather than embedding them.
 *
 * Nothing here knows what the values should be. `readScgConstants` validates
 * SHAPE only — four finite integers — because asserting that the descending
 * baseline equals nine would put the number back in the module the whole
 * arrangement exists to keep it out of.
 *
 * Returns null when the guide is not connected. That is the ordinary case, not
 * an error: importing an OSE source without it still yields actors, and the
 * axes that need arithmetic are filled later by a second pass.
 */
import { MODULE_ID } from "./constants.mjs";
import { executeEntry } from "./executor.mjs";
import { cookbookContentFile, cookbookRegisters, cookbookSessionDoc } from "./cookbook.mjs";

/** Cookbook entry id per constant, keyed by the name the converter uses. */
export const SCG_CONSTANT_IDS = {
  acDescending: "def.constant.acDescending",
  acAscending: "def.constant.acAscending",
  attackThrow: "def.constant.attackThrow",
  saveThrow: "def.constant.saveThrow",
};

/**
 * @param doc          an opened SCG PDF (pdf.js document)
 * @param cookbook     the compiled `constants` content file
 * @param registers    shared lookup tables (unused by these entries, required by the executor)
 * @returns `{acDescending, acAscending, attackThrow, saveThrow}` or null
 */
export async function readScgConstants(doc, cookbook, registers) {
  if (!doc || !cookbook) return null;
  const pageCache = new Map();
  const out = {};
  for (const [key, id] of Object.entries(SCG_CONSTANT_IDS)) {
    const res = await executeEntry(doc, cookbook, registers, id, { pageCache });
    // `ok` is the expect anchor: a printing that moved the text fails here
    // rather than returning whatever integer now sits in the box.
    if (!res?.ok) return null;
    const v = res.fields?.value;
    if (!Number.isInteger(v)) return null;
    out[key] = v;
  }
  return out;
}

/**
 * The guide's constants, read from the copy this seat has open.
 *
 * @returns `{acDescending, acAscending, attackThrow, saveThrow}`, or null when
 *   the guide is not open, its cookbook file is absent, or the read fails
 *   (the failure is logged; the caller treats all three as "not connected")
 */
export async function currentScgConstants() {
  const doc = cookbookSessionDoc("scg");
  const file = cookbookContentFile("constants");
  if (!doc || !file) return null;
  try {
    return await readScgConstants(doc, file, cookbookRegisters());
  } catch (err) {
    console.warn(`${MODULE_ID} | could not read the conversion constants`, err);
    return null;
  }
}

/**
 * Whether a constants object is usable. Shape only — four integers, present and
 * finite. A caller that wants to know WHY should read the entry results.
 */
export const hasScgConstants = (c) =>
  !!c && Object.keys(SCG_CONSTANT_IDS).every((k) => Number.isInteger(c[k]));
