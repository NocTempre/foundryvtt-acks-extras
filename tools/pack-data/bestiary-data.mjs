/**
 * Example-compendium source data: document factories plus every sample monster,
 * spoil, and table. Consumed by tools/build-packs.mjs via pack-data.mjs (Node
 * only, never loaded by Foundry).
 *
 * The entries are TEST ARTIFACTS: invented stat blocks over generic, open-
 * content creature archetypes (giant rat, skeleton, dire wolf, goblin, mule)
 * plus wholly original creatures. Numbers are made up for exercising the
 * storage model — no text or statistics are reproduced from any published
 * ACKS book. Each entry demonstrates a different slice of the schema:
 *
 *   Giant Rat      — small animal baseline, second (swim) movement row
 *   Skeleton       — undead+construct multi-type, mindless, defenses block
 *   Dire Wolf      — animal with senses, tracking ability, war-mount value
 *   Goblin + Chief — humanoid gear/inventory, warband nouns, variants links
 *   Pack Mule      — domestic beast: carried gear vs Normal/Max Load (encumbrance)
 *   Ash Drake      — breath weapon, innate spellcasting, immunity/susceptibility,
 *                    fly speed, oviparous, hoard treasure
 *   Marsh Lurker   — HD range (countMax), multi-tentacle attacks, aquatic senses
 */

const MODULE_ID = "acks-monsters";
const SV = 3; // acks CURRENT_SCHEMA_VERSION
const now = Date.now();
const STATS = { coreVersion: "14", createdTime: now, modifiedTime: now };
const uuid = (id) => `Compendium.${MODULE_ID}.bestiary.Actor.${id}`;

/* -------------------------------------------- */
/*  Document factories                          */
/* -------------------------------------------- */

export function weapon(id, name, { damage, natural, dmgType, extra = false, count = 1, missile = false, img }) {
  return {
    _id: id,
    name,
    type: "weapon",
    img: img ?? "icons/svg/sword.svg",
    system: {
      _schemaVersion: SV,
      description: "",
      damage,
      bonus: 0,
      melee: !missile,
      missile,
      equipped: true,
      pattern: "transparent",
      tags: [],
      counter: { value: count, max: count },
      cost: 0,
      weight: 0,
      weight6: 0,
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        ...(natural ? { naturalWeapon: natural } : {}),
        ...(dmgType ? { damageType: dmgType } : {}),
        extraordinary: extra,
      },
    },
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  };
}

export function ability(id, name, { target = 0, type = "general", desc = "", category, usage, img }) {
  return {
    _id: id,
    name,
    type: "ability",
    img: img ?? "icons/svg/book.svg",
    system: {
      _schemaVersion: SV,
      description: desc ? `<p>${desc}</p>` : "",
      proficiencytype: type,
      favorite: false,
      pattern: "white",
      requirements: "",
      roll: target > 0 ? "1d20" : "",
      rollType: "above",
      rollTarget: target,
      blindroll: false,
      save: "",
    },
    effects: [],
    flags: {
      [MODULE_ID]: {
        ...(category ? { abilityCategory: category } : {}),
        ...(usage ? { usage } : {}),
      },
    },
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  };
}

/** Harvestable part: flagged as a spoil so it lands on the Spoils tab. */
export function spoil(id, name, { weight6, cost, component = false, effects = [], desc = "", img }) {
  return {
    _id: id,
    name,
    type: "item",
    img: img ?? "icons/svg/item-bag.svg",
    system: {
      _schemaVersion: SV,
      description: desc ? `<p>${desc}</p>` : "",
      subtype: "item",
      quantity: { value: 1, max: 0 },
      cost,
      weight: 0,
      weight6,
    },
    effects: [],
    flags: { [MODULE_ID]: { spoil: true, component, researchEffects: effects } },
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  };
}

/** Carried gear: an UN-flagged generic item, so it lands on the Inventory tab
 *  and counts toward the encumbrance readout. */
