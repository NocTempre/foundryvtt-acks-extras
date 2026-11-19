/* global game, fromUuidSync */
/**
 * Scene search's turn-plan activities and the resolution behind them. A member
 * is ASSIGNED to a check by locking a plan entry: `sceneHasty` (a round,
 * `length: "round"`, one turn on the plan) or `sceneMethodical` (a turn), whose
 * option id is the entry's key. The registry carries that and nothing else; this
 * file decides what each member may attempt (`layerOptions`, `layerRefusal`) and
 * what the check does when it resolves.
 *
 * Resolving rolls the member for themself, secretly: the target is the member's
 * own party-check target (`resolveCheck`), the die is `rollCheckFor`'s, and the
 * result goes to the Judges' card, never the table's log. `applyCheck` turns the
 * answer into the entry's next state, which is written to where the entry keeps
 * it; a found check then marks its lots on the scene's pot, shows the entries it
 * reveals and tells the map about a hidden exit.
 *
 * The party-check functions arrive through `configureSceneChecks`, since they
 * live with the formation's whole roll machinery and a suite supplies its own.
 */
import { hasCapability } from "../lib/capabilities.mjs";
import { registerTurnActivity } from "../lib/turn-activities.mjs";
import { isHurried } from "../formation/formation-model.mjs";
import { CAPABILITY, CHECK, CODE, LAYER, LAYER_OF_ACTIVITY, REFUSAL, SESSION_REFUSAL } from "./constants.mjs";
import { layerOptions, layerRefusal, seatView } from "./scene-logic.mjs";
import { applyCheck, capabilitiesWanted, logRowOf } from "./session-logic.mjs";
import { logCheck, readWorld, reachContext, toolsOf, writeEntryState } from "./session.mjs";
import { markSceneFound } from "./haul.mjs";
import { revealExit } from "./seams.mjs";

const LANG_ACTIVITY = "ACKS-LOCATION.sceneSearch.activity.";

/** The party-check seams: `{PARTY_CHECKS, resolveCheck, rollCheckFor}`, `postRoll(card)` for the Judges' card, and `reveal` for `revealSecretDoor`. */
const seams = { checks: null, postRoll: null, reveal: null, pot: null };

/**
 * Supply what resolution needs from outside this feature. Called once at init
 * (and by a suite with its own).
 * @param {object} deps
 * @param {{PARTY_CHECKS: object, resolveCheck: Function, rollCheckFor: Function}} deps.checks `formation/party-rolls.mjs`
 * @param {(card: {formation: object, actor: object, key: string, layer: string, rolled: object|null, outcome: object}) => *} [deps.postRoll] posts the Judges' card
 * @param {((wall: object) => *)|null} [deps.reveal] `revealSecretDoor`, once it exists
 * @param {((uuid: string) => object|null)|null} [deps.pot] finds a pot pile by uuid (`fromUuidSync` by default)
 */
export function configureSceneChecks({ checks, postRoll = null, reveal = null, pot = null }) {
  seams.checks = checks;
  seams.postRoll = postRoll;
  seams.reveal = reveal;
  seams.pot = pot;
}

/** The ad hoc party-check config for a named capability's skill check: it matches the capability and nothing by name, and allows no Adventuring stand-in. */
const skillConfig = (capability) => ({ flagKey: capability, capability, advKey: null, pattern: /(?!)/, label: "", rollKey: null });

/** A party check's resolved target for a member, or null where there is none (or the resolver throws). */
function targetOf(actor, cfg) {
  try {
    return seams.checks.resolveCheck(actor, cfg)?.target ?? null;
  } catch {
    return null;
  }
}

/** Does the member hold the searching capability the way the party's own hasty search reads it: a skilled throw, never a stand-in? */
const holdsSearching = (actor) => {
  try {
    return !!seams.checks.resolveCheck(actor, seams.checks.PARTY_CHECKS.searchHasty);
  } catch {
    return false;
  }
};

/**
 * One member as `layerOptions` reads them: `{id, level, capabilities, tools}`,
 * with `capabilities` holding only the tokens these entries can ask for.
 */
