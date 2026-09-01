/** LOCAL-ONLY: class-builder recipes vs the real JJ PDF. Skips without the ref lib. */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable, findPage } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { assembleBuilderTables, parseBuild } from "../../scripts/importer/builder-binding.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("test-class-builder-tables: reference PDFs absent — skipped.");
  process.exit(0);
}

const { doc } = await openBook(fs.readFileSync(FILES.jj));
const readPage = (p) => pageItems(doc, p);
const recipes = TABLE_RECIPES["acks.classBuilder"].tables;

const raw = {};
for (const [tableId, recipe] of Object.entries(recipes)) {
  if (recipe.valueBlocks) {
    const out = {};
    for (const block of recipe.valueBlocks) {
      const found = await findPage({ ...block, searchRadius: 4 }, doc.numPages, readPage);
      if (!found) continue;
      const got = extractTable(found.items, { ...recipe, valueBlocks: null, emit: null, values: block.values });
      if (Object.keys(got).length) out[block.id] = got;
    }
    raw[tableId] = out;
    continue;
  }
  const found = await findPage({ ...recipe, searchRadius: 4 }, doc.numPages, readPage);
  if (!found) {
    raw[tableId] = null;
    continue;
  }
  raw[tableId] = extractTable(found.items, recipe);
}

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

check("basePoints reads 4", raw.basePoints?.basePoints === 4);

check("hd ladder: five rows", Object.keys(raw.hdRaw ?? {}).length === 5);
check("hd value 2 is a d8 at 1000 XP with +4 MW", raw.hdRaw?.["2"]?.die?.includes("d8") && raw.hdRaw["2"].cost === 1000 && raw.hdRaw["2"].mortalWounds === 4);
check("hd value 0 is a d4 at 0 XP", raw.hdRaw?.["0"]?.die?.includes("d4") && raw.hdRaw["0"].cost === 0);

check("fighting: six rows incl. the 1a/1b split", Object.keys(raw.fightingRaw ?? {}).length === 6);
check("fighting 2 (Fighter): 1000 XP, full cleaves, damage bonus", raw.fightingRaw?.["2"]?.cost === 1000 && /per level/i.test(raw.fightingRaw["2"].cleaves ?? "") && /per 3/i.test(raw.fightingRaw["2"].damage ?? ""));
check("fighting 1a: narrow weapons, heavy armour, 500 XP", /narrow/i.test(raw.fightingRaw?.["1a"]?.weapons ?? "") && /heavy/i.test(raw.fightingRaw?.["1a"]?.armor ?? "") && raw.fightingRaw?.["1a"]?.cost === 500);
check("fighting 0: restricted weapons, no cleaves, 0 XP", /restricted/i.test(raw.fightingRaw?.["0"]?.weapons ?? "") && /none/i.test(raw.fightingRaw?.["0"]?.cleaves ?? "") && raw.fightingRaw?.["0"]?.cost === 0);
check("fighting attack columns parse as progressions", /\+2 per 3/i.test(raw.fightingRaw?.["2"]?.attack ?? "") && /\+3 per 2/i.test(raw.fightingRaw?.["4"]?.attack ?? ""));

check("thievery 4 = 16 skills at 1000 XP", /16/.test(raw.thieveryRaw?.["4"]?.skills ?? "") && raw.thieveryRaw?.["4"]?.cost === 1000);
check("thievery 1 = 4 skills at 250 XP", /4/.test(raw.thieveryRaw?.["1"]?.skills ?? "") && raw.thieveryRaw?.["1"]?.cost === 250);

check("divine 2 = 100% at 500 XP", /100/.test(raw.divineRaw?.["2"]?.power ?? "") && raw.divineRaw?.["2"]?.cost === 500);
check("divine 4 = 150% at 2000 XP", /150/.test(raw.divineRaw?.["4"]?.power ?? "") && raw.divineRaw?.["4"]?.cost === 2000);
check("arcane 4 = 100% at 2500 XP", /100/.test(raw.arcaneRaw?.["4"]?.power ?? "") && raw.arcaneRaw?.["4"]?.cost === 2500);
check("arcane 1 = 33% at 625 XP", /33/.test(raw.arcaneRaw?.["1"]?.power ?? "") && raw.arcaneRaw?.["1"]?.cost === 625);

