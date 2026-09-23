/* global game, foundry, Roll, fromUuid */
/**
 * A city turn, actually taken.
 *
 * [settlement.mjs](./settlement.mjs)'s tick is pure and owns no dice; this
 * rolls them, writes the board, and whispers the Judge what happened. The
 * split is the same one the rest of the feature keeps: arithmetic that can be
 * tested without a world, and a thin caller that cannot.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { cookbookId } from "../lib/library.mjs";
import { readFormations, patchFormation, realMembers } from "./formation-model.mjs";
import { travelOf } from "./travel.mjs";
import {
  advanceSettlementTurn, advanceSettlementDays, citySpec, streetCadence,
  resolveCityCadence, cadenceAttribution, pickIncidentSource, settlementEncounter, readIncident,
  SETTLEMENT_LOCATIONS, NAVIGATION_DIE, STREET_DIE, INCIDENT_DIE,
} from "./settlement.mjs";
import { findEncounterZone } from "./encounter-zone.mjs";
import { findDistrict } from "./district-zone.mjs";
import { streetUnder, partyPoint } from "./zones.mjs";
import { sceneIncidents } from "../battlemap/scene-setup.mjs";
import { dropIncidentNote } from "./poi.mjs";
import { hunterName, withHunt } from "./hunt.mjs";

const loc = makeLoc("ACKS-FORMATION");

/**
 * One throw of the named die, or null when none is owed — the tick reads null
 * as "not asked". The die is a parameter and never a default: the two throws a
 * city turn can owe are made on different dice against differently scaled
 * targets, and a shared default is how they come to be made on the same one.
 */
async function maybeRoll(owed, formula) {
  if (!owed) return { total: null, roll: null, die: formula };
  const roll = await new Roll(formula).evaluate();
  return { total: roll.total, roll, die: formula };
}

/**
 * What a Judge has drawn over the street where the party is standing.
 *
 * One read of the canvas, shared by the cadence and the incident table: they
 * are separate questions of the same region, and asking twice invites the two
 * to disagree about which zone — or district — the party is in.
 */
function drawnOver(formation) {
  const zone = findEncounterZone(formation);
  const district = findDistrict(formation);
  return {
    zone: zone?.behavior?.system ?? null,
    zoneName: zone?.region?.name ?? null,
    district: district?.behavior?.system ?? null,
    districtName: district?.region?.name ?? null,
    // The quarter's own document, for the marker an incident leaves: a place
    // promoted from one nests inside the quarter's place when it has one.
    districtUuid: district?.region?.uuid ?? null,
    // The outermost layer is the map itself: the city list it names, which the
    // drawn lists are picked ahead of and the world's own behind.
    city: sceneIncidents(partyPoint(formation)?.scene ?? null),
  };
}


/**
 * One city turn, marked off because the party MOVED.
 *
 * Called from the turn engine's per-turn bookkeeping, so a turn in a city
 * costs everything a turn in a dungeon costs — the torch, the spell, the rest
 * — and the city's own business happens in the same tick: the blocks are
 * credited, the way is checked, and the street gets its chance.
 *
 * Writes the next board onto the LIVE record rather than patching the setting.
 * The caller is mid-tick holding the same object and saves it when the tick
 * ends; a second write from here would be overwritten by that save, which is
 * how a city turn would silently lose its blocks.
 */
