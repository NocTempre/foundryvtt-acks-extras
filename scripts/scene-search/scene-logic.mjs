/**
 * Scene search as arithmetic over plain data: what a place holds to inspect,
 * what each seat sees of it, whether more remains, who may attempt which check
 * and what the check answers. No dice, no documents, no Foundry, no English.
 *
 * Every inspectable is an ENTRY: a thing of the place's list, or one derived
 * from the map (a door, an old-style trap) or a fight (a body), all in the one
 * thing shape plus a unique `key` and its `source`. Each entry has two checks,
 * the hasty one (a round) and the methodical one (a turn), each answering
 * "found X" or "found nothing" and never "picked clean".
 *
 * The model answers in codes with the `scene:` prefix plus data. Every printed
 * figure (a throw's target, the thief's bonus, the search reach, the map's
 * feet per pixel) arrives as an argument; with one missing the check that
 * needs it cannot be assigned, and a reach that cannot be measured is the
 * Judge's call, never a refusal.
 *
 * The seat rule is the public GUMSHOE one: whether something more remains on a
 * visible entry is known to every seat, but what hides behind a clue not yet
 * solved is absent, and the mark sits on the clue in front of it. A hidden
 * entry is visible once it is shown: `state.shown` lives in its own state, so
 * a Reset hides it again. The Judge shows it, or a found check's `reveal`
 * names it and `revealedKeys` says which entries the writer shows.
 *
 * Runtime per layer is `state.layers.<name> = {done, by, found, failed,
 * progress}`; `failed` is `{actorId: level}`, the shape `trap-rules.mjs` reads
 * as a hasty lock.
 */
import { LAYER_NAMES, normalizeThing, normalizeThings } from "../lib/place-things-logic.mjs";
import { lockAfterFailure, repeatLocked } from "../formation/trap-rules.mjs";
import { CAPABILITY, CHECK, CODE, LAYER, MORE, REFUSAL, REVEAL_PREFIXES, defaultLayer } from "./constants.mjs";

const isPlain = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (list) => [...new Set((Array.isArray(list) ? list : []).filter((s) => typeof s === "string" && s.trim()).map((s) => s.trim()))];
/** A figure as a finite number, or null for blank, absent or not a number. */
const figure = (value) => (value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));

/* -------------------------------------------- */
/*  The layer, and the entries                   */
/* -------------------------------------------- */

/**
 * One authored layer in its signed shape: `{check, capability, anyone, tools,
 * turns, yields: {lots, clue, reveal}}`. Keys the layer does not state read
 * from `fallback` (the kind's default); a check that is not one of `CHECK`
 * reads as `inspect`; a reveal that names neither `thing:` nor `wall:` is
 * dropped. Authored only: nothing runtime lives here.
 */
export function normalizeLayer(raw, fallback = {}) {
  const src = { ...fallback, ...(isPlain(raw) ? raw : {}) };
  const yields = isPlain(src.yields) ? src.yields : {};
  const clue = typeof yields.clue === "string" ? yields.clue.trim() : "";
  const turns = figure(src.turns);
  return {
    check: Object.values(CHECK).includes(src.check) ? src.check : CHECK.INSPECT,
    capability: typeof src.capability === "string" && src.capability.trim() ? src.capability.trim() : null,
    anyone: src.anyone === true,
    tools: strings(src.tools),
    turns: turns !== null && turns > 0 ? turns : null,
    yields: {
      lots: strings(yields.lots),
      clue: clue || null,
      reveal: strings(yields.reveal).filter((key) => REVEAL_PREFIXES.some((p) => key.startsWith(p) && key.length > p.length)),
    },
  };
}

/** A layer normalizer for `normalizeThings`: authored keys over the thing's kind default. */
const sceneLayer = (raw, name, thing) => normalizeLayer(raw, defaultLayer(thing.kind, name));

