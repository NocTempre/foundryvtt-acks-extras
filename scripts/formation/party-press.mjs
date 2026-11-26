import { escape as esc, makeLoc } from "../lib/util.mjs";
import { addBlank, autoArrange, getFrontage, removeBlank, setHurried, swapCells } from "./formation-model.mjs";
import { hopRefusal, travelToPlace, whisperHop } from "./poi.mjs";
import { nextHex, spendActivityHours } from "./journey.mjs";
import { closeDay } from "./day-close.mjs";
import { runForageDay } from "./forage-run.mjs";
import { rollWeatherNow, travelOf, TRAVEL_MODES } from "./travel.mjs";
import { arrangeFastest, setGroupMovement, undoArrangement } from "./conveyance.mjs";
import { isMode as isMovementMode } from "../lib/movement-modes.mjs";
import { partyPoint } from "./zones.mjs";
import { LIGHT_SOURCES } from "./constants.mjs";
import { adjustSpell, removeLight, removeSpell } from "./turn-engine.mjs";

/**
 * The presses a seat that owns a party member may make on the party's own clock
 * and day, one entry per press. The Judge's seat runs an entry directly; any
 * other seat sends its name and arguments to the Judge's client, which runs the
 * SAME entry (`player-requests.mjs`, kind `partyPress`).
 *
 * An entry is `{ parse, actor?, modes, run }`:
 * - `parse(args, formation)` builds the entry's own argument object from the keys
 *   it names and nothing else, or answers null for arguments it refuses. Nothing
 *   a sender adds is read, so a payload carrying `judge` or `override` buys
 *   nothing.
 * - `actor(args, formation)`, present only where the press is a bearer's or a
 *   caster's own, names the member the sender must own; null refuses.
 * - `modes` lists the travel modes the press is open in, one of `TRAVEL_MODES`
 *   or `"delve"`, so a press made against a mode the party has left is refused.
 * - `run(formation, args, { user })` does the work and answers
 *   `{ ok, refused?, said? }`. `said` is the declaration the relay announces after
 *   a write that happened; no `said` announces nothing.
 *
 * A run never reads `judge` and never passes `override`: a press from another
 * seat is blocked where a Judge's would be warned.
 */

const loc = makeLoc("ACKS-FORMATION");

/** Longest hex label a relayed press carries, in characters. */
const HEX_LABEL_MAX = 64;
/** Longest place-token id a relayed hop carries, in characters. */
const TOKEN_ID_MAX = 32;

/**
 * Work the country: roll whatever hours the day board set aside for foraging
 * and hunting, put what is found into the foragers' own packs and mark those
 * hours spent. Answers `{ ok: false, refused: "noHours" }` with none set aside,
 * `"worked"` when each such hour is already spent, and `"quiet"` when nothing
 * was rolled (no one to work it), which says nothing. See
 * docs/formation/MODEL.md, "Working the country".
 * @returns {Promise<{ok: boolean, refused?: string}>}
 */
export async function workTheCountry(formation) {
  // `activities` is the day board's own field name; there is no `slots`. Only
  // the hours not yet spent are worked: a slot already done has had its throws.
  const day = travelOf(formation).day;
  const slots = day.activities.map((a, n) => (day.done[n] ? null : a));
  const kinds = slots.includes("forage") ? ["food", "water", "firewood"] : [];
  const hunting = slots.includes("hunt");
  if (!kinds.length && !hunting) {
    const spent = day.activities.some((a, n) => (a === "forage" || a === "hunt") && day.done[n]);
    return { ok: false, refused: spent ? "worked" : "noHours" };
  }
  const results = await runForageDay(formation, { kinds, hunting });
  if (!results) return { ok: false, refused: "quiet" };
  await spendActivityHours(formation.id, ["hunt", "forage"], { all: true });
  return { ok: true };
}

/** The directions a blank cell is moved in, as the sheet's arrows name them. */
const BLANK_DIRECTIONS = Object.freeze(["up", "down", "left", "right"]);

/** A grid position a press names: a whole number, never a numeric string. */
const isCell = (value) => Number.isInteger(value) && value >= 0;

