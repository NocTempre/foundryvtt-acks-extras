/**
 * The party sheet's frame against mocked Foundry globals: which parts and tabs
 * a seat gets (`framePartIds`, `frameTabs`), what the band's bar reads, the
 * hurt count, and `buildFrameView` — the Judge's rail cells in the same order in
 * every mode, the presses a seat gets and the ones it does not (a seat owning
 * nobody, a Player owning one of two members, on a journey, owning every member,
 * a Trusted seat), the reading's chips, the Key and the tab heads. Then the
 * band, the frame and the tab row, rendered with plain Handlebars for a Judge,
 * for a seat owning nothing and for the owning seats: no literal id, every
 * press names a handler, every button has a name and a tooltip, and nothing of
 * the Judge's reaches another seat's render. Invented figures throughout, so these
 * prove the MACHINERY and never the book.
 *
 * Run: node tools/test-party-frame.mjs
 */
import assert from "node:assert/strict";
import fs from "node:fs";

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

globalThis.game = {
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => (Object.keys(data).length ? `${key} ${JSON.stringify(data)}` : key),
  },
  user: { isGM: true },
};

const { MODE_TEMPLATES, TAB_IDS, framePartIds, frameTabs, bandBar, hurtCount, buildFrameView } =
  await import("../scripts/formation/frame-view.mjs");
const { SAVE_ICONS } = await import("../scripts/character-sheet/constants.mjs");

const LANG_PREFIX = "ACKS-FORMATION.frame";
/** What the mock's `format` makes of a frame key and its data. */
const said = (key, data) => game.i18n.format(`${LANG_PREFIX}.${key}`, data);
const keys = (cells) => cells.map((c) => c.key);
const byKey = (cells, key) => cells.find((c) => c.key === key);

/* -------------------------------------------- */
/*  Parts and tabs                              */
/* -------------------------------------------- */

