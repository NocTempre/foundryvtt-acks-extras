/**
 * What an imported OSE creature actually looks like as a document.
 *
 * Every check here exists because a live run found the field missing. The
 * converter can be perfectly right and the creature still arrive wrong, because
 * being right about a value and writing it where the sheet reads are two
 * different things — and offline suites that stop at the converter cannot tell
 * them apart.
 */
import { oseActorData, moraleBoundsFromSchema } from "../../scripts/importer/ose-binding.mjs";
import { makeOseSource } from "../../scripts/importer/ose-source.mjs";

let failed = 0;
const ok = (name, cond, detail = "") => {
  if (!cond) {
    console.error(`FAIL ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
  }
};
const check = (name, got, want) => {
  const g = JSON.stringify(got);
  const w = JSON.stringify(want);
  if (g !== w) {
    console.error(`FAIL ${name}\n  got:  ${g}\n  want: ${w}`);
    failed++;
  }
};

const K = { acDescending: 9, acAscending: 10, attackThrow: 11, saveThrow: 20 };
const BOUNDS = { min: -6, max: 4 };
const source = makeOseSource({ id: "ose.demo", label: "A Demo Delve", lineage: "ose", pages: 24 });

const build = (text, constants = K) =>
  oseActorData({
    name: "Test creature",
    candidate: { text, box: { x0: 1, x1: 2, y0: 3, y1: 4 } },
    source,
    page: 7,
    constants,
    moraleBounds: BOUNDS,
  });

const FULL =
  "AC 3 [16], HD 2** (7hp), Att 1 x bite (1d6), THAC0 18 [+1], MV 150 (50), " +
  "SV D11 W12 P10 B14 S13 (Magic-user 2), ML 6, AL Chaotic, XP 47, NA 1d4 (2d6), TT R";
const a = build(FULL);

/* --- the extended stat block reaches the flag the sheet reads ------------- */

// The hit-dice rating, saves-as, speed table and encounter numbers have no home
// in the core schema. Converting them and not writing them here loses all of
// them without a word — which is exactly what shipped until a live run caught it.
const extras = a.flags?.["acks-extras"]?.extras;
ok("the extras flag exists", !!extras, JSON.stringify(Object.keys(a.flags ?? {})));
check("hit-dice rating lands", extras?.hd, { count: 2, asterisks: 2 });
check("saves-as lands", extras?.saveAs, { class: "mage", level: 2 });
check("the speed table lands", extras?.speeds, [{ type: "land", combat: 50, run: 150, hover: false }]);
ok("encounter numbers land", !!extras?.encounter?.dungeon, JSON.stringify(extras?.encounter));

// A half-hit-die creature must keep its fraction all the way to the document.
const half = build("AC 7 [12], HD 1/2 (2hp), Att 1 x bite (1d2), ML 6, AL Neutral");
check("a half hit die survives as a fraction", half.flags["acks-extras"].extras.hd.count, 0.5);
check("and its roll formula is a d4", half.system.hp.hd, "1d4");

/* --- the creature opens on a sheet that can show its provenance ----------- */

// The Full Monster sheet registers for `monster` but is NOT the default for it,
// so without this an imported creature lands on a sheet with no Source tab and
// the whole audit trail is invisible to the person who needs it.
check("the sheet is pinned", a.flags?.core?.sheetClass, "acks-extras.FullMonsterSheet");
check("the type stays the ordinary one", a.type, "monster");

/* --- the provenance record itself ----------------------------------------- */

const ose = a.flags["acks-extras"].ose;
check("the block is kept verbatim", ose.raw, FULL);
ok("the reading is kept", !!ose.parsed?.ac, JSON.stringify(ose.parsed?.ac));
ok("routes and rules are recorded", ose.conversions.every((c) => c.route && c.rule));
ok("gaps are recorded", ose.gaps.some((g) => g.axis === "xp"));
check("provenance names the page", ose.page, 7);
check("and the source", ose.sourceLabel, "A Demo Delve");
ok("converted imports are not marked unconverted", ose.unconverted === false);

/* --- stage A leaves the arithmetic axes for later ------------------------- */

const stageA = build(FULL, null);
ok("stage A has no armour class", stageA.system.aac === undefined);
ok("stage A is marked unconverted", stageA.flags["acks-extras"].ose.unconverted === true);
// ...but everything that needed no arithmetic still arrives, including extras.
check("stage A still carries the extras", stageA.flags["acks-extras"].extras.hd, { count: 2, asterisks: 2 });

/* --- nothing read is thrown away ------------------------------------------ */

// A label the profile does not know must reach the document, so the Judge can
// see it was there. Silently dropping it is the failure this asserts against.
const foreignLabel = build("AC 7 [12], VITALITY 1 (4hp), Att 1 x bite (1d4), ML 7, AL Neutral");
ok(
  "an unknown label's clause survives to the document",
  JSON.stringify(foreignLabel.flags["acks-extras"].ose.extra).includes("VITALITY"),
  JSON.stringify(foreignLabel.flags["acks-extras"].ose.extra),
);

/* --- schema bounds are read, never assumed -------------------------------- */

// Outside Foundry there is no schema to read, and the converter must then
// report morale as a gap rather than inventing an offset.
ok("no schema means no bounds", moraleBoundsFromSchema() === null);

/* --- never throws --------------------------------------------------------- */

for (const bad of [{ text: "" }, { text: "not a stat block at all" }, { text: "AC" }]) {
  try {
    oseActorData({ name: "", candidate: bad, source, page: 1, constants: K, moraleBounds: BOUNDS });
  } catch (e) {
    console.error(`FAIL oseActorData threw on ${JSON.stringify(bad)} — ${e.message}`);
    failed++;
  }
}

/* --- the saves go in under the names the SYSTEM has ----------------------- */

// Found live against acks 14.0.1: the converter emits `blast`, that build has
// only `breath`, and a SchemaField drops a key it has no field for — so the
// creature arrived with four of its five saving throws and nothing said so.
{
  const line = "AC 6 [13], HD 4 (18hp), Att 1 x fist (1d6), SV D10 W11 P12 B13 S14, ML 8, AL Neutral";
  const build = (fields) => {
    const prev = globalThis.CONFIG;
    globalThis.CONFIG = { Actor: { dataModels: { monster: { schema: { getField: (p) => (p === "saves" ? { fields } : undefined) } } } } };
    try {
      return oseActorData({
        candidate: { text: line, box: null },
        source: { id: "t", label: "T", lineage: "ose" },
        page: 1, constants: K, moraleBounds: BOUNDS,
      });
    } finally {
      globalThis.CONFIG = prev;
    }
  };

  const older = build({ paralysis: {}, death: {}, breath: {}, implements: {}, spell: {}, wand: {} });
  check("the blast save lands on the name that build has", older.system.saves.breath, { value: 13 });
  ok("and not on one it would drop", older.system.saves.blast === undefined);

  const newer = build({ paralysis: {}, death: {}, blast: {}, implements: {}, spell: {} });
  check("a build with the new name gets the new name", newer.system.saves.blast, { value: 13 });
  ok("and is not given the old one", newer.system.saves.breath === undefined);
}

if (failed) {
  console.error(`\nose-binding: ${failed} failure(s)`);
  process.exit(1);
}
console.error("ose-binding: OK");
