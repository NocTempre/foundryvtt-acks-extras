/**
 * `refreshPlan` — what a repair in place writes onto an imported document, and
 * what it leaves as the Judge's.
 *
 * Every document below is invented: the names, the numbers and the prose are
 * shaped like an import's, and no book's are reproduced.
 */
import assert from "node:assert";
import {
  refreshPlan,
  REPAIR,
  handWrittenProse,
  repairTally,
  repairCounts,
  countRepair,
  unrepaired,
} from "../../scripts/importer/refresh.mjs";
import { bookText } from "../../scripts/importer/prose.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const M = "acks-extras";
const stamped = (text) => bookText([text], "XX p.9", { id: "def.trap.test", book: "xx", page: 11 });

/* --- the ownership test ---------------------------------------------------- */
check("a stamped block alone is the module's", !handWrittenProse(stamped("A wire runs across the floor.")));
check("an editor's empty paragraph is nobody's", !handWrittenProse(`${stamped("Text.")}<p>&nbsp;</p>`));
check("a legacy tag is the module's", !handWrittenProse("<p>@PdfText[xx.12]{Wire}</p>"));
check("a word beside the block is the Judge's", handWrittenProse(`${stamped("Text.")}<p>Reset by the warden.</p>`));

/* --- a trap: the level in force and each row's judged fields stay ---------- */
const judgedRow = (text) => ({
  text,
  resolution: "save",
  onSuccess: "none",
  saveKey: "paralysis",
  attackThrow: 7,
  damageFormula: "",
  pitDepthFeet: 20,
  spiked: true,
  radiusFeet: 5,
  rider: "prone",
});
const trapSource = {
  type: "acks-extras.trap",
  name: "Wire (XX)",
  system: {
    level: 3,
    triggerOn: 2,
    description: stamped("Old passage."),
    levels: [judgedRow("old one"), judgedRow("old two")],
  },
  flags: { [M]: { cookbook: { id: "def.trap.test", cite: "XX p.8", printed: "Wire", merged: ["def.trap.twin"] } } },
};
const trapBuilt = {
  name: "Wire",
  type: "acks-extras.trap",
  img: "modules/fixture/old.webp",
  flags: { [M]: { cookbook: { id: "def.trap.test", cite: "XX p.9" } } },
  system: {
    source: { book: "xx", cite: "XX p.9", ref: "def.trap.test" },
    description: stamped("New passage."),
    level: 1,
    levels: [
      { text: "new one", damageFormula: "2d4" },
      { text: "new two", damageFormula: "4d4" },
    ],
  },
};
const trap = refreshPlan(trapSource, trapBuilt, REPAIR.trap);
check("the level in force is not written", !("level" in trap.update.system));
check("a row takes the new reading", trap.update.system.levels[0].text === "new one" && trap.update.system.levels[1].damageFormula === "4d4");
check("a row keeps what the Judge set on it", trap.update.system.levels[0].saveKey === "paralysis" && trap.update.system.levels[1].pitDepthFeet === 20);
check("a stamped description is rewritten", /New passage/.test(trap.update.system.description));
check("the name and image stay", !("name" in trap.update) && !("img" in trap.update));
check("the stamp takes the new citation", trap.update.flags[M].cookbook.cite === "XX p.9");
check(
  "the stamp's identity is never written",
  !["id", "merged", "printed", "book"].some((key) => key in trap.update.flags[M].cookbook),
);
check("the build is not changed", trapBuilt.system.level === 1 && !("saveKey" in trapBuilt.system.levels[0]));

const annotated = refreshPlan(
  { ...trapSource, system: { ...trapSource.system, description: `${stamped("Old passage.")}<p>Reset by the warden.</p>` } },
  trapBuilt,
  REPAIR.trap,
);
check("a description the Judge wrote in is kept", !("description" in annotated.update.system));
check("and reported", annotated.keptProse.includes("description"));

