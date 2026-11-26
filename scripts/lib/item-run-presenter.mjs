/* global game, ChatMessage, Hooks, fromUuidSync, foundry, ui, CONFIG, canvas */
/**
 * The cards an item the carrier ran draws in chat (`item-run.mjs` posts none):
 * the raised-item card (board 4b), the whispered save card (board 4c), the
 * once-only use's card, and a fuse's light card and the burst's table (board 4b's
 * second and third cards). Registered with `setUsePresenter`, and heard by the
 * carrier's press, lift and tick listeners.
 *
 * - A fuse's light posts one card per activation (`kind: "fuse"`, everything its
 *   body draws stored on it); the burst writes its facts onto that same card, which
 *   becomes the burst card (`kind: "burst"`: one subject entry per body in the
 *   area, keyed by `safeKey`, and a `vehicles` row each). A burst that could not
 *   happen whispers the Judges a line and posts no table. The body is built for the
 *   seat that views it, each press offered by ownership of what it acts on.
 *
 * - A swig draws one of three cards: the drinker's own heal or the Judge's reason
 *   as a small result card (`kind: "consume"`), and the prompt cards a feature
 *   posts through `postOutcomeCard` (`swig`, `onHit`: a Save press per subject its
 *   owner may press, and the verdict's result line; `swigUnknown`: Heal and Ask the
 *   save for the owners of the drinker's actor, which Ask the save turns into a
 *   `swig` card in place). A stored card's live kind picks its body.
 *
 * - An always-on engaged reach (T10, `isEngagedActivation`) raises no card: its
 *   prompt posts, or joins, the engaged card of its subject's moment, one row per
 *   item kind with every bearer of the kind named on it (board 5b), and whispers
 *   the same save card. The row's "Not engaged" closes it with no save and no
 *   record; the bearers' owners alone are offered it.
 *
 * - A raise posts one message holding the card's state (`FLAG_ITEM_RUN_CARD`,
 *   `item-run-card-logic.mjs` `newCard`): the subjects it lists and ONE
 *   moment-keyed entry store. A reach's `list`, `refuse`, `out`, `forget` and
 *   `undetermined` acts change the listing; a `prompt` opens an entry under
 *   its moment key and whispers the save card to the owners of the subject's
 *   token (Foundry's ownership, GMs included). The whispered card carries the
 *   raised card's message id and the entry key, so a press on either card
 *   writes that one entry (`pressRoll`).
 * - Moments that arrive before the raised card exists (core reports every token
 *   inside as the Region is made) wait for it, then replay in order.
 * - Every card write goes through the carrier's per-message chain and dotted
 *   patches, on the primary GM's window; a seat that is not a GM asks through
 *   the carrier's relays, which check ownership again from the relayed seat.
 * - A render hook rebuilds each message's body for the seat that views it, as
 *   the cast card does: each seat gets exactly the controls it may press.
 */
import { FLAG_ITEM_RUN_CARD, FLAG_ITEM_RUN_WHISPER, LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { renderRollCard } from "./roll-card.mjs";
import { figureNumber, isEngagedActivation, readReach, reachAdmits, turnStamp } from "./aura-reach-logic.mjs";
import { lowerReach, releaseReachMoment } from "./aura-reach.mjs";
import { itemCite, itemRunRowsOf, mayUndoEntry, promptCardModel, reachFigures } from "./item-run-logic.mjs";
import { HP_REASON } from "./hp-logic.mjs";
import { actorDefenses, defenseFigures, defenseStage } from "./defenses.mjs";
import { pickPoint } from "./point-pick.mjs";
import { admittedWithCount, blankBurstModel, blankTip, burstCardModel, burstDamageOf, countSubjectAction, damageTip, fuseCardModel, healTip, importTip, outcomeCardModel, resultCardModel, swigUnknownModel, throwTip, engagedCardKey, engagedCardModel, engagedEntry, isCountedIn, newEngagedCard, openEngagedOf, ownsEveryBearer, patchEngagedPrompt, patchForget, patchOut, patchPrompt, patchSubject, patchUncount, patchUndetermined, reachCardModel, rowStateOf, safeKey, saveCardModel, saveTip, newCard, signedFigure, standingPartTip, unsettledRows } from "./item-run-card-logic.mjs";
import { applyAllEntries, applyEntry, cardOf, cardSaveOptions, handOn, kindKeyOf, moveFuseSpot, notEngaged, onActivationLifted, ownerIdsOf, patchCard, pressRoll, saveNameOf, serialized, setFuseOffNow, setPressListener, setUsePresenter, swigAskSave, swigHeal, tickBearer, tickSubject, undoCardEntry, untickBearer } from "./item-run.mjs";
import { saveSpec } from "./saves.mjs";
import { tokenEdgeGapFeet } from "./distance-units.mjs";
import { executeAsGM, judgeDeclares, registerHandler } from "./sockets.mjs";
import { isMarkerActor } from "./place.mjs";
import { isPrimaryGM, makeLoc, unset } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const HANDLER = Object.freeze({ recheck: `${MODULE_ID}.itemRun.recheck` });

/** The card's words, localized: `itemRun.card.<key>` for each. */
const WORD_KEYS = [
  "roll", "undo", "saved", "failed", "out", "notTarget", "waiting", "asked", "undone", "undetermined", "save", "rollSave", "countIn", "countOut", "countSubjectTip", "countSubjectRaisedTip", "counted", "always", "bearer", "well", "check", "lower", "colDistance", "given",
  "earlyTip", "saveTip", "undoTip", "countInTip", "countOutTip", "bearerTip", "checkTip", "lowerTip",
  "engagedBy", "notEngaged", "notEngagedTip", "engagedRead",
];
const words = () => ({ ...Object.fromEntries(WORD_KEYS.map((key) => [key, loc(`itemRun.card.${key}`)])), tick: loc("itemRun.card.countIn"), tickTip: loc("itemRun.card.countInTip") });

/** The prompt state of a raised card per activation: the message id of the card posted for it, and the moments that arrived before it. */
const posted = new Map();
const waitingMoments = new Map();

/** The card's message id for an activation: the one this window posted, else a stored card carrying its id. */
function messageIdFor(activationId) {
  if (posted.has(activationId)) return posted.get(activationId);
  const found = [...(game.messages ?? [])].find((m) => m?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD]?.activationId === activationId);
  return found?.id ?? null;
}

/** The ids of the Judges' users. */
const judgeIds = () => (game.users ?? []).filter((u) => u.isGM).map((u) => u.id);

/** A stored message's content for a seat with no rights: the banner alone, which is what the log and an export read. */
const storedContent = (title, subtitle) => renderRollCard({ title, subtitle, bare: true });

/* -------------------------------------------- */
/*  What a use or a moment draws                 */
/* -------------------------------------------- */

/** The use of an item: a raise posts the raised card and replays the moments that came first; a once-only use, a fuse, a burst, a swig and an outcome card each post theirs. */
async function present(result) {
  if (result?.kind === "toggle" && result.active) return postRaised(result);
  if (result?.kind === "once") return postOnce(result);
  if (result?.kind === "reach") return onReach(result);
  if (result?.kind === "fuse") return postFuse(result);
  if (result?.kind === "burst") return postBurst(result);
  if (result?.kind === "consume") return postConsume(result);
  // A card of a kind some feature owns (`postOutcomeCard`): its `rowKey` is its kind.
  if (result?.ok === true && result.card && Array.isArray(result.subjects) && typeof result.kind === "string" && result.rowKey === result.kind) return postOutcome(result);
  return null;
}

/** Post the raised card for a toggle's activation. */
async function postRaised({ itemUuid, rowKey, activationId, tokenUuid, regionUuid = "" }) {
  const item = fromUuidSync(itemUuid);
  const token = fromUuidSync(tokenUuid);
  if (!item || !token) return;
  const card = newCard({ itemUuid, rowKey, activationId, kind: "toggle", bearer: { uuid: tokenUuid, name: token.name }, regionUuid, cardId: foundry.utils.randomID() });
  // A bearer a standing item's filter counts holds its part from the raise (`runToggle`), so its row is listed as a Count in lists it.
  const reach = readReach(itemRunRowsOf(item).find((r) => r?.key === rowKey)?.reach);
  if (reach?.pulse === "standing" && reach.filter.self === "count") Object.assign(card, { selfCount: true, subjects: { [safeKey(tokenUuid)]: { uuid: tokenUuid, name: token.name, state: "in", latest: "" } } });
  const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ token }), content: storedContent(item.name, token.name), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: card } } });
  posted.set(activationId, message?.id ?? null);
  const early = waitingMoments.get(activationId) ?? [];
  waitingMoments.delete(activationId);
  for (const moment of early) await onReach(moment);
}