export function gear(id, name, { weight6 = 0, cost = 0, qty = 1, desc = "", img }) {
  return {
    _id: id,
    name,
    type: "item",
    img: img ?? "icons/svg/item-bag.svg",
    system: {
      _schemaVersion: SV,
      description: desc ? `<p>${desc}</p>` : "",
      subtype: "item",
      quantity: { value: qty, max: 0 },
      cost,
      weight: 0,
      weight6,
    },
    effects: [],
    flags: {},
    ownership: { default: 0 },
    sort: 0,
    _stats: { ...STATS },
  };
}

/** Assemble the core `monster` system block, filling the fields acks touches. */
export function monsterSystem({
  hpFormula,
  hp,
  ac,
  saves,
  morale = 0,
  xp = 0,
  alignment = "Neutral",
  treasureType = "none",
  appearing = {},
  biography = "",
}) {
  return {
    _schemaVersion: SV,
    isNew: false,
    hp: { hd: hpFormula, value: hp, max: hp, bhr: "1d3" },
    aac: { value: ac, mod: 0 },
    thac0: { value: 19, bba: 0, throw: 10, mod: { missile: 0, melee: 0 } },
    damage: { mod: { missile: 0, melee: 0 } },
    movement: { base: 120, mod: 0, value: "" },
    initiative: { value: 0, mod: 0 },
    surprise: { mod: 0, surpriseothers: 0, avoidsurprise: 0 },
    // Write both key spellings so the value lands whether the running system
    // uses blast/implements (newer) or breath/wand (released 14.0.1). Keys not
    // in the actor schema are harmlessly dropped on load.
    saves: {
      paralysis: { value: saves.paralysis },
      death: { value: saves.death },
      blast: { value: saves.blast },
      breath: { value: saves.blast },
      implements: { value: saves.implements },
      wand: { value: saves.implements },
      spell: { value: saves.spell },
    },
    save: { mod: 0 },
    retainer: { enabled: false, loyalty: 0, wage: "", managerid: "", category: "henchman", quantity: 1 },
    details: {
      biography,
      alignment,
      xp,
      treasure: { table: "", type: treasureType },
      appearing: { d: appearing.d ?? "", w: appearing.w ?? "" },
      morale,
    },
    attacks: "",
  };
}

export function monster({ id, name, img, system, extras, items = [] }) {
  // Embedded documents are packed as their own LevelDB entries and need a
  // compound _key (parent collection.embedded!parentId.childId).
  const keyedItems = items.map((it) => ({ ...it, _key: `!actors.items!${id}.${it._id}` }));
  return {
    _id: id,
    _key: `!actors!${id}`,
    name,
    type: "monster",
    img: img ?? "icons/svg/mystery-man.svg",
    system,
    items: keyedItems,
    effects: [],
    flags: { [MODULE_ID]: { extras } },
    prototypeToken: {
      name,
      actorLink: false,
      disposition: -1,
      sight: { enabled: true },
    },
    folder: null,
    sort: 0,
    ownership: { default: 0 },
    _stats: { ...STATS },
  };
}

/* Saving-throw bands (paralysis/death/blast/implements/spell). */
const SAVES_NH = { paralysis: 14, death: 15, blast: 16, implements: 17, spell: 18 };
const SAVES_F1 = { paralysis: 13, death: 14, blast: 15, implements: 16, spell: 17 };
const SAVES_F2 = { paralysis: 12, death: 13, blast: 14, implements: 15, spell: 16 };
const SAVES_F4 = { paralysis: 11, death: 12, blast: 13, implements: 14, spell: 15 };
const SAVES_F8 = { paralysis: 8, death: 9, blast: 10, implements: 11, spell: 12 };

/* -------------------------------------------- */
/*  Giant Rat — small animal, swim row          */
/* -------------------------------------------- */

