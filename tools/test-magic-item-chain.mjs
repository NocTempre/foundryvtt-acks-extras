/**
 * The magic-item chain walker (`scripts/magic-items/chain-logic.mjs`) against
 * invented tables: every list, caption, band edge and item below is made up for
 * the test and is nothing a book prints. What is pinned is the procedure: the
 * die each roll asks for is read off the list's own bands, a hop is followed
 * only where the band names one, a tail is rolled again on a die of its own, and
 * a table that cannot be rolled ends the walk with the steps so far.
 */
import assert from "node:assert";
import { MAX_HOPS, listAt, walkChain } from "../scripts/magic-items/chain-logic.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

/** A roller that answers the given totals in order, with the sides of the die it was asked for. */
const rig = (...totals) => {
  const exprs = [];
  return { exprs, roll: (expr) => { exprs.push(expr); return { total: totals.shift(), sides: Number(expr.slice(2)) }; } };
};

const tables = () => ({
  kinds: {
    bands: [
      { min: 1, max: 3, item: "Zq Alpha", hop: "things.alpha" },
      { min: 4, max: 5, item: "Zq Beta", hop: "things.beta" },
      { min: 6, max: 6, item: "Zq Gamma", hop: null },
    ],
  },
  things: {
    alpha: [{ min: 1, max: 50, item: "Xx one", cues: "dim" }, { min: 51, max: 100, item: "Xx two" }],
    beta: [
      { min: 1, max: 7, item: "Xx three" },
      { min: 8, max: 8, sub: [{ min: 1, max: 4, item: "Xx four" }, { min: 5, max: 9, item: "Xx five" }] },
    ],
  },
});

/* --- two stages ---------------------------------------------------------------- */
{
  const r = rig(2, 51);
  const out = await walkChain({ tables: tables(), from: "kinds.bands", roll: r.roll });
  eq("a two-stage chain rolls the start list then the list it names", out.steps.map((s) => s.list), ["kinds.bands", "things.alpha"]);
  eq("each die is read off the list's own bands", r.exprs, ["1d6", "1d100"]);
  eq("a step records the die, the total and the band", out.steps[0], { list: "kinds.bands", die: "1d6", total: 2, band: { min: 1, max: 3 }, fields: { item: "Zq Alpha" } });
  eq("the item is the last step's text", out.item, { list: "things.alpha", text: "Xx two", fields: { item: "Xx two" }, flag: null, uuid: null });
  eq("no error", out.error, null);
  check("every step names its list and a whole-number total", out.steps.every((s) => typeof s.list === "string" && Number.isInteger(s.total)));
}
{
  const out = await walkChain({ tables: tables(), from: "kinds.bands", roll: rig(1, 10).roll });
  eq("fields are the band minus its structure", out.item.fields, { item: "Xx one", cues: "dim" });
}

/* --- three stages -------------------------------------------------------------- */
{
  const t = tables();
  t.mid = { bands: [{ min: 1, max: 2, item: "Zq Mid", hop: "kinds.bands" }] };
  const r = rig(2, 5, 3);
  const out = await walkChain({ tables: t, from: "mid.bands", roll: r.roll });
  eq("a hop may lead to a list that hops again", out.steps.map((s) => s.list), ["mid.bands", "kinds.bands", "things.beta"]);
  eq("three dice are asked for, one per list", r.exprs, ["1d2", "1d6", "1d8"]);
  eq("the last list's band is the item", out.item.text, "Xx three");
}

