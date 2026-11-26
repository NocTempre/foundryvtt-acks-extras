# Monsters — not built

Work that is designed but absent, deliberately. How the feature behaves now is
[MODEL.md](MODEL.md); why it is shaped that way is [DECISIONS.md](DECISIONS.md).

---

- **A leader part's `fixedHp` is not read.** The roll turns a leader part into an
  officer, not a stack, so the figure the recipe editor takes on a leader part is
  stored and never used ("The recipe editor", `docs/monsters/MODEL.md`).
- **Reset all has no undo.** The recipe editor's Reset all writes the import's
  copy at once and removes every part a Judge added; nothing keeps the recipe it
  replaced.
