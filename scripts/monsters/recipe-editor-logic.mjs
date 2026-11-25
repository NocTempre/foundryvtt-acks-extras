/**
 * The recipe editor's logic (`extras.encounter.recipe`): what its two tables
 * show for one encounter state, which parts a hand has changed and how a save
 * marks that, the checks on a part's figures, the reset to the import's copy,
 * the sentences of the stored prose marked by the parts that read them, the
 * link a mount or beast part holds, and which stored recipe each of the editor's
 * doors reads and writes. Pure and Foundry-free: the window only renders what
 * this returns and writes what it hands back.
 *
 * A part's mark is its `origin`: `REGISTER_ORIGIN` on a part as the import
 * wrote it, blank once a hand has changed it (a Judge's own part has none). The
 * import's copy is `cookbook.read.recipe`, kept whole beside each recipe
 * (docs/importer/MODEL.md, "A monster's recipe parts ride the same per-row
 * mechanism"). Every string this returns for a user is a lang key with its data.
 *
 * Rulings: docs/monsters/MODEL.md, "The encounter recipe".
 */
import { RECIPE_ROLES } from "./config.mjs";
import { MODULE_ID } from "./constants.mjs";
import { rollFormula } from "./encounter-recipe.mjs";
import { REFERENCE, resolveOutside } from "./outside-reference.mjs";
import { sameValue } from "../importer/held-edits.mjs";
import { partKind, readEcologyRecipeWithSentences, sentencesOf, unitsIn } from "../importer/ecology-recipe.mjs";
import { CITE_CLASS, readableText, stampedBlocks } from "../importer/prose.mjs";
import { REGISTER_ORIGIN } from "../lib/magic-vocab.mjs";

/** The lang keys this module returns, each present in `lang/en.json`. */
export const RECIPE_TEXT = Object.freeze({
  tipHand: "ACKS-MONSTERS.recipe.tip.hand",
  tipHandOnly: "ACKS-MONSTERS.recipe.tip.handOnly",
  tipRead: "ACKS-MONSTERS.recipe.tip.read",
  problemChance: "ACKS-MONSTERS.recipe.problem.chance",
  problemCount: "ACKS-MONSTERS.recipe.problem.count",
  problemLink: "ACKS-MONSTERS.recipe.problem.link",
});

/** The roles whose part names its creature by a link to that creature's own entry. */
export const LINKED_ROLES = Object.freeze(["mount", "beast"]);

/** Where a recipe sits in an actor's flags, and where the import's copy of it does; also the tail of an option's. */
const RECIPE_FLAG = `flags.${MODULE_ID}.extras.encounter.recipe`;
const COPY_FLAG = `flags.${MODULE_ID}.cookbook.read.recipe`;

/** Whether a count's text is a die or a figure the roll reads: the roll's own test (`rollFormula`), so the editor accepts what the roll evaluates. */
const readsAsDice = (t) => rollFormula(t, () => 0) !== null;
/** A world actor, or an actor of a compendium. */
const ACTOR_UUID_RX = /^(?:Actor\.[^.\s]+|Compendium\.[^.\s]+\.[^.\s]+\.Actor\.[^.\s]+)$/;

const blank = (v) => v === null || v === undefined || (typeof v === "string" && !v.trim());
const text = (v) => (v === null || v === undefined ? "" : String(v));
const figure = (v) => (blank(v) || !Number.isFinite(Number(v)) ? null : Number(v));
const diceOf = (v) => text(v).replace(/\s+/g, "").toLowerCase();

/* -------------------------------------------- */
/*  The part's shape                             */
/* -------------------------------------------- */

/**
 * A part with every stored field present and each in its own type: a blank or
 * missing number is null, a missing string is `""`, a die has its spaces closed
 * and is lowercased, and fields the schema does not declare are dropped. What a
 * form hands back (`""` for a blank chance, `"3"` for a literal) shapes to what
 * the import wrote.
 * @param {object} part
 * @returns {object}
 */
