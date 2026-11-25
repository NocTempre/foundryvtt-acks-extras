/* global game, Hooks, foundry, fromUuidSync, ui */
/**
 * The item runner's Foundry half: the carrier that takes the use of an item
 * whose `itemRun.activation` is set (`patches/item-use.mjs` is its one door),
 * runs the activation kinds, writes and lifts the records, and holds the fuse.
 *
 * - A press runs on the primary GM's window (`useItem`): a Player's seat relays
 *   it, and the GM checks the seat owns the item's actor before anything runs.
 * - `once` takes a snapshot of who the row's reach meets (`reachSnapshot`) and
 *   returns the prompt card's model; `toggle` raises or lowers the attached
 *   reach (`aura-reach.mjs`). Both hand their result to the registered presenter
 *   (`setUsePresenter`), which posts the card; nothing here posts one. `fuse`
 *   and `consume` are kinds a later runner registers (`registerActivationRunner`).
 * - A save is rolled on the presser's seat and relayed (`pressRoll`); the GM
 *   checks the figure against the item's own row, resolved live, before writing
 *   (`checkPressRequest`), and an Undo removes the row's own record ids.
 * - The reach's moments land in `handleReachMoment`: a standing part is taken
 *   off at an exit, and every other act is offered to the presenter.
 * - The fuse is stepped from lib's turn hooks as delayed damage is: the record
 *   is deleted first, then the registered burst runs (`setFuseBurst`), and a
 *   fight that ends moves it to the world clock.
 */
