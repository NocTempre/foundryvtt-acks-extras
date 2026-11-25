/* global game, ChatMessage, Hooks */
/**
 * The cast card: one chat message per cast, drawn by lib's roll card
 * (`lib/roll-card.mjs`), whose flag `flags["acks-extras"].castCard` is the
 * model the card is drawn from and the anchor the cast's relay checks against.
 * One section per rolled row and per modifier or ward row, one table row per
 * target with what was applied, a tooltip on every figure saying where it came
 * from. A modifier entry's figure is its part's value, which lib reads at the roll.
 * An entry the spell's gates exempt (`cast-gates.mjs`) reads `Exempt` with the
 * gate's parts in its tooltip, and a target that makes no save shows `No save`
 * for its resist, likewise.
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
 * may press: Apply and Throw for the caster's author and a GM, Undo for a GM. A
 * defense an amount or a save met is named to a GM and to the target's owners;
 * every other seat reads "a defense" and the figures. A summoning is stored as
 * a record (`card.summoned`), never as a worded line, and each seat's line names
 * the creature only where that seat can open it; the stored content reads the
 * neutral label.
 * The buttons carry actions of this feature's own (`magicCast…`) and never
 * the system's `.card-buttons`.
 */
import { MODULE_ID } from "./constants.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { DAMAGE_TYPES, CONDITION_KEYS } from "../lib/vocab.mjs";
import { defenseCiteOf, defenseWord, namesDefense } from "../lib/attack-apply.mjs";
import { docOf } from "../lib/util.mjs";
import { creatureOpens, seatLabel } from "../lib/summons-logic.mjs";
import { worldPackOf } from "./cast-summon.mjs";
import { isModRow } from "./cast-mods.mjs";
import { instancesTip } from "./cast-instances.mjs";
import { gateTip } from "./cast-gates.mjs";
import { kindOf } from "./cast-kinds.mjs";
import { levelTip, abilityTips } from "./cast-ability-tips.mjs";

/** The flag key under `flags[MODULE_ID]` that holds the card model. */
export const CAST_CARD_FLAG = "castCard";

/** The button actions a card carries. */
export const CARD_ACTIONS = Object.freeze({
  apply: "magicCastApply",
  applyTargets: "magicCastApplyTargets",
  throw: "magicCastThrow",
  undo: "magicCastUndo",
  save: "magicCastSave",
  roll: "magicCastRoll",
  nextRound: "magicCastNextRound",
  revert: "magicCastRevert",
});

/** A new target key of the card. */
export const newTargetKey = (randomID = () => Math.random().toString(36).slice(2, 8)) => `t${randomID(6)}`;

/** A damage type's label: its inline English label, or the key. */
const typeLabel = (key) => DAMAGE_TYPES[key]?.label ?? key;
const conditionLabel = (key) => CONDITION_KEYS[key]?.label ?? key;

/**
 * The saving-throw figure's tooltip: its labelled parts with the creature's own
 * numbers. A part that is a defense names its band only where the seat may
 * (`named`), and shows its figure either way. A save a defense passed says so
 * with the page, and a defense case the module did not price is listed.
 */
function saveTip(resist, loc, named) {
  const cite = defenseCiteOf(resist.auto);
  if (resist.auto) return loc("tip.saveAuto", { defense: defenseWord(resist.auto, named), cite });
  const parts = (resist.parts ?? []).map((p) => `${p.key === "defense" ? defenseWord({ label: p.label }, named) : p.label} ${Number(p.value) > 0 ? "+" : ""}${p.value}`);
  const tip = loc("tip.save", { target: resist.target, base: resist.baseTarget ?? "—", formula: resist.formula, parts: parts.join(" · ") || "—" });
  const unpriced = (resist.defensePending ?? []).map((p) => loc("tip.savePending", { defense: defenseWord({ label: p.label }, named), cite }));
  const undecided = (resist.pendingParts ?? []).map((p) => loc("tip.savePartPending", { label: p.label, value: `${Number(p.value) > 0 ? "+" : ""}${p.value}` }));
  return [tip, ...unpriced, ...undecided].join(" ");
}

/**
 * The tooltip of an applied figure: the roll, then each step the amount took (the
 * save's fraction, each defense, the rounding), then what was applied. A defense
 * step names its band and source only where the seat may (`named`), and shows its
 * figures either way.
 */
