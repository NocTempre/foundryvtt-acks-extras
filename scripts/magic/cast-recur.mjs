/* global game, ui, ChatMessage, Hooks, fromUuid, fromUuidSync */
/**
 * Recurring rows: what a spell's `recur` rows ask at the moments they recur, as
 * a prompt on the chat card and never an automatic effect. A row that recurs
 * names its moment (`recurAt`: the caster's turn, the start or the end of its
 * bearer's turn), what its bearer throws first (`recurSave`: `row`, a pass ends
 * that bearer's record of the row; `cast`, a pass ends the cast) and whom it
 * meets (`recurTarget`: blank, its bearers; `pick`, a target the caster picks).
 *
 * A row recurs while its anchor stands. A caster-turn row stands on the caster's
 * record of the cast, which `cast-spell.mjs` writes for it; a bearer row on a
 * recipient record of the cast the bearer holds, which `cast-apply.mjs` writes
 * as a status-free anchor (`anchorsNeeded`) where the cast leaves the bearer none
 * of its own. A row `recurSave: row` stands on a record carrying its own row key.
 *
 * The pure half answers which prompts a turn edge raises, builds the prompt's
 * card model and checks a relayed press; the Foundry half posts the prompt on
 * lib's turn hooks (the primary GM only), binds nothing of its own to the card
 * (the cast engine's `cast-spell.mjs` presses call `pressRecurSave` and
 * `pressRecurRoll`) and runs the two relays on the GM's client. Nothing is
 * rolled at posting: a press rolls on the presser's seat, and the GM's client
 * checks the figure against the spell's own row and applies it through the
 * cast's amount path (`cast-apply.mjs` `applyOnTarget`).
 */
import { MODULE_ID } from "./constants.mjs";
import { TURN_BEGAN_HOOK, TURN_ENDED_HOOK } from "../lib/constants.mjs";
import { isRecurring, recurringRows, rowsOf, rowsForMode, saveFractionOf, saveGoverns, resistedDamage } from "./cast-rows.mjs";
import { rangeFeet, rangeVerdicts } from "./cast-range.mjs";
import { spellEffectOf } from "./spell-effect.mjs";
import { newTargetKey, cardOf, cardLoc, castCardContent, postCastCard, updateEntry, addTargets, registerCastCardHooks, CARD_ACTIONS } from "./cast-card.mjs";

/** The message flag a recurring prompt carries beside its card model: `{cardId, castId, round, combatId, moment, bearer}`. */
export const RECUR_FLAG = "recurOf";

/** The relays' handler names on lib's socket transport; the card's button actions are the same words. */
export const CAST_SAVE_HANDLER = "magicCastSave";
export const CAST_ROLL_HANDLER = "magicCastRoll";
export const CAST_NEXT_ROUND_HANDLER = "magicCastNextRound";

/** The moments of one round, in the order a round plays them out when no fight keeps it. */
export const ROUND_MOMENTS = Object.freeze(["casterTurn", "bearerStart", "bearerEnd"]);

/** The id of one entry of a card: a target's key and a row's key (`cast-apply.mjs` `entryId`). */
const idOf = (targetKey, rowKey) => `${targetKey}_${rowKey}`;

/**
 * The keyed rows a prompt can ask: a damage or heal row, and a condition row only
 * where it asks its bearer for a save (a condition that recurs with no throw has
 * nothing to ask). Every other kind is a card line at the cast and no prompt.
 * @param {Array<{row: object, key: string}>} keyed
 */
export const promptRows = (keyed) => (keyed ?? []).filter(({ row }) => row.type === "damage" || row.type === "heal" || (row.type === "conditionGrant" && Boolean(row.recurSave)));

/**
 * Does a bearer hold what a row recurs on? Any record of the cast, and for a row
 * `recurSave: row` one carrying that row's own key.
 * @param {string} key  the row's key
 * @param {object} row
 * @param {string[]} records  the row keys of the bearer's recipient records of the cast ("" for a record with none)
 */
export const bearerHolds = (key, row, records) => (records?.length ?? 0) > 0 && (row?.recurSave !== "row" || records.includes(key));

/**
 * Does a row's anchor stand? A caster-turn row needs the caster's record of the
 * cast, and with a bearer to meet, that bearer's record too; a bearer row needs
 * the bearer's record.
 * @param {{casterRecord: boolean, records: string[]}} stands
 */
export function anchorStands(row, key, { casterRecord, records }) {
  if (row?.recurAt === "casterTurn") return casterRecord === true && (row.recurTarget === "pick" || bearerHolds(key, row, records));
  return bearerHolds(key, row, records);
}