check(
  "a build of another document type is refused",
  refreshPlan({ ...trapSource, type: "item" }, { ...trapBuilt, type: "weapon" }, REPAIR.equipment).refused === "type",
);

/* --- a vehicle: its crew and its damage are the table's, not the book's --- */
const vehicle = refreshPlan(
  {
    type: "acks-extras.vehicle",
    system: {
      crew: { roles: [{ key: "driver", required: 1, aboard: 1, motive: true }] },
      shp: { value: 3, max: 9 },
      cargo: { capacityStone: 10, passengerStone: 40, passengers: 0 },
      speeds: { tiers: [{ maxLoadStone: 10, feetPerTurn: 60, team: 2 }] },
    },
  },
  {
    type: "acks-extras.vehicle",
    system: {
      crew: { roles: [{ key: "driver", required: 2, aboard: 0, motive: true }] },
      shp: { value: 12, max: 12 },
      cargo: { capacityStone: 14 },
      speeds: { tiers: [{ maxLoadStone: 14, feetPerTurn: 60, team: 0 }] },
    },
  },
  REPAIR.vehicle,
);
check("the crew aboard is not written", !("crew" in vehicle.update.system));
check("damage taken stays, the maximum is re-read", !("value" in vehicle.update.system.shp) && vehicle.update.system.shp.max === 12);
check("a tier keeps the team the Judge gave it", vehicle.update.system.speeds.tiers[0].team === 2);
check("a tier takes the new load", vehicle.update.system.speeds.tiers[0].maxLoadStone === 14);
check("cargo writes only what was read", vehicle.update.system.cargo.capacityStone === 14 && !("passengerStone" in vehicle.update.system.cargo));

/* --- equipment: the stack is the Judge's ------------------------------------ */
const gear = refreshPlan(
  { type: "item", system: { quantity: { value: 12, max: 0 }, cost: 5, subtype: "clothing" } },
  {
    type: "item",
    system: { quantity: { value: 1, max: 0 }, cost: 6, subtype: "item" },
    flags: { [M]: { light: true, minted: true } },
  },
  REPAIR.equipment,
);
check("the quantity is not written", !("quantity" in gear.update.system));
check("a subtype annotation settled is not written", !("subtype" in gear.update.system));
const thrown = refreshPlan(
  { type: "weapon", system: { melee: true, missile: true, damage: "1d4" } },
  { type: "weapon", system: { melee: true, missile: false, damage: "1d6" } },
  REPAIR.equipment,
);
check("a weapon keeps its melee and missile", !("melee" in thrown.update.system) && !("missile" in thrown.update.system));
check("and takes its damage", thrown.update.system.damage === "1d6");
check("a read value is", gear.update.system.cost === 6);
check("an equipment marker is the binder's", gear.update.flags[M].light === true);
check("only the listed flags are written", !("minted" in gear.update.flags[M]));

