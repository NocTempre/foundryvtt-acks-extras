/**
 * Offline tests for recurring rows (`scripts/magic/cast-recur.mjs`,
 * `cast-rows.mjs` `recurringRows`): which rows a moment picks, `eachRound`
 * against `laterRounds`, the anchors a cast leaves and the prompts a turn edge
 * raises from them, the prompt's card and the presses each seat is offered, the
 * relay's checks, what a pass ends, and the record a ruling-14 kind with a
 * recipient writes. Foundry-free; every spell, figure and condition below is
 * invented, so this file carries no book content.
 *
 * Usage: node tools/test-cast-recur.mjs
 */
import assert from "node:assert/strict";

globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]) } };
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key } };

const { keyedRows, recurringRows, resolvesAtCast, isRecurring, castersTurnRecurs, rowsForMode } = await import("../scripts/magic/cast-rows.mjs");
const { promptRows, bearerHolds, anchorStands, anchorsNeeded, duePrompts, roundPrompts, samePrompt, promptModel, settleEntries, checkRecurRequest, resolveRecurEntry, pickRange } = await import("../scripts/magic/cast-recur.mjs");
const { checkApplyRequest, applyOnTarget } = await import("../scripts/magic/cast-apply.mjs");
const { castCardView } = await import("../scripts/magic/cast-card.mjs");
const { writesRecipientRecord, RECORD_KINDS } = await import("../scripts/magic/cast-spell.mjs");
const { placeOf } = await import("../scripts/magic/cast-kinds.mjs");
const { spellEffectOf } = await import("../scripts/magic/spell-effect.mjs");

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

/** An invented spell whose rows exercise every moment, both recurrences and each save. */
const ROWS = [
  { key: "stab", type: "damage", roll: "1d6", damage: ["fire"], recur: "eachRound", recurAt: "casterTurn", recurTarget: "pick", lasts: "duration" },
  { key: "choke", type: "damage", roll: "1d8", damage: ["force"], recur: "eachRound", recurAt: "casterTurn", recurSave: "cast", saveEffect: "negates", lasts: "duration" },
  { key: "dull", type: "conditionGrant", conditions: ["deafened"], recur: "laterRounds", recurAt: "bearerEnd", recurSave: "row", saveEffect: "negates", lasts: "duration" },
  { key: "sear", type: "damage", roll: "1d4", damage: ["fire"], recur: "laterRounds", recurAt: "bearerStart", lasts: "duration" },
  { key: "once", type: "damage", roll: "1d4", damage: ["fire"], recur: "none", lasts: "instant" },
  { key: "mark", type: "illusion", recur: "eachRound", recurAt: "bearerStart" },
];
const keyed = keyedRows(ROWS);
const row = (key) => keyed.find((k) => k.key === key);

t("a moment picks the recurring rows that name it; a row that does not recur, or names no moment, is picked by none", () => {
  assert.deepEqual(recurringRows(keyed, "casterTurn").map((r) => r.key), ["stab", "choke"]);
  assert.deepEqual(recurringRows(keyed, "bearerEnd").map((r) => r.key), ["dull"]);
  assert.deepEqual(recurringRows(keyed, "bearerStart").map((r) => r.key), ["sear", "mark"]);
  assert.deepEqual(recurringRows(keyed, "nowhere"), []);
  const blank = keyedRows([{ key: "x", type: "damage", recur: "eachRound" }]);
  for (const moment of ["casterTurn", "bearerStart", "bearerEnd"]) assert.deepEqual(recurringRows(blank, moment), [], "a recurring row with no moment is named at none");
  assert.equal(castersTurnRecurs(keyed), true);
  assert.equal(castersTurnRecurs(keyedRows([ROWS[2], ROWS[3]])), false);
});

t("eachRound resolves at the cast and then recurs; laterRounds only after the cast; both are recurring", () => {
  assert.equal(resolvesAtCast(row("stab").row), true);
  assert.equal(resolvesAtCast(row("sear").row), false);
  assert.equal(resolvesAtCast(row("once").row), true);
  assert.equal(isRecurring(row("stab").row) && isRecurring(row("sear").row), true);
  assert.equal(isRecurring(row("once").row), false);
});

t("a prompt asks a damage or heal row, and a condition row only where it asks its bearer for a save; no other kind", () => {
  const asked = promptRows([...keyed, { key: "free", row: { type: "conditionGrant", recur: "eachRound", recurAt: "bearerStart" } }]);
  assert.deepEqual(asked.map((r) => r.key), ["stab", "choke", "dull", "sear", "once", "free"].filter((k) => k !== "free"));
});

t("a bearer holds what a row recurs on: any record of the cast, and for a row that ends on its own pass a record carrying its key", () => {
  assert.equal(bearerHolds("sear", row("sear").row, []), false);
  assert.equal(bearerHolds("sear", row("sear").row, [""]), true);
  assert.equal(bearerHolds("dull", row("dull").row, ["sear"]), false, "another row's record is not this row's");
  assert.equal(bearerHolds("dull", row("dull").row, ["sear", "dull"]), true);
  assert.equal(anchorStands(row("stab").row, "stab", { casterRecord: true, records: [] }), true, "a pick row stands on the caster's record alone");
  assert.equal(anchorStands(row("choke").row, "choke", { casterRecord: true, records: [] }), false, "a caster-turn row with a bearer needs the bearer's record too");
  assert.equal(anchorStands(row("choke").row, "choke", { casterRecord: false, records: [""] }), false);
  assert.equal(anchorStands(row("choke").row, "choke", { casterRecord: true, records: [""] }), true);
});

const bearer = (uuid, records) => ({ uuid, name: uuid, records });
const cast = (over = {}) => ({ castId: "c1", casterUuid: "Actor.caster", rows: keyed, casterRecord: true, bearers: [bearer("Actor.a", ["dull"]), bearer("Actor.b", [""])], ...over });

t("a turn start raises the caster-turn prompt while the caster's record stands, meeting every bearer, and the bearer-start prompt for the bearer alone", () => {
  const [one] = duePrompts({ edge: "start", actorUuid: "Actor.caster", casts: [cast()] });
  assert.equal(one.moment, "casterTurn");
  assert.deepEqual(one.rowKeys, ["stab", "choke"]);
  assert.deepEqual(one.pick, ["stab"]);
  assert.deepEqual(one.bearers.map((b) => b.uuid), ["Actor.a", "Actor.b"], "a pick row has no bearer; the choke row meets both");
  const [two] = duePrompts({ edge: "start", actorUuid: "Actor.b", casts: [cast()] });
  assert.equal(two.moment, "bearerStart");
  assert.deepEqual(two.rowKeys, ["sear"], "the illusion row asks nothing");
  assert.deepEqual(two.bearers.map((b) => b.uuid), ["Actor.b"]);
});

