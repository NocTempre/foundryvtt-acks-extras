/**
 * A culture is read by the keys of what its page prints, and named by ordinal.
 *
 * The People chapter's cultures, their name lists and their appearance
 * sentences are found without the recipe writing a heading or a name: each
 * block carries `printKey`s (a hash of the folded letters), the page is the one
 * whose runs hold them, and the culture's label is read off its heading at
 * import. The helpers that do the finding are held here against invented pages:
 * `holdsKey`, `headingGroups` and `findHeading` (printed-name), `startAfterKey`
 * and `section` (table-extract), the hash locates of `locatePageNumber`, and a
 * whole `importTables` run over a two-page invented book. The shipped recipe is
 * held to its shape: ordinal ids, neutral labels, keys and no printed words. A
 * culture's name template (`takePatronym`) is read from an invented example,
 * across a page break where the paragraph runs on.
 *
 * Every name below is invented; the keys are computed from them in the test.
 */
import assert from "node:assert";
import { findHeading, headingGroups, holdsKey, printKey } from "../../scripts/importer/printed-name.mjs";
import { extractTable } from "../../scripts/importer/table-extract.mjs";
import { pageItems } from "../../scripts/importer/extract.mjs";
import { importTables, locatePageNumber, recipeLocates } from "../../scripts/importer/tables-binding.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import * as services from "../../scripts/lib/services.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};
const eq = (label, got, want) => {
  assert.deepStrictEqual(got, want, label);
  pass++;
};

const BODY = 9;
const HEAD = 14;
const run = (str, x, y, h = BODY) => ({ str, x, y, h });

/* --- holdsKey: a name is found by its key, as a whole token ------------------------------ */
{
  const key = printKey("Zorvane");
  ok("a token that folds to the key holds it", holdsKey("Male Names: Zorvane, Quilla", key));
  ok("case and accents do not matter", holdsKey("ZORVÂNE,", key));
  ok("a token with the name inside it does not hold it", !holdsKey("Zorvanelle, Quilla", key));
  ok("a different name does not hold it", !holdsKey("Male Names: Quilla, Mett", key));
  ok("an empty key holds nothing", !holdsKey("Male Names: Zorvane", ""));
  ok("no text holds nothing", !holdsKey("", key) && !holdsKey(null, key));
}

/* --- headingGroups: display runs, consecutive, every contiguous join --------------------- */
{
  const items = [
    run("body before", 45, 50),
    run("Tarnic (Fen", 45, 100, HEAD),
    run("Marches)", 45, 114, HEAD),
    run("body between", 45, 130),
    run("Wend", 302, 100, HEAD),
  ];
  const groups = headingGroups(items, 11);
  eq("a wrapped heading is offered whole and in parts", groups.map((g) => g.text), ["Tarnic (Fen", "Tarnic (Fen Marches)", "Marches)", "Wend"]);
  eq("a group indexes the runs it joins", groups.filter((g) => g.text === "Tarnic (Fen Marches)").map((g) => [g.from, g.to]), [[1, 2]]);
  eq("a body run ends the chain", groups.some((g) => /Wend/.test(g.text) && /Marches/.test(g.text)), false);
  const wrapped = findHeading(items, 11, printKey("Tarnic (Fen Marches)"));
  ok("a heading wrapped over two runs is found by the key of its whole", wrapped?.from === 1 && wrapped?.to === 2);
  ok("a single-run heading is found", findHeading(items, 11, printKey("Wend"))?.from === 4);
  ok("a heading that is not on the page is null", findHeading(items, 11, printKey("Absent")) === null);
  ok("an empty key finds nothing", findHeading(items, 11, "") === null);
  eq("no display run, no group", headingGroups([run("body", 1, 1)], 11), []);
  const long = Array.from({ length: 40 }, (_, i) => run(`r${i}`, 10, 10 + i, HEAD));
  ok("a long chain of display runs stays bounded", headingGroups(long, 11).every((g) => g.to - g.from < 8));
}

