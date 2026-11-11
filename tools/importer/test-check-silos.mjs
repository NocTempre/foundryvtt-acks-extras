/**
 * The silo gate against fixture trees: one planted violation per rule fires, a
 * clean tree passes, a bare `silo-ok` fails, and a stale baseline entry fails.
 * Each fixture is written under a scratch directory of its own and removed. No
 * Foundry, no PDFs.
 *
 * The gate reads Node's bundled acorn, which needs `--expose-internals`; this
 * suite starts itself again with the flag when it lacks it.
 */
import assert from "node:assert";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

try {
  createRequire(import.meta.url)("internal/deps/acorn/acorn/dist/acorn");
} catch {
  const again = spawnSync(process.execPath, ["--expose-internals", fileURLToPath(import.meta.url)], { stdio: "inherit" });
  process.exit(again.status ?? 1);
}

const { analyse, compareBaseline, countByRule, factsOf } = await import("./check-silos.mjs");

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

const SILO = {
  id: "ose",
  books: ["qd9"],
  kinds: ["kind.oseMonster"],
  members: ["scripts/importer/ose-x.mjs", "templates/part.hbs", "tools/importer/test-ose-*.mjs"],
  dir: "scripts/importer/silos/ose/",
  entry: "scripts/importer/silos/ose/index.mjs",
  manifest: "scripts/importer/silos/index.mjs",
  stylesheet: "styles/ose.css",
  importExempt: [{ file: "scripts/importer/silos/index.mjs", target: "scripts/importer/silos/ose/index.mjs" }, { file: "tools/importer/silos.mjs" }],
  literalExempt: ["scripts/importer/books.mjs"],
};

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "acks-check-silos-"));
let n = 0;

