/* global game, ChatMessage, Hooks */
/**
 * The cast card: one chat message per cast, drawn by lib's roll card
 * (`lib/roll-card.mjs`), whose flag `flags["acks-extras"].castCard` is the
 * model the card is drawn from and the anchor the cast's relay checks against.
 * One section per rolled row and per modifier or ward row, one table row per
 * target with what was applied, a tooltip on every figure saying where it came
 * from. A modifier entry's figure is its part's value, which lib reads at the roll.
 *
 * The flag holds the cast (the spell, the caster, the level and its source,
 * the spell's save, each row's roll), the targets with the resist each rolled,
 * and the entries, one per target and row, keyed `<targetKey>_<rowKey>` and
 * written by dotted per-entry updates so two entries land without overwriting
 * each other. Only the card's author and a GM write it; any other seat asks
 * through the relay (`cast-apply.mjs`).
 *
 * The stored content is the card as a viewer with no rights sees it. A render
 * hook rebuilds the body per seat, so each seat gets exactly the buttons it
 * may press: Apply and Throw for the caster's author and a GM, Undo for a GM.
 * The buttons carry actions of this feature's own (`magicCast…`) and never
 * the system's `.card-buttons`.
 */
import { MODULE_ID } from "./constants.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { DAMAGE_TYPES } from "../lib/vocab.mjs";
import { isModRow } from "./cast-mods.mjs";

/** The flag key under `flags[MODULE_ID]` that holds the card model. */
export const CAST_CARD_FLAG = "castCard";

/** The button actions a card carries. */
export const CARD_ACTIONS = Object.freeze({
  apply: "magicCastApply",
  applyTargets: "magicCastApplyTargets",
  throw: "magicCastThrow",
  undo: "magicCastUndo",
});

/** A new target key of the card. */
export const newTargetKey = (randomID = () => Math.random().toString(36).slice(2, 8)) => `t${randomID(6)}`;

/** A damage type's label: its inline English label, or the key. */
const typeLabel = (key) => DAMAGE_TYPES[key]?.label ?? key;

/** The saving-throw figure's tooltip: its labelled parts with the creature's own numbers. */
function saveTip(resist, loc) {
  const parts = (resist.parts ?? []).map((p) => `${p.label} ${Number(p.value) > 0 ? "+" : ""}${p.value}`);
  return loc("tip.save", { target: resist.target, base: resist.baseTarget ?? "—", formula: resist.formula, parts: parts.join(" · ") || "—" });
}

/** The tooltip of an applied figure: what the roll and the save's fraction made of it. */
const appliedTip = (entry, loc) =>
  entry.applied == null ? "" : loc("tip.applied", { rolled: entry.rolled, fraction: entry.fraction ?? 1, applied: entry.applied });

/** A row's figure tooltip: its dice and the page the procedure is cited to; the citation alone for a blank figure. */
function rollTip(row, card, loc) {
  const cite = card.cite ? loc("tip.cite", { cite: card.cite }) : "";
  if (row.total == null) return cite;
  const dice = loc("tip.roll", { formula: row.formula, detail: row.detail || row.total, total: row.total });
  return [dice, cite].filter(Boolean).join(" · ");
}

/**
 * The tooltip of a modifier or ward entry's figure: the spell, the weapon it is
 * on where the card names one for this target, and the page the procedure is
 * cited to. A figure the import left unread carries the page reference alone.
 */
function partTip(row, card, targetKey, loc) {
  if (row.blank) return rollTip(row, card, loc);
  const item = card.item?.targetKey === targetKey ? card.item.name : "";
  if (!card.cite) return [card.spellName, item].filter(Boolean).join(" · ");
  return loc(item ? "tip.part" : "tip.partNoItem", { spell: card.spellName, item, cite: card.cite });
}

/** The caster level's tooltip: where the figure came from, or that a hand set it. */
function levelTip(card, loc) {
  const source = card.casterLevel?.source;
  return source ? loc(`tip.level.${source}`, { value: card.casterLevel.value }) : "";
}

/** The section title of a row: its kind and the types it carries. */
function titleOf(row, loc) {
  const types = (row.types ?? []).map(typeLabel).filter(Boolean);
  return types.length ? `${loc(`row.${row.type}`)} (${types.join(", ")})` : loc(`row.${row.type}`);
}