function giantRat() {
  return monster({
    id: "acksmGiantRat000",
    name: "Giant Rat",
    system: monsterSystem({
      hpFormula: "1d4",
      hp: 2,
      ac: 1,
      saves: SAVES_NH,
      morale: -1,
      xp: 5,
      treasureType: "none",
      appearing: { d: "3d6", w: "3d10" },
      biography: "<p>A dog-sized scavenger rat. Invented test statistics over a generic open-content archetype.</p>",
    }),
    extras: {
      types: ["animal"],
      subtype: "wild",
      size: "small",
      mass: { stone: 1, lbs: 25 },
      hd: { count: 0.5, asterisks: 0, dieType: 4 },
      saveAs: { class: "fighter", level: 0 },
      speeds: [
        { type: "land", combat: 30, run: 90, hover: false },
        { type: "swim", combat: 15, run: 45, hover: false },
      ],
      vision: ["night"],
      otherSenses: [{ type: "acuteOlfaction", range: null, note: "" }],
      load: { normal: 1, capacity: 2 },
      secondary: {
        expeditionSpeed: 18,
        supplyCost: 0.1,
        trainingMonths: 3,
        intelligence: "bestial",
        trainingModifier: -1,
        lifespan: { baby: 0, juvenile: 0.2, adolescent: 0.5, adult: 1, middleAged: 2, old: 3, ancient: 4, maximum: 5 },
        reproduction: { count: "2d4", youngType: "litter", interval: 3, intervalUnit: "month" },
        untrainedValue: { adult: 2, juvenile: 1, baby: 0.5 },
        trainedValue: [{ role: "other", value: 8, note: "ratter" }],
      },
      encounter: {
        lairChance: 20,
        dungeon: { wandering: { noun: "Pack", number: "3d6" }, lair: { noun: "Nest", number: "3d10" } },
        wilderness: { wandering: { noun: "Pack", number: "3d6" }, lair: { noun: "Nest", number: "3d10" } },
      },
      description: {
        combat: "<p>Bites and flees; fights only when cornered or in overwhelming numbers.</p>",
      },
    },
    items: [
      weapon("acksmRatBite0000", "Bite", { damage: "1d3", natural: "bite", dmgType: "piercing", img: "icons/svg/pawprint.svg" }),
      ability("acksmRatFever000", "Filth Fever", {
        category: "disease",
        desc: "A bitten creature must save vs Death or contract a debilitating fever (invented test effect).",
      }),
      spoil("acksmRatPelt0000", "Giant Rat Pelt", { weight6: 1, cost: 5, desc: "A mangy but saleable pelt." }),
    ],
  });
}

/* -------------------------------------------- */
/*  Skeleton — undead construct, defenses       */
/* -------------------------------------------- */

function skeleton() {
  return monster({
    id: "acksmSkeleton000",
    name: "Skeleton",
    system: monsterSystem({
      hpFormula: "1d8",
      hp: 4,
      ac: 2,
      saves: SAVES_F1,
      morale: 4,
      xp: 15,
      alignment: "Chaotic",
      treasureType: "none",
      appearing: { d: "3d4", w: "3d10" },
      biography: "<p>An animated warrior's bones. Invented test statistics over a generic open-content archetype.</p>",
    }),
    extras: {
      types: ["undead", "construct"],
      size: "man",
      mass: { stone: 6, lbs: 60 },
      hd: { count: 1, asterisks: 1, dieType: 8 },
      saveAs: { class: "fighter", level: 1 },
      speeds: [{ type: "land", combat: 20, run: 60, hover: false }],
      vision: ["lightless"],
      lightlessRange: 60,
      load: { normal: 5, capacity: 10 },
      defenses: {
        immunities: {
          damage: ["necrotic", "poisonous"],
          mundane: false,
          extraordinary: false,
          effects: "enchantment; sleep; fear",
          note: "mindless undead construct",
        },
        resistances: { damage: ["piercing"], mundane: true, extraordinary: false, effects: "", note: "arrows rattle between the ribs" },
        susceptibilities: { damage: ["bludgeoning"], mundane: false, extraordinary: false, effects: "", note: "" },
      },
      secondary: { intelligence: "mindless" },
      encounter: {
        lairChance: 35,
        dungeon: { wandering: { noun: "Squad", number: "3d4" }, lair: { noun: "Crypt", number: "3d10" } },
        wilderness: { wandering: { noun: "Squad", number: "3d4" }, lair: { noun: "Crypt", number: "3d10" } },
      },
      description: {
        combat: "<p>Never checks morale; fights until destroyed. Attacks with whatever weapon it carried in life.</p>",
      },
    },
    items: [
      weapon("acksmSkelSword00", "Rusty Sword", { damage: "1d6", natural: "weapon", dmgType: "slashing" }),
      gear("acksmSkelShield0", "Battered Shield", { weight6: 6, cost: 2, desc: "Adds its bonus while the arm still holds." }),
    ],
  });
}

