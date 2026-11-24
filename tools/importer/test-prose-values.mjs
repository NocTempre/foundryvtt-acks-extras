/**
 * The `quantity` reading of a prose value: a figure with its floor and its
 * rate, in the one shape `lib/tables.mjs` `quantity` reads back.
 *
 * Every sentence below is INVENTED — no page is reproduced. What this pins is
 * the reading: a sign carried, a "+" after the figure read as a floor and one
 * before another figure read as arithmetic, "or more" read as a floor, and a
 * "per" always yielding a unit, so a rate is never counted once.
 *
 * Also the reading of a modifier list: the `signed` take, which reads only a
 * figure carrying its sign, and `label: true`, which lifts the row's own
 * wording from between the row edges either side of the anchor. And the
 * `num`, `rollFormula` and `fractionWord` takes.
 */
import assert from "node:assert";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { printKey } from "../../scripts/importer/printed-name.mjs";
import { quantity, scaleQuantity } from "../../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

/** One line per item, stacked down a single column. */
const page = (lines) => lines.map((str, i) => ({ x: 100, y: 100 + i * 12, str }));
const read = (lines, values) => extractTable(page(lines), { shape: "proseValues", column: { xMin: 20, xMax: 600 }, values });

const got = read(
  [
    "The raider gains +2 per banner, and more besides.",
    "A hold of 4+ towers is counted a fortress.",
    "If 7 or more packs gather, the valley empties.",
    "A lame mule suffers -3 to every march.",
    "The ferryman rolls 2 + 1 dice for the crossing.",
    "A guide asks 5 silver per long winding day of travel.",
  ],
  [
    { key: "banner", find: "gains", take: "quantity" },
    { key: "towers", find: "a hold of", take: "quantity" },
    { key: "packs", find: "if", take: "quantity" },
    { key: "lame", find: "suffers", take: "quantity" },
    { key: "ferry", find: "rolls", take: "quantity" },
    { key: "guide", find: "asks", take: "quantity" },
  ],
);

check("a rate carries its figure and its unit", got.banner?.value === 2 && got.banner.per === "banner" && !got.banner.atLeast);
check("a trailing + is a floor", got.towers?.value === 4 && got.towers.atLeast === true && !got.towers.per);
check("or more is a floor", got.packs?.value === 7 && got.packs.atLeast === true);
check("a minus sign is carried", got.lame?.value === -3 && !got.lame.atLeast && !got.lame.per);
check("a + before another figure is arithmetic, not a floor", got.ferry?.value === 2 && !got.ferry.atLeast);
check("a long unit is cut at three words, never dropped", got.guide?.value === 5 && got.guide.per === "long winding day");

// What the extractor writes is what the lib reads back.
check("the lib reads the stored shape back", quantity(got.towers)?.atLeast === true && quantity(got.lame)?.value === -3);
check("a rate scales by its count", scaleQuantity(got.banner, 3) === 6 && scaleQuantity(got.lame, 3) === -3);

const none = read(["Nothing here is counted."], [{ key: "x", find: "nothing", take: "quantity" }]);
check("a window with no figure yields no value", !("x" in none));

/* --- a modifier list: the signed figure of a row, and the row's own wording --- */

// A list that prints each figure AFTER its wording, behind a bullet. A symbol
// font's bullet arrives as a C1 control as readily as U+2022.
const after = read(
  [
    "When the kettle boils, apply these:",
    "\u008D The cook has burned 1/3 or more of the loaves -3",
    "\u008D The cook has burned 3/4 or more of the loaves -6",
    "• Guests outnumber chairs by 3:1 or more +4",
    "• The cellar is dry +0",
    "Afterwards the hall is swept.",
  ],
  [
    { key: "burn1", find: "of the loaves", occurrence: 1, take: "signed", span: 8, label: true },
    { key: "burn2", find: "of the loaves", occurrence: 2, take: "signed", span: 8, label: true },
    { key: "chairs", find: "guests outnumber chairs", take: "signed", span: 30, label: true },
    { key: "cellar", find: "the cellar is dry", take: "signed", span: 8, label: true },
  ],
);
check("a row's signed figure is read past the fraction it is worded with", after.burn1 === -3 && after.burn2 === -6);
check("a ratio in the wording is not the figure", after.chairs === 4);
check("a printed zero is a figure", after.cellar === 0);
check("a row's wording runs from its bullet to its figure, as printed", after.burn1Label === "The cook has burned 1/3 or more of the loaves");
check("the rungs of one ladder keep their own wording", after.burn2Label === "The cook has burned 3/4 or more of the loaves");
check("the wording keeps what follows the anchor", after.chairsLabel === "Guests outnumber chairs by 3:1 or more");

