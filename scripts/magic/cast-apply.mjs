/* global game, fromUuid, fromUuidSync, Roll */
/**
 * Applying a cast: what one rolled amount does to one target, whichever client
 * writes it. The amount is the roll, the save's fraction, then one rounding
 * (`lib/hp-logic.mjs` `amountAfter`) and goes to `adjustHp`; a condition is a
 * status-only record on the target (`spell-effect.mjs`); a failed save runs
 * lib's loss path first, so the cast's own grant is never the thing lifted.
 *
 * A seat writes the targets it owns itself. Any other target is written by the
 * GM's client, which a seat reaches through the `magicCastApply` handler on
 * lib's socket transport. That handler authorizes against the server-attested
 * `requestUserId`, checks the request against the cast card and the caster's
 * spell (`checkApplyRequest`, pure), and builds the record from the spell's
 * row, never from the request. The cast card is the anchor: an entry already
 * written or in flight is refused, so a repeated press applies once. With no
 * GM connected the entry stays pending with its Apply press.
 *
 * The card's flag (`cast-card.mjs`) keeps what each entry did, and the Judge's
 * Undo puts the hit points back and deletes the records by id.
 */
import { MODULE_ID } from "./constants.mjs";
import { amountAfter, HP_MODE } from "../lib/hp-logic.mjs";
import { rowsOf, rowsForMode, rowNeedsThrow, saveFractionOf } from "./cast-rows.mjs";
import { spellEffectData } from "./spell-effect.mjs";

/** The relay's handler name on lib's socket transport. */
export const CAST_APPLY_HANDLER = "magicCastApply";

/** The id of one entry of the card: a target's key and a row's key. */
export const entryId = (targetKey, rowKey) => `${targetKey}_${rowKey}`;

/** The states an entry may be applied from. */
const OPEN_STATES = Object.freeze(["pending", "throw", undefined]);

/** Entries being applied on this window, by message and id: a second press before the first lands passes them by. */
const inFlight = new Set();

/**
 * The bounds an amount may fall in. A thrown row keeps the system's floor of
 * one and a critical hit doubles its dice, so its ceiling is doubled; a row
 * with no throw has neither.
 *
 * @param {{formula: string}} spec  a roll spec
 * @param {{critical?: boolean, thrown?: boolean}} o
 * @param {(formula: string) => {min: number, max: number}} boundsOf  the extremes of a formula
 * @returns {{min: number, max: number}|null}
 */
export function damageBounds(spec, { critical = false, thrown = false } = {}, boundsOf) {
  if (!spec?.formula) return null;
  const { min, max } = boundsOf(spec.formula);
  if (!thrown) return { min, max };
  return { min: Math.max(1, min), max: critical ? max * 2 : max };
}

/**
 * The amount one entry applies: the roll through the target's save, with what
 * each step did. A row whose save leaves a figure the module cannot compute is
 * the Judge's (`judge`), and a row with a throw is not saved against (the
 * throw was its resist).
 *
 * @returns {{judge: boolean, saved: boolean|null, fraction: number|null, rolled: number, applied: number|null, steps: object[]}}
 */
export function amountOf(row, card, resist, rolled) {
  const made = saveFractionOf(row, card.save, rowNeedsThrow(row) ? null : resist);
  if (made.fraction === null) return { judge: true, saved: made.saved, fraction: null, rolled, applied: null, steps: [] };
  const out = amountAfter(rolled, { fraction: made.fraction });
  return { judge: false, saved: made.saved, fraction: made.fraction, rolled, applied: out.applied, steps: out.steps };
}

/** The status-only records one condition row leaves on one target: one per condition the row names. */
export function conditionRecords(row, card, { resist, startTime, spell, spellImg }) {
  const timed = row.lasts === "duration" && card.duration && !card.duration.none;
  return Array.from(row.conditions ?? []).map((status) =>
    spellEffectData({
      spell: { uuid: card.spellUuid, name: card.spellName, img: spell?.img ?? spellImg },
      caster: { uuid: card.casterUuid },
      castId: card.castId,
      role: "recipient",
      statuses: [status],
      rowKey: row.key,
      resist: resist ? { kind: resist.kind, category: resist.category, total: resist.total, target: resist.target, success: resist.success } : undefined,
      duration: timed ? card.duration : undefined,
      startTime: timed ? startTime : undefined,
    }),
  );
}

