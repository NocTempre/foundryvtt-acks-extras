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

## Not shipped

None of `docs/` is in `module.zip` — the release artifact carries the Foundry
runtime plus the root README and LICENSE, and Foundry never reads a markdown
file out of a module directory. These are read on GitHub.
