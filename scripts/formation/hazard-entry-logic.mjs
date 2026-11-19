/**
 * The Foundry-free half of the entry step: what the party's move into a place
 * puts on the Judges' hazard card, and which crossing a card's Begin opens.
 * Everything here is over plain data: places as `{uuid, name, things}` with
 * `things` as lib's `normalizeThings` returns them, and a synchronous
 * `hazardKeyOf(ref)` the caller has already resolved.
 *
 * - `newlyEntered` is the difference between the places under the party now and
 *   the list the last move left, so a place left and entered again posts again.
 * - `entryModel` is the card's rows: a place posts only when it holds an
 *   obstacle, each obstacle row carries the figures its kind's setup offers
 *   (blank as null, never a stand-in number), and conditions are listed once
 *   each. Hidden things are listed and marked, since the card is the Judges'.
 * - `seedForThing` is the seed of the one obstacle a Begin names, read over
 *   every place the party stands in so a condition on one place reaches an
 *   obstacle on another. Thing ids are per place (`thing-1` twice is normal),
 *   so each is addressed by its place as well.
 * - `moveHalted` reads `runTrapCheck`'s answer: a wall that was found or
 *   sprung stopped the move, and nothing is posted for it.
 */
import { CONDITION_HAZARDS, OBSTACLE_HAZARDS } from "./hazard-keys.mjs";
import { PARAM_KEYS, readParam, seedFromPlaces, setupKeysOf } from "./hazard-logic.mjs";
import { stackStops } from "./trap-rules.mjs";

/** The places a list names, each once, in the order first met. */
function uniquePlaces(places) {
  const seen = new Set();
  const out = [];
  for (const place of Array.isArray(places) ? places : []) {
    if (!place?.uuid || seen.has(place.uuid)) continue;
    seen.add(place.uuid);
    out.push(place);
  }
  return out;
}

/**
 * The uuids in `now` that `before` does not hold, once each, in `now`'s order.
 * @param {string[]} now the places under the party after this move
 * @param {string[]|null|undefined} before the list the last move wrote; none reads as empty
 * @returns {string[]}
 */
export function newlyEntered(now, before) {
  const held = new Set(Array.isArray(before) ? before : []);
  const out = [];
  for (const uuid of Array.isArray(now) ? now : []) {
    if (typeof uuid === "string" && uuid && !held.has(uuid) && !out.includes(uuid)) out.push(uuid);
  }
  return out;
}

/**
 * Did this move's trap check stop the party? A result stops it when its
 * placement is a wall and the wall was found or sprung (`stackStops`); a zone
 * never does, and a "found" with no result behind it, a trap off the line the
 * sweep turned up, is not a halt.
 * @param {{results?: Array<{outcome?: string, placement?: {kind?: string}}>}|null|undefined} check
 */
export function moveHalted(check) {
  return (check?.results ?? []).some((result) => stackStops(result, result?.placement));
}

/** The figures a row of this obstacle kind shows: the params its setup offers, in the params' own order. */
export function figureKeysOf(kind) {
  const reads = setupKeysOf(kind);
  return PARAM_KEYS.filter((key) => reads.includes(key));
}

/**
 * The card's model for the places the party just entered.
 *
 * A place with no obstacle posts nothing, and a place whose only things are
 * traps or conditions is left out. An obstacle whose ref the resolver does not
 * know is no obstacle: it has no crossing to begin. A figure is the thing's own
 * `params` value read the way the party sheet's form reads it, or null where it
 * is blank or refused.
 *
 * @param {Array<{uuid: string, name: string, things: object[]}>} places every place the party stands in
 * @param {(ref: string) => string|null} hazardKeyOf
 * @param {string[]} entered the uuids `newlyEntered` answered
 * @returns {Array<{uuid: string, name: string,
 *   obstacles: Array<{thingId: string, key: string, hidden: boolean, figures: Array<{param: string, value: number|null}>}>,
 *   conditions: Array<{key: string, hidden: boolean}>}>}
 */
export function entryModel(places, hazardKeyOf, entered) {
  const wanted = new Set(entered ?? []);
  const model = [];
  for (const place of uniquePlaces(places)) {
    if (!wanted.has(place.uuid)) continue;
    const obstacles = [];
    const conditions = new Map();
    for (const thing of place.things ?? []) {
      const key = thing?.ref ? hazardKeyOf(thing.ref) : null;
      if (thing?.kind === "obstacle" && OBSTACLE_HAZARDS.includes(key)) {
        obstacles.push({
          thingId: thing.id,
          key,
          hidden: thing.hidden === true,
          figures: figureKeysOf(key).map((param) => ({ param, value: readParam(param, thing.params?.[param]) ?? null })),
        });
      } else if (thing?.kind === "condition" && CONDITION_HAZARDS.includes(key)) {
        // Shown once however many times it is stacked; hidden only when every copy is.
        const hidden = thing.hidden === true && (conditions.get(key) ?? true);
        conditions.set(key, hidden);
      }
    }
    if (!obstacles.length) continue;
    model.push({ uuid: place.uuid, name: place.name, obstacles, conditions: [...conditions].map(([key, hidden]) => ({ key, hidden })) });
  }
  return model;
}

/**
 * The seed of the one obstacle a Begin names, over every place the party now
 * stands in. Each thing is addressed as its place and its own id together, so
 * two places that both hold `thing-1` stay apart; the conditions of every
 * place are unioned as `seedFromPlaces` does.
 *
 * @param {Array<{uuid: string, things: object[]}>} places
 * @param {(ref: string) => string|null} hazardKeyOf
 * @param {string} placeUuid the place the card's row names
 * @param {string} thingId the thing's id in that place
 * @returns {{kind: string, setup: Record<string, number|boolean>}|null} null when the
 *   party no longer stands in that place, or the thing is gone or no longer an obstacle
 */
export function seedForThing(places, hazardKeyOf, placeUuid, thingId) {
  const lists = uniquePlaces(places).map((place) => (place.things ?? []).map((thing) => ({ ...thing, id: `${place.uuid}|${thing.id}` })));
  const entry = seedFromPlaces(lists, hazardKeyOf).find((seed) => seed.thingId === `${placeUuid}|${thingId}`);
  return entry ? { kind: entry.kind, setup: entry.setup } : null;
}

/** Every ref an obstacle or a condition names, once each, so the caller resolves each hazard once and never a trap's or a body's. */
export function refsOf(places) {
  const refs = new Set();
  for (const place of uniquePlaces(places)) for (const thing of place.things ?? []) if (thing?.ref && (thing.kind === "obstacle" || thing.kind === "condition")) refs.add(thing.ref);
  return [...refs];
}
