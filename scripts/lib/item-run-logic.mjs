/**
 * The pure half of the item runner: an item that acts when it is used or while
 * it is raised, whose rows (`effectField`) say what it does, whose reach says
 * who it meets, and whose records the carrier writes on its subjects.
 *
 * An item carries `flags["acks-extras"].itemRun = {activation, rows}`: the
 * activation (`once`, `toggle`, `fuse` or `consume`, with the figures a fuse and
 * a counted item name) and its rows. An ability keeps its rows where they are, in
 * `extras.effects`, and takes no activation. Every record the runner writes is an
 * Active Effect marked `managed` and carrying `flags["acks-extras"].itemRun =
 * {source, activationId, rowKey}`, so the Region's deletion lifts all of an
 * activation's records and an Undo removes a card row's own ids. Foundry-free.
 */
import { FLAG_ENDS_ON, FLAG_FUSE, FLAG_ITEM_RUN, FLAG_ROLL_MODS, FLAG_TURN_LIFE, MODULE_ID, MORALE_ROLL_KEY } from "./constants.mjs";
import { ITEM_RUN_ACTIVATIONS, ITEM_TYPE } from "./vocab.mjs";
import { turnLifeStep } from "./turn-life.mjs";
import { conditionEffectId } from "./status-effects.mjs";
import { numOrNull } from "./util.mjs";
import { readReach, resolveFigure } from "./aura-reach-logic.mjs";

/* -------------------------------------------- */
/*  Reading an item                              */
/* -------------------------------------------- */

/** The flag an item carries, whichever way the document or its data hands flags over. */
const flagsOf = (item, key) => item?.flags?.[MODULE_ID]?.[key] ?? item?.getFlag?.(MODULE_ID, key);

/** A stored toggle state as `{active, activationId, regionId}`; none stored is down. */
function readState(raw) {
  return { active: raw?.active === true, activationId: String(raw?.activationId ?? ""), regionId: String(raw?.regionId ?? "") };
}

/**
 * A stored `itemRun` flag as `{activation, rows}`, or null where it holds no
 * activation of a known kind. The figures a fuse and a counted item name stay
 * figure references (`resolveFigure` reads them live).
 *
 * @param {object} [raw]
 * @returns {{activation: {kind: string, state: {active: boolean, activationId: string, regionId: string}, throw: object|null, fumble: object|null, fuseDice: object|null, uses: object|null}, rows: object[]}|null}
 */
export function readItemRun(raw) {
  const kind = raw?.activation?.kind;
  if (!(kind in ITEM_RUN_ACTIVATIONS)) return null;
  const figure = (key) => (raw.activation[key] && typeof raw.activation[key] === "object" ? raw.activation[key] : null);
  return {
    activation: { kind, state: readState(raw.activation.state), throw: figure("throw"), fumble: figure("fumble"), fuseDice: figure("fuseDice"), uses: figure("uses") },
    rows: Array.isArray(raw.rows) ? raw.rows : [],
  };
}

/** The item's `itemRun` read, or null for an item with none (a spell never has one read). */
export const itemRunOf = (item) => (item?.type === ITEM_TYPE.spell ? null : readItemRun(flagsOf(item, FLAG_ITEM_RUN)));

/**
 * The one row list an item's kind has: an ability's `extras.effects`, any other
 * item's `itemRun.rows`. An empty list for an item with neither.
 * @returns {object[]}
 */
export function itemRunRowsOf(item) {
  if (item?.type === ITEM_TYPE.ability) {
    const rows = flagsOf(item, "extras")?.effects;
    return Array.isArray(rows) ? [...rows] : [];
  }
  const rows = flagsOf(item, FLAG_ITEM_RUN)?.rows;
  return Array.isArray(rows) ? [...rows] : [];
}

/**
 * Whether the carrier takes an item's use: the item is no spell and its
 * `itemRun.activation` is a kind some runner is registered for. A spell is
 * declined whatever it carries, so `_useSpell` and the cast engine's claimant
 * are reached as they were; so is an ability with no activation and an
 * unflagged item.
 *
 * @param {object} item
 * @param {Iterable<string>} runnable the activation kinds a runner is registered for
 */
