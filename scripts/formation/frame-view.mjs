/* global game */
/**
 * The party sheet's frame, decided offline: which parts and tabs a seat gets,
 * what the band's bar reads, every rail cell with its reading and its press,
 * the reading column's overline and chips, the Key legend, and each tab's head.
 * Pure over the formation view (`buildFormationView`) and the few readings the
 * sheet passes in (the members' hit points, the clock, the sheet's own state),
 * so tools/test-party-frame.mjs pins it without a running Foundry;
 * party-actor.mjs binds it to the window.
 *
 * The rails are the same in every mode: the same cells, in the same order,
 * pressing the same way. A mode changes what a figure reads, never which cells
 * there are. A seat changes which presses there are: a press that writes is the
 * Judge's, so a player's copy of such a cell is a reading with no action.
 */
import { SAVE_ICONS } from "../character-sheet/constants.mjs";
import { saveKindOf } from "../lib/actor-compat.mjs";
import { makeLoc } from "../lib/util.mjs";

const LANG_PREFIX = "ACKS-FORMATION.frame";
const loc = makeLoc(LANG_PREFIX);
const DASH = "—";

/** The mode tab's template, by travel mode. The part id is `mode` in all three. */
export const MODE_TEMPLATES = Object.freeze({
  delve: "formation-tab-dungeon.hbs",
  journey: "formation-tab-wilderness.hbs",
  settlement: "formation-tab-city.hbs",
});

/** Every tab the frame can show, in row order; `judge` is a GM seat's only. */
export const TAB_IDS = Object.freeze(["mode", "order", "kit", "sightings", "judge"]);

/** The mode tab's label and its head glyph, by travel mode. */
const MODE_TAB = Object.freeze({
  delve: { label: "ACKS-FORMATION.tab.dungeon", icon: "fa-solid fa-dungeon" },
  journey: { label: "ACKS-FORMATION.tab.wilderness", icon: "fa-solid fa-mountain-sun" },
  settlement: { label: "ACKS-FORMATION.tab.city", icon: "fa-solid fa-city" },
});

/** The order tab's label by travel mode: the same roster, named for where it walks. */
const ORDER_TAB = Object.freeze({
  delve: "ACKS-FORMATION.tab.order",
  journey: "ACKS-FORMATION.tab.train",
  settlement: "ACKS-FORMATION.tab.company",
});

/** A travel mode the frame knows, falling back to the delve's for anything else. */
const modeOf = (mode) => (mode in MODE_TEMPLATES ? mode : "delve");

/** The day being walked: the count of finished days plus one, the number its log row will carry. */
const dayOf = (strip) => (Number(strip?.dayCount) || 0) + 1;

const percent = (n, of) => (of > 0 ? Math.max(0, Math.min(100, Math.round((n / of) * 100))) : 0);

/**
 * The parts a seat renders, in order. With no formation the sheet is the band
 * and the empty-state frame; a player's list never names `judge`, so nothing
 * Judge-only is ever rendered into a player's DOM.
 * @param {{isGM: boolean, hasFormation: boolean}} seat
 * @returns {string[]}
 */
export function framePartIds({ isGM, hasFormation }) {
  if (!hasFormation) return ["band", "frame"];
  return ["band", "frame", "tabs", ...TAB_IDS.filter((id) => id !== "judge" || isGM)];
}

/**
 * The tab row for a mode and a seat: `{id, label, icon?, cssClass?}` in order.
 * The mode tab reads Dungeon, Wilderness or City and the order tab Order, Train
 * or Company; the Judge tab is dashed (`is-judge`) and a GM seat's only.
 * @param {{mode: string, isGM: boolean}} seat
 * @returns {Array<{id: string, label: string, icon?: string, cssClass?: string}>}
 */
export function frameTabs({ mode, isGM }) {
  const m = modeOf(mode);
  const tabs = [
    { id: "mode", label: game.i18n.localize(MODE_TAB[m].label) },
    { id: "order", label: game.i18n.localize(ORDER_TAB[m]) },
    { id: "kit", label: game.i18n.localize("ACKS-FORMATION.tab.kit") },
    { id: "sightings", label: game.i18n.localize("ACKS-FORMATION.tab.sightings") },
  ];
  if (isGM) {
    tabs.push({ id: "judge", label: game.i18n.localize("ACKS-FORMATION.tab.judge"), icon: "fa-solid fa-user-secret", cssClass: "is-judge" });
  }
  return tabs;
}

