#!/usr/bin/env node
/**
 * Make a CLONE runnable — the source-install path, with no release zip.
 *
 * A clone is not a module. The compiled LevelDB compendiums are build output
 * and are gitignored (`.gitignore` says why), so a fresh clone has every
 * compendium declared and every one of them empty — which presents as a working
 * install that has simply lost its content. This script is the one command that
 * closes that gap, and it CHECKS rather than assumes: it verifies every path
 * `module.json` declares actually exists on disk before it reports success.
 *
 * The trap it exists to catch first, though, is the directory name. Foundry
 * resolves a module by the name of its folder under `Data/modules`, so a clone
 * of `foundryvtt-acks-extras` — the repository's name, which is NOT the module
 * id — never loads, with no error anywhere: the module simply is not in the
 * list. That is checked before anything is built, because building first and
 * failing to load afterwards is how the afternoon goes.
 *
 * Usage, from inside the clone:
 *
 *   node tools/rebuild.mjs            install dependencies, build packs, verify
 *   node tools/rebuild.mjs --prune    then delete node_modules — the runtime
 *                                     needs none of it, and it is the largest
 *                                     thing in the folder by an order of magnitude
 *   node tools/rebuild.mjs --check    verify only; build nothing, install nothing
 *
 * `--prune` leaves a folder Foundry can load and `git pull` can update; rerun
 * this script after a pull that touches `packs/_source` or `tools/pack-data`.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import url from "node:url";

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const CHECK_ONLY = args.has("--check");
const PRUNE = args.has("--prune");

const problems = [];
const warnings = [];
const notes = [];
const say = (s = "") => console.log(s);
const fail = (what, fix) => problems.push({ what, fix });
const warn = (what, fix) => warnings.push({ what, fix });

/* -------------------------------------------- */
/*  1. The folder name, before anything else     */
/* -------------------------------------------- */

const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8"));
const dirName = path.basename(ROOT);
const parentName = path.basename(path.dirname(ROOT));
const inModulesDir = parentName.toLowerCase() === "modules";

say(`rebuild: ${manifest.title} ${manifest.version} (id "${manifest.id}")`);
say(`  folder: ${ROOT}`);

// Only a folder sitting DIRECTLY under Data/modules has to carry the id: that
// name is what Foundry resolves. A checkout anywhere else is linked in by a
// junction or symlink that supplies the name, which is the normal development
// arrangement and not a fault — so it is said once, not failed on.
if (inModulesDir && dirName !== manifest.id) {
  fail(
    `this folder is directly under "modules" and is named "${dirName}" — Foundry resolves a module by its id, "${manifest.id}", so it will not appear in the module list at all`,
    `rename the folder to "${manifest.id}" (clone with "git clone <url> ${manifest.id}")`,
  );
} else if (inModulesDir) {
  notes.push("installed under Data/modules with the right folder name");
} else if (dirName !== manifest.id) {
  notes.push(`a checkout outside Data/modules — link it in under the name "${manifest.id}", never the repository's own name`);
} else {
  notes.push(`a checkout outside Data/modules — link or copy it into Data/modules/${manifest.id}`);
}

const major = Number(process.versions.node.split(".")[0]);
const wanted = Number(String(manifest.engines?.node ?? "").replace(/\D/g, "")) || 20;
if (major < wanted) fail(`Node ${process.versions.node} is older than the required >=${wanted}`, `install Node ${wanted} or newer`);

/* -------------------------------------------- */
/*  2. Build                                     */
/* -------------------------------------------- */

const run = (cmd, cmdArgs) => {
  say(`  $ ${cmd} ${cmdArgs.join(" ")}`);
  execFileSync(cmd, cmdArgs, { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
};

if (!CHECK_ONLY && !problems.length) {
  const hasLock = fs.existsSync(path.join(ROOT, "package-lock.json"));
  const haveModules = fs.existsSync(path.join(ROOT, "node_modules", "@foundryvtt", "foundryvtt-cli"));
  say("\nbuilding:");
  if (!haveModules) {
    // `ci` when there is a lockfile: the pack compiler is a native build
    // (classic-level), and a resolved-fresh tree is how it stops matching the
    // Node it will run under.
    try {
      run("npm", hasLock ? ["ci"] : ["install"]);
    } catch {
      // `npm ci` refuses a lockfile out of step with package.json; a plain
      // install is the recovery, not a reason to stop.
      run("npm", ["install"]);
    }
  } else {
    say("  dependencies already present — skipping install");
  }
  run("npm", ["run", "build:packs"]);
}

/* -------------------------------------------- */
/*  3. Verify what the manifest promises          */
/* -------------------------------------------- */

say("\nverifying every path module.json declares:");

const check = (rel, label) => {
  const full = path.join(ROOT, rel);
  if (fs.existsSync(full)) return true;
  fail(`${label} is missing: ${rel}`, "rerun this script without --check");
  return false;
};

for (const rel of manifest.esmodules ?? []) check(rel, "an entry script");
for (const rel of manifest.styles ?? []) check(rel, "a stylesheet");
for (const lang of manifest.languages ?? []) check(lang.path, `the ${lang.lang} translation`);

let packsOk = 0;
for (const pack of manifest.packs ?? []) {
  if (!check(pack.path, `the "${pack.name}" compendium`)) continue;
  // A compiled LevelDB pack is a DIRECTORY holding data files. An empty one is
  // the exact shape a clone has before this script runs, and it loads happily
  // with nothing inside — so emptiness is the thing worth reporting.
  const entries = fs.readdirSync(path.join(ROOT, pack.path));
  if (!entries.some((f) => /\.(ldb|log|sst)$/i.test(f) || f === "CURRENT")) {
    fail(`the "${pack.name}" compendium is an empty directory — it would load with no documents`, "rerun this script without --check");
  } else packsOk++;
}

// A live install carrying its build dependencies is not broken, just heavy —
// node_modules dwarfs everything Foundry actually reads here.
if (inModulesDir && !PRUNE && fs.existsSync(path.join(ROOT, "node_modules"))) {
  warn("node_modules is sitting inside a live module folder", "rerun with --prune to remove it; the runtime reads none of it");
}

if (PRUNE && !CHECK_ONLY && !problems.length) {
  say("\npruning: removing node_modules (the runtime needs none of it)");
  fs.rmSync(path.join(ROOT, "node_modules"), { recursive: true, force: true });
  notes.push("node_modules removed — rerun this script after a pull that changes packs/_source or tools/pack-data");
}

/* -------------------------------------------- */
/*  4. Report                                    */
/* -------------------------------------------- */

say("");
for (const n of notes) say(`  note: ${n}`);
for (const w of warnings) {
  say(`  WARN ${w.what}`);
  say(`       ${w.fix}`);
}
if (problems.length) {
  say(`\nrebuild: ${problems.length} problem(s) — this clone will not load as it stands.\n`);
  for (const p of problems) {
    say(`  FAIL ${p.what}`);
    say(`       fix: ${p.fix}`);
  }
  process.exit(1);
}
say(`\nrebuild: ready — ${packsOk} compendium(s) compiled, every declared path present.`);
say(`  Launch Foundry, enable "${manifest.title}", and the compendiums carry their documents.`);
