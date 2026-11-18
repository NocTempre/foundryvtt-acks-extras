/**
 * What the cookbook compile reads, and whether any of it differs from the
 * commit the work is built on, so the drift check can skip its recompile
 * (docs/importer/DECISIONS.md, 2026-11-18, "The cookbook drift check measures
 * against where the work meets main").
 *
 * The base is `git merge-base HEAD main`: the tip of `main` in `main`'s own
 * tree, the commit a change is built on in a commit tool's clone, and where a
 * topic meets `main` in its worktree or in the clone that gates its landing.
 * What `main` holds passed its own gate, so only what differs from it needs a
 * recompile. Where the local `main` is missing, `origin/main` stands in; with
 * neither, or any git failure, the full check runs.
 *
 * A path that differs from the base, tracked or untracked and not ignored,
 * calls for the recompile when the compile reads it:
 *
 * - `compile-cookbook.mjs` or any repo module reachable from it by static
 *   `import … from`, `export … from`, side-effect `import "x"` and literal
 *   `import("x")` (`reference-lib.mjs`, which names each reference PDF by its
 *   printing, among them);
 * - a file under a `register/` book directory, `_kinds/` or `_refs/` (what the
 *   compiler's `loadRegister` reads; the gitignored pipeline state beside them
 *   is not read);
 * - a file under `vendor/pdfjs/`, whose worker is loaded by path;
 * - `package-lock.json`, which pins the installed packages the walk reaches;
 * - a removed `.mjs` or `.js` file, which a resolver may have reached;
 * - a `cookbook/*.json`, which is what the check compares.
 *
 * Paths are matched by rule, so a removed register file counts. The module
 * reads no PDF and runs no compile.
 *
 * Blind spots, reported by `node tools/importer/cookbook-inputs.mjs`: a dynamic
 * `import()` whose specifier is not a string literal, a data file a walked
 * module reads by a path built at run time, a reference PDF replaced under its
 * committed name, and a package installed at a version the lockfile does not
 * pin. `ACKS_COOKBOOK_DRIFT_FULL=1` covers them.
 *
 * `check-prose-stops.mjs` takes the same base and the same variable over a
 * narrower set: its own import walk, `cookbook/*.json`,
 * `tools/importer/prose-stops.json`, `vendor/pdfjs/` and `package-lock.json`
 * (`proseStopsInputsMoved`); `inputsMoved` takes any entry and path rule.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repository root this module sits under, `tools/importer/../..`. */
export const REPO_ROOT = path.join(HERE, "..", "..");

/** The compiler the walk starts from, relative to the repository root. */
export const COMPILER_ENTRY = "tools/importer/compile-cookbook.mjs";

/** Directories the compile reads whole: the vendored pdf.js, whose worker is loaded by path. */
export const INPUT_DIRS = ["vendor/pdfjs"];

/** Single files the compile depends on outside the walk. */
const INPUT_FILES = new Set(["package-lock.json"]);

/** The `register/` directories the compiler reads besides the book directories. */
const REGISTER_SHARED = new Set(["_kinds", "_refs"]);

/** The refs the base is measured against, first found wins. */
export const MAIN_REFS = ["refs/heads/main", "refs/remotes/origin/main"];

/** The environment variable that forces the full recompile. */
export const FORCE_ENV = "ACKS_COOKBOOK_DRIFT_FULL";

/** Git variables that would point a child git at another repository, index or tree than `cwd`'s. */
const GIT_REDIRECTS = ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR", "GIT_OBJECT_DIRECTORY", "GIT_ALTERNATE_OBJECT_DIRECTORIES", "GIT_PREFIX"];

const posix = (p) => p.split(path.sep).join("/");

/** Runs git in `root` with no inherited redirect; its stdout, or null on any failure. */
function git(root, args) {
  const env = { ...process.env };
  for (const k of GIT_REDIRECTS) delete env[k];
  const r = spawnSync("git", args, { cwd: root, encoding: "utf8", env, maxBuffer: 1 << 28, windowsHide: true });
  return r.status === 0 ? r.stdout : null;
}

