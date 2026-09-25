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
import { trainingChanges } from "../classes/training-logic.mjs";
import { bookText, entryText, entryTable, escapeText, nodeParagraphs } from "./prose.mjs";
import {
  handWrittenProse,
  refreshImported,
  REPAIR,
  REFILL_STAT_PATHS,
  repairTally,
  repairCounts,
  countRepair,
  unrepaired,
} from "./refresh.mjs";
import { isPoiEntry, poiGroupOf, districtPlaceId, districtPlaceData, poiLocationData } from "./poi-binding.mjs";
import {
  isOrganisationRow, organisationData, organisationPlan, owedRelations, controlledRegions,
} from "./faction-binding.mjs";
import { printedNameOf, withoutKeyNumber } from "./printed-name.mjs";
import {
  isSceneRecipe, sceneFrame, sceneData, districtRegionData, placeTokenAt, worldCopySource, isWorldCopy, placementMatches, afterDarkShift, bandOfSection,
} from "./scene-binding.mjs";
import { FACTION_TYPE } from "../factions/constants.mjs";
import { DISTRICT_TYPE } from "../formation/district-find.mjs";
import { mirrorCreatedLinks } from "../location/scene-link.mjs";
import { occupantRow } from "../lib/place.mjs";
import { oseAdventureData, oseAdventureId } from "./ose-location.mjs";
import { BOOKS, bookIsJudges, bookLine } from "./books.mjs";
import { OSE_PREFIX, oseSourceLabel, oseSourceLine } from "./ose-source.mjs";
import { oseGroupBookOf } from "./ose-template.mjs";
import { executeEntry, materializeEffects, attackModel, convertName } from "./executor.mjs";
import { slugLabel } from "./table-extract.mjs";
import { TABLE_RECIPES } from "./table-recipes.mjs";
import { getLayer, PRIORITY } from "../lib/tables.mjs";
import { pageItems, pageArtPlacements } from "./extract.mjs";
import { WEAPON_TABLE, extractWeaponsFromDoc, bindWeaponRow, bindAmmoRow } from "./weapon-tables.mjs";
import { ARMOR_TABLE, extractArmorFromDoc, bindArmorRow } from "./armor-tables.mjs";
import { extractPriceMapFromDoc, extractPriceRowsFromDoc, priceFor, priceKey, PRICE_TABLES } from "./gear-prices.mjs";
import { savesForLevel, parseHitDice } from "./stats.mjs";
import { hdFormula } from "../lib/actor-read.mjs";

/** A class or race key: the name with everything but letters and digits gone. */
const foldKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
import { progressBar } from "./progress.mjs";
import * as services from "../lib/services.mjs";
import { libraryPackLabel, judgeLine } from "../lib/library.mjs";
import { ensureLibraryPack } from "../lib/library-target.mjs";
import { nameKeys, ABILITY_CATEGORIES } from "../lib/vocab.mjs";
import { materializeTemplates, TEMPLATE_PART } from "../classes/template-packages.mjs";
import { CLASS_TYPE, RACE_TYPE } from "../classes/constants.mjs";
import { VEHICLE_TYPE } from "../vehicles/constants.mjs";
import { VARIATION_ITEM_TYPE } from "../equipment/constants.mjs";
import { TRAP_ITEM_TYPE } from "../formation/constants.mjs";
// The spell primitive's DataModel is not imported here: this file loads under
// plain Node in the offline harness, and the model needs `foundry`. The bind
// writes the plain shape `spellFromStat` returns; the model coerces on read.
import { SPELL_TYPE, FLAG_SPELL } from "../magic/constants.mjs";
import { parseStatBlock, spellFromStat, reversedNameFrom, coreFieldsFrom } from "../magic/spell-logic.mjs";
import { spellNameKey, splitSpellNames, titleIndex, scanMonsterSpells, castsAsClass, castSourceOf } from "../magic/spell-names.mjs";
import { slotsFromCells, slotsOfClass, coreSlotsPatch, repertoireFor, spellPayload, spellsByName, classNamed } from "../magic/repertoire.mjs";
import { frequencyOf } from "./executor.mjs";
import { warmSpellPacks } from "../classes/grants.mjs";
import { equipmentClass, weaponIdentity } from "../equipment/profiles.mjs";
import { gearProfileFor } from "../equipment/config.mjs";
import { annotateItem } from "../equipment/api.mjs";
import { ANIMAL_TYPE, TEMPLATE_TYPE } from "../lib/constants.mjs";
import { acksExtras } from "../namespace.mjs";
import { unset } from "../lib/util.mjs";

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
 * The one function every write (`packFor`, `ensureFolderPath`) and every
 * presence check (`importedActor`, `importedIdsOfType`) derives the
 * destination from. A book written for the Judge alone resolves to its
 * series' JUDGE line (`judgeLine`), whose packs no player seat can open.
 */
export function lineOf(bookId) {
  if (!bookId) return null;
  const id = String(bookId);
  if (id === "ose" || id.startsWith(OSE_PREFIX)) return oseSourceLine(id) ?? UNLINED_LINE;
  return bookIsJudges(id) ? judgeLine(bookLine(id)) : bookLine(id);
}

/**
 * The book a cookbook id belongs to: what the flag says, else the id's own
 * prefix. `dmb.group.bard` is dmb; `ose.milk.p7` is the source `ose.milk`,
 * since an `ose.*` id spends two segments naming its book. The registry, not
 * the segment count, decides which — `ose.hand` is two segments but names no
 * book.
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
 * How many shipped entries this book unlocks. Counts both shapes: per-book
 * cookbooks (monsters) keyed by the book, and content-type cookbooks that
 * span books and name it per entry.
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
  const hd = parseHitDice(s.hitDice);
  if (hd) extras.hd = { ...hd, dieType: 8 };
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
  const cast = castsAsClass(paras.map((p) => p.text).join(" "));
  // The class document's own name where one answers the printed word (a plural, a lower case), the word itself otherwise.
  if (cast) extras.spellcasting = { class: classNamed(cast.className)?.name ?? capitalize(cast.className), level: cast.level };

  return extras;
}

/**
 * Size key -> prototype token footprint in grid squares. Small and Man-Sized
 * both read 1×1: frontage describes how many creatures fit in a line, not a
 * sub-square token. Kept local rather than imported from the monsters
 * feature's own size table, since a seat may not have it installed.
 * `largeHugeGigantic` is absent: that register key names a printed range, and
 * picking a single footprint for it would be inventing one.
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

  // A fraction of a die rolls a smaller die (a ½ rating is 1d4), which is what
  // lets a sub-1-HD animal read back as one — the familiar rule's whole test.
  const hd = parseHitDice(s.hitDice);
  if (hd) {
    const bonus = hd.bonus ?? 0;
    const avg = Math.max(1, Math.floor(hd.count * 4.5 + bonus));
    system.hp = { hd: hdFormula({ count: hd.count, dieType: 8, bonus }), value: avg, max: avg };
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

/**
 * The spells a stat block's prose gives a creature — embedded copies of the
 * imported documents — and the slot block it casts from.
 *
 * Three readings of the prose (`scanMonsterSpells`). A spell named outright
 * ("(as the spell X)", "X (as the spell)", a "spell-like abilities:" list)
 * becomes a copy whose usage is the frequency printed beside it. "Casts
 * spells as a Nth-level <class>" sets the slot block from that class's grid
 * at that level and, with no printed repertoire, draws one to the slots from
 * the class's own list. A printed repertoire ("1st - a, b; 2nd - c") is
 * copied as printed, and its counts are the slots when no class grid says
 * otherwise. A name no document answers stays in the prose the sheet shows.
 * A creature that only names spells draws nothing: those are its abilities.
 * See docs/monsters/DECISIONS.md, "A spellcasting monster carries the imported spells".
 */
