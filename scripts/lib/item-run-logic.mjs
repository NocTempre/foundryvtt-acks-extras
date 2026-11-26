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
import { FLAG_ENDS_ON, FLAG_FUSE, FLAG_ITEM_RUN, FLAG_ROLL_MODS, FLAG_TURN_LIFE, FLAG_TURN_MARK, MODULE_ID, MORALE_ROLL_KEY } from "./constants.mjs";
import { ITEM_RUN_ACTIVATIONS, ITEM_TYPE } from "./vocab.mjs";
import { turnLifeStep } from "./turn-life.mjs";
import { conditionEffectId } from "./status-effects.mjs";
import { numOrNull } from "./util.mjs";
import { stackCountOf } from "./item-model.mjs";
import { namesFigure, readReach, resolveFigure } from "./aura-reach-logic.mjs";
import { isAutoFail, isAutoSucceed } from "./throws.mjs";
import { amountAfter } from "./hp-logic.mjs";

/* -------------------------------------------- */
/*  Reading an item                              */
/* -------------------------------------------- */

/** The flag an item carries, whichever way the document or its data hands flags over. */
const flagsOf = (item, key) => item?.flags?.[MODULE_ID]?.[key] ?? item?.getFlag?.(MODULE_ID, key);

/** A stored toggle state as `{active, activationId, regionId}`; none stored is down. */
function readState(raw) {
  return { active: raw?.active === true, activationId: String(raw?.activationId ?? ""), regionId: String(raw?.regionId ?? "") };
}

/** A stored swig count as a finite integer, or null: a blank, a fraction or no number is uncounted, and a typed numeral reads as its number. */
const leftOf = (raw) => {
  const n = numOrNull(raw);
  return n !== null && Number.isInteger(n) ? n : null;
};

/**
 * Where a stored swig count came from, as `{by: "roll", formula, total}` (rolled
 * from the item's dice when it reached an actor) or `{by: "hand"}` (typed on a
 * row); null for anything else, a roll with no formula or no whole total included.
 */
function leftFromOf(raw) {
  if (raw?.by === "hand") return { by: "hand" };
  if (raw?.by !== "roll") return null;
  const formula = typeof raw.formula === "string" ? raw.formula.trim() : "";
  const total = numOrNull(raw.total);
  return formula && total !== null && Number.isInteger(total) ? { by: "roll", formula, total } : null;
}

/**
 * A stored `itemRun` flag as `{activation, rows}`, or null where it holds no
 * activation of a known kind. The figures a fuse and a counted item name stay
 * figure references (`resolveFigure` reads them live). A fuse also names the
 * proficiency its light rides on, the bomb sizes by breed (`sizes`), the blast
 * rows by size (`blast`) and `variant`, the breed key that indexes `sizes` (a
 * trimmed string, "" where none is stored). A `consume` activation also answers
 * `left`, the swigs it has left (a finite integer, null where uncounted),
 * `leftFrom`, where that count came from (`{by: "roll", formula, total}`,
 * `{by: "hand"}` or null), and `bearerUuid`, the uuid of the actor that last took the item ("" where none);
 * `uses` is the figure reference its count is rolled from.
 *
 * @param {object} [raw]
 * @returns {{activation: {kind: string, state: {active: boolean, activationId: string, regionId: string}, throw: object|null, fumble: object|null, fuseDice: object|null, proficiency: object|null, sizes: object|null, blast: object|null, variant: string, uses: object|null, left?: number|null, leftFrom?: {by: string, formula?: string, total?: number}|null, bearerUuid?: string}, rows: object[]}|null}
 */
