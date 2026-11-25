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
 *   the one registered handler (`setReachHandler`): the item runner's. A turn
 *   start asks a subject once per item kind, and a bearer its filter counts in
 *   hears its own attached reach at its own turn start. A prompt is held under
 *   its moment key on the primary GM until it is answered or struck, and the
 *   keys of an earlier initiative are pruned at each turn start.
 * - The one teardown is the Region's deletion (`setReachTeardown`): every
 *   record carrying the Region's activation id goes with it. A bearer whose hit
 *   points reach zero, or that takes the defeated status, has its reaches
 *   deleted (`lowerForBearer`) and `BEARER_DOWN_HOOK` fires.
 * - `ensureEngagedReaches` makes the always-on reach of a started combat's bearer: a
 *   Region of its own, with an activation id of its own, that goes with its
 *   combat, combatant or token and returns with a revived or revealed bearer.
 * - `reachSnapshot` answers which tokens an area contains at this moment, for a
 *   reach that acts once, against an unsaved Region.
 *
 * Everything that acts runs only where `isPrimaryGM()` holds: core dispatches
 * region events on every GM client. A behavior a hand made holds an empty
 * config and does nothing.
 */
import { AURA_BEHAVIOR_TYPE, BEARER_DOWN_HOOK, MODULE_ID, LANG_PREFIX, TURN_BEGAN_HOOK } from "./constants.mjs";
import { carriesItem, checkRaise, downCause, engagedActivationId, engagementHolds, isEngagedActivation, figureNumber, groupByKind, groupVerdict, holdMoment, pruneMoments, readAuraConfig, readReach, reachAdmits, releaseMoment, snapshotRegionData, turnStamp } from "./aura-reach-logic.mjs";
import { alwaysOn, itemRunRowsOf, kindKeyOf } from "./item-run-logic.mjs";
import { behaviorsUnder } from "./regions.mjs";
import { executeAsGM, registerHandler } from "./sockets.mjs";
import { tokenHasStatus, tokenHitPoints } from "./hp-logic.mjs";
import { STATUS_DEAD } from "./status-effects.mjs";
import { isPrimaryGM, makeLoc } from "./util.mjs";
import { isMarkerActor } from "./place.mjs";
import { conditionSet } from "./conditions.mjs";
import { engagementFeet, feetToUnits, sceneFeetPerCell } from "./distance-units.mjs";
import { postToJudges } from "./roll-audience.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The socket handlers a Player's seat relays a raise and a lower through. */
const HANDLER = Object.freeze({ raise: `${MODULE_ID}.aura.raise`, lower: `${MODULE_ID}.aura.lower` });

/** The one handler a moment reaches, set by the item runner, and the one teardown. */
let momentHandler = null;
let teardownHandler = null;

/** The prompts held on this window, a moment key to the stamp of its initiative (null outside a fight). */
const heldMoments = new Map();

/**
 * Hold a prompt's moment key on this window: true where the subject is to be
 * asked, false where it already was for this item kind and initiative.
 * @param {string|null} key a `momentKey`
 * @param {string|null} [stamp] a `turnStamp`
 */
export const holdReachMoment = (key, stamp = null) => holdMoment(heldMoments, key, stamp);

/** Release a held prompt, when it is answered or struck. */
export const releaseReachMoment = (key) => releaseMoment(heldMoments, key);

/** The stamp of the fight's current initiative on this window, null outside a fight. */
export const currentStamp = () => turnStamp({ combatId: game.combat?.started ? game.combat.id : null, round: game.combat?.round, turn: game.combat?.turn });

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
 * @returns {Promise<*>} what the handler answered (the act it took), or null where nothing was handed on or the handler threw
 */
export async function dispatchReachMoment(system, moment, subjectToken) {
  const context = reachContext(system, subjectToken);
  return context ? handOn(moment, context) : null;
}

/** The condition ids an actor holds, what it implies included: the reader `engagementHolds` takes. */
const conditionsOfActor = (actor) => conditionSet(actor?.statuses ?? []);

/**
 * What a moment of one subject against one `aura` behavior hands the handler,
 * `{config, item, row, reach, bearer, subject, admitted, region}`, or null where
 * the behavior's config is empty, its source or row or reach is gone, or the
 * bearer's token is. A `turnStart+enter` reach's `admitted` is false wherever
 * `engagementHolds` says so, which beats the filter's answer.
 */