/* --- startAfterKey: stacked blocks with the same labels ---------------------------------- */
{
  const list = (names, y) => [
    run(`Male Names: ${names[0]}, ${names[1]},`, 45, y),
    run(names[2], 45, y + 10),
    run("Female Names: Ilsa, Vorn", 45, y + 20),
    run("Surnames: Ashfield, Brook", 45, y + 30),
  ];
  const items = [...list(["Zorvane", "Quilla", "Mett"], 100), ...list(["Dray", "Orlen", "Pike"], 200)];
  const recipe = { shape: "nameList", fields: [{ key: "male", label: "Male Names:" }, { key: "female", label: "Female Names:" }, { key: "surnames", label: "Surnames:" }], column: { xMin: 25, xMax: 320 } };
  eq("the list under the first key", extractTable(items, { ...recipe, startAfterKey: printKey("Zorvane") }).male, ["Zorvane", "Quilla", "Mett"]);
  eq("the list under the second key", extractTable(items, { ...recipe, startAfterKey: printKey("Dray") }).male, ["Dray", "Orlen", "Pike"]);
  eq("a key the page does not hold starts at the top", extractTable(items, { ...recipe, startAfterKey: printKey("Absent") }).male, ["Zorvane", "Quilla", "Mett"]);
}

/* --- section: a phrase every heading's paragraph shares ---------------------------------- */
{
  const page = [
    run("Tarnic", 45, 100, HEAD),
    run("Their hair is wavy and colored red, grey, or black.", 45, 120),
    run("Their eyes are green or blue.", 45, 132),
    run("Wend", 45, 200, HEAD),
    run("Their hair is thick and colored white or blond.", 45, 220),
    run("Their eyes are dark brown.", 45, 232),
    run("Haver", 302, 100, HEAD),
    run("The hair of the Haver is long and colored black.", 302, 120),
  ];
  const recipe = (key, values) => ({ shape: "proseValues", values, column: { xMin: 25, xMax: 590 }, section: { key: printKey(key), headH: 11 } });
  const both = [{ key: "hair", find: "hair is", take: "colorList", span: 240 }, { key: "eyes", find: "eyes are", take: "colorList", span: 240 }];
  eq("the first heading's paragraph", extractTable(page, recipe("Tarnic", both)), { hair: ["red", "grey", "black"], eyes: ["green", "blue"] });
  eq("the second heading's paragraph, not the first's", extractTable(page, recipe("Wend", both)), { hair: ["white", "blond"], eyes: ["dark brown"] });
  eq("a section ends at the next display run", extractTable(page, recipe("Tarnic", [{ key: "x", find: "thick", take: "phrase" }])), {});
  eq("a heading the page does not print reads nothing", extractTable(page, recipe("Absent", both)), {});
  eq("a pattern finds a phrase that holds a word the page sets", extractTable(page, recipe("Haver", [{ key: "hair", findRe: "hair of the \\S+ is", take: "colorList", span: 240 }])), { hair: ["black"] });
  eq("without a section the first phrase on the page is read", extractTable(page, { shape: "proseValues", values: [both[0]], column: { xMin: 25, xMax: 590 } }), { hair: ["red", "grey", "black"] });
}

/* --- an invented book ------------------------------------------------------------------- */
const H = 792;
/** A book of invented pages, each a list of `{str, x, y, h}`; a warm-up read primes its furniture profile. */
async function bookOf(pages) {
  const doc = {
    numPages: pages.length,
    async getPage(n) {
      return {
        getViewport: () => ({ width: 612, height: H }),
        getTextContent: async () => ({
          items: (pages[n - 1] ?? []).map((r) => ({ str: r.str, transform: [1, 0, 0, 1, r.x, H - r.y], width: 40, height: r.h, fontName: "F1" })),
        }),
        getOperatorList: async () => ({ fnArray: [], argsArray: [] }),
      };
    },
  };
  await pageItems(doc, 1);
  return doc;
}

const KEYS = { tarnic: printKey("Tarnic"), wend: printKey("Wend"), zorvane: printKey("Zorvane"), dray: printKey("Dray") };
// Page 1: two stacked cultures in the left column. Page 2: the heading of a
// third culture only; its list is on a later page of another book.
const PAGES = [
  [],
  [
    run("Tarnic", 45, 100, HEAD),
    run("Their hair is wavy and colored red, grey, or black.", 45, 120),
    run("Their eyes are green or blue.", 45, 132),
    run("Male Names: Zorvane, Quilla,", 45, 150),
    run("Mett", 45, 160),
    run("Female Names: Ilsa, Vorn", 45, 170),
    run("Surnames: Ashfield, Brook", 45, 180),
    run("Wend", 45, 300, HEAD),
    run("Their hair is thick and colored white or blond.", 45, 320),
    run("Male Names: Dray, Orlen", 45, 350),
    run("Female Names: Sedge, Tamsin", 45, 360),
    run("Surnames: Holt, Marsh", 45, 370),
  ],
  [],
];

