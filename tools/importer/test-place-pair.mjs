/**
 * A place two books print, held to one result whichever book lands first.
 *
 * The later book arriving second takes the earlier book's place over; the
 * earlier book arriving second binds onto the later book's. Both are pure
 * payloads (`takeoverPatch`, `bindPatch`), applied here to stored data the way
 * an update writes dotted keys, so the two orders can be compared whole. The
 * notes are the hard half: the module's blocks are swapped and filtered, and a
 * Judge's own writing beside them has to survive both orders byte for byte.
 *
 * Every book, id, name and paragraph here is invented (books `ea` earlier, `lb`
 * later); no printed word or number appears.
 */
import assert from "node:assert/strict";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";
import { bookText, bookTextBlock, insertBookTextAfter, keepParagraphs, swapBookText } from "../../scripts/importer/prose.mjs";
import { poiLocationData } from "../../scripts/importer/poi-binding.mjs";
import { answersFor, bindPatch, claimIds, placePairs, takeoverPatch } from "../../scripts/importer/place-pair.mjs";

let pass = 0;
const ok = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepEqual(got, want, label);
  pass++;
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

const E = { id: "ea.place1", book: "ea", name: "Old Keep", region: "Book EA", parentUuid: "Actor.eaBook" };
const L = { id: "lb.site9", book: "lb", name: "The Keep", region: "Book LB", parentUuid: "Actor.lbRegion" };
const ePara = ["Earlier opening.", "Earlier detail only it prints.", "Earlier closing."];
const lPara = ["Later opening.", "Later detail."];
const eBlock = bookText(ePara, "EA 3", { id: E.id, book: "ea", page: 5 });
const lBlock = bookText(lPara, "LB 7", { id: L.id, book: "lb", page: 9 });
const judge = "<p>The Judge's own line.</p>";
const roster = [{ uuid: "Actor.guard", quantity: 4 }];

const built = (row, notes, extra = {}) =>
  poiLocationData({ name: row.name, entryId: row.id, notes, book: row.book, bookLabel: row.region, parentUuid: row.parentUuid, folderId: `F.${row.book}`, ...extra });

/* --- the pair is found from either row --- */

const pairs = placePairs(new Map([
  ["ea", { entries: { [E.id]: { kind: "kind.location", meta: { sameAs: L.id, unique: [2] } }, "ea.place2": { kind: "kind.location" } } }],
  ["lb", { entries: { [L.id]: { kind: "kind.location" } } }],
]));
eq("the pair answers from the earlier row", pairs.get(E.id), { earlier: E.id, later: L.id, unique: [2] });
ok("and from the later row, the same pair", pairs.get(L.id) === pairs.get(E.id));
ok("a row with no sameAs is in no pair", !pairs.has("ea.place2"));

/* --- the stamped notes --- */

ok("a block is found by its entry id", bookTextBlock(`${judge}${eBlock}`, E.id) === eBlock);
ok("and not by another's", bookTextBlock(eBlock, L.id) === "");
eq("swapping keeps every byte around the block", swapBookText(`${judge}${eBlock}<p>tail</p>`, E.id, lBlock), `${judge}${lBlock}<p>tail</p>`);
eq("with no block held, the new one leads", swapBookText(judge, E.id, lBlock), `${lBlock}${judge}`);
eq("an insert lands straight after the named block", insertBookTextAfter(`${lBlock}${judge}`, L.id, eBlock), `${lBlock}${eBlock}${judge}`);
eq("with the named block gone, the insert leads", insertBookTextAfter(judge, L.id, eBlock), `${eBlock}${judge}`);
eq("a block kept to its unique paragraphs is the block those paragraphs build", keepParagraphs(eBlock, [2]),
  bookText([ePara[1]], "EA 3", { id: E.id, book: "ea", page: 5 }));
eq("kept to none, it is its citation line alone", keepParagraphs(eBlock, []), bookText([], "EA 3", { id: E.id, book: "ea", page: 5 }));
eq("an ordinal past the last paragraph keeps nothing more", keepParagraphs(eBlock, [3, 9]),
  bookText([ePara[2]], "EA 3", { id: E.id, book: "ea", page: 5 }));
eq("no block, nothing kept", keepParagraphs("", [1]), "");

/* --- the later book arrives second: it takes the place over --- */

