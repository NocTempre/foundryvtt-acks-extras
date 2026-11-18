/**
 * The cookbook drift check's skip: which paths the compile reads, which
 * commit a tree is measured against, and when the recompile may be skipped.
 * The prose-stops check shares the base and the variable, over its own entry
 * module and a narrower path rule.
 *
 * PDF-free and book-free: throwaway git repositories under the system temp
 * directory hold an invented compiler, modules, register files and cookbook
 * files, because what is under test is the input set and the decision, not a
 * compile. Each of the four trees a gate runs in is built for real: `main`'s
 * own tree, a commit tool's clone at the change's base, the clone that gates a
 * topic's landing, and a topic's own checkout.
 */
import assert from "node:assert";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COMPILER_ENTRY, FORCE_ENV, PROSE_STOPS_ENTRY, PROSE_STOPS_READS, baseOf, changedSince, compileInputsMoved, decide, isCompileInput, pathRule, proseStopsInputsMoved, specifiersOf, walkImports } from "./cookbook-inputs.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-inputs-test-"));
const REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"];
const cleanEnv = () => {
  const env = { ...process.env };
  for (const k of REDIRECTS) delete env[k];
  return env;
};
/** Runs git in `cwd` for the test's own setup; throws on failure. */
const git = (cwd, ...args) => {
  const r = spawnSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.invalid", "-c", "core.autocrlf=false", ...args], { cwd, encoding: "utf8", env: cleanEnv(), windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (root, rel, text) => {
  const f = path.join(root, rel);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const env = {};
const moved = (root) => compileInputsMoved(root, env);

try {
  // --- specifier extraction ---
  const s = specifiersOf(`
    import a from "./a.mjs";
    import { b,
      c } from '../b.mjs';
    export * from "./re.mjs";
    export { d } from "./d.mjs";
    import "./side.mjs";
    const m = await import("./lazy.mjs");
    import fs from "node:fs";
  `);
  for (const want of ["./a.mjs", "../b.mjs", "./re.mjs", "./d.mjs", "./side.mjs", "./lazy.mjs", "node:fs"]) {
    check(`specifier ${want} is found`, s.specs.includes(want));
  }
  check("a literal dynamic import is not blind", s.blind === 0);
  check("a computed dynamic import is blind", specifiersOf("await import(name);").blind === 1);
  check("a template-literal dynamic import is blind", specifiersOf("await import(`./x/${id}.mjs`);").blind === 1);
  check("an import( inside a comment is not blind", specifiersOf("// load with import(x)\n/* import(y) */ const q = 1;").blind === 0);

  // --- the path rules ---
  const walked = new Set([COMPILER_ENTRY, "scripts/mod/b.mjs"]);
  const inputs = ["tools/importer/compile-cookbook.mjs", "scripts/mod/b.mjs", "register/book/entry.json", "register/book/sub/deep.json", "register/_kinds/k.json", "register/_refs/r.json", "vendor/pdfjs/pdf.worker.mjs", "package-lock.json", "cookbook/rr.json", "cookbook/index.json"];
  const others = ["scripts/unrelated.mjs", "register/_ledger.json", "register/_manifest/m.json", "register/_proposals/p.json", "register/top.json", "cookbook/notes/x.json", "cookbook/README.md", "docs/importer/MODEL.md", "package.json", "vendor/tesseract/x.wasm"];
  for (const rel of inputs) check(`${rel} is a compile input`, isCompileInput(rel, walked));
  for (const rel of others) check(`${rel} is not a compile input`, !isCompileInput(rel, walked));

  // --- the decision ---
  const B = "a".repeat(40);
  check("nothing differing skips", decide({ base: B, hits: [], env }).skip === true);
  check("the skip names its base", decide({ base: B, hits: [], env }).why.includes("aaaaaaaa"));
  check("a differing input runs the full check and is named", (() => {
    const d = decide({ base: B, hits: ["register/book/entry.json"], env });
    return !d.skip && d.why.includes("register/book/entry.json");
  })());
  check("no base runs the full check", decide({ base: null, hits: [], env }).skip === false);
  check("an unlisted diff runs the full check", decide({ base: B, hits: null, env }).skip === false);
  check("the force variable runs the full check", decide({ base: B, hits: [], env: { [FORCE_ENV]: "1" } }).skip === false);
  check("a force variable of 0 does not force", decide({ base: B, hits: [], env: { [FORCE_ENV]: "0" } }).skip === true);

  // --- main's own tree ---
  const main = path.join(tmp, "main");
  fs.mkdirSync(main);
  git(main, "init", "-q", "-b", "main");
  put(main, ".gitignore", "register/_ledger.json\nregister/_manifest/\n");
  put(main, COMPILER_ENTRY, 'import { a } from "./helper.mjs";\nimport { b } from "../../scripts/mod/b.mjs";\n');
  put(main, "tools/importer/helper.mjs", "export const a = 1;\n");
  put(main, "scripts/mod/b.mjs", 'import { c } from "./c.mjs";\nexport { c };\nexport const b = 2;\n');
  put(main, "scripts/mod/c.mjs", "export const c = 3;\n");
  put(main, "scripts/unrelated.mjs", "export const u = 0;\n");
  put(main, "register/book/entry.json", '{"id":"one"}\n');
  put(main, "register/_refs/r.json", '{"registry":"r"}\n');
  put(main, "vendor/pdfjs/pdf.worker.mjs", "// worker\n");
  put(main, "cookbook/rr.json", '{"entries":{}}\n');
  put(main, "docs/notes.md", "notes\n");
  git(main, "add", "-A");
  git(main, "commit", "-q", "-m", "base");
  const tip = git(main, "rev-parse", "HEAD");

  check("the walk finds the compiler and every transitive module", walkImports(main, COMPILER_ENTRY).files.join() === [COMPILER_ENTRY, "tools/importer/helper.mjs", "scripts/mod/b.mjs", "scripts/mod/c.mjs"].sort().join());
  check("main's tree measures against its own tip", baseOf(main) === tip);
  check("a clean tree skips", moved(main).skip === true);

  // What git reports, through the path rules above: each kind of difference once.
  const cases = {
    "an edited docs file": [() => put(main, "docs/notes.md", "more\n"), false],
    "an ignored pipeline file": [() => put(main, "register/_ledger.json", '{"rows":1}\n'), false],
    "an untracked file outside the inputs": [() => put(main, "tools/live/walk.mjs", "// walk\n"), false],
    "an untracked register file": [() => put(main, "register/book/extra.json", "{}\n"), true],
    "a removed register file": [() => fs.rmSync(path.join(main, "register/book/entry.json")), true],
    "a staged register edit": [() => {
      put(main, "register/_refs/r.json", '{"registry":"r2"}\n');
      git(main, "add", "register/_refs/r.json");
    }, true],
    "a module reached through a re-export": [() => put(main, "scripts/mod/c.mjs", "export const c = 33;\n"), true],
    "a removed module": [() => {
      fs.rmSync(path.join(main, "scripts/mod/c.mjs"));
      put(main, "scripts/mod/b.mjs", "export const b = 2;\n");
    }, true],
  };
  for (const [label, [change, recompiles]] of Object.entries(cases)) {
    git(main, "reset", "-q", "--hard", tip);
    git(main, "clean", "-q", "-fdx");
    change();
    const d = moved(main);
    check(`${label} ${recompiles ? "runs the full check" : "skips"}`, d.skip === !recompiles);
  }
  git(main, "reset", "-q", "--hard", tip);
  git(main, "clean", "-q", "-fdx");

  // A git variable inherited from a caller must not point the check at another repository or index.
  const elsewhere = path.join(tmp, "elsewhere");
  fs.mkdirSync(elsewhere);
  git(elsewhere, "init", "-q", "-b", "main");
  put(main, "register/book/entry.json", '{"id":"three"}\n');
  const saved = { GIT_DIR: process.env.GIT_DIR, GIT_INDEX_FILE: process.env.GIT_INDEX_FILE };
  process.env.GIT_DIR = path.join(elsewhere, ".git");
  process.env.GIT_INDEX_FILE = path.join(tmp, "no-such-index");
  try {
    check("an inherited GIT_DIR or GIT_INDEX_FILE is ignored", baseOf(main) === tip && changedSince(main, tip).includes("register/book/entry.json"));
  } finally {
    for (const [k, v] of Object.entries(saved)) v === undefined ? delete process.env[k] : (process.env[k] = v);
  }
  git(main, "reset", "-q", "--hard", tip);

  // --- a commit tool's clone: the change's base checked out, the change written over it ---
  const changeClone = path.join(tmp, "change-clone");
  git(tmp, "clone", "-q", "--shared", "--no-checkout", main, changeClone);
  git(changeClone, "checkout", "-q", "--detach", tip);
  check("a commit tool's clone holds a local main", git(changeClone, "rev-parse", "--verify", "refs/heads/main") === tip);
  check("a commit tool's clone measures against the change's base", baseOf(changeClone) === tip);
  put(changeClone, "docs/notes.md", "a docs change\n");
  check("a docs-only change skips in the clone", moved(changeClone).skip === true);
  put(changeClone, "tools/importer/helper.mjs", "export const a = 2;\n");
  check("an input change runs the full check in the clone", moved(changeClone).skip === false);

  // --- a topic: its own checkout, then the clone that gates its landing ---
  git(main, "checkout", "-q", "-b", "topic/x");
  put(main, "tools/importer/helper.mjs", "export const a = 5;\n");
  git(main, "commit", "-q", "-am", "an input commit");
  put(main, "docs/notes.md", "topic notes\n");
  git(main, "commit", "-q", "-am", "a docs commit");
  const topicTip = git(main, "rev-parse", "HEAD");
  check("a topic measures against where it meets main", baseOf(main) === tip);
  check("a clean topic whose commits changed an input runs the full check", (() => {
    const d = moved(main);
    return !d.skip && d.hits.join() === "tools/importer/helper.mjs";
  })());
  git(main, "checkout", "-q", "main");

  const landClone = path.join(tmp, "land-clone");
  git(tmp, "clone", "-q", "--shared", "--no-checkout", main, landClone);
  git(landClone, "checkout", "-q", "--detach", topicTip);
  check("the landing clone measures against main's tip", baseOf(landClone) === tip);
  check("the landing clone sees the topic's input commit", moved(landClone).skip === false);

  // A docs-only topic lands without the recompile.
  git(main, "checkout", "-q", "-b", "topic/docs");
  put(main, "docs/notes.md", "docs topic\n");
  git(main, "commit", "-q", "-am", "docs only");
  const docsTip = git(main, "rev-parse", "HEAD");
  git(main, "checkout", "-q", "main");
  const docsClone = path.join(tmp, "docs-clone");
  git(tmp, "clone", "-q", "--shared", "--no-checkout", main, docsClone);
  git(docsClone, "checkout", "-q", "--detach", docsTip);
  check("a docs-only topic's landing skips", moved(docsClone).skip === true);

  // A commit already on main measures against itself: the gate before its landing is the one that checked it.
  git(main, "merge", "-q", "--ff-only", "topic/x");
  check("a commit already on main is its own base", baseOf(main) === topicTip && moved(main).skip === true);

  // --- the prose-stops check: its own entry, a narrower path rule, the same base and variable ---
  check("the prose-stops rule counts its walk", PROSE_STOPS_READS("scripts/mod/x.mjs", new Set(["scripts/mod/x.mjs"])));
  for (const rel of ["cookbook/rr.json", "tools/importer/prose-stops.json", "vendor/pdfjs/pdf.worker.mjs", "package-lock.json"]) {
    check(`${rel} is read by prose stops`, PROSE_STOPS_READS(rel, new Set()));
  }
  for (const rel of ["register/book/entry.json", "register/_kinds/k.json", "docs/notes.md", "package.json", "cookbook/notes/x.json", "scripts/unrelated.mjs"]) {
    check(`${rel} is not read by prose stops`, !PROSE_STOPS_READS(rel, new Set()));
  }
  check("a custom rule takes files, dirs and patterns", (() => {
    const rule = pathRule({ files: ["a.txt"], dirs: ["d"], patterns: [/^p-\d+\.json$/] });
    return rule("a.txt", new Set()) && rule("d/x/y", new Set()) && rule("p-7.json", new Set()) && !rule("dd/x", new Set()) && !rule("p-x.json", new Set());
  })());
  check("a noun names what differs and the skip line follows it", (() => {
    const hit = decide({ base: B, hits: ["x"], env, noun: "input" });
    const none = decide({ base: B, hits: [], env, noun: "input" });
    return hit.why.startsWith("1 input(s) differ") && none.skip && none.why === "no input differs from aaaaaaaa";
  })());

  const prose = path.join(tmp, "prose");
  fs.mkdirSync(prose);
  git(prose, "init", "-q", "-b", "main");
  put(prose, COMPILER_ENTRY, "export const compile = 1;\n");
  put(prose, PROSE_STOPS_ENTRY, 'import { f } from "./reading.mjs";\nimport { g } from "../../scripts/mod/g.mjs";\nimport { compileInputsMoved } from "./cookbook-inputs.mjs";\n');
  put(prose, "tools/importer/reading.mjs", "export const f = 1;\n");
  put(prose, "scripts/mod/g.mjs", "export const g = 2;\n");
  put(prose, "tools/importer/cookbook-inputs.mjs", "export const compileInputsMoved = 0;\n");
  put(prose, "tools/importer/prose-stops.json", '{"known":{},"waived":{}}\n');
  put(prose, "vendor/pdfjs/pdf.worker.mjs", "// worker\n");
  put(prose, "package-lock.json", "{}\n");
  put(prose, "cookbook/rr.json", '{"entries":{}}\n');
  put(prose, "register/book/entry.json", '{"id":"one"}\n');
  put(prose, "docs/notes.md", "notes\n");
  git(prose, "add", "-A");
  git(prose, "commit", "-q", "-m", "base");
  const proseTip = git(prose, "rev-parse", "HEAD");
  const proseMoved = (e = env) => proseStopsInputsMoved(prose, e);

  check("prose stops' walk is its own, not the compiler's", walkImports(prose, PROSE_STOPS_ENTRY).files.join() === [PROSE_STOPS_ENTRY, "tools/importer/reading.mjs", "scripts/mod/g.mjs", "tools/importer/cookbook-inputs.mjs"].sort().join());
  check("an untouched tree skips prose stops", proseMoved().skip === true && proseMoved().base === proseTip);
  const proseCases = {
    "an edited docs file": [() => put(prose, "docs/notes.md", "more\n"), false],
    "a register edit, which only the compile reads": [() => put(prose, "register/book/entry.json", '{"id":"two"}\n'), false],
    "an edit to the compiler, which prose stops does not walk": [() => put(prose, COMPILER_ENTRY, "export const compile = 2;\n"), false],
    "an edit to its own module": [() => put(prose, PROSE_STOPS_ENTRY, "// edited\n"), true],
    "an edit to a module it imports": [() => put(prose, "scripts/mod/g.mjs", "export const g = 3;\n"), true],
    "an edit to the cookbook": [() => put(prose, "cookbook/rr.json", '{"entries":{"a":1}}\n'), true],
    "an untracked cookbook file": [() => put(prose, "cookbook/new.json", "{}\n"), true],
    "an edit to the ledger": [() => put(prose, "tools/importer/prose-stops.json", '{"known":{"a":1},"waived":{}}\n'), true],
    "an edit to the vendored pdf.js": [() => put(prose, "vendor/pdfjs/pdf.worker.mjs", "// worker 2\n"), true],
    "an edit to the lockfile": [() => put(prose, "package-lock.json", '{"v":2}\n'), true],
    "a removed module it imported": [() => fs.rmSync(path.join(prose, "tools/importer/reading.mjs")), true],
  };
  for (const [label, [change, runs]] of Object.entries(proseCases)) {
    git(prose, "reset", "-q", "--hard", proseTip);
    git(prose, "clean", "-q", "-fdx");
    change();
    check(`prose stops: ${label} ${runs ? "runs in full" : "skips"}`, proseMoved().skip === !runs);
  }
  git(prose, "reset", "-q", "--hard", proseTip);
  git(prose, "clean", "-q", "-fdx");
  check("prose stops: the same register edit still moves the compile", (() => {
    put(prose, "register/book/entry.json", '{"id":"two"}\n');
    const d = compileInputsMoved(prose, env);
    git(prose, "reset", "-q", "--hard", proseTip);
    return d.skip === false;
  })());
  check("prose stops: the force variable runs it in full", proseMoved({ [FORCE_ENV]: "1" }).skip === false);
  check("prose stops: a force variable of 0 does not force", proseMoved({ [FORCE_ENV]: "0" }).skip === true);

  // --- no main to measure against ---
  const trunk = path.join(tmp, "trunk");
  fs.mkdirSync(trunk);
  git(trunk, "init", "-q", "-b", "trunk");
  put(trunk, COMPILER_ENTRY, "export const x = 1;\n");
  put(trunk, PROSE_STOPS_ENTRY, "export const y = 1;\n");
  git(trunk, "add", "-A");
  git(trunk, "commit", "-q", "-m", "trunk");
  check("a repository with no main has no base", baseOf(trunk) === null);
  check("with no base the full check runs", moved(trunk).skip === false);
  check("with no base prose stops runs in full and says so", (() => {
    const d = proseStopsInputsMoved(trunk, env);
    return d.skip === false && d.base === null && d.why.includes("no main branch");
  })());
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`test-cookbook-inputs: ${pass} checks passed.`);
