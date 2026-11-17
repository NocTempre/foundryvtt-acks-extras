/**
 * The cookbook stamp: a committed record of the inputs and outputs of the last
 * compile known to match `cookbook/`, so the drift check can tell that nothing
 * moved since and skip its recompile (docs/importer/DECISIONS.md, 2026-11-17,
 * "The cookbook drift check recompiles only when its inputs moved").
 *
 * The stamp, `tools/importer/cookbook-stamp.json`, holds two sha256 digests:
 *
 * - `inputs`: everything the compile reads.
 *   - Each file the compiler's `loadRegister` reads (`registerFiles`: every
 *     non-underscore `register/` directory, `_kinds/` and `_refs/`). The
 *     gitignored pipeline state beside them is not read and not hashed, so a
 *     scratch clone and a working tree agree.
 *   - Each file under `vendor/pdfjs/`.
 *   - `compile-cookbook.mjs` and every repo module reachable from it by static
 *     `import … from`, `export … from`, side-effect `import "x"` and literal
 *     `import("x")`.
 *   - The name and version of each installed bare-specifier package among them.
 *   - The name and byte size of each reference PDF, never its content.
 *   Text is hashed with CRLF folded to LF, so a checkout's line endings do not
 *   move it.
 * - `outputs`: every `cookbook/*.json`, by name and content.
 *
 * Both digests are pure functions of a directory tree, so the fingerprint and
 * the decision run in a test with no PDFs. The module reads no PDF and runs no
 * compile.
 *
 * Blind spots, reported by `node tools/importer/cookbook-stamp.mjs` and not
 * hashed: a dynamic `import()` whose specifier is not a string literal, and a
 * data file a walked module reads by a path built at run time. A module that
 * has the first is listed as `blind`, and a target reached either way is not in the
 * inputs digest.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The repository root this module sits under, `tools/importer/../..`. */
export const REPO_ROOT = path.join(HERE, "..", "..");

/** The committed stamp, relative to the repository root. */
export const STAMP_PATH = "tools/importer/cookbook-stamp.json";

/** The compiler the walk starts from, relative to the repository root. */
export const COMPILER_ENTRY = "tools/importer/compile-cookbook.mjs";

/** Directories hashed whole: the vendored pdf.js, whose worker is loaded by path. */
export const INPUT_DIRS = ["vendor/pdfjs"];

/** The `register/` directories the compiler reads besides the book directories. */
const REGISTER_SHARED = new Set(["_kinds", "_refs"]);

/** The environment variable that forces the full recompile. */
export const FORCE_ENV = "ACKS_COOKBOOK_DRIFT_FULL";

const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
const posix = (p) => p.split(path.sep).join("/");

/** A file's digest with CRLF folded to LF. */
function fileDigest(file) {
  return sha(fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n"));
}

/** Every file under `dir`, recursively, as absolute paths in sorted order. */
function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const d of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) out.push(...filesUnder(p));
    else if (d.isFile()) out.push(p);
  }
  return out;
}

/**
 * The register files the compiler reads, as absolute paths: every file under a
 * `register/` directory that is a book's (no leading underscore) or one of
 * `_kinds` and `_refs`. Files beside them (`_ledger.json`, `_manifest/`,
 * `_proposals/`, `_icons.json`) are local pipeline state the compile never reads.
 *
 * @param {string} root repository root
 */
