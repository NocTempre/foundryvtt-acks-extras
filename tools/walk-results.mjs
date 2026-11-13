/**
 * The live-walk result file, and the checks the runner and the release
 * preflight both make against it. A module's runner (`tools/live/run.mjs`)
 * writes `aia-tmp/live/walk-results.json`; the preflight reads it. Both import
 * this file, so the schema, the reduction of a walk's output to a state, the
 * tree id a result is bound to and the verdict on a result live once.
 *
 * A walk ends in one of five states. `passed` needs a `WALK END` line, at
 * least one PASS, no FAIL and exit 0; exit 0 without `WALK END`, or with no
 * check passed, is `stopped`; `WALK BLOCKED:` is `blocked`; `WALK ERROR`, a
 * signal or an unexplained non-zero exit is `errored`; any other FAIL is
 * `failed`. A required walk with no entry is "not run": absence is never a
 * pass.
 *
 * Each entry is bound to a runtime tree id, a git tree built from every path
 * the release zip ships, with `packs/_source` standing in for the compiled
 * packs and with the files a release edits as a matter of course left out
 * (changelog, readme, licence, and `module.json`'s version, download and
 * manifest). The id is taken at the walk's start and again at its end, and a
 * result whose id differs from the current one is stale. The walk's own file
 * sits outside that tree (`tools/` is not shipped), so an edit to the walk is
 * a separate hash. Line endings are normalized before hashing, so the id of a
 * working tree and of the commit it becomes agree under any `core.autocrlf`.
 *
 * The id is computed in a temporary index and the objects are written into the
 * repository's object database, so `git diff-tree -r --name-only <a> <b>`
 * names the paths that differ. The repository's own index is never touched.
 *
 * The result file is `{ schema, walks: { <name>: entry } }`, one entry per
 * walk, replaced wholesale by each attempt (the latest attempt wins, and a
 * classification belongs to the attempt it was made on).
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** The result file's schema number. */
export const SCHEMA = 1;

/** The result file's path, posix, relative to the repository root. */
export const RESULT_PATH = "aia-tmp/live/walk-results.json";

/** The states a walk's attempt ends in. */
export const STATES = ["passed", "stopped", "blocked", "errored", "failed"];

/** What a non-passing walk's cause is classified as. */
export const CLASSES = ["defect", "world-state", "stale-walk", "environment"];

/** The ledger-row statuses that count as classified. */
export const CLASSIFIED_STATUSES = ["new", "claimed", "deferred"];

/**
 * The `-x` globs of the release workflow's zip step, in its order. A suite
 * holds this list equal to the workflow's, so a path the zip leaves out is
 * left out of the runtime tree too.
 */
export const ZIP_DENYLIST = [
  ".git/*", ".githooks/*", ".github/*", ".claude/*", "node_modules/*",
  "packs/_source/*", "tools/*", "register/*", "docs/*",
  "changelog.d/*", "CHANGELOG-through-*.md",
  "package.json", "package-lock.json",
  ".gitignore", ".gitattributes", "CLAUDE.md", "module.zip",
];

/**
 * Paths the zip would ship that are not the runtime: the root files a release
 * edits as a matter of course, and the scratch directory, which the ignore
 * list keeps out of every checkout but which would otherwise enter a
 * working-tree id (the result file itself included) wherever that line is
 * missing.
 */
export const RUNTIME_EXCLUDES = ["CHANGELOG.md", "README.md", "LICENSE", "LICENSE.*", "aia-tmp/*"];

const HEX40 = /^[0-9a-f]{40}$/u;

/**
 * A zip `-x` glob as a regular expression: `*` matches any run of characters,
 * `/` included, `?` one character, and the pattern must match the whole stored
 * path, so a pattern with no `/` matches a root-level path only.
 */
function globToRegExp(glob) {
  let source = "";
  for (const ch of glob) {
    if (ch === "*") source += ".*";
    else if (ch === "?") source += ".";
    else source += ch.replace(/[.+^${}()|[\]\\]/gu, "\\$&");
  }
  return new RegExp(`^${source}$`, "su");
}
const DENY = ZIP_DENYLIST.map(globToRegExp);
const EXCLUDE = RUNTIME_EXCLUDES.map(globToRegExp);