/**
 * The band's bar, a reading: on a journey the hours walked of the day's budget,
 * gold once the day is spent; in the delve and the city the turns since the
 * last rest of the rest interval, red while the party is winded. A rest
 * interval that was never imported leaves the count with no ceiling and the
 * bar unfilled.
 * @returns {{label: string, title: string, pct: number, full: boolean, bad: boolean}}
 */
export function bandBar(strip) {
  if (strip?.isJourney) {
    const hours = Number(strip.walked?.hours) || 0;
    const budget = Number(strip.budget?.hours) || 0;
    return {
      label: loc("bar.journey", { day: dayOf(strip), hours, budget }),
      title: loc("bar.journeyTitle"),
      pct: percent(hours, budget),
      full: !!strip.spent,
      bad: false,
    };
  }
  const since = Number(strip?.delve?.sinceRest) || 0;
  const max = Number(strip?.delve?.restMax) || 0;
  return {
    label: max > 0 ? loc("bar.rest", { since, max }) : loc("bar.restUnpriced", { since }),
    title: loc("bar.restTitle"),
    pct: percent(since, max),
    full: false,
    bad: !!strip?.delve?.winded,
  };
}

/**
 * How many members are hurt: those whose hit points are below a known maximum.
 * A member with no hit points to read, or no maximum, is not counted.
 * @param {Array<{value: number, max: number|null}|null>} hitPoints  `memberHp` per real member
 * @returns {number}
 */
export function hurtCount(hitPoints) {
  return (hitPoints ?? []).filter((hp) => typeof hp?.value === "number" && Number(hp.max) > 0 && hp.value < hp.max).length;
}

/**
 * One rail cell. Its name and reading make the tooltip; a press, where this
 * seat has one, is named after them. `keyLabel` is the cell's line in the Key.
 */
function railCell({ name, reading, press = null, ...cell }) {
  const said = loc("cell", { name, reading });
  const pressed = cell.action && press;
  return {
    cls: "",
    sub: null,
    ...cell,
    title: pressed ? loc("press", { label: said, press }) : said,
    keyLabel: pressed ? loc("press", { label: name, press }) : name,
  };
}

/** A press that only the Judge's seat carries; a player's cell keeps the reading alone. */
const judgePress = (isGM, action, press) => (isGM ? { action, press } : {});

/** The figures rail: hit points, supplies, mouths, pace and light, on every seat. */
function figureCells(view, { isGM, headcount, hitPoints, clockTime }) {
  const strip = view.strip ?? {};
  const mode = modeOf(strip.mode);

  const hurt = hurtCount(hitPoints);
  const hp = railCell({
    key: "hp",
    icon: "fa-solid fa-heart-pulse",
    name: loc("figure.hp"),
    reading: hurt ? loc("figure.hurt", { n: hurt }) : loc("figure.noneHurt"),
    sub: hurt ? loc("figure.hurt", { n: hurt }) : DASH,
    cls: hurt ? "is-bad" : "",
    ...judgePress(isGM, "adjustHp", loc("presses.hp")),
  });

  const stock = strip.supplies ?? {};
  const supplies = railCell({
    key: "supplies",
    icon: "fa-solid fa-drumstick-bite",
    name: loc("figure.supplies"),
    reading: stock.known ? loc("figure.suppliesReading", { food: stock.foodDays, water: stock.waterDays ?? DASH }) : loc("figure.unknown"),
    sub: stock.known ? loc("figure.days", { n: stock.foodDays }) : DASH,
    cls: stock.short ? "is-bad" : "",
    ...judgePress(isGM, "consumeRations", loc("presses.ration")),
  });

  const mouths = railCell({
    key: "mouths",
    icon: "fa-solid fa-users",
    name: loc("figure.mouths"),
    reading: String(headcount),
    sub: String(headcount),
    action: "goTab",
    tab: "order",
    press: loc("presses.roster"),
  });

  let pace;
  if (mode === "settlement") {
    const city = strip.settlement ?? {};
    const priced = !city.blocksUnpriced && city.rateBlocks != null;
    pace = railCell({
      key: "pace",
      icon: "fa-solid fa-person-walking",
      name: loc("figure.pace"),
      reading: priced ? loc("figure.blocksReading", { n: city.rateBlocks }) : loc("figure.unknown"),
      sub: priced ? loc("figure.blocksSub", { n: city.rateBlocks }) : DASH,
      cls: view.hurried ? "is-warn" : "",
      ...judgePress(isGM, "togglePace", loc("presses.pace")),
    });
  } else {
    const feet = view.hurried ? view.effSpeed : view.speed;
    const journey = mode === "journey";
    pace = railCell({
      key: "pace",
      icon: "fa-solid fa-person-walking",
      name: loc("figure.pace"),
      reading: journey && strip.speed?.partsLine ? strip.speed.partsLine : loc("figure.feetReading", { n: feet ?? 0 }),
      sub: `${feet ?? 0}'`,
      cls: view.hurried ? "is-warn" : "",
      ...(journey
        ? { action: "goTab", tab: "mode", press: loc("presses.movement") }
        : judgePress(isGM, "togglePace", loc("presses.pace"))),
    });
  }

  const light = railCell({ key: "light", icon: "fa-solid fa-fire-flame-curved", name: loc("figure.light"), ...lightReading(view, { mode, clockTime }), action: "goTab", tab: "kit", press: loc("presses.kit") });

  return [hp, supplies, mouths, pace, light];
}

