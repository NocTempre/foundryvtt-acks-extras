# Parse once, read everywhere: plan

In-flight plan (docs-doctrine wip/): its substance moves into MODEL, DECISIONS and TESTING when the feature lands, and this file is deleted then.

## Owner answers (2026-11-18)

- The owner chose the approach: "Parse once, read everywhere".
- Persist the text layer: "Yes, save it". S1 and S2 are both built.
- Books already shelved: "On first read". The first GM seat needing a book's text parses it; there is no background backfill.
- Books tab: "Add state + control". S4 shows a prepared or stale state per row and a "Read again" control, after a /design board is approved.
- Timing: "In the minor". The minor waits for S1–S4.

## Correction to the request

The join never parsed text. `restoreShelf` fetches each whole PDF and opens it with pdf.js (`getDocument`, `getMetadata`) on every seat. Text is extracted only at import. S1 removes the join open; S2 makes the import-time parse happen once per book for every GM seat.

## Design (architect, 2026-11-18)

### Parse once, read everywhere (importer)

Owner: "Parse once, read everywhere". Tree: `topic/parse-once`.

**1. Consumers, by what they read**

- *Text layer* (runs, page size, numPages, Title): imports and repairs via `executeEntry` → `extract.mjs` `pageItems`/`footerProfile`; whole-book scans (`tables-binding.mjs`, `armor-tables.mjs`, `gear-prices.mjs`, `weapon-tables.mjs`); `cookbookDebug`, the audit; `browseAndLoad`, `fillMonster`; the hire's `resolveAbilities` → `importAbility`, on the GM seat via the `hiringOutcome` relay.
- *Pixels / operator list*: the `art` op (`pageArtInfo`, skipped when the file is on disk, `actor-import.mjs:81`); art cuts (`uploadPageArt`); scene pictures (`uploadSceneMap`); wall trace (`traceSceneWalls`); `pageArtPlacements` (`adventure-maps.mjs`, even with the picture cached); OCR (`picture-text.mjs` `withEngine`, its own copy from `doc.getData()`).
- *Bytes*: sheet export (`blank.mjs` → `bookBytes`; `form.mjs` `fillForm`); `shelveOpen`.
- *Metadata*: fingerprint and wrong-book refusal (`ingestBook` → `identifyBook`; forms `readForm`); `sessionDocs.has` gates, including the delete licence `rebuildVerdict` (`rebuild.mjs` `rebuildable`) and `readableHere`; `bookOpened` (one listener, the sheet window).

**2. The saved form**

- One JSON file per shelved book, staged file and stamp, `acks-extras-books/parsed/<book>-<stamp>-<attempt>.json`, by `FilePicker.upload`. Header `{book, stamp, src, bytes, numPages, title, fonts}`; per page `[w, h, runs]`, a run `[str, x, y, w, h, font, sp]` at full precision after `textRuns`; placements for pages a scene recipe names.
- It holds what `pageItems` consumes: furniture, typography and `fuseRuns` still run at read, so `extract.mjs` and registry edits never invalidate it. Stamp = `PARSE_SCHEMA` (bumped with `textRuns` or the shape) + pdf.js `version`.
- Commit = pointer flag `flags["acks-extras"].parsed = {stamp, file, src, bytes, numPages, title}` on the shelf journal; current while `src` matches the PDF page and the stamp is current. The page remains the record (2026-09-03).
- Foundry never overwrites a non-media file and has no delete: each attempt is uniquely named; stale files stay.
- Readable by anyone who learns the path, like the PDF (2026-08-21). Only shelved books are parsed; forms never.

**3. Who parses**

- The first GM seat needing a book's text with no current parse, or the staging seat once the fingerprint passes: fetch, fingerprint, parse every page, upload, write the pointer.
- Correctness needs no election: racing GM seats write identical, distinctly named files; the pointer's last write wins. One in-flight promise per book. `executeAsGM` runs locally on any GM (`lib/sockets.mjs`); `primaryGMSettled` serves only a backfill.
- A player seat never parses. Only the form is read there (2026-10-28); lacking a parse it opens live, saving nothing.

**4. Two states, and the live PDF on demand**

