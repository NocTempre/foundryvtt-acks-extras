/* global CONFIG, CONST, Hooks, game, foundry, fromUuidSync, ui */
/**
 * A live reach, as core keeps it: a Region attached to its bearer's token that
 * carries an `aura` behavior, so core's containment is the membership, the
 * region moves with the token, hides with it and is deleted with it. The module
 * writes the behavior sub-type and the filter (`aura-reach-logic.mjs`); it
 * computes no geometry and keeps no list of who is inside.
 *
 * - `registerAuraReach` registers the sub-type at `init`.
 * - `raiseReach` / `lowerReach` create and delete the attached Region through
 *   core's `createTokenEmanation`; a Player's seat relays them to the primary GM
 *   (`sockets.mjs`), who resolves the radius from the item's own row.
 * - Core's region events and lib's `TURN_BEGAN_HOOK` reach `dispatchReachMoment`
 *   on the primary GM alone, which asks `reachAdmits` and hands the moment to
 *   the one registered handler (`setReachHandler`): the item runner's.
 * - The one teardown is the Region's deletion (`setReachTeardown`): every
 *   record carrying the Region's activation id goes with it. A bearer whose hit
 *   points reach zero, or that takes the defeated status, has its reaches
 *   deleted (`lowerForBearer`) and `BEARER_DOWN_HOOK` fires.
 * - `reachSnapshot` answers which tokens an area contains at this moment, for a
 *   reach that acts once, against an unsaved Region.
 *
 * Everything that acts runs only where `isPrimaryGM()` holds: core dispatches
 * region events on every GM client. A behavior a hand made holds an empty
 * config and does nothing.
 */
import { AURA_BEHAVIOR_TYPE, BEARER_DOWN_HOOK, MODULE_ID, LANG_PREFIX, TURN_BEGAN_HOOK } from "./constants.mjs";
import { carriesItem, checkRaise, downCause, figureNumber, readAuraConfig, readReach, reachAdmits, snapshotRegionData } from "./aura-reach-logic.mjs";
import { itemRunRowsOf } from "./item-run-logic.mjs";
import { behaviorsUnder } from "./regions.mjs";
import { executeAsGM, registerHandler } from "./sockets.mjs";
import { tokenHasStatus, tokenHitPoints } from "./hp-logic.mjs";
import { STATUS_DEAD } from "./status-effects.mjs";
import { isPrimaryGM, makeLoc } from "./util.mjs";
import { isMarkerActor } from "./place.mjs";
import { feetToUnits } from "./distance-units.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The socket handlers a Player's seat relays a raise and a lower through. */
const HANDLER = Object.freeze({ raise: `${MODULE_ID}.aura.raise`, lower: `${MODULE_ID}.aura.lower` });

/** The one handler a moment reaches, set by the item runner, and the one teardown. */
let momentHandler = null;
let teardownHandler = null;

/**
 * Register the handler a reach's moment goes to: `fn(context)` with
 * `{moment, config, item, row, reach, bearer, subject, admitted, region}`. One
 * handler; a call replaces it, and a non-function clears it.
 * @param {Function|null} fn
 */
export function setReachHandler(fn) {
  momentHandler = typeof fn === "function" ? fn : null;
}

/**
 * Register the teardown a deleted reach runs: `fn({config, region})` lifts every
 * record carrying the config's activation id. One teardown; a non-function clears it.
 * @param {Function|null} fn
 */
export function setReachTeardown(fn) {
  teardownHandler = typeof fn === "function" ? fn : null;
}

/** The core features a reach is built from, read off the running build. */
function foundryEnv() {
  const RegionClass = globalThis.CONFIG?.Region?.documentClass;
  return {
    attachment: !!RegionClass?.schema?.fields?.attachment?.fields?.token,
    emanation: typeof globalThis.foundry?.data?.EmanationShapeData === "function",
    creator: typeof RegionClass?.createTokenEmanation === "function",
  };
}

/**
 * Whether this build of core has what a reach is made of: a Region that attaches
 * to a token, the emanation shape and `createTokenEmanation`. Where any is
 * absent, raising refuses, since the module neither computes a moving area nor
 * writes a Region that stands still while its bearer walks.
 *
 * @param {{attachment: boolean, emanation: boolean, creator: boolean}} [env]
 * @returns {{ok: boolean, missing: string[]}}
 */
export function auraSupport(env = foundryEnv()) {
  const missing = [];
  if (!env.attachment) missing.push("attachment.token");
  if (!env.emanation) missing.push("emanation");
  if (!env.creator) missing.push("createTokenEmanation");
  return { ok: !missing.length, missing };
}

