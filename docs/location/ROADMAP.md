# Locations — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

### Pinning a place you are not standing in

The pin is the manual control over which places a character's sheet lists
([DECISIONS.md](DECISIONS.md), 2026-09-20), and it lives on the row — so a
place the sheet does not list cannot be pinned from the sheet. Visiting the
place once is the ordinary route, and the API
(`acksExtras.location.reach.setPinnedPlace`) is the Judge's. What is unbuilt is
a picker that offers the world's places to pin without standing in them; it
wants a search, because the world this rule exists for holds ninety of them.

### A materialize before every registry has published

`materializeAll` retires any journal page whose key no current entry names, and
cannot tell a doc that is gone from one that has not registered yet. The
classes registry publishes its `acks.class.*` docs only after the library has
warmed (`registerRegistryHooks`), seconds after `ready`, so a pass in that
window deletes their pages and the next pass recreates them under new ids. An
import started by hand normally begins well after that window; a script that
materializes at `ready` meets it. The unbuilt guard is a pass that waits for
the registries it sweeps.

### The table projection belongs to lib

`table-docs.mjs` projects every feature's rules tables onto the library's
shelves, but lives under this feature. Its encounter-doc projections are rows
in a descriptor table, so the next doc adds a row rather than a branch, and
moving the file changes no behaviour. The move is to `scripts/lib/`, with the
Ruledata Browser following it, in a release that touches neither.

---

The private Judge's record, the row notes and the ownerless hoard all shipped
in 4.0. New unbuilt work lands here as it is designed.
