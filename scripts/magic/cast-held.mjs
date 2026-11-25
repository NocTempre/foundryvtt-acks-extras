/* global game, ui, ChatMessage, Hooks, foundry, fromUuid, fromUuidSync */
/**
 * Concentration's end. A spell held by concentration leaves a status-only
 * record on its caster (`concentrating`, or `concentrating-and-stationary`) carrying
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
 * stands, and carries Restore for an owner of the caster (every record it lists,
 * put back with its own id, the re-timings undone). A held summons' control ends
 * with the concentration, and what becomes of its creatures is the spell's row's
 * word (`cast-control.mjs`): the GM's client applies it, and the card says which
 * and lists the creatures the cast left, one row each with Dismiss (not drawn
 * for creatures that went) and Dismiss all, for an owner of the caster, and on a
 * card whose creatures turned hostile for the Judge alone (RR ch. 5); Restore
 * puts back the records only, so it is offered on every outcome. The card is
 * `templates/magic/cast-held-card.hbs`.
 *
 * A Restore the seat cannot carry out itself (the card or a listed actor is not
 * its own) is relayed to the GM's client as `{op: "restore", messageId}`. That
 * client reads the caster and the records from the stored card, never from the
 * request, and writes only the actors the sender owns when the card was not
 * authored by a GM: a seat's card is the seat's word, so its records are not
 * written onto a character the seat does not own.
 *
 * The GM's client takes the tail from the spell, never from the request, and
 * accepts the request only from a user who owns the caster once no held record
 * of the cast remains.
 *
 * See docs/magic/DECISIONS.md, "Concentration's end is one funnel on the
 * deleting client".
 */
import { MODULE_ID, LANG_PREFIX, FLAG_SPELL_EFFECT, FLAG_SPELL, CAST_HELD_END_FLAG, HELD_END_HANDLER } from "./constants.mjs";
import { spellEffectOf, spellEffectData } from "./spell-effect.mjs";
import { castEndedRecipients } from "./cast-expiry.mjs";
import { worldActors } from "../lib/repair.mjs";
import { lossInFlight } from "../lib/status-effects.mjs";
import { statusEffectData } from "../lib/held-condition.mjs";
import { unset } from "../lib/util.mjs";
import { CONTROL_ENDS } from "../lib/magic-vocab.mjs";

/** The causes a card names. */
export const HELD_CAUSES = Object.freeze(["damage", "save", "cast", "time", "removed", "saved"]);

/** The status a held record carries, by the kind of concentration. */
export const heldStatusOf = (held) => (held === "stationary" ? "concentrating-and-stationary" : "concentrating");

/**
 * The caster record a concentration leaves, the one composition every cast that
 * is held by concentration writes: the status for the kind held, the kind, the
 * time its effects outlast it (`tail`), and the clock started now and flag-timed
 * by the cap where the spell has one. A cast that is not held writes no such
 * record and does not call this.
 *
 * @param {object} mark  the record's identity as `spellEffectData` takes it: `spell`, `caster`, `castId`, `role`, and `invocationLevel` where the cast has one
 * @param {object} from
 * @param {string} from.held  the kind held, `"stationary"` or any other kind
 * @param {number} [from.now]  the world time the record starts at
 * @param {{value: number, units: string}|{none: string}} [from.tail]  what the cast's effects outlast the concentration by
 * @param {{value: number, units: string}|{none: string}} [from.cap]  the longest the concentration may last
 * @returns {object} the Active Effect data to create on the caster
 */
export function heldRecordData(mark, { held, now, tail, cap }) {
  return spellEffectData({ ...mark, startTime: now, statuses: [heldStatusOf(held)], held, tail, duration: cap });
}

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

/** The top-level keys a restored record keeps; its change list is always empty and its figures never come from the card (`restoredAs`). */
const RESTORED_KEYS = ["_id", "name", "img", "origin", "transfer", "disabled", "statuses"];

