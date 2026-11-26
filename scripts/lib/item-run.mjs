/* global game, Hooks, foundry, fromUuidSync, ui, Roll */
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
 *   (`setUsePresenter`), which posts the card; nothing here posts one.
 * - `consume` is the item's own actor drinking (`runConsume`): a count of swigs
 *   spent, then the bearer's heal, a human's `swig` save card or an unknown
 *   drinker's `swigUnknown` card, posted by `postOutcomeCard`; a consume item
 *   landing on an actor is stamped with it, and rolled a count when handed on.
 * - `fuse` rolls the bearer's proficiency throw (`runFuse`) and, on a lit result,
 *   writes the fuse record; the burst (`burstFuse`) rolls the blast once over the
 *   spot's area and answers the "burst" card. A burst card's Save is the common
 *   press; its damage is written by an explicit Apply (`registerPressOutcome`),
 *   which an Undo gives back. Structures the blast reaches are handed on
 *   (`registerStructureDamage`, `handOn`), and a fuse's spot and fuse are the
 *   owner's to move or set off (`moveFuseSpot`, `setFuseOffNow`).
 * - A save is rolled on the presser's seat and relayed (`pressRoll`); the GM
 *   checks the figure against the item's own row, resolved live, before writing
 *   (`checkPressRequest`), and an Undo removes the row's own record ids.
 * - The reach's moments land in `handleReachMoment`: a standing part is taken
 *   off at an exit, and every other act is offered to the presenter.
 * - A timed record (the immunity window) ends on the world clock: it carries
 *   `itemRun.dueAt` and `liftDueRecords` deletes it once the clock reaches it.
 * - The fuse is stepped from lib's turn hooks as delayed damage is: the record
 *   is deleted first, then the registered burst runs (`setFuseBurst`), and a
 *   fight that ends moves it to the world clock. A bearer whose last token is
 *   deleted bursts nothing: the Judge is told (`noBearer`).
 */
