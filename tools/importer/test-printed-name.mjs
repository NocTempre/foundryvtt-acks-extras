/**
 * A printed proper name is READ, never shipped — the pieces that make that so.
 *
 * Three things are guarded. The pure half (`printed-name.mjs`): the fold the
 * compiler finds a name by must be the fold the executor checks it by, a key
 * number must compare whole, and a heading set in capitals must come back as a
 * name without gaining or losing a letter. The executor's `heading` op: it
 * passes on the number or the hash and on nothing else, hands the words back
 * only when it passed, and joins a name the line broke the way the compiler
 * said to. And the `continues` flag of the text op, which joins a paragraph
 * across a column turn that falls before a capital.
 *
 * Every name below is invented; the file carries no book content. Offline and
 * Foundry-free: pages are handed to the executor through its own page cache,
 * so no PDF is opened.
 *
 * Usage: node tools/importer/test-printed-name.mjs
 */
import assert from "node:assert/strict";
import { foldLabel, hash36, printKey, firstToken, opensWithNumber, titleCaseHeading, printedNameOf } from "../../scripts/importer/printed-name.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { pictureKey } from "../../scripts/importer/scene-binding.mjs";

let n = 0;
const t = (name, fn) => Promise.resolve(fn()).then(() => {
  n++;
  console.log(`ok - ${name}`);
});

/* ---------------- the fold and the key ---------------- */

await t("the fold drops case, accents, space and punctuation", () => {
  assert.equal(foldLabel("  Sálty  Döor’s (“Gate”) "), "saltydoorsgate");
  assert.equal(foldLabel("SÁLTY"), foldLabel("SÁLTY"), "decomposed and precomposed accents land on one string");
  assert.equal(foldLabel(null), "");
});

await t("a print key is the same for every printing of the same letters", () => {
  assert.equal(printKey("The Salt Wardens"), printKey("the  SALT-wardens,"));
  assert.notEqual(printKey("The Salt Wardens"), printKey("The Salt Warden"));
  assert.match(printKey("The Salt Wardens"), /^[0-9a-z]{1,7}$/);
  assert.equal(printKey(" – "), "", "nothing to fold is nothing to find");
});

await t("the hash is FNV-1a, the one the picture key already used", () => {
  assert.equal(hash36(""), (0x811c9dc5).toString(36));
  assert.equal(hash36("a"), (0xe40c292c).toString(36));
  const recipe = { page: 3, crop: { x: 1, y: 2, w: 3, h: 4 }, turn: 5, feetPerPoint: 2.5 };
  assert.equal(pictureKey(recipe), hash36(JSON.stringify([3, 1, 2, 3, 4, 1, 2.5])), "so a picture cached under the old key is still found");
});

await t("a key number compares whole", () => {
  assert.equal(firstToken("  36U. VAULT OF SALT"), "36U.");
  assert.ok(opensWithNumber("30. SALT GATE", "30."));
  assert.ok(opensWithNumber("30. SALT GATE", "30"), "the dot is punctuation");
  assert.ok(!opensWithNumber("30. SALT GATE", "3."), "3 is not 30");
  assert.ok(!opensWithNumber("36U. VAULT", "36."), "36 is not 36U");
  assert.ok(opensWithNumber("20/20U. ARENA / CELLARS", "20/20U."));
  assert.ok(!opensWithNumber("SALT GATE", ""), "no number finds nothing");
});

/* ---------------- a heading in capitals, as a name ---------------- */

await t("capitals become a title, and the key number is left as printed", () => {
  assert.equal(titleCaseHeading("30. SALT GATE (“DOOR OF THE SEA”)"), "30. Salt Gate (“Door of the Sea”)");
  assert.equal(titleCaseHeading("36U. VAULT OF THE WARDENS"), "36U. Vault of the Wardens");
  assert.equal(titleCaseHeading("20/20U. GRAND ARENA / ARENA CELLARS"), "20/20U. Grand Arena / Arena Cellars");
});

await t("a small word opens a name or a gloss in capitals all the same", () => {
  assert.equal(titleCaseHeading("11. THE OTTER"), "11. The Otter");
  assert.equal(titleCaseHeading("THE OTTER AND THE EEL"), "The Otter and the Eel");
  assert.equal(titleCaseHeading("12. QUAY (“THE LONG WALK”)"), "12. Quay (“The Long Walk”)");
});

await t("numerals, possessives, accents and joined words keep their shape", () => {
  assert.equal(titleCaseHeading("16. WATCHTOWER IV"), "16. Watchtower IV");
  assert.equal(titleCaseHeading("41. WATCHTOWER XIX (SQUARE, SOUTHWEST)"), "41. Watchtower XIX (Square, Southwest)");
  assert.equal(titleCaseHeading("24. GAMBLER’S ROW"), "24. Gambler’s Row");
  assert.equal(titleCaseHeading("7. ANGLERS’ REACH"), "7. Anglers’ Reach");
  assert.equal(titleCaseHeading("18U. VÄLDRIC HOLLOW"), "18U. Väldric Hollow");
  assert.equal(titleCaseHeading("11/11U. THE OTTER/EEL-HOUSE CELLAR"), "11/11U. The Otter/Eel-House Cellar");
  assert.equal(titleCaseHeading("26. SALT & BONE WAREHOUSES"), "26. Salt & Bone Warehouses");
  assert.equal(titleCaseHeading("VIVID LANE"), "Vivid Lane", "a word is not a numeral for being spelled from its letters");
});