/** Writes a fixture tree and returns what the gate finds in it. */
function scan(files, { moduleJson = { esmodules: ["scripts/module.mjs"], styles: [] }, silo = SILO } = {}) {
  const root = path.join(scratch, `t${n++}`);
  const all = { "module.json": JSON.stringify(moduleJson), "scripts/importer/ose-x.mjs": "export const x = 1;\n", "templates/part.hbs": "<p></p>\n", ...files };
  for (const [file, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return analyse({ root, silo });
}
const has = (res, rule, file, target) => res.violations.some((v) => v.rule === rule && v.file === file && (target === undefined || v.target === target));

try {
  /* clean */
  const clean = scan({
    "scripts/module.mjs": 'import { y } from "./importer/other.mjs";\nexport const m = y; // dose, qd90 and ose are only words here\nexport const s = "dose";\nexport const t = "qd90";\n',
    "scripts/importer/other.mjs": "export const y = 2;\n",
    "tools/importer/test-ose-a.mjs": 'import { x } from "../../scripts/importer/ose-x.mjs";\nexport const lit = "ose.qd9";\n',
  });
  check("a clean tree has no violation", clean.violations.length === 0);
  check("a member inside the silo may import and name its own", clean.members.includes("tools/importer/test-ose-a.mjs"));
  check("the member glob and the exact paths expand", ["scripts/importer/ose-x.mjs", "templates/part.hbs"].every((m) => clean.members.includes(m)));
  check("a tree with no manifest reports the agreement as not yet applicable", clean.notes.some((t) => /not yet applicable/.test(t)));

  /* imports */
  const imp = scan({
    "scripts/module.mjs": "export {};\n",
    "scripts/a-static.mjs": 'import {\n  x,\n} from "./importer/ose-x.mjs";\nexport { x };\n',
    "scripts/b-reexport.mjs": 'export * from "./importer/ose-x.mjs";\n',
    "scripts/c-named.mjs": 'export { x } from "./importer/ose-x.mjs";\n',
    "scripts/d-dynamic.mjs": 'export const load = () => import("./importer/ose-x.mjs");\n',
    "scripts/e-template.mjs": "export const load = () => import(`./importer/ose-x.mjs`);\n",
    "scripts/f-computed.mjs": "export const load = (p) => import(p);\n",
    "tools/g-computed.mjs": "export const load = (p) => import(p);\n",
    "tools/h-static.mjs": 'import { x } from "../scripts/importer/ose-x.mjs";\nexport { x };\n',
    "scripts/importer/silos/ose/index.mjs": "export {};\n",
    "scripts/importer/silos/ose/inner.mjs": 'import { x } from "../../ose-x.mjs";\nexport { x };\n',
    "scripts/importer/silos/ose/computed.mjs": "export const load = (p) => import(p);\n",
    "scripts/importer/silos/index.mjs": 'import "./ose/index.mjs";\n',
    "scripts/i-into-dir.mjs": 'import "./importer/silos/ose/inner.mjs";\n',
    "scripts/j-bare.mjs": 'import path from "node:path";\nexport { path };\n',
  });
  const X = "scripts/importer/ose-x.mjs";
  check("a static multi-line import of a member fires", has(imp, "imports", "scripts/a-static.mjs", X));
  check("an `export * from` a member fires", has(imp, "imports", "scripts/b-reexport.mjs", X));
  check("an `export { } from` a member fires", has(imp, "imports", "scripts/c-named.mjs", X));
  check("a literal import() of a member fires", has(imp, "imports", "scripts/d-dynamic.mjs", X));
  check("an interpolation-free template import() of a member fires", has(imp, "imports", "scripts/e-template.mjs", X));
  check("a non-literal import() under scripts/ fires", has(imp, "imports", "scripts/f-computed.mjs", "<non-literal import()>"));
  check("a non-literal import() in a member under scripts/ fires too", has(imp, "imports", "scripts/importer/silos/ose/computed.mjs", "<non-literal import()>"));
  check("a non-literal import() under tools/ does not", !has(imp, "imports", "tools/g-computed.mjs"));
  check("a tool outside the silo importing a member fires", has(imp, "imports", "tools/h-static.mjs", X));
  check("a file under the silo directory is a member and may import one", !has(imp, "imports", "scripts/importer/silos/ose/inner.mjs"));
  check("the manifest importing the silo entry is exempt", !has(imp, "imports", "scripts/importer/silos/index.mjs"));
  check("an import into the silo directory fires", has(imp, "imports", "scripts/i-into-dir.mjs", "scripts/importer/silos/ose/inner.mjs"));
  check("a bare specifier is no edge", !has(imp, "imports", "scripts/j-bare.mjs"));

  /* literals */
  const lits = scan({
    "scripts/module.mjs": "export {};\n",
    "scripts/l1.mjs": 'export const a = "qd9";\nexport const b = "qd9.thing";\nexport const c = "ose";\nexport const d = "ose.x";\nexport const e = "kind.oseMonster";\n',
    "scripts/l2.mjs": "export const f = (v) => `ose.${v}`;\nexport const g = (T) => `${T}/part.hbs`;\nexport const o = { \"qd9\": 1 };\n",
    "scripts/l3.mjs": '// silo-ok: a stored flag the silo wrote\nexport const a = "ose";\nexport const b = "qd9"; // silo-ok: same\nexport const c = "kind.oseMonster";\n',
    "scripts/l4.mjs": '// silo-ok:\nexport const a = "ose";\n',
    "scripts/l5.mjs": '/* silo-ok */\nexport const a = 1;\n',
    "scripts/importer/books.mjs": 'export const ids = ["qd9", "ose"];\n',
    "tools/l6.mjs": 'export const a = "ose";\n',
  });
  check("a literal equal to a silo book id fires", has(lits, "literals", "scripts/l1.mjs", "qd9"));
  check("a literal starting with `<book>.` fires", has(lits, "literals", "scripts/l1.mjs", "qd9.thing"));
  check("a literal equal to the silo id fires", has(lits, "literals", "scripts/l1.mjs", "ose"));
  check("a literal starting with `ose.` fires", has(lits, "literals", "scripts/l1.mjs", "ose.x"));
  check("a literal equal to a silo kind fires", has(lits, "literals", "scripts/l1.mjs", "kind.oseMonster"));
  check("a template quasi starting with `ose.` fires", has(lits, "literals", "scripts/l2.mjs", "ose."));
  check("a template quasi ending in a member's basename fires", has(lits, "literals", "scripts/l2.mjs", "/part.hbs"));
  check("an object-key literal fires", has(lits, "literals", "scripts/l2.mjs", "qd9"));
  check("a silo-ok with a reason excuses the line below it and its own line", !has(lits, "literals", "scripts/l3.mjs", "ose") && !has(lits, "literals", "scripts/l3.mjs", "qd9"));
  check("a silo-ok excuses only the line it sits on or above", has(lits, "literals", "scripts/l3.mjs", "kind.oseMonster"));
  check("a bare `silo-ok:` fails and excuses nothing", has(lits, "literals", "scripts/l4.mjs", "silo-ok without a reason") && has(lits, "literals", "scripts/l4.mjs", "ose"));
  check("a `silo-ok` with no colon fails", has(lits, "literals", "scripts/l5.mjs", "silo-ok without a reason"));
  check("the registry file may name its ids", !has(lits, "literals", "scripts/importer/books.mjs"));
  check("tools/ is not under the literal rule", !has(lits, "literals", "tools/l6.mjs"));

  /* closure */
  const closed = scan({
    "scripts/module.mjs": 'import "./importer/mid.mjs";\n',
    "scripts/importer/mid.mjs": 'import "./ose-x.mjs";\n',
    "scripts/orphan.mjs": 'import "./importer/ose-x.mjs";\n',
  });
  check("a member reachable from module.json's entry fires", has(closed, "closure", "scripts/importer/ose-x.mjs", "scripts/module.mjs"));
  check("a member reachable from no entry point is not a closure violation", !has(closed, "closure", "templates/part.hbs"));
  const manifest = {
    "scripts/module.mjs": 'import "./importer/silos/index.mjs";\n',
    "scripts/importer/silos/index.mjs": 'import "./ose/index.mjs";\n',
    "scripts/importer/silos/ose/index.mjs": 'import "./inner.mjs";\n',
    "scripts/importer/silos/ose/inner.mjs": "export {};\n",
  };
  const viaManifest = scan(manifest, { moduleJson: { esmodules: ["scripts/module.mjs"], styles: ["styles/ose.css"] } });
  check("the silo reached only through its manifest edge is no closure violation", viaManifest.violations.length === 0);
  const side = scan({ ...manifest, "scripts/module.mjs": 'import "./importer/silos/index.mjs";\nimport "./importer/silos/ose/inner.mjs";\n' }, { moduleJson: { esmodules: ["scripts/module.mjs"], styles: ["styles/ose.css"] } });
  check("a second route into the silo fires", has(side, "closure", "scripts/importer/silos/ose/inner.mjs", "scripts/module.mjs") && has(side, "imports", "scripts/module.mjs"));
  const styled = scan({ ...manifest, "styles/ose.css": "/* css */\n" }, { silo: { ...SILO, members: [...SILO.members, "styles/ose.css"] }, moduleJson: { esmodules: ["scripts/module.mjs"], styles: ["styles/ose.css"] } });
  check("a member stylesheet declared in module.json fires", has(styled, "closure", "styles/ose.css", "styles/ose.css"));

  /* agreement */
  check("the manifest importing the entry while module.json declares the stylesheet agrees", !viaManifest.violations.some((v) => v.rule === "agreement"));
  const split = scan(manifest, { moduleJson: { esmodules: ["scripts/module.mjs"], styles: [] } });
  check("the manifest importing the entry with no stylesheet declared fires", has(split, "agreement", "scripts/importer/silos/index.mjs"));
  const declaredOnly = scan({ ...manifest, "scripts/importer/silos/index.mjs": "export {};\n" }, { moduleJson: { esmodules: ["scripts/module.mjs"], styles: ["styles/ose.css"] } });
  check("the stylesheet declared with no manifest import fires", has(declaredOnly, "agreement", "scripts/importer/silos/index.mjs"));

  /* baseline */
  const baseline = { members: clean.members, violations: imp.violations };
  const same = compareBaseline(imp.violations, baseline, clean.members);
  check("a scan equal to its baseline has nothing added and nothing stale", !same.added.length && !same.stale.length && !same.membersAdded.length && !same.membersGone.length);
  const planted = compareBaseline([...imp.violations, { rule: "imports", file: "scripts/new.mjs", target: X }], baseline, clean.members);
  check("a violation the baseline lacks is added", planted.added.length === 1 && planted.added[0].file === "scripts/new.mjs");
  const stale = compareBaseline(imp.violations.slice(1), baseline, clean.members);
  check("a baseline entry that no longer occurs is stale", stale.stale.length === 1 && stale.stale[0].file === imp.violations[0].file);
  const moved = compareBaseline(imp.violations, baseline, [...clean.members.slice(1), "scripts/importer/silos/ose/new.mjs"]);
  check("a member gained or lost is reported", moved.membersAdded.length === 1 && moved.membersGone.length === 1);
  const counts = countByRule(imp.violations);
  check("counts are per rule", counts.imports === imp.violations.filter((v) => v.rule === "imports").length && counts.imports > 0 && counts.literals === 0 && counts.agreement === 1);

  /* facts */
  const facts = factsOf('import a, { b } from "./one.mjs";\nexport * as c from "./two.mjs";\nconst s = "x"; // note\n');
  check("facts list each import edge with its kind", facts.imports.map((i) => `${i.kind}:${i.spec}`).join() === "static:./one.mjs,reexport:./two.mjs");
  check("an import specifier is no literal", facts.literals.map((l) => l.text).join() === "x");
  check("a comment keeps its line", facts.comments.length === 1 && facts.comments[0].line === 3);
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\ntest-check-silos: all ${pass} checks passed`);
