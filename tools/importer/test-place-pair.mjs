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
import { blockDigest, bookText, bookTextBlock, insertBookTextAfter, keepParagraphs, sumKey, swapBookText } from "../../scripts/importer/prose.mjs";
import { withBlockSums } from "../../scripts/importer/refresh.mjs";
import { poiLocationData } from "../../scripts/importer/poi-binding.mjs";
import { answersFor, bindPatch, claimIds, placePairs, rowBlockPatch, siteNamePatch, takeoverPatch } from "../../scripts/importer/place-pair.mjs";
import { blockSum, decides } from "../../scripts/importer/held-edits.mjs";

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
const columns = placePairs(new Map([
  ["ea", { entries: { "ea.grid": { kind: "kind.marketGrid", meta: { markets: { mkt1: { sameAs: "lb.mkt4" }, mkt2: { place: "ea.place2" } } } } } }],
]));
eq("a grid column pairs its market id, under the book that holds the grid, with no paragraphs of its own",
  columns.get("lb.mkt4"), { earlier: "ea.mkt1", later: "lb.mkt4", unique: [] });
ok("and is found from that id too", columns.get("ea.mkt1") === columns.get("lb.mkt4"));
ok("a column naming a place of its own book is in no pair", !columns.has("ea.mkt2") && !columns.has("ea.place2"));

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

// A place stamped as its create wrote it: the takeover swaps the earlier block
// for a shorter one, and records the digests of what it wrote so the old sum of
// the earlier block does not read the kept paragraphs as a Judge's edit.
const eStamped = { ...withBlockSums(eHeld), uuid: "Actor.stamped" };
const takenStamped = applied(eStamped, takeoverPatch(eStamped, later, earlier));
eq("a takeover records the digest of each block it wrote",
  takenStamped.flags[MODULE_ID].cookbook.sums,
  { [sumKey("system.notes", L.id)]: blockDigest(lBlock), [sumKey("system.notes", E.id)]: blockDigest(keepParagraphs(eBlock, [2])) });
eq("so the earlier row's later repair finds its kept block unedited",
  rowBlockPatch(takenStamped, { id: E.id, notes: keepParagraphs(bookText(["Earlier opening.", "Earlier detail, reread.", "Earlier closing."], "EA 3", { id: E.id, book: "ea", page: 5 }), [2]), after: L.id }).edits, []);

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
  const eFirst = { ...withBlockSums(built(E, `${eBlock}${judge}`, { roster })), uuid: "Actor.a" };
  const lSecond = applied(eFirst, takeoverPatch(eFirst, later, { ...earlier, unique }));
  const lFirst = { ...withBlockSums(built(L, `${lBlock}${judge}`, { role: "gate" })), uuid: "Actor.b" };
  const eSecond = applied(lFirst, bindPatch(lFirst, { id: E.id, notes: keepParagraphs(eBlock, unique), parentUuid: E.parentUuid, roster }));
  eq(`unique ${JSON.stringify(unique)}: both orders reach the same place`, shape(lSecond), shape(eSecond));
}

/* --- a forced repair writes one row's block in place --- */

// The joined place as both orders leave it, with another row's block (a site
// bound onto it) and the Judge's line beside the pair's two blocks.
const other = bookText(["A bound site's text."], "LB 8", { id: "lb.site3", book: "lb", page: 10 });
const { sums: _takeoverSums, ...unstampedFlag } = taken.flags[MODULE_ID].cookbook;
const unstampedPlace = {
  ...taken,
  flags: { ...taken.flags, [MODULE_ID]: { ...taken.flags[MODULE_ID], cookbook: unstampedFlag } },
  system: { ...taken.system, notes: `${lBlock}${keepParagraphs(eBlock, [2])}${other}${judge}` },
};
// The same place once a forced repair has stamped each block it holds.
const SUMS = `flags.${MODULE_ID}.cookbook.sums`;
const sumOf = (id, text) => [`${SUMS}.${sumKey("system.notes", id)}`, blockDigest(text)];
const stamps = [[L.id, lBlock], [E.id, keepParagraphs(eBlock, [2])], ["lb.site3", other]].map(([id, text]) => sumOf(id, text));
const shared = applied(unstampedPlace, Object.fromEntries(stamps));
const sumsOf = (doc) => doc.flags[MODULE_ID].cookbook.sums;
const lFresh = bookText(["Later opening, reread.", "Later detail."], "LB 7", { id: L.id, book: "lb", page: 9 });
const eFresh = bookText(["Earlier opening.", "Earlier detail, reread.", "Earlier closing."], "EA 3", { id: E.id, book: "ea", page: 5 });
const count = (html, id) => String(html).split(`data-acks-entry="${id}"`).length - 1;

