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
- **The rules MM ch. 3 gives a monster's ability scores apart from a character's
  are not applied.** An entered score feeds the module's own throws through the
  system's table (the default-score paragraph, `docs/monsters/MODEL.md`) and
  Strength adjusts a monster's attacks (the Strength paragraph beside it); the
  chapter's other figures for a monster are not imported or read: Strength on
  maximum load, Dexterity on a non-humanoid's speeds, Constitution on each Hit
  Die roll, Charisma on its morale and its followers', and Intelligence on a
  sapient monster's proficiencies, languages and spell repertoire or a bestial
  one's tricks.
- **A monster sheet's attack figures do not include the Strength row.** The
  Attacks tab's throw and damage boxes are the system's own answer with no
  attack in flight, and the module's Strength rows join only an attack being
  rolled, so the dialog and the card show them and the sheet does not. Showing
  them on the sheet needs a seam question that answers with no attack, and a
  design board for the figure ("Design before build",
  `.claude/rules/ui-layout.md`).
