/* global game, ChatMessage, Hooks, fromUuid, fromUuidSync */
/**
 * Concentration's end. A spell held by concentration leaves a status-only
 * record on its caster (`concentrating`, or `concentratingStationary`) carrying
 * the kind held and the time its effects outlast it (`tail`), and each recipient
 * of the cast carries a record of its own. However the caster's record goes (the
 * system's hit-point loss path, a failed save, the status's own toggle, a hand
 * delete, another cast, the cap running out) the client that deleted it ends the
 * cast: one funnel, run on that client because the cause of the end exists
 * nowhere else (`deleteActiveEffect` fires on the deleting client with the
 * operation's options, and lib's loss path holds its cause while it lifts).
 *
 * The cause, first match wins: the cast's own delete names it in the operation's
 * options (`cast`, `time`, or `saved` for a recurring prompt's passed save,
 * `cast-recur.mjs`); else the loss lib is lifting for this actor
 * (`damage` or `save`); else `removed`. It is read before anything awaits.
 *
 * What the funnel does to a recipient record it can write, by the caster
 * record's `tail`: none, delete it; a tail, re-time it from now to run out the
 * tail; a tail the import did not read, keep it and list it with End. The
 * records it cannot write go to the GM's client through `magicHeldEnd`; with no
 * GM connected they stay and are listed with End. One card, whispered to the GMs
 * and the caster's owners, says why and what ended, what runs on, what still
 * stands, and carries the Judge's Restore (every record it lists, put back with
 * its own id, the re-timings undone).
 *
 * The GM's client takes the tail from the spell, never from the request, and
 * accepts the request only from a user who owns the caster once no held record
 * of the cast remains.
 *
 * See docs/magic/DECISIONS.md, "Concentration's end is one funnel on the
 * deleting client".
 */
import { MODULE_ID, LANG_PREFIX, FLAG_SPELL_EFFECT, FLAG_SPELL, CAST_HELD_END_FLAG, HELD_END_HANDLER } from "./constants.mjs";
import { spellEffectOf } from "./spell-effect.mjs";
import { castEndedRecipients } from "./cast-expiry.mjs";
import { worldActors } from "../lib/repair.mjs";
import { lossInFlight } from "../lib/status-effects.mjs";
import { escape as esc, unset } from "../lib/util.mjs";

/** The causes a card names. */
export const HELD_CAUSES = Object.freeze(["damage", "save", "cast", "time", "removed", "saved"]);

/** The status a held record carries, by the kind of concentration. */
export const heldStatusOf = (held) => (held === "stationary" ? "concentratingStationary" : "concentrating");

/** The causes a cast's own delete may name in the operation's options: `saved` is a recurring prompt's pass ending the cast (`cast-recur.mjs`). */
const NAMED = new Set(["cast", "time", "saved"]);

/** The causes lib's loss path may hold for a concentration. */
const LOST = new Set(["damage", "save"]);

/**
 * The cause of a held record's end, from the delete's operation options and the
 * loss in flight. Pure: both are passed in.
 * @param {object|undefined} options  the delete hook's options
 * @param {{cause: string}|null} loss  `lossInFlight`'s answer for the caster's actor
 * @returns {"damage"|"save"|"cast"|"time"|"removed"|"saved"}
 */
export function causeOf(options, loss) {
  const named = options?.[MODULE_ID]?.endCause;
  if (NAMED.has(named)) return named;
  return LOST.has(loss?.cause) ? loss.cause : "removed";
}

/** Is this a usable duration, `{value, units}`? */
const timed = (d) => Boolean(d) && !d.none && Number.isFinite(Number(d.value)) && Boolean(d.units);

/**
 * What ending a held cast does to each recipient record. `tail` is the caster
 * record's: absent, a `{value, units}`, or a `{none}`. A record the client
 * cannot write goes to `relay`, whatever the tail. Pure.
 *
 * @param {object} from
 * @param {{value: number, units: string}|{none: string}|undefined} from.tail
 * @param {Array<{id: string, actorUuid: string, startTime?: number, duration?: object}>} from.recipients
 * @param {(recipient: object) => boolean} [from.canWrite]  every record by default
 * @param {number} from.now  the world time
 * @returns {{remove: object[], retime: object[], open: object[], relay: object[]}} a retimed record carries its earlier figures in `was`
 */
