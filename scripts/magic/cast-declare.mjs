/* global game, ui, Hooks, Roll, fromUuid, fromUuidSync */
/**
 * The declaration. In a begun fight a spell is declared before it is cast, at
 * any moment but the caster's own turn (`cast-moment.mjs`), and the spell is
 * cast when that turn comes. The declaration spends the tradition's slot once,
 * at its confirm, writes a status-only `casting` record (lib's condition: it
 * ends at the caster's turn and is lost to damage and a failed save) and a
 * status-free pending record naming the spell, the answers the seat gave and the
 * fight (its id, the round it lapses in and the round the cast was declared in),
 * and posts no card. The pending record alone is the declaration; core's
 * combatant flag `acks.prepareSpell`, the tracker's own Casting toggle, follows
 * it, written by the GM's client because a Player cannot update a combatant. With
 * no GM connected the flag is left alone and nothing depends on it.
 *
 * A declaration is lost when the states `casting` stands for are lost
 * (`STATES_LOST_HOOK`): the pending record is stamped `lost` and the flag
 * cleared. It lapses when the caster's own turn that follows the declaration
 * ends with it unresolved, and when the fight is deleted; the spend stands. Core
 * resets initiative each round and lib lifts `casting` at the turn without a
 * hook, so a record that waited longer could no longer be lost and would resolve
 * unspent.
 *
 * An item the answer's buckets name that leaves its holder before the cast uses
 * it (deleted, or its stack emptied) is struck from every pending record's
 * answer (`stripLostItem`), on the client that made the change; a record that
 * client cannot write is struck by the GM's client, which checks the item is gone.
 *
 * See docs/magic/DECISIONS.md, "A declaration spends at its confirm and lapses
 * with the caster's next turn".
 */
import { MODULE_ID, FLAG_SPELL, FLAG_SPELL_EFFECT, DECLARE_FLAG_HANDLER, LOST_ITEM_HANDLER } from "./constants.mjs";
import { spellEffectData, spellEffectOf, newCastId } from "./spell-effect.mjs";
import { invocationFigure } from "./cast-level.mjs";
import { storedProcedure, runLost, withoutUuid } from "./cast-procedure.mjs";
import { traditionFor } from "./cast-capacity.mjs";
import { STATES_LOST_HOOK } from "../lib/constants.mjs";
import { hasStock } from "../lib/item-model.mjs";
import { isPrimaryGM } from "../lib/util.mjs";

/** The status the declaration puts on the caster. */
const CASTING = "casting";

/** A summoning's pick as a declaration stores it: the creature's ref and a whole count of one or more (a count that is none reads one); null with no ref. */
function storedSummon(v) {
  const ref = typeof v?.ref === "string" ? v.ref.trim() : "";
  if (!ref) return null;
  const count = Number(v.count);
  return { ref, count: Number.isInteger(count) && count >= 1 ? count : 1 };
}

/**
 * What a declaration stores of the seat's answer, one normalizer per field. This
 * table IS the stored shape: a declared field is added here and nowhere else, and
 * `answerStored` writes it into the pending record and `answerFromPending` reads
 * it back as the dialog's answer. `targets` are the token uuids the seat had
 * targeted at its answer, `allocation` the throw split by row key and token uuid,
 * `items` the weapon of each holder by token uuid, `invocationLevel` the whole
 * invocation level chosen (null where none was), `procedure` the answer of the
 * tradition's procedure (its field values, its band's controls and its `buckets`;
 * null where it has none) and `procedureKind` the tradition kind whose procedure
 * it is, which the declaration's loss reads to find that procedure again,
 * `tradition` the key of the class's tradition the cast was pressed under (null
 * where it named none, as a record stored before it did), which resolving the
 * declaration reads the world through again, and `summon` a summoning's pick, `{ref, count}` (the creature as `placeSummons`
 * reads it and how many; null where the cast summons nothing).
 */
