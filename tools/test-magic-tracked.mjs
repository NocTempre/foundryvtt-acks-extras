/**
 * Offline tests for the tracked spell kinds (illusion, detect, light, dispel,
 * createObject, wall) and the ward row beside them: a tracked row is a card line
 * plus a caster record that lasts the cast, with nothing rolled or thrown for it,
 * and a ward row is a section of the card like a modifier. Runs `castSpellRun`
 * through its own dependencies; Foundry-free, and every spell, key and duration
 * below is invented, so this file carries no book content.
 *
 * Usage: node tools/test-magic-tracked.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };
globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 7;
    this.result = "3 + 4";
    return this;
  }
};

const { rowsOf, rowNeedsThrow, hasReversedRows } = await import("../scripts/magic/cast-rows.mjs");
const { isModRow } = await import("../scripts/magic/cast-mods.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { castSpellRun } = await import("../scripts/magic/cast-spell.mjs");
const { describeSpellEffect } = await import("../scripts/magic/describe.mjs");
const { castDuration, NONE } = await import("../scripts/magic/cast-duration.mjs");

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
  console.log(`ok - ${name}`);
};
const ta = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const NO_TWIN = { byCookbookId: () => null, fromUuidSync: () => null };
const TIMED = { shape: "fixed", value: 3, unit: "rounds" };
const UNTIMED = { shape: "special" };

/** An invented spell item carrying the given rows and duration in its flag. */
const spell = (rows, duration = TIMED) => ({
  type: "spell",
  name: "Testglimmer",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  flags: { "acks-extras": { spell: { effects: rows, duration } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1" },
});

/** The dependencies of a run, recorded. */
function runDeps(mode = "normal") {
  const calls = { posts: [], records: [], applied: [], notices: [], spends: 0 };
  return {
    calls,
    deps: {
      lookups: NO_TWIN,
      read: async () => ({ actor: {}, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false } }),
      ask: async () => ({ mode, picks: {} }),
      notify: (level, key) => calls.notices.push([level, key]),
      adjustPool: async () => {},
      castId: () => "castT",
      roll: () => 1,
      post: async (c) => {
        calls.posts.push(c);
        return { id: "m1", flags: { "acks-extras": { castCard: c } } };
      },
      apply: async (...args) => calls.applied.push(args),
      record: async (c, data) => calls.records.push(data),
      throwRow: async () => null,
      now: () => 10,
      isGM: () => false,
    },
  };
}

/** Cast `item` once in `mode`; the recorded run and its one posted card. */
async function cast(item, mode = "normal") {
  const run = runDeps(mode);
  const out = await castSpellRun(item, () => run.calls.spends++, run.deps);
  assert.equal(out.ok, true);
  return { ...run, card: run.calls.posts[0] };
}

const track = (type, over = {}) => ({ key: `${type}Row`, type, appliesTo: "area", lasts: "duration", ...over });
const TRACKED = ["illusion", "detect", "light", "dispel", "createObject", "wall"];

for (const type of TRACKED) {
  await ta(`a ${type} row that lasts the duration is one card line and writes one caster record, with nothing rolled`, async () => {
    const { calls, card } = await cast(spell([track(type)]));
    assert.equal(card.lines.length, 1, "one line");
    assert.ok(card.lines[0].length > 0, "and it says something");
    assert.deepEqual([card.order, card.rows, card.targets, card.entries], [[], {}, {}, {}], "no row, no target, no entry: a tracked row rolls nothing");
    assert.equal(calls.records.length, 1, "one record");
    const record = spellEffectOf(calls.records[0]);
    assert.equal(record.role, "caster");
    assert.deepEqual(record.duration, { value: 3, units: "rounds" });
    assert.equal(calls.spends, 1);
    assert.deepEqual(calls.applied, [], "nothing to apply");
  });
}

await ta("several tracked rows lasting the duration still write one record, and their lines all reach the card", async () => {
  const { calls, card } = await cast(spell([track("illusion", { key: "a" }), track("detect", { key: "b" }), track("wall", { key: "c" })]));
  assert.equal(calls.records.length, 1);
  assert.equal(card.lines.length, 3);
});

await ta("a tracked row that is instant writes no record on a timed spell, and is still a card line", async () => {
  assert.notDeepEqual(castDuration(TIMED), { none: NONE.untimed }, "the spell is timed, so the lack of a record is the row's");
  const { calls, card } = await cast(spell([track("detect", { lasts: "instant" })]));
  assert.equal(calls.records.length, 0, "an instant row leaves no record");
  assert.equal(card.lines.length, 1);
  const mixed = await cast(spell([track("detect", { key: "once", lasts: "instant" }), track("illusion", { key: "stays" })]));
  assert.equal(mixed.calls.records.length, 1, "one lasting row among instant ones writes the one record");
  assert.equal(mixed.card.lines.length, 2);
});

await ta("a tracked row on an untimed spell writes no record, whatever it lasts", async () => {
  assert.deepEqual(castDuration(UNTIMED), { none: NONE.untimed });
  const { calls, card } = await cast(spell([track("illusion")], UNTIMED));
  assert.equal(calls.records.length, 0, "no clock to end it by");
  assert.equal(card.lines.length, 1);
});

await ta("a reversed twin brings the reverse mode: each form posts only its own line and records its own cast", async () => {
  const rows = [track("detect", { key: "glow", appliesTo: "area" }), track("detect", { key: "glowReversed", appliesTo: "target", reversed: true })];
  const item = spell(rows);
  assert.equal(hasReversedRows(rowsOf(item, NO_TWIN).rows), true, "the dialog offers the reverse");
  const normal = await cast(item, "normal");
  const reversed = await cast(item, "reversed");
  assert.equal(normal.card.mode, "normal");
  assert.equal(reversed.card.mode, "reversed");
  assert.equal(normal.card.lines.length, 1);
  assert.equal(reversed.card.lines.length, 1);
  assert.notEqual(normal.card.lines[0], reversed.card.lines[0], "the twin's row is the one read");
  assert.equal(normal.card.lines[0], describeSpellEffect(rows[0]).text);
  assert.equal(reversed.card.lines[0], describeSpellEffect(rows[1]).text);
  assert.equal(normal.calls.records.length, 1);
  assert.equal(reversed.calls.records.length, 1);
});

await ta("a ward row counts as a mod row: a section of the card and no line, and it lasts like the others", async () => {
  const ward = { key: "guard", type: "ward", appliesTo: "recipient", lasts: "duration" };
  assert.equal(isModRow(ward), true);
  assert.equal(isModRow(track("illusion")), false);
  const { calls, card } = await cast(spell([ward]));
  assert.deepEqual(card.order, ["guard"], "its own section");
  assert.deepEqual(card.lines, [], "not a line");
  assert.equal(calls.records.length, 1, "and one caster record");
  const view = castCardView(card, { isGM: true, canPress: true }, (key) => key);
  assert.equal(view.sections.length, 1);
  const mixed = await cast(spell([ward, track("illusion")]));
  assert.deepEqual([mixed.card.order, mixed.card.lines.length, mixed.calls.records.length], [["guard"], 1, 1], "beside a tracked row it is still one record");
});

await ta("a dispel row with no delivery is a line, not a throw row: no section, no Throw press, no apply press", async () => {
  const dispel = track("dispel", { appliesTo: "target", lasts: "instant" });
  assert.equal(dispel.delivery, undefined);
  assert.equal(rowNeedsThrow(dispel), false);
  assert.equal(rowNeedsThrow({ ...dispel, delivery: "melee" }), false, "only a damage row ever throws");
  const { calls, card } = await cast(spell([dispel]));
  assert.equal(card.lines.length, 1);
  assert.deepEqual(card.rows, {});
  assert.equal(calls.records.length, 0);
  const view = castCardView(card, { isGM: true, canPress: true }, (key) => key);
  assert.deepEqual([view.sections, view.buttons], [[], []], "nothing to throw and nothing to apply");
  assert.equal(view.footnote, card.lines[0]);
});

console.log(`\n${n} magic tracked tests passed`);
