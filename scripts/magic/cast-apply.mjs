/* global game, fromUuid, fromUuidSync, Roll */
/**
 * Applying a cast: what one rolled amount does to one target, whichever client
 * writes it. The amount is the roll, the save's fraction, the target's defenses
 * against the row's own types, then one rounding (`lib/hp-logic.mjs`
 * `amountAfter`, `lib/defenses.mjs`) and goes to `adjustHp`; a condition is a
 * record of its own on the target, the effect Foundry builds for it (`spell-effect.mjs`); a failed save runs
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
 * The target gates (`cast-gates.mjs`) are recomputed on the writing client from
 * the spell's figures and the card's caster level: the relay refuses an entry the
 * gate exempts (`exempt`), whatever the card holds, and a target that makes no
 * save takes every row as on a failed save, whatever resist the card carries.
 * An entry in state `exempt` is never open, so nothing is rolled, written or
 * recorded for it.
 *
 * A condition row that lasts a next turn or a rolled number of rounds
 * (`cast-life.mjs`) is timed on the writing client from the spell's own row: the
 * rolled count travels in the request and the relay holds it to the formula's
 * reach (`badRounds`), and whether the bearer is a combatant of a begun fight is
 * read there (`deps.fight`), never from the request.
 *
 * A row with no amount of its own (ignite, a condition granted or lifted, a slay,
 * a destroyed weapon) is written through one dispatch, `applyKind`, keyed by its
 * type beside `cast-kinds.mjs`'s card and entry table; an Undo takes back what
 * the entry stored (hit points, records, lifted effects, a destroyed mark).
 *
 * A target's modifier and ward entries are one group: one request writes one
 * buff record (`cast-mods.mjs`) that every entry of the group names, and Undo on
 * one of them takes the record off for all.
 *
 * The card's flag (`cast-card.mjs`) keeps what each entry did, and Undo puts the
 * hit points back and deletes the records by id, only those the cast itself
 * wrote on that target (the spell-effect mark's `castId` and `casterUuid` are the
 * card's). The target's owner undoes an entry where that seat can write both the
 * target and the card; otherwise the GM's client does it through the
 * `magicCastUndo` handler (`checkUndoRequest`, pure), for the target's owner or
 * for the card's author who owns the caster. A request from a seat that does not
 * own the target reaches only what the card's own figures bound: hit points that
 * stand where the entry left them and within the row's reach, and the cast's own
 * records.
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
import { rowsOf, rowsForMode, castAt, rowNeedsThrow, saveFractionOf, damageOfRow, resistedDamage, awaitsFail } from "./cast-rows.mjs";
import { spellEffectData, spellEffectOf } from "./spell-effect.mjs";
import { isModRow, modParts, modRecordData, modifierFigure } from "./cast-mods.mjs";
import { liftPlan, isDestroyed, chosenWeapon } from "./cast-kinds.mjs";
import { actorAlignment } from "../lib/actor-read.mjs";
import { instanceCount, assignedOf } from "./cast-instances.mjs";
import { targetGate, noSaveResist } from "./cast-gates.mjs";
import { lifeOf, lifeEntry, roundsBounds, roundsFormulaOf, hasLife, readsFight } from "./cast-life.mjs";
import { fightHolding } from "./cast-moment.mjs";
import { anchorsNeeded } from "./cast-recur.mjs";
import { undoableEntry } from "./cast-card.mjs";

/** The relay's handler name on lib's socket transport. */
export const CAST_APPLY_HANDLER = "magicCastApply";

/** The undo relay's handler name on lib's socket transport. */
export const CAST_UNDO_HANDLER = "magicCastUndo";

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
 * The condition records one condition row leaves on one target: one per
 * condition the row names, or one status-free record for an `anchor`. A
 * condition's record is the effect Foundry builds for it: `built` holds, by
 * status id, what `statusEffectData` returned (`lib/held-condition.mjs`), and a
 * record takes that entry's brought statuses and its `system.changes` whole.
 * A status `built` has no answer for is written as its own status alone. `row`
 * is the spell's own row and `key` its key in the
 * cast; `duration` is the one this client computed or recomputed, never the card's.
 * A row that lasts a next turn or a number of rounds takes its `life`
 * (`cast-life.mjs` `lifeOf`) instead: the clock of one round or the rolled
 * rounds, and lib's turn flag where the bearer holds a turn in a begun fight; a
 * life with no count leaves the record untimed. A condition the row lists in
 * `untimed` is written with no clock and no turn end, and the row's `endsOn` rides
 * on every record it writes, where lib's loss hooks read it.
 */
export function conditionRecords(row, card, { resist, startTime, spell, spellImg, key, duration = card.duration, life = null, anchor = false, built = {} }) {
  const lived = Boolean(life?.rounds);
  const timed = lived || ((row.lasts === "duration" || anchor) && duration && !duration.none);
  const clock = lived ? { value: life.rounds, units: "rounds" } : duration;
  // A row that names no condition (an ignite row) and a recurring row's anchor, whatever the row names, leave one status-free record.
  const statuses = row.type === "conditionGrant" && !anchor ? Array.from(row.conditions ?? []) : [undefined];
  const free = new Set(Array.from(row.untimed ?? []));
  const endsOn = Array.from(row.endsOn ?? []);
  return statuses.map((status) => {
    const clocked = timed && !free.has(status);
    const condition = status ? (built?.[status] ?? null) : null;
    return spellEffectData({
      spell: { uuid: card.spellUuid, name: card.spellName, img: spell?.img ?? spellImg },
      caster: { uuid: card.casterUuid },
      castId: card.castId,
      role: "recipient",
      invocationLevel: card.invocationLevel,
      statuses: status ? (condition?.statuses ?? [status]) : [],
      system: condition?.system,
      condition: condition ?? undefined,
      rowKey: key ?? row.key,
      resist: resist ? { kind: resist.kind, category: resist.category, total: resist.total, target: resist.target, success: resist.success } : undefined,
      duration: clocked ? clock : undefined,
      startTime: clocked ? startTime : undefined,
      turnLife: lived && clocked ? (life.turnLife ?? undefined) : undefined,
      endsOn,
    });
  });
}

