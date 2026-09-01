/**
 * Propose a core-Foundry icon for every ability entry, for a human to review.
 *
 * DEV-ONLY, and deliberately a PROPOSER rather than an applier. It scores
 * entry names against the ~7,100 icons Foundry ships and prints its guesses
 * with their scores; nothing is written to the register. An icon is
 * presentation, so a wrong one is cosmetic rather than a wrong ruling — but it
 * is still a per-entry judgment, and a keyword score is a reading prompt, not
 * a conclusion (docs/importer/RECIPES.md, "The audit gate", principle 4).
 *
 * Foundry's own library is used on purpose: it is already installed for every
 * seat, needs no extra module, and carries no attribution obligation the way
 * game-icons.net (CC BY 3.0) would.
 *
 * Usage:
 *   node tools/propose-icons.mjs [--icons <dir>] [--min <score>] [--json <out>]
 *   node tools/propose-icons.mjs --unassigned      # only entries with no icon yet
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");

const DEFAULT_ICON_DIRS = [
  "C:\\Program Files\\Foundry Virtual Tabletop\\resources\\app\\public\\icons",
  "/Applications/FoundryVTT.app/Contents/Resources/app/public/icons",
];

/**
 * The ACKS system's own icon tree — 644 purpose-drawn .webp icons named after
 * the book's proficiencies, powers and gear. A hard dependency of everything
 * imported here, thematically exact, and (like Foundry core) no extra module
 * and no attribution obligation — so it is indexed alongside core and its
 * exact name matches outrank any keyword guess.
 */
const SYSTEM_ICON_DIRS = [
  path.join(HERE, "..", "..", "..", "foundryvtt-acks-core", "src", "assets", "icons"),
  "C:\\Users\\benis\\AppData\\Local\\FoundryVTT\\Data\\systems\\acks\\assets\\icons",
];
const SYSTEM_ICON_PREFIX = "systems/acks/assets/icons";

const argv = process.argv.slice(2);
const flag = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};
const has = (name) => argv.includes(name);

const iconRoot = flag("--icons") ?? DEFAULT_ICON_DIRS.find((d) => fs.existsSync(d));
if (!iconRoot) {
  console.error(`no Foundry icon library found — pass --icons <dir> (looked in ${DEFAULT_ICON_DIRS.join(", ")})`);
  process.exit(1);
}
const MIN = Number(flag("--min", "2"));

/** Every shippable icon path, as Foundry references it ("icons/skills/..."). */
function iconIndex(root, prefix = "icons") {
  const out = [];
  const walk = (dir, rel) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(abs, r);
      else if (/\.(webp|svg|png|jpg)$/i.test(e.name)) out.push(`${prefix}/${r.replace(/\\/g, "/")}`);
    }
  };
  walk(root, "");
  return out;
}

const STOP = new Set(["the", "of", "and", "a", "an", "or", "to", "in", "on", "with"]);
const words = (s) =>
  String(s ?? "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 2 && !STOP.has(w));

/**
 * Score an icon path against an entry's words.
 *
 * Whole-word hits in the FILENAME count most, folder hits less: "tools/hand"
 * matching "Handling" would be noise, but a filename "animal-handling" is a
 * real signal. Deliberately crude — this only has to rank candidates well
 * enough that a human can pick from the top few.
 */
function score(iconPath, entryWords) {
  const file = path.basename(iconPath).replace(/\.\w+$/, "").toLowerCase();
  const dir = path.dirname(iconPath).toLowerCase();
  const fileTokens = new Set(file.split(/[^a-z0-9]+/).filter(Boolean));
  let s = 0;
  for (const w of entryWords) {
    if (fileTokens.has(w)) s += 3;
    else if (file.includes(w)) s += 2;
    if (dir.includes(w)) s += 1;
  }
  // Prefer the plainer variant of a family: "diplomacy-handshake" over
  // "diplomacy-handshake-blue", which are the same picture recoloured.
  if (/-(blue|red|green|gray|grey|yellow|orange|purple|white|black)$/.test(file)) s -= 1;
  return s;
}

function registerEntries() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith("_")) continue; // _kinds/_refs/_proposals are not entries
        walk(abs);
      } else if (e.name.endsWith(".json")) {
        let rows;
        try {
          rows = JSON.parse(fs.readFileSync(abs, "utf8"));
        } catch {
          continue;
        }
        if (!Array.isArray(rows)) continue;
        for (const r of rows) {
          if (typeof r?.id === "string" && r.id.startsWith("def.")) out.push({ ...r, _file: path.relative(REGISTER, abs) });
        }
      }
    }
  };
  walk(REGISTER);
  return out;
}

const systemIconRoot = SYSTEM_ICON_DIRS.find((d) => fs.existsSync(d));
const icons = [
  ...iconIndex(iconRoot),
  ...(systemIconRoot ? iconIndex(systemIconRoot, SYSTEM_ICON_PREFIX) : []),
];
if (!systemIconRoot) console.error("note: no ACKS system icon tree found — proposing from Foundry core only");

/**
 * --search: what the tool is actually good for.
 *
 * Scoring names against filenames was tried on all 460 entries and measured on
 * a 42-entry sample: 2 clearly right, ~5 defensible, ~14 wrong, and half the
 * entries got no candidate at all — including Alertness and Ambushing, which a
 * human places instantly. The giveaway is "Battle Magic" scoring a battle AXE:
 * a spellcasting ability handed a weapon because one word collided, which is
 * the standing failure mode wearing a new costume. So the automatic proposal
 * is kept only as the evidence for that, and the useful mode is this one — a
 * human knows the concept and needs the library searched for it.
 */
if (has("--search")) {
  const q = words(argv[argv.indexOf("--search") + 1]);
  const hits = icons
    .map((p) => ({ p, s: score(p, q) }))
    .filter((r) => r.s > 0)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length)
    .slice(0, Number(flag("--top", "25")));
  for (const h of hits) console.log(`${String(h.s).padStart(2)}  ${h.p}`);
  console.error(`\n${hits.length} shown of ${icons.length} indexed.`);
  process.exit(0);
}

let entries = registerEntries().sort((a, b) => a.id.localeCompare(b.id));
if (has("--unassigned")) entries = entries.filter((e) => !e.icon);

console.error(`${icons.length} icons indexed from ${iconRoot}`);
console.error(`${entries.length} definition entr(ies) to propose for\n`);

const proposals = [];
for (const e of entries) {
  const w = words(e.name);
  const ranked = icons
    .map((p) => ({ p, s: score(p, w) }))
    .filter((r) => r.s >= MIN)
    .sort((a, b) => b.s - a.s || a.p.length - b.p.length)
    .slice(0, 3);
  proposals.push({ id: e.id, name: e.name, file: e._file, current: e.icon ?? null, candidates: ranked });
}

const hit = proposals.filter((p) => p.candidates.length);
for (const p of proposals) {
  const top = p.candidates[0];
  console.log(
    `${top ? String(top.s).padStart(2) : " -"}  ${p.name.padEnd(28)} ${top ? top.p : "(no candidate)"}` +
      (p.candidates[1] ? `\n                                    alt: ${p.candidates.slice(1).map((c) => c.p).join("  ")}` : ""),
  );
}
console.error(`\n${hit.length}/${proposals.length} got at least one candidate at score >= ${MIN}.`);
console.error(`${proposals.length - hit.length} need a hand-picked icon.`);

const jsonOut = flag("--json");
if (jsonOut) {
  fs.writeFileSync(path.resolve(jsonOut), JSON.stringify(proposals, null, 2) + "\n");
  console.error(`wrote ${jsonOut}`);
}