t("a turn end raises the bearer-end prompt only for a bearer holding a record of the row that ends on its pass", () => {
  assert.deepEqual(duePrompts({ edge: "end", actorUuid: "Actor.b", casts: [cast()] }), [], "b holds a record of the cast and none of the row");
  const [due] = duePrompts({ edge: "end", actorUuid: "Actor.a", casts: [cast()] });
  assert.equal(due.moment, "bearerEnd");
  assert.deepEqual(due.rowKeys, ["dull"]);
  assert.deepEqual(duePrompts({ edge: "end", actorUuid: "Actor.caster", casts: [cast()] }), [], "the caster holds no record of its own as a bearer");
});

t("no anchor, no prompt: a lost caster record ends the caster-turn prompt, and a bearer with no record has none at its turn", () => {
  assert.deepEqual(duePrompts({ edge: "start", actorUuid: "Actor.caster", casts: [cast({ casterRecord: false })] }), []);
  assert.deepEqual(duePrompts({ edge: "start", actorUuid: "Actor.b", casts: [cast({ bearers: [bearer("Actor.b", [])] })] }), []);
  assert.deepEqual(duePrompts({ edge: "start", actorUuid: "Actor.z", casts: [cast()] }), []);
  assert.deepEqual(roundPrompts([cast({ casterRecord: false })]).map((p) => p.moment), ["bearerStart", "bearerEnd"]);
  assert.deepEqual(roundPrompts([cast()]).map((p) => p.moment), ["casterTurn", "bearerStart", "bearerEnd"], "a round no fight keeps plays each moment, every bearer at once");
});

t("a prompt is one card for a cast, a moment, a round of a fight and a bearer", () => {
  const flag = { castId: "c1", moment: "bearerStart", round: 2, combatId: "f", bearer: "Actor.a" };
  assert.equal(samePrompt(flag, { ...flag }), true);
  assert.equal(samePrompt(flag, { ...flag, round: 3 }), false);
  assert.equal(samePrompt(flag, { ...flag, bearer: "Actor.b" }), false);
  assert.equal(samePrompt(flag, null), false);
});

/** The original cast card a prompt is posted from. */
const SOURCE = { castId: "c1", spellUuid: "Actor.caster.Item.s", spellName: "Testgrip", casterUuid: "Actor.caster", casterName: "Caster", mode: "normal", picks: {}, casterLevel: { value: 5, source: "ladder" }, save: { category: "spell", effect: "negates" }, cite: "p. 1", duration: { value: 60, units: "seconds" } };
const prompt = (edge, actor, over = {}) => {
  const [due] = duePrompts({ edge, actorUuid: actor, casts: [cast(over)] });
  return promptModel({ source: SOURCE, due, rows: keyed, round: 2, combatId: "f", bearer: due.moment === "casterTurn" ? "" : actor, randomID: (() => { let i = 0; return () => `k${++i}`; })() });
};

t("the prompt is a cast card with nothing rolled: a row each, a target per bearer, a pending entry for each row a bearer meets, and a marker", () => {
  const model = prompt("start", "Actor.caster");
  assert.deepEqual(model.order, ["stab", "choke"]);
  assert.equal(model.rows.choke.total, null);
  assert.equal(model.rows.choke.recur.save, "cast");
  assert.deepEqual(Object.values(model.targets).map((x) => x.uuid), ["Actor.a", "Actor.b"]);
  assert.deepEqual(Object.keys(model.entries).sort(), ["tk1_choke", "tk2_choke"], "the pick row has no entry until it is pressed");
  assert.ok(Object.values(model.entries).every((e) => e.state === "pending"));
  assert.deepEqual(model.recur, { moment: "casterTurn", round: 2, combatId: "f", bearer: "", pick: ["stab"] });
  assert.equal(model.castId, "c1");
});

const loc = (key) => key;
const lines = (view, i = 0) => view.sections[i].rows;
const labels = (rowsOf) => rowsOf.flatMap((r) => (r.actions ?? []).map((a) => a.action));

t("each seat is offered only the press it may make: Save to a bearer's owner, Roll to the caster's owner, both to a Judge", () => {
  const model = prompt("start", "Actor.caster");
  const owns = (uuid) => (target) => target.uuid === uuid;
  const player = castCardView(model, { isGM: false, canPress: false, ownsTarget: owns("Actor.a"), ownsCaster: false }, loc);
  assert.deepEqual(labels(lines(player, 1)).sort(), ["magicCastSave"], "only the bearer it owns");
  assert.equal(lines(player, 1).find((r) => r.name === "Actor.b").actions.length, 0);
  const caster = castCardView(model, { isGM: false, canPress: false, ownsTarget: () => false, ownsCaster: true }, loc);
  assert.deepEqual(labels(lines(caster, 0)), ["magicCastRoll"], "the pick row's Roll");
  assert.deepEqual(labels(lines(caster, 1)), [], "a row that asks a save is the bearer's");
  const gm = castCardView(model, { isGM: true, canPress: true, ownsTarget: () => false, ownsCaster: false }, loc);
  assert.equal(labels(lines(gm, 1)).filter((a) => a === "magicCastSave").length, 2);
  assert.equal(labels(lines(gm, 1)).includes("magicCastApply"), false, "a prompt's entries are never applied by hand");
  assert.equal(gm.title, "recur.title");
  assert.match(gm.note, /recur\.moment\.casterTurn/);
});

t("a Roll row of a bearer is the caster's; a pressed entry offers Undo to the bearer's owner and to the author who owns the caster, and no press to anyone", () => {
  const model = prompt("start", "Actor.b");
  assert.deepEqual(model.order, ["sear"]);
  const seat = { isGM: false, canPress: false, ownsTarget: () => true, ownsCaster: true };
  assert.deepEqual(labels(lines(castCardView(model, seat, loc))), ["magicCastRoll"]);
  const done = { ...model, entries: { tk1_sear: { state: "applied", applied: 3, rolled: 3, recordIds: [] } } };
  assert.deepEqual(labels(lines(castCardView(done, { ...seat, isGM: true, canPress: true }, loc))), ["magicCastUndo"]);
  assert.deepEqual(labels(lines(castCardView(done, seat, loc))), ["magicCastUndo"], "the bearer's owner, whatever the role and whoever authored the prompt");
  assert.deepEqual(labels(lines(castCardView(done, { ...seat, ownsTarget: () => false }, loc))), ["magicCastUndo"], "the caster's owner who did not author the prompt and owns no bearer");
  assert.deepEqual(labels(lines(castCardView(done, { ...seat, ownsTarget: () => false, ownsCaster: false }, loc))), [], "a seat that owns neither");
  assert.deepEqual(labels(lines(castCardView(done, { ...seat, ownsTarget: () => false, canPress: true }, loc))), ["magicCastUndo"], "the author who owns the caster, for a bearer it does not own");
  assert.deepEqual(labels(lines(castCardView(done, { isGM: true, canPress: true, ownsTarget: () => false, ownsCaster: false }, loc))), [], "a role alone is no owner");
});

