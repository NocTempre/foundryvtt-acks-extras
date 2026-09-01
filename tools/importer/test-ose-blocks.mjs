/**
 * Stat-block locator tests.
 *
 * Pages are built here rather than read from a PDF, so the geometry under test
 * is explicit and no third-party content enters the repo. The layouts are the
 * ones that actually break naive extraction: a block set beside the facing
 * column's prose, two blocks side by side, a block with no blank line above or
 * below it, and a block from a different game.
 */
import { findStatBlocks, joinBlockRuns, looksNonDescending, unknownLabels } from "../../scripts/importer/ose-blocks.mjs";
import { parseOseStatline, resolveProfile } from "../../scripts/importer/ose-statline.mjs";

let failed = 0;
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};

/**
 * Lay a line out as separate runs at a given x, the way a PDF emits it: one
 * run per word-ish token, with gaps and NO space characters anywhere.
 */
function line(x, y, ...tokens) {
  const items = [];
  let cx = x;
  for (const t of tokens) {
    const w = t.length * 4.2;
    items.push({ x: cx, y, w, h: 9, str: t });
    cx += w + 3; // a gap the joiner must read as a space
  }
  return items;
}
const page = (...groups) => ({ items: groups.flat(), width: 612, height: 792 });

/**
 * Ordinary prose lines down a column. Column detection reads a histogram of
 * left edges, so a page needs a column's worth of them before it has a column
 * at all — a fixture of two lines is not a page, and testing against one would
 * be testing something the locator never sees.
 */
const filler = (x, y0, n = 25) =>
  Array.from({ length: n }, (_, i) => line(x, y0 + i * 12, "the chamber is quiet and the dust lies thick")).flat();

/* --- spaces are reconstructed from gaps ---------------------------------- */

check("gaps become spaces", joinBlockRuns(line(40, 100, "AC", "9", "[10],", "HD", "1")), "AC 9 [10], HD 1");

// A hyphen ending a line, continued in lower case, is a broken word.
check(
  "line-break hyphen is closed up",
  joinBlockRuns([...line(40, 100, "SV", "D13", "(Mag-"), ...line(40, 112, "ic-user", "1)")]),
  "SV D13 (Magic-user 1)",
);
// A hyphen followed by a capital is punctuation and must survive.
check(
  "a real hyphen survives",
  joinBlockRuns([...line(40, 100, "AC", "9", "-"), ...line(40, 112, "Neutral")]),
  "AC 9 - Neutral",
);

/* --- a block beside the facing column's prose ----------------------------- */

const besideProse = page(
  filler(40, 200), filler(320, 200),
  line(40, 100, "AC", "5", "[14],", "HD", "2", "(9hp),", "Att", "1", "x", "claw", "(1d4),"),
  line(40, 112, "THAC0", "18", "[+1],", "MV", "120", "(40),", "ML", "6,", "AL", "Neutral,", "XP", "20"),
  // Facing column: ordinary prose on the SAME baselines.
  line(320, 100, "The", "cistern", "is", "half", "full", "of", "brackish", "water", "and"),
  line(320, 112, "something", "beneath", "the", "surface", "is", "watching", "the", "party."),
);
const beside = findStatBlocks(besideProse);
check("one candidate beside prose", beside.length, 1);
ok("the prose is not in it", !beside[0].text.includes("cistern"), beside[0].text);
check("and it reads", parseOseStatline(beside[0].text).fields.ml, 6);

/* --- two blocks side by side --------------------------------------------- */

const sideBySide = page(
  filler(40, 200), filler(320, 200),
  line(40, 100, "AC", "5", "[14],", "HD", "2", "(9hp),", "ML", "6,", "AL", "Neutral,", "XP", "20"),
  line(320, 100, "AC", "3", "[16],", "HD", "5", "(22hp),", "ML", "9,", "AL", "Chaotic,", "XP", "175"),
);
const pair = findStatBlocks(sideBySide);
check("two side-by-side blocks split", pair.length, 2);
check("left block hit dice", parseOseStatline(pair[0].text).fields.hd.count, 2);
check("right block hit dice", parseOseStatline(pair[1].text).fields.hd.count, 5);
ok("neither is marked merged", pair.every((c) => !c.mergedBlocks));

/* --- a block wedged between paragraphs, no blank line -------------------- */

const wedged = page(
  filler(40, 200),
  line(40, 88, "A", "squat", "grey", "thing", "that", "lurks", "in", "the", "cistern."),
  line(40, 100, "AC", "5", "[14],", "HD", "2", "(9hp),", "ML", "6,", "AL", "Neutral,", "XP", "20"),
  line(40, 112, "It", "hums", "to", "itself", "and", "hates", "the", "light", "above", "all."),
);
const wedgedFound = findStatBlocks(wedged);
check("the wedged block is found alone", wedgedFound.length, 1);
ok("the paragraph above is excluded", !wedgedFound[0].text.includes("squat"), wedgedFound[0].text);
ok("the paragraph below is excluded", !wedgedFound[0].text.includes("hums"), wedgedFound[0].text);

/* --- a label with no space before its value ------------------------------ */

// Typesetting sometimes leaves no gap at all; the label must still be seen.
const tight = page(filler(40, 200), [
  { x: 40, y: 100, w: 12, h: 9, str: "AC" },
  { x: 52, y: 100, w: 8, h: 9, str: "5" },
  { x: 61, y: 100, w: 20, h: 9, str: "[14]," },
  { x: 84, y: 100, w: 12, h: 9, str: "HD" },
  { x: 96, y: 100, w: 8, h: 9, str: "2" },
  { x: 106, y: 100, w: 14, h: 9, str: "," },
  { x: 121, y: 100, w: 12, h: 9, str: "ML" },
  { x: 133, y: 100, w: 8, h: 9, str: "6" },
]);
const tightFound = findStatBlocks(tight);
check("a tight-set line is still a block", tightFound.length, 1);
check("and its morale reads", parseOseStatline(tightFound[0].text).fields.ml, 6);