const gridRows = (t) => Object.values(t ?? {}).filter((r) => r && !r.__missing);
check("divine grids: 14 rows each", [raw.divineSlots1, raw.divineSlots2, raw.divineSlots3, raw.divineSlots4].every((t) => gridRows(t).length === 14));
check("arcane grids: 14 rows each", [raw.arcaneSlots1, raw.arcaneSlots2, raw.arcaneSlots3, raw.arcaneSlots4].every((t) => gridRows(t).length === 14));
check("delayed grids: 14 rows each", [raw.arcaneDelayed1, raw.arcaneDelayed2, raw.arcaneDelayed3].every((t) => gridRows(t).length === 14));
check("arcane 4 grid L1 grants a 1st-level slot", raw.arcaneSlots4?.["1"]?.s1 >= 1);
check("divine 1 grid L1 grants nothing and lags caster level", raw.divineSlots1?.["1"]?.s1 == null && raw.divineSlots1?.["1"]?.casterLevel === 0);
check("delayed arcane 1 starts later than plain arcane 1", (raw.arcaneDelayed1?.["2"]?.s1 ?? 0) <= (raw.arcaneSlots1?.["2"]?.s1 ?? 0));

check("saves precedence names the four categories in order", /arcane.*divine.*fighting.*thievery/i.test(raw.savesRule?.precedence ?? ""));
check("saves mapping ties categories to the four chassis", /fighter.*thief.*crusader.*mage/i.test(raw.savesRule?.mapping ?? ""));

check("post-8 increments: 100k / 120k / 150k", raw.xpRules?.crusaderThief === 100000 && raw.xpRules?.fighter === 120000 && raw.xpRules?.mage === 150000);
check("smoothing: 7th level to the nearest 5000", raw.smoothing?.level === 7 && raw.smoothing?.nearest === 5000);
check("post-9 hit points per level read as their own table", Number.isInteger(raw.hpAfterNine?.crusaderMage) && Number.isInteger(raw.hpAfterNine?.fighterThief) && raw.hpAfterNine.fighterThief > raw.hpAfterNine.crusaderMage);

check("racial caps: 4→13 … 7→10", raw.racialCaps?.["4"]?.maxLevel === 13 && raw.racialCaps?.["7"]?.maxLevel === 10 && raw.racialCaps?.["6"]?.maxLevel === 11 && raw.racialCaps?.["5"]?.maxLevel === 12);

check("tradeoffs: ten rows with benefits", Object.values(raw.tradeoffsRaw ?? {}).filter((r) => r.benefit).length === 10);
check("weapon broad→narrow yields two powers", /2/.test(raw.tradeoffsRaw?.["weapons.broadNarrow"]?.benefit ?? ""));
check("trade-off XP penalty is a number", Number.isFinite(raw.tradeoffPenalty?.perPower));

check("dwarf ladder: five rungs, 0 at 200 XP, 3 at 900 XP", raw.dwarfRaw?.["0"]?.cost === 200 && raw.dwarfRaw?.["3"]?.cost === 900);
check("dwarf rules: CON 9, +1 hp after 9th, post-8 10k/30k", raw.dwarfRules?.con === 9 && raw.dwarfRules?.hpAfter9 === 1 && raw.dwarfRules?.post8Fighter === 10000 && raw.dwarfRules?.post8CrusaderThief === 30000);
check("dwarf 0 powers present on the page", !!raw.dwarfRules?.sensitivityToRockAndStone && !!raw.dwarfRules?.dwarfTongues && !!raw.dwarfRules?.hardy);

check("elf ladder: 0 at 125 XP, 3 at 2000 XP, 4 at 2500 XP", raw.elfRaw?.["0"]?.cost === 125 && raw.elfRaw?.["3"]?.cost === 2000 && raw.elfRaw?.["4"]?.cost === 2500);
check("elf rules: stacking, 125 XP discount, post-8 50k", !!raw.elfRules?.stacksWithArcane && raw.elfRules?.arcaneDiscount === 125 && raw.elfRules?.post8 === 50000);
check("elf 0 powers present on the page", !!raw.elfRules?.animalFriendship && !!raw.elfRules?.attunementToNature && !!raw.elfRules?.elfTongues);
check("race requirements: dwarf CON 9, elf INT 9", raw.raceRequirements?.dwarfCon === 9 && raw.raceRequirements?.elfInt === 9);

check("builds: all twelve classes captured", Object.keys(raw.builds ?? {}).length === 12);
check("fighter build names HD and Fighting", /hd\s*2.*fighting\s*2|fighting\s*2/i.test(raw.builds?.fighter?.build ?? ""));
check("spellsword build names Elf 3 and 4,000 XP", /elf 3/i.test(raw.builds?.elvenSpellsword?.build ?? "") && /4,000/.test(raw.builds?.elvenSpellsword?.build ?? ""));
// Superscript "th" runs interleave ("capped th at 10 level"), so the cap
// parse never assumes adjacency — the binding uses this same tolerance.
check("craftpriest build is capped at 10th", /capped[^.]*?\b10\b[^.]*?level/i.test(raw.builds?.dwarvenCraftpriest?.build ?? ""));

/* --------------- assembly (the engine-shaped doc) --------------- */

const asm = assembleBuilderTables(raw);