/**
 * Check a relayed request before the GM's client writes anything. Pure: the
 * world's answers arrive in `world`.
 *
 * @param {object} req  `{requestUserId, messageId, targetKey, resist, entries: [{rowKey, rolled, critical}]}`
 * @param {object} world
 * @param {{authorId: string}|null} world.message
 * @param {object|null} world.card  the message's cast card
 * @param {boolean} world.ownsCaster  the requesting user owns the card's caster
 * @param {boolean} world.spellOfCaster  the card's spell is an item of its caster
 * @param {Array<{row: object, key: string}>} world.rows  the spell's rows for the card's mode and picks
 * @param {(keyed: {row: object, key: string}, critical: boolean) => {min: number, max: number}|null} world.boundsOf
 * @param {{target: number|null, min: number, max: number}|null} world.resist  the target's save recomputed here
 * @returns {{ok: true}|{refused: string}}
 */
export function checkApplyRequest(req, world) {
  const { card, message } = world;
  if (!message || !card?.castId) return { refused: "noCard" };
  if (req.requestUserId) {
    if (message.authorId !== req.requestUserId) return { refused: "notAuthor" };
    if (!world.ownsCaster) return { refused: "notOwner" };
  }
  if (!world.spellOfCaster) return { refused: "badSpell" };
  const target = card.targets?.[req.targetKey];
  if (!target) return { refused: "badTarget" };
  const stored = target.resist ?? null;
  const asked = req.resist ?? null;
  if (Boolean(stored) !== Boolean(asked)) return { refused: "badResist" };
  if (stored) {
    const sameFigure = ["total", "target", "success"].every((k) => stored[k] === asked[k]);
    const ground = world.resist;
    const fits = ground && ground.target === stored.target && stored.success === (stored.total >= stored.target) && stored.total >= ground.min && stored.total <= ground.max;
    if (!sameFigure || !fits) return { refused: "badResist" };
  }
  if (!Array.isArray(req.entries) || !req.entries.length) return { refused: "noEntries" };
  for (const e of req.entries) {
    const row = world.rows.find((r) => r.key === e.rowKey);
    if (!row) return { refused: "badRow" };
    if (!OPEN_STATES.includes(card.entries?.[entryId(req.targetKey, e.rowKey)]?.state)) return { refused: "applied" };
    if (row.row.type === "conditionGrant") continue;
    const bounds = world.boundsOf(row, e.critical === true);
    const rolled = Number(e.rolled);
    if (!bounds || !Number.isFinite(rolled) || rolled < bounds.min || rolled > bounds.max) return { refused: "badAmount" };
  }
  return { ok: true };
}

/**
 * Apply the requested entries of one target. Each entry is claimed in flight
 * first and skipped when it is not open; the failed save's loss runs once, before
 * anything is granted; then each row writes its hit points or its records and
 * the card's entry is written whole.
 *
 * @param {object} card
 * @param {string} targetKey
 * @param {Array<{rowKey: string, rolled?: number}>} requests
 * @param {object} deps
 * @param {string} deps.messageId
 * @param {(uuid: string) => Promise<{actor: object, hpTarget: object|null}|null>} deps.resolve
 * @param {Function} deps.adjustHp  lib's, `(entries, {mode}) -> results`
 * @param {(actor: object, cause: string) => Promise<string[]>} deps.lose
 * @param {(actor: object, datas: object[]) => Promise<string[]>} deps.createRecords  the new records' ids
 * @param {(id: string, entry: object) => Promise<unknown>} deps.writeEntry
 * @param {() => number} deps.now  the world time
 * @param {string|null} [deps.by]
 * @returns {Promise<Array<{id: string, skipped?: string, entry?: object}>>}
 */
export async function applyOnTarget(card, targetKey, requests, deps) {
  const target = card.targets?.[targetKey];
  const found = target ? await deps.resolve(target.uuid) : null;
  const out = [];
  if (!found?.actor) {
    for (const r of requests) out.push({ id: entryId(targetKey, r.rowKey), skipped: "noTarget" });
    return out;
  }
  const resist = target.resist ?? null;
  const claimed = [];
  for (const r of requests) {
    const id = entryId(targetKey, r.rowKey);
    const key = `${deps.messageId}:${id}`;
    if (inFlight.has(key) || !OPEN_STATES.includes(card.entries?.[id]?.state)) {
      out.push({ id, skipped: "applied" });
      continue;
    }
    inFlight.add(key);
    claimed.push({ r, id, key });
  }
  try {
    if (resist?.success === false && claimed.length) await deps.lose(found.actor, "save");
    for (const { r, id } of claimed) {
      const row = card.rows?.[r.rowKey];
      if (!row) {
        out.push({ id, skipped: "noRow" });
        continue;
      }
      const existing = card.entries?.[id] ?? {};
      const rolled = Number.isFinite(Number(r.rolled)) ? Number(r.rolled) : Number(existing.rolled ?? row.total);
      const entry = await applyRow({ card, row, rolled, resist, found, deps, existing });
      await deps.writeEntry(id, entry);
      out.push({ id, entry });
    }
  } finally {
    for (const { key } of claimed) inFlight.delete(key);
  }
  return out;
}

