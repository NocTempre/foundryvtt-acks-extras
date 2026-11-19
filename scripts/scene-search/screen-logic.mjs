/**
 * What the scene screen shows, on plain data: the view model one seat's window
 * renders, built from what `acksExtras.sceneSearch.read` already projected for
 * that seat. No Foundry, no documents, no dice. Words arrive through `t(key,
 * data)` (every key is under `ROOT`) so a suite supplies its own.
 *
 * A player's model is built from the entries, log and assignments the api
 * handed that seat and the pot's found cards, so a hidden entry, an unfound
 * yield or an unfound lot is absent from it by construction: nothing here
 * reaches for the Judge's list. A player's screen has nothing to show until the
 * Judge shows the scene (`session.shown`).
 *
 * Each entry reads as a card: a strip (kind, a Hidden tag the Judge sees, its
 * state), a plate (the name), what its checks found, the public "something
 * more" line, and one rail row per check (hastily, methodically) carrying who
 * is assigned and, once a check is found, no more assigning.
 */
import { LAYER_NAMES, THING_KINDS } from "../lib/place-things-logic.mjs";
import { seatCards, cardView } from "../treasure/pot-logic.mjs";
import { CODE, LAYER } from "./constants.mjs";
import { isVisible, layerState } from "./scene-logic.mjs";

/** The lang prefix of every word the screen says. */
export const ROOT = "ACKS-LOCATION.sceneSearch.screen.";

/** The lang prefix of an entry kind's word, which the plan's option labels share. */
export const KIND_ROOT = "ACKS-LOCATION.sceneSearch.kind.";

/** The `type` of the drag a party member's tile starts. */
export const MEMBER_DRAG = "acks-extras.sceneMember";

/** The drag payload (a JSON string) a member tile carries. */
export const memberDragData = (actorId) => JSON.stringify({ type: MEMBER_DRAG, actorId });

/** The actor id a drop's text names, or null where the text is no member drag. */
export function memberDropOf(text) {
  try {
    const data = JSON.parse(text);
    return data?.type === MEMBER_DRAG && typeof data.actorId === "string" && data.actorId ? data.actorId : null;
  } catch {
    return null;
  }
}

/**
 * The first check a member may attempt at an entry, for a drop on the card
 * rather than on one of its rows.
 * @param {{layers: Array<{layer: string, refusal: string|null}>}|null} options one entry's `sceneOptions` row
 * @returns {string|null} `hasty` or `methodical`, or null where both are refused
 */
export function firstOpenLayer(options) {
  return (options?.layers ?? []).find((row) => !row.refusal)?.layer ?? null;
}

/** Where an entry stands for a seat: hidden (the Judge sees it before the table does), seen, checked hastily, checked methodically. */
export function entryStatus(entry) {
  if (!isVisible(entry)) return "hidden";
  if (layerState(entry, LAYER.METHODICAL).done) return "methodically";
  if (layerState(entry, LAYER.HASTY).done) return "hastily";
  return "seen";
}

/** Has any check been made at this entry? */
const touched = (entry) => LAYER_NAMES.some((name) => layerState(entry, name).done);

/** The lines a card lists under its plate: what each found layer yielded, "Found nothing" for a layer checked in vain, and "Nothing more here." once something was found and nothing remains. */
export function findsOf(entry, t) {
  const lines = [];
  let found = false;
  for (const name of LAYER_NAMES) {
    const state = layerState(entry, name);
    if (state.found) {
      found = true;
      const { clue, lots } = entry.layers[name].yields;
      if (clue) lines.push(t(`${ROOT}finds.clue`, { clue }));
      if (lots.length) lines.push(t(`${ROOT}finds.items.${lots.length === 1 ? "one" : "many"}`, { n: lots.length }));
      if (!clue && !lots.length) lines.push(t(`${ROOT}finds.something`));
    } else if (state.done) lines.push(t(`${ROOT}finds.nothing`));
  }
  if (found && !entry.moreRemains) lines.push(t(`${ROOT}finds.complete`));
  return lines;
}

/**
 * The public "something more" line: shown once a check was made at a visible
 * entry that still holds something unfound, as the Judge's own line where one
 * was written, else the generic words, else the vague words where the latest
 * answer here was the vague one.
 */
