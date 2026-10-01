/**
 * The compendiums an import leaves in a world, read from the code that names
 * and files them.
 *
 * The module ships none of these: the importer creates each one the first time
 * a book fills it. A label is built by the functions the importer builds it
 * with, and the document types, the sidebar folder, the Item shelves and the
 * books that carry a map are read from the source that decides them. `BRIEFS`
 * is the one thing authored here.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO, constantIndex, matchBrace, stripComments } from "./parse.mjs";

const LIBRARY = "scripts/lib/library.mjs";
const FOLDERS = "scripts/lib/compendium-folders.mjs";
const COOKBOOK = "scripts/importer/cookbook.mjs";
const BOOKS = "scripts/importer/books.mjs";
const ADVENTURE = "scripts/importer/adventure-binding.mjs";

/**
 * What a compendium of each document type is for, keyed by that type.
 *
 * A brief says what the compendium holds and how it is filed. It states no
 * rule, no figure and no name a book prints, and it lists no shelf: the shelves
 * are read from the code and printed beside it.
 */
const BRIEFS = {
  Item:
    "What a character is, knows, wears, carries and casts, with the traps and trade goods of the world around them. " +
    "Filed by kind rather than by book, and each class's starting templates are filed beside them.",
  Actor:
    "The creatures your books describe: a folder for each book and, inside it, a shelf for each kind of creature. " +
    "Animals share one shelf across books. In a Judge's set, an adventure's people, keyed places and organisations as well.",
  JournalEntry:
    "A keyed adventure as journals, one for each section with a page for each location, " +
    "and the rules tables that are not a single roll, kept where a Judge can check and override them.",
  RollTable:
    "The tables a Judge rolls on: the ones your books print, the rules tables that are a single roll, " +
    "and a table of each class's templates.",
  Adventure:
    "A mapped settlement as one Adventure. Importing it puts back the map, its places and its organisations " +
    "wherever a world is missing them, and changes nothing the world already holds.",
};

const read = (rel) => fs.readFileSync(path.join(REPO, rel), "utf8");

/** Stands in for a series name in a label pattern. */
const SERIES = "<series>";

/** The `const NAME = "literal";` one source file declares. Throws when it declares none. */
function literal(rel, name) {
  const value = constantIndex([path.join(REPO, rel)]).global.get(name);
  if (value === undefined) {
    throw new Error(`${rel} no longer declares ${name} as a string literal — update extract-library.mjs.`);
  }
  return value;
}