/**
 * What the builder returns for each of `statuses`, by id, for `conditionRecords`:
 * the dependency `conditionData` (`statusEffectData`) read once per status. With
 * no builder in `deps` the map is empty and a record holds its own status alone.
 */
async function builtConditions(statuses, deps) {
  const built = {};
  if (typeof deps.conditionData !== "function") return built;
  for (const status of new Set(statuses)) if (status) built[status] = await deps.conditionData(status);
  return built;
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
 * Check the hits a request names for one thrown row of one target. The count is
 * recomputed from the spell's own row at the card's caster level, the card's
 * split of it among the targets may not exceed it, a target's hits may not
 * exceed the hits its entry holds, and each hit is within the bounds of the
 * row's one roll (`boundsOf`, critical or not).
 *
 * @returns {string|null}  the refusal, or null
 */
function checkInstances(card, targetKey, keyed, e, stored, world) {
  if (!Array.isArray(e.instances) || !e.instances.length) return "badAmount";
  const count = instanceCount(keyed.row, card.casterLevel?.value).value;
  if (count == null) return "badRow";
  const split = card.allocation?.[keyed.key];
  if (split && assignedOf(split) > count) return "tooManyInstances";
  const room = Array.isArray(stored?.instances) ? stored.instances.filter((i) => i.state === "pending").length : (split?.[targetKey] ?? count);
  if (e.instances.length > room) return "tooManyInstances";
  for (const hit of e.instances) {
    const bounds = world.boundsOf(keyed, hit?.critical === true);
    const rolled = Number(hit?.rolled);
    if (!bounds || !Number.isFinite(rolled) || rolled < bounds.min || rolled > bounds.max) return "badAmount";
  }
  return null;
}

/**
 * Check the rolled rounds a request names for one condition row that lasts a
 * number of rounds. The count was the casting client's roll, so it cannot be
 * recomputed: it must be a whole number within the reach of the spell's own
 * formula (`world.roundsBoundsOf`). A row whose formula is blank is untimed and
 * takes no count, and a formula that cannot be read takes none either; any other
 * row's `lasts` asks for none.
 *
 * @returns {string|null}  the refusal, or null
 */
function checkRounds(row, e, world) {
  if (row.lasts !== "rounds" || !roundsFormulaOf(row)) return null;
  const bounds = world.roundsBoundsOf?.(row) ?? null;
  const asked = e.rounds;
  if (!bounds) return asked == null ? null : "badRounds";
  const count = Number(asked);
  return asked != null && Number.isInteger(count) && count >= bounds.min && count <= bounds.max ? null : "badRounds";
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
 * @param {(row: object) => {min: number, max: number}|null} [world.roundsBoundsOf]  the reach of a condition row's own `rounds` formula, null where it cannot be read
 * @param {{target: number|null, min: number, max: number, auto?: boolean}|null} world.resist  the target's save recomputed here; `auto` where the target's defenses pass it with no roll
 * @param {{id: string, name: string}|null} [world.item]  the weapon the card names, where it is a weapon of the target's actor
 * @param {((row: object|null) => {affected: boolean, noSave: boolean}|null)|null} [world.gateOf]  the target's gates recomputed here (`cast-gates.mjs`), for a spell's own row or, with null, the spell's gates alone; null for a target no gate reads
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
    const noSaveHere = world.gateOf?.(null)?.noSave === true;
    // A no-save failure has no roll to bound. It stands only where this client recomputes that the target makes no save, and a rolled save never stands for a target that makes none.
    // An `auto` pass has no roll to bound either. It stands only where this client recomputes it from the target's defenses; the card's word and the request's are never enough.
    const fits =
      stored.noSave || asked.noSave
        ? Boolean(stored.noSave) && Boolean(asked.noSave) && noSaveHere && stored.success === false && stored.total == null
        : noSaveHere
          ? false
          : stored.auto || asked.auto
            ? Boolean(stored.auto) && Boolean(asked.auto) && ground?.auto === true && ground.target === stored.target && stored.success === true && stored.total == null
            : ground && ground.target === stored.target && stored.success === (stored.total >= stored.target) && stored.total >= ground.min && stored.total <= ground.max;
    if (!sameFigure || !fits) return { refused: "badResist" };
  }
  if (!Array.isArray(req.entries) || !req.entries.length) return { refused: "noEntries" };
  for (const e of req.entries) {
    const row = world.rows.find((r) => r.key === e.rowKey);
    if (!row) return { refused: "badRow" };
    // An entry the gate exempts is refused on the recomputed gate, whatever state the card's own word gives it.
    if (card.entries?.[entryId(req.targetKey, e.rowKey)]?.state === "exempt" || world.gateOf?.(row.row)?.affected === false) return { refused: "exempt" };
    if (!OPEN_STATES.includes(card.entries?.[entryId(req.targetKey, e.rowKey)]?.state)) return { refused: "applied" };
    // A kind of the dispatch has no amount, and what its own check holds it to is its kind's (`applyKind`). A modifier or ward row has no amount either: its figure is the spell's, read at the roll.
    const kind = applyKind(row.row.type);
    if (kind) {
      const refused = kind.check?.(row, e, world, { card, targetKey: req.targetKey }) ?? null;
      if (refused) return { refused };
      continue;
    }
    if (isModRow(row.row)) continue;
    if (rowNeedsThrow(row.row)) {
      const stored = card.entries?.[entryId(req.targetKey, e.rowKey)];
      // An entry holding instances is applied by its hits; a request that names none, or more than the entry holds, is not its entry.
      if (Array.isArray(e.instances) || Array.isArray(stored?.instances)) {
        const refused = checkInstances(card, req.targetKey, row, e, stored, world);
        if (refused) return { refused };
        continue;
      }
    }
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
 * The most hit points an applied entry could have written, from the spell's own
 * row: a thrown row's hits sum, each at its own reach. Null where the row cannot
 * be bounded.
 */
function entryReach(entry, keyed, world) {
  if (!keyed) return null;
  if (Array.isArray(entry.instances)) {
    let total = 0;
    for (const hit of entry.instances.filter((i) => i.state === "applied")) {
      const bounds = world.boundsOf(keyed, hit.critical === true);
      if (!bounds) return null;
      total += bounds.max;
    }
    return total;
  }
  return world.boundsOf(keyed, entry.critical === true)?.max ?? null;
}

/**
 * Check a relayed Undo before the GM's client writes anything. Pure: the world's
 * answers arrive in `world`. The seat that owns the target is let through. The
 * card's author who owns the caster is let through only for what the card's own
 * figures bound: the entry holds no lifted effect, destroyed mark or timed life,
 * the target's hit points stand where the entry left them, and the entry's change
 * lies in the direction of its row and within that row's reach.
 *
 * @param {object} req  `{requestUserId, messageId, targetKey, rowKey}`
 * @param {object} world
 * @param {{authorId: string}|null} world.message
 * @param {object|null} world.card  the message's cast card
 * @param {boolean} world.ownsCaster  the requesting user owns the card's caster
 * @param {boolean} world.ownsTarget  the requesting user owns the target's actor
 * @param {number|null} [world.targetHp]  the target's hit points as they stand now, null where unread
 * @param {Array<{row: object, key: string}>} [world.rows]  the spell's rows for the card's mode and picks
 * @param {(keyed: {row: object, key: string}, critical: boolean) => {min: number, max: number}|null} [world.boundsOf]
 * @returns {{ok: true}|{refused: "noCard"|"badTarget"|"notUndoable"|"notOwner"|"needsOwner"|"moved"|"overBound"}}
 */
export function checkUndoRequest(req, world) {
  const { card, message } = world;
  if (!message || !card?.castId) return { refused: "noCard" };
  if (!card.targets?.[req.targetKey]) return { refused: "badTarget" };
  const entry = card.entries?.[entryId(req.targetKey, req.rowKey)];
  if (!undoableEntry(entry)) return { refused: "notUndoable" };
  if (world.ownsTarget === true) return { ok: true };
  if (!(message.authorId === req.requestUserId && world.ownsCaster === true)) return { refused: "notOwner" };
  if (entry.lifted?.length || entry.destroyed || entry.life) return { refused: "needsOwner" };
  const changes = Number.isFinite(entry.before) && Number.isFinite(entry.after) && entry.before !== entry.after;
  if (!changes) return { ok: true };
  const keyed = world.rows?.find((r) => r.key === req.rowKey) ?? null;
  const reach = world.boundsOf ? entryReach(entry, keyed, world) : null;
  if (reach === null) return { refused: "needsOwner" };
  if (world.targetHp !== entry.after) return { refused: "moved" };
  const heals = keyed.row.type === "heal";
  if (heals ? entry.after < entry.before : entry.after > entry.before) return { refused: "overBound" };
  if (Math.abs(entry.before - entry.after) > reach) return { refused: "overBound" };
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
 * @param {(actor: object, row: object|null) => {affected: boolean, noSave: boolean, why: object}|null} [deps.gate]  the target's gates as they stand (`cast-gates.mjs`), for a spell's own row or, with null, the spell's gates alone; absent, nothing is gated
 * @param {(actor: object) => {sources: object[], figures: object}} [deps.defenses]  the target's defenses and resistance's figures; absent, the actor's own (`actorDefenses`) and the world's (`defenseFigures`)
 * @param {(uuid: string) => Promise<{actor: object, token?: object|null, hpTarget: object|null}|null>} deps.resolve
 * @param {(found: {actor: object, token?: object|null}) => Promise<{combatId: string, combatantId: string}|null>} [deps.fight]  the begun fight the bearer is a combatant of, read on the writing client; absent, a record lasting turns is timed by the clock alone
 * @param {Function} deps.adjustHp  lib's, `(entries, {mode}) -> results`
 * @param {(actor: object, cause: string) => Promise<string[]>} deps.lose
 * @param {(statusId: string) => Promise<{statuses: string[], system?: object}>} [deps.conditionData]  the effect data Foundry builds for a condition (`statusEffectData`); absent, a condition record holds its own status alone
 * @param {(statusId: string) => string[]} [deps.impliedStatuses]  the statuses a condition's entry brings (`impliedStatuses`), read by a lifting row; absent, none
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
  // The gates are read from the actor written to, as they stand now; the caster's own target has none.
  const gateOf = (row) => (target.self ? null : (deps.gate?.(found.actor, row) ?? null));
  // A target that makes no save takes every row as on a failed save, whatever the card's resist says.
  const noSaved = target.resist && gateOf(null)?.noSave === true;
  const resist = noSaved ? noSaveResist(card.save, gateOf(null).why) : (target.resist ?? null);
  const claimed = [];
  for (const r of requests) {
    const id = entryId(targetKey, r.rowKey);
    const key = `${deps.messageId}:${id}`;
    const keyedRow = (deps.rows ?? []).find((k) => k.key === r.rowKey);
    if (card.entries?.[id]?.state === "exempt" || (keyedRow && gateOf(keyedRow.row)?.affected === false)) {
      out.push({ id, skipped: "exempt" });
      continue;
    }
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
      // A thrown row's hits: the request's, else the ones its entry holds; null for any row that is not applied by instances.
      const hits = Array.isArray(r.instances) ? r.instances : rowNeedsThrow(keyed.row) && Array.isArray(existing.instances) ? existing.instances.filter((i) => i.state === "pending") : null;
      const entry = await applyRow({ card, keyed, id, rolled, hits, resist, found, deps, existing, rounds: r.rounds, gate: gateOf(keyed.row) });
      await deps.writeEntry(id, entry);
      out.push({ id, entry });
    }
    if (group.length) await applyGroup({ card, targetKey, group, resist, found, deps, out });
    // A recurring prompt's own entries (`card.recur`) are never anchored again: their cast wrote its anchors when it applied.
    if (!target.self && !card.recur) await anchorRecurring({ card, targetKey, resist, found, deps, out, requests });
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
    { level: Number.isFinite(level) ? level : null, actorType: found.actor.type, itemId: named?.id ?? null, save: card.save ?? null, kind: card.pickKind?.key ?? null },
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
        endsOn: made.endsOn,
      })
    : null;
  const recordIds = data ? await deps.createRecords(found.actor, [data]) : [];
  for (const { id } of group) {
    const entry = { by, state: "applied", recordIds: [...recordIds] };
    await deps.writeEntry(id, entry);
    out.push({ id, entry });
  }
}

