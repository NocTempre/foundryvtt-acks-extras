/**
 * The scene's SESSION on plain data, Foundry-free: the record a party carries
 * while it searches a place, the entries read through it, and what one check
 * does to them. `session.mjs` is the Foundry side.
 *
 * A session is `{sceneId, placeUuid, recordMessageId, potUuid, shown, bodies,
 * lots, log}`. The place's authored list is never written with runtime facts, so
 * everything a session adds to it lives here:
 *
 * - `shown` is whether the Judge has shown the scene to the table: a player's
 *   screen has nothing to read until it is true;
 * - `bodies` are the fight's fallen as entry rows (`id`, `ref`, `hidden`,
 *   `hint`, `point`, `state`, `layers`), each carrying its own `state`, since a
 *   body has no thing to hold one;
 * - `lots` map every dealt lot to the entry that hides it, `{key, thing, layer,
 *   cardId}`, where `thing` is the entry's KEY (`thing:<id>`, `body:<id>`).
 *   `overlayLots` adds the keys to each entry's layer when the entries are
 *   read, so the place's authored `yields.lots` stays what the Judge wrote;
 * - `log` is what the table may read of each check: who, which entry, which
 *   layer, the answer's code and the kinds still unfound. Never a die, a target
 *   or a total; those are the Judges' card.
 *
 * A check changes one entry's `state` and nothing else; `applyCheck` is that
 * change, and the writer decides where each entry's state lives.
 */
import { CAPABILITY, CODE, LOG_LIMIT, REVEAL_PREFIXES, SESSION_REFUSAL } from "./constants.mjs";
import { foundKeys, normalizeSources } from "./haul-logic.mjs";
import { LAYER_NAMES } from "../lib/place-things-logic.mjs";
import { outcomeOf, recordOutcome, revealedKeys, sceneEntries } from "./scene-logic.mjs";

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * A stored session in its signed shape, or null when there is none (not an
 * object, or no place). Every key is present; a row that is not an object, or
 * a body or lot with no id or key, is dropped.
 * @param {object|null} raw
 */
export function normalizeSession(raw) {
  if (!isPlain(raw) || !text(raw.placeUuid)) return null;
  const bodies = [];
  for (const row of Array.isArray(raw.bodies) ? raw.bodies : []) {
    if (!isPlain(row) || !text(row.id) || bodies.some((b) => b.id === text(row.id))) continue;
    bodies.push({ ...structuredClone(row), id: text(row.id) });
  }
  const lots = (Array.isArray(raw.lots) ? raw.lots : [])
    .filter((lot) => isPlain(lot) && text(lot.key) && text(lot.thing))
    .map((lot) => ({ key: text(lot.key), thing: text(lot.thing), layer: LAYER_NAMES.includes(lot.layer) ? lot.layer : "hasty", cardId: text(lot.cardId) || null }));
  return {
    sceneId: text(raw.sceneId) || null,
    placeUuid: text(raw.placeUuid),
    recordMessageId: text(raw.recordMessageId) || null,
    potUuid: text(raw.potUuid) || null,
    shown: raw.shown === true,
    bodies,
    lots,
    log: (Array.isArray(raw.log) ? raw.log : []).filter(isPlain).slice(-LOG_LIMIT),
  };
}

/**
 * A fight's record read as the session's bodies and the sources of its haul:
 * one body per fallen creature that has an id, and for each body that carries
 * something one source, keyed to the body's entry (`body:<id>`), dealing its
 * treasure letter and holding its carried goods as the truths already made. A
 * body whose goods the creature carries is turned out by the hasty check, as a
 * pocket is. Each carried truth names the item it was made from, so the deal can
 * take it off the body. A linked table is drawn by the caller, since drawing is
 * a roll: what it drew, as truths by the fallen's combatant id, joins that
 * body's source after the goods it carries.
 * @param {{fallen?: object[]}} record `treasure/search-logic.mjs` `normalizeRecord`'s answer
 * @param {{drawn?: Record<string, object[]>}} [opts] `drawn`: the truths each body's linked table drew
 * @returns {{bodies: object[], sources: object[]}}
 */
