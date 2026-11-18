/**
 * Offline tests for a cast's range and target count (`cast-range.mjs`, the
 * `outOfRange` and `tooManyTargets` verdicts in `cast-plan.mjs`, the readers in
 * `cast-spell.mjs`, and lib's `tokenGapFeet`). Foundry-free; every spell and
 * figure below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-range.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s) } };
globalThis.game = { i18n: { format: (key, data) => (data ? `${key}|${JSON.stringify(data)}` : key), localize: (key) => key } };
globalThis.Roll = class {};

const { rangeFeet, rangeVerdicts } = await import("../scripts/magic/cast-range.mjs");
const { castVerdicts, blocked, VERDICT } = await import("../scripts/magic/cast-plan.mjs");
const { castFiguresOf, castReach } = await import("../scripts/magic/cast-spell.mjs");
const { levelNeeded } = await import("../scripts/magic/cast-level.mjs");
const { dialogContext } = await import("../scripts/magic/apps/cast-dialog-model.mjs");
const { tokenGapFeet } = await import("../scripts/lib/distance-units.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};

/* ------------------------------------------------------------------ */
/*  rangeFeet                                                         */
/* ------------------------------------------------------------------ */

t("a distance and a touch-or-distance read the figure; a per-level distance reads it times the level; every other shape and a blank say nothing", () => {
  assert.deepEqual(rangeFeet({ shape: "distance", value: 40, unit: "feet" }, null), { value: 40, parts: [{ key: "figure", value: 40 }] });
  assert.equal(rangeFeet({ shape: "touchOrDistance", value: 25, unit: "feet" }, null).value, 25);
  assert.deepEqual(rangeFeet({ shape: "distancePerLevel", value: 10, unit: "feet" }, 3), { value: 30, parts: [{ key: "perLevel", value: 10 }, { key: "level", value: 3 }] });
  assert.equal(rangeFeet({ shape: "distancePerLevel", value: 10, unit: "feet" }, null), null, "no caster level, no figure");
  assert.equal(rangeFeet({ shape: "distancePerLevel", value: 10, unit: "feet" }, 0), null);
  for (const shape of ["self", "touch", "unlimited", "special", ""]) assert.equal(rangeFeet({ shape, value: 40, unit: "feet" }, 3), null, shape || "blank shape");
  for (const value of [null, undefined, "", 0, -5, "far"]) assert.equal(rangeFeet({ shape: "distance", value, unit: "feet" }, 3), null, `value ${JSON.stringify(value)}`);
  assert.equal(rangeFeet(null, 3), null);
  assert.equal(rangeFeet({ shape: "distance", value: 2, unit: "miles" }, null).value, 2 * 5280, "a unit converts through the scene unit table");
  assert.equal(rangeFeet({ shape: "distance", value: 7 }, null).value, 7, "a blank unit reads as feet");
});

/* ------------------------------------------------------------------ */
/*  rangeVerdicts                                                     */
/* ------------------------------------------------------------------ */

const folk = (...gaps) => ({ targets: gaps.map((_, i) => ({ key: `u${i}`, name: `Folk ${i}` })), gaps: Object.fromEntries(gaps.map((g, i) => [`u${i}`, g])) });
const within = (feet) => ({ value: feet, parts: [{ key: "figure", value: feet }] });

t("a creature target beyond the range is out, one exactly at it is not, and every measured gap is judged", () => {
  const got = rangeVerdicts({ ...folk(10, 40, 41.5), rangeFeet: within(40), model: "creature" });
  assert.deepEqual(got.out.map((o) => [o.key, o.gap]), [["u2", 41.5]]);
  assert.equal(got.limit, 40);
  assert.equal(got.unmeasured, false);
  for (const model of ["recipient", "hdPool", "object"]) assert.equal(rangeVerdicts({ ...folk(90), rangeFeet: within(40), model }).out.length, 1, model);
});

