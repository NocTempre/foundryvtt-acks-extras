/**
 * Cookbook runtime: the cookbook's loaded data and context, entry listers and predicates, small parsers, the debugging `api`.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID } from "../constants.mjs";
import { BOOKS, bookIsJudges, bookLine, offeredBookFiles, registryBookOf } from "../books.mjs";
import { groupBookOf } from "../import-kinds.mjs";
import { judgeLine } from "../../lib/library.mjs";
import { playerOwned } from "../character-binding.mjs";
import { CLASS_TYPE } from "../../classes/constants.mjs";
import { acksExtras } from "../../namespace.mjs";

/** The prefix every compendium label this module creates starts with. */
export const FOLDER_NAME = "ACKS Cookbook";
/**
 * The shelf name for a series that declares none. The docs site's library page
 * reads it as a string literal (`docs/site/tools/extract-library.mjs`).
 */
export const UNLINED_LINE = "Your Books";
/**
 * The series a cookbook id's imports belong to, or null for the ACKS library.
 * Every write (`packFor`, `ensureFolderPath`) and presence check
 * (`importedActor`, `importedIdsOfType`) derives its destination from this. A
 * Judge's book resolves to its series' Judge line (`judgeLine`), whose packs no
 * player seat can open. This is the line of a book's own rows; a `def.` content
 * row files by `lineOfClaim`.
 */
export function lineOf(bookId) {
  if (!bookId) return null;
  const id = String(bookId);
  return bookIsJudges(id) ? judgeLine(bookLine(id)) : bookLine(id);
}

/**
 * The book a cookbook id belongs to: what the flag says, else the id's own
 * first segment.
 */
export function bookOfCookbookId(id, book = null) {
  if (book) return String(book);
  const parts = String(id ?? "").split(".");
  if (!parts[0]) return null;
  return parts[0];
}

/**
 * Whether a cookbook id is a content row (a class, power, proficiency, spell
 * or piece of equipment): the `def.` namespace. Such an id names no book of its
 * own; the entry's `book` does.
 */
export const isContentId = (id) => String(id ?? "").startsWith("def.");

/**
 * The line one claim files on: a cookbook id with the book its entry names. A
 * book's own rows (`<book>.*`) take the line `lineOf` gives, the Judge's where
 * the book is the Judge's. A content row takes its book's series line and never
 * the Judge's, so a series' classes and powers stand on its open Item shelf; a
 * book with no series files them on the library's own. Every write and folder
 * derives its shelf from this.
 */
export function lineOfClaim(id, book = null) {
  const bookId = bookOfCookbookId(id, book);
  return isContentId(id) ? bookLine(bookId) : lineOf(bookId);
}

/**
 * The `book` half of a content row's stamp, present only when the entry names
 * one.
 */
export const bookStamp = (book) => (book ? { book: String(book) } : {});

/** The line a document being created belongs to, read off the flag it carries. */
export const lineOfData = (data) => {
  const flag = data?.flags?.[MODULE_ID]?.cookbook;
  if (!flag) return null;
  return lineOfClaim(flag.id, flag.book);
};

/**
 * Shipped data, fetched once at ready. Two cookbook shapes:
 *  - `books`   per-book files; the file names its book.
 *  - `content` content-type files (proficiencies, powers, skills), each
 *    spanning every book that prints that content; the entry names its book.
 */
export const data = { registers: null, books: new Map(), content: new Map() };
/** Content-type cookbooks, named by what they extract rather than the source book. */
const CONTENT_FILES = ["proficiencies", "powers", "skills", "equipment"];
/** Injected module state (session docs + prose memory) — set by initCookbook. */
export let ctx = null;
/** Name collisions already reported this session, so a bulk import says each once. */
export const warnedAmbiguous = new Set();

/** Stores the module context the cookbook reads its session documents from. */
export function initCookbook(moduleCtx) {
  ctx = moduleCtx;
}

/** Fetches the compiled cookbook files into the shared data; resolves false when no cookbook shipped. */
export async function loadCookbook() {
  const base = `modules/${MODULE_ID}/cookbook`;
  try {
    data.registers = await foundry.utils.fetchJsonWithTimeout(`${base}/registers.json`);
  } catch {
    console.log(`${MODULE_ID} | no cookbook shipped (registers.json missing) — cookbook features disabled.`);
    return false;
  }
  // The compiler's index names exactly the files it produced, so no book id is
  // probed into a console 404.
  let index = null;
  try {
    index = await foundry.utils.fetchJsonWithTimeout(`${base}/index.json`);
  } catch {
    /* no index: fall back to probing */
  }
  // A book the module does not offer is never fetched, listed or not.
  const bookFiles = offeredBookFiles(index?.books, BOOKS);
  const contentFiles = index?.content ?? CONTENT_FILES;
  for (const bookId of bookFiles) {
    try {
      const cb = await foundry.utils.fetchJsonWithTimeout(`${base}/${bookId}.json`);
      if (cb?.entries) data.books.set(bookId, cb);
    } catch {
      /* book without a cookbook yet */
    }
  }
  for (const name of contentFiles) {
    try {
      const cb = await foundry.utils.fetchJsonWithTimeout(`${base}/${name}.json`);
      if (cb?.entries) data.content.set(name, cb);
    } catch {
      /* this content type isn't compiled yet */
    }
  }
  const n = [...data.books.values()].reduce((s, cb) => s + Object.keys(cb.entries).length, 0);
  const c = [...data.content.values()].reduce((s, cb) => s + Object.keys(cb.entries).length, 0);
  console.log(
    `${MODULE_ID} | cookbook loaded: ${n} entr(ies) across ${data.books.size} book(s)` +
      `${c ? `, ${c} definition(s) across ${data.content.size} content type(s)` : ""}.`,
  );
  return n + c > 0;
}

