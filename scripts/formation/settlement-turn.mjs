/* global game, foundry, Roll, fromUuid */
/**
 * A city turn, actually taken.
 *
 * [settlement.mjs](./settlement.mjs)'s tick is pure and owns no dice; this
 * rolls them, writes the board, and whispers the Judge what happened.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { cookbookId } from "../lib/library.mjs";
import { clockReading } from "../lib/world-time.mjs";
import { readFormations, patchFormation, realMembers } from "./formation-model.mjs";
import { storedTravelOf, travelOf } from "./travel.mjs";
import {
  advanceSettlementTurn, advanceSettlementDays, citySpec, streetCadence,
  resolveCityCadence, cadenceAttribution, pickIncidentSource, settlementEncounter, readIncident, isNight,
  SETTLEMENT_DOC, SETTLEMENT_LOCATIONS, NAVIGATION_DIE, streetDie, incidentDie,
} from "./settlement.mjs";
import { citeOf } from "../lib/tables.mjs";
import { diceFormula } from "./constants.mjs";
import { findEncounterZone } from "./encounter-zone.mjs";
import { findDistrict } from "./district-zone.mjs";
import { streetUnder, partyPoint } from "./zones.mjs";
import { sceneIncidents } from "../battlemap/scene-setup.mjs";
import { dropIncidentNote } from "./poi.mjs";
import { hunterName, withHunt } from "./hunt.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * One throw of the named die, or a null total when none is owed (the tick reads
 * null as "not asked"). The die is a parameter, never a default: the city turn's
 * two throws are made on different dice (see docs/formation/DECISIONS.md, "A
 * city turn owes two throws, on two dice (2026-09-12)"). A null die (not
 * imported) is no throw either; the caller says so.
 */
async function maybeRoll(owed, formula) {
  if (!owed || !formula) return { total: null, roll: null, die: formula };
  const roll = await new Roll(formula).evaluate();
  return { total: roll.total, roll, die: formula };
}

/**
 * What a Judge has drawn over the street where the party is standing.
 *
 * One read of the canvas, shared by the cadence and the incident table so the
 * two cannot disagree about which zone or district the party is in.
 */
function drawnOver(formation) {
  const zone = findEncounterZone(formation);
  const district = findDistrict(formation);
  return {
    zone: zone?.behavior?.system ?? null,
    zoneName: zone?.region?.name ?? null,
    district: district?.behavior?.system ?? null,
    districtName: district?.region?.name ?? null,
    // The quarter's own document, for the marker an incident leaves.
    districtUuid: district?.region?.uuid ?? null,
    // The outermost layer is the map itself: the city list it names.
    city: sceneIncidents(partyPoint(formation)?.scene ?? null),
  };
}


/**
 * One city turn, marked off because the party MOVED.
 *
 * Called from the turn engine's per-turn bookkeeping, so the city's own
 * business happens in the same tick as a dungeon turn's: the blocks are
 * credited, the way is checked, and the street gets its chance.
 *
 * Writes the next board onto the LIVE record rather than patching the setting:
 * the caller is mid-tick holding the same object and saves it when the tick
 * ends, so a second write from here would be overwritten.
 */
