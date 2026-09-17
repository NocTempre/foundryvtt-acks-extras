/**
 * A Judge's book is shelved where no player seat can open it.
 *
 * Three things this guards. The Judge's line is a LABEL shape, so every reader
 * that takes a shelf's line off its label has to get the same line back, and a
 * shelf of that line has to be recognised by the label alone. A shelf is closed
 * when it is MADE and never afterwards, so a Judge who opens one keeps it open.
 * And the registry is held to the data: a shipped book whose cookbook carries
 * keyed places, people, organisations or a map is a Judge's book, so the next
 * adventure added cannot land on the table's shelf by omission.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

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

/* ---------------- a world with packs, configured the way core configures them ---------------- */

const packs = [];
const settings = { compendiumConfiguration: {} };
const calls = [];
const makePack = (label, type) => {
  const collection = `world.${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  const pack = {
    collection,
    documentName: type,
    metadata: { packageType: "world", label },
    folders: [],
    async configure(configuration) {
      calls.push({ collection, configuration });
      settings.compendiumConfiguration[collection] = { ...(settings.compendiumConfiguration[collection] ?? {}), ...configuration };
    },
  };
  packs.push(pack);
  return pack;
};
packs.find = Array.prototype.find.bind(packs);
globalThis.game = {
  user: { isGM: true },
  packs,
  // No declared root: filing a new shelf in the sidebar is another suite's
  // question, and with none the organizer plans nothing.
  modules: { get: () => null },
  system: null,
  folders: [],
  settings: {
    get: (_scope, key) => settings[key],
    set: async (_scope, key, value) => void (settings[key] = value),
  },
};
globalThis.foundry = {
  documents: { collections: { CompendiumCollection: { createCompendium: async ({ label, type }) => makePack(label, type) } } },
  utils: { deepClone: (v) => structuredClone(v), objectsEqual: (a, b) => JSON.stringify(a) === JSON.stringify(b) },
};
globalThis.ui = { compendium: { render() {} } };

const { judgeLine, isJudgeLine, libraryPackLabel, importedPacks, lineOfPack, JUDGE_SHELF_OWNERSHIP } = await import("../scripts/lib/library.mjs");
const { ensureLibraryPack } = await import("../scripts/lib/library-target.mjs");
const { BOOKS, bookIsJudges, bookLine } = await import("../scripts/importer/books.mjs");

/* ---------------- the line ---------------- */

check("the ACKS library's Judge line is the segment alone", judgeLine(null), "Judge");
check("a series' Judge line keeps the series", judgeLine("Small Delves"), "Small Delves — Judge");
ok("both are Judge lines", isJudgeLine(judgeLine(null)) && isJudgeLine(judgeLine("Small Delves")));
ok("a series is not", !isJudgeLine("Small Delves") && !isJudgeLine(null) && !isJudgeLine(""));
ok("a series that merely mentions a judge is not", !isJudgeLine("Judge Dread Delves") && !isJudgeLine("The Judge — Delves"));
check("the label carries the line", libraryPackLabel("Actor", judgeLine("Small Delves")), "ACKS Cookbook — Small Delves — Judge — Actor");

/* ---------------- a shelf is closed as it is made ---------------- */

const judges = await ensureLibraryPack("Actor", judgeLine(null));
const shared = await ensureLibraryPack("Actor", null);
const lined = await ensureLibraryPack("JournalEntry", judgeLine("Small Delves"));
check("a Judge's shelf is closed to every player seat, once", calls.filter((c) => c.collection === judges.collection).map((c) => c.configuration), [
  { ownership: { GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "NONE", PLAYER: "NONE" } },
]);
check("the shared shelf is left to core's default", calls.filter((c) => c.collection === shared.collection), []);
check("a series' Judge shelf is closed too", calls.filter((c) => c.collection === lined.collection).length, 1);
ok("the ownership handed out is a copy", calls[0].configuration.ownership !== JUDGE_SHELF_OWNERSHIP && Object.isFrozen(JUDGE_SHELF_OWNERSHIP));

const before = calls.length;
settings.compendiumConfiguration[judges.collection].ownership = { GAMEMASTER: "OWNER", ASSISTANT: "OWNER", TRUSTED: "OBSERVER", PLAYER: "NONE" };
const again = await ensureLibraryPack("Actor", judgeLine(null));
check("a shelf that exists is found, not made again", again.collection, judges.collection);
check("and what its Judge has since set is left alone", calls.length, before);

/* ---------------- every reader gets the same line back ---------------- */

check("a shelf's line is read back off its label", lineOfPack(lined.collection), "Small Delves — Judge");
check("so is the ACKS Judge shelf's", lineOfPack(judges.collection), "Judge");
check("and the shared shelf has none", lineOfPack(shared.collection), null);
check("the Judge's shelves are the ones recognised", importedPacks().filter(({ line }) => isJudgeLine(line)).map(({ pack }) => pack.collection).sort(),
  [judges.collection, lined.collection].sort());

/* ---------------- the registry, held to the data ---------------- */

const JUDGE_KINDS = new Set(["kind.location", "kind.npc", "kind.organisation", "kind.oseLocation"]);
const owed = [];
for (const file of fs.readdirSync(path.join(ROOT, "cookbook")).filter((n) => n.endsWith(".json"))) {
  const id = file.replace(/\.json$/, "");
  if (!BOOKS[id]) continue;
  const cb = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", file), "utf8"));
  const keyed = Object.values(cb.entries ?? {}).some((e) => JUDGE_KINDS.has(e?.kind)) || Object.keys(cb.scenes ?? {}).length > 0;
  if (keyed && !bookIsJudges(id)) owed.push(id);
}
check("every shipped book with keyed places, people, organisations or a map is a Judge's book", owed, []);
ok("a rules book is not", !bookIsJudges("rr") && !bookIsJudges("mm") && !bookIsJudges("nothing"));
ok("a Judge's book keeps its series", Object.keys(BOOKS).filter(bookIsJudges).every((id) => judgeLine(bookLine(id)).endsWith("Judge")));

if (failed) {
  console.error(`${failed} check(s) failed`);
  process.exit(1);
}
console.log("test-judge-shelf: all checks passed");
