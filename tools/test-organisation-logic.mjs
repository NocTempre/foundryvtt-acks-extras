/**
 * Offline tests for the monsters feature's reading of outside references and,
 * layered on the recipe evaluator, its optional organisation rules. Foundry-free
 * and book-free: every creature word, library entry, breed, band, rank, figure
 * and page reference below is invented. What this pins is the procedure: a
 * printed word resolves to a library entry only on equality of folded tokens
 * with exactly one entry, a word the page leaves a qualifier or a category out
 * of is a finding with candidates and never a guess, a table cell reads into a
 * part of the table's own with the word kept for the resolver.
 *
 * Run: node tools/test-organisation-logic.mjs
 */
import assert from "node:assert/strict";
import {
  QUALIFIERS, REFERENCE, beastCellPart, foldTokens, readBeastCell, readMountCell, resolveOutside, resolveParts,
} from "../scripts/monsters/outside-reference.mjs";
import { SPECIAL, planOrganisationRoll, protoKey, rollBanded, withTableVillage } from "../scripts/monsters/organisation-logic.mjs";
import { planRoll } from "../scripts/lib/org-write-logic.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const LIBRARY = [
  { name: "Quux", uuid: "L.quux" },
  { name: "Zorp, Blue", uuid: "L.zorpBlue" },
  { name: "Zorp, Red", uuid: "L.zorpRed" },
  { name: "Mog, Grey Flim", uuid: "L.mogFlim" },
  { name: "Gleaf", uuid: "L.gleaf" },
  { name: "Nib Gleaf", uuid: "L.nibGleaf" },
];

/* -------------------------------------------- */
/*  The resolver                                 */
/* -------------------------------------------- */

t("a fold ignores case, punctuation, word order and a plural", () => {
  assert.deepEqual(foldTokens("Zorp, Blue"), foldTokens("blue zorps"));
  assert.deepEqual(foldTokens("QUUXES"), foldTokens("quux"));
  assert.deepEqual(foldTokens("gleaves"), foldTokens("Gleaf"), "ves folds to f");
  assert.deepEqual(foldTokens("trained quuxes", QUALIFIERS), ["quux"], "a qualifier word is dropped");
  assert.deepEqual(foldTokens("trained quuxes", []), ["quux", "trained"], "unless the caller lists none");
});

t("one entry of equal tokens resolves, whatever the order the page prints", () => {
  const hit = resolveOutside("trained blue zorps", LIBRARY);
  assert.equal(hit.status, REFERENCE.resolved);
  assert.equal(hit.entry.uuid, "L.zorpBlue");
  assert.equal(resolveOutside("quuxes", LIBRARY).entry.uuid, "L.quux");
  assert.equal(resolveOutside("gleaves", LIBRARY).entry.uuid, "L.gleaf", "an entry that merely contains the word does not outrank the equal one");
});

t("two entries of one fold are never picked between", () => {
  const twins = [...LIBRARY, { name: "quux", uuid: "L.quuxTwin" }];
  const hit = resolveOutside("quuxes", twins);
  assert.equal(hit.status, REFERENCE.ambiguous);
  assert.equal(hit.entry, null);
  assert.deepEqual(hit.candidates.map((e) => e.uuid).sort(), ["L.quux", "L.quuxTwin"]);
});

t("a word the page leaves a qualifier out of is a finding with its candidates, not a resolution", () => {
  const hit = resolveOutside("zorps", LIBRARY);
  assert.equal(hit.status, REFERENCE.partial);
  assert.equal(hit.entry, null, "two entries carry the word and more: none is chosen");
  assert.deepEqual(hit.candidates.map((e) => e.uuid).sort(), ["L.zorpBlue", "L.zorpRed"]);
});

t("a word whose entry is filed under a category word the page leaves out is a finding, however alone it is", () => {
  const hit = resolveOutside("grey flims", LIBRARY);
  assert.equal(hit.status, REFERENCE.partial);
  assert.equal(hit.entry, null, "a category word is never invented to make it match");
  assert.deepEqual(hit.candidates.map((e) => e.uuid), ["L.mogFlim"]);
});