export function shapePart(part = {}) {
  const p = part ?? {};
  return {
    key: text(p.key),
    origin: text(p.origin),
    label: text(p.label),
    role: text(p.role),
    source: { uuid: text(p.source?.uuid), templateCell: text(p.source?.templateCell), stat: text(p.source?.stat), name: text(p.source?.name) },
    count: {
      dice: diceOf(p.count?.dice),
      literal: figure(p.count?.literal),
      ratioOf: text(p.count?.ratioOf),
      percent: figure(p.count?.percent),
      round: text(p.count?.round),
      perUnit: text(p.count?.perUnit),
    },
    chance: figure(p.chance),
    when: { state: text(p.when?.state), place: text(p.when?.place), units: (p.when?.units ?? []).map(text).filter((u) => u.trim()) },
    branch: { group: text(p.branch?.group), band: text(p.branch?.band) },
    moraleWhileAlive: figure(p.moraleWhileAlive),
    cite: text(p.cite),
    basis: text(p.basis),
  };
}

const trimmed = (v) =>
  typeof v === "string" ? v.trim() : Array.isArray(v) ? v.map(trimmed) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, trimmed(x)])) : v;

/** A part as a comparison sees it: shaped, trimmed, and without its `origin`, the mark being what the comparison decides. */
function comparable(part) {
  const { origin: _origin, ...rest } = shapePart(part);
  return trimmed(rest);
}

/**
 * Whether two parts hold the same figures, whatever their `origin`, the order
 * their keys were written in, and null against `""` or `"3"` against 3. This is
 * `sameValue` (`importer/held-edits.mjs`) over `comparable`: the null-versus-blank
 * cleaning is `shapePart`'s, so the comparison has one rule for it.
 * @param {object} a
 * @param {object} b
 * @returns {boolean}
 */
export const samePart = (a, b) => sameValue(comparable(a), comparable(b));

/** The part of `key` in a list, or null. */
const partOf = (list, key) => (Array.isArray(list) ? list.find((p) => p?.key === key) ?? null : null);

/** The part of `key` in the import's copy, or null (no copy, or none of that key). */
const copyPartOf = (readCopy, key) => partOf(readCopy, key);

/* -------------------------------------------- */
/*  The tables                                   */
/* -------------------------------------------- */

/** A part's count as the editor shows it: the figure's text, and the share a count is of another part. */
function countFigure(count = {}) {
  const share = !blank(count.ratioOf);
  const textual = count.dice ? String(count.dice) : Number.isFinite(count.literal) ? String(count.literal) : share ? `${count.percent ?? ""}%` : "";
  return { text: textual, share, of: share ? String(count.ratioOf) : "", round: String(count.round ?? ""), perUnit: String(count.perUnit ?? "") };
}

/** A part's figures as tooltip data: its count, chance, morale bonus and units, each blank where the part holds none, and its page. */
function figuresOf(part) {
  const count = countFigure(part.count);
  return {
    count: count.text, share: count.share, of: count.of, round: count.round, perUnit: count.perUnit,
    chance: Number.isFinite(part.chance) ? part.chance : "",
    morale: Number.isFinite(part.moraleWhileAlive) ? part.moraleWhileAlive : "",
    units: (part.when?.units ?? []).join(", "),
    cite: String(part.cite ?? ""),
  };
}

/** The tooltip of a part's row, as a lang key and its data (where the figure came from; the page reference alone where nothing was read). */
function tipOf(part, copy) {
  const hand = blank(part.origin);
  const label = part.label || part.key;
  if (hand && copy) return { key: RECIPE_TEXT.tipHand, data: { label, ...figuresOf(copy) } };
  if (hand) return { key: RECIPE_TEXT.tipHandOnly, data: { label } };
  return { key: RECIPE_TEXT.tipRead, data: { label, ...figuresOf(part) } };
}

/**
 * One row, with the figures a table shows: `label` (as stored, blank where a Judge has not typed one; the window names such a row by its `key`), `role` (the key) and
 * `roleLabel`, `madeOf` (what a Units row counts: the unit the part names, or
 * `""` for bodies), `count` (`{text, share, of, round, perUnit}`), `chance`
 * (a percent or null), `when` (`{state, place, units}`), `morale`, `cite` (the
 * page), `from` (`hand`, or the part's `basis`), `hand` (origin blank) and `tip`.
 */
function rowOf(part, readCopy) {
  const hand = blank(part.origin);
  return {
    key: part.key,
    label: part.label ?? "",
    role: part.role ?? "",
    roleLabel: RECIPE_ROLES[part.role]?.label ?? "",
    madeOf: part.role === "unit" ? String(part.source?.name ?? "") : "",
    count: countFigure(part.count),
    chance: Number.isFinite(part.chance) ? part.chance : null,
    when: { state: part.when?.state ?? "", place: part.when?.place ?? "", units: [...(part.when?.units ?? [])] },
    morale: Number.isFinite(part.moraleWhileAlive) ? part.moraleWhileAlive : null,
    cite: String(part.cite ?? ""),
    from: hand ? "hand" : part.basis || "",
    hand,
    tip: tipOf(part, copyPartOf(readCopy, part.key)),
  };
}

