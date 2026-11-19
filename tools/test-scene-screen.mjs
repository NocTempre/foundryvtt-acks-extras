/**
 * The scene screen's view model on plain data: what each seat is shown of the
 * entries, the log and the haul tray, the counts and the press line, the rail
 * rows and who is assigned, the drag a member tile carries, and the names an
 * entry and a plan option answer to. Every name, clue and figure here is this
 * file's own invention.
 */
import assert from "node:assert/strict";
import { THING_KINDS } from "../scripts/lib/place-things-logic.mjs";
import { CODE, LAYER } from "../scripts/scene-search/constants.mjs";
import { playerLog, sessionEntries } from "../scripts/scene-search/session-logic.mjs";
import { sceneView } from "../scripts/scene-search/scene-logic.mjs";
import { plateNames } from "../scripts/scene-search/plate-logic.mjs";
import { KIND_ROOT, ROOT, buildScreen, entryStatus, findsOf, firstOpenLayer, judgeNotes, logLineOf, memberDragData, memberDropOf, pressOf, pressText, tellOf, trayOf } from "../scripts/scene-search/screen-logic.mjs";
import { normalizeTruth } from "../scripts/treasure/pot-logic.mjs";

let checks = 0;
const eq = (a, b, msg) => {
  assert.deepEqual(a, b, msg);
  checks++;
};
const ok = (cond, msg) => {
  assert.ok(cond, msg);
  checks++;
};

/** Words: the key under the screen's prefix, then its data, so a case reads the exact wording it asserts. */
const t = (key, data = {}) => {
  const bare = key.startsWith(ROOT) ? key.slice(ROOT.length) : key;
  const tail = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(",");
  return tail ? `${bare}[${tail}]` : bare;
};

const base = (id, kind, over = {}) => ({ id, kind, ref: null, hidden: false, hint: null, point: null, params: {}, layers: {}, state: {}, ...over });
const LIST = [
  base("fresco", THING_KINDS.FIXTURE, { hint: "Cold air at its edge", layers: { hasty: { check: "inspect", yields: { clue: "A procession" } }, methodical: { check: "search", yields: { reveal: ["thing:door"] } } } }),
  base("door", THING_KINDS.EXIT, { hidden: true }),
  base("chest", THING_KINDS.CONTAINER, { layers: { methodical: { check: "search", turns: 3, yields: { lots: ["chest/1", "chest/2"] } } } }),
  base("floor", THING_KINDS.FLOOR),
  base("floor2", THING_KINDS.FLOOR),
];
const session = { sceneId: "s1", placeUuid: "Actor.p", recordMessageId: null, potUuid: "Cards.pot", shown: true, bodies: [], lots: [], log: [] };
const entriesOf = (list = LIST) => sessionEntries({ things: list, session });
const names = (entries) => plateNames(entries, { nameOf: () => "", kindWord: (kind) => t(`${KIND_ROOT}${kind}`) });
const MEMBERS = [
  { actorId: "m1", name: "Sela", owned: true },
  { actorId: "m2", name: "Tobin", owned: false },
];
const readOf = (isGM, list = LIST, over = {}) => {
  const all = entriesOf(list);
  const seen = sceneView(all, { isGM });
  return { session, place: { uuid: "Actor.p", name: "The hall" }, entries: seen, log: [], ...over };
};
const build = (isGM, over = {}, listOver = {}) => {
  const read = readOf(isGM, listOver.list ?? LIST, over.read ?? {});
  return buildScreen({ isGM, read, assignments: [], members: MEMBERS, names: names(read.entries), potView: null, turn: 14, t, ...over, read });
};
const card = (model, key) => model.cards.find((c) => c.key === key);

/* ---------------- who sees what ---------------- */
{
  const judge = build(true);
  const player = build(false);
  eq(judge.cards.map((c) => c.key), ["thing:fresco", "thing:door", "thing:chest", "thing:floor", "thing:floor2"], "the Judge's board has every entry, the hidden door included");
  eq(player.cards.map((c) => c.key), ["thing:fresco", "thing:chest", "thing:floor", "thing:floor2"], "a player's board lacks the hidden entry");
  eq([card(judge, "thing:door").hidden, card(judge, "thing:door").statusWord, card(judge, "thing:fresco").hidden], [true, "state.hidden", false], "the Judge's hidden entry carries the Hidden tag and state");
  eq(card(judge, "thing:door").notes, ["judge.behind[name=" + card(judge, "thing:fresco").name + ",how=how.methodical]"], "a hidden entry a clue names says which check it is behind");
  const loose = entriesOf([base("pit", THING_KINDS.TRAP, { hidden: true })]);
  eq(judgeNotes(loose[0], loose, names(loose), t), ["judge.showsItself"], "and one no clue names says the Judge shows it");
  eq(card(judge, "thing:chest").notes, ["judge.lots[n=2,how=how.methodical]"], "the Judge reads the lots waiting under the chest's check");
  eq(card(player, "thing:chest").notes, [], "a player reads no Judge notes");
  const dump = JSON.stringify(player);
  ok(!dump.includes("chest/1") && !dump.includes("A procession"), "no unfound lot key and no unfound clue is anywhere in a player's model");
  ok(!JSON.stringify(player).includes("thing:door"), "nor the hidden entry's key");
}

