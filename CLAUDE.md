# Extras (acks-extras)

Foundry VTT module for the ACKS II system (`acks`), part of the NocTempre ACKS
module family. Canonical conventions and shared toolchain:
`C:\Proj\acks-module-template` — read its `docs/TOOLCHAIN.md` before changing
build/release plumbing, and its `docs/DECISIONS.md` before a structural change
(splitting or merging a repo, adding a dependency edge, changing what ships).

## Layout

- `scripts/` — ESM runtime, entry `scripts/module.mjs`; `templates/` — .hbs;
  `styles/`; `lang/en.json` — flat i18n keys under root(s) `ACKS-CLASSES, ACKS-LIB, ACKS-ABILITIES, ACKS-EQUIPMENT, ACKS-FORMATION, ACKS-HENCHMEN, ACKS-INFLUENCE, ACKS-LOCATION, ACKS-MONSTERS, ACKS-MARKETS`
- `packs/` — compiled LevelDB compendia. **Build output: gitignored, rebuilt
  by CI, shipped in module.zip.** Never committed, never hand-managed; there
  is no pack churn to discard. Foundry cannot read `packs/_source` at runtime,
  so the compiled dirs must stay in the zip.
- `packs/_source/` — JSON pack sources (committed). **Also GENERATED:**
  `build:packs` deletes and rewrites them from `tools/pack-data.mjs`, so
  editing them directly is silently undone on the next build. Edit
  `tools/pack-data.mjs` — it is the source of truth for all pack content.
- `tools/` — dev harness. `build-packs.mjs` and `validate.mjs` are **synced
  from acks-module-template — never hand-edit**; change the template, then run
  `/acks-sync-toolchain`. `pack-data.mjs` (and data files it re-exports) are
  module-owned.
- Canonical ACKS II rules extracts: `C:\Proj\acks-rules\<feature>\RULES.md`
  (one dir per pre-merge feature module; single-feature repos have exactly one)
  — **LOCAL-ONLY, never committed or shipped** (licensed book text; purged
  from repo history 2026-07-16). Cite it instead of re-deriving rules.
- **No `ruledata/`.** No value read off a page ships in any repo — `ip-scan.mjs`
  hard-FAILS on a tracked `ruledata/` directory. Book content reaches a world
  through `acks-importer`, materialized from the GM's own books.
- `docs/` — not shipped; see Documentation below.

## Commands

- `npm install` once, then `npm run build:packs` and `npm run validate`
  (`npm test` where the repo defines one).
- Run `build:packs` after cloning, or compendiums are empty (the compiled
  packs are not in git). Commit `packs/_source` when it changes; the compiled
  dirs are ignored, so there is nothing to review or discard.
- Foundry dev install (junction, not copy):
  `New-Item -ItemType Junction -Path "$env:LOCALAPPDATA\FoundryVTT\Data\modules\acks-extras" -Target "C:\Proj\foundryvtt-acks-extras"`
## Live testing

`C:\Proj\acks-rules\TEST_ENVIRONMENT.md` defines this machine's local Foundry
test server (URL, world, users, and the API calls that drive it). Read it
before live-testing. It is LOCAL-ONLY and machine-specific — **never commit
its contents, or any port / world id / user name / password, to any repo.**
If the file is absent, this machine has no test server: skip live testing and
say so, rather than improvising one.

`validate` and `npm test` run against **mocked** Foundry globals — they check
your assumptions, not Foundry's behaviour. Every module-breaking bug in this
family got through a green offline suite and was caught only live. So before
release, and whenever you change a runtime surface:

1. Confirm the dev install is a junction to this working tree (above), so what
   you test is what you ship.
2. **Shut down any running world before rebuilding packs** — it holds LevelDB
   locks on `packs/` and `build:packs` fails on the LOG files. Order: shut
   down → build packs → launch → test.
