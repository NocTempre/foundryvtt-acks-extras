/* global game, ChatMessage, Roll, ui */
import { makeLoc } from "../lib/util.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { MODULE_ID } from "./constants.mjs";
import {
  hasCapability,
  itemHasCapability,
  importedLadderTarget,
  importedThrowTarget,
  overrideFor,
} from "./ability-bridge.mjs";
import { getMemberActor, hasAbility, isDown, isHurried, updateFormation } from "./formation-model.mjs";
import { advanceRounds, advanceTurns } from "./turn-engine.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

export { hasAbility };

/**
 * Party rolls pulled from the character sheets, not generic dice:
 *
 * For each member the throw target comes from, in order of fidelity:
 *   1. a matching class-power / proficiency **ability item** on the sheet
 *      (e.g. a thief's "Searching 16+": `system.rollTarget`), with the RAW
 *      +4 methodical bonus applied for skill users where it applies;
 *   2. the sheet's **Adventuring proficiency** target
 *      (`system.adventuring.{listening,searching,dungeonbashing,…}`), which
 *      the GM can tune per character (e.g. 14+ for Alertness).
 *
 * Searching/listening throws are Judge-secret (RR p. 265), so results post as
 * ONE compact GM-whispered card rather than public per-member cards. RAW
 * constraints are enforced or reminded:
 *   - hasty search: skill users only ("Using Adventuring: not permitted");
 *   - methodical search: takes a full turn (auto-advanced);
 *   - listening: once per turn while the party is moving (tracked, warned).
 */

/**
 * Alertness (or an equivalent power: Mindfulness, Alien Senses, Keen Insect
 * Senses, Attunement to Nature): Adventuring search/listen at 14+ instead of
 * 18+, or +2 on the throw for those separately skilled (RR p. 105).
 */
const ALERTNESS_PATTERN = /alertness|mindfulness|alien senses|keen insect|attunement to nature/i;
/**
 * Attunement to Nature: +4 (not +2) with the Listening skill, per JJ p.311.
 * It is NOT an alias of Alertness precisely because this value differs, which
 * is why it keeps its own pattern rather than folding into the one above.
 */
const ATTUNEMENT_PATTERN = /attunement to nature/i;
/** Trapfinding: +2 on Searching (and Trapbreaking) throws (RR p. 121). */
const TRAPFINDING_PATTERN = /trapfinding/i;

/**
 * Capability tokens (acks-lib). An ability implicitly provides its own id's
 * capability, so `def.prof.trapfinding` satisfies `kw:trapfinding` with nothing
 * tagged — these resolve against imported content today.
 */
const CAP_ALERTNESS = "kw:alertness";
const CAP_TRAPFINDING = "kw:trapfinding";

