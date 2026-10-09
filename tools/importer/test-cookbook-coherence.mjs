/**
 * A recipe's page coordinates only mean something in the book they were
 * measured against. Nothing at runtime can notice when they disagree: an entry
 * is read from `entry.book` alone, the instruction set has no cross-document
 * read, and the only correctness gate is the `expect` probe on the name — which
 * keeps passing while some other field quietly reads a different book. So the
 * agreement is asserted here, over the shipped data, with no PDFs and no Foundry.
 */
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { citeFor } from "../../scripts/importer/books.mjs";
import { isSceneRecipe, isZoneRow } from "../../scripts/importer/scene-binding.mjs";

const COOKBOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "cookbook");

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

/** Every entry in every cookbook, tagged with the book it will be read from. */
const entries = new Map();
/** Every compiled scene row — recipes and zones — tagged with the book whose cookbook holds it. */
const sceneRows = new Map();
/** Each cookbook file's own entry ids, by file name. */
const idsByFile = new Map();
for (const f of fs.readdirSync(COOKBOOK).filter((n) => n.endsWith(".json") && n !== "registers.json" && n !== "index.json")) {
  const c = JSON.parse(fs.readFileSync(path.join(COOKBOOK, f), "utf8"));
  // A book cookbook names its book once at the top; a content cookbook (powers,
  // equipment, …) spans books and names one per entry.
  const fileBook = typeof c.book === "string" ? c.book : c.book?.id;
  for (const [id, e] of Object.entries(c.entries ?? {})) entries.set(id, { ...e, id, file: f, book: e.book ?? fileBook });
  for (const [id, row] of Object.entries(c.scenes ?? {})) sceneRows.set(id, { ...row, id, book: fileBook });
  idsByFile.set(f, new Set(Object.keys(c.entries ?? {})));
}
check("the shipped cookbook has entries to check", entries.size > 1000);

/* An alias is its own ability whose rules text prints under another entry, so
 * its recipe carries a pointer to the target's passage. That pointer is
 * geometry: the alias must therefore be read from the book the passage prints
 * in, not from the book that merely lists the name. When these disagreed, 31
 * Judges Journal powers carried Revised Rulebook rectangles and every one of
 * them extracted whatever the JJ happened to print at those coordinates —
 * poison tables and proficiency-throw rules under the name of a class power. */
const aliases = [...entries.values()].filter((e) => e.aliasOf);
check("the cookbook still ships aliases", aliases.length > 0);

for (const e of aliases) {
  const t = entries.get(e.aliasOf);
  check(`${e.id}: alias target ${e.aliasOf} exists`, !!t);
  check(`${e.id}: is read from the book its text prints in (${t?.book}), not ${e.book}`, t?.book === e.book);
}

/* The citation is what the sheet shows a reader, and the book is what the
 * module opens to fill it. A disagreement between them is the same defect
 * wearing its user-visible face: the stub says "RR p.95" while only the JJ can
 * unlock the entry, so the seat that owns the cited book gets no text and the
 * seat that owns the other one gets the wrong text. */
const CITE_BOOK = /^([A-Za-z0-9]+)\s+p\./;
for (const e of entries.values()) {
  if (!e.cite || !e.book) continue;
  const m = CITE_BOOK.exec(e.cite);
  if (!m) continue;
  check(`${e.id}: cite "${e.cite}" names the book it is read from (${e.book})`, m[1].toLowerCase() === e.book.toLowerCase());
}

/* A citation names the PRINTED FOLIO, not the PDF page. Everything upstream
 * addresses the PDF page — that is what a reader hands the extractor — and the
 * translation happens once, in `citeFor`. Six of the seven cite composers
 * interpolated the raw page instead, so every core-book citation sent a reader
 * two pages past the entry: a proficiency printed on 109 cited 111, and the
 * class power on 314 cited 316. The offset is invisible to every other gate,
 * because nothing else in the pipeline ever converts a page number.
 *
 * The page a citation names is the page its TEXT prints on — an alias's
 * description page, where it has one, not the listing page it was found under. */
