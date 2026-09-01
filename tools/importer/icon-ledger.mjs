/**
 * The icon ledger — what every imported document will look like, and what is
 * still wearing a placeholder.
 *
 * An imported item is read in a list, at 32 pixels, next to two hundred of its
 * siblings. Three things have to be true there: the picture is not the same
 * picture as its neighbour's, it says something about the thing, and its KIND
 * is legible before the name is. So each kind draws from one visual register
 * (below), no two differently-named entries share a path, and the flat grey
 * `icons/svg/*` placeholders — one sword for every class, one bag for
 * sixty-eight goods — are banned outright.
 *
 * DEV-ONLY. Reads `register/`, writes only when asked:
 *
 *   node tools/icon-ledger.mjs                 # the ledger, per kind
 *   node tools/icon-ledger.mjs --check         # ratchet gate: fails on regression
 *   node tools/icon-ledger.mjs --update        # rewrite register/_icons.json
 *   node tools/icon-ledger.mjs --todo <kind>   # entries of one kind still to place
 *   node tools/icon-ledger.mjs --apply <map>   # write {id: icon} assignments
 *   node tools/icon-ledger.mjs --free <prefix> # library paths nothing has claimed
 *
 * `--apply` is the working end: assignments are authored as a JSON map, checked
 * against the installed libraries (a path that is not on disk is refused, which
 * is what catches a typo before it reaches a seat as a broken image), and
 * spliced into the register files a line at a time so the diff shows the icon
 * and nothing else.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");
const LEDGER = path.join(REGISTER, "_icons.json");

/**
 * One visual register per kind, so a sidebar row announces what it is before
 * it is read. The ACKS system tree is flat white-on-black pictograms; Foundry
 * core is painted colour art sorted by subject, and the subject folders are
 * what keep an ability from looking like a piece of gear.
 *
 * `allow` is a prefix list, not a whitelist of files: within its register a
 * kind may use anything, because the entry is what picks the picture.
 */
export const FAMILIES = {
  "kind.proficiency": { look: "ACKS pictogram (white on black)", allow: ["systems/acks/assets/icons/"] },
  "kind.combatProficiency": { look: "ACKS pictogram (white on black)", allow: ["systems/acks/assets/icons/"] },
  "kind.skill": { look: "ACKS pictogram (white on black)", allow: ["systems/acks/assets/icons/"] },
  "kind.class": { look: "heraldic banner", allow: ["icons/sundries/flags/"] },
  // A class power is an effect, a knack, or a stronghold, so its register is
  // wider than the others'. It also reaches into the ACKS tree for the one
  // case where a power and a printed proficiency are the SAME ability under
  // two headings (Alertness, Ambushing, Acrobatics…): one concept keeps one
  // picture, and the shared-icon rule below is what holds that to same-name.
  "kind.power": {
    look: "effect art (magic / skill / creature ability)",
    allow: [
      "icons/magic/",
      "icons/skills/",
      "icons/creatures/",
      "icons/environment/",
      "systems/acks/assets/icons/",
    ],
  },
  "kind.equipment": {
    look: "painted object",
    allow: [
      "icons/commodities/",
      "icons/consumables/",
      "icons/containers/",
      "icons/equipment/",
      "icons/tools/",
      "icons/weapons/",
      "icons/sundries/",
      "icons/environment/",
      "icons/creatures/",
    ],
  },
  "kind.variation": {
    look: "forge and material",
    allow: ["icons/tools/smithing/", "icons/commodities/", "icons/equipment/shield/", "icons/weapons/"],
  },
  "kind.trap": {
    look: "mechanism, or the thing that hits you",
    allow: ["icons/environment/", "icons/weapons/", "icons/magic/", "icons/tools/", "icons/commodities/", "icons/skills/"],
  },
  "kind.vehicle": {
    look: "conveyance",
    allow: ["icons/environment/vehicles/", "icons/environment/settlement/", "icons/tools/nautical/", "icons/tools/navigation/", "icons/commodities/wood/"],
  },
};

/** Kinds that become an Item or Actor a reader picks out of a list. */
const LEDGERED = Object.keys(FAMILIES);

