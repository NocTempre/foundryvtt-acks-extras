/**
 * LOCAL-ONLY: class-builder recipes read from the real JJ PDF. Skips without
 * the ref lib.
 *
 * Asserts the SHAPE of what the recipes read and that independent reads of the
 * same book agree with each other: ladders are whole and ordered, grids are
 * the same length, the assembler carries each raw read through unchanged, and
 * a build paragraph's stated cost equals the sum of its parts priced off the
 * ladders. No printed figure is asserted here; value-exact checks live in
 * `tools/rules-tests/` (gitignored, run by `run-tests.mjs` on machines that
 * hold the book).
 */
import assert from "node:assert";
import fs from "node:fs";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable, findPage } from "../../scripts/importer/table-extract.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { assembleBuilderTables, buildRaceWords, matchBuildClass, parseBuild, parseSavesMap, parseSavesPrecedence } from "../../scripts/importer/builder-binding.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

const CLASSES = JSON.parse(fs.readFileSync(new URL("../../cookbook/classes.json", import.meta.url), "utf8")).entries;

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
      const found = await findPage({ ...block, book: recipe.book, searchRadius: 4 }, doc.numPages, readPage);
      if (!found) continue;
      const got = extractTable(found.items, { ...recipe, valueBlocks: null, emit: null, values: block.values, column: block.column ?? recipe.column, yMax: block.yMax ?? recipe.yMax });
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

const isInt = (v) => Number.isInteger(v);
const isPosInt = (v) => Number.isInteger(v) && v > 0;
const keys = (o) => Object.keys(o ?? {});
const nondecreasing = (xs) => xs.every((x, i) => i === 0 || x >= xs[i - 1]);
const increasing = (xs) => xs.every((x, i) => i === 0 || x > xs[i - 1]);
/** The rung values run 0, 1, 2 … with no gap. */
const contiguousFromZero = (vals) => vals.every((v, i) => v === i);

check("every recipe table was found on a page", Object.keys(recipes).every((id) => raw[id] != null));

/* --------------- raw reads: shape and agreement --------------- */

const asm = assembleBuilderTables(raw);

check("basePoints reads one positive integer, and the budget carries it", isPosInt(raw.basePoints?.basePoints) && asm.budget.basePoints === raw.basePoints.basePoints);

// A ladder: its rungs run without a gap, the XP column rises with the rung,
// and assembly neither drops nor invents a rung.
check("hd ladder assembles every raw rung, whole and ordered", asm.hd.length === keys(raw.hdRaw).length && contiguousFromZero(asm.hd.map((r) => r.value)) && increasing(asm.hd.map((r) => r.cost)));
check("hd dice read as one die each, growing with the rung, with mortal wounds that never shrink", asm.hd.every((r) => /^d\d+$/.test(r.die)) && increasing(asm.hd.map((r) => Number(r.die.slice(1)))) && nondecreasing(asm.hd.map((r) => r.mortalWounds)) && asm.hd.every((r) => isInt(r.mortalWounds)));

check("fighting assembles every raw row", asm.fighting.length === keys(raw.fightingRaw).length);
const fightingValues = [...new Set(asm.fighting.map((r) => r.value))];
check("fighting rungs run without a gap and the XP column never falls", contiguousFromZero(fightingValues) && nondecreasing(asm.fighting.map((r) => r.cost)));
check("only one fighting rung is split into lettered sub-rows, and both halves share a cost", (() => {
  const split = fightingValues.filter((v) => asm.fighting.filter((r) => r.value === v).length > 1);
  if (split.length !== 1) return false;
  const halves = asm.fighting.filter((r) => r.value === split[0]);
  return halves.every((r) => r.sub !== "") && new Set(halves.map((r) => r.cost)).size === 1;
})());
check("every fighting row reads a cleave class and well-formed progressions", asm.fighting.every((r) => ["none", "half", "full"].includes(r.cleaves) && (r.attack === null || (isPosInt(r.attack.step) && isPosInt(r.attack.every))) && (r.damage === null || (isPosInt(r.damage.step) && isPosInt(r.damage.every)))));
check("a fighting row names a chassis only from the four the saves rule maps to", asm.fighting.every((r) => r.attackAs === "" || ["fighter", "thief", "crusader", "mage"].includes(r.attackAs)));
check("a row with no chassis still carries attack parameters", asm.fighting.filter((r) => r.attackAs === "").every((r) => r.attack !== null));

