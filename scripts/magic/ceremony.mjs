/**
 * The ceremonial invocation throw (BTA pp. 120-121, 128): three outcomes,
 * worked out in three steps, as a pure function over plain data. Nothing here
 * rolls a die or writes a flag: every die result arrives in the input, and the
 * stigma and damage a result calls for are counts the caller records
 * (`ceremony-state.mjs`).
 *
 * The throw is the natural roll plus its parts (the pace's modifier, the
 * Wisdom modifier, a situational part the Judge or player sets by hand)
 * against the grid's target for the invocation level and invoker level.
 *
 * - Success: the total meets the target and the natural roll is outside the
 *   pace's failure band.
 * - Failure: otherwise; no rows run and the stigma a failure leaves is counted.
 * - Botch: the natural roll is in the band, or the invoker was hurt. The
 *   stigma of a failure and the damage a botch does to the set are counted,
 *   then a mishap throw is made
 *   with the same parts against the same target. Only if it fails is the
 *   degree read, at the invocation level moved by the pace's degree rule; a
 *   level under the lowest band loses the set and rolls nothing. Otherwise the
 *   mishap die's face picks the row and the degree the column, and the result
 *   is the imported cell: shown, never run.
 *
 * How many marks a failure or a botch leaves is a printed figure and arrives
 * in `input.marks`; a missing one is 0 marks and a `noFigure` note. A target,
 * pace modifier or band that is not imported leaves `outcome: null` and
 * `proceed: false`: nothing stands in for it. A caller turns `blocks` into a
 * Player's refusal or a Judge's warning; `proceed` answers only for the throw.
 *
 * The grid already counts the parts its tradition set names in `gridIncludes`
 * (`ceremony-tables.mjs`), so an `extraParts` entry carrying one of those keys
 * is not added.
 */
import { degreeAt, gridTarget, mishapAt } from "./ceremony-tables.mjs";

/** A count of marks a book prints: a positive integer, else null. */
const markCount = (n) => (Number.isInteger(n) && n > 0 ? n : null);

/** A number the caller supplied, else null. */
const given = (n) => (typeof n === "number" && Number.isFinite(n) ? n : null);

/** One throw part: `cite` only when a page backs it, `byHand` only when a hand set it. */
function part(key, value, src = {}) {
  const out = { key, value };
  if (src.cite) out.cite = src.cite;
  if (src.byHand) out.byHand = true;
  return out;
}

/** Whether a natural roll falls inside a `{min, max}` band, an open bound being null. */
const inBand = (band, n) => (band.min === null || n >= band.min) && (band.max === null || n <= band.max);

/**
 * Work out one invocation throw.
 *
 * @param {object} input - `{invocationLevel, invokerLevel, pace, wisdomMod,
 *   situational, set, natural, mishapNatural, mishapFace, hurt, marks:
 *   {stigmaOnFailure, damageOnBotch}}`. `pace` is `hasty|regular|methodical`;
 *   `set` is the implement set held, `{effectiveLevel}`, or null for none;
 *   `natural` may be absent when `hurt` is true. Optional: `extraParts`
 *   (`[{key, value, cite?, byHand?}]`), `stigma` with `threshold`, `inCombat`.
 * @param {object|null} tables - from `readCeremonyTables`.
 * @returns {{target: number|null, targetSource: object, parts: object[],
 *   total: number|null, outcome: "success"|"failure"|"botch"|null,
 *   proceed: boolean, stigmaMarks: number, damageMarks: number,
 *   mishap: object|null, blocks: object[], notes: object[], pace: object|null,
 *   gridIncludes: string[]}} `mishap` is `{throw: {natural, total}|null,
 *   passed, degree, degreeWord, shiftedLevel, setLost, face, cell, cite,
 *   byHand, die, pending}` once the outcome is a botch; `pending` names the
 *   die result the caller still has to supply (`"mishapNatural"` or
 *   `"mishapFace"`), null when the result is read.
 */