/**
 * What the light cell reads by mode: on a journey the hours to the next dusk
 * or dawn; in the delve the fewest turns left among the lights burning; in the
 * city the hour line the board follows.
 */
function lightReading(view, { mode, clockTime }) {
  const strip = view.strip ?? {};
  if (mode === "journey") {
    const clock = strip.clock ?? {};
    if (clock.hoursToDusk != null) {
      return { reading: game.i18n.format("ACKS-FORMATION.strip.toDusk", { hours: clock.hoursToDusk }), sub: loc("figure.hoursSub", { n: clock.hoursToDusk }) };
    }
    if (clock.hoursToDawn != null) {
      return { reading: game.i18n.format("ACKS-FORMATION.strip.toDawn", { hours: clock.hoursToDawn }), sub: loc("figure.hoursSub", { n: clock.hoursToDawn }) };
    }
    return { reading: clock.time || loc("figure.noClock"), sub: clock.time || DASH };
  }
  if (mode === "delve") {
    const left = (view.lights ?? []).filter((l) => l.lit).map((l) => Number(l.remaining)).filter(Number.isFinite);
    if (!left.length) return { reading: loc("figure.noLight"), sub: DASH };
    const n = Math.min(...left);
    return { reading: loc("figure.turnsReading", { n }), sub: loc("figure.turnsSub", { n }) };
  }
  const line = strip.settlement?.clockLine || clockTime;
  return { reading: line || loc("figure.noClock"), sub: clockTime || DASH };
}

/** The saves rail, a GM seat's only: one cell per save, then the Magical toggle they read. */
function saveCells(view, { isGM, magical }) {
  if (!isGM) return [];
  const saves = (view.saves ?? []).map((save) => ({
    key: `save-${save.key}`,
    action: "partySave",
    save: save.key,
    icon: SAVE_ICONS[saveKindOf(save.key)] ?? "fa-solid fa-shield-halved",
    short: loc(`saveShort.${save.key}`),
    title: save.tooltip,
    keyLabel: save.label,
    cls: "",
  }));
  const state = magical ? loc("magical.on") : loc("magical.off");
  saves.push({
    key: "magical",
    action: "toggleMagical",
    icon: "fa-solid fa-wand-sparkles",
    short: loc("saveShort.magical"),
    title: loc("magical.title", { state }),
    keyLabel: loc("magical.name"),
    toggle: true,
    on: !!magical,
    cls: magical ? "is-on" : "",
  });
  return saves;
}

/**
 * The quick tools, a GM seat's only: the encounter throw, the party checks, a
 * search, the pause and the experience. The same five cells in every mode; the
 * throw and the search press the mode's own action.
 */
function toolCells(view, { isGM }) {
  if (!isGM) return [];
  const journey = modeOf(view.strip?.mode) === "journey";
  const paused = !!view.strip?.paused;
  const tools = [
    { key: "encounter", action: journey ? "travelEncounterThrow" : "encounterNow", icon: "fa-solid fa-dice-d6", title: journey ? loc("tool.encounterJourney") : loc("tool.encounter") },
    { key: "checks", action: "partyChecks", icon: "fa-solid fa-ear-listen", title: loc("tool.checks") },
    journey
      ? { key: "search", action: "searchHour", icon: "fa-solid fa-magnifying-glass", title: loc("tool.searchHour") }
      : { key: "search", action: "partyCheck", check: "searchMethodical", icon: "fa-solid fa-magnifying-glass", title: loc("tool.searchTurn") },
    { key: "pause", action: "togglePause", icon: paused ? "fa-solid fa-play" : "fa-solid fa-pause", title: paused ? loc("tool.resume") : loc("tool.pause"), toggle: true, on: paused, cls: paused ? "is-on" : "" },
    { key: "xp", action: "dealXp", icon: "fa-solid fa-star", title: loc("tool.xp") },
  ];
  return tools.map((t) => ({ cls: "", ...t, keyLabel: t.title }));
}