/** Whether a repo-relative posix path is part of the runtime tree. */
export function isRuntimePath(rel) {
  if (rel.startsWith("packs/_source/")) return true;
  return !DENY.some((re) => re.test(rel)) && !EXCLUDE.some((re) => re.test(rel));
}

// -- walks -------------------------------------------------------------------

const walkName = (name) => (name.startsWith("_") || name === "run" ? null : name);

/** The sorted walk names among a list of repo paths: `tools/live/<name>.mjs`, not `_`-prefixed, not `run`. */
export function listWalks(names) {
  const out = new Set();
  for (const p of names) {
    const m = /^tools\/live\/([^/]+)\.mjs$/u.exec(String(p).replaceAll("\\", "/"));
    if (m && walkName(m[1])) out.add(m[1]);
  }
  return [...out].sort();
}

/** The walk names a recipe's text mentions as `tools/live/<name>.mjs`, same exclusions as `listWalks`. */
export function walksNamedBy(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/tools\/live\/([\w.-]+)\.mjs(?![\w-])/gu)) if (walkName(m[1])) out.add(m[1]);
  return out;
}

// -- the reducer -------------------------------------------------------------

/**
 * Reduces a walk's printed lines and how its process ended to a state and a
 * tally. `lines` is an array of lines or one string, and a line may carry a
 * `\r`. Checks are counted from `PASS`, `FAIL` and `GAP` lines, none after the
 * `== summary ==` heading, which lists the same checks again. A GAP is counted
 * and does not make a walk red. First match wins: signal, `WALK BLOCKED:`,
 * `WALK ERROR`, a FAIL, a non-zero exit, no `WALK END` or no PASS, passed.
 */
export function reduce(lines, { exit, signal } = {}) {
  const list = typeof lines === "string" ? lines.split("\n") : lines;
  const tally = { pass: 0, fail: 0, gap: 0 };
  let blocked = false;
  let error = false;
  let ended = false;
  let inSummary = false;
  for (const raw of list) {
    const line = String(raw).replace(/\r$/u, "");
    if (/^==\s+summary\s+==/iu.test(line)) inSummary = true;
    if (line.startsWith("WALK BLOCKED:")) blocked = true;
    else if (line.startsWith("WALK ERROR")) error = true;
    else if (line.startsWith("WALK END")) ended = true;
    if (inSummary) continue;
    if (/^PASS\b/u.test(line)) tally.pass++;
    else if (/^FAIL\b/u.test(line)) tally.fail++;
    else if (/^GAP\b/u.test(line)) tally.gap++;
  }
  let state;
  if (signal) state = "errored";
  else if (blocked) state = "blocked";
  else if (error) state = "errored";
  else if (tally.fail > 0) state = "failed";
  else if (exit !== 0) state = "errored";
  else if (!ended || tally.pass === 0) state = "stopped";
  else state = "passed";
  return { state, tally };
}

// -- git ---------------------------------------------------------------------

/** The environment a git child runs in: the caller's, less the variables that would redirect it to another repository or index. */
function gitEnv(extra = {}) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^GIT_(DIR|WORK_TREE|INDEX_FILE|PREFIX)$/iu.test(key)) delete env[key];
  return { ...env, ...extra };
}