export function tellOf(entry, log, t) {
  if (!entry.moreRemains || !touched(entry)) return "";
  if (entry.hint) return entry.hint;
  const last = [...(log ?? [])].reverse().find((row) => row.key === entry.key);
  return t(`${ROOT}tell.${last?.code === CODE.VAGUE ? "vague" : "generic"}`);
}

/** The cost of a check as the rail prints it: a hasty check is a round, a methodical one its turns. */
function costOf(name, layer, t) {
  if (name === LAYER.HASTY) return t(`${ROOT}row.cost.round`);
  const turns = layer.turns ?? 1;
  return t(`${ROOT}row.cost.turn.${turns === 1 ? "one" : "many"}`, { n: turns });
}

/** The Judge's notes on a card: the lots waiting under each check, and what a hidden entry hides behind. */
export function judgeNotes(entry, entries, names, t) {
  const notes = [];
  for (const name of LAYER_NAMES) {
    const state = layerState(entry, name);
    const waiting = state.found ? 0 : entry.layers[name].yields.lots.length;
    if (waiting) notes.push(t(`${ROOT}judge.lots`, { n: waiting, how: t(`${ROOT}how.${name}`) }));
  }
  if (!isVisible(entry)) {
    const front = entries.find((other) => other.key !== entry.key && LAYER_NAMES.some((name) => other.layers[name].yields.reveal.includes(entry.key)));
    const via = front ? LAYER_NAMES.find((name) => front.layers[name].yields.reveal.includes(entry.key)) : null;
    notes.push(front ? t(`${ROOT}judge.behind`, { name: names.get(front.key) ?? "", how: t(`${ROOT}how.${via}`) }) : t(`${ROOT}judge.showsItself`));
  }
  return notes;
}

/** The rows of a pot's tray: every card a Judge sees, the found ones a player sees, each with the pool word its back shows (`cardView`'s `poolKey`, so unidentified magic reads as an item). */
export function trayOf(view, { isGM = false } = {}) {
  const cards = view ? seatCards(view, { isGM }) : [];
  return cards.map((card) => {
    const shown = cardView(card, { isGM });
    return { id: shown.id, poolKey: shown.poolKey, found: shown.found };
  });
}

/** How many of the pot's lots are found: a card dealt with no mark counts as found. */
export function foundCount(view) {
  return view ? seatCards(view, { isGM: false }).length : 0;
}

/** The two presses' counts: the hasty checks a Round resolves and the methodical ones a Turn does, from the unresolved assignments. */
export function pressOf(assignments) {
  const open = (assignments ?? []).filter((a) => !a.resolved);
  return { round: open.filter((a) => a.layer === LAYER.HASTY).length, turn: open.filter((a) => a.layer === LAYER.METHODICAL).length };
}

/** The "This press" sentence: what a Round and what a Turn would resolve, or that nothing is assigned. */
export function pressText(counts, t) {
  const parts = [];
  if (counts.round) parts.push(t(`${ROOT}press.round.${counts.round === 1 ? "one" : "many"}`, { n: counts.round }));
  if (counts.turn) parts.push(t(`${ROOT}press.turn.${counts.turn === 1 ? "one" : "many"}`, { n: counts.turn }));
  return parts.length ? parts.join(" ") : t(`${ROOT}press.none`);
}

/** One log row as the screen prints it: `{cls, head, text, throw}`. The throw reads from the Judges' card and is only ever given to a Judge. */
export function logLineOf(row, { names, memberName, throwOf, isGM, t }) {
  const who = memberName(row.actorId) || t(`${ROOT}log.someone`);
  const entry = names.get(row.key) ?? "";
  const lead = t(`${ROOT}log.lead.${row.layer === LAYER.METHODICAL ? "methodical" : "hasty"}`);
  const head = t(`${ROOT}log.checked`, { lead, who, entry, how: t(`${ROOT}how.${row.layer === LAYER.METHODICAL ? "methodical" : "hasty"}`) });
  const more = (row.more ?? []).length ? t(`${ROOT}log.more`) : "";
  let text = "";
  let cls = "is-miss";
  if (row.code === CODE.FOUND) {
    cls = "is-hit";
    text = [row.clue ? t(`${ROOT}finds.clue`, { clue: row.clue }) : t(`${ROOT}log.foundSomething`), more].filter(Boolean).join(" ");
  } else if (row.code === CODE.VAGUE) {
    text = t(`${ROOT}tell.vague`);
  } else if (isGM && row.code === CODE.FOUND_NOTHING) {
    text = [t(`${ROOT}finds.nothing`), more].filter(Boolean).join(" ");
  }
  const figures = isGM && row.card ? throwOf?.(row.card) : null;
  const shown = figures && Number.isFinite(figures.total) ? t(`${ROOT}log.throw`, { total: figures.total, target: figures.target ?? "?" }) : "";
  return { cls, head, text, throw: shown };
}