/** The merged patch of a moment of a reach on one card, with the whispers it owes. */
function momentPatch(card, result) {
  const { act, subject, momentKey: key, moment } = result;
  const uuid = subject.token.uuid;
  const name = subject.token.name;
  if (act === "list") return { patch: patchSubject(card, { uuid, name }) };
  if (act === "refuse") return { patch: patchSubject(card, { uuid, name, state: "notTarget" }) };
  if (act === "undetermined") return { patch: patchUndetermined(card, { uuid, name }) };
  if (act === "forget") return { patch: patchForget(card, { uuid }) };
  if (act === "out") {
    const out = patchOut(card, { uuid, name });
    return { patch: out.patch, struck: out.struck };
  }
  if (act === "prompt") {
    const prompt = patchPrompt(card, { uuid, name, moment, momentKey: key });
    return { patch: prompt.patch, struck: prompt.struck, asked: prompt.key };
  }
  return { patch: null };
}

/** A moment of a reach reaches its raised card: list, mute or ask; a moment that comes before the card waits for it. */
async function onReach(result) {
  const { config } = result;
  if (isEngagedActivation(config.activationId)) return onEngaged(result);
  const messageId = messageIdFor(config.activationId);
  if (!messageId) {
    waitingMoments.set(config.activationId, [...(waitingMoments.get(config.activationId) ?? []), result].slice(-200));
    return;
  }
  await serialized(messageId, async () => {
    const { message, card } = cardOf(messageId);
    if (!message || !card || card.lowered) return;
    const { patch, struck = [], asked } = momentPatch(card, result);
    if (!patch || !Object.keys(patch).length) return;
    for (const entry of struck) releaseReachMoment(entry.momentKey);
    await patchCard(message, patch);
    if (asked) await whisperSave({ message, key: asked, subjectToken: result.subject.token, item: result.item, rowKey: result.rowKey, activationId: config.activationId });
  });
}

/** The engaged cards this window posted, by `engagedCardKey`: the message id of the card of one subject's moment. */
const engagedPosted = new Map();

/** The chat messages that hold an engaged card. */
const engagedMessages = () => [...(game.messages ?? [])].filter((m) => m?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN_CARD]?.kind === "engaged");

/** The message id of the engaged card for a subject's moment, found or posted. Posting is serialized per card key, so two kinds asked together land on one card. */
function engagedCardFor({ cardKey, stamp, round, moment, subject, title }) {
  return serialized(`engaged:${cardKey ?? foundry.utils.randomID()}`, async () => {
    const known = cardKey ? (engagedPosted.get(cardKey) ?? engagedMessages().find((m) => m.flags[MODULE_ID][FLAG_ITEM_RUN_CARD].cardKey === cardKey)?.id) : null;
    if (known && game.messages?.get?.(known)) return known;
    const card = newEngagedCard({ cardKey, stamp, round, moment, subject, title, cardId: foundry.utils.randomID() });
    const token = fromUuidSync(subject.uuid);
    const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ token }), content: storedContent(loc("itemRun.card.engagedTitle", { item: title }), subject.name), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: card } } });
    if (cardKey && message?.id) engagedPosted.set(cardKey, message.id);
    return message?.id ?? null;
  });
}

/**
 * An always-on engaged reach's moment: only a prompt draws anything. It opens a
 * row, for the item kind, on the engaged card of the subject's moment (posted
 * for the first kind asked), naming every bearer that engages the subject; the
 * subject's open rows of the same kind on earlier moments' cards are struck and
 * their held keys released; and the save card is whispered to the owners of the
 * subject's token. A skip, an undetermined subject or a listing posts nothing.
 */
async function onEngaged(result) {
  const { item, rowKey, subject, momentKey: key, moment, config } = result;
  if (result.act !== "prompt" || !item || !subject?.token) return;
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  if (!row) return;
  const combat = game.combat?.started ? game.combat : null;
  const stamp = turnStamp({ combatId: combat?.id ?? null, round: combat?.round, turn: combat?.turn });
  const subjectInfo = { uuid: subject.token.uuid, name: subject.token.name };
  const kindKey = kindKeyOf(item, row);
  const messageId = await engagedCardFor({ cardKey: engagedCardKey({ stamp, subjectUuid: subjectInfo.uuid }), stamp, round: combat?.round ?? null, moment, subject: subjectInfo, title: item.name });
  if (!messageId) return;
  const bearers = (result.engagedBy ?? []).map((uuid) => ({ uuid, name: fromUuidSync(uuid)?.name ?? "" }));
  const entry = engagedEntry({ subject: subjectInfo.uuid, moment, momentKey: key, kindKey, itemUuid: item.uuid, rowKey, activationId: config.activationId, bearers });
  for (const other of engagedMessages()) {
    if (other.id === messageId) continue;
    const stale = openEngagedOf(other.flags[MODULE_ID][FLAG_ITEM_RUN_CARD], { subjectUuid: subjectInfo.uuid, kindKey });
    if (!stale.length) continue;
    await serialized(other.id, () => patchCard(other, Object.fromEntries(stale.map(([old]) => [`entries.${old}`, unset()]))));
    for (const [, old] of stale) releaseReachMoment(old.momentKey);
  }
  await serialized(messageId, async () => {
    const { message, card } = cardOf(messageId);
    if (!message || !card) return;
    const { key: entryKey, patch } = patchEngagedPrompt(card, { momentKey: key, entry });
    await patchCard(message, patch);
    await whisperSave({ message, key: entryKey, subjectToken: subject.token, item, rowKey, activationId: config.activationId, engaged: true });
  });
}

/** The save's name, spec and tooltip for a subject's actor on an item's row: `{target, tip}` with nulls where nothing resolves. */
function saveFigureOf(actor, row, item) {
  const name = saveNameOf(row);
  if (!actor || !name) return { target: null, tip: null };
  try {
    const spec = saveSpec(actor, name);
    return { target: spec?.target ?? null, tip: spec?.target == null ? null : saveTip({ save: name, target: spec.target, parts: spec.parts ?? [], cite: itemCite(item) }) };
  } catch {
    return { target: null, tip: null };
  }
}

/** The names of the conditions a row's failure writes, localized. */
const conditionNames = (row) => (row?.conditions ?? []).map((key) => game.i18n.localize(CONFIG.statusEffects?.find?.((s) => s.id === key)?.name ?? String(key)));

/** What a failed save lasts, in words: the subject's next turn start in a fight, else its first one in a fight; a timed row's interval; else until the item is lowered. */
const lifeWord = (life) => loc(`itemRun.card.life.${life === "turn" || life === "mark" || life === "timed" ? life : "raised"}`);

/** What a failed save of a row lasts as the press will write it: a row that names its own interval holds for it (untimed where none was imported), any other row to the subject's next turn start in a fight or its first one in a fight. */
function failLife(row, inFight) {
  const figures = reachFigures(row);
  if (figures?.lastsNamed === true) return figures.lasts !== null ? "timed" : "raised";
  return inFight ? "turn" : "mark";
}

