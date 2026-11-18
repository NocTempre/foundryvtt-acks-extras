/**
 * The cookbook drift check's skip: which paths the compile reads, which
 * commit a tree is measured against, and when the recompile may be skipped.
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
import { COMPILER_ENTRY, FORCE_ENV, baseOf, changedSince, compileInputsMoved, decide, isCompileInput, specifiersOf, walkImports } from "./cookbook-inputs.mjs";

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

  // --- no main to measure against ---
  const trunk = path.join(tmp, "trunk");
  fs.mkdirSync(trunk);
  git(trunk, "init", "-q", "-b", "trunk");
  put(trunk, COMPILER_ENTRY, "export const x = 1;\n");
  git(trunk, "add", "-A");
  git(trunk, "commit", "-q", "-m", "trunk");
  check("a repository with no main has no base", baseOf(trunk) === null);
  check("with no base the full check runs", moved(trunk).skip === false);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`test-cookbook-inputs: ${pass} checks passed.`);