t("a word nothing answers is none, and a blank or all-qualifier word answers none", () => {
  assert.equal(resolveOutside("narg", LIBRARY).status, REFERENCE.none);
  assert.equal(resolveOutside("", LIBRARY).status, REFERENCE.none);
  assert.equal(resolveOutside("trained", LIBRARY).status, REFERENCE.none);
  assert.equal(resolveOutside("quux", []).status, REFERENCE.none);
  assert.equal(resolveOutside("quux", null).status, REFERENCE.none);
});

t("parts: a word resolves, a linked part answers its link, a Role cell and a captive part are no reference", () => {
  const part = (key, source, role = "guard") => ({ key, role, source: { uuid: "", templateCell: "", stat: "", name: "", ...source } });
  const parts = [
    part("a", { name: "blue zorps" }),
    part("b", { name: "zorps" }),
    part("c", { name: "whatever", uuid: "L.hand" }),
    part("d", { templateCell: "alba|champion" }),
    part("e", { name: "enslaved folk" }, "captive"),
    part("f", {}),
  ];
  const out = resolveParts(parts, LIBRARY);
  assert.deepEqual(out.map((r) => r.part.key), ["a", "b", "c"]);
  assert.deepEqual(out.map((r) => [r.status, r.uuid]), [[REFERENCE.resolved, "L.zorpBlue"], [REFERENCE.partial, ""], [REFERENCE.resolved, "L.hand"]]);
});

/* -------------------------------------------- */
/*  The cells                                    */
/* -------------------------------------------- */

t("a beast cell reads its chance, count and word, whatever the filler word", () => {
  assert.deepEqual(readBeastCell("60% chance for 4d6 quuxes"), { kind: "beast", chance: 60, count: { dice: "4d6" }, word: "quuxes", perUnit: "" });
  assert.deepEqual(readBeastCell("50% chance 1d4+1 gleaves"), { kind: "beast", chance: 50, count: { dice: "1d4+1" }, word: "gleaves", perUnit: "" });
  assert.deepEqual(readBeastCell("3 zorps"), { kind: "beast", chance: null, count: { literal: 3 }, word: "zorps", perUnit: "" });
});

t("an extra-rank cell and a per-unit cell read to their kinds, and every other cell reads null", () => {
  assert.equal(readBeastCell("5d4 extra champions").kind, "extra");
  const per = readBeastCell("50% chance for 1d10 per band");
  assert.equal(per.kind, "perUnit");
  assert.equal(per.perUnit, "band");
  for (const none of ["None", "none", "-", "", null, undefined, "75% chance (level 1d6)", "100% (fight as qq)", "100% (do not fight)", "plain words"]) {
    assert.equal(readBeastCell(none), null, `${none} is no beast cell`);
  }
});

t("a beast cell becomes a part of the table's own, its word kept and no uuid", () => {
  const p = beastCellPart({ key: "village-beast-1", text: "60% chance for 2d6 zorps", variant: "alba", units: ["hamlet"], cite: "XX p. 9" });
  assert.equal(p.basis, "table");
  assert.equal(p.role, "guard");
  assert.deepEqual([p.source.name, p.source.uuid, p.source.templateCell], ["zorps", "", ""]);
  assert.equal(p.count.dice, "2d6");
  assert.equal(p.chance, 60);
  assert.deepEqual(p.when.units, ["hamlet"]);
  assert.equal(p.cite, "XX p. 9");
});

t("an extra-rank cell names the breed's Role cell, and a cell that is no beast makes no part", () => {
  const p = beastCellPart({ key: "k", text: "5d4 extra champions", variant: "alba", units: ["hamlet"] });
  assert.equal(p.source.templateCell, "alba|champion");
  assert.equal(p.source.name, "");
  assert.equal(beastCellPart({ key: "k", text: "5d4 extra zorp-lords", variant: "alba", units: [] }), null, "a rank the importer's vocabulary does not know");
  assert.equal(beastCellPart({ key: "k", text: "50% chance for 1d10 per band", variant: "alba", units: [] }), null);
  assert.equal(beastCellPart({ key: "k", text: "None", variant: "alba", units: [] }), null);
});

t("a mount cell names the creature a breed rides, or the one fighting beside it, or none", () => {
  const row = { mounts: { alba: "gleaves" }, alongside: { brex: "zorps" } };
  assert.deepEqual(readMountCell(row, "alba"), { word: "gleaves", rides: true });
  assert.deepEqual(readMountCell(row, "brex"), { word: "zorps", rides: false });
  assert.equal(readMountCell(row, "cyth"), null);
  assert.equal(readMountCell(null, "alba"), null);
});

