/**
 * Cookbook runtime: the full monster sheet and template binding, monster prose channels, legacy monsters and NPCs.
 * The facade ../cookbook.mjs re-exports what the rest of the module imports by name.
 */
import { MODULE_ID, LANG_PREFIX, DEFAULT_IMG } from "../constants.mjs";
import { bookText, entryText, escapeText, nodeParagraphs } from "../prose.mjs";
import { REPAIR, REFILL_STAT_PATHS, repairWrite, asMinted } from "../refresh.mjs";
import { printedNameOf } from "../printed-name.mjs";
import { BOOKS } from "../books.mjs";
import { executeEntry, attackModel, convertName, frequencyOf, frequencyTextOf } from "../executor.mjs";
import { slugLabel } from "../table-extract.mjs";
import { savesForLevel, parseHitDice } from "../stats.mjs";
import { namesakeAbility } from "../stats-map.mjs";
import {
  damageTotal, derivedLeaderRoles, entryLeaderTemplate, importedThrowLadder, leaderTemplateId, monsterThrowForHd,
  overviewIsLore, procedureBuildsFor, proseLeaderRoles, ratingText, readRoleSentences, SOURCE_AXIS, splitWeaponModifier,
} from "../leader-roles.mjs";
import { deriveLeader, importedLeaderProcedure } from "../../monsters/leader-derive.mjs";
import { kitPresets, unionKitAxis } from "../kit-presets.mjs";
import { importedKits } from "../../monsters/kits.mjs";
import { sizeSquares } from "../../monsters/sizes.mjs";
import { hdFormula } from "../../lib/actor-read.mjs";
import { parseEncounterLine, appearingFormula } from "../../lib/encounter-line.mjs";
import { ALIGN_WORD } from "../character-binding.mjs";
import { DAMAGE_TYPES } from "../../lib/vocab.mjs";
import { scanMonsterSpells, castsAsClass, castSourceOf } from "../../magic/spell-names.mjs";
import {
  slotsFromCells, slotsOfClass, coreSlotsPatch, repertoireFor, spellPayload, spellsByName, classNamed,
} from "../../magic/repertoire.mjs";
import { warmSpellPacks } from "../../classes/grants.mjs";
import { TEMPLATE_TYPE } from "../../lib/constants.mjs";
import { data, ctx, cookbookEntry, bookOf, firstInt, diceOf, capitalize, intFrom } from "./state.mjs";
import { isRewriting, createDoc, importedIndex, importedActorsOfType, primaryTypeOf, sysObject } from "./target.mjs";
import { bindAbility, refForPrintedName, idForName, abilityNameIndex, loadedAbilityIndex, reportGuess } from "./abilities.mjs";

/* -------------------------------------------- */
/*  Full Monster Sheet extras                   */
/* -------------------------------------------- */