t("a cast with a recurring row offers its caster's seat and the Judge Next round; a prompt and a stranger's seat do not", () => {
  const cardWith = { ...SOURCE, rows: {}, order: [], targets: {}, entries: {}, lines: [], recurs: true };
  const actions = (seat, c = cardWith) => castCardView(c, seat, loc).buttons.map((b) => b.action);
  assert.deepEqual(actions({ isGM: false, ownsCaster: true }), ["magicCastNextRound"]);
  assert.deepEqual(actions({ isGM: true }), ["magicCastNextRound"]);
  assert.deepEqual(actions({ isGM: false, ownsCaster: false }), []);
  assert.deepEqual(actions({ isGM: true }, { ...cardWith, recurs: false }), []);
  assert.deepEqual(actions({ isGM: true }, { ...cardWith, recur: { moment: "casterTurn", round: 1, pick: [] } }), []);
});

/* ------------------------------------------------------------------ */
/*  The relay                                                         */
/* ------------------------------------------------------------------ */

const RESIST = { kind: "save", category: "spell", formula: "1d20", total: 15, target: 13, success: true, parts: [] };
const FAIL = { ...RESIST, total: 4, success: false };
const stored = () => prompt("start", "Actor.caster");
const relay = (over = {}, request = {}) => {
  const s = stored();
  const key = Object.keys(s.targets)[0];
  const card = { ...s, targets: { ...s.targets, [key]: { ...s.targets[key], resist: request.resist === undefined ? FAIL : request.resist } } };
  const world = { message: { authorId: "gm" }, card, stored: s, recur: { cardId: "m0", castId: "c1" }, authorIsGM: true, ownsTarget: true, ownsCaster: true, spellOfCaster: true, rows: keyed, resist: { target: 13, min: 1, max: 20 }, boundsOf: () => ({ min: 1, max: 8 }), anchor: true, ...over };
  const req = { requestUserId: "p1", kind: "save", targetKey: key, resist: FAIL, picked: false, entries: [{ rowKey: "choke", rolled: 5 }], ...request };
  return checkRecurRequest(req, world, checkApplyRequest);
};

t("a press on a prompt is refused unless the prompt is a GM's, the requester owns the bearer (Save) or the caster (Roll), the row is asked and its anchor stands", () => {
  assert.deepEqual(relay(), { ok: true });
  assert.equal(relay({ authorIsGM: false }).refused, "notAuthor", "a Player's message is no prompt");
  assert.equal(relay({ recur: null }).refused, "noPrompt");
  assert.equal(relay({ ownsTarget: false }).refused, "notOwner", "a Player cannot press Save for a bearer it does not own");
  assert.equal(relay({ ownsTarget: false, ownsCaster: true }).refused, "notOwner", "owning the caster does not buy a bearer's save");
  assert.equal(relay({ anchor: false }).refused, "noAnchor");
  assert.equal(relay({}, { entries: [{ rowKey: "once", rolled: 2 }] }).refused, "badRow", "a row the prompt does not ask");
  assert.equal(relay({}, { entries: [{ rowKey: "choke", rolled: 99 }] }).refused, "badAmount", "the figure is held to the row's own roll");
  assert.equal(relay({}, { requestUserId: null }).ok, true, "a Judge's own press carries no user id and always owns");
});

t("a Roll is the caster's: a row that asks a save is pressed with Save, and a row that asks none with Roll", () => {
  assert.equal(relay({}, { kind: "roll" }).refused, "badKind");
  assert.equal(relay({ ownsTarget: false, ownsCaster: true }, { kind: "roll", entries: [{ rowKey: "choke", rolled: 5 }] }).refused, "badKind");
});

t("a pick row is pressed once, with a target the press names; any other row with none", () => {
  const pick = { kind: "roll", entries: [{ rowKey: "stab", rolled: 4 }], picked: true, resist: null };
  const withEntry = (c) => ({ ...c, entries: { ...c.entries, tkp_stab: { state: "pending" } } });
  const keyOfPick = "tkp";
  const stage = (over = {}) => {
    const s = stored();
    const card = withEntry({ ...s, targets: { ...s.targets, [keyOfPick]: { uuid: "Actor.t", name: "T", resist: null } } });
    const world = { message: { authorId: "gm" }, card, stored: s, recur: {}, authorIsGM: true, ownsTarget: true, ownsCaster: true, spellOfCaster: true, rows: keyed, resist: null, boundsOf: () => ({ min: 1, max: 6 }), anchor: true, ...over };
    return checkRecurRequest({ requestUserId: "p1", targetKey: keyOfPick, ...pick }, world, checkApplyRequest);
  };
  assert.deepEqual(stage(), { ok: true });
  const s = stored();
  const again = withEntry(s);
  assert.equal(stage({ stored: again }).refused, "applied", "pressed once");
  assert.equal(relay({}, { kind: "roll", entries: [{ rowKey: "stab", rolled: 4 }], picked: false, resist: null }).refused, "badTarget", "a pick row with no target named");
  assert.equal(relay({}, { picked: true }).refused, "badTarget", "a bearer row with a target named");
});

t("a passed save that negates carries no figure; the check is given the lowest the row's roll can show and the amount it leaves is none", () => {
  const world = { rows: keyed, card: { save: { category: "spell", effect: "negates" } }, boundsOf: () => ({ min: 2, max: 8 }) };
  const [filled] = settleEntries({ resist: RESIST, entries: [{ rowKey: "choke" }] }, world);
  assert.equal(filled.rolled, 2);
  const [failed] = settleEntries({ resist: FAIL, entries: [{ rowKey: "choke" }] }, world);
  assert.equal(failed.rolled, undefined, "a failed save needs the roll; it is never made up");
  const [kept] = settleEntries({ resist: RESIST, entries: [{ rowKey: "choke", rolled: 6 }] }, world);
  assert.equal(kept.rolled, 6);
  assert.deepEqual(relay({}, { resist: RESIST, entries: [{ rowKey: "choke" }] }), { ok: true }, "a pass needs no roll");
  assert.deepEqual(relay({}, { resist: { ...RESIST, total: 12 }, entries: [{ rowKey: "choke" }] }), { refused: "badResist" }, "a pass the target does not have is not a pass");
});

/* ------------------------------------------------------------------ */
/*  What a pass ends                                                  */
/* ------------------------------------------------------------------ */

