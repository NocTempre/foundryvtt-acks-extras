/**
 * Cross-check the register against the SYSTEM'S SHIPPED COMPENDIUMS.
 *
 * The acks system ships hand-built compendiums (119 proficiencies, 21 class
 * powers, 53 monster abilities). This module does not import them — content
 * comes from the reader's own book — but they are an independent list of what
 * ACKS content exists, built by different people from the same books. That
 * makes them a free correctness check on the register: a proficiency the system
 * knows about and the register does not is a gap worth explaining, and a
 * general/class flag the two disagree on is a fact one of them has wrong.
 *
 * ADVISORY ONLY — exit 0 whatever it finds (see docs: scans locate, recipes
 * interpret; a difference is a question for a chef, not a build failure). It
 * reports NAMES AND FLAGS, never book text, so it carries no licensed content.
 *
 * Three findings:
 *   - in the compendium, absent from the register  (a possible gap, or a
 *     rename/split the alias file should record)
 *   - in the register, absent from the compendium  (usually ACKS II content
 *     postdating the pack — but also catches entries that are not abilities
 *     at all, e.g. a section heading harvested as a proficiency)
 *   - general/class disagreements                  (one of the two is wrong)
 *
 * Renames and splits are NOT guessed. Two mechanical folds are applied because
 * they are structural conventions rather than rules judgements:
 *   - "Craft: Bowyer" -> "Craft"    (the pack splits by discipline; the
 *     register carries one entry plus acks-abilities `selections`)
 *   - punctuation/case folding
 * Everything else belongs in tools/compendium-aliases.json, authored
 * by a chef who has read both. Unaliased differences simply stay reported.
 *
 * Usage: node tools/verify-against-compendium.mjs [--json]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REGISTER = path.join(HERE, "..", "..", "register");
const ALIAS_FILE = path.join(HERE, "compendium-aliases.json");

/** Where the system's pack source lives, if this machine has the system repo. */
const SYSTEM_PACKS = process.env.ACKS_SYSTEM_PACKS ?? "C:/Proj/foundryvtt-acks-core/src/packs/_source";

/**
 * Which compendium answers for which register kinds. The pack is one list per
 * content type; the register splits proficiencies into two kinds.
 *
 * `kind.skill` is in BOTH pairings because the packs disagree with the register
 * about what a thief skill IS, not about whether it exists. The pack ships
 * Lockpicking as a proficiency and Backstab / Climb Walls / Hide in Shadows as
 * class abilities; the register carries all of them as skills, whose ladders
 * the class entries then reference. Omitting the kind reported thirteen entries
 * the register holds as absent content, which is the reverse of the truth.
 *
 * `refs` names descriptor registries whose TOKENS answer for a pack document
 * without being documents themselves — the monster-ability pack ships Animal
 * and Undead as items where the register carries them as creature types on the
 * monster. That is a modelling difference and it is reported as one: counting
 * it as covered would hide it, and counting it as missing calls content absent
 * that a world importing this module does receive.
 */
const PAIRINGS = [
  {
    packs: ["acks-proficiencies"],
    kinds: ["kind.proficiency", "kind.combatProficiency", "kind.skill"],
    label: "Proficiencies",
  },
  // Both packs answer for `kind.power`, so they are ONE pairing: split apart,
  // each would report the other's entries as missing from the register.
  {
    packs: ["acks-class-abilities", "acks-monster-abilities"],
    kinds: ["kind.power", "kind.skill"],
    refs: ["creatureType", "subtype"],
    label: "Powers & monster abilities",
  },
];

/**
 * The register-only direction is worth itemizing only when the two lists are
 * comparable. The shipped power packs predate most of the corpus (74 documents
 * against 327 register entries), so listing everything the register has and
 * they do not is a 250-line dump that says "this module found more content",
 * which is the point of it. Above this ratio, report the count instead.
 */
const ITEMIZE_RATIO = 1.5;

const JSON_OUT = process.argv.includes("--json");

/** Case/punctuation fold — "Goblin-Slaying" and "goblin slaying" are one name. */
const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * The discipline-split fold: the pack ships "Craft: Bowyer", "Labor: Mining",
 * "Profession: Judge" as separate items where the register carries one entry
 * whose takes record the discipline. Structural, not a rules call.
 */
const foldDiscipline = (name) => String(name ?? "").split(":")[0].trim();

function readJson(file, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}