export async function cityTurnCompleted(formation, notes = []) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  if (t.mode !== "settlement") return null;

  // The board, with the hunt asked for the quarter the party now stands in (hunt.mjs).
  const board = withHunt(t.settlement, formation);
  const headcount = realMembers(formation).length || 1;

  // Only roll what the turn will consult: a stationary party's day tick owns both throws.
  // Where the party is: the road drawn under it when there is one, else the picker.
  const { road, here } = streetUnder(formation, board);
  const stationary = !!SETTLEMENT_LOCATIONS[here.where]?.stationary;
  const nav = stationary ? { throws: false } : citySpec({ pace: board.pace, route: board.route });
  const { zone, zoneName, district, districtName, districtUuid, city } = drawnOver(formation);
  // The hour, resolved ONCE for the turn, so the cadence and the incident agree.
  const night = boardNight(board);
  const cadence = stationary
    ? null
    : resolveCityCadence(
      streetCadence({ where: here.where, night, intent: board.intent }),
      { zone, district, night, intent: board.intent },
    );
  const willOweEncounter = !!cadence && ((board.turns + 1) % cadence.everyTurns === 0);

  const navThrow = await maybeRoll(nav.throws && nav.target != null, NAVIGATION_DIE);
  const encThrow = await maybeRoll(willOweEncounter, streetDie());

  const { board: next, events } = advanceSettlementTurn(board, {
    headcount,
    navRoll: navThrow.total,
    encounterRoll: encThrow.total,
    cadence,
  });
  // A throw owed on a die nobody imported is owed and not made: the card says so.
  if (willOweEncounter && encThrow.die == null) {
    events.push({ kind: "unpriced", what: loc("settlement.streetDie") });
  }

  // The road is a SNAPSHOT of what the map said for this turn.
  next.road = road;
  formation.travel = { ...storedTravelOf(formation), settlement: next };

  if (events.some((e) => e.kind === "strayed")) {
    notes.push({ type: "bad", text: loc("settlement.note.strayed") });
  }
  if (events.some((e) => e.kind === "encounterOwed" && e.met)) {
    notes.push({ type: "bad", text: loc("settlement.note.incident") });
  }

  // The card is the last step and the only one that talks to the server: one
  // that cannot be written must not take the turn's bookkeeping down with it.
  try {
    await whisperTurn(next, events, [navThrow.roll, encThrow.roll].filter(Boolean), {
      zoneName, districtName, here, formation, regionUuid: districtUuid, night,
      incident: pickIncidentSource({ district, zone, wanted: board.wanted, city }),
    });
  } catch (err) {
    console.error(`${MODULE_ID} | city turn card failed`, err);
  }
  return { board: next, events };
}

/** Whether this board stands after dark now: its own word, or the world clock's. */
function boardNight(board) {
  return isNight(board, { dark: clockReading()?.dark ?? null });
}

/**
 * Days spent holed up, credited because the WORLD CLOCK moved.
 *
 * Holing up is the one settlement rate with no movement to tick: it is priced
 * by the DAY, each day rolling its own die, and the stay lands as one card.
 * See docs/formation/DECISIONS.md, "A stay is credited in days actually thrown
 * for (2026-09-12)".
 *
 * Patches the setting directly: unlike the turn, nothing else is mid-tick.
 */
export async function runHoledUpDays(formation, days) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  if (t.mode !== "settlement") return null;

  const asked = Math.max(0, Math.floor(Number(days) || 0));
  const n = Math.min(MAX_STAY_DAYS_PER_CREDIT, asked);
  if (!n) return null;
  const board = t.settlement;
  const { zone, zoneName, district, districtName, city } = drawnOver(formation);
  const night = boardNight(board);
  const cadence = resolveCityCadence(
    streetCadence({ where: board.where, night, intent: board.intent }),
    { zone, district, night, intent: board.intent },
  );

  const rolls = [];
  const dice = [];
  const die = streetDie();
  if (cadence && die) {
    for (let d = 0; d < n; d++) {
      const r = await new Roll(die).evaluate();
      rolls.push(r.total);
      dice.push(r);
    }
  }

  const advanced = advanceSettlementDays(board, { days: n, rolls, cadence });
  const next = advanced.board;
  let events = advanced.events;
  if (events.some((e) => e.kind === "notHoledUp")) return null;
  // Days owed a throw never made are not quiet days: the stay says its die is not imported.
  if (cadence && !die) {
    events = [...events.filter((e) => e.kind !== "encounterOwed"), { kind: "unpriced", what: loc("settlement.streetDie") }];
  }

  await patchFormation(formation.id, (record) => {
    const cur = storedTravelOf(record);
    record.travel = { ...cur, settlement: next };
  });

  await whisperStay(next, events, dice, {
    credited: n, asked, cadence, zoneName, districtName, night,
    incident: pickIncidentSource({ district, zone, wanted: board.wanted, city }),
  });
  // `credited` is the contract with the clock watcher: the stamp moves by days thrown for only.
  return { board: next, events, credited: n, asked };
}

/** Seconds in a day, the unit a stay is counted in. */
const DAY_SECONDS = 24 * 60 * 60;

/**
 * How many days of a stay one clock advance credits.
 *
 * A bound on the dice, not on the stay: what is not credited is not forgiven,
 * since the stamp stays behind by the remainder and the next advance charges it.
 */
const MAX_STAY_DAYS_PER_CREDIT = 30;