/** Did the save leave this entry nothing? A passed save that dealt nothing and wrote no record. */
const negated = (entry) => entry?.saved === true && !(entry.applied > 0) && !entry.recordIds?.length;

/**
 * The recurring rows of one bearer that need an anchor written because the cast
 * left none: each applied recurring row with a moment and a bearer to meet, that
 * the save did not negate and that wrote no record of its own. A row `recurSave:
 * row` needs a record carrying its own key; any other needs one record of the cast
 * on the bearer, so only the first of them writes it where nothing else did.
 *
 * @param {object} from
 * @param {Array<{row: object, key: string}>} from.rows  the spell's keyed rows for the cast
 * @param {Array<{rowKey: string, entry: object}>} from.applied  the bearer's entries this application wrote
 * @returns {Array<{row: object, key: string}>}
 */
export function anchorsNeeded({ rows, applied }) {
  const entries = new Map((applied ?? []).map((a) => [a.rowKey, a.entry]));
  let held = (applied ?? []).some((a) => a.entry?.recordIds?.length);
  const out = [];
  for (const keyed of rows ?? []) {
    const { row, key } = keyed;
    const entry = entries.get(key);
    if (!isRecurring(row) || !row.recurAt || row.recurTarget === "pick" || entry?.state !== "applied" || negated(entry) || entry.recordIds?.length) continue;
    if (row.recurSave === "row") out.push(keyed);
    else if (!held) {
      out.push(keyed);
      held = true;
    }
  }
  return out;
}

/**
 * The prompt one cast raises at one moment: the rows that name it and stand, the
 * bearers each meets, and the rows whose target the caster picks. Null where no
 * row stands.
 *
 * @param {{castId: string, rows: Array<{row: object, key: string}>, casterRecord: boolean}} cast
 * @param {string} moment
 * @param {Array<{uuid: string, records: string[]}>} scope  the bearers the moment concerns
 */
function promptFor(cast, moment, scope) {
  if (moment === "casterTurn" && !cast.casterRecord) return null;
  const rowBearers = {};
  const pick = [];
  const keys = [];
  for (const { row, key } of promptRows(recurringRows(cast.rows, moment))) {
    if (row.recurTarget === "pick") {
      if (moment === "casterTurn" || scope.length) {
        pick.push(key);
        keys.push(key);
      }
      continue;
    }
    const held = scope.filter((b) => bearerHolds(key, row, b.records));
    if (held.length) {
      rowBearers[key] = held;
      keys.push(key);
    }
  }
  if (!keys.length) return null;
  const bearers = [...new Map(Object.values(rowBearers).flat().map((b) => [b.uuid, b])).values()];
  return { castId: cast.castId, moment, rowKeys: keys, rowBearers, pick, bearers };
}

/**
 * The prompts a turn edge raises. The edge is the lib hook's: `start` is a turn
 * beginning, `end` a turn ending, for the combatant whose actor is `actorUuid`.
 * A start raises the caster-turn prompt of a cast whose caster that actor is,
 * while the caster's record stands, and the bearer-start prompt of every cast the
 * actor holds a record of; an end raises the bearer-end prompt likewise. A
 * caster-turn prompt meets every bearer of the cast; a bearer prompt, the one
 * actor.
 *
 * @param {object} from
 * @param {"start"|"end"} from.edge
 * @param {string} from.actorUuid
 * @param {Array<{castId: string, casterUuid: string, rows: Array<{row: object, key: string}>, casterRecord: boolean, bearers: Array<{uuid: string, name?: string, records: string[]}>}>} from.casts
 * @returns {Array<NonNullable<ReturnType<typeof promptFor>>>}
 */
export function duePrompts({ edge, actorUuid, casts }) {
  const out = [];
  for (const cast of casts ?? []) {
    const own = cast.bearers.filter((b) => b.uuid === actorUuid);
    const moments = edge === "start" ? [...(cast.casterUuid === actorUuid ? ["casterTurn"] : []), ...(own.length ? ["bearerStart"] : [])] : own.length ? ["bearerEnd"] : [];
    for (const moment of moments) {
      const prompt = promptFor(cast, moment, moment === "casterTurn" ? cast.bearers : own);
      if (prompt) out.push(prompt);
    }
  }
  return out;
}

/**
 * The prompts of one whole round, for a cast no fight keeps: each moment in turn,
 * every bearer at once.
 * @param {Parameters<typeof duePrompts>[0]["casts"]} casts
 */
