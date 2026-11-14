/**
 * Cookbook runtime: binding a class entry: prose parsers, ladders, training, paths, provenance, class updates.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX, DEFAULT_IMG } from "../constants.mjs";
import { trainingChanges } from "../../classes/training-logic.mjs";
import { BUILDER_DOC_ID, baseXpCost, xpSchedule } from "../../classes/builder-logic.mjs";
import { entryText } from "../prose.mjs";
import { REPAIR, repairWrite, countRepair } from "../refresh.mjs";
import { printedNameOf, printKey } from "../printed-name.mjs";
import { executeEntry } from "../executor.mjs";
import { getDoc, hasDoc } from "../../lib/tables.mjs";
import { slug } from "../../lib/vocab.mjs";
import { materializeTemplates, TEMPLATE_PART } from "../../classes/template-packages.mjs";
import { RACE_TYPE } from "../../classes/constants.mjs";
import { spellNameKey, splitSpellNames, titleIndex } from "../../magic/spell-names.mjs";
import {
  bookStamp, lineOfData, data, ctx, cookbookEntry, bookOf, readableHere, intFrom, NON_ABILITY_KINDS, CLASS_ITEM_TYPE,
  classEntries, spellEntries,
} from "./state.mjs";
import { readForImport, passedOver } from "./read.mjs";
import {
  packFor, createDoc, importedIndex, claimImport, importedDocs, importedItem, ensureFolderPath, ensureItemFolder,
} from "./target.mjs";
import { byCategory } from "./abilities.mjs";

/* -------------------------------------------- */
/*  Classes (kind.class → acks-extras.class)    */
/* -------------------------------------------- */

/* The book prints WIL where the system's score key is wis. */
// WIL is the ACKS II print vocabulary; BTA (and classic sources) print WIS.
const ATTR_KEY = { STR: "str", INT: "int", WIL: "wis", WIS: "wis", DEX: "dex", CON: "con", CHA: "cha" };

/** "Key Attribute:.............STR" → "STR" (label and dot leaders off). */
const stripBullet = (s) => String(s ?? "").replace(/^[^:]*:/, "").replace(/^[.\s]+/, "").trim();

/** Small-caps extraction lowercases a leading cap ("overlord") — restore it. */
const capFirst = (s) => {
  const t = String(s ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

/** Split a printed list on commas that are not inside parentheses. */
const splitList = (s) =>
  String(s ?? "")
    .split(/,(?![^(]*\))/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * Can a printed name-list on a class spread award this entry?
 *
 * A class's Proficiency List and a template's Proficiencies cell name
 * proficiencies, skills and powers. They never name a LANGUAGE — the taxonomy
 * is its own tree — so languages stay out of both tokenizers. Being in them
 * only gives short common words ("Orc", "Ithean", "Draconic") a chance to claim
 * the head of a cell that belongs to something else, which the greedy
 * longest-first match cannot undo.
 */
const isAwardableByName = (entry) => !NON_ABILITY_KINDS.has(entry?.kind) && entry?.kind !== "kind.language";

/**
 * Every printed SURFACE a class list or template cell can name, resolved
 * once — a definition's own name plus any authored `aliases`. Both the list
 * path and the cell path read this ONE index. Collisions are arbitrated by
 * `byCategory`, the same ranking the monster path uses; the world's holdings
 * are deliberately NOT consulted, since what a class's spread means is a
 * fact about the book, not about what has been imported yet. See
 * docs/importer/DECISIONS.md, "A second printed name for a shipped entry is
 * authored on the entry".
 *
 * A definition that withholds its printed name (its name instruction a
 * `heading` read by `hash`) has no surface to spell. It answers to the key of
 * that name's letters instead: `byPrintKey` holds it by the hash, and `menu`
 * carries it as a row with `hash` and an empty surface, which `tokenizeProfs`
 * tests against the words a cell opens with.
 *
 * @returns {{byKey: Map<string, {ref: string, name: string, ambiguous: boolean}>,
 *           byPrintKey: Map<string, {ref: string, name: string, ambiguous: boolean}>,
 *           menu: Array<{surface: string, name: string, ref: string, alias: boolean, hash?: string}>}}
 *   `byKey` is keyed by folded surface; `menu` is ordered longest SURFACE first
 *   (never longest name — a three-letter alias must not sort as if it were the
 *   sixteen-letter entry it belongs to).
 */
export function abilitySurfaceIndex(entries = null) {
  const candidates = new Map(); // folded surface -> {ids:Set, name, alias}
  const keyedCandidates = new Map(); // printKey -> {ids:Set, name}
  // Defaults to every content cookbook; takes an explicit [id, entry] list so
  // the invariant can be tested without a compiled cookbook behind it.
  const source = entries ?? (function* () {
    for (const cb of data.content.values()) yield* Object.entries(cb.entries ?? {});
  })();
  for (const [defId, e] of source) {
    if (!isAwardableByName(e)) continue;
    const hash = e.fields?.name?.op === "heading" ? e.fields.name.hash : null;
    if (hash) {
      const held = keyedCandidates.get(hash) ?? { ids: new Set(), name: e.name };
      held.ids.add(defId);
      keyedCandidates.set(hash, held);
      continue;
    }
    const surfaces = [e.name, ...(e.aliases ?? [])];
    surfaces.forEach((surface, i) => {
      const key = slug(surface);
      if (!key) return;
      const held = candidates.get(key) ?? { ids: new Set(), name: e.name, surface, alias: i > 0 };
      held.ids.add(defId);
      candidates.set(key, held);
    });
  }
  const byKey = new Map();
  const menu = [];
  for (const [key, held] of candidates) {
    const ids = [...held.ids];
    const ref = ids.length === 1 ? ids[0] : byCategory(ids);
    byKey.set(key, { ref, name: held.name, ambiguous: ids.length > 1 });
    menu.push({ surface: held.surface, name: held.name, ref, alias: held.alias });
  }
  const byPrintKey = new Map();
  for (const [hash, held] of keyedCandidates) {
    const ids = [...held.ids];
    const ref = ids.length === 1 ? ids[0] : byCategory(ids);
    byPrintKey.set(hash, { ref, name: held.name, ambiguous: ids.length > 1 });
    menu.push({ surface: "", hash, name: held.name, ref, alias: false });
  }
  menu.sort((a, b) => b.surface.length - a.surface.length);
  return { byKey, byPrintKey, menu };
}

/** The most words a withheld name is tried over at the head of a cell. */
const KEYED_NAME_WORDS = 8;

/**
 * The menu row a cell's opening words answer by the key of their letters, with
 * how many characters those words take (trailing punctuation left in the
 * cell), or null. The longest run of words is tried first. The row is named
 * with the words as the page prints them, since its own name is a label.
 */
function keyedHead(rest, keyed) {
  // A name opens on a letter or digit, as a spelled surface does; a separator
  // ahead of it is skipped by the caller, never counted into the name.
  if (!keyed.length || !/^[\p{L}\p{N}]/u.test(rest)) return null;
  const words = rest.split(" ");
  for (let k = Math.min(KEYED_NAME_WORDS, words.length); k > 0; k--) {
    const span = words.slice(0, k).join(" ").replace(/[^\p{L}\p{N}]+$/u, "");
    const key = printKey(span);
    if (!key) continue;
    const m = keyed.find((row) => row.hash === key);
    if (m) return { ...m, name: span, len: span.length };
  }
  return null;
}

/** One printed name as a regex literal. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A lenient matcher for one printed surface: letters with elastic spacing,
 * because real extraction welds words together.
 *
 * An ALIAS is a truncation the books print with a period after it ("Fighting
 * Style Spec."), so it must not be allowed to claim the head of the longer
 * word it abbreviates — "Spec" may not match "Specialization" — and it must
 * consume the period, or the selection that follows is never seen and the
 * whole style is discarded as unmatched residue.
 */
const lenientRe = (surface, { alias = false } = {}) =>
  new RegExp(
    "^" + String(surface).trim().split(/\s+/).map(escapeRe).join("\\s*") + (alias ? "(?![a-z])\\.?" : ""),
    "i",
  );

/**
 * Tokenize a template's Proficiencies cell: greedy longest-known-name match,
 * then an optional rank digit and an optional parenthesized selection.
 * A selected entry run straight into the next entry's name (RR p. 25) →
 * two entries. Text that matches nothing is skipped a glyph at a time and
 * accumulated on the preceding entry, where it is dropped on the way out —
 * the cell keeps only what resolved.
 */
export function tokenizeProfs(cellText, menu) {
  const out = [];
  let rest = String(cellText ?? "").replace(/\s+/g, " ").trim();
  let guard = 40;
  // A withheld name is tried before any spelled one: a shorter surface must
  // not claim the head of the words it is printed with.
  const keyed = menu.filter((m) => m.hash);
  const spelled = keyed.length ? menu.filter((m) => !m.hash) : menu;
  while (rest && guard-- > 0) {
    let hit = keyedHead(rest, keyed);
    for (const m of hit ? [] : spelled) {
      const match = lenientRe(m.surface, { alias: m.alias }).exec(rest);
      if (match) {
        hit = { ...m, len: match[0].length };
        break;
      }
    }
    if (!hit) {
      // Skip one glyph and keep scanning; the skipped prefix is preserved.
      const stray = rest[0];
      rest = rest.slice(1);
      if (out.length && stray.trim()) out[out.length - 1].tail = (out[out.length - 1].tail ?? "") + stray;
      continue;
    }
    rest = rest.slice(hit.len).trim();
    // The rank sits on EITHER side of the selection: the spreads print
    // a rank after the parenthesis and a rank after a bare name alike (RR p. 82), so a reader that only
    // looked before the parenthesis brought every selected entry in at rank 1.
    const takeRank = () => {
      const m = /^(\d)\b/.exec(rest);
      if (!m) return null;
      rest = rest.slice(m[0].length).trim();
      return parseInt(m[1], 10);
    };
    let rank = takeRank();
    const sel = /^\(([^)]*)\)/.exec(rest);
    if (sel) rest = rest.slice(sel[0].length).trim();
    if (rank == null && sel) rank = takeRank();
    out.push({
      ref: hit.ref,
      name: hit.name,
      rank: rank ?? 1,
      selection: sel ? sel[1].replace(/\s+/g, " ").trim() : "",
    });
  }
  return out.map(({ tail, ...e }) => e);
}

/**
 * Every way this catalogue prints ONE name: head-first with its qualifier
 * after a comma rotated back to the cell's English order, and slash
 * alternatives expanded to one row per word. The HEAD alone is deliberately
 * not a form, or a qualified row would answer for a bare name that is
 * another row's own. See docs/importer/DECISIONS.md, "The catalogue's
 * conventions are rules; what is left is authored".
 */
export function nameForms(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return [];
  const out = [];
  const add = (text) => {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const segments = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const ordered = [raw];
  if (segments.length > 1) ordered.push([...segments].reverse().join(" "));
  for (const form of ordered) {
    const slashed = form.split(/\s+/).map((w) => w.split("/"));
    // One name per slash choice; a form with no slash yields exactly itself.
    let combos = [[]];
    for (const options of slashed) {
      combos = combos.flatMap((prefix) => options.map((o) => [...prefix, o]));
      if (combos.length > 8) break; // no catalogue name is this ambiguous
    }
    for (const c of combos) add(c.join(" "));
  }
  return out;
}

/** One menu row: the printed name, the id it points at, and the folded forms
 *  the descriptor may contain — `forms` from the name as printed, `stripped`
 *  from its paren-free version (an embellished instance contains "spellbook",
 *  never "(blank)"). */
function menuRow(name, ref) {
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const formsOf = (n) => nameForms(n).map((text) => ({ text, fold: fold(text) })).filter((f) => f.fold);
  return {
    name,
    ref,
    fold: fold(name),
    foldStripped: fold(String(name).replace(/\([^)]*\)/g, " ")),
    forms: formsOf(name),
    stripped: formsOf(String(name).replace(/\([^)]*\)/g, " ")),
  };
}

/**
 * The gear a template's Starting Equipment cell can name, longest first.
 *
 * Merges two pipelines: the cookbook's `kind.equipment` rows, then `extra`
 * (gear this import has already materialized, keyed by its own def id). A
 * cookbook entry wins on a shared id.
 * See docs/importer/DECISIONS.md, "A template's equipment menu is BOTH pipelines, and a short name is a whole word".
 */
function equipmentMenu(extra = []) {
  const menu = [];
  const seen = new Set();
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind !== "kind.equipment" || seen.has(defId)) continue;
      seen.add(defId);
      menu.push(menuRow(e.name, defId));
    }
  }
  for (const row of extra) {
    if (!row?.ref || seen.has(row.ref)) continue;
    seen.add(row.ref);
    menu.push(row);
  }
  return menu.sort((a, b) => b.name.length - a.name.length);
}

