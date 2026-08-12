/* global game */
/**
 * Reads auto-populatable values from the influencing actor and the targeted
 * token's actor, using only public ACKS data paths (no system internals).
 */
import { CHANGE_KEY_FAMILY, HENCHMAN_MONTHLY_WAGE, INFLUENCE_MODIFIERS, MODULE_ID } from "./constants.mjs";
import { inferRace, optionalRuleEnabled, parseKindList } from "./racial.mjs";
// Ability mod + level-or-HD read once from acks-lib (acks-henchmen read the same
// schema). hitDiceOrLevel also anchors the HD parse, fixing the old "d8" → 8
// mis-read where a die size was taken for a rating.
import { abilityMod, hitDiceOrLevel } from "../lib/actor-read.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

const GENERIC_IMG = "icons/svg/mystery-man.svg";

/**
 * Alignment enum. Classify a free-text alignment by its (capitalized) first
 * letter: L → law, C → chaos, N → neutral; anything else (blank/unknown) → other.
 */
export const ALIGNMENT = Object.freeze({ LAW: "law", CHAOS: "chaos", NEUTRAL: "neutral", OTHER: "other" });

export function classifyAlignment(value) {
  const c = String(value ?? "").trim().charAt(0).toUpperCase();
  if (c === "L") return ALIGNMENT.LAW;
  if (c === "C") return ALIGNMENT.CHAOS;
  if (c === "N") return ALIGNMENT.NEUTRAL;
  return ALIGNMENT.OTHER;
}

/**
 * This module's alignment tokens → acks-lib's (`lawful`/`neutral`/`chaotic`,
 * which is what acks-monsters and acks-content already use). Kept as a
 * boundary translation rather than a rename: `law`/`chaos` are baked into
 * published effect flags, and breaking those to tidy a spelling is not worth
 * it. Unknown/"other" maps to null — an alignment nobody established cannot
 * gate anything, and `scopeApplies` treats a null as undetermined.
 */
const LIB_ALIGNMENT = Object.freeze({
  [ALIGNMENT.LAW]: "lawful",
  law: "lawful",
  lawful: "lawful",
  [ALIGNMENT.CHAOS]: "chaotic",
  chaos: "chaotic",
  chaotic: "chaotic",
  [ALIGNMENT.NEUTRAL]: "neutral",
  neutral: "neutral",
});

export const toLibAlignment = (value) => LIB_ALIGNMENT[String(value ?? "").toLowerCase()] ?? null;


/**
 * Diplomacy alignment modifier: +1 when the two alignments match (same L/N/C),
 * -1 when they are opposed (Law vs Chaos), 0 otherwise (a Neutral mixed with a
 * non-matching alignment). Always overridable in the form.
 */
function alignmentModifier(charActor, targetActor) {
  if (!charActor || !targetActor) return 0;
  const c = classifyAlignment(charActor.system?.details?.alignment);
  const t = classifyAlignment(targetActor.system?.details?.alignment);
  // Unknown/undefined alignment can't establish a match or mismatch.
  if (c === ALIGNMENT.OTHER || t === ALIGNMENT.OTHER) return 0;
  if (c === t) return 1;
  if ((c === ALIGNMENT.LAW && t === ALIGNMENT.CHAOS) || (c === ALIGNMENT.CHAOS && t === ALIGNMENT.LAW)) return -1;
  return 0;
}

/** Proficiency matchers against the actor's `ability` items. */
const PROFICIENCY_MATCHERS = Object.freeze({
  diplomacy: /^diplomacy$/i,
  intimidation: /^intimidat/i,
  seduction: /^seduction$/i,
  mysticAura: /^mystic\s*aura$/i,
  performanceArt: /^(performance|art)\b/i,
  bribery: /^bribery/i,
  // Situational proficiencies (offered only when present).
  beastFriendship: /^beast\s*friendship/i,
  animalHusbandry: /^animal\s*husbandry/i,
  folkways: /^folkways/i,
});

/**
 * The `ability` items backing each proficiency, as item ids — the one walk of
 * PROFICIENCY_MATCHERS, so the name vocabulary is defined and applied once.
 * @param {Actor|null} actor
 * @param {Iterable<string>} [keys]  which proficiencies to look for
 * @returns {Record<string, string[]>} proficiency key → matching item ids
 */