/** One row on one target: the entry it leaves. */
async function applyRow({ card, row, rolled, resist, found, deps, existing }) {
  const by = deps.by ?? null;
  const base = { rolled, by, ...(existing.throw ? { throw: existing.throw } : {}) };
  if (row.type === "conditionGrant") {
    const made = saveFractionOf(row, card.save, resist);
    if (made.fraction === null || (made.fraction !== 1 && made.fraction !== 0)) return { ...base, state: "judge", saved: made.saved };
    if (made.fraction === 0) return { ...base, state: "applied", applied: 0, saved: true, recordIds: [] };
    const ids = await deps.createRecords(found.actor, conditionRecords(row, card, { resist, startTime: deps.now() }));
    return { ...base, state: "applied", saved: made.saved, recordIds: ids };
  }
  const amount = amountOf(row, card, resist, rolled);
  if (amount.judge) return { ...base, state: "judge", saved: amount.saved };
  const entry = { ...base, state: "applied", saved: amount.saved, fraction: amount.fraction, applied: amount.applied, steps: amount.steps };
  const before = found.hpTarget?.hp?.value ?? null;
  if (amount.applied > 0 && found.hpTarget) {
    const mode = row.type === "heal" ? HP_MODE.heal : HP_MODE.damage;
    const [result] = await deps.adjustHp([{ target: found.hpTarget, amount: amount.applied, multiplier: 1 }], { mode });
    if (!result?.ok) return { ...entry, state: "refused", before, after: before, why: result?.why ?? "failed" };
    return { ...entry, before: result.before, after: result.after, targetUuid: found.hpTarget.key };
  }
  return { ...entry, before, after: before, targetUuid: found.hpTarget?.key ?? null };
}

/**
 * Take one applied entry back: the hit points return to what they were before
 * and the records it made are deleted by id. The Judge's tool.
 * @param {object} entry  an entry the card holds
 * @param {object} deps  `{resolve, restoreHp, deleteRecords(actor, ids)}` and the card's target
 * @param {{uuid: string}} target
 * @returns {Promise<object>} the entry as it now stands
 */
export async function undoEntry(entry, target, deps) {
  if (entry?.state !== "applied") return entry;
  const found = await deps.resolve(target.uuid);
  if (found?.actor && Number.isFinite(entry.before) && Number.isFinite(entry.after) && entry.before !== entry.after && found.hpTarget) {
    await deps.restoreHp([{ target: found.hpTarget, ok: true, before: entry.before, after: entry.after }]);
  }
  if (found?.actor && entry.recordIds?.length) await deps.deleteRecords(found.actor, entry.recordIds);
  return { ...entry, state: "undone" };
}

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** The extremes of a dice formula, by Foundry's own evaluation. */
const foundryBounds = (formula) => ({
  min: new Roll(formula).evaluateSync({ minimize: true }).total,
  max: new Roll(formula).evaluateSync({ maximize: true }).total,
});

/** The dependencies of a live write, on whichever client runs it. */
export async function liveApplyDeps(messageId, { writeEntry, by = null } = {}) {
  const { adjustHp, restoreHp, resolveTargets } = await import("../lib/hp.mjs");
  const { loseStates } = await import("../lib/status-effects.mjs");
  return {
    messageId,
    adjustHp,
    restoreHp,
    lose: loseStates,
    now: () => game.time.worldTime,
    by: by ?? game.user.id,
    writeEntry,
    resolve: async (uuid) => {
      const doc = await fromUuid(uuid);
      const token = doc?.documentName === "Token" ? doc : null;
      const actor = token?.actor ?? (doc?.documentName === "Actor" ? doc : null);
      if (!actor) return null;
      const [hpTarget] = resolveTargets(token ? { tokens: [token] } : { actors: [actor] });
      return { actor, hpTarget: hpTarget ?? null };
    },
    createRecords: async (actor, datas) => (await actor.createEmbeddedDocuments("ActiveEffect", datas)).map((e) => e.id),
    deleteRecords: async (actor, ids) => actor.deleteEmbeddedDocuments("ActiveEffect", ids.filter((id) => actor.effects.has(id))),
  };
}

