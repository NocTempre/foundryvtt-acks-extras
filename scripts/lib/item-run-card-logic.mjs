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
import { isUnset, numOrNull, unset } from "./util.mjs";

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
 * or `undone`). `undetermined` holds the bodies the item's filter could not
 * settle, `{uuid, name}` by key, and `counted` those among them an owner of the
 * item counted in for this raise: the card belongs to one activation, so a count
 * lasts until the item is lowered and a re-raise starts with none.
 *
 * @param {{itemUuid: string, rowKey: string, activationId: string, kind?: string, bearer: {uuid: string, name: string}, regionUuid?: string, cardId?: string}} p
 */
export const newCard = ({ itemUuid, rowKey, activationId, kind = "toggle", bearer, regionUuid = "", cardId = "" }) => ({
  itemUuid, rowKey, activationId, kind, cardId, regionUuid, bearer, selfCount: false, lowered: false, subjects: {}, undetermined: {}, counted: {}, entries: {},
});

/** Whether a raised card holds a body as counted in for its raise: the item's filter could not settle it and an owner of the item counted it. A lowered card counts nobody. */
export const isCountedIn = (card, uuid) => card?.lowered !== true && !!card?.counted?.[safeKey(uuid)];

/** Apply a dotted patch to a card, as the message's update applies it: a value that is `unset()` deletes the key it is written to. Returns a new card. */
export function applyPatch(card, patch) {
  const next = structuredClone(card ?? {});
  for (const [path, value] of Object.entries(patch ?? {})) {
    const parts = path.split(".");
    let at = next;
    for (const part of parts.slice(0, -1)) at = at[part] ??= {};
    const last = parts.at(-1);
    if (isUnset(value)) delete at[last];
    else at[last] = value;
  }
  return next;
}

/**
 * What a reach's filter admits of a body, read with the raised card: a body the
 * filter left undetermined (null) that an owner of the item counted in for this
 * raise is admitted. A verdict the filter settled stands, true or false.
 */
export const admittedWithCount = (admitted, card, uuid) => ((admitted === null || admitted === undefined) && isCountedIn(card, uuid) ? true : admitted);

/** The patch that lists a subject on the card, as in reach (`state` `in`) or as no target, keeping its newest entry. */
export function patchSubject(card, { uuid, name, state = "in" }) {
  const key = safeKey(uuid);
  return { [`subjects.${key}`]: { uuid, name, state, latest: card?.subjects?.[key]?.latest ?? "" }, [`undetermined.${key}`]: unset() };
}

/**
 * The patch that lists a subject the filter could not settle, for the Judge's
 * tick. A body with a row in reach or as no target is already listed and keeps
 * it; a body whose row was muted at its exit is listed here and the muted row
 * leaves, so that a body is in one list of the card.
 */
export function patchUndetermined(card, { uuid, name }) {
  const key = safeKey(uuid);
  const row = card?.subjects?.[key];
  if (row && row.state !== "out") return {};
  return { [`undetermined.${key}`]: { uuid, name }, ...(row ? { [`subjects.${key}`]: unset() } : {}) };
}

/** The patch that drops a body from the card's undetermined list, empty where it is not on it. */
export const patchForget = (card, { uuid }) => (card?.undetermined?.[safeKey(uuid)] ? { [`undetermined.${safeKey(uuid)}`]: unset() } : {});

/**
 * What a standing reach's entry or exit does to the raised card for one body,
 * read with the card: `list` (a body already on the card as a row, or counted
 * in, comes back in reach), `out` (the same body leaves: its row is muted),
 * `forget` (an exit of a body only held undetermined drops it from that list,
 * since nothing holds it any more and its next entry lists it again), or null
 * where the card keeps nothing of the body. A standing reach lists nobody of its
 * own: a body not on the card stays off it.
 *
 * @param {object} card
 * @param {string} uuid the body's token uuid
 * @param {{act: "on"|"off", counted: boolean}} p `counted`: the body is read as admitted because an owner of the item counted it in
 * @returns {"list"|"out"|"forget"|null}
 */
