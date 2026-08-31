/* global game, Roll, ChatMessage */
/**
 * A city turn, actually taken.
 *
 * [settlement.mjs](./settlement.mjs)'s tick is pure and owns no dice; this
 * rolls them, writes the board, and whispers the Judge what happened. The
 * split is the same one the rest of the feature keeps: arithmetic that can be
 * tested without a world, and a thin caller that cannot.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { makeLoc, gmIds } from "../lib/util.mjs";
import { readFormations, patchFormation, realMembers } from "./formation-model.mjs";
import { travelOf } from "./travel.mjs";
import {
  advanceSettlementTurn, advanceSettlementDays, citySpec, streetCadence,
  settlementEncounter, SETTLEMENT_LOCATIONS,
} from "./settlement.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** One d20, or null when no throw is owed — the tick reads null as "not asked". */
async function maybeRoll(owed) {
  if (!owed) return { total: null, roll: null };
  const roll = await new Roll("1d20").evaluate();
  return { total: roll.total, roll };
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

  const board = t.settlement;
  const headcount = realMembers(formation).length || 1;

  // Only roll what the turn will actually consult. A party staying put neither
  // navigates nor is thrown for by the turn — its day tick owns both.
  const stationary = !!SETTLEMENT_LOCATIONS[board.where]?.stationary;
  const nav = stationary ? { throws: false } : citySpec({ pace: board.pace, route: board.route });
  const cadence = stationary
    ? null
    : streetCadence({ where: board.where, night: board.night, intent: board.intent });
  const willOweEncounter = !!cadence && ((board.turns + 1) % cadence.everyTurns === 0);

  const navThrow = await maybeRoll(nav.throws && nav.target != null);
  const encThrow = await maybeRoll(willOweEncounter);

  const { board: next, events } = advanceSettlementTurn(board, {
    headcount,
    navRoll: navThrow.total,
    encounterRoll: encThrow.total,
  });

  formation.travel = { ...t, settlement: next };

  // The turn card is what the Judge is already reading; the two things a city
  // turn can do that a dungeon turn cannot belong on it.
  if (events.some((e) => e.kind === "strayed")) {
    notes.push({ type: "bad", text: loc("settlement.note.strayed") });
  }
  if (events.some((e) => e.kind === "encounterOwed" && e.met)) {
    notes.push({ type: "bad", text: loc("settlement.note.incident") });
  }

  await whisperTurn(next, events, [navThrow.roll, encThrow.roll].filter(Boolean));
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

  const n = Math.min(30, Math.max(1, Math.floor(Number(days) || 0)));
  if (!n) return null;
  const board = t.settlement;
  const cadence = streetCadence({ where: board.where, night: board.night, intent: board.intent });

  const rolls = [];
  const dice = [];
  if (cadence) {
    for (let d = 0; d < n; d++) {
      const r = await new Roll("1d6").evaluate();
      rolls.push(r.total);
      dice.push(r);
    }
  }

  const { board: next, events } = advanceSettlementDays(board, { days: n, rolls });
  if (events.some((e) => e.kind === "notHoledUp")) return null;

  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, settlement: next };
  });

  await whisperStay(next, events, dice);
  return { board: next, events };
}

/** Seconds in a day, the unit a stay is counted in. */
const DAY_SECONDS = 24 * 60 * 60;

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
 * A party that has just holed up is stamped and charged nothing; the first day
 * begins now, not at whatever the calendar said when the world was made.
 */