/* -------------------------------------------- */
/*  Dire Wolf — senses, tracking, war mount     */
/* -------------------------------------------- */

function direWolf() {
  return monster({
    id: "acksmDireWolf000",
    name: "Dire Wolf",
    system: monsterSystem({
      hpFormula: "4d8+1",
      hp: 19,
      ac: 3,
      saves: SAVES_F2,
      morale: 1,
      xp: 140,
      treasureType: "none",
      appearing: { d: "2d4", w: "1d6+1" },
      biography: "<p>A horse-sized wolf of the deep forests. Invented test statistics over a generic open-content archetype.</p>",
    }),
    extras: {
      types: ["animal"],
      subtype: "wild",
      size: "large",
      mass: { stone: 60, lbs: 600 },
      hd: { count: 4, bonus: 1, asterisks: 0, dieType: 8 },
      saveAs: { class: "fighter", level: 2 },
      speeds: [{ type: "land", combat: 60, run: 180, hover: false }],
      vision: ["night"],
      otherSenses: [{ type: "acuteOlfaction", range: null, note: "follows day-old scent trails" }],
      load: { normal: 25, capacity: 50 },
      secondary: {
        expeditionSpeed: 36,
        supplyCost: 3,
        trainingMonths: 4,
        intelligence: "bestial",
        trainingModifier: 0,
        battleRating: { individual: 0.05, unit: 3 },
        lifespan: { baby: 0, juvenile: 1, adolescent: 2, adult: 4, middleAged: 8, old: 12, ancient: 16, maximum: 20 },
        reproduction: { count: "1d4+1", youngType: "litter", interval: 1, intervalUnit: "year" },
        untrainedValue: { adult: 150, juvenile: 200, baby: 100 },
        trainedValue: [
          { role: "warMount", value: 750, note: "prized by small riders" },
          { role: "hunter", value: 400, note: "" },
        ],
      },
      encounter: {
        lairChance: 15,
        dungeon: { wandering: { noun: "Pack", number: "2d4" }, lair: { noun: "Den", number: "1d6+1" } },
        wilderness: { wandering: { noun: "Pack", number: "2d4" }, lair: { noun: "Den", number: "1d6+1" } },
      },
    },
    items: [
      weapon("acksmWolfBite000", "Bite", { damage: "2d4", natural: "bite", dmgType: "piercing", img: "icons/svg/pawprint.svg" }),
      ability("acksmWolfTrack00", "Tracking", { target: 6, category: "classPowers", desc: "Follows scent trails as a trained tracker (6+)." }),
      spoil("acksmWolfPelt000", "Dire Wolf Pelt", { weight6: 8, cost: 20, desc: "A thick winter pelt." }),
      spoil("acksmWolfFang000", "Dire Wolf Fangs", {
        weight6: 1,
        cost: 35,
        component: true,
        effects: ["beast speech", "howl of the pack"],
        desc: "Invented research component.",
      }),
    ],
  });
}

/* -------------------------------------------- */
/*  Goblin + Chief — humanoids, gear, variants  */
/* -------------------------------------------- */

