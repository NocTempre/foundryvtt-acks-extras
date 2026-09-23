/**
 * Checks that every named import actually exists in the module it names.
 *
 * A wrong name here is MODULE-BREAKING and offline-invisible: the browser
 * throws at load and nothing else in this repo notices, since validate reads
 * files and the test suite imports only the pure modules. Matches import
 * specifiers textually against `export` statements in the target; a file
 * re-exporting with `export * from` is treated as opaque and its importers
 * are skipped.
 *
 * Usage: node tools/audit-imports.mjs   (also runs via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SCRIPTS = path.join(ROOT, "scripts");

const files = [];
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (e.name.endsWith(".mjs")) files.push(p);
  }
};
if (fs.existsSync(SCRIPTS)) walk(SCRIPTS);

/** What one module offers by name, and whether it re-exports opaquely. */
const exportsOf = new Map();
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  const names = new Set();
  let opaque = /export\s+\*\s+from/.test(src);
  for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\s*\*?|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g)) names.add(m[1]);
  // `export { a, b as c }` — the exported name is what follows `as`.
  for (const m of src.matchAll(/export\s*\{([^}]*)\}/g)) {
    for (const part of m[1].split(",")) {
      const name = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.add(name);
    }
  }
  if (/export\s+default/.test(src)) names.add("default");
  exportsOf.set(path.resolve(file), { names, opaque });
}

const problems = [];
for (const file of files) {
  const src = fs.readFileSync(file, "utf8");
  for (const m of src.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](\.[^"']+)["']/g)) {
    const target = path.resolve(path.dirname(file), m[2]);
    const info = exportsOf.get(target);
    if (!info || info.opaque) continue; // outside scripts/, or re-exports opaquely
    for (const part of m[1].split(",")) {
      const wanted = part.trim().split(/\s+as\s+/)[0]?.trim();
      if (!wanted || wanted === "type") continue;
      if (!info.names.has(wanted)) {
        problems.push(`${path.relative(ROOT, file)}: imports '${wanted}' from ${m[2]}, which does not export it`);
      }
    }
  }
}

if (problems.length) {
  console.error(`audit-imports: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`audit-imports OK (${files.length} module(s) resolved).`);