/**
 * The editor's two tables for one encounter state. A **Units** row is a
 * `size-*` part (`partKind`): what a side of the encounter lines counts, a
 * bodies count or a count of a smaller unit, one for each place and state, and
 * it belongs to the state its `when.state` names. Every other part is a **Parts**
 * row: leaders, guards, casters, dependants, captives, mounts, beasts, and the
 * shares of bodies a sentence splits. A part names a state only where a line
 * fixes one; one that names none is listed under both states, since the roll
 * reads such a part by its unit words alone.
 *
 * @param {{recipe: object[], readCopy?: object[], state: "wandering"|"lair"}} args
 * @returns {{units: object[], parts: object[], words: string[]}} `words` are the unit words the rows name, for a When select
 */
export function editorRows({ recipe, readCopy = [], state } = {}) {
  const list = (Array.isArray(recipe) ? recipe : []).filter(Boolean);
  const unitRows = list.filter((p) => partKind(p) === "size" && p.when?.state === state).map((p) => rowOf(p, readCopy));
  const partRows = list.filter((p) => partKind(p) !== "size" && (blank(p.when?.state) || p.when.state === state)).map((p) => rowOf(p, readCopy));
  const words = new Set();
  for (const p of list) for (const u of p.when?.units ?? []) words.add(String(u).toLowerCase());
  return { units: unitRows, parts: partRows, words: [...words] };
}

/**
 * The header's count: the parts a hand changed or added (origin blank) out of
 * every part of the recipe, whatever the state.
 * @param {object[]} recipe
 * @returns {{hand: number, all: number}}
 */
export function handCount(recipe) {
  const list = (Array.isArray(recipe) ? recipe : []).filter(Boolean);
  return { hand: list.filter((p) => blank(p.origin)).length, all: list.length };
}

/* -------------------------------------------- */
/*  A part's figures                             */
/* -------------------------------------------- */

/**
 * A count field's text as the part's `count` keys it sets: a plain figure is a
 * `literal`, a die with an optional sum is `dice`, blank clears the count. The
 * keys of the other shapes (a share) are cleared too, so a typed figure
 * replaces a share. `perUnit` and `round` are left to their own controls.
 * @param {string} input
 * @returns {{ok: boolean, count?: object}}
 */
export function parseCount(input) {
  const t = diceOf(input);
  const cleared = { dice: "", literal: null, ratioOf: "", percent: null };
  if (!t) return { ok: true, count: cleared };
  if (/^\d+$/.test(t)) return { ok: true, count: { ...cleared, literal: parseInt(t, 10) } };
  if (readsAsDice(t)) return { ok: true, count: { ...cleared, dice: t } };
  return { ok: false };
}

/**
 * The problems with a part's figures, as `{field, key}` (`field` is `chance`,
 * `count` or `link`; `key` a lang key). Runs over what a form hands back, so a
 * string where a number belongs is read as one. A chance must be blank or 0 to
 * 100. A count must be blank or one of a die, a whole figure, or a share (a
 * `ratioOf` with its `percent`). A mount or beast part's link, if it has one,
 * must be an Actor uuid.
 * @param {object} part
 * @returns {{field: string, key: string}[]}
 */
export function validatePart(part) {
  const problems = [];
  const p = part ?? {};
  if (!blank(p.chance)) {
    const n = Number(p.chance);
    if (!Number.isFinite(n) || n < 0 || n > 100) problems.push({ field: "chance", key: RECIPE_TEXT.problemChance });
  }
  const c = p.count ?? {};
  const set = [!blank(c.dice), !blank(c.literal), !blank(c.ratioOf)].filter(Boolean).length;
  const literal = Number(c.literal);
  const percent = Number(c.percent);
  const bad =
    set > 1 ||
    (!blank(c.dice) && !readsAsDice(diceOf(c.dice))) ||
    (!blank(c.literal) && !(Number.isInteger(literal) && literal >= 0)) ||
    (!blank(c.ratioOf) && blank(c.percent)) ||
    (blank(c.ratioOf) && !blank(c.percent)) ||
    (!blank(c.percent) && !(Number.isFinite(percent) && percent >= 0));
  if (bad) problems.push({ field: "count", key: RECIPE_TEXT.problemCount });
  if (LINKED_ROLES.includes(p.role) && !blank(p.source?.uuid) && !ACTOR_UUID_RX.test(String(p.source.uuid).trim())) {
    problems.push({ field: "link", key: RECIPE_TEXT.problemLink });
  }
  return problems;
}