/** Runs git in `root`; returns stdout as a Buffer and throws on a non-zero exit. */
function git(root, args, { input, env } = {}) {
  const r = spawnSync("git", args, { cwd: root, env: gitEnv(env), input, maxBuffer: Infinity, stdio: ["pipe", "pipe", "pipe"] });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} exited ${r.status}: ${String(r.stderr).trim()}`);
  return r.stdout;
}

/** Content with no NUL byte has `\r\n` read as `\n`; binary content is left as it is. */
function normalizeEol(buf) {
  if (buf.includes(0) || !buf.includes(13)) return buf;
  return Buffer.from(buf.toString("latin1").replace(/\r\n/gu, "\n"), "latin1");
}

/** `module.json` without the keys a release writes, re-serialized; unparseable text is its normalized raw self. */
function normalizeManifest(buf) {
  const raw = normalizeEol(buf);
  let obj;
  try {
    obj = JSON.parse(raw.toString("utf8").replace(/^﻿/u, ""));
  } catch {
    return raw;
  }
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) return raw;
  for (const key of ["version", "download", "manifest"]) delete obj[key];
  const out = Buffer.from(`${JSON.stringify(obj, null, 2)}\n`, "utf8");
  return out.equals(buf) ? buf : out;
}

/** What a file hashes as: the same bytes a clean checkout would commit, whatever the platform's line endings. Returns `buf` itself when nothing changes. */
function normalize(rel, buf) {
  return rel === "module.json" ? normalizeManifest(buf) : normalizeEol(buf);
}

/** The blob ids of a list of files on disk, in order, written into the object database. */
function hashFiles(root, files) {
  if (!files.length) return [];
  const out = git(root, ["hash-object", "-w", "--no-filters", "--stdin-paths"], { input: `${files.join("\n")}\n` })
    .toString("utf8").split("\n").filter(Boolean);
  if (out.length !== files.length) throw new Error(`git hash-object returned ${out.length} ids for ${files.length} files`);
  return out;
}

/** The blob id of `buf`, not written. */
const hashBuffer = (root, buf) => git(root, ["hash-object", "--no-filters", "--stdin"], { input: buf }).toString("utf8").trim();

/** The working tree's runtime files as `{ rel, content }`: tracked and untracked-not-ignored, less what no longer exists on disk. */
function workingTreeFiles(root) {
  const listed = git(root, ["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).toString("utf8").split("\0").filter(Boolean);
  const files = [];
  for (const rel of new Set(listed)) {
    if (!isRuntimePath(rel)) continue;
    const abs = path.join(root, rel);
    try {
      if (!fs.statSync(abs).isFile()) continue;
      files.push({ rel, abs, content: fs.readFileSync(abs) });
    } catch (e) {
      if (e.code !== "ENOENT" && e.code !== "ENOTDIR") throw e;
    }
  }
  return files;
}

/** A commit's runtime files as `{ rel, blob, content }`, every content read through one `git cat-file --batch`. */
function commitFiles(root, at) {
  const listing = git(root, ["ls-tree", "-r", "-z", "--full-tree", at]).toString("utf8").split("\0").filter(Boolean);
  const entries = [];
  for (const row of listing) {
    const m = /^\d+ (\w+) ([0-9a-f]{40})\t([^]*)$/u.exec(row);
    if (!m || m[1] !== "blob" || !isRuntimePath(m[3])) continue;
    entries.push({ rel: m[3], blob: m[2] });
  }
  if (!entries.length) return [];
  const out = git(root, ["cat-file", "--batch"], { input: `${entries.map((e) => e.blob).join("\n")}\n` });
  let at0 = 0;
  for (const entry of entries) {
    const nl = out.indexOf(10, at0);
    const header = out.subarray(at0, nl).toString("latin1");
    const m = /^[0-9a-f]{40} \w+ (\d+)$/u.exec(header);
    if (!m) throw new Error(`git cat-file --batch: unexpected header "${header}"`);
    const size = Number(m[1]);
    entry.content = out.subarray(nl + 1, nl + 1 + size);
    at0 = nl + 1 + size + 1;
  }
  return entries;
}

/**
 * The runtime tree id of the working tree, or with `at` (a commit-ish) of that
 * commit. Returns `{ tree }`, a 40-hex git tree id. Both sources give the same
 * id for the same content: every file is normalized the same way, and every
 * mode is 100644.
 */
export function runtimeTree(root, { at } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "walk-tree-"));
  try {
    const files = at ? commitFiles(root, at) : workingTreeFiles(root);
    const rows = []; // { rel, blob?, file? } — a blob id when known, else a file to hash
    files.forEach((f, i) => {
      const norm = normalize(f.rel, f.content);
      if (norm === f.content) rows.push(f.blob ? { rel: f.rel, blob: f.blob } : { rel: f.rel, file: f.abs });
      else {
        const file = path.join(tmp, String(i));
        fs.writeFileSync(file, norm);
        rows.push({ rel: f.rel, file });
      }
    });
    const pending = rows.filter((r) => !r.blob);
    hashFiles(root, pending.map((r) => r.file)).forEach((id, i) => { pending[i].blob = id; });

    const env = { GIT_INDEX_FILE: path.join(tmp, "index") };
    if (rows.length) {
      const info = rows.map((r) => `100644 ${r.blob}\t${r.rel}\0`).join("");
      git(root, ["update-index", "-z", "--index-info"], { input: info, env });
    }
    const tree = git(root, ["write-tree"], { env }).toString("utf8").trim();
    if (!HEX40.test(tree)) throw new Error(`git write-tree returned "${tree}"`);
    return { tree };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * The normalized blob id of `tools/live/<name>.mjs` in the working tree, or in
 * the commit `at`; null when the file is absent. Only the walk's own file: a
 * `_*.mjs` helper it imports is not part of it.
 */
export function walkBlob(root, name, { at } = {}) {
  const rel = `tools/live/${name}.mjs`;
  let content;
  if (at) {
    const r = spawnSync("git", ["cat-file", "blob", `${at}:${rel}`], { cwd: root, env: gitEnv(), maxBuffer: Infinity, stdio: ["pipe", "pipe", "pipe"] });
    if (r.error) throw r.error;
    if (r.status !== 0) return null;
    content = r.stdout;
  } else {
    try {
      content = fs.readFileSync(path.join(root, rel));
    } catch (e) {
      if (e.code === "ENOENT" || e.code === "ENOTDIR" || e.code === "EISDIR") return null;
      throw e;
    }
  }
  return hashBuffer(root, normalizeEol(content));
}

// -- the result file ---------------------------------------------------------

/** Reads the result file: `{ data }`, or `{ error }` of "missing", "unreadable" or "schema <n>". */
export function readResults(root) {
  let text;
  try {
    text = fs.readFileSync(path.join(root, RESULT_PATH), "utf8");
  } catch (e) {
    return { error: e.code === "ENOENT" ? "missing" : "unreadable" };
  }
  let data;
  try {
    data = JSON.parse(text.replace(/^﻿/u, ""));
  } catch {
    return { error: "unreadable" };
  }
  if (data === null || typeof data !== "object" || Array.isArray(data)) return { error: "unreadable" };
  if (data.schema !== SCHEMA) return { error: `schema ${data.schema}` };
  if (data.walks === null || typeof data.walks !== "object" || Array.isArray(data.walks)) return { error: "unreadable" };
  return { data };
}

/** Writes the whole result file through a temp file in its directory and a rename, so a reader never sees half of it. */
function writeResults(root, data) {
  const file = path.join(root, RESULT_PATH);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const sorted = { schema: SCHEMA, walks: Object.fromEntries(Object.keys(data.walks).sort().map((k) => [k, data.walks[k]])) };
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(tmp, `${JSON.stringify(sorted, null, 2)}\n`);
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/** The current file's contents to merge onto: an absent, unreadable or other-schema file merges onto nothing. */
const currentResults = (root) => readResults(root).data ?? { schema: SCHEMA, walks: {} };

/**
 * Records one walk's attempt, replacing its entry wholesale (the latest
 * attempt wins, so an earlier classification is dropped) and keeping every
 * other walk's. `entry` is `{ state, tally: { pass, fail, gap }, exit, signal,
 * treeStart, treeEnd, walkBlob, partial, startedAt, endedAt }`, where
 * `partial` is false or the reason the attempt ran fewer checks than the
 * walk holds. Throws on an entry that does not have that shape.
 */
export function recordAttempt(root, name, entry) {
  const problems = [];
  if (!STATES.includes(entry?.state)) problems.push(`state "${entry?.state}"`);
  for (const k of ["pass", "fail", "gap"]) if (!Number.isInteger(entry?.tally?.[k]) || entry.tally[k] < 0) problems.push(`tally.${k}`);
  for (const k of ["treeStart", "treeEnd", "walkBlob"]) if (!HEX40.test(entry?.[k] ?? "")) problems.push(`${k} is not a 40-hex id`);
  if (entry?.exit !== null && !Number.isInteger(entry?.exit)) problems.push("exit");
  if (entry?.signal !== null && typeof entry?.signal !== "string") problems.push("signal");
  if (entry?.partial !== false && !(typeof entry?.partial === "string" && entry.partial)) problems.push("partial");
  for (const k of ["startedAt", "endedAt"]) if (typeof entry?.[k] !== "string" || !entry[k]) problems.push(k);
  if (problems.length) throw new Error(`walk-results: bad entry for ${name}: ${problems.join(", ")}`);
  const data = currentResults(root);
  data.walks[name] = { ...entry };
  writeResults(root, data);
}

/**
 * Puts a classification on a walk's existing entry: `row` is the ledger row
 * (`T-1234`), `as` one of CLASSES, `status` the row's status as the caller
 * found it (one of CLASSIFIED_STATUSES), `version` the module's version now.
 * Throws when the walk has no entry or an argument is not one of those.
 */
export function recordClassification(root, name, { row, as, status, version } = {}) {
  if (!CLASSES.includes(as)) throw new Error(`walk-results: "${as}" is not one of ${CLASSES.join(", ")}`);
  if (!/^T-\d{4,}$/u.test(row ?? "")) throw new Error(`walk-results: "${row}" is not a ledger row id`);
  if (!CLASSIFIED_STATUSES.includes(status)) throw new Error(`walk-results: status "${status}" is not one of ${CLASSIFIED_STATUSES.join(", ")}`);
  if (typeof version !== "string" || !version) throw new Error("walk-results: classification needs the version it is made for");
  const data = currentResults(root);
  if (!data.walks[name]) throw new Error(`walk-results: ${name} has no recorded attempt to classify`);
  data.walks[name] = { ...data.walks[name], classification: { row, as, status, version, at: new Date().toISOString() } };
  writeResults(root, data);
}

// -- the verdict -------------------------------------------------------------

/**
 * The verdict on each required walk: `{ walk, state, ok, why }`. `data` is
 * `readResults(root).data` (absent when the file is), `tree` the current
 * runtime tree id, `walkBlobs` the current blob id of each walk's file,
 * `version` the release's, and `diffPaths(a, b)` optionally names the paths
 * that differ between two tree ids. A walk is ok when it is current and either
 * passed or classified for this release; a defect is ok only when its ledger
 * row is `deferred`.
 */
export function evaluate({ data, required, tree, walkBlobs = {}, version, diffPaths }) {
  return required.map((walk) => {
    const e = data?.walks?.[walk];
    const refuse = (why) => ({ walk, state: e?.state ?? "not run", ok: false, why });
    if (!e) return refuse("not run");
    if (e.walkBlob !== (walkBlobs[walk] ?? null)) return refuse("stale: the walk changed since it ran");
    if (e.treeStart !== e.treeEnd) return refuse("the runtime changed during its run");
    if (e.treeStart !== tree) {
      let paths = [];
      try {
        paths = diffPaths?.(e.treeStart, tree) ?? [];
      } catch {
        paths = [];
      }
      const shown = paths.slice(0, 5).join(", ");
      const more = paths.length > 5 ? `, +${paths.length - 5} more` : "";
      return refuse(`stale: runtime differs${paths.length ? ` — ${shown}${more}` : ""}`);
    }
    if (e.partial) return refuse(`partial: ${e.partial}`);
    if (e.state === "passed") return { walk, state: e.state, ok: true, why: "passed" };
    const c = e.classification;
    if (!c) return refuse(`${e.state}, not classified`);
    if (c.version !== version) return refuse(`classified for ${c.version}; classify again for this release`);
    if (c.as === "defect" && c.status !== "deferred") return refuse("a defect ships only when its row is deferred");
    if (!CLASSIFIED_STATUSES.includes(c.status)) return refuse(`row ${c.row} is ${c.status}, not classified`);
    if (!CLASSES.includes(c.as)) return refuse(`classified as "${c.as}", which is not a class`);
    return { walk, state: e.state, ok: true, why: `classified ${c.as} ${c.row} (${c.status})` };
  });
}
