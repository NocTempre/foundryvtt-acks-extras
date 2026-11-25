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
 * - A timed record (the immunity window) ends on the world clock: it carries
 *   `itemRun.dueAt` and `liftDueRecords` deletes it once the clock reaches it.
 * - The fuse is stepped from lib's turn hooks as delayed damage is: the record
 *   is deleted first, then the registered burst runs (`setFuseBurst`), and a
 *   fight that ends moves it to the world clock.
 */
import { AURA_BEHAVIOR_TYPE, FLAG_FUSE, FLAG_ITEM_RUN, FLAG_ITEM_RUN_CARD, LANG_PREFIX, MODULE_ID, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "./constants.mjs";
import { carriesItem, figureNumber, momentKey, pulseAct, readAuraConfig, readReach, reachAdmits } from "./aura-reach-logic.mjs";
import { currentStamp, dispatchReachMoment, holdReachMoment, lowerReach, raiseReach, reachSnapshot, releaseReachMoment, setReachHandler, setReachTeardown } from "./aura-reach.mjs";
import { behaviorsUnder } from "./regions.mjs";
import {
  actionPartRecordData, activationRecordIds, checkPressRequest, chooseBearerToken, claimsItemUse, conditionRecordData, entryStateOf, fuseDue, fuseStep, fuseToWorld,
  dueAtAfter, dueRecordIds, immunityRecordData, itemCite, kindKeyOf, itemRunOf, itemRunRowsOf, mayUndoEntry, promptCardModel, reachFigures, reachParts, readFuse, selfCountUpdate, standingPartDiffers,
  standingPartId, standingPartRecordData, undoPlan,
} from "./item-run-logic.mjs";
import { admittedWithCount, freshKey, patchCountIn, patchOut, safeKey, standingCardAct } from "./item-run-card-logic.mjs";
import { addItemUseClaimant } from "./patches/item-use.mjs";
import { managedDelete } from "./managed-effects.mjs";
import { statusEffectData } from "./held-condition.mjs";
import { recordImmunity } from "./roll-mods.mjs";
import { saveSpec, saveThrow } from "./saves.mjs";
import { executeAsGM, judgeDeclares, registerHandler } from "./sockets.mjs";
import { roundSeconds, turnSeconds } from "./time-unit.mjs";
import { isPrimaryGM, makeLoc, unset } from "./util.mjs";
import { onWorldTimeAdvanced } from "./world-time.mjs";
import { isMarkerActor } from "./place.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The refusals the Judge and the Player have a line for; any other reason reads as a plain refusal. */
const REFUSALS = new Set(["gone", "notOwner", "noRunner", "noToken", "manyTokens", "noRow", "noRange", "noFigure", "snapshot", "unsupported", "notCarried", "down"]);

/** The socket handlers a Player's seat relays a use and a press through. */
const HANDLER = Object.freeze({ use: `${MODULE_ID}.itemRun.use`, press: `${MODULE_ID}.itemRun.press`, tick: `${MODULE_ID}.itemRun.tick`, untick: `${MODULE_ID}.itemRun.untick`, tickSubject: `${MODULE_ID}.itemRun.tickSubject`, undo: `${MODULE_ID}.itemRun.undo` });

/** The runner of each activation kind, the presenter of a use's result, the fuse's burst, and what hears a press and a lifted activation. */
const runners = new Map();
let presenter = null;
let burster = null;
let pressListener = null;
const liftListeners = [];

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

/**
 * Register what hears a card entry written or undone: `fn({message, key, entry, early, undone, item, row, subjectToken})`
 * runs after the entry reaches the card. One listener; a non-function clears it.
 */
export function setPressListener(fn) {
  pressListener = typeof fn === "function" ? fn : null;
}

/** Register what hears a lifted activation (`fn(config)`), after its records are off; any number. */
export function onActivationLifted(fn) {
  if (typeof fn === "function") liftListeners.push(fn);
}

/** Register the burst of a fuse: `fn({actor, record})` runs after the fuse's record is deleted; a non-function clears it, and an unset burst leaves every fuse unstepped. */
export function setFuseBurst(fn) {
  burster = typeof fn === "function" ? fn : null;
}

/* -------------------------------------------- */
/*  The use                                      */
/* -------------------------------------------- */

/** The bearer's token document on the scene this window views: a synthetic actor's own, else the first on the canvas. */
const canvasTokenOf = (actor) => (actor?.isToken ? actor.token : (actor?.getActiveTokens?.(false, true)?.[0] ?? null));

/** Every linked token of the actor on any scene, wherever it stands. */
function linkedTokensOf(actor) {
  const found = [];
  if (!actor?.id) return found;
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens ?? []) if (token.actorLink && token.actorId === actor.id) found.push(token);
  }
  return found;
}

/**
 * Every token an actor stands as, wherever it stands: a synthetic actor's own, else
 * those on the scene this window views and the actor's linked tokens on any scene,
 * each once. A lowering reads these, since the bearer's other bodies may stand on a
 * scene nobody views.
 */