/** `base` with `changes` laid over it: a plain object merges key by key, an array or a figure replaces. */
function laid(base, changes) {
  const out = { ...(base ?? {}) };
  for (const [k, v] of Object.entries(changes ?? {})) {
    if (v === undefined) continue;
    out[k] = v && typeof v === "object" && !Array.isArray(v) && out[k] && typeof out[k] === "object" && !Array.isArray(out[k]) ? laid(out[k], v) : v;
  }
  return out;
}

/**
 * The recipe with part `key` changed, its `origin` decided by the result: blank
 * where the result differs from the import's copy of that key (or the copy holds
 * none), `REGISTER_ORIGIN` where it equals it, so a change put back by hand is no
 * longer a hand's. `changes` is a partial part (`{count: {dice: "2d4"}}`); a
 * `key` or `origin` in it is ignored. The comparison is `samePart`. Nothing is
 * written where the key is not in the recipe or the result has a problem
 * (`validatePart`): the answer is null.
 * @param {object[]} recipe
 * @param {object[]} readCopy the import's copy, `cookbook.read.recipe`
 * @param {string} key
 * @param {object} changes
 * @returns {object[]|null} the new recipe
 */
export function savePart(recipe, readCopy, key, changes) {
  const list = Array.isArray(recipe) ? recipe : [];
  const at = list.findIndex((p) => p?.key === key);
  if (at < 0) return null;
  const { key: _key, origin: _origin, ...edits } = changes ?? {};
  const merged = laid(list[at], edits);
  if (validatePart(merged).length) return null;
  const next = shapePart(merged);
  const copy = copyPartOf(readCopy, key);
  next.origin = copy && samePart(next, copy) ? REGISTER_ORIGIN : "";
  return list.map((p, i) => (i === at ? next : structuredClone(p)));
}

/**
 * The recipe with part `key` put back to the import's copy of it, in its place
 * (appended where the recipe no longer holds it), its origin `REGISTER_ORIGIN`.
 * Null where the copy holds no part of that key.
 * @param {object[]} recipe
 * @param {object[]} readCopy
 * @param {string} key
 * @returns {object[]|null}
 */
export function resetPart(recipe, readCopy, key) {
  const copy = copyPartOf(readCopy, key);
  if (!copy) return null;
  const restored = { ...structuredClone(copy), origin: REGISTER_ORIGIN };
  const list = Array.isArray(recipe) ? recipe : [];
  if (!list.some((p) => p?.key === key)) return [...list.map((p) => structuredClone(p)), restored];
  return list.map((p) => (p?.key === key ? restored : structuredClone(p)));
}

/**
 * The recipe the import's copy gives back whole: every part as read, a Judge's
 * own part gone. Null where there is no copy (nothing was imported), so a reset
 * never empties a recipe.
 * @param {object[]} readCopy
 * @returns {object[]|null}
 */
export function resetAll(readCopy) {
  if (!Array.isArray(readCopy) || !readCopy.length) return null;
  return readCopy.map((p) => ({ ...structuredClone(p), origin: REGISTER_ORIGIN }));
}

/** A fresh id where the caller passes none: letters and digits, as Foundry's own. */
const fallbackId = () => Array.from({ length: 16 }, () => "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"[Math.floor(Math.random() * 62)]).join("");

/**
 * The recipe with a Judge's part added: key `_<id>`, origin blank, every figure
 * blank and the role unchosen. Started from a sentence it takes only the unit
 * words that sentence names (`unitsIn`, the reader's own locator words) and the
 * page reference the caller gives; its label is blank, for the Judge to type,
 * since nothing printed names it. No sentence is stored with the part.
 * @param {object[]} recipe
 * @param {{state?: string, sentence?: {text: string, cite?: string}|null, newId?: () => string}} [args]
 *   `newId` makes the id (Foundry's `randomID` in the window)
 * @returns {{recipe: object[], key: string}}
 */