t("an area target may stand as far past the range as the area's reach; a blank extent judges none and says so", () => {
  const area = { ...folk(45, 55), rangeFeet: within(40), model: "area" };
  assert.deepEqual(rangeVerdicts({ ...area, extent: { radius: 10 } }).out.map((o) => o.key), ["u1"], "within range plus the reach");
  assert.deepEqual(rangeVerdicts({ ...area, extent: { radius: 10 } }).parts, [{ key: "figure", value: 40 }, { key: "reach", value: 10 }]);
  assert.equal(rangeVerdicts({ ...area, extent: { radius: 10 } }).limit, 50);
  assert.deepEqual(rangeVerdicts({ ...area, extent: { length: 12 } }).out.map((o) => o.key), ["u1"], "a length measure reaches its length");
  const blank = rangeVerdicts({ ...area, extent: { radius: null, length: null } });
  assert.deepEqual([blank.out, blank.unmeasured], [[], true]);
  assert.equal(rangeVerdicts({ ...area, extent: null }).out.length, 0);
});

t("no caster token or another scene leaves a gap null: that target is never judged, and the unmeasured note stands", () => {
  const got = rangeVerdicts({ ...folk(null, 99), rangeFeet: within(40), model: "creature" });
  assert.deepEqual(got.out.map((o) => o.key), ["u1"], "a measured target is still judged");
  assert.equal(got.unmeasured, true);
  const none = rangeVerdicts({ ...folk(null, null), rangeFeet: within(40), model: "creature" });
  assert.deepEqual([none.out, none.unmeasured], [[], true]);
});

t("no range figure, no targets, or a model the range is not measured to gives no verdict and no note", () => {
  const quiet = { limit: null, parts: [], out: [], unmeasured: false };
  assert.deepEqual(rangeVerdicts({ ...folk(99), rangeFeet: null, model: "creature" }), quiet);
  assert.deepEqual(rangeVerdicts({ targets: [], gaps: {}, rangeFeet: within(40), model: "creature" }), quiet);
  for (const model of ["self", "special", "structure", ""]) assert.deepEqual(rangeVerdicts({ ...folk(99), rangeFeet: within(40), model }), quiet, model || "blank model");
});

/* ------------------------------------------------------------------ */
/*  The verdicts                                                      */
/* ------------------------------------------------------------------ */

const ok = { capacity: { verdict: "ok" }, statuses: [] };
const outOf = rangeVerdicts({ ...folk(99), rangeFeet: within(40), model: "creature" });
const keyed = (v) => v.map((x) => `${x.key}:${x.severity}`);

t("out of range blocks a Player and warns a Judge, carrying the targets, the limit and the parts for the tooltip", () => {
  const player = castVerdicts({ ...ok, targets: [1], isGM: false, range: outOf });
  assert.deepEqual(keyed(player), ["outOfRange:block"]);
  assert.equal(blocked(player), true);
  assert.deepEqual([player[0].out[0].gap, player[0].limit, player[0].parts], [99, 40, [{ key: "figure", value: 40 }]]);
  const judge = castVerdicts({ ...ok, targets: [1], isGM: true, range: outOf });
  assert.deepEqual(keyed(judge), ["outOfRange:warn"]);
  assert.equal(blocked(judge), false);
  assert.deepEqual(castVerdicts({ ...ok, targets: [1], range: rangeVerdicts({ ...folk(10), rangeFeet: within(40), model: "creature" }) }), [], "in range, nothing");
  assert.deepEqual(castVerdicts({ ...ok, targets: [1] }), [], "no range given, nothing");
});

t("a target count the import read is a cap: more targets than it block a Player and warn a Judge; a blank count caps nothing", () => {
  const targets = [1, 2, 3];
  const player = castVerdicts({ ...ok, targets, isGM: false, count: 2 });
  assert.deepEqual(keyed(player), ["tooManyTargets:block"]);
  assert.deepEqual([player[0].max, player[0].over], [2, 1]);
  assert.deepEqual(keyed(castVerdicts({ ...ok, targets, isGM: true, count: 2 })), ["tooManyTargets:warn"]);
  assert.deepEqual(castVerdicts({ ...ok, targets, count: 3 }), [], "as many as the cap is fine");
  for (const count of [null, undefined, "", 0, -1, "many"]) assert.deepEqual(castVerdicts({ ...ok, targets, count }), [], `count ${JSON.stringify(count)}`);
  assert.equal(VERDICT.tooManyTargets, "tooManyTargets");
});