function goblins() {
  const warrior = monster({
    id: "acksmGoblin00000",
    name: "Goblin",
    system: monsterSystem({
      hpFormula: "1d8-1",
      hp: 3,
      ac: 2,
      saves: SAVES_F1,
      morale: -1,
      xp: 5,
      alignment: "Chaotic",
      treasureType: "E (per warband)",
      appearing: { d: "2d4", w: "1d6" },
      biography: "<p>A spiteful little raider. Invented test statistics over a generic open-content archetype.</p>",
    }),
    extras: {
      types: ["humanoid"],
      subtype: "warrior",
      size: "small",
      mass: { stone: 4, lbs: 40 },
      hd: { count: 1, bonus: -1, asterisks: 0, dieType: 8 },
      saveAs: { class: "fighter", level: 1 },
      speeds: [{ type: "land", combat: 20, run: 60, hover: false }],
      vision: ["lightless"],
      lightlessRange: 60,
      load: { normal: 5, capacity: 10 },
      secondary: {
        expeditionSpeed: 18,
        supplyCost: 0.5,
        trainingMonths: 1,
        intelligence: "sapient",
        untrainedValue: { adult: 25, juvenile: 10, baby: 5 },
        trainedValue: [{ role: "other", value: 100, note: "or more" }],
        lifespan: { baby: 0, juvenile: 1, adolescent: 8, adult: 12, middleAged: 22, old: 33, ancient: 44, maximum: 55 },
        reproduction: { count: "1", youngType: "infant", interval: 1, intervalUnit: "year" },
      },
      encounter: {
        lairChance: 30,
        dungeon: { wandering: { noun: "Gang", number: "2d4" }, lair: { noun: "Lair (warband)", number: "1" } },
        wilderness: { wandering: { noun: "Warband (gangs)", number: "1d6" }, lair: { noun: "Village (warbands)", number: "1d8" } },
      },
      variants: [{ label: "Goblin Chief", uuid: uuid("acksmGobChief000") }],
      description: {
        combat: "<p>Skirmishes from the dark; flees when the chief falls. Sunlight stings its eyes (-1 to attack in daylight, invented).</p>",
      },
    },
    items: [
      weapon("acksmGobSpear000", "Spear", { damage: "1d6", natural: "weapon", dmgType: "piercing" }),
      weapon("acksmGobBow00000", "Short Bow", { damage: "1d6", natural: "weapon", dmgType: "piercing", missile: true }),
      gear("acksmGobShield00", "Wicker Shield", { weight6: 4, cost: 1 }),
      gear("acksmGobRations0", "Dried Rations", { weight6: 3, cost: 1, qty: 3, desc: "Best not to ask what of." }),
      spoil("acksmGobEars0000", "Goblin Ears", { weight6: 1, cost: 2, desc: "Proof for a village bounty." }),
    ],
  });

  const chief = monster({
    id: "acksmGobChief000",
    name: "Goblin Chief",
    system: monsterSystem({
      hpFormula: "3d8",
      hp: 13,
      ac: 4,
      saves: SAVES_F2,
      morale: 1,
      xp: 50,
      alignment: "Chaotic",
      treasureType: "E (per warband)",
    }),
    extras: {
      types: ["humanoid"],
      subtype: "chief (leads each warband)",
      size: "small",
      mass: { stone: 5, lbs: 50 },
      hd: { count: 3, asterisks: 0, dieType: 8 },
      saveAs: { class: "fighter", level: 3 },
      speeds: [{ type: "land", combat: 20, run: 60, hover: false }],
      vision: ["lightless"],
      lightlessRange: 60,
      load: { normal: 6, capacity: 12 },
      secondary: { intelligence: "sapient" },
      variants: [{ label: "Goblin", uuid: uuid("acksmGoblin00000") }],
      description: {
        combat: "<p>While the chief lives, its warband gains +1 morale (invented test rider).</p>",
      },
    },
    items: [
      weapon("acksmChfSword000", "Notched Sword", { damage: "1d6+1", natural: "weapon", dmgType: "slashing" }),
      gear("acksmChfMail0000", "Looted Mail Shirt", { weight6: 12, cost: 30, desc: "Cut down from human size." }),
    ],
  });

  return [warrior, chief];
}

/* -------------------------------------------- */
/*  Pack Mule — carried gear vs load (encumbrance) */
/* -------------------------------------------- */

