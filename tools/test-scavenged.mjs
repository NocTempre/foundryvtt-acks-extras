/**
 * Scavenged equipment: the condition grids and the penalty floor are the
 * Judge's own imported tables, and nothing stands in for one that is absent.
 * Every label, band, effect, percentage and floor below is INVENTED; none is
 * read off a page. The invented bands are 1, 2-8, 9-12, 13-17 and 18-20 on
 * every grid, and the invented penalty floor is -3.
 *
 * Run: npm test
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
const SETTINGS_STATE = { overlayScavenged: true };
globalThis.game = {
  settings: { get: (_m, k) => SETTINGS_STATE[k] },
  i18n: {
    has: () => false,
    localize: (x) => x,
    format: (k, d = {}) => (Object.keys(d).length ? `${k} ${JSON.stringify(d)}` : k),
  },
  modules: { get: () => ({ active: false }) },
  users: { activeGM: null },
};
const warned = [];
globalThis.ui = { notifications: { warn: (m) => warned.push(m), info: () => {} } };
class StubApplicationV2 {
  constructor(options = {}) { this.options = options; }
  render() { return this; }
  close() { return this; }
}
globalThis.foundry = {
  utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), randomID: () => "rand0000", mergeObject: (a, b) => ({ ...a, ...b }) },
  data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
  applications: {
    api: { ApplicationV2: StubApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: class DialogV2 {} },
    handlebars: { loadTemplates: () => {} },
    instances: new Map(),
  },
};

const S = new URL("../scripts/equipment/", import.meta.url);
const scav = await import(new URL("overlays/scavenged.mjs", S));
const { scavengeItem, scavengedOptions, setScavengedRow, rollScavengedD20s, clearScavenged } = await import(new URL("actions.mjs", S));
const { registerTable, unregisterTable, PRIORITY } = await import(new URL("../lib/tables.mjs", S));

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/** An item that records its writes, the way the sheet's own writers see one. */
let writes = 0;
const doc = (name, type, system) => {
  const flags = {};
  return {
    id: name, name, type, system, _flags: flags, effects: [],
    getFlag(_m, k) { return this._flags[k]; },
    async setFlag(_m, k, v) { writes++; this._flags[k] = v; },
    async unsetFlag(_m, k) { writes++; delete this._flags[k]; },
    async update(u) {
      writes++;
      for (const [path, v] of Object.entries(u)) {
        if (path.startsWith("flags.acks-extras.")) this._flags[path.slice("flags.acks-extras.".length)] = v;
        else if (path === "system.ac.value") this.system.ac.value = v;
        else if (path === "system.weight6") this.system.weight6 = v;
        else if (path === "system.cost") this.system.cost = v;
        else if (path === "system.bonus.attack") this.system.bonus.attack = v;
        else if (path === "system.damage.base.formula") this.system.damage.base.formula = v;
      }
    },
  };
};
const armour = () => doc("Mail", "armor", { cost: 60, weight6: 30, quantity: { value: 1 }, ac: { value: 6 }, type: "heavy", equipped: false });
const blade = () => doc("Blade", "weapon", { cost: 10, weight6: 6, quantity: { value: 1 }, damage: { base: { formula: "1d6" } }, bonus: { attack: 0 }, melee: true });

const row = (category, effect, value, min, max) => ({ category, effect, value, min, max });
const REROLL = (min, max) => row("Roll again twice", "-", "-", min, max);
const SCAVENGED_DOC = {
  id: "equipment",
  source: { pages: "Invented 1" },
  cites: { scavengedPiercingSlashing: "Invented 2" },
  tables: {
    scavengedPiercingSlashing: {
      1: row("Alpha", "-", "100%", 1, 1),
      8: row("Beta", "-2 damage", "-50%", 2, 8),
      12: row("Gamma", "-2 to attacks", "-50%", 9, 12),
      17: row("Delta", "-3 to initiative", "-50%", 13, 17),
      20: REROLL(18, 20),
    },
    scavengedArmorEquipment: {
      1: row("Alpha", "-", "100%", 1, 1),
      8: row("Beta", "+2 stone encumbrance", "-50%", 2, 8),
      12: row("Gamma", "Cannot sneak", "-50%", 9, 12),
      17: row("Delta", "-2 AC / breaks", "-50%", 13, 17),
      20: REROLL(18, 20),
    },
  },
};
const withCaps = (penalty) => ({ id: "equipment", tables: { scavengedCaps: { penalty } } });
const WORLD = { priority: PRIORITY.WORLD, source: "test" };
const clearAll = () => {
  for (const priority of Object.values(PRIORITY)) unregisterTable("equipment", { priority });
};