/** Whisper the save card for an opened entry to the owners of the subject's token, and keep its id on the entry. */
async function whisperSave({ message, key, subjectToken, item, rowKey, activationId, engaged = false }) {
  const recipients = ownerIdsOf(subjectToken);
  if (!recipients.length || !item) return;
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  const w = words();
  const { target, tip } = saveFigureOf(subjectToken.actor, row, item);
  const inFight = !!game.combat?.combatants?.find?.((c) => c.tokenId === subjectToken.id);
  const names = conditionNames(row).join(", ");
  const model = saveCardModel({
    title: loc(engaged ? "itemRun.card.engagedTitle" : "itemRun.card.whisperTitle", { item: item.name }), subtitle: subjectToken.name, words: w, target, targetTip: tip, ids: { itemUuid: item.uuid, rowKey, activationId }, subject: subjectToken.uuid, entryKey: key, messageId: message.id,
    ifFails: names ? loc("itemRun.card.ifFails", { names, life: lifeWord(failLife(row, inFight)) }) : "",
  });
  const whisper = await ChatMessage.create({
    whisper: recipients,
    speaker: ChatMessage.getSpeaker?.({ token: subjectToken }),
    content: renderRollCard(model),
    flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_WHISPER]: { messageId: message.id, entryKey: key, subject: subjectToken.uuid, itemUuid: item.uuid, rowKey, activationId, ...(engaged ? { engaged: true } : {}) } } },
  });
  if (whisper?.id) await patchCard(message, { [`entries.${key}.whisperId`]: whisper.id });
}

/** A once-only use's card: who got the part (Undo for a Judge), or who is asked for a save, with the subjects the filter could not settle listed. */
async function postOnce(result) {
  const item = fromUuidSync(result.itemUuid ?? "") ?? null;
  const subjects = result.subjects ?? [];
  const entries = {};
  if (!result.card) {
    for (const s of result.written ?? []) entries[safeKey(s.key)] = { subject: s.key, state: "applied", recordIds: s.recordIds ?? [] };
  }
  const card = { ...newCard({ itemUuid: result.itemUuid ?? "", rowKey: result.rowKey, activationId: result.activationId, kind: "once", bearer: { uuid: "", name: result.card?.subtitle ?? "" }, cardId: foundry.utils.randomID() }), direct: !result.card, title: result.card?.title ?? result.title ?? "", subjects: Object.fromEntries(subjects.map((s) => [safeKey(s.key), { uuid: s.key, name: s.name, state: "in", latest: "" }])), undetermined: Object.fromEntries((result.undetermined ?? []).map((s) => [safeKey(s.key), { uuid: s.key, name: s.name }])), entries };
  card.title ||= item?.name ?? "";
  await ChatMessage.create({ content: storedContent(card.title, card.bearer.name), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: card } } });
}

/* -------------------------------------------- */
/*  The fuse and its burst                       */
/* -------------------------------------------- */

/** The page that prints a fuse and its burst, the module's one citation for both cards. */
const fuseCite = () => loc("itemRun.card.citeFuse");

/**
 * Post the fuse card for a light: one card per activation, which the burst later
 * fills in (`postBurst`). It stores everything its body draws (the roll, the
 * outcome, the fuse, the blank figures), since the item is used up by the time the
 * burst comes. A seat sees the presses it owns the bearer for, at render.
 */
async function postFuse(result) {
  const item = fromUuidSync(result.itemUuid ?? "");
  const token = fromUuidSync(result.tokenUuid ?? "");
  const title = item?.name ?? "";
  const bearer = { uuid: result.tokenUuid ?? "", name: token?.name ?? "" };
  const card = { ...newCard({ itemUuid: result.itemUuid ?? "", rowKey: "", activationId: result.activationId, kind: "fuse", bearer, cardId: foundry.utils.randomID() }), title, cite: fuseCite(), outcome: result.outcome ?? null, roll: result.roll ?? null, fuse: result.fuse ?? null, blank: result.blank ?? [], burned: false };
  const message = await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ token }), content: storedContent(title, bearer.name), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: card } } });
  posted.set(result.activationId, message?.id ?? null);
}

/** The facts a burst writes onto its card: what the body draws and what an Apply or a Hand on reads, since the item may be gone. */
function burstPatch(result) {
  const title = result.itemName ?? "";
  if (result.blank) return { kind: "burst", burned: true, title, blankWhy: result.why ?? "figure", subjects: {}, vehicles: {}, entries: {} };
  return {
    kind: "burst", burned: true, title, rowKey: result.rowKey, rolled: result.rolled, dice: result.dice, types: result.types ?? [], radius: result.radius, spot: result.spot, reduction: result.reduction ?? null, saveName: result.saveName ?? "", actorUuid: result.actorUuid ?? "",
    subjects: Object.fromEntries((result.subjects ?? []).map((s) => [safeKey(s.key), { uuid: s.key, name: s.name, state: "in", latest: "" }])),
    vehicles: Object.fromEntries((result.vehicles ?? []).map((v) => [safeKey(v.uuid), { uuid: v.uuid, name: v.name, state: "open" }])),
    entries: {},
  };
}

/**
 * A burst's result: the fuse card of its activation becomes the burst card (its
 * light facts stay), or a new card is posted where none is found. A burst that
 * could not happen (`ok: false`) whispers the Judges a line naming the item and the
 * bearer and posts no table; the fuse card is marked burned either way, so it
 * offers no more controls.
 */
async function postBurst(result) {
  const messageId = messageIdFor(result.activationId);
  if (result.ok === false) {
    if (messageId) await serialized(messageId, () => patchCard(cardOf(messageId).message, { burned: true }));
    const reason = ["noScene", "noBearer", "snapshot"].includes(result.reason) ? result.reason : "snapshot";
    await ChatMessage.create({ whisper: judgeIds(), content: `<p>${esc(loc(`itemRun.card.burstFailed.${reason}`, { item: result.itemName ?? "", bearer: result.actorName ?? "" }))}</p>` });
    return;
  }
  const patch = burstPatch(result);
  const { message, card } = messageId ? cardOf(messageId) : { message: null, card: null };
  if (message && card) {
    await serialized(messageId, () => patchCard(message, patch));
    return;
  }
  const fresh = { ...newCard({ itemUuid: result.itemUuid ?? "", rowKey: "", activationId: result.activationId, kind: "burst", bearer: { uuid: result.actorUuid ?? "", name: result.actorName ?? "" }, cardId: foundry.utils.randomID() }), cite: fuseCite(), ...patch };
  const made = await ChatMessage.create({ content: storedContent(patch.title, result.actorName ?? ""), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: fresh } } });
  posted.set(result.activationId, made?.id ?? null);
}

/* -------------------------------------------- */
/*  The swig and the on-hit save                 */
/* -------------------------------------------- */

/** The page that prints the swig, the module's one citation for its cards where the item names none. */
const swigCite = () => loc("itemRun.card.citeSwig");

/** A figure read from an imported row as a tooltip: the row's label, the figure and its page; the label and figure alone where the item names no page. */
const rowTip = ({ label, figure, cite }) => importTip({ label, figure, cite }) ?? `${label}: ${figure}`;

/**
 * A drinker's own swig (`runConsume` with the bearer's own kind, or nothing
 * healed): one small result card. It stores what its body draws, since the item
 * may be gone: the heal's dice, rolled figure and amount, the Judge's reason,
 * the swigs left and the page.
 */
async function postConsume(result) {
  const item = fromUuidSync(result.itemUuid ?? "");
  const token = fromUuidSync(result.tokenUuid ?? "");
  const bearer = { uuid: result.actorUuid ?? "", name: result.actorName ?? "" };
  const card = {
    ...newCard({ itemUuid: result.itemUuid ?? "", rowKey: "", activationId: foundry.utils.randomID(), kind: "consume", bearer, cardId: foundry.utils.randomID() }),
    title: result.itemName ?? item?.name ?? "", cite: itemCite(item) || swigCite(), outcome: result.outcome ?? "judge", heal: result.heal ?? null, why: result.why ?? "", left: result.left ?? { before: null, after: null },
  };
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ token }), content: storedContent(card.title, bearer.name), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: card } } });
}

/**
 * A prompt card of a kind some feature owns (`postOutcomeCard`: `swig`,
 * `swigUnknown`, `onHit`): stored the way a burst card is, with the facts the
 * kind's presses read, one subject entry per struck or drinking token keyed by
 * `safeKey` and no entries yet. Nothing here draws a number; the body reads the
 * card live for each seat.
 */