const SAVE_CLASS_BY_ABBR = { F: "fighter", C: "crusader", M: "mage", T: "thief", D: "dwarvenVaultguard", E: "elvenSpellsword" };
const AGE_KEYS = ["baby", "juvenile", "adolescent", "adult", "middleAged", "old", "ancient", "maximum"];
const TRAINED_ROLE_MAP = {
  "war mount": "warMount", "work beast": "workbeast", workbeast: "workbeast", guard: "guard",
  mount: "mount", hunter: "hunter", herald: "herald",
};

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
  const d = parseEncounterLine(s.dungeonEnc);
  const w = parseEncounterLine(s.wildernessEnc);
  const lairChance = firstInt(s.lairChance);
  if (d || w || lairChance != null) {
    extras.encounter = {
      ...(d ? { dungeon: d } : {}),
      ...(w ? { wilderness: w } : {}),
      ...(lairChance != null ? { lairChance } : {}),
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
 * A size key's prototype token footprint in grid squares, `{width, height}`,
 * read from the imported frontage table; null where the world holds none for
 * the key, which leaves Foundry's default token size alone.
 * `largeHugeGigantic` has no cell: that register key names a printed range, and
 * picking a single footprint for it would be inventing one.
 */
const tokenSize = (key) => {
  const squares = sizeSquares(key);
  return squares ? { width: squares.w, height: squares.h } : null;
};

/**
 * Map the SCALAR stat fields to system paths — the shared half of the binding,
 * used whole-block by bindMonster and per-grid-row by the template importer
 * (one mapping owner; a template row is just a partial stat block).
 */
export function bindStatsScalars(s) {
  const system = {};

  if (Number.isInteger(s.armorClass)) system.ac = { value: s.armorClass };

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
    system.details.appearing = {
      d: appearingFormula(parseEncounterLine(s.dungeonEnc)),
      w: appearingFormula(parseEncounterLine(s.wildernessEnc)),
    };
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
  const scan = scanMonsterSpells(prose, { known: world.has, freqOf: frequencyOf, phraseOf: frequencyTextOf });
  const carried = new Set();
  const carry = (doc, usage = "", usageText = "") => {
    if (!doc || carried.has(doc.uuid)) return;
    carried.add(doc.uuid);
    const payload = spellPayload(doc);
    if (usage) {
      const flags = ((payload.flags ??= {})[MODULE_ID] ??= {});
      flags.usage = usage;
      if (usageText) flags.usageText = usageText;
    }
    out.items.push(payload);
  };
  for (const { name, frequency, frequencyText } of scan.named) carry(world.resolve(name), frequency, frequencyText);
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

/**
 * What a stat block's proficiency names resolve against: every definition id
 * by name, and the ability items the library already holds by definition id.
 * Built once per block; `loadedAbilityIndex` reads a compendium library only
 * through the warm `importedIndex()` cache.
 */
export function proficiencyPools() {
  return { nameIndex: abilityNameIndex(), loadedById: loadedAbilityIndex() };
}

/**
 * A resolver for callers that hold names and no node: it warms the library
 * index, builds the pools once and answers `bindProficiency` for each name.
 * @returns {Promise<(name: string) => object>} name to the ability item for it
 */
export async function proficiencyResolver() {
  await importedIndex();
  const pools = proficiencyPools();
  return (name) => bindProficiency({ text: name }, pools);
}

/**
 * The ability item for one stat-block proficiency, resolved in three tiers:
 * the item the library already holds, else the definition the cookbook carries
 * built as `bindAbility` builds it, else the unclassified namesake. The first
 * two carry the definition's own extras, category included; the namesake
 * carries a blank category and every reader answers that as unknown.
 *
 * A name is matched as printed, then as a power's printed name the register
 * maps to a definition, so a block that lists a class power among its
 * proficiencies resolves too.
 * @param {{text: string, ref?: string, target?: number, convertedFrom?: string}} prof
 *   `ref` is an authored definition id and wins outright; `target` is the
 *   creature's own throw, split off the name; `convertedFrom` the older name
 * @param {{nameIndex: Map, loadedById: Map}} [pools] from `proficiencyPools`
 */
export function bindProficiency(prof, pools = proficiencyPools()) {
  const { nameIndex, loadedById } = pools;
  const present = new Set(loadedById.keys());
  // When the stat block named it by an older name, the EMBEDDED copy records
  // the rename (not the shared world item — that would stamp one source's
  // history onto everyone's). The sheet then explains why the name on the
  // page and the name in the book differ.
  const renamed = prof.convertedFrom ? { conversionStatus: "renamed", conversionFrom: prof.convertedFrom } : {};

  // An authored `ref` wins outright; without one, the name is resolved against
  // the ids this world already holds before category preference applies.
  const guess = prof.ref ? null : idForName(nameIndex, prof.text, present);
  const id = prof.ref ?? guess?.id ?? refForPrintedName(prof.text);
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
    return withTarget(src);
  }

  // 2. COULD BE LOADED — the cookbook carries the definition, so embed THAT
  //    ability (descriptor, classification, shared cookbook id) rather
  //    than a bare namesake.
  const shared = id ? cookbookEntry(id) : null;
  if (shared) return withTarget(bindAbility(shared.entry, null, id, renamed));

  // 3. Nothing to point at — a named ability of unknown category, never a failure.
  return withTarget(namesakeAbility(prof.text));
}

/** Map one executed node to acks actor data + embedded items. */
export function bindMonster(node) {
  const f = node.fields;
  const s = f.stats ?? {};
  const { system, moraleNA } = bindStatsScalars(s);

  const atk = f.attacks;
  if (atk) {
    if (atk.throw != null) system.attack = { throw: atk.throw };
    if (atk.text) system.attacks = atk.text;
  }

  // Each attack MODE is an OR-alternative (weapon OR claws+bite). Build a
  // weapon item per segment; only mode 0 is equipped by default, later modes
  // are tagged so the GM can swap. Duplicate names within a mode get a #suffix.
  // A "by weapon ±N" segment's modifier is the creature's, not the item's: it
  // moves to `system.damage.mod`, where it rides every weapon the creature
  // swings, and the item keeps "By weapon". The first such modifier is the
  // creature's; a segment printing another one keeps it in its own text.
  const items = [];
  let weaponMod = null;
  for (const [mi, mode] of (atk?.modes ?? []).entries()) {
    const seen = {};
    for (const seg of mode.segments) {
      const base = seg.name ?? "Attack";
      seen[base] = (seen[base] ?? 0) + 1;
      const lift = splitWeaponModifier(seg.damage);
      if (lift && weaponMod == null) weaponMod = lift.mod;
      const formula = lift && lift.mod === weaponMod ? lift.formula : seg.damage;
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
          description: "",
          damage: weaponDamage(formula, seg.damageType?.key, seg.quality === "extraordinary"),
          bonus: { attack: 0, damage: 0 }, melee: true, missile: false, equipped: mi === 0,
          pattern: "transparent", counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
        },
      });
    }
  }
  // Melee and missile alike: the page gives the modifier no delivery.
  if (weaponMod) system.damage = { mod: { melee: weaponMod, missile: weaponMod } };
  // The pools are built once per monster and only when there is a token to
  // spend them on (most monsters print none).
  const profs = (f.stats?.proficiencies ?? []).filter((p) => p.text && !/^none/i.test(p.text));
  const pools = profs.length ? proficiencyPools() : null;
  for (const prof of profs) items.push(bindProficiency(prof, pools));
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
  const token = tokenSize(s.size?.key);

  return {
    system,
    items,
    ...(token ? { prototypeToken: token } : {}),
    flags: moraleNA ? { [MODULE_ID]: { moraleNA: true } } : {},
  };
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
export function monsterProseChannels(node, id, cite) {
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

/** Every spell compendium loaded, once a session: what a stat block names is resolved against the loaded packs. */
let spellPacksWarm = null;
/** Resolves once the spell packs are loaded; the first call starts the load and every call shares it. */
export const warmSpellPacksOnce = () => (spellPacksWarm ??= warmSpellPacks().catch(() => null));

/* -------------------------------------------- */
/*  Template binding (kind.monsterTemplate)     */
/*  grids -> acks-extras.template generator actor  */

/* -------------------------------------------- */

/** A label's parenthesised range suffix is dropped (MM p. 106), and smallcap
 *  case is healed to title case — the short piece generated names use. */
const nameLabelOf = (label) =>
  String(label ?? "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\b[a-z]/g, (c) => c.toUpperCase());

/** The system's key for a weapon whose damage type is the weapon's own; the extract spells it `varies`. */
const CORE_VARIES_BY_WEAPON = "variesByWeapon";

/**
 * Does the running system's weapon schema accept this damage-type key? Read
 * from the field's own choices, so a key the system dropped is never written
 * into a Set that would refuse the whole item; with no schema to ask (offline),
 * the module's own vocabulary answers.
 */
function systemKnowsDamageType(key) {
  let choices = null;
  try {
    choices = CONFIG?.Item?.dataModels?.weapon?.schema?.getField?.("damage.base.types")?.element?.choices ?? null;
    if (typeof choices === "function") choices = choices();
  } catch {
    choices = null;
  }
  if (!choices) return key === CORE_VARIES_BY_WEAPON || key in DAMAGE_TYPES;
  return Array.isArray(choices) ? choices.includes(key) : key in choices;
}

/**
 * A weapon's `system.damage` in the system's shape: the printed die as the
 * base formula, the extract's damage-type key as the base type where the
 * system knows the key, and the extraordinary mark where the page coloured it.
 * The stamped `damageType` flag still carries the key for the module's own
 * reading whether or not the system took it.
 */
export function weaponDamage(formula, typeKey = null, extraordinary = false) {
  const key = typeKey === "varies" ? CORE_VARIES_BY_WEAPON : typeKey;
  const base = { formula: formula ?? "" };
  if (key && systemKnowsDamageType(key)) base.types = [key];
  if (extraordinary) base.extraordinary = true;
  return { base };
}

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
    description: "", damage: weaponDamage(damage, damageType), bonus: { attack: 0, damage: 0 }, melee: true, missile: false, equipped: attackMode === 0,
    pattern: "transparent", counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
  },
});

