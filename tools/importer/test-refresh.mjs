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
  actorPolicy,
  REPAIR,
  policyFor,
  decidedPolicy,
  handWrittenProse,
  repairTally,
  repairCounts,
  countRepair,
  unrepaired,
  asMinted,
  unstampedTwins,
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

/* --- a spell: play's counters stay; authored rows survive an empty build --- */
const spellSource = {
  type: "spell",
  system: { lvl: 1, class: "Arcane", cast: 2, memorized: true, favorite: true, description: stamped("Old text.") },
  flags: {
    [M]: {
      cookbook: { id: "def.spell.test" },
      spell: { lists: [{ source: "arcane", level: 1, classes: [] }], effects: [{ type: "damage", roll: "1d6" }], notableUse: "" },
    },
  },
};
const spellBuilt = {
  type: "spell",
  system: { lvl: 2, class: "Arcane", cast: 0, memorized: false, favorite: false, description: stamped("New text.") },
  flags: { [M]: { cookbook: { id: "def.spell.test" }, spell: { lists: [{ source: "arcane", level: 2, classes: [] }], effects: [] } } },
};
const spell = refreshPlan(spellSource, spellBuilt, REPAIR.spell);
check("the cast counter, the memorized mark and the star are play's", !("cast" in spell.update.system) && !("memorized" in spell.update.system) && !("favorite" in spell.update.system));
check("the level is re-read", spell.update.system.lvl === 2);
check("the primitive is rewritten", spell.update.flags[M].spell.lists[0].level === 2);
check("authored rows survive a build with none", spell.update.flags[M].spell.effects.length === 1 && spell.update.flags[M].spell.effects[0].roll === "1d6");
const spellRows = refreshPlan(spellSource, { ...spellBuilt, flags: { [M]: { spell: { effects: [{ type: "heal" }] } } } }, REPAIR.spell);
check("a build that carries rows writes them", spellRows.update.flags[M].spell.effects[0].type === "heal");
const spellLost = refreshPlan({ ...spellSource, flags: { [M]: {} } }, spellBuilt, REPAIR.spell);
check("nothing stored, nothing kept", spellLost.update.flags[M].spell.effects.length === 0);
const thrown = refreshPlan(
  { type: "weapon", system: { melee: true, missile: true, damage: { base: { formula: "1d4" } } } },
  { type: "weapon", system: { melee: true, missile: false, damage: { base: { formula: "1d6" } } } },
  REPAIR.equipment,
);
check("a weapon keeps its melee and missile", !("melee" in thrown.update.system) && !("missile" in thrown.update.system));
check("and takes its damage", thrown.update.system.damage.base.formula === "1d6");
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
const appearing = refreshPlan(
  { type: "monster", system: { details: { appearing: { d: "3d5", w: "2d7" } } }, flags: {} },
  { type: "monster", system: { details: { appearing: { d: "3", w: "" } } }, flags: {} },
  REPAIR.monster,
);
check("a corrected appearing formula is written", appearing.update.system.details.appearing.d === "3");
check("a formula the page's count no longer gives is written blank", appearing.update.system.details.appearing.w === "");

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

