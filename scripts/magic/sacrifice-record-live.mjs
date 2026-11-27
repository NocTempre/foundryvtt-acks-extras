/* global game, fromUuidSync, Hooks */
/**
 * The open blood sacrifice's shared record as the live world has it (`sacrifice-record.mjs` is the model): the
 * flag `flags["acks-extras"].magic.sacrifice` on the caster, the one write path every seat takes, the GM's
 * half of it, the redraw of every open window when it changes, and the casting strip's Sacrifice button.
 *
 * The flag is `{site, power, list}` (`cleanRecord`) and exists only while a sacrifice is open: the facts an
 * owner set and the dropped victims are stored on the caster so every seat's window draws the same thing. Only the
 * GM's client writes it. A GM's own seat runs the same handler an owning Player's relayed request reaches, so one
 * function decides who may change what, from the sender Foundry attested (`judgeDeclares`) and an owner of the
 * caster, never from a claim in the payload and never from a check made on the asking seat. Foundry itself lets an
 * owner update a flag of their own actor directly; nothing on a client can stop a hand-made call, which is why
 * this module's seats write only through here and the window draws a seat's checks as text where it cannot edit.
 *
 * Every window the module has open for a caster is registered here (`openWindows`), so the update hook can redraw
 * it without importing the window.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_MAGIC, FLAG_SACRIFICE, SACRIFICE_HANDLER } from "./constants.mjs";
import { OP, REFUSED, cleanRecord, isOpen, applyOp, checkRecordRequest, touchesRecord, openerVisible } from "./sacrifice-record.mjs";
import { unset } from "../lib/util.mjs";
import { actorAlignment } from "../lib/actor-read.mjs";
import { classForActor } from "../classes/registry.mjs";
import { foldKey } from "./spell-logic.mjs";

/** A string of the sacrifice's lang group. */
export const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.sacrifice.${key}`, data ?? {});

/** A document of a uuid that resolves now, else null; a uuid into an unloaded pack throws. */
export function resolve(uuid) {
  try {
    return uuid ? fromUuidSync(uuid) : null;
  } catch {
    return null;
  }
}

/** The creature a document is: an actor, or the actor of a token. Null for anything else. */
export const creatureOf = (doc) => (doc?.documentName === "Token" ? doc.actor ?? null : doc?.documentName === "Actor" ? doc : null);

/** The windows open now, by the caster's uuid. */
export const openWindows = new Map();

/** The record's flag path on a caster. */
const PATH = `flags.${MODULE_ID}.${FLAG_MAGIC}.${FLAG_SACRIFICE}`;

/** The caster's stored record as the flag holds it, undefined where none is open. */
export const storedRecord = (actor) => actor?.flags?.[MODULE_ID]?.[FLAG_MAGIC]?.[FLAG_SACRIFICE];

/** The caster's record, cleaned; an empty one where none is open. */
export const readRecord = (actor) => cleanRecord(storedRecord(actor));

/** Whether a casting tradition of the actor's class is of the given kind (`divine` or `arcane`), by the tradition's own key. */
export const castsKind = (actor, kind) => (classForActor(actor)?.system?.casting ?? []).some((t) => foldKey(t?.key) === kind);

/** Whether a casting tradition of the actor's class is divine. */
export const castsDivine = (actor) => castsKind(actor, "divine");

/**
 * The GM's client writes the record: it checks who sent the request (a GM, or an owner of the caster), applies the op
 * to the freshest flag and writes the result. A GM's own request reaches this function directly. A drop is checked against what this client
 * reads, a creature that is not the caster and not already held, and never what the payload says.
 * @param {{casterUuid?: string, op?: object, requestUserId?: string|null}} payload
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function recordHandler(payload = {}) {
  const { judgeDeclares } = await import("../lib/sockets.mjs");
  const actor = creatureOf(resolve(payload.casterUuid));
  const fromJudge = judgeDeclares(payload.requestUserId);
  const user = game.users.get(payload.requestUserId);
  const op = payload.op;
  const stored = storedRecord(actor);
  let resolved = null;
  if (op?.op === OP.add) {
    const creature = creatureOf(resolve(op.uuid));
    const held = cleanRecord(stored).list.some((v) => creatureOf(resolve(v.uuid))?.uuid === creature?.uuid && Boolean(creature));
    resolved = { creature: Boolean(creature), held, self: Boolean(creature) && creature.uuid === actor?.uuid };
  }
  const verdict = checkRecordRequest({ casterUuid: actor?.uuid, op }, { caster: actor, fromJudge, owns: fromJudge || actor?.testUserPermission?.(user, "OWNER") === true, resolved });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  const next = applyOp(stored, op);
  if (next === null) {
    if (isOpen(stored)) await actor.update({ [PATH]: unset() });
  } else if (JSON.stringify(next) !== JSON.stringify(isOpen(stored) ? cleanRecord(stored) : null)) {
    await actor.update({ [PATH]: next });
  }
  return { ok: true };
}

/**
 * Write the record: a GM's own seat runs the handler here, and any other seat asks the GM's client, which refuses
 * what its attested sender may not do. A request nobody answered is `{ok: false, reason: "noGm"}`.
 * @param {Actor} actor the caster
 * @param {{op: string}} op one of `OP`
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function writeRecord(actor, op) {
  const payload = { casterUuid: actor.uuid, op };
  if (game.user.isGM) return recordHandler(payload);
  if (!game.users.activeGM) return { ok: false, reason: "noGm" };
  const { executeAsGM } = await import("../lib/sockets.mjs");
  const answer = await executeAsGM(SACRIFICE_HANDLER, payload);
  return answer ?? { ok: false, reason: "noGm" };
}

/** End the open sacrifice: its victims and site go, the class-power mark stays. Nothing is written where none is open. */
export async function clearRecord(actor) {
  if (!isOpen(storedRecord(actor))) return { ok: true, noop: true };
  return writeRecord(actor, { op: OP.clear });
}

/** Tell the user why a write to the record was refused, in the sacrifice's own words. */
export const refusal = (reason) => loc(`refused.${Object.values(REFUSED).includes(reason) || reason === "noGm" ? reason : "failed"}`);

/** The hook that draws every open window for a caster again when the record changed under it. */
export function onActorUpdate(actor, changes) {
  if (!touchesRecord(changes)) return;
  void openWindows.get(actor?.uuid)?.render();
}

let hooked = false;

/** Register the record's update hook, once, at `init`. */
export function registerRecordHook() {
  if (hooked) return;
  hooked = true;
  Hooks.on("updateActor", onActorUpdate);
}

/**
 * Open the Blood sacrifice window for a caster; one window per caster. The window's file is read on first use.
 * @param {Actor} actor
 */
export async function openSacrifice(actor) {
  const { SacrificeWindow } = await import("./apps/sacrifice-window.mjs");
  return SacrificeWindow.open(actor);
}

/**
 * What each power panel of the casting strip draws for a caster's Sacrifice button, or null where this seat sees none: a Judge's seat on
 * every caster the strip draws for (`casts`), a Player's on a divine caster who is chaotic or one a Judge marked as holding the class power
 * (`openerVisible`). `tip` is the tooltip, and the button's name as well.
 * @returns {{label: string, tip: string}|null}
 */
export function openerFor(actor, casts = false) {
  const facts = { judge: game.user.isGM === true, casts, divine: castsDivine(actor), alignment: actorAlignment(actor), power: readRecord(actor).power };
  if (!openerVisible(facts)) return null;
  return { label: loc("open"), tip: loc("openTip", { name: actor.name, cite: loc("cite.sacrifice") }) };
}