function reachContext(system, subjectToken) {
  const config = readAuraConfig(system);
  if (!config || !subjectToken || !momentHandler) return null;
  const region = system?.region ?? system?.parent?.region ?? null;
  const item = fromUuidSync(config.sourceUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === config.rowKey);
  const reach = readReach(row?.reach);
  if (!reach) return null;
  const bearerToken = region?.parent?.tokens?.get?.(region.attachment?.token) ?? null;
  if (!bearerToken) return null;
  const bearer = bodyOf(bearerToken);
  const subject = bodyOf(subjectToken);
  let admitted = reachAdmits(bearer, subject, reach.filter, { isMarker: isMarkerActor });
  if (reach.pulse === ENGAGING_PULSE && !engagementHolds(bearer, subject, { conditionsOf: conditionsOfActor })) admitted = false;
  return { config, item, row, reach, bearer, subject, admitted, region };
}

/** Hand a moment's context to the registered handler; its answer, or null where it threw. */
async function handOn(moment, context) {
  try {
    return await momentHandler({ moment, ...context });
  } catch (err) {
    console.error(`${MODULE_ID} | a reach's ${moment} could not be run`, err);
    return null;
  }
}

/** The pulse of the row a behavior's config names, "" where the item, row or reach is gone. */
function pulseOfBehavior(behavior) {
  const config = readAuraConfig(behavior?.system);
  const item = config ? fromUuidSync(config.sourceUuid) : null;
  return readReach(itemRunRowsOf(item).find((r) => r?.key === config?.rowKey)?.reach)?.pulse ?? "";
}

/** The kind key of the item a behavior's config names, "" where the item or row is gone. */
function kindOfBehavior(behavior) {
  const config = readAuraConfig(behavior?.system);
  const item = config ? fromUuidSync(config.sourceUuid) : null;
  const row = itemRunRowsOf(item).find((r) => r?.key === config?.rowKey);
  return row ? kindKeyOf(item, row) : "";
}

/**
 * The reaches attached to a token whose filter counts the bearer in (`self`),
 * as `{region, behavior}`: core never reports a token inside its own Region, so
 * its own turn start reads them from the attachment.
 */
function attachedCounting(token) {
  const out = [];
  for (const region of reachesOf(token)) {
    for (const behavior of region.behaviors ?? []) {
      if (behavior.type !== AURA_BEHAVIOR_TYPE || behavior.disabled || region.hidden) continue;
      const config = readAuraConfig(behavior.system);
      const row = itemRunRowsOf(config ? fromUuidSync(config.sourceUuid) : null).find((r) => r?.key === config?.rowKey);
      const reach = readReach(row?.reach);
      if (reach?.pulse === "turnStart+moveIn" && reach.filter.self === "count") out.push({ region, behavior });
    }
  }
  return out;
}

/** The acts that settle a kind for a subject at a turn start: it was asked, holds an immunity, or was already asked. */
const SETTLES = new Set(["prompt", "skip", "held"]);

/** The pulse whose reaches of one kind are settled together at a turn start (`groupVerdict`) instead of one after another. */
const ENGAGING_PULSE = "turnStart+enter";

/**
 * A turn began: the keys held for another initiative are pruned, then every
 * reach the combatant's token stands in, and its own attached reach where its
 * filter counts the bearer, hears it. A subject is asked once per item kind:
 * the reaches of one kind are offered in the order met until one settles it.
 * The reaches of the `turnStart+enter` pulse are not offered in turn: each kind
 * is settled once from every bearer's answer (`groupVerdict`), and the one
 * dispatch carries `engagedBy`, the token uuids of the bearers that admit.
 */