/**
 * A recurring row's anchor on one bearer (`cast-recur.mjs` `anchorsNeeded`): where
 * the cast leaves the bearer no record the row can recur on, the row writes a
 * status-free recipient record carrying its `rowKey`, `startTime` and its life
 * (the row's `lasts`, else the cast's duration), and the entry names it among its
 * `recordIds`, so an Undo takes it off with the rest.
 */
async function anchorRecurring({ card, targetKey, resist, found, deps, out, requests }) {
  const applied = out.filter((o) => o.entry).map(({ id, entry }) => ({ rowKey: id.slice(targetKey.length + 1), entry }));
  for (const keyed of anchorsNeeded({ rows: deps.rows ?? [], applied })) {
    const entry = applied.find((a) => a.rowKey === keyed.key).entry;
    const asked = requests.find((r) => r.rowKey === keyed.key);
    // A row that waits for a failed save has no life of its own at the cast: its `lasts` is the condition's, written later, and the anchor stands for the cast's duration.
    const life = hasLife(keyed.row) && !awaitsFail(keyed.row) ? lifeOf(keyed.row, { count: asked?.rounds ?? null, fight: readsFight(keyed.row) ? ((await deps.fight?.(found)) ?? null) : null }) : null;
    const records = conditionRecords(keyed.row, card, { resist, startTime: deps.now(), key: keyed.key, duration: deps.duration ?? { none: "noDuration" }, spell: deps.spell, life, anchor: true });
    const ids = await deps.createRecords(found.actor, records);
    const next = { ...entry, recordIds: [...(entry.recordIds ?? []), ...ids] };
    await deps.writeEntry(entryId(targetKey, keyed.key), next);
    const done = out.find((o) => o.id === entryId(targetKey, keyed.key));
    if (done) done.entry = next;
  }
}

