/**
 * The developer reference (docs/site/tools/render-reference.mjs), held to the
 * source it reads: every namespace key followed to a declaration, every
 * import naming a file, and both counted a second way that does not go through
 * the extractors. A key the reader cannot follow fails here, at the commit
 * that adds it, and not at the release that zips the pages.
 *
 * What a page looks like in a browser, and whether a chart draws, are the
 * site build's to show.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { renderReference } from "../docs/site/tools/render-reference.mjs";
import { extractApi } from "../docs/site/tools/extract-api.mjs";
import { extractImports } from "../docs/site/tools/extract-imports.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };

const link = { source: (f, l) => `${f}:${l ?? ""}`, map: (d) => `#${d}`, api: (f) => `api/${f}`, fromIndex: (f) => f };
const reference = renderReference(link);
const api = extractApi();
const graph = extractImports();

ok("nothing is left unfollowed", () => {
  assert.deepEqual(reference.problems, []);
});

ok("every namespace assignment in scripts/ has a page", () => {
  const assigned = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".mjs")) for (const m of fs.readFileSync(full, "utf8").matchAll(/^\s*acksExtras\.([a-zA-Z]+)\s*=[^=]/gm)) assigned.add(m[1]);
    }
  };
  walk(path.join(ROOT, "scripts"));
  assert.deepEqual(api.features.map((f) => f.feature).sort(), [...assigned].sort());
  for (const name of assigned) assert.ok(reference.pages.some((p) => p.path === `api/${name}`), `no page for ${name}`);
});

ok("every namespace holds keys, and each key names a file and a line that exist", () => {
  for (const feature of api.features) {
    assert.ok(feature.rows.length > 0, `${feature.feature} is empty`);
    for (const row of feature.rows) {
      const file = path.join(ROOT, row.file);
      assert.ok(fs.existsSync(file), `${feature.feature}.${row.key} names ${row.file}`);
      assert.ok(row.line >= 1 && row.line <= fs.readFileSync(file, "utf8").split("\n").length, `${feature.feature}.${row.key} line ${row.line}`);
    }
  }
});

ok("a key is listed once per namespace", () => {
  for (const feature of api.features) {
    const keys = feature.rows.filter((r) => !r.group).map((r) => r.key);
    const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
    assert.deepEqual([...new Set(twice)], [], `${feature.feature} repeats a key`);
  }
});

ok("the entry point's imports are the graph's", () => {
  const entry = fs.readFileSync(path.join(ROOT, "scripts", "module.mjs"), "utf8");
  const written = [...entry.matchAll(/^import\s+"\.\/([^"]+)";/gm)].map((m) => `scripts/${m[1]}`).sort();
  const charted = graph.edges.filter((e) => e.from === "scripts/module.mjs").map((e) => e.to).sort();
  assert.ok(written.length > 0);
  assert.deepEqual(charted, written);
});

ok("every charted file is on disk, and no file is charted twice", () => {
  const seen = new Set();
  for (const f of graph.files) {
    assert.ok(fs.existsSync(path.join(ROOT, f.file)), f.file);
    assert.ok(!seen.has(f.file), `${f.file} twice`);
    seen.add(f.file);
  }
  for (const e of graph.edges) assert.ok(seen.has(e.from) && seen.has(e.to), `${e.from} -> ${e.to}`);
});

ok("chart fences close, and a chart's nodes are declared before its arrows use them", () => {
  const map = reference.pages.find((p) => p.path === "architecture").body;
  const charts = [...map.matchAll(/```mermaid\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(charts.length * 2, map.match(/^```/gm).length);
  assert.ok(charts.length > 1);
  for (const chart of charts) {
    const nodes = new Set([...chart.matchAll(/^\s*(\w+)\["/gm)].map((m) => m[1]));
    for (const m of chart.matchAll(/^\s*(\w+) -\.?->? (\w+)$/gm)) assert.ok(nodes.has(m[1]) && nodes.has(m[2]), `${m[1]} -> ${m[2]}`);
  }
});

console.log(`\n${passed} passed`);