export function getProficiencyItems(actor, keys = Object.keys(PROFICIENCY_MATCHERS)) {
  const found = {};
  for (const key of keys) if (PROFICIENCY_MATCHERS[key]) found[key] = [];
  if (!actor?.items) return found;
  for (const item of actor.items) {
    if (item.type !== ITEM_TYPE.ability) continue;
    const name = item.name ?? "";
    for (const [key, ids] of Object.entries(found)) {
      if (PROFICIENCY_MATCHERS[key].test(name)) ids.push(item.id);
    }
  }
  return found;
}

/**
 * Detect which reaction-relevant proficiencies the actor possesses.
 * @returns {Record<string, boolean>}
 */
export function getProficiencies(actor) {
  const found = {};
  for (const [key, ids] of Object.entries(getProficiencyItems(actor))) found[key] = ids.length > 0;
  return found;
}

/**
 * Item ids already spoken for by a static proficiency checkbox in `groups`.
 *
 * A proficiency detected by NAME fills its own row, so the same item's effect
 * model must not add a second one: that is the ability counted twice. The
 * static row wins — it carries the audited printed mechanic, and the
 * mutually-exclusive tone set is modelled on those rows (`exclusive` in
 * INFLUENCE_MODIFIERS), so moving the bonus onto an effect row would let all
 * three tone proficiencies stack again.
 *
 * Read from the rows a page actually renders, never from the matcher list: a
 * proficiency detected but not offered here (Beast Friendship and Folkways
 * anywhere, Performance outside Seduction) has no other row to be counted in,
 * and claiming it would silently drop the modifier rather than deduplicate it.
 * Only a row that contributes to the throw claims — the bribe fee reads Bribery
 * to price a bribe, which is not a modifier on the roll.
 *
 * A power standing in for a proficiency (`actsAs`) fills that same checkbox and
 * is claimed with it. It is named for itself, so no name match can ever find
 * it, and only the core four can be stood in for — CORE_PROFS is what ticks the
 * box, so an `actsAs` naming anything else fills nothing and keeps its own row.
 *
 * @param {Actor|null} actor
 * @param {Array} groups  the page's own modifier groups, before effect rows join them
 * @returns {Set<string>}
 */
export function itemsWithProficiencyRows(actor, groups) {
  const keys = [];
  for (const group of groups ?? []) {
    for (const mod of group.mods ?? []) {
      if (mod.type === "check" && mod.auto?.startsWith("prof:")) keys.push(mod.auto.slice(5));
    }
  }
  if (!keys.length) return new Set();
  const claimed = new Set(Object.values(getProficiencyItems(actor, keys)).flat());
  const actsAs = getActsAsPowers(actor);
  for (const key of keys) {
    if (CORE_PROFS.includes(key) && actsAs[key]?.itemId) claimed.add(actsAs[key].itemId);
  }
  return claimed;
}

/**
 * The actor's HD (monsters) or class level (characters), used for the bribe fee.
 * Parses monster `system.hp.hd` strings like "3d8", "1/2", "2+1".
 */
export const getActorHD = hitDiceOrLevel;

/** Henchman monthly wage (gp) for a given HD/level, clamped to the table. */
export function monthlyWageForHD(hd) {
  const level = Math.max(0, Math.min(HENCHMAN_MONTHLY_WAGE.length - 1, Math.floor(Number(hd) || 0)));
  return HENCHMAN_MONTHLY_WAGE[level];
}

/** The first currently-targeted token's actor, if any. */
export function getTargetActor() {
  const targets = game.user?.targets ? Array.from(game.user.targets) : [];
  return targets[0]?.actor ?? null;
}

/**
 * Portraits/names for the influencer and target sides.
 * @param {Actor|null} actor    the influencing actor
 * @param {Actor|null} targetActor  the targeted actor
 */
export function resolveParties(actor, targetActor) {
  const influencer = actor
    ? { name: actor.name, img: actor.img || GENERIC_IMG }
    : { name: "Influencer", img: GENERIC_IMG };
  const target = targetActor
    ? { name: targetActor.name, img: targetActor.img || GENERIC_IMG }
    : { name: "Target", img: GENERIC_IMG };
  return { influencer, target };
}