export function roundPrompts(casts) {
  return (casts ?? []).flatMap((cast) => ROUND_MOMENTS.map((moment) => promptFor(cast, moment, cast.bearers)).filter(Boolean));
}

/** Is this prompt one already posted? A prompt is one card for a cast, a moment, a round of a fight and a bearer ("" where it meets them all). */
export function samePrompt(a, b) {
  return Boolean(a && b) && ["castId", "moment", "round", "combatId", "bearer"].every((k) => (a[k] ?? "") === (b[k] ?? ""));
}

/**
 * The card model a prompt is posted as: the original cast's own figures (spell,
 * caster, mode, picks, level, save), one row per prompt row with nothing rolled,
 * one target per bearer and a pending entry for each row a bearer meets. A pick
 * row has no target until its press. `recur` marks the card as a prompt.
 *
 * @param {object} from
 * @param {object} from.source  the original cast card's model
 * @param {ReturnType<typeof promptFor>} from.due
 * @param {Array<{row: object, key: string}>} from.rows  the cast's keyed rows
 * @param {number} from.round
 * @param {string|null} from.combatId
 * @param {string} from.bearer  the bearer's uuid, "" for a prompt that meets them all
 * @param {() => string} [from.randomID]
 */
export function promptModel({ source, due, rows, round, combatId, bearer = "", randomID }) {
  const keyed = new Map(rows.map((r) => [r.key, r.row]));
  const model = {
    castId: source.castId,
    spellUuid: source.spellUuid,
    spellName: source.spellName,
    casterUuid: source.casterUuid,
    casterName: source.casterName,
    mode: source.mode,
    picks: source.picks ?? {},
    casterLevel: source.casterLevel,
    save: source.save,
    situational: source.situational ?? null,
    cite: source.cite ?? "",
    duration: source.duration,
    casterTokenUuid: source.casterTokenUuid ?? null,
    rows: {},
    order: [...due.rowKeys],
    targets: {},
    entries: {},
    allocation: {},
    lines: [],
    recur: { moment: due.moment, round, combatId: combatId ?? null, bearer, pick: [...due.pick] },
  };
  for (const key of due.rowKeys) {
    const row = keyed.get(key);
    model.rows[key] = {
      type: row.type,
      key,
      types: Array.from(row.damage ?? []),
      extraordinary: row.extraordinary === true,
      formula: "",
      total: null,
      detail: "",
      delivery: "",
      saveEffect: row.saveEffect ?? "",
      conditions: Array.from(row.conditions ?? []),
      lasts: row.lasts ?? "",
      healKind: row.healKind ?? "",
      recur: { save: row.recurSave ?? "", target: row.recurTarget ?? "" },
    };
  }
  const keyOf = new Map();
  for (const bearerOf of due.bearers) {
    const tKey = newTargetKey(randomID);
    keyOf.set(bearerOf.uuid, tKey);
    model.targets[tKey] = { uuid: bearerOf.uuid, name: bearerOf.name ?? "", resist: null };
  }
  for (const [rowKey, held] of Object.entries(due.rowBearers)) {
    for (const b of held) model.entries[idOf(keyOf.get(b.uuid), rowKey)] = { state: "pending" };
  }
  return model;
}

/**
 * What the spell's range says of the one token a pick row is pressed at
 * (`cast-range.mjs`, measured centre to centre by the caller): `out` lists the
 * token where it lies beyond the range, empty where it is within or the range
 * cannot be measured. A Player is blocked by a token out of range and a Judge
 * warned, as at the cast; the relay does not measure again.
 *
 * @param {{range: object|null, model?: string, level: number|null, token: {uuid: string, name?: string}, gap: number|null}} from
 * @returns {ReturnType<typeof rangeVerdicts>}
 */
export function pickRange({ range, model = "", level, token, gap }) {
  return rangeVerdicts({ targets: [{ key: token.uuid, name: token.name ?? "" }], gaps: { [token.uuid]: gap }, rangeFeet: rangeFeet(range, level), extent: null, model });
}

/**
 * Settle a relayed press's entries before they are checked and applied. A damage
 * or heal entry a passed save leaves nothing of (a `negates` effect) carries no
 * figure, and is given the lowest the row's roll can show so that the amount
 * path, which reads it, finds one inside the row's bounds; the amount it leaves is
 * zero whatever the figure.
 *
 * @param {object} req
 * @param {{rows: Array<{row: object, key: string}>, card: object, boundsOf: Function}} world
 */
