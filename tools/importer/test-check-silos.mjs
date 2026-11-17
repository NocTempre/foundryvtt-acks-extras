/**
 * The silo and book gate against fixture trees: one planted violation per rule
 * fires, a clean tree passes, a bare `silo-ok` fails, and a stale baseline entry
 * fails. The ACKS-book rules (roles matched by role and counted, cross-book
 * imports, the manifest against the folders) run on invented book ids. Each
 * fixture is written under a scratch directory of its own and removed. No
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

const { analyse, baselineText, compareBaseline, countByRule, factsOf } = await import("./check-silos.mjs");

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };

/** Invented ACKS book ids; `qd9` belongs to the silo and is no book id here. */
const BOOKS = { ids: ["qa1", "qb2", "cat"], dir: "scripts/importer/books/", manifest: "scripts/importer/books/index.mjs", scope: ["scripts/importer/", "tools/importer/compile-cookbook.mjs"] };

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
function scan(files, { moduleJson = { esmodules: ["scripts/module.mjs"], styles: [] }, silo = SILO, bookTree = null } = {}) {
  const root = path.join(scratch, `t${n++}`);
  const all = { "module.json": JSON.stringify(moduleJson), "scripts/importer/ose-x.mjs": "export const x = 1;\n", "templates/part.hbs": "<p></p>\n", ...files };
  for (const [file, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  }
  return analyse({ root, silo, bookTree });
}
const has = (res, rule, file, target) => res.violations.some((v) => v.rule === rule && v.file === file && (target === undefined || v.target === target));
const countOfHit = (res, rule, file, target) => res.violations.find((v) => v.rule === rule && v.file === file && v.target === target)?.count ?? 0;

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

  /* book roles */
  const role = scan({
    "scripts/module.mjs": "export {};\n",
    "scripts/importer/r1.mjs": [
      'export const a = { book: "qa1" };',
      'export const b = { "book": "qa1", note: "qa1" };',
      'export const c = (e) => e.book === "qa1";',
      'export const d = (e) => e.book !== "qb2";',
      'export const e2 = (e) => "qb2" == e?.book;',
      'export const f = (e) => e["book"] != "qb2";',
      "export const g = (e) => { switch (e.book) { case \"qa1\": return 1; default: return 0; } };",
      'export const h = { book: "cat" };',
      "",
    ].join("\n"),
    "scripts/importer/r2.mjs": [
      'export const form = { cat: "qa1", title: "qa1", cat2: "cat" };',
      'export const id = "qa1";',
      'export const same = (e) => e.title === "qa1" && e.kind === "qb2";',
      'export const other = { book: "zz9", ose: { book: "qd9" } };',
      "export const book = 1;",
      "export const sh = { book };",
      "export const dyn = (v) => ({ book: v, ok: v.book === v.other });",
      'export const sw = (e) => { switch (e.title) { case "qa1": return 1; } };',
      "",
    ].join("\n"),
    "scripts/importer/r3.mjs": '// silo-ok: the registry-keyed default\nexport const a = { book: "qa1" };\nexport const b = (e) => e.book === "qa1"; // silo-ok: same\nexport const c = (e) => e.book === "qb2";\n',
    "scripts/importer/r4.mjs": '// silo-ok:\nexport const a = { book: "qa1" };\n',
    "scripts/importer/sub/deep.mjs": 'export const a = { book: "qb2" };\n',
    "scripts/importer/books.mjs": 'export const REG = { x: { book: "qa1" } };\n',
    "scripts/importer/books/qa1/own.mjs": 'export const a = { book: "qa1" };\nexport const b = (e) => e.book === "qa1";\n',
    "scripts/importer/books/index.mjs": "export const BOOK_CODE = {};\n",
    "scripts/lib/outside.mjs": 'export const a = { book: "qa1" };\n',
    "tools/importer/compile-cookbook.mjs": 'export const gap = (e) => (e.book === "qa1" ? 4 : 6);\n',
    "tools/importer/compile-other.mjs": 'export const gap = (e) => (e.book === "qa1" ? 4 : 6);\n',
    "tools/importer/test-thing.mjs": 'export const a = { book: "qa1" };\n',
    "scripts/importer/ose-x.mjs": 'export const x = { book: "qa1" };\n',
  }, { bookTree: BOOKS });
  const R1 = "scripts/importer/r1.mjs";
  check("a `book:` property value naming a book id fires", has(role, "book-roles", R1, "book: qa1") && countOfHit(role, "book-roles", R1, "book: qa1") === 2);
  check("a `.book ===`, `!==`, `==`, `!=`, a yoda test and a switch case fire as one test target", countOfHit(role, "book-roles", R1, ".book === qa1") === 2 && countOfHit(role, "book-roles", R1, ".book === qb2") === 3);
  check("a book id that is also a form field fires only in the `book` role", has(role, "book-roles", R1, "book: cat") && !has(role, "book-roles", "scripts/importer/r2.mjs"));
  check("a bare literal, another property, a non-registry id, a shorthand, a variable and another switch discriminant do not fire", !has(role, "book-roles", "scripts/importer/r2.mjs"));
  check("a silo book id in a `book:` value is the literals rule's, not a book role", !role.violations.some((v) => v.rule === "book-roles" && /qd9/.test(v.target)));
  check("silo-ok excuses a role on its own line and the line below, and no more", !has(role, "book-roles", "scripts/importer/r3.mjs", "book: qa1") && has(role, "book-roles", "scripts/importer/r3.mjs", ".book === qb2") && !has(role, "book-roles", "scripts/importer/r3.mjs", ".book === qa1"));
  check("a bare silo-ok under scripts/ is reported once, by the literals rule", countOfHit(role, "literals", "scripts/importer/r4.mjs", "silo-ok without a reason") === 1 && !has(role, "book-roles", "scripts/importer/r4.mjs", "silo-ok without a reason") && has(role, "book-roles", "scripts/importer/r4.mjs", "book: qa1"));
  check("the rule reaches a subdirectory of scripts/importer/", has(role, "book-roles", "scripts/importer/sub/deep.mjs", "book: qb2"));
  check("the registry file may name its ids", !has(role, "book-roles", "scripts/importer/books.mjs"));
  check("a file under books/ is outside the rule", !has(role, "book-roles", "scripts/importer/books/qa1/own.mjs") && !has(role, "book-roles", "scripts/importer/books/index.mjs"));
  check("a file outside scripts/importer/ and tests are outside the rule", !has(role, "book-roles", "scripts/lib/outside.mjs") && !has(role, "book-roles", "tools/importer/test-thing.mjs") && !has(role, "book-roles", "tools/importer/compile-other.mjs"));
  check("compile-cookbook.mjs is in the rule's scope", has(role, "book-roles", "tools/importer/compile-cookbook.mjs", ".book === qa1"));
  check("a silo member is outside the rule", !has(role, "book-roles", "scripts/importer/ose-x.mjs"));
  const bareTool = scan({ "scripts/module.mjs": "export {};\n", "tools/importer/compile-cookbook.mjs": '// silo-ok\nexport const a = 1;\n' }, { bookTree: BOOKS });
  check("a bare silo-ok in compile-cookbook.mjs is a book-roles violation", has(bareTool, "book-roles", "tools/importer/compile-cookbook.mjs", "silo-ok without a reason"));
  check("a tree run without a book tree skips the book rules", !scan({ "scripts/module.mjs": "export {};\n", "scripts/importer/r1.mjs": 'export const a = { book: "qa1" };\n' }).violations.some((v) => v.rule.startsWith("book-")));

  /* book imports */
  const bi = scan({
    "scripts/module.mjs": "export {};\n",
    "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\nimport "./qb2/index.mjs";\nexport const BOOK_CODE = {};\n',
    "scripts/importer/books/merge.mjs": "export const m = 1;\n",
    "scripts/importer/books/qa1/index.mjs": 'import "./own.mjs";\nimport "../merge.mjs";\nimport "../../constants.mjs";\n',
    "scripts/importer/books/qa1/own.mjs": 'import "../qb2/own.mjs";\n',
    "scripts/importer/books/qa1/dyn.mjs": 'export const l = () => import("../qb2/index.mjs");\n',
    "scripts/importer/books/qa1/re.mjs": 'export * from "../qb2/own.mjs";\n',
    "scripts/importer/books/qb2/index.mjs": 'import "./own.mjs";\n',
    "scripts/importer/books/qb2/own.mjs": "export const o = 1;\n",
    "scripts/importer/constants.mjs": "export const c = 1;\n",
    "scripts/importer/engine.mjs": 'import "./books/qa1/own.mjs";\n',
    "scripts/importer/via-index.mjs": 'import "./books/index.mjs";\nimport "./books/merge.mjs";\n',
    "tools/importer/test-qa1.mjs": 'import "../../scripts/importer/books/qa1/own.mjs";\n',
  }, { bookTree: BOOKS });
  check("a book's file importing another book's file fires", has(bi, "book-imports", "scripts/importer/books/qa1/own.mjs", "scripts/importer/books/qb2/own.mjs"));
  check("a literal import() and an `export from` across books fire", has(bi, "book-imports", "scripts/importer/books/qa1/dyn.mjs") && has(bi, "book-imports", "scripts/importer/books/qa1/re.mjs"));
  check("a book importing its own files, the merge and the engine is clean", !has(bi, "book-imports", "scripts/importer/books/qa1/index.mjs") && !has(bi, "book-imports", "scripts/importer/books/qb2/index.mjs"));
  check("a file under scripts/ other than the manifest importing a book folder fires", has(bi, "book-imports", "scripts/importer/engine.mjs", "scripts/importer/books/qa1/own.mjs"));
  check("the manifest naming the folders, and a file importing the manifest or the merge, are clean", !has(bi, "book-imports", "scripts/importer/books/index.mjs") && !has(bi, "book-imports", "scripts/importer/via-index.mjs"));
  check("a tool may import a book's file directly", !has(bi, "book-imports", "tools/importer/test-qa1.mjs"));

  /* book manifest */
  const folderTree = {
    "scripts/module.mjs": "export {};\n",
    "scripts/importer/books/qa1/index.mjs": "export {};\n",
    "scripts/importer/books/qb2/index.mjs": "export {};\n",
  };
  const agree = scan({ ...folderTree, "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\nimport * as b from "./qb2/index.mjs";\nexport const BOOK_CODE = { b };\n' }, { bookTree: BOOKS });
  check("a manifest importing exactly the folders, each a registry id, agrees", !agree.violations.some((v) => v.rule.startsWith("book-")) && agree.notes.some((t) => /2 book folder\(s\), 2 imported/.test(t)));
  const lonely = scan({ ...folderTree, "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\n' }, { bookTree: BOOKS });
  check("a folder the manifest does not import fires", has(lonely, "book-manifest", "scripts/importer/books/index.mjs", "does not import qb2"));
  const ghost = scan({ ...folderTree, "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\nimport "./qb2/index.mjs";\nimport "./qc3/index.mjs";\n' }, { bookTree: BOOKS });
  check("an import of a folder that is not there fires", has(ghost, "book-manifest", "scripts/importer/books/index.mjs", "imports scripts/importer/books/qc3/index.mjs, not a folder's index.mjs") || has(ghost, "book-manifest", "scripts/importer/books/index.mjs", "imports qc3, which has no folder"));
  const stray = scan({ ...folderTree, "scripts/importer/books/zz9/index.mjs": "export {};\n", "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\nimport "./qb2/index.mjs";\nimport "./zz9/index.mjs";\n' }, { bookTree: BOOKS });
  check("a folder that is no registry id fires", has(stray, "book-manifest", "scripts/importer/books/zz9/", "folder is not a registry book id"));
  const silent = scan({ ...folderTree, "scripts/importer/books/qa1/other.mjs": "export {};\n", "scripts/importer/books/qc3/other.mjs": "export {};\n", "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\nimport "./qb2/index.mjs";\n' }, { bookTree: { ...BOOKS, ids: [...BOOKS.ids, "qc3"] } });
  check("a folder with no index.mjs fires", has(silent, "book-manifest", "scripts/importer/books/qc3/", "folder has no index.mjs") && !has(silent, "book-manifest", "scripts/importer/books/qa1/"));
  const deepImport = scan({ ...folderTree, "scripts/importer/books/qa1/own.mjs": "export {};\n", "scripts/importer/books/index.mjs": 'import "./qa1/index.mjs";\nimport "./qb2/index.mjs";\nimport "./qa1/own.mjs";\n' }, { bookTree: BOOKS });
  check("the manifest importing a folder's other file fires", has(deepImport, "book-manifest", "scripts/importer/books/index.mjs", "imports scripts/importer/books/qa1/own.mjs, not a folder's index.mjs"));
  const noManifest = scan(folderTree, { bookTree: BOOKS });
  check("book folders with no manifest fire", has(noManifest, "book-manifest", "scripts/importer/books/index.mjs", "missing while book folders exist"));
  const none = scan({ "scripts/module.mjs": "export {};\n" }, { bookTree: BOOKS });
  check("no folders and no manifest is not yet applicable", !none.violations.length && none.notes.some((t) => /book-manifest: not yet applicable/.test(t)));
  const empty = scan({ "scripts/module.mjs": "export {};\n", "scripts/importer/books/index.mjs": "export const BOOK_CODE = {};\n" }, { bookTree: BOOKS });
  check("a manifest importing nothing over no folders agrees", !empty.violations.length);

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

  const held = { members: [], violations: [{ rule: "book-roles", file: "scripts/importer/q.mjs", target: "book: qa1", count: 3 }, { rule: "book-roles", file: "scripts/importer/p.mjs", target: "book: qa1" }] };
  const at = (n, m = 1) => [{ rule: "book-roles", file: "scripts/importer/q.mjs", target: "book: qa1", count: n }, { rule: "book-roles", file: "scripts/importer/p.mjs", target: "book: qa1", count: m }];
  const level = compareBaseline(at(3), held, []);
  check("a count equal to the baseline's, and an entry with no count as one, hold", !level.added.length && !level.stale.length);
  const risen = compareBaseline(at(4), held, []);
  check("a repeat of a held target is added, with the count it had", risen.added.length === 1 && risen.added[0].was === 3 && risen.added[0].count === 4 && !risen.stale.length);
  const fallen = compareBaseline(at(2), held, []);
  check("a count that fell is stale, with the count it has", fallen.stale.length === 1 && fallen.stale[0].now === 2 && fallen.stale[0].count === 3 && !fallen.added.length);
  const gone = compareBaseline(at(3).slice(0, 1), held, []);
  check("a counted entry that vanished is stale with none now", gone.stale.length === 1 && gone.stale[0].file === "scripts/importer/p.mjs" && gone.stale[0].now === 0);
  const text = JSON.parse(baselineText([], at(3)));
  check("the baseline file writes a count only above one", text.violations[0].count === 3 && !("count" in text.violations[1]));
  check("counts sum per rule", countByRule(at(3, 2))["book-roles"] === 5);
  const twice = scan({ "scripts/module.mjs": "export {};\n", "scripts/importer/t.mjs": 'export const a = { book: "qa1" };\nexport const b = { book: "qa1" };\n' }, { bookTree: BOOKS });
  check("a second use of a held literal in a file raises its count", countOfHit(twice, "book-roles", "scripts/importer/t.mjs", "book: qa1") === 2);
  const oneMore = compareBaseline(twice.violations, { members: [], violations: [{ rule: "book-roles", file: "scripts/importer/t.mjs", target: "book: qa1" }] }, []);
  check("so a baseline holding one fails on the second", oneMore.added.length === 1);

  /* facts */
  const facts = factsOf('import a, { b } from "./one.mjs";\nexport * as c from "./two.mjs";\nconst s = "x"; // note\n');
  check("facts list each import edge with its kind", facts.imports.map((i) => `${i.kind}:${i.spec}`).join() === "static:./one.mjs,reexport:./two.mjs");
  check("an import specifier is no literal", facts.literals.map((l) => l.text).join() === "x");
  check("a comment keeps its line", facts.comments.length === 1 && facts.comments[0].line === 3);
  const roles = factsOf('const a = { book: "x" };\nconst b = e.book === "y";\nconst c = { other: "z" };\n');
  check("facts list each book role with its kind and line", roles.roles.map((r) => `${r.kind}:${r.text}:${r.line}`).join() === "value:x:1,test:y:2");
} finally {
  fs.rmSync(scratch, { recursive: true, force: true });
}

console.log(`\ntest-check-silos: all ${pass} checks passed`);