/**
 * The open-sheet control of one card: a body's, on the Judge's seat only, and
 * never a container's or any other kind's. `gone` is a body whose actor and
 * token no longer resolve, drawn disabled.
 * @param {object} entry
 * @param {{isGM: boolean, name: string, resolves: boolean, t: Function}} seat
 * @returns {{label: string, button: string, tip: string, gone: boolean}|null}
 */
export function sheetControl(entry, { isGM, name, resolves, t }) {
  if (!isGM || entry.kind !== THING_KINDS.BODY) return null;
  return {
    label: t(`${ROOT}sheet.label`, { name }),
    button: t(`${ROOT}sheet.button`),
    tip: t(`${ROOT}sheet.${resolves ? "tip" : "goneTip"}`),
    gone: !resolves,
  };
}

/**
 * The whole screen as one model.
 *
 * @param {object} input
 * @param {boolean} input.isGM
 * @param {object} input.read `acksExtras.sceneSearch.read`'s answer for this seat: `{session, place, entries, log}`
 * @param {Array<{actorId: string, layer: string, entryKey: string, remaining: number, resolved: boolean}>} input.assignments this seat's `assignments`
 * @param {Array<{actorId: string, name: string, owned: boolean}>} input.members the party, as this seat sees it
 * @param {Map<string, string>} input.names the plate name of each entry this seat sees, by key
 * @param {object|null} input.potView the pot's `viewOf`, or null with none
 * @param {number|null} input.turn the party clock's turns spent
 * @param {{key: string, layer: string, rows: Array<{actorId: string, name: string, refusal: string}>}|null} [input.picker] the open assign picker
 * @param {(entryKey: string) => {img: string|null}} [input.refOf] the document an entry points at
 * @param {(cardId: string) => object|null} [input.throwOf] the figures on a Judges' card
 * @param {(entryKey: string) => boolean} [input.sheetOf] whether a body entry still stands for an actor whose sheet can open; false where none is given
 * @param {(key: string, data?: object) => string} input.t the words
 * @returns {object}
 */