/**
 * Weapon items from a FORM's attack routine + one damage cell, via the shared
 * attackModel (no parallel parser). The form tables separate attack names with
 * "/" where stat lines use "," — normalize inside the parenthetical only.
 * `types` is the form's glyph-mapped damage-type list, in segment order.
 * A "by weapon ±N" segment's modifier is the creature's, as `bindMonster`
 * takes it: the first such modifier is returned as `mod` and the item keeps
 * "By weapon"; a segment printing another one keeps it in its own text.
 * `{items, mod}`, `mod` null where no segment prints one.
 */
function weaponsFromRoutine(routine, damageText, types) {
  if (!routine || !damageText) return { items: [], mod: null };
  const normalized = String(routine).replace(/\(([^)]*)\)/g, (_, inner) => `(${inner.replace(/\s*\/\s*/g, ", ")})`);
  const { modes } = attackModel(normalized, String(damageText));
  const items = [];
  let mod = null;
  let gi = 0;
  for (const [mi, mode] of modes.entries()) {
    const seen = {};
    for (const [j, seg] of (mode.dmgSegs ?? []).entries()) {
      const ne = mode.names?.[j] ?? mode.names?.[mode.names.length - 1] ?? null;
      const base = capitalize(ne?.name ?? "Attack");
      seen[base] = (seen[base] ?? 0) + 1;
      const lift = splitWeaponModifier(seg);
      if (lift && mod == null) mod = lift.mod;
      const formula = lift && lift.mod === mod ? lift.formula : diceOf(seg) || seg;
      items.push(
        weaponPayload(seen[base] > 1 ? `${base} ${seen[base]}` : base, formula, {
          naturalWeapon: ne?.nw ?? null,
          damageType: types?.[gi]?.key ?? null,
          attackMode: mi,
        })
      );
      gi++;
    }
  }
  return { items, mod };
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
export function templateOption(ax, row, cells, { id, cite, sectionText, spellSource = "", ladder = null }) {
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

  // Attack throw: printed on the row (thrall "weapon 10+") outranks the row of
  // the Judge's imported ladder its rating stands on (a hit-point bonus rounds
  // the dice up a row); with neither, the generated actor keeps defaults and
  // its sheet says the ladder is not imported.
  const printedThrow = /(-?\d+)\s*\+/.exec(String(cells.attacks ?? ""))?.[1];
  const ladderThrow = printedThrow == null ? monsterThrowForHd(hitDice, ladder?.rows) : null;
  let derived = null;
  if (printedThrow != null) system.attack = { throw: parseInt(printedThrow, 10) };
  else if (ladderThrow != null) {
    system.attack = { throw: ladderThrow };
    derived = { throw: { value: ladderThrow, base: null, baseHd: "", hd: ratingText(hitDice), rows: null, cite: ladder?.cite ?? "" } };
  } else if (hitDice != null) derived = { throw: { missing: true } };

  if (cells.attacks) system.attacks = [cells.attacks, cells.damage].filter(Boolean).join(" — ");

  // A single-axis damage die with no routine (the elemental tiers): one
  // generic natural attack; forms with routines get their weapons in `cells`.
  // A "by weapon ±N" cell's modifier is the creature's (`damage.mod`).
  const items = [];
  if (cells.damage && !cells.attackRoutine && !cells.attacks) {
    const lift = splitWeaponModifier(cells.damage);
    if (lift?.mod) system.damage = damageTotal(lift.mod);
    items.push(weaponPayload("Strike", lift?.formula ?? (diceOf(cells.damage) || String(cells.damage)), { naturalWeapon: "strike" }));
  }

  // A row's slot column is the slot block the generated creature casts from.
  // What it casts as is the prose's word, kept beside the level the row
  // prints, so the generator can draw the repertoire the block holds.
  const slots = slotsFromCells(cells.spells);
  if (slots) Object.assign(system, coreSlotsPatch(slots));
  const casterLevel = intFrom(cells.casterLevel);
  const extras = {
    ...(spellSource && (slots || casterLevel != null) ? { spellcasting: { class: capitalize(spellSource), level: casterLevel ?? null } } : {}),
    ...(derived ? { derived } : {}),
  };
  const flags = Object.keys(extras).length ? { [MODULE_ID]: { extras } } : {};

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
  const token = tokenSize(sizeWord) ?? {};

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
 * A member's whole XP cell, read again as text beside the first figure the
 * stat block keeps: a cell that prints one figure per role ("N (role)") is
 * what the Role axis's cells take their XP from (`proseLeaderRoles`). The
 * same instruction the entry ships, at the `raw` pattern; "" where the entry
 * has none or the page did not answer.
 */
async function wholeXpCell(doc, cb, id, entry) {
  const instr = entry?.fields?.["stats.xp"];
  if (!instr) return "";
  const once = { ...cb, entries: { [id]: { ...entry, fields: { "stats._raw.xp": { ...instr, pattern: "raw" } } } } };
  const node = await executeEntry(doc, once, data.registers, id).catch(() => null);
  return String(node?.fields?.stats?.["_raw.xp"] ?? "");
}

/**
 * A bound creature as a template's variant option: a complete preset, the
 * same system, minted items, extras and token size a direct import writes,
 * named exactly as a direct import (`name`), and stamped with the cookbook id
 * it was read from.
 */
function creatureOption({ key, label, name, art = "", system, items, flags, extras, prototypeToken, id, cite }) {
  return {
    key,
    label,
    nameLabel: name,
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
        cookbook: { id, cite },
        ...(extras ? { extras } : {}),
      },
    },
    token: prototypeToken ?? {},
  };
}

