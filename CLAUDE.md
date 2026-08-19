# Extras (acks-extras)

Foundry VTT module for the ACKS II system (`acks`), part of the NocTempre ACKS
module family. Canonical conventions and shared toolchain:
`C:\Proj\acks-module-template` — read its `docs/TOOLCHAIN.md` before changing
build/release plumbing, and its `docs/DECISIONS.md` before a structural change.

## Where a lesson lands

When something worth keeping is learned, walk down and stop at the first match:

1. It recurred despite being written down → make it a **gate** (a validate
   rule, a hook, a preflight check) and delete the prose it replaces.
2. True of every repo, durably → the template: `docs/TOOLCHAIN.md`, or a
   synced `.claude/rules/` file.
3. True of this repo → `docs/<feature>/` (MODEL / DECISIONS / TESTING), or
   this repo's docs.
4. True only of this machine → `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.
5. Tentative or unconfirmed → auto-memory, until it earns a tier above.

Never state it in a second place — write a pointer. Promoting a lesson means
**moving** it, not copying it.

## Sizing the task

Five synced agents (`.claude/agents/`) carry the model/effort routing —
`scout` (haiku: search/inventory), `implementer` (sonnet: scoped changes),
`architect` (opus: design/diagnosis, read-only), `live-tester` (sonnet:
drives the test world), `doc-scribe` (haiku: docs chores).

- Typo, doc line, pointer fix → do it inline; no plan, no subagent.
- Lookup or inventory ("where is X", "list all Y") → `scout`; never spend a
  frontier model on grep.
- Docs-tree chores (gallery rows, changelog drafts, index fixes) →
  `doc-scribe`.
- Mechanical multi-file change → `scout` enumerates, `implementer` applies;
  the enumeration is the review.
- Runtime-surface change → implement, then walk the feature's
  `docs/<feature>/TESTING.md` recipe live (`live-tester`) before it ships.
- Architecture, cross-feature design, reversing a documented decision, or a
  bug that resists first diagnosis → `architect` or plan mode first; the
  write comes after the ruling.

## Layout

- `scripts/` — ESM runtime, entry `scripts/module.mjs`; `templates/` — .hbs;
  `styles/`; `lang/en.json` — flat i18n keys under root(s) `ACKS-CLASSES, ACKS-LIB, ACKS-ABILITIES, ACKS-EQUIPMENT, ACKS-FORMATION, ACKS-HENCHMEN, ACKS-INFLUENCE, ACKS-LOCATION, ACKS-MONSTERS, ACKS-MARKETS, ACKS-VEHICLES`
- `packs/` — compiled LevelDB compendia. **Build output: gitignored, rebuilt
  by CI, shipped in module.zip.** Never committed, never hand-managed.
  Foundry cannot read `packs/_source` at runtime, so the compiled dirs must
  stay in the zip.
- `packs/_source/` — JSON pack sources (committed). **Also GENERATED:**
  `build:packs` deletes and rewrites them from `tools/pack-data.mjs`, so
  editing them directly is silently undone. Edit `tools/pack-data.mjs`.
- `tools/` — dev harness. `build-packs.mjs` and `validate.mjs` are **synced
  from acks-module-template — never hand-edit**; change the template, then
  run `/acks-sync-toolchain`. `pack-data.mjs` (and the data files it
  re-exports) are module-owned.
- `.claude/skills|rules|hooks/` — **synced canon from acks-module-template**
  (COPY_DIRS); never hand-edit here, CI flags drift.
- Canonical ACKS II rules extracts: `C:\Proj\acks-rules\<feature>\RULES.md` —
  **LOCAL-ONLY, never committed or shipped** (licensed book text). Cite it
  instead of re-deriving rules; lookup order: `.claude/rules/rules-lookup.md`.
- **No `ruledata/`, no rules WORDS, no page VALUES.** The procedure ships;
  every number read off a page, every table of options, and every sentence of
  the book's prose arrives through `acks-importer` from the GM's own copy.
  `ip-scan.mjs` gates the mechanical cases; the value rule needs a reviewer.
  The full line — it is finer than it looks — is
  `.claude/rules/ip-doctrine.md`; read it before shipping any constant,
  table, or user-visible rule text.
- `docs/` — not shipped. Doctrine: `.claude/rules/docs-doctrine.md`. **A
  repo's `docs/README.md` is its surface map — read it before working an
  unfamiliar subsystem**; repo-specific toolchains (e.g. the importer's PDF
  extraction pipeline) are indexed there, not here.

## Commands

- `npm install` once, then `npm run build:packs` and `npm run validate`
  (`npm test` where the repo defines one).
- Run `build:packs` after cloning, or compendiums are empty. Commit
  `packs/_source` when it changes; compiled dirs are ignored.
- Foundry dev install (junction, not copy):
  `New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\acks-extras" -Target "C:\Proj\foundryvtt-acks-extras"`