/** The place's stored list in its signed shape, every layer normalized over its kind's default. */
export function normalizeSceneThings(list) {
  return normalizeThings(list, { layer: sceneLayer });
}

/** One thing as an entry: both layers present (authored over the kind's default), plus `key` and `source`. */
function toEntry(thing, source, key) {
  const layers = {};
  for (const name of LAYER_NAMES) layers[name] = normalizeLayer(thing.layers[name] ?? {}, defaultLayer(thing.kind, name));
  return { ...thing, key, source, layers };
}

/** Raw derived rows, keyed and shaped as things of one kind; a row with no id is skipped. */
function derivedEntries(rows, kind, source, prefix, adjust = (row) => row) {
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!isPlain(row) || row.id === undefined || row.id === null || !String(row.id).trim()) continue;
    const thing = normalizeThing({ ...adjust(row), id: String(row.id).trim(), kind }, { layer: sceneLayer });
    if (thing) out.push(toEntry(thing, source, `${prefix}${thing.id}`));
  }
  return out;
}

/**
 * Every inspectable at a place, one entry each: the place's things
 * (`thing:<id>`), its doors (`wall:<id>`, hidden as the row says), the
 * old-style trap zones and walls (`trap:<id>`, hidden unless `known`) and a
 * fight's bodies (`body:<id>`). The derived inputs arrive as arguments and may
 * carry `layers`, `state`, `hint`, `point` and `ref` like a thing.
 *
 * @param {object} inputs
 * @param {object[]} [inputs.things] the place's stored list
 * @param {object[]} [inputs.doors] `{id, hidden, point, …}` read off the walls
 * @param {object[]} [inputs.oldTraps] `{id, known, point, …}`
 * @param {object[]} [inputs.bodies] `{id, point, state, layers, …}` from the fight's record
 */
export function sceneEntries({ things = [], doors = [], oldTraps = [], bodies = [] } = {}) {
  return [
    ...normalizeSceneThings(things).map((thing) => toEntry(thing, "thing", `thing:${thing.id}`)),
    ...derivedEntries(doors, "exit", "door", "wall:"),
    ...derivedEntries(oldTraps, "trap", "oldTrap", "trap:", (row) => ({ ...row, hidden: row.known !== true })),
    ...derivedEntries(bodies, "body", "body", "body:"),
  ];
}

/* -------------------------------------------- */
/*  Runtime reads                                */
/* -------------------------------------------- */

/** An entry's runtime record of one layer, every key present. */
export function layerState(entry, name) {
  const raw = entry?.state?.layers?.[name];
  const held = isPlain(raw) ? raw : {};
  return {
    ...held,
    done: held.done === true,
    by: strings(held.by),
    found: held.found === true,
    failed: isPlain(held.failed) ? held.failed : {},
    progress: figure(held.progress) ?? 0,
  };
}

/* -------------------------------------------- */
/*  What a seat sees                             */
/* -------------------------------------------- */

/** Does a layer of another entry that is not yet found name this one in its reveal? */
function namedByUnsolvedClue(entry, entries) {
  return entries.some(
    (other) =>
      other.key !== entry.key &&
      LAYER_NAMES.some((name) => other.layers[name].yields.reveal.includes(entry.key) && !layerState(other, name).found),
  );
}

/**
 * Do players see this entry? A plain entry always; a hidden one once it is
 * shown (`state.shown`), by the Judge or by the check that revealed it.
 */
export function isVisible(entry) {
  return !entry.hidden || entry.state?.shown === true;
}

/** Does this entry hide behind a clue not yet solved: hidden, unshown, and named by a layer not yet found? */
export function behindClue(entry, entries) {
  return !isVisible(entry) && namedByUnsolvedClue(entry, entries);
}

/**
 * The keys of the entries a found check shows: those its `reveal` names that
 * are in the scene, hidden and not yet shown. The writer sets `state.shown`
 * on each, in the same write that records the check.
 */
