/**
 * IP leak scan — the family-wide gate that stands between licensed book
 * material and a public release. Synced from acks-module-template; do not
 * hand-edit. Runs from tools/validate.mjs (so it gates every `npm run
 * validate`, and therefore every release) and again in CI against the
 * *unpacked module.zip*, so the thing actually being published is what gets
 * checked — not just the working tree.
 *
 * Usage:
 *   node tools/ip-scan.mjs [dir]     scan dir (default: repo root)
 *   node tools/ip-scan.mjs --strict  treat prose warnings as failures too
 *
 * Design note: this file deliberately contains NO book text. It cannot match
 * "known passages" — storing them here would itself be the leak. It works on
 * structural signals instead: files that are supposed to be local-only,
 * pipeline artifacts that are supposed to stay untracked, and attribution
 * boilerplate showing up inside data files (where authored content lives).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const CLI = import.meta.url === pathToFileURL(process.argv[1] ?? "").href;
const ROOT = path.resolve(process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) ?? ".");
const STRICT = process.argv.includes("--strict");

/* Canonical rules extracts are LOCAL-ONLY (C:\Proj\acks-rules\<module-id>\).
 * They were purged from every repo history 2026-07-16 and must never return. */
const FORBIDDEN_FILES = [/^RULES\.md$/iu, /^PROFICIENCIES\.md$/iu, /Reactions-Reference\.md$/iu];
/* Extraction-pipeline state: holds raw fragments lifted from the user's PDFs.
 * `ruledata/` earns its place here the hard way: acks-henchmen shipped its book
 * tables as ruledata/*.json publicly, in every release zip since v0.1.0, until
 * the 2026-07-19 audit. Nothing loads it any more, no repo tracks it, and the
 * doctrine is that no book-read value ships in any repo — so a tracked
 * ruledata/ is a mistake, not a judgement call. Note the value signals there
 * were table rows and name lists, all individually short: no prose-length rule
 * would ever have caught them, which is why this is a path ban. */
const FORBIDDEN_PATHS = [/(^|[/\\])_proposals([/\\]|$)/u, /(^|[/\\])_manifest([/\\]|$)/u, /(^|[/\\])_ledger\.json$/u, /(^|[/\\])acks-rules([/\\]|$)/u, /(^|[/\\])ruledata([/\\]|$)/u];
/* Publisher attribution has no business inside machine data — in a pack source
 * or cookbook it means text was copied in wholesale rather than authored. */
const ATTRIBUTION = /all rights reserved|adventurer conqueror king|autarch/iu;
const DATA_GLOBS = [/packs[/\\]_source[/\\].*\.json$/u, /^cookbook[/\\].*\.json$/u, /^register[/\\].*\.json$/u, /^lang[/\\].*\.json$/u];
/* Source is not JSON-walkable, but book text hides in it just as well: a
 * private sibling module keeps ~1,400 words of another publisher's rules in
 * scripts/rules-data.mjs. Scanned as raw text for the same two signals.
 *
 * scripts/ AND tools/ — tools/ never ships, but it is tracked and public, and
 * generated packs/_source only covers pack-data's OUTPUT: a block of book
 * prose in a tools comment reaches GitHub without ever reaching a pack. Only
 * this file itself is excluded (it must name the ATTRIBUTION signal to scan
 * for it). vendor/ is excluded for the opposite reason: third-party bundles
 * carry their own licence headers, and a gate that flags those on every run
 * is a gate people mute. docs/ (also tracked and public) stays out because it
 * is legitimate prose — the PROSE_CHARS signal would fire on every guide; its
 * IP bar is the human one TOOLCHAIN §4b sets for guides. */
const CODE_GLOBS = [/^scripts[/\\].*\.mjs$/u, /^tools[/\\].*\.mjs$/u];
const CODE_SELF_EXCLUDE = /^tools[/\\]ip-scan\.mjs$/u;
/* Quoted and templated literals, so a long one can be measured without parsing. */
const STRING_LITERAL = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/gu;
/* A string leaf this long in a data file is a paragraph, not a label. */
const PROSE_CHARS = 1500;
/* ...unless it is source code. Macro bodies are authored JS and legitimately
 * long; letting them warn every run is how a gate gets tuned out. */
const CODE_KEYS = new Set(["command"]);

const SKIP_DIRS = new Set(["node_modules", ".git", ".github", "dist"]);
const errors = [];
const warnings = [];

/**
 * Two scan modes, and the difference is the whole point:
 *
 *  - A git work tree is scanned via `git ls-files` — TRACKED files only. An
 *    ignored, untracked file is not in the repo and never reaches the remote;
 *    the extraction pipeline relies on exactly that to keep raw PDF fragments
 *    on the local disk. Flagging those would be crying wolf. Force-add one,
 *    though, and it becomes tracked — and this catches it.
 *  - Anything else (notably the unpacked module.zip) is walked in full: if it
 *    is in the artifact, it ships, and nothing gets a pass.
 */
