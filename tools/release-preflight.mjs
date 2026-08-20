/**
 * Release preflight gate. Run before tagging; `/acks-release` step 1 invokes
 * it and a red result stops the release.
 *
 * Checks, in order:
 *   1. The tag (v<module.json version>, or --tag) does not already exist,
 *      locally or on origin. A published tag is never reused — a version that
 *      needs fixing gets a new patch number, not a retag.
 *   2. Every feature surface changed since the last v* tag has a live-test
 *      recipe: `scripts/<feature>/**` maps to `docs/<feature>/TESTING.md`,
 *      and files directly under `scripts/` map to `docs/TESTING.md`. The
 *      release report walks these recipes in the live session; a surface
 *      with no recipe has no defined pass condition, which is how a release
 *      ships hotfix bait. Changed means changed in the WORKING TREE relative
 *      to the last tag — committed or not, tracked or not: a release is
 *      normally prepared uncommitted, and a gate that reads only commits
 *      waives itself for exactly the run it exists to check.
 *
 * Exit 0 prints the recipes to walk; exit 1 lists every failure. A repo with
 * no v* tag yet (first release) skips check 2.
 *
 * Usage: node tools/release-preflight.mjs [--tag vX.Y.Z]
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.dirname(path.dirname(url.fileURLToPath(import.meta.url)));
const git = (...a) => execFileSync("git", ["-C", ROOT, ...a], { encoding: "utf8" }).trim();

const args = process.argv.slice(2);
const tagArg = args.includes("--tag") ? args[args.indexOf("--tag") + 1] : null;

const failures = [];
const fail = (msg) => failures.push(msg);

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

if (failures.length) {
  console.error(`release-preflight: ${failures.length} blocker(s) for ${tag}:`);
  for (const f of failures) console.error(`  FAIL ${f}`);
  process.exit(1);
}
console.log(`release-preflight: ${tag} clear.`);
if (recipes.size) {
  console.log("recipes to walk in the live session:");
  for (const r of [...recipes].sort()) console.log(`  ${r}`);
} else if (lastTag) {
  console.log("no scripts/ surfaces changed since the last tag.");
}