/* --- locatePageNumber: the two hash locates ---------------------------------------------- */
{
  const doc = await bookOf(PAGES);
  eq("a name key finds the page whose runs hold it", await locatePageNumber(doc, { book: "rr", printedPage: 1, locateKey: KEYS.dray }), 2);
  eq("a heading key finds the page whose display runs hold it", await locatePageNumber(doc, { book: "rr", printedPage: 1, locateHeadingKey: KEYS.wend, headH: 11 }), 2);
  eq("a key no page holds is not found", await locatePageNumber(doc, { book: "rr", printedPage: 1, locateKey: printKey("Absent") }), null);
  eq("a heading key is not matched by body text", await locatePageNumber(doc, { book: "rr", printedPage: 1, locateHeadingKey: KEYS.zorvane, headH: 11 }), null);
}

/* --- importTables: the label is read off the heading, the fallback is neutral ------------- */
{
  const block = (id, anchorKey, headingKey, label, extra = {}) => ({
    cultureId: id,
    printedPage: 0,
    anchorKey,
    heading: { key: headingKey, printedPage: 0, headH: 11 },
    meta: { label },
    ...extra,
  });
  const fields = [{ key: "male", label: "Male Names:" }, { key: "female", label: "Female Names:" }, { key: "surnames", label: "Surnames:" }];
  const saved = TABLE_RECIPES.people;
  let imported = null;
  services.register("ruledata-import", { async importDoc(doc) { imported = doc; } });
  try {
    TABLE_RECIPES.people = {
      source: saved.source,
      tables: {
        cultures: {
          shape: "nameList",
          book: "rr",
          fields,
          blocks: [
            block("culture1", KEYS.zorvane, KEYS.tarnic, "Culture 1", { meta: { label: "Culture 1", alsoRaces: ["people1"] } }),
            block("culture2", KEYS.dray, KEYS.wend, "Culture 2"),
            block("culture3", KEYS.dray, printKey("Absent"), "Culture 3"),
            block("culture4", KEYS.dray, KEYS.wend, "Culture 4", { heading: { key: KEYS.wend, book: "tt", printedPage: 0, headH: 11 } }),
          ],
        },
        cultureAppearance: {
          shape: "proseValues",
          book: "rr",
          valueBlocks: [
            { id: "culture1", printedPage: 0, column: { xMin: 25, xMax: 590 }, section: { key: KEYS.tarnic, headH: 11 }, values: [{ key: "hair", find: "hair is", take: "colorList", span: 240 }, { key: "eyes", find: "eyes are", take: "colorList", span: 240 }] },
            { id: "culture2", printedPage: 0, column: { xMin: 25, xMax: 590 }, section: { key: KEYS.wend, headH: 11 }, values: [{ key: "hair", find: "hair is", take: "colorList", span: 240 }] },
          ],
          emit: { path: ["cultures"] },
        },
      },
    };
    const sessions = new Map([["rr", { doc: await bookOf(PAGES) }]]);
    const report = await importTables(sessions, { only: ["people"] });
    const list = imported?.tables?.cultures?.list;
    ok("the import wrote the cultures", !!list, JSON.stringify(report.missingTables));
    eq("a heading read off the page is the label", list.culture1.label, "Tarnic");
    eq("the second heading's label, from the same page", list.culture2.label, "Wend");
    eq("a heading the page does not print leaves the neutral label", list.culture3.label, "Culture 3");
    eq("a heading in a book that is not open leaves the neutral label", list.culture4.label, "Culture 4");
    eq("the list under the first key", list.culture1.male, ["Zorvane", "Quilla", "Mett"]);
    eq("the list under the second key", list.culture2.male, ["Dray", "Orlen"]);
    eq("structural meta rides beside the read label", list.culture1.alsoRaces, ["people1"]);
    eq("the appearance palettes are read by section", imported.tables.cultureAppearance.cultures, {
      culture1: { hair: ["red", "grey", "black"], eyes: ["green", "blue"] },
      culture2: { hair: ["white", "blond"] },
    });
    const located = recipeLocates(TABLE_RECIPES.people.tables.cultures).map((l) => l.id);
    ok("each block's heading is a search of its own", located.includes("culture1.heading") && located.includes("culture1"), located.join());
  } finally {
    TABLE_RECIPES.people = saved;
  }
}

