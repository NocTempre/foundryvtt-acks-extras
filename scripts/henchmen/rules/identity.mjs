/**
 * Candidate identity generation (RR 495-503 People + JJ 245-257 NPCs).
 * Pure module. Every candidate is a UNIQUE INDIVIDUAL: name, gender, age,
 * appearance, and (for 0th level) an occupation plus a class trajectory —
 * all generated from the LOCATION's demographics (weighted culture mix).
 */
import { getTable, optTable } from "./tables.mjs";

function pick(rand, list) {
  return list[Math.floor(rand() * list.length)];
}

function pickWeighted(rand, entries, weightOf) {
  const total = entries.reduce((s, e) => s + weightOf(e), 0);
  if (total <= 0) return entries[0];
  let roll = rand() * total;
  for (const entry of entries) {
    roll -= weightOf(entry);
    if (roll <= 0) return entry;
  }
  return entries[entries.length - 1];
}

/**
 * Registry entry for a class ({bucket, rarity, race?, cultures?, sex?,
 * alignment?}). DERIVED, not a shipped table: bucket comes from the
 * imported class distribution, rarity from the imported rarity ladder,
 * race from the class key's own adjective, and the RESTRICTIONS from the
 * imported `people.classRestrictions` blocks (RR class descriptions). A
 * world-imported `people.classRegistry` still wins if one exists.
 */
export function classInfo(classKey) {
  const key = String(classKey ?? "").toLowerCase().trim();
  if (!key) return null;
  const imported = optTable("people", "classRegistry")?.classes?.[key];
  if (imported) return imported;

  const entry = {};
  const buckets = optTable("rarity", "classDistribution")?.buckets ?? [];
  for (const b of buckets) {
    if ((b.rows ?? []).some((r) => String(r.class ?? "").toLowerCase() === key)) {
      entry.bucket = b.id;
      break;
    }
  }
  const tiers = optTable("rarity", "classRarityTables")?.variants?.default?.tiers ?? {};
  for (const [tier, list] of Object.entries(tiers)) {
    if ((list ?? []).some((c) => String(c).toLowerCase() === key)) {
      entry.rarity = tier;
      break;
    }
  }
  // Race from the key's own adjective — computed inline, NOT via
  // raceForClass(): that reads classInfo and would recurse forever.
  const race = raceFromClassKey(key);
  if (race) entry.race = race;
  Object.assign(entry, optTable("people", "classRestrictions")?.classes?.[key] ?? {});
  return Object.keys(entry).length ? entry : null;
}

/**
 * Race announced by a class KEY's own adjective ("elven spellsword" → elf),
 * or null for unmarked (human) classes. Pure string work — classInfo builds
 * on this, so it must never read the registry back.
 */
export function raceFromClassKey(classKey) {
  const m = String(classKey ?? "").toLowerCase().match(/^(elven|dwarven|zaharan|nobiran|thrassian)\b/);
  return m ? { elven: "elf", dwarven: "dwarf", zaharan: "zaharan", nobiran: "nobiran", thrassian: "thrassian" }[m[1]] : null;
}

/** The race a class belongs to ("human" when nothing declares otherwise). */
export function raceForClass(classKey) {
  return classInfo(classKey)?.race ?? raceFromClassKey(classKey) ?? "human";
}

/** Optional per-class culture whitelist (barbarians, shamans…). */
export function culturesForClass(classKey) {
  return classInfo(classKey)?.cultures ?? null;
}

/** Sex restriction for a class ("female", "male", or null). */
export function sexForClass(classKey) {
  return classInfo(classKey)?.sex ?? null;
}

/** The race of a culture ("human" when the entry declares none). */
export function raceOfCulture(cultureId) {
  return getTable("people", "cultures").list[cultureId]?.race ?? "human";
}

/**
 * Resolve a culture id from the location's demographics weights,
 * CONSTRAINED to a race so culture and class always align (no Zaharan
 * humans, no elven vaultguards). Falls back to the race's own culture(s)
 * when the demographics don't include one; Nobiran and other human-passing
 * bloodlines use `classRegistry.raceCultures`.
 */
