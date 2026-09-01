/**
 * Cookbook staleness gate: is the committed `cookbook/` actually what the
 * current `register/` compiles to?
 *
 * The cookbook is a BUILD ARTIFACT that is also committed and shipped, so the
 * two can silently disagree: edit a register entry, forget `npm run compile`,
 * and the release carries an artifact from an older register. Nothing detected
 * that. It has already bitten once — v0.15.0 shipped a proficiencies.json whose
 * `def.prof.layingOnHands` was missing the `meta.provides` the alias-linking
 * pass sets on an alias target, so a gate written against `kw:layingonhands`
 * was not satisfied by holding Laying on Hands itself.
 *
 * The check is a recompile into a scratch dir and a byte compare. It is not a
 * determinism test — the compiler is deterministic, which is what makes an
 * inequality mean "stale" rather than "noisy".
 *
 * Requires the LOCAL reference PDFs, so it SKIPS (exit 0) wherever they are
 * absent — CI included. It is a pre-push gate for the machines that can author,
 * not a CI gate; tools/lint-register.mjs remains the PDF-free check that runs
 * everywhere.
 *
 * Usage: node tools/check-cookbook-drift.mjs   (also runs via `npm run validate`)
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { referenceComplete } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const COOKBOOK = path.join(ROOT, "cookbook");

if (!referenceComplete()) {
  console.log("cookbook drift: SKIPPED — local reference PDFs not on this machine.");
  process.exit(0);
}
if (!fs.existsSync(COOKBOOK)) {
  console.log("cookbook drift: SKIPPED — no cookbook/ to compare against.");
  process.exit(0);
}

const jsonFiles = (dir) => fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();

/** First line that differs. The fallback locator, for files that are not a
 *  map of entries (index.json, registers.json). */
function firstLineDiff(a, b) {
  const la = a.split("\n");
  const lb = b.split("\n");
  for (let i = 0; i < Math.max(la.length, lb.length); i++) {
    if (la[i] === lb[i]) continue;
    const show = (s) => (s === undefined ? "(end of file)" : JSON.stringify(s.trim().slice(0, 80)));
    return `line ${i + 1}: committed ${show(la[i])} vs compiled ${show(lb[i])}`;
  }
  return "files differ only in trailing bytes";
}

const sample = (ids) => ids.slice(0, 5).join(", ") + (ids.length > 5 ? `, …` : "");

/**
 * What moved, in the vocabulary the register is written in. A line number
 * points at whichever brace changed first — for the layingOnHands drift that
 * was a trailing comma three lines above the actual addition. An entry id
 * points at the thing a chef would go and look at.
 */
function describeDiff(a, b) {
  let ea = null;
  let eb = null;
  try {
    ea = JSON.parse(a).entries;
    eb = JSON.parse(b).entries;
  } catch {
    ea = eb = null; // not parseable as a cookbook — fall through to lines
  }
  if (ea && eb) {
    const removed = [];
    const added = [];
    const changed = [];
    for (const id of new Set([...Object.keys(ea), ...Object.keys(eb)])) {
      if (eb[id] === undefined) removed.push(id);
      else if (ea[id] === undefined) added.push(id);
      else if (JSON.stringify(ea[id]) !== JSON.stringify(eb[id])) changed.push(id);
    }
    const parts = [];
    if (changed.length) parts.push(`${changed.length} entr(ies) changed (${sample(changed)})`);
    if (added.length) parts.push(`${added.length} missing from the commit (${sample(added)})`);
    if (removed.length) parts.push(`${removed.length} no longer compiled (${sample(removed)})`);
    if (parts.length) return parts.join("; ");
    // Entries all match, so whatever moved sits outside them (book header,
    // skips) — the line locator still has something useful to say.
  }
  return firstLineDiff(a, b);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "acks-cookbook-"));
const drift = [];
// Reported after the scratch dir is cleaned up: process.exit() does not unwind,
// so nothing may exit from inside the try.
let compilerError = null;
try {
  // A scratch dir starts EMPTY, so this is a from-scratch full compile: no
  // earlier run's files to fold in, and index.json built from just what this
  // run wrote. That is the artifact a clean checkout should hold.
  try {
    execFileSync(process.execPath, [path.join(HERE, "compile-cookbook.mjs"), "--out", tmp], {
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (err) {
    compilerError = String(err.stderr ?? err.message).trim().split("\n").slice(-20).join("\n");
  }

  const committed = compilerError ? [] : jsonFiles(COOKBOOK);
  const compiled = compilerError ? [] : jsonFiles(tmp);
  for (const f of compiled) {
    if (!committed.includes(f)) drift.push(`${f}: compiles but is NOT committed`);
  }
  for (const f of committed) {
    if (!compiled.includes(f)) {
      drift.push(`${f}: committed but nothing compiles it (stale leftover?)`);
      continue;
    }
    // Byte-exact: .gitattributes pins the repo to LF, and the compiler writes
    // LF, so any inequality here is real content drift.
    const a = fs.readFileSync(path.join(COOKBOOK, f));
    const b = fs.readFileSync(path.join(tmp, f));
    if (a.equals(b)) continue;
    drift.push(`${f}: differs — ${describeDiff(a.toString("utf8"), b.toString("utf8"))}`);
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (compilerError) {
  console.error("cookbook drift: the compiler failed, so staleness could not be checked:");
  console.error(compilerError);
  process.exit(1);
}
if (drift.length) {
  console.error(`cookbook drift: ${drift.length} file(s) differ from what register/ compiles to:`);
  for (const d of drift) console.error(`  - ${d}`);
  console.error("Run `npm run compile` and commit the result.");
  process.exit(1);
}
console.log(`cookbook drift: none (${jsonFiles(COOKBOOK).length} file(s) match a fresh compile).`);