function resolveDeps(over = {}) {
  const log = { applied: [], entries: {}, endRow: [], endCast: [] };
  const deps = {
    by: "u1",
    apply: async (c, target, requests) => {
      log.applied.push({ target, requests });
      const entry = { state: "applied", saved: c.targets[target].resist?.success ?? null, applied: c.targets[target].resist?.success ? 0 : requests[0].rolled };
      return [{ id: `${target}_${requests[0].rowKey}`, entry }];
    },
    writeEntry: async (id, entry) => {
      log.entries[id] = entry;
    },
    endRow: async (actor, castId, rowKey) => {
      log.endRow.push({ actor: actor.name, castId, rowKey });
      return 1;
    },
    endCast: async (card, actor) => {
      log.endCast.push({ castId: card.castId, actor: actor.name });
      return 1;
    },
    ...over,
  };
  return { deps, log };
}
const withResist = (model, resist) => ({ ...model, targets: Object.fromEntries(Object.entries(model.targets).map(([k, v], i) => [k, i === 0 ? { ...v, resist } : v])) });
const found = { actor: { name: "Bearer" } };

await ta("a pass of a save that ends the cast ends the cast and the entry says so; a fail applies the damage and ends nothing", async () => {
  const model = stored();
  const { deps, log } = resolveDeps();
  const done = await resolveRecurEntry({ card: withResist(model, RESIST), targetKey: "tk1", request: { rowKey: "choke" }, keyed: row("choke"), found, deps });
  assert.equal(done.ended, 1);
  assert.deepEqual(log.endCast, [{ castId: "c1", actor: "Bearer" }]);
  assert.deepEqual(log.endRow, []);
  assert.deepEqual(log.entries.tk1_choke.ended, { kind: "cast", count: 1 });
  const lost = resolveDeps();
  const fail = await resolveRecurEntry({ card: withResist(model, FAIL), targetKey: "tk1", request: { rowKey: "choke", rolled: 5 }, keyed: row("choke"), found, deps: lost.deps });
  assert.equal(fail.entry.applied, 5, "rolled and applied in the one press");
  assert.deepEqual(lost.log.applied, [{ target: "tk1", requests: [{ rowKey: "choke", rolled: 5 }] }]);
  assert.deepEqual([lost.log.endCast, lost.log.endRow], [[], []]);
});

await ta("a pass of a save that ends its row ends that bearer's records of that row and nothing of the cast", async () => {
  const [due] = duePrompts({ edge: "end", actorUuid: "Actor.a", casts: [cast()] });
  const model = promptModel({ source: SOURCE, due, rows: keyed, round: 2, combatId: "f", bearer: "Actor.a", randomID: () => "z" });
  const { deps, log } = resolveDeps();
  const done = await resolveRecurEntry({ card: withResist(model, RESIST), targetKey: Object.keys(model.targets)[0], request: { rowKey: "dull" }, keyed: row("dull"), found, deps });
  assert.deepEqual(log.endRow, [{ actor: "Bearer", castId: "c1", rowKey: "dull" }]);
  assert.deepEqual(log.endCast, []);
  assert.equal(done.entry.ended.kind, "row");
  assert.deepEqual(log.applied, [], "a condition row has no amount");
  const failed = resolveDeps();
  await resolveRecurEntry({ card: withResist(model, FAIL), targetKey: Object.keys(model.targets)[0], request: { rowKey: "dull" }, keyed: row("dull"), found, deps: failed.deps });
  assert.deepEqual(failed.log.endRow, [], "a failed save leaves the record standing");
});

await ta("a row that asks no save ends nothing, a pass or not, and its amount is applied as rolled", async () => {
  const model = prompt("start", "Actor.b");
  const { deps, log } = resolveDeps();
  const done = await resolveRecurEntry({ card: model, targetKey: "tk1", request: { rowKey: "sear", rolled: 3 }, keyed: row("sear"), found, deps });
  assert.equal(done.entry.applied, 3);
  assert.deepEqual([log.endRow, log.endCast], [[], []]);
  const refused = await resolveRecurEntry({ card: model, targetKey: "tk1", request: { rowKey: "sear", rolled: 3 }, keyed: row("sear"), found, deps: resolveDeps({ apply: async () => [{ id: "tk1_sear", skipped: "applied" }] }).deps });
  assert.deepEqual(refused, { ok: false, reason: "applied" });
});

/* ------------------------------------------------------------------ */
/*  The anchor and the ruling-14 record                               */
/* ------------------------------------------------------------------ */

const entry = (over = {}) => ({ state: "applied", saved: null, applied: 3, recordIds: [], ...over });

/** `sear` as a cast applies it: a `laterRounds` damage row is withheld from the cast and never has an entry, so the application tests use its `eachRound` twin. */
const SEAR_NOW = { ...ROWS[3], recur: "eachRound" };

t("a bearer row the cast left no record for writes one; a row with its own record, a negated one and a pick row do not", () => {
  const need = (applied, rows = keyed) => anchorsNeeded({ rows, applied }).map((r) => r.key);
  assert.deepEqual(need([{ rowKey: "sear", entry: entry() }]), ["sear"]);
  assert.deepEqual(need([{ rowKey: "sear", entry: entry({ recordIds: ["r1"] }) }]), [], "its own record");
  assert.deepEqual(need([{ rowKey: "sear", entry: entry() }, { rowKey: "other", entry: entry({ recordIds: ["r2"] }) }]), [], "another row's record is a record of the cast on the bearer");
  assert.deepEqual(need([{ rowKey: "sear", entry: entry({ saved: true, applied: 0 }) }]), [], "a save that negated it");
  assert.deepEqual(need([{ rowKey: "sear", entry: entry({ state: "judge" }) }]), []);
  assert.deepEqual(need([{ rowKey: "stab", entry: entry() }]), [], "a pick row has no bearer");
  assert.deepEqual(need([{ rowKey: "dull", entry: entry() }, { rowKey: "other", entry: entry({ recordIds: ["r2"] }) }]), ["dull"], "a row that ends on its own pass needs a record of its own");
  assert.deepEqual(need([{ rowKey: "choke", entry: entry() }, { rowKey: "sear", entry: entry() }]), ["choke"], "one anchor serves every row that asks only a record of the cast");
});

/** The writes of a cast's application, recorded. */
function applyDeps(rows, over = {}) {
  const log = { made: [], entries: {}, hp: [] };
  const deps = {
    messageId: "m1",
    rows: rows.map((r, i) => ({ key: r.key, row: r, index: i })),
    duration: { value: 60, units: "seconds" },
    spell: { uuid: "Actor.caster.Item.s", name: "Testgrip", img: "i.png" },
    resolve: async () => ({ actor: { name: "T" }, hpTarget: { key: "Token.t", hp: { value: 20, max: 20 } } }),
    adjustHp: async (e) => {
      log.hp.push(e[0].amount);
      return [{ ok: true, before: 20, after: 20 - e[0].amount }];
    },
    lose: async () => [],
    createRecords: async (a, datas) => {
      log.made.push(...datas);
      return datas.map((_, i) => `rec${log.made.length}${i}`);
    },
    writeEntry: async (id, e) => {
      log.entries[id] = e;
    },
    fight: async () => ({ combatId: "f1", combatantId: "m1" }),
    now: () => 500,
    by: "u1",
    ...over,
  };
  return { deps, log };
}
const castCard = (rows, entries, over = {}) => ({ castId: "c1", spellUuid: "Actor.caster.Item.s", spellName: "Testgrip", casterUuid: "Actor.caster", mode: "normal", save: { category: "", effect: "" }, duration: { value: 60, units: "seconds" }, rows: Object.fromEntries(rows.map((r) => [r.key, { type: r.type, key: r.key, total: 3 }])), order: rows.map((r) => r.key), targets: { t1: { uuid: "Token.t", name: "T", resist: null } }, entries, ...over });