/**
 * The flat grey core SVGs. They are the Foundry default a document gets when
 * nobody chose, and using one is indistinguishable from not having chosen —
 * which is how sixty-eight goods came to share a bag.
 */
const PLACEHOLDER = "icons/svg/";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flag = (f, fallback = null) => {
  const i = argv.indexOf(f);
  return i === -1 ? fallback : (argv[i + 1] ?? fallback);
};

/** Where the three libraries live on a developer machine, if they are installed. */
const LIBRARIES = [
  {
    prefix: "icons/",
    roots: [
      "C:\\Program Files\\Foundry Virtual Tabletop\\resources\\app\\public\\icons",
      "/Applications/FoundryVTT.app/Contents/Resources/app/public/icons",
    ],
  },
  {
    prefix: "systems/acks/assets/icons/",
    roots: [
      path.join(HERE, "..", "..", "..", "foundryvtt-acks-core", "src", "assets", "icons"),
      "C:\\Users\\benis\\AppData\\Local\\FoundryVTT\\Data\\systems\\acks\\assets\\icons",
    ],
  },
  {
    prefix: "modules/game-icons-net/",
    roots: ["C:\\Users\\benis\\AppData\\Local\\FoundryVTT\\Data\\modules\\game-icons-net"],
  },
];

/** Every path each installed library can serve, as the register spells it. */
function libraryIndex() {
  const known = new Set();
  const found = [];
  for (const lib of LIBRARIES) {
    const root = lib.roots.find((r) => fs.existsSync(r));
    if (!root) continue;
    found.push(lib.prefix);
    const walk = (dir, rel) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const abs = path.join(dir, e.name);
        const r = rel ? `${rel}/${e.name}` : e.name;
        if (e.isDirectory()) walk(abs, r);
        else if (/\.(webp|svg|png|jpg)$/i.test(e.name)) known.add(lib.prefix + r.replace(/\\/g, "/"));
      }
    };
    walk(root, "");
  }
  return { known, found };
}

/** Every register row, with the file it came from. `_kinds` etc. are not rows. */
function registerRows() {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name.startsWith("_")) continue;
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
          if (typeof r?.id === "string") out.push({ ...r, _file: path.relative(REGISTER, abs).replace(/\\/g, "/") });
        }
      }
    }
  };
  walk(REGISTER);
  return out;
}

const nameFold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * What is wrong with each entry, one row per fault. An entry can carry more
 * than one (a missing icon is not also off-family), so faults are ordered and
 * the first that applies is the one reported.
 *
 * Two entries printing the SAME name are one concept in two books and share
 * their picture on purpose — collision is counted per name, never per id.
 */
export function audit(rows) {
  const ledgered = rows.filter((r) => LEDGERED.includes(r.kind));
  const byIcon = new Map();
  for (const r of ledgered) {
    if (!r.icon) continue;
    const names = byIcon.get(r.icon) ?? new Set();
    names.add(nameFold(r.name));
    byIcon.set(r.icon, names);
  }
  const faults = [];
  for (const r of ledgered) {
    const fam = FAMILIES[r.kind];
    if (!r.icon) faults.push({ ...r, fault: "missing" });
    else if (r.icon.startsWith(PLACEHOLDER)) faults.push({ ...r, fault: "placeholder" });
    else if (!fam.allow.some((p) => r.icon.startsWith(p))) faults.push({ ...r, fault: "off-family" });
    else if ((byIcon.get(r.icon)?.size ?? 0) > 1) faults.push({ ...r, fault: "shared" });
  }
  return { ledgered, faults };
}

/** Per-kind counts, in the shape the ledger file stores. */
function tally(rows) {
  const { ledgered, faults } = audit(rows);
  const kinds = {};
  for (const k of LEDGERED) {
    const mine = ledgered.filter((r) => r.kind === k);
    const bad = faults.filter((r) => r.kind === k);
    if (!mine.length) continue;
    kinds[k] = {
      total: mine.length,
      placed: mine.length - bad.length,
      missing: bad.filter((r) => r.fault === "missing").length,
      placeholder: bad.filter((r) => r.fault === "placeholder").length,
      offFamily: bad.filter((r) => r.fault === "off-family").length,
      shared: bad.filter((r) => r.fault === "shared").length,
    };
  }
  const debt = Object.values(kinds).reduce((n, k) => n + (k.total - k.placed), 0);
  return { kinds, debt, total: ledgered.length };
}