function appliedTip(entry, loc, named) {
  if (entry.applied == null) return "";
  const lines = [loc("tip.rolled", { rolled: entry.rolled })];
  for (const step of entry.steps ?? []) {
    const figures = { before: step.before, after: step.after };
    if (step.key === "fraction") lines.push(loc("tip.stepFraction", { fraction: entry.fraction ?? "", ...figures }));
    else if (step.key === "defense") lines.push(loc("tip.stepDefense", { defense: defenseWord(step, named), ...figures }));
    else if (step.key === "round") lines.push(loc("tip.stepRound", figures));
  }
  lines.push(loc("tip.appliedTotal", { applied: entry.applied }));
  return lines.join(" · ");
}

/**
 * The tooltip of an entry whose instances were thrown: each hit's roll and what it
 * applied (a hit's steps, as `appliedTip` tells them), with every throw's figures
 * where there are several, and the total they came to.
 */
function instancesEntryTip(entry, loc, named) {
  const many = entry.instances.length > 1;
  const lines = entry.instances
    .filter((i) => i.state !== "throw")
    .map((i) => {
      const thrown = many && i.throw ? loc("detail.throw", { total: i.throw.total, target: i.throw.target }) : "";
      const result = i.state === "missed" ? loc("state.missed") : appliedTip({ ...i, fraction: entry.fraction }, loc, named);
      return [thrown, result].filter(Boolean).join(" · ");
    })
    .filter(Boolean);
  if (many && entry.applied != null) lines.push(loc("tip.appliedTotal", { applied: entry.applied }));
  return entry.applied == null ? "" : lines.join("; ");
}

/** What an entry's line says of its throws: the one throw's figures, or how many of the throws hit. */
function throwDetail(entry, loc) {
  if (Array.isArray(entry?.instances)) {
    const thrown = entry.instances.filter((i) => i.state !== "throw");
    if (entry.instances.length === 1) return thrown[0]?.throw ? loc("detail.throw", { total: thrown[0].throw.total, target: thrown[0].throw.target }) : "";
    return thrown.length ? loc("detail.instances", { hits: thrown.filter((i) => i.throw?.hit).length, count: entry.instances.length }) : "";
  }
  return entry?.throw ? loc("detail.throw", { total: entry.throw.total, target: entry.throw.target }) : entry?.rolled != null ? loc("detail.rolled", { rolled: entry.rolled }) : "";
}

/**
 * The tooltip of a condition entry that lasts a next turn or a number of rounds:
 * the count and the roll it came from, then which end the record was written with
 * (a turn end beside the clock, or the clock alone where the bearer holds no turn
 * in a begun fight; unsaid until the entry is applied). A count the import left
 * unread, or whose formula would not roll, carries the page reference alone.
 */
function lifeTip(life, card, loc) {
  const cite = card.cite ? loc("tip.cite", { cite: card.cite }) : "";
  if (life.kind === "rounds" && life.count == null) return cite;
  const count = life.kind === "nextTurn" ? 1 : life.count;
  // A count of one reads in the singular: its own keys, as the importer's counted strings do (`...One`).
  const one = count === 1 ? "One" : "";
  const lasts = life.kind === "nextTurn" ? loc("tip.lastsNextTurn") : life.kind === "followingTurn" ? loc("tip.lastsFollowingTurn") : loc(`tip.lastsRounds${one}`, { count, formula: life.formula, detail: life.detail || count });
  const ends = life.turn === undefined ? "" : life.turn ? loc(life.kind === "nextTurn" ? "tip.endsTurnEnd" : `tip.endsTurnStart${one}`, { count }) : loc(`tip.endsClock${one}`, { count });
  return [lasts, ends, cite].filter(Boolean).join(" ");
}

/** What a condition entry's line says of its life: how many rounds, or until the bearer's next turn ends or following turn begins; nothing where the record is untimed. */
function lifeDetail(life, loc) {
  if (life?.kind === "nextTurn") return loc("detail.lastsNextTurn");
  if (life?.kind === "followingTurn") return loc("detail.lastsFollowingTurn");
  return life?.kind === "rounds" && life.count != null ? loc(life.count === 1 ? "detail.lastsRoundsOne" : "detail.lastsRounds", { count: life.count }) : "";
}