export function buildScreen({ isGM, read, assignments, members, names, potView, turn = null, picker = null, refOf = () => ({ img: null }), throwOf = () => null, sheetOf = () => false, t }) {
  const { session, place, entries } = read;
  const seat = isGM ? "judge" : "player";
  const owned = members.filter((m) => m.owned).map((m) => m.name);
  const header = {
    place: place.name,
    seat: t(`${ROOT}seat.${seat}`, { names: owned.join(", ") }),
    shown: session.shown === true,
    showState: t(`${ROOT}shown.${session.shown ? "yes" : "no"}`),
    cap: t(`${ROOT}cap.${session.recordMessageId ? "fight" : "here"}`),
  };
  if (!isGM && !session.shown) return { isGM, waiting: true, header };

  const byActor = new Map(members.map((m) => [m.actorId, m]));
  const mine = assignments.filter((a) => entries.some((e) => e.key === a.entryKey));
  const tray = trayOf(potView, { isGM }).map((tile) => {
    const pool = t(`ACKS-TREASURE.pool.${tile.poolKey}`);
    return { ...tile, word: pool, tip: t(`${ROOT}tray.${tile.found ? "tileFound" : "tileWaiting"}`, { pool }) };
  });
  const found = foundCount(potView);
  const untouched = entries.filter((e) => isVisible(e) && !touched(e)).length;
  const press = pressOf(mine);

  const cards = entries.map((entry) => {
    const name = names.get(entry.key) ?? "";
    const status = entryStatus(entry);
    const hidden = status === "hidden";
    const tell = tellOf(entry, read.log, t);
    const rows = LAYER_NAMES.map((layerName) => {
      const state = layerState(entry, layerName);
      const layer = entry.layers[layerName];
      const label = t(`${ROOT}layer.${layerName}`);
      const chips = mine
        .filter((a) => a.entryKey === entry.key && a.layer === layerName && !a.resolved)
        .map((a) => {
          const who = byActor.get(a.actorId)?.name ?? "";
          const removable = isGM || !!byActor.get(a.actorId)?.owned;
          return { actorId: a.actorId, name: who, struck: false, removable, tip: removable ? t(`${ROOT}chip.unassign`, { name: who, entry: name, check: label }) : "" };
        });
      const assigned = new Set(chips.map((c) => c.actorId));
      for (const id of Object.keys(state.failed)) {
        if (assigned.has(id) || !byActor.has(id)) continue;
        const who = byActor.get(id).name;
        chips.push({ actorId: id, name: who, struck: true, removable: false, tip: t(`${ROOT}chip.struck`, { name: who }) });
      }
      const turns = layer.turns ?? 1;
      const live = mine.find((a) => a.entryKey === entry.key && a.layer === layerName && !a.resolved && turns > 1);
      const bar = live && Number.isFinite(live.remaining) ? Math.max(0, Math.min(100, Math.round(((turns - live.remaining) / turns) * 100))) : null;
      return {
        layer: layerName,
        label,
        cost: costOf(layerName, layer, t),
        costTip: layerName === LAYER.HASTY ? t(`${ROOT}row.tip.round`) : t(`${ROOT}row.tip.turn`, { n: turns }),
        done: state.done,
        chips,
        bar,
        barTip: bar === null ? "" : t(`${ROOT}row.barTip`, { done: turns - live.remaining, total: turns }),
        canAssign: !state.found,
        assignLabel: t(`${ROOT}assign.label`, { entry: name, check: label }),
        picker: picker?.key === entry.key && picker.layer === layerName ? { title: t(`${ROOT}assign.pickerFor`, { entry: name, check: label }), rows: picker.rows } : null,
      };
    });
    return {
      key: entry.key,
      kind: entry.kind,
      kindWord: t(`${KIND_ROOT}${entry.kind}`),
      name,
      hidden,
      status,
      statusWord: t(`${ROOT}state.${status}`),
      img: refOf(entry.key)?.img ?? null,
      tell,
      finds: findsOf(entry, t),
      notes: isGM ? judgeNotes(entry, entries, names, t) : [],
      sheet: sheetControl(entry, { isGM, name, resolves: sheetOf(entry.key), t }),
      rows,
      aria: [name, t(`${KIND_ROOT}${entry.kind}`), t(`${ROOT}state.${status}`), tell].filter(Boolean).join(", "),
    };
  });

  const partyRows = members.map((m) => {
    const own = mine.find((a) => a.actorId === m.actorId && !a.resolved);
    const entryName = own ? names.get(own.entryKey) : null;
    return {
      actorId: m.actorId,
      name: m.name,
      draggable: isGM || m.owned,
      at: entryName ? t(`${ROOT}member.at`, { entry: entryName, how: t(`${ROOT}how.${own.layer}`) }) : t(`${ROOT}member.free`),
    };
  });

  const memberName = (id) => byActor.get(id)?.name ?? "";
  const lines = [...(read.log ?? [])].reverse().map((row) => logLineOf(row, { names, memberName, throwOf, isGM, t }));

  return {
    isGM,
    waiting: false,
    header,
    found,
    untouched,
    foundText: t(`${ROOT}count.found.${found === 1 ? "one" : "many"}`, { n: found }),
    untouchedText: t(`${ROOT}count.untouched.${untouched === 1 ? "one" : "many"}`, { n: untouched }),
    press,
    pressText: pressText(press, t),
    turn,
    turnText: turn === null ? "" : t(`${ROOT}turn.label`, { n: turn }),
    cards,
    members: partyRows,
    log: lines,
    tray,
    potOpen: !!session.potUuid,
  };
}