const write = (doc, row, opts) => {
  const { update, edits } = rowBlockPatch(doc, row, opts);
  return { doc: applied(doc, update), update, edits };
};

const lRun = write(shared, { id: L.id, name: L.name, notes: lFresh });
const lRepaired = lRun.doc;
eq("repairing the later book alone swaps its block, and every other byte of the notes stays",
  lRepaired.system.notes, `${lFresh}${keepParagraphs(eBlock, [2])}${other}${judge}`);
eq("the earlier book's block is byte-identical", bookTextBlock(lRepaired.system.notes, E.id), bookTextBlock(shared.system.notes, E.id));
eq("as is the bound site's", bookTextBlock(lRepaired.system.notes, "lb.site3"), other);
eq("the write is the notes and the block's read stamp: no id, merged, parent, roster or region",
  Object.keys(lRun.update), ["system.notes", sumOf(L.id, lFresh)[0]]);
eq("the stamp records the block written beside the others' stamps", sumsOf(lRepaired),
  { ...Object.fromEntries(stamps.map(([k, v]) => [k.slice(SUMS.length + 1), v])), [sumKey("system.notes", L.id)]: blockDigest(lFresh) });
eq("the place still answers for both rows", claimIds(lRepaired.flags[MODULE_ID].cookbook), [L.id, E.id]);
eq("a block that still matches its stamp is written, and nothing is held", lRun.edits, []);

const unstampedRun = write(unstampedPlace, { id: L.id, notes: lFresh, cite: "LB 7" });
eq("a block with no stamp, differing from the page, reads as unedited: it is written, and stamped",
  [unstampedRun.edits, bookTextBlock(unstampedRun.doc.system.notes, L.id), sumsOf(unstampedRun.doc)], [[], lFresh, { [sumKey("system.notes", L.id)]: blockDigest(lFresh) }]);
const sameRun = write(unstampedPlace, { id: L.id, notes: lBlock });
eq("one equal to the page is stamped, holding nothing", [sameRun.edits, sameRun.update], [[], Object.fromEntries([sumOf(L.id, lBlock)])]);

