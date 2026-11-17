/**
 * The trap sheet's views: the level strip says its state in words, the pit's
 * damage and the trigger band carry the world's figures with the page each was
 * read from, and a part the world does not hold is its page reference alone.
 *
 * Every figure, cite and label here is invented. Run: node tools/test-trap-sheet-view.mjs
 */
import assert from "node:assert/strict";

globalThis.game = { i18n: { localize: (k) => k, format: (k, d = {}) => k } };
// The sheet module subclasses core's item sheet at load; nothing here constructs one.
globalThis.foundry = {
  applications: { api: { HandlebarsApplicationMixin: (B) => B }, sheets: { ItemSheetV2: class {} } },
};

const { levelStripView, pitTooltip, triggerBandView } = await import("../scripts/formation/trap-sheet.mjs");

let pass = 0;
const check = (label, fn) => {
  try {
    fn();
    pass++;
  } catch (err) {
    console.error(`FAIL ${label}`);
    throw err;
  }
};

/** A formatter that names the key and the data it was given, so a figure's presence is readable. */
const loc = (key, data = {}) => `${key}${Object.keys(data).length ? JSON.stringify(data) : ""}`;
const REF_TRAP = "ACKS-FORMATION.traps.ref.trap";
const REF_SPIKES = "ACKS-FORMATION.traps.ref.spikes";
const REF_FALL = "ACKS-FORMATION.crossing.ref.jumping";
const FALL = { count: 3, faces: 8, feetPerDie: 7 };
const SPIKE = { count: "2d4", faces: 12 };
const CITES = { fall: "ZZ p.41", pitSpikeCount: "ZZ p.43", trapTriggerOn: "ZZ p.45" };
const cite = (table) => CITES[table] ?? null;
const noCite = () => null;

check("the strip names each level's state, the one on screen, and counts the filled", () => {
  const rows = [{ text: "something" }, {}, { damageFormula: "2d6" }, { attackThrow: 11 }, { pitDepthFeet: 30 }, {}];
  const { steps, summary } = levelStripView(rows, 3, 6, loc);
  assert.deepEqual(steps.map((s) => s.stated), [true, false, true, true, true, false]);
  assert.deepEqual(steps.map((s) => s.current), [false, false, true, false, false, false]);
  assert.equal(steps[0].label, 'ACKS-FORMATION.traps.strip.filled{"level":1}');
  assert.equal(steps[1].label, 'ACKS-FORMATION.traps.strip.blank{"level":2}');
  assert.equal(steps[2].label, 'ACKS-FORMATION.traps.strip.currentFilled{"level":3}');
  assert.equal(summary, 'ACKS-FORMATION.traps.strip.summary{"level":3,"max":6,"filled":4}');
});

check("a blank row on screen reads as blank and on screen; a missing array is all blank", () => {
  const { steps } = levelStripView([{}, {}], 2, 4, loc);
  assert.equal(steps[1].label, 'ACKS-FORMATION.traps.strip.currentBlank{"level":2}');
  assert.equal(levelStripView(undefined, 1, 4, loc).steps.filter((s) => s.stated).length, 0);
});

check("a level past the strip is held to its ends in the summary", () => {
  assert.match(levelStripView([], 9, 6, loc).summary, /"level":6/);
  assert.match(levelStripView([], 0, 6, loc).summary, /"level":1/);
});

check("a pit with every part imported carries the depth, the dice and the spikes, each with its page", () => {
  const tip = pitTooltip({ depthFeet: 40, spiked: true, figures: { fall: FALL, spike: SPIKE }, unknown: [], cite, loc });
  const parts = tip.split(" · ");
  assert.equal(parts.length, 3, "depth, fall dice, spike dice");
  assert.match(parts[0], /fallPart\.depth 40$/);
  assert.match(parts[1], /"count":3,"faces":8,"feet":7\} \(ZZ p\.41\)$/);
  assert.match(parts[2], /"count":"2d4","faces":12\} \(ZZ p\.43\)$/);
});

check("an unspiked pit names no spikes", () => {
  const tip = pitTooltip({ depthFeet: 40, spiked: false, figures: { fall: FALL, spike: SPIKE }, unknown: [], cite, loc });
  assert.ok(!tip.includes("spikes"));
});

check("a spiked pit with no spike figures keeps the spikes' page reference and no figure", () => {
  const tip = pitTooltip({ depthFeet: 40, spiked: true, figures: { fall: FALL, spike: null }, unknown: ["spikes"], cite, loc });
  const spikes = tip.split(" · ").at(-1);
  assert.equal(spikes, REF_SPIKES);
  assert.ok(!/\d/.test(spikes), "no digit stands in the spikes' place");
  assert.match(tip, /ZZ p\.41/, "the imported fall keeps its page");
});

check("no fall import: the depth and the page reference alone, no dice", () => {
  const tip = pitTooltip({ depthFeet: 40, spiked: false, figures: { fall: null, spike: null }, unknown: ["fall"], cite, loc });
  const parts = tip.split(" · ");
  assert.equal(parts.length, 2);
  assert.equal(parts[1], REF_FALL);
  assert.ok(!tip.includes("fallDice"), "no fall dice are named");
});

check("a part imported with no page (an override) falls back to the shipped reference", () => {
  const tip = pitTooltip({ depthFeet: 40, spiked: true, figures: { fall: FALL, spike: SPIKE }, unknown: [], cite: noCite, loc });
  assert.match(tip, new RegExp(`\\(${REF_FALL}\\)`));
  assert.match(tip, new RegExp(`\\(${REF_SPIKES}\\)`));
});

check("a pit nothing is imported for still has a tooltip, and a spiked one has both references", () => {
  const tip = pitTooltip({ depthFeet: 40, spiked: true, figures: { fall: null, spike: null }, unknown: ["fall", "spikes"], cite: noCite, loc });
  assert.deepEqual(tip.split(" · ").slice(1), [REF_FALL, REF_SPIKES]);
});

check("the trigger band: a typed figure is the trap's own and names the imported one it stands over", () => {
  const over = triggerBandView({ own: 5, imported: 2, cite, loc });
  assert.equal(over.text, "5");
  assert.equal(over.tip, 'ACKS-FORMATION.traps.band.ownOver{"band":2,"page":"ZZ p.45"}');
  const alone = triggerBandView({ own: 5, imported: null, cite: noCite, loc });
  assert.equal(alone.tip, `ACKS-FORMATION.traps.band.own{"page":"${REF_TRAP}"}`);
});

check("a typed 0 is a figure in force", () => {
  assert.equal(triggerBandView({ own: 0, imported: 2, cite, loc }).text, "0");
});

check("a blank band reads the imported one and names its page, else the shipped reference", () => {
  const read = triggerBandView({ own: null, imported: 2, cite, loc });
  assert.equal(read.text, "2");
  assert.equal(read.tip, 'ACKS-FORMATION.traps.band.imported{"page":"ZZ p.45"}');
  assert.match(triggerBandView({ own: undefined, imported: 2, cite: noCite, loc }).tip, new RegExp(REF_TRAP));
});

check("a band nothing holds is blank, its tooltip the page reference alone", () => {
  assert.deepEqual(triggerBandView({ own: null, imported: null, cite: noCite, loc }), { text: "", tip: REF_TRAP });
});

console.log(`test-trap-sheet-view: ${pass} passed`);
