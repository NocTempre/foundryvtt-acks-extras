# The PDF extraction toolchain — map and gotcha ledger

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

The one page an extraction task reads first. The pipeline's *principles*
(scans locate / recipes interpret, the audit gate, chef tiers) are
[RECIPES.md](RECIPES.md); the *schema* is [COOKBOOK.md](COOKBOOK.md); the
*rulings* with their evidence are [DECISIONS.md](DECISIONS.md). This page is
the map of what runs, and the ledger of how PDFs fight back. Per-book
physical observations (typography, art, staged paths) are LOCAL-ONLY:
`C:\Proj\acks-rules\acks-content\BOOK-NOTES.md`.

## The map

**Extraction engine (`scripts/`):** `extract.mjs` (pdf.js text extraction:
glyph runs, double-strike dedup, column detection), `table-extract.mjs` (row
binding, run joining), specialized extractors (`armor-tables`,
`weapon-tables`, `gear-prices`, `language-binding`, `builder-binding`,
`stats`/`stats-map`), `book-match.mjs` (entry location by normalized
heading), `executor.mjs` (runs compiled cookbook ops against the reader's
own book at runtime), `cookbook.mjs` + `recipes.mjs`/`table-recipes.mjs`
(the compiled program and its recipe layer).

**Pipeline operators (`tools/`):**

