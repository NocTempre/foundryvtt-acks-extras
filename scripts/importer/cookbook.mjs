/**
 * Cookbook runtime — the Foundry side of docs/importer/BINDING-FOUNDRY.md.
 *
 * Loads the shipped cookbook database (cookbook/registers.json +
 * cookbook/<book>.json), executes entries through the DUMB executor against
 * the seat's own connected book, and binds executor output to acks documents:
 *   - GM import dialog: pick monsters -> Actors (stats, weapons with
 *     damage type + extraordinary-from-printed-color, abilities, spoils, art);
 *   - prose: the entry's own paragraphs are written into the document at
 *     import, page reference last (scripts/prose.mjs), and the world holds
 *     them from then on.
 *
 * The cookbook is read-only data; all judgment happened in the offline
 * pipeline. This file only maps executor output onto acks system fields.
 */
import { MODULE_ID, LANG_PREFIX, ITEM_TYPE, DEFAULT_IMG } from "./constants.mjs";
import { bookText, entryText, escapeText, nodeParagraphs, stripBookText } from "./prose.mjs";
import { BOOKS, bookLine } from "./books.mjs";
import { OSE_PREFIX, oseSourceLabel, oseSourceLine } from "./ose-source.mjs";
import { executeEntry, materializeEffects, attackModel, convertName } from "./executor.mjs";
import { slugLabel } from "./table-extract.mjs";
import { pageItems } from "./extract.mjs";
import { WEAPON_TABLE, extractWeaponsFromDoc, bindWeaponRow, bindAmmoRow } from "./weapon-tables.mjs";
import { ARMOR_TABLE, extractArmorFromDoc, bindArmorRow } from "./armor-tables.mjs";
import { extractPriceMapFromDoc, extractPriceRowsFromDoc, priceFor, priceKey, PRICE_TABLES } from "./gear-prices.mjs";
import { savesForLevel } from "./stats.mjs";
import { progressBar } from "./progress.mjs";
import * as services from "../lib/services.mjs";
import { nameKeys, ABILITY_CATEGORIES } from "../lib/vocab.mjs";
import { materializeTemplates, TEMPLATE_PART } from "../classes/template-packages.mjs";
import { CLASS_TYPE, RACE_TYPE } from "../classes/constants.mjs";
import { VEHICLE_TYPE } from "../vehicles/constants.mjs";
import { VARIATION_ITEM_TYPE } from "../equipment/constants.mjs";
import { TRAP_ITEM_TYPE } from "../formation/constants.mjs";
import { equipmentClass } from "../equipment/profiles.mjs";
import { gearProfileFor } from "../equipment/config.mjs";
import { annotateItem } from "../equipment/api.mjs";
import { ANIMAL_TYPE, TEMPLATE_TYPE } from "../lib/constants.mjs";
import { acksExtras } from "../namespace.mjs";

const FOLDER_NAME = "ACKS Cookbook";
/**
 * Where imports from outside the ACKS library are shelved when their source
 * names no line of its own — the by-hand path, and a source the Judge
 * registered without saying what it is.
 */
const UNLINED_LINE = "Your Books";

/**
 * The SERIES a cookbook id's imports belong to, or null for the ACKS library.
 *
 * One pure function over the id, and that is the point: every write (`packFor`,
 * `ensureFolderPath`) and every presence check (`importedActor`,
 * `importedIdsOfType`) derives the destination from the same input, so a
 * document can never be filed on one shelf and looked for on another — which is
 * the twin-minting failure the claim rules already exist to prevent.
 *
 * A shipped book answers from `BOOKS`. A Judge-registered source answers from
 * its own world record, and an `ose.*` id that names no line still leaves the
 * ACKS shelves: it is another game's creature whatever its source forgot to say.
 */
export function lineOf(bookId) {
  if (!bookId) return null;
  const id = String(bookId);
  if (id === "ose" || id.startsWith(OSE_PREFIX)) return oseSourceLine(id) ?? UNLINED_LINE;
  return bookLine(id);
}

/**
 * The book a cookbook id belongs to: what the flag says, else the id's own
 * prefix. `dmb.group.bard` is dmb; `ose.milk.p7` is the source `ose.milk`,
 * because an `ose.*` id spends two segments naming its book.
 *
 * The registry decides which of the two an `ose.*` id is, rather than the
 * segment count: `ose.hand` — a block typed from nothing — is two segments and
 * names no book at all, and reading it as one would file those creatures under
 * a folder called after the id.
 */
export function bookOfCookbookId(id, book = null) {
  if (book) return String(book);
  const parts = String(id ?? "").split(".");
  if (!parts[0]) return null;
  if (parts[0] !== "ose") return parts[0];
  const source = parts.length > 1 ? `${parts[0]}.${parts[1]}` : "ose";
  return oseSourceLabel(source) ? source : "ose";
}

/** The line a document being created belongs to, read off the flag it carries. */
const lineOfData = (data) => {
  const flag = data?.flags?.[MODULE_ID]?.cookbook;
  if (!flag) return null;
  return lineOf(bookOfCookbookId(flag.id, flag.book));
};

/**
 * Shipped data, fetched once at ready. Two cookbook shapes:
 *  - `books`   per-book files (monsters) — the file names its book.
 *  - `content` CONTENT-TYPE files (proficiencies/powers/skills), each spanning
 *    every book that prints that content, so the BOOK is named per entry.
 */
const data = { registers: null, books: new Map(), content: new Map() };
/** Content-type cookbooks, named by WHAT they extract, not the source book. */
const CONTENT_FILES = ["proficiencies", "powers", "skills", "equipment"];
/** Injected module state (session docs + prose memory) — set by initCookbook. */
let ctx = null;
/** Name collisions already reported this session, so a bulk import says each once. */
const warnedAmbiguous = new Set();

export function initCookbook(moduleCtx) {
  ctx = moduleCtx;
}

export async function loadCookbook() {
  const base = `modules/${MODULE_ID}/cookbook`;
  try {
    data.registers = await foundry.utils.fetchJsonWithTimeout(`${base}/registers.json`);
  } catch {
    console.log(`${MODULE_ID} | no cookbook shipped (registers.json missing) — cookbook features disabled.`);
    return false;
  }
  // The compiler writes an index naming exactly the files it produced. Probing
  // for every book id instead would 404 for each book with no cookbook yet —
  // caught and harmless, but it fills the console with what look like errors.
  let index = null;
  try {
    index = await foundry.utils.fetchJsonWithTimeout(`${base}/index.json`);
  } catch {
    /* cookbook compiled before the index existed — fall back to probing */
  }
  const bookFiles = index?.books ?? Object.keys(BOOKS);
  const contentFiles = index?.content ?? CONTENT_FILES;
  for (const bookId of bookFiles) {
    try {
      const cb = await foundry.utils.fetchJsonWithTimeout(`${base}/${bookId}.json`);
      if (cb?.entries) data.books.set(bookId, cb);
    } catch {
      /* book without a cookbook yet */
    }
  }
  for (const name of contentFiles) {
    try {
      const cb = await foundry.utils.fetchJsonWithTimeout(`${base}/${name}.json`);
      if (cb?.entries) data.content.set(name, cb);
    } catch {
      /* this content type isn't compiled yet */
    }
  }
  const n = [...data.books.values()].reduce((s, cb) => s + Object.keys(cb.entries).length, 0);
  const c = [...data.content.values()].reduce((s, cb) => s + Object.keys(cb.entries).length, 0);
  console.log(
    `${MODULE_ID} | cookbook loaded: ${n} entr(ies) across ${data.books.size} book(s)` +
      `${c ? `, ${c} definition(s) across ${data.content.size} content type(s)` : ""}.`,
  );
  return n + c > 0;
}

/**
 * Accessors for consumers outside this module. The OSE path needs the compiled
 * `constants` file, the shared registers, and whichever book documents this
 * seat has open — all of which live here and nowhere else.
 */
export const cookbookContentFile = (name) => data.content.get(name) ?? null;
export const cookbookRegisters = () => data.registers;
export const cookbookSessionDoc = (bookId) => ctx?.sessionDocs?.get(bookId)?.doc ?? null;
export const cookbookBookFile = (bookId) => data.books.get(bookId) ?? null;
/** The seat-side art importer, injected by the module. Null outside Foundry. */
export const cookbookArtImporter = () => ctx?.importArtForPage ?? null;

/** "mm.griffon#combat" -> { id, section } (section null when absent). */
const splitId = (full) => {
  const [id, section] = String(full ?? "").split("#");
  return { id, section: section || null };
};

export const cookbookEntry = (fullId) => {
  const { id } = splitId(fullId);
  for (const cb of data.books.values()) if (cb.entries[id]) return { cb, entry: cb.entries[id], id };
  for (const cb of data.content.values()) if (cb.entries[id]) return { cb, entry: cb.entries[id], id };
  // A FAMILY id resolves to a synthesized entry so every consumer (folders,
  // dialogs, importMany's book resolution) treats it like any other entry.
  for (const cb of data.books.values()) {
    const fam = cb.families?.[id];
    if (fam) {
      return {
        cb,
        id,
        entry: { kind: "kind.monsterFamily", name: fam.name, cite: fam.cite, pages: fam.pages, family: fam },
      };
    }
  }
  return null;
};

/**
 * Which book an entry is read from. Per-book cookbooks name it on the file;
 * content-type cookbooks span books, so the entry names its own.
 */
const bookOf = (found) => found?.cb?.book?.id ?? found?.entry?.book ?? null;
/**
 * How many shipped entries this book unlocks.
 *
 * Both shapes count. Per-book cookbooks (monsters) are keyed by the book;
 * content-type cookbooks span books and name it per entry, so counting only
 * the first reported 0 for the Revised Rulebook while 120 proficiencies sat in
 * proficiencies.json waiting on exactly that book.
 */
export const cookbookCount = (bookId) => {
  let n = Object.keys(data.books.get(bookId)?.entries ?? {}).length;
  for (const cb of data.content.values()) {
    for (const e of Object.values(cb.entries)) if (e.book === bookId) n++;
  }
  return n;
};

/* -------------------------------------------- */
/*  Binding: executor output -> acks Actor      */
/* -------------------------------------------- */

const firstInt = (v) => {
  const m = /(-?[\d,]+)/.exec(String(v ?? ""));
  return m ? parseInt(m[1].replace(/,/g, ""), 10) : null;
};
const diceOf = (v) => /\d+d\d+(?:[+-]\d+)?/.exec(String(v ?? ""))?.[0] ?? "";
const capitalize = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/* -------------------------------------------- */
/*  Full Monster Sheet extras (acks-monsters)   */
/* -------------------------------------------- */

const SAVE_CLASS_BY_ABBR = { F: "fighter", C: "crusader", M: "mage", T: "thief", D: "dwarvenVaultguard", E: "elvenSpellsword" };
const AGE_KEYS = ["baby", "juvenile", "adolescent", "adult", "middleAged", "old", "ancient", "maximum"];
const TRAINED_ROLE_MAP = {
  "war mount": "warMount", "work beast": "workbeast", workbeast: "workbeast", guard: "guard",
  mount: "mount", hunter: "hunter", herald: "herald",
};
const DAMAGE_WORDS = {
  acid: "acidic", acidic: "acidic", arcane: "arcane", bludgeoning: "bludgeoning", cold: "cold",
  electrical: "electrical", electricity: "electrical", lightning: "electrical", fire: "fire",
  luminous: "luminous", necrotic: "necrotic", piercing: "piercing", poison: "poisonous",
  poisonous: "poisonous", seismic: "seismic", slashing: "slashing",
};

/** "Wandering noun (2d4) / Lair noun (2d6)" -> encounter side object. */
function encSide(value) {
  if (!value || /^none/i.test(String(value))) return null;
  const parse = (part) => {
    const m = /^([^(]+?)\s*\((\d+d\d+(?:[+-]\d+)?)\)/.exec((part ?? "").trim());
    return m ? { noun: m[1].trim(), number: m[2] } : null;
  };
  const parts = String(value).split("/");
  const wandering = parse(parts[0]);
  const lair = parse(parts[1] ?? parts[0]);
  if (!wandering && !lair) return null;
  return { wandering: wandering ?? { noun: "", number: "" }, lair: lair ?? { noun: "", number: "" } };
}

/**
 * Map executor output onto the Full Monster Sheet's extras schema
 * (Classification / Rating & Saves / Vision / Movement / Ecology / Defenses).
 * Pure data mapping — exported so the dev harness can test it without Foundry.
 */
export function buildExtras(node) {
  const s = node.fields.stats ?? {};
  const raw = (k) => s[`_raw.${k}`];
  const extras = {};

  /* --- classification --- */
  if (s.type) extras.types = s.type.keys ?? (s.type.key ? [s.type.key] : []);
  const sub = s.type?.paren?.[0];
  if (sub) extras.subtype = sub.key ?? sub.text;
  if (s.size?.key) extras.size = s.size.key;
  const massText = s.size?.paren?.map((p) => p.text).join(",") ?? "";
  const stone = firstInt(massText);
  if (stone != null && /st/.test(massText)) extras.mass = { stone, lbs: stone * 10 };

  /* --- rating & saves --- */
  const hdm = /^(\d+)(?:\s*([+-])\s*(\d+))?\s*(\**)/.exec(String(s.hitDice ?? "").trim());
  if (hdm) {
    extras.hd = {
      count: parseInt(hdm[1], 10),
      bonus: hdm[2] ? (hdm[2] === "-" ? -1 : 1) * parseInt(hdm[3], 10) : null,
      asterisks: hdm[4]?.length || null,
      dieType: 8,
    };
  }
  const sv = /^([A-Z]+)\s*(\d+)?/.exec(String(s.save ?? "").trim());
  if (sv) extras.saveAs = { class: SAVE_CLASS_BY_ABBR[sv[1]] ?? "fighter", level: sv[1] === "NH" ? 0 : parseInt(sv[2] ?? "0", 10) || 0 };
  if (s.normalLoad != null || s.maxLoad != null) {
    extras.load = { ...(s.normalLoad != null ? { normal: s.normalLoad } : {}), ...(s.maxLoad != null ? { capacity: s.maxLoad } : {}) };
  }

  /* --- vision & senses --- */
  const vis = String(s.vision ?? "").toLowerCase();
  if (vis) {
    extras.vision = ["standard", "night", "lightless", "acute", "blind"].filter((k) => vis.includes(k));
    const range = /lightless[^(]*\((\d+)/.exec(vis);
    if (range) extras.lightlessRange = parseInt(range[1], 10);
  }
  if (s.otherSenses && !/^standard$/i.test(s.otherSenses)) extras.otherSenses = s.otherSenses;

  /* --- movement --- */
  const speeds = [];
  for (const [k, v] of Object.entries(s)) {
    const m = /^speed([A-Z][a-z]+)$/.exec(k);
    if (!m || !v) continue;
    const nums = [...String(v).matchAll(/(\d+)/g)].map((n) => parseInt(n[1], 10));
    if (!nums.length) continue;
    speeds.push({ type: m[1].toLowerCase(), combat: nums[0] ?? null, run: nums[1] ?? nums[0] ?? null, hover: false });
  }
  if (speeds.length) extras.speeds = speeds;

  /* --- encounter --- */
  const d = encSide(s.dungeonEnc);
  const w = encSide(s.wildernessEnc);
  if (d || w || s.lairChance != null) {
    extras.encounter = {
      ...(d ? { dungeon: d } : {}),
      ...(w ? { wilderness: w } : {}),
      ...(s.lairChance != null ? { lairChance: s.lairChance } : {}),
    };
  }

  /* --- ecology (secondary) --- */
  const secondary = {};
  const exp = firstInt(raw("expeditionSpeed"));
  if (exp != null) secondary.expeditionSpeed = exp;
  const supply = raw("supplyCost");
  if (supply && !/^none/i.test(supply)) secondary.supplyCost = firstInt(supply) ?? supply;
  const tp = raw("trainingPeriod");
  if (tp && !/untrainable/i.test(tp)) secondary.trainingMonths = firstInt(tp);
  const tm = raw("trainingModifier");
  if (tm && !/untrainable/i.test(tm)) secondary.trainingModifier = firstInt(tm);
  const br = raw("battleRating");
  if (br) {
    const ind = /([\d.]+)\s*\(individual\)/i.exec(br);
    const unit = /([\d.]+)\s*\(unit\)/i.exec(br);
    const single = /^([\d.]+)\s*$/.exec(String(br).trim());
    if (ind || unit || single) {
      secondary.battleRating = {
        ...(ind || single ? { individual: parseFloat((ind ?? single)[1]) } : {}),
        ...(unit ? { unit: parseFloat(unit[1]) } : {}),
      };
    }
  }
  const life = raw("lifespan");
  if (life && /\d+\s*\/\s*\d+/.test(life)) {
    const vals = life.split("/").map((v) => firstInt(v));
    const lifespan = {};
    AGE_KEYS.forEach((k, i) => {
      if (vals[i] != null) lifespan[k] = vals[i];
    });
    secondary.lifespan = lifespan;
  }
  const rep = raw("reproduction");
  if (rep && !/^none/i.test(rep)) {
    const count = diceOf(rep) || (firstInt(rep) != null ? String(firstInt(rep)) : "");
    let yt = "";
    if (/egg|hatchling|clutch/i.test(rep)) {
      yt = "egg";
      secondary.oviparous = true;
    } else if (/litter/i.test(rep)) yt = "litter";
    else if (/spawn/i.test(rep)) yt = "spawn";
    else if (/foal|calf|pup|kit|cub|whelp|infant|joey|kid|lamb|piglet|fawn|live/i.test(rep)) yt = "live";
    else if (/juvenile/i.test(rep)) yt = "juvenile";
    secondary.reproduction = { ...(count ? { count } : {}), ...(yt ? { youngType: yt } : {}) };
    const iv = /every\s+(\d+)?\s*(year|month|week|day)/i.exec(rep);
    if (iv) {
      secondary.reproduction.interval = iv[1] ? parseInt(iv[1], 10) : 1;
      secondary.reproduction.intervalUnit = iv[2].toLowerCase();
    }
  }
  const uv = raw("untrainedValue");
  if (uv && !/^none/i.test(uv)) {
    // Schema: adult/juvenile/baby are NUMBERS (gp), keyed by the (A)/(J)/(B|e) marker.
    const bucketNum = (marker) => {
      const m = new RegExp(`([\\d,]+)\\s*gp\\s*\\((?:${marker})\\)`, "i").exec(uv);
      return m ? parseInt(m[1].replace(/,/g, ""), 10) : undefined;
    };
    const adult = bucketNum("A");
    const juvenile = bucketNum("J");
    const baby = bucketNum("B|e|egg");
    if (adult != null || juvenile != null || baby != null) {
      secondary.untrainedValue = {
        ...(adult != null ? { adult } : {}),
        ...(juvenile != null ? { juvenile } : {}),
        ...(baby != null ? { baby } : {}),
      };
    }
  }
  const tv = raw("trainedValue");
  if (tv && !/^none/i.test(tv)) {
    // Schema: array of { role (enum), value (gp num), note }. "315gp (war
    // mount) 40gp (work beast)" -> two rows; unknown roles -> other + note.
    const list = [];
    for (const m of tv.matchAll(/([\d,]+)\s*gp\s*(?:\(([^)]+)\))?/g)) {
      const label = (m[2] ?? "").trim();
      const role = TRAINED_ROLE_MAP[label.toLowerCase()] ?? "other";
      list.push({ role, value: parseInt(m[1].replace(/,/g, ""), 10), ...(role === "other" && label ? { note: label } : {}) });
    }
    if (list.length) secondary.trainedValue = list;
  }
  if (Object.keys(secondary).length) extras.secondary = secondary;

  /* --- defenses (materialized by the executor from this seat's prose) --- */
  if (node.fields.defenses) {
    const packSide = (b) =>
      b ? { damage: b.damage ?? [], effects: (b.effects ?? []).join(", "), mundane: !!b.mundane, extraordinary: !!b.extraordinary } : undefined;
    const def = {};
    for (const side of ["immunities", "resistances", "susceptibilities"]) {
      const p = packSide(node.fields.defenses[side]);
      if (p) def[side] = p;
    }
    if (Object.keys(def).length) extras.defenses = def;
  }

  /* --- spellcasting (formulaic prose) --- */
  const paras = node.fields.description ?? [];
  const castM = /casts? spells(?: and uses magic items)? as (?:an? )?(\d+)(?:st|nd|rd|th)?[- ]level (\w+)/i.exec(
    paras.map((p) => p.text).join(" "),
  );
  if (castM) extras.spellcasting = { class: capitalize(castM[2]), level: parseInt(castM[1], 10) };

  return extras;
}

/**
 * Size key -> prototype token footprint in grid squares.
 *
 * The book gives each size class a FRONTAGE in 5' squares, and acks-monsters
 * already publishes the whole size table (scripts/config.mjs SIZES) — so this
 * is the same posture as SAVES_LUT in stats.mjs: derived game math already
 * published by a sibling, not new disclosure. Kept local rather than imported
 * because a seat may not have acks-monsters installed.
 *
 * Two deliberate readings, because frontage and footprint are not the same
 * question. "1 sq or less" and "2/3 sq" both describe how many creatures fit
 * in a line, not a sub-square token, so Small and Man-Sized are both 1×1 — a
 * half-square token would be a presentation choice the book never asked for.
 * `largeHugeGigantic` is absent on purpose: that register key exists because
 * the page gives a RANGE, and picking one for the GM would be inventing.
 */
const TOKEN_SIZE = {
  small: { width: 1, height: 1 },
  man: { width: 1, height: 1 },
  large: { width: 2, height: 1 },
  huge: { width: 2, height: 2 },
  gigantic: { width: 4, height: 3 },
  colossal: { width: 8, height: 6 },
};

/**
 * Map the SCALAR stat fields to system paths — the shared half of the binding,
 * used whole-block by bindMonster and per-grid-row by the template importer
 * (one mapping owner; a template row is just a partial stat block).
 */
export function bindStatsScalars(s) {
  const system = {};

  if (Number.isInteger(s.armorClass)) system.aac = { value: s.armorClass };

  const hdm = /^(\d+)(?:\s*([+-])\s*(\d+))?/.exec(String(s.hitDice ?? "").trim());
  if (hdm) {
    const count = parseInt(hdm[1], 10);
    const bonus = hdm[2] ? (hdm[2] === "-" ? -1 : 1) * parseInt(hdm[3], 10) : 0;
    const avg = Math.max(1, Math.floor(count * 4.5 + bonus));
    system.hp = { hd: `${count}d8${bonus ? (bonus > 0 ? `+${bonus}` : bonus) : ""}`, value: avg, max: avg };
  }

  const sv = /^([A-Z]+)\s*(\d+)?/.exec(String(s.save ?? "").trim());
  if (sv) {
    const level = sv[1] === "NH" ? 0 : parseInt(sv[2] ?? "0", 10) || 0;
    const row = savesForLevel(level);
    system.saves = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { value: v }]));
    system.saves.breath = { value: row.blast };
    system.saves.wand = { value: row.implements };
  }

  // "N/A" morale (mindless undead) is not 0 (=always flees): leave it unset and
  // flag it, rather than writing a misleading number.
  const moraleNA = s.morale === "N/A";
  system.details = {
    ...(typeof s.morale === "number" ? { morale: s.morale } : {}),
    ...(s.xp != null && s.xp !== "N/A" ? { xp: s.xp } : {}),
    ...(s.alignment ? { alignment: capitalize(s.alignment.key ?? s.alignment.text ?? "") } : {}),
    ...(s.treasureType ? { treasure: { type: /^none/i.test(s.treasureType) ? "None" : s.treasureType } } : {}),
  };
  if (s.dungeonEnc || s.wildernessEnc) {
    system.details.appearing = { d: diceOf(s.dungeonEnc), w: diceOf(s.wildernessEnc) };
  }

  const speed = String(s.speedLand ?? "");
  const nums = [...speed.matchAll(/(\d+)/g)].map((m) => parseInt(m[1], 10));
  if (nums.length) system.movement = { base: nums[nums.length - 1] };

  return { system, moraleNA };
}

/** Map one executed node to acks actor data + embedded items. */
export function bindMonster(node) {
  const f = node.fields;
  const s = f.stats ?? {};
  const { system, moraleNA } = bindStatsScalars(s);

  const atk = f.attacks;
  if (atk) {
    if (atk.throw != null) system.thac0 = { throw: atk.throw };
    if (atk.text) system.attacks = atk.text;
  }

  // Each attack MODE is an OR-alternative (weapon OR claws+bite). Build a
  // weapon item per segment; only mode 0 is equipped by default, later modes
  // are tagged so the GM can swap. Duplicate names within a mode get a #suffix.
  const items = [];
  for (const [mi, mode] of (atk?.modes ?? []).entries()) {
    const seen = {};
    for (const seg of mode.segments) {
      const base = seg.name ?? "Attack";
      seen[base] = (seen[base] ?? 0) + 1;
      items.push({
        name: seen[base] > 1 ? `${base} ${seen[base]}` : base,
        type: "weapon",
        img: DEFAULT_IMG.ATTACK,
        flags: {
          [MODULE_ID]: {
            ...(seg.naturalWeapon ? { naturalWeapon: seg.naturalWeapon } : {}),
            ...(seg.damageType?.key ? { damageType: seg.damageType.key } : {}),
            extraordinary: seg.quality === "extraordinary",
            ...(mi > 0 ? { attackMode: mi } : {}),
          },
        },
        system: {
          description: "", damage: seg.damage, bonus: 0, melee: true, missile: false, equipped: mi === 0,
          pattern: "transparent", tags: [], counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
        },
      });
    }
  }
  // Stat-block proficiency tokens resolve in three tiers — reuse what the world
  // already has, else build it from the cookbook, else mint a namesake. Both
  // indexes are built once per monster and only when there is a token to spend
  // them on (most monsters print none).
  const profs = (f.stats?.proficiencies ?? []).filter((p) => p.text && !/^none/i.test(p.text));
  const nameIndex = profs.length ? abilityNameIndex() : null;
  const loadedById = profs.length ? loadedAbilityIndex() : new Map();
  const present = new Set(loadedById.keys());
  for (const prof of profs) {
    // When the stat block named it by an older name, the EMBEDDED copy records
    // the rename (not the shared world item — that would stamp one source's
    // history onto everyone's). The sheet then explains why the name on the
    // page and the name in the book differ.
    const renamed = prof.convertedFrom ? { conversionStatus: "renamed", conversionFrom: prof.convertedFrom } : {};

    // WHICH definition this is. An authored registry `ref` is a decision someone
    // made and wins outright; without one the printed name is only a guess, so
    // it is resolved against the ids this world actually holds before category
    // preference applies. 14 names ("Alertness", "Climbing") are both a
    // proficiency and a class power, and a world that imported one list and not
    // the other has already answered which was meant.
    const guess = prof.ref ? null : idForName(nameIndex, prof.text, present);
    const id = prof.ref ?? guess?.id ?? null;
    // A guess is reported, but ONCE per distinct resolution: a bulk import walks
    // hundreds of blocks and the same handful of shared names ("climbing") would
    // otherwise bury the console in the same line.
    if (guess?.ambiguous && !warnedAmbiguous.has(`${prof.text}>${id}`)) {
      warnedAmbiguous.add(`${prof.text}>${id}`);
      console.warn(`${MODULE_ID} | "${prof.text}" matches several definitions; adopted ${id}.`);
    }

    // The block prints THIS creature's own throw target ("climbing 6+"), split
    // off by the refList's stripRoll. It outranks the definition's generic
    // ladder — which bindAbility can only resolve at 1st level, having no actor
    // to read — and it is materialized from the seat's own page like every other
    // value. Until now nothing consumed it, which was invisible while the tiers
    // below effectively never fired.
    const withTarget = (item) =>
      prof.target == null
        ? item
        : {
            ...item,
            system: {
              ...item.system,
              roll: item.system?.roll || "1d20",
              rollType: item.system?.rollType || "above",
              rollTarget: prof.target,
            },
          };

    // 1. ALREADY LOADED — copy the item the world holds. Worth preferring over a
    //    fresh bind: this path has no executed node for the ability, so building
    //    from the cookbook yields structure only, while an item imported with
    //    the book open already materialized its throws and effects. It also
    //    inherits whatever the GM tuned.
    const loaded = id ? loadedById.get(id) : null;
    if (loaded) {
      const src = loaded.toObject();
      // Identity and filing belong to the world item, not to this copy of it.
      delete src._id;
      delete src.folder;
      delete src.sort;
      if (prof.convertedFrom) {
        const abil = ((src.flags ??= {})[MODULE_ID] ??= {});
        abil.extras = { ...(abil.extras ?? {}), ...renamed };
      }
      items.push(withTarget(src));
      continue;
    }

    // 2. COULD BE LOADED — the cookbook carries the definition, so embed THAT
    //    ability (descriptor, classification, shared cookbook id) rather
    //    than a bare namesake.
    const shared = id ? cookbookEntry(id) : null;
    if (shared) {
      items.push(withTarget(bindAbility(shared.entry, null, id, renamed)));
      continue;
    }

    // 3. Nothing to point at — degrade to a plain named ability, never a failure.
    items.push(withTarget({
      name: prof.text,
      type: "ability",
      img: DEFAULT_IMG.ABILITY,
      system: {
        description: "", proficiencytype: "general", favorite: false, pattern: "white",
        requirements: "", roll: "", rollType: "above", rollTarget: 0, blindroll: false, save: "",
      },
    }));
  }
  for (const sp of f.spoils ?? []) {
    items.push({
      name: capitalize(sp.name),
      type: "item",
      img: DEFAULT_IMG.ITEM,
      system: { description: "", subtype: "item", quantity: { value: 1, max: 0 }, cost: sp.cost, weight: 0, weight6: sp.weight6 },
      flags: { [MODULE_ID]: { spoil: true, component: true, researchEffects: sp.effects.map((e) => e.text) } },
    });
  }

  // A Gigantic monster on a 1×1 token is wrong before anyone reads a stat, and
  // the size is right there in the block. Only set what the table actually
  // says: an unrecognised or ranged size leaves Foundry's default alone.
  const token = TOKEN_SIZE[s.size?.key];

  return {
    system,
    items,
    ...(token ? { prototypeToken: token } : {}),
    flags: moraleNA ? { [MODULE_ID]: { moraleNA: true } } : {},
  };
}

/* -------------------------------------------- */
/*  GM import dialog                            */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Import target folders (one tree per type)   */
/* -------------------------------------------- */

/**
 * Every import lands in a tree, not a heap:
 *
 *   <book label>                e.g. "AX2 Secrets of the Nethercity"
 *     └── <entry meta.group>    e.g. "New Monsters", "Old District — …"
 *
 * Each document type gets its own pack, so the PACK is the container and a
 * folder named for the module inside it would only repeat its own label.
 * Entries without a group sit in the book folder; content-type items
 * (abilities, equipment) use their own top level instead of a book. Resolved
 * folders are cached for the session AND pre-created before any concurrent
 * import starts, so parallel workers cannot race two folders of the same name
 * into existence.
 *
 * TWO LEVELS, never three. Foundry's folder ownership dialog writes only
 * `folder.contents` — the direct children — so depth is what decides how many
 * times a Judge has to open it; and a pack caps folders one level shallower
 * than the world does. `ensureFolderPath` refuses a deeper path outright
 * rather than letting one grow back a level at a time.
 */
const FOLDER_MAX_DEPTH = 2;
const folderCache = new Map();

/* -------------------------------------------- */
/*  Import target: world documents or compendium */
/* -------------------------------------------- */

/**
 * Imports land in WORLD COMPENDIUMS, one per document type, created on first
 * use and cached by type. Documents are written there directly — `createDoc`
 * passes `{pack}` at creation and `ensureFolderPath` builds the tree inside
 * the pack — so nothing is ever staged in the sidebar and swept up afterwards.
 *
 * A pack is the unit a Judge can hand to players in ONE gesture: pack
 * ownership is a single role-keyed setting, where document ownership has to be
 * applied folder by folder (Foundry's dialog writes only a folder's direct
 * contents, so a library of thousands cost a hundred dialogs and still missed
 * every document a level down). That is the whole reason imports go here.
 *
 * World packs are unlocked by default, so an imported document stays editable
 * and draggable exactly as a sidebar one was.
 */
const packCache = new Map();

/**
 * The visible name of a pack — what every "imported into…" message names, and
 * what `cookbookRemoveImports` recognises its own packs by.
 *
 * Every label keeps the `FOLDER_NAME` prefix whatever line it holds, for two
 * reasons: the sidebar sorts packs by label, so the library stays one block
 * rather than scattering through the world's other compendia; and removal finds
 * this module's packs by that prefix alone, so a line added by a later release
 * is swept up by a Remove Imports that has never heard of it.
 */
const packLabel = (type, line = null) => (line ? `${FOLDER_NAME} — ${line} — ${type}` : `${FOLDER_NAME} — ${type}`);

/**
 * Every world pack of a type this module owns, whatever line it holds.
 *
 * The read counterpart of `packFor`: a write goes to ONE shelf, but "have I
 * imported this already?" has to ask them all — a batch mixes ids from several
 * lines, and a check that asked only the ACKS shelf would call every Dolmenwood
 * creature new on every run.
 */
const ourPacksOfType = (type) =>
  game.packs.filter(
    (p) =>
      p.metadata.packageType === "world" &&
      p.documentName === type &&
      String(p.metadata.label ?? "").startsWith(`${FOLDER_NAME} — `),
  );

/**
 * The sidebar documents this module stamped — the other half of the library in
 * any world old enough to have imported before imports went to compendia.
 *
 * A write lands on a pack today, so the sidebar is not where the library grows;
 * it is where a sidebar-era release's imports are still sitting. A read that
 * asks the packs alone calls every one of them missing, and the whole library
 * follows from that: the next run mints a twin into the pack, so a world holds
 * each class, proficiency and price twice; the rebuild controls empty the pack
 * and leave the sidebar copy behind; Update passes over it. The actor side has
 * always read world-then-pack — `importedIdsOfType`, `importedActor` — and this
 * is the item side saying the same thing.
 *
 * Ours is the cookbook flag, which is also what `cookbookRemoveImports` sweeps
 * by: a hand-made document carries none and is never counted. NEVER the class
 * templates' skinned copies — a skin inherits the definition's cookbook id and
 * would answer for the document it was made from.
 */
const sidebarImports = (type) => {
  const world = { Actor: game.actors, Item: game.items, JournalEntry: game.journal, RollTable: game.tables }[type];
  return [...(world ?? [])].filter(
    (d) => d.getFlag(MODULE_ID, "cookbook") && !d.flags?.[MODULE_ID]?.templatePart,
  );
};

/**
 * The pack collection id imports of this type and line go to, or null if it
 * cannot be opened. A null line is the ACKS library's own pack.
 *
 * The cached answer is CONFIRMED against `game.packs` before it is handed out.
 * A pack can go away under a running session — a GM deletes it from the
 * sidebar, or another seat runs Remove Imports — and a cached id for a pack
 * that no longer exists makes every `createDoc` fail silently: the write names
 * a target the server has never heard of, and the import reports nothing made
 * with nothing in the log. Re-resolving simply creates the pack again.
 */
async function packFor(type, line = null) {
  const cacheKey = `${type}|${line ?? ""}`;
  let pending = packCache.get(cacheKey);
  if (pending) {
    const id = await pending;
    if (id && !game.packs.get(id)) {
      packCache.delete(cacheKey);
      forgetImportedIndex(); // its documents went with the pack
      // And its FOLDERS. A recreated pack takes the same collection id (Foundry
      // derives it from the label), so the folder cache's keys still match and
      // would hand back folder documents that went down with the old one.
      for (const key of [...folderCache.keys()]) if (key.startsWith(`${type}|`)) folderCache.delete(key);
      pending = null;
    }
  }
  if (!pending) {
    pending = (async () => {
      const label = packLabel(type, line);
      const found = game.packs.find(
        (p) => p.metadata.packageType === "world" && p.documentName === type && p.metadata.label === label,
      );
      if (found) return found.collection;
      const CC = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
      const made = await CC.createCompendium({ label, type });
      return made.collection;
    })().catch((err) => {
      // The sidebar is the only place left to put it. Say so loudly: a silent
      // fall-back to the world is how a library ends up split across two
      // targets, which is what every dedup check then has to guess about.
      console.error(`${MODULE_ID} | could not open the ${type} compendium — those documents land in the sidebar.`, err);
      ui.notifications?.error(game.i18n.format(`${LANG_PREFIX}.ui.packFailed`, { type }));
      return null;
    });
    packCache.set(cacheKey, pending);
  }
  return pending;
}

/**
 * `{pack}` option for document creation, or `{}` if the pack could not be
 * opened. Exported because a bulk `createDocuments`/`updateDocuments`/
 * `deleteDocuments` cannot go through `createDoc` and still needs the target.
 */
export const packOptsFor = async (type, line = null) => packOpts(type, line);

/** `{pack}` option for document creation, or `{}` if the pack could not be opened. */
const packOpts = async (type, line = null) => {
  const pack = await packFor(type, line);
  return pack ? { pack } : {};
};

/**
 * Create a document in this type's compendium, on its own line's shelf.
 *
 * The line is read off the document's OWN cookbook flag rather than passed in.
 * Twenty-odd importers create documents and every one of them already stamps
 * that flag, so deriving the destination from it means no importer can be
 * updated and forgotten — and it is the same input every presence check reads,
 * which is what keeps a document from being filed on one shelf and looked for
 * on another. `opts.line` answers only for a document with no flag to read.
 *
 * Exported because every import path has to write to the same target; a second
 * creator calling `Actor.create` directly puts half the library in the sidebar,
 * where the presence checks do not look and the pack's ownership does not reach.
 */
export const createDoc = async (cls, data, { line = null, ...opts } = {}) =>
  remembered(await cls.create(data, { ...opts, ...(await packOpts(cls.documentName, lineOfData(data) ?? line)) }));

/**
 * Teach the dedup index about a document the moment it exists.
 *
 * The index is built once per session, and only `claimImport` used to update
 * it — so anything created through `createDoc` alone was invisible to the next
 * presence check IN THE SAME SESSION, and running that importer twice made a
 * twin. Race items did exactly that: two `def.race.dwarf`, two `def.race.elf`,
 * every time the class-builder tables were imported a second time.
 *
 * Keyed off the document's own cookbook flag rather than a caller-supplied id,
 * so no creator can forget. Items only: the index is an Item index.
 */
function remembered(doc) {
  if (doc?.documentName !== "Item") return doc;
  const id = doc.getFlag(MODULE_ID, "cookbook")?.id;
  if (id) rememberImported(id, doc);
  return rememberName(doc);
}

/**
 * Create MANY documents in one write, and the reason every bulk import must.
 *
 * A write costs one round trip whose price is set by HOW MANY DOCUMENTS THE
 * TARGET ALREADY HOLDS, not by the payload — each call re-indexes the
 * collection. Measured against this world: a create into a 19-document pack
 * takes ~35ms; the same create into a 1,039-document pack takes ~950ms. So a
 * loop that writes one document at a time is quadratic in the size of what it
 * is building, and visibly slows as it goes.
 *
 * Batching collapses N re-indexes into one. Measured at 1,039 documents:
 * 25 individual creates 23,866ms, the same 25 in one call 1,107ms — 21.6x, and
 * the gap widens as the library grows. That is the difference between an
 * ability import that takes minutes and one that takes seconds.
 *
 * Chunked rather than one giant call because a rejected batch fails whole: a
 * chunk bounds what one bad document can take down with it, lets a progress bar
 * move, and keeps the retry below cheap.
 */
export const WRITE_CHUNK = 50;
export async function createDocs(cls, dataList, opts = {}) {
  if (!dataList.length) return [];
  // POSITIONAL: one slot per input, `null` where that document was not
  // created. An array that silently omits failures shifts every later slot, so
  // a caller pairing results to inputs files documents under their neighbours'
  // ids — a lookup that confidently answers with the wrong document rather
  // than a lost import. The pairing below is by cookbook id and not by
  // position, for the reason written where it happens.
  const out = new Array(dataList.length).fill(null);

  // Grouped by LINE, because one resolved pack for a mixed list writes every
  // document to whichever shelf the first one wanted. Nothing batched carries a
  // non-ACKS id today — the OSE paths embed their gear on the actor rather than
  // minting world items — so this groups into exactly one bucket now, and keeps
  // doing the right thing for the first line-bearing book that mints one.
  const byLine = new Map();
  dataList.forEach((data, i) => {
    const line = lineOfData(data) ?? opts.line ?? null;
    const key = line ?? "";
    if (!byLine.has(key)) byLine.set(key, { line, entries: [] });
    byLine.get(key).entries.push({ data, i });
  });

  const { line: _ignored, ...createOpts } = opts;
  for (const { line, entries } of byLine.values()) {
    const packOptions = await packOpts(cls.documentName, line);
    for (let i = 0; i < entries.length; i += WRITE_CHUNK) {
      const chunk = entries.slice(i, i + WRITE_CHUNK);
      const made = await cls
        .createDocuments(chunk.map((e) => e.data), { ...createOpts, ...packOptions })
        .catch((err) => {
          // One bad chunk must not lose the rest of the run. Fall back to one
          // write per document so the offender is isolated and named, and its
          // neighbours still land.
          console.warn(`${MODULE_ID} | batched create of ${chunk.length} ${cls.documentName}(s) failed — retrying singly`, err);
          return null;
        });
      if (made) {
        // Matched by cookbook id, NEVER by position. `createDocuments` does not
        // throw on a document that fails validation — it drops it and answers
        // with FEWER documents than it was given, in order. So `made[k]` stops
        // being `chunk[k]` at the first invalid document, and everything after
        // it lands one slot early: the exact off-by-one this positional
        // contract exists to prevent, reintroduced inside the fix for it. Every
        // document this module creates carries a cookbook id, which is the
        // identity to pair on; anything unidentifiable falls into the chunk's
        // first free slot so the count still tells the truth.
        const slotsById = new Map();
        for (const e of chunk) {
          const key = e.data?.flags?.[MODULE_ID]?.cookbook?.id;
          if (!key) continue;
          if (!slotsById.has(key)) slotsById.set(key, []);
          slotsById.get(key).push(e.i);
        }
        const spare = chunk.map((e) => e.i);
        const take = (slot) => {
          const at = spare.indexOf(slot);
          if (at >= 0) spare.splice(at, 1);
          return slot;
        };
        for (const doc of made) {
          const key = doc.getFlag(MODULE_ID, "cookbook")?.id;
          const queue = key ? slotsById.get(key) : null;
          const slot = queue?.length ? take(queue.shift()) : spare.shift();
          if (slot !== undefined) out[slot] = remembered(doc);
          else remembered(doc); // created, but nothing to pair it to — still indexed
        }
      } else {
        for (const { data, i: slot } of chunk) {
          const one = await cls
            .create(data, { ...createOpts, ...packOptions })
            .catch((e) => (console.error(`${MODULE_ID} | create "${data?.name}"`, e), null));
          if (one) out[slot] = remembered(one);
        }
      }
    }
  }
  return out;
}

/**
 * Every Item this module has imported, indexed by cookbook id — the packs a
 * write lands on, and the sidebar ones a sidebar-era release left behind.
 *
 * The index is what every item import asks before it creates, so an import it
 * cannot see is an import that gets made again: never index the packs alone
 * while a world can hold both (see `sidebarImports`). The skinned template
 * copies are the documents this index must not answer with — a skin inherits
 * the definition's cookbook id, so a bare world read hands back one class's
 * engraved silver waterskin as "the Waterskin you imported" — and the filter
 * that keeps them out lives there.
 *
 * Cached because dedup is asked once per id across a whole-corpus import, and
 * loading a compendium's documents per id would be hundreds of round trips.
 * `rememberImported` keeps the cache honest as new ones are created.
 */
let importedCache = null;
async function importedIndex() {
  if (importedCache) return importedCache;
  // Every Item shelf this module owns. Items are shared across books — one
  // Waterskin serves every one of them — so today they all land on the ACKS
  // shelf; reading them all anyway means a line that ever does mint an item is
  // deduplicated rather than twinned.
  const collections = ourPacksOfType("Item");
  const docs = [
    ...(await Promise.all(collections.map((c) => c.getDocuments().catch(() => [])))).flat(),
    // The packs FIRST, so the shelf a write lands on is the document an id
    // answers with when a world holds both.
    ...sidebarImports("Item"),
  ];
  const byId = new Map();
  for (const doc of docs) {
    const flag = doc.getFlag(MODULE_ID, "cookbook");
    // Every id the document answers for: its own, and any it absorbed when two
    // books turned out to print the same thing. Without the merged ids the
    // loser's id resolves to nothing and the next run imports the twin again.
    for (const key of [flag?.id, ...(flag?.merged ?? [])]) if (key && !byId.has(key)) byId.set(key, doc);
  }
  importedCache = byId;
  return byId;
}

/** Record a freshly created import so the next dedup sees it. */
function rememberImported(id, doc) {
  if (id && doc && importedCache && !importedCache.has(id)) importedCache.set(id, doc);
  return doc;
}

/**
 * Imports for a cookbook id that are still being built, keyed by id.
 *
 * Checking `importedItem` and creating the document are two awaits apart — a
 * page extraction and a socket round-trip, hundreds of milliseconds — and the
 * importers run concurrently (importMany at IMPORT_CONCURRENCY, every monster
 * and NPC resolving its own proficiency list). Without a claim, every worker
 * that asks for the same shared ability during that window misses the cache and
 * mints its own copy, so one proficiency becomes four.
 *
 * The claim is the PROMISE, exactly as ensureFolderPath claims a folder: the
 * second caller waits for the first one's document instead of building a twin.
 * Being keyed on the cookbook id alone and shared by every item importer, it is
 * also what makes the class import and the ability import land on the SAME
 * item rather than one each.
 */
const inflightImports = new Map();

/**
 * The item for a cookbook id: the one already imported, the one another caller
 * is importing right now, or a fresh one from `build`.
 *
 * `build` runs at most once per id per session. A build that yields nothing
 * (a rejected create, a page that did not match) releases the claim so a later
 * attempt can try again rather than inheriting the failure forever.
 */
async function claimImport(id, build) {
  return claimed(id, importedItem, rememberImported, build);
}

/**
 * The ACTOR-side claim. Same rule, different shelf: a presence check has to ask
 * the collection the matching write goes to, and an actor importer asking the
 * ITEM index gets "not imported" every time — which is how one run of the
 * vehicle importer minted a second copy of all 19 printed rows, then a third.
 * Nothing is remembered: actors are found by their flag, not by an index.
 *
 * Exported because the OSE book importers write actors too, and an importer
 * that skips the claim is how a second run mints twins.
 */
export async function claimActorImport(id, build) {
  return claimed(id, importedActor, (_id, doc) => doc, build);
}

async function claimed(id, present, remember, build) {
  const existing = await present(id);
  if (existing) return existing;
  const inflight = inflightImports.get(id);
  if (inflight) return inflight;
  const pending = (async () => remember(id, await build()))();
  inflightImports.set(id, pending);
  try {
    return await pending;
  } finally {
    // The claim covers the in-flight window and NOTHING else. `remember` has
    // already run inside `pending`, so the verified index holds the result
    // before this line — while a claim kept past resolution would be a second
    // cache that nothing invalidates, and a document deleted afterwards would
    // go on answering "already imported" for the rest of the session.
    inflightImports.delete(id);
  }
}

/** Drop the cache — after a bulk delete, or when the target may have changed. */
export function forgetImportedIndex() {
  importedCache = null;
  nameIndexCache = null;
  inflightImports.clear();
}

/**
 * The imported item for a cookbook id, or null — the question every binding
 * outside this file has to ask before it can point at a document.
 */
export const importedItemFor = (id) => importedItem(id);

/**
 * The imported ACTOR for a cookbook id, or null — the same question against the
 * collection an actor importer writes to. Asked before an expensive read, not
 * only before the write: a page render per entry is the cost a second run of a
 * whole book is trying to avoid.
 */
export const importedActorFor = (id) => importedActor(id);

/**
 * Every document of a type the library holds — the packs', loaded, and the
 * sidebar's (`sidebarImports`).
 *
 * The one way to enumerate imports. A pass that walks `game.<collection>`
 * instead finds an empty shelf and reports it as "nothing to do", which is how
 * Update once claimed a fully-imported world held no classes; a pass that walks
 * the packs alone leaves a sidebar-era import unreachable by every control that
 * repairs, rebuilds or removes one.
 */
export async function importedDocs(type) {
  const packed = (await Promise.all(ourPacksOfType(type).map((c) => c.getDocuments().catch(() => [])))).flat();
  return [...packed, ...sidebarImports(type)];
}

/** Delete imported documents of a type from wherever the library lives. */
async function deleteImported(type, docs) {
  if (!docs.length) return 0;
  // Grouped by the pack each document is ON, never by one resolved target: the
  // list spans lines now, and a delete addressed to the wrong pack removes
  // nothing and says nothing.
  const byPack = new Map();
  for (const doc of docs) {
    const key = doc.pack ?? "";
    if (!byPack.has(key)) byPack.set(key, []);
    byPack.get(key).push(doc.id);
  }
  const cls = foundry.utils.getDocumentClass(type);
  for (const [pack, ids] of byPack) {
    await cls
      .deleteDocuments(ids, pack ? { pack } : {})
      .catch((err) => console.warn(`${MODULE_ID} | delete ${ids.length} ${type}(s) from ${pack || "the sidebar"}`, err));
  }
  return docs.length;
}

/**
 * Every imported item keyed by lower-cased NAME, for the one lookup an id
 * cannot answer: a printed list that names an ability in words.
 *
 * Built once and handed to a loop rather than asked per name — the index is a
 * compendium read, and a class's rungs ask it dozens of times.
 */
export async function importedItemsByName() {
  const byName = new Map();
  for (const doc of (await importedIndex()).values()) {
    const key = doc.name?.toLowerCase();
    if (key && !byName.has(key)) byName.set(key, doc);
  }
  return byName;
}

/**
 * The already-imported item for this cookbook id, or null.
 *
 * The index is cached for a whole session, so it can hold a document the GM has
 * since deleted — and answering "already imported" for a document that is gone
 * would break the one refresh a GM has: delete the item, import again, get the
 * new derived values. So the cached hit is confirmed against its collection
 * before it is trusted, and a stale one is dropped.
 */
const importedItem = async (id) => {
  const cached = (await importedIndex()).get(id) ?? null;
  if (!cached) return null;
  const live = cached.collection?.get?.(cached.id) ?? null;
  if (live) return live;
  importedCache?.delete(id);
  return null;
};

/**
 * The already-imported ACTOR for this cookbook id, or null — the actor-side
 * counterpart of importedItem, asked of whichever target actors go to. Not
 * indexed: the actor importers already carry `importedIdSet`, and this answers
 * the one question that needs the document itself (an animal, a companion).
 */
async function importedActor(id) {
  const world = game.actors.find((a) => a.getFlag(MODULE_ID, "cookbook")?.id === id);
  if (world) return world;
  // Its OWN shelf first — that is where `createDoc` put it — then the others.
  // A creature re-shelved by a release that changed its line is still found,
  // which is what keeps a Judge from importing a second copy of it.
  const own = await packFor("Actor", lineOf(bookOfCookbookId(id)));
  const collections = ourPacksOfType("Actor").sort((a, b) => (a.collection === own ? -1 : b.collection === own ? 1 : 0));
  for (const collection of collections) {
    // The cookbook flag is not a default index field — ask for it, exactly as
    // importedIdSet does, or the row is there and the match never fires.
    const index = await collection.getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`] }).catch(() => null);
    const row = [...(index ?? [])].find((r) => r.flags?.[MODULE_ID]?.cookbook?.id === id);
    if (row) return collection.getDocument(row._id);
  }
  return null;
}

async function ensureFolderPath(type, names, line = null) {
  const pack = await packFor(type, line);
  const collection = pack ? game.packs.get(pack)?.folders : game.folders;
  const path = names.filter(Boolean).map((n) => String(n).trim()).filter(Boolean);
  // The gate, not a warning: a third level is dropped rather than created, so
  // the document lands one folder up instead of somewhere a pack would refuse
  // to make and an ownership dialog would never reach.
  if (path.length > FOLDER_MAX_DEPTH) {
    console.warn(`${MODULE_ID} | folder path "${path.join(" / ")}" is deeper than ${FOLDER_MAX_DEPTH} — truncated.`);
    path.length = FOLDER_MAX_DEPTH;
  }
  let parent = null;
  for (const name of path) {
    const key = `${type}|${pack ?? "world"}|${parent?.id ?? "root"}|${name}`;
    // Cache the PROMISE, not the resolved folder: two concurrent importers that
    // both miss a resolved cache would each create the folder and the world
    // would end up with duplicates. Awaiting a shared promise means the second
    // caller waits for the first one's folder instead of making its own — which
    // is what lets a folder be resolved mid-import (once extraction reveals the
    // monster's type) rather than having to be pre-created before the fan-out.
    let pending = folderCache.get(key);
    if (!pending) {
      const parentId = parent?.id ?? null;
      pending = (async () =>
        (collection ?? game.folders).find(
          (fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId,
        ) ??
        // A folder we make is marked like every document we make: removal
        // enumerates flagged folders, so an unmarked one is a folder this
        // module creates and can never take away again. An adopted folder —
        // one the reader already had under this name — is deliberately left
        // unmarked, so removal leaves it exactly where it was found.
        (await Folder.create(
          { name, type, folder: parentId, sorting: "a", flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${name}` } } } },
          pack ? { pack } : {},
        )))();
      folderCache.set(key, pending);
    }
    parent = await pending;
  }
  return parent;
}

/**
 * A folder in the SIDEBAR, whatever the import target is.
 *
 * The one caller is the class-template materializer. Its documents are world
 * documents by design — acks-extras copies them out of the pack precisely so a
 * Judge can repair one — so filing them needs a world folder. Handing that
 * materializer a folder from `ensureFolderPath` gives it a PACK folder id for a
 * document it creates in the world, and the document lands unfiled pointing at
 * a folder the sidebar does not have.
 *
 * Deliberately not routed through `folderCache`: that cache is keyed per target
 * and this is the exception to the target, not a member of it.
 */
async function ensureWorldFolderPath(type, names) {
  let parent = null;
  for (const name of names.filter(Boolean).map((n) => String(n).trim()).filter(Boolean).slice(0, FOLDER_MAX_DEPTH)) {
    const parentId = parent?.id ?? null;
    parent =
      game.folders.find((fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId) ??
      (await Folder.create({
        name,
        type,
        folder: parentId,
        sorting: "a",
        flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${name}` } } },
      }));
  }
  return parent;
}

/**
 * The folder a book's imports are filed under. A shipped book is named by the
 * registry; a Judge-registered source by the name they typed for it, which is
 * the only name it has.
 */
const bookFolderName = (bookId) => BOOKS[bookId]?.label ?? oseSourceLabel(bookId) ?? bookId;
/**
 * The folder an entry of this kind belongs in, creating the path as needed —
 * inside its book's LINE pack, so the tree and the pack always agree.
 */
const targetFolder = (type, bookId, group) =>
  ensureFolderPath(type, [bookFolderName(bookId), group], lineOf(bookId));

/**
 * Every cookbook id already held for one document type, in WHICHEVER target is
 * configured — the sidebar collection plus, in compendium mode, the pack INDEX
 * (read with the cookbook flag as an index field, so no document is loaded).
 *
 * Every "have I imported this already?" question routes through here. Asking
 * the sidebar alone is the standing hazard: `importToCompendium` moves the
 * WRITES, and a check that stayed pointed at the world sees an empty shelf and
 * re-imports the lot on every run.
 */
async function importedIdsOfType(type, worldCollection) {
  const ids = new Set([...worldCollection].map((d) => d.getFlag(MODULE_ID, "cookbook")?.id).filter(Boolean));
  // Every shelf, because a batch mixes lines: "import everything" walks the
  // ACKS books and the OSE ones in one pass, and asking one pack about all of
  // them answers "not imported" for every book shelved somewhere else.
  for (const collection of ourPacksOfType(type)) {
    // A failed index read must be LOUD: returning an empty set here reads as
    // "nothing imported yet" and a bulk run re-creates everything as twins.
    const index = await collection.getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`] }).catch((err) => {
      console.warn(
        `${MODULE_ID} | importedIdsOfType: index of ${collection.collection} unreadable — imported ${type}s may be recreated`,
        err,
      );
      return null;
    });
    for (const row of index ?? []) {
      const id = row.flags?.[MODULE_ID]?.cookbook?.id;
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * Cookbook ids already held as ACTORS, wherever imports go.
 *
 * Unlike an ability, a monster import always CREATES — importOne has no reuse
 * to fall back on — so importing the same entry twice leaves two actors
 * claiming one cookbook id, and anything resolving by id (a companion slot,
 * say) then picks between them arbitrarily. Every actor import path filters
 * through this, which is what makes "import all" safe to press twice.
 */
const importedIdSet = () => importedIdsOfType("Actor", game.actors);

/** Actors of one type, wherever imports live (sidebar + configured pack). */
async function importedActorsOfType(type) {
  const world = game.actors.filter((a) => a.type === type);
  const collections = ourPacksOfType("Actor");
  if (!collections.length) return world;
  const docs = (await Promise.all(collections.map((c) => c.getDocuments({ type }).catch(() => [])))).flat();
  return [...world, ...docs];
}

/**
 * Monster TYPE → folder name. The stat block's own taxonomy (Animal, Undead,
 * Beastman, …) is what a Judge actually browses by; the Monstrous Manual prints
 * no section groups, so without this its 154 entries pile into one folder.
 *
 * Filing by FAMILY was tried first and was wrong: most families have one to
 * three members, so it produced a folder per creature ("Bat", "Boar", "Cat")
 * rather than a taxonomy.
 */
const TYPE_FOLDER = {
  animal: "Animals",
  beastman: "Beastmen",
  construct: "Constructs",
  enchanted: "Enchanted",
  giant: "Giants",
  humanoid: "Humanoids",
  incarnation: "Incarnations",
  monstrosity: "Monstrosities",
  ooze: "Oozes",
  plant: "Plants",
  undead: "Undead",
  vermin: "Vermin",
};

/**
 * The type a block leads with, preferring the SPECIFIC one when it prints
 * several ("Humanoid, Beastman" files under Beastmen — the useful bucket).
 */
const TYPE_PRIORITY = ["beastman", "incarnation", "undead", "construct", "ooze", "plant", "giant", "vermin", "monstrosity", "animal", "humanoid", "enchanted"];
function primaryTypeOf(node) {
  const t = node?.fields?.stats?.type;
  const keys = (t?.keys ?? (t?.key ? [t.key] : [])).map((k) => String(k).toLowerCase());
  if (!keys.length) return null;
  for (const p of TYPE_PRIORITY) if (keys.includes(p)) return p;
  return keys[0];
}

/** Folder for a type key ("undead" → "Undead"), or null. */
const typeFolderOf = (key) => (key ? TYPE_FOLDER[String(key).toLowerCase()] ?? null : null);

/**
 * The display group an actor-kind entry files under: the book's authored
 * section group, else its stat-block TYPE, else a bucket for the kinds that
 * have no type at all (generator templates, NPCs, vehicles).
 */
function actorGroupOf(found, id, { type = null } = {}) {
  const authored = found?.entry?.meta?.group;
  if (authored) return authored;
  const kind = found?.entry?.kind;
  // A family/monster TEMPLATE is a generator, not a creature — it has no stat
  // block to type, and mixing generators in with monsters hides both.
  if (kind === "kind.monsterFamily" || kind === "kind.monsterTemplate") return "Templates";
  // A vehicle is one row of a printed table, not a creature; it has no type
  // either, and its own shelf is what keeps a book folder browsable.
  if (kind === "kind.vehicle") return "Vehicles";
  const byType = typeFolderOf(type);
  if (byType) return byType;
  if (kind === "kind.npc") return "NPCs";
  return null;
}

/**
 * THE one destination rule for a cookbook ACTOR — every actor importer asks it,
 * so no two of them can disagree about where a creature belongs (animals used
 * to import into "Animals" and be filed away into "<book> › animal", the raw
 * group key; MM monsters with no group sat 150 to a folder while their families
 * went unused; vehicles asked the ITEM rule and landed loose at the top).
 */
function actorFolderFor(id, found = cookbookEntry(id), opts = {}) {
  // The Animals shelf is cross-book, but not cross-LINE: it is built in
  // whichever pack this entry's own book writes to, because the folder and the
  // document have to end up in the same compendium.
  if (isAnimalEntry(found?.entry)) return ensureFolderPath("Actor", ["Animals"], lineOf(bookOf(found)));
  return targetFolder("Actor", bookOf(found), actorGroupOf(found, id, opts));
}

/**
 * The folder an import from this book belongs in — its book's shelf, inside its
 * line's pack.
 *
 * Exported for the OSE importers, which build their documents outside this file
 * and would otherwise have to know how a line becomes a pack. Their creatures
 * used to be created with no folder at all, which left every one of them loose
 * at the top of the library.
 */
export const importFolderFor = (type, bookId, group = null) => targetFolder(type, bookId, group);

/**
 * The folder for an import that belongs to no book at all — a block a Judge
 * typed in. It goes to the unlined shelf rather than the ACKS one: it is
 * another game's creature whether or not anything can say which game.
 */
export const unlinedFolderFor = (type, name) => ensureFolderPath(type, [name], UNLINED_LINE);

/** Pre-create every folder a batch will need, before the workers fan out. */
async function prepareFolders(type, ids) {
  const seen = new Set();
  for (const id of ids) {
    const found = cookbookEntry(id);
    const group = type === "Actor" ? actorGroupOf(found, id) : (found?.entry?.meta?.group ?? null);
    const key = `${bookOf(found)}|${isAnimalEntry(found?.entry) ? "@animal" : (group ?? "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (type === "Actor") await actorFolderFor(id, found);
    else await targetFolder(type, bookOf(found), group);
  }
}

/**
 * How many monsters to import at once. Each import is a PIPELINE of work that
 * uses different resources — pdf.js page extraction (one shared worker), image
 * decode + PNG encode (main thread), art upload (network), and a document write
 * (DB) — so running a handful concurrently overlaps stages that would otherwise
 * idle waiting on each other. The cap is deliberate and small: firing all ~287
 * at once would pin every page's decoded artwork in memory and flood the single
 * worker's queue, trading one bottleneck for a worse one. 4 keeps each resource
 * busy without oversubscribing any.
 */
/**
 * The two prose channels every imported monster gets: the whole passage for a
 * core `biography`, and the Full Monster Sheet extras (description sections
 * routed onto its fields + the classification/senses/defenses block). Shared by
 * importOne and the family importer so a family variant is byte-for-byte the
 * same creature a direct import produces.
 *
 * The Description tab stacks its fields in FIELD_ORDER, so the page reference
 * closes the last field that received text and the creature carries it once.
 */
function monsterProseChannels(node, id, cite) {
  const paras = node.fields.description ?? [];
  const ROUTE = {
    appearance: "appearance", combat: "combat", ecology: "ecology",
    encounter: "encounterText", lair: "encounterText",
    lore: "lore", specialRules: "notes", behavior: "notes",
  };
  const FIELD_ORDER = ["appearance", "combat", "ecology", "encounterText", "lore", "notes"];
  const texts = new Map();
  for (const sec of [...new Set(paras.map((p) => p.section ?? "appearance"))]) {
    const field = ROUTE[sec] ?? "notes";
    texts.set(field, [...(texts.get(field) ?? []), ...nodeParagraphs(node, sec)]);
  }
  const last = FIELD_ORDER.filter((f) => texts.get(f)?.length).pop() ?? "appearance";
  const description = {};
  for (const [field, lines] of texts) description[field] = bookText(lines, field === last ? cite : "", { id });
  // A page that matched but yielded no prose still says where it was read from.
  if (!description[last]) description[last] = bookText([], cite, { id });
  const extras = { ...buildExtras(node), description };
  return { biography: bookText(nodeParagraphs(node), cite, { id }), extras };
}

const IMPORT_CONCURRENCY = 4;

/**
 * Run a list of entry ids through importOne with a progress bar, bounded to
 * IMPORT_CONCURRENCY at a time.
 *
 * Each import parses pages out of the seat's PDF, so a whole book is minutes of
 * work: without feedback the client looks hung. Errors are per-entry — one
 * unreadable page must not abandon the other 286 — and the shared iterator means
 * a slow entry never blocks a free worker from starting the next.
 */
async function importMany(ids, label) {
  const total = ids.length;
  const bar = progressBar(label, total);
  let done = 0;
  try {
    // Every id names its OWN book (a batch may span every connected book) and its
    // own destination folder; the tree is built up front so the workers below
    // only ever read the cache.
    await prepareFolders("Actor", ids);
    const it = ids[Symbol.iterator]();
    const worker = async () => {
      for (let n = it.next(); !n.done; n = it.next()) {
        const id = n.value;
        const found = cookbookEntry(id);
        const bookId = bookOf(found);
        const folder = await actorFolderFor(id, found);
        const actor = await importOne(bookId, id, folder?.id ?? null).catch(
          (err) => (console.error(`${MODULE_ID} | import ${id}`, err), null),
        );
        if (actor) done++;
        bar.step(found?.entry?.name ?? id);
      }
    };
    await Promise.all(Array.from({ length: Math.min(IMPORT_CONCURRENCY, total || 1) }, worker));
  } finally {
    bar.finish(label);
  }
  return done;
}

/**
 * Actor-kind entry ids across EVERY connected book, in book then page order.
 * The single-book `openBooks[0]` this replaced meant a seat with three books
 * open could only ever import from the first one.
 */
function actorEntriesAcrossBooks() {
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  const rows = [];
  for (const bookId of openBooks) {
    const cb = data.books.get(bookId);
    for (const [id, e] of Object.entries(cb.entries)) {
      if (actorKindOf(e)) rows.push({ id, entry: e, bookId });
    }
    // Families ride the same list as synthesized rows (one generator template
    // per family); their members stay listed too, for direct import.
    for (const id of Object.keys(cb.families ?? {})) {
      rows.push({ id, entry: cookbookEntry(id).entry, bookId });
    }
  }
  rows.sort((a, b) => a.bookId.localeCompare(b.bookId) || a.entry.pages[0] - b.entry.pages[0] || a.id.localeCompare(b.id));
  return { openBooks, rows };
}

/** Every entry id that is a MEMBER of some family in the given cookbook set. */
function familyMemberIds() {
  const members = new Set();
  for (const cb of data.books.values()) {
    for (const fam of Object.values(cb.families ?? {})) for (const m of fam.members) members.add(m.id);
  }
  return members;
}

const sysObject = (doc) =>
  typeof doc?.system?.toObject === "function" ? doc.system.toObject() : foundry.utils.deepClone(doc?.system ?? {});

/* -------------------------------------------- */
/*  Reimport one shelf                          */
/* -------------------------------------------- */

/**
 * Which importer refills each top-level shelf.
 *
 * The shelves themselves are NOT listed here — `ITEM_SHELF` already says which
 * id namespaces land on which shelf, and restating that would let the two
 * drift. This names only the thing `ITEM_SHELF` cannot: which run rebuilds a
 * shelf once it is empty. A shelf missing from this map cannot be reimported on
 * its own and says so.
 *
 * Every importer here is dedup-driven, so running one after emptying a single
 * shelf re-creates exactly that shelf and passes over everything else.
 */
const SHELF_REFILL = {
  Proficiencies: "cookbookImportAbilities",
  "Class Powers": "cookbookImportAbilities",
  Drawbacks: "cookbookImportAbilities",
  Skills: "cookbookImportAbilities",
  Languages: "cookbookImportTables",
  Races: "cookbookImportTables",
  Classes: "importClasses",
  Equipment: "importAllEquipment",
  Weapons: "importWeapons",
  Armor: "importArmor",
  Traps: "importTraps",
  Variations: "importVariations",
};

/** id namespaces that file onto a shelf, read off the shelf table itself. */
const shelfPrefixes = (shelf) =>
  Object.entries(ITEM_SHELF)
    .filter(([, name]) => name === shelf)
    .map(([prefix]) => prefix);

/** Every shelf that can be rebuilt on its own, in shelf order. */
export const reimportableShelves = () =>
  [...new Set(Object.values(ITEM_SHELF))].filter((shelf) => SHELF_REFILL[shelf] && shelfPrefixes(shelf).length).sort();

/**
 * GM: empty ONE top-level shelf and import it again.
 *
 * The third of the three controls a Judge actually needs — import everything,
 * delete everything, and rebuild one shelf — for the case where a shelf is
 * wrong and a whole re-import is too big a hammer: a book reconnected at a
 * different printing, an extraction fixed, a shelf edited past recognition.
 *
 * Deleting first is the point. Import is idempotent and passes over what it
 * already has, so importing "again" over a populated shelf changes nothing;
 * only an empty shelf gets rebuilt.
 *
 * Documents a class template made are never touched: they carry acks-extras'
 * own stamp, they are the Judge's repairable copies, and they are not this
 * shelf's to delete.
 *
 * @param {string} [shelf] a name from `reimportableShelves()`; omitted, asks.
 */
export async function cookbookReimportShelf(shelf = null) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes and re-creates documents).`);
  const shelves = reimportableShelves();
  if (!shelf) {
    const esc = foundry.utils.escapeHTML ?? ((x) => x);
    const options = shelves.map((n) => `<option value="${esc(n)}">${esc(n)}</option>`).join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportTitle`) },
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      content: `<p class="notes">${game.i18n.localize(`${LANG_PREFIX}.ui.reimportHint`)}</p>
        <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.reimportPick`)}</label>
        <select name="shelf">${options}</select></div>`,
      ok: {
        label: game.i18n.localize(`${LANG_PREFIX}.ui.reimportGo`),
        callback: (event, button) => cookbookReimportShelf(button.form.elements.shelf.value),
      },
    });
  }
  if (!SHELF_REFILL[shelf]) return ui.notifications.warn(`${MODULE_ID} | "${shelf}" is not a shelf that can be rebuilt on its own.`);

  const prefixes = shelfPrefixes(shelf);
  const mine = (d) =>
    !d.flags?.[MODULE_ID]?.templatePart &&
    prefixes.some((p) => String(d.getFlag(MODULE_ID, "cookbook")?.id ?? "").startsWith(`${p}.`));
  const doomed = (await importedDocs("Item")).filter(mine);

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.reimportConfirm`, { n: doomed.length, shelf })}</p>`,
  });
  if (!ok) return null;

  await deleteImported("Item", doomed);
  forgetImportedIndex(); // the shelf it remembers is the one just deleted
  const made = await api()[SHELF_REFILL[shelf]]();
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.reimportDone`, { n: doomed.length, shelf }));
  return { shelf, removed: doomed.length, refill: made ?? null };
}

/** The module's own api, for `SHELF_REFILL` to name a run without importing it. */
const api = () => acksExtras.importer ?? {};

/**
 * GM: delete EVERY document this module imported — the packs it created, the
 * world documents it or its materializers made from them, the folders they
 * were filed in, and the rules-table documents the ruledata provider
 * materialized on import. The counterpart to "import all": a clean slate for
 * re-importing after a recipe change, and the reset the test cycle needs.
 *
 * Three identities, because three things create on this module's behalf and
 * only one of them stamps a cookbook flag:
 *
 * - our own flag, on everything the importer writes;
 * - `flags[MODULE_ID].templatePart`, on the class-template bundles, their
 *   skinned gear and the per-class 3d6 tables — world documents by design, and
 *   the ones a flag-only sweep left behind: their folders were deleted around
 *   them and Foundry re-parented 715 orphans to the top of the sidebar;
 * - the ruledata provider's own count, which it removes itself.
 *
 * Hand-made documents carry none of the three and are never touched. Art files
 * stay on disk (Foundry exposes no delete API); a re-import reuses them, which
 * is the point — only a changed recipe needs them cleared by hand.
 */
export async function cookbookRemoveImports() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes documents).`);
  const templatePart = (d) => !!d.flags?.[MODULE_ID]?.templatePart;
  const mine = (d) => !!d.getFlag(MODULE_ID, "cookbook") || templatePart(d);
  const groups = [
    ["Actor", game.actors.filter(mine)],
    ["Item", game.items.filter(mine)],
    ["JournalEntry", game.journal.filter(mine)],
    ["RollTable", game.tables.filter(mine)],
    // Folders LAST in this list and last in the delete loop below: a folder
    // deleted while it still holds documents re-parents them instead of taking
    // them with it, which is the orphan-maker this pass exists to end.
    ["Folder", game.folders.filter(mine)],
  ];
  // The packs themselves, found by LABEL rather than through `packFor` — a
  // world upgraded from a sidebar-importing release has packs this session has
  // never opened, and a clean slate has to reach those too.
  const ourPacks = game.packs.filter(
    (p) => p.metadata.packageType === "world" && String(p.metadata.label ?? "").startsWith(`${FOLDER_NAME} — `),
  );
  const packed = ourPacks.reduce((n, p) => n + p.index.size, 0);
  // The rules-table import also materialized documents — RollTables, their
  // folders, and the JSON journal — through the ruledata provider (ACKS
  // Extras), which stamps no cookbook flag. The provider owns them, so it
  // counts and removes them here. The imported table DATA (the world store
  // the automation reads) deliberately stays: removing documents is a tidy-up,
  // not an un-import.
  const ruledata = services.get("ruledata-import");
  const materialized = ruledata?.countMaterializedDocs?.() ?? 0;
  const total = groups.reduce((n, [, docs]) => n + docs.length, 0) + packed + materialized;
  if (!total) return ui.notifications.info(`${MODULE_ID} | nothing imported by this module to remove.`);
  const lines = [
    ...groups.filter(([, d]) => d.length).map(([type, d]) => `${d.length} ${type}(s)`),
    ...(packed ? [`${packed} in ${ourPacks.length} compendium(s)`] : []),
    ...(materialized ? [`${materialized} materialized rules-table document(s)`] : []),
  ].join(", ");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "ACKS Extras — Remove Imports" },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>Delete <strong>${total}</strong> imported document(s): ${lines}?</p>
      <p class="notes">Only documents this module imported are removed. Extracted art files stay on disk and are reused by the next import.</p>`,
  });
  if (!ok) return null;
  for (const [type, docs] of groups) {
    if (!docs.length) continue;
    await foundry.utils.getDocumentClass(type).deleteDocuments(docs.map((d) => d.id)).catch((err) => {
      console.warn(`${MODULE_ID} | remove ${type}`, err);
    });
  }
  // The packs themselves go — a re-import recreates them, and an empty
  // "ACKS Cookbook — Actor" left behind is just clutter.
  for (const p of ourPacks) {
    await p.deleteCompendium().catch((err) => console.warn(`${MODULE_ID} | remove pack ${p.collection}`, err));
  }
  if (materialized) {
    await ruledata.removeMaterializedDocs().catch((err) => console.warn(`${MODULE_ID} | remove materialized rules tables`, err));
  }
  packCache.clear();
  folderCache.clear();
  forgetImportedIndex(); // every id it remembers has just been deleted
  ui.notifications.info(`${MODULE_ID} | removed ${total} imported document(s).`);
  return total;
}

/**
 * The pack labels a batch of ids writes to, as one quoted list.
 *
 * A run walks every open book, and books from different lines go to different
 * compendia — so naming one pack in the report would send a Judge to a shelf
 * their Dolmenwood creatures are not on.
 */
const packLabelsFor = (type, ids) =>
  [...new Set(ids.map((id) => packLabel(type, lineOf(bookOfCookbookId(id)))))].sort().join('", "');

/** Report an import run, naming what was skipped as already present. */
function reportImport(done, picked, skipped, ids = []) {
  ui.notifications.info(
    game.i18n.format(`${LANG_PREFIX}.ui.cookbookDone`, {
      done,
      picked,
      pack: packLabelsFor("Actor", ids) || packLabel("Actor"),
    }) + (skipped ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.cookbookSkipped`, { skipped })}` : ""),
  );
}

async function importOne(bookId, id, folderId) {
  const found = cookbookEntry(id);
  // Adventure kinds route to their own binders; journals/tables have their own
  // importers and are never built here.
  const kind = found?.entry?.kind;
  if (kind === "kind.npc" || kind === "kind.monsterLegacy") return importAdventureActor(bookId, id, folderId);
  if (kind === "kind.monsterTemplate") return importTemplate(bookId, id, folderId);
  if (kind === "kind.monsterFamily") return importFamily(bookId, id, folderId);
  if (kind && kind !== "kind.monster") return null;
  const session = ctx.sessionDocs.get(bookId);
  // The `art` op walks the page's operator list to CHOOSE which placed image to
  // extract, and costs seconds where the rest of the recipe costs milliseconds.
  // When the chosen image is already a verified file on disk there is nothing
  // left to choose, so the op is skipped outright — the cache saved the upload
  // long before this, but never the walk.
  const artOnDisk = await ctx.cachedArt?.(id).catch(() => null);
  const node = await executeEntry(session.doc, found.cb, data.registers, id, artOnDisk ? { skipOps: ["art"] } : {});
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const { system, items, flags, prototypeToken } = bindMonster(node);

  // The Full Monster Sheet is acks-extras' own sheet. Prose always routes to
  // its extras flag; system.details.biography is never a fallback destination.
  const { extras } = monsterProseChannels(node, id, found.entry.cite);

  // FILE IT NOW. A document's destination is decided by the importer that
  // creates it and by nothing afterwards — the stat block has just told us the
  // creature's TYPE, the axis monsters are grouped by, so this is the only
  // moment that knows the answer. (ensureFolderPath caches the promise, so
  // concurrent importers cannot race two folders of the same name.)
  const typed = primaryTypeOf(node);
  const folder = (await actorFolderFor(id, found, { type: typed }))?.id ?? folderId;

  // ONE write, not four. create/update/createEmbeddedDocuments/setFlag were each
  // a separate socket round-trip a bulk import paid per monster; fold the
  // embedded items, the cookbook id, and the FMS extras into the single create
  // (measured ~2.6x on the write phase alone). Art follows separately — it needs
  // the uploaded file path.
  const actor = await createDoc(Actor, {
    name: found.entry.name,
    type: "monster",
    folder,
    system,
    ...(prototypeToken ? { prototypeToken } : {}),
    // Merge, don't replace: an embedded shared ability keeps its cookbook id
    // (that id is what marks it as the shared one).
    items: items.map((i) => ({
      ...i,
      flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } },
    })),
    flags: {
      ...(flags ?? {}),
      // The stat block's TYPE rides on OUR flag, not only the Full Monster
      // Sheet's extras: it is the axis monsters are filed by, and a world
      // without acks-monsters would otherwise have nothing to group on.
      [MODULE_ID]: {
        ...((flags ?? {})[MODULE_ID] ?? {}),
        cookbook: { id, cite: found.entry.cite, ...(typed ? { type: typed } : {}) },
        extras,
      },
    },
  });
  // Foundry REPORTS a schema-validation failure and returns undefined rather
  // than throwing, so without this the next line dereferences nothing and the
  // real error — already in the console — is buried under a TypeError from
  // three frames away. One unimportable monster must read as one skipped
  // monster, not as a crash in the importer.
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: the system rejected the extracted stats — skipped (see console).`);
    return null;
  }
  // Gated on the RECIPE asking for art, not on the op having run: the op is
  // skipped when the file is already on disk, and gating on its result would
  // mean a cached illustration never reached the actor.
  const artInstr = found.entry.fields?.art ?? null;
  if ((artInstr || node.fields.art) && ctx.importArtForPage) {
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr?.page ?? found.entry.pages[0],
      name: artInstr?.name ?? node.fields.art?.name ?? null,
      box: artInstr?.box ?? null,
    });
  }
  return actor;
}

/* -------------------------------------------- */
/*  Template binding (kind.monsterTemplate)     */
/*  grids -> acks-extras.template generator actor  */
/* -------------------------------------------- */

/**
 * ACKS ladders derived by formula rather than read from a page, the
 * savesForLevel precedent: the monster attack throw improves 1 per HD from
 * 10+ at 1 HD (the thrall's own printed ladder confirms 11 − HD row by row).
 */
const monsterThrowForHd = (hd) => Math.max(11 - Math.max(1, hd), -10);

/** "Adult (51-75 years)" -> "Adult"; smallcap case healed ("Green dragon" ->
 *  "Green Dragon") — the short piece generated names use. */
const nameLabelOf = (label) =>
  String(label ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

const intFrom = (v) => {
  const m = /-?\d[\d,]*/.exec(String(v ?? ""));
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
};

/** One weapon-item payload, the same shape bindMonster embeds. */
const weaponPayload = (name, damage, { naturalWeapon = null, damageType = null, attackMode = 0 } = {}) => ({
  name,
  type: "weapon",
  img: DEFAULT_IMG.ATTACK,
  flags: {
    [MODULE_ID]: {
      ...(naturalWeapon ? { naturalWeapon } : {}),
      ...(damageType ? { damageType } : {}),
      ...(attackMode > 0 ? { attackMode } : {}),
    },
  },
  system: {
    description: "", damage, bonus: 0, melee: true, missile: false, equipped: attackMode === 0,
    pattern: "transparent", tags: [], counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
  },
});

/**
 * Weapon items from a FORM's attack routine + one damage cell, via the shared
 * attackModel (no parallel parser). The form tables separate attack names with
 * "/" where stat lines use "," — normalize inside the parenthetical only.
 * `types` is the form's glyph-mapped damage-type list, in segment order.
 */
function weaponsFromRoutine(routine, damageText, types) {
  if (!routine || !damageText) return [];
  const normalized = String(routine).replace(/\(([^)]*)\)/g, (_, inner) => `(${inner.replace(/\s*\/\s*/g, ", ")})`);
  const { modes } = attackModel(normalized, String(damageText));
  const items = [];
  let gi = 0;
  for (const [mi, mode] of modes.entries()) {
    const seen = {};
    for (const [j, seg] of (mode.dmgSegs ?? []).entries()) {
      const ne = mode.names?.[j] ?? mode.names?.[mode.names.length - 1] ?? null;
      const base = capitalize(ne?.name ?? "Attack");
      seen[base] = (seen[base] ?? 0) + 1;
      items.push(
        weaponPayload(seen[base] > 1 ? `${base} ${seen[base]}` : base, diceOf(seg) || seg, {
          naturalWeapon: ne?.nw ?? null,
          damageType: types?.[gi]?.key ?? null,
          attackMode: mi,
        })
      );
      gi++;
    }
  }
  return items;
}

/**
 * Generic color-word → hex vocabulary for token TINTS (a dragon wears its
 * hide color on the canvas). Purely lexical English mapping — the WORDS come
 * from the seat's own extracted hideColor text; the first recognized one wins.
 */
const COLOR_HEX = {
  black: "#3a3a3a", charcoal: "#464646", grey: "#8c8c8c", gray: "#8c8c8c", slate: "#708090",
  white: "#f2f2f2", ivory: "#f5f0dc", pearl: "#eae0c8", snow: "#f7f7f7", cloud: "#e8e8ee",
  red: "#b22222", flaming: "#c43419", crimson: "#a51c1c", orange: "#d2691e", burnt: "#b35a1f",
  copper: "#b87333", sandy: "#c9a86a", brown: "#8b5a2b", taupe: "#7a6a58", liver: "#674c47",
  purple: "#6a4a7a", green: "#3f7a3f", moss: "#5d7d46", olive: "#6b6b3a", forest: "#2e5d34",
  blue: "#3a5f9e", sky: "#6fa8dc", cerulean: "#2a7fbf", teal: "#2f7f7a", sea: "#3f8f80",
  bronze: "#cd7f32", silver: "#c0c0c0", electrum: "#d8d4b8", gold: "#d4af37", yellow: "#d4b23a",
};
const tintFromColorText = (text) => {
  for (const word of String(text ?? "").toLowerCase().split(/[^a-z]+/)) {
    if (COLOR_HEX[word]) return COLOR_HEX[word];
  }
  return "";
};

/** Cell keys shown as note lines on an option (materialized world data). */
const OPTION_NOTE_KEYS = [
  "size", "habitat", "hideColor", "breathWeapon", "chanceSpeech", "casterLevel", "spells",
  "rebukedAs", "abilitiesGained", "speedFly", "speedSwim", "speedClimb", "speedBurrow",
  "bme", "ccf", "lairChance", "caughtAsleep", "normalLoad", "immunity", "vision",
  "otherSenses", "xpSpeechless", "xpSpeaking", "attackRoutine",
];

const fmtCell = (v) =>
  Array.isArray(v) ? v.map((x) => x?.key ?? x?.text ?? String(x)).join(", ") : String(v);

/** Build one axis option (engine-ready patches) from a merged grid row. */
function templateOption(ax, row, cells, { id, cite, sectionText }) {
  const hitDice = cells.hitDice ?? (ax.keyIsHd && /^\d+$/.test(row.key) ? row.key : undefined);
  const { system } = bindStatsScalars({
    armorClass: cells.armorClass,
    hitDice,
    save: cells.save,
    morale: typeof cells.morale === "number" ? cells.morale : undefined,
    treasureType: cells.treasureType ? String(cells.treasureType).toUpperCase() : undefined,
    dungeonEnc: cells.dungeonEnc,
    wildernessEnc: cells.wildernessEnc,
    speedLand: cells.speedLand,
    xp: intFrom(cells.xpSpeechless) ?? intFrom(cells.xpSpeaking) ?? intFrom(cells.xp) ?? undefined,
  });

  // Attack throw: printed on the row (thrall "weapon 10+") outranks the
  // HD-derived ladder; with neither, the generated actor keeps defaults.
  const printedThrow = /(-?\d+)\s*\+/.exec(String(cells.attacks ?? ""))?.[1];
  const hdCount = parseInt(String(hitDice ?? ""), 10);
  if (printedThrow != null) system.thac0 = { throw: parseInt(printedThrow, 10) };
  else if (Number.isInteger(hdCount)) system.thac0 = { throw: monsterThrowForHd(hdCount) };

  if (cells.attacks) system.attacks = [cells.attacks, cells.damage].filter(Boolean).join(" — ");

  // A single-axis damage die with no routine (the elemental tiers): one
  // generic natural attack; forms with routines get their weapons in `cells`.
  const items = [];
  if (cells.damage && !cells.attackRoutine && !cells.attacks) {
    items.push(weaponPayload("Strike", diceOf(cells.damage) || String(cells.damage), { naturalWeapon: "strike" }));
  }

  const label = capitalize(String(row.label ?? row.key));
  const secKey = sectionText.has(row.key) ? row.key : sectionText.has(`${row.key}s`) ? `${row.key}s` : null;
  const notes = OPTION_NOTE_KEYS.filter((k) => cells[k] != null && cells[k] !== "").map(
    (k) => `${k}: ${fmtCell(cells[k])}`
  );
  const html =
    `<p><strong>${label}.</strong>` +
    `${secKey ? ` ${escapeText(sectionText.get(secKey))}` : ""}` +
    `${notes.length ? ` <em>${notes.join("; ")}</em>` : ""}</p>`;

  // Presentation channels the page itself prints: an age row's SIZE category
  // scales the token; a type row's HIDE COLOR tints it.
  const sizeWord = (/^\s*([A-Za-z-]+)/.exec(String(cells.size ?? ""))?.[1] ?? "").toLowerCase().split("-")[0];
  const token = TOKEN_SIZE[sizeWord] ? { ...TOKEN_SIZE[sizeWord] } : {};

  return {
    key: row.key,
    label,
    nameLabel: nameLabelOf(row.label ?? row.key),
    rollMin: null,
    rollMax: null,
    menuBudget: ax.budgetCol ? intFrom(cells[ax.budgetCol]) : null,
    art: "",
    tint: tintFromColorText(cells.hideColor),
    merge: system,
    items,
    html,
    token,
  };
}

/**
 * PROSE LEADER ROLES — the general pass, run for EVERY family: the ROLE
 * variants a member's own prose describes (champions, sub-chieftains,
 * chieftains, drudges/whelps, shamans, witch doctors) become a second axis.
 * The MM's sentences are formulaic ("led by a champion with 3 AC, 1 HD, and
 * 7 hp"), so the regexes are shipped LOCATORS in the defense-scan tradition;
 * every number is read at import from THIS seat's own extracted prose, per
 * member. GRACEFUL BY DESIGN: prose that matches nothing adds nothing — a
 * family without leader sentences simply has no Role axis, a member without
 * a chieftain sentence lacks that one cell.
 */
const proseLeaderRoles = ({ options, memberText, axes, cells, out }) => {
    // Tolerant of both printed shapes: goblin's "1 HD, and 7 hp" AND gnoll's
    // "3 HD, 16 hp, and a +2 damage bonus" (the damage clause may follow any
    // of the three; "and" may sit before hp or before the bonus).
    const RX = {
      champion: /led by a champion with (\d+) AC,? (\d+(?:[+-]\d+)?) HD,? (?:and )?(\d+) hp(?:,? and a ([+-]\d+) damage bonus)?/i,
      subChieftain: /led by a sub-?chieftain with (\d+) AC,? (\d+(?:[+-]\d+)?) HD,? (?:and )?(\d+) hp(?:,? and a ([+-]\d+) damage bonus)?/i,
      chieftain: /(?:lair|village) will be led by a chieftain with (\d+) AC,? (\d+(?:[+-]\d+)?) HD,? (?:and )?(\d+) hp(?:,? and a ([+-]\d+) damage bonus)?/i,
      drudgeWhelp: /drudges and whelps have Spd (\d+)['’]?,? AC (\d+),? (\d+) hp,? ML (-?\d+)/i,
      shaman: /shaman is equivalent to a (champion|sub-?chieftain|chieftain) statistically,? but has (\w+) abilities at level (\d+d\d+|\d+)/i,
      witchDoctor: /witch doctor is equivalent to a (champion|sub-?chieftain|chieftain) statistically,? but has (\w+) abilities at level (\d+d\d+|\d+)/i,
    };
    const statPatch = (option, [ac, hd, hp, dmg], note) => {
      const hdInt = parseInt(hd, 10);
      const bonus = /([+-]\d+)/.exec(hd)?.[1] ?? "";
      const bio = option.merge?.details?.biography ?? "";
      const notes = [note, dmg ? `${dmg} damage bonus` : ""].filter(Boolean);
      return {
        aac: { value: parseInt(ac, 10) },
        hp: { hd: `${hdInt}d8${bonus}`, value: parseInt(hp, 10), max: parseInt(hp, 10) },
        thac0: { throw: monsterThrowForHd(hdInt) },
        ...(notes.length ? { details: { biography: `${bio}<p><em>${notes.join("; ")}</em></p>` } } : {}),
      };
    };
    const roleKeys = [];
    for (const option of options) {
      const text = memberText.get(option.key) ?? "";
      const matched = {};
      for (const role of ["champion", "subChieftain", "chieftain", "drudgeWhelp"]) {
        const m = RX[role].exec(text);
        if (!m) continue;
        matched[role] =
          role === "drudgeWhelp"
            ? {
                movement: { base: parseInt(m[1], 10) },
                aac: { value: parseInt(m[2], 10) },
                hp: { hd: "1d8", value: parseInt(m[3], 10), max: parseInt(m[3], 10) },
                details: {
                  morale: parseInt(m[4], 10),
                  biography: `${option.merge?.details?.biography ?? ""}<p><em>does not fight</em></p>`,
                },
                attacks: "none (does not fight)",
              }
            : statPatch(option, m.slice(1), "");
      }
      // Casters wear another role's stat block plus a class-ability note.
      for (const role of ["shaman", "witchDoctor"]) {
        const m = RX[role].exec(text);
        if (!m) continue;
        const asKey = /sub/i.test(m[1]) ? "subChieftain" : m[1].toLowerCase();
        const base = matched[asKey];
        if (!base) continue;
        const bio = base.details?.biography ?? option.merge?.details?.biography ?? "";
        matched[role] = {
          ...structuredClone(base),
          details: { ...(base.details ?? {}), biography: `${bio}<p><em>${m[2]} abilities at level ${m[3]}</em></p>` },
        };
      }
      for (const [role, merge] of Object.entries(matched)) {
        if (!roleKeys.includes(role)) roleKeys.push(role);
        cells.push({ by: ["variant", "role"], key: `${option.key}|${role}`, merge, items: [] });
      }
    }
    if (!roleKeys.length) return;
    const LABELS = {
      champion: "Champion", subChieftain: "Sub-Chieftain", chieftain: "Chieftain",
      drudgeWhelp: "Drudge / Whelp", shaman: "Shaman", witchDoctor: "Witch Doctor",
    };
    axes.push({
      key: "role",
      label: "Role",
      roll: "",
      derive: { from: "", max: null },
      options: [
        { key: "standard", label: "Standard", nameLabel: "" },
        ...roleKeys.map((k) => ({ key: k, label: LABELS[k], nameLabel: LABELS[k] })),
      ],
    });
    out.nameFormat = "{variant} {role}";
};

/**
 * ONE-OFF family enrichments, layered AFTER the general prose-leader pass —
 * bespoke shapes a specific family needs (framework where it pays, plain
 * code where a one-off is faster). Each runs inside the same try/catch: a
 * failing enrichment costs its extras, never the family.
 */
const FAMILY_ONE_OFFS = {};

/**
 * kind.monsterFamily -> ONE `acks-extras.template` generator whose variant axis
 * options are the family's member creatures, each a COMPLETE preset: the same
 * bindMonster output a direct import produces (system, weapons, abilities,
 * FMS extras, token size, per-variant art), packed as engine-ready patches.
 * "Start with a baseline and select the special case" instead of N top-level
 * actors; a member can still be imported directly from the dialog. Families
 * with description-variant prose get ONE-OFF role axes (FAMILY_ONE_OFFS).
 */
async function importFamily(bookId, famId, folderId) {
  const found = cookbookEntry(famId);
  const fam = found?.entry?.family;
  if (!fam) return null;
  const session = ctx.sessionDocs.get(bookId);
  const cb = found.cb;

  const options = [];
  const memberText = new Map();
  let img = "";
  for (const member of fam.members) {
    try {
    let entry = cb.entries[member.id];
    if (!entry) continue;
    // CROSS-BOOK: a member reprinted in another open book binds the NEWER
    // printing (the per-entry defer rule, applied per variant) — the option
    // keeps this family's variant label, its stats and its text come from
    // the revising book, and its cookbook id becomes the revising id so
    // merge/dedup sees the same creature.
    let bindId = member.id;
    let bindCb = cb;
    let bindDoc = session.doc;
    const rev = deferTarget(member.id);
    if (rev) {
      const revFound = cookbookEntry(rev);
      const revDoc = ctx.sessionDocs.get(rev.split(".")[0])?.doc;
      if (revFound && revDoc) {
        bindId = rev;
        entry = revFound.entry;
        bindCb = revFound.cb;
        bindDoc = revDoc;
      }
    }
    const node = await executeEntry(bindDoc, bindCb, data.registers, bindId);
    if (!node.ok) {
      ui.notifications.warn(`${MODULE_ID} | ${entry.name}: page did not match the cookbook — variant skipped.`);
      continue;
    }
    // Per-member kind dispatch: MM-style monsters bind rich (stats + FMS
    // extras); legacy appendix blocks bind through their own translator and
    // carry biography only — the same split the direct importers use.
    const legacy = entry.kind === "kind.monsterLegacy";
    const { system, items, flags, prototypeToken } = legacy ? bindLegacyMonster(node) : bindMonster(node);
    memberText.set(slugLabel(member.variant), (node.fields.description ?? []).map((p) => p.text).join(" "));
    let extras;
    if (legacy) {
      system.details = { ...(system.details ?? {}), biography: entryText(node, bindId, entry.cite) };
    } else {
      const channels = monsterProseChannels(node, bindId, entry.cite);
      extras = channels.extras;
      // Both prose channels ship on the option: biography for the core sheet,
      // extras flags for the Full Monster Sheet — whichever is active at
      // GENERATE time uses its own; the other is inert.
      system.details = { ...(system.details ?? {}), biography: channels.biography };
    }

    let art = "";
    if (node.fields.art && ctx.uploadPageArt) {
      // Hard-bounded, per the render-timeout doctrine: one undecodable image
      // must cost this variant its portrait, never hang the family import.
      const artInstr = entry.fields?.art ?? {};
      const up = await Promise.race([
        ctx
          .uploadPageArt(bindDoc, {
            id: bindId,
            page: artInstr.page ?? entry.pages[0],
            name: artInstr.name ?? node.fields.art.name ?? null,
            box: artInstr.box ?? null,
          })
          .catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 30000)),
      ]);
      if (up?.path) art = up.path;
      if (art && !img) img = art;
      if (!up) console.warn(`${MODULE_ID} | ${entry.name}: variant art skipped (timeout or extraction failure).`);
    }

    options.push({
      key: slugLabel(member.variant),
      label: member.variant,
      nameLabel: entry.name, // the generated actor is named exactly as a direct import
      art,
      merge: system,
      items: items.map((i) => ({
        ...i,
        flags: { ...(i.flags ?? {}), [MODULE_ID]: { ...(i.flags?.[MODULE_ID] ?? {}), minted: true } },
      })),
      html: "",
      flags: {
        ...(flags ?? {}),
        [MODULE_ID]: {
          ...((flags ?? {})[MODULE_ID] ?? {}),
          cookbook: { id: bindId, cite: entry.cite },
          ...(extras ? { extras } : {}),
        },
      },
      token: prototypeToken ?? {},
    });
    } catch (err) {
      // One unreadable member costs one variant, never the family.
      console.warn(`${MODULE_ID} | ${famId}: member ${member.id} failed — variant skipped.`, err);
    }
  }
  if (!options.length) {
    ui.notifications.warn(`${MODULE_ID} | ${fam.name}: no family member could be read — skipped.`);
    return null;
  }

  const axes = [{ key: "variant", label: "Variant", roll: "", derive: { from: "", max: null }, options }];
  const cells = [];
  const out = { nameFormat: fam.nameFormat ?? "{variant}" };
  // General prose-leader pass first, then any bespoke one-off; either failing
  // costs its enrichment, never the family import.
  try {
    proseLeaderRoles({ fam, options, memberText, axes, cells, out });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${famId}: prose-role pass failed — importing without roles.`, err);
  }
  try {
    FAMILY_ONE_OFFS[famId]?.({ fam, options, memberText, axes, cells, out });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${famId}: one-off enrichment failed — importing without its extras.`, err);
  }

  // CROSS-BOOK MERGE: the same conceptual family already imported (from this
  // or another book) gains this book's NEW variants instead of a twin. Two
  // identity signals: a shared member id (revisedBy-deferred variants land on
  // the revising id, so AX2's Animated Statues match the MM family) and a
  // shared family suffix ("mm.familyMummy" ↔ "ax2.familyMummy").
  const optionIdOf = (o) => o.flags?.[MODULE_ID]?.cookbook?.id ?? null;
  const famSuffix = famId.split(".")[1] ?? famId;
  const incomingIds = new Set(options.map(optionIdOf).filter(Boolean));
  // ACKS II names win (the conversion guide's direction): a legacy family
  // name the guide RENAMES matches its ACKS II family for identity.
  const canonicalName = (n) => {
    const conv = convertName(data.registers, String(n ?? ""));
    return (conv?.status === "renamed" && conv.to ? conv.to : String(n ?? "")).toLowerCase();
  };
  const existing = (await importedActorsOfType(TEMPLATE_TYPE)).find((a) => {
    const aFam = a.getFlag(MODULE_ID, "cookbook")?.id ?? "";
    if (aFam === famId || (aFam.split(".")[1] ?? aFam) === famSuffix) return true;
    if (aFam && canonicalName(a.name) === canonicalName(fam.name)) return true;
    return (a.system.axes ?? []).some(
      (ax) => ax.key === "variant" && (ax.options ?? []).some((o) => incomingIds.has(optionIdOf(o)))
    );
  });
  if (existing) {
    const exAxes = sysObject(existing).axes;
    const vAxis = exAxes.find((a) => a.key === "variant");
    if (vAxis) {
      const haveIds = new Set(vAxis.options.map(optionIdOf).filter(Boolean));
      const haveKeys = new Set(vAxis.options.map((o) => o.key));
      const added = options.filter((o) => !haveIds.has(optionIdOf(o)) && !haveKeys.has(o.key));
      const addedKeys = new Set(added.map((o) => o.key));
      // Their role cells ride along; the incoming role axis unions by key.
      const addedCells = cells.filter((c) => addedKeys.has(String(c.key).split("|")[0]));
      const inRole = axes.find((a) => a.key === "role");
      const exRole = exAxes.find((a) => a.key === "role");
      if (inRole && exRole) {
        const roleKeys = new Set(exRole.options.map((o) => o.key));
        exRole.options.push(...inRole.options.filter((o) => !roleKeys.has(o.key)));
      } else if (inRole && added.length) {
        exAxes.push(inRole);
      }
      // The ACKS II core printing owns the NAME: an adventure-created template
      // a core family merges into takes the core family's name and id.
      const CORE_BOOKS = new Set(["mm", "rr", "jj"]);
      const exFam = existing.getFlag(MODULE_ID, "cookbook")?.id ?? "";
      const rename =
        CORE_BOOKS.has(bookId) && !CORE_BOOKS.has(exFam.split(".")[0] ?? "")
          ? { name: fam.name, [`flags.${MODULE_ID}.cookbook`]: { id: famId, cite: fam.cite } }
          : {};
      if (added.length || Object.keys(rename).length) {
        vAxis.options.push(...added);
        const exCells = sysObject(existing).cells ?? [];
        await existing.update({
          "system.axes": exAxes,
          "system.cells": [...exCells, ...addedCells],
          ...rename,
        });
      }
      if (added.length) {
        ui.notifications.info(
          `${MODULE_ID} | ${fam.name}: ${added.length} variant(s) from ${BOOKS[bookId]?.label ?? bookId} added to the existing template.`
        );
      } else {
        ui.notifications.info(`${MODULE_ID} | ${fam.name}: the existing template already covers this book's variants.`);
      }
      return existing;
    }
  }

  const actor = await createDoc(Actor, {
    name: fam.name,
    type: TEMPLATE_TYPE,
    folder: folderId,
    ...(img ? { img } : {}),
    system: {
      output: { actorType: "monster", nameFormat: out.nameFormat },
      axes,
      cells,
    },
    flags: { [MODULE_ID]: { cookbook: { id: famId, cite: fam.cite } } },
  });
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID} | ${fam.name}: the system rejected the family template — skipped (see console).`);
    return null;
  }
  return actor;
}

/**
 * A GENERATION sub-roll enumerated by an ability's own prose — "roll 1d8 for
 * the type of aura: 1, arcane; 2, acidic; …" — parsed from THIS seat's
 * extracted text at import (values persist in world data, the hand-typed
 * equivalence). Play-time rolls ("roll 1d20 to determine onset time…") are
 * deliberately NOT matched: the phrase must close with a colon right after
 * the die / "twice" / a short "for X" qualifier. Returns
 * `{die, twice?, outcomes: [{min, max, text}]}` or null; an enumeration stops
 * at the first non-numbered segment. Nested rolls inside an outcome stay
 * text for the Judge.
 */
function subRollFromProse(text) {
  const m = /\broll (\d*d\d+(?:[+-]\d+)?)( twice)?(?: for [^:]{0,50})?:\s*/i.exec(text ?? "");
  if (!m) return null;
  const rest = text.slice(m.index + m[0].length);
  const outcomes = [];
  for (const seg of rest.split(";")) {
    const o = /^\s*(\d+)(?:\s*[-–]\s*(\d+))?[,.]?\s+(.+?)\s*$/.exec(seg);
    if (!o) break;
    outcomes.push({ min: parseInt(o[1], 10), max: parseInt(o[2] ?? o[1], 10), text: o[3].replace(/\s+/g, " ") });
  }
  if (outcomes.length < 2) return null; // a real enumeration, not a stray match
  return { die: m[1].toLowerCase(), ...(m[2] ? { twice: true } : {}), outcomes };
}

/**
 * kind.monsterTemplate -> an `acks-extras.template` GENERATOR actor.
 *
 * All book-parsing intelligence happens HERE, once, at import: grid rows map
 * through the same scalar binder as full stat blocks, form routines through
 * the same attackModel, and the template actor stores only engine-ready
 * patches. the extras lib's roll/resolve then never interprets book content — which
 * is what keeps one owner per mapping. Values persist in world data (the
 * hand-typed-table equivalence), and so does the prose beside them.
 */
async function importTemplate(bookId, id, folderId) {
  const found = cookbookEntry(id);
  const session = ctx.sessionDocs.get(bookId);
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const spec = found.entry.template ?? {};
  const cite = found.entry.cite;
  const gridRows = (name) => node.fields.grids?.[name]?.rows ?? [];

  const paras = node.fields.description ?? [];
  // Section-joined prose: what an option row prints under its own heading, and
  // what the sub-roll enumerations are read out of ("roll 1d8 for the type of
  // aura: …"). Built before the axes because the options materialize from it.
  const sectionText = new Map();
  for (const p of paras) {
    if (!p.section) continue;
    sectionText.set(p.section, `${sectionText.get(p.section) ?? ""} ${p.text}`.trim());
  }

  const axes = [];
  for (const ax of spec.axes ?? []) {
    const [firstGrid, ...restGrids] = ax.grids ?? [];
    const rows = gridRows(firstGrid);
    const restByKey = restGrids.map((g) => new Map(gridRows(g).map((r) => [r.key, r.cells])));
    const options = rows.map((row) => {
      const cells = { ...row.cells };
      for (const m of restByKey) Object.assign(cells, m.get(row.key) ?? {});
      return templateOption(ax, row, cells, { id, cite, sectionText });
    });
    if (!options.length) console.warn(`${MODULE_ID} | ${id}: axis "${ax.key}" materialized no options.`);
    // AUTHORED per-option art (the body-form portraits on the dragon's own
    // pages, associated by XObject name) — uploaded once, hard-bounded.
    for (const [optKey, spec2] of Object.entries(ax.art ?? {})) {
      const option = options.find((o) => o.key === optKey);
      if (!option || !ctx.uploadPageArt) continue;
      const up = await Promise.race([
        ctx.uploadPageArt(session.doc, { id: `${id}-${optKey}`, page: spec2.page, name: spec2.name ?? null, box: spec2.box ?? null }).catch(() => null),
        new Promise((r) => setTimeout(() => r(null), 30000)),
      ]);
      if (up?.path) option.art = up.path;
    }
    axes.push({
      key: ax.key,
      label: ax.label ?? ax.key,
      roll: ax.roll ?? "",
      derive: { from: ax.derive?.from ?? "", max: ax.derive?.max ?? null },
      options,
    });
  }

  // N-dimensional refinements: each 2D damage cell becomes typed weapon items
  // via the FORM axis's routine + glyph-mapped damage types.
  const cells = [];
  for (const c of spec.cells ?? []) {
    const [aKey, bKey] = c.by ?? [];
    const bSpec = (spec.axes ?? []).find((x) => x.key === bKey);
    const formInfo = new Map();
    for (const g of bSpec?.grids ?? []) {
      for (const r of gridRows(g)) {
        const prev = formInfo.get(r.key) ?? {};
        formInfo.set(r.key, {
          routine: r.cells.attackRoutine ?? prev.routine,
          types: r.cells.damageType ?? prev.types,
        });
      }
    }
    for (const row of gridRows(c.grid)) {
      for (const [formKey, dmg] of Object.entries(row.cells)) {
        const info = formInfo.get(formKey) ?? {};
        cells.push({
          by: [aKey, bKey],
          key: `${row.key}|${formKey}`,
          merge: { attacks: [info.routine, String(dmg)].filter(Boolean).join(" — ") },
          items: weaponsFromRoutine(info.routine, dmg, info.types),
        });
      }
    }
  }

  const menu = {
    die: spec.menu?.die ?? "",
    budgetAxis: spec.menu?.budgetAxis ?? "",
    rows: (spec.menu?.rows ?? []).map((r) => {
      const sub = r.section ? subRollFromProse(sectionText.get(r.section)) : null;
      return {
        min: r.min ?? null,
        max: r.max ?? null,
        label: r.label ?? "",
        cost: r.cost ?? null,
        html:
          r.section && sectionText.has(r.section)
            ? `<p><strong>${r.label}.</strong> ${escapeText(sectionText.get(r.section))}</p><p class="acks-extras-importer-cite">${escapeText(cite)}</p>`
            : `<p><strong>${r.label}</strong> (${escapeText(cite)})</p>`,
        ...(sub ? { sub } : {}),
      };
    }),
  };

  const actor = await createDoc(Actor, {
    name: found.entry.name,
    type: TEMPLATE_TYPE,
    folder: folderId,
    system: {
      output: { actorType: "monster", nameFormat: spec.nameFormat ?? "" },
      // The FIXED foundation: rows the template page prints as plain values
      // ("Type: Monstrosity", vision, morale) bind through the same scalar
      // binder + sheet-extras mapping as any monster; "varies by …" rows
      // simply failed their patterns and contribute nothing.
      base: {
        merge: bindStatsScalars(node.fields.stats ?? {}).system,
        flags: { [MODULE_ID]: { extras: buildExtras(node) } },
      },
      axes,
      cells,
      menu,
      details: { biography: entryText(node, id, cite) },
    },
    flags: { [MODULE_ID]: { cookbook: { id, cite } } },
  });
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: the system rejected the template — skipped (see console).`);
    return null;
  }
  if (node.fields.art && ctx.importArtForPage) {
    const artInstr = found.entry.fields?.art ?? {};
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr.page ?? found.entry.pages[0],
      name: artInstr.name ?? node.fields.art.name ?? null,
      box: artInstr.box ?? null,
    });
  }
  return actor;
}

/**
 * Every stat leaf bindMonster writes only when the page yields it. A refill
 * must RETRACT these: update() merges nested objects, so a key the
 * re-extraction no longer produces would otherwise keep its stale value
 * forever. Each path absent from the new payload is written back to its schema
 * initial — the state a fresh import of the same node would leave. Only
 * binder-owned leaves are listed; everything else on the actor is left alone
 * (in particular `details.treasure.table`, which belongs to the GM's linked
 * treasure table, and `hp.bhr`, which the binder never writes).
 */
const REFILL_STAT_PATHS = [
  "aac.value",
  "hp.hd",
  "hp.value",
  "hp.max",
  "saves.paralysis.value",
  "saves.death.value",
  "saves.blast.value",
  "saves.implements.value",
  "saves.spell.value",
  "details.morale",
  "details.xp",
  "details.alignment",
  "details.treasure.type",
  "details.appearing.d",
  "details.appearing.w",
  "movement.base",
  "thac0.throw",
  "attacks",
];

/**
 * Re-read an already-imported monster's stats from this seat's book.
 *
 * The counterpart to importOne for an actor that already exists: same
 * extraction, same binding, but it UPDATES rather than creates. Embedded items
 * are left alone — a refill that re-added the abilities would duplicate them
 * on every run, and the stats are what go stale when a recipe improves.
 *
 * Returns null when the actor is not ours or its book is not open this
 * session, so the caller can fall back or explain.
 */
export async function refillMonster(actor) {
  const id = actor?.getFlag(MODULE_ID, "cookbook")?.id;
  if (!id) return null;
  const found = cookbookEntry(id);
  if (!found) return null;
  const bookId = bookOf(found);
  const session = ctx.sessionDocs.get(bookId);
  if (!session) return { ok: false, reason: "book-closed", book: bookId, name: found.entry.name };
  const node = await executeEntry(session.doc, found.cb, data.registers, found.id);
  if (!node.ok) return { ok: false, reason: "no-match", book: bookId, name: found.entry.name };
  const { system, prototypeToken } = bindMonster(node);
  for (const path of REFILL_STAT_PATHS) {
    if (foundry.utils.getProperty(system, path) !== undefined) continue;
    const field = actor.system?.schema?.getField?.(path);
    if (field) foundry.utils.setProperty(system, path, field.getInitialValue());
  }
  await actor.update({ system, ...(prototypeToken ? { prototypeToken } : {}) });
  return { ok: true, book: bookId, name: found.entry.name };
}

/* -------------------------------------------- */
/*  Abilities (proficiencies / powers / skills) */
/* -------------------------------------------- */

/**
 * Map a definition entry (+ its executed node, when the seat owns the book)
 * onto a core `ability` item. The FULL literal text is written into the
 * descriptor; classification and any materialized mechanics persist in
 * flags[MODULE_ID].extras alongside it.
 */
/* -------------------------------------------- */
/*  Adventure binding (AX line)                 */
/*  location -> journal page, rolltable ->      */
/*  RollTable, npc / monsterLegacy -> Actor     */
/* -------------------------------------------- */

const ACTOR_KINDS = new Set(["kind.monster", "kind.monsterLegacy", "kind.npc", "kind.monsterTemplate", "kind.monsterFamily"]);
/** kinds an actor-import flow may enumerate (unknown/absent kind = MM-era monster). */
const actorKindOf = (e) => !e.kind || ACTOR_KINDS.has(e.kind);
const ALIGN_WORD = { L: "Lawful", N: "Neutral", C: "Chaotic" };

/**
 * Defer-to-newest: an adventure entry reprinted in a book this seat has OPEN
 * (meta.revisedBy, e.g. ax2.khepri -> mm.khepri) imports from there instead —
 * the ACKS II printing outranks the adventure's ACKS I block when present.
 */
function deferTarget(id) {
  const rev = cookbookEntry(id)?.entry?.meta?.revisedBy;
  if (!rev) return null;
  const revBook = rev.split(".")[0];
  return ctx.sessionDocs.has(revBook) && cookbookEntry(rev) ? rev : null;
}

/** Legacy (ACKS I label-column) stats, translated onto the bindMonster surface. */
function bindLegacyMonster(node) {
  const s = node.fields.stats ?? {};
  const morale =
    typeof s.morale === "string" && /^[+-]?\d+$/.test(s.morale.trim()) ? parseInt(s.morale, 10) : s.morale;
  const bound = bindMonster({
    ...node,
    fields: { ...node.fields, attacks: null, stats: { ...s, morale, speedLand: s.movement } },
  });
  const atkText = [s.attacks, s.damage].filter(Boolean).join(" — ");
  if (atkText) bound.system.attacks = atkText;
  // One weapon item when the era's "N (name)" attack + dice damage parse.
  const m = /^\s*\d*\s*\(?\s*([A-Za-z][A-Za-z' -]*)\)?/.exec(String(s.attacks ?? ""));
  const dmg = diceOf(s.damage);
  if (m && dmg) {
    bound.items = [
      ...(bound.items ?? []),
      {
        name: capitalize(m[1].trim()),
        type: "weapon",
        img: DEFAULT_IMG.ATTACK,
        system: {
          description: "", damage: dmg, bonus: 0, melee: true, missile: false, equipped: true,
          pattern: "transparent", tags: [], counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
        },
      },
    ];
  }
  return bound;
}

/**
 * A parsed quick-stat block (the `statline` pattern) onto a monster-type
 * actor. Values persist in world fields (the GM's hand-typed equivalence);
 * ability scores and gear notes go to flags — the monster schema has no score
 * fields — and the entry's own text is written into the biography.
 */
function bindNpc(node) {
  const sl = node.fields.statline ?? {};
  const system = {};
  if (Number.isInteger(sl.ac)) system.aac = { value: sl.ac };
  if (Number.isInteger(sl.hp)) {
    const hdCount = parseInt(String(sl.hd ?? sl.class?.level ?? 1), 10) || 1;
    system.hp = { value: sl.hp, max: sl.hp, hd: `${hdCount}d8` };
  }
  // Save row from printed save level (else class level). NOTE: the shared LUT
  // is the fighter line — the MM approximation this module already uses.
  const level = sl.save?.level ?? sl.class?.level ?? 0;
  const row = savesForLevel(level);
  system.saves = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { value: v }]));
  system.saves.breath = { value: row.blast };
  system.saves.wand = { value: row.implements };
  system.details = {
    ...(typeof sl.ml === "number" ? { morale: Math.max(-6, Math.min(4, sl.ml)) } : {}),
    ...(sl.xp != null ? { xp: sl.xp } : {}),
    ...(sl.al ? { alignment: ALIGN_WORD[sl.al] ?? sl.al } : {}),
  };
  const mv = /(\d+)/.exec(String(sl.mv ?? ""));
  if (mv) system.movement = { base: parseInt(mv[1], 10) };
  if (sl.atk?.throw != null) system.thac0 = { throw: sl.atk.throw };
  if (sl.atk) system.attacks = [sl.atk.count, sl.atk.text ? `(${sl.atk.text})` : "", sl.dmg ? `— ${sl.dmg}` : ""].filter(Boolean).join(" ");
  const items = [];
  if (sl.atk?.text) {
    items.push({
      name: capitalize(sl.atk.text),
      type: "weapon",
      img: DEFAULT_IMG.ATTACK,
      system: {
        description: "", damage: diceOf(sl.dmg) || "", bonus: 0, melee: true, missile: false, equipped: true,
        pattern: "transparent", tags: [], counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
      },
    });
  }
  return { system, items, statline: sl };
}

/** Actor import for kind.npc / kind.monsterLegacy (with the defer rule). */
async function importAdventureActor(bookId, id, folderId) {
  const target = deferTarget(id);
  if (target) {
    // The deferred TARGET id gets its own already-present check — the caller
    // only filtered on the adventure id, and a world that imported the MM
    // entry directly must not get a twin.
    if ((await importedIdSet()).has(target)) {
      ui.notifications.info(`${MODULE_ID} | ${id} defers to ${target}, which this world already has — skipped.`);
      return null;
    }
    const tb = target.split(".")[0];
    ui.notifications.info(`${MODULE_ID} | ${id} is reprinted in ${BOOKS[tb]?.label ?? tb} — importing ${target} instead.`);
    // File it under the book it actually came FROM, not the adventure that
    // pointed at it.
    const tFolder = await actorFolderFor(target);
    return importOne(tb, target, tFolder?.id ?? folderId);
  }
  const found = cookbookEntry(id);
  const session = ctx.sessionDocs.get(bookId);
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node.ok) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: page did not match the cookbook (different printing?) — skipped.`);
    return null;
  }
  const kind = found.entry.kind;
  const bound = kind === "kind.npc" ? bindNpc(node) : bindLegacyMonster(node);
  const artInstr = found.entry.fields?.art ?? null;
  const sl = bound.statline;
  const classLine = sl?.class ? `<p><em>${sl.class.name} ${sl.class.level}${sl.class.note ? ` (${sl.class.note})` : ""}</em></p>` : "";
  bound.system.details = {
    ...(bound.system.details ?? {}),
    biography: classLine + entryText(node, id, found.entry.cite),
  };
  // Proficiency tokens resolve through the shared ability-provider tiers.
  if (sl?.proficiencies?.length) {
    const { items: profItems, missing } = await resolveAbilities(sl.proficiencies);
    bound.items = [...(bound.items ?? []), ...profItems];
    if (missing.length) console.log(`${MODULE_ID} | ${id}: unresolved proficiencies ${missing.join(", ")}`);
  }
  const actor = await createDoc(Actor, {
    name: found.entry.name,
    type: "monster",
    folder: folderId,
    system: bound.system,
    items: bound.items ?? [],
    flags: {
      [MODULE_ID]: {
        cookbook: { id, book: bookId, kind },
        ...(sl
          ? {
              npc: {
                ...(sl.class ? { class: sl.class } : {}),
                ...(sl.abilities ? { abilities: sl.abilities } : {}),
                ...(sl.equipment ? { equipment: sl.equipment } : {}),
                ...(sl.classAbilities ? { classAbilities: sl.classAbilities } : {}),
                ...(sl.spells ? { spells: sl.spells } : {}),
                ...(sl.hpEach ? { hpEach: true } : {}),
              },
            }
          : {}),
      },
    },
  });
  // Same art path as the MM import: the compiled entry names ITS illustration
  // (associated by placement inside the entry's claimed region), and the seat
  // extracts + uploads it. A shipped placement BOX needs no runtime XObject
  // resolution (the AX books' art never registers on page.objs), so the box
  // alone is enough to proceed.
  if (actor && artInstr && (artInstr.box || node.fields.art) && ctx.importArtForPage) {
    await ctx.importArtForPage(actor, session.doc, {
      id,
      page: artInstr.page ?? found.entry.pages[0],
      name: artInstr.name ?? node.fields.art.name ?? null,
      box: artInstr.box ?? null,
    });
  }
  return actor;
}

/**
 * Location journals: one JournalEntry per meta.group, one page per keyed
 * entry, page body = the room's own text + creature names (the seat-extracted creature
 * lookups, deferring to the ACKS II entry when the register maps one). Pages
 * update in place on re-import, so coverage grows without duplicating.
 */
export async function cookbookImportJournals() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates journals).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  let made = 0;
  let updated = 0;
  let refused = 0;
  // Every page is a fresh extraction from the seat's PDF, so a book's worth of
  // districts is minutes of work — counted up front so the bar can say how far
  // through them it is rather than only that it is busy.
  const bar = progressBar(
    game.i18n.localize(`${LANG_PREFIX}.ui.progressJournals`),
    openBooks.reduce((n, b) => n + Object.values(data.books.get(b).entries).filter((e) => e.kind === "kind.location").length, 0),
  );
  try {
    for (const bookId of openBooks) {
      const cb = data.books.get(bookId);
      const session = ctx.sessionDocs.get(bookId);
      const locs = Object.entries(cb.entries).filter(([, e]) => e.kind === "kind.location");
      if (!locs.length) continue;
      // The BOOK is the folder now, so the journal itself is named by its group
      // alone ("A. Entrance Caves") rather than repeating the book on every row.
      const folder = await ensureFolderPath("JournalEntry", [bookFolderName(bookId)], lineOf(bookId));
      const groups = new Map();
      for (const [id, e] of locs) {
        const g = e.meta?.group ?? BOOKS[bookId]?.label ?? bookId;
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g).push([id, e]);
      }
      // Journals go wherever imports go, so the "did I already make this one?"
      // lookup has to read the same target — a world-only search re-created
      // every district journal on each run in compendium mode.
      const journalPack = await packFor("JournalEntry", lineOf(bookId));
      const journals = journalPack ? await game.packs.get(journalPack).getDocuments() : [...game.journal];
      for (const [group, list] of groups) {
        let journal = journals.find((j) => j.getFlag(MODULE_ID, "cookbook")?.group === group && j.getFlag(MODULE_ID, "cookbook")?.book === bookId);
        if (journal) {
          // Re-file (and re-title) a journal made by an earlier release.
          const move = {};
          if (journal.name !== group) move.name = group;
          if ((journal.folder?.id ?? null) !== folder.id) move.folder = folder.id;
          if (Object.keys(move).length) await journal.update(move);
        } else {
          journal = await createDoc(JournalEntry, {
            name: group,
            folder: folder.id,
            flags: { [MODULE_ID]: { cookbook: { book: bookId, group } } },
          });
        }
        list.sort((a, b) => (a[1].pages[0] - b[1].pages[0]) || a[0].localeCompare(b[0]));
        let sort = 0;
        for (const [id, e] of list) {
          sort += 100;
          const node = await executeEntry(session.doc, cb, data.registers, id).catch(() => null);
          // `ok` is the heading anchor, and a page is written only when it
          // holds. Every location entry carries one, so a box that no longer
          // frames its room — a printing that moved the text, or a file
          // fingerprinting as no known book and read into the wrong slot — is
          // refused rather than written: the room's own name and citation over
          // whatever prose now occupies those coordinates is a page nothing
          // downstream can tell from a good one.
          if (!node?.ok) {
            refused++;
            bar.step(e.name);
            continue;
          }
          const creatures = Object.values(node.fields?.creatures ?? {}).filter((c) => c && (c.ref || c.text));
          // The creature line is a cross-reference, not prose: it names what
          // the room holds, and each name is the reader's route to the imported
          // creature in the compendium.
          const creatureHtml = creatures.length
            ? `<p><strong>Creatures:</strong> ${creatures.map((c) => escapeText(c.text)).join(" · ")}</p>`
            : "";
          const content = entryText(node, id, e.cite) + creatureHtml;
          const existing = journal.pages.find((p) => p.getFlag(MODULE_ID, "cookbook")?.id === id);
          if (existing) {
            await existing.update({ "text.content": content, sort });
            updated++;
          } else {
            await journal.createEmbeddedDocuments("JournalEntryPage", [
              {
                name: e.name,
                type: "text",
                sort,
                text: { content, format: CONST.JOURNAL_ENTRY_PAGE_FORMATS.HTML },
                flags: { [MODULE_ID]: { cookbook: { id, book: bookId } } },
              },
            ]);
            made++;
          }
          bar.step(e.name);
        }
      }
    }
  } finally {
    bar.finish();
  }
  // A run that refused everything is a wrong file or a printing this build does
  // not read, not an empty book — say so instead of asking for a connection the
  // reader already made.
  if (!made && !updated && refused)
    return ui.notifications.warn(`${MODULE_ID} | location journals: ${refused} page(s) did not match the cookbook (different printing?) — none written.`);
  if (!made && !updated) return ui.notifications.warn(`${MODULE_ID} | no location entries in any open book — connect AX2/AX3 first.`);
  ui.notifications.info(
    `${MODULE_ID} | location journals: ${made} page(s) created, ${updated} refreshed${refused ? `, ${refused} skipped (page did not match the cookbook)` : ""}, in "${packLabel("JournalEntry")}".`,
  );
  return { made, updated, refused };
}

/**
 * Roll tables: ranges are shipped structure (r<lo> / r<lo>-<hi> sections);
 * row TEXT materializes from the seat's book at import and persists in the
 * world — the GM's hand-typed-table equivalence, like imported stat values.
 * The formula comes from the page (dice locator) or, when the rows start at
 * 1, mechanically from the shipped range structure.
 */
export async function cookbookImportRollTables() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates roll tables).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  const present = await importedIdsOfType("RollTable", game.tables);
  let made = 0;
  let skipped = 0;
  const bar = progressBar(
    game.i18n.localize(`${LANG_PREFIX}.ui.progressRollTables`),
    openBooks.reduce((n, b) => n + Object.values(data.books.get(b).entries).filter((e) => e.kind === "kind.rolltable").length, 0),
  );
  try {
    for (const bookId of openBooks) {
      const cb = data.books.get(bookId);
      const session = ctx.sessionDocs.get(bookId);
      const tables = Object.entries(cb.entries).filter(([, e]) => e.kind === "kind.rolltable");
      if (!tables.length) continue;
      for (const [id, e] of tables) {
        // Stepped at the top, not per outcome: every branch below either creates
        // the table or explains why it could not, and all of them consumed a unit
        // of the work the bar is measuring.
        bar.step(e.name);
        if (present.has(id)) {
          skipped++;
          continue;
        }
        const node = await executeEntry(session.doc, cb, data.registers, id).catch(() => null);
        if (!node?.ok) {
          ui.notifications.warn(`${MODULE_ID} | ${e.name}: page did not match the cookbook — skipped.`);
          continue;
        }
        const folder = await targetFolder("RollTable", bookId, e.meta?.group);
        // Rows arrive as section-labelled paragraphs; a row that wrapped columns
        // has several paras under one section, joined here in order.
        const rowText = new Map();
        for (const p of node.fields.rows ?? []) {
          const key = p.section ?? "";
          rowText.set(key, rowText.has(key) ? `${rowText.get(key)} ${p.text}` : p.text);
        }
        const results = [];
        for (const [sec, text] of rowText) {
          const m = /^r([\d,-]+)$/.exec(sec);
          if (!m) continue;
          // A section may carry several ranges ("r6,7,16" — one printed truth
          // covering several rumor rolls); each becomes its own result row.
          for (const part of m[1].split(",")) {
            const g = /^(\d+)(?:-(\d+))?$/.exec(part);
            if (!g) continue;
            const lo = parseInt(g[1], 10);
            const hi = g[2] ? parseInt(g[2], 10) : lo;
            results.push({ type: CONST.TABLE_RESULT_TYPES.TEXT, text, range: [lo, hi] });
          }
        }
        if (!results.length) continue;
        results.sort((a, b) => a.range[0] - b.range[0]);
        const lows = results.map((r) => r.range[0]);
        const his = results.map((r) => r.range[1]);
        const formula =
          (typeof node.fields.roll === "string" && node.fields.roll) ||
          (Math.min(...lows) === 1 ? `1d${Math.max(...his)}` : "");
        await createDoc(RollTable, {
          name: e.name,
          folder: folder?.id ?? null,
          formula,
          description: entryText(node, id, e.cite),
          results,
          flags: { [MODULE_ID]: { cookbook: { id, book: bookId } } },
        });
        made++;
      }
    }
  } finally {
    bar.finish();
  }
  if (!made && !skipped) {
    // Which books carry roll tables is derived, not recited: naming AX2/AX3 in
    // the message went stale the moment the Judges Journal grew a table.
    const carriers = [...data.books.keys()]
      .filter((b) => Object.values(data.books.get(b).entries).some((e) => e.kind === "kind.rolltable"))
      .map((b) => BOOKS[b]?.label ?? b.toUpperCase());
    return ui.notifications.warn(
      `${MODULE_ID} | no roll-table entries in any open book — connect ${carriers.join(" or ")} first.`,
    );
  }
  ui.notifications.info(`${MODULE_ID} | roll tables: ${made} created, ${skipped} already present, in "${packLabel("RollTable")}".`);
  return { made, skipped };
}

/*
 * NOTE a local `levelValueAt()` used to sit here — a third copy of the extras lib's
 * LevelValue resolver, needed only because an imported ability's roll target
 * had to be FLATTENED to a first-level number to fit the core item's single
 * `rollTarget`. Ladders now travel whole into the acks-abilities flag and are
 * resolved there against the character, so nothing here has to resolve
 * anything — this module locates and classifies, it does not evaluate.
 */

/** "kw:sensingevil" -> "Sensing Evil"-ish, for the system's requirements field. */
const capabilityLabel = (token) => {
  const slug = String(token).replace(/^kw:/, "");
  for (const [id, e] of abilityEntries()) {
    if (id.split(".").slice(2).join("").toLowerCase() === slug) return e.name;
  }
  return slug;
};

/** The optional icon pack whose niche art beats core for several abilities. */
const NICHE_ICON_MODULE = "game-icons-net";

/**
 * Which picture this ability gets.
 *
 * Foundry's own 7,100 icons cover most of the corpus, but not the ACKS-shaped
 * corners of it: Acrobatics, Blind Fighting, Caving and Mapping have no core
 * icon worth the name, and game-icons.net has all four. So an entry may name
 * both — `icon` from core, which every seat has, and `iconNiche` from the
 * optional pack. The niche one wins where the pack is installed and is simply
 * ignored where it is not, which is the same bring-your-own posture the rest
 * of this module takes with books.
 *
 * Referencing those paths carries no licensing weight for us: the art ships in
 * THAT module under its own CC BY terms and attribution, and we only point at
 * it. Nothing is copied here.
 *
 * NOTE an item stores its img at CREATION, and nothing rewrites it afterwards.
 * Update Abilities does not: it rewrites the generated surface — descriptor,
 * structured extras, cookbook id — and leaves presentation a GM may have tuned
 * alone. So installing the pack later, or changing an entry's icon, repaints
 * only what is imported after it; re-importing the shelf is what repaints the
 * rest.
 */
export function abilityIcon(entry) {
  if (entry?.iconNiche && game.modules?.get?.(NICHE_ICON_MODULE)?.active) return entry.iconNiche;
  // Falls back to the generic book, so an entry nobody has picked an icon for
  // looks exactly as it did before rather than breaking.
  return entry?.icon || DEFAULT_IMG.ABILITY;
}

/**
 * `meta.category` is descriptive metadata a kind may set freely, but the
 * ability model stores it in a CONSTRAINED choice field. Clamp rather than
 * trust: an unknown value reached the DataModel and failed validation on every
 * sheet render (the v0.26.0 equipment leak). Falls back to the model's own
 * default so the item stays valid and usable.
 */
function abilityCategory(value) {
  if (!value) return "proficiency";
  if (!(value in ABILITY_CATEGORIES)) {
    console.warn(`${MODULE_ID} | "${value}" is not an ability category; storing "proficiency".`);
    return "proficiency";
  }
  return value;
}

export function bindAbility(entry, node, id, opts = {}) {
  const meta = entry.meta ?? {};
  const cite = entry.cite ?? "";
  // An alias is a DISTINCT ability that shares another entry's rules text, not a
  // redirect to it. Two names for one capability do not stack, so the relation
  // ships as a real effect rather than a note the reader has to interpret.
  const aliasEffects = meta.notStacksWith?.length
    ? [{ type: "capability", ref: entry.aliasOf ?? meta.notStacksWith[0], notStacksWith: meta.notStacksWith }]
    : [];
  const extras = {
    category: abilityCategory(meta.category),
    general: !!meta.general,
    repeatable: !!meta.repeatable,
    // A retired entry is still imported — an older or converted source may name
    // it — but carries the flag and a pointer at whatever superseded it.
    deprecated: !!meta.deprecated,
    ...(meta.replacedBy ? { replacedBy: meta.replacedBy } : {}),
    // The build cost is READ FROM THE SEAT'S BOOK, never shipped — so it is
    // present only once someone with the book imports or updates, like every
    // other value. `meta.powerValue` remains only as the inherited value an
    // alias takes from its target.
    ...(node?.fields?.powerValue != null
      ? { powerValue: node.fields.powerValue }
      : meta.powerValue != null
        ? { powerValue: meta.powerValue }
        : {}),
    ...(meta.requires ? { requires: meta.requires } : {}),
    ...(entry.aliasOf ? { aliasOf: entry.aliasOf } : {}),
    // Capabilities this ability confers, so a prerequisite written against a
    // capability resolves no matter which of the same-capability entries the
    // character actually holds.
    ...(meta.provides?.length ? { provides: meta.provides } : {}),
    // No chef has read this entry's full output against the printed page yet.
    // The scan-classified mechanics still bind — an inert ability helps nobody
    // — but they present as the machine draft they are: a wrong sign or a
    // missed bonus must read as unverified, never as the book's ruling. The
    // flag clears only when the register entry gains its `audited` sign-off.
    //
    // Written EXPLICITLY either way, never omitted when audited. Update merges
    // flags, so an omitted `false` left a stale `true` on every ability
    // imported before its sign-off — the banner could be raised but never
    // lowered, which makes the whole gate one-way. Live-caught on this very
    // batch: twelve entries signed, and Update left them all still marked
    // machine-classified.
    unaudited: !entry.audited,
    // Set when this reference arrived under an older/foreign name: the reader's
    // source calls it `conversionFrom`, ACKS II calls it `entry.name`.
    ...(opts.conversionStatus ? { conversionStatus: opts.conversionStatus } : {}),
    ...(opts.conversionFrom ? { conversionFrom: opts.conversionFrom } : {}),
    // Structured effects are CLASSIFIED from the seat's own prose (type, target
    // and value all materialize; the cookbook pre-declares none of them). An
    // ability the scan can't classify is still valid — name + type + prose.
    // An alias reads the TARGET's prose through its pre-baked pointer, so it
    // materializes the same mechanics without the cookbook restating any.
    //
    // Without the book there is no prose to classify — but a chef-authored spec
    // that carries no `from` locator has no value to materialize either. It is
    // pure structure (a prerequisite, a companion slot), so gating it on the
    // book would withhold something the cookbook already states. Those apply
    // either way; anything pointing at a number still waits for the book.
    effects: [...aliasEffects, ...(node?.fields?.effects ?? materializeEffects(entry.fields?.effects?.specs, []))],
    // `rolls` is assembled below, after the throws have been classified, and
    // assigned onto this same object — see the note there for why it goes here
    // rather than to the core item's single roll field.
    // Immunity-granting abilities (Divine Health, Wakefulness, Fiery
    // Resistance…) materialize defenses from the seat's OWN prose via the
    // executor's vocabulary scan — nothing about which is shipped.
    ...(node?.fields?.defenses ? { defenses: node.fields.defenses } : {}),
  };
  // EVERY throw the extract classified becomes a roll, not just the first. The
  // recipe's own `rolls` (a chef naming each throw) wins when present;
  // otherwise the classified `throw` effects are lifted in order. Ladders are
  // carried WHOLE — acks-abilities resolves them against the character's level
  // or rank at render time, so nothing is flattened on the way in.
  //
  // These go to the acks-abilities flag and NOT to `system.roll` /
  // `system.rollTarget`. The core item can hold exactly one roll, so writing
  // there too would mean two stores for the same thing, disagreeing the moment
  // an ability has more than one throw — and it is the second store that made
  // the sheet and the chat card roll different numbers. acks-abilities owns
  // ability rolls and folds core's fields in on read for items it has not
  // written; nothing needs a shadow copy.
  // Throws that come from a class's published TABLE rather than from this
  // entry's prose \u2014 one per ladder, because how many there are is data. They
  // lead the list: the books cross-reference the table first and roll whatever
  // follows second, and that is the order a reader wants the buttons in.
  const fromLadders = (entry.fields?.rolls?.specs ?? []).filter((sp) => sp?.fromLadders);
  const borrowed = [];
  for (const sp of fromLadders) {
    for (const ladder of opts.ladders?.[sp.key ?? "ladders"] ?? []) {
      borrowed.push({
        key: `${sp.key ?? "t"}${ladder.key.replace(/[^A-Za-z0-9]/g, "")}`,
        label: ladder.label,
        formula: sp.formula ?? "1d20",
        rollType: sp.rollType ?? "above",
        scale: "level",
        target: {
          kind: "progression",
          as: sp.fromLadders.as,
          table: ladder.key,
          // The FRACTION of level, and which way it rounds, are printed beside
          // the rule; a spec that locates neither reads the table at the whole
          // level, which is what an unqualified power does.
          ...(sp.fromLadders.atLevelNum ? { atLevelNum: sp.fromLadders.atLevelNum } : {}),
          ...(sp.fromLadders.atLevelDen ? { atLevelDen: sp.fromLadders.atLevelDen } : {}),
          ...(sp.fromLadders.round ? { round: sp.fromLadders.round } : {}),
        },
      });
    }
  }

  const gate = extras.effects.filter((e) => e.type === "requires").flatMap((e) => e.refs ?? []);
  const thrown = extras.effects.filter((e) => e.type === "throw");
  extras.rolls = [
    ...borrowed,
    ...(node?.fields?.rolls?.length
      ? node.fields.rolls
      : thrown.map((t, i) => ({
          key: t.key || `throw${i + 1}`,
          label: t.forWhat || "",
          formula: t.roll || "1d20",
          rollType: t.rollType || "above",
          target: t.value ?? { kind: "flat", flat: 0 },
          scale: t.value?.on || "level",
          condition: t.condition || "",
        }))),
  ];

  return {
    name: entry.name,
    type: "ability",
    img: abilityIcon(entry),
    system: {
      description: entryText(node, id, cite),
      proficiencytype: meta.general ? "general" : "class",
      // `requirements` is plain descriptive text with no second store behind
      // it, so it still lands on the core field the sheet already shows.
      ...(gate.length ? { requirements: gate.map(capabilityLabel).join(", ").slice(0, 120) } : {}),
    },
    flags: {
      [MODULE_ID]: { cookbook: { id, cite }, minted: true, extras },
    },
  };
}

/**
 * The extras subkeys bindAbility emits only when the definition carries them —
 * the conditional spreads above, kept in one list because an UPDATE must
 * retract them: update() merges nested objects and never deletes an absent
 * key, so a rebuild that no longer emits one of these (an entry un-deprecated,
 * a prerequisite dropped) has to say so with an explicit `-=` deletion or the
 * stale value survives every later run.
 */
const ABILITY_EXTRAS_OPTIONAL = [
  "replacedBy",
  "powerValue",
  "requires",
  "aliasOf",
  "provides",
  "conversionStatus",
  "conversionFrom",
  "defenses",
];

/**
 * Items are filed by CONTENT TYPE, not by book: a proficiency spans every book
 * that prints it, and the whole point of the shared ability item is that one
 * copy serves every actor. `id` picks the shelf ("def.prof.x" -> Proficiencies).
 */
const ITEM_SHELF = {
  "def.prof": "Proficiencies",
  "def.power": "Class Powers",
  // Beastman drawbacks are `kind.power` items but carry their own id namespace
  // (reclassified off `def.power` in the content audit). Without this line they
  // fall through itemShelfFor to the pack's top level, unsorted — so give them
  // their own shelf beside Class Powers.
  "def.drawback": "Drawbacks",
  "def.skill": "Skills",
  "def.language": "Languages",
  "def.class": "Classes",
  "def.equip": "Equipment",
  "def.weapon": "Weapons",
  "def.armor": "Armor",
  "def.trap": "Traps",
  "def.variation": "Variations",
  // The price list's own rows — see importPriceList for why they cannot join
  // the described entries' group shelves.
  "def.priced": "Equipment",
  // Races are `acks-extras.race` items the class builder binds, not abilities.
  "def.race": "Races",
};

/**
 * Sub-shelf a whole NAMESPACE takes, where the shelf alone would be the wrong
 * bucket. Read before the entry's own group, because a priced row has no entry
 * to ask.
 */
const SHELF_SUB = { "def.priced": "Price List" };

const shelfKeyOf = (id) => String(id ?? "").split(".").slice(0, 2).join(".");
const itemShelfFor = (id) => {
  const key = shelfKeyOf(id);
  const shelf = ITEM_SHELF[key] ?? null;
  // An unmapped namespace used to land silently at the top level, which is how
  // 178 priced, race and conversion-constant items came to sit loose above the
  // shelves. It is a missing ITEM_SHELF row every time, so say which one.
  if (!shelf && key) console.warn(`${MODULE_ID} | no item shelf for id namespace "${key}" — filing at the top level.`);
  return shelf;
};

/**
 * Sub-shelves under a top shelf, from the entry's own `meta.group`.
 *
 * The equipment chapter is not one list: 147 entries span carried gear,
 * clothing, animals, structures and vehicles, and a single "Equipment" folder
 * reproduces the flat pile one level down. The register already records which
 * group each entry belongs to, so the shelf just reads it — no new data, and a
 * group nobody declared simply lands on the top shelf.
 *
 * Titles are display strings for a folder, not book values.
 */
const GROUP_SHELF = {
  gear: "Adventuring Gear",
  shield: "Shields",
  clothing: "Clothing",
  animal: "Animals",
  provisions: "Provisions",
  lodging: "Lodging",
  structure: "Structures",
  vehicle: "Vehicles",
};

/**
 * Alphabet bands for a shelf whose SOURCE is a flat alphabetical dictionary —
 * the JJ class-powers list declares no taxonomy at all, and 316 entries in one
 * folder is unbrowsable. Bands mirror how the book itself is read (a dictionary
 * is looked up by letter), inventing nothing.
 */
const LETTER_BANDS = [["A", "D"], ["E", "H"], ["I", "L"], ["M", "P"], ["Q", "T"], ["U", "Z"]];
const letterBand = (name) => {
  const c = String(name ?? "").trim().charAt(0).toUpperCase();
  const band = LETTER_BANDS.find(([a, z]) => c >= a && c <= z);
  return band ? `${band[0]}–${band[1]}` : null;
};

/** THE one destination rule for a cookbook ITEM: shelf → sub-shelf. */
function itemShelfPath(id) {
  const shelf = itemShelfFor(id);
  if (!shelf) return [];
  // A namespace that takes a fixed sub-shelf is answered before the entry,
  // because the rows that need it (the price list) have no entry to ask.
  const fixed = SHELF_SUB[shelfKeyOf(id)];
  if (fixed) return [shelf, fixed];
  const entry = cookbookEntry(id)?.entry;
  // Proficiencies: the RR's OWN split — every proficiency is printed on the
  // General list, the Class lists, or is one of the combat picks (weapon/
  // armour/fighting-style). Authored data (`meta.general` + the kind), not
  // a guess.
  if (shelf === "Proficiencies") {
    const sub =
      entry?.kind === "kind.combatProficiency" ? "Combat"
      : entry?.meta?.general === true ? "General"
      : entry?.meta?.general === false ? "Class"
      : null;
    return [shelf, sub];
  }
  // Class powers: no authored grouping exists (see letterBand) — file by letter.
  if (shelf === "Class Powers") return [shelf, letterBand(entry?.name ?? "")];
  return [shelf, GROUP_SHELF[entry?.meta?.group] ?? null];
}

/**
 * The folder a definition id's item files under, created on demand.
 *
 * Every item importer asks this and none builds its own path — a second
 * path-builder is a second opinion about where a document belongs, and the
 * price list proved what that costs: its importer filed 172 rows under
 * "Equipment / Price List" while this function said the top level, so whichever
 * ran last won.
 *
 * The shelf comes from the id's first two segments alone, so callers whose ids
 * have no register entry (languages, read from the seat's own book) still land
 * on their shelf.
 */
export async function ensureItemFolder(id = null) {
  return ensureFolderPath("Item", itemShelfPath(id));
}

/** Create every item shelf (and equipment sub-shelf) before parallel imports. */
async function prepareItemShelves() {
  for (const shelf of new Set(Object.values(ITEM_SHELF))) await ensureFolderPath("Item", [shelf]);
  // Only groups the shipped cookbook actually uses — never the whole table, so
  // an empty folder is never created for content this world does not have.
  const groups = new Set();
  for (const id of cookbookEquipmentIds()) {
    const entry = cookbookEntry(id)?.entry;
    // Animals file under Actors when ACKS Extras is present, so their item shelf
    // would stand empty — the one thing this loop exists to avoid.
    if (isAnimalEntry(entry) && canImportAnimals()) continue;
    const g = entry?.meta?.group;
    if (GROUP_SHELF[g]) groups.add(GROUP_SHELF[g]);
  }
  for (const g of groups) await ensureFolderPath("Item", [ITEM_SHELF["def.equip"], g]);
}

/**
 * PARSE every recipe against the connected books and report which ones fail.
 *
 * Writes nothing. A recipe is a set of page coordinates and probes, and the only
 * thing that decides whether it still matches is the printing in front of it —
 * so the question "does this recipe work?" has to be answerable WITHOUT the
 * import that would act on the answer. Before this, a broken recipe surfaced as
 * one warning in a run of hundreds, or as a document that quietly imported with
 * an empty description.
 *
 * Each entry is executed independently: one failure never stops the pass, and
 * every entry gets a row. `ok: false` is the recipe's own name-anchor check
 * failing — the printing moved, or the coordinates were never right for this
 * edition — and `misses` names the fields that threw underneath.
 *
 * The pass shares ONE page cache per book across every entry, which is what
 * makes a whole-corpus audit affordable: the shipped abilities average 5.5
 * entries per page.
 *
 * @param {object} [options]
 * @param {string[]} [options.ids] audit only these entry ids
 * @param {string[]} [options.books] audit only entries from these book ids
 * @param {string[]} [options.kinds] audit only these entry kinds
 * @param {boolean} [options.art] decode page artwork too (default false).
 *   An audit asks whether a recipe still matches the PRINTING, which is a text
 *   question; the `art` op decodes a page's placed images and costs SECONDS
 *   where the rest of a recipe costs milliseconds — measured on the Monstrous
 *   Manual at 1.8s for one creature and 15s for another, against 7ms for a
 *   proficiency. Leave it off unless the artwork itself is what is in doubt.
 * @returns {Promise<{rows: object[], summary: object}>} every row, and the tally
 */
let lastAuditRows = [];

/** Rows the running (or last finished) audit has produced so far. */
export const lastAudit = () => {
  const tally = (k) => lastAuditRows.filter((r) => r.status === k).length;
  return {
    done: lastAuditRows.length,
    ok: tally("ok"),
    noMatch: tally("no-match"),
    threw: tally("threw"),
    noBook: tally("no-book"),
    okButEmpty: lastAuditRows.filter((r) => r.empty).length,
    failing: lastAuditRows
      .filter((r) => r.status === "no-match" || r.status === "threw" || r.empty)
      .map((r) => ({ id: r.id, name: r.name, book: r.book, page: r.page, status: r.status, empty: r.empty, reason: r.reason })),
    slowest: [...lastAuditRows].sort((a, b) => b.ms - a.ms).slice(0, 10).map((r) => ({ id: r.id, kind: r.kind, ms: r.ms })),
  };
};

export async function cookbookAudit({ ids = null, books = null, kinds = null, art = false } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const wanted = ids ? new Set(ids) : null;
  const entries = [];
  for (const source of [data.books, data.content]) {
    for (const cb of source.values()) {
      for (const [id, entry] of Object.entries(cb.entries ?? {})) {
        if (wanted && !wanted.has(id)) continue;
        if (kinds && !kinds.includes(entry.kind)) continue;
        const book = entry.book ?? cb.book?.id ?? (typeof cb.book === "string" ? cb.book : null);
        if (books && !books.includes(book)) continue;
        entries.push({ id, entry, cb, book });
      }
    }
  }
  if (!entries.length) {
    ui.notifications?.warn(`${MODULE_ID} | audit: nothing matched.`);
    return { rows: [], summary: { total: 0 } };
  }

  const pageCache = runPageCache();
  const artCache = runPageCache();
  const rows = [];
  // Published as it goes, not at the end. A whole-corpus pass takes tens of
  // minutes — monster recipes carry art extraction and cost orders more than a
  // proficiency — and a pass that reveals nothing until it returns cannot be
  // watched, cut short, or reported on. `acksExtras.importer.lastAudit()` reads it live.
  lastAuditRows = rows;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAudit`), entries.length);
  try {
    for (const { id, entry, cb, book } of entries) {
      const session = ctx.sessionDocs.get(book);
      const base = { id, name: entry.name, kind: entry.kind, book, page: entry.pages?.[0] ?? null, cite: entry.cite };
      if (!session) {
        rows.push({ ...base, status: "no-book", ms: 0 });
        bar.step(entry.name ?? id);
        continue;
      }
      const t0 = performance.now();
      let node = null;
      let threw = null;
      try {
        node = await executeEntry(session.doc, cb, data.registers, id, {
          pageCache: pageCache(book),
          artCache: artCache(book),
          ...(art ? {} : { skipOps: ["art"] }),
        });
      } catch (err) {
        threw = String(err?.message ?? err);
      }
      rows.push({
        ...base,
        status: threw ? "threw" : node?.ok ? "ok" : "no-match",
        ms: Math.round(performance.now() - t0),
        reason: threw ?? node?.reason ?? null,
        // Two shapes reach `misses`: a FIELD that threw or matched nothing, and
        // a register TOKEN the lookup tables do not know. The second carries no
        // field and is the more actionable of the two — it names a printed word
        // the register has no row for, which is register data to add rather
        // than page geometry to re-measure.
        misses: (node?.misses ?? []).map((m) =>
          m.table ? `register ${m.table}: unknown token "${m.token}"` : `${m.field}: ${m.error ?? "no result"}`,
        ),
        // A recipe can pass its name anchor and still bring back nothing to
        // say — but only counts as empty if it ASKED for prose. A classMeta
        // passage read for one name, or a table read for its grid, declares no
        // description field and is not a defect for lacking one.
        empty:
          !threw &&
          !!node?.ok &&
          !!entry.fields?.description &&
          !(node.fields?.description?.length > 0),
      });
      bar.step(entry.name ?? id);
    }
  } finally {
    bar.finish();
  }

  const tally = (k) => rows.filter((r) => r.status === k).length;
  const summary = {
    total: rows.length,
    ok: tally("ok"),
    noMatch: tally("no-match"),
    threw: tally("threw"),
    noBook: tally("no-book"),
    okButEmpty: rows.filter((r) => r.empty).length,
    withMisses: rows.filter((r) => r.misses?.length).length,
    totalMs: rows.reduce((n, r) => n + r.ms, 0),
  };
  const failing = rows.filter((r) => r.status === "no-match" || r.status === "threw" || r.empty);
  console.log(`${MODULE_ID} | recipe audit`, summary);
  if (failing.length) console.table(failing.map((r) => ({ id: r.id, name: r.name, book: r.book, page: r.page, status: r.status, empty: r.empty, reason: r.reason })));
  ui.notifications.info(
    `${MODULE_ID} | audit: ${summary.ok}/${summary.total} parsed` +
      `${summary.noMatch ? `, ${summary.noMatch} did not match` : ""}` +
      `${summary.threw ? `, ${summary.threw} threw` : ""}` +
      `${summary.okButEmpty ? `, ${summary.okButEmpty} matched but read nothing` : ""}` +
      `${summary.noBook ? `, ${summary.noBook} unreadable (book not connected)` : ""}. Details in console.`,
  );
  return { rows, summary };
}

/* -------------------------------------------- */
/*  Same name, two books                        */
/* -------------------------------------------- */

/**
 * Library documents keyed by every printed form of their name.
 *
 * Cached for the session beside `importedIndex`, and dropped by the same
 * `forgetImportedIndex`, because it answers the same kind of question about the
 * same shelf. Rebuilt lazily; `rememberName` keeps it true as documents arrive
 * so a run that imports two books never has to rebuild it mid-way.
 */
let nameIndexCache = null;
async function libraryNameIndex() {
  if (nameIndexCache) return nameIndexCache;
  const map = new Map();
  for (const doc of await importedDocs("Item")) {
    if (doc.flags?.[MODULE_ID]?.templatePart) continue; // a class's copy, not a definition
    for (const k of nameKeys(printedName(doc))) {
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(doc);
    }
  }
  nameIndexCache = map;
  return map;
}

/** Teach the name index about a document, so the next import sees it. */
function rememberName(doc) {
  if (!nameIndexCache || !doc?.name) return doc;
  if (doc.flags?.[MODULE_ID]?.templatePart) return doc;
  for (const k of nameKeys(printedName(doc))) {
    if (!nameIndexCache.has(k)) nameIndexCache.set(k, []);
    if (!nameIndexCache.get(k).includes(doc)) nameIndexCache.get(k).push(doc);
  }
  return doc;
}

/**
 * Book precedence — the order `BOOKS` declares, core first.
 *
 * When two books print the same thing, the earlier-declared one is the copy the
 * library keeps. That order is authored (Revised Rulebook, Judges Journal, By
 * This Axe, Monstrous Manual, …) and is read here rather than restated, so a
 * new book takes its precedence from where it is added.
 */
const bookRank = (bookId) => {
  const i = Object.keys(BOOKS).indexOf(bookId);
  return i < 0 ? Number.MAX_SAFE_INTEGER : i;
};

/**
 * Does the document the library holds already say everything this import would?
 *
 * Two entries printed in two books are the same item when nothing but their
 * source differs. Provenance has to come out of the comparison or nothing ever
 * matches — the description is the entry's own text, closing on its citation.
 *
 * DIRECTIONAL, and that is the whole trick. A live document's `system` is a
 * data model carrying every field the schema declares, defaults included, while
 * creation data carries only what the binding set. Comparing the two whole
 * never matches, which is how two identical printings of Laborer's Tools were
 * declared different and tagged instead of merged. So only the keys the INCOMING
 * sets are checked, against what the existing document holds for them.
 */
function sameMaterial(existing, data) {
  if ((existing?.type ?? null) !== (data?.type ?? null)) return false;
  for (const [key, value] of Object.entries(data?.system ?? {})) {
    if (key === "description") continue;
    const held = foundry.utils.getProperty(existing.system ?? {}, key);
    if (JSON.stringify(held ?? null) !== JSON.stringify(value ?? null)) return false;
  }
  return true;
}

/**
 * The name a document was PRINTED under, before any book tag was added.
 *
 * Tagging rewrites the name ("Boots" becomes "Boots (RR)"), and a rewritten
 * name no longer collides with the other book's — so a second run would find no
 * collision, reconsider nothing, and a pair tagged by an older build could never
 * later be merged. The printed name is kept on the flag and is what collisions
 * are judged on, so the answer does not depend on how many times this has run.
 */
const printedName = (doc) => doc.getFlag(MODULE_ID, "cookbook")?.printed ?? doc.name;

/**
 * Reconcile a document about to be imported against one the library already
 * holds under the same printed name.
 *
 * THE RULE: two imports sharing a name are one document unless they differ
 * beyond their source. Identical-but-for-provenance means merge — the
 * higher-precedence book's copy is the one kept, and the loser's id is recorded
 * on it so every later lookup, in any order, lands on the same document.
 * Genuinely different means keep both, TAGGED, so a reader can tell which book
 * each came from instead of finding two rows called "Boots".
 *
 * Merging by recording the id (rather than silently not importing) is what
 * makes this idempotent: a merged-away id still resolves, so a second run finds
 * the document rather than minting the twin again.
 *
 * @returns {Promise<{skip: true, doc: object} | {skip: false, name?: string}>}
 *   `skip` when the library already answers for this entry; otherwise the name
 *   to create it under, which is the printed one unless a tag was needed.
 */
async function reconcileByName(data, id, bookId) {
  if (!data?.name) return { skip: false };
  const keys = nameKeys(data.name);
  if (!keys.size) return { skip: false };

  // Asked once per document being imported, so it reads an INDEX rather than
  // the library: loading every pack document per item made the equipment import
  // quadratic all over again, in the check meant to keep it clean.
  const index = await libraryNameIndex();
  const candidates = new Set();
  for (const k of keys) for (const doc of index.get(k) ?? []) candidates.add(doc);

  for (const other of candidates) {
    const otherId = other.getFlag(MODULE_ID, "cookbook")?.id;
    if (!otherId || otherId === id) continue;

    const otherBook = other.getFlag(MODULE_ID, "cookbook")?.book ?? bookOf(cookbookEntry(otherId));
    // Never across LINES. Everything below is a claim that two BOOKS printed
    // one thing — merge the reprint, or tag both so a reader can tell them
    // apart. Two GAMES printing "Rope" is neither: merging rewrites the name,
    // system and identity of somebody's OSE import in favour of the ACKS entry
    // (which always outranks it, whether its book is unranked or merely
    // declared later), and tagging would label it as an edition of a book it
    // has nothing to do with.
    if (lineOf(bookOfCookbookId(otherId, otherBook)) !== lineOf(bookOfCookbookId(id, bookId))) continue;
    if (sameMaterial(other, data)) {
      // The same item, printed twice. Keep the higher-precedence copy and teach
      // it this id; if THIS book outranks the one already imported, the kept
      // document takes this entry's name and content instead.
      const incomingWins = bookRank(bookId) < bookRank(otherBook);
      const merged = new Set([...(other.getFlag(MODULE_ID, "cookbook")?.merged ?? []), incomingWins ? otherId : id]);
      await other.update({
        ...(incomingWins ? { name: data.name, system: data.system } : {}),
        [`flags.${MODULE_ID}.cookbook.merged`]: [...merged],
        ...(incomingWins ? { [`flags.${MODULE_ID}.cookbook.id`]: id, [`flags.${MODULE_ID}.cookbook.book`]: bookId } : {}),
      });
      rememberImported(id, other);
      return { skip: true, doc: other };
    }

    // Different things that share a name. Both are kept and both are tagged,
    // because tagging only the newcomer leaves the reader guessing which book
    // the untagged one came from.
    const tag = (b) => BOOKS[b]?.short ?? b;
    if (otherBook && bookId && otherBook !== bookId) {
      const otherPrinted = printedName(other);
      if (!other.name.endsWith(`(${tag(otherBook)})`)) {
        await other.update({
          name: `${otherPrinted} (${tag(otherBook)})`,
          [`flags.${MODULE_ID}.cookbook.printed`]: otherPrinted,
        });
      }
      return { skip: false, name: `${data.name} (${tag(bookId)})`, printed: data.name };
    }
    return { skip: false }; // same book, same name: distinct entries the book itself separates
  }
  return { skip: false };
}

/**
 * One page cache per BOOK, living exactly as long as one bulk run.
 *
 * `executeEntry` caches pages for the duration of a single call, which is the
 * right lifetime for a single entry and the wrong one for a corpus: the shipped
 * abilities put a mean of 5.5 entries on each page and as many as 19 on one, so
 * a per-entry cache re-extracts the same page for every entry printed on it.
 * Measured on the Judges Journal's p.322 dictionary spread: 19 entries, 15.8s,
 * a flat ~833ms each — the cost of `getTextContent()`, paid nineteen times for
 * one page. Across the ability corpus that is 579 page reads for 105 distinct
 * pages, 82% of them redundant.
 *
 * Keyed by book because a page number means nothing without one, and handed out
 * as a function so a caller threads ONE object through a whole run and drops it
 * at the end. Nothing here outlives the run: a session-long cache would hold
 * every page of every opened book for as long as the world is up, which is the
 * memory the per-call cache was avoiding.
 *
 * @returns a `(bookId) => Map` to pass as `executeEntry`'s `opts.pageCache`
 */
function runPageCache() {
  const perBook = new Map();
  return (bookId) => {
    if (!perBook.has(bookId)) perBook.set(bookId, new Map());
    return perBook.get(bookId);
  };
}

/**
 * Build — or REUSE — the shared ability item for a definition id. Deduped by
 * cookbook id, so every monster/NPC referencing a proficiency links to the SAME
 * item instead of minting a per-actor copy. Works bookless: without the citing
 * book the item still imports with its structure and its citation.
 */
export async function importAbility(id, folderId, { pageCache = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return null;
  // NOTE an alias gets its OWN item. The books list a name whose rules text is
  // printed under another entry; that makes it a distinct ability sharing a
  // passage, not a synonym to redirect away. Its recipe already carries a
  // pointer to where that text lives, so it extracts and classifies normally —
  // it just does not stack with the entry it points at.
  return claimImport(id, async () => {
    const built = await abilityData(id, { folderId, pageCache });
    return built ? createDoc(Item, built) : null;
  });
}

/**
 * Everything an ability import does EXCEPT the write.
 *
 * Split out because the write is the expensive half and only batching makes it
 * cheap (see `createDocs`): a bulk run builds every document first and then
 * writes them a chunk at a time, which it cannot do while building and writing
 * are one call. Building is pure-ish and fast — a definition parses in about
 * 7ms — so a whole corpus can be built before anything is written.
 *
 * Returns creation data with its folder already resolved, or null when the
 * entry is unknown.
 */
async function abilityData(id, { folderId = null, pageCache = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return null;
  const bookId = bookOf(found);
  const session = ctx.sessionDocs.get(bookId);
  let node = null;
  if (session) {
    node = await executeEntry(session.doc, found.cb, data.registers, id, pageCache ? { pageCache: pageCache(bookId) } : {});
    if (!node.ok) node = null;
  }
  const folder = folderId ?? (await ensureItemFolder(id))?.id ?? null;
  const ladders = await laddersForEntry(found.entry, { pageCache: pageCache ? pageCache(bookId) : null });
  const doc = bindAbility(found.entry, node, id, ladders ? { ladders } : {});
  const extras = doc.flags[MODULE_ID].extras;
  extras.effects = await resolveCompanions(extras.effects);
  return { ...doc, folder };
}

/**
 * Definition kinds that do NOT bind to an `ability` item.
 *
 * A content-type cookbook is not automatically an ABILITY cookbook: equipment
 * binds to a core inventory item. Every ability path walks the content
 * cookbooks generically, so a new non-ability kind silently joins the ability
 * import unless it is excluded here — which is exactly what shipped in
 * v0.26.0 and produced `category: equipment is not a valid choice` when the
 * ability sheet tried to validate items that should never have been abilities.
 */
const NON_ABILITY_KINDS = new Set([
  "kind.equipment",
  "kind.class",
  "kind.classMeta",
  "kind.powerAppend",
  "kind.trap",
  "kind.variation",
  "kind.vehicle",
  // A conversion constant is a NUMBER the converter is handed at run time
  // (readScgConstants), never a document. Missing from this list it joined the
  // generic ability walk and minted four `ability` items nothing reads — the
  // silent join this list exists to prevent, one kind later.
  "kind.constant",
]);

/** Does this entry bind to an `ability` item? */
export const isAbilityEntry = (entry) => !NON_ABILITY_KINDS.has(entry?.kind);

/* -------------------------------------------- */
/*  Classes (kind.class → acks-extras.class)    */
/* -------------------------------------------- */

/** The class Item sub-type — the classes feature's own constant. */
const CLASS_ITEM_TYPE = CLASS_TYPE;

/* The book prints WIL where the system's score key is wis. */
// WIL is the ACKS II print vocabulary; BTA (and classic sources) print WIS.
const ATTR_KEY = { STR: "str", INT: "int", WIL: "wis", WIS: "wis", DEX: "dex", CON: "con", CHA: "cha" };

/** "Key Attribute:.............STR" → "STR" (label and dot leaders off). */
const stripBullet = (s) => String(s ?? "").replace(/^[^:]*:/, "").replace(/^[.\s]+/, "").trim();

/** Small-caps extraction lowercases a leading cap ("overlord") — restore it. */
const capFirst = (s) => {
  const t = String(s ?? "").trim();
  return t ? t[0].toUpperCase() + t.slice(1) : "";
};

/** Split a printed list on commas that are not inside parentheses. */
const splitList = (s) =>
  String(s ?? "")
    .split(/,(?![^(]*\))/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

/**
 * Can a printed name-list on a class spread award this entry?
 *
 * A class's Proficiency List and a template's Proficiencies cell name
 * proficiencies, skills and powers. They never name a LANGUAGE — the taxonomy
 * is its own tree — so languages stay out of both tokenizers. Being in them
 * only gives short common words ("Orc", "Ithean", "Draconic") a chance to claim
 * the head of a cell that belongs to something else, which the greedy
 * longest-first match cannot undo.
 */
const isAwardableByName = (entry) => !NON_ABILITY_KINDS.has(entry?.kind) && entry?.kind !== "kind.language";

/**
 * Every printed SURFACE a class list or template cell can name, resolved once.
 *
 * A definition is printed under more than one surface: its own name, plus any
 * authored `aliases` recording a second form the books use for the same thing.
 * Both the list path and the cell path read this ONE index, because they used
 * to read two that disagreed — a length-sorted menu whose ties fell to cookbook
 * load order, and a flat last-wins map — so twenty printed names, "Acrobatics"
 * and "Climbing" among them, resolved to a class POWER on one path and the
 * PROFICIENCY on the other. A cell then granted a power the character was not
 * owed AND, because `ownsRef` matches on type and name, silently refused them
 * the proficiency ever after.
 *
 * Collisions are arbitrated by `byCategory` — the same ranking the monster
 * path uses, which prefers a proficiency to a same-named power. The world's
 * holdings are deliberately NOT consulted here: `preferredId` would hand a
 * single world-held candidate the answer outright, so a world holding the
 * powers but not the proficiency list would bind a class's printed "Alertness"
 * to the power. What a class's spread means is a fact about the book, not
 * about what has been imported yet.
 *
 * @returns {{byKey: Map<string, {ref: string, name: string, ambiguous: boolean}>,
 *           menu: Array<{surface: string, name: string, ref: string, alias: boolean}>}}
 *   `byKey` is keyed by folded surface; `menu` is ordered longest SURFACE first
 *   (never longest name — a three-letter alias must not sort as if it were the
 *   sixteen-letter entry it belongs to).
 */
export function abilitySurfaceIndex(entries = null) {
  const candidates = new Map(); // folded surface -> {ids:Set, name, alias}
  // Defaults to every content cookbook; takes an explicit [id, entry] list so
  // the invariant can be tested without a compiled cookbook behind it.
  const source = entries ?? (function* () {
    for (const cb of data.content.values()) yield* Object.entries(cb.entries ?? {});
  })();
  for (const [defId, e] of source) {
    if (!isAwardableByName(e)) continue;
    const surfaces = [e.name, ...(e.aliases ?? [])];
    surfaces.forEach((surface, i) => {
      const key = nameKey(surface);
      if (!key) return;
      const held = candidates.get(key) ?? { ids: new Set(), name: e.name, surface, alias: i > 0 };
      held.ids.add(defId);
      candidates.set(key, held);
    });
  }
  const byKey = new Map();
  const menu = [];
  for (const [key, held] of candidates) {
    const ids = [...held.ids];
    const ref = ids.length === 1 ? ids[0] : byCategory(ids);
    byKey.set(key, { ref, name: held.name, ambiguous: ids.length > 1 });
    menu.push({ surface: held.surface, name: held.name, ref, alias: held.alias });
  }
  menu.sort((a, b) => b.surface.length - a.surface.length);
  return { byKey, menu };
}

/** One printed name as a regex literal. */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * A lenient matcher for one printed surface: letters with elastic spacing,
 * because real extraction welds words together.
 *
 * An ALIAS is a truncation the books print with a period after it ("Fighting
 * Style Spec."), so it must not be allowed to claim the head of the longer
 * word it abbreviates — "Spec" may not match "Specialization" — and it must
 * consume the period, or the selection that follows is never seen and the
 * whole style is discarded as unmatched residue.
 */
const lenientRe = (surface, { alias = false } = {}) =>
  new RegExp(
    "^" + String(surface).trim().split(/\s+/).map(escapeRe).join("\\s*") + (alias ? "(?![a-z])\\.?" : ""),
    "i",
  );

/**
 * Tokenize a template's Proficiencies cell: greedy longest-known-name match,
 * then an optional rank digit and an optional parenthesized selection.
 * "Fighting Style Spec. (weapon & shield)Siege Engineering" →
 * two entries. Text that matches nothing is skipped a glyph at a time and
 * accumulated on the preceding entry, where it is dropped on the way out —
 * the cell keeps only what resolved.
 */
export function tokenizeProfs(cellText, menu) {
  const out = [];
  let rest = String(cellText ?? "").replace(/\s+/g, " ").trim();
  let guard = 40;
  while (rest && guard-- > 0) {
    let hit = null;
    for (const m of menu) {
      const match = lenientRe(m.surface, { alias: m.alias }).exec(rest);
      if (match) {
        hit = { ...m, len: match[0].length };
        break;
      }
    }
    if (!hit) {
      // Skip one glyph and keep scanning; the skipped prefix is preserved.
      const stray = rest[0];
      rest = rest.slice(1);
      if (out.length && stray.trim()) out[out.length - 1].tail = (out[out.length - 1].tail ?? "") + stray;
      continue;
    }
    rest = rest.slice(hit.len).trim();
    // The rank sits on EITHER side of the selection: the spreads print
    // "Craft (armor-making) 3" and "Alertness 2" alike, so a reader that only
    // looked before the parenthesis brought every selected entry in at rank 1.
    const takeRank = () => {
      const m = /^(\d)\b/.exec(rest);
      if (!m) return null;
      rest = rest.slice(m[0].length).trim();
      return parseInt(m[1], 10);
    };
    let rank = takeRank();
    const sel = /^\(([^)]*)\)/.exec(rest);
    if (sel) rest = rest.slice(sel[0].length).trim();
    if (rank == null && sel) rank = takeRank();
    out.push({
      ref: hit.ref,
      name: hit.name,
      rank: rank ?? 1,
      selection: sel ? sel[1].replace(/\s+/g, " ").trim() : "",
    });
  }
  return out.map(({ tail, ...e }) => e);
}

/** One menu row: the printed name, the id it points at, and both folds. Each
 *  row also folds its PAREN-STRIPPED name — "Spell Book (Blank)" is the base an
 *  "iron-shod spellbook" is an instance of, and only the stripped fold sees it. */
/**
 * Every way this catalogue prints ONE name.
 *
 * Two conventions, and they are conventions rather than exceptions — the price
 * list uses them throughout, so they are read by rule and not authored per
 * entry.
 *
 * **Head first, qualifier after the comma.** The list writes "Rations, Iron",
 * "Rope, 50’", "Sack, Small", "Horse, Medium riding", "Saddle and tack,
 * Riding"; a template's cell writes the same things as English — "1 week’s
 * iron rations", "50’ rope", "small sack". Rotating the commas back gives the
 * form the cell actually contains. Without it the two halves of the catalogue
 * could never meet, and they did not: 250-odd printed descriptors matched
 * nothing because of this alone.
 *
 * **A slash names one thing twice.** "Sandals/Shoes", "Waterskin/Wineskin",
 * "Pouch/purse", "Belt/Sash, Leather" — one printed row, either word, and a
 * cell picks whichever it likes.
 *
 * The HEAD alone is deliberately not a form: "Sandals/Shoes, Leather, High"
 * must not answer for a bare "sandals", which is the described entry's own
 * name and already in the menu.
 */
export function nameForms(name) {
  const raw = String(name ?? "").trim();
  if (!raw) return [];
  const out = [];
  const add = (text) => {
    const t = String(text).replace(/\s+/g, " ").trim();
    if (t && !out.includes(t)) out.push(t);
  };
  const segments = raw.split(",").map((x) => x.trim()).filter(Boolean);
  const ordered = [raw];
  if (segments.length > 1) ordered.push([...segments].reverse().join(" "));
  for (const form of ordered) {
    const slashed = form.split(/\s+/).map((w) => w.split("/"));
    // One name per slash choice; a form with no slash yields exactly itself.
    let combos = [[]];
    for (const options of slashed) {
      combos = combos.flatMap((prefix) => options.map((o) => [...prefix, o]));
      if (combos.length > 8) break; // no catalogue name is this ambiguous
    }
    for (const c of combos) add(c.join(" "));
  }
  return out;
}

/** One menu row: the printed name, the id it points at, and the folded forms
 *  the descriptor may contain — `forms` from the name as printed, `stripped`
 *  from its paren-free version (an embellished instance contains "spellbook",
 *  never "(blank)"). */
function menuRow(name, ref) {
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const formsOf = (n) => nameForms(n).map((text) => ({ text, fold: fold(text) })).filter((f) => f.fold);
  return {
    name,
    ref,
    fold: fold(name),
    foldStripped: fold(String(name).replace(/\([^)]*\)/g, " ")),
    forms: formsOf(name),
    stripped: formsOf(String(name).replace(/\([^)]*\)/g, " ")),
  };
}

/**
 * The gear a template's Starting Equipment cell can name, longest first.
 *
 * TWO SOURCES, because a reader's gear arrives down two pipelines. The run-in
 * cookbook describes the shop list (`kind.equipment`); weapons, armour and
 * priced rows are materialized from the reader's own GRIDS and mint their own
 * ids (`def.weapon.sword`, `def.armor.plate`, `def.priced.silk-1-lb`), which
 * are not cookbook entries and never will be. A menu built from the cookbook
 * alone therefore cannot see a single weapon: a template naming a sword pointed
 * at nothing, "war hammer" bound to the carpentry Hammer the shop list does
 * carry, and a printed pair of weapons never split because neither half was a
 * known item.
 *
 * `extra` is that second source, read from what this import has already
 * created. Equipment lands before classes (the Getting Started step order), so
 * a class binds after its weapons exist. A cookbook entry wins on a shared id;
 * the grids only fill what the cookbook is silent about.
 */
function equipmentMenu(extra = []) {
  const menu = [];
  const seen = new Set();
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind !== "kind.equipment" || seen.has(defId)) continue;
      seen.add(defId);
      menu.push(menuRow(e.name, defId));
    }
  }
  for (const row of extra) {
    if (!row?.ref || seen.has(row.ref)) continue;
    seen.add(row.ref);
    menu.push(row);
  }
  return menu.sort((a, b) => b.name.length - a.name.length);
}

/** The document types a piece of starting gear can be. */
const GEAR_DOC_TYPES = new Set(["weapon", "armor", "item"]);

/**
 * Menu rows for the gear this world has already materialized. Read from the
 * imported index rather than `game.items`, so a compendium-mode world resolves
 * its templates against the same gear a world-mode one does.
 *
 * A TEMPLATE PART IS NOT AN IMPORT. Extras skins a template's gear by copying
 * the base document, and a copy carries the original's flags — so a world holds
 * a dozen documents stamped `def.weapon.staff`, only one of which is the Staff.
 * Offering "Aged and dusty staff" as the menu's name for that id would make one
 * template's description the catalogue name every other template matches
 * against. Extras publishes the flag naming what a document is part of; a
 * document carrying it is skipped.
 */
async function materializedGearMenu() {
  const rows = [];
  for (const [id, doc] of await importedIndex()) {
    if (!GEAR_DOC_TYPES.has(doc?.type) || !doc?.name) continue;
    if (doc.flags?.[MODULE_ID]?.[TEMPLATE_PART]) continue;
    rows.push(menuRow(doc.name, id));
  }
  return rows;
}

/**
 * Words that cannot, alone, name a piece of gear. A descriptor made only of
 * these is what is left over when something was lifted out of a clause —
 * never an item in its own right.
 */
const FUNCTION_WORD = new Set([
  "a", "an", "and", "the", "of", "or", "plus", "with", "for",
  "further", "total", "another", "more", "additional", "worth", "each", "any", "",
]);

/**
 * Parse a template's Starting Equipment cell into item descriptors, coin and
 * the encumbrance note. Every descriptor resolves against the menu — the
 * equipment cookbook plus the grids a reader has materialized beside it — in
 * each of the forms that catalogue prints its names in (`nameForms`), or
 * through an authored equivalence ("long bearded axe" is a great axe). Each
 * keeps its printed wording as the skin, and its printed price where the cell
 * states one; what resolves to nothing imports as a bare named item, which for
 * the goods these cells price in place is the whole of what the page said.
 *
 * SPLITTING THE CELL IS THIS FUNCTION'S JOB. Deciding what a piece IS is not,
 * and two kinds of piece are not gear at all: a spell recorded in the book it
 * came packed with, and a creature an ability confers. Both are lifted off the
 * item list afterwards, by `liftBookSpells` and `liftCompanions`, which have
 * the ability and spell models to hand where this function has only wording.
 * What survives all three is gear. See ROADMAP.md § Starting equipment.
 */
export function parseEquipment(cellText, menu, aliases = {}) {
  let text = String(cellText ?? "").replace(/\s+/g, " ").trim();
  let enc = "";
  const encMatch = /\(enc\.[^)]*\)\.?\s*$/i.exec(text);
  if (encMatch) {
    enc = encMatch[0].replace(/[().]/g, "").trim();
    text = text.slice(0, encMatch.index).trim().replace(/,\s*$/, "");
  }
  // Printed starting coin. Most templates pay in gold, but a few pay partly or
  // wholly in silver — "1gp, 8sp", "20sp for alms", "65sp" — and a template
  // that prints only silver leaves its character with nothing if only gold is
  // read. A coin amount taken here is REMOVED from the text, so what is left
  // for the item splitter is equipment and nothing else.
  let gp = 0;
  let sp = 0;
  // AN AMOUNT INSIDE BRACKETS PRICES THE ITEM IT FOLLOWS. "(45gp value)" is
  // what a gemstone-tipped staff is worth, not money the character carries;
  // taking it inflated the purse AND cut the item's name off at the bracket,
  // because the lift eats to the next comma. The BRACKET is the test, not the
  // word "value" after the amount — the same tables print "(20gp)" bare, and
  // that spelling was still read as coin: a witch's silver earrings arrived
  // named "silver earrings (" with 20gp added to her purse.
  const bracketed = new Set();
  for (const b of text.matchAll(/\([^)]*\)/g)) {
    for (let i = b.index; i < b.index + b[0].length; i++) bracketed.add(i);
  }
  text = text.replace(/(\d[\d,]*)\s*(gp|sp)\b[^,]*/gi, (m, n, unit, offset) => {
    if (bracketed.has(offset)) return m;
    const amount = parseInt(n.replace(/,/g, ""), 10) || 0;
    if (unit.toLowerCase() === "sp") sp += amount;
    else gp += amount;
    return "";
  });
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  // An authored equivalence is a menu row with one form: it matches on exactly
  // the terms a printed name does, so a four-letter key like "pole" can no more
  // fire from inside "polearm" than the catalogue's own short names can.
  // Longest first, so "long bearded axe" is not answered by "bearded axe".
  // Each value is a ref, or `{ref}` where the register also records WHY.
  const aliasForms = Object.entries(aliases)
    .map(([k, v]) => ({ text: k, fold: fold(k), ref: typeof v === "string" ? v : (v?.ref ?? "") }))
    .filter((a) => a.fold && a.ref)
    .sort((a, b) => b.fold.length - a.fold.length);
  // WHICH known item does this descriptor point at? Deliberately generous: the
  // printed wording is a description ("smooth-worn staff"), not a catalogue
  // name, so a contained name is the usual way a real cell resolves. Six
  // characters is the floor at which bare containment stops being a
  // coincidence. A SHORTER name is still findable, but only as a whole word of
  // the descriptor — "sword" in "polished sword", never "mace" in "grimace" —
  // and a trailing plural is part of that word, because a cell that prints
  // "torches" names the Torch the menu holds. Below four characters nothing is
  // safe enough to match this way at all ("oil", "net", "sap", "hat").
  //
  // ACKS Extras applies the same rule to WORLD documents (`bestBaseMatch` in
  // classes/template-packages.mjs); the two must agree, or a descriptor
  // resolves to one base here and skins itself over another one there.
  const LOOSE_FLOOR = 6;
  const WORD_FLOOR = 4;
  // Seams are `\s*`, never `\s+`: real extraction welds words together.
  const wholeWordIn = (name, descriptor) => {
    const body = String(name).trim().split(/\s+/).map(escapeRe).join("\\s*");
    return body ? new RegExp(`(^|[^a-z0-9])${body}(?:e?s)?([^a-z0-9]|$)`, "i").test(descriptor) : false;
  };
  const contained = (f, form, descriptor, floor = WORD_FLOOR) => {
    if (!form?.fold || !f.includes(form.fold)) return false;
    if (form.fold.length >= LOOSE_FLOOR) return true;
    return form.fold.length >= floor && wholeWordIn(form.text, descriptor);
  };
  // An AUTHORED key may be shorter than an inferred one — "hat" is a chef's
  // statement about a printed word, not a catalogue name a rule went looking
  // for — and the whole-word test still stands between it and "that".
  const AUTHORED_FLOOR = 3;
  // `forms` before `stripped`, so a name that matches as printed is preferred
  // over one that only matches once its bracketed qualifier is dropped. Both
  // fall back to the bare folds, so a hand-built menu still resolves.
  const formsOf = (m) => m.forms ?? [{ text: m.name, fold: m.fold }];
  const strippedOf = (m) => m.stripped ?? [{ text: String(m.name).replace(/\([^)]*\)/g, " "), fold: m.foldStripped }];
  const holds = (forms, f, descriptor) => forms.some((form) => contained(f, form, descriptor));
  const lookup = (descriptor) => {
    const f = fold(descriptor);
    for (const a of aliasForms) {
      if (contained(f, a, descriptor, AUTHORED_FLOOR)) return a.ref;
    }
    const exact = menu.find((m) => formsOf(m).some((form) => form.fold === f));
    return (
      exact?.ref ??
      menu.find((m) => holds(formsOf(m), f, descriptor))?.ref ??
      menu.find((m) => holds(strippedOf(m), f, descriptor))?.ref ??
      ""
    );
  };
  // The catalogue joins a SET's parts with a comma — "Quiver, 20 Arrows",
  // "Case, 20 Bolts" — and a template's cell joins the same parts with "with".
  // Asked a second time without it, the two spellings meet.
  const resolve = (descriptor) => {
    const direct = lookup(descriptor);
    if (direct) return direct;
    const joined = String(descriptor).replace(/\s+with\s+/i, " ");
    return joined === descriptor ? "" : lookup(joined);
  };

  /**
   * Is this descriptor, WHOLE, one item the menu already knows?
   *
   * A different question from `resolve`, and it has to be asked differently.
   * The pair rule below splits "X and Y" only when the whole thing is not
   * already a known item — "tunic and pants" is one printed outfit at one
   * printed price and must stay whole. Asking `resolve` that question let its
   * containment fallback answer yes for the wrong reason: "spear and short
   * sword" CONTAINS "short sword", so the joined string read as an
   * already-known item and the pair never split. The character got one item
   * named for two weapons, and the longer the second weapon's name the more
   * certain it was — the rule only ever fired when both halves happened to fold
   * shorter than six characters.
   *
   * So this matches the whole descriptor and nothing less: an exact menu name
   * (with or without its bracketed qualifier) or an exact alias key.
   */
  const resolveWhole = (descriptor) => {
    const f = fold(descriptor);
    const isWhole = (m) => [...formsOf(m), ...strippedOf(m)].some((form) => form.fold === f);
    return aliasForms.find((a) => a.fold === f)?.ref ?? menu.find(isWhole)?.ref ?? "";
  };
  const items = [];
  const push = (descriptor, note = "") => {
    // Nothing but connective tissue is not a thing. Taking the coin out of a
    // clause removes the amount and what it was for — "and a further 20gp of
    // equipment of the character's choosing" leaves "a further" — and the
    // remainder went on the sheet as an item by that name. Naming the closed
    // set of function words, rather than the one phrase that was reported,
    // catches the same wreckage whatever wording strands it; a real piece of
    // gear always carries a word that is not on this list.
    if (!descriptor || descriptor.split(/\s+/).every((w) => FUNCTION_WORD.has(w.toLowerCase().replace(/[^a-z]/g, "")))) return;
    const qty = parseInt(/^(\d+)\s/.exec(descriptor)?.[1] ?? "1", 10);
    // WHAT THE PAGE SAYS THIS ONE IS WORTH. A bracketed amount is the cell
    // pricing the item in front of the reader — "(20gp value)", "(45gp value)",
    // and the same amount written bare — and it is the only value most of these
    // goods will ever have: the catalogue has no row for a bladedancer's head
    // dress, which is exactly why the cell prices it. Read off the reader's own
    // page like every other imported number, and it OVERRIDES a base's price
    // when there is a base, because the page is talking about this item.
    const priced = /\((\d[\d,]*)\s*gp[^)]*\)/i.exec(descriptor);
    const cost = priced ? parseInt(priced[1].replace(/,/g, ""), 10) : null;
    items.push({
      ref: resolve(descriptor),
      name: descriptor,
      qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
      skinName: "",
      note,
      ...(Number.isFinite(cost) && cost > 0 ? { cost } : {}),
    });
  };
  // SEMICOLONS SEPARATE TOO. A printed equipment cell punctuates the way its
  // author saw fit: some list with commas throughout, others group with commas
  // and separate the groups with semicolons ("spellbook with discern magic and
  // one spell of character's choice; smooth-worn staff, blue robe"). Splitting
  // on the comma alone fused whatever followed a semicolon onto the item before
  // it, and the character started play holding a staff welded to a spell.
  // A semicolon inside brackets is left alone for the same reason a comma is.
  /* --- chunking, and the two clauses that span chunks --------------------- */
  //
  // The separators split a cell into chunks, but two printed constructions are
  // written ACROSS them and have to be put back before anything is read.
  // A FULL STOP CAN BE A SEPARATOR TOO, because a printed cell can carry a
  // typo: one template's list runs "…waterskin. 1 week's iron rations…" where
  // every other one has a comma there, and read as a single descriptor the
  // rations vanished into the waterskin's name. Only a stop followed by the
  // start of another descriptor counts, and never one inside brackets — which
  // is where the abbreviations live ("(enc. 6 2/6 st)").
  const chunks = text
    .split(/[,;](?![^(]*\))|\.(?![^(]*\))(?=\s+[a-z0-9])/i)
    // TRIM FIRST. Every chunk after the first begins with the space that
    // followed its separator, so a leading-"and" strip applied before trimming
    // can only ever match the first chunk — which is the one that never starts
    // with "and". That put "and one spell of character's choice" on the sheet
    // as the name of an item.
    .map((raw) => raw.replace(/\s+/g, " ").trim().replace(/[.]$/, "").trim())
    .filter(Boolean);

  // A BOOK'S CONTENTS ARE AN ENGLISH LIST, and an English list is commas until
  // the last item, which carries the "and". "Bark-bound prayer book with remove
  // fear, angelic choir, and counterspell" is ONE book; split on the comma it
  // became a book and two pieces of gear named for spells, which then went on
  // the character's sheet as inventory. The clause is rejoined from the "…book
  // with" chunk up to and including the chunk that opens with "and" — the list
  // has to actually close that way within a few chunks, or nothing is absorbed
  // and a cell that merely mentions a book is left alone.
  const BOOK_WITH = /\b(?:spell\s*book|spellbook|prayer\s*book|book)\s+with\b/i;
  const LIST_TAIL = /^and\s+/i;
  const LIST_REACH = 4;
  const joined = [];
  for (let i = 0; i < chunks.length; i++) {
    if (BOOK_WITH.test(chunks[i]) && !LIST_TAIL.test(chunks[i])) {
      let end = -1;
      for (let j = i + 1; j <= Math.min(i + LIST_REACH, chunks.length - 1); j++) {
        if (LIST_TAIL.test(chunks[j])) { end = j; break; }
        // A chunk the menu already knows is gear, not another spell title —
        // the list ended at the comma before it and never carried an "and".
        if (resolve(chunks[j])) break;
      }
      if (end > i) {
        joined.push(chunks.slice(i, end + 1).join(", "));
        i = end;
        continue;
      }
    }
    // A STRAY COMMA INSIDE ONE PRINTED NAME. "hunter green cloak, tunic, and
    // pants" is a cloak and an outfit, not a cloak, a tunic and some pants:
    // rejoining is allowed only when the menu knows the two chunks together as
    // one item, so an ordinary list is never welded.
    const prev = joined[joined.length - 1];
    if (prev && LIST_TAIL.test(chunks[i]) && resolveWhole(`${prev} ${chunks[i]}`)) {
      joined[joined.length - 1] = `${prev} ${chunks[i]}`;
      continue;
    }
    joined.push(chunks[i]);
  }

  for (const chunk of joined) {
    const descriptor = chunk.replace(/^and\s+/i, "").trim();
    if (!descriptor) continue;
    // A counted container splits into itself and its contents — "sack with 12
    // iron spikes" is a sack plus twelve spikes, and the count belongs on the
    // spikes where the sheet can spend it. Only a DIGIT after "with" splits;
    // "pouch with herbs" stays one item.
    //
    // UNLESS THE CATALOGUE SELLS THE SET. "Quiver, 20 Arrows" and "Case, 20
    // Bolts" are single priced rows, and the cell writes them "quiver with 20
    // arrows": split, the character got two things the price list has never
    // heard of and the encumbrance was counted twice.
    const container = /^(.+?)\s+with\s+(\d+)\s+(.+)$/i.exec(descriptor);
    if (container && !resolve(descriptor)) {
      push(container[1]);
      push(`${container[2]} ${container[3]}`, `carried in ${container[1].toLowerCase()}`);
      continue;
    }
    // A CLOSING BRACKET CAN END A DESCRIPTOR. One cell prints its holy book and
    // the quill after it with no comma between them — "holy book (the book of
    // the awakening) quill" — and read whole the quill was swallowed by the
    // book's name. The same guard as the pair rule below: it splits only when
    // what follows the bracket is itself a known item, so every "(20gp value)"
    // and "(white bird)" that ends a descriptor is left exactly as printed.
    const bracketed = /^(.*\))\s+(\S.*)$/.exec(descriptor);
    if (bracketed && resolve(bracketed[1]) && resolve(bracketed[2])) {
      push(bracketed[1]);
      push(bracketed[2]);
      continue;
    }
    // A pair splits only when BOTH halves resolve to known equipment —
    // "spear and short sword" is two weapons, while "tunic and pants" (one
    // outfit, one printed price) is a known item WHOLE and stays whole. The
    // whole-descriptor test is `resolveWhole`, never `resolve`: see there.
    //
    // "UNDER" PAIRS THE SAME WAY. The templates dress a character in both at
    // once — "leather armor under blue mage's cassock", "leather armor under
    // white druid's robes" — and read as one descriptor the cassock was lost
    // inside the armour's name: nine characters started play with a garment
    // they are printed as wearing and did not have.
    const pair = /^(.+?)\s+(?:and|under)\s+(.+)$/i.exec(descriptor);
    if (pair && !resolveWhole(descriptor) && resolve(pair[1]) && resolve(pair[2])) {
      push(pair[1]);
      push(pair[2]);
      continue;
    }
    push(descriptor);
  }
  return { items, gp, sp, enc };
}

/**
 * Move a book's printed contents out of its NAME and into the template's spell
 * list. Mutates the matched item (its name is cut back to the book, and the
 * printed sentence is preserved on its note) and returns the spells.
 *
 * A BOOK PRINTS ITS CONTENTS INLINE — "musty old spellbook with beguile
 * humanoid and auditory illusion", "Ancient prayer book with counterspell,
 * predict weather, and cure light injury". The book stays the ITEM, with its
 * embellished name intact; the spells move to where the binder's schema has
 * carried them all along. A divine caster's book is a PRAYER book and prints
 * its spells the same way, so both spellings are read — and only after
 * `parseEquipment` has put the clause back together across the commas of its
 * own list, which is where a prayer book's spells used to be torn off and land
 * on the character as inventory.
 *
 * A CHOICE IS NOT A SPELL — IT IS AN OFFER. "and one spell of character's
 * choice" names a pick the player has still to make; minted as a spell it
 * became a document called "One spell of character's choice". But dropped
 * entirely it was worse: the printed sentence survived only on the item's note,
 * where nothing on the character shows it and the pick is simply never made. So
 * the clause rides as a row that carries no name and IS the offer, which the
 * engine turns into a marker the player answers. The printed sentence stays on
 * the note either way.
 *
 * A DIGIT after "with" is a load, not a library: "quiver with 20 arrows".
 */
export function liftBookSpells(items) {
  const BOOK_CONTENTS = /^(.*?(?:spell\s*book|spellbook|prayer\s*book))\s+with\s+(.+)$/i;
  const CHOICE_PHRASE = /\b(choice|choosing|chooses|any)\b/i;
  const spells = [];
  for (const it of items ?? []) {
    const m = BOOK_CONTENTS.exec(it.name ?? "");
    if (!m || /\d/.test(m[2].split(/\s+/)[0] ?? "")) continue;
    it.name = m[1];
    it.note = it.note ? `${it.note}; holds ${m[2]}` : `holds ${m[2]}`;
    let offered = 0;
    for (const s of m[2].split(/\s*(?:,|\band\b)\s*/i)) {
      const name = capFirst(s.trim());
      if (!name) continue;
      if (!CHOICE_PHRASE.test(name)) {
        spells.push({ uuid: "", name });
        continue;
      }
      // The key is what makes the pick the SAME pick across a re-import and a
      // re-materialize, where the row's position is not stable. Built from the
      // book it came out of and which offer on that book it is.
      offered += 1;
      spells.push({
        uuid: "",
        name: "",
        offer: true,
        choice: { from: "spellList", filter: "any", count: 1, refs: [], label: "", key: `${nameKey(m[1])}:spell:${offered}` },
      });
    }
  }
  return spells;
}

/**
 * A TOTEM ANIMAL IS A CREATURE, NOT A TRINKET.
 *
 * "Rat totem animal", "Black cat familiar" — printed in the Starting Equipment
 * cell, but naming neither gear nor anything the character carries. The ability
 * that confers the creature is granted elsewhere (a class award, or the
 * proficiency column beside this very cell) and it carries an EMPTY companion
 * slot on purpose: WHICH creature it is was never a property of the ability,
 * and `resolveCompanion` leaves the slot open for exactly this reason. The
 * template is the thing that answers the question, so the phrase becomes that
 * ability's SELECTION.
 *
 * Read as gear it was minted as an item with no base, no mechanics and no
 * creature behind it — a rat on the character's equipment list — and, worse,
 * a DUPLICATE: a witch whose proficiency column already printed "Familiar" got
 * the ability and an item named for its cat.
 *
 * The selection lands on the row's existing entry for that ability when it has
 * one and has not already been given a selection by the proficiency column;
 * otherwise the entry is added, carrying the ref. Either way the specialized
 * copy is stamped `grantedFrom` that ref, which is what stops the class's own
 * award of the same ability from granting it a second time.
 *
 * Mutates `items` (the phrase is removed) and `abilities`. Returns how many
 * were lifted.
 */
export function liftCompanions(items, abilities, table) {
  const rows = Object.entries(table ?? {})
    .map(([phrase, v]) => {
      // Seams inside the phrase are `\s*`, for the same reason every other
      // printed phrase's are: real extraction welds words together.
      const body = String(phrase).trim().split(/\s+/).map(escapeRe).join("\\s*");
      return {
        ref: typeof v === "string" ? v : (v?.ref ?? ""),
        re: body ? new RegExp("^(.+?)\\s+" + body + "$", "i") : null,
        length: String(phrase).length,
      };
    })
    .filter((r) => r.ref && r.re)
    .sort((a, b) => b.length - a.length);
  if (!rows.length) return 0;
  let lifted = 0;
  for (let i = (items ?? []).length - 1; i >= 0; i--) {
    const name = String(items[i].name ?? "");
    const hit = rows.map((r) => ({ r, m: r.re.exec(name) })).find((x) => x.m);
    if (!hit) continue;
    const creature = hit.m[1].replace(/\s+/g, " ").trim().toLowerCase();
    if (!creature) continue;
    items.splice(i, 1);
    lifted++;
    const owner = (abilities ?? []).find((a) => a.ref === hit.r.ref);
    if (owner) {
      if (!owner.selection) owner.selection = creature;
    } else {
      abilities.push({ ref: hit.r.ref, name: "", rank: 1, selection: creature });
    }
  }
  return lifted;
}

/** The Proficiencies Gained per Level row for one class, from the executed
 *  classMeta grid: `{l1: "c+ G", …}` keyed by the class's printed name. */
export function classGainsFor(gainsNode, className) {
  const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
  const rows = gainsNode?.fields?.gains?.rows ?? [];
  return rows.find((r) => fold(r.label) === fold(className))?.cells ?? null;
}

/**
 * The same `{l4: "C", l5: "G", …}` cell shape parsed from a spread's own
 * "Proficiency Progression" prose. The RR grid names only RR's classes;
 * another book's class states its schedule in sentences — "select one class
 * proficiency … at 4th and 8th level" — so the levels come out of the
 * reader's text. Extraction joins can drop or add spaces around digits,
 * hence the loose \s* seams.
 */
export function proseGainSchedule(body) {
  const text = String(body ?? "");
  const cells = {};
  const add = (lvl, tag) => {
    if (!Number.isInteger(lvl) || lvl < 1) return;
    const key = `l${lvl}`;
    if (!String(cells[key] ?? "").includes(tag)) cells[key] = cells[key] ? `${cells[key]}+${tag}` : tag;
  };
  // Anchored to the SELECT sentence — plain "at 1st level" also opens damage-
  // ladder sentences ("+1 at 1st level, and an additional +1 at 3rd…").
  const start = /at\s*1\s*st\s*level\s*,?[^.]{0,40}?select\s*one[^.]{0,240}/i.exec(text)?.[0] ?? "";
  if (/one\s*class\s*proficienc/i.test(start)) add(1, "C");
  if (/one\s*general\s*proficienc/i.test(start)) add(1, "G");
  // The level list runs to four entries on the longer classes ("at 3rd, 6th,
  // 9th, and 12th level") — capture the whole span, then read every number.
  const later = /additional\s*(class|general)\s*proficienc\w*\s*at\s*((?:\d+\s*(?:st|nd|rd|th)\s*(?:,|and|\s)*)+)level/gi;
  for (const m of text.matchAll(later)) {
    const tag = m[1].toLowerCase() === "class" ? "C" : "G";
    for (const g of m[2].matchAll(/\d+/g)) add(parseInt(g[0], 10), tag);
  }
  return Object.keys(cells).length ? cells : null;
}

/**
 * Bind one executed class entry to `acks-extras.class` item data. Everything
 * numeric or listed comes from `node` (the reader's own book); with no book
 * the item still imports as a stub the constructor sheet explains.
 * `opts.gains` is this class's Proficiencies-Gained-per-Level row — each C
 * becomes a class-proficiency ChoiceSpec award, each G a general one.
 * `opts.gear` is the grid-materialized half of the equipment menu (see
 * `equipmentMenu`); omitted, a template's cell can name no weapon and no
 * armour, so the caller supplies it.
 */
/**
 * Every dash a page may print in an empty cell. A dash says the character
 * cannot act at that rung at all; every other non-numeric cell says the rung is
 * reached without a throw.
 */
const DASHES = new Set(["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]);

/**
 * A grid keyed on a NAME rather than on a level, as one LADDER per row.
 *
 * The rebuking table is the case: its rows are kinds of undead and its columns
 * are the class's levels. Each row becomes a ladder a throw can name, so every
 * class that reads that table at a fraction of its own level borrows the one
 * published copy instead of re-reading the page.
 *
 * The SCALE is the header row, read from the seat's own page \u2014 which levels the
 * table prints, how many there are, and where it stops are values like any
 * other, and none of them is known here.
 *
 * The CELL RULE is structural and holds no printed letter: a cell that parses
 * as a number is a target, a dash is a rung the character cannot act on, and
 * anything else non-empty is a rung reached without a throw. What the page
 * prints there rides through as `text`, from the reader\u2019s own book \u2014 a rule
 * that knew what the letters meant would be shipping the rule.
 *
 * THE one derivation of these keys, so an ability that names a ladder and the
 * class that publishes it cannot disagree about what it is called.
 */
export function gridLadders(grid, prefix) {
  const scale = new Map();
  for (const [col, cell] of Object.entries(grid?.header ?? {})) {
    const at = intFrom(String(cell ?? ""));
    if (at != null) scale.set(col, at);
  }
  if (!scale.size) return [];
  const out = [];
  for (const row of grid?.rows ?? []) {
    // The label may carry a footnote marker; the marker is about the row, not
    // part of its name.
    const name = String(row.label ?? "").replace(/[*\u2020\u2021\s]+$/, "").trim();
    if (!name) continue;
    const values = [];
    for (const [col, cell] of Object.entries(row.cells ?? {})) {
      const atLevel = scale.get(col);
      if (atLevel == null) continue;
      const text = String(cell ?? "").trim();
      if (!text) continue;
      const value = intFrom(text);
      values.push(
        value != null
          ? { atLevel, value, text: "" }
          : { atLevel, value: null, outcome: DASHES.has(text) ? "none" : "auto", text },
      );
    }
    if (!values.length) continue;
    values.sort((a, b) => a.atLevel - b.atLevel);
    out.push({ key: `${prefix}${name.replace(/[^A-Za-z0-9]/g, "")}`, label: name, values });
  }
  return out;
}

/**
 * The ladders a `fromLadders` spec expands over, read from the class entry that
 * publishes them.
 *
 * Resolved from the COOKBOOK rather than from a document already in the world,
 * so it does not matter whether the class has been imported yet \u2014 and rather
 * than from a run-level channel, because entries are executed independently and
 * one asking another for its fields is the smaller change.
 *
 * @returns {Promise<Array<{key: string, label: string}>>} empty when the class
 *   entry, its book, or the grid is unreachable \u2014 a missing table drops the
 *   throws rather than inventing any.
 */
export async function laddersForEntry(entry, { pageCache = null } = {}) {
  const specs = (entry?.fields?.rolls?.specs ?? []).filter((sp) => sp?.fromLadders);
  if (!specs.length) return null;
  const out = {};
  for (const sp of specs) out[sp.key ?? "ladders"] = await laddersFromSpec(sp.fromLadders, { pageCache });
  return out;
}

export async function laddersFromSpec(spec, { pageCache = null } = {}) {
  const classId = `def.class.${spec?.as ?? ""}`;
  const found = spec?.as ? cookbookEntry(classId) : null;
  if (!found) return [];
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return [];
  const node = await executeEntry(session.doc, found.cb, data.registers, classId, {
    ...(pageCache ? { pageCache } : {}),
  }).catch(() => null);
  if (!node?.ok) return [];
  const grid = node.fields?.[spec.grid ?? "rebuking"];
  return gridLadders(grid, spec.prefix ?? "").map(({ key, label }) => ({ key, label }));
}

export function bindClass(entry, node, id, { gains = null, commonName = null, gear = [] } = {}) {
  const cite = entry.cite ?? "";
  const f = node?.fields ?? {};
  // Body fields arrive one per page (`body61`) or one per page-column
  // (`body61c0`, `body61c1`) — emission order is reading order either way.
  const bodyParts = Object.entries(f)
    .filter(([k, v]) => /^body\d+(?:c\d+)?$/.test(k) && typeof v === "string")
    .map(([, v]) => v);
  const body = bodyParts.join(" ");

  /* Fixed column vocabulary; anything else a progression table carries is a
   * named LADDER (AC bonus, backstab dice, the assassin/bard skill columns). */
  const FIXED_COLS = new Set(["xp", "title", "hd", "band", "attackBand", "paralysis", "death", "blast", "implements", "spells", "attackThrow", "s1", "s2", "s3", "s4", "s5", "s6"]);

  const levels = [];
  const ladderMap = new Map(); // colKey → rungs
  const slotRowsBy = {}; // s: single tradition; a/d: the Nobiran's pair
  for (const row of f.progression?.rows ?? []) {
    const level = intFrom(row.label);
    if (level == null) continue;
    levels.push({
      level,
      xp: intFrom(row.cells.xp),
      title: capFirst(row.cells.title),
      hd: String(row.cells.hd ?? "").replace(/\*/g, "").trim(),
    });
    // Slot columns: s1..s6 (single tradition) or a1..a6 / d1..d6 (the
    // Nobiran's arcane and divine groups). Anything else non-fixed is a
    // named ladder.
    const perPrefix = { s: {}, a: {}, d: {} };
    const any = { s: false, a: false, d: false };
    for (const [key, cell] of Object.entries(row.cells)) {
      const slotMatch = /^([sad])([1-6])$/.exec(key);
      if (slotMatch) {
        const n = intFrom(cell);
        if (n != null) {
          perPrefix[slotMatch[1]][`s${slotMatch[2]}`] = n;
          any[slotMatch[1]] = true;
        }
        continue;
      }
      if (FIXED_COLS.has(key)) continue;
      const rungs = ladderMap.get(key) ?? [];
      rungs.push({ atLevel: level, value: intFrom(cell), text: String(cell).trim() });
      ladderMap.set(key, rungs);
    }
    for (const p of ["s", "a", "d"]) {
      if (any[p]) (slotRowsBy[p] ??= []).push({ atLevel: level, ...perPrefix[p] });
    }
  }
  // A standalone skill-progression table (the nightblade's) contributes its
  // columns as ladders keyed by column.
  for (const row of f.skillTable?.rows ?? []) {
    const level = intFrom(row.label);
    if (level == null) continue;
    for (const [key, cell] of Object.entries(row.cells)) {
      if (key === "band" || FIXED_COLS.has(key)) continue;
      const rungs = ladderMap.get(key) ?? [];
      rungs.push({ atLevel: level, value: intFrom(cell), text: String(cell).trim() });
      ladderMap.set(key, rungs);
    }
  }
  levels.sort((a, b) => a.level - b.level);
  const ladders = [...ladderMap.entries()].map(([key, values]) => ({
    key,
    label: key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase()),
    values,
  }));

  // A grid keyed on a NAME rather than on a level — the crusader's rebuking
  // table, whose rows are undead types and whose columns are the crusader's
  // levels. Each row becomes one ladder, so a throw can name it the same way it
  // names a thief's Climb Walls, and every class that rebukes at a fraction of
  // its level borrows the one published table instead of re-reading the page.
  //
  // The CELL RULE is structural and holds no printed letter: a cell that parses
  // as a number is a target, a dash is a rung the character cannot act on, and
  // anything else non-empty is a rung reached without a throw. Which letter the
  // page prints there rides through as `text`, from the reader's own book — a
  // rule that knew what the letters meant would be shipping the rule.
  ladders.push(...gridLadders(f.rebuking, "rebuke"));

  // One combined attack-and-saves table, or the split pair the priestess and
  // witch print (crusader saves beside mage attacks) — read whichever exists.
  // A table may also print the attack sub-table with its OWN level column
  // (`attackBand`, the BTA gnostic classes): the attack rows band by it, and
  // where it is dashed out the save band still stands on its own.
  const saves = [];
  const attack = [];
  for (const tableKey of ["attackSaves", "savesTable", "attackTable"]) {
    for (const row of f[tableKey]?.rows ?? []) {
      const band = row.cells.band ?? { min: intFrom(row.label), max: intFrom(row.label) };
      if (band?.min == null) continue;
      const minLevel = band.min;
      const maxLevel = band.max ?? band.min;
      if (row.cells.paralysis != null || row.cells.death != null) {
        saves.push({
          minLevel, maxLevel,
          paralysis: row.cells.paralysis ?? null,
          death: row.cells.death ?? null,
          blast: row.cells.blast ?? null,
          implements: row.cells.implements ?? null,
          spells: row.cells.spells ?? null,
        });
      }
      const aband = "attackBand" in row.cells ? row.cells.attackBand : band;
      if (row.cells.attackThrow != null && aband?.min != null) {
        attack.push({ minLevel: aband.min, maxLevel: aband.max ?? aband.min, throw: row.cells.attackThrow });
      }
    }
  }

  // Casting traditions: the chef classifies (key/kind/repertoire — structure);
  // every slot count comes from the progression grid's numbered columns. With
  // one tradition the plain columns serve it; the Nobiran's pair each take
  // their own prefixed group.
  const casting = (entry.casting ?? []).map((t) => {
    const key = t.key ?? "arcane";
    const slots =
      (key === "arcane" && slotRowsBy.a) || (key === "divine" && slotRowsBy.d) || slotRowsBy.s || [];
    return {
      key,
      label: t.label ?? "",
      kind: t.kind ?? "vancian",
      repertoire: t.repertoire ?? "",
      spellList: [],
      slots,
      pool: [],
      casterLevel: t.casterLevel ?? "",
    };
  });

  // RR joins key attributes with "and"; BTA's plural form lists them with
  // commas ("Prime Requisites: INT, WIS") — split on either.
  const keyAttributes = stripBullet(f.keyAttribute)
    .split(/\s*,\s*|\s+and\s+/i)
    .map((a) => ATTR_KEY[a.trim().toUpperCase()])
    .filter(Boolean);
  const reqText = stripBullet(f.requirements);
  const requirements = [];
  if (!/^none\b/i.test(reqText)) {
    for (const m of reqText.matchAll(/([A-Z]{3})\s*(\d+)/g)) {
      const attr = ATTR_KEY[m[1].toUpperCase()];
      if (attr) requirements.push({ attr, min: parseInt(m[2], 10) });
    }
  }

  // Every printed surface, resolved once and read by BOTH the class list here
  // and the template cells below — one decision, so the two cannot disagree
  // about what a printed name means.
  const surfaces = abilitySurfaceIndex();

  // The printed class list, token-matched against every content cookbook;
  // what fails to match is KEPT, visibly, on unresolvedProfs.
  const classProfs = [];
  const unresolvedProfs = [];
  // BTA's capture can fuse the label ("ProficiencyList:"), so the strip
  // tolerates missing inter-word space.
  const listText = String(f.profList ?? "").replace(/^.*?Proficiency\s*List:\s*/i, "");
  for (const name of splitList(listText)) {
    const hit = surfaces.byKey.get(nameKey(name.replace(/\([^)]*\)/g, "")));
    if (hit) classProfs.push(hit.ref);
    else unresolvedProfs.push(name);
  }

  // Award grant levels resolve from the reader's own page text; a pattern
  // that finds nothing leaves the award visible with its level unresolved.
  const awards = (entry.awards ?? []).map((a) => {
    let atLevel = a.starting ? 1 : null;
    if (atLevel == null && a.from?.pattern && body) {
      const m = new RegExp(a.from.pattern).exec(body);
      if (m?.[1] != null) atLevel = parseInt(m[1], 10);
    }
    // A chef CHOICE award: a pick among named refs (the warlock's dark path,
    // the witch's tradition, the earthforger's sigil) — the chooser offers
    // exactly the listed options and grants the one taken.
    if (a.choice?.refs?.length) {
      return {
        atLevel: atLevel ?? 0,
        kind: "choice",
        ref: "",
        name: "",
        choice: {
          from: "custom",
          filter: "",
          count: a.choice.count ?? 1,
          refs: a.choice.refs,
          label: a.choice.label ?? "",
        },
        note: atLevel == null ? "level unresolved" : (a.note ?? ""),
      };
    }
    // A pattern that finds nothing parks the award at level 0 — visible and
    // never auto-granted — rather than silently landing at 1st.
    return {
      atLevel: atLevel ?? 0,
      kind: "fixed",
      ref: a.ref,
      name: "",
      note: atLevel == null ? "level unresolved" : (a.note ?? ""),
    };
  });

  // Grid row when the RR grid knows the class; otherwise the schedule parsed
  // from the spread's own Proficiency Progression prose.
  const gainCells = gains ?? proseGainSchedule(body);
  if (gainCells) {
    for (const [key, cell] of Object.entries(gainCells)) {
      const atLevel = parseInt(key.slice(1), 10);
      if (!Number.isInteger(atLevel)) continue;
      const text = String(cell);
      if (/c/i.test(text)) {
        awards.push({
          atLevel, kind: "choice", ref: "", name: "",
          choice: { from: "classInventory", filter: "proficiencies", count: 1, refs: [], label: "Class proficiency" },
          note: "",
        });
      }
      if (/g/i.test(text)) {
        awards.push({
          atLevel, kind: "choice", ref: "", name: "",
          choice: { from: "generalList", filter: "any", count: 1, refs: [], label: "General proficiency" },
          note: "",
        });
      }
    }
    awards.sort((a, b) => a.atLevel - b.atLevel);
  }

  /* --- languages (RR §I.10, read off the spread) ---
     A demi-human spread prints its whole list in a Tongues runin — racial
     tongue, the common one, and the rest — with no pick left open beyond what
     Intellect buys, so the parse IS the granted list and count stays 0. A
     spread without the runin is a human class: it knows the common tongue and
     its homeland's, and the homeland is setting-dependent, so it rides as ONE
     open pick beside the extracted common name. Bookless (no body), both stay
     empty — a class with no page to read grants nothing rather than a guess. */
  const tongues = body ? parseTongues(body) : null;
  // Multilingual / Linguistics: picks the reader fills from their own campaign,
  // which ride on top of whichever list the class starts from.
  const bonus = body ? parseBonusLanguages(body) : 0;
  const languages = tongues
    ? { granted: tongues.granted, count: bonus }
    : { granted: body && commonName ? [commonName] : [], count: (body ? 1 : 0) + bonus };
  // The race this class is an expression of. DECLARED in the register where
  // the spread's own runin cannot be trusted to say it — the Spellsword's page
  // interleaves its proficiency list through the sentence — and the class is
  // an elf class whether or not its page parses. The declaration classifies;
  // the LIST still comes from the reader's book, inherited from a sibling of
  // the same race whose page reads cleanly (see `inheritRaceTongues`).
  const raceKey = entry.meta?.race ?? (tongues ? tongues.race.toLowerCase() : null);

  let cleaves = {};
  if (entry.cleaves?.pattern && body) {
    const m = new RegExp(entry.cleaves.pattern, "i").exec(body);
    // Extraction joins can drop inter-run spaces, so the phrase folds first.
    const phrase = (m?.[1] ?? "").toLowerCase().replace(/\s+/g, "");
    if (phrase.startsWith("classlevel")) cleaves = { kind: "perLevel", base: 1, per: 1 };
    else if (phrase.includes("twoclasslevels")) cleaves = { kind: "perLevel", base: 0.5, per: 0.5, round: "down" };
  }

  // What the class is trained to fight with, carried as an effect the actor
  // reads through the class item it holds. The run-in label is declared per
  // class because the spreads do not all print it under the same one.
  const training = entry.training?.runin ? readTraining(bodyParts, entry.training.runin) : null;

  // The eight printed starting templates: proficiency cells tokenized against
  // every known ability name, equipment cells split into skinned descriptors.
  const tplMenu = surfaces.menu;
  const eqMenu = equipmentMenu(gear);
  const templates = (f.templates?.rows ?? []).map((row) => {
    const band = row.cells.band ?? {};
    const rawName = capFirst(String(row.cells.template ?? "").replace(/\s+/g, " ").trim());
    const ann = /^(.*?)\s*\(([^)]+)\)$/.exec(rawName);
    // Book-wide equivalences first, this class's own wording over the top: an
    // exception authored for one spread must be able to override the general
    // one, and most of them recur across every class in the book.
    const eq = parseEquipment(row.cells.equipment, eqMenu, {
      ...(data.registers?.tables?.equipmentPhrase ?? {}),
      ...(entry.equipAliases ?? {}),
    });
    const spells = liftBookSpells(eq.items);
    // A creature the cell names belongs to the ability whose companion slot it
    // fills, not to the character's pack.
    const abilities = tokenizeProfs(row.cells.proficiencies, tplMenu);
    liftCompanions(eq.items, abilities, data.registers?.tables?.companionPhrase);
    return {
      rollMin: band.min ?? 3,
      rollMax: band.max ?? band.min ?? 3,
      name: ann ? ann[1] : rawName,
      annotation: ann ? ann[2] : "",
      caste: String(row.cells.caste ?? "").trim(),
      abilities,
      items: eq.items,
      spells,
      gp: eq.gp,
      sp: eq.sp,
      enc: eq.enc,
      alt: "",
    };
  });

  return {
    name: entry.name,
    type: CLASS_ITEM_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    system: {
      key: entry.meta?.key ?? fold(entry.name),
      source: { book: entry.book ?? "rr", cite, ref: id },
      description: entryText(node, id, cite),
      requirements,
      keyAttributes,
      ...(typeof f.maximumLevel === "number" ? { maximumLevel: f.maximumLevel } : {}),
      hitDie: String(f.hitDie ?? "").trim(),
      levels,
      ladders,
      saveChassis: entry.meta?.chassis?.saves ?? "",
      attackChassis: entry.meta?.chassis?.attack ?? "",
      factored: !!entry.meta?.factored,
      core: !!entry.meta?.core,
      // How much Intellect bonus this class's printed TEMPLATES already spend.
      // The studious spellcasters' packages are built assuming one, so chargen
      // must not offer it a second time — and must withhold what the character
      // cannot hold when their Intellect is lower. A structural fact about how
      // the spread is arranged, like `factored` beside it.
      templatesAssumeIntBonus: Number(entry.meta?.templatesAssumeIntBonus) || 0,
      saves,
      attack,
      cleaves,
      casting,
      inventory: {
        classProfs,
        powers: awards.filter((a) => a.ref.startsWith("def.power.")).map((a) => a.ref),
        skills: (entry.skills ?? []).map((s) => ({ ref: s.ref, ladderKey: s.ladderKey ?? "" })),
      },
      unresolvedProfs,
      awards,
      languages,
      templates,
      // The class's mutually exclusive options: its printed variant table where
      // the spread prints one, and its starting templates, which are a group of
      // the same kind rather than a parallel mechanism.
      paths: buildPaths(f.training?.rows, entry.class?.tables?.training?.labelHeader ?? "", templates.length > 0),
    },
    ...(training ? { effects: [trainingEffect(entry, training)] } : {}),
    flags: {
      [MODULE_ID]: {
        cookbook: { id, cite },
        // Which race these tongues belong to — declared, or the runin's own
        // subject. Kept so a sibling can lend its list to a class whose page
        // does not parse, and so the race document is brought in step.
        ...(raceKey ? { tongues: { race: raceKey, parsed: !!tongues } } : {}),
        minted: true,
      },
    },
  };
}

/**
 * The class's training as one embedded Active Effect.
 *
 * The consumer reads the CHANGE LIST, not an applied value, so the effect only
 * has to be present and enabled on an actor holding the class — which a
 * transferring item effect is. It carries all three domains together because
 * they are one paragraph in the book and one answer about the character.
 *
 * `type` is written rather than the older numeric `mode`: on v14 the numeric
 * field survives only as a shim whose setter coerces, so a string there
 * silently lands as NaN and the change never gets a type at all.
 */
function trainingEffect(entry, training) {
  const changes = [];
  const add = (domain, value) => {
    if (value) changes.push({ key: `flags.${MODULE_ID}.${domain}`, type: "add", value: String(value), priority: 20 });
  };
  add("weaponProf", training.weapons.join(","));
  add("armourProficiency", training.armour);
  add("styleProficient", training.styles.join(","));
  return {
    name: game.i18n?.format
      ? game.i18n.format(`${LANG_PREFIX}.ui.classTraining`, { class: entry.name })
      : `${entry.name} Training`,
    img: DEFAULT_IMG.TRAINING,
    changes,
    transfer: true,
    disabled: false,
    flags: { [MODULE_ID]: { minted: true } },
  };
}

/** Every kind.class [id, entry] across the content cookbooks. */
export function* classEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.class") yield [defId, e];
    }
  }
}

/** Execute the Proficiencies-Gained grid once per run (null without a book). */
async function executeProfGains() {
  const id = "def.classmeta.profGains";
  const found = cookbookEntry(id);
  if (!found) return null;
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return null;
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  return node?.ok ? node : null;
}

/**
 * What the common tongue is called in this setting, read once per run from
 * the chargen chapter's LANGUAGES section (`def.classmeta.startingTongues`).
 *
 * The section introduces the vulgarized Classical tongue by the name it is
 * "often called", and that quoted name is the one a human class's granted
 * list carries. The PATTERN is structure — the book explaining a nickname —
 * and the NAME comes off the reader's own page, so nothing is transcribed.
 * Null without the book, or if the sentence is not where the anchor says: a
 * human class then imports with no granted tongue rather than a guessed one.
 */
async function executeCommonTongue() {
  const id = "def.classmeta.startingTongues";
  const found = cookbookEntry(id);
  if (!found) return null;
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return null;
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node?.ok) return null;
  const body = Object.entries(node.fields ?? {})
    .filter(([k, v]) => /^body\d+(?:c\d+)?$/.test(k) && typeof v === "string")
    .map(([, v]) => v)
    .join(" ");
  const m = /often\s*called\s*[“”"']?\s*([A-Z][A-Za-z]*(?:\s*[A-Z][A-Za-z]*)?)/.exec(body);
  return m ? m[1].trim() : null;
}

/**
 * Read the training paragraph from the COLUMN it is printed in, not from the
 * page's reading order.
 *
 * A spread whose level table sits beside the prose extracts with the table's
 * cells folded through the sentence — "Battle axeMediumdagger5,000" — and
 * `parseCombatTraining` refuses any paragraph carrying a digit, because none of
 * these sentences prints a number and one that does is interleaved. Refusing is
 * right; refusing was also the END of it, so twelve classes imported with no
 * weapon, armour or fighting-style training at all, silently, and a class that
 * grants no armour proficiency looked exactly like one that has none.
 *
 * The fields already arrive one per page-COLUMN where the extraction could tell
 * them apart (`body61c0`, `body61c1`), and a column carries its own prose
 * without the table beside it. So each is offered on its own first, and the
 * joined page only afterwards — which is what a paragraph that genuinely runs
 * across a column break needs.
 */
export function readTraining(bodyParts, runin) {
  for (const part of bodyParts ?? []) {
    const t = part ? parseCombatTraining(part, runin) : null;
    if (t) return t;
  }
  const joined = (bodyParts ?? []).join(" ");
  return joined ? parseCombatTraining(joined, runin) : null;
}

/**
 * What a class is TRAINED to fight with, read off its own spread.
 *
 * Every class spread carries one paragraph stating all three trainings in a
 * fixed order — weapons, then armour, then fighting styles — as a run-in
 * whose label the register declares per class, because it is not the same
 * label on every spread.
 *
 * The three grammars, each a shape the book writes rather than a value it
 * prints:
 *
 *  - WEAPONS. "all weapons" is unrestricted; a size clause ("any tiny, small,
 *    or medium melee weapons") is a set of size grants; "all missile weapons"
 *    is the missile grant; anything else is a list of named weapons, and where
 *    the sentence names a group and then enumerates it in a parenthesis, the
 *    ENUMERATION is what is read — the book's own answer to what the group
 *    contains, in the book's own words, so nothing is inferred about the group.
 *  - ARMOUR. The heaviest rung the sentence names, since each rung includes
 *    everything under it. A sentence that denies armour outright is the
 *    bottom rung, not an absent answer.
 *  - STYLES. Only the POSITIVE clause. Every spread that names styles goes on
 *    to name the ones it excludes, in the same sentence and the same words, so
 *    a parse that reads the whole sentence grants precisely what the class is
 *    forbidden. The exclusion clause is cut before anything is read.
 *
 * The two mandatory styles are not emitted: they are RAW for every class, and
 * the consumer already holds them, so repeating them here would be this repo
 * stating a rule that lives in the other one.
 *
 * A sentence stating an EXCEPTION ("all weapons except …") returns no weapon
 * grant at all. The grant vocabulary cannot express a subtraction, and reading
 * such a sentence as its unrestricted half would grant exactly the weapons the
 * class is denied — so the class stays unstated, and a reader who narrows it
 * by hand is not fighting an assertion this importer invented.
 *
 * @param {string} body the spread's raw body text, in reading order
 * @param {string} runin the run-in label this class prints the paragraph under
 * @returns {{weapons: string[], armour: string, styles: string[]}|null}
 */
export function parseCombatTraining(body, runin) {
  const text = String(body ?? "").replace(/\s+/g, " ");
  const label = String(runin ?? "").trim();
  if (!text || !label) return null;
  // Extraction joins lines by concatenation, so a space the page shows is
  // routinely absent from the text — "fighting styleproficiency",
  // "armorproficiencywithlightandverylight". EVERY seam below is therefore
  // optional rather than required; a parser written against the spacing the
  // page displays reads almost nothing off the file it is actually given.
  const loose = (s) => s.replace(/ /g, "\\s*");
  const at = text.search(new RegExp(loose(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), "i"));
  if (at < 0) return null;
  const after = text.slice(at).replace(new RegExp(`^${loose(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))}`, "i"), "");
  // To the next run-in label — a capitalised phrase closing on a colon, which
  // the same joins can leave welded to the previous sentence ("…styles).Combat
  // Progression:"), so no separating space is required of it either.
  const para = after.slice(0, /(?:^|[.)\s])[A-Z][a-z]+(?:\s*[A-Za-z]+){0,3}:/.exec(after)?.index ?? 900);

  // A spread whose level table sits inside the text block extracts with the
  // table's cells folded through the sentence, mid-word: a weapon list comes
  // back holding "battlelevelaxes" and a row of hit dice. None of these
  // paragraphs prints a number, so a digit means the prose is interleaved and
  // no part of it can be trusted — including the clauses that happen to look
  // intact, which is how such a class ends up granted the one fighting style
  // the table did not interrupt. Reading it needs the paragraph located by
  // its column, not the page's reading order.
  if (/\d/.test(para)) return null;

  // Segment by the three phrases themselves: the shortest spreads state all
  // three in ONE sentence, so sentence boundaries do not divide them.
  const marks = [
    ["weapons", /weapon\s*proficiency/i],
    ["armour", /(?:armor|armour)\s*proficiency|proficiency\s*with\s*(?:armor|armour)/i],
    ["styles", /fighting\s*style\s*proficiency/i],
  ]
    .map(([key, re]) => ({ key, at: re.exec(para)?.index ?? -1 }))
    .filter((m) => m.at >= 0)
    .sort((a, b) => a.at - b.at);
  if (!marks.length) return parseTrainingProse(para);
  const seg = {};
  marks.forEach((m, i) => {
    // A segment ends at its own sentence, not at the next phrase: the shortest
    // spreads run all three through one sentence (so the next phrase arrives
    // first), and the longest give each its own (so the sentence does). Taking
    // whichever comes first is what stops "…and staffs." from reading on into
    // "They have no armour…" and turning the next clause into a weapon name.
    const upto = i + 1 < marks.length ? marks[i + 1].at : para.length;
    const slice = para.slice(m.at, upto);
    // A sentence ends at a full stop that STARTS another one. The styles are
    // spelled out in an "(i.e. …)" aside on the shortest spreads, and treating
    // its stop as the end of the sentence cuts the list off before it begins.
    // The space after the stop is optional for the same reason as every other.
    seg[m.key] = slice.slice(0, /\.\s*[A-Z]|\.$/.exec(slice)?.index ?? slice.length);
  });

  /* --- weapons ---------------------------------------------------------- */
  const weapons = [];
  const wSeg = seg.weapons ?? "";
  if (/\bexcept\b/i.test(wSeg)) {
    // Stated as a subtraction — see the header. Nothing is granted.
  } else if (/all\s*weapons/i.test(wSeg)) {
    // No word boundary in front: a table footnote can land welded to the
    // phrase ("proficiency with*no adjustment fromall weapons") and the
    // sentence still says what it says.
    weapons.push("all");
  } else {
    // The group phrasings are consumed as they are recognised, so whatever
    // remains is a plain list of names. Leaving them in would read the sizes
    // a second time, as weapons called "tiny" and "small".
    let rest = wSeg;
    const eat = (re, take) => {
      const m = re.exec(rest);
      if (!m) return;
      take(m);
      rest = rest.slice(0, m.index) + " " + rest.slice(m.index + m[0].length);
    };
    eat(/all\s*missile\s*weapons/i, () => weapons.push("missile:all"));
    eat(/((?:tiny|small|medium|large)(?:\s*,?\s*(?:and|or)?\s*(?:tiny|small|medium|large))*)\s*melee\s*weapons/i, (m) => {
      for (const s of m[1].match(/tiny|small|medium|large/gi) ?? []) weapons.push(`melee:${s.toLowerCase()}`);
    });
    // A named group is trusted only through its own parenthesis; where there
    // is no parenthesis the sentence is already a plain list of weapons.
    const parens = [...rest.matchAll(/\(\s*including([^)]*)\)/gi)].map((m) => m[1]);
    const lists = parens.length ? parens : [rest.replace(/^[^]*?proficiency\s*with\s*/i, "")];
    for (const list of lists) {
      for (const raw of list.split(/,| and | or /i)) {
        const name = singularWeapon(raw);
        if (name) weapons.push(name);
      }
    }
  }

  /* --- armour ----------------------------------------------------------- */
  let armour = "";
  const aSeg = seg.armour ?? "";
  // The sentence names every rung it includes, so the answer is the HEAVIEST
  // named — "light and very light" is a light class, not a very light one.
  // "very light" is removed before looking for "light" so the qualifier cannot
  // be read as the bare rung it contains.
  const aBare = aSeg.replace(/very\s*light/gi, " ");
  const RUNGS = [
    [/heavy/i, aBare, "heavy"],
    [/medium/i, aBare, "medium"],
    [/light/i, aBare, "light"],
    [/very\s*light/i, aSeg, "veryLight"],
  ];
  if (/\bno\s*(?:armor|armour)\s*proficiency|\bno\s*proficiency\s*with\s*(?:armor|armour)/i.test(para)) armour = "unarmored";
  else if (/all\s*(?:armor|armour)/i.test(aSeg)) armour = "heavy";
  else armour = RUNGS.find(([re, src]) => re.test(src))?.[2] ?? "";

  /* --- styles ----------------------------------------------------------- */
  const sSeg = (seg.styles ?? "").split(/\bbut\s*not/i)[0];
  const styles = [];
  if (/all\s*fighting\s*styles/i.test(sSeg)) styles.push("dual", "twohanded", "weaponshield");
  else {
    if (/dual\s*weapon/i.test(sSeg)) styles.push("dual");
    if (/two\s*-?\s*handed\s*weapon/i.test(sSeg)) styles.push("twohanded");
    if (/weapon\s*and\s*shield/i.test(sSeg)) styles.push("weaponshield");
  }

  if (!weapons.length && !armour && !styles.length) return null;
  return { weapons: [...new Set(weapons)], armour, styles: [...new Set(styles)] };
}

/**
 * The SECOND grammar: a spread that states its training in sentences rather
 * than in the RR formula.
 *
 * By This Axe writes the same three facts with none of the three phrases the
 * segmenter above keys on — "Delvers can fight with all axes, hammers, flails,
 * and maces… They can wear leather armor or lighter. They can wield a weapon
 * two-handed or wield a weapon in each hand but cannot wield a shield." No
 * marker, so every one of its ten classes read as having no training at all,
 * and a class that grants no armour proficiency looked exactly like one that
 * has none.
 *
 * The SHAPES are the rule and ship here; every weapon named, and which armour
 * rung, is read off the reader's own page. Both books' readers converge on the
 * one grant vocabulary the consumer already publishes (`classifyGrantToken`):
 * `all`, `missile:all`, `melee:<size>`, a weapon-category, or a weapon name.
 *
 * EXCLUSIONS ARE DROPPED, NEVER INVERTED — the same rule the formula reader
 * follows. "all missile weapons except longbows" grants no missile clause at
 * all rather than granting the longbow the class is denied; the named groups
 * beside it still stand, so the class is under-granted and never over-granted.
 */
export function parseTrainingProse(para) {
  const text = String(para ?? "");
  if (!text || /\d/.test(text)) return null;

  /** A clause's own sentence, cut before whatever it goes on to forbid. */
  const positive = (clause) => String(clause ?? "").split(/\bbut\s+(?:they\s+)?(?:cannot|can\s*not|typically)\b/i)[0];

  /* --- weapons: "can fight with …" ------------------------------------- */
  const weapons = [];
  // "can only fight with" is the same sentence; and extraction welds, so the
  // seams are `\s*` and the word boundary before a welded noun ("weararmor")
  // cannot be required of any of them.
  const wRaw = /can\s*(?:only\s*)?fight\s*with([^.]*)/i.exec(text)?.[1] ?? "";
  const wSeg = positive(wRaw);
  if (wSeg) {
    // A "broad selection … including X, Y" names the group and then enumerates
    // it; the ENUMERATION is what is read, exactly as the formula reader does.
    const list = /\bincluding\b([^.]*)/i.exec(wSeg)?.[1] ?? wSeg;
    for (const raw of list.split(/,| and | or /i)) {
      const part = raw.trim();
      if (!part || /\bexcept\b/i.test(part)) continue;
      // "all missile weapons", "all axes" — an unqualified group.
      if (/all\s*missile\s*weapons/i.test(part)) { weapons.push("missile:all"); continue; }
      const group = TRAINING_GROUPS.find(([re]) => re.test(part));
      if (group) { weapons.push(group[1]); continue; }
      const name = singularWeapon(part.replace(/^all\s+/i, ""));
      if (name) weapons.push(name);
    }
  }

  /* --- armour ----------------------------------------------------------- */
  // Written as a ceiling ("leather armor or lighter", "no armor heavier than
  // leather") or as a grant of everything, or as a refusal of the whole idea.
  let armour = "";
  const aSeg = /((?:can|cannot|can\s*not)[^.]*(?:armor|armour)[^.]*)/i.exec(text)?.[1] ?? "";
  const eschew = /eschew[^.]*(?:armor|armour)|(?:armor|armour)[^.]*\bentirely\b/i.test(text);
  if (eschew) armour = "unarmored";
  else if (/any\s*(?:type\s*of\s*)?(?:armor|armour)|all\s*(?:armor|armour)/i.test(aSeg)) armour = "heavy";
  else if (aSeg) {
    const bare = aSeg.replace(/very\s*light/gi, " ");
    armour =
      (/very\s*light/i.test(aSeg) && !/\b(leather|light|medium|heavy)\b/i.test(bare) ? "veryLight" : "") ||
      (/\bheavy\b/i.test(bare) && !/heavier\s*than/i.test(bare) ? "heavy" : "") ||
      (/\bmedium\b/i.test(bare) ? "medium" : "") ||
      // "leather" IS the light rung, and the sentence names it rather than the
      // rung: "leather armor or lighter", "no armor heavier than leather".
      (/\bleather\b|\blight\b/i.test(bare) ? "light" : "");
  }

  /* --- styles: "can wield …" -------------------------------------------- */
  const sSeg = positive(/can\s*wield([^.]*)/i.exec(text)?.[1] ?? "");
  const styles = [];
  if (/two\s*-?\s*hand/i.test(sSeg)) styles.push("twohanded");
  if (/in\s*each\s*hand|dual\s*wield|dual\s*weapon/i.test(sSeg)) styles.push("dual");
  if (/(?:weapon\s*and\s*shield|and\s*shield|shield\s*and)/i.test(sSeg)) styles.push("weaponshield");

  if (!weapons.length && !armour && !styles.length) return null;
  return { weapons: [...new Set(weapons)], armour, styles: [...new Set(styles)] };
}

/** Plural group names a sentence uses, and the category token each names. The
 *  groups are the consumer's vocabulary (`classifyGrantToken`), not this book's. */
const TRAINING_GROUPS = [
  [/\baxes\b/i, "axe"],
  [/\bcrossbows\b/i, "crossbow"],
  [/\bbows\b/i, "bow"],
  [/\b(?:hammers|maces|flails)\b/i, "flailHammerMace"],
  [/\b(?:swords|daggers)\b/i, "swordDagger"],
  [/\b(?:spears|pole\s*arms|polearms)\b/i, "spearPolearm"],
];

/**
 * One row of a class's combat-proficiencies TABLE, as a path option's training.
 *
 * A spread whose training differs per region prints it as a grid rather than a
 * sentence, so there is no paragraph to read: the Barbarian states a weapon
 * list, an armour column and a style column per region, and the class itself
 * states none of the three. Each row becomes one option of a path group.
 *
 * The armour column names every rung it permits ("Medium Light Very Light"), so
 * the answer is the HEAVIEST — the same rule the prose reader follows, for the
 * same reason. Weapons and styles are read exactly as the prose reader reads
 * them, so both routes land on one grant vocabulary.
 *
 * PER-OPTION DATA STAYS ON THE OPTION even where every row agrees — all three
 * regions permit armour up to medium, and hoisting that to the class would
 * bake in a coincidence of this printing and leave nowhere for a custom path,
 * or a later one that differs, to say otherwise.
 */
export function readTrainingCells(cells = {}) {
  const weapons = [];
  for (const raw of String(cells.weapons ?? "").split(/,| and | or /i)) {
    const name = singularWeapon(raw);
    if (name) weapons.push(name);
  }
  const aSeg = String(cells.armour ?? "");
  const bare = aSeg.replace(/very\s*light/gi, " ");
  const armour =
    (/all\s*(?:armor|armour)/i.test(aSeg) ? "heavy" : "") ||
    (/\bheavy\b/i.test(bare) ? "heavy" : "") ||
    (/\bmedium\b/i.test(bare) ? "medium" : "") ||
    (/\blight\b/i.test(bare) ? "light" : "") ||
    (/very\s*light/i.test(aSeg) ? "veryLight" : "") ||
    (/\bnone\b|\bno\b/i.test(aSeg) ? "unarmored" : "");
  const sSeg = String(cells.styles ?? "");
  const styles = [];
  if (/dual\s*weapon/i.test(sSeg)) styles.push("dual");
  if (/two\s*-?\s*handed\s*weapon/i.test(sSeg)) styles.push("twohanded");
  if (/weapon\s*and\s*shield/i.test(sSeg)) styles.push("weaponshield");
  return { weapons: [...new Set(weapons)], armour, styles: [...new Set(styles)] };
}

/**
 * The PATH GROUPS a class offers: its printed variant table where it has one,
 * and its starting templates, which are a group like any other.
 *
 * ACKS Extras owns the shape (`system.paths`, DECISIONS 2026-08-22); this side
 * fills it from the reader's own page. A templates group carries NO options —
 * its `source` points at `system.templates`, which stays exactly where it is.
 */
export function buildPaths(trainingRows, labelHeader, hasTemplates) {
  const key0 = (x) => String(x ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const paths = [];
  const rows = (trainingRows ?? []).filter((r) => {
    // The grid's own header line arrives as a row; it names the columns rather
    // than a variant, and every cell it holds is a column title.
    const key = key0(r.label);
    return key && key !== key0(labelHeader || "") && !/proficiencies/i.test(String(r.cells?.weapons ?? "").slice(0, 24));
  });
  if (rows.length) {
    paths.push({
      key: key0(labelHeader) || "variant",
      label: labelHeader || "Variant",
      source: "",
      options: rows.map((r) => ({
        key: r.key || key0(r.label),
        label: r.label,
        note: "",
        training: readTrainingCells(r.cells),
      })),
    });
  }
  if (hasTemplates) {
    paths.push({ key: "template", label: "Starting Template", source: "templates", note: "", options: [] });
  }
  return paths;
}

/**
 * One weapon name from a list item: the article and any aside dropped, the
 * plural the sentence writes folded back to the singular the grant vocabulary
 * matches on. Returns "" for a fragment that is not a name.
 */
function singularWeapon(raw) {
  let s = String(raw ?? "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\b(?:any|all|the|a|with|and|or|of|their|its)\b/gi, " ")
    .replace(/[^A-Za-z\s-]/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
  // The conjunction can arrive welded to the name it precedes ("andspears"),
  // in which case the word-boundary strip above cannot see it.
  s = s.replace(/^(?:and|or)(?=[a-z]{3})/, "").trim();
  if (!s || s.length < 3 || /\b(?:weapon|weapons|armor|armour|style|styles|proficiency|melee|missile)\b/.test(s)) return "";
  // "knives" is the one plural in the printed lists that does not simply
  // shed an s; "cestus" is the one SINGULAR that looks like it should.
  if (/ves$/.test(s)) s = s.replace(/ves$/, "fe");
  else if (/s$/.test(s) && !/(?:ss|us)$/.test(s)) s = s.replace(/s$/, "");
  return s;
}

/**
 * The tongues a class's spread prints, parsed from its Racial Traits runin.
 *
 * The runin is labelled `<Race> Tongues:` and its sentence lists what the
 * race can speak, sometimes in two clauses ("can speak … and can also speak
 * …"). Both are read; list items keep the book's own capitalization, drop the
 * article and the trailing "tongues"/"languages", and anything not shaped
 * like a proper name (a spell reference, a subordinate clause) is discarded
 * rather than granted.
 *
 * The grammar here is structure — how the book phrases the trait — and every
 * name in the result came off the reader's own page. A spread with no Tongues
 * runin (every human class) returns null, which is an answer, not a failure:
 * it routes the class to the human default.
 *
 * @param {string} body the spread's raw body text, in reading order
 * @returns {{race: string, granted: string[]}|null}
 */
export function parseTongues(body) {
  const text = String(body ?? "");
  // Every \s is \s* here, not \s+: raw body extraction drops inter-run spaces
  // (the cleave pattern folds them for the same reason), so the runin arrives
  // as "ElfTongues:" as often as "Elf Tongues:" and a required space misses
  // the trait entirely.
  // One word: the label's subject is the race ("Dwarf", "Elf", "Zaharan"),
  // and reaching further back swallows the section heading when the space
  // between them is one of the dropped ones.
  const runin = /([A-Z][a-z]+)\s*Tongues\s*:/.exec(text);
  if (!runin) return null;
  // The runin's own span: up to the next runin label or a bounded window —
  // the speak-clause scan below only reads inside it.
  const rest = text.slice(runin.index + runin[0].length);
  const next = /\s[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s*:/.exec(rest);
  const window = rest.slice(0, Math.min(next?.index ?? 600, 600));

  const granted = [];
  // The capture is CAPPED at 80 characters — the printed lists all fit in 48
  // even with every space glued out. A clause that cannot reach its terminator inside the cap is one the
  // page has interleaved with a neighbouring column's text (measured live: a
  // spread's proficiency list arrived mid-sentence, capitalised exactly like
  // tongues), and it is dropped whole: the class falls back to the human
  // default rather than granting a proficiency as a language.
  for (const clause of window.matchAll(/can\s*(?:also\s*)?speak\s*([^.]{0,80}?)(?=\s*(?:tongues|languages)\b|\.|$)/g)) {
    for (const piece of clause[1].replace(/^the\s*/i, "").split(/,|\band\b/)) {
      // Strip the glued terminator, then re-open a space the extraction
      // dropped inside a name ("AncientZaharan") — book names carry no
      // internal capitals, so a case boundary is a lost space.
      const name = piece
        .trim()
        .replace(/(tongues|languages)$/i, "")
        .trim()
        .replace(/([a-z])([A-Z])/g, "$1 $2");
      // A tongue is a proper name; "with beasts (as the spell)" is not.
      if (/^[A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*$/.test(name) && !granted.includes(name)) granted.push(name);
    }
  }
  return granted.length ? { race: runin[1].trim(), granted } : null;
}

/** Number words a printed grant uses, so a count reads as either. */
const NUMBER_WORD = Object.freeze({
  one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
});

/**
 * How many EXTRA languages of the reader's own choosing a spread grants,
 * beyond any it names — a Multilingual or Linguistics class power ("gain
 * three bonus languages", "can speak, read, and write an additional 4
 * languages of his choice"). These are open picks, never names: the book
 * leaves them to the campaign's own regions, so they become slots and nothing
 * else, which is exactly what `languages.count` is.
 *
 * Every separator is `\s*` for the reason `parseTongues` needs it — raw body
 * extraction glues inter-run spaces out — and the number-word alternation is
 * explicit rather than `[a-z]+` so a fully-glued "threebonuslanguages" still
 * resolves where a greedy class would swallow the whole token.
 *
 * Takes the LARGEST grant found rather than the sum: a spread states its
 * allowance once and then talks about it ("some or all of these languages"),
 * and summing would count the restatement.
 *
 * @param {string} body the spread's raw body text
 * @returns {number} extra picks, 0 where the spread grants none
 */
export function parseBonusLanguages(body) {
  const text = String(body ?? "");
  const words = Object.keys(NUMBER_WORD).join("|");
  const value = (tok) => NUMBER_WORD[String(tok).toLowerCase()] ?? (Number(tok) || 0);
  let most = 0;
  for (const re of [
    new RegExp(`(${words}|\\d+)\\s*bonus\\s*languages`, "gi"),
    new RegExp(`additional\\s*(${words}|\\d+)\\s*languages`, "gi"),
  ]) {
    for (const m of text.matchAll(re)) most = Math.max(most, value(m[1]));
  }
  // A spread claiming dozens is a parse that has wandered, not a class power.
  return most <= 10 ? most : 0;
}

/**
 * Bring the race documents' tongues in step with what the class spreads read.
 *
 * A Tongues runin names its RACE ("Dwarf Tongues: Dwarves can speak…"), and
 * the custom-class-builder's race items — whose own chapter prints no such
 * runin — are the other place that list belongs: a custom dwarven class built
 * on the race document owes its character the same tongues a vaultguard gets.
 * The label off the page keys the match, folded against the race item's key
 * and name, and only a race whose list is still EMPTY is written — a Judge's
 * own edit is never replaced.
 *
 * Races import from the builder tables and classes from their spreads, in
 * either order: run after a class import here, and worked into the race on
 * the next class import if the race arrived later.
 */
/**
 * Lend a race's tongues to a class of that race whose own page did not parse.
 *
 * A class is an elf class whether or not its spread reads cleanly, and the
 * Spellsword's does not: its page interleaves the proficiency list through the
 * Tongues sentence, so the clause is dropped rather than risk granting a
 * proficiency as a language. The register declares the race, and the list is
 * taken from a sibling of the same race whose page DID parse — so every name
 * still comes off the reader's own book, just from the page that printed it
 * legibly.
 *
 * Only a class that ended with no named tongues is filled, and only from a
 * sibling that has some; a class the parse already answered is left alone.
 */
async function inheritRaceTongues(classDocs) {
  const docs = (classDocs ?? []).filter(Boolean);
  const byRace = new Map();
  for (const d of docs) {
    const t = d.flags?.[MODULE_ID]?.tongues;
    const granted = d.system?.languages?.granted ?? [];
    // Only a class that read its OWN runin may lend; a human-default list
    // would otherwise propagate itself around the race.
    if (t?.race && t.parsed && granted.length && !byRace.has(t.race)) byRace.set(t.race, granted);
  }
  let lent = 0;
  for (const d of docs) {
    const t = d.flags?.[MODULE_ID]?.tongues;
    // Its OWN page answered, so nothing is borrowed. A class that fell to
    // the human default has a declared race and no parse of its own — that
    // is the one this exists for, and its default list is not evidence.
    if (!t?.race || t.parsed) continue;
    const race = t.race;
    const granted = byRace.get(race);
    if (!granted) continue;
    // It reached here on the HUMAN default, which spends one slot on a
    // homeland tongue a demi-human does not get — this is a class whose own
    // page would not parse, not a human. Give that slot back, keeping only
    // what its spread granted on top (a Multilingual power, say).
    const bonus = Math.max(0, (Number(d.system?.languages?.count) || 0) - 1);
    await d.update({ "system.languages": { granted, count: bonus } });
    lent++;
  }
  if (lent) console.log(`${MODULE_ID} | ${lent} class(es) took their tongues from a sibling of the same race`);
  return lent;
}

async function syncRaceTongues(classDocs) {
  const foldKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const items = await importedDocs("Item");
  const raceOf = (label) => {
    const key = foldKey(label);
    return items.find(
      (i) => i.type === RACE_TYPE && (foldKey(i.system?.key) === key || foldKey(i.name) === key),
    );
  };
  for (const doc of classDocs ?? []) {
    const label = doc?.flags?.[MODULE_ID]?.tongues?.race;
    const granted = doc?.system?.languages?.granted ?? [];
    if (!label || !granted.length) continue;
    const race = raceOf(label);
    if (!race || (race.system?.languages?.granted ?? []).length) continue;
    await race.update({ "system.languages": { granted, count: 0 } });
  }
}

/**
 * Import every class document (skip ones already in the world). Values come
 * from the connected book; a bookless import creates constructor stubs.
 */
/** The label `bindClass` derives for a ladder key, so a hand edit is visible. */
const ladderLabelFor = (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * Re-key a class ladder whose column has since been QUALIFIED.
 *
 * A ladder's key is the only part of a progression column that reaches a class
 * document — the printed header is a locator and is dropped at compile — so the
 * key is what a consumer reads to decide who a value applies to. A column keyed
 * without a qualifier its header states hands over a broader rule than the page
 * gives, and `importClasses` skips a class this world already holds, so no
 * ordinary re-import would ever correct one.
 *
 * Document-driven like `importTemplatePackages`: it compares each class against
 * the column keys the cookbook declares NOW, so no book need be connected and
 * no class is named here. A key the cookbook no longer declares is re-keyed
 * only when exactly ONE declared key is that same name behind a qualifier —
 * anything less certain is left alone rather than guessed at. The label moves
 * with the key only where it still reads as the one import derived; a Judge who
 * retitled the column keeps their title.
 *
 * @returns {Promise<number>} how many classes were corrected
 */
async function repairClassLadderKeys() {
  let repaired = 0;
  for (const [id, entry] of classEntries()) {
    const doc = await importedItem(id);
    if (doc?.type !== CLASS_ITEM_TYPE) continue;
    const ladders = doc.system?.ladders ?? [];
    if (!ladders.length) continue;
    const declared = (entry.fields?.progression?.cols ?? []).map((c) => String(c.key ?? ""));
    if (!declared.length) continue;
    let changed = false;
    const next = ladders.map((l) => {
      const key = String(l.key ?? "");
      if (!key || declared.includes(key)) return l;
      const lower = key.toLowerCase();
      const matches = declared.filter((d) => d.length > key.length && d.toLowerCase().endsWith(lower));
      if (matches.length !== 1) return l;
      changed = true;
      const label = l.label === ladderLabelFor(key) ? ladderLabelFor(matches[0]) : l.label;
      return { ...l, key: matches[0], label };
    });
    if (!changed) continue;
    await doc.update({ "system.ladders": next });
    repaired++;
  }
  if (repaired) console.warn(`${MODULE_ID} | re-keyed a qualified ladder on ${repaired} class(es) imported before the column carried its qualifier.`);
  return repaired;
}

export async function importClasses() {
  // The macro that runs this is labelled "(GM)" and is executable by every
  // seat. Without the guard a player with item-creation rights adds a second
  // set of all 31 classes to the world just by pressing it — which is what a
  // player browsing for a class to play does first.
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[CLASS_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the class item type is unavailable.`);
    return [];
  }
  // Correct what an earlier run keyed wrong BEFORE the loop below: a class this
  // world already holds is skipped there, so a repair written inside it would
  // never reach one.
  const repaired = await repairClassLadderKeys();
  const made = [];
  let skipped = 0;
  const gainsNode = await executeProfGains();
  const commonName = await executeCommonTongue();
  const gear = await materializedGearMenu();
  for (const [id, entry] of classEntries()) {
    if (await importedItem(id)) {
      skipped++;
      continue;
    }
    const doc = await claimImport(id, async () => {
      const found = cookbookEntry(id);
      const bookId = found ? bookOf(found) : null;
      const session = bookId ? ctx.sessionDocs.get(bookId) : null;
      let node = null;
      if (session) {
        node = await executeEntry(session.doc, found.cb, data.registers, id);
        if (!node?.ok) node = null;
      }
      const folder = (await ensureItemFolder(id))?.id ?? null;
      const built = bindClass(entry, node, id, { gains: classGainsFor(gainsNode, entry.name), commonName, gear });
      return createDoc(Item, { ...built, folder });
    });
    if (doc) made.push(doc);
  }
  await inheritRaceTongues(made);
  await syncRaceTongues(made);
  await materializeClassTemplates(made);
  ui.notifications?.info(
    `${MODULE_ID} | classes: ${made.length} imported, ${skipped} already present${repaired ? `, ${repaired} corrected` : ""}.`,
  );
  return made;
}

/**
 * Materialize template packages for a set of class documents: each printed
 * template row becomes a core `bundle` Item of repairable world documents,
 * and the class gains a generated 3d6 RollTable linking them. The classes
 * feature owns the shape (`materializeTemplates`) — this side only supplies
 * the folders. Idempotent; a no-op for a document that carries no template
 * rows.
 */
async function materializeClassTemplates(docs, { create = true } = {}) {
  const totals = { created: 0, relinked: 0, skippedEdited: 0, unresolved: 0 };
  let touched = 0;
  for (const doc of docs ?? []) {
    if (doc?.type !== CLASS_ITEM_TYPE || !(doc.system?.templates?.length > 0)) continue;
    // A relink-only pass creates no folders — it has nothing to file.
    const folder = create ? ((await ensureWorldFolderPath("Item", ["Class Templates", doc.name]))?.id ?? null) : null;
    const tableFolder = create ? ((await ensureWorldFolderPath("RollTable", ["Class Templates"]))?.id ?? null) : null;
    const report = await materializeTemplates(doc, { folder, tableFolder, create });
    for (const key of Object.keys(totals)) totals[key] += report?.[key]?.length ?? 0;
    touched++;
  }
  return touched ? totals : null;
}

/**
 * GM: build (or repair the links of) every class's template packages.
 * Document-driven — works off the class documents already in the world, so a
 * world imported long ago upgrades with NO book connected. Re-running never
 * clobbers a Judge's repair: an edited document is skipped and counted.
 */
export async function importTemplatePackages() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const targets = (await importedDocs("Item")).filter((i) => i.type === CLASS_ITEM_TYPE && (i.system?.templates?.length ?? 0) > 0);
  if (!targets.length) {
    ui.notifications?.info(`${MODULE_ID} | no class documents with template rows — import classes first.`);
    return null;
  }
  const totals = await materializeClassTemplates(targets);
  ui.notifications?.info(
    `${MODULE_ID} | template packages: ${totals.created} created, ${totals.relinked} relinked, ${totals.skippedEdited} skipped (edited).`,
  );
  return totals;
}

/* -------------------------------------------- */
/*  Traps (kind.trap → acks-extras.trap)        */
/* -------------------------------------------- */

/* -------------------------------------------- */
/*  Vehicles (kind.vehicle → the vehicle actor) */
/* -------------------------------------------- */

/** The vehicle ACTOR sub-type — the vehicles feature's own constant, not an item. */
const VEHICLE_ACTOR_TYPE = VEHICLE_TYPE;

/**
 * "60’/30’" → [60, 30]; "12 / 6" → [12, 6]; "80" → [80].
 *
 * A segment carrying no digit yields NOTHING rather than zero. The table
 * prints "By creature" where a howdah's pace belongs, and an absent cell is
 * absent; reading either as 0 would give a vehicle a capacity of nought and a
 * speed of nought, both of which look like facts read off the page.
 */
const printedPair = (cell) =>
  String(cell ?? "")
    .split("/")
    .map((s) => String(s).replace(/[^\d.]/g, ""))
    .filter((s) => s !== "")
    .map(Number)
    .filter((n) => Number.isFinite(n));

/**
 * One printed row of the vehicle table as an `acks-extras.vehicle`.
 *
 * The table states movement and cargo as PAIRS, and the column notes say what
 * a pair means: the first figure is at normal encumbrance, the second at
 * heavy. So the two become speed TIERS rather than one capacity beside one
 * speed — a cart hauling its heavy load moves at the slower rate, and the tier
 * row is where the vehicle model already looks for that.
 *
 * A cargo figure in PARENTHESES is the table's other convention: the vehicle
 * carries passengers or that much cargo instead. Those rows are the howdahs,
 * whose crew column is a choice between two passenger counts rather than a
 * complement — so they fill `cargo.passengers`, not a crew role, and they get
 * no speed tiers because their pace is the creature's, not the vehicle's.
 *
 * Deliberately NOT read: the draft team. The label names it in prose ("2 heavy
 * horses", "4 light horses"), and converting those into the heavy-horse
 * equivalents the schema counts is a judgment about draft values rather than a
 * reading of this table.
 */
export function bindVehicleRow(row, entry, id) {
  if (entry?.meta?.kindOfVehicle === "sea") return bindSeaVesselRow(row, entry, id);
  const cells = row?.cells ?? {};
  // Presentation only: the table sets each row's first letter as a small
  // capital, which extracts lowercase ("cart, Large"), and a comma at a line
  // break loses its following space ("Howdah,riding"). Neither is content.
  const label = String(row?.label ?? "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase());
  const cargoRaw = String(cells.cargo ?? "").trim();
  const trades = /^\(.*\)$/.test(cargoRaw);
  const cargo = printedPair(cargoRaw);
  const speeds = printedPair(cells.movement);
  const crewRaw = String(cells.crew ?? "").trim();

  const roles = [];
  let passengers = 0;
  const orChoice = /^(\d+)\s*or\s*(\d+)$/i.exec(crewRaw);
  const plus = /^(\d+)\s*\+\s*(\d+)$/.exec(crewRaw);
  if (orChoice) passengers = Number(orChoice[1]);
  else if (plus) {
    roles.push({ key: "driver", label: "Driver", required: Number(plus[1]), aboard: 0, motive: true });
    roles.push({ key: "warriors", label: "Warriors", required: Number(plus[2]), aboard: 0, motive: false });
  } else if (/^\d+$/.test(crewRaw)) {
    roles.push({ key: "driver", label: "Driver", required: Number(crewRaw), aboard: 0, motive: true });
  }

  const tiers = cargo
    .map((maxLoadStone, i) => ({ maxLoadStone, feetPerTurn: speeds[i] ?? speeds[0] ?? 0, team: 0 }))
    .filter((t) => t.maxLoadStone > 0);

  return {
    name: label,
    type: VEHICLE_ACTOR_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by. A row claims its own id
    // so removal is per vehicle, matching how they were created.
    flags: { [MODULE_ID]: { cookbook: { id: `${id}.${rowClaimKey(row)}`, cite: entry.cite ?? "" } } },
    system: {
      kind: "land",
      source: { book: entry.book ?? "rr", cite: entry.cite ?? "", ref: id },
      description: bookText([], entry.cite ?? "", { id }),
      ...(cargo.length ? { cargo: { capacityStone: cargo[0], ...(passengers ? { passengers } : {}) } } : {}),
      ...(roles.length ? { crew: { roles } } : {}),
      ...(tiers.length && !trades ? { speeds: { tiers } } : {}),
      ...(Number.isFinite(Number(cells.ac)) ? { ac: Number(cells.ac) } : {}),
      ...(Number.isFinite(Number(cells.shp)) ? { shp: { value: Number(cells.shp), max: Number(cells.shp) } } : {}),
    },
  };
}

/**
 * One printed row of the Sea Vessels table as a sea `acks-extras.vehicle`.
 *
 * The sea table's conventions differ from the land one's: three crew columns
 * are three ROLE complements (sailors and rowers motive, marines not — they
 * are cargo that fights); four combat speeds and two voyage speeds land on
 * the schema's named sea fields rather than tiers; cargo is a single figure,
 * never a pair. A dash is an absent cell, not a zero — a barge has no rowers
 * rather than nought of them. A PARENTHESISED marines figure (the longship)
 * is an allowance drawn from the crew itself rather than an extra
 * complement; it binds as the bench size all the same, because the schema's
 * `required` on a non-motive role is a bench, not extra manpower. Cost is
 * the markets' business, not the hull's, and is not read.
 */
function bindSeaVesselRow(row, entry, id) {
  const cells = row?.cells ?? {};
  // Same presentation repairs as the land binder, plus one of its own: this
  // table prints Title Case after the comma ("Boat, Row") and the small-cap
  // R extracts lowercase. The land table genuinely prints lowercase there
  // ("Howdah, riding"), so the repair stays sea-side.
  const label = String(row?.label ?? "")
    .replace(/\s*,\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[a-z]/, (c) => c.toUpperCase())
    .replace(/, ([a-z])/g, (_m, c) => `, ${c.toUpperCase()}`);
  const num1 = (cell) => {
    const v = printedPair(cell);
    return v.length ? v[0] : null;
  };

  const roles = [];
  const complement = (key, label_, cell, motive) => {
    const n = num1(cell);
    if (n != null && n > 0) roles.push({ key, label: label_, required: n, aboard: 0, motive });
  };
  complement("sailors", "Sailors", cells.sailors, true);
  complement("rowers", "Rowers", cells.rowers, true);
  complement("marines", "Marines", cells.marines, false);

  const speeds = {};
  const speed = (key, cell) => {
    const n = num1(cell);
    if (n != null) speeds[key] = n;
  };
  speed("oarSprint", cells.oarSprint);
  speed("oarCruise", cells.oarCruise);
  speed("oarSlow", cells.oarSlow);
  speed("sail", cells.sail);
  speed("voyageOar", cells.voyageOar);
  speed("voyageSail", cells.voyageSail);

  const cargo = num1(cells.cargo);
  const shp = num1(cells.shp);
  return {
    name: label,
    type: VEHICLE_ACTOR_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    flags: { [MODULE_ID]: { cookbook: { id: `${id}.${rowClaimKey(row)}`, cite: entry.cite ?? "" } } },
    system: {
      kind: "sea",
      source: { book: entry.book ?? "rr", cite: entry.cite ?? "", ref: id },
      description: bookText([], entry.cite ?? "", { id }),
      ...(cargo != null ? { cargo: { capacityStone: cargo } } : {}),
      ...(roles.length ? { crew: { roles } } : {}),
      ...(Object.keys(speeds).length ? { speeds } : {}),
      ...(Number.isFinite(Number(cells.ac)) ? { ac: Number(cells.ac) } : {}),
      ...(shp != null ? { shp: { value: shp, max: shp } } : {}),
    },
  };
}

/**
 * What makes one table ROW distinct from its neighbours, for the dedup claim.
 *
 * NOT the grid's own row key, which is `slugLabel` of the label and therefore
 * drops the parenthetical: "Cart, Large (1 heavy horse)" and "(2 heavy horses)"
 * both slug to `cartLarge`, and a claim on that silently skips the second as
 * already imported. The table distinguishes those rows ONLY by the
 * parenthetical — it is the team, and it is what changes the cargo — so the
 * claim is folded from the whole printed label.
 */
export const rowClaimKey = (row) =>
  String(row?.label ?? row?.key ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "") || String(row?.key ?? "row");

/** Every kind.vehicle [id, entry] across the content cookbooks. */
export function* vehicleEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.vehicle") yield [defId, e];
    }
  }
}

/**
 * Import the printed vehicles, one ACTOR per table row.
 *
 * Unlike every other binding here this makes actors, because a vehicle is one:
 * it carries an inventory, a crew and a token. The dedup claim is per ROW and
 * not per entry — one register entry covers the whole table, so claiming the
 * entry id would make a second run skip every remaining vehicle because the
 * first row already existed.
 */
export async function importVehicles() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  if (!CONFIG.Actor.dataModels?.[VEHICLE_ACTOR_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the vehicle actor type is unavailable.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of vehicleEntries()) {
    const found = cookbookEntry(id);
    const bookId = found ? bookOf(found) : null;
    const session = bookId ? ctx.sessionDocs.get(bookId) : null;
    if (!session) continue; // the book is not connected; there is nothing to read
    const node = await executeEntry(session.doc, found.cb, data.registers, id);
    if (!node?.ok) continue;
    for (const grid of Object.values(node.fields?.grids ?? {})) {
      for (const row of grid?.rows ?? []) {
        const rowId = `${id}.${rowClaimKey(row)}`;
        if (await importedActor(rowId)) {
          skipped++;
          continue;
        }
        const doc = await claimActorImport(rowId, async () => {
          // The ACTOR rule, like every other actor importer — a vehicle asking
          // for an Item folder got an Item-typed folder for an Actor, and every
          // row ended up loose at the top of the Actors tree.
          const folder = (await actorFolderFor(id, found))?.id ?? null;
          return createDoc(Actor, { ...bindVehicleRow(row, entry, id), folder });
        });
        if (doc) made.push(doc);
      }
    }
  }
  ui.notifications?.info(`${MODULE_ID} | vehicles: ${made.length} imported, ${skipped} already present.`);
  return made;
}

/* -------------------------------------------- */
/*  Variations (kind.variation → acks-extras.*) */
/* -------------------------------------------- */

/** Sixths of a stone, the unit the family weighs everything in. */
const SIXTHS_PER_STONE = 6;

/**
 * Build one `acks-extras.variation` from an entry and its materialized numbers.
 *
 * The register says what KIND of difference this is, what it may go on, and
 * what it supersedes — all structure, none of it read off a page. Every number
 * comes from `node.fields.variation`, which the executor located in the seat's
 * own prose; a locator that did not match drops its whole spec, so a field is
 * either the book's number or absent, never a default wearing the book's
 * authority.
 *
 * `deltas.stoneLighter` is the one translation: the page says an item "weighs
 * one less stone" and the schema counts sixths, so the located stone count is
 * negated and scaled. That is a change of unit, not of value.
 */
export function bindVariation(entry, node, id) {
  const meta = entry.meta ?? {};
  const cite = entry.cite ?? "";
  const deltas = {};
  const cost = {};
  const data = {};
  for (const found of node?.fields?.variation ?? []) {
    const amount = Number(found?.amount);
    if (!Number.isFinite(amount)) continue;
    switch (found.field) {
      case "deltas.bonus":
      case "deltas.damage":
      case "deltas.ac":
        deltas[found.field.split(".")[1]] = amount;
        break;
      case "deltas.stoneLighter":
        deltas.weight6 = -amount * SIXTHS_PER_STONE;
        break;
      case "cost.add":
      case "cost.mul":
      case "cost.baseMul":
        cost[found.field.split(".")[1]] = amount;
        break;
      default:
        // `data.<key>` is the open half of the schema: what a variation records
        // about ITSELF, against the specs in `dataFields`. A shield's armour
        // class and encumbrance land here rather than in `deltas` because they
        // are not one number added to the item — they differ by how the shield
        // is being carried, and the consumer that will read them keys on the
        // enum rather than summing. Keyed so it can be read later; prose could
        // not be.
        if (found.field?.startsWith("data.")) data[found.field.slice(5)] = amount;
        break; // a field this version does not know is left for a later one
    }
  }
  return {
    name: entry.name,
    type: VARIATION_ITEM_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; without it a world could
    // import these and never get them back out.
    flags: { [MODULE_ID]: { cookbook: { id, cite } } },
    system: {
      key: meta.key ?? "",
      kind: meta.variationKind ?? "",
      appliesTo: meta.appliesTo ?? [],
      supersedes: meta.supersedes ?? [],
      ...(Object.keys(deltas).length ? { deltas } : {}),
      ...(Object.keys(cost).length ? { cost } : {}),
      // What this variation records about itself, and the specs to read it by.
      // `dataFields` is the SHAPE and ships from the register; `data` is the
      // page's numbers and does not.
      ...(Object.keys(data).length ? { data } : {}),
      ...(meta.dataFields?.length ? { dataFields: meta.dataFields } : {}),
      ...(Object.keys(data).length ? { data } : {}),
      ...(meta.dataFields ? { dataFields: meta.dataFields } : {}),
      source: { book: entry.book ?? "rr", cite, ref: id },
      description: entryText(node, id, cite),
    },
  };
}

/** Every kind.variation [id, entry] across the content cookbooks. */
export function* variationEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.variation") yield [defId, e];
    }
  }
}

/**
 * Import the published variations, one document per purchasable difference.
 *
 * Guarded twice for the same two reasons the traps are: a player pressing a GM
 * macro would mint a second set, and a world without acks-extras has no
 * variation data model to put them in.
 */
export async function importVariations() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[VARIATION_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the variation item type is unavailable.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of variationEntries()) {
    if (await importedItem(id)) {
      skipped++;
      continue;
    }
    const doc = await claimImport(id, async () => {
      const found = cookbookEntry(id);
      const bookId = found ? bookOf(found) : null;
      const session = bookId ? ctx.sessionDocs.get(bookId) : null;
      let node = null;
      if (session) {
        node = await executeEntry(session.doc, found.cb, data.registers, id);
        if (!node?.ok) node = null;
      }
      const folder = (await ensureItemFolder(id))?.id ?? null;
      return createDoc(Item, { ...bindVariation(entry, node, id), folder });
    });
    if (doc) made.push(doc);
  }
  ui.notifications?.info(`${MODULE_ID} | variations: ${made.length} imported, ${skipped} already present.`);
  return made;
}

/** 1st through 6th: the levels the Judge's book prints every trap at. */
const TRAP_LEVELS = 6;

/**
 * Where one printed level begins.
 *
 * The book sets each tier as "1st level:" inside one flowed paragraph, so the
 * split is the book's OWN numbering rather than a reading of what the sentence
 * means — the same kind of structural split `parseEquipment` makes on a
 * starting-equipment cell. The ordinal is a superscript run in the PDF and
 * survives extraction, so it anchors the split; the digit is what is captured,
 * because that is the level being stated.
 */
const TIER_RE = /(\d)\s*(?:st|nd|rd|th)\s*level\s*:\s*/gi;

/** First dice expression in a tier's sentence, or "" — the frozen `dice` shape. */
const TIER_DICE = /\b\d+d\d+(?:\s*[+-]\s*\d+)?\b/;

/**
 * Split a trap's materialized description into the part that describes the trap
 * and the six that describe its levels.
 *
 * Everything before the first tier marker is the trap; each marker opens a
 * level and runs to the next. A trap whose text carries no marker at all yields
 * six empty rows and keeps the whole passage as the description, which is the
 * right answer for a book that phrased one differently — nothing is dropped and
 * nothing is invented.
 *
 * @param {string[]} blocks the `text` op's paragraphs, in reading order
 * @returns {{description: string, levels: object[]}}
 */
export function splitTrapTiers(blocks = []) {
  const whole = blocks.map((b) => String(b ?? "").trim()).filter(Boolean).join(" ").replace(/\s+/g, " ");
  const marks = [...whole.matchAll(TIER_RE)];
  const levels = Array.from({ length: TRAP_LEVELS }, () => ({ text: "", damageFormula: "" }));
  if (!marks.length) return { description: whole, levels };

  const description = whole.slice(0, marks[0].index).trim();
  for (let i = 0; i < marks.length; i++) {
    const level = Number(marks[i][1]);
    if (!Number.isFinite(level) || level < 1 || level > TRAP_LEVELS) continue;
    const from = marks[i].index + marks[i][0].length;
    const text = whole.slice(from, marks[i + 1]?.index ?? whole.length).trim();
    // A book that states a level twice gets the LAST word, not a concatenation:
    // rewriting is what a reprint does, and two half-sentences would be neither.
    levels[level - 1] = { text, damageFormula: TIER_DICE.exec(text)?.[0]?.replace(/\s+/g, "") ?? "" };
  }
  return { description, levels };
}

/**
 * Build one `acks-extras.trap` from a trap entry and its materialized text.
 *
 * Only two things are read out of the seat's prose: the tier SPLIT, which is
 * the book's own numbering, and the damage dice, which is the frozen `dice`
 * locate. Everything a Judge would have to JUDGE — whether the throw is a save
 * or an attack, which save, what beating it is worth, how far the effect
 * reaches — is left at its default with the printed sentence sitting beside it
 * on the sheet. Guessing those is exactly the interpretation the pipeline keeps
 * offline, and a wrong-but-plausible save key is worse than a blank one.
 */
export function bindTrap(entry, node, id) {
  const cite = entry.cite ?? "";
  const blocks = (node?.fields?.description ?? []).map((p) => (typeof p === "string" ? p : (p?.text ?? "")));
  const { description, levels } = splitTrapTiers(blocks);
  return {
    name: entry.name,
    type: TRAP_ITEM_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; without it a world could
    // import these and never get them back out.
    flags: { [MODULE_ID]: { cookbook: { id, cite } } },
    system: {
      source: { book: entry.book ?? "jj", cite, ref: id },
      // The passage that precedes the first tier is the trap's description;
      // the plain split above is what fills the rows.
      description: bookText([description], cite, { id }),
      level: 1,
      levels: levels.map((row) => ({ text: row.text, damageFormula: row.damageFormula })),
    },
  };
}

/** Every kind.trap [id, entry] across the content cookbooks. */
export function* trapEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.trap") yield [defId, e];
    }
  }
}

/**
 * Import the printed traps, one document per trap, all six levels on it.
 *
 * Guarded twice, for the two ways this fails without one: a player pressing a
 * GM macro would mint a second set of thirteen, and a world without acks-extras
 * has no trap data model to put them in.
 */
export async function importTraps() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[TRAP_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the trap item type is unavailable.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of trapEntries()) {
    if (await importedItem(id)) {
      skipped++;
      continue;
    }
    const doc = await claimImport(id, async () => {
      const found = cookbookEntry(id);
      const bookId = found ? bookOf(found) : null;
      const session = bookId ? ctx.sessionDocs.get(bookId) : null;
      let node = null;
      if (session) {
        node = await executeEntry(session.doc, found.cb, data.registers, id);
        if (!node?.ok) node = null;
      }
      const folder = (await ensureItemFolder(id))?.id ?? null;
      return createDoc(Item, { ...bindTrap(entry, node, id), folder });
    });
    if (doc) made.push(doc);
  }
  ui.notifications?.info(`${MODULE_ID} | traps: ${made.length} imported, ${skipped} already present.`);
  return made;
}

/**
 * Re-execute and REWRITE every imported class document's generated surface
 * (name, img, the whole system object). Class documents are wholly generated
 * in this phase — a hand-tuned document keeps its edits only until Update;
 * the confirm says so.
 */
export async function cookbookUpdateClasses() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (rewrites items).`);
  const byId = new Map(classEntries());
  const targets = (await importedDocs("Item")).filter((i) => {
    const cid = i.flags?.[MODULE_ID]?.cookbook?.id;
    return i.type === CLASS_ITEM_TYPE && cid && byId.has(cid);
  });
  if (!targets.length) {
    ui.notifications?.info(`${MODULE_ID} | no imported class documents to update.`);
    return 0;
  }
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: "Update Classes" },
    content: `<p>Rewrite ${targets.length} imported class document(s) from the connected book? Hand edits on them are replaced.</p>`,
    modal: true,
  });
  if (!ok) return 0;
  let updated = 0;
  const gainsNode = await executeProfGains();
  const commonName = await executeCommonTongue();
  const gear = await materializedGearMenu();
  for (const item of targets) {
    const id = item.flags[MODULE_ID].cookbook.id;
    const entry = byId.get(id);
    const found = cookbookEntry(id);
    const bookId = found ? bookOf(found) : null;
    const session = bookId ? ctx.sessionDocs.get(bookId) : null;
    let node = null;
    if (session) {
      node = await executeEntry(session.doc, found.cb, data.registers, id);
      if (!node?.ok) node = null;
    }
    const doc = bindClass(entry, node, id, { gains: classGainsFor(gainsNode, entry.name), commonName, gear });
    const tongues = doc.flags?.[MODULE_ID]?.tongues;
    await item.update({
      name: doc.name,
      ...(doc.img ? { img: doc.img } : {}),
      system: doc.system,
      ...(tongues ? { [`flags.${MODULE_ID}.tongues`]: tongues } : {}),
    });
    updated++;
  }
  await inheritRaceTongues(targets);
  await syncRaceTongues(targets);
  // The update above replaced each document's whole `system`, which wipes the
  // rows' cached bundle uuids — this re-derives them from the bundles' own
  // flags and re-strips the arrays it restored, so a package is never handed
  // over twice.
  await materializeClassTemplates(targets);
  ui.notifications?.info(`${MODULE_ID} | classes updated: ${updated}.`);
  return updated;
}

/** Every [id, entry] pair across the content cookbooks that IS an ability. */
export function* abilityEntries() {
  for (const cb of data.content.values()) {
    for (const [id, entry] of Object.entries(cb.entries)) {
      if (isAbilityEntry(entry)) yield [id, entry];
    }
  }
}

/** Every definition id the shipped content-type cookbooks carry as an ability. */
export const cookbookAbilityIds = () => [...abilityEntries()].map(([id]) => id);

/* -------------------------------------------- */
/*  Equipment                                   */
/* -------------------------------------------- */

/**
 * The core item type an equipment entry becomes.
 *
 * Everything used to import as `item`, so a sword was a sack: no damage, no
 * attack, and — because `equipped` lives only on `weapon` and `armor` — nothing
 * the character could actually wield or wear. The register says which group an
 * entry belongs to, so the type follows from data rather than from a name scan.
 *
 * `animal` is deliberately NOT here: a mule is a creature, not a thing, and it
 * imports as an actor. See importEquipment.
 */
const EQUIPMENT_TYPE = Object.freeze({
  weapon: "weapon",
  armor: "armor",
  shield: "armor", // the system models a shield as armour with type "shield"
});

/** The core item type for an entry, defaulting to plain inventory. */
export const equipmentTypeOf = (entry) => EQUIPMENT_TYPE[entry?.meta?.group] ?? "item";

/**
 * The numbers a `values` recipe located in the seat's own prose, as the flat
 * fields the binding reads (`aac`, `cost`, `weight6`).
 *
 * The recipe names the field AND the unit the page states it in, because the
 * page and the schema do not agree on one: encumbrance prints in stone or in
 * items, and `weight6` counts sixths of a stone. Converting here is a change of
 * UNIT, not of value — the same translation `bindVariation` makes for a
 * masterwork's lighter stone, and the reason a locator may not simply write
 * whatever integer it read into the field.
 *
 * A field this version does not know is skipped rather than guessed at, so a
 * later recipe can name one without this one mangling it.
 */
export function locatedValues(node) {
  const out = {};
  for (const found of node?.fields?.values ?? []) {
    const amount = Number(found?.amount);
    if (!Number.isFinite(amount)) continue;
    switch (found.field) {
      case "aac":
      case "cost":
      case "weight6":
        out[found.field] = amount;
        break;
      case "weight6.stone":
        out.weight6 = amount * SIXTHS_PER_STONE;
        break;
      case "weight6.item":
        // An "item" IS the sixth-stone unit: the page's count is already the
        // number the schema wants.
        out.weight6 = amount;
        break;
      default:
        break;
    }
  }
  return out;
}

/**
 * Bind an equipment entry to the core item it should become. Mirrors
 * bindAbility's posture: the cookbook pre-declares NOTHING the page says —
 * name + citation always; the descriptor text is whatever the page yielded;
 * cost and weight materialize only when a chef-authored locator lands on the
 * register row (none ship yet, so they default to core's 0 and the printed
 * table governs — the entry says so via its unaudited marker).
 *
 * The TYPE-SPECIFIC fields follow the same rule. A weapon's damage and an
 * armour's AC are page values: absent a locator that read them from the seat's
 * own book, the item is created with the system's defaults and the printed
 * table governs. What the type buys even with nothing extracted is the
 * behaviour — a weapon can be equipped, attacks, and takes a fighting style;
 * armour can be worn and counts toward AC — which an `item` never could.
 */
export function bindEquipment(entry, node, id) {
  const cite = entry.cite ?? "";
  const meta = entry.meta ?? {};
  const f = { ...(node?.fields ?? {}), ...locatedValues(node) };
  let type = equipmentTypeOf(entry);

  // EQUIPMENT ROOT (acks-extras, optional). That module owns the rule mapping a
  // gear NAME to the core item type and stats it should carry; the rules live
  // there and are never baked here. Absent the module, the register's own type
  // stands. See acks-extras docs/equipment/DECISIONS.md § The equipment root.
  const klass = equipmentClass(entry.name) ?? null;
  if (klass?.type) type = klass.type;

  // Fields that exist only on the chosen type. `item` keeps subtype/quantity;
  // weapon and armor have neither and would fail validation if handed them.
  const typed = {};
  if (type === "item") {
    typed.subtype = meta.subtype === "clothing" ? "clothing" : "item";
    typed.quantity = { value: 1, max: 0 };
  } else if (type === "weapon") {
    // Prefer a page-extracted value; fall back to the equipment root's RAW stat
    // for gear the weapons table never listed (a torch's 1d4 is a rule, not a
    // table cell). melee/missile likewise.
    const damage = f.damage ?? (klass?.damage || undefined);
    if (damage) typed.damage = damage;
    if (Number.isFinite(f.bonus)) typed.bonus = f.bonus;
    const melee = typeof f.melee === "boolean" ? f.melee : klass?.melee;
    const missile = typeof f.missile === "boolean" ? f.missile : klass?.missile;
    if (typeof melee === "boolean") typed.melee = melee;
    if (typeof missile === "boolean") typed.missile = missile;
    if (f.range) typed.range = f.range;
    // NB: a weapon-torch is a SINGLE wielded torch — core weapons carry no
    // `quantity` field, so it cannot be a stack. It is "consumable" only in that
    // it burns out on its timer (acks-formation). A supply of torches is a
    // stackable `item`, which keeps its quantity and decrements when lit.
  } else if (type === "armor") {
    if (Number.isFinite(f.aac)) typed.aac = { value: f.aac };
    // The system's armour `type` choices are unarmored/veryLight/light/medium/
    // heavy/shield. A shield entry is that type by definition; anything else
    // waits for the page to say so rather than being guessed from its weight.
    if (meta.group === "shield") typed.type = "shield";
    else if (f.armorType) typed.type = f.armorType;
  }

  // What acks-extras is told about the document, in ITS scope (see the flags
  // block below). A shield FORM is one of these: the register names which form
  // the entry is, the overlay owns what the form does, and the item carries the
  // ordinary AC its own page states so the overlay has something to correct.
  const extras = {
    ...(klass?.light ? { light: true } : {}),
    ...(meta.shieldVariant ? { shieldVariant: meta.shieldVariant } : {}),
  };

  return {
    name: entry.name,
    type,
    img: abilityIcon(entry),
    system: {
      description: entryText(node, id, cite),
      ...typed,
      // Page values — present only when a locator materialized them from the
      // seat's own book. Absent locators leave core's defaults.
      ...(Number.isFinite(f.cost) ? { cost: f.cost } : {}),
      ...(Number.isFinite(f.weight6) ? { weight6: f.weight6 } : {}),
    },
    flags: {
      [MODULE_ID]: {
        // Our own provenance: bookkeeping for re-import, update and prune.
        cookbook: { id, cite, unaudited: !entry.audited },
        minted: true,
        // These markers are equipment's, not ours — it writes the SAME markers
        // in this scope (the light when it readies a torch, in
        // equipment/actions.mjs; the shield form when a Judge picks one off
        // the item sheet) and its sheets, overlays and formation layers read
        // them from here. Omitting them would leave an imported torch
        // invisible to both, and an imported shield form a plain shield. The
        // rule of WHICH names are lights is the equipment root's and WHAT a
        // form does is the overlay's; we only record the verdict.
        ...extras,
      },
    },
  };
}

/**
 * What a printed animal name says the creature is trained for.
 *
 * The RR prices animals BY ROLE — "Horse, Heavy War", "Mule, Draft",
 * "Camel, Riding", "Dog, Hunting" — so the qualifier in the name the book
 * printed IS its statement of training, and the words it uses are the same
 * set acks-extras' `ANIMAL_TRAINING` enumerates. Reading a qualifier out of a
 * name the seat's own book supplied is extraction like any other: no roster of
 * animals and no rate is shipped here, only the name-form rule.
 */
export function trainingFromName(name) {
  const n = String(name ?? "").toLowerCase();
  if (/\bwar\b/.test(n)) return "war";
  if (/\briding\b/.test(n)) return "riding";
  if (/\bdraft\b|\bdraught\b/.test(n)) return "draft";
  if (/\bhunting\b/.test(n)) return "hunting";
  if (/\bherding\b|\bshepherd\b/.test(n)) return "herding";
  return null;
}

/** The species a printed animal name heads with: "Horse, Heavy War" → "horse". */
export const animalSpecies = (name) => String(name ?? "").split(",")[0].trim().toLowerCase();

/**
 * Which species the reader's book prices in a RIDING form.
 *
 * Training and mountability are different questions and the book answers them
 * differently: a war DOG is trained for war and is still not a mount. What the
 * page states is that some species are sold to be ridden — so a species with a
 * riding row is mountable in every form it is sold in, and one without is not
 * marked either way. Computed from the entries actually loaded, so it says
 * what THIS book prints.
 */
export function mountableSpecies(entries) {
  const out = new Set();
  for (const e of entries ?? []) {
    if (e?.meta?.group !== "animal") continue;
    if (trainingFromName(e.name) === "riding") out.add(animalSpecies(e.name));
  }
  return out;
}

/**
 * The loads an animal's own printed description states, in SIXTHS of a stone
 * (the family's one weight unit).
 *
 * The RR gives each animal its carrying capacity in prose — "a normal load of
 * 30 stone and maximum load of 60 stones" — beside the speed. That sentence is
 * already imported as the creature's description, so reading the two figures
 * out of the seat's own text adds no geometry and ships no value: an animal
 * whose book says nothing simply arrives unstated.
 */
export function loadsFromText(text) {
  const t = String(text ?? "").toLowerCase().replace(/\s+/g, " ");
  const grab = (re) => {
    const m = re.exec(t);
    return m ? Number(m[1]) : null;
  };
  const normal = grab(/normal load of ([\d,]+) stones?/);
  const max = grab(/maximum load of ([\d,]+) stones?/);
  const six = (st) => (st == null ? null : Math.round(st * 6));
  return { unencumbered6: six(normal), capacity6: six(max) };
}

/**
 * The land speed an animal's description states, in feet per turn — the first
 * of the printed pair ("a speed of 60' / 180'"), which is the exploration
 * figure every other speed in the family derives from.
 */
export function speedFromText(text) {
  const m = /speed of ([\d,]+)\s*[’']/.exec(String(text ?? "").replace(/\s+/g, " "));
  return m ? Number(m[1].replace(/,/g, "")) : null;
}

/** Every animal-group entry the loaded cookbooks hold. */
export function loadedAnimalEntries() {
  const out = [];
  for (const store of [data.books, data.content]) {
    for (const cb of store.values()) {
      for (const e of Object.values(cb.entries ?? {})) if (e?.meta?.group === "animal") out.push(e);
    }
  }
  return out;
}

/**
 * Bind an `animal` equipment entry to an ACTOR instead of an item.
 *
 * The RR equipment chapter prices ten animals because you buy them in a shop,
 * but a war dog is a creature: it fights, it can be attacked, it has morale,
 * and it can be ridden. Imported as inventory it was none of those — the system
 * had it filed next to the rope.
 *
 * Requires ACKS Extras, which supplies the `acks-extras.animal` sub-type. Without it
 * there is nowhere for a creature to go, so the entry stays an item rather than
 * failing the import; the caller decides.
 */
export function bindAnimal(entry, node, id, { ridable = null } = {}) {
  const cite = entry.cite ?? "";
  const f = node?.fields ?? {};
  // A field the book supplied always wins; the name-form rule fills the gap
  // the animal entries leave, so an imported war horse arrives FLAGGED rather
  // than defaulting to untrained and unridable.
  const training = f.training ?? trainingFromName(entry.name);
  // The creature's own printed description states what it carries and how
  // fast it goes; a field the book supplied directly still wins.
  const prose = entryText(node, id, cite);
  const loads = loadsFromText(prose);
  const six = (v) => (Number.isFinite(v) ? v / 6 : null);
  const normalSt = Number.isFinite(f.unencumbered6) ? six(f.unencumbered6) : six(loads.unencumbered6);
  const capacitySt = Number.isFinite(f.capacity6) ? six(f.capacity6) : six(loads.capacity6);
  const loadFlags = normalSt == null && capacitySt == null
    ? null
    : {
        ...(normalSt != null ? { normal: normalSt } : {}),
        ...(capacitySt != null ? { capacity: capacitySt } : {}),
      };
  const movement = Number.isFinite(f.movement) ? f.movement : speedFromText(prose);
  const species = animalSpecies(entry.name);
  const mountable = typeof f.mountable === "boolean"
    ? f.mountable
    : (ridable ?? mountableSpecies(loadedAnimalEntries())).has(species) || null;
  return {
    name: entry.name,
    type: ANIMAL_TYPE,
    img: abilityIcon(entry),
    system: {
      // ONE details object. Spreading a second `details` later would replace
      // this one wholesale and silently drop the citation.
      details: {
        biography: prose,
        ...(Number.isFinite(f.morale) ? { morale: f.morale } : {}),
      },
      animal: {
        species: entry.name,
        // Everything below is a PAGE VALUE: present only if the seat's book
        // supplied it. Nothing about an animal's price, load or speed ships.
        ...(Number.isFinite(f.cost) ? { cost: f.cost } : {}),
        ...(typeof mountable === "boolean" ? { mountable } : {}),
        ...(training ? { training } : {}),
      },
      ...(Number.isFinite(movement) ? { movement: { base: movement } } : {}),
    },
    flags: {
      [MODULE_ID]: {
        cookbook: { id, cite, unaudited: !entry.audited },
        minted: true,
        // A creature's carrying capacity has ONE live store — the one
        // `capacity6()` reads and the monster sheet edits — so the loads read
        // off this animal's own description are written there, in the stone
        // the page prints, rather than to the animal sub-type's like-named
        // fields, which nothing consumes.
        ...(loadFlags ? { extras: { load: loadFlags } } : {}),
      },
    },
  };
}

/** Can this seat file animals as creatures? False before `game.actors` exists. */
const canImportAnimals = () => !!game.actors;

/** Does this entry describe a creature rather than a thing? */
const isAnimalEntry = (entry) => entry?.meta?.group === "animal";

/**
 * Import one equipment entry, deduped by cookbook id.
 *
 * Most entries become world ITEMS. An animal becomes an ACTOR — a mule is a
 * creature you buy, not a thing you carry — provided ACKS Extras is present to
 * supply the sub-type. Without it the animal falls back to an item rather than
 * failing the import, because a bookless, lib-less seat should still get the
 * shop list.
 *
 * Bookless seats still get the document — name, icon, citation stub — the same
 * bring-your-own-book posture as abilities.
 */
export async function importEquipment(id, folderId) {
  const found = cookbookEntry(id);
  if (!found) return null;

  const asActor = isAnimalEntry(found.entry) && canImportAnimals();
  // Ask the collection imports actually go to. Reading `game.items` outright
  // was right only while every import landed in the world: with
  // `importToCompendium` on, the check looked somewhere nothing is ever
  // written and every run re-created the whole shop list. An animal is an
  // ACTOR, so it is asked of the actor side of the same target.
  const existing = asActor ? await importedActor(id) : await importedItem(id);
  if (existing) return existing;

  const build = async () => {
    const bookId = bookOf(found);
    const session = ctx.sessionDocs.get(bookId);
    let node = null;
    if (session) {
      node = await executeEntry(session.doc, found.cb, data.registers, id);
      if (!node?.ok) node = null;
    }
    return node;
  };

  if (asActor) {
    const node = await build();
    // The one actor destination rule (actorFolderFor → the "Animals" home).
    const folder = (await actorFolderFor(id, found))?.id ?? null;
    return createDoc(Actor, { ...bindAnimal(found.entry, node, id), folder });
  }

  return claimImport(id, async () => importEquipmentItem(found, id, folderId, await build()));
}

/** Build and create the ITEM half of an equipment import (the claimed body). */
async function importEquipmentItem(found, id, folderId, node) {
  const folder = folderId ?? (await ensureItemFolder(id))?.id ?? null;
  const doc = bindEquipment(found.entry, node, id);
  // Enrich gear/clothing with cost/weight from the RR price grids (p131/p132),
  // materialized per-seat. A general category with several priced variants
  // stays unpriced (priceFor returns null) rather than take a guessed variant.
  if (["gear", "clothing"].includes(found.entry.meta?.group)) {
    const priced = priceFor(await gearPriceMap(), found.entry.name);
    if (priced?.cost != null) doc.system.cost = priced.cost;
    if (priced?.weight6 != null) doc.system.weight6 = priced.weight6;
  }
  // What the grids do not price, the entry's own paragraphs often do — the
  // "Cost: 25gp" run-in, a stated stone weight, a stated damage die (the BTA
  // dwarven chapter prints all three in prose). Page values, per seat.
  if (node?.fields?.description) {
    const prose = node.fields.description.map((p) => p.text ?? "").join(" ");
    if (!doc.system.cost) {
      const m = /Cost:?\s{0,8}([\d,]+(?:\.\d+)?)\s*(gp|sp|cp)/i.exec(prose);
      if (m) {
        const n = parseFloat(m[1].replace(/,/g, ""));
        doc.system.cost = m[2].toLowerCase() === "gp" ? n : m[2].toLowerCase() === "sp" ? n / 10 : n / 100;
      }
    }
    if (!doc.system.weight6) {
      const m = /weighs?\s+(?:about\s+)?(a half|half a|one|an|a|two|three|four|five|six|\d+(?:\/\d+)?)\s*stones?/i.exec(prose);
      if (m) {
        const words = { "a half": 0.5, "half a": 0.5, one: 1, a: 1, an: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
        const raw = m[1].toLowerCase();
        const w = words[raw] ?? (raw.includes("/") ? Number(raw.split("/")[0]) / Number(raw.split("/")[1]) : parseFloat(raw));
        if (Number.isFinite(w) && w > 0) doc.system.weight6 = w * 6;
      }
    }
    if (doc.type === ITEM_TYPE.WEAPON && !doc.system.damage) {
      const m = /deal(?:s|ing)?\s+(\d+d\d+(?:\s*[+-]\s*\d+)?)/i.exec(prose);
      if (m) doc.system.damage = m[1].replace(/\s+/g, "");
    }
  }
  // Two books printing one thing is ONE document (see reconcileByName): merge
  // when nothing but the source differs, tag both when something does.
  const verdict = await reconcileByName(doc, id, bookOf(found));
  if (verdict.skip) return verdict.doc;
  const item = await createDoc(Item, {
    ...doc,
    folder,
    ...(verdict.name
      ? {
          name: verdict.name,
          flags: foundry.utils.mergeObject(doc.flags ?? {}, { [MODULE_ID]: { cookbook: { printed: verdict.printed } } }, { inplace: false }),
        }
      : {}),
  });
  // acks-equipment owns the RAW annotation layer (container capacities, the
  // harness, the bowquiver). Its profiles key off the printed name, so a
  // generated item annotates exactly like a core one. Reuse, never restate.
  try {
    await annotateItem(item);
  } catch (err) {
    console.warn(`${MODULE_ID} | equipment annotation skipped for ${item?.name}`, err);
  }
  return item;
}

/** All equipment ids in the shipped cookbook (empty when none compiled). */
export const cookbookEquipmentIds = () =>
  [...data.content.values()]
    .flatMap((cb) => Object.entries(cb.entries))
    .filter(([, e]) => e.kind === "kind.equipment")
    .map(([id]) => id);

/**
 * Remove `ability` items mis-created from equipment entries.
 *
 * v0.26.0 let equipment ids into the ability import, so a world that ran
 * "Import ALL Abilities" holds ability-typed documents for gear. They are
 * generated artifacts with an invalid category, they fail validation on every
 * sheet render, and an item's type cannot be changed in place — so they are
 * deleted and re-created properly by the equipment import. Only OUR generated
 * documents are touched; a hand-made item is never deleted.
 * @returns {Promise<number>} how many were removed
 */
export async function repairEquipmentAbilities() {
  const wrong = (await importedDocs("Item")).filter(
    (i) =>
      i.type === ITEM_TYPE.ABILITY &&
      i.getFlag(MODULE_ID, "minted") &&
      String(i.getFlag(MODULE_ID, "cookbook")?.id ?? "").startsWith("def.equip."),
  );
  if (!wrong.length) return 0;
  await deleteImported("Item", wrong);
  console.warn(`${MODULE_ID} | removed ${wrong.length} equipment entr(ies) mis-imported as abilities (v0.26.0 defect).`);
  return wrong.length;
}

/**
 * Remove `item`-typed documents that should now be ANIMAL ACTORS.
 *
 * Before animals imported as actors, the ten priced animals became inventory
 * items — a war dog filed next to the rope. A world that ran the old import
 * holds those, and an item's type cannot be changed in place, so they are
 * deleted here and re-created as actors by the equipment import. Exactly the
 * repairEquipmentAbilities pattern: only OUR generated documents are touched
 * (the `minted` flag + a `def.equip.` cookbook id whose entry is an animal),
 * so a hand-made "War Dog" item a table wrote themselves is never deleted.
 *
 * A no-op before `game.actors` exists — without the animal sub-type reachable
 * yet the items are still the best available representation, so removing them
 * would delete data with nothing to replace it.
 *
 * @returns {Promise<number>} how many were removed
 */
export async function repairAnimalItems() {
  if (!canImportAnimals()) return 0;
  const animalIds = new Set(
    [...data.content.values()]
      .flatMap((cb) => Object.entries(cb.entries))
      .filter(([, e]) => e.kind === "kind.equipment" && e.meta?.group === "animal")
      .map(([id]) => id),
  );
  const wrong = (await importedDocs("Item")).filter(
    (i) => i.getFlag(MODULE_ID, "minted") && animalIds.has(i.getFlag(MODULE_ID, "cookbook")?.id),
  );
  if (!wrong.length) return 0;
  await deleteImported("Item", wrong);
  console.warn(`${MODULE_ID} | removed ${wrong.length} animal(s) mis-imported as items; re-import to recreate them as actors.`);
  return wrong.length;
}

/**
 * Remove the JJ shield forms an earlier version imported as VARIATIONS.
 *
 * The six forms used to be `acks-extras.variation` documents a reader dragged
 * onto a shield; they are shields, and now import as `armor` items of type
 * shield. An item's type cannot be changed in place and the cookbook id moved
 * with the kind, so the old documents can neither be updated nor recognised by
 * the new import — they would simply stand beside it, two Kite Shields of
 * different types on two shelves.
 *
 * Only the LIBRARY copies go, matched on the id they were imported under. A
 * variation a Judge already applied to a shield is an embedded copy on that
 * document, which this never sees (`importedDocs` reads the sidebar and our own
 * packs), so nothing a table put on an item is touched.
 *
 * @returns {Promise<number>} how many were removed
 */
export async function repairShieldVariations() {
  const wrong = (await importedDocs("Item")).filter((i) =>
    String(i.getFlag(MODULE_ID, "cookbook")?.id ?? "").startsWith("def.variation.shield"),
  );
  if (!wrong.length) return 0;
  await deleteImported("Item", wrong);
  console.warn(`${MODULE_ID} | removed ${wrong.length} shield form(s) imported as variations; they import as shields now.`);
  return wrong.length;
}

/**
 * Correct the SUBTYPE of priced items an earlier run filed as plain inventory.
 *
 * Before a grid row carried the section it was printed under, every one of them
 * was written `subtype: "item"` — so a belt, a cloak and a pair of boots were
 * ordinary inventory: filed among the gear rather than in the sheet's clothing
 * band, and weighed against encumbrance, which core exempts clothing from.
 *
 * Corrected in place rather than re-created. An item's subtype is mutable, so
 * there is nothing here of the delete `repairAnimalItems` needs (a type is
 * not), and re-creating would mint a duplicate: the id is already claimed.
 * Only documents carrying our `minted` flag are touched, and only that one
 * field, so a Judge's own "Belt" is never rewritten. Skins already copied onto
 * a character belong to the template package, which re-derives them.
 *
 * @param {{name:string, section:string}[]} rows the grid as this seat read it
 * @returns {Promise<number>} how many were corrected
 */
async function repairPricedSubtypes(rows) {
  let repaired = 0;
  for (const row of rows) {
    const want = subtypeForSection(row.section);
    const doc = await importedItem(pricedId(row.name));
    if (!doc || doc.type !== "item" || !doc.getFlag(MODULE_ID, "minted")) continue;
    if (doc.system?.subtype === want) continue;
    await doc.update({ "system.subtype": want });
    repaired++;
  }
  if (repaired) console.warn(`${MODULE_ID} | corrected the subtype of ${repaired} priced item(s) imported before their section was read.`);
  return repaired;
}

/** Bulk import: every equipment entry, shared folder, dedup via importEquipment. */
export async function importAllEquipment() {
  // Same reason as importClasses: the macro says "(GM)" but every seat can run
  // it, and a player who does adds a second shop list to the world.
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const repaired = await repairEquipmentAbilities();
  // A world imported by an earlier version holds animals as items; drop them so
  // the loop below recreates them as actors (no-op without ACKS Extras).
  const repairedAnimals = await repairAnimalItems();
  // And the shield forms it holds as variations; the loop below imports them as
  // the shields they are.
  const repairedShields = await repairShieldVariations();
  const ids = cookbookEquipmentIds();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressEquipment`), ids.length);
  let created = 0;
  let animals = 0;
  try {
    await prepareItemShelves();
    const folder = null; // per-id shelf
    for (const id of ids) {
      const entry = cookbookEntry(id)?.entry;
      // An animal lands in the ACTOR collection, so "was it already here?" has
      // to be asked of the collection it actually goes to — asked of items, an
      // imported animal looks new on every run and the count lies. Asked of the
      // WORLD while imports go to a compendium, everything looks new and the
      // count lies the same way.
      const asActor = isAnimalEntry(entry) && canImportAnimals();
      const before = asActor ? await importedActor(id) : await importedItem(id);

      const doc = await importEquipment(id, folder);
      if (doc && !before) {
        created++;
        if (asActor) animals++;
      }
      bar.step(entry?.name ?? id);
    }
  } finally {
    bar.finish();
  }
  const weapons = await importWeapons();
  const armor = await importArmor();
  // Last: it asks which price rows the entries above already claim, so it has
  // to run after they have had their chance at them.
  const priced = await importPricedGear();
  return { total: ids.length, created, animals, repaired, repairedAnimals, repairedShields, weapons, armor, priced };
}

/* -------------------------------------------- */
/*  Weapon / armour TABLES → items (per-seat)   */
/* -------------------------------------------- */

/** camelCase cookbook id for a table-materialized weapon. */
const weaponId = (name) => `def.weapon.${slugLabel(name).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/**
 * Materialize the RR weapons TABLE into `weapon` items from the reader's own
 * book — the clean-break pipeline (see weapon-tables.mjs). Unlike the run-in
 * gear cookbook, a grid has no prose of its own, so a bookless seat gets
 * nothing here. Deduped by cookbook id; each item carries its full set of
 * attack/damage modes (weapon-tables `damageModes`), which the core compendium
 * could not express and split into separate items instead.
 * @returns {Promise<{table:number, created:number}>}
 */
/**
 * Remove ammunition the grid's third type was read as a WEAPON.
 *
 * Before the Ammunition rows were told apart from the Missile ones, a case of
 * bolts imported as a `weapon`: a type with no `quantity` field, so its load
 * could only live in its name, and a default damage die, so it arrived as
 * something to swing. A document's type cannot be changed in place, so the
 * wrong ones are deleted and the run re-creates them as inventory — the
 * `repairAnimalItems` pattern, and the same guard: only documents carrying our
 * own `minted` flag are touched, so a Judge's hand-made "Case of Bolts" is
 * never deleted. A class template's copy carries no importer stamp and is not
 * reached from here; the equipment root re-derives those with its packages.
 *
 * @param {string[]} ids the cookbook ids of this seat's ammunition rows
 * @returns {Promise<number>} how many were removed
 */
async function repairAmmoWeapons(ids) {
  const want = new Set(ids);
  if (!want.size) return 0;
  const wrong = (await importedDocs("Item")).filter(
    (i) =>
      i.type === ITEM_TYPE.WEAPON &&
      i.getFlag(MODULE_ID, "minted") &&
      want.has(i.getFlag(MODULE_ID, "cookbook")?.id),
  );
  if (!wrong.length) return 0;
  await deleteImported("Item", wrong);
  console.warn(`${MODULE_ID} | removed ${wrong.length} ammunition row(s) imported as weapons; re-imported as inventory.`);
  return wrong.length;
}

export async function importWeapons(folderId) {
  const session = ctx.sessionDocs.get(WEAPON_TABLE.book);
  if (!session?.doc) return { table: 0, created: 0, reason: "book not connected" };
  let rows;
  try {
    rows = await extractWeaponsFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | weapon-table extraction failed`, err);
    return { table: 0, created: 0, reason: "extraction error" };
  }
  if (!rows.length) return { table: 0, created: 0, reason: "table not found in book" };
  const folder = folderId ?? (await ensureItemFolder("def.weapon."))?.id ?? null;
  // BEFORE anything claims an id — a row this world already holds claims itself
  // on the next run, and a repair written after the claim reports zero forever
  // while the wrong documents stand (the lesson importPricedGear records).
  const repaired = await repairAmmoWeapons(rows.filter((r) => r.ammunition).map((r) => weaponId(r.name)));
  let created = 0;
  for (const row of rows) {
    const id = weaponId(row.name);
    if (await importedItem(id)) continue;
    const cite = `${BOOKS[WEAPON_TABLE.book]?.short ?? "RR"} p. ${WEAPON_TABLE.page}`;
    // Whether an ammunition row names a carrying device is the equipment root's
    // question — it owns the gear profiles that answer it — so it is asked, not
    // restated here. Absent the module every ammunition row is a bare stack,
    // which is the shape that needs nothing of it.
    const doc = row.ammunition
      ? bindAmmoRow(row, id, cite, { device: !!gearProfileFor(row.name) })
      : bindWeaponRow(row, id, cite);
    const item = rememberImported(id, await createDoc(Item, { ...doc, folder }));
    // The RAW annotation layer belongs to acks-equipment, exactly as the gear
    // cookbook defers to it: a case rides on the belt and is free to draw from.
    if (row.ammunition) {
      try {
        await annotateItem(item);
      } catch (err) {
        console.warn(`${MODULE_ID} | equipment annotation skipped for ${item?.name}`, err);
      }
    }
    created++;
  }
  return { table: rows.length, created, repaired };
}

/** camelCase cookbook id for a table-materialized armour item. */
const armorId = (name) => `def.armor.${slugLabel(name).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/**
 * Cookbook id for an item materialized from a printed price row.
 *
 * Folds the WHOLE printed name, parenthetical included — `slugLabel` drops it,
 * and it is exactly what tells two rows of one thing apart ("Candle (tallow,
 * 1 lb)" and "Candle (wax, 1 lb)"). The same distinction `rowClaimKey` keeps
 * for a vehicle whose team is its only difference.
 */
const pricedId = (name) =>
  `def.priced.${String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "row"}`;

/**
 * The core item subtype a printed price SECTION corresponds to, defaulting to
 * plain inventory.
 *
 * The second price grid stacks three sections, and only the first is clothing.
 * A subtype is not decoration: core files a clothing item on its own part of
 * the sheet and leaves it out of encumbrance, so a belt imported as ordinary
 * inventory is weighed against the character for as long as it stands. A
 * described entry gets this from the register (`bindEquipment`); a grid row
 * has no entry, and the heading it was printed under is the page's own answer.
 *
 * WHICH headings mean something is asked of the SYSTEM's subtype vocabulary,
 * by key and by localized label alike, so no name off the page is written down
 * here and a heading the vocabulary does not know stays plain inventory.
 */
function subtypeForSection(section) {
  const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const want = fold(section);
  if (!want) return "item";
  for (const [key, label] of Object.entries(CONFIG.ACKS?.item_subtypes ?? {})) {
    if (fold(key) === want || fold(game.i18n?.localize?.(label) ?? label) === want) return key;
  }
  return "item";
}

/**
 * Materialize the printed price rows that no cookbook entry of its own claims.
 *
 * The gear cookbook is a list of things the book DESCRIBES; the price grid is
 * a list of things it SELLS, and the two are not the same list. The grid
 * itemizes what a description treats as one subject — a candle is sold by the
 * material it is made of, a saddle by what it is for — and it also prices
 * things no paragraph describes at all. Either way the reader can buy the row
 * and could not, before this, own it: the category imported once, with no
 * price, because pricing it would have meant choosing one of its variants.
 *
 * A row an entry already resolves is left alone — that item exists and carries
 * the book's own description, which a grid row does not have. Everything else
 * becomes an item priced from the reader's own page.
 */
export async function importPricedGear(folderId) {
  const session = ctx.sessionDocs.get(WEAPON_TABLE.book);
  if (!session?.doc) return { rows: 0, created: 0, reason: "book not connected" };
  let rows;
  try {
    rows = await extractPriceRowsFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | price-row extraction failed`, err);
    return { rows: 0, created: 0, reason: "extraction error" };
  }
  if (!rows.length) return { rows: 0, created: 0, reason: "grid not found in book" };

  // Correct what an earlier run got wrong, BEFORE anything is claimed. A row
  // this world already holds claims itself on the next run — the library check
  // below matches the document against the row it was made from — so nothing
  // downstream of the claim can ever reach one, and a repair written there
  // reports zero forever while the wrong documents stand.
  const repaired = await repairPricedSubtypes(rows);

  // Exactly what priceFor resolves, asked once for the whole grid: a row is
  // claimed by an entry with its key, or by an entry whose key it alone
  // extends. A key several rows extend claims none of them — which is the
  // category whose variants this function is here to produce.
  const rowKeys = rows.map((r) => priceKey(r.name));
  const claimed = new Set();
  for (const id of cookbookEquipmentIds()) {
    const key = priceKey(cookbookEntry(id)?.entry?.name);
    if (!key) continue;
    if (rowKeys.includes(key)) claimed.add(key);
    else {
      const ext = rowKeys.filter((rk) => rk.startsWith(key) && rk.length > key.length);
      if (ext.length === 1) claimed.add(ext[0]);
    }
  }

  // And whatever the LIBRARY already holds, under either spelling. The loop
  // above only knows the equipment chapter's declared entries; the weapon and
  // armour tables mint their items from a grid at run time, so nothing declares
  // "Military Oil" — and the catalogue prints it as "Oil, Military (1 pint)",
  // which is a different key again. The result was two documents for one flask.
  //
  // This is why the price list runs LAST (see importAllEquipment): it can only
  // ask what the shelves already hold once they hold it.
  const libraryKeys = new Set();
  for (const doc of await importedDocs("Item")) for (const k of nameKeys(doc.name)) libraryKeys.add(k);
  rows.forEach((row, i) => {
    for (const k of nameKeys(row.name)) {
      if (libraryKeys.has(k)) {
        claimed.add(rowKeys[i]);
        break;
      }
    }
  });

  // Their own shelf under Equipment, beside the group shelves the described
  // entries file into. Dropped on the Equipment folder itself they sit loose
  // among those folders — a hundred-odd items with nothing holding them — and
  // they cannot join the group shelves either: a row's group is a fact the
  // register records about a described entry, and these rows have no entry.
  // Sorting them by the page they were printed on does not help, because the
  // clothing page carries the provisions and livestock too.
  const folder =
    folderId ?? (await ensureItemFolder("def.priced."))?.id ?? null;
  const cite = `${BOOKS[WEAPON_TABLE.book]?.short ?? "RR"} p. ${PRICE_TABLES.gear.page}`;
  let created = 0;
  const seen = new Set();
  for (const row of rows) {
    const key = priceKey(row.name);
    const id = pricedId(row.name);
    // Claiming asks the lookup key, which drops the parenthetical because a
    // reader looking a thing up does not type it. Deduping asks the id, which
    // keeps it — otherwise the second of two rows that differ ONLY by their
    // parenthetical is dropped as a repeat of the first.
    if (!key || claimed.has(key) || seen.has(id)) continue;
    seen.add(id);
    if (await importedItem(id)) continue;
    // The equipment root owns the rule mapping a NAME to the item type it
    // should be, exactly as bindEquipment defers to it; absent the module a
    // priced row is plain inventory.
    const klass = equipmentClass(row.name) ?? null;
    const type = klass?.type ?? "item";
    const subtype = subtypeForSection(row.section);
    const doc = {
      name: row.name,
      type,
      img: "icons/containers/bags/pouch-simple-brown.webp",
      system: {
        ...(type === "item" ? { subtype, quantity: { value: 1, max: 0 } } : {}),
        ...(row.cost != null ? { cost: row.cost } : {}),
        ...(row.weight6 != null ? { weight6: row.weight6 } : {}),
      },
      flags: { [MODULE_ID]: { cookbook: { id, cite }, minted: true } },
    };
    rememberImported(id, await createDoc(Item, { ...doc, folder }));
    created++;
  }
  return { rows: rows.length, created, repaired };
}

/** The RR gear/clothing price map, built once per session from the reader's book. */
let _priceMap = null;
async function gearPriceMap() {
  if (_priceMap && _priceMap.size) return _priceMap;
  const session = ctx.sessionDocs.get(WEAPON_TABLE.book);
  if (!session?.doc) return new Map(); // bookless: gear stays unpriced
  try {
    _priceMap = await extractPriceMapFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | gear price extraction failed`, err);
    _priceMap = new Map();
  }
  return _priceMap;
}

/**
 * Materialize the RR armour TABLE (suits, shields, helmets, barding) into
 * `armor` items from the reader's own book — the sibling of importWeapons.
 * AC, encumbrance and cost come from the seat's page; a bookless seat gets
 * nothing (a grid has no prose of its own). Deduped by cookbook id, into ACKS
 * Cookbook / Armor.
 * @returns {Promise<{table:number, created:number}>}
 */
export async function importArmor(folderId) {
  const session = ctx.sessionDocs.get(ARMOR_TABLE.book);
  if (!session?.doc) return { table: 0, created: 0, reason: "book not connected" };
  let rows;
  try {
    rows = await extractArmorFromDoc(session.doc, pageItems);
  } catch (err) {
    console.error(`${MODULE_ID} | armour-table extraction failed`, err);
    return { table: 0, created: 0, reason: "extraction error" };
  }
  if (!rows.length) return { table: 0, created: 0, reason: "table not found in book" };
  const folder = folderId ?? (await ensureItemFolder("def.armor."))?.id ?? null;
  let created = 0;
  for (const row of rows) {
    const id = armorId(row.name);
    if (await importedItem(id)) continue;
    const cite = `${BOOKS[ARMOR_TABLE.book]?.short ?? "RR"} p. ${ARMOR_TABLE.page}`;
    rememberImported(id, await createDoc(Item, { ...bindArmorRow(row, id, cite), folder }));
    created++;
  }
  return { table: rows.length, created };
}

/* -------------------------------------------- */
/*  Companions                                  */
/* -------------------------------------------- */

/**
 * Fill a companion effect's actor slot. `ref` names the monster entry the
 * ability confers — a pointer the recipe can ship because it is not the book's
 * text. When that book is connected we import the creature and link it; when it
 * is not, the slot stays EMPTY on purpose so a GM can drop an actor in, or so
 * `cookbookFillCompanions()` can fill it once the book loads.
 *
 * Abilities whose creature is BUILT rather than named (a totem animal, a
 * familiar chosen from a list) carry no `ref` at all and keep an empty slot for
 * good — there is no single entry to point at.
 */
async function resolveCompanion(effect) {
  if (effect?.type !== "companion" || effect.actorUuid || !effect.ref) return effect;
  const found = cookbookEntry(effect.ref);
  if (!found) return effect;
  const existing = await importedActor(effect.ref);
  if (existing) return { ...effect, actorUuid: existing.uuid };
  const bookId = bookOf(found);
  if (!ctx.sessionDocs.has(bookId)) return effect; // bookless: leave the bucket
  // No fallback folder: importOne resolves the creature's own destination from
  // its freshly extracted type, which is strictly better than anything a caller
  // could name before the page has been read.
  const actor = await importOne(bookId, effect.ref, null).catch((err) => {
    console.error(`${MODULE_ID} | companion ${effect.ref}`, err);
    return null;
  });
  return actor ? { ...effect, actorUuid: actor.uuid } : effect;
}

/** Resolve every companion slot in an effects array, in order (creates actors). */
async function resolveCompanions(effects) {
  if (!effects?.some((e) => e?.type === "companion" && !e.actorUuid && e.ref)) return effects;
  const out = [];
  for (const e of effects) out.push(await resolveCompanion(e));
  return out;
}

/**
 * Fill companion slots left empty because the citing book was not connected.
 * Safe to re-run: a slot already holding an actor is never touched.
 */
export async function cookbookFillCompanions() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  let filled = 0;
  // A slot that resolves IMPORTS the creature from the seat's book, so this is
  // an actor import wearing a different name — same page extraction, same wait.
  const all = await allAbilities();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressCompanions`), all.length);
  try {
    for (const { doc, extras } of all) {
      bar.step(doc.name);
      const effects = await resolveCompanions(extras.effects);
      if (effects === extras.effects) continue;
      await doc.update({ [`flags.${MODULE_ID}.extras.effects`]: effects });
      filled += effects.filter((e, i) => e.actorUuid && !extras.effects[i]?.actorUuid).length;
    }
  } finally {
    bar.finish();
  }
  ui.notifications.info(`${MODULE_ID} | companions: ${filled} slot(s) linked to an actor.`);
  return filled;
}

/* -------------------------------------------- */
/*  Bulk import / update                        */
/* -------------------------------------------- */

/**
 * Every ability item the library holds — loose in the pack and on actors alike.
 *
 * Async because the pack has to be loaded; it used to walk `game.items` only,
 * so Update walked an empty library and reported that it had nothing to do.
 * Actors stay a world read: a character is not an import.
 */
async function allAbilities() {
  const extrasOf = (doc) => doc.getFlag(MODULE_ID, "extras") ?? {};
  const out = [];
  for (const item of await importedDocs("Item")) {
    if (item.type === ITEM_TYPE.ABILITY) out.push({ doc: item, extras: extrasOf(item), on: null });
  }
  for (const actor of game.actors) {
    for (const item of actor.items) {
      if (item.type === ITEM_TYPE.ABILITY) out.push({ doc: item, extras: extrasOf(item), on: actor });
    }
  }
  return out;
}

/** Names vary by punctuation and case between sources, so match folded. */
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Folded printed name -> the definition it means, from the `powerSource`
 * register.
 *
 * A class or race spread names a power in the SHORT form its own paragraph
 * uses, while the definition carries the full one: a dwarf's rung prints
 * "Hardy" for `def.power.hardyPeople`, and both "Dwarf Tongues" and "Elf
 * Tongues" mean `def.power.giftOfTongues` — which no name match can find,
 * because the printed name is not the definition's name.
 *
 * A name several definitions answer to resolves to NOTHING rather than to a
 * guess: nine classes print their own "Renown", and picking one would bind a
 * rung to another class's power. Built once and memoised on the register.
 */
function printedNameIndex() {
  if (data.registers?.__printedNames) return data.registers.__printedNames;
  const index = new Map();
  const ambiguous = new Set();
  for (const rows of Object.values(data.registers?.tables?.powerSource ?? {})) {
    for (const row of rows ?? []) {
      const key = nameKey(row?.name);
      if (!key || !row.ref) continue;
      const seen = index.get(key);
      if (seen && seen !== row.ref) ambiguous.add(key);
      else index.set(key, row.ref);
    }
  }
  for (const key of ambiguous) index.delete(key);
  if (data.registers) {
    Object.defineProperty(data.registers, "__printedNames", { value: index, enumerable: false });
  }
  return index;
}

/**
 * The definition id a printed power name means, or null when the register
 * does not name it (or names it ambiguously).
 *
 * @param {string} name the name as a class or race spread prints it
 * @returns {string|null} a `def.*` cookbook id
 */
export const refForPrintedName = (name) => printedNameIndex().get(nameKey(name)) ?? null;

/**
 * Resolve an item name to a definition id. Tries the name as printed, then
 * again with a trailing throw value stripped: a stat block writes its
 * proficiencies as "climbing 6+", which is the same proficiency as "Climbing"
 * with its target number attached. Without this, every monster-embedded
 * proficiency fails to match and never gets adopted.
 */
function idForName(index, name, present) {
  let ids = index.get(nameKey(name));
  if (!ids) {
    const bare = String(name ?? "").replace(/\s*\d+\s*\+?\s*$/, "");
    ids = bare && bare !== name ? index.get(nameKey(bare)) : undefined;
  }
  if (!ids?.length) return null;
  return preferredId(ids, present);
}

/**
 * Folded name -> every definition id printing that name.
 *
 * The books reuse names across categories: 14 of them, "Alertness" and
 * "Climbing" among them, are both a proficiency and a class power. A name is
 * therefore only a guess at identity, and the index keeps ALL the candidates so
 * the caller can choose deliberately instead of silently taking the first.
 */
function abilityNameIndex() {
  const index = new Map();
  const add = (name, id) => {
    const key = nameKey(name);
    if (!key) return;
    const list = index.get(key) ?? index.set(key, []).get(key);
    if (!list.includes(id)) list.push(id);
  };
  for (const [id, e] of abilityEntries()) {
    add(e.name, id);
    for (const a of e.aliases ?? []) add(a, id);
  }
  return index;
}

/**
 * Definition id -> the item already standing for it.
 *
 * Doubles as the "which definitions does this world hold" signal that settles a
 * name collision without guessing. First one wins: duplicates are a world the
 * GM built by hand, and picking the earliest is at least stable across runs.
 *
 * SYNCHRONOUS, so it can only see a compendium library through the warm
 * `importedIndex()` cache — `bindMonster` is sync and calls this, and making it
 * async would thread a promise through the whole monster bind. Async callers
 * should `await importedIndex()` (below) instead; this form falls back to the
 * world so a cold session still resolves whatever is loose there.
 */
function loadedAbilityIndex() {
  if (importedCache) return importedCache;
  const byId = new Map();
  for (const item of game.items) {
    // Never a template skin: it carries the id of the definition it was copied
    // from, and answering with one hands a monster a class's engraved silver
    // waterskin in place of the shared item.
    if (item.flags?.[MODULE_ID]?.templatePart) continue;
    const id = item.getFlag(MODULE_ID, "cookbook")?.id;
    if (id && !byId.has(id)) byId.set(id, item);
  }
  return byId;
}

/**
 * Pick among same-named definitions.
 *
 * A collision stops being a guess when only ONE of the candidates is actually
 * available — a world that imported the proficiency list but not the powers has
 * already answered the question. So candidates present in the world win outright,
 * and only when that leaves the choice open (none present, or several) does the
 * category preference apply: a stat block's proficiency list and a hand-made
 * ability both far more often mean the PROFICIENCY than the same-named class
 * power. `ambiguous` reports whether a real guess was made.
 */
const CATEGORY_RANK = ["def.prof.", "def.skill.", "def.power.", "def.drawback."];
const byCategory = (ids) =>
  [...ids].sort((a, b) => {
    const r = (x) => {
      const i = CATEGORY_RANK.findIndex((p) => x.startsWith(p));
      return i === -1 ? CATEGORY_RANK.length : i;
    };
    return r(a) - r(b);
  })[0];

function preferredId(ids, present) {
  if (ids.length === 1) return { id: ids[0], ambiguous: false };
  const here = ids.filter((id) => present.has(id));
  if (here.length === 1) return { id: here[0], ambiguous: false };
  return { id: byCategory(here.length ? here : ids), ambiguous: true };
}

/**
 * GM: browse every shipped ability and pick which to import.
 *
 * The counterpart to the monster import dialog. Works WITHOUT a connected book
 * — an ability always imports with its name, classification and citation
 * — but the header says whether the citing book is open, because that is the
 * difference between importing structure and importing structure + mechanics.
 */
export async function cookbookImportAbilitiesDialog() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const rows = [];
  for (const [id, e] of abilityEntries()) {
    rows.push({ id, name: e.name, cite: e.cite, book: e.book, category: e.meta?.category ?? "proficiency", alias: !!e.aliasOf, deprecated: !!e.meta?.deprecated });
  }
  if (!rows.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  rows.sort((a, b) => a.name.localeCompare(b.name));

  const esc = foundry.utils.escapeHTML ?? ((x) => x);
  // The present marks have to name the shelf the import writes to, or a
  // compendium-mode world shows every ability as missing and the GM ticks a
  // list they already hold.
  const have = new Set((await importedIndex()).keys());
  const openBooks = [...new Set(rows.map((r) => r.book))].filter((b) => ctx.sessionDocs.has(b));
  const cats = [...new Set(rows.map((r) => r.category))].sort();

  const list = rows
    .map((r) => {
      const marks = [
        r.alias ? `<i class="fa-solid fa-link" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilAlias`))}"></i>` : "",
        r.deprecated ? `<i class="fa-solid fa-triangle-exclamation" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilDeprecated`))}"></i>` : "",
        have.has(r.id) ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.abilPresent`))}"></i>` : "",
      ].join("");
      return `<label class="acks-extras-importer-browse-row" data-name="${esc(r.name.toLowerCase())}" data-cat="${esc(r.category)}" data-have="${have.has(r.id) ? 1 : 0}">
        <input type="checkbox" name="sel" value="${esc(r.id)}">
        <span>${esc(r.name)}</span><span class="acks-extras-importer-marks">${marks}</span>
        <span class="acks-extras-importer-cite">${esc(r.cite)}</span>
      </label>`;
    })
    .join("");

  const catOptions = cats.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.abilIntro`, {
      n: rows.length,
      books: openBooks.length ? openBooks.map((b) => BOOKS[b].short).join(", ") : game.i18n.localize(`${LANG_PREFIX}.ui.abilNoBook`),
    })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <select name="cat"><option value="">${game.i18n.localize(`${LANG_PREFIX}.ui.abilAllCats`)}</option>${catOptions}</select>
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-abil-list">${list}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.abilTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 620, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const listEl = root.querySelector(".acks-extras-importer-abil-list");
      const count = root.querySelector(".acks-extras-importer-abil-count");
      const shown = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")].filter((r) => r.style.display !== "none");
      const refresh = () => {
        const q = root.querySelector('[name="filter"]').value.toLowerCase();
        const cat = root.querySelector('[name="cat"]').value;
        const hide = root.querySelector('[name="hideHave"]').checked;
        for (const r of listEl.querySelectorAll(".acks-extras-importer-browse-row")) {
          const ok = r.dataset.name.includes(q) && (!cat || r.dataset.cat === cat) && (!hide || r.dataset.have === "0");
          r.style.display = ok ? "" : "none";
          if (!ok) r.querySelector('input[name="sel"]').checked = false;
        }
        tally();
      };
      const tally = () => {
        const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
        count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
      };
      for (const sel of ['[name="filter"]', '[name="cat"]', '[name="hideHave"]']) {
        root.querySelector(sel).addEventListener("input", refresh);
      }
      listEl.addEventListener("change", tally);
      root.querySelector('[data-act="all"]').addEventListener("click", () => {
        for (const r of shown()) r.querySelector('input[name="sel"]').checked = true;
        tally();
      });
      root.querySelector('[data-act="none"]').addEventListener("click", () => {
        for (const r of listEl.querySelectorAll('input[name="sel"]')) r.checked = false;
        tally();
      });
      tally();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.abilGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => el.value);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), picked.length);
        let done = 0;
        try {
          await prepareItemShelves();
          const folder = null; // per-id shelf
          for (const id of picked) {
            if (await importAbility(id, folder).catch((err) => (console.error(`${MODULE_ID} | import ${id}`, err), null))) done++;
            bar.step(cookbookEntry(id)?.entry?.name ?? id);
          }
        } finally {
          bar.finish();
        }
        ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.abilDone`, { done, picked: picked.length, pack: packLabel("Item") }));
      },
    },
  });
}

/** GM: import every shipped ability as a shared, deduped item. */
export async function cookbookImportAbilities() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const ids = cookbookAbilityIds();
  if (!ids.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), ids.length);
  let made = 0;
  let reused = 0;
  try {
    await prepareItemShelves();
    const pageCache = runPageCache();
    // BUILD every document first, WRITE them a chunk at a time. Building one
    // ability costs about 7ms; writing one costs a ~700ms server transaction
    // whatever its size, so a build-then-write loop turns what was 573 round
    // trips into a dozen. `createDocs` owns the chunking.
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      // `createDocs` teaches the dedup index itself: every document it makes
      // goes through `remembered`, which reads the id off the document's own
      // flag. Re-teaching it here from the batch by index is what filed
      // documents under their neighbours' ids whenever a create failed.
      const written = await createDocs(Item, batch.map((b) => b.data));
      made += written.filter(Boolean).length; // positional: nulls are failures, not imports
      batch = [];
    };
    for (const id of ids) {
      bar.step(cookbookEntry(id)?.entry?.name ?? id);
      if (await importedItem(id)) {
        reused++;
        continue;
      }
      const data = await abilityData(id, { pageCache }).catch((err) => {
        console.error(`${MODULE_ID} | build ${id}`, err);
        return null;
      });
      if (!data) continue;
      batch.push({ id, data });
      if (batch.length >= WRITE_CHUNK) await flush();
    }
    await flush();
  } finally {
    bar.finish();
  }
  ui.notifications.info(`${MODULE_ID} | abilities: ${made} imported, ${reused} already present.`);
  return { made, reused };
}

/**
 * Does this description hold something this module cannot prove it wrote?
 *
 * The test is never "is this worth keeping", it is "is this ours" — a stamped
 * block of imported book text, or the legacy `@PdfText` tag that preceded it,
 * and nothing else. Structure-only markup (the empty paragraph an editor leaves
 * behind) is empty; an image, a heading or a word of text is someone's work and
 * is never overwritten without being offered first.
 *
 * Update writes descriptions in exactly the stamped shape, which is what lets a
 * second run pass over everything the first run settled without asking again.
 */
function handWrittenProse(html) {
  return !!stripBookText(html)
    .replace(/<\/?(?:p|br|div|span)\b[^>]*>/gi, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
}

/** A description reduced to one readable line, so a dialog row fits on screen. */
function proseExcerpt(html, max = 160) {
  const text = String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/**
 * The name a kept-by-its-owner ability moves to.
 *
 * The rename is only worth anything if the new name stops folding to the
 * definition: folded names are how Update adopts an unflagged item, so a marker
 * that folds away to nothing would let the next run adopt the item again and
 * take the prose after all. Folding drops case and punctuation, so the marker
 * has to carry letters. A counter is added in the pathological case where a
 * shipped definition prints the marked name — bounded because each attempt is a
 * distinct name and only the finitely many in the index can collide.
 */
function asideName(index, present, name) {
  const marked = (n) => game.i18n.format(`${LANG_PREFIX}.ui.renamedName`, { name: n });
  let out = marked(name);
  for (let n = 2; n <= index.size + 2 && idForName(index, out, present); n++) out = marked(`${name} ${n}`);
  return out;
}

/**
 * Ask what happens to each name-adopted ability whose description Update would
 * replace, and resolve to a row index -> "rename" | "overwrite" map.
 *
 * ONE dialog for the whole run, with apply-to-all on both choices: a world that
 * imported the corpus produces collisions by the hundred, and a per-item prompt
 * a GM cannot answer in bulk gets clicked through, which is the same data loss
 * with more steps. Dismissal returns an empty map — every ambiguous item is
 * then left exactly as it was, because a closed dialog is not consent.
 */
async function askAboutAdoptedProse(rows) {
  const esc = foundry.utils.escapeHTML ?? ((x) => x);
  const label = {
    rename: game.i18n.localize(`${LANG_PREFIX}.ui.collideRename`),
    overwrite: game.i18n.localize(`${LANG_PREFIX}.ui.collideOverwrite`),
  };
  const list = rows
    .map((r, i) => {
      const excerpt = proseExcerpt(r.prose);
      return `<div class="acks-extras-importer-collide-row">
        <div style="display:flex;gap:.5em;align-items:baseline;">
          <strong>${esc(r.name)}</strong>
          <span class="acks-extras-importer-cite">${esc(r.where)}${r.cite ? ` · ${esc(r.cite)}` : ""}</span>
        </div>
        ${excerpt ? `<div class="acks-extras-importer-cite" style="font-style:italic;">${esc(excerpt)}</div>` : ""}
        <div style="display:flex;gap:1em;flex-wrap:wrap;">
          <label><input type="radio" name="c${i}" value="rename" checked> ${esc(label.rename)} "${esc(r.aside)}"</label>
          <label><input type="radio" name="c${i}" value="overwrite"> ${esc(label.overwrite)}</label>
        </div>
      </div>`;
    })
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.collideIntro`, { n: rows.length })}</p>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="rename">${game.i18n.localize(`${LANG_PREFIX}.ui.collideAllRename`)}</button>
      <button type="button" data-act="overwrite">${game.i18n.localize(`${LANG_PREFIX}.ui.collideAllOverwrite`)}</button>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-collide-list">${list}</div>`;

  const picked = await foundry.applications.api.DialogV2.wait({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.collideTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      for (const act of ["rename", "overwrite"]) {
        root.querySelector(`[data-act="${act}"]`).addEventListener("click", () => {
          for (const input of root.querySelectorAll(`.acks-extras-importer-collide-list input[value="${act}"]`)) {
            input.checked = true;
          }
        });
      }
    },
    buttons: [
      {
        action: "apply",
        default: true,
        label: game.i18n.localize(`${LANG_PREFIX}.ui.collideApply`),
        callback: (event, button) => {
          const out = new Map();
          for (let i = 0; i < rows.length; i++) {
            const choice = button.form.querySelector(`input[name="c${i}"]:checked`)?.value;
            if (choice) out.set(i, choice);
          }
          return out;
        },
      },
      { action: "keep", label: game.i18n.localize(`${LANG_PREFIX}.ui.collideKeepAll`), callback: () => new Map() },
    ],
    rejectClose: false,
  });
  return picked instanceof Map ? picked : new Map();
}

/**
 * Put the module's own item for a definition where the original one lives — on
 * the actor holding it, or in the item library. Never a second copy: a holder
 * that already carries this definition needs nothing added.
 */
async function placeGeneratedBeside(holder, id, built) {
  if (!holder) return (await importedItem(id)) ? null : importAbility(id, null);
  if (holder.items.some((i) => i.getFlag(MODULE_ID, "cookbook")?.id === id)) return null;
  const [made] = await holder.createEmbeddedDocuments("Item", [built]);
  return made ?? null;
}

/**
 * GM: refresh every ability already in the world — loose items AND the copies
 * embedded on actors — against the current cookbook.
 *
 * Matched by cookbook id first, then by folded NAME, so abilities made by hand
 * or imported by an older version get adopted and repaired rather than
 * duplicated. Only the generated surface is rewritten (the descriptor, the
 * structured extras, the cookbook id); the item's name and the system fields a
 * GM may have tuned are left alone.
 *
 * An item this module FLAGGED is rewritten outright — that is what Update is
 * for, and the flag is proof of authorship. An item matched only by NAME is
 * somebody else's, so its description is never replaced silently: those are
 * collected during the walk and settled by one dialog afterwards, either by
 * renaming the original aside and creating the reference next to it, or by
 * replacing it on the GM's explicit word.
 *
 * Both outcomes are idempotent, which is the point of the design: a renamed
 * item no longer folds to the definition, so no later run re-adopts it, and
 * every item this run wrote carries the cookbook flag, so a later run rewrites
 * it to identical content. Running twice leaves the same world as running once.
 */
export async function cookbookUpdateAbilities() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const index = abilityNameIndex();
  if (!index.size) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);

  // Which definitions the world already holds — the signal that resolves a
  // name collision without guessing.
  const present = new Set((await importedIndex()).keys());
  const nodeCache = new Map();
  // Resolved once per definition like the node it sits beside: expanding a
  // fromLadders spec re-executes another entry, and a sweep touches many copies.
  const ladderCache = new Map();
  let updated = 0;
  let adopted = 0;
  let onActors = 0;
  let guessed = 0;
  let skipped = 0;
  let renamed = 0;
  let created = 0;
  let overwritten = 0;
  let kept = 0;
  let preserved = 0;
  // Name-adopted items whose description carries someone else's writing. The
  // write is held back until the GM has answered for them.
  const collisions = [];
  /** Rewrite the generated surface — the descriptor, the cookbook id, the
   * extras. The written extras carry a `-=` deletion sentinel for every
   * optional subkey the rebuild no longer emits (ABILITY_EXTRAS_OPTIONAL), in
   * a copy — `built` stays clean for the create path, which must not carry
   * sentinels into fresh documents.
   *
   * `keepProse` holds back the description and nothing else. The flag proves
   * this module created the item; it does not prove nobody has written in it
   * since, and the mechanics are what an update exists to repair. Never widen
   * this to skip the whole write — an item left unrepaired because someone
   * annotated it is the failure this option exists to avoid. */
  const writeGenerated = (doc, built, { keepProse = false } = {}) => {
    const extras = { ...built.flags[MODULE_ID].extras };
    for (const key of ABILITY_EXTRAS_OPTIONAL) {
      if (!(key in extras)) extras[`-=${key}`] = null;
    }
    return doc.update({
      ...(keepProse ? {} : { "system.description": built.system.description }),
      [`flags.${MODULE_ID}.cookbook`]: built.flags[MODULE_ID].cookbook,
      [`flags.${MODULE_ID}.extras`]: extras,
    });
  };
  // Counted first: this walks every ability in the world, actors included, and
  // re-extracts each definition it has not seen — hundreds of items on a world
  // that imported the whole corpus.
  const all = await allAbilities();
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressUpdate`), all.length);
  try {
    for (const { doc, extras, on } of all) {
      bar.step(doc.name);
      const flagged = doc.getFlag(MODULE_ID, "cookbook")?.id;
      const guess = flagged ? null : idForName(index, doc.name, present);
      const id = flagged ?? guess?.id;
      if (!id || !cookbookEntry(id)) {
        skipped++;
        continue;
      }
      if (guess?.ambiguous) {
        guessed++;
        console.warn(`${MODULE_ID} | "${doc.name}" matches several definitions; resolved to ${id}.`);
      }
      const found = cookbookEntry(id);
      // Re-extract once per definition, not once per copy of it.
      if (!nodeCache.has(id)) {
        const session = ctx.sessionDocs.get(bookOf(found));
        let node = null;
        if (session) {
          node = await executeEntry(session.doc, found.cb, data.registers, id).catch(() => null);
          if (!node?.ok) node = null;
        }
        nodeCache.set(id, node);
      }
      if (!ladderCache.has(id)) ladderCache.set(id, await laddersForEntry(found.entry));
      const built = bindAbility(found.entry, nodeCache.get(id), id, {
        // A copy that recorded arriving under an older name keeps saying so.
        ...(extras.conversionStatus ? { conversionStatus: extras.conversionStatus } : {}),
        ...(extras.conversionFrom ? { conversionFrom: extras.conversionFrom } : {}),
        ...(ladderCache.get(id) ? { ladders: ladderCache.get(id) } : {}),
      });
      built.flags[MODULE_ID].extras.effects = await resolveCompanions(built.flags[MODULE_ID].extras.effects);
      // Never overwrite writing this module did not put there. Authorship of
      // the ITEM and authorship of its DESCRIPTION are different questions: the
      // flag answers the first, and a Judge who annotated a description this
      // module created still wrote those words. So an item matched by name only
      // is asked about, while a flagged one keeps its prose and takes the rest
      // of the update — which is the half that repairs the mechanics, and the
      // reason to run this at all.
      const prose = doc.system?.description;
      const annotated = handWrittenProse(prose);
      if (flagged && annotated) {
        await writeGenerated(doc, built, { keepProse: true });
        updated++;
        preserved++;
        if (on) onActors++;
        continue;
      }
      if (!flagged && annotated) {
        collisions.push({
          doc,
          on,
          id,
          built,
          prose,
          name: doc.name,
          cite: found.entry?.cite ?? "",
          where: on ? game.i18n.format(`${LANG_PREFIX}.ui.collideOn`, { actor: on.name }) : game.i18n.localize(`${LANG_PREFIX}.ui.collideWorld`),
          aside: asideName(index, present, doc.name),
        });
        continue;
      }
      await writeGenerated(doc, built);
      updated++;
      if (!flagged) adopted++;
      if (on) onActors++;
    }
  } finally {
    bar.finish();
  }

  if (collisions.length) {
    const choices = await askAboutAdoptedProse(collisions);
    kept = collisions.length - choices.size;
    const bar2 = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressResolve`), choices.size);
    try {
      for (const [i, choice] of choices) {
        const row = collisions[i];
        bar2.step(row.name);
        if (choice === "overwrite") {
          await writeGenerated(row.doc, row.built);
          updated++;
          adopted++;
          if (row.on) onActors++;
          overwritten++;
          continue;
        }
        // The original moves aside with its prose and its own flags untouched;
        // the reference is created beside it, flagged, so later runs maintain
        // that one and leave this one alone forever.
        await row.doc.update({ name: row.aside });
        renamed++;
        if (await placeGeneratedBeside(row.on, row.id, row.built)) created++;
      }
    } finally {
      bar2.finish();
    }
  }

  const stale = (await danglingAbilities()).length;
  ui.notifications.info(
    `${MODULE_ID} | abilities updated: ${updated} (${onActors} on actors, ${adopted} matched by name` +
      `${guessed ? `, ${guessed} of them ambiguous — see console` : ""}), ${skipped} not in the cookbook` +
      `${renamed ? `; ${renamed} of your own renamed aside, ${created} reference(s) created beside them` : ""}` +
      `${overwritten ? `; ${overwritten} replaced on request` : ""}` +
      `${preserved ? `; ${preserved} kept the description you wrote` : ""}` +
      `${kept ? `; ${kept} left untouched` : ""}` +
      `${stale ? `; ${stale} left over from a withdrawn definition — run Prune` : ""}.`,
  );
  return { updated, adopted, onActors, guessed, skipped, renamed, created, overwritten, kept, preserved, stale };
}

/**
 * Ability items this module generated whose definition no longer exists.
 *
 * A definition can be withdrawn — ten were, once it turned out the harvest had
 * read the tail of a spaceless heading as an ability of its own. The items it
 * already created stay behind in every world that imported them, pointing at
 * nothing. They are unambiguously ours (minted, with a cookbook id that no
 * longer resolves), which is what makes them safe to offer for removal.
 */
export async function danglingAbilities() {
  const out = [];
  for (const item of await importedDocs("Item")) {
    if (item.type !== ITEM_TYPE.ABILITY) continue;
    const flags = item.getFlag(MODULE_ID, "cookbook");
    if (!flags?.id || !item.getFlag(MODULE_ID, "minted")) continue;
    if (!cookbookEntry(flags.id)) out.push(item);
  }
  return out;
}

/**
 * GM: remove those items, after showing exactly what will go. Never silent —
 * deleting documents out of someone's world on a version bump is not a thing to
 * do quietly, even when they are certainly stale.
 */
export async function cookbookPruneAbilities() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const stale = await danglingAbilities();
  if (!stale.length) return ui.notifications.info(game.i18n.localize(`${LANG_PREFIX}.ui.pruneNone`));
  const esc = foundry.utils.escapeHTML ?? ((x) => x);
  const rows = stale
    .map((i) => `<li>${esc(i.name)} <code>${esc(i.getFlag(MODULE_ID, "cookbook").id)}</code></li>`)
    .join("");
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.pruneTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.prunePrompt`, { n: stale.length })}</p>
      <ul class="acks-extras-importer-browse-list">${rows}</ul>`,
  });
  if (!ok) return null;
  await deleteImported("Item", stale);
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.pruneDone`, { n: stale.length }));
  return stale.length;
}

/**
 * GM-only Import All / Update All buttons at the top of the Item directory.
 *
 * Both are idempotent, which is what makes them safe to hand a GM: importing
 * twice reuses the existing items rather than duplicating them, and updating
 * only rewrites the generated surface. Buttons disable while running — these
 * touch every ability in the world and a double-click would interleave.
 */
export function registerAbilityDirectoryButtons() {
  Hooks.on("renderItemDirectory", (app, element) => {
    if (!game.user.isGM) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    if (!root || root.querySelector(".acks-extras-importer-ability-tools")) return;

    const bar = document.createElement("div");
    bar.className = "acks-extras-importer-ability-tools";
    const button = (labelKey, tipKey, icon, run) => {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = `<i class="${icon}"></i> ${game.i18n.localize(`${LANG_PREFIX}.ui.${labelKey}`)}`;
      b.dataset.tooltip = game.i18n.localize(`${LANG_PREFIX}.ui.${tipKey}`);
      b.addEventListener("click", async () => {
        for (const x of bar.querySelectorAll("button")) x.disabled = true;
        try {
          await run();
        } catch (err) {
          console.error(`${MODULE_ID} | ability tools`, err);
          ui.notifications.error(`${MODULE_ID} | ${err.message}`);
        } finally {
          for (const x of bar.querySelectorAll("button")) x.disabled = false;
        }
      });
      return b;
    };
    bar.append(
      button("browseAbilities", "browseAbilitiesTip", "fa-solid fa-list-check", cookbookImportAbilitiesDialog),
      button("importAllAbilities", "importAllAbilitiesTip", "fa-solid fa-download", cookbookImportAbilities),
      button("updateAllAbilities", "updateAllAbilitiesTip", "fa-solid fa-rotate", cookbookUpdateAbilities),
      button("pruneAbilities", "pruneAbilitiesTip", "fa-solid fa-broom", cookbookPruneAbilities),
    );
    (root.querySelector(".directory-header") ?? root).prepend(bar);
  });
  // The sidebar renders before this module's `ready` runs, so the hook above
  // misses that first pass — re-render once to catch it.
  if (ui.items?.rendered) ui.items.render();
}

/* -------------------------------------------- */
/*  Debug window: raw executor output           */
/* -------------------------------------------- */

/**
 * GM inspection popout: execute one cookbook entry against the connected book
 * and show the RAW extract JSON next to nothing — exactly what the binder
 * receives. Ephemeral (session memory only), so binder errors can be traced to
 * either the extraction (wrong here) or the binding (right here, wrong on the
 * actor).
 */
export async function cookbookDebug(entryId) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const esc = foundry.utils.escapeHTML ?? ((x) => x);

  if (!entryId) {
    const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
    if (!openBooks.length) return ui.notifications.warn(`${MODULE_ID} | connect a cookbook book first (PoC 2 / unlock).`);
    // Every connected book, grouped — debugging one book while three are open
    // should not mean reconnecting.
    const rows = openBooks
      .map((bookId) => {
        const opts = Object.entries(data.books.get(bookId).entries)
          .sort((a, b) => a[1].pages[0] - b[1].pages[0])
          .map(([id, e]) => `<option value="${esc(id)}">${esc(e.name)} — ${esc(e.cite)}</option>`)
          .join("");
        return `<optgroup label="${esc(BOOKS[bookId]?.label ?? bookId)}">${opts}</optgroup>`;
      })
      .join("");
    return foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.debugTitle`) },
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      content: `<div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.debugPick`)}</label>
        <select name="entry">${rows}</select></div>`,
      ok: {
        label: game.i18n.localize(`${LANG_PREFIX}.ui.debugGo`),
        callback: (event, button) => cookbookDebug(button.form.elements.entry.value),
      },
    });
  }

  const found = cookbookEntry(entryId);
  if (!found) return ui.notifications.warn(`${MODULE_ID} | unknown cookbook id "${entryId}".`);
  const session = ctx.sessionDocs.get(found.cb.book.id);
  if (!session) return ui.notifications.warn(`${MODULE_ID} | ${found.cb.book.label} is not open this session.`);

  const node = await executeEntry(session.doc, found.cb, data.registers, entryId);
  const f = node.fields;
  const pre = (v) => `<pre class="acks-extras-importer-debug-pre">${esc(JSON.stringify(v, null, 1) ?? "null")}</pre>`;
  const statRows = Object.entries(f.stats ?? {})
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code></td></tr>`)
    .join("");
  const paras = (f.description ?? [])
    .map((p, i) => `<p class="acks-extras-importer-debug-para"><b>[${i}]</b> ${esc(p.text)}</p>`)
    .join("");
  const content = `<div class="acks-extras-importer-debug">
    <p><b>${esc(node.name)}</b> — ${esc(node.cite)} · pages ${esc(JSON.stringify(found.entry.pages))} · ok=${node.ok}</p>
    <details open><summary>expect</summary>${pre(f.name)}</details>
    <details open><summary>stats (${Object.keys(f.stats ?? {}).length})</summary>
      <table class="acks-extras-importer-debug-table">${statRows}</table></details>
    <details open><summary>attacks</summary>${pre(f.attacks ?? null)}</details>
    <details open><summary>spoils</summary>${pre(f.spoils ?? null)}</details>
    <details><summary>art</summary>${pre(f.art ?? null)}</details>
    <details><summary>description (${(f.description ?? []).length} paras — this seat's book, session only)</summary>${paras}</details>
    <details><summary>misses (${node.misses.length})</summary>${pre(node.misses)}</details>
  </div>`;
  return foundry.applications.api.DialogV2.prompt({
    window: { title: `${game.i18n.localize(`${LANG_PREFIX}.ui.debugTitle`)} — ${node.name}`, resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 640, height: 720 },
    content,
    ok: { label: game.i18n.localize(`${LANG_PREFIX}.ui.close`) },
  });
}

/**
 * GM/dev: import an explicit id list (QA + scripted tests — the same bounded
 * pool the dialog and import-all use, folders included).
 */
export async function cookbookImportIds(ids) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  // The SAME bounded pool the dialog and import-all use means the same
  // already-present filter too. A monster import always creates — importOne has
  // no reuse to fall back on — so an unfiltered id list leaves two actors
  // claiming one cookbook id, and a companion slot then picks between them
  // arbitrarily.
  const present = await importedIdSet();
  return importMany((ids ?? []).filter((id) => !present.has(id)), game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
}

export async function cookbookImport() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  if (!openBooks.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | no cookbook book is open this session — connect one first (PoC 2 / unlock dialog).`,
    );
  }
  const esc = foundry.utils.escapeHTML ?? ((x) => x);
  const have = await importedIdSet();
  const { rows: entryRows } = actorEntriesAcrossBooks();
  // One list across every connected book, with a heading per book so a long
  // list still says where each block came from. The filter matches the book
  // label too, so typing "nethercity" narrows to that book.
  let lastBook = null;
  let lastGroup = null;
  const rows = entryRows
    .map(({ id, entry: e, bookId }) => {
      let head = "";
      if (bookId !== lastBook) {
        lastBook = bookId;
        lastGroup = null;
        head += `<div class="acks-extras-importer-book-head">${esc(BOOKS[bookId]?.label ?? bookId)}</div>`;
      }
      const group = e.meta?.group ?? null;
      if (group && group !== lastGroup) {
        lastGroup = group;
        head += `<div class="acks-extras-importer-group-head">${esc(group)}</div>`;
      }
      const searchable = `${e.name} ${BOOKS[bookId]?.label ?? bookId} ${group ?? ""}`.toLowerCase();
      return `${head}<label class="acks-extras-importer-browse-row" data-name="${esc(searchable)}" data-have="${have.has(id) ? 1 : 0}">
        <input type="checkbox" name="sel" value="${esc(id)}">
        <span>${esc(e.name)}</span>
        <span class="acks-extras-importer-marks">${
          have.has(id)
            ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.cookbookPresent`))}"></i>`
            : ""
        }</span>
        <span class="acks-extras-importer-cite">${esc(e.cite)}</span>
      </label>`;
    })
    .join("");
  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.cookbookIntro`, {
      n: entryRows.length,
      book: openBooks.map((b) => BOOKS[b]?.short ?? b).join(", "),
    })}</p>
    <div class="acks-extras-importer-abil-filters">
      <input type="text" name="filter" placeholder="${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookFilter`)}">
      <label><input type="checkbox" name="hideHave"> ${game.i18n.localize(`${LANG_PREFIX}.ui.abilHidePresent`)}</label>
    </div>
    <div class="acks-extras-importer-abil-actions">
      <button type="button" data-act="all">${game.i18n.localize(`${LANG_PREFIX}.ui.cookbookSelectAll`)}</button>
      <button type="button" data-act="shown">${game.i18n.localize(`${LANG_PREFIX}.ui.abilSelectShown`)}</button>
      <button type="button" data-act="none">${game.i18n.localize(`${LANG_PREFIX}.ui.abilClear`)}</button>
      <span class="acks-extras-importer-abil-count"></span>
    </div>
    <div class="acks-extras-importer-browse-list acks-extras-importer-mon-list">${rows}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 560, height: 700 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      const listEl = root.querySelector(".acks-extras-importer-mon-list");
      const count = root.querySelector(".acks-extras-importer-abil-count");
      const all = () => [...listEl.querySelectorAll(".acks-extras-importer-browse-row")];
      const shown = () => all().filter((r) => r.style.display !== "none");
      const tally = () => {
        const n = listEl.querySelectorAll('input[name="sel"]:checked').length;
        count.textContent = game.i18n.format(`${LANG_PREFIX}.ui.abilCount`, { n, shown: shown().length });
      };
      const refresh = () => {
        const q = root.querySelector('[name="filter"]').value.toLowerCase();
        const hide = root.querySelector('[name="hideHave"]').checked;
        for (const r of all()) {
          const ok = r.dataset.name.includes(q) && (!hide || r.dataset.have === "0");
          r.style.display = ok ? "" : "none";
          // A hidden row must not stay selected: what the list shows is the only
          // honest account of what pressing Import will do.
          if (!ok) r.querySelector('input[name="sel"]').checked = false;
        }
        tally();
      };
      const check = (rows_) => {
        for (const r of rows_) r.querySelector('input[name="sel"]').checked = true;
        tally();
      };
      for (const sel of ['[name="filter"]', '[name="hideHave"]']) {
        root.querySelector(sel).addEventListener("input", refresh);
      }
      listEl.addEventListener("change", tally);
      // "All" ignores the filter on purpose — it is the whole-book button, and
      // clearing the filter first would silently change what the user is looking
      // at. "Shown" is the filtered counterpart.
      root.querySelector('[data-act="all"]').addEventListener("click", () => {
        root.querySelector('[name="filter"]').value = "";
        root.querySelector('[name="hideHave"]').checked = false;
        refresh();
        check(all());
      });
      root.querySelector('[data-act="shown"]').addEventListener("click", () => check(shown()));
      root.querySelector('[data-act="none"]').addEventListener("click", () => {
        for (const el of listEl.querySelectorAll('input[name="sel"]')) el.checked = false;
        tally();
      });
      tally();
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => el.value);
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        // Re-read rather than trusting the marks drawn when the dialog opened —
        // an import may have happened in another window since.
        const present = await importedIdSet();
        const todo = picked.filter((id) => !present.has(id));
        const done = await importMany(todo, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
        reportImport(done, picked.length, picked.length - todo.length, todo);
      },
    },
  });
}

/**
 * GM: import every monster the open book's cookbook ships.
 *
 * The counterpart to importing every ability. Skips what the world already has,
 * so it is a top-up after connecting more of the book, not a duplicator.
 */
export async function cookbookImportMonsters() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  if (!openBooks.length) {
    return ui.notifications.warn(
      `${MODULE_ID} | no cookbook book is open this session — connect one first (PoC 2 / unlock dialog).`,
    );
  }
  // Family MEMBERS don't import individually here — their family's generator
  // template covers them (baseline + select the special case). The dialog
  // still offers members one at a time.
  const members = familyMemberIds();
  const ids = actorEntriesAcrossBooks().rows.map((r) => r.id).filter((id) => !members.has(id));
  const present = await importedIdSet();
  const todo = ids.filter((id) => !present.has(id));
  if (!todo.length) {
    return ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllPresent`, { n: ids.length }));
  }
  // Reading a whole book takes minutes and makes hundreds of actors, so say what
  // is about to happen while it can still be called off.
  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.cookbookTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllConfirm`, {
      n: todo.length,
      book: openBooks.map((b) => BOOKS[b]?.label ?? b).join(", "),
      pack: packLabelsFor("Actor", todo) || packLabel("Actor"),
    })}${
      todo.length < ids.length
        ? ` ${game.i18n.format(`${LANG_PREFIX}.ui.cookbookAllConfirmSkip`, { skipped: ids.length - todo.length })}`
        : ""
    }</p>`,
  });
  if (!ok) return null;
  const done = await importMany(todo, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
  reportImport(done, ids.length, ids.length - todo.length, todo);
  return { done, skipped: ids.length - todo.length };
}

/**
 * `ability-provider` (ACKS Extras' lib service contract v1): resolve proficiency name
 * tokens into embeddable ability ItemData. Tier 1 reuses the world's own
 * imported items (the same name index the monster import uses, including its
 * proficiency-vs-class-power disambiguation); tier 2 imports the definition
 * from the cookbook; an unresolvable token is reported, never fatal. A
 * "(specialty)" suffix survives onto the embedded copy's name only.
 */
export async function resolveAbilities(tokens) {
  const items = [];
  const missing = [];
  const nameIndex = abilityNameIndex();
  const loadedById = await importedIndex();
  const present = new Set(loadedById.keys());
  for (const raw of tokens ?? []) {
    const token = String(raw).trim();
    if (!token) continue;
    const m = token.match(/^(.*?)\s*\(([^)]+)\)\s*\d*$/);
    const base = (m ? m[1] : token.replace(/\s*\d+$/, "")).trim();
    const specialty = m?.[2] ?? null;
    // A short form the books print for a name this module already ships is
    // authored on the entry as an alias and reaches the index through it, so
    // nothing here needs to know which words a printing merged.
    const guess = idForName(nameIndex, base, present);
    const id = guess?.id ?? null;
    let item = id ? loadedById.get(id) : null;
    if (!item && id) item = await importAbility(id).catch(() => null);
    if (!item) {
      missing.push(token);
      continue;
    }
    const data = item.toObject();
    delete data._id;
    if (specialty) data.name = `${data.name} (${specialty})`;
    items.push(data);
  }
  return { items, missing };
}
