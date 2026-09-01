/**
 * Is a register kind shipping a LIST rather than a way to find one?
 *
 * `ip-scan` caps how LONG a shipped string may be and hunts for prose; the
 * register lint caps a label at sixty characters. Neither counts how MANY
 * short strings a kind ships, so a printed taxonomy authored one cell per
 * entry — a name in the id, a name in `name`, the same name again as the
 * anchor, and no other content — passes both cleanly. Fifty-eight of those
 * shipped once and neither gate said a word.
 *
 * The rule this enforces: an entry earns its printed name by binding a
 * MECHANIC to it. An entry whose every field is that same name is not a
 * locator for content, it IS the content, and content is read from the
 * reader's own book (see `scripts/language-binding.mjs` for the shape that
 * replaces it — a recipe of geometry, extracted at import time).
 *
 * So a kind may ship a handful of name-only entries; it may not ship a
 * catalogue of them.
 *
 * Usage: node tools/audit-transcription.mjs   (also runs via `npm run validate`)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REGISTER = path.join(ROOT, "register");

/** Above this many entries, a name-only KIND is a transcribed list. */
const CATALOGUE = 12;

/**
 * A kind EXTRACTS something when its fields reach past the name — a
 * description, a stat block, attacks, art. That is what makes its entries
 * locators: the anchor finds a passage, and the passage is the content.
 *
 * A kind whose fields are the name alone extracts nothing. Its entries can only
 * ever carry what was typed into them, so a catalogue of them is the list
 * itself. This is the discriminator, NOT the entry's own shape: powers,
 * equipment and monsters all carry a bare anchor per entry and keep their
 * instructions in the kind, so judging entries alone condemns them wrongly.
 */
function extractsOnlyName(kindDef) {
  const fields = Object.keys(kindDef?.fields ?? {});
  return fields.length > 0 && fields.every((f) => f === "name");
}

/** Fields that carry no content of their own — bookkeeping, not the book. */
const STRUCTURAL = new Set(["id", "kind", "book", "pages", "meta", "icon", "note", "audited", "aliasOf", "sortOrder"]);

const fold = (s) =>
  String(s ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/**
 * An entry is NAME-ONLY when everything it carries is its own name: no
 * instructions, no fields to extract, and an anchor that is the name again.
 */
function isNameOnly(entry) {
  const name = fold(entry?.name);
  if (!name) return false;
  for (const [key, value] of Object.entries(entry)) {
    if (STRUCTURAL.has(key) || key === "name") continue;
    if (key === "anchor") {
      // An anchor that repeats the name locates nothing the id did not.
      const anchored = Object.values(value ?? {}).map(fold).join("");
      if (anchored && anchored !== name) return false;
      continue;
    }
    // Any other populated key is real content: a recipe, fields, a template.
    if (value && (typeof value !== "object" || Object.keys(value).length)) return false;
  }
  return true;
}

const byKind = new Map();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!e.name.startsWith("_")) walk(p);
      continue;
    }
    if (!e.name.endsWith(".json")) continue;
    let parsed;
    try {
      parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!entry?.kind || !entry?.id) continue;
      if (!isNameOnly(entry)) continue;
      const rec = byKind.get(entry.kind) ?? { count: 0, files: new Set() };
      rec.count++;
      rec.files.add(path.relative(ROOT, p));
      byKind.set(entry.kind, rec);
    }
  }
};
if (fs.existsSync(REGISTER)) walk(REGISTER);

/** What each kind declares it extracts. */
const kinds = new Map();
const kindsDir = path.join(REGISTER, "_kinds");
if (fs.existsSync(kindsDir)) {
  for (const f of fs.readdirSync(kindsDir)) {
    if (!f.endsWith(".json")) continue;
    try {
      const k = JSON.parse(fs.readFileSync(path.join(kindsDir, f), "utf8"));
      if (k?.id) kinds.set(k.id, k);
    } catch {
      /* the register lint reports a malformed kind; not this check's job */
    }
  }
}

const problems = [];
for (const [kind, rec] of byKind) {
  if (!extractsOnlyName(kinds.get(kind))) continue;
  if (rec.count > CATALOGUE) {
    problems.push(
      `${kind}: ${rec.count} entries carry a name and nothing else (${[...rec.files].join(", ")}) — ` +
        `that is a transcribed list, not a locator. Read it from the seat's own book instead.`,
    );
  }
}

if (problems.length) {
  console.error(`audit-transcription: ${problems.length} problem(s):`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
const total = [...byKind.values()].reduce((n, r) => n + r.count, 0);
console.log(`audit-transcription OK (${total} name-only entr(ies), none above ${CATALOGUE} per kind).`);
