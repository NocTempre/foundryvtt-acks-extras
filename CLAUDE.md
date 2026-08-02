# Extras (acks-extras)

Foundry VTT module for the ACKS II system (`acks`), part of the NocTempre ACKS
module family. Canonical conventions and shared toolchain:
`C:\Proj\acks-module-template` — read its `docs/TOOLCHAIN.md` before changing
build/release plumbing.

## Layout

- `scripts/` — ESM runtime, entry `scripts/module.mjs`; `templates/` — .hbs;
  `styles/`; `lang/en.json` — flat i18n keys under root(s) `ACKS-LIB, ACKS-ABILITIES, ACKS-EQUIPMENT, ACKS-FORMATION, ACKS-HENCHMEN, ACKS-INFLUENCE, ACKS-LOCATION, ACKS-MONSTERS`
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
- Canonical ACKS II rules extracts: `C:\Projcks-rules\<feature>\RULES.md`
  (one dir per pre-merge feature module; single-feature repos have exactly one)
  — **LOCAL-ONLY, never committed or shipped** (licensed book text; purged
  from repo history 2026-07-16). Cite it instead of re-deriving rules.
  `docs/MODEL.md` — design decisions (original content, stays in-repo).
- `ruledata/` (if present) — runtime-fetched JSON rule content; ships in the zip.

## Commands

- `npm install` once, then `npm run build:packs` and `npm run validate`
  (`npm test` where `tools/test-logic.mjs` exists).
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

1. Bump `module.json` version; update changelog if present.
2. Build + validate + test.
3. **Live-verify (above). This is a go-live gate** — skip only if this machine
   defines no test environment, and state that in the release report.
4. Commit, `git tag v<version>` (must equal module.json version), push branch
   + tag.
5. Confirm publication with BOUNDED polls — **never `gh run watch`, it hangs**:
   `gh release view v<version> --json assets` ~30s apart, capped ~5 min. Then
   verify `https://github.com/NocTempre/foundryvtt-acks-extras/releases/latest/download/module.json`
   shows the new version. The `/acks-release` skill walks all of this.

## Conventions

- Branch `main`; tags `v<semver>`.
- `compatibility` minimum 14 / verified 14.364; system `acks` minimum 14.
- Every `relationships.requires` entry carries a `reason` and
  `compatibility.minimum` (lib-wrapper for wrapping, socketlib for GM-routed
  writes).
- Declare a pack in `module.json` only once it has content.
- Namespacing (validate-enforced): globals/custom hooks/HB helpers start with
  the camelCased module id; top-level pack `_id`s start with the
  `flags["acks-extras"].idPrefix` key; lang keys under root(s) `ACKS-LIB, ACKS-ABILITIES, ACKS-EQUIPMENT, ACKS-FORMATION, ACKS-HENCHMEN, ACKS-INFLUENCE, ACKS-LOCATION, ACKS-MONSTERS`;
  CSS classes with `acks-extras-`.
- Design doctrine: **reuse → extend → enhance → invent** — reuse core system
  documents; extend only via `flags["acks-extras"]`; enhance with alternate
  sheets/wrappers; invent nothing the system provides (see docs/MODEL.md).
- **The `acks` system repo (`C:\Proj\foundryvtt-acks-core`) is an unmodifiable
  reference.** Read it to learn what core already does and build on top; a
  module task never edits system source. **Overrides or extensions of core
  logic default to `acks-lib`** — patch core from this module only when the
  behavior is unique to this module's domain, and record why in docs/MODEL.md.
  One owner per wrapped core method.
