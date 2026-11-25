/**
 * The reaction figures a bearer's spell records carry, as rows the influence
 * page offers: the third source beside Active Effects and the abilities model,
 * in the same row shape, so `effectModRow` gates and renders it like the others.
 *
 * The record parts come from lib's `recordParts(actor, "reaction")`, which
 * stacks BEFORE it knows the page's tone, target kinds or alignment. A larger
 * part that does not reach this page would therefore have displaced a smaller
 * one that does. So the candidates are taken whole (`kept` and `dropped`),
 * `scopeApplies` settles each, and the stacking is run again over what the
 * scope leaves, with lib's own `resolveStacking`.
 *
 * Three classes of candidate, after the scope verdict:
 *  - fails: left out of everything;
 *  - applies: resolved among themselves, offered ticked;
 *  - undetermined (a scope the page cannot settle, such as an enemy clause):
 *    offered unticked, and only if it survives a resolve against the applying
 *    parts, so a smaller one never shows beside a larger that stands. Ticking
 *    two rows is the Judge's to do, and `keptRecordRows` resolves the ticked
 *    ones again at the sum, so a figure never adds to a larger one.
 *
 * Whose figure each row carries, and what it yielded, is told in the row's
 * `tip`, which the page shows on the row's label.
 */
import { ROLL_FAMILY } from "./constants.mjs";
import { recordParts, rollModsOf } from "../lib/roll-mods.mjs";
import { resolveStacking } from "../lib/typed-modifiers.mjs";
import { scopeApplies } from "../lib/vocab.mjs";
import { signed } from "../lib/frame-model.mjs";
import { moraleLine } from "../lib/item-run-card-logic.mjs";
import { FLAG_ITEM_RUN, MODULE_ID } from "../lib/constants.mjs";

/** A form-safe row key: the record's effect id and the part's key, with nothing that nests form data. */
const rowKeyOf = (effectId, key) => `rec:${effectId}:${String(key ?? "reaction").replace(/[^A-Za-z0-9_-]/g, "_")}`;

/** Where each (effect, part key) sits among the bearer's records, so a tie keeps the earlier one as lib does. */
function recordOrder(subject) {
  const order = new Map();
  rollModsOf(subject).forEach((entry, i) => {
    const k = `${entry.effect?.id}|${entry.part?.key ?? ""}`;
    if (!order.has(k)) order.set(k, i);
  });
  return order;
}

/**
 * The ids of the bearer's live records, for `keptRecordRows`: a row whose record
 * has ended is not among them.
 * @param {object|null} subject
 * @returns {Set<string>}
 */
export function liveRecordIds(subject) {
  return new Set(subject ? rollModsOf(subject).map((entry) => entry.effect?.id) : []);
}

/**
 * The spell record rows one reaction page offers, in the shared modifier shape
 * (`getEffectReactionMods`) with `source: "record"`, `record: true`, the record's
 * `effectId`, the `stackPart` its figure stacks as and a `tip` naming the spell,
 * its figure and any record that yielded to it.
 *
 * @param {object|null} subject  whose records feed the page
 * @param {object} [page]
 * @param {string|null} [page.tone]  the page's tone, null on a page with none
 * @param {string|null} [page.rollKey]  the roll the page is, `morale` on a morale page: its parts that name this roll are read and the page's other record parts are not; null on a reaction page, which reads the parts that name no roll
 * @param {Set<string>|string[]} [page.kinds]  the target's kind tokens
 * @param {string|null} [page.alignment]  the target's alignment
 * @param {Record<string, boolean>} [page.optionalRules]
 * @returns {object[]}
 */