/* -------------------------------------------- */
/*  The organisation roll                        */
/* -------------------------------------------- */

const steady = () => 0.2;
const high = () => 0.7;
const ENCOUNTER = {
  dungeon: { wandering: { noun: "Cell", number: "2d4", unit: "" }, lair: { noun: "Den", number: "1", unit: "band" } },
  wilderness: { wandering: { noun: "Band", number: "1d6", unit: "cells" }, lair: { noun: "Hold", number: "1d10", unit: "bands" } },
  lairChance: 40,
};
const part = (key, role, over = {}) => ({
  key, label: key, role,
  source: { uuid: "", templateCell: "", stat: "", name: "", ...(over.source ?? {}) },
  count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", ...(over.count ?? {}) },
  chance: over.chance ?? null,
  when: { state: "", place: "", units: [], ...(over.when ?? {}) },
  branch: { group: "", band: "", ...(over.branch ?? {}) },
  moraleWhileAlive: over.moraleWhileAlive ?? null, cite: "XX p. 1", basis: "page",
});
const RECIPE = [
  part("archers", "body", { count: { ratioOf: "unit", percent: 50, round: "up" }, when: { units: ["cell", "band"] } }),
  part("warriors", "body", { count: { ratioOf: "unit", percent: 50, round: "down" }, when: { units: ["cell", "band"] } }),
  part("leader-a", "leader", { source: { templateCell: "alba|a" }, count: { literal: 1 }, when: { units: ["cell"] } }),
  part("leader-b", "leader", { source: { templateCell: "alba|b" }, count: { literal: 1 }, when: { units: ["band"] } }),
  part("leader-c", "leader", { source: { templateCell: "alba|c" }, count: { literal: 1 }, when: { units: ["den", "hold"] }, moraleWhileAlive: 2 }),
  part("escort", "guard", { source: { templateCell: "alba|a" }, count: { dice: "2d4" }, when: { units: ["hold"] } }),
  part("guard-1", "guard", { source: { name: "gleaves" }, count: { dice: "2d4" }, chance: 60, when: { units: ["hold"] } }),
  part("guard-2", "guard", { source: { name: "zorps" }, count: { dice: "1d4" }, chance: 60, when: { units: ["hold"] } }),
  part("captives", "captive", { source: { name: "folk" }, count: { dice: "1d10", perUnit: "band" }, chance: 50, when: { units: ["hold"] } }),
];
const band = (min, max) => ({ min, max });
const ORG = {
  village: { rows: [
    { key: "beasts", label: "Beasts", cells: { alba: "60% chance for 3d4 quuxes", brex: "None" } },
    { key: "prisoners", label: "Prisoners", cells: { alba: "40% chance for 2d4 per band" } },
    { key: "females", label: "Females", cells: { alba: "100% (fight as qq)" } },
  ], cite: "XX p. 3" },
  troops: { rows: [{ key: "t1", label: "T1", cells: { alba: band(1, 50) } }, { key: "t2", label: "T2", cells: { alba: band(51, 100) } }], cite: "XX p. 4" },
  traits: { rows: [{ key: "x1", label: "X1", cells: { alba: band(1, 60) } }, { key: "x2", label: "X2", cells: { alba: band(61, 100) } }], cite: "XX p. 5" },
  troopRules: { rows: [
    { key: "t1", label: "T1", figures: { mounts: { alba: "gleaves" }, carry: { g1: 100 } } },
    { key: "t2", label: "T2", figures: { alongside: { alba: "zorps" } } },
  ] },
  traitRules: { rows: [{ key: "x1", label: "X1", figures: { beastDice: "2d4" }, cite: "XX p. 5" }, { key: "x2", label: "X2", figures: {} }] },
  equipment: { rows: [
    { key: "g1", label: "G1", figures: { ranks: ["b"], troops: ["t1"], carry: [{ pct: 100 }] } },
    { key: "g2", label: "G2", figures: { ranks: ["c"], carry: [{ pct: 100, scope: "hold" }] } },
    { key: "g3", label: "G3", figures: { ranks: ["a"], carry: [{ pct: 20, perHitDie: true }] } },
  ] },
  organisation: { figures: { archerShare: 40, archerRound: "down", warriorShare: 40, warriorRound: "down", specialShare: 20, specialRound: "up", commonWarrior: 100, commonLeaderPerHd: 40 } },
};
const LIB = [{ name: "Gleaf", uuid: "L.gleaf" }, { name: "Zorp, Blue", uuid: "L.zorpBlue" }, { name: "Zorp, Red", uuid: "L.zorpRed" }, { name: "Quux", uuid: "L.quux" }];
const roll = (over = {}) => planOrganisationRoll({ recipe: RECIPE, encounter: ENCOUNTER, variant: "alba", context: "wilderness", state: "lair", rng: steady, org: ORG, library: LIB, hdOf: (r) => (r === "a" ? 2 : null), printedHp: (p) => (p.kind === "cell" && p.role === "a" ? 7 : null), ...over });
const nodesOf = (n) => [n, ...n.children.flatMap(nodesOf)];
const stacksOf = (r) => nodesOf(r.top).flatMap((n) => n.stacks);
const protoOfStack = (r, s) => r.prototypes[s.proto];