/** The sheet tools: the Judge's four document tools, then the Key, which every seat has. */
function sheetCells({ isGM, keyOpen, editing }) {
  const tools = isGM
    ? [
        { key: "description", action: "editDescription", icon: "fa-solid fa-pen-to-square", title: loc("sheet.description"), toggle: true, on: !!editing, cls: editing ? "is-on" : "" },
        { key: "image", action: "editPartyImage", icon: "fa-solid fa-image", title: loc("sheet.image") },
        { key: "ownership", action: "ownership", icon: "fa-solid fa-user-lock", title: loc("sheet.ownership") },
        { key: "tweaks", action: "tweaks", icon: "fa-solid fa-sliders", title: loc("sheet.tweaks") },
      ]
    : [];
  tools.push({ key: "key", action: "toggleKey", icon: "fa-solid fa-circle-question", title: loc("sheet.key"), toggle: true, on: !!keyOpen, cls: keyOpen ? "is-on" : "" });
  return tools.map((t) => ({ cls: "", ...t, keyLabel: t.title }));
}

/**
 * The reading column: an overline of what the view knows (the mode, the day
 * and hex on a journey, the clock, the season), then the chips — the
 * territory and what the party follows on a journey, the heads, the pause,
 * and on a GM seat the lost compass. A journey whose party is shown nothing of
 * where it stands (`travel.blank`) names no hex and wears no country chip.
 */