export function resolveCeremony(input = {}, tables = null) {
  const blocks = [];
  const notes = [];
  const gridIncludes = tables?.gridIncludes ?? [];
  const pace = Object.hasOwn(tables?.pace?.paces ?? {}, input.pace) ? tables.pace.paces[input.pace] : null;
  const grid = gridTarget(tables?.grid, input.invocationLevel, input.invokerLevel);
  const targetSource = { column: grid.column, cite: grid.cite, byHand: grid.byHand };

  const paceMissing = [];
  if (!pace) paceMissing.push("row");
  else {
    if (pace.modifier === null) paceMissing.push("modifier");
    if (pace.band === null) paceMissing.push("band");
  }
  if (paceMissing.length) {
    blocks.push({ key: "paceNotImported", pace: input.pace ?? null, missing: paceMissing, cite: tables?.pace?.cite ?? null, byHand: tables?.pace?.byHand === true });
  }
  if (grid.target === null) blocks.push({ key: "targetBlank", cite: grid.cite, byHand: grid.byHand });
  const set = input.set;
  if (!(given(set?.effectiveLevel) !== null && set.effectiveLevel >= input.invocationLevel)) blocks.push({ key: "noSetHighEnough", needed: input.invocationLevel ?? null });
  if (given(input.stigma) !== null && given(input.threshold) !== null && input.stigma >= input.threshold) {
    blocks.push({ key: "stigmaAtThreshold", stigma: input.stigma, threshold: input.threshold });
  }
  if (input.inCombat && input.pace !== "hasty") blocks.push({ key: "nonHastyInCombat", pace: input.pace ?? null });

  const parts = [];
  if (pace?.modifier != null) parts.push(part("pace", pace.modifier, pace));
  parts.push(part("wisdom", given(input.wisdomMod) ?? 0));
  if (given(input.situational) !== null) parts.push(part("situational", input.situational, { byHand: true }));
  for (const extra of input.extraParts ?? []) {
    if (!extra?.key || given(extra.value) === null || gridIncludes.includes(extra.key)) continue;
    parts.push(part(extra.key, extra.value, extra));
  }
  const sum = parts.reduce((acc, p) => acc + p.value, 0);

  const result = {
    target: grid.target,
    targetSource,
    parts,
    total: null,
    outcome: null,
    proceed: false,
    stigmaMarks: 0,
    damageMarks: 0,
    mishap: null,
    blocks,
    notes,
    pace: pace ? { key: pace.key, time: pace.time, band: pace.band, degreeShift: pace.degreeShift, cite: pace.cite, byHand: pace.byHand } : null,
    gridIncludes: [...gridIncludes],
  };

  const natural = given(input.natural);
  const hurt = Boolean(input.hurt);
  result.total = natural === null ? null : natural + sum;
  if (grid.target === null || paceMissing.length) return result;
  if (natural === null && !hurt) {
    blocks.push({ key: "noRoll" });
    return result;
  }

  const botch = hurt || inBand(pace.band, natural);
  result.outcome = botch ? "botch" : result.total >= grid.target ? "success" : "failure";
  result.proceed = result.outcome === "success";
  if (result.outcome === "success") return result;

  const stigma = markCount(input.marks?.stigmaOnFailure);
  if (stigma === null) notes.push({ key: "noFigure", figure: "stigmaOnFailure" });
  result.stigmaMarks = stigma ?? 0;
  if (!botch) return result;
  const damage = markCount(input.marks?.damageOnBotch);
  if (damage === null) notes.push({ key: "noFigure", figure: "damageOnBotch" });
  result.damageMarks = damage ?? 0;

  result.mishap = mishapThrow(input, tables, pace, grid.target, sum, blocks);
  return result;
}

/** The mishap throw and, if it fails, the degree and the imported cell; see `resolveCeremony`. */
function mishapThrow(input, tables, pace, target, sum, blocks) {
  const m = {
    throw: null,
    passed: null,
    degree: null,
    degreeWord: null,
    shiftedLevel: null,
    setLost: false,
    face: null,
    cell: null,
    cite: null,
    byHand: false,
    die: tables?.mishap?.die ?? null,
    pending: null,
  };
  const natural = given(input.mishapNatural);
  if (natural === null) {
    m.pending = "mishapNatural";
    return m;
  }
  m.throw = { natural, total: natural + sum };
  m.passed = m.throw.total >= target;
  if (m.passed) return m;

  if (pace.degreeShift === null) {
    blocks.push({ key: "degreeUnreadable", why: "degreeRule", cite: tables?.pace?.cite ?? null, byHand: tables?.pace?.byHand === true });
    return m;
  }
  m.shiftedLevel = input.invocationLevel + pace.degreeShift;
  const degree = degreeAt(tables?.degrees, m.shiftedLevel);
  m.cite = degree.cite;
  m.byHand = degree.byHand;
  if (degree.setLost) {
    m.setLost = true;
    return m;
  }
  if (degree.ordinal === null) {
    blocks.push({ key: "degreeUnreadable", why: "noBand", level: m.shiftedLevel, cite: degree.cite, byHand: degree.byHand });
    return m;
  }
  m.degree = degree.ordinal;
  m.degreeWord = degree.word;
  const face = given(input.mishapFace);
  if (face === null) {
    m.pending = "mishapFace";
    return m;
  }
  m.face = face;
  const read = mishapAt(tables?.mishap, face, degree.ordinal);
  m.cell = read.cell;
  m.cite = read.cite;
  m.byHand = read.byHand;
  return m;
}
