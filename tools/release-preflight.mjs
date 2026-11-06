/**
 * Release preflight gate. Run before tagging; `/acks-release` invokes it and
 * a red result stops the release.
 *
 * Checks, in order:
 *   1. The release kind is declared with --kind: major, minor or hotfix. The
 *      kind is never read off the version number, so a run without one is
 *      refused rather than guessed.
 *   2. The tag (v<module.json version>, or --tag) does not already exist,
 *      locally or on origin. A published tag is never reused — a version that
 *      needs fixing gets a new patch number, not a retag.
 *   3. Every feature surface changed since the last v* tag has a live-test
 *      recipe: `scripts/<feature>/**` maps to `docs/<feature>/TESTING.md`,
 *      and files directly under `scripts/` map to `docs/TESTING.md`. The
 *      release report walks these recipes in the live session; a surface
 *      with no recipe has no defined pass condition, which is how a release
 *      ships hotfix bait. Changed means changed in the WORKING TREE relative
 *      to the last tag — committed or not, tracked or not: a release is
 *      normally prepared uncommitted, and a gate that reads only commits
 *      waives itself for exactly the run it exists to check.
 *   4. On a major or a minor, every top-level bullet under `### Added` or
 *      `### Changed` in the version's CHANGELOG.md section accounts for its
 *      release snapshot (TOOLCHAIN §4b). `<!-- shot: <feature-slug> -->` names
 *      `docs/releases/v<version>/<feature-slug>.png`, one marker per shot;
 *      `<!-- no-shot: <reason> -->` declares an entry with no user-visible
 *      surface. A marker may sit anywhere in the bullet, continuation lines
 *      included, and as an HTML comment it shows neither in the rendered
 *      changelog nor on the release page built from the section. An Added or
 *      Changed bullet with neither marker fails, as does a no-shot with no
 *      reason and a major or minor with no section for its version. A bullet
 *      under any other heading owes no marker, but a shot it names is held
 *      to the same file check, which is how a fix-driven minor's visible
 *      Fixed entry carries its shot. A named shot must exist with
 *      that exact letter case, which a Windows file check alone does not
 *      test. --shots-pending lists a missing one as still to take instead:
 *      on the run made before the live session that takes the shots, and on
 *      a machine with no test server, where no session takes them and the
 *      release report names each one. A hotfix owes no shot and skips the
 *      check.
 *
 * Exit 0 prints the recipes to walk and the shots the entries name; exit 1
 * lists every failure. A repo with no v* tag yet (first release) skips
 * check 3.
 *
 * Usage: node tools/release-preflight.mjs --kind major|minor|hotfix [--tag vX.Y.Z] [--shots-pending]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();

const args = process.argv.slice(2);
const tagArg = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;
const kind = args.includes("--kind") ? args[args.indexOf("--kind") + 1] : null;
const shotsPending = args.includes("--shots-pending");

const failures = [];
const fail = (msg) => failures.push(msg);

if (!["major", "minor", "hotfix"].includes(kind)) {
  fail(kind ? `--kind ${kind} is not a release kind — major, minor or hotfix` : "no release kind — pass --kind major|minor|hotfix; the kind is declared, never read off the version (TOOLCHAIN §4)");
}

const moduleJson = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8").replace(/^﻿/u, ""));
const tag = tagArg ?? `v${moduleJson.version}`;
if (tagArg && tagArg !== `v${moduleJson.version}`) {
  fail(`tag ${tagArg} does not match module.json version ${moduleJson.version}`);
}

if (git("tag", "-l", tag)) {
  fail(`tag ${tag} already exists locally — never retag; bump to a new patch version`);
}
try {
  if (execFileSync("git", ["-C", ROOT, "ls-remote", "--tags", "origin", tag], { encoding: "utf8" }).trim()) {
    fail(`tag ${tag} already exists on origin — never retag; bump to a new patch version`);
  }
} catch {
  console.log("note: could not reach origin to check remote tags — verify manually");
}

let lastTag = "";
try {
  lastTag = git("describe", "--tags", "--abbrev=0", "--match", "v*", "HEAD");
} catch {
  console.log("note: no previous v* tag — first release, recipe check skipped");
}

const recipes = new Set();
if (lastTag) {
  // Two-argument diff (tag vs working tree), never `tag..HEAD`: HEAD misses
  // everything staged or unstaged. Untracked files are changes too — a
  // brand-new feature directory is invisible to diff until it is added.
  const changed = git("diff", "--name-only", lastTag).split("\n").filter(Boolean);
  const untracked = git("ls-files", "--others", "--exclude-standard", "--", "scripts").split("\n").filter(Boolean);
  const slugs = new Set();
  let flatChanged = false;
  for (const file of [...changed, ...untracked]) {
    const m = file.match(/^scripts\/([^/]+)\/(.+)/u);
    if (m) slugs.add(m[1]);
    else if (/^scripts\/[^/]+$/u.test(file)) flatChanged = true;
  }
  for (const slug of [...slugs].sort()) {
    const recipe = path.join("docs", slug, "TESTING.md");
    if (fs.existsSync(path.join(ROOT, recipe))) recipes.add(recipe);
    else fail(`scripts/${slug}/ changed since ${lastTag} but ${recipe} does not exist — write the surface's live-test recipe first`);
  }
  if (flatChanged) {
    const recipe = path.join("docs", "TESTING.md");
    if (fs.existsSync(path.join(ROOT, recipe))) recipes.add(recipe);
    else fail(`scripts/ changed since ${lastTag} but ${recipe} does not exist — write the repo's live-test recipe first`);
  }
}

/**
 * The top-level bullets in a changelog's section for `version`, or null where
 * it has no such section. Each entry gives its 1-based line, a label cut from
 * its first line, whether it sits under `### Added` or `### Changed` (`owed`),
 * and every value its `shot:` and `no-shot:` markers carry. A bullet runs to
 * the next top-level bullet or heading, so nested items and continuation
 * lines are its own. The heading test is the release workflow's, so the
 * section read here is the one the release page is built from.
 */