- Windows paths never go inside Bash heredocs (a hook denies it); write files
  with the Write/Edit tools and pass paths as arguments or env vars.

## Live testing

The go-live gate. Read `.claude/rules/live-testing.md` before any live test —
it is the canonical procedure (fixtures you create and destroy, real player
seats, world-shutdown-before-build, what to report). The machine's server is
defined in `C:\Proj\acks-rules\TEST_ENVIRONMENT.md` (LOCAL-ONLY — no port,
world id, user name or password ever enters a repo); if that file is absent,
this machine has no test server — skip and say so. Offline green proves
nothing: `validate`/`npm test` run against mocked globals, and every
module-breaking bug in this family passed them.

## Release

Every release is a **major**, **minor** or **hotfix** — declared by the user,
never derived. Ask if unclear; a major is always explicit. All three pass the
same gates (build, validate, live-verify, snapshot obligations by kind);
`/acks-release` walks the procedure and TOOLCHAIN §4 is canon. Never
`gh run watch` (it hangs) — bounded polls only. Never retag a published
release — cut a new patch.

## Conventions

- **Single branch: `main`**; tags `v<semver>` are the only other refs. Never
  create a branch or a worktree — `.claude/hooks/single-branch-guard.mjs`
  enforces it and warns a misplaced session at startup. `worktree.bgIsolation`
  is `none` (read at daemon start — restart the app after changing it).
- `compatibility` minimum 14 / verified 14.364; system `acks` minimum 14.
- Every `relationships.requires` entry carries a `reason`; third-party entries
  also carry `compatibility.minimum` — intra-family acks-* entries do not
  (TOOLCHAIN §3 waiver).
- Declare a pack in `module.json` only once it has content.
- Namespacing (validate-enforced): globals/custom hooks/HB helpers start with
  the camelCased module id; top-level pack `_id`s start with the
  `flags["acks-extras"].idPrefix` key; lang keys under root(s)
  `ACKS-CLASSES, ACKS-LIB, ACKS-ABILITIES, ACKS-EQUIPMENT, ACKS-FORMATION, ACKS-HENCHMEN, ACKS-INFLUENCE, ACKS-LOCATION, ACKS-MONSTERS, ACKS-MARKETS, ACKS-VEHICLES`; CSS classes with `acks-extras-`.
- Design doctrine: **reuse → extend → enhance → invent** — reuse core system
  documents; extend only via `flags["acks-extras"]`; enhance with alternate
  sheets/wrappers; invent nothing the system provides.
- **The `acks` system repo (`C:\Proj\foundryvtt-acks-core`) is an unmodifiable
  reference.** Read it to learn what core already does; a module task never
  edits system source. **Overrides or extensions of core logic default to the
  shared `lib` subsystem** (`acks-extras/scripts/lib/` — its `README.md` is
  the index; check it before writing any helper). Patch core from a feature
  only when the behavior is unique to that feature's domain, and record why in
  `docs/<feature>/MODEL.md`. One owner per wrapped core method.

## Documentation

`docs/<feature>/{MODEL,DECISIONS,ROADMAP,TESTING}.md` + `docs/guides/` —
kinds, dedup law ("nothing is stated in two places"), wip/ lifecycle, and the
comment/docstring rules are all `.claude/rules/docs-doctrine.md`. Read it
before writing any doc, comment, or changelog prose.