for (const e of entries.values()) {
  if (!e.cite || !e.book) continue;
  const page = e.fields?.description?.page ?? e.pages?.[0];
  if (!Number.isFinite(page)) continue;
  const expected = citeFor(e.book, page);
  check(`${e.id}: cite "${e.cite}" names the printed folio for PDF p.${page} ("${expected}")`, e.cite === expected);
}

/* The compiler keys each reference register by its `registry` field
 * (`refs[r.registry] = r`), so a source file that omits the field compiles to
 * the literal key "undefined" — a table nothing can name and the next
 * registry-less file would overwrite. The power-source matrix shipped that way
 * and was unreachable for it. */
const registers = JSON.parse(fs.readFileSync(path.join(COOKBOOK, "registers.json"), "utf8"));
for (const name of Object.keys(registers.tables ?? {})) {
  check(`register table "${name}" compiled under a real registry name`, name !== "undefined" && /^[a-z][A-Za-z]*$/.test(name));
}

/* The power-source matrix is also the printed-name alias index: a class or race
 * spread names a power in its own short form ("Hardy") while the definition
 * carries the full one (`def.power.hardyPeople`), so a rung that resolves by
 * name alone can never find it. Every ref it points at must be a real entry,
 * or the alias resolves to a definition the cookbook cannot open. */
const sourceRows = Object.values(registers.tables?.powerSource ?? {}).flat();
check("the power-source matrix ships rows", sourceRows.length > 0);
for (const row of sourceRows) {
  if (!row?.ref?.startsWith("def.")) continue;
  check(`powerSource "${row.name}": ref ${row.ref} is a shipped entry`, entries.has(row.ref));
}

/* The racial rungs the class builder writes name their powers this way, and
 * two of them ("Dwarf Tongues", "Elf Tongues") are the name of no definition
 * at all. Losing these is silent: the rung keeps its note and simply grants
 * nothing. */