export function settleEntries(req, world) {
  const resist = req.resist ?? null;
  return (req.entries ?? []).map((e) => {
    const keyed = world.rows.find((r) => r.key === e.rowKey);
    const rolled = Number(e.rolled);
    if (!keyed || (keyed.row.type !== "damage" && keyed.row.type !== "heal") || (e.rolled != null && Number.isFinite(rolled))) return e;
    const nothing = resist?.success === true && saveFractionOf(keyed.row, world.card?.save, resist).fraction === 0;
    return nothing ? { ...e, rolled: world.boundsOf(keyed, false)?.min ?? 0 } : e;
  });
}

/**
 * Check a relayed press on a recurring prompt, then the amount as a cast's own
 * relay does. The prompt must be a GM's card (a Player's message is no prompt),
 * the requester must own the bearer for a Save and the caster for a Roll, the row
 * must be one the prompt asks and its anchor must stand; a Save needs a row that
 * asks one, a Roll a row that asks none; a pick row is pressed once and only
 * with a target, and any other row with none. Everything else is the cast's
 * relay's check (`check`, `cast-apply.mjs` `checkApplyRequest`): the save's
 * target and total, the amount's bounds and the gates, against the spell's own
 * rows.
 *
 * @param {object} req  `{requestUserId, kind: "save"|"roll", targetKey, resist, entries: [{rowKey, rolled}], picked}` (`picked`: the target was named by the press)
 * @param {object} world  `worldFor`'s, and `recur` (the prompt's flag), `authorIsGM`, `stored` (the prompt's card as posted), `anchor` (does the row's anchor stand)
 * @param {Function} check  `checkApplyRequest`
 * @returns {{ok: true}|{refused: string}}
 */
export function checkRecurRequest(req, world, check) {
  if (!world.recur || !world.message || !world.stored?.recur) return { refused: "noPrompt" };
  if (world.authorIsGM !== true) return { refused: "notAuthor" };
  if (req.entries?.length !== 1) return { refused: "noEntries" };
  const [{ rowKey }] = req.entries;
  const keyed = world.rows.find((r) => r.key === rowKey);
  const asked = (world.stored.order ?? []).includes(rowKey);
  if (!keyed || !asked || !isRecurring(keyed.row)) return { refused: "badRow" };
  if (req.requestUserId && !(req.kind === "save" ? world.ownsTarget : world.ownsCaster)) return { refused: "notOwner" };
  if (Boolean(keyed.row.recurSave) !== (req.kind === "save")) return { refused: "badKind" };
  const pick = keyed.row.recurTarget === "pick";
  if (pick !== (req.picked === true)) return { refused: "badTarget" };
  if (pick && Object.keys(world.stored.entries ?? {}).some((id) => id.endsWith(`_${rowKey}`))) return { refused: "applied" };
  if (!world.anchor) return { refused: "noAnchor" };
  return check({ ...req, requestUserId: null, entries: settleEntries(req, world) }, world);
}

/**
 * Resolve one pressed entry on the GM's client: the amount of a damage or heal row
 * through the cast's amount path, a condition row as written, and then a passed
 * save's end, whichever the row asks (`row`: the bearer's records of the row;
 * `cast`: the cast). `deps` supplies the writes: `apply(card, targetKey,
 * requests)` is `applyOnTarget`, `writeEntry(id, entry)`, `endRow(actor, castId,
 * rowKey)` and `endCast(card, actor)` answer how many records they removed.
 *
 * @param {object} from
 * @param {object} from.card  the prompt as stored, with the target's resist written
 * @param {string} from.targetKey
 * @param {{rowKey: string, rolled?: number}} from.request
 * @param {{row: object, key: string}} from.keyed
 * @param {{actor: object}} from.found  the bearer, as `liveApplyDeps` resolves it
 * @param {object} from.deps
 * @returns {Promise<{ok: boolean, reason?: string, entry?: object, ended?: number}>}
 */