async function postOutcome(result) {
  const bearer = { uuid: result.actorUuid ?? "", name: result.actorName ?? "" };
  const doc = bearer.uuid ? fromUuidSync(bearer.uuid) : null;
  const card = {
    ...newCard({ itemUuid: result.itemUuid ?? "", rowKey: result.rowKey, activationId: result.activationId, kind: result.kind, bearer, cardId: foundry.utils.randomID() }),
    title: result.itemName ?? "", subtitle: result.subtitle || bearer.name, ...(result.facts ?? {}), saveName: result.saveName ?? "", saveMod: result.saveMod ?? null, actorUuid: bearer.uuid,
    subjects: Object.fromEntries((result.subjects ?? []).map((s) => [safeKey(s.key), { uuid: s.key, name: s.name, state: "in", latest: "" }])), entries: {},
  };
  await ChatMessage.create({ speaker: ChatMessage.getSpeaker?.({ actor: doc?.actor ?? doc }), content: storedContent(card.title, card.subtitle), flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_CARD]: card } } });
}

/** The words the fuse card and the burst card show, localized: `itemRun.card.<key>` for each, with the nested ones read apart. */
const FUSE_WORD_KEYS = ["throw", "base", "lit", "unlit", "fumble", "judgeDecides", "unlitLine", "fumbleLine", "judgeLine", "fuseHint", "moveSpot", "moveSpotTip", "moveSpotAria", "setOff", "setOffTip", "setOffAria"];
const BURST_WORD_KEYS = ["inArea", "damage", "apply", "applyTip", "applyAria", "applyAll", "applyAllTip", "applyAllAria", "undoApplyTip", "undoAria", "saveAria", "handOn", "handOnTip", "handOnAria", "handed", "structure", "blastRow", "burstGoneLine", "burstJudgeLine"];
const readWords = (keys) => Object.fromEntries(keys.map((key) => [key, loc(`itemRun.card.${key}`)]));
const fuseWords = () => ({
  ...words(), ...readWords(FUSE_WORD_KEYS), light: loc("itemRun.press.light"),
  blankRow: Object.fromEntries(["throw", "fumble", "fuseDice"].map((key) => [key, loc(`itemRun.card.blankRow.${key}`)])),
  blankLine: Object.fromEntries(["round", "spot"].map((key) => [key, loc(`itemRun.card.blankLine.${key}`)])),
});
const burstWords = () => ({ ...words(), ...readWords(BURST_WORD_KEYS) });

/** The notes a light's tooltip carries about the proficiency its throw named: whether the bearer has it, or that this could not be read. None where the item names none. */
function proficiencyNotes(roll) {
  if (!roll?.proficiency) return [];
  if (roll.proficiencyRead === false) return [loc("itemRun.card.proficiencyUnread", { proficiency: roll.proficiency })];
  return [loc(roll.proficient ? "itemRun.card.proficiencyHeld" : "itemRun.card.proficiencyNot", { proficiency: roll.proficiency })];
}

/** The lit fuse's "goes off" line and its tooltip: on the bearer's initiative in a fight, else on the world clock. Null where the fuse is not lit. */
function fuseSteps(card, cite) {
  if (!card.fuse || card.outcome !== "lit") return null;
  const { count, combat } = card.fuse;
  const bearer = card.bearer?.name ?? "";
  return {
    text: loc(combat ? "itemRun.card.stepsCombat" : "itemRun.card.stepsWorld", { n: count, bearer }),
    tip: `${loc(combat ? "itemRun.card.stepsTipCombat" : "itemRun.card.stepsTipWorld", { n: count, bearer })}${cite ? ` (${cite})` : ""}`,
  };
}

/** Build the body of a fuse card for a seat: the light's row, the steps and the presses the seat owns the bearer for. */
function fuseBody(message, card) {
  const w = fuseWords();
  const cite = card.cite ?? "";
  const roll = card.roll ?? null;
  const token = card.bearer?.uuid ? fromUuidSync(card.bearer.uuid) : null;
  const targetTip = roll ? throwTip({ target: roll.target, base: roll.base, modifiers: roll.modifiers ?? [], notes: proficiencyNotes(roll), cite, words: w }) : null;
  const totalTip = roll ? loc("itemRun.card.lightTotalTip", { formula: roll.formula ?? "", natural: roll.natural ?? "" }) : "";
  return renderRollCard(fuseCardModel({
    title: loc(card.outcome === "lit" ? "itemRun.card.fuseTitle" : "itemRun.card.fuseTitleTried", { item: card.title ?? "" }), subtitle: card.bearer?.name,
    words: w, roll, outcome: card.outcome ?? null, blank: card.blank ?? [], steps: fuseSteps(card, cite), targetTip, totalTip, cite,
    ids: { activationId: card.activationId, itemUuid: card.itemUuid }, seat: { ownsBearer: token?.testUserPermission?.(game.user, "OWNER") === true }, burned: card.burned === true,
  }));
}

/** The reason a Judge row names, localized: a hit-point refusal's, a write's, or the burst's own. */
function whyText(why) {
  if (Object.values(HP_REASON).includes(why)) return loc(`hp.reason.${why}`);
  if (["gone", "moved", "noHp", "failed"].includes(why)) return loc(`hp.why.${why}`);
  return loc(["figure", "several"].includes(why) ? `itemRun.card.why.${why}` : "itemRun.card.why.other");
}

/** A body's save target and its tooltip for the save a burst or an outcome card names: the computed parts and the page, or a blank with the page alone. `options` are `saveSpec`'s, a card's modifier among them. */
function burstSaveFigure(actor, saveName, cite, options = {}) {
  if (!actor || !saveName) return { target: null, tip: blankTip({ cite }) };
  try {
    const spec = saveSpec(actor, saveName, options);
    return spec?.target == null ? { target: null, tip: blankTip({ cite }) } : { target: spec.target, tip: saveTip({ save: saveName, target: spec.target, parts: spec.parts ?? [], cite }) };
  } catch {
    return { target: null, tip: blankTip({ cite }) };
  }
}

/** The damage an Apply would write to a body, read as the writer reads it: the share the save takes off, then the body's defense stage against the burst's types. A stage that cannot be read is the Judge's. */
function burstDamage(card, actor, saved) {
  try {
    const stage = defenseStage(actorDefenses(actor), { types: card.types ?? [] }, defenseFigures());
    return burstDamageOf({ rolled: card.rolled, saved, reduction: card.reduction, stage });
  } catch {
    return { amount: null, judge: true, defended: false };
  }
}

/** Build the body of a burst card for a seat: a table of the bodies it owns, each row read live, with the presses the entry's state offers it. */
function burstBody(message, card) {
  const w = burstWords();
  const cite = card.cite ?? fuseCite();
  const title = loc("itemRun.card.burstTitle", { item: card.title ?? "" });
  const subtitle = card.bearer?.name;
  if (card.blankWhy) return renderRollCard(blankBurstModel({ title, subtitle, words: w, why: card.blankWhy, cite }));
  const damageWords = { rolled: loc("itemRun.card.damageTip.rolled"), takesOff: loc("itemRun.card.damageTip.takesOff"), noShare: loc("itemRun.card.damageTip.noShare"), defenses: loc("itemRun.card.damageTip.defenses") };
  const owns = (doc) => doc?.testUserPermission?.(game.user, "OWNER") === true;
  const rows = Object.values(card.subjects ?? {}).map((sub) => {
    const entryKey = safeKey(sub.uuid);
    const entry = card.entries?.[entryKey] ?? null;
    const state = ["rolled", "applied", "judge", "undone"].includes(entry?.state) ? entry.state : "open";
    const actor = fromUuidSync(sub.uuid)?.actor ?? null;
    const figure = burstSaveFigure(actor, card.saveName, cite);
    const row = { key: sub.uuid, name: sub.name, state, entryKey, entry, target: figure.target, targetTip: figure.tip };
    if (state === "rolled" || state === "applied") {
      const saved = entry.saved === true;
      const damage = burstDamage(card, actor, saved);
      const amount = state === "applied" ? (Number.isFinite(entry.amount) ? entry.amount : null) : damage.amount;
      row.damage = { amount, judge: amount === null };
      if (amount !== null) row.damageTip = damageTip({ amount, dice: card.dice, rolled: card.rolled, saved, reduction: card.reduction, defended: damage.defended && damage.amount === amount, cite, words: damageWords });
    }
    if (state === "judge") row.whyText = whyText(entry.why);
    return row;
  });
  const vehicles = Object.values(card.vehicles ?? {}).map((v) => ({ ...v, tip: loc("itemRun.card.structureTip", { rolled: card.rolled, name: v.name, cite }) }));
  const types = (card.types ?? []).join(", ");
  return renderRollCard(burstCardModel({
    title, subtitle, words: w, note: `${loc("itemRun.card.areaLine", { radius: card.radius })} (${cite})`, noteTooltip: loc("itemRun.card.areaTip", { radius: card.radius, cite }),
    rolledLine: loc(types ? "itemRun.card.rolledLineTypes" : "itemRun.card.rolledLine", { dice: card.dice, rolled: card.rolled, types }), rows, vehicles,
    buildingsLine: loc("itemRun.card.buildingsLine", { rolled: card.rolled, cite }), canSave: !!card.saveName,
    ids: { itemUuid: card.itemUuid, rowKey: card.rowKey ?? "", activationId: card.activationId }, messageId: message.id,
    seat: {
      judge: judgeDeclares(), ownsSubject: (key) => owns(fromUuidSync(key)),
      ownsVehicle: (uuid) => { const doc = fromUuidSync(uuid); return owns(doc?.actor ?? doc); },
      mayUndo: (entry, key) => mayUndoEntry(entry, game.user.id, ownerIdsOf(fromUuidSync(key))),
    },
  }));
}