/* --- a tail is rolled again on a die of its own --------------------------------- */
{
  const r = rig(4, 8, 7);
  const out = await walkChain({ tables: tables(), from: "kinds.bands", roll: r.roll });
  eq("the outer face then the tail's own die", r.exprs, ["1d6", "1d8", "1d9"]);
  eq("the step records the inner roll", out.steps[1].inner, { die: "1d9", total: 7, band: { min: 5, max: 9 } });
  eq("the outer band is the face", out.steps[1].band, { min: 8, max: 8 });
  eq("the item is the inner band's", out.item.text, "Xx five");
  eq("fields come from the inner band only", out.item.fields, { item: "Xx five" });
}
{
  const t = tables();
  t.things.beta[1].sub = [{ min: 1, max: 4, item: "Xx four" }, { min: 6, max: 9, item: "Xx five" }];
  const out = await walkChain({ tables: t, from: "things.beta", roll: rig(8).roll });
  eq("a tail that does not tile ends the walk with the face rolled", [out.error, out.steps.length], [{ code: "bands-untiled", list: "things.beta" }, 0]);
}
{
  const t = tables();
  t.tail = { bands: [{ min: 1, max: 1, sub: [{ min: 1, max: 2, item: "Qq", hop: "things.alpha" }, { min: 3, max: 4, item: "Qq2", hop: "things.beta" }] }] };
  const out = await walkChain({ tables: t, from: "tail.bands", roll: rig(1, 4, 5).roll });
  eq("a hop on an inner band is followed", out.steps.map((s) => s.list), ["tail.bands", "things.beta"]);
}

/* --- hops that cannot be followed ---------------------------------------------- */
{
  const out = await walkChain({ tables: tables(), from: "kinds.bands", roll: rig(6).roll });
  eq("a band of a hop list with a null hop is flagged, not read as an item", [out.item.flag, out.steps.length, out.item.text], ["unresolved-hop", 1, "Zq Gamma"]);
}
{
  const t = tables();
  delete t.kinds.bands[0].hop;
  const out = await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll });
  eq("a band that lost its hop key in a list that still hops is flagged", [out.item.flag, out.steps.length], ["unresolved-hop", 1]);
}
{
  const t = tables();
  for (const b of t.kinds.bands) delete b.hop;
  const out = await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll });
  eq("a list with no hop key anywhere is a list of items", [out.item.flag, out.item.text, out.steps.length], [null, "Zq Alpha", 1]);
}
{
  const t = tables();
  t.kinds.bands[0].hop = "things.gone";
  const out = await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll });
  eq("a hop to a list that is not there keeps the item reached", [out.item.flag, out.item.hop, out.item.list, out.steps.length, out.error], ["missing-list", "things.gone", "kinds.bands", 1, null]);
}
{
  const t = { l: { a: [{ min: 1, max: 4, item: "Zq", hop: "l.b" }], b: [{ min: 1, max: 4, item: "Zq", hop: "l.a" }] } };
  const out = await walkChain({ tables: t, from: "l.a", roll: rig(1, 1, 1).roll });
  eq("a hop back to a list already rolled ends as a cycle", [out.item.flag, out.item.hop, out.steps.map((s) => s.list)], ["cycle", "l.a", ["l.a", "l.b"]]);
  const self = { l: { a: [{ min: 1, max: 4, item: "Zq", hop: "l.a" }] } };
  eq("a list hopping to itself is a cycle", (await walkChain({ tables: self, from: "l.a", roll: rig(1, 1).roll })).item.flag, "cycle");
}
{
  const chain = (n) => ({ c: Object.fromEntries(Array.from({ length: n }, (_, i) => [`l${i}`, [{ min: 1, max: 4, item: "Zq", hop: i + 1 < n ? `c.l${i + 1}` : null }]])) });
  const out = await walkChain({ tables: chain(6), from: "c.l0", roll: rig(1, 1, 1, 1, 1, 1).roll, maxHops: 2 });
  eq("a chain past the cap ends too-deep after cap+1 lists", [out.item.flag, out.item.hop, out.steps.length], ["too-deep", "c.l3", 3]);
  const long = await walkChain({ tables: chain(12), from: "c.l0", roll: () => ({ total: 1, sides: 4 }) });
  eq("the default cap is MAX_HOPS", [MAX_HOPS, long.item.flag, long.steps.length], [8, "too-deep", 9]);
  const exact = await walkChain({ tables: chain(9), from: "c.l0", roll: () => ({ total: 1, sides: 4 }) });
  eq("a chain of exactly MAX_HOPS hops is followed to its end", [exact.steps.length, exact.item.flag], [9, "unresolved-hop"]);
}