/* ---------------------------------------------------------------------- */
/*  Nothing imported: no rows, no roll, no figure                         */
/* ---------------------------------------------------------------------- */

clearAll();
check("with no ruledata the imported table is null", scav.importedTable("piercingSlashing") === null);
check("with no table the control offers no rows", scavengedOptions("piercingSlashing").length === 0 && scavengedOptions("armourEquipment").length === 0);
check("the source reads as not imported", scav.scavengedSource("armourEquipment").state === "none" && scav.scavengedSource("armourEquipment").cite === null);
check("with no cap imported there is no floor", scav.scavengedPenaltyFloor() === null);
check("an unknown table key has no rows", scavengedOptions("nope").length === 0 && scav.importedTable("nope") === null);

const mail = armour();
writes = 0;
check("a roll with no table returns nothing", (await scavengeItem(mail, { roll: () => 5 })) === null);
check("and says nothing", warned.length === 0);
check("and writes nothing to the item", writes === 0 && mail._flags.scavenged === undefined && mail._flags.pristine === undefined && mail.system.ac.value === 6);
check("picking a row with no table refuses and writes nothing", (await setScavengedRow(mail, "armourEquipment", 8)) === null && writes === 0);
check("a roll is one d20 with no table to spawn another", JSON.stringify(rollScavengedD20s("piercingSlashing", () => 19)) === "[19]");

// A document that holds other tables but not these is the same absence.
registerTable({ id: "equipment", tables: { itemLoss: { threshold: -1 } } }, WORLD);
check("an equipment document without the grids still offers none", scavengedOptions("armourEquipment").length === 0 && scav.scavengedSource("armourEquipment").state === "none");
check("and still has no floor", scav.scavengedPenaltyFloor() === null);
clearAll();

/* ---------------------------------------------------------------------- */
/*  An imported table: rows, rolls, accumulation                           */
/* ---------------------------------------------------------------------- */

registerTable(SCAVENGED_DOC, WORLD);
const opts = scavengedOptions("piercingSlashing");
check("the options are the imported rows in d20 order, the reroll row left out", opts.map((o) => o.label).join() === "Alpha,Beta,Gamma,Delta" && opts.map((o) => o.value).join() === "1,8,12,17");
check("a table is chosen per item kind", scav.tableFor(blade(), { type: "slashing" }) === "piercingSlashing" && scav.tableFor(mail, {}) === "armourEquipment");
check("rolls expand from the imported reroll row, in order", JSON.stringify(rollScavengedD20s("piercingSlashing", (() => { const a = [19, 3, 14]; let i = 0; return () => a[i++]; })())) === "[19,3,14]");
check("a non-reroll first roll is one d20", JSON.stringify(rollScavengedD20s("piercingSlashing", () => 5)) === "[5]");
check("the source names the page the importer recorded", scav.scavengedSource("piercingSlashing").state === "page" && scav.scavengedSource("piercingSlashing").cite === "Invented 2");
check("a grid with no recorded page of its own takes the document's pages", scav.scavengedSource("armourEquipment").cite === "Invented 1");
check("a grid the document lacks is not imported, beside ones that are", scav.scavengedSource("bludgeoning").state === "none" && scavengedOptions("bludgeoning").length === 0);

const acc = scav.accumulateImported("piercingSlashing", [18, 5, 14]);
check("accumulation applies each landed row and skips the reroll row", acc.labels.join() === "Beta,Delta" && acc.damage === -2 && acc.initiative === -3);
check("the resale fractions multiply", Math.abs(acc.valueMultiplier - 0.25) < 1e-9);
check("a roll in no band contributes nothing", scav.accumulateImported("piercingSlashing", [99]).labels.length === 0);
check("a placeholder row is neither offered nor landed on", (() => {
  unregisterTable("equipment", { priority: PRIORITY.WORLD });
  registerTable({ id: "equipment", tables: { scavengedPiercingSlashing: { ...SCAVENGED_DOC.tables.scavengedPiercingSlashing, 8: { __missing: true } } } }, WORLD);
  const o = scavengedOptions("piercingSlashing");
  const landed = scav.accumulateImported("piercingSlashing", [5]).labels.length;
  unregisterTable("equipment", { priority: PRIORITY.WORLD });
  registerTable(SCAVENGED_DOC, WORLD);
  return o.map((x) => x.label).join() === "Alpha,Gamma,Delta" && landed === 0;
})());

/* ---------------------------------------------------------------------- */
/*  The penalty floor: imported, a Judge's, or absent                      */
/* ---------------------------------------------------------------------- */

