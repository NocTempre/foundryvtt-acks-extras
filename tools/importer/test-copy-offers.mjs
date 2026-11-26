/**
 * What a repair offers a copy outside the library (`scripts/importer/copy-offers.mjs`):
 * the library document's fields the repair changed, on a copy that still
 * holds them as the library had them, and how `mergedRepair` puts the offer and
 * writes the ticked ones. Every document and value is invented. No Foundry.
 */
import assert from "node:assert";
import { leafMap, sharedFields, copyUpdate } from "../../scripts/importer/copy-offers.mjs";
import { mergedRepair } from "../../scripts/importer/merged-repair.mjs";
import { mergedTally, repairWrite } from "../../scripts/importer/refresh.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

const before = { name: "Lamp", img: "pictures/old.webp", system: { cost: { gp: 5 }, tags: ["a"], blank: {}, quantity: 1 } };
const after = { name: "Lamp", img: "pictures/new.webp", system: { cost: { gp: 7 }, tags: ["a", "b"], blank: {}, quantity: 1 } };

/* --- the leaves --- */
{
  const leaves = leafMap(before);
  ok("name, picture and system leaves are read by dotted path, an array as one leaf", [...leaves.keys()].join() === "name,img,system.cost.gp,system.tags,system.blank,system.quantity");
  ok("an empty object is a leaf of its own", leaves.get("system.blank") && Object.keys(leaves.get("system.blank")).length === 0);
  ok("a key with a dot in it names no path and is left out", ![...leafMap({ system: { "a.b": 1, c: 2 } }).keys()].some((k) => k.includes("a.b")));
}

/* --- the fields a copy is offered --- */
{
  ok("a copy that still holds what the library held is offered what the repair changed, and nothing else",
    sharedFields(structuredClone(before), before, after).join() === "img,system.cost.gp,system.tags");
  const edited = structuredClone(before);
  edited.system.cost.gp = 9;
  edited.name = "Mine";
  ok("a field the copy's owner changed is not offered, nor is one the repair left alone", sharedFields(edited, before, after).join() === "img,system.tags");
  ok("a copy with nothing left unchanged is offered nothing", sharedFields({ name: "Z", img: "x.webp", system: { cost: { gp: 1 }, tags: [] } }, before, after).length === 0);
  ok("a library document the repair did not change offers nothing", sharedFields(structuredClone(before), before, structuredClone(before)).length === 0);
  ok("a leaf the library no longer holds is not offered", !sharedFields(structuredClone(before), before, { name: "Lamp", img: "pictures/old.webp", system: { quantity: 1 } }).includes("system.cost.gp"));
  const update = copyUpdate(["img", "system.tags"], after);
  ok("the update writes the library's value at each path alone", JSON.stringify(update) === JSON.stringify({ img: "pictures/new.webp", "system.tags": ["a", "b"] }) && update["system.tags"] !== after.system.tags);
}

/* --- the snapshot is taken before the write --- */
{
  const seen = [];
  const doc = {
    uuid: "Compendium.fixture.shelf.Item.lib1", documentName: "Item", type: "weapon", name: "Lamp", toObject: () => structuredClone(before),
    async update(u) { seen.push(["update", u]); },
  };
  const tally = mergedTally("keep");
  tally.snapshot = (d) => seen.push(["snapshot", d.toObject().system.cost.gp]);
  await repairWrite(doc, { type: "weapon", name: "Lamp", system: { cost: { gp: 7 } } }, {}, tally);
  ok("a library document is recorded as it stood just before its first write", seen.map((s) => s[0]).join() === "snapshot,update" && seen[0][1] === 5, JSON.stringify(seen));
}

/* --- the repair puts the offer and writes the ticked copies --- */
{
  const rows = [{ uuid: "Actor.c1", name: "Mine", library: { name: "Lamp" }, paths: ["img"] }, { uuid: "Actor.c2", name: "Yours", library: { name: "Lamp" }, paths: ["system.cost.gp"] }];
  const calls = [];
  const copies = { offer: async () => (calls.push("offer"), rows), bring: async (uuids) => (calls.push(`bring:${[...uuids].join()}`), uuids.size) };
  const pass = async () => (calls.push("pass"), { scope: "invented" });
  let asked = null;
  const out = await mergedRepair({ pass, copies, choose: async (edits, more) => ((asked = more), { take: new Set(), pregens: new Map(), copies: new Set(["Actor.c2"]), all: "take" }) });
  ok("a repair with nothing held asks when a copy is offered, handing the rows over", asked?.copies?.length === 2 && asked.pregens.length === 0 && calls[1] === "offer", calls.join());
  ok("it brings the ticked copy after the last pass and counts it", calls.join() === "pass,offer,bring:Actor.c2" && out.brought === 1, calls.join());
  calls.length = 0;
  const none = await mergedRepair({ pass, copies, choose: async () => ({ take: new Set(), pregens: new Map(), copies: new Set() }) });
  ok("an answer ticking none brings none", none.brought === 0 && !calls.some((c) => c.startsWith("bring")));
  calls.length = 0;
  const closed = await mergedRepair({ pass, copies, choose: async () => null });
  ok("a closed dialog brings none", closed.brought === 0 && !calls.some((c) => c.startsWith("bring")));
  calls.length = 0;
  const told = await mergedRepair({ pass, copies, decision: "take", choose: async () => assert.fail("asked") });
  ok("a caller's word decision asks nothing and offers nothing", told.brought === 0 && !calls.includes("offer"));
  const plain = await mergedRepair({ pass });
  ok("a repair with no registry reports none brought", plain.brought === 0);
}

console.log(`test-copy-offers: ${pass} checks passed.`);
