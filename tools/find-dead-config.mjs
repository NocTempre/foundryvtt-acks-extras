/**
 * Find declared-but-unconsumed RULES — config properties and constants tables
 * that nothing reads.
 *
 * A rule that is written down in a table and never read is invisible: it looks
 * implemented to anyone reading the data, and does nothing at the table. This
 * module had ten of them (shield encumbrance by carry state, a phalanx shield
 * being unusable mounted, a kite shield that cannot be slung on the back), all
 * authored, all inert. Run this after adding a table so the next one is caught
 * while it is still cheap.
 *
 * ADVISORY: exit 0 always. A hit is a question, not a failure — some entries
 * are deliberately data-only or a documented seam. Say WHY in a comment next to
 * the entry so the answer survives the next sweep.
 *
 * Usage: npm run find:dead-config     (or: node tools/find-dead-config.mjs [dir])
 *
 * Eventual home is acks-module-template so every module gets it; kept here
 * until the toolchain sync can carry it.
 */
import fs from "node:fs";
import path from "node:path";

const ROOT = process.argv[2] ?? ".";
const CONFIG = path.join(ROOT, "scripts", "config.mjs");
if (!fs.existsSync(CONFIG)) {
  console.log(`no scripts/config.mjs under ${ROOT}`);
  process.exit(0);
}

const cfg = fs.readFileSync(CONFIG, "utf8");

// Value-object properties: a `name:` that sits INSIDE braces on a line that
// also opens a `{`. i.e. lines shaped `key: { a: 1, b: 2 },`
const declared = new Map(); // prop -> example line
for (const line of cfg.split("\n")) {
  const body = line.slice(line.indexOf("{") + 1);
  if (!line.includes("{") || !line.includes(":")) continue;
  for (const m of body.matchAll(/([a-zA-Z][a-zA-Z0-9_]*)\s*:/g)) {
    if (!declared.has(m[1])) declared.set(m[1], line.trim().slice(0, 110));
  }
}

// Every other source file in the module.
const sources = [];
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (f.endsWith(".mjs") && path.resolve(f) !== path.resolve(CONFIG)) {
      sources.push([f, fs.readFileSync(f, "utf8")]);
    }
  }
};
walk(path.join(ROOT, "scripts"));
walk(path.join(ROOT, "tools"));

const dead = [];
for (const [prop, example] of declared) {
  if (prop.length < 3) continue;
  // Read as `.prop`, `["prop"]`, `{ prop }` destructure, or `prop:` in a test.
  const patterns = [
    new RegExp(`\\.${prop}\\b`),
    new RegExp(`\\[["'\`]${prop}["'\`]\\]`),
    new RegExp(`\\b${prop}\\s*[,}]`), // destructuring
  ];
  const used = sources.some(([, src]) => patterns.some((re) => re.test(src)));
  if (!used) dead.push({ prop, example });
}

console.log(`${path.basename(path.resolve(ROOT))}: ${dead.length} config propert(ies) declared but never read\n`);
for (const d of dead) console.log(`  ${d.prop.padEnd(20)} ${d.example}`);