/**
 * Accessors for consumers outside this module: the compiled `constants` file,
 * the shared registers and the book documents this seat has open.
 */
export const cookbookContentFile = (name) => data.content.get(name) ?? null;
/** The shared registers of the loaded cookbook. */
export const cookbookRegisters = () => data.registers;
/** The book document this seat has open for a book id, or null. */
export const cookbookSessionDoc = (bookId) => ctx?.sessionDocs?.get(bookId)?.doc ?? null;
/** The loaded cookbook file of a book id, or null. */
export const cookbookBookFile = (bookId) => data.books.get(bookId) ?? null;

/** `<id>#<section>` -> { id, section } (section null when absent). */
const splitId = (full) => {
  const [id, section] = String(full ?? "").split("#");
  return { id, section: section || null };
};

/** Resolves a full cookbook id to its book file and entry, synthesizing an entry for a family id. */
export const cookbookEntry = (fullId) => {
  const { id } = splitId(fullId);
  for (const cb of data.books.values()) if (cb.entries[id]) return { cb, entry: cb.entries[id], id };
  for (const cb of data.content.values()) if (cb.entries[id]) return { cb, entry: cb.entries[id], id };
  // A family id resolves to a synthesized entry, so every consumer treats it like any other.
  for (const cb of data.books.values()) {
    const fam = cb.families?.[id];
    if (fam) {
      return {
        cb,
        id,
        entry: { kind: "kind.monsterFamily", name: fam.name, cite: fam.cite, pages: fam.pages, family: fam },
      };
    }
  }
  return null;
};

/**
 * Which book an entry is read from: the file's, else the entry's own.
 */
export const bookOf = (found) => found?.cb?.book?.id ?? found?.entry?.book ?? null;
/**
 * How many shipped entries this book unlocks, counting both cookbook shapes.
 * A book id the registry (`BOOKS`) does not know is named on the console and
 * answers null; a known book nothing reads yet answers 0.
 * @param {string} bookId
 * @returns {number|null}
 */
export const cookbookCount = (bookId) => {
  if (!BOOKS[bookId]) {
    console.warn(`${MODULE_ID} | cookbookCount: unknown book id "${bookId}".`);
    return null;
  }
  let n = Object.keys(data.books.get(bookId)?.entries ?? {}).length;
  for (const cb of data.content.values()) {
    for (const e of Object.values(cb.entries)) if (e.book === bookId) n++;
  }
  return n;
};


/* -------------------------------------------- */
/*  Binding: executor output -> acks Actor      */
/* -------------------------------------------- */

/** The first integer in a value, thousands commas read through, or null. */
export const firstInt = (v) => {
  const m = /(-?[\d,]+)/.exec(String(v ?? ""));
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
};
/** The first dice expression, with an optional modifier, in a value, or "". */
export const diceOf = (v) => /\d+d\d+(?:[+-]\d+)?/.exec(String(v ?? ""))?.[0] ?? "";
/** The string with its first character upper-cased. */
export const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * What a book is called: the folder its imports are filed under and the name
 * any message about it uses. The registry's label, else the name a Judge typed
 * for a registered source, else the id.
 */
export const bookLabel = (bookId) => BOOKS[bookId]?.label ?? bookId;

/** The module's own api, for `SHELF_REFILL` to name a run without importing it. */
export const api = () => acksExtras.importer ?? {};

/** The cookbook id an imported document claims, or "" when it claims none. */
export const claimedId = (doc) => String(doc.getFlag(MODULE_ID, "cookbook")?.id ?? "");

/**
 * Whether an entry can be read back on this seat: false only when the entry
 * names its book and that book is not open here. See
 * docs/importer/DECISIONS.md, "A closed book is refused, not rebuilt."
 */
export const readableHere = (id) => {
  const book = bookOf(cookbookEntry(id)) ?? groupBookOf(id);
  return !book || !!ctx?.sessionDocs?.has(book);
};

/**
 * Whether a claim's book is one the module offers (`BOOKS`); a claim naming no
 * book is. A claim no loaded cookbook holds names its book by its id's first
 * segment when the registry knows it, so a switched-off book reads as not
 * offered. A repair passes over the rest.
 */
