/**
 * DEV-ONLY: what every class's printed Proficiency List actually extracts to,
 * and which of its names resolve.
 *
 * The authoring loop for `profList` boxes. A list that sweeps in the
 * Proficiency Progression paragraph printed beside it produces names welded out
 * of prose ("paladins select one class" + "Berserkergang"), and the only way to
 * see it is to run the compiled box against the book and tokenize the result.
 *
 * IP posture as its siblings: a diagnostic for the authoring agent. It prints
 * book fragments and is never shipped, never pasted into a repo.
 *
 * Usage: node tools/dev-proflists.mjs [idSubstring]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { abilitySurfaceIndex } from "../../scripts/importer/cookbook.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("dev-proflists: reference PDFs absent — skipped.");
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const only = process.argv[2] ?? "";

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
const entries = [];
for (const f of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json" && n !== "index.json")) {
  const c = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  for (const [id, e] of Object.entries(c.entries ?? {})) entries.push([id, { ...e, __cb: c }]);
}

// The surface index the binder uses, so "resolves" here means what it means there.
const { byKey } = abilitySurfaceIndex(entries.map(([id, e]) => [id, e]));
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const splitList = (s) =>
  String(s ?? "")
    .split(/,(?![^(]*\))/)
    .map((x) => x.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const classes = entries.filter(([id, e]) => e.kind === "kind.class" && e.fields?.profList && id.includes(only));
const books = new Map();
let totalUnresolved = 0;
const dirty = [];

for (const [id, e] of classes) {
  const book = e.book;
  if (!books.has(book)) {
    if (!FILES[book]) continue;
    books.set(book, (await openBook(fs.readFileSync(FILES[book]))).doc);
  }
  const node = await executeEntry(books.get(book), e.__cb, registers, id).catch(() => null);
  const text = String(node?.fields?.profList ?? "").replace(/^.*?Proficiency\s*List:\s*/i, "");
  const names = splitList(text);
  const unresolved = names.filter((n) => !byKey.get(nameKey(n.replace(/\([^)]*\)/g, ""))));
  totalUnresolved += unresolved.length;
  if (unresolved.length) dirty.push([id, unresolved]);
  const flag = unresolved.length ? "DIRTY" : "clean";
  console.log(`${flag.padEnd(6)} ${id.padEnd(32)} ${String(names.length).padStart(2)} name(s), ${unresolved.length} unresolved`);
  for (const u of unresolved) console.log(`         ! ${u.slice(0, 90)}`);
}

console.log(`\n${classes.length} class list(s); ${dirty.length} dirty; ${totalUnresolved} unresolved name(s).`);