export function claimsItemUse(item, runnable) {
  if (!item || item.type === ITEM_TYPE.spell) return false;
  const run = itemRunOf(item);
  return !!run && new Set(runnable).has(run.activation.kind);
}

/**
 * Which token is the bearer's for a use. A token the pressing seat resolved and
 * named is the answer where it is the item's actor's (`carries`), and a refusal
 * (`notCarried`) where it is another body's. With none named, the token on the
 * scene this window views; failing that, the actor's one linked token on any
 * scene (`linked`, read only then), and a refusal where it has none
 * (`noToken`) or several (`manyTokens`), since no scene is the right one.
 *
 * @param {{carried?: object|null, carries?: (token: object) => boolean, canvas?: object|null, linked?: () => object[]}} p
 * @returns {{ok: true, token: object}|{ok: false, reason: "notCarried"|"noToken"|"manyTokens"}}
 */
export function chooseBearerToken({ carried = null, carries = () => true, canvas = null, linked = () => [] } = {}) {
  if (carried) return carries(carried) ? { ok: true, token: carried } : { ok: false, reason: "notCarried" };
  if (canvas) return { ok: true, token: canvas };
  const found = [...linked()];
  if (found.length === 1) return { ok: true, token: found[0] };
  return { ok: false, reason: found.length ? "manyTokens" : "noToken" };
}

/* -------------------------------------------- */
/*  Records                                      */
/* -------------------------------------------- */

/**
 * The flags every record the runner writes carries: its source, its activation
 * (or, for a record that outlives its activation, the id of the card that wrote
 * it), its row, `dueAt` where the record ends on the world clock, and
 * `managed` (what a recall drops from a body).
 */
export const recordFlags = ({ source, activationId, rowKey, dueAt = null }, extra = {}) => ({
  [FLAG_ITEM_RUN]: { source, activationId, rowKey, ...(numOrNull(dueAt) !== null ? { dueAt: numOrNull(dueAt) } : {}) },
  managed: true,
  ...extra,
});

/** The page reference an item carries from the importer (`cookbook.cite`), or "". */
export const itemCite = (item) => String(flagsOf(item, "cookbook")?.cite ?? "");

/**
 * A condition record: the status data of the catalogue key the row names, owned
 * by the item. `life` is either `{turnLife: {combatId, combatantId, edge,
 * count}}` (ends with a combatant's turns) or `{dueAt}` (ends when the world
 * clock reaches it, `liftDueRecords`); with neither the record stands until the
 * activation's Region goes. No core duration is written.
 */
export function conditionRecordData({ statusData, source, activationId, rowKey, life = {} }) {
  const own = { ...(statusData.flags?.[MODULE_ID] ?? {}) };
  return {
    ...statusData,
    origin: source,
    flags: { ...(statusData.flags ?? {}), [MODULE_ID]: { ...own, ...recordFlags({ source, activationId, rowKey, dueAt: life.dueAt }, life.turnLife ? { [FLAG_TURN_LIFE]: life.turnLife } : {}) } },
  };
}

/**
 * An immunity window: no status, one `immune` part naming the item kind's key,
 * and the world-clock moment it ends (`dueAt`, `liftDueRecords`). The key is the
 * kind's and never the bearer's, so one pass covers every such item on the
 * field. `activationId` is the id of the card that wrote the window, never the
 * raised activation's, so lowering the item lifts the condition and leaves the
 * window. `cite` is the item's page reference.
 */
export function immunityRecordData({ name, spellKey, source, activationId, rowKey, dueAt = null, cite = "" }) {
  return {
    name,
    origin: source,
    flags: { [MODULE_ID]: { ...recordFlags({ source, activationId, rowKey, dueAt }), [FLAG_ROLL_MODS]: { id: spellKey, label: name, cite, sourceAlignment: null, parts: [{ on: "immune", spells: [spellKey] }] } } },
  };
}

/** An action part: `rollMods` parts that end with the bearer's next attack. */
export function actionPartRecordData({ name, parts, source, activationId, rowKey, cite = "" }) {
  return {
    name,
    origin: source,
    flags: { [MODULE_ID]: { ...recordFlags({ source, activationId, rowKey }, { [FLAG_ENDS_ON]: ["attack"] }), [FLAG_ROLL_MODS]: { id: rowKey, label: name, cite, sourceAlignment: null, parts } } },
  };
}

