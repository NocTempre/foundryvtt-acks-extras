/* global game, document */
/**
 * Compact profile strips: fighting styles, weapon categories, armour.
 *
 * These are STATES, not list entries. A sheet that spells them out as rows
 * ("Fighting Style: Dual Weapon", "Armour Proficiency: Heavy", …) buries the
 * proficiencies that actually do something under a wall of flags. So they render
 * as an always-visible strip: every slot is shown, a trained one lights up, and a
 * SPECIALIZED / FOCUSED one goes gold. Nothing is hidden and nothing repeats.
 *
 * The state is read from acks-equipment's own profile API (effects + actor flags)
 * — never from item names — so it stays right however the training was granted.
 * With that module absent there is no profile to read and the strips are empty
 * (the card simply omits them) rather than guessed at.
 */
import { DAMAGE_TYPE_ICONS, UNTYPED_ICON } from "./damage-type.mjs";
import { ITEM_TYPE, ACTOR_TYPE, SELECTION_VOCAB, matchSelectionKey } from "./vocab.mjs";
import { locOr as loc } from "./util.mjs";

// Read off globalThis so a resolver called before `game` exists — or from a
// Node harness with no Foundry at all — answers null instead of throwing.
const equipmentApi = () => globalThis.acksExtras?.equipment ?? globalThis.game?.modules?.get("acks-extras")?.api?.equipment ?? null;

/** Fighting styles (JJ p.291), in the order the books present them. */
const STYLES = [
  { key: "single", token: "single", icon: "fas fa-1", label: "ACKS-LIB.style.single", fallback: "Single Weapon" },
  { key: "dual", token: "dual", icon: "fas fa-2", label: "ACKS-LIB.style.dual", fallback: "Dual Weapon" },
  { key: "twohanded", token: "twoHanded", icon: "fas fa-hands", label: "ACKS-LIB.style.twoHanded", fallback: "Two-Handed Weapon" },
  { key: "weaponshield", token: "weaponShield", icon: "fas fa-shield-halved", label: "ACKS-LIB.style.weaponShield", fallback: "Weapon & Shield" },
  { key: "missile", token: "missile", icon: "fas fa-crosshairs", label: "ACKS-LIB.style.missile", fallback: "Missile" },
];

/**
 * Every weapon class a character can be proficient with, plus unarmed. These are
 * the pills; the class-build SELECTION (JJ p. 290) decides which light up, and a
 * single selection routinely covers several of them — "all melee of medium size
 * or smaller" lights every melee class, a narrow grouping lights one.
 *
 * Two of the classes are themselves plural groupings in the books (flails/
 * hammers/maces, swords/daggers), which is why these are classes rather than
 * individual weapons.
 */
const WEAPON_CLASSES = [
  { key: "unarmed", chip: "UN", melee: true, label: "ACKS-LIB.weaponCat.unarmed", fallback: "Unarmed" },
  { key: "axe", chip: "AX", melee: true, label: "ACKS-LIB.weaponCat.axe", fallback: "Axes" },
  { key: "sworddagger", chip: "SW", melee: true, label: "ACKS-LIB.weaponCat.swordDagger", fallback: "Swords & Daggers" },
  { key: "flailhammermace", chip: "MC", melee: true, label: "ACKS-LIB.weaponCat.flailHammerMace", fallback: "Flails, Hammers & Maces" },
  { key: "spearpolearm", chip: "SP", melee: true, label: "ACKS-LIB.weaponCat.spearPolearm", fallback: "Spears & Polearms" },
  { key: "bow", chip: "BW", missile: true, label: "ACKS-LIB.weaponCat.bow", fallback: "Bows" },
  { key: "crossbow", chip: "XB", missile: true, label: "ACKS-LIB.weaponCat.crossbow", fallback: "Crossbows" },
  { key: "other", chip: "OT", melee: true, missile: true, label: "ACKS-LIB.weaponCat.other", fallback: "Other (slings, staffs, nets, whips…)" },
];

/** Armour SELECTION ladder (JJ p. 290), lightest first — five rungs, not four. */
const ARMOUR = [
  { key: "unarmored", token: "unarmored", icon: "fas fa-user", label: "ACKS-LIB.armour.unarmored", fallback: "Unarmoured" },
  { key: "verylight", token: "veryLight", icon: "fas fa-shirt", label: "ACKS-LIB.armour.veryLight", fallback: "Very Light" },
  { key: "light", token: "light", icon: "fas fa-vest", label: "ACKS-LIB.armour.light", fallback: "Light" },
  { key: "medium", token: "medium", icon: "fas fa-user-shield", label: "ACKS-LIB.armour.medium", fallback: "Medium" },
  { key: "heavy", token: "heavy", icon: "fas fa-shield", label: "ACKS-LIB.armour.heavy", fallback: "Heavy" },
];