function readingOf(view, { isGM, headcount, clockTime }) {
  const strip = view.strip ?? {};
  const travel = view.travel ?? {};
  const journey = modeOf(strip.mode) === "journey";
  const selected = (options) => (options ?? []).find((o) => o.selected) ?? null;
  const overline = [
    strip.modeLabel,
    journey ? game.i18n.format("ACKS-FORMATION.travel.dayN", { n: dayOf(strip) }) : null,
    journey && strip.hex?.label ? loc("overline.hex", { hex: strip.hex.label }) : null,
    (journey ? strip.clock?.time : "") || clockTime || null,
    journey ? selected(travel.weather?.seasons)?.label : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const chips = [];
  if (journey && !travel.blank) {
    const territory = selected(travel.territories);
    if (territory) chips.push({ key: "territory", label: territory.label });
    const following = selected(travel.followingOptions);
    if (following && following.value !== "none") chips.push({ key: "following", label: following.label });
  }
  chips.push({ key: "heads", label: loc("chip.heads", { n: headcount }) });
  if (strip.paused) chips.push({ key: "paused", label: loc("chip.paused"), cls: "is-gold" });
  if (isGM && journey && travel.lost?.active) {
    chips.push({ key: "astray", label: loc("chip.astray"), icon: "fa-solid fa-compass", cls: "is-judge", title: game.i18n.localize("ACKS-FORMATION.travel.lostHint") });
  }
  return { overline, chips };
}

/** The Key: every rail glyph with its name, grouped as the rails are, and where a mode's own actions live. */
function keyLegend(rails, { isGM }) {
  const rows = (cells) => cells.map((c) => ({ icon: c.icon, short: c.short ?? null, label: c.keyLabel }));
  const groups = [
    isGM ? { key: "saves", title: loc("key.saves"), rows: rows(rails.saves) } : null,
    { key: "figures", title: loc("key.figures"), rows: rows(rails.figures) },
    isGM ? { key: "tools", title: loc("key.tools"), rows: rows(rails.tools) } : null,
    { key: "sheet", title: loc("key.sheet"), rows: rows(rails.sheet) },
  ].filter(Boolean);
  return { title: loc("key.title"), sub: loc("key.sub"), groups, foot: loc("key.foot") };
}

/** The episode state on the Judge tab's head: its line, and whether an episode is open. */
function judgeState(travel) {
  const lost = travel?.lost;
  if (lost?.active) return { state: game.i18n.format("ACKS-FORMATION.lost.astraySince", { days: lost.days, hexes: lost.fakedHexes }), open: true };
  if (lost?.aware) return { state: game.i18n.format("ACKS-FORMATION.lost.awareSince", { days: lost.days }), open: true };
  return { state: loc("judge.closed"), open: false };
}

/** Each tab's head: a glyph, a title that reads the tab's state, and a line under it. */
function headsOf(view, { headcount }) {
  const strip = view.strip ?? {};
  const mode = modeOf(strip.mode);
  const turns = strip.delve?.turns ?? 0;
  const modeHead = {
    journey: { title: loc("head.journey", { day: dayOf(strip) }), sub: loc("head.journeySub") },
    delve: { title: loc("head.delve", { turns, elapsed: strip.delve?.elapsed ?? "" }), sub: loc("head.delveSub") },
    settlement: { title: loc("head.city", { turns }), sub: loc("head.citySub") },
  }[mode];
  return {
    mode: { icon: MODE_TAB[mode].icon, ...modeHead },
    order: { icon: "fa-solid fa-people-line", title: loc("head.order", { heads: headcount, frontage: view.frontage ?? 1 }), sub: loc("head.orderSub") },
    sightings: { icon: "fa-solid fa-binoculars", title: loc("head.sightings"), sub: loc("head.sightingsSub") },
    judge: { icon: "fa-solid fa-user-secret", title: loc("head.judge"), sub: loc("head.judgeSub"), ...judgeState(view.travel) },
  };
}

/**
 * The frame's plate. On a journey whose party token stands on a scene it is
 * the hex the party believes it stands in, drawn (`view.travel.plate`), or the
 * blank of a hex the party is shown nothing of; anywhere else it is the
 * party's image, which the Judge's seat presses to change, with a journey's
 * hex label over it.
 * @returns {{kind: string, draw: boolean, blank: boolean, img: string|null,
 *   hex: string, edit: boolean, differ: boolean, aria: string}} the plate
 *   partial's context, with `drawPlate`'s spec beside it when `draw`
 */
function framePlate(view, { isGM, mode }) {
  const drawn = mode === "journey" ? view?.travel?.plate ?? null : null;
  if (drawn?.draw || drawn?.blank) return { ...drawn, kind: "frame", edit: false, differ: false };
  return {
    kind: "frame",
    draw: false,
    blank: false,
    img: view?.partyImg ?? null,
    hex: mode === "journey" ? view?.strip?.hex?.label || "" : "",
    edit: !!isGM,
    differ: false,
    aria: "",
  };
}

/**
 * The frame's whole context, built once per render.
 * @param {object} input
 * @param {object} input.view            `buildFormationView`'s result
 * @param {boolean} input.isGM
 * @param {number} [input.headcount]     `partyHeadcount`
 * @param {Array<{value: number, max: number|null}|null>} [input.hitPoints]  `memberHp` per real member
 * @param {string} [input.clockTime]     the world clock as HH:MM, or ""
 * @param {boolean} [input.magical]      the saves' Magical toggle
 * @param {boolean} [input.keyOpen]      the Key legend is open
 * @param {boolean} [input.editing]      the description editor is open
 * @param {boolean} [input.panelHidden]  the viewer hid the panel under the tab row
 * @returns {{mode: string, band: object, plate: object, rails: object, reading: object, key: object, heads: object, panel: object}}
 *   `plate` is `framePlate`'s
 */
export function buildFrameView({ view, isGM, headcount = 0, hitPoints = [], clockTime = "", magical = true, keyOpen = false, editing = false, panelHidden = false }) {
  const v = view ?? {};
  const strip = v.strip ?? {};
  const mode = modeOf(strip.mode);
  const rails = {
    saves: saveCells(v, { isGM, magical }),
    figures: figureCells(v, { isGM, headcount, hitPoints, clockTime }),
    tools: toolCells(v, { isGM }),
    sheet: sheetCells({ isGM, keyOpen, editing }),
  };
  return {
    mode,
    band: { modeLabel: strip.modeLabel ?? "", bar: bandBar(strip) },
    plate: framePlate(v, { isGM, mode }),
    rails,
    reading: readingOf(v, { isGM, headcount, clockTime }),
    key: { open: !!keyOpen, ...keyLegend(rails, { isGM }) },
    heads: headsOf(v, { headcount }),
    panel: { hidden: !!panelHidden, label: panelHidden ? loc("chevron.show") : loc("chevron.hide") },
  };
}