/** The fixed `_id` of the one standing part of an item kind, so a second bearer's never stacks beside it. */
export const standingPartId = (kindKey) => conditionEffectId(`itemRun:${kindKey}`);

/** A standing part: `rollMods` parts under the kind's one fixed id, written only while a subject stands in a reach of the kind. */
export function standingPartRecordData({ kindKey, name, parts, source, activationId, rowKey, cite = "" }) {
  return {
    _id: standingPartId(kindKey),
    name,
    origin: source,
    flags: { [MODULE_ID]: { ...recordFlags({ source, activationId, rowKey }), [FLAG_ROLL_MODS]: { id: kindKey, label: name, cite, sourceAlignment: null, parts } } },
  };
}

/** The ids of an activation's records among a list of effects (any carrying the activation id). */
export function activationRecordIds(effects, activationId) {
  if (!activationId) return [];
  return [...(effects ?? [])].filter((e) => e?.id && runFlagOf(e)?.activationId === activationId).map((e) => e.id);
}

/**
 * What an Undo removes: exactly the ids its row stored that still exist,
 * never the Region, the activation or the quantity. A row with no ids stored
 * removes nothing.
 * @param {{recordIds?: string[]}} entry
 * @param {Iterable<string>} existingIds the ids on the subject now
 * @returns {{ids: string[], gone: string[]}}
 */
export function undoPlan(entry, existingIds) {
  const have = new Set(existingIds ?? []);
  const stored = [...new Set(entry?.recordIds ?? [])];
  return { ids: stored.filter((id) => have.has(id)), gone: stored.filter((id) => !have.has(id)) };
}

/**
 * The figures a row's reach names, resolved now through `read` (the registry by
 * default): `radius` and `modifier` as numbers, `immunityTurns` as a number,
 * `save` as the save's name (the reach's own reference, else the row's `target`
 * for a Judge's own item), `on` the roll kinds. Each is null where nothing
 * resolves; nothing stands in for a figure nobody imported or wrote.
 *
 * @returns {{radius: number|null, modifier: number|null, immunityTurns: number|null, save: string|null, on: string[]}|null} null for a row with no reach
 */
export function reachFigures(row, read) {
  const reach = readReach(row?.reach);
  if (!reach) return null;
  const num = (ref) => numOrNull(resolveFigure(ref, read));
  const saveName = resolveFigure(reach.save, read) ?? row?.target;
  return { radius: num(reach.radius), modifier: num(reach.modifier), immunityTurns: num(reach.immunity), save: saveName ? String(saveName) : null, on: reach.on };
}

/**
 * The `rollMods` parts a reach's modifier writes: one per roll kind named in
 * `on`, each worth `value`. `morale` is a `reaction` part that names the
 * morale roll (`MORALE_ROLL_KEY`), so a reaction roll never reads it; the
 * other keys are `ROLL_MODS_ON` keys as they stand. No parts for a blank figure.
 *
 * @param {string[]} on
 * @param {number|null} value
 */
export function reachParts(on, value) {
  const figure = numOrNull(value);
  if (figure === null) return [];
  return (on ?? []).map((key) => (key === "morale" ? { on: "reaction", key: "morale", rollKey: MORALE_ROLL_KEY, value: figure } : { on: key, value: figure }));
}

/**
 * The world-clock moment a record of `turns` turns ends, `secondsPerTurn` long
 * each, counted from `now` (`game.time.worldTime`); null for no positive count,
 * turn length or reading of the clock. One clock for every timed record the
 * runner writes.
 */
export function dueAtAfter(turns, secondsPerTurn, now) {
  const count = numOrNull(turns);
  const unit = numOrNull(secondsPerTurn);
  const start = numOrNull(now);
  return count !== null && unit !== null && start !== null && count > 0 && unit > 0 ? start + count * unit : null;
}

/** A record's `itemRun` flag, whichever way the effect hands flags over. */
const runFlagOf = (effect) => effect?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN] ?? effect?.getFlag?.(MODULE_ID, FLAG_ITEM_RUN);

