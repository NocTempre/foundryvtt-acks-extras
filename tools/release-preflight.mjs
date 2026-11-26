/**
 * Release preflight gate. Run before tagging; `/acks-release` invokes it and
 * a red result stops the release.
 *
 * Every check reads one source, chosen once at startup: the working tree by
 * default, or with `--at <rev>` the commit that names. The run before the tag
 * passes `--at` with the release commit and so judges what the tag will hold;
 * peer sessions' uncommitted hunks never move its verdict. Under `--at`
 * nothing is untracked, and a bad rev is refused. Tag lookups (local, origin,
 * the previous tag's date) are not reads of the source and are the same in
 * both modes.
 *
 * There is one release path and it takes no kind: `--kind` is refused in one
 * line.
 *
 * Two runs bracket a release: `--live-pending` at the bump, before the live
 * session, and `--at <sha>` just before the tag. `--live-pending` lists the
 * smoke walk, where it is not yet current and passing, as still to run instead
 * of refusing it. `--at` takes no `--live-pending`: a tag needs a machine with
 * a test server, so the run before it waives nothing.
 *
 * Checks, in order:
 *   1. The tag (v<module.json version>, or --tag) does not already exist,
 *      locally or on origin. A published tag is never reused — a version that
 *      needs fixing is released as the day's next version (check 4), not
 *      retagged.
 *   2. Every feature surface changed since the last v* tag is listed with its
 *      live-test recipe: `scripts/<feature>/**` maps to
 *      `docs/<feature>/TESTING.md`, and files directly under `scripts/` map to
 *      `docs/TESTING.md`. A surface with no recipe is a note and never a
 *      failure, and the recipes are not read for walk names. Changed means
 *      changed relative to the last tag in the source the run reads. By
 *      default that is the WORKING TREE, committed or not, tracked or not: the
 *      run at the bump reads a release that is not committed yet. Under `--at`
 *      it is the commit the tag will name. A feature removed whole owes no
 *      recipe and no note.
 *   3. `version-date`: module.json's version is a release day, `YYYY.M.D` with
 *      no leading zeros and an optional `.N` from 1 for a later release that
 *      day. The date must exist and must not be after today; a date before
 *      today warns and never fails. Today is the local date of the machine
 *      running the preflight, so CI, which runs on UTC, never judges the date.
 *   4. `version-order`: the version is newer than every v* tag, local and on
 *      origin, whose version has the shape validate accepts, compared part by
 *      part as Foundry compares versions, and it is the day's next version:
 *      the bare date when no tag names that day, else the highest `.N` on that
 *      day plus one. A refusal prints the version it expects. Tags are never
 *      sorted as strings and `git describe` is not the last version: it names
 *      the nearest tag in history, not the highest.
 *   5. `changelog-compiled`: no tracked file is left under `changelog.d/`
 *      (`node tools/logs.mjs compile` writes the section and deletes the
 *      fragments), no file there has a name that does not parse, and where
 *      runtime files (`scripts/`, `templates/`, `styles/`, `lang/`,
 *      `packs/_source/`) changed since the previous tag the version's CHANGELOG
 *      section holds a bullet. An untracked fragment is noted, not refused. A
 *      `<!-- shot: … -->` or `<!-- no-shot: … -->` comment in a bullet is
 *      ignored. The previous tag is the highest local v* tag by the check-4
 *      compare, excluding this release's own; with none, the changed-files
 *      clause is silent.
 *   6. `live-walks`, where `tools/live/run.mjs` is tracked (a repo with none
 *      prints "no walks" and passes). The smoke walk, `window-contract`, is
 *      required alone, and its absence as `tools/live/window-contract.mjs` is
 *      a failure. A walk is a `tools/live/<name>.mjs` that is not `run` and
 *      does not start with `_`; no other walk is required. The runner's result
 *      file (`aia-tmp/live/walk-results.json`) is always read from the working
 *      tree, never from a commit, and is refused where it is tracked, where
 *      it cannot be read or where its schema is not the one `walk-results.mjs`
 *      knows; a missing file is refused too. The smoke walk is then held to
 *      the verdict `walk-results.mjs` gives: it was run, it ended on a runtime
 *      tree that its start shared, that tree is the present one (a path named
 *      in the refusal), the walk's own file is unchanged or it passed, it ran
 *      every check, and it passed. A walk that did not pass counts only when
 *      it is classified through the runner (`node tools/live/run.mjs
 *      --classify <walk> <T-id> defect|world-state|stale-walk|environment`,
 *      which reads the ledger; this check reads only the result file), for
 *      this release's version, on a row that is `new`, `claimed` or
 *      `deferred`. A failure classified as a product defect ships only when
 *      its row is `deferred`. The current tree is the working tree's, or with
 *      `--at` the commit's, with the same line-ending and release-edit
 *      normalization the runner applies. No flag waives the walk:
 *      --live-pending, made before the live session, lists it as still to run
 *      when it is not yet current and passing, a missing file included, instead
 *      of refusing it, and `--at` takes no such listing.
 *
 * Exit 0 prints the recipes of the changed surfaces and the smoke walk with
 * its verdict (under --live-pending, the walk still to run); exit 1 lists
 * every failure. A repo with no v* tag yet (first release) skips check 2.
 *
 * Usage: node tools/release-preflight.mjs [--tag v<version>] [--live-pending | --at <rev>]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import { RESULT_PATH, SMOKE_WALK, evaluate, listWalks, readResults, runtimeTree, walkBlob } from "./walk-results.mjs";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();

const args = process.argv.slice(2);
const tagArg = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;
const livePending = args.includes("--live-pending");
const atArg = args.includes("--at") ? args[args.indexOf("--at") + 1] : null;

const failures = [];
const fail = (msg) => failures.push(msg);

/** Prints every failure so far and exits 1, for a run that cannot go on to read its source. */
function bail(label) {
  console.error(`release-preflight: ${failures.length} blocker(s) for ${label}:`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}

if (args.some((a) => a === "--kind" || a.startsWith("--kind="))) {
  console.error("release-preflight: release kinds are retired and the --kind flag is gone — run the preflight without it");
  process.exit(1);
}
if (args.includes("--at") && livePending) {
  fail("--at takes no --live-pending: the run before the tag judges the commit and waives nothing — a tag needs a machine with a test server");
}

/** NUL-separated git listing, so a path is never quoted or split. */
const gitZ = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8", maxBuffer: 1 << 28 }).split("\0").filter(Boolean);

/** Every file under a directory of the working tree, as posix paths relative to ROOT; empty where it is absent. */
function walk(rel) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return [];
  return fs.readdirSync(abs, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(`${rel}/${d.name}`) : [`${rel}/${d.name}`]));
}

