# Authoring fleet — orchestrator runbook (cookbook pipeline)

How the Opus orchestrator drives Sonnet workers + the resolver agent to turn
the ACKS PDF library into the shipped cookbook. Governing specs:
`docs/importer/RECIPES.md` (pipeline/register), `docs/importer/COOKBOOK.md`
(shipped schema + frozen instruction set), `docs/importer/BINDING-FOUNDRY.md`
(consumer). Everything runs from `C:\Proj\foundryvtt-acks-extras` and needs
the LOCAL-ONLY reference PDFs at `C:\Proj\acks-reference` (never CI).

## npm commands

```
npm run harvest:index -- mm --write   # seed: book outline -> register/_manifest/mm.json
npm run harvest -- mm 170 178         # structural report for a page window (authoring sense)
npm run ledger -- mm 25 350 10        # (re)build register/_ledger.json batches
npm run compile -- mm                 # register -> cookbook/ (needs PDFs; ALL judgment here)
npm run verify:cookbook -- mm 170 178 # execute via the SHIPPING executor vs PDFs (gate)
npm run lint:register                 # IP + schema gate (no PDFs; runs in CI via validate)
```

## Roles

- **Orchestrator (Opus):** owns the ledger and the registers. Dispatches
  batches, merges register proposals between waves, re-runs compile+verify,
  re-queues failures. Never lets two workers own overlapping pages.
- **Worker (Sonnet, one page-batch):** judgment over harvest reports — author
  register entry rows + per-entry assists, propose register additions, flag
  notes/skips for residue. Never re-implements extraction; never transcribes
  prose (harvest snippets are diagnostics).
- **Resolver agent:** adjudicates ambiguous promotions during merge (fuzzy or
  renamed names, variant-vs-new, same-key/two-pages, edition revision,
  kind minting). Rulings are recorded on the row (aliases, editions).

## Wave loop

0. **Seed:** `npm run harvest:index -- mm --write`; `npm run ledger -- mm <a> <b> 10`.
   The manifest is the coarse must-define list (281 MM monsters, descriptor
   enums pre-located, 87 tables, 974 book-authored blocks).
1. **Dispatch:** for each `pending` batch, spawn a worker with
   `AGENT_PROMPT.md` filled in (`{BOOK}`, `{START}`, `{END}`, `{FILE}`).
   Modest concurrency (~4-5); PDFs are read-only.
2. **Worker output:** `register/{FILE}` (entry rows) + proposals in
   `register/_proposals/<batch>.json` (new tokens/nodes/kind suggestions) +
   its final report (entries, skips, NEEDS-REVIEW items).
3. **Merge:** orchestrator + resolver agent fold proposals into
   `register/_refs/**` (idempotent upsert; conflicts -> resolver ruling).
4. **Gate:** `npm run compile -- mm` then `npm run verify:cookbook -- mm <a> <b>`
   then `npm run lint:register`. Green -> ledger `verified`. Failures or
   unexplained residue -> re-queue the batch with the report attached.
5. Repeat until the ledger is all `verified`; residue per page trends to zero
   (remaining unclaimed items become note nodes or recorded skips).

## Line-coverage discipline

`verify:cookbook` reports RESIDUE (unclaimed items) and DUP (cross-entry
double-claims) per page, plus promotion candidates (unknown tokens) and FK/
STUB warnings. Residue is the authoritative completeness check — the manifest
can't list what the outline never bookmarked (backer lists, sidebars). Triage
every residue line into: a new node (often a note), a register fix, or a
recorded skip. Never silently drop.

## MM field guide (from structural scans)

- ~75% of monster pages: one display heading, one stat block — clean.
- Multi-monster spreads (e.g. p62/63 Beetle) — one entry per display heading.
- Parent + variants (BEETLE, GIANT -> BOMBARDIER/LUMINOUS) — separate entries;
  variant ids like `mm.beetleGiantBombardier`.
- `isMonsterPage` with no display heading (p28/31/37/61) — stat block whose
  name is elsewhere: multi-page monster (`pages: [a, b]`) or facing-page name.
- Garbled all-caps display text (`M O NSTER LISTI N…`) — letter-divider
  ornament: margin furniture, skip.
- MM spreads are MIRRORED: stats sit on the outer half (left col on even
  pages, right col on odd pages); the compiler handles this — workers only
  flag pages where compile warns.
