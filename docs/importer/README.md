# Documentation

This directory is the importer subsystem's doc set. It splits by topic because
the pipeline has three independently-versioned surfaces and multiple extraction
concerns:

- [MODEL.md](MODEL.md) — how the importer works now.
- [DECISIONS.md](DECISIONS.md) — why it is this way, what was rejected, what it
  cost. Append-only history.
- [ROADMAP.md](ROADMAP.md) — what is not built yet.
- [COOKBOOK.md](COOKBOOK.md) — the shipped, engine-agnostic database and its
  frozen instruction set.
- [RECIPES.md](RECIPES.md) — the offline authoring pipeline that produces it.
- [BINDING-FOUNDRY.md](BINDING-FOUNDRY.md) — how the Foundry engine consumes it.
- [OSE.md](OSE.md) — importing another game's books: the Judge-registered
  source registry, the stat-block grammar, and the conversion instrument.
- [EXTRACTION.md](EXTRACTION.md) — the map of the extraction engine and
  pipeline operators, and the running ledger of extractor gotchas (double-strikes,
  column starvation, run seams — each row points at its gate).

[TESTING.md](TESTING.md) carries the live-test recipes — the go-live gate.

The importer user guide is [docs/guides/importer.md](../guides/importer.md) —
it explains how to connect books, import content, browse entries and import OSE
adventures.

## Not shipped

None of `docs/` is in `module.zip`. See the root [docs/README.md](../README.md).