export async function cityTurnCompleted(formation, notes = []) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  if (t.mode !== "settlement") return null;

  // The board, with the hunt asked for the quarter the party now stands in: a
  // faction that wants them and holds this district marks them hunted here
  // (hunt.mjs), so the district's hunted list answers this turn.
  const board = withHunt(t.settlement, formation);
  const headcount = realMembers(formation).length || 1;

  // Only roll what the turn will actually consult. A party staying put neither
  // navigates nor is thrown for by the turn — its day tick owns both.
  // Where the party is, for the street's purposes: the road under it when one
  // is drawn there, the picker otherwise. The DRAWN answer wins, so a Judge who
  // laid an alley does not also have to remember to say so on the panel.
  const { road, here } = streetUnder(formation, board);
  const stationary = !!SETTLEMENT_LOCATIONS[here.where]?.stationary;
  const nav = stationary ? { throws: false } : citySpec({ pace: board.pace, route: board.route });
  const { zone, zoneName, district, districtName, districtUuid, city } = drawnOver(formation);
  const cadence = stationary
    ? null
    : resolveCityCadence(
      streetCadence({ where: here.where, night: board.night, intent: board.intent }),
      { zone, district, night: board.night, intent: board.intent },
    );
  const willOweEncounter = !!cadence && ((board.turns + 1) % cadence.everyTurns === 0);

  const navThrow = await maybeRoll(nav.throws && nav.target != null, NAVIGATION_DIE);
  const encThrow = await maybeRoll(willOweEncounter, STREET_DIE);

  const { board: next, events } = advanceSettlementTurn(board, {
    headcount,
    navRoll: navThrow.total,
    encounterRoll: encThrow.total,
    cadence,
  });

  // The road is a SNAPSHOT of what the map said for this turn, so the card and
  // the panel report the street the turn was actually resolved on.
  next.road = road;
  formation.travel = { ...t, settlement: next };

  // The turn card is what the Judge is already reading; the two things a city
  // turn can do that a dungeon turn cannot belong on it.
  if (events.some((e) => e.kind === "strayed")) {
    notes.push({ type: "bad", text: loc("settlement.note.strayed") });
  }
  if (events.some((e) => e.kind === "encounterOwed" && e.met)) {
    notes.push({ type: "bad", text: loc("settlement.note.incident") });
  }

  // The card is the LAST thing a city turn does, and it is the only part of it
  // that talks to the server. The turn is already resolved onto the record the
  // caller is holding: a card that cannot be written must not take the blocks,
  // the throw and every other feature's bookkeeping down with it.
  try {
    await whisperTurn(next, events, [navThrow.roll, encThrow.roll].filter(Boolean), {
      zoneName, districtName, here, formation, regionUuid: districtUuid,
      incident: pickIncidentSource({ district, zone, wanted: board.wanted, city }),
    });
  } catch (err) {
    console.error(`${MODULE_ID} | city turn card failed`, err);
  }
  return { board: next, events };
}

/**
 * Days spent holed up, credited because the WORLD CLOCK moved.
 *
 * Holing up is the one settlement rate the party's own motion cannot report:
 * the party is deliberately not going anywhere, so there is no movement to
 * tick and the calendar is the only thing that changes. Priced by the DAY —
 * a week of study is seven throws, not a thousand ten-minute ticks that happen
 * to owe seven of them — so each day rolls its own die and the stay lands as
 * one card.
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
  const { zone, zoneName, district, districtName } = drawnOver(formation);
  const cadence = resolveCityCadence(
    streetCadence({ where: board.where, night: board.night, intent: board.intent }),
    { zone, district, night: board.night, intent: board.intent },
  );

  const rolls = [];
  const dice = [];
  if (cadence) {
    for (let d = 0; d < n; d++) {
      const r = await new Roll(STREET_DIE).evaluate();
      rolls.push(r.total);
      dice.push(r);
    }
  }

  const { board: next, events } = advanceSettlementDays(board, { days: n, rolls, cadence });
  if (events.some((e) => e.kind === "notHoledUp")) return null;

  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, settlement: next };
  });

  await whisperStay(next, events, dice, {
    credited: n, asked, cadence, zoneName, districtName,
  });
  // `credited` is the contract with the clock watcher: the stamp may only move
  // forward by days that were actually thrown for.
  return { board: next, events, credited: n, asked };
}

/** Seconds in a day, the unit a stay is counted in. */
const DAY_SECONDS = 24 * 60 * 60;

/**
 * How many days of a stay one clock advance credits.
 *
 * A bound on the dice, not on the stay: a Judge who drags the calendar a year
 * forward means a year to pass, not a year of throws in one frame. What is not
 * credited is not forgiven — the stamp stays behind by the remainder, so the
 * next advance charges the next stretch and the debt drains.
 */
