/**
 * LOCAL-ONLY: the beastman organisation axes built from this machine's own
 * Monstrous Manual through the importer's path. The six organisation tables
 * (`TABLE_RECIPES.monsters`) are read from the book and registered as the world
 * would hold them, the family's variants are the cookbook's, `organisationAxes`
 * mints the axes onto them, and for every breed and every troop row, and every
 * breed and every trait row, the engine resolves a generation (`chooseAxes`
 * with the registry's bands, then `applyGeneratedOrganisation`).
 *
 * Reports by ordinal (breeds in the table's column order, troop rows R1.. and
 * trait rows T1.. in the table's row order): which are available, which are
 * blank, and which standing figures a generation wrote. It prints no figure,
 * label or name. The availability grids are to be read against the printed
 * tables by hand. Exits 1 on a table that reads empty, an axis that is not
 * minted, or a generation that throws; skips (exit 0) without the reference
 * books.
 *
 * Usage: node tools/importer/check-organisation-axes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { extractTable, slugLabel } from "../../scripts/importer/table-extract.mjs";
import { extractPlain, locatePageNumber, recipeLocates, recipePages } from "../../scripts/importer/tables-binding.mjs";
import { TABLE_RECIPES } from "../../scripts/importer/table-recipes.mjs";
import { overviewIsLore } from "../../scripts/importer/leader-roles.mjs";
import { organisationAxes } from "../../scripts/importer/organisation-axes.mjs";
import { applyGeneratedOrganisation, importedOrganisation, GEAR_AXIS, TRAIT_AXIS, TROOP_AXIS } from "../../scripts/monsters/organisation.mjs";
import { chooseAxes, optionAvailable, resolveActor } from "../../scripts/lib/template-logic.mjs";
import { registryBands } from "../../scripts/lib/template-bands.mjs";
import { PRIORITY, registerTable } from "../../scripts/lib/tables.mjs";
import { FILES } from "./reference-lib.mjs";

if (!fs.existsSync(FILES.mm)) {
  console.log("organisation axes: SKIPPED — the local Monstrous Manual is not on this machine.");
  process.exit(0);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const cb = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", "mm.json"), "utf8"));
const { doc } = await openBook(fs.readFileSync(FILES.mm), { book: "mm" });
const NAMES = ["beastmanVillage", "beastmanLeaders", "beastmanSpecialTroops", "beastmanTraits", "beastmanTroopRules", "beastmanTraitRules", "beastmanEquipment", "beastmanOrganisation"];

/** One table read from the book the way the import reads it. */
async function read(recipe) {
  if (recipe.valueBlocks) {
    const out = {};
    for (const { id, args } of recipeLocates(recipe)) {
      const page = await locatePageNumber(doc, args);
      if (page == null) continue;
      const block = recipe.valueBlocks.find((b) => b.id === id);
      const { items } = await pageItems(doc, page);
      const runOn = block.values.some((v) => v.runOn) && page < doc.numPages ? (await pageItems(doc, page + 1)).items : undefined;
      out[id] = extractTable(items, { ...recipe, valueBlocks: null, emit: null, values: block.values, column: block.column ?? recipe.column, yMin: block.yMin ?? recipe.yMin, yMax: block.yMax ?? recipe.yMax, section: block.section, runOn });
    }
    return out;
  }
  const page = await locatePageNumber(doc, recipe);
  if (page == null) return null;
  const span = [(await pageItems(doc, page)).items];
  for (let k = 1; k < recipePages(recipe) && page + k <= doc.numPages; k++) span.push((await pageItems(doc, page + k)).items);
  return extractPlain(recipePages(recipe) > 1 ? span : span[0], recipe);
}