/** The words the swig and on-hit cards show, localized: `itemRun.card.<key>` for each, beside the common card words. */
const OUTCOME_WORD_KEYS = ["saveAria", "swig", "healed", "successHealTip", "conditionTip", "noSaveLine", "heal", "healPressTip", "healAria", "askSave", "askSaveTip", "askSaveAria", "undoOutcomeTip", "undoOutcomeAria"];
const outcomeWords = () => ({ ...words(), ...readWords(OUTCOME_WORD_KEYS) });

/** Whether this window's user owns a document, by Foundry's own test: a Judge's seat owns every one, and no role is read. */
const ownsDoc = (doc) => doc?.testUserPermission?.(game.user, "OWNER") === true;


/** The text and tooltip a drinker's heal reads as: "Healed {amount}", with the dice, what they rolled and the page. */
function healedRow({ amount, dice, rolled, cite }) {
  return { text: loc("itemRun.card.healedLine", { amount }), tip: healTip({ amount, dice, rolled, cite, words: { rolled: loc("itemRun.card.damageTip.rolled") } }), emphasis: "success" };
}

/** Build the body of a drinker's own swig card: the heal it wrote, or the Judge's reason, and the swigs left where the item counts them. */
function consumeBody(message, card) {
  const w = outcomeWords();
  const cite = card.cite ?? swigCite();
  const rows = [card.outcome === "heal" && card.heal ? healedRow({ ...card.heal, cite }) : { text: whyText(card.why), tip: blankTip({ cite }), emphasis: "muted" }];
  if (Number.isFinite(card.left?.after)) rows.push({ text: loc("itemRun.card.swigsLeft", { after: card.left.after }), tip: `${loc("itemRun.card.swigsLeftTip", { before: card.left.before })}${cite ? ` (${cite})` : ""}` });
  return renderRollCard(resultCardModel({ title: loc("itemRun.card.swigTitle", { item: card.title ?? "" }), subtitle: card.bearer?.name, head: w.swig, rows }));
}

/** Build the body of the card of a drinker the module cannot tell: the choice for a seat that owns the drinker's actor, the note alone for any other, and the heal it came to once chosen. */
function swigUnknownBody(message, card) {
  const w = outcomeWords();
  const cite = card.cite || swigCite();
  const title = loc("itemRun.card.swigTitle", { item: card.title ?? "" });
  const dice = card.healDice || null;
  if (card.resolved === "heal") return renderRollCard(resultCardModel({ title, subtitle: card.bearer?.name, head: w.swig, rows: [healedRow({ amount: card.amount, dice, rolled: card.rolled, cite })] }));
  if (card.resolved === "judge") return renderRollCard(resultCardModel({ title, subtitle: card.bearer?.name, head: w.swig, rows: [{ text: whyText(card.why), tip: blankTip({ cite }), emphasis: "muted" }] }));
  const doc = card.drinkerActorUuid ? fromUuidSync(card.drinkerActorUuid) : null;
  const canPress = ownsDoc(doc?.actor ?? doc);
  const kind = card.saveKind || null;
  return renderRollCard(swigUnknownModel({
    title, subtitle: card.bearer?.name, words: w, note: `${loc(canPress ? "itemRun.card.unknownNote" : "itemRun.card.unknownNoteOther")} (${cite})`, messageId: message.id, canPress,
    healRow: { text: dice ? loc("itemRun.card.unknownHeal", { dice }) : loc("itemRun.card.unknownHealBlank"), tip: dice ? rowTip({ label: loc("itemRun.card.unknownHealLabel", { item: card.title ?? "" }), figure: dice, cite }) : blankTip({ cite }) },
    askRow: { text: kind ? loc("itemRun.card.unknownAsk", { kind }) : loc("itemRun.card.unknownAskBlank"), tip: kind ? rowTip({ label: loc("itemRun.card.unknownAskLabel", { item: card.title ?? "" }), figure: kind, cite }) : blankTip({ cite }) },
  }));
}

/** The result line of a save card's verdict entry, `{text, tip}`: what a pass healed or a failure wrote and for how long, the delayed damage an on-hit failure set, or the Judge's reason. */
function outcomeResult(card, entry, cite, w) {
  if (entry.state === "judge") return { text: whyText(entry.why), tip: blankTip({ cite }) };
  if (card.kind === "onHit") {
    if (entry.saved === true) return { text: w.saved };
    const figure = loc("itemRun.card.onHitLine", { formula: card.formula ?? "", delayTurns: card.delayTurns ?? "" });
    return { text: `${w.failed} · ${figure}`, tip: rowTip({ label: loc("itemRun.card.onHitTip", { source: card.source ?? "" }), figure, cite }) };
  }
  if (entry.saved === true) {
    const text = Number.isFinite(entry.amount) ? `${w.saved} · ${w.healed} ${entry.amount}` : w.saved;
    return { text, tip: card.successHealDice ? rowTip({ label: w.successHealTip, figure: card.successHealDice, cite }) : blankTip({ cite }) };
  }
  const names = (entry.names ?? []).join(", ");
  return names ? { text: `${w.failed} · ${names}, ${lifeWord(entry.life)}`, tip: rowTip({ label: w.conditionTip, figure: names, cite }) } : { text: w.failed, tip: blankTip({ cite }) };
}

/**
 * Build the body of a save card of an outcome kind (`swig`, `onHit`) for a seat:
 * the subjects with their save targets read live, the Save press for a seat that
 * owns the subject, and each verdict's result line. The save is named with its
 * modifier where the card holds one, the modifier's tooltip naming the row it was
 * read from. A card that names no save draws the Judge's line and no press.
 */
function outcomeBody(message, card) {
  const w = outcomeWords();
  const swig = card.kind === "swig";
  const cite = card.cite || (swig ? swigCite() : "");
  const saveName = String(card.saveName ?? "");
  const mod = card.saveMod === null || card.saveMod === undefined || card.saveMod === "" || !Number.isFinite(Number(card.saveMod)) ? null : Number(card.saveMod);
  // A swig's one subject is the drinker the card is about; any other kind's subjects are bodies struck, shown to the seats that own them as the burst card and the once-only card show theirs.
  const shown = Object.values(card.subjects ?? {}).filter((sub) => swig || ownsDoc(fromUuidSync(sub.uuid)));
  const rows = shown.map((sub) => {
    const entryKey = safeKey(sub.uuid);
    const entry = card.entries?.[entryKey] ?? null;
    const state = ["applied", "judge", "undone"].includes(entry?.state) ? entry.state : "open";
    const figure = burstSaveFigure(fromUuidSync(sub.uuid)?.actor ?? null, saveName, cite, cardSaveOptions(card));
    const row = { key: sub.uuid, name: sub.name, state, entryKey, entry, target: figure.target, targetTip: figure.tip };
    if (saveName) row.detail = mod === null ? saveName : `${saveName} ${signedFigure(mod)}`;
    if (saveName && mod !== null) row.nameTooltip = rowTip({ label: loc("itemRun.card.saveModTip", { source: card.source ?? card.title ?? "" }), figure: signedFigure(mod), cite });
    if (state === "applied" || state === "judge") row.result = outcomeResult(card, entry, cite, w);
    return row;
  });
  return renderRollCard(outcomeCardModel({
    title: swig ? loc("itemRun.card.swigTitle", { item: card.title ?? "" }) : (card.title ?? ""), subtitle: card.subtitle || card.bearer?.name, words: w, rows,
    ids: { itemUuid: card.itemUuid, rowKey: card.rowKey ?? "", activationId: card.activationId }, messageId: message.id, canSave: !!saveName, lines: saveName ? [] : [w.noSaveLine],
    seat: { ownsSubject: (key) => ownsDoc(fromUuidSync(key)), mayUndo: (entry, key) => mayUndoEntry(entry, game.user.id, ownerIdsOf(fromUuidSync(key))) },
  }));
}