/** The document types a piece of starting gear can be. */
const GEAR_DOC_TYPES = new Set(["weapon", "armor", "item"]);

/**
 * Menu rows for the gear this world has already materialized. Read from the
 * imported index rather than `game.items`, so a compendium-mode world resolves
 * its templates against the same gear a world-mode one does.
 *
 * Skips any document carrying the `templatePart` flag — a copied skin, not the
 * base item.
 * See docs/importer/DECISIONS.md, "A template part is not an import".
 */
async function materializedGearMenu() {
  const rows = [];
  for (const [id, doc] of await importedIndex()) {
    if (!GEAR_DOC_TYPES.has(doc?.type) || !doc?.name) continue;
    if (doc.flags?.[MODULE_ID]?.[TEMPLATE_PART]) continue;
    rows.push(menuRow(doc.name, id));
  }
  return rows;
}

/**
 * Words that cannot, alone, name a piece of gear. A descriptor made only of
 * these is what is left over when something was lifted out of a clause —
 * never an item in its own right.
 */
const FUNCTION_WORD = new Set([
  "a", "an", "and", "the", "of", "or", "plus", "with", "for",
  "further", "total", "another", "more", "additional", "worth", "each", "any", "",
]);

/**
 * Parse a template's Starting Equipment cell into item descriptors, coin and
 * the encumbrance note. Each descriptor resolves against `menu` (in any of
 * `nameForms`, or via an authored alias) and keeps its printed wording as the
 * skin and its printed price where the cell states one; an unresolved
 * descriptor still imports as a bare named item.
 *
 * Splitting the cell is this function's job; deciding what a piece IS is not —
 * a spell recorded in its own book and a creature an ability confers are
 * lifted off the item list afterwards, by `liftBookSpells` and
 * `liftCompanions`. See docs/importer/ROADMAP.md § Starting equipment.
 */
export function parseEquipment(cellText, menu, aliases = {}) {
  let text = String(cellText ?? "").replace(/\s+/g, " ").trim();
  let enc = "";
  const encMatch = /\(enc\.[^)]*\)\.?\s*$/i.exec(text);
  if (encMatch) {
    enc = encMatch[0].replace(/[().]/g, "").trim();
    text = text.slice(0, encMatch.index).trim().replace(/,\s*$/, "");
  }
  // Printed starting coin, in gold or silver. Removed from the text so the
  // item splitter sees only equipment.
  let gp = 0;
  let sp = 0;
  // An amount inside brackets prices the item it follows, not coin the
  // character carries; the bracket is the test, not any word after the
  // amount.
  // See docs/importer/DECISIONS.md, "Two things read off a cell that were never in it".
  const bracketed = new Set();
  for (const b of text.matchAll(/\([^)]*\)/g)) {
    for (let i = b.index; i < b.index + b[0].length; i++) bracketed.add(i);
  }
  text = text.replace(/(\d[\d,]*)\s*(gp|sp)\b[^,]*/gi, (m, n, unit, offset) => {
    if (bracketed.has(offset)) return m;
    const amount = parseInt(n.replace(/,/g, ""), 10) || 0;
    if (unit.toLowerCase() === "sp") sp += amount;
    else gp += amount;
    return "";
  });
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  // An authored equivalence is a menu row with one form: it matches on exactly
  // the terms a printed name does, so a four-letter key like "pole" can no more
  // fire from inside "polearm" than the catalogue's own short names can.
  // Longest first, so a three-word name is not answered by the two-word name inside it (RR pp. 25, 50, 138).
  // Each value is a ref, or `{ref}` where the register also records WHY.
  const aliasForms = Object.entries(aliases)
    .map(([k, v]) => ({ text: k, fold: fold(k), ref: typeof v === "string" ? v : (v?.ref ?? "") }))
    .filter((a) => a.fold && a.ref)
    .sort((a, b) => b.fold.length - a.fold.length);
  // A contained name resolves a descriptor's printed wording ("smooth-worn
  // staff") to a catalogue item. Six characters is the bare-containment floor;
  // shorter names must match a whole word (trailing plural included). ACKS
  // Extras applies the same floors to world documents (`bestBaseMatch` in
  // classes/template-packages.mjs) and the two must agree.
  // See docs/importer/DECISIONS.md, "A template's equipment menu is BOTH pipelines, and a short name is a whole word".
  const LOOSE_FLOOR = 6;
  const WORD_FLOOR = 4;
  // Seams are `\s*`, never `\s+`: real extraction welds words together.
  const wholeWordIn = (name, descriptor) => {
    const body = String(name).trim().split(/\s+/).map(escapeRe).join("\\s*");
    return body ? new RegExp(`(^|[^a-z0-9])${body}(?:e?s)?([^a-z0-9]|$)`, "i").test(descriptor) : false;
  };
  const contained = (f, form, descriptor, floor = WORD_FLOOR) => {
    if (!form?.fold || !f.includes(form.fold)) return false;
    if (form.fold.length >= LOOSE_FLOOR) return true;
    return form.fold.length >= floor && wholeWordIn(form.text, descriptor);
  };
  // An authored key may be shorter than an inferred one; the whole-word test
  // still applies.
  const AUTHORED_FLOOR = 3;
  // `forms` before `stripped`, so a name that matches as printed is preferred
  // over one that only matches once its bracketed qualifier is dropped. Both
  // fall back to the bare folds, so a hand-built menu still resolves.
  const formsOf = (m) => m.forms ?? [{ text: m.name, fold: m.fold }];
  const strippedOf = (m) => m.stripped ?? [{ text: String(m.name).replace(/\([^)]*\)/g, " "), fold: m.foldStripped }];
  const holds = (forms, f, descriptor) => forms.some((form) => contained(f, form, descriptor));
  const lookup = (descriptor) => {
    const f = fold(descriptor);
    for (const a of aliasForms) {
      if (contained(f, a, descriptor, AUTHORED_FLOOR)) return a.ref;
    }
    const exact = menu.find((m) => formsOf(m).some((form) => form.fold === f));
    return (
      exact?.ref ??
      menu.find((m) => holds(formsOf(m), f, descriptor))?.ref ??
      menu.find((m) => holds(strippedOf(m), f, descriptor))?.ref ??
      ""
    );
  };
  // The catalogue joins a SET's parts with a comma; a template's cell joins
  // the same parts with "with". Asked a second time without it, the two
  // spellings meet.
  // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
  const resolve = (descriptor) => {
    const direct = lookup(descriptor);
    if (direct) return direct;
    const joined = String(descriptor).replace(/\s+with\s+/i, " ");
    return joined === descriptor ? "" : lookup(joined);
  };

  /**
   * Is this descriptor, WHOLE, one item the menu already knows?
   *
   * A different question from `resolve`, and it has to be asked differently.
   * The pair rule below splits "X and Y" only when the whole thing is not
   * already a known item. `resolve`'s containment fallback is too generous
   * for this question, so this matches the whole descriptor and nothing
   * less: an exact menu name (with or without its bracketed qualifier) or an
   * exact alias key.
   */
  const resolveWhole = (descriptor) => {
    const f = fold(descriptor);
    const isWhole = (m) => [...formsOf(m), ...strippedOf(m)].some((form) => form.fold === f);
    return aliasForms.find((a) => a.fold === f)?.ref ?? menu.find(isWhole)?.ref ?? "";
  };
  const items = [];
  const push = (descriptor, note = "") => {
    // Nothing but connective tissue is not a thing — taking the coin out of a
    // clause can strand a bare remainder with no gear word in it.
    if (!descriptor || descriptor.split(/\s+/).every((w) => FUNCTION_WORD.has(w.toLowerCase().replace(/[^a-z]/g, "")))) return;
    const qty = parseInt(/^(\d+)\s/.exec(descriptor)?.[1] ?? "1", 10);
    // A bracketed amount prices the item in front of the reader and overrides
    // a base's price when there is one.
    // See docs/importer/DECISIONS.md, "What the page says a thing is worth is imported with it".
    const priced = /\((\d[\d,]*)\s*gp[^)]*\)/i.exec(descriptor);
    const cost = priced ? parseInt(priced[1].replace(/,/g, ""), 10) : null;
    items.push({
      ref: resolve(descriptor),
      name: descriptor,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      skinName: "",
      note,
      ...(Number.isFinite(cost) && cost > 0 ? { cost } : {}),
    });
  };
  // Semicolons separate too, alongside commas; one inside brackets is left
  // alone for the same reason a comma is.
  /* --- chunking, and the two clauses that span chunks --------------------- */
  //
  // The separators split a cell into chunks; two printed constructions are
  // written ACROSS them and are rejoined below before anything is read.
  // A full stop can be a separator too — only one followed by the start of
  // another descriptor, and never inside brackets, where the abbreviations
  // live.
  // See docs/importer/DECISIONS.md, "Two things read off a cell that were never in it".
  const chunks = text
    .split(/[,;](?![^(]*\))|\.(?![^(]*\))(?=\s+[a-z0-9])/i)
    // Trim before stripping a leading connective — every chunk after the
    // first begins with the separator's space, which a pre-trim strip would
    // miss.
    .map((raw) => raw.replace(/\s+/g, " ").trim().replace(/[.]$/, "").trim())
    .filter(Boolean);

  // A book's contents are an English list: commas until the last item, which
  // carries the "and". Rejoined from the "…book with" chunk up to and
  // including the chunk that opens with "and", only if the list actually
  // closes that way within a few chunks.
  // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
  const BOOK_WITH = /\b(?:spell\s*book|spellbook|prayer\s*book|book)\s+with\b/i;
  const LIST_TAIL = /^and\s+/i;
  const LIST_REACH = 4;
  const joined = [];
  for (let i = 0; i < chunks.length; i++) {
    if (BOOK_WITH.test(chunks[i]) && !LIST_TAIL.test(chunks[i])) {
      let end = -1;
      for (let j = i + 1; j <= Math.min(i + LIST_REACH, chunks.length - 1); j++) {
        if (LIST_TAIL.test(chunks[j])) { end = j; break; }
        // A chunk the menu already knows is gear, not another spell title —
        // the list ended at the comma before it and never carried an "and".
        if (resolve(chunks[j])) break;
      }
      if (end > i) {
        joined.push(chunks.slice(i, end + 1).join(", "));
        i = end;
        continue;
      }
    }
    // A stray comma inside one printed name: rejoining is allowed only when
    // the menu knows the two chunks together as one item, so an ordinary list
    // is never welded.
    const prev = joined[joined.length - 1];
    if (prev && LIST_TAIL.test(chunks[i]) && resolveWhole(`${prev} ${chunks[i]}`)) {
      joined[joined.length - 1] = `${prev} ${chunks[i]}`;
      continue;
    }
    joined.push(chunks[i]);
  }

  for (const chunk of joined) {
    const descriptor = chunk.replace(/^and\s+/i, "").trim();
    if (!descriptor) continue;
    // A counted container splits into itself and its contents; only a digit
    // after "with" splits, and never when the menu already resolves the
    // whole descriptor as a catalogue set.
    // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
    const container = /^(.+?)\s+with\s+(\d+)\s+(.+)$/i.exec(descriptor);
    if (container && !resolve(descriptor)) {
      push(container[1]);
      push(`${container[2]} ${container[3]}`, `carried in ${container[1].toLowerCase()}`);
      continue;
    }
    // A closing bracket can end a descriptor with no comma after it; the same
    // guard as the pair rule below, splitting only when what follows the
    // bracket is itself a known item.
    // See docs/importer/DECISIONS.md, "Two things read off a cell that were never in it".
    const bracketed = /^(.*\))\s+(\S.*)$/.exec(descriptor);
    if (bracketed && resolve(bracketed[1]) && resolve(bracketed[2])) {
      push(bracketed[1]);
      push(bracketed[2]);
      continue;
    }
    // A pair splits only when BOTH halves resolve to known equipment —
    // two weapons joined by "and" are two items, while a garment pair priced
    // as one outfit (RR pp. 25, 27, 33, 35; JJ p. 449) is a known item WHOLE and stays whole. The
    // whole-descriptor test is `resolveWhole`, never `resolve`: see there.
    //
    // "Under" pairs the same way — the templates dress a character in both at
    // once.
    // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
    const pair = /^(.+?)\s+(?:and|under)\s+(.+)$/i.exec(descriptor);
    if (pair && !resolveWhole(descriptor) && resolve(pair[1]) && resolve(pair[2])) {
      push(pair[1]);
      push(pair[2]);
      continue;
    }
    push(descriptor);
  }
  return { items, gp, sp, enc };
}