export function revealedKeys(outcome, entries) {
  if (outcome?.code !== CODE.FOUND) return [];
  return (outcome.reveal ?? []).filter((key) => entries.some((e) => e.key === key && !isVisible(e)));
}

/**
 * The entries a seat sees. The Judge sees every one. A player does not see a
 * hidden entry the Judge has not shown, and so does not see an entry that
 * hides behind an unsolved clue: both are absent, not marked.
 */
export function seatView(entries, { isGM = false } = {}) {
  const all = Array.isArray(entries) ? entries : [];
  return isGM ? all.slice() : all.filter((entry) => isVisible(entry));
}

/**
 * What a player is shown of the entries `seatView` lets through: every entry
 * with `more` (the kinds still unfound, from `remainingKinds`) and
 * `moreRemains` computed over the WHOLE scene first, and then each unfound
 * layer's `yields` emptied, so the lots, clue and reveal it holds are never in
 * what the table reads. A found layer keeps what it yielded. The Judge's hint
 * is shown only while something more remains. A new list, the input untouched.
 *
 * @param {object[]} entries every entry of the scene, the Judge's view
 * @returns {object[]}
 */
export function playerView(entries) {
  const all = Array.isArray(entries) ? entries : [];
  return seatView(all, { isGM: false }).map((entry) => {
    const more = remainingKinds(entry, all);
    const layers = {};
    for (const name of LAYER_NAMES) {
      const layer = entry.layers[name];
      layers[name] = layerState(entry, name).found ? layer : { ...layer, yields: { lots: [], clue: null, reveal: [] } };
    }
    return { ...entry, layers, hint: more.length ? entry.hint : null, more, moreRemains: more.length > 0 };
  });
}

/**
 * The entries a seat reads: the Judge's own, each with `more` and
 * `moreRemains`, or a player's through `playerView`.
 */
export function sceneView(entries, { isGM = false } = {}) {
  if (!isGM) return playerView(entries);
  const all = Array.isArray(entries) ? entries : [];
  return all.map((entry) => {
    const more = remainingKinds(entry, all);
    return { ...entry, more, moreRemains: isVisible(entry) && more.length > 0 };
  });
}

/**
 * The kinds of thing still unfound on an entry, from `MORE`: `lots` and
 * `clue` where an unfound layer yields them, `reveal` where it names a thing
 * players cannot see yet. A found layer contributes nothing. `skip` names
 * layers to count as found (the check being answered).
 */
export function remainingKinds(entry, entries, { skip = [] } = {}) {
  const kinds = new Set();
  for (const name of LAYER_NAMES) {
    if (skip.includes(name) || layerState(entry, name).found) continue;
    const { lots, clue, reveal } = entry.layers[name].yields;
    if (lots.length) kinds.add(MORE.LOTS);
    if (clue) kinds.add(MORE.CLUE);
    if (reveal.some((key) => entries.some((other) => other.key === key && !isVisible(other)))) kinds.add(MORE.REVEAL);
  }
  return [...kinds];
}

/**
 * The public GUMSHOE mark: does more remain on this entry? True when a layer
 * of a visible entry still holds something unfound. What hides behind an
 * unsolved clue marks the clue in front of it (that entry's `reveal`), and
 * carries no mark of its own: an entry players cannot see answers false.
 */
export function moreRemains(entry, entries) {
  return isVisible(entry) && remainingKinds(entry, entries).length > 0;
}

/* -------------------------------------------- */
/*  Who may attempt what                         */
/* -------------------------------------------- */

/** The party token's distance to the entry past the reach, or null when it is within reach or cannot be measured. */
function beyondReach(entry, ctx) {
  const reach = figure(ctx.searchReachFeet);
  const perPixel = figure(ctx.feetPerPixel);
  const from = ctx.partyPoint;
  if (reach === null || perPixel === null || !entry.point || !isPlain(from)) return null;
  const dx = Number(from.x) - entry.point.x;
  const dy = Number(from.y) - entry.point.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  const distanceFeet = Math.hypot(dx, dy) * perPixel;
  return distanceFeet > reach ? { distanceFeet, reachFeet: reach } : null;
}

