/**
 * The readers that turn on which books the module offers (`BOOKS`) against
 * which it knows (`REGISTRY`): the cookbook loader, `offeredHere`, and the
 * legacy world-settings migration's guard on a setting nobody registers.
 *
 * Every book id here is invented, and the books are added to the live
 * `BOOKS`/`REGISTRY` objects (or the settings registry is built by hand), so
 * what is proven holds whichever of the real books the shipped switch offers.
 * One suite per process: the mutations are never undone.
 */
import assert from "node:assert";
import { BOOKS, REGISTRY } from "../../scripts/importer/books.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { LEGACY_ID } from "../../scripts/importer/legacy.mjs";
import { cookbookBookFile, initCookbook, loadCookbook, offeredHere } from "../../scripts/importer/cookbook.mjs";
import { migrateWorldSettings } from "../../scripts/importer/migrate.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/* --- the books: one offered, one in the registry only ------------------------------------ */

const ON = "zzon";
const OFF = "zzoff";
REGISTRY[ON] = { label: "Invented offered", short: "ZON", pages: 1, titleRe: /zzon/ };
REGISTRY[OFF] = { label: "Invented withdrawn", short: "ZOFF", pages: 2, titleRe: /zzoff/ };
BOOKS[ON] = REGISTRY[ON];

const cookbookOf = (id, entry) => ({ book: { id }, entries: { [`${id}.${entry}`]: { kind: "kind.prose", name: entry } } });
const FREE = "zzfree"; // in no registry and no offered set
const FILES = { [ON]: cookbookOf(ON, "a"), [OFF]: cookbookOf(OFF, "a"), [FREE]: cookbookOf(FREE, "a") };

/* --- loadCookbook ------------------------------------------------------------------------ */

const asked = [];
let indexed = true;
globalThis.foundry = {
  utils: {
    fetchJsonWithTimeout: async (url) => {
      const name = String(url).split("/").pop().replace(/\.json$/, "");
      asked.push(name);
      if (name === "registers") return {};
      if (name === "index") {
        if (!indexed) throw new Error(`404 ${url}`);
        return { books: [ON, OFF, FREE], content: [] };
      }
      if (FILES[name]) return structuredClone(FILES[name]);
      throw new Error(`404 ${url}`);
    },
  },
};
/** `loadCookbook`, without its one-line console report. */
const load = async () => {
  const log = console.log;
  console.log = () => {};
  try {
    return await loadCookbook();
  } finally {
    console.log = log;
  }
};

initCookbook({ sessionDocs: new Map() });
ok("the invented cookbook loads", await load());
ok("a listed, offered book's file is fetched", asked.includes(ON));
ok("a listed book the module does not offer is never fetched", !asked.includes(OFF));
ok("the offered book's entries are loaded", !!cookbookBookFile(ON)?.entries[`${ON}.a`]);
ok("the withdrawn book's entries are not", cookbookBookFile(OFF) === null);
ok("a listed book the registry does not know is loaded", asked.includes(FREE) && !!cookbookBookFile(FREE));

asked.length = 0;
indexed = false;
await load();
ok("with no index every offered book is probed", asked.includes(ON));
ok("with no index a withdrawn book is not probed", !asked.includes(OFF));
ok("with no index every real offered book is probed", Object.keys(BOOKS).every((id) => asked.includes(id)));
ok("with no index no withdrawn real book is probed", Object.keys(REGISTRY).filter((id) => !(id in BOOKS)).every((id) => !asked.includes(id)));
indexed = true;

/* --- offeredHere ------------------------------------------------------------------------- */

ok("a claim of an offered book is offered", offeredHere(`${ON}.a`));
ok("an unloaded claim of an offered book is offered", offeredHere(`${ON}.b`));
ok("an unloaded claim of a book the module withdrew is not offered", !offeredHere(`${OFF}.b`));
ok("a group claim of a withdrawn book is not offered", !offeredHere(`${OFF}.group.k`));
ok("a content claim naming no book is offered", offeredHere("def.nothing.here"));
ok("a claim naming a book nobody knows is offered", offeredHere("zzunknown.b"));
ok("an empty claim is offered", offeredHere(""));

BOOKS[OFF] = REGISTRY[OFF];
await load();
delete BOOKS[OFF];
ok("a loaded entry of a withdrawn book is not offered", !offeredHere(`${OFF}.a`));
ok("an unloaded one beside it is not offered either", !offeredHere(`${OFF}.b`));
BOOKS[OFF] = REGISTRY[OFF];
ok("the same claims are offered once the book is offered", offeredHere(`${OFF}.a`) && offeredHere(`${OFF}.b`));
delete BOOKS[OFF];

/* --- migrateWorldSettings ---------------------------------------------------------------- */

const SETTINGS = ["shelf", "oseSources", "dynamicRecipes"];
const world = (registered, residue = []) => {
  const docs = new Map();
  const deleted = [];
  const set = [];
  const add = (key, value) => docs.set(key, { key, value, delete: async () => { deleted.push(key); docs.delete(key); } });
  for (const key of SETTINGS) add(`${LEGACY_ID}.${key}`, { held: key });
  for (const key of residue) add(`${LEGACY_ID}.${key}`, 1);
  add(`${MODULE_ID}.untouched`, 1);
  globalThis.game = {
    settings: {
      settings: new Map(registered.map((key) => [`${MODULE_ID}.${key}`, {}])),
      set: async (scope, key, value) => set.push([scope, key, value]),
      storage: {
        get: () => ({
          getSetting: (key) => docs.get(key),
          filter: (fn) => [...docs.values()].filter(fn),
        }),
      },
    },
  };
  return { docs, deleted, set };
};
const legacy = (key) => `${LEGACY_ID}.${key}`;

{
  const w = world(SETTINGS, ["gone"]);
  const moved = await migrateWorldSettings();
  ok("with every setting registered all three are copied", w.set.length === 3 && SETTINGS.every((key) => w.set.some(([scope, k]) => scope === MODULE_ID && k === key)));
  ok("the copy carries the stored value", w.set.every(([, key, value]) => value.held === key));
  ok("every legacy document of a copied setting is removed", SETTINGS.every((key) => w.deleted.includes(legacy(key))));
  ok("a legacy setting nothing registers or read is residue and goes", w.deleted.includes(legacy("gone")));
  ok("a document in this module's own namespace is left", w.docs.has(`${MODULE_ID}.untouched`));
  ok("the count is moved plus residue", moved === 4);
}
{
  const w = world(["shelf", "dynamicRecipes"], ["gone"]);
  const moved = await migrateWorldSettings();
  ok("an unregistered setting is not set (set would throw)", w.set.length === 2 && !w.set.some(([, key]) => key === "oseSources"));
  ok("the registered settings still move", ["shelf", "dynamicRecipes"].every((key) => w.deleted.includes(legacy(key))));
  ok("an unregistered setting's legacy document stays", w.docs.has(legacy("oseSources")) && !w.deleted.includes(legacy("oseSources")));
  ok("residue is still swept beside it", w.deleted.includes(legacy("gone")));
  ok("the count leaves the skipped one out", moved === 3);
}
{
  const w = world([], ["gone"]);
  const moved = await migrateWorldSettings();
  ok("with nothing registered nothing is set", w.set.length === 0);
  ok("with nothing registered the three legacy documents stay", SETTINGS.every((key) => w.docs.has(legacy(key))));
  ok("with nothing registered only residue goes", w.deleted.join() === legacy("gone") && moved === 1);
}

console.log(`\ntest-offered-set-reads: all ${pass} checks passed`);