/* --- tables that cannot be rolled ----------------------------------------------- */
{
  const t = tables();
  t.things.alpha = [{ min: 1, max: 50, item: "Xx one" }, { min: 52, max: 100, item: "Xx two" }];
  const out = await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll });
  eq("a gap ends the walk and keeps the steps so far", [out.error, out.steps.length, out.item], [{ code: "bands-untiled", list: "things.alpha" }, 1, null]);
  t.things.alpha = [{ min: 1, max: 50, item: "Xx one" }, { min: 50, max: 100, item: "Xx two" }];
  eq("an overlap is the same", (await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll })).error.code, "bands-untiled");
  t.things.alpha = [{ min: 2, max: 100, item: "Xx one" }];
  eq("a list not starting at 1 is the same", (await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll })).error.code, "bands-untiled");
  t.things.alpha = [{ min: 1, max: 50, item: "Xx one" }, { __missing: true }];
  eq("a row the import could not read is the same", (await walkChain({ tables: t, from: "kinds.bands", roll: rig(1).roll })).error.code, "bands-untiled");
  eq("an untiled start list has no steps", (await walkChain({ tables: { s: { x: [{ min: 1, max: 3, item: "a" }, { min: 5, max: 6, item: "b" }] } }, from: "s.x", roll: rig(1).roll })).steps, []);
}
{
  const wrong = await walkChain({ tables: tables(), from: "kinds.bands", roll: () => ({ total: 2, sides: 20 }) });
  eq("a roller that threw another die is refused", [wrong.error, wrong.steps], [{ code: "die-mismatch", list: "kinds.bands" }, []]);
  for (const total of [0, 7, 2.5, "3", undefined]) {
    const out = await walkChain({ tables: tables(), from: "kinds.bands", roll: () => ({ total, sides: 6 }) });
    eq(`a total of ${String(total)} on a d6 is out of range`, out.error.code, "roll-out-of-range");
  }
  eq("a roller that throws is roll-failed", (await walkChain({ tables: tables(), from: "kinds.bands", roll: () => { throw new Error("no dice"); } })).error.code, "roll-failed");
  eq("a roller that rejects is roll-failed", (await walkChain({ tables: tables(), from: "kinds.bands", roll: async () => { throw new Error("no dice"); } })).error.code, "roll-failed");
  eq("a roller that answers nothing is roll-failed", (await walkChain({ tables: tables(), from: "kinds.bands", roll: () => null })).error.code, "roll-failed");
  const inner = await walkChain({ tables: tables(), from: "things.beta", roll: (expr) => ({ total: 8, sides: expr === "1d9" ? 10 : 8 }) });
  eq("the tail's die is checked too", [inner.error, inner.steps.length], [{ code: "die-mismatch", list: "things.beta" }, 0]);
}

/* --- sync and async rollers agree ------------------------------------------------ */
{
  const sync = await walkChain({ tables: tables(), from: "kinds.bands", roll: rig(2, 51).roll });
  const r = rig(2, 51);
  const async_ = await walkChain({ tables: tables(), from: "kinds.bands", roll: async (e) => r.roll(e) });
  eq("an async roller walks the same chain", async_, sync);
}

/* --- a start that is not there ---------------------------------------------------- */
{
  eq("a missing start is not-imported", (await walkChain({ tables: tables(), from: "nope.bands", roll: rig(1).roll })), { steps: [], item: null, error: { code: "not-imported", list: "nope.bands" } });
  eq("no tables is not-imported", (await walkChain({ tables: null, from: "kinds.bands", roll: rig(1).roll })).error.code, "not-imported");
  eq("an empty list is not-imported", (await walkChain({ tables: { a: { b: [] } }, from: "a.b", roll: rig(1).roll })).error.code, "not-imported");
  eq("an id with a third part names nothing", listAt(tables(), "kinds.bands.x"), null);
  eq("an id naming an inherited key names nothing", [listAt(tables(), "constructor.name"), listAt(tables(), "kinds.constructor")], [null, null]);
  eq("listAt finds a list", listAt(tables(), "things.alpha").length, 2);
}
{
  const out = await walkChain({ tables: { h: { r: [{ min: 1, max: 20, name: "Qq", cues: "dim" }] } }, from: "h.r", roll: rig(7).roll });
  eq("with no item field the text is the first text field", out.item.text, "Qq");
}

console.log(`test-magic-item-chain: ${pass} checks passed.`);