/** The buttons one entry offers this seat. A modifier entry's Undo says it takes the whole group off. */
function entryActions(entry, ids, { isGM, canPress }, loc, { group = false, name = "" } = {}) {
  const out = [];
  const data = { target: ids.targetKey, row: ids.rowKey };
  if (entry?.state === "pending" && canPress) out.push({ action: CARD_ACTIONS.apply, label: loc("button.apply"), icon: "fa-solid fa-check", data });
  if (entry?.state === "throw" && canPress) out.push({ action: CARD_ACTIONS.throw, label: loc("button.throw"), icon: "fa-solid fa-dice-d20", data });
  if (entry?.state === "applied" && isGM && (entry.applied > 0 || entry.recordIds?.length)) {
    out.push({ action: CARD_ACTIONS.undo, label: loc("button.undo"), icon: "fa-solid fa-rotate-left", data, tooltip: group ? loc("tip.undoGroup", { name }) : loc("tip.undo") });
  }
  return out;
}

/** The result word and emphasis of an entry. */
function outcomeOf(entry, loc) {
  if (!entry) return { outcome: "" };
  const saved = entry.saved === true ? loc("state.saved") : entry.saved === false ? loc("state.failed") : "";
  const word = entry.state === "applied" ? saved || loc("state.applied") : loc(`state.${entry.state}`);
  const emphasis = entry.state === "missed" ? "failure" : entry.saved === true ? "success" : entry.saved === false ? "failure" : undefined;
  return { outcome: word, emphasis };
}

/**
 * The roll card a cast card is drawn as, for one seat.
 *
 * @param {object} card  the model
 * @param {{isGM: boolean, canPress: boolean}} seat
 * @param {(key: string, data?: object) => string} loc  the cast's strings, under the magic root's `cast` branch
 * @returns {object} `renderRollCard`'s argument
 */
export function castCardView(card, seat, loc) {
  const sections = [];
  const targets = Object.entries(card.targets ?? {});
  for (const rowKey of card.order ?? []) {
    const row = card.rows?.[rowKey];
    if (!row) continue;
    const isMod = isModRow(row);
    const rows = [];
    for (const [targetKey, target] of targets) {
      const entry = card.entries?.[`${targetKey}_${rowKey}`];
      // A row with a throw was resisted by the throw, not by the spell's save.
      // A buff is not resisted either.
      const resist = row.delivery || isMod ? null : (target.resist ?? null);
      const done = entry?.state === "applied" || entry?.state === "undone";
      const yields = card.yields?.[`${targetKey}_${rowKey}`];
      const line = isMod
        ? {
            name: target.name,
            total: done && row.total != null ? row.total : "—",
            tooltipText: partTip(row, card, targetKey, loc),
            detail: yields ? loc("detail.yields", { name: yields }) : "",
            ...outcomeOf(entry, loc),
            actions: entryActions(entry, { targetKey, rowKey }, seat, loc, { group: true, name: target.name }),
          }
        : {
            name: target.name,
            total: done && entry.applied != null ? entry.applied : "—",
            tooltipText: entry ? appliedTip(entry, loc) : "",
            detail: entry?.throw ? loc("detail.throw", { total: entry.throw.total, target: entry.throw.target }) : entry?.rolled != null ? loc("detail.rolled", { rolled: entry.rolled }) : "",
            ...outcomeOf(entry, loc),
            actions: entryActions(entry, { targetKey, rowKey }, seat, loc),
          };
      if (resist) Object.assign(line, { target: resist.target, targetTooltip: saveTip(resist, loc), detail: [loc("detail.save", { total: resist.total }), line.detail].filter(Boolean).join(" · ") });
      rows.push(line);
    }
    if (!targets.length) {
      const needsThrow = Boolean(row.delivery);
      rows.push({
        name: loc("noTarget"),
        total: row.total ?? "—",
        tooltipText: isMod ? partTip(row, card, "", loc) : rollTip(row, card, loc),
        actions: needsThrow && seat.canPress ? [{ action: CARD_ACTIONS.throw, label: loc("button.throw"), icon: "fa-solid fa-dice-d20", data: { row: rowKey } }] : [],
      });
    }
    const cite = card.cite ? loc("tip.cite", { cite: card.cite }) : "";
    sections.push({ title: titleOf(row, loc), titleTooltip: isMod ? cite : rollTip(row, card, loc), rows });
  }
  const loose = !targets.length && (card.order ?? []).some((k) => !card.rows?.[k]?.delivery);
  const buttons = loose && seat.canPress ? [{ action: CARD_ACTIONS.applyTargets, label: loc("button.applyTargets"), icon: "fa-solid fa-crosshairs", tooltip: loc("tip.applyTargets") }] : [];
  return {
    title: card.spellName,
    subtitle: card.casterName ?? "",
    note: [card.mode === "reversed" ? loc("note.reversed") : "", card.casterLevel?.value ? loc("note.level", { value: card.casterLevel.value }) : ""].filter(Boolean).join(" · "),
    noteTooltip: levelTip(card, loc),
    sections,
    footnote: (card.lines ?? []).join(" · "),
    buttons,
    labels: { total: loc("col.applied"), target: loc("col.target"), result: loc("col.result"), actions: loc("col.actions") },
  };
}