export const ANSWER_FIELDS = Object.freeze({
  mode: (v) => v,
  picks: (v) => v ?? {},
  casterLevel: (v) => v ?? null,
  invocationLevel: invocationFigure,
  procedure: storedProcedure,
  procedureKind: (v) => (typeof v === "string" && v ? v : null),
  tradition: (v) => (typeof v === "string" && v ? v : null),
  situational: (v) => v ?? null,
  visibility: (v) => v ?? "public",
  pickKind: (v) => v ?? null,
  items: (v) => v ?? {},
  saveMod: (v) => v === true,
  targets: (v) => (Array.isArray(v) ? [...v] : []),
  allocation: (v) => v ?? {},
  summon: storedSummon,
});

/**
 * The fields of a seat's answer a declaration stores. Pure.
 * @param {object} answer  `ANSWER_FIELDS`' keys, as the dialog answered them, with `targets` the uuids of the seat's tokens
 * @returns {object}
 */
export const answerStored = (answer) => Object.fromEntries(Object.entries(ANSWER_FIELDS).map(([key, normalize]) => [key, normalize(answer?.[key])]));

/**
 * A stored declaration read back as the answer the cast and the dialog take: the
 * stored fields, with a blank level and figure as the dialog holds them (empty
 * strings). A record written before targets were stored has `targets:
 * null`, and its cast reads the seat's targets as they stand. Pure.
 *
 * @param {object} pending  a pending record's `pending`
 * @returns {object}
 */
export function answerFromPending(pending) {
  const stored = answerStored(pending);
  return {
    ...stored,
    casterLevel: stored.casterLevel ?? "",
    situational: stored.situational ?? "",
    procedure: stored.procedure ?? {},
    visibility: pending?.visibility || "public",
    targets: Array.isArray(pending?.targets) ? stored.targets : null,
  };
}

/**
 * The round whose turn of the caster's ends the declaration. A declaration made
 * before the caster's initiative is rolled, or while the caster's turn is still
 * to come this round, lapses at that turn of this round; one made after it has
 * passed lapses at next round's. Pure.
 *
 * @param {{round: number, turn: number, casterTurn: number, rolled: boolean}} at  the fight's round and current turn, the caster's place in the turn order, and whether its initiative is rolled
 * @returns {number}
 */
export function lapseRound({ round, turn, casterTurn, rolled }) {
  if (!rolled) return round;
  return casterTurn > turn ? round : round + 1;
}

/**
 * Did a change of the tracker end a turn? A turn ends when the round advances or
 * when the tracker moves forward to another combatant. The same combatant's place
 * in the order moving, a combatant ahead of or level with the current turn
 * taking it over and a move backward are the tracker re-sorting after an
 * initiative roll or the Judge stepping back, and end nothing. Pure.
 *
 * @param {{round: number, turn: number, combatantId?: string}} prior
 * @param {{round: number, turn: number, combatantId?: string}} current
 */
export function turnEnded(prior, current) {
  if (!prior || !current) return false;
  if (current.round > prior.round) return true;
  return current.round === prior.round && current.turn > prior.turn && current.combatantId !== prior.combatantId;
}

/**
 * The records a turn that has just ended makes stale: this caster's pending
 * declarations in this fight whose lapse round the ended turn has reached,
 * whether lost or not. Pure.
 *
 * @param {Array<{pending?: {combatId: string, round: number}}>} records  the caster's records, as `spellEffectOf` reads them
 * @param {{combatId: string, round: number}} ended  the fight and the round of the caster's turn that ended
 */
export function staleDeclarations(records, { combatId, round }) {
  return (records ?? []).filter((r) => r?.pending && r.pending.combatId === combatId && Number(round) >= Number(r.pending.round));
}

/**
 * Is a relayed request to set or clear a combatant's `prepareSpell` flag good?
 * The requester must own the combatant's actor, and to set it a pending
 * declaration of that actor that names the fight must stand unlost. Pure.
 *
 * @param {{requestUserId?: string|null, value?: boolean}} req
 * @param {{combatant: object|null, ownsActor: boolean, declared: boolean}} world
 * @returns {{ok: true}|{refused: string}}
 */
export function checkDeclareFlagRequest(req, world) {
  if (!world?.combatant) return { refused: "noCombatant" };
  if (req.requestUserId && !world.ownsActor) return { refused: "notOwner" };
  if (req.value === true && !world.declared) return { refused: "noDeclaration" };
  return { ok: true };
}

