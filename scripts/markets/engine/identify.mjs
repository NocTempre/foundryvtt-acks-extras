/* global game, foundry, Hooks, ChatMessage, Roll */
/**
 * Magic-item identification (JJ ch.4 "Identifying Magic Items"): the method
 * ladder, automated. Each method checks what the identifier IS (proficient,
 * casting, merely brave), rolls where the book rolls, and advances the
 * item's `identified` state — `partial` (recognized, method of use, or the
 * combat bonus) or `full` (magic research: exact charges, command words,
 * every property). A failed throw cannot be retried until the identifier
 * gains a level (recorded per method and identifier on the item).
 *
 * Any qualified creature may identify — the party's own characters or their
 * henchmen and hirelings; the caller picks the identifier.
 *
 * The ladder's printed thresholds (the research caster level, the tiers
 * Magical Engineering reaches, the dabbling backfire band) are read from the
 * imported identification table; a method that needs one the table did not
 * yield is not offered, and `methodGaps` says why. A proficiency throw's
 * target is the one the identifier's own imported ability item prints, never
 * a default.
 */
import { MODULE_ID, LANG, ITEM_FLAG, HOOKS } from "../constants.mjs";
import { abilityRanks } from "./trade.mjs";
import { identification, printedError, tableLabel } from "./printed.mjs";
import { inBackfireBand } from "../rules/identification.mjs";
import { getLevel } from "../../henchmen/acks-adapter.mjs";
import { ITEM_TYPE, slug } from "../../lib/vocab.mjs";
import { judgesAndOwners } from "../../lib/util.mjs";

const flagOf = (item) => item.getFlag(MODULE_ID, ITEM_FLAG) ?? {};

/** True when the actor can conduct magic research: the printed caster level, or Loremastery. */
function canResearch(actor, { researchCasterLevel }) {
  if (abilityRanks(actor, "Loremastery") > 0) return true;
  const casts = actor.items.some((i) => i.type === ITEM_TYPE.spell);
  return casts && researchCasterLevel !== null && getLevel(actor) >= researchCasterLevel;
}

/**
 * The proficiency-throw target the identifier's own ability item prints (the
 * imported proficiency carries it), or null when the identifier has no such
 * item or the item prints none.
 */
function throwTarget(actor, abilityName) {
  const wanted = slug(abilityName);
  const ability = actor.items.find((i) => i.type === ITEM_TYPE.ability && slug(i.name) === wanted);
  const target = Number(ability?.system?.rollTarget ?? 0);
  return target > 0 ? target : null;
}

/**
 * The method ladder. `applies(flag, item, printed)` gates on the ITEM
 * (kind/rarity); `qualifies(actor, printed)` on the IDENTIFIER; `throwOf`
 * names the die (null = automatic); `depth` is what success grants; `needs`
 * lists the printed identification values the method cannot run without.
 */
export const METHODS = Object.freeze({
  trialUse: {
    applies: () => true,
    qualifies: () => true,
    throwOf: null,
    depth: "partial",
    risky: true, // curses and poisons fire on trial
  },
  sipPotion: {
    applies: (f) => f.kind === "potion",
    qualifies: () => true,
    throwOf: null,
    depth: "full",
    risky: true,
  },
  weaponBonus: {
    applies: (f, item) => item.type === ITEM_TYPE.weapon || item.type === ITEM_TYPE.armor,
    qualifies: () => true, // proficiency with the weapon is the Judge's call
    throwOf: null,
    depth: "partial",
    risky: true,
  },
  alchemy: {
    applies: (f) => f.kind === "potion",
    qualifies: (actor) => abilityRanks(actor, "Alchemy") > 0,
    throwOf: "Alchemy",
    depth: "full",
  },
  arcaneDabbling: {
    applies: (f) => ["misc", "scroll"].includes(f.kind),
    qualifies: (actor) => abilityRanks(actor, "Arcane Dabbling") > 0,
    throwOf: "Arcane Dabbling",
    depth: "partial",
    backfires: true, // the printed band of the unmodified die backfires
    needs: ["dabblingBackfire"],
  },
  magicalEngineering: {
    applies: (f, item, printed) => printed.engineeringTiers.has(f.rarity ?? "common"),
    qualifies: (actor) => abilityRanks(actor, "Magical Engineering") > 0,
    throwOf: "Magical Engineering",
    depth: "partial",
    needs: ["engineeringTiers"],
  },
  loremastery: {
    applies: (f, item, printed) => !printed.engineeringTiers.has(f.rarity ?? "common"),
    qualifies: (actor) => abilityRanks(actor, "Loremastery") > 0,
    throwOf: "Loremastery",
    depth: "partial",
    needs: ["engineeringTiers"],
  },
  magicResearch: {
    applies: () => true,
    qualifies: canResearch,
    throwOf: "Magic Research",
    depth: "full",
  },
});

const DEPTH_ORDER = { none: 0, partial: 1, full: 2 };

/** Whether every printed value a method needs was imported. */
const supported = (spec, printed) => (spec.needs ?? []).every((key) => printed[key] != null);