function trackedFiles(dir) {
  try {
    const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return out.split("\0").filter(Boolean);
  } catch {
    return null; // not a git work tree — fall back to walking everything
  }
}

function walk(dir, rel = "") {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    const relPath = rel ? path.join(rel, entry.name) : entry.name;
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      if (FORBIDDEN_PATHS.some((re) => re.test(relPath))) {
        errors.push(`${relPath}/ — extraction-pipeline state must never ship or be committed`);
        continue;
      }
      walk(abs, relPath);
    } else {
      inspect(abs, relPath);
    }
  }
}

function inspect(abs, relPath) {
  if (FORBIDDEN_FILES.some((re) => re.test(path.basename(relPath)))) {
    errors.push(`${relPath} — LOCAL-ONLY rules extract; it belongs in C:\\Proj\\acks-rules\\, never in the repo`);
    return;
  }
  if (FORBIDDEN_PATHS.some((re) => re.test(relPath))) {
    errors.push(`${relPath} — extraction-pipeline state must never ship or be committed`);
    return;
  }
  if (CODE_GLOBS.some((re) => re.test(relPath)) && !CODE_SELF_EXCLUDE.test(relPath)) {
    if (!fs.existsSync(abs)) return; // tracked but deleted in the work tree
    scanSource(fs.readFileSync(abs, "utf8"), relPath);
    return;
  }
  if (!DATA_GLOBS.some((re) => re.test(relPath))) return;
  if (!fs.existsSync(abs)) return; // tracked but deleted in the work tree

  let data;
  try {
    data = JSON.parse(fs.readFileSync(abs, "utf8"));
  } catch {
    return; // tools/validate.mjs already reports malformed JSON
  }
  scanStrings(data, relPath);
}

function scanSource(text, relPath) {
  if (ATTRIBUTION.test(text)) {
    errors.push(`${relPath} — publisher attribution in source; book text belongs in the reader's own PDF, not in a .mjs`);
  }
  for (const [lit] of text.matchAll(STRING_LITERAL)) {
    if (lit.length > PROSE_CHARS) {
      warnings.push(`${relPath}: a ${lit.length}-char string literal — verify this is authored, not transcribed`);
    }
  }
}

function scanStrings(node, relPath, keyPath = "") {
  if (typeof node === "string") {
    if (ATTRIBUTION.test(node)) {
      errors.push(`${relPath}: ${keyPath || "(root)"} contains publisher attribution — copied book text, not authored data`);
    } else if (node.length > PROSE_CHARS && !CODE_KEYS.has(keyPath)) {
      warnings.push(`${relPath}: ${keyPath || "(root)"} is ${node.length} chars — verify this is authored, not transcribed`);
    }
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((v, i) => scanStrings(v, relPath, `${keyPath}[${i}]`));
  } else if (node && typeof node === "object") {
    for (const [k, v] of Object.entries(node)) scanStrings(v, relPath, keyPath ? `${keyPath}.${k}` : k);
  }
}

/**
 * Scan an explicit list of repo-relative paths. tools/ip-quarantine.mjs uses
 * this against the *staged* set so a leak is caught before it enters a commit,
 * which is the only moment a .gitignore can still keep it out of history.
 */
export function scanPaths(root, relPaths) {
  errors.length = 0;
  warnings.length = 0;
  for (const relPath of relPaths) inspect(path.join(root, relPath), relPath);
  return { errors: [...errors], warnings: [...warnings] };
}

/*
 * Exit codes are a contract the release workflow depends on:
 *   0 — clean
 *   1 — a leak was found (a content verdict; CI quarantines the repo)
 *   2 — the scanner itself crashed (a tooling verdict; CI fails loud but must
 *       NOT quarantine — a Node quirk or missing file is not grounds to take a
 *       public repo private). Never let a crash masquerade as exit 1.
 */
if (CLI) {
  try {
    const tracked = trackedFiles(ROOT);
    if (tracked) {
      for (const relPath of tracked) inspect(path.join(ROOT, relPath), relPath);
    } else {
      walk(ROOT);
    }
  } catch (err) {
    console.error(`::error::ip-scan: tooling error, not a leak verdict — ${err?.stack || err}`);
    process.exit(2);
  }

  for (const w of warnings) console.warn(`  warn  ${w}`);
  for (const e of errors) console.error(`  LEAK  ${e}`);

  if (errors.length || (STRICT && warnings.length)) {
    console.error(`\nip-scan: FAILED — ${errors.length} leak(s), ${warnings.length} warning(s) in ${ROOT}`);
    process.exit(1);
  }
  console.log(`ip-scan: clean (${warnings.length} warning(s))`);
}
