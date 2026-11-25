/**
 * The cards and strips an item raised or pressed draws (canvas 4, boards 4b and
 * 4c), as data: the stored state of a raised card and its moment-keyed entries
 * (`newCard`, the patches that change it), the raised-item card's table (who is
 * in range, how far, the save and its result), the whispered save card, the strip
 * a body in reach reads on its sheet, and the tooltips that say where each
 * figure came from. Words are
 * the caller's, localized; a tooltip is assembled text for `data-tooltip-text`.
 * Foundry-free.
 *
 * A figure's tooltip is one of three, by where it came from: read from an
 * import (`importTip`, the row and the page the importer read it from), computed
 * by the module (`saveTip`, its parts named with the actor's own numbers and the
 * page that prints the procedure), or nothing behind it (`blankTip`, the page
 * reference alone, no number and no words saying it is missing).
 */
import { numOrNull } from "./util.mjs";

/** The tooltip of a figure read from an imported table: the row's label, the figure and the page the importer read it from. Null where there is no page to point at. */
export function importTip({ label, figure, cite }) {
  return cite ? `${label}: ${figure} (${cite})` : null;
}

/** The tooltip of a figure with nothing behind it: the page reference alone, or null where the module ships none. */
export const blankTip = ({ cite }) => (cite ? String(cite) : null);

/**
 * The tooltip of a saving-throw target the module computed: the save's name,
 * the target and the parts that make it (each `{label, value}`, in the actor's
 * own numbers), then the page that prints the procedure.
 *
 * @param {{save: string, target: number, parts?: Array<{label: string, value: number}>, cite?: string}} p
 */
export function saveTip({ save, target, parts = [], cite = "" }) {
  const list = parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : ""}${p.value}`).join(" · ");
  return `${save} ${target}+${list ? `: ${list}` : ""}${cite ? ` (${cite})` : ""}`;
}

/* -------------------------------------------- */
/*  The card's store                             */
/* -------------------------------------------- */

/** A uuid or a moment key as a key of the stored card: the dots a dotted update would split on become `~`. */
export const safeKey = (raw) => String(raw ?? "").replaceAll(".", "~");

/** The key a new entry is stored under: `base`, or `base#2`, `base#3` where one is held (a moment key held outside a fight repeats). */
export function freshKey(entries, base) {
  const held = entries ?? {};
  if (!(base in held)) return base;
  let n = 2;
  while (`${base}#${n}` in held) n += 1;
  return `${base}#${n}`;
}

/**
 * A new card's stored state (`FLAG_ITEM_RUN_CARD`): the item, row and activation
 * it was raised for, the bearer's token, the subjects it lists (keyed by
 * `safeKey` of the token uuid, each `{uuid, name, state, latest}` with `state`
 * `in`, `out` or `notTarget` and `latest` the key of its newest entry) and the
 * entries keyed by moment (`{subject, moment, momentKey, state, saved, total,
 * target, recordIds, names, life, early, whisperId}`, `state` `open`, `applied`
 * or `undone`).
 *
 * @param {{itemUuid: string, rowKey: string, activationId: string, kind?: string, bearer: {uuid: string, name: string}, regionUuid?: string, cardId?: string}} p
 */
export const newCard = ({ itemUuid, rowKey, activationId, kind = "toggle", bearer, regionUuid = "", cardId = "" }) => ({
  itemUuid, rowKey, activationId, kind, cardId, regionUuid, bearer, selfCount: false, lowered: false, subjects: {}, undetermined: {}, entries: {},
});

/** Apply a dotted patch to a card, as the message's update applies it: a `-=` segment deletes the key after it. Returns a new card. */
export function applyPatch(card, patch) {
  const next = structuredClone(card ?? {});
  for (const [path, value] of Object.entries(patch ?? {})) {
    const parts = path.split(".");
    let at = next;
    for (const part of parts.slice(0, -1)) at = at[part.startsWith("-=") ? part.slice(2) : part] ??= {};
    const last = parts.at(-1);
    if (last.startsWith("-=")) delete at[last.slice(2)];
    else at[last] = value;
  }
  return next;
}

/** The patch that lists a subject on the card, as in reach (`state` `in`) or as no target, keeping its newest entry. */
export function patchSubject(card, { uuid, name, state = "in" }) {
  const key = safeKey(uuid);
  return { [`subjects.${key}`]: { uuid, name, state, latest: card?.subjects?.[key]?.latest ?? "" }, [`undetermined.-=${key}`]: null };
}

/** The patch that lists a subject the filter could not settle, for the Judge's tick. */
export const patchUndetermined = (card, { uuid, name }) => (card?.subjects?.[safeKey(uuid)] ? {} : { [`undetermined.${safeKey(uuid)}`]: { uuid, name } });

