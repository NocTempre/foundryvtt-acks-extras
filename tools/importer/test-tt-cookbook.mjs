/**
 * Shape checks over the committed magic-item entries of a book's cookbook
 * (`cookbook/tt.json`): what the compiler must have written for every
 * `kind.magicItem` entry, whatever the entries are. It reads no book text,
 * because the cookbook holds none. A cookbook with no such entry, or none at
 * all, checks nothing and says so: that is the state before any row is seeded.
 *
 * Usage: node tools/importer/test-tt-cookbook.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { MAGIC_CATEGORIES } from "../../scripts/importer/cookbook/magic-items.mjs";

const FILE = new URL("../../cookbook/tt.json", import.meta.url);
const book = fs.existsSync(FILE) ? JSON.parse(fs.readFileSync(FILE, "utf8")) : { entries: {} };
const items = Object.entries(book.entries ?? {}).filter(([, e]) => e.kind === "kind.magicItem");

if (!items.length) {
  console.log("tt-cookbook: 0 magic-item entries in cookbook/tt.json, so nothing is checked");
} else {
  let n = 0;
  const check = (label, cond) => {
    assert.ok(cond, label);
    n++;
  };
  const keys = new Set();
  const rows = new Map();
  const dir = new URL("../../register/tt/", import.meta.url);
  for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (f.endsWith(".json")) for (const r of JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"))) rows.set(r.id, r);
  }
  for (const [id, e] of items) {
    const row = rows.get(id);
    check(`${id} has its register row`, !!row);
    check(`${id} has a key`, typeof e.key === "string" && !!e.key);
    check(`${id}'s key is unique`, !keys.has(e.key));
    keys.add(e.key);
    check(`${id} has a name op from its row's anchor`, e.fields?.name?.op === (row?.anchor?.hash !== undefined ? "heading" : "expect"));
    check(`${id} has a text description`, e.fields?.description?.op === "text" && e.fields.description.paras?.length > 0);
    check(`${id} has values specs unless its row's are empty`, row?.values?.length === 0 ? e.fields.values === undefined : e.fields?.values?.specs?.length > 0);
    check(`${id} is in a category of the vocabulary`, MAGIC_CATEGORIES.includes(e.meta?.category));
    check(`${id} has contiguous pages`, e.pages?.length > 0 && e.pages.every((p, i) => i === 0 || p === e.pages[i - 1] + 1));
    if (/^Item \d+$/.test(e.name)) check(`${id} is named Item <n> with its own ordinal`, e.name === `Item ${id.split(".item")[1]}`);
  }
  console.log(`tt-cookbook: ${n} checks over ${items.length} magic-item entries OK`);
}