/**
 * The queue every credit runs in, so two callers answering one clock advance
 * run in turn and the stamp stays the guard (see docs/formation/DECISIONS.md,
 * "A stay is credited once per advance, by the queue and not by the caller
 * (2026-09-15)"). The chain swallows an outcome so a failed credit does not
 * block the next; the promise handed back still rejects for its caller.
 */
let creditChain = Promise.resolve();

function enqueueCredit(fn) {
  const run = creditChain.then(fn, fn);
  creditChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * Credit whatever whole days have passed for every party holed up in a city.
 *
 * The watcher for the settlement rate with no movement to read, driven by the
 * world clock: the stamp moves forward by exactly the days credited and the
 * remainder stays on the clock. Serialised, so awaiting the returned promise is
 * a barrier on the whole credit, whichever caller opened it. A party that has
 * just holed up is stamped and charged nothing.
 */
export function creditHoledUpDays() {
  return enqueueCredit(creditHoledUpDaysNow);
}

/** One pass of the credit, run only from the queue above. */
async function creditHoledUpDaysNow() {
  if (!game.user?.isGM) return;
  const now = Number(game.time?.worldTime) || 0;
  // The read-only blob, not a deep copy; writes go through `patchFormation`.
  for (const formation of Object.values(readFormations())) {
    const t = travelOf(formation);
    if (t.mode !== "settlement") continue;
    const board = t.settlement;
    if (!SETTLEMENT_LOCATIONS[board.where]?.stationary) continue;

    // First sighting: start the stay's clock here.
    if (board.holeUpSince == null) {
      await patchFormation(formation.id, (record) => {
        const cur = storedTravelOf(record);
        record.travel = { ...cur, settlement: { ...cur.settlement, holeUpSince: now } };
      });
      continue;
    }

    const days = Math.floor((now - Number(board.holeUpSince)) / DAY_SECONDS);
    if (days < 1) continue;
    // Only the days actually thrown for move the stamp, never the days asked for.
    const credited = (await runHoledUpDays(formation, days))?.credited ?? 0;
    if (credited < 1) continue;
    await patchFormation(formation.id, (record) => {
      const cur = storedTravelOf(record);
      const since = Number(cur.settlement.holeUpSince) + credited * DAY_SECONDS;
      record.travel = { ...cur, settlement: { ...cur.settlement, holeUpSince: since } };
    });
  }
}

/**
 * The cookbook id of the world's settlement incident table, a RollTable the
 * importer materializes from the Judge's own book. It is matched on this id,
 * never the name, which a Judge may rename.
 */
const INCIDENT_TABLE_ID = "jj.settlementEncounters";

/** The world's imported settlement incident table, world-side or in a pack. */
export async function findCityIncidentTable() {
  const flagged = (t) => cookbookId(t) === INCIDENT_TABLE_ID;

  const world = game.tables?.find(flagged) ?? null;
  if (world) return world;
  for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
    // Per pack: one unreadable compendium must not hide the table in the next.
    try {
      const index = await pack.getIndex({ fields: ["flags"] });
      const hit = [...index].find(flagged);
      if (hit) return await pack.getDocument(hit._id);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not index ${pack.collection}`, err);
    }
  }
  return null;
}

/**
 * A RollTable's rows as the bands the pure reader matches against.
 *
 * Rows whose range is not a pair of numbers are dropped, never defaulted: a
 * band with no edges matches everything or nothing.
 */
export function incidentRowsOf(table) {
  if (!table) return null;
  return [...table.results]
    .map((r) => ({ min: r.range?.[0], max: r.range?.[1], text: r.text ?? r.description ?? "" }))
    .filter((r) => Number.isFinite(r.min) && Number.isFinite(r.max));
}

/**
 * The document a candidate's uuid names, or null when the promise is broken.
 *
 * `fromUuid` answers null for a document that is gone and throws for a
 * compendium the world no longer has; both mean this table cannot answer, and
 * the throw is logged so the walk continues past the dead uuid.
 */
async function incidentTableAt(uuid) {
  if (!uuid) return null;
  try {
    return (await fromUuid(uuid)) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | settlement incident table ${uuid} could not be read`, err);
    return null;
  }
}