/** The entries of a subject that are still open. */
const openEntriesOf = (card, uuid) => Object.entries(card?.entries ?? {}).filter(([, e]) => e.subject === uuid && e.state === "open");

/**
 * The patch that asks a subject at a moment: a new open entry under a fresh key,
 * its subject listed as in reach with that entry its newest, and every older
 * open entry of the subject struck (removed). Answers `{key, patch, struck}`
 * (`struck` the entries removed, so the caller releases their held moments).
 *
 * @param {object} card
 * @param {{uuid: string, name: string, moment: string, momentKey: string|null}} p
 */
export function patchPrompt(card, { uuid, name, moment, momentKey }) {
  const key = freshKey(card?.entries, safeKey(momentKey ?? `${uuid}:prompt`));
  const struck = openEntriesOf(card, uuid);
  const patch = {
    [`entries.${key}`]: { subject: uuid, moment, momentKey: momentKey ?? "", state: "open" },
    [`subjects.${safeKey(uuid)}`]: { uuid, name, state: "in", latest: key },
    [`undetermined.-=${safeKey(uuid)}`]: null,
  };
  for (const [old] of struck) patch[`entries.-=${old}`] = null;
  return { key, patch, struck: struck.map(([, e]) => e) };
}

/** The patch that takes a subject out of reach: its row muted and every open entry of it struck. Answers `{patch, struck}`. */
export function patchOut(card, { uuid, name }) {
  const key = safeKey(uuid);
  const struck = openEntriesOf(card, uuid);
  const gone = new Set(struck.map(([old]) => old));
  const kept = Object.keys(card?.entries ?? {}).filter((k) => card.entries[k].subject === uuid && !gone.has(k));
  const patch = { [`subjects.${key}`]: { uuid, name, state: "out", latest: kept.at(-1) ?? "" } };
  for (const [old] of struck) patch[`entries.-=${old}`] = null;
  return { patch, struck: struck.map(([, e]) => e) };
}

/**
 * What a listed subject's row is: `out`, `notTarget`, or by its newest entry
 * `open`, `applied` or `undone`, and `waiting` with none.
 *
 * @returns {"waiting"|"open"|"applied"|"undone"|"out"|"notTarget"}
 */
export function rowStateOf(card, uuid) {
  const sub = card?.subjects?.[safeKey(uuid)];
  if (!sub) return "waiting";
  if (sub.state === "out" || sub.state === "notTarget") return sub.state;
  return card.entries?.[sub.latest]?.state ?? "waiting";
}

/* -------------------------------------------- */
/*  The raised card                              */
/* -------------------------------------------- */

/** One row of the raised card's table as the renderer takes it, for a row the caller has read live. See `reachCardModel`. */
function reachRowOf(r, { words, ids, seat }) {
  const data = { ...ids, subject: r.key };
  const base = { name: r.name, total: "", ...(r.feet === null || r.feet === undefined ? {} : { aside: `${r.feet}′`, ...(r.feetTip ? { asideTooltip: r.feetTip } : {}) }) };
  const mayPress = seat.ownsSubject?.(r.key) === true;
  const target = numOrNull(r.target) !== null ? { target: r.target, ...(r.targetTip ? { targetTooltip: r.targetTip } : {}) } : {};
  const history = r.history ? { tooltipText: r.history } : {};
  switch (r.state) {
    case "out": return { ...base, outcome: words.out, emphasis: "muted" };
    case "notTarget": return { ...base, outcome: words.notTarget, emphasis: "muted" };
    case "waiting": return { ...base, ...history, outcome: words.waiting, actions: seat.judge === true ? [{ action: "itemRun.roll", label: words.save, icon: "fa-solid fa-shield-halved", data, tooltip: words.earlyTip }] : [] };
    case "open": return { ...base, ...history, ...target, outcome: words.asked, actions: mayPress ? [{ action: "itemRun.roll", label: words.save, icon: "fa-solid fa-shield-halved", data: { ...data, entryKey: r.entryKey }, tooltip: words.saveTip }] : [] };
    case "undone": return { ...base, ...history, ...target, outcome: words.undone, emphasis: "muted" };
    default: {
      const entry = r.entry ?? {};
      const undo = seat.mayUndo?.(entry, r.key) === true && entry.recordIds?.length ? [{ action: "itemRun.undo", label: words.undo, icon: "fa-solid fa-rotate-left", data: { ...data, entryKey: r.entryKey }, tooltip: words.undoTip }] : [];
      return {
        ...base, ...history, ...target, total: entry.total ?? "", outcome: entry.saved ? words.saved : words.failed, emphasis: entry.saved ? "success" : "failure",
        ...(undo.length ? { actions: undo } : {}),
      };
    }
  }
}