export function tokensOfActor(actor) {
  if (actor?.isToken) return actor.token ? [actor.token] : [];
  const found = new Map();
  for (const token of [...(actor?.getActiveTokens?.(false, true) ?? []), ...linkedTokensOf(actor)]) found.set(token.uuid ?? token.id, token);
  return [...found.values()];
}

export { kindKeyOf };

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
  // Core never reports the bearer inside its own Region, so a bearer the item's filter counts (a choice kept across raises) has its standing part held here, as a Count in holds it.
  const reach = readReach(row.reach);
  if (reach?.pulse === "standing" && reach.filter.self === "count" && token.actor) await holdStanding({ config: { activationId }, item, row, subject: { token, actor: token.actor } });
  return { ok: true, kind: "toggle", active: true, activationId, itemUuid: item.uuid, rowKey: row.key, tokenUuid: token.uuid, regionUuid: raised.regionUuid ?? "" };
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
  const figures = reachFigures(row);
  const direct = !figures.save && figures.on.length > 0;
  const parts = direct ? reachParts(figures.on, figures.modifier, figures.saveWhen) : [];
  if (direct && !parts.length) return { ok: false, reason: "noFigure" };
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
  if (direct) {
    const written = [];
    for (const subject of admitted.filter((s) => !s.immune)) {
      const actor = subjectOf(subject.key)?.actor;
      if (!actor) continue;
      const made = await actor.createEmbeddedDocuments("ActiveEffect", [actionPartRecordData({ name: item.name, parts, source: item.uuid, activationId, rowKey: row.key, cite: itemCite(item) })]);
      written.push({ ...subject, recordIds: made.map((e) => e.id) });
    }
    return { ok: true, kind: "once", activationId, rowKey: row.key, subjects: admitted, written, undetermined };
  }
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
 * The bearer's token is the one the pressing seat resolved (`tokenUuid`, which
 * must be the item's actor's), since this window may view another scene than
 * the bearer's; with none named it is the token on this window's scene, then
 * the actor's one linked token on any scene (`chooseBearerToken`).
 *
 * @param {{itemUuid: string, tokenUuid?: string, requestUserId?: string|null}} p
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function runUse({ itemUuid, tokenUuid = "", requestUserId = null }) {
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
  const chosen = chooseBearerToken({
    carried: tokenUuid ? fromUuidSync(tokenUuid) : null,
    carries: (candidate) => carriesItem(actor, candidate),
    canvas: canvasTokenOf(actor),
    linked: () => linkedTokensOf(actor),
  });
  if (!chosen.ok) return refuse(chosen.reason);
  const token = chosen.token;
  const result = await runner({ item, run, actor, token, judge: !requestUserId });
  if (!result.ok) return refuse(result.reason ?? "refused");
  await presenter?.(result);
  return result;
}

/**
 * Take an item's use: run it here on the GM's window, or relay it from a
 * Player's seat. The request carries the uuid of the bearer's token as this
 * window resolves it, so the GM's window, which may view another scene, runs
 * against the token the seat sees.
 */
export async function useItem(item) {
  const tokenUuid = canvasTokenOf(item.actor)?.uuid ?? "";
  if (game.user.isGM) return runUse({ itemUuid: item.uuid, tokenUuid });
  return (await executeAsGM(HANDLER.use, { itemUuid: item.uuid, tokenUuid })) ?? { ok: false, reason: "relay" };
}

/* -------------------------------------------- */
/*  A press, and Undo                            */
/* -------------------------------------------- */

/** Presses being written, `messageId|entry`: a second press of the same entry while the first is mid-write is refused as applied. */
const writing = new Set();

/** The save a row asks of a subject: the reach's own reference read now, else the row's `target`. */
export const saveNameOf = (row) => reachFigures(row)?.save ?? String(row?.target ?? "");

/** The subject's token document, from the id a card button names. */
const subjectOf = (uuid) => fromUuidSync(uuid);

/** The raised or prompt card a press names: its chat message and the state it holds (`FLAG_ITEM_RUN_CARD`), or nulls. */
export function cardOf(messageId) {
  const message = messageId ? (game.messages?.get?.(messageId) ?? null) : null;
  const card = message?.getFlag?.(MODULE_ID, FLAG_ITEM_RUN_CARD) ?? message?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD] ?? null;
  return { message, card };
}

/** The raised card posted for an activation, as `{message, card}` (nulls where none is stored): found by the activation id its flag carries. */
export function cardOfActivation(activationId) {
  const found = activationId ? Array.from(game.messages ?? []).find((m) => (m?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD] ?? m?.getFlag?.(MODULE_ID, FLAG_ITEM_RUN_CARD))?.activationId === activationId) : null;
  return found ? cardOf(found.id) : { message: null, card: null };
}

/** Card writes in flight, by message: one chain each, so decisions read what the one before wrote. */
const chains = new Map();

