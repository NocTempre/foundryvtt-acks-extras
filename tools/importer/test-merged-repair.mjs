/**
 * The merged repair's two passes (`scripts/importer/merged-repair.mjs`) and
 * the pure pieces its writers stand on: the figure comparison a held figure
 * uses (`coversFigure`) and a market profile's per-field force
 * (`marketProfileUpdate`). The scopes here are invented passes that write
 * into a tally the way a shelf, a book or an adventure book does; every value
 * is invented. No Foundry.
 */
import assert from "node:assert";
import { decides, coversFigure, heldEdit, playStamp, actorChange } from "../../scripts/importer/held-edits.mjs";
import { mergedRepair, mergedStep, secondPass, uniqueEdits } from "../../scripts/importer/merged-repair.mjs";
import { mergedTally, repairWrite, countRepair } from "../../scripts/importer/refresh.mjs";
import { bookText } from "../../scripts/importer/prose.mjs";
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

/* --- pregenerated characters: listed on pass one, acted on by pass two as answered --- */
{
  const log = [];
  const pass = async (tally, { first }) => {
    await mergedStep(tally, "people", async () => {
      log.push(`people:${secondPass(tally) ? 2 : 1}`);
      if (!secondPass(tally)) {
        (tally.pregens ??= []).push({ uuid: "Actor.p1", name: "Hero", id: "zz.npc1" }, { uuid: "Actor.p1", name: "Hero", id: "zz.npc1" });
        return;
      }
      const answer = tally.decision?.pregens?.get("Actor.p1");
      if (answer === "restore") {
        tally.restored = (tally.restored ?? 0) + 1;
        (tally.kept ??= []).push("Actor.copy1");
      }
      if (answer === "rewrite") tally.rewritten = (tally.rewritten ?? 0) + 1;
    });
    await mergedStep(tally, "places", async () => log.push(`places:${secondPass(tally) ? 2 : 1}`));
    return first ? { scope: "people" } : {};
  };
  let offered = null;
  const restored = await mergedRepair({ pass, choose: async (edits, more) => ((offered = more.pregens), { take: new Set(), pregens: new Map([["Actor.p1", "restore"]]) }) });
  ok("the chooser is offered each character once, with no edits held", offered?.length === 1 && offered[0].uuid === "Actor.p1");
  ok("a character answered restore runs pass two over the step that listed it alone", log.join() === "people:1,places:1,people:2", log.join());
  ok("and is counted restored", restored.restored === 1 && restored.rewritten === 0 && restored.pregens === 1, JSON.stringify(restored));
  ok("the result carries pass two's kept copies", restored.kept.join() === "Actor.copy1", JSON.stringify(restored.kept));
  log.length = 0;
  const rewritten = await mergedRepair({ pass, choose: async () => ({ take: new Set(), pregens: new Map([["Actor.p1", "rewrite"]]) }) });
  ok("a character answered rewrite is counted rewritten from pass two, and keeps no copy", rewritten.rewritten === 1 && rewritten.restored === 0 && rewritten.kept.length === 0, JSON.stringify(rewritten));
  log.length = 0;
  const left = await mergedRepair({ pass, choose: async () => ({ take: new Set(), pregens: new Map([["Actor.p1", "leave"]]) }) });
  ok("a character left runs nothing more", log.join() === "people:1,places:1" && left.restored === 0 && !("second" in left), log.join());
  log.length = 0;
  await mergedRepair({ pass, choose: async () => null });
  ok("a closed choice leaves it too", log.join() === "people:1,places:1");
  log.length = 0;
  const told = await mergedRepair({ pass, decision: "take", choose: async () => assert.fail("asked") });
  ok("a caller's word decision asks nothing and leaves every character", log.join() === "people:1,places:1" && told.restored === 0);
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

/* --- a library document is reset whole: its name and picture are listed on pass one, written on pass two --- */
{
  const stored = { name: "Hall", img: "pictures/old.webp", type: "monster", system: { ac: { value: 5 } } };
  const built = { name: "Great Hall", img: "modules/fixture/art/hall.png", type: "monster", system: { ac: { value: 6 } } };
  const doc = () => {
    const d = { uuid: "Compendium.fixture.shelf.Actor.lib1", name: stored.name, toObject: () => structuredClone(stored), updates: [], async update(u) { d.updates.push(u); } };
    return d;
  };
  const first = doc();
  const one = mergedTally("keep");
  await repairWrite(first, built, {}, one);
  ok("pass one lists the name and the picture and writes neither", one.edits.map((e) => e.path).join() === "name,img" && !("name" in first.updates[0]) && !("img" in first.updates[0]), JSON.stringify(first.updates));
  const second = doc();
  const two = mergedTally({ take: new Set(), pregens: new Map(), all: "take" });
  await repairWrite(second, built, {}, two);
  ok("a decision that takes all writes both, and holds nothing", second.updates[0].name === "Great Hall" && second.updates[0].img === "modules/fixture/art/hall.png" && two.edits.length === 0, JSON.stringify(second.updates));
  let listed = null;
  const log = [];
  const pass = async (tally) => {
    const d = doc();
    await repairWrite(d, built, {}, tally);
    log.push(secondPass(tally) ? 2 : 1);
    return { scope: "invented" };
  };
  const out = await mergedRepair({ pass, choose: async (edits) => ((listed = edits), { take: new Set(edits.map((e) => e.key)), pregens: new Map(), all: "take" }) });
  ok("the chooser is handed the reset's lines, and applying them runs pass two", listed?.length === 2 && log.join() === "1,2", log.join());
  ok("and they are counted taken", out.taken === 2 && out.held === 0, JSON.stringify([out.taken, out.held]));
}

/* --- an actor changed since its import is held back on pass one and answered on pass two --- */
{
  const page = bookText(["The book's passage."], "XX p.9", { id: "def.monster.test", book: "xx", page: 11 });
  const built = { type: "monster", name: "Brute", system: { details: { biography: page }, hp: { max: 9 } } };
  const policy = { prose: ["details.biography"] };
  const JUDGE = "<p>The Judge's own note.</p>";
  /** A library actor: `stored` is what it holds, `stampOf` the data its recorded stamp was taken from (none: unstamped). */
  const actor = (n, stored, stampOf = null) => {
    const data = { name: "Brute", type: "monster", system: { details: { biography: page }, hp: { max: 9 } }, ...stored };
    const d = {
      documentName: "Actor", type: "monster", uuid: `Compendium.fixture.shelf.Actor.mon${n}`, name: data.name,
      flags: { "acks-extras": { cookbook: { id: `zz.monster.${n}` }, ...(stampOf ? { playStamp: playStamp(stampOf) } : {}) } },
      toObject: () => structuredClone(data), updates: [], async update(u) { d.updates.push(u); },
    };
    return d;
  };
  const asking = (decision = "keep") => Object.assign(mergedTally(decision), { asking: true });
  const hp = (max, biography = page) => ({ system: { details: { biography }, hp: { max } } });
  const pristine = actor(1, {});
  const played = actor(2, hp(30), { name: "Brute", ...hp(9) });
  const judged = actor(3, hp(9, JUDGE));
  const renamed = actor(4, { name: "Big Brute" }, { name: "Big Brute", ...hp(9) });
  const stampedDrift = actor(5, {}, { name: "Brute", system: { hp: { max: 1 } } });
  ok("a stamp that moved is a change; an unstamped actor with no edit is not", actorChange({ stamp: "x", data: pristine.toObject(), edits: [] }).moved && !actorChange({ data: pristine.toObject(), edits: [] }).changed);
  ok("a name or picture alone is no edit that counts", !actorChange({ data: pristine.toObject(), edits: [{ path: "name" }, { path: "img" }] }).changed && actorChange({ data: pristine.toObject(), edits: [{ path: "system.x" }] }).edits === 1);

  const one = asking();
  for (const a of [pristine, played, judged, renamed, stampedDrift]) countRepair(one, await repairWrite(a, built, policy, one));
  ok("pass one writes an unchanged actor, and one whose only difference is its name", pristine.updates.length === 1 && renamed.updates.length === 1, JSON.stringify([pristine.updates.length, renamed.updates.length]));
  ok("it holds back an actor whose stamp moved, and one holding an edit of its own", played.updates.length === 0 && judged.updates.length === 0 && stampedDrift.updates.length === 0);
  ok("each is listed once, with its edit count and whether it has no record",
    one.pregens.map((r) => r.uuid.split(".").pop()).join() === "mon2,mon3,mon5" && one.pregens[1].edits === 1 && one.pregens[1].unstamped === true && !one.pregens[0].unstamped && one.pregens[0].moved === true, JSON.stringify(one.pregens));
  ok("and a held-back actor counts neither written nor refused", one.replaced === 2 && one.refused === 0, JSON.stringify([one.replaced, one.refused]));
  ok("a pass that is not asking writes a changed actor as it always did", await (async () => {
    const t = mergedTally("keep");
    const a = actor(6, hp(30), { system: { hp: { max: 1 } } });
    await repairWrite(a, built, policy, t);
    return a.updates.length === 1 && !t.pregens;
  })());

  /** A pass-two tally answering by `answers`, with a copy keeper that records what it kept. */
  const second = (answers) => {
    const t = Object.assign(mergedTally({ take: new Set(), pregens: new Map(answers), all: "take" }), { answered: true, steps: new Set(["actors"]) });
    t.keptDocs = [];
    t.keepCopy = async (doc) => (t.keptDocs.push(doc.uuid), { uuid: `${doc.uuid}.copy` });
    return t;
  };
  const a2 = actor(2, hp(30), { system: { hp: { max: 1 } } });
  const a3 = actor(3, hp(9, JUDGE));
  const a7 = actor(7, hp(9, "<p>Another note.</p>"));
  const a8 = actor(8, {});
  const two = second([[a2.uuid, "restore"], [a3.uuid, "leave"], [a7.uuid, "rewrite"]]);
  for (const a of [a2, a3, a7, a8]) countRepair(two, await repairWrite(a, built, policy, two));
  ok("keep a copy: the copy is made first, then the actor is written whole, in place", two.keptDocs.join() === a2.uuid && a2.updates.length === 1 && two.kept.join() === `${a2.uuid}.copy` && two.restored === 1);
  ok("leave: nothing is written and nothing counted", a3.updates.length === 0);
  ok("reset: the actor is written whole, the edit it held replaced by the book's", a7.updates.length === 1 && a7.updates[0].system.details.biography.includes("The book's passage.") && two.rewritten === 1 && two.edits.length === 0);
  ok("an actor pass one did not list is written as before, and the answers count what was written", a8.updates.length === 1 && two.replaced === 3, String(two.replaced));
  const refusing = second([[a2.uuid, "restore"]]);
  refusing.keepCopy = async () => null;
  const a9 = actor(2, hp(30), { system: { hp: { max: 1 } } });
  await repairWrite(a9, built, policy, refusing);
  ok("a copy that is refused leaves the actor whole, counted refused", a9.updates.length === 0 && refusing.pregenRefused === 1);

  let offered = null;
  const log = [];
  const docs = [actor(2, hp(30), { system: { hp: { max: 1 } } }), actor(1, {})];
  const pass = async (tally) => {
    await mergedStep(tally, "actors", async () => {
      log.push(secondPass(tally) ? 2 : 1);
      for (const d of docs) countRepair(tally, await repairWrite(d, built, policy, tally));
    });
    return { scope: "invented" };
  };
  const out = await mergedRepair({
    pass,
    makeTally: (d) => Object.assign(mergedTally(d), { keepCopy: async (doc) => ({ uuid: `${doc.uuid}.copy` }) }),
    choose: async (edits, more) => ((offered = more.pregens), { take: new Set(), pregens: new Map([[more.pregens[0].uuid, "restore"]]), all: "take" }),
  });
  ok("a step that listed only a changed actor runs again on pass two", offered?.length === 1 && log.join() === "1,2", log.join());
  ok("the result counts the copy and the actor written over", out.restored === 1 && out.kept.length === 1 && out.pregens === 1, JSON.stringify([out.restored, out.kept, out.pregens]));
  ok("and an actor a repair wrote lists nothing the next time", await (async () => {
    const t = asking();
    const again = actor(10, {}, { name: "Brute", ...hp(9) });
    await repairWrite(again, built, policy, t);
    return !t.pregens && again.updates.length === 1;
  })());
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