/* -------------------------------------------- */
/*  The behavior sub-type                        */
/* -------------------------------------------- */

/** The behavior class, built when asked so a Node import needs no `foundry`. */
function buildAuraBehavior() {
  const { RegionBehaviorType } = foundry.data.regionBehaviors;
  const fields = foundry.data.fields;
  const text = () => new fields.StringField({ required: false, blank: true, initial: "" });
  const on = (moment) =>
    async function onRegionEvent(event) {
      if (!isPrimaryGM()) return;
      await dispatchReachMoment(this, moment, event?.data?.token);
    };
  /**
   * "ACKS Item Reach": config only, written by the item runner. It holds the
   * source item's uuid, the bearer actor's uuid, the activation id and the row's
   * key; the radius, filter and pulse are read live from the row.
   */
  return class AuraBehavior extends RegionBehaviorType {
    static LOCALIZATION_PREFIXES = [`${LANG_PREFIX}.AURA`];

    static defineSchema() {
      return { sourceUuid: text(), bearerUuid: text(), activationId: text(), rowKey: text() };
    }

    static events = {
      [CONST.REGION_EVENTS.TOKEN_ENTER]: on("enter"),
      [CONST.REGION_EVENTS.TOKEN_MOVE_IN]: on("moveIn"),
      [CONST.REGION_EVENTS.TOKEN_EXIT]: on("exit"),
    };
  };
}

/** Register the `aura` behavior sub-type, at `init`, in formation's guarded form. */
export function registerAuraReach() {
  if (!CONFIG?.RegionBehavior?.dataModels) return;
  CONFIG.RegionBehavior.dataModels[AURA_BEHAVIOR_TYPE] = buildAuraBehavior();
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[AURA_BEHAVIOR_TYPE] = "fa-solid fa-circle-dot";
}

/* -------------------------------------------- */
/*  A moment reaching a subject                  */
/* -------------------------------------------- */

/** A token's actor and itself as the reader takes them. */
const bodyOf = (token) => ({ token, actor: token?.actor ?? null });

/**
 * One moment of one subject against one `aura` behavior: read its config, the
 * item and the row it names, the reach, and whether the subject is one of the
 * filter's, then hand all of it to the registered handler. A behavior with an
 * empty config, a source that is gone or a row with no reach does nothing.
 *
 * @param {object} system the behavior's system data
 * @param {string} moment `enter`, `moveIn`, `exit` or `turnStart`
 * @param {TokenDocument} subjectToken
 */
export async function dispatchReachMoment(system, moment, subjectToken) {
  const config = readAuraConfig(system);
  if (!config || !subjectToken || !momentHandler) return;
  const region = system?.region ?? system?.parent?.region ?? null;
  const item = fromUuidSync(config.sourceUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === config.rowKey);
  const reach = readReach(row?.reach);
  if (!reach) return;
  const bearerToken = region?.parent?.tokens?.get?.(region.attachment?.token) ?? null;
  if (!bearerToken) return;
  const bearer = bodyOf(bearerToken);
  const subject = bodyOf(subjectToken);
  const admitted = reachAdmits(bearer, subject, reach.filter, { isMarker: isMarkerActor });
  try {
    await momentHandler({ moment, config, item, row, reach, bearer, subject, admitted, region });
  } catch (err) {
    console.error(`${MODULE_ID} | a reach's ${moment} could not be run`, err);
  }
}

/** A turn began: every reach the combatant's token stands in hears it. */
async function onTurnBegan(combat, combatantId) {
  if (!isPrimaryGM()) return;
  const token = combat?.combatants?.get?.(combatantId)?.token ?? null;
  if (!token) return;
  for (const { behavior } of behaviorsUnder(token, AURA_BEHAVIOR_TYPE)) await dispatchReachMoment(behavior.system, "turnStart", token);
}

/* -------------------------------------------- */
/*  Raising and lowering                         */
/* -------------------------------------------- */

/** The aura behaviors of a Region, as their configs. */
const auraConfigsOf = (region) => [...(region?.behaviors ?? [])].filter((b) => b.type === AURA_BEHAVIOR_TYPE).map((b) => readAuraConfig(b.system)).filter(Boolean);

/** Whether a Region is a reach (it holds an aura behavior, config or not). */
const isReach = (region) => [...(region?.behaviors ?? [])].some((b) => b.type === AURA_BEHAVIOR_TYPE);

/** The user ids that own a document. */
const ownersOf = (doc) => (game.users ?? []).filter((u) => doc?.testUserPermission?.(u, "OWNER")).map((u) => u.id);