// What the editor does to a block without changing a word: attribute order, an
// anchor's href dropped, a reflowed line, a non-breaking space.
const reserialized = (block) =>
  block.replace(/<div class="([^"]*)" data-acks-entry="([^"]*)">/, '<div data-acks-entry="$2" class="$1">\n').replace(/ href="#"/g, "").replace(/<\/p>/g, "</p>\n").replace("Later opening.", "Later&nbsp;opening.");
const reflowed = reserialized(lBlock);
ok("the fixture's markup differs from the block but reads the same", reflowed !== lBlock && blockDigest(reflowed) === blockDigest(lBlock));
const reflowedPlace = applied(shared, { "system.notes": swapBookText(shared.system.notes, L.id, reflowed) });
const reflowedRun = write(reflowedPlace, { id: L.id, notes: lFresh });
eq("a stamped block the editor re-serialized, its words as written, is untouched and is rewritten",
  [reflowedRun.edits, bookTextBlock(reflowedRun.doc.system.notes, L.id)], [[], lFresh]);
const reflowedUnstamped = write(applied(unstampedPlace, { "system.notes": swapBookText(unstampedPlace.system.notes, L.id, reflowed) }), { id: L.id, notes: lBlock });
eq("one with no stamp that reads as the page's is rewritten, held for nothing", [reflowedUnstamped.edits, bookTextBlock(reflowedUnstamped.doc.system.notes, L.id)], [[], lBlock]);

// A raw checksum an older build left in `cookbook.blocks` is not read: with no digest stamp the block reads as unedited.
const legacyFlag = applied(unstampedPlace, { [`flags.${MODULE_ID}.cookbook.blocks`]: [{ id: L.id, sum: blockSum("never the stored bytes") }] });
const legacyRun = write(legacyFlag, { id: L.id, notes: lFresh });
eq("a place carrying only a raw checksum is written as one with no stamp", [legacyRun.edits, bookTextBlock(legacyRun.doc.system.notes, L.id)], [[], lFresh]);
ok("a stamped edit carries no unstamped mark", !("unstamped" in (write(applied(shared, { "system.notes": swapBookText(shared.system.notes, L.id, lFresh) }), { id: L.id, notes: lBlock }).edits[0] ?? { unstamped: 1 })));

const eRun = write(shared, { id: E.id, name: E.name, notes: keepParagraphs(eFresh, [2]), after: L.id });
eq("repairing the earlier book alone swaps its kept block in place",
  eRun.doc.system.notes, `${lBlock}${keepParagraphs(eFresh, [2])}${other}${judge}`);
eq("the later book's block is byte-identical", bookTextBlock(eRun.doc.system.notes, L.id), lBlock);
ok("a row that is not the place's own writes no name", !("name" in eRun.update) && !(`flags.${MODULE_ID}.cookbook.printed` in eRun.update));

eq("a second write of the same build owes nothing", write(lRepaired, { id: L.id, name: L.name, notes: lFresh }).update, {});
const both = write(lRepaired, { id: E.id, notes: keepParagraphs(eFresh, [2]), after: L.id }).doc;
ok("each row's block stands once after both books are repaired", count(both.system.notes, L.id) === 1 && count(both.system.notes, E.id) === 1);
eq("and each carries its own stamp", Object.keys(sumsOf(both)).sort(), [L.id, E.id, "lb.site3"].map((id) => sumKey("system.notes", id)).sort());

/* --- a Judge's edit is held, and written only where the caller takes it --- */

const touched = bookText(["Later opening, as the Judge has it.", "Later detail."], "LB 7", { id: L.id, book: "lb", page: 9 });
const edited = applied(lRepaired, { "system.notes": swapBookText(lRepaired.system.notes, L.id, touched) });
const lAgain = bookText(["Later opening, read a third time.", "Later detail."], "LB 7", { id: L.id, book: "lb", page: 9 });
const keyOf = `${shared.uuid}#system.notes#${L.id}`;
const heldRun = write(edited, { id: L.id, name: L.name, notes: lAgain, cite: "LB 7" });
eq("a block the Judge edited since its stamp is not written", heldRun.update, {});
eq("it is returned as an edit: the document, the field, the stored and page values, the page",
  heldRun.edits, [{ key: keyOf, uuid: shared.uuid, name: shared.name, path: `system.notes#${L.id}`, current: touched, page: lAgain, cite: "LB 7" }]);
eq("a decision that takes its key writes it", write(edited, { id: L.id, notes: lAgain }, { decision: { take: new Set([keyOf]) } }).doc.system.notes,
  `${lAgain}${keepParagraphs(eBlock, [2])}${other}${judge}`);
eq("as does taking every edit", write(edited, { id: L.id, notes: lAgain }, { decision: "take" }).edits, []);
eq("a decision naming it to keep, or naming other keys, keeps it",
  [write(edited, { id: L.id, notes: lAgain }, { decision: { keep: new Set([keyOf]), all: "take" } }).edits.length,
    write(edited, { id: L.id, notes: lAgain }, { decision: { take: new Set(["Actor.other#name"]) } }).edits.length], [1, 1]);
const eWhileEdited = write(edited, { id: E.id, notes: keepParagraphs(eFresh, [2]), after: L.id });
ok("the other book's row writes its own block beside the edit, holding nothing",
  eWhileEdited.edits.length === 0 && bookTextBlock(eWhileEdited.doc.system.notes, L.id) === touched);
eq("a block already holding the page's text is not an edit", write(edited, { id: L.id, notes: touched }).edits, []);

const reread = write(shared, { id: L.id, name: "The Reread Keep", notes: lFresh }).doc;
eq("the place's own row writes its new read name while the name is still the printed one",
  [reread.name, reread.flags[MODULE_ID].cookbook.printed], ["The Reread Keep", "The Reread Keep"]);
const judgeNamed = { ...shared, name: "Judge's Keep" };
const kept = write(judgeNamed, { id: L.id, name: "The Reread Keep", notes: lFresh });
ok("a name the Judge gave stands, and the printed record stays as it was",
  !("name" in kept.update) && !(`flags.${MODULE_ID}.cookbook.printed` in kept.update));
eq("and the rename is returned as an edit", kept.edits.map((e) => [e.path, e.current, e.page]), [["name", "Judge's Keep", "The Reread Keep"]]);
eq("taken, the read name replaces it", write(judgeNamed, { id: L.id, name: "The Reread Keep" }, { decision: "take" }).doc.name, "The Reread Keep");
// Two passes, as the merged command runs them: keep everything, then take what the Judge chose.
const keptPass = write(judgeNamed, { id: L.id, name: "The Reread Keep" }).doc;
const takenPass = write(keptPass, { id: L.id, name: "The Reread Keep" }, { decision: { take: new Set([`${judgeNamed.uuid}#name`]) } });
eq("a rename held on the first pass is listed again and written when the second pass takes it",
  [takenPass.doc.name, takenPass.doc.flags[MODULE_ID].cookbook.printed], ["The Reread Keep", "The Reread Keep"]);

const overview = bookText(["A quarter's overview."], "LB 2", { id: "lb.over", book: "lb", page: 3 });
const bare = { ...shared, system: { notes: judge } };
const beside = write(bare, { id: "lb.over", notes: overview });
eq("a row with no block yet is not written beside the Judge's own text", beside.update, {});
eq("it is held as an edit whose stored value is empty", beside.edits.map((e) => [e.path, e.current, e.page]), [["system.notes#lb.over", "", overview]]);
eq("taken, it leads the Judge's text", write(bare, { id: "lb.over", notes: overview }, { decision: "take" }).doc.system.notes, `${overview}${judge}`);
const erratum = bookText(["A correction."], "LB 99", { id: `${E.id}#erratum`, book: "lb", page: 99 });
eq("notes holding only the place's erratum note take it, leading", write({ ...shared, system: { notes: erratum } }, { id: "lb.over", notes: overview }).doc.system.notes,
  `${overview}${erratum}`);
const blocksOnly = { ...shared, system: { notes: `${lBlock}${keepParagraphs(eBlock, [2])}${other}` } };
const among = write(blocksOnly, { id: "lb.over", notes: overview, after: "lb.site3" });
eq("a row with no block on a place holding other rows' blocks is not written", among.update, {});
eq("it is held, its stored value empty", among.edits.map((e) => [e.path, e.current, e.unstamped]), [["system.notes#lb.over", "", undefined]]);
eq("taken, it lands after the block it names", write(blocksOnly, { id: "lb.over", notes: overview, after: "lb.site3" }, { decision: "take" }).update["system.notes"],
  `${lBlock}${keepParagraphs(eBlock, [2])}${other}${overview}`);
const foreignErratum = bookText(["A correction."], "LB 99", { id: "zz.other#erratum", book: "lb", page: 99 });
eq("another place's erratum note counts as another row's block", write({ ...shared, system: { notes: foreignErratum } }, { id: "lb.over", notes: overview }).edits.length, 1);
const gone = write({ ...lRepaired, system: { notes: `${keepParagraphs(eBlock, [2])}${other}` } }, { id: L.id, notes: lAgain });
eq("a block the Judge took out after its stamp is held, not put back", [gone.update, gone.edits.map((e) => [e.path, e.current])], [{}, [[`system.notes#${L.id}`, ""]]]);
const emptied = write({ ...lRepaired, system: { notes: "" } }, { id: L.id, notes: lAgain });
eq("even from notes the Judge emptied", [emptied.update, emptied.edits.length], [{}, 1]);
eq("a build with no notes writes none", write(shared, { id: "lb.over" }).update, {});

/* --- a market's name: the market step's read name stands, a site's heading fills only the neutral label --- */

{
  const MARKET = "lb.mkt4";
  const neutral = "Market Four";
  const marketPlace = (name, printed = name, extra = {}) => ({
    uuid: "Actor.mkt4", name, system: { notes: "" }, flags: { [MODULE_ID]: { cookbook: { id: MARKET, printed, ...extra } } },
  });
  const site = { id: MARKET, name: "Harbour Site", placeholder: neutral };
  const printedKey = `flags.${MODULE_ID}.cookbook.printed`;

  eq("a site's heading names a market place still holding the neutral label, and stamps it as printed",
    siteNamePatch(marketPlace(neutral), site), { name: "Harbour Site", [printedKey]: "Harbour Site" });
  eq("a name the market step read is not overwritten", siteNamePatch(marketPlace("Quay Exchange"), site), {});
  eq("nor is a Judge's rename of the neutral label", siteNamePatch(marketPlace("Judged", neutral), site), {});
  eq("nor the name of a place claimed under another id", siteNamePatch({ ...marketPlace(neutral), flags: { [MODULE_ID]: { cookbook: { id: "zz.mkt4", printed: neutral } } } }, site), {});
  eq("a place stamped before it recorded its printed name is left alone", siteNamePatch(marketPlace(neutral, null), site), {});
  eq("a site that read no heading names nothing", siteNamePatch(marketPlace(neutral), { ...site, name: "" }), {});
  eq("a second run finds the name already the site's", siteNamePatch(applied(marketPlace(neutral), siteNamePatch(marketPlace(neutral), site)), site), {});

  // Either order ends with the market step's read name, through the same rule a repair writes by.
  const step = (doc, name, opts) => rowBlockPatch(doc, { id: MARKET, name, cite: "LB 5" }, opts);
  const siteFirst = applied(marketPlace("Harbour Site"), {});
  eq("a place a site made first takes the market step's read name", applied(siteFirst, step(siteFirst, "Quay Exchange").update).name, "Quay Exchange");
  const afterFill = applied(marketPlace(neutral), siteNamePatch(marketPlace(neutral), site));
  eq("one a site filled takes it too", applied(afterFill, step(afterFill, "Quay Exchange").update).name, "Quay Exchange");
  const marketFirst = marketPlace("Quay Exchange");
  eq("a place the market step named first keeps it against the site", [applied(marketFirst, siteNamePatch(marketFirst, site)).name, step(marketFirst, "Quay Exchange").update], ["Quay Exchange", {}]);
  const reread = step(marketFirst, "Quay Bourse");
  eq("a repair that reads a different heading refreshes the name and its printed record", [applied(marketFirst, reread.update).name, applied(marketFirst, reread.update).flags[MODULE_ID].cookbook.printed], ["Quay Bourse", "Quay Bourse"]);
  const renamed = marketPlace("Judged", "Quay Exchange");
  eq("a Judge's rename stands against the market step and is listed as an edit",
    [step(renamed, "Quay Bourse").update, step(renamed, "Quay Bourse").edits.map((e) => [e.path, e.current, e.page])], [{}, [["name", "Judged", "Quay Bourse"]]]);
  eq("unless the decision takes it", applied(renamed, step(renamed, "Quay Bourse", { decision: "take" }).update).name, "Quay Bourse");
}

/* --- the decision and the checksum --- */

eq("no decision keeps", decides(null, "k"), "keep");
eq("a word decides every key", [decides("take", "k"), decides("keep", "k")], ["take", "keep"]);
eq("a key named to take is taken, the rest follow all", [decides({ take: new Set(["k"]) }, "k"), decides({ take: new Set(["k"]) }, "j"), decides({ all: "take" }, "j")],
  ["take", "keep", "take"]);
ok("the checksum tells two texts apart and agrees with itself", blockSum("a") !== blockSum("b") && blockSum("a") === blockSum("a") && /^[0-9a-f]{8}$/.test(blockSum("")));

console.log(`test-place-pair: ${pass} checks passed.`);
