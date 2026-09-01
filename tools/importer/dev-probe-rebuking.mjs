/**
 * DEV-ONLY: replay the rebuking pipeline against the real book and report its
 * STRUCTURE — how many ladders the class publishes, and how many throws the
 * power gets, of which shape. Never shipped; it drives extraction that reads
 * book content, which stays in the reader's own book.
 *
 * Usage: node tools/dev-probe-rebuking.mjs [cookbookDir]
 */
import fs from "node:fs";
import path from "node:path";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { bindClass, bindAbility, gridLadders } from "../../scripts/importer/cookbook.mjs";
import { FILES } from "./reference-lib.mjs";

globalThis.game ??= { i18n: { format: (k) => k, localize: (k) => k } };

const dir = process.argv[2] ?? "cookbook";
const classes = JSON.parse(fs.readFileSync(path.join(dir, "classes.json"), "utf8"));
const powers = JSON.parse(fs.readFileSync(path.join(dir, "powers.json"), "utf8"));
const registers = JSON.parse(fs.readFileSync(path.join(dir, "registers.json"), "utf8"));
const { doc } = await openBook(fs.readFileSync(FILES.rr));

const clsNode = await executeEntry(doc, classes, registers, "def.class.crusader");
const bound = bindClass(classes.entries["def.class.crusader"], clsNode, "def.class.crusader");
const published = (bound?.system?.ladders ?? []).filter((l) => l.key.startsWith("rebuke"));
process.stdout.write(`class publishes: ${published.length} rebuking ladder(s)\n`);
for (const l of published) {
  const shape = l.values.map((v) => (v.value != null ? "n" : v.outcome === "none" ? "-" : "A")).join("");
  process.stdout.write(`  ${l.key.padEnd(20)} rungs=${String(l.values.length).padStart(2)} shape=${shape}\n`);
}

// The binder's own resolver needs a live session; feed it the ladders directly,
// which is what laddersForEntry computes.
const ladders = { t: gridLadders(clsNode.fields.rebuking, "rebuke").map(({ key, label }) => ({ key, label })) };
const powNode = await executeEntry(doc, powers, registers, "def.power.rebukeUndead");
const ability = bindAbility(powers.entries["def.power.rebukeUndead"], powNode, "def.power.rebukeUndead", { ladders });
const rolls = ability.flags["acks-extras"].extras.rolls ?? [];
process.stdout.write(`\npower gets: ${rolls.length} throw(s)\n`);
for (const r of rolls) {
  const t = r.target ?? {};
  const shape = r.rollType === "measure" ? `measure dice=${/^\d+d\d+$/.test(r.formula) ? "located" : r.formula}` : `${t.kind} as=${t.as} table=${t.table}`;
  process.stdout.write(`  ${String(r.key).padEnd(22)} ${shape}\n`);
}
const orphan = rolls.filter((r) => r.target?.table && !published.some((l) => l.key === r.target.table));
process.stdout.write(`\nthrows naming a ladder the class does not publish: ${orphan.length}\n`);