/** The life a row of the dispatch takes on one bearer: its next turn, following turn or rolled rounds, read here; null where the row has none. */
async function lifeFor({ row, rounds, found, deps }) {
  return hasLife(row) ? lifeOf(row, { count: rounds ?? null, fight: readsFight(row) ? ((await deps.fight?.(found)) ?? null) : null }) : null;
}

/** Can a saving throw's fraction be applied whole? True where the save failed or governs nothing (1) or negated the row (0); any other fraction has no figure the module computes. */
const wholeOrNone = (made) => made.fraction === 1 || made.fraction === 0;

/**
 * A row of the record family (ignite, the tracked kinds, an affliction's delay) names a recipient and no arithmetic: its record is status-free and lives by the row's own `lasts`, which is what a recurring row of the cast stands on.
 */
async function applyIgnite({ card, keyed, found, deps, existing, base, rounds }) {
  const { row, key } = keyed;
  const life = await lifeFor({ row, rounds, found, deps });
  const records = conditionRecords(row, card, { resist: null, startTime: deps.now(), key, duration: deps.duration ?? { none: "noDuration" }, spell: deps.spell, life });
  const ids = await deps.createRecords(found.actor, records);
  return { ...base, state: "applied", saved: null, recordIds: ids, ...(life ? { life: lifeEntry(life, existing.life?.detail) } : {}) };
}

/** The statuses a bearer already holds from one row of one cast: what a recurring failed save does not write twice. */
function heldFromRow(actor, castId, rowKey) {
  const held = new Set();
  for (const e of actor?.effects ?? []) {
    const r = spellEffectOf(e);
    if (r?.role === "recipient" && r.castId === castId && r.rowKey === rowKey) for (const s of Array.from(e.statuses ?? [])) held.add(s);
  }
  return held;
}

/**
 * A condition row: one record per condition it names, timed from the spell's own row; a passed save that negates it writes none.
 * A condition a record of the bearer makes it immune to (`gate.immune`, `cast-gates.mjs`) is left off and named on the entry as `immune`, so a
 * row covered in part writes the rest. A row that waits for a failed recurring save (`awaitsFail`) writes nothing at the cast: the entry is applied
 * with no record and `awaits`, and the anchor (`anchorRecurring`) is its one record. On a recurring prompt (`card.recur`) a `recurSave: fail` row
 * reads the press's save alone: a pass writes nothing, whatever the row's own effect, and a failure writes the conditions the bearer does not already hold from this row.
 */
async function applyConditionGrant({ card, keyed, resist, found, deps, existing, base, rounds, gate }) {
  const { row, key } = keyed;
  const immune = gate?.immune ?? [];
  const left = new Set(immune.map((i) => i.condition));
  const noted = immune.length ? { immune } : {};
  if (awaitsFail(row) && !card.recur) return { ...base, state: "applied", saved: null, awaits: true, recordIds: [], ...noted };
  const failing = row.recurSave === "fail" && card.recur;
  const made = failing ? { fraction: resist?.success === true ? 0 : 1, saved: resist?.success ?? null } : saveFractionOf(row, card.save, resist);
  if (!wholeOrNone(made)) return { ...base, state: "judge", saved: made.saved };
  if (made.fraction === 0) return { ...base, state: "applied", applied: 0, saved: true, recordIds: [], ...noted };
  const held = failing ? heldFromRow(found.actor, card.castId, key) : new Set();
  const named = Array.from(row.conditions ?? []).filter((c) => !left.has(c));
  const writes = named.filter((c) => !held.has(c));
  const already = named.filter((c) => held.has(c));
  // A next turn or a number of rounds is timed from the spell's own row: the rolled count is the casting client's, the fight is this client's reading of the bearer.
  const life = await lifeFor({ row, rounds, found, deps });
  const built = await builtConditions(writes, deps);
  const records = conditionRecords({ ...row, conditions: writes }, card, { resist, startTime: deps.now(), key, duration: deps.duration ?? { none: "noDuration" }, spell: deps.spell, life, built });
  const ids = records.length ? await deps.createRecords(found.actor, records) : [];
  return { ...base, state: "applied", saved: made.saved, recordIds: ids, ...noted, ...(already.length ? { already } : {}), ...(life ? { life: lifeEntry(life, existing.life?.detail) } : {}) };
}