/** Run `fn` after every earlier write to this message has settled. */
export function serialized(messageId, fn) {
  const run = (chains.get(messageId) ?? Promise.resolve()).catch(() => {}).then(fn);
  chains.set(messageId, run);
  return run;
}

/**
 * Write a dotted patch to a card (`FLAG_ITEM_RUN_CARD`): one update, each path under the flag, so two entries land without overwriting
 * each other. A value that is `unset()` deletes the key it is written to.
 */
export function patchCard(message, patch) {
  const base = `flags.${MODULE_ID}.${FLAG_ITEM_RUN_CARD}`;
  return message.update(Object.fromEntries(Object.entries(patch).map(([path, value]) => [`${base}.${path}`, value])));
}

/** The user ids that own a document, by Foundry's own test. */
export const ownerIdsOf = (doc) => (game.users ?? []).filter((u) => doc?.testUserPermission?.(u, "OWNER")).map((u) => u.id);

/**
 * The GM's side of a press. The request names ids and two figures the seat
 * rolled (`total`, `target`); everything else is read here: the item and its
 * row by id, the save's target recomputed from the row's live reference, the
 * entry's state and the card's own ids from the card the message holds, and the
 * immunity window from the row's `reach.immunity`. An entry is named by its key
 * (a moment's); a press naming none on a subject the card lists as waiting is an
 * early press, which only the Judge's own seat makes, and it opens an entry under
 * the moment of now. A relayed press names a card that holds the row, and an
 * entry already written, or struck, is refused. On a verdict it writes the
 * records a failed save (a condition per condition key the row names) or a
 * passed one (the immunity window) calls for, and the entry onto the card. The
 * immunity window carries the card's own id (`cardId`, else a fresh one), never
 * the activation's, so lowering the item takes its conditions and leaves the
 * window. Answers `{ok, saved, entry}`.
 */
async function pressHere(payload) {
  const { itemUuid, subject: subjectUuid, total, target, messageId = "", requestUserId = null } = payload;
  const { message, card: named } = cardOf(messageId);
  const card = named?.itemUuid === itemUuid ? named : null;
  const rowKey = card?.rowKey ?? payload.rowKey;
  const activationId = card?.activationId ?? payload.activationId;
  const subKey = safeKey(subjectUuid);
  const asked = payload.entryKey ? String(payload.entryKey) : "";
  const waiting = !!card?.subjects?.[subKey] && !asked;
  const claim = `${messageId}|${asked || subKey}`;
  if (writing.has(claim)) return { ok: false, reason: "applied" };
  writing.add(claim);
  try {
    const item = fromUuidSync(itemUuid);
    const row = itemRunRowsOf(item).find((r) => r?.key === rowKey) ?? null;
    const subjectToken = subjectOf(subjectUuid);
    const actor = subjectToken?.actor ?? null;
    const spec = actor && row ? saveSpecOf(actor, row) : null;
    const key = asked || (waiting ? freshKey(card.entries, safeKey(momentKey({ ...fightNow(), subjectUuid, kindKey: kindKeyOf(item, row) }) ?? subKey)) : subKey);
    const verdict = checkPressRequest(
      { requestUserId, total, target },
      {
        item, row, subjectOwnerIds: ownerIdsOf(subjectToken), target: spec?.target ?? null, entryState: entryStateOf(card, key), waiting, judge: judgeDeclares(requestUserId),
        struck: card?.kind !== "once" && !!asked && !!card?.entries && !card.entries[asked],
      },
    );
    if (!verdict.ok) return verdict;
    if (requestUserId && !card) return { ok: false, reason: "noCard" };
    const flags = { source: itemUuid, activationId, rowKey };
    const records = [];
    const names = [];
    let life = "raised";
    if (!verdict.saved) {
      const lifeFor = lifeOf(subjectToken);
      life = lifeFor.turnLife ? "turn" : "mark";
      for (const status of row.conditions ?? []) {
        const statusData = await statusEffectData(status);
        names.push(statusData?.name ?? String(status));
        records.push(conditionRecordData({ statusData, ...flags, life: lifeFor }));
      }
    } else {
      const dueAt = dueAtAfter(reachFigures(row)?.immunityTurns, turnSeconds(), game.time?.worldTime);
      if (dueAt !== null) records.push(immunityRecordData({ name: item.name, spellKey: kindKeyOf(item, row), dueAt, cite: itemCite(item), ...flags, activationId: card?.cardId || foundry.utils.randomID() }));
    }
    const made = records.length ? await actor.createEmbeddedDocuments("ActiveEffect", records) : [];
    const prior = card?.entries?.[key] ?? {};
    const entry = { ...prior, subject: subjectUuid, state: "applied", saved: verdict.saved, total: verdict.total, target: verdict.target, recordIds: made.map((e) => e.id), names, life, presser: requestUserId ?? game.user?.id ?? "", ...(verdict.early ? { early: true } : {}) };
    if (prior.momentKey) releaseReachMoment(prior.momentKey);
    if (message && card) {
      const patch = { [`entries.${key}`]: entry };
      if (verdict.early) patch[`subjects.${subKey}.latest`] = key;
      await serialized(messageId, () => patchCard(message, patch));
    }
    await pressListener?.({ message, key, entry, early: verdict.early === true, item, row, subjectToken });
    return { ok: true, saved: verdict.saved, entry };
  } finally {
    writing.delete(claim);
  }
}