t("a declaring spell takes its targets when it resolves, so range and count are left to then", () => {
  const declaring = castVerdicts({ ...ok, targets: [1, 2, 3], range: outOf, count: 1, moment: "declare", declaration: null });
  assert.deepEqual(declaring.map((v) => v.key), [], "no range or count verdict at the declaring");
  const resolving = castVerdicts({ ...ok, targets: [1, 2, 3], range: outOf, count: 1, moment: "resolve", declaration: { valid: { pending: {} } } });
  assert.deepEqual(resolving.map((v) => v.key), ["outOfRange", "tooManyTargets"]);
});

/* ------------------------------------------------------------------ */
/*  Reading the spell and the world                                   */
/* ------------------------------------------------------------------ */

const tok = (uuid, name) => ({ uuid, name, actor: {} });
const spellOf = (flag, extra = {}) => ({ flags: { "acks-extras": { spell: flag, ...extra } } });
const lv = (flat) => ({ kind: "flat", flat });
const perLevel = (base, per) => ({ kind: "perLevel", base, per });

t("the copy's range and target are read, else its library twin's", () => {
  const own = spellOf({ range: { shape: "distance", value: 30, unit: "feet" }, target: { model: "creature" } });
  assert.equal(castFiguresOf(own, { byCookbookId: () => null }).range.value, 30);
  const twin = spellOf({ range: { shape: "distance", value: 80, unit: "feet" }, target: { model: "area" }, cite: "p. 3" });
  const bare = spellOf({}, { cookbook: { id: "def.spell.testRange" } });
  const lookups = { byCookbookId: (type, id) => (id === "def.spell.testRange" ? twin : null) };
  const got = castFiguresOf(bare, lookups);
  assert.deepEqual([got.range.value, got.target.model], [80, "area"]);
  assert.equal(got.cite, "p. 3", "the page reference follows the copy the range is read from");
  assert.deepEqual(castFiguresOf(bare, { byCookbookId: () => null }), { range: null, target: null, cite: "" });
});

t("castReach reads the range, an area's extent and the count at the caster level, and reads nothing it was not given", () => {
  const tokens = [tok("T.a", "Folk A"), tok("T.b", "Folk B")];
  const figures = { range: { shape: "distancePerLevel", value: 10, unit: "feet" }, target: { model: "area", count: lv(null), area: { shape: "sphere", measure: "radius", size: lv(20), unit: "feet" } } };
  const gaps = { "T.a": 70, "T.b": 100 };
  const at4 = castReach({ figures, level: 4, tokens, gaps });
  assert.equal(at4.range.limit, 40 + 20, "range per level plus the radius, at level 4");
  assert.deepEqual(at4.range.out.map((o) => o.key), ["T.a", "T.b"]);
  assert.equal(at4.count, null);
  const noLevel = castReach({ figures, level: null, tokens, gaps });
  assert.deepEqual([noLevel.range.out, noLevel.range.limit], [[], null], "nothing is judged until a level is known");
  const capped = castReach({ figures: { range: null, target: { model: "creature", count: lv(2) } }, level: null, tokens, gaps: {} });
  assert.equal(capped.count, 2);
  assert.deepEqual(castReach({ figures: { range: null, target: null }, level: 3, tokens, gaps: {} }), { range: { limit: null, parts: [], out: [], unmeasured: false }, count: null });
});

t("a per-level range, count or area asks for the caster level", () => {
  assert.equal(levelNeeded({ range: { shape: "distancePerLevel" } }, []), true);
  assert.equal(levelNeeded({ target: { count: perLevel(1, 1) } }, []), true);
  assert.equal(levelNeeded({ target: { area: { size: perLevel(0, 5) } } }, []), true);
  assert.equal(levelNeeded({ range: { shape: "distance" }, target: { count: lv(2), area: { size: lv(10) } } }, []), false);
});

