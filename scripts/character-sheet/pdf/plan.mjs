/**
 * What a filled official sheet SAYS, read into this module's terms before
 * anything is matched against the world: scores as numbers, proficiencies as
 * name / pick / rank, gear as place / count / name, a henchman as a record.
 * Foundry-free; `apply.mjs` matches the plan against the library and writes.
 *
 * Nothing here decides what is written. A box the module has no field for is
 * still read, so the import can put it in the character's notes.
 */
import { abilityEntry, clean, countAndName, diceText, lastNumber, listEntries, rows, splitOutside, throwValue, wholeNumber } from "./parse.mjs";

/** The six scores, by this module's (and the system's) keys. */
export const SCORE_KEYS = Object.freeze(["str", "int", "wis", "dex", "con", "cha"]);

/** The five saving throws, by the book's keys (`lib/actor-compat` maps them to the system's). */
export const SAVE_BOOK_KEYS = Object.freeze(["paralysis", "death", "blast", "implements", "spells"]);

/** The six movement boxes, by the system's `movementacks` keys. */
export const MOVE_KEYS = Object.freeze(["exploration", "combat", "chargerun", "expedition", "stealth", "climb"]);

/** The five adventuring throws, by the system's `adventuring` keys. */
export const ADVENTURING_KEYS = Object.freeze(["climb", "dungeonbashing", "listening", "searching", "trapbreaking"]);

/** Where gear sits on the sheet. Multi-line places list one thing a line; the rest are a single line. */
export const GEAR_PLACES = Object.freeze(["armor", "mainHand", "offHand", "head", "back", "belt", "worn", "backpack", "sack", "pouch", "hidden"]);
const MULTI_LINE_PLACES = new Set(["worn", "backpack", "sack"]);

/** Rows of the repeated tables. */
export const SHEET_ROWS = Object.freeze({ weapon: 7, classProf: 10, generalProf: 10, spellLevels: 6, spellsPerLevel: 8, rituals: 8, formulae: 8, henchmen: 6, ammo: 10, torch: 6, ticksPerRow: 4 });

/** The five coins the sheet has a box for. */
export const COIN_KEYS = Object.freeze(["pp", "ep", "gp", "sp", "cp"]);

const text = (values, key) => clean(values?.[key]);
const num = (values, key) => wholeNumber(values?.[key]);

/** Proficiency rows of one kind, merged by name and pick: a name written twice is rank two. */
function abilityRows(values, kind, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const entry = abilityEntry(values?.[`${kind}.${i}.name`]);
    if (!entry) continue;
    const throwText = text(values, `${kind}.${i}.throw`);
    const same = out.find((a) => a.name.toLowerCase() === entry.name.toLowerCase() && (a.selection ?? "").toLowerCase() === (entry.selection ?? "").toLowerCase());
    if (same) same.rank += entry.rank;
    else out.push({ ...entry, kind: kind === "classProf" ? "class" : "general", throw: throwValue(throwText), throwText });
  }
  return out;
}

/** A place's gear, one entry a line (multi-line places) or a comma list (the rest). */
function gearAt(values, place) {
  const list = text(values, `gear.${place}.list`);
  const lines = MULTI_LINE_PLACES.has(place) ? rows(list).flatMap((l) => splitOutside(l, /;/)) : splitOutside(list);
  return lines.map(countAndName).filter(Boolean).map((g) => ({ ...g, place }));
}

/** How many ticks each row of a tick grid carries. */
function tickCounts(values, grid, rowCount) {
  return Array.from({ length: rowCount }, (_, r) =>
    Array.from({ length: SHEET_ROWS.ticksPerRow }, (_, c) => values?.[`tick.${grid}.${r}.${c}`] === true).filter(Boolean).length,
  );
}

/** One henchman slot, or null when it is empty. */
function henchmanAt(values, slot) {
  const k = (field) => `hench.${slot}.${field}`;
  const name = text(values, k("name"));
  const anything = Object.keys(values ?? {}).some((key) => key.startsWith(`hench.${slot}.`) && String(values[key] ?? "").trim());
  if (!anything) return null;
  return {
    slot,
    name,
    className: text(values, k("class")),
    level: num(values, k("level")),
    xp: lastNumber(values?.[k("xp")]),
    alignment: text(values, k("alignment")),
    ac: num(values, k("ac")),
    hp: lastNumber(values?.[k("hp")]),
    hpText: text(values, k("hp")),
    scores: Object.fromEntries(SCORE_KEYS.map((s) => [s, num(values, k(`score.${s}`))])),
    scoreMods: Object.fromEntries(SCORE_KEYS.map((s) => [s, num(values, k(`scoreMod.${s}`))])),
    morale: num(values, k("morale")),
    loyalty: num(values, k("loyalty")),
    powers: listEntries(values?.[k("powers")]),
    equipment: rows(values?.[k("equipment")]).flatMap((l) => splitOutside(l, /[;,]/)).map(countAndName).filter(Boolean),
    // Read for notes only: the system keeps none of these for a henchman.
    rest: Object.fromEntries(
      ["speedA", "speedB", "encumbrance", "attackMelee", "attackMissile", "damageMelee", "damageMissile", "notes"].map((f) => [f, text(values, k(f))]),
    ),
  };
}

