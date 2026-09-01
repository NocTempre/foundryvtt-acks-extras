/**
 * Every id namespace the shipped cookbooks can materialize as an ITEM has a
 * shelf to land on.
 *
 * `itemShelfFor` keys on an id's first two segments and answers null for a
 * namespace it does not know, which used to mean the document was filed at the
 * top of the library with no folder at all. Nothing said so: not the importer,
 * not validate, not a test. Three namespaces drifted in that way and a live
 * world accumulated 178 items sitting loose above the shelves — priced gear,
 * races, and four conversion constants that should never have been items.
 *
 * So the shelf table is asserted against the DATA rather than against itself:
 * every namespace the cookbooks actually carry must either have a shelf or be
 * named below as something that is deliberately not an item. A new content
 * kind is then a failing test at the moment it is added, instead of a folder
 * nobody notices is missing.
 *
 * Runs over the shipped JSON with no PDFs and no Foundry, like its siblings —
 * the shelf table is duplicated here on purpose (importing `cookbook.mjs`
 * would drag in the Foundry globals), and THAT is what makes the check
 * meaningful: it fails when the two disagree.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const COOKBOOK = path.join(ROOT, "cookbook");

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

/* ------------------------------------------------------------------ */
/*  What the module says                                               */
/* ------------------------------------------------------------------ */

/** `ITEM_SHELF` as `cookbook.mjs` declares it, read from the source. */
function shelfKeysFromSource() {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "importer", "cookbook.mjs"), "utf8");
  const block = src.match(/const ITEM_SHELF = \{([\s\S]*?)\n\};/);
  assert.ok(block, "ITEM_SHELF is declared in scripts/cookbook.mjs");
  return new Set([...block[1].matchAll(/"(def\.[a-zA-Z]+)":/g)].map((m) => m[1]));
}

/** `NON_ABILITY_KINDS` as `cookbook.mjs` declares it. */
function nonAbilityKindsFromSource() {
  const src = fs.readFileSync(path.join(ROOT, "scripts", "importer", "cookbook.mjs"), "utf8");
  const block = src.match(/const NON_ABILITY_KINDS = new Set\(\[([\s\S]*?)\]\);/);
  assert.ok(block, "NON_ABILITY_KINDS is declared in scripts/cookbook.mjs");
  return new Set([...block[1].matchAll(/"(kind\.[a-zA-Z]+)"/g)].map((m) => m[1]));
}

/* ------------------------------------------------------------------ */
/*  What the data carries                                              */
/* ------------------------------------------------------------------ */

/** id namespace -> the kinds the cookbooks file under it. */
const namespaces = new Map();
for (const f of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json" && n !== "index.json")) {
  const c = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  for (const [id, e] of Object.entries(c.entries ?? {})) {
    if (!id.startsWith("def.")) continue; // book entries (monsters, locations) are not items
    const key = id.split(".").slice(0, 2).join(".");
    if (!namespaces.has(key)) namespaces.set(key, new Set());
    namespaces.get(key).add(e.kind);
  }
}
check("the shipped cookbooks carry definition namespaces", namespaces.size >= 8);

/**
 * Namespaces that are deliberately NOT items, with the reason.
 *
 * A conversion constant is a number the OSE converter is handed at run time
 * (`readScgConstants`); it has no document at all. Being absent from this list
 * AND from ITEM_SHELF is the failure this file exists to catch — it is how four
 * of them became `ability` items nothing reads.
 */
const NOT_ITEMS = {
  "def.constant": "a printed number passed to the converter, never a document",
  "def.vehicle": "one ACTOR per printed row — actorFolderFor files these, not ensureItemFolder",
  "def.classmeta": "a passage read for one name at import time (executeCommonTongue), never a document",
};

const shelves = shelfKeysFromSource();
const homeless = [...namespaces.keys()].filter((k) => !shelves.has(k) && !(k in NOT_ITEMS));
check(
  `every item namespace has a shelf or a stated reason (homeless: ${homeless.join(", ") || "none"})`,
  homeless.length === 0,
);

for (const [key, why] of Object.entries(NOT_ITEMS)) {
  check(`${key} is not also given an item shelf (${why})`, !shelves.has(key));
}

/* A namespace declared in NOT_ITEMS must be excluded from the generic ability
 * walk too, or it gets an `ability` item by the other route. The walk excludes
 * by KIND, so every kind those namespaces carry has to be in the set. */
const nonAbility = nonAbilityKindsFromSource();
for (const key of Object.keys(NOT_ITEMS)) {
  for (const kind of namespaces.get(key) ?? []) {
    check(`${kind} (${key}) is excluded from the ability import`, nonAbility.has(kind));
  }
}

/**
 * Shelves whose namespace is minted at RUNTIME, from an extracted TABLE, and so
 * has no shipped entries to be found here.
 *
 * A language has no register entry by design — the taxonomy is extracted from
 * the reader's own book and its ids are derived there (`languageId`), because
 * fifty-eight entries carrying a name and nothing else would BE the list rather
 * than a way of finding it. The weapon, armour, price and race namespaces are
 * the same shape: one id per row of a grid nobody transcribed.
 *
 * They still need a shelf — more than the shipped ones do, since nothing about
 * them can be checked by reading the cookbooks. `def.priced` is exactly the
 * namespace that had none.
 */
const RUNTIME_MINTED = new Set(["def.language", "def.priced", "def.weapon", "def.armor", "def.race"]);

/* Every other shelf row must be reachable: a row for a namespace nothing
 * carries and nothing mints is a folder that would never be filled, or a typo
 * for one that would. */
const carried = new Set(namespaces.keys());
for (const key of shelves) {
  if (RUNTIME_MINTED.has(key)) continue;
  check(`ITEM_SHELF["${key}"] names a namespace the cookbooks actually carry`, carried.has(key));
}
for (const key of RUNTIME_MINTED) {
  check(`ITEM_SHELF["${key}"] gives the runtime-minted namespace a shelf`, shelves.has(key));
}

console.log(`\ntest-item-shelves: all ${pass} checks passed (${namespaces.size} namespaces, ${shelves.size} shelves)`);