/** One plain draw from a table a Judge drew over the street, shaped as an incident. */
async function drawIncident(table, source) {
  const drawn = await table.roll();
  const text = (drawn.results ?? [])
    .map((r) => r.text ?? r.description ?? "")
    .filter(Boolean)
    .join("; ");
  const total = drawn.roll?.total ?? null;
  return {
    roll: total, total, afterDark: 0, entry: text || null, matched: !!text,
    dice: drawn.roll, source, table: table.name,
  };
}

/**
 * One list thrown on its OWN formula and read by range, with what it adds
 * after dark: rows past the die's last face are reached only by that addition,
 * which `table.roll()` never does. `fallback` is the die for a list whose
 * formula does not parse (the imported incident die, null until imported). Null
 * for a list with no ranged rows, or with neither a formula nor a fallback.
 */
async function throwBanded(table, { afterDark = 0, band = null, fallback = null }, night) {
  const rows = incidentRowsOf(table);
  if (!rows?.length) return null;
  const formula = table.formula && (Roll.validate?.(table.formula) ?? true) ? table.formula : fallback;
  if (!formula) return null;
  const roll = await new Roll(formula).evaluate();
  const read = readIncident(roll.total, { night, afterDark, rows, band });
  return read ? { ...read, dice: roll, table: table.name } : null;
}

/**
 * The map's own city list, read by band (`throwBanded`).
 *
 * When the total falls in the stretch that defers to the quarter and the
 * quarter has a readable special list, that list is thrown the same way with
 * its OWN after-dark figure and answers instead, carrying the city throw as
 * `via`. A band with nothing to hand over to leaves the city row standing,
 * marked `specialMissing` when the quarter names a list that is gone or has no
 * ranged rows. Null for a table with no ranged rows, which sends the walk on.
 */
async function readMapIncident(
  table,
  { source, afterDark = 0, band = null, specialTableUuid = null, specialAfterDark = 0 },
  night,
) {
  const read = await throwBanded(table, { afterDark, band, fallback: incidentDie() }, night);
  if (!read) return null;
  const found = { ...read, source };
  if (!read.special || !specialTableUuid) return found;
  const special = await incidentTableAt(specialTableUuid);
  const answer = special ? await throwBanded(special, { afterDark: specialAfterDark }, night) : null;
  return answer ? { ...answer, source: "special", via: found } : { ...found, specialMissing: true };
}

/**
 * Roll one settlement incident, and say which table answered.
 *
 * Three procedures: the world's own imported table is read by banded rows with
 * the registry's after-dark shift; a city list the MAP names is read the same
 * way with the map's own shift, and may hand its roll to the quarter's special
 * list (`readMapIncident`); a table a Judge drew over the street is an ordinary
 * RollTable drawn on its own formula.
 *
 * `candidates` is `pickIncidentSource`'s whole order, innermost first, walked
 * to the first table that EXISTS, ending at the world's own table. `source` is
 * taken from the candidate that answered. Null when nothing in the order
 * supplied a row.
 *
 * @param {object} [opts]
 * @param {Array<{tableUuid: string|null, source: string, banded?: boolean}>} [opts.candidates]
 *   the order to walk; a bare `tableUuid`/`source` pair stands in for a
 *   one-entry order when it is absent.
 * @param {string[]} [opts.passed] collects the `source` of every NAMED list the
 *   walk could not read, whatever the walk then answers, so the card can say
 *   a list was passed over.
 * @returns {Promise<object|null>} the incident; `via` is the city throw that
 *   handed over, on an answer from a quarter's special list.
 */
export async function rollSettlementIncident({
  night = false, tableUuid = null, source = "city", candidates = null, passed = [],
} = {}) {
  const order = candidates?.length ? candidates : [{ tableUuid, source }];
  for (const candidate of order) {
    if (!candidate.tableUuid) continue;
    const table = await incidentTableAt(candidate.tableUuid);
    if (!table) {
      passed.push(candidate.source);
      continue;
    }
    if (!candidate.banded) return drawIncident(table, candidate.source);
    const found = await readMapIncident(table, candidate, night);
    if (found) {
      if (found.specialMissing) passed.push("special");
      return found;
    }
    passed.push(candidate.source);
  }
  const world = await findCityIncidentTable();
  const rows = incidentRowsOf(world);
  // The table's own formula, else the imported incident die; with neither, nothing is thrown.
  const formula = diceFormula(world?.formula) ?? incidentDie();
  if (!formula) return null;
  const roll = await new Roll(formula).evaluate();
  const found = settlementEncounter(roll.total, { night, rows });
  return found ? { ...found, roll: roll.total, dice: roll, source: "city", table: world?.name ?? null } : null;
}