/** The spell and rows a card's request is checked against, read as the live world gives them. */
async function worldFor(req, message) {
  const { byCookbookId } = await import("../lib/library.mjs");
  const card = message?.flags?.[MODULE_ID]?.castCard ?? null;
  const caster = card ? fromUuidSync(card.casterUuid) : null;
  const spell = card ? fromUuidSync(card.spellUuid) : null;
  const rows = spell ? rowsForMode(rowsOf(spell, { byCookbookId, fromUuidSync: (u) => fromUuidSync(u) }).rows, card.mode, card.picks) : [];
  const user = game.users.get(req.requestUserId);
  const targetDoc = card?.targets?.[req.targetKey] ? fromUuidSync(card.targets[req.targetKey].uuid) : null;
  let resist = null;
  if (targetDoc?.actor && card?.save?.category) {
    const { saveSpec } = await import("../lib/saves.mjs");
    const spec = saveSpec(targetDoc.actor, card.save.category, { situational: card.situational ?? null });
    const bounds = foundryBounds(spec.formula);
    resist = { target: spec.target, min: bounds.min, max: bounds.max };
  }
  const { rowSpecOf } = await import("./cast-spell.mjs");
  const specs = new Map();
  for (const keyed of rows) specs.set(keyed.key, caster && spell ? await rowSpecOf(caster, spell, card, keyed) : null);
  return {
    message: message ? { authorId: message.author?.id ?? message.user?.id } : null,
    card,
    ownsCaster: !user || user.isGM || caster?.testUserPermission?.(user, "OWNER") === true,
    spellOfCaster: Boolean(spell && caster && spell.parent?.uuid === caster.uuid),
    rows,
    resist,
    boundsOf: (keyed, critical) => {
      const spec = specs.get(keyed.key);
      return spec ? damageBounds(spec, { critical, thrown: rowNeedsThrow(keyed.row) }, foundryBounds) : null;
    },
  };
}

/**
 * The relay's handler, on the GM's client: check, then apply. Answers
 * `{ok}` or `{ok: false, reason}`.
 * @param {object} payload  `{requestUserId, messageId, targetKey, resist, entries}`
 */
export async function magicCastRelay(payload = {}) {
  const message = game.messages.get(payload.messageId);
  const world = await worldFor(payload, message);
  const verdict = checkApplyRequest(payload, world);
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  const { updateEntry } = await import("./cast-card.mjs");
  const deps = await liveApplyDeps(payload.messageId, { writeEntry: (id, entry) => updateEntry(message, id, entry), by: payload.requestUserId ?? game.user.id });
  const done = await applyOnTarget(world.card, payload.targetKey, payload.entries, deps);
  return { ok: true, applied: done.filter((d) => d.entry).length };
}

/**
 * Apply one target's entries, on the right client: here when this seat owns the
 * target, through the GM's client when it does not and one is connected, and
 * not at all (the entries stay pending) when no GM can.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function requestApply(message, targetKey, requests) {
  const card = message.flags?.[MODULE_ID]?.castCard;
  const doc = card?.targets?.[targetKey] ? await fromUuid(card.targets[targetKey].uuid) : null;
  if (!doc) return { ok: false, reason: "noTarget" };
  const { updateEntry } = await import("./cast-card.mjs");
  if (game.user.isGM || doc.actor?.isOwner) {
    const deps = await liveApplyDeps(message.id, { writeEntry: (id, entry) => updateEntry(message, id, entry) });
    await applyOnTarget(card, targetKey, requests, deps);
    return { ok: true };
  }
  if (!game.users.activeGM) return { ok: false, reason: "noGm" };
  const { executeAsGM } = await import("../lib/sockets.mjs");
  const answer = await executeAsGM(CAST_APPLY_HANDLER, { messageId: message.id, targetKey, resist: card.targets[targetKey].resist ?? null, entries: requests });
  return answer?.ok ? { ok: true } : { ok: false, reason: answer?.reason ?? "noAnswer" };
}

let registered = false;

/** Register the relay's handler on lib's socket transport. Once, at `init`. */
export async function registerCastRelay() {
  if (registered) return;
  registered = true;
  const { registerHandler } = await import("../lib/sockets.mjs");
  registerHandler(CAST_APPLY_HANDLER, magicCastRelay);
}