/**
 * Move a book's printed contents out of its NAME and into the template's spell
 * list. Mutates the matched item (its name is cut back to the book, and the
 * printed sentence is preserved on its note) and returns the spells.
 *
 * Reads both spellbook and prayer-book spellings, after `parseEquipment` has
 * rejoined the clause across its own list's commas. A choice clause ("one
 * spell of character's choice") rides as a nameless row whose `offer` is set,
 * with a stable `key`, rather than as a spell or a dropped sentence.
 * See docs/importer/DECISIONS.md, "A printed pick rides as an offer, not as a dropped sentence".
 *
 * A digit after "with" is a load, not a library: "quiver with 20 arrows".
 * The contents may also sit inside the piece's closing bracket, "<book>
 * (with …)"; a book bracket that does not open with "with" is a note and is
 * left alone.
 *
 * `known` is a predicate on a printed spell title (a `titleIndex`'s `has`):
 * with one, an "and" inside a title is the title's own word and does not
 * split it; without one every conjunction splits.
 */
export function liftBookSpells(items, { known = null } = {}) {
  const BOOK_CONTENTS = /^(.*?(?:spell\s*book|spellbook|prayer\s*book))\s+with\s+(.+)$/i;
  const BOOK_BRACKET = /^(.*?(?:spell\s*book|spellbook|prayer\s*book))\s*\(\s*with\s+(.+?)\s*\)$/i;
  const CHOICE_PHRASE = /\b(choice|choosing|chooses|any)\b/i;
  const spells = [];
  for (const it of items ?? []) {
    const m = BOOK_CONTENTS.exec(it.name ?? "") ?? BOOK_BRACKET.exec(it.name ?? "");
    if (!m || /\d/.test(m[2].split(/\s+/)[0] ?? "")) continue;
    it.name = m[1];
    it.note = it.note ? `${it.note}; holds ${m[2]}` : `holds ${m[2]}`;
    let offered = 0;
    for (const s of splitSpellNames(m[2], known)) {
      const name = capFirst(s.trim());
      if (!name) continue;
      if (!CHOICE_PHRASE.test(name)) {
        spells.push({ uuid: "", name });
        continue;
      }
      // The key is what makes the pick the SAME pick across a re-import and a
      // re-materialize, where the row's position is not stable. Built from the
      // book it came out of and which offer on that book it is.
      offered += 1;
      spells.push({
        uuid: "",
        name: "",
        offer: true,
        choice: { from: "spellList", filter: "any", count: 1, refs: [], label: "", key: `${slug(m[1])}:spell:${offered}` },
      });
    }
  }
  return spells;
}

/**
 * Lift a totem-animal or familiar phrase off the equipment list and turn it
 * into the naming ability's SELECTION, rather than an item with no base.
 *
 * The selection lands on the row's existing entry for that ability when there
 * is one and it has no selection yet; otherwise an entry is added, carrying
 * the ref. Either way the specialized copy is stamped `grantedFrom` that ref,
 * so the class's own award of the same ability does not grant it a second
 * time.
 * See docs/importer/DECISIONS.md, "A totem animal is a creature, and the template is which one".
 *
 * Mutates `items` (the phrase is removed) and `abilities`. Returns how many
 * were lifted.
 */
export function liftCompanions(items, abilities, table) {
  const rows = Object.entries(table ?? {})
    .map(([phrase, v]) => {
      // Seams inside the phrase are `\s*`, for the same reason every other
      // printed phrase's are: real extraction welds words together.
      const body = String(phrase).trim().split(/\s+/).map(escapeRe).join("\\s*");
      return {
        ref: typeof v === "string" ? v : (v?.ref ?? ""),
        re: body ? new RegExp("^(.+?)\\s+" + body + "$", "i") : null,
        length: String(phrase).length,
      };
    })
    .filter((r) => r.ref && r.re)
    .sort((a, b) => b.length - a.length);
  if (!rows.length) return 0;
  let lifted = 0;
  for (let i = (items ?? []).length - 1; i >= 0; i--) {
    const name = String(items[i].name ?? "");
    const hit = rows.map((r) => ({ r, m: r.re.exec(name) })).find((x) => x.m);
    if (!hit) continue;
    const creature = hit.m[1].replace(/\s+/g, " ").trim().toLowerCase();
    if (!creature) continue;
    items.splice(i, 1);
    lifted++;
    const owner = (abilities ?? []).find((a) => a.ref === hit.r.ref);
    if (owner) {
      if (!owner.selection) owner.selection = creature;
    } else {
      abilities.push({ ref: hit.r.ref, name: "", rank: 1, selection: creature });
    }
  }
  return lifted;
}

/** The Proficiencies Gained per Level row for one class, from the executed
 *  classMeta grid: `{l1: "c+ G", …}` keyed by the class's printed name. */
export function classGainsFor(gainsNode, className) {
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const rows = gainsNode?.fields?.gains?.rows ?? [];
  return rows.find((r) => fold(r.label) === fold(className))?.cells ?? null;
}

/**
 * The same `{l4: "C", l5: "G", …}` cell shape parsed from a spread's own
 * "Proficiency Progression" prose. The RR grid names only RR's classes;
 * another book's class states its schedule in sentences — "select one class
 * proficiency … at 4th and 8th level" — so the levels come out of the
 * reader's text. Extraction joins can drop or add spaces around digits,
 * hence the loose \s* seams.
 */
export function proseGainSchedule(body) {
  const text = String(body ?? "");
  const cells = {};
  const add = (lvl, tag) => {
    if (!Number.isInteger(lvl) || lvl < 1) return;
    const key = `l${lvl}`;
    if (!String(cells[key] ?? "").includes(tag)) cells[key] = cells[key] ? `${cells[key]}+${tag}` : tag;
  };
  // Anchored to the SELECT sentence — plain "at 1st level" also opens damage-
  // ladder sentences ("+1 at 1st level, and an additional +1 at 3rd…").
  // A spread may instead state the starting picks as what the class "starts
  // with", beside the one it is given outright.
  const start =
    /at\s*1\s*st\s*level\s*,?[^.]{0,40}?select\s*one[^.]{0,240}/i.exec(text)?.[0] ??
    /starts\s*with[^.]{0,60}?\bone\s*(?:general|class)\s*proficienc[^.]{0,80}/i.exec(text)?.[0] ??
    "";
  if (/one\s*class\s*proficienc/i.test(start)) add(1, "C");
  if (/one\s*general\s*proficienc/i.test(start)) add(1, "G");
  // The level list runs to four entries on the longer classes ("at 3rd, 6th,
  // 9th, and 12th level") — capture the whole span, then read every number.
  // The gain is "an additional" one or plainly "a" one; "one" stays the
  // starting sentence's word and is never read here.
  const later = /(?:additional|\ban?)\s*(class|general)\s*proficienc\w*\s*at\s*((?:\d+\s*(?:st|nd|rd|th)\s*(?:,|and|\s)*)+)level/gi;
  for (const m of text.matchAll(later)) {
    const tag = m[1].toLowerCase() === "class" ? "C" : "G";
    for (const g of m[2].matchAll(/\d+/g)) add(parseInt(g[0], 10), tag);
  }
  return Object.keys(cells).length ? cells : null;
}

/**
 * Level rows for a class whose page states its hit dice in a sentence
 * instead of a text table: one die per level up to a cap, then a flat
 * number of hit points per level past it (RR ch. 3's shape). The register's
 * pattern captures, in order, the die size, the cap and the flat step; every
 * number is the reader's. Experience and title are left unread — `xp` null,
 * `title` empty — for the Judge to fill.
 * @returns {Array<{level:number, xp:null, title:string, hd:string}>} empty
 *   when the pattern is absent or does not match
 */
export function proseHitDiceLevels(body, spec, maximumLevel) {
  if (!spec?.pattern || !Number.isInteger(maximumLevel) || maximumLevel < 1) return [];
  const m = new RegExp(spec.pattern, "i").exec(String(body ?? "")) ?? [];
  const [die, cap, per] = [m[1], m[2], m[3]].map((n) => parseInt(n, 10));
  if (![die, cap, per].every(Number.isInteger)) return [];
  const rows = [];
  for (let level = 1; level <= maximumLevel; level++) {
    const hd = level <= cap ? `${level}d${die}` : `${cap}d${die}+${(level - cap) * per}`;
    rows.push({ level, xp: null, title: "", hd });
  }
  return rows;
}

/**
 * The experience thresholds of a class built by the JJ class-creation
 * procedure, priced against the world's builder tables: the register's
 * allocation, the racial value's cost read from the race's own page by the
 * register's pattern, and the saves chassis's flat increment past the imported
 * level the doubling stops at.
 * @param {object} build - the register's `build` block (allocation + race)
 * @param {string} raceText - the race page's raw text
 * @param {object|null} tables - the assembled `acks.classBuilder` tables
 * @param {number} maximumLevel
 * @param {string} chassis - the class's saves chassis
 * @returns {{xp:number[], base:number, raceCost:number}|null} null where the
 *   tables, the race cost or a priced row is missing — a partial price is
 *   never written
 */
export function buildXp(build, raceText, tables, maximumLevel, chassis) {
  if (!build || !tables?.budget || !Number.isInteger(maximumLevel)) return null;
  const raceValue = build.race?.value ?? 0;
  let raceCost = 0;
  if (build.race?.pattern) {
    const m = new RegExp(build.race.pattern, "i").exec(String(raceText ?? ""));
    raceCost = m ? parseInt(m[1].replace(/,/g, ""), 10) : NaN;
    if (!Number.isInteger(raceCost)) return null;
  }
  const state = {
    hdValue: build.hdValue ?? 0,
    fighting: { value: build.fighting?.value ?? 0, sub: build.fighting?.sub ?? "" },
    thievery: { value: build.thievery?.value ?? 0 },
    magic: build.magic ?? [],
    race: { value: raceValue },
    tradeoffs: build.tradeoffs ?? [],
  };
  const issues = [];
  const base = baseXpCost(state, tables, { values: [{ value: raceValue, xpCost: raceCost }] }, issues);
  const post = tables.budget.postEight ?? {};
  const increment = chassis === "crusader" || chassis === "thief" ? post.crusaderThief : post[chassis];
  const flatAfter = tables.budget.xpFlatAfter;
  if (issues.length || !Number.isInteger(increment) || !Number.isInteger(flatAfter)) return null;
  const xp = xpSchedule(base, maximumLevel, { smoothing: tables.budget.smoothing, flatIncrement: increment, flatAfter });
  return { xp, base, raceCost };
}

/** The class-builder tables the world imported from the Judge's JJ, or null. */
const worldBuilderTables = () => (hasDoc(BUILDER_DOC_ID) ? (getDoc(BUILDER_DOC_ID).tables ?? null) : null);