/** The save's spec for a subject: the row's save name through `saveSpec`. */
function saveSpecOf(actor, row) {
  const name = saveNameOf(row);
  return name ? saveSpec(actor, name) : null;
}

/** A condition's clock: the start of the subject's next turn where it is in a fight; outside one, the mark lib's turn start lifts at its first initiative in a fight. */
function lifeOf(subjectToken) {
  const combat = game.combat;
  const combatant = combat?.combatants?.find?.((c) => c.tokenId === subjectToken?.id);
  return combatant ? { turnLife: { combatId: combat.id, combatantId: combatant.id, edge: "start", count: 1 } } : { mark: true };
}

/** The fight's present initiative as `momentKey` reads it: all null outside a begun fight. */
function fightNow() {
  const combat = game.combat?.started ? game.combat : null;
  return { combatId: combat?.id ?? null, round: combat?.round ?? null, turn: combat?.turn ?? null };
}

/**
 * A press on a prompt card's row, from the presser's seat: roll the subject's
 * save here and relay the ids and the total, never a verdict, a window or an
 * entry state; the GM reads those from the card and the item and writes. A
 * Judge's press runs here.
 *
 * @param {{itemUuid: string, rowKey: string, activationId: string, subject: string, messageId?: string, entryKey?: string}} p
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
  const payload = { itemUuid: p.itemUuid, rowKey: p.rowKey, activationId: p.activationId, subject: p.subject, messageId: p.messageId ?? "", entryKey: p.entryKey ?? "", total: thrown.total, target: thrown.target };
  if (game.user.isGM) return pressHere(payload);
  return (await executeAsGM(HANDLER.press, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * Undo one card row, on the window that may write the subject's records (the
 * primary GM's; `undoCardEntry` asks who may): delete exactly the record ids the
 * row stored that still exist on the subject, passing `managedDelete()`. The
 * Region, the activation's state and the item's quantity are never touched.
 *
 * @param {{subject: string, entry: {recordIds?: string[]}}} p
 * @returns {Promise<{ok: boolean, removed: string[]}>}
 */
export async function undoEntry({ subject, entry }) {
  const actor = subjectOf(subject)?.actor;
  if (!actor) return { ok: false, removed: [] };
  const { ids } = undoPlan(entry, [...actor.effects].map((e) => e.id));
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, managedDelete());
  return { ok: true, removed: ids };
}

/**
 * The writing half of an Undo, on the primary GM's window: the seat that
 * applied the entry and the owners of its subject's token may undo it, by
 * Foundry's ownership on the relayed seat (`mayUndoEntry`); any other seat is
 * refused. It removes the entry's own records (`undoEntry`) and marks the entry
 * undone, so it offers no second press and the subject's next moment asks again.
 * An entry that is not applied is refused.
 */
async function undoHere({ messageId, entryKey, requestUserId = null }) {
  const { message, card } = cardOf(messageId);
  const entry = card?.entries?.[entryKey];
  if (!entry) return { ok: false, reason: "gone" };
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!mayUndoEntry(entry, user?.id, ownerIdsOf(subjectOf(entry.subject)))) return { ok: false, reason: "notOwner" };
  if (entry.state !== "applied") return { ok: false, reason: "applied" };
  const done = await undoEntry({ subject: entry.subject, entry });
  if (!done.ok) return { ok: false, reason: "gone" };
  await serialized(messageId, () => patchCard(message, { [`entries.${entryKey}.state`]: "undone", [`entries.${entryKey}.recordIds`]: [] }));
  await pressListener?.({ message, key: entryKey, entry: { ...entry, state: "undone" }, undone: true, early: false });
  return { ok: true, removed: done.removed };
}

/**
 * Undo one entry of a card from any seat: it goes to the primary GM's window,
 * which writes where the pressing seat could not and checks ownership again on
 * the server-attested sender.
 *
 * @param {{messageId: string, entryKey: string}} p
 * @returns {Promise<{ok: boolean, removed?: string[], reason?: string}>}
 */
export async function undoCardEntry(p) {
  return (await executeAsGM(HANDLER.undo, { messageId: p.messageId, entryKey: p.entryKey })) ?? { ok: false, reason: "relay" };
}