export function heldEndPlan({ tail, recipients = [], canWrite = () => true, now }) {
  const plan = { remove: [], retime: [], open: [], relay: [] };
  for (const r of recipients) {
    if (!canWrite(r)) plan.relay.push(r);
    else if (tail?.none) plan.open.push(r);
    else if (timed(tail)) plan.retime.push({ ...r, was: { startTime: r.startTime ?? null, duration: r.duration ?? null }, startTime: now, duration: { value: Number(tail.value), units: tail.units } });
    else plan.remove.push(r);
  }
  return plan;
}

/**
 * Is a relayed request to end the rest of a held cast good? The requester must
 * own the caster (a GM's own request carries no user id and always does), and no
 * held caster record of the cast may remain, so a seat cannot end a cast that is
 * still held. Pure.
 *
 * @param {{requestUserId?: string|null, casterUuid?: string, castId?: string}} req
 * @param {{caster: object|null, ownsCaster: boolean, heldRemains: boolean}} world
 * @returns {{ok: true}|{refused: string}}
 */
export function checkHeldEndRequest(req, world) {
  if (!req?.casterUuid || !req?.castId) return { refused: "noCast" };
  if (!world?.caster) return { refused: "noCaster" };
  if (req.requestUserId && !world.ownsCaster) return { refused: "notOwner" };
  if (world.heldRemains) return { refused: "heldRemains" };
  return { ok: true };
}

/** The top-level keys a restored record keeps; a change list is always empty, since no record of this module carries one. */
const RESTORED_KEYS = ["_id", "name", "img", "origin", "transfer", "disabled", "statuses"];

/** A restored record's data: only what this module wrote, bound to the card's own cast. Null for data that is not a record of that cast. */
function restorable(data, flag) {
  const mark = data?.flags?.[MODULE_ID]?.[FLAG_SPELL_EFFECT];
  if (!mark || mark.castId !== flag.castId || mark.casterUuid !== flag.casterUuid) return null;
  const out = { changes: [], flags: { [MODULE_ID]: foundryClone(data.flags[MODULE_ID]) } };
  for (const key of RESTORED_KEYS) if (data[key] !== undefined) out[key] = data[key];
  return out;
}

/** A deep copy of plain data. */
const foundryClone = (value) => (value === undefined ? value : JSON.parse(JSON.stringify(value)));

/**
 * What a Restore does, from a card's flag: the records to put back (the caster's
 * first, then every ended recipient's, each with its own id) and the re-timings
 * to undo. A record whose data is not a record of the card's own cast is
 * skipped and counted, so a card cannot be used to write anything else. Pure.
 *
 * @param {object} flag  the card's `castHeldEnd` flag
 * @returns {{create: Array<{actorUuid: string, data: object}>, undo: Array<{actorUuid: string, id: string, was: object}>, skipped: number}}
 */
export function restorePlan(flag) {
  const out = { create: [], undo: [], skipped: 0 };
  const wanted = [flag?.caster, ...(flag?.ended ?? [])].filter(Boolean);
  for (const item of wanted) {
    const data = item.actorUuid && item.data ? restorable(item.data, flag) : null;
    if (data?._id) out.create.push({ actorUuid: item.actorUuid, data });
    else out.skipped++;
  }
  for (const r of flag?.retimed ?? []) if (r.actorUuid && r.id && r.was) out.undo.push({ actorUuid: r.actorUuid, id: r.id, was: r.was });
  return out;
}

/**
 * Run a plan's removals and re-timings through `deps`, answering what was done.
 * A removal that finds nothing to remove is not counted as ended.
 *
 * @param {{remove: object[], retime: object[], open: object[]}} plan
 * @param {{remove: Function, retime: Function}} deps
 * @returns {Promise<{ended: object[], retimed: object[], open: object[]}>}
 */
export async function runHeldPlan(plan, deps) {
  const ended = [];
  const retimed = [];
  for (const r of plan.remove) {
    if ((await deps.remove(r)) !== false) ended.push({ actorUuid: r.actorUuid, id: r.id, name: r.name, data: r.data ?? null });
  }
  for (const r of plan.retime) {
    await deps.retime(r);
    retimed.push({ actorUuid: r.actorUuid, id: r.id, name: r.name, was: r.was, startTime: r.startTime, duration: r.duration });
  }
  const open = plan.open.map((r) => ({ actorUuid: r.actorUuid, id: r.id, name: r.name }));
  return { ended, retimed, open };
}