/* ---------------- the waiting screen ---------------- */
{
  const hold = { ...session, shown: false };
  const read = { session: hold, place: { name: "The hall" }, entries: [], log: [] };
  const model = buildScreen({ isGM: false, read, assignments: [], members: MEMBERS, names: new Map(), potView: null, t });
  eq([model.waiting, model.cards], [true, undefined], "a player's screen has nothing to read until the scene is shown");
  const judge = buildScreen({ isGM: true, read: { ...read, entries: readOf(true).entries }, assignments: [], members: MEMBERS, names: names(readOf(true).entries), potView: null, t });
  eq([judge.waiting, judge.header.shown, judge.header.showState], [false, false, "shown.no"], "the Judge's screen draws and says it is not yet shown");
  eq(build(true).header.showState, "shown.yes", "and says so once it is");
}

/* ---------------- state, finds, the tell ---------------- */
{
  const done = (name, extra = {}) => ({ layers: { [name]: { done: true, by: ["m1"], found: false, ...extra } } });
  const fresco = (state) => entriesOf(LIST.map((x) => (x.id === "fresco" ? { ...x, state } : x))).find((e) => e.key === "thing:fresco");
  eq(entryStatus(fresco({})), "seen", "an entry nobody has checked is Seen");
  eq(entryStatus(fresco(done("hasty"))), "hastily", "one checked hastily says so");
  eq(entryStatus(fresco({ layers: { hasty: { done: true }, methodical: { done: true } } })), "methodically", "and methodically once that check is made, whichever came first");

  const found = fresco(done("hasty", { found: true }));
  const view = sceneView([found, ...entriesOf().filter((e) => e.key !== "thing:fresco")], { isGM: false }).find((e) => e.key === "thing:fresco");
  eq(findsOf(view, t), ["finds.clue[clue=A procession]"], "a found clue is listed under the plate");
  eq(tellOf(view, [], t), "Cold air at its edge", "the Judge's own line is the tell while something more remains");
  eq(tellOf({ ...view, hint: null }, [{ key: "thing:fresco", code: CODE.VAGUE }], t), "tell.vague", "with no line written, a vague answer reads as the vague words");
  eq(tellOf({ ...view, hint: null }, [], t), "tell.generic", "and otherwise the generic words");
  eq(tellOf(view, [], t) !== "", true, "something more is shown once a check was made");
  const untouched = sceneView(entriesOf(), { isGM: false }).find((e) => e.key === "thing:fresco");
  eq(tellOf(untouched, [], t), "", "but nothing is said at an entry nobody has checked");

  const missed = fresco(done("hasty"));
  eq(findsOf(sceneView([missed], { isGM: true })[0], t), ["finds.nothing"], "a layer checked in vain reads Found nothing");

  const chest = entriesOf().find((e) => e.key === "thing:chest");
  const chestFound = { ...chest, state: { layers: { methodical: { done: true, found: true } } } };
  eq(findsOf(sceneView([chestFound], { isGM: false })[0], t), ["finds.items.many[n=2]", "finds.complete"], "a found lot layer counts its lots, and says nothing more is here");
}