export function pickCulture(rand, demographics, race = null, cultureWhitelist = null) {
  const cultures = getTable("people", "cultures").list;
  // Nobiran are a human-passing bloodline of the empire — the book gives them
  // Auran names rather than a list of their own.
  if (race === "nobiran" && cultures.auran) return "auran";
  const matchesRace = (id) => {
    if (cultureWhitelist && !cultureWhitelist.includes(id)) return false;
    if (!race) return true;
    if (race === "human") return raceOfCulture(id) === "human";
    const raceCultures = optTable("people", "classRegistry")?.raceCultures?.[race];
    if (raceCultures) return raceCultures.includes(id);
    return raceOfCulture(id) === race;
  };
  const weighted = (demographics ?? []).filter((d) => d.culture in cultures && d.weight > 0 && matchesRace(d.culture));
  if (weighted.length) return pickWeighted(rand, weighted, (d) => d.weight).culture;
  const ids = Object.keys(cultures).filter(matchesRace);
  if (!ids.length) return Object.keys(cultures)[0];
  return ids[Math.floor(rand() * ids.length)];
}

/** Full name per the culture's naming customs (patronym or surname). */
export function generateName(rand, cultureId, gender) {
  const culture = getTable("people", "cultures").list[cultureId];
  if (!culture) return { given: "Nameless", full: "Nameless" };
  const pool = gender === "female" ? culture.female : culture.male;
  const given = pick(rand, pool);
  let full = given;
  if (culture.surnames?.length) {
    full = `${given} ${pick(rand, culture.surnames)}`;
  } else if (culture.patronym) {
    const pattern = gender === "female" ? culture.patronym.female : culture.patronym.male;
    let parent = pick(rand, culture.male); // patronyms derive from the father
    if (parent === given) parent = pick(rand, culture.male);
    const patronym = pattern.replace("{parent}", parent);
    if (patronym && patronym !== given) full = `${given} ${patronym}`;
  }
  return { given, full };
}

/**
 * One-line appearance from the culture's palette. Colours come from the
 * imported `people.cultureAppearance` blocks (the culture descriptions'
 * own hair/eye sentences); a culture entry may also carry them inline.
 * Whatever is present is used — a printing that states only hair still
 * yields a line, and no palette at all yields none.
 */
export function generateAppearance(rand, cultureId) {
  const culture = getTable("people", "cultures").list[cultureId] ?? {};
  const palette = optTable("people", "cultureAppearance")?.cultures?.[cultureId] ?? {};
  const hair = culture.hair?.length ? culture.hair : palette.hair;
  const eyes = culture.eyes?.length ? culture.eyes : palette.eyes;
  const skin = culture.skin?.length ? culture.skin : palette.skin;
  const parts = [];
  if (hair?.length) parts.push(`${pick(rand, hair)} hair`);
  if (eyes?.length) parts.push(`${pick(rand, eyes)} eyes`);
  if (skin?.length) parts.push(`${pick(rand, skin)} skin`);
  if (!parts.length) return "";
  return culture.build ? `${parts.join(", ")}; ${culture.build}` : parts.join(", ");
}

/**
 * Which JJ 248 age-trajectory column a class follows — interpretation, not
 * page data: the table's own labels are Fighter/(noble), Crusader
 * (proselytizer), Mage (researcher), Thief (carouser); classes map to the
 * trajectory whose adventuring life they lead. Magistrate/commoner columns
 * describe civilian careers, not adventuring classes.
 */
const AGE_CLASS_GROUPS = {
  crusader: ["crusader", "bladedancer", "priestess", "shaman", "paladin", "dwarven craftpriest", "witch"],
  mage: ["mage", "warlock", "nobiran wonderworker", "elven spellsword", "zaharan ruinguard"],
  thief: ["thief", "assassin", "bard", "elven nightblade", "venturer"],
  noble: ["fighter", "explorer", "barbarian", "dwarven vaultguard"],
};

function ageColumnFor(classKey) {
  const wanted = String(classKey ?? "").toLowerCase();
  for (const [column, classes] of Object.entries(AGE_CLASS_GROUPS)) {
    if (classes.some((c) => wanted.includes(c))) return column;
  }
  return "noble";
}

/**
 * Plausible age for a candidate of a level/class: the JJ minimum for the
 * class group plus small variance; 0th level = young adult. A column that
 * caps early ("44+") holds its cap value for higher levels. When the age
 * table has not been imported, every candidate is a young adult (18+).
 */