const MAX_STAY_DAYS_PER_CREDIT = 30;

/**
 * The queue every credit runs in.
 *
 * One clock advance reaches the credit twice — the hook watcher answers it, and
 * the turn engine awaits it as well before re-reading the board — and a second
 * pass reading the board while the first is still between its dice and its
 * stamp prices the same stretch again. Running them in turn is what makes the
 * stamp the guard it is written as.
 *
 * The same shape the ledger's own writer keeps (`formation-model.mjs`): the
 * chain swallows an outcome so a failed credit does not block the next, while
 * the promise handed back still rejects for the caller that asked for it.
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
 * The watcher for the one settlement rate that has no movement to read. It is
 * driven by the world clock rather than by a button, so a stay advanced by
 * anything — a rest, a downtime week, the Judge nudging the calendar — is
 * priced the same way, and a party cannot be charged twice for the same day:
 * the stamp moves forward by exactly the days credited, and the remainder
 * stays on the clock.
 *
 * Serialised, so two callers answering ONE advance charge it once: the second
 * starts after the first has moved the stamp, reads the stamp it left, finds no
 * whole day outstanding and writes nothing. Awaiting the returned promise is
 * therefore a barrier on the whole credit, whichever caller opened it.
 *
 * A party that has just holed up is stamped and charged nothing; the first day
 * begins now, not at whatever the calendar said when the world was made.
 */
export function creditHoledUpDays() {
  return enqueueCredit(creditHoledUpDaysNow);
}

/** One pass of the credit, run only from the queue above. */
async function creditHoledUpDaysNow() {
  if (!game.user?.isGM) return;
  const now = Number(game.time?.worldTime) || 0;
  // The read-only blob, not a deep copy: this runs on every clock advance and
  // asks two fields of each record. The writes go through `patchFormation`.
  for (const formation of Object.values(readFormations())) {
    const t = travelOf(formation);
    if (t.mode !== "settlement") continue;
    const board = t.settlement;
    if (!SETTLEMENT_LOCATIONS[board.where]?.stationary) continue;

    // First sighting: start the clock here rather than at the epoch.
    if (board.holeUpSince == null) {
      await patchFormation(formation.id, (record) => {
        const cur = travelOf(record);
        record.travel = { ...cur, settlement: { ...cur.settlement, holeUpSince: now } };
      });
      continue;
    }

    const days = Math.floor((now - Number(board.holeUpSince)) / DAY_SECONDS);
    if (days < 1) continue;
    // Only the days that were actually thrown for may move the stamp. Moving
    // it by what was ASKED for retires days nothing ever rolled a die against,
    // and the loss is invisible: the calendar and the board simply disagree.
    const credited = (await runHoledUpDays(formation, days))?.credited ?? 0;
    if (credited < 1) continue;
    await patchFormation(formation.id, (record) => {
      const cur = travelOf(record);
      const since = Number(cur.settlement.holeUpSince) + credited * DAY_SECONDS;
      record.travel = { ...cur, settlement: { ...cur.settlement, holeUpSince: since } };
    });
  }
}

/**
 * The world's settlement incident table, whichever way the Judge has it.
 *
 * The list of written incidents is CONTENT, and it reaches a world one of two
 * ways: the importer materializes it as a Foundry RollTable from the Judge's
 * own book, or a Judge authors it into the ruledata registry by hand. The
 * procedure is the same either way — one roll, the after-dark shift, the band
 * it lands in — so the rows are found here and handed to the pure reader.
 *
 * The RollTable is matched on the importer's own cookbook id rather than its
 * name, because a Judge may rename it and a translated world will.
 */
const INCIDENT_TABLE_ID = "jj.settlementEncounters";