/** The ids of every record of the declarations the given ones name (the pending record and its `casting` record carry one cast id). */
function recordsOf(entries, pendings) {
  const ids = new Set(pendings.map((r) => r.castId));
  return entries.filter(({ record }) => ids.has(record.castId)).map(({ id }) => id);
}

/**
 * Declare a cast: replace this caster's earlier declaration in the fight (a
 * Judge's second one; a Player's is blocked before it gets here), write the
 * `casting` record and the pending record, and set the combatant's flag. The
 * spend and the end of the caster's concentration have been made by the cast.
 *
 * @param {object} from
 * @param {object} from.caster  the actor
 * @param {{uuid: string, name: string, img?: string}} from.spell
 * @param {object} from.answer  what the dialog was answered, with the seat's target uuids as `targets` (the fields `ANSWER_FIELDS` names)
 * @param {{id: string, round: number, turn: number, turns: Array<{id: string}>}} from.combat
 * @param {{id: string, initiative?: number|null}} from.combatant  the caster's
 * @param {object} from.deps  `castId()`, `now()`, `entries(actor)` (`[{id, record}]`), `remove(actor, ids)`, `create(actor, datas)`, `setFlag({combat, combatant, caster, value})`, `notify(level, key, data)`
 * @returns {Promise<{castId: string, round: number}>}
 */
export async function declareCast({ caster, spell, answer, combat, combatant, deps }) {
  const earlier = deps.entries(caster).filter(({ record }) => record.pending?.combatId === combat.id);
  if (earlier.length) await deps.remove(caster, recordsOf(deps.entries(caster), earlier.map((e) => e.record)));
  const castId = deps.castId();
  const now = deps.now();
  const round = lapseRound({ round: combat.round, turn: combat.turn, casterTurn: (combat.turns ?? []).findIndex((t) => t.id === combatant.id), rolled: combatant.initiative != null });
  const base = { spell: { uuid: spell.uuid, name: spell.name, img: spell.img }, caster: { uuid: caster.uuid }, castId, role: "caster" };
  const pending = {
    spellUuid: spell.uuid,
    ...answerStored(answer),
    combatId: combat.id,
    round,
    declaredRound: combat.round,
    at: now,
  };
  await deps.create(caster, [spellEffectData({ ...base, statuses: [CASTING] }), spellEffectData({ ...base, pending })]);
  await deps.setFlag({ combat, combatant, caster, value: true });
  deps.notify("info", "declared", { name: caster.name, spell: spell.name });
  return { castId, round };
}

/**
 * End a declaration that has been resolved or has lapsed: the flag first, while
 * the pending record that authorizes clearing it stands, then both records.
 * @param {object} from
 * @param {object} from.caster
 * @param {object} from.record  the declaration's pending record, as `spellEffectOf` reads it
 * @param {object} [from.combat]
 * @param {object} [from.combatant]
 * @param {object} from.deps  `entries`, `remove`, `setFlag`
 */
export async function endDeclaration({ caster, record, combat, combatant, deps }) {
  if (combat && combatant) await deps.setFlag({ combat, combatant, caster, value: false });
  await deps.remove(caster, recordsOf(deps.entries(caster), [record]));
}

/**
 * The states `casting` stands for were lost: every pending declaration of the
 * actor is stamped lost, and its combatant's flag cleared.
 *
 * @param {object} actor
 * @param {string[]} ids  the status ids lost
 * @param {string} cause  the loss's cause
 * @param {object} deps  `entries(actor)`, `now()`, `stamp(actor, effectId, lost)`, `findFight(combatId)` (`{combat, combatant}` or null), `setFlag`
 * @returns {Promise<object[]>} the declarations that were stamped, as `spellEffectOf` read them
 */
export async function onStatesLost(actor, ids, cause, deps) {
  if (!Array.isArray(ids) || !ids.includes(CASTING)) return [];
  const stamped = [];
  for (const { id, record } of deps.entries(actor)) {
    if (!record.pending || record.pending.lost) continue;
    await deps.stamp(actor, id, { cause, at: deps.now() });
    const fight = deps.findFight(record.pending.combatId);
    if (fight) await deps.setFlag({ ...fight, caster: actor, value: false });
    stamped.push(record);
  }
  return stamped;
}