- *Registered* at join: `restoreShelf` puts a doc-shaped `BookHandle` (new `scripts/importer/book-handle.mjs`) in `sessionDocs` for each observable shelved book, fetching nothing, and fires `bookOpened`. Sync `numPages`/`title` come from the pointer, else the registry row, until an open. T-0675's race cannot occur.
- *Verified*: a current pointer whose `src` answers one HEAD with its `bytes`, or a live open fingerprinted this session. A 404 or a mismatch refuses the book; no `content-length` checks presence only. Reads verify before their first page; a failure returns `book-closed` (`readForImport`, `repairFromEntry`). Deletes ask verified: `rebuildable` and `readableHere` read `handle.verified`, and each repair entry in `rebuild.mjs` verifies its scope first.
- The handle: text-only `getPage(n)`, `getData()` (fetch of `src`), `live()` (fetch, `openBook`, fingerprint; single-flight), `destroy()`. The pixel functions in `extract.mjs` start with `doc = await liveDoc(doc)`; `pageArtPlacements` tries saved placements first. A live document is held for the run (a scope like `holdingReads`, taken by the chain and each repair), then released after an idle grace.

**5. Slices** (implementer each: scoped, design fixed here; walked on `main` after landing)

- **S1 Nothing opens at join**: `book-handle.mjs`, `module.mjs` (`restoreShelf`, `ingestBook`, `bookBytes`), `extract.mjs`, `cookbook/read.mjs`, `rebuild.mjs`, `getting-started.mjs`. Tests: `test-shelf-restore`, `test-book-lifecycle`, new `test-book-handle`. Recipes: "The shelf opens…" becomes no `.pdf` fetch and no worker at join on Player and GM; the first import fetches one PDF; a repair over a book whose file is gone deletes nothing. Character-sheet steps 13–14: Export fetches `sheet.pdf` on press. DECISIONS entry, MODEL section, changelog fragment.
- **S2 Parse once**: new `parsed-book.mjs`. Local gate `tools/importer/check-parse-parity.mjs`: every page's `pageItems` and every entry's node deep-equal, live vs saved. Recipe "A book is prepared once" (fixture `importer/parse-fresh`, a small book at a fresh path): the first import fetches one PDF and uploads once, and the file's digest equals the gate's; after reload no PDF fetch and an identical node; two racing GM seats leave identical files. DECISIONS, MODEL, changelog.
- **S3 Placements and drift**: an Adventure rebuild with pictures cached fetches no PDF; a re-pointed page re-parses.
- **S4 Books tab** (/design first): "Read from the server on every launch" is no longer true; prepared/stale state and a re-read control if wanted; guide.

**Supersedes in part** (all over 7 days old): 2026-10-28 and 2026-08-21, the join-time open; 2026-08-24 "Imported text…", "connecting is an open and a fingerprint"; `module.mjs`'s header "the book's text never does". **Stand:** 2026-07-29's byte-cache rejection (a parse counts only while the staged file answers); 2026-11-10's delete licence, now asked of verified; 2026-10-29, read off the verified copy; 2026-11-13's OCR ruling, its bytes fetched from `src` (evidence: N×M join opens, today's reopen race).

**6. Counter-argument and rejections**

*Strong:* S1 alone meets the join goal with nothing persisted. The end state still wins, because its gains recur every session: no 52–103 MB fetch and open per book touched, table scans in memory, a hire reading 7 MB, one parse for every GM seat.

*Rejected:* world documents or flags, a compendium, IndexedDB, saving `pageItems` output, decoding every page's images, uploading an unstaged book, the upload refusal as a lock, parsing at join.

## Open items for the builder

- Inferred and unmeasured: that a HEAD request returns `content-length` for PDFs on a host that redirects, and that a browser parse matches a Node parse byte for byte. S2's digest step measures the second.
- Costs for DECISIONS: stale parse files pile up, since Foundry has no delete. A same-length replacement at the same path goes unnoticed. The first read after the upgrade pays one fetch and one whole-book parse (14–46 s offline). The JSON is as readable as the PDF.
- S1 removes the join pass that the T-0675 guard protects; the guard may be deleted.
- `topic/importer-books` (Treasure Tome) is also in `scripts/importer/`. Sync before each slice.

## Results
- 2026-11-18: S4 board drawn: https://claude.ai/artifact/VsjqZLqa1Q8LNqEZJdiNho ("Parse once: Books tab"). The owner answered:
  - The board: "Approve, build it", taking the designer's recommendations. The closed fold shows stale and refused counts. A Refused row offers Remove only. A press's result shows as a notification. There is no confirm before reading, and Remove is disabled while a read runs. Players see the state lines.
  - When and by whom: "No, keep it simple". The pointer stays `{stamp, file, src, bytes, numPages, title}`.
  - Label: "Read now / Read again". "Read now" shows when no text is prepared, "Read again" otherwise.
  - File check: "Only when touched". Refused shows only after an import, a repair or a press this session.
  - The board also rewrites `statusNote`, which says the file is never stored and becomes false after S2.
