/**
 * One mode over every open book, asked once (`scripts/importer/everything.mjs`).
 *
 * Each part stands in for a book's Rebuild or Repair: it asks through the
 * `ask` it is handed before its first write, and writes only on a Yes. The
 * suite holds the orchestration to that contract: the dry pass writes nothing,
 * the one confirm carries every part's own lines under its label, a No runs
 * nothing more, a Yes runs the caller's `before` once and then each part that
 * asked and no other. No Foundry.
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
  const log = [];
  const parts = [part("Book A", ["Delete 3 of A?", ""], writes), part("Book B", null, writes), part("Book C", ["Delete 1 of C?"], writes)];
  const no = await reimportEverything({ mode: "drop", parts, confirm: async (asked) => (shown.push(asked), false), before: async () => log.push("read") });
  ok("a No returns null", no === null);
  ok("and nothing is written, in the dry pass or after it", writes.length === 0, writes.join());
  ok("nor does the read ahead of the parts run", log.length === 0);
  ok("the one confirm lists each part that asked, under its label, in order", shown.length === 1 && shown[0].map((a) => a.label).join() === "Book A,Book C", JSON.stringify(shown));
  ok("with that part's own lines, an empty line left out", shown[0][0].lines.join("|") === "Delete 3 of A?" && shown[0][1].lines.join("|") === "Delete 1 of C?", JSON.stringify(shown[0]));

  const yes = await reimportEverything({ mode: "drop", parts, confirm: async () => true, before: async () => (log.push("read"), "tables") });
  ok("a Yes runs each part that asked, once, in order", writes.join() === "Book A,Book C", writes.join());
  ok("a part that never asked is not run", !writes.includes("Book B"));
  ok("the read ahead of the parts runs once and its result is returned", log.join() === "read" && yes.before === "tables", JSON.stringify(yes));
  ok("and the result counts the parts and carries each one's own result", yes.asked === 2 && yes.parts.map((p) => p.result?.label).join() === "Book A,Book C" && yes.mode === "drop", JSON.stringify(yes));
}

{
  let confirms = 0;
  const writes = [];
  const none = await reimportEverything({ mode: "repair", parts: [part("Closed", null, writes)], confirm: async () => (confirms++, true), before: async () => (confirms += 10, "tables") });
  ok("with no part asking, no confirm is shown and no read is taken", confirms === 0);
  ok("nothing runs and the result says none asked", none.asked === 0 && none.parts.length === 0 && none.before === null && writes.length === 0, JSON.stringify(none));
}

{
  // The read sits between the confirm's Yes and the first part's Yes-run, and the dry pass precedes both.
  const log = [];
  const parts = ["A", "B"].map((label) => ({
    label,
    run: async (ask) => {
      const yes = await ask({ lines: [label], title: "reimportTitle" });
      log.push(`${label}:${yes ? "yes" : "no"}`);
      return yes;
    },
  }));
  await reimportEverything({ mode: "repair", parts, confirm: async () => (log.push("confirm"), true), before: async () => log.push("read") });
  ok("the read runs once, after the confirm and before any part's Yes-run", log.join() === "A:no,B:no,confirm,read,A:yes,B:yes", log.join());
}

{
  // The caller's hold on the library spans the asking pass exactly: every part's
  // No inside it, the confirm and every Yes outside.
  const log = [];
  const parts = ["A", "B"].map((label) => ({
    label,
    run: async (ask) => {
      const yes = await ask({ lines: [label], title: "reimportTitle" });
      log.push(`${label}:${yes ? "yes" : "no"}`);
      return yes;
    },
  }));
  const asking = async (pass) => {
    log.push("hold");
    await pass();
    log.push("release");
  };
  await reimportEverything({ mode: "repair", parts, asking, confirm: async () => (log.push("confirm"), true) });
  ok("the asking pass runs inside the caller's hold, once, and the Yes runs after it", log.join() === "hold,A:no,B:no,release,confirm,A:yes,B:yes", log.join());
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