/**
 * Count the bearer in as a subject of its own reach, on the GM's window: the
 * item's row takes `filter.self` `count`, and the card lists the bearer. Under a
 * prompting reach the bearer waits for its own turn start; under a standing
 * reach its part is held on it at once, under the card's activation as an
 * admitted body's is, so lowering lifts it, and a standing reach with no figure
 * imported refuses the count; on a lowered card nothing is held and the choice
 * is kept for the next raise (`runToggle` holds it then). Whoever owns the ITEM,
 * by Foundry's own test on the relayed seat, may press it; a seat that does not
 * is refused.
 *
 * @param {{itemUuid: string, rowKey: string, messageId: string, requestUserId?: string|null}} p
 */
async function countBearerIn({ itemUuid, rowKey, messageId, requestUserId = null }) {
  const item = fromUuidSync(itemUuid);
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!item) return { ok: false, reason: "gone" };
  if (!item.testUserPermission?.(user, "OWNER")) return { ok: false, reason: "notOwner" };
  const update = selfCountUpdate(item, rowKey);
  if (!update) return { ok: false, reason: "noRow" };
  const { message, card } = cardOf(messageId);
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  const reach = readReach(row?.reach);
  if (reach?.filter.self === "count") return { ok: false, reason: "applied" };
  const holds = !!(message && card) && reach?.pulse === "standing" && card.lowered !== true;
  const token = holds ? fromUuidSync(card.bearer?.uuid ?? "") : null;
  if (holds) {
    if (!token?.actor) return { ok: false, reason: "gone" };
    const figures = reachFigures(row);
    if (!(figures ? reachParts(figures.on, figures.modifier, figures.saveWhen) : []).length) return { ok: false, reason: "noFigure" };
  }
  await item.update({ [update.path]: update.value });
  if (message && card) {
    const bearer = card.bearer ?? {};
    await serialized(messageId, async () => {
      if (holds) await holdStanding({ config: { activationId: card.activationId }, item, row, subject: { token, actor: token.actor } });
      await patchCard(message, { selfCount: true, [`subjects.${safeKey(bearer.uuid)}`]: { uuid: bearer.uuid, name: bearer.name, state: "in", latest: "" } });
    });
  }
  await pressListener?.({ message, key: "", entry: null, early: false, counted: true, item });
  return { ok: true };
}

/**
 * Count the bearer out again, on the GM's window: the item's row takes
 * `filter.self` `no`, the bearer's row leaves the card and every entry still
 * open for it is struck, its held moment released. Under a standing reach the
 * part held on the bearer is released (`releaseStanding`: that one record, and
 * none where another reach of the kind still holds the bearer, which then keeps
 * it). What an answered entry wrote stays, with its Undo, and lowering never
 * resets the choice. Whoever owns the ITEM, by Foundry's own test on the
 * relayed seat, may press it.
 *
 * @param {{itemUuid: string, rowKey: string, messageId: string, requestUserId?: string|null}} p
 */
async function countBearerOut({ itemUuid, rowKey, messageId, requestUserId = null }) {
  const item = fromUuidSync(itemUuid);
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!item) return { ok: false, reason: "gone" };
  if (!item.testUserPermission?.(user, "OWNER")) return { ok: false, reason: "notOwner" };
  const update = selfCountUpdate(item, rowKey, false);
  if (!update) return { ok: false, reason: "noRow" };
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  const reach = readReach(row?.reach);
  if (reach?.filter.self !== "count") return { ok: false, reason: "applied" };
  await item.update({ [update.path]: update.value });
  const { message, card } = cardOf(messageId);
  if (message && card) {
    const bearer = card.bearer ?? {};
    const out = patchOut(card, { uuid: bearer.uuid, name: bearer.name });
    for (const entry of out.struck) releaseReachMoment(entry.momentKey);
    const token = reach.pulse === "standing" ? fromUuidSync(bearer.uuid ?? "") : null;
    const region = token && card.regionUuid ? fromUuidSync(card.regionUuid) : null;
    await serialized(messageId, async () => {
      if (token?.actor) await releaseStanding({ item, row, subject: { token, actor: token.actor }, region });
      await patchCard(message, { selfCount: false, ...out.patch, [`subjects.${safeKey(bearer.uuid)}`]: unset() });
    });
  }
  await pressListener?.({ message, key: "", entry: null, early: false, counted: false, item });
  return { ok: true };
}

/**
 * Count a body a raised reach's filter could not settle in for this raise, on the
 * GM's window: the body leaves the card's undetermined list, is listed as in
 * reach and is recorded under `counted`, so every later moment of the reach reads
 * it as a body the filter admits (a prompt at its turn start, a standing part on
 * its entry). A standing reach holds its part on the body at once, as an admitted
 * entry does. The body must be inside the reach's Region now; one that left is
 * dropped from the list and refused. Nothing is written to the item, and
 * lowering returns the body to undetermined.
 */