export function standingCardAct(card, uuid, { act, counted = false }) {
  const key = safeKey(uuid);
  if (counted || card?.subjects?.[key]) return act === "on" ? "list" : "out";
  return act === "off" && card?.undetermined?.[key] ? "forget" : null;
}

/**
 * The patch that counts an undetermined body in for a raised card's raise: it is
 * listed as in reach (as `patchSubject` lists it) and recorded under `counted`,
 * so each later moment of the reach reads the body as one the filter admits.
 */
export const patchCountIn = (card, { uuid, name }) => ({ ...patchSubject(card, { uuid, name }), [`counted.${safeKey(uuid)}`]: { uuid, name } });

/**
 * The patch that lowers a raised card's counts: each counted body leaves
 * `counted` and is held undetermined again, so nothing carries into another raise.
 */
export function patchUncount(card) {
  const patch = {};
  for (const [key, held] of Object.entries(card?.counted ?? {})) Object.assign(patch, { [`counted.${key}`]: unset(), [`undetermined.${key}`]: { uuid: held.uuid, name: held.name } });
  return patch;
}

/** The figure of a rule modifier with its sign, a true minus for a negative one. */
export const signedFigure = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;

/**
 * The tooltip of a body a standing reach holds a part on: the item's name and
 * the part (the rolls it names and its figure, read from the world), then the
 * item's page. Where no figure was imported the page reference stands alone, and
 * null where there is neither.
 *
 * @param {{line: string, cite?: string}} p `line`: the localized sentence naming the item and the part, or "" where no figure was imported
 * @returns {string|null}
 */
export function standingPartTip({ line = "", cite = "" }) {
  const text = [line, cite ? (line ? `(${cite})` : cite) : ""].filter(Boolean).join(" ");
  return text || null;
}

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
    [`undetermined.${safeKey(uuid)}`]: unset(),
  };
  for (const [old] of struck) patch[`entries.${old}`] = unset();
  return { key, patch, struck: struck.map(([, e]) => e) };
}

