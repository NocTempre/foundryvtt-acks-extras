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
import { slug, abilitySlug, ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

const ABILITIES_FLAG_SCOPE = "acks-extras";

// The definition slug an ability is known by is acks-lib's `abilitySlug` — one
// identity, so the vocabulary a sheet offers and the picks resolved here are
// keyed alike. It reads the importer's cookbook id where there is one and falls
// back to the item's own name with any trailing "(X)" pick suffix removed.

/** The picks, via the abilities API when live, else its documented flag shape. */
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
  const m = /\(([^)]+)\)\s*$/.exec(item?.name ?? "");
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
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

/**
 * Martial-Training pick → a grant token proficiency.mjs understands: a JJ
 * weapon category where recognisable, else the normalized pick itself (which
 * grantMatches treats as a named-weapon key — "Martial Training (Sword)").
 */
export function resolveWeaponGroupPick(pick) {
  const n = slug(pick);
  if (!n) return null;
  if (n.includes("axe")) return "axe";
  if (n.includes("crossbow")) return "crossbow"; // before "bow"
  if (n.includes("bow")) return "bow";
  if (n.includes("flail") || n.includes("hammer") || n.includes("mace")) return "flailhammermace";
  if (n.includes("sword") || n.includes("dagger")) return "sworddagger";
  if (n.includes("spear") || n.includes("polearm")) return "spearpolearm";
  return n; // a named weapon, or "other"
}

/** Weapon-Focus pick → a WEAPON_FOCUS_GROUPS key; null when unrecognisable. */
export function resolveFocusPick(pick) {
  const n = slug(pick);
  if (!n) return null;
  if (n.includes("axe")) return "axes";
  if (n.includes("flail") || n.includes("hammer") || n.includes("mace")) return "macesflailshammers";
  if (n.includes("sword") || n.includes("dagger")) return "swordsdaggers";
  if (n.includes("bow")) return "bowscrossbows"; // bows AND crossbows
  if (n.includes("sling") || n.includes("thrown") || n.includes("dart") || n.includes("bola")) return "slingsthrown";
  if (n.includes("spear") || n.includes("polearm") || n.includes("lance") || n.includes("javelin")) return "spearspolearms";
  return null;
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
  swashbuckling: EFFECT_DOMAINS.SWASHBUCKLING,
});

/** Presence contributes a flat number to these numeric domains. */
const NUMERIC_DOMAINS = Object.freeze({
  combatreflexes: { domain: EFFECT_DOMAINS.STYLE_INIT, value: 1 },
  combatferocity: { domain: EFFECT_DOMAINS.MAX_CLEAVES, value: 1 },
});

/* ---------------------------------------------------------------------- */
/*  The typed effect model                                                 */
/* ---------------------------------------------------------------------- */

/**
 * The slug tables key on a definition id's LAST segment, which does not
 * identify a class power granting the same mechanic under its own name. The
 * typed specs in `flags["acks-extras"].extras.effects` (the same shape
 * acks-lib's `effectField()` declares) are read first for that reason; the
 * name tables stay only for mechanics the typed model does not yet express
 * (fighting styles, weapon groups, armour training). See
 * docs/equipment/DECISIONS.md, "2026-08-11 — the abilities bridge reads the
 * typed effect model, not the name."
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

/**
 * Resolve a level-scaled value to a flat number for `actor`.
 *
 * A materialized value is either a plain number or a `{kind, ...}` ladder the
 * abilities model resolves against the character. Ask that model when it is
 * live — interpreting a ladder is its job, not ours — and otherwise take only
 * the shapes that need no interpretation. An unresolvable ladder contributes
 * NOTHING rather than its first rung: a bonus reported at the wrong level is
 * worse than a bonus the sheet says is missing.
 */
function flatValue(actor, value) {
  if (value == null) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const api = globalThis.acksExtras?.abilities;
  if (api?.resolveValue) {
    try {
      const n = Number(api.resolveValue(actor, value));
      if (Number.isFinite(n)) return n;
    } catch {
      /* fall through to the literal shapes */
    }
  }
  if (value.kind === "flat") {
    const n = Number(value.flat);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
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
      case "modifier": {
        if (spec.target !== "initiative" || (spec.mode && spec.mode !== "add")) break;
        const value = flatValue(actor, spec.value);
        if (!value) break;
        // A modifier the book gates on how heavily the character is equipped
        // goes to the gated domain; one it states flatly is always on. The
        // distinction is the presence of a condition, not what it says — the
        // gate itself is applied where the loadout is known.
        const domain = spec.condition ? EFFECT_DOMAINS.LIGHT_INIT : EFFECT_DOMAINS.STYLE_INIT;
        addNum(domain, item.name, value);
        // A gated bonus also stands down the flat table entry: the ability is
        // the same one, stated more precisely.
        claimed.add(domain).add(EFFECT_DOMAINS.STYLE_INIT);
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

    const numeric = NUMERIC_DOMAINS[abilityKey];
    if (numeric && !claimed.has(numeric.domain)) addNum(numeric.domain, item.name, numeric.value);

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
        for (const pick of picksOf(item)) addStr(EFFECT_DOMAINS.MARTIAL_WEAPONS, resolveWeaponGroupPick(pick));
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
      case "armourtraining": // both spellings appear in the wild
      case "armortraining": {
        // The one machine-usable grant on the abilities side today: each rank
        // raises the wearable armour category by one step.
        addNum(EFFECT_DOMAINS.ARMOR_TRAINING, item.name, rankOf(actor, item));
        break;
      }
      default:
        break;
    }
  }
  return out;
}
