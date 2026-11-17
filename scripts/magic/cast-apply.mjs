/* global game, fromUuid, fromUuidSync, Roll */
/**
 * Applying a cast: what one rolled amount does to one target, whichever client
 * writes it. The amount is the roll, the save's fraction, the target's defenses
 * against the row's own types, then one rounding (`lib/hp-logic.mjs`
 * `amountAfter`, `lib/defenses.mjs`) and goes to `adjustHp`; a condition is a
 * status-only record on the target (`spell-effect.mjs`); a failed save runs
 * lib's loss path first, so the cast's own grant is never the thing lifted.
 *
 * A seat writes the targets it owns itself. Any other target is written by the
 * GM's client, which a seat reaches through the `magicCastApply` handler on
 * lib's socket transport. That handler authorizes against the server-attested
 * `requestUserId`, checks the request against the cast card and the caster's
 * spell (`checkApplyRequest`, pure), and builds every record from the spell's
 * own rows for the card's mode and picks, never from the request and never from
 * the card's display rows, on whichever client writes. The cast card is the
 * anchor: an entry already written or in flight is refused, so a repeated press
 * applies once. With no GM connected the entry stays pending with its Apply
 * press.
 *
 * A target's modifier and ward entries are one group: one request writes one
 * buff record (`cast-mods.mjs`) that every entry of the group names, and Undo on
 * one of them takes the record off for all.
 *
 * The card's flag (`cast-card.mjs`) keeps what each entry did, and the Judge's
 * Undo puts the hit points back and deletes the records by id.
 *
 * A damage entry meets the defenses of the actor the writing client resolves,
 * read there and then; the types and the extraordinary mark are the spell's own
 * row's, never the card's or the request's. A heal takes no defense stage. A case
 * the module does not compute is the Judge's: no amount is written and the entry
 * keeps the defense it names.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { amountAfter, HP_MODE } from "../lib/hp-logic.mjs";
import { actorDefenses, defenseFigures, defenseStage } from "../lib/defenses.mjs";
import { rowsOf, rowsForMode, rowNeedsThrow, saveFractionOf, damageOfRow, resistedDamage } from "./cast-rows.mjs";
import { spellEffectData } from "./spell-effect.mjs";
import { isModRow, modParts, modRecordData } from "./cast-mods.mjs";
import { actorAlignment } from "../lib/actor-read.mjs";

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
 * throw was its resist). A damage row then meets the target's defenses against
 * its own types and extraordinary mark; a heal row meets none. A defense case
 * the module does not compute is also the Judge's, and answers the defense it
 * names as `defense`, with the steps taken before it.
 *
 * @param {object} row  the spell's own row
 * @param {object} card
 * @param {object|null} resist
 * @param {number} rolled
 * @param {{sources?: object[], figures?: object}} [defenses]  the target's defenses (`actorDefenses`) and resistance's figures (`defenseFigures`); absent, the target meets none
 * @returns {{judge: boolean, saved: boolean|null, fraction: number|null, rolled: number, applied: number|null, steps: object[], defense?: object}}
 */
export function amountOf(row, card, resist, rolled, defenses = {}) {
  const made = saveFractionOf(row, card.save, rowNeedsThrow(row) ? null : resist);
  if (made.fraction === null) return { judge: true, saved: made.saved, fraction: null, rolled, applied: null, steps: [] };
  const stage = row?.type === "heal" || !defenses.sources ? null : defenseStage(defenses.sources, damageOfRow(row), defenses.figures ?? {});
  const out = amountAfter(rolled, { fraction: made.fraction, stages: [stage] });
  if (out.judge) return { judge: true, saved: made.saved, fraction: made.fraction, rolled, applied: null, steps: out.steps, defense: defenseOf(out.judge) };
  return { judge: false, saved: made.saved, fraction: made.fraction, rolled, applied: out.applied, steps: out.steps };
}

