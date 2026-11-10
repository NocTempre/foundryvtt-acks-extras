/**
 * Which file imports which, across `scripts/`: every relative `import`,
 * `export … from` and `import()` specifier, resolved to the file it names and
 * grouped by the feature directory each end sits in.
 *
 * The files are read, never imported, for the reason `parse.mjs` gives. A
 * specifier that names no file on disk is returned in `missing`, and the
 * callers exit non-zero on it: Foundry would fail the same import at load.
 */
import fs from "node:fs";
import path from "node:path";

import { REPO, walk, stripComments, featureOf } from "./parse.mjs";

const SCRIPTS = path.join(REPO, "scripts");
const rel = (file) => path.relative(REPO, file).split(path.sep).join("/");

/** The folder a file is charted under inside its feature: its first sub-directory, or the feature root. */
export function groupOf(file) {
  const parts = file.split("/").slice(2);
  return parts.length > 1 ? `${parts[0]}/` : "(root)";
}

/**
 * The import graph of `scripts/`.
 *
 * @returns {{files: Array<{file: string, feature: string, lines: number}>,
 *   edges: Array<{from: string, to: string, dynamic: boolean}>,
 *   missing: Array<{from: string, specifier: string}>}}
 *   paths are repo-relative; `feature` is the directory under `scripts/`, or
 *   `"module"` for a file directly in it. One edge per ordered pair of files.
 */
export function extractImports() {
  const files = [];
  const edges = new Map();
  const missing = [];
  const specifier = /(?:^|[\s;}])(?:import|export)\s+(?:[^"'`;()]*?\s+from\s+)?(["'])(\.{1,2}\/[^"']*)\1|\bimport\s*\(\s*(["'])(\.{1,2}\/[^"']*)\3\s*\)/g;

  for (const abs of walk(SCRIPTS).sort()) {
    const src = fs.readFileSync(abs, "utf8");
    const from = rel(abs);
    files.push({ file: from, feature: featureOf(abs), lines: src.split("\n").length });
    for (const m of stripComments(src).matchAll(specifier)) {
      const spec = m[2] ?? m[4];
      const target = path.resolve(path.dirname(abs), spec);
      if (!fs.existsSync(target)) {
        missing.push({ from, specifier: spec });
        continue;
      }
      const to = rel(target);
      if (!to.startsWith("scripts/") || to === from) continue;
      const key = `${from}\n${to}`;
      const dynamic = m[4] != null;
      // A pair imported both ways counts as static: it is evaluated at load.
      if (!edges.has(key) || !dynamic) edges.set(key, { from, to, dynamic });
    }
  }
  return { files, edges: [...edges.values()], missing };
}

/** The feature a repo-relative script path belongs to. */
export function featureOfPath(file) {
  const parts = file.split("/");
  return parts.length > 2 ? parts[1] : "module";
}