/**
 * A condition row that lifts: the conditions it names come off the target through lib's `lift`, on this client, and the effects that went are stored whole on the entry so an Undo
 * recreates them under their own ids. What `liftPlan` leaves standing (an effect of statuses its entry does not bring, one a feature manages or holds) is listed on the entry with its reason.
 * Only what is gone from the actor after the lift is stored, since `lift` logs a failure and goes on.
 */
async function applyConditionRemove({ keyed, found, deps, base }) {
  const plan = liftPlan(found.actor.effects, keyed.row.conditions, deps.impliedStatuses);
  const data = plan.lift.map((e) => e.toObject());
  if (plan.statuses.length) await deps.lift(found.actor, plan.statuses);
  const lifted = data.filter((d) => !found.actor.effects.has(d._id));
  return { ...base, state: "applied", saved: null, lifted, listed: plan.listed, recordIds: [] };
}

/**
 * A row that slays: the target's hit points go to zero with no defense stage (a creature at or below zero is left where it is), and a record holding the dead status stays on it; an Undo restores both. A passed save that negates it writes nothing, and a
 * target whose hit points cannot be written is the Judge's.
 */
async function applySlay({ card, keyed, resist, found, deps, base }) {
  const { row, key } = keyed;
  const made = saveFractionOf(row, card.save, resist);
  if (!wholeOrNone(made) || !found.hpTarget) return { ...base, state: "judge", saved: made.saved };
  if (made.fraction === 0) return { ...base, state: "applied", applied: 0, saved: true, recordIds: [] };
  const before = found.hpTarget.hp?.value ?? null;
  const entry = { ...base, state: "applied", saved: made.saved, recordIds: [], before, after: before, targetUuid: found.hpTarget.key ?? null, applied: 0 };
  if (Number.isFinite(before) && before > 0) {
    const [result] = await deps.adjustHp([{ target: found.hpTarget, amount: before, multiplier: 1 }], { mode: HP_MODE.damage, floorAtZero: true });
    if (!result?.ok) return { ...base, state: "refused", saved: made.saved, before, after: before, why: result?.why ?? "failed" };
    Object.assign(entry, { before: result.before, after: result.after, applied: result.before - result.after });
  }
  if (deps.deadStatus) {
    const built = await builtConditions([deps.deadStatus], deps);
    const records = conditionRecords({ type: "conditionGrant", conditions: [deps.deadStatus], lasts: "instant" }, card, { resist, startTime: deps.now(), key, duration: { none: "noDuration" }, spell: deps.spell, built });
    entry.recordIds = await deps.createRecords(found.actor, records);
  }
  return entry;
}

/** The entries of a card row that destroyed a weapon, other than `id`: what the cast's count of weapons has spent. */
const destroyedCount = (card, rowKey, id) => Object.entries(card.entries ?? {}).filter(([k, e]) => k !== id && k.endsWith(`_${rowKey}`) && e?.state === "applied" && e.destroyed).length;

/**
 * A row that destroys one weapon of its holder: the weapon the entry names (the seat's pick for this holder at the cast, else `pickWeapon`'s default), on a failed save, up to the spell's
 * count of weapons across the whole cast. The weapon is marked destroyed through equipment's `setDestroyed` and never deleted; an Undo clears the mark. A weapon that is gone, no longer a weapon or already destroyed
 * is refused as `badItem` and written as an entry that did nothing, and a holder with none is an applied entry that names no weapon.
 */
async function applyDestroyItem({ card, keyed, id, resist, found, deps, existing, base }) {
  const made = saveFractionOf(keyed.row, card.save, resist);
  if (!wholeOrNone(made)) return { ...base, state: "judge", saved: made.saved };
  const named = existing.item ?? null;
  if (!named) return { ...base, state: "applied", saved: made.saved, item: null, recordIds: [] };
  const weapon = found.actor.items?.get?.(named.id) ?? null;
  if (!weapon || weapon.type !== "weapon" || isDestroyed(weapon)) return { ...base, state: "refused", saved: made.saved, item: named, why: "badItem" };
  if (made.fraction === 0) return { ...base, state: "applied", saved: true, item: named, recordIds: [] };
  const cap = Number.isFinite(deps.itemCap) ? deps.itemCap : null;
  if (cap !== null && destroyedCount(card, keyed.key, id) >= cap) return { ...base, state: "refused", saved: made.saved, item: named, why: "overCount" };
  await deps.setDestroyed(weapon, true);
  return { ...base, state: "applied", saved: made.saved, item: named, destroyed: named, recordIds: [] };
}

/** What a destroy row's relay check holds the entry to: the weapon the card names is one the target still carries live, or, where the card names none, that the target still has none. */
function checkItem(keyed, _e, world, { card, targetKey }) {
  if (typeof world.weaponOf !== "function") return null;
  const named = card.entries?.[entryId(targetKey, keyed.key)]?.item?.id ?? null;
  return (world.weaponOf(named)?.id ?? null) === named ? null : "badItem";
}

/** A row that writes nothing to a target: its entry is applied and holds no record. A kind whose row is a card line opens no entry, so this is what an entry of one would be. */
async function applyNothing({ base }) {
  return { ...base, state: "applied", saved: null, recordIds: [] };
}

/** The appliers of the record family: one record on the recipient, timed by the row's own `lasts`. */
const RECORDING = Object.freeze({ apply: applyIgnite, check: (keyed, e, world) => checkRounds(keyed.row, e, world) });

/**
 * The row kinds a cast applies with no amount of their own, by type: the one dispatch (`cast-kinds.mjs` holds the same types' card and entry facts). Each entry:
 * `apply(ctx)` writes one row on one target and returns the card's entry, where `ctx` is `{card, keyed, id, resist, found, deps, existing, base, rounds, gate}` (`gate`: the target's gate for this row, null for the caster's own target);
 * `check(keyed, request, world, {card, targetKey})` is what the relay holds a request for it to beyond the common checks (a refusal word, or null).
 * A new kind is added here and in `APPLY_KINDS`; a kind that takes a step instead of an apply (a summoning) is in `APPLY_KINDS` alone.
 */