/** The world's imported settlement incident table, world-side or in a pack. */
export async function findCityIncidentTable() {
  const flagged = (t) => cookbookId(t) === INCIDENT_TABLE_ID;

  const world = game.tables?.find(flagged) ?? null;
  if (world) return world;
  for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
    // Per pack, because one unreadable compendium — a module mid-update, a
    // pack whose system no longer loads — must not hide the table sitting in
    // the next one.
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
 * Rows whose range is not a pair of numbers are dropped rather than defaulted:
 * a band with no edges matches everything or nothing depending on which way
 * the comparison falls, and either is worse than the row not being there.
 */
export function incidentRowsOf(table) {
  if (!table) return null;
  return [...table.results]
    .map((r) => ({ min: r.range?.[0], max: r.range?.[1], text: r.text ?? r.description ?? "" }))
    .filter((r) => Number.isFinite(r.min) && Number.isFinite(r.max));
}

/** The city's own incident rows. Kept as one call because the api exports it. */
export async function findIncidentRows() {
  return incidentRowsOf(await findCityIncidentTable());
}

/**
 * The document a candidate's uuid names, or null when the promise is broken.
 *
 * A uuid promises a document exists, and the promise breaks two ways: `fromUuid`
 * answers null for one that is gone and throws for a compendium the world no
 * longer has. Both say the same thing to the walk below — this table cannot
 * answer — so both are answered the same way, and the throw is logged rather
 * than ending the walk at whichever layer happened to hold the dead uuid.
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
 * The map's own city list, read by band.
 *
 * Thrown on the table's OWN formula and read by range rather than drawn: the
 * shift after dark reaches rows past the die's last face, which `table.roll()`
 * can never land on. When the total falls in the stretch that defers to the
 * quarter and the quarter has a special list that exists, that list is drawn
 * and answers instead, carrying the city throw as `via` so the card can show
 * both. A band with nothing to hand over to leaves the city row's own words
 * standing. Null for a table with no ranged rows, which sends the walk on.
 */
async function readMapIncident(table, { source, afterDark = 0, band = null, specialTableUuid = null }, night) {
  const rows = incidentRowsOf(table);
  if (!rows?.length) return null;
  const formula = table.formula && (Roll.validate?.(table.formula) ?? true) ? table.formula : INCIDENT_DIE;
  const roll = await new Roll(formula).evaluate();
  const read = readIncident(roll.total, { night, afterDark, rows, band });
  if (!read) return null;
  const found = { ...read, dice: roll, source, table: table.name };
  if (!read.special) return found;
  const special = await incidentTableAt(specialTableUuid);
  if (!special) return found;
  return { ...(await drawIncident(special, "special")), via: found };
}

/**
 * Roll one settlement incident, and say which table answered.
 *
 * THREE procedures, because three kinds of table arrive here. The world's own
 * imported table is a d100 of banded rows and carries an after-dark shift the
 * registry prices, so it is read the way the book reads it. A city list the
 * MAP names is read the same way with the map's own shift, and may hand its
 * roll to the quarter's special list (`readMapIncident`). A table a Judge drew
 * over the street is an ordinary RollTable with a formula of its own, and is
 * drawn the way the delve clock already draws a zone's table — its bands are
 * its own business, and a d100 forced onto a 1d6 table would miss every row.
 *
 * `candidates` is `pickIncidentSource`'s whole order, innermost first, and is
 * walked to the first table that EXISTS. Trying only the innermost made one
 * broken uuid skip every table inside it: a quarter whose hunted list had been
 * deleted was answered by the city's generic d100 with its own ordinary list
 * never asked. `source` is taken from the candidate that answered, so the
 * card's hunted line and its "drawn from" line name the table actually rolled.
 * The order always ends at the world's own table, which is what terminates the
 * walk.
 *
 * Null when nothing in the order — the world's own table included — supplied a
 * row.
 *
 * @param {object} [opts]
 * @param {Array<{tableUuid: string|null, source: string, banded?: boolean}>} [opts.candidates]
 *   the order to walk; a bare `tableUuid`/`source` pair stands in for a
 *   one-entry order when it is absent.
 * @returns {Promise<object|null>} the incident; `via` is the city throw that
 *   handed over, on an answer from a quarter's special list.
 */
export async function rollSettlementIncident({
  night = false, tableUuid = null, source = "city", candidates = null,
} = {}) {
  const order = candidates?.length ? candidates : [{ tableUuid, source }];
  for (const candidate of order) {
    const table = await incidentTableAt(candidate.tableUuid);
    if (!table) continue;
    if (!candidate.banded) return drawIncident(table, candidate.source);
    const found = await readMapIncident(table, candidate, night);
    if (found) return found;
  }
  const rows = incidentRowsOf(await findCityIncidentTable());
  const roll = await new Roll(INCIDENT_DIE).evaluate();
  const found = settlementEncounter(roll.total, { night, rows });
  return found ? { ...found, roll: roll.total, dice: roll, source: "city" } : null;
}

/** A stay as one card: how long it lasted, and which days were interrupted. */
async function whisperStay(board, events, rolls, {
  credited = null, asked = null, cadence = null, zoneName = null, districtName = null,
} = {}) {
  const owed = events.filter((e) => e.kind === "encounterOwed");
  const met = owed.filter((e) => e.met);
  const lines = [loc("settlement.card.holedUp", { days: board.days })];

  // A stay thrown for at a rhythm the Judge drew, rather than the street's own,
  // is said here for the reason the turn card says it: a day count that cannot
  // be reproduced from the street's figures reads as the clock miscounting. One
  // line for the whole stay, because every day of it answered to one cadence.
  const said = cadenceAttribution(cadence, {
    street: loc("settlement.cadenceStreet"),
    zone: zoneName,
    district: districtName,
  });
  if (said) lines.push(game.i18n.format(said.key, said.data));

  // The calendar has run further ahead than this credit reaches. Saying so is
  // the difference between a stay still catching up and a stay that has lost
  // the difference, and only the card can tell the Judge which this is.
  if (asked != null && credited != null && asked > credited) {
    lines.push(loc("settlement.card.stillCatchingUp", { credited, left: asked - credited }));
  }

  const gap = events.find((e) => e.kind === "unpriced");
  if (gap) {
    lines.push(loc("settlement.card.unpriced", { what: gap.what }));
  } else if (met.length) {
    lines.push(loc("settlement.card.interrupted", {
      count: met.length, days: met.map((e) => e.day).join(", "),
    }));
  } else if (owed.length) {
    lines.push(loc("settlement.card.undisturbed", { throws: owed.length }));
  }

  await postToJudges({
    speaker: { alias: loc("settlement.card.speaker") },
    content: `<div class="acks-extras-settlement-card"><h3>${loc("settlement.card.stayTitle")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    rolls,
  });
}

/**
 * The incident's own line, by how its list was read: the world's d100 names no
 * table, the map's list names itself and its shifted total, a drawn table
 * names itself and nothing else.
 */
function incidentLine(incident, text) {
  if (incident.source === "city") return loc("settlement.card.incident", { roll: incident.roll, total: incident.total, text });
  if (incident.source === "map" && incident.afterDark) {
    return loc("settlement.card.incidentBanded", { roll: incident.roll, total: incident.total, text, table: incident.table });
  }
  return loc("settlement.card.incidentDrawn", { roll: incident.roll, text, table: incident.table });
}

/** The marker's line on the card: that one was left, and the button that makes it a place. */
const markerLine = (note) =>
  `${loc("settlement.card.marker")} <button type="button" class="acks-extras-poi-promote" `
  + `data-note-uuid="${foundry.utils.escapeHTML(note.uuid)}">${loc("settlement.card.promote")}</button>`;

/** The turn as one Judge-side card. Silent when nothing happened worth saying. */
async function whisperTurn(
  board, events, rolls,
  { zoneName = null, districtName = null, here = null, incident: pick = null, formation = null, regionUuid = null } = {},
) {
  const lines = [];
  lines.push(loc("settlement.card.moved", { blocks: board.blocks, turns: board.turns }));

  // Which street the turn was resolved on, and that the MAP said so. A cadence
  // read off a drawn alley while the panel still says avenue looks like the
  // tick ignoring the panel unless the card names its source.
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
  if (strayed) {
    lines.push(loc(strayed.blocks ? "settlement.card.strayed" : "settlement.card.strayedUnpriced",
      { dice: strayed.blocks ?? "" }));
  }
  const owed = events.find((e) => e.kind === "encounterOwed");
  if (owed) {
    // A cadence that is not the street's is a thing the Judge drew, and a card
    // that changed rhythm without saying so reads as the tick miscounting. The
    // place named is whichever layer actually answered — naming the zone when
    // the district set the rhythm would misattribute it.
    // Attribution is per FIGURE, through the reader the panel also uses: the
    // interval and the target can come from different layers, and one name over
    // both prints one layer's number under the other layer's name.
    const said = cadenceAttribution(owed, {
      street: loc("settlement.cadenceStreet"),
      zone: zoneName,
      district: districtName,
    });
    if (said) lines.push(game.i18n.format(said.key, said.data));
    lines.push(owed.met === undefined
      ? loc("settlement.card.owed", { target: owed.target })
      : loc(owed.met ? "settlement.card.met" : "settlement.card.quiet",
        { rolled: owed.rolled, target: owed.target, die: STREET_DIE }));
    // A party that WANTS trouble and has no imported figure for it is told,
    // rather than quietly throwing at the ordinary target. The tick flags it;
    // this is the only surface that can say so.
    if (owed.unpricedIntent) lines.push(loc("settlement.card.unpricedIntent"));
    // The street answering is only half of it: what actually happened is the
    // incident table's to say, and the Judge should not have to go and roll it.
    // The lookup reaches every RollTable compendium in the world, so it is
    // guarded here: a card that cannot name the incident must not take the
    // turn's bookkeeping down with it.
    if (owed.met) {
      // Where the hunted line goes if the hunted table is the one that ANSWERS.
      // Keyed on the answer and not on the ask: a `wantedTableUuid` pointing at
      // a table that is gone falls to the next list in the order, and a line
      // promising the hunted list above another list's entry asserts something
      // untrue. The index is taken first so the reason still reads before the
      // outcome.
      const beforeIncident = lines.length;
      let incident = null;
      try {
        incident = await rollSettlementIncident({ night: board.night, ...(pick ?? {}) });
      } catch (err) {
        console.error(`${MODULE_ID} | settlement incident lookup failed`, err);
      }
      if (incident) {
        if (incident.source === "wanted") {
          // Named after the faction whose ledger set the flag, when one did;
          // a Judge's own tick has nobody to name.
          const hunter = hunterName(board);
          lines.splice(beforeIncident, 0, hunter
            ? loc("settlement.card.wantedBy", { name: hunter })
            : loc("settlement.card.wanted"));
        }
        // A quarter's special list answered because the city throw sent it
        // there: that throw is said first, so the second die has a reason.
        if (incident.via) {
          rolls.push(incident.via.dice);
          lines.push(loc("settlement.card.incidentDeferred", {
            roll: incident.via.roll, total: incident.via.total, table: incident.via.table,
          }));
        }
        rolls.push(incident.dice);
        const text = incident.entry ?? loc("settlement.card.incidentUnmatched");
        // The after-dark shift belongs to a list read by band — the world's
        // d100, or the map's — so a drawn table's line does not claim one.
        lines.push(incidentLine(incident, text));
        // Where it happened, kept on the map: a Judge-only marker the clock
        // takes away, with the one button that makes it permanent. Guarded
        // like the lookup above — a marker that cannot be written must not
        // take the card down with it.
        if (incident.entry && formation) {
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
      } else {
        lines.push(loc("settlement.card.noIncidentTable"));
      }
    }
  }
  for (const gap of events.filter((e) => e.kind === "unpriced")) {
    lines.push(loc("settlement.card.unpriced", { what: gap.what }));
  }

  // The totals are in the text for reading; the dice show to the Judges
  // through Dice So Nice and stay off the message.
  await postToJudges({
    speaker: { alias: loc("settlement.card.speaker") },
    content: `<div class="acks-extras-settlement-card"><h3>${loc("settlement.card.title")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    rolls: rolls.filter(Boolean),
  });
}

/** The module id, for callers that key their own flags off this feature. */
export const SETTLEMENT_TURN_OWNER = MODULE_ID;