/** Every ability document in a pack source directory, recursively. */
function packAbilities(packDir) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".json") && e.name !== "_folder.json") {
        const doc = readJson(full);
        if (doc?.type === "ability") out.push(doc);
      }
    }
  };
  if (!fs.existsSync(packDir)) return out;
  walk(packDir);
  return out;
}

/**
 * Every surface form the named descriptor registries recognise.
 *
 * These live under `register/_refs/`, which `registerEntries` cannot reach —
 * it walks the book directories and skips everything beginning with `_`. A
 * token is a name the import understands, not a document it produces, so the
 * caller keeps them in their own bucket rather than folding them into coverage.
 */
function refTokens(registries = []) {
  const out = new Map();
  for (const r of registries) {
    const j = readJson(path.join(REGISTER, "_refs", `${r}.json`), null);
    for (const name of Object.keys(j?.tokens ?? {})) out.set(slug(name), { name, registry: r });
  }
  return out;
}

/**
 * Every register entry name, whatever its kind, mapped to the kind that holds
 * it. The packs and the register disagree about what some content IS — the
 * pack ships Magical Music and Tracking as class abilities where the register
 * files them as proficiencies — and a pairing that reads only its own kinds
 * calls those absent. They are answered, under another kind, and reporting
 * them as gaps sends a chef to author an entry that already exists.
 */
function allRegisterNames() {
  const out = new Map();
  for (const e of registerEntries(null)) if (!out.has(slug(e.name))) out.set(slug(e.name), e.kind);
  return out;
}

/** Every register entry of the given kinds, or of every kind when null. */
function registerEntries(kinds) {
  const want = kinds ? new Set(kinds) : null;
  const out = [];
  for (const d of fs.readdirSync(REGISTER)) {
    const dir = path.join(REGISTER, d);
    if (d.startsWith("_") || !fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      for (const e of readJson(path.join(dir, f), [])) {
        if (e?.name && (!want || want.has(e.kind))) out.push(e);
      }
    }
  }
  return out;
}