/**
 * The model a raised-item card (board 4b) is rendered from, for one seat: a
 * section of the bodies in reach (a Judge sees every row, a seat the rows of the
 * tokens it owns), each with its distance as an aside, its save's total and
 * target, its result and its press; a section of the bearer's own row, which is
 * undetermined and not counted until an owner of the item ticks it; a line that
 * names what a failed save wrote and for how long; and the bearer's owners'
 * Check range again and Lower. Data only; the words are the caller's, localized.
 * `seat` reads Foundry's ownership (`ownsSubject(key)`, `ownsBearer`,
 * `ownsItem`, `mayUndo(entry, key)`) and reads no role: a Save is offered by
 * ownership of the body saving, a Judge's seat owning every body. `judge`
 * (`judgeDeclares()`) is read for one control alone, the Judge's own early Save
 * on a waiting row, which warns; a waiting row on any other seat says in words
 * that the save waits for the body's moment and offers no press.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.subtitle]
 * @param {string} [p.note]
 * @param {string} [p.noteTooltip]
 * @param {object} p.words every word and tooltip the card shows (`itemRun.card.*`)
 * @param {Array<{key: string, name: string, state: string, entryKey?: string, entry?: object, feet?: number|null, feetTip?: string, target?: number|null, targetTip?: string, history?: string}>} p.rows
 * @param {{key: string, name: string, counted: boolean, row?: object}} [p.bearer] the bearer's row; `row` is its row where counted
 * @param {string[]} [p.well] the lines of what failed saves wrote
 * @param {{itemUuid: string, rowKey: string, activationId: string}} p.ids
 * @param {{judge?: boolean, ownsSubject?: (key: string) => boolean, ownsBearer?: boolean, ownsItem?: boolean, mayUndo?: (entry: object, key: string) => boolean}} p.seat
 * @param {boolean} [p.lowered] the reach is lowered: no footer
 */
export function reachCardModel({ title, subtitle, note, noteTooltip, words, rows, bearer, well = [], ids, seat = {}, lowered = false }) {
  const mine = (key) => seat.ownsSubject?.(key) === true;
  const sections = [{ rows: rows.filter((r) => mine(r.key)).map((r) => reachRowOf(r, { words, ids, seat })) }];
  if (bearer && (seat.ownsBearer === true || seat.ownsItem === true)) {
    const countOut = seat.ownsItem === true ? [{ action: "itemRun.untick", label: words.countOut, icon: "fa-solid fa-xmark", data: { ...ids, subject: bearer.key }, tooltip: words.countOutTip }] : [];
    const counted = bearer.counted && bearer.row ? reachRowOf({ ...bearer.row, key: bearer.key, name: bearer.name }, { words, ids, seat: { ...seat, ownsSubject: () => seat.ownsBearer === true } }) : null;
    const own = counted
      ? { ...counted, actions: [...(counted.actions ?? []), ...countOut] }
      : { name: bearer.name, total: "", outcome: words.undetermined, emphasis: "muted", actions: seat.ownsItem === true ? [{ action: "itemRun.tick", label: words.tick, icon: "fa-solid fa-check", data: { ...ids, subject: bearer.key }, tooltip: words.tickTip }] : [] };
    sections.push({ title: words.bearer, titleTooltip: words.bearerTip, rows: [own] });
  }
  const shown = well.filter(Boolean);
  const buttons = !lowered && seat.ownsBearer === true
    ? [
        { action: "itemRun.recheck", label: words.check, icon: "fa-solid fa-crosshairs", data: ids, tooltip: words.checkTip },
        { action: "itemRun.lower", label: words.lower, icon: "fa-solid fa-arrow-down", data: ids, tooltip: words.lowerTip },
      ]
    : [];
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(note ? { note } : {}),
    ...(noteTooltip ? { noteTooltip } : {}),
    sections,
    bare: true,
    ...(shown.length ? { footnote: `${words.well}: ${shown.join(" · ")}` } : {}),
    ...(buttons.length ? { buttons } : {}),
    labels: { aside: words.colDistance },
  };
}

/**
 * The whispered save card (board 4c): the item's name, the body, the save's
 * target with its tooltip, what a failure writes, and the Roll the save press for
 * the body's owners and the Judges while its entry is open; once the entry is
 * applied it reads the total, the target and the result, and once undone it says
 * so. The press names the raised card's message and the entry's key.
 *
 * @param {{title: string, subtitle: string, words: object, target: number|null, targetTip?: string|null, ids: object, subject: string, entryKey: string, messageId: string, entry?: object|null, ifFails?: string, canPress?: boolean}} p
 */