/**
 * End a held cast whose caster record has just been deleted: the recipient
 * records this client can write by the tail, the rest handed to the GM's client,
 * then the one card.
 *
 * @param {object} record  the deleted caster record as `spellEffectOf` reads it
 * @param {object} o
 * @param {string} o.cause  a `HELD_CAUSES` value
 * @param {object} o.caster  `{actorUuid, name, data}` of the caster record's actor and the deleted record's data, for Restore
 * @param {object} o.deps  `now()`, `recipients(castId)`, `canWrite(recipient)`, `remove(recipient)`, `retime(recipient)`, `relay(request)` (answers `{ok, ended, retimed, open}` or null with no GM) and `post(flag)`
 * @returns {Promise<object>} the card's flag
 */
export async function endHeldCast(record, { cause, caster, deps }) {
  const recipients = await deps.recipients(record.castId);
  const plan = heldEndPlan({ tail: record.tail, recipients, canWrite: deps.canWrite, now: deps.now() });
  const done = await runHeldPlan(plan, deps);
  if (plan.relay.length) {
    const answer = await deps.relay?.({ casterUuid: record.casterUuid, castId: record.castId, cause });
    if (answer?.ok) {
      done.ended.push(...answer.ended);
      done.retimed.push(...answer.retimed);
      done.open.push(...answer.open);
    } else done.open.push(...plan.relay.map((r) => ({ actorUuid: r.actorUuid, id: r.id, name: r.name })));
  }
  const flag = {
    cause,
    castId: record.castId,
    casterUuid: record.casterUuid,
    spellUuid: record.spellUuid,
    spellName: caster.spellName ?? "",
    casterName: caster.name ?? "",
    cite: caster.cite ?? "",
    ended: done.ended,
    retimed: done.retimed,
    open: done.open,
    caster: { actorUuid: caster.actorUuid, data: caster.data },
  };
  await deps.post(flag);
  return flag;
}

/* -------------------------------------------- */
/*  The card                                     */
/* -------------------------------------------- */

/** The attributes the card's buttons carry. */
const END_ATTR = "data-acks-extras-held-end";
const RESTORE_ATTR = "data-acks-extras-held-restore";

/**
 * The card's body, as a viewer with no rights sees it: the buttons are in it and
 * the render hook takes away the ones the seat may not press. Every figure
 * carries a tooltip naming where it came from.
 *
 * @param {object} flag  the card's `castHeldEnd` flag
 * @param {(key: string, data?: object) => string} loc  this card's strings, `ACKS-MAGIC.castHeld.<key>`
 */