// A grid that prints each figure BEFORE its wording. Small caps split a row's
// first letter into its own lowercase run.
const before = read(
  ["+3 Baker alongside the apprentice at the oven", "+0 o ther bakers at the oven", "-2 t he apprentice alone at the oven"],
  [
    { key: "baker", find: "baker alongside", before: true, take: "signed", span: 10, label: true },
    { key: "others", find: "ther bakers", before: true, take: "signed", span: 10, label: true },
    { key: "alone", find: "he apprentice alone", before: true, take: "signed", span: 10, label: true },
  ],
);
check("a figure before its wording is the nearest one behind the anchor", before.baker === 3 && before.others === 0 && before.alone === -2);
check("the wording runs from its figure to the next row's", before.bakerLabel === "Baker alongside the apprentice at the oven");
check("a small-caps initial is rejoined and capitalized", before.othersLabel === "Other bakers at the oven");
check("the row that ends the page runs to the end of the text", before.aloneLabel === "The apprentice alone at the oven");

const bare = read(["The door is worth +5 to the knock."], [{ key: "door", find: "the door is worth", take: "signed", label: true }]);
check("a figure with no row edge before it keeps its value and takes no label", bare.door === 5 && !("doorLabel" in bare));

const unsigned = read(["The gate stands 7 high."], [{ key: "gate", find: "the gate stands", take: "signed" }]);
check("a bare number is not a signed figure", !("gate" in unsigned));

/* --- decimals, a die as Foundry rolls it, and a share in words --------------- */

const forms = read(
  [
    "The weaver keeps 7.25% of the bolt, and the dyer 1,250.5 coins over 0.4 of a season.",
    "Each spring the orchard throws 2d8! for its yield, and the hives 1d6.",
    "A wall at least two thirds its height holds; one at a quarter falls; at half it sags.",
  ],
  [
    { key: "keeps", find: "the weaver keeps", take: "num", span: 8 },
    { key: "dyer", find: "the dyer", take: "num", span: 10 },
    { key: "season", find: "coins over", take: "num", span: 5 },
    { key: "seasonBefore", find: "of a season", before: true, take: "num", span: 30 },
    { key: "orchard", find: "the orchard throws", take: "rollFormula", span: 6 },
    { key: "hives", find: "the hives", take: "rollFormula", span: 5 },
    { key: "orchardDice", find: "the orchard throws", take: "dice", span: 6 },
    { key: "holds", find: "at least", take: "fractionWord", span: 15 },
    { key: "falls", find: "one at", take: "fractionWord", span: 10 },
    { key: "sags", find: "falls; at", take: "fractionWord", span: 6 },
  ],
);
check("a decimal reads whole, with or without separators", forms.keeps === 7.25 && forms.dyer === 1250.5 && forms.season === 0.4);
check("a before-window decimal is the last figure behind the anchor", forms.seasonBefore === 0.4);
check("an exploding mark is Foundry's x; a plain die stays plain", forms.orchard === "2d8x" && forms.hives === "1d6");
check("dice still reads past the mark", forms.orchardDice === "2d8");
check("a share in words is its fraction", forms.holds === 2 / 3 && forms.falls === 0.25 && forms.sags === 0.5);

// The sizeList take: the size words of the clause, up to the word that ends it.
const sizes = read(
  [
    "A reaver striking with mini, little, or middling blades uses the quick form.",
    "A mason carrying tiny, small, or large tools and, separately, a huge anvil.",
    "A cook ladling a tiny spoon, a tiny spoon, and a medium spoon, then weapons of large size.",
    "A scribe uses neither.",
  ],
  [
    { key: "none", find: "a reaver striking with", take: "sizeList", span: 60 },
    { key: "mason", find: "a mason carrying", take: "sizeList", span: 60 },
    { key: "cook", find: "a cook ladling", take: "sizeList", span: 100 },
    { key: "scribe", find: "a scribe uses", take: "sizeList", span: 30 },
  ],
);
check("a clause naming no size reads nothing", sizes.none === undefined && sizes.scribe === undefined);
check("sizes read in order, a word outside the size vocabulary skipped", JSON.stringify(sizes.mason) === JSON.stringify(["tiny", "small", "large"]));
check("a size is listed once, and words after the list's end are not read", JSON.stringify(sizes.cook) === JSON.stringify(["tiny", "medium"]));