/** What an entry keeps of a judge stage to name the defense: `{label, band, types, source, cite, why}`. */
const defenseOf = ({ label, band, types, source, cite, why }) => ({ label, band, types: [...(types ?? [])], source, cite: cite ?? null, ...(why ? { why } : {}) });

/**
 * The status-only records one condition row leaves on one target: one per
 * condition the row names. `row` is the spell's own row and `key` its key in the
 * cast; `duration` is the one this client computed or recomputed, never the card's.
 */
export function conditionRecords(row, card, { resist, startTime, spell, spellImg, key, duration = card.duration }) {
  const timed = row.lasts === "duration" && duration && !duration.none;
  return Array.from(row.conditions ?? []).map((status) =>
    spellEffectData({
      spell: { uuid: card.spellUuid, name: card.spellName, img: spell?.img ?? spellImg },
      caster: { uuid: card.casterUuid },
      castId: card.castId,
      role: "recipient",
      statuses: [status],
      rowKey: key ?? row.key,
      resist: resist ? { kind: resist.kind, category: resist.category, total: resist.total, target: resist.target, success: resist.success } : undefined,
      duration: timed ? duration : undefined,
      startTime: timed ? startTime : undefined,
    }),
  );
}

/** Is this entry's state one an apply may start from? */
const isOpen = (entry) => Boolean(entry) && OPEN_STATES.includes(entry.state);

/**
 * The entries of a target's modifier group that are still open and that a
 * request left out. The group is applied whole or not at all, so a request that
 * names one of its entries names them all.
 *
 * @param {object} card
 * @param {string} targetKey
 * @param {Array<{rowKey: string}>} requests
 * @param {Array<{row: object, key: string}>} rows  the spell's keyed rows for the cast
 * @returns {string[]} row keys
 */
export function missingGroupKeys(card, targetKey, requests, rows) {
  const keyed = new Map(rows.map((r) => [r.key, r.row]));
  if (!requests.some((r) => isModRow(keyed.get(r.rowKey)))) return [];
  const named = new Set(requests.map((r) => r.rowKey));
  return rows.filter(({ row, key }) => isModRow(row) && !named.has(key) && isOpen(card.entries?.[entryId(targetKey, key)])).map(({ key }) => key);
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
 * @param {{target: number|null, min: number, max: number, auto?: boolean}|null} world.resist  the target's save recomputed here; `auto` where the target's defenses pass it with no roll
 * @param {{id: string, name: string}|null} [world.item]  the weapon the card names, where it is a weapon of the target's actor
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
    // An `auto` pass has no roll to bound. It stands only where this client recomputes it from the target's defenses; the card's word and the request's are never enough.
    const fits =
      stored.auto || asked.auto
        ? Boolean(stored.auto) && Boolean(asked.auto) && ground?.auto === true && ground.target === stored.target && stored.success === true && stored.total == null
        : ground && ground.target === stored.target && stored.success === (stored.total >= stored.target) && stored.total >= ground.min && stored.total <= ground.max;
    if (!sameFigure || !fits) return { refused: "badResist" };
  }
  if (!Array.isArray(req.entries) || !req.entries.length) return { refused: "noEntries" };
  for (const e of req.entries) {
    const row = world.rows.find((r) => r.key === e.rowKey);
    if (!row) return { refused: "badRow" };
    if (!OPEN_STATES.includes(card.entries?.[entryId(req.targetKey, e.rowKey)]?.state)) return { refused: "applied" };
    // A modifier or ward row has no amount: its figure is the spell's, read at the roll.
    if (row.row.type === "conditionGrant" || isModRow(row.row)) continue;
    const bounds = world.boundsOf(row, e.critical === true);
    const rolled = Number(e.rolled);
    if (!bounds || !Number.isFinite(rolled) || rolled < bounds.min || rolled > bounds.max) return { refused: "badAmount" };
  }
  if (req.entries.some((e) => isModRow(world.rows.find((r) => r.key === e.rowKey)?.row))) {
    if (card.item?.targetKey === req.targetKey && !world.item) return { refused: "badItem" };
    if (missingGroupKeys(card, req.targetKey, req.entries, world.rows).length) return { refused: "badGroup" };
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
 * @param {Array<{row: object, key: string}>} deps.rows  the spell's keyed rows for the card's mode and picks; the only source of what a record holds
 * @param {{value: number, units: string}|{none: string}} [deps.duration]  the cast's duration as this client computed or recomputed it
 * @param {{id: string, name: string}|null} [deps.item]  the weapon a buff names, for the target the card's `item` names
 * @param {{uuid: string, name: string, img?: string, id?: string|null, cite?: string}} [deps.spell]  read from the spell document
 * @param {string|null} [deps.sourceAlignment]  the caster's alignment key
 * @param {(actor: object) => {sources: object[], figures: object}} [deps.defenses]  the target's defenses and resistance's figures; absent, the actor's own (`actorDefenses`) and the world's (`defenseFigures`)
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
    const group = [];
    for (const { r, id } of claimed) {
      const keyed = (deps.rows ?? []).find((k) => k.key === r.rowKey);
      if (!keyed) {
        out.push({ id, skipped: "noRow" });
        continue;
      }
      if (isModRow(keyed.row)) {
        group.push({ keyed, id });
        continue;
      }
      const existing = card.entries?.[id] ?? {};
      const rolled = Number.isFinite(Number(r.rolled)) ? Number(r.rolled) : Number(existing.rolled ?? card.rows?.[r.rowKey]?.total);
      const entry = await applyRow({ card, keyed, rolled, resist, found, deps, existing });
      await deps.writeEntry(id, entry);
      out.push({ id, entry });
    }
    if (group.length) await applyGroup({ card, targetKey, group, resist, found, deps, out });
  } finally {
    for (const { key } of claimed) inFlight.delete(key);
  }
  return out;
}

