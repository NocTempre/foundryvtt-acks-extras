/**
 * Conditions assembly: the raw RR Appendix B reads (RR 507-515) → the
 * `conditions` ruledata table `lib/conditions.mjs` reads.
 *
 * The recipes take one short window per FIGURE, anchored on the few words that
 * lead into it, because a condition's entry states each modifier on a line of
 * its own and a window opens after its anchor. This step reads the number out
 * of each window and decides its sign; the sentence patterns live here, in one
 * place, where a printing change is one edit.
 *
 * What a row carries is a SIGNED delta on the roll its slot names, whatever
 * the page does to say so: a bonus is positive, a penalty negative, and an
 * AC "reduced by" a figure is that figure negated. The two multiplier slots
 * (`speedFactor`, `damageFactor`) are shares between 0 and 1. A window that
 * yields nothing leaves its slot ABSENT — never zero, never a guess — and each
 * slot assembles on its own, so one unread window costs one figure. Like every
 * binding here, no value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { CONDITIONS_DOC, CONDITIONS_TABLE, CONDITION_SLOTS } from "../lib/conditions.mjs";
import { assembledDoc } from "./produces.mjs";
import { parseShare } from "./survival-binding.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const CONDITIONS_DOC_ID = CONDITIONS_DOC;

/**
 * The engine tables this binding assembles, each with the raw tables it is
 * read from: the producer list `tools/validate-producers.mjs` checks readers
 * against, and the map `assembledDoc` cites the assembled tables by.
 */
export const PRODUCES = Object.freeze({
  [CONDITIONS_DOC_ID]: {
    [CONDITIONS_TABLE]: [
      "berserkProse", "blessedProse", "deafenedProse", "disorderedProse", "enlargedProse",
      "falteringProse", "hiddenProse", "hungryProse", "proneProse", "restrainedProse",
      "shrunkProse", "subjacentProse", "vulnerableProse",
    ],
  },
});

/**
 * Conditions whose figures are read from another condition's windows: the
 * page prints one heading for both.
 */
export const SHARED_HEADING = Object.freeze({ inspired: "blessed" });

/** Slots that hold a share of a speed or of damage rather than a signed delta. */
export const FACTOR_SLOTS = Object.freeze(new Set(["speedFactor", "damageFactor"]));

/** The key a recipe stores one figure's window under: `("blinded", "speedFactor")` → `blindedSpeedFactor`. */
export const rawKey = (condition, slot) => `${condition}${slot.charAt(0).toUpperCase()}${slot.slice(1)}`;

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

const MINUS = /[-−–—]/;
const PENALTY_CUE = /\b(?:penalt|reduc|decreas|lower|minus|subtract)/;
const BONUS_CUE = /\b(?:bonus|gain|increas|add)/;

/**
 * The first figure in a window, signed. A mark written before the number
 * decides the sign; with none, the window's own wording does ("reduced by 2"
 * is negative, "a bonus of 2" positive). A figure whose direction the window
 * does not give is null rather than assumed.
 *
 * @param {string} window  lowercased prose
 * @returns {number|null}
 */
export function parseFigure(window) {
  const text = String(window ?? "").toLowerCase();
  // Neither half of a written fraction is a figure: the digit before a "/" and
  // the one after it are both refused.
  const m = /([-+−–—])?\s?(?<![\d/])(\d+(?:\.\d+)?)(?!\s*\/\s*\d)/.exec(text);
  if (!m) return null;
  const n = Number(m[2]);
  if (!Number.isFinite(n)) return null;
  if (m[1]) return MINUS.test(m[1]) ? -n : n;
  if (PENALTY_CUE.test(text)) return -n;
  if (BONUS_CUE.test(text)) return n;
  return null;
}

/**
 * The first share in a window — a fraction or a spelled-out one — when it lies
 * strictly between 0 and 1.
 *
 * @param {string} window  lowercased prose
 * @returns {number|null}
 */
export function parseFactor(window) {
  const text = String(window ?? "").toLowerCase().replace(/\b(one|two)\s+(half|thirds?|quarters?)\b/g, "$1-$2");
  const share = parseShare(text, /(\d+\s*\/\s*\d+|one-half|one-third|two-thirds|one-quarter|half)\b/);
  return share != null && share > 0 && share < 1 ? share : null;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/**
 * The `{ <condition>: { <slot>: figure } }` table out of the raw reads. Pure —
 * the committed tests feed it invented prose. A condition none of whose
 * windows read is left out; the others assemble regardless.
 *
 * @param {Record<string, Record<string, string>>} raw  the layer's raw tables, by recipe key
 * @returns {{modifiers?: Record<string, Record<string, number>>}}
 */
export function assembleConditionTables(raw = {}) {
  const windows = {};
  for (const table of Object.values(raw ?? {})) {
    if (table && typeof table === "object") Object.assign(windows, table);
  }
  const modifiers = {};
  for (const [condition, slots] of Object.entries(CONDITION_SLOTS)) {
    const source = SHARED_HEADING[condition] ?? condition;
    const row = {};
    for (const slot of slots) {
      const text = windows[rawKey(source, slot)];
      if (typeof text !== "string") continue;
      const figure = FACTOR_SLOTS.has(slot) ? parseFactor(text) : parseFigure(text);
      if (figure != null) row[slot] = figure;
    }
    if (Object.keys(row).length) modifiers[condition] = row;
  }
  return Object.keys(modifiers).length ? { [CONDITIONS_TABLE]: modifiers } : {};
}

/** Assemble and register, or report nothing assembled. */
export async function applyConditionsImport() {
  const svc = services.get("ruledata-import");
  const doc = getLayer(CONDITIONS_DOC_ID, PRIORITY.WORLD);
  if (!svc || !doc) return { assembled: [] };
  const engine = assembleConditionTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    assembledDoc(doc, engine, PRODUCES[CONDITIONS_DOC_ID]),
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
