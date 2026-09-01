/**
 * DEV-ONLY: the full parsed name list for one class's printed Proficiency List.
 *
 * `dev-proflists.mjs` says which names fail; this says what the whole list read
 * as, which is what tells a box problem (neighbouring prose swept in, entries
 * clipped) apart from a missing definition.
 *
 * IP posture as its siblings: prints book fragments, never shipped, never
 * pasted into a repo.
 *
 * Usage: node tools/dev-proflist-names.mjs <idSubstring>
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { abilitySurfaceIndex } from "../../scripts/importer/cookbook.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) { console.log("skipped: no reference PDFs."); process.exit(0); }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const only = process.argv[2] ?? "";

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
const entries = [];
for (const f of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json" && n !== "index.json")) {
  const c = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  for (const [id, e] of Object.entries(c.entries ?? {})) entries.push([id, { ...e, __cb: c }]);
}
const { byKey } = abilitySurfaceIndex(entries.map(([id, e]) => [id, e]));
const nameKey = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const splitList = (s) => String(s ?? "").split(/,(?![^(]*\))/).map((x) => x.replace(/\s+/g, " ").trim()).filter(Boolean);

for (const [id, e] of entries.filter(([id, e]) => e.kind === "kind.class" && e.fields?.profList && id.includes(only))) {
  const { doc } = await openBook(fs.readFileSync(FILES[e.book]));
  const node = await executeEntry(doc, e.__cb, registers, id).catch(() => null);
  const text = String(node?.fields?.profList ?? "").replace(/^.*?Proficiency\s*List:\s*/i, "");
  console.log(`\n=== ${id}  (box ${JSON.stringify(e.fields.profList.box)}) ===`);
  for (const n of splitList(text)) {
    const hit = byKey.get(nameKey(n.replace(/\([^)]*\)/g, "")));
    console.log(`  ${hit ? "ok  " : "MISS"} ${n.slice(0, 70)}${hit ? "  -> " + hit.ref : ""}`);
  }
}
