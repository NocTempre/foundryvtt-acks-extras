/**
 * Offline tests for the monsters feature's reading of outside references and,
 * layered on the recipe evaluator, its optional organisation rules. Foundry-free
 * and book-free: every creature word, library entry, breed, band, rank, figure
 * and page reference below is invented. What this pins is the procedure: a
 * printed word resolves to a library entry only on equality of folded tokens
 * with exactly one entry, a word the page leaves a qualifier or a category out
 * of is a finding with candidates and never a guess, a table cell reads into a
 * part of the table's own with the word kept for the resolver.
 *
 * Run: node tools/test-organisation-logic.mjs
 */
import assert from "node:assert/strict";
import {
  QUALIFIERS, REFERENCE, beastCellPart, foldTokens, readBeastCell, readMountCell, resolveOutside, resolveParts,
} from "../scripts/monsters/outside-reference.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const LIBRARY = [
  { name: "Quux", uuid: "L.quux" },
  { name: "Zorp, Blue", uuid: "L.zorpBlue" },
  { name: "Zorp, Red", uuid: "L.zorpRed" },
  { name: "Mog, Grey Flim", uuid: "L.mogFlim" },
  { name: "Gleaf", uuid: "L.gleaf" },
  { name: "Nib Gleaf", uuid: "L.nibGleaf" },
];

/* -------------------------------------------- */
/*  The resolver                                 */
/* -------------------------------------------- */

t("a fold ignores case, punctuation, word order and a plural", () => {
  assert.deepEqual(foldTokens("Zorp, Blue"), foldTokens("blue zorps"));
  assert.deepEqual(foldTokens("QUUXES"), foldTokens("quux"));
  assert.deepEqual(foldTokens("gleaves"), foldTokens("Gleaf"), "ves folds to f");
  assert.deepEqual(foldTokens("trained quuxes", QUALIFIERS), ["quux"], "a qualifier word is dropped");
  assert.deepEqual(foldTokens("trained quuxes", []), ["quux", "trained"], "unless the caller lists none");
});

t("one entry of equal tokens resolves, whatever the order the page prints", () => {
  const hit = resolveOutside("trained blue zorps", LIBRARY);
  assert.equal(hit.status, REFERENCE.resolved);
  assert.equal(hit.entry.uuid, "L.zorpBlue");
  assert.equal(resolveOutside("quuxes", LIBRARY).entry.uuid, "L.quux");
  assert.equal(resolveOutside("gleaves", LIBRARY).entry.uuid, "L.gleaf", "an entry that merely contains the word does not outrank the equal one");
});

t("two entries of one fold are never picked between", () => {
  const twins = [...LIBRARY, { name: "quux", uuid: "L.quuxTwin" }];
  const hit = resolveOutside("quuxes", twins);
  assert.equal(hit.status, REFERENCE.ambiguous);
  assert.equal(hit.entry, null);
  assert.deepEqual(hit.candidates.map((e) => e.uuid).sort(), ["L.quux", "L.quuxTwin"]);
});

t("a word the page leaves a qualifier out of is a finding with its candidates, not a resolution", () => {
  const hit = resolveOutside("zorps", LIBRARY);
  assert.equal(hit.status, REFERENCE.partial);
  assert.equal(hit.entry, null, "two entries carry the word and more: none is chosen");
  assert.deepEqual(hit.candidates.map((e) => e.uuid).sort(), ["L.zorpBlue", "L.zorpRed"]);
});

t("a word whose entry is filed under a category word the page leaves out is a finding, however alone it is", () => {
  const hit = resolveOutside("grey flims", LIBRARY);
  assert.equal(hit.status, REFERENCE.partial);
  assert.equal(hit.entry, null, "a category word is never invented to make it match");
  assert.deepEqual(hit.candidates.map((e) => e.uuid), ["L.mogFlim"]);
});

t("a word nothing answers is none, and a blank or all-qualifier word answers none", () => {
  assert.equal(resolveOutside("narg", LIBRARY).status, REFERENCE.none);
  assert.equal(resolveOutside("", LIBRARY).status, REFERENCE.none);
  assert.equal(resolveOutside("trained", LIBRARY).status, REFERENCE.none);
  assert.equal(resolveOutside("quux", []).status, REFERENCE.none);
  assert.equal(resolveOutside("quux", null).status, REFERENCE.none);
});