/** The allocation and figures a priced class's experience came from. */
const buildProvenance = (build, priced) => ({
  base: priced.base,
  hd: build.hdValue ?? 0,
  fighting: `${build.fighting?.value ?? 0}${build.fighting?.sub ?? ""}`,
  thievery: build.thievery?.value ?? 0,
  magic: (build.magic ?? []).map((m) => `${m.type} ${m.value}`).join(", "),
  race: build.race?.value ?? 0,
  raceCost: priced.raceCost,
  tradeoffs: (build.tradeoffs ?? []).length,
});

/**
 * A damage-bonus ladder stated as a sentence: a first bonus at a starting
 * level, then a step added at each level of a list. The register's pattern
 * captures, in order, the first bonus, its level, the step and the list of
 * levels; its key's prefix says who the bonus applies to (`apply.mjs`
 * `damageBonusLadder`).
 * @returns {{key:string, label:string, values:Array<{atLevel:number, value:number, text:string}>}|null}
 */
export function proseDamageLadder(body, spec) {
  if (!spec?.pattern || !spec.key) return null;
  const m = new RegExp(spec.pattern, "i").exec(String(body ?? "")) ?? [];
  const [first, start, step] = [m[1], m[2], m[3]].map((n) => parseInt(n, 10));
  if (![first, start, step].every(Number.isInteger)) return null;
  const at = [...String(m[4] ?? "").matchAll(/\d+/g)].map((m) => parseInt(m[0], 10)).filter((n) => n > start);
  const values = [{ atLevel: start, value: first }];
  for (const level of [...new Set(at)].sort((a, b) => a - b)) values.push({ atLevel: level, value: values.at(-1).value + step });
  return {
    key: spec.key,
    label: spec.key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
    values: values.map((r) => ({ ...r, text: `+${r.value}` })),
  };
}

/**
 * Every dash a page may print in an empty cell. A dash says the character
 * cannot act at that rung at all; every other non-numeric cell says the rung is
 * reached without a throw.
 */
