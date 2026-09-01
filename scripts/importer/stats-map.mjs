/**
 * Mapping: stat-block labels -> acks core system patch + Full Monster Sheet
 * extras (acks-monsters MonsterExtras schema) + embedded items (weapons from
 * Attacks/Damage, abilities from Proficiencies).
 *
 * Unknown labels stay raw (stored on the actor by the caller) — one-off
 * recipe directions come later, per the recipe philosophy. Enum keys mirror
 * acks-monsters scripts/config.mjs (public shipped data).
 */
import { savesForLevel } from "./stats.mjs";
import { MODULE_ID, DEFAULT_IMG } from "./constants.mjs";

const TYPE_KEYS = ["animal", "beastman", "construct", "enchanted", "giant", "humanoid", "incarnation", "monstrosity", "ooze", "plant", "undead", "vermin"];
const SIZE_KEYS = ["small", "man", "large", "huge", "gigantic", "colossal"];
const SPEED_KEYS = ["land", "burrow", "climb", "fly", "swim", "webcrawl"];
const SAVE_CLASS_BY_ABBR = { F: "fighter", C: "crusader", M: "mage", T: "thief", D: "dwarvenVaultguard", E: "elvenSpellsword" };

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);
// Private-use-area glyphs (damage-type icons, foot/inch marks) — strip for
// clean text; kept out of source as codepoints so the file stays ASCII.
const PUA_RE = /[-]/g;
const clean = (v) => (v ?? "").replace(PUA_RE, "").replace(/\s+/g, " ").trim();

// Damage-type icon glyph -> acks-monsters DAMAGE_TYPES enum key, decoded from
// the MM Damage-table legend (verified against the real Monstrous Manual by
// codepoint). The legend prints the SAME codepoint in the Mundane and
// Extraordinary columns — they differ only by COLOUR (red = extraordinary),
// which text extraction can never see. Extraordinary is therefore DERIVED from
// the monster (extraordinaryNatural below), the exact RAW ruling the book uses
// when it is not overriding with a red icon.
const DAMAGE_GLYPHS = Object.fromEntries(
  Object.entries({
    e900: "acidic",
    e901: "arcane",
    e902: "bludgeoning",
    e903: "necrotic",
    e904: "cold",
    e905: "electrical",
    e906: "fire",
    e907: "luminous",
    e908: "slashing",
    e90b: "piercing",
    e90c: "poisonous",
    e90d: "seismic",
    e910: "varies",
  }).map(([hex, type]) => [String.fromCodePoint(parseInt(hex, 16)), type]),
);
const damageTypeOf = (segment) => {
  for (const ch of segment ?? "") if (DAMAGE_GLYPHS[ch]) return DAMAGE_GLYPHS[ch];
  return null;
};

// Natural-weapon name -> acks-monsters NATURAL_WEAPONS enum key + that key's
// default damage type (MM Damage table: Bludgeoning = Constriction/Hoof/Tail/
// Tentacle/Tongue; Piercing = Bite/Stinger; Slashing = Claw/Talon; remaining
// keys from acks-monsters config.mjs NATURAL_WEAPONS). Ordered so a more
// specific stem wins (stinger before sting).
const NATURAL_WEAPON_KEYS = [
  ["bite", /^bit/, "piercing"],
  ["stinger", /^stinger/, "piercing"],
  ["sting", /^sting/, "piercing"],
  ["gore", /^gor/, "piercing"],
  ["horn", /^horn/, "piercing"],
  ["tusk", /^tusk/, "piercing"],
  ["spine", /^spine/, "piercing"],
  ["claw", /^claw/, "slashing"],
  ["talon", /^talon/, "slashing"],
  ["pincer", /^pincer/, "slashing"],
  ["hoof", /^(hoof|hoov|hoove)/, "bludgeoning"],
  ["tail", /^tail/, "bludgeoning"],
  ["tentacle", /^tentacl/, "bludgeoning"],
  ["tongue", /^tongue/, "bludgeoning"],
  ["constriction", /^constrict/, "bludgeoning"],
  ["ram", /^ram/, "bludgeoning"],
  ["feeler", /^feeler/, "bludgeoning"],
  ["envelopment", /^envelop/, "acidic"],
  ["weapon", /^weapon/, "varies"],
];
/** Resolve an attack name to { key, damage } (enum key + default type) or null. */
function naturalWeaponOf(name) {
  const n = (name ?? "").toLowerCase().trim();
  for (const [key, re, damage] of NATURAL_WEAPON_KEYS) if (re.test(n)) return { key, damage };
  return null;
}