async function countSubjectInRaised({ messageId, message, card, item, subject }) {
  const key = safeKey(subject);
  if (!card.undetermined?.[key]) return { ok: false, reason: "applied" };
  const row = itemRunRowsOf(item).find((r) => r?.key === card.rowKey);
  const reach = readReach(row?.reach);
  const token = subjectOf(subject);
  const region = card.regionUuid ? fromUuidSync(card.regionUuid) : null;
  if (!row || !reach || !token?.actor || !region) return { ok: false, reason: "gone" };
  const standing = reach.pulse === "standing";
  if (standing) {
    const figures = reachFigures(row);
    if (!(figures ? reachParts(figures.on, figures.modifier, figures.saveWhen) : []).length) return { ok: false, reason: "noFigure" };
  }
  const outcome = await serialized(messageId, async () => {
    const fresh = cardOf(messageId).card;
    if (!fresh || fresh.lowered) return { ok: false, reason: "gone" };
    const held = fresh.undetermined?.[key];
    if (!held) return { ok: false, reason: "applied" };
    if (![...(region.tokens ?? [])].some((t) => t.uuid === subject)) {
      await patchCard(message, { [`undetermined.${key}`]: unset() });
      return { ok: false, reason: "gone" };
    }
    if (standing) await holdStanding({ config: { activationId: fresh.activationId }, item, row, subject: { token, actor: token.actor } });
    await patchCard(message, patchCountIn(fresh, { uuid: subject, name: held.name }));
    return { ok: true };
  });
  if (outcome.ok) await pressListener?.({ message, key, entry: null, early: false, counted: true, item });
  return outcome;
}

/**
 * Count a body a use's filter could not settle in, on the GM's window. On a
 * once-only use's card the body leaves the undetermined list and joins its
 * subjects: a use that applies a part with no save writes that part's record at
 * once, under an applied entry the card's Undo takes back; a use with a save
 * leaves the body's Save press open. On a raised item's card the count lasts
 * until the item is lowered (`countSubjectInRaised`). Nothing is written to the
 * item. Whoever owns the ITEM, by Foundry's own test on the relayed seat, may
 * press it.
 *
 * @param {{messageId: string, subject: string, requestUserId?: string|null}} p
 */
async function countSubjectIn({ messageId, subject, requestUserId = null }) {
  const { message, card } = cardOf(messageId);
  if (!message || !["once", "toggle"].includes(card?.kind)) return { ok: false, reason: "noCard" };
  const item = fromUuidSync(card.itemUuid);
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!item) return { ok: false, reason: "gone" };
  if (!item.testUserPermission?.(user, "OWNER")) return { ok: false, reason: "notOwner" };
  if (card.kind === "toggle") return countSubjectInRaised({ messageId, message, card, item, subject });
  const key = safeKey(subject);
  const held = card.undetermined?.[key];
  if (!held) return { ok: false, reason: "applied" };
  const row = itemRunRowsOf(item).find((r) => r?.key === card.rowKey);
  const actor = subjectOf(subject)?.actor;
  if (!row || !actor) return { ok: false, reason: "gone" };
  const patch = { [`subjects.${key}`]: { uuid: subject, name: held.name, state: "in", latest: "" }, [`undetermined.${key}`]: unset() };
  if (card.direct) {
    if (recordImmunity(actor, { spell: { id: kindKeyOf(item, row) } }).spell) return { ok: false, reason: "immune" };
    const figures = reachFigures(row);
    const parts = figures ? reachParts(figures.on, figures.modifier, figures.saveWhen) : [];
    if (!parts.length) return { ok: false, reason: "noFigure" };
    const made = await actor.createEmbeddedDocuments("ActiveEffect", [actionPartRecordData({ name: item.name, parts, source: item.uuid, activationId: card.activationId, rowKey: row.key, cite: itemCite(item) })]);
    patch[`entries.${key}`] = { subject, state: "applied", recordIds: made.map((e) => e.id), presser: requestUserId ?? game.user?.id ?? "" };
  }
  await serialized(messageId, () => patchCard(message, patch));
  await pressListener?.({ message, key, entry: null, early: false, counted: true, item });
  return { ok: true };
}

/**
 * Count an undetermined body in for a once-only use or a raised item's raise,
 * from any seat: the GM's window runs it, a Player's seat relays it and the GM
 * checks the seat owns the item.
 * @param {{messageId: string, subject: string}} p
 */
export async function tickSubject(p) {
  if (game.user.isGM) return countSubjectIn(p);
  return (await executeAsGM(HANDLER.tickSubject, { messageId: p.messageId, subject: p.subject })) ?? { ok: false, reason: "relay" };
}

/**
 * Count the bearer out, from any seat: the GM's window runs it, a Player's seat
 * relays it and the GM checks the seat owns the item.
 * @param {{itemUuid: string, rowKey: string, messageId: string}} p
 */
export async function untickBearer(p) {
  if (game.user.isGM) return countBearerOut(p);
  return (await executeAsGM(HANDLER.untick, p)) ?? { ok: false, reason: "relay" };
}

/**
 * Count the bearer in, from any seat: the GM's window runs it, a Player's seat
 * relays it and the GM checks the seat owns the item.
 * @param {{itemUuid: string, rowKey: string, messageId: string}} p
 */