/* --- the nounList take: a comma list cut where the clause after it begins --- */

const nouns = read(
  [
    "A porter fetches a crate, hamper, or sack and stows it. (A runner fetching a wicker basket, lantern case, pouch, hook, or flask does not pause.)",
    "A hawker names a lone cart and nothing more.",
    "A clerk files the writs.",
  ],
  [
    { key: "stowed", find: "a porter fetches", take: "nounList", until: "\\s+and\\s+stows", span: 80 },
    { key: "unpausing", find: "a runner fetching", take: "nounList", until: "\\s+(?:does|do)\\s+not\\b", span: 100 },
    { key: "alone", find: "a hawker names", take: "nounList", until: "\\s+and\\s+nothing", span: 40 },
    { key: "uncut", find: "a clerk files", take: "nounList", span: 30 },
    { key: "absent", find: "a clerk burns", take: "nounList", span: 30 },
    { key: "uncutEnd", find: "a porter fetches", take: "nounList", until: "\s+and\s+sweeps", span: 80 },
  ],
);
check("a list reads in order, the leading article and the final 'or' dropped", JSON.stringify(nouns.stowed) === JSON.stringify(["crate", "hamper", "sack"]));
check("a list ends at its cut and keeps a two-word noun whole", JSON.stringify(nouns.unpausing) === JSON.stringify(["wicker basket", "lantern case", "pouch", "hook", "flask"]));
check("one noun is a list of one", JSON.stringify(nouns.alone) === JSON.stringify(["lone cart"]));
check("with no cut the window's words are read to its end", Array.isArray(nouns.uncut) && nouns.uncut[0] === "writs");
check("an anchor the page does not hold reads nothing", !("absent" in nouns));
check("a cut the window does not hold reads nothing, never the whole window", !("uncutEnd" in nouns));

/* --- a word named by its key: `findKey` finds it and `take: "anchor"` reads it as printed --- */

// The words are invented; the recipe holds only their keys, computed here.
const guild = read(
  [
    "In the marches the Quillwright guild, making up about 12% of folk, keeps the ledgers.",
    "Another 30% of folk are Tallowmen, and the Quillwright (see above) hold the largest share.",
  ],
  [
    { key: "firstWord", findKey: printKey("Quillwright"), take: "anchor" },
    { key: "secondWord", findKey: printKey("Quillwright"), occurrence: 2, take: "anchor" },
    { key: "otherWord", findKey: printKey("Tallowmen"), take: "anchor" },
    { key: "absentWord", findKey: printKey("Absentee"), take: "anchor" },
    { key: "pctAfterWord", findKey: printKey("Quillwright"), take: "pct", span: 40 },
    { key: "pctBeforeWord", findKey: printKey("Tallowmen"), before: true, take: "pct", span: 30 },
  ],
);
check("a word is found by its key and read as the page prints it", guild.firstWord === "Quillwright");
check("the next occurrence of the key is the next token that folds to it", guild.secondWord === "Quillwright");
check("another word, another key", guild.otherWord === "Tallowmen");
check("trailing punctuation is not part of the word", guild.otherWord === "Tallowmen" && !/[,.]/.test(guild.otherWord));
check("a key the page does not hold reads nothing", !("absentWord" in guild));
check("a key anchors a figure's window like a phrase does", guild.pctAfterWord === 12 && guild.pctBeforeWord === 30);
check("the word keeps the page's case", read(["the LONGHOUSE stands"], [{ key: "w", findKey: printKey("longhouse"), take: "anchor" }]).w === "LONGHOUSE");