/* -------------------------------------------- */
/*  A lost item leaves the answers that name it  */
/* -------------------------------------------- */

/**
 * The stored answers a lost item is struck from: of the records given, each
 * whose pending answer's buckets name the uuid, with its buckets as they stand
 * without it. Pure.
 *
 * @param {string} uuid  the item that left its holder's inventory
 * @param {Array<{id: string, record: {pending?: {procedure?: object}}}>} records  the declarations' records, as `spellEffectOf` reads them, each with the id (and whatever else the caller keeps) of its document
 * @returns {Array<{id: string, record: object, buckets: Record<string, object[]>}>}
 */
export function lostItemPlan(uuid, records) {
  const plan = [];
  for (const entry of records ?? []) {
    const found = withoutUuid(entry.record?.pending?.procedure, uuid);
    if (found.changed) plan.push({ ...entry, buckets: found.buckets });
  }
  return plan;
}

/**
 * Is a relayed strip good? The GM's client acts on the fact the item left its
 * holder, never on who asks. Pure.
 *
 * @param {{itemUuid?: string}} req
 * @param {{gone: boolean}} world  whether the item no longer stands in an inventory
 * @returns {{ok: true}|{refused: "noItem"|"present"}}
 */
export function checkLostItemRequest(req, world) {
  if (!req?.itemUuid) return { refused: "noItem" };
  if (!world?.gone) return { refused: "present" };
  return { ok: true };
}

/**
 * Strike a lost item from every declaration's stored answer that names it, on
 * this client. A record this client may write is written; the rest are asked of
 * the GM's client once, which re-reads the world and writes them. Idempotent: a
 * uuid no answer names writes nothing, and a second run finds nothing to do.
 *
 * @param {string} uuid
 * @param {object} deps  `records()` (`[{id, record, ...}]`), `canWrite(step)`, `write(step)` and `relay({itemUuid})` (answers null with no GM to ask)
 * @returns {Promise<{written: string[], relayed: string[], failed: string[]}>} the record ids
 */
