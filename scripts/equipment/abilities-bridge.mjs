/* global globalThis */
/**
 * The acks-abilities bridge — proficiency facts read FROM the abilities model.
 *
 * A character carries generic `ability` items — one per definition, identified
 * by `flags["acks-extras"].cookbook.id`, picks recorded in
 * `flags["acks-extras"].extras.selections` — imported from the Judge's own
 * books. This bridge translates those facts into the SAME effect domains the
 * collectors in effects.mjs already serve, so loadout, proficiency and
 * roll-wrap consume them unchanged. It is the only route: this module ships
 * no effect-carrying proficiency items of its own (see
 * docs/equipment/DECISIONS.md, "The module stops shipping a library of its
 * own (2026-09-01)").
 *
 * Reads the flags directly, so the data works with the abilities feature
 * inactive; prefers its API (`selectionsOf`, `rankOf`) when live, since
 * interpreting picks and ranks is its job.
 *
 * Contributes bonuses and positive training facts only (Finesse, style
 * specialization, Martial/Armour Training, Weapon Focus, Combat Trickery),
 * never a fact the abilities model cannot yet represent — so Non-Proficient
 * Use penalties stay off under `auto` (see proficiency.mjs
 * enforcementActive()).
 *
 * An ability item whose own Active Effects already carry a
 * `flags.acks-extras.*` change stands aside, to avoid double-counting.
 */