export function addPart(recipe, { state = "", sentence = null, newId = fallbackId } = {}) {
  const list = Array.isArray(recipe) ? recipe : [];
  let key = `_${newId()}`;
  while (list.some((p) => p?.key === key)) key = `_${newId()}`;
  const part = shapePart({ key, when: { state, units: sentence ? unitsIn(sentence.text) : [] }, cite: sentence?.cite ?? "" });
  return { recipe: [...list.map((p) => structuredClone(p)), part], key };
}

/* -------------------------------------------- */
/*  The reading pane                             */
/* -------------------------------------------- */

/**
 * The paragraphs of a stored description field the import wrote: those inside
 * its stamped block (a Judge's own text beside it does not count), the closing
 * page-reference line left out, each as plain text. The shape
 * `importer/prose.mjs` `bookText` writes and the reader was given.
 * @param {string} html
 * @returns {string[]}
 */
export function storedParagraphs(html) {
  const out = [];
  for (const block of stampedBlocks(html).values()) {
    for (const m of block.matchAll(/<p\b([^>]*)>([\s\S]*?)<\/p>/gi)) {
      if (m[1].includes(CITE_CLASS)) continue;
      const t = readableText(m[2]);
      if (t) out.push(t);
    }
  }
  return out;
}

/**
 * The reader (`readEcologyRecipeWithSentences`) run again over the stored prose.
 * @param {{combat?: string, ecology?: string, encounter?: object|null, variant?: string, cite?: string}} args
 *   `combat` and `ecology` are the stored description fields (HTML)
 * @returns {{parts: object[], sentences: object, paragraphs: {combat: string[], ecology: string[]}}}
 */
export function readStored({ combat = "", ecology = "", encounter = null, variant = "", cite = "" } = {}) {
  const paragraphs = { combat: storedParagraphs(combat), ecology: storedParagraphs(ecology) };
  return { ...readEcologyRecipeWithSentences({ ...paragraphs, encounter, variant, cite }), paragraphs };
}

/**
 * Every sentence of the stored prose, in reading order, with the keys of the
 * recipe's parts that read it (none: an unread sentence). `text` is the
 * caller's own paragraph, passed in from the world; nothing is held here.
 *
 * @param {{combat?: string[], ecology?: string[]}} paragraphs `readStored`'s `paragraphs`
 * @param {object[]} recipe the recipe being edited: only its parts' keys are marked
 * @param {Object<string, {field: string, paragraph: number, sentence: number}[]>} readSentences `readStored`'s `sentences`
 * @returns {{field: string, paragraph: number, sentence: number, text: string, keys: string[]}[]}
 */
export function sentenceMarks(paragraphs, recipe, readSentences) {
  const have = new Set((Array.isArray(recipe) ? recipe : []).map((p) => p?.key));
  const out = [];
  for (const field of ["combat", "ecology"]) {
    (paragraphs?.[field] ?? []).forEach((paragraph, pi) => {
      sentencesOf(paragraph).forEach((sentence, si) => {
        const keys = Object.entries(readSentences ?? {})
          .filter(([key, reads]) => have.has(key) && reads.some((r) => r.field === field && r.paragraph === pi && r.sentence === si))
          .map(([key]) => key);
        out.push({ field, paragraph: pi, sentence: si, text: sentence, keys });
      });
    });
  }
  return out;
}

/* -------------------------------------------- */
/*  Mount and beast links                        */
/* -------------------------------------------- */

/**
 * What a mount or beast part links, and what the library offers for it. The
 * word looked up is the part's printed creature word (`source.name`), else its
 * label. `linked` is the stored link (`stored: true`, `source.uuid`) or, where
 * there is none and exactly one entry answers the word, that entry
 * (`stored: false`): the roll resolves such a word itself, and the window writes
 * it as a link with `linkChanges`. `candidates` are the entries carrying the word
 * and more, or two of one fold, never picked between; `status` is the resolver's.
 * @param {object} part
 * @param {{name: string, uuid: string}[]} entries the library's index
 * @returns {{linked: {uuid: string, name: string, stored: boolean}|null, candidates: object[], status: string}}
 */
export function mountBeastLink(part, entries) {
  const stored = text(part?.source?.uuid).trim();
  if (stored) {
    const entry = (entries ?? []).find((e) => e?.uuid === stored);
    return { linked: { uuid: stored, name: entry?.name ?? text(part.source.name), stored: true }, candidates: [], status: REFERENCE.resolved };
  }
  const word = text(part?.source?.name).trim() || text(part?.label).trim();
  const r = resolveOutside(word, entries);
  const linked = r.status === REFERENCE.resolved && r.entry?.uuid ? { uuid: r.entry.uuid, name: r.entry.name, stored: false } : null;
  return { linked, candidates: r.candidates, status: r.status };
}