/** The four hardcoded core proficiencies a power may stand in for (`actsAs`). */
const CORE_PROFS = ["diplomacy", "intimidation", "seduction", "mysticAura"];

/**
 * Compute the raw context values used to resolve every `auto` modifier source.
 * A power that `actsAs` a core proficiency makes that proficiency count as present.
 */
function buildContext(actor, targetActor) {
  const profs = { ...getProficiencies(actor) };
  const actsAs = getActsAsPowers(actor);
  for (const k of CORE_PROFS) if (actsAs[k]) profs[k] = true;
  return {
    cha: actor ? abilityMod(actor, "cha") : 0,
    targetWill: targetActor ? abilityMod(targetActor, "wis") : 0,
    // Intimidation reads the target's morale straight off the sheet (character
    // -4..+4, monster -6..+4); the field stays editable as a manual override.
    targetMorale: targetActor ? Number(targetActor.system?.details?.morale ?? 0) : 0,
    alignment: alignmentModifier(actor, targetActor),
    levelGap: levelGapModifier(actor, targetActor),
    age: ageModifier(actor, targetActor),
    profs,
  };
}

/**
 * Level/HD gap modifier: +1 when the character is 3+ levels/HD above the target,
 * -1 when 3+ below, else 0. Uses class level for characters, HD for monsters.
 */
function levelGapModifier(charActor, targetActor) {
  if (!charActor || !targetActor) return 0;
  const diff = getActorHD(charActor) - getActorHD(targetActor);
  if (diff >= 3) return 1;
  if (diff <= -3) return -1;
  return 0;
}

/* -------------------------------------------- */
/*  Age (Character Aging table, RR)             */
/* -------------------------------------------- */

// Lower bound (in years) of each age category: Youth, Adult, Middle-Aged, Old, Ancient.
const AGE_TABLE = Object.freeze({
  beastman: [12, 16, 31, 46, 61],
  dwarf: [15, 26, 51, 76, 116],
  elf: [15, 51], // Youth, Adult only
  human: [13, 18, 36, 56, 76],
  nobiran: [13, 18], // Youth, Adult only
  zaharan: [13, 18, 36, 56, 76],
});

/** The age-category index (0 = Youth … 4 = Ancient) for an actor. */
export function ageCategoryIndex(actor) {
  const bounds = AGE_TABLE[inferRace(actor)] ?? AGE_TABLE.human;
  const age = Number(actor?.system?.details?.age);
  if (!Number.isFinite(age)) return 1; // assume Adult when unknown
  let idx = 0;
  for (let i = 0; i < bounds.length; i++) if (age >= bounds[i]) idx = i;
  return idx;
}

/**
 * Age modifier for Seduction (±1 per age category). Defaults to the common case
 * that targets prefer youthful mates, so a younger character is +per category.
 * The GM flips the sign when the target prefers mature mates.
 */
function ageModifier(charActor, targetActor) {
  if (!charActor || !targetActor) return 0;
  // Age categories only apply within the Youth–Old range; clamp Ancient to Old.
  const c = Math.min(3, ageCategoryIndex(charActor));
  const t = Math.min(3, ageCategoryIndex(targetActor));
  return t - c; // + when the character is the younger category
}

/** Resolve a single `auto` source string to its value. */
function resolveAutoValue(source, ctx) {
  if (source === "cha") return ctx.cha;
  if (source === "targetWill") return ctx.targetWill;
  if (source === "targetMorale") return ctx.targetMorale;
  if (source === "alignment") return ctx.alignment;
  if (source === "levelGap") return ctx.levelGap;
  if (source === "age") return ctx.age;
  if (source.startsWith("prof:")) return Boolean(ctx.profs[source.slice(5)]);
  // Caller-supplied values (external modes): api.open(actor, {mode, ctx}).
  if (source.startsWith("ctx:")) {
    const value = ctx.external?.[source.slice(4)];
    return value === undefined ? 0 : Number(value) || 0;
  }
  return undefined;
}