function packMule() {
  return monster({
    id: "acksmPackMule000",
    name: "Pack Mule",
    system: monsterSystem({
      hpFormula: "2d8",
      hp: 9,
      ac: 1,
      saves: SAVES_NH,
      morale: 0,
      xp: 10,
      treasureType: "none",
      appearing: { d: "1d6", w: "2d6" },
      biography: "<p>A stoic beast of burden, loaded for an expedition. Invented test statistics.</p>",
    }),
    extras: {
      types: ["animal"],
      subtype: "domestic",
      size: "large",
      mass: { stone: 80, lbs: 800 },
      hd: { count: 2, asterisks: 0, dieType: 8 },
      saveAs: { class: "fighter", level: 0 },
      speeds: [{ type: "land", combat: 40, run: 120, hover: false }],
      vision: ["night"],
      otherSenses: [{ type: "acuteHearing", range: null, note: "" }],
      // Ships OVER its normal load: the Inventory tab's encumbrance readout
      // should show "Encumbered — half speed" out of the box.
      load: { normal: 20, capacity: 40 },
      secondary: {
        expeditionSpeed: 24,
        supplyCost: 1,
        trainingMonths: 1,
        intelligence: "bestial",
        trainingModifier: 2,
        untrainedValue: { adult: 10, juvenile: 5, baby: 3 },
        trainedValue: [{ role: "workbeast", value: 30, note: "" }],
        lifespan: { baby: 0, juvenile: 0.5, adolescent: 2, adult: 5, middleAged: 15, old: 22, ancient: 30, maximum: 38 },
        reproduction: { count: "1", youngType: "live", interval: 2, intervalUnit: "year" },
      },
      encounter: {
        lairChance: null,
        dungeon: { wandering: { noun: "Train", number: "1d6" }, lair: { noun: "", number: "" } },
        wilderness: { wandering: { noun: "Herd", number: "2d6" }, lair: { noun: "", number: "" } },
      },
    },
    items: [
      weapon("acksmMuleHoof000", "Hoof", { damage: "1d4", natural: "hoof", dmgType: "bludgeoning" }),
      gear("acksmMuleSack000", "Grain Sack", { weight6: 36, cost: 2, qty: 4, desc: "6 stone of grain each." }),
      gear("acksmMuleRope000", "Coiled Rope", { weight6: 3, cost: 1 }),
    ],
  });
}

/* -------------------------------------------- */
/*  Ash Drake — breath, spellcasting, defenses  */
/* -------------------------------------------- */

function ashDrake() {
  return monster({
    id: "acksmAshDrake000",
    name: "Ash Drake",
    system: monsterSystem({
      hpFormula: "9d8",
      hp: 40,
      ac: 6,
      saves: SAVES_F8,
      morale: 2,
      xp: 2400,
      alignment: "Chaotic",
      treasureType: "Q",
      appearing: { d: "1", w: "1d2" },
      biography: "<p>A wholly invented cinder-scaled drake for exercising the full schema. Not a published creature.</p>",
    }),
    extras: {
      types: ["monstrosity"],
      subtype: "drake",
      size: "huge",
      mass: { stone: 400, lbs: 4000 },
      hd: { count: 9, asterisks: 2, dieType: 8 },
      saveAs: { class: "fighter", level: 8 },
      speeds: [
        { type: "land", combat: 30, run: 90, hover: false },
        { type: "fly", combat: 80, run: 240, hover: false },
      ],
      vision: ["acute", "lightless"],
      lightlessRange: 90,
      otherSenses: [{ type: "acuteOlfaction", range: null, note: "smells smoke leagues away" }],
      load: { normal: 100, capacity: 200 },
      defenses: {
        immunities: { damage: ["fire"], mundane: true, extraordinary: true, effects: "its own breath", note: "" },
        susceptibilities: { damage: ["cold"], mundane: false, extraordinary: false, effects: "", note: "sluggish below freezing" },
      },
      spellcasting: { class: "Arcane (innate)", level: 4, note: "2/2 spells per day, innate repertoire (invented)" },
      secondary: {
        expeditionSpeed: 48,
        trainingMonths: 2,
        intelligence: "sapient",
        oviparous: true,
        reproduction: { count: "1d4", youngType: "egg", interval: 10, intervalUnit: "year" },
        untrainedValue: { adult: 3000, juvenile: 1500, baby: 800 },
        trainedValue: [{ role: "guard", value: 8000, note: "" }],
        lifespan: { baby: 0, juvenile: 5, adolescent: 15, adult: 30, middleAged: 120, old: 180, ancient: 240, maximum: 300 },
      },
      encounter: {
        lairChance: 45,
        dungeon: { wandering: { noun: "Solitary", number: "1" }, lair: { noun: "Lair", number: "1d2" } },
        wilderness: { wandering: { noun: "Solitary", number: "1" }, lair: { noun: "Lair", number: "1d2" } },
      },
      description: {
        combat: "<p>Opens with its cinder breath, then lands to rake and bite. Hoards whatever glitters.</p>",
      },
    },
    items: [
      weapon("acksmDrkClaw0000", "Claw", { damage: "1d6", natural: "claw", dmgType: "slashing", extra: true, count: 2 }),
      weapon("acksmDrkBite0000", "Bite", { damage: "2d8", natural: "bite", dmgType: "piercing", extra: true, img: "icons/svg/pawprint.svg" }),
      ability("acksmDrkBreath00", "Cinder Breath", {
        category: "breathWeapon",
        usage: "thricePerDay",
        desc: "A cone of burning ash dealing 9d6 extraordinary fire damage (Blast save for half). Invented test ability.",
        img: "icons/svg/fire.svg",
      }),
      ability("acksmDrkSpell000", "Innate Spellcasting", {
        category: "spellcasting",
        desc: "Casts arcane spells as a 4th-level caster, 2/2 per day (invented).",
      }),
      spoil("acksmDrkGland000", "Ember Gland", {
        weight6: 40,
        cost: 400,
        component: true,
        effects: ["cinder bolt", "ward of ashes"],
        desc: "Invented research component.",
        img: "icons/svg/fire.svg",
      }),
      spoil("acksmDrkHide0000", "Ashen Hide", { weight6: 60, cost: 350, desc: "Scorch-proof scale hide." }),
    ],
  });
}