export function heldEndContent(flag, loc) {
  const cite = flag.cite ? ` (${flag.cite})` : "";
  const list = (items, line) => (items.length ? `<ul>${items.map((i) => `<li>${line(i)}</li>`).join("")}</ul>` : "");
  const sections = [];
  if (flag.ended?.length) sections.push(`<section><h5>${esc(loc("ended"))}</h5>${list(flag.ended, (i) => esc(i.name))}</section>`);
  if (flag.retimed?.length) {
    const line = (i) => `${esc(i.name)}: <span data-tooltip-text="${esc(loc("tip.retimed", { value: i.duration.value, units: i.duration.units, cite: flag.cite ?? "" }))}">${esc(`${i.duration.value} ${i.duration.units}`)}</span>`;
    sections.push(`<section><h5>${esc(loc("retimed"))}</h5>${list(flag.retimed, line)}</section>`);
  }
  if (flag.open?.length) {
    const line = (i) => `${esc(i.name)} <button type="button" ${END_ATTR} data-actor-uuid="${esc(i.actorUuid)}" data-record-id="${esc(i.id)}">${esc(loc("button.end"))}</button>`;
    sections.push(`<section><h5>${esc(loc("open"))}</h5>${list(flag.open, line)}</section>`);
  }
  const restore = `<button type="button" ${RESTORE_ATTR} data-tooltip-text="${esc(loc("tip.restore"))}"><i class="fa-solid fa-rotate-left" inert></i> ${esc(loc("button.restore"))}</button>`;
  return (
    `<div class="acks-extras-cast-held"><h4>${esc(loc("title", { spell: flag.spellName, name: flag.casterName }))}</h4>` +
    `<p>${esc(loc(`cause.${HELD_CAUSES.includes(flag.cause) ? flag.cause : "removed"}`))}${esc(cite)}</p>${sections.join("")}${restore}</div>`
  );
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** A string of this file's lang group. */
const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.castHeld.${key}`, data ?? {});

/** Funnels running on this window, by the deleted record's uuid. */
const funnels = new Map();

/** Resolves once every end this window has begun has posted its card. */
export const settledEnds = () => Promise.all([...funnels.values()]);

/** Every recipient record of one cast, on every actor and unlinked token, with what this user may do to it. */
function liveRecipients(castId, { all = false } = {}) {
  const out = [];
  for (const actor of worldActors()) {
    for (const effect of actor.effects ?? []) {
      const record = spellEffectOf(effect);
      if (record?.role !== "recipient" || record.castId !== castId) continue;
      out.push({
        id: effect.id,
        actorUuid: actor.uuid,
        name: actor.name,
        spellUuid: record.spellUuid,
        startTime: record.startTime,
        duration: record.duration,
        data: effect.toObject(),
        writable: all || game.user.isGM || actor.isOwner === true,
      });
    }
  }
  return out;
}

/** The two writes a plan makes, from this client. */
const liveWrites = () => ({
  remove: async (r) => {
    const actor = await fromUuid(r.actorUuid);
    if (!actor?.effects?.has(r.id)) return false;
    await actor.deleteEmbeddedDocuments("ActiveEffect", [r.id]);
    return true;
  },
  retime: async (r) => {
    const actor = await fromUuid(r.actorUuid);
    await actor?.effects?.get(r.id)?.update({ [`flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}.startTime`]: r.startTime, [`flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}.duration`]: r.duration });
  },
});

/** Post the card: whispered to the GMs and the caster's owners, its flag the model Restore reads. */
async function postCard(flag) {
  const caster = await fromUuid(flag.caster.actorUuid);
  const isGM = (id) => !!game.users.get(id)?.isGM;
  return ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor: caster }),
    whisper: castEndedRecipients(caster?.ownership, game.users.filter((u) => u.isGM).map((u) => u.id), isGM),
    content: heldEndContent(flag, loc),
    flags: { [MODULE_ID]: { [CAST_HELD_END_FLAG]: flag } },
  });
}

/** The live dependencies of an end begun on this client. */
const liveDeps = () => ({
  ...liveWrites(),
  now: () => game.time.worldTime,
  recipients: async (castId) => liveRecipients(castId),
  canWrite: (r) => r.writable,
  relay: async (request) => {
    // No GM connected: lib's door would warn the seat, and the records simply stay listed.
    if (game.user.isGM || !game.users.activeGM) return null;
    const { executeAsGM } = await import("../lib/sockets.mjs");
    return executeAsGM(HELD_END_HANDLER, request);
  },
  post: postCard,
});

/**
 * The GM's client takes the records a seat could not write: checked, then ended
 * by the tail the spell gives, never the request's.
 * @param {object} payload  `{requestUserId, casterUuid, castId, cause}`
 * @returns {Promise<{ok: boolean, reason?: string, ended?: object[], retimed?: object[], open?: object[]}>}
 */
export async function magicHeldEnd(payload = {}) {
  const caster = payload.casterUuid ? fromUuidSync(payload.casterUuid) : null;
  const user = game.users.get(payload.requestUserId);
  const heldRemains = [...(caster?.effects ?? [])].some((e) => {
    const r = spellEffectOf(e);
    return r?.role === "caster" && r.held && r.castId === payload.castId;
  });
  const verdict = checkHeldEndRequest(payload, { caster, ownsCaster: !user || user.isGM || caster?.testUserPermission?.(user, "OWNER") === true, heldRemains });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  const recipients = liveRecipients(payload.castId, { all: true });
  const spell = recipients[0]?.spellUuid ? fromUuidSync(recipients[0].spellUuid) : null;
  let tail;
  if (spell?.parent?.uuid === caster.uuid) {
    const { castDurationOf } = await import("./cast-spell.mjs");
    const { byCookbookId } = await import("../lib/library.mjs");
    tail = castDurationOf(spell, { byCookbookId, fromUuidSync: (u) => fromUuidSync(u) }, null).tail;
  }
  const plan = heldEndPlan({ tail, recipients, now: game.time.worldTime });
  return { ok: true, ...(await runHeldPlan(plan, liveWrites())) };
}

/** The cause of a deleted caster record, read before anything awaits: loss in flight dies with the lift. */
function onDeleteEffect(effect, options, userId) {
  if (userId !== game.user?.id) return;
  const record = spellEffectOf(effect);
  if (record?.role !== "caster" || !record.held) return;
  const cause = causeOf(options, lossInFlight(effect.parent));
  const key = effect.uuid ?? effect.id;
  if (funnels.has(key)) return;
  const spell = fromUuidSync(record.spellUuid);
  const caster = {
    actorUuid: effect.parent?.uuid,
    name: effect.parent?.name ?? "",
    spellName: spell?.name ?? effect.name ?? "",
    cite: spell?.flags?.[MODULE_ID]?.[FLAG_SPELL]?.cite ?? "",
    data: effect.toObject(),
  };
  const run = endHeldCast(record, { cause, caster, deps: liveDeps() })
    .catch((err) => console.error(`${MODULE_ID} | a concentration's end could not be carried out`, err))
    .finally(() => funnels.delete(key));
  funnels.set(key, run);
}