export function bodiesFromRecord(record, { drawn = {} } = {}) {
  const bodies = [];
  const sources = [];
  for (const fallen of Array.isArray(record?.fallen) ? record.fallen : []) {
    const id = text(fallen?.combatantId);
    if (!id || bodies.some((b) => b.id === id)) continue;
    bodies.push({ id, ref: text(fallen.actorUuid) || null, name: text(fallen.name), hidden: false, hint: null, point: null, state: {}, layers: {} });
    const carried = (Array.isArray(fallen.goods) ? fallen.goods : []).flatMap((good) =>
      (Array.isArray(good?.truths) ? good.truths : []).map((truth) => ({ truth, owner: { actorUuid: fallen.actorUuid, itemId: good.itemId } })),
    );
    const made = (Array.isArray(drawn?.[id]) ? drawn[id] : []).map((truth) => ({ truth, owner: null }));
    const truths = [...carried, ...made];
    const [source] = normalizeSources([
      { thing: `body:${id}`, letters: text(fallen.letter) ? [fallen.letter] : [], truths: truths.map((t) => t.truth), owners: truths.map((t) => t.owner) },
    ]);
    if (source) sources.push(source);
  }
  return { bodies, sources };
}

/**
 * The entries with each dealt lot's key added to the `yields.lots` of the layer
 * of the entry that hides it: new entries, the inputs untouched. A lot naming
 * an entry that is not in the scene is skipped.
 * @param {object[]} entries `sceneEntries`' answer
 * @param {Array<{key: string, thing: string, layer: string}>} lots the session's lots
 */
export function overlayLots(entries, lots) {
  const held = new Map();
  for (const lot of Array.isArray(lots) ? lots : []) {
    const layers = held.get(lot.thing) ?? {};
    layers[lot.layer] = [...(layers[lot.layer] ?? []), lot.key];
    held.set(lot.thing, layers);
  }
  return (Array.isArray(entries) ? entries : []).map((entry) => {
    const layers = held.get(entry.key);
    if (!layers) return entry;
    const next = { ...entry.layers };
    for (const [name, keys] of Object.entries(layers)) {
      const yields = entry.layers[name].yields;
      next[name] = { ...entry.layers[name], yields: { ...yields, lots: [...new Set([...yields.lots, ...keys])] } };
    }
    return { ...entry, layers: next };
  });
}

/**
 * Every entry of a session, the Judge's view: the place's things, the session's
 * bodies and the derived doors and old-style traps, with the dealt lots laid
 * over.
 * @param {object} inputs
 * @param {object[]} [inputs.things] the place's stored list
 * @param {object[]} [inputs.doors]
 * @param {object[]} [inputs.oldTraps]
 * @param {object|null} inputs.session a normalized session
 */
export function sessionEntries({ things = [], doors = [], oldTraps = [], session = null } = {}) {
  return overlayLots(sceneEntries({ things, doors, oldTraps, bodies: session?.bodies ?? [] }), session?.lots ?? []);
}

/** The capability tokens a member's checks across these entries can ask for, so a reader looks up only those. */
export function capabilitiesWanted(entries) {
  const wanted = new Set([CAPABILITY.SEARCHING]);
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const name of LAYER_NAMES) if (entry.layers?.[name]?.capability) wanted.add(entry.layers[name].capability);
  }
  return [...wanted];
}