function bindMonsterSpells(paras) {
  const prose = (paras ?? []).map((p) => p?.text ?? "").join(" ");
  const out = { items: [], spells: null };
  if (!/\bspell/i.test(prose)) return out;
  const world = spellsByName();
  const scan = scanMonsterSpells(prose, { known: world.has, freqOf: frequencyOf });
  const carried = new Set();
  const carry = (doc, usage = "") => {
    if (!doc || carried.has(doc.uuid)) return;
    carried.add(doc.uuid);
    const payload = spellPayload(doc);
    if (usage) ((payload.flags ??= {})[MODULE_ID] ??= {}).usage = usage;
    out.items.push(payload);
  };
  for (const { name, frequency } of scan.named) carry(world.resolve(name), frequency);
  const cast = castsAsClass(prose);
  const cls = cast ? classNamed(cast.className) : null;
  let slots = cls ? slotsOfClass(cls, cast.level) : null;
  if (scan.repertoire.length) {
    for (const { names } of scan.repertoire) for (const name of names) carry(world.resolve(name));
    slots ??= Object.fromEntries(scan.repertoire.map((r) => [r.level, r.names.length]));
  } else if (cls && slots) {
    for (const doc of repertoireFor(cls, slots, { level: cast.level })) carry(doc);
  }
  // The tab that lists them is on for any creature carrying a spell; its
  // slots stay at zero unless a grid or a printed repertoire fills them.
  if (slots) out.spells = coreSlotsPatch(slots).spells;
  else if (out.items.length) out.spells = { enabled: true };
  return out;
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

    // An authored `ref` wins outright; without one, the name is resolved against
    // the ids this world already holds before category preference applies.
    const guess = prof.ref ? null : idForName(nameIndex, prof.text, present);
    const id = prof.ref ?? guess?.id ?? null;
    // Once per distinct resolution: a bulk import walks hundreds of blocks with
    // the same handful of shared names.
    reportGuess(prof.text, guess);

    // The creature's own throw target ("climbing 6+"), split off by stripRoll,
    // outranks the definition's generic ladder — bindAbility resolves that only
    // at 1st level, with no actor to read.
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

    // 1. ALREADY LOADED — copy the item the world holds; it already materialized
    //    its throws and effects, and carries whatever the GM tuned.
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

  // What the prose says the creature casts — by name, as a class of a level,
  // or from a printed repertoire — rides as the imported spells themselves.
  const cast = bindMonsterSpells(f.description ?? []);
  if (cast.spells) system.spells = cast.spells;
  items.push(...cast.items);

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
 * The PACK is the container; entries without a group sit in the book folder,
 * and content-type items (abilities, equipment) use their own top level
 * instead of a book. Folders are cached for the session and pre-created
 * before any concurrent import starts. Never more than two levels —
 * `ensureFolderPath` refuses a deeper path rather than creating it. See
 * docs/importer/DECISIONS.md, "The pack is the container: compendium-only,
 * two levels deep".
 */
const FOLDER_MAX_DEPTH = 2;
const folderCache = new Map();

/* -------------------------------------------- */
/*  Import target: world documents or compendium */
/* -------------------------------------------- */

/**
 * Imports land in WORLD COMPENDIUMS, one per document type, created on first
 * use and cached by type. `createDoc` passes `{pack}` at creation and
 * `ensureFolderPath` builds the tree inside the pack, so nothing is staged in
 * the sidebar and swept up afterwards. World packs are unlocked by default,
 * so an imported document stays editable and draggable. See
 * docs/importer/DECISIONS.md, "The pack is the container: compendium-only,
 * two levels deep".
 */
const packCache = new Map();

/**
 * The visible name of a pack — what every "imported into…" message names, and
 * what `cookbookRemoveImports` recognises its own packs by. Every label keeps
 * the `FOLDER_NAME` prefix whatever line it holds. See
 * docs/importer/DECISIONS.md, "The prefix is load-bearing."
 */
const packLabel = libraryPackLabel;

/**
 * Every world pack of a type this module owns, whatever line it holds. The
 * read counterpart of `packFor`: a write goes to one shelf, but a presence
 * check has to ask them all, since a batch mixes ids from several lines.
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
 * Reads world-then-pack, matching the actor side (`importedIdsOfType`,
 * `importedActor`). Recognised by the cookbook flag, same as
 * `cookbookRemoveImports`; never the class templates' skinned copies, which
 * inherit the definition's cookbook id, and never a copy of an import
 * (`isWorldCopy`), which is the Judge's and survives a rebuild. See
 * docs/importer/DECISIONS.md, "The library is the packs AND the sidebar this
 * module stamped".
 */
const sidebarImports = (type) => {
  const world = { Actor: game.actors, Item: game.items, JournalEntry: game.journal, RollTable: game.tables }[type];
  return [...(world ?? [])].filter(
    (d) => d.getFlag(MODULE_ID, "cookbook") && !d.flags?.[MODULE_ID]?.templatePart && !isWorldCopy(d),
  );
};

/**
 * The pack collection id imports of this type and line go to, or null if it
 * cannot be opened. A null line is the ACKS library's own pack. The cached
 * answer is confirmed against `game.packs` before it is handed out — a pack
 * can go away under a running session (deleted, or swept by Remove Imports on
 * another seat) — and re-resolving simply creates the pack again.
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
      // The shelf is the lib's to open (`library-target.mjs`): the class
      // templates and the rules tables write to the same shelves, and one
      // opener is what keeps three writers on one label per line.
      const pack = await ensureLibraryPack(type, line);
      if (!pack) throw new Error(`no ${packLabel(type, line)} compendium`);
      return pack.collection;
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
 * Create a document in this type's compendium, on its own line's shelf. The
 * line is read off the document's OWN cookbook flag rather than passed in;
 * `opts.line` answers only for a document with no flag to read. Every import
 * path must write through here — a second creator calling `Actor.create`
 * directly puts the document in the sidebar, where the presence checks do not
 * look. See docs/importer/DECISIONS.md, "The shelf is derived from the
 * document's own cookbook flag, not passed in."
 */
export const createDoc = async (cls, data, { line = null, ...opts } = {}) =>
  remembered(await cls.create(data, { ...opts, ...(await packOpts(cls.documentName, lineOfData(data) ?? line)) }));

/**
 * Teach the dedup index about a document the moment it exists. Keyed off the
 * document's own cookbook flag rather than a caller-supplied id, so no
 * creator can forget. Items only: the index is an Item index. See
 * docs/importer/DECISIONS.md, "Every create teaches the dedup index".
 */
function remembered(doc) {
  if (doc?.documentName !== "Item") return doc;
  const id = doc.getFlag(MODULE_ID, "cookbook")?.id;
  if (id) rememberImported(id, doc);
  return rememberName(doc);
}

/**
 * Create MANY documents in one write, chunked rather than one giant call so a
 * rejected batch does not take everything down with it. See
 * docs/importer/DECISIONS.md, "Writes are batched, because a write costs
 * what the shelf already holds".
 */
export const WRITE_CHUNK = 50;
export async function createDocs(cls, dataList, opts = {}) {
  if (!dataList.length) return [];
  // One slot per input, `null` where that document was not created; paired to
  // inputs by cookbook id below, never by position. See
  // docs/importer/DECISIONS.md, "A batched write files by identity, never by
  // position".
  const out = new Array(dataList.length).fill(null);

  // Grouped by LINE: one resolved pack for a mixed list writes everything to
  // whichever shelf the first document wanted.
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
        // Matched by cookbook id, never by position: `createDocuments` drops an
        // invalid document rather than throwing, so `made` can be shorter than
        // `chunk`. Anything unidentifiable falls into the chunk's first free slot.
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
 * write lands on, and the sidebar ones a sidebar-era release left behind (see
 * `sidebarImports`). Excludes the skinned template copies, which inherit the
 * definition's cookbook id. Cached, since dedup is asked once per id across a
 * whole-corpus import; `rememberImported` keeps the cache honest as new ones
 * are created.
 */
let importedCache = null;
async function importedIndex() {
  if (importedCache) return importedCache;
  // Every Item shelf this module owns, whatever line — items are shared across
  // books, so a line that ever mints one is deduplicated rather than twinned.
  const collections = ourPacksOfType("Item");
  const docs = [
    ...(await Promise.all(collections.map((c) => c.getDocuments().catch(() => [])))).flat(),
    ...sidebarImports("Item"), // packs first: the write's own shelf wins when a world holds both
  ];
  const byId = new Map();
  for (const doc of docs) {
    // A class template's part is a copy that kept its definition's claim; it
    // never answers for the id, or a grant copies one class's specialty name
    // ("A template part is not an import", docs/importer/DECISIONS.md).
    if (doc.getFlag(MODULE_ID, TEMPLATE_PART)) continue;
    const flag = doc.getFlag(MODULE_ID, "cookbook");
    // Every id the document answers for: its own, and any it absorbed on merge
    // (see "Same name, two books: merge unless they differ beyond their
    // source", docs/importer/DECISIONS.md).
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
 * Imports for a cookbook id that are still being built, keyed by id. The
 * claim is the PROMISE, as `ensureFolderPath` claims a folder: the second
 * caller waits for the first one's document instead of building a twin.
 * Keyed on the cookbook id alone and shared by every item importer, so the
 * class import and the ability import land on the same item. See
 * docs/importer/DECISIONS.md, "One dedup rule for every importer: ask the
 * shelf you write to, and claim before you build".
 */
const inflightImports = new Map();

/**
 * The item for a cookbook id: the one already imported, the one another caller
 * is importing right now, or a fresh one from `build`. `build` runs at most
 * once per id per session; a build that yields nothing releases the claim so
 * a later attempt can try again.
 */
async function claimImport(id, build) {
  return claimed(id, importedItem, rememberImported, build);
}

/**
 * The ACTOR-side claim: same rule, the actor collection instead of the item
 * index. Nothing is remembered — actors are found by their flag, not by an
 * index. Exported because the OSE book importers write actors too.
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
    // The claim covers the in-flight window only, never past resolution — see
    // docs/importer/DECISIONS.md, "Amended 2026-08-06 (2.4.2): a claim is a
    // window, not a cache."
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
 * collection an actor importer writes to. `opts` is `importedActor`'s.
 */
export const importedActorFor = (id, opts) => importedActor(id, opts);

/**
 * Every document of a type the library holds — the packs', loaded, and the
 * sidebar's (`sidebarImports`). The one way to enumerate imports; a pass that
 * walks `game.<collection>` alone or the packs alone misses part of the
 * library. See docs/importer/DECISIONS.md, "The library is the packs AND the
 * sidebar this module stamped".
 */
export async function importedDocs(type) {
  const packed = (await Promise.all(ourPacksOfType(type).map((c) => c.getDocuments().catch(() => [])))).flat();
  return [...packed, ...sidebarImports(type)];
}

/** Delete imported documents of a type from wherever the library lives. */
async function deleteImported(type, docs) {
  if (!docs.length) return 0;
  // Grouped by the pack each document is ON, never by one resolved target —
  // the list can span lines.
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
 * Shelf re-reads in flight, keyed by pack collection id — see `liveCopy`, so
 * every concurrent worker meets an eviction in the same instant rather than
 * each ordering its own full copy of the pack.
 */
const shelfReloads = new Map();

/**
 * The live document behind a cached one, or null once it is really gone. A
 * compendium is a CACHE over the shelf, not the shelf: presence is asked of
 * its INDEX, which survives an eviction, and the document is re-read only
 * once the index says yes. A world document has no eviction and answers from
 * its own collection. See docs/importer/DECISIONS.md, "A compendium is a
 * cache; presence is asked of its index".
 */
async function liveCopy(doc) {
  if (!doc.pack) return doc.collection?.get?.(doc.id) ?? null;
  const pack = game.packs.get(doc.pack);
  if (!pack?.index?.has(doc.id)) return null;
  if (pack.has(doc.id)) return pack.get(doc.id);
  let pending = shelfReloads.get(doc.pack);
  if (!pending) {
    // The whole shelf, not the one document: the eviction dropped every id the
    // caller's loop is about to ask for.
    pending = pack.getDocuments().catch(() => []);
    shelfReloads.set(doc.pack, pending);
    pending.finally(() => shelfReloads.delete(doc.pack));
  }
  await pending;
  return pack.get(doc.id) ?? null;
}

/**
 * The already-imported item for this cookbook id, or null.
 *
 * The index is cached for a whole session, so it can hold a document the GM has
 * since deleted — and answering "already imported" for a document that is gone
 * would break the one refresh a GM has: delete the item, import again, get the
 * new derived values. So the cached hit is confirmed by `liveCopy` before it is
 * trusted, and a stale one is dropped.
 */
const importedItem = async (id) => {
  const cached = (await importedIndex()).get(id) ?? null;
  if (!cached) return null;
  const live = await liveCopy(cached);
  // A re-read after an eviction builds NEW instances, so the index has to take
  // the one the pack now holds — the evicted object it was holding answers for
  // a document nothing else in the session will ever hand out again.
  if (live && live !== cached) importedCache?.set(id, live);
  if (live) return live;
  importedCache?.delete(id);
  return null;
};

/**
 * The already-imported ACTOR for this cookbook id, or null — the actor-side
 * counterpart of importedItem, asked of whichever target actors go to. Not
 * indexed: the actor importers already carry `importedIdSet`, and this answers
 * the one question that needs the document itself (an animal, a companion).
 * The world answers first, copies included, so a scene's places link to one
 * another; `copies: false` asks for the library's own document, which is what
 * an "already imported?" check needs (`isWorldCopy`).
 */
async function importedActor(id, { copies = true } = {}) {
  const world = game.actors.find((a) => a.getFlag(MODULE_ID, "cookbook")?.id === id && (copies || !isWorldCopy(a)));
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
    // Cache the PROMISE, not the resolved folder: the second concurrent caller
    // then awaits the first one's folder instead of creating a duplicate.
    let pending = folderCache.get(key);
    if (!pending) {
      const parentId = parent?.id ?? null;
      pending = (async () =>
        (collection ?? game.folders).find(
          (fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId,
        ) ??
        // Marked like every document this module makes, so removal can find it;
        // an adopted folder (one already there under this name) stays unmarked.
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
 * What a book is CALLED — the folder its imports are filed under, and the name
 * any message about it uses. A shipped book is named by the registry; a
 * Judge-registered source by the name they typed for it, which is the only name
 * it has. Falls back to the id so a book with neither is still named something.
 */
const bookLabel = (bookId) => BOOKS[bookId]?.label ?? oseSourceLabel(bookId) ?? bookId;
/**
 * The folder an entry of this kind belongs in, creating the path as needed —
 * inside its book's LINE pack, so the tree and the pack always agree.
 */
const targetFolder = (type, bookId, group) =>
  ensureFolderPath(type, [bookLabel(bookId), group], lineOf(bookId));

/**
 * Every cookbook id already held for one document type, in WHICHEVER target is
 * configured — the sidebar collection plus, in compendium mode, the pack INDEX
 * (read with the cookbook flag as an index field, so no document is loaded).
 * Every "have I imported this already?" question routes through here. See
 * docs/importer/DECISIONS.md, "One dedup rule for every importer: ask the
 * shelf you write to, and claim before you build".
 */
async function importedIdsOfType(type, worldCollection) {
  // Never a class template's part: a skinned copy inherits the definition's
  // id, and counting it would let it answer for the shared definition. Never a
  // copy of an import either (`isWorldCopy`): counting it would stop a rebuild
  // putting the library's own document back.
  const part = (flags) => !!flags?.[MODULE_ID]?.[TEMPLATE_PART];
  const ids = new Set(
    [...worldCollection]
      .filter((d) => !part(d.flags) && !isWorldCopy(d))
      .map((d) => d.getFlag(MODULE_ID, "cookbook")?.id)
      .filter(Boolean),
  );
  // Every shelf: a batch mixes lines, so asking one pack answers "not
  // imported" for every book shelved elsewhere.
  for (const collection of ourPacksOfType(type)) {
    // A failed index read must be LOUD — an empty set here reads as "nothing
    // imported yet" and a bulk run re-creates everything as twins.
    const index = await collection
      .getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`, `flags.${MODULE_ID}.${TEMPLATE_PART}`] })
      .catch((err) => {
        console.warn(
          `${MODULE_ID} | importedIdsOfType: index of ${collection.collection} unreadable — imported ${type}s may be recreated`,
          err,
        );
        return null;
      });
    for (const row of index ?? []) {
      if (part(row.flags)) continue;
      const id = row.flags?.[MODULE_ID]?.cookbook?.id;
      if (id) ids.add(id);
    }
  }
  return ids;
}

/**
 * Cookbook ids already held as ACTORS, wherever imports go. A monster import
 * always CREATES — `importOne` has no reuse to fall back on — so every actor
 * import path filters through this, which is what makes "import all" safe to
 * press twice.
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
 * Monster TYPE → folder name: the stat block's own taxonomy (Animal, Undead,
 * Beastman, …), which is what a Judge actually browses by.
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
 * THE one destination rule for a cookbook ACTOR — every actor importer asks
 * it, so no two of them can disagree about where a creature belongs.
 */
function actorFolderFor(id, found = cookbookEntry(id), opts = {}) {
  // The Animals shelf is cross-book, but not cross-LINE: it is built in
  // whichever pack this entry's own book writes to, because the folder and the
  // document have to end up in the same compendium.
  if (isAnimalEntry(found?.entry)) return ensureFolderPath("Actor", ["Animals"], lineOf(bookOf(found)));
  return targetFolder("Actor", bookOf(found), actorGroupOf(found, id, opts));
}

/**
 * The folder an import from this book belongs in — its book's shelf, inside
 * its line's pack. Exported for the OSE importers, which build their
 * documents outside this file and would otherwise have to know how a line
 * becomes a pack.
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
  const where = { id, book: node.book, page: node.page };
  for (const [field, lines] of texts) description[field] = bookText(lines, field === last ? cite : "", where);
  // A page that matched but yielded no prose still says where it was read from.
  if (!description[last]) description[last] = bookText([], cite, where);
  const extras = { ...buildExtras(node), description };
  return { biography: bookText(nodeParagraphs(node), cite, where), extras };
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
/*  Repair in place                             */
/* -------------------------------------------- */

/**
 * Write a fresh read of `id` over one imported document: execute the entry on
 * this seat, bind it with `build(node)`, and write the build under `policy`
 * (`refreshImported`). Resolves to the written plan, or to why nothing was
 * written — `book-closed` when the entry's book is not open here, `no-match`
 * when its page no longer matches, `error` when the binding threw.
 */
async function repairFromEntry(doc, id, build, policy) {
  const found = cookbookEntry(id);
  const session = found ? ctx.sessionDocs.get(bookOf(found)) : null;
  if (!session) return "book-closed";
  const node = await executeEntry(session.doc, found.cb, data.registers, id).catch(() => null);
  if (!node?.ok) return "no-match";
  let built;
  try {
    built = await build(node);
  } catch (err) {
    console.error(`${MODULE_ID} | repair ${id}: the binding failed`, err);
    return "error";
  }
  return refreshImported(doc, built, policy);
}

/**
 * How each refill run repairs instead of rebuilding: given the cookbook ids it
 * may touch and a tally (`repairTally`) to count into, it writes every held
 * document over where it stands and imports the ids the world lacks. A run
 * missing here has no in-place write — the weapons, armour, language and race
 * shelves are built from whole printed tables — and can only rebuild.
 */
const REPAIR_RUNS = {
  cookbookImportAbilities: async (only, tally) => {
    await cookbookUpdateAbilities({ only, repair: tally });
    return cookbookImportAbilities({ only });
  },
  importClasses: async (only, tally) => {
    await cookbookUpdateClasses({ only, confirm: false, repair: tally });
    return importClasses({ only });
  },
  importAllEquipment: (only, tally) => importAllEquipment({ only, repair: tally }),
  importTraps: (only, tally) => importTraps({ only, repair: tally }),
  importSpells: (only, tally) => importSpells({ only, repair: tally }),
  importVariations: (only, tally) => importVariations({ only, repair: tally }),
  importVehicles: (only, tally) => importVehicles({ only, repair: tally }),
};

/** Every entry id a repair run can write in place, across the picker's sources. */
const repairableEntryIds = () =>
  ENTRY_SOURCES.filter((src) => REPAIR_RUNS[src.refill]).flatMap((src) => src.entries().map(([id]) => id));

/**
 * Can a monster-picker entry be repaired in place? Only a stat-block monster:
 * a template, a family, an NPC or a legacy block is built another way and can
 * only rebuild.
 */
const repairableMonster = (id) => {
  const kind = cookbookEntry(id)?.entry?.kind;
  return !kind || kind === "kind.monster";
};

/** The mode control both rebuild dialogs carry, Rebuild chosen. */
function modeSelect() {
  const t = (key) => game.i18n.localize(`${LANG_PREFIX}.ui.${key}`);
  return `<div class="form-group"><label>${t("reimportMode")}</label>
      <select name="mode">
        <option value="drop" selected>${t("reimportModeDrop")}</option>
        <option value="repair">${t("reimportModeRepair")}</option>
      </select></div>
      <p class="notes">${t("reimportModeHint")}</p>`;
}

/** Ask before a repair: one paragraph per line, an empty line left out. */
function confirmRepair(lines, titleKey = "reimportTitle") {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.${titleKey}`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: lines
      .filter(Boolean)
      .map((line) => `<p>${line}</p>`)
      .join(""),
  });
}

/** The lines every repair confirm closes on: what a repair keeps, and the kinds it writes differently. */
function repairKeepsLines(runs, { monsters = false } = {}) {
  const t = (key) => game.i18n.localize(`${LANG_PREFIX}.ui.${key}`);
  return [
    monsters ? t("repairMonsters") : "",
    runs.has("cookbookImportAbilities") ? t("repairAbilities") : "",
    runs.has("importClasses") ? t("repairClasses") : "",
    t("repairKeeps"),
  ];
}

/** Report a repair run from its tally. */
function reportRepair(tally) {
  ui.notifications.info(
    game.i18n.format(`${LANG_PREFIX}.ui.repairDone`, {
      replaced: tally.replaced,
      kept: tally.keptProse,
      refused: tally.refused,
    }),
  );
  if (tally.refused) ui.notifications.info(game.i18n.localize(`${LANG_PREFIX}.ui.repairRefusedHint`));
}

/**
 * Repair ONE shelf in place: every entry filed on it is written over its
 * document where that stands, and imported where the world lacks it. A
 * document whose book is not open here is left and counted, as the rebuild
 * keeps it; one no run writes in place (a price-list row) is left too.
 */
async function repairShelf(shelf) {
  const run = SHELF_REFILL[shelf];
  if (!REPAIR_RUNS[run]) return ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.repairShelfRebuildOnly`, { shelf }));
  const prefixes = shelfPrefixes(shelf);
  const onShelf = (id) => prefixes.some((p) => String(id).startsWith(`${p}.`));
  const ids = new Set(repairableEntryIds().filter(onShelf));
  // Actors too: an animal is an equipment entry filed as a creature.
  const shelved = [...(await importedDocs("Item")), ...(await importedDocs("Actor"))].filter(
    (d) => !d.flags?.[MODULE_ID]?.templatePart && onShelf(claimedId(d)),
  );
  const held = shelved.filter((d) => ids.has(claimedId(d)));
  const over = held.filter((d) => readableHere(claimedId(d)));
  const kept = held.length - over.length;
  const skipped = shelved.length - held.length;
  const ok = await confirmRepair([
    game.i18n.format(`${LANG_PREFIX}.ui.repairConfirm`, { n: over.length, shelf }),
    kept ? game.i18n.format(`${LANG_PREFIX}.ui.reimportKeepsClosed`, { n: kept }) : "",
    skipped ? game.i18n.format(`${LANG_PREFIX}.ui.repairSkipsDocs`, { n: skipped }) : "",
    ...repairKeepsLines(new Set([run])),
  ]);
  if (!ok) return null;
  const tally = repairTally();
  const refill = await REPAIR_RUNS[run](ids, tally);
  reportRepair(tally);
  return { shelf, mode: "repair", ...repairCounts(tally), refill: refill ?? null };
}

/**
 * Repair everything imported from ONE book in place, over the shelves the
 * rebuild would empty. Each run takes only this book's entries, so repairing
 * one book never writes over another book's documents. A document no run
 * writes in place is left, and its shelf named.
 */
async function repairBook(bookId, label) {
  const runs = new Map();
  for (const src of ENTRY_SOURCES) {
    if (src.type !== "Item" || !REPAIR_RUNS[src.refill]) continue;
    for (const [id] of src.entries()) {
      if (bookOf(cookbookEntry(id)) !== bookId || !refillShelfOf(id)) continue;
      if (!runs.has(src.refill)) runs.set(src.refill, new Set());
      runs.get(src.refill).add(id);
    }
  }
  const touched = new Set([...runs.values()].flatMap((ids) => [...ids]));
  const ofBook = (d) => {
    if (d.flags?.[MODULE_ID]?.templatePart) return false;
    const flag = d.getFlag(MODULE_ID, "cookbook");
    return !!flag?.id && bookOfFlag(flag) === bookId && !!refillShelfOf(flag.id);
  };
  // Actors too: an animal is an equipment entry filed as a creature.
  const docs = [...(await importedDocs("Item")), ...(await importedDocs("Actor"))].filter(ofBook);
  const shelfOf = (d) => refillShelfOf(claimedId(d));
  const over = docs.filter((d) => touched.has(claimedId(d)));
  const left = docs.filter((d) => !touched.has(claimedId(d)));
  const shelves = [...new Set(over.map(shelfOf))].sort();
  const ok = await confirmRepair([
    game.i18n.format(`${LANG_PREFIX}.ui.repairConfirmBook`, { n: over.length, book: label, shelves: shelves.join(", ") || "—" }),
    left.length
      ? game.i18n.format(`${LANG_PREFIX}.ui.repairSkipsShelves`, {
          n: left.length,
          shelves: [...new Set(left.map(shelfOf))].sort().join(", "),
        })
      : "",
    ...repairKeepsLines(runs),
  ]);
  if (!ok) return null;
  const tally = repairTally();
  const refill = {};
  // In SHELF_REFILL's order, which is Import Everything's.
  for (const run of new Set(Object.values(SHELF_REFILL))) {
    if (runs.has(run)) refill[run] = (await REPAIR_RUNS[run](runs.get(run), tally)) ?? null;
  }
  reportRepair(tally);
  return { book: bookId, mode: "repair", ...repairCounts(tally), refill };
}

/**
 * Repair the ticked entries in place: a stat-block monster is refilled whole
 * (`refillMonster`), every other kind's run writes its entries over the
 * documents that hold them and imports the ones the world lacks, and rules
 * tables merge as they always do. A kind no run writes in place is counted
 * and left as it is.
 *
 * @param {{key: string, id: string}[]} picked ticked rows whose book is open here
 * @param {number} closed ticked rows refused for a closed book, counted into the report
 */
async function repairEntries(picked, closed) {
  const docs = { Actor: await importedDocs("Actor"), Item: await importedDocs("Item") };
  const byKey = new Map();
  for (const { key, id } of picked) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
  }
  const runs = new Map();
  const monsters = [];
  let rebuildOnly = 0;
  for (const [key, ids] of byKey) {
    if (key === "Tables") continue;
    if (key === "Monsters") {
      for (const id of ids) {
        if (repairableMonster(id)) monsters.push(id);
        else rebuildOnly++;
      }
      continue;
    }
    const run = ENTRY_SOURCES.find((src) => src.key === key)?.refill;
    if (!REPAIR_RUNS[run]) {
      rebuildOnly += ids.length;
      continue;
    }
    if (!runs.has(run)) runs.set(run, new Set());
    for (const id of ids) runs.get(run).add(id);
  }
  const touched = [...monsters, ...[...runs.values()].flatMap((ids) => [...ids])];
  const claimed = (id) => (doc) => !doc.flags?.[MODULE_ID]?.templatePart && claimsEntry(doc, id);
  const over = [...docs.Actor, ...docs.Item].filter((doc) => touched.some((id) => claimed(id)(doc))).length;

  const ok = await confirmRepair(
    [
      game.i18n.format(`${LANG_PREFIX}.ui.repairConfirmEntries`, { n: over, picked: picked.length }),
      rebuildOnly ? game.i18n.format(`${LANG_PREFIX}.ui.repairSkipsEntries`, { n: rebuildOnly }) : "",
      ...repairKeepsLines(runs, { monsters: monsters.length > 0 }),
    ],
    "reimportEntriesTitle",
  );
  if (!ok) return null;

  const tally = repairTally();
  tally.refused += closed;
  const refill = {};
  // Monsters first, as the rebuild runs them.
  const missing = [];
  for (const id of monsters) {
    const held = docs.Actor.filter(claimed(id));
    if (!held.length) missing.push(id);
    for (const actor of held) {
      if (!unrepaired(tally, actor)) continue;
      const done = await refillMonster(actor, { whole: true }).catch((err) => {
        console.error(`${MODULE_ID} | repair ${actor.name}`, err);
        return null;
      });
      countRepair(tally, done?.ok ? done : (done?.reason ?? "error"));
    }
  }
  if (missing.length) refill.Monsters = await importMany(missing, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
  for (const [run, only] of runs) refill[run] = (await REPAIR_RUNS[run](only, tally)) ?? null;
  const tables = byKey.get("Tables");
  if (tables?.length) {
    const run = ENTRY_SOURCES.find((src) => src.key === "Tables").idsRefill;
    refill[run] = (await api()[run](tables)) ?? null;
  }
  reportRepair(tally);
  return { picked: picked.length, mode: "repair", rebuildOnly, ...repairCounts(tally), refill };
}

/* -------------------------------------------- */
/*  Reimport one shelf                          */
/* -------------------------------------------- */

/**
 * Which importer refills each top-level shelf. The shelves themselves are not
 * listed here — `ITEM_SHELF` already says which id namespaces land on which
 * shelf; this names only which run rebuilds one once it is empty. Every
 * importer here is dedup-driven, so it also imports whatever of its domain
 * the world never held. See docs/importer/DECISIONS.md, "Three controls, not
 * twenty-one".
 */
const SHELF_REFILL = {
  // Declared in the order Import Everything runs these steps; a book run,
  // which may need several, runs them in this order.
  Proficiencies: "cookbookImportAbilities",
  "Class Powers": "cookbookImportAbilities",
  Drawbacks: "cookbookImportAbilities",
  Skills: "cookbookImportAbilities",
  Equipment: "importAllEquipment",
  Weapons: "importWeapons",
  Armor: "importArmor",
  Variations: "importVariations",
  Traps: "importTraps",
  Spells: "importSpells",
  Classes: "importClasses",
  Languages: "cookbookImportTables",
  Races: "cookbookImportTables",
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
 * GM: empty ONE top-level shelf and import it again. Deleting first is the
 * point — import is idempotent, so only an empty shelf gets rebuilt.
 * Documents a class template made are never touched, nor is a document whose
 * entry's book is not open on this seat (`readableHere`) — the refill could
 * put back a stub at best. See docs/importer/DECISIONS.md, "Three controls,
 * not twenty-one".
 *
 * `mode: "repair"` writes over the shelf's documents in place instead
 * (`repairShelf`).
 *
 * @param {string} [shelf] a name from `reimportableShelves()`; omitted, asks.
 * @param {{mode?: "drop"|"repair"}} [opts]
 */
export async function cookbookReimportShelf(shelf = null, { mode = "drop" } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes and re-creates documents).`);
  const shelves = reimportableShelves();
  if (!shelf) {
    const esc = foundry.utils.escapeHTML ?? ((x) => x);
    // A shelf no run writes in place says so beside its name.
    const rebuildOnly = ` (${game.i18n.localize(`${LANG_PREFIX}.ui.reimportRebuildOnly`)})`;
    const shelfOptions = shelves
      .map((n) => `<option value="shelf:${esc(n)}">${esc(n)}${REPAIR_RUNS[SHELF_REFILL[n]] ? "" : esc(rebuildOnly)}</option>`)
      .join("");
    // Books beside shelves, in one picker: the value says which kind it names.
    const books = reimportableBooks();
    const bookOptions = books.map((b) => `<option value="book:${esc(b.id)}">${esc(b.label)}</option>`).join("");
    // The rules tables are no shelf: they are read into the ruledata store and
    // merge there, so the option re-reads them in place and deletes nothing.
    const tablesOption = `<option value="tables:">${esc(game.i18n.localize(`${LANG_PREFIX}.ui.reimportTablesAll`))}</option>`;
    return foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportTitle`) },
      classes: ["acks-ui", "acks-extras-importer-dialog"],
      content: `<p class="notes">${game.i18n.localize(`${LANG_PREFIX}.ui.reimportHint`)}</p>
        <div class="form-group"><label>${game.i18n.localize(`${LANG_PREFIX}.ui.reimportPick`)}</label>
        <select name="pick">
          <optgroup label="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.reimportGroupShelves`))}">${shelfOptions}</optgroup>
          ${books.length ? `<optgroup label="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.reimportGroupBooks`))}">${bookOptions}</optgroup>` : ""}
          <optgroup label="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.reimportGroupTables`))}">${tablesOption}</optgroup>
        </select></div>
        ${modeSelect()}`,
      ok: {
        label: game.i18n.localize(`${LANG_PREFIX}.ui.reimportGo`),
        callback: (event, button) => {
          const [kind, ...rest] = String(button.form.elements.pick.value).split(":");
          const picked = rest.join(":");
          const mode = String(button.form.elements.mode?.value ?? "drop");
          if (kind === "tables") return api().cookbookImportTables();
          return kind === "book" ? cookbookReimportBook(picked, { mode }) : cookbookReimportShelf(picked, { mode });
        },
      },
    });
  }
  if (!SHELF_REFILL[shelf]) return ui.notifications.warn(`${MODULE_ID} | "${shelf}" is not a shelf that can be rebuilt on its own.`);
  if (mode === "repair") return repairShelf(shelf);

  const prefixes = shelfPrefixes(shelf);
  const mine = (d) =>
    !d.flags?.[MODULE_ID]?.templatePart &&
    prefixes.some((p) => String(d.getFlag(MODULE_ID, "cookbook")?.id ?? "").startsWith(`${p}.`));
  const shelved = (await importedDocs("Item")).filter(mine);
  const doomed = shelved.filter((d) => readableHere(claimedId(d)));
  const kept = shelved.length - doomed.length;

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content:
      `<p>${game.i18n.format(`${LANG_PREFIX}.ui.reimportConfirm`, { n: doomed.length, shelf })}</p>` +
      (kept ? `<p>${game.i18n.format(`${LANG_PREFIX}.ui.reimportKeepsClosed`, { n: kept })}</p>` : ""),
  });
  if (!ok) return null;

  await deleteImported("Item", doomed);
  forgetImportedIndex(); // the shelf it remembers is the one just deleted
  const made = await api()[SHELF_REFILL[shelf]]();
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.reimportDone`, { n: doomed.length, shelf }));
  if (kept) ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.reimportKeptClosed`, { n: kept }));
  return { shelf, removed: doomed.length, kept, refill: made ?? null };
}

/** The module's own api, for `SHELF_REFILL` to name a run without importing it. */
const api = () => acksExtras.importer ?? {};

/** The rebuildable shelf a cookbook id files onto, or null when its shelf has no refill run. */
const refillShelfOf = (id) => {
  const shelf = ITEM_SHELF[shelfKeyOf(id)] ?? null;
  return shelf && SHELF_REFILL[shelf] ? shelf : null;
};

/** The book an imported document was read from: its entry's own book, else what its id spells. */
const bookOfFlag = (flag) => bookOf(cookbookEntry(flag.id)) ?? bookOfCookbookId(flag.id, flag.book);

/**
 * Every book open on this seat with something in the cookbook to rebuild,
 * labelled, in label order. A book that is not open is not offered: a reimport
 * deletes first, and what nothing can read back would stay deleted.
 */
export const reimportableBooks = () => {
  const withContent = new Set(data.books.keys());
  for (const cb of data.content.values()) for (const e of Object.values(cb.entries ?? {})) if (e.book) withContent.add(e.book);
  return [...withContent]
    .filter((id) => ctx?.sessionDocs?.has(id))
    .map((id) => ({ id, label: BOOKS[id]?.label ?? id }))
    .sort((a, b) => a.label.localeCompare(b.label));
};

/**
 * GM: delete every document imported from ONE book and import them again.
 * Only shelves with a refill run are touched. A document another book owns
 * that MERGED one of this book's ids stays, because it is that book's
 * document. See docs/importer/DECISIONS.md, "A book is a reimport unit too".
 *
 * `mode: "repair"` writes over the book's documents in place instead
 * (`repairBook`).
 *
 * @param {string} bookId a key of BOOKS, open on this seat.
 * @param {{mode?: "drop"|"repair"}} [opts]
 */
export async function cookbookReimportBook(bookId, { mode = "drop" } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes and re-creates documents).`);
  const label = BOOKS[bookId]?.label ?? bookId;
  if (!ctx?.sessionDocs?.has(bookId)) {
    return ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.reimportNotConnected`, { book: label }));
  }
  if (mode === "repair") return repairBook(bookId, label);
  const shelves = new Set();
  const mine = (d) => {
    if (d.flags?.[MODULE_ID]?.templatePart) return false;
    const flag = d.getFlag(MODULE_ID, "cookbook");
    if (!flag?.id || bookOfFlag(flag) !== bookId) return false;
    const shelf = refillShelfOf(flag.id);
    if (shelf) shelves.add(shelf);
    return !!shelf;
  };
  const doomed = (await importedDocs("Item")).filter(mine);
  const shelfList = [...shelves].sort().join(", ") || "—";

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.reimportConfirmBook`, { n: doomed.length, book: label, shelves: shelfList })}</p>`,
  });
  if (!ok) return null;

  await deleteImported("Item", doomed);
  forgetImportedIndex();
  // In SHELF_REFILL's order, which is Import Everything's.
  const runs = [...new Set(Object.entries(SHELF_REFILL).filter(([shelf]) => shelves.has(shelf)).map(([, run]) => run))];
  const refill = {};
  for (const run of runs) refill[run] = (await api()[run]()) ?? null;
  ui.notifications.info(game.i18n.format(`${LANG_PREFIX}.ui.reimportDoneBook`, { n: doomed.length, book: label }));
  return { book: bookId, removed: doomed.length, shelves: [...shelves].sort(), refill };
}

/* -------------------------------------------- */
/*  (Re)import individual entries               */
/* -------------------------------------------- */

/**
 * Every importable entry, grouped by the run that rebuilds one. `refill`
 * names the api function; every importer named here takes `only`, the ids to
 * consider. Monsters name no refill — `importMany` already takes an explicit
 * id list. Weapons, armor and the price list are built from whole printed
 * tables rather than an entry apiece, so they stay with the shelf rebuild
 * instead. Rules tables carry no `type` and an `idsRefill` instead of a
 * `refill`: they live in the ruledata store, merge rather than replace, and
 * there is nothing to delete before re-reading one. See
 * docs/importer/DECISIONS.md, "Rules tables join the entry picker as
 * documents, not as tables".
 */
const ENTRY_SOURCES = [
  { key: "Monsters", type: "Actor", refill: null, entries: () => actorEntriesAcrossBooks().rows.map((r) => [r.id, r.entry]) },
  { key: "Abilities", type: "Item", refill: "cookbookImportAbilities", entries: () => [...abilityEntries()] },
  { key: "Classes", type: "Item", refill: "importClasses", entries: () => [...classEntries()] },
  {
    key: "Equipment",
    type: "Item",
    refill: "importAllEquipment",
    entries: () => cookbookEquipmentIds().map((id) => [id, cookbookEntry(id)?.entry ?? {}]),
  },
  { key: "Traps", type: "Item", refill: "importTraps", entries: () => [...trapEntries()] },
  { key: "Spells", type: "Item", refill: "importSpells", entries: () => [...spellEntries()] },
  { key: "Variations", type: "Item", refill: "importVariations", entries: () => [...variationEntries()] },
  { key: "Vehicles", type: "Actor", refill: "importVehicles", entries: () => [...vehicleEntries()] },
  // A creature an OSE book prints a block per step for is one row, under its
  // generator's id; `oseImportEntries` rebuilds its steps together.
  { key: "OseCreatures", type: "Actor", idsRefill: "oseImportEntries", entries: () => api().oseEntryRows?.() ?? [] },
  {
    key: "Tables",
    type: null,
    idsRefill: "cookbookImportTables",
    // A ruledata document's row names the document and cites the pages its
    // recipes read; the tables under it are not offered separately because the
    // store's unit is the document, which is what a merge writes. Present means
    // the import's own layer holds it: a sample a module registers under the
    // same id is not an import.
    entries: () =>
      Object.entries(TABLE_RECIPES).map(([docId, rec]) => [
        docId,
        { name: docId, cite: rec.source?.pages ?? "" },
      ]),
    present: (docId) => !!getLayer(docId, PRIORITY.WORLD),
  },
];

/** The cookbook id an imported document claims, or "" when it claims none. */
const claimedId = (doc) => String(doc.getFlag(MODULE_ID, "cookbook")?.id ?? "");

/**
 * Whether an entry can be read back on this seat: false only when the entry
 * names its book and that book is not open here. See
 * docs/importer/DECISIONS.md, "A closed book is refused, not rebuilt."
 */
const readableHere = (id) => {
  const book = bookOf(cookbookEntry(id)) ?? oseGroupBookOf(id);
  return !book || !!ctx?.sessionDocs?.has(book);
};

/**
 * Does this document belong to that entry?
 *
 * An entry is not always one document. A vehicle entry covers a whole table and
 * claims per ROW (`<entry id>.<row key>`), so the match is the id itself or
 * anything filed beneath it.
 */
const claimsEntry = (doc, id) => {
  const claim = claimedId(doc);
  return claim === id || claim.startsWith(`${id}.`);
};

/**
 * Which entry ids this world already holds something for.
 *
 * Every dot-ancestor of a claim is recorded beside the claim itself, so a
 * vehicle entry whose rows are present reads as present without a scan per
 * entry. An id that is a strict prefix of an unrelated claim would read present
 * wrongly; the row's own checkbox still imports it, and a mark is not a gate.
 */
function claimedEntryIds(docs) {
  const have = new Set();
  for (const doc of docs) {
    const claim = claimedId(doc);
    if (!claim) continue;
    const parts = claim.split(".");
    for (let n = parts.length; n > 0; n--) have.add(parts.slice(0, n).join("."));
  }
  return have;
}

/**
 * Filter / select-all / count wiring shared by nothing else — the picker below
 * owns it. Rows carry their own searchable text and present-mark in datasets;
 * this only reads them.
 */
function wireEntryPicker(root, listEl) {
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
      // honest account of what pressing the button will do.
      if (!ok) r.querySelector('input[name="sel"]').checked = false;
    }
    tally();
  };
  const check = (rows) => {
    for (const r of rows) r.querySelector('input[name="sel"]').checked = true;
    tally();
  };
  for (const sel of ['[name="filter"]', '[name="hideHave"]']) root.querySelector(sel).addEventListener("input", refresh);
  listEl.addEventListener("change", tally);
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
}

/**
 * GM debug tool: list every importable entry with a checkbox and rebuild the
 * ones ticked — the finest of the rebuild controls, next to "import
 * everything" and "rebuild one shelf". A document a class template made is
 * never touched. The id is shown beside every row since it is what a recipe,
 * a register and a console call all name. See docs/importer/DECISIONS.md,
 * "The entry picker runs each importer over the ticked entries only".
 */
export async function cookbookReimportEntries() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (deletes and creates documents).`);
  const esc = foundry.utils.escapeHTML ?? ((x) => x);
  const docs = { Actor: await importedDocs("Actor"), Item: await importedDocs("Item") };
  const have = claimedEntryIds([...docs.Actor, ...docs.Item]);
  const onlyTip = game.i18n.localize(`${LANG_PREFIX}.ui.reimportRebuildOnlyTip`);

  let total = 0;
  const blocks = ENTRY_SOURCES.map((src) => {
    const entries = src.entries().sort((a, b) => String(a[1]?.name ?? a[0]).localeCompare(String(b[1]?.name ?? b[0])));
    if (!entries.length) return "";
    total += entries.length;
    const group = game.i18n.localize(`${LANG_PREFIX}.ui.reimportKind${src.key}`);
    // A source that is not documents answers for its own presence — the claim
    // index is built from document flags and knows nothing about the ruledata
    // store.
    const held = (id) => (src.present ? src.present(id) : have.has(id));
    // A row no run writes in place is marked: Repair leaves it as it is.
    const rebuildOnly = (id) =>
      src.key === "Monsters" ? !repairableMonster(id) : src.key !== "Tables" && !REPAIR_RUNS[src.refill];
    const rows = entries
      .map(([id, e]) => {
        const name = e?.name ?? id;
        const searchable = `${name} ${id} ${group}`.toLowerCase();
        return `<label class="acks-extras-importer-browse-row" data-name="${esc(searchable)}" data-have="${held(id) ? 1 : 0}">
          <input type="checkbox" name="sel" value="${esc(`${src.key}|${id}`)}">
          <span>${esc(name)}</span>
          <span class="acks-extras-importer-marks">${
            held(id)
              ? `<i class="fa-solid fa-check" data-tooltip="${esc(game.i18n.localize(`${LANG_PREFIX}.ui.cookbookPresent`))}"></i>`
              : ""
          }${rebuildOnly(id) ? `<i class="fa-solid fa-hammer" role="img" aria-label="${esc(onlyTip)}" data-tooltip="${esc(onlyTip)}"></i>` : ""}</span>
          <span class="acks-extras-importer-cite">${esc(e?.cite ? `${id} · ${e.cite}` : id)}</span>
        </label>`;
      })
      .join("");
    return `<div class="acks-extras-importer-book-head">${esc(group)} (${entries.length})</div>${rows}`;
  }).join("");

  if (!total) return ui.notifications.warn(`${MODULE_ID} | nothing importable is compiled into this build.`);

  const content = `
    <p class="notes">${game.i18n.format(`${LANG_PREFIX}.ui.reimportEntriesHint`, { n: total })}</p>
    ${modeSelect()}
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
    <div class="acks-extras-importer-browse-list acks-extras-importer-mon-list">${blocks}</div>`;

  return foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportEntriesTitle`), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    position: { width: 600, height: 720 },
    content,
    render: (event, dialog) => {
      const root = dialog.element ?? dialog;
      wireEntryPicker(root, root.querySelector(".acks-extras-importer-mon-list"));
    },
    ok: {
      label: game.i18n.localize(`${LANG_PREFIX}.ui.reimportGo`),
      callback: async (event, button) => {
        const picked = [...button.form.querySelectorAll('input[name="sel"]:checked')].map((el) => {
          const [key, ...rest] = String(el.value).split("|");
          return { key, id: rest.join("|") };
        });
        if (!picked.length) return ui.notifications.warn(`${MODULE_ID} | nothing selected.`);
        return runEntryReimport(picked, { mode: String(button.form.elements.mode?.value ?? "drop") });
      },
    },
  });
}

/**
 * Delete what the picked entries claim, then run each owning importer once,
 * narrowed to the picked ids (`only`). An entry whose book is not open on
 * this seat is refused before anything is deleted. See
 * docs/importer/DECISIONS.md, "The entry picker runs each importer over the
 * ticked entries only". `mode: "repair"` writes over them in place instead
 * (`repairEntries`).
 */
async function runEntryReimport(all, { mode = "drop" } = {}) {
  // Rules tables carry no book to check and delete nothing.
  const closed = all.filter(({ key, id }) => key !== "Tables" && !readableHere(id));
  const picked = all.filter((p) => !closed.includes(p));
  if (closed.length) ui.notifications.warn(game.i18n.format(`${LANG_PREFIX}.ui.reimportEntriesClosed`, { n: closed.length }));
  if (!picked.length) return null;
  if (mode === "repair") return repairEntries(picked, closed.length);
  // Re-read: the dialog's list was drawn when it opened, and another window may
  // have imported or deleted since.
  const docs = { Actor: await importedDocs("Actor"), Item: await importedDocs("Item") };
  const byKey = new Map();
  for (const { key, id } of picked) {
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(id);
  }

  const doomed = { Actor: [], Item: [] };
  for (const [key, ids] of byKey) {
    const src = ENTRY_SOURCES.find((s) => s.key === key);
    if (!src?.type) continue; // a source that is not documents has nothing to delete
    for (const doc of docs[src.type]) {
      if (doc.flags?.[MODULE_ID]?.templatePart) continue;
      if (ids.some((id) => claimsEntry(doc, id))) doomed[src.type].push(doc);
    }
  }
  const removing = doomed.Actor.length + doomed.Item.length;

  const ok = await foundry.applications.api.DialogV2.confirm({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.ui.reimportEntriesTitle`) },
    classes: ["acks-ui", "acks-extras-importer-dialog"],
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.ui.reimportEntriesConfirm`, { n: picked.length, removed: removing })}</p>`,
  });
  if (!ok) return null;

  for (const type of ["Actor", "Item"]) if (doomed[type].length) await deleteImported(type, doomed[type]);
  forgetImportedIndex(); // what it remembers is what was just deleted

  const refill = {};
  // Monsters first and by id: they are the only source with a per-id import,
  // and the abilities a monster carries are resolved from the shelves the runs
  // below rebuild, so a run that rebuilds both wants the shelves rebuilt after.
  const monsters = byKey.get("Monsters") ?? [];
  if (monsters.length) refill.Monsters = await importMany(monsters, game.i18n.localize(`${LANG_PREFIX}.ui.cookbookWorking`));
  const runs = new Map();
  for (const [key, ids] of byKey) {
    const run = ENTRY_SOURCES.find((s) => s.key === key)?.refill;
    if (!run) continue;
    if (!runs.has(run)) runs.set(run, new Set());
    for (const id of ids) runs.get(run).add(id);
  }
  for (const [run, only] of runs) refill[run] = (await api()[run]({ only })) ?? null;

  // Sources whose run takes the picked ids: rules tables, where nothing was
  // deleted and re-reading the whole set would scan pages for every recipe
  // there is, and OSE creatures, whose book run is narrowed to the rows.
  for (const [key, ids] of byKey) {
    const src = ENTRY_SOURCES.find((s) => s.key === key);
    if (!src?.idsRefill) continue;
    refill[src.idsRefill] = (await api()[src.idsRefill](ids)) ?? null;
  }

  ui.notifications.info(
    game.i18n.format(`${LANG_PREFIX}.ui.reimportEntriesDone`, { n: picked.length, removed: removing }),
  );
  return { picked: picked.length, refused: closed.length, removed: removing, refill };
}