await ta("a bearer row's anchor is a status-free recipient record naming its row, its start time and the cast's duration, and the entry carries it for Undo", async () => {
  const rows = [SEAR_NOW];
  const { deps, log } = applyDeps(rows);
  await applyOnTarget(castCard(rows, { t1_sear: { state: "pending" } }), "t1", [{ rowKey: "sear", rolled: 3 }], deps);
  assert.equal(log.made.length, 1);
  const record = spellEffectOf(log.made[0]);
  assert.deepEqual([record.role, record.rowKey, record.startTime, record.duration], ["recipient", "sear", 500, { value: 60, units: "seconds" }]);
  assert.deepEqual(log.made[0].statuses ?? [], [], "status-free");
  assert.deepEqual(log.made[0].changes, []);
  assert.deepEqual(log.entries.t1_sear.recordIds, ["rec10"]);
  assert.deepEqual(log.hp, [3]);
});

await ta("a row that already left the bearer a record of the cast writes no second one, and a prompt's own entries are never anchored", async () => {
  const rows = [{ ...ROWS[2], recurSave: "" }, SEAR_NOW];
  const { deps, log } = applyDeps(rows);
  await applyOnTarget(castCard(rows, { t1_dull: { state: "pending" }, t1_sear: { state: "pending" } }), "t1", [{ rowKey: "dull" }, { rowKey: "sear", rolled: 2 }], deps);
  assert.deepEqual(log.made.map((d) => spellEffectOf(d).rowKey), ["dull"], "the condition's own record is the anchor");
  const again = applyDeps([SEAR_NOW]);
  await applyOnTarget({ ...castCard([SEAR_NOW], { t1_sear: { state: "pending" } }), recur: { moment: "bearerStart", round: 1, pick: [] } }, "t1", [{ rowKey: "sear", rolled: 2 }], again.deps);
  assert.deepEqual(again.log.made, []);
});

const IGNITE = { key: "ign", type: "ignite", appliesTo: "target", lasts: "rounds", rounds: "1d4+1" };

t("a ruling-14 kind that names a recipient and lasts writes the recipient's record; one that lasts once, or is the caster's own, stays a line", () => {
  assert.deepEqual([...RECORD_KINDS], ["ignite", "illusion", "detect", "light", "dispel", "createObject", "wall", "afflictionDelay"]);
  assert.equal(writesRecipientRecord(IGNITE), true);
  assert.equal(writesRecipientRecord({ ...IGNITE, lasts: "instant" }), false);
  assert.equal(writesRecipientRecord({ ...IGNITE, appliesTo: "self" }), false);
  assert.equal(writesRecipientRecord({ ...IGNITE, type: "damage" }), false, "a type outside the table writes none");
  assert.equal(writesRecipientRecord({ ...IGNITE, appliesTo: undefined }), true, "ignite keeps its own reach: any row not aimed at the caster");
});

t("a tracked kind or an affliction's delay writes a recipient's record only where its row says recipient and lasts on a clock", () => {
  for (const type of RECORD_KINDS.filter((k) => k !== "ignite")) {
    const row = { key: "r", type, appliesTo: "recipient", lasts: "duration" };
    assert.equal(writesRecipientRecord(row), true, `${type}: a recipient row that lasts the duration`);
    assert.equal(writesRecipientRecord({ ...row, lasts: "rounds" }), true, `${type}: a rounds lasting`);
    assert.equal(writesRecipientRecord({ ...row, lasts: "instant" }), false, `${type}: an instant row is a line`);
    for (const aimed of ["area", "target", "self", undefined]) assert.equal(writesRecipientRecord({ ...row, appliesTo: aimed }), false, `${type}: ${aimed} stays a card line`);
  }
});

await ta("a tracked kind aimed at a recipient writes the recipient's status-free record by the row's lasting; one aimed at an area or a target is a line and opens no entry", async () => {
  const wall = { key: "barr", type: "wall", appliesTo: "recipient", lasts: "duration" };
  const rows = [wall];
  const { deps, log } = applyDeps(rows);
  await applyOnTarget(castCard(rows, { t1_barr: { state: "pending" } }), "t1", [{ rowKey: "barr" }], deps);
  assert.equal(log.made.length, 1);
  const record = spellEffectOf(log.made[0]);
  assert.deepEqual([record.role, record.rowKey, record.startTime, record.duration], ["recipient", "barr", 500, { value: 60, units: "seconds" }]);
  assert.deepEqual(log.made[0].statuses ?? [], [], "status-free");
  assert.deepEqual(log.entries.t1_barr.recordIds, ["rec10"], "the entry carries it for Undo");
  assert.deepEqual([placeOf(wall), placeOf({ ...wall, appliesTo: "area" }), placeOf({ ...wall, appliesTo: "target" })], ["rowAndLine", "line", "line"]);
});

await ta("an affliction's delay on a recipient writes its record by its lasting, and an instant one writes none", async () => {
  const delay = { key: "hold", type: "afflictionDelay", appliesTo: "recipient", effects: ["disease"], lasts: "duration" };
  const { deps, log } = applyDeps([delay]);
  await applyOnTarget(castCard([delay], { t1_hold: { state: "pending" } }), "t1", [{ rowKey: "hold" }], deps);
  assert.equal(log.made.length, 1);
  assert.deepEqual(spellEffectOf(log.made[0]).duration, { value: 60, units: "seconds" });
  assert.equal(placeOf({ ...delay, lasts: "instant" }), "line");
});