/** The kinds of card a body of its own draws; any other kind a stored card holds is an outcome kind a feature registered. */
const OWN_CARD_KINDS = new Set(["toggle", "once", "engaged", "fuse", "burst", "consume"]);

/** The body of a stored card for a seat, read from its live kind: Ask the save turns a `swigUnknown` card into a `swig` one in place. */
function cardBody(message, card) {
  if (card.kind === "once") return onceBody(message, card);
  if (card.kind === "engaged") return engagedBody(message, card);
  if (card.kind === "fuse") return fuseBody(message, card);
  if (card.kind === "burst") return burstBody(message, card);
  if (card.kind === "consume") return consumeBody(message, card);
  if (card.kind === "swigUnknown") return swigUnknownBody(message, card);
  if (card.kind && !OWN_CARD_KINDS.has(card.kind)) return outcomeBody(message, card);
  return raisedBody(message, card);
}

/* -------------------------------------------- */
/*  Hearing a press, a lift and a recheck        */
/* -------------------------------------------- */

/** A press, an Undo or a count-in was written: the whispered card reads the entry again, and an early press is told to the Judges. */
async function onPressed({ message, entry, early, item, subjectToken }) {
  if (!isGMWindow()) return;
  const whisper = entry?.whisperId ? game.messages?.get?.(entry.whisperId) : null;
  if (whisper) await whisper.update({ [`flags.${MODULE_ID}.${FLAG_ITEM_RUN_WHISPER}.answered`]: entry.state });
  if (early && message) {
    await ChatMessage.create({ whisper: judgeIds(), content: `<p>${esc(loc("itemRun.card.earlyWarn", { item: item?.name ?? "", name: subjectToken?.name ?? "" }))}</p>` });
  }
}

/** Whether this window is the primary GM's, the one that writes cards. */
const isGMWindow = () => isPrimaryGM();

/** An activation was lifted: its card is marked lowered, every row goes out with its open entries struck, and each body counted in goes back to undetermined. */
async function onLifted(config) {
  const messageId = messageIdFor(config.activationId);
  if (!messageId) return;
  posted.delete(config.activationId);
  await serialized(messageId, async () => {
    const { message, card } = cardOf(messageId);
    if (!message || !card) return;
    const patch = { lowered: true, ...patchUncount(card) };
    for (const sub of Object.values(card.subjects ?? {})) {
      const out = patchOut(card, { uuid: sub.uuid, name: sub.name });
      Object.assign(patch, out.patch);
      for (const entry of out.struck) releaseReachMoment(entry.momentKey);
    }
    await patchCard(message, patch);
  });
}

/**
 * Check range again, on the GM's window: read the Region's tokens now and list or
 * mute rows to match, drop a body held undetermined that is no longer inside, asking nobody. The relayed seat must own the bearer's
 * token.
 *
 * @param {{messageId: string, requestUserId?: string|null}} p
 */
async function recheckHere({ messageId, requestUserId = null }) {
  const { message, card } = cardOf(messageId);
  const bearerToken = card?.bearer?.uuid ? fromUuidSync(card.bearer.uuid) : null;
  if (!message || !card || !bearerToken || card.lowered) return { ok: false, reason: "gone" };
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!bearerToken.testUserPermission?.(user, "OWNER")) return { ok: false, reason: "notOwner" };
  const item = fromUuidSync(card.itemUuid);
  const reach = readReach(itemRunRowsOf(item).find((r) => r?.key === card.rowKey)?.reach);
  const region = card.regionUuid ? fromUuidSync(card.regionUuid) : null;
  if (!reach || !region) return { ok: false, reason: "gone" };
  return serialized(messageId, async () => {
    const fresh = cardOf(messageId).card;
    const inside = [...(region.tokens ?? [])].filter((t) => t.uuid !== bearerToken.uuid);
    const patch = {};
    const bearer = { token: bearerToken, actor: bearerToken.actor };
    for (const token of inside) {
      if (isMarkerActor(token.actor)) continue;
      const admitted = admittedWithCount(reachAdmits(bearer, { token, actor: token.actor }, reach.filter, { isMarker: isMarkerActor }), fresh, token.uuid);
      const subject = { uuid: token.uuid, name: token.name };
      Object.assign(patch, admitted === null ? patchUndetermined(fresh, subject) : patchSubject(fresh, { ...subject, state: admitted ? "in" : "notTarget" }));
    }
    const here = new Set(inside.map((t) => t.uuid));
    for (const sub of Object.values(fresh.subjects ?? {})) {
      if (sub.uuid === bearerToken.uuid || here.has(sub.uuid) || sub.state === "out") continue;
      const out = patchOut(fresh, { uuid: sub.uuid, name: sub.name });
      Object.assign(patch, out.patch);
      for (const entry of out.struck) releaseReachMoment(entry.momentKey);
    }
    for (const held of Object.values(fresh.undetermined ?? {})) if (!here.has(held.uuid)) Object.assign(patch, patchForget(fresh, held));
    if (Object.keys(patch).length) await patchCard(message, patch);
    return { ok: true };
  });
}

/** Ask the GM's window to check the range again, from any seat. */
async function recheck(p) {
  if (game.user.isGM) return recheckHere(p);
  return (await executeAsGM(HANDLER.recheck, p)) ?? { ok: false, reason: "relay" };
}

/* -------------------------------------------- */
/*  Per-seat rendering                           */
/* -------------------------------------------- */

/** The note under a raised card's banner: the reach's radius and the page that prints the item, or the page alone where no radius was imported. */
function reachNote(item, reach) {
  const cite = itemCite(item);
  const feet = reach ? figureNumber(reach.radius) : null;
  const line = feet === null ? cite : loc("itemRun.card.note.reach", { feet }) + (cite ? ` (${cite})` : "");
  return { note: line, noteTooltip: cite };
}

/**
 * What a body inside a standing reach reads as, in words: the part the reach
 * holds on it (the rolls it names and the figure imported for it) and the item's
 * page, or the page alone where no figure was imported. Null where there is none.
 */
function heldTipOf(item, reach) {
  const value = figureNumber(reach?.modifier);
  const rolls = (reach?.on ?? []).map((key) => loc(`itemRun.strip.on.${key}`)).join(", ");
  const line = value === null ? "" : loc("itemRun.card.tip.held", { item: item?.name ?? "", part: `${rolls} ${signedFigure(value)}`.trim() });
  return standingPartTip({ line, cite: itemCite(item) });
}

/**
 * The rows a raised card draws, read live: each listed subject's state, distance,
 * save figure and history. A standing reach asks no save and waits for no
 * moment, so every listed body of it reads `held` (counted in by an owner of the
 * item, or admitted by the filter), whatever the card stores, with no press for
 * any seat. The bearer's own row, listed once it is counted in, reads held too:
 * counting it in holds its part (`countBearerIn`).
 */