export async function creditHoledUpDays() {
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
    await runHoledUpDays(formation, days);
    await patchFormation(formation.id, (record) => {
      const cur = travelOf(record);
      const since = Number(cur.settlement.holeUpSince) + days * DAY_SECONDS;
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

export async function findIncidentRows() {
  const flagged = (t) => t?.flags?.["acks-importer"]?.cookbook?.id === INCIDENT_TABLE_ID;

  let table = game.tables?.find(flagged) ?? null;
  if (!table) {
    for (const pack of game.packs.filter((p) => p.documentName === "RollTable")) {
      const index = await pack.getIndex({ fields: ["flags"] });
      const hit = [...index].find(flagged);
      if (hit) { table = await pack.getDocument(hit._id); break; }
    }
  }
  if (!table) return null;
  return [...table.results]
    .map((r) => ({ min: r.range?.[0], max: r.range?.[1], text: r.text ?? r.description ?? "" }))
    .filter((r) => Number.isFinite(r.min) && Number.isFinite(r.max));
}

/**
 * Roll one settlement incident: the d100, the shift the dark adds, and the row.
 * Null when neither route has supplied the table.
 */
export async function rollSettlementIncident({ night = false } = {}) {
  const rows = await findIncidentRows();
  const roll = await new Roll("1d100").evaluate();
  const found = settlementEncounter(roll.total, { night, rows });
  return found ? { ...found, roll: roll.total, dice: roll } : null;
}

/** A stay as one card: how long it lasted, and which days were interrupted. */
async function whisperStay(board, events, rolls) {
  const owed = events.filter((e) => e.kind === "encounterOwed");
  const met = owed.filter((e) => e.met);
  const lines = [loc("settlement.card.holedUp", { days: board.days })];

  if (events.some((e) => e.kind === "unpriced")) {
    lines.push(loc("settlement.card.unpriced"));
  } else if (met.length) {
    lines.push(loc("settlement.card.interrupted", {
      count: met.length, days: met.map((e) => e.day).join(", "),
    }));
  } else if (owed.length) {
    lines.push(loc("settlement.card.undisturbed", { throws: owed.length }));
  }

  await ChatMessage.create({
    speaker: { alias: loc("settlement.card.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-settlement-card"><h3>${loc("settlement.card.stayTitle")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
    rolls,
  });
}

/** The turn as one Judge-side card. Silent when nothing happened worth saying. */
async function whisperTurn(board, events, rolls) {
  const lines = [];
  lines.push(loc("settlement.card.moved", { blocks: board.blocks, turns: board.turns }));

  const strayed = events.find((e) => e.kind === "strayed");
  if (strayed) {
    lines.push(loc(strayed.blocks ? "settlement.card.strayed" : "settlement.card.strayedUnpriced",
      { dice: strayed.blocks ?? "" }));
  }
  const owed = events.find((e) => e.kind === "encounterOwed");
  if (owed) {
    lines.push(owed.met === undefined
      ? loc("settlement.card.owed", { target: owed.target })
      : loc(owed.met ? "settlement.card.met" : "settlement.card.quiet",
        { rolled: owed.rolled, target: owed.target }));
    // The street answering is only half of it: what actually happened is the
    // incident table's to say, and the Judge should not have to go and roll it.
    if (owed.met) {
      const incident = await rollSettlementIncident({ night: board.night });
      if (incident) {
        rolls.push(incident.dice);
        lines.push(loc("settlement.card.incident", {
          roll: incident.roll,
          total: incident.total,
          text: incident.entry ?? loc("settlement.card.incidentUnmatched"),
        }));
      } else {
        lines.push(loc("settlement.card.noIncidentTable"));
      }
    }
  }
  for (const gap of events.filter((e) => e.kind === "unpriced")) {
    lines.push(loc("settlement.card.unpriced", { what: gap.what }));
  }

  await ChatMessage.create({
    speaker: { alias: loc("settlement.card.speaker") },
    whisper: gmIds(),
    content: `<div class="acks-extras-settlement-card"><h3>${loc("settlement.card.title")}</h3>`
      + `<ul>${lines.map((l) => `<li>${l}</li>`).join("")}</ul></div>`,
  });
  // `rolls` is deliberately unused in the message: a numeric `type` or a rolls
  // array on a v12+ ChatMessage makes creation fail silently. The totals are in
  // the text, which is what the Judge reads anyway.
  void rolls;
}

/** The module id, for callers that key their own flags off this feature. */
export const SETTLEMENT_TURN_OWNER = MODULE_ID;