import { FLAG_FUSE, FLAG_ITEM_RUN, LANG_PREFIX, MODULE_ID, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "./constants.mjs";
import { figureNumber, pulseAct, readReach, reachAdmits } from "./aura-reach-logic.mjs";
import { lowerReach, raiseReach, reachSnapshot, setReachHandler, setReachTeardown } from "./aura-reach.mjs";
import {
  activationRecordIds, checkPressRequest, claimsItemUse, conditionRecordData, fuseDue, fuseStep, fuseToWorld, immunityRecordData,
  itemRunOf, itemRunRowsOf, promptCardModel, readFuse, standingPartId, undoPlan,
} from "./item-run-logic.mjs";
import { addItemUseClaimant } from "./patches/item-use.mjs";
import { managedDelete } from "./managed-effects.mjs";
import { statusEffectData } from "./held-condition.mjs";
import { recordImmunity } from "./roll-mods.mjs";
import { saveSpec, saveThrow } from "./saves.mjs";
import { executeAsGM, registerHandler } from "./sockets.mjs";
import { roundSeconds } from "./time-unit.mjs";
import { isPrimaryGM, makeLoc, unset } from "./util.mjs";
import { onWorldTimeAdvanced } from "./world-time.mjs";
import { isMarkerActor } from "./place.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The refusals the Judge and the Player have a line for; any other reason reads as a plain refusal. */
const REFUSALS = new Set(["gone", "notOwner", "noRunner", "noToken", "noRow", "noRange", "snapshot", "unsupported", "notCarried", "down"]);

/** The socket handlers a Player's seat relays a use and a press through. */
const HANDLER = Object.freeze({ use: `${MODULE_ID}.itemRun.use`, press: `${MODULE_ID}.itemRun.press` });

/** The runner of each activation kind, the presenter of a use's result, and the fuse's burst. */
const runners = new Map();
let presenter = null;
let burster = null;

/**
 * Register the runner of an activation kind: `fn({item, run, actor, token,
 * judge})` answers `{ok, ...}`. `once` and `toggle` are lib's; a later slice
 * registers `fuse` and `consume`. The carrier claims a kind only once a runner
 * is registered for it, so an item of a kind nobody runs still shows the
 * system's card.
 */
export function registerActivationRunner(kind, fn) {
  if (typeof fn === "function") runners.set(kind, fn);
  else runners.delete(kind);
}

/** Register what presents a use's result (posts the prompt card); a non-function clears it. */
export function setUsePresenter(fn) {
  presenter = typeof fn === "function" ? fn : null;
}

/** Register the burst of a fuse: `fn({actor, record})` runs after the fuse's record is deleted; a non-function clears it, and an unset burst leaves every fuse unstepped. */
export function setFuseBurst(fn) {
  burster = typeof fn === "function" ? fn : null;
}

/* -------------------------------------------- */
/*  The use                                      */
/* -------------------------------------------- */

/** The bearer's token document: the actor's own, else the first on a scene. */
const tokenOf = (actor) => (actor?.isToken ? actor.token : (actor?.getActiveTokens?.(false, true)?.[0] ?? null));

/** The one key an item kind's immunity is recorded under: the importer's entry id, else the row's key. */
export const kindKeyOf = (item, row) => String(item?.flags?.[MODULE_ID]?.cookbook?.id ?? row?.key ?? "");

/** Write an activation's toggle state onto the item. */
const setState = (item, state) => item.update({ [`flags.${MODULE_ID}.${FLAG_ITEM_RUN}.activation.state`]: state });

/** The row of an item a toggle raises: the first with a reach that acts while raised. */
const toggleRow = (item) => itemRunRowsOf(item).find((row) => ["turnStart+moveIn", "standing"].includes(readReach(row?.reach)?.pulse));

/** `toggle`: lower the raised reach, or raise the row's. */
async function runToggle({ item, run, token }) {
  const { state } = run.activation;
  if (state.active) {
    await lowerReach({ tokenUuid: token.uuid, activationId: state.activationId });
    await setState(item, { active: false, activationId: "", regionId: "" });
    return { ok: true, kind: "toggle", active: false };
  }
  const row = toggleRow(item);
  if (!row) return { ok: false, reason: "noRow" };
  const activationId = foundry.utils.randomID();
  const raised = await raiseReach({ tokenUuid: token.uuid, sourceUuid: item.uuid, rowKey: row.key, activationId });
  if (!raised?.ok) return { ok: false, reason: raised?.reason ?? "refused" };
  await setState(item, { active: true, activationId, regionId: raised.regionId ?? "" });
  return { ok: true, kind: "toggle", active: true, activationId };
}

/** The ids a card's buttons name. */
const cardIds = (item, row, activationId) => ({ itemUuid: item.uuid, rowKey: row.key, activationId });

/** `once`: who the first action row's reach meets now, as a card model. */
async function runOnce({ item, token, judge }) {
  const row = itemRunRowsOf(item).find((r) => readReach(r?.reach)?.pulse === "action");
  const reach = readReach(row?.reach);
  if (!reach) return { ok: false, reason: "noRow" };
  const range = figureNumber(reach.radius);
  if (range === null || !(range > 0)) return { ok: false, reason: "noRange" };
  const snap = reachSnapshot(token.parent, { token }, range);
  if (!snap.ok) return { ok: false, reason: snap.reason };
  const bearer = { token, actor: token.actor };
  const admitted = [];
  const undetermined = [];
  for (const subjectToken of snap.tokens) {
    const subject = { token: subjectToken, actor: subjectToken.actor };
    const verdict = reachAdmits(bearer, subject, reach.filter, { isMarker: isMarkerActor });
    const entry = { key: subjectToken.uuid, name: subjectToken.name };
    const immune = !!recordImmunity(subject.actor, { spell: { id: kindKeyOf(item, row) } }).spell;
    const act = pulseAct({ pulse: reach.pulse, moment: "press", admitted: verdict, immune });
    if (act === "prompt" || act === "skip") admitted.push({ ...entry, immune: act === "skip" });
    else if (act === "undetermined") undetermined.push(entry);
  }
  const activationId = foundry.utils.randomID();
  const words = Object.fromEntries(["roll", "undo", "undetermined", "tick", "saved", "failed"].map((key) => [key, loc(`itemRun.card.${key}`)]));
  const card = promptCardModel({
    title: item.name,
    subtitle: token.name,
    words,
    subjects: admitted.filter((s) => !s.immune),
    undetermined,
    ids: cardIds(item, row, activationId),
    isGM: judge,
  });
  return { ok: true, kind: "once", activationId, rowKey: row.key, subjects: admitted, undetermined, card };
}

/**
 * The use of an item, on the primary GM's window: authorize the seat, find the
 * bearer's token and the kind's runner, run it and hand the result to the
 * presenter. A seat that does not own the item's actor, an item with no runner
 * for its kind and a bearer with no token on a scene are refused with a line.
 *
 * @param {{itemUuid: string, requestUserId?: string|null}} p
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function runUse({ itemUuid, requestUserId = null }) {
  const item = fromUuidSync(itemUuid);
  const run = itemRunOf(item);
  const actor = item?.actor ?? null;
  const refuse = (reason) => {
    (requestUserId ? ui.notifications?.error : ui.notifications?.warn)?.call(ui.notifications, loc(`itemRun.refused.${REFUSALS.has(reason) ? reason : "refused"}`));
    return { ok: false, reason };
  };
  if (!run || !actor) return refuse("gone");
  const user = requestUserId ? game.users.get(requestUserId) : null;
  if (requestUserId && !actor.testUserPermission?.(user, "OWNER")) return refuse("notOwner");
  const runner = runners.get(run.activation.kind);
  if (!runner) return refuse("noRunner");
  const token = tokenOf(actor);
  if (!token) return refuse("noToken");
  const result = await runner({ item, run, actor, token, judge: !requestUserId });
  if (!result.ok) return refuse(result.reason ?? "refused");
  await presenter?.(result);
  return result;
}

/** Take an item's use: run it here on the GM's window, or relay it from a Player's seat. */
export async function useItem(item) {
  if (game.user.isGM) return runUse({ itemUuid: item.uuid });
  return (await executeAsGM(HANDLER.use, { itemUuid: item.uuid })) ?? { ok: false, reason: "relay" };
}

/* -------------------------------------------- */
/*  A press, and Undo                            */
/* -------------------------------------------- */

/** The save a row's reach asks of a subject: the row's `target` name. */
export const saveNameOf = (row) => String(row?.target ?? "");

/** The subject's token document, from the id a card button names. */
const subjectOf = (uuid) => fromUuidSync(uuid);

/**
 * The GM's side of a press: read the item's own row live, check the figure,
 * and on a verdict write the records a failed save (a condition per condition
 * key the row names) or a passed one (an immunity window, where `window`
 * supplies one) calls for. Answers `{ok, entry}` with the ids written, for the
 * card to store; nothing but the records is written.
 */
async function pressHere(payload) {
  const { itemUuid, rowKey, activationId, subject: subjectUuid, total, target, requestUserId = null, entryState, window: windowOf } = payload;
  const item = fromUuidSync(itemUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey) ?? null;
  const subjectToken = subjectOf(subjectUuid);
  const actor = subjectToken?.actor ?? null;
  const spec = actor && row ? saveSpecOf(actor, row) : null;
  const verdict = checkPressRequest(
    { requestUserId, total, target },
    { item, row, subjectOwnerIds: (game.users ?? []).filter((u) => subjectToken?.testUserPermission?.(u, "OWNER")).map((u) => u.id), target: spec?.target ?? null, entryState },
  );
  if (!verdict.ok) return verdict;
  const flags = { source: itemUuid, activationId, rowKey };
  const records = [];
  if (!verdict.saved) {
    for (const status of row.conditions ?? []) {
      records.push(conditionRecordData({ statusData: await statusEffectData(status), ...flags, life: lifeOf(subjectToken) }));
    }
  } else {
    const made = windowOf?.(row, item);
    if (made) records.push(immunityRecordData({ name: made.name, spellKey: kindKeyOf(item, row), duration: made.duration, ...flags }));
  }
  const made = records.length ? await actor.createEmbeddedDocuments("ActiveEffect", records) : [];
  return { ok: true, saved: verdict.saved, entry: { state: "applied", saved: verdict.saved, total: verdict.total, target: verdict.target, recordIds: made.map((e) => e.id) } };
}

/** The save's spec for a subject: the row's save name through `saveSpec`. */
function saveSpecOf(actor, row) {
  const name = saveNameOf(row);
  return name ? saveSpec(actor, name) : null;
}

/** A condition's clock: the start of the subject's next turn where it is in a fight, none otherwise. */
function lifeOf(subjectToken) {
  const combat = game.combat;
  const combatant = combat?.combatants?.find?.((c) => c.tokenId === subjectToken?.id);
  return combatant ? { turnLife: { combatId: combat.id, combatantId: combatant.id, edge: "start", count: 1 } } : {};
}

/**
 * A press on a prompt card's row, from the presser's seat: roll the subject's
 * save here and relay the total, never a verdict; the GM checks the figure
 * against the item's own row and writes. A Judge's press runs here.
 *
 * @param {{itemUuid: string, rowKey: string, activationId: string, subject: string, window?: Function}} p
 * @returns {Promise<{ok: boolean, entry?: object, reason?: string}>}
 */
export async function pressRoll(p) {
  const item = fromUuidSync(p.itemUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === p.rowKey);
  const actor = subjectOf(p.subject)?.actor;
  const name = saveNameOf(row);
  if (!actor || !name) return { ok: false, reason: "noFigure" };
  const thrown = await saveThrow(actor, name);
  if (thrown.target === null) return { ok: false, reason: "noFigure" };
  const payload = { itemUuid: p.itemUuid, rowKey: p.rowKey, activationId: p.activationId, subject: p.subject, total: thrown.total, target: thrown.target };
  if (game.user.isGM) return pressHere({ ...payload, window: p.window });
  return (await executeAsGM(HANDLER.press, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * Undo one card row, GM only: delete exactly the record ids the row stored that
 * still exist on the subject, passing `managedDelete()`. The Region, the
 * activation's state and the item's quantity are never touched.
 *
 * @param {{subject: string, entry: {recordIds?: string[]}}} p
 * @returns {Promise<{ok: boolean, removed: string[]}>}
 */
export async function undoEntry({ subject, entry }) {
  if (!game.user.isGM) return { ok: false, removed: [] };
  const actor = subjectOf(subject)?.actor;
  if (!actor) return { ok: false, removed: [] };
  const { ids } = undoPlan(entry, [...actor.effects].map((e) => e.id));
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, managedDelete());
  return { ok: true, removed: ids };
}

/* -------------------------------------------- */
/*  The reach's moments, and the teardown        */
/* -------------------------------------------- */

/**
 * A moment of a reach: a subject's immunity is read, the act decided
 * (`pulseAct`), a standing part taken off at an exit, and every other act (a
 * prompt, a standing part to write, an undetermined subject) handed to the
 * presenter as `{kind: "reach", ...}`.
 */
export async function handleReachMoment({ moment, config, item, row, reach, subject, admitted }) {
  const immune = !!recordImmunity(subject.actor, { spell: { id: kindKeyOf(item, row) } }).spell;
  const act = pulseAct({ pulse: reach.pulse, moment, admitted, immune });
  if (act === "none" || !subject.actor) return;
  if (act === "off") {
    const id = standingPartId(kindKeyOf(item, row));
    if (subject.actor.effects.get?.(id)) await subject.actor.deleteEmbeddedDocuments("ActiveEffect", [id], managedDelete());
    return;
  }
  await presenter?.({ ok: true, kind: "reach", act, moment, config, rowKey: row.key, item, subject });
}

/** Take a lowered activation's records off every actor that may hold one, and its toggle state off the item. */
export async function liftActivation({ config }) {
  const { worldActors } = await import("./repair.mjs");
  for (const actor of worldActors()) {
    const ids = activationRecordIds([...actor.effects], config.activationId);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, managedDelete());
  }
  const item = fromUuidSync(config.sourceUuid);
  if (item && itemRunOf(item)?.activation.state.activationId === config.activationId) await setState(item, { active: false, activationId: "", regionId: "" });
}

/* -------------------------------------------- */
/*  The fuse                                     */
/* -------------------------------------------- */

/** Every fuse effect on `actors`, once each. */
function* fuseEffects(actors) {
  const done = new Set();
  for (const actor of actors ?? []) {
    for (const effect of [...(actor?.effects ?? [])]) {
      const raw = effect?.flags?.[MODULE_ID]?.[FLAG_FUSE];
      if (raw === undefined || done.has(effect.uuid ?? effect)) continue;
      done.add(effect.uuid ?? effect);
      yield { actor, effect, raw };
    }
  }
}

/**
 * Apply a turn event to every fuse on the actors of `combat`: a turn that is
 * counted writes `seen`, one that is due deletes the record FIRST (a client
 * whose delete fails burst nothing) and then runs the registered burst. A
 * bearer that is gone or down does not stop a fuse. With no burst registered
 * nothing is stepped.
 */
export async function liftFuses(combat, combatantId, kind, deps = { burst: burster }) {
  if (!deps.burst) return [];
  const burst = [];
  const event = { kind, combatId: combat?.id, combatantId };
  for (const { actor, effect, raw } of fuseEffects([...(combat?.combatants ?? [])].map((c) => c?.actor))) {
    const step = fuseStep(raw, event);
    if (step.act === "none") continue;
    try {
      if (step.act === "count") {
        await effect.setFlag(MODULE_ID, FLAG_FUSE, { ...raw, clock: { ...raw.clock, seen: step.seen } });
        continue;
      }
      await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
      await deps.burst({ actor, record: step.record });
      burst.push(step.record);
    } catch (err) {
      console.error(`${MODULE_ID} | a fuse on ${actor.name} could not be run`, err);
    }
  }
  return burst;
}

/** A fight ended: each of its fuses moves onto the world clock at the round's length, read once by the caller. */
export async function convertFuses(combat, actors, clock) {
  const moved = [];
  for (const { effect, raw } of fuseEffects(actors)) {
    const world = fuseToWorld(raw, combat?.id, clock);
    if (!world) continue;
    const path = `flags.${MODULE_ID}.${FLAG_FUSE}`;
    await effect.update({ [path]: { ...world, clock: unset() } });
    moved.push(world);
  }
  return moved;
}

/** The world clock reached these fuses: delete each that is due, then burst. */
export async function liftWorldFuses(actors, worldTime, deps = { burst: burster }) {
  if (!deps.burst) return [];
  const burst = [];
  for (const { actor, effect, raw } of fuseEffects(actors)) {
    if (!fuseDue(raw, worldTime)) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    await deps.burst({ actor, record: readFuse(raw) });
    burst.push(readFuse(raw));
  }
  return burst;
}

/* -------------------------------------------- */
/*  Install                                      */
/* -------------------------------------------- */

let installed = false;

/** Register the carrier's runners, claimant, relays and listeners, once. */
export function installItemRun() {
  if (installed) return;
  installed = true;
  registerActivationRunner("once", runOnce);
  registerActivationRunner("toggle", runToggle);
  registerHandler(HANDLER.use, (payload) => runUse(payload));
  registerHandler(HANDLER.press, (payload) => pressHere(payload));
  setReachHandler(handleReachMoment);
  setReachTeardown(liftActivation);
  const on = (kind) => (combat, combatantId) => {
    if (isPrimaryGM()) void liftFuses(combat, combatantId, kind);
  };
  Hooks.on(TURN_BEGAN_HOOK, on("began"));
  Hooks.on(TURN_ENDED_HOOK, on("ended"));
  Hooks.on("deleteCombat", async (combat) => {
    if (!isPrimaryGM()) return;
    const { worldActors } = await import("./repair.mjs");
    const actors = [...[...(combat?.combatants ?? [])].map((c) => c?.actor), ...worldActors()];
    await convertFuses(combat, actors, { now: game.time.worldTime, roundSeconds: roundSeconds() });
    await liftWorldFuses(actors, game.time.worldTime);
  });
  onWorldTimeAdvanced(async (worldTime) => {
    const { worldActors } = await import("./repair.mjs");
    await liftWorldFuses(worldActors(), worldTime);
  });
}

/**
 * Register the carrier's claimant on `Item#use` (`patches/item-use.mjs`), at
 * `init`: it claims an item whose `itemRun.activation` kind has a runner, and
 * declines every spell, every ability with no activation and every unflagged
 * item.
 */
export function registerItemRunClaimant() {
  addItemUseClaimant({
    key: "itemRun",
    claims: (item) => claimsItemUse(item, runners.keys()),
    run: async (item) => void (await useItem(item)),
  });
}