const DASHES = new Set(["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]);

/**
 * A grid keyed on a NAME rather than on a level, as one LADDER per row \u2014
 * each row's cells sorted by the header's level scale into `{atLevel, value}`
 * or `{atLevel, outcome, text}` rungs.
 *
 * The cell rule is structural and holds no printed letter: a numeric cell is
 * a target, a dash is a rung the character cannot act on, anything else
 * non-empty is a rung reached without a throw.
 * See docs/importer/DECISIONS.md, "A grid may be keyed on a name, and its cells need not be numbers".
 *
 * The one derivation of these keys, so an ability naming a ladder and the
 * class publishing it cannot disagree about what it is called.
 */
export function gridLadders(grid, prefix) {
  const scale = new Map();
  for (const [col, cell] of Object.entries(grid?.header ?? {})) {
    const at = intFrom(String(cell ?? ""));
    if (at != null) scale.set(col, at);
  }
  if (!scale.size) return [];
  const out = [];
  for (const row of grid?.rows ?? []) {
    // The label may carry a footnote marker; the marker is about the row, not
    // part of its name.
    const name = String(row.label ?? "").replace(/[*\u2020\u2021\s]+$/, "").trim();
    if (!name) continue;
    const values = [];
    for (const [col, cell] of Object.entries(row.cells ?? {})) {
      const atLevel = scale.get(col);
      if (atLevel == null) continue;
      const text = String(cell ?? "").trim();
      if (!text) continue;
      const value = intFrom(text);
      values.push(
        value != null
          ? { atLevel, value, text: "" }
          : { atLevel, value: null, outcome: DASHES.has(text) ? "none" : "auto", text },
      );
    }
    if (!values.length) continue;
    values.sort((a, b) => a.atLevel - b.atLevel);
    out.push({ key: `${prefix}${name.replace(/[^A-Za-z0-9]/g, "")}`, label: name, values });
  }
  return out;
}

/**
 * The ladders a `fromLadders` spec expands over, read from the class entry
 * that publishes them. Resolved from the cookbook rather than a world
 * document, so it does not matter whether the class has been imported yet.
 *
 * @returns {Promise<Array<{key: string, label: string}>>} empty when the class
 *   entry, its book, or the grid is unreachable \u2014 a missing table drops the
 *   throws rather than inventing any.
 */
export async function laddersForEntry(entry, { pageCache = null } = {}) {
  const specs = (entry?.fields?.rolls?.specs ?? []).filter((sp) => sp?.fromLadders);
  if (!specs.length) return null;
  const out = {};
  for (const sp of specs) out[sp.key ?? "ladders"] = await laddersFromSpec(sp.fromLadders, { pageCache });
  return out;
}

/** Reads the keys and labels of the ladders a spec's class entry prints in its named grid; empty when the class or its book is unavailable. */
export async function laddersFromSpec(spec, { pageCache = null } = {}) {
  const classId = `def.class.${spec?.as ?? ""}`;
  const found = spec?.as ? cookbookEntry(classId) : null;
  if (!found) return [];
  const { node } = await readForImport(classId, { ...(pageCache ? { pageCache } : {}) }).catch(() => ({ node: null }));
  if (!node) return [];
  const grid = node.fields?.[spec.grid ?? "rebuking"];
  return gridLadders(grid, spec.prefix ?? "").map(({ key, label }) => ({ key, label }));
}

/**
 * Bind one executed class entry to `acks-extras.class` item data. Everything
 * numeric or listed comes from `node` (the reader's own book). An import
 * never calls this with a null node (`readForImport` passes the entry over);
 * a stub already in a world is what the constructor sheet explains.
 * `opts.gains` is this class's Proficiencies-Gained-per-Level row — each C
 * becomes a class-proficiency ChoiceSpec award, each G a general one.
 * `opts.gear` is the grid-materialized half of the equipment menu (see
 * `equipmentMenu`); omitted, a template's cell can name no weapon and no
 * armour, so the caller supplies it.
 */
export function bindClass(
  entry,
  node,
  id,
  { gains = null, commonName = null, gear = [], spellTitles = null, printedRepertoire = null, builderTables = null } = {},
) {
  const cite = entry.cite ?? "";
  const f = node?.fields ?? {};
  // Body fields arrive one per page (`body61`) or one per page-column
  // (`body61c0`, `body61c1`) — emission order is reading order either way.
  const bodyParts = Object.entries(f)
    .filter(([k, v]) => /^body\d+(?:c\d+)?$/.test(k) && typeof v === "string")
    .map(([, v]) => v);
  const body = bodyParts.join(" ");

  /* Fixed column vocabulary; anything else a progression table carries is a
   * named LADDER (AC bonus, backstab dice, the assassin/bard skill columns). */
  const FIXED_COLS = new Set(["xp", "title", "hd", "band", "attackBand", "paralysis", "death", "blast", "implements", "spells", "attackThrow", "s1", "s2", "s3", "s4", "s5", "s6"]);

  const levels = [];
  const ladderMap = new Map(); // colKey → rungs
  const slotRowsBy = {}; // s: single tradition; a/d: a two-tradition class's pair
  for (const row of f.progression?.rows ?? []) {
    const level = intFrom(row.label);
    if (level == null) continue;
    levels.push({
      level,
      xp: intFrom(row.cells.xp),
      title: capFirst(row.cells.title),
      hd: String(row.cells.hd ?? "").replace(/\*/g, "").trim(),
    });
    // Slot columns: s1..s6 (single tradition) or a1..a6 / d1..d6 (a
    // two-tradition class's arcane and divine groups). Anything else non-fixed is a
    // named ladder.
    const perPrefix = { s: {}, a: {}, d: {} };
    const any = { s: false, a: false, d: false };
    for (const [key, cell] of Object.entries(row.cells)) {
      const slotMatch = /^([sad])([1-6])$/.exec(key);
      if (slotMatch) {
        const n = intFrom(cell);
        if (n != null) {
          perPrefix[slotMatch[1]][`s${slotMatch[2]}`] = n;
          any[slotMatch[1]] = true;
        }
        continue;
      }
      if (FIXED_COLS.has(key)) continue;
      const rungs = ladderMap.get(key) ?? [];
      rungs.push({ atLevel: level, value: intFrom(cell), text: String(cell).trim() });
      ladderMap.set(key, rungs);
    }
    for (const p of ["s", "a", "d"]) {
      if (any[p]) (slotRowsBy[p] ??= []).push({ atLevel: level, ...perPrefix[p] });
    }
  }
  // A standalone skill-progression table (the nightblade's) contributes its
  // columns as ladders keyed by column.
  for (const row of f.skillTable?.rows ?? []) {
    const level = intFrom(row.label);
    if (level == null) continue;
    for (const [key, cell] of Object.entries(row.cells)) {
      if (key === "band" || FIXED_COLS.has(key)) continue;
      const rungs = ladderMap.get(key) ?? [];
      rungs.push({ atLevel: level, value: intFrom(cell), text: String(cell).trim() });
      ladderMap.set(key, rungs);
    }
  }
  // A class with no progression grid to read states its hit dice and damage
  // bonus in sentences; the rows and the ladder come from those instead.
  if (!levels.length && entry.proseLevels?.hitDice) {
    levels.push(...proseHitDiceLevels(body, entry.proseLevels.hitDice, f.maximumLevel));
  }
  levels.sort((a, b) => a.level - b.level);
  // A class whose experience the book prints only in a picture is priced by
  // the procedure it was built with; a level the grid did read keeps its own.
  const raceText = Object.entries(f)
    .filter(([k, v]) => /^race\d+c\d+$/.test(k) && typeof v === "string")
    .map(([, v]) => v)
    .join(" ");
  const priced = levels.some((r) => r.xp == null)
    ? buildXp(entry.build, raceText, builderTables, Math.max(...levels.map((r) => r.level)), entry.meta?.chassis?.saves ?? "")
    : null;
  if (priced) for (const row of levels) row.xp ??= priced.xp[row.level - 1] ?? null;
  const ladders = [...ladderMap.entries()].map(([key, values]) => ({
    key,
    label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
    values,
  }));
  if (!ladders.some((l) => /damagebonus$/i.test(l.key))) {
    const damage = proseDamageLadder(body, entry.damageBonus);
    if (damage) ladders.push(damage);
  }

  // A grid keyed on a NAME rather than on a level (the crusader's rebuking
  // table) — see `gridLadders`.
  ladders.push(...gridLadders(f.rebuking, "rebuke"));

  // One combined attack-and-saves table, or the split pair the priestess and
  // witch print (crusader saves beside mage attacks) — read whichever exists.
  // A table may also print the attack sub-table with its OWN level column
  // (`attackBand`, the BTA gnostic classes): the attack rows band by it, and
  // where it is dashed out the save band still stands on its own.
  const saves = [];
  const attack = [];
  for (const tableKey of ["attackSaves", "savesTable", "attackTable"]) {
    for (const row of f[tableKey]?.rows ?? []) {
      const band = row.cells.band ?? { min: intFrom(row.label), max: intFrom(row.label) };
      if (band?.min == null) continue;
      const minLevel = band.min;
      const maxLevel = band.max ?? band.min;
      if (row.cells.paralysis != null || row.cells.death != null) {
        saves.push({
          minLevel, maxLevel,
          paralysis: row.cells.paralysis ?? null,
          death: row.cells.death ?? null,
          blast: row.cells.blast ?? null,
          implements: row.cells.implements ?? null,
          spells: row.cells.spells ?? null,
        });
      }
      const aband = "attackBand" in row.cells ? row.cells.attackBand : band;
      if (row.cells.attackThrow != null && aband?.min != null) {
        attack.push({ minLevel: aband.min, maxLevel: aband.max ?? aband.min, throw: row.cells.attackThrow });
      }
    }
  }

  // Casting traditions: the chef classifies (key/kind/repertoire — structure);
  // every slot count comes from the progression grid's numbered columns. With
  // one tradition the plain columns serve it; a two-tradition pair each take
  // their own prefixed group.
  const casting = (entry.casting ?? []).map((t) => {
    const key = t.key ?? "arcane";
    const slots =
      (key === "arcane" && slotRowsBy.a) || (key === "divine" && slotRowsBy.d) || slotRowsBy.s || [];
    return {
      key,
      label: t.label ?? "",
      kind: t.kind ?? "vancian",
      repertoire: t.repertoire ?? "",
      spellList: repertoireRefs(printedRepertoire, spellTitles, { key, label: t.label ?? "" }, (entry.casting ?? []).length === 1, entry.name),
      slots,
      pool: [],
      casterLevel: t.casterLevel ?? "",
    };
  });

  // RR joins key attributes with "and"; BTA's plural form lists them with
  // commas ("Prime Requisites: INT, WIS") — split on either.
  const keyAttributes = stripBullet(f.keyAttribute)
    .split(/\s*,\s*|\s+and\s+/i)
    .map((a) => ATTR_KEY[a.trim().toUpperCase()])
    .filter(Boolean);
  const reqText = stripBullet(f.requirements);
  const requirements = [];
  if (!/^none\b/i.test(reqText)) {
    for (const m of reqText.matchAll(/([A-Z]{3})\s*(\d+)/g)) {
      const attr = ATTR_KEY[m[1].toUpperCase()];
      if (attr) requirements.push({ attr, min: parseInt(m[2], 10) });
    }
  }

  // Every printed surface, resolved once and read by BOTH the class list here
  // and the template cells below — one decision, so the two cannot disagree
  // about what a printed name means.
  const surfaces = abilitySurfaceIndex();

  // The printed class list, token-matched against every content cookbook;
  // what fails to match is KEPT, visibly, on unresolvedProfs.
  const classProfs = [];
  const unresolvedProfs = [];
  // BTA's capture can fuse the label ("ProficiencyList:"), so the strip
  // tolerates missing inter-word space.
  const listText = String(f.profList ?? "").replace(/^.*?Proficiency\s*List:\s*/i, "");
  for (const name of splitList(listText)) {
    const bare = name.replace(/\([^)]*\)/g, "");
    const hit = surfaces.byKey.get(slug(bare)) ?? surfaces.byPrintKey.get(printKey(bare));
    if (hit) classProfs.push(hit.ref);
    else unresolvedProfs.push(name);
  }

  // Award grant levels resolve from the reader's own page text; a pattern
  // that finds nothing leaves the award visible with its level unresolved.
  const awards = (entry.awards ?? []).map((a) => {
    let atLevel = a.starting ? 1 : null;
    if (atLevel == null && a.from?.pattern && body) {
      const m = new RegExp(a.from.pattern).exec(body);
      if (m?.[1] != null) atLevel = parseInt(m[1], 10);
    }
    // A chef CHOICE award: a pick among named refs (the warlock's dark path,
    // the witch's tradition, the earthforger's sigil) — the chooser offers
    // exactly the listed options and grants the one taken.
    if (a.choice?.refs?.length) {
      return {
        atLevel: atLevel ?? 0,
        kind: "choice",
        ref: "",
        name: "",
        choice: {
          from: "custom",
          filter: "",
          count: a.choice.count ?? 1,
          refs: a.choice.refs,
          label: a.choice.label ?? "",
        },
        note: atLevel == null ? "level unresolved" : (a.note ?? ""),
      };
    }
    // A pattern that finds nothing parks the award at level 0 — visible and
    // never auto-granted — rather than silently landing at 1st.
    return {
      atLevel: atLevel ?? 0,
      kind: "fixed",
      ref: a.ref,
      name: "",
      note: atLevel == null ? "level unresolved" : (a.note ?? ""),
    };
  });

  // Grid row when the RR grid knows the class; otherwise the schedule parsed
  // from the spread's own Proficiency Progression prose.
  const gainCells = gains ?? proseGainSchedule(body);
  if (gainCells) {
    for (const [key, cell] of Object.entries(gainCells)) {
      const atLevel = parseInt(key.slice(1), 10);
      if (!Number.isInteger(atLevel)) continue;
      const text = String(cell);
      if (/c/i.test(text)) {
        awards.push({
          atLevel, kind: "choice", ref: "", name: "",
          choice: { from: "classInventory", filter: "proficiencies", count: 1, refs: [], label: "Class proficiency" },
          note: "",
        });
      }
      if (/g/i.test(text)) {
        awards.push({
          atLevel, kind: "choice", ref: "", name: "",
          choice: { from: "generalList", filter: "any", count: 1, refs: [], label: "General proficiency" },
          note: "",
        });
      }
    }
    awards.sort((a, b) => a.atLevel - b.atLevel);
  }

  // Languages (RR §I.10, read off the spread). A demi-human spread's Tongues
  // runin is the granted list, whole, with count 0; without the runin the
  // class is human — one open homeland pick beside the common tongue.
  // Bookless (no body), both stay empty.
  // See docs/importer/DECISIONS.md, "2026-08-16 — who speaks which: read off the spread, defaulted off the chapter".
  const tongues = body ? parseTongues(body) : null;
  // Multilingual / Linguistics: picks the reader fills from their own campaign,
  // which ride on top of whichever list the class starts from.
  const bonus = body ? parseBonusLanguages(body) : 0;
  const languages = tongues
    ? { granted: tongues.granted, count: bonus }
    : { granted: body && commonName ? [commonName] : [], count: (body ? 1 : 0) + bonus };
  // The race this class is an expression of. DECLARED in the register where
  // the spread's own runin cannot be trusted to say it — the Spellsword's page
  // interleaves its proficiency list through the sentence — and the class is
  // an elf class whether or not its page parses. The declaration classifies;
  // the LIST still comes from the reader's book, inherited from a sibling of
  // the same race whose page reads cleanly (see `inheritRaceTongues`).
  const raceKey = entry.meta?.race ?? (tongues ? tongues.race.toLowerCase() : null);

  let cleaves = {};
  if (entry.cleaves?.pattern && body) {
    const m = new RegExp(entry.cleaves.pattern, "i").exec(body);
    // Extraction joins can drop inter-run spaces, so the phrase folds first.
    const phrase = (m?.[1] ?? "").toLowerCase().replace(/\s+/g, "");
    if (phrase.startsWith("classlevel") || phrase === "level") cleaves = { kind: "perLevel", base: 1, per: 1 };
    else if (phrase.includes("twoclasslevels")) cleaves = { kind: "perLevel", base: 0.5, per: 0.5, round: "down" };
  }

  // What the class is trained to fight with, carried as an effect the actor
  // reads through the class item it holds. The run-in label is declared per
  // class because the spreads do not all print it under the same one.
  const training = entry.training?.runin ? readTraining(bodyParts, entry.training.runin) : null;

  // The eight printed starting templates: proficiency cells tokenized against
  // every known ability name, equipment cells split into skinned descriptors.
  const tplMenu = surfaces.menu;
  const eqMenu = equipmentMenu(gear);
  const templates = (f.templates?.rows ?? []).map((row) => {
    const band = row.cells.band ?? {};
    const rawName = capFirst(String(row.cells.template ?? "").replace(/\s+/g, " ").trim());
    const ann = /^(.*?)\s*\(([^)]+)\)$/.exec(rawName);
    // Book-wide equivalences first, this class's own wording over the top: an
    // exception authored for one spread must be able to override the general
    // one, and most of them recur across every class in the book.
    const eq = parseEquipment(row.cells.equipment, eqMenu, {
      ...(data.registers?.tables?.equipmentPhrase ?? {}),
      ...(entry.equipAliases ?? {}),
    });
    const spells = liftBookSpells(eq.items, { known: spellTitles?.has ?? null });
    // A creature the cell names belongs to the ability whose companion slot it
    // fills, not to the character's pack.
    const abilities = tokenizeProfs(row.cells.proficiencies, tplMenu);
    liftCompanions(eq.items, abilities, data.registers?.tables?.companionPhrase);
    return {
      rollMin: band.min ?? 3,
      rollMax: band.max ?? band.min ?? 3,
      name: ann ? ann[1] : rawName,
      annotation: ann ? ann[2] : "",
      caste: String(row.cells.caste ?? "").trim(),
      abilities,
      items: eq.items,
      spells,
      gp: eq.gp,
      sp: eq.sp,
      enc: eq.enc,
      alt: "",
    };
  });

  return {
    name: printedNameOf(node, entry.name), // the class heading's read name, else the entry's label
    type: CLASS_ITEM_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    system: {
      key: entry.meta?.key ?? slug(entry.name),
      source: { book: entry.book ?? "rr", cite, ref: id },
      description: entryText(node, id, cite),
      requirements,
      keyAttributes,
      ...(typeof f.maximumLevel === "number" ? { maximumLevel: f.maximumLevel } : {}),
      hitDie: String(f.hitDie ?? "").trim(),
      levels,
      ladders,
      saveChassis: entry.meta?.chassis?.saves ?? "",
      attackChassis: entry.meta?.chassis?.attack ?? "",
      factored: !!entry.meta?.factored,
      core: !!entry.meta?.core,
      // How much Intellect bonus this class's printed TEMPLATES already spend.
      // The studious spellcasters' packages are built assuming one, so chargen
      // must not offer it a second time — and must withhold what the character
      // cannot hold when their Intellect is lower. A structural fact about how
      // the spread is arranged, like `factored` beside it.
      templatesAssumeIntBonus: Number(entry.meta?.templatesAssumeIntBonus) || 0,
      saves,
      attack,
      cleaves,
      casting,
      inventory: {
        classProfs,
        powers: awards.filter((a) => a.ref.startsWith("def.power.")).map((a) => a.ref),
        skills: (entry.skills ?? []).map((s) => ({ ref: s.ref, ladderKey: s.ladderKey ?? "" })),
      },
      unresolvedProfs,
      awards,
      languages,
      templates,
      // The class's mutually exclusive options: its printed variant table where
      // the spread prints one, and its starting templates, which are a group of
      // the same kind rather than a parallel mechanism.
      paths: buildPaths(f.training?.rows, entry.class?.tables?.training?.labelHeader ?? "", templates.length > 0),
    },
    ...(training ? { effects: [trainingEffect(entry, training)] } : {}),
    flags: {
      [MODULE_ID]: {
        cookbook: { id, cite, ...bookStamp(entry.book) },
        // Which race these tongues belong to — declared, or the runin's own
        // subject. Kept so a sibling can lend its list to a class whose page
        // does not parse, and so the race document is brought in step.
        ...(raceKey ? { tongues: { race: raceKey, parsed: !!tongues } } : {}),
        // What priced the experience column, for the sheet's provenance.
        ...(priced ? { xpBuild: buildProvenance(entry.build, priced) } : {}),
        minted: true,
      },
    },
  };
}

/**
 * The class's training as one embedded, transferring Active Effect carrying
 * weapon, armour and style proficiency together; `training-logic.mjs` builds
 * the changes, so what the importer writes is what the class sheet edits.
 */
function trainingEffect(entry, training) {
  return {
    name: game.i18n?.format
      ? game.i18n.format(`${LANG_PREFIX}.ui.classTraining`, { class: entry.name })
      : `${entry.name} Training`,
    img: DEFAULT_IMG.TRAINING,
    changes: trainingChanges(training),
    transfer: true,
    disabled: false,
    flags: { [MODULE_ID]: { minted: true } },
  };
}

/** Execute the Proficiencies-Gained grid once per run (null without a book). */
async function executeProfGains() {
  const id = "def.classmeta.profGains";
  const found = cookbookEntry(id);
  if (!found) return null;
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return null;
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  return node?.ok ? node : null;
}

/**
 * Execute the per-class Spell Repertoire pages once per run (null without a
 * book). A band the page did not yield is warned and the rest still bind:
 * one class's list is not the price of another's.
 */
async function executeRepertoires() {
  const id = "def.classmeta.spellRepertoires";
  const found = cookbookEntry(id);
  if (!found) return null;
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return null;
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node?.fields || !Object.keys(node.fields).length) return null;
  if (!node.ok) console.warn(`${MODULE_ID} | ${id}: ${node.misses?.length ?? 0} repertoire band(s) did not read; the rest bind.`);
  return node;
}