function rowsOf(card, row, item, bearerToken, reach) {
  const heldTip = reach?.pulse === "standing" ? heldTipOf(item, reach) : null;
  const rowFor = (sub, { distance }) => {
    const token = fromUuidSync(sub.uuid);
    const listed = rowStateOf(card, sub.uuid);
    const state = listed === "waiting" && reach?.pulse === "standing" && card.lowered !== true ? "held" : listed;
    const entry = card.entries?.[sub.latest] ?? null;
    const gap = distance && bearerToken && token ? tokenEdgeGapFeet(bearerToken, token) : null;
    const feet = gap === null ? null : Math.round(gap);
    const figure = ["open", "applied", "undone"].includes(state) ? saveFigureOf(token?.actor, row, item) : { target: null, tip: null };
    const earlier = Object.entries(card.entries ?? {}).filter(([key, e]) => e.subject === sub.uuid && key !== sub.latest && e.state !== "open").map(([, e]) => (e.state === "applied" ? loc("itemRun.card.tip.earlier", { result: e.saved ? loc("itemRun.card.saved") : loc("itemRun.card.failed"), total: e.total, target: e.target }) : loc("itemRun.card.undone")));
    return {
      key: sub.uuid, name: sub.name, state, entryKey: sub.latest, entry, feet,
      ...(state === "held" ? { counted: isCountedIn(card, sub.uuid), ...(heldTip ? { heldTip } : {}) } : {}),
      ...(feet === null ? {} : { feetTip: loc("itemRun.card.tip.distance", { feet, name: card.bearer?.name ?? "" }) }),
      target: figure.target, targetTip: figure.tip, ...(earlier.length ? { history: earlier.join(" · ") } : {}),
    };
  };
  return { rowFor, subjects: Object.values(card.subjects ?? {}).filter((s) => s.uuid !== card.bearer?.uuid) };
}

/** The lines the well names: what each failed save wrote and for how long. */
function wellOf(card) {
  return Object.values(card.entries ?? {})
    .filter((e) => e.state === "applied" && e.saved === false && e.names?.length)
    .map((e) => `${card.subjects?.[safeKey(e.subject)]?.name ?? ""}: ${e.names.join(", ")}, ${lifeWord(e.life)}`);
}

/** Build the body of a raised card for a seat. */
function raisedBody(message, card) {
  const item = fromUuidSync(card.itemUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === card.rowKey);
  const reach = readReach(row?.reach);
  const bearerToken = card.bearer?.uuid ? fromUuidSync(card.bearer.uuid) : null;
  const owns = (doc) => doc?.testUserPermission?.(game.user, "OWNER") === true;
  const seat = { judge: judgeDeclares(), ownsSubject: (key) => owns(fromUuidSync(key)), ownsBearer: owns(bearerToken), ownsItem: owns(item), mayUndo: (entry, key) => entry?.presser === game.user.id || owns(fromUuidSync(key)) };
  const { rowFor, subjects } = rowsOf(card, row, item, bearerToken, reach);
  const bearerSub = card.subjects?.[safeKey(card.bearer?.uuid)];
  // The item's own filter says whether the bearer is counted, so a re-raise after a lowering reads the choice the item kept.
  const counted = reach?.filter?.self === "count";
  const bearer = card.bearer?.uuid ? { key: card.bearer.uuid, name: card.bearer.name, counted, ...(counted ? { row: bearerSub ? rowFor(bearerSub, { distance: false }) : { state: "waiting", feet: null } } : {}) } : null;
  const { note, noteTooltip } = reachNote(item, reach);
  const model = reachCardModel({
    title: item?.name ?? "", subtitle: card.bearer?.name, note, noteTooltip, words: { ...words(), bearerTip: loc("itemRun.card.bearerTip") },
    rows: subjects.map((s) => rowFor(s, { distance: true })), undetermined: Object.values(card.undetermined ?? {}).map((s) => ({ key: s.uuid, name: s.name })), bearer, well: wellOf(card), ids: { itemUuid: card.itemUuid, rowKey: card.rowKey, activationId: card.activationId }, seat, lowered: card.lowered === true,
  });
  return renderRollCard(model);
}

/** The lines the engaged card's well names: what each failed save wrote and for how long. */
const engagedWellOf = (card) => Object.values(card.entries ?? {})
  .filter((e) => e.state === "applied" && e.saved === false && e.names?.length)
  .map((e) => `${card.subject?.name ?? ""}: ${e.names.join(", ")}, ${lifeWord(e.life)}`);

/**
 * Build the body of an engaged card for a seat: one row per item kind asked,
 * read live. A save's target is the subject's own save of the kind the row
 * names, its tooltip computed with the page; a blank one is a blank cell whose
 * tooltip is the page alone. The "Engaged by" tooltip names the bearers, the
 * adjacent square and the pages.
 */
function engagedBody(message, card) {
  const w = words();
  const owns = (uuid) => fromUuidSync(uuid)?.testUserPermission?.(game.user, "OWNER") === true;
  const seat = { ownsSubject: owns, ownsBearers: (entry) => ownsEveryBearer(entry, owns), mayUndo: (entry, key) => entry?.presser === game.user.id || owns(key) };
  const subjectName = card.subject?.name ?? "";
  const rows = Object.entries(card.entries ?? {}).map(([entryKey, entry]) => {
    const item = fromUuidSync(entry.itemUuid ?? "");
    const row = itemRunRowsOf(item).find((r) => r?.key === entry.rowKey);
    const cite = itemCite(item);
    const state = ["open", "applied", "undone", "closed"].includes(entry.state) ? entry.state : "open";
    const figure = state === "closed" ? { target: null, tip: null } : saveFigureOf(fromUuidSync(entry.subject)?.actor, row, item);
    const bearerNames = (entry.bearers ?? []).map((b) => b.name).join(", ");
    const tip = loc("itemRun.card.engagedByTip", { names: bearerNames, subject: subjectName, item: item?.name ?? "" });
    const holds = entry.saved === true ? (entry.immune !== undefined && entry.immune !== null
      ? { text: loc("itemRun.card.engagedHolds", { turns: entry.immune }), tip: loc("itemRun.card.engagedHoldsTip", { turns: entry.immune, item: item?.name ?? "" }) + (cite ? ` (${cite})` : "") }
      : { text: w.saved, ...(blankTip({ cite }) ? { tip: blankTip({ cite }) } : {}) }) : null;
    return {
      entryKey, entry, state, bearerNames, bearersTip: tip + (cite ? ` (${cite})` : ""), target: figure.target, targetTip: figure.tip ?? blankTip({ cite }),
      ids: { itemUuid: entry.itemUuid, rowKey: entry.rowKey, activationId: entry.activationId }, ...(holds ? { holds } : {}),
      closedWord: loc("itemRun.card.closedBy", { name: entry.closedBy?.name ?? "" }), notEngagedAria: loc("itemRun.card.notEngagedAria", { subject: subjectName, bearers: bearerNames }),
    };
  });
  const at = loc(card.moment === "turnStart" ? "itemRun.card.engagedAtTurnStart" : "itemRun.card.engagedAtEnter");
  const model = engagedCardModel({
    title: loc("itemRun.card.engagedTitle", { item: card.title ?? "" }),
    subtitle: card.round === null || card.round === undefined ? loc("itemRun.card.engagedSubtitle", { name: subjectName, at }) : loc("itemRun.card.engagedSubtitleRound", { name: subjectName, at, round: card.round }),
    note: loc("itemRun.card.engagedNote"), noteTooltip: loc("itemRun.card.engagedNoteTip"), words: w, rows, well: engagedWellOf(card), seat,
  });
  return renderRollCard(model);
}

