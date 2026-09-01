/**
 * Hand conversion: the round trip that makes the editor honest.
 *
 * The whole design rests on one property — a clause a Judge types is read by
 * the SAME grammar that reads a page, so the two paths cannot drift apart and
 * every rule the parser learns reaches hand entry for free. These assert that
 * property directly: parse → edit → reassemble → parse, and the edit survives.
 *
 * Blocks are invented, as everywhere in this suite.
 */
import { parseOseStatline } from "../../scripts/importer/ose-statline.mjs";
import { assembleStatline } from "../../scripts/importer/ose-manual.mjs";
import { convertOse } from "../../scripts/importer/ose-convert.mjs";
import { oseActorDataFromFields } from "../../scripts/importer/ose-binding.mjs";

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

const K = { acDescending: 9, acAscending: 10, attackThrow: 11, saveThrow: 20 };
const BOUNDS = { min: -6, max: 4 };

const FULL =
  "AC 3 [16], HD 2** (7hp), Att 1 x bite (1d6), THAC0 18 [+1], MV 150 (50), " +
  "SV D11 W12 P10 B14 S13 (Magic-user 2), ML 6, AL Chaotic, XP 47, NA 1d4 (2d6), TT R";

/* --- read, reassemble, read again ---------------------------------------- */

const first = parseOseStatline(FULL);
const round = parseOseStatline(assembleStatline(first.segments));
check("a reassembled line reads back identically", round.fields, first.fields);
ok("and leaves nothing over", round.extra.length === 0, JSON.stringify(round.extra));

/* --- an edit survives to the actor ---------------------------------------- */

// The point of the editor: correct a clause, and the correction is what the
// creature gets. Re-deriving from the original text here would discard it.
{
  const edited = { ...first.segments, ml: "9", ac: "5 [14]" };
  const parsed = parseOseStatline(assembleStatline(edited));
  check("the corrected morale is read", parsed.fields.ml, 9);
  check("the corrected armour class is read", parsed.fields.ac, { descending: 5, ascending: 14 });

  const data = oseActorDataFromFields({
    name: "Corrected creature",
    fields: parsed.fields,
    raw: assembleStatline(edited),
    origin: "hand",
    lineage: "ose",
    constants: K,
    moraleBounds: BOUNDS,
  });
  check("and it reaches the actor", data.system.details.morale, 1);
  check("as does the corrected armour class", data.system.aac.value, 4);
}

/* --- typed from nothing --------------------------------------------------- */

// No paste, no source, no page — the second way in.
{
  const typed = { ac: "7 [12]", hd: "2 (9hp)", ml: "8", al: "Neutral" };
  const parsed = parseOseStatline(assembleStatline(typed));
  const data = oseActorDataFromFields({
    name: "Invented creature",
    fields: parsed.fields,
    raw: assembleStatline(typed),
    origin: "hand",
    lineage: "ose",
    constants: K,
    moraleBounds: BOUNDS,
  });
  const rec = data.flags["acks-extras"].ose;
  check("origin is recorded as hand-entered", rec.origin, "hand");
  ok("no page is claimed", rec.page === null, String(rec.page));
  ok("no box is claimed", rec.box === null, String(rec.box));
  ok("no source is claimed", rec.sourceId === null, String(rec.sourceId));
  check("the biography says so", data.system.details.biography, "<p><em>Entered by hand</em></p>");
  check("the extras still land", data.flags["acks-extras"].extras.hd, { count: 2 });
  check("hit points land", data.system.hp.value, 9);
  check("morale lands", data.system.details.morale, 0);
}

/* --- blank fields are absent, not empty labels ---------------------------- */

const sparse = assembleStatline({ ac: "5 [14]", ml: "", al: "  ", hd: "1" });
check("empty clauses are omitted", sparse, "AC 5 [14], HD 1");
check("and the line still reads", parseOseStatline(sparse).fields.hd, { count: 1 });
check("an entirely empty form makes an empty line", assembleStatline({}), "");
check("and a null one does not throw", assembleStatline(null), "");

/* --- the same reader, so the same rules ----------------------------------- */

// A clause pasted with a line break and a word broken across it must read the
// same by hand as it does off a page — this is the rule-parity claim.
{
  const pasted = "AC 9 [10], HD 1 (4hp),\nSV D13 W14 P13 B16 S15 (Mag-\nic-user 1), ML 7";
  const r = parseOseStatline(pasted);
  check("a broken word closes up in pasted text", r.fields.sv.saveAs.token, "Magic-user");
  const back = parseOseStatline(assembleStatline(r.segments));
  check("and survives the round trip", back.fields.sv.saveAs.token, "Magic-user");
}

/* --- hand entry converts exactly like a page import ----------------------- */

// The two paths must not disagree about anything, or the manual tool is a
// second implementation wearing the first one's name.
{
  const viaPage = convertOse(parseOseStatline(FULL).fields, K, { lineage: "ose", moraleBounds: BOUNDS });
  const viaHand = convertOse(parseOseStatline(assembleStatline(first.segments)).fields, K, {
    lineage: "ose",
    moraleBounds: BOUNDS,
  });
  check("same system data", viaHand.system, viaPage.system);
  check("same extras", viaHand.extras, viaPage.extras);
  check("same gaps", viaHand.gaps, viaPage.gaps);
}

if (failed) {
  console.error(`\nose-manual: ${failed} failure(s)`);
  process.exit(1);
}
console.error("ose-manual: OK");
