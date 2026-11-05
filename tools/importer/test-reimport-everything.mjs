/**
 * One mode over every open book, asked once (`scripts/importer/everything.mjs`).
 *
 * Each part stands in for a book's Rebuild or Repair: it asks through the
 * `ask` it is handed before its first write, and writes only on a Yes. The
 * suite holds the orchestration to that contract: the dry pass writes nothing,
 * the one confirm carries every part's own lines under its label, a No runs
 * nothing more, a Yes runs each part that asked and no other, and the closing
 * run follows the parts once. No Foundry.
 */
import assert from "node:assert";
import { EVERYTHING_MODES, reimportEverything } from "../../scripts/importer/everything.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/** A part that asks with `lines` (or never asks, with null) and records its writes. */
function part(label, lines, writes) {
  return {
    label,
    run: async (ask) => {
      if (lines === null) return undefined;
      const yes = await ask({ lines, title: "reimportTitle" });
      if (!yes) return null;
      writes.push(label);
      return { label };
    },
  };
}

ok("three modes, as the Rebuild tab names them", EVERYTHING_MODES.join() === "drop,repair,force");

{
  const writes = [];
  const shown = [];
  const after = [];
  const parts = [part("Book A", ["Delete 3 of A?", ""], writes), part("Book B", null, writes), part("Book C", ["Delete 1 of C?"], writes)];
  const no = await reimportEverything({ mode: "drop", parts, confirm: async (asked) => (shown.push(asked), false), after: async () => after.push("chain") });
  ok("a No returns null", no === null);
  ok("and nothing is written, in the dry pass or after it", writes.length === 0, writes.join());
  ok("nor does the closing run run", after.length === 0);
  ok("the one confirm lists each part that asked, under its label, in order", shown.length === 1 && shown[0].map((a) => a.label).join() === "Book A,Book C", JSON.stringify(shown));
  ok("with that part's own lines, an empty line left out", shown[0][0].lines.join("|") === "Delete 3 of A?" && shown[0][1].lines.join("|") === "Delete 1 of C?", JSON.stringify(shown[0]));

  const yes = await reimportEverything({ mode: "drop", parts, confirm: async () => true, after: async () => (after.push("chain"), "chained") });
  ok("a Yes runs each part that asked, once, in order", writes.join() === "Book A,Book C", writes.join());
  ok("a part that never asked is not run", !writes.includes("Book B"));
  ok("the closing run follows the parts once", after.join() === "chain" && yes.after === "chained", JSON.stringify(yes));
  ok("and the result counts the parts and carries each one's own result", yes.asked === 2 && yes.parts.map((p) => p.result?.label).join() === "Book A,Book C" && yes.mode === "drop", JSON.stringify(yes));
}

{
  let confirms = 0;
  const writes = [];
  const none = await reimportEverything({ mode: "repair", parts: [part("Closed", null, writes)], confirm: async () => (confirms++, true), after: async () => "tables" });
  ok("with no part asking, no confirm is shown", confirms === 0);
  ok("nothing runs and the result says none asked", none.asked === 0 && none.parts.length === 0 && none.after === null && writes.length === 0, JSON.stringify(none));
}

{
  let threw = false;
  try {
    await reimportEverything({ mode: "import", parts: [], confirm: async () => true });
  } catch {
    threw = true;
  }
  ok("a mode the parts do not have is refused", threw);
}

console.log(`test-reimport-everything: ${pass} checks passed`);
