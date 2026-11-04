/**
 * Light assembly: the raw RR ch. 6 Light and Darkness reads → the engine-shaped
 * `lightSources` table lib/light.mjs reads through `lightFigures`.
 *
 * One page holds every figure (RR p. 265): two sentences give each source's
 * bright reach and how far its dim light runs, and two give how many turns a
 * source burns. Which sources a reach sentence prices is named by its anchor
 * (`REACH_KINDS`); the sentence that prices burn time names its sources before
 * the figure, so that window is read for the names it holds.
 *
 * A window that did not read leaves its figure absent, so the reader reports
 * that figure as not imported; nothing is defaulted. No value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { LIGHT_DOC, LIGHT_KINDS, LIGHT_TABLE } from "../lib/light.mjs";
import { assembledDoc } from "./produces.mjs";
import { firstSentence } from "./formation-binding.mjs";
import { parseCount } from "./survival-binding.mjs";

/** The engine doc both halves agree on (lib/light.mjs `expectTables`). */
export const LIGHT_DOC_ID = LIGHT_DOC;

/** The engine table this binding assembles, with the raw table it is read from. */
export const PRODUCES = Object.freeze({
  [LIGHT_DOC_ID]: { [LIGHT_TABLE]: "lightProse" },
});

/** The sources each reach window prices, as its anchor names them. */
export const REACH_KINDS = Object.freeze({
  candleReach: Object.freeze(["candle"]),
  torchReach: Object.freeze(["torch", "lantern"]),
});

/** The sources the lantern's own burn sentence prices. */
const LANTERN_BURN_KINDS = Object.freeze(["lantern"]);

/** How prose names each source, singular or plural, as a whole word. */
const KIND_WORDS = Object.freeze({
  candle: /\bcandles?\b/,
  torch: /\btorch(?:es)?\b/,
  lantern: /\blanterns?\b/,
});

/** A figure followed by a feet mark or unit, captured with its index. */
const FEET = /(?<![\w./-])(\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten|twenty|thirty)\s*(?:[’'′]|feet\b|foot\b|ft\b)/g;

/**
 * A source's reach out of its sentence: `{bright, dim}` in feet, either null
 * when the sentence does not give it. Bright is the first distance. Dim is the
 * distance the sentence calls the total; failing that, a distance said to run
 * "another" so far beyond the bright one adds to it; failing that, the second
 * distance is the dim radius itself.
 */
export function parseReach(window) {
  const s = firstSentence(window);
  const figures = [...s.matchAll(FEET)].map((m) => ({ n: parseCount(m[1]), at: m.index, end: m.index + m[0].length }));
  const usable = figures.filter((f) => f.n != null && f.n > 0);
  if (!usable.length) return { bright: null, dim: null };
  const bright = usable[0].n;
  const total = usable.find((f) => /^\s*total\b/.test(s.slice(f.end)));
  if (total) return { bright, dim: total.n };
  const second = usable[1];
  if (!second) return { bright, dim: null };
  const additive = /\banother\s*$/.test(s.slice(usable[0].end, second.at));
  return { bright, dim: additive ? bright + second.n : second.n };
}

/** A whole count of turns: the first figure the sentence prints before "turn". */
export function parseTurns(window) {
  const m = /(?<![\w./-])(\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|twenty|thirty)\s*turns?\b/.exec(firstSentence(window));
  const n = m ? parseCount(m[1]) : null;
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * The sources a look-back window names: only its last sentence counts, since a
 * window cut by length starts inside whatever came before.
 */
export function namedKinds(window) {
  const text = String(window ?? "").toLowerCase().replace(/\s+/g, " ");
  const tail = text.split(/\.\s/).at(-1);
  return LIGHT_KINDS.filter((kind) => KIND_WORDS[kind]?.test(tail));
}

/**
 * The engine table from the raw one. Pure: the committed tests feed it
 * invented prose. Each figure assembles on its own, so a window that drifted
 * costs its figure and nothing beside it.
 * @returns {Record<string, {bright?: number, dim?: number, turns?: number}>}
 */
export function assembleLightSources(prose = {}) {
  const out = {};
  const put = (kind, key, value) => {
    if (value == null) return;
    (out[kind] ??= {})[key] = value;
  };
  for (const [key, kinds] of Object.entries(REACH_KINDS)) {
    const { bright, dim } = parseReach(prose[key]);
    for (const kind of kinds) {
      put(kind, "bright", bright);
      put(kind, "dim", dim);
    }
  }
  const shed = parseTurns(prose.shedBurn);
  for (const kind of namedKinds(prose.shedSubject)) put(kind, "turns", shed);
  const lantern = parseTurns(prose.lanternBurn);
  for (const kind of LANTERN_BURN_KINDS) put(kind, "turns", lantern);
  return out;
}

/** The engine tables from the raw ones; empty when nothing read. */
export function assembleLightTables(raw = {}) {
  const sources = assembleLightSources(raw.lightProse ?? {});
  return Object.keys(sources).length ? { [LIGHT_TABLE]: sources } : {};
}

/** Assemble and register, or report nothing assembled. */
export async function applyLightImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(LIGHT_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleLightTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(assembledDoc(doc, engine, PRODUCES[LIGHT_DOC_ID]), { priority: PRIORITY.WORLD, source: MODULE_ID });
  return { assembled: Object.keys(engine) };
}
