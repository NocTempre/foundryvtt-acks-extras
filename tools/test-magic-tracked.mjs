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
const { castCardView, castCardContent } = await import("../scripts/magic/cast-card.mjs");
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
  const html = (c) => castCardContent(c.card, (key) => key);
  assert.ok(html(reversed).includes("note.reversed"), "the reverse card says it is reversed");
  assert.ok(!html(normal).includes("note.reversed"), "and the normal card does not");
});

await ta("a card whose rows are all lines still renders: the banner and the footnote carry every line", async () => {
  const { card } = await cast(spell([track("illusion", { key: "a" }), track("wall", { key: "c" })]));
  assert.deepEqual(card.order, [], "no row, so no section");
  const html = castCardContent(card, (key) => key);
  assert.ok(html !== "", "a tracked-only card is posted");
  assert.ok(html.includes("acks-extras-roll-footnote"), "the footnote is there");
  assert.ok(html.includes(card.lines.join(" · ")), "and it holds every line");
  assert.ok(!html.includes("<table"), "with no table");
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

// A light row's cast puts its light on the caster's record, the one the cast already writes.
const { MAGIC_LIGHT_CHANGE_KEYS } = await import("../scripts/lib/light.mjs");
const LIT = { daylight: null, bright: 30, dim: 60 };
const lit = (over = {}) => track("light", { key: "lamp", appliesTo: "caster", lightBands: LIT, ...over });
const litSpell = (rows, duration = TIMED) => {
  const item = spell(rows, duration);
  item.flags["acks-extras"].spell.cite = "RR 99";
  return item;
};
const figuresOf = (data) => Object.fromEntries((data.changes ?? []).map((c) => [c.key, c.value]));

await ta("a timed light cast writes its bands and the spell's page on the caster's record, with the clock the record already had", async () => {
  const { calls, card } = await cast(litSpell([lit()]));
  assert.equal(card.cite, "RR 99");
  assert.equal(calls.records.length, 1);
  const [data] = calls.records;
  assert.deepEqual(figuresOf(data), { [MAGIC_LIGHT_CHANGE_KEYS.daylight]: "", [MAGIC_LIGHT_CHANGE_KEYS.bright]: "30", [MAGIC_LIGHT_CHANGE_KEYS.dim]: "60" });
  assert.equal(data.flags["acks-extras"].magicLightCite, "RR 99");
  assert.equal(data.statuses, undefined, "no status");
  const record = spellEffectOf(data);
  assert.deepEqual([record.role, record.startTime, record.duration], ["caster", 10, { value: 3, units: "rounds" }]);
});

await ta("an untimed light cast writes a bare record with no clock, and the light stays on it", async () => {
  assert.deepEqual(castDuration(UNTIMED), { none: NONE.untimed });
  const { calls } = await cast(litSpell([lit()], UNTIMED));
  assert.equal(calls.records.length, 1);
  const record = spellEffectOf(calls.records[0]);
  assert.deepEqual([record.startTime, record.duration], [undefined, undefined]);
  assert.equal(figuresOf(calls.records[0])[MAGIC_LIGHT_CHANGE_KEYS.bright], "30");
  assert.equal(calls.records[0].flags["acks-extras"].magicLightCite, "RR 99");
});

await ta("several light rows on the caster write the largest figure of each band", async () => {
  const { calls } = await cast(litSpell([lit({ key: "a", lightBands: { bright: 20, dim: 80 } }), lit({ key: "b", lightBands: { bright: 40, dim: 10 } })]));
  assert.equal(calls.records.length, 1);
  assert.deepEqual([figuresOf(calls.records[0])[MAGIC_LIGHT_CHANGE_KEYS.bright], figuresOf(calls.records[0])[MAGIC_LIGHT_CHANGE_KEYS.dim]], ["40", "80"]);
});

await ta("a reversed cast writes no light, and the normal cast of the same spell writes its own", async () => {
  const item = litSpell([lit(), lit({ key: "gloom", reversed: true, lightBands: { bright: 99, dim: 99 } })]);
  const normal = await cast(item, "normal");
  const reversed = await cast(item, "reversed");
  assert.equal(figuresOf(normal.calls.records[0])[MAGIC_LIGHT_CHANGE_KEYS.bright], "30");
  assert.equal(reversed.calls.records.length, 1, "the reverse's timed row still leaves its record");
  assert.deepEqual(reversed.calls.records[0].changes, [], "no light on it");
  assert.equal(reversed.calls.records[0].flags["acks-extras"].magicLightCite, undefined);
  const alone = await cast(litSpell([lit(), track("detect", { key: "rev", reversed: true })]), "reversed");
  assert.deepEqual(alone.calls.records[0].changes, []);
});

await ta("a light cast held by concentration writes the held record and no light", async () => {
  const held = { shape: "concentration", concentration: "mobile", value: null, unit: "", dice: "", plus: { value: null, unit: "" }, maxPerLevel: false };
  const { calls } = await cast(litSpell([lit()], held));
  assert.equal(calls.records.length, 1);
  assert.equal(spellEffectOf(calls.records[0]).held, "mobile");
  assert.deepEqual(calls.records[0].changes, []);
  assert.equal(calls.records[0].flags["acks-extras"].magicLightCite, undefined);
});

await ta("a light row aimed at a recipient writes none on the caster", async () => {
  const { calls } = await cast(litSpell([lit({ appliesTo: "recipient" })]));
  assert.deepEqual(calls.records.flatMap((d) => d.changes), [], "the recipient's record carries it, at apply");
});

console.log(`\n${n} magic tracked tests passed`);
