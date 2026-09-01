/**
 * DEV-ONLY audit: what combat training does each class actually import?
 *
 * Every class spread states three trainings — weapons, armour, fighting styles
 * — in one run-in paragraph, and `parseCombatTraining` reads all three or none.
 * "None" is silent: the class imports without the effect and nothing on the
 * sheet says a training was expected and missed, so a class that grants no
 * armour proficiency looks exactly like a class that has none.
 *
 * This prints, per class, which of the three came back and why the others did
 * not — the run-in the register declares, whether the paragraph was found at
 * all, and whether it was rejected as interleaved with a table.
 *
 * Reads the LOCAL-ONLY reference library; never CI, stdout only.
 *
 * Usage: node tools/dev-training-scan.mjs [--why] [classKey ...]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { parseCombatTraining, readTraining } from "../../scripts/importer/cookbook.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const REGISTER = path.join(HERE, "..", "..", "register");
const args = process.argv.slice(2);
const why = args.includes("--why");
const dump = args.includes("--dump");
const wanted = new Set(args.filter((a) => !a.startsWith("--")));

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
const books = fs
  .readdirSync(COOKBOOK)
  .filter((f) => f.endsWith(".json") && !["registers.json", "index.json"].includes(f))
  .map((f) => JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8")));

/** The register rows, so the declared run-in can be reported beside the result. */
const declared = new Map();
for (const dir of fs.readdirSync(REGISTER)) {
  const d = path.join(REGISTER, dir);
  if (!fs.statSync(d).isDirectory() || dir.startsWith("_")) continue;
  for (const f of fs.readdirSync(d)) {
    if (!f.endsWith(".json")) continue;
    const rows = JSON.parse(fs.readFileSync(path.join(d, f), "utf8"));
    if (!Array.isArray(rows)) continue;
    for (const r of rows) if (r?.kind === "kind.class") declared.set(r.id, r);
  }
}

const docs = {};
const classes = [];
for (const cb of books) {
  for (const [id, e] of Object.entries(cb.entries ?? {})) {
    if (e.kind !== "kind.class") continue;
    classes.push([cb, id, e]);
  }
}
classes.sort((a, b) => a[2].name.localeCompare(b[2].name));

let complete = 0;
const broken = [];
for (const [cb, id, entry] of classes) {
  const key = entry.meta?.key ?? id;
  if (wanted.size && !wanted.has(key) && !wanted.has(entry.name)) continue;
  const book = entry.book;
  if (!docs[book]) {
    if (!FILES[book] || !fs.existsSync(FILES[book])) { console.log(`SKIP ${entry.name}: no ${book} in the library`); continue; }
    docs[book] = (await openBook(fs.readFileSync(FILES[book]))).doc;
  }
  const reg = declared.get(id);
  const runin = reg?.class?.training?.runin ?? null;
  const node = await executeEntry(docs[book], cb, registers, id).catch(() => null);
  // Mirror bindClass exactly: each page-COLUMN on its own, then the joined page.
  const bodyParts = Object.entries(node?.fields ?? {})
    .filter(([k, v]) => /^body\d+(?:c\d+)?$/.test(k) && typeof v === "string")
    .map(([, v]) => v);
  const body = bodyParts.join(" ");
  const t = runin ? readTraining(bodyParts, runin) : null;
  if (dump) {
    const text = String(body).replace(/\s+/g, " ");
    const labels = [...text.matchAll(/[A-Z][A-Za-z' ]{2,30}:/g)].map((m) => m[0]);
    console.log(`
### ${entry.name} [${book}]  body ${text.length} chars`);
    console.log(`  run-in labels on the spread: ${JSON.stringify([...new Set(labels)].slice(0, 24))}`);
    // The slice the parser actually sees, per column part, from the declared run-in.
    for (const [n, part] of (bodyParts ?? []).entries()) {
      const t2 = String(part).replace(/\s+/g, " ");
      const loose = String(runin ?? "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
      const at = loose ? t2.search(new RegExp(loose, "i")) : -1;
      if (at < 0) continue;
      console.log(`  part ${n}: ${JSON.stringify(t2.slice(at, at + 300))}`);
    }
  }
  const have = t ? ["weapons", "armour", "styles"].filter((k) => (Array.isArray(t[k]) ? t[k].length : t[k])) : [];
  const missing = ["weapons", "armour", "styles"].filter((k) => !have.includes(k));
  if (!missing.length) { complete++; continue; }

  // Why: the three states that produce nothing, distinguished.
  let reason;
  if (!runin) reason = "no training run-in declared in the register";
  else if (!body) reason = "no body text extracted for the spread";
  else {
    const text = String(body).replace(/\s+/g, " ");
    const loose = runin.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s*");
    if (text.search(new RegExp(loose, "i")) < 0) reason = `run-in ${JSON.stringify(runin)} not found in the body`;
    else if (!t) reason = `paragraph found in ${bodyParts.length} column-part(s) but every one rejected (a digit in it — the level table is interleaved)`;
    else reason = `parsed, but ${missing.join("+")} came back empty`;
  }
  broken.push({ name: entry.name, book, key, runin, missing, reason });
}

console.log(`\n${complete} class(es) import all three trainings; ${broken.length} do not:\n`);
for (const b of broken) {
  console.log(`  ${b.name} [${b.book}] — missing ${b.missing.join(", ")}`);
  if (why) console.log(`      run-in: ${JSON.stringify(b.runin)}\n      reason: ${b.reason}`);
}
process.exit(broken.length ? 1 : 0);
