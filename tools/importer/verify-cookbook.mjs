/**
 * Cookbook acceptance gate: execute the compiled cookbook through the
 * SHIPPING dumb executor (scripts/executor.mjs) against the LOCAL reference
 * PDFs, and check:
 *   - expect integrity per entry (anchor found where instructed);
 *   - values/prose/attacks/spoils/art materialize (word counts + key numbers
 *     as diagnostics — never passages);
 *   - referential integrity (every emitted ref exists in registers.nodes;
 *     definition nodes with empty pages -> warning);
 *   - unknown-token report (lookup misses = promotion candidates);
 *   - per-page line-coverage residue: body items claimed by no instruction
 *     (goal: zero) and cross-entry double-claims.
 *
 * Failures (exit 1): expect mismatch, empty description, zero stats fields.
 * Warnings: stubs, misses, residue.
 *
 * Usage: node tools/verify-cookbook.mjs [book] [pageStart] [pageEnd]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { openBook, pageItems } from "../../scripts/importer/extract.mjs";
import { executeEntry } from "../../scripts/importer/executor.mjs";
import { fingerprintWarning } from "../../scripts/importer/books.mjs";
import { FILES } from "./reference-lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const COOKBOOK = path.join(HERE, "..", "..", "cookbook");

const [bookArg, startArg, endArg] = process.argv.slice(2);
const start = startArg ? parseInt(startArg, 10) : 0;
const end = endArg ? parseInt(endArg, 10) : Infinity;

const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
// Book cookbooks only: index.json and the content-type cookbooks (equipment,
// powers, …) have no `book` fingerprint and no page-anchored composites.
const bookFiles = fs.readdirSync(COOKBOOK).filter((f) => f.endsWith(".json") && f !== "registers.json" && f !== "index.json");

// Composite ids across EVERY book cookbook: a creature-table ref may point at
// another book's entry (the defer-to-ACKS-II rule sends ax2 rooms to mm.*).
const knownComposites = new Set();
for (const f of bookFiles) {
  const c = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  if (c.book) for (const id of Object.keys(c.entries ?? {})) knownComposites.add(id);
}

let failures = 0;
let warnings = 0;
const promo = new Map(); // "table:token" -> count

const wordsOf = (paras) => (paras ?? []).reduce((n, p) => n + p.text.split(/\s+/).filter(Boolean).length, 0);

/** Every ref emitted anywhere in a value tree must resolve in registers.nodes. */
function checkRefs(value, entryId, path0) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => checkRefs(v, entryId, `${path0}[${i}]`));
    return;
  }
  if (typeof value !== "object") return;
  if (value.ref && !value.ref.startsWith("def.")) {
    // Composite ref (creature table): resolves against cookbook entries.
    if (!knownComposites.has(value.ref)) {
      console.log(`FK   ${entryId}: ${path0} -> ${value.ref} MISSING from every book cookbook`);
      failures++;
    }
  } else if (value.ref) {
    const node = registers.nodes[value.ref];
    if (!node) {
      console.log(`FK   ${entryId}: ${path0} -> ${value.ref} MISSING from registers.nodes`);
      failures++;
    } else {
      const ed = Object.values(node.editions ?? {});
      if (node.role === "definition" && !ed.some((e) => (e.pages ?? []).length)) {
        console.log(`STUB ${entryId}: ${path0} -> ${value.ref} has no defining pages yet (warning)`);
        warnings++;
      }
    }
  }
  for (const [k, v] of Object.entries(value)) if (k !== "ref") checkRefs(v, entryId, `${path0}.${k}`);
}

