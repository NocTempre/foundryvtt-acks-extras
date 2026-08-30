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
import { patchFormation, realMembers } from "./formation-model.mjs";
import { travelOf } from "./travel.mjs";
import {
  advanceSettlementTurn, advanceSettlementDays, citySpec, streetCadence,
} from "./settlement.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** One d20, or null when no throw is owed — the tick reads null as "not asked". */
async function maybeRoll(owed) {
  if (!owed) return { total: null, roll: null };
  const roll = await new Roll("1d20").evaluate();
  return { total: roll.total, roll };
}

/**
 * Take one turn in the city.
 *
 * Both dice are rolled BEFORE the ledger patch, because the patch callback is
 * synchronous — the same shape the sky and the provisions take.
 */
export async function runSettlementTurn(formation) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  if (t.mode !== "settlement") return null;

  const board = t.settlement;
  const headcount = realMembers(formation).length || 1;

  // Only roll what the turn will actually consult.
  const nav = citySpec({ pace: board.pace, route: board.route });
  const cadence = streetCadence({ where: board.where, night: board.night, intent: board.intent });
  const willOweEncounter = !!cadence && ((board.turns + 1) % cadence.everyTurns === 0);

  const navThrow = await maybeRoll(nav.throws && nav.target != null);
  const encThrow = await maybeRoll(willOweEncounter);

  const { board: next, events } = advanceSettlementTurn(board, {
    headcount,
    navRoll: navThrow.total,
    encounterRoll: encThrow.total,
  });

  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, settlement: next };
  });

  await whisperTurn(next, events, [navThrow.roll, encThrow.roll].filter(Boolean));
  return { board: next, events };
}

/**
 * Spend days holed up.
 *
 * Its own runner rather than a loop over turns, because holing up is priced by
 * the DAY: a week of study is seven throws, not a thousand ten-minute ticks
 * that happen to owe seven of them. Each day rolls its own d6, and the whole
 * stay lands as one card.
 */
export async function runSettlementDays(formation) {
  if (!game.user?.isGM) return null;
  const t = travelOf(formation);
  if (t.mode !== "settlement") return null;

  const board = t.settlement;
  const days = Math.min(30, Math.max(1, Math.floor(Number(board.holeUpDays) || 1)));
  const cadence = streetCadence({ where: board.where, night: board.night, intent: board.intent });

  const rolls = [];
  const dice = [];
  if (cadence) {
    for (let d = 0; d < days; d++) {
      const r = await new Roll("1d6").evaluate();
      rolls.push(r.total);
      dice.push(r);
    }
  }

  const { board: next, events } = advanceSettlementDays(board, { days, rolls });
  if (events.some((e) => e.kind === "notHoledUp")) {
    ui.notifications?.info(game.i18n.localize("ACKS-FORMATION.settlement.notHoledUp"));
    return null;
  }

  await patchFormation(formation.id, (record) => {
    const cur = travelOf(record);
    record.travel = { ...cur, settlement: next };
  });

  await whisperStay(next, events, dice);
  return { board: next, events };
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