export function getRecordReactionMods(subject, { tone = null, kinds = [], alignment = null, optionalRules = {}, rollKey = null } = {}) {
  if (!subject) return [];
  const { kept, dropped } = recordParts(subject, "reaction", rollKey ? { rollKey } : {});
  const order = recordOrder(subject);
  const at = (p) => order.get(`${p.effect?.id}|${p.key ?? ""}`) ?? Number.MAX_SAFE_INTEGER;
  const candidates = [...kept, ...dropped].map(({ yieldsTo: _yieldsTo, ...p }) => p).sort((a, b) => at(a) - at(b));

  const verdict = new Map();
  for (const c of candidates) {
    verdict.set(c, scopeApplies(c, { kinds, alignment, tone, optionalRules, sourceAlignment: c.sourceAlignment ?? null, enemy: null }));
  }
  const reaching = candidates.filter((c) => verdict.get(c).applies || verdict.get(c).undetermined);
  const undetermined = new Set(reaching.filter((c) => !verdict.get(c).applies));
  // A part stacks at the figure it is worth here: a sign-mode scope reverses it.
  const worth = (c) => c.value * verdict.get(c).sign;
  const asStacked = (c) => ({ ...c, value: worth(c), orig: c });

  const base = resolveStacking(reaching.filter((c) => !undetermined.has(c)).map(asStacked));
  const standing = new Set(base.kept.map((p) => p.orig));
  const yielded = [...base.dropped];
  // Each undetermined part meets the applying ones alone: another undetermined
  // part is no reason to hide it, since the Judge may rule that one out.
  for (const c of reaching.filter((p) => undetermined.has(p))) {
    const mine = asStacked(c);
    const { kept: won, dropped: lost } = resolveStacking([...base.kept, mine]);
    if (won.includes(mine)) standing.add(c);
    else yielded.push(lost.find((p) => p.orig === c));
  }
  const offered = reaching.filter((c) => standing.has(c));

  const seen = new Set();
  return offered.map((c) => {
    let id = rowKeyOf(c.effect?.id, c.key);
    for (let n = 2; seen.has(id); n++) id = `${rowKeyOf(c.effect?.id, c.key)}_${n}`;
    seen.add(id);
    const lines = yielded
      .filter((y) => y.yieldsTo === c.label)
      .map((y) => game.i18n.format("ACKS-LIB.rollMods.yields", { name: y.label, to: y.yieldsTo }));
    const head = game.i18n.format("ACKS-INFLUENCE.mod.withFigure", { label: c.spell ?? c.label, figure: signed(worth(c)) });
    return {
      id,
      itemId: null,
      label: c.label,
      value: c.value,
      family: rollKey ? ROLL_FAMILY.MORALE : ROLL_FAMILY.REACTION,
      appliesTo: "self",
      situational: false,
      vsKinds: c.vsKinds ?? [],
      vsAlignment: c.vsAlignment ?? null,
      vsAlignmentMode: c.vsAlignmentMode ?? "gate",
      vsAlignmentOf: c.vsAlignmentOf,
      vsEnemy: c.vsEnemy,
      anyOf: c.anyOf,
      tones: Array.isArray(c.tones) ? c.tones : [],
      optionalRule: c.optionalRule ?? null,
      sourceAlignment: c.sourceAlignment ?? null,
      bewitching: false,
      kickerAt: null,
      kickerNote: "",
      unaudited: false,
      source: "record",
      record: true,
      effectId: c.effect?.id ?? null,
      stackPart: c,
      spell: c.spell ?? c.label,
      cite: c.cite ?? "",
      fromItem: !!c.effect?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN],
      tip: [head, ...lines].join(" · "),
    };
  });
}

/**
 * Which ticked record rows contribute: the ticked ones, those of a live record
 * only, resolved among themselves, so the larger of two ticked figures stands
 * and the other adds nothing.
 *
 * @param {object[]} mods  every row of the page, flat
 * @param {Record<string, unknown>} values  the page's ticked values by row key
 * @param {Set<string>|null} [alive]  `liveRecordIds`; null skips the liveness test
 * @returns {Set<string>} the keys of the rows that count
 */
export function keptRecordRows(mods, values, alive = null) {
  const live = (mods ?? []).filter((m) => m.record && values?.[m.key] && (!alive || alive.has(m.effectId)));
  const { kept } = resolveStacking(live.map((m) => ({ ...m.stackPart, value: m.value, rowKey: m.key })));
  return new Set(kept.map((p) => p.rowKey));
}

/**
 * The line a morale roll's working prints for a record row an item's reach
 * wrote (`fromItem`): the item's name under the "In reach of" words with the
 * record's page reference, and the row's own tooltip. A spell's record, and a
 * row of any other page, has none: it keeps the label it was offered under.
 *
 * @param {{record?: boolean, fromItem?: boolean, family?: string, spell?: string, cite?: string, tip?: string|null}} mod a row, as the page offers it
 * @param {{inReachOf: string}} words
 * @returns {{label: string, cite: string, tip: string}|null}
 */
export function moraleWorkingLine(mod, words) {
  if (!mod?.record || !mod.fromItem || mod.family !== ROLL_FAMILY.MORALE) return null;
  return { ...moraleLine({ item: mod.spell ?? "", cite: mod.cite ?? "", words }), tip: [mod.tip, mod.cite].filter(Boolean).join(" · ") };
}
