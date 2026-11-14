/* global game, foundry */
/**
 * The boxes a character-building surface is made of, shared by the Scores
 * Generator page (stat-page.mjs) and the class picker (assign-app.mjs): class,
 * package, Intellect picks, each rung.
 *
 * Pure string builders: nothing here reads the DOM, holds state or writes to an
 * actor.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { coinLine, templateItemName } from "./chargen.mjs";
import { templateContents } from "./template-packages.mjs";
import { findByRef } from "./registry.mjs";
import { rungSelectHtml } from "./picks.mjs";
import { escape as esc, makeLoc } from "../lib/util.mjs";

const loc = makeLoc(LANG_PREFIX);

/** What a template's ability entry is called on the page. */
export const grantLabel = (a) =>
  `${a.name || findByRef(a.ref)?.name || a.ref}${a.selection ? ` (${a.selection})` : ""}${a.rank > 1 ? ` ×${a.rank}` : ""}`;

/** What a template's equipment entry is called on the page: the name the grant gives it. */
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
 * The template box: which starting package, and what it hands over, said before
 * it is applied.
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
  // The materialized bundle when one is bound, else the row's own arrays: the
  // order applyTemplate grants in.
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
 * Both kinds of question are rungs rendered by picks.mjs: the class ladder's
 * choices, and the proficiencies an Intellect bonus buys.
 *
 * @param {object} opts
 * @param {object[]} opts.rungs      `{name, label, atLevel, options, selected}`
 * @param {object[]} opts.bonus      the same shape, one per Intellect pick
 * @param {boolean} [opts.offerAnswered] let a rung be closed without a pick;
 *   false for a character being generated, who owns nothing yet.
 * @param {string} [opts.trailer]    markup appended after the rungs
 */
export function picksPanelHtml({ rungs = [], bonus = [], offerAnswered = false, trailer = "" }) {
  const rows = [...rungs, ...bonus].map((r) => rungSelectHtml({ offerAnswered, ...r })).join("");
  return (rows || `<p class="hint">${esc(loc("chargen.nothingToPick"))}</p>`) + trailer;
}