/** The register's spell titles as a resolver, so a class binds its printed names to entry ids. */
const spellTitleIndex = () => titleIndex([...spellEntries()].map(([sid, e]) => [sid, e.name]));

/**
 * One class's printed repertoire off the executed repertoire pages:
 * `[{tradition, level, names}]`, one row per list the pages print for it.
 * A grid `<class>.<tradition>L<levels>` holds the printed numbers as row
 * labels and a name column `L<level>` per level the table prints abreast;
 * the executor nests the class's grids under its key. Empty for a class the
 * pages do not print, or with no pages read.
 */
export function classRepertoireFor(node, className) {
  const cls = spellNameKey(className);
  if (!cls) return [];
  const out = [];
  const read = (key, grid) => {
    const m = /^([a-z]+)L(\d+)$/i.exec(key);
    if (!m) return;
    const byLevel = new Map();
    for (const row of grid?.rows ?? []) {
      for (const [ck, v] of Object.entries(row.cells ?? {})) {
        const lm = /^L(\d)$/i.exec(ck);
        const name = String(v ?? "").trim();
        if (!lm || !name) continue;
        const level = parseInt(lm[1], 10);
        (byLevel.get(level) ?? byLevel.set(level, []).get(level)).push(name);
      }
    }
    for (const [level, names] of byLevel) out.push({ tradition: m[1].toLowerCase(), level, names });
  };
  for (const [field, value] of Object.entries(node?.fields ?? {})) {
    const dot = field.indexOf(".");
    if (dot < 0) {
      if (spellNameKey(field) !== cls) continue;
      for (const [key, grid] of Object.entries(value ?? {})) read(key, grid);
    } else if (spellNameKey(field.slice(0, dot)) === cls) {
      read(field.slice(dot + 1), value);
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/**
 * The spell-list references one casting row takes from a class's printed
 * repertoire: the entry ids `titles` resolves each printed name to, for the
 * lists whose tradition the row is — every list when the class casts one
 * tradition (`only`). A name no title answers is warned and left out; a row
 * that resolves nothing keeps an empty list, and the picker offers the
 * tradition whole.
 */
function repertoireRefs(repertoire, titles, row, only, who) {
  if (!repertoire?.length || !titles) return [];
  const keys = new Set([spellNameKey(row.key), spellNameKey(row.label)].filter(Boolean));
  const refs = [];
  const seen = new Set();
  const missing = [];
  for (const list of repertoire) {
    if (!only && !keys.has(spellNameKey(list.tradition))) continue;
    for (const name of list.names) {
      const sid = titles.resolve(name);
      if (!sid) {
        missing.push(name);
        continue;
      }
      if (seen.has(sid)) continue;
      seen.add(sid);
      refs.push(sid);
    }
  }
  if (missing.length) console.warn(`${MODULE_ID} | ${who}: ${missing.length} repertoire name(s) match no spell entry: ${missing.join("; ")}`);
  return refs;
}

/**
 * What the common tongue is called in this setting, read once per run from
 * the chargen chapter's Languages section (`def.classmeta.startingTongues`).
 * Null without the book, or if the sentence is not where the anchor says.
 * See docs/importer/DECISIONS.md, "2026-08-16 — who speaks which: read off the spread, defaulted off the chapter".
 */
async function executeCommonTongue() {
  const id = "def.classmeta.startingTongues";
  const found = cookbookEntry(id);
  if (!found) return null;
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return null;
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node?.ok) return null;
  const body = Object.entries(node.fields ?? {})
    .filter(([k, v]) => /^body\d+(?:c\d+)?$/.test(k) && typeof v === "string")
    .map(([, v]) => v)
    .join(" ");
  const m = /often\s*called\s*[“”"']?\s*([A-Z][A-Za-z]*(?:\s*[A-Z][A-Za-z]*)?)/.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * Read the training paragraph from the COLUMN it is printed in, not from the
 * page's reading order: each page-column field (`body61c0`, `body61c1`) is
 * tried on its own first, and the full joined page only afterwards.
 */
export function readTraining(bodyParts, runin) {
  for (const part of bodyParts ?? []) {
    const t = part ? parseCombatTraining(part, runin) : null;
    if (t) return t;
  }
  const joined = (bodyParts ?? []).join(" ");
  return joined ? parseCombatTraining(joined, runin) : null;
}

/**
 * What a class is TRAINED to fight with, read off its own spread's run-in
 * paragraph (weapons, then armour, then fighting styles, in that fixed
 * order; the run-in label is declared per class in the register).
 *
 * Weapons: an unqualified "all" clause is unrestricted, a size clause is a set of size
 * grants, an "all" clause over the missile group is the missile grant (RR p. 15; JJ p. 290), otherwise a named
 * list — a parenthesized enumeration after a group name overrides the group.
 * An "except" clause returns no weapon grant at all. Armour: the heaviest
 * rung named (a denial is the bottom rung). Styles: the positive clause
 * only, with the exclusion clause cut before reading; the two mandatory
 * styles are not emitted, since the consumer already holds them.
 * See docs/importer/DECISIONS.md, "A class's training paragraph is read by three grammars, one per domain".
 *
 * @param {string} body the spread's raw body text, in reading order
 * @param {string} runin the run-in label this class prints the paragraph under
 * @returns {{weapons: string[], armour: string, styles: string[]}|null}
 */
export function parseCombatTraining(body, runin) {
  const text = String(body ?? "").replace(/\s+/g, " ");
  const label = String(runin ?? "").trim();
  if (!text || !label) return null;
  // Extraction joins lines by concatenation, so a space the page shows is
  // routinely absent from the text — "fighting styleproficiency",
  // "armorproficiencywithlightandverylight". EVERY seam below is therefore
  // optional rather than required; a parser written against the spacing the
  // page displays reads almost nothing off the file it is actually given.
  const loose = (s) => s.replace(/ /g, "\\s*");
  const at = text.search(new RegExp(loose(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "i"));
  if (at < 0) return null;
  const after = text.slice(at).replace(new RegExp(`^${loose(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}`, "i"), "");
  // To the next run-in label — a capitalised phrase closing on a colon, which
  // the same joins can leave welded to the previous sentence ("…styles).Combat
  // Progression:"), so no separating space is required of it either.
  const para = after.slice(0, /(?:^|[.)\s])[A-Z][a-z]+(?:\s*[A-Za-z]+){0,3}:/.exec(after)?.index ?? 900);

  // None of these paragraphs prints a number, so a digit means a level
  // table's cells are folded through the sentence and no part of it can be
  // trusted.
  if (/\d/.test(para)) return null;

  // Segment by the three phrases themselves: the shortest spreads state all
  // three in ONE sentence, so sentence boundaries do not divide them.
  const marks = [
    ["weapons", /weapon\s*proficiency/i],
    ["armour", /(?:armor|armour)\s*proficiency|proficiency\s*with\s*(?:armor|armour)/i],
    ["styles", /fighting\s*style\s*proficiency/i],
  ]
    .map(([key, re]) => ({ key, at: re.exec(para)?.index ?? -1 }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (!marks.length) return parseTrainingProse(para);
  const seg = {};
  marks.forEach((m, i) => {
    // A segment ends at its own sentence, not at the next phrase: the shortest
    // spreads run all three through one sentence (so the next phrase arrives
    // first), and the longest give each its own (so the sentence does). Taking
    // whichever comes first is what stops "…and staffs." from reading on into
    // "They have no armour…" and turning the next clause into a weapon name.
    const upto = i + 1 < marks.length ? marks[i + 1].at : para.length;
    const slice = para.slice(m.at, upto);
    // A sentence ends at a full stop that STARTS another one. The styles are
    // spelled out in an "(i.e. …)" aside on the shortest spreads, and treating
    // its stop as the end of the sentence cuts the list off before it begins.
    // The space after the stop is optional for the same reason as every other.
    seg[m.key] = slice.slice(0, /\.\s*[A-Z]|\.$/.exec(slice)?.index ?? slice.length);
  });

  /* --- weapons ---------------------------------------------------------- */
  const weapons = [];
  const wSeg = seg.weapons ?? "";
  if (/\bexcept\b/i.test(wSeg)) {
    // Stated as a subtraction — see the header. Nothing is granted.
  } else if (/all\s*weapons/i.test(wSeg)) {
    // No word boundary in front: a table footnote can land welded to the
    // phrase ("proficiency with*no adjustment fromall weapons") and the
    // sentence still says what it says.
    weapons.push("all");
  } else {
    // The group phrasings are consumed as they are recognised, so whatever
    // remains is a plain list of names. Leaving them in would read the sizes
    // a second time, as weapons called "tiny" and "small".
    let rest = wSeg;
    const eat = (re, take) => {
      const m = re.exec(rest);
      if (!m) return;
      take(m);
      rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
    };
    eat(/all\s*missile\s*weapons/i, () => weapons.push("missile:all"));
    eat(/((?:tiny|small|medium|large)(?:\s*,?\s*(?:and|or)?\s*(?:tiny|small|medium|large))*)\s*melee\s*weapons/i, (m) => {
      for (const s of m[1].match(/tiny|small|medium|large/gi) ?? []) weapons.push(`melee:${s.toLowerCase()}`);
    });
    // A named group is trusted only through its own parenthesis; where there
    // is no parenthesis the sentence is already a plain list of weapons.
    const parens = [...rest.matchAll(/\(\s*including([^)]*)\)/gi)].map((m) => m[1]);
    const lists = parens.length ? parens : [rest.replace(/^[^]*?proficiency\s*with\s*/i, "")];
    for (const list of lists) {
      for (const raw of list.split(/,| and | or /i)) {
        const name = singularWeapon(raw);
        if (name) weapons.push(name);
      }
    }
  }

  /* --- armour ----------------------------------------------------------- */
  let armour = "";
  const aSeg = seg.armour ?? "";
  // The sentence names every rung it includes, so the answer is the HEAVIEST
  // named — a sentence naming both the light and very light rungs (RR p. 26;
  // JJ p. 290) is a light class, not a very light one.
  // "very light" is removed before looking for "light" so the qualifier cannot
  // be read as the bare rung it contains.
  const aBare = aSeg.replace(/very\s*light/gi, " ");
  const RUNGS = [
    [/heavy/i, aBare, "heavy"],
    [/medium/i, aBare, "medium"],
    [/light/i, aBare, "light"],
    [/very\s*light/i, aSeg, "veryLight"],
  ];
  if (/\bno\s*(?:armor|armour)\s*proficiency|\bno\s*proficiency\s*with\s*(?:armor|armour)/i.test(para)) armour = "unarmored";
  else if (/all\s*(?:armor|armour)/i.test(aSeg)) armour = "heavy";
  else armour = RUNGS.find(([re, src]) => re.test(src))?.[2] ?? "";

  /* --- styles ----------------------------------------------------------- */
  const sSeg = (seg.styles ?? "").split(/\bbut\s*not/i)[0];
  const styles = [];
  if (/all\s*fighting\s*styles/i.test(sSeg)) styles.push("dual", "twohanded", "weaponshield");
  else {
    if (/dual\s*weapon/i.test(sSeg)) styles.push("dual");
    if (/two\s*-?\s*handed\s*weapon/i.test(sSeg)) styles.push("twohanded");
    if (/weapon\s*and\s*shield/i.test(sSeg)) styles.push("weaponshield");
  }

  if (!weapons.length && !armour && !styles.length) return null;
  return { weapons: [...new Set(weapons)], armour, styles: [...new Set(styles)] };
}

/**
 * The second grammar: a spread that states its training in sentences
 * (a fight-with or wield lead-in verb; RR p. 15, JJ pp. 316, 329, MM p. 95) rather than in the RR formula the
 * segmenter above keys on.
 *
 * Both books' readers converge on the one grant vocabulary the consumer
 * already publishes (`classifyGrantToken`): `all`, `missile:all`,
 * `melee:<size>`, a weapon-category, or a weapon name. Exclusions are
 * dropped, never inverted — a denied clause grants nothing rather than the
 * thing denied, the same rule the formula reader follows.
 * See docs/importer/DECISIONS.md, "A class's training paragraph is read by three grammars, one per domain".
 */
export function parseTrainingProse(para) {
  const text = String(para ?? "");
  if (!text || /\d/.test(text)) return null;

  /** A clause's own sentence, cut before whatever it goes on to forbid. */
  const positive = (clause) => String(clause ?? "").split(/\bbut\s+(?:they\s+)?(?:cannot|can\s*not|typically)\b/i)[0];

  /* --- weapons: the fight-with lead-in ------------------------------------ */
  const weapons = [];
  // "can only fight with" is the same sentence; and extraction welds, so the
  // seams are `\s*` and the word boundary before a welded noun ("weararmor")
  // cannot be required of any of them.
  const wRaw = /can\s*(?:only\s*)?fight\s*with([^.]*)/i.exec(text)?.[1] ?? "";
  const wSeg = positive(wRaw);
  if (wSeg) {
    // A "broad selection … including X, Y" names the group and then enumerates
    // it; the ENUMERATION is what is read, exactly as the formula reader does.
    const list = /\bincluding\b([^.]*)/i.exec(wSeg)?.[1] ?? wSeg;
    for (const raw of list.split(/,| and | or /i)) {
      const part = raw.trim();
      if (!part || /\bexcept\b/i.test(part)) continue;
      // An "all <group>" part — an unqualified group (RR p. 15, JJ p. 290).
      if (/all\s*missile\s*weapons/i.test(part)) { weapons.push("missile:all"); continue; }
      const group = TRAINING_GROUPS.find(([re]) => re.test(part));
      if (group) { weapons.push(group[1]); continue; }
      const name = singularWeapon(part.replace(/^all\s+/i, ""));
      if (name) weapons.push(name);
    }
  }

  /* --- armour ----------------------------------------------------------- */
  // Written as a ceiling ("or lighter" or "heavier than" a named rung; JJ
  // p. 292) or as a grant of everything, or as a refusal of the whole idea.
  let armour = "";
  const aSeg = /((?:can|cannot|can\s*not)[^.]*(?:armor|armour)[^.]*)/i.exec(text)?.[1] ?? "";
  const eschew = /eschew[^.]*(?:armor|armour)|(?:armor|armour)[^.]*\bentirely\b/i.test(text);
  if (eschew) armour = "unarmored";
  else if (/any\s*(?:type\s*of\s*)?(?:armor|armour)|all\s*(?:armor|armour)/i.test(aSeg)) armour = "heavy";
  else if (aSeg) {
    const bare = aSeg.replace(/very\s*light/gi, " ");
    armour =
      (/very\s*light/i.test(aSeg) && !/\b(leather|light|medium|heavy)\b/i.test(bare) ? "veryLight" : "") ||
      (/\bheavy\b/i.test(bare) && !/heavier\s*than/i.test(bare) ? "heavy" : "") ||
      (/\bmedium\b/i.test(bare) ? "medium" : "") ||
      // "leather" IS the light rung, and the ceiling sentence names it rather
      // than the rung (JJ p. 292).
      (/\bleather\b|\blight\b/i.test(bare) ? "light" : "");
  }

  /* --- styles: "can wield …" -------------------------------------------- */
  const sSeg = positive(/can\s*wield([^.]*)/i.exec(text)?.[1] ?? "");
  const styles = [];
  if (/two\s*-?\s*hand/i.test(sSeg)) styles.push("twohanded");
  if (/in\s*each\s*hand|dual\s*wield|dual\s*weapon/i.test(sSeg)) styles.push("dual");
  if (/(?:weapon\s*and\s*shield|and\s*shield|shield\s*and)/i.test(sSeg)) styles.push("weaponshield");

  if (!weapons.length && !armour && !styles.length) return null;
  return { weapons: [...new Set(weapons)], armour, styles: [...new Set(styles)] };
}

/** Plural group names a sentence uses, and the category token each names. The
 *  groups are the consumer's vocabulary (`classifyGrantToken`), not this book's. */
const TRAINING_GROUPS = [
  [/\baxes\b/i, "axe"],
  [/\b(?:cross)?bows\b/i, "bowCrossbow"],
  [/\b(?:hammers|maces|flails)\b/i, "flailHammerMace"],
  [/\b(?:swords|daggers)\b/i, "swordDagger"],
  [/\b(?:spears|pole\s*arms|polearms)\b/i, "spearPolearm"],
];

/**
 * One row of a class's combat-proficiencies TABLE, as a path option's
 * training. A spread whose training differs per option prints a grid rather
 * than a sentence, so each row becomes one option of a path group. The
 * armour column names every rung it permits; the answer is the heaviest, the
 * same rule the prose reader follows. Per-option data stays on the option
 * even where every row agrees.
 * See docs/importer/DECISIONS.md, "A class's variants are PATHS, and the grid that prints them is read by geometry".
 */
export function readTrainingCells(cells = {}) {
  const weapons = [];
  for (const raw of String(cells.weapons ?? "").split(/,| and | or /i)) {
    const name = singularWeapon(raw);
    if (name) weapons.push(name);
  }
  const aSeg = String(cells.armour ?? "");
  const bare = aSeg.replace(/very\s*light/gi, " ");
  const armour =
    (/all\s*(?:armor|armour)/i.test(aSeg) ? "heavy" : "") ||
    (/\bheavy\b/i.test(bare) ? "heavy" : "") ||
    (/\bmedium\b/i.test(bare) ? "medium" : "") ||
    (/\blight\b/i.test(bare) ? "light" : "") ||
    (/very\s*light/i.test(aSeg) ? "veryLight" : "") ||
    (/\bnone\b|\bno\b/i.test(aSeg) ? "unarmored" : "");
  const sSeg = String(cells.styles ?? "");
  const styles = [];
  if (/dual\s*weapon/i.test(sSeg)) styles.push("dual");
  if (/two\s*-?\s*handed\s*weapon/i.test(sSeg)) styles.push("twohanded");
  if (/weapon\s*and\s*shield/i.test(sSeg)) styles.push("weaponshield");
  return { weapons: [...new Set(weapons)], armour, styles: [...new Set(styles)] };
}

/**
 * The PATH GROUPS a class offers: its printed variant table where it has one,
 * and its starting templates, which are a group like any other.
 *
 * The class model owns the shape (`system.paths`, DECISIONS 2026-08-22); this side
 * fills it from the reader's own page. A templates group carries NO options —
 * its `source` points at `system.templates`, which stays exactly where it is.
 */
export function buildPaths(trainingRows, labelHeader, hasTemplates) {
  const paths = [];
  const rows = (trainingRows ?? []).filter((r) => {
    // The grid's own header line arrives as a row; it names the columns rather
    // than a variant, and every cell it holds is a column title.
    const key = slug(r.label);
    return key && key !== slug(labelHeader || "") && !/proficiencies/i.test(String(r.cells?.weapons ?? "").slice(0, 24));
  });
  if (rows.length) {
    paths.push({
      key: slug(labelHeader) || "variant",
      label: labelHeader || "Variant",
      source: "",
      options: rows.map((r) => ({
        key: r.key || slug(r.label),
        label: r.label,
        note: "",
        training: readTrainingCells(r.cells),
      })),
    });
  }
  if (hasTemplates) {
    paths.push({ key: "template", label: "Starting Template", source: "templates", note: "", options: [] });
  }
  return paths;
}

/**
 * One weapon name from a list item: the article and any aside dropped, the
 * plural the sentence writes folded back to the singular the grant vocabulary
 * matches on. Returns "" for a fragment that is not a name.
 */
function singularWeapon(raw) {
  let s = String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:any|all|the|a|with|and|or|of|their|its)\b/gi, " ")
    .replace(/[^A-Za-z\s-]/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // The conjunction can arrive welded to the name it precedes ("andspears"),
  // in which case the word-boundary strip above cannot see it.
  s = s.replace(/^(?:and|or)(?=[a-z]{3})/, "").trim();
  if (!s || s.length < 3 || /\b(?:weapon|weapons|armor|armour|style|styles|proficiency|melee|missile)\b/.test(s)) return "";
  // "knives" is the one plural in the printed lists that does not simply
  // shed an s; "cestus" is the one SINGULAR that looks like it should.
  if (/ves$/.test(s)) s = s.replace(/ves$/, "fe");
  else if (/s$/.test(s) && !/(?:ss|us)$/.test(s)) s = s.replace(/s$/, "");
  return s;
}

/**
 * The tongues a class's spread prints, parsed from its Racial Traits runin
 * (`<Race> Tongues:`), sometimes in two clauses ("can speak … and can also
 * speak …") — both are read. List items keep the book's own capitalization,
 * drop the article and the trailing "tongues"/"languages"; anything not
 * shaped like a proper name is discarded rather than granted.
 *
 * A spread with no Tongues runin (every human class) returns null, which
 * routes the class to the human default.
 *
 * @param {string} body the spread's raw body text, in reading order
 * @returns {{race: string, granted: string[]}|null}
 */
export function parseTongues(body) {
  const text = String(body ?? "");
  // Every \s is \s* here, not \s+: raw body extraction drops inter-run spaces
  // (the cleave pattern folds them for the same reason), so the runin arrives
  // as "ElfTongues:" as often as "Elf Tongues:" and a required space misses
  // the trait entirely.
  // One word: the label's subject is the race ("Dwarf", "Elf"),
  // and reaching further back swallows the section heading when the space
  // between them is one of the dropped ones.
  const runin = /([A-Z][a-z]+)\s*Tongues\s*:/.exec(text);
  if (!runin) return null;
  // The runin's own span: up to the next runin label or a bounded window —
  // the speak-clause scan below only reads inside it.
  const rest = text.slice(runin.index + runin[0].length);
  const next = /\s[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*:/.exec(rest);
  const window = rest.slice(0, Math.min(next?.index ?? 600, 600));

  const granted = [];
  // The capture is capped at 80 characters; a clause that cannot reach its
  // terminator inside the cap is interleaved with a neighbouring column's
  // text and is dropped whole.
  // See docs/importer/DECISIONS.md, "2026-08-16 — who speaks which: read off the spread, defaulted off the chapter".
  for (const clause of window.matchAll(/can\s*(?:also\s*)?speak\s*([^.]{0,80}?)(?=\s*(?:tongues|languages)\b|\.|$)/g)) {
    for (const piece of clause[1].replace(/^the\s*/i, "").split(/,|\band\b/)) {
      // Strip the glued terminator, then re-open a space the extraction
      // dropped inside a name ("AncientElven") — book names carry no
      // internal capitals, so a case boundary is a lost space.
      const name = piece
        .trim()
        .replace(/(tongues|languages)$/i, "")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1 $2");
      // A tongue is a proper name; a lowercase "(as the spell)" clause is not (RR p. 79; JJ pp. 145, 312, 325).
      if (/^[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*$/.test(name) && !granted.includes(name)) granted.push(name);
    }
  }
  return granted.length ? { race: runin[1].trim(), granted } : null;
}

/** Number words a printed grant uses, so a count reads as either. */
const NUMBER_WORD = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
});

/**
 * How many EXTRA languages of the reader's own choosing a spread grants,
 * beyond any it names — a Multilingual or Linguistics class power. These are
 * open picks, never names, so they land in `languages.count`.
 *
 * Takes the largest grant found rather than the sum.
 * See docs/importer/DECISIONS.md, "2026-08-16 — a class is its race's whether or not its page reads".
 *
 * @param {string} body the spread's raw body text
 * @returns {number} extra picks, 0 where the spread grants none
 */
export function parseBonusLanguages(body) {
  const text = String(body ?? "");
  const words = Object.keys(NUMBER_WORD).join("|");
  const value = (tok) => NUMBER_WORD[String(tok).toLowerCase()] ?? (Number(tok) || 0);
  let most = 0;
  for (const re of [
    new RegExp(`(${words}|\\d+)\\s*bonus\\s*languages`, "gi"),
    new RegExp(`additional\\s*(${words}|\\d+)\\s*languages`, "gi"),
  ]) {
    for (const m of text.matchAll(re)) most = Math.max(most, value(m[1]));
  }
  // A spread claiming dozens is a parse that has wandered, not a class power.
  return most <= 10 ? most : 0;
}

/**
 * Lend a race's tongues to a class of that race whose own page did not
 * parse, taken from a sibling of the same race whose page did.
 *
 * Only a class that ended with no named tongues is filled, and only from a
 * sibling that has some; a class the parse already answered is left alone.
 * `borrowers` are the classes this run wrote and `lenders` every held class:
 * a borrow gives a slot back, so it is never repeated over a class a run did
 * not write.
 * See docs/importer/DECISIONS.md, "2026-08-16 — a class is its race's whether or not its page reads".
 */
async function inheritRaceTongues(borrowers, lenders = borrowers) {
  const docs = (borrowers ?? []).filter(Boolean);
  const byRace = new Map();
  for (const d of (lenders ?? []).filter(Boolean)) {
    const t = d.flags?.[MODULE_ID]?.tongues;
    const granted = d.system?.languages?.granted ?? [];
    // Only a class that read its OWN runin may lend; a human-default list
    // would otherwise propagate itself around the race.
    if (t?.race && t.parsed && granted.length && !byRace.has(t.race)) byRace.set(t.race, granted);
  }
  let lent = 0;
  for (const d of docs) {
    const t = d.flags?.[MODULE_ID]?.tongues;
    // Its OWN page answered, so nothing is borrowed. A class that fell to
    // the human default has a declared race and no parse of its own — that
    // is the one this exists for, and its default list is not evidence.
    if (!t?.race || t.parsed) continue;
    const race = t.race;
    const granted = byRace.get(race);
    if (!granted) continue;
    // It reached here on the HUMAN default, which spends one slot on a
    // homeland tongue a demi-human does not get — this is a class whose own
    // page would not parse, not a human. Give that slot back, keeping only
    // what its spread granted on top (a Multilingual power, say).
    const bonus = Math.max(0, (Number(d.system?.languages?.count) || 0) - 1);
    await d.update({ "system.languages": { granted, count: bonus } });
    lent++;
  }
  if (lent) console.log(`${MODULE_ID} | ${lent} class(es) took their tongues from a sibling of the same race`);
  return lent;
}

/** Every imported class the library holds, whichever run wrote it. */
async function heldImportedClasses() {
  return (await importedDocs("Item")).filter((i) => i.type === CLASS_ITEM_TYPE);
}

/**
 * Bring the race documents' tongues in step with what the class spreads
 * read, so a custom class built on a race document owes its character the
 * same tongues the race's own imported classes get. Only a race whose list
 * is still EMPTY is written — a Judge's own edit is never replaced, and a
 * race that has a list is left as it stands. Races and classes arrive in
 * either order, so `syncHeldRaceTongues` reads every held class and a race
 * that landed after its classes is filled by the next run, whatever that run
 * makes.
 */
async function syncRaceTongues(classDocs) {
  const items = await importedDocs("Item");
  const raceOf = (label) => {
    const key = slug(label);
    return items.find(
      (i) => i.type === RACE_TYPE && (slug(i.system?.key) === key || slug(i.name) === key),
    );
  };
  for (const doc of classDocs ?? []) {
    const label = doc?.flags?.[MODULE_ID]?.tongues?.race;
    const granted = doc?.system?.languages?.granted ?? [];
    if (!label || !granted.length) continue;
    const race = raceOf(label);
    if (!race || (race.system?.languages?.granted ?? []).length) continue;
    await race.update({ "system.languages": { granted, count: 0 } });
  }
}

/**
 * Fill every race whose list is empty from the held imported classes that
 * name it. Idempotent, since it writes only an empty list, so a class run
 * calls it whether or not the run made a class.
 */
export async function syncHeldRaceTongues() {
  return syncRaceTongues(await heldImportedClasses());
}

/**
 * GM: import every class the cookbook holds that this world does not.
 *
 * `only`, a Set of cookbook ids, narrows the pass to those entries — how the
 * entry picker rebuilds exactly what it deleted, where a whole pass would also
 * import every class the world never had. The same option narrows the other
 * five entry-driven importers.
 */
export async function importClasses({ only = null } = {}) {
  // The macro that runs this is labelled "(GM)" and is executable by every
  // seat. Without the guard a player with item-creation rights adds a second
  // set of all 31 classes to the world just by pressing it — which is what a
  // player browsing for a class to play does first.
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[CLASS_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | the class item type is not registered in this world.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  const passed = passedOver();
  const gainsNode = await executeProfGains();
  const commonName = await executeCommonTongue();
  const gear = await materializedGearMenu();
  const repertoires = await executeRepertoires();
  const spellTitles = spellTitleIndex();
  for (const [id, entry] of classEntries()) {
    if (only && !only.has(id)) continue;
    if (await importedItem(id)) {
      skipped++;
      continue;
    }
    const doc = await claimImport(id, async () => {
      const { node, reason } = await readForImport(id);
      if (!node) return passed.count(reason);
      const folder = (await ensureItemFolder(id))?.id ?? null;
      const built = bindClass(entry, node, id, {
        gains: classGainsFor(gainsNode, entry.name),
        commonName,
        gear,
        spellTitles,
        printedRepertoire: classRepertoireFor(repertoires, entry.name),
        builderTables: worldBuilderTables(),
      });
      return createDoc(Item, { ...built, folder });
    });
    if (doc) made.push(doc);
  }
  await inheritRaceTongues(made, await heldImportedClasses());
  await syncHeldRaceTongues();
  await materializeClassTemplates(made);
  ui.notifications?.info(
    `${MODULE_ID} | classes: ${made.length} imported, ${skipped} already present${passed.clause}.`,
  );
  return made;
}

/**
 * Materialize template packages for a set of class documents: each printed
 * template row becomes a core `bundle` Item of repairable documents on the
 * class's own shelf, and the class gains a generated 3d6 RollTable linking
 * them. The classes feature owns the shape (`materializeTemplates`) — this
 * side only names the shelves and the folders on them, so a package lands
 * beside the library it was built from, filed `Class Templates / <Class>`.
 * Idempotent; a no-op for a document that carries no template rows.
 */
async function materializeClassTemplates(docs, { create = true } = {}) {
  const totals = { created: 0, relinked: 0, skippedEdited: 0, unresolved: 0 };
  let touched = 0;
  for (const doc of docs ?? []) {
    if (doc?.type !== CLASS_ITEM_TYPE || !(doc.system?.templates?.length > 0)) continue;
    const line = lineOfData(doc);
    const pack = await packFor("Item", line);
    const tablePack = await packFor("RollTable", line);
    // A relink-only pass creates no folders — it has nothing to file.
    const folder = create ? ((await ensureFolderPath("Item", ["Class Templates", doc.name], line))?.id ?? null) : null;
    const tableFolder = create ? ((await ensureFolderPath("RollTable", ["Class Templates"], line))?.id ?? null) : null;
    const report = await materializeTemplates(doc, { folder, tableFolder, pack, tablePack, create });
    for (const key of Object.keys(totals)) totals[key] += report?.[key]?.length ?? 0;
    touched++;
  }
  return touched ? totals : null;
}

/**
 * GM: build (or repair the links of) every class's template packages.
 * Document-driven — works off the class documents already in the world, so a
 * world imported long ago upgrades with NO book connected. Re-running never
 * clobbers a Judge's repair: an edited document is skipped and counted.
 */
export async function importTemplatePackages() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const targets = (await importedDocs("Item")).filter((i) => i.type === CLASS_ITEM_TYPE && (i.system?.templates?.length ?? 0) > 0);
  if (!targets.length) {
    ui.notifications?.info(`${MODULE_ID} | no class documents with template rows — import classes first.`);
    return null;
  }
  const totals = await materializeClassTemplates(targets);
  ui.notifications?.info(
    `${MODULE_ID} | template packages: ${totals.created} created, ${totals.relinked} relinked, ${totals.skippedEdited} skipped (edited).`,
  );
  return totals;
}

/**
 * Re-execute and REWRITE every imported class document's generated surface
 * (name, img, the whole system object, its minted effects) through
 * `refreshImported` under `REPAIR.class`. Class documents are wholly
 * generated in this phase — a hand-tuned document keeps its edits only until
 * Update, and the confirm says so. Two things stay: a description a Judge
 * wrote in, and an effect a Judge took over (the training editor unmints what
 * it writes), which also stops the build's twin of it being added. A level's
 * experience or title the build could not read keeps what a Judge typed.
 *
 * A class whose book is not open on this seat, or whose entry read nothing,
 * is left exactly as it is: this write takes the build's rows whole, and a
 * rebuild with nothing read is the entry's shape without its content.
 *
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.only] cookbook ids to consider; every class when null
 * @param {boolean} [opts.confirm] ask before writing
 * @param {object|null} [opts.repair] a `repairTally` to count into
 * @returns {Promise<number>} how many classes were rewritten
 */
export async function cookbookUpdateClasses({ only = null, confirm = true, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (rewrites items).`);
  const byId = new Map(classEntries());
  const targets = (await importedDocs("Item")).filter((i) => {
    const cid = i.flags?.[MODULE_ID]?.cookbook?.id;
    return i.type === CLASS_ITEM_TYPE && cid && byId.has(cid) && (!only || only.has(cid));
  });
  if (!targets.length) {
    if (!repair) ui.notifications?.info(`${MODULE_ID} | no imported class documents to update.`);
    return 0;
  }
  const readable = targets.filter((i) => readableHere(i.flags[MODULE_ID].cookbook.id));
  const closed = targets.length - readable.length;
  if (repair) repair.refused += closed;
  if (!readable.length) {
    ui.notifications?.info(`${MODULE_ID} | ${closed} imported class document(s) left as they are — their book is not open on this seat.`);
    return 0;
  }
  const ok =
    !confirm ||
    (await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: "Update Classes" },
      content:
        `<p>Rewrite ${readable.length} imported class document(s) from the connected book? Hand edits on them are replaced, except a description you wrote, training you edited, and a level's experience or title you typed where the book's could not be read.</p>` +
        (closed ? `<p>${closed} more come from a book that is not open on this seat and are left as they are.</p>` : ""),
      modal: true,
    }));
  if (!ok) return 0;
  // The follow-up passes below take only what this loop rewrote: lending a
  // race's tongues gives back a slot each time it runs, so a class it passes
  // over must stay out of them.
  const written = [];
  let unread = closed;
  const gainsNode = await executeProfGains();
  const commonName = await executeCommonTongue();
  const gear = await materializedGearMenu();
  const repertoires = await executeRepertoires();
  const spellTitles = spellTitleIndex();
  for (const item of readable) {
    const id = item.flags[MODULE_ID].cookbook.id;
    const entry = byId.get(id);
    const found = cookbookEntry(id);
    const bookId = found ? bookOf(found) : null;
    const node = bookId ? (await readForImport(id)).node : null;
    if (bookId && !node) {
      unread++;
      countRepair(repair, "no-match");
      continue;
    }
    const doc = bindClass(entry, node, id, {
      gains: classGainsFor(gainsNode, entry.name),
      commonName,
      gear,
      spellTitles,
      printedRepertoire: classRepertoireFor(repertoires, entry.name),
      builderTables: worldBuilderTables(),
    });
    const plan = await repairWrite(item, doc, REPAIR.class, repair);
    countRepair(repair, plan);
    if (!plan.refused) written.push(plan.recreated ?? item);
  }
  await inheritRaceTongues(written, await heldImportedClasses());
  await syncHeldRaceTongues();
  // The update above replaced each document's whole `system`, which wipes the
  // rows' cached bundle uuids — this re-derives them from the bundles' own
  // flags and re-strips the arrays it restored, so a package is never handed
  // over twice.
  await materializeClassTemplates(written);
  ui.notifications?.info(
    `${MODULE_ID} | classes updated: ${written.length}${unread ? `; ${unread} left untouched — their book is not open on this seat, or read nothing` : ""}.`,
  );
  return written.length;
}
