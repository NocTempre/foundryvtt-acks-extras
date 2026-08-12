# Documentation

Four kinds of document, each answering a different question. Nothing is stated in
two places: a fact lives at the deepest level where it is entirely true, and
rises only when a second sibling needs it.

| Kind | Answers | Where |
|---|---|---|
| **MODEL.md** | How does it work now? | `docs/<feature>/` |
| **DECISIONS.md** | Why is it this way? What was rejected? | `docs/<feature>/`, `docs/` |
| **ROADMAP.md** | What is not built yet? | `docs/<feature>/`, `docs/` |
| **guides/** | How do I use it? | `docs/guides/` |

- [DECISIONS.md](DECISIONS.md) — repo-level: the merge, namespacing, flag scope.
- [ROADMAP.md](ROADMAP.md) — repo-level: magic, the domain-module family.
- [GALLERY.md](GALLERY.md) — one row per feature: guide, and the release its
  screenshot came from.
- [guides/](guides/) — user-facing how-to, one per feature area.

Per-feature: `abilities`, `equipment`, `formation`, `henchmen`, `influence`,
`lib`, `location`, `monsters`. The `lib` feature additionally splits by topic
(API, GROUPS, PLACES, FOLLOWER-CARD) because it is the shared surface every other
feature reads.

## `wip/`

`docs/<feature>/wip/` holds **in-flight working artifacts** — audits, plans and
proposals produced while working something out. They are not permanent
documents: when the work lands, their substance moves into MODEL / DECISIONS /
ROADMAP and the artifact is deleted.

Nothing permanent is ever named AUDIT, PLAN or PROPOSAL. That naming is how the
tree drifted before.

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
| Compendia | `tools/pack-data.mjs` + `module.json` |
| Theme | `vendor/acks-design/` tokens and fonts |

Every staged path is gitignored and carries a generated header, and each page's
"Edit page" link points at its real source. **Editing a staged copy is undone by
the next sync** — change the source instead. Only `index.mdx`, `start/buying.md`,
`404.md`, the gallery template, the `Footer` override and the theme CSS are
authored in `site/`.

The sync fails the build if a setting key cannot be resolved or `GALLERY.md`
points at a missing screenshot, so a docs change that breaks either is caught in
CI rather than published quietly.

## Not shipped

None of `docs/` is in `module.zip` — the release artifact carries the Foundry
runtime plus the root README and LICENSE, and Foundry never reads a markdown
file out of a module directory. These are read on GitHub.

That exclusion is a `docs/*` pattern in the release workflow, which is why the
site lives under `docs/` rather than at the repo root: it needs no change to the
synced template to stay out of the zip. Verified against a published artifact —
`module.zip` carries no `docs/` entries at any depth.
