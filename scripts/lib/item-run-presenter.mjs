/* global game, ChatMessage, Hooks, fromUuidSync, foundry, ui, CONFIG */
/**
 * The cards an item the carrier ran draws in chat (`item-run.mjs` posts none):
 * the raised-item card (board 4b), the whispered save card (board 4c) and the
 * once-only use's card. Registered with `setUsePresenter`, and heard by the
 * carrier's press, lift and tick listeners.
 *
 * - A raise posts one message holding the card's state (`FLAG_ITEM_RUN_CARD`,
 *   `item-run-card-logic.mjs` `newCard`): the subjects it lists and ONE
 *   moment-keyed entry store. A reach's `list`, `refuse`, `out` and
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
import { figureNumber, readReach, reachAdmits } from "./aura-reach-logic.mjs";
import { lowerReach, releaseReachMoment } from "./aura-reach.mjs";
import { itemCite, itemRunRowsOf, promptCardModel } from "./item-run-logic.mjs";
import { admittedWithCount, countSubjectAction, isCountedIn, patchOut, patchPrompt, patchSubject, patchUncount, patchUndetermined, reachCardModel, rowStateOf, safeKey, saveCardModel, saveTip, newCard, unsettledRows } from "./item-run-card-logic.mjs";
import { cardOf, onActivationLifted, ownerIdsOf, patchCard, pressRoll, saveNameOf, serialized, setPressListener, setUsePresenter, tickBearer, tickSubject, undoCardEntry, untickBearer } from "./item-run.mjs";
import { saveSpec } from "./saves.mjs";
import { tokenEdgeGapFeet } from "./distance-units.mjs";
import { executeAsGM, judgeDeclares, registerHandler } from "./sockets.mjs";
import { isMarkerActor } from "./place.mjs";
import { isPrimaryGM, makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);
const esc = (s) => foundry.utils.escapeHTML(String(s ?? ""));
const HANDLER = Object.freeze({ recheck: `${MODULE_ID}.itemRun.recheck` });

/** The card's words, localized: `itemRun.card.<key>` for each. */
const WORD_KEYS = [
  "roll", "undo", "saved", "failed", "out", "notTarget", "waiting", "asked", "undone", "undetermined", "save", "rollSave", "countIn", "countOut", "countSubjectTip", "countSubjectRaisedTip", "counted", "bearer", "well", "check", "lower", "colDistance", "given",
  "earlyTip", "saveTip", "undoTip", "countInTip", "countOutTip", "bearerTip", "checkTip", "lowerTip",
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

/** The use of an item: a raise posts the raised card and replays the moments that came first; a once-only use posts its card. */
async function present(result) {
  if (result?.kind === "toggle" && result.active) return postRaised(result);
  if (result?.kind === "once") return postOnce(result);
  if (result?.kind === "reach") return onReach(result);
  return null;
}

/** Post the raised card for a toggle's activation. */
async function postRaised({ itemUuid, rowKey, activationId, tokenUuid, regionUuid = "" }) {
  const item = fromUuidSync(itemUuid);
  const token = fromUuidSync(tokenUuid);
  if (!item || !token) return;
  const card = newCard({ itemUuid, rowKey, activationId, kind: "toggle", bearer: { uuid: tokenUuid, name: token.name }, regionUuid, cardId: foundry.utils.randomID() });
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

/** What a failed save lasts, in words: the subject's next turn start in a fight, else its first one in a fight. */
const lifeWord = (life) => loc(`itemRun.card.life.${life === "turn" || life === "mark" ? life : "raised"}`);

/** Whisper the save card for an opened entry to the owners of the subject's token, and keep its id on the entry. */
async function whisperSave({ message, key, subjectToken, item, rowKey, activationId }) {
  const recipients = ownerIdsOf(subjectToken);
  if (!recipients.length || !item) return;
  const row = itemRunRowsOf(item).find((r) => r?.key === rowKey);
  const w = words();
  const { target, tip } = saveFigureOf(subjectToken.actor, row, item);
  const inFight = !!game.combat?.combatants?.find?.((c) => c.tokenId === subjectToken.id);
  const names = conditionNames(row).join(", ");
  const model = saveCardModel({
    title: loc("itemRun.card.whisperTitle", { item: item.name }), subtitle: subjectToken.name, words: w, target, targetTip: tip, ids: { itemUuid: item.uuid, rowKey, activationId }, subject: subjectToken.uuid, entryKey: key, messageId: message.id,
    ifFails: names ? loc("itemRun.card.ifFails", { names, life: lifeWord(inFight ? "turn" : "mark") }) : "",
  });
  const whisper = await ChatMessage.create({
    whisper: recipients,
    speaker: ChatMessage.getSpeaker?.({ token: subjectToken }),
    content: renderRollCard(model),
    flags: { [MODULE_ID]: { [FLAG_ITEM_RUN_WHISPER]: { messageId: message.id, entryKey: key, subject: subjectToken.uuid, itemUuid: item.uuid, rowKey, activationId } } },
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
 * mute rows to match, asking nobody. The relayed seat must own the bearer's
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
 * The rows a raised card draws, read live: each listed subject's state, distance,
 * save figure and history. A standing reach asks no save, so a body counted in
 * under it (a listed row that would wait for a moment) reads `held`.
 */
function rowsOf(card, row, item, bearerToken, reach) {
  const rowFor = (sub, { distance, bearer = false }) => {
    const token = fromUuidSync(sub.uuid);
    const listed = rowStateOf(card, sub.uuid);
    const state = listed === "waiting" && reach?.pulse === "standing" && !bearer && isCountedIn(card, sub.uuid) ? "held" : listed;
    const entry = card.entries?.[sub.latest] ?? null;
    const gap = distance && bearerToken && token ? tokenEdgeGapFeet(bearerToken, token) : null;
    const feet = gap === null ? null : Math.round(gap);
    const figure = ["open", "applied", "undone"].includes(state) ? saveFigureOf(token?.actor, row, item) : { target: null, tip: null };
    const earlier = Object.entries(card.entries ?? {}).filter(([key, e]) => e.subject === sub.uuid && key !== sub.latest && e.state !== "open").map(([, e]) => (e.state === "applied" ? loc("itemRun.card.tip.earlier", { result: e.saved ? loc("itemRun.card.saved") : loc("itemRun.card.failed"), total: e.total, target: e.target }) : loc("itemRun.card.undone")));
    return {
      key: sub.uuid, name: sub.name, state, entryKey: sub.latest, entry, feet,
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
  const bearer = card.bearer?.uuid ? { key: card.bearer.uuid, name: card.bearer.name, counted, ...(counted ? { row: bearerSub ? rowFor(bearerSub, { distance: false, bearer: true }) : { state: "waiting", feet: null } } : {}) } : null;
  const { note, noteTooltip } = reachNote(item, reach);
  const model = reachCardModel({
    title: item?.name ?? "", subtitle: card.bearer?.name, note, noteTooltip, words: { ...words(), bearerTip: loc("itemRun.card.bearerTip") },
    rows: subjects.map((s) => rowFor(s, { distance: true })), undetermined: Object.values(card.undetermined ?? {}).map((s) => ({ key: s.uuid, name: s.name })), bearer, well: wellOf(card), ids: { itemUuid: card.itemUuid, rowKey: card.rowKey, activationId: card.activationId }, seat, lowered: card.lowered === true,
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
    title: loc("itemRun.card.whisperTitle", { item: item?.name ?? "" }), subtitle: token?.name ?? "", words: words(), target, targetTip: tip, ids: { itemUuid: w.itemUuid, rowKey: w.rowKey, activationId: w.activationId },
    subject: w.subject, entryKey: w.entryKey, messageId: w.messageId, entry: card ? entry : null, canPress: mine && (entry?.state ?? "open") === "open" && !!entry,
    ifFails: names ? loc("itemRun.card.ifFails", { names, life: lifeWord(game.combat?.combatants?.find?.((c) => c.tokenId === token?.id) ? "turn" : "mark") }) : "",
  }));
}

/** Say why a press was refused. */
function refusal(reason) {
  const key = ["waiting", "struck", "applied", "immune", "notOwner", "noCard", "gone", "figure", "noFigure"].includes(reason) ? reason : "press";
  ui.notifications?.warn?.(loc(`itemRun.refused.${key}`));
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
  body.innerHTML = whisper ? whisperBody(whisper) : card.kind === "once" ? onceBody(message, card) : raisedBody(message, card);
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

export { present as presentUse, onReach as presentReach, onLifted, recheckHere, raisedBody, whisperBody, onceBody, messageIdFor, refusal, saveFigureOf };
