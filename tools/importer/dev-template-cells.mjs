/**
 * DEV-ONLY harness: dump every class's Starting Equipment cells exactly as the
 * SHIPPING executor reads them out of the compiled templates grid, and run the
 * shipping splitter over each one.
 *
 * This is the audit surface for the one place a class's kit can go wrong
 * invisibly. A cell that a column span mis-cuts still looks like prose — "1
 * week's iron" reads as a shortened phrase, not as a truncation — so the only
 * way to see it is beside what the splitter then makes of it.
 *
 * The menu is built the way a real import builds it: the equipment cookbook,
 * plus the weapon and armour GRIDS materialized from the same book. Without
 * the second half no weapon resolves and every line looks broken.
 *
 * Reads the LOCAL-ONLY reference library, so it is never wired to `npm test`
 * and never runs in CI. Output is licensed page text: stdout only, never a
 * file inside the repo.
 *
 * Usage: node tools/dev-template-cells.mjs [--unresolved] [classKey ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { parseEquipment, nameForms, liftBookSpells, liftCompanions } from "../../scripts/importer/cookbook.mjs";
import { extractWeaponsFromDoc } from "../../scripts/importer/weapon-tables.mjs";
import { extractArmorFromDoc } from "../../scripts/importer/armor-tables.mjs";
import { extractPriceRowsFromDoc, priceKey } from "../../scripts/importer/gear-prices.mjs";
import { slugLabel } from "../../scripts/importer/table-extract.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const args = process.argv.slice(2);
const onlyUnresolved = args.includes("--unresolved");
const wanted = new Set(args.filter((a) => !a.startsWith("--")));

if (!fs.existsSync(FILES.rr)) {
  console.log("SKIP: the local reference library is not on this machine.");
  process.exit(0);
}

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
const books = fs
  .readdirSync(COOKBOOK)
  .filter((f) => f.endsWith(".json") && !["registers.json", "index.json"].includes(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8")));

const fold = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, "");
const formsOf = (n) => nameForms(n).map((text) => ({ text, fold: fold(text) })).filter((f) => f.fold);
const menuRow = (name, ref) => ({
  name,
  ref,
  fold: fold(name),
  foldStripped: fold(String(name).replace(/\([^)]*\)/g, " ")),
  forms: formsOf(name),
  stripped: formsOf(String(name).replace(/\([^)]*\)/g, " ")),
});

const { doc } = await openBook(fs.readFileSync(FILES.rr));

/* The menu: the equipment cookbook, then the grids a real import materializes
 * beside it (`materializedGearMenu` at runtime — the same two halves). */
const menu = [];
const seen = new Set();
for (const cb of books) {
  for (const [id, e] of Object.entries(cb.entries ?? {})) {
    if (e.kind !== "kind.equipment" || seen.has(id)) continue;
    seen.add(id);
    menu.push(menuRow(e.name, id));
  }
}
const slugId = (prefix, name) =>
  `${prefix}.${slugLabel(name).replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase())}`;
for (const row of await extractWeaponsFromDoc(doc, pageItems).catch(() => [])) {
  const id = slugId("def.weapon", row.name);
  if (!seen.has(id)) (seen.add(id), menu.push(menuRow(row.name, id)));
}
for (const row of await extractArmorFromDoc(doc, pageItems).catch(() => [])) {
  const id = slugId("def.armor", row.name);
  if (!seen.has(id)) (seen.add(id), menu.push(menuRow(row.name, id)));
}
// The price grid, minus the rows a described entry already claims — the same
// question `importPricedGear` asks before it creates anything.
const cookbookKeys = new Set(menu.map((m) => priceKey(m.name)).filter(Boolean));
const pricedId = (name) =>
  `def.priced.${String(name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "row"}`;
let pricedRows = 0;
for (const row of await extractPriceRowsFromDoc(doc, pageItems).catch(() => [])) {
  pricedRows++;
  const id = pricedId(row.name);
  if (cookbookKeys.has(priceKey(row.name)) || seen.has(id)) continue;
  seen.add(id);
  menu.push(menuRow(row.name, id));
}
menu.sort((a, b) => b.name.length - a.name.length);
const bySource = (p) => menu.filter((m) => m.ref.startsWith(p)).length;
console.log(
  `menu: ${menu.length} rows — ${bySource("def.equip")} described, ${bySource("def.weapon")} weapon, ` +
    `${bySource("def.armor")} armour, ${bySource("def.priced")} priced (of ${pricedRows} grid rows)`,
);

