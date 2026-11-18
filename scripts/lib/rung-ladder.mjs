/**
 * The rungs of an invocation-level ladder as a Judge edits them: a LevelValue
 * `{kind: "conditional", on: "invocationLevel", breakpoints}` where each rung
 * is a level and the figure that holds from it up to the next rung. Foundry-free.
 *
 * The editor works on a DRAFT, a list of rungs held apart from the stored
 * value until the Judge saves. A rung carries what the import wrote (`outcome`,
 * `text`) through every rewrite, and a mark of its own once a hand touches it:
 * `hand` is `"edited"` or `"added"` (blank for a rung as imported), `was` the
 * figure an edit replaced and `wasAt` the level it stood at. A figure left blank
 * is `null`, never a number: the ladder resolves null for it.
 */
import { VALUE_SCALES } from "./vocab.mjs";

/** The scale a ladder is keyed on. */
export const INVOCATION_SCALE = "invocationLevel";

/** The kind choice a switch offers for a conditional on the invocation scale; it is never stored as a kind. */
export const INVOCATION_KIND = "invocation";

/** What a hand did to a rung: changed an imported one, or made a new one. */
export const HAND = Object.freeze({ edited: "edited", added: "added" });

/** True for a LevelValue that is a ladder keyed on the invocation level. */
export function isInvocationLadder(lv) {
  return !!lv && typeof lv === "object" && lv.kind === "conditional" && lv.on === INVOCATION_SCALE && VALUE_SCALES[INVOCATION_SCALE] !== undefined;
}

/** The kind choice a stored level value stands on in a switch: the invocation one for its ladder, else its own kind. */
export function kindChoiceOf(lv) {
  if (isInvocationLadder(lv)) return INVOCATION_KIND;
  if (typeof lv === "number") return "flat";
  return lv?.kind || "flat";
}

/**
 * The fragment a kind switch writes. The invocation choice becomes the
 * conditional on the scale, keeping the rungs a value that was on the scale
 * already holds (a switch away and back loses none) and starting empty
 * otherwise; any other fragment is returned as it is.
 * @param {object|number|undefined} stored the level value as stored
 * @param {object} fragment the kind the switch chose, as the form holds it
 */
export function withKindChoice(stored, fragment) {
  if (fragment?.kind !== INVOCATION_KIND) return fragment;
  const keeps = stored && typeof stored === "object" && stored.on === INVOCATION_SCALE;
  return { ...fragment, kind: "conditional", on: INVOCATION_SCALE, breakpoints: keeps ? (stored.breakpoints ?? []) : [] };
}

/** A typed figure as stored: blank is null, a number is itself, anything else is NaN (never a substitute number). */
export function parseFigure(raw) {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === "number") return raw;
  const text = String(raw).trim();
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) ? n : Number.NaN;
}

/** A typed level as stored: a whole number, or NaN for a blank or anything else. */
export function parseLevel(raw) {
  if (typeof raw === "number") return Number.isInteger(raw) ? raw : Number.NaN;
  const text = String(raw ?? "").trim();
  if (text === "") return Number.NaN;
  const n = Number(text);
  return Number.isInteger(n) ? n : Number.NaN;
}

let seed = 0;

/**
 * The draft of a stored ladder: one entry per rung, in stored order, each with
 * an `id` that outlives an edit of its level. A value that is not a ladder on
 * the scale has none.
 * @param {object|undefined} lv the stored level value
 */
export function draftOf(lv) {
  if (!isInvocationLadder(lv)) return [];
  return (lv.breakpoints ?? []).map((b) => ({
    id: ++seed,
    at: Number.isInteger(b.atLevel) ? b.atLevel : Number.NaN,
    value: typeof b.value === "number" ? b.value : null,
    outcome: b.outcome ?? "",
    text: b.text ?? "",
    hand: b.hand ?? "",
    was: typeof b.was === "number" ? b.was : null,
    wasAt: Number.isInteger(b.wasAt) ? b.wasAt : null,
  }));
}

/** A new rung a hand adds: no figure, and a level one past the last (or 1). */
export function newRung(draft) {
  const last = draft.at(-1);
  return { id: ++seed, at: last && Number.isInteger(last.at) ? last.at + 1 : 1, value: null, outcome: "", text: "", hand: HAND.added, was: null, wasAt: null };
}