/**
 * Which weapon CLASSES an equipment profile covers — its `{all, tokens}` read
 * through `weaponTokenClasses`. Unarmed is always available — anyone may strike
 * unarmed — so it lights for every character and golds only with the Unarmed
 * Fighting proficiency.
 */
function coveredClasses(all, tokens, api) {
  const covered = new Set(["unarmed"]);
  if (all) for (const c of WEAPON_CLASSES) covered.add(c.key);
  else for (const t of tokens) for (const k of weaponTokenClasses(t, api)) covered.add(k);
  return covered;
}

const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");

/**
 * Ability items that merely RECORD one of these states — they belong in the
 * strips, not in the proficiency list. Matched on a normalised name prefix, the
 * same way acks-equipment matches its own proficiency names.
 */
export const isProfileAbility = (item) =>
  item?.type === ITEM_TYPE.ability && /^(fightingstyle|armou?rproficiency|weaponproficiency|weaponfocus)/.test(norm(item.name));

/**
 * Synonyms for the free-text picks on an imported proficiency. acks-abilities
 * stores `selections` as free vocabulary BY DESIGN (the meaningful token set is
 * per-ability and lives in the book) and tells consumers to normalise and match
 * against their own vocabulary — this is acks-lib's side of that contract. For
 * WEAPONS it is the fallback behind the sheet's own vocabulary: a grant token or
 * a group name resolves there (`weaponTokenClasses`); what reaches this table
 * is a single weapon's name — "dagger", "long bow" — or a phrasing the
 * vocabulary does not list, and it lights the class the weapon belongs to.
 */
const WEAPON_SYNONYMS = {
  sworddagger: ["sword", "swords", "dagger", "daggers", "swordsdaggers", "sworddagger", "swordsanddaggers"],
  axe: ["axe", "axes"],
  bow: ["bow", "bows", "longbow", "shortbow", "compositebow", "bowscrossbows"],
  crossbow: ["crossbow", "crossbows", "arbalest"],
  flailhammermace: ["mace", "maces", "flail", "flails", "hammer", "hammers", "macesflailshammers", "flailhammermace", "flailshammersmaces"],
  spearpolearm: ["spear", "spears", "polearm", "polearms", "spearspolearms", "spearsandpolearms"],
  other: ["other", "sling", "slings", "thrown", "slingsthrown", "staff", "staffs", "staves", "net", "nets", "whip", "whips", "bola", "bolas"],
  unarmed: ["unarmed", "unarmedfighting", "brawling", "fist", "fists"],
};
const STYLE_SYNONYMS = {
  single: ["single", "singleweapon"],
  dual: ["dual", "dualweapon", "dualwielding", "twoweapons", "twoweapon"],
  twohanded: ["twohanded", "twohandedweapon"],
  weaponshield: ["weaponshield", "weaponandshield", "shield", "shieldandweapon"],
  missile: ["missile", "missileweapon", "ranged"],
};
const ARMOUR_SYNONYMS = {
  unarmored: ["unarmored", "unarmoured", "none", "no"],
  verylight: ["verylight", "verylightarmor", "verylightarmour"],
  light: ["light", "lightarmor", "lightarmour", "leather"],
  medium: ["medium", "mediumarmor", "mediumarmour", "chain"],
  heavy: ["heavy", "heavyarmor", "heavyarmour", "plate"],
};
const matchSynonym = (token, table) => {
  const t = norm(token);
  if (!t) return null;
  for (const [key, list] of Object.entries(table)) {
    if (key === t || list.includes(t)) return key;
    // "swords & daggers" folds to swordsdaggers; also accept a contained word.
    if (list.some((s) => t === s || t.startsWith(s) || s.startsWith(t))) return key;
  }
  return null;
};