import { EFFECT_PREFIX, EFFECT_DOMAINS } from "./constants.mjs";
import { WEAPON_CATEGORY } from "./config.mjs";
import { slug, abilitySlug, namedPicks, resolveLevelValue, ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { forms, keyForName, listedKind, martialOption, optionUnits } from "../lib/weapons.mjs";
import { CATEGORY_TOKENS, canonicalGrant, grantTokens } from "./training-view.mjs";

const ABILITIES_FLAG_SCOPE = "acks-extras";

// The definition slug an ability is known by is acks-lib's `abilitySlug` — one
// identity, so the vocabulary a sheet offers and the picks resolved here are
// keyed alike. It reads the importer's cookbook id where there is one and falls
// back to the item's own name with any trailing "(X)" pick suffix removed.

/**
 * The picks, via the abilities API when live, else its documented flag shape;
 * a name's "(X)" counts only where it names an entry of the ability's own
 * vocabulary (`namedPicks`).
 */
function picksOf(item) {
  const api = globalThis.acksExtras?.abilities;
  if (api?.selectionsOf) {
    try {
      return api.selectionsOf(item);
    } catch {
      /* fall through to the flag */
    }
  }
  const stored = item.flags?.[ABILITIES_FLAG_SCOPE]?.extras?.selections;
  if (Array.isArray(stored)) {
    const picks = stored.map((s) => String(s).trim()).filter(Boolean);
    if (picks.length) return picks;
  }
  return namedPicks(item, categoryOf(item));
}

/**
 * The category the abilities model records for this item, via the API when
 * live, else its documented flag shape — the same key lib/proficiency-strip.mjs
 * reads. A category describes what an ability IS; a slug names which one it is.
 */
function categoryOf(item) {
  const api = globalThis.acksExtras?.abilities;
  if (api?.getExtras) {
    try {
      const c = api.getExtras(item)?.category;
      if (c) return String(c);
    } catch {
      /* fall through to the flag */
    }
  }
  return String(item?.flags?.[ABILITIES_FLAG_SCOPE]?.extras?.category ?? "");
}

/**
 * Style picks for a fighting-style ability, in the shape the Training strip
 * resolves: an explicit pick where there is one, else the tail of the item's own
 * name ("Fighting Style: Dual Weapon" -> "Dual Weapon"). A generic name resolves
 * to nothing, so the fallback cannot invent training.
 */
function stylePicksOf(item) {
  const picks = picksOf(item);
  return picks.length ? picks : [String(item?.name ?? "").split(":").pop()];
}

/** Rank via the abilities API when live (its rule, not ours), else qty. */
function rankOf(actor, item) {
  const api = globalThis.acksExtras?.abilities;
  if (api?.rankOf) {
    try {
      const r = Number(api.rankOf(actor, item));
      if (Number.isFinite(r) && r >= 1) return r;
    } catch {
      /* fall through */
    }
  }
  const q = Number(item.flags?.[ABILITIES_FLAG_SCOPE]?.extras?.qty);
  return Number.isFinite(q) && q >= 1 ? q : 1;
}

/**
 * The exact set of change keys this feature speaks — checked by membership,
 * not a prefix test, since sibling features share the flag scope and a plain
 * item flag like `flags.acks-extras.size` is not an effect domain at all.
 */
const OWN_CHANGE_KEYS = new Set(Object.values(EFFECT_DOMAINS).map((d) => `${EFFECT_PREFIX}${d}`));

/** Does this item already speak the native effect language? Then stand aside. */
function speaksNative(item) {
  for (const effect of item.effects ?? []) {
    if ((effect.changes ?? []).some((c) => OWN_CHANGE_KEYS.has(String(c.key ?? "")))) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------- */
/*  Pick → vocabulary resolvers                                            */
/* ---------------------------------------------------------------------- */

/** Fighting-style pick → style key (lowercased, as the collectors emit). */
export function resolveStylePick(pick) {
  const n = slug(pick);
  if (!n) return null;
  if (n.includes("shield")) return "weaponshield";
  if (n.includes("two") && n.includes("hand")) return "twohanded";
  if (n.includes("dual") || n.includes("twoweapon")) return "dual";
  if (n.includes("missile") || n.includes("bow") || n.includes("ranged") || n.includes("thrown")) return "missile";
  if (n.includes("single")) return "single";
  return null;
}

/** The category tokens that are named by their own words, each with those words. */
const NAMED_CATEGORIES = Object.values(WEAPON_CATEGORY)
  .filter((token) => token !== WEAPON_CATEGORY.OTHER)
  .map((token) => ({ token, words: token.replace(/([A-Z])/g, " $1").toLowerCase().split(" ").filter(Boolean) }));

/** The category token whose own name holds a word of the pick, singular or plural; null unless exactly one does. */
function categoryNamedBy(pick) {
  const picked = new Set(String(pick ?? "").toLowerCase().split(/[^a-z]+/).filter(Boolean).flatMap(forms));
  const hits = NAMED_CATEGORIES.filter(({ words }) => words.some((w) => forms(w).some((f) => picked.has(f))));
  return hits.length === 1 ? hits[0].token : null;
}

/**
 * Martial-Training pick → the grant tokens proficiency.mjs understands, one
 * option's own weapons and no wider (RR ch. 3):
 *
 *  1. A pick that is a martial option's id (`martial.3`), or names exactly one
 *     option, is that option's weapons (`optionUnits`) as `canonicalGrant`
 *     spells them, so a whole category collapses back to its category token (a
 *     token also covers an item flagged with a class that has no row, which
 *     per-weapon tokens would not). A combination holds no weapons and grants
 *     none; an id no option has grants none. A phrase that names an option
 *     whose weapons are not imported falls through to 2 and 3.
 *  2. A pick that is a stored category key resolves to the one martial option
 *     whose weapons all carry that category, spelled the same way; with no such
 *     option, to the key itself.
 *  3. Otherwise the weapon the pick names, else the category whose own name
 *     the pick holds, else the normalized pick itself (which grantMatches
 *     treats as a named-weapon key).
 *
 * Nothing imported resolves by 2 and 3 alone. Call-time only: it reads
 * `training-view.mjs`, which reaches back to this file through its imports, so
 * no top-level code here or there may read an import.
 *
 * @returns {string[]} the tokens, empty for no pick or an option that grants none
 */
export function resolveWeaponGroupPick(pick) {
  const n = slug(pick);
  if (!n) return [];
  const asId = /^martial\.\d+$/i.test(String(pick).trim());
  const option = martialOption(pick);
  if (asId && !option) return [];
  if (option) {
    const units = optionUnits(option);
    if (units.length || asId) return grantTokens(canonicalGrant(units));
  }
  if (CATEGORY_TOKENS.some((c) => c.token === n)) return [n];
  const key = keyForName(pick);
  if (key) return grantTokens(canonicalGrant([key]));
  const category = categoryNamedBy(pick);
  return [category ? slug(category) : n];
}

/**
 * Weapon-Focus pick → the key of the imported focus the pick names (its own
 * key, or one of its nouns); null when the pick names none or none is
 * imported.
 */
export function resolveFocusPick(pick) {
  const n = slug(pick);
  if (!n) return null;
  return listedKind("focus", pick) ?? (listedKind("focus", n) === n ? n : null);
}

/* ---------------------------------------------------------------------- */
/*  Slug → domain tables                                                   */
/* ---------------------------------------------------------------------- */

/** Presence alone flips these boolean domains. */
const PRESENCE_DOMAINS = Object.freeze({
  weaponfinesse: EFFECT_DOMAINS.FINESSE,
  preciseshooting: EFFECT_DOMAINS.PRECISE_SHOOTING,
  sniping: EFFECT_DOMAINS.SNIPING,
  ambushing: EFFECT_DOMAINS.AMBUSHING,
  skirmishing: EFFECT_DOMAINS.SKIRMISHING,
  unarmedfighting: EFFECT_DOMAINS.UNARMED_FIGHTING,
  blindfighting: EFFECT_DOMAINS.BLIND_FIGHTING,
  mountedcombat: EFFECT_DOMAINS.MOUNTED_COMBAT,
  riding: EFFECT_DOMAINS.RIDING,
  running: EFFECT_DOMAINS.RUNNING,
  berserkergang: EFFECT_DOMAINS.BERSERKERGANG,
});

// A numeric bonus an ability carries (initiative, Armor Class, surprise,
// cleaves) is never keyed on its name here: it is a typed `modifier` spec the
// import located on the page, applied by the loadout through
// lib/typed-modifiers.mjs.

/* ---------------------------------------------------------------------- */
/*  The typed effect model                                                 */
/* ---------------------------------------------------------------------- */

/**
 * The slug tables key on a definition id's LAST segment, which does not
 * identify a class power granting the same mechanic under its own name. The
 * typed specs in `flags["acks-extras"].extras.effects` (the same shape
 * acks-lib's `effectField()` declares) are read first for that reason; the
 * name tables stay only for mechanics the typed model does not yet express
 * (fighting styles, weapon groups). See docs/equipment/DECISIONS.md,
 * "2026-08-11 — the abilities bridge reads the typed effect model, not the
 * name."
 */
const ATTRIBUTE_SUBSTITUTION_TARGETS = Object.freeze({
  attackThrow: EFFECT_DOMAINS.FINESSE,
  damage: EFFECT_DOMAINS.DAMAGE_ATTRIBUTE,
});

/** The typed effect specs an ability carries, or an empty list. */
function typedEffects(item) {
  const effects = item?.flags?.[ABILITIES_FLAG_SCOPE]?.extras?.effects;
  return Array.isArray(effects) ? effects : [];
}

/** Does this spec raise the wearable armour category? */
const raisesArmour = (spec) => spec?.type === "modifies" && spec.domain === "armor";

/**
 * The step one armour-raising spec carries: its `value`, a bare number (an
 * import made before the step was read off the page) or a LevelValue (read
 * at import, or set by a Judge on the row). Null when it resolves to no number.
 */
function armourStep(spec) {
  const v = resolveLevelValue(spec?.value);
  return v == null || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
}

/**
 * The names an armour-training ability goes by, both spellings: what marks a
 * hand-made or bookless copy as one whose step was never imported.
 */
const ARMOUR_TRAINING_SLUGS = new Set(["armortraining", "armourtraining"]);

/**
 * The actor's armour-training abilities and what each adds, for the surface
 * that shows the armour allowance: one row per ability that carries an
 * armour-raising spec (whatever it is named) or is named Armour Training.
 * `step` is the spec's figure and `steps` the step times the rank; both are
 * null on an ability with no step, which adds nothing. `cite` is the page the
 * import read it from, where the item records one.
 * @returns {{name: string, step: number|null, rank: number, steps: number|null, cite: string}[]}
 */
export function armourTrainingRows(actor) {
  const rows = [];
  if (actor?.type !== ACTOR_TYPE.character) return rows;
  for (const item of actor.items ?? []) {
    if (item.type !== ITEM_TYPE.ability || speaksNative(item)) continue;
    const specs = typedEffects(item).filter(raisesArmour);
    if (!specs.length && !ARMOUR_TRAINING_SLUGS.has(abilitySlug(item))) continue;
    const rank = rankOf(actor, item);
    const steps = specs.map(armourStep).filter((s) => s != null);
    const step = steps.length ? steps.reduce((a, b) => a + b, 0) : null;
    rows.push({
      name: String(item.name ?? ""),
      step,
      rank,
      steps: step == null ? null : step * rank,
      cite: String(item.flags?.[ABILITIES_FLAG_SCOPE]?.cookbook?.cite ?? ""),
    });
  }
  return rows;
}

/**
 * Translate one ability's typed specs into domains.
 *
 * Deliberately narrow: only the specs this feature can act on are read, and an
 * unrecognised one is left alone for whichever feature owns it.
 *
 * @returns {Set<string>} the domains this item contributed to. The slug tables
 *   below stand down on a domain already claimed here — see
 *   docs/equipment/DECISIONS.md, "2026-08-11 — the abilities bridge reads the
 *   typed effect model, not the name."
 */
function addTypedEffects(actor, item, { addNum, addStr, booleans }) {
  const claimed = new Set();
  for (const spec of typedEffects(item)) {
    switch (spec?.type) {
      case "attributeSubstitution": {
        // Only a swap AWAY FROM Strength is expressible here: the roll-wrap
        // corrects what core already pushed, and Strength is the only attribute
        // core pushes onto an attack throw or a damage roll.
        if (spec.insteadOf !== "str" || !spec.attribute) break;
        const domain = ATTRIBUTE_SUBSTITUTION_TARGETS[spec.target];
        if (!domain) break;
        if (domain === EFFECT_DOMAINS.DAMAGE_ATTRIBUTE) addStr(domain, spec.attribute);
        else booleans.add(domain);
        claimed.add(domain);
        break;
      }
      case "modifies": {
        // Each rank raises the wearable category by the spec's own step; a
        // spec whose step resolves to nothing raises it by nothing.
        if (!raisesArmour(spec)) break;
        const step = armourStep(spec);
        if (step == null) break;
        addNum(EFFECT_DOMAINS.ARMOR_TRAINING, item.name, step * rankOf(actor, item));
        claimed.add(EFFECT_DOMAINS.ARMOR_TRAINING);
        break;
      }
      default:
        break;
    }
  }
  return claimed;
}

/* ---------------------------------------------------------------------- */
/*  The contribution set                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Everything the actor's abilities-modelled items contribute, keyed the way
 * the effects.mjs collectors serve it.
 * @returns {{numeric: Map<string, {label:string,value:number}[]>,
 *            strings: Map<string, Set<string>>,
 *            booleans: Set<string>,
 *            origins: Map<string, Map<string, Set<string>>>}} origins: string domain → item name → its tokens
 */
export function bridgeContributions(actor) {
  // `origins` keeps, per string domain, which ITEM contributed which tokens —
  // the provenance a training editor names beside a pill it cannot switch off.
  const out = { numeric: new Map(), strings: new Map(), booleans: new Set(), origins: new Map() };
  if (actor?.type !== ACTOR_TYPE.character) return out;

  let current = "";
  const addNum = (domain, label, value) => {
    if (!out.numeric.has(domain)) out.numeric.set(domain, []);
    out.numeric.get(domain).push({ label, value });
  };
  const addStr = (domain, token) => {
    if (!token) return;
    if (!out.strings.has(domain)) out.strings.set(domain, new Set());
    out.strings.get(domain).add(String(token).toLowerCase());
    if (!out.origins.has(domain)) out.origins.set(domain, new Map());
    const byItem = out.origins.get(domain);
    if (!byItem.has(current)) byItem.set(current, new Set());
    byItem.get(current).add(String(token).toLowerCase());
  };

  for (const item of actor.items ?? []) {
    if (item.type !== ITEM_TYPE.ability) continue;
    if (speaksNative(item)) continue; // native effect items are not bridged
    current = String(item.name ?? "");

    // The typed model first, independently of the slug tables.
    const claimed = addTypedEffects(actor, item, { addNum, addStr, booleans: out.booleans });

    // A fighting-style proficiency trains its picks whatever it is named; the
    // base pick is recognised by its CATEGORY (not the slug, which only ever
    // matches Specialization) — the same key the Training strip reads.
    //
    // Only fightingStyle is honoured here: weaponProficiency and
    // armorProficiency stay permissive when unset (DECISIONS.md, "Proficiency
    // enforcement is a policy, and it is on by default") — never widen this
    // branch to them.
    if (categoryOf(item) === "fightingStyle" && !claimed.has(EFFECT_DOMAINS.STYLE_PROFICIENT)) {
      for (const pick of stylePicksOf(item)) addStr(EFFECT_DOMAINS.STYLE_PROFICIENT, resolveStylePick(pick));
    }

    // Named abilityKey, not slug: the vocab.mjs slug() import must stay
    // reachable inside this block (the combattrickery case normalizes picks
    // through it).
    const abilityKey = abilitySlug(item);
    if (!abilityKey) continue;

    const presence = PRESENCE_DOMAINS[abilityKey];
    if (presence && !claimed.has(presence)) out.booleans.add(presence);

    switch (abilityKey) {
      case "fightingstylespecialization": {
        // The pick is the style: specialization implies training in it, and
        // spec carries the free draw/sheathe/ready swap.
        for (const pick of picksOf(item)) {
          const style = resolveStylePick(pick);
          if (!style) continue;
          addStr(EFFECT_DOMAINS.STYLE_PROFICIENT, style);
          addStr(EFFECT_DOMAINS.STYLE_PROFICIENT, `${style}:spec`);
          out.booleans.add(EFFECT_DOMAINS.FREE_SWAP);
        }
        break;
      }
      case "martialtraining": {
        for (const pick of picksOf(item)) for (const token of resolveWeaponGroupPick(pick)) addStr(EFFECT_DOMAINS.MARTIAL_WEAPONS, token);
        break;
      }
      case "weaponfocus": {
        for (const pick of picksOf(item)) addStr(EFFECT_DOMAINS.WEAPON_FOCUS, resolveFocusPick(pick));
        break;
      }
      case "combattrickery": {
        for (const pick of picksOf(item)) addStr(EFFECT_DOMAINS.MANEUVER_TRICKERY, slug(pick));
        break;
      }
      // Armour Training has no name case: its step is the page's figure, so
      // it applies only through the typed spec above, and a copy carrying
      // none is reported by `armourTrainingRows` as not imported.
      default:
        break;
    }
  }
  return out;
}