const rows = registerRows();

// --free: what the library still has to offer under a prefix, minus what the
// register already spends. The other half of picking an icon by hand.
if (has("--free")) {
  const prefix = flag("--free");
  const { known } = libraryIndex();
  const spent = new Set(rows.flatMap((r) => [r.icon, r.iconNiche]).filter(Boolean));
  const free = [...known].filter((p) => p.startsWith(prefix) && !spent.has(p)).sort();
  for (const p of free) console.log(p);
  console.error(`${free.length} unclaimed under ${prefix}`);
  process.exit(0);
}

if (has("--todo")) {
  const kind = flag("--todo");
  const { faults } = audit(rows);
  const mine = faults.filter((r) => !kind || r.kind === kind);
  for (const r of mine) {
    console.log(`${r.fault.padEnd(11)} ${r.id}\t${r.name}\t${r.icon ?? "-"}\t${r._file}`);
  }
  console.error(`\n${mine.length} to place${kind ? ` in ${kind}` : ""}`);
  process.exit(0);
}

if (has("--apply")) {
  const mapFile = flag("--apply");
  const map = JSON.parse(fs.readFileSync(path.resolve(mapFile), "utf8"));
  const { known, found } = libraryIndex();
  const byId = new Map(rows.map((r) => [r.id, r]));
  const errors = [];
  const work = new Map(); // file -> [{id, icon, iconNiche}]

  for (const [id, value] of Object.entries(map)) {
    const row = byId.get(id);
    if (!row) {
      errors.push(`${id}: no such register entry`);
      continue;
    }
    const want = typeof value === "string" ? { icon: value } : value;
    for (const [field, p] of Object.entries(want)) {
      if (field !== "icon" && field !== "iconNiche") errors.push(`${id}: unknown field "${field}"`);
      else if (typeof p !== "string" || !p) errors.push(`${id}: ${field} must be a path`);
      else if (field === "icon" && p.startsWith(PLACEHOLDER)) errors.push(`${id}: ${p} is a grey placeholder`);
      else if (field === "icon" && !FAMILIES[row.kind]?.allow.some((a) => p.startsWith(a)))
        errors.push(`${id}: ${p} is outside the ${row.kind} register (${FAMILIES[row.kind]?.allow.join(" ")})`);
      else if (known.size && !known.has(p)) errors.push(`${id}: ${p} is not in any installed library`);
    }
    if (!work.has(row._file)) work.set(row._file, []);
    work.get(row._file).push({ id, ...want });
  }
  if (!known.size) console.error("warning: no icon library installed — paths were not checked against disk");
  else console.error(`checked against ${found.join(", ")}`);
  if (errors.length) {
    for (const e of errors) console.error(`  ${e}`);
    console.error(`\n${errors.length} problem(s) — nothing written.`);
    process.exit(1);
  }

  let written = 0;
  for (const [file, items] of work) {
    const abs = path.join(REGISTER, file);
    let text = fs.readFileSync(abs, "utf8");
    for (const item of items) {
      for (const field of ["icon", "iconNiche"]) {
        if (!item[field]) continue;
        text = spliceField(text, item.id, field, item[field], file);
        written++;
      }
    }
    fs.writeFileSync(abs, text);
  }
  console.error(`wrote ${written} field(s) across ${work.size} file(s).`);
  process.exit(0);
}

/**
 * Set one field on one entry, in the file's own text.
 *
 * The register is hand-authored JSON whose formatting does not survive a
 * parse/stringify round trip (58 of 108 files differ), so an assignment is
 * spliced rather than re-serialized: the entry is found by its id line, its
 * extent by brace depth from there, and the field replaced in place or added
 * after the id. Anything else in the file — key order, spacing, the author's
 * line breaks — is left exactly as it was.
 */