/**
 * GM: delete EVERY document this module imported — the packs it created, the
 * world documents it or its materializers made from them, the folders they
 * were filed in, and the rules-table documents the ruledata provider
 * materialized on import. The counterpart to "import all".
 *
 * Three identities: this module's own cookbook flag; `flags[MODULE_ID]
 * .templatePart` on the class-template bundles, their skinned gear and the
 * per-class 3d6 tables (world documents by design); and the ruledata
 * provider's own count, which it removes itself. A map stood up from a
 * recipe is a world Scene carrying the first, and so are the places and
 * organisations brought into the world for it to stand on.
 *
 * Hand-made documents carry none of the three and are never touched. Art
 * files stay on disk (Foundry exposes no delete API) and are reused by a
 * re-import.
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
    ["Scene", game.scenes.filter(mine)],
    // Folders LAST: deleting a folder while it still holds documents
    // re-parents them instead of taking them with it.
    ["Folder", game.folders.filter(mine)],
  ];
  // The packs themselves, found by LABEL rather than through `packFor` — a
  // world upgraded from a sidebar-importing release has packs this session has
  // never opened, and a clean slate has to reach those too.
  const ourPacks = game.packs.filter(
    (p) => p.metadata.packageType === "world" && String(p.metadata.label ?? "").startsWith(`${FOLDER_NAME} — `),
  );
  const packed = ourPacks.reduce((n, p) => n + p.index.size, 0);
  // The rules-table import also materialized documents (RollTables, their
  // folders, the JSON journal) through the ruledata provider, which stamps no
  // cookbook flag; the provider counts and removes only the sidebar ones,
  // since its shelf ones go with the packs above. The imported table DATA
  // (the world store the automation reads) stays: this is a tidy-up, not an
  // un-import.
  const ruledata = services.get("ruledata-import");
  const materialized = ruledata?.countMaterializedDocs?.({ sidebar: true }) ?? 0;
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

/** Every spell compendium loaded, once a session: what a stat block names is resolved against the loaded packs. */
let spellPacksWarm = null;
const warmSpellPacksOnce = () => (spellPacksWarm ??= warmSpellPacks().catch(() => null));