const seven = [10, 10, 10, 10, 10, 10, 10];
check("with no floor imported, attack penalties stack without bound", scav.accumulateImported("piercingSlashing", seven).attack === -14);
registerTable(withCaps(-3), { priority: PRIORITY.CATALOG, source: "test-caps" });
check("an imported floor is read", scav.scavengedPenaltyFloor() === -3);
check("attack penalties stop at it", scav.accumulateImported("piercingSlashing", seven).attack === -3);
check("armour class penalties stop at it", scav.accumulateImported("armourEquipment", [15, 15, 15]).ac === -3);
check("a penalty inside the floor is untouched", scav.accumulateImported("piercingSlashing", [10]).attack === -2 && scav.accumulateImported("armourEquipment", [15]).ac === -2);
check("the floor does not touch damage, initiative or encumbrance", scav.accumulateImported("piercingSlashing", [5, 5, 5]).damage === -6 && scav.accumulateImported("piercingSlashing", [15, 15, 15, 15]).initiative === -12 && scav.accumulateImported("armourEquipment", [5, 5, 5]).encumbrance === 6);

registerTable(withCaps(2), { priority: PRIORITY.OVERRIDE });
check("a Judge's override wins, and either sign is a floor", scav.scavengedPenaltyFloor() === -2 && scav.accumulateImported("piercingSlashing", seven).attack === -2);
registerTable(withCaps(""), { priority: PRIORITY.OVERRIDE });
check("an override left blank reads as not imported", scav.scavengedPenaltyFloor() === null);
registerTable(withCaps("many"), { priority: PRIORITY.OVERRIDE });
check("an override that is no number reads as not imported", scav.scavengedPenaltyFloor() === null);
unregisterTable("equipment", { priority: PRIORITY.OVERRIDE });
check("removing the override returns the imported floor", scav.scavengedPenaltyFloor() === -3);

// An override of one grid replaces that grid and is named as the Judge's.
registerTable({ id: "equipment", tables: { scavengedPiercingSlashing: { 20: row("Only", "-", "100%", 1, 20) } } }, { priority: PRIORITY.OVERRIDE });
check("a Judge's grid override is what the control offers", scavengedOptions("piercingSlashing").map((o) => o.label).join() === "Only");
check("and is named as set by hand, with no page", scav.scavengedSource("piercingSlashing").state === "judge" && scav.scavengedSource("piercingSlashing").cite === null);
check("the other grids keep their page", scav.scavengedSource("armourEquipment").state === "page");
unregisterTable("equipment", { priority: PRIORITY.OVERRIDE });
check("reverting the override restores the imported rows", scavengedOptions("piercingSlashing").length === 4 && scav.scavengedSource("piercingSlashing").state === "page");

/* ---------------------------------------------------------------------- */
/*  Writes: a roll and a pick land on the item's own fields                */
/* ---------------------------------------------------------------------- */

warned.length = 0;
const rolled = await scavengeItem(mail, { roll: () => 15 });
check("an armour roll returns the rolls and the condition", rolled?.rolls.join() === "15" && rolled.tableKey === "armourEquipment" && rolled.cond.ac === -2 && rolled.cond.breaks === true);
check("it takes armour class off the item and flags the break for the Judge", mail.system.ac.value === 4 && mail._flags.scavenged?.breaks === true && warned.length === 0);
check("the resale fraction is stamped", mail._flags.scavenged.valueMultiplier === 0.5 && mail.system.cost === 30);
await scavengeItem(mail, { roll: () => 10 });
check("a re-roll starts from pristine", mail.system.ac.value === 6 && mail._flags.scavenged.cannotSneak === true);
const picked = await setScavengedRow(mail, "armourEquipment", 8);
check("picking a row applies its effects", picked?.encumbrance === 2 && mail.system.weight6 === 42);
await clearScavenged(mail);
check("clearing restores the item and drops the baseline", mail.system.ac.value === 6 && mail.system.weight6 === 30 && mail.system.cost === 60 && mail._flags.pristine === undefined);

const sword = blade();
await scavengeItem(sword, { roll: () => 5 });
check("a weapon roll puts the damage penalty on its formula", /1d6\s*-\s*2/.test(sword.system.damage.base.formula));
await clearScavenged(sword);
const spawned = (() => { const a = [19, 5, 10]; let i = 0; return () => a[i++]; })();
const stack = await scavengeItem(sword, { roll: spawned });
check("a reroll row spawns two more rolls and all three accumulate", stack.rolls.join() === "19,5,10" && stack.cond.damage === -2 && stack.cond.attack === -2);
check("the weapon carries the attack penalty and the damage penalty", sword.system.bonus.attack === -2 && /1d6\s*-\s*2/.test(sword.system.damage.base.formula));
await clearScavenged(sword);

clearAll();
console.log(`test-scavenged: ${pass} checks passed.`);