const tables = {};
let failed = false;
for (const name of NAMES) {
  const recipe = TABLE_RECIPES.monsters?.tables?.[name];
  try {
    tables[name] = recipe ? await read(recipe) : null;
  } catch {
    tables[name] = null;
  }
  if (!tables[name] || !Object.keys(tables[name]).length) {
    console.log(`table ${NAMES.indexOf(name) + 1}: read empty`);
    failed = true;
  }
}
registerTable({ id: "monsters", tables: Object.fromEntries(Object.entries(tables).filter(([, v]) => v)), cites: {} }, { priority: PRIORITY.WORLD });
const org = importedOrganisation();
console.log(`rows read: troops ${org.troops.rows.length}, traits ${org.traits.rows.length}, leaders ${org.leaders.rows.length}, troop rules ${org.troopRules.rows.length}, trait rules ${org.traitRules.rows.length}, equipment ${org.equipment.rows.length}`);

const fam = cb.families?.["mm.familyBeastman"];
const variants = (fam?.members ?? []).filter((m) => !overviewIsLore(m, fam.members, fam.name, (id) => cb.entries[id])).map((m) => slugLabel(m.variant));
const columns = Object.keys(org.troops.rows[0]?.cells ?? {});
const breeds = columns.filter((c) => variants.includes(c));
if (breeds.length !== columns.length) {
  console.log("a table column is no variant of the family");
  failed = true;
}
const options = breeds.map((key) => ({ key, label: key, nameLabel: "", merge: { ac: { value: 5 }, attack: { throw: 11 }, details: { morale: 0 }, damage: { mod: { melee: 0, missile: 0 } } }, flags: {} }));
const axes = [{ key: "variant", label: "Variant", roll: "", derive: { from: "", max: null }, options }];
const cells = [];
const minted = organisationAxes({ options, axes, cells, org, labels: {}, out: {} });
console.log(`axes minted: ${minted.length} of 4 (${axes.map((a) => a.key).join(" > ")}); cells: ${cells.length} (natural ${cells.filter((c) => c.by.includes(TRAIT_AXIS)).length}, grade ${cells.filter((c) => c.key.endsWith("|table")).length})`);
if (minted.length !== 4) failed = true;

const system = { axes, cells };
const bandOf = registryBands();
const rng = () => 0.5;
const grid = (axisKey, rows, tag) => {
  const axis = axes.find((a) => a.key === axisKey);
  console.log(`\n${tag}: rows by breed (A available, . blank), then what each generation wrote`);
  rows.forEach((row, r) => {
    const opt = axis.options.find((o) => o.key === row.key);
    const marks = breeds.map((b) => (optionAvailable(system, axis, opt, { variant: b }, bandOf) ? "A" : "."));
    const wrote = breeds.map((b, i) => {
      if (marks[i] !== "A") return "-";
      const choices = chooseAxes(system, { pinned: { variant: b, [axisKey]: row.key }, rng, bandOf }).choices;
      if (choices[axisKey] !== row.key) return "!";
      const resolved = resolveActor({ axes, cells }, choices);
      try {
        applyGeneratedOrganisation(resolved, { choices, org });
      } catch {
        failed = true;
        return "X";
      }
      const parts = Object.keys(resolved.flags?.["acks-extras"]?.extras?.derived?.organisation ?? {}).filter((k) => k !== "troop" && k !== "trait");
      return `${parts.length}${resolved.items.length ? `+${resolved.items.length}i` : ""}`;
    });
    console.log(`  ${tag[0]}${r + 1}: ${marks.join(" ")}   wrote ${wrote.join(" ")}`);
  });
};
console.log(`breeds in column order: ${breeds.length}`);
grid(TROOP_AXIS, org.troops.rows, "troop");
grid(TRAIT_AXIS, org.traits.rows, "trait");
console.log(`\ngear axis: ${axes.find((a) => a.key === GEAR_AXIS)?.options.length ?? 0} options`);
console.log("leader grades by breed (rank rows R1.., 1 = a table cell):");
org.leaders.rows.forEach((row, r) => console.log(`  G${r + 1}: ${breeds.map((b) => (row.cells[b] ? "1" : "0")).join(" ")}`));
process.exit(failed ? 1 : 0);