/* --- patronym: a name template taught by an example, on the page or running onto the next --- */
{
  // Every name and affix below is invented. Page A ends inside a paragraph; page B finishes it.
  const pageA = [
    run("Tarnic", 45, 100, HEAD),
    run("Their hair is wavy and colored red, grey, or black.", 45, 120),
    run("Tarnic sons take the father's name with a tail (e.g. Pell, son of Garran, would be", 45, 132),
  ];
  const pageB = [
    run("“Pell Garranvik”) and daughters take another (e.g. Mira, daughter of Garran, would be “Mira Garranvika”).", 45, 70),
    run("Wend", 45, 200, HEAD),
    run("The Wend say Vek (“son of ”) or Vel (“daughter of ”) before the father's name (e.g. “Dov Vek Hask” is “Dov, son of Hask”).", 45, 220),
    run("Haver", 45, 300, HEAD),
    run("Haver line descent with a prefix (e.g. “Ilsa Lom-Morn Lom-Dray” would be “Ilsa, of the clan of Morn, of the clan of Dray,” and so on).", 45, 320),
    run("Quill", 45, 400, HEAD),
    run("A Quill man, such as Mera, son of Tolk, might be “Mera of Fenwick”.", 45, 420),
    run("Dunn", 45, 500, HEAD),
    run("The Dunn add -sen or -dal to the father's name (e.g. Orm, son of Tave, would be “Orm Tavesen”).", 45, 520),
    run("Fell", 45, 600, HEAD),
    run("The Fell append the father's name (e.g. Jo, son of Rin, would be “Jo Rin”). Nobles add a clan (e.g. Jo, of Clan Vale, would be “Jo Zu Vale”).", 45, 620),
  ];
  const PATRONYM = { key: "patronym", take: "patronym", runOn: true };
  const recipe = (key, extra = {}, value = PATRONYM) => ({ shape: "proseValues", values: [value], column: { xMin: 25, xMax: 590 }, section: { key: printKey(key), headH: 11 }, ...extra });
  const read = (key, items = pageB) => extractTable(items, recipe(key));
  eq("a son and a daughter example each give their template", extractTable(pageA, recipe("Tarnic", { runOn: pageB })), { patronym: { male: "{parent}vik", female: "{parent}vika" } });
  eq("a paragraph cut at the foot of the page is not read without the next page", extractTable(pageA, recipe("Tarnic")), {});
  eq("a value that does not ask to run on does not read the next page", extractTable(pageA, recipe("Tarnic", { runOn: pageB }, { key: "patronym", take: "patronym" })), {});
  eq("a section a heading closes on its own page does not run on", extractTable([...pageA, run("Wend", 45, 200, HEAD)], recipe("Tarnic", { runOn: pageB })), {});
  eq("the next page is read only up to its first heading", extractTable(pageA, recipe("Tarnic", { runOn: pageB })).patronym.male, "{parent}vik");
  eq("a word glossed son of and one glossed daughter of give the two templates", read("Wend"), { patronym: { male: "Vek {parent}", female: "Vel {parent}" } });
  eq("a relation that is neither sex gives the one template to both", read("Haver"), { patronym: { male: "Lom-{parent}", female: "Lom-{parent}" } });
  eq("a pair whose quoted name does not hold the parent is no example", read("Quill"), {});
  eq("a pair of affixes the male template holds gives the female one", read("Dunn"), { patronym: { male: "{parent}sen", female: "{parent}dal" } });
  eq("a house example does not displace a son example, and the male template stands for both", read("Fell"), { patronym: { male: "{parent}", female: "{parent}" } });
  eq("a heading the page does not print reads nothing", read("Absent"), {});
  // The import hands a block that reads on its next page.
  const saved = TABLE_RECIPES.people;
  let imported = null;
  services.register("ruledata-import", { async importDoc(doc) { imported = doc; } });
  try {
    TABLE_RECIPES.people = {
      source: saved.source,
      tables: {
        cultureAppearance: {
          shape: "proseValues",
          book: "rr",
          valueBlocks: [
            { id: "culture1", printedPage: 0, column: { xMin: 25, xMax: 590 }, section: { key: printKey("Tarnic"), headH: 11 }, values: [{ key: "hair", find: "hair is", take: "colorList", span: 240 }, PATRONYM] },
            { id: "culture2", printedPage: 0, column: { xMin: 25, xMax: 590 }, section: { key: printKey("Wend"), headH: 11 }, values: [PATRONYM] },
            { id: "culture3", printedPage: 0, column: { xMin: 25, xMax: 590 }, section: { key: printKey("Fell"), headH: 11 }, values: [PATRONYM] },
          ],
          emit: { path: ["cultures"] },
        },
      },
    };
    const sessions = new Map([["rr", { doc: await bookOf([[], pageA, pageB]) }]]);
    await importTables(sessions, { only: ["people"] });
    eq("the import reads the paragraph across the page break, and a block on the last page reads its own", imported.tables.cultureAppearance.cultures, {
      culture1: { hair: ["red", "grey", "black"], patronym: { male: "{parent}vik", female: "{parent}vika" } },
      culture2: { patronym: { male: "Vek {parent}", female: "Vel {parent}" } },
      culture3: { patronym: { male: "{parent}", female: "{parent}" } },
    });
  } finally {
    TABLE_RECIPES.people = saved;
  }
}

