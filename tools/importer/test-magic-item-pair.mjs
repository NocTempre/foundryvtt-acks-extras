/**
 * An item two books print, kept as one document (`magic-item-pair.mjs`): the
 * pairs read from the cookbooks, the two patches, what an import does about a
 * pair (`pairStep`), and that either import order ends in the same document.
 * Invented rows and items only; no PDF, no Foundry.
 *
 * Usage: node tools/importer/test-magic-item-pair.mjs
 */
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { claimIds } from "../../scripts/importer/place-pair.mjs";
import fs from "node:fs";
import { bindPatch, magicItemPairs, pairStep, takeoverPatch, writesOver } from "../../scripts/importer/magic-item-pair.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/** Stored data with an update payload written over it, dotted keys and all. */
function applied(source, patch) {
  const out = structuredClone(source);
  for (const [key, value] of Object.entries(patch)) {
    const keys = key.split(".");
    let node = out;
    for (const k of keys.slice(0, -1)) node = node[k] ??= {};
    node[keys.at(-1)] = structuredClone(value);
  }
  return out;
}

const EARLIER = { id: "ea.item3", book: "ea" };
const LATER = { id: "lb.item8", book: "lb" };
const books = new Map([
  ["ea", { entries: { [EARLIER.id]: { kind: "kind.magicItem", meta: { category: "rings", revisedBy: LATER.id } }, "ea.item4": { kind: "kind.magicItem", meta: { category: "rings" } } } }],
  ["lb", { entries: { [LATER.id]: { kind: "kind.magicItem", meta: { category: "rings" } } } }],
]);
const pairs = magicItemPairs(books);

/** A stored item as the import builds it: the book's folder, its description, its figures. */
const stored = (row, folder, description, extra = {}) => ({
  name: "Quorv Band",
  type: "item",
  folder,
  system: { description, quantity: 1 },
  flags: { [MODULE_ID]: { cookbook: { id: row.id, book: row.book, kind: "kind.magicItem" }, markets: { magic: true, baseCostGp: row.id === EARLIER.id ? 100 : 120 } } },
  ...extra,
});
const earlierDoc = () => stored(EARLIER, "F.ea", "<p>Earlier text.</p>");
const laterDoc = () => stored(LATER, "F.lb", "<p>Later text.</p>");
const laterRow = { id: LATER.id, book: LATER.book, folder: "F.lb" };
const earlierRow = { id: EARLIER.id, folder: "F.ea" };

/** The later build written over a held earlier document in place, as the repair does: its description and figures, the uuid and every other field kept. */
const repairedOver = (held) => {
  const out = structuredClone(held);
  out.system.description = laterDoc().system.description;
  out.flags[MODULE_ID].markets = laterDoc().flags[MODULE_ID].markets;
  out.flags[MODULE_ID].cookbook = { ...out.flags[MODULE_ID].cookbook, id: LATER.id, book: LATER.book };
  return out;
};

t("a pair is read from the earlier row's revisedBy and found from either id", () => {
  assert.deepEqual(pairs.get(EARLIER.id), { earlier: EARLIER.id, later: LATER.id });
  assert.equal(pairs.get(LATER.id), pairs.get(EARLIER.id));
  assert.equal(pairs.get("ea.item4"), undefined);
  assert.equal(pairs.size, 2);
  const other = magicItemPairs(new Map([["ea", { entries: { x: { kind: "kind.location", meta: { revisedBy: "lb.item1" } } } }]]));
  assert.equal(other.size, 0, "only a magic item row makes an item pair");
});

t("Journal then Tome and Tome then Journal end in one document", () => {
  const first = applied(repairedOver(earlierDoc()), takeoverPatch(repairedOver(earlierDoc()), laterRow, earlierRow));
  const second = applied(laterDoc(), bindPatch(laterDoc(), EARLIER));
  assert.deepEqual(first, second);
  assert.equal(first.flags[MODULE_ID].cookbook.id, LATER.id);
  assert.equal(first.flags[MODULE_ID].cookbook.book, LATER.book);
  assert.equal(first.folder, "F.lb");
});

t("the merged ids: the earlier id joins, and every id the document already answers for stays", () => {
  const withMerged = earlierDoc();
  withMerged.flags[MODULE_ID].cookbook.merged = ["ea.other"];
  const taken = applied(withMerged, takeoverPatch(withMerged, laterRow, earlierRow));
  assert.deepEqual(taken.flags[MODULE_ID].cookbook.merged, [EARLIER.id, "ea.other"]);
  assert.deepEqual(claimIds(taken.flags[MODULE_ID].cookbook).sort(), [EARLIER.id, "ea.other", LATER.id].sort());
  const bound = applied(laterDoc(), bindPatch(laterDoc(), EARLIER));
  assert.deepEqual(bound.flags[MODULE_ID].cookbook.merged, [EARLIER.id]);
  const rebuilt = laterDoc();
  rebuilt.flags[MODULE_ID].cookbook.merged = [EARLIER.id];
  assert.deepEqual(bindPatch(rebuilt, EARLIER), {}, "a second bind adds nothing");
  assert.deepEqual(takeoverPatch(applied(rebuilt, { folder: "F.lb" }), laterRow, earlierRow), {}, "a second takeover adds nothing");
});

