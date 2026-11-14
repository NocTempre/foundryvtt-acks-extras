/**
 * Market reports (RR §VIII.6, the Assessment of Supply and Demand): the pure
 * half. A report holds what one character believes about one market's demand;
 * these functions decide which beliefs a party holds, how two markets compare,
 * what a non-GM may be shown of an outcome, who may hand a report over, and
 * who counts as a trader. Nothing here reads a document — the engine passes
 * plain data in (`plainReport` in `engine/trade-objects.mjs`), which keeps the
 * rules testable offline and the values (a modifier is whatever a report
 * carries) out of this file.
 */
import { numOrNull } from "../../lib/util.mjs";

/** Every outcome a report can carry. `false` is stored but never shown to a non-GM. */
export const REPORT_OUTCOMES = Object.freeze(["success", "partial", "expertise", "false", "rumor"]);

/**
 * The outcome as the viewer may see it. A false assessment is indistinguishable
 * from a partial one to everyone but the Judge, so a non-GM reads it as partial.
 * @param {string} outcome
 * @param {boolean} isGM
 * @returns {string}
 */
export const shownOutcome = (outcome, isGM) => (!isGM && outcome === "false" ? "partial" : outcome);

/**
 * Does a party hold this report? Yes when its `partyId` is the party's or its
 * assessor is one of the party's members.
 * @param {{partyId?: string, assessorUuid?: string}} report
 * @param {{partyId?: string|null, memberUuids?: string[]}} who
 * @returns {boolean}
 */
export function heldByParty(report, { partyId = null, memberUuids = [] } = {}) {
  if (partyId != null && report.partyId === partyId) return true;
  return !!report.assessorUuid && memberUuids.includes(report.assessorUuid);
}

/**
 * Is this belief still waiting for the Judge? A good the trader chose is stored
 * with a null modifier until the Judge answers it, so a missing, blank or
 * non-numeric `dm` is the waiting state and never a zero.
 * @param {{dm?: number|null}|null} [belief]
 * @returns {boolean}
 */
export const isAwaiting = (belief) => numOrNull(belief?.dm) === null;

/**
 * A modifier as it reads on screen: signed, `"0"` for none, null while the
 * Judge has not answered (the caller words the waiting state).
 * @param {number|null|undefined} dm
 * @returns {string|null}
 */