const eHeld = { ...built(E, `${eBlock}${judge}`, { roster }), uuid: "Actor.place" };
const later = { ...L, notes: lBlock, role: "gate" };
const earlier = { id: E.id, parentUuid: E.parentUuid, region: E.region, unique: [2] };
const taken = applied(eHeld, takeoverPatch(eHeld, later, earlier));
const tFlag = taken.flags[MODULE_ID].cookbook;
eq("the place takes the later id and book", [tFlag.id, tFlag.book], [L.id, L.book]);
eq("and answers for the earlier id", tFlag.merged, [E.id]);
ok("so a lookup by either id finds it", answersFor(tFlag, E.id) && answersFor(tFlag, L.id) && !answersFor(tFlag, "ea.place2"));
eq("claimIds lists its own id, then the merged", claimIds(tFlag), [L.id, E.id]);
eq("its name is the later book's read name", [taken.name, tFlag.printed], [L.name, L.name]);
eq("its notes are the later block, the earlier block's unique paragraph, then the Judge's line",
  taken.system.notes, `${lBlock}${keepParagraphs(eBlock, [2])}${judge}`);
eq("its parent and region follow the later book", [taken.system.parentUuid, taken.system.region], [L.parentUuid, L.region]);
eq("its roster, folder and image stay", [taken.system.roster, taken.folder, taken.img], [roster, eHeld.folder, eHeld.img]);
eq("an empty role is filled", taken.system.role, "gate");

const renamed = { ...eHeld, name: "Judge's Keep" };
ok("a place the Judge renamed keeps its name", !("name" in takeoverPatch(renamed, later, earlier)));
const moved = { ...eHeld, system: { ...eHeld.system, parentUuid: "Actor.judgesChoice", region: "Judge's region" } };
const movedPatch = takeoverPatch(moved, later, earlier);
ok("a place the Judge moved keeps its parent and region", !("system.parentUuid" in movedPatch) && !("system.region" in movedPatch));
const roled = { ...eHeld, system: { ...eHeld.system, role: "gate" } };
ok("a set role is not written", !("system.role" in takeoverPatch(roled, { ...later, role: "gate" }, earlier)));
eq("unique: [] leaves the earlier block its citation line alone",
  applied(eHeld, takeoverPatch(eHeld, later, { ...earlier, unique: [] })).system.notes, `${lBlock}${keepParagraphs(eBlock, [])}${judge}`);
const blockGone = { ...eHeld, system: { ...eHeld.system, notes: judge } };
eq("a place whose earlier block is gone gets the later block first",
  applied(blockGone, takeoverPatch(blockGone, later, earlier)).system.notes, `${lBlock}${judge}`);
ok("a place is never made its own parent", !("system.parentUuid" in takeoverPatch(eHeld, { ...later, parentUuid: "Actor.place" }, earlier)));

/* --- the earlier book arrives second: it binds onto the later place --- */

const lHeld = { ...built(L, `${lBlock}${judge}`, { role: "gate" }), uuid: "Actor.place" };
const bound = applied(lHeld, bindPatch(lHeld, { id: E.id, notes: keepParagraphs(eBlock, [2]), parentUuid: E.parentUuid, roster }));
const bFlag = bound.flags[MODULE_ID].cookbook;
eq("the place keeps the later id, book and name", [bFlag.id, bFlag.book, bound.name], [L.id, L.book, L.name]);
eq("and answers for the earlier id", bFlag.merged, [E.id]);
eq("the earlier block's unique paragraph follows the later block, before the Judge's line",
  bound.system.notes, `${lBlock}${keepParagraphs(eBlock, [2])}${judge}`);
eq("its parent stays the later book's", bound.system.parentUuid, L.parentUuid);
eq("an empty roster is filled from the earlier book", bound.system.roster, roster);
eq("a second bind adds nothing", bindPatch(bound, { id: E.id, notes: keepParagraphs(eBlock, [2]), parentUuid: E.parentUuid, roster }), {});

/* --- both orders, one place --- */

// Folder and document id are where each order's place was first made, and stay
// (the ruling keeps them); every other field is compared.
const shape = (doc) => {
  const { folder: _f, uuid: _u, ...rest } = doc;
  return rest;
};
for (const unique of [[2], [], [1, 3]]) {
  const eFirst = { ...built(E, `${eBlock}${judge}`, { roster }), uuid: "Actor.a" };
  const lSecond = applied(eFirst, takeoverPatch(eFirst, later, { ...earlier, unique }));
  const lFirst = { ...built(L, `${lBlock}${judge}`, { role: "gate" }), uuid: "Actor.b" };
  const eSecond = applied(lFirst, bindPatch(lFirst, { id: E.id, notes: keepParagraphs(eBlock, unique), parentUuid: E.parentUuid, roster }));
  eq(`unique ${JSON.stringify(unique)}: both orders reach the same place`, shape(lSecond), shape(eSecond));
}

console.log(`test-place-pair: ${pass} checks passed.`);