await ta("an ignite row with a recipient writes its record with the row's own life, and a bearer-start row of the cast stands on it with no anchor of its own", async () => {
  const burn = { ...SEAR_NOW, lasts: "rounds", rounds: "" };
  const rows = [IGNITE, burn];
  const { deps, log } = applyDeps(rows);
  const card = castCard(rows, { t1_ign: { state: "pending", life: { kind: "rounds", count: 3, formula: "1d4+1", detail: "3" } }, t1_sear: { state: "pending" } });
  await applyOnTarget(card, "t1", [{ rowKey: "ign", rounds: 3 }, { rowKey: "sear", rolled: 2 }], deps);
  assert.equal(log.made.length, 1, "the ignite record is the one record of the cast");
  const data = log.made[0];
  assert.deepEqual(data.flags["acks-extras"].turnLife, { combatId: "f1", combatantId: "m1", edge: "start", count: 3, seen: 0 }, "it lasts its rolled rounds, counted at the bearer's turn starts");
  assert.deepEqual(spellEffectOf(data).duration, { value: 3, units: "rounds" });
  assert.equal(spellEffectOf(data).rowKey, "ign");
  assert.deepEqual(data.statuses ?? [], []);
  assert.deepEqual(log.entries.t1_ign.life, { kind: "rounds", count: 3, formula: "1d4+1", detail: "3", turn: true });
  const [due] = duePrompts({ edge: "start", actorUuid: "Actor.t", casts: [{ castId: "c1", casterUuid: "Actor.caster", rows: keyedRows(rows), casterRecord: false, bearers: [bearer("Actor.t", [spellEffectOf(data).rowKey])] }] });
  assert.deepEqual(due.rowKeys, ["sear"], "the burn prompts at the bearer's turn start while the ignite record stands");
});

t("an ignite row's rolled rounds are held to its formula's reach, as a condition's are", () => {
  const rows = [{ row: IGNITE, key: "ign" }];
  const card = castCard([IGNITE], { t1_ign: { state: "pending" } });
  const world = { message: { authorId: "p1" }, card, ownsCaster: true, spellOfCaster: true, rows, resist: null, boundsOf: () => null, roundsBoundsOf: () => ({ min: 2, max: 5 }) };
  const ask = (rounds) => checkApplyRequest({ requestUserId: "p1", targetKey: "t1", resist: null, entries: [{ rowKey: "ign", rounds }] }, world);
  assert.deepEqual(ask(3), { ok: true });
  assert.equal(ask(9).refused, "badRounds");
  assert.equal(ask(undefined).refused, "badRounds");
});

/* ------------------------------------------------------------------ */
/*  The pick row's range                                              */
/* ------------------------------------------------------------------ */

t("a pick row's target is judged against the spell's range at the cast's level; a range nothing says of judges nothing", () => {
  const token = { uuid: "Token.t", name: "Far" };
  const near = pickRange({ range: { shape: "distance", value: 100, unit: "feet" }, model: "creature", level: 5, token, gap: 60 });
  assert.deepEqual(near.out, []);
  const far = pickRange({ range: { shape: "distance", value: 100, unit: "feet" }, model: "creature", level: 5, token, gap: 140 });
  assert.deepEqual(far.out.map((o) => o.name), ["Far"]);
  const perLevel = pickRange({ range: { shape: "distancePerLevel", value: 10, unit: "feet" }, model: "creature", level: 5, token, gap: 60 });
  assert.deepEqual(perLevel.out.map((o) => o.gap), [60], "ten feet times level five is fifty");
  assert.deepEqual(pickRange({ range: { shape: "touch" }, model: "creature", level: 5, token, gap: 999 }).out, []);
  assert.deepEqual(pickRange({ range: { shape: "distance", value: 100, unit: "feet" }, model: "creature", level: 5, token, gap: null }).out, [], "an unmeasured gap is never judged");
});

t("the mode's rows are what a prompt reads: a row of the unpicked form is no prompt", () => {
  const rows = [{ key: "a", type: "damage", recur: "eachRound", recurAt: "bearerStart" }, { key: "b", type: "damage", reversed: true, recur: "eachRound", recurAt: "bearerStart" }];
  assert.deepEqual(recurringRows(rowsForMode(rows, "normal"), "bearerStart").map((r) => r.key), ["a"]);
  assert.deepEqual(recurringRows(rowsForMode(rows, "reversed"), "bearerStart").map((r) => r.key), ["b"]);
});

/* ------------------------------------------------------------------ */
/*  The cast itself                                                   */
/* ------------------------------------------------------------------ */

globalThis.Roll = class {
  constructor(formula) {
    this.formula = formula;
  }
  async evaluate() {
    this.total = 4;
    this.result = "4";
    return this;
  }
};
const { castSpellRun } = await import("../scripts/magic/cast-spell.mjs");

const spell = (rows, extra = {}) => ({
  type: "spell",
  name: "Testgrip",
  uuid: "Actor.c1.Item.s1",
  img: "i.png",
  flags: { "acks-extras": { spell: { effects: rows, ...extra } } },
  parent: { isOwner: true, type: "character", uuid: "Actor.c1" },
});
function runDeps() {
  const calls = { posts: [], records: [] };
  return {
    calls,
    deps: {
      lookups: { byCookbookId: () => null, fromUuidSync: () => null },
      read: async () => ({ actor: {}, tokens: [], casterToken: null, gaps: {}, statuses: [], capacity: { verdict: "ok" }, level: { matched: false } }),
      ask: async () => ({ mode: "normal", picks: {} }),
      notify: () => {},
      adjustPool: async () => {},
      castId: () => "castX",
      roll: () => 1,
      post: async (c) => {
        calls.posts.push(c);
        return { id: "m1", flags: { "acks-extras": { castCard: c } } };
      },
      apply: async () => ({ ok: true }),
      record: async (c, data) => calls.records.push(data),
      throwRow: async () => null,
      now: () => 10,
      isGM: () => false,
    },
  };
}

await ta("a timed cast with a row that recurs on the caster's turn keeps the caster's record, flag-timed, though no row lasts the duration; an untimed cast keeps none, and a bearer row never does", async () => {
  const mend = { key: "mend", type: "heal", roll: "1d6", recur: "eachRound", recurAt: "casterTurn", recurTarget: "pick", lasts: "instant" };
  const timed = { duration: { shape: "fixed", value: 1, unit: "minutes" } };
  let r = runDeps();
  await castSpellRun(spell([mend], timed), () => {}, r.deps);
  assert.equal(r.calls.records.length, 1, "the prompt stands on the caster's record");
  assert.equal(spellEffectOf(r.calls.records[0]).role, "caster");
  assert.deepEqual(spellEffectOf(r.calls.records[0]).duration, { value: 1, units: "minutes" });
  assert.equal(r.calls.posts[0].recurs, true);
  r = runDeps();
  await castSpellRun(spell([mend]), () => {}, r.deps);
  assert.equal(r.calls.records.length, 0, "an untimed cast would never end its record");
  r = runDeps();
  await castSpellRun(spell([{ ...mend, recur: "none", recurAt: "" }], timed), () => {}, r.deps);
  assert.equal(r.calls.records.length, 0);
  assert.equal(r.calls.posts[0].recurs, false);
  r = runDeps();
  await castSpellRun(spell([{ ...mend, recurAt: "bearerStart", recurTarget: "" }], timed), () => {}, r.deps);
  assert.equal(r.calls.records.length, 0, "a bearer row stands on the bearer's record, not the caster's");
});

