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
 */
import { MODULE_ID, LANG, ITEM_FLAG, HOOKS } from "../constants.mjs";
import { RARITIES } from "../config.mjs";
import { abilityRanks } from "./trade.mjs";
import { getLevel } from "../../henchmen/acks-adapter.mjs";
import { ITEM_TYPE, slug } from "../../lib/vocab.mjs";

const flagOf = (item) => item.getFlag(MODULE_ID, ITEM_FLAG) ?? {};

/** Rarities Magical Engineering recognizes; Loremastery takes the rest. */
const ENGINEERING_RARITIES = RARITIES.slice(0, 3); // common, uncommon, rare

/** True when the actor can conduct magic research (5+ caster levels, or Loremastery). */
function canResearch(actor) {
  if (abilityRanks(actor, "Loremastery") > 0) return true;
  const casts = actor.items.some((i) => i.type === ITEM_TYPE.spell);
  return casts && getLevel(actor) >= 5;
}

/** The proficiency-throw target on the identifier's own ability item (the
 *  imported proficiency prints it); 11+ when the item carries none. */
function throwTarget(actor, abilityName) {
  const wanted = slug(abilityName);
  const ability = actor.items.find((i) => i.type === ITEM_TYPE.ability && slug(i.name) === wanted);
  const target = Number(ability?.system?.rollTarget ?? 0);
  return target > 0 ? target : 11;
}

/**
 * The method ladder. `applies` gates on the ITEM (kind/rarity); `qualifies`
 * on the IDENTIFIER; `throwOf` names the die (null = automatic); `depth` is
 * what success grants.
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
    backfires: 3, // unmodified 1-3 backfires
  },
  magicalEngineering: {
    applies: (f) => ENGINEERING_RARITIES.includes(f.rarity ?? "common"),
    qualifies: (actor) => abilityRanks(actor, "Magical Engineering") > 0,
    throwOf: "Magical Engineering",
    depth: "partial",
  },
  loremastery: {
    applies: (f) => !ENGINEERING_RARITIES.includes(f.rarity ?? "common"),
    qualifies: (actor) => abilityRanks(actor, "Loremastery") > 0,
    throwOf: "Loremastery",
    depth: "partial",
  },
  magicResearch: {
    applies: () => true,
    qualifies: canResearch,
    throwOf: "Magic Research",
    depth: "full",
  },
});

const DEPTH_ORDER = { none: 0, partial: 1, full: 2 };

/** Methods this identifier could attempt on this item right now. */
export function availableMethods(item, identifier) {
  const f = flagOf(item);
  if (!f.magic) return [];
  const tried = f.triedAt ?? {};
  return Object.entries(METHODS)
    .filter(([, m]) => m.applies(f, item))
    .filter(([, m]) => m.qualifies(identifier))
    .filter(([key, m]) => {
      if (!m.throwOf) return true;
      const at = tried[`${key}:${identifier.id}`];
      return at == null || getLevel(identifier) > at;
    })
    .map(([key]) => key);
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
  if (!spec.applies(f, item)) return { error: "notApplicable" };
  if (!spec.qualifies(identifier)) return { error: "notQualified" };

  const current = f.identified ?? "none";
  if (DEPTH_ORDER[current] >= DEPTH_ORDER[spec.depth]) return { error: "nothingNew" };

  let success = true;
  let detail = game.i18n.localize(`${LANG}.identify.automatic`);
  if (spec.throwOf) {
    const tried = f.triedAt ?? {};
    const gate = tried[`${method}:${identifier.id}`];
    if (gate != null && getLevel(identifier) <= gate) return { error: "mustLevel" };
    const target = throwTarget(identifier, spec.throwOf);
    const roll = await new Roll("1d20").evaluate();
    const natural = roll.total;
    if (spec.backfires && natural <= spec.backfires) {
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
  const whisper = [
    ...game.users.filter((u) => u.isGM).map((u) => u.id),
    ...game.users.filter((u) => !u.isGM && item.actor?.testUserPermission(u, "OWNER")).map((u) => u.id),
  ];
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