/** The presses a seat may name, by the name the request carries. */
export const PARTY_PRESSES = Object.freeze({
  pace: Object.freeze({
    parse: (args) => (typeof args?.hurried === "boolean" ? { hurried: args.hurried } : null),
    modes: Object.freeze(["delve", "settlement"]),
    async run(formation, { hurried }) {
      const changed = await setHurried(formation.id, hurried);
      return { ok: true, said: changed ? loc(hurried ? "request.paceHurried" : "request.paceCareful") : undefined };
    },
  }),

  hop: Object.freeze({
    parse: (args) => (typeof args?.tokenId === "string" && args.tokenId && args.tokenId.length <= TOKEN_ID_MAX ? { tokenId: args.tokenId } : null),
    modes: Object.freeze(["settlement"]),
    async run(formation, { tokenId }, { user }) {
      // A token the Judge has hidden is no place a seat may be walked to.
      if (!user.isGM && partyPoint(formation)?.scene.tokens.get(tokenId)?.hidden) return { ok: false, refused: "noTarget" };
      const result = await travelToPlace(formation.id, tokenId);
      const refused = hopRefusal(result);
      if (refused) return { ok: false, refused };
      await whisperHop(result);
      return { ok: true, said: loc("request.hop", { place: esc(result.place) }) };
    },
  }),

  enterHex: Object.freeze({
    parse: (args) => {
      if (typeof args?.label !== "string") return null;
      const label = args.label.trim();
      return label.length <= HEX_LABEL_MAX ? { label } : null;
    },
    modes: Object.freeze(["journey"]),
    async run(formation, args) {
      const label = typeof args?.label === "string" ? args.label.trim() : "";
      if (!(await nextHex(formation.id, label))) return { ok: false, refused: "stale" };
      return { ok: true, said: label ? loc("request.enterHex", { hex: esc(label) }) : loc("request.enterHexBlank") };
    },
  }),

  forageDay: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze(["journey"]),
    async run(formation) {
      const out = await workTheCountry(formation);
      return out.ok ? { ok: true, said: loc("request.forageDay") } : out;
    },
  }),

  endDay: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze(["journey"]),
    async run(formation) {
      return (await closeDay(formation)) ? { ok: true, said: loc("request.endDay") } : { ok: false, refused: "quiet" };
    },
  }),

  // How the party moves: a group tile, the way back to automatic, and its undo.
  // A tile is the Wilderness tab's, so it is the journey's; the Order head draws
  // Fastest and Undo in every mode. None announces: they set a word, nothing in
  // the world acts. A run re-reads its arguments because the Judge's seat reaches
  // it without `parse`.
  movementTile: Object.freeze({
    parse: (args) => (typeof args?.mode === "string" && isMovementMode(args.mode) ? { mode: args.mode } : null),
    modes: Object.freeze(["journey"]),
    async run(formation, { mode }) {
      if (typeof mode !== "string" || !isMovementMode(mode)) return { ok: false, refused: "badPress" };
      await setGroupMovement(formation.id, mode);
      return { ok: true };
    },
  }),

  movementFastest: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation) {
      await arrangeFastest(formation.id);
      return { ok: true };
    },
  }),

  // Nothing to put back is a press made on a sheet that has since moved on.
  movementUndo: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation) {
      return (await undoArrangement(formation.id)) === null ? { ok: false, refused: "stale" } : { ok: true };
    },
  }),

  // The marching grid: arrangement presses, open in every mode and announcing
  // nothing. A cell is named by its position in the record, which a stale sheet
  // may have wrong, so each cell press checks it is still a blank.
  autoArrange: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation) {
      await autoArrange(formation);
      return { ok: true };
    },
  }),

  addBlank: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation) {
      await addBlank(formation);
      return { ok: true };
    },
  }),

  removeBlank: Object.freeze({
    parse: (args) => (isCell(args?.cell) ? { cell: args.cell } : null),
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation, { cell }) {
      if (!isCell(cell)) return { ok: false, refused: "badPress" };
      if (!formation.members[cell]?.blank) return { ok: false, refused: "stale" };
      await removeBlank(formation, cell);
      return { ok: true };
    },
  }),

  // A blank cell swaps with the cell beside it in the direction pressed; at an
  // edge of the grid there is nothing to swap with.
  moveBlank: Object.freeze({
    parse: (args) => (isCell(args?.cell) && BLANK_DIRECTIONS.includes(args.dir) ? { cell: args.cell, dir: args.dir } : null),
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation, { cell, dir }) {
      if (!isCell(cell) || !BLANK_DIRECTIONS.includes(dir)) return { ok: false, refused: "badPress" };
      if (!formation.members[cell]?.blank) return { ok: false, refused: "stale" };
      const frontage = getFrontage(formation);
      const edgeLeft = cell % frontage === 0;
      const edgeRight = cell % frontage === frontage - 1;
      const delta = { up: -frontage, down: frontage, left: edgeLeft ? 0 : -1, right: edgeRight ? 0 : 1 }[dir];
      const target = cell + delta;
      if (!delta || target < 0 || target >= formation.members.length) return { ok: false, refused: "stale" };
      await swapCells(formation, cell, delta);
      return { ok: true };
    },
  }),

  // The Sky group's Roll weather: the Wilderness tab's, so the journey's. It
  // announces, since it acts in the world; a registry that cannot answer writes
  // nothing and says nothing, as the Judge's press does.
  weatherRoll: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze(["journey"]),
    async run(formation) {
      return (await rollWeatherNow(formation.id)) ? { ok: true, said: loc("request.weatherRoll") } : { ok: false, refused: "quiet" };
    },
  }),

  // The Dungeon tab's Search here. The run is the Judge's own press: it calls the
  // scene search's api, whose own Judge check is the executor, so this client is
  // the Judge's by the time it runs. The api answers `{ ok: false, reason }` for a
  // search that did not open (no place under the party, a session already
  // opening) and has told the Judge in its own words; the seat is told only that
  // it did not open.
  searchHere: Object.freeze({
    parse: () => ({}),
    modes: Object.freeze(["delve"]),
    async run(formation) {
      const opened = await globalThis.acksExtras?.sceneSearch?.searchHere?.({ partyId: formation.id });
      if (!opened?.ok) return { ok: false, refused: "searchClosed" };
      return { ok: true, said: loc("request.searchHere") };
    },
  }),

  // The Kit tab's three tracked-thing presses are the bearer's or the caster's own,
  // so each names that member and the relay tests the seat's ownership of it. The
  // Kit is the same in every mode.
  lightRemove: Object.freeze({
    parse: (args) => (typeof args?.lightId === "string" && args.lightId ? { lightId: args.lightId } : null),
    actor: ({ lightId }, formation) => formation.lights.find((l) => l.id === lightId)?.bearerId ?? null,
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation, { lightId }) {
      const light = formation.lights.find((l) => l.id === lightId);
      if (!light) return { ok: false, refused: "stale" };
      const name = `${game.i18n.localize(LIGHT_SOURCES[light.type]?.label ?? light.type)} — ${game.actors.get(light.bearerId)?.name ?? "?"}`;
      await removeLight(formation, lightId);
      return { ok: true, said: loc("request.lightRemove", { light: esc(name) }) };
    },
  }),

  spellAdjust: Object.freeze({
    parse: (args) => (typeof args?.spellId === "string" && args.spellId && (args.delta === 1 || args.delta === -1) ? { spellId: args.spellId, delta: args.delta } : null),
    actor: ({ spellId }, formation) => (formation.spells ?? []).find((s) => s.id === spellId)?.casterId ?? null,
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation, { spellId, delta }) {
      const spell = (formation.spells ?? []).find((s) => s.id === spellId);
      if (!spell) return { ok: false, refused: "stale" };
      await adjustSpell(formation, spellId, delta);
      return { ok: true, said: loc("request.spellAdjust", { spell: esc(spell.name) }) };
    },
  }),

  spellRemove: Object.freeze({
    parse: (args) => (typeof args?.spellId === "string" && args.spellId ? { spellId: args.spellId } : null),
    actor: ({ spellId }, formation) => (formation.spells ?? []).find((s) => s.id === spellId)?.casterId ?? null,
    modes: Object.freeze([...TRAVEL_MODES]),
    async run(formation, { spellId }) {
      const spell = (formation.spells ?? []).find((s) => s.id === spellId);
      if (!spell) return { ok: false, refused: "stale" };
      await removeSpell(formation, spellId);
      return { ok: true, said: loc("request.spellRemove", { spell: esc(spell.name) }) };
    },
  }),
});

/**
 * What each refusal code says to the seat that pressed, as a full lang key and
 * the notification level it is said at. `level: "none"` says nothing.
 */
export const PRESS_REFUSALS = Object.freeze({
  badPress: Object.freeze({ key: "ACKS-FORMATION.request.refused", level: "warn" }),
  notOwner: Object.freeze({ key: "ACKS-FORMATION.request.refused", level: "warn" }),
  stale: Object.freeze({ key: "ACKS-FORMATION.request.refused", level: "warn" }),
  noHours: Object.freeze({ key: "ACKS-FORMATION.forageRun.noHours", level: "info" }),
  worked: Object.freeze({ key: "ACKS-FORMATION.forageRun.worked", level: "info" }),
  searchClosed: Object.freeze({ key: "ACKS-FORMATION.request.searchClosed", level: "warn" }),
  noTarget: Object.freeze({ key: "ACKS-FORMATION.settlement.poi.refused.noTarget", level: "warn" }),
  far: Object.freeze({ key: "ACKS-FORMATION.settlement.poi.refused.far", level: "warn" }),
  outside: Object.freeze({ key: "ACKS-FORMATION.settlement.poi.refused.outside", level: "warn" }),
  quiet: Object.freeze({ key: null, level: "none" }),
});
