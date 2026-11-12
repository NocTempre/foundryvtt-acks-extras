/**
 * `take: "runins"` of a `proseValues` recipe: a window of running prose split
 * into its run-in titled paragraphs, `[{label, text}]`, by the shape of a
 * title (Title Case, closed by a colon, at the start of a sentence).
 *
 * Foundry-free and book-free: every paragraph below is invented, because what
 * is under test is where one run-in ends and the next begins.
 */
import assert from "node:assert";
import { extractProseValues } from "../../scripts/importer/table-extract.mjs";

let pass = 0;
const check = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/** A one-column page of runs, one per line, top to bottom. */
const pageOf = (...lines) => lines.map((str, i) => ({ str, x: 40, y: 100 + i * 12, w: str.length * 5, h: 9 }));
const read = (lines, extra = {}) =>
  extractProseValues(pageOf(...lines), { values: [{ key: "powers", find: "listed below.", take: "runins", span: 900, ...extra }] }).powers;

/* --- an invented paragraph is split at its titles ---------------------------------------- */

const PARAGRAPH = [
  "The fen folk are listed below. Marsh Stalker: moves quietly",
  "through the reeds. It never sleeps. Bog Lantern: glows when",
  "water is near. Note that Foo Bar: is no title here. Tall Reed of the Fen: sways in",
  "the wind.",
];
const out = read(PARAGRAPH);
check("each title opens one entry, in reading order", out?.map((r) => r.label).join("|") === "Marsh Stalker|Bog Lantern|Tall Reed of the Fen", JSON.stringify(out));
check("an entry runs to the next title, lines joined", out?.[0].text === "moves quietly through the reeds. It never sleeps.", out?.[0].text);
check("a capitalised phrase and colon mid-sentence is no title", out?.[1].text === "glows when water is near. Note that Foo Bar: is no title here.", out?.[1].text);
check("a title keeps its small words in lower case", out?.[2].label === "Tall Reed of the Fen" && out[2].text === "sways in the wind.");
check("the prose before the first title belongs to no entry", !out?.some((r) => r.text.includes("fen folk")));

/* --- what is not a run-in ---------------------------------------------------------------- */

check("a window with no title reads nothing", read(["The fen folk are listed below. They keep to the reeds."]) === undefined);
check("a lower-case phrase before a colon is no title", read(["The fen folk are listed below. They keep to: the reeds."]) === undefined);
check("a title at the window's first character counts", read(["The fen folk are listed below.Marsh Stalker: first."])?.[0]?.label === "Marsh Stalker");
check("a text that closes the window on a title keeps it, empty", read(["The fen folk are listed below. Marsh Stalker:"])?.[0]?.text === "");
check("the anchor's own words are outside the window", read(["Marsh Stalker: before the anchor. The fen folk are listed below. Bog Lantern: after it."]).map((r) => r.label).join("|") === "Bog Lantern");

/* --- a window before the anchor, and the page's own case --------------------------------- */

const before = extractProseValues(pageOf("Marsh Stalker: slow. Bog Lantern: bright. The fen folk are listed below."), {
  values: [{ key: "powers", find: "listed below.", before: true, take: "runins", span: 900 }],
}).powers;
check("a window before the anchor is read the same way", before?.map((r) => r.label).join("|") === "Marsh Stalker|Bog Lantern", JSON.stringify(before));

/* --- a bulleted list: each bullet opens a sentence --------------------------------------- */

// A symbol font hands a bullet over as a C1 control as often as U+2022.
for (const bullet of ["\u008d", "•", ""]) {
  const listed = read([`The fen folk are listed below. ${bullet} Marsh Stalker: moves quietly`, `${bullet} Bog Lantern: glows when water is near`]);
  check(`an item after a bullet (U+${bullet.codePointAt(0).toString(16).toUpperCase()}) is a title, the next bullet left out of the text before it`,
    listed?.map((r) => r.label).join("|") === "Marsh Stalker|Bog Lantern" && listed[0].text === "moves quietly" && listed[1].text === "glows when water is near",
    JSON.stringify(listed));
}
check("an unbulleted phrase after a sentence with no stop is still no title", read(["The fen folk are listed below. Marsh Stalker: moves 200 Bog Lantern: glows."])?.map((r) => r.label).join("|") === "Marsh Stalker");

/* --- a window from the page's first character -------------------------------------------- */

const whole = extractProseValues(pageOf("Marsh Stalker: slow. Bog Lantern: bright."), { values: [{ key: "powers", find: "", take: "runins", span: 900 }] }).powers;
check("an empty anchor reads from the first character", whole?.map((r) => r.label).join("|") === "Marsh Stalker|Bog Lantern", JSON.stringify(whole));

/* --- the other takes still read the lowercased window ------------------------------------ */

const int = extractProseValues(pageOf("The fen folk are listed below. 14 of them."), { values: [{ key: "n", find: "listed below.", take: "int" }] });
check("an existing take is unchanged", int.n === 14);

console.log(`test-runins: ${pass} checks passed.`);