t("parts: a word resolves, a linked part answers its link, a Role cell and a captive part are no reference", () => {
  const part = (key, source, role = "guard") => ({ key, role, source: { uuid: "", templateCell: "", stat: "", name: "", ...source } });
  const parts = [
    part("a", { name: "blue zorps" }),
    part("b", { name: "zorps" }),
    part("c", { name: "whatever", uuid: "L.hand" }),
    part("d", { templateCell: "alba|champion" }),
    part("e", { name: "enslaved folk" }, "captive"),
    part("f", {}),
  ];
  const out = resolveParts(parts, LIBRARY);
  assert.deepEqual(out.map((r) => r.part.key), ["a", "b", "c"]);
  assert.deepEqual(out.map((r) => [r.status, r.uuid]), [[REFERENCE.resolved, "L.zorpBlue"], [REFERENCE.partial, ""], [REFERENCE.resolved, "L.hand"]]);
});

/* -------------------------------------------- */
/*  The cells                                    */
/* -------------------------------------------- */

t("a beast cell reads its chance, count and word, whatever the filler word", () => {
  assert.deepEqual(readBeastCell("60% chance for 4d6 quuxes"), { kind: "beast", chance: 60, count: { dice: "4d6" }, word: "quuxes", perUnit: "" });
  assert.deepEqual(readBeastCell("50% chance 1d4+1 gleaves"), { kind: "beast", chance: 50, count: { dice: "1d4+1" }, word: "gleaves", perUnit: "" });
  assert.deepEqual(readBeastCell("3 zorps"), { kind: "beast", chance: null, count: { literal: 3 }, word: "zorps", perUnit: "" });
});

t("an extra-rank cell and a per-unit cell read to their kinds, and every other cell reads null", () => {
  assert.equal(readBeastCell("5d4 extra champions").kind, "extra");
  const per = readBeastCell("50% chance for 1d10 per band");
  assert.equal(per.kind, "perUnit");
  assert.equal(per.perUnit, "band");
  for (const none of ["None", "none", "-", "", null, undefined, "75% chance (level 1d6)", "100% (fight as qq)", "100% (do not fight)", "plain words"]) {
    assert.equal(readBeastCell(none), null, `${none} is no beast cell`);
  }
});

t("a beast cell becomes a part of the table's own, its word kept and no uuid", () => {
  const p = beastCellPart({ key: "village-beast-1", text: "60% chance for 2d6 zorps", variant: "alba", units: ["hamlet"], cite: "XX p. 9" });
  assert.equal(p.basis, "table");
  assert.equal(p.role, "guard");
  assert.deepEqual([p.source.name, p.source.uuid, p.source.templateCell], ["zorps", "", ""]);
  assert.equal(p.count.dice, "2d6");
  assert.equal(p.chance, 60);
  assert.deepEqual(p.when.units, ["hamlet"]);
  assert.equal(p.cite, "XX p. 9");
});

t("an extra-rank cell names the breed's Role cell, and a cell that is no beast makes no part", () => {
  const p = beastCellPart({ key: "k", text: "5d4 extra champions", variant: "alba", units: ["hamlet"] });
  assert.equal(p.source.templateCell, "alba|champion");
  assert.equal(p.source.name, "");
  assert.equal(beastCellPart({ key: "k", text: "5d4 extra zorp-lords", variant: "alba", units: [] }), null, "a rank the importer's vocabulary does not know");
  assert.equal(beastCellPart({ key: "k", text: "50% chance for 1d10 per band", variant: "alba", units: [] }), null);
  assert.equal(beastCellPart({ key: "k", text: "None", variant: "alba", units: [] }), null);
});

t("a mount cell names the creature a breed rides, or the one fighting beside it, or none", () => {
  const row = { mounts: { alba: "gleaves" }, alongside: { brex: "zorps" } };
  assert.deepEqual(readMountCell(row, "alba"), { word: "gleaves", rides: true });
  assert.deepEqual(readMountCell(row, "brex"), { word: "zorps", rides: false });
  assert.equal(readMountCell(row, "cyth"), null);
  assert.equal(readMountCell(null, "alba"), null);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-organisation-logic: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