export function generateAge(rand, level, classKey) {
  const rows = optTable("people", "ageByClass")?.rows;
  if (!rows?.length) return 18 + Math.floor(rand() * 7);
  const column = ageColumnFor(classKey);
  const L = Math.max(0, Math.min(14, level ?? 0));
  let base = null;
  for (let l = L; l >= 0 && base == null; l--) base = rows.find((r) => r.level === l)?.[column] ?? null;
  const variance = Math.floor(rand() * 7); // +0..6 years past the minimum
  return (Number(base) || 18) + variance;
}

/**
 * 0th-level general proficiency COUNT by race and age (JJ 253). Races the
 * table does not column (thrassian…) count as human. Null until imported.
 */
export function profCountFor(race, age) {
  const rows = optTable("people", "proficienciesByAge")?.rows;
  if (!rows?.length || !age) return null;
  const col = rows.some((r) => Array.isArray(r[race])) ? race : "human";
  const row = rows.find((r) => Array.isArray(r[col]) && age >= r[col][0] && age <= r[col][1]);
  return row?.count ?? null;
}

/**
 * 0th-level NPC hit dice (JJ 252) for a race and station. Stations:
 * noncombatant | commoner | militia | fighter1. Races beyond the table's
 * three rows use the human line. Null until imported.
 */
export function hd0For(race, station = "commoner") {
  const rows = optTable("people", "hd0")?.rows;
  if (!rows?.length) return null;
  const row = rows.find((r) => r.race === race) ?? rows.find((r) => r.race === "human");
  return row?.[station] ?? null;
}

/**
 * 0th-level occupation. Humans roll the JJ 254-257 profession lists; races
 * with their own society table (occupations.byRace — dwarves roll CASTE per
 * the BTA ethnicity text) use it instead. A category with no entries (the
 * dwarven Oathsworn) means the occupation IS the sworn order — the class
 * trajectory carries it, and the caste label alone is recorded.
 */
/**
 * RAW occupation roll (JJ ~229): d100 on the General/Street occupant column,
 * route to that row's occupation sub-table, d100 there. Rows routed to an
 * NPC class (thief/fighter/crusader) reroll — the book's own rule when only
 * a civilian occupation is wanted. Returns null until both tables are
 * imported.
 */
function generateOccupationRaw(rand) {
  const types = optTable("people", "occupationTypes")?.rows;
  const subs = optTable("people", "occupationSubTables")?.categories;
  if (!types?.length || !subs) return null;
  const routeKey = (resolve) => {
    const t = String(resolve ?? "").toLowerCase();
    if (t.includes("mage") || t.includes("magician")) return "magician";
    for (const id of Object.keys(subs)) if (t.includes(id)) return id;
    return null;
  };
  // A row whose resolve column routes to an NPC CLASS (the book's own
  // reroll bands for civilian draws: 84-85, 92-93, 96-97, and the
  // uncovered 99-00) rerolls — the class trajectory rolls separately.
  const classRouted = (resolve) => /class/i.test(String(resolve ?? ""));
  for (let tries = 0; tries < 12; tries++) {
    const roll = Math.floor(rand() * 100) + 1;
    const row = types.find((r) => {
      const b = r.bands?.generalStreet;
      return b && roll >= (b.min ?? 1) && roll <= (b.max ?? b.min ?? 100);
    });
    if (!row) continue; // band uncovered by the street column → reroll
    if (classRouted(row.resolve)) continue;
    const cat = routeKey(row.resolve);
    const rows = cat ? subs[cat]?.rows : null;
    if (!rows?.length) {
      // No d100 sub-table exists for this civilian row (the printing's
      // hosteller: "inns are always owned by innkeepers") — the row's own
      // category IS the occupation.
      const label = String(row.type ?? "").replace(/([a-z])([A-Z])/g, "$1 $2");
      if (!label) continue;
      return { category: row.type, occupation: label.replace(/\b\w/g, (c) => c.toUpperCase()) };
    }
    const r2 = Math.floor(rand() * 100) + 1;
    const occ = rows.find((x) => r2 >= (x.min ?? 1) && r2 <= (x.max ?? x.min ?? 100));
    if (!occ?.occupation) continue;
    return { category: cat, occupation: occ.occupation };
  }
  return null;
}