/** The throw target the context states for a layer's check, or null. */
function targetOf(layer, name, ctx) {
  const figures = ctx.figures ?? {};
  if (layer.check === CHECK.SKILL) return figure(figures.skillTargets?.[layer.capability]);
  return figure(name === LAYER.HASTY ? figures.hastyTarget : figures.methodicalTarget);
}

/**
 * What one member may do at one check of one entry: `{layer, check, mode,
 * refusal, …}`. `mode` is `inspect` (no throw), `search` or `skill` (a throw,
 * with its `target` and, for the holder of the searching capability, the
 * `bonus`), or `vague` (a hasty check by a member without the capability: no
 * throw, only the hint that something more is here). A refusal is a `scene:`
 * code with its data.
 */
function planLayer(entry, name, member, ctx) {
  const layer = entry.layers[name];
  const state = layerState(entry, name);
  const capabilities = strings(member?.capabilities);
  const plan = { layer: name, check: layer.check, mode: layer.check, capability: layer.capability, tools: layer.tools, turns: layer.turns, target: null, bonus: null, refusal: null };
  const refuse = (code, data = {}) => ({ ...plan, refusal: code, data });

  if (layer.check === CHECK.SKILL && !layer.capability) return refuse(REFUSAL.SKILL_UNNAMED);
  if (state.found) return refuse(REFUSAL.ALREADY_FOUND);
  if (name === LAYER.HASTY && repeatLocked(state.failed, member?.id, member?.level)) return refuse(REFUSAL.HASTY_LOCKED);
  const far = beyondReach(entry, ctx);
  if (far) return refuse(REFUSAL.OUT_OF_REACH, far);

  const needed = layer.check === CHECK.SKILL ? layer.capability : layer.check === CHECK.SEARCH ? (layer.capability ?? (name === LAYER.HASTY ? CAPABILITY.SEARCHING : null)) : null;
  const holds = needed === null || capabilities.includes(needed);
  if (!holds) {
    if (name === LAYER.METHODICAL) return refuse(REFUSAL.CAPABILITY_MISSING, { capability: needed });
    // A hasty check without the capability: a search the layer opens to anyone is a throw, anything else is the hint alone.
    if (!(layer.check === CHECK.SEARCH && layer.anyone)) return { ...plan, mode: "vague" };
  }

  const missing = layer.tools.filter((uuid) => !strings(member?.tools).includes(uuid));
  if (missing.length) return refuse(REFUSAL.TOOL_MISSING, { missing });

  if (layer.check !== CHECK.INSPECT) {
    plan.target = targetOf(layer, name, ctx);
    if (plan.target === null) return refuse(REFUSAL.NOT_IMPORTED);
    if (holds && needed === CAPABILITY.SEARCHING) plan.bonus = figure(ctx.figures?.searchBonus);
  }
  return plan;
}

/**
 * The checks one member may attempt at an entry: one option per layer (hasty,
 * then methodical), each with its `refusal` null or a `scene:` code. A hasty
 * failure locks the character at that spot until they gain a level; a
 * methodical check may be repeated; a thing with a point is in reach when the
 * party token is within `searchReachFeet` of it, and with no point, no reach
 * imported or no position to measure from, reach is the Judge's call.
 *
 * @param {object} entry
 * @param {object} member `{id, level, capabilities: string[], tools: string[]}`
 * @param {object} ctx
 * @param {object[]} [ctx.entries]
 * @param {number|null} [ctx.searchReachFeet] the imported reach
 * @param {{x: number, y: number}|null} [ctx.partyPoint] the party token's position
 * @param {number|null} [ctx.feetPerPixel] the scene's scale
 * @param {object} [ctx.figures] `{hastyTarget, methodicalTarget, searchBonus, skillTargets: {capability: target}}`
 */
