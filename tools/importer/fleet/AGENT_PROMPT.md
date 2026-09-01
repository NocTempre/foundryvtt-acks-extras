# Sonnet worker prompt — register authoring (one page batch)

Template the orchestrator fills per batch (`{BOOK}`, `{START}`, `{END}`,
`{FILE}`) and passes to a Sonnet subagent. The worker's job is *judgment over
structural reports*: author register rows and register proposals. The compiler
and executor do all extraction — you never re-implement it and never copy
prose.

---

You are authoring ACKS register entries for the acks-extras importer
subsystem's cookbook pipeline, pages **{START}–{END}** of book `{BOOK}`. Work
only in `C:\Proj\foundryvtt-acks-extras`.

## Read first (in this order)
- `docs/importer/RECIPES.md` — the register/node model you are producing.
- `docs/importer/COOKBOOK.md` — what the compiler emits from your rows (context only).
- `register/_kinds/` — existing kind rows; `register/_refs/` — existing
  registers (reuse before you propose).
- `register/_manifest/{BOOK}.json` — the outline seed: expected entries +
  book-authored blocks for YOUR pages.

## IP rules (non-negotiable)
- You write **pointers only**: ids, kinds, pages, anchors (short headings),
  assists, register tokens. Never book prose, never sentence-length strings.
  Harvest snippets/word-counts are diagnostics — never transcribe them.
- Everything you write must pass `npm run lint:register` (60-char caps).

## Procedure
1. `npm run harvest -- {BOOK} {START} {END}` (set `HARVEST_NO_ART=1` for speed)
   and read your manifest slice. One monster = one resolving display heading;
   stat-label run-ins are not entries; letter-divider ornaments are furniture.
2. Author `register/{FILE}`: one row per entity —
   `{ "id": "{BOOK}.camelSlug", "kind": "kind.monster", "book": "{BOOK}",
      "pages": [N], "name": "Title Case", "anchor": { "display": "EXACT HEADING" } }`
   Multi-monster pages: one row each. Multi-page monsters: `pages: [a, b]`.
   Variants under a parent: separate rows, id like `{BOOK}.parentVariant`.
   Non-game text (sidebars, dedications): rows with a note kind — if no
   fitting kind exists, put a kind PROPOSAL in your proposals file instead of
   minting one yourself (kind minting is resolver-gated).
3. **Register upkeep as you go** (reuse-check → link-or-propose): unknown
   subtype/proficiency/property tokens for YOUR pages go into
   `register/_proposals/p{START}-p{END}.json` as
   `{ "registry": "...", "token": "...", "suggest": { "key": "...", "ref": "def...." }, "definingPage": N? }`.
   Never edit `register/_refs/**` directly — the orchestrator merges.
4. Gate your batch: `npm run compile -- {BOOK}` then
   `npm run verify:cookbook -- {BOOK} {START} {END}` then
   `npm run lint:register`. Iterate until: 0 failures, and every RESIDUE line
   for your pages is triaged (fix an entry, add a proposal, or list it as
   NEEDS-REVIEW with page + symptom). Compile warnings about YOUR entries
   (unmatched color runs, unclaimed items) must be resolved or reported.
5. Do not touch pages outside your batch, `register/_refs/**`, `_kinds/`,
   `cookbook/registers.json`, or other batches' files.

## Deliverable (final message back to the orchestrator)
- entries authored (count) + pages covered;
- proposals filed (registry: token, count);
- residue status per page (zero / triaged-as / NEEDS-REVIEW);
- verify + lint output summary (must be green or explained).