export function memberOf(actor, entries) {
  const capabilities = capabilitiesWanted(entries).filter((token) => (token === CAPABILITY.SEARCHING ? holdsSearching(actor) : hasCapability(actor, token)));
  return { id: actor.id, level: Number(actor.system?.details?.level) || 1, capabilities, tools: toolsOf(actor) };
}

/** The member's own throw targets for these entries, from the party-check config; the thief's bonus is already inside a target, so `searchBonus` stays null. */
function figuresOf(actor, entries) {
  const { PARTY_CHECKS } = seams.checks;
  const skillTargets = {};
  for (const token of capabilitiesWanted(entries)) if (token !== CAPABILITY.SEARCHING) skillTargets[token] = targetOf(actor, skillConfig(token));
  return {
    hastyTarget: targetOf(actor, PARTY_CHECKS.searchHasty),
    methodicalTarget: targetOf(actor, PARTY_CHECKS.searchMethodical),
    searchBonus: null,
    skillTargets,
  };
}

/** `layerOptions`' context for a member at the session's entries. */
function contextOf(formation, world, actor) {
  return { entries: world.entries, ...reachContext(formation, world.session), figures: figuresOf(actor, world.entries) };
}

/** The party-check config an entry's layer rolls: the layer's own skill, else the party's hasty or methodical search. */
function rollConfigOf(layer, name) {
  const { PARTY_CHECKS } = seams.checks;
  if (layer.check === CHECK.SKILL) return skillConfig(layer.capability);
  return name === LAYER.HASTY ? PARTY_CHECKS.searchHasty : PARTY_CHECKS.searchMethodical;
}

/**
 * What one member may attempt at every entry the seat can see, for a screen:
 * `[{key, layers: [{layer, mode, refusal, ...}]}]`, `layerOptions`' own rows. The
 * Judge sees every entry; a player sees what `seatView` lets through. A party
 * with no session open offers nothing.
 * @returns {Array<{key: string, layers: object[]}>}
 */
export function sceneOptionsFor(formation, actor, { isGM = !!game.user?.isGM } = {}) {
  const world = readWorld(formation);
  if (!world) return [];
  const member = memberOf(actor, world.entries);
  const ctx = contextOf(formation, world, actor);
  return seatView(world.entries, { isGM }).map((entry) => ({ key: entry.key, layers: layerOptions(entry, member, ctx) }));
}

/**
 * Resolve one member's check at one layer of one entry: roll if it needs a
 * throw, apply the answer, write the entry's state, mark the lots it finds,
 * show what it reveals, log it and post the Judges' card. A refusal writes and
 * rolls nothing.
 *
 * @param {object} args
 * @param {object} args.formation
 * @param {object} args.actor the searcher
 * @param {string} args.key the entry's key
 * @param {string} args.layer `hasty` or `methodical`
 * @returns {Promise<{ok: true, outcome: object, lots: {ids: string[], missing: string[]}|null}|{ok: false, reason: string, outcome?: object}>}
 */
