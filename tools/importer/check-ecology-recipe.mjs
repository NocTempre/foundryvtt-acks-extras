/**
 * LOCAL-ONLY: the encounter recipe (`importer/ecology-recipe.mjs`) read from
 * this machine's own Monstrous Manual through the importer's own path
 * (`executeEntry` into `monsterProseChannels`), breed by breed.
 *
 * Reports, for each member of the family whose pages state a warband's
 * make-up, by its ordinal in page order, how many parts of each kind were read
 * and which expected kinds are missing. With `--census` it also reads every
 * other monster entry of the book and reports how many yield any part, so a
 * locator that reaches beyond the family shows. Output names kinds, ordinals
 * and cookbook ids and counts, never a figure or a printed name. Exits 1 on a
 * missing expected kind; skips (exit 0) without the reference books.
 *
 * Usage: node tools/importer/check-ecology-recipe.mjs [--census]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { slugLabel } from "../../scripts/importer/table-extract.mjs";
import { monsterProseChannels } from "../../scripts/importer/cookbook/monster.mjs";
import { partKind } from "../../scripts/importer/ecology-recipe.mjs";
import { overviewIsLore } from "../../scripts/importer/leader-roles.mjs";
import { data } from "../../scripts/importer/cookbook/state.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("ecology recipe: SKIPPED — local reference PDFs not on this machine.");
  process.exit(0);
}

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const registers = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", "registers.json"), "utf8"));
const cb = JSON.parse(fs.readFileSync(path.join(ROOT, "cookbook", "mm.json"), "utf8"));
const { doc } = await openBook(fs.readFileSync(FILES.mm), { book: "mm" });
const pageCache = new Map();

/** The kinds every breed of the family is expected to yield, with how many parts of each. */
const EXPECTED = { size: 3, split: 2, leader: 3, dependant: 2, guard: 1, captive: 1, caster: 2 };

const read = async (id, variant) => {
  const node = await executeEntry(doc, cb, registers, id, { pageCache, skipOps: ["art"] });
  if (!node.ok) return null;
  const { extras } = monsterProseChannels(node, id, cb.entries[id].cite, variant == null ? {} : { variant });
  return extras.encounter?.recipe ?? [];
};

// The family whose members' pages state a warband's make-up: its variants (not its lore overview), in page order.
const fam = cb.families?.["mm.familyBeastman"];
const breeds = (fam?.members ?? [])
  .filter((m) => !overviewIsLore(m, fam.members, fam.name, (id) => cb.entries[id]))
  .sort((a, b) => cb.entries[a.id].pages[0] - cb.entries[b.id].pages[0]);

let failed = false;
// A direct import of a member reads its variant from the loaded cookbooks; it must file the Role cells under the key the family import passes.
data.books.set("mm", cb);
for (const [i, m] of breeds.entries()) {
  const recipe = await read(m.id, slugLabel(m.variant));
  const direct = await read(m.id, null);
  if (JSON.stringify(direct) !== JSON.stringify(recipe)) {
    console.log(`breed ${i + 1}: a direct import files its Role cells under another key than the family's`);
    failed = true;
  }
  if (!recipe) {
    console.log(`breed ${i + 1}: page did not match the cookbook`);
    failed = true;
    continue;
  }
  const counts = {};
  for (const p of recipe) counts[partKind(p)] = (counts[partKind(p)] ?? 0) + 1;
  const morale = recipe.filter((p) => p.moraleWhileAlive != null).length;
  const full = recipe.every((p) => p.cite && p.basis === "page");
  const missing = Object.entries(EXPECTED).filter(([k, n]) => (counts[k] ?? 0) < n).map(([k]) => k);
  if (!morale) missing.push("morale");
  if (!full) missing.push("cite/basis");
  console.log(`breed ${i + 1}: ${Object.entries(counts).map(([k, n]) => `${k} ${n}`).join(", ")}; morale ${morale}${missing.length ? `   MISSING: ${missing.join(", ")}` : ""}`);
  if (missing.length) failed = true;
}

if (process.argv.includes("--census")) {
  const own = new Set((fam?.members ?? []).map((m) => m.id));
  let read_ = 0;
  let withParts = 0;
  const ids = [];
  for (const [id, entry] of Object.entries(cb.entries)) {
    if (entry.kind !== "kind.monster" || own.has(id) || id === "mm.beastman") continue;
    let recipe;
    try {
      recipe = await read(id, null);
    } catch {
      continue;
    }
    if (recipe == null) continue;
    read_++;
    if (recipe.length) {
      withParts++;
      ids.push(`${id}(${recipe.length})`);
    }
  }
  console.log(`census: ${read_} other monster entries read, ${withParts} yield a recipe${ids.length ? `: ${ids.join(" ")}` : ""}`);
}

process.exit(failed ? 1 : 0);