export function layerOptions(entry, member, ctx = {}) {
  return LAYER_NAMES.map((name) => planLayer(entry, name, member, ctx));
}

/** Why this member cannot attempt this check, as `{refusal, …}`, or null when they may. */
export function layerRefusal(entry, name, member, ctx = {}) {
  const plan = planLayer(entry, name, member, ctx);
  return plan.refusal ? { refusal: plan.refusal, ...plan.data } : null;
}

/* -------------------------------------------- */
/*  What a check answers                         */
/* -------------------------------------------- */

/**
 * What one member's check at one layer answers, as a code plus data:
 *
 * - `scene:found` with the layer's `lots`, `clue` and `reveal`, when the check
 *   is passed and the layer yields something;
 * - `scene:foundNothing` when it fails, or passes with nothing to yield. A
 *   failed hasty search carries `locks: true`;
 * - `scene:vague` for a member without the capability when something is
 *   unfound on the entry, `scene:foundNothing` when nothing is;
 * - `scene:needsRoll` when a thrown check arrives without its result.
 *
 * Both carry `more`: the kinds still unfound (`lots`, `clue`, `reveal`), never
 * the thing, so the table knows what sort of thing it has not found. A refused
 * check answers `{refusal, …}` and nothing else.
 *
 * @param {object} entry
 * @param {string} name `hasty` or `methodical`
 * @param {object} member as `layerOptions`
 * @param {object} ctx as `layerOptions`, with `entries` the whole scene
 * @param {{passed: boolean}|null} [roll] the throw's result for a `search` or `skill` check
 */
export function outcomeOf(entry, name, member, ctx = {}, roll = null) {
  const plan = planLayer(entry, name, member, ctx);
  if (plan.refusal) {
    return { refusal: plan.refusal, layer: name, ...plan.data };
  }
  const entries = ctx.entries ?? [entry];
  if (plan.mode === "vague") {
    const present = remainingKinds(entry, entries).length > 0;
    return { code: present ? CODE.VAGUE : CODE.FOUND_NOTHING, layer: name, more: [] };
  }
  if (plan.mode !== CHECK.INSPECT && typeof roll?.passed !== "boolean") return { code: CODE.NEEDS_ROLL, layer: name };

  const passed = plan.mode === CHECK.INSPECT ? true : roll.passed;
  const { lots, clue, reveal } = entry.layers[name].yields;
  if (passed && (lots.length || clue || reveal.length)) {
    return { code: CODE.FOUND, layer: name, lots: [...lots], clue, reveal: [...reveal], more: remainingKinds(entry, entries, { skip: [name] }) };
  }
  return {
    code: CODE.FOUND_NOTHING,
    layer: name,
    ...(passed ? {} : { failed: true, locks: name === LAYER.HASTY }),
    more: remainingKinds(entry, entries),
  };
}

/**
 * The entry's `state` after one member's check: a NEW state, the input
 * untouched, every key it does not own kept. The layer is `done` and the
 * member is in `by`; `found` turns true on `scene:found` and stays; a failure
 * that `locks` stores the member's level in `failed` (the hasty lock). A
 * refusal or a missing throw changes nothing.
 */
export function recordOutcome(state, name, member, outcome) {
  const base = isPlain(state) ? structuredClone(state) : {};
  if (!outcome?.code || outcome.code === CODE.NEEDS_ROLL) return base;
  const prior = layerState({ state: base }, name);
  base.layers = {
    ...(isPlain(base.layers) ? base.layers : {}),
    [name]: {
      ...prior,
      done: true,
      by: strings([...prior.by, member?.id]),
      found: prior.found || outcome.code === CODE.FOUND,
      failed: outcome.locks ? lockAfterFailure(prior.failed, member?.id, member?.level) : prior.failed,
    },
  };
  return base;
}
