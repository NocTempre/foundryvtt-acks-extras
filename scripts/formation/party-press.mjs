import { escape as esc, makeLoc } from "../lib/util.mjs";
import { setHurried } from "./formation-model.mjs";
import { hopRefusal, travelToPlace, whisperHop } from "./poi.mjs";
import { nextHex, spendActivityHours } from "./journey.mjs";
import { closeDay } from "./day-close.mjs";
import { runForageDay } from "./forage-run.mjs";
import { travelOf, TRAVEL_MODES } from "./travel.mjs";
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
  noTarget: Object.freeze({ key: "ACKS-FORMATION.settlement.poi.refused.noTarget", level: "warn" }),
  far: Object.freeze({ key: "ACKS-FORMATION.settlement.poi.refused.far", level: "warn" }),
  outside: Object.freeze({ key: "ACKS-FORMATION.settlement.poi.refused.outside", level: "warn" }),
  quiet: Object.freeze({ key: null, level: "none" }),
});