export function readItemRun(raw) {
  const kind = raw?.activation?.kind;
  if (!(kind in ITEM_RUN_ACTIVATIONS)) return null;
  const figure = (key) => (raw.activation[key] && typeof raw.activation[key] === "object" ? raw.activation[key] : null);
  return {
    activation: {
      kind,
      state: readState(raw.activation.state),
      throw: figure("throw"),
      fumble: figure("fumble"),
      fuseDice: figure("fuseDice"),
      proficiency: figure("proficiency"),
      sizes: figure("sizes"),
      blast: figure("blast"),
      variant: typeof raw.activation.variant === "string" ? raw.activation.variant.trim() : "",
      uses: figure("uses"),
      ...(kind === "consume" ? { left: leftOf(raw.activation.left), leftFrom: leftFromOf(raw.activation.leftFrom), bearerUuid: typeof raw.activation.bearerUuid === "string" ? raw.activation.bearerUuid.trim() : "" } : {}),
    },
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
 * Whether an item's reaches are always on: the item resolves, is no spell and
 * carries no `itemRun.activation`, so nothing toggles or uses it and its
 * Regions are the module's to make and lift (`ensureEngagedReaches`), not a
 * press's.
 */
/** The activation kinds that spend one of the item's count when pressed; a count of none leaves them used up. Any other kind, a once-only item included, spends one only where its activation names `uses`. */
export const SPENDING_KINDS = Object.freeze(["fuse", "consume"]);

/**
 * Whether a run item is used up: its activation spends a count (a spending kind, or any kind that names
 * `uses`), the item carries a count, and the count is none; or it is a `consume` item whose own `left`
 * is a number at or below none. Never true of a raised item, which must stay lowerable, nor of an item
 * that is not a run item.
 */
export function itemRunUsedUp(item) {
  const activation = itemRunOf(item)?.activation;
  if (!activation || activation.state?.active) return false;
  if (activation.kind === "consume" && activation.left !== null && activation.left <= 0) return true;
  if (!SPENDING_KINDS.includes(activation.kind) && !activation.uses) return false;
  const count = stackCountOf(item);
  return count !== null && count <= 0;
}

export const alwaysOn = (item) => !!item && item.type !== ITEM_TYPE.spell && !itemRunOf(item);

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
 * it), its row, `dueAt` where the record ends on the world clock, `managed`
 * (what a recall drops from a body), and, on a record kept under a fixed id,
 * the `cardId` and the `entryKey` that wrote it (`undoGuard` reads them).
 */
export const recordFlags = ({ source, activationId, rowKey, dueAt = null, cardId = "", entryKey = "" }, extra = {}) => ({
  [FLAG_ITEM_RUN]: { source, activationId, rowKey, ...(numOrNull(dueAt) !== null ? { dueAt: numOrNull(dueAt) } : {}), ...(cardId ? { cardId } : {}), ...(entryKey ? { entryKey } : {}) },
  managed: true,
  ...extra,
});

/** The page reference an item carries from the importer (`cookbook.cite`), or "". */
export const itemCite = (item) => String(flagsOf(item, "cookbook")?.cite ?? "");

/**
 * A condition record: the status data of the catalogue key the row names, owned
 * by the item. `life` is either `{turnLife: {combatId, combatantId, edge,
 * count}}` (ends with a combatant's turns), `{dueAt}` (ends when the world
 * clock reaches it, `liftDueRecords`) or `{mark: true}` (written outside a
 * fight: it carries a turn mark, which lib's turn start lifts at the subject's
 * first initiative in a fight); with none the record stands until the
 * activation's Region goes. No core duration is written. `id` keeps the record
 * under a fixed `_id` (`lastsRecordId`), with the `cardId` and `entryKey` that
 * wrote it.
 */
export function conditionRecordData({ statusData, source, activationId, rowKey, life = {}, id = "", cardId = "", entryKey = "" }) {
  const own = { ...(statusData.flags?.[MODULE_ID] ?? {}) };
  return {
    ...statusData,
    ...(id ? { _id: id } : {}),
    origin: source,
    flags: { ...(statusData.flags ?? {}), [MODULE_ID]: { ...own, ...recordFlags({ source, activationId, rowKey, dueAt: life.dueAt, cardId, entryKey }, life.turnLife ? { [FLAG_TURN_LIFE]: life.turnLife } : life.mark ? { [FLAG_TURN_MARK]: { edge: "start" } } : {}) } },
  };
}

/**
 * An immunity window: no status, one `immune` part naming the item kind's key,
 * and the world-clock moment it ends (`dueAt`, `liftDueRecords`). The key is the
 * kind's and never the bearer's, so one pass covers every such item on the
 * field. `activationId` is the id of the card that wrote the window, never the
 * raised activation's, so lowering the item lifts the condition and leaves the
 * window. `cite` is the item's page reference. `id` keeps the window under a
 * fixed `_id` (`immuneRecordId`), with the `cardId` and `entryKey` that wrote it.
 */
export function immunityRecordData({ name, spellKey, source, activationId, rowKey, dueAt = null, cite = "", id = "", cardId = "", entryKey = "" }) {
  return {
    ...(id ? { _id: id } : {}),
    name,
    origin: source,
    flags: { [MODULE_ID]: { ...recordFlags({ source, activationId, rowKey, dueAt, cardId, entryKey }), [FLAG_ROLL_MODS]: { id: spellKey, label: name, cite, sourceAlignment: null, parts: [{ on: "immune", spells: [spellKey] }] } } },
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

/**
 * The fixed `_id` of the condition a failed save of a row with `reach.lasts`
 * writes, one per item kind: a later failure replaces it. The first condition of
 * the row takes `itemRun:<kind>:lasts`; a row that names more takes one id each,
 * suffixed with the condition's key, so the records never share one.
 */
export const lastsRecordId = (kindKey, status = "", index = 0) => conditionEffectId(index === 0 || !status ? `itemRun:${kindKey}:lasts` : `itemRun:${kindKey}:lasts:${status}`);

/** The fixed `_id` of the immunity window a passed save of a row with `reach.lasts` writes, one per item kind: a later pass replaces it. */
export const immuneRecordId = (kindKey) => conditionEffectId(`itemRun:${kindKey}:immune`);

/**
 * Which of an Undo's stored ids it may delete: an id whose record carries an
 * `entryKey` (one kept under a fixed id, which a later entry may have replaced)
 * only where that key is this entry's; a record with none is the entry's own and
 * stays. `byId` maps an id to the record now on the subject.
 *
 * @param {string[]} ids
 * @param {(id: string) => object|undefined} byId
 * @param {string} entryKey
 * @returns {string[]}
 */
export function undoGuard(ids, byId, entryKey) {
  return (ids ?? []).filter((id) => {
    const kept = runFlagOf(byId(id))?.entryKey;
    return !kept || kept === entryKey;
  });
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
 *
 * An entry that took hit points also stores `hp: [{uuid, amount}]`, `amount`
 * the hit points the press took from the subject (negative where it gave them).
 * The plan's `hp` is each of those reversed, `amount` negated and so the hit
 * points to give back, in the order stored; an entry with none, an amount that
 * is no number and an amount of zero reverse nothing.
 * @param {{recordIds?: string[], hp?: Array<{uuid: string, amount: number}>}} entry
 * @param {Iterable<string>} existingIds the ids on the subject now
 * @returns {{ids: string[], gone: string[], hp: Array<{uuid: string, amount: number}>}}
 */
export function undoPlan(entry, existingIds) {
  const have = new Set(existingIds ?? []);
  const stored = [...new Set(entry?.recordIds ?? [])];
  const hp = (Array.isArray(entry?.hp) ? entry.hp : [])
    .map((taken) => ({ uuid: String(taken?.uuid ?? ""), amount: numOrNull(taken?.amount) }))
    .filter((taken) => taken.uuid && taken.amount !== null && taken.amount !== 0)
    .map((taken) => ({ uuid: taken.uuid, amount: -taken.amount }));
  return { ids: stored.filter((id) => have.has(id)), gone: stored.filter((id) => !have.has(id)), hp };
}

/**
 * The figures a row's reach names, resolved now through `read` (the registry by
 * default): `radius` and `modifier` as numbers, `immunityTurns` as a number,
 * `save` as the save's name (the reach's own reference, else the row's `target`
 * for a Judge's own item), `on` the roll kinds, `saveWhen` what the save part is narrowed to. Each is null where nothing
 * resolves; nothing stands in for a figure nobody imported or wrote.
 *
 * `lasts` is the turns a failed save's condition holds, and `lastsNamed` whether
 * the row names that figure at all, resolved or not: a row that names one is
 * timed, and a blank figure on it is a blank, never the other kind of row.
 *
 * `fraction` is the share of an amount a passed save leaves, a number or null.
 *
 * @returns {{radius: number|null, modifier: number|null, fraction: number|null, immunityTurns: number|null, lasts: number|null, lastsNamed: boolean, save: string|null, on: string[], saveWhen: {when: string, magical: boolean}|null}|null} null for a row with no reach
 */
export function reachFigures(row, read) {
  const reach = readReach(row?.reach);
  if (!reach) return null;
  const num = (ref) => numOrNull(resolveFigure(ref, read));
  const saveName = resolveFigure(reach.save, read) ?? row?.target;
  return { radius: num(reach.radius), modifier: num(reach.modifier), fraction: num(reach.fraction), immunityTurns: num(reach.immunity), lasts: num(reach.lasts), lastsNamed: namesFigure(reach.lasts), save: saveName ? String(saveName) : null, on: reach.on, saveWhen: reach.saveWhen };
}

/**
 * The `rollMods` parts a reach's modifier writes: one per roll kind named in
 * `on`, each worth `value`. `morale` is a `reaction` part that names the
 * morale roll (`MORALE_ROLL_KEY`), so a reaction roll never reads it; the
 * other keys are `ROLL_MODS_ON` keys as they stand. The `save` part alone
 * carries `saveWhen`'s `when` and `magical` (`roll-mods.mjs` `narrow`), so it is
 * told on every throw and applied only where a caller names the circumstance.
 * No parts for a blank figure.
 *
 * @param {string[]} on
 * @param {number|null} value
 * @param {{when?: string, magical?: boolean}|null} [saveWhen]
 */
export function reachParts(on, value, saveWhen = null) {
  const figure = numOrNull(value);
  if (figure === null) return [];
  const narrowing = saveWhen ? { ...(saveWhen.when ? { when: saveWhen.when } : {}), ...(saveWhen.magical === true ? { magical: true } : {}) } : {};
  return (on ?? []).map((key) => {
    if (key === "morale") return { on: "reaction", key: "morale", rollKey: MORALE_ROLL_KEY, value: figure };
    return { on: key, value: figure, ...(key === "save" ? narrowing : {}) };
  });
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

/** The one key an item kind is recorded under: the importer's entry id, else the row's key. Two items of one kind share it, whoever bears them. */
export const kindKeyOf = (item, row) => String(flagsOf(item, "cookbook")?.id ?? row?.key ?? "");

/**
 * Whether a user may undo an entry: the seat that applied it (`entry.presser`)
 * and the owners of the subject's token, which Foundry's ownership says (GMs
 * among them). No role is read.
 *
 * @param {{presser?: string}|null} entry
 * @param {string|null|undefined} userId
 * @param {string[]} subjectOwnerIds
 */
export const mayUndoEntry = (entry, userId, subjectOwnerIds = []) => !!entry && !!userId && (entry.presser === userId || subjectOwnerIds.includes(userId));

/** The entry a card holds under a key, or null. */
export const entryOf = (card, key) => card?.entries?.[key] ?? null;

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
 * @param {{requestUserId?: string|null, total?: *, target?: *, declared?: boolean}} req
 * A subject that is `waiting` (listed, its moment not come) is pressed only where
 * `world.judge` (`judgeDeclares(requestUserId)`) holds, and it goes through as an
 * `early` press; any other seat is
 * refused `waiting`. An entry the card no longer holds is `struck`. A row that
 * names `reach.lasts` and holds no figure for it (`world.blankLasts`) refuses a
 * press from any seat but the Judge's own, which writes the condition untimed.
 *
 * A declared press (`req.declared` a boolean: the verdict the Judge calls on a card
 * that names no save, which the caller admits only for such a card) rolls nothing.
 * It goes through only where `world.judge` holds (any other seat is refused
 * `judgeOnly`), skips the target and total checks, and answers `total` and `target`
 * null, `saved` the declared verdict and `declared: true`. Every check above stands
 * for it, ownership and the entry's state included.
 *
 * @param {{item: object|null, row: object|null, subjectOwnerIds?: string[], target: *, entryState?: string, waiting?: boolean, judge?: boolean, struck?: boolean, blankLasts?: boolean}} world
 * @returns {{ok: true, total: number|null, target: number|null, saved: boolean, early: boolean, declared?: true}|{ok: false, reason: string}}
 */
export function checkPressRequest(req, world) {
  if (!world?.item) return { ok: false, reason: "gone" };
  if (!world.row) return { ok: false, reason: "noRow" };
  if (req?.requestUserId && !(world.subjectOwnerIds ?? []).includes(req.requestUserId)) return { ok: false, reason: "notOwner" };
  if (world.struck) return { ok: false, reason: "struck" };
  if (world.waiting && world.judge !== true) return { ok: false, reason: "waiting" };

  if (world.entryState && world.entryState !== "open") return { ok: false, reason: "applied" };
  if (typeof req?.declared === "boolean") {
    if (world.judge !== true) return { ok: false, reason: "judgeOnly" };
    return { ok: true, total: null, target: null, saved: req.declared, early: world.waiting === true, declared: true };
  }
  if (world.blankLasts === true && world.judge !== true) return { ok: false, reason: "noFigure" };
  const target = numOrNull(world.target);
  if (target === null) return { ok: false, reason: "noFigure" };
  if (numOrNull(req?.target) !== target) return { ok: false, reason: "figure" };
  const total = numOrNull(req?.total);
  if (total === null) return { ok: false, reason: "noRoll" };
  return { ok: true, total, target, saved: total >= target, early: world.waiting === true };
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
 * A bearer that is down does not stop it: the fuse burns at its spot. A spot
 * whose scene is gone bursts nothing, and the burst says so (`burstFuse`).
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
  return { source: record.source, activationId: record.activationId, spot: record.spot, dueAt: worldDueAt(rounds, now, roundSeconds) };
}

/** The world-clock moment `rounds` rounds of `roundSeconds` end, counted from `now`; one reading for every fuse put on the world clock. */
const worldDueAt = (rounds, now, roundSeconds) => Math.ceil(now + Math.max(rounds, 0) * roundSeconds);

/**
 * A fuse lit outside a fight, on the world clock: `{source, activationId, spot,
 * dueAt}` as `readFuse` reads it, due `rounds` rounds from `now`, each
 * `roundSeconds` long (the same arithmetic `fuseToWorld` uses). Null where the
 * rounds, the reading of the clock or the round's length is no number, or the
 * round is no positive length.
 *
 * @param {{source: string, activationId: string, spot: object, rounds: number, now: number, roundSeconds: number}} p
 */
export function fuseWorldFlag({ source, activationId, spot, rounds, now, roundSeconds }) {
  const count = numOrNull(rounds);
  const start = numOrNull(now);
  const unit = numOrNull(roundSeconds);
  if (count === null || start === null || unit === null || unit <= 0) return null;
  return { source, activationId, spot, dueAt: worldDueAt(count, start, unit) };
}

/**
 * Whether an item is lit on an actor, and for how long, read off the actor's
 * effects: `{roundsLeft, combat, dueAt}` for the fuse the item lit that burns
 * out first, or null where none is. On the combat clock `combat` is true and
 * `roundsLeft` the bearer's turns it still burns (`count - seen`), `dueAt` null;
 * on the world clock `combat` is false, `roundsLeft` null and `dueAt` the moment
 * it is due. A fuse on the combat clock reads before one on the world's, since a
 * count of turns and a moment do not compare.
 *
 * @param {Iterable<{flags?: object}>|null|undefined} effects the actor's Active Effects
 * @param {string} itemUuid the lit item's uuid
 * @returns {{roundsLeft: number|null, combat: boolean, dueAt: number|null}|null}
 */
export function litStateOf(effects, itemUuid) {
  const records = [...(effects ?? [])].map((effect) => readFuse(effect?.flags?.[MODULE_ID]?.[FLAG_FUSE])).filter((record) => record && record.source === itemUuid);
  const counted = records.filter((record) => record.clock).map((record) => Math.max(record.clock.count - record.clock.seen, 0));
  if (counted.length) return { roundsLeft: Math.min(...counted), combat: true, dueAt: null };
  const due = records.filter((record) => "dueAt" in record).map((record) => record.dueAt);
  return due.length ? { roundsLeft: null, combat: false, dueAt: Math.min(...due) } : null;
}

/**
 * How many fuses an item has lit on an actor: the count of the actor's fuse
 * records whose source is the item, on either clock. A stack that holds more than
 * this has a spare to light.
 *
 * @param {Iterable<{flags?: object}>|null|undefined} effects the actor's Active Effects
 * @param {string} itemUuid the lit item's uuid
 * @returns {number}
 */
export function litCountOf(effects, itemUuid) {
  return [...(effects ?? [])].filter((effect) => readFuse(effect?.flags?.[MODULE_ID]?.[FLAG_FUSE])?.source === itemUuid).length;
}

/**
 * What a light does to an item whose every unit already burns: "light" where
 * the stack holds a spare (fewer lit than held; an item with no count holds
 * one), else "warn" for the Judge's own seat, which lights another anyway, and
 * "refuse" for any other seat. Each light writes its own fuse record against the
 * item and a burst uses up one, so a light past the stack would leave a record
 * with nothing to burst.
 *
 * @param {{lit: number, held: number|null, judge: boolean}} p
 * @returns {"light"|"warn"|"refuse"}
 */
export function secondLight({ lit = 0, held = null, judge = false } = {}) {
  const units = Number.isFinite(held) ? held : 1;
  if (!(lit > 0) || units > lit) return "light";
  return judge ? "warn" : "refuse";
}

/* -------------------------------------------- */
/*  The light and the burst                      */
/* -------------------------------------------- */

/**
 * The blast a bomb of one breed's size deals: `{dice, radius, types}` or null.
 * `sizes` maps a breed key to the bomb's size and `blast` lists rows `{lb, dice,
 * radius, types}`, joined to the size on `lb`. `types` is the damage types the
 * row names, `[]` where an older import wrote none. Null where the variant, its
 * size, the matching row, or that row's dice or radius is blank; nothing stands
 * in for a figure nobody imported. The inputs are resolved figure values.
 *
 * @param {{sizes: Record<string, number|string>|null, blast: Array<{lb: number|string, dice: string, radius: number|string, types?: string[]}>|null, variant: string}} p
 * @returns {{dice: string, radius: number, types: string[]}|null}
 */
export function blastOf({ sizes, blast, variant }) {
  const key = String(variant ?? "").trim();
  if (!key || !sizes || typeof sizes !== "object" || !Array.isArray(blast)) return null;
  const size = numOrNull(sizes[key]);
  if (size === null) return null;
  const row = blast.find((r) => numOrNull(r?.lb) === size);
  const dice = String(row?.dice ?? "").trim();
  const radius = numOrNull(row?.radius);
  if (!row || !dice || radius === null) return null;
  return { dice, radius, types: Array.isArray(row.types) ? row.types.map((t) => String(t)) : [] };
}

/**
 * What the proficiency throw that lights a fuse did: `fumble` (the unmodified
 * roll is at or below the imported `fumble` figure, the highest natural result
 * that fumbles), `lit`, or `unlit`; null where the Judge decides, since the
 * fumble figure is blank or the throw is settled by a target that is. The
 * natural die answers first, as `throws.mjs` reads it: an automatic failure is
 * `unlit` and an automatic success, which only a `proficient` bearer has, is
 * `lit`, neither consulting the target. Any other result is `total` against
 * `target`, a hit lighting it.
 *
 * @param {{natural: number, total: number, target: number|null, fumble: number|null, proficient: boolean}} p
 * @returns {"fumble"|"lit"|"unlit"|null}
 */
export function fuseLight({ natural, total, target, fumble, proficient }) {
  const roll = numOrNull(natural);
  const edge = numOrNull(fumble);
  if (roll === null || edge === null) return null;
  if (roll <= edge) return "fumble";
  if (isAutoFail(roll) === true) return "unlit";
  if (isAutoSucceed(roll, { proficient }) === true) return "lit";
  const goal = numOrNull(target);
  const made = numOrNull(total);
  if (goal === null || made === null) return null;
  return made >= goal ? "lit" : "unlit";
}

/**
 * The amount a burst's roll does to one subject: `{amount, judge}`. The damage is
 * rolled once and every subject takes `rolled`, a subject that `saved` having it
 * reduced by the save's `reduction` (the share a passed save takes off, so it
 * keeps `1 - reduction`), then each of `stages` (`amountAfter`). A saved subject
 * with no reduction, and a stage the module does not compute, are the Judge's:
 * `{amount: null, judge: true}`.
 *
 * @param {{rolled: number, saved: boolean, reduction: number|null, stages?: Array<Function|object|null>}} p
 * @returns {{amount: number|null, judge: boolean}}
 */
export function burstAmount({ rolled, saved, reduction, stages = [] }) {
  const off = numOrNull(reduction);
  if (saved && off === null) return { amount: null, judge: true };
  const out = amountAfter(rolled, { fraction: saved ? 1 - off : 1, stages });
  if (out.judge || out.applied === null) return { amount: null, judge: true };
  return { amount: out.applied, judge: false };
}

/** The fuse flag key, named once for the writer and the steppers. */
export const FUSE_KEY = FLAG_FUSE;

/**
 * Where a fuse bursts, `{sceneId, x, y, elevation, level}` as `readFuse` carries it:
 * every key written, so an update that replaces the spot never leaves an earlier
 * `level` behind. Null where the scene is blank or a position is no number;
 * `elevation` is 0 and `level` "" where none is given.
 *
 * @param {{sceneId: string, x: number, y: number, elevation?: number, level?: string}} p
 * @returns {{sceneId: string, x: number, y: number, elevation: number, level: string}|null}
 */
export function fuseSpot({ sceneId, x, y, elevation = 0, level = "" } = {}) {
  const px = numOrNull(x);
  const py = numOrNull(y);
  if (!sceneId || px === null || py === null) return null;
  return { sceneId: String(sceneId), x: px, y: py, elevation: numOrNull(elevation) ?? 0, level: level ? String(level) : "" };
}

/** The Active Effect data of a lit fuse on its bearer: named for the item, owned by it, carrying the fuse flag (`FUSE_KEY`) and nothing else the runner reads. */
export const fuseRecordData = ({ name, source, flag }) => ({ name, origin: source, flags: { [MODULE_ID]: { [FUSE_KEY]: flag } } });

/**
 * The bearer's standing share of a proficiency throw, from the modifier sources
 * `abilities/ability-rolls.mjs` `targetModifiers` lists (`[{kind, label, value,
 * parts?}]`): `{bonus, parts}`, `bonus` the sum, `parts` one `{label, value, cite}`
 * per contributing ability, or per source where it names none. A bonus lowers the
 * target an "above" throw is read against; it is never added to the die.
 *
 * @param {Array<{kind?: string, label?: string, value: number, parts?: Array<{label: string, value: number, cite?: string}>}>} sources
 * @returns {{bonus: number, parts: Array<{label: string, value: number, cite: string}>}}
 */
export function proficiencyBonus(sources) {
  const kept = (Array.isArray(sources) ? sources : []).filter((s) => numOrNull(s?.value));
  const parts = kept.flatMap((s) => (s.parts?.length ? s.parts.map((p) => ({ label: String(p.label ?? ""), value: numOrNull(p.value) ?? 0, cite: String(p.cite ?? "") })) : [{ label: String(s.label ?? ""), value: numOrNull(s.value) ?? 0, cite: "" }]));
  return { bonus: kept.reduce((sum, s) => sum + numOrNull(s.value), 0), parts: parts.filter((p) => p.value) };
}

/**
 * Whether a seat may apply a burst card's entry, and why not: the entry must
 * hold a verdict and no write yet (`rolled`), and the seat must be one of the
 * owners of the subject (`subjectOwnerIds`, Foundry's own test; a GM owns
 * everything), `requestUserId` being the relayed sender. A Judge's own press
 * carries none and is read as the Judge's.
 *
 * @param {{state?: string}|null} entry
 * @param {{requestUserId?: string|null, subjectOwnerIds?: string[], judge?: boolean}} p
 * @returns {{ok: true}|{ok: false, reason: "gone"|"applied"|"noVerdict"|"notOwner"}}
 */
export function checkApplyRequest(entry, { requestUserId = null, subjectOwnerIds = [], judge = false } = {}) {
  if (!entry) return { ok: false, reason: "gone" };
  if (entry.state === "applied" || entry.state === "undone" || entry.state === "judge") return { ok: false, reason: "applied" };
  if (entry.state !== "rolled") return { ok: false, reason: "noVerdict" };
  if (requestUserId ? !subjectOwnerIds.includes(requestUserId) : !judge) return { ok: false, reason: "notOwner" };
  return { ok: true };
}

/**
 * The update that counts a row's bearer in as a subject of its own reach
 * (`filter.self` is `count`), or back out (`no`, with `counted` false):
 * `{path, value}` for `item.update`, the row list rewritten whole where the
 * item keeps its rows (an ability's `extras.effects`, any other item's
 * `itemRun.rows`), or null where the item has no such row.
 *
 * @param {object} item
 * @param {string} rowKey
 * @param {boolean} [counted] true counts the bearer in, false counts it out
 */
export function selfCountUpdate(item, rowKey, counted = true) {
  const rows = itemRunRowsOf(item);
  if (!rows.some((r) => r?.key === rowKey && r.reach)) return null;
  const value = rows.map((r) => (r?.key === rowKey ? { ...r, reach: { ...r.reach, filter: { ...(r.reach.filter ?? {}), self: counted ? "count" : "no" } } } : r));
  return { path: item?.type === ITEM_TYPE.ability ? `flags.${MODULE_ID}.extras.effects` : `flags.${MODULE_ID}.${FLAG_ITEM_RUN}.rows`, value };
}