for (const file of bookFiles) {
  const cb = JSON.parse(fs.readFileSync(path.join(COOKBOOK, file), "utf8"));
  if (!cb.book) continue; // content-type cookbook — verified by its own tooling
  const bookId = cb.book.id;
  if (bookArg && bookId !== bookArg) continue;
  const pdf = FILES[bookId];
  if (!pdf || !fs.existsSync(pdf)) {
    console.log(`SKIP book ${bookId}: reference PDF not found`);
    continue;
  }
  const { doc, numPages, title } = await openBook(fs.readFileSync(pdf));
  const fw = fingerprintWarning(bookId, numPages, title);
  console.log(`book ${bookId}: ${numPages}pp "${title}"${fw ? ` — WARN ${fw}` : " — fingerprint OK"}`);

  const claimedAll = new Map(); // text item -> "entryId.field" (items are unique per cached page)
  const pageCache = new Map();

  const ids = Object.keys(cb.entries).filter((id) => {
    const p = cb.entries[id].pages[0];
    return p >= start && p <= end;
  });

  const skipOps = process.env.VERIFY_NO_ART ? ["art"] : undefined;
  for (const id of ids) {
    const res = await executeEntry(doc, cb, registers, id, { trackClaims: true, pageCache, skipOps });
    const f = res.fields;

    // Merge claims; flag cross-entry double-claims.
    for (const [item, field] of res.claims ?? []) {
      const prev = claimedAll.get(item);
      if (prev && !prev.startsWith(`${id}.`)) {
        console.log(`DUP  item claimed by both ${prev} and ${id}.${field}`);
        warnings++;
      }
      claimedAll.set(item, `${id}.${field}`);
    }

    for (const m of res.misses) {
      if (m.table && m.token) promo.set(`${m.table}:${m.token}`, (promo.get(`${m.table}:${m.token}`) ?? 0) + 1);
      else if (m.error) {
        console.log(`ERR  ${id}.${m.field}: ${m.error}`);
        failures++;
      }
    }

    const kind = cb.entries[id].kind;
    const words = wordsOf(f.description);
    const statCount = Object.values(f.stats ?? {}).filter(
      (v) => v === 0 || (!!v && (typeof v !== "object" || Object.keys(v).length) && v !== ""),
    ).length;
    const nameOk = f.name?.ok;
    // Pass criteria are KIND-shaped: a location is prose, an npc is a parsed
    // statline, a rolltable is rows; only monster kinds owe a stat block.
    const rows = Array.isArray(f.rows) ? f.rows : [];
    const sl = f.statline;
    const slOk = !!(sl && (sl.class || sl.hp != null || sl.ac != null));
    const fail = (detail) => {
      console.log(`FAIL ${id}: expect=${nameOk ? "ok" : `MISMATCH(${f.name?.found ?? "none"})`} ${detail}`);
      failures++;
    };
    if (kind === "kind.location") {
      if (!nameOk || !words) {
        fail(`descWords=${words}`);
        continue;
      }
      checkRefs(f, id, "");
      const creatures = Object.values(f.creatures ?? {});
      const cStr = creatures.length
        ? ` creatures=[${creatures.map((c) => `${c?.text ?? "?"}${c?.ref ? `->${c.ref}` : ""}`).join(", ")}]`
        : "";
      console.log(`OK   ${id}: ${f.description.length} paras/${words}w${cStr}`);
      continue;
    }
    if (kind === "kind.npc") {
      if (!nameOk || !slOk) {
        fail(`statline=${sl ? Object.keys(sl).join(",") : "none"} descWords=${words}`);
        continue;
      }
      checkRefs(f, id, "");
      console.log(
        `OK   ${id}: ${f.description?.length ?? 0} paras/${words}w ` +
          `${sl.class ? `${sl.class.name} ${sl.class.level}` : "creature"} ac=${sl.ac} hp=${sl.hp} ` +
          `${sl.abilities ? `abil=${Object.keys(sl.abilities).length}` : ""}${sl.proficiencies ? ` profs=${sl.proficiencies.length}` : ""}${sl.equipment ? " equip" : ""}`,
      );
      continue;
    }
    if (kind === "kind.rolltable") {
      if (!nameOk || !rows.length) {
        fail(`rows=${rows.length}`);
        continue;
      }
      checkRefs(f, id, "");
      const ranges = rows.map((r) => (r.section ?? "").replace(/^r/, ""));
      console.log(`OK   ${id}: ${rows.length} row-paras roll=${f.roll ?? "(derive)"} ranges=${ranges[0]}..${ranges[ranges.length - 1]} descWords=${words}`);
      continue;
    }
    if (kind === "kind.monsterTemplate") {
      // A template has NO stat block on purpose ("varies by rank/age/tier") —
      // its mechanics are the grids. Pass = anchor + prose + every grid rows.
      const grids = Object.entries(f.grids ?? {});
      const bad = grids.filter(([, g]) => !g?.rows?.length).map(([n]) => n);
      if (!nameOk || !words || !grids.length || bad.length) {
        fail(`descWords=${words} grids=${grids.length}${bad.length ? ` empty=[${bad.join(",")}]` : ""}`);
        continue;
      }
      console.log(
        `OK   ${id}: ${f.description.length} paras/${words}w ` +
          `grids[${grids.map(([n, g]) => `${n}:${g.rows.length}`).join(" ")}]`,
      );
      continue;
    }
    if (!nameOk || !words || !statCount) {
      fail(`descWords=${words} stats=${statCount}`);
      continue;
    }
    checkRefs(f, id, "");
    const atk = f.attacks;
    const atkStr = atk
      ? `atk[${(atk.modes ?? []).map((m) => m.segments.map((s) => `${s.name ?? "?"} ${s.damage} ${s.damageType?.key ?? "?"}${s.quality ? ` ${s.quality.toUpperCase()}` : ""}`).join(" + ")).join(" OR ")}] throw=${atk.throw}`
      : kind === "kind.monsterLegacy"
        ? `atkRaw=${JSON.stringify(String(f.stats.attacks ?? "?")).slice(0, 30)} dmg=${JSON.stringify(String(f.stats.damage ?? "?")).slice(0, 30)}`
        : "no-attacks";
    const type = f.stats.type;
    console.log(
      `OK   ${id}: ${f.description.length} paras/${words}w stats=${statCount} ac=${f.stats.armorClass} hd=${f.stats.hitDice} ` +
        `type=${type?.key ?? type?.text ?? "?"}${type?.paren ? `(${type.paren.map((p) => p.key ?? p.text).join(",")})` : ""} ` +
        `${atkStr} spoils=${(f.spoils ?? []).length} art=${f.art ? `${f.art.width}x${f.art.height}` : "none"}`,
    );
  }

  // Line-coverage residue per touched page (shipped skips count as claimed).
  let residuePages = 0;
  let residueItems = 0;
  for (const [page, pd] of [...pageCache.entries()].sort((a, b) => a[0] - b[0])) {
    const skips = cb.skips?.[page] ?? [];
    const skipped = (it) => skips.some((b) => it.x >= b.x0 && it.x <= b.x1 && it.y >= b.y0 && it.y <= b.y1);
    const unclaimed = pd.items.filter((it) => !claimedAll.has(it) && !skipped(it));
    if (unclaimed.length) {
      residuePages++;
      residueItems += unclaimed.length;
      warnings++;
      const sample = unclaimed.slice(0, 4).map((it) => JSON.stringify(it.str.slice(0, 24))).join(" ");
      console.log(`RESIDUE p${page}: ${unclaimed.length} unclaimed item(s) e.g. ${sample}`);
    }
  }
  if (residuePages) console.log(`residue total: ${residueItems} item(s) across ${residuePages} page(s)`);
}

if (promo.size) {
  console.log(`\npromotion candidates (unknown tokens):`);
  for (const [k, n] of [...promo.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${k} x${n}`);
}
console.log(`\nverify done — ${failures} failure(s), ${warnings} warning(s).`);
process.exit(failures ? 1 : 0);