export const PARTY_CHECKS = Object.freeze({
  listen: {
    flagKey: "listen",
    capability: "kw:listening",
    consumesRound: true, // 1 round to pause and listen
    label: "ACKS-FORMATION.rolls.listen",
    hint: "ACKS-FORMATION.rolls.listenHint",
    icon: "fa-ear-listen",
    advKey: "listening",
    pattern: /listen|hear\s*noise|eavesdrop/i,
    alertness: true,
    note: "ACKS-FORMATION.rolls.listenNote",
    oncePerTurn: true,
  },
  searchHasty: {
    flagKey: "search",
    capability: "kw:searching",
    blockedWhenHurried: true, // RR p. 263: no hasty searching at combat speed
    consumesRound: true, // hasty search takes 1 round
    label: "ACKS-FORMATION.rolls.searchHasty",
    hint: "ACKS-FORMATION.rolls.searchHastyHint",
    icon: "fa-magnifying-glass",
    advKey: null, // not permitted via Adventuring
    pattern: /search/i,
    alertness: true,
    trapfinding: true,
    note: "ACKS-FORMATION.rolls.searchHastyNote",
  },
  searchMethodical: {
    flagKey: "search",
    capability: "kw:searching",
    label: "ACKS-FORMATION.rolls.searchMethodical",
    hint: "ACKS-FORMATION.rolls.searchMethodicalHint",
    icon: "fa-magnifying-glass-plus",
    advKey: "searching",
    pattern: /search/i,
    skillBonus: 4, // Searching skill methodically: +4 (RR p. 265)
    alertness: true,
    trapfinding: true,
    note: "ACKS-FORMATION.rolls.searchMethodicalNote",
    consumesTurn: true,
  },
  dungeonbashing: {
    flagKey: "bash",
    capability: null, // no register node: dungeon bashing is an Adventuring throw
    consumesRound: true, // bashing a door takes 1 round
    label: "ACKS-FORMATION.rolls.bash",
    hint: "ACKS-FORMATION.rolls.bashHint",
    icon: "fa-door-open",
    advKey: "dungeonbashing",
    pattern: /dungeon\s*bash|open\s*doors?\b|force\s*open/i,
    strTimes4: true, // ±4 per point of STR modifier (RR p. 266)
    note: "ACKS-FORMATION.rolls.bashNote",
  },
  /*
   * The two Trapbreaking columns. Both are `solo`: disarming is one character
   * lying in the dirt with a set of picks, never the whole party rolling at
   * once, so they are configuration for `resolveCheck` and for the skill audit
   * rather than buttons on the party sheet. `trap-zone.mjs` drives them.
   */
  trapbreakHasty: {
    flagKey: "trapbreak",
    capability: "kw:trapbreaking",
    solo: true,
    consumesRound: true, // 1 round
    label: "ACKS-FORMATION.rolls.trapbreakHasty",
    hint: "ACKS-FORMATION.rolls.trapbreakHastyHint",
    icon: "fa-screwdriver-wrench",
    advKey: null, // "Using Adventuring: not permitted"
    pattern: /trap\s*break|trapbreaking|remove\s*traps?|disarm\s*traps?/i,
    trapfinding: true, // RR p. 121: Trapfinding is +2 on Trapbreaking as well
    note: "ACKS-FORMATION.rolls.trapbreakHastyNote",
  },
  trapbreakMethodical: {
    flagKey: "trapbreak",
    capability: "kw:trapbreaking",
    solo: true,
    label: "ACKS-FORMATION.rolls.trapbreakMethodical",
    hint: "ACKS-FORMATION.rolls.trapbreakMethodicalHint",
    icon: "fa-screwdriver-wrench",
    advKey: "trapbreaking", // a non-thief may try methodically (18+ on the sheet)
    pattern: /trap\s*break|trapbreaking|remove\s*traps?|disarm\s*traps?/i,
    skillBonus: 4, // Trapbreaking used methodically: +4
    trapfinding: true,
    note: "ACKS-FORMATION.rolls.trapbreakMethodicalNote",
    consumesTurn: true,
  },
  tracking: {
    flagKey: "track",
    capability: "kw:tracking",
    label: "ACKS-FORMATION.rolls.tracking",
    hint: "ACKS-FORMATION.rolls.trackingHint",
    icon: "fa-paw",
    advKey: null, // proficients only (Tracking 11+, RR p. 121)
    pattern: /tracking/i,
    note: "ACKS-FORMATION.rolls.trackingNote",
    consumesTurn: true,
  },
});

const loc = makeLoc("ACKS-FORMATION");

/**
 * All rollable ability items matching the check on this actor's sheet.
 *
 * Three routes, unioned so no route can lose a member the others would find:
 *   1. the check's **capability** token (`kw:searching`) — catches every
 *      printing of the mechanic regardless of the item's name;
 *   2. an explicit `checkKey` flag — the GM binding any item as a custom skill;
 *   3. the **name pattern** — the original route, still needed for abilities
 *      the register has not tagged (Eavesdropping does not yet declare
 *      `kw:listening`) and for hand-made items with no cookbook id.
 */
/**
 * The eligibility gate party rolls apply BEFORE any route matching, exported so
 * the audit window reports exactly what rollPartyCheck will do. A GM ruling
 * from the audit window is final in both directions and outranks the per-item
 * Skill checkbox — it is the surface that shows what automation decided, so it
 * has to be able to overturn it. With no ruling, unchecking "Skill" on the
 * item sheet withdraws the item from party rolls even if its bindings remain
 * (re-checking restores them).
 */
export function skillGateAllows(item) {
  const ruling = overrideFor(item);
  if (ruling === false) return false;
  if (ruling !== true && item.getFlag?.(MODULE_ID, "isSkill") === false) return false;
  return true;
}

function skillCandidates(actor, cfg) {
  return actor.items.filter((i) => {
    if (i.type !== ITEM_TYPE.ability) return false;
    if (!skillGateAllows(i)) return false;

    // 1. Capability — precise, and immune to renaming.
    if (cfg.capability && itemHasCapability(i, cfg.capability)) return true;

    // 2. Explicit binding designates ANY item for this roll.
    const checkKey = i.getFlag?.(MODULE_ID, "checkKey");
    if (checkKey) return checkKey === cfg.flagKey;

    // 3. Name match. Auto-scaling items qualify regardless of stored target
    //    (high-level thief targets are 0 or negative).
    return (
      cfg.pattern.test(i.name) &&
      (i.getFlag?.(MODULE_ID, "thiefSkill") || Number(i.system?.rollTarget) > 0)
    );
  });
}

/**
 * The skill a cookbook identity (`def.skill.<key>`) names, for display and for
 * borrowing a ladder. An imported skill carries its own ladder, so this is not
 * what makes it scale — see `scaledSkillTarget`.
 */