/**
 * The working tree as a source. `exists` is true of a file or a directory,
 * `list` gives every file under a directory (posix, relative to ROOT),
 * `changedSince` every path that differs from a tag, untracked files
 * included, and `tracked` the tracked files under a directory.
 */
function worktreeSource() {
  return {
    label: "working tree",
    exists: (rel) => fs.existsSync(path.join(ROOT, rel)),
    read: (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"),
    list: walk,
    // Two-argument diff (tag vs working tree), never `tag..HEAD`: HEAD misses
    // everything staged or unstaged. Untracked files are changes too — a
    // brand-new directory is invisible to diff until it is added.
    changedSince: (tagName) => [...gitZ("diff", "-z", "--name-only", tagName), ...gitZ("ls-files", "-z", "--others", "--exclude-standard")],
    tracked: (rel) => new Set(gitZ("ls-files", "-z", "--", rel)),
  };
}

/**
 * A commit as a source, read from its tree and never from the disk. The tree
 * is listed once into a path-to-blob map; a path exists only as a file, so a
 * directory is found with `list`. Everything in a commit is tracked
 * and nothing is untracked.
 */
function commitSource(sha) {
  const blobs = new Map();
  for (const rec of gitZ("ls-tree", "-r", "-z", "--full-tree", sha)) {
    const tab = rec.indexOf("\t");
    const [, type, id] = rec.slice(0, tab).split(" ");
    if (type === "blob") blobs.set(rec.slice(tab + 1), id);
  }
  const under = (rel) => [...blobs.keys()].filter((f) => f.startsWith(`${rel}/`));
  return {
    label: `commit ${sha.slice(0, 12)}`,
    exists: (rel) => blobs.has(rel),
    read: (rel) => execFileSync("git", ["-C", ROOT, "cat-file", "blob", blobs.get(rel)], { encoding: "utf8", maxBuffer: 1 << 28 }),
    list: under,
    changedSince: (tagName) => gitZ("diff", "-z", "--name-only", tagName, sha),
    tracked: (rel) => new Set(under(rel)),
  };
}

let atSha = "";
if (args.includes("--at")) {
  const rev = atArg && !atArg.startsWith("-") ? atArg : "";
  try {
    if (!rev) throw new Error("no rev");
    atSha = execFileSync("git", ["-C", ROOT, "rev-parse", "--verify", `${rev}^{commit}`], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    fail(`--at ${rev || "(no value)"} is not a commit of this repository — pass the sha of the commit the tag will name`);
    bail(tagArg ?? "(no tag)");
  }
}
const src = atSha ? commitSource(atSha) : worktreeSource();
if (atSha) console.log(`note: reading ${src.label}, not the working tree`);

if (!src.exists("module.json")) {
  fail(`module.json is missing from the ${src.label}`);
  bail(tagArg ?? "(no tag)");
}
const moduleJson = JSON.parse(src.read("module.json").replace(/^﻿/u, ""));
const tag = tagArg ?? `v${moduleJson.version}`;
if (tagArg && tagArg !== `v${moduleJson.version}`) {
  fail(`tag ${tagArg} does not match module.json version ${moduleJson.version}`);
}

/** The shape of a version Foundry can order; validate.mjs holds the same test. */
const ORDERABLE = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){2}(\.[1-9]\d*)?$/u;
/** A release day, `YYYY.M.D`, with an optional `.N` from 1 for a later release that day. */
const DATE_SHAPE = /^([1-9]\d{3})\.([1-9]|1[0-2])\.([1-9]|[12]\d|3[01])(?:\.([1-9]\d*))?$/u;

/**
 * Foundry's version compare, part by part: two numeric parts that differ
 * order numerically, parts that are equal as numbers but differ as strings
 * and non-numeric parts order as strings, and a longer version whose leading
 * parts are equal is the newer. Returns 1, -1 or 0.
 */
function compareVersions(a, b) {
  const pa = a.split(".");
  const pb = b.split(".");
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if (pa[i] === undefined) return -1;
    if (pb[i] === undefined) return 1;
    if (/^\d+$/u.test(pa[i]) && /^\d+$/u.test(pb[i]) && Number(pa[i]) !== Number(pb[i])) return Number(pa[i]) > Number(pb[i]) ? 1 : -1;
    if (pa[i] !== pb[i]) return pa[i] > pb[i] ? 1 : -1;
  }
  return 0;
}

