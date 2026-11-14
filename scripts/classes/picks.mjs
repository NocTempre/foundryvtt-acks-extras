/* global game, foundry */
/**
 * The single owner of the question every class surface asks (chargen, the
 * level-up wizard, the class picker): of the abilities this rung offers, which
 * does the character take?
 *
 * An option the character already holds is shown and selectable; picking it
 * closes the rung and grants nothing, since `grantAbility` declines to double
 * what `ownsRef` recognises. Beside the options sit an "already on the sheet"
 * answer and a "leave open" answer. An open rung is recorded nowhere, so it
 * returns wherever the whole ladder is asked (the picker), not at the next
 * level-up.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { optionsForChoice, ownsRef } from "./grants.mjs";
import { escape as esc, makeLoc } from "../lib/util.mjs";

/**
 * The answer meaning "this rung is already satisfied by what the character
 * carries". It grants nothing and closes the rung.
 */
export const ANSWERED = "__answered__";

/** Does this answer MATERIALIZE an ability? Every ref does; the marker does not. */
export const grantsFrom = (answer) => !!answer && answer !== ANSWERED;

/** Does this answer CLOSE the rung, so it is not asked again? Any answer but
 *  the empty one, which is what "leave it open" is. */
export const closesRung = (answer) => !!answer;

/** Answers that should be granted, deduped and with the markers removed. */
export const grantableRefs = (answers) => [...new Set((answers ?? []).filter(grantsFrom))];

const loc = makeLoc(LANG_PREFIX);

/**
 * Is this level-1 offer one the chosen template has already answered?
 *
 * The level-1 proficiency picks are the template's to make (RR Ch. 2), so only
 * the `classInventory` and `generalList` sources are answered by it; a pick
 * among named alternatives stays on offer.
 */
export const answeredByTemplate = (award) => ["classInventory", "generalList"].includes(award?.choice?.from);

/**
 * Every option a rung offers, with the ones the character already holds marked
 * rather than removed.
 *
 * `actor` is optional; with none, nothing is marked. `granted` is the one case
 * an option is removed: one the chosen package hands over in the same write
 * (`applyTemplate` grants a printed rank as N copies, so a pick on it would
 * double it). `level` is the level the answer is for (a spell offer lists what
 * the class casts there); otherwise the actor's own level stands, and a
 * character being generated is 1st level.
 */
export function rungOptions(choice, classItem, actor = null, granted = null, { level = null } = {}) {
  return optionsForChoice(choice, classItem, { level: level ?? actorLevel(actor) })
    .filter((o) => !isGranted(granted, o))
    .map((o) => ({
      ...o,
      owned: !!actor && ownsRef(actor, o.ref),
    }));
}

/** The level an actor stands at, 1 for one with none set or none at all. */
const actorLevel = (actor) => {
  const n = Number(actor?.system?.details?.level);
  return Number.isFinite(n) && n > 0 ? n : 1;
};

/** Does a chosen package already hand this option over? Matched on ref where
 *  the entry carries one and on name otherwise (template-packages.mjs). */
export const isGranted = (granted, option) =>
  !!granted &&
  ((!!option?.ref && granted.refs.has(option.ref)) || granted.names.has(String(option?.name ?? "").trim().toLowerCase()));

/**
 * One rung's `<select>`, held options grouped first.
 *
 * @param {object} opts
 * @param {string} opts.name        the form field name
 * @param {string} opts.label       what this rung is called
 * @param {number|null} [opts.atLevel] the level it sits at, named beside the label
 * @param {Array<{ref: string, name: string, owned?: boolean}>} opts.options
 * @param {string} [opts.selected]  the answer to preselect
 * @param {boolean} [opts.offerAnswered] offer the "already on the sheet" and
 *   "leave open" answers; chargen passes false.
 * @param {boolean} [opts.placeholder] lead with an empty, pre-selected option,
 *   so submitting untouched does not spend the pick on the first real option.
 */
export function rungSelectHtml({
  name,
  label,
  atLevel = null,
  options = [],
  selected = "",
  offerAnswered = true,
  placeholder = false,
}) {
  const option = (value, text, extra = "") =>
    `<option value="${esc(value)}"${selected === value ? " selected" : ""}${extra}>${esc(text)}</option>`;
  const held = options.filter((o) => o.owned);
  const open = options.filter((o) => !o.owned);
  const group = (key, list) =>
    list.length
      ? `<optgroup label="${esc(loc(key))}">${list.map((o) => option(o.ref, o.name)).join("")}</optgroup>`
      : "";
  // Two groups only when something is held.
  const body = held.length
    ? `${group("pick.rung.heldGroup", held)}${group("pick.rung.openGroup", open)}`
    : open.map((o) => option(o.ref, o.name)).join("");
  // The "leave open" answer names no place the choice waits, since the picker
  // is also served here; the surface that needs a pointer carries it (levelup.mjs).
  const answers = offerAnswered
    ? `${option(ANSWERED, loc("pick.rung.answered"))}${option("", loc("pick.rung.later"))}`
    : "";
  // A rung with no options still has to be closable.
  const empty = !options.length && !offerAnswered ? option("", loc("pick.rung.none")) : "";
  const lead = placeholder && options.length ? `<option value="" selected>${esc(loc("pick.rung.choose"))}</option>` : "";
  const at = atLevel == null ? "" : ` <span class="acks-extras-classes-refname">(${esc(loc("apply.atLevel", { level: atLevel }))})</span>`;
  return `<div class="form-group"><label>${esc(label)}${at}</label><div class="form-fields"><select name="${esc(
    name,
  )}">${lead}${body}${answers}${empty}</select></div></div>`;
}

/** What one rung is called, falling back to the surface's generic wording. */
export const rungLabel = (award, fallbackKey = "apply.pick") => award?.choice?.label || loc(fallbackKey);

/** Read `count` rung answers off a submitted form, position-preserving: an
 *  unanswered rung holds its place as an empty string. */
export const readRungs = (form, prefix, count) =>
  Array.from({ length: count }, (_, index) => form?.elements?.[`${prefix}${index}`]?.value ?? "");
