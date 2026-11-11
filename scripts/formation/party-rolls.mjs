/* global game, Roll, ui */
import { makeLoc } from "../lib/util.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { MODULE_ID } from "./constants.mjs";
import { itemHasCapability, overrideFor } from "./ability-bridge.mjs";
import { getMemberActor, hasAbility, isDown, isHurried, updateFormation } from "./formation-model.mjs";
import { BASH_STR_FACTOR, bashStrBonus } from "./doors.mjs";
import { abilityMod } from "../lib/actor-read.mjs";
import { advanceRounds, advanceTurns } from "./turn-engine.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { rollMath, subjectOf } from "../lib/conditions.mjs";
import { measures, rollsOf } from "../abilities/ability-rolls.mjs";
import { adventuringThrow, skillThrow } from "../abilities/adventuring-throw.mjs";

export { hasAbility };

/**
 * Party rolls pulled from the character sheets, not generic dice.
 *
 * Each member's target is the abilities' own figure for the throw, before the
 * creature's conditions, which this file applies once as a named part:
 *   1. a matching class-power / proficiency **ability item** on the sheet
 *      (e.g. a thief's Searching skill): the throw named by `rollKey`, read by
 *      the abilities roller (`skillThrow`), so the ladder, the borrowed
 *      progression and every bonus the character's other abilities carry are
 *      already in the target and the die stays a bare d20;
 *   2. the character's **Adventuring** figure (`adventuringThrow`): the stored
 *      field, or the throw of an ability that stands in for it, lowered by the
 *      bonuses that name the activity.
 * Candidates, the Judge's Throw bonus, the once-per-turn limit, the time a check
 * costs and the Strength a bash adds are this file's; no figure and no
 * ability's name is.
 *
 * Searching/listening throws are Judge-secret (RR p. 265), so results post as
 * ONE compact GM-whispered card rather than public per-member cards. RAW
 * constraints are enforced or reminded:
 *   - hasty search: skill users only;
 *   - methodical search: takes a full turn (auto-advanced);
 *   - listening: once per turn while the party is moving (tracked, warned).
 */

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
    rollKey: "hasty",
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
    rollKey: "methodical",
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
    strScaled: true, // Strength counts at BASH_STR_FACTOR per point (doors.mjs owns the factor)
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
    advKey: null, // not permitted via Adventuring (RR p. 267)
    pattern: /trap\s*break|trapbreaking|remove\s*traps?|disarm\s*traps?/i,
    rollKey: "hasty",
    note: "ACKS-FORMATION.rolls.trapbreakHastyNote",
  },
  trapbreakMethodical: {
    flagKey: "trapbreak",
    capability: "kw:trapbreaking",
    solo: true,
    label: "ACKS-FORMATION.rolls.trapbreakMethodical",
    hint: "ACKS-FORMATION.rolls.trapbreakMethodicalHint",
    icon: "fa-screwdriver-wrench",
    advKey: "trapbreaking", // a non-thief may try methodically, on the sheet's Adventuring target
    pattern: /trap\s*break|trapbreaking|remove\s*traps?|disarm\s*traps?/i,
    rollKey: "methodical",
    note: "ACKS-FORMATION.rolls.trapbreakMethodicalNote",
    consumesTurn: true,
  },
  tracking: {
    flagKey: "track",
    capability: "kw:tracking",
    label: "ACKS-FORMATION.rolls.tracking",
    hint: "ACKS-FORMATION.rolls.trackingHint",
    icon: "fa-paw",
    advKey: null, // proficients only (Tracking, RR p. 120)
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

/**
 * Does an item matched only by name carry a throw to use? A stored sheet target,
 * or a throw that moves with level or rank (a ladder or a borrowed progression
 * resolves to zero or less at high level, so the sheet target alone would shut
 * it out).
 */
const nameMatchHasThrow = (item) =>
  Number(item.system?.rollTarget) > 0 ||
  rollsOf(item).some((roll) => !measures(roll) && roll.target && typeof roll.target === "object" && (roll.target.kind ?? "flat") !== "flat");

function skillCandidates(actor, cfg) {
  return actor.items.filter((i) => {
    if (i.type !== ITEM_TYPE.ability) return false;
    if (!skillGateAllows(i)) return false;

    // 1. Capability — precise, and immune to renaming.
    if (cfg.capability && itemHasCapability(i, cfg.capability)) return true;

    // 2. Explicit binding designates ANY item for this roll.
    const checkKey = i.getFlag?.(MODULE_ID, "checkKey");
    if (checkKey) return checkKey === cfg.flagKey;

    // 3. Name match.
    return cfg.pattern.test(i.name) && nameMatchHasThrow(i);
  });
}

/** A part as a card prints it: signed, with a true minus, then its name. */
export const partText = (part) => `${part.value < 0 ? "−" : "+"}${Math.abs(part.value)} ${part.label}`;

/**
 * What the creature's conditions do to a proficiency throw, as a signed bonus
 * (a penalty is negative); 0 with no conditions.
 */
const conditionBonus = (actor) => rollMath("throw", subjectOf(actor)).total;

/**
 * The member's best skill throw for the check: of the candidates, the lowest
 * target, each read at the check's `rollKey` (the item's default throw where it
 * has none by that key) and lowered by the Judge's Throw bonus on the item. A
 * candidate with no figure, or one that is automatic or not open to the
 * character, is passed over, so it cannot shadow the Adventuring fallback.
 */
function bestSkill(actor, cfg) {
  let best = null;
  for (const item of skillCandidates(actor, cfg)) {
    const found = skillThrow(actor, item, cfg.rollKey ?? null, { fallback: true });
    if (!found) continue;
    // The GM's flat throw adjustment (Skill tab): +N bonus = target N lower.
    const mod = Number(item.getFlag?.(MODULE_ID, "targetMod")) || 0;
    const target = found.target - mod;
    if (!best || target < best.target) best = { item, found, mod, target };
  }
  return best;
}

/**
 * Resolve one member's throw: `{target, source, bonus, parts, skilled}` or null.
 *
 * The target is the abilities' own figure (`skillThrow`, else
 * `adventuringThrow`) with every bonus the character's abilities carry already
 * in it, so the die rolled against it is a bare d20 and `bonus` is 0. The
 * creature's conditions are then applied once, here. `parts` itemizes what
 * moved the target, one entry per ability, the Judge's Throw bonus and the
 * conditions, each `{label, value, cite?}` with a positive value lowering the
 * target. With several matching skill items the BEST (lowest) target is used.
 */
export function resolveCheck(actor, cfg) {
  const loc = (key) => game.i18n.localize(`ACKS-FORMATION.${key}`);
  const abilityParts = (list) =>
    (list ?? []).filter((p) => p.kind !== "conditions").map(({ label, value, cite }) => ({ label, value, ...(cite ? { cite } : {}) }));
  let found = null;

  const best = bestSkill(actor, cfg);
  if (best) {
    const parts = abilityParts(best.found.parts);
    if (best.mod) parts.push({ label: loc("rolls.partThrowBonus"), value: best.mod });
    const level = Number(actor.system?.details?.level) || 1;
    const modTag = best.mod ? ` [${best.mod > 0 ? "+" : ""}${best.mod}]` : "";
    found = {
      target: best.target,
      source: (best.found.scaled ? `${best.item.name} (L${level})` : best.item.name) + modTag,
      parts,
      skilled: true,
    };
  } else if (cfg.advKey) {
    const adv = adventuringThrow(actor, cfg.advKey, { allow: skillGateAllows });
    if (adv.target == null) return null;
    const via = loc("rolls.viaAdventuring");
    const by = adv.source === "standIn" ? adv.standIn.name : adv.source === "skill" ? adv.skillName : "";
    found = { target: adv.target, source: by ? `${via} (${by})` : via, parts: abilityParts(adv.parts), skilled: false };
  }
  if (!found) return null;

  const conditions = conditionBonus(actor);
  if (conditions) found.parts.push({ label: loc("audit.part.conditions"), value: conditions });
  return { ...found, target: found.target - conditions, bonus: 0 };
}

/**
 * Which party checks take this ability item, and by which route, in the order
 * `PARTY_CHECKS` lists them: `capability` (the check's token), `binding` (the
 * item's `checkKey` flag) or `name` (the check's name pattern, for an item the
 * register has not tagged that carries a target or a progression). The one
 * reading of a binding, shared by the audit's roster and its roll. It reads the
 * item alone; whether the item is switched off is `skillGateAllows`.
 *
 * @returns {Array<{checkKey: string, cfg: object, route: "capability"|"binding"|"name"}>}
 */
export function boundChecks(item) {
  const out = [];
  for (const [checkKey, cfg] of Object.entries(PARTY_CHECKS)) {
    let route = null;
    if (cfg.capability && itemHasCapability(item, cfg.capability)) route = "capability";
    else if (item.getFlag(MODULE_ID, "checkKey") === cfg.flagKey) route = "binding";
    else if (!item.getFlag(MODULE_ID, "checkKey") && cfg.pattern.test(item.name) && nameMatchHasThrow(item)) {
      route = "name";
    }
    if (route) out.push({ checkKey, cfg, route });
  }
  return out;
}

/**
 * Roll one member's party check without posting: the throw `resolveCheck`
 * resolves, the Strength a bash adds, the die, and the row a card prints for it.
 * The one place a member's party-check throw is made, so the party card and the
 * audit's roll cannot disagree about a target.
 *
 * @param {Actor} actor
 * @param {object} cfg a `PARTY_CHECKS` entry
 * @returns {Promise<{roll: Roll, check: object, row: {name: string, total: number, target: number, source: string, sourceTip: string, success: boolean}}|null>}
 *   null when the member cannot attempt the check; `source` is the card's
 *   detail line and `sourceTip` the same with the page each part cites
 */
export async function rollCheckFor(actor, cfg) {
  const check = resolveCheck(actor, cfg);
  if (!check) return null;
  let bonus = check.bonus;
  if (cfg.strScaled) bonus += bashStrBonus(abilityMod(actor, "str"));
  const formula = bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20";
  const roll = await new Roll(formula).evaluate();
  const strPart = cfg.strScaled ? [`${bonus - check.bonus >= 0 ? "+" : ""}${bonus - check.bonus} STR×${BASH_STR_FACTOR}`] : [];
  const breakdown = (check.parts ?? []).map(partText).concat(strPart).join(", ");
  // The same parts with the page each ability's import names, for the target's tooltip.
  const cited = (check.parts ?? []).map((part) => `${partText(part)}${part.cite ? ` (${part.cite})` : ""}`).concat(strPart).join(", ");
  return {
    roll,
    check,
    row: {
      name: actor.name,
      total: roll.total,
      target: check.target,
      source: breakdown ? `${check.source}; ${breakdown}` : check.source,
      sourceTip: cited ? `${check.source}; ${cited}` : check.source,
      success: roll.total >= check.target,
    },
  };
}

/**
 * Roll a party check for every capable member and whisper one summary card to
 * the GMs. Returns the number of members who rolled.
 * @param {object} formation
 * @param {string} checkKey A `PARTY_CHECKS` key.
 * @param {object} [opts]
 * @param {string[]|null} [opts.only] Roll for these members alone (the turn
 *   plan's searchers or listeners); null rolls for the whole party.
 * @param {boolean} [opts.spend] Spend the check's time on the clock. The turn
 *   plan passes false: its turn is spent once, before anything resolves.
 * @returns {Promise<number>}
 */
export async function rollPartyCheck(formation, checkKey, { only = null, spend = true } = {}) {
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
    // While the party is moving it listens once per turn (RR p. 265).
    // Enforced; a stationary party may listen repeatedly.
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
    if (only && !only.includes(member?.actorId)) continue;
    const actor = getMemberActor(member);
    if (!actor || isDown(actor, member)) continue;
    const rolled = await rollCheckFor(actor, cfg);
    if (!rolled) {
      incapable.push(actor.name);
      continue;
    }
    rolls.push(rolled.roll);
    rows.push(rolled.row);
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
          targetTooltip: game.i18n.format("ACKS-FORMATION.audit.checkTip", { target: `${row.target}+`, source: row.sourceTip }),
          outcome: game.i18n.localize(`ACKS-FORMATION.rolls.${row.success ? "success" : "failure"}`),
          emphasis: row.success ? "success" : "failure",
        })),
      },
    ],
    footnote: incapable.length ? loc("rolls.notCapable", { names: incapable.join(", ") }) : undefined,
  });

  await postToJudges({ content: html, rolls, speaker: { alias: formation.name } });

  // Time cost: methodical actions occupy a full turn, hasty ones a round.
  if (!spend) return rows.length;
  if (cfg.consumesTurn) await advanceTurns(formation, 1, { reason: "search" });
  else if (cfg.consumesRound) await advanceRounds(formation, 1, { reason: "action" });
  return rows.length;
}