/** Methods this identifier could attempt on this item right now. */
export function availableMethods(item, identifier) {
  const f = flagOf(item);
  if (!f.magic) return [];
  const tried = f.triedAt ?? {};
  const printed = identification();
  return Object.entries(METHODS)
    .filter(([, m]) => supported(m, printed))
    .filter(([, m]) => m.applies(f, item, printed))
    .filter(([, m]) => m.qualifies(identifier, printed))
    .filter(([key, m]) => {
      if (!m.throwOf) return true;
      if (throwTarget(identifier, m.throwOf) === null) return false;
      const at = tried[`${key}:${identifier.id}`];
      return at == null || getLevel(identifier) > at;
    })
    .map(([key]) => key);
}

/**
 * The methods this identifier is qualified for but cannot be offered, with
 * the reason: `table` (an identification value is not imported; `table` names
 * it) or `target` (the identifier's ability item prints no throw target;
 * `ability` names the proficiency).
 * @returns {{method: string, why: "table"|"target", table?: string, ability?: string}[]}
 */
export function methodGaps(item, identifier) {
  const f = flagOf(item);
  if (!f.magic) return [];
  const printed = identification();
  const gaps = [];
  for (const [method, m] of Object.entries(METHODS)) {
    if (!m.qualifies(identifier, printed)) continue;
    if (!supported(m, printed)) {
      gaps.push({ method, why: "table", table: tableLabel("identifyProse") });
    } else if (m.applies(f, item, printed) && m.throwOf && throwTarget(identifier, m.throwOf) === null) {
      gaps.push({ method, why: "target", ability: m.throwOf });
    }
  }
  return gaps;
}

/**
 * One identification attempt. Automatic methods (trial by use, sipping, a
 * day's training with a blade) always advance the state — their price is
 * paid in the fiction (curses fire, poison bites); the card says so.
 */
export async function identifyAttempt(item, { identifier, method }) {
  const f = flagOf(item);
  const spec = METHODS[method];
  if (!f.magic || !spec) return { error: "noMethod" };
  const printed = identification();
  if (!supported(spec, printed)) return printedError("identifyProse");
  if (!spec.applies(f, item, printed)) return { error: "notApplicable" };
  if (!spec.qualifies(identifier, printed)) return { error: "notQualified" };

  const current = f.identified ?? "none";
  if (DEPTH_ORDER[current] >= DEPTH_ORDER[spec.depth]) return { error: "nothingNew" };

  let success = true;
  let detail = game.i18n.localize(`${LANG}.identify.automatic`);
  if (spec.throwOf) {
    const tried = f.triedAt ?? {};
    const gate = tried[`${method}:${identifier.id}`];
    if (gate != null && getLevel(identifier) <= gate) return { error: "mustLevel" };
    const target = throwTarget(identifier, spec.throwOf);
    if (target === null) return { error: "noTarget", ability: spec.throwOf };
    const roll = await new Roll("1d20").evaluate();
    const natural = roll.total;
    if (spec.backfires && inBackfireBand(natural, printed.dabblingBackfire)) {
      success = false;
      detail = game.i18n.format(`${LANG}.identify.backfire`, { natural });
    } else {
      success = natural >= target;
      detail = `d20 ${natural} vs ${target}+`;
    }
    if (!success) {
      await item.setFlag(MODULE_ID, ITEM_FLAG, {
        ...f,
        triedAt: { ...tried, [`${method}:${identifier.id}`]: getLevel(identifier) },
      });
    }
  }

  if (success) {
    await item.setFlag(MODULE_ID, ITEM_FLAG, { ...f, identified: spec.depth });
  }

  const lines = [
    `<strong>${game.i18n.format(`${LANG}.identify.attemptLine`, {
      identifier: identifier.name,
      method: game.i18n.localize(`${LANG}.identify.method.${method}`),
      name: item.name,
    })}</strong>`,
    detail,
    success
      ? game.i18n.format(`${LANG}.identify.result.${spec.depth}`, { name: item.name })
      : game.i18n.localize(`${LANG}.identify.failed`),
    spec.risky ? game.i18n.localize(`${LANG}.identify.riskNote`) : null,
  ].filter(Boolean);
  const whisper = judgesAndOwners(item.actor);
  await ChatMessage.create({
    content: `<div class="acks-extras-markets-receipt">${lines.join("<br>")}</div>`,
    whisper,
    speaker: item.actor ? ChatMessage.getSpeaker({ actor: item.actor }) : undefined,
  });

  if (success) Hooks.callAll(HOOKS.IDENTIFIED, { item, identifier, method, depth: spec.depth });
  return { ok: true, success, depth: success ? spec.depth : current, detail };
}

/** Candidate identifiers a user may act through: their characters and those
 *  characters' henchmen (a sage in the retinue identifies as well as a PC). */
export function candidateIdentifiers() {
  const mine = game.actors.filter(
    (a) => a.type === "character" && (game.user.isGM || a.testUserPermission(game.user, "OWNER"))
  );
  const out = new Map(mine.map((a) => [a.id, a]));
  for (const owner of mine) {
    for (const id of owner.system?.henchmenList ?? []) {
      const h = game.actors.get(id);
      if (h) out.set(h.id, h);
    }
  }
  return [...out.values()];
}