export function saveCardModel({ title, subtitle, words, target, targetTip = null, ids, subject, entryKey, messageId, entry = null, ifFails = "", canPress = false }) {
  const tgt = numOrNull(target) !== null ? { target, ...(targetTip ? { targetTooltip: targetTip } : {}) } : {};
  const state = entry?.state ?? "open";
  const line = { name: words.save, total: "", ...tgt };
  if (state === "applied") Object.assign(line, { total: entry.total ?? "", outcome: entry.saved ? words.saved : words.failed, emphasis: entry.saved ? "success" : "failure" });
  else if (state === "undone") Object.assign(line, { outcome: words.undone, emphasis: "muted" });
  else if (canPress) line.actions = [{ action: "itemRun.roll", label: words.rollSave, icon: "fa-solid fa-dice-d20", data: { ...ids, subject, entryKey, messageId }, tooltip: words.saveTip }];
  else line.outcome = words.asked;
  return { title, subtitle, sections: [{ rows: [line] }], bare: true, ...(ifFails ? { footnote: ifFails } : {}) };
}


/* -------------------------------------------- */
/*  The "In reach of" strip                      */
/* -------------------------------------------- */

/** The order a strip lists its rows in: what needs an answer first, what asks nothing last. */
const STRIP_ORDER = ["owed", "waiting", "failed", "always", "immune"];

/**
 * The name of a token as core shows it to a viewer, or null where core shows
 * none: a secret token has no name, `NONE` shows none, and the two owner modes
 * show it to an owner alone. Every other mode names the token. `modes` is
 * `CONST.TOKEN_DISPLAY_MODES`, passed in so this file needs no Foundry.
 *
 * @param {{name: string, displayName: number, isOwner: boolean, isSecret?: boolean}} token
 * @param {{NONE: number, OWNER_HOVER: number, OWNER: number}} modes
 * @returns {string|null}
 */
export function shownTokenName({ name, displayName, isOwner, isSecret = false }, modes) {
  if (isSecret || displayName === modes.NONE) return null;
  if (displayName === modes.OWNER || displayName === modes.OWNER_HOVER) return isOwner ? String(name ?? "") : null;
  return String(name ?? "");
}

/**
 * The turns a timed record has left on the module's own clock (`itemRun.dueAt`
 * against the world time), rounded up to a whole turn; null where it has no
 * `dueAt`, the clock is unread, or it is already due.
 *
 * @param {number|null} dueAt
 * @param {number|null} now `game.time.worldTime`
 * @param {number} secondsPerTurn
 */
export function turnsLeft(dueAt, now, secondsPerTurn) {
  const due = numOrNull(dueAt);
  const at = numOrNull(now);
  const unit = numOrNull(secondsPerTurn);
  if (due === null || at === null || unit === null || unit <= 0 || due <= at) return null;
  return Math.ceil((due - at) / unit);
}

/**
 * The rows of the "In reach of" strip on a body's sheet (board 4c), in the order
 * a body reads them: one per reach that meets it, with the item's name, a tag
 * (`owed`, `waiting`, `failed`, `always` or `immune`), the source token's name,
 * the distance and the reach, each figure with its tooltip, and the figures the
 * tag carries (the save's target and its press, a standing part, the turns an
 * immunity has left). A body no reach meets has no rows, and the strip is absent.
 *
 * @param {Array<{key: string, name: string, tag: string, source: string, feet?: number|null, feetTip?: string, radius?: number|null, radiusTip?: string, cite?: string, target?: number|null, targetTip?: string|null, left?: number|null, leftTip?: string, part?: {value: number, tip: string}|null, press?: object|null}>} reaches
 */
export function stripModel(reaches) {
  const list = (reaches ?? []).filter((r) => STRIP_ORDER.includes(r?.tag));
  const rows = list
    .map((r, at) => ({
      at,
      key: r.key,
      name: r.name,
      tag: r.tag,
      source: r.source ?? "",
      feet: numOrNull(r.feet),
      feetTip: r.feetTip ?? "",
      radius: numOrNull(r.radius),
      radiusTip: r.radiusTip ?? "",
      cite: r.cite ?? "",
      target: numOrNull(r.target),
      targetTip: r.targetTip ?? "",
      left: numOrNull(r.left),
      leftTip: r.leftTip ?? "",
      part: r.part ?? null,
      press: r.press ?? null,
    }))
    .sort((a, b) => STRIP_ORDER.indexOf(a.tag) - STRIP_ORDER.indexOf(b.tag) || a.at - b.at)
    .map(({ at: _at, ...row }) => row);
  return { count: rows.length, rows };
}

/**
 * The line a morale roll's working carries for a record an item's reach wrote:
 * the item's name under the caller's "In reach of" words, and the record's page
 * reference. Data only; the figure is the working's own.
 *
 * @param {{item: string, cite?: string, words: {inReachOf: string}}} p
 * @returns {{label: string, cite: string}}
 */
export const moraleLine = ({ item, cite = "", words }) => ({ label: `${words.inReachOf} ${item}`, cite: String(cite ?? "") });