check("thievery assembles every raw rung, whole, with skills that never shrink", asm.thievery.length === keys(raw.thieveryRaw).length && contiguousFromZero(asm.thievery.map((r) => r.value)) && increasing(asm.thievery.map((r) => r.cost)) && nondecreasing(asm.thievery.map((r) => r.skills)));

const magic = asm.magicTypes;
check("both caster types assemble every raw rung, whole, with a rising cost and a power fraction that never falls", [["divine", raw.divineRaw], ["arcane", raw.arcaneRaw]].every(([t, rawRungs]) => {
  const vals = magic[t]?.values ?? [];
  return vals.length === keys(rawRungs).length && contiguousFromZero(vals.map((v) => v.value)) && increasing(vals.map((v) => v.cost)) && nondecreasing(vals.filter((v) => v.fraction !== null).map((v) => v.fraction));
}));

// Every grid is read from its own page block, so the grids are held to each
// other: one length, a level column that counts up from one, and columns that
// only ever grow down the levels.
const gridsOf = (type) => magic[type].values.flatMap((v) => [v.slots, v.delayedSlots].filter(Boolean));
const allGrids = [...gridsOf("divine"), ...gridsOf("arcane")];
const SLOT_COLS = ["s1", "s2", "s3", "s4", "s5", "s6"];
check("every caster rung past the first carries a grid, and the first carries none", ["divine", "arcane"].every((t) => magic[t].values.every((v, i) => (i === 0) === !v.slots)));
check("every grid is read at one length, each row count agreeing with the raw block", allGrids.length > 0 && new Set(allGrids.map((g) => g.length)).size === 1 && allGrids[0].length === keys(raw.arcaneSlots4).length);
check("every grid's level column counts up from one", allGrids.every((g) => g.every((r, i) => r.atLevel === i + 1)));
check("every grid's slot columns and caster level never fall down the levels", allGrids.every((g) => [...SLOT_COLS, "casterLevel"].every((c) => nondecreasing(g.map((r) => r[c] ?? 0)))));
check("a caster level never passes the character level", allGrids.every((g) => g.every((r) => r.casterLevel === null || r.casterLevel <= r.atLevel)));
check("a delayed grid starts granting slots no earlier than its plain grid", magic.arcane.values.filter((v) => v.delayedSlots).every((v) => {
  const first = (g) => g.findIndex((r) => SLOT_COLS.some((c) => r[c] > 0));
  return first(v.delayedSlots) === -1 || first(v.slots) === -1 || first(v.delayedSlots) >= first(v.slots);
}));
check("each raw delayed grid reaches the assembly on a rung of its own", magic.arcane.values.filter((v) => v.delayedSlots).length === [raw.arcaneDelayed1, raw.arcaneDelayed2, raw.arcaneDelayed3].filter((g) => keys(g).length).length);

// The saves rule is printed twice over, as a precedence and as a mapping.
const precedence = parseSavesPrecedence(raw.savesRule?.precedence);
const savesMap = parseSavesMap(raw.savesRule?.mapping);
check("the saves precedence names each category once, and the mapping names the same categories", precedence.length === new Set(precedence).size && [...precedence].sort().join() === keys(savesMap).sort().join());
check("the mapping gives every category a different chassis", new Set(Object.values(savesMap)).size === keys(savesMap).length);
check("the budget carries the precedence as read, and each caster type its mapped chassis", asm.budget.savesPrecedence.join() === precedence.join() && magic.divine.savesAs === savesMap.divine && magic.arcane.savesAs === savesMap.arcane);