/* -------------------------------------------- */
/*  Marsh Lurker — HD range, tentacles, senses  */
/* -------------------------------------------- */

function marshLurker() {
  return monster({
    id: "acksmMarshLurk00",
    name: "Marsh Lurker",
    system: monsterSystem({
      hpFormula: "4d8",
      hp: 18,
      ac: 4,
      saves: SAVES_F4,
      morale: 0,
      xp: 190,
      treasureType: "C",
      appearing: { d: "1", w: "1d3" },
      biography: "<p>A wholly invented tentacled bog predator for exercising the full schema. Not a published creature.</p>",
    }),
    extras: {
      types: ["monstrosity"],
      subtype: "bestial",
      size: "large",
      mass: { stone: 90, lbs: 900 },
      // Grows with age: specimens run 4 to 8 HD (tests the countMax range).
      hd: { count: 4, countMax: 8, asterisks: 1, dieType: 8 },
      saveAs: { class: "fighter", level: 4, levelMax: 8 },
      speeds: [
        { type: "land", combat: 20, run: 60, hover: false },
        { type: "swim", combat: 40, run: 120, hover: false },
      ],
      vision: ["lightless"],
      lightlessRange: 60,
      otherSenses: [{ type: "mechAquatic", range: 120, note: "feels ripples across still water" }],
      load: { normal: 30, capacity: 60 },
      secondary: {
        expeditionSpeed: 12,
        intelligence: "bestial",
        trainingMonths: 10,
        trainingModifier: -3,
        reproduction: { count: "2d6", youngType: "spawn", interval: 2, intervalUnit: "year" },
        untrainedValue: { adult: 400, juvenile: 150, baby: 60 },
      },
      encounter: {
        lairChance: 40,
        dungeon: { wandering: { noun: "Solitary", number: "1" }, lair: { noun: "Nest", number: "1d3" } },
        wilderness: { wandering: { noun: "Solitary", number: "1" }, lair: { noun: "Nest", number: "1d3" } },
      },
      description: {
        combat: "<p>Lies beneath the surface and drags prey under. Each tentacle strikes separately; grabbed prey is pulled toward the bite.</p>",
      },
    },
    items: [
      weapon("acksmLrkTent0000", "Tentacle", { damage: "1d4", natural: "tentacle", dmgType: "bludgeoning", count: 4 }),
      weapon("acksmLrkBite0000", "Bite", { damage: "1d8", natural: "bite", dmgType: "piercing", img: "icons/svg/pawprint.svg" }),
      ability("acksmLrkGrab0000", "Grab", {
        category: "grabRestrain",
        desc: "A creature struck by two tentacles in one round must save vs Paralysis (size-adjusted) or be grabbed. Invented test ability.",
      }),
      spoil("acksmLrkIchor000", "Lurker Ichor", {
        weight6: 12,
        cost: 120,
        component: true,
        effects: ["water breathing", "grasp of the deep"],
        desc: "Invented research component.",
      }),
    ],
  });
}