/**
 * The weapon classes one grant token or stored pick covers, as slot keys.
 *
 * ONE resolver for every surface that reads a weapon grant at class granularity
 * — the strips, the class-training editor — so a class trained in every missile
 * weapon and every melee weapon up to medium size lights the same pills wherever
 * it is drawn. The token is read through the sheet's own vocabulary first
 * (`SELECTION_VOCAB.weaponProficiency`, whose keys ARE the grant tokens of
 * equipment's `proficiency.mjs`), so a box ticked on the ability sheet and a
 * clause written into a training effect agree:
 *   all             → every class
 *   missile:all     → every missile class
 *   melee:<size>    → every melee WEAPON class (size is per weapon and cannot
 *                     be told apart at class granularity; unarmed is no weapon
 *                     in equipment's grammar, so a size clause never names it —
 *                     the strips light it for every body on their own)
 *   <category>      → that class, by key or by the book's plural name
 * Anything else is a single NAMED weapon or a phrasing the vocabulary does not
 * list: the synonym table places it, else equipment's own weapon table when
 * that feature is live. A token nothing recognises covers no class.
 * @returns {string[]} `SLOT_VOCAB.weapons[].key` values, in vocabulary order
 */
export function weaponTokenClasses(token, equipment = equipmentApi()) {
  const key = matchSelectionKey(SELECTION_VOCAB.weaponProficiency, token);
  const keysWhere = (test) => WEAPON_CLASSES.filter(test).map((c) => c.key);
  if (key === "all") return keysWhere(() => true);
  if (key === "missile:all") return keysWhere((c) => c.missile);
  if (key?.startsWith("melee:")) return keysWhere((c) => c.melee && c.key !== "unarmed");
  if (key && WEAPON_CLASSES.some((c) => c.key === key)) return [key];
  const syn = matchSynonym(token, WEAPON_SYNONYMS);
  if (syn) return [syn];
  const cat = norm(equipment?.config?.WEAPONS?.[norm(token)]?.cat);
  return cat && WEAPON_CLASSES.some((c) => c.key === cat) ? [cat] : [];
}

/**
 * What the character's IMPORTED proficiency items grant. Read through
 * acks-abilities' own API (`getExtras().category` + `selectionsOf`) — never by
 * parsing item names, which that module explicitly owns. `equipment` is that
 * feature's API, for placing a named weapon by its table.
 */
function abilityGrants(actor, equipment) {
  const out = { styles: new Set(), spec: new Set(), weapons: new Set(), armourRank: -1, has: { styles: false, weapons: false, armour: false } };
  const api = globalThis.acksExtras?.abilities ?? game.modules?.get("acks-extras")?.api?.abilities ?? null;
  if (!api?.selectionsOf) return out;
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.ability) continue;
    let category = "";
    try {
      category = api.getExtras?.(item)?.category ?? "";
    } catch {
      continue;
    }
    const picks = (() => {
      try {
        return api.selectionsOf(item) ?? [];
      } catch {
        return [];
      }
    })();
    // A category with no explicit pick still declares the DOMAIN; the item's own
    // name is the fallback pick ("Fighting Style: Dual Weapon" → dual).
    const tokens = picks.length ? picks : [String(item.name ?? "").split(":").pop()];
    if (category === "fightingStyle") {
      out.has.styles = true;
      for (const t of tokens) {
        const k = matchSynonym(t, STYLE_SYNONYMS);
        if (k) out.styles.add(k);
      }
    } else if (category === "weaponProficiency") {
      out.has.weapons = true;
      for (const t of tokens) for (const k of weaponTokenClasses(t, equipment)) out.weapons.add(k);
    } else if (category === "armorProficiency") {
      out.has.armour = true;
      for (const t of tokens) {
        const k = matchSynonym(t, ARMOUR_SYNONYMS);
        const i = ARMOUR.findIndex((a) => a.key === k);
        if (i > out.armourRank) out.armourRank = i;
      }
    }
  }
  return out;
}

/**
 * Build the three strips for an actor.
 * @returns {{styles: object[], weapons: object[], armour: object[], any: boolean}}
 */