const APPLIERS = Object.freeze({
  ignite: RECORDING,
  illusion: RECORDING,
  detect: RECORDING,
  light: RECORDING,
  dispel: RECORDING,
  createObject: RECORDING,
  wall: RECORDING,
  afflictionDelay: RECORDING,
  purify: Object.freeze({ apply: applyNothing }),
  seal: Object.freeze({ apply: applyNothing }),
  conditionGrant: Object.freeze({ apply: applyConditionGrant, check: (keyed, e, world) => checkRounds(keyed.row, e, world) }),
  conditionRemove: Object.freeze({ apply: applyConditionRemove }),
  slay: Object.freeze({ apply: applySlay }),
  destroyItem: Object.freeze({ apply: applyDestroyItem, check: checkItem }),
});

/** The appliers of a row type, or null where the type is not a kind of the dispatch. */
export const applyKind = (type) => (Object.hasOwn(APPLIERS, type) ? APPLIERS[type] : null);

/** One row on one target: the entry it leaves. `keyed` is the spell's own row, `id` its entry's id. */
async function applyRow({ card, keyed, id, rolled, hits = null, resist, found, deps, existing, rounds = null, gate = null }) {
  const { row } = keyed;
  const by = deps.by ?? null;
  if (hits) return applyInstances({ card, keyed, hits, resist, found, deps, existing });
  const base = { rolled, by, ...(existing.throw ? { throw: existing.throw } : {}) };
  const kind = applyKind(row.type);
  // A kind has no amount, so a figure the card never held is no "rolled" on its entry.
  if (kind) return kind.apply({ card, keyed, id, resist, found, deps, existing, base: Number.isFinite(rolled) ? base : { ...base, rolled: undefined }, rounds, gate });
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
 * A thrown row's hits on one target as one entry: each hit rounds and meets the
 * target's defenses alone (`amountOf`), the amounts are summed, and one
 * `adjustHp` writes the sum, so one Undo takes it back. A hit the module cannot
 * compute makes the whole entry the Judge's and writes nothing. The entry keeps
 * every instance, the missed ones as they were thrown and each hit with what it
 * applied.
 */
async function applyInstances({ card, keyed, hits, resist, found, deps, existing }) {
  const { row } = keyed;
  const by = deps.by ?? null;
  const defenses = deps.defenses ? deps.defenses(found.actor) : { sources: actorDefenses(found.actor), figures: defenseFigures() };
  const amounts = hits.map((hit) => amountOf(row, card, resist, Number(hit.rolled), defenses));
  const held = Array.isArray(existing.instances) && existing.instances.length ? existing.instances : hits.map((hit) => ({ ...hit, state: "pending" }));
  const judged = amounts.find((a) => a.judge);
  const first = amounts[0];
  let next = 0;
  const instances = held.map((inst) => {
    if (inst.state !== "pending" || next >= hits.length) return inst;
    const at = next++;
    const made = amounts[at];
    const hit = { ...inst, rolled: Number(hits[at].rolled), critical: hits[at].critical === true };
    // A judged entry writes nothing, so none of its hits reads as applied.
    if (judged) return made.judge ? { ...hit, state: "judge", ...(made.defense ? { defense: made.defense } : {}) } : hit;
    return { ...hit, state: "applied", applied: made.applied, steps: made.steps };
  });
  if (judged) return { by, state: "judge", saved: judged.saved, instances, ...(judged.defense ? { fraction: judged.fraction, defense: judged.defense } : {}) };
  const applied = amounts.reduce((sum, a) => sum + a.applied, 0);
  const entry = { by, state: "applied", saved: first?.saved ?? null, fraction: first?.fraction ?? null, applied, instances };
  const before = found.hpTarget?.hp?.value ?? null;
  if (applied > 0 && found.hpTarget) {
    const [result] = await deps.adjustHp([{ target: found.hpTarget, amount: applied, multiplier: 1 }], { mode: HP_MODE.damage });
    if (!result?.ok) return { ...entry, state: "refused", before, after: before, why: result?.why ?? "failed" };
    return { ...entry, before: result.before, after: result.after, targetUuid: found.hpTarget.key };
  }
  return { ...entry, before, after: before, targetUuid: found.hpTarget?.key ?? null };
}

/**
 * Take one applied entry back: the hit points return to what they were before,
 * the records it made are deleted by id, the effects it lifted are recreated under
 * their own ids (`restoreRecords`) and the weapon it marked destroyed is cleared
 * (`clearDestroyed`).
 * @param {object} entry  an entry the card holds
 * @param {object} deps  `{resolve, restoreHp, deleteRecords(actor, ids), restoreRecords(actor, datas), clearDestroyed(actor, itemId)}` and the card's target
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
  if (found?.actor && entry.lifted?.length) await deps.restoreRecords?.(found.actor, entry.lifted);
  if (found?.actor && entry.destroyed?.id) await deps.clearDestroyed?.(found.actor, entry.destroyed.id);
  return { ...entry, state: "undone" };
}

/**
 * Take one entry back, and with it every applied entry of its target that names
 * the same record: a modifier group's entries share one buff record, so the
 * record is deleted once and all of them are marked undone.
 *
 * @param {object} card
 * @param {string} targetKey
 * @param {string} rowKey  the entry that was pressed
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

/**
 * The ids, of those a card names, of effects the cast itself wrote: each one held
 * by `effects` whose spell-effect mark carries the anchor's `castId` and
 * `casterUuid`. With no anchor, none.
 * @param {{get: (id: string) => object|undefined}} effects  an actor's effects
 * @param {string[]} ids
 * @param {{castId: string, casterUuid: string}|null} anchor
 * @returns {string[]}
 */
export function anchoredRecordIds(effects, ids, anchor) {
  if (!anchor?.castId) return [];
  return ids.filter((id) => {
    const mark = spellEffectOf(effects.get(id));
    return Boolean(mark) && mark.castId === anchor.castId && mark.casterUuid === (anchor.casterUuid ?? "");
  });
}

/**
 * The dependencies of a live write, on whichever client runs it. `anchor` is the
 * cast's `{castId, casterUuid}`: `deleteRecords` deletes only the effects whose
 * spell-effect mark carries both, so a record id the card names reaches nothing
 * the cast did not write. Without an anchor it deletes none.
 */
export async function liveApplyDeps(messageId, { writeEntry, by = null, anchor = null } = {}) {
  const { adjustHp, restoreHp, resolveTargets } = await import("../lib/hp.mjs");
  const { loseStates, lift, STATUS_DEAD } = await import("../lib/status-effects.mjs");
  const { statusEffectData, impliedStatuses } = await import("../lib/held-condition.mjs");
  return {
    messageId,
    adjustHp,
    restoreHp,
    lose: loseStates,
    lift,
    conditionData: statusEffectData,
    impliedStatuses,
    deadStatus: STATUS_DEAD,
    setDestroyed: async (item, on) => (await import("../equipment/actions.mjs")).setDestroyed(item, on),
    clearDestroyed: async (actor, itemId) => {
      const item = actor.items?.get?.(itemId);
      if (item) await (await import("../equipment/actions.mjs")).setDestroyed(item, false);
    },
    // Effects an Undo puts back keep their own ids; one a later write already holds is not made twice.
    restoreRecords: async (actor, datas) => {
      const fresh = datas.filter((d) => d?._id && !actor.effects.has(d._id));
      if (fresh.length) await actor.createEmbeddedDocuments("ActiveEffect", fresh, { keepId: true });
    },
    now: () => game.time.worldTime,
    by: by ?? game.user.id,
    writeEntry,
    resolve: async (uuid) => {
      const doc = await fromUuid(uuid);
      const token = doc?.documentName === "Token" ? doc : null;
      const actor = token?.actor ?? (doc?.documentName === "Actor" ? doc : null);
      if (!actor) return null;
      const [hpTarget] = resolveTargets(token ? { tokens: [token] } : { actors: [actor] });
      return { actor, token, hpTarget: hpTarget ?? null };
    },
    // The begun fight the bearer is a combatant of, as this client reads it; none where the bearer holds no turn to count.
    fight: async ({ actor, token }) => {
      const held = fightHolding([game.combat, ...(game.combats ?? [])], { actor, token });
      return held ? { combatId: held.combat.id, combatantId: held.combatant.id } : null;
    },
    createRecords: async (actor, datas) => (await actor.createEmbeddedDocuments("ActiveEffect", datas)).map((e) => e.id),
    deleteRecords: async (actor, ids) => {
      const own = anchoredRecordIds(actor.effects, ids, anchor);
      if (own.length) await actor.deleteEmbeddedDocuments("ActiveEffect", own);
    },
  };
}

/** The actor a card target names: the target itself where it is an actor (a recurring prompt's bearers are actors), else its token's actor. */
const actorOfTarget = (doc) => (doc?.documentName === "Actor" ? doc : (doc?.actor ?? null));

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
  const exact = castDurationOf(spell, lookups, level, undefined, card.mode);
  if (exact?.none !== "noRoll") return exact;
  const low = castDurationOf(spell, lookups, level, (f) => foundryBounds(f).min, card.mode);
  const high = castDurationOf(spell, lookups, level, (f) => foundryBounds(f).max, card.mode);
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
  const { castGateExtrasOf } = await import("./cast-spell.mjs");
  const caster = card ? fromUuidSync(card.casterUuid) : null;
  const spell = card ? fromUuidSync(card.spellUuid) : null;
  const lookups = { byCookbookId, fromUuidSync: (u) => fromUuidSync(u) };
  const rows = spell ? rowsForMode(rowsOf(spell, lookups).rows, card.mode, card.picks, castAt(card)) : [];
  const pick = card?.item?.id ? actorOfTarget(targetDoc)?.items?.get?.(card.item.id) : null;
  // The gates read the spell's figures as they stand now and the card's caster level.
  const extras = spell ? castGateExtrasOf(spell, lookups, castAt(card)) : null;
  return {
    caster,
    spell,
    rows,
    // The spell's count of weapons a destroy row may take across the cast, at the card's caster level; null where the import read none.
    itemCap: extras ? modifierFigure({ value: extras.target?.count }, card?.casterLevel?.value ?? null) : null,
    gate: (actor, row) => targetGate({ actor, extras, row, level: card?.casterLevel?.value ?? null }),
    item: pick?.type === "weapon" ? { id: pick.id, name: pick.name } : null,
    spellMeta: spell ? { uuid: spell.uuid, name: spell.name, img: spell.img, id: cookbookId(spell) || null, cite: spell.flags?.[MODULE_ID]?.[FLAG_SPELL]?.cite ?? "" } : null,
    sourceAlignment: caster ? actorAlignment(caster) || null : null,
    duration: spell && recompute ? await recomputeDuration(spell, card) : (card?.duration ?? { none: "noDuration" }),
  };
}

