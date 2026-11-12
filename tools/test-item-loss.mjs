/**
 * Item loss from damage: the budget a plan spends and what each write lands on
 * the item. Every figure, item and material below is INVENTED; none is read
 * off a page. The threshold is -9 with a step of 4, light ends at 2 stone and
 * heavy begins at 5, and a full stone costs 3 AC.
 *
 * Run: npm test
 */
import assert from "node:assert";

globalThis.acksExtras ??= {};
const SETTINGS_STATE = { overlayItemLoss: true };
// An interpolating mock: a format result carries its data, so a tooltip's
// parts can be asserted by name.
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
class StubApplicationV2 {
  constructor(options = {}) { this.options = options; }
  render() { return this; }
  close() { return this; }
}
globalThis.foundry = {
  utils: { deepClone: (x) => JSON.parse(JSON.stringify(x)), randomID: () => "rand0000", mergeObject: (a, b) => ({ ...a, ...b }) },
  data: { operators: { ForcedDeletion: class ForcedDeletion {} } },
  applications: {
    api: { ApplicationV2: StubApplicationV2, HandlebarsApplicationMixin: (Base) => class extends Base {}, DialogV2: class { static async prompt() { return null; } } },
    handlebars: { loadTemplates: () => {} },
    instances: new Map(),
  },
};

const S = new URL("../scripts/equipment/", import.meta.url);
const { planItemLoss } = await import(new URL("overlays/item-loss.mjs", S));
const { applyItemLoss, planMarkup } = await import(new URL("item-loss-flow.mjs", S));
const { loseArmourClass, setItemLossAc, clearScavenged, setScavenged, scavengeItem } = await import(new URL("actions.mjs", S));
const { itemLossAcOf } = await import(new URL("properties.mjs", S));
const { conditionOf } = await import(new URL("item-sheet/snapshot.mjs", S));
const { registerTable, unregisterTable, PRIORITY } = await import(new URL("../lib/tables.mjs", S));

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const FIGURES = { threshold: -9, step: 4, clothingStones: 1, lightMax: 2, heavyMin: 5, acPerStone: 3 };
registerTable({
  id: "equipment",
  tables: { itemLoss: FIGURES, itemLossMaterials: { fire: { materials: ["wood", "cloth", "leather"] } } },
}, { priority: PRIORITY.WORLD, source: "test" });

/** An item document that records its writes, the way the sheet's own writers see one. */
let writes = 0;
const doc = (name, w6, { type = "item", cat, material = "wood", ac = 0 } = {}) => {
  const flags = { material };
  if (cat) flags.lossCategory = cat;
  const system = { cost: 0, weight6: w6, quantity: { value: 1 } };
  if (type === "armor") Object.assign(system, { ac: { value: ac }, type: "heavy", equipped: false });
  return {
    id: name.replace(/\W/g, ""), name, type, system, _flags: flags, effects: [],
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
      }
    },
  };
};
const actorOf = (items) => ({
  items: Object.assign(items.slice(), { filter: (f) => items.filter(f), find: (f) => items.find(f), get: (id) => items.find((i) => i.id === id), size: items.length }),
});
const NO_LOADOUT = { handShields: [], armor: null };
const ids = (list) => list.map((e) => e.item.id).join();

// --- a light item is destroyed only when the budget covers it ------------------
// -13 hp risks 2 stone = 12 sixths.
const sack = doc("Sack", 6, { cat: "handsOrTorso" });
const crate = doc("Crate", 12, { cat: "inBackpack" });
const flask = doc("Flask", 1, { cat: "hangingFromPack" });
const front = planItemLoss(actorOf([sack, crate, flask]), NO_LOADOUT, { hp: -13, damageType: "fire" });
check("a risk of 2 stone from -13 hp", front.ready && front.stones === 2);
check("front: the first light item is destroyed whole", ids(front.destroyed) === "Sack");
check("front: the next light item, reached with less than its weight, is marred and survives", front.destroyed.length === 1 && ids(front.marred) === "Crate" && front.marred[0].damage6 === 6);
check("front: the budget ends at the marred item, so nothing after it is touched", front.damaged.length === 0 && !ids(front.destroyed).includes("Flask") && !ids(front.marred).includes("Flask"));

const rear = planItemLoss(actorOf([sack, crate, flask]), NO_LOADOUT, { hp: -13, damageType: "fire", fromRear: true });
check("rear: the smallest item goes first, then the next is reached with 11 of its 12 sixths", ids(rear.destroyed) === "Flask" && ids(rear.marred) === "Crate" && rear.marred[0].damage6 === 11);
check("rear: the budget ends there, so the last in the order is untouched", !ids(rear.destroyed).includes("Sack") && rear.damaged.length === 0);

const exact = planItemLoss(actorOf([doc("Tin", 6, { cat: "handsOrTorso" })]), NO_LOADOUT, { hp: -9, damageType: "fire" });
check("an item whose weight equals the budget left is destroyed, not marred", ids(exact.destroyed) === "Tin" && exact.marred.length === 0);

