/* global globalThis */
/**
 * The acks-abilities bridge — proficiency facts read FROM the abilities model.
 *
 * A character built with acks-abilities/acks-content carries generic `ability`
 * items (one per definition, identified by `flags["acks-content"].cookbook.id`,
 * picks recorded in `flags["acks-abilities"].extras.selections`) instead of
 * this module's 42 effect-carrying pack items. This bridge translates those
 * facts into the SAME effect domains the collectors in effects.mjs already
 * serve, so loadout, proficiency, and roll-wrap consume them unchanged.
 *
 * Posture (mirrors acks-influence's ability-effects.mjs): read the FLAGS
 * directly so the data works even when acks-abilities is inactive — the flag
 * was written at import time. Use the abilities API (`selectionsOf`, `rankOf`)
 * when it is live, because interpretation of picks and ranks belongs there
 * (README consumer contract); fall back to the flag shape it documents.
 *
 * Asymmetry is the design: the bridge contributes BONUSES and positive
 * training facts (Finesse, style specialization, Martial/Armour Training,
 * Weapon Focus, Combat Trickery). It never claims the facts the abilities
 * model cannot represent yet (class weapon lists, base armour proficiency),
 * so the Non-Proficient Use penalties stay off under `auto` — see
 * proficiency.mjs enforcementActive().
 *
 * Dedup rule: an ability item whose OWN Active Effects already carry any
 * `flags.acks-equipment.*` change stands aside — it speaks the native effect
 * language (this module's pack items do), and bridging it too would double
 * its contribution.
 */
import { EFFECT_PREFIX, EFFECT_DOMAINS } from "./constants.mjs";
import { normalizeName } from "./config.mjs";

const CONTENT_ID = "acks-content";
const ABILITIES_FLAG_SCOPE = "acks-abilities";

/** Definition slug of an imported ability ("def.prof.weaponFinesse" → "weaponfinesse"). */
function defSlug(item) {
  const id = item.flags?.[CONTENT_ID]?.cookbook?.id;
  if (typeof id !== "string" || !id) return null;
  const tail = id.split(".").pop();
  return normalizeName(tail);
}

/** Item name with any trailing "(X)" pick suffix removed, normalized. */
function baseNameSlug(item) {
  return normalizeName(String(item.name ?? "").replace(/\([^)]*\)\s*$/, ""));
}

/** The picks, via the abilities API when live, else its documented flag shape. */
function picksOf(item) {
  const api = globalThis.acksAbilities;
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

/** Rank via the abilities API when live (its rule, not ours), else qty. */
function rankOf(actor, item) {
  const api = globalThis.acksAbilities;
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

/** Does this item already speak the native effect language? Then stand aside. */
function speaksNative(item) {
  for (const effect of item.effects ?? []) {
    if ((effect.changes ?? []).some((c) => String(c.key ?? "").startsWith(EFFECT_PREFIX))) return true;
  }
  return false;
}

/* ---------------------------------------------------------------------- */
/*  Pick → vocabulary resolvers                                            */
/* ---------------------------------------------------------------------- */

/** Fighting-style pick → style key (lowercased, as the collectors emit). */
export function resolveStylePick(pick) {
  const n = normalizeName(pick);
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
  const n = normalizeName(pick);
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
  const n = normalizeName(pick);
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
/*  The contribution set                                                   */
/* ---------------------------------------------------------------------- */

/**
 * Everything the actor's abilities-modelled items contribute, keyed the way
 * the effects.mjs collectors serve it.
 * @returns {{numeric: Map<string, {label:string,value:number}[]>,
 *            strings: Map<string, Set<string>>,
 *            booleans: Set<string>}}
 */
export function bridgeContributions(actor) {
  const out = { numeric: new Map(), strings: new Map(), booleans: new Set() };
  if (actor?.type !== "character") return out;

  const addNum = (domain, label, value) => {
    if (!out.numeric.has(domain)) out.numeric.set(domain, []);
    out.numeric.get(domain).push({ label, value });
  };
  const addStr = (domain, token) => {
    if (!token) return;
    if (!out.strings.has(domain)) out.strings.set(domain, new Set());
    out.strings.get(domain).add(String(token).toLowerCase());
  };

  for (const item of actor.items ?? []) {
    if (item.type !== "ability") continue;
    if (speaksNative(item)) continue; // native effect items are not bridged
    const slug = defSlug(item) ?? baseNameSlug(item);
    if (!slug) continue;

    const presence = PRESENCE_DOMAINS[slug];
    if (presence) out.booleans.add(presence);

    const numeric = NUMERIC_DOMAINS[slug];
    if (numeric) addNum(numeric.domain, item.name, numeric.value);

    switch (slug) {
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
        for (const pick of picksOf(item)) addStr(EFFECT_DOMAINS.MANEUVER_TRICKERY, normalizeName(pick));
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