/** The ids, among a list of effects, of the runner's records whose `dueAt` the world clock has reached. */
export function dueRecordIds(effects, worldTime) {
  const now = numOrNull(worldTime);
  if (now === null) return [];
  return [...(effects ?? [])]
    .filter((e) => {
      const due = numOrNull(runFlagOf(e)?.dueAt);
      return !!e?.id && due !== null && now >= due;
    })
    .map((e) => e.id);
}

/** Whether a stored standing part differs from the one wanted: its parts, its source or its name. A part that is absent differs. */
export function standingPartDiffers(existing, wanted) {
  if (!existing) return true;
  const flag = existing.flags?.[MODULE_ID] ?? {};
  const want = wanted.flags[MODULE_ID];
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return !same(flag[FLAG_ROLL_MODS]?.parts, want[FLAG_ROLL_MODS].parts) || !same(flag[FLAG_ITEM_RUN], want[FLAG_ITEM_RUN]) || existing.name !== wanted.name;
}

/** The state a prompt card holds for one subject, `open` where it holds none. */
export const entryStateOf = (card, subject) => card?.entries?.[subject]?.state ?? "open";

/* -------------------------------------------- */
/*  A press, relayed                             */
/* -------------------------------------------- */

/**
 * Whether a relayed press is written, and its verdict. The seat rolled the
 * throw; the primary GM checks the figure against the item's OWN row resolved
 * live, never the request's: `world.target` is what the GM read now, and a
 * request naming another target is refused. A press from a seat that does not
 * own the subject, for an item or row that is gone, or for an entry already
 * applied is refused. A Judge's own press carries no `requestUserId`.
 *
 * @param {{requestUserId?: string|null, total: *, target: *}} req
 * @param {{item: object|null, row: object|null, subjectOwnerIds?: string[], target: *, entryState?: string}} world
 * @returns {{ok: true, total: number, target: number, saved: boolean}|{ok: false, reason: string}}
 */
export function checkPressRequest(req, world) {
  if (!world?.item) return { ok: false, reason: "gone" };
  if (!world.row) return { ok: false, reason: "noRow" };
  if (req?.requestUserId && !(world.subjectOwnerIds ?? []).includes(req.requestUserId)) return { ok: false, reason: "notOwner" };
  if (world.entryState && world.entryState !== "open") return { ok: false, reason: "applied" };
  const target = numOrNull(world.target);
  if (target === null) return { ok: false, reason: "noFigure" };
  if (numOrNull(req?.target) !== target) return { ok: false, reason: "figure" };
  const total = numOrNull(req?.total);
  if (total === null) return { ok: false, reason: "noRoll" };
  return { ok: true, total, target, saved: total >= target };
}

/* -------------------------------------------- */
/*  The card, as data                            */
/* -------------------------------------------- */

/**
 * The model a prompt card is rendered from (`renderRollCard`'s argument): one
 * row per admitted subject with a Roll action, or its outcome once rolled and
 * an Undo for a Judge, then the subjects the filter could not settle, listed
 * with a tick for the Judge. Data only; the words are the caller's, localized.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.subtitle]
 * @param {{roll: string, undo: string, undetermined: string, tick: string, saved: string, failed: string}} p.words
 * @param {Array<{key: string, name: string}>} p.subjects admitted subjects, `key` their subject id
 * @param {Array<{key: string, name: string}>} [p.undetermined] subjects the filter left null
 * @param {Record<string, {state: string, saved?: boolean, total?: number, target?: number, recordIds?: string[]}>} [p.entries] per subject key
 * @param {{itemUuid: string, rowKey: string, activationId: string}} p.ids what an action's buttons name
 * @param {boolean} [p.isGM] shows Undo and the ticks
 */