3. Enable the module in the test world and check: it reaches `ready` with **no
   console errors** (check `init`, `setup`, and `ready` — a throw in one leaves
   the rest silently dead); every registered setting appears AND gates
   something; every shipped macro runs; each declared compendium opens; and
   **the feature you changed, exercised end-to-end through the UI**. For Active
   Effects, sheets, and drag-and-drop, verify the write landed on the target
   field — not merely that the code ran.
4. **Build your own test artifacts, then destroy them.** Creating the actors /
   items / users a check needs is part of the check, not a prerequisite for it
   — "no data existed to exercise it" is test data you were expected to make.
   Delete what you made when you are done.

   **Never test by mutating documents the world already had.** Editing a
   fixture and restoring it afterwards is not the same thing: a rollback is a
   second write that can silently fail (and does — an ownership rollback that
   reported success left the grant in place), it cannot restore what you did
   not think to snapshot, and a crash mid-test strands the world in the broken
   state. A disposable actor needs no rollback, no snapshot, and no trust.
   Seats are cheap too — the world has one user of every role, so verify
   player-facing behaviour by joining as that player rather than by reasoning
   about the template.
5. The world may stay running while you commit — compiled packs are
   gitignored, so it can no longer dirty the repo.

Report what you exercised and name what you could not reach. "Live-verified"
with no list is not a result. Say what you created and confirm you removed it.

## Release

Every release is a **major**, **minor** or **hotfix** — declared by the user,
never derived from the version number. Ask if it is unclear; a major release is
always explicit. The kind decides only what gets photographed (below); all three
pass exactly the same gates.

1. Establish the release kind; bump `module.json` version; update changelog if
   present.
2. Build + validate + test.
3. **Live-verify (above). This is a go-live gate** — skip only if this machine
   defines no test environment, and state that in the release report.
4. **Capture release snapshots in that same live session** — screenshots of the
   features working, which serve at once as evidence the check ran, as the
   images for the release notes, and as the user guide:
   - **major** → re-shoot every feature area, changed or not;
     **minor** → one shot per user-visible changelog entry;
     **hotfix** → none, unless UI-visible and requested.
   - Save to `docs/releases/v<X.Y.Z>/<feature-slug>.png` (kept out of
     module.zip); update `docs/GALLERY.md` — every row on a major, only the
     re-shot rows on a minor. A past release's directory may be rewritten
     where its surface changed — a minor just never has to re-capture
     surfaces its changes did not touch.
   - Shoot the disposable fixtures you built for the live check, and clip to
     the app window — that keeps world id / user name / server URL out of
     frame. Incidental book text in a feature's UI is not a concern.
   - Capture technique is machine-specific — see `TEST_ENVIRONMENT.md`.
5. Commit, `git tag v<version>` (must equal module.json version), push branch
   + tag.
6. Confirm publication with BOUNDED polls — **never `gh run watch`, it hangs**:
   `gh release view v<version> --json assets` ~30s apart, capped ~5 min. Then
   verify `https://github.com/NocTempre/foundryvtt-acks-extras/releases/latest/download/module.json`
   shows the new version. The `/acks-release` skill walks all of this.

## Conventions

- **Single branch: `main`**; tags `v<semver>` are the only other refs. Never
  create a branch or a worktree — not for a feature, not for a hotfix, not to
  isolate a background task. Work in `C:\Proj\foundryvtt-acks-extras` on `main`.
  A session whose cwd is under `.claude/worktrees/` is misplaced: its commits
  land on a throwaway `claude/*` branch. Merge back to `main` and say so.
  `.claude/hooks/single-branch-guard.mjs` denies the branch- and
  worktree-creating git commands, refuses the app's own worktree creation, and
  warns a misplaced session at startup. `worktree.bgIsolation` is `none` so
  background sessions edit the main checkout — but that is read at daemon
  start, so restart the app after changing it.
