/**
 * DEV-ONLY harness: run every recipe through the SHIPPING extraction engine
 * (scripts/extract.mjs) against the local reference library. Requires the
 * LOCAL-ONLY PDFs at C:\Proj\acks-reference — never usable in CI, which is
 * why this is not wired to `npm test`.
 *
 * Usage:  node tools/dev-extract-check.mjs
 * Output: per-recipe OK/MISS with word counts and a <=40-char opening snippet
 * (diagnostics only — never dumps passages).
 */
import fs from "node:fs";
import { openBook, extractRecipe, pageItems, extractSpoils, pageArtInfo, pickArt } from "../../scripts/importer/extract.mjs";
import { extractStatPairs } from "../../scripts/importer/stats.mjs";
import { mapPairs } from "../../scripts/importer/stats-map.mjs";
import { RECIPES } from "../../scripts/importer/recipes.mjs";
import { BOOKS, fingerprintWarning } from "../../scripts/importer/books.mjs";

const LIB = "C:\\Proj\\acks-reference\\ACKSII";
const FILES = {
  rr: `${LIB}\\ACKSII_Revised_Rulebook_DIGITAL_FINAL_r10_2nd_Printing.pdf`,
  jj: `${LIB}\\ACKSII_Judges_Journal_DIGITAL_FINAL_r9_2nd_Printing.pdf`,
  mm: `${LIB}\\ACKSII_Monstrous_Manual_DIGITAL_FINAL_r7_2nd_Printing.pdf`,
};

let failed = false;
const docs = {};
for (const [id, file] of Object.entries(FILES)) {
  if (!fs.existsSync(file)) {
    console.log(`SKIP book ${id}: ${file} not found`);
    continue;
  }
  const { doc, numPages, title } = await openBook(fs.readFileSync(file));
  const warn = fingerprintWarning(id, numPages, title);
  console.log(`book ${id}: ${numPages}pp "${title}"${warn ? ` — WARN ${warn}` : " — fingerprint OK"}`);
  docs[id] = doc;
}

for (const recipe of RECIPES) {
  const fake = BOOKS[recipe.book]?.fake;
  const doc = docs[recipe.book];
  if (!doc) {
    console.log(`${fake ? "FAKE" : "SKIP"} ${recipe.id} (book ${recipe.book} ${fake ? "does not exist — stub path by design" : "not loaded"})`);
    if (!fake) failed = true;
    continue;
  }
  const prose = await extractRecipe(doc, recipe).catch((err) => {
    console.log(`ERR  ${recipe.id}: ${err.message}`);
    return null;
  });
  if (!prose) {
    console.log(`MISS ${recipe.id} (${recipe.mode} "${recipe.heading}" @ ${recipe.book} p.${recipe.page})`);
    failed = true;
    continue;
  }
  console.log(`OK   ${recipe.id}: ${prose.split(" ").length}w | ${JSON.stringify(prose.slice(0, 40))}`);
}

// Stat setup: parse monster stat blocks through the shipping mapper (numbers
// only — safe to print). Lammasu is a dev-only recipe exercising HD bonus,
// multi-speed, vision gluing, incarnation type, and proficiency "none".
const STAT_RECIPES = [
  ...RECIPES.filter((r) => r.kind === "monster" && !BOOKS[r.book]?.fake),
  { id: "dev.lammasu", book: "mm", page: 200, mode: "display", heading: "LAMMASU", kind: "monster", name: "Lammasu" },
];
for (const recipe of STAT_RECIPES) {
  const doc = docs[recipe.book];
  if (!doc) continue;
  const pairs = extractStatPairs(await pageItems(doc, recipe.page));
  const res = mapPairs(pairs);
  const { system, extras, applied, unmapped } = res;
  console.log(`STATS ${recipe.id}: ${pairs.length} rows -> ${applied.length} mapped, ${res.items.length} items [${applied.join(", ")}]`);
  console.log(
    `      ac=${system.aac?.value} hd=${system.hp?.hd} hp=${system.hp?.max} save.death=${system.saves?.death?.value} morale=${system.details?.morale} xp=${system.details?.xp} align=${system.details?.alignment} treasure=${JSON.stringify(system.details?.treasure)} move=${system.movement?.base} appearing.w=${system.details?.appearing?.w} attacks=${JSON.stringify(system.attacks)}`,
  );
  console.log(
    `      extras: types=${JSON.stringify(extras.types)} subtype=${JSON.stringify(extras.subtype)} size=${extras.size} mass=${extras.mass?.stone}st hd=${JSON.stringify(extras.hd)} saveAs=${JSON.stringify(extras.saveAs)} speeds=${JSON.stringify(extras.speeds)} vision=${JSON.stringify(extras.vision)}@${extras.lightlessRange} load=${extras.load?.normal} lair=${extras.encounter?.lairChance}%`,
  );
  const wf = (i) => {
    const f = i.flags?.["acks-monsters"] ?? {};
    const bits = [i.system.damage ?? ""];
    if (f.damageType) bits.push(f.damageType);
    if (f.naturalWeapon) bits.push(`nw:${f.naturalWeapon}`);
    if (f.extraordinary) bits.push("EXTRA");
    return `${i.type}:${i.name}(${bits.filter(Boolean).join(" ")})`;
  };
  console.log(`      throw=${system.thac0?.throw} items=${res.items.map(wf).join(" ")}`);
  if (unmapped.length) console.log(`      unmapped (stored raw): ${unmapped.join(", ")}`);
  const spoils = extractSpoils(await pageItems(doc, recipe.page));
  const art = pickArt(await pageArtInfo(doc, recipe.page));
  console.log(`      art: ${art ? `${art.name} ${art.width}x${art.height} kind=${art.kind}` : "none found"}`);
  const wt = (w) => `${Math.floor(w / 6)}${w % 6 ? ` ${w % 6}/6` : ""} st`;
  console.log(`      spoils(${spoils.length}): ${spoils.map((s) => `${s.name} ${wt(s.weight6)} ${s.cost}gp fx=${s.effects.length}`).join(" | ")}`);
  if (!applied.length) failed = true;
}

process.exit(failed ? 1 : 0);