import { AURA_BEHAVIOR_TYPE, FLAG_DRINK, FLAG_FUSE, FLAG_ITEM_RUN, FLAG_ITEM_RUN_CARD, LANG_PREFIX, MODULE_ID, TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "./constants.mjs";
import { carriesItem, figureNumber, isEngagedActivation, momentKey, pulseAct, readAuraConfig, readReach, reachAdmits, resolveFigure } from "./aura-reach-logic.mjs";
import { currentStamp, dispatchReachMoment, holdReachMoment, lowerReach, raiseReach, reachSnapshot, releaseReachMoment, setReachHandler, setReachTeardown } from "./aura-reach.mjs";
import { behaviorsUnder } from "./regions.mjs";
import {
  actionPartRecordData, activationRecordIds, alwaysOn, blastOf, burstAmount, checkApplyRequest, checkPressRequest, chooseBearerToken, claimsItemUse, conditionRecordData, entryStateOf, fuseDue, fuseFlag, fuseLight, fuseRecordData, fuseSpot, fuseStep, fuseToWorld, fuseWorldFlag,
  dueAtAfter, dueRecordIds, immuneRecordId, immunityRecordData, itemCite, kindKeyOf, itemRunOf, itemRunRowsOf, lastsRecordId, mayUndoEntry, promptCardModel, reachFigures, reachParts, readFuse, selfCountUpdate, standingPartDiffers,
  standingPartId, standingPartRecordData, undoGuard, undoPlan,
} from "./item-run-logic.mjs";
import { creatureKinds } from "./actor-read.mjs";
import { DRINKER_KIND, drinkerKindOf, swigOutcome, swigStampPlan } from "./swig-logic.mjs";
import { adjustHp, resolveTargets } from "./hp.mjs";
import { HP_MODE, HP_REASON, hpEligibility } from "./hp-logic.mjs";
import { actorDefenses, defenseFigures, defenseStage } from "./defenses.mjs";
import { tokenCentre } from "./token-centre.mjs";
import { quantityOf } from "./storage-logic.mjs";
import { admittedWithCount, freshKey, patchCountIn, patchEngagedClose, patchEngagedReopen, patchOut, ownsEveryBearer, safeKey, standingCardAct } from "./item-run-card-logic.mjs";
import { addItemUseClaimant } from "./patches/item-use.mjs";
import { managedDelete } from "./managed-effects.mjs";
import { statusEffectData } from "./held-condition.mjs";
import { recordImmunity } from "./roll-mods.mjs";
import { saveSpec, saveThrow } from "./saves.mjs";
import { executeAsGM, judgeDeclares, registerHandler } from "./sockets.mjs";
import { roundSeconds, turnSeconds } from "./time-unit.mjs";
import { isPrimaryGM, makeLoc, plainRoll, unset } from "./util.mjs";
import { onWorldTimeAdvanced } from "./world-time.mjs";
import { isMarkerActor } from "./place.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The refusals the Judge and the Player have a line for; any other reason reads as a plain refusal. */
const REFUSALS = new Set(["gone", "notOwner", "noRunner", "noToken", "manyTokens", "noRow", "noRange", "noFigure", "snapshot", "unsupported", "notCarried", "down", "spent", "judgeOnly"]);

/** The socket handlers a Player's seat relays a use and a press through. */
const HANDLER = Object.freeze({
  use: `${MODULE_ID}.itemRun.use`, press: `${MODULE_ID}.itemRun.press`, tick: `${MODULE_ID}.itemRun.tick`, untick: `${MODULE_ID}.itemRun.untick`, tickSubject: `${MODULE_ID}.itemRun.tickSubject`, undo: `${MODULE_ID}.itemRun.undo`, notEngaged: `${MODULE_ID}.itemRun.notEngaged`,
  apply: `${MODULE_ID}.itemRun.apply`, applyAll: `${MODULE_ID}.itemRun.applyAll`, moveSpot: `${MODULE_ID}.itemRun.moveSpot`, setOff: `${MODULE_ID}.itemRun.setOff`, handOn: `${MODULE_ID}.itemRun.handOn`,
  postCard: `${MODULE_ID}.itemRun.postCard`, swigHeal: `${MODULE_ID}.itemRun.swigHeal`, swigAskSave: `${MODULE_ID}.itemRun.swigAskSave`,
});

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

/** Whether a runner is registered for an activation kind: the carrier claims an item's use only then, so a press offered on a row must ask this first. */
export const hasActivationRunner = (kind) => runners.has(kind);

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

/** Register the burst of a fuse: `fn({actor, record})` runs after the fuse's record is deleted; a non-function clears it, and an unset burst leaves every fuse unstepped. `installItemRun` registers `burstFuse`. */
export function setFuseBurst(fn) {
  burster = typeof fn === "function" ? fn : null;
}

/** What writes a card kind's outcome, by `card.kind`; a kind with none is written the common way (conditions and the immunity window). */
const outcomes = new Map();

/**
 * Register what writes a card kind's outcome, keyed on the stored card's `kind`
 * (`installItemRun` registers `burst`). The common press (`pressHere`) keeps its
 * lock, its verdict, its relay and its entry, and asks `fn` what to write:
 * `fn({phase, card, entry, key, saved, subjectToken, actor, userId})` answers
 * `{records, names, life, hp?, state?, judge?, why?}`, awaited.
 *
 * - `phase` "verdict" is the Save press, whose answer's `state` becomes the
 *   entry's (default "applied"): a kind that writes at an explicit Apply answers
 *   `state: "rolled"` and writes nothing here. A verdict that writes may also
 *   answer `hp` (stored on the entry, which an Undo gives back) and `amount`
 *   (stored on the entry). `judge: true` at the verdict leaves nothing written,
 *   whatever else the answer holds, and the entry in state "judge" with `why`.
 * - `phase` "apply" is the Apply press (`applyEntry`), over an entry in state
 *   "rolled": the answer's `records` are created on the subject's actor,
 *   `hp: [{uuid, amount}]` is what the press took (stored on the entry, which
 *   an Undo gives back), and `judge: true` leaves nothing written and the
 *   entry in state "judge", `why` naming the reason.
 *
 * A kind with an outcome also holds its own save and facts on the card: the
 * press reads them there and not off the item, which may be gone. A
 * non-function clears the kind.
 */
export function registerPressOutcome(cardKind, fn) {
  if (typeof fn === "function") outcomes.set(cardKind, fn);
  else outcomes.delete(cardKind);
}

let structureDamage = null;

/**
 * Register what writes a structure's damage: `fn({vehicleUuid, total, userId})`,
 * awaited, where `total` is the burst's rolled figure and `userId` the seat that
 * handed it on. One function, filled by vehicles; a non-function clears it, and
 * with none registered `handOn` is refused (`noStructure`).
 */
export function registerStructureDamage(fn) {
  structureDamage = typeof fn === "function" ? fn : null;
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
    return { ok: true, kind: "once", itemUuid: item.uuid, activationId, rowKey: row.key, subjects: admitted, written, undetermined };
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
  return { ok: true, kind: "once", itemUuid: item.uuid, activationId, rowKey: row.key, subjects: admitted, undetermined, card };
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
  if (!result.presented) await presenter?.(result);
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
 * window. A card whose kind has a registered outcome (`registerPressOutcome`)
 * reads its save off the card (`saveName`, through the card's own `saveMod`), the
 * item and row being gone with a consumed item, and asks that writer what the
 * entry holds: its `records`, `names`, `life`, `hp` and `amount`, or, where it
 * answers `judge`, nothing but the verdict and a `why` (entry state "judge").
 * A press carrying `declared` (a boolean) is the Judge's call on an outcome card
 * that names no save: nothing is thrown, the writer is asked with `saved` the
 * declared verdict, and the entry holds `declared: true` and no total or target. A
 * declared press on any other card is refused `figure`, and from a seat that is
 * not the Judge's, `judgeOnly`. Answers `{ok, saved, entry}`.
 */
async function pressHere(payload) {
  const { itemUuid, subject: subjectUuid, total, target, messageId = "", requestUserId = null } = payload;
  const { message, card: named } = cardOf(messageId);
  const asked = payload.entryKey ? String(payload.entryKey) : "";
  // An engaged card names no item, row or activation of its own: the entry it holds names them, and the press must match the entry's item.
  const engagedEntry = named?.kind === "engaged" ? (named.entries?.[asked] ?? null) : null;
  const card = named?.itemUuid === itemUuid || (engagedEntry?.itemUuid && engagedEntry.itemUuid === itemUuid) ? named : null;
  // A card kind with a registered outcome holds its own save and facts, so its press stands where the item, which a burst consumes, is gone.
  const outcome = outcomes.get(card?.kind) ?? null;
  const rowKey = engagedEntry?.rowKey ?? card?.rowKey ?? payload.rowKey;
  const activationId = engagedEntry?.activationId ?? card?.activationId ?? payload.activationId;
  const subKey = safeKey(subjectUuid);
  const waiting = !!card?.subjects?.[subKey] && !asked;
  const claim = `${messageId}|${asked || subKey}`;
  if (writing.has(claim)) return { ok: false, reason: "applied" };
  writing.add(claim);
  try {
    const item = fromUuidSync(itemUuid) ?? (outcome ? { uuid: itemUuid, name: card.title ?? "" } : null);
    const row = itemRunRowsOf(item).find((r) => r?.key === rowKey) ?? (outcome ? { key: rowKey } : null);
    const subjectToken = subjectOf(subjectUuid);
    const actor = subjectToken?.actor ?? null;
    const spec = actor && row ? (outcome ? (card.saveName ? saveSpec(actor, card.saveName, cardSaveOptions(card)) : null) : saveSpecOf(actor, row)) : null;
    const key = asked || (waiting ? freshKey(card.entries, safeKey(momentKey({ ...fightNow(), subjectUuid, kindKey: kindKeyOf(item, row) }) ?? subKey)) : subKey);
    const figures = row ? reachFigures(row) : null;
    const timed = figures?.lastsNamed === true;
    // A declared verdict is taken only on an outcome card that names no save; a card that names one is thrown for.
    const declared = typeof payload.declared === "boolean" ? payload.declared : undefined;
    if (declared !== undefined && !(outcome && !card.saveName)) return { ok: false, reason: "figure" };
    const verdict = checkPressRequest(
      { requestUserId, total, target, declared },
      {
        item, row, subjectOwnerIds: ownerIdsOf(subjectToken), target: spec?.target ?? null, entryState: entryStateOf(card, key), waiting, judge: judgeDeclares(requestUserId),
        struck: card?.kind !== "once" && !outcome && !!asked && !!card?.entries && !card.entries[asked],
        blankLasts: timed && figures.lasts === null,
      },
    );
    if (!verdict.ok) return verdict;
    if (requestUserId && !card) return { ok: false, reason: "noCard" };
    const flags = { source: itemUuid, activationId, rowKey };
    const records = [];
    const names = [];
    let life = "raised";
    let immune = null;
    let state = "applied";
    let hp = null;
    let amount = null;
    let why = "";
    if (outcome) {
      const done = await outcome({ phase: "verdict", card, entry: card.entries?.[key] ?? null, key, saved: verdict.saved, subjectToken, actor, userId: requestUserId });
      // A writer that answers `judge` at the verdict writes nothing: the entry holds the verdict and the Judge settles the rest.
      if (!done?.judge) {
        records.push(...(done?.records ?? []));
        names.push(...(done?.names ?? []));
        life = done?.life ?? life;
        hp = done?.hp ?? null;
        if (Number.isFinite(done?.amount)) amount = done.amount;
      }
      state = done?.judge ? "judge" : (done?.state ?? "applied");
      if (done?.judge) why = String(done.why ?? "");
    } else if (timed) {
      // A row with `reach.lasts` writes under fixed ids (one condition and one window per item kind, a later entry replacing the earlier one) and both records carry the card's id and never the activation's, so lowering the reach leaves them.
      const kindKey = kindKeyOf(item, row);
      const cardId = card?.cardId || foundry.utils.randomID();
      const own = { cardId, entryKey: key };
      if (!verdict.saved) {
        const dueAt = dueAtAfter(figures.lasts, turnSeconds(), game.time?.worldTime);
        life = dueAt !== null ? "timed" : "raised";
        let index = 0;
        for (const status of row.conditions ?? []) {
          const statusData = await statusEffectData(status);
          names.push(statusData?.name ?? String(status));
          records.push(conditionRecordData({ statusData, ...flags, activationId: cardId, life: dueAt !== null ? { dueAt } : {}, id: lastsRecordId(kindKey, status, index++), ...own }));
        }
      } else {
        const dueAt = dueAtAfter(figures.immunityTurns, turnSeconds(), game.time?.worldTime);
        if (dueAt !== null) {
          immune = figures.immunityTurns;
          records.push(immunityRecordData({ name: item.name, spellKey: kindKey, dueAt, cite: itemCite(item), ...flags, activationId: cardId, id: immuneRecordId(kindKey), ...own }));
        }
      }
      const earlier = records.map((r) => r._id).filter((id) => actor.effects?.get?.(id));
      if (earlier.length) await actor.deleteEmbeddedDocuments("ActiveEffect", earlier, managedDelete());
    } else if (!verdict.saved) {
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
    const made = !records.length ? [] : timed ? await actor.createEmbeddedDocuments("ActiveEffect", records, { keepId: true }) : await actor.createEmbeddedDocuments("ActiveEffect", records);
    const prior = card?.entries?.[key] ?? {};
    const entry = { ...prior, subject: subjectUuid, state, saved: verdict.saved, ...(verdict.declared ? { declared: true } : { total: verdict.total, target: verdict.target }), recordIds: made.map((e) => e.id), names, life, presser: requestUserId ?? game.user?.id ?? "", ...(hp ? { hp } : {}), ...(amount !== null ? { amount } : {}), ...(why ? { why } : {}), ...(immune !== null ? { immune } : {}), ...(verdict.early ? { early: true } : {}) };
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

/**
 * A condition's clock: the `edge` ("start" by default, or "end") of the subject's next turn where it is in a
 * fight; outside one, the mark lib's turn start lifts at its first initiative in a fight.
 */
function lifeOf(subjectToken, edge = "start") {
  const combat = game.combat;
  const combatant = combat?.combatants?.find?.((c) => c.tokenId === subjectToken?.id);
  return combatant ? { turnLife: { combatId: combat.id, combatantId: combatant.id, edge, count: 1 } } : { mark: true };
}

/**
 * The options a prompt card's own save modifier adds to its save (`saveSpec`'s `situational`, which rides on the
 * throw: a positive figure helps the saver). The one reader of `card.saveMod`: the throw a seat rolls
 * (`pressRoll`) and the target the GM recomputes (`pressHere`) both take their save through it, so the two
 * agree. A card holding no modifier, a zero or a figure that is no number adds nothing.
 */
export function cardSaveOptions(card) {
  const raw = card?.saveMod;
  const mod = raw === null || raw === undefined || raw === "" ? NaN : Number(raw);
  return Number.isFinite(mod) && mod !== 0 ? { situational: mod } : {};
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
 * Judge's press runs here. A press carrying `declared` (a boolean) is the Judge's
 * call on an outcome card that names no save: nothing is thrown, a seat that is not
 * the Judge's is refused `judgeOnly` and a card that names a save `figure`, and
 * the verdict goes to the writer as the declared one.
 *
 * @param {{itemUuid: string, rowKey: string, activationId: string, subject: string, messageId?: string, entryKey?: string, declared?: boolean}} p
 * @returns {Promise<{ok: boolean, entry?: object, reason?: string}>}
 */
export async function pressRoll(p) {
  const item = fromUuidSync(p.itemUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === p.rowKey);
  const actor = subjectOf(p.subject)?.actor;
  const stored = outcomes.has(cardOf(p.messageId).card?.kind) ? cardOf(p.messageId).card : null;
  if (typeof p.declared === "boolean") {
    if (!judgeDeclares()) return { ok: false, reason: "judgeOnly" };
    if (!actor || !stored || stored.saveName) return { ok: false, reason: stored ? "figure" : "noFigure" };
    const declaredPayload = { itemUuid: p.itemUuid, rowKey: p.rowKey, activationId: p.activationId, subject: p.subject, messageId: p.messageId ?? "", entryKey: p.entryKey ?? "", declared: p.declared };
    return pressHere(declaredPayload);
  }
  const name = stored ? String(stored.saveName ?? "") : saveNameOf(row);
  if (!actor || !name) return { ok: false, reason: "noFigure" };
  const figures = stored ? null : reachFigures(row);
  if (figures?.lastsNamed === true && figures.lasts === null && !judgeDeclares()) return { ok: false, reason: "noFigure" };
  const thrown = await saveThrow(actor, name, cardSaveOptions(stored));
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
 * A record kept under a fixed id (`reach.lasts`) is deleted only while the
 * `entryKey` it carries is this entry's: a later entry may have replaced it.
 *
 * An entry that took hit points (`hp: [{uuid, amount}]`, `amount` what the press
 * took from the body `uuid` names) has them given back through `adjustHp`, each
 * as a heal (a heal an entry made is taken back as damage). `restored` is then
 * `[{uuid, amount, ok}]`, `amount` `undoPlan`'s own (damage written back is
 * negative: -11 heals 11), and `ok` false for
 * a body that is gone or whose write did not land; `ok` is false for the whole
 * if any did not. It is absent from an entry that took none.
 *
 * @param {{subject: string, entry: {recordIds?: string[], hp?: Array<{uuid: string, amount: number}>}, entryKey?: string}} p
 * @returns {Promise<{ok: boolean, removed: string[], restored?: Array<{uuid: string, amount: number, ok: boolean}>}>}
 */
export async function undoEntry({ subject, entry, entryKey }) {
  const actor = subjectOf(subject)?.actor;
  const present = new Map([...(actor?.effects ?? [])].map((e) => [e.id, e]));
  const plan = undoPlan(entry, [...present.keys()]);
  if (!actor && !plan.hp.length) return { ok: false, removed: [] };
  const ids = !actor ? [] : entryKey === undefined ? plan.ids : undoGuard(plan.ids, (id) => present.get(id), entryKey);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids, managedDelete());
  if (!plan.hp.length) return { ok: true, removed: ids };
  const restored = await giveBackHp(plan.hp);
  return { ok: restored.every((r) => r.ok), removed: ids, restored };
}

/** Give back the hit points an `undoPlan` lists, one body at a time; `[{uuid, amount, ok}]`. */
async function giveBackHp(plan) {
  const restored = [];
  for (const { uuid, amount } of plan) {
    const actor = fromUuidSync(uuid);
    const target = actor ? resolveTargets({ actors: [actor] })[0] : null;
    const [written] = target ? await adjustHp([{ target, amount: Math.abs(amount) }], { mode: amount < 0 ? HP_MODE.heal : HP_MODE.damage }) : [];
    restored.push({ uuid, amount, ok: written?.ok === true });
  }
  return restored;
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
  if (entry.state === "closed") return reopenEngaged({ message, card, entryKey, entry });
  if (entry.state !== "applied") return { ok: false, reason: "applied" };
  const done = await undoEntry({ subject: entry.subject, entry, entryKey });
  if (!done.ok) return { ok: false, reason: done.restored ? "failed" : "gone" };
  await serialized(messageId, () => patchCard(message, { [`entries.${entryKey}.state`]: "undone", [`entries.${entryKey}.recordIds`]: [], ...(entry.hp?.length ? { [`entries.${entryKey}.hp`]: [] } : {}) }));
  await pressListener?.({ message, key: entryKey, entry: { ...entry, state: "undone" }, undone: true, early: false });
  return { ok: true, removed: done.removed };
}

/**
 * The GM's side of an Apply, over one entry of a card whose kind has a registered
 * outcome: the entry must hold a verdict and nothing written (`rolled`), and the
 * seat must own the subject by Foundry's test on the relayed sender
 * (`checkApplyRequest`). The entry is re-read under the same lock a Save press
 * takes, the writer is asked (`phase` "apply"), and the entry becomes `applied`
 * (`hp`, `amount` and the records it made stored, so an Undo gives them back) or
 * `judge` (nothing written, `why` the reason, which a Judge settles by hand). A
 * subject that is gone is `judge` with `why: "gone"`.
 * Answers `{ok: true, state, entry}`, or `{ok: false, reason}` with `gone`,
 * `applied` (already written, or a second press in flight), `noVerdict` or `notOwner`.
 */
async function applyHere({ messageId, entryKey, requestUserId = null }) {
  const { message, card } = cardOf(messageId);
  const outcome = outcomes.get(card?.kind);
  const entry = card?.entries?.[entryKey];
  if (!message || !outcome || !entry) return { ok: false, reason: "gone" };
  const subjectToken = subjectOf(entry.subject);
  const check = checkApplyRequest(entry, { requestUserId, subjectOwnerIds: ownerIdsOf(subjectToken), judge: judgeDeclares(requestUserId) });
  if (!check.ok) return check;
  const claim = `${messageId}|${entryKey}`;
  if (writing.has(claim)) return { ok: false, reason: "applied" };
  writing.add(claim);
  try {
    const fresh = cardOf(messageId).card?.entries?.[entryKey];
    if (fresh?.state !== "rolled") return { ok: false, reason: "applied" };
    const actor = subjectToken?.actor ?? null;
    const done = actor ? await outcome({ phase: "apply", card, entry: fresh, key: entryKey, saved: fresh.saved === true, subjectToken, actor, userId: requestUserId }) : { judge: true, why: "gone" };
    const made = !done?.judge && done?.records?.length ? await actor.createEmbeddedDocuments("ActiveEffect", done.records) : [];
    const patch = done?.judge
      ? { state: "judge", why: String(done.why ?? "") }
      : { state: "applied", recordIds: made.map((e) => e.id), names: done?.names ?? [], life: done?.life ?? fresh.life, ...(done?.hp ? { hp: done.hp } : {}), ...(Number.isFinite(done?.amount) ? { amount: done.amount } : {}), appliedBy: requestUserId ?? game.user?.id ?? "" };
    await serialized(messageId, () => patchCard(message, Object.fromEntries(Object.entries(patch).map(([k, v]) => [`entries.${entryKey}.${k}`, v]))));
    const next = { ...fresh, ...patch };
    await pressListener?.({ message, key: entryKey, entry: next, early: false, applied: true, subjectToken });
    return { ok: true, state: next.state, entry: next };
  } finally {
    writing.delete(claim);
  }
}

/**
 * The GM's side of Apply all: every entry of the card in state `rolled` goes
 * through `applyHere` as the relayed seat, one at a time, so an entry the seat
 * does not own is refused with its own reason and the rest still land. Answers
 * `{ok: true, applied: string[], refused: Array<{key: string, reason: string}>}`,
 * or `{ok: false, reason: "gone"}` for a card that is not there.
 */
async function applyAllHere({ messageId, requestUserId = null }) {
  const { card } = cardOf(messageId);
  if (!card || !outcomes.has(card.kind)) return { ok: false, reason: "gone" };
  const applied = [];
  const refused = [];
  for (const [key, entry] of Object.entries(card.entries ?? {})) {
    if (entry?.state !== "rolled") continue;
    const done = await applyHere({ messageId, entryKey: key, requestUserId });
    if (done.ok) applied.push(key);
    else refused.push({ key, reason: done.reason });
  }
  return { ok: true, applied, refused };
}

/**
 * Apply one entry of a burst card (its damage, as the card's writer computes it),
 * from any seat: the GM's window runs it, a Player's seat relays it and the GM
 * checks that seat owns the subject (Foundry's own test, never a role). The
 * request carries the ids and nothing the seat could claim.
 *
 * @param {{messageId: string, entryKey: string}} p
 * @returns {Promise<{ok: boolean, state?: string, entry?: object, reason?: string}>}
 */
export async function applyEntry(p) {
  const payload = { messageId: p.messageId, entryKey: p.entryKey };
  if (game.user.isGM) return applyHere(payload);
  return (await executeAsGM(HANDLER.apply, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * Apply every entry of a burst card that holds a verdict and that the seat owns
 * the subject of, from any seat (see `applyEntry`).
 *
 * @param {{messageId: string}} p
 * @returns {Promise<{ok: boolean, applied?: string[], refused?: Array<{key: string, reason: string}>, reason?: string}>}
 */
export async function applyAllEntries(p) {
  const payload = { messageId: p.messageId };
  if (game.user.isGM) return applyAllHere(payload);
  return (await executeAsGM(HANDLER.applyAll, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * Reopen a row an engaged card's Not engaged closed, on the GM's window: the row
 * is open again with its Save and Not engaged, its moment key held again, and
 * the whispered card reads it open. Nothing is deleted, since the close wrote
 * nothing.
 */
async function reopenEngaged({ message, card, entryKey, entry }) {
  await serialized(message.id, () => patchCard(message, patchEngagedReopen(entryKey)));
  if (entry.momentKey) holdReachMoment(entry.momentKey, card.stamp || null);
  await pressListener?.({ message, key: entryKey, entry: { ...entry, state: "open" }, undone: true, early: false });
  return { ok: true, removed: [] };
}

/**
 * Close an open row of an engaged card as not engaged, on the GM's window: the
 * seat must own EVERY bearer the row names (Foundry's ownership on the relayed
 * seat, never a role), and the row must still be open. It strikes the open
 * prompt (the row is closed, so its Save and Not engaged are gone), releases
 * the moment key, answers the whispered card, and writes no save and no record.
 * The row keeps its bearers and says who closed it; Undo reopens it.
 *
 * @param {{messageId: string, entryKey: string, requestUserId?: string|null}} p
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function notEngagedHere({ messageId, entryKey, requestUserId = null }) {
  const { message, card } = cardOf(messageId);
  const entry = card?.kind === "engaged" ? (card.entries?.[entryKey] ?? null) : null;
  if (!message || !entry) return { ok: false, reason: "struck" };
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!user || !ownsEveryBearer(entry, (uuid) => fromUuidSync(uuid)?.testUserPermission?.(user, "OWNER") === true)) return { ok: false, reason: "notBearer" };
  const claim = `${messageId}|${entryKey}`;
  if (writing.has(claim)) return { ok: false, reason: "applied" };
  writing.add(claim);
  try {
    const closed = await serialized(messageId, async () => {
      const fresh = cardOf(messageId).card?.entries?.[entryKey];
      if (fresh?.state !== "open") return false;
      await patchCard(message, patchEngagedClose(entryKey, { id: user.id, name: user.name ?? "" }));
      return true;
    });
    if (!closed) return { ok: false, reason: "applied" };
    if (entry.momentKey) releaseReachMoment(entry.momentKey);
    await pressListener?.({ message, key: entryKey, entry: { ...entry, state: "closed" }, early: false });
    return { ok: true };
  } finally {
    writing.delete(claim);
  }
}

/**
 * Close a row of an engaged card as not engaged, from any seat: the GM's window
 * runs it, a Player's seat asks through the carrier's own relay and the GM's
 * window checks ownership of every bearer again on the server-attested sender.
 *
 * @param {{messageId: string, entryKey: string}} p
 */
export async function notEngaged(p) {
  return (await executeAsGM(HANDLER.notEngaged, { messageId: p.messageId, entryKey: p.entryKey })) ?? { ok: false, reason: "relay" };
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
export async function handleReachMoment({ moment, config, item, row, reach, subject, admitted, region, engagedBy = null, bearer = null }) {
  const immune = !!recordImmunity(subject.actor, { spell: { id: kindKeyOf(item, row) } }).spell;
  const undecided = admitted === null || admitted === undefined;
  const { card } = cardOfActivation(config.activationId);
  const verdict = undecided ? admittedWithCount(admitted, card, subject.token?.uuid) : admitted;
  const counted = undecided && verdict === true;
  const onTurn = !!game.combat?.started && !!subject.token?.id && game.combat.combatant?.tokenId === subject.token.id;
  const act = pulseAct({ pulse: reach.pulse, moment, admitted: verdict, immune, onTurn });
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
  // The turn start's group dispatch names every bearer that engages; a step-in names the one reach it came through.
  const engaging = engagedBy ?? (isEngagedActivation(config.activationId) && verdict === true && bearer?.token?.uuid ? [bearer.token.uuid] : null);
  const result = { ok: true, kind: "reach", act, moment, config, rowKey: row.key, item, subject, ...(engaging ? { engagedBy: engaging } : {}) };
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

/**
 * The standing reach of item kind `kindKey` that holds an actor on its own body:
 * a raised item of the actor's, other than activation `exceptActivationId`, with
 * a standing row whose filter counts the bearer (`filter.self` `count`).
 * `{config, item, row}`, or null. Core never reports a bearer inside its own
 * Region, so `behaviorsUnder` never lists this reach and it is read from the
 * item's state instead.
 */
function ownCountedStanding(actor, kindKey, exceptActivationId = "") {
  for (const item of [...(actor?.items ?? [])]) {
    const { active, activationId } = itemRunOf(item)?.activation.state ?? {};
    if (!active || !activationId || activationId === exceptActivationId) continue;
    const row = itemRunRowsOf(item).find((r) => {
      const reach = readReach(r?.reach);
      if (reach?.pulse !== "standing" || reach.filter?.self !== "count" || kindKeyOf(item, r) !== kindKey) return false;
      // A blank figure holds no part, so it takes no record over: the record is deleted instead of left on the reach that went.
      const figures = reachFigures(r);
      return !!figures && reachParts(figures.on, figures.modifier, figures.saveWhen).length > 0;
    });
    if (row) return { config: { activationId, sourceUuid: item.uuid, rowKey: row.key }, item, row };
  }
  return null;
}

/**
 * The standing reaches other than `except` that hold a subject now and are of
 * the item kind `kindKey`: `[{config, item, row}]`. The Regions the subject
 * stands in come first; its own counted reach (`ownCountedStanding`) comes last,
 * unless its Region is `except`.
 */
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
  const own = ownCountedStanding(subjectToken.actor, kindKey);
  if (own && !(except?.id && itemRunOf(own.item).activation.state.regionId === except.id)) out.push(own);
  return out;
}

/**
 * A subject left a standing reach: take its part off, unless another reach of
 * the same item kind still holds it, in which case the record is rewritten to
 * that reach (its source and activation) so the first bearer's lowering does not
 * take a part another bearer still gives. The reaches that hold it are the
 * Regions it stands in and its own raised reach that counts it (`filter.self`
 * `count`), which no Region reports.
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
 * The Regions the tokens stand in are read first; for a standing pulse, a
 * raised reach of the tokens' own actor that counts its bearer
 * (`ownCountedStanding`) is the last candidate. A condition a grouped prompt
 * wrote is handed on to it at its own reach's teardown.
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
  if (pulse !== "standing") return null;
  for (const token of tokens) {
    const own = ownCountedStanding(token.actor, kindKeyOf(item, row), activationId);
    if (own) return own;
  }
  return null;
}

/**
 * Take a lowered activation's records off every actor that may hold one, and its
 * toggle state off the item. A condition a prompt wrote, where its subject is
 * still inside another raised reach of the same item kind, is handed on to that
 * reach (its source, activation and row) and stays, and so does a standing part
 * whose subject is held by another raised reach of the kind or counted by its own
 * raised one (`ownCountedStanding`); every other record is deleted. Then each
 * subject that lost a standing part and is still inside another reach is offered
 * to that reach again, so a part another bearer gives is written back at once,
 * and what hears a lifted activation is told. A source that resolves and has no
 * activation (`alwaysOn`) is an always-on reach's: no record carries its
 * Region's id, so no actor is scanned.
 */
export async function liftActivation({ config }) {
  const item = fromUuidSync(config.sourceUuid);
  // An always-on reach's Region has an activation id of its own and no record carries it: its records outlive it. Only a source that resolves and is always-on skips the scan, so a deleted toggle item still has its records lifted.
  const { worldActors } = alwaysOn(item) ? { worldActors: () => [] } : await import("./repair.mjs");
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
 * bearer that is down does not stop a fuse; a spot whose scene is gone bursts
 * nothing (`burstFuse` says so). With no burst registered nothing is stepped.
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
/*  Lighting a fuse                              */
/* -------------------------------------------- */

/**
 * The bearer's proficiency as the light reads it: `{proficient, bonus, parts,
 * read?}`. Lib holds no reading of which ability a word names, so with no reader
 * registered (`setProficiencyReader`) the default answers no modifiers and no
 * proficiency, `read: false`, and the roll carries `proficiencyRead: false` for
 * the card to say so.
 */
async function readProficiency() {
  return { proficient: false, bonus: 0, parts: [], read: false };
}

let proficiencyReader = readProficiency;

/**
 * Register what reads the bearer's proficiency: `fn(actor, word)`, awaited,
 * answering `{proficient, bonus, parts}` (`bonus` the standing modifiers' sum,
 * `parts` `[{label, value, cite}]`). An answer is read unless it says `read:
 * false`. A non-function restores the default, which reads nothing.
 */
export function setProficiencyReader(fn) {
  proficiencyReader = typeof fn === "function" ? fn : readProficiency;
}

/** The spot at a token's centre: `{sceneId, x, y, elevation, level}`, or null for a token on no scene. */
function spotAt(token) {
  const centre = tokenCentre(token, token?.parent);
  return fuseSpot({ sceneId: token?.parent?.id, x: centre.x, y: centre.y, elevation: token?.elevation ?? 0, level: token?.level ?? "" });
}

/**
 * `fuse`: the bearer's proficiency throw lights the item's fuse. A d20 is rolled
 * and shown, the throw's target is the item's `throw` figure less the
 * proficiency's standing modifiers (`proficiencyBonus`), and `fuseLight` reads the
 * unmodified die against the item's `fumble` figure. A blank `fumble` or `fuseDice`
 * is the Judge's: nothing is rolled for a blank `fumble`, and nothing is written.
 *
 * Answers `{ok: true, kind: "fuse", outcome, light, activationId, itemUuid,
 * tokenUuid, roll, fuse, blank, [recordId], [burst], [presented]}`:
 * - `outcome` is "unlit" (nothing written), "fumble" (it burst at once at the
 *   bearer's token centre, no fuse record; `burst` is the burst result and
 *   `presented` is true, the presenter having been given this result and then the
 *   burst's), "lit" (the fuse record is written, `recordId` its effect's id) or
 *   null (the Judge decides: nothing written, `blank` names the figures that were
 *   blank, a subset of "throw", "fumble", "fuseDice" and "round");
 * - `light` is `fuseLight`'s answer, which `outcome` equals unless a lit fuse
 *   could not be written (`outcome` null);
 * - `roll` is `{natural, total, formula, target, base, modifiers, proficient,
 *   proficiencyRead, proficiency}`: the die, the target it was read against (null
 *   when blank), `base` the item's own figure, `modifiers` `[{label, value,
 *   cite}]`, `proficiencyRead` false where no reader answered (the bearer's
 *   proficiency was not looked up, so `proficient` and `modifiers` say nothing)
 *   and `proficiency` the word read; null where nothing was rolled;
 * - `fuse` is `{count, combat, dueAt?, spot}` for a lit fuse (`combat` true on the
 *   bearer's combat clock, else `dueAt` the world-clock moment it is due), else null.
 */
async function runFuse({ item, run, actor, token }) {
  const a = run.activation;
  const result = { ok: true, kind: "fuse", outcome: null, light: null, activationId: foundry.utils.randomID(), itemUuid: item.uuid, tokenUuid: token.uuid, roll: null, fuse: null, blank: [] };
  const target = figureNumber(a.throw);
  const fumble = figureNumber(a.fumble);
  result.blank = [...(target === null ? ["throw"] : []), ...(fumble === null ? ["fumble"] : [])];
  if (fumble === null) return result;
  const word = resolveFigure(a.proficiency);
  const prof = await proficiencyReader(actor, word);
  const die = await plainRoll(actor, "1d20", {}, item.name);
  const natural = Number(die.total);
  const effective = target === null ? null : target - (prof?.bonus ?? 0);
  result.light = fuseLight({ natural, total: natural, target: effective, fumble, proficient: prof?.proficient === true });
  result.roll = { natural, total: natural, formula: "1d20", target: effective, base: target, modifiers: prof?.parts ?? [], proficient: prof?.proficient === true, proficiencyRead: prof != null && prof.read !== false, proficiency: word === null ? "" : String(word) };
  result.outcome = result.light;
  const spot = spotAt(token);
  if (result.light === "fumble") {
    if (!spot) return { ...result, outcome: null, blank: [...result.blank, "spot"] };
    await presenter?.(result);
    const burst = await burstFuse({ actor, record: { source: item.uuid, activationId: result.activationId, spot } });
    return { ...result, burst, presented: true };
  }
  if (result.light !== "lit") return result;
  const dice = resolveFigure(a.fuseDice);
  if (dice === null || !Roll.validate(String(dice))) return { ...result, outcome: null, blank: [...result.blank, "fuseDice"] };
  const count = Math.floor(Number((await plainRoll(actor, String(dice), {}, item.name)).total));
  if (!(count >= 1) || !spot) return { ...result, outcome: null, blank: [...result.blank, count >= 1 ? "spot" : "fuseDice"] };
  const combat = game.combat?.started ? game.combat : null;
  const combatant = combat?.combatants?.find?.((c) => c.tokenId === token.id) ?? null;
  const source = item.uuid;
  const activationId = result.activationId;
  const flag = combatant ? fuseFlag({ source, activationId, spot, combatId: combat.id, combatantId: combatant.id, count }) : fuseWorldFlag({ source, activationId, spot, rounds: count, now: game.time?.worldTime, roundSeconds: roundSeconds() });
  if (!flag) return { ...result, outcome: null, blank: [...result.blank, "round"] };
  const [made] = await actor.createEmbeddedDocuments("ActiveEffect", [fuseRecordData({ name: item.name, source, flag })]);
  return { ...result, recordId: made?.id ?? "", fuse: { count, combat: !!combatant, ...(combatant ? {} : { dueAt: flag.dueAt }), spot } };
}

/* -------------------------------------------- */
/*  The burst                                    */
/* -------------------------------------------- */

/** One off a stack, or the item deleted at the last. */
async function consumeOne(item) {
  const held = quantityOf(item);
  if (held && held.value > 1) await item.update({ [held.path]: held.value - 1 });
  else await item.delete();
}

/** The fields every burst result carries, the one a Judge's line names the fuse by: `{kind: "burst", activationId, itemUuid, itemName, actorName, actorUuid}`. */
const fuseFacts = ({ actor, record, itemName }) => ({ kind: "burst", activationId: record?.activationId ?? "", itemUuid: record?.source ?? "", itemName: itemName ?? "", actorName: actor?.name ?? "", actorUuid: actor?.uuid ?? "" });

/** The row a burst reads its save and fraction from: the first with a `burst` reach, else the one keyed `burst`. */
const burstRow = (item) => itemRunRowsOf(item).find((r) => readReach(r?.reach)?.pulse === "burst") ?? itemRunRowsOf(item).find((r) => r?.key === "burst") ?? null;

/**
 * A fuse's burst, after its record is gone (`liftFuses` and `liftWorldFuses` run
 * it, so does a fumble and `setFuseOffNow`): `{actor, record}`, `record` read by
 * `readFuse` (`source`, `activationId`, `spot`). It reads the activation's
 * `sizes`, `blast` and `variant` now (`blastOf`), takes a snapshot of the tokens
 * the blast's circle holds at the spot (`reachSnapshot`, the bearer's own token
 * among them), rolls the blast's dice ONCE (a shown Foundry Roll), consumes one of
 * the item, and hands the result to the presenter, which posts the card. The
 * burst's save is the burst row's, resolved here and stored on the card with the
 * figures an Apply needs, since the item may be gone by then.
 *
 * Answers one of:
 * - `{ok: true, kind: "burst", blank: false, activationId, itemUuid, itemName,
 *   actorName, actorUuid, rowKey, rolled, dice, types, radius, spot, formula,
 *   saveName, reduction, subjects, vehicles, card}`: `subjects` is `[{key, name}]`
 *   (the tokens in the area whose bodies take hit points, `key` the token uuid),
 *   `vehicles` `[{uuid, name}]` (vehicle tokens, which are handed on, never
 *   rolled for), `card` the prompt card's model (`promptCardModel`, Roll per
 *   subject) with `kind: "burst"` and the same `rolled`, `dice`, `types`,
 *   `radius`, `spot`, `reduction` (the share a passed save takes off, or null)
 *   and `saveName` ("" where the row names none, which leaves the save to the
 *   Judge) that the stored card holds;
 * - `{ok: true, kind: "burst", blank: true, why, ...}` where the Judge decides:
 *   nothing is rolled or consumed. `why` is "gone" (the item or its activation
 *   is no more), "figure" (the variant's size or blast row is blank) or "dice";
 * - `{ok: false, kind: "burst", reason, activationId, itemUuid, itemName,
 *   actorName, actorUuid}` with `reason` "noBearer" (the bearer's actor has no
 *   token on any scene, so nothing bursts and the Judge is told which fuse),
 *   "noScene" (the spot's scene is gone, likewise) or "snapshot".
 */
export async function burstFuse({ actor, record }) {
  const item = record?.source ? fromUuidSync(record.source) : null;
  const base = fuseFacts({ actor, record, itemName: item?.name });
  const answer = async (result) => {
    await presenter?.(result);
    return result;
  };
  if (!tokensOfActor(actor).length) return answer({ ok: false, ...base, reason: "noBearer" });
  const scene = game.scenes?.get?.(record?.spot?.sceneId) ?? null;
  if (!scene) return answer({ ok: false, ...base, reason: "noScene" });
  const activation = itemRunOf(item)?.activation ?? null;
  const row = item ? burstRow(item) : null;
  const blast = activation ? blastOf({ sizes: resolveFigure(activation.sizes), blast: resolveFigure(activation.blast), variant: activation.variant }) : null;
  const blank = (why) => answer({ ok: true, ...base, blank: true, why, subjects: [], vehicles: [], card: null });
  if (!activation) return blank("gone");
  if (!blast) return blank("figure");
  if (!Roll.validate(blast.dice)) return blank("dice");
  const snap = reachSnapshot(scene, { point: record.spot }, blast.radius);
  if (!snap.ok) return answer({ ok: false, ...base, reason: snap.reason });
  const rolled = Number((await plainRoll(actor, blast.dice, {}, item.name)).total);
  const subjects = [];
  const vehicles = [];
  for (const token of snap.tokens) {
    if (!token.actor) continue;
    if (hpEligibility(token.actor) === HP_REASON.vehicle) vehicles.push({ uuid: token.uuid, name: token.name });
    else subjects.push({ key: token.uuid, name: token.name });
  }
  const figures = row ? reachFigures(row) : null;
  const saveName = figures?.save ?? "";
  const reduction = figures?.fraction ?? null;
  const rowKey = row?.key ?? "burst";
  const words = Object.fromEntries(["roll", "undo", "undetermined", "tick", "saved", "failed"].map((key) => [key, loc(`itemRun.card.${key}`)]));
  const facts = { rolled, dice: blast.dice, types: blast.types, radius: blast.radius, spot: record.spot, reduction, saveName };
  const card = { ...promptCardModel({ title: item.name, subtitle: actor?.name ?? "", words, subjects, ids: cardIds(item, { key: rowKey }, base.activationId), isGM: true }), kind: "burst", ...facts };
  const result = { ok: true, ...base, blank: false, rowKey, ...facts, formula: blast.dice, subjects, vehicles, card };
  try {
    await consumeOne(item);
  } catch (err) {
    console.error(`${MODULE_ID} | the burst's item could not be consumed`, err);
  }
  return answer(result);
}

/**
 * The burst card's writer (`registerPressOutcome("burst", …)`). The Save press
 * (`phase` "verdict") writes nothing: the entry is `rolled` and waits for an
 * Apply. The Apply (`phase` "apply") takes the card's `rolled` down through the
 * save's `reduction` (`burstAmount`) and the subject's defenses against the
 * card's `types` (`defenseStage`), and writes the amount through `adjustHp` as
 * damage. It answers `{hp: [{uuid, amount}], amount}`, `uuid` the body's actor
 * and `amount` the hit points actually taken (what the write was clamped to, so
 * an Undo gives back exactly that); or `{judge: true, why}`, nothing written,
 * where the reduction is blank for a saved subject (`figure`), a stage is the
 * Judge's (`figure`), the token stands for several bodies (`several`), the body
 * takes no hit points here (a `HP_REASON`) or the write did not land (a `HP_WHY`).
 */
async function burstOutcome({ phase, card, saved, actor, subjectToken }) {
  if (phase === "verdict") return { records: [], names: [], life: "raised", state: "rolled" };
  const stage = defenseStage(actorDefenses(actor), { types: card.types ?? [] }, defenseFigures());
  const plan = burstAmount({ rolled: card.rolled, saved, reduction: card.reduction, stages: [stage] });
  if (plan.judge) return { judge: true, why: "figure" };
  // A party or stack token resolves to several bodies, which this one token's place in the area does not place: the Judge settles it.
  const targets = resolveTargets({ tokens: [subjectToken] });
  const target = targets.length === 1 ? targets[0] : null;
  if (!target || target.reason) return { judge: true, why: targets.length > 1 ? "several" : (target?.reason ?? "gone") };
  let taken = 0;
  if (plan.amount > 0) {
    const [written] = await adjustHp([{ target, amount: plan.amount }], { mode: HP_MODE.damage });
    if (!written?.ok) return { judge: true, why: written?.why ?? "failed" };
    taken = written.before - written.after;
  }
  return { records: [], names: [], life: "raised", hp: taken ? [{ uuid: target.key, amount: taken }] : [], amount: plan.amount };
}

/* -------------------------------------------- */
/*  A posted outcome card                        */
/* -------------------------------------------- */

/** The keys a stored card holds for itself: a post's `facts` never set them, so a relayed seat cannot forge an entry, a subject or an id. */
const CARD_OWN_KEYS = new Set([
  "kind", "rowKey", "activationId", "itemUuid", "cardId", "regionUuid", "bearer", "selfCount", "lowered", "counted", "subjects", "undetermined", "entries", "vehicles",
  "title", "subtitle", "sections", "saveName", "saveMod", "actorUuid", "resolved", "resolvedBy", "asked", "askedBy", "burned", "blankWhy", "fuse", "stamp",
]);

/**
 * The GM's side of an outcome card's post: the sender must own the actor the card
 * speaks for (`speakerActorUuid`, Foundry's ownership on the relayed seat, a GM
 * included), and the card is then built the way a burst's is and handed to the
 * presenter. Answers `postOutcomeCard`'s result, or `{ok: false, reason}` with
 * `gone` (no such actor), `notOwner` or `unsupported` (no kind named, `burst`, or a
 * kind with no registered outcome other than `swigUnknown`).
 */
async function postCardHere({ kind, itemUuid = "", title = "", subtitle = "", subjects = [], saveName = "", saveMod = null, facts = {}, speakerActorUuid = "", requestUserId = null }) {
  const doc = speakerActorUuid ? fromUuidSync(speakerActorUuid) : null;
  const actor = doc?.actor ?? doc;
  if (!actor) return { ok: false, reason: "gone" };
  // Only a kind whose Save press some feature writes, or the unknown drinker's card, is posted this way; a burst's facts are the GM's own roll and are never taken from a post.
  if (typeof kind !== "string" || !kind || kind === "burst" || (!outcomes.has(kind) && kind !== "swigUnknown")) return { ok: false, reason: "unsupported" };
  if (!actor.testUserPermission?.(requesterOf(requestUserId), "OWNER")) return { ok: false, reason: "notOwner" };
  const rows = (Array.isArray(subjects) ? subjects : []).filter((s) => s?.key).map((s) => ({ key: String(s.key), name: String(s.name ?? "") }));
  const mod = saveMod === null || saveMod === undefined || saveMod === "" || !Number.isFinite(Number(saveMod)) ? null : Number(saveMod);
  const save = String(saveName ?? "");
  const own = facts && typeof facts === "object" && !Array.isArray(facts) ? Object.fromEntries(Object.entries(facts).filter(([key]) => !CARD_OWN_KEYS.has(key))) : {};
  const activationId = foundry.utils.randomID();
  const words = Object.fromEntries(["roll", "undo", "undetermined", "tick", "saved", "failed"].map((key) => [key, loc(`itemRun.card.${key}`)]));
  const card = { ...promptCardModel({ title, subtitle, words, subjects: rows, ids: { itemUuid, rowKey: kind, activationId }, isGM: true }), ...own, kind, saveName: save, saveMod: mod };
  const result = { ok: true, kind, itemUuid, itemName: title, activationId, rowKey: kind, actorUuid: actor.uuid ?? "", actorName: actor.name ?? "", subtitle, subjects: rows, saveName: save, saveMod: mod, facts: own, card };
  await presenter?.(result);
  return result;
}

/**
 * Post a prompt card of a card kind some feature owns (`registerPressOutcome`
 * names what writes its Save press), from any seat: the GM's window builds and
 * posts it, a Player's seat relays it and the GM checks the seat owns the actor
 * the card speaks for (`speakerActorUuid`: the attacker, the drinker), by
 * Foundry's own test and never a role. The card is built the way a burst's is
 * (`promptCardModel`, a Roll per subject) and handed to the presenter, which
 * posts it.
 *
 * - `subjects` is `[{key, name}]`, `key` a token uuid; `saveName` the save the
 *   subjects roll ("" leaves it to the Judge) and `saveMod` a modifier to that
 *   throw (a positive figure helps the saver; null for none), both held on the
 *   card, as are `facts`, the kind's own figures, which a writer reads off the
 *   stored card because the item may be gone. A key the card holds for itself
 *   (`kind`, the ids, `entries`, `subjects`, `title`, `saveName`, `saveMod`, a
 *   press's marks and the like) is dropped from `facts`, so a seat's figures can
 *   never forge an entry or an id; the result's `facts` is what was kept.
 * - The stored card the presenter keeps holds `kind`, `rowKey` (the kind),
 *   `activationId`, `itemUuid`, `title`, `saveName`, `saveMod`, `actorUuid`, every
 *   key of `facts`, and `subjects` as `{<safeKey of the uuid>: {uuid, name, state:
 *   "in", latest: ""}}` beside empty `entries`: the shape a burst card's
 *   presses read.
 *
 * Answers `{ok: true, kind, itemUuid, itemName, activationId, rowKey, actorUuid,
 * actorName, subtitle, subjects, saveName, saveMod, facts, card}`, `card` the
 * model with `kind`, `saveName`, `saveMod` and the facts spread on it; or `{ok:
 * false, reason}` with `gone`, `notOwner`, `unsupported` or `relay` (no Judge
 * answered).
 *
 * @param {{kind: string, itemUuid?: string, title?: string, subtitle?: string, subjects?: Array<{key: string, name: string}>, saveName?: string, saveMod?: number|null, facts?: object, speakerActorUuid: string}} p
 * @returns {Promise<object>}
 */
export async function postOutcomeCard(p) {
  const payload = { kind: p.kind, itemUuid: p.itemUuid ?? "", title: p.title ?? "", subtitle: p.subtitle ?? "", subjects: p.subjects ?? [], saveName: p.saveName ?? "", saveMod: p.saveMod ?? null, facts: p.facts ?? {}, speakerActorUuid: p.speakerActorUuid ?? "" };
  if (game.user.isGM) return postCardHere(payload);
  return (await executeAsGM(HANDLER.postCard, payload)) ?? { ok: false, reason: "relay" };
}

/* -------------------------------------------- */
/*  The swig                                     */
/* -------------------------------------------- */

/** The drink figures an item carries (`FLAG_DRINK`), or null. */
const drinkOf = (item) => {
  const raw = item?.flags?.[MODULE_ID]?.[FLAG_DRINK] ?? item?.getFlag?.(MODULE_ID, FLAG_DRINK);
  return raw && typeof raw === "object" ? raw : null;
};

/** A flag's figure as text, null where blank. */
const textOrNull = (value) => (value === null || value === undefined || String(value).trim() === "" ? null : String(value).trim());

/** A dice formula Foundry reads, or null where the figure is blank or no formula. */
const diceOf = (value) => {
  const text = textOrNull(value);
  return text !== null && Roll.validate(text) ? text : null;
};

/**
 * Heal a drinker by `dice`, rolled once and shown (`plainRoll`), through `adjustHp`.
 * The body is the token's (`resolveTargets`), else the actor's. Nothing is rolled
 * where the dice are blank or no formula, or where the body takes no hit points
 * here. Answers `{ok: true, dice, rolled, amount, uuid}`, `amount` what the write
 * actually healed (`uuid` the body's actor), or `{ok: false, judge: true, why}`
 * with `why` "figure" (blank or invalid dice), "several" (the token stands for
 * several bodies), a `HP_REASON`, a `HP_WHY`, "gone" or "failed".
 */
async function healDrinker({ actor, token = null, dice, flavor = "" }) {
  const formula = diceOf(dice);
  if (!formula) return { ok: false, judge: true, why: "figure" };
  const targets = resolveTargets(token ? { tokens: [token] } : { actors: [actor] });
  const target = targets.length === 1 ? targets[0] : null;
  if (!target || target.reason) return { ok: false, judge: true, why: targets.length > 1 ? "several" : (target?.reason ?? "gone") };
  const total = Number((await plainRoll(actor, formula, {}, flavor)).total);
  const rolled = Number.isFinite(total) ? Math.max(0, Math.floor(total)) : 0;
  const [written] = await adjustHp([{ target, amount: rolled }], { mode: HP_MODE.heal });
  if (!written?.ok) return { ok: false, judge: true, why: written?.why ?? "failed" };
  return { ok: true, dice: formula, rolled, amount: written.after - written.before, uuid: target.key };
}

/**
 * `consume`: the item's own actor drinks. The swigs left (`activation.left`) are
 * read here: a number at or below none refuses (`spent`), a number spends one,
 * written on the item BEFORE the outcome, and null is uncounted and never
 * written. An item with no drink flag refuses (`noFigure`) before it spends. The
 * drinker's kind (`drinkerKindOf` over the actor's creature kinds and the flag's
 * `ownKind`) says what follows, and every figure is the flag's, blank where the
 * gear row left it so:
 * - the bearer's own kind: `healDice` is rolled once, shown, and the write heals
 *   the drinker (`healDrinker`);
 * - a human or demi-human: a `swig` save card is posted for the drinker's token
 *   (`postOutcomeCard`; `saveName` the flag's `saveKind`, "" where blank, facts
 *   `{successHealDice, condition, cite}`), and its Save press writes the rest
 *   (`swigOutcomeWriter`);
 * - any other: a `swigUnknown` card is posted (facts `{drinkerTokenUuid,
 *   drinkerActorUuid, healDice, saveKind, successHealDice, condition, cite}`),
 *   whose Heal and Ask the save are the drinker's owners (`swigHeal`,
 *   `swigAskSave`).
 *
 * Answers `{ok: false, reason}` ("spent", "noFigure"), or `{ok: true, kind:
 * "consume", outcome, itemUuid, itemName, actorUuid, actorName, tokenUuid, left,
 * heal, why, [presented]}`:
 * - `outcome` is "heal" (the bearer was healed), "judge" (nothing healed: `why`
 *   names the blank or refused figure, as `healDrinker`'s does), "save" or
 *   "unknown" (the card was posted, `presented` true so the carrier posts none);
 * - `left` is `{before, after}`, the swigs before and after this one (both null
 *   where uncounted);
 * - `heal` is `{dice, rolled, amount}` for a bearer's heal (`amount` what the write
 *   actually healed), else null;
 * - `why` is "" where `outcome` is not "judge".
 */
async function runConsume({ item, run, actor, token }) {
  const a = run.activation;
  const before = a.left;
  if (before !== null && before <= 0) return { ok: false, reason: "spent" };
  const drink = drinkOf(item);
  if (!drink) return { ok: false, reason: "noFigure" };
  if (before !== null) await item.update({ [`flags.${MODULE_ID}.${FLAG_ITEM_RUN}.activation.left`]: before - 1 });
  const result = { ok: true, kind: "consume", outcome: "judge", itemUuid: item.uuid, itemName: item.name, actorUuid: actor.uuid, actorName: actor.name ?? "", tokenUuid: token.uuid, left: { before, after: before === null ? null : before - 1 }, heal: null, why: "" };
  const drinkerKind = drinkerKindOf(creatureKinds(actor), drink.ownKind);
  const out = swigOutcome({ drinkerKind, drink });
  if (out?.kind === "heal") {
    const healed = await healDrinker({ actor, token, dice: out.dice, flavor: item.name });
    if (!healed.ok) return { ...result, why: healed.why };
    return { ...result, outcome: "heal", heal: { dice: healed.dice, rolled: healed.rolled, amount: healed.amount } };
  }
  const facts = { successHealDice: textOrNull(drink.successHealDice), condition: textOrNull(drink.condition), cite: itemCite(item) };
  const post = { itemUuid: item.uuid, title: item.name, subtitle: actor.name ?? "", subjects: [{ key: token.uuid, name: token.name ?? "" }], speakerActorUuid: actor.uuid };
  if (out?.kind === "save") {
    const posted = await postOutcomeCard({ ...post, kind: "swig", saveName: out.saveKind ?? "", saveMod: null, facts });
    return posted?.ok ? { ...result, outcome: "save", presented: true } : { ok: false, reason: posted?.reason ?? "refused" };
  }
  const posted = await postOutcomeCard({
    ...post, kind: "swigUnknown", saveName: "", saveMod: null,
    facts: { drinkerTokenUuid: token.uuid, drinkerActorUuid: actor.uuid, healDice: textOrNull(drink.healDice), saveKind: textOrNull(drink.saveKind), ...facts },
  });
  return posted?.ok ? { ...result, outcome: "unknown", presented: true } : { ok: false, reason: posted?.reason ?? "refused" };
}

/**
 * The `swig` card's writer (`registerPressOutcome("swig", …)`), at the Save press
 * (`phase` "verdict"). A passed save rolls the card's `successHealDice` once,
 * shown, and heals the drinker through `adjustHp`: it answers `{hp: [{uuid,
 * amount}], amount}` with `amount` negative in `hp` (a heal, which an Undo gives
 * back as damage) and the hit points actually healed in `amount`. A failed save
 * writes the card's `condition` with the turn-life that ends it at the end of its
 * bearer's next turn (`swigOutcome`'s `life`; outside a fight the mark, as every
 * condition here), under the item's, the card's and the activation's ids. A blank
 * condition, blank or invalid dice, or a body that takes no hit points answers
 * `{judge: true, why}`, which `pressHere` stores as an entry in state "judge" with
 * nothing written. The Apply phase writes nothing: the card has none.
 */
async function swigOutcomeWriter({ phase, card, saved, subjectToken, actor }) {
  const none = { records: [], names: [], life: "raised" };
  if (phase !== "verdict") return none;
  if (saved) {
    const healed = await healDrinker({ actor, token: subjectToken, dice: card.successHealDice, flavor: card.title ?? "" });
    if (!healed.ok) return { judge: true, why: healed.why };
    return { ...none, hp: healed.amount ? [{ uuid: healed.uuid, amount: -healed.amount }] : [], amount: healed.amount };
  }
  const out = swigOutcome({ drinkerKind: DRINKER_KIND.human, drink: { condition: card.condition }, saved: false });
  if (!out?.condition) return { judge: true, why: "figure" };
  const life = lifeOf(subjectToken, out.life.edge);
  const statusData = await statusEffectData(out.condition);
  const record = conditionRecordData({ statusData, source: card.itemUuid, activationId: card.activationId, rowKey: card.rowKey, life });
  return { records: [record], names: [statusData?.name ?? out.condition], life: life.turnLife ? "turn" : "mark" };
}

/**
 * The unknown drinker's card a press names, checked: it must be there and unpressed
 * (`applied` for one a press already resolved or turned into a save card), and the
 * seat must own the drinker's actor (Foundry's ownership on the relayed seat, a GM
 * included). Answers `{ok: true, message, actor}` or `{ok: false, reason}`.
 */
function unknownCardFor({ messageId, requestUserId }) {
  const { message, card } = cardOf(messageId);
  if (!message || !card || (card.kind !== "swigUnknown" && !card.asked)) return { ok: false, reason: "gone" };
  const doc = fromUuidSync(card.drinkerActorUuid);
  const actor = doc?.actor ?? doc ?? null;
  if (!actor) return { ok: false, reason: "gone" };
  if (!actor.testUserPermission?.(requesterOf(requestUserId), "OWNER")) return { ok: false, reason: "notOwner" };
  if (card.resolved || card.asked) return { ok: false, reason: "applied" };
  return { ok: true, message, actor };
}

/**
 * Run `write({message, actor, card})` over an unknown drinker's card under the
 * lock a press takes, after `unknownCardFor`'s checks and a second look at the
 * card inside the lock, so two presses never both land.
 */
async function pressUnknownCard({ messageId, requestUserId }, write) {
  const found = unknownCardFor({ messageId, requestUserId });
  if (!found.ok) return found;
  const claim = `${messageId}|swig`;
  if (writing.has(claim)) return { ok: false, reason: "applied" };
  writing.add(claim);
  try {
    const card = cardOf(messageId).card;
    if (card?.kind !== "swigUnknown" || card.resolved || card.asked) return { ok: false, reason: "applied" };
    return await write({ message: found.message, actor: found.actor, card });
  } finally {
    writing.delete(claim);
  }
}

/**
 * The GM's side of Heal on an unknown drinker's card: the drinker's owners (by
 * Foundry's test on the relayed seat) heal the drinker by the card's `healDice`,
 * the bearer's own heal (`healDrinker`), and the card is patched resolved
 * `{resolved: "heal", amount, rolled, resolvedBy}`. Blank or invalid dice roll and
 * write nothing and patch the card `{resolved: "judge", why: "figure"}`, the amount
 * the Judge's; a body that takes no hit points refuses `failed`. Answers
 * `{ok: true, state: "heal", amount, rolled, dice}`, `{ok: true, state: "judge"}` or
 * `{ok: false, reason}` with `gone`, `notOwner`, `applied` or `failed`.
 */
async function swigHealHere(p) {
  return pressUnknownCard(p, async ({ message, actor, card }) => {
    const healed = await healDrinker({ actor, token: card.drinkerTokenUuid ? fromUuidSync(card.drinkerTokenUuid) : null, dice: card.healDice, flavor: card.title ?? "" });
    if (!healed.ok && healed.why === "figure") {
      await serialized(message.id, () => patchCard(message, { resolved: "judge", why: "figure", resolvedBy: p.requestUserId ?? game.user?.id ?? "" }));
      return { ok: true, state: "judge" };
    }
    if (!healed.ok) return { ok: false, reason: "failed" };
    await serialized(message.id, () => patchCard(message, { resolved: "heal", amount: healed.amount, rolled: healed.rolled, resolvedBy: p.requestUserId ?? game.user?.id ?? "" }));
    return { ok: true, state: "heal", amount: healed.amount, rolled: healed.rolled, dice: healed.dice };
  });
}

/**
 * The GM's side of Ask the save on an unknown drinker's card: the drinker's owners
 * turn the card into the `swig` save card IN PLACE, by one patch (`kind: "swig"`,
 * `rowKey: "swig"`, `saveName` the card's `saveKind`, `asked: true`), since the card already holds the
 * drinker as its one subject and the figures the Save press reads; Save and Undo
 * then work as on any `swig` card. A blank `saveKind` leaves `saveName` "", the
 * Judge's save. Answers `{ok: true, state: "asked"}` or `{ok: false, reason}` with
 * `gone`, `notOwner` or `applied`.
 */
async function swigAskSaveHere(p) {
  return pressUnknownCard(p, async ({ message, card }) => {
    await serialized(message.id, () => patchCard(message, { kind: "swig", rowKey: "swig", saveName: String(card.saveKind ?? ""), asked: true, askedBy: p.requestUserId ?? game.user?.id ?? "" }));
    return { ok: true, state: "asked" };
  });
}

/**
 * Heal the drinker on an unknown drinker's card (`swigUnknown`), from any seat:
 * the GM's window runs it, a Player's seat relays it and the GM checks the seat
 * owns the drinker's actor. A card already resolved is refused `applied`.
 *
 * @param {{messageId: string}} p
 * @returns {Promise<{ok: boolean, state?: string, amount?: number, rolled?: number, dice?: string, reason?: string}>}
 */
export async function swigHeal(p) {
  const payload = { messageId: p.messageId };
  if (game.user.isGM) return swigHealHere(payload);
  return (await executeAsGM(HANDLER.swigHeal, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * Turn an unknown drinker's card into the save card, from any seat (see
 * `swigHeal`): the drinker's owners ask the drinker's save, and the card becomes
 * a `swig` card in place.
 *
 * @param {{messageId: string}} p
 * @returns {Promise<{ok: boolean, state?: string, reason?: string}>}
 */
export async function swigAskSave(p) {
  const payload = { messageId: p.messageId };
  if (game.user.isGM) return swigAskSaveHere(payload);
  return (await executeAsGM(HANDLER.swigAskSave, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * A consume item landing on an actor, on the primary GM's window: `swigStampPlan`
 * says whether its `bearerUuid` is stamped with the actor's, and, only when `roll`
 * is asked and the plan allows it, its `uses` figure (`resolveFigure`) is rolled
 * into `left`, with `leftFrom` recording the formula and total it came from. The
 * roll is a plain one, posted to no one, and a blank or invalid
 * figure writes only the stamp. Both land in ONE `item.update`, which is an
 * update and so fires no create hook again.
 */
async function stampConsumeItem(item, actor, { roll }) {
  const a = itemRunOf(item)?.activation;
  if (a?.kind !== "consume" || !actor?.uuid) return;
  const plan = swigStampPlan({ bearerUuid: a.bearerUuid, left: a.left, actorUuid: actor.uuid });
  if (!plan.stamp) return;
  const base = `flags.${MODULE_ID}.${FLAG_ITEM_RUN}.activation`;
  const update = { [`${base}.bearerUuid`]: actor.uuid };
  if (roll && plan.roll) {
    const dice = diceOf(resolveFigure(a.uses));
    if (dice !== null) {
      const total = Math.floor(Number((await new Roll(dice).evaluate()).total));
      if (Number.isFinite(total)) {
        update[`${base}.left`] = total;
        const from = { by: "roll", formula: dice, total };
        // Replaced whole, so no key of an earlier provenance survives the merge.
        update[`${base}.leftFrom`] = globalThis.foundry?.data?.operators?.ForcedReplacement?.create?.(from) ?? from;
      }
    }
  }
  await item.update(update);
}

/* -------------------------------------------- */
/*  A lit fuse's controls                        */
/* -------------------------------------------- */

/** The actors a lit fuse may be on: every combat's and the world's (`worldActors`: each actor and each unlinked token's own), each effect read once. */
async function fuseHolders() {
  const { worldActors } = await import("./repair.mjs");
  const inFights = [...(game.combats ?? [])].flatMap((combat) => [...(combat?.combatants ?? [])].map((c) => c?.actor));
  return [...inFights, ...worldActors()].filter(Boolean);
}

/** The lit fuse of an activation, `{actor, effect, raw}`, or null. */
async function findFuse(activationId) {
  if (!activationId) return null;
  for (const hit of fuseEffects(await fuseHolders())) if (readFuse(hit.raw)?.activationId === activationId) return hit;
  return null;
}

/** The seat a relayed request came from, or this window's own user for a Judge's press. */
const requesterOf = (requestUserId) => (requestUserId ? game.users.get(requestUserId) : game.user);

/**
 * The GM's side of Move the spot: a fuse's owner (Foundry's ownership of the
 * bearer's actor on the relayed seat, a GM included) rewrites where it bursts,
 * all five keys written. No range check. Answers `{ok: true, spot}`, or `{ok:
 * false, reason}` with `gone` (no such lit fuse), `notOwner`, `noSpot` (the spot
 * is not a scene and two positions) or `noScene` (the scene is not in the world).
 */
async function moveSpotHere({ activationId, spot, requestUserId = null }) {
  const found = await findFuse(activationId);
  if (!found) return { ok: false, reason: "gone" };
  if (!found.actor.testUserPermission?.(requesterOf(requestUserId), "OWNER")) return { ok: false, reason: "notOwner" };
  const next = fuseSpot(spot ?? {});
  if (!next) return { ok: false, reason: "noSpot" };
  if (!game.scenes?.get?.(next.sceneId)) return { ok: false, reason: "noScene" };
  await found.effect.update({ [`flags.${MODULE_ID}.${FLAG_FUSE}.spot`]: next });
  return { ok: true, spot: next };
}

/**
 * The GM's side of Set off now: the fuse's owner (as `moveSpotHere`) sets it
 * off. The record is deleted FIRST, then the burst runs, as a due fuse's does;
 * where the spot's scene is gone nothing bursts and the burst's result says so
 * (`burstFuse`). Answers `{ok: true, burst}`, `burst` the burst's result, or
 * `{ok: false, reason}` with `gone` or `notOwner`.
 */
async function setOffHere({ activationId, requestUserId = null }) {
  const found = await findFuse(activationId);
  if (!found) return { ok: false, reason: "gone" };
  if (!found.actor.testUserPermission?.(requesterOf(requestUserId), "OWNER")) return { ok: false, reason: "notOwner" };
  const record = readFuse(found.raw);
  await found.actor.deleteEmbeddedDocuments("ActiveEffect", [found.effect.id]);
  return { ok: true, burst: await burstFuse({ actor: found.actor, record }) };
}

/**
 * Move a lit fuse's spot, from any seat: the GM's window runs it, a Player's seat
 * relays it and the GM checks the seat owns the bearer's actor.
 *
 * @param {{activationId: string, spot: {sceneId: string, x: number, y: number, elevation?: number, level?: string}}} p
 * @returns {Promise<{ok: boolean, spot?: object, reason?: string}>}
 */
export async function moveFuseSpot(p) {
  const payload = { activationId: p.activationId, spot: p.spot };
  if (game.user.isGM) return moveSpotHere(payload);
  return (await executeAsGM(HANDLER.moveSpot, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * Set a lit fuse off now, from any seat (see `setOffHere`).
 *
 * @param {{activationId: string}} p
 * @returns {Promise<{ok: boolean, burst?: object, reason?: string}>}
 */
export async function setFuseOffNow(p) {
  const payload = { activationId: p.activationId };
  if (game.user.isGM) return setOffHere(payload);
  return (await executeAsGM(HANDLER.setOff, payload)) ?? { ok: false, reason: "relay" };
}

/**
 * A token was deleted: a fuse burning on its actor has no bearer left. Where the
 * actor stands as no other token on any scene, nothing bursts: a linked actor's
 * record is deleted, an unlinked token's went with it, and the presenter is
 * handed the `noBearer` result `burstFuse` answers (so the Judge is told which
 * fuse). A linked actor with another token keeps its fuse. An unlinked token's
 * records are read from its own actor, else from its delta, since the synthetic
 * actor is not the world's.
 */
async function dropDeletedBearerFuses(token) {
  const actor = token?.actor ?? null;
  const linked = !!token?.actorLink && !!actor;
  const mine = token?.uuid ?? token?.id;
  if (linked && tokensOfActor(actor).some((other) => (other?.uuid ?? other?.id) !== mine)) return;
  const holder = actor ?? { name: token?.name, uuid: token?.uuid, effects: token?.delta?.effects ?? [] };
  for (const { effect, raw } of fuseEffects([holder])) {
    const record = readFuse(raw);
    if (!record) continue;
    if (linked) await actor.deleteEmbeddedDocuments("ActiveEffect", [effect.id]);
    const item = fromUuidSync(record.source);
    await presenter?.({ ok: false, ...fuseFacts({ actor: holder, record, itemName: item?.name ?? effect.name }), reason: "noBearer" });
  }
}

/* -------------------------------------------- */
/*  Handing a burst on to a structure            */
/* -------------------------------------------- */

/**
 * The GM's side of Hand on, a burst card's press on one vehicle row: the card's
 * `vehicles[<safeKey of the uuid>]` must hold the vehicle open, the seat must
 * own the vehicle's actor (Foundry's ownership on the relayed seat, a GM
 * included), and the registered structure writer (`registerStructureDamage`) is
 * called with the burst's rolled figure. The row is marked `handed` under the
 * same lock a press takes, so a second press is refused. A writer that answers
 * `{ok: false, reason}` leaves the row open and the press refused with that
 * reason. Answers `{ok: true, state: "handed"}` or `{ok: false, reason}`:
 * `gone`, `notOwner`, `applied` (handed already), `noStructure` (nothing is
 * registered), or the writer's.
 */
async function handOnHere({ messageId, vehicleUuid, requestUserId = null }) {
  const { message, card } = cardOf(messageId);
  const key = safeKey(vehicleUuid);
  const row = card?.kind === "burst" ? card.vehicles?.[key] : null;
  if (!message || !row) return { ok: false, reason: "gone" };
  const doc = fromUuidSync(vehicleUuid);
  const actor = doc?.actor ?? doc;
  if (!actor) return { ok: false, reason: "gone" };
  if (!actor.testUserPermission?.(requesterOf(requestUserId), "OWNER")) return { ok: false, reason: "notOwner" };
  if (!structureDamage) return { ok: false, reason: "noStructure" };
  const claim = `${messageId}|vehicle|${key}`;
  if (writing.has(claim)) return { ok: false, reason: "applied" };
  writing.add(claim);
  try {
    if (cardOf(messageId).card?.vehicles?.[key]?.state !== "open") return { ok: false, reason: "applied" };
    const done = await structureDamage({ vehicleUuid, total: card.rolled, userId: requestUserId ?? game.user?.id ?? "" });
    if (done?.ok === false) return { ok: false, reason: done.reason ?? "refused" };
    await serialized(messageId, () => patchCard(message, { [`vehicles.${key}.state`]: "handed", [`vehicles.${key}.handedBy`]: requestUserId ?? game.user?.id ?? "" }));
    return { ok: true, state: "handed" };
  } finally {
    writing.delete(claim);
  }
}

/**
 * Hand a burst's rolled total on to a vehicle in its area, from any seat: the
 * GM's window runs it, a Player's seat relays it and the GM checks the seat owns
 * the vehicle.
 *
 * @param {{messageId: string, vehicleUuid: string}} p
 * @returns {Promise<{ok: boolean, state?: string, reason?: string}>}
 */
export async function handOn(p) {
  const payload = { messageId: p.messageId, vehicleUuid: p.vehicleUuid };
  if (game.user.isGM) return handOnHere(payload);
  return (await executeAsGM(HANDLER.handOn, payload)) ?? { ok: false, reason: "relay" };
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
  registerActivationRunner("fuse", runFuse);
  registerActivationRunner("consume", runConsume);
  setFuseBurst(burstFuse);
  registerPressOutcome("burst", burstOutcome);
  registerPressOutcome("swig", swigOutcomeWriter);
  registerHandler(HANDLER.postCard, (payload) => postCardHere(payload));
  registerHandler(HANDLER.swigHeal, (payload) => swigHealHere(payload));
  registerHandler(HANDLER.swigAskSave, (payload) => swigAskSaveHere(payload));
  registerHandler(HANDLER.apply, (payload) => applyHere(payload));
  registerHandler(HANDLER.applyAll, (payload) => applyAllHere(payload));
  registerHandler(HANDLER.moveSpot, (payload) => moveSpotHere(payload));
  registerHandler(HANDLER.setOff, (payload) => setOffHere(payload));
  registerHandler(HANDLER.handOn, (payload) => handOnHere(payload));
  registerHandler(HANDLER.use, (payload) => runUse(payload));
  registerHandler(HANDLER.press, (payload) => pressHere(payload));
  registerHandler(HANDLER.tick, (payload) => countBearerIn(payload));
  registerHandler(HANDLER.untick, (payload) => countBearerOut(payload));
  registerHandler(HANDLER.tickSubject, (payload) => countSubjectIn(payload));
  registerHandler(HANDLER.undo, (payload) => undoHere(payload));
  registerHandler(HANDLER.notEngaged, (payload) => notEngagedHere(payload));
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
  // An item created with its actor takes the actor's stamp and no count; one created on an actor already in the world takes the stamp and, handed on, its rolled count.
  Hooks.on("createActor", (actor) => {
    if (!isPrimaryGM()) return;
    for (const item of actor?.items ?? []) stampConsumeItem(item, actor, { roll: false }).catch((err) => console.error(`${MODULE_ID} | a consume item could not be stamped`, err));
  });
  Hooks.on("createItem", (item) => {
    if (!isPrimaryGM() || item?.parent?.documentName !== "Actor") return;
    stampConsumeItem(item, item.parent, { roll: true }).catch((err) => console.error(`${MODULE_ID} | a consume item could not be stamped`, err));
  });
  Hooks.on("deleteToken", (token) => {
    if (isPrimaryGM()) dropDeletedBearerFuses(token).catch((err) => console.error(`${MODULE_ID} | a deleted bearer's fuse could not be dropped`, err));
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