export async function resolveRecurEntry({ card, targetKey, request, keyed, found, deps }) {
  const { row, key } = keyed;
  const id = idOf(targetKey, key);
  const resist = card.targets?.[targetKey]?.resist ?? null;
  let entry;
  if (row.type === "damage" || row.type === "heal") {
    const done = await deps.apply(card, targetKey, [{ rowKey: key, rolled: request.rolled }]);
    entry = done.find((d) => d.id === id)?.entry;
    if (!entry) return { ok: false, reason: done.find((d) => d.id === id)?.skipped ?? "notApplied" };
  } else {
    entry = { by: deps.by ?? null, state: "applied", saved: resist ? (resist.success ?? null) : null, recordIds: [] };
    await deps.writeEntry(id, entry);
  }
  if (!(row.recurSave && resist?.success === true)) return { ok: true, entry, ended: 0 };
  const ended = row.recurSave === "cast" ? await deps.endCast(card, found.actor) : await deps.endRow(found.actor, card.castId, key);
  entry = { ...entry, ended: { kind: row.recurSave, count: ended } };
  await deps.writeEntry(id, entry);
  return { ok: true, entry, ended };
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

const notify = (level, key, data = {}) => ui.notifications?.[level]?.(game.i18n.format(`ACKS-MAGIC.cast.notice.${key}`, data));

const worldLookups = async () => {
  const { byCookbookId } = await import("../lib/library.mjs");
  return { byCookbookId, fromUuidSync: (u) => fromUuidSync(u) };
};

/** The cast card a cast's prompts are posted from: the message holding its `castCard`, which is no prompt itself. */
const castMessageOf = (castId) => game.messages.contents.find((m) => m.flags?.[MODULE_ID]?.castCard?.castId === castId && !m.flags?.[MODULE_ID]?.[RECUR_FLAG]);

/** The recipient and caster records of one cast on an actor, as `spellEffectOf` reads them. */
const recordsOf = (actor, castId) => [...(actor?.effects ?? [])].map((e) => spellEffectOf(e)).filter((r) => r?.castId === castId);

/**
 * A cast as the prompts read it: its card, its keyed rows for the mode and picks,
 * whether the caster's record of it stands and each bearer holding a record of it.
 * Null where the cast card, its spell or its caster is gone, or no row recurs.
 */
async function castOf(castId) {
  const message = castMessageOf(castId);
  const card = cardOf(message);
  const spell = card ? fromUuidSync(card.spellUuid) : null;
  const caster = card ? fromUuidSync(card.casterUuid) : null;
  if (!card || !spell || !caster) return null;
  const rows = rowsForMode(rowsOf(spell, await worldLookups()).rows, card.mode, card.picks);
  if (!rows.some(({ row }) => isRecurring(row))) return null;
  const { worldActors } = await import("../lib/repair.mjs");
  const bearers = [];
  for (const actor of worldActors()) {
    const held = recordsOf(actor, castId).filter((r) => r.role === "recipient");
    if (held.length) bearers.push({ uuid: actor.uuid, name: actor.name, records: held.map((r) => r.rowKey ?? "") });
  }
  return { castId, casterUuid: caster.uuid, rows, casterRecord: recordsOf(caster, castId).some((r) => r.role === "caster" && !r.pending), bearers, message, card, caster };
}

/** Post prompts, skipping any already posted; the primary GM's. */
async function postPrompts(cast, dues, { round, combatId, bearer }) {
  for (const due of dues) {
    const flag = { cardId: cast.message.id, castId: cast.castId, round, combatId: combatId ?? null, moment: due.moment, bearer: due.moment === "casterTurn" ? "" : bearer };
    if (game.messages.contents.some((m) => samePrompt(m.flags?.[MODULE_ID]?.[RECUR_FLAG], flag))) continue;
    const model = promptModel({ source: cast.card, due, rows: cast.rows, round, combatId, bearer: flag.bearer });
    await postCastCard(model, { mode: "public", speaker: ChatMessage.getSpeaker({ actor: cast.caster }), flags: { [RECUR_FLAG]: flag } });
  }
}

/** A lib turn hook: the prompts of the casts the combatant's actor is the caster or a bearer of. */
async function onTurn(edge, combat, combatantId) {
  if (!game.user?.isGM) return;
  const actor = combat?.combatants?.get(combatantId)?.actor;
  if (!actor) return;
  const castIds = new Set();
  for (const e of actor.effects ?? []) {
    const r = spellEffectOf(e);
    if (r && !r.pending && (r.role === "recipient" || (edge === "start" && r.role === "caster"))) castIds.add(r.castId);
  }
  for (const castId of castIds) {
    const cast = await castOf(castId);
    if (!cast) continue;
    for (const due of duePrompts({ edge, actorUuid: actor.uuid, casts: [cast] })) await postPrompts(cast, [due], { round: combat.round, combatId: combat.id, bearer: actor.uuid });
  }
}

/** The caster's seat or a GM presses Next round: the round's prompts, posted by a GM, for a cast no fight keeps. */
export async function magicCastNextRound(payload = {}) {
  const message = game.messages.get(payload.messageId);
  const card = cardOf(message);
  if (!card || message.flags?.[MODULE_ID]?.[RECUR_FLAG]) return { ok: false, reason: "noCard" };
  const user = game.users.get(payload.requestUserId);
  const caster = fromUuidSync(card.casterUuid);
  if (!caster) return { ok: false, reason: "noCaster" };
  if (user && !user.isGM && caster.testUserPermission?.(user, "OWNER") !== true) return { ok: false, reason: "notOwner" };
  const { fightHolding } = await import("./cast-moment.mjs");
  if (fightHolding([game.combat, ...(game.combats ?? [])], { actor: caster })) return { ok: false, reason: "inFight" };
  const cast = await castOf(card.castId);
  if (!cast) return { ok: false, reason: "noRecur" };
  const round = (Number(card.recurRound) || 0) + 1;
  const dues = roundPrompts([cast]);
  await postPrompts(cast, dues, { round, combatId: null, bearer: "" });
  await message.update({ [`flags.${MODULE_ID}.castCard.recurRound`]: round });
  return { ok: true, posted: dues.length, round };
}

/** The ends a passed save makes, on the GM's client. */
async function liveEnds() {
  const { settledEnds } = await import("./cast-held.mjs");
  const removeWhere = async (actor, keep) => {
    const ids = [...(actor?.effects ?? [])].filter((e) => keep(spellEffectOf(e))).map((e) => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    return ids.length;
  };
  return {
    endRow: (actor, castId, rowKey) => removeWhere(actor, (r) => r?.role === "recipient" && r.castId === castId && r.rowKey === rowKey),
    // A held cast ends through the one funnel (`cast-held.mjs`), cause `saved`, which lists what ended; a cast not held ends its own records here.
    endCast: async (card, actor) => {
      const caster = fromUuidSync(card.casterUuid);
      const held = [...(caster?.effects ?? [])].filter((e) => {
        const r = spellEffectOf(e);
        return r?.role === "caster" && r.castId === card.castId && r.held;
      });
      if (held.length) {
        await caster.deleteEmbeddedDocuments("ActiveEffect", held.map((e) => e.id), { [MODULE_ID]: { endCause: "saved" } });
        await settledEnds();
        return held.length;
      }
      const own = await removeWhere(actor, (r) => r?.role === "recipient" && r.castId === card.castId);
      return own + (await removeWhere(caster, (r) => r?.role === "caster" && r.castId === card.castId));
    },
  };
}

/**
 * The relay of a Save or a Roll press, on the GM's client: the target is added
 * where a pick named it, the request is checked against the spell's own rows
 * (`checkRecurRequest`), the save the seat rolled is written on the prompt's
 * target and the entry is resolved (`resolveRecurEntry`).
 * @param {"save"|"roll"} kind
 * @param {object} payload  `{requestUserId, messageId, targetKey?, targetUuid?, resist?, entries: [{rowKey, rolled?}]}`
 */
async function relayRecur(kind, payload = {}) {
  const message = game.messages.get(payload.messageId);
  const stored = cardOf(message);
  const flag = message?.flags?.[MODULE_ID]?.[RECUR_FLAG];
  const source = flag ? cardOf(game.messages.get(flag.cardId)) : null;
  if (!stored || !flag || !source) return { ok: false, reason: "noPrompt" };
  const rowKey = payload.entries?.[0]?.rowKey;
  const picked = !payload.targetKey && Boolean(payload.targetUuid);
  const pickedDoc = picked ? fromUuidSync(payload.targetUuid) : null;
  if (picked && !pickedDoc?.actor) return { ok: false, reason: "badTarget" };
  const targetKey = picked ? newTargetKey() : payload.targetKey;
  const target = picked ? { uuid: pickedDoc.uuid, name: pickedDoc.name ?? pickedDoc.actor.name ?? "", resist: null } : stored.targets?.[targetKey];
  if (!target) return { ok: false, reason: "badTarget" };
  const asked = { ...target, resist: payload.resist ?? null };
  const virtual = { ...stored, targets: { ...stored.targets, [targetKey]: asked }, entries: { ...stored.entries, ...(picked ? { [idOf(targetKey, rowKey)]: { state: "pending" } } : {}) } };
  const { worldFor, checkApplyRequest, castDeps, liveApplyDeps, applyOnTarget } = await import("./cast-apply.mjs");
  const req = { ...payload, kind, targetKey, picked };
  const world = await worldFor(req, message, { card: virtual, source });
  const cast = await castOf(flag.castId);
  const bearer = [...(cast?.bearers ?? [])].find((b) => b.uuid === (fromUuidSync(target.uuid)?.actor?.uuid ?? target.uuid));
  const keyed = world.rows.find((r) => r.key === rowKey);
  const anchor = Boolean(cast && keyed && anchorStands(keyed.row, rowKey, { casterRecord: cast.casterRecord, records: bearer?.records ?? [] }));
  const author = message.author ?? game.users.get(message.user?.id ?? message.user);
  const verdict = checkRecurRequest(req, { ...world, recur: flag, stored, anchor, authorIsGM: author?.isGM === true }, checkApplyRequest);
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  if (picked) await addTargets(message, { [targetKey]: asked }, { [idOf(targetKey, rowKey)]: { state: "pending" } });
  else if (payload.resist) await message.update({ [`flags.${MODULE_ID}.castCard.targets.${targetKey}.resist`]: payload.resist, content: castCardContent({ ...stored, targets: virtual.targets }, cardLoc) });
  const card = cardOf(message);
  const deps = { ...(await liveApplyDeps(message.id, { writeEntry: (id, entry) => updateEntry(message, id, entry), by: payload.requestUserId ?? game.user.id })), ...castDeps(world.inputs) };
  const found = await deps.resolve(card.targets[targetKey].uuid);
  if (!found?.actor) return { ok: false, reason: "noTarget" };
  const ends = await liveEnds();
  const [request] = settleEntries(req, world);
  const done = await resolveRecurEntry({ card, targetKey, request, keyed, found, deps: { ...deps, ...ends, by: deps.by, apply: (c, t, r) => applyOnTarget(c, t, r, deps) } });
  return done.ok ? { ok: true, ended: done.ended } : { ok: false, reason: done.reason };
}

/** The GM relay of a Save press. */
export const magicCastSave = (payload) => relayRecur("save", payload);

/** The GM relay of a Roll press. */
export const magicCastRoll = (payload) => relayRecur("roll", payload);

/** The prompt's row and spell, from the original cast's own rows. */
async function pressed(message, rowKey) {
  const card = cardOf(message);
  const spell = card ? fromUuidSync(card.spellUuid) : null;
  const caster = card ? fromUuidSync(card.casterUuid) : null;
  const lookups = await worldLookups();
  const kept = spell ? rowsForMode(rowsOf(spell, lookups).rows, card.mode, card.picks) : [];
  const keyed = kept.find((k) => k.key === rowKey) ?? null;
  return { card, spell, caster, keyed, kept, lookups };
}

/** Send a press to the GM's client and tell the seat if it came back refused. */
async function send(handler, payload) {
  const { executeAsGM } = await import("../lib/sockets.mjs");
  const answer = await executeAsGM(handler, payload);
  if (answer && answer.ok === false) notify("warn", "recurRefused", { reason: answer.reason ?? "" });
  return answer;
}

/**
 * A Save press, on the presser's seat: the bearer's own saving throw, rolled here
 * against what the row resists, and where the amount is not negated by a pass, the
 * damage or healing rolled here too. Both go to the GM's client to be checked and
 * applied (`magicCastSave`).
 */
export async function pressRecurSave(message, { target, row }) {
  const { card, spell, caster, keyed, kept, lookups } = await pressed(message, row);
  const doc = card?.targets?.[target] ? await fromUuid(card.targets[target].uuid) : null;
  // A prompt's bearers are the actors holding the records, so the target is an actor as often as it is a token.
  const actor = doc?.documentName === "Actor" ? doc : (doc?.actor ?? null);
  if (!keyed || !caster || !actor) return void notify("warn", "noTargets");
  const { rollResist, rollRow, castGateExtrasOf } = await import("./cast-spell.mjs");
  const { castAbilitiesOf, castSaveParts } = await import("./cast-ability-use.mjs");
  const { targetGate } = await import("./cast-gates.mjs");
  const { ownSaveRows } = await import("./cast-mods.mjs");
  const { actorToken } = await import("../lib/patches/attack-throw.mjs");
  const level = card.casterLevel?.value ?? null;
  const gate = targetGate({ actor, extras: castGateExtrasOf(spell, lookups), row: keyed.row, level });
  if (!gate.affected) return void notify("warn", "exempt", { name: doc.name ?? actor.name });
  const casterToken = card.casterTokenUuid ? fromUuidSync(card.casterTokenUuid) : actorToken(caster);
  // A row no save governs (`saveEffect: none`) rolls no save and sends none: the relay holds it to the stored resist, which is blank too.
  const made = !saveGoverns(keyed.row, card.save)
    ? { resist: null }
    : await rollResist(actor, card.save, card.situational, {
        against: { actor: caster, token: casterToken },
        bearerToken: doc.documentName === "Token" ? doc : null,
        damage: resistedDamage([keyed]),
        // The caster's abilities join this save as they joined the cast's own.
        parts: castSaveParts(castAbilitiesOf(caster, spell, lookups)),
        // The spell's own save rows join this throw as they joined the cast's, for this bearer.
        ownRows: ownSaveRows(kept, { level, label: card.spellName, cite: card.cite }),
        gate: targetGate({ actor, extras: castGateExtrasOf(spell, lookups), level }),
      });
  if (!made.resist && saveGoverns(keyed.row, card.save)) return void notify("warn", "noTargets");
  const entry = { rowKey: row };
  const dealt = (keyed.row.type === "damage" || keyed.row.type === "heal") && saveFractionOf(keyed.row, card.save, made.resist).fraction !== 0;
  if (dealt) entry.rolled = (await rollRow(caster, spell, card, keyed)).total;
  await send(CAST_SAVE_HANDLER, { messageId: message.id, targetKey: target, resist: made.resist, entries: [entry] });
}

/**
 * A Roll press, on the presser's seat: the row's damage or healing rolled here and
 * sent to the GM's client to be checked and applied (`magicCastRoll`). A pick row
 * takes the presser's one targeted token, which the spell's range must reach
 * (`cast-range.mjs`): a Player is blocked and a Judge warned; the relay does not
 * measure again.
 */
export async function pressRecurRoll(message, { target, row }) {
  const { card, spell, caster, keyed, lookups } = await pressed(message, row);
  if (!keyed || !caster) return void notify("warn", "noTargets");
  const payload = { messageId: message.id, entries: [{ rowKey: row }] };
  if (keyed.row.recurTarget === "pick") {
    const tokens = [...(game.user.targets ?? [])].map((t) => t.document ?? t).filter((t) => t?.actor);
    if (tokens.length !== 1) return void notify("warn", "recurOneTarget");
    const { castFiguresOf } = await import("./cast-spell.mjs");
    const { tokenGapFeet } = await import("../lib/distance-units.mjs");
    const { actorToken } = await import("../lib/patches/attack-throw.mjs");
    const [token] = tokens;
    const figures = castFiguresOf(spell, lookups);
    const reach = pickRange({ range: figures.range, model: figures.target?.model, level: card.casterLevel?.value ?? null, token, gap: tokenGapFeet(actorToken(caster), token) });
    if (reach.out.length) {
      const names = reach.out.map((t) => t.name).join(", ");
      if (!game.user.isGM) return void notify("warn", "blocked.outOfRange", { names });
      notify("warn", "verdict.outOfRange", { names });
    }
    payload.targetUuid = token.uuid;
  } else payload.targetKey = target;
  if (keyed.row.type === "damage" || keyed.row.type === "heal") {
    const { rollRow } = await import("./cast-spell.mjs");
    payload.entries[0].rolled = (await rollRow(caster, spell, card, keyed)).total;
  }
  await send(CAST_ROLL_HANDLER, payload);
}

/** A Next round press: asks the GM's client to post the round's prompts. */
export async function pressNextRound(message) {
  await send(CAST_NEXT_ROUND_HANDLER, { messageId: message.id });
}

let registered = false;

/** Register the card's three presses, the turn hooks and the three relays. Once, at `init`. */
export function registerCastRecur() {
  if (registered) return;
  registered = true;
  registerCastCardHooks({ [CARD_ACTIONS.save]: pressRecurSave, [CARD_ACTIONS.roll]: pressRecurRoll, [CARD_ACTIONS.nextRound]: pressNextRound });
  Hooks.on(TURN_BEGAN_HOOK, (combat, combatantId) => onTurn("start", combat, combatantId).catch((err) => console.error(`${MODULE_ID} | a recurring prompt could not be posted`, err)));
  Hooks.on(TURN_ENDED_HOOK, (combat, combatantId) => onTurn("end", combat, combatantId).catch((err) => console.error(`${MODULE_ID} | a recurring prompt could not be posted`, err)));
  void import("../lib/sockets.mjs").then(({ registerHandler }) => {
    registerHandler(CAST_SAVE_HANDLER, magicCastSave);
    registerHandler(CAST_ROLL_HANDLER, magicCastRoll);
    registerHandler(CAST_NEXT_ROUND_HANDLER, magicCastNextRound);
  });
}