/**
 * Build the per-tone default modifier values. Auto fields get detected values;
 * effect-granted fields use their declared default; everything else gets its
 * neutral default (false for checks, 0 otherwise).
 * @param {Actor|null} actor
 * @param {Actor|null} targetActor
 * @param {Record<string, Array>} modConfig  per-tone groups (static + effects)
 * @param {Record<string, unknown>|null} [external] the caller's own context bag
 *   (`api.open(actor, {mode, ctx})`), for facts that live on neither actor. An
 *   `auto` source spelled `ctx:<key>` reads it and coerces to a number, so an
 *   absent key scores 0 rather than breaking the tone. No shipped caller passes
 *   one — it is the seam external modes resolve against.
 * @returns {{[tone:string]: {[key:string]: (number|boolean)}}}
 */
export function computeDefaults(actor, targetActor, modConfig = INFLUENCE_MODIFIERS, external = null) {
  const ctx = buildContext(actor, targetActor);
  ctx.external = external ?? {};
  const defaults = {};
  for (const [tone, groups] of Object.entries(modConfig)) {
    defaults[tone] = {};
    // Exclusive sets: the FIRST auto-detected member wins, the rest stay off.
    // Without this a character holding all three tone proficiencies would
    // auto-populate every one of them on a page that shows them together.
    const claimed = new Set();
    for (const group of groups) {
      for (const mod of group.mods) {
        let value = mod.type === "check" ? false : 0;
        if (mod.auto) {
          const resolved = resolveAutoValue(mod.auto, ctx);
          if (resolved !== undefined) value = resolved;
        } else if (Object.hasOwn(mod, "default")) {
          value = mod.default;
        }
        if (mod.exclusive && value) {
          if (claimed.has(mod.exclusive)) value = false;
          else claimed.add(mod.exclusive);
        }
        defaults[tone][mod.key] = value;
      }
    }
  }
  return defaults;
}

/**
 * The other members of `key`'s exclusive set, so ticking one can clear them.
 * @param {Array} groups  the rendered groups for the active tone/page
 * @param {string} key    the modifier key just switched on
 * @returns {string[]}
 */
export function exclusivePeers(groups, key) {
  const all = (groups ?? []).flatMap((g) => g.mods ?? []);
  const set = all.find((m) => m.key === key)?.exclusive;
  if (!set) return [];
  return all.filter((m) => m.exclusive === set && m.key !== key).map((m) => m.key);
}

/**
 * Scan an actor's active effects for social-roll modifiers (see
 * CHANGE_KEY_FAMILY). Returns a flat list carrying each change's roll family;
 * the app groups them per tone and filters them per page.
 * @returns {Array<{id:string,itemId:string|null,label:string,value:number,family:string,situational:boolean,tones:string[]}>}
 */