export function registerFiles(root) {
  const reg = path.join(root, "register");
  if (!fs.existsSync(reg)) return [];
  return fs
    .readdirSync(reg, { withFileTypes: true })
    .filter((d) => d.isDirectory() && (!d.name.startsWith("_") || REGISTER_SHARED.has(d.name)))
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((d) => filesUnder(path.join(reg, d.name)));
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
 * The inputs digest and what went into it.
 *
 * @param {object} o
 * @param {string} o.root repository root
 * @param {string} [o.entry] the compiler, relative to `root`
 * @param {string[]} [o.dirs] directories under `root` hashed whole
 * @param {Record<string, string>} o.pdfs reference PDF paths by book id; each
 *   contributes its basename and byte size, or `absent`
 * @returns {{hash: string, files: string[], packages: string[], blind: string[]}}
 */
export function inputFingerprint({ root, entry = COMPILER_ENTRY, dirs = INPUT_DIRS, pdfs }) {
  const walk = walkImports(root, entry);
  const files = new Set(walk.files);
  for (const f of registerFiles(root)) files.add(posix(path.relative(root, f)));
  for (const d of dirs) for (const f of filesUnder(path.join(root, d))) files.add(posix(path.relative(root, f)));
  const lines = ["cookbook-stamp/1"];
  const sorted = [...files].sort();
  for (const f of sorted) lines.push(`file ${f} ${fileDigest(path.join(root, f))}`);
  for (const p of walk.packages) {
    const version = JSON.parse(fs.readFileSync(path.join(root, "node_modules", p, "package.json"), "utf8")).version;
    lines.push(`package ${p} ${version}`);
  }
  for (const id of Object.keys(pdfs).sort()) {
    const f = pdfs[id];
    const size = fs.existsSync(f) ? fs.statSync(f).size : "absent";
    lines.push(`pdf ${id} ${path.basename(f)} ${size}`);
  }
  return { hash: sha(lines.join("\n")), files: sorted, packages: walk.packages, blind: walk.blind };
}

/**
 * The outputs digest: every `*.json` in the cookbook directory, by name and
 * content.
 *
 * @param {string} cookbookDir
 * @returns {string}
 */
export function outputFingerprint(cookbookDir) {
  const names = fs.existsSync(cookbookDir) ? fs.readdirSync(cookbookDir).filter((f) => f.endsWith(".json")).sort() : [];
  return sha(["cookbook-outputs/1", ...names.map((n) => `${n} ${fileDigest(path.join(cookbookDir, n))}`)].join("\n"));
}

/** The stamp at `file`, or null when absent or unreadable. */
export function readStamp(file) {
  try {
    const s = JSON.parse(fs.readFileSync(file, "utf8"));
    return typeof s?.inputs === "string" && typeof s?.outputs === "string" ? s : null;
  } catch {
    return null;
  }
}

/** Writes the stamp for these digests, in the shape `readStamp` reads. */
export function writeStamp(file, { inputs, outputs }) {
  fs.writeFileSync(file, JSON.stringify({ inputs, outputs }, null, 2) + "\n");
}

/**
 * Whether the recompile can be skipped: both digests equal the stamp's and the
 * force variable is not set.
 *
 * @param {object} o
 * @param {{inputs: string, outputs: string}} o.now the digests as the tree stands
 * @param {{inputs: string, outputs: string}|null} o.stamp the committed stamp
 * @param {Record<string, string|undefined>} [o.env] the environment, `process.env` by default
 * @returns {{skip: boolean, why: string}}
 */
export function decide({ now, stamp, env = process.env }) {
  if (env[FORCE_ENV] && env[FORCE_ENV] !== "0") return { skip: false, why: `${FORCE_ENV} is set` };
  if (!stamp) return { skip: false, why: "no stamp" };
  if (stamp.inputs !== now.inputs) return { skip: false, why: "inputs changed since the stamp" };
  if (stamp.outputs !== now.outputs) return { skip: false, why: "cookbook/ changed since the stamp" };
  return { skip: true, why: "inputs and outputs match the stamp" };
}

/**
 * The digests of this repository as it stands.
 *
 * @param {Record<string, string>} pdfs reference PDF paths by book id
 * @param {string} [root]
 */
export function currentDigests(pdfs, root = REPO_ROOT) {
  return { inputs: inputFingerprint({ root, pdfs }), outputs: outputFingerprint(path.join(root, "cookbook")) };
}

// Run directly: report the input set and its blind spots.
if (process.argv[1] && import.meta.url.endsWith(path.basename(process.argv[1]))) {
  const { FILES, COMMUNITY_FILES } = await import("./reference-lib.mjs");
  const fp = inputFingerprint({ root: REPO_ROOT, pdfs: { ...FILES, ...COMMUNITY_FILES } });
  console.log(`cookbook stamp inputs: ${fp.files.length} file(s), ${fp.packages.length} package(s) [${fp.packages.join(", ")}]`);
  console.log(`  digest ${fp.hash}`);
  console.log(`  blind (dynamic import, non-literal specifier): ${fp.blind.length ? fp.blind.join(", ") : "none"}`);
  const stamp = readStamp(path.join(REPO_ROOT, STAMP_PATH));
  console.log(`  stamp: ${stamp ? `${stamp.inputs.slice(0, 8)} / ${stamp.outputs.slice(0, 8)}` : "none"}`);
}