{
  assert.deepEqual(framePartIds({ isGM: true, hasFormation: true }), ["band", "frame", "tabs", "mode", "order", "kit", "sightings", "judge"]);
  assert.deepEqual(framePartIds({ isGM: false, hasFormation: true }), ["band", "frame", "tabs", "mode", "order", "kit", "sightings"],
    "a player's parts never name the Judge's");
  for (const isGM of [true, false]) {
    assert.deepEqual(framePartIds({ isGM, hasFormation: false }), ["band", "frame"], "no formation: the band and the empty state");
  }

  // Every part the frame can ask for is one the sheet declares, and every mode
  // tab's template is on disk.
  const source = fs.readFileSync("scripts/formation/party-actor.mjs", "utf8");
  const partsBlock = source.slice(source.indexOf("static PARTS = {"));
  const declared = new Set([...partsBlock.slice(0, partsBlock.indexOf("\n  };")).matchAll(/^ {4}(\w+): \{/gm)].map((m) => m[1]));
  for (const id of framePartIds({ isGM: true, hasFormation: true })) assert.ok(declared.has(id), `PARTS declares ${id}`);
  for (const file of Object.values(MODE_TEMPLATES)) assert.ok(fs.existsSync(`templates/formation/${file}`), `${file} exists`);

  const ids = (tabs) => tabs.map((t) => t.id);
  const labels = (tabs) => tabs.map((t) => t.label);
  for (const [mode, modeLabel, orderLabel] of [
    ["delve", "ACKS-FORMATION.tab.dungeon", "ACKS-FORMATION.tab.order"],
    ["journey", "ACKS-FORMATION.tab.wilderness", "ACKS-FORMATION.tab.train"],
    ["settlement", "ACKS-FORMATION.tab.city", "ACKS-FORMATION.tab.company"],
  ]) {
    const gm = frameTabs({ mode, isGM: true });
    assert.deepEqual(ids(gm), [...TAB_IDS], `${mode}: the Judge's row is every tab, in order`);
    assert.deepEqual(labels(gm), [modeLabel, orderLabel, "ACKS-FORMATION.tab.kit", "ACKS-FORMATION.tab.sightings", "ACKS-FORMATION.tab.judge"],
      `${mode}: the tabs are named by the mode`);
    const judge = gm.find((t) => t.id === "judge");
    assert.equal(judge.cssClass, "is-judge", "the Judge's tab is marked as the Judge's");
    assert.ok(judge.icon, "and carries a glyph");
    const player = frameTabs({ mode, isGM: false });
    assert.deepEqual(ids(player), TAB_IDS.filter((id) => id !== "judge"), `${mode}: a player has no Judge tab`);
    assert.ok(player.every((t) => !t.cssClass && !t.icon), "and no tab of a player's is marked");
  }
  assert.deepEqual(labels(frameTabs({ mode: "bogus", isGM: false })), labels(frameTabs({ mode: "delve", isGM: false })),
    "an unknown mode reads as the delve");
}

/* -------------------------------------------- */
/*  The band's bar and the hurt count           */
/* -------------------------------------------- */

{
  const day = bandBar({ isJourney: true, dayCount: 2, walked: { hours: 5 }, budget: { hours: 8 }, spent: false });
  assert.equal(day.label, said("bar.journey", { day: 3, hours: 5, budget: 8 }), "the day being walked: finished days plus one");
  assert.equal(day.title, said("bar.journeyTitle"));
  assert.equal(day.pct, 63, "5 of 8 hours, rounded");
  assert.deepEqual([day.full, day.bad], [false, false]);
  const spent = bandBar({ isJourney: true, dayCount: 0, walked: { hours: 9 }, budget: { hours: 8 }, spent: true });
  assert.deepEqual([spent.pct, spent.full], [100, true], "a spent day fills the bar and turns it gold");
  assert.equal(bandBar({ isJourney: true, walked: { hours: 3 }, budget: { hours: 0 } }).pct, 0, "no budget, no fill");

  const rest = bandBar({ isJourney: false, delve: { sinceRest: 3, restMax: 5, winded: false } });
  assert.equal(rest.label, said("bar.rest", { since: 3, max: 5 }));
  assert.deepEqual([rest.pct, rest.full, rest.bad], [60, false, false]);
  const winded = bandBar({ delve: { sinceRest: 6, restMax: 5, winded: true } });
  assert.deepEqual([winded.pct, winded.bad], [100, true], "past the interval, clamped and red");
  const unpriced = bandBar({ delve: { sinceRest: 4, restMax: 0 } });
  assert.equal(unpriced.label, said("bar.restUnpriced", { since: 4 }), "an interval never imported leaves a bare count");
  assert.equal(unpriced.pct, 0);
  assert.equal(bandBar(undefined).label, said("bar.restUnpriced", { since: 0 }), "no strip at all is a bare zero");
  assert.equal(bandBar({ delve: { sinceRest: 9, restMax: 5, winded: true, restOn: false } }), null, "a delve whose rests are not required has no bar");
  assert.equal(bandBar({ delve: { sinceRest: 3, restMax: 5, restOn: true } }).pct, 60, "and one whose are, has");

  assert.equal(hurtCount([]), 0);
  assert.equal(hurtCount(undefined), 0);
  assert.equal(
    hurtCount([{ value: 3, max: 8 }, { value: 8, max: 8 }, null, { value: 0, max: 5 }, { value: 4, max: null }, { value: "3", max: 8 }]),
    2,
    "below a known maximum counts; full, unknown and unread members do not",
  );
}

/* -------------------------------------------- */
/*  The frame view                              */
/* -------------------------------------------- */

const SAVES = ["paralysis", "death", "breath", "implements", "spell"].map((key) => ({ key, label: `L.${key}`, tooltip: `T.${key}` }));

/** A journey view: day three, five hours walked, in a borderlands hex. */
const journeyView = (over = {}) => ({
  strip: {
    mode: "journey",
    isJourney: true,
    modeLabel: "M.journey",
    dayCount: 2,
    walked: { hours: 5 },
    budget: { hours: 8 },
    spent: false,
    paused: false,
    hex: { label: "K7" },
    clock: { time: "14:00", hoursToDusk: 4, hoursToDawn: null },
    speed: { partsLine: "P.line" },
    supplies: { known: true, foodDays: 4, waterDays: 3, short: false },
    ...over.strip,
  },
  travel: {
    territories: [{ value: "borderlands", label: "Borderlands", selected: true }],
    followingOptions: [{ value: "none", label: "None", selected: true }],
    weather: { seasons: [{ value: "summer", label: "Summer", selected: true }] },
    lost: { active: false },
    ...over.travel,
  },
  saves: SAVES,
  lights: [],
  speed: 120,
  effSpeed: 120,
  hurried: false,
  frontage: 2,
  partyImg: "img/party.webp",
});

/** A delve view: two lights burning, one spent, the supplies not known. */
const delveView = (over = {}) => ({
  strip: {
    mode: "delve",
    isJourney: false,
    modeLabel: "M.delve",
    paused: false,
    delve: { turns: 7, elapsed: "E.70", sinceRest: 3, restMax: 5, winded: false, hurried: false },
    supplies: { known: false },
    ...over.strip,
  },
  travel: { ...over.travel },
  saves: SAVES,
  lights: [{ lit: true, remaining: 6 }, { lit: true, remaining: 2 }, { lit: false, remaining: 1 }],
  speed: 120,
  effSpeed: 90,
  hurried: false,
  frontage: 1,
  partyImg: null,
});

/** A city view: paused, hurried, short of food, on a block rate. */
const cityView = () => ({
  strip: {
    mode: "settlement",
    isJourney: false,
    modeLabel: "M.city",
    paused: true,
    delve: { turns: 2, sinceRest: 1, restMax: 0 },
    settlement: { rateBlocks: 3, blocksUnpriced: false, clockLine: "C.line" },
    supplies: { known: true, foodDays: 2, waterDays: null, short: true },
  },
  travel: {},
  saves: SAVES,
  lights: [],
  speed: 120,
  effSpeed: 120,
  hurried: true,
  frontage: 3,
  partyImg: null,
});

/** The seats a party sheet is opened on, as party-actor.mjs's `seatOf` computes them. */
const SEAT = {
  judge: { isGM: true, ownsMember: true, ownsEveryMember: true, ownsParty: true, canBrowse: true, canSaveOrders: true },
  /** A seat that owns no member and not the party actor. */
  none: { isGM: false, ownsMember: false, ownsEveryMember: false, ownsParty: false, canBrowse: false },
  /** Owns the party actor with no member of it, as a world where players move the party gives. */
  partyOnly: { isGM: false, ownsMember: false, ownsEveryMember: false, ownsParty: true, canBrowse: false },
  /** A Player owning one of two members. */
  playerOne: { isGM: false, ownsMember: true, ownsEveryMember: false, ownsParty: true, canBrowse: false },
  /** A Player owning every member. */
  playerAll: { isGM: false, ownsMember: true, ownsEveryMember: true, ownsParty: true, canBrowse: false },
  /** A Trusted seat owning one of two members: it may browse files. */
  trusted: { isGM: false, ownsMember: true, ownsEveryMember: false, ownsParty: true, canBrowse: true },
};
/** A boolean stands for the Judge's seat or for a seat that owns nothing. */
const seatFor = (seat) => (typeof seat === "boolean" ? (seat ? SEAT.judge : SEAT.none) : seat);
const frameOf = (view, seat, extra = {}) =>
  buildFrameView({ view, seat: seatFor(seat), headcount: 5, hitPoints: [{ value: 3, max: 8 }, { value: 8, max: 8 }], clockTime: "09:30", ...extra });

{
  // ---- The rails are the same in every mode; a mode changes the readings ----
  const modes = { journey: journeyView(), delve: delveView(), settlement: cityView() };
  for (const [mode, view] of Object.entries(modes)) {
    for (const isGM of [true, false]) {
      const f = frameOf(view, isGM);
      assert.equal(f.mode, mode);
      assert.deepEqual(keys(f.rails.figures), ["hp", "supplies", "mouths", "pace", "light"], `${mode}: the figures rail`);
      if (isGM) {
        assert.deepEqual(keys(f.rails.saves), ["save-paralysis", "save-death", "save-breath", "save-implements", "save-spell", "magical"]);
        assert.deepEqual(keys(f.rails.tools), ["encounter", "checks", "search", "pause", "xp"], `${mode}: the quick tools`);
        assert.deepEqual(keys(f.rails.sheet), ["description", "image", "ownership", "tweaks", "key"]);
      } else {
        assert.deepEqual(f.rails.saves, [], `${mode}: a seat owning no member has no saves rail`);
        assert.deepEqual(f.rails.tools, [], "and no quick tools");
        assert.deepEqual(keys(f.rails.sheet), ["key"], "and of the sheet tools, the Key alone");
      }
      for (const cell of [...f.rails.saves, ...f.rails.figures, ...f.rails.tools, ...f.rails.sheet]) {
        assert.ok(cell.icon && cell.title && cell.keyLabel, `${mode}/${cell.key}: a glyph, a title and a Key line`);
      }
    }
  }

  // The throw and the search press the mode's own action.
  const tool = (view, key) => byKey(frameOf(view, true).rails.tools, key);
  assert.equal(tool(journeyView(), "encounter").action, "travelEncounterThrow");
  assert.equal(tool(delveView(), "encounter").action, "encounterNow");
  assert.equal(tool(cityView(), "encounter").action, "encounterNow");
  assert.equal(tool(journeyView(), "search").action, "searchHour");
  for (const view of [delveView(), cityView()]) {
    assert.deepEqual([tool(view, "search").action, tool(view, "search").check], ["partyCheck", "searchMethodical"]);
  }
  assert.equal(tool(journeyView(), "checks").action, "partyChecks");
  const paused = tool(cityView(), "pause");
  assert.deepEqual([paused.toggle, paused.on, paused.cls, paused.title], [true, true, "is-on", said("tool.resume")], "a paused clock offers the resume");
  assert.deepEqual([tool(journeyView(), "pause").on, tool(journeyView(), "pause").title], [false, said("tool.pause")]);

  // The saves: five presses and the Magical source they read, on by default.
  const gm = frameOf(journeyView(), true);
  for (const cell of gm.rails.saves.slice(0, 5)) {
    const key = cell.key.slice("save-".length);
    assert.deepEqual([cell.action, cell.save, cell.short], ["partySave", key, said(`saveShort.${key}`)]);
    assert.equal(cell.title, `T.${key}`);
  }
  assert.equal(byKey(gm.rails.saves, "save-breath").icon, SAVE_ICONS.blast, "the breath save wears the blast glyph");
  assert.equal(byKey(gm.rails.saves, "save-paralysis").icon, SAVE_ICONS.paralysis);
  const magical = byKey(gm.rails.saves, "magical");
  assert.deepEqual([magical.action, magical.toggle, magical.on, magical.cls], ["toggleMagical", true, true, "is-on"]);
  const mundane = byKey(frameOf(journeyView(), true, { magical: false }).rails.saves, "magical");
  assert.deepEqual([mundane.on, mundane.cls], [false, ""]);
  assert.equal(mundane.title, said("magical.title", { state: said("magical.off") }));

  // The sheet tools: the Key and the editor are toggles.
  const open = frameOf(journeyView(), true, { keyOpen: true, editing: true });
  assert.deepEqual([byKey(open.rails.sheet, "key").on, byKey(open.rails.sheet, "key").cls], [true, "is-on"]);
  assert.deepEqual([byKey(open.rails.sheet, "description").on, byKey(open.rails.sheet, "description").action], [true, "editDescription"]);
  assert.equal(byKey(open.rails.sheet, "tweaks").action, "tweaks");
  assert.equal(byKey(open.rails.sheet, "ownership").action, "ownership");
  assert.equal(byKey(open.rails.sheet, "image").action, "editPartyImage");
}

{
  // ---- The figures: readings by mode, presses by seat ----
  const gmJourney = frameOf(journeyView(), true).rails.figures;
  const plJourney = frameOf(journeyView(), false).rails.figures;

  const hp = byKey(gmJourney, "hp");
  assert.deepEqual([hp.sub, hp.cls, hp.action], [said("figure.hurt", { n: 1 }), "is-bad", "adjustHp"], "one member below a known maximum");
  assert.equal(hp.title, said("press", { label: said("cell", { name: said("figure.hp"), reading: said("figure.hurt", { n: 1 }) }), press: said("presses.hp") }),
    "a press is named after the reading it acts on");
  const whole = byKey(buildFrameView({ view: journeyView(), seat: SEAT.judge, hitPoints: [{ value: 8, max: 8 }] }).rails.figures, "hp");
  assert.deepEqual([whole.sub, whole.cls], ["—", ""], "nobody hurt");

  assert.equal(byKey(gmJourney, "supplies").sub, said("figure.days", { n: 4 }));
  assert.equal(byKey(gmJourney, "supplies").action, "consumeRations");
  assert.equal(byKey(frameOf(delveView(), true).rails.figures, "supplies").sub, "—", "supplies not known read a dash");
  assert.equal(byKey(frameOf(cityView(), true).rails.figures, "supplies").cls, "is-bad", "short supplies are red");

  const mouths = byKey(gmJourney, "mouths");
  assert.deepEqual([mouths.sub, mouths.action, mouths.tab], ["5", "goTab", "order"], "the heads, and a press that opens the roster");

  assert.deepEqual([byKey(gmJourney, "pace").sub, byKey(gmJourney, "pace").action, byKey(gmJourney, "pace").tab], ["120'", "goTab", "mode"],
    "a journey's pace opens the movement it reads");
  assert.equal(byKey(gmJourney, "pace").title.includes("P.line"), true, "and reads the speed's parts");
  const delvePace = byKey(frameOf(delveView(), true).rails.figures, "pace");
  assert.deepEqual([delvePace.sub, delvePace.action], ["120'", "togglePace"]);
  const hurriedPace = byKey(frameOf({ ...delveView(), hurried: true }, true).rails.figures, "pace");
  assert.deepEqual([hurriedPace.sub, hurriedPace.cls], ["90'", "is-warn"], "a hurried delve reads its effective speed");
  const cityPace = byKey(frameOf(cityView(), true).rails.figures, "pace");
  assert.deepEqual([cityPace.sub, cityPace.cls, cityPace.action], [said("figure.blocksSub", { n: 3 }), "is-warn", "togglePace"]);

  assert.equal(byKey(gmJourney, "light").sub, said("figure.hoursSub", { n: 4 }), "the hours to dusk");
  const night = byKey(frameOf(journeyView({ strip: { clock: { time: "20:00", hoursToDusk: null, hoursToDawn: 10 } } }), true).rails.figures, "light");
  assert.equal(night.sub, said("figure.hoursSub", { n: 10 }), "after dark, the hours to dawn");
  assert.equal(byKey(frameOf(delveView(), true).rails.figures, "light").sub, said("figure.turnsSub", { n: 2 }), "the fewest turns among the lights burning");
  assert.equal(byKey(frameOf({ ...delveView(), lights: [] }, true).rails.figures, "light").sub, "—", "no light burning");
  // A member's magic light is a light: shining with no flame lit, the cell does not read the no-light figure.
  const noFlame = { ...delveView(), lights: [] };
  const magicRow = (over) => ({ set: true, shining: true, badge: "B.shining", ...over });
  const shiningCell = byKey(frameOf({ ...noFlame, magicLights: [magicRow()] }, true).rails.figures, "light");
  assert.deepEqual([shiningCell.sub, shiningCell.title.includes("B.shining"), shiningCell.title.includes(said("figure.noLight"))], ["B.shining", true, false], "a shining magic light with no flame is a light");
  const coveredCell = byKey(frameOf({ ...noFlame, magicLights: [magicRow({ shining: false, badge: "B.shuttered" })] }, true).rails.figures, "light");
  assert.deepEqual([coveredCell.sub, coveredCell.title.includes(said("figure.noLight"))], ["—", true], "a covered magic light is no light");
  const unsetCell = byKey(frameOf({ ...noFlame, magicLights: [magicRow({ set: false })] }, true).rails.figures, "light");
  assert.deepEqual([unsetCell.sub, unsetCell.title.includes(said("figure.noLight"))], ["B.shining", false], "a shining light whose reach is not typed is still the party's light, as a flame with no imported reach is");
  assert.equal(
    byKey(frameOf({ ...delveView(), magicLights: [magicRow()] }, true).rails.figures, "light").sub,
    said("figure.turnsSub", { n: 2 }),
    "a lit flame still reads its turns beside a magic light",
  );
  const cityLight = byKey(frameOf(cityView(), true).rails.figures, "light");
  assert.deepEqual([cityLight.sub, cityLight.title.includes("C.line")], ["09:30", true], "the city reads the clock and its board's line");
  for (const view of [journeyView(), delveView(), cityView()]) {
    const light = byKey(frameOf(view, false).rails.figures, "light");
    assert.deepEqual([light.action, light.tab], ["goTab", "kit"], "the light opens the Kit on every seat");
  }

  // A player's copy of a cell whose press writes is a reading with no action;
  // a press that only navigates stays.
  for (const key of ["hp", "supplies"]) {
    assert.equal(byKey(plJourney, key).action, undefined, `a player's ${key} cell is a reading`);
    assert.ok(!byKey(plJourney, key).title.includes(said("presses.hp")) && !byKey(plJourney, key).title.includes(said("presses.ration")),
      "named by its reading alone");
  }
  assert.equal(byKey(plJourney, "mouths").action, "goTab");
  assert.equal(byKey(plJourney, "pace").action, "goTab", "a journey's pace navigates on every seat");
  assert.equal(byKey(frameOf(delveView(), false).rails.figures, "pace").action, undefined, "the delve's pace is the Judge's press");
}

{
  // ---- Rails by seat: a press follows what the seat owns of what it writes ----
  const rails = (view, seat) => frameOf(view, seat).rails;
  const SAVE_KEYS = ["save-paralysis", "save-death", "save-breath", "save-implements", "save-spell", "magical"];

  // The Judge's matrix is what it always was, in every mode.
  for (const view of [journeyView(), delveView(), cityView()]) {
    const judge = rails(view, SEAT.judge);
    assert.deepEqual(keys(judge.saves), SAVE_KEYS);
    assert.deepEqual(keys(judge.tools), ["encounter", "checks", "search", "pause", "xp"]);
    assert.deepEqual(keys(judge.sheet), ["description", "image", "ownership", "tweaks", "key"]);
    assert.deepEqual(frameOf(view, SEAT.judge).key.groups.map((g) => g.key), ["saves", "figures", "tools", "sheet"]);
    assert.equal(byKey(judge.figures, "supplies").action, "consumeRations");
    assert.equal(byKey(judge.figures, "hp").action, "adjustHp");
    assert.equal(frameOf(view, SEAT.judge).plate.edit, true);
  }

  // A Player owning one of two members, in the delve.
  const one = rails(delveView(), SEAT.playerOne);
  assert.deepEqual(keys(one.saves), SAVE_KEYS, "a member's owner has the saves rail and the Magical toggle");
  assert.deepEqual(keys(one.tools), ["checks", "search"], "the checks and the methodical search; no encounter, pause or experience");
  assert.deepEqual([byKey(one.tools, "search").action, byKey(one.tools, "search").check], ["partyCheck", "searchMethodical"]);
  assert.deepEqual(keys(one.sheet), ["description", "key"], "the description, and no image without file browsing");
  assert.equal(byKey(one.sheet, "description").action, "editDescription");
  for (const cell of one.saves.slice(0, 5)) {
    const save = cell.key.slice("save-".length);
    assert.equal(cell.action, "partySave");
    assert.equal(cell.title, game.i18n.format("ACKS-FORMATION.app.saveTooltipOwned", { save: `L.${save}` }), "the tooltip says whose members it rolls for");
    assert.notEqual(cell.title, `T.${save}`, "not the Judge's words");
  }
  const supplies = byKey(one.figures, "supplies");
  assert.equal(supplies.action, "consumeRations", "Supplies is a press");
  assert.ok(supplies.title.includes(`"${said("presses.rationOwned")}"`), "naming the members it rations");
  assert.ok(byKey(rails(delveView(), SEAT.judge).figures, "supplies").title.includes(`"${said("presses.ration")}"`), "the Judge keeps the shipped words");
  assert.equal(byKey(one.figures, "hp").action, undefined, "hit points stay a reading");
  assert.equal(byKey(one.figures, "pace").action, "togglePace", "the delve's pace is a press for a member's owner");
  assert.equal(frameOf(delveView(), SEAT.playerOne).plate.edit, false, "no plate press without file browsing");
  const oneKey = frameOf(delveView(), SEAT.playerOne).key.groups;
  assert.deepEqual(oneKey.map((g) => g.key), ["saves", "figures", "tools", "sheet"]);
  assert.deepEqual(oneKey.map((g) => g.rows.length), [6, 5, 2, 2], "the Key lists the cells the seat draws and no others");

  // The city's search is the delve's; a journey's hour search is the Judge's secret and is left out.
  assert.deepEqual(keys(rails(cityView(), SEAT.playerOne).tools), ["checks", "search"]);
  const onJourney = rails(journeyView(), SEAT.playerOne);
  assert.deepEqual(keys(onJourney.tools), ["checks"], "a journey's tools rail lacks the search cell");
  const journeyTools = frameOf(journeyView(), SEAT.playerOne).key.groups.find((g) => g.key === "tools");
  assert.deepEqual(journeyTools.rows.map((r) => r.label), [said("tool.checks")], "and so does its Key");
  assert.equal(byKey(onJourney.figures, "pace").action, "goTab", "the journey's pace still opens Movement");

  // Deal XP: only a seat owning every participant.
  assert.deepEqual(keys(rails(delveView(), SEAT.playerAll).tools), ["checks", "search", "xp"]);
  assert.equal(byKey(rails(delveView(), SEAT.playerAll).tools, "xp").action, "dealXp");
  assert.equal(byKey(rails(delveView(), SEAT.playerOne).tools, "xp"), undefined, "owning some members is not enough");
  assert.equal(byKey(rails(journeyView(), SEAT.playerAll).tools, "xp").action, "dealXp", "on a journey too");

  // A Trusted seat adds the Image tool and the plate press.
  const trusted = rails(delveView(), SEAT.trusted);
  assert.deepEqual(keys(trusted.sheet), ["description", "image", "key"]);
  assert.equal(byKey(trusted.sheet, "image").action, "editPartyImage");
  assert.deepEqual(keys(trusted.tools), ["checks", "search"]);
  assert.equal(frameOf(delveView(), SEAT.trusted).plate.edit, true, "the plate is a press where the Image tool is drawn");
  // A journey's drawn plate stays unpressable on every seat.
  const drawnHex = { kind: "frame", draw: true, blank: false, img: null, hex: "K7", edit: false, differ: false, aria: "A.drawn" };
  for (const seat of [SEAT.judge, SEAT.trusted]) {
    assert.equal(frameOf(journeyView({ travel: { plate: drawnHex } }), seat).plate.edit, false, "a drawn hex is no press");
  }

  // The party actor's owner with no member of it: the description, and nothing that writes a member.
  const partyOnly = rails(delveView(), SEAT.partyOnly);
  assert.deepEqual([partyOnly.saves, partyOnly.tools], [[], []]);
  assert.deepEqual(keys(partyOnly.sheet), ["description", "key"]);

  // Ownership, Tweaks, the encounter, the pause and the astray chip are the Judge's on every other seat.
  for (const seat of [SEAT.playerOne, SEAT.playerAll, SEAT.trusted, SEAT.partyOnly]) {
    const seen = rails(delveView(), seat);
    assert.ok(!byKey(seen.sheet, "ownership") && !byKey(seen.sheet, "tweaks"));
    for (const key of ["encounter", "pause"]) assert.equal(byKey(seen.tools, key), undefined);
    const astray = frameOf(journeyView({ travel: { lost: { active: true, days: 1, fakedHexes: 1 } } }), seat).reading.chips;
    assert.equal(byKey(astray, "astray"), undefined);
  }

  // Every cell any seat draws has a glyph, a tooltip and a Key line.
  for (const seat of Object.values(SEAT)) {
    for (const view of [journeyView(), delveView(), cityView()]) {
      const seen = rails(view, seat);
      for (const cell of [...seen.saves, ...seen.figures, ...seen.tools, ...seen.sheet]) {
        assert.ok(cell.icon && cell.title && cell.keyLabel, `${cell.key}: a glyph, a title and a Key line`);
      }
    }
  }

  // A frame built with no seat at all draws no press of a seat's.
  const bare = buildFrameView({ view: delveView() });
  assert.deepEqual([bare.rails.saves, bare.rails.tools, keys(bare.rails.sheet)], [[], [], ["key"]]);
}

{
  // ---- The reading, the plate, the Key, the heads, the panel ----
  const gm = frameOf(journeyView(), true);
  assert.equal(gm.reading.overline,
    ["M.journey", "ACKS-FORMATION.travel.dayN " + JSON.stringify({ n: 3 }), said("overline.hex", { hex: "K7" }), "14:00", "Summer"].join(" · "));
  assert.deepEqual(gm.reading.chips.map((c) => c.key), ["territory", "heads"], "following nothing is no chip");
  assert.equal(byKey(gm.reading.chips, "heads").label, said("chip.heads", { n: 5 }));
  const river = frameOf(journeyView({ travel: { followingOptions: [{ value: "river", label: "A river", selected: true }] } }), true);
  assert.deepEqual(river.reading.chips.map((c) => c.key), ["territory", "following", "heads"]);
  assert.equal(frameOf(delveView(), true).reading.overline, ["M.delve", "09:30"].join(" · "), "off a journey: the mode and the clock");

  const city = frameOf(cityView(), true);
  assert.deepEqual(byKey(city.reading.chips, "paused"), { key: "paused", label: said("chip.paused"), cls: "is-gold" });

  const lost = { travel: { lost: { active: true, days: 2, fakedHexes: 3 } } };
  const astray = byKey(frameOf(journeyView(lost), true).reading.chips, "astray");
  assert.deepEqual([astray.cls, astray.title], ["is-judge", "ACKS-FORMATION.travel.lostHint"], "the Judge's compass, marked as the Judge's");
  assert.equal(byKey(frameOf(journeyView(lost), false).reading.chips, "astray"), undefined, "never on a player's seat");
  assert.equal(byKey(frameOf(delveView(lost), true).reading.chips, "astray"), undefined, "and only on a journey");

  const imagePlate = { kind: "frame", draw: false, blank: false, edit: true, differ: false, aria: "" };
  assert.deepEqual(gm.plate, { ...imagePlate, img: "img/party.webp", hex: "K7" }, "no drawing to show: the party's image, the Judge's to change");
  assert.deepEqual(frameOf(delveView(), true).plate, { ...imagePlate, img: null, hex: "" }, "the hex label is a journey's");
  assert.equal(frameOf(journeyView(), false).plate.edit, false, "a seat that may not change the image presses no plate");

  // A journey's drawn plate passes through as the view built it; the frame's
  // copy is never a press, on any seat.
  const drawn = { kind: "frame", draw: true, blank: false, img: "img/party.webp", hex: "K7", edit: false, differ: false, aria: "A.drawn", sceneId: "S1", center: { x: 50, y: 50 }, points: [], tint: null, mark: null, judge: true };
  assert.deepEqual(frameOf(journeyView({ travel: { plate: drawn } }), true).plate, drawn);
  assert.equal(frameOf(delveView({ travel: { plate: drawn } }), true).plate.draw, false, "only a journey draws its hex");
  // Shown as unknown country: the blank, no hex named, no country chip.
  const blankPlate = { kind: "frame", draw: false, blank: true, img: "img/party.webp", hex: "", edit: false, differ: false, aria: "A.blank" };
  const unknown = frameOf(journeyView({ strip: { hex: { label: "" } }, travel: { plate: blankPlate, blank: true } }), true);
  assert.deepEqual(unknown.plate, blankPlate);
  assert.ok(!unknown.reading.overline.includes(said("overline.hex", { hex: "K7" })), "the overline names no hex");
  assert.deepEqual(unknown.reading.chips.map((c) => c.key), ["heads"], "and the reading wears no country chip");
  assert.deepEqual(gm.band, { modeLabel: "M.journey", bar: bandBar(journeyView().strip) });

  assert.equal(gm.key.open, false);
  assert.equal(frameOf(journeyView(), true, { keyOpen: true }).key.open, true);
  assert.deepEqual(gm.key.groups.map((g) => g.key), ["saves", "figures", "tools", "sheet"]);
  assert.deepEqual(frameOf(journeyView(), false).key.groups.map((g) => g.key), ["figures", "sheet"], "a seat's Key names only the cells that seat draws");
  const savesGroup = gm.key.groups[0];
  assert.deepEqual(savesGroup.rows[0], { icon: SAVE_ICONS.paralysis, short: said("saveShort.paralysis"), label: "L.paralysis" });
  assert.equal(byKey(gm.rails.figures, "hp").keyLabel, said("press", { label: said("figure.hp"), press: said("presses.hp") }));

  assert.equal(gm.heads.mode.title, said("head.journey", { day: 3 }));
  assert.equal(frameOf(delveView(), true).heads.mode.title, said("head.delve", { turns: 7, elapsed: "E.70" }));
  assert.equal(city.heads.mode.title, said("head.city", { turns: 2 }));

  // Every seat's mode head carries a title tooltip filled from the figures the title prints, ending in its page reference.
  assert.equal(gm.heads.mode.tip, said("head.journeyTip", { day: 3 }));
  assert.equal(frameOf(delveView(), true).heads.mode.tip, said("head.delveTip", { turns: 7, elapsed: "E.70" }));
  assert.equal(city.heads.mode.tip, said("head.cityTip", { turns: 2 }));
  assert.equal(frameOf(delveView(), SEAT.none).heads.mode.tip, said("head.delveTip", { turns: 7, elapsed: "E.70" }), "a seat that owns nothing reads the same tip");
  // The asks line shows on a delve or city head whose seat owns a member and is not the Judge's.
  for (const [name, view] of [["delve", delveView()], ["city", cityView()]]) {
    assert.equal(frameOf(view, true).heads.mode.asks, "", `${name}: the Judge's head asks no one`);
    assert.equal(frameOf(view, SEAT.none).heads.mode.asks, "", `${name}: a seat owning no member has no pills to caption`);
    assert.equal(frameOf(view, SEAT.playerOne).heads.mode.asks, said("head.asks"), `${name}: a member-owner's head says Turn and Round ask`);
  }
  assert.ok(!frameOf(journeyView(), SEAT.playerOne).heads.mode.asks, "a journey head has no clock press to ask");
  // A member-owner presses the pace cell in the delve and the city; a journey's cell navigates.
  assert.equal(byKey(frameOf(delveView(), SEAT.playerOne).rails.figures, "pace").action, "togglePace");
  assert.equal(byKey(frameOf(cityView(), SEAT.playerOne).rails.figures, "pace").action, "togglePace");
  assert.equal(byKey(frameOf(delveView(), SEAT.none).rails.figures, "pace").action, undefined, "a seat owning no member reads the pace alone");
  assert.equal(byKey(frameOf(journeyView(), SEAT.playerOne).rails.figures, "pace").action, "goTab");
  assert.equal(gm.heads.order.title, said("head.order", { heads: 5, frontage: 2 }));
  assert.deepEqual([gm.heads.judge.state, gm.heads.judge.open], [said("judge.closed"), false], "no episode open");
  const judge = frameOf(journeyView(lost), true).heads.judge;
  assert.deepEqual([judge.open, judge.state], [true, "ACKS-FORMATION.lost.astraySince " + JSON.stringify({ days: 2, hexes: 3 })]);
  assert.equal(frameOf(journeyView({ travel: { lost: { aware: true, days: 4 } } }), true).heads.judge.open, true, "an episode the party knows of is open");

  assert.deepEqual(gm.panel, { hidden: false, label: said("chevron.hide") });
  assert.deepEqual(frameOf(journeyView(), false, { panelHidden: true }).panel, { hidden: true, label: said("chevron.show") });
}

/* -------------------------------------------- */
/*  The templates                               */
/* -------------------------------------------- */

{
  const { default: Handlebars } = await import("handlebars");
  const hb = Handlebars.create();
  const T = (name) => `templates/formation/${name}.hbs`;
  hb.registerHelper("localize", (key, options) =>
    String(key) + (options?.hash && Object.keys(options.hash).length ? JSON.stringify(options.hash) : ""));
  for (const name of ["formation-cell", "formation-plate"]) {
    hb.registerPartial(`modules/acks-extras/templates/formation/${name}.hbs`, hb.compile(fs.readFileSync(T(name), "utf8")));
  }
  const parts = ["formation-band", "formation-frame", "formation-tabs"].map((name) => hb.compile(fs.readFileSync(T(name), "utf8")));

  // The handlers a press may name: SHARED_ACTIONS' keys and the sheet's own,
  // read from source, and core's `tab`.
  const shared = fs.readFileSync("scripts/formation/formation-actions.mjs", "utf8");
  const block = shared.slice(shared.indexOf("export const SHARED_ACTIONS = {"));
  const sheet = fs.readFileSync("scripts/formation/party-actor.mjs", "utf8");
  const handlers = new Set([
    ...[...block.slice(0, block.indexOf("\n};")).matchAll(/^ {2}(?:async )?(\w+)\(/gm)].map((m) => m[1]),
    ...[...sheet.matchAll(/^ {6}(\w+): PartySheet\.#/gm)].map((m) => m[1]),
    "tab",
  ]);
  for (const name of ["partySave", "partyChecks", "tweaks", "goTab", "togglePanel", "toggleKey", "toggleMagical", "editDescription", "ownership"]) {
    assert.ok(handlers.has(name), `the handler list was read: ${name}`);
  }

  const render = (view, seat, extra = {}) => {
    const isGM = seatFor(seat).isGM;
    const frame = frameOf(view, seat, extra);
    const tabs = Object.fromEntries(
      frameTabs({ mode: view.strip.mode, isGM }).map((tab, i) => [
        tab.id,
        { ...tab, group: "primary", active: i === 0, cssClass: [tab.cssClass, i === 0 ? "active" : ""].filter(Boolean).join(" ") },
      ]),
    );
    const context = {
      isGM,
      seat: seatFor(seat),
      formation: { id: "f1", name: "The Company" },
      partyName: "The Company",
      strip: { ...view.strip, modeOptions: ["delve", "journey", "settlement"].map((value) => ({ value, label: `M.${value}`, selected: value === view.strip.mode })) },
      warnings: ["W.one"],
      // As the sheet builds it: the editor is a Judge's state alone.
      description: { source: "<p>Desc</p>", html: "<p>Desc</p>", editing: isGM && !!extra.editing },
      document: { uuid: "Actor.party" },
      tabs,
      frame,
    };
    return parts.map((part) => part(context)).join("\n");
  };
  const actionsIn = (html) => [...html.matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
  const JUDGE_PRESSES = [
    "partySave", "toggleMagical", "travelEncounterThrow", "encounterNow", "partyChecks", "searchHour", "partyCheck",
    "togglePause", "dealXp", "adjustHp", "consumeRations", "togglePace", "editDescription", "editPartyImage", "ownership", "tweaks",
  ];
  /** The Judge's presses a mode does not carry: the other modes' throw and search, and a journey's pace, which navigates. */
  const NOT_IN = {
    journey: ["encounterNow", "partyCheck", "togglePace"],
    delve: ["travelEncounterThrow", "searchHour"],
    settlement: ["travelEncounterThrow", "searchHour"],
  };

  for (const [mode, view] of [["journey", journeyView()], ["delve", delveView()], ["settlement", cityView()]]) {
    for (const isGM of [true, false]) {
      const seat = `${mode}/${isGM ? "GM" : "player"}`;
      const html = render(view, isGM, { keyOpen: true });
      assert.ok(!/\sid="/.test(html), `${seat}: no literal id`);
      assert.ok(!/aria-selected/.test(html), `${seat}: the pills are pressed, never selected`);
      for (const action of actionsIn(html)) assert.ok(handlers.has(action), `${seat}: data-action "${action}" has a handler`);
      for (const [, attrs, inner] of html.matchAll(/<button([^>]*)>([^]*?)<\/button>/g)) {
        const name = /aria-label="([^"]+)"/.exec(attrs)?.[1] ?? inner.replace(/<[^>]*>/g, "").trim();
        assert.ok(name, `${seat}: every button is named (${attrs.trim().slice(0, 60)})`);
      }
      const bar = /<div class="acks-extras-party-sheet__bar[^>]*>/.exec(html)?.[0];
      assert.ok(bar && !bar.includes("data-action"), `${seat}: the bar is a reading`);
      assert.ok(html.includes('data-action="toggleKey"') && html.includes('data-action="togglePanel"'), `${seat}: the Key and the chevron`);
      assert.match(html, /class="acks-tab acks-extras-party-sheet__pill active" data-action="tab"\s+data-group="primary" data-tab="mode" aria-pressed="true"/,
        `${seat}: the mode tab is the active pill`);
      assert.ok(html.includes("W.one"), `${seat}: the warnings reach every seat`);
      if (isGM) {
        for (const action of JUDGE_PRESSES) {
          assert.equal(html.includes(`data-action="${action}"`), !NOT_IN[mode].includes(action), `${seat}: the Judge's ${action}`);
        }
        assert.ok(html.includes('name="travel.mode"'), `${seat}: the mode picker`);
        assert.ok(html.includes('name="name"'), `${seat}: the name field`);
        assert.ok(html.includes("is-judge"), `${seat}: the Judge's tab is drawn`);
        assert.equal((html.match(/data-group-key=/g) ?? []).length, 4, `${seat}: four Key groups`);
      } else {
        for (const action of JUDGE_PRESSES) assert.ok(!html.includes(`data-action="${action}"`), `${seat}: no ${action}`);
        assert.ok(!/name="(travel\.mode|name|system\.description)"/.test(html), `${seat}: no field of the Judge's`);
        assert.ok(!html.includes("is-judge") && !html.includes('data-tab="judge"'), `${seat}: nothing of the Judge's tab`);
        assert.equal((html.match(/data-group-key=/g) ?? []).length, 2, `${seat}: two Key groups`);
        assert.ok(html.includes("acks-sr-only"), `${seat}: a reading cell names itself to a screen reader`);
      }
    }
  }

  // An owning seat's render: the presses are the ones frame-view drew, each named and carrying a tooltip,
  // and none of the Judge's is among them.
  const SEAT_PRESSES = ["partySave", "toggleMagical", "partyChecks", "partyCheck", "consumeRations", "togglePace", "dealXp", "editDescription", "editPartyImage"];
  for (const [name, seat, view, expected] of [
    ["Player owning one of two", SEAT.playerOne, delveView(), ["partySave", "toggleMagical", "partyChecks", "partyCheck", "consumeRations", "togglePace", "editDescription"]],
    ["Player on a journey", SEAT.playerOne, journeyView(), ["partySave", "toggleMagical", "partyChecks", "consumeRations", "editDescription"]],
    ["Player owning every member", SEAT.playerAll, delveView(), ["partySave", "toggleMagical", "partyChecks", "partyCheck", "consumeRations", "togglePace", "dealXp", "editDescription"]],
    ["Trusted", SEAT.trusted, delveView(), ["partySave", "toggleMagical", "partyChecks", "partyCheck", "consumeRations", "togglePace", "editDescription", "editPartyImage"]],
  ]) {
    const html = render(view, seat, { keyOpen: true });
    const drawn = new Set(actionsIn(html));
    for (const action of SEAT_PRESSES) assert.equal(drawn.has(action), expected.includes(action), `${name}: ${action}`);
    for (const action of JUDGE_PRESSES.filter((a) => !SEAT_PRESSES.includes(a))) assert.ok(!drawn.has(action), `${name}: no ${action}`);
    for (const [, attrs] of html.matchAll(/<button([^>]*)>/g)) {
      assert.ok(/data-tooltip="[^"]+"/.test(attrs) && /aria-label="[^"]+"/.test(attrs) || !/data-action="(partySave|toggleMagical|partyChecks|partyCheck|consumeRations|togglePace|dealXp|editDescription|editPartyImage)"/.test(attrs),
        `${name}: a drawn press has a tooltip and a name (${attrs.trim().slice(0, 50)})`);
    }
    assert.equal((html.match(/data-group-key=/g) ?? []).length, 4, `${name}: the Key's groups`);
    assert.ok(!html.includes("is-judge") && !html.includes('data-tab="judge"'), `${name}: nothing of the Judge's tab`);
    assert.ok(html.includes('name="travel.mode"') && html.includes('name="name"'), `${name}: the mode picker and the name field, for a seat that owns a member`);
    assert.ok(!html.includes('name="system.description"'), `${name}: no description editor`);
    const plate = html.slice(html.indexOf("acks-extras-party-sheet__plate "), html.indexOf("acks-extras-party-sheet__rail--figures"));
    assert.equal(plate.includes('data-action="editPartyImage"'), seat.canBrowse, `${name}: the plate is a press only where files may be browsed`);
  }

  // The Key closes; the editor replaces the prose while it is open.
  assert.ok(!render(journeyView(), true).includes("acks-extras-party-sheet__key\""), "the Key is drawn only while open");
  const editing = render(journeyView(), true, { editing: true });
  assert.match(editing, /<prose-mirror[^>]*name="system\.description"/, "the description editor");
  assert.ok(!editing.includes("acks-extras-party-sheet__prose"), "in place of the prose");
  assert.match(render(journeyView(), false), /acks-extras-party-sheet__prose[^>]*><p>Desc<\/p>/, "a player reads the description");

  // The hidden panel: the chevron says what a press does.
  const hidden = render(journeyView(), false, { panelHidden: true });
  assert.match(hidden, /data-action="togglePanel"[^>]*aria-expanded="false"/);
  assert.ok(hidden.includes(said("chevron.show")));

  // The plate: the party's image is the Judge's press; a drawn hex is a canvas
  // the sheet paints after the render, named for a screen reader; a hex shown
  // as unknown is the frame alone.
  const plateOf = (html) => {
    const from = html.indexOf("acks-extras-party-sheet__plate ");
    return html.slice(from, html.indexOf("acks-extras-party-sheet__rail--figures", from));
  };
  assert.match(plateOf(render(journeyView(), true)), /data-action="editPartyImage"/, "the Judge presses the image to change it");
  assert.ok(!plateOf(render(journeyView(), false)).includes("data-action"), "a player's image is a picture");
  const drawn = { kind: "frame", draw: true, blank: false, img: "img/party.webp", hex: "K7", edit: false, differ: false, aria: "A.drawn" };
  const drawnPlate = plateOf(render(journeyView({ travel: { plate: drawn } }), true));
  assert.match(drawnPlate, /<canvas class="acks-extras-plate__canvas" data-plate-kind="frame" role="img" aria-label="A\.drawn">/);
  assert.ok(!drawnPlate.includes("data-action") && !drawnPlate.includes("<img"), "a drawn plate is no press and no picture");
  assert.ok(drawnPlate.includes(">K7</span>"), "and keeps its hex label over the drawing");
  const blank = { kind: "frame", draw: false, blank: true, img: "img/party.webp", hex: "", edit: false, differ: false, aria: "A.blank" };
  const blankPlate = plateOf(render(journeyView({ strip: { hex: { label: "" } }, travel: { plate: blank, blank: true } }), false));
  assert.match(blankPlate, /is-blank/);
  assert.ok(!/<canvas|<img|plate-hex/.test(blankPlate), "an unknown hex: no drawing, no picture, no label");
}

/* -------------------------------------------- */
/*  The Kit tab's "Cast a light spell" row      */
/* -------------------------------------------- */

{
  const { default: Handlebars } = await import("handlebars");
  const hb = Handlebars.create();
  hb.registerHelper("localize", (key) => String(key));
  const kit = hb.compile(fs.readFileSync("templates/formation/formation-tab-kit.hbs", "utf8"));
  const offer = (over = {}) => ({
    key: "a1|i1|", label: "Spell One · Caster A", listText: "List One", listTip: "List tip", slotsText: "2 of 3", slotsTip: "Slots tip", refusal: "", blocked: false, ...over,
  });
  /** The Kit tab's context for these offers, the way the sheet builds it: the first is picked unless `at` says otherwise. */
  const draw = (offers, { isGM = false, at = 0 } = {}) => {
    const lightCasts = offers.map((o, i) => ({ ...o, picked: i === at }));
    return kit({ isGM, formation: { id: "f1" }, tabs: { kit: { active: true } }, lightCasts, lightCastPicked: lightCasts[at] ?? null });
  };
  const rowOf = (html) => html.slice(html.indexOf('class="acks-extras-light-cast"'), html.indexOf("</section>", html.indexOf('class="acks-extras-light-cast"')));

  // No offer, no row; with one, any seat has it, and it sits outside the Judge's add-light block.
  assert.ok(!draw([], { isGM: true }).includes("acks-extras-light-cast"), "no offers: no row, the Judge's included");
  assert.ok(!draw([]).includes("castLightSpell"), "no offers: no Cast button");
  const player = draw([offer()]);
  assert.ok(player.includes('data-action="castLightSpell"') && !player.includes('class="add-light"'), "a seat that is not the Judge's has the row, and not the Judge's add-light");
  const judge = draw([offer()], { isGM: true });
  const addLight = judge.slice(judge.indexOf('<div class="add-light">'), judge.indexOf("</div>", judge.indexOf('<div class="add-light">')));
  assert.ok(addLight.includes('data-action="addLight"') && !addLight.includes("acks-extras-light-cast"), "the row is not inside the Judge's block");
  assert.ok(judge.indexOf('class="acks-extras-light-cast"') > judge.indexOf('data-action="addLight"'), "and follows it");

  // The pick: one option per offer, named, a staging pick, no literal id, no `title`.
  const two = draw([offer(), offer({ key: "a2|i2|list", label: "Spell Two · Caster B" })], { at: 1 });
  const row = rowOf(two);
  assert.match(row, /<select [^>]*aria-label="ACKS-FORMATION\.app\.lightCastPick"[^>]*data-pick="lightCast"|<select [^>]*data-pick="lightCast"[^>]*aria-label="ACKS-FORMATION\.app\.lightCastPick"/, "the select is named and is a staging pick");
  assert.equal((row.match(/<option /g) ?? []).length, 2, "one option for each offer");
  assert.ok(row.includes('value="a2|i2|list"') && row.includes(">Spell Two · Caster B</option>"), "an option's value is the offer's key and its text the label");
  assert.match(row, /value="a2\|i2\|list"[^>]*selected/, "the picked offer's option is selected");
  assert.doesNotMatch(row, /value="a1\|i1\|"[^>]*selected/, "and no other");
  assert.ok(!/\sid=/.test(row) && !/\stitle=/.test(row), "no literal id and no title attribute");
  assert.ok(row.includes('class="acks-extras-light-cast__caption"') && !/<label/.test(row), "the caption is a span, not a label");
  assert.ok(row.includes('data-list-text="List One"') && row.includes('data-slots-tip="Slots tip"'), "each option carries its line for the change listener");

  // The line: the list part and the slots part, each with its tooltip as text.
  assert.match(row, /data-light-cast-part="list" data-tooltip-text="List tip">List One</, "the list part and its tooltip");
  assert.match(row, /data-light-cast-part="slots-wrap"> · <span data-light-cast-part="slots" data-tooltip-text="Slots tip">2 of 3</, "the slots part, joined by a middle dot, with its tooltip");
  const bare = rowOf(draw([offer({ slotsText: "", slotsTip: "", listTip: "" })]));
  assert.match(bare, /data-light-cast-part="slots-wrap" hidden>/, "a blank slots part is hidden");
  assert.doesNotMatch(bare, /data-tooltip-text/, "a blank tip draws no tooltip");

  // Cast is off for a blocked pick and the refusal is said with its lozenge; an allowed pick has neither.
  const open = rowOf(draw([offer()]));
  assert.doesNotMatch(open, /data-action="castLightSpell"[^>]*disabled/, "an allowed pick leaves Cast on");
  assert.match(open, /data-light-cast-part="refusal" hidden>/, "and says no refusal");
  const blocked = rowOf(draw([offer({ blocked: true, refusal: "Not on a list" })]));
  assert.match(blocked, /data-action="castLightSpell" disabled>/, "a blocked pick turns Cast off");
  assert.match(blocked, /role="note" data-light-cast-part="refusal"><span aria-hidden="true">&#9830; <\/span><span data-light-cast-part="refusal-text">Not on a list<\/span>/, "and says why under the line, led by the lozenge");
  const warned = rowOf(draw([offer({ blocked: false, refusal: "Warned" })], { isGM: true }));
  assert.ok(!/data-action="castLightSpell"[^>]*disabled/.test(warned) && !/data-light-cast-part="refusal" hidden/.test(warned), "a Judge's warned pick says its sentence and keeps Cast on");
}

console.log("test-party-frame: OK (parts and tabs by seat, the bar, hurt count, rails by mode and seat, reading, the plate drawn, blank or pictured, Key, heads, templates, the light-cast row)");