export function inferredThiefSkill(item) {
  // Raw flag path, never getFlag: the importer need not be active (getFlag
  // throws for an inactive scope) while the data it wrote persists on the item.
  const id = item.flags?.["acks-importer"]?.cookbook?.id ?? "";
  return /^def\.skill\.([a-zA-Z]+)$/.exec(id)?.[1] ?? null;
}

/**
 * Skill items auto-scale from the owner's level. Every number comes from the
 * GM's own book by way of acks-content — this module ships no ladder:
 *   1. an explicit `thiefSkill` flag names the skill to scale AS, and that
 *      skill's imported definition supplies the ladder (the GM's binding is a
 *      deliberate override, so it is consulted first);
 *   2. otherwise the ladder the item itself carries (acks-abilities extras),
 *      resolved at the owner's factored level — this covers every imported
 *      skill with no setup at all, and flat printed targets like the Listening
 *      proficiency's 14+ land here too;
 *   3. otherwise the item's cookbook IDENTITY names its skill, so a copy that
 *      carries `def.skill.<key>` but no ladder of its own — imported before the
 *      book was connected, or tagged by hand — still borrows the real one.
 * Anything else returns null and the caller falls back to sheet rollTarget —
 * which is exactly what a `thiefSkill`-flagged item does when that skill has
 * not been imported into this world yet.
 */
export function scaledSkillTarget(actor, item) {
  const factor = Number(item.getFlag(MODULE_ID, "levelFactor")) || 1;
  const level = Math.max(1, Math.ceil((actor.system?.details?.level ?? 1) * factor));
  const key = item.getFlag?.(MODULE_ID, "thiefSkill");
  if (key) {
    const borrowed = importedLadderTarget(key, actor, level);
    if (borrowed !== null) return { target: borrowed, level };
  }
  const imported = importedThrowTarget(item, level);
  if (imported !== null) return { target: imported, level };
  const inferred = key ? null : inferredThiefSkill(item);
  if (inferred) {
    const borrowed = importedLadderTarget(inferred, actor, level);
    if (borrowed !== null) return { target: borrowed, level };
  }
  return null;
}

/**
 * Resolve one member's throw: {target, source, bonus, parts, skilled} or null.
 * Stacking per the references, itemized in `parts` for transparency:
 *  - skilled: methodical +4 (RR p. 265, skill users only), Alertness +2
 *    (Attunement to Nature: +4 with the Listening skill), Trapfinding +2
 *    on searching throws — all cumulative (no anti-stacking text);
 *  - unskilled: Adventuring target, improved to 14+ by Alertness (a target
 *    change, NOT a bonus — it does not stack with itself); Trapfinding's +2
 *    applies to any Searching throw, Adventuring-based included.
 * With several matching skill items, the BEST (lowest) target is used.
 */
export function resolveCheck(actor, cfg) {
  // Capability first (catches every printing of the mechanic), name pattern as
  // the safety net for abilities the register has not tagged yet.
  const alert =
    cfg.alertness && (hasCapability(actor, CAP_ALERTNESS) || hasAbility(actor, ALERTNESS_PATTERN));
  const attuned = cfg.alertness && hasAbility(actor, ATTUNEMENT_PATTERN);
  const trapfinder =
    cfg.trapfinding && (hasCapability(actor, CAP_TRAPFINDING) || hasAbility(actor, TRAPFINDING_PATTERN));
  const parts = [];

  let best = null;
  for (const item of skillCandidates(actor, cfg)) {
    const scaled = scaledSkillTarget(actor, item);
    const raw = scaled?.target ?? Number(item.system.rollTarget);
    // A capability match can arrive with no derivable number at all (a ladder
    // deferring to a class table nothing carries). It must not shadow the
    // Adventuring fallback with a 0/NaN target — skip it and let the next
    // candidate, or the fallback, answer. Scaled targets may legitimately be
    // ≤ 0 at high level; an UNSCALED non-positive rollTarget is just unset.
    if (!Number.isFinite(raw)) continue;
    if (!scaled && raw <= 0) continue;
    // The GM's flat throw adjustment (Skill tab): +N bonus = target N lower.
    const mod = Number(item.getFlag?.(MODULE_ID, "targetMod")) || 0;
    const target = raw - mod;
    if (!best || target < best.target) best = { item, scaled, target, mod };
  }

  if (best) {
    if (cfg.skillBonus) parts.push({ label: game.i18n.localize("ACKS-FORMATION.rolls.partMethodical"), value: cfg.skillBonus });
    if (alert) {
      const value = attuned && cfg.flagKey === "listen" ? 4 : 2;
      parts.push({ label: game.i18n.localize("ACKS-FORMATION.rolls.partAlertness"), value });
    }
    if (trapfinder) parts.push({ label: game.i18n.localize("ACKS-FORMATION.rolls.partTrapfinding"), value: 2 });
    const modTag = best.mod ? ` [${best.mod > 0 ? "+" : ""}${best.mod}]` : "";
    return {
      target: best.target,
      source: (best.scaled ? `${best.item.name} (L${best.scaled.level})` : best.item.name) + modTag,
      bonus: parts.reduce((sum, p) => sum + p.value, 0),
      parts,
      skilled: true,
    };
  }

  if (cfg.advKey && typeof actor.system?.adventuring?.[cfg.advKey] === "number") {
    let target = actor.system.adventuring[cfg.advKey];
    if (alert) target = Math.min(target, 14);
    if (trapfinder) parts.push({ label: game.i18n.localize("ACKS-FORMATION.rolls.partTrapfinding"), value: 2 });
    return {
      target,
      source: game.i18n.localize(
        alert ? "ACKS-FORMATION.rolls.viaAlertness" : "ACKS-FORMATION.rolls.viaAdventuring",
      ),
      bonus: parts.reduce((sum, p) => sum + p.value, 0),
      parts,
      skilled: false,
    };
  }
  return null;
}