check("post-8 increments read as three positive integers, carried unchanged", [raw.xpRules?.crusaderThief, raw.xpRules?.fighter, raw.xpRules?.mage].every(isPosInt) && asm.budget.postEight.mage === raw.xpRules.mage && asm.budget.postEight.fighter === raw.xpRules.fighter && asm.budget.postEight.crusaderThief === raw.xpRules.crusaderThief);
check("smoothing reads a level and a rounding step, both positive integers", isPosInt(raw.smoothing?.level) && isPosInt(raw.smoothing?.nearest) && asm.budget.smoothing.level === raw.smoothing.level && asm.budget.smoothing.nearest === raw.smoothing.nearest);
check("the level the post-8 increments start after reads as an integer, from the same sentence", isInt(raw.xpRules?.afterLevel) && raw.xpRules.afterLevel > 1);
check("budget carries that level beside the increments", asm.budget.xpFlatAfter === raw.xpRules.afterLevel);
check("post-9 hit points per level read as their own table", isInt(raw.hpAfterNine?.crusaderMage) && isInt(raw.hpAfterNine?.fighterThief) && raw.hpAfterNine.fighterThief > raw.hpAfterNine.crusaderMage);
check("the level the post-9 rates begin after reads as an integer, from the same table", isInt(raw.hpAfterNine?.afterLevel) && raw.hpAfterNine.afterLevel > 1);
check("the post-9 level falls inside the grids' level range", raw.hpAfterNine.afterLevel < allGrids[0].length);

// The proficiency count is the page's only statement of a class's maximum
// level: two integers, read apart, whose difference is the cap.
check("the class list's proficiency count reads as two integers, the total over the typical", isInt(raw.proficiencyCount?.total) && isInt(raw.proficiencyCount?.typical) && raw.proficiencyCount.total > raw.proficiencyCount.typical);

const caps = asm.budget.racialCaps;
check("racial caps assemble every raw row, on consecutive point totals, with a maximum level that never rises with the points", caps.length === keys(raw.racialCaps).length && caps.every((c, i) => i === 0 || c.points === caps[i - 1].points + 1) && caps.every((c, i) => i === 0 || c.maxLevel <= caps[i - 1].maxLevel));
check("the human maximum level is at least every racial one", asm.budget.humanMaxLevel >= Math.max(...caps.map((c) => c.maxLevel)));

check("tradeoffs assemble every raw row, each with a benefit", asm.tradeoffs.length === keys(raw.tradeoffsRaw).length && asm.tradeoffs.every((t) => isPosInt(t.powersGained)));
check("trade-off XP penalty reads as a positive integer", isPosInt(raw.tradeoffPenalty?.perPower) && asm.budget.tradeInXp === raw.tradeoffPenalty.perPower);
check("only weapon narrowing is priced, at the penalty per power gained", asm.tradeoffs.every((t) => (t.key.startsWith("weapons.") ? t.xpDelta === asm.budget.tradeInXp * t.powersGained && t.xpDeltaMinFighting >= 1 : t.xpDelta === 0 && t.xpDeltaMinFighting === 0)) && asm.tradeoffs.some((t) => t.xpDelta > 0));

/* --------------- races --------------- */