export const offeredHere = (id) => {
  const found = cookbookEntry(id);
  const book = bookOf(found) ?? groupBookOf(id) ?? (found ? null : registryBookOf(id));
  return !book || !!BOOKS[book];
};

/**
 * Does this document belong to that entry? An entry can claim per row
 * (`<entry id>.<row key>`), so the match is the id itself or anything filed
 * beneath it.
 */
export const claimsEntry = (doc, id) => {
  const claim = claimedId(doc);
  return claim === id || claim.startsWith(`${id}.`);
};

/**
 * A character a player owns, which neither a rebuild nor Remove Imports
 * deletes: a character handed to a player is that player's.
 */
export const playersCharacter = (doc) =>
  doc?.documentName === "Actor" && doc.type === "character" &&
  playerOwned(doc.ownership, { isPlayer: (uid) => game.users.get(uid)?.isGM === false, owner: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER });

/** The first integer in a value, sign and thousands commas read through, or null. */
export const intFrom = (v) => {
  const m = /-?\d[\d,]*/.exec(String(v ?? ""));
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
};

/* -------------------------------------------- */
/*  Entry kinds                                 */
/* -------------------------------------------- */

/** The entry kinds that bind to an Actor. */
export const ACTOR_KINDS = new Set(["kind.monster", "kind.monsterLegacy", "kind.npc", "kind.pregen", "kind.monsterTemplate", "kind.monsterFamily"]);
/** Whether an actor-import flow may enumerate the entry; an absent kind reads as a monster. */
export const actorKindOf = (e) => !e.kind || ACTOR_KINDS.has(e.kind);

/** An entry that binds to a core character: a pregen, and a person whose row asks for one. */
export const characterEntry = (e) => e?.kind === "kind.pregen" || e?.meta?.actor === "character";

/**
 * Definition kinds that do not bind to an `ability` item. Every ability path
 * walks the content cookbooks generically, so a new non-ability kind joins the
 * ability import unless it is listed here. See
 * docs/importer/DECISIONS.md, "A namespace with no shelf is a failing test,
 * not a folder nobody notices".
 */
export const NON_ABILITY_KINDS = new Set([
  "kind.equipment",
  "kind.class",
  "kind.classMeta",
  "kind.powerAppend",
  "kind.trap",
  "kind.variation",
  "kind.vehicle",
  "kind.merchandise",
  "kind.merchandiseDemand",
  "kind.spell",
  // A conversion constant is a number handed to a converter, never a document.
  "kind.constant",
]);

/** Does this entry bind to an `ability` item? */
export const isAbilityEntry = (entry) => !NON_ABILITY_KINDS.has(entry?.kind);


/** The class Item sub-type — the classes feature's own constant. */
export const CLASS_ITEM_TYPE = CLASS_TYPE;

/** Every kind.class [id, entry] across the content cookbooks. */
export function* classEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.class") yield [defId, e];
    }
  }
}

/** Every kind.vehicle [id, entry] across the content cookbooks. */
export function* vehicleEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.vehicle") yield [defId, e];
    }
  }
}


/** Every [id, entry] of one merchandise kind (`kind.merchandise`, `kind.merchandiseDemand`) across the content cookbooks. */
export function* merchandiseEntries(kind = "kind.merchandise") {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === kind) yield [defId, e];
    }
  }
}


/** Sixths of a stone, the unit the family weighs everything in. */
export const SIXTHS_PER_STONE = 6;

/** Every kind.variation [id, entry] across the content cookbooks. */
export function* variationEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.variation") yield [defId, e];
    }
  }
}

/** Every kind.trap [id, entry] across the content cookbooks. */
export function* trapEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.trap") yield [defId, e];
    }
  }
}

/** Every kind.spell [id, entry] across the content cookbooks. */
export function* spellEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.spell") yield [defId, e];
    }
  }
}

/** Every [id, entry] pair across the content cookbooks that IS an ability. */
export function* abilityEntries() {
  for (const cb of data.content.values()) {
    for (const [id, entry] of Object.entries(cb.entries)) {
      if (isAbilityEntry(entry)) yield [id, entry];
    }
  }
}

/** Every definition id the shipped content-type cookbooks carry as an ability. */
export const cookbookAbilityIds = () => [...abilityEntries()].map(([id]) => id);

/** Can this seat file animals as creatures? False before `game.actors` exists. */
export const canImportAnimals = () => !!game.actors;

/** Does this entry describe a creature rather than a thing? */
export const isAnimalEntry = (entry) => entry?.meta?.group === "animal";

/** All equipment ids in the shipped cookbook (empty when none compiled). */
export const cookbookEquipmentIds = () =>
  [...data.content.values()]
    .flatMap((cb) => Object.entries(cb.entries))
    .filter(([, e]) => e.kind === "kind.equipment")
    .map(([id]) => id);