check("budget assembles points, precedence, smoothing, post-8, caps, trade-in", asm.budget.basePoints === 4 && asm.budget.savesPrecedence[0] === "arcane" && asm.budget.smoothing.level === 7 && asm.budget.postEight.mage === 150000 && asm.budget.racialCaps.some((r) => r.points === 7 && r.maxLevel === 10) && asm.budget.tradeInXp === 250);
check("budget assembles the post-9 hit-point rates, keyed as the book pairs them", Number.isInteger(asm.budget.hpAfterNine?.crusaderMage) && Number.isInteger(asm.budget.hpAfterNine?.fighterThief));
check("races: the dwarf's post-9 hit points survive assembly", Number.isInteger(asm.races.dwarf.hpAfter9) && asm.races.dwarf.hpAfter9 === raw.dwarfRules.hpAfter9);
check("races: the elf prints no post-9 hit points, and assembly says so", asm.races.elf.hpAfter9 === null);
check("hd rows assemble with clean dice", asm.hd.find((r) => r.value === 4)?.die === "d12" && asm.hd.find((r) => r.value === 1)?.mortalWounds === 2);
const f2 = asm.fighting.find((r) => r.value === 2);
const f1a = asm.fighting.find((r) => r.value === 1 && r.sub === "a");
check("fighting rows carry chassis, progressions, cleaves", f2?.attackAs === "fighter" && f2?.attack?.every === 3 && f2?.damage?.step === 1 && f2?.cleaves === "full" && f1a?.attackAs === "crusader" && f1a?.cleaves === "half");
const hero = asm.fighting.find((r) => r.value === 4);
check("hero row has params but no chassis", hero?.attackAs === "" && hero?.attack?.step === 3 && hero?.attack?.every === 2);
check("magicTypes: divine saves as crusader with per-value grids", asm.magicTypes.divine.savesAs === "crusader" && asm.magicTypes.divine.values.find((v) => v.value === 2)?.slots?.length === 14 && asm.magicTypes.divine.values.find((v) => v.value === 2)?.fraction === 1);
const a1 = asm.magicTypes.arcane.values.find((v) => v.value === 1);
check("magicTypes: arcane 1 carries plain and delayed grids", a1?.slots?.length === 14 && a1?.delayedSlots?.length === 14 && a1?.fraction === 0.33);
check("tradeoffs: weapon narrowing prices 250/power at fighting 2+", asm.tradeoffs.find((t) => t.key === "weapons.broadNarrow")?.xpDelta === 500 && asm.tradeoffs.find((t) => t.key === "weapons.broadNarrow")?.xpDeltaMinFighting === 2 && asm.tradeoffs.find((t) => t.key === "armor.heavyMedium")?.xpDelta === 0);
check("races: dwarf ladder with base powers and post-8 tiers", asm.races.dwarf.values.find((r) => r.value === 0)?.powerNames.length === 3 && asm.races.dwarf.postEight.some((p) => p.chassis === "fighter" && p.delta === 10000) && asm.races.dwarf.minimumAttributes[0].min === 9);
check("races: elf stacks with arcane at a 125 XP discount", asm.races.elf.stacksWith === "arcane" && asm.races.elf.stackXpDiscount === 125 && asm.races.elf.postEight[0].delta === 50000);

/* --------------- Ready-for-Play build parsing --------------- */

const spellsword = parseBuild(raw.builds.elvenSpellsword.build);
check("spellsword parses HD1 F2 Arcane1 Elf3 at 4000 XP, mage saves? no — fighter", spellsword.hdValue === 1 && spellsword.fighting.value === 2 && spellsword.magic.some((m) => m.type === "arcane" && m.value === 1) && spellsword.race?.key === "elf" && spellsword.race?.value === 3 && spellsword.xp === 4000 && spellsword.cap === 10);
const craftpriest = parseBuild(raw.builds.dwarvenCraftpriest.build);
check("craftpriest parses HD1 F1a Divine2 Dwarf3, crusader saves, cap 10", craftpriest.fighting.sub === "a" && craftpriest.magic.some((m) => m.type === "divine" && m.value === 2) && craftpriest.race?.key === "dwarf" && craftpriest.savesAs === "crusader" && craftpriest.cap === 10);
const nightblade = parseBuild(raw.builds.elvenNightblade.build);
check("nightblade reads 'Thief 2' as thievery and stops at the next runin", nightblade.thievery === 2 && nightblade.race?.key === "elf" && !/spellsword:/.test(nightblade.notes));
const bard = parseBuild(raw.builds.bard.build);
check("bard has no HD token and records the traded final XP", bard.hdValue === undefined && bard.thievery === 2 && bard.finalXp === 1750);

console.log(`test-class-builder-tables: ${pass} checks passed.`);
