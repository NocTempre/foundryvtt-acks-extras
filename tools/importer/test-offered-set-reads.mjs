/**
 * The readers that turn on which books the module offers (`BOOKS`) against
 * which it knows (`REGISTRY`): the cookbook loader and `offeredHere`.
 *
 * Every book id here is invented, and the books are added to the live
 * `BOOKS`/`REGISTRY` objects, so what is proven holds whichever of the real
 * books the shipped switch offers. One suite per process: the mutations are
 * never undone.
 */
import assert from "node:assert";
import { BOOKS, REGISTRY } from "../../scripts/importer/books.mjs";
import { cookbookBookFile, initCookbook, loadCookbook, offeredHere } from "../../scripts/importer/cookbook.mjs";

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

console.log(`\ntest-offered-set-reads: all ${pass} checks passed`);