/** A row's figure tooltip: its dice and the page the procedure is cited to; the citation alone for a blank figure. A count the import gave names its parts first. */
function rollTip(row, card, loc) {
  const cite = card.cite ? loc("tip.cite", { cite: card.cite }) : "";
  const count = instancesTip(row.count, card.cite, loc);
  if (row.total == null) return count || cite;
  const dice = loc("tip.roll", { formula: row.formula, detail: row.detail || row.total, total: row.total });
  return [dice, count || cite].filter(Boolean).join(" · ");
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

/** The invocation level's tooltip: chosen up to the tradition's cap, or set by hand where it has none. Empty where the cast read no level. */
function invocationTip(card, loc) {
  if (!card.invocationLevel) return "";
  const cap = card.invocation?.cap;
  return cap != null && card.invocation?.source === "chosen" ? loc("tip.invocation.chosen", { value: card.invocationLevel, cap }) : loc("tip.invocation.hand", { value: card.invocationLevel });
}

/** The casting time's note, on a cast longer than a round: the time and its unit. Empty on any other cast. */
const castingTimeNote = (card, loc) => (card.castingTime ? loc("note.castingTime", { value: card.castingTime.value ?? "", unit: card.castingTime.unit ?? "" }) : "");

/** The casting time's tooltip: whose time it is (the spell's, or its tradition's procedure's) with the spell's page reference. Empty where the card names no time. */
function castingTimeTip(card, loc) {
  const time = card.castingTime;
  return time ? loc(`tip.castingTime.${time.source === "procedure" ? "procedure" : "spell"}`, { value: time.value ?? "", unit: time.unit ?? "", cite: card.cite ?? "" }) : "";
}

/** The caster level's tooltip: where the figure came from (or that a hand set it) and the abilities' parts on it, then the parts on the saves and the damage, where the invocation level came from, and whose casting time the note names. */
function noteTip(card, loc) {
  const level = levelTip(card.casterLevel, loc);
  const others = abilityTips([...(card.abilities?.save ?? []), ...(card.abilities?.damage ?? [])], loc);
  return [level, ...others, invocationTip(card, loc), castingTimeTip(card, loc)].filter(Boolean).join(" · ");
}

/** The section title of a row: its kind and the types it carries. */
function titleOf(row, loc) {
  const types = (row.types ?? []).map(typeLabel).filter(Boolean);
  return types.length ? `${loc(`row.${row.type}`)} (${types.join(", ")})` : loc(`row.${row.type}`);
}

/**
 * What a kind of the dispatch's entry says on its line beside the result (`cast-kinds.mjs`): the weapon a destroy row names or took, the effects a
 * condition row lifted and the ones it left standing with the reason, the conditions a condition row left off because a record of the bearer makes it immune to them, the ones a failed recurring save found already in force, that a row waits for a failed recurring save, that a holder had no weapon, why an entry was not written, and that a slain target is dead.
 */
function kindDetail(row, entry, loc) {
  if (!entry || !kindOf(row.type)) return "";
  const parts = [];
  if (entry.item?.name && entry.state === "pending") parts.push(loc("detail.weapon", { name: entry.item.name }));
  if (entry.item?.name && entry.state === "applied") parts.push(loc(entry.destroyed ? "detail.destroyed" : "detail.weaponKept", { name: entry.item.name }));
  if (row.type === "destroyItem" && entry.item === null) parts.push(loc("detail.noWeapon"));
  if (entry.lifted?.length) parts.push(loc("detail.lifted", { names: entry.lifted.map((d) => d.name).join(", ") }));
  if (entry.listed?.length) parts.push(loc("detail.listed", { names: entry.listed.map((l) => `${l.name || l.status} (${loc(`detail.reason.${l.reason}`)})`).join(", ") }));
  if (entry.immune?.length) parts.push(loc("detail.immune", { names: entry.immune.map((i) => conditionLabel(i.condition)).join(", "), by: [...new Set(entry.immune.map((i) => i.label))].join(", ") }));
  if (entry.already?.length) parts.push(loc("detail.already", { names: entry.already.map(conditionLabel).join(", ") }));
  if (entry.awaits && entry.state === "applied") parts.push(loc("detail.awaitsFail"));
  if (row.type === "conditionRemove" && entry.state === "applied" && !entry.lifted?.length && !entry.listed?.length) parts.push(loc("detail.nothingToLift"));
  if (row.type === "slay" && entry.state === "applied" && entry.saved !== true) parts.push(loc("detail.slain"));
  if (entry.why && entry.state === "refused") parts.push(loc(`detail.why.${["badItem", "overCount"].includes(entry.why) ? entry.why : "failed"}`));
  return parts.join(" · ");
}

/** The tooltip of a kind's applied entry: a slay's hit points from and to, the spell's page reference on every kind. */
function kindTip(row, entry, card, loc) {
  const cite = card.cite ? loc("tip.cite", { cite: card.cite }) : "";
  if (row.type === "slay" && entry?.state === "applied" && entry.saved !== true && Number.isFinite(entry.before)) return [loc("tip.slayHp", { before: entry.before, after: entry.after }), cite].filter(Boolean).join(" · ");
  return cite;
}

/** The buttons one entry offers this seat. A modifier entry's Undo says it takes the whole group off. */
function entryActions(entry, ids, { isGM, canPress }, loc, { group = false, name = "" } = {}) {
  const out = [];
  const data = { target: ids.targetKey, row: ids.rowKey };
  if (entry?.state === "pending" && canPress) out.push({ action: CARD_ACTIONS.apply, label: loc("button.apply"), icon: "fa-solid fa-check", data });
  if (entry?.state === "throw" && canPress) out.push({ action: CARD_ACTIONS.throw, label: loc("button.throw"), icon: "fa-solid fa-dice-d20", data });
  if (entry?.state === "applied" && isGM && (entry.applied > 0 || entry.recordIds?.length || entry.lifted?.length || entry.destroyed)) {
    const tooltip = group ? loc("tip.undoGroup", { name }) : entry.destroyed ? loc("tip.undoDestroyed") : entry.lifted?.length ? loc("tip.undoLifted") : loc("tip.undo");
    out.push({ action: CARD_ACTIONS.undo, label: loc("button.undo"), icon: "fa-solid fa-rotate-left", data, tooltip });
  }
  return out;
}

/**
 * The press a pending entry of a recurring prompt offers this seat (`cast-recur.mjs`): Save where the row asks its
 * bearer for a throw, to the bearer's owners and the Judge; Roll where it asks none, to the caster's owners and the Judge.
 */
function recurActions(entry, ids, row, { maySave, mayRoll }, loc) {
  if (entry?.state !== "pending") return [];
  const data = { target: ids.targetKey, row: ids.rowKey };
  if (row.recur?.save) return maySave ? [{ action: CARD_ACTIONS.save, label: loc("button.save"), icon: "fa-solid fa-shield-halved", data, tooltip: loc("tip.recurSave") }] : [];
  return mayRoll ? [{ action: CARD_ACTIONS.roll, label: loc("button.roll"), icon: "fa-solid fa-dice", data, tooltip: loc("tip.recurRoll") }] : [];
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
 * The footnote lines a stored summoning (`card.summoned`) is worded as for one
 * seat: the creature's name where the seat is a GM or `opens` says it can open
 * the creature, else the neutral label; a line for the creatures that stand, and
 * one for any click that placed none. A card with no record has none.
 */
function summonedLines(summoned, seat, loc) {
  if (!summoned) return [];
  const opens = seat.isGM === true || seat.opens?.(summoned.sourceUuid) === true;
  const name = seatLabel({ name: summoned.name || loc("dialog.summonCreature"), opens, neutral: game.i18n.localize("ACKS-LIB.summons.neutral") });
  const lines = [loc(summoned.duration ? "line.summoned" : "line.summonedOpen", { name, n: summoned.n, duration: summoned.duration })];
  if (summoned.short > 0) lines.push(loc("line.summonShort", { n: summoned.short }));
  return lines;
}

/**
 * The roll card a cast card is drawn as, for one seat.
 *
 * @param {object} card  the model
 * @param {{isGM: boolean, canPress: boolean, ownsTarget?: (target: object) => boolean, opens?: (uuid: string) => boolean}} seat  `ownsTarget` says whether the seat owns a card target's actor; absent, no target is. `opens` says whether the seat can open the creature a summoning's uuid names; absent, none can but a GM
 * @param {(key: string, data?: object) => string} loc  the cast's strings, under the magic root's `cast` branch
 * @returns {object} `renderRollCard`'s argument
 */
export function castCardView(card, seat, loc) {
  // What the tradition's procedure performed stands above the rows' sections.
  const sections = card.procedure?.section ? [card.procedure.section] : [];
  const targets = Object.entries(card.targets ?? {});
  for (const rowKey of card.order ?? []) {
    const row = card.rows?.[rowKey];
    if (!row) continue;
    const isMod = isModRow(row);
    const rows = [];
    for (const [targetKey, target] of targets) {
      const entry = card.entries?.[`${targetKey}_${rowKey}`];
      // A row with a throw was resisted by the throw, not by the spell's save.
      // A buff is not resisted either, and neither is a row the target is exempt from: it makes no save for it.
      const exempt = entry?.state === "exempt" ? gateTip(entry.gate, loc, { name: target.name, cite: card.cite }) : "";
      const resist = row.delivery || isMod || entry?.state === "exempt" ? null : (target.resist ?? null);
      const done = entry?.state === "applied" || entry?.state === "undone";
      const yields = card.yields?.[`${targetKey}_${rowKey}`];
      // The defense a figure names is the Judge's and the target's owners' to read; every other seat reads "a defense".
      const named = namesDefense({ isGM: seat.isGM === true, ownsTarget: seat.ownsTarget?.(target) === true });
      const judged = entry?.state === "judge" && entry.defense ? entry.defense : null;
      // A prompt names a bearer only for the rows it meets: the others have no entry and no line.
      if (card.recur && !entry) continue;
      const mayRoll = seat.isGM === true || seat.ownsCaster === true;
      const maySave = seat.isGM === true || seat.ownsTarget?.(target) === true;
      const line = isMod
        ? {
            name: target.name,
            total: done && row.total != null ? row.total : "—",
            tooltipText: exempt || partTip(row, card, targetKey, loc),
            detail: yields ? loc("detail.yields", { name: yields }) : row.mode === "set" ? loc("detail.setFigure") : "",
            ...outcomeOf(entry, loc),
            actions: entryActions(entry, { targetKey, rowKey }, seat, loc, { group: true, name: target.name }),
          }
        : {
            name: target.name,
            total: done && entry.applied != null ? entry.applied : "—",
            // A defense the module does not price leaves the entry to the Judge: its line names the defense and the tooltip is the page reference alone.
            tooltipText: exempt || (judged ? defenseCiteOf(judged) : kindOf(row.type) && !entry?.life ? kindTip(row, entry, card, loc) : entry?.life ? lifeTip(entry.life, card, loc) : Array.isArray(entry?.instances) ? instancesEntryTip(entry, loc, named) : entry ? appliedTip(entry, loc, named) : ""),
            // The Judge applies it by hand, so the figure rolled stays on the line beside the defense.
            detail: [
              judged ? loc("detail.judgeDefense", { defense: defenseWord(judged, named), cite: defenseCiteOf(judged) }) : "",
              kindDetail(row, entry, loc),
              throwDetail(entry, loc),
              lifeDetail(entry?.life, loc),
            ]
              .filter(Boolean)
              .join(" · "),
            ...outcomeOf(entry, loc),
            // A prompt's entries are pressed through Save and Roll, never Apply; its applied entries keep the Judge's Undo.
            actions: card.recur
              ? [...recurActions(entry, { targetKey, rowKey }, row, { maySave, mayRoll }, loc), ...entryActions(entry, { targetKey, rowKey }, { ...seat, canPress: false }, loc)]
              : entryActions(entry, { targetKey, rowKey }, seat, loc),
          };
      if (resist?.noSave) {
        Object.assign(line, { targetText: loc("save.none"), targetTooltip: gateTip(resist.noSave, loc, { name: target.name, cite: card.cite }), detail: [loc("detail.noSave"), line.detail].filter(Boolean).join(" · ") });
      } else if (resist) {
        const shown = resist.auto ? loc("detail.saveAuto", { defense: defenseWord(resist.auto, named) }) : loc("detail.save", { total: resist.total });
        Object.assign(line, { ...(resist.auto ? { targetText: loc("save.auto") } : { target: resist.target }), targetTooltip: saveTip(resist, loc, named), detail: [shown, line.detail].filter(Boolean).join(" · ") });
      }
      rows.push(line);
    }
    // A pick row of a prompt has no target until it is pressed: one line with the caster's Roll, which takes the presser's one target.
    if (card.recur && (card.recur.pick ?? []).includes(rowKey) && !Object.keys(card.entries ?? {}).some((id) => id.endsWith(`_${rowKey}`))) {
      const mayRoll = seat.isGM === true || seat.ownsCaster === true;
      rows.push({
        name: loc("recur.pick"),
        total: "—",
        tooltipText: rollTip(row, card, loc),
        actions: mayRoll ? [{ action: CARD_ACTIONS.roll, label: loc("button.roll"), icon: "fa-solid fa-dice", data: { row: rowKey }, tooltip: loc("tip.recurPick") }] : [],
      });
    }
    if (!targets.length && !card.recur) {
      const needsThrow = Boolean(row.delivery);
      rows.push({
        name: loc("noTarget"),
        total: row.total ?? "—",
        tooltipText: isMod ? partTip(row, card, "", loc) : rollTip(row, card, loc),
        actions: needsThrow && !row.blank && seat.canPress ? [{ action: CARD_ACTIONS.throw, label: loc("button.throw"), icon: "fa-solid fa-dice-d20", data: { row: rowKey } }] : [],
      });
    }
    const cite = card.cite ? loc("tip.cite", { cite: card.cite }) : "";
    sections.push({ title: titleOf(row, loc), titleTooltip: isMod ? cite : rollTip(row, card, loc), rows });
  }
  const loose = !card.recur && !targets.length && (card.order ?? []).some((k) => !card.rows?.[k]?.delivery);
  const buttons = loose && seat.canPress ? [{ action: CARD_ACTIONS.applyTargets, label: loc("button.applyTargets"), icon: "fa-solid fa-crosshairs", tooltip: loc("tip.applyTargets") }] : [];
  // A cast with a recurring row offers its caster's seat and the Judge the round's prompts by hand, for a cast no fight keeps.
  if (card.recurs && !card.recur && (seat.isGM === true || seat.ownsCaster === true)) {
    buttons.push({ action: CARD_ACTIONS.nextRound, label: loc("button.nextRound"), icon: "fa-solid fa-forward-step", tooltip: loc("tip.nextRound") });
  }
  // The Judge's revert of a performed step, until it has been pressed.
  if (seat.isGM === true && card.procedure && card.procedure.undo != null && card.procedure.reverted !== true) {
    buttons.push({ action: CARD_ACTIONS.revert, label: loc("button.revert"), icon: "fa-solid fa-rotate-left", tooltip: loc("tip.revert") });
  }
  return {
    title: card.recur ? loc("recur.title", { name: card.spellName }) : card.spellName,
    subtitle: card.casterName ?? "",
    note: card.recur
      ? [loc(`recur.moment.${card.recur.moment}`), loc("recur.round", { round: card.recur.round })].join(" · ")
      : [card.mode === "reversed" ? loc("note.reversed") : "", card.casterLevel?.value ? loc("note.level", { value: card.casterLevel.value }) : "", card.invocationLevel ? loc("note.invocation", { value: card.invocationLevel }) : "", castingTimeNote(card, loc)].filter(Boolean).join(" · "),
    noteTooltip: noteTip(card, loc),
    sections,
    bare: true,
    footnote: [...summonedLines(card.summoned, seat, loc), ...(card.lines ?? [])].join(" · "),
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
export async function postCastCard(card, { rolls = [], mode = "public", speaker, flags = {} } = {}) {
  const data = {
    speaker: speaker ?? ChatMessage.getSpeaker(),
    content: castCardContent(card, cardLoc),
    rolls,
    flags: { [MODULE_ID]: { ...flags, [CAST_CARD_FLAG]: card } },
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

/** Mark a card's performed step as reverted, so its button goes and a second press does nothing. */
export async function markReverted(message) {
  const next = { ...cardOf(message), procedure: { ...cardOf(message)?.procedure, reverted: true } };
  return message.update({
    [`flags.${MODULE_ID}.${CAST_CARD_FLAG}.procedure.reverted`]: true,
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

/** Does this seat own the actor a card target names? The target's uuid is read as it stands; a target no longer in the world is no one's. */
function ownsCardTarget(target) {
  const doc = docOf(target?.uuid);
  const actor = doc?.documentName === "Token" ? doc.actor : doc?.documentName === "Actor" ? doc : null;
  return actor?.testUserPermission?.(game.user, "OWNER") === true;
}

/** Can this seat's user open the creature a uuid names? Foundry's own test (`creatureOpens`), the document read as it stands. */
const opensCreature = (uuid) => creatureOpens(docOf(uuid), game.user, { packOf: worldPackOf });

/** The handlers the card's buttons call, set by the cast engine; a card with none presses nothing. */
let actions = {};

/** Rebuild one rendered card for this seat and bind its buttons. */
function onRender(message, html) {
  const card = cardOf(message);
  const root = html?.nodeType === 1 ? html : (html?.[0] ?? null);
  if (!card || !root) return;
  const body = root.querySelector?.(".message-content");
  if (!body) return;
  const seat = { isGM: game.user.isGM, canPress: canPressCard(message), ownsTarget: ownsCardTarget, opens: opensCreature, ownsCaster: docOf(card.casterUuid)?.testUserPermission?.(game.user, "OWNER") === true };
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