await ta("eachRound resolves at the cast; laterRounds waits for its first moment and the card says so in a line", async () => {
  const each = { key: "each", type: "heal", roll: "1d6", recur: "eachRound", recurAt: "bearerStart" };
  const later = { key: "later", type: "heal", roll: "1d4", recur: "laterRounds", recurAt: "bearerStart" };
  const r = runDeps();
  await castSpellRun(spell([each, later]), () => {}, r.deps);
  const posted = r.calls.posts[0];
  assert.deepEqual(posted.order, ["each"]);
  assert.equal(posted.rows.each.total, 4, "rolled at the cast");
  assert.equal(posted.rows.later, undefined, "nothing rolled for the later rounds");
  assert.equal(posted.lines.length, 1);
});

await ta("an ignite row that names a recipient and lasts is a row of the card; one that lasts once, or is the caster's own, stays a line", async () => {
  const lit = { key: "lit", type: "ignite", appliesTo: "target", lasts: "rounds", rounds: "1d4" };
  let r = runDeps();
  await castSpellRun(spell([lit]), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].order, ["lit"]);
  assert.equal(r.calls.posts[0].rows.lit.type, "ignite");
  assert.equal(r.calls.posts[0].lines.length, 1, "the Judge's reading stays on the card");
  r = runDeps();
  await castSpellRun(spell([{ ...lit, lasts: "instant" }]), () => {}, r.deps);
  assert.deepEqual(r.calls.posts[0].order, []);
  assert.equal(r.calls.posts[0].lines.length, 1);
});

/* ------------------------------------------------------------------ */
/*  S5b-2: a condition row that waits for a failed save                */
/* ------------------------------------------------------------------ */

const { EFFECT_RECUR_SAVES } = await import("../scripts/lib/magic-vocab.mjs");
const { awaitsFail } = await import("../scripts/magic/cast-rows.mjs");
const { anchorKeys } = await import("../scripts/magic/cast-recur.mjs");
const { undoEntry } = await import("../scripts/magic/cast-apply.mjs");

/** An invented floor: prone is written by a failed save at the start of each bearer's turn, never at the cast. */
const FLOOR = { key: "floor", type: "conditionGrant", conditions: ["prone"], recur: "laterRounds", recurAt: "bearerStart", recurSave: "fail", saveEffect: "negates", lasts: "instant" };
const floorKeyed = keyedRows([FLOOR]);
const floorOf = (over = {}) => ({ castId: "c1", casterUuid: "Actor.caster", rows: floorKeyed, casterRecord: true, bearers: [bearer("Actor.a", ["floor"])], ...over });

t("the vocabulary has a fail save, and only a laterRounds condition row with it waits for one", () => {
  assert.deepEqual(Object.keys(EFFECT_RECUR_SAVES), ["row", "cast", "fail"]);
  assert.equal(awaitsFail(FLOOR), true);
  assert.equal(awaitsFail({ ...FLOOR, recur: "eachRound" }), false, "an eachRound row resolves at the cast");
  assert.equal(awaitsFail({ ...FLOOR, recurSave: "row" }), false);
  assert.equal(awaitsFail({ ...FLOOR, type: "damage" }), false);
  assert.equal(awaitsFail({ ...FLOOR, recurSave: "" }), false);
});

t("a fail row stands on a record of its own that writes no status: what a failed press wrote is no anchor, and a bearer with none has no prompt", () => {
  const failKeys = new Set(["floor"]);
  assert.deepEqual(anchorKeys([{ rowKey: "floor", written: false }], failKeys), ["floor"]);
  assert.deepEqual(anchorKeys([{ rowKey: "floor", written: true }], failKeys), [], "the written condition outlasts the cast and is no anchor");
  assert.deepEqual(anchorKeys([{ rowKey: "other", written: true }, { rowKey: "floor", written: true }], failKeys), ["other"], "another row's record is its own");
  assert.equal(bearerHolds("floor", FLOOR, ["other"]), false, "another row's record is not this row's");
  assert.equal(bearerHolds("floor", FLOOR, ["floor"]), true);
  assert.equal(bearerHolds("floor", { ...FLOOR, recurSave: "cast" }, ["other"]), true, "a cast save stands on any record of the cast");
  assert.equal(anchorStands(FLOOR, "floor", { casterRecord: false, records: ["floor"] }), true);
  assert.equal(anchorStands(FLOOR, "floor", { casterRecord: true, records: ["other"] }), false);
  const [due] = duePrompts({ edge: "start", actorUuid: "Actor.a", casts: [floorOf()] });
  assert.deepEqual([due.moment, due.rowKeys], ["bearerStart", ["floor"]]);
  assert.deepEqual(duePrompts({ edge: "start", actorUuid: "Actor.a", casts: [floorOf({ bearers: [bearer("Actor.a", ["other"])] })] }), []);
  assert.deepEqual(duePrompts({ edge: "end", actorUuid: "Actor.a", casts: [floorOf()] }), [], "a start-of-turn row is not asked at the end");
});

t("a fail row needs an anchor of its own whatever else the bearer holds or the cast wrote it, a pass at the cast included", () => {
  const need = (applied) => anchorsNeeded({ rows: floorKeyed, applied }).map((r) => r.key);
  assert.deepEqual(need([{ rowKey: "floor", entry: entry({ applied: undefined, awaits: true }) }]), ["floor"]);
  assert.deepEqual(need([{ rowKey: "floor", entry: entry({ applied: undefined }) }, { rowKey: "other", entry: entry({ recordIds: ["r2"] }) }]), ["floor"], "another row's record is not its anchor");
  assert.deepEqual(need([{ rowKey: "floor", entry: entry({ recordIds: ["r1"] }) }]), ["floor"], "an eachRound twin's written condition is no anchor");
  assert.deepEqual(need([{ rowKey: "floor", entry: entry({ saved: true, applied: 0 }) }]), ["floor"], "a pass at the cast does not end a row that only asks for a fail");
  assert.deepEqual(need([{ rowKey: "floor", entry: entry({ state: "judge" }) }]), [], "an entry that did not apply anchors nothing");
  const beside = anchorsNeeded({ rows: [...keyed, ...floorKeyed], applied: [{ rowKey: "choke", entry: entry() }, { rowKey: "floor", entry: entry({ recordIds: ["r1"] }) }] }).map((r) => r.key);
  assert.deepEqual(beside, ["choke", "floor"], "the condition a fail row wrote is no record of the cast for a row that asks only that");
});

const SAVED = { ...RESIST };
const failApply = (over = {}, row = FLOOR) => applyDeps([row], { lose: async () => (failApply.lost.push(1), []), ...over });
failApply.lost = [];