function spliceField(text, id, field, value, file) {
  const idLine = new RegExp(`^(\\s*)"id":\\s*"${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}",?\\s*$`, "m");
  const m = idLine.exec(text);
  if (!m) throw new Error(`${id}: id line not found in ${file}`);
  const indent = m[1];
  // The entry object runs from the "{" before the id line to its matching "}".
  const open = text.lastIndexOf("{", m.index);
  let depth = 0;
  let close = -1;
  for (let i = open; i < text.length; i++) {
    if (text[i] === '"') {
      i = skipString(text, i);
      continue;
    }
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) {
      close = i;
      break;
    }
  }
  if (close === -1) throw new Error(`${id}: unterminated entry in ${file}`);
  const body = text.slice(open, close);
  const own = new RegExp(`^${indent}"${field}":\\s*"[^"]*"(,?)$`, "m");
  if (own.test(body)) {
    const patched = body.replace(own, `${indent}"${field}": ${JSON.stringify(value)}$1`);
    return text.slice(0, open) + patched + text.slice(close);
  }
  const lineEnd = m.index + m[0].length;
  const comma = m[0].trimEnd().endsWith(",") ? "" : ",";
  const head = comma ? text.slice(0, m.index) + m[0].trimEnd() + "," : text.slice(0, lineEnd);
  return `${head}\n${indent}"${field}": ${JSON.stringify(value)}${comma ? "" : ","}${text.slice(lineEnd)}`;
}

/** Index of the closing quote of the string starting at `i`. */
function skipString(text, i) {
  for (let j = i + 1; j < text.length; j++) {
    if (text[j] === "\\") j++;
    else if (text[j] === '"') return j;
  }
  return text.length;
}

const now = tally(rows);

if (has("--update")) {
  fs.writeFileSync(LEDGER, JSON.stringify({ updated: new Date().toISOString(), ...now }, null, 2) + "\n");
  console.error(`wrote ${path.relative(path.join(HERE, "..", ".."), LEDGER)} — debt ${now.debt}/${now.total}`);
  process.exit(0);
}

// The report. Ordered by what is left to do, because that is the working list.
const kinds = Object.entries(now.kinds).sort((a, b) => b[1].total - b[1].placed - (a[1].total - a[1].placed));
console.log(`${"kind".padEnd(24)} ${"placed".padStart(9)}  ${"miss".padStart(5)} ${"grey".padStart(5)} ${"family".padStart(6)} ${"shared".padStart(6)}   register`);
for (const [k, v] of kinds) {
  console.log(
    `${k.replace("kind.", "").padEnd(24)} ${`${v.placed}/${v.total}`.padStart(9)}  ` +
      `${String(v.missing || "").padStart(5)} ${String(v.placeholder || "").padStart(5)} ` +
      `${String(v.offFamily || "").padStart(6)} ${String(v.shared || "").padStart(6)}   ${FAMILIES[k].look}`,
  );
}
console.log(`\n${now.total - now.debt}/${now.total} placed — ${now.debt} left.`);

if (has("--check")) {
  const prior = fs.existsSync(LEDGER) ? JSON.parse(fs.readFileSync(LEDGER, "utf8")) : null;
  if (!prior) {
    console.error("\nno register/_icons.json — run --update to open the ledger.");
    process.exit(1);
  }
  const regressions = [];
  if (now.debt > prior.debt) regressions.push(`debt rose ${prior.debt} -> ${now.debt}`);
  for (const [k, v] of Object.entries(now.kinds)) {
    const was = prior.kinds?.[k];
    if (!was) continue;
    const left = v.total - v.placed;
    const wasLeft = was.total - was.placed;
    if (left > wasLeft) regressions.push(`${k}: ${wasLeft} -> ${left} unplaced`);
  }
  if (regressions.length) {
    for (const r of regressions) console.error(`  ${r}`);
    console.error("\nThe icon ledger only goes down. Place the new entries, then --update.");
    process.exit(1);
  }
  if (now.debt < prior.debt) console.error(`\nledger is stale (${prior.debt} recorded, ${now.debt} actual) — run --update.`);
}