/** A restored record's data: only what this module wrote, bound to the card's own cast. Null for data that is not a record of that cast. */
function restorable(data, flag) {
  const mark = data?.flags?.[MODULE_ID]?.[FLAG_SPELL_EFFECT];
  if (!mark || mark.castId !== flag.castId || mark.casterUuid !== flag.casterUuid) return null;
  const out = { changes: [], flags: { [MODULE_ID]: foundryClone(data.flags[MODULE_ID]) } };
  for (const key of RESTORED_KEYS) if (data[key] !== undefined) out[key] = data[key];
  return out;
}

/**
 * A restored record of a condition, as the builder gives that condition: its
 * statuses and `system.changes` are what `built` (`statusEffectData`) returned
 * for the record's first status, never what the card held, so a card cannot
 * write a figure and a restored record carries the figure a fresh one would.
 * Data with no status, or whose first status the builder did not answer, is
 * returned as it is.
 *
 * @param {object} data  a restorable record's data (`restorePlan`)
 * @param {{statuses: string[], system?: {changes?: object[]}}|null} built
 * @returns {object}
 */
export function restoredAs(data, built) {
  const first = data?.statuses?.[0];
  if (!first || built?.statuses?.[0] !== first) return data;
  const figures = Array.from(built.system?.changes ?? []);
  const { changes: _legacy, ...rest } = data;
  return { ...rest, statuses: [...built.statuses], ...(figures.length ? { system: { changes: figures.map((change) => ({ ...change })) } } : { changes: [] }) };
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
 * Is a relayed Restore good? The card must still be in the world, must not be
 * restored already, and the requester must own the caster the card names (a GM's
 * own request carries no user id and always does). Pure.
 *
 * @param {{requestUserId?: string|null}} req
 * @param {{flag: object|undefined, ownsCaster: boolean}} world  the stored card's flag, and whether the requester owns its caster
 * @returns {{ok: true}|{refused: "noCard"|"restored"|"notOwner"}}
 */
export function checkRestoreRequest(req, { flag, ownsCaster } = {}) {
  if (!flag) return { refused: "noCard" };
  if (flag.restored) return { refused: "restored" };
  if (req?.requestUserId && !ownsCaster) return { refused: "notOwner" };
  return { ok: true };
}

/**
 * Split a restore plan by what its writer may write: the records on actors
 * `mayWrite` accepts stay in `plan`, and the others are counted in `refused`.
 * Pure; the plan's `skipped` rides along.
 *
 * @param {{create: Array<{actorUuid: string}>, undo: Array<{actorUuid: string}>, skipped: number}} plan  `restorePlan`'s
 * @param {(actorUuid: string) => boolean} mayWrite
 * @returns {{plan: object, refused: number}}
 */
export function restoreSplit(plan, mayWrite) {
  const create = plan.create.filter((c) => mayWrite(c.actorUuid));
  const undo = plan.undo.filter((u) => mayWrite(u.actorUuid));
  return { plan: { ...plan, create, undo }, refused: plan.create.length - create.length + plan.undo.length - undo.length };
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
 * @param {object} o.deps  `now()`, `recipients(castId)`, `canWrite(recipient)`, `remove(recipient)`, `retime(recipient)`, `relay(request)` (answers `{ok, ended, retimed, open}` or null with no GM), `post(flag)` and, optional, `standing(record)` (the cast's creatures still standing, `{tokens, held}`, as `castSummons` answers) and `control(request)` (the GM's client ends the creatures' control as the spell's row says: `{ok, outcome}`, or null with no GM)
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
  // A summons held by concentration loses its control. The card lists its creatures with the ids a Dismiss names, read before the GM's client applies what the spell's row says becomes of them (`deps.control`); Dismiss is the Judge's, and is not drawn for creatures that went.
  const found = (await deps.standing?.(record)) ?? {};
  const summons = [
    ...(found.tokens ?? []).map((t) => ({ name: String(t.name ?? t.actor?.name ?? ""), img: String(t.texture?.src || t.actor?.img || ""), tokenUuid: String(t.uuid ?? "") })),
    ...(found.held ?? []).map((h) => ({ name: String(h.name ?? ""), img: String(h.img ?? ""), held: { partyId: String(h.partyId ?? ""), actorId: String(h.actorId ?? "") } })),
  ];
  // With no GM connected `control` answers null and nothing is applied: the creatures stand, and the card draws no outcome of its own.
  const control = summons.length ? await deps.control?.({ casterUuid: record.casterUuid, castId: record.castId, cause }) : null;
  const outcome = control?.ok ? control.outcome : null;
  const flag = {
    cause,
    castId: record.castId,
    casterUuid: record.casterUuid,
    spellUuid: record.spellUuid,
    spellName: caster.spellName ?? "",
    casterName: caster.name ?? "",
    casterImg: caster.img ?? "",
    cite: caster.cite ?? "",
    ended: done.ended,
    retimed: done.retimed,
    open: done.open,
    ...(summons.length ? { summons } : {}),
    ...(outcome ? { outcome } : {}),
    caster: { actorUuid: caster.actorUuid, data: caster.data },
  };
  await deps.post(flag);
  return flag;
}

/* -------------------------------------------- */
/*  The card                                     */
/* -------------------------------------------- */

/** The attributes the card's buttons carry. Every Dismiss carries `DISMISS_ATTR`; the one for the whole cast also carries `data-all`. */
const END_ATTR = "data-acks-extras-held-end";
const RESTORE_ATTR = "data-acks-extras-held-restore";
const DISMISS_ATTR = "data-acks-extras-held-dismiss";

/** The card's template. */
const CARD_TEMPLATE = `modules/${MODULE_ID}/templates/magic/cast-held-card.hbs`;

/**
 * The line that says what became of the creatures when their control ended,
 * by outcome (`CONTROL_ENDS`): they are still on the map and the control is
 * lost, they went, or they turned hostile. An outcome that is none of these
 * draws no line.
 *
 * @param {string} [outcome="stays"]
 * @param {(key: string, data?: object) => string} loc  this card's strings, `ACKS-MAGIC.castHeld.<key>`
 * @returns {string}
 */
export function controlLostLine(outcome = "stays", loc) {
  return Object.hasOwn(CONTROL_ENDS, outcome) ? loc(`controlLost.${outcome}`) : "";
}

/**
 * What `templates/magic/cast-held-card.hbs` draws: every string localized, the
 * rows of each list, the creatures as buckets of one row each. It carries no
 * seat: End, Restore and Dismiss are all in it and the render hook trims them.
 *
 * @param {object} flag  the card's `castHeldEnd` flag
 * @param {(key: string, data?: object) => string} loc  this card's strings, `ACKS-MAGIC.castHeld.<key>`
 * @returns {object}
 */
export function heldEndView(flag, loc) {
  const cite = flag.cite ? ` (${flag.cite})` : "";
  const creatures = (flag.summons ?? []).map((c) => ({
    name: c.name,
    img: c.img ?? "",
    tokenUuid: c.tokenUuid ?? "",
    partyId: c.held?.partyId ?? "",
    memberId: c.held?.actorId ?? "",
    aria: loc("aria.dismiss", { name: c.name }),
    tip: loc("tip.dismiss", { name: c.name }),
  }));
  const lost = creatures.length ? controlLostLine(flag.outcome ?? "stays", loc) : "";
  // A creature that went has nothing left to dismiss, so no Dismiss is drawn for it.
  const dismissable = creatures.length > 0 && flag.outcome !== "gone";
  const sections = [];
  if (flag.ended?.length) sections.push({ legend: loc("ended"), rows: flag.ended.map((i) => ({ name: i.name })) });
  if (flag.retimed?.length) {
    sections.push({
      legend: loc("retimed"),
      rows: flag.retimed.map((i) => ({ name: i.name, figure: `${i.duration.value} ${i.duration.units}`, figureTip: loc("tip.retimed", { value: i.duration.value, units: i.duration.units, cite: flag.cite ?? "" }) })),
    });
  }
  if (flag.open?.length) sections.push({ legend: loc("open"), rows: flag.open.map((i) => ({ name: i.name, end: { actorUuid: i.actorUuid, id: i.id, label: loc("button.end") } })) });
  return {
    title: loc("title"),
    byline: loc("byline", { spell: flag.spellName, name: flag.casterName }),
    casterImg: flag.casterImg ?? "",
    cause: `${loc(`cause.${HELD_CAUSES.includes(flag.cause) ? flag.cause : "removed"}`)}${lost ? "" : cite}`,
    controlLost: lost ? `${lost}${cite}` : "",
    sections,
    creatures,
    dismissable,
    creaturesLegend: loc(flag.outcome === "gone" ? "summonsGone" : "summons"),
    dismissLabel: loc("button.dismiss"),
    dismissAllLabel: loc("button.dismissAll"),
    dismissAllAria: loc("aria.dismissAll"),
    dismissAllTip: loc("tip.dismissAll"),
    restoreLabel: loc("button.restore"),
    restoreTip: loc("tip.restore"),
  };
}

/**
 * The card's body, as a viewer with no rights sees it: the buttons are in it and
 * the render hook takes away the ones the seat may not press. Every figure
 * carries a tooltip naming where it came from.
 *
 * @param {object} flag  the card's `castHeldEnd` flag
 * @param {(key: string, data?: object) => string} loc  this card's strings, `ACKS-MAGIC.castHeld.<key>`
 * @returns {Promise<string>}
 */
export function heldEndContent(flag, loc) {
  return foundry.applications.handlebars.renderTemplate(CARD_TEMPLATE, heldEndView(flag, loc));
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
    content: await heldEndContent(flag, loc),
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
  // The creatures' control ends on the GM's client: applied here on a GM seat, relayed to the active GM from any other, and not applied with none connected.
  control: async (request) => {
    if (game.user.isGM) return (await import("./cast-control.mjs")).applyCastControl(request);
    if (!game.users.activeGM) return null;
    const { executeAsGM } = await import("../lib/sockets.mjs");
    return executeAsGM(HELD_END_HANDLER, { ...request, op: "control" });
  },
  standing: async (record) => {
    const caster = fromUuidSync(record.casterUuid);
    if (!caster) return { tokens: [], held: [] };
    const { castSummons } = await import("../lib/summons.mjs");
    return castSummons(caster, record.castId, { scenes: game.scenes });
  },
});