/**
 * One member's check at one layer of one entry, applied: the answer
 * (`outcomeOf`), the entry's next `state` (`recordOutcome`), and what the answer
 * touches beyond its own entry.
 *
 * - `patch` is the keys of the entry's state this check changed (`layers`, and
 *   `revealed` where a reveal was named), to be written to wherever that entry's
 *   state lives;
 * - `shown` is the keys of the other entries the answer shows;
 * - `lots` is the lot keys it finds;
 * - `walls` is the wall ids a `wall:` reveal names, for the hidden exit's seam.
 *
 * A refused check answers `{outcome}` with the refusal and changes nothing, so
 * a second searcher at an entry already found records no failure and no lock.
 *
 * @param {object} args
 * @param {object[]} args.entries the scene's entries, lots laid over
 * @param {string} args.key the entry's key
 * @param {string} args.layer `hasty` or `methodical`
 * @param {object} args.member `{id, level, capabilities, tools}`
 * @param {object} args.ctx `layerOptions`' context, without `entries`
 * @param {{passed: boolean}|null} [args.roll]
 */
export function applyCheck({ entries, key, layer, member, ctx = {}, roll = null }) {
  const entry = entries.find((e) => e.key === key);
  if (!entry) return { outcome: { refusal: SESSION_REFUSAL.UNKNOWN_ENTRY, layer }, patch: null, shown: [], lots: [], walls: [] };
  const outcome = outcomeOf(entry, layer, member, { ...ctx, entries }, roll);
  if (outcome.refusal || outcome.code === CODE.NEEDS_ROLL) return { outcome, patch: null, shown: [], lots: [], walls: [] };
  const state = recordOutcome(entry.state, layer, member, outcome);
  const patch = { layers: state.layers };
  const named = outcome.code === CODE.FOUND ? outcome.reveal : [];
  if (named.length) patch.revealed = [...new Set([...(Array.isArray(entry.state?.revealed) ? entry.state.revealed : []), ...named])];
  const wall = REVEAL_PREFIXES[1];
  return {
    outcome,
    patch,
    shown: revealedKeys(outcome, entries),
    lots: foundKeys(outcome),
    walls: named.filter((k) => k.startsWith(wall)).map((k) => k.slice(wall.length)),
  };
}

/**
 * The row of a session's log for one answered check: who, which entry and layer,
 * the answer's code, any clue it found, and the kinds still unfound. Nothing a
 * die, a target or a total could be read from. `card` is the id of the Judges'
 * whispered card the throw was posted on, kept only where one was, so the
 * Judge's screen can read the throw from it and no seat can from here.
 */
export function logRowOf({ member, key, layer, outcome, card = null }) {
  return {
    actorId: member?.id ?? null,
    key,
    layer,
    code: outcome?.code ?? null,
    clue: outcome?.code === CODE.FOUND ? (outcome.clue ?? null) : null,
    more: Array.isArray(outcome?.more) ? [...outcome.more] : [],
    ...(card ? { card } : {}),
  };
}

/**
 * The log a player may read: only the rows at entries the seat can see
 * (`visibleKeys`), each with nothing the table must not learn. A found row
 * keeps its clue and the kinds still unfound; a vague row keeps its code; every
 * other answer (found nothing, whether it was a miss or an empty place) is
 * blanked to a row that says who checked what and nothing of the result.
 * @param {object[]} log the session's rows
 * @param {Iterable<string>} visibleKeys the keys of the entries the seat sees
 */
export function playerLog(log, visibleKeys) {
  const keys = new Set(visibleKeys);
  return (Array.isArray(log) ? log : [])
    .filter((row) => isPlain(row) && keys.has(row.key))
    .map((row) => {
      const kept = row.code === CODE.FOUND || row.code === CODE.VAGUE;
      return { actorId: row.actorId ?? null, key: row.key, layer: row.layer, code: kept ? row.code : null, clue: row.code === CODE.FOUND ? (row.clue ?? null) : null, more: kept && Array.isArray(row.more) ? [...row.more] : [] };
    });
}

/** The log with one row added, held to `LOG_LIMIT` (the oldest go): a new list. */
export function appendLog(log, row) {
  return [...(Array.isArray(log) ? log : []), row].slice(-LOG_LIMIT);
}
