/* global game, foundry */
/**
 * ONE chat card for a roll several people made at once — the exploration
 * party's checks, the party's saving throws, and the Surprise Matrix's
 * results — and for a change a Judge made to several creatures' hit points.
 * Owns the CARD (banner, note, tables, footnote); what a row
 * means, what counts as success, and every localized word are the caller's.
 * The markup is the design system's `acks-chat` plus `acks-table`; `acks-ui`
 * is deliberately absent. See docs/lib/DECISIONS.md, "One renderer for
 * every card where several people roll", and "Found live: `acks-ui`
 * defeats the chat component's own banner."
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
 * A button on a card: `action` is its `data-action`, `label` its words (already
 * localized), `icon` a Font Awesome class line, `data` extra `data-*` attributes
 * by camelCased name, `tooltip` hover text assembled at render. A press is the
 * caller's to bind; the system's chat handler reads only `.card-buttons`, which
 * this card never uses.
 *
 * @typedef {object} RollCardAction
 * @property {string} action
 * @property {string} label
 * @property {string} [icon]
 * @property {Record<string, string|number|boolean>} [data]
 * @property {string} [tooltip]
 * @property {boolean} [disabled]
 */

/**
 * @typedef {object} RollCardRow
 * @property {string}  name       Who rolled. Escaped here.
 * @property {number|string} total  What they rolled.
 * @property {number} [target]     The number they needed; the Target column
 *                                 appears only if some row in the section has one.
 * @property {string} [targetSuffix] What follows the target: "+" by default, "-"
 *                                 for a throw that wants a low total, "" for an exact match.
 * @property {string} [targetTooltip] Hover text for the target (where it came
 *                                 from), assembled at render, so it is written
 *                                 as text and never read as a lang key.
 * @property {string} [detail]     The modifier stack / source, printed small
 *                                 under the name. Escaped here.
 * @property {string} [tooltip]    Hover text for the total (a dice formula), read by
 *                                 core as a lang key or cleaned HTML.
 * @property {string} [tooltipText] Hover text for the total assembled at render, so
 *                                 it is written as text and never read as a lang
 *                                 key; it takes the place of `tooltip` where both
 *                                 are given.
 * @property {RollCardAction[]} [actions] Buttons for the row, in a trailing column
 *                                 that appears only where some row in the section
 *                                 has one.
 * @property {string} [outcome]    The verdict, already localized; the Result
 *                                 column appears only if some row in the
 *                                 section has one.
 * @property {"success"|"failure"|"neutral"} [emphasis]
 */