export function promptCardModel({ title, subtitle, words, subjects = [], undetermined = [], entries = {}, ids, isGM = false }) {
  const rows = subjects.map(({ key, name }) => {
    const entry = entries[key];
    const base = { name, total: "", data: { ...ids, subject: key } };
    if (!entry || entry.state === "open") return { name, total: "", actions: [{ action: "itemRun.roll", label: words.roll, icon: "fa-solid fa-dice-d20", data: base.data }] };
    const actions = isGM && entry.recordIds?.length ? [{ action: "itemRun.undo", label: words.undo, icon: "fa-solid fa-rotate-left", data: base.data }] : [];
    return {
      name,
      total: entry.total ?? "",
      ...(Number.isFinite(entry.target) ? { target: entry.target } : {}),
      outcome: entry.saved ? words.saved : words.failed,
      emphasis: entry.saved ? "success" : "failure",
      ...(actions.length ? { actions } : {}),
    };
  });
  const sections = [{ rows }];
  if (isGM && undetermined.length) {
    sections.push({
      title: words.undetermined,
      rows: undetermined.map(({ key, name }) => ({ name, total: "", actions: [{ action: "itemRun.tick", label: words.tick, icon: "fa-solid fa-check", data: { ...ids, subject: key } }] })),
    });
  }
  return { title, ...(subtitle ? { subtitle } : {}), sections };
}

/* -------------------------------------------- */
/*  The fuse                                     */
/* -------------------------------------------- */

/**
 * A fuse flag, new, on the bearer's combat clock: `{source, activationId, spot,
 * clock: {combatId, combatantId, edge: "end", count, seen: 0}}`. `spot` is where
 * it bursts, `{sceneId, x, y, elevation, level}`; `count` is the bearer's turns
 * it burns.
 */
export function fuseFlag({ source, activationId, spot, combatId, combatantId, count }) {
  return { source, activationId, spot, clock: { combatId, combatantId, edge: "end", count, seen: 0 } };
}

/**
 * A stored fuse as one of two shapes, or null: on the combat clock, `{source,
 * activationId, spot, clock}`, or on the world clock, `{source, activationId,
 * spot, dueAt}`. A `dueAt` that is present wins.
 */
export function readFuse(raw) {
  if (!raw || typeof raw !== "object" || !raw.source || !raw.activationId || !raw.spot) return null;
  const base = { source: String(raw.source), activationId: String(raw.activationId), spot: raw.spot };
  const dueAt = numOrNull(raw.dueAt);
  if (dueAt !== null) return { ...base, dueAt };
  const clock = raw.clock;
  const count = Math.floor(numOrNull(clock?.count) ?? 0);
  if (!clock?.combatId || !clock?.combatantId || count < 1) return null;
  return { ...base, clock: { combatId: clock.combatId, combatantId: clock.combatantId, edge: "end", count, seen: Math.max(0, Math.floor(numOrNull(clock.seen) ?? 0)) } };
}

/**
 * What one turn event does to a fuse on the combat clock: `{act, seen, record}`,
 * `act` being `none`, `count` (write `seen`) or `burst` (delete, then burst).
 * A bearer that is gone or down does not stop it: the fuse burns at its spot.
 * A fuse on the world clock is never touched by a turn.
 */
export function fuseStep(raw, event) {
  const record = readFuse(raw);
  if (!record?.clock) return { act: "none", seen: 0, record: null };
  const step = turnLifeStep(record.clock, event);
  if (step.lift) return { act: "burst", seen: step.seen, record };
  return { act: step.seen !== record.clock.seen ? "count" : "none", seen: step.seen, record };
}

/** Whether a fuse on the world clock is due at a reading of the clock. */
export function fuseDue(raw, worldTime) {
  const record = readFuse(raw);
  const now = numOrNull(worldTime);
  return !!record && "dueAt" in record && now !== null && now >= record.dueAt;
}

/**
 * A fight ended: a fuse of that fight on the combat clock as the world-clock
 * record, due the rounds it still had to burn from `now`, each `roundSeconds`
 * long (the world's round, an argument so the arithmetic is the caller's one
 * reading). Null for a fuse of another fight or one already on the world clock.
 */
export function fuseToWorld(raw, combatId, { now, roundSeconds }) {
  const record = readFuse(raw);
  if (!record?.clock || record.clock.combatId !== combatId) return null;
  const rounds = Math.max(record.clock.count - record.clock.seen, 0);
  return { source: record.source, activationId: record.activationId, spot: record.spot, dueAt: Math.ceil(now + rounds * roundSeconds) };
}

/** The fuse flag key, named once for the writer and the steppers. */
export const FUSE_KEY = FLAG_FUSE;