/** The card's content with no seat's buttons: what is stored. */
export const castCardContent = (card, loc) => renderRollCard(castCardView(card, { isGM: false, canPress: false }, loc));

/* -------------------------------------------- */
/*  Foundry                                      */
/* -------------------------------------------- */

/** The cast's strings. */
export const cardLoc = (key, data = {}) => game.i18n.format(`ACKS-MAGIC.cast.${key}`, data);

/** The card model of a message, or null. */
export const cardOf = (message) => message?.flags?.[MODULE_ID]?.[CAST_CARD_FLAG] ?? null;

/**
 * Post a cast card. `mode` is the dialog's visibility; `rolls` ride on the
 * message so Dice So Nice shows them.
 * @returns {Promise<ChatMessage>}
 */
export async function postCastCard(card, { rolls = [], mode = "public", speaker } = {}) {
  const data = {
    speaker: speaker ?? ChatMessage.getSpeaker(),
    content: castCardContent(card, cardLoc),
    rolls,
    flags: { [MODULE_ID]: { [CAST_CARD_FLAG]: card } },
  };
  const applied = ChatMessage.applyMode?.(data, mode);
  return ChatMessage.create(applied && typeof applied === "object" ? applied : data);
}

/** Write one entry of a card by a dotted update, and its stored content with it. */
export async function updateEntry(message, id, entry) {
  const next = { ...cardOf(message), entries: { ...cardOf(message)?.entries, [id]: entry } };
  return message.update({
    [`flags.${MODULE_ID}.${CAST_CARD_FLAG}.entries.${id}`]: entry,
    content: castCardContent(next, cardLoc),
  });
}

/** Write targets and their entries to a card, each by its own dotted path. */
export async function addTargets(message, targets, entries) {
  const card = cardOf(message);
  const next = { ...card, targets: { ...card.targets, ...targets }, entries: { ...card.entries, ...entries } };
  const update = { content: castCardContent(next, cardLoc) };
  for (const [key, target] of Object.entries(targets)) update[`flags.${MODULE_ID}.${CAST_CARD_FLAG}.targets.${key}`] = target;
  for (const [id, entry] of Object.entries(entries)) update[`flags.${MODULE_ID}.${CAST_CARD_FLAG}.entries.${id}`] = entry;
  return message.update(update);
}

/** Can this seat press Apply and Throw on the card: a GM, or the user who cast it. */
export const canPressCard = (message) => game.user.isGM || message?.author?.id === game.user.id || message?.isAuthor === true;

/** The handlers the card's buttons call, set by the cast engine; a card with none presses nothing. */
let actions = {};

/** Rebuild one rendered card for this seat and bind its buttons. */
function onRender(message, html) {
  const card = cardOf(message);
  const root = html?.nodeType === 1 ? html : (html?.[0] ?? null);
  if (!card || !root) return;
  const body = root.querySelector?.(".message-content");
  if (!body) return;
  const seat = { isGM: game.user.isGM, canPress: canPressCard(message) };
  body.innerHTML = renderRollCard(castCardView(card, seat, cardLoc));
  body.querySelectorAll("[data-action^='magicCast']").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      const handler = actions[button.dataset.action];
      if (!handler) return;
      button.disabled = true;
      Promise.resolve(handler(message, { target: button.dataset.target, row: button.dataset.row }))
        .catch((err) => console.error(`${MODULE_ID} | a cast card's button failed`, err))
        .finally(() => {
          button.disabled = false;
        });
    });
  });
}

let hooked = false;

/**
 * Register the render hook, and the handler each button calls. Once, at `init`.
 * @param {Record<string, (message: ChatMessage, data: {target?: string, row?: string}) => Promise<unknown>>} handlers  by `CARD_ACTIONS` value
 */
export function registerCastCardHooks(handlers = {}) {
  actions = { ...actions, ...handlers };
  if (hooked) return;
  hooked = true;
  Hooks.on("renderChatMessageHTML", onRender);
}