/**
 * Whether a monster's NATURAL attacks deal extraordinary (vs mundane) damage,
 * per the MM Damage-table rulings (the icon's red/black colour is unreadable in
 * text, so we apply the same rules the book states):
 *   incarnation / enchanted    -> always extraordinary
 *   humanoid (not enchanted)    -> always mundane
 *   animal                      -> extraordinary iff > 4+1 HD AND huge-or-larger
 *   construct/giant/monstrosity/undead/vermin -> extraordinary iff > 4+1 HD
 *   anything else (ooze/plant/beastman/unknown) -> mundane (recipe override later)
 */
function extraordinaryNatural(types = [], hd = {}, size = "") {
  const t = new Set(types);
  if (t.has("incarnation") || t.has("enchanted")) return true;
  if (t.has("humanoid")) return false;
  const count = hd.count ?? 0;
  const bonus = hd.bonus ?? 0;
  const moreThan4plus1 = count > 4 || (count === 4 && bonus > 1);
  const hugeOrLarger = ["huge", "gigantic", "colossal"].includes(size);
  if (t.has("animal")) return moreThan4plus1 && hugeOrLarger;
  if (["construct", "giant", "monstrosity", "undead", "vermin"].some((k) => t.has(k))) return moreThan4plus1;
  return false;
}

const firstInt = (v) => {
  const m = /(-?[\d,]+)/.exec(v ?? "");
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
};