/* --- a forced repair: the prose guard is lifted, the rest stays ------------- */
const forcedMonster = refreshPlan(monsterSource, monsterBuilt, policyFor(REPAIR.monster, repairTally({ force: true })));
check("force: a prose field the Judge wrote in is rewritten", /New lore/.test(forcedMonster.update.flags[M].extras.description.lore));
check("force: nothing is reported kept", forcedMonster.keptProse.length === 0);
check("force: only minted items are still removed", forcedMonster.replace.items.remove.join() === "mintedAttack0001");
check("force: an unstamped item stays and stands in for the build's", forcedMonster.replace.items.add.length === 1 && !forcedMonster.replace.items.remove.includes("judgeAttack00001"));
check("policyFor leaves an ordinary tally's policy alone", policyFor(REPAIR.monster, repairTally()) === REPAIR.monster);
check("and a forced one's carries force, leaving REPAIR unfrozen of it", policyFor(REPAIR.monster, repairTally({ force: true })).force === true && !("force" in REPAIR.monster));
const judgedTrap = { ...trapSource, system: { ...trapSource.system, description: `${stamped("Old passage.")}<p>Seen it fail.</p>` } };
const heldTrap = refreshPlan(judgedTrap, trapBuilt, REPAIR.trap);
const forcedTrap = refreshPlan(judgedTrap, trapBuilt, policyFor(REPAIR.trap, repairTally({ force: true })));
check("an ordinary repair keeps a trap's hand-written description", heldTrap.keptProse.join() === "description" && !("description" in heldTrap.update.system));
check("force writes it", /New passage/.test(forcedTrap.update.system.description) && forcedTrap.keptProse.length === 0);
check("force still leaves the level in force", !("level" in forcedTrap.update.system));
const forceSpellStored = { type: "acks-extras.spell", system: { description: stamped("Old.") }, flags: { [M]: { spell: { effects: [{ id: "judge" }] } } } };
const forceSpellBuilt = { type: "acks-extras.spell", system: { description: stamped("New.") }, flags: { [M]: { spell: { effects: [] } } } };
const forcedSpell = refreshPlan(forceSpellStored, forceSpellBuilt, policyFor(REPAIR.spell, repairTally({ force: true })));
check("force still keeps effect rows a Judge authored where the build has none", forcedSpell.update.flags[M].spell.effects.length === 1);
const forcedClass = refreshPlan(
  { ...classSource([]), system: { description: stamped("Old."), levels: [{ level: 1, xp: 900, title: "Typed" }] } },
  { ...classBuilt, system: { description: stamped("New."), levels: [{ level: 1, xp: null, title: "" }] } },
  policyFor(REPAIR.class, repairTally({ force: true })),
);
check("force still keeps a level's experience and title the build could not read", forcedClass.update.system.levels[0].xp === 900 && forcedClass.update.system.levels[0].title === "Typed");
const forcedType = refreshPlan({ ...trapSource, type: "weapon" }, trapBuilt, policyFor(REPAIR.trap, repairTally({ force: true })));
check("force still refuses a document of another type", forcedType.refused === "type");
const forcedCounts = repairTally({ force: true });
forcedCounts.handMade = 2;
check("a forced tally's counts carry handMade, an ordinary one's do not", repairCounts(forcedCounts).handMade === 2 && !("handMade" in repairCounts(repairTally())));

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

/* --- table rows and whole-actor kinds ------------------------------------- */
const weaponStored = { type: "weapon", system: { description: stamped("Old."), equipped: true, damage: "1d4" }, flags: { [M]: { weapon: { mode: "a" } } } };
const weaponBuilt = { type: "weapon", system: { description: stamped("New."), equipped: false, damage: "1d6" }, flags: { [M]: { weapon: { mode: "b" } } } };
const weaponPlan = refreshPlan(weaponStored, weaponBuilt, REPAIR.weapon);
check("a weapon row takes the build's figures and keeps what is equipped", weaponPlan.update.system.damage === "1d6" && !("equipped" in weaponPlan.update.system));
check("a weapon row takes the build's structured mode", weaponPlan.update.flags[M].weapon.mode === "b");
const pricedPlan = refreshPlan({ type: "equipment", system: { quantity: 4, cost: 1 } }, { type: "equipment", system: { quantity: 1, cost: 2 } }, REPAIR.priced);
check("a priced row takes its cost and keeps its quantity", pricedPlan.update.system.cost === 2 && !("quantity" in pricedPlan.update.system));
const languagePlan = refreshPlan({ type: "acks-extras.language", flags: { [M]: { language: { family: "a" } } } }, { type: "acks-extras.language", flags: { [M]: { language: { family: "b" } } } }, REPAIR.language);
check("a language takes its taxonomy flag", languagePlan.update.flags[M].language.family === "b");

const actorBuilt = {
  type: "monster",
  system: { details: { biography: stamped("Bio.") } },
  flags: { [M]: { cookbook: { id: "x" }, extras: { a: 1 }, minted: true, kit: { b: 2 } } },
  prototypeToken: { name: "T" },
  items: [{ name: "Claw", type: "weapon" }],
};
const policy = actorPolicy(actorBuilt);
check("an actor policy writes the flags the build stamps and not its cookbook or minted marks", policy.flags.join() === "extras,kit");
check("an actor policy rewrites the biography, the token and the items", policy.prose[0] === "details.biography" && policy.top[0] === "prototypeToken" && policy.minted[0] === "items");
check("an actor policy replaces rows and takes the monster prose flags only with extras", policy.rows === "replace" && policy.proseFlags.length > 0);
const bare = actorPolicy({ type: "character", system: {}, flags: { [M]: { cookbook: { id: "y" } } } });
check("a build with nothing to write carries no flags, token, items or prose", bare.flags.length === 0 && bare.top.length === 0 && bare.minted.length === 0 && bare.prose.length === 0 && bare.proseFlags.length === 0);
const tableTally = repairTally({ force: true });
tableTally.tables = new Set(["priced"]);
check("a tally carries the table importers a run repairs, and counts skip it", tableTally.tables.has("priced") && !("tables" in repairCounts(tableTally)));