await t("a binder names a document from what was read, as it was printed", () => {
  assert.equal(printedNameOf({ fields: { name: { title: "30. SALT GATE" } } }, "POI 30"), "30. Salt Gate");
  assert.equal(printedNameOf({ fields: { name: { title: "The Salt Wardens" } } }, "Organisation 1"), "The Salt Wardens", "mixed case is already a name");
  assert.equal(printedNameOf({ fields: { name: { title: "20/20U. GRAND ARENA/ ARENA CELLARS" } } }, "POI 20/20U"), "20/20U. Grand Arena / Arena Cellars", "a slash the line broke after is given its other space");
  assert.equal(printedNameOf({ fields: { name: { title: "11/11U. THE OTTER/EEL HOUSE" } } }, "POI 11/11U"), "11/11U. The Otter/Eel House", "and one printed tight is left tight");
  assert.equal(printedNameOf({ fields: { name: { title: null } } }, "POI 30"), "POI 30");
  assert.equal(printedNameOf(null, "POI 30"), "POI 30");
});

/* ---------------- the executor's heading op ---------------- */

const item = (str, x, y, h = 12, w = str.length * 6) => ({ str, x, y, w, h, sp: false });
const page1 = {
  width: 612,
  height: 792,
  items: [
    item("30. SALT GATE (“DOOR OF", 40, 100),
    item("THE SEA”)", 40, 114),
    item("The gate stands open by day.", 40, 130, 9),
    // A run-in name inside running prose, broken by the line in the middle of a word.
    item("The guild is led by the", 40, 300, 9),
    item("Salt War", 170, 300, 9),
    item("-", 290, 300, 9),
    item("dens", 40, 312, 9),
    item("of the lower quay, who keep", 70, 312, 9),
  ],
};
const cookbook = (fields) => ({ schema: "acks-cookbook/2", entries: { "zz.poi30": { kind: "kind.location", name: "POI 30", pages: [1], fields } } });
const run = (fields) => executeEntry(null, cookbook(fields), {}, "zz.poi30", { pageCache: new Map([[1, page1]]) });
const headingBox = { x0: 37, x1: 300, y0: 86, y1: 119 };

await t("a heading passes on its key number and hands the words back", async () => {
  const node = await run({ name: { op: "heading", page: 1, box: headingBox, number: "30.", fixes: { joinSpace: [0] } } });
  assert.equal(node.ok, true);
  assert.equal(node.fields.name.title, "30. SALT GATE (“DOOR OF THE SEA”)");
  assert.equal(printedNameOf(node, "POI 30"), "30. Salt Gate (“Door of the Sea”)");
});

await t("the wrong number fails the entry and names nothing", async () => {
  const node = await run({ name: { op: "heading", page: 1, box: headingBox, number: "3.", fixes: { joinSpace: [0] } } });
  assert.equal(node.ok, false);
  assert.equal(node.fields.name.title, null, "a box that failed its check is some other entry's words");
  assert.equal(printedNameOf(node, "POI 30"), "POI 30");
});

await t("a name the line broke is read in parts, glued where a word was broken", async () => {
  const parts = [{ box: { x0: 168, x1: 172, y0: 297, y1: 303 } }, { box: { x0: 38, x1: 42, y0: 309, y1: 315 }, glue: true }];
  const node = await run({ name: { op: "heading", page: 1, parts, hash: printKey("Salt Wardens") } });
  assert.equal(node.ok, true);
  assert.equal(node.fields.name.title, "Salt Wardens");
  const spaced = await run({ name: { op: "heading", page: 1, parts: parts.map(({ box }) => ({ box })), hash: printKey("Salt Wardens") } });
  assert.equal(spaced.fields.name.title, "Salt War dens", "without the glue the break is a space, and the fold still passes");
});

await t("the wrong hash fails, and a heading with neither check never passes", async () => {
  const parts = [{ box: { x0: 168, x1: 172, y0: 297, y1: 303 } }];
  assert.equal((await run({ name: { op: "heading", page: 1, parts, hash: printKey("Salt Wardens") } })).ok, false);
  assert.equal((await run({ name: { op: "heading", page: 1, box: headingBox } })).ok, false);
});

await t("an entry that ships its label still checks by expect", async () => {
  const node = await run({ name: { op: "expect", page: 1, box: headingBox, text: "30. SALT GATE" } });
  assert.equal(node.ok, true);
  assert.equal(node.fields.name.title, undefined, "expect hands no words on");
});

/* ---------------- a paragraph across a column turn ---------------- */

const page2 = {
  width: 612,
  height: 792,
  items: [
    item("The wardens of the quay are led by", 40, 700, 9),
    item("Mother Ansel, a keeper of long standing.", 320, 80, 9),
    item("the eldest of them.", 320, 200, 9),
  ],
};
const proseOf = async (second) => {
  const cb = { schema: "acks-cookbook/2", entries: { "zz.org1": { kind: "kind.organisation", name: "Organisation 1", pages: [2], fields: {
    description: { op: "text", page: 2, paras: [{ box: { x0: 38, x1: 300, y0: 697, y1: 703 } }, second] },
  } } } };
  const node = await executeEntry(null, cb, {}, "zz.org1", { pageCache: new Map([[2, page2]]) });
  return node.fields.description.map((p) => p.text);
};

await t("a turn before a capital is joined only when the compiler says it continues", async () => {
  const capital = { box: { x0: 318, x1: 600, y0: 77, y1: 83 } };
  assert.deepEqual(await proseOf(capital), ["The wardens of the quay are led by", "Mother Ansel, a keeper of long standing."]);
  assert.deepEqual(await proseOf({ ...capital, continues: true }), ["The wardens of the quay are led by Mother Ansel, a keeper of long standing."]);
});

await t("a turn before a lower-case letter is joined as it always was", async () => {
  assert.deepEqual(await proseOf({ box: { x0: 318, x1: 600, y0: 197, y1: 203 } }), ["The wardens of the quay are led by the eldest of them."]);
});

console.log(`\nprinted-name: ${n} checks OK`);
