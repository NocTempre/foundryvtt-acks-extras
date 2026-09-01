/**
 * DEV-ONLY audit: which printed class-power labels does each class NOT award?
 *
 * A class spread prints its powers as run-in labels ("Expert Caving:",
 * "Renown (9th):"). Each one that the register does not name in `awards`
 * imports as nothing at all, and the omission is silent — a class missing a
 * power looks exactly like a class that has none. This lists, per class, every
 * run-in label on its own pages that no award ref accounts for.
 *
 * Structural labels (the proficiency list, the training paragraph, the
 * progression note) are expected misses and are filtered by name, as are the
 * printed labels that name something a reader PICKS or ROLLS rather than
 * something a class is granted — see `OPTIONS`. A clean run is therefore zero
 * gaps, which is what makes this runnable as a gate after a class is authored.
 *
 * IP posture as its siblings: prints labels and coordinates, never passages;
 * reads the LOCAL-ONLY reference library, never CI, stdout only.
 *
 * Usage: node tools/dev-award-scan.mjs [classKeySubstring]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { FILES, referenceComplete } from "./reference-lib.mjs";

if (!referenceComplete()) {
  console.log("dev-award-scan: reference PDFs absent — skipped.");
  process.exit(0);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");
const only = process.argv[2] ?? "";

const entries = new Map();
for (const f of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json" && n !== "index.json")) {
  const c = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  for (const [id, e] of Object.entries(c.entries ?? {})) entries.set(id, e);
}
const source = JSON.parse(fs.readFileSync(path.join(HERE, "..", "..", "register", "_refs", "powerSource.json"), "utf8"));

// A printed label is "accounted for" when some award ref's own name, or a
// printed-name alias the source matrix records for that ref, matches it.
const key = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
const aliasesByRef = new Map();
for (const rows of Object.values(source.table)) {
  for (const r of rows) {
    if (!aliasesByRef.has(r.ref)) aliasesByRef.set(r.ref, new Set());
    aliasesByRef.get(r.ref).add(key(r.name));
  }
}

// Labels that introduce structure rather than name a power.
const STRUCTURAL = new Set(
  [
    "Proficiency List", "Proficiency Progression", "Armor and Weapon Proficiencies",
    "Weapon and Armor Proficiencies", "Armor and Weapons", "Class Proficiencies",
    "Combat Proficiencies", "Combat Progression", "Combat Training",
    "Requirements", "Prime Requisite", "Prime Requisites", "Key Attribute", "Key Attributes",
    "Hit Dice", "Maximum Level", "Experience", "Special", "Note", "Notes", "Example",
    "Designer’s Note", "Designer's Note",
  ].map(key),
);
/**
 * "<Class> Proficiency List:" — the same structural label, printed long. Tested
 * folded, because the runs it is made of often carry no space between them.
 */
const isProfListLabel = (s) => key(s).endsWith("proficiencylist");

/**
 * Printed labels that name an OPTION, not a grant: the branches of a pick the
 * class register carries as a `choice`, the entries of a table the reader rolls
 * on, and the proficiency descriptions a class chapter prints for the
 * proficiencies its list offers. None of them is an award, and each would
 * otherwise report as a gap forever.
 */
const OPTIONS = {
  dwarvenEarthforger: ["Sigil of Creation", "Sigil Invocation", "Invocation"],
  dwarvenRhetor: ["Anaphora", "Derision", "Epizeuxis", "Innuendo", "Pleonasm", "Procatalepsis"],
  dwarvenSporecaster: [
    "Fungal Communion", "Kiss of Life", "Mushroom Overlord", "Rotless Rot",
    "Disfigured", "Disturbing to Beasts", "Distrusted", "Filleted", "Haunted", "Mad",
    "Nocturnal", "Noxious", "Overcome", "Sessile",
    "Secretion", "Spore Calibration", "Spore Fermentation", "Spore Perception", "Spore Synchronization",
  ],
  dwarvenTombsealer: [
    "Ambushing", "Armor Training", "Bright Lore of Aura", "Driving", "Contemplation", "Dwarven Brewing",
  ],
  warlock: [
    "Disfigured", "Distrusted", "Haunted", "Enervated", "Frightening to Beasts",
    "Mad", "Mutated", "Nocturnal", "Obsessed", "Sleepless",
  ],
};