function shotEntries(text, version) {
  const lines = text.replace(/^﻿/u, "").split(/\r?\n/u);
  const esc = version.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const heading = new RegExp(`^##\\s+(?:Release\\s+)?\\[?v?${esc}\\]?(?:\\s|$)`, "u");
  const start = lines.findIndex((l) => heading.test(l));
  if (start < 0) return null;
  const entries = [];
  let owed = false;
  let entry = null;
  for (let i = start + 1; i < lines.length && !/^##\s/u.test(lines[i]); i++) {
    const line = lines[i];
    const sub = line.match(/^###\s+(.*?)\s*$/u);
    if (sub || /^#{1,6}\s/u.test(line)) {
      entry = null;
      if (sub) owed = /^(added|changed)$/iu.test(sub[1]);
      continue;
    }
    if (/^[-*+]\s/u.test(line)) {
      const label = line.replace(/<!--[\s\S]*?(-->|$)/gu, "").replace(/^[-*+]\s+/u, "").replaceAll("**", "").trim();
      entry = { line: i + 1, label: label.length > 72 ? `${label.slice(0, 71)}…` : label, owed, text: [] };
      entries.push(entry);
    }
    entry?.text.push(line);
  }
  for (const e of entries) {
    const body = e.text.join("\n");
    e.shots = [...body.matchAll(/<!--\s*shot:\s*([\s\S]*?)\s*-->/giu)].map((m) => m[1]);
    e.noShot = [...body.matchAll(/<!--\s*no-shot:\s*([\s\S]*?)\s*-->/giu)].map((m) => m[1].replace(/\s+/gu, " "));
    delete e.text;
  }
  return entries;
}

const shots = [];
const unshot = [];
if (kind === "major" || kind === "minor") {
  const version = moduleJson.version;
  const shotDir = `docs/releases/v${version}`;
  // Listed rather than probed, so a slug that differs from its file only in
  // letter case fails here as it fails on a case-sensitive checkout.
  const taken = fs.existsSync(path.join(ROOT, shotDir)) ? fs.readdirSync(path.join(ROOT, shotDir)) : [];
  const changelog = path.join(ROOT, "CHANGELOG.md");
  const hasLog = fs.existsSync(changelog);
  const entries = hasLog ? shotEntries(fs.readFileSync(changelog, "utf8"), version) : null;
  if (!entries) {
    fail(`${hasLog ? "CHANGELOG.md has" : "there is no CHANGELOG.md, so"} no section for ${version} — a ${kind} owes a shot per user-visible Added/Changed entry and the section is what maps them (TOOLCHAIN §4b)`);
  }
  for (const e of entries ?? []) {
    const where = `CHANGELOG.md:${e.line} "${e.label}"`;
    if (e.owed && !e.shots.length && !e.noShot.length) {
      fail(`${where} names no shot — add <!-- shot: <feature-slug> --> for ${shotDir}/<feature-slug>.png, or <!-- no-shot: <reason> --> where the entry has no user-visible surface (TOOLCHAIN §4b)`);
    }
    for (const reason of e.noShot) {
      if (reason) unshot.push({ where, reason });
      else fail(`${where} has a no-shot marker with no reason — say why the entry has no user-visible surface`);
    }
    for (const value of e.shots) {
      const slug = value.replace(/\.png$/iu, "");
      if (!/^[a-z0-9][a-z0-9._-]*$/iu.test(slug)) {
        fail(`${where} has a shot marker naming "${value}" — one feature slug per marker, the file name under ${shotDir}/ without .png`);
        continue;
      }
      const file = `${shotDir}/${slug}.png`;
      const exists = taken.includes(`${slug}.png`);
      if (!exists && !shotsPending) fail(`${where} names ${file}, which does not exist — take the shot in the live session (TOOLCHAIN §4b); --shots-pending lists it instead, before that session or where this machine has no test server (§4a)`);
      shots.push({ file, where, exists });
    }
  }
}

if (failures.length) {
  console.error(`release-preflight: ${failures.length} blocker(s) for ${tag}:`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`release-preflight: ${tag} clear (${kind}).`);
if (recipes.size) {
  console.log("recipes to walk in the live session:");
  for (const r of [...recipes].sort()) console.log(`  ${r}`);
} else if (lastTag) {
  console.log("no scripts/ surfaces changed since the last tag.");
}
if (shots.length) {
  console.log("shots the changelog names:");
  for (const s of shots) console.log(`  ${s.exists ? "taken  " : "to take"} ${s.file} ← ${s.where}`);
}
if (unshot.length) {
  console.log("entries with no shot:");
  for (const u of unshot) console.log(`  ${u.where}: ${u.reason}`);
}