// `--menu <substring>` answers the authoring question directly: what does the
// book actually CALL the thing this cell describes?
const menuQuery = args.includes("--menu") ? (args[args.indexOf("--menu") + 1] ?? "") : null;
if (menuQuery != null) {
  const q = menuQuery.toLowerCase();
  for (const m of [...menu].sort((a, b) => a.name.localeCompare(b.name))) {
    if (m.name.toLowerCase().includes(q)) console.log(`${m.name}  →  ${m.ref}`);
  }
  process.exit(0);
}

const classEntries = [];
for (const cb of books) {
  for (const [id, e] of Object.entries(cb.entries ?? {})) {
    if (e.kind !== "kind.class" || e.book !== "rr") continue;
    classEntries.push([cb, id, e]);
  }
}
classEntries.sort((a, b) => a[2].name.localeCompare(b[2].name));

let cells = 0;
let unresolved = 0;
const misses = new Map();
const pairs = new Map();
const lifts = [];
for (const [cb, id, entry] of classEntries) {
  const key = entry.meta?.key ?? fold(entry.name);
  if (wanted.size && !wanted.has(key)) continue;
  const node = await executeEntry(doc, cb, registers, id).catch(() => null);
  const rows = node?.fields?.templates?.rows ?? [];
  if (!rows.length) {
    console.log(`\n### ${entry.name} (${key}) — NO TEMPLATE ROWS`);
    continue;
  }
  const lines = [];
  for (const row of rows) {
    const cell = String(row.cells.equipment ?? "");
    cells++;
    const parsed = parseEquipment(cell, menu, { ...(registers.tables?.equipmentPhrase ?? {}), ...(entry.equipAliases ?? {}) });
    // Mirror what `bindClass` does after the split, or the audit reports as
    // unresolved the very descriptors that are lifted off the item list.
    liftBookSpells(parsed.items);
    const companions = [];
    liftCompanions(parsed.items, companions, registers.tables?.companionPhrase);
    for (const c of companions) lifts.push(`${c.selection} → ${c.ref}`);
    const miss = parsed.items.filter((i) => !i.ref);
    unresolved += miss.length;
    for (const m of miss) misses.set(m.name.toLowerCase(), (misses.get(m.name.toLowerCase()) ?? 0) + 1);
    for (const i of parsed.items) pairs.set(i.name.toLowerCase(), i.ref);
    if (onlyUnresolved && !miss.length) continue;
    lines.push(`  [${row.cells.band?.min}-${row.cells.band?.max}] ${cell}`);
    for (const i of parsed.items) lines.push(`     ${i.ref ? "ok  " : "MISS"} ${i.qty > 1 ? `${i.qty}× ` : ""}${i.name}${i.ref ? `  → ${i.ref}` : ""}`);
  }
  if (lines.length) console.log(`\n### ${entry.name} (${key})\n${lines.join("\n")}`);
}

console.log(`\n--- ${cells} equipment cell(s), ${unresolved} descriptor(s) with no ref ---`);
if (lifts.length) console.log(`(${lifts.length} creature(s) lifted onto a companion slot: ${[...new Set(lifts)].join(", ")})`);
for (const [name, n] of [...misses.entries()].sort((a, b) => b[1] - a[1])) console.log(`${String(n).padStart(3)}  ${name}`);

// `--pairs` is the review surface: every DISTINCT descriptor beside the row it
// was matched to, so a wrong base — which reads as perfectly fine in a cell —
// can be checked by eye. Grouped by target, because a mismatch shows up as one
// catalogue row collecting descriptors that have nothing to do with it.
if (args.includes("--pairs")) {
  const byTarget = new Map();
  for (const [desc, ref] of pairs) {
    const target = menu.find((m) => m.ref === ref)?.name ?? "(no base)";
    if (!byTarget.has(target)) byTarget.set(target, new Set());
    byTarget.get(target).add(desc);
  }
  console.log(`\n=== ${pairs.size} distinct descriptor(s) over ${byTarget.size} target(s) ===`);
  for (const [target, descs] of [...byTarget.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`\n${target}  [${descs.size}]`);
    for (const d of [...descs].sort()) console.log(`    ${d}`);
  }
}
