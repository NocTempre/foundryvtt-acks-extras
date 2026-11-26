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
- **A count's block size, base, rounding and per-unit word have no control.** The
  recipe editor shows a count for every so many (`forEvery` with its `ratioOf`), a
  share's `ratioOf`, a printed `round` and a `perUnit`, and edits only the die,
  figure or percentage; a Judge cannot set or change the others by hand, and cannot
  turn a plain count into a for-every one. A control for them needs a design board
  first ("Design before build", `.claude/rules/ui-layout.md`).