/* --- the shipped recipe: ordinal ids, neutral labels, keys, no words ---------------------- */
{
  const cultures = TABLE_RECIPES.people.tables.cultures;
  const appearance = TABLE_RECIPES.people.tables.cultureAppearance;
  const ids = cultures.blocks.map((b) => b.cultureId);
  ok("culture ids are unique", new Set(ids).size === ids.length);
  const ordinals = ids.filter((id) => /^culture\d+$/.test(id)).map((id) => Number(id.slice("culture".length)));
  eq("the human cultures are numbered one to the last, in order", ordinals, ordinals.map((_, i) => i + 1));
  // Race words (a common noun for a kind of being) and the neutral stand-in for an unnamed people keep their ids.
  const kept = ids.filter((id) => !/^culture\d+$/.test(id));
  ok("the other ids are race words or a neutral ordinal", kept.every((id) => /^(dwarven|elven|lizardman|people\d+)$/.test(id)), kept.join());
  for (const b of cultures.blocks) {
    const at = `culture ${b.cultureId}`;
    ok(`${at}: no printed anchor`, !("anchor" in b));
    ok(`${at}: no printed locate`, !("locate" in b));
    ok(`${at}: a name key`, /^[0-9a-z]{1,8}$/.test(b.anchorKey ?? ""));
    ok(`${at}: a heading key and a page`, /^[0-9a-z]{1,8}$/.test(b.heading?.key ?? "") && b.heading.printedPage > 0);
    const neutral = /^culture\d+$/.test(b.cultureId) ? `Culture ${b.cultureId.slice("culture".length)}` : null;
    ok(`${at}: a neutral label`, neutral ? b.meta.label === neutral : /^(Dwarven|Elven|Lizardman|People \d+)$/.test(b.meta.label), b.meta.label);
    ok(`${at}: no name template in the recipe`, !("patronym" in b.meta));
  }
  // A phrase is generic when its only words are the copulas and the nouns of the colours' own sentences.
  const GENERIC = new Set(["hair", "eyes", "is", "are", "of", "the"]);
  const generic = (phrase) => (String(phrase).replace(/\\[a-zA-Z]\+?/g, " ").match(/[a-z]+/gi) ?? []).every((w) => GENERIC.has(w.toLowerCase()));
  ok("the generic test refuses a phrase that names a people", !generic("hair of the tarnic is"));
  for (const b of appearance.valueBlocks) {
    const at = `appearance ${b.id}`;
    const own = cultures.blocks.find((c) => c.cultureId === b.id);
    ok(`${at}: a culture of the name lists`, !!own);
    ok(`${at}: no printed locate`, !("locate" in b));
    ok(`${at}: sectioned by its heading`, b.section?.key === own?.heading.key && b.printedPage === own?.heading.printedPage);
    const phrased = b.values.filter((v) => v.key !== "patronym");
    ok(`${at}: phrases name no people`, phrased.every((v) => /^(hair|eyes)$/.test(v.key) && generic(v.find ?? v.findRe)), JSON.stringify(b.values.map((v) => v.key)));
    ok(`${at}: a name template names no phrase and reads on to the next page`, b.values.filter((v) => v.key === "patronym").every((v) => v.take === "patronym" && v.runOn === true && !("find" in v) && !("findRe" in v)));
  }
  const withTemplate = appearance.valueBlocks.filter((b) => b.values.some((v) => v.key === "patronym")).length;
  ok("the cultures that teach a name template by example read one", withTemplate > 0 && withTemplate < appearance.valueBlocks.length, String(withTemplate));
  eq("the people-1 race draws from exactly one culture", cultures.blocks.filter((b) => b.meta.alsoRaces?.includes("people1")).length, 1);
}

console.log(`test-culture-keys: ${pass} checks passed.`);