/* ---------------- rows, chips, assigning, the bar ---------------- */
{
  const read = readOf(true, LIST, {});
  read.entries = read.entries.map((e) => (e.key === "thing:floor" ? { ...e, state: { layers: { hasty: { done: true, found: false, failed: { m2: 1 } } } } } : e));
  const model = buildScreen({
    isGM: true,
    read,
    assignments: [
      { actorId: "m1", layer: "hasty", entryKey: "thing:fresco", remaining: 1, resolved: false },
      { actorId: "m2", layer: "methodical", entryKey: "thing:chest", remaining: 3, resolved: false },
      { actorId: "m1", layer: "hasty", entryKey: "thing:floor2", remaining: 1, resolved: true },
    ],
    members: MEMBERS,
    names: names(read.entries),
    potView: null,
    turn: 3,
    picker: { key: "thing:fresco", layer: "methodical", rows: [{ actorId: "m1", name: "Sela", refusal: "" }] },
    t,
  });
  const fresco = card(model, "thing:fresco");
  eq(fresco.rows.map((r) => [r.layer, r.cost, r.chips.map((c) => c.name), r.canAssign]), [["hasty", "row.cost.round", ["Sela"], true], ["methodical", "row.cost.turn.one[n=1]", [], true]], "a card has the two rails, hastily then methodically, each with its cost and who is assigned");
  eq(fresco.rows[1].picker.title, "assign.pickerFor[entry=thing-kind-fixture,check=layer.methodical]".replace("thing-kind-fixture", fresco.name), "the open picker sits on the rail it was opened on");
  eq([fresco.rows[0].picker], [null], "and on no other");
  const chest = card(model, "thing:chest");
  eq([chest.rows[1].cost, chest.rows[1].bar, chest.rows[1].chips[0].name], ["row.cost.turn.many[n=3]", 0, "Tobin"], "a multi-turn check shows its turns and a bar at the share done");
  const going = buildScreen({ isGM: true, read, assignments: [{ actorId: "m2", layer: "methodical", entryKey: "thing:chest", remaining: 1, resolved: false }], members: MEMBERS, names: names(read.entries), potView: null, t });
  eq(card(going, "thing:chest").rows[1].bar, 67, "with two of three turns spent the bar reads two thirds");
  const floor = card(model, "thing:floor");
  eq(floor.rows[0].chips, [{ actorId: "m2", name: "Tobin", struck: true, removable: false, tip: "chip.struck[name=Tobin]" }], "a character the hasty lock holds out stands struck on the rail");
  eq(card(model, "thing:floor2").rows[0].chips, [], "an entry resolved this turn lists no chip");
  eq(model.members.map((m) => [m.name, m.at, m.draggable]), [["Sela", "member.at[entry=" + fresco.name + ",how=how.hasty]", true], ["Tobin", "member.at[entry=" + chest.name + ",how=how.methodical]", true]], "the party says where each member is assigned");
  const player = buildScreen({ ...{ isGM: false, read: readOf(false), assignments: [], members: MEMBERS, names: names(readOf(false).entries), potView: null, t } });
  eq(player.members.map((m) => m.draggable), [true, false], "a player drags only their own character");
  eq(player.cards[0].rows[0].chips, [], "and sees no chip where nobody is assigned");
  ok(floor.rows[1].canAssign, "a check not yet found can be assigned");
  eq(fresco.rows[0].chips[0].tip, "chip.unassign[name=Sela,entry=" + fresco.name + ",check=layer.hasty]", "a chip the seat may remove carries its own label");
  eq([chest.rows[1].costTip, fresco.rows[0].costTip, chest.rows[1].barTip], ["row.tip.turn[n=3]", "row.tip.round", "row.barTip[done=0,total=3]"], "each rail figure carries a tooltip naming where it comes from");
  const foundRead = readOf(true);
  foundRead.entries = foundRead.entries.map((e) => (e.key === "thing:floor" ? { ...e, state: { layers: { hasty: { done: true, found: true } } } } : e));
  eq(card(buildScreen({ isGM: true, read: foundRead, assignments: [], members: MEMBERS, names: names(foundRead.entries), potView: null, t }), "thing:floor").rows[0].canAssign, false, "a found check offers no assigning");
}

/* ---------------- counts and the press ---------------- */
{
  const model = build(true);
  eq([model.found, model.untouched, model.foundText, model.untouchedText], [0, 4, "count.found.many[n=0]", "count.untouched.many[n=4]"], "with nothing found, the visible entries are untouched (the hidden one is not counted)");
  eq(pressOf([{ layer: "hasty", resolved: false }, { layer: "hasty", resolved: true }, { layer: "methodical", resolved: false }]), { round: 1, turn: 1 }, "a press counts what is assigned and not yet resolved");
  eq(pressText({ round: 2, turn: 1 }, t), "press.round.many[n=2] press.turn.one[n=1]", "the press line says what a Round and a Turn would resolve");
  eq(pressText({ round: 0, turn: 0 }, t), "press.none", "and that nothing is assigned");
  eq([model.turnText, build(true, { turn: null }).turnText], ["turn.label[n=14]", ""], "the party's turn count prints where the clock is known");
}

/* ---------------- the haul tray ---------------- */
{
  const truthOf = (label, extra = {}) => normalizeTruth({ pool: "item", label, weight6: 1, ...extra });
  const view = {
    id: "pot",
    pot: { order: ["c1", "c2", "c3"] },
    cards: [
      { id: "c1", face: null, value: 1, truth: truthOf("A", { found: true }) },
      { id: "c2", face: null, value: 2, truth: truthOf("B", { found: false }) },
      { id: "c3", face: null, value: 0, truth: truthOf("C", { pool: "magic", magical: true, found: true }) },
    ],
  };
  eq(trayOf(view, { isGM: true }).map((x) => [x.id, x.found]), [["c1", true], ["c2", false], ["c3", true]], "a Judge's tray holds every lot, the unfound ones marked");
  eq(trayOf(view, { isGM: false }).map((x) => x.id), ["c1", "c3"], "a player's tray holds the found lots only");
  eq(trayOf(view, { isGM: false }).find((x) => x.id === "c3").poolKey, "item", "an unidentified magic lot reads as an item to a player");
  eq(trayOf(view, { isGM: true }).find((x) => x.id === "c3").poolKey, "magic", "and as magic to the Judge");
  eq(trayOf(null), [], "no pot, no tiles");
  const model = build(false, { potView: view });
  eq([model.tray.length, model.found, model.potOpen], [2, 2, true], "the count a player reads is the found lots");
  ok(!JSON.stringify(model.tray).includes("c2"), "and the unfound lot's card id is nowhere in a player's model");
}

