/**
 * The beastman leader procedure (AXIOMS 2, Beastmen Leaders): a leader built
 * from its warrior by moving down a ladder of Hit Dice ratings and adding to
 * its armour class and damage. Pure, and holds no figure of the page's: the
 * ladder's rungs, the rungs each rank moves, the rating whose hit-point bonus
 * carries over and what each rank adds are all read from the Judge's own copy
 * into the `monsters` registry document (`leaderLadder`, `leaderSteps`) and
 * passed in.
 *
 * What ships is the procedure: a rank moves its warrior's rating down the
 * ladder by its own count of rungs; a warrior at or above the carry rating
 * with a hit-point bonus keeps that bonus on a champion and a sub-chieftain
 * and doubles it on a chieftain; armour class and damage are the warrior's
 * plus the rank's own addition, the damage a total that replaces the
 * warrior's. The page's discretionary adjustment is the Judge's to make on the
 * generated creature and is not applied.
 */
import { getDoc, hasDoc, citeOf, isMissingRow } from "../lib/tables.mjs";

/** The registry document and tables the procedure is read from. */
export const LEADER_DOC = "monsters";
export const LEADER_TABLES = Object.freeze({ ladder: "leaderLadder", steps: "leaderSteps" });

/** The ranks the procedure builds, by role key. */
export const DERIVED_ROLES = Object.freeze(["champion", "subChieftain", "chieftain"]);

/** A rank's key inside `leaderSteps`: `rowsChampion`, `acSubChieftain` … */
const stepKey = (prefix, role) => `${prefix}${role.charAt(0).toUpperCase()}${role.slice(1)}`;

/**
 * One rung as a rating: `{count, bonus, plus}`. A fraction glyph or "1/2" is a
 * part of a die; "N-M" a penalty; "N+M" a bonus; a bare "N+" a bonus the rung
 * does not size (`plus`). Null for a cell that is no rating.
 */
export function parseRung(text) {
  const t = String(text ?? "").trim().replace(/½/g, "1/2");
  if (/^1\s*\/\s*2$/.test(t)) return { count: 0.5, bonus: null, plus: false };
  const m = /^(\d+)\s*(?:([+-])\s*(\d+)?)?$/.exec(t);
  if (!m) return null;
  const count = parseInt(m[1], 10);
  if (!m[2]) return { count, bonus: null, plus: false };
  if (m[3] == null) return m[2] === "+" ? { count, bonus: null, plus: true } : null;
  return { count, bonus: (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10), plus: false };
}

/**
 * Which rung a rating stands on: a part of a die on the fraction rung, a
 * penalty on the rung printing that penalty, a bonus below the carry rating on
 * the rung that prints a bare bonus beside its dice, and anything else on the
 * rung of its whole dice. -1 when no rung holds it.
 */
export function rungIndex(rungs, hd, bonusMinHd) {
  if (!hd) return -1;
  const parsed = rungs.map(parseRung);
  const whole = Math.floor(hd.count);
  if (hd.count < 1) return parsed.findIndex((r) => r && r.count < 1);
  if (hd.bonus < 0) {
    const at = parsed.findIndex((r) => r && r.count === whole && r.bonus === hd.bonus);
    if (at >= 0) return at;
  }
  if (hd.bonus > 0 && !(whole >= bonusMinHd)) {
    const at = parsed.findIndex((r) => r && r.count === whole && r.plus);
    if (at >= 0) return at;
  }
  return parsed.findIndex((r) => r && r.count === whole && r.bonus == null && !r.plus);
}

/**
 * The procedure as the Judge's world holds it: the ladder's rungs top to
 * bottom, the steps, and the citation. Null when either table is not
 * imported or a step it needs is missing, so no leader is derived from part
 * of a procedure.
 */
export function importedLeaderProcedure() {
  if (!hasDoc(LEADER_DOC)) return null;
  const tables = getDoc(LEADER_DOC)?.tables ?? {};
  const ladder = tables[LEADER_TABLES.ladder];
  const steps = tables[LEADER_TABLES.steps];
  if (!ladder || !steps) return null;
  const rungs = Object.keys(ladder)
    .filter((k) => /^rung\d+$/.test(k) && !isMissingRow(ladder[k]))
    .sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
    .map((k) => String(ladder[k]?.hd ?? ladder[k] ?? ""));
  const proc = { rungs, steps, cite: citeOf(LEADER_DOC, LEADER_TABLES.steps) ?? citeOf(LEADER_DOC, LEADER_TABLES.ladder) };
  return procedureComplete(proc) ? proc : null;
}

/** Whether a procedure carries every figure the three ranks need. */
export function procedureComplete(proc) {
  if (!proc?.rungs?.length || !proc.steps) return false;
  const n = (v) => Number.isFinite(Number(v)) && v !== null && v !== "";
  if (!n(proc.steps.bonusMinHd)) return false;
  return DERIVED_ROLES.every((role) => ["rows", "ac", "damage"].every((p) => n(proc.steps[stepKey(p, role)])));
}

/**
 * One rank's figures from its warrior's: `{hd: {count, bonus}, ac, damage,
 * rows, acAdd, damageAdd, carried}` where `carried` is how the warrior's
 * hit-point bonus came along: "carried", "doubled" or "". `base` is `{hd: {count, bonus}, ac,
 * damage}`, `damage` the warrior's modifier (0 for none). Null when the
 * warrior's rating is on no rung, the rank moves past the ladder's last rung,
 * or the procedure is incomplete: a leader is never guessed.
 */
export function deriveLeader(proc, base, role) {
  if (!procedureComplete(proc) || !DERIVED_ROLES.includes(role) || !base?.hd) return null;
  const s = proc.steps;
  const minHd = Number(s.bonusMinHd);
  const from = rungIndex(proc.rungs, base.hd, minHd);
  if (from < 0) return null;
  const rows = Number(s[stepKey("rows", role)]);
  const target = parseRung(proc.rungs[from + rows]);
  if (!target) return null;
  const carries = base.hd.count >= minHd && base.hd.bonus > 0;
  let bonus = target.bonus ?? null;
  if (carries) bonus = role === "chieftain" ? base.hd.bonus * 2 : base.hd.bonus;
  // A rung printing a bare bonus beside its dice is read as the stat line's
  // bare plus is (`hdOf` in importer/leader-roles.mjs).
  else if (target.plus) bonus = 1;
  const acAdd = Number(s[stepKey("ac", role)]);
  const damageAdd = Number(s[stepKey("damage", role)]);
  return {
    hd: { count: target.count, bonus },
    ac: Number(base.ac ?? 0) + acAdd,
    damage: Number(base.damage ?? 0) + damageAdd,
    rows,
    acAdd,
    damageAdd,
    carried: carries ? (role === "chieftain" ? "doubled" : "carried") : "",
  };
}