/** The strings of the `const NAME = ["a", "b"];` one source file declares. Throws when there are none. */
function literalList(rel, name) {
  const list = new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*=\\s*\\[([^\\]]*)\\]`, "m").exec(read(rel));
  const values = [...(list?.[1] ?? "").matchAll(/(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  if (!values.length) {
    throw new Error(`${rel} no longer declares ${name} as a list of string literals — update extract-library.mjs.`);
  }
  return values;
}

/**
 * The string values of the `const NAME = { ... };` map one source file
 * declares, in source order, each once. Throws when there are none.
 */
function mapValues(rel, name) {
  const src = read(rel);
  const head = new RegExp(`^(?:export\\s+)?const\\s+${name}\\s*=\\s*(?:Object\\.freeze\\()?\\s*\\{`, "m").exec(src);
  const open = head ? head.index + head[0].length - 1 : -1;
  const close = open < 0 ? -1 : matchBrace(src, open);
  // Comments go first: these maps explain half their rows in a `//` line, and
  // one of those quotes an id.
  const body = close < 0 ? "" : stripComments(src.slice(open, close + 1));
  const values = [...body.matchAll(/:\s*(["'])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]);
  if (!values.length) {
    throw new Error(`${rel} no longer declares ${name} as a map of string literals — update extract-library.mjs.`);
  }
  return [...new Set(values)];
}

/**
 * The ids of the shipped books whose cookbook carries a map: the books the
 * importer's map step names as carriers.
 */
function mapBooks(books) {
  return Object.keys(books).filter((id) => {
    const file = path.join(REPO, "cookbook", `${id}.json`);
    if (!fs.existsSync(file)) return false;
    const src = fs.readFileSync(file, "utf8");
    // Most cookbooks carry no map and one is megabytes: parse only a file that
    // names the key at all.
    return src.includes('"scenes"') && Object.keys(JSON.parse(src).scenes ?? {}).length > 0;
  });
}

/**
 * @returns {Promise<{
 *   folder: string[],
 *   shelves: {type: string, labels: string[], brief: string|null, shelves: string[]}[],
 *   judge: {label: string, closed: boolean},
 *   series: {label: string, unnamed: string, judge: string},
 *   unbriefed: string[],
 *   untyped: string[],
 * }>} `folder` is the sidebar path the compendiums are filed under, root
 *   first. `shelves` has one row per document type: the labels of that type's
 *   compendium in the ACKS library, or, for the type only a book with a map
 *   fills, on the shelves those books write to; and the folders inside it that
 *   the code names. `judge` and `series` show how a label changes for a
 *   Judge's book and for another game's. `unbriefed` names each type with no
 *   brief, `untyped` each brief whose type the code keeps no compendium for.
 */
export async function extractLibrary() {
  const { libraryPackLabel, judgeLine, JUDGE_SHELF_OWNERSHIP } = await import(new URL(`../../../${LIBRARY}`, import.meta.url));
  const { BOOKS: books, bookLine, bookIsJudges } = await import(new URL(`../../../${BOOKS}`, import.meta.url));
  const manifest = JSON.parse(read("module.json"));

  // `lineOf` in the cookbook is what shelves a book, and it cannot be imported
  // without the platform. Its rule for a shipped book is restated in `lineOf`
  // below, so the restatement is checked against the source it copies.
  const rule = "returnbookIsJudges(id)?judgeLine(bookLine(id)):bookLine(id);";
  if (!read(COOKBOOK).replace(/\s+/g, "").includes(rule)) {
    throw new Error(`lineOf() in ${COOKBOOK} no longer shelves a shipped book as extract-library.mjs reads it — update extractLibrary().`);
  }
  const lineOf = (id) => (bookIsJudges(id) ? judgeLine(bookLine(id)) : bookLine(id));

  const root = manifest.packFolders?.[0]?.name;
  if (!root) throw new Error("module.json no longer declares a top-level packFolders entry — update extract-library.mjs.");

  const adventure = literal(ADVENTURE, "ADVENTURE_TYPE");
  const libraryTypes = literalList(LIBRARY, "LIBRARY_TYPES");
  const adventureLines = [...new Set(mapBooks(books).map(lineOf))];
  const itemShelves = mapValues(COOKBOOK, "ITEM_SHELF");

  const shelves = [
    ...libraryTypes.map((type) => ({ type, labels: [libraryPackLabel(type)] })),
    { type: adventure, labels: adventureLines.map((line) => libraryPackLabel(adventure, line)) },
  ].map((row) => ({
    ...row,
    brief: BRIEFS[row.type] ?? null,
    shelves: row.type === "Item" ? itemShelves : [],
  }));

  const types = shelves.map((row) => row.type);
  const example = types.includes("Actor") ? "Actor" : types[0];

  return {
    folder: [root, literal(FOLDERS, "IMPORT_FOLDER")],
    shelves,
    judge: {
      label: libraryPackLabel(example, judgeLine()),
      closed: JUDGE_SHELF_OWNERSHIP.PLAYER === "NONE" && JUDGE_SHELF_OWNERSHIP.TRUSTED === "NONE",
    },
    series: {
      label: libraryPackLabel(example, SERIES),
      unnamed: libraryPackLabel(example, literal(COOKBOOK, "UNLINED_LINE")),
      judge: libraryPackLabel(example, judgeLine(SERIES)),
    },
    unbriefed: types.filter((type) => !BRIEFS[type]),
    untyped: Object.keys(BRIEFS).filter((type) => !types.includes(type)),
  };
}