/* --- a decision meets the Judge's prose -------------------------------------- */
const judgedBio = `${stamped("Bio.")}<p>The Judge's line.</p>`;
const judgedSource = { name: "Kept", type: "monster", system: { details: { biography: judgedBio } }, flags: { [M]: { cookbook: { id: "x" }, extras: { a: 1 } } } };
const bioKey = "Actor.kept#system.details.biography";
const keptByDefault = decidedPolicy(judgedSource, actorBuilt, policyFor(policy, { force: true }), { uuid: "Actor.kept", cite: "XX p.9" });
check("with no decision a hand-written biography is an edit, held whatever the tally's force",
  keptByDefault.edits.length === 1 && keptByDefault.policy.force === false && keptByDefault.policy.prose.includes("details.biography"));
check("the edit names the document, the field, both values and the page",
  JSON.stringify(keptByDefault.edits[0]) === JSON.stringify({
    key: bioKey, uuid: "Actor.kept", name: "Kept", path: "system.details.biography", current: judgedBio, page: actorBuilt.system.details.biography, cite: "XX p.9",
  }));
check("and the plan it narrows writes no biography", !("biography" in (refreshPlan(judgedSource, actorBuilt, keptByDefault.policy).update.system?.details ?? {})));
const bioTaken = decidedPolicy(judgedSource, actorBuilt, policy, { uuid: "Actor.kept", decision: { take: new Set([bioKey]) } });
check("a decision that takes the key lifts its guard, and nothing is held", bioTaken.edits.length === 0 && !bioTaken.policy.prose.includes("details.biography"));
check("so the plan writes the page's biography", refreshPlan(judgedSource, actorBuilt, bioTaken.policy).update.system.details.biography === actorBuilt.system.details.biography);
check("a stamped block alone is no edit", decidedPolicy({ ...judgedSource, system: { details: { biography: stamped("Old.") } } }, actorBuilt, policy, {}).edits.length === 0);

/* --- items an import left unstamped: the build's own are adopted, a Judge's never --- */
{
  const attack = { name: "Axe", type: "weapon", system: { damage: { base: { formula: "1d6" } }, equipped: true, melee: true } };
  const build = [asMinted(attack)];
  check("asMinted stamps the module's minted mark and keeps the document's own flags",
    build[0].flags[M].minted === true && asMinted({ ...attack, flags: { other: { a: 1 }, [M]: { x: 1 } } }).flags.other.a === 1);
  const stored = (over = {}, id = "old00000000001") => ({ _id: id, ...attack, system: { ...attack.system, weight: 0, cost: 0 }, ...over });
  check("an unstamped item that still holds the build's figures is adopted, defaults beside them and all", unstampedTwins([stored()], build).join() === "old00000000001");
  check("one a Judge edited is left", unstampedTwins([stored({ system: { ...attack.system, damage: { base: { formula: "1d8" } } } })], build).length === 0);
  check("one of another name or type is left", unstampedTwins([stored({ name: "Mace" }), stored({ type: "feature" }, "old00000000002")], build).length === 0);
  check("a stamped item is not offered again", unstampedTwins([stored({ flags: { [M]: { minted: true } } })], build).length === 0);
  check("a build with no items adopts nothing", unstampedTwins([stored()], []).length === 0);
  const unstamped = { type: "monster", name: "Guard", system: {}, flags: { [M]: { cookbook: { id: "x" } } }, items: [stored()] };
  const keptAsIs = refreshPlan(unstamped, { type: "monster", system: {}, items: build }, actorPolicy({ items: build }));
  check("unstamped, the stored item stands in for the build's and is never refreshed", keptAsIs.replace.items.remove.length === 0 && keptAsIs.replace.items.add.length === 0);
  const adopted = refreshPlan({ ...unstamped, items: [stored({ flags: { [M]: { minted: true } } })] }, { type: "monster", system: {}, items: build }, actorPolicy({ items: build }));
  check("stamped, a repair removes it and adds the build's", adopted.replace.items.remove.join() === "old00000000001" && adopted.replace.items.add.length === 1);
  const judge = { _id: "mine0000000001", name: "Lantern", type: "item", system: {} };
  const both = refreshPlan({ ...unstamped, items: [stored({ flags: { [M]: { minted: true } } }), judge] }, { type: "monster", system: {}, items: build }, actorPolicy({ items: build }));
  check("and a Judge's own item stays", !both.replace.items.remove.includes("mine0000000001"));
}

console.log(`test-refresh: ${pass} passed`);
