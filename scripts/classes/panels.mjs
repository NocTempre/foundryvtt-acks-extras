/* global game, foundry */
/**
 * The boxes a character-building surface is made of, built once and used by
 * both surfaces that show them.
 *
 * The Scores Generator page (stat-page.mjs) grew these first, and the class
 * picker asked a poorer version of the same questions in a dialog of its own —
 * no package, no Intellect picks, a different rendering of the same rung. So
 * the markup lives here and both call it: the picker IS the generator's middle
 * and right columns, with the attribute rolls it has no use for replaced by the
 * level it is setting (assign-app.mjs).
 *
 * Pure string builders. Nothing here reads the DOM, holds state or writes to an
 * actor — a caller passes what it has decided and gets markup back, which is
 * what lets one page inject them and another render them.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { coinLine, templateItemName } from "./chargen.mjs";
import { templateContents } from "./template-packages.mjs";
import { findByRef } from "./registry.mjs";
import { rungSelectHtml } from "./picks.mjs";
import { makeLoc } from "../lib/util.mjs";

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const loc = makeLoc(LANG_PREFIX);

/** What a template's ability entry is called on the page. */
export const grantLabel = (a) =>
  `${a.name || findByRef(a.ref)?.name || a.ref}${a.selection ? ` (${a.selection})` : ""}${a.rank > 1 ? ` ×${a.rank}` : ""}`;

/** What a template's equipment entry is called on the page — the same name the
 *  grant will give it, so the list and the sheet agree. */
export const itemLabel = (i) => `${templateItemName(i) || findByRef(i.ref)?.name || i.ref}${i.qty > 1 ? ` ×${i.qty}` : ""}`;

/** What a template's spellbook entry is called on the page. */
export const spellLabel = (s) => s.name || s.uuid || "";

/** One "this package brings …" line, or nothing when the list is empty. */
const brings = (key, list, label) =>
  list?.length ? `<p class="hint">${esc(loc(key, { parts: list.map(label).join(", ") }))}</p>` : "";

/**
 * The class box: which class, and what these scores disqualify.
 *
 * @param {object} opts
 * @param {object[]} opts.offered   class documents on offer, in book order
 * @param {string} opts.selectedUuid
 * @param {object[]} [opts.unmet]   requirement rows the scores fall short of
 * @param {string} [opts.controls]  markup placed above the selector (the
 *   generator's Judge override lives there; the picker has no such row)
 * @param {string} [opts.hint]      a note under the selector
 */
export function classPanelHtml({ offered = [], selectedUuid = "", unmet = [], controls = "", hint = "" }) {
  return `${controls}
    <div class="form-group">
      <label>${esc(loc("pick.class"))}</label>
      <div class="form-fields">
        <select name="acks-class">${offered
          .map((c) => `<option value="${esc(c.uuid)}"${c.uuid === selectedUuid ? " selected" : ""}>${esc(c.name)}</option>`)
          .join("")}</select>
      </div>
      ${unmet.length ? `<p class="hint">${esc(loc("apply.unmet", { parts: unmet.map((r) => `${r.attr.toUpperCase()} ${r.min}`).join(", ") }))}</p>` : ""}
      ${!offered.length ? `<p class="hint">${esc(loc("chargen.noneQualify"))}</p>` : ""}
      ${hint ? `<p class="hint">${esc(hint)}</p>` : ""}
    </div>`;
}

/**
 * The template box: which starting package, and what it hands over.
 *
 * What the package brings is said BEFORE it is applied rather than only in the
 * chat card afterwards — a starting package is the largest single write either
 * surface makes.
 *
 * @param {object} opts
 * @param {object[]} opts.legal      the packages this surface may offer
 * @param {number|null} opts.selectedMin  the chosen package's band floor
 * @param {object|null} opts.template     the chosen package itself
 * @param {string} opts.ruleHint     the rule under the selector
 * @param {object} [opts.shortfall]  `{profs, spells}` the Intellect cannot hold
 * @param {string} [opts.noneLabel]  an entry meaning "no package", offered by a
 *   surface binding a character who may already own one
 */
export function templatePanelHtml({ legal = [], selectedMin = null, template = null, ruleHint = "", shortfall = null, noneLabel = "" }) {
  // What the package brings is read from its materialized bundle when one is
  // bound (the repairable contents a grant will actually clone), else from
  // the row's own arrays — the same order applyTemplate grants in.
  const contents = template ? templateContents(template) : null;
  const none = noneLabel
    ? `<option value=""${selectedMin == null ? " selected" : ""}>${esc(noneLabel)}</option>`
    : "";
  return `<div class="form-group">
      <label>${esc(loc("chargen.template"))}</label>
      <div class="form-fields">
        <select name="acks-template"${legal.length || noneLabel ? "" : " disabled"}>${none}${legal
          .map(
            (t) =>
              `<option value="${t.rollMin}"${t.rollMin === selectedMin ? " selected" : ""}>${esc(
                t.name + (t.annotation ? ` (${t.annotation})` : ""),
              )} [${t.rollMin}–${t.rollMax}]</option>`,
          )
          .join("")}</select>
      </div>
      ${ruleHint ? `<p class="hint">${esc(ruleHint)}</p>` : ""}
      ${brings("chargen.templateGrants", contents?.abilities, grantLabel)}
      ${brings("chargen.templateItems", contents?.items, itemLabel)}
      ${brings("chargen.templateSpells", contents?.spells, spellLabel)}
      ${template && coinLine(template) ? `<p class="hint">${esc(loc("chargen.templateCoin", { parts: coinLine(template) }))}</p>` : ""}
      ${
        shortfall?.profs
          ? `<p class="hint">${esc(loc("chargen.assumesInt", { profs: shortfall.profs, spells: shortfall.spells }))}</p>`
          : ""
      }
    </div>`;
}

/**
 * The picks box: every question the class and package leave open.
 *
 * Both kinds of question are rungs, and both are rendered by picks.mjs — the
 * class ladder's own choices, and the general proficiencies an Intellect bonus
 * buys on top of them.
 *
 * @param {object} opts
 * @param {object[]} opts.rungs      `{name, label, atLevel, options, selected}`
 * @param {object[]} opts.bonus      the same shape, one per Intellect pick
 * @param {boolean} [opts.offerAnswered] let a rung be closed without a pick.
 *   A character being generated owns nothing yet, so the generator says no;
 *   one being bound from their sheet may already carry the answer.
 * @param {string} [opts.trailer]    markup appended after the rungs
 */
export function picksPanelHtml({ rungs = [], bonus = [], offerAnswered = false, trailer = "" }) {
  const rows = [...rungs, ...bonus].map((r) => rungSelectHtml({ offerAnswered, ...r })).join("");
  return (rows || `<p class="hint">${esc(loc("chargen.nothingToPick"))}</p>`) + trailer;
}