export function profileStrips(actor) {
  if (actor?.type !== ACTOR_TYPE.character) return { styles: [], weapons: [], armour: [], any: false };
  const api = equipmentApi();
  // The character's own imported proficiency items are a first-class source, so
  // the strips work with acks-abilities alone (no acks-equipment profile needed).
  const grants = abilityGrants(actor, api);
  const anyGrant = grants.has.styles || grants.has.weapons || grants.has.armour;
  if (!api && !anyGrant) return { styles: [], weapons: [], armour: [], any: false };

  let trained = new Set();
  let spec = new Set();
  let weaponProf = null;
  let armourMax = null;
  if (api) {
    try {
      trained = new Set([...(api.trainedStyles?.(actor) ?? [])].map(norm));
      spec = new Set([...(api.specializedStyles?.(actor) ?? [])].map(norm));
      weaponProf = api.weaponProficiency?.(actor) ?? null;
      armourMax = api.armorMax?.(actor) ?? null;
    } catch {
      /* equipment profile unreadable — the ability grants below still stand */
    }
  }
  for (const s of grants.styles) trained.add(s);

  /**
   * "Unconfigured" is NOT "proficient in everything". acks-equipment answers
   * permissively when a character has no profile — `{all: true}` for weapons and
   * `heavy` for armour — so it never penalises an un-set-up actor at roll time.
   * Lighting the whole strip off that default would state a proficiency the
   * character has not been given. So a group with no explicit profile (no flag,
   * no granting effect) shows only what is true for ANY body: unarmed, and
   * unarmoured, plus the two mandatory fighting styles.
   */
  const flagSet = (k) => {
    const v = actor.getFlag?.("acks-extras", k);
    return v != null && v !== "" && !(Array.isArray(v) && !v.length);
  };
  const stylesConfigured = grants.has.styles || flagSet("styles") || trained.size > 2 || spec.size > 0;

  // With no profile the whole group is UNKNOWN — every pill greys out, including
  // the styles every class technically has. An unset sheet states nothing; a set
  // one states exactly what it was given.
  const styles = STYLES.map((s) => ({
    key: s.key,
    icon: s.icon,
    label: loc(s.label, s.fallback),
    on: stylesConfigured && trained.has(s.key),
    gold: stylesConfigured && spec.has(s.key),
    unset: !stylesConfigured,
  }));

  // weaponProficiency answers with `{all, tokens}` (tokens a Set) — it also
  // accepts a bare "all", array or CSV from older builds, so normalise all four.
  const allWeapons = weaponProf?.all === true || norm(weaponProf) === "all";
  const rawTokens = weaponProf?.tokens ?? weaponProf;
  const tokenList =
    rawTokens instanceof Set
      ? [...rawTokens]
      : Array.isArray(rawTokens)
        ? rawTokens
        : rawTokens && typeof rawTokens === "object"
          ? Object.keys(rawTokens)
          : String(rawTokens ?? "").split(",");
  const profTokens = new Set(tokenList.map(norm).filter(Boolean));

  // Weapon Focus is per weapon GROUP (RR p.121); map each group to the category
  // it sharpens so a focused category reads gold.
  const FOCUS_TO_CATEGORY = {
    axes: "axe",
    macesflailshammers: "flailhammermace",
    swordsdaggers: "sworddagger",
    bowscrossbows: "bow",
    slingsthrown: "other",
    spearspolearms: "spearpolearm",
  };
  const focusCats = new Set();
  try {
    const domain = api.EFFECT_DOMAINS?.WEAPON_FOCUS ?? "weaponFocus";
    for (const g of api.collectStringFlags?.(actor, domain) ?? []) {
      const cat = FOCUS_TO_CATEGORY[norm(g)];
      if (cat) focusCats.add(cat);
      // A focused bow group also covers crossbows.
      if (norm(g) === "bowscrossbows") focusCats.add("crossbow");
    }
  } catch {
    /* no focus data — no gold, which is the honest default */
  }

  // Every weapon class shows; the class-build selection lights the ones it covers.
  // A bare `{all:true}` with no tokens and no flag is acks-equipment's permissive
  // DEFAULT, not a granted unrestricted selection — so it is only consulted when
  // an equipment profile actually exists. Otherwise the imported proficiency
  // items are the whole story, and "Weapons (Swords)" must not read as "all".
  const equipmentWeapons = flagSet("weaponProficiency") || profTokens.size > 0;
  const covered = equipmentWeapons ? coveredClasses(allWeapons, profTokens, api) : new Set();
  for (const w of grants.weapons) covered.add(w);
  // Unarmed is always available whichever source declared the training:
  // `coveredClasses` adds it for a profile, so a training declared only by
  // ability items adds it too, rather than showing a fist nobody granted away.
  if (grants.has.weapons) covered.add("unarmed");
  let unarmedFocus = false;
  try {
    unarmedFocus = !!api?.hasEffectFlag?.(actor, api.EFFECT_DOMAINS?.UNARMED ?? "unarmedFighting");
  } catch {
    /* no unarmed-fighting data */
  }
  const weaponsConfigured = grants.has.weapons || equipmentWeapons;
  const weapons = WEAPON_CLASSES.map((c) => ({
    key: c.key,
    chip: c.chip,
    label: loc(c.label, c.fallback),
    on: weaponsConfigured && covered.has(c.key),
    gold: weaponsConfigured && (c.key === "unarmed" ? unarmedFocus : focusCats.has(c.key)),
    unset: !weaponsConfigured,
  }));

  // Same story: `heavy` is acks-equipment's permissive fallback, not a grant.
  const equipmentArmour =
    flagSet("armorMax") ||
    (() => {
      try {
        // collectStringFlags answers with a Set — measure size, not length.
        return [...(api?.collectStringFlags?.(actor, api.EFFECT_DOMAINS?.ARMOR_PROF ?? "armorTraining") ?? [])].length > 0;
      } catch {
        return false;
      }
    })();
  const armourConfigured = grants.has.armour || equipmentArmour;
  const maxRank = Math.max(
    equipmentArmour ? ARMOUR.findIndex((a) => a.key === norm(armourMax)) : -1,
    grants.armourRank,
  );
  const armour = ARMOUR.map((a, i) => ({
    key: a.key,
    icon: a.icon,
    label: loc(a.label, a.fallback),
    on: armourConfigured && maxRank >= 0 && i <= maxRank,
    gold: false,
    unset: !armourConfigured,
  }));
  // A SHIELD is its own armour category (RR pp. 128/140-141), not a rung on the
  // suit ladder — and RAW it only benefits a class with the Weapon & Shield
  // fighting style (JJ p. 291), so that style is what lights it.
  armour.push({
    key: "shield",
    icon: "fas fa-shield-halved",
    label: loc("ACKS-LIB.armour.shield", "Shield (+1 AC — needs the Weapon & Shield style)"),
    on: stylesConfigured && trained.has("weaponshield"),
    gold: stylesConfigured && spec.has("weaponshield"),
    unset: !stylesConfigured,
  });

  return { styles, weapons, armour, any: true };
}