await ta("at the cast a fail row writes its anchor alone: status-free, its row key, the cast's duration; the cast save it ignores, and no count of rounds is read", async () => {
  failApply.lost.length = 0;
  for (const row of [FLOOR, { ...FLOOR, lasts: "rounds", rounds: "1d4" }, { ...FLOOR, lasts: "duration" }, { ...FLOOR, lasts: "nextTurn" }]) {
    const { deps, log } = failApply({}, row);
    const card = castCard([row], { t1_floor: { state: "pending" } }, { targets: { t1: { uuid: "Token.t", name: "T", resist: RESIST } } });
    const out = await applyOnTarget(card, "t1", [{ rowKey: "floor" }], deps);
    assert.equal(log.made.length, 1, `${row.lasts}: one record`);
    const record = spellEffectOf(log.made[0]);
    assert.deepEqual([record.role, record.rowKey, record.startTime, record.duration], ["recipient", "floor", 500, { value: 60, units: "seconds" }]);
    assert.deepEqual(log.made[0].statuses ?? [], [], "no prone yet");
    assert.equal(out[0].entry.awaits, true);
    assert.deepEqual([out[0].entry.saved, out[0].entry.recordIds.length], [null, 1], "a pass of another row's save negates nothing here");
    assert.equal(out[0].entry.life, undefined);
  }
  assert.deepEqual(failApply.lost, [], "a pass loses nothing");
});

/** The press's prompt for the floor, with the bearer's save written on it as the relay writes it. */
const floorPrompt = (resist) => {
  const [due] = duePrompts({ edge: "start", actorUuid: "Actor.a", casts: [floorOf()] });
  const model = promptModel({ source: SOURCE, due, rows: floorKeyed, round: 2, combatId: "f", bearer: "Actor.a", randomID: () => "z" });
  const [key] = Object.keys(model.targets);
  return { model: { ...model, targets: { [key]: { ...model.targets[key], resist } } }, key };
};
const press = async (resist, { held = [], row = FLOOR } = {}) => {
  const { model, key } = floorPrompt(resist);
  const actor = { name: "Bearer", effects: held };
  const { deps, log } = applyDeps([row], { resolve: async () => ({ actor, hpTarget: null }) });
  const ends = { endRow: async () => (log.endRow = [...(log.endRow ?? []), 1]) && 1, endCast: async () => (log.endCast = [...(log.endCast ?? []), 1]) && 1 };
  const done = await resolveRecurEntry({ card: model, targetKey: key, request: { rowKey: "floor" }, keyed: keyedRows([row])[0], found: { actor }, deps: { ...deps, ...ends, apply: (c, t, r) => applyOnTarget(c, t, r, deps) } });
  return { done, log, key };
};

await ta("a failed press writes the row's condition through the applier, and the entry carries it for Undo; a pass writes nothing and ends neither the row nor the cast", async () => {
  const failed = await press(FAIL);
  assert.equal(failed.done.ok, true);
  assert.deepEqual(failed.log.made.map((d) => [d.statuses, spellEffectOf(d).rowKey, spellEffectOf(d).role]), [[["prone"], "floor", "recipient"]]);
  assert.deepEqual([failed.done.entry.saved, failed.done.entry.recordIds.length, failed.done.ended], [false, 1, 0]);
  assert.deepEqual([failed.log.endRow ?? [], failed.log.endCast ?? []], [[], []]);
  assert.equal(failed.log.entries[`${failed.key}_floor`].recordIds.length, 1, "written on the prompt's card");
  const passed = await press(RESIST);
  assert.deepEqual(passed.log.made, [], "a pass writes nothing");
  assert.deepEqual([passed.done.entry.saved, passed.done.entry.recordIds], [true, []]);
  assert.deepEqual([passed.log.endRow ?? [], passed.log.endCast ?? [], passed.done.ended], [[], [], 0], "the anchor stands: a pass ends nothing");
  const halved = await press(RESIST, { row: { ...FLOOR, saveEffect: "half" } });
  assert.deepEqual([halved.log.made, halved.done.entry.state], [[], "applied"], "a pass writes nothing whatever the row's own effect says");
});

await ta("a failed press does not write what the bearer already holds from the row; an Undo takes the written record off", async () => {
  const first = await press(FAIL);
  const held = first.log.made.map((d, i) => ({ ...d, id: `rec${i}` }));
  const again = await press(FAIL, { held });
  assert.deepEqual(again.log.made, [], "prone from this row is already in force");
  assert.deepEqual(again.done.entry.already, ["prone"]);
  const removed = [];
  const undone = await undoEntry(first.done.entry, { uuid: "Token.t" }, { resolve: async () => ({ actor: { name: "T" } }), deleteRecords: async (a, ids) => removed.push(...ids), restoreHp: async () => {} });
  assert.equal(undone.state, "undone");
  assert.deepEqual(removed, first.done.entry.recordIds, "the written record goes by its id");
});

t("a Save press on the floor's prompt is checked like any bearer row's: the owner of the bearer presses it, the caster's Roll is refused, the anchor must stand", () => {
  const { model, key } = floorPrompt(FAIL);
  const world = (over = {}) => ({ message: { authorId: "gm" }, card: model, stored: model, recur: { cardId: "m0", castId: "c1" }, authorIsGM: true, ownsTarget: true, ownsCaster: true, spellOfCaster: true, rows: floorKeyed, resist: { target: 13, min: 1, max: 20 }, boundsOf: () => null, anchor: true, ...over });
  const req = (over = {}) => ({ requestUserId: "p1", kind: "save", targetKey: key, resist: FAIL, picked: false, entries: [{ rowKey: "floor" }], ...over });
  assert.deepEqual(checkRecurRequest(req(), world(), checkApplyRequest), { ok: true });
  assert.equal(checkRecurRequest(req({ kind: "roll" }), world(), checkApplyRequest).refused, "badKind");
  assert.equal(checkRecurRequest(req(), world({ anchor: false }), checkApplyRequest).refused, "noAnchor");
  assert.equal(checkRecurRequest(req(), world({ ownsTarget: false }), checkApplyRequest).refused, "notOwner");
});

t("the prompt offers the bearer's owner the Save press for the floor, and the cast's card says a failed save writes it on a later round", () => {
  const { model } = floorPrompt(null);
  assert.equal(model.rows.floor.recur.save, "fail");
  const view = castCardView(model, { isGM: false, canPress: false, ownsTarget: () => true, ownsCaster: false }, loc);
  assert.deepEqual(labels(lines(view)), ["magicCastSave"]);
  const cast = castCard([FLOOR], { t1_floor: { state: "applied", saved: null, awaits: true, recordIds: ["a1"] } }, { rows: { floor: { type: "conditionGrant", key: "floor", conditions: ["prone"], lasts: "instant" } } });
  const [line] = lines(castCardView(cast, { isGM: true, canPress: true, ownsTarget: () => true }, loc));
  assert.match(line.detail, /detail\.awaitsFail/);
  assert.deepEqual(labels([line]), ["magicCastUndo"], "the bearer's owner's Undo takes the anchor off");
});

console.log(`\n${n} recurring-row tests passed`);