export function getEffectReactionMods(actor) {
  if (!actor) return [];
  const out = [];
  const effects = actor.appliedEffects ?? actor.effects ?? [];
  let idx = 0;
  for (const effect of effects) {
    if (effect.disabled) continue;
    const f = effect.flags?.[MODULE_ID] ?? {};
    // Effects tied to an optional rule (e.g. BTA dwarven caste) obey its setting.
    if (f.optionalRule && !optionalRuleEnabled(f.optionalRule)) {
      idx++;
      continue;
    }
    // The item this effect rides, which is the unit a claim is made against
    // (see itemsWithProficiencyRows). An effect written straight onto the actor
    // has no item and so is nobody's second voice.
    const itemId = effect.parent?.documentName === "Item" ? effect.parent.id : null;
    let ci = 0;
    for (const change of effect.changes ?? []) {
      // Which family of 2d6 social roll this change feeds (reaction/loyalty/
      // morale). One effect may carry several — that is how Inhumanity spans
      // all three without becoming three items to keep in sync.
      const family = CHANGE_KEY_FAMILY[change.key];
      // Effects that stand in for a core proficiency are handled by getActsAsPowers.
      if (family && !f.actsAs) {
        const value = Number(change.value) || 0;
        if (value) {
          // `tone` may be "all", a single tone, an array, or a comma-separated list.
          const raw = f.tone ?? "all";
          const tones = (Array.isArray(raw) ? raw : String(raw).split(","))
            .map((t) => String(t).trim().toLowerCase())
            .filter(Boolean);
          // Translate this module's own flag vocabulary into acks-lib's, so
          // both effect sources reach scopeApplies() in one shape and gating
          // lives in exactly one place. `alignmentSign` and `alignmentOnly`
          // are the same axis with different modes — lib says so explicitly.
          const vs = f.vs ? parseKindList(f.vs) : null;
          const signed = f.alignmentSign ? String(f.alignmentSign).toLowerCase() : null;
          const gated = f.alignmentOnly ? String(f.alignmentOnly).toLowerCase() : null;
          out.push({
            id: `eff:${effect.id ?? idx}:${ci}`,
            itemId,
            label: f.label || effect.name || "Effect",
            value,
            family,
            appliesTo: "self",
            situational: f.situational !== false,
            vsKinds: vs?.length ? vs : [],
            vsAlignment: toLibAlignment(signed ?? gated),
            vsAlignmentMode: signed ? "sign" : "gate",
            // "all" is the absence of a tone restriction, which lib spells as
            // an empty list rather than a magic token.
            tones: tones.length && !tones.includes("all") ? tones : [],
            optionalRule: f.optionalRule ? String(f.optionalRule) : null,
            kickerAt: f.bewitched === true ? 12 : null,
            kickerNote: "",
            unaudited: false,
            source: "activeEffect",
          });
        }
      }
      ci++;
    }
    idx++;
  }
  return out;
}

/**
 * The effect-sourced rows one page offers, from the whole set an actor supplies.
 *
 * Four gates, and the order they are stated in is the order they are argued:
 * the page's roll family (a Diplomacy bonus is not a loyalty modifier), whose
 * roll it modifies, whether a static proficiency row on this page already
 * offers the same item (see itemsWithProficiencyRows), and finally the tone.
 *
 * A page with no tone of its own passes `tone: null`, which leaves a
 * tone-scoped row undetermined rather than excluded — it is offered, not
 * asserted. Tone MISmatch on a page that has one is likewise a filter here and
 * not in scopeApplies: a mismatched row must not silently vanish from a page
 * the GM is looking at when they may still rule that it applies.
 *
 * @param {Array} mods  rows in the shared modifier shape
 * @param {{family:string, tone?:string|null, claimed?:Set<string>}} page
 * @returns {Array}
 */
export function effectRowsForPage(mods, { family, tone = null, claimed = new Set() }) {
  return mods.filter(
    (m) =>
      m.family === family &&
      m.appliesTo === "self" &&
      !claimed.has(m.itemId) &&
      (!tone || !m.tones.length || m.tones.includes(tone)),
  );
}

/**
 * Powers whose effect declares `flags.acks-extras.actsAs: <coreProf>` — a
 * proficiency granted as a class power (non-stacking). Returns a map of core
 * proficiency key → the power that grants it: its `label` fills in / relabels
 * that prof's box, and its `itemId` is what claims the power for the box it
 * fills (see itemsWithProficiencyRows), so the power cannot also be counted as
 * a modifier of its own.
 * @returns {Record<string, {label: string, itemId: string|null}>}
 */
export function getActsAsPowers(actor) {
  const map = {};
  if (!actor) return map;
  const effects = actor.appliedEffects ?? actor.effects ?? [];
  for (const effect of effects) {
    if (effect.disabled) continue;
    const f = effect.flags?.[MODULE_ID];
    if (!f?.actsAs) continue;
    const key = String(f.actsAs);
    if (map[key]) continue;
    map[key] = {
      label: f.label || effect.name || key,
      itemId: effect.parent?.documentName === "Item" ? effect.parent.id : null,
    };
  }
  return map;
}

/** The set of modifier keys (per tone) that are auto-populated, for UI badges. */
export function autoKeysByTone() {
  const map = {};
  for (const [tone, groups] of Object.entries(INFLUENCE_MODIFIERS)) {
    map[tone] = new Set();
    for (const group of groups) {
      for (const mod of group.mods) {
        if (mod.auto) map[tone].add(mod.key);
      }
    }
  }
  return map;
}