export function dmLabel(dm) {
  const n = numOrNull(dm);
  if (n === null) return null;
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * A modifier the Judge typed or a document holds, as the whole number a
 * belief stores: rounded, and null where nothing numeric stands (the waiting
 * state, never a zero).
 * @param {unknown} value
 * @returns {number|null}
 */
export function storedDm(value) {
  const n = numOrNull(value);
  return n === null ? null : Math.round(n);
}

/**
 * The tooltip a belief's figure carries: where it came from, in the lang key
 * and the data it interpolates. The player's reading is the same whatever the
 * outcome, so a false report gives nothing away; only the Judge's differs.
 * @param {object} o
 * @param {boolean} o.awaiting   The belief has no modifier yet.
 * @param {boolean} o.isGM
 * @param {string} o.outcome     The stored outcome.
 * @param {string} o.truth       The market's current demand, already worded (or the word for a market that is gone).
 * @param {string} o.day         The day the report was assessed, already worded.
 * @param {string} o.assessor    The assessor's name, or a dash.
 * @returns {{key: string, data: object}} a key under `report.tip`
 */
export function beliefTip({ awaiting, isGM, outcome, truth, day, assessor }) {
  if (awaiting) return isGM ? { key: "tip.awaitingGM", data: { truth } } : { key: "tip.awaiting", data: {} };
  if (!isGM) return { key: "tip.learned", data: { day, assessor } };
  return { key: outcome === "false" ? "tip.judgeSet" : "tip.marketNow", data: { truth } };
}

/**
 * The demand modifiers a party believes about one market: the union of the
 * reports whose `partyId` is the party's, or whose assessor is one of its
 * members, keeping the newest belief per category. A belief still waiting for
 * the Judge is skipped, so an older answered figure for the same good keeps
 * standing. A tie on time goes to the later report in the list.
 * @param {Array<{id?: string, marketUuid?: string, partyId?: string, assessorUuid?: string, time?: number, outcome?: string, beliefs?: Array<{category: string, dm: number|null}>}>} reports
 * @param {object} [who]
 * @param {string|null} [who.partyId]        The party id reports are matched on.
 * @param {string[]} [who.memberUuids]       Actors whose own assessments count for the party.
 * @param {string|null} [who.marketUuid]     Restrict to one market; every report counts when null.
 * @returns {Array<{category: string, dm: number, time: number, outcome: string, assessorUuid: string, reportId: string}>} sorted by category
 */
export function beliefsFor(reports, { partyId = null, memberUuids = [], marketUuid = null } = {}) {
  const best = new Map();
  for (const report of reports ?? []) {
    if (marketUuid != null && report.marketUuid !== marketUuid) continue;
    if (!heldByParty(report, { partyId, memberUuids })) continue;
    const time = Number(report.time) || 0;
    for (const belief of report.beliefs ?? []) {
      if (!belief?.category || isAwaiting(belief)) continue;
      const held = best.get(belief.category);
      if (held && held.time > time) continue;
      best.set(belief.category, {
        category: belief.category,
        dm: Number(belief.dm),
        time,
        outcome: report.outcome ?? "",
        assessorUuid: report.assessorUuid ?? "",
        reportId: report.id ?? "",
      });
    }
  }
  return [...best.values()].sort((a, b) => a.category.localeCompare(b.category));
}

/**
 * Two markets' beliefs side by side: one row per good either side has a belief
 * about, with the difference (B minus A) where both do. Beliefs only — a good
 * one market has no belief about stays `null` on that side, and so does one
 * whose belief still waits for the Judge.
 * @param {Array<{category: string, dm: number|null}>} a
 * @param {Array<{category: string, dm: number|null}>} b
 * @returns {Array<{category: string, a: number|null, b: number|null, diff: number|null}>} sorted by category
 */
export function compareBeliefs(a, b) {
  const answered = (rows) => new Map((rows ?? []).filter((row) => !isAwaiting(row)).map((row) => [row.category, Number(row.dm)]));
  const left = answered(a);
  const right = answered(b);
  const categories = [...new Set([...left.keys(), ...right.keys()])].sort((x, y) => x.localeCompare(y));
  return categories.map((category) => {
    const from = left.has(category) ? left.get(category) : null;
    const to = right.has(category) ? right.get(category) : null;
    return { category, a: from, b: to, diff: from !== null && to !== null ? to - from : null };
  });
}

/**
 * Reports gathered by market, newest report first inside each group. A market
 * that no longer resolves is still a group, named by the snapshot each report
 * carries.
 * @param {Array<{marketUuid?: string, marketName?: string, time?: number}>} reports
 * @returns {Array<{marketUuid: string, marketName: string, reports: object[]}>} groups sorted by market name
 */
export function groupByMarket(reports) {
  const groups = new Map();
  for (const report of reports ?? []) {
    const key = report.marketUuid ?? "";
    if (!groups.has(key)) groups.set(key, { marketUuid: key, marketName: report.marketName ?? "", reports: [] });
    groups.get(key).reports.push(report);
  }
  for (const group of groups.values()) group.reports.sort((x, y) => (Number(y.time) || 0) - (Number(x.time) || 0));
  return [...groups.values()].sort((x, y) => x.marketName.localeCompare(y.marketName));
}

/**
 * May this user give a trade object to another character, or discard it?
 * A GM always may; anyone else only when the object is stamped to an actor
 * they own. A give also needs a target character that is not the current owner.
 * @param {object} o
 * @param {boolean} o.isGM
 * @param {boolean} o.ownsStamp          The user owns the actor the object is stamped to.
 * @param {string|null} [o.stampUuid]    The current owner's uuid.
 * @param {string|null} [o.targetUuid]   The intended recipient (omit for a discard).
 * @param {boolean} [o.targetIsCharacter]
 * @returns {{ok: true}|{error: string}}
 */
export function handVerdict({ isGM, ownsStamp, stampUuid = null, targetUuid = undefined, targetIsCharacter = true }) {
  if (!isGM && !ownsStamp) return { error: "notYours" };
  if (targetUuid === undefined) return { ok: true };
  if (!targetUuid || !targetIsCharacter) return { error: "noTarget" };
  if (targetUuid === stampUuid) return { error: "sameOwner" };
  return { ok: true };
}

/**
 * Which goods a report's owner may learn now. A partial assessment leaves the
 * trader a number of goods to choose (RR §VIII.6, step 1 of arbitrage), and a
 * false one leaves the same, since it must not be told apart. A good named
 * twice, or already believed on the report, is dropped and costs no pick.
 * @param {object} o
 * @param {number} o.picks           Goods the report still lets its owner choose.
 * @param {string[]} o.chosen        Catalogue keys the owner chose.
 * @param {string[]} [o.believed]    Keys the report already holds a belief for.
 * @param {string[]} [o.catalog]     Every key the catalogue knows.
 * @returns {{ok: true, categories: string[]}|{error: string, left?: number}}
 */
export function chooseVerdict({ picks = 0, chosen = [], believed = [], catalog = [] } = {}) {
  const left = Math.max(0, Math.floor(Number(picks) || 0));
  if (!left) return { error: "noPicks" };
  const held = new Set(believed);
  const categories = [...new Set(chosen ?? [])].filter((c) => c && !held.has(c));
  if (!categories.length) return { error: "noneChosen" };
  const known = new Set(catalog);
  if (categories.some((c) => !known.has(c))) return { error: "unknownGood" };
  if (categories.length > left) return { error: "tooMany", left };
  return { ok: true, categories };
}

/** The proficiency names that make a character a trader (ability names, matched in code). */
const BARGAINING = /^bargaining\b/i;
const MERCHANT_PROFESSION = /^profession\b.*\bmerchant/i;

/**
 * Is this character a trader for the sake of the Trade tab? Any of: a
 * Bargaining ability, a merchant Profession, the Mercantile Network effect, a
 * report of their own on the trade house, or the Judge's flag.
 * @param {object} facts
 * @param {string[]} [facts.abilityNames]
 * @param {boolean} [facts.hasNetwork]
 * @param {boolean} [facts.ownsReport]
 * @param {boolean} [facts.flagged]
 * @returns {boolean}
 */
export function isTraderProfile({ abilityNames = [], hasNetwork = false, ownsReport = false, flagged = false } = {}) {
  if (flagged || hasNetwork || ownsReport) return true;
  return abilityNames.some((name) => BARGAINING.test(String(name ?? "").trim()) || MERCHANT_PROFESSION.test(String(name ?? "").trim()));
}

/** Escape text for an HTML field. */
const escapeText = (text) =>
  String(text ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");

/**
 * The notes a player types, as the HTML the report stores: escaped, with line
 * breaks kept. Nothing a player types reaches the document as markup.
 * @param {string} text
 * @returns {string}
 */
export const notesToHtml = (text) => escapeText(String(text ?? "").replace(/\r\n?/g, "\n")).replaceAll("\n", "<br>");

/**
 * The plain text the notes editor shows for a stored notes field: the inverse
 * of `notesToHtml`. Markup another hand wrote (the Judge's) is left as typed.
 * @param {string} html
 * @returns {string}
 */
export const htmlToNotes = (html) =>
  String(html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