/**
 * The strips as a DOM element — the follower card's build row, mountable on any
 * surface (equipment's inventory Training row). Same pill classes, same state
 * grammar (lit = trained, gold = specialized/focused, grey = unconfigured), so
 * the two renderings cannot drift apart in meaning. Returns null when there is
 * nothing to state, so a caller simply omits the row.
 */
export function profileStripElement(actor) {
  const strips = profileStrips(actor);
  if (!strips.any) return null;
  const root = document.createElement("div");
  root.className = "acks-lib-build";
  const group = (tipKey, labelKey, pills, chip = false) => {
    if (!pills.length) return;
    const g = document.createElement("span");
    g.className = "fc-build-group";
    g.dataset.tooltip = game.i18n.localize(tipKey);
    const label = document.createElement("span");
    label.className = "fc-build-label";
    label.textContent = game.i18n.localize(labelKey);
    g.append(label);
    for (const p of pills) {
      const pill = document.createElement("span");
      pill.className =
        `fc-pill${chip ? " chip" : ""}` +
        (p.unset ? " unset" : `${p.on ? " on" : ""}${p.gold ? " gold" : ""}`);
      pill.dataset.tooltip = p.label;
      if (chip) pill.textContent = p.chip;
      else {
        const icon = document.createElement("i");
        icon.className = p.icon;
        pill.append(icon);
      }
      g.append(pill);
    }
    root.append(g);
  };
  group("ACKS-LIB.followerCard.styles", "ACKS-LIB.followerCard.stylesShort", strips.styles);
  group("ACKS-LIB.followerCard.weaponProf", "ACKS-LIB.followerCard.weaponShort", strips.weapons, true);
  group("ACKS-LIB.followerCard.armourProf", "ACKS-LIB.followerCard.armourShort", strips.armour);
  return root;
}

/** Weapon size as pips (tiny 1 → large 4); 0 when the size is unknown. */
export function sizePips(item) {
  const order = ["tiny", "small", "medium", "large"];
  let size = null;
  try {
    size = equipmentApi()?.classifyWeapon?.(item)?.size ?? null;
  } catch {
    size = null;
  }
  const i = order.indexOf(norm(size));
  if (i < 0) return { count: 0, label: "", pips: [] };
  return {
    count: i + 1,
    label: loc(`ACKS-LIB.size.${order[i]}`, order[i]),
    pips: Array.from({ length: i + 1 }, (_, n) => n),
  };
}

/**
 * The three slot vocabularies, in the order every surface shows them. Exported
 * because the class-modifiers editor renders the SAME slots as toggles and must
 * not keep a second copy: `key` is the normalised identity the strips match on,
 * `token` the canonical spelling a grant is WRITTEN as (the profile compares
 * case-insensitively; what is stored should still read the way the rest of the
 * module spells it).
 */
export const SLOT_VOCAB = Object.freeze({ styles: STYLES, weapons: WEAPON_CLASSES, armour: ARMOUR });

export { DAMAGE_TYPE_ICONS, UNTYPED_ICON };