- `compatibility` minimum 14 / verified 14.364; system `acks` minimum 14.
- Every `relationships.requires` entry carries a `reason`; third-party entries
  (lib-wrapper for wrapping, socketlib for GM-routed writes) also carry
  `compatibility.minimum` — intra-family acks-* entries do not (TOOLCHAIN §3
  waiver).
- Declare a pack in `module.json` only once it has content.
- Namespacing (validate-enforced): globals/custom hooks/HB helpers start with
  the camelCased module id; top-level pack `_id`s start with the
  `flags["acks-extras"].idPrefix` key; lang keys under root(s) `ACKS-CLASSES, ACKS-LIB, ACKS-ABILITIES, ACKS-EQUIPMENT, ACKS-FORMATION, ACKS-HENCHMEN, ACKS-INFLUENCE, ACKS-LOCATION, ACKS-MONSTERS, ACKS-MARKETS`;
  CSS classes with `acks-extras-`.
- Design doctrine: **reuse → extend → enhance → invent** — reuse core system
  documents; extend only via `flags["acks-extras"]`; enhance with alternate
  sheets/wrappers; invent nothing the system provides (see
  `docs/<feature>/MODEL.md`).
- **The `acks` system repo (`C:\Proj\foundryvtt-acks-core`) is an unmodifiable
  reference.** Read it to learn what core already does and build on top; a
  module task never edits system source. **Overrides or extensions of core
  logic default to the shared `lib` subsystem** (`acks-extras/scripts/lib/`) —
  patch core from a feature only when the behavior is unique to that feature's
  domain, and record why in `docs/<feature>/MODEL.md`. One owner per wrapped
  core method.

## Documentation

Four kinds, one question each — see `docs/README.md`. **Nothing is stated in two
places:** a fact lives at the deepest level where it is entirely true, and rises
only when a second sibling needs it (symbol → file → feature → repo → the
template, for facts true of every repo in the family). A fact owned by one repo
stays there and the other repo points at it; a pointer is not duplication.

- `docs/<feature>/MODEL.md` — how it works now. Present tense.
- `docs/<feature>/DECISIONS.md` — dated: what was ruled, what was rejected, what
  it cost. Append-only; a superseded entry stays, marked.
- `docs/<feature>/ROADMAP.md` — what is not built.
- `docs/guides/<feature>.md` — user-facing how-to, and where release screenshots
  land. `docs/GALLERY.md` indexes them.
- `docs/<feature>/wip/` — in-flight audits/plans/proposals only. When the work
  lands, its substance moves into the three above and the artifact is deleted.
  **Nothing permanent is named AUDIT, PLAN or PROPOSAL.**

**One feature-slug vocabulary**, shared by `docs/<feature>/`,
`docs/releases/v*/<slug>.png` and `docs/guides/<slug>.md`. Never "henchmen" in
one and "hirelings" in another.

None of `docs/` ships in `module.zip`.

## Comments and docstrings

- Comments explain **mechanics**: what this does, what it guards, why the shape
  is forced. Present tense, no dates, no attribution, no change history.
- Intent, rulings and rejected alternatives → `DECISIONS.md`. Unbuilt work →
  `ROADMAP.md`. **No TODO/FIXME in source.**
- **A constraint stays in code; the incident that taught it goes to DECISIONS.**
  Write the guard as a present-tense rule ("never gate this on…"), not as the
  story of the day it broke.
- Never restate a ruling in a second file. State the local mechanic; the ruling
  lives once.
- Every exported symbol carries a docstring, including classes and non-obvious
  constants. Prose first. In a single-class file the file header *is* the class
  docstring — do not write both.
- `@param`/`@returns` are required only where the type is not obvious from the
  name: destructured option bags, non-obvious return shapes, and anything
  crossing a module boundary (a shared library, the public `api`).
  Elsewhere prose is preferred.
- **Treat existing comments and docs as unverified.** They drift: a "deferred
  migration" that already happened, a referenced test file that does not exist,
  a resolved collision still described as open. Check the claim against the code
  before relying on or relocating it.