t("a plain roll turns each part into a stack with its part and page, and a printed hit-point figure onto its prototype's stack", () => {
  const r = roll();
  assert.equal(r.ok, true);
  const escort = stacksOf(r).find((s) => s.gen.part === "escort");
  assert.deepEqual([escort.gen, escort.fixedHp], [{ part: "escort", cite: "XX p. 1" }, 7]);
  assert.equal("fixedHp" in stacksOf(r).find((s) => s.gen.part === "archers" || s.gen.part === "warriors"), false, "no figure the page does not print");
  assert.equal(r.gen.variant, "alba");
  assert.deepEqual(r.treasure, { deal: true, hoards: 3 }, "one hoard for each unit the line counts");
  assert.equal(roll({ state: "wandering" }).treasure.deal, false, "the state decides whether treasure is dealt");
  assert.deepEqual(roll({ context: "dungeon", state: "wandering" }).treasure, { deal: false, hoards: 1 }, "a unit that counts bodies is one hoard");
  assert.equal(roll({ unit: "band", state: "lair" }).treasure.deal, false, "a roll of one empty row deals none: its ancestor's roll dealt for it");
});

t("a leader is an officer of its unit with its morale part, never a stack; an out-of-range figure is null and a finding", () => {
  const r = roll();
  assert.equal(r.top.officers[0].moraleBonus, 2);
  assert.equal(stacksOf(r).some((s) => s.gen.part.startsWith("leader")), false);
  const wild = roll({ recipe: RECIPE.map((p) => (p.key === "leader-c" ? { ...p, moraleWhileAlive: 9 } : p)) });
  assert.equal(wild.top.officers[0].moraleBonus, null);
  assert.ok(wild.findings.some((f) => f.what === "morale" && f.figure === 9));
});

t("an outside reference that folds to one entry is an entry prototype; the others stay labelled and are listed", () => {
  const r = roll();
  const guard1 = stacksOf(r).find((s) => s.gen.part === "guard-1");
  assert.deepEqual(protoOfStack(r, guard1), { key: guard1.proto, kind: "entry", uuid: "L.gleaf" });
  const guard2 = stacksOf(r).find((s) => s.gen.part === "guard-2");
  assert.deepEqual([protoOfStack(r, guard2).kind, protoOfStack(r, guard2).label], ["label", "zorps"], "two entries answer, so neither is chosen");
  const finding = r.findings.find((f) => f.what === "reference" && f.word === "zorps");
  assert.deepEqual([finding.status, finding.candidates.sort()], ["partial", ["L.zorpBlue", "L.zorpRed"]]);
  const captives = stacksOf(r).find((s) => s.gen.part === "captives");
  assert.equal(protoOfStack(r, captives).kind, "label");
  assert.equal(r.findings.some((f) => f.word === "folk"), false, "a count of no named kind is not a reference");
  assert.equal(roll({ library: [] }).findings.filter((f) => f.what === "reference").length, 2, "an empty library leaves each word a finding and throws nothing");
});

t("identical creatures across a roll are one prototype", () => {
  const r = roll();
  const cells = stacksOf(r).filter((s) => protoOfStack(r, s).kind === "cell" && s.role === "body");
  const keys = new Set(cells.map((s) => s.proto));
  assert.ok(cells.length > keys.size, "many body stacks, fewer prototypes");
  assert.equal(protoKey({ b: 1, a: [2, 1] }), protoKey({ a: [1, 2], b: 1 }), "a key does not depend on field or list order");
});

