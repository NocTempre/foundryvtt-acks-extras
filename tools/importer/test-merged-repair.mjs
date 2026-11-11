/**
 * The merged repair's two passes (`scripts/importer/merged-repair.mjs`) and
 * the pure pieces its writers stand on: the figure comparison a held figure
 * uses (`coversFigure`) and a market profile's per-field force
 * (`marketProfileUpdate`). The scopes here are invented passes that write
 * into a tally the way a shelf, a book or an adventure book does; every value
 * is invented. No Foundry.
 */
import assert from "node:assert";
import { decides, coversFigure, heldEdit } from "../../scripts/importer/held-edits.mjs";
import { mergedRepair, mergedStep, secondPass, uniqueEdits } from "../../scripts/importer/merged-repair.mjs";
import { mergedTally, repairWrite } from "../../scripts/importer/refresh.mjs";
import { marketProfileUpdate } from "../../scripts/importer/market-profile-binding.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

/**
 * A scope of two steps over invented documents. `notes` holds a Judge's edit
 * (its stored value differs from the page's); `stats` holds none. Each step
 * writes what the decision lets it and counts what it wrote; `log` records
 * every step run and every confirm asked.
 */
function scope({ answer = true, editedBy = { "doc.a": "Judge text" } } = {}) {
  const docs = { "doc.a": { notes: editedBy["doc.a"] ?? "page A" }, "doc.b": { notes: "page B" } };
  const page = { "doc.a": "page A", "doc.b": "page B" };
  const log = [];
  const pass = async (tally, { first }) => {
    if (first) {
      log.push("confirm");
      if (!answer) return null;
    }
    await mergedStep(tally, "notes", async () => {
      log.push(`notes:${secondPass(tally) ? 2 : 1}`);
      for (const [id, doc] of Object.entries(docs)) {
        if (doc.notes !== page[id]) {
          const edit = heldEdit({ uuid: id, path: "system.notes", current: doc.notes, page: page[id] });
          if (decides(tally.decision, edit.key) !== "take") {
            tally.edits.push(edit);
            tally.replaced++;
            continue;
          }
          doc.notes = page[id];
        }
        tally.replaced++;
      }
    });
    await mergedStep(tally, "stats", async () => {
      log.push(`stats:${secondPass(tally) ? 2 : 1}`);
      tally.replaced++;
    });
    if (!secondPass(tally)) log.push("rebuild-once");
    return { scope: "invented" };
  };
  return { docs, log, pass };
}

/* --- pass one keeps, and keeping everything runs nothing more --- */
{
  const s = scope();
  let offered = null;
  const out = await mergedRepair({ pass: s.pass, choose: async (edits) => ((offered = edits), "keep") });
  ok("pass one holds the Judge's edit and writes the rest", s.docs["doc.a"].notes === "Judge text" && out.held === 1, JSON.stringify(out));
  ok("the chooser is offered the edit, with its page", offered?.length === 1 && offered[0].key === "doc.a#system.notes" && offered[0].page === "page A");
  ok("keeping it runs one pass", s.log.join() === "confirm,notes:1,stats:1,rebuild-once" && !("second" in out), s.log.join());
  ok("the result carries the scope's own fields, the merged counts and the edits still standing",
    out.scope === "invented" && out.mode === "repair" && out.replaced === 3 && out.taken === 0 && out.edits.length === 1, JSON.stringify(out));
}

/* --- taking an edit runs pass two over the edited steps only --- */
{
  const s = scope();
  const out = await mergedRepair({ pass: s.pass, choose: async (edits) => ({ take: new Set([edits[0].key]) }) });
  ok("taking it writes the page's value", s.docs["doc.a"].notes === "page A");
  ok("pass two runs only the step whose pass one held an edit, and asks no second confirm",
    s.log.join() === "confirm,notes:1,stats:1,rebuild-once,notes:2", s.log.join());
  ok("the counts are pass one's writes, not both passes' summed", out.replaced === 3, JSON.stringify(out));
  ok("one edit taken, none standing", out.taken === 1 && out.held === 0 && out.edits.length === 0, JSON.stringify(out));
  ok("pass two's result is carried apart", "second" in out && out.second?.scope === "invented");
}

/* --- a take-all and a partial decision --- */
{
  const s = scope({ editedBy: { "doc.a": "Judge text" } });
  s.docs["doc.b"].notes = "Judge B";
  const out = await mergedRepair({ pass: s.pass, choose: async () => ({ take: new Set(["doc.b#system.notes"]) }) });
  ok("a decision naming one of two takes that one and keeps the other",
    s.docs["doc.a"].notes === "Judge text" && s.docs["doc.b"].notes === "page B" && out.taken === 1 && out.held === 1, JSON.stringify(out));
  ok("the edit still standing is the one kept", out.edits.map((e) => e.key).join() === "doc.a#system.notes");
}

/* --- a No, a caller's decision, nothing held --- */
{
  const s = scope({ answer: false });
  let asked = 0;
  const out = await mergedRepair({ pass: s.pass, choose: async () => (asked++, "take") });
  ok("a No at the confirm returns null and asks nothing about edits", out === null && asked === 0 && s.docs["doc.a"].notes === "Judge text");

  const told = scope();
  asked = 0;
  const one = await mergedRepair({ pass: told.pass, decision: "take", choose: async () => (asked++, "keep") });
  ok("a caller's decision answers before anything is held: one pass, no chooser",
    asked === 0 && told.docs["doc.a"].notes === "page A" && told.log.join() === "confirm,notes:1,stats:1,rebuild-once" && one.held === 0, told.log.join());

  const clean = scope({ editedBy: {} });
  asked = 0;
  await mergedRepair({ pass: clean.pass, choose: async () => (asked++, "keep") });
  ok("with nothing held the chooser is never called", asked === 0);
}

