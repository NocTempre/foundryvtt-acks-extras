# Classes — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

- **Level-up engine** — XP watch (notify when `details.xp.value` crosses
  `xp.next`; never auto-apply), and the wizard: level+1, HP reroll (full HD,
  minimum +1, flat past 9th), award-ladder consumption (fixed grants applied,
  choice awards opening the ChoiceSpec picker), slot bumps, title.
- **Casting pools & sheet strip** — per-tradition resource tracking in extras
  flags, the per-tradition slot/pool strip on the character sheet, the
  Nobiran's dual pools live at once; points/ritual/ceremonial/gnosis kinds
  get consumers when their books' recipes land.
- **Sheet editors for casting and templates** — both are stored and preserved
  now; the constructor tabs that edit them arrive with the phases that
  consume them.
- **Chargen** — roll 3d6 then choose the rolled template or any lower band;
  template bundle application (abilities with ranks/selections, items through
  the equipment grant flow, spells, gp) with the INT adjustments; the
  named-item **skinning layer** (printed descriptor → base equipment doc →
  flavored copy preserving mechanics).
- **Demi-human specifics** — requirements gates on assignment, racial-trait
  display, caster-level ladders wired to spell progressions.
- **Roll-editor progression picker** — name a published table instead of
  typing rungs (the abilities ROADMAP seam's UI half).
- **Prose editors** — description/code fields are textareas; ProseMirror
  polish later.