// --- a heavy item under one full stone has no effect ---------------------------
// -9 hp risks 1 stone = 6 sixths; a 4-sixths item leaves 2 for the armour.
const rag = doc("Rag", 4, { cat: "handsOrTorso" });
const plate = doc("Plate", 30, { type: "armor", cat: "armour", ac: 6, material: "leather" });
const thin = planItemLoss(actorOf([rag, plate]), NO_LOADOUT, { hp: -9, damageType: "fire" });
check("a heavy item takes the budget that is left, under one stone", ids(thin.damaged) === "Plate" && thin.damaged[0].damage6 === 2 && thin.damaged[0].stones === 0 && thin.damaged[0].acLost === 0);
writes = 0;
const thinApplied = await applyItemLoss(thin);
check("applying a plan whose only heavy damage is under a stone changes nothing on the armour", plate.system.ac.value === 6 && plate._flags.itemLossAc === undefined && plate._flags.scavenged === undefined);
check("and the result does not count it as damaged", thinApplied.applied && thinApplied.damaged === 0 && thinApplied.acLost === 0);
check("a marred item and an idle heavy item write nothing at all beyond the destroyed mark", writes === 1 && rag._flags.destroyed === true);
const none = await applyItemLoss(front);
check("a marred item is not written", none.destroyed === 1 && crate._flags.destroyed === undefined && crate.system.weight6 === 12);

const full = planItemLoss(actorOf([plate]), NO_LOADOUT, { hp: -13, damageType: "fire" });
check("two full stones of damage cost the figure per stone", full.damaged[0].stones === 2 && full.damaged[0].acLost === 6);

// --- the card shows both -------------------------------------------------------
const card = planMarkup(front, { damageType: "fire", fromRear: false, figures: FIGURES });
check("the card lists the marred item under its own heading, marked as having no effect", /itemLoss\.marredHead/.test(card) && /Crate/.test(card) && /itemLoss\.noEffect/.test(card));
check("the marred item's tooltip names its weight, the light bound and what was left", /marredTip/.test(card) && /&quot;left&quot;:1/.test(card) && /&quot;weight&quot;:2/.test(card) && /&quot;light&quot;:2/.test(card));
const idleCard = planMarkup(thin, { damageType: "fire", fromRear: false, figures: FIGURES });
check("a heavy item under a stone is marked as having no effect on the card", /Plate/.test(idleCard) && /itemLoss\.noEffect/.test(idleCard));

// --- item-loss AC survives a scavenged write -----------------------------------
const mail = doc("Mail", 30, { type: "armor", ac: 6 });
await loseArmourClass(mail, 2);
check("losing AC lowers the armour and is stored under its own flag", mail.system.ac.value === 4 && mail._flags.itemLossAc === 2 && itemLossAcOf(mail) === 2 && mail._flags.scavenged === undefined);
check("the baseline is kept so the loss can be undone", mail._flags.pristine?.ac === 6);

const rolled = await scavengeItem(mail, { roll: () => 1 });
check("rolling a scavenged condition keeps the item-loss AC", mail._flags.itemLossAc === 2 && mail.system.ac.value === Math.max(0, 6 + rolled.cond.ac - 2));
const rerolled = await scavengeItem(mail, { roll: () => 10 });
check("re-rolling it replaces the scavenged part and keeps the loss", mail._flags.itemLossAc === 2 && mail.system.ac.value === Math.max(0, 6 + rerolled.cond.ac - 2));
await setScavenged(mail, { labels: ["Worn"], damage: 0, attack: 0, initiative: 0, encumbrance: 0, ac: -1, breaks: false, cannotSneak: false, notes: [], valueMultiplier: 1 });
check("picking a condition keeps it too", mail._flags.itemLossAc === 2 && mail.system.ac.value === 3);

const view = conditionOf(mail, null);
check("the Durability tab reads the armour as damaged, now of full, with the loss counted", view.damaged === true && view.acNow === 3 && view.acFull === 6);
check("its AC tooltip names the full figure and each part", /acFull {"n":6}/.test(view.acTip) && /acScavenged {"n":-1}/.test(view.acTip) && /acItemLoss {"n":2,"cite":"[^"]*itemLoss\.byHand"}/.test(view.acTip));

await clearScavenged(mail);
check("clearing the scavenged condition leaves the item-loss AC and the baseline", mail._flags.scavenged === undefined && mail._flags.itemLossAc === 2 && mail.system.ac.value === 4 && mail._flags.pristine?.ac === 6);
const lossOnly = conditionOf(mail, null);
check("an armour with item loss alone is damaged, and its tooltip has no scavenged part", lossOnly.damaged === true && !/acScavenged/.test(lossOnly.acTip) && /acItemLoss/.test(lossOnly.acTip));

await loseArmourClass(mail, 9);
check("losses accumulate and the armour never goes below 0", mail._flags.itemLossAc === 11 && mail.system.ac.value === 0);
check("a loss of nothing, or on a non-armour, is refused", (await loseArmourClass(mail, 0)) === false && (await loseArmourClass(doc("Sack2", 6), 2)) === false && mail._flags.itemLossAc === 11);

await setItemLossAc(mail, 0);
check("setting the loss to 0 restores the armour and drops the baseline", mail.system.ac.value === 6 && mail._flags.itemLossAc === undefined && mail._flags.pristine === undefined);
check("a clean armour is not damaged", conditionOf(mail, null).damaged === false);

registerTable({
  id: "equipment",
  cites: { itemLoss: "XX p. 1" },
  tables: { itemLoss: FIGURES, itemLossMaterials: { fire: { materials: ["wood"] } } },
}, { priority: PRIORITY.WORLD, source: "test" });
await loseArmourClass(mail, 1);
check("with the figures imported the item-loss part cites the page they were read from", /"cite":"XX p\. 1"/.test(conditionOf(mail, null).acTip));
await setItemLossAc(mail, 0);

unregisterTable("equipment", { priority: PRIORITY.WORLD });
console.log(`test-item-loss: ${pass} checks passed`);