function main() {
  if (!fs.existsSync(SYSTEM_PACKS)) {
    console.log(`verify-against-compendium: system pack source not found at ${SYSTEM_PACKS} — skipped.`);
    console.log("  (set ACKS_SYSTEM_PACKS to the system's src/packs/_source to enable this check)");
    return;
  }

  // { "black lore": "Black Lore of Zahar", … } — chef-authored, never guessed.
  const aliases = readJson(ALIAS_FILE, {});
  // Tried on the folded name too, so one "craft" row settles every discipline
  // the pack splits out rather than needing a line per Bowyer and Gemsmith.
  const aliasOf = (name) => aliases[slug(name)] ?? aliases[slug(foldDiscipline(name))] ?? null;

  const report = [];
  const anyKind = allRegisterNames();

  for (const { packs, kinds, refs, label } of PAIRINGS) {
    const pack = packs.join(" + ");
    const docs = packs.flatMap((p) => packAbilities(path.join(SYSTEM_PACKS, p)));
    if (!docs.length) continue;
    const tokens = refTokens(refs);

    const reg = new Map();
    for (const e of registerEntries(kinds)) {
      reg.set(slug(e.name), { name: e.name, general: !!e.meta?.general });
      // A discipline-split pack name folds onto the register's single entry.
      reg.set(slug(foldDiscipline(e.name)), { name: e.name, general: !!e.meta?.general });
    }

    const resolve = (name) => {
      const direct = reg.get(slug(name)) ?? reg.get(slug(foldDiscipline(name)));
      if (direct) return direct;
      const alias = aliasOf(name);
      return alias ? (reg.get(slug(alias)) ?? null) : null;
    };

    // Is the compendium's general/class column worth comparing at all? A field
    // that reads the same on every single document is its schema default that
    // nobody set, not 119 assertions — and comparing against it would
    // manufacture a "disagreement" for every entry the register got RIGHT.
    // Checked rather than assumed, because it is exactly the kind of thing that
    // changes when the pack is next hand-edited.
    const ptypes = new Set(docs.map((d) => d.system?.proficiencytype ?? ""));
    const flagIsMeaningful = packs.includes("acks-proficiencies") && ptypes.size > 1;

    const missing = [];
    const descriptor = [];
    const crossKind = [];
    const flagMismatch = [];
    const seen = new Set();

    for (const doc of docs) {
      const hit = resolve(doc.name);
      if (!hit) {
        // A descriptor answers for the name without shipping a document, so it
        // is neither a gap nor coverage — it is the difference, named.
        const token = tokens.get(slug(doc.name));
        if (token) {
          descriptor.push({ name: doc.name, registry: token.registry });
          continue;
        }
        // Answered, but filed under a kind this pairing does not read. Also a
        // difference rather than a gap: the content is there to import.
        const alias = aliasOf(doc.name);
        const elsewhere = anyKind.get(slug(doc.name)) ?? (alias ? anyKind.get(slug(alias)) : null);
        if (elsewhere) crossKind.push({ name: doc.name, kind: elsewhere });
        else missing.push(doc.name);
        continue;
      }
      seen.add(slug(hit.name));
      if (flagIsMeaningful) {
        const coreGeneral = doc.system?.proficiencytype === "general";
        if (coreGeneral !== hit.general) {
          flagMismatch.push({ name: doc.name, compendium: coreGeneral ? "general" : "class", register: hit.general ? "general" : "class" });
        }
      }
    }

    // Register entries the pack has no counterpart for. Names only appear once
    // (the discipline fold inserts duplicates into the lookup, not the list).
    const regNames = new Map();
    for (const e of registerEntries(kinds)) regNames.set(slug(e.name), e.name);
    const unmatched = [...regNames.entries()].filter(([k]) => !seen.has(k)).map(([, n]) => n);

    report.push({ pack, label, packCount: docs.length, registerCount: regNames.size, missing, descriptor, crossKind, unmatched, flagMismatch, flagIsMeaningful });
  }

  if (JSON_OUT) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  let findings = 0;
  for (const r of report) {
    console.log(`\n=== ${r.label} — compendium ${r.pack} (${r.packCount}) vs register (${r.registerCount}) ===`);

    if (r.missing.length) {
      findings += r.missing.length;
      console.log(`\n  In the compendium, NOT in the register (${r.missing.length}) — a gap, or a rename to alias:`);
      for (const n of r.missing) console.log(`    - ${n}`);
    }
    if (r.descriptor.length) {
      // Not a finding: nothing is missing and nothing needs authoring. It is
      // printed so the difference stays visible instead of reading as coverage.
      console.log(
        `\n  Answered by a DESCRIPTOR, not a document (${r.descriptor.length}) — the pack ships an` +
          `\n  item where the register carries the name as a type on the creature:`,
      );
      for (const d of r.descriptor) console.log(`    - ${d.name}  (${d.registry})`);
    }
    if (r.crossKind.length) {
      console.log(
        `\n  Answered under ANOTHER KIND (${r.crossKind.length}) — present in the register, filed` +
          `\n  where this pairing does not look. Content, not a gap:`,
      );
      for (const c of r.crossKind) console.log(`    - ${c.name}  (${c.kind})`);
    }
    if (r.unmatched.length) {
      const itemize = r.registerCount <= r.packCount * ITEMIZE_RATIO;
      console.log(`\n  In the register, NOT in the compendium (${r.unmatched.length}) — usually ACKS II content`);
      if (itemize) {
        findings += r.unmatched.length;
        console.log(`  postdating the pack; check for entries that are not abilities at all:`);
        for (const n of r.unmatched) console.log(`    - ${n}`);
      } else {
        // Not counted as findings: the register simply covers far more than
        // these packs ever did, and saying so 250 times is not information.
        console.log(
          `  postdating the pack. The register holds ${r.registerCount} against the pack's ${r.packCount},` +
            `\n  so this direction is expected — not itemized. Run with --json for the full list.`,
        );
      }
    }
    if (r.flagMismatch.length) {
      findings += r.flagMismatch.length;
      console.log(`\n  general/class DISAGREEMENTS (${r.flagMismatch.length}) — one of the two is wrong:`);
      for (const m of r.flagMismatch) console.log(`    - ${m.name}: compendium=${m.compendium}, register=${m.register}`);
    }
    if (r.pack === "acks-proficiencies" && !r.flagIsMeaningful) {
      console.log(
        "\n  general/class NOT compared: every document in this pack carries the same" +
          "\n  proficiencytype, so the field is its schema default rather than a value" +
          "\n  anyone set. The register is the only side asserting anything here.",
      );
    }
    if (!r.missing.length && !r.descriptor.length && !r.crossKind.length && !r.unmatched.length && !r.flagMismatch.length) {
      console.log("  agree on every matched entry.");
    }
  }

  console.log(
    `\nverify-against-compendium: ${findings} advisory finding(s). Nothing here fails the build —` +
      `\n  record settled renames/splits in tools/compendium-aliases.json.`,
  );
}

main();