/**
 * A stay as one card: how long it lasted, which days were interrupted, and what
 * found them on each. `incident` is `pickIncidentSource`'s answer; every day of
 * a stay is drawn at the one hour `night` names.
 */
async function whisperStay(board, events, rolls, {
  credited = null, asked = null, cadence = null, zoneName = null, districtName = null,
  incident: pick = null, night = false,
} = {}) {
  const owed = events.filter((e) => e.kind === "encounterOwed");
  const met = owed.filter((e) => e.met);
  const lines = [loc("settlement.card.holedUp", { days: board.days })];

  // One attribution line for the whole stay: every day answered to one cadence.
  const said = cadenceAttribution(cadence, {
    street: loc("settlement.cadenceStreet"),
    zone: zoneName,
    district: districtName,
  });
  if (said) lines.push(game.i18n.format(said.key, said.data));

  // The calendar has run further ahead than this credit reaches.
  if (asked != null && credited != null && asked > credited) {
    lines.push(loc("settlement.card.stillCatchingUp", { credited, left: asked - credited }));
  }

  // A stay with a figure nobody imported has no tally to give.
  if (!events.some((e) => e.kind === "unpriced")) {
    if (met.length) {
      lines.push(loc("settlement.card.interrupted", {
        count: met.length, days: met.map((e) => e.day).join(", "),
      }));
    } else if (owed.length) {
      lines.push(loc("settlement.card.undisturbed", { throws: owed.length }));
    }
  }

  // Each met day draws through the street turn's own order; no marker is left on the map.
  for (const event of met) {
    const { lines: drawn } = await drawIncidentLines(pick, { night, board, rolls });
    lines.push(loc("settlement.card.stayDay", { day: event.day })
      + `<ul>${drawn.map((l) => `<li>${l}</li>`).join("")}</ul>`);
  }

  await postToJudges({
    speaker: { alias: loc("settlement.card.speaker") },
    content: `<div class="acks-extras-settlement-card"><h3>${loc("settlement.card.stayTitle")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    rolls,
  });
}

/**
 * The incident's own line: the list that answered, when it has a name, and the
 * shifted total only when a shift was applied.
 */
function incidentLine(incident, text) {
  const data = { roll: incident.roll, total: incident.total, text, table: incident.table };
  if (!incident.table) return loc(incident.afterDark ? "settlement.card.incident" : "settlement.card.incidentPlain", data);
  return loc(incident.afterDark ? "settlement.card.incidentBanded" : "settlement.card.incidentDrawn", data);
}

/**
 * The street's die as a card prints it, its tooltip saying where the figure
 * came from: the imported page, or a Judge's override.
 */
const streetDieTip = (die) => {
  const cite = citeOf(SETTLEMENT_DOC, "dice");
  const from = cite ? loc("chat.cadenceFrom.import", { cite }) : loc("chat.cadenceFrom.override");
  return `<span data-tooltip-text="${foundry.utils.escapeHTML(from)}">${foundry.utils.escapeHTML(die)}</span>`;
};

/** The marker's line on the card: that one was left, and the button that makes it a place. */
const markerLine = (note) =>
  `${loc("settlement.card.marker")} <button type="button" class="acks-extras-poi-promote" `
  + `data-note-uuid="${foundry.utils.escapeHTML(note.uuid)}">${loc("settlement.card.promote")}</button>`;

/**
 * One incident drawn through `pick`'s whole candidate order, as the lines a
 * card prints for it: the hunted line, every named list the walk could not
 * read, the city throw that handed over to a quarter's special list, and the
 * incident itself, or the missing-table line when nothing answered. Shared by
 * the turn card and the stay card.
 *
 * Every die thrown is pushed onto `rolls`. The lookup reaches every RollTable
 * compendium, so it is guarded: a card that cannot name the incident must not
 * take the caller's bookkeeping down with it.
 *
 * @param {object|null} pick `pickIncidentSource`'s answer
 * @param {object} opts
 * @param {boolean} opts.night whether the draw is made after dark
 * @param {object} opts.board names the faction behind a hunted draw
 * @param {object[]} opts.rolls collects the dice thrown
 * @returns {Promise<{incident: object|null, lines: string[]}>} the incident as
 *   `rollSettlementIncident` returns it, and the card's lines for it
 */
async function drawIncidentLines(pick, { night, board, rolls }) {
  let incident = null;
  // Every named list the walk could not read, said on the card whatever then answered.
  const passed = [];
  try {
    incident = await rollSettlementIncident({ night, ...(pick ?? {}), passed });
  } catch (err) {
    console.error(`${MODULE_ID} | settlement incident lookup failed`, err);
  }
  const lines = [];
  for (const source of passed) {
    lines.push(source === "special"
      ? loc("settlement.lists.specialMissing")
      : loc("settlement.lists.missing", { list: loc(`settlement.lists.source.${source}`) }));
  }
  if (!incident) {
    lines.push(loc("settlement.card.noIncidentTable"));
    return { incident, lines };
  }
  if (incident.source === "wanted") {
    // Keyed on the answer, not the ask: a hunted list that is gone falls to the
    // next list. It leads the lines; named after the faction whose ledger set the flag.
    const hunter = hunterName(board);
    lines.unshift(hunter
      ? loc("settlement.card.wantedBy", { name: hunter })
      : loc("settlement.card.wanted"));
  }
  // A special list answered because the city throw sent it there: say that throw first.
  if (incident.via) {
    rolls.push(incident.via.dice);
    lines.push(loc("settlement.card.incidentDeferred", {
      roll: incident.via.roll, total: incident.via.total, table: incident.via.table,
    }));
  }
  rolls.push(incident.dice);
  const text = incident.entry ?? loc("settlement.card.incidentUnmatched");
  // The after-dark shift belongs to a list read by band; a drawn table's line claims none.
  lines.push(incidentLine(incident, text));
  return { incident, lines };
}

/** The turn as one Judge-side card. Silent when nothing happened worth saying. */
async function whisperTurn(
  board, events, rolls,
  {
    zoneName = null, districtName = null, here = null, incident: pick = null, formation = null, regionUuid = null,
    night = false,
  } = {},
) {
  const lines = [];
  lines.push(loc("settlement.card.moved", { blocks: board.blocks, turns: board.turns }));

  // Which street the turn was resolved on, and that the MAP said so.
  if (here?.from === "road" && board.road) {
    const where = loc(`settlement.street.${here.where}`);
    lines.push(board.road.name
      ? loc("settlement.card.onRoad", { road: board.road.name, where })
      : loc("settlement.card.onRoadUnnamed", { where }));
  }
  if (board.measuredAlong === false && board.road) {
    lines.push(loc("settlement.card.measuredStraight"));
  }

  const strayed = events.find((e) => e.kind === "strayed");
  if (strayed?.blocks) lines.push(loc("settlement.card.strayed", { dice: strayed.blocks }));
  const owed = events.find((e) => e.kind === "encounterOwed");
  if (owed) {
    // Attribution is per FIGURE, through the reader the panel also uses: the
    // interval and the target can come from different layers.
    const said = cadenceAttribution(owed, {
      street: loc("settlement.cadenceStreet"),
      zone: zoneName,
      district: districtName,
    });
    if (said) lines.push(game.i18n.format(said.key, said.data));
    lines.push(owed.met === undefined
      ? loc("settlement.card.owed", { target: owed.target })
      : loc(owed.met ? "settlement.card.met" : "settlement.card.quiet",
        { rolled: owed.rolled, target: owed.target, die: streetDieTip(streetDie()) }));
    if (owed.met) {
      const { incident, lines: drawn } = await drawIncidentLines(pick, { night, board, rolls });
      lines.push(...drawn);
      // A Judge-only marker the clock takes away, with the one button that
      // makes it permanent; a marker that cannot be written must not take the card down.
      if (incident?.entry && formation) {
        const note = await dropIncidentNote(
          formation,
          { text: incident.entry, source: incident.source, table: incident.table },
          { regionUuid },
        ).catch((err) => {
          console.error(`${MODULE_ID} | incident marker failed`, err);
          return null;
        });
        if (note) lines.push(markerLine(note));
      }
    }
  }

  await postToJudges({
    speaker: { alias: loc("settlement.card.speaker") },
    content: `<div class="acks-extras-settlement-card"><h3>${loc("settlement.card.title")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    rolls: rolls.filter(Boolean),
  });
}