/** The release day a version names, as `{ y, m, d, n, day }`, or null where its shape is not a day or the day does not exist. */
function releaseDay(version) {
  const m = DATE_SHAPE.exec(version);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const real = new Date(y, mo - 1, d);
  if (real.getFullYear() !== y || real.getMonth() !== mo - 1 || real.getDate() !== d) return null;
  return { y, m: mo, d, n: m[4] ? Number(m[4]) : 0, day: `${y}.${mo}.${d}` };
}

const nowDate = new Date();
const today = { y: nowDate.getFullYear(), m: nowDate.getMonth() + 1, d: nowDate.getDate() };
today.day = `${today.y}.${today.m}.${today.d}`;

// Every v* tag, local and on origin. Both are read whole: the retag check and
// the version order need the same list, and one unreachable origin is noted once.
const tagNames = new Set(git("tag", "-l", "v*").split("\n").filter(Boolean));
const localTags = new Set(tagNames);
const remoteTags = new Set();
try {
  for (const line of execFileSync("git", ["-C", ROOT, "ls-remote", "--tags", "origin", "v*"], { encoding: "utf8" }).split("\n")) {
    const name = line.split("\t")[1]?.replace(/^refs\/tags\//u, "").replace(/\^\{\}$/u, "");
    if (name) {
      remoteTags.add(name);
      tagNames.add(name);
    }
  }
} catch {
  console.log("note: could not reach origin to check remote tags — verify manually");
}
const tagVersions = [...tagNames].map((t) => t.slice(1)).filter((v) => ORDERABLE.test(v));

/** The day's next version: the bare date where no tag names that day, else the day's highest `.N` plus one. */
function nextOfDay(day) {
  let highest = -1;
  for (const v of tagVersions) {
    if (v === day) highest = Math.max(highest, 0);
    else if (v.startsWith(`${day}.`) && /^\d+$/u.test(v.slice(day.length + 1))) highest = Math.max(highest, Number(v.slice(day.length + 1)));
  }
  return highest < 0 ? day : `${day}.${highest + 1}`;
}

const todaysNext = nextOfDay(today.day);
if (localTags.has(tag)) {
  fail(`tag ${tag} already exists locally — never retag; this release is ${todaysNext}`);
}
if (remoteTags.has(tag)) {
  fail(`tag ${tag} already exists on origin — never retag; this release is ${todaysNext}`);
}

let lastTag = "";
try {
  lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v*", atSha || "HEAD");
} catch {
  console.log("note: no previous v* tag — first release, recipe listing skipped");
}

const notes = [];
const recipes = new Set();
let surfaces = 0;
if (lastTag) {
  const slugs = new Set();
  let flatChanged = false;
  for (const file of src.changedSince(lastTag)) {
    const m = file.match(/^scripts\/([^/]+)\/(.+)/u);
    if (m) slugs.add(m[1]);
    else if (/^scripts\/[^/]+$/u.test(file)) flatChanged = true;
  }
  for (const slug of [...slugs].sort()) {
    if (!src.list(`scripts/${slug}`).length) continue;
    surfaces++;
    const recipe = path.posix.join("docs", slug, "TESTING.md");
    if (src.exists(recipe)) recipes.add(recipe);
    else notes.push(`scripts/${slug}/ changed since ${lastTag} and ${recipe} does not exist — no live-test recipe to walk`);
  }
  if (flatChanged) {
    surfaces++;
    const recipe = "docs/TESTING.md";
    if (src.exists(recipe)) recipes.add(recipe);
    else notes.push(`scripts/ changed since ${lastTag} and ${recipe} does not exist — no live-test recipe to walk`);
  }
}

/**
 * The top-level bullets in a changelog's section for `version`, or null where
 * it has no such section. A bullet runs to the next top-level bullet or
 * heading. The heading test is the release workflow's, so the section read
 * here is the one the release page is built from.
 */
function sectionBullets(text, version) {
  const lines = text.replace(/^﻿/u, "").split(/\r?\n/u);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const heading = new RegExp(`^##\\s+(?:Release\\s+)?\\[?v?${esc}\\]?(?:\\s|$)`, "u");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const bullets = [];
  for (let i = start + 1; i < lines.length && !/^##\s/u.test(lines[i]); i++) {
    if (/^[-*+]\s/u.test(lines[i])) bullets.push(i + 1);
  }
  return bullets;
}

const releaseVersion = String(moduleJson.version);
const releaseOn = releaseDay(releaseVersion);
if (!releaseOn) {
  fail(`version-date: ${releaseVersion} ${DATE_SHAPE.test(releaseVersion) ? "names a date that does not exist" : "is not a release day — YYYY.M.D, with no leading zeros and an optional .N from 1 for a later release that day"}`);
} else {
  const sign = Math.sign(releaseOn.y - today.y || releaseOn.m - today.m || releaseOn.d - today.d);
  if (sign > 0) fail(`version-date: ${releaseVersion} is after today (${today.day}) — a version names the day it is released`);
  else if (sign < 0) console.log(`warn version-date: ${releaseVersion} names ${releaseOn.day}, before today (${today.day})`);
}

if (ORDERABLE.test(releaseVersion)) {
  const notNewer = tagVersions.filter((t) => compareVersions(releaseVersion, t) <= 0).sort(compareVersions);
  const newest = [...tagVersions].sort(compareVersions).at(-1);
  const own = releaseOn ? nextOfDay(releaseOn.day) : null;
  if (notNewer.length) {
    // The day's next on the version's own day is expected only where it is itself newer than every tag.
    const expected = own && compareVersions(own, newest) > 0 ? own : todaysNext;
    fail(`version-order: ${releaseVersion} is not newer than tag v${notNewer.at(-1)} — this release is ${expected}`);
  } else if (own && releaseVersion !== own) {
    fail(`version-order: ${releaseVersion} is not the day's next version — this release is ${own}`);
  }
}

// The previous tag: the highest local v* tag by Foundry's compare, never
// `git describe` (the nearest), and never the release's own tag.
const prevTag =
  [...localTags]
    .filter((t) => ORDERABLE.test(t.slice(1)) && t !== `v${releaseVersion}`)
    .sort((a, b) => compareVersions(a.slice(1), b.slice(1)))
    .at(-1) ?? "";

// changelog-compiled.
{
  const FRAGMENT_NAME = /^\d{4}-\d{2}-\d{2}-[A-Za-z0-9][A-Za-z0-9._-]*\.(upgrading|added|changed|removed|fixed)\.md$/u;
  const tracked = src.tracked("changelog.d");
  for (const f of src.list("changelog.d")) {
    const name = f.slice("changelog.d/".length);
    if (!FRAGMENT_NAME.test(name)) fail(`changelog-compiled: ${f} is not named <YYYY-MM-DD>-<row id or slug>.<upgrading|added|changed|removed|fixed>.md`);
    else if (tracked.has(f)) fail(`changelog-compiled: ${f} is still ${atSha ? `in ${src.label}` : "on disk"} — run node tools/logs.mjs compile`);
    else notes.push(`${f} is untracked — not compiled; it rides with whoever tracks it`);
  }
  if (prevTag) {
    const touched = src.changedSince(prevTag).filter((f) => /^(scripts|templates|styles|lang|packs\/_source)\//u.test(f));
    if (touched.length) {
      const hasLog = src.exists("CHANGELOG.md");
      const entries = hasLog ? sectionBullets(src.read("CHANGELOG.md"), releaseVersion) : null;
      if (!entries?.length) {
        const first = `${touched[0]}${touched.length > 1 ? ` and ${touched.length - 1} more` : ""}`;
        fail(`changelog-compiled: runtime files changed since ${prevTag} (${first}) but CHANGELOG.md ${entries ? `holds no bullet under ${releaseVersion}` : `has no section for ${releaseVersion}`} — write a changelog.d/ fragment and run node tools/logs.mjs compile`);
      }
    }
  }
}

/**
 * live-walks. Returns the verdict row of the smoke walk
 * (`{ walk, state, ok, why }`), or `[]` where nothing was judged: no runner, no
 * smoke walk in the source, or a result file refused. A row that is not ok is a
 * failure unless `--live-pending` lists it instead.
 */
function liveWalks() {
  if (!src.tracked("tools/live").has("tools/live/run.mjs")) {
    notes.push("live-walks: no walks");
    return [];
  }
  if (git("ls-files", "--", RESULT_PATH) !== "" || (atSha && src.exists(RESULT_PATH))) {
    fail(`live-walks: ${RESULT_PATH} is tracked — it is a local record and never enters a commit; remove it with git rm --cached`);
    return [];
  }
  if (!listWalks(src.list("tools/live")).includes(SMOKE_WALK)) {
    fail(`live-walks: tools/live/${SMOKE_WALK}.mjs is missing — the release requires the smoke walk`);
    return [];
  }
  const required = [SMOKE_WALK];
  const { data, error } = readResults(ROOT);
  if (error && error !== "missing") {
    fail(`live-walks: ${RESULT_PATH} is unreadable or of an unknown schema (${error}) — run the walks again`);
    return [];
  }
  if (error && !livePending) {
    fail(`live-walks: no result file at ${RESULT_PATH} — run ${required.join(", ")} with tools/live/run.mjs`);
    return [];
  }
  const same = atSha ? { at: atSha } : {};
  let tree = "";
  const walkBlobs = {};
  if (data) {
    try {
      tree = runtimeTree(ROOT, same).tree;
      for (const w of required) walkBlobs[w] = walkBlob(ROOT, w, same);
    } catch (e) {
      fail(`live-walks: could not take the runtime tree — ${String(e.message).split("\n")[0]}`);
      return [];
    }
  }
  const diffPaths = (a, b) => {
    try {
      return gitZ("diff-tree", "-r", "-z", "--name-only", a, b);
    } catch {
      return [];
    }
  };
  // The smoke walk is bound to the runtime tree whatever `since` says, so a
  // pass from before the last runtime change is never accepted.
  const since = lastTag ? git("log", "-1", "--format=%cI", lastTag) : "1970-01-01T00:00:00Z";
  const rows = evaluate({ data, required, tree, walkBlobs, version: releaseVersion, diffPaths, since, treeBound: [SMOKE_WALK] });
  for (const row of rows) if (!row.ok && !livePending) fail(`live-walks: ${row.walk} — ${row.why}`);
  return rows;
}
const walkRows = liveWalks();

for (const n of notes) console.log(`note: ${n}`);

if (failures.length) {
  console.error(`release-preflight: ${failures.length} blocker(s) for ${tag}:`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`release-preflight: ${tag} clear.`);
if (recipes.size) {
  console.log("recipes to walk in the live session:");
  for (const r of [...recipes].sort()) console.log(`  ${r}`);
} else if (lastTag && !surfaces) {
  console.log("no scripts/ surfaces changed since the last tag.");
}
if (walkRows.length) {
  const owed = walkRows.filter((r) => !r.ok);
  const listed = livePending && owed.length ? owed : walkRows;
  console.log(listed === owed ? "walks to run in the live session:" : "walks (live-walks):");
  for (const r of listed) console.log(`  ${r.walk}  ${r.why}`);
}