/**
 * The `changes` that link a part to a library entry: its uuid and the entry's
 * name as the printed word, no Role cell, for `savePart`.
 * @param {{uuid: string, name: string}} entry
 * @returns {object}
 */
export const linkChanges = (entry) => ({ source: { uuid: entry.uuid, name: entry.name, templateCell: "", stat: "" } });

/* -------------------------------------------- */
/*  Which document an entry point writes         */
/* -------------------------------------------- */

/** The axes of a template's `system`, as plain data. */
const axesOf = (doc) => doc?.system?.toObject?.().axes ?? doc?.system?.axes ?? [];

/** A value at a dotted path, or undefined. */
const getIn = (obj, path) => path.split(".").reduce((o, k) => (o && typeof o === "object" ? o[k] : undefined), obj);

/**
 * Which stored recipe an entry point reads and writes. The monster sheet's
 * Ecology tab writes the actor's own recipe (`kind: "actor"`). The template's
 * variant row, and the chart's Roll, write the variant option's: that copy is the
 * one `rollOrganisation` reads (`variantOptionOf`), and it is a store of its own,
 * so an actor's save does not reach a roll. An option sits inside two arrays,
 * which a document update takes whole, so an option's target names the array
 * (`root`, written through `recipeUpdate`) and spells `path` and `readCopyPath` as
 * the importer's merge does (`system.axes[<axis>].options[<option>]…`), for
 * naming a row, not for an update.
 *
 * @param {object} doc the actor, or the family template
 * @param {{optionKey?: string, axisKey?: string}} [args] `optionKey` names a variant option of a template
 * @returns {{kind: "actor"|"option", path: string, readCopyPath: string, root?: string, axisKey?: string, optionKey?: string}|null} null where the template has no such option
 */
export function recipeTarget(doc, { optionKey = "", axisKey = "variant" } = {}) {
  if (!optionKey) return { kind: "actor", path: RECIPE_FLAG, readCopyPath: COPY_FLAG };
  const axis = axesOf(doc).find((a) => a?.key === axisKey);
  if (!(axis?.options ?? []).some((o) => o?.key === optionKey)) return null;
  const site = `system.axes[${axisKey}].options[${optionKey}]`;
  return { kind: "option", root: "system.axes", axisKey, optionKey, path: `${site}.${RECIPE_FLAG}`, readCopyPath: `${site}.${COPY_FLAG}` };
}

/** The option a target names, of the template's plain axes. */
const optionOf = (axes, target) => axes.find((a) => a?.key === target.axisKey)?.options?.find((o) => o?.key === target.optionKey) ?? null;

/**
 * The stored recipe a target names on `doc`, or `[]`.
 * @param {object} doc
 * @param {object} target `recipeTarget`'s answer
 * @returns {object[]}
 */
export function recipeAt(doc, target) {
  const node = target.kind === "actor" ? doc : optionOf(axesOf(doc), target);
  return getIn(node, RECIPE_FLAG) ?? [];
}

/**
 * The import's copy a target names on `doc`, or `[]`.
 * @param {object} doc
 * @param {object} target
 * @returns {object[]}
 */
export function readCopyAt(doc, target) {
  const node = target.kind === "actor" ? doc : optionOf(axesOf(doc), target);
  return getIn(node, COPY_FLAG) ?? [];
}

/**
 * The update data that writes `recipe` where `target` names: `{<path>: recipe}`
 * for an actor, and for an option the template's axes whole with that option's
 * recipe replaced (the update takes an array whole). The document is not touched.
 * @param {object} doc
 * @param {object} target
 * @param {object[]} recipe
 * @returns {object}
 */
export function recipeUpdate(doc, target, recipe) {
  if (target.kind === "actor") return { [target.path]: recipe };
  const axes = structuredClone(axesOf(doc));
  const option = optionOf(axes, target);
  if (!option) return {};
  option.flags ??= {};
  option.flags[MODULE_ID] ??= {};
  option.flags[MODULE_ID].extras ??= {};
  option.flags[MODULE_ID].extras.encounter ??= {};
  option.flags[MODULE_ID].extras.encounter.recipe = recipe;
  return { [target.root]: axes };
}
