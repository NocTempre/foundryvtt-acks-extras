# Documentation

The document kinds, the dedup law, the `wip/` lifecycle and the
comment/docstring rules are the synced `.claude/rules/docs-doctrine.md` —
this file only indexes what this repo has.

- [DECISIONS.md](DECISIONS.md) — repo-level: namespacing, flag scope, the macro pack,
  the docs site and its guards.
- [ROADMAP.md](ROADMAP.md) — repo-level: magic, the domain-module family.
- [TESTING.md](TESTING.md) — repo-level: the entry point and the namespace load at all,
  and walking a shipped macro.
- [GALLERY.md](GALLERY.md) — one row per feature: guide, and the release its
  screenshot came from.
- [guides/](guides/) — user-facing how-to, one per feature area.
- [../tools/live/](../tools/live/README.md) — the live walks: the release
  gate's live half as code, one walk per recipe area, run by
  `node tools/live/run.mjs`; each `TESTING.md` names its walk.

Per-feature: `abilities`, `battlemap`, `bridge`, `character-sheet`, `classes`,
`domains`, `equipment`, `factions`, `formation`, `henchmen`, `importer`, `influence`, `lib`,
`location`, `magic`, `markets`, `monsters`, `vehicles`.
The `bridge` feature covers both halves of the Discord bot: `scripts/bridge/`
inside the world and the `discord/` service beside it.
The `lib` feature additionally splits by topic (API, GROUPS, PLACES, FOLLOWER-CARD)
because it is the shared surface every other feature reads. The `importer`
feature additionally splits by topic (COOKBOOK, RECIPES, BINDING-FOUNDRY, EXTRACTION)
because it is the extraction pipeline with multiple independently-versioned surfaces.

## `site/`

`docs/site/` is the published documentation site — Astro + Starlight, deployed to
<https://noctempre.github.io/foundryvtt-acks-extras/> by `.github/workflows/pages.yml`
on every push to `main`. It is the user-facing front door; this tree stays the
authoring surface.

**It authors almost nothing.** `npm run sync` (which `dev` and `build` both run
first) stages the content it publishes:

| Page | Comes from |
|---|---|
| Guides | `docs/guides/*.md` |
| Feature gallery | `docs/GALLERY.md` + `docs/releases/**` |
| What this is / Install / Getting started | the matching `##` sections of the root `README.md` |
| Settings reference | the `game.settings.register()` calls in `scripts/`, joined with `lang/en.json` |
| Compendia | `tools/pack-data.mjs` + `module.json`; what an import leaves, from the shelf code in `scripts/lib/library.mjs` and `scripts/importer/` |
| Module map | the `import` statements of every file under `scripts/` |
| API (one page per `acksExtras` key) | the `acksExtras.<feature> = …` assignments in `scripts/`, and the `publicApi` manifests they place, each key followed to its declaration and that declaration's docstring |
| Theme | `vendor/acks-design/` tokens and fonts |

Every staged path is gitignored and carries a generated header, and each page's
"Edit page" link points at its real source. **Editing a staged copy is undone by
the next sync** — change the source instead. Only `index.mdx`, `start/buying.md`,
`start/report-a-bug.md`, `404.md`, the gallery template, the `Footer` override and the theme CSS are
authored in `site/`.

A guide links another guide by its file, `other.md#section`, which is the form
GitHub follows, and the sync re-points the link at the published page
([DECISIONS.md](DECISIONS.md) §18). Anything else in the repo is linked by its
full GitHub URL: a relative path out of `guides/` has no page on the site.

The sync exits non-zero if a setting key cannot be resolved, a feature that
registers a setting is missing from the lists in `tools/extract-settings.mjs`,
`GALLERY.md` points at a missing screenshot, the sidebar and `guides/` disagree,
or a guide links to a guide that is not there. `npm run validate` runs it, so a
change that breaks one is caught before the push and again in CI rather than
published quietly.

Three more conditions belong to the compendia reference. The sync exits
non-zero when the README, a guide or a hand-written site page names a
compendium pack `module.json` declared once and declares no longer
([DECISIONS.md](DECISIONS.md) §20). It does the same for a macro the pack held
once and holds no longer, and for that name it also reads the repo's own
`TESTING.md` and each feature's `MODEL.md` and `TESTING.md` (§22). Both checks
read git history, so a shallow checkout, CI's included, prints a note for each
and checks nothing. It also exits non-zero when a compendium type the importer
keeps has no brief in `tools/extract-library.mjs`, which is where the site
says in its own words what each of those compendiums is (§21).

The module map and the API pages add one more: the sync exits non-zero when an
import names no file, or a key of the namespace cannot be followed to a
declaration (§26). `tools/test-reference.mjs` holds the same render to the
source in `npm test`.

A call meant for a macro or another module is published from its own file:
the file ends with `export const publicApi = { … }`, and the feature's entry
places that object on its namespace, as a group or spread at the top. The same
two checks fail when a `publicApi` reaches no key, when a file with one is also
reached another way, when a call in one has no docstring, when a key it
reaches is reached twice, and when the README or a doc under `docs/` (the logs,
`wip/`, `releases/` and `site/` aside) writes an `acksExtras.<feature>.<path>`
the namespace does not hold. A doc names a call by that full path, since a bare
name is invisible to the check (§31).

## Not shipped

None of `docs/` is in `module.zip` — the release artifact carries the Foundry
runtime plus the root README and LICENSE, and Foundry never reads a markdown
file out of a module directory. These are read on GitHub.

That exclusion is a `docs/*` pattern in the release workflow, which is why the
site lives under `docs/` rather than at the repo root: it needs no change to the
synced template to stay out of the zip. Verified against a published artifact —
`module.zip` carries no `docs/` entries at any depth.