/**
 * The plan: everything the sheet says, in this module's terms.
 * @param {Record<string, string|boolean>} values key → what the box holds (`form.readForm`)
 */
export function buildPlan(values) {
  const v = values ?? {};
  const perDay = {};
  const known = [];
  for (let level = 1; level <= SHEET_ROWS.spellLevels; level++) {
    perDay[level] = num(v, `spells.perDay.${level}`);
    for (let r = 0; r < SHEET_ROWS.spellsPerLevel; r++) {
      const name = text(v, `spell.${level}.${r}`);
      if (name) known.push({ level, name });
    }
  }
  const listOf = (prefix, count) => Array.from({ length: count }, (_, i) => text(v, `${prefix}.${i}`)).filter(Boolean);
  const weapons = [];
  for (let i = 0; i < SHEET_ROWS.weapon; i++) {
    const w = (f) => text(v, `weapon.${i}.${f}`);
    if (!w("name")) continue;
    weapons.push({
      row: i,
      name: w("name"),
      init: wholeNumber(w("init")),
      attack: throwValue(w("attack")),
      attackText: w("attack"),
      damage: diceText(w("damage")),
      damageText: w("damage"),
      range: { short: wholeNumber(w("short")), medium: wholeNumber(w("medium")), long: wholeNumber(w("long")) },
    });
  }
  const domain = Object.fromEntries(Object.entries(v).filter(([k, val]) => k.startsWith("domain.") && (val === true || (typeof val === "string" && val.trim()))));
  return {
    name: text(v, "name"),
    className: text(v, "class"),
    title: text(v, "title"),
    alignment: text(v, "alignment"),
    age: num(v, "age"),
    ageText: text(v, "age"),
    unmodelled: { birthplace: text(v, "birthplace"), size: text(v, "size"), gender: text(v, "gender") },
    level: num(v, "level"),
    xp: lastNumber(v.xp),
    xpNext: num(v, "xpNext"),
    xpBonus: num(v, "xpBonus"),
    hitDie: diceText(v.hitDie),
    scores: Object.fromEntries(SCORE_KEYS.map((s) => [s, num(v, `score.${s}`)])),
    scoreMods: Object.fromEntries(SCORE_KEYS.map((s) => [s, num(v, `scoreMod.${s}`)])),
    hp: { value: lastNumber(v["hp.value"]), max: lastNumber(v["hp.max"]), valueText: text(v, "hp.value"), maxText: text(v, "hp.max") },
    saves: Object.fromEntries(SAVE_BOOK_KEYS.map((s) => [s, throwValue(v[`save.${s}`])])),
    saveMods: Object.fromEntries(SAVE_BOOK_KEYS.map((s) => [s, num(v, `saveMod.${s}`)])),
    attack: Object.fromEntries(Array.from({ length: 11 }, (_, n) => [n, throwValue(v[`attack.${n}`])])),
    ac: { shield: num(v, "ac.shield"), armour: num(v, "ac.armour"), naked: num(v, "ac.naked") },
    move: Object.fromEntries(MOVE_KEYS.map((m) => [m, num(v, `move.${m}`)])),
    initiative: num(v, "initiative"),
    surprise: num(v, "surprise"),
    avoidSurprise: num(v, "avoidSurprise"),
    encumbrance: lastNumber(v.encumbrance),
    healingRate: diceText(v.healingRate) ?? (text(v, "healingRate") || null),
    mortalWounds: num(v, "mortalWounds"),
    cleaves: num(v, "cleaves"),
    adventuring: Object.fromEntries(ADVENTURING_KEYS.map((a) => [a, throwValue(v[`adventuring.${a}`])])),
    weapons,
    abilities: [
      ...abilityRows(v, "classProf", SHEET_ROWS.classProf),
      ...abilityRows(v, "generalProf", SHEET_ROWS.generalProf),
      ...listEntries(v.features).map(abilityEntry).filter(Boolean).map((a) => ({ ...a, kind: "feature", throw: null, throwText: "" })),
    ],
    classProfGained: text(v, "classProfGained"),
    languages: listEntries(v.languages),
    coins: Object.fromEntries(
      COIN_KEYS.map((c) => {
        const t = text(v, `coin.${c}`);
        return [c, { count: lastNumber(t), text: t }];
      }),
    ),
    gems: text(v, "gems"),
    gear: GEAR_PLACES.flatMap((place) => gearAt(v, place)),
    spells: {
      perDay,
      known,
      rituals: listOf("ritual", SHEET_ROWS.rituals),
      formulae: listOf("formula", SHEET_ROWS.formulae),
      magic: { library: text(v, "magic.library"), workshop: text(v, "magic.workshop"), congregants: text(v, "magic.congregants"), research: text(v, "magic.research") },
    },
    ticks: { ammo: tickCounts(v, "ammo", SHEET_ROWS.ammo), torch: tickCounts(v, "torch", SHEET_ROWS.torch) },
    domain,
    henchmen: Array.from({ length: SHEET_ROWS.henchmen }, (_, s) => henchmanAt(v, s)).filter(Boolean),
  };
}