/* --- `rowsFrom`: one paragraph per row, found by its heading on the page's runs --- */
{
  // Every word is invented. A page prints a small grid (rows by two breed
  // columns) and, under it, a run-in titled paragraph per row; a second page
  // prints run-in paragraphs for items, one headed with a period.
  const r = (str, x, y) => ({ str, x, y, w: str.length * 5, h: 9 });
  const grid = {
    shape: "gridRows",
    column: { xMin: 0, xMax: 400, yMin: 20, yMax: 90 },
    labelMaxX: 50,
    keyByLabel: true,
    headerColumns: { labelRe: "^kind$", cellPattern: "rollBand" },
    rows: Array.from({ length: 6 }, (_, i) => ({ key: `row${i + 1}`, labelRe: "^[a-z][a-z -]*$", optional: true })),
  };
  // A heading is a run at the column's left edge, its text following on the line.
  const para = (y, head, lines) => [r(head, 10, y), r(lines[0], 80, y), ...lines.slice(1).map((l, i) => r(l, 10, y + 12 * (i + 1)))];
  const page1 = [
    r("Kind", 10, 30), r("Kell", 100, 30), r("Dorn", 170, 30),
    r("Wrangler", 10, 42), r("11-13", 104, 42), r("-", 180, 42),
    r("Drifter", 10, 54), r("24-29", 104, 54), r("25", 180, 54),
    r("Sleeper", 10, 66), r("30", 104, 66), r("26", 180, 66),
    r("Caption furniture", 500, 20),
    ...para(100, "Wranglers:", [
      "Wranglers gain a +3 bonus to initiative and may speak (as the proficiency).",
      "Lantern bearers are common. A wrangler rolls 2d5 rounds. 17% may bear tin bells",
      "and/or a rope lantern. Kells ride marsh herons; dorns ride river pike.",
    ]),
    ...para(150, "Misc Note:", ["A heading the table has no row for, which only ends the paragraph above it."]),
    ...para(180, "Drifters.", ["Drifters suffer a -3 penalty to morale. They can sing (as the proficiency). Only kells drift"]),
    ...para(210, "Sleepers:", [
      "Champions, sub-chieftains and witch- doctors sleep. Kells deal 2d5-1 /2d5 /2d7 damage with claws;",
      "dorns deal 3/3/2d9 burning damage. Each warband has a 7% chance per Hit Die of snoring.",
      "Dorn and kell sleepers carry bells of 3lb and 9lb size respectively.",
    ]),
    r("Tab", 597, 120),
  ];
  const itemPage = [
    ...para(100, "Tin Bell:", ["Wranglers or sleepers have a 35% chance to ring a tin bell. A bell is heard within 45’."]),
    ...para(130, "Rope Lantern.", ["Champions and chieftains carry a rope lantern. Each gang has a 11% chance."]),
    r("Tab", 597, 140),
  ];
  const items = {
    shape: "proseValues",
    rowsFrom: { runins: true },
    column: { xMin: 0, xMax: 590 },
    windows: [{ page: 1, column: { xMin: 0, xMax: 590 }, yMin: 95 }],
    values: [{ key: "radius", find: "heard within", take: "int", span: 8 }],
  };
  const rules = {
    shape: "proseValues",
    rowsFrom: { grid },
    vocab: grid,
    itemsFrom: items,
    column: { xMin: 0, xMax: 400 },
    windows: [{ page: 0, column: { xMin: 0, xMax: 400 }, yMin: 95 }],
    values: [
      { key: "initiative", find: "bonus to initiative", before: true, take: "signed", span: 6 },
      { key: "morale", find: "penalty to morale", before: true, take: "signed", span: 6 },
      { key: "carry", find: "", take: "itemShares", span: 4000 },
      { key: "proficiency", findRe: "may ([a-z]+) \\(as the proficiency\\)", group: 1, take: "text" },
      { key: "proficiency", findRe: "can ([a-z]+) \\(as the proficiency\\)", group: 1, take: "text" },
      { key: "mounts", find: "", take: "byBreed", verb: "ride", span: 4000 },
      { key: "damage", find: "", take: "breedDice", verb: "deals?", span: 4000 },
      { key: "ranks", find: "", take: "ranks", span: 4000 },
      { key: "chance", find: "", take: "chances", span: 4000 },
      { key: "sizes", find: "", take: "respectively", unit: "lb", span: 4000 },
      { key: "rounds", findRe: "rolls (\\d+d\\d+) rounds", group: 1, take: "text" },
    ],
  };
  const span = [page1, itemPage];
  const got = extractTable(page1, { ...rules, span });
  check("a paragraph is bound to the row its heading folds to, a plural tolerated, under the table's own key", Object.keys(got).join() === "wrangler,drifter,sleeper");
  check("the row keeps the label the table prints", got.wrangler.label === "Wrangler" && got.sleeper.label === "Sleeper");
  check("a heading the table has no row for mints nothing and ends the paragraph before it", !("miscNote" in got) && got.wrangler.proficiency === "speak");
  check("a heading closed by a period is a heading", got.drifter.morale === -3 && got.drifter.proficiency === "sing");
  check("a figure reads inside its own paragraph", got.wrangler.initiative === 3 && !("initiative" in got.drifter));
  check("a paragraph with no figure of a kind has no such key", !("morale" in got.wrangler) && !("mounts" in got.drifter));
  check("a capitalised line inside a paragraph is no heading", Object.keys(got).length === 3 && got.wrangler.rounds === "2d5");
  check("a figure never reads past its paragraph into the next", !("initiative" in got.sleeper));
  check("a share keys the items named in its sentence by the item recipe's own keys, plural tolerated",
    JSON.stringify(got.wrangler.carry) === '{"tinBell":17,"ropeLantern":17}');
  check("a take naming breeds reads the page's header words", JSON.stringify(got.wrangler.mounts) === '{"kell":"marsh herons","dorn":"river pike"}');
  check("a clause names its breeds and prints one figure per attack, as printed",
    JSON.stringify(got.sleeper.damage) === '{"kell":["2d5-1","2d5","2d7"],"dorn":["3","3","2d9"]}');
  check("a rank word, plural, hyphenated or split at a line end, is the module's role key",
    JSON.stringify(got.sleeper.ranks) === '["champion","subChieftain","witchDoctor"]');
  check("a chance carries its scope and per-Hit-Die mark", JSON.stringify(got.sleeper.chance) === '[{"pct":7,"perHitDie":true,"scope":"warband"}]');
  check("'respectively' pairs the breeds in the order the sentence names them, not the table's",
    JSON.stringify(got.sleeper.sizes) === '{"dorn":3,"kell":9}');
  const cut = page1.filter((x) => x.y < 175 || x.y > 195);
  const bare = extractTable(cut, { ...rules, span: [cut, itemPage] });
  check("a table row whose paragraph the page lacks is a row with its label and no figure", JSON.stringify(bare.drifter) === '{"label":"Drifter"}' && "morale" in got.drifter);

  const gearSpan = extractTable(page1, { ...items, span });
  check("a window reads the page of the span it names, and every heading is a row keyed by its slug", Object.keys(gearSpan).join() === "tinBell,ropeLantern" && gearSpan.tinBell.radius === 45);
  check("the margin tab outside the window is not read", !JSON.stringify(gearSpan).toLowerCase().includes("tab"));
  check("a window naming a page the span lacks reads nothing", Object.keys(extractTable(page1, { ...items, span: [page1] })).length === 0);
  const own = extractTable(page1, { ...items, windows: [{ page: 0, column: { xMin: 0, xMax: 400 }, yMin: 95 }], span });
  check("without a grid every heading on the page is a row", ["wranglers", "miscNote", "drifters", "sleepers"].every((k) => k in own));

  // A paragraph another recipe reads figures from keeps only the kinds named, and points there.
  const deferred = extractTable(page1, { ...items, span, defer: [{ table: "elsewhere", locate: "Rope Lantern.", keep: ["ranks"] }] });
  check("a deferred paragraph points at the recipe that reads it and keeps only what it is told to", deferred.ropeLantern.figuresFrom === "elsewhere" && deferred.tinBell.figuresFrom === undefined);

  // `group`: a phrase around a figure anchors it and the capture is the window.
  const cap = extractTable(page(["The ward is held for 12 turns by the guard."]), { shape: "proseValues", column: { xMin: 20, xMax: 600 }, values: [
    { key: "turns", findRe: "held for (\\d+) turns", group: 1, take: "int" },
    { key: "whole", findRe: "held for \\d+ turns", group: 0, take: "text" },
    { key: "none", findRe: "held for (\\d+) years", group: 1, take: "int" },
  ] });
  check("a capture group is the window the take reads, group 0 the whole match, no match nothing", cap.turns === 12 && cap.whole === "held for 12 turns" && !("none" in cap));
  const tk = (text, take, spec = {}) => extractTable(page([text]), { shape: "proseValues", column: { xMin: 20, xMax: 600 }, values: [{ key: "v", find: "", take, span: 400, ...spec }] }).v;
  check("an ordinal word, a rounding word and a ratio read", tk("on the third round", "ordinalWord") === 3 && tk("two (rounded down) ", "roundWord") === "down" && JSON.stringify(tk("by 5:3 or more", "ratio")) === "[5,3]");
  check("a page reference reads as a citation", tk("see ACKS II RR p. 77).", "cite") === "RR p.77");
  check("matches reads every occurrence into named fields", JSON.stringify(tk("a 2lb jar spans 4 and a 7lb jar spans 9", "matches", { re: "(\\d+)lb jar spans (\\d+)", fields: ["lb", "span"] })) === '[{"lb":2,"span":4},{"lb":7,"span":9}]');
  check("a sizes list with unequal counts reads nothing", tk("Kell and dorn carry 3lb size respectively", "respectively", { unit: "lb" }) === undefined);
}

console.log(`test-prose-values: ${pass} checks passed.`);