const races = Object.values(asm.races);
const RACE_KEYS = ["dwarf", "elf", "people1", "people2"];
check("all four race ladders assemble every raw rung, whole, with a rising cost", races.length === 4 && RACE_KEYS.every((k) => {
  const r = asm.races[k];
  return r && r.values.length === keys(raw[`${k}Raw`]).length && contiguousFromZero(r.values.map((v) => v.value)) && increasing(r.values.map((v) => v.xpCost));
}));
check("only the first rung of a race grants base powers, one per run-in its page prints under the ladder", races.every((r) => r.values[0].powerNames.length > 0 && r.values[0].powerNames.length === raw[`${r.key}Powers`].powers.length && r.values.slice(1).every((v) => v.powerNames.length === 0)));
check("a race's name is its value-0 label, read off the page", races.every((r) => r.name && r.name.toLowerCase().replace(/\s+/g, "") === r.values[0].label.toLowerCase().replace(/\s+/g, "")));
check("no race powers run-in carries the next one's bullet or an empty text", races.every((r) => raw[`${r.key}Powers`].powers.every((p) => p.text.length > 0 && !/[\u0080-\u009F•]\s*$/u.test(p.text))));
check("each race's attribute floor is read twice and the two reads agree", raw.raceRequirements?.dwarfCon === raw.dwarfRules?.con && asm.races.dwarf.minimumAttributes[0]?.min === raw.dwarfRules.con && asm.races.elf.minimumAttributes[0]?.min === raw.raceRequirements?.elfInt && isPosInt(raw.raceRequirements.elfInt) && asm.races.dwarf.minimumAttributes[0].attr !== asm.races.elf.minimumAttributes[0].attr);
check("every race's post-8 increment is a positive integer", races.every((r) => r.postEight.length > 0 && r.postEight.every((p) => isPosInt(p.delta))));
check("a stacking discount is carried only by a race that stacks", !!raw.elfRules?.stacksWithArcane && asm.races.elf.stacksWith === "arcane" && isPosInt(asm.races.elf.stackXpDiscount) && races.every((r) => (r.stacksWith === "") === !("stackXpDiscount" in r)));
check("the races whose pages say their value stacks with the arcane one are read as stacking", asm.races.dwarf.stacksWith === "" && asm.races.people1.stacksWith === "" && asm.races.people2.stacksWith === "arcane");

check("budget assembles the post-9 hit-point rates, keyed as the book pairs them", isInt(asm.budget.hpAfterNine?.crusaderMage) && isInt(asm.budget.hpAfterNine?.fighterThief));
check("budget assembles the last die level beside the rates", asm.budget.hpAfterNine?.afterLevel === raw.hpAfterNine.afterLevel);
check("a missing last die level costs only itself", (() => {
  const lost = assembleBuilderTables({ ...raw, hpAfterNine: { ...raw.hpAfterNine, afterLevel: null } }).budget.hpAfterNine;
  const rates = assembleBuilderTables({ ...raw, hpAfterNine: { afterLevel: raw.hpAfterNine.afterLevel } }).budget.hpAfterNine;
  return lost.afterLevel === undefined && isInt(lost.crusaderMage) && isInt(lost.fighterThief)
    && rates.afterLevel === raw.hpAfterNine.afterLevel && rates.crusaderMage === undefined;
})());
check("budget assembles the human maximum level as the total less the typical count", asm.budget.humanMaxLevel === raw.proficiencyCount.total - raw.proficiencyCount.typical && asm.budget.humanMaxLevel >= 1);
check("a half-read count assembles no human maximum level, and nothing else changes", (() => {
  const total = assembleBuilderTables({ ...raw, proficiencyCount: { total: raw.proficiencyCount.total } }).budget;
  const typical = assembleBuilderTables({ ...raw, proficiencyCount: { typical: raw.proficiencyCount.typical } }).budget;
  const none = assembleBuilderTables({ ...raw, proficiencyCount: undefined }).budget;
  const inverted = assembleBuilderTables({ ...raw, proficiencyCount: { total: 3, typical: 9 } }).budget;
  return [total, typical, none, inverted].every((b) => b.humanMaxLevel === undefined && b.racialCaps?.length > 0 && b.basePoints === asm.budget.basePoints);
})());
check("races: the dwarf's post-9 hit points survive assembly", isInt(asm.races.dwarf.hpAfter9) && asm.races.dwarf.hpAfter9 === raw.dwarfRules.hpAfter9);
check("races: the elf prints no post-9 hit points, and assembly says so", asm.races.elf.hpAfter9 === null);

/* --------------- Printed class builds: parse, then price against the ladders --------------- */

// The build paragraphs are matched to the cookbook's class rows the way the
// import matches them to class documents: by name, else by a withheld name's
// locator.
const rrClasses = Object.entries(CLASSES)
  .filter(([, e]) => e.book === "rr" && e.kind === "kind.class")
  .map(([id, e]) => ({ id, name: e.name, hash: e.fields?.name?.hash ?? null, race: e.meta?.race ?? null }));
