/**
 * The experience adjustment a character's key attributes earn (RR ch. 1, Key
 * Attributes; applied to an adventure's total, RR ch. 6).
 *
 * A class with two key attributes is governed by the LOWER score. The bands and
 * percentages are the imported `experience` table's; with no table there is no
 * derived adjustment, never a remembered one. A percentage the Judge typed into
 * the system's Actor Tweaks (`system.details.xp.bonus`) outranks the derived
 * one, because core applies that field itself on every gain.
 */
import { getDoc, hasDoc, expectTables, bracketRow } from "../lib/tables.mjs";
import { ATTRIBUTES } from "../lib/vocab.mjs";
import { classForActor } from "./registry.mjs";

/** The registered ruledata document the adjustment reads. */
export const EXPERIENCE_DOC = "experience";

/** Declare what is read — here and by `legacy.mjs` — so import UX can name the gap. */
export function registerXpBonusExpectations() {
  expectTables(EXPERIENCE_DOC, ["keyAttributeXp", "reserveRate", "funeralRate", "bankFee"]);
}

/** The imported band rows, or null where no book has been read. */
export function keyAttributeRows() {
  if (!hasDoc(EXPERIENCE_DOC)) return null;
  const rows = getDoc(EXPERIENCE_DOC)?.tables?.keyAttributeXp;
  return Array.isArray(rows) && rows.length ? rows : null;
}

/**
 * The governing key attribute and the adjustment it earns. Pure.
 * @param {Record<string, number>} scores - attribute key → score
 * @param {Iterable<string>} keys - the class's key attributes
 * @param {object[]|null} rows - `[{min, max, bonus}]`
 * @returns {{attr: string|null, score: number|null, bonus: number|null}}
 *   `bonus` null when there is no table or no key attribute to read; a score
 *   in no band earns 0.
 */
export function deriveXpBonus(scores, keys, rows) {
  const scored = [...(keys ?? [])]
    .map((attr) => ({ attr, score: Number(scores?.[attr]) }))
    .filter((k) => Number.isFinite(k.score));
  if (!scored.length) return { attr: null, score: null, bonus: null };
  const low = scored.reduce((a, b) => (b.score < a.score ? b : a));
  if (!rows) return { ...low, bonus: null };
  return { ...low, bonus: Number(bracketRow(rows, low.score)?.bonus) || 0 };
}

/**
 * The adjustment an actor's experience takes, and where it comes from.
 * @returns {{bonus: number, source: "tweaks"|"keyAttribute"|null, attr: string|null,
 *   attrLabel: string|null, score: number|null, unread: boolean}}
 *   `source` "tweaks" when the system's own field is set (core applies it);
 *   `unread` when the class names key attributes but no table is imported.
 */
export function xpBonusFor(actor) {
  const manual = Number(actor?.system?.details?.xp?.bonus) || 0;
  const keys = classForActor(actor)?.system?.keyAttributes;
  const scores = Object.fromEntries(
    Object.keys(ATTRIBUTES).map((k) => [k, actor?.system?.scores?.[k]?.value]),
  );
  const derived = actor?.type === "character" || actor?.type === "monster"
    ? deriveXpBonus(scores, keys, keyAttributeRows())
    : { attr: null, score: null, bonus: null };
  const attrLabel = derived.attr ? ATTRIBUTES[derived.attr]?.label ?? derived.attr.toUpperCase() : null;
  const base = { attr: derived.attr, attrLabel, score: derived.score, unread: !!derived.attr && derived.bonus == null };
  if (manual) return { ...base, bonus: manual, source: "tweaks" };
  if (derived.bonus) return { ...base, bonus: derived.bonus, source: "keyAttribute" };
  return { ...base, bonus: 0, source: null };
}

/** `amount` with an adjustment of `bonus` percent applied, rounded down as core rounds. */
export const withXpBonus = (amount, bonus) => Math.floor(amount + (amount * (Number(bonus) || 0)) / 100);