/* -------------------------------------------- */
/*  Pack assembly                               */
/* -------------------------------------------- */

export function buildBestiary() {
  return [giantRat(), skeleton(), direWolf(), ...goblins(), packMule(), ashDrake(), marshLurker()];
}

/** Standalone copies of notable harvestable parts (draggable onto any monster). */
export function buildSpoils() {
  const standalone = (doc) => ({ ...doc, _key: `!items!${doc._id}` });
  return [
    standalone(spoil("acksmSpRatPelt00", "Giant Rat Pelt", { weight6: 1, cost: 5, desc: "A mangy but saleable pelt." })),
    standalone(spoil("acksmSpWolfPelt0", "Dire Wolf Pelt", { weight6: 8, cost: 20, desc: "A thick winter pelt." })),
    standalone(
      spoil("acksmSpWolfFang0", "Dire Wolf Fangs", {
        weight6: 1,
        cost: 35,
        component: true,
        effects: ["beast speech", "howl of the pack"],
        desc: "Invented research component.",
      }),
    ),
    standalone(spoil("acksmSpGobEars00", "Goblin Ears", { weight6: 1, cost: 2, desc: "Proof for a village bounty." })),
    standalone(
      spoil("acksmSpDrkGland0", "Ember Gland", {
        weight6: 40,
        cost: 400,
        component: true,
        effects: ["cinder bolt", "ward of ashes"],
        desc: "Invented research component.",
        img: "icons/svg/fire.svg",
      }),
    ),
    standalone(spoil("acksmSpDrkHide00", "Ashen Hide", { weight6: 60, cost: 350, desc: "Scorch-proof scale hide." })),
    standalone(
      spoil("acksmSpLrkIchor0", "Lurker Ichor", {
        weight6: 12,
        cost: 120,
        component: true,
        effects: ["water breathing", "grasp of the deep"],
        desc: "Invented research component.",
      }),
    ),
  ];
}

export function buildTreasure() {
  // Invented dummy hoard so the treasure link can be tested out of the box:
  // drop the table onto a Full Monster's Ecology tab, then roll it.
  const result = (id, range, name) => ({
    _id: id,
    _key: `!tables.results!acksmTreasDummy0.${id}`,
    type: "text",
    name,
    description: "",
    img: "icons/svg/coins.svg",
    weight: 1,
    range,
    drawn: false,
    flags: {},
    _stats: { ...STATS },
  });
  return [
    {
      _id: "acksmTreasDummy0",
      _key: "!tables!acksmTreasDummy0",
      name: "Example Treasure Table (dummy)",
      img: "icons/svg/chest.svg",
      description:
        "<p>Invented dummy hoard — drop this table onto a Full Monster's Ecology tab treasure panel to link it, then roll. Replace with real hoard tables.</p>",
      formula: "1d4",
      replacement: true,
      displayRoll: true,
      folder: null,
      sort: 0,
      ownership: { default: 0 },
      flags: {},
      results: [
        result("acksmTResGold000", [1, 1], "140 gp in a rotted sack"),
        result("acksmTResSilver0", [2, 2], "A cracked silver mirror (25 gp)"),
        result("acksmTResGems000", [3, 3], "3 garnets (10 gp each)"),
        result("acksmTResNothing", [4, 4], "Nothing but dust and old bones"),
      ],
      _stats: { ...STATS },
    },
  ];
}