export async function tickBearer(p) {
  if (game.user.isGM) return countBearerIn(p);
  return (await executeAsGM(HANDLER.tick, p)) ?? { ok: false, reason: "relay" };
}

/* -------------------------------------------- */
/*  The reach's moments, and the teardown        */
/* -------------------------------------------- */

/**
 * A moment of a reach: a subject's immunity is read, the act decided
 * (`pulseAct`), a standing part written or taken off, and every other act (a
 * listing, a muting, a prompt, an undetermined subject) handed to the
 * presenter as `{kind: "reach", ...}`. A standing part's entry or exit reaches
 * the presenter only as `standingCardAct` reads the card: a row it holds comes
 * back in reach or is muted, and a body held undetermined is dropped at its exit. A prompt is held under its moment key
 * (`momentKey`) until it is answered or struck, so a subject is asked once per
 * item kind and initiative; a prompt already held is answered `held`. Answers
 * the act taken, or null where there was none.
 */
export async function handleReachMoment({ moment, config, item, row, reach, subject, admitted, region }) {
  const immune = !!recordImmunity(subject.actor, { spell: { id: kindKeyOf(item, row) } }).spell;
  const undecided = admitted === null || admitted === undefined;
  const { card } = cardOfActivation(config.activationId);
  const verdict = undecided ? admittedWithCount(admitted, card, subject.token?.uuid) : admitted;
  const counted = undecided && verdict === true;
  const act = pulseAct({ pulse: reach.pulse, moment, admitted: verdict, immune });
  if (act === "none" || !subject.actor) return null;
  if (act === "refuse" && isMarkerActor(subject.actor)) return null;
  if (act === "on" || act === "off") {
    if (act === "on") await holdStanding({ config, item, row, subject });
    else await releaseStanding({ item, row, subject, region });
    // A standing reach lists nobody; the card keeps current the rows it already holds (a body counted in, one Check range again listed) and drops an undetermined body at its exit.
    const cardAct = standingCardAct(card, subject.token?.uuid, { act, counted });
    if (cardAct) await presenter?.({ ok: true, kind: "reach", act: cardAct, moment, config, rowKey: row.key, item, subject });
    return act;
  }
  const result = { ok: true, kind: "reach", act, moment, config, rowKey: row.key, item, subject };
  if (act === "prompt") {
    const key = momentKey({ ...fightNow(), subjectUuid: subject.token?.uuid, kindKey: kindKeyOf(item, row) });
    if (!holdReachMoment(key, currentStamp())) return "held";
    result.momentKey = key;
  }
  await presenter?.(result);
  return act;
}

/**
 * Hold a standing part on a subject that is inside a reach: one record per
 * subject per item kind under the fixed id `standingPartId`, whose parts are
 * the row's modifier read now. Written only where the record is absent or
 * differs, so a re-entry or a second bearer of the kind rewrites nothing and
 * never stacks a second record. A blank modifier writes nothing.
 */
export async function holdStanding({ config, item, row, subject }) {
  const figures = reachFigures(row);
  const parts = figures ? reachParts(figures.on, figures.modifier, figures.saveWhen) : [];
  if (!parts.length) return { written: false, reason: "noFigure" };
  const kindKey = kindKeyOf(item, row);
  const wanted = standingPartRecordData({ kindKey, name: item.name, parts, source: item.uuid, activationId: config.activationId, rowKey: row.key, cite: itemCite(item) });
  const existing = subject.actor.effects.get?.(wanted._id) ?? null;
  if (!standingPartDiffers(existing, wanted)) return { written: false, reason: "same" };
  if (existing) await existing.update({ name: wanted.name, origin: wanted.origin, flags: wanted.flags }, managedDelete());
  else await subject.actor.createEmbeddedDocuments("ActiveEffect", [wanted], { keepId: true });
  return { written: true };
}

/** The standing reaches other than `except` that hold a subject now and are of the item kind `kindKey`: `[{config, item, row}]`. */
function otherStanding(subjectToken, kindKey, except) {
  const out = [];
  for (const { region, behavior } of behaviorsUnder(subjectToken, AURA_BEHAVIOR_TYPE)) {
    if (!region || region.id === except?.id) continue;
    const config = readAuraConfig(behavior.system);
    const other = config ? fromUuidSync(config.sourceUuid) : null;
    const row = itemRunRowsOf(other).find((r) => r?.key === config?.rowKey);
    if (!row || readReach(row.reach)?.pulse !== "standing" || kindKeyOf(other, row) !== kindKey) continue;
    out.push({ config, item: other, row });
  }
  return out;
}

/**
 * A subject left a standing reach: take its part off, unless it is still inside
 * another reach of the same item kind, in which case the record is rewritten to
 * that reach (its source and activation) so the first bearer's lowering does not
 * take a part another bearer still gives.
 */