/**
 * One target's modifier and ward entries: one buff record from the spell's own
 * rows, which every entry of the group names. The weapon is the one the card
 * names for this target, as `deps.item` has checked it; with no parts to write
 * (a blank figure, a row that is a line) the entries are applied with no record.
 */
async function applyGroup({ card, targetKey, group, resist, found, deps, out }) {
  const by = deps.by ?? null;
  const named = card.item?.targetKey === targetKey ? (deps.item ?? null) : null;
  const level = Number(card.casterLevel?.value);
  const made = modParts(
    group.map((g) => g.keyed),
    { level: Number.isFinite(level) ? level : null, actorType: found.actor.type, itemId: named?.id ?? null },
  );
  const data = deps.spell
    ? modRecordData(card, made.parts, {
        spell: deps.spell,
        startTime: deps.now(),
        item: named,
        sourceAlignment: deps.sourceAlignment ?? null,
        resist: resist ? { kind: resist.kind, category: resist.category, total: resist.total, target: resist.target, success: resist.success } : undefined,
        duration: deps.duration,
        lasting: made.lasting,
      })
    : null;
  const recordIds = data ? await deps.createRecords(found.actor, [data]) : [];
  for (const { id } of group) {
    const entry = { by, state: "applied", recordIds: [...recordIds] };
    await deps.writeEntry(id, entry);
    out.push({ id, entry });
  }
}