/** "Wandering-noun (2d4) / Lair-noun (2d4)" -> encounter side object. */
function encSide(value) {
  if (!value || /^none/i.test(value)) return null;
  const parts = value.split("/").map((s) => s.trim());
  const parse = (part) => {
    const m = /^([^(]+?)\s*\((\d+d\d+(?:[+-]\d+)?)\)/.exec(part ?? "");
    return m ? { noun: m[1].trim(), number: m[2] } : null;
  };
  const wandering = parse(parts[0]);
  const lair = parse(parts[1] ?? parts[0]);
  if (!wandering && !lair) return null;
  return { wandering: wandering ?? { noun: "", number: "" }, lair: lair ?? { noun: "", number: "" } };
}

export function mapPairs(pairs) {
  const system = {};
  const extras = {};
  const items = [];
  const applied = [];
  const unmappedLabels = new Set(pairs.map((p) => p.label));
  const take = (label, { raw = false } = {}) => {
    const found = pairs.find((p) => p.label.toLowerCase() === label.toLowerCase());
    if (!found) return null;
    applied.push(found.label);
    unmappedLabels.delete(found.label);
    return raw ? found.value : clean(found.value);
  };

  /* --- core system --- */

  const ac = take("Armor Class");
  if (ac && /^\d+/.test(ac)) system.aac = { value: parseInt(ac, 10) };

  const hd = take("Hit Dice");
  if (hd) {
    const m = /^(\d+)(?:\s*([+-])\s*(\d+))?\s*(\**)/.exec(hd);
    if (m) {
      const count = parseInt(m[1], 10);
      const bonus = m[2] ? (m[2] === "-" ? -1 : 1) * parseInt(m[3], 10) : 0;
      const asterisks = (m[4] ?? "").length;
      const avg = Math.max(1, Math.floor(count * 4.5 + bonus));
      system.hp = { hd: `${count}d8${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ""}`, value: avg, max: avg };
      extras.hd = { count, bonus: bonus || null, asterisks: asterisks || null, dieType: 8 };
    }
  }

  const save = take("Save");
  if (save) {
    const m = /^([A-Z]+)\s*(\d+)?/.exec(save.trim());
    const abbr = m?.[1] ?? "F";
    const level = abbr === "NH" ? 0 : parseInt(m?.[2] ?? "0", 10) || 0;
    const row = savesForLevel(level);
    system.saves = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { value: v }]));
    system.saves.breath = { value: row.blast };
    system.saves.wand = { value: row.implements };
    extras.saveAs = { class: SAVE_CLASS_BY_ABBR[abbr] ?? "fighter", level };
  }

  const morale = take("Morale");
  const xp = take("XP");
  const alignment = take("Alignment");
  const treasure = take("Treasure Type");
  system.details = {
    ...(morale ? { morale: parseInt(morale.replace(/[^\d-]/g, ""), 10) || 0 } : {}),
    ...(xp !== null ? { xp: firstInt(xp) ?? 0 } : {}),
    ...(alignment ? { alignment: capitalize(alignment.split(/[ (]/)[0].toLowerCase()) } : {}),
    ...(treasure ? { treasure: { type: /^none/i.test(treasure) ? "None" : treasure.trim() } } : {}),
  };

  const dungeonEnc = take("Dungeon Enc");
  const wildernessEnc = take("Wilderness Enc");
  const dice = (v) => /\d+d\d+(?:[+-]\d+)?/.exec(v ?? "")?.[0] ?? "";
  if (dungeonEnc || wildernessEnc) {
    system.details.appearing = { d: dice(dungeonEnc), w: dice(wildernessEnc) };
    const d = encSide(dungeonEnc);
    const w = encSide(wildernessEnc);
    if (d || w) extras.encounter = { ...(d ? { dungeon: d } : {}), ...(w ? { wilderness: w } : {}) };
  }
  const lair = take("Lair");
  if (lair) (extras.encounter ??= {}).lairChance = firstInt(lair);

  /* --- speeds (all rows) + core base movement --- */

  const speedRows = pairs.filter((p) => /^speed(\s*\(|$)/i.test(p.label));
  if (speedRows.length) {
    extras.speeds = [];
    for (const row of speedRows) {
      applied.push(row.label);
      unmappedLabels.delete(row.label);
      const typeKey = SPEED_KEYS.find((k) => row.label.toLowerCase().includes(k)) ?? "land";
      const nums = [...row.value.matchAll(/(\d+)/g)].map((n) => parseInt(n[1], 10));
      extras.speeds.push({ type: typeKey, combat: nums[0] ?? null, run: nums[1] ?? nums[0] ?? null, hover: false });
      if (typeKey === "land" && nums.length) system.movement = { base: nums[nums.length - 1] };
    }
    if (!system.movement && extras.speeds[0]?.run) system.movement = { base: extras.speeds[0].run };
  }

  /* --- classification --- */

  const type = take("Type");
  if (type) {
    const lower = type.toLowerCase();
    extras.types = TYPE_KEYS.filter((k) => lower.includes(k));
    const sub = /\(([^)]+)\)/.exec(type);
    if (sub) extras.subtype = sub[1].trim();
  }

  const size = take("Size");
  if (size) {
    const lower = size.toLowerCase();
    extras.size = lower.startsWith("man") ? "man" : (SIZE_KEYS.find((k) => lower.startsWith(k)) ?? "");
    const stone = /([\d,]+)\s*st/.exec(size);
    if (stone) {
      const st = parseInt(stone[1].replace(/,/g, ""), 10);
      extras.mass = { stone: st, lbs: st * 10 };
    }
  }

  /* --- senses --- */

  const vision = take("Vision");
  if (vision) {
    const lower = vision.toLowerCase();
    extras.vision = ["standard", "night", "lightless", "acute", "blind"].filter((k) => lower.includes(k));
    const range = /lightless[^(]*\((\d+)/i.exec(vision);
    if (range) extras.lightlessRange = parseInt(range[1], 10);
  }
  take("Other Senses"); // acknowledged; structured senses get per-recipe directions later

  /* --- carrying --- */

  const load = take("Normal Load");
  if (load) extras.load = { normal: firstInt(load) };
  const maxLoad = take("Max Load");
  if (maxLoad) (extras.load ??= {}).capacity = firstInt(maxLoad);

  /* --- attacks -> weapon items; the throw rides in the Attacks parenthetical --- */

  const attacks = take("Attacks");
  const damageRaw = take("Damage", { raw: true });
  const damage = clean(damageRaw);
  if (attacks) {
    const throwMatch = /(\d+)\+/.exec(attacks);
    if (throwMatch) system.thac0 = { throw: parseInt(throwMatch[1], 10) };
    system.attacks = [attacks, damage].filter(Boolean).join(" — ");
    // Split RAW segments so each keeps its damage-type icon glyph.
    const segments = (damageRaw ?? "").split("/").map((s) => s.trim()).filter((s) => /\d*d\d+/.test(s));
    // Names from the parenthetical: "2 talons, bite 4+" -> [talons, talons, bite]
    const inner = /\(([^)]*)\)/.exec(attacks)?.[1] ?? "";
    const names = [];
    for (let token of inner.replace(/\d+\+\s*$/, "").split(",")) {
      token = token.trim().replace(/\d+\+\s*$/, "").trim();
      const counted = /^(\d+)\s+(.+)$/.exec(token);
      if (counted) {
        for (let i = 0; i < Math.min(parseInt(counted[1], 10), 8); i++) names.push(counted[2]);
      } else if (token) {
        names.push(token);
      }
    }
    // Extraordinary applies to natural attacks only, derived from the monster.
    const extraNatural = extraordinaryNatural(extras.types, extras.hd, extras.size);
    segments.forEach((dmgSeg, i) => {
      const dmg = /\d*d\d+(?:[+-]\d+)?/.exec(clean(dmgSeg))?.[0] ?? clean(dmgSeg);
      const rawName = (names[i] ?? names[names.length - 1] ?? `attack ${i + 1}`).trim();
      const nw = naturalWeaponOf(rawName);
      // Damage type: prefer the printed icon glyph; fall back to the natural
      // weapon's RAW default (Claw -> slashing, etc.).
      const damageType = damageTypeOf(dmgSeg) ?? nw?.damage ?? null;
      const name = capitalize(rawName);
      items.push({
        name,
        type: "weapon",
        img: DEFAULT_IMG.ATTACK,
        flags: {
          [MODULE_ID]: {
            ...(nw ? { naturalWeapon: nw.key } : {}),
            ...(damageType ? { damageType } : {}),
            extraordinary: nw ? extraNatural : false,
          },
        },
        system: {
          description: "",
          damage: dmg,
          bonus: 0,
          melee: true,
          missile: false,
          equipped: true,
          pattern: "transparent",
          tags: [],
          counter: { value: 1, max: 1 },
          cost: 0,
          weight: 0,
          weight6: 0,
        },
      });
    });
  }

  /* --- proficiencies -> ability items --- */

  const profs = take("Proficiencies");
  if (profs && !/^none/i.test(profs)) {
    for (const name of profs.split(",").map((s) => s.trim()).filter(Boolean)) {
      items.push({
        name,
        type: "ability",
        img: DEFAULT_IMG.ABILITY,
        system: {
          description: "",
          proficiencytype: "general",
          favorite: false,
          pattern: "white",
          requirements: "",
          roll: "",
          rollType: "above",
          rollTarget: 0,
          blindroll: false,
          save: "",
        },
      });
    }
  }

  return { system, extras, items, applied, unmapped: [...unmappedLabels] };
}