const classes = [...entries].filter(([id, e]) => e.kind === "kind.class" && (id.includes(only) || (e.meta?.key ?? "").includes(only)));
const books = new Map();
let missing = 0;

for (const [id, e] of classes) {
  if (!FILES[e.book]) continue;
  if (!books.has(e.book)) books.set(e.book, (await openBook(fs.readFileSync(FILES[e.book]))).doc);
  const doc = books.get(e.book);

  const known = new Set();
  for (const a of e.awards ?? []) {
    known.add(key(entries.get(a.ref)?.name ?? ""));
    for (const k of aliasesByRef.get(a.ref) ?? []) known.add(k);
    // A note may carry the printed name the ref is filed under.
    const m = /^([A-Z][A-Za-z' -]{2,30}) [—-]/.exec(a.note ?? "");
    if (m) known.add(key(m[1]));
    // A `from.pattern` opens with the printed label; keep its leading letters.
    const p = a.from?.pattern;
    if (p) known.add(key((/^[A-Za-z ,'-]+/.exec(p) ?? [""])[0]));
  }

  const options = new Set((OPTIONS[e.meta?.key] ?? []).map(key));
  const gaps = [];
  for (const page of e.pages ?? []) {
    const pg = await pageItems(doc, page);
    // Run-ins are found by shape, not by `listHeadings`: a class spread is
    // dominated by its tables, which starves the column detector, and the
    // column test `listHeadings` applies then rejects every label on the page.
    // Lines are rebuilt first, because one label is often several runs
    // ("Dwarf" + "Tongues:") and a run alone reads as a different label.
    const lines = new Map();
    for (const it of pg.items) {
      const y = Math.round(it.y / 3) * 3;
      if (!lines.has(y)) lines.set(y, []);
      lines.get(y).push(it);
    }
    // A label is a run that is nothing but "Name:". Its own name may be split
    // across runs ("Dwarf" + "Tongues:"), so the label grows leftwards through
    // runs that touch it — and only those, since anything further left on the
    // row is the neighbouring column's prose.
    const labels = [];
    for (const runs of lines.values()) {
      const row = runs.sort((a, b) => a.x - b.x);
      for (let i = 0; i < row.length; i++) {
        if (!/^[A-Z][^:]{1,38}:\s*$/.test(row[i].str)) continue;
        let text = row[i].str.trim();
        for (let j = i - 1; j >= 0 && row[j].x + (row[j].w ?? 0) >= row[j + 1].x - 3; j--) {
          text = `${row[j].str}${text}`;
        }
        labels.push(text.replace(/:$/, ""));
      }
    }
    for (const label of labels) {
      // A rolled table prints its row number against the label ("10.Sleepless").
      const bare = label.replace(/\s*\([^)]*\)\s*$/, "").replace(/^\d+\.\s*/, "").trim();
      const k = key(bare);
      // A label whose leading run sits too far away to be reconstructed
      // arrives as its own tail ("Tongues" for "Dwarf Tongues"), so a label
      // that ends something already accounted for is accounted for too.
      const tailOf = (set) => [...set].some((n) => n.length > k.length && n.endsWith(k));
      if (!k || STRUCTURAL.has(k) || isProfListLabel(bare) || known.has(k) || options.has(k)) continue;
      if (tailOf(STRUCTURAL) || tailOf(known)) continue;
      gaps.push(`p${page} ${bare}`);
    }
  }
  const uniq = [...new Set(gaps)];
  missing += uniq.length;
  console.log(`${uniq.length ? "GAP  " : "ok   "} ${id.padEnd(34)} ${(e.awards ?? []).length} award(s)${uniq.length ? "  — unaccounted: " + uniq.join(", ") : ""}`);
}

console.log(`\n${classes.length} class(es); ${missing} unaccounted printed label(s).`);