/* --- a monster: stats, prose per field, minted attacks --------------------- */
const monsterSource = {
  type: "monster",
  system: { details: { morale: 2, xp: 50 }, hp: { hd: "2", value: 9, max: 9 } },
  items: [
    { _id: "mintedAttack0001", name: "Claw", flags: { [M]: { minted: true } } },
    { _id: "judgeAttack00001", name: "Club", flags: {} },
  ],
  flags: {
    [M]: {
      extras: {
        description: {
          appearance: stamped("Old look."),
          lore: `${stamped("Old lore.")}<p>The locals fear it.</p>`,
        },
        judgeKey: "kept",
      },
    },
  },
};
const monsterBuilt = {
  type: "monster",
  system: { details: { xp: 60 }, hp: { hd: "3", value: 13, max: 13 } },
  prototypeToken: { width: 2, height: 2 },
  items: [{ name: "Bite", type: "weapon", flags: { [M]: {} } }],
  flags: {
    [M]: {
      cookbook: { id: "mm.test", cite: "XX p.40", type: "beast" },
      extras: { description: { appearance: stamped("New look."), lore: stamped("New lore.") }, size: "large" },
    },
  },
};
const monster = refreshPlan(monsterSource, monsterBuilt, REPAIR.monster);
check("a stat the page no longer yields is retracted", monster.retract.includes("details.morale"));
check("a stat it yields is not", !monster.retract.includes("details.xp"));
check("the token is re-read", monster.update.prototypeToken.width === 2);
check("a stamped prose field is rewritten", /New look/.test(monster.update.flags[M].extras.description.appearance));
check("a prose field the Judge wrote in is kept", !("lore" in monster.update.flags[M].extras.description));
check("and reported by its flag path", monster.keptProse.includes("flags.extras.description.lore"));
check("only minted items are removed", monster.replace.items.remove.join() === "mintedAttack0001");
check("the build's items arrive minted", monster.replace.items.add[0].flags[M].minted === true);
const unstamped = refreshPlan(
  { ...monsterSource, items: [{ _id: "unstampedBite001", name: "Bite", type: "weapon", flags: {} }] },
  monsterBuilt,
  REPAIR.monster,
);
check(
  "an unstamped item of the build's type and name stands in for it",
  !unstamped.replace.items.add.length && !unstamped.replace.items.remove.length,
);

/* --- a class: rewritten whole, an effect a Judge took over stands --------- */
const KEYS = { weapons: `flags.${M}.weaponProf`, styles: `flags.${M}.styleProficient` };
const training = (id, minted, key = KEYS.weapons) => ({
  _id: id,
  name: "Training",
  changes: [{ key, type: "add", value: "all" }],
  flags: minted ? { [M]: { minted: true } } : {},
});
const classBuilt = {
  name: "Wanderer",
  type: "acks-extras.class",
  img: "modules/fixture/new.webp",
  system: { description: stamped("New class text."), levels: [{ level: 1 }] },
  effects: [training(undefined, true)],
  flags: { [M]: { cookbook: { id: "def.class.test", cite: "XX p.20" }, tongues: { race: "folk", parsed: true } } },
};
const classSource = (effects) => ({
  type: "acks-extras.class",
  name: "Wanderer (old)",
  system: { description: stamped("Old class text."), levels: [{ level: 1, judgeNote: "x" }] },
  effects,
});
const cls = refreshPlan(classSource([training("mintedEffect0001", true), training("judgeEffect00001", false, "flags.other.key")]), classBuilt, REPAIR.class);
check("a class takes the build's name and image", cls.update.name === "Wanderer" && cls.update.img === "modules/fixture/new.webp");
check("a class's rows are written as built", !("judgeNote" in cls.update.system.levels[0]));
check("the minted training is replaced", cls.replace.effects.remove.join() === "mintedEffect0001" && cls.replace.effects.add.length === 1);
check("the tongues flag is the binder's", cls.update.flags[M].tongues.race === "folk");
const taken = refreshPlan(classSource([training("judgeTraining001", false)]), classBuilt, REPAIR.class);
check("a training the Judge took over is not doubled", taken.replace.effects.add.length === 0);
check("and is not removed", taken.replace.effects.remove.length === 0);

/* --- the tally ------------------------------------------------------------ */
const tally = repairTally();
countRepair(tally, trap);
countRepair(tally, annotated);
countRepair(tally, "book-closed");
countRepair(tally, { refused: "type" });
check("the tally counts each outcome", tally.replaced === 2 && tally.keptProse === 1 && tally.refused === 2);
const doc = { uuid: "Item.a" };
check("a document is met once per tally", unrepaired(tally, doc) && !unrepaired(tally, doc) && !unrepaired(null, doc));
check("the counts leave the seen set out", JSON.stringify(repairCounts(tally)) === '{"replaced":2,"keptProse":1,"refused":2}');

console.log(`test-refresh: ${pass} passed`);