const FROM_RE = /\b(?:import|export)\s+(?:type\s+)?[^'";]*?\bfrom\s*(["'])([^"'\n]+)\1/g;
const SIDE_EFFECT_RE = /\bimport\s*(["'])([^"'\n]+)\1/g;
const DYNAMIC_LITERAL_RE = /\bimport\s*\(\s*(["'`])([^"'`\n$]+)\1/g;
const DYNAMIC_ANY_RE = /\bimport\s*\(/g;
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT_RE = /(^|[^:"'`\\])\/\/.*$/gm;

/**
 * The module specifiers a source names, and how many of its `import()` calls
 * have a specifier that is not a plain string literal. A match inside a comment
 * or string over-includes, which can only widen the set.
 *
 * @param {string} source
 * @returns {{specs: string[], blind: number}}
 */
export function specifiersOf(source) {
  const specs = new Set();
  for (const re of [FROM_RE, SIDE_EFFECT_RE, DYNAMIC_LITERAL_RE]) {
    for (const m of source.matchAll(re)) specs.add(m[2]);
  }
  const code = source.replace(BLOCK_COMMENT_RE, "").replace(LINE_COMMENT_RE, "$1");
  const dynamic = [...code.matchAll(DYNAMIC_ANY_RE)].length;
  const literal = [...code.matchAll(DYNAMIC_LITERAL_RE)].length;
  return { specs: [...specs], blind: Math.max(0, dynamic - literal) };
}

/** The file a relative specifier names under `root`, or null when none exists there. */
function resolveRelative(fromFile, spec) {
  const base = path.resolve(path.dirname(fromFile), spec);
  for (const c of [base, `${base}.mjs`, `${base}.js`, path.join(base, "index.mjs")]) {
    if (fs.existsSync(c) && fs.statSync(c).isFile()) return c;
  }
  return null;
}

/** The package a bare specifier names (`@scope/name` or `name`). */
const packageOf = (spec) => (spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);

/**
 * The repo modules reachable from `entry` through import edges.
 *
 * @param {string} root repository root
 * @param {string} entry the starting file, relative to `root`
 * @returns {{files: string[], packages: string[], blind: string[]}} repo-relative
 *   posix paths in sorted order; the bare-specifier packages named; the files
 *   holding an `import()` whose specifier is not a literal
 */
export function walkImports(root, entry) {
  const start = path.resolve(root, entry);
  const seen = new Set();
  const packages = new Set();
  const blind = [];
  const queue = [start];
  while (queue.length) {
    const file = queue.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const { specs, blind: dyn } = specifiersOf(fs.readFileSync(file, "utf8"));
    if (dyn) blind.push(posix(path.relative(root, file)));
    for (const spec of specs) {
      if (spec.startsWith("node:")) continue;
      if (spec.startsWith(".") || spec.startsWith("/")) {
        const hit = resolveRelative(file, spec);
        if (hit && !path.relative(root, hit).startsWith("..")) queue.push(hit);
      } else if (fs.existsSync(path.join(root, "node_modules", packageOf(spec), "package.json"))) {
        packages.add(packageOf(spec));
      }
    }
  }
  const rel = (set) => [...set].map((f) => posix(path.relative(root, f))).sort();
  return { files: rel(seen), packages: [...packages].sort(), blind: blind.sort() };
}

/**
 * Whether the compile reads a repo-relative posix path, by the rules in the
 * file header. A path that no longer exists is judged by the same rules.
 *
 * @param {string} rel
 * @param {Set<string>} walked the walk's files, from `walkImports`
 */
export function isCompileInput(rel, walked) {
  if (walked.has(rel) || INPUT_FILES.has(rel)) return true;
  const parts = rel.split("/");
  if (parts[0] === "register" && parts.length >= 3 && (!parts[1].startsWith("_") || REGISTER_SHARED.has(parts[1]))) return true;
  if (INPUT_DIRS.some((d) => rel.startsWith(`${d}/`))) return true;
  return /^cookbook\/[^/]+\.json$/.test(rel);
}

/** The commit the work is built on: `merge-base HEAD` with the first of `MAIN_REFS` present, or null. */
export function baseOf(root) {
  // A ref that does not exist fails the merge-base, and the next is tried.
  for (const ref of MAIN_REFS) {
    const base = git(root, ["merge-base", "HEAD", ref])?.trim();
    if (base) return base;
  }
  return null;
}

/**
 * Every path that differs between `base` and the working tree — tracked
 * changes, staged or not, under both names of a rename, and untracked files git
 * does not ignore — or null when git fails.
 *
 * @param {string} root
 * @param {string} base a commit
 * @returns {string[]|null} repo-relative posix paths, sorted
 */
export function changedSince(root, base) {
  const tracked = git(root, ["diff", "--name-only", "--no-renames", "-z", base, "--"]);
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (tracked === null || untracked === null) return null;
  const split = (out) => out.split("\0").filter(Boolean);
  return [...new Set([...split(tracked), ...split(untracked)])].sort();
}

const sample = (list) => list.slice(0, 5).join(", ") + (list.length > 5 ? `, … (${list.length - 5} more)` : "");

/**
 * A path rule for a check that reads less than the compile: a path counts when
 * the check's own import walk holds it, it is one of `files`, it lies under one
 * of `dirs`, or it matches one of `patterns`.
 *
 * @param {object} o
 * @param {string[]} [o.files] repo-relative posix paths
 * @param {string[]} [o.dirs] repo-relative posix directories, read whole
 * @param {RegExp[]} [o.patterns] tested against the repo-relative posix path
 * @returns {(rel: string, walked: Set<string>) => boolean}
 */
export function pathRule({ files = [], dirs = [], patterns = [] }) {
  const fileSet = new Set(files);
  return (rel, walked) => walked.has(rel) || fileSet.has(rel) || dirs.some((d) => rel.startsWith(`${d}/`)) || patterns.some((re) => re.test(rel));
}

/**
 * Whether the recompile can be skipped.
 *
 * @param {object} o
 * @param {string|null} o.base the commit measured against, from `baseOf`
 * @param {string[]|null} o.hits the changed paths the check reads, or null when they could not be listed
 * @param {Record<string, string|undefined>} [o.env] the environment, `process.env` by default
 * @param {string} [o.noun] what a differing path is called in the reason, for a check reading less than the compile
 * @returns {{skip: boolean, why: string}}
 */
export function decide({ base, hits, env = process.env, noun = "compile input" }) {
  if (env[FORCE_ENV] && env[FORCE_ENV] !== "0") return { skip: false, why: `${FORCE_ENV} is set` };
  if (!base) return { skip: false, why: "no main branch to measure against" };
  if (!hits) return { skip: false, why: "git could not list what differs from the base" };
  if (hits.length) return { skip: false, why: `${hits.length} ${noun}(s) differ from ${base.slice(0, 8)}: ${sample(hits)}` };
  return { skip: true, why: noun === "compile input" ? `no compile input or cookbook file differs from ${base.slice(0, 8)}` : `no ${noun} differs from ${base.slice(0, 8)}` };
}

/**
 * Whether anything a check reads differs from the base, for the tree at `root`.
 * A removed `.mjs` or `.js` file counts whatever the rule says, since a
 * resolver may have reached it.
 *
 * @param {object} o
 * @param {string} [o.root]
 * @param {Record<string, string|undefined>} [o.env]
 * @param {string} [o.entry] the check's own module, where its import walk starts, relative to `root`
 * @param {(rel: string, walked: Set<string>) => boolean} [o.reads] the path rule, `isCompileInput` by default
 * @param {string} [o.noun] see `decide`
 * @returns {{skip: boolean, why: string, base: string|null, hits: string[]|null}}
 */
export function inputsMoved({ root = REPO_ROOT, env = process.env, entry = COMPILER_ENTRY, reads = isCompileInput, noun } = {}) {
  const base = baseOf(root);
  const changed = base ? changedSince(root, base) : null;
  const walked = new Set(walkImports(root, entry).files);
  const hits = changed?.filter((rel) => reads(rel, walked) || (/\.m?js$/.test(rel) && !fs.existsSync(path.join(root, rel)))) ?? null;
  return { ...decide({ base, hits, env, ...(noun ? { noun } : {}) }), base, hits };
}

/**
 * The drift check's decision for the tree at `root`.
 *
 * @param {string} [root]
 * @param {Record<string, string|undefined>} [env]
 * @returns {{skip: boolean, why: string, base: string|null, hits: string[]|null}}
 */
export function compileInputsMoved(root = REPO_ROOT, env = process.env) {
  return inputsMoved({ root, env });
}

/**
 * What the prose-stops check reads: its own import walk, the cookbook it
 * compares against, its ledger, the vendored pdf.js and the lockfile.
 */
export const PROSE_STOPS_ENTRY = "tools/importer/check-prose-stops.mjs";

/** The path rule for `PROSE_STOPS_ENTRY`; see `pathRule`. */
export const PROSE_STOPS_READS = pathRule({ files: ["package-lock.json", "tools/importer/prose-stops.json"], dirs: INPUT_DIRS, patterns: [/^cookbook\/[^/]+\.json$/] });

/**
 * The prose-stops check's decision for the tree at `root`: the same base and
 * the same force variable as the drift check, over the paths it reads.
 *
 * @param {string} [root]
 * @param {Record<string, string|undefined>} [env]
 * @returns {{skip: boolean, why: string, base: string|null, hits: string[]|null}}
 */
export function proseStopsInputsMoved(root = REPO_ROOT, env = process.env) {
  return inputsMoved({ root, env, entry: PROSE_STOPS_ENTRY, reads: PROSE_STOPS_READS, noun: "input" });
}

// Run directly: report the input set, its blind spots and the decision.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const walk = walkImports(REPO_ROOT, COMPILER_ENTRY);
  console.log(`cookbook inputs: ${walk.files.length} module(s), ${walk.packages.length} package(s) [${walk.packages.join(", ")}]`);
  console.log(`  blind (dynamic import, non-literal specifier): ${walk.blind.length ? walk.blind.join(", ") : "none"}`);
  const d = compileInputsMoved();
  console.log(`  base ${d.base ?? "none"}: ${d.skip ? "skip" : "recompile"} (${d.why})`);
}