t("a held edit survives the takeover: the patch writes the claim and the folder, never the text, name or play's fields", () => {
  const held = earlierDoc();
  held.name = "Judge's Own Name";
  held.system.description = "<p>The Judge's edited text.</p>";
  held.system.quantity = 3;
  held.flags[MODULE_ID].heldNote = "kept";
  const patch = takeoverPatch(held, laterRow, earlierRow);
  assert.deepEqual(Object.keys(patch).sort(), [`flags.${MODULE_ID}.cookbook.book`, `flags.${MODULE_ID}.cookbook.id`, `flags.${MODULE_ID}.cookbook.merged`, "folder"].sort());
  const out = applied(held, patch);
  assert.equal(out.name, "Judge's Own Name");
  assert.equal(out.system.description, "<p>The Judge's edited text.</p>");
  assert.equal(out.system.quantity, 3);
  assert.equal(out.flags[MODULE_ID].heldNote, "kept");
  const moved = { ...earlierDoc(), folder: "F.judge" };
  assert.ok(!("folder" in takeoverPatch(moved, laterRow, earlierRow)), "a folder the Judge moved the item to stays");
});

t("what an import does about a pair, in each state of the library", () => {
  const lib = (docs, openBooks) => ({
    held: (id) => docs.find((d) => claimIds(d.flags[MODULE_ID].cookbook).includes(id)) ?? null,
    open: (b) => openBooks.includes(b),
  });
  assert.deepEqual(pairStep(pairs, "ea.item4", lib([], ["ea", "lb"])), { step: "own" }, "no pair");
  assert.deepEqual(pairStep(pairs, EARLIER.id, lib([], ["ea"])), { step: "own" }, "the later book is not open");
  assert.deepEqual(pairStep(pairs, EARLIER.id, lib([], ["ea", "lb"])), { step: "defer", to: LATER.id }, "the later book is open and holds none");
  assert.deepEqual(pairStep(pairs, EARLIER.id, lib([laterDoc()], ["ea"])), { step: "bind", to: LATER.id }, "the later document stands, its book open or not");
  assert.deepEqual(pairStep(pairs, LATER.id, lib([earlierDoc()], ["lb"])), { step: "takeover", from: EARLIER.id });
  assert.deepEqual(pairStep(pairs, LATER.id, lib([], ["lb"])), { step: "own" });
  const bound = applied(laterDoc(), bindPatch(laterDoc(), EARLIER));
  assert.deepEqual(pairStep(pairs, EARLIER.id, lib([bound], ["ea", "lb"])), { step: "present" }, "an id merged into a held document is present");
  assert.deepEqual(pairStep(pairs, LATER.id, lib([bound], ["lb"])), { step: "present" });
  assert.deepEqual(pairStep(pairs, EARLIER.id, lib([earlierDoc()], ["ea"])), { step: "present" }, "the earlier document its own build made");
});

t("the delete path: removing the one document leaves both rows to start again", () => {
  const docs = [applied(laterDoc(), bindPatch(laterDoc(), EARLIER))];
  const lib = () => ({
    held: (id) => docs.find((d) => claimIds(d.flags[MODULE_ID].cookbook).includes(id)) ?? null,
    open: () => true,
  });
  assert.equal(pairStep(pairs, EARLIER.id, lib()).step, "present");
  docs.length = 0;
  assert.deepEqual(pairStep(pairs, EARLIER.id, lib()), { step: "defer", to: LATER.id }, "the Journal row is imported through the Tome's again");
  assert.deepEqual(pairStep(pairs, LATER.id, lib()), { step: "own" }, "the Tome row is built as its own");
  // A document the Journal made alone, deleted, and the Tome imported next: nothing to take over.
  docs.push(earlierDoc());
  docs.length = 0;
  assert.deepEqual(pairStep(pairs, LATER.id, lib()), { step: "own" });
});

t("a forced rebuild of the earlier book leaves the merged document alone; an unpaired or own row is written", () => {
  const merged = applied(laterDoc(), bindPatch(laterDoc(), EARLIER));
  assert.equal(writesOver(merged, EARLIER.id), false, "the Journal row does not write over the Tome's document");
  assert.equal(writesOver(merged, LATER.id), true, "the Tome row writes its own document");
  assert.equal(writesOver(earlierDoc(), EARLIER.id), true, "an unpaired or not yet merged row rewrites its own document");
  assert.equal(writesOver(null, EARLIER.id), false);
});

t("the rebuild module deletes no item", () => {
  const rebuild = fs.readFileSync(new URL("../../scripts/importer/cookbook/rebuild.mjs", import.meta.url), "utf8");
  // The only deletes and rewrites there are of actors, places and factions; an item is written in place by its run.
  assert.ok(!/deleteImported\("Item"/.test(rebuild), "no item delete in rebuild.mjs");
});

console.log(`\nmagic-item-pair: ${n} checks OK`);
