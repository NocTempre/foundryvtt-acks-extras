# The Recipe Pipeline — register, promotion, and authoring (design, consolidated)

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

Original design content (in-repo). This spec covers the **offline pipeline**:
how agents turn the ACKS PDF library into the shipped **cookbook**. The
cookbook's data format and frozen instruction set live in `COOKBOOK.md`;
how an engine consumes it lives in a per-consumer binding spec
(`BINDING-FOUNDRY.md`). Read all three; this one governs authoring.

```
OFFLINE authoring (agents + resolver + ANY tooling, vs the reference library —
                   ALL intelligence lives here)
   │  harvest → author → promote → verify → COMPILE
   ▼
COOKBOOK  (ships public; engine-agnostic database; IP-free resultant map:
           explicit instructions + extraction assists — NO prose, NO values)
   │  consumed by an engine binding (today: the acks-extras Foundry module,
   │  a DUMB EXECUTOR — no decision trees)
   ▼
RUNTIME   values AND prose/art materialize from the seat's own PDF exactly as
          instructed; stub + citation otherwise
```

## Governing principles

1. **Dumb runtime, smart cookbook.** If it takes a judgment about content, it
   happens offline and ships as data. Runtime conditionals are mechanical only
   (is the book connected? does this id exist?). No detection, inference,
   normalization, or promotion in the app.
2. **Values are assisted heavily, never prebaked.** A stat block is a
   *compilation* — its selection/arrangement of values is grey-zone IP — so the
   cookbook never ships a value read from a page (numbers, enum tokens, derived
   booleans). It ships **assists** that make the runtime read deterministic:
   exact spans, parse patterns, token→key tables, color→meaning maps. Values
   the GM imports persist in their **world** (the hand-typed-stat-block
   equivalence lives there, never in the shipped map).
3. **Helper data is not IP.** Coordinates, claim spans, join/break/hyphen
   fixes, reading-order maps, color-derived tables — derived structural
   metadata reproduces nothing without the source. Prose repairs ship as
   *transformations*, never corrected text; literal strings only under the
   short-label cap (~60 chars: names, labels, headings).