/** The patch that takes a subject out of reach: its row muted, every open entry of it struck, and the body dropped from the undetermined list where it is held there, so that it is in one list. Answers `{patch, struck}`. */
export function patchOut(card, { uuid, name }) {
  const key = safeKey(uuid);
  const struck = openEntriesOf(card, uuid);
  const gone = new Set(struck.map(([old]) => old));
  const kept = Object.keys(card?.entries ?? {}).filter((k) => card.entries[k].subject === uuid && !gone.has(k));
  const patch = { [`subjects.${key}`]: { uuid, name, state: "out", latest: kept.at(-1) ?? "" }, ...(card?.undetermined?.[key] ? { [`undetermined.${key}`]: unset() } : {}) };
  for (const [old] of struck) patch[`entries.${old}`] = unset();
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

/**
 * The press that counts an undetermined body in, offered by ownership of the
 * item. `tooltip` says how long the count lasts: for a once-only use its own,
 * for a raised item until it is lowered.
 */
export const countSubjectAction = (words, ids, subject, tooltip = words.countSubjectTip) => ({ action: "itemRun.tickSubject", label: words.tick, icon: "fa-solid fa-check", data: { ...ids, subject }, tooltip });

/** The rows of an undetermined section, one per body the filter could not settle, each with its Count in. `list` is `[{key, name}]`; the caller offers it to the owners of the item alone. */
export const unsettledRows = (list, words, ids, tooltip) => list.map(({ key, name }) => ({ name, total: "", outcome: words.undetermined, emphasis: "muted", actions: [countSubjectAction(words, ids, key, tooltip)] }));

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
    case "held": return { ...base, outcome: r.counted === true ? words.counted : words.always, emphasis: "success", ...(r.heldTip ? { outcomeTooltip: r.heldTip } : {}) };
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
 * target, its result and its press; a section of the bodies the filter could not
 * settle, with a Count in for the owners of the item; a section of the bearer's own row, which is
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
 * @param {Array<{key: string, name: string, state: string, counted?: boolean, heldTip?: string, entryKey?: string, entry?: object, feet?: number|null, feetTip?: string, target?: number|null, targetTip?: string, history?: string}>} p.rows `state` `held` is a body in reach of a standing reach, which asks no save and offers no press to any seat: it reads `words.counted` where `counted` (an owner of the item counted it in) and `words.always` where the filter admitted it, with `heldTip` as the Result's tooltip
 * @param {Array<{key: string, name: string}>} [p.undetermined] the bodies the filter could not settle, listed with a Count in for the owners of the item; none once the reach is lowered
 * @param {{key: string, name: string, counted: boolean, row?: object}} [p.bearer] the bearer's row; `row` is its row where counted
 * @param {string[]} [p.well] the lines of what failed saves wrote
 * @param {{itemUuid: string, rowKey: string, activationId: string}} p.ids
 * @param {{judge?: boolean, ownsSubject?: (key: string) => boolean, ownsBearer?: boolean, ownsItem?: boolean, mayUndo?: (entry: object, key: string) => boolean}} p.seat
 * @param {boolean} [p.lowered] the reach is lowered: no footer
 */
export function reachCardModel({ title, subtitle, note, noteTooltip, words, rows, undetermined = [], bearer, well = [], ids, seat = {}, lowered = false }) {
  const mine = (key) => seat.ownsSubject?.(key) === true;
  const sections = [{ rows: rows.filter((r) => mine(r.key)).map((r) => reachRowOf(r, { words, ids, seat })) }];
  if (!lowered && seat.ownsItem === true && undetermined.length) sections.push({ title: words.undetermined, rows: unsettledRows(undetermined, words, ids, words.countSubjectRaisedTip) });
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
 * @param {{title: string, subtitle: string, words: object, target: number|null, targetTip?: string|null, ids: object, subject: string, entryKey: string, messageId: string, entry?: object|null, ifFails?: string, canPress?: boolean, closedWord?: string}} p `closedWord` is what a row closed as not engaged reads, with who closed it.
 */
export function saveCardModel({ title, subtitle, words, target, targetTip = null, ids, subject, entryKey, messageId, entry = null, ifFails = "", canPress = false, closedWord = "" }) {
  const tgt = numOrNull(target) !== null ? { target, ...(targetTip ? { targetTooltip: targetTip } : {}) } : {};
  const state = entry?.state ?? "open";
  const line = { name: words.save, total: "", ...tgt };
  if (state === "applied") Object.assign(line, { total: entry.total ?? "", outcome: entry.saved ? words.saved : words.failed, emphasis: entry.saved ? "success" : "failure" });
  else if (state === "undone") Object.assign(line, { outcome: words.undone, emphasis: "muted" });
  else if (state === "closed") Object.assign(line, { outcome: closedWord || words.asked, emphasis: "muted" });
  else if (canPress) line.actions = [{ action: "itemRun.roll", label: words.rollSave, icon: "fa-solid fa-dice-d20", data: { ...ids, subject, entryKey, messageId }, tooltip: words.saveTip }];
  else line.outcome = words.asked;
  return { title, subtitle, sections: [{ rows: [line] }], bare: true, ...(ifFails ? { footnote: ifFails } : {}) };
}


/* -------------------------------------------- */
/*  The engaged card (T10)                       */
/* -------------------------------------------- */

/**
 * The key one engaged card is found under: the initiative's stamp and the
 * subject, so a subject has one card per moment and every kind it is asked is a
 * row of it. Null outside a fight, where nothing could be told apart and a card
 * is never reused.
 *
 * @param {{stamp?: string|null, subjectUuid: string}} p `stamp` as `turnStamp` reads it
 * @returns {string|null}
 */
export const engagedCardKey = ({ stamp = null, subjectUuid }) => (stamp && subjectUuid ? `${stamp}|${subjectUuid}` : null);

/**
 * A new engaged card's stored state (`FLAG_ITEM_RUN_CARD`, `kind: "engaged"`):
 * one per subject per moment, holding the subject, the initiative it was asked
 * in and one entry per item kind it was asked, keyed by that entry's moment key
 * (`engagedEntry`). The card names no item, row or activation of its own: each
 * entry carries its own, so a lowered reach's lifting never finds this card and
 * its records outlive the Region.
 *
 * @param {{cardKey: string|null, stamp: string|null, round: number|null, moment: string, subject: {uuid: string, name: string}, title: string, cardId: string}} p
 */
export const newEngagedCard = ({ cardKey, stamp, round, moment, subject, title, cardId }) => ({
  ...newCard({ itemUuid: "", rowKey: "", activationId: "", kind: "engaged", bearer: { uuid: "", name: "" }, cardId }),
  cardKey: cardKey ?? "", stamp: stamp ?? "", round: round ?? null, moment, subject, title,
});

/**
 * One row's entry on an engaged card, open: what was asked (`itemUuid`,
 * `rowKey`, the Region's `activationId` and the item's kind key) and the
 * bearers that engage the subject, `[{uuid, name}]`, in the order they were read.
 */
export const engagedEntry = ({ subject, moment, momentKey, kindKey, itemUuid, rowKey, activationId, bearers }) => ({
  subject, moment, momentKey: momentKey ?? "", state: "open", kindKey, itemUuid, rowKey, activationId, bearers,
});

/**
 * The patch that opens a row on an engaged card, under a fresh key from its
 * moment key. Answers `{key, patch}`.
 */
export function patchEngagedPrompt(card, { momentKey, entry }) {
  const key = freshKey(card?.entries, safeKey(momentKey ?? `${entry.subject}:prompt`));
  return { key, patch: { [`entries.${key}`]: entry } };
}

/**
 * The patch that closes an open row as not engaged: its state, and who closed
 * it (`closedBy` `{id, name}`, also its `presser`, so the seat that closed it
 * may Undo it). Writes no save and no record; the row keeps its bearers.
 */
export const patchEngagedClose = (key, { id, name }) => ({ [`entries.${key}.state`]: "closed", [`entries.${key}.closedBy`]: { id, name }, [`entries.${key}.presser`]: id });

/** The patch that reopens a closed row: open again, its closer forgotten. */
export const patchEngagedReopen = (key) => ({ [`entries.${key}.state`]: "open", [`entries.${key}.closedBy`]: unset(), [`entries.${key}.presser`]: unset() });

/** The entries of one subject and item kind that are still open on a card. */
export const openEngagedOf = (card, { subjectUuid, kindKey }) => Object.entries(card?.entries ?? {}).filter(([, e]) => e.subject === subjectUuid && e.kindKey === kindKey && e.state === "open");

/**
 * Whether a seat owns every bearer an entry names, by the caller's test of one
 * token's uuid. An entry that names no bearer is owned by nobody: nothing says
 * whose call it is.
 */
export const ownsEveryBearer = (entry, owns) => (entry?.bearers ?? []).length > 0 && entry.bearers.every((b) => owns(b.uuid) === true);

/**
 * One row of the engaged card as the renderer takes it. `r` is read live by
 * the caller (see `engagedCardModel`). The Save is the subject's owners' and
 * the Not engaged the bearers' owners'.
 */
function engagedRowOf(r, { words, seat }) {
  const subject = r.entry.subject;
  const mineSubject = seat.ownsSubject?.(subject) === true;
  const mineBearers = seat.ownsBearers?.(r.entry) === true;
  const data = { ...r.ids, subject, entryKey: r.entryKey };
  const base = { name: r.bearerNames, ...(r.bearersTip ? { nameTooltip: r.bearersTip } : {}), total: "" };
  // A blank save is a blank cell whose tooltip is the page alone; a no-break space keeps the Save column and its tooltip without a figure.
  const target = numOrNull(r.target) !== null ? { target: r.target, ...(r.targetTip ? { targetTooltip: r.targetTip } : {}) } : { targetText: "\u00a0", ...(r.targetTip ? { targetTooltip: r.targetTip } : {}) };
  const undo = seat.mayUndo?.(r.entry, subject) === true ? [{ action: "itemRun.undo", label: words.undo, icon: "fa-solid fa-rotate-left", data, tooltip: words.undoTip }] : [];
  switch (r.state) {
    case "open": return {
      ...base, ...target, outcome: words.asked,
      actions: [
        ...(mineSubject ? [{ action: "itemRun.roll", label: words.save, icon: "fa-solid fa-shield-halved", data, tooltip: words.saveTip }] : []),
        ...(mineBearers ? [{ action: "itemRun.notEngaged", label: words.notEngaged, icon: "fa-solid fa-ban", data, tooltip: words.notEngagedTip, ...(r.notEngagedAria ? { ariaLabel: r.notEngagedAria } : {}) }] : []),
      ],
    };
    case "closed": return { ...base, outcome: r.closedWord, emphasis: "muted", ...(undo.length ? { actions: undo } : {}) };
    case "undone": return { ...base, ...target, outcome: words.undone, emphasis: "muted" };
    default: {
      const saved = r.entry.saved === true;
      return {
        ...base, ...target, total: r.entry.total ?? "", outcome: saved ? (r.holds?.text ?? words.saved) : words.failed, emphasis: saved ? "success" : "failure",
        ...(saved && r.holds?.tip ? { outcomeTooltip: r.holds.tip } : {}),
        ...(undo.length && r.entry.recordIds?.length ? { actions: undo } : {}),
      };
    }
  }
}

/**
 * The model the engaged card (board 5b: 4b's raised card recut for the T10
 * reach) is rendered from, for one seat: a banner naming the subject and its
 * moment, the note saying what engaged is, one row per item kind asked, with
 * "Engaged by" in the name column (the bearers' names, comma-joined, with a
 * computed tooltip), the Save target, the total, the Result and the presses;
 * the well naming what a failed save wrote; and, for a seat that owns every
 * bearer on a row, the line saying what the module read. `seat` reads Foundry's
 * ownership alone (`ownsSubject(key)`, `ownsBearers(entry)`, `mayUndo(entry,
 * key)`) and reads no role. A seat that owns neither the subject nor every
 * bearer of a row is shown no row. Data only; the words are the caller's.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.subtitle]
 * @param {string} [p.note]
 * @param {string} [p.noteTooltip]
 * @param {object} p.words every word and tooltip the card shows (`itemRun.card.*`)
 * @param {Array<{entryKey: string, entry: object, state: "open"|"applied"|"undone"|"closed", bearerNames: string, bearersTip?: string, target: number|null, targetTip?: string|null, ids: {itemUuid: string, rowKey: string, activationId: string}, holds?: {text: string, tip?: string}, closedWord?: string, notEngagedAria?: string}>} p.rows
 * @param {string[]} [p.well] the lines of what failed saves wrote
 * @param {{ownsSubject?: (key: string) => boolean, ownsBearers?: (entry: object) => boolean, mayUndo?: (entry: object, key: string) => boolean}} p.seat
 */
export function engagedCardModel({ title, subtitle, note, noteTooltip, words, rows, well = [], seat = {} }) {
  const shown = rows.filter((r) => seat.ownsSubject?.(r.entry.subject) === true || seat.ownsBearers?.(r.entry) === true);
  const lines = shown.some((r) => seat.ownsBearers?.(r.entry) === true) ? [words.engagedRead] : [];
  const told = well.filter(Boolean);
  return {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(note ? { note } : {}),
    ...(noteTooltip ? { noteTooltip } : {}),
    sections: [{ rows: shown.map((r) => engagedRowOf(r, { words, seat })) }],
    bare: true,
    ...(told.length ? { footnote: `${words.well}: ${told.join(" · ")}` } : {}),
    ...(lines.length ? { lines } : {}),
    labels: { name: words.engagedBy, target: words.save },
  };
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