t("the camp holds the village's own parts, and the units hold their bodies", () => {
  const r = roll();
  const camp = r.top.children.find((n) => n.camp);
  assert.deepEqual(camp.stacks.map((s) => s.gen.part).sort(), ["captives", "escort", "guard-1", "guard-2"]);
  assert.ok(nodesOf(r.top).filter((n) => !n.camp && n.word !== "hold").every((n) => n.stacks.every((s) => s.role === "body")));
});

t("the village table, chosen as the source, replaces the page's guards and captives and nothing else", () => {
  const parts = withTableVillage(RECIPE, ORG.village.rows, "alba", "XX p. 3");
  assert.deepEqual(parts.filter((p) => p.role === "guard").map((p) => [p.key, p.source.name, p.basis]), [["village-beasts", "quuxes", "table"]]);
  const cap = parts.find((p) => p.role === "captive");
  assert.deepEqual([cap.key, cap.chance, cap.count.perUnit, cap.basis], ["village-prisoners", 40, "band", "table"]);
  assert.equal(parts.some((p) => p.key === "leader-c"), true, "leaders and the rest are the page's");
  assert.equal(withTableVillage(RECIPE, ORG.village.rows, "brex").filter((p) => p.role === "guard").length, 3, "a breed the table has no cell for keeps the page's parts");
  const r = roll({ villageSource: "table" });
  assert.deepEqual(stacksOf(r).filter((s) => s.role === "guard").map((s) => s.gen.part).sort(), ["village-beasts"]);
  assert.equal(r.gen.villageSource, "table");
  assert.equal(protoOfStack(r, stacksOf(r).find((s) => s.gen.part === "village-beasts")).uuid, "L.quux");
});

t("a band the table holds picks a troop and a gap is a finding, never a guess", () => {
  assert.deepEqual(rollBanded(ORG.troops.rows, "alba", steady), { key: "t1", roll: 21, die: "1d100" });
  assert.equal(rollBanded(ORG.troops.rows, "alba", high).key, "t2");
  assert.equal(rollBanded(ORG.troops.rows, "brex", steady).key, null, "a breed with no band");
  assert.equal(rollBanded([], "alba", steady).roll, null);
  const gappy = [{ key: "t1", cells: { alba: band(1, 10) } }, { key: "t2", cells: { alba: band(80, 100) } }];
  assert.equal(rollBanded(gappy, "alba", steady).key, null, "a throw outside every band");
});

t("the optional split gives a share to special units; each rolls a troop that its units, leaders and gangs take", () => {
  const r = roll({ context: "wilderness", state: "wandering", rules: { troops: true } });
  const cells = r.top.children;
  assert.deepEqual(cells.map((c) => c.shareKind), ["archers", SPECIAL], "1d6 at a fifth of the die is two cells: the unit the roundings left over goes to the larger dropped fraction");
  assert.equal(cells.find((c) => c.shareKind === SPECIAL).troop, "t1");
  assert.equal(cells[0].troop, "");
  assert.equal(r.top.officers[0].troop, "t1", "the leader above special units takes the first one's role");
  assert.equal(cells.find((c) => c.shareKind === SPECIAL).officers[0].troop, "t1", "a champion shares its gang's role");
  assert.equal(roll({ context: "wilderness", state: "wandering", rules: { troops: true }, rng: high }).top.children.find((c) => c.shareKind === SPECIAL)?.troop, "t2");
});