/* --- the tally pass two writes into is the one its closure counts into --- */
{
  let made = 0;
  const makeTally = (decision) => {
    const tally = mergedTally(decision);
    made++;
    tally.recreate = () => (tally.recreated++, { recreated: {} });
    return tally;
  };
  const pass = async (tally, { first }) => {
    if (first) tally.edits.push(heldEdit({ uuid: "doc.c", path: "type", current: "a", page: "b" }));
    await tally.recreate();
    return {};
  };
  const out = await mergedRepair({ pass, makeTally, choose: async () => "take" });
  ok("each pass makes its own tally", made === 2);
  ok("a recreate in pass two counts into pass two's tally, and the result sums both passes'", out.recreated === 2, JSON.stringify(out));
}

/* --- finish runs once, after the last pass --- */
{
  const s = scope();
  const order = [];
  const finish = async (tally) => (order.push(secondPass(tally) ? "after-two" : "after-one"), "written");
  const out = await mergedRepair({ pass: s.pass, choose: async () => "take", finish });
  ok("finish runs once, after pass two, with pass two's tally", order.join() === "after-two" && out.after === "written");
  const kept = scope();
  const order2 = [];
  await mergedRepair({ pass: kept.pass, finish: async (tally) => order2.push(secondPass(tally) ? 2 : 1) });
  ok("and after pass one where no second pass runs", order2.join() === "1");
}

/* --- a step outside a merged pass --- */
{
  let ran = 0;
  await mergedStep(null, "x", async () => ran++);
  await mergedStep({ edits: [] }, "x", async () => ran++);
  ok("a step with no tally, or a tally of neither pass, always runs", ran === 2);
  ok("uniqueEdits keeps the first edit per key", uniqueEdits([{ key: "a", n: 1 }, { key: "b" }, { key: "a", n: 2 }]).map((e) => `${e.key}${e.n ?? ""}`).join() === "a1,b");
}

/* --- a build of another type: the tally's recreate answers the refusal --- */
{
  const doc = { uuid: "Item.typ0000000001", type: "item", toObject: () => ({ type: "item", system: {} }) };
  const built = { type: "weapon", system: {} };
  const tally = mergedTally("keep");
  const asked = [];
  tally.recreate = async (d, b) => (asked.push([d.uuid, b.type]), { recreated: { type: b.type }, update: {} });
  const out = await repairWrite(doc, built, {}, tally);
  ok("a type refusal under a tally that can recreate is handed to it", asked.join() === "Item.typ0000000001,weapon" && out.recreated?.type === "weapon", JSON.stringify(out));
  const bare = await repairWrite(doc, built, {}, mergedTally("keep"));
  ok("and stays a refusal where the tally cannot", bare.refused === "type");
}

/* --- coversFigure: a figure no stamp covers --- */
{
  const page = [{ uuid: "Actor.x", quantity: 2, notes: "2d4" }];
  ok("a stored roster holding the page's rows, defaults beside them, covers it",
    coversFigure([{ uuid: "Actor.x", quantity: 2, notes: "2d4", hidden: true, extra: 0 }], page));
  ok("a row the Judge changed does not", !coversFigure([{ uuid: "Actor.x", quantity: 5, notes: "2d4" }], page));
  ok("a row the Judge added does not", !coversFigure([...page, { uuid: "Actor.y", quantity: 1 }], page));
  ok("an emptied roster does not", !coversFigure([], page));
  ok("nested objects compare by the page's keys", coversFigure({ rows: [{ a: 1, b: 2 }], total: 3 }, { rows: [{ a: 1 }] }) && !coversFigure({ rows: [{ a: 2 }] }, { rows: [{ a: 1 }] }));
  ok("scalars compare equal, and a page with no value says nothing", coversFigure(3, 3) && !coversFigure(3, 4) && coversFigure("x", undefined));
}

/* --- marketProfileUpdate: force per field --- */
{
  const source = { book: "bk", page: "BK p.9" };
  const market = { marketClassOverride: 4, urbanFamilies: 900, goods: { demand: [{ key: "salt", dm: 1 }], dmProfile: { source: null } } };
  const profile = { market: "m1", marketClass: 2, families: 300, demand: [{ key: "salt", dm: -1 }] };
  const plain = marketProfileUpdate(market, profile, source);
  ok("unforced, a class, family count and base the Judge set are all left", !plain.wrote.marketClass && !plain.wrote.families && !plain.wrote.demand);
  const one = marketProfileUpdate(market, profile, source, { force: { families: true } });
  ok("a force naming one field writes that field alone",
    !one.wrote.marketClass && one.wrote.families && !one.wrote.demand && one.update["system.market.urbanFamilies"] === 300 && !("system.market.marketClassOverride" in one.update), JSON.stringify(one));
  const all = marketProfileUpdate(market, profile, source, { force: true });
  ok("force true writes all three, as before", all.wrote.marketClass && all.wrote.families && all.wrote.demand);
}

console.log(`test-merged-repair: ${pass} checks passed.`);