/** A `data-*` attribute name from a camelCased key. */
const dataName = (key) => `data-${String(key).replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

/** One button of a row or of the card's footer. */
function buttonHtml({ action, label, icon, data, tooltip, disabled }) {
  let attrs = ` data-action="${esc(action)}"`;
  for (const [key, value] of Object.entries(data ?? {})) attrs += ` ${esc(dataName(key))}="${esc(value)}"`;
  if (tooltip) attrs += ` data-tooltip-text="${esc(tooltip)}"`;
  if (disabled) attrs += " disabled";
  const glyph = icon ? `<i class="${esc(icon)}" inert></i>` : "";
  return `<button type="button" class="acks-extras-roll-action"${attrs}>${glyph}<span>${esc(label)}</span></button>`;
}

/** One `<table>`, or "" when the section has no rows. `labels` overrides a column's heading. */
function sectionHtml({ title, titleTooltip, rows }, labels = {}) {
  if (!rows?.length) return "";
  const showTarget = rows.some((r) => Number.isFinite(Number(r.target)));
  // Result, like Target, is printed only where there is one: a roll that
  // carries no verdict — initiative — is a name and a number, and an always-on
  // column would head a whole table of blanks.
  const showResult = rows.some((r) => r.outcome);
  const showActions = rows.some((r) => r.actions?.length);
  const titleTip = titleTooltip ? ` data-tooltip-text="${esc(titleTooltip)}"` : "";
  let html = title ? `<h4 class="acks-extras-roll-section acks-table-title"${titleTip}>${esc(title)}</h4>` : "";
  html += `<table class="acks-table"><thead><tr>`;
  const head = (key, fallback) => esc(labels[key] ?? loc(fallback));
  html += `<th>${head("name", "rollCard.colName")}</th>`;
  html += `<th class="acks-nums">${head("total", "rollCard.colTotal")}</th>`;
  if (showTarget) html += `<th class="acks-nums">${head("target", "rollCard.colTarget")}</th>`;
  if (showResult) html += `<th>${head("result", "rollCard.colResult")}</th>`;
  if (showActions) html += `<th>${head("actions", "rollCard.colActions")}</th>`;
  html += `</tr></thead><tbody>`;
  for (const row of rows) {
    const tip = row.tooltipText ? ` data-tooltip-text="${esc(row.tooltipText)}"` : row.tooltip ? ` data-tooltip="${esc(row.tooltip)}"` : "";
    html += `<tr class="${EMPHASIS[row.emphasis] ?? ""}">`;
    html += `<td>${esc(row.name)}`;
    if (row.detail) html += `<span class="acks-extras-roll-detail">${esc(row.detail)}</span>`;
    html += `</td>`;
    html += `<td class="acks-nums"${tip}>${esc(row.total)}</td>`;
    if (showTarget) {
      const t = Number(row.target);
      const tip = row.targetTooltip && Number.isFinite(t) ? ` data-tooltip-text="${esc(row.targetTooltip)}"` : "";
      html += `<td class="acks-nums"${tip}>${Number.isFinite(t) ? `${esc(t)}${esc(row.targetSuffix ?? "+")}` : ""}</td>`;
    }
    // A success is the one thing read at a glance, so it takes the bold.
    if (showResult) {
      html += `<td>${row.emphasis === "success" || row.emphasis === "neutral" ? `<strong>${esc(row.outcome)}</strong>` : esc(row.outcome)}</td>`;
    }
    if (showActions) html += `<td>${(row.actions ?? []).map(buttonHtml).join("")}</td>`;
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
 * @param {string}  [card.noteTooltip] Hover text for the note, assembled at render.
 * @param {Array<{title?: string, titleTooltip?: string, rows: RollCardRow[]}>} card.sections
 * @param {string}  [card.footnote]   Small print at the foot (who could not roll).
 * @param {string}  [card.empty]      What the card says when no section has a row,
 *                                    already localized. A card with no rows
 *                                    returns "" unless this is given, in which
 *                                    case the banner, this line and the footnote
 *                                    are the whole card.
 * @param {RollCardAction[]} [card.buttons]  Buttons in a footer under the tables and the
 *                                    footnote, classed `acks-extras-roll-actions`.
 * @param {{name?: string, total?: string, target?: string, result?: string, actions?: string}} [card.labels]
 *                                    Column headings in place of the defaults, already localized.
 * @returns {string} HTML, or "" if there is nothing to show.
 */
export function renderRollCard({ title, subtitle, note, noteTooltip, sections = [], footnote, empty, buttons, labels = {} } = {}) {
  const tables = sections.map((section) => sectionHtml(section, labels)).join("");
  if (!tables && !empty) return "";
  let html = `<div class="acks-extras-roll-card acks-chat">`;
  html += `<header class="acks-chat-header"><h3 class="acks-chat-title">${esc(title)}</h3>`;
  if (subtitle) html += `<span class="acks-chat-subtitle">${esc(subtitle)}</span>`;
  html += `</header><div class="acks-chat-body">`;
  if (note) html += `<p class="acks-extras-roll-note"${noteTooltip ? ` data-tooltip-text="${esc(noteTooltip)}"` : ""}>${esc(note)}</p>`;
  html += tables || `<p class="acks-extras-roll-note">${esc(empty)}</p>`;
  if (footnote) html += `<p class="acks-extras-roll-footnote">${esc(footnote)}</p>`;
  if (buttons?.length) html += `<footer class="acks-extras-roll-actions">${buttons.map(buttonHtml).join("")}</footer>`;
  return `${html}</div></div>`;
}
