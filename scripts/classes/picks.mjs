/* global game, foundry */
/**
 * One owner for the question every class surface asks: of the abilities this
 * rung of the ladder offers, which does the character take?
 *
 * Chargen, the level-up wizard and the class picker all ask it, and each grew
 * its own `<select>` — which drifted, because three copies of a question is
 * three places to answer it differently. Only one of them ever considered what
 * the character already owns, and it considered it by DELETING those options,
 * which is what left a rung with no truthful answer for a character who had
 * already taken the proficiency it was asking about.
 *
 * So the rule lives here, once: an option the character already holds is shown
 * and SELECTABLE — picking it closes the rung and grants nothing, because
 * `grantAbility` already declines to double what `ownsRef` recognises. Beside
 * them is a plain "already on the sheet" answer for the proficiency that came
 * from somewhere this rung never listed, and a "leave open" answer, so a rung
 * can always be told the truth without inventing a pick to delete afterwards.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { optionsForChoice, ownsRef } from "./grants.mjs";
import { makeLoc } from "../lib/util.mjs";

/**
 * The answer meaning "this rung is already satisfied by what the character
 * carries — stop asking". It grants nothing and closes the rung, which is the
 * pair a bare ref cannot express when the thing that satisfied the rung is not
 * one of the options it lists.
 */
export const ANSWERED = "__answered__";

/** Does this answer MATERIALIZE an ability? Every ref does; the marker does not. */
export const grantsFrom = (answer) => !!answer && answer !== ANSWERED;

/** Does this answer CLOSE the rung, so it is not asked again? Any answer but
 *  the empty one, which is what "leave it open" is. */
export const closesRung = (answer) => !!answer;

/** Answers that should be granted, deduped and with the markers removed. */
export const grantableRefs = (answers) => [...new Set((answers ?? []).filter(grantsFrom))];

const esc = (s) => foundry.utils.escapeHTML?.(String(s ?? "")) ?? String(s ?? "");
const loc = makeLoc(LANG_PREFIX);

/**
 * Is this level-1 offer one the chosen template has already answered?
 *
 * A starting template arrives "with weapons, armor, equipment, proficiencies,
 * and spells ready for play" (RR Ch. 2), and the Intellect bonus is chosen "on
 * top of those listed for the template" — so the level-1 proficiency picks are
 * the template's to make, and asking for them beside it hands out two
 * proficiencies the character never earned. A pick among NAMED alternatives (a
 * warlock's dark path, a witch's tradition) is not a proficiency the template
 * lists, and stays on offer.
 */
export const answeredByTemplate = (award) => ["classInventory", "generalList"].includes(award?.choice?.from);

/**
 * Every option a rung offers, with the ones the character already holds MARKED
 * rather than removed.
 *
 * `actor` is optional: chargen asks on a character who owns nothing yet, and a
 * question with no actor behind it simply has nothing marked.
 *
 * `granted` is the one case an option IS removed, and it does not contradict
 * the rule above: a held option is a truthful answer to the rung, while an
 * option the chosen package is about to hand over in this same write is a pick
 * that buys nothing — `applyTemplate` grants a printed rank as N copies, so
 * spending a free pick on it doubles the proficiency instead of keeping it.
 * The rung stays closable either way, because the surfaces that pass a package
 * also offer the "already on the sheet" and "leave open" answers.
 */
export function rungOptions(choice, classItem, actor = null, granted = null) {
  return optionsForChoice(choice, classItem)
    .filter((o) => !isGranted(granted, o))
    .map((o) => ({
      ...o,
      owned: !!actor && ownsRef(actor, o.ref),
    }));
}

/** Does a chosen package already hand this option over? Matched on ref where
 *  the entry carries one and on name otherwise (template-packages.mjs). */
export const isGranted = (granted, option) =>
  !!granted &&
  ((!!option?.ref && granted.refs.has(option.ref)) || granted.names.has(String(option?.name ?? "").trim().toLowerCase()));

/**
 * One rung's `<select>`, held-first.
 *
 * The held options are grouped above the rest because for a character being
 * bound at a level they have already played to, the held one IS the answer —
 * putting it where the eye lands is the difference between answering the
 * question and hunting for a pick to throw away.
 *
 * @param {object} opts
 * @param {string} opts.name        the form field name
 * @param {string} opts.label       what this rung is called
 * @param {number|null} [opts.atLevel] the level it sits at, named beside the label
 * @param {Array<{ref: string, name: string, owned?: boolean}>} opts.options
 * @param {string} [opts.selected]  the answer to preselect
 * @param {boolean} [opts.offerAnswered] offer the "already on the sheet" and
 *   "leave open" answers. Chargen builds a character who owns nothing, so it
 *   has nothing to say they already have and passes false.
 * @param {boolean} [opts.placeholder] lead with an empty, pre-selected option.
 *   For a surface where NOT answering has to be distinguishable from answering:
 *   a select whose first entry is a real option spends the pick on that option
 *   the moment the player submits without touching the control.
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
  // Two groups only when there is something to separate — a rung with nothing
  // held reads as the plain list it has always been.
  const body = held.length
    ? `${group("pick.rung.heldGroup", held)}${group("pick.rung.openGroup", open)}`
    : open.map((o) => option(o.ref, o.name)).join("");
  const answers = offerAnswered
    ? `${option(ANSWERED, loc("pick.rung.answered"))}${option("", loc("pick.rung.later"))}`
    : "";
  // Nothing left to offer is not an empty control: a rung whose every option is
  // already held still has to be closable, or it is asked forever.
  const empty = !options.length && !offerAnswered ? option("", loc("pick.rung.none")) : "";
  const lead = placeholder && options.length ? `<option value="" selected>${esc(loc("pick.rung.choose"))}</option>` : "";
  const at = atLevel == null ? "" : ` <span class="acks-extras-classes-refname">(${esc(loc("apply.atLevel", { level: atLevel }))})</span>`;
  return `<div class="form-group"><label>${esc(label)}${at}</label><div class="form-fields"><select name="${esc(
    name,
  )}">${lead}${body}${answers}${empty}</select></div></div>`;
}

/** What one rung is called, falling back to the surface's generic wording. */
export const rungLabel = (award, fallbackKey = "apply.pick") => award?.choice?.label || loc(fallbackKey);

/** Read `count` rung answers off a submitted form, position-preserving — the
 *  position is what says which rung an answer belongs to, so an unanswered rung
 *  holds its place as an empty string rather than vanishing. */
export const readRungs = (form, prefix, count) =>
  Array.from({ length: count }, (_, index) => form?.elements?.[`${prefix}${index}`]?.value ?? "");

/** The same read off a root element rather than a form, for a surface whose
 *  controls are injected into a page it does not own. */
export const readRungsFrom = (root, prefix) =>
  Array.from(root.querySelectorAll(`select[name^="${prefix}"]`), (el) => el.value);