4. **Total capture.** Every text run on every page maps to a node or an
   explicit recorded skip. Line coverage (no unclaimed items after all of a
   page's nodes apply) is the authoritative completeness check; the book
   outline is only the coarse checklist.
5. **The register is a normalized database built by iterative ETL** (~one book
   a year): nodes are rows, references are foreign keys, promotion is upsert,
   each book is a batch, editions are revision rows, and a **resolver agent**
   supplies the judgment pure rules can't.

## The audit gate — scans locate, recipes interpret

The ability pipeline carries two seat-side prose scans (`effectScan`,
`rollScan` in `scripts/executor.mjs`) that classify mechanics out of the
reader's own extracted text. They exist to draft classifications while the
register matures, and they are in open tension with principle 1:
classification is inference, and inference in the runtime is exactly what
this design forbids. The doctrine that contains them:

1. **Scans locate; recipes interpret.** A generic scan may propose candidate
   structure — a throw target, a modifier digit, a rank ladder. What a number
   *means* — sign, direction, replace-vs-add, whose penalty it is, how many
   rolls an entry offers — is a judgment, and judgments are chef work, baked
   per-entry into the register (`effects` specs with `from.pattern` locators,
   roll recipes, `assists`). Blind Fighting is the canonical case: the page
   prints a −2 that is a net *bonus*, because it replaces a −4. No scan knows
   that; the recipe does.
2. **Never invent a rule.** If the book does not state it as mechanics, it
   ships as explainer text or not at all: no inferred stacking relations, no
   paraphrased labels, no guessed conditions presented as fact. (Structural
   conclusions the pipeline itself defines — an alias is one capability under
   two names, so it does not stack with its target — are ours to ship.)
3. **Never generalize a fix across entries.** When an audit finds a defect,
   fix THAT entry. The instinct to write a pattern that "systematically fixes
   all entries with that language" is the standing failure mode of this
   project, and the tell is that exact sentence: it converts one verified
   reading into an unverified claim about entries nobody looked at. It feels
   like leverage and it is the opposite — book language is not a schema, so a
   pattern that is right on the cases you checked is unfalsified, not
   correct, on the ones you didn't.
   *Worked example (2026-07-18).* A sampled audit found Caving missing its
   `repeatable` flag. The fix shipped as a regex over every entry's body
   text; it set the flag on twelve, and all twelve were true — which hid the
   real damage. Six of those twelve state a per-rank PROGRESSION in the very
   sentence that was matched ("each time improving the proficiency throw",
   "learning an additional three languages each"), and two of them (Language,
   Magical Music) had NO extracted mechanics at all. Flattening them to one
   boolean made six broken entries look handled. The pattern also had no
   negation guard, so "cannot be selected multiple times" would have set
   `repeatable: true` — it simply never appears in the RR.
   A structural fix to the EXTRACTOR (a bug in how columns flow, a heading
   that shares a run) is not this: that repairs mechanism, and its blast
   radius is visible in the diff. Writing meaning — flags, values, labels,
   relations — is per-entry, always.
4. **Scan output is a reading prompt, never a conclusion.** Where a pattern
   over book text is genuinely useful, it reports candidates
   (`metaCandidates`, the `replacedBy` phrase check) so a chef reads that
   entry and authors the flag in the register. The register is the only
   source of authored meaning; the compiler merges nothing into it. A
   candidate report and a conclusion look identical in the artifact — which
   is precisely why the pipeline must never let a scan write one.
5. **Draft output presents as draft.** Every compiled entry is `unaudited`
   until its register row carries an `audited: "<date>"` sign-off. The
   compiler ships the flag, the binding stamps it on the item, and the sheet
   shows it on the Mechanics and Rolls tabs. Wrong-but-plausible mechanics
   must be impossible to mistake for the book's ruling.
6. **Audit is tracked state, not vibes.** `audited` means a chef read the
   entry's *full materialized output* against the printed page — description
   bounds, every effect, every roll, every limitation, nothing extra and
   nothing missing. Having authored a spec is not a sign-off; fixing one
   defect is not a sign-off. The compiler prints the burn-down
   (`chef-audited: N/M`) at every build, and release notes cite it.
7. **Recipes are authored by a chef tier, and merged through a gate.** The
   audit finds defects; most of them are missing or misread mechanics that
   only a per-entry recipe fixes. Chefs (a capable model, instructions with
   the local authoring docs) read an entry, decide what it means, and write
   the recipe — structure and locators only, never a value off the page.
   They propose; they never touch the register and never set `audited`.
   `tools/merge-recipes.mjs` re-executes every proposed recipe against the
   reference PDFs with the shipping executor and REJECTS any that does not
   materialize what it claims. A chef saying its locators work is not
   evidence; the gate re-derives it. Merging makes an entry correct —
   signing it off remains a separate act after reading the result.
8. **The audit is tiered.** A first-pass worker (a smaller model, per the
   established authoring split) compares each entry's full materialized
   output against the printed page under a fixed checklist
   (`tools/audit-dump.mjs` builds the per-entry package; the checklist lives
   with the local authoring docs). The worker may confirm only clean
   mechanical matches — anything involving interpretation (replace/set
   modes, conditionals, multi-roll entries, tables, progressions, aliases,
   or any discrepancy or doubt) escalates to senior review, which also
   samples the worker's passes. Escalation triggers ratchet: only the senior
   reviewer may relax one, one written rule at a time. Worker-confirmed
   entries record `auditor: "first-pass"` in the register beside `audited`;
   senior sign-offs record none.
9. **Pilot checks sample around a fixed canon.** A recurring verification
   (extractor smoke tests, audit spot-checks) keeps a canonical example list
   that runs every time, plus a few randomly-drawn entries per run. A new
   error class found in a random draw is promoted into the canon so it can
   never regress unseen; all-canon runs drift into checking only what once
   broke, all-random runs cannot prove yesterday's fix still holds.
10. **End state.** Per-entry recipes displace scan output entry by entry; the
   scans remain a first-draft aid whose output is always flagged. When every
   shipped entry is audited, the scans demote to authoring-side tooling and
   principle 1 holds in full again.

## The node model

Every line of every page belongs to a **node**. Roles:

- **Composite** — a game entity assembled from fields and references (monster,
  NPC, location, item). References definitions **by id**; never carries their
  pages or prose. Field *keys* are refs too (attribute/save *names* point at
  descriptor nodes; only the number is a seat-extracted value).
- **Definition** — a thing referenced repeatedly (proficiency, damage type,
  magic property, spell, class, attribute, save, **procedure** = named
  multi-step rule). Owns its defining page link(s); defined once.
  - **Example** (sub-role) — a worked example, presented once, relevant
    everywhere its concept is used. Carries `illustrates: [conceptId…]`;
    surfaced contextually via concept→examples reverse lookup.
- **Note** — non-game text captured for completeness (credits, backer list,
  colophon, sidebar flavor). Same machinery, flagged non-game (binding routes
  it to a journal — the "memorial wall").
- **Table** — a printed table; consumed structurally (binding may route to a
  roll table or journal).

**Ids.** Composites are book-scoped: `mm.griffon`, `mm.beetleGiantBombardier`.
Definitions are register-scoped (edition-independent): `def.<class>.<slug>` —
`def.prof.alertness`, `def.type.monstrosity`, `def.dmg.slashing`,
`def.nw.talon`. Every node may carry `aliases: [oldId…]`; ids are forever once
shipped (world documents persist them), so merges/renames redirect via aliases,
never break.

**Editions.** A definition's pages live under `editions` — the same concept may
be detailed in ACKS I and revised in ACKS II:
`{ "editions": { "acks1": {book, pages}, "acks2": {book, pages, revises: "acks1"} } }`.
Resolution prefers the newest edition the seat owns and falls back to the
original for unrestated detail. Cross-book and cross-edition references are the
normal case; every tier degrades to a stub, never an error.

**Graceful degradation (three independent tiers).**
1. *Structure & refs — always*: the graph renders bookless as stubs+citations.
2. *Values — with the citing book*: materialized via assists, deterministic.
3. *Descriptor prose — with the defining book* (whichever book that is).
Registry-miss (unknown token → keyword, no ref) and book-not-owned (known id →
stub) are orthogonal degradations; neither can fail.

## Registers and promotion

`register/` is the pipeline's source-of-truth database (see Layout). Reference
registers come in three shapes: **open name-indexed** (proficiency name → def
node), **descriptor enum** (small set, each value a def node with pages —
tooltip-able), **keyword enum** (repeated tag, no descriptor, no tooltip —
e.g. monster subtypes).

**Register promotion** is the load-bearing mechanism: the first time any
cross-cutting thing is met (keyword, descriptor, proficiency, procedure,
example, kind), it is promoted to a register row and referenced by id forever
after. Reuse-check → link-or-promote; idempotent; dedup on the normalized key;
conflicts flagged, never silently forked; coverage-tracked (a promoted row
missing its page link is a warning). **Ambiguity escalates to the resolver
agent** (fuzzy/renamed match, variant-vs-new, same-key/two-pages, revision-vs-
new); its ruling is recorded on the row. Promotion is **offline only** — the
shipped cookbook is read-only; a token it doesn't know renders as plain text
until the next release. A worker's miss degrades to a keyword row, never a
failed batch.

**Kinds are register rows too** (`register/_kinds/`): a kind is a learned
structural signature + field template (authoring-side compression and
contextual understanding). Minting a new kind is resolver-gated (high blast
radius). The runtime never interprets kinds — the compiler flattens each entry
into explicit instructions; the binding maps kinds to engine documents.

## Seeding and coverage

`tools/harvest-index.mjs <book> --write` walks the book's own page-accurate
outline into `register/_manifest/<book>.json` (local, regenerable): the
must-define list and coarse coverage denominator. The MM yields 281 monster
entries with exact pages, the descriptor enums pre-located (Monster Types →
p11–12), 87 tables, and **974 book-authored sub-blocks** (Combat / Ecology /
Spoils per monster) — the labeled ground truth for paragraph/block
segmentation. Fine-grained coverage is the **line-coverage residue** reported
by verify: unclaimed items per page → toward zero; residue is triaged into new
nodes (often notes) or recorded skips (page furniture).

## Authoring-side senses (offline — anything goes)

Nothing authoring-side ships, so use every signal: pdf.js text items
(+`hasEOL`), y-gap/indent paragraph analysis, the **operator-list color walk**
(proven: MM legend p14 shows the same 13 damage glyphs under body-black
`#2c2e35` = mundane and red `#ff2e17` = extraordinary; maroon `#61122f` =
display headings; white = table headers), image XObjects, and any external
tool (PyMuPDF etc.). Structure trees are absent (untagged PDFs), so
segmentation is heuristic — calibrated against the 974 outline blocks. The
*conclusions* ship as assists; the executor performs instructed reads only.

## Pipeline stages (per wave)

1. **Seed** — manifest from the outline; ledger batches (`register/_ledger.json`).
2. **Author** — a worker per page-batch: harvest report → register entries
   (id, kind, pages, anchor, per-entry assists) + register upkeep (reuse-check;
   keyword rows; page links when authoring the defining page) + note nodes for
   non-game text. Escalate ambiguity to the resolver agent; never transcribe
   prose (harvest snippets are diagnostics).
3. **Promote/merge** — workers write register proposals; the orchestrator (with
   the resolver agent) merges into `register/_refs/**` between waves.
4. **Compile** — `tools/compile-cookbook.mjs` resolves every entry against the
   reference PDFs into explicit geometry-addressed instructions and emits the
   cookbook (see `docs/COOKBOOK.md`).
5. **Verify** — `tools/verify-cookbook.mjs` executes the compiled cookbook
   through the **shipping dumb executor** against the reference PDFs: expect
   checks, value materialization, ref FK integrity, per-page residue. Warnings
   for unfilled descriptor stubs; failures for broken instructions.
6. **Gate** — lint (`tools/lint-register.mjs`, inside `npm run validate`)
   enforces the IP caps and schema on everything that ships.

## Layout

```
register/                  source DB (authored, committed)
  <book>/p<a>-p<b>.json      entry rows per page batch
  _kinds/<kind>.json         kind rows (learned templates)
  _refs/<registry>.json      reference registers (open/descriptor/keyword)
  _manifest/<book>.json      outline seed (gitignored, regenerable)
  _ledger.json               wave ledger (gitignored)
  _proposals/                worker register proposals (gitignored, merged)
cookbook/                  compiled shipped artifact (committed)
  <book>.json                per-book entries (instructions)
  registers.json             tables + definition nodes
docs/COOKBOOK.md           cookbook schema + frozen instruction set
docs/BINDING-FOUNDRY.md    how the Foundry module consumes the cookbook
```

## What Opus builds vs. what Sonnet authors vs. the resolver

- **Opus (once):** the specs, the compiler, the executor + instruction set, the
  verify/lint gates, kind rows' initial shape, register schemas.
- **Sonnet (per page batch):** entry rows, per-entry assists, register
  proposals, note nodes, residue triage. Judgment over harvest reports — never
  re-implementing extraction, never copying prose.
- **Resolver agent (per merge):** adjudicates promotions — link vs promote vs
  revise vs alias-merge; rulings recorded on rows.

## Implementation status (2026-07-17)

- **Built and pilot-proven** (mm p170–178, 9 monsters): `register/` layout +
  seeds; `tools/compile-cookbook.mjs` (anchor/column resolution on the MM's
  mirrored spreads, paragraph segmentation, per-stat boxes with baseline-skew
  shift, executor-parity space/hyphen fixes, glyph→color pick matching by
  position, margin/running-head skips); `scripts/executor.mjs` (frozen
  instruction set v1); `tools/verify-cookbook.mjs` (expects, values, FK +
  stub warnings, promotion candidates, residue/DUP ledger);
  `tools/lint-register.mjs` in `npm run validate`; fleet runbook + worker
  prompt. Registers grow by the promotion loop (verify candidates → upserts).
- **Not yet:** the swarm run itself; note/table kinds (residue currently
  flags the per-monster "Primary Characteristics" tables — by design);
  compound-type tokens (e.g. "Enchanted Monstrosity" — needs a typeList
  pattern); the Foundry binding rewire from the PoC recipes to the cookbook
  (docs/BINDING-FOUNDRY.md); ACKS I books in `scripts/books.mjs` for edition
  chains; per-entry `assists` consumption for authored overrides (schema
  reserved; compiler flags cases via warnings today).

## Authoring an alias

An `aliases` entry records a SECOND PRINTED NAME for a definition this module
already ships — nothing more. It carries no number, no table of options and no
sentence, so it is on the same footing as the `name` beside it; the same
posture the equipment phrase register was chartered under (DECISIONS,
"Authored equivalences").

Two rules, both gated by `lint-register`:

- an alias may not repeat its own entry's name;
- an alias may not collide with any other entry's name or alias. Two entries
  sharing a printed NAME is ordinary and is arbitrated by category rank at read
  time; an alias in that collision is not, because an alias exists precisely to
  make one short form resolve.

What a gate cannot check, and a reviewer must: that the alias is a form the
book actually prints, and not a convenience spelling invented here.
