/**
 * Every OSE dialog string resolves.
 *
 * The dialogs reach their strings through a `loc()` helper and through keys
 * built from a route or gap name, so the repo's quoted-literal i18n scan
 * cannot see them: a typo would ship silently and render as the key itself.
 * This checks the static calls by name, and the computed ones against the
 * vocabularies that actually generate them.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { OSE_CANONICAL } from "../../scripts/importer/ose-statline.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "..");
const PREFIX = "ACKS-IMPORTER.";

const lang = JSON.parse(fs.readFileSync(path.join(ROOT, "lang", "en.json"), "utf8"));
const src = ["ose-app.mjs", "ose-manual.mjs", "ose-book.mjs"]
  .map((f) => fs.readFileSync(path.join(ROOT, "scripts", "importer", f), "utf8"))
  .join("\n");

const missing = [];
const seen = new Set();
const want = (key, why) => {
  if (seen.has(key)) return;
  seen.add(key);
  if (!(PREFIX + key in lang)) missing.push(`${key}  (${why})`);
};

/**
 * Dialect and profile identifiers share the `ose.` prefix with the lang keys
 * and are not lang keys. There is no way to tell them apart by shape, so they
 * are named here — a short list, and a wrong entry shows up as a key that
 * silently renders as itself.
 */
const NOT_LANG_KEYS = new Set(["ose.hand", "ose.canonical", "ose.learned", "ose.authored"]);

// Any literal key in the file, not only the ones directly inside a loc() call —
// several are chosen by a conditional and handed in, which a call-shaped scan
// would walk straight past.
for (const m of src.matchAll(/["'`](ose\.[A-Za-z0-9_.]+)["'`]/g)) {
  if (!NOT_LANG_KEYS.has(m[1])) want(m[1], "key literal");
}

// Computed calls: loc(`ose.route.${c.route}`) and friends. The vocabularies
// that feed them are the converter's own, so they are enumerated here rather
// than parsed out of the template.
const ROUTES = ["guide", "raw-derivation", "transcribed", "derived-endpoint"];
const REASONS = [
  "needs-guide",
  "progressions-disagree",
  "no-attack-bonus-printed",
  "single-save-printed",
  "incomplete-save-row",
  "not-a-number",
  "saves-by-reference",
  "no-acks-equivalent",
  "different-award-schedule",
  "different-treasure-tables",
  "not-an-acks-alignment",
  "out-of-scale",
  "no-bounds",
  "unsupported-lineage",
  "unreadable",
];
for (const r of ROUTES) want(`ose.route.${r}`, "conversion route");
for (const r of REASONS) want(`ose.gap.${r}`, "gap reason");
for (const f of Object.keys(OSE_CANONICAL.labels)) want(`ose.field.${f}`, "calibration field");

if (missing.length) {
  console.error(`ose-lang: ${missing.length} missing key(s):`);
  for (const k of missing) console.error(`  ${PREFIX}${k}`);
  process.exit(1);
}
console.error(`ose-lang: OK (${seen.size} keys resolve)`);