async function importOne(bookId, id, folderId) {
  await warmSpellPacksOnce();
  const found = cookbookEntry(id);
  // Adventure kinds route to their own binders; journals/tables have their own
  // importers and are never built here.
  const kind = found?.entry?.kind;
  if (kind === "kind.npc" || kind === "kind.monsterLegacy") return importAdventureActor(bookId, id, folderId);
  if (kind === "kind.monsterTemplate") return importTemplate(bookId, id, folderId);
  if (kind === "kind.monsterFamily") return importFamily(bookId, id, folderId);
  if (kind && kind !== "kind.monster") return null;
  const session = ctx.sessionDocs.get(bookId);
  // Skip the `art` op outright when the file is already on disk — see
  // docs/importer/DECISIONS.md, "The art op is skipped when the picture is
  // already on disk".
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

  // FILE IT NOW: the stat block has just told us the creature's TYPE, the axis
  // monsters are grouped by, and nothing afterwards decides a destination.
  const typed = primaryTypeOf(node);
  const folder = (await actorFolderFor(id, found, { type: typed }))?.id ?? folderId;

  // ONE write, not four: the embedded items, the cookbook id and the FMS extras
  // fold into the single create rather than costing a socket round-trip each.
  // Art follows separately — it needs the uploaded file path.
  const actor = await createDoc(Actor, {
    // A person's row ships a neutral label; the name is the page's own.
    name: printedNameOf(node, found.entry.name),
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
  // Foundry reports a schema-validation failure and returns undefined rather
  // than throwing, so an unimportable monster reads as one skipped rather
  // than a crash in the importer.
  if (!actor) {
    ui.notifications.warn(`${MODULE_ID} | ${found.entry.name}: the system rejected the extracted stats — skipped (see console).`);
    return null;
  }
  // Gated on the RECIPE asking for art, not on the op having run — see
  // docs/importer/DECISIONS.md, "The art op is skipped when the picture is
  // already on disk".
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
export function templateOption(ax, row, cells, { id, cite, sectionText, spellSource = "" }) {
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

  // A row's slot column is the slot block the generated creature casts from.
  // What it casts as is the prose's word, kept beside the level the row
  // prints, so the generator can draw the repertoire the block holds.
  const slots = slotsFromCells(cells.spells);
  if (slots) Object.assign(system, coreSlotsPatch(slots));
  const casterLevel = intFrom(cells.casterLevel);
  const flags =
    spellSource && (slots || casterLevel != null)
      ? { [MODULE_ID]: { extras: { spellcasting: { class: capitalize(spellSource), level: casterLevel ?? null } } } }
      : {};

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
    flags,
  };
}

/**
 * PROSE LEADER ROLES — the general pass, run for EVERY family: the ROLE
 * variants a member's own prose describes (champions, sub-chieftains,
 * chieftains, drudges/whelps, shamans, witch doctors) become a second axis.
 * The regexes are shipped LOCATORS; every number is read at import from THIS
 * seat's own extracted prose, per member. Prose that matches nothing adds
 * nothing — a family without leader sentences simply has no Role axis.
 */
const proseLeaderRoles = ({ options, memberText, axes, cells, out }) => {
    // Tolerant of the two printed shapes: the damage clause may follow any of
    // the three fields, and "and" may sit before hp or before the bonus.
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
    // printing (the per-entry defer rule, per variant) — the option keeps this
    // family's variant label but takes its stats, text and cookbook id from
    // the revising book, so merge/dedup sees the same creature.
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
    await warmSpellPacksOnce();
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
  // the revising id) and a shared family suffix across books.
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
 * A GENERATION sub-roll enumerated by an ability's own prose, parsed from
 * THIS seat's extracted text at import. A play-time roll is deliberately not
 * matched: the phrase must close with a colon right after the die / "twice" /
 * a short "for X" qualifier. Returns `{die, twice?, outcomes: [{min, max,
 * text}]}` or null; an enumeration stops at the first non-numbered segment.
 * Nested rolls inside an outcome stay text for the Judge.
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
 * kind.monsterTemplate -> an `acks-extras.template` GENERATOR actor. All
 * book-parsing happens HERE, once, at import: grid rows map through the same
 * scalar binder as full stat blocks, form routines through the same
 * attackModel, and the template actor stores only engine-ready patches —
 * one owner per mapping.
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

  // What the family casts as — a tradition or a class word — is said once in
  // the prose and holds for every row that prints a slot column.
  const spellSource = castSourceOf(paras.map((p) => p.text).join(" "));

  const axes = [];
  for (const ax of spec.axes ?? []) {
    const [firstGrid, ...restGrids] = ax.grids ?? [];
    const rows = gridRows(firstGrid);
    const restByKey = restGrids.map((g) => new Map(gridRows(g).map((r) => [r.key, r.cells])));
    const options = rows.map((row) => {
      const cells = { ...row.cells };
      for (const m of restByKey) Object.assign(cells, m.get(row.key) ?? {});
      return templateOption(ax, row, cells, { id, cite, sectionText, spellSource });
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
 * Re-read an already-imported monster from this seat's book — same extraction
 * and binding as `importOne`, but UPDATES rather than creates. Returns null
 * when the actor is not ours; otherwise `{ ok }` with a `reason` the caller
 * can explain — `book-closed`, `no-match`, or `no-stats` for an entry this
 * binding cannot read a stat block from. See docs/importer/DECISIONS.md, "A
 * refill retracts only what its entry claimed to fill".
 *
 * By default only the stats are written and embedded items are left alone.
 * `whole` repairs the monster in place (`REPAIR.monster`): its minted
 * attacks are replaced and its prose is rewritten field by field, except a
 * field a Judge wrote in; `keptProse` names those.
 */
export async function refillMonster(actor, { whole = false } = {}) {
  const id = actor?.getFlag(MODULE_ID, "cookbook")?.id;
  if (!id) return null;
  const found = cookbookEntry(id);
  if (!found) return null;
  const bookId = bookOf(found);
  const session = ctx.sessionDocs.get(bookId);
  if (!session) return { ok: false, reason: "book-closed", book: bookId, name: found.entry.name };
  const node = await executeEntry(session.doc, found.cb, data.registers, found.id);
  if (!node.ok) return { ok: false, reason: "no-match", book: bookId, name: found.entry.name };
  // Never retract fields the entry never claimed — an entry with no
  // `stats.*` fields (an OSE creature reads its numbers from `block`
  // instead) would otherwise retract every path at once. See
  // docs/importer/DECISIONS.md, "A refill retracts only what its entry
  // claimed to fill".
  if (!node.fields.stats || !Object.keys(node.fields.stats).length) {
    return { ok: false, reason: "no-stats", book: bookId, name: found.entry.name };
  }
  await warmSpellPacksOnce();
  const { system, items, flags, prototypeToken } = bindMonster(node);
  if (whole) {
    const { extras } = monsterProseChannels(node, id, found.entry.cite);
    const typed = primaryTypeOf(node);
    const plan = await refreshImported(
      actor,
      {
        type: actor.type,
        system,
        ...(prototypeToken ? { prototypeToken } : {}),
        items,
        flags: {
          [MODULE_ID]: {
            cookbook: { id, cite: found.entry.cite, ...(typed ? { type: typed } : {}) },
            // Written either way: a stale "no morale" would outlive the morale a
            // corrected read now finds.
            moraleNA: !!flags?.[MODULE_ID]?.moraleNA,
            extras,
          },
        },
      },
      REPAIR.monster,
    );
    if (plan.refused) return { ok: false, reason: plan.refused, book: bookId, name: found.entry.name };
    return { ok: true, book: bookId, name: found.entry.name, keptProse: plan.keptProse };
  }
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
    // The entry ships an ordinal label; the person is named from the page the
    // recipe just read, like every other document the book fills.
    name: printedNameOf(node, found.entry.name),
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

/** The kinds that bind to a journal page: a keyed room, and a setting-detail table. */
const JOURNAL_KINDS = new Set(["kind.location", "kind.settingTable"]);

/**
 * A page-bound entry. A keyed place of a settlement's quarter is a location
 * ACTOR (`cookbookImportPoiPlaces`) and is not a page as well: two documents
 * for one printed place would be the thing a Judge then keeps in step by hand.
 */
const journalBound = (e) => JOURNAL_KINDS.has(e.kind) && !isPoiEntry(e);

/**
 * Journals: one JournalEntry per meta.group, one page per keyed entry. A
 * location's page body is the room's own text + creature names (the
 * seat-extracted creature lookups, deferring to the ACKS II entry when the
 * register maps one); a setting table's is the printed rows laid out as a
 * table under the register's header words. Pages update in place on
 * re-import, so coverage grows without duplicating.
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
    openBooks.reduce((n, b) => n + Object.values(data.books.get(b).entries).filter(journalBound).length, 0),
  );
  try {
    for (const bookId of openBooks) {
      const cb = data.books.get(bookId);
      const session = ctx.sessionDocs.get(bookId);
      const locs = Object.entries(cb.entries).filter(([, e]) => journalBound(e));
      if (!locs.length) continue;
      // The BOOK is the folder now, so the journal itself is named by its group
      // alone ("A. Entrance Caves") rather than repeating the book on every row.
      const folder = await ensureFolderPath("JournalEntry", [bookLabel(bookId)], lineOf(bookId));
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
          // A setting table is its rows under the register's header words; the
          // executor paired each row's label and text by section, and the page
          // holds the pairs as a table rather than as prose.
          const content =
            e.kind === "kind.settingTable" ? entryTable(node, id, e.cite, e.columns ?? []) : entryText(node, id, e.cite) + creatureHtml;
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
 * Points of interest: the keyed places of a settlement's quarters, as
 * location ACTORS nested quarter → city, rather than as journal pages. Each
 * point is `poiLocationData`, named by the heading the Judge's page prints
 * under its key number (the cookbook ships only the number). Presence is
 * asked by cookbook id before the page is read. A world that imported these
 * as pages under an earlier release keeps its pages: nothing here deletes.
 * See docs/importer/DECISIONS.md, "A settlement's keyed places are actors,
 * nested quarter → city" and "A quarter's overview is the notes of the
 * quarter's place".
 */
export async function cookbookImportPoiPlaces() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  const jobs = [];
  for (const bookId of openBooks) {
    for (const [id, e] of Object.entries(data.books.get(bookId).entries)) {
      if (isPoiEntry(e)) jobs.push({ bookId, id, e, group: poiGroupOf(e.meta?.group) });
    }
  }
  if (!jobs.length) return ui.notifications.warn(`${MODULE_ID} | no points of interest in any open book — connect AX3 first.`);
  let made = 0;
  let described = 0;
  let already = 0;
  let refused = 0;
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressPoi`), jobs.length);
  try {
    for (const { bookId, id, e, group } of jobs) {
      bar.step(e.name);
      const overview = group.kind === "overview";
      if (!overview && (await importedActor(id))) {
        already++;
        continue;
      }
      const cb = data.books.get(bookId);
      const label = bookLabel(bookId);
      const line = lineOf(bookId);
      // Two levels, which is all a pack allows: the book, then its places.
      const folder = (await ensureFolderPath("Actor", [label, "Places"], line))?.id ?? null;
      const city = await claimActorImport(oseAdventureId(bookId), () =>
        createDoc(Actor, oseAdventureData({ book: bookId, bookLabel: label, folderId: folder })));
      const district = await claimActorImport(districtPlaceId(bookId, group.district), () =>
        createDoc(Actor, districtPlaceData({
          book: bookId, bookLabel: label, district: group.district, parentUuid: city?.uuid ?? "", folderId: folder,
        })));
      // Notes that hold anything are the world's — asked before the page is
      // read, which is what keeps a second run from reading it at all.
      if (overview && (!district || district.system?.notes)) {
        already++;
        continue;
      }
      // The anchor proves the heading still titles this place; a printing that
      // moved the text is refused rather than imported under the wrong name.
      const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, cb, data.registers, id).catch(() => null);
      if (!node?.ok) {
        refused++;
        continue;
      }
      if (overview) {
        await district.update({ "system.notes": entryText(node, id, e.cite) });
        described++;
        continue;
      }
      // The entry ships a label built from the key number; the place is named
      // by the heading the Judge's own page prints under that number.
      const place = await claimActorImport(id, () =>
        createDoc(Actor, poiLocationData({
          name: printedNameOf(node, e.name), entryId: id, notes: entryText(node, id, e.cite), book: bookId, bookLabel: label,
          district: group.district, parentUuid: district?.uuid ?? "", folderId: folder,
        })));
      if (place) made++;
    }
  } finally {
    bar.finish();
  }
  if (!made && !described && !already && refused) {
    return ui.notifications.warn(`${MODULE_ID} | points of interest: ${refused} page(s) did not match the cookbook (different printing?) — none written.`);
  }
  ui.notifications.info(
    `${MODULE_ID} | points of interest: ${made} place(s) created${described ? `, ${described} quarter(s) described` : ""}${already ? `, ${already} already held` : ""}${refused ? `, ${refused} skipped (page did not match the cookbook)` : ""}.`,
  );
  return { made, described, already, refused };
}

/**
 * Organisations, as FACTION actors (`faction-binding.mjs` says which entries
 * are one, and of which sort): named and seated from the entry's `organisation`
 * block, at its own keyed place or its quarter's. Presence is asked by
 * cookbook id before the page is read, so a re-run tops up only what is
 * absent and never rewrites a row that is there. Relations are written
 * last, once every organisation they could name exists. See
 * docs/importer/DECISIONS.md, "An organisation the book introduces by name
 * is an authored row" and "A body becomes a faction one way: a row that was
 * read".
 */
export async function cookbookImportFactions() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  const authored = [];
  for (const bookId of openBooks) {
    const entries = data.books.get(bookId).entries;
    for (const [id, e] of Object.entries(entries)) {
      if (isOrganisationRow(e)) authored.push({ bookId, id, e, plan: organisationPlan(bookId, e, entries) });
    }
  }
  if (!authored.length) return ui.notifications.warn(`${MODULE_ID} | no organisations in any open book — connect AX3 first.`);
  const counts = { made: 0, already: 0, rostered: 0, missing: 0, refused: 0, related: 0 };

  // The quarter's own place, made the way the POI step makes it, so whichever
  // step runs first the other finds the same document.
  const seatsOf = async (bookId, district) => {
    const label = bookLabel(bookId);
    const placeFolder = (await ensureFolderPath("Actor", [label, "Places"], lineOf(bookId)))?.id ?? null;
    const city = await claimActorImport(oseAdventureId(bookId), () =>
      createDoc(Actor, oseAdventureData({ book: bookId, bookLabel: label, folderId: placeFolder })));
    if (!district) return city;
    return claimActorImport(districtPlaceId(bookId, district), () =>
      createDoc(Actor, districtPlaceData({ book: bookId, bookLabel: label, district, parentUuid: city?.uuid ?? "", folderId: placeFolder })));
  };
  const rosterOnto = async (faction, members) => {
    const rows = (faction.system.members ?? []).map((m) => m.toObject?.() ?? m);
    const held = new Set(rows.map((m) => m.uuid));
    let added = 0;
    for (const { id, hidden } of members) {
      const found = await importedActor(id);
      // The lookup may answer with an index row; the roster row wants the
      // document, for its type and its own retainer record.
      const person = found?.system ? found : found?.uuid ? await fromUuid(found.uuid) : null;
      if (!person) {
        counts.missing++;
        continue;
      }
      if (held.has(person.uuid)) continue;
      rows.push(occupantRow(person, { hidden }));
      held.add(person.uuid);
      added++;
    }
    if (added) await faction.update({ "system.members": rows });
    counts.rostered += added;
  };

  const built = [];
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressFactions`), authored.length);
  try {
    for (const { bookId, id, e, plan } of authored) {
      bar.step(e.name);
      const label = bookLabel(bookId);
      const folder = (await ensureFolderPath("Actor", [label, "Factions"], lineOf(bookId)))?.id ?? null;
      const quarter = await seatsOf(bookId, plan.seatQuarter);
      const keyed = plan.seat ? await importedActor(plan.seat) : null;
      const leader = plan.leader ? await importedActor(plan.leader) : null;
      const holdings = [];
      for (const placeId of plan.holdings) {
        const place = await importedActor(placeId);
        if (place && !holdings.some((h) => h.uuid === place.uuid)) holdings.push({ uuid: place.uuid, name: place.name });
      }
      let faction = await importedActor(id);
      if (faction) {
        counts.already++;
        const patch = {};
        if (keyed && faction.system.seatUuid === (quarter?.uuid ?? "")) patch["system.seatUuid"] = keyed.uuid;
        if (leader && !faction.system.leaderUuid) patch["system.leaderUuid"] = leader.uuid;
        const held = (faction.system.holdings ?? []).map((h) => h.toObject?.() ?? h);
        const owed = holdings.filter((h) => !held.some((row) => row.uuid === h.uuid));
        if (owed.length) patch["system.holdings"] = [...held, ...owed.map((h) => ({ ...h, note: "", hidden: false }))];
        if (Object.keys(patch).length) await faction.update(patch);
      } else {
        // The hash proves the box still holds the name this row was cut for; a
        // printing that moved it is refused rather than named after other words.
        const node = await executeEntry(ctx.sessionDocs.get(bookId).doc, data.books.get(bookId), data.registers, id).catch(() => null);
        if (!node?.ok || node.fields?.anchor?.ok === false) {
          counts.refused++;
          continue;
        }
        const printed = printedNameOf(node, e.name);
        faction = await claimActorImport(id, () =>
          createDoc(Actor, organisationData({
            entryId: id, book: bookId, bookLabel: label, name: plan.namedAfterSeat ? withoutKeyNumber(printed) : printed, kind: plan.kind,
            gmNotes: entryText(node, id, e.cite), seatUuid: (keyed ?? quarter)?.uuid ?? "", leaderUuid: leader?.uuid ?? "",
            holdings, controls: plan.controls, folderId: folder,
          })));
        if (!faction) continue;
        counts.made++;
      }
      await rosterOnto(faction, plan.members);
      built.push({ faction, plan, cite: e.cite });
    }

    for (const { faction, plan, cite } of built) {
      if (!plan.relations.length) continue;
      const others = new Map();
      for (const r of plan.relations) {
        const other = others.has(r.to) ? null : await importedActor(r.to);
        if (other) others.set(r.to, { uuid: other.uuid, name: other.name });
      }
      const held = (faction.system.relations ?? []).map((r) => r.toObject?.() ?? r);
      const owed = owedRelations(held, plan.relations, others, cite);
      if (!owed.length) continue;
      await faction.update({ "system.relations": [...held, ...owed] });
      counts.related += owed.length;
    }
  } finally {
    bar.finish();
  }
  if (!counts.made && !counts.already && counts.refused) {
    return ui.notifications.warn(`${MODULE_ID} | organisations: ${counts.refused} page(s) did not match the cookbook (different printing?) — none written.`);
  }
  const parts = [
    `${counts.made} faction(s) created`,
    counts.already ? `${counts.already} already held` : "",
    counts.rostered ? `${counts.rostered} member(s) rostered` : "",
    counts.related ? `${counts.related} relation(s) written` : "",
    counts.missing ? `${counts.missing} member(s) not yet imported` : "",
    counts.refused ? `${counts.refused} skipped (page did not match the cookbook)` : "",
  ].filter(Boolean);
  ui.notifications.info(`${MODULE_ID} | organisations: ${parts.join(", ")}.`);
  return counts;
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

/** The imported roll table for a cookbook id — the world's own first, then the shelves — or null. */
async function importedTable(id) {
  const world = game.tables.find((t) => t.getFlag(MODULE_ID, "cookbook")?.id === id);
  if (world) return world;
  for (const collection of ourPacksOfType("RollTable")) {
    const index = await collection.getIndex({ fields: [`flags.${MODULE_ID}.cookbook.id`] }).catch(() => null);
    const row = [...(index ?? [])].find((r) => r.flags?.[MODULE_ID]?.cookbook?.id === id);
    if (row) return collection.getDocument(row._id);
  }
  return null;
}

/**
 * A folder path in the WORLD, whatever target the library writes to. A scene
 * and the actors standing on it are world documents by construction, so their
 * folders are too; each is marked the way `ensureFolderPath` marks its own, and
 * an adopted one left unmarked, so removal takes exactly what was made here.
 * `made` collects the uuid of each folder this call had to create.
 */
async function ensureWorldFolderPath(type, names, made = []) {
  let parent = null;
  for (const name of names.map((n) => String(n ?? "").trim()).filter(Boolean)) {
    const parentId = parent?.id ?? null;
    let folder = game.folders.find((fo) => fo.type === type && fo.name === name && (fo.folder?.id ?? null) === parentId);
    if (!folder) {
      folder = await Folder.create({ name, type, folder: parentId, sorting: "a", flags: { [MODULE_ID]: { cookbook: { id: `folder.${type}.${name}` } } } });
      if (folder) made.push(folder.uuid);
    }
    parent = folder;
  }
  return parent;
}

/**
 * What bringing a book's places and organisations into the world would take,
 * worked out WITHOUT writing anything: which of the cookbook ids the world
 * already holds, which the library holds and would be made again, and which
 * neither has. Asked before the picture is drawn, so a map that cannot be
 * built leaves no actor behind it. See docs/importer/DECISIONS.md, "A map
 * and what stands on it are world documents, owned by nobody".
 *
 * @returns {Promise<{actors: Map<string, Actor>, queued: Map<object, {id: string, _id: string}[]>,
 *   worldIds: Map<string, string>, missing: string[], known: Set<string>}>}
 */
async function planCrossing(bookId, cookbookIds) {
  const flagOf = (row) => row?.flags?.[MODULE_ID]?.cookbook ?? {};
  const shelf = new Map();
  for (const collection of ourPacksOfType("Actor")) {
    const index = await collection
      .getIndex({ fields: ["type", ...["id", "kind", "book"].map((k) => `flags.${MODULE_ID}.cookbook.${k}`)] })
      .catch(() => null);
    for (const row of index ?? []) {
      const flag = flagOf(row);
      if (flag.id && !shelf.has(flag.id)) shelf.set(flag.id, { collection, _id: row._id, faction: flag.kind === "kind.faction" && flag.book === bookId });
    }
  }
  const wanted = new Set(cookbookIds);
  for (const [id, row] of shelf) if (row.faction) wanted.add(id);

  const actors = new Map();
  for (const actor of game.actors) {
    const id = actor.getFlag(MODULE_ID, "cookbook")?.id;
    if (id && wanted.has(id) && !actors.has(id)) actors.set(id, actor);
  }
  const worldIds = new Map();
  const queued = new Map();
  const missing = [];
  for (const id of wanted) {
    const row = shelf.get(id);
    const held = actors.get(id);
    if (row) worldIds.set(row._id, held?.id ?? row._id);
    if (held) continue;
    if (!row) missing.push(id);
    else if (queued.has(row.collection)) queued.get(row.collection).push({ id, _id: row._id });
    else queued.set(row.collection, [{ id, _id: row._id }]);
  }
  const known = new Set([...wanted].filter((id) => actors.has(id) || shelf.has(id)));
  return { actors, queued, worldIds, missing: missing.filter((id) => cookbookIds.includes(id)), known };
}

/**
 * Carry out a crossing plan, and answer with the world's document for every
 * cookbook id the plan knew. What only the library holds is created again
 * from its source (`worldCopySource`), keeping its id so references between
 * the copies can be rewritten before any of them exists. See
 * docs/importer/DECISIONS.md, "A map and what stands on it are world
 * documents, owned by nobody".
 *
 * @param {{actors: string[], folders: string[]}} created collects the uuid of everything made
 * @returns {Promise<{actors: Map<string, Actor>, copied: number}>}
 */
async function bringAcross(bookId, plan, created) {
  const { actors, queued, worldIds } = plan;
  const sources = [];
  const label = bookLabel(bookId);
  const folders = new Map();
  const folderFor = async (name) => {
    if (!folders.has(name)) folders.set(name, (await ensureWorldFolderPath("Actor", [label, name], created.folders))?.id ?? null);
    return folders.get(name);
  };
  for (const [collection, rows] of queued) {
    const docs = await collection.getDocuments({ _id__in: rows.map((r) => r._id) });
    for (const doc of docs) {
      const folderId = await folderFor(doc.type === FACTION_TYPE ? "Factions" : "Places");
      // Owned by nobody — see docs/importer/DECISIONS.md, "A map and what
      // stands on it are world documents, owned by nobody".
      sources.push(game.actors.fromCompendium(
        worldCopySource(doc.toObject(), worldIds, { folderId, sourceUuid: doc.uuid }),
        { keepId: true, clearOwnership: false },
      ));
    }
  }
  let copied = 0;
  for (let i = 0; i < sources.length; i += WRITE_CHUNK) {
    const made = await Actor.createDocuments(sources.slice(i, i + WRITE_CHUNK), { keepId: true });
    for (const actor of made ?? []) {
      const id = actor?.getFlag(MODULE_ID, "cookbook")?.id;
      if (!id) continue;
      actors.set(id, actor);
      created.actors.push(actor.uuid);
      copied++;
    }
  }
  return { actors, copied };
}

/** How many times one map steps its bar: the anchor, the plan, the picture, the scene. */
const SCENE_STEPS = 4;

/**
 * Maps: a book's scene recipes, stood up as WORLD scenes. A recipe is
 * geometry over one page of the seat's own book (`scene-binding.mjs`): the
 * picture is cut from that page and turned upright, each quarter becomes a
 * District region over the quarter's place, each keyed place a token of its
 * own actor. Nothing is drawn until the page answers to the recipe's anchor.
 * A scene the world already holds under the recipe's id is left exactly as
 * it stands. See docs/importer/DECISIONS.md, "A printed map is a recipe of
 * geometry over its page" and "A map and what stands on it are world
 * documents, owned by nobody".
 */
export async function cookbookImportScenes() {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates scenes).`);
  const openBooks = [...data.books.keys()].filter((b) => ctx.sessionDocs.has(b));
  const jobs = [];
  for (const bookId of openBooks) {
    for (const [id, row] of Object.entries(data.books.get(bookId).scenes ?? {})) {
      if (isSceneRecipe(row)) jobs.push({ bookId, id, row });
    }
  }
  if (!jobs.length) {
    const carriers = [...data.books.keys()]
      .filter((b) => Object.keys(data.books.get(b).scenes ?? {}).length)
      .map((b) => BOOKS[b]?.label ?? b.toUpperCase());
    return ui.notifications.warn(`${MODULE_ID} | no map in any open book — connect ${carriers.join(" or ") || "a book that has one"} first.`);
  }
  // `created` names every world document the run made, by uuid: the counts
  // say what happened, and the uuids are what a caller can undo it by.
  const counts = {
    made: 0, already: 0, refused: 0, unready: 0, copied: 0, missing: 0, regions: 0, tokens: 0, controlled: 0,
    created: { scenes: [], actors: [], folders: [] },
  };
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressScenes`), jobs.length * SCENE_STEPS);
  try {
    for (const job of jobs) {
      let stepped = 0;
      const tick = () => {
        stepped++;
        bar.step(job.row.name);
      };
      await importScene(job, counts, tick).catch((err) => {
        counts.refused++;
        console.error(`${MODULE_ID} | map ${job.id} failed`, err);
      });
      // A map that stopped early still took its whole share of the bar.
      while (stepped < SCENE_STEPS) tick();
    }
  } finally {
    bar.finish();
  }
  const parts = [
    `${counts.made} map(s) created`,
    counts.already ? `${counts.already} already held` : "",
    counts.made ? `${counts.regions} quarter(s), ${counts.tokens} place(s) set down hidden` : "",
    counts.copied ? `${counts.copied} place(s) and organisation(s) brought into the world` : "",
    counts.controlled ? `${counts.controlled} organisation(s) given their quarters` : "",
    counts.missing ? `${counts.missing} place(s) not yet imported` : "",
    counts.unready ? `${counts.unready} waiting on the points of interest step` : "",
    counts.refused ? `${counts.refused} refused (the page did not match the cookbook, or would not render)` : "",
  ].filter(Boolean);
  const say = counts.made || counts.already ? "info" : "warn";
  ui.notifications[say](`${MODULE_ID} | maps: ${parts.join(", ")}.`);
  return counts;
}

/**
 * Hand a new map's quarters to the organisations that control them: every
 * faction of the book now in the world has its flagged quarter ids turned
 * into the regions this scene drew. A Region it held that no longer exists
 * is dropped in the same write; one on some other scene is kept.
 * @returns {Promise<number>} how many factions were written to
 */
async function claimControlledQuarters(bookId, scene, recipe, districtIds) {
  const regionOf = new Map();
  for (const [i, district] of (recipe.districts ?? []).entries()) {
    const region = scene.regions.find((r) => r.getFlag(MODULE_ID, "cookbook")?.place === district.place);
    if (region) regionOf.set(districtIds[i], region.uuid);
  }
  const exists = (uuid) => {
    try {
      return !!fromUuidSync(uuid);
    } catch {
      return false;
    }
  };
  let written = 0;
  for (const faction of game.actors.filter((a) => a.type === FACTION_TYPE && a.getFlag(MODULE_ID, "cookbook")?.book === bookId)) {
    const quarterIds = faction.getFlag(MODULE_ID, "cookbook")?.controls ?? [];
    if (!quarterIds.length) continue;
    const next = controlledRegions([...(faction.system.controls ?? [])], quarterIds, regionOf, exists);
    if (!next) continue;
    await faction.update({ "system.controls": next });
    written++;
  }
  return written;
}

/** One recipe, from anchor to thumbnail. Counts into `counts`; calls `tick` once per stage it reaches. */
async function importScene({ bookId, id, row }, counts, tick) {
  const recipe = row.scene;
  tick();
  if (game.scenes.find((s) => s.getFlag(MODULE_ID, "cookbook")?.id === id)) return void counts.already++;
  const cb = data.books.get(bookId);
  const doc = ctx.sessionDocs.get(bookId).doc;
  const placements = await pageArtPlacements(doc, recipe.page).catch(() => []);
  if (!placementMatches(placements, recipe.placement)) return void counts.refused++;

  // Nothing is written until the picture exists.
  tick();
  const quarterOf = (entryId) => poiGroupOf(cb.entries[entryId]?.meta?.group)?.district ?? "";
  const cityId = oseAdventureId(bookId);
  const districtIds = (recipe.districts ?? []).map((d) => districtPlaceId(bookId, quarterOf(d.place)));
  const placeIds = (recipe.places ?? []).map((p) => p.id);
  const plan = await planCrossing(bookId, [cityId, ...districtIds, ...placeIds]);
  if (districtIds.length && !districtIds.some((d) => plan.known.has(d))) return void counts.unready++;

  tick();
  const up = await ctx.uploadSceneMap(doc, id, recipe);
  if (!up) return void counts.refused++;

  tick();
  const world = await bringAcross(bookId, plan, counts.created);
  counts.copied += world.copied;
  counts.missing += plan.missing.length;
  // Read from the imported list at import, so neither figure ships. See
  // docs/importer/DECISIONS.md, "A printed map is a recipe of geometry over
  // its page".
  const list = recipe.incidents?.table ? await importedTable(recipe.incidents.table) : null;
  const incidents = list
    ? {
      tableUuid: list.uuid,
      afterDark: afterDarkShift(list.results.map((r) => r.range), list.formula),
      band: bandOfSection(recipe.incidents.band),
    }
    : null;
  const city = world.actors.get(cityId) ?? null;
  const frame = sceneFrame(recipe);
  const regions = [];
  for (const [i, district] of (recipe.districts ?? []).entries()) {
    const place = world.actors.get(districtIds[i]) ?? null;
    const special = district.special ? await importedTable(district.special) : null;
    regions.push(districtRegionData(district, frame, {
      name: place?.name ?? game.i18n.format(`${LANG_PREFIX}.ui.sceneQuarter`, { n: i + 1 }),
      districtType: DISTRICT_TYPE,
      specialTableUuid: special?.uuid ?? "",
      locationUuid: place?.uuid ?? "",
    }));
  }
  const tokens = [];
  for (const spot of recipe.places ?? []) {
    const actor = world.actors.get(spot.id);
    if (!actor) continue;
    tokens.push((await actor.getTokenDocument({ ...placeTokenAt(spot.at, frame), hidden: true })).toObject());
  }
  const folder = await ensureWorldFolderPath("Scene", [bookLabel(bookId)], counts.created.folders);
  // ONE create for the whole map (`sceneData` says why); the places' mirrors
  // are the only thing that has to wait for the documents they name.
  const scene = await Scene.create(sceneData({
    id, book: bookId, name: city?.name ?? row.name, recipe, src: up.path, incidents, folderId: folder?.id ?? null,
    locationUuid: city?.uuid ?? "",
    level: { id: Scene.metadata.defaultLevelId, name: game.i18n.localize(foundry.documents.Level.metadata.label) },
    regions, tokens,
  }));
  if (!scene) return void counts.refused++;
  counts.made++;
  counts.created.scenes.push(scene.uuid);
  counts.regions += scene.regions.size;
  counts.tokens += scene.tokens.size;
  await mirrorCreatedLinks(scene);
  counts.controlled += await claimControlledQuarters(bookId, scene, recipe, districtIds);

  // A directory card with no picture reads as a scene that failed. Core draws
  // one at creation only when a canvas is up, so it is asked for here and
  // allowed to fail: the picture is already uploaded either way.
  if (!scene.thumb) {
    const thumb = await scene.createThumbnail().catch(() => null);
    if (thumb?.thumb) await scene.update({ thumb: thumb.thumb });
  }
}

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
 * Which picture this ability gets: `iconNiche` from the optional game-icons.net
 * pack when it is installed, else `icon` from core. Referencing those paths
 * carries no licensing weight here — the art ships in that module under its
 * own terms, and nothing is copied. An item's img is set at creation and
 * never rewritten afterwards; Update Abilities leaves presentation alone, so
 * installing the pack later repaints only what is imported after it.
 */
export function abilityIcon(entry) {
  if (entry?.iconNiche && game.modules?.get?.(NICHE_ICON_MODULE)?.active) return entry.iconNiche;
  // Falls back to the generic book, so an entry nobody has picked an icon for
  // looks exactly as it did before rather than breaking.
  return entry?.icon || DEFAULT_IMG.ABILITY;
}

/**
 * `meta.category` lands in a CONSTRAINED choice field on the ability model.
 * This clamp stands behind the register lint for whatever it never saw, and
 * falls back to the model's own default so the item stays valid. See
 * docs/importer/DECISIONS.md, "A kind says what it binds to, and the lint
 * holds its categories to the vocabulary".
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
    // Scan-classified mechanics still bind, but present as unverified until the
    // register entry gains its `audited` sign-off. Written EXPLICITLY either
    // way, never omitted: update() merges flags, so an omitted `false` would
    // leave a stale `true` once an entry is signed off.
    unaudited: !entry.audited,
    // Set when this reference arrived under an older/foreign name: the reader's
    // source calls it `conversionFrom`, ACKS II calls it `entry.name`.
    ...(opts.conversionStatus ? { conversionStatus: opts.conversionStatus } : {}),
    ...(opts.conversionFrom ? { conversionFrom: opts.conversionFrom } : {}),
    // Structured effects are CLASSIFIED from the seat's own prose (type, target
    // and value all materialize; the cookbook pre-declares none of them). An
    // alias reads the TARGET's prose through its pre-baked pointer. A
    // chef-authored spec with no `from` locator is pure structure (a
    // prerequisite, a companion slot) and applies without the book; anything
    // pointing at a number still waits for it.
    effects: [...aliasEffects, ...(node?.fields?.effects ?? materializeEffects(entry.fields?.effects?.specs, []))],
    // `rolls` is assembled below and assigned onto this same object, once the
    // throws are classified.
    // Materialized from the seat's OWN prose via the executor's vocabulary
    // scan — nothing about which is shipped.
    ...(node?.fields?.defenses ? { defenses: node.fields.defenses } : {}),
  };
  // EVERY throw the extract classified becomes a roll, not just the first. The
  // recipe's own `rolls` wins when present; otherwise the classified `throw`
  // effects are lifted in order. Ladders are carried WHOLE, resolved by
  // acks-abilities at render time rather than flattened here.
  // These go to the acks-abilities flag and NOT to `system.roll` /
  // `system.rollTarget`: the core item can hold exactly one roll, so writing
  // there too would mean two stores for the same thing.
  // acks-abilities owns ability rolls and folds core's fields in on read for
  // items it has not written.
  // Throws from a class's published TABLE lead the list: the books
  // cross-reference the table first and roll whatever follows second.
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
 * a prerequisite dropped) has to say so with an explicit forced deletion (`unset()`) or the
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
  "def.spell": "Spells",
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
 * The folder a definition id's item files under, created on demand. Every
 * item importer asks this and none builds its own path. The shelf comes from
 * the id's first two segments alone, so callers whose ids have no register
 * entry (languages, read from the seat's own book) still land on their shelf.
 * See docs/importer/DECISIONS.md, "Organize is deleted, because destination
 * has one author".
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
 * PARSE every recipe against the connected books and report which ones fail,
 * writing nothing. Each entry is executed independently: one failure never
 * stops the pass. `ok: false` is the recipe's own name-anchor check failing;
 * `misses` names the fields that threw underneath. The pass shares ONE page
 * cache per book across every entry. See docs/importer/DECISIONS.md, "The
 * audit: a recipe answers for itself, without importing".
 *
 * @param {object} [options]
 * @param {string[]} [options.ids] audit only these entry ids
 * @param {string[]} [options.books] audit only entries from these book ids
 * @param {string[]} [options.kinds] audit only these entry kinds
 * @param {boolean} [options.art] decode page artwork too (default false) —
 *   costs seconds per entry where the rest of a recipe costs milliseconds.
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
 * Does the document the library holds already say everything this import
 * would? DIRECTIONAL: only the keys the INCOMING data sets are checked,
 * against what the existing document holds for them — a live document's
 * `system` carries every schema field, defaults included, so comparing both
 * whole never matches. See docs/importer/DECISIONS.md, "Same name, two
 * books: merge unless they differ beyond their source".
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
 * The name a document was PRINTED under, before any book tag was added. Kept
 * on the flag and used to judge collisions, so a rewritten (tagged) name
 * cannot escape being reconsidered. See docs/importer/DECISIONS.md, "Same
 * name, two books: merge unless they differ beyond their source".
 */
const printedName = (doc) => doc.getFlag(MODULE_ID, "cookbook")?.printed ?? doc.name;

/** Cross-book overlaps settled by name since the last report. */
const overlaps = { merged: 0, tagged: 0 };

/** Log what a run settled across books by name, once, and start the count again. */
function reportOverlaps() {
  const { merged, tagged } = overlaps;
  overlaps.merged = 0;
  overlaps.tagged = 0;
  if (merged || tagged) {
    console.info(`${MODULE_ID} | across books: ${merged} item(s) merged into the copy another book printed, ${tagged} tagged with their book.`);
  }
}

/**
 * Reconcile a document about to be imported against one the library already
 * holds under the same printed name. See docs/importer/DECISIONS.md, "Same
 * name, two books: merge unless they differ beyond their source". Merging
 * records the loser's id on the kept document rather than skipping silently,
 * so a merged-away id still resolves on a later run.
 *
 * @returns {Promise<{skip: true, doc: object} | {skip: false, name?: string}>}
 *   `skip` when the library already answers for this entry; otherwise the name
 *   to create it under, which is the printed one unless a tag was needed.
 */
async function reconcileByName(data, id, bookId) {
  if (!data?.name) return { skip: false };
  const keys = nameKeys(data.name);
  if (!keys.size) return { skip: false };

  // Reads an INDEX rather than the library — see docs/importer/DECISIONS.md,
  // "Same name, two books: merge unless they differ beyond their source".
  const index = await libraryNameIndex();
  const candidates = new Set();
  for (const k of keys) for (const doc of index.get(k) ?? []) candidates.add(doc);

  for (const other of candidates) {
    const otherId = other.getFlag(MODULE_ID, "cookbook")?.id;
    if (!otherId || otherId === id) continue;

    const otherBook = other.getFlag(MODULE_ID, "cookbook")?.book ?? bookOf(cookbookEntry(otherId));
    // Never across LINES.
    // See docs/importer/DECISIONS.md, "Reconciling is a claim about one game's library".
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
      overlaps.merged++;
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
      overlaps.tagged++;
      return { skip: false, name: `${data.name} (${tag(bookId)})`, printed: data.name };
    }
    return { skip: false }; // same book, same name: distinct entries the book itself separates
  }
  return { skip: false };
}

/**
 * One page cache per BOOK, living exactly as long as one bulk run.
 * `executeEntry` caches pages only for the duration of a single call, which
 * re-extracts the same page for every entry printed on it. Nothing here
 * outlives the run — a session-long cache would hold every page of every
 * opened book for as long as the world is up.
 * See docs/importer/DECISIONS.md, "Writes are batched, because a write costs what the shelf already holds".
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
 * Everything an ability import does EXCEPT the write. Split out so a bulk
 * run can build every document first and write them in chunks (`createDocs`),
 * which building and writing as one call cannot do. Returns creation data
 * with its folder already resolved, or null when the entry is unknown. See
 * docs/importer/DECISIONS.md, "Writes are batched, because a write costs
 * what the shelf already holds".
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
 * Definition kinds that do NOT bind to an `ability` item. A content-type
 * cookbook is not automatically an ABILITY cookbook: every ability path walks
 * the content cookbooks generically, so a new non-ability kind silently joins
 * the ability import unless it is excluded here. See
 * docs/importer/DECISIONS.md, "A namespace with no shelf is a failing test,
 * not a folder nobody notices".
 */
const NON_ABILITY_KINDS = new Set([
  "kind.equipment",
  "kind.class",
  "kind.classMeta",
  "kind.powerAppend",
  "kind.trap",
  "kind.variation",
  "kind.vehicle",
  "kind.spell",
  // A conversion constant is a NUMBER the converter is handed at run time
  // (readScgConstants), never a document.
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
 * Every printed SURFACE a class list or template cell can name, resolved
 * once — a definition's own name plus any authored `aliases`. Both the list
 * path and the cell path read this ONE index. Collisions are arbitrated by
 * `byCategory`, the same ranking the monster path uses; the world's holdings
 * are deliberately NOT consulted, since what a class's spread means is a
 * fact about the book, not about what has been imported yet. See
 * docs/importer/DECISIONS.md, "A second printed name for a shipped entry is
 * authored on the entry".
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

/**
 * Every way this catalogue prints ONE name: head-first with its qualifier
 * after a comma rotated back to the cell's English order, and slash
 * alternatives expanded to one row per word. The HEAD alone is deliberately
 * not a form, or a qualified row would answer for a bare name that is
 * another row's own. See docs/importer/DECISIONS.md, "The catalogue's
 * conventions are rules; what is left is authored".
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
 * Merges two pipelines: the cookbook's `kind.equipment` rows, then `extra`
 * (gear this import has already materialized, keyed by its own def id). A
 * cookbook entry wins on a shared id.
 * See docs/importer/DECISIONS.md, "A template's equipment menu is BOTH pipelines, and a short name is a whole word".
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
 * Skips any document carrying the `templatePart` flag — a copied skin, not the
 * base item.
 * See docs/importer/DECISIONS.md, "A template part is not an import".
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
 * the encumbrance note. Each descriptor resolves against `menu` (in any of
 * `nameForms`, or via an authored alias) and keeps its printed wording as the
 * skin and its printed price where the cell states one; an unresolved
 * descriptor still imports as a bare named item.
 *
 * Splitting the cell is this function's job; deciding what a piece IS is not —
 * a spell recorded in its own book and a creature an ability confers are
 * lifted off the item list afterwards, by `liftBookSpells` and
 * `liftCompanions`. See docs/importer/ROADMAP.md § Starting equipment.
 */
export function parseEquipment(cellText, menu, aliases = {}) {
  let text = String(cellText ?? "").replace(/\s+/g, " ").trim();
  let enc = "";
  const encMatch = /\(enc\.[^)]*\)\.?\s*$/i.exec(text);
  if (encMatch) {
    enc = encMatch[0].replace(/[().]/g, "").trim();
    text = text.slice(0, encMatch.index).trim().replace(/,\s*$/, "");
  }
  // Printed starting coin, in gold or silver. Removed from the text so the
  // item splitter sees only equipment.
  let gp = 0;
  let sp = 0;
  // An amount inside brackets prices the item it follows, not coin the
  // character carries; the bracket is the test, not any word after the
  // amount.
  // See docs/importer/DECISIONS.md, "Two things read off a cell that were never in it".
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
  // A contained name resolves a descriptor's printed wording ("smooth-worn
  // staff") to a catalogue item. Six characters is the bare-containment floor;
  // shorter names must match a whole word (trailing plural included). ACKS
  // Extras applies the same floors to world documents (`bestBaseMatch` in
  // classes/template-packages.mjs) and the two must agree.
  // See docs/importer/DECISIONS.md, "A template's equipment menu is BOTH pipelines, and a short name is a whole word".
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
  // An authored key may be shorter than an inferred one; the whole-word test
  // still applies.
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
  // The catalogue joins a SET's parts with a comma; a template's cell joins
  // the same parts with "with". Asked a second time without it, the two
  // spellings meet.
  // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
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
   * already a known item. `resolve`'s containment fallback is too generous
   * for this question, so this matches the whole descriptor and nothing
   * less: an exact menu name (with or without its bracketed qualifier) or an
   * exact alias key.
   */
  const resolveWhole = (descriptor) => {
    const f = fold(descriptor);
    const isWhole = (m) => [...formsOf(m), ...strippedOf(m)].some((form) => form.fold === f);
    return aliasForms.find((a) => a.fold === f)?.ref ?? menu.find(isWhole)?.ref ?? "";
  };
  const items = [];
  const push = (descriptor, note = "") => {
    // Nothing but connective tissue is not a thing — taking the coin out of a
    // clause can strand a bare remainder with no gear word in it.
    if (!descriptor || descriptor.split(/\s+/).every((w) => FUNCTION_WORD.has(w.toLowerCase().replace(/[^a-z]/g, "")))) return;
    const qty = parseInt(/^(\d+)\s/.exec(descriptor)?.[1] ?? "1", 10);
    // A bracketed amount prices the item in front of the reader and overrides
    // a base's price when there is one.
    // See docs/importer/DECISIONS.md, "What the page says a thing is worth is imported with it".
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
  // Semicolons separate too, alongside commas; one inside brackets is left
  // alone for the same reason a comma is.
  /* --- chunking, and the two clauses that span chunks --------------------- */
  //
  // The separators split a cell into chunks; two printed constructions are
  // written ACROSS them and are rejoined below before anything is read.
  // A full stop can be a separator too — only one followed by the start of
  // another descriptor, and never inside brackets, where the abbreviations
  // live.
  // See docs/importer/DECISIONS.md, "Two things read off a cell that were never in it".
  const chunks = text
    .split(/[,;](?![^(]*\))|\.(?![^(]*\))(?=\s+[a-z0-9])/i)
    // Trim before stripping a leading connective — every chunk after the
    // first begins with the separator's space, which a pre-trim strip would
    // miss.
    .map((raw) => raw.replace(/\s+/g, " ").trim().replace(/[.]$/, "").trim())
    .filter(Boolean);

  // A book's contents are an English list: commas until the last item, which
  // carries the "and". Rejoined from the "…book with" chunk up to and
  // including the chunk that opens with "and", only if the list actually
  // closes that way within a few chunks.
  // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
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
    // A stray comma inside one printed name: rejoining is allowed only when
    // the menu knows the two chunks together as one item, so an ordinary list
    // is never welded.
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
    // A counted container splits into itself and its contents; only a digit
    // after "with" splits, and never when the menu already resolves the
    // whole descriptor as a catalogue set.
    // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
    const container = /^(.+?)\s+with\s+(\d+)\s+(.+)$/i.exec(descriptor);
    if (container && !resolve(descriptor)) {
      push(container[1]);
      push(`${container[2]} ${container[3]}`, `carried in ${container[1].toLowerCase()}`);
      continue;
    }
    // A closing bracket can end a descriptor with no comma after it; the same
    // guard as the pair rule below, splitting only when what follows the
    // bracket is itself a known item.
    // See docs/importer/DECISIONS.md, "Two things read off a cell that were never in it".
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
    // "Under" pairs the same way — the templates dress a character in both at
    // once.
    // See docs/importer/DECISIONS.md, "The catalogue's conventions are rules; what is left is authored".
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
 * Reads both spellbook and prayer-book spellings, after `parseEquipment` has
 * rejoined the clause across its own list's commas. A choice clause ("one
 * spell of character's choice") rides as a nameless row whose `offer` is set,
 * with a stable `key`, rather than as a spell or a dropped sentence.
 * See docs/importer/DECISIONS.md, "A printed pick rides as an offer, not as a dropped sentence".
 *
 * A digit after "with" is a load, not a library: "quiver with 20 arrows".
 *
 * `known` is a predicate on a printed spell title (a `titleIndex`'s `has`):
 * with one, an "and" inside a title is the title's own word and does not
 * split it; without one every conjunction splits.
 */
export function liftBookSpells(items, { known = null } = {}) {
  const BOOK_CONTENTS = /^(.*?(?:spell\s*book|spellbook|prayer\s*book))\s+with\s+(.+)$/i;
  const CHOICE_PHRASE = /\b(choice|choosing|chooses|any)\b/i;
  const spells = [];
  for (const it of items ?? []) {
    const m = BOOK_CONTENTS.exec(it.name ?? "");
    if (!m || /\d/.test(m[2].split(/\s+/)[0] ?? "")) continue;
    it.name = m[1];
    it.note = it.note ? `${it.note}; holds ${m[2]}` : `holds ${m[2]}`;
    let offered = 0;
    for (const s of splitSpellNames(m[2], known)) {
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
 * Lift a totem-animal or familiar phrase off the equipment list and turn it
 * into the naming ability's SELECTION, rather than an item with no base.
 *
 * The selection lands on the row's existing entry for that ability when there
 * is one and it has no selection yet; otherwise an entry is added, carrying
 * the ref. Either way the specialized copy is stamped `grantedFrom` that ref,
 * so the class's own award of the same ability does not grant it a second
 * time.
 * See docs/importer/DECISIONS.md, "A totem animal is a creature, and the template is which one".
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
 * Every dash a page may print in an empty cell. A dash says the character
 * cannot act at that rung at all; every other non-numeric cell says the rung is
 * reached without a throw.
 */
const DASHES = new Set(["-", "\u2010", "\u2011", "\u2012", "\u2013", "\u2014", "\u2015", "\u2212"]);

/**
 * A grid keyed on a NAME rather than on a level, as one LADDER per row \u2014
 * each row's cells sorted by the header's level scale into `{atLevel, value}`
 * or `{atLevel, outcome, text}` rungs.
 *
 * The cell rule is structural and holds no printed letter: a numeric cell is
 * a target, a dash is a rung the character cannot act on, anything else
 * non-empty is a rung reached without a throw.
 * See docs/importer/DECISIONS.md, "A grid may be keyed on a name, and its cells need not be numbers".
 *
 * The one derivation of these keys, so an ability naming a ladder and the
 * class publishing it cannot disagree about what it is called.
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
 * The ladders a `fromLadders` spec expands over, read from the class entry
 * that publishes them. Resolved from the cookbook rather than a world
 * document, so it does not matter whether the class has been imported yet.
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
export function bindClass(
  entry,
  node,
  id,
  { gains = null, commonName = null, gear = [], spellTitles = null, printedRepertoire = null } = {},
) {
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

  // A grid keyed on a NAME rather than on a level (the crusader's rebuking
  // table) — see `gridLadders`.
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
      spellList: repertoireRefs(printedRepertoire, spellTitles, { key, label: t.label ?? "" }, (entry.casting ?? []).length === 1, entry.name),
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

  // Languages (RR §I.10, read off the spread). A demi-human spread's Tongues
  // runin is the granted list, whole, with count 0; without the runin the
  // class is human — one open homeland pick beside the common tongue.
  // Bookless (no body), both stay empty.
  // See docs/importer/DECISIONS.md, "2026-08-16 — who speaks which: read off the spread, defaulted off the chapter".
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
    const spells = liftBookSpells(eq.items, { known: spellTitles?.has ?? null });
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
      key: entry.meta?.key ?? foldKey(entry.name),
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
 * The class's training as one embedded, transferring Active Effect carrying
 * weapon, armour and style proficiency together; `training-logic.mjs` builds
 * the changes, so what the importer writes is what the class sheet edits.
 */
function trainingEffect(entry, training) {
  return {
    name: game.i18n?.format
      ? game.i18n.format(`${LANG_PREFIX}.ui.classTraining`, { class: entry.name })
      : `${entry.name} Training`,
    img: DEFAULT_IMG.TRAINING,
    changes: trainingChanges(training),
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
 * Execute the per-class Spell Repertoire pages once per run (null without a
 * book). A band the page did not yield is warned and the rest still bind:
 * one class's list is not the price of another's.
 */
async function executeRepertoires() {
  const id = "def.classmeta.spellRepertoires";
  const found = cookbookEntry(id);
  if (!found) return null;
  const session = ctx.sessionDocs.get(bookOf(found));
  if (!session) return null;
  const node = await executeEntry(session.doc, found.cb, data.registers, id);
  if (!node?.fields || !Object.keys(node.fields).length) return null;
  if (!node.ok) console.warn(`${MODULE_ID} | ${id}: ${node.misses?.length ?? 0} repertoire band(s) did not read; the rest bind.`);
  return node;
}

/** The register's spell titles as a resolver, so a class binds its printed names to entry ids. */
const spellTitleIndex = () => titleIndex([...spellEntries()].map(([sid, e]) => [sid, e.name]));

/**
 * One class's printed repertoire off the executed repertoire pages:
 * `[{tradition, level, names}]`, one row per list the pages print for it.
 * A grid `<class>.<tradition>L<levels>` holds the printed numbers as row
 * labels and a name column `L<level>` per level the table prints abreast;
 * the executor nests the class's grids under its key. Empty for a class the
 * pages do not print, or with no pages read.
 */
export function classRepertoireFor(node, className) {
  const cls = spellNameKey(className);
  if (!cls) return [];
  const out = [];
  const read = (key, grid) => {
    const m = /^([a-z]+)L(\d+)$/i.exec(key);
    if (!m) return;
    const byLevel = new Map();
    for (const row of grid?.rows ?? []) {
      for (const [ck, v] of Object.entries(row.cells ?? {})) {
        const lm = /^L(\d)$/i.exec(ck);
        const name = String(v ?? "").trim();
        if (!lm || !name) continue;
        const level = parseInt(lm[1], 10);
        (byLevel.get(level) ?? byLevel.set(level, []).get(level)).push(name);
      }
    }
    for (const [level, names] of byLevel) out.push({ tradition: m[1].toLowerCase(), level, names });
  };
  for (const [field, value] of Object.entries(node?.fields ?? {})) {
    const dot = field.indexOf(".");
    if (dot < 0) {
      if (spellNameKey(field) !== cls) continue;
      for (const [key, grid] of Object.entries(value ?? {})) read(key, grid);
    } else if (spellNameKey(field.slice(0, dot)) === cls) {
      read(field.slice(dot + 1), value);
    }
  }
  return out.sort((a, b) => a.level - b.level);
}

/**
 * The spell-list references one casting row takes from a class's printed
 * repertoire: the entry ids `titles` resolves each printed name to, for the
 * lists whose tradition the row is — every list when the class casts one
 * tradition (`only`). A name no title answers is warned and left out; a row
 * that resolves nothing keeps an empty list, and the picker offers the
 * tradition whole.
 */
function repertoireRefs(repertoire, titles, row, only, who) {
  if (!repertoire?.length || !titles) return [];
  const keys = new Set([spellNameKey(row.key), spellNameKey(row.label)].filter(Boolean));
  const refs = [];
  const seen = new Set();
  const missing = [];
  for (const list of repertoire) {
    if (!only && !keys.has(spellNameKey(list.tradition))) continue;
    for (const name of list.names) {
      const sid = titles.resolve(name);
      if (!sid) {
        missing.push(name);
        continue;
      }
      if (seen.has(sid)) continue;
      seen.add(sid);
      refs.push(sid);
    }
  }
  if (missing.length) console.warn(`${MODULE_ID} | ${who}: ${missing.length} repertoire name(s) match no spell entry: ${missing.join("; ")}`);
  return refs;
}

/**
 * What the common tongue is called in this setting, read once per run from
 * the chargen chapter's Languages section (`def.classmeta.startingTongues`).
 * Null without the book, or if the sentence is not where the anchor says.
 * See docs/importer/DECISIONS.md, "2026-08-16 — who speaks which: read off the spread, defaulted off the chapter".
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
 * page's reading order: each page-column field (`body61c0`, `body61c1`) is
 * tried on its own first, and the full joined page only afterwards.
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
 * What a class is TRAINED to fight with, read off its own spread's run-in
 * paragraph (weapons, then armour, then fighting styles, in that fixed
 * order; the run-in label is declared per class in the register).
 *
 * Weapons: "all weapons" is unrestricted, a size clause is a set of size
 * grants, "all missile weapons" is the missile grant, otherwise a named
 * list — a parenthesized enumeration after a group name overrides the group.
 * An "except" clause returns no weapon grant at all. Armour: the heaviest
 * rung named (a denial is the bottom rung). Styles: the positive clause
 * only, with the exclusion clause cut before reading; the two mandatory
 * styles are not emitted, since the consumer already holds them.
 * See docs/importer/DECISIONS.md, "A class's training paragraph is read by three grammars, one per domain".
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

  // None of these paragraphs prints a number, so a digit means a level
  // table's cells are folded through the sentence and no part of it can be
  // trusted.
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
 * The second grammar: a spread that states its training in sentences
 * ("can fight with…", "can wield…") rather than in the RR formula the
 * segmenter above keys on.
 *
 * Both books' readers converge on the one grant vocabulary the consumer
 * already publishes (`classifyGrantToken`): `all`, `missile:all`,
 * `melee:<size>`, a weapon-category, or a weapon name. Exclusions are
 * dropped, never inverted — a denied clause grants nothing rather than the
 * thing denied, the same rule the formula reader follows.
 * See docs/importer/DECISIONS.md, "A class's training paragraph is read by three grammars, one per domain".
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
 * One row of a class's combat-proficiencies TABLE, as a path option's
 * training. A spread whose training differs per option prints a grid rather
 * than a sentence, so each row becomes one option of a path group. The
 * armour column names every rung it permits; the answer is the heaviest, the
 * same rule the prose reader follows. Per-option data stays on the option
 * even where every row agrees.
 * See docs/importer/DECISIONS.md, "A class's variants are PATHS, and the grid that prints them is read by geometry".
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
 * The tongues a class's spread prints, parsed from its Racial Traits runin
 * (`<Race> Tongues:`), sometimes in two clauses ("can speak … and can also
 * speak …") — both are read. List items keep the book's own capitalization,
 * drop the article and the trailing "tongues"/"languages"; anything not
 * shaped like a proper name is discarded rather than granted.
 *
 * A spread with no Tongues runin (every human class) returns null, which
 * routes the class to the human default.
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
  // The capture is capped at 80 characters; a clause that cannot reach its
  // terminator inside the cap is interleaved with a neighbouring column's
  // text and is dropped whole.
  // See docs/importer/DECISIONS.md, "2026-08-16 — who speaks which: read off the spread, defaulted off the chapter".
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
 * beyond any it names — a Multilingual or Linguistics class power. These are
 * open picks, never names, so they land in `languages.count`.
 *
 * Takes the largest grant found rather than the sum.
 * See docs/importer/DECISIONS.md, "2026-08-16 — a class is its race's whether or not its page reads".
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
 * Lend a race's tongues to a class of that race whose own page did not
 * parse, taken from a sibling of the same race whose page did.
 *
 * Only a class that ended with no named tongues is filled, and only from a
 * sibling that has some; a class the parse already answered is left alone.
 * See docs/importer/DECISIONS.md, "2026-08-16 — a class is its race's whether or not its page reads".
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

/**
 * Bring the race documents' tongues in step with what the class spreads
 * read, so a custom class built on a race document owes its character the
 * same tongues the race's own imported classes get. Only a race whose list
 * is still EMPTY is written — a Judge's own edit is never replaced. Races
 * and classes can import in either order; this runs after a class import
 * and is worked into a race arriving later by the next class import.
 */
async function syncRaceTongues(classDocs) {
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

/** The label `bindClass` derives for a ladder key, so a hand edit is visible. */
const ladderLabelFor = (key) => key.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());

/**
 * Re-key a class ladder whose column has since been QUALIFIED. Document-driven
 * like `importTemplatePackages`: compares each imported class against the
 * column keys the cookbook declares NOW, and re-keys only where exactly one
 * declared key is that same name behind a qualifier. The label moves with the
 * key only where it still reads as the one import derived.
 * See docs/importer/DECISIONS.md, "A column key carries every qualification its printed header carries".
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

/**
 * GM: import every class the cookbook holds that this world does not.
 *
 * `only`, a Set of cookbook ids, narrows the pass to those entries — how the
 * entry picker rebuilds exactly what it deleted, where a whole pass would also
 * import every class the world never had. The same option narrows the other
 * five entry-driven importers.
 */
export async function importClasses({ only = null } = {}) {
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
  const repertoires = await executeRepertoires();
  const spellTitles = spellTitleIndex();
  for (const [id, entry] of classEntries()) {
    if (only && !only.has(id)) continue;
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
      const built = bindClass(entry, node, id, {
        gains: classGainsFor(gainsNode, entry.name),
        commonName,
        gear,
        spellTitles,
        printedRepertoire: classRepertoireFor(repertoires, entry.name),
      });
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
 * template row becomes a core `bundle` Item of repairable documents on the
 * class's own shelf, and the class gains a generated 3d6 RollTable linking
 * them. The classes feature owns the shape (`materializeTemplates`) — this
 * side only names the shelves and the folders on them, so a package lands
 * beside the library it was built from, filed `Class Templates / <Class>`.
 * Idempotent; a no-op for a document that carries no template rows.
 */
async function materializeClassTemplates(docs, { create = true } = {}) {
  const totals = { created: 0, relinked: 0, skippedEdited: 0, unresolved: 0 };
  let touched = 0;
  for (const doc of docs ?? []) {
    if (doc?.type !== CLASS_ITEM_TYPE || !(doc.system?.templates?.length > 0)) continue;
    const line = lineOfData(doc);
    const pack = await packFor("Item", line);
    const tablePack = await packFor("RollTable", line);
    // A relink-only pass creates no folders — it has nothing to file.
    const folder = create ? ((await ensureFolderPath("Item", ["Class Templates", doc.name], line))?.id ?? null) : null;
    const tableFolder = create ? ((await ensureFolderPath("RollTable", ["Class Templates"], line))?.id ?? null) : null;
    const report = await materializeTemplates(doc, { folder, tableFolder, pack, tablePack, create });
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
 * One printed row of the vehicle table as an `acks-extras.vehicle`. A
 * movement/cargo pair becomes speed TIERS (normal encumbrance, then heavy);
 * a cargo figure in parentheses fills `cargo.passengers` instead (the
 * howdahs, whose pace is the creature's and so get no speed tiers). The
 * draft team is not read from this table.
 * See docs/importer/DECISIONS.md, "The vehicle table's pairs are speed tiers, and a howdah's cargo is a passenger count".
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
      description: bookText([], entry.cite ?? "", { id, book: entry.book, page: entry.pages?.[0] }),
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
 * Its conventions differ from the land table's: three crew columns are three
 * ROLE complements (sailors and rowers motive, marines not); four combat
 * speeds and two voyage speeds land on the schema's named sea fields rather
 * than tiers; cargo is a single figure, never a pair. A dash is an absent
 * cell, not a zero. A parenthesised marines figure binds as a bench (the
 * schema's `required` on a non-motive role), not extra manpower. Cost is not
 * read.
 * See docs/importer/DECISIONS.md, "The vehicle table's pairs are speed tiers, and a howdah's cargo is a passenger count".
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
      description: bookText([], entry.cite ?? "", { id, book: entry.book, page: entry.pages?.[0] }),
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
 *
 * `repair`, a tally (`repairTally`), writes each row this world already holds
 * over its vehicle in place (`REPAIR.vehicle`) instead of passing over it, and
 * counts into the tally; an entry whose book is not open here counts refused.
 */
export async function importVehicles({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates actors).`);
  if (!CONFIG.Actor.dataModels?.[VEHICLE_ACTOR_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the vehicle actor type is unavailable.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of vehicleEntries()) {
    if (only && !only.has(id)) continue;
    const found = cookbookEntry(id);
    const bookId = found ? bookOf(found) : null;
    const session = bookId ? ctx.sessionDocs.get(bookId) : null;
    const node = session ? await executeEntry(session.doc, found.cb, data.registers, id) : null;
    // Nothing to read: the book is not connected, or its page no longer matches.
    if (!node?.ok) {
      if (repair) countRepair(repair, session ? "no-match" : "book-closed");
      continue;
    }
    for (const grid of Object.values(node.fields?.grids ?? {})) {
      for (const row of grid?.rows ?? []) {
        const rowId = `${id}.${rowClaimKey(row)}`;
        const have = await importedActor(rowId, { copies: false });
        if (have) {
          skipped++;
          if (repair) countRepair(repair, await refreshImported(have, bindVehicleRow(row, entry, id), REPAIR.vehicle));
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
  ui.notifications?.info(
    `${MODULE_ID} | vehicles: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}.`,
  );
  return made;
}

/* -------------------------------------------- */
/*  Variations (kind.variation → acks-extras.*) */
/* -------------------------------------------- */

/** Sixths of a stone, the unit the family weighs everything in. */
const SIXTHS_PER_STONE = 6;

/**
 * Build one `acks-extras.variation` from an entry and its materialized
 * numbers. The register declares what kind of difference this is, what it
 * may go on, and what it supersedes; every number comes from
 * `node.fields.variation`, and a locator that did not match drops its whole
 * spec rather than defaulting.
 *
 * `deltas.stoneLighter` is the one unit translation: the located stone count
 * is negated and scaled to the sixths the schema counts in.
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
 *
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place (`REPAIR.variation`) instead of passing over it.
 */
export async function importVariations({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[VARIATION_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the variation item type is unavailable.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of variationEntries()) {
    if (only && !only.has(id)) continue;
    const have = await importedItem(id);
    if (have) {
      skipped++;
      if (repair) countRepair(repair, await repairFromEntry(have, id, (node) => bindVariation(entry, node, id), REPAIR.variation));
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
  ui.notifications?.info(
    `${MODULE_ID} | variations: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}.`,
  );
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
 * Only two things are read out of the seat's prose: the tier split (the
 * book's own numbering) and the damage dice. Everything a Judge would have
 * to judge — the throw type, which save, the effect's reach — is left at its
 * default with the printed sentence sitting beside it on the sheet.
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
      description: bookText([description], cite, { id, book: entry.book, page: entry.pages?.[0] }),
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
 *
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place (`REPAIR.trap`) instead of passing over it.
 */
export async function importTraps({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  if (!CONFIG.Item.dataModels?.[TRAP_ITEM_TYPE]) {
    ui.notifications?.warn(`${MODULE_ID} | ACKS Extras is not active — the trap item type is unavailable.`);
    return [];
  }
  const made = [];
  let skipped = 0;
  for (const [id, entry] of trapEntries()) {
    if (only && !only.has(id)) continue;
    const have = await importedItem(id);
    if (have) {
      skipped++;
      if (repair) countRepair(repair, await repairFromEntry(have, id, (node) => bindTrap(entry, node, id), REPAIR.trap));
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
  ui.notifications?.info(
    `${MODULE_ID} | traps: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}.`,
  );
  return made;
}

/**
 * Build one core `spell` Item from a spell entry and its materialized text.
 * The stat block the seat read is parsed into the primitive (`spell-logic.mjs`
 * `spellFromStat`), core's own strings are written from it, and the prose
 * becomes the description. A heading that ends in the reversal marker makes
 * the spell reversible, and the reverse's name is read off the prose where it
 * states one. A row anchored by hash names the document from the heading the
 * seat read; with the book closed it keeps the row's numbered label.
 */
export function bindSpell(entry, node, id) {
  const cite = entry.cite ?? "";
  const heading = node?.fields?.name ?? {};
  const printed = (typeof heading.title === "string" && heading.title) || entry.name || "";
  const marker = /\*\s*$/.test(entry.anchor?.subheading ?? "") || /\*\s*$/.test(heading.found ?? "");
  const paras = (node?.fields?.description ?? []).map((p) => (typeof p === "string" ? p : (p?.text ?? ""))).filter(Boolean);
  const built = spellFromStat(parseStatBlock(typeof node?.fields?.stat === "string" ? node.fields.stat : ""));
  const extras = {
    ...built,
    reversible: marker,
    reversedName: marker ? reversedNameFrom(paras.join(" ")) : "",
    cite,
  };
  return {
    name: printed.replace(/\*\s*$/, "").trim(),
    type: SPELL_TYPE,
    ...(entry.icon ? { img: entry.icon } : {}),
    // The stamp Remove ALL Imports finds documents by; without it a world could
    // import these and never get them back out.
    flags: { [MODULE_ID]: { cookbook: { id, cite }, [FLAG_SPELL]: extras } },
    system: {
      ...coreFieldsFrom(extras),
      description: bookText(paras, cite, { id, book: entry.book, page: entry.pages?.[0] }),
    },
  };
}

/** Every kind.spell [id, entry] across the content cookbooks. */
export function* spellEntries() {
  for (const cb of data.content.values()) {
    for (const [defId, e] of Object.entries(cb.entries ?? {})) {
      if (e.kind === "kind.spell") yield [defId, e];
    }
  }
}

/**
 * Import the printed spells, one core spell Item per printed entry, its stat
 * block on the primitive and its prose as the description. GM only: a player
 * pressing the control would mint a second set.
 *
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place (`REPAIR.spell`) instead of passing over it.
 */
export async function importSpells({ only = null, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  const made = [];
  let skipped = 0;
  for (const [id, entry] of spellEntries()) {
    if (only && !only.has(id)) continue;
    const have = await importedItem(id);
    if (have) {
      skipped++;
      if (repair) countRepair(repair, await repairFromEntry(have, id, (node) => bindSpell(entry, node, id), REPAIR.spell));
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
      return createDoc(Item, { ...bindSpell(entry, node, id), folder });
    });
    if (doc) made.push(doc);
  }
  ui.notifications?.info(
    `${MODULE_ID} | spells: ${made.length} imported, ${skipped} already present${repair ? ", repaired in place" : ""}.`,
  );
  return made;
}

/**
 * Re-execute and REWRITE every imported class document's generated surface
 * (name, img, the whole system object, its minted effects) through
 * `refreshImported` under `REPAIR.class`. Class documents are wholly
 * generated in this phase — a hand-tuned document keeps its edits only until
 * Update, and the confirm says so. Two things stay: a description a Judge
 * wrote in, and an effect a Judge took over (the training editor unmints what
 * it writes), which also stops the build's twin of it being added.
 *
 * A class whose book is not open on this seat, or whose entry read nothing,
 * is left exactly as it is: this write takes the build's rows whole, and a
 * rebuild with nothing read is the entry's shape without its content.
 *
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.only] cookbook ids to consider; every class when null
 * @param {boolean} [opts.confirm] ask before writing
 * @param {object|null} [opts.repair] a `repairTally` to count into
 * @returns {Promise<number>} how many classes were rewritten
 */
export async function cookbookUpdateClasses({ only = null, confirm = true, repair = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (rewrites items).`);
  const byId = new Map(classEntries());
  const targets = (await importedDocs("Item")).filter((i) => {
    const cid = i.flags?.[MODULE_ID]?.cookbook?.id;
    return i.type === CLASS_ITEM_TYPE && cid && byId.has(cid) && (!only || only.has(cid));
  });
  if (!targets.length) {
    if (!repair) ui.notifications?.info(`${MODULE_ID} | no imported class documents to update.`);
    return 0;
  }
  const readable = targets.filter((i) => readableHere(i.flags[MODULE_ID].cookbook.id));
  const closed = targets.length - readable.length;
  if (repair) repair.refused += closed;
  if (!readable.length) {
    ui.notifications?.info(`${MODULE_ID} | ${closed} imported class document(s) left as they are — their book is not open on this seat.`);
    return 0;
  }
  const ok =
    !confirm ||
    (await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: "Update Classes" },
      content:
        `<p>Rewrite ${readable.length} imported class document(s) from the connected book? Hand edits on them are replaced, except a description you wrote and training you edited.</p>` +
        (closed ? `<p>${closed} more come from a book that is not open on this seat and are left as they are.</p>` : ""),
      modal: true,
    }));
  if (!ok) return 0;
  // The follow-up passes below take only what this loop rewrote: lending a
  // race's tongues gives back a slot each time it runs, so a class it passes
  // over must stay out of them.
  const written = [];
  let unread = closed;
  const gainsNode = await executeProfGains();
  const commonName = await executeCommonTongue();
  const gear = await materializedGearMenu();
  const repertoires = await executeRepertoires();
  const spellTitles = spellTitleIndex();
  for (const item of readable) {
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
    if (bookId && !node) {
      unread++;
      countRepair(repair, "no-match");
      continue;
    }
    const doc = bindClass(entry, node, id, {
      gains: classGainsFor(gainsNode, entry.name),
      commonName,
      gear,
      spellTitles,
      printedRepertoire: classRepertoireFor(repertoires, entry.name),
    });
    const plan = await refreshImported(item, doc, REPAIR.class);
    countRepair(repair, plan);
    if (!plan.refused) written.push(item);
  }
  await inheritRaceTongues(written);
  await syncRaceTongues(written);
  // The update above replaced each document's whole `system`, which wipes the
  // rows' cached bundle uuids — this re-derives them from the bundles' own
  // flags and re-strips the arrays it restored, so a package is never handed
  // over twice.
  await materializeClassTemplates(written);
  ui.notifications?.info(
    `${MODULE_ID} | classes updated: ${written.length}${unread ? `; ${unread} left untouched — their book is not open on this seat, or read nothing` : ""}.`,
  );
  return written.length;
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
 * The core item type an equipment entry becomes, from the register's own
 * group rather than a name scan. `animal` is deliberately NOT here: a mule
 * is a creature, not a thing, and imports as an actor. See importEquipment.
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
 * fields the binding reads (`aac`, `cost`, `weight6`). The recipe names the
 * field AND the unit the page states it in — encumbrance prints in stone or
 * in items, and `weight6` counts sixths of a stone — so this only converts
 * units, never values. A field this version does not know is skipped rather
 * than guessed at.
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
 * (the family's one weight unit) — its normal and maximum load, read out of
 * the same prose already imported as the creature's description. An animal
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
 * The land speed an animal's description states, in feet per turn — the
 * first of the printed pair, which is the exploration figure every other
 * speed in the family derives from.
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
 * Bind an `animal` equipment entry to an ACTOR instead of an item — a
 * creature fights, can be attacked, has morale and can be ridden, none of
 * which an inventory item has.
 *
 * Requires ACKS Extras, which supplies the `acks-extras.animal` sub-type.
 * Without it there is nowhere for a creature to go, so the entry stays an
 * item rather than failing the import; the caller decides.
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
 *
 * `repair`, a tally, writes the entry over a document this world already
 * holds for it, in place (`repairEquipment`), instead of returning it as is.
 */
export async function importEquipment(id, folderId, { repair = null } = {}) {
  const found = cookbookEntry(id);
  if (!found) return null;

  const asActor = isAnimalEntry(found.entry) && canImportAnimals();
  // Ask the compendium imports actually land in, never `game.items`/
  // `game.actors` directly. An animal is an ACTOR, so it is asked of the
  // actor side of the same target.
  const existing = asActor ? await importedActor(id, { copies: false }) : await importedItem(id);
  if (existing) {
    if (unrepaired(repair, existing)) countRepair(repair, await repairEquipment(existing, id, asActor));
    return existing;
  }

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

/**
 * Write one equipment entry over the document this world holds for it. A
 * document another book's printing was merged into answers for its OWN entry
 * (`cookbook.id`), so it is rebuilt from that one, never from the id it
 * absorbed. Resolves to `refreshImported`'s plan, or to why nothing was written.
 */
async function repairEquipment(doc, id, asActor) {
  const own = doc.getFlag(MODULE_ID, "cookbook")?.id ?? id;
  const found = cookbookEntry(own);
  if (!found) return "no-match";
  if (asActor) return repairFromEntry(doc, own, (node) => bindAnimal(found.entry, node, own), REPAIR.animal);
  return repairFromEntry(doc, own, (node) => buildEquipmentItem(found, own, node), REPAIR.equipment);
}

/** Build and create the ITEM half of an equipment import (the claimed body). */
async function importEquipmentItem(found, id, folderId, node) {
  const folder = folderId ?? (await ensureItemFolder(id))?.id ?? null;
  const doc = await buildEquipmentItem(found, id, node);
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

/**
 * The creation data for one equipment ITEM: the binding, then the page values
 * the price grids and the entry's own paragraphs supply. Everything an import
 * does except deciding where the document goes and writing it, so a repair
 * builds exactly what an import would.
 */
async function buildEquipmentItem(found, id, node) {
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
  return doc;
}

/** All equipment ids in the shipped cookbook (empty when none compiled). */
export const cookbookEquipmentIds = () =>
  [...data.content.values()]
    .flatMap((cb) => Object.entries(cb.entries))
    .filter(([, e]) => e.kind === "kind.equipment")
    .map(([id]) => id);

/**
 * Remove `ability` items mis-created from equipment entries. An item's type
 * cannot be changed in place, so they are deleted and re-created properly by
 * the equipment import. Only OUR generated documents are touched; a
 * hand-made item is never deleted.
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
 * Remove `item`-typed documents that should now be ANIMAL ACTORS, so the
 * equipment import can re-create them as actors. Exactly the
 * repairEquipmentAbilities pattern: only OUR generated documents are touched
 * (the `minted` flag + a `def.equip.` cookbook id whose entry is an animal).
 *
 * A no-op before `game.actors` exists — without the animal sub-type reachable
 * yet, removing the items would delete data with nothing to replace it.
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
 * Remove the JJ shield forms an earlier version imported as VARIATIONS, so
 * the equipment import can re-create them as the `armor` shield items they
 * now are. Only the LIBRARY copies go, matched on the id they were imported
 * under; a variation a Judge already applied to a shield is an embedded copy
 * on that document and is never touched.
 * See docs/importer/DECISIONS.md, "A shield form is a shield, not a difference applied to one".
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
 * Correct the SUBTYPE of priced items an earlier run filed as plain
 * inventory. Corrected in place rather than re-created: an item's subtype is
 * mutable, so there is nothing here of the delete `repairAnimalItems` needs,
 * and re-creating would mint a duplicate. Only documents carrying our
 * `minted` flag are touched, and only that one field, so a Judge's own
 * "Belt" is never rewritten. Skins already copied onto a character belong to
 * the template package, which re-derives them.
 * See docs/importer/DECISIONS.md, "A grid row is what the SECTION above it says, not what its name looks like".
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

/**
 * Bulk import: every equipment entry, shared folder, dedup via importEquipment.
 * `repair`, a tally, writes each entry this world already holds over its
 * document in place instead of passing over it (`importEquipment`).
 */
export async function importAllEquipment({ only = null, repair = null } = {}) {
  // Same reason as importClasses: the macro says "(GM)" but every seat can run
  // it, and a player who does adds a second shop list to the world.
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only (creates items).`);
  // The three repairs each delete what the loop below is trusted to rebuild, so
  // a pass narrowed by `only` makes none of them: it would rebuild only its
  // own entries and leave the rest deleted. A repair in place deletes nothing.
  const sweep = !only && !repair;
  const repaired = sweep ? await repairEquipmentAbilities() : 0;
  // A world imported by an earlier version holds animals as items; drop them so
  // the loop below recreates them as actors (no-op without ACKS Extras).
  const repairedAnimals = sweep ? await repairAnimalItems() : 0;
  // And the shield forms it holds as variations; the loop below imports them as
  // the shields they are.
  const repairedShields = sweep ? await repairShieldVariations() : 0;
  const ids = cookbookEquipmentIds().filter((id) => !only || only.has(id));
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
      const before = asActor ? await importedActor(id, { copies: false }) : await importedItem(id);

      const doc = await importEquipment(id, folder, { repair });
      if (doc && !before) {
        created++;
        if (asActor) animals++;
      }
      bar.step(entry?.name ?? id);
    }
  } finally {
    bar.finish();
  }
  // The weapon, armour and price TABLES are no entry's, so a pass narrowed to
  // entries never reaches them; their shelves rebuild on their own, and a
  // repair in place leaves them to that rebuild.
  if (only || repair) {
    reportOverlaps();
    return { total: ids.length, created, animals, repaired, repairedAnimals, repairedShields, weapons: null, armor: null, priced: null };
  }
  const weapons = await importWeapons();
  const armor = await importArmor();
  // Last: it asks which price rows the entries above already claim, so it has
  // to run after they have had their chance at them.
  const priced = await importPricedGear();
  reportOverlaps();
  return { total: ids.length, created, animals, repaired, repairedAnimals, repairedShields, weapons, armor, priced };
}

/* -------------------------------------------- */
/*  Weapon / armour TABLES → items (per-seat)   */
/* -------------------------------------------- */

/** camelCase cookbook id for a table-materialized weapon. */
const weaponId = (name) => `def.weapon.${slugLabel(name).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;

/**
 * Remove ammunition the grid's third type was read as a WEAPON, so the run
 * re-creates them as inventory. The `repairAnimalItems` pattern and guard:
 * only documents carrying our own `minted` flag are touched. A class
 * template's copy carries no importer stamp and is not reached from here.
 * See docs/importer/DECISIONS.md, "The weapons grid prints three types, and ammunition is not a weapon".
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

/**
 * Materialize the RR weapons TABLE into `weapon` items from the reader's own
 * book — the clean-break pipeline (see weapon-tables.mjs). Unlike the run-in
 * gear cookbook, a grid has no prose of its own, so a bookless seat gets
 * nothing here. Deduped by cookbook id; each item carries its full set of
 * attack/damage modes (weapon-tables `damageModes`), which the core
 * compendium could not express and split into separate items instead.
 * @returns {Promise<{table:number, created:number}>}
 */
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
  // A row the equipment root has no profile for imports fine and rolls fine,
  // but silently as size-medium and proficiency-category `other`. Caught
  // here, since this is the only place the whole grid is in view at once.
  const unidentified = [];
  for (const row of rows) {
    const id = weaponId(row.name);
    if (!row.ammunition && !weaponIdentity({ type: ITEM_TYPE.WEAPON, name: row.name, flags: { [MODULE_ID]: { cookbook: { id } } } }).key) {
      unidentified.push(row.name);
    }
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
  if (unidentified.length) {
    console.warn(`${MODULE_ID} | weapon grid: no RAW profile for ${unidentified.join(", ")}`);
    ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.weapons.unidentified`, { items: unidentified.join(", ") }));
  }
  return { table: rows.length, created, repaired, unidentified };
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
 * The core item subtype a printed price SECTION corresponds to, defaulting
 * to plain inventory. A described entry gets this from the register
 * (`bindEquipment`); a grid row has no entry, so the heading it was printed
 * under is the page's own answer. Which headings mean something is asked of
 * the SYSTEM's subtype vocabulary, by key and by localized label alike, so
 * no name off the page is written down here.
 * See docs/importer/DECISIONS.md, "A grid row is what the SECTION above it says, not what its name looks like".
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
 * Materialize the printed price rows that no cookbook entry of its own
 * claims. The gear cookbook is a list of things the book DESCRIBES; the
 * price grid is a list of things it SELLS, itemizing what a description
 * treats as one subject and pricing things no paragraph describes at all.
 *
 * A row an entry already resolves is left alone — that item exists and
 * carries the book's own description, which a grid row does not have.
 * Everything else becomes an item priced from the reader's own page.
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

  // And whatever the LIBRARY already holds, under either spelling — the loop
  // above only knows the equipment chapter's declared entries, not what the
  // weapon and armour tables mint from a grid at run time.
  // See docs/importer/DECISIONS.md, "One name has many printed forms, and the rule lives in lib".
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
 * register — the printed name and the definition's own name are not always
 * the same name. A name several definitions answer to resolves to NOTHING
 * rather than a guess. Built once and memoised on the register.
 * See docs/importer/DECISIONS.md, "The printed name and the defined name are two different names".
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
 * power. `ranked` reports a pick the category ranking settled; `ambiguous`
 * reports a real guess, a tie inside the best-ranked category.
 */
const CATEGORY_RANK = ["def.prof.", "def.skill.", "def.power.", "def.drawback."];
const categoryRank = (id) => {
  const i = CATEGORY_RANK.findIndex((p) => id.startsWith(p));
  return i === -1 ? CATEGORY_RANK.length : i;
};
const byCategory = (ids) => [...ids].sort((a, b) => categoryRank(a) - categoryRank(b))[0];

export function preferredId(ids, present) {
  if (ids.length === 1) return { id: ids[0], ambiguous: false, ranked: false };
  const here = ids.filter((id) => present.has(id));
  if (here.length === 1) return { id: here[0], ambiguous: false, ranked: false };
  const pool = here.length ? here : ids;
  const best = Math.min(...pool.map(categoryRank));
  const top = pool.filter((id) => categoryRank(id) === best);
  return { id: top[0], ambiguous: top.length > 1, ranked: top.length === 1 };
}

/**
 * Report how a printed name was resolved when resolving it was a choice, once
 * per name and pick in a session: a guess warns, a pick the category ranking
 * settled logs at debug.
 */
function reportGuess(text, guess) {
  if (!guess?.ambiguous && !guess?.ranked) return;
  const key = `${text}>${guess.id}`;
  if (warnedAmbiguous.has(key)) return;
  warnedAmbiguous.add(key);
  if (guess.ambiguous) console.warn(`${MODULE_ID} | "${text}" matches several definitions; adopted ${guess.id}.`);
  else console.debug(`${MODULE_ID} | "${text}" names definitions in several categories; ranked to ${guess.id}.`);
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
export async function cookbookImportAbilities({ only = null } = {}) {
  if (!game.user.isGM) return ui.notifications.warn(`${MODULE_ID} | GM only.`);
  const ids = cookbookAbilityIds().filter((id) => !only || only.has(id));
  if (!ids.length) return ui.notifications.warn(`${MODULE_ID} | no abilities in the shipped cookbook.`);
  const bar = progressBar(game.i18n.localize(`${LANG_PREFIX}.ui.progressAbilities`), ids.length);
  let made = 0;
  let reused = 0;
  try {
    await prepareItemShelves();
    const pageCache = runPageCache();
    // BUILD every document first, WRITE them a chunk at a time.
    // See docs/importer/DECISIONS.md, "Writes are batched, because a write costs what the shelf already holds".
    let batch = [];
    const flush = async () => {
      if (!batch.length) return;
      // `createDocs` teaches the dedup index itself: every document it makes
      // goes through `remembered`, which reads the id off the document's own
      // flag, never the batch's position.
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
 * GM: refresh every ability already in the world — loose items AND the
 * copies embedded on actors — against the current cookbook.
 *
 * Matched by cookbook id first, then by folded NAME, so abilities made by
 * hand or imported by an older version get adopted and repaired rather than
 * duplicated. Only the generated surface is rewritten; the item's name and
 * the system fields a GM may have tuned are left alone.
 *
 * An item this module FLAGGED is rewritten outright. An item matched only by
 * NAME is somebody else's, so its description is never replaced silently:
 * those are collected during the walk and settled by one dialog afterwards.
 * Both outcomes are idempotent — running twice leaves the same world as
 * running once.
 * See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create".
 *
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.only] cookbook ids to refresh; every ability when null
 * @param {object|null} [opts.repair] a `repairTally` to count into
 */
export async function cookbookUpdateAbilities({ only = null, repair = null } = {}) {
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
  // Entries passed over because their book is not open on this seat. Counted
  // apart from `preserved`: that one reports a Judge's own writing kept against
  // a rebuild that happened, and these had no rebuild worth writing.
  let unread = 0;
  // Name-adopted items whose description carries someone else's writing. The
  // write is held back until the GM has answered for them.
  const collisions = [];
  // Guessed resolutions by name, reported once each after the walk: a world
  // holds many copies of one ability, one per actor that carries it.
  const guesses = new Map();
  /** Rewrite the generated surface — the descriptor, the cookbook id, the
   * extras. The written extras carry a forced deletion for every optional
   * subkey the rebuild no longer emits (ABILITY_EXTRAS_OPTIONAL), in a copy —
   * `built` stays clean for the create path, which must not carry deletions
   * into fresh documents.
   *
   * `keepProse` holds back the description and nothing else; the mechanics
   * are always rewritten. */
  const writeGenerated = (doc, built, { keepProse = false } = {}) => {
    const extras = { ...built.flags[MODULE_ID].extras };
    for (const key of ABILITY_EXTRAS_OPTIONAL) {
      if (!(key in extras)) extras[key] = unset();
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
      if (only && !only.has(id)) continue;
      if (!id || !cookbookEntry(id)) {
        skipped++;
        continue;
      }
      if (guess?.ambiguous || guess?.ranked) {
        if (guess.ambiguous) guessed++;
        const seen = guesses.get(doc.name) ?? { guess, copies: 0 };
        seen.copies++;
        guesses.set(doc.name, seen);
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
      const node = nodeCache.get(id);
      // Nothing was read — this entry's book is not open on this seat, or its
      // extraction failed — so nothing can be rebuilt from it. Left exactly
      // as it is: connect the book and run it again.
      // See docs/importer/DECISIONS.md, "Importing again refreshes what it did not create".
      if (!node) {
        unread++;
        continue;
      }
      if (!ladderCache.has(id)) ladderCache.set(id, await laddersForEntry(found.entry));
      const built = bindAbility(found.entry, node, id, {
        // A copy that recorded arriving under an older name keeps saying so.
        ...(extras.conversionStatus ? { conversionStatus: extras.conversionStatus } : {}),
        ...(extras.conversionFrom ? { conversionFrom: extras.conversionFrom } : {}),
        ...(ladderCache.get(id) ? { ladders: ladderCache.get(id) } : {}),
      });
      built.flags[MODULE_ID].extras.effects = await resolveCompanions(built.flags[MODULE_ID].extras.effects);
      // Authorship of the ITEM and authorship of its DESCRIPTION are
      // different questions: a Judge who annotated a description this
      // module created still wrote those words.
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

  for (const [name, { guess, copies }] of guesses) {
    const line = `${MODULE_ID} | "${name}" (${copies} cop${copies === 1 ? "y" : "ies"})`;
    if (guess.ambiguous) console.warn(`${line} matches several definitions; resolved to ${guess.id}.`);
    else console.debug(`${line} names definitions in several categories; ranked to ${guess.id}.`);
  }
  if (repair) {
    repair.replaced += updated;
    repair.keptProse += preserved;
    repair.refused += unread;
  }
  const stale = (await danglingAbilities()).length;
  ui.notifications.info(
    `${MODULE_ID} | abilities updated: ${updated} (${onActors} on actors, ${adopted} matched by name` +
      `${guessed ? `, ${guessed} of them ambiguous — see console` : ""}), ${skipped} not in the cookbook` +
      `${renamed ? `; ${renamed} of your own renamed aside, ${created} reference(s) created beside them` : ""}` +
      `${overwritten ? `; ${overwritten} replaced on request` : ""}` +
      `${preserved ? `; ${preserved} kept the description you wrote` : ""}` +
      `${unread ? `; ${unread} left untouched — their book is not open on this seat` : ""}` +
      `${kept ? `; ${kept} left untouched` : ""}` +
      `${stale ? `; ${stale} left over from a withdrawn definition — run Prune` : ""}.`,
  );
  return { updated, adopted, onActors, guessed, skipped, renamed, created, overwritten, kept, preserved, unread, stale };
}

/**
 * Ability items this module generated whose definition no longer exists. A
 * withdrawn definition's items stay behind in every world that imported
 * them, pointing at nothing. They are unambiguously ours (minted, with a
 * cookbook id that no longer resolves), which is what makes them safe to
 * offer for removal.
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
          .map(([id, e]) => `<option value="${esc(id)}">${esc(e.name)}${e.cite ? ` — ${esc(e.cite)}` : ""}</option>`)
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
  // A content-type cookbook spans books and names one per ENTRY, so the file
  // carries no `book` at all — reading `cb.book.id` throws for every definition
  // id. `bookOf` is the one resolution that answers for both shapes.
  const bookId = bookOf(found);
  const session = bookId ? ctx.sessionDocs.get(bookId) : null;
  if (!session) {
    return ui.notifications.warn(`${MODULE_ID} | ${bookLabel(bookId) ?? entryId} is not open this session.`);
  }

  const node = await executeEntry(session.doc, found.cb, data.registers, entryId);
  // A FAMILY id resolves to a synthesized entry that lives in `cb.families`,
  // never in `cb.entries` — so there is nothing to execute and the node comes
  // back as a bare refusal with no `misses` to render.
  if (node.reason) return ui.notifications.warn(`${MODULE_ID} | ${entryId} is not executable (${node.reason}).`);
  const f = node.fields;
  const pre = (v) => `<pre class="acks-extras-importer-debug-pre">${esc(JSON.stringify(v, null, 1) ?? "null")}</pre>`;
  const statRows = Object.entries(f.stats ?? {})
    .map(([k, v]) => `<tr><td>${esc(k)}</td><td><code>${esc(JSON.stringify(v))}</code></td></tr>`)
    .join("");
  const paras = (f.description ?? [])
    .map((p, i) => `<p class="acks-extras-importer-debug-para"><b>[${i}]</b> ${esc(p.text)}</p>`)
    .join("");
  // Built from the parts that are actually present: an entry whose recipe
  // carries no citation would otherwise render its separators around nothing.
  const head = [
    bookLabel(bookId),
    node.cite || null,
    Array.isArray(found.entry.pages) ? `pages ${JSON.stringify(found.entry.pages)}` : null,
    `ok=${node.ok}`,
  ]
    .filter(Boolean)
    .map((part) => esc(String(part)))
    .join(" · ");
  const content = `<div class="acks-extras-importer-debug">
    <p><b>${esc(node.name ?? entryId)}</b> — ${head}</p>
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
 *
 * Builds only the actor kinds `importOne` dispatches (the `actorKindOf` set).
 * Any other kind returns null and goes uncounted, so a list this declines —
 * OSE creatures, which come in through `importOseBook` — returns the same `0`
 * as a run over a world that already holds every id.
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
    const printed = String(raw).trim();
    if (!printed) continue;
    const token = rebracket(printed, (name) => nameIndex.has(nameKey(name)));
    const m = token.match(/^(.*?)\s*\(([^)]+)\)\s*\d*$/);
    const base = (m ? m[1] : token.replace(/\s*\d+$/, "")).trim();
    const specialty = m?.[2] ?? null;
    // A short form the books print for a name this module already ships is
    // authored on the entry as an alias and reaches the index through it, so
    // nothing here needs to know which words a printing merged.
    const guess = idForName(nameIndex, base, present);
    reportGuess(base, guess);
    const id = guess?.id ?? null;
    let item = id ? loadedById.get(id) : null;
    if (!item && id) item = await importAbility(id).catch(() => null);
    if (!item) {
      missing.push(printed);
      continue;
    }
    const data = item.toObject();
    delete data._id;
    if (specialty) data.name = `${data.name} (${specialty})`;
    items.push(data);
  }
  return { items, missing };
}

/**
 * A statline token whose specialty lost its opening bracket in the book's own
 * text layer ("Name spec) 2"), read as the token it stands for ("Name (spec)
 * 2"). The name is the longest run of leading words `known` accepts; a token
 * with both brackets or none, or whose words name nothing, comes back as it
 * was. No extraction can supply the bracket — the printing does not hold it.
 * @param {string} token
 * @param {(name: string) => boolean} known  whether a name is a defined ability
 * @returns {string}
 */
export function rebracket(token, known) {
  if (!token.includes(")") || token.includes("(")) return token;
  const m = /^(.*?)\s*\)\s*(\d*)\s*$/.exec(token);
  if (!m) return token;
  const words = m[1].split(/\s+/).filter(Boolean);
  for (let k = words.length - 1; k >= 1; k--) {
    const name = words.slice(0, k).join(" ");
    if (known(name)) return `${name} (${words.slice(k).join(" ")})${m[2] ? ` ${m[2]}` : ""}`;
  }
  return token;
}