/**
 * Change one rung's level or figure, in place. A rung as imported takes the
 * `edited` mark the first time either moves, keeping the figure and level it
 * replaced (an edit marked already keeps its first baseline), and a changed
 * figure drops the import's `outcome` and `text`, which described the old one.
 * @param {object} rung a draft rung
 * @param {{at?: number, value?: number|null}} change
 */
export function editRung(rung, change) {
  const levelMoved = "at" in change && !Object.is(change.at, rung.at);
  const figureMoved = "value" in change && !Object.is(change.value, rung.value);
  if (!levelMoved && !figureMoved) return rung;
  if (rung.hand === "") {
    rung.hand = HAND.edited;
    rung.was = rung.value;
    rung.wasAt = Number.isInteger(rung.at) ? rung.at : null;
  }
  if (levelMoved) rung.at = change.at;
  if (figureMoved) {
    rung.value = change.value;
    rung.outcome = "";
    rung.text = "";
  }
  return rung;
}

/**
 * Why a draft cannot be saved, or null: the first rung whose level is not a
 * whole number, then the first level that does not rise past the one before.
 * @returns {{key: "level"|"figure"|"duplicate"|"descending", data: object}|null}
 */
export function validateRungs(draft) {
  for (const [i, rung] of draft.entries()) {
    if (!Number.isInteger(rung.at)) return { key: "level", data: { n: i + 1 } };
    if (Number.isNaN(rung.value)) return { key: "figure", data: { n: i + 1 } };
  }
  for (let i = 1; i < draft.length; i++) {
    if (draft[i].at === draft[i - 1].at) return { key: "duplicate", data: { n: i + 1, level: draft[i].at } };
    if (draft[i].at < draft[i - 1].at) return { key: "descending", data: { n: i + 1, level: draft[i].at, before: draft[i - 1].at } };
  }
  return null;
}

/** The index of every rung the error names, so a window can mark its level box. */
export function invalidRungs(draft) {
  const bad = new Set();
  for (const [i, rung] of draft.entries()) {
    if (!Number.isInteger(rung.at)) bad.add(i);
    if (i > 0 && Number.isInteger(rung.at) && Number.isInteger(draft[i - 1].at) && rung.at <= draft[i - 1].at) bad.add(i);
  }
  return bad;
}

/** One rung as the stored shape: the import's `outcome` and `text` kept, the mark written only where a hand made one. */
function storedRung(rung) {
  const out = { atLevel: rung.at, value: rung.value, outcome: rung.outcome || "", text: rung.text || "" };
  out.hand = rung.hand || "";
  out.was = rung.hand === HAND.edited ? rung.was : null;
  out.wasAt = rung.hand === HAND.edited ? rung.wasAt : null;
  return out;
}

/**
 * The level value a draft saves as: the stored value's own members kept (its
 * rounding), the kind and scale set, the rungs rewritten. A draft that does not
 * validate throws, so nothing invalid is ever handed to a store.
 * @param {object|undefined} base the stored level value
 * @param {object[]} draft
 */
export function ladderOf(base, draft) {
  const error = validateRungs(draft);
  if (error) throw new Error(`rung ladder invalid: ${error.key}`);
  const kept = base && typeof base === "object" ? base : {};
  return { ...kept, kind: "conditional", on: INVOCATION_SCALE, breakpoints: draft.map(storedRung) };
}

/**
 * Put every rung a hand changed back as it was imported: an edit takes its
 * figure and level again, an added rung goes. A rung a hand removed is not
 * kept anywhere and stays removed.
 */
export function restoreImported(draft) {
  const kept = draft.filter((rung) => rung.hand !== HAND.added);
  for (const rung of kept) {
    if (rung.hand !== HAND.edited) continue;
    rung.value = rung.was;
    if (Number.isInteger(rung.wasAt)) rung.at = rung.wasAt;
    rung.hand = "";
    rung.was = null;
    rung.wasAt = null;
  }
  return kept;
}