const runins = Object.values(raw.builds).flatMap((b) => b.runins ?? []);
const matched = runins.map((r) => ({ ...r, cls: matchBuildClass(r.label, rrClasses) }));
check("both build pages are read, as run-in paragraphs with text", keys(raw.builds).length === recipes.builds.valueBlocks.length && runins.every((r) => r.label && r.text.length > 0));
check("one build paragraph is read per class the rulebook ships, each matching a different class", runins.length === rrClasses.length && matched.every((r) => r.cls) && new Set(matched.map((r) => r.cls.id)).size === rrClasses.length);
const raceWords = buildRaceWords(asm.races, matched.map((r) => ({ label: r.label, race: r.cls?.race })));
check("every race is named by at least one word a build paragraph can use", RACE_KEYS.every((k) => Object.values(raceWords).includes(k)));

const parsed = Object.fromEntries(matched.map((r) => [r.cls.id, parseBuild(r.text, { raceWords })]));
const builds = Object.values(parsed);
check("every class the cookbook declares a race for builds on that race", matched.filter((r) => r.cls.race && asm.races[r.cls.race]).every((r) => parsed[r.cls.id].race?.key === r.cls.race) && matched.some((r) => r.cls.race === "people1") && matched.some((r) => r.cls.race === "people2"));
check("a build reads no allocation past its first yield", parseBuild("Arcane 4 yields a cost. It counts as Divine 2.").magic.length === 1);
check("every build parses at least one category", builds.every((b) => b.hdValue !== undefined || b.fighting || b.thievery !== undefined || b.magic.length > 0));

const rung = (rows, value) => rows.find((r) => r.value === value);
/** What a parsed build costs, its parts priced off the assembled ladders. */
const priceOf = (b) => {
  let total = 0;
  if (b.hdValue !== undefined) total += rung(asm.hd, b.hdValue).cost;
  if (b.fighting) total += asm.fighting.find((r) => r.value === b.fighting.value && r.sub === b.fighting.sub).cost;
  if (b.thievery !== undefined) total += rung(asm.thievery, b.thievery).cost;
  for (const m of b.magic) total += rung(magic[m.type].values, m.value).cost;
  if (b.race) {
    const race = asm.races[b.race.key];
    total += rung(race.values, b.race.value).xpCost;
    if (race.stacksWith && b.magic.some((m) => m.type === race.stacksWith)) total -= race.stackXpDiscount;
  }
  return total;
};
const priced = builds.filter((b) => b.xp !== undefined);
check("most builds state a cost", priced.length >= Math.ceil(builds.length / 2));
check("every stated build cost equals its parts priced off the ladders", priced.every((b) => priceOf(b) === b.xp));

/** The racial-cap row a build lands on is read from its rung values summed. */
const pointsOf = (b) => (b.hdValue ?? 0) + (b.fighting?.value ?? 0) + (b.thievery ?? 0) + b.magic.reduce((n, m) => n + m.value, 0) + (b.race?.value ?? 0);
const capped = builds.filter((b) => b.cap !== undefined);
check("a capped build is always a racial one", capped.length > 0 && capped.every((b) => b.race));
check("every build's printed cap equals the racial cap row its rung values total to", capped.every((b) => caps.find((c) => c.points === pointsOf(b))?.maxLevel === b.cap));

check("a build's traded final cost, where printed, is an integer apart from the base cost", builds.filter((b) => b.finalXp !== undefined).every((b) => isInt(b.finalXp)) && builds.some((b) => b.finalXp !== undefined && b.xp !== undefined && b.finalXp !== b.xp));
check("a build is cut at the next class's runin, so its notes state one cost at most", builds.every((b) => (b.notes.match(/yields an? [\d,]+\s*xp cost/g) ?? []).length <= 1));

console.log(`test-class-builder-tables: ${pass} checks passed.`);
