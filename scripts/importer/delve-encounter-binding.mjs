/**
 * Delve encounter assembly: the raw JJ ch. 2 encounters-in-the-dungeon read →
 * the scalar `die`, `every`, `target` and `distance` tables
 * formation/constants.mjs `importedEncounterCadence` reads.
 *
 * Two windows (JJ p. 36). The sentence that opens on the encounter throw
 * names its die and how many turns lie between throws, and the one after it
 * names the throw that meets a wandering monster, written with a trailing
 * plus. The distance step names the dice of the encounter distance, with the
 * factor they are multiplied by. A figure that did not read is left absent,
 * so the delve throws nothing, or rolls no distance, on it; nothing is
 * defaulted. No value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { DELVE_ENCOUNTER_DOC } from "../formation/constants.mjs";
import { assembledDoc } from "./produces.mjs";
import { firstSentence } from "./formation-binding.mjs";
import { parseCount } from "./survival-binding.mjs";

/** The engine doc both halves agree on (formation/module.mjs `expectTables`). */
export const DELVE_ENCOUNTER_DOC_ID = DELVE_ENCOUNTER_DOC;

/** The engine tables this binding assembles, with the raw table each is read from. */
export const PRODUCES = Object.freeze({
  [DELVE_ENCOUNTER_DOC_ID]: { die: "cadenceProse", every: "cadenceProse", target: "cadenceProse", distance: "cadenceProse" },
});

/** Dice as prose prints them, with an optional factor: `2d6 × 10`, `1d8`. */
const DICE = /(?<!\d)(\d+)\s*d\s*(\d+)(?:\s*[×x*]\s*(\d+))?/;

/**
 * The first dice the window prints, as a roll formula (`NdM`, or `NdM*K` with
 * a factor), or null. Rebuilt from its integers, so nothing but dice reaches
 * a roll.
 */
export function parseDice(window, { factor = false } = {}) {
  const m = DICE.exec(String(window ?? "").toLowerCase());
  if (!m) return null;
  const [count, faces, times] = [m[1], m[2], m[3]].map((t) => (t == null ? null : Number(t)));
  if (!(count > 0) || !(faces > 0)) return null;
  return factor && times > 0 ? `${count}d${faces}*${times}` : `${count}d${faces}`;
}

/** A count as digits or a word, as the prose may print it. */
const COUNT = "(\\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve)";

/** A positive whole figure, or null. */
const whole = (token) => {
  const n = parseCount(token);
  return Number.isInteger(n) && n > 0 ? n : null;
};

/** The turns between throws: the count the opening sentence puts after "every". */
export function parseEvery(window) {
  const m = new RegExp(`\\bevery\\s*${COUNT}\\s*turns?\\b`).exec(firstSentence(window));
  return m ? whole(m[1]) : null;
}

/**
 * The throw that meets a monster: the first figure written with a trailing
 * plus. A die's faces are no figure, and a word welded to the figure by
 * extraction does not hide it.
 */
export function parseTarget(window) {
  const text = String(window ?? "").toLowerCase().replace(/\s+/g, " ");
  const m = /(?<!\d|[./-]|\dd)(\d+)\s*\+/.exec(text);
  return m ? whole(m[1]) : null;
}

/**
 * The engine tables from the raw one; empty when nothing read. Pure: the
 * committed tests feed it invented prose. Each figure assembles on its own.
 */
export function assembleDelveEncounterTables(raw = {}) {
  const window = raw.cadenceProse?.cadence;
  const read = {
    die: parseDice(firstSentence(window)),
    every: parseEvery(window),
    target: parseTarget(window),
    distance: parseDice(raw.cadenceProse?.distance, { factor: true }),
  };
  return Object.fromEntries(Object.entries(read).filter(([, value]) => value != null));
}

/** Assemble and register, or report nothing assembled. */
export async function applyDelveEncounterImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(DELVE_ENCOUNTER_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleDelveEncounterTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(assembledDoc(doc, engine, PRODUCES[DELVE_ENCOUNTER_DOC_ID]), { priority: PRIORITY.WORLD, source: MODULE_ID });
  return { assembled: Object.keys(engine) };
}