export async function resolveSceneCheck({ formation, actor, key, layer }) {
  if (!game.user?.isGM) return { ok: false, reason: SESSION_REFUSAL.NOT_ALLOWED };
  const world = readWorld(formation);
  if (!world) return { ok: false, reason: SESSION_REFUSAL.NO_SESSION };
  const entry = world.entries.find((e) => e.key === key);
  if (!entry) return { ok: false, reason: SESSION_REFUSAL.UNKNOWN_ENTRY };
  const member = memberOf(actor, world.entries);
  const ctx = contextOf(formation, world, actor);

  let roll = null;
  let rolled = null;
  const asked = applyCheck({ entries: world.entries, key, layer, member, ctx, roll: null });
  if (asked.outcome.refusal) return { ok: false, reason: asked.outcome.refusal, outcome: asked.outcome };
  if (asked.outcome.code === CODE.NEEDS_ROLL) {
    rolled = await seams.checks.rollCheckFor(actor, rollConfigOf(entry.layers[layer], layer));
    if (!rolled) return { ok: false, reason: REFUSAL.NOT_IMPORTED };
    roll = { passed: rolled.row.success === true };
  }
  const applied = roll ? applyCheck({ entries: world.entries, key, layer, member, ctx, roll }) : asked;
  const { outcome } = applied;

  await writeEntryState(formation, entry, applied.patch);
  for (const shownKey of applied.shown) {
    const other = world.entries.find((e) => e.key === shownKey);
    if (other) await writeEntryState(formation, other, { shown: true });
  }
  let lots = null;
  if (applied.lots.length && world.session.potUuid) {
    const pile = (seams.pot ?? defaultPot)(world.session.potUuid);
    if (pile) {
      const marked = await markSceneFound(pile, outcome);
      lots = marked.ok ? { ids: marked.ids, missing: marked.missing } : null;
    }
  }
  const scene = world.session.sceneId ? game.scenes?.get(world.session.sceneId) : null;
  for (const wallId of applied.walls) await revealExit(scene, wallId, { reveal: seams.reveal });
  await logCheck(formation, logRowOf({ member, key, layer, outcome }));
  await seams.postRoll?.({ formation, actor, key, layer, rolled, outcome });
  return { ok: true, outcome, lots };
}

/** A pot pile by uuid, from the world. */
const defaultPot = (uuid) => {
  try {
    return fromUuidSync(uuid, { strict: false }) ?? null;
  } catch {
    return null;
  }
};

/** The length in whole turns: a hasty check is one, a methodical check its layer's authored turns, else one. */
const turnsOf = (layer, name) => (name === LAYER.HASTY ? 1 : (layer.turns ?? 1));

/** The registry's reason for a refusal: the `scene:` code and what the member lacks. */
function blockedOf(formation, actor, optionId, name) {
  const world = readWorld(formation);
  if (!world) return { reason: SESSION_REFUSAL.NO_SESSION, missing: [] };
  const entry = world.entries.find((e) => e.key === optionId);
  if (!entry) return { reason: SESSION_REFUSAL.UNKNOWN_ENTRY, missing: [] };
  if (name === LAYER.HASTY && entry.layers.hasty.check === CHECK.SEARCH && isHurried(formation)) return { reason: "hurried", missing: [] };
  const refused = layerRefusal(entry, name, memberOf(actor, world.entries), contextOf(formation, world, actor));
  return refused ? { reason: refused.refusal, missing: refused.missing ?? [] } : null;
}

/**
 * Register `sceneHasty` and `sceneMethodical` with the turn plan's registry.
 * Called once at init on every client: the column and a player's own refusal
 * read them where the plan is shown.
 * @returns {() => void} unregisters both
 */
export function registerSceneActivities() {
  const off = Object.entries(LAYER_OF_ACTIVITY).map(([activity, name]) =>
    registerTurnActivity({
      key: activity,
      pace: name === LAYER.HASTY ? "hasty" : "methodical",
      length: name === LAYER.HASTY ? "round" : "turn",
      label: `${LANG_ACTIVITY}${name}`,
      options: (_actor, ctx) => {
        const world = ctx?.formation ? readWorld(ctx.formation) : null;
        return world ? seatView(world.entries, { isGM: !!game.user?.isGM }).map((entry) => ({ id: entry.key })) : [];
      },
      turns: (_actor, option, ctx) => {
        const entry = ctx?.formation ? readWorld(ctx.formation)?.entries.find((e) => e.key === option?.id) : null;
        return entry ? turnsOf(entry.layers[name], name) : null;
      },
      blocked: (actor, option, ctx) => (ctx?.formation ? blockedOf(ctx.formation, actor, option?.id, name) : { reason: SESSION_REFUSAL.NO_SESSION, missing: [] }),
      resolve: (actor, option, ctx) => resolveSceneCheck({ formation: ctx.formation, actor, key: option.id, layer: name }),
    }),
  );
  return () => off.forEach((fn) => fn());
}