t("a split with a figure missing keeps the recipe's own and lists the gap", () => {
  const f = { ...ORG.organisation.figures, specialShare: undefined };
  const r = roll({ state: "wandering", rules: { troops: true }, org: { ...ORG, organisation: { figures: f } } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.findings.find((x) => x.what === "split"), { what: "split", missing: [SPECIAL] });
  assert.ok(nodesOf(r.top).every((n) => n.shareKind !== SPECIAL));
});

t("a mounted troop's bodies ride and each unit above has its leader ride; a mount beside the riders is a finding only", () => {
  const r = roll({ state: "wandering", rules: { troops: true } });
  const special = r.top.children.find((c) => c.shareKind === SPECIAL);
  const stack = special.stacks[0];
  assert.deepEqual(r.prototypes[stack.mount.proto], { key: stack.mount.proto, kind: "entry", uuid: "L.gleaf" });
  assert.equal(r.top.officers[0].mount.proto, stack.mount.proto, "the band's leader rides when one of its cells does");
  assert.equal(special.officers[0].mount.proto, stack.mount.proto);
  assert.equal(r.top.children[0].officers[0].mount, undefined, "a cell that does not ride keeps its leader afoot");
  const beside = roll({ state: "wandering", rules: { troops: true }, rng: high });
  const sp = beside.top.children.find((c) => c.shareKind === SPECIAL);
  assert.equal(sp.stacks[0].mount, undefined);
  assert.ok(beside.findings.some((x) => x.what === "alongside"));
});

t("one trait for a unit that holds units, rolled on the variant's bands; a lone unit rolls none; an ancestor's stands", () => {
  const r = roll({ state: "wandering", rules: { traits: true } });
  assert.equal(r.gen.trait, "x1");
  assert.ok(nodesOf(r.top).every((n) => n.trait === "x1"), "everything under it takes it");
  assert.equal(roll({ context: "dungeon", state: "wandering", rules: { traits: true } }).gen.trait, "", "a gang alone has none");
  assert.equal(roll({ state: "wandering", rules: { traits: true }, inherit: { trait: "x2" } }).gen.trait, "x2");
  assert.equal(roll({ state: "wandering", rules: { traits: true }, inherit: { trait: "" } }).gen.trait, "", "an ancestor with none leaves none");
});

t("a trait that adds beasts adds them only where the Judge named the creature, and lists the question until then", () => {
  const asked = roll({ rules: { traits: true } });
  assert.ok(asked.findings.some((f) => f.what === "traitBeasts" && f.dice === "2d4"));
  assert.equal(stacksOf(asked).some((s) => s.gen.part.startsWith("trait-")), false);
  const named = roll({ rules: { traits: true }, choices: { traitBeast: "gleaves" } });
  const s = stacksOf(named).find((x) => x.gen.part === "trait-x1");
  assert.deepEqual([protoOfStack(named, s).uuid, s.gen.cite], ["L.gleaf", "XX p. 5"]);
  assert.ok(s.count >= 2 && s.count <= 8);
});

t("gear is rolled by the equipment table's own ranks, troops and scopes; a piece a leader's table does not give is never rolled onto", () => {
  const r = roll({ rules: { troops: true, gear: true }, state: "lair" });
  const chief = r.top.officers[0];
  assert.deepEqual(chief.gear, ["g2"], "the village chance, for the rank the row names");
  assert.deepEqual(chief.gearNot.sort(), ["g1", "g3"]);
  const subs = nodesOf(r.top).filter((n) => n.word === "band" && n.officers[0]);
  assert.ok(subs.length > 0);
  const eligible = subs.filter((n) => n.officers[0].gearEligible?.includes("g1"));
  assert.ok(eligible.every((n) => (n.officers[0].gear ?? []).includes("g1")), "rolled where the rank and the troop are the row's");
  const carried = nodesOf(r.top).flatMap((n) => n.stacks).filter((s) => s.carry);
  assert.ok(carried.every((s) => s.carry.g1 === s.count), "every body of a troop whose row carries a hundred percent");
});

t("a chance per Hit Die with no Hit Dice known writes no roll and is a finding", () => {
  const r = roll({ rules: { gear: true }, hdOf: () => null, state: "wandering" });
  assert.ok(r.findings.some((f) => f.what === "hd" && f.gear === "g3"));
});

t("speakers of Common are counted from the imported figures, per body and per Hit Die of a leader", () => {
  const r = roll({ state: "wandering" });
  const body = stacksOf(r).find((s) => s.role === "body");
  assert.equal(body.speakers, body.count, "a hundred percent of the bodies");
  const leader = nodesOf(r.top).find((n) => n.officers[0]?.role === "a").officers[0];
  assert.equal(leader.speaksCommon, true, "forty percent a Hit Die, at two Hit Dice, thrown at a fifth");
  const none = roll({ state: "wandering", org: { ...ORG, organisation: { figures: {} } } });
  assert.equal(stacksOf(none).some((s) => "speakers" in s), false, "no figure imported, none written");
});

t("a world that imported nothing rolls the page's parts and throws nothing", () => {
  const r = roll({ org: {}, rules: { troops: true, traits: true, gear: true }, villageSource: "table", state: "lair" });
  assert.equal(r.ok, true);
  assert.ok(r.findings.some((f) => f.what === "split"));
  assert.equal(r.gen.trait, "");
});

t("a recipe with no side for the line is a refusal the caller reads, and the lair chance is thrown first", () => {
  assert.equal(roll({ encounter: { wilderness: { wandering: { noun: "Band", number: "", unit: "" } } }, state: "wandering" }).reason, "side");
  const r = roll({ state: "chance", rng: () => 0.05 });
  assert.deepEqual([r.state, r.lair.inLair], ["lair", true]);
  assert.equal(r.top.word, "hold");
});

t("the roll's tree carries out as one plan: a roll of one empty row writes only that row's level", () => {
  const rows = [{ key: "v", parentKey: "", label: "V", holderUuid: "G.v", kind: "hold", notes: "", hidden: false, gen: {} }, { key: "w", parentKey: "v", label: "W", holderUuid: "", kind: "band", notes: "", hidden: false, gen: {} }];
  const tree = roll({ unit: "band", state: "wandering", rules: { traits: true } });
  const plan = planRoll({ host: { uuid: "F.1", kind: "faction" }, rows, rowKey: "w", tree, scope: "one" });
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.rows.find((r) => r.key === "v"), rows[0]);
  assert.equal(plan.rows.find((r) => r.key === "w").gen.trait, "x1", "what a later roll of an empty row needs rides on the row");
  assert.ok(plan.rows.filter((r) => !r.holderUuid && r.key !== "w").every((r) => r.kind === "cell"));
});

