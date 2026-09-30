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

/** Every outcome a report can carry. `false` is stored but never shown to a non-GM. */
export const REPORT_OUTCOMES = Object.freeze(["success", "partial", "expertise", "false", "rumor", "migrated"]);

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
 * The demand modifiers a party believes about one market: the union of the
 * reports whose `partyId` is the party's, or whose assessor is one of its
 * members, keeping the newest belief per category. A tie on time goes to the
 * later report in the list.
 * @param {Array<{id?: string, marketUuid?: string, partyId?: string, assessorUuid?: string, time?: number, outcome?: string, beliefs?: Array<{category: string, dm: number}>}>} reports
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
      if (!belief?.category) continue;
      const held = best.get(belief.category);
      if (held && held.time > time) continue;
      best.set(belief.category, {
        category: belief.category,
        dm: Number(belief.dm) || 0,
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
 * one market has no belief about stays `null` on that side.
 * @param {Array<{category: string, dm: number}>} a
 * @param {Array<{category: string, dm: number}>} b
 * @returns {Array<{category: string, a: number|null, b: number|null, diff: number|null}>} sorted by category
 */
export function compareBeliefs(a, b) {
  const left = new Map((a ?? []).map((row) => [row.category, Number(row.dm) || 0]));
  const right = new Map((b ?? []).map((row) => [row.category, Number(row.dm) || 0]));
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