/** One row on one target: the entry it leaves. `keyed` is the spell's own row. */
async function applyRow({ card, keyed, rolled, resist, found, deps, existing }) {
  const { row, key } = keyed;
  const by = deps.by ?? null;
  const base = { rolled, by, ...(existing.throw ? { throw: existing.throw } : {}) };
  if (row.type === "conditionGrant") {
    const made = saveFractionOf(row, card.save, resist);
    if (made.fraction === null || (made.fraction !== 1 && made.fraction !== 0)) return { ...base, state: "judge", saved: made.saved };
    if (made.fraction === 0) return { ...base, state: "applied", applied: 0, saved: true, recordIds: [] };
    const records = conditionRecords(row, card, { resist, startTime: deps.now(), key, duration: deps.duration ?? { none: "noDuration" }, spell: deps.spell });
    const ids = await deps.createRecords(found.actor, records);
    return { ...base, state: "applied", saved: made.saved, recordIds: ids };
  }
  // The defenses are read from the actor this client writes, as they stand now.
  const defenses = deps.defenses ? deps.defenses(found.actor) : { sources: actorDefenses(found.actor), figures: defenseFigures() };
  const amount = amountOf(row, card, resist, rolled, defenses);
  if (amount.judge) return { ...base, state: "judge", saved: amount.saved, ...(amount.defense ? { fraction: amount.fraction, steps: amount.steps, defense: amount.defense } : {}) };
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

/**
 * Take one entry back, and with it every applied entry of its target that names
 * the same record: a modifier group's entries share one buff record, so the
 * record is deleted once and all of them are marked undone.
 *
 * @param {object} card
 * @param {string} targetKey
 * @param {string} rowKey  the entry the Judge pressed
 * @param {object} deps  as `undoEntry`
 * @returns {Promise<Record<string, object>>} the entries to write, by id
 */
export async function undoEntries(card, targetKey, rowKey, deps) {
  const id = entryId(targetKey, rowKey);
  const first = card.entries?.[id];
  const target = card.targets?.[targetKey];
  const out = {};
  if (!first || !target) return out;
  out[id] = await undoEntry(first, target, deps);
  if (first.state !== "applied" || !first.recordIds?.length) return out;
  for (const [otherId, other] of Object.entries(card.entries)) {
    if (otherId === id || !otherId.startsWith(`${targetKey}_`) || other.state !== "applied") continue;
    if (other.recordIds?.some((r) => first.recordIds.includes(r))) out[otherId] = { ...other, state: "undone" };
  }
  return out;
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

/** Is this a token of the caster whose spell the card names? The card's token uuid is the seat's word, so it is read only where it checks. */
const tokenOfCaster = (token, caster) => Boolean(token && caster && (token.actor === caster || (token.actor?.uuid && token.actor.uuid === caster.uuid)));

/**
 * The duration the cast's records are timed by, recomputed from the spell and the
 * card's caster level. A `dice` duration cannot be recomputed (the roll was the
 * casting client's), so the card's figure stands where it lies between the
 * formula's extremes in the same units, and the shortest otherwise.
 */
async function recomputeDuration(spell, card) {
  const { castDurationOf } = await import("./cast-spell.mjs");
  const { byCookbookId } = await import("../lib/library.mjs");
  const lookups = { byCookbookId, fromUuidSync: (u) => fromUuidSync(u) };
  const level = card.casterLevel?.value;
  const exact = castDurationOf(spell, lookups, level);
  if (exact?.none !== "noRoll") return exact;
  const low = castDurationOf(spell, lookups, level, (f) => foundryBounds(f).min);
  const high = castDurationOf(spell, lookups, level, (f) => foundryBounds(f).max);
  const asked = card.duration;
  const fits = asked && !asked.none && !low.none && !high.none && asked.units === low.units && asked.units === high.units && asked.value >= low.value && asked.value <= high.value;
  return fits ? { value: asked.value, units: asked.units } : low;
}

/**
 * What the cast's records are built from, read off the spell and the caster the
 * card names and never off the card's own display: the spell's keyed rows for the
 * card's mode and picks, the spell as a record names it, the caster's alignment,
 * the duration, and the weapon the card names where it is a weapon of the
 * target's actor. `recompute` takes the duration from the spell again (the GM's
 * client); otherwise the card's own stands (the client that cast it).
 */
async function castInputs(card, targetDoc, { recompute = false } = {}) {
  const { byCookbookId, cookbookId } = await import("../lib/library.mjs");
  const caster = card ? fromUuidSync(card.casterUuid) : null;
  const spell = card ? fromUuidSync(card.spellUuid) : null;
  const rows = spell ? rowsForMode(rowsOf(spell, { byCookbookId, fromUuidSync: (u) => fromUuidSync(u) }).rows, card.mode, card.picks) : [];
  const pick = card?.item?.id ? targetDoc?.actor?.items?.get?.(card.item.id) : null;
  return {
    caster,
    spell,
    rows,
    item: pick?.type === "weapon" ? { id: pick.id, name: pick.name } : null,
    spellMeta: spell ? { uuid: spell.uuid, name: spell.name, img: spell.img, id: cookbookId(spell) || null, cite: spell.flags?.[MODULE_ID]?.[FLAG_SPELL]?.cite ?? "" } : null,
    sourceAlignment: caster ? actorAlignment(caster) || null : null,
    duration: spell && recompute ? await recomputeDuration(spell, card) : (card?.duration ?? { none: "noDuration" }),
  };
}

/** The spell and rows a card's request is checked against, read as the live world gives them. */
async function worldFor(req, message) {
  const card = message?.flags?.[MODULE_ID]?.castCard ?? null;
  const user = game.users.get(req.requestUserId);
  const targetDoc = card?.targets?.[req.targetKey] ? fromUuidSync(card.targets[req.targetKey].uuid) : null;
  const inputs = await castInputs(card, targetDoc, { recompute: true });
  const { caster, spell, rows } = inputs;
  let resist = null;
  if (targetDoc?.actor && card?.save?.category) {
    const { saveSpec } = await import("../lib/saves.mjs");
    const casterToken = card.casterTokenUuid ? fromUuidSync(card.casterTokenUuid) : null;
    const against = caster ? { actor: caster, token: tokenOfCaster(casterToken, caster) ? casterToken : null } : null;
    // What the save resists is the spell's own rows' damage, as the cast read it, so the target's defenses join this throw as they joined that one.
    const spec = saveSpec(targetDoc.actor, card.save.category, {
      situational: card.situational ?? null,
      against,
      bearerToken: targetDoc.documentName === "Token" ? targetDoc : null,
      damage: resistedDamage(rows),
    });
    const bounds = foundryBounds(spec.formula);
    resist = { target: spec.target, min: bounds.min, max: bounds.max, auto: Boolean(spec.auto) };
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
    item: inputs.item,
    inputs,
    boundsOf: (keyed, critical) => {
      const spec = specs.get(keyed.key);
      return spec ? damageBounds(spec, { critical, thrown: rowNeedsThrow(keyed.row) }, foundryBounds) : null;
    },
  };
}

/** What `applyOnTarget` reads of a cast, from `castInputs`. */
const castDeps = (inputs) => ({ rows: inputs.rows, duration: inputs.duration, item: inputs.item, spell: inputs.spellMeta, sourceAlignment: inputs.sourceAlignment });

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
  const deps = { ...(await liveApplyDeps(payload.messageId, { writeEntry: (id, entry) => updateEntry(message, id, entry), by: payload.requestUserId ?? game.user.id })), ...castDeps(world.inputs) };
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
  const inputs = await castInputs(card, doc);
  const asked = [...requests, ...missingGroupKeys(card, targetKey, requests, inputs.rows).map((rowKey) => ({ rowKey }))];
  if (game.user.isGM || doc.actor?.isOwner) {
    const deps = { ...(await liveApplyDeps(message.id, { writeEntry: (id, entry) => updateEntry(message, id, entry) })), ...castDeps(inputs) };
    await applyOnTarget(card, targetKey, asked, deps);
    return { ok: true };
  }
  if (!game.users.activeGM) return { ok: false, reason: "noGm" };
  const { executeAsGM } = await import("../lib/sockets.mjs");
  const answer = await executeAsGM(CAST_APPLY_HANDLER, { messageId: message.id, targetKey, resist: card.targets[targetKey].resist ?? null, entries: asked });
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