/** Build the body of a once-only use's card for a seat. */
function onceBody(message, card) {
  const w = words();
  const item = fromUuidSync(card.itemUuid ?? "") ?? null;
  const ownsItem = item?.testUserPermission?.(game.user, "OWNER") === true;
  const owns = (key) => fromUuidSync(key)?.testUserPermission?.(game.user, "OWNER") === true;
  const mayUndo = (entry, key) => entry?.presser === game.user.id || fromUuidSync(key)?.testUserPermission?.(game.user, "OWNER") === true;
  const subjects = Object.values(card.subjects ?? {}).filter((s) => owns(s.uuid));
  const ids = { itemUuid: card.itemUuid, rowKey: card.rowKey, activationId: card.activationId };
  if (card.direct) {
    const rows = subjects.map((s) => {
      const entry = card.entries?.[safeKey(s.uuid)];
      const undo = mayUndo(entry, s.uuid) && entry?.state === "applied" && entry.recordIds?.length ? [{ action: "itemRun.undo", label: w.undo, icon: "fa-solid fa-rotate-left", data: { ...ids, subject: s.uuid, entryKey: safeKey(s.uuid) }, tooltip: w.undoTip }] : [];
      return entry?.state === "undone" ? { name: s.name, total: "", outcome: w.undone, emphasis: "muted" } : { name: s.name, total: "", outcome: w.given, emphasis: "success", actions: undo };
    });
    const unsettled = ownsItem ? unsettledRows(Object.values(card.undetermined ?? {}).map((s) => ({ key: s.uuid, name: s.name })), w, ids) : [];
    return renderRollCard({ title: card.title, subtitle: card.bearer?.name, bare: true, sections: [{ rows }, ...(unsettled.length ? [{ title: w.undetermined, rows: unsettled }] : [])] });
  }
  const entries = Object.fromEntries(subjects.map((s) => [s.uuid, card.entries?.[safeKey(s.uuid)]]));
  const model = promptCardModel({ title: card.title, subtitle: card.bearer?.name, words: { ...w, roll: w.save }, subjects: subjects.map((s) => ({ key: s.uuid, name: s.name })), undetermined: ownsItem ? Object.values(card.undetermined ?? {}).map((s) => ({ key: s.uuid, name: s.name })) : [], entries, ids, isGM: true });
  for (const section of model.sections) for (const r of section.rows) if (r.actions) r.actions = r.actions.filter((a) => a.action !== "itemRun.undo" || mayUndo(card.entries?.[safeKey(a.data.subject)], a.data.subject)).map((a) => (a.action === "itemRun.tick" ? countSubjectAction(w, ids, a.data.subject) : { ...a, data: { ...a.data, entryKey: safeKey(a.data.subject) } }));
  return renderRollCard({ ...model, bare: true });
}

/** Build the body of the whispered save card, reading the entry it names from the raised card. */
function whisperBody(w) {
  const { card } = cardOf(w.messageId);
  const entry = card?.entries?.[w.entryKey] ?? null;
  const item = fromUuidSync(w.itemUuid);
  const row = itemRunRowsOf(item).find((r) => r?.key === w.rowKey);
  const token = fromUuidSync(w.subject);
  const { target, tip } = saveFigureOf(token?.actor, row, item);
  const mine = token?.testUserPermission?.(game.user, "OWNER") === true;
  const names = conditionNames(row).join(", ");
  return renderRollCard(saveCardModel({
    title: loc(w.engaged ? "itemRun.card.engagedTitle" : "itemRun.card.whisperTitle", { item: item?.name ?? "" }), subtitle: token?.name ?? "", words: words(), target, targetTip: tip, ids: { itemUuid: w.itemUuid, rowKey: w.rowKey, activationId: w.activationId },
    subject: w.subject, entryKey: w.entryKey, messageId: w.messageId, entry: card ? entry : null, canPress: mine && (entry?.state ?? "open") === "open" && !!entry,
    ifFails: names ? loc("itemRun.card.ifFails", { names, life: lifeWord(failLife(row, !!game.combat?.combatants?.find?.((c) => c.tokenId === token?.id))) }) : "",
    ...(entry?.state === "closed" ? { closedWord: loc("itemRun.card.closedBy", { name: entry.closedBy?.name ?? "" }) } : {}),
  }));
}

/** Say why a press was refused. */
function refusal(reason) {
  const key = ["waiting", "struck", "applied", "immune", "notOwner", "notBearer", "noCard", "gone", "figure", "noFigure", "noVerdict", "noStructure", "noSpot", "noScene", "notViewing", "failed", "relay", "notVehicle", "noHull"].includes(reason) ? reason : "press";
  ui.notifications?.warn?.(loc(`itemRun.refused.${key}`));
}

/**
 * Move a lit fuse's spot: one click on the board of the scene the fuse is on
 * (`pickPoint`), then the relayed write, which checks the seat owns the bearer.
 * Nothing opens beyond the pick's banner; Escape or a right press cancels.
 */
async function moveSpot(message, ids) {
  const spot = cardOf(message.id).card?.fuse?.spot ?? null;
  if (!spot || canvas?.scene?.id !== spot.sceneId) return refusal("notViewing");
  const picked = await pickPoint({ text: { banner: loc("itemRun.card.pickSpot"), tip: loc("itemRun.card.pickSpotTip") } });
  if (!picked) return null;
  const out = await moveFuseSpot({ activationId: ids.activationId, spot: { sceneId: picked.sceneId, x: picked.x, y: picked.y, elevation: spot.elevation ?? 0, level: spot.level ?? "" } });
  return out?.ok === false ? refusal(out.reason) : null;
}

/** Apply every row of a burst card the seat owns that holds a verdict; the writer refuses each row the seat does not own, which is not told. A seat that wrote nothing is told why. */
async function applyAll(messageId) {
  const out = await applyAllEntries({ messageId });
  if (out?.ok === false) return refusal(out.reason);
  return out?.applied?.length || !out?.refused?.length ? null : refusal(out.refused[0].reason);
}

/** The press a button names, run from this seat. */
async function press(message, button) {
  const d = button.dataset;
  const ids = { itemUuid: d.itemUuid, rowKey: d.rowKey, activationId: d.activationId };
  const messageId = d.messageId || message.id;
  const fail = (out) => (out?.ok === false ? refusal(out.reason) : null);
  switch (d.action) {
    case "itemRun.roll": return fail(await pressRoll({ ...ids, subject: d.subject, messageId, entryKey: d.entryKey ?? "" }));
    case "itemRun.undo": return fail(await undoCardEntry({ messageId, entryKey: d.entryKey || safeKey(d.subject) }));
    case "itemRun.tick": return fail(await tickBearer({ itemUuid: ids.itemUuid, rowKey: ids.rowKey, messageId }));
    case "itemRun.tickSubject": return fail(await tickSubject({ messageId, subject: d.subject }));
    case "itemRun.untick": return fail(await untickBearer({ itemUuid: ids.itemUuid, rowKey: ids.rowKey, messageId }));
    case "itemRun.lower": return lowerReach({ tokenUuid: cardOf(messageId).card?.bearer?.uuid, activationId: ids.activationId });
    case "itemRun.recheck": return fail(await recheck({ messageId }));
    case "itemRun.notEngaged": return fail(await notEngaged({ messageId, entryKey: d.entryKey ?? "" }));
    case "itemRun.apply": return fail(await applyEntry({ messageId, entryKey: d.entryKey ?? "" }));
    case "itemRun.applyAll": return applyAll(messageId);
    case "itemRun.handOn": return fail(await handOn({ messageId, vehicleUuid: d.vehicleUuid }));
    case "itemRun.moveSpot": return moveSpot(message, ids);
    case "itemRun.setOff": return fail(await setFuseOffNow({ activationId: ids.activationId }));
    case "itemRun.swigHeal": return fail(await swigHeal({ messageId }));
    case "itemRun.swigAskSave": return fail(await swigAskSave({ messageId }));
    default: return null;
  }
}

/** Rebuild one rendered card for this seat and bind its buttons. */
function onRender(message, html) {
  const flags = message?.flags?.[MODULE_ID];
  const card = flags?.[FLAG_ITEM_RUN_CARD];
  const whisper = flags?.[FLAG_ITEM_RUN_WHISPER];
  const root = html?.nodeType === 1 ? html : (html?.[0] ?? null);
  const body = root?.querySelector?.(".message-content");
  if (!body || !(card || whisper)) return;
  body.innerHTML = whisper ? whisperBody(whisper) : cardBody(message, card);
  body.querySelectorAll("[data-action^='itemRun.']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      button.disabled = true;
      Promise.resolve(press(message, button))
        .catch((err) => console.error(`${MODULE_ID} | an item card's button failed`, err))
        .finally(() => {
          button.disabled = false;
        });
    });
  });
}

let installed = false;

/** Register the presenter, its listeners, the recheck relay and the render hook, once, at `ready`. */
export function installItemRunPresenter() {
  if (installed) return;
  installed = true;
  setUsePresenter(present);
  setPressListener(onPressed);
  onActivationLifted(onLifted);
  registerHandler(HANDLER.recheck, (payload) => recheckHere(payload));
  Hooks.on("renderChatMessageHTML", onRender);
}

export { present as presentUse, onReach as presentReach, onLifted, recheckHere, raisedBody, whisperBody, onceBody, engagedBody, fuseBody, burstBody, consumeBody, swigUnknownBody, outcomeBody, cardBody, press, lifeWord, messageIdFor, refusal, saveFigureOf };