/**
 * The GM's client takes the records a seat could not write: checked, then ended
 * by the tail the spell gives, never the request's.
 * The same request with `op: "control"` asks the GM's client to end the cast's
 * creatures' control instead (`cast-control.mjs`), and answers its outcome.
 * With `op: "restore"` it puts back the records of the card `messageId` names
 * (`restoreFromCard`), taking nothing else from the request.
 * @param {object} payload  `{requestUserId, casterUuid, castId, cause, op?}`, or `{requestUserId, op: "restore", messageId}`
 * @returns {Promise<{ok: boolean, reason?: string, ended?: object[], retimed?: object[], open?: object[], restored?: number, refused?: number}>}
 */
export async function magicHeldEnd(payload = {}) {
  if (payload.op === "restore") return restoreFromCard(payload);
  const caster = payload.casterUuid ? fromUuidSync(payload.casterUuid) : null;
  const user = game.users.get(payload.requestUserId);
  const heldRemains = [...(caster?.effects ?? [])].some((e) => {
    const r = spellEffectOf(e);
    return r?.role === "caster" && r.held && r.castId === payload.castId;
  });
  const verdict = checkHeldEndRequest(payload, { caster, ownsCaster: !user || user.isGM || caster?.testUserPermission?.(user, "OWNER") === true, heldRemains });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  // The creatures' control: the outcome is the spell's row's, read here from the creatures' own records, and nothing in the request names it.
  if (payload.op === "control") return (await import("./cast-control.mjs")).applyCastControl({ casterUuid: payload.casterUuid, castId: payload.castId });
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
    img: effect.parent?.img ?? "",
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

/** Write a restore plan's records back and undo its re-timings, answering how many records it wrote. A record already on its actor is left as it is. */
async function applyRestore(plan) {
  let written = 0;
  for (const { actorUuid, data } of plan.create) {
    const actor = await fromUuid(actorUuid);
    if (!actor?.effects || actor.effects.has(data._id)) continue;
    const first = data.statuses?.[0];
    const restored = first ? restoredAs(data, await statusEffectData(first)) : data;
    await actor.createEmbeddedDocuments("ActiveEffect", [restored], { keepId: true });
    written++;
  }
  for (const { actorUuid, id, was } of plan.undo) {
    const effect = (await fromUuid(actorUuid))?.effects?.get(id);
    if (!effect) continue;
    const path = `flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}`;
    await effect.update({ [`${path}.startTime`]: was.startTime, ...(was.duration ? { [`${path}.duration`]: was.duration } : { [`${path}.duration`]: unset() }) });
    written++;
  }
  return written;
}

/** The card's stamp that it was restored, and by whom. */
const restoredStamp = (name) => ({ [`flags.${MODULE_ID}.${CAST_HELD_END_FLAG}.restored`]: { by: name } });

/**
 * The GM's client puts back a card's records for a seat that could not write
 * them itself. The caster and the records come from the stored card; the request
 * names only the card. The requester must own the caster (`checkRestoreRequest`),
 * and when the card was not authored by a GM it writes only the actors the
 * requester owns, so a seat's card cannot put a record on a character the seat
 * does not own. The card is stamped restored only when nothing was refused, so
 * a GM seat, which may write every actor, can press Restore again.
 *
 * @param {{requestUserId?: string, messageId?: string}} payload
 * @returns {Promise<{ok: true, restored: number, refused: number}|{ok: false, reason: string}>}
 */
async function restoreFromCard(payload) {
  const message = payload.messageId ? game.messages?.get(payload.messageId) : null;
  const flag = message?.flags?.[MODULE_ID]?.[CAST_HELD_END_FLAG];
  const sender = payload.requestUserId ? game.users.get(payload.requestUserId) : null;
  const gm = !payload.requestUserId || sender?.isGM === true;
  const owns = (doc) => gm || (Boolean(sender) && doc?.testUserPermission?.(sender, "OWNER") === true);
  const caster = flag?.casterUuid ? fromUuidSync(flag.casterUuid) : null;
  const verdict = checkRestoreRequest(payload, { flag, ownsCaster: owns(caster) });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  const authored = message.author?.isGM === true;
  const split = restoreSplit(restorePlan(flag), (actorUuid) => authored || owns(fromUuidSync(actorUuid)));
  const restored = await applyRestore(split.plan);
  if (!split.refused) await message.update(restoredStamp(sender?.name ?? game.user.name));
  return { ok: true, restored, refused: split.refused };
}

/**
 * Restore press, for an owner of the caster. Puts back every record the card
 * lists and undoes its re-timings: written here when this seat owns the card and
 * every actor the plan touches, else asked of the GM's client (`magicHeldEnd`,
 * `op: "restore"`), which writes what the seat owns and answers what it left. A
 * partial answer is told to the presser.
 *
 * @param {object} message  the card's chat message
 */
export async function pressRestore(message) {
  const flag = message.flags?.[MODULE_ID]?.[CAST_HELD_END_FLAG];
  if (!flag || flag.restored) return;
  const plan = restorePlan(flag);
  const direct = message.isOwner === true && [...plan.create, ...plan.undo].every((p) => fromUuidSync(p.actorUuid)?.isOwner === true);
  if (direct) {
    await applyRestore(plan);
    await message.update(restoredStamp(game.user.name));
    return;
  }
  const { executeAsGM } = await import("../lib/sockets.mjs");
  const answer = await executeAsGM(HELD_END_HANDLER, { op: "restore", messageId: message.id });
  if (answer?.ok && answer.refused > 0) ui.notifications.warn(loc("notice.restorePartial", { done: answer.restored, left: answer.refused }));
}

/** An End press: one listed record deleted by id. */
async function pressEnd(button) {
  const actor = await fromUuid(button.dataset.actorUuid);
  const id = button.dataset.recordId;
  if (actor?.effects?.has(id)) await actor.deleteEmbeddedDocuments("ActiveEffect", [id]);
  button.disabled = true;
}

/**
 * A Dismiss press, through lib's confirmed dismissal: one creature when the
 * button names it (a token by uuid, a held summon by party and member), else
 * every creature of the cast on every scene and in a party token. Either way
 * the dismissal is of this cast alone, and lib's door decides who may remove.
 *
 * @param {object} flag  the card's `castHeld` flag
 * @param {object} dataset  the pressed button's `data-*`
 * @param {object} [deps]  `caster`, `promptDismiss`, `castSummons`: lib's, unless a test hands its own
 * @returns {Promise<{ok: boolean}|null>} the dismissal's answer, null when the caster is gone
 */
export async function pressDismiss(flag, dataset, deps = {}) {
  const caster = deps.caster ?? fromUuidSync(flag.casterUuid);
  if (!caster) return null;
  const lib = deps.promptDismiss && deps.castSummons ? deps : await import("../lib/summons.mjs");
  if (dataset.all) return lib.promptDismiss(caster, { ...lib.castSummons(caster, flag.castId, { scenes: game.scenes }), castId: flag.castId });
  const entry = dataset.tokenUuid ? { tokenUuid: dataset.tokenUuid } : { held: { partyId: dataset.partyId, actorId: dataset.memberId } };
  return lib.promptDismiss(caster, { entries: [entry], castId: flag.castId });
}

/**
 * Wire a card's buttons for this seat: Restore for an owner of the caster, on
 * every outcome since it touches no creature; Dismiss for an owner of the
 * caster, except on a card whose creatures turned hostile, where only a GM seat
 * keeps it (RR ch. 5); End for the record's owners. Dismiss is display only:
 * lib's dismissal decides who may remove. A seat that keeps no button loses the
 * footer that held them, whitespace defeating `:empty`.
 *
 * @param {object} message  the chat message
 * @param {HTMLElement} html  its rendered body
 */
export function bindCard(message, html) {
  const flag = message?.flags?.[MODULE_ID]?.[CAST_HELD_END_FLAG];
  if (!flag || !html?.querySelectorAll) return;
  const owner = fromUuidSync(flag.casterUuid)?.isOwner === true;
  const mayDismiss = owner && (flag.outcome !== "hostile" || game.user.isGM === true);
  for (const button of html.querySelectorAll(`[${DISMISS_ATTR}]`)) {
    if (!mayDismiss) button.remove();
    else {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        pressDismiss(flag, button.dataset)
          .then((answer) => {
            if (answer?.ok !== true) return;
            const rows = button.dataset.all ? (button.closest?.(".acks-extras-cast-held")?.querySelectorAll(`[${DISMISS_ATTR}]`) ?? []) : [button];
            for (const each of rows) each.disabled = true;
          })
          .catch((err) => console.error(`${MODULE_ID} | dismiss failed`, err));
      });
    }
  }
  for (const button of html.querySelectorAll(`[${RESTORE_ATTR}]`)) {
    if (!owner) button.remove();
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
    if (fromUuidSync(button.dataset.actorUuid)?.isOwner !== true) button.remove();
    else {
      button.addEventListener("click", (event) => {
        event.preventDefault();
        pressEnd(button).catch((err) => console.error(`${MODULE_ID} | end failed`, err));
      });
    }
  }
  const foot = html.querySelector?.(".acks-extras-cast-held__foot");
  if (foot && !foot.children?.length) foot.remove();
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