/* --- prose alone is never a block ---------------------------------------- */

const proseOnly = page(
  filler(40, 200),
  line(40, 100, "The", "chamber", "is", "empty", "but", "for", "a", "broken", "chair."),
  line(40, 112, "A", "draught", "moves", "the", "dust", "in", "slow", "circles."),
);
check("prose yields no candidates", findStatBlocks(proseOnly).length, 0);

/* --- another game's stat block is refused, not inverted ------------------- */

ok(
  "ascending block with modifier scores is suspect",
  looksNonDescending("AC 13, HP 14, ATK 2 claw +2 (1d6), MV near, S +1, D +2, C +1, I -2, W +0, CH -1, AL N, LV 3"),
);
ok(
  "a descending block is not suspect",
  !looksNonDescending("AC 7 [12], HD 2 (9hp), THAC0 18 [+1], MV 120 (40), ML 7, AL Neutral, XP 25"),
);
const foreign = page(
  filler(40, 200),
  line(40, 100, "AC", "13,", "HP", "14,", "ATK", "2", "claw", "+2", "(1d6),", "MV", "near,"),
  line(40, 112, "S", "+1,", "D", "+2,", "C", "+1,", "I", "-2,", "W", "+0,", "CH", "-1,", "AL", "N,", "LV", "3"),
);
const foreignFound = findStatBlocks(foreign);
ok("the foreign block is flagged", foreignFound.every((c) => c.suspectLineage), JSON.stringify(foreignFound.map((c) => c.text)));

/* --- two blocks the geometry cannot separate are marked ------------------ */

// A narrow block set INSIDE a prose column shares baselines with the prose and
// with its neighbour; the page-wide histogram cannot see the sub-column. The
// locator must say so rather than offer a confident reading of two creatures
// mixed together.
const insetX = 40;
const inset = page(
  filler(insetX, 200),
  line(insetX, 100, "AC", "6", "[13],", "HD", "1", "(4hp),", "ML", "7,", "AL", "Neutral,", "XP", "10"),
  line(insetX, 112, "AC", "8", "[11],", "HD", "3", "(13hp),", "ML", "9,", "AL", "Chaotic,", "XP", "50"),
);
const insetFound = findStatBlocks(inset);
ok("a doubled armour class marks the candidate", insetFound.some((c) => c.mergedBlocks), JSON.stringify(insetFound.map((c) => c.mergedBlocks)));

/* --- a per-source dialect changes only that source ------------------------ */

const dialectPage = page(
  filler(40, 200),
  line(40, 100, "AC", "7", "[12],", "HIT", "DICE", "1", "(4hp),", "ATT", "1", "x", "bite", "(1d4),"),
  line(40, 112, "THAC0", "17", "[+2],", "MV", "90", "(30),", "SV", "14,", "ML", "7,", "AL", "Neutral,", "XP", "13"),
);
const withDialect = findStatBlocks(dialectPage, resolveProfile({ base: "ose.demo", labels: { hd: ["HIT DICE"], att: ["ATT"] } }));
check("the dialect finds its block", withDialect.length, 1);
check("and reads its hit dice", parseOseStatline(withDialect[0].text, resolveProfile({ labels: { hd: ["HIT DICE"], att: ["ATT"] } })).fields.hd.count, 1);

/* --- never throws --------------------------------------------------------- */

for (const bad of [null, undefined, {}, { items: [] }, { items: [{ x: 0, y: 0, h: 9, str: "" }] }]) {
  try {
    findStatBlocks(bad);
  } catch (e) {
    console.error(`FAIL findStatBlocks threw on ${JSON.stringify(bad)} — ${e.message}`);
    failed++;
  }
}


/** A page headed with a word the canonical profile does not know. The word is
 * invented on purpose: a real one keeps getting promoted into the canon by the
 * corpus, and this test is about DETECTING the unknown, not about any label. */
function pageWithUnknownLabel() {
  return page(
    filler(40, 200),
    line(40, 100, "AC", "7", "[12],", "VITALITY", "1", "(4hp),", "Att", "1", "x", "bite", "(1d4),"),
    line(40, 112, "THAC0", "17", "[+2],", "MV", "90", "(30),", "ML", "7,", "AL", "Neutral,", "XP", "13"),
  );
}

/* --- calibration actually detects an unknown label ------------------------ */

// Found live: this returned nothing on EVERY page, including clean ones, so the
// calibration prompt never fired for any book. The cause was passing a
// one-label profile into the block finder — but a candidate needs several
// distinct labels before it counts as a block at all, so the narrowed profile
// matched nothing anywhere.
{
  const page = pageWithUnknownLabel();
  const found = findStatBlocks(page);
  ok("the block is still found with the canonical profile", found.length === 1, JSON.stringify(found.map((c) => c.text)));

  const unknown = unknownLabels(page);
  ok(
    "the unfamiliar label is reported",
    unknown.some((u) => u.label.toUpperCase() === "VITALITY"),
    JSON.stringify(unknown),
  );
  // A page whose labels are all known must stay quiet, or every import nags.
  const known = unknownLabels(sideBySide);
  ok("a fully-understood page reports nothing", known.length === 0, JSON.stringify(known));
}

if (failed) {
  console.error(`\nose-blocks: ${failed} failure(s)`);
  process.exit(1);
}
console.error("ose-blocks: OK");