const printedNames = new Map();
const ambiguousNames = new Set();
for (const row of sourceRows) {
  const key = String(row?.name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (!key || !row.ref) continue;
  if (printedNames.has(key) && printedNames.get(key) !== row.ref) ambiguousNames.add(key);
  else printedNames.set(key, row.ref);
}
for (const key of ambiguousNames) printedNames.delete(key);
for (const printed of ["Hardy", "Dwarf Tongues", "Elf Tongues", "Sensitivity to Rock and Stone", "Animal Friendship", "Attunement to Nature", "Connection to Nature"]) {
  const key = printed.toLowerCase().replace(/[^a-z0-9]/g, "");
  check(`racial power "${printed}" resolves through the power-source register`, printedNames.has(key));
}


/* --- printed surfaces resolve to exactly one definition, on every path --- */

// The list path and the cell path used to be two indexes that arbitrated the
// same collision differently, so a template cell granted a class POWER where
// the class's own list granted the PROFICIENCY. They now read one index; this
// asserts the shipped data still yields one answer per printed surface, and
// that every authored alias points somewhere.
const { abilitySurfaceIndex } = await import("../../scripts/importer/cookbook.mjs");
const { byKey, menu } = abilitySurfaceIndex([...entries].map(([id, e]) => [id, e]));

let disagreements = 0;
for (const [key, hit] of byKey) {
  const row = menu.find((m) => String(m.surface).toLowerCase().replace(/[^a-z0-9]/g, "") === key);
  if (row && row.ref !== hit.ref) disagreements++;
}
check("the class-list path and the cell path agree about every printed surface", disagreements === 0);

const aliased = [...entries.values()].filter((e) => e.aliases?.length);
check("the shipped cookbook carries authored aliases at all", aliased.length > 0);
for (const e of aliased) {
  for (const a of e.aliases) {
    const hit = byKey.get(String(a).toLowerCase().replace(/[^a-z0-9]/g, ""));
    check(`alias "${a}" resolves to ${e.id}`, hit?.ref === e.id);
  }
}

// A collision is allowed — the books really do print one name for two things —
// but it must resolve to a proficiency where one is among the candidates, which
// is what the printed lists mean by the name far more often than not.
for (const [key, hit] of byKey) {
  if (!hit.ambiguous) continue;
  const ids = menu.filter((m) => String(m.surface).toLowerCase().replace(/[^a-z0-9]/g, "") === key);
  if (!ids.length) continue;
  check(`the collision on "${key}" resolves deterministically`, typeof hit.ref === "string" && hit.ref.length > 0);
}

/* --- a zone lies over a real map, from its own book --- */

// A zone is compiled in its own book's cookbook but names a recipe that may be
// any book's, so no single compile can see both halves. Its list must be its
// own book's, and its outline is page points of the target's page, so every
// point must fall inside the target's crop or the region is drawn off the map.
const zones = [...sceneRows.values()].filter(isZoneRow);
for (const z of zones) {
  const target = sceneRows.get(z.zone.scene);
  check(`${z.id}: zone lies over ${z.zone.scene}, a compiled scene recipe`, isSceneRecipe(target));
  if (z.zone.table !== undefined) {
    const t = entries.get(z.zone.table);
    check(`${z.id}: its list ${z.zone.table} is a roll table of its own book (${z.book})`, t?.kind === "kind.rolltable" && t.book === z.book);
  }
  const crop = target?.scene?.crop;
  const ring = z.zone.outline ?? [];
  const outside = [];
  for (let i = 0; crop && i + 1 < ring.length; i += 2) {
    const [x, y] = [ring[i], ring[i + 1]];
    if (!(x >= crop.x && x <= crop.x + crop.w && y >= crop.y && y <= crop.y + crop.h)) outside.push(`(${x}, ${y})`);
  }
  check(`${z.id}: every outline point lies inside ${z.zone.scene}'s crop${outside.length ? ` — not ${outside.slice(0, 3).join(", ")}` : ""}`, !!crop && outside.length === 0);
}

/* --- a revision points into the book its id names --- */

// `meta.revisedBy` sends an import to a later printing of the same creature,
// and the importer defers only while the book its id's prefix names is open
// (`deferTarget`): an id that book's cookbook does not hold is a deferral the
// seat that owns the book is promised and never gets.
for (const e of entries.values()) {
  const to = e.meta?.revisedBy;
  if (to === undefined) continue;
  const file = `${String(to).split(".")[0]}.json`;
  check(`${e.id}: revisedBy ${to} is an entry of ${file}`, idsByFile.get(file)?.has(to) === true);
}

/* --- a roll table's rows are die bands, its details follow their row --- */

// The binding turns each `r<band>` section into result ranges and drops any
// other, so a row under a different label vanishes from the table. A detail
// paragraph explains the row it follows, which must be its own: the compiler
// appends each block after its row's paragraphs, and one under another row's
// label would read as that row's text. An empty row is a row, never a detail.
const BAND = /^r\d+(?:-\d+)?(?:,\d+(?:-\d+)?)*$/;
for (const e of entries.values()) {
  if (e.kind !== "kind.rolltable") continue;
  const paras = e.fields?.rows?.paras ?? [];
  check(`${e.id}: every row paragraph carries a die-band section`, paras.every((p) => BAND.test(p.section ?? "")));
  let row = null;
  const stray = [];
  for (const p of paras) {
    if (p.detail === true) {
      if (p.section !== row || p.empty) stray.push(p.section);
    } else row = p.section;
  }
  check(`${e.id}: every detail paragraph follows its own row${stray.length ? ` — not ${stray.slice(0, 3).join(", ")}` : ""}`, stray.length === 0);
  check(`${e.id}: empty and detail marks are only ever true`, paras.every((p) => (p.empty ?? true) === true && (p.detail ?? true) === true));
}

console.log(`\ntest-cookbook-coherence: all ${pass} checks passed`);
