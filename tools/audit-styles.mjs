/**
 * Two style faults that are invisible until somebody opens the sheet.
 *
 * **An unstyled class.** A template writes a class no stylesheet mentions;
 * nothing errors, the element inherits whatever it happens to inherit, and
 * the intended layout never existed.
 *
 * **An undefined token.** Consumers read design tokens BARE, never with a
 * literal fallback, precisely so a missing one reveals itself — CSS drops an
 * invalid declaration silently otherwise. See docs/lib/DECISIONS.md, "One
 * token publisher".
 *
 * Comments are stripped before either scan.
 *
 * Usage: node tools/audit-styles.mjs   (also runs via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const STYLE_DIRS = ["styles", "vendor/acks-design"];
const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** Every stylesheet that ships, as stripped source. */
function sheets() {
  const out = [];
  for (const dir of STYLE_DIRS) {
    const abs = path.join(ROOT, dir);
    if (!fs.existsSync(abs)) continue;
    for (const f of fs.readdirSync(abs)) {
      if (f.endsWith(".css")) out.push({ file: `${dir}/${f}`, css: strip(fs.readFileSync(path.join(abs, f), "utf8")) });
    }
  }
  return out;
}

/** Every `acks-*` class a template actually puts on an element. */
function templateClasses() {
  const used = new Map();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".hbs")) {
        const src = fs.readFileSync(p, "utf8");
        // Only static class lists. A `class="{{cls}}"` is computed elsewhere
        // and cannot be checked from here without guessing.
        for (const m of src.matchAll(/class="([^"{}]*)"/g)) {
          for (const c of m[1].split(/\s+/)) {
            if (!c.startsWith("acks-")) continue;
            if (!used.has(c)) used.set(c, new Set());
            used.get(c).add(path.relative(ROOT, p));
          }
        }
      }
    }
  };
  const templates = path.join(ROOT, "templates");
  if (fs.existsSync(templates)) walk(templates);
  return used;
}

const all = sheets();
const styled = new Set();
const declared = new Set();
for (const { css } of all) {
  for (const m of css.matchAll(/\.(acks-[A-Za-z0-9_-]+)/g)) styled.add(m[1]);
  for (const m of css.matchAll(/(--acks-[A-Za-z0-9-]+)\s*:/g)) declared.add(m[1]);
}

const problems = [];

const used = templateClasses();
for (const [cls, files] of [...used].sort()) {
  if (!styled.has(cls)) problems.push(`unstyled class .${cls} — used in ${[...files].join(", ")}`);
}

// Only this module's own sheets are held to the token rule; the vendored
// design layer is the publisher and declares what it consumes.
for (const { file, css } of all) {
  if (!file.startsWith("styles/")) continue;
  for (const m of css.matchAll(/var\((--acks-[A-Za-z0-9-]+)/g)) {
    if (!declared.has(m[1])) problems.push(`${file}: reads undeclared token ${m[1]}`);
  }
}

if (problems.length) {
  console.error(`audit-styles: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`audit-styles OK (${used.size} template class(es), ${declared.size} token(s) declared).`);