t("a line that counts one unit by a fixed figure is lowered to that unit: it stands at the root, the wrapper's leader first, its camp carried down", () => {
  const recipe = [...RECIPE, part("den-guard", "guard", { source: { name: "gleaves" }, count: { dice: "1d4" }, when: { units: ["den"] } })];
  const r = roll({ recipe, context: "dungeon", state: "lair" });
  assert.equal(r.top.word, "band", "the counted unit's group is the root");
  assert.equal(r.top.parentKey, null);
  assert.deepEqual(r.top.officers.map((o) => o.role), ["c", "b"], "the printed leader of the wrapper is the group's officer, the unit's own after it");
  assert.equal(r.top.officers[0].moraleBonus, 2);
  const camp = r.top.children.find((c) => c.camp);
  assert.ok(camp?.stacks.some((s) => s.gen.part === "den-guard"), "a part that is no body of the wrapper joins the unit's camp");
  assert.equal(nodesOf(r.top).some((n) => n.word === "den"), false, "no wrapper level stands above it");
  assert.equal(r.treasure.hoards, 1);
});

t("a count that is dice is never lowered, though the dice came up one", () => {
  const r = roll({ context: "wilderness", state: "lair", rng: () => 0 });
  assert.equal(r.top.word, "hold");
  assert.equal(r.top.children.filter((c) => !c.camp).length, 1, "one band under a hold");
});

t("a roll of an empty row takes the share and the troop its ancestor's roll fixed, and rolls neither again", () => {
  const rules = { troops: true };
  const alone = roll({ unit: "cell", state: "wandering", rules });
  assert.equal(alone.top.shareKind, SPECIAL, "a unit alone in its level, left to itself, takes the shares' own roundings");
  assert.equal(alone.top.troop, "t1", "and rolls its troop on the bands");
  const fixed = roll({ unit: "cell", state: "wandering", rules, inherit: { shareKind: "warriors" } });
  assert.equal(fixed.top.shareKind, "warriors", "the share the ancestor fixed");
  assert.equal(fixed.top.troop, "", "no special unit, so no troop is rolled");
  assert.ok(fixed.top.stacks.every((s) => s.gen.part === "warriors"));
  const carried = roll({ unit: "cell", state: "wandering", rules, inherit: { shareKind: SPECIAL, troop: "t2" } });
  assert.equal(carried.top.troop, "t2", "the troop is the ancestor's, though the bands would roll t1");
  assert.equal(carried.findings.some((f) => f.what === "gap"), false);
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-organisation-logic: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