/* ---------------- the log ---------------- */
{
  const rows = [
    { actorId: "m1", key: "thing:fresco", layer: "hasty", code: CODE.FOUND, clue: "A procession", more: ["reveal"], card: "msg1" },
    { actorId: "m2", key: "thing:floor", layer: "hasty", code: CODE.FOUND_NOTHING, clue: null, more: ["lots"], card: "msg2" },
    { actorId: "m2", key: "thing:chest", layer: "methodical", code: CODE.VAGUE, clue: null, more: [] },
    { actorId: "m1", key: "thing:door", layer: "methodical", code: CODE.FOUND, clue: null, more: [] },
  ];
  const throwOf = (id) => (id === "msg1" ? { total: 17, target: 12 } : null);
  const judge = build(true, { read: { log: rows }, throwOf });
  eq(judge.log.length, 4, "the Judge's log has every row");
  eq(judge.log[3].throw, "log.throw[total=17,target=12]", "the Judge reads the throw from the Judges' card, newest row first so the oldest is last");
  eq(judge.log[2].text, "finds.nothing log.more", "and a miss as Found nothing");
  const keep = playerLog(rows, ["thing:fresco", "thing:floor", "thing:chest"]);
  const player = build(false, { read: { log: keep }, throwOf });
  eq(player.log.map((l) => [l.cls, l.text, l.throw]), [
    ["is-miss", "tell.vague", ""],
    ["is-miss", "", ""],
    ["is-hit", "finds.clue[clue=A procession] log.more", ""],
  ], "a player's log blanks a miss, keeps a found clue and the vague words, and carries no throw even where the Judges' card is readable");
  const line = logLineOf({ actorId: "zz", key: "thing:nope", layer: "methodical", code: null, more: [] }, { names: new Map(), memberName: () => "", throwOf, isGM: false, t });
  eq(line.head, "log.checked[lead=log.lead.methodical,who=log.someone,entry=,how=how.methodical]", "a row naming a member or entry the seat cannot read still prints who-and-what words");
}

/* ---------------- the drag and the drop ---------------- */
{
  eq(memberDropOf(memberDragData("m1")), "m1", "a member tile's drag reads back as the member");
  eq([memberDropOf("not json"), memberDropOf('{"type":"other","actorId":"m1"}'), memberDropOf('{"type":"acks-extras.sceneMember"}'), memberDropOf("")], [null, null, null, null], "a drop that is no member drag names nobody");
  eq(firstOpenLayer({ layers: [{ layer: "hasty", refusal: "r" }, { layer: "methodical", refusal: null }] }), "methodical", "a drop on a card takes the first check the member may attempt");
  eq([firstOpenLayer({ layers: [{ layer: "hasty", refusal: "r" }] }), firstOpenLayer(null)], [null, null], "and none where every check is refused");
}

/* ---------------- plate names ---------------- */
{
  const list = [{ key: "a", kind: "floor" }, { key: "b", kind: "floor" }, { key: "c", kind: "container" }, { key: "d", kind: "body" }];
  const out = plateNames(list, { nameOf: (e) => (e.key === "d" ? "  Ogre " : ""), kindWord: (k) => `K${k}` });
  eq([...out], [["a", "Kfloor 1"], ["b", "Kfloor 2"], ["c", "Kcontainer"], ["d", "Ogre"]], "an entry is named by its document, else the word for its kind, and two alike are told apart by order");
  eq([...plateNames([{ key: "x", kind: "floor" }, { key: "y", kind: "body" }], { nameOf: (e) => (e.key === "x" ? "Same" : "Same"), kindWord: () => "" })], [["x", "Same 1"], ["y", "Same 2"]], "two documents with one name are told apart too");
  eq([...plateNames(null, { nameOf: () => "", kindWord: () => "" })], [], "no entries, no names");
  eq(judgeNotes({ key: "x", layers: { hasty: { yields: { lots: [], reveal: [] } }, methodical: { yields: { lots: [], reveal: [] } } }, state: {}, hidden: false }, [], new Map(), t), [], "an entry with nothing waiting has no note");
}

console.log(`test-scene-screen: ${checks} checks passed`);
