/**
 * The party sheet's frame against mocked Foundry globals: which parts and tabs
 * a seat gets (`framePartIds`, `frameTabs`), what the band's bar reads, the
 * hurt count, and `buildFrameView` — the same rail cells in the same order in
 * every mode, the presses a seat gets and the ones it does not, the reading's
 * chips, the Key and the tab heads. Then the band, the frame and the tab row,
 * rendered with plain Handlebars for a Judge and for a player: no literal id,
 * every press names a handler, every button has a name, and nothing of the
 * Judge's reaches a player's render. Invented figures throughout, so these
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

const frameOf = (view, isGM, extra = {}) =>
  buildFrameView({ view, isGM, headcount: 5, hitPoints: [{ value: 3, max: 8 }, { value: 8, max: 8 }], clockTime: "09:30", ...extra });

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
        assert.deepEqual(f.rails.saves, [], `${mode}: a player's seat has no saves rail`);
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
  const whole = byKey(buildFrameView({ view: journeyView(), isGM: true, hitPoints: [{ value: 8, max: 8 }] }).rails.figures, "hp");
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

  assert.deepEqual(gm.plate, { img: "img/party.webp", hex: "K7" });
  assert.deepEqual(frameOf(delveView(), true).plate, { img: null, hex: "" }, "the hex label is a journey's");
  assert.deepEqual(gm.band, { modeLabel: "M.journey", bar: bandBar(journeyView().strip) });

  assert.equal(gm.key.open, false);
  assert.equal(frameOf(journeyView(), true, { keyOpen: true }).key.open, true);
  assert.deepEqual(gm.key.groups.map((g) => g.key), ["saves", "figures", "tools", "sheet"]);
  assert.deepEqual(frameOf(journeyView(), false).key.groups.map((g) => g.key), ["figures", "sheet"], "a player's Key names only a player's cells");
  const savesGroup = gm.key.groups[0];
  assert.deepEqual(savesGroup.rows[0], { icon: SAVE_ICONS.paralysis, short: said("saveShort.paralysis"), label: "L.paralysis" });
  assert.equal(byKey(gm.rails.figures, "hp").keyLabel, said("press", { label: said("figure.hp"), press: said("presses.hp") }));

  assert.equal(gm.heads.mode.title, said("head.journey", { day: 3 }));
  assert.equal(frameOf(delveView(), true).heads.mode.title, said("head.delve", { turns: 7, elapsed: "E.70" }));
  assert.equal(city.heads.mode.title, said("head.city", { turns: 2 }));
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
  hb.registerPartial("modules/acks-extras/templates/formation/formation-cell.hbs", hb.compile(fs.readFileSync(T("formation-cell"), "utf8")));
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

  const render = (view, isGM, extra = {}) => {
    const frame = frameOf(view, isGM, extra);
    const tabs = Object.fromEntries(
      frameTabs({ mode: view.strip.mode, isGM }).map((tab, i) => [
        tab.id,
        { ...tab, group: "primary", active: i === 0, cssClass: [tab.cssClass, i === 0 ? "active" : ""].filter(Boolean).join(" ") },
      ]),
    );
    const context = {
      isGM,
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
}

console.log("test-party-frame: OK (parts and tabs by seat, the bar, hurt count, rails by mode and seat, reading, Key, heads, templates)");