export async function releaseStanding({ item, row, subject, region }) {
  const kindKey = kindKeyOf(item, row);
  const id = standingPartId(kindKey);
  if (!subject.actor.effects.get?.(id)) return { released: false };
  const still = subject.token ? otherStanding(subject.token, kindKey, region) : [];
  if (still.length) {
    await holdStanding({ ...still[0], subject });
    return { released: false, retargeted: true };
  }
  await subject.actor.deleteEmbeddedDocuments("ActiveEffect", [id], managedDelete());
  return { released: true };
}

/**
 * The other raised reach of the same item kind and pulse that still holds a
 * subject token, other than `activationId`'s: `{config, item, row}`, or null.
 * A condition a grouped prompt wrote is handed on to it at its own reach's
 * teardown.
 */
function otherRaisedOfKind(tokens, { source, rowKey }, activationId) {
  const item = source ? fromUuidSync(source) : null;
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  if (!row) return null;
  const pulse = readReach(row.reach)?.pulse;
  for (const token of tokens) {
    for (const { behavior } of behaviorsUnder(token, AURA_BEHAVIOR_TYPE)) {
      const config = readAuraConfig(behavior.system);
      if (!config || config.activationId === activationId) continue;
      const other = fromUuidSync(config.sourceUuid);
      const otherRow = itemRunRowsOf(other).find((r) => r?.key === config.rowKey);
      if (otherRow && readReach(otherRow.reach)?.pulse === pulse && kindKeyOf(other, otherRow) === kindKeyOf(item, row)) return { config, item: other, row: otherRow };
    }
  }
  return null;
}

/**
 * Take a lowered activation's records off every actor that may hold one, and its
 * toggle state off the item. A condition a prompt wrote, where its subject is
 * still inside another raised reach of the same item kind, is handed on to that
 * reach (its source, activation and row) and stays; every other record is
 * deleted. Then each subject that lost a standing part and is still inside
 * another reach is offered to that reach again, so a part another bearer gives
 * is written back at once, and what hears a lifted activation is told.
 */
export async function liftActivation({ config }) {
  const { worldActors } = await import("./repair.mjs");
  const lifted = [];
  for (const actor of worldActors()) {
    const ids = activationRecordIds([...actor.effects], config.activationId);
    if (!ids.length) continue;
    const tokens = tokensOfActor(actor);
    const going = [];
    for (const id of ids) {
      const effect = actor.effects.get?.(id) ?? [...actor.effects].find((e) => e.id === id);
      const flag = effect?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN];
      const next = flag && effect?.update ? otherRaisedOfKind(tokens, flag, config.activationId) : null;
      if (next) await effect.update({ origin: next.item.uuid, [`flags.${MODULE_ID}.${FLAG_ITEM_RUN}`]: { source: next.item.uuid, activationId: next.config.activationId, rowKey: next.config.rowKey } }, managedDelete());
      else going.push(id);
    }
    if (going.length) await actor.deleteEmbeddedDocuments("ActiveEffect", going, managedDelete());
    lifted.push(actor);
  }
  for (const actor of lifted) {
    for (const token of tokensOfActor(actor)) {
      for (const { region, behavior } of behaviorsUnder(token, AURA_BEHAVIOR_TYPE)) {
        if (readAuraConfig(behavior.system)?.activationId === config.activationId) continue;
        await dispatchReachMoment({ ...behavior.system, region }, "enter", token);
      }
    }
  }
  const item = fromUuidSync(config.sourceUuid);
  if (item && itemRunOf(item)?.activation.state.activationId === config.activationId) await setState(item, { active: false, activationId: "", regionId: "" });
  for (const fn of liftListeners) {
    try {
      await fn(config);
    } catch (err) {
      console.error(`${MODULE_ID} | a lifted activation's listener failed`, err);
    }
  }
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

/**
 * The world clock reached the runner's timed records on these actors: delete
 * each whose `dueAt` has passed (`managedDelete()`, so no teardown hook reads
 * the lifting as an edit). One clock for the immunity window and every record a
 * later kind writes with a `dueAt`. Answers the ids lifted.
 */
export async function liftDueRecords(actors, worldTime) {
  const lifted = [];
  for (const actor of actors ?? []) {
    const ids = dueRecordIds([...(actor?.effects ?? [])], worldTime);
    if (!ids.length) continue;
    await actor.deleteEmbeddedDocuments("ActiveEffect", ids, managedDelete());
    lifted.push(...ids);
  }
  return lifted;
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
  registerHandler(HANDLER.tick, (payload) => countBearerIn(payload));
  registerHandler(HANDLER.untick, (payload) => countBearerOut(payload));
  registerHandler(HANDLER.tickSubject, (payload) => countSubjectIn(payload));
  registerHandler(HANDLER.undo, (payload) => undoHere(payload));
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
    const actors = worldActors();
    await liftWorldFuses(actors, worldTime);
    await liftDueRecords(actors, worldTime);
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