| Stage | Tools |
| --- | --- |
| Harvest | `harvest-page`, `harvest-index`, `harvest-conversions`, `dev-extract-check` |
| Register & recipes | `seed-entries`, `merge-recipes` (gate: re-executes every proposed recipe against the PDFs and rejects what does not materialize), `promote-candidates`, `promote-icons`, `build-chefdb` (SQLite view for chefs) |
| Audit | `audit-dump` (per-entry package for chefs), `audit-transcription`, `verify-cookbook`, `check-cookbook-drift`, `verify-against-compendium`, `lint-register`, `ledger-init` |
| Debug | `find-anchor`, `probe-table`, `dump-entry` |
| Gates | `check-prose-boxes` (a definition's prose must come from its own column), `test-*.mjs` executor suite, `test-cookbook-coherence`, `ip-scan` |
| Ship | `compile-cookbook` (register → shipped cookbook; per-book typography dispatch lives here) |

**The oracle:** `C:\Proj\acks-reference\WIKI-SNAPSHOT\` validates extracted
*structure* (column counts, row boundaries) — order and caveats in the synced
`.claude/rules/rules-lookup.md` and the snapshot's own README. Compare
`cookbook/*.json` (compiled ops), never `register/rr/*.json`.

**The chef kitchen (LOCAL-ONLY):** `C:\Proj\acks-rules\acks-content\` —
`PIPELINE.md` (prep/chef/architect tiers), `AUDIT_CHEF.md` (chef doctrine:
`assists` geometry overrides, locator rules, read `runs` before writing any
pattern).

## Extractor gotcha ledger

A running list: symptom → cause → where the fix or gate lives. **Add a row
whenever an extraction defect is diagnosed** — the row is a pointer, the
mechanics stay in the code comment, the ruling (if one was made) in
DECISIONS.md. Rows are never deleted; a superseded row says so.

| Symptom | Cause | Fixed / gated at |
| --- | --- | --- |
| A compile deletes thousands of entries and exits 0 | Content cookbooks span every book, so a book-scoped compile writes them holding that book alone | `compile-cookbook.mjs` refuses to write a content cookbook with fewer entries than the file on disk — checked for ALL of them before ANY is written |
| A name-keyed grid resolves one row, or none | The row walk judged a data row by its first cell being a number, true of every level table and false of a grid keyed on a name | `labelText` on the table recipe; `colsFromHeader` discovers the scale columns rather than authoring them |
| Headings read doubled ("eencountersncounters") | Faux-bold paints the glyph twice at the same coordinates | `scripts/extract.mjs` double-strike dedup (drop exact str,x,y duplicates) — must behave identically in compiler and runtime |
| A definition's prose comes from the wrong column | Sparse pages starve the column histogram (detector returns price-list edges instead of true columns) | `assists.columns` per-entry override; gate `tools/check-prose-boxes.mjs`; ruling in DECISIONS.md ("better detectors" rejected — they trade page sets) |
| Entry text carries stray margin letters, or loses real superscript ordinals | Margin tab glyphs vs superscript ordinals — both are small runs near an edge | Position rule (tab sits OUTSIDE the trimmed margin, ordinal ON a line; extent from body-height runs) — DECISIONS.md |
| An entry's tail is cut mid-sentence at a page boundary | Column-turn logic followed column turns but not page turns; subheading heuristics mis-fire on wrapped lines | Alone-on-line + face + body-size test; `assists.flowColumns` for continuation pages — DECISIONS.md |
| Price grid reads the wrong figure, or "1, 500gp" splits | Long names bleed into the price column; thousands separators split across runs | `scripts/gear-prices.mjs` (bled price wins; NAME_GAP; separator re-join) |
| A locator pattern matches the package but not the compiler (or vice versa) | Audit packages join runs WITH spaces, the compiler WITHOUT — and display capitals split mid-word ("P"+"ROFICIENCIES") | Locator doctrine: `\s*` between every word, read `runs` first — AUDIT_CHEF.md |
| Wiki-snapshot text won't fuse across inline tags ("II.1Character Templates") | The HTML extractor inserts a space at tag boundaries | WIKI-SNAPSHOT `tools/extract.py` + its README caveats |
| A geometry override half-applies | `assists.descStopY` suppresses column flow by PRESENCE, not value | AUDIT_CHEF.md known-gotcha list |
| Superscript ordinals fuse into words | joinRuns superscript-ordinal artifact | Noted in the abilities program (acks-content/ABILITIES_PLAN.md); check before writing prose patterns |
| An entry loses its last sentence, in some books only | `FOOTER_BAND` cut a fixed 32pt off every page foot, and books do not share a page design | Per-document footer profile learned from repeating furniture, per page parity, with the flat band as the fallback — `scripts/importer/extract.mjs` |
| A creature's introductory line is missing entirely | The standfirst is set between body and heading size and spans both columns, so neither the column walk nor the heading list collected it | `standfirstBoxFor` boxes it before the walk — `tools/importer/harvest-ose-book.mjs`; DECISIONS.md |
| An entry continuing overleaf swallows the next entry's opening | The end-of-region search looked only BELOW the entry point, and these books open every column with a heading set above `PAGE_TOP` | `takenAt` reads the same start list as a whole before the walk enters a column — `harvest-ose-book.mjs`, `harvest-ose-areas.mjs` |
| An ability printed across a column break imports only its first half | A table CAPTION passes every test the run-in `section` stop applies, so the flow ended there instead of turning the column | Caption + two gridded lines + a mid-sentence break = an interruption, not an ending — `compile-cookbook.mjs`; DECISIONS.md |
| A class intro ends mid-sentence, or runs past its own section heading | Section headings set in SMALL CAPS reach extraction shattered ("CO", "mbat"), so a per-run name match never fires and the intro falls back to a fixed 300pt window | Earliest of three signals: per-run name, rejoined-line name, display height at the column edge — `compile-cookbook.mjs`; DECISIONS.md |
| A description materializes to a single hyphen | Statlines and prose sit at different left edges; detection votes the statline edge and the fixed hanging allowance puts the window right of every prose line | `assists.columns` / `assists.flowColumns` per page — the OSE harvester has no equivalent override, so its cases are ledgered in `tools/importer/prose-stops.json` |
| A description stops mid-sentence and nothing says so | Only the START of a description was gated | `tools/importer/check-prose-stops.mjs`, ratcheting on `prose-stops.json`; runs in `npm run validate`, skips without the PDFs |
| An OSE page detects as ONE column: a heading on the left ends a passage on the right, and a stat-block header row lands where a description belongs | `detectColumns` votes on where body runs start, and a lopsided page carries a single column home | SUPERSEDED 2026-09-09 by the row below — the cause is stated too weakly, and the "NOT fixed" verdict no longer holds. Was: a per-page column override built and rejected, cases ledgered in `tools/importer/prose-stops.json` |
| A page whose type is finely set reports one column while printing two | `detectColumns` counts the runs that START a line in the numerator and EVERY body run in the denominator, so its 8% bar asks for between 17.7% and 54.7% of the page's lines depending on how many runs the page sets per line | A line-based rescue pass beside the untouched histogram, gated on the page's own extents (line-start floor, solo baselines, measure, neither gutter crossed) — `scripts/importer/extract.mjs`; DECISIONS.md |
| A run at the left of a line is swallowed by a segment that began to its right | Printed lines were rebuilt from a page-wide `y` then `x` sort, which leaves x out of order inside a baseline tolerance band | `textLines` sorts each line's runs by x before joining them — `scripts/importer/extract.mjs` |
| Two or three neighbouring OSE entries carry an identical prose region and import the same passage | A column carrying the tail of an entry begun on an earlier page STARTS nothing, so the walk reads it as free and hands it to everyone | NOT fixed — the walk needs inherited occupancy, and one column can be a continuation above a parallel group below; ROADMAP.md |