/**
 * The spell and rows a card's request is checked against, read as the live world
 * gives them. `card` stands in for the message's own (a recurring prompt's, with
 * the request's resist and target on it), and `source` is the card the spell, rows,
 * mode, picks and duration are read from (the prompt's original cast card).
 */
export async function worldFor(req, message, { card: given = null, source = null } = {}) {
  const card = given ?? message?.flags?.[MODULE_ID]?.castCard ?? null;
  const user = game.users.get(req.requestUserId);
  const targetDoc = card?.targets?.[req.targetKey] ? fromUuidSync(card.targets[req.targetKey].uuid) : null;
  const inputs = await castInputs(source ?? card, targetDoc, { recompute: true });
  const { caster, spell, rows } = inputs;
  let resist = null;
  const targetActor = actorOfTarget(targetDoc);
  if (targetActor && card?.save?.category) {
    const { saveSpec } = await import("../lib/saves.mjs");
    const { ownSaveRows, spellSaveParts } = await import("./cast-mods.mjs");
    const { castAbilitiesOf, castSaveParts } = await import("./cast-ability-use.mjs");
    const casterToken = card.casterTokenUuid ? fromUuidSync(card.casterTokenUuid) : null;
    const against = caster ? { actor: caster, token: tokenOfCaster(casterToken, caster) ? casterToken : null } : null;
    // What the save resists is the spell's own rows' damage, as the cast read it, so the target's defenses join this throw as they joined that one.
    const spec = saveSpec(targetActor, card.save.category, {
      situational: card.situational ?? null,
      against,
      bearerToken: targetDoc.documentName === "Token" ? targetDoc : null,
      damage: resistedDamage(rows),
      // The caster's abilities, read live as the casting client read them, so the throw's bounds are the same.
      // The spell's own save modifier joins it where the card says the seat switched it on, its figure read from the spell at the card's level.
      parts: [...castSaveParts(castAbilitiesOf(caster, spell)), ...spellSaveParts(spell?.flags?.[MODULE_ID]?.[FLAG_SPELL]?.save, { level: card.casterLevel?.value ?? null, applied: card.saveMod === true, label: card.spellName })],
      // The spell's own save rows, read for this saver as the casting seat read them.
      ownRows: ownSaveRows(rows, { level: card.casterLevel?.value ?? null, label: card.spellName, cite: card.cite }),
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
    ownsTarget: !user || user.isGM || targetActor?.testUserPermission?.(user, "OWNER") === true,
    spellOfCaster: Boolean(spell && caster && spell.parent?.uuid === caster.uuid),
    rows,
    resist,
    gateOf: targetActor && !card.targets[req.targetKey].self ? (row) => inputs.gate(targetActor, row) : null,
    // The weapon a destroy row takes from this target as the world stands now, for the relay to hold against the card's.
    weaponOf: targetActor ? (named) => chosenWeapon(targetActor, named) : null,
    item: inputs.item,
    inputs,
    roundsBoundsOf: (row) => roundsBounds(roundsFormulaOf(row), foundryBounds),
    boundsOf: (keyed, critical) => {
      const spec = specs.get(keyed.key);
      return spec ? damageBounds(spec, { critical, thrown: rowNeedsThrow(keyed.row) }, foundryBounds) : null;
    },
  };
}

/** What `applyOnTarget` reads of a cast, from `castInputs`. */
export const castDeps = (inputs) => ({ rows: inputs.rows, duration: inputs.duration, item: inputs.item, spell: inputs.spellMeta, sourceAlignment: inputs.sourceAlignment, gate: inputs.gate, itemCap: inputs.itemCap });

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

/** The actor a stored card target names, read as the world stands. */
const targetActorOf = (card, targetKey) => actorOfTarget(card?.targets?.[targetKey] ? fromUuidSync(card.targets[targetKey].uuid) : null);

/**
 * Take one entry back on this client: the target's hit points and records and then
 * the card's entries are written here. The records deleted are the cast's own
 * (`anchoredRecordIds`), and the entry is claimed in flight so a second press passes it by.
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
async function undoHere(message, targetKey, rowKey, by) {
  const key = `undo:${message.id}:${entryId(targetKey, rowKey)}`;
  if (inFlight.has(key)) return { ok: false, reason: "inFlight" };
  inFlight.add(key);
  try {
    const card = message.flags?.[MODULE_ID]?.castCard;
    const { updateEntry } = await import("./cast-card.mjs");
    const deps = await liveApplyDeps(message.id, { writeEntry: (id, entry) => updateEntry(message, id, entry), by, anchor: { castId: card.castId, casterUuid: card.casterUuid } });
    const next = await undoEntries(card, targetKey, rowKey, deps);
    for (const [id, entry] of Object.entries(next)) await updateEntry(message, id, entry);
    return { ok: true };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * The relay's Undo handler, on the GM's client: check, then take the entry back.
 * Answers `{ok}` or `{ok: false, reason}`.
 * @param {object} payload  `{requestUserId, messageId, targetKey, rowKey}`
 */
export async function magicCastUndo(payload = {}) {
  const message = game.messages.get(payload.messageId);
  const world = await worldFor(payload, message);
  const card = world.card;
  const found = card?.targets?.[payload.targetKey] ? await fromUuid(card.targets[payload.targetKey].uuid) : null;
  const token = found?.documentName === "Token" ? found : null;
  const actor = token?.actor ?? (found?.documentName === "Actor" ? found : null);
  let targetHp = null;
  if (actor) {
    const { resolveTargets } = await import("../lib/hp.mjs");
    targetHp = resolveTargets(token ? { tokens: [token] } : { actors: [actor] })[0]?.hp?.value ?? null;
  }
  const verdict = checkUndoRequest(payload, { ...world, targetHp });
  if (verdict.refused) return { ok: false, reason: verdict.refused };
  return undoHere(message, payload.targetKey, payload.rowKey, payload.requestUserId ?? game.user.id);
}

/**
 * Take one entry of a card back, on the right client: here when this seat can
 * write both the card and the target's actor, through the GM's client when it
 * cannot, and not at all when no GM is connected (the transport's own notice
 * says so, and the reason is `noGm`).
 * @returns {Promise<{ok: boolean, reason?: string}>}
 */
export async function requestUndo(message, targetKey, rowKey) {
  const card = message.flags?.[MODULE_ID]?.castCard;
  if (!card?.targets?.[targetKey]) return { ok: false, reason: "badTarget" };
  if (message.isOwner && targetActorOf(card, targetKey)?.isOwner === true) return undoHere(message, targetKey, rowKey, game.user.id);
  const { executeAsGM } = await import("../lib/sockets.mjs");
  // With no GM connected the transport tells the user and answers nothing.
  const answer = await executeAsGM(CAST_UNDO_HANDLER, { messageId: message.id, targetKey, rowKey });
  return answer?.ok ? { ok: true } : { ok: false, reason: answer === undefined ? "noGm" : (answer.reason ?? "noAnswer") };
}

let registered = false;

/** Register the relay's handlers on lib's socket transport. Once, at `init`. */
export async function registerCastRelay() {
  if (registered) return;
  registered = true;
  const { registerHandler } = await import("../lib/sockets.mjs");
  registerHandler(CAST_APPLY_HANDLER, magicCastRelay);
  registerHandler(CAST_UNDO_HANDLER, magicCastUndo);
}