/**
 * Roll a party check for every capable member and whisper one summary card to
 * the GMs. Returns the number of members who rolled.
 */
export async function rollPartyCheck(formation, checkKey) {
  const cfg = PARTY_CHECKS[checkKey];
  if (!cfg) return 0;
  // A solo check belongs to one character. Rolling it for the whole party is
  // never what was meant, so it is refused here rather than at each caller.
  if (cfg.solo) return 0;

  if (cfg.blockedWhenHurried && isHurried(formation)) {
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.rolls.noHastyHurried"));
    return 0;
  }

  const preNotes = [];

  if (cfg.oncePerTurn) {
    // RR p. 265: while the party is moving, listening only once per turn —
    // it takes time for people to settle down into quiet. Enforced; a
    // stationary party may listen repeatedly.
    if (formation.clock.movedThisTurn && formation.clock.lastListenTurn === formation.clock.turnsTotal) {
      ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.rolls.alreadyListened"));
      return 0;
    }
    formation.clock.lastListenTurn = formation.clock.turnsTotal;
    await updateFormation(formation);
  }

  const rows = [];
  const rolls = [];
  const incapable = [];
  for (const member of formation.members) {
    const actor = getMemberActor(member);
    if (!actor || isDown(actor)) continue;
    const check = resolveCheck(actor, cfg);
    if (!check) {
      incapable.push(actor.name);
      continue;
    }
    let bonus = check.bonus;
    if (cfg.strTimes4) bonus += 4 * (actor.system?.scores?.str?.mod ?? 0);
    const formula = bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20";
    const roll = await new Roll(formula).evaluate();
    rolls.push(roll);
    const breakdown = (check.parts ?? [])
      .map((part) => `+${part.value} ${part.label}`)
      .concat(cfg.strTimes4 ? [`${bonus - check.bonus >= 0 ? "+" : ""}${bonus - check.bonus} STR×4`] : [])
      .join(", ");
    rows.push({
      name: actor.name,
      total: roll.total,
      target: check.target,
      source: breakdown ? `${check.source}; ${breakdown}` : check.source,
      success: roll.total >= check.target,
    });
  }

  if (!rows.length) {
    ui.notifications.warn(loc("rolls.nobodyCapable", { check: game.i18n.localize(cfg.label) }));
    return 0;
  }

  // One shared renderer for every card where several people rolled at once
  // (lib/roll-card.mjs) — the party's saves and the Surprise Matrix post the
  // same shape, and did so three different ways before.
  const html = renderRollCard({
    title: game.i18n.localize(cfg.label),
    subtitle: formation.name,
    note: [cfg.note ? game.i18n.localize(cfg.note) : null, ...preNotes].filter(Boolean).join(" "),
    sections: [
      {
        rows: rows.map((row) => ({
          name: row.name,
          detail: row.source,
          total: row.total,
          target: row.target,
          outcome: game.i18n.localize(`ACKS-FORMATION.rolls.${row.success ? "success" : "failure"}`),
          emphasis: row.success ? "success" : "failure",
        })),
      },
    ],
    footnote: incapable.length ? loc("rolls.notCapable", { names: incapable.join(", ") }) : undefined,
  });

  await ChatMessage.create({
    content: html,
    rolls,
    whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
    speaker: { alias: formation.name },
  });

  // Time cost: methodical actions occupy a full turn, hasty ones a round.
  if (cfg.consumesTurn) await advanceTurns(formation, 1, { reason: "search" });
  else if (cfg.consumesRound) await advanceRounds(formation, 1, { reason: "action" });
  return rows.length;
}