/* ------------------------------------------------------------------ */
/*  The dialog and the lib measure                                    */
/* ------------------------------------------------------------------ */

t("the dialog shows the range verdict with a tooltip naming each target, its distance and the range's parts, and the note where range was not measured", () => {
  const verdict = castVerdicts({ ...ok, targets: [1], isGM: true, range: rangeVerdicts({ ...folk(99.04), rangeFeet: { value: 40, parts: [{ key: "perLevel", value: 10 }, { key: "level", value: 4 }] }, model: "creature" }) });
  const ctx = { modes: ["normal"], groups: { normal: [] }, level: {}, targets: [], verdicts: { normal: verdict }, cite: "p. 9", rangeUnmeasured: true, caster: { name: "Caster" } };
  const out = dialogContext(ctx, {});
  const item = out.footer.verdicts[0];
  assert.equal(item.severity, "warn");
  assert.match(item.text, /notice\.verdict\.outOfRange\|.*Folk 0/, "the names are in the line itself, not only in the tooltip");
  assert.match(item.tip, /tip\.range\|/);
  const tip = JSON.parse(item.tip.split("|").slice(1).join("|"));
  assert.match(tip.targets, /tip\.rangeTarget\|.*Folk 0.*99/);
  assert.match(tip.parts, /tip\.rangePart\.perLevel\|.*10.* · .*tip\.rangePart\.level\|.*4/);
  assert.equal(tip.cite, "p. 9");
  assert.match(out.bucket.rangeNote, /^ACKS-MAGIC\.cast\.dialog\.rangeUnmeasured/);
  assert.equal(dialogContext({ ...ctx, rangeUnmeasured: false }, {}).bucket.rangeNote, "");
  const many = dialogContext({ ...ctx, verdicts: { normal: castVerdicts({ ...ok, targets: [1, 2, 3], count: 1 }) } }, {}).footer.verdicts[0];
  assert.match(many.tip, /tip\.cite\|.*p\. 9/, "the count's figure carries the page reference");
  assert.equal(dialogContext({ ...ctx, cite: "", verdicts: { normal: castVerdicts({ ...ok, targets: [1, 2, 3], count: 1 }) } }, {}).footer.verdicts[0].tip, "");
  assert.match(many.text, /tooManyTargets\|.*"max":1.*"over":2/);
});

const sceneOf = (over = {}) => ({ id: "s1", grid: { units: "yd", size: 100, measurePath: ([a, b]) => ({ distance: (Math.hypot(b.x - a.x, b.y - a.y) / 100) * 5 }), ...over } });

t("tokenGapFeet is centre to centre through the scene grid and its unit, and null where it cannot be told", () => {
  const scene = sceneOf();
  const a = { parent: scene, x: 0, y: 0, width: 1, height: 1 };
  const b = { parent: scene, x: 300, y: 0, width: 1, height: 1 };
  assert.equal(tokenGapFeet(a, b), 15 * 3, "three cells of five yards, in feet");
  const big = { parent: scene, x: 300, y: 0, width: 3, height: 3, getCenterPoint: () => ({ x: 450, y: 150 }) };
  assert.ok(Math.abs(tokenGapFeet(a, big) - ((Math.hypot(400, 100) / 100) * 5 * 3)) < 1e-9, "the document's own centre point is used where it gives one");
  assert.equal(tokenGapFeet(a, null), null, "a missing token");
  assert.equal(tokenGapFeet(null, b), null);
  assert.equal(tokenGapFeet(a, { ...b, parent: { ...sceneOf(), id: "s2" } }), null, "another scene");
  assert.equal(tokenGapFeet(a, { ...b, parent: null }), null);
  assert.equal(tokenGapFeet({ ...a, parent: sceneOf({ measurePath: undefined }) }, b), null, "a grid that cannot measure");
});

console.log(`\n${n} cast range tests passed`);