/** True when a draft holds a rung a hand changed or added, so a restore has something to do. */
export const hasHandWork = (draft) => draft.some((rung) => rung.hand !== "");

/**
 * A draft held against the stored ladder, so a window can say whether a hand
 * moved anything since it opened: the draft's rungs as the stored shape,
 * compared with the stored ones.
 */
export function sameAsStored(draft, lv) {
  const stored = isInvocationLadder(lv) ? (lv.breakpoints ?? []) : [];
  if (stored.length !== draft.length) return false;
  return draft.every((rung, i) => {
    const b = stored[i];
    return Object.is(rung.at, b.atLevel) && Object.is(rung.value, typeof b.value === "number" ? b.value : null) && (rung.hand || "") === (b.hand || "");
  });
}

/**
 * The drafts of every ladder one window holds, apart from the stored values and
 * keyed by figure (a row's field, a spell's path). A draft is seeded from the
 * stored ladder the first time it is read and kept through every redraw of the
 * window until it is saved or discarded; a draft nothing has changed follows the
 * stored ladder, one a hand changed does not. Every change goes through a method
 * that refuses a viewer who may not edit, so no write path past this class
 * exists for a Player. Foundry-free: the window hands in how a ladder is read
 * and who may edit.
 */
export class RungDrafts {
  #entries = new Map();

  /**
   * @param {object} hooks
   * @param {(key: string) => object|undefined} hooks.read the stored level value of one figure
   * @param {() => boolean} hooks.editable whether the viewer may change a ladder
   */
  constructor({ read, editable }) {
    this.read = read;
    this.editable = editable;
  }

  /** The draft of one figure's ladder, seeded or refreshed from the stored one. */
  draft(key) {
    const stored = this.read(key);
    const json = JSON.stringify(stored ?? null);
    const entry = this.#entries.get(key);
    if (!entry || (entry.json !== json && sameAsStored(entry.draft, entry.seed))) {
      this.#entries.set(key, { draft: draftOf(stored), seed: structuredClone(stored ?? null), json });
    }
    return this.#entries.get(key).draft;
  }

  /** True while a hand has changed the figure's draft from what is stored now. */
  dirty(key) {
    return this.#entries.has(key) && !sameAsStored(this.draft(key), this.read(key));
  }

  /** Change one rung of a draft; false for a viewer who may not edit, or a rung that is not there. */
  change(key, index, change) {
    const rung = this.editable() ? this.draft(key)[index] : null;
    if (!rung) return false;
    editRung(rung, change);
    return true;
  }

  /** Add a rung to a draft. */
  add(key) {
    if (!this.editable()) return false;
    const draft = this.draft(key);
    draft.push(newRung(draft));
    return true;
  }

  /** Remove the rung at `index` from a draft. */
  remove(key, index) {
    if (!this.editable() || !this.draft(key)[index]) return false;
    this.draft(key).splice(index, 1);
    return true;
  }

  /** Put every imported figure back in a draft and drop its added rungs; a removed rung stays removed. */
  restore(key) {
    if (!this.editable()) return false;
    const draft = this.draft(key);
    draft.splice(0, draft.length, ...restoreImported(draft));
    return true;
  }

  /** Drop the drafts of these figures, so the next read starts again from what is stored. */
  discard(keys) {
    for (const key of keys) this.#entries.delete(key);
  }

  /** The first reason none of these figures' drafts can be saved, `{key, data, field}`, or null. */
  verdict(keys) {
    for (const field of keys) {
      const error = validateRungs(this.draft(field));
      if (error) return { ...error, field };
    }
    return null;
  }

  /**
   * The level values these figures save as, `{key: levelValue}`, for each whose
   * draft a hand changed. Refused with a throw for a viewer who may not edit and
   * for a draft that does not validate, so nothing invalid reaches a store.
   */
  toSave(keys) {
    if (!this.editable()) throw new Error("rung ladder: the viewer may not edit");
    const out = {};
    for (const key of keys) {
      const draft = this.draft(key);
      const error = validateRungs(draft);
      if (error) throw new Error(`rung ladder invalid: ${error.key}`);
      if (this.dirty(key)) out[key] = ladderOf(this.read(key), draft);
    }
    return out;
  }
}