export async function stripLostItem(uuid, deps) {
  const done = { written: [], relayed: [], failed: [] };
  const asked = [];
  for (const step of lostItemPlan(uuid, await deps.records())) {
    if (!deps.canWrite(step)) {
      asked.push(step.id);
      continue;
    }
    try {
      await deps.write(step);
      done.written.push(step.id);
    } catch (err) {
      console.error(`${MODULE_ID} | a lost item could not be struck from a declared answer`, err);
      done.failed.push(step.id);
    }
  }
  if (asked.length && deps.relay && (await deps.relay({ itemUuid: uuid }))) done.relayed = asked;
  return done;
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** The records of an actor that this module's casts wrote, with their ids. */
const liveEntries = (actor) =>
  [...(actor?.effects ?? [])].map((e) => ({ id: e.id, record: spellEffectOf(e) })).filter((e) => e.record);

/** The combat and the actor's combatant in it, by the fight's id. */
function findFight(combatId, actor) {
  const combat = game.combats?.get(combatId);
  const combatant = combat?.combatants?.find((c) => c.actor === actor || c.actor?.uuid === actor?.uuid) ?? null;
  return combat && combatant ? { combat, combatant } : null;
}

/** Whether a GM's client is there to set a flag a Player cannot. */
const gmConnected = () => game.user.isGM || Boolean(game.users.activeGM);

/**
 * Set or clear a combatant's `prepareSpell` from this client: written directly
 * by a GM, asked of the GM's client by anyone else, and left alone with no GM.
 */
async function setPrepareSpell({ combat, combatant, value }) {
  if (game.user.isGM) {
    if (combatant.getFlag("acks", "prepareSpell") !== value) await combatant.setFlag("acks", "prepareSpell", value);
    return;
  }
  if (!gmConnected()) return;
  const { executeAsGM } = await import("../lib/sockets.mjs");
  await executeAsGM(DECLARE_FLAG_HANDLER, { combatId: combat.id, combatantId: combatant.id, value });
}

/** The GM's client sets or clears the flag a seat asked for, after the request checks out. */
async function declareFlagHandler(payload = {}) {
  const combat = game.combats?.get(payload.combatId);
  const combatant = combat?.combatants?.get(payload.combatantId) ?? null;
  const actor = combatant?.actor ?? null;
  const user = game.users.get(payload.requestUserId);
  const verdict = checkDeclareFlagRequest(payload, {
    combatant,
    ownsActor: !user || user.isGM || actor?.testUserPermission?.(user, "OWNER") === true,
    declared: liveEntries(actor).some(({ record }) => record.pending?.combatId === payload.combatId && !record.pending.lost),
  });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  await combatant.setFlag("acks", "prepareSpell", payload.value === true);
  return { ok: true };
}

/** The dependencies of a declaration written from this client. */
export const liveDeclareDeps = () => ({
  castId: () => newCastId(),
  now: () => game.time.worldTime,
  entries: liveEntries,
  remove: async (actor, ids) => {
    const here = ids.filter((id) => actor.effects.has(id));
    if (here.length) await actor.deleteEmbeddedDocuments("ActiveEffect", here);
  },
  create: async (actor, datas) => actor.createEmbeddedDocuments("ActiveEffect", datas),
  stamp: async (actor, id, lost) => actor.effects.get(id)?.update({ [`flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}.pending.lost`]: lost }),
  findFight: null,
  setFlag: ({ combat, combatant, value }) => setPrepareSpell({ combat, combatant, value }),
  notify: (level, key, data) => ui.notifications?.[level]?.(game.i18n.format(`ACKS-MAGIC.cast.notice.${key}`, data ?? {})),
});

/** A lost declaration's tradition procedure is told, once for the cast, on the client that saw the loss. */
async function procedureLost(actor, record) {
  const spell = fromUuidSync(record.pending.spellUuid);
  if (!record.pending.procedureKind || !spell) return;
  const { classForActor } = await import("../classes/registry.mjs");
  const classItem = classForActor(actor) ?? null;
  const tradition = traditionFor(classItem?.system?.casting, { extras: spell.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {}, lvl: spell.system?.lvl, class: spell.system?.class })?.tradition ?? null;
  await runLost(record, {
    actor,
    spell,
    tradition,
    classItem,
    combat: game.combats?.get(record.pending.combatId) ?? null,
    now: () => game.time.worldTime,
    roll: (formula) => new Roll(formula).evaluateSync().total,
  });
}

/** Lib's states-lost hook: a lost `casting` loses the declaration. */
function onLost(actor, ids, cause) {
  const deps = { ...liveDeclareDeps(), findFight: (combatId) => findFight(combatId, actor) };
  onStatesLost(actor, ids, cause, deps)
    .then(async (lost) => {
      for (const record of lost) deps.notify("info", "declarationLost", { name: actor.name, spell: fromUuidSync(record.pending.spellUuid)?.name ?? "" });
      for (const record of lost) await procedureLost(actor, record);
    })
    .catch((err) => console.error(`${MODULE_ID} | a lost declaration could not be recorded`, err));
}

/** A turn ended: the caster's own turn that follows a declaration takes it unresolved. */
async function onTurnChange(combat, prior, current) {
  if (!isPrimaryGM()) return;
  const combatant = combat.combatants.get(prior?.combatantId);
  const actor = combatant?.actor;
  // The tracker re-sorting after an initiative roll is no turn; core may already have reset the initiatives of a round that is opening.
  if (!actor || !turnEnded(prior, current)) return;
  const deps = liveDeclareDeps();
  for (const record of staleDeclarations(deps.entries(actor).map((e) => e.record), { combatId: combat.id, round: prior.round })) {
    const spell = fromUuidSync(record.pending.spellUuid);
    await endDeclaration({ caster: actor, record, combat, combatant, deps });
    deps.notify("info", "declarationStale", { name: actor.name, spell: spell?.name ?? "" });
  }
}

/** A fight was deleted: every declaration made in it ends. */
async function onDeleteCombat(combat) {
  if (!isPrimaryGM()) return;
  const deps = liveDeclareDeps();
  for (const combatant of combat.combatants) {
    const actor = combatant.actor;
    for (const record of staleDeclarations(deps.entries(actor).map((e) => e.record), { combatId: combat.id, round: Infinity })) {
      await endDeclaration({ caster: actor, record, deps });
    }
  }
}

/** Every declaration record of the world, with its document: the world's actors, and each unlinked token's. */
async function liveDeclarations() {
  const { worldActors } = await import("../lib/repair.mjs");
  return worldActors().flatMap((actor) => liveEntries(actor).filter(({ record }) => record.pending).map(({ id, record }) => ({ id, record, effect: actor.effects.get(id) })));
}

/** The dependencies of a strip run from this client: a record is written where Foundry lets this user write it, and asked of the GM's client where not. */
const liveStripDeps = () => ({
  records: liveDeclarations,
  canWrite: ({ effect }) => effect?.canUserModify?.(game.user, "update") === true,
  write: ({ effect, buckets }) => effect.update({ [`flags.${MODULE_ID}.${FLAG_SPELL_EFFECT}.pending.procedure.buckets`]: buckets }),
  relay: async (request) => {
    if (game.user.isGM || !game.users.activeGM) return null;
    const { executeAsGM } = await import("../lib/sockets.mjs");
    return executeAsGM(LOST_ITEM_HANDLER, request);
  },
});

/** Does the world no longer hold this item in an inventory: gone, or a stack with nothing left? */
function itemGone(uuid) {
  let item = null;
  try {
    item = fromUuidSync(uuid);
  } catch {
    item = null;
  }
  return !item || !hasStock(item);
}

/** The GM's client strips a lost item from the answers a seat could not write, after it checks the item is gone. */
async function lostItemHandler(payload = {}) {
  const verdict = checkLostItemRequest(payload, { gone: itemGone(payload.itemUuid) });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  return { ok: true, ...(await stripLostItem(payload.itemUuid, { ...liveStripDeps(), canWrite: () => true, relay: null })) };
}

/** An item left its holder's inventory on this client's own write: it leaves the cast. */
function onItemLeft(item, userId) {
  if (userId !== game.user?.id || !item?.uuid) return;
  stripLostItem(item.uuid, liveStripDeps()).catch((err) => console.error(`${MODULE_ID} | a lost item could not leave the declared answers`, err));
}

let registered = false;

/** Register the declaration's hooks and its flag handler. Once, at `init`. */
export function registerCastDeclare() {
  if (registered) return;
  registered = true;
  Hooks.on(STATES_LOST_HOOK, onLost);
  Hooks.on("combatTurnChange", (combat, prior, current) => onTurnChange(combat, prior, current).catch((err) => console.error(`${MODULE_ID} | a declaration's turn could not be settled`, err)));
  Hooks.on("deleteCombat", (combat) => onDeleteCombat(combat).catch((err) => console.error(`${MODULE_ID} | a deleted fight's declarations could not be ended`, err)));
  // An item deleted, or a stack emptied (an item's holder is fixed by its uuid, so moving it to another is a delete here), leaves the answers that name it.
  Hooks.on("deleteItem", (item, options, userId) => onItemLeft(item, userId));
  Hooks.on("updateItem", (item, changes, options, userId) => {
    if (!hasStock(item)) onItemLeft(item, userId);
  });
  void import("../lib/sockets.mjs").then(({ registerHandler }) => {
    registerHandler(DECLARE_FLAG_HANDLER, declareFlagHandler);
    registerHandler(LOST_ITEM_HANDLER, lostItemHandler);
  });
}

/** The dependencies a cast resolves or declares through, as the live world gives them. */
export const liveDeclare = () => ({
  declare: (o) => declareCast({ ...o, deps: liveDeclareDeps() }),
  finish: (o) => endDeclaration({ ...o, deps: liveDeclareDeps() }),
  clearHand: (o) => (o.combat && o.combatant ? setPrepareSpell({ combat: o.combat, combatant: o.combatant, value: false }) : undefined),
});