/** A Judge's whispered line, or a notification, for a refusal. */
function say(reason, { judge }) {
  const text = loc(`aura.refused.${reason}`);
  (judge ? ui.notifications?.warn : ui.notifications?.error)?.call(ui.notifications, text);
}

/** Whether a token's bearer is down (hit points at or below zero, or the defeated status). */
function bearerDown(token) {
  const defeated = globalThis.CONFIG?.specialStatusEffects?.DEFEATED ?? STATUS_DEAD;
  return downCause({ hp: tokenHitPoints(token, token.baseActor)?.value ?? null, defeated: tokenHasStatus(token, token.baseActor, defeated) });
}

/**
 * The raise itself, on the primary GM's window: check the request against what
 * is live, then create the Region through core's `createTokenEmanation`, grid
 * based, hidden as the token is, GM-visible, holding the `aura` behavior.
 * The reach is stored in feet and core takes the scene's own units, so the
 * range goes through `feetToUnits` first.
 */
async function raiseHere({ tokenUuid, sourceUuid, rowKey, activationId, requestUserId = null }) {
  const token = fromUuidSync(tokenUuid);
  const item = fromUuidSync(sourceUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  const reach = readReach(row?.reach);
  const support = auraSupport();
  const verdict = checkRaise(
    { requestUserId },
    {
      supported: support.ok,
      found: !!token && !!item && !!reach,
      ownerIds: ownersOf(token),
      carries: carriesItem(item?.actor, token),
      down: token ? !!bearerDown(token) : false,
      rangeFeet: reach ? figureNumber(reach.radius) : null,
    },
  );
  if (!verdict.ok) {
    say(verdict.reason, { judge: !requestUserId });
    return { ok: false, reason: verdict.reason, missing: support.ok ? [] : support.missing };
  }
  if (verdict.warn) say("downWarn", { judge: true });
  const behavior = { type: AURA_BEHAVIOR_TYPE, name: item.name, system: { sourceUuid, bearerUuid: item.actor.uuid, activationId, rowKey } };
  const region = await CONFIG.Region.documentClass.createTokenEmanation(
    token,
    feetToUnits(verdict.rangeFeet, token.parent?.grid?.units),
    { name: item.name, hidden: token.hidden, visibility: CONST.REGION_VISIBILITY.GAMEMASTER, behaviors: [behavior] },
    { gridBased: true },
  );
  return { ok: true, regionId: region?.id ?? null, regionUuid: region?.uuid ?? null };
}

/**
 * Raise a reach on a bearer's token: one attached Region for one row of the
 * item, whose radius is that row's figure read now. The primary GM's window
 * runs it; a Player's seat relays the names (never a radius) and the GM resolves
 * the rest. Refuses, with a line to the seat, where the build lacks what a
 * reach is made of, the token is not the item's bearer's, the radius is blank,
 * or the bearer is down (a Judge is warned and goes on).
 *
 * @param {{tokenUuid: string, sourceUuid: string, rowKey: string, activationId: string}} p
 * @returns {Promise<{ok: boolean, reason?: string, regionId?: string}>}
 */
export async function raiseReach(p) {
  if (game.user.isGM) return raiseHere(p);
  return (await executeAsGM(HANDLER.raise, p)) ?? { ok: false, reason: "relay" };
}

/** The Regions attached to a token that hold an aura behavior, optionally of one activation. */
function reachesOf(token, activationId) {
  return [...(token?.attachments?.regions ?? [])].filter((region) => isReach(region) && (!activationId || auraConfigsOf(region).some((c) => c.activationId === activationId)));
}

/** Regions already being deleted, so a second listener skips them. */
const lowering = new Set();

/** Delete these Regions once each; the ids that were deleted. */
async function deleteRegions(regions) {
  const done = [];
  for (const region of regions) {
    if (lowering.has(region.id)) continue;
    lowering.add(region.id);
    try {
      await region.delete();
      done.push(region.id);
    } catch (err) {
      console.error(`${MODULE_ID} | a reach could not be lowered`, err);
    } finally {
      lowering.delete(region.id);
    }
  }
  return done;
}

/**
 * Lower a bearer's reaches: delete the attached Regions that hold an aura
 * behavior, all of them or one activation's. The primary GM's window runs it; a
 * Player's seat relays it and the GM checks the seat owns the token.
 *
 * @param {{tokenUuid: string, activationId?: string}} p
 * @returns {Promise<string[]>} the ids of the Regions deleted
 */
export async function lowerReach({ tokenUuid, activationId, requestUserId = null }) {
  if (!game.user.isGM) return (await executeAsGM(HANDLER.lower, { tokenUuid, activationId })) ?? [];
  const token = fromUuidSync(tokenUuid);
  if (!token) return [];
  if (requestUserId && !ownersOf(token).includes(requestUserId)) return [];
  return deleteRegions(reachesOf(token, activationId));
}

/* -------------------------------------------- */
/*  Teardown and a bearer going down             */
/* -------------------------------------------- */

/** A reach's Region was deleted, by any way: its records go. */
async function onRegionDeleted(region) {
  if (!isPrimaryGM() || !teardownHandler) return;
  for (const config of auraConfigsOf(region)) {
    try {
      await teardownHandler({ config, region });
    } catch (err) {
      console.error(`${MODULE_ID} | a lowered reach's records could not be lifted`, err);
    }
  }
}

/**
 * A bearer is down: delete the reaches attached to each of its tokens and fire
 * `BEARER_DOWN_HOOK` for each token that is down, with the cause. Where the same
 * bearer is seen down again (a further hit-point change) the hook fires again;
 * a handler is idempotent.
 *
 * @param {Actor} actor the bearer's actor (a token's synthetic actor included)
 * @returns {Promise<Array<{token: TokenDocument, cause: string}>>}
 */
export async function lowerForBearer(actor) {
  const tokens = actor?.isToken ? [actor.token] : (actor?.getDependentTokens?.({ linked: true }) ?? []);
  const out = [];
  for (const token of tokens) {
    if (!token) continue;
    const cause = bearerDown(token);
    if (!cause) continue;
    await deleteRegions(reachesOf(token));
    Hooks.callAll(BEARER_DOWN_HOOK, token, { cause });
    out.push({ token, cause });
  }
  return out;
}

/** The actor an Active Effect sits on: its parent, or the token's actor where the parent is a token's delta. */
const effectActor = (effect) => (effect?.parent?.documentName === "ActorDelta" ? (effect.parent.parent?.actor ?? null) : (effect?.parent ?? null));

/** Whether an effect holds the defeated status and is enabled. */
const defeating = (effect) => !effect?.disabled && effect?.statuses?.has?.(globalThis.CONFIG?.specialStatusEffects?.DEFEATED ?? STATUS_DEAD) === true;

/* -------------------------------------------- */
/*  The area a snapshot tests                    */
/* -------------------------------------------- */

/**
 * Which tokens of a scene an area contains now, by core's own containment
 * against an unsaved Region (nothing is written). `centre` is `{token}` (the
 * bearer's token: its footprint grown by the range) or `{point: {x, y,
 * elevation, level}}` (a circle). The centre token and any marker token are left
 * out. Never throws.
 *
 * @param {Scene} scene
 * @param {{token?: TokenDocument, point?: object}} centre
 * @param {number} rangeFeet
 * @returns {{ok: true, tokens: TokenDocument[]}|{ok: false, reason: string}}
 */
export function reachSnapshot(scene, centre, rangeFeet) {
  try {
    const shape = snapshotRegionData(centre?.token ? { token: centre.token._source ?? centre.token } : centre, feetToUnits(rangeFeet, scene?.grid?.units), scene?.dimensions);
    if (!shape.ok) return shape;
    const region = new CONFIG.Region.documentClass({ name: "reach", ...shape.data }, { parent: scene });
    const tokens = [...(scene.tokens ?? [])].filter((token) => token !== centre?.token && !isMarkerActor(token.actor) && token.testInsideRegion(region));
    return { ok: true, tokens };
  } catch (err) {
    console.error(`${MODULE_ID} | a reach snapshot could not be taken`, err);
    return { ok: false, reason: "snapshot" };
  }
}

/* -------------------------------------------- */
/*  Install                                      */
/* -------------------------------------------- */

let installed = false;

/**
 * Wire the listeners, once, at `ready`: lib's turn start, the Region's
 * deletion, a bearer's hit points and the defeated status, and the Player-seat
 * relays. Every listener acts only on the primary GM's window.
 */
export function installAuraReach() {
  if (installed) return;
  installed = true;
  registerHandler(HANDLER.raise, (payload) => raiseHere(payload));
  registerHandler(HANDLER.lower, (payload) => lowerReach({ ...payload, tokenUuid: payload.tokenUuid }));
  Hooks.on(TURN_BEGAN_HOOK, onTurnBegan);
  Hooks.on("deleteRegion", onRegionDeleted);
  Hooks.on("updateActor", (actor, change) => {
    if (isPrimaryGM() && change?.system?.hp !== undefined) void lowerForBearer(actor);
  });
  for (const name of ["createActiveEffect", "updateActiveEffect"]) {
    Hooks.on(name, (effect) => {
      if (isPrimaryGM() && defeating(effect)) void lowerForBearer(effectActor(effect));
    });
  }
}
