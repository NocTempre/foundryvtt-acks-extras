/* global game, foundry */
/**
 * ONE chat card for a roll several people made at once.
 *
 * Three surfaces post this shape — the exploration party's checks (Listen,
 * Search, Bash, Track), the party's saving throws, and the Surprise Matrix's
 * results — and each had grown its own renderer: two hand-built
 * `<ul class="results">` lists in the formation feature and a table in the
 * surprise patch. Same question every time (who rolled, what did they get, did
 * it land), three answers, drifting apart: only one of them showed a target,
 * only one showed the modifier stack, and the two lists never gained the
 * design system's tabular figures or banded rows.
 *
 * This is the one renderer. It owns the CARD — banner, note, tables, footnote —
 * and nothing about any particular throw: what a row means, what counts as
 * success, and every localized word on it are the caller's.
 *
 * The markup is the design system's `acks-chat` component plus `acks-table`,
 * which is what makes the card carry its own GROUND as well as its ink: a chat
 * message's panel is not ACKS-themed, so a card that set only colours draws
 * dark-theme lettering on a light panel. `acks-ui` is deliberately absent —
 * `.acks-ui :is(h1,h2,h3,h4)` (base.css) paints headings the spot colour at
 * (0,2,0) and out-specifies `.acks-chat-title` (0,1,0), which would put
 * burgundy lettering on the burgundy banner.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/**
 * How a row is marked. `success`/`failure` are a verdict against a target;
 * `neutral` is emphasis WITHOUT a verdict — the surprise card's marked rows,
 * where whether the result is good news depends on which table you are reading.
 */
const EMPHASIS = Object.freeze({ success: "is-success", failure: "is-failure", neutral: "is-neutral" });

/**
 * @typedef {object} RollCardRow
 * @property {string}  name       Who rolled. Escaped here.
 * @property {number|string} total  What they rolled.
 * @property {number} [target]     The number they needed; the Target column
 *                                 appears only if some row in the section has one.
 * @property {string} [detail]     The modifier stack / source, printed small
 *                                 under the name. Escaped here.
 * @property {string} [tooltip]    Hover text for the total (a dice formula).
 * @property {string} [outcome]    The verdict, already localized; the Result
 *                                 column appears only if some row in the
 *                                 section has one.
 * @property {"success"|"failure"|"neutral"} [emphasis]
 */

/** One `<table>`, or "" when the section has no rows. */
function sectionHtml({ title, rows }) {
  if (!rows?.length) return "";
  const showTarget = rows.some((r) => Number.isFinite(Number(r.target)));
  // Result, like Target, is printed only where there is one: a roll that
  // carries no verdict — initiative — is a name and a number, and an always-on
  // column would head a whole table of blanks.
  const showResult = rows.some((r) => r.outcome);
  let html = title ? `<h4 class="acks-extras-roll-section acks-table-title">${esc(title)}</h4>` : "";
  html += `<table class="acks-table"><thead><tr>`;
  html += `<th>${loc("rollCard.colName")}</th>`;
  html += `<th class="acks-nums">${loc("rollCard.colTotal")}</th>`;
  if (showTarget) html += `<th class="acks-nums">${loc("rollCard.colTarget")}</th>`;
  if (showResult) html += `<th>${loc("rollCard.colResult")}</th>`;
  html += `</tr></thead><tbody>`;
  for (const row of rows) {
    const tip = row.tooltip ? ` data-tooltip="${esc(row.tooltip)}"` : "";
    html += `<tr class="${EMPHASIS[row.emphasis] ?? ""}">`;
    html += `<td>${esc(row.name)}`;
    if (row.detail) html += `<span class="acks-extras-roll-detail">${esc(row.detail)}</span>`;
    html += `</td>`;
    html += `<td class="acks-nums"${tip}>${esc(row.total)}</td>`;
    if (showTarget) {
      const t = Number(row.target);
      html += `<td class="acks-nums">${Number.isFinite(t) ? `${esc(t)}+` : ""}</td>`;
    }
    // A success is the one thing read at a glance, so it takes the bold.
    if (showResult) {
      html += `<td>${row.emphasis === "success" || row.emphasis === "neutral" ? `<strong>${esc(row.outcome)}</strong>` : esc(row.outcome)}</td>`;
    }
    html += `</tr>`;
  }
  return `${html}</tbody></table>`;
}

/**
 * Build the card. Returns "" when every section is empty, so a caller can post
 * conditionally without counting rows itself.
 *
 * @param {object}   card
 * @param {string}   card.title       Banner text, already localized.
 * @param {string}  [card.subtitle]   Right-aligned in the banner — who rolled,
 *                                    or that the card is Judges-only.
 * @param {string}  [card.note]       One line under the banner: a rule reminder.
 * @param {Array<{title?: string, rows: RollCardRow[]}>} card.sections
 * @param {string}  [card.footnote]   Small print at the foot (who could not roll).
 * @returns {string} HTML, or "" if there is nothing to show.
 */
export function renderRollCard({ title, subtitle, note, sections = [], footnote } = {}) {
  const tables = sections.map(sectionHtml).join("");
  if (!tables) return "";
  let html = `<div class="acks-extras-roll-card acks-chat">`;
  html += `<header class="acks-chat-header"><h3 class="acks-chat-title">${esc(title)}</h3>`;
  if (subtitle) html += `<span class="acks-chat-subtitle">${esc(subtitle)}</span>`;
  html += `</header><div class="acks-chat-body">`;
  if (note) html += `<p class="acks-extras-roll-note">${esc(note)}</p>`;
  html += tables;
  if (footnote) html += `<p class="acks-extras-roll-footnote">${esc(footnote)}</p>`;
  return `${html}</div></div>`;
}
