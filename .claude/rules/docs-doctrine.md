# Documentation & comments doctrine (canonical)

## The documents

Four kinds, one question each — a repo's `docs/README.md` indexes its own.
**Nothing is stated in two places:** a fact lives at the deepest level where
it is entirely true, and rises only when a second sibling needs it (symbol →
file → feature → repo → the template, for facts true of every repo in the
family). A fact owned by one repo stays there and the other repo points at
it; a pointer is not duplication.

- `docs/<feature>/MODEL.md` — how it works now. Present tense.
- `docs/<feature>/DECISIONS.md` — dated: what was ruled, what was rejected,
  what it cost. Append-only; a superseded entry stays, marked. **Superseding
  an entry less than 7 days old requires the new entry to name the new
  evidence** — what was learned that the original ruling did not know.
  Reversals stay possible; silent ones do not: a decision flipped twice in a
  week with no stated cause is the signature of deciding by mood.
- `docs/<feature>/ROADMAP.md` — what is not built.
- `docs/<feature>/TESTING.md` — the surface's live-test recipe: **fixtures to
  create → steps to walk → the observable that proves each → teardown.** It
  records the non-obvious drive mechanics live testing discovers (how a thing
  is actually created, which API finds it, what a real user gesture looks
  like scripted), so the next session walks in minutes what the last one
  learned in hours. Written during the build, before the surface's first
  release — `tools/release-preflight.mjs` requires it for every changed
  surface at the next tag. A repo with a flat `scripts/` keeps one
  `docs/TESTING.md`.
- `docs/guides/<feature>.md` — user-facing how-to, where release screenshots
  land. `docs/GALLERY.md` indexes them.
- `docs/<feature>/wip/` — in-flight audits/plans/proposals only. When the
  work lands, its substance moves into the three above and **the artifact is
  deleted in the same session** — a wip file that outlives its work reads as
  design intent when it is history. Nothing permanent is named AUDIT, PLAN
  or PROPOSAL.

**One feature-slug vocabulary**, shared by `docs/<feature>/`,
`docs/releases/v*/<slug>.png` and `docs/guides/<slug>.md`. Never "henchmen"
in one and "hirelings" in another.

None of `docs/` ships in `module.zip`.

## Comments and docstrings

- Comments explain **mechanics**: what this does, what it guards, why the
  shape is forced. Present tense, no dates, no attribution, no change history.
- Intent, rulings and rejected alternatives → `DECISIONS.md`. Unbuilt work →
  `ROADMAP.md`. **No TODO/FIXME in source.**
- **A constraint stays in code; the incident that taught it goes to
  DECISIONS.** Write the guard as a present-tense rule ("never gate this
  on…"), not as the story of the day it broke.
- Never restate a ruling in a second file. State the local mechanic; the
  ruling lives once.
- Every exported symbol carries a docstring, including classes and
  non-obvious constants. Prose first. In a single-class file the file header
  *is* the class docstring — do not write both.
- `@param`/`@returns` only where the type is not obvious from the name:
  destructured option bags, non-obvious return shapes, anything crossing a
  module boundary (a shared library, the public `api`). Elsewhere prose.
- **Treat existing comments and docs as unverified.** They drift: a
  "deferred migration" that already happened, a referenced test file that
  does not exist, a resolved collision still described as open. Check the
  claim against the code before relying on or relocating it.