/** Is this entry a member of a family some loaded cookbook declares? Its leaders are that family template's. */
const familyMember = (id) =>
  [...data.books.values()].some((cb) => Object.values(cb.families ?? {}).some((fam) => (fam.members ?? []).some((m) => m.id === id)));

/**
 * Leaders for an entry outside a family: a template beside the creature, its
 * variant axis the creature alone and its Role axis the leaders, casters and
 * dependants its own prose prints, plus the leader procedure's where the
 * Judge's copy is imported and the creature is of a type it builds for
 * (`entryLeaderTemplate`). Nothing is minted for an entry whose page names no
 * leader, or one a family template already holds. A template held under the
 * same id is written over in place, so an import, a Rebuild and a repair of
 * the creature all leave one. Never throws: a failed build costs the
 * template, not the creature.
 *
 * @param {{id: string, found: object, node: object, bound: object, extras: object, folder: string|null, bindDoc: object, img?: string}} args
 *   `bound` is `bindMonster`'s output for the entry, `bindDoc` the open book it was read from
 */
export async function mintLeaderTemplate({ id, found, node, bound, extras, folder, bindDoc, img = "" }) {
  try {
    if (familyMember(id)) return null;
    const text = (node.fields.description ?? []).map((p) => p.text).join(" ");
    const types = node.fields?.stats?.type?.keys ?? (node.fields?.stats?.type?.key ? [node.fields.stats.type.key] : []);
    const proc = procedureBuildsFor(types) ? importedLeaderProcedure() : null;
    // Most creatures name no leader: they cost no second read of the XP cell.
    if (!proc && !Object.keys(readRoleSentences(text)).length) return null;
    const name = printedNameOf(node, found.entry.name);
    const option = creatureOption({
      key: slugLabel(found.entry.name),
      label: name,
      name,
      art: img,
      system: foundry.utils.deepClone(bound.system),
      items: bound.items,
      flags: bound.flags,
      extras,
      prototypeToken: bound.prototypeToken,
      id,
      cite: found.entry.cite,
    });
    const ladder = importedThrowLadder();
    const built = entryLeaderTemplate({
      option,
      text,
      xp: await wholeXpCell(bindDoc, found.cb, found.id, found.entry),
      proc,
      deriveLeader,
      procedure: !!proc,
      ladder: ladder.rows,
      ladderCite: ladder.cite,
    });
    if (!built) return null;
    // The troop kits its kind fields, where the Judge's tables hold them; a
    // kit alone mints no template.
    kitPresets({ options: [option], axes: built.axes, cells: built.cells, kits: importedKits() });
    const templateId = leaderTemplateId(id);
    const label = game.i18n.format(`${LANG_PREFIX}.leaderTemplate.name`, { name });
    const system = { output: { actorType: "monster", nameFormat: built.out.nameFormat }, axes: built.axes, cells: built.cells };
    const held = (await importedActorsOfType(TEMPLATE_TYPE)).find((a) => a.getFlag(MODULE_ID, "cookbook")?.id === templateId);
    if (held) {
      await held.update({ name: label, "system.axes": system.axes, "system.cells": system.cells, "system.output": system.output });
      return held;
    }
    return await createDoc(Actor, {
      name: label,
      type: TEMPLATE_TYPE,
      folder,
      ...(img ? { img } : {}),
      system,
      flags: { [MODULE_ID]: { cookbook: { id: templateId, cite: found.entry.cite, leadersOf: id } } },
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${id}: leader template not built.`, err);
    return null;
  }
}

/**
 * ONE-OFF family enrichments, layered AFTER the general prose-leader pass —
 * bespoke shapes a specific family needs (framework where it pays, plain
 * code where a one-off is faster). Each runs inside the same try/catch: a
 * failing enrichment costs its extras, never the family.
 */
const FAMILY_ONE_OFFS = {};

/**
 * Carry the variants another book merged into a held family template onto a
 * fresh build of it: each variant option the build lacks (by cookbook id and
 * by key), its cells, and the role options those cells name. A held option
 * whose cookbook id is in `lore` is this family's own description, which the
 * build reads as prose, and is never carried. Mutates `axes` and `cells`.
 */
function carryMergedVariants(held, axes, cells, lore = new Set()) {
  const heldAxes = sysObject(held).axes ?? [];
  const heldCells = sysObject(held).cells ?? [];
  const vIn = axes.find((a) => a.key === "variant");
  const vHeld = heldAxes.find((a) => a.key === "variant");
  if (!vIn || !vHeld) return;
  const idOf = (o) => o.flags?.[MODULE_ID]?.cookbook?.id ?? null;
  const ids = new Set(vIn.options.map(idOf).filter(Boolean));
  const keys = new Set(vIn.options.map((o) => o.key));
  const kept = vHeld.options.filter((o) => !ids.has(idOf(o)) && !keys.has(o.key) && !lore.has(idOf(o)));
  if (!kept.length) return;
  vIn.options.push(...kept);
  const keptKeys = new Set(kept.map((o) => o.key));
  const keptCells = heldCells.filter((c) => keptKeys.has(String(c.key).split("|")[0]));
  cells.push(...keptCells);
  const roleHeld = heldAxes.find((a) => a.key === "role");
  if (roleHeld) {
    let roleIn = axes.find((a) => a.key === "role");
    if (!roleIn) axes.push((roleIn = { ...structuredClone(roleHeld), options: [] }));
    const have = new Set(roleIn.options.map((o) => o.key));
    const named = new Set(keptCells.map((c) => String(c.key).split("|")[1]));
    roleIn.options.push(...roleHeld.options.filter((o) => !have.has(o.key) && (named.has(o.key) || o.key === roleHeld.default)));
  }
  // A kept variant's kit cells keep the kit axis, which stays the last one.
  if (keptCells.some((c) => (c.by ?? []).includes("kit"))) unionKitAxis(axes, heldAxes);
  const kitAt = axes.findIndex((a) => a.key === "kit");
  if (kitAt >= 0 && kitAt < axes.length - 1) axes.push(...axes.splice(kitAt, 1));
}

/**
 * kind.monsterFamily -> ONE `acks-extras.template` generator whose variant axis
 * options are the family's member creatures, each a COMPLETE preset: the same
 * bindMonster output a direct import produces (system, weapons, abilities,
 * FMS extras, token size, per-variant art), packed as engine-ready patches.
 * "Start with a baseline and select the special case" instead of N top-level
 * actors; a member can still be imported directly from the dialog. Families
 * with description-variant prose get ONE-OFF role axes (FAMILY_ONE_OFFS).
 */
export async function importFamily(bookId, famId, folderId) {
  const found = cookbookEntry(famId);
  const fam = found?.entry?.family;
  if (!fam) return null;
  const session = ctx.sessionDocs.get(bookId);
  const cb = found.cb;

  const options = [];
  const loreIds = new Set();
  const memberText = new Map();
  const memberXp = new Map();
  let lore = "";
  let img = "";
  for (const member of fam.members) {
    try {
    let entry = cb.entries[member.id];
    if (!entry) continue;
    // An overview that reads another member's stat block is the family's
    // description, not a variant: its prose becomes the template's own.
    if (overviewIsLore(member, fam.members, fam.name, (id) => cb.entries[id])) {
      loreIds.add(member.id);
      const node = await executeEntry(session.doc, cb, data.registers, member.id);
      if (node.ok) lore = entryText(node, member.id, entry.cite);
      continue;
    }
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
    if (!legacy) memberXp.set(slugLabel(member.variant), await wholeXpCell(bindDoc, bindCb, bindId, entry));
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

    options.push(
      creatureOption({ key: slugLabel(member.variant), label: member.variant, name: entry.name, art, system, items, flags, extras, prototypeToken, id: bindId, cite: entry.cite }),
    );
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
    const ladder = importedThrowLadder();
    proseLeaderRoles({ options, memberText, memberXp, axes, cells, out, ladder: ladder.rows, ladderCite: ladder.cite });
    // The AXIOMS leader procedure, where the Judge's copy is imported: a second
    // source beside the printed leaders, and the only one where none is printed.
    derivedLeaderRoles({
      options, axes, cells, out, memberXp,
      proc: importedLeaderProcedure(), deriveLeader,
      ladder: ladder.rows, ladderCite: ladder.cite,
    });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${famId}: prose-role pass failed — importing without roles.`, err);
  }
  // The troop kits each kind fields, after the roles so a leader's kit cells
  // know which ranks the variant has.
  try {
    kitPresets({ options, axes, cells, kits: importedKits() });
  } catch (err) {
    console.warn(`${MODULE_ID} | ${famId}: kit pass failed — importing without kits.`, err);
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
    // One entry's leader template is that entry's, never a family's to adopt.
    if (a.getFlag(MODULE_ID, "cookbook")?.leadersOf) return false;
    const aFam = a.getFlag(MODULE_ID, "cookbook")?.id ?? "";
    if (aFam === famId || (aFam.split(".")[1] ?? aFam) === famSuffix) return true;
    if (aFam && canonicalName(a.name) === canonicalName(fam.name)) return true;
    return (a.system.axes ?? []).some(
      (ax) => ax.key === "variant" && (ax.options ?? []).some((o) => incomingIds.has(optionIdOf(o)))
    );
  });
  if (existing && !isRewriting(famId)) {
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
        exRole.default ||= inRole.default ?? "";
      } else if (inRole && added.length) {
        exAxes.push(inRole);
      }
      // The leader-source axis is chosen before the role, wherever it lands.
      const inSource = axes.find((a) => a.key === SOURCE_AXIS);
      if (inSource && added.length && !exAxes.some((a) => a.key === SOURCE_AXIS)) {
        const at = exAxes.findIndex((a) => a.key === "role");
        exAxes.splice(at < 0 ? exAxes.length : at, 0, inSource);
      }
      // The kit axis is chosen last, after the role its cells are keyed by.
      if (addedCells.some((c) => (c.by ?? []).includes("kit"))) unionKitAxis(exAxes, axes);
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
  // A repair in place writes this build over the held template whole
  // (`createDoc` under `withRewrite`); the variants another book merged into
  // it, and their cells, are carried over as they stand.
  if (existing && isRewriting(famId)) {
    carryMergedVariants(existing, axes, cells, loreIds);
    if (axes.some((a) => a.key === "role")) out.nameFormat = "{variant} {role}";
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
      ...(lore ? { details: { biography: lore } } : {}),
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
export async function importTemplate(bookId, id, folderId) {
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
  // A row with no printed throw takes its rating's row of the Judge's ladder.
  const ladder = importedThrowLadder();

  const axes = [];
  for (const ax of spec.axes ?? []) {
    const [firstGrid, ...restGrids] = ax.grids ?? [];
    const rows = gridRows(firstGrid);
    const restByKey = restGrids.map((g) => new Map(gridRows(g).map((r) => [r.key, r.cells])));
    const options = rows.map((row) => {
      const cells = { ...row.cells };
      for (const m of restByKey) Object.assign(cells, m.get(row.key) ?? {});
      return templateOption(ax, row, cells, { id, cite, sectionText, spellSource, ladder });
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
        const weapons = weaponsFromRoutine(info.routine, dmg, info.types);
        cells.push({
          by: [aKey, bKey],
          key: `${row.key}|${formKey}`,
          merge: {
            attacks: [info.routine, String(dmg)].filter(Boolean).join(" — "),
            ...(weapons.mod ? { damage: damageTotal(weapons.mod) } : {}),
          },
          items: weapons.items,
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
  if (node.fields.art && ctx.importArtForPage && !isRewriting(id)) {
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
 * field a Judge wrote in; `keptProse` names those. With `force` that field is
 * rewritten too; a `repair` tally carrying a `decision` writes it only where
 * the decision takes it and lists it in the tally's `edits` (`repairWrite`).
 */
export async function refillMonster(actor, { whole = false, force = false, repair = null } = {}) {
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
  // `stats.*` fields would otherwise retract every path at once. See
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
    const plan = await repairWrite(
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
      repair && "decision" in repair ? repair : { force },
    );
    if (plan.refused) return { ok: false, reason: plan.refused, book: bookId, name: found.entry.name };
    // The creature's leaders are rebuilt from the same read, and minted where
    // a world holds the creature without them.
    await mintLeaderTemplate({
      id, found, node, bound: { system, items, flags, prototypeToken }, extras,
      folder: actor.folder?.id ?? null, bindDoc: session.doc, img: actor.img ?? "",
    });
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

/**
 * Defer-to-newest: an adventure entry reprinted in a book this seat has OPEN
 * (meta.revisedBy, e.g. ax2.khepri -> mm.khepri) imports from there instead —
 * the ACKS II printing outranks the adventure's ACKS I block when present.
 */
export function deferTarget(id) {
  const rev = cookbookEntry(id)?.entry?.meta?.revisedBy;
  if (!rev) return null;
  const revBook = rev.split(".")[0];
  return ctx.sessionDocs.has(revBook) && cookbookEntry(rev) ? rev : null;
}

/** Legacy (ACKS I label-column) stats, translated onto the bindMonster surface. */
export function bindLegacyMonster(node) {
  const s = node.fields.stats ?? {};
  const morale =
    typeof s.morale === "string" && /^[+-]?\d+$/.test(s.morale.trim()) ? parseInt(s.morale, 10) : s.morale;
  const bound = bindMonster({
    ...node,
    fields: { ...node.fields, attacks: null, stats: { ...s, morale, speedLand: s.movement } },
  });
  const atkText = [s.attacks, s.damage].filter(Boolean).join(" — ");
  if (atkText) bound.system.attacks = atkText;
  // One weapon item when the era's "N (name)" attack + dice damage parse. A
  // "by weapon ±N" damage is the creature's modifier (`damage.mod`, as
  // `bindMonster` takes it) and the item keeps "By weapon".
  const m = /^\s*\d*\s*\(?\s*([A-Za-z][A-Za-z' -]*)\)?/.exec(String(s.attacks ?? ""));
  const lift = splitWeaponModifier(s.damage);
  if (lift?.mod) bound.system.damage = damageTotal(lift.mod);
  const dmg = lift?.formula ?? diceOf(s.damage);
  if (m && dmg) {
    bound.items = [
      ...(bound.items ?? []),
      {
        name: capitalize(m[1].trim()),
        type: "weapon",
        img: DEFAULT_IMG.ATTACK,
        system: {
          description: "", damage: weaponDamage(dmg), bonus: { attack: 0, damage: 0 }, melee: true, missile: false, equipped: true,
          pattern: "transparent", counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
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
 * fields — and the entry's own text is written into the biography. The items
 * it builds carry the `minted` stamp.
 */
export function bindNpc(node) {
  const sl = node.fields.statline ?? {};
  const system = {};
  if (Number.isInteger(sl.ac)) system.ac = { value: sl.ac };
  if (Number.isInteger(sl.hp)) {
    const hdCount = parseInt(String(sl.hd ?? sl.class?.level ?? 1), 10) || 1;
    system.hp = { value: sl.hp, max: sl.hp, hd: `${hdCount}d8` };
  }
  // Save row from printed save level (else class level). NOTE: the shared LUT
  // is the fighter line — the MM approximation this module already uses.
  const level = sl.save?.level ?? sl.class?.level ?? 0;
  const row = savesForLevel(level);
  system.saves = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, { value: v }]));
  system.details = {
    ...(typeof sl.ml === "number" ? { morale: Math.max(-6, Math.min(4, sl.ml)) } : {}),
    ...(sl.xp != null ? { xp: sl.xp } : {}),
    ...(sl.al ? { alignment: ALIGN_WORD[sl.al] ?? sl.al } : {}),
  };
  const mv = /(\d+)/.exec(String(sl.mv ?? ""));
  if (mv) system.movement = { base: parseInt(mv[1], 10) };
  if (sl.atk?.throw != null) system.attack = { throw: sl.atk.throw };
  if (sl.atk) system.attacks = [sl.atk.count, sl.atk.text ? `(${sl.atk.text})` : "", sl.dmg ? `— ${sl.dmg}` : ""].filter(Boolean).join(" ");
  // A "by weapon ±N" damage is the creature's modifier, as `bindMonster` takes it.
  const lift = splitWeaponModifier(sl.dmg);
  if (lift?.mod) system.damage = damageTotal(lift.mod);
  const items = [];
  if (sl.atk?.text) {
    items.push({
      name: capitalize(sl.atk.text),
      type: "weapon",
      img: DEFAULT_IMG.ATTACK,
      system: {
        description: "", damage: weaponDamage(lift?.formula ?? (diceOf(sl.dmg) || "")), bonus: { attack: 0, damage: 0 }, melee: true, missile: false, equipped: true,
        pattern: "transparent", counter: { value: 1, max: 1 }, cost: 0, weight: 0, weight6: 0,
      },
    });
  }
  // The items are the import's own, stamped so a repair replaces them and keeps any a Judge added.
  return { system, items: items.map(asMinted), statline: sl };
}