/**
 * BTA caste roll for dwarven candidates: the book gives Highborn/Craftborn/
 * Workborn percentages in prose; the Oathsworn share is the remainder. The
 * caste IS the recorded occupation — Craftborn/Workborn trades and Oathsworn
 * orders are GM endpoints (the class trajectory carries an Oathsworn).
 */
function rollDwarvenCaste(rand, castes) {
  const order = castes.order ?? ["highborn", "craftborn", "workborn", "oathsworn"];
  const pcts = order.map((id) => castes[`${id}Pct`]);
  const known = pcts.filter((v) => typeof v === "number");
  if (!known.length) return null;
  const remainder = Math.max(0, 100 - known.reduce((a, b) => a + b, 0));
  let roll = rand() * 100;
  for (let i = 0; i < order.length; i++) {
    roll -= typeof pcts[i] === "number" ? pcts[i] : remainder;
    if (roll <= 0) return castes.labels?.[order[i]] ?? order[i];
  }
  return castes.labels?.[order[order.length - 1]] ?? order[order.length - 1];
}

export function generateOccupation(rand, race = "human") {
  if (race === "dwarf") {
    const castes = optTable("people", "dwarvenCastes");
    const caste = castes ? rollDwarvenCaste(rand, castes) : null;
    if (caste) return { category: "caste", occupation: caste };
  }
  // The RAW occupant system (street column + sub-tables) is the primary
  // path; the uniform package draw is the degraded fallback while those
  // tables are not imported. (The pre-purge `people.occupations` category
  // table is retired — orphaned by the content migration.)
  const raw = generateOccupationRaw(rand);
  if (raw) return raw;
  const packs = optTable("people", "occupationPackages");
  const keys = packs ? Object.keys(packs).filter((k) => !k.startsWith("_")) : [];
  if (!keys.length) return { category: "", occupation: "" };
  const k = keys[Math.floor(rand() * keys.length)];
  const label = packs._labels?.[k] ?? k;
  return { category: "", occupation: label.replace(/\b\w/g, (c) => c.toUpperCase()) };
}

/**
 * Generate a full identity for one candidate.
 * @param {object} o - { rand, demographics, level, classKey }
 *   For 0th level with no classKey: rolls occupation + class trajectory.
 * @returns {{name, gender, culture, cultureLabel, age, appearance,
 *            occupation, occupationCategory, classKey}}
 */
export function generateIdentity({ rand = Math.random, demographics = [], level = 0, classKey = "", station = "commoner" } = {}) {
  const cultures = getTable("people", "cultures").list;
  // GENERATION ORDER: class → culture → sex → name/age/appearance. The
  // class was rolled FIRST (bucket distribution, engine-side); here it
  // resolves downstream: culture follows the REGION distribution unless the
  // class registry restricts race/cultures (the restriction overrides the
  // region), and sex follows the registry's class restriction when present.
  // No class (specialists, mass labor) = unrestricted human.
  const resolvedClass = classKey || "";
  const culture = pickCulture(rand, demographics, resolvedClass ? raceForClass(resolvedClass) : "human", culturesForClass(resolvedClass));
  const gender = sexForClass(resolvedClass) ?? (rand() < 0.5 ? "male" : "female");
  const name = generateName(rand, culture, gender);
  let occupation = "";
  let occupationCategory = "";
  if ((level ?? 0) <= 0) {
    const occ = generateOccupation(rand, raceOfCulture(culture));
    occupation = occ.occupation;
    occupationCategory = occ.category;
  }
  const age = generateAge(rand, level ?? 0, resolvedClass);
  const race = raceOfCulture(culture);
  return {
    name: name.full,
    gender,
    culture,
    cultureLabel: cultures[culture]?.label ?? culture,
    age,
    appearance: generateAppearance(rand, culture),
    occupation,
    occupationCategory,
    classKey: resolvedClass,
    // 0th-level physicals (JJ 252-253); null until those tables import.
    profCount: (level ?? 0) <= 0 ? profCountFor(race, age) : null,
    hitDice: (level ?? 0) <= 0 ? hd0For(race, station) : null,
  };
}