/**
 * End the caster's held casts because the caster is casting again: their
 * records are deleted by id naming the cast as the cause, and this resolves once
 * each end has posted its card, so no record of the new cast is written before.
 * @param {object} caster  the actor
 * @returns {Promise<string[]>} the ids of the records deleted
 */
export async function endCasterHeld(caster) {
  const held = [...(caster?.effects ?? [])].filter((e) => {
    const r = spellEffectOf(e);
    return r?.role === "caster" && r.held;
  });
  if (!held.length) return [];
  await caster.deleteEmbeddedDocuments("ActiveEffect", held.map((e) => e.id), { [MODULE_ID]: { endCause: "cast" } });
  await settledEnds();
  return held.map((e) => e.id);
}

/** Restore press: the Judge's. Puts back every record the card lists and undoes its re-timings. */
async function pressRestore(message) {
  if (!game.user.isGM) return;
  const flag = message.flags?.[MODULE_ID]?.[CAST_HELD_END_FLAG];
  if (!flag || flag.restored) return;
  const plan = restorePlan(flag);
  for (const { actorUuid, data } of plan.create) {
    const actor = await fromUuid(actorUuid);
    if (!actor?.effects || actor.effects.has(data._id)) continue;
    await actor.createEmbeddedDocuments("ActiveEffect", [data], { keepId: true });
  }
  for (const { actorUuid, id, was } of plan.undo) {
    const effect = (await fromUuid(actorUuid))?.effects?.get(id);
    if (!effect) continue;
    const path = `flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}`;
    await effect.update({ [`${path}.startTime`]: was.startTime, ...(was.duration ? { [`${path}.duration`]: was.duration } : { [`${path}.duration`]: unset() }) });
  }
  await message.update({ [`flags.${MODULE_ID}.${CAST_HELD_END_FLAG}.restored`]: { by: game.user.name } });
}

/** An End press: one listed record deleted by id. */
async function pressEnd(button) {
  const actor = await fromUuid(button.dataset.actorUuid);
  const id = button.dataset.recordId;
  if (actor?.effects?.has(id)) await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
  button.disabled = true;
}

/** Wire a card's buttons for this seat: Restore for a GM alone, End for the record's owners and GMs. */
function bindCard(message, html) {
  const flag = message?.flags?.[MODULE_ID]?.[CAST_HELD_END_FLAG];
  if (!flag || !html?.querySelectorAll) return;
  for (const button of html.querySelectorAll(`[${RESTORE_ATTR}]`)) {
    if (!game.user.isGM) button.remove();
    else if (flag.restored) {
      button.disabled = true;
      button.textContent = loc("restored", { name: flag.restored.by ?? "" });
    } else {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        pressRestore(message).catch((err) => console.error(`${MODULE_ID} | restore failed`, err));
      });
    }
  }
  for (const button of html.querySelectorAll(`[${END_ATTR}]`)) {
    const owner = game.user.isGM || fromUuidSync(button.dataset.actorUuid)?.isOwner === true;
    if (!owner) button.remove();
    else {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        pressEnd(button).catch((err) => console.error(`${MODULE_ID} | end failed`, err));
      });
    }
  }
}

let registered = false;

/** Register the end funnel, the relay's handler and the card's buttons. Once, at `init`. */
export function registerCastHeld() {
  if (registered) return;
  registered = true;
  Hooks.on("deleteActiveEffect", onDeleteEffect);
  Hooks.on("renderChatMessageHTML", bindCard);
  void import("../lib/sockets.mjs").then(({ registerHandler }) => registerHandler(HELD_END_HANDLER, magicHeldEnd));
}