async function onTurnBegan(combat, combatantId) {
  if (!isPrimaryGM()) return;
  pruneMoments(heldMoments, turnStamp({ combatId: combat?.id, round: combat?.round, turn: combat?.turn }));
  const token = combat?.combatants?.get?.(combatantId)?.token ?? null;
  if (!token) return;
  const heard = behaviorsUnder(token, AURA_BEHAVIOR_TYPE);
  for (const own of attachedCounting(token)) if (!heard.some((h) => h.behavior === own.behavior)) heard.push(own);
  const engaging = heard.filter(({ behavior }) => pulseOfBehavior(behavior) === ENGAGING_PULSE);
  for (const group of groupByKind(heard.filter((h) => !engaging.includes(h)), ({ behavior }) => kindOfBehavior(behavior))) {
    for (const { behavior } of group) {
      if (SETTLES.has(await dispatchReachMoment(behavior.system, "turnStart", token))) break;
    }
  }
  for (const group of groupByKind(engaging, ({ behavior }) => kindOfBehavior(behavior))) {
    const contexts = group.map(({ behavior }) => reachContext(behavior.system, token)).filter(Boolean);
    if (!contexts.length) continue;
    const lead = contexts.find((c) => c.admitted === true) ?? contexts.find((c) => c.admitted === null || c.admitted === undefined) ?? contexts[0];
    const engagedBy = contexts.filter((c) => c.admitted === true).map((c) => c.bearer.token.uuid);
    await handOn("turnStart", { ...lead, admitted: groupVerdict(contexts.map((c) => c.admitted)), engagedBy });
  }
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
 * The one writer of a reach's Region: core's `createTokenEmanation`, grid
 * based, hidden as the token is, holding the `aura` behavior whose config names
 * the item, its actor, the activation id and the row. The range is in feet and
 * core takes the scene's own units, so it goes through `feetToUnits` here, for
 * every reach. `showReach` makes the Region everyone's, else the GM's.
 */
function createReachRegion({ token, item, rowKey, activationId, rangeFeet, showReach }) {
  const behavior = { type: AURA_BEHAVIOR_TYPE, name: item.name, system: { sourceUuid: item.uuid, bearerUuid: item.actor.uuid, activationId, rowKey } };
  return CONFIG.Region.documentClass.createTokenEmanation(
    token,
    feetToUnits(rangeFeet, token.parent?.grid?.units),
    { name: item.name, hidden: token.hidden, visibility: showReach ? CONST.REGION_VISIBILITY.ALWAYS : CONST.REGION_VISIBILITY.GAMEMASTER, behaviors: [behavior] },
    { gridBased: true },
  );
}

/**
 * The raise itself, on the primary GM's window: check the request against what
 * is live, then create the Region through core's `createTokenEmanation`, grid
 * based, hidden as the token is, GM-visible (everyone's where the row's
 * `showReach` is true), holding the `aura` behavior.
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
  const region = await createReachRegion({ token, item, rowKey, activationId, rangeFeet: verdict.rangeFeet, showReach: reach.showReach });
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
  const out = [];
  for (const token of tokensOfBearer(actor)) {
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
const defeating = (effect) => !effect?.disabled && carriesDefeated(effect);

/** Whether an effect names the defeated status, enabled or not: one that no longer holds it may restore a bearer's reaches. */
const carriesDefeated = (effect) => effect?.statuses?.has?.(globalThis.CONFIG?.specialStatusEffects?.DEFEATED ?? STATUS_DEAD) === true;

/* -------------------------------------------- */
/*  The always-on engaged reach                  */
/* -------------------------------------------- */

/** The engaged reach rows an actor's always-on items carry, as `{item, row, reach}`. */
function engagedRowsOf(actor) {
  const out = [];
  for (const item of [...(actor?.items ?? [])]) {
    if (!alwaysOn(item)) continue;
    for (const row of itemRunRowsOf(item)) {
      const reach = row?.key ? readReach(row.reach) : null;
      if (reach?.engaged) out.push({ item, row, reach });
    }
  }
  return out;
}

/** Whether a Region is an always-on reach's: it holds an aura behavior whose activation id is an engaged one. */
const isEngagedReach = (region) => auraConfigsOf(region).some((config) => isEngagedActivation(config.activationId));

/** Whether a token already has the Region of one item's row. */
const hasEngagedReach = (token, item, rowKey) => reachesOf(token).some((region) => isEngagedReach(region) && auraConfigsOf(region).some((c) => c.sourceUuid === item.uuid && c.rowKey === rowKey));

/**
 * Whether a token holds the always-on ring of one item's row, and how many
 * bodies it engages now: the Region's own tokens that the row's filter admits
 * and `engagementHolds` allows, the bearer, markers and bodies it cannot settle
 * left out. A row that reads no reach has no ring.
 *
 * @param {TokenDocument|null} token the bearer's token
 * @param {Item} item
 * @param {object} row an item row (`itemRunRowsOf`)
 * @returns {{stands: boolean, count: number}}
 */
export function engagedStateOf(token, item, row) {
  const reach = readReach(row?.reach);
  const region = token && reach ? reachesOf(token).find((r) => isEngagedReach(r) && auraConfigsOf(r).some((c) => c.sourceUuid === item?.uuid && c.rowKey === row.key)) : null;
  if (!region) return { stands: false, count: 0 };
  const bearer = bodyOf(token);
  const engaging = [...(region.tokens ?? [])].filter((other) => {
    if (other.id === token.id) return false;
    const subject = bodyOf(other);
    return reachAdmits(bearer, subject, reach.filter, { isMarker: isMarkerActor }) === true && engagementHolds(bearer, subject, { conditionsOf: conditionsOfActor });
  });
  return { stands: true, count: engaging.length };
}

/** The Region keys being made right now, so a second call for the same body passes it by instead of making a second. */
const making = new Set();

/** The lines told this combat, by combat id then line, so each is told once. */
const told = new Map();

/** Tell the Judges a line once per combat; false where it was told before. */
async function tellOnce(combat, line, text) {
  const seen = told.get(combat?.id ?? "") ?? new Set();
  if (seen.has(line)) return false;
  told.set(combat?.id ?? "", seen.add(line));
  try {
    await postToJudges({ content: `<p><em>${foundry.utils.escapeHTML(text)}</em></p>` });
  } catch (err) {
    console.error(`${MODULE_ID} | a Judge line could not be posted`, err);
  }
  return true;
}

/**
 * Make the always-on engaged reaches of a started combat, on the primary GM's
 * window: for each combatant whose token's actor holds an item with an engaged
 * reach row and no `itemRun.activation`, one Region attached to the token, at
 * `engagementFeet()` through `feetToUnits`, GM-visible or, where the row's
 * `showReach` is ticked, everyone's. Idempotent: a token that already has its
 * row's Region is left, and a body still being made is passed by. A downed
 * bearer and a hidden one are skipped, silently. Silent for a combat with no
 * such row. Told once per combat, to the Judges: a scene whose grid square is
 * not the engagement square, and a refusal (no token, no support, Foundry
 * refusing the Region).
 *
 * @param {Combat} combat
 * @param {{combatants?: Combatant[]}} [only] the combatants to read, where not the whole combat
 * @returns {Promise<{made: number, skipped: number, scaleMismatch: boolean}>} the Regions made now, the bodies skipped (down or hidden), whether a body stands on a scene whose square is another size
 */
export async function ensureEngagedReaches(combat, { combatants = null } = {}) {
  const out = { made: 0, skipped: 0, scaleMismatch: false };
  if (!isPrimaryGM() || !combat?.started) return out;
  const jobs = [];
  const refused = [];
  for (const combatant of combatants ?? [...(combat.combatants ?? [])]) {
    const token = combatant.token ?? null;
    const rows = engagedRowsOf(token?.actor ?? combatant.actor);
    if (!rows.length) continue;
    if (!token) {
      refused.push(loc("aura.engaged.noToken", { name: combatant.name ?? "" }));
      continue;
    }
    if (token.hidden || bearerDown(token)) {
      out.skipped += 1;
      continue;
    }
    if (sceneFeetPerCell(token.parent) !== engagementFeet()) out.scaleMismatch = true;
    for (const { item, row, reach } of rows) {
      const key = `${token.uuid}|${item.uuid}|${row.key}`;
      if (making.has(key) || hasEngagedReach(token, item, row.key)) continue;
      making.add(key);
      jobs.push({ key, token, item, row, reach });
    }
  }
  const support = auraSupport();
  for (const { key, token, item, row, reach } of jobs) {
    try {
      if (!support.ok) {
        refused.push(loc("aura.refused.unsupported"));
        continue;
      }
      await createReachRegion({ token, item, rowKey: row.key, activationId: engagedActivationId(foundry.utils.randomID()), rangeFeet: engagementFeet(), showReach: reach.showReach });
      out.made += 1;
    } catch (err) {
      console.error(`${MODULE_ID} | an engaged reach could not be made`, err);
      refused.push(loc("aura.engaged.denied", { name: token.name ?? "" }));
    } finally {
      making.delete(key);
    }
  }
  if (out.scaleMismatch) await tellOnce(combat, "scale", loc("aura.engaged.scale"));
  if (refused.length) await tellOnce(combat, "refused", refused[0]);
  return out;
}

/** Whether a token is a combatant of a started combat other than `combat`. */
function inOtherStartedCombat(token, combat) {
  return [...(game.combats ?? [])].some((other) => other.id !== combat?.id && other.started && [...(other.combatants ?? [])].some((c) => c.tokenId === token.id && (!c.sceneId || c.sceneId === token.parent?.id)));
}

/**
 * Delete a token's always-on Regions, and only those: a raised toggle's reach
 * on the same token stays. A Region core already deleted with its token is
 * passed over. Records outlive the Region (`liftActivation` leaves them).
 * @returns {Promise<string[]>} the Region ids deleted
 */
export async function lowerEngagedReaches(token) {
  const regions = reachesOf(token).filter((region) => isEngagedReach(region) && region.parent?.regions?.has?.(region.id) !== false);
  return deleteRegions(regions);
}

/** A combatant left, or its combat ended: its token's always-on Regions go unless another started combat holds the token. */
async function lowerEngagedFor(combat, combatants) {
  for (const combatant of combatants) {
    const token = combatant.token;
    if (token && !inOtherStartedCombat(token, combat)) await lowerEngagedReaches(token);
  }
}

/** The started combats a token is a combatant of, as `{combat, combatants}`. */
function startedCombatsOf(token) {
  const out = [];
  for (const combat of game.combats ?? []) {
    if (!combat.started) continue;
    const combatants = [...(combat.combatants ?? [])].filter((c) => c.tokenId === token.id && (!c.sceneId || c.sceneId === token.parent?.id));
    if (combatants.length) out.push({ combat, combatants });
  }
  return out;
}

/** Ensure a token's reaches in every started combat it fights in: a bearer revived or revealed has them back. */
async function ensureForToken(token) {
  for (const { combat, combatants } of startedCombatsOf(token)) await ensureEngagedReaches(combat, { combatants });
}

/** The tokens a bearer's actor stands behind: a synthetic actor's own, else its linked tokens. */
const tokensOfBearer = (actor) => (actor?.isToken ? [actor.token] : (actor?.getDependentTokens?.({ linked: true }) ?? []));

/** A bearer is up: each of its tokens that fights has its always-on reaches again, where it was down before. */
async function reviveEngaged(actor) {
  for (const token of tokensOfBearer(actor)) {
    if (token && !bearerDown(token)) await ensureForToken(token);
  }
}

/** An actor's hit points changed or its defeated status moved: lowered where it is down, restored where it is up. */
async function settleBearer(actor) {
  await lowerForBearer(actor);
  await reviveEngaged(actor);
}

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
    if (isPrimaryGM() && change?.system?.hp !== undefined) void settleBearer(actor);
  });
  for (const name of ["createActiveEffect", "updateActiveEffect"]) {
    Hooks.on(name, (effect) => {
      if (!isPrimaryGM()) return;
      if (defeating(effect)) void lowerForBearer(effectActor(effect));
      else if (name === "updateActiveEffect" && carriesDefeated(effect)) void reviveEngaged(effectActor(effect));
    });
  }
  Hooks.on("deleteActiveEffect", (effect) => {
    if (isPrimaryGM() && carriesDefeated(effect)) void reviveEngaged(effectActor(effect));
  });
  Hooks.on("createCombatant", (combatant) => {
    if (isPrimaryGM()) void ensureEngagedReaches(combatant.combat, { combatants: [combatant] });
  });
  Hooks.on("updateCombat", (combat, change) => {
    if (isPrimaryGM() && change?.round !== undefined) void ensureEngagedReaches(combat);
  });
  Hooks.on("deleteCombatant", (combatant) => {
    if (isPrimaryGM()) void lowerEngagedFor(combatant.combat, [combatant]);
  });
  Hooks.on("deleteCombat", (combat) => {
    told.delete(combat?.id ?? "");
    if (isPrimaryGM()) void lowerEngagedFor(combat, [...(combat?.combatants ?? [])]);
  });
  Hooks.on("deleteToken", (token) => {
    if (isPrimaryGM()) void lowerEngagedReaches(token);
  });
  Hooks.on("updateToken", (token, change) => {
    if (isPrimaryGM() && change?.hidden === false) void ensureForToken(token);
  });
}
