# Influence & reactions — decision record

Why this feature is shaped the way it is. How it behaves *now* is
[MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### Racial and cross-species reactions ship strict-RAW (2026-07-16)

Shipped as `racial.mjs` plus roller integration, compendium items and settings.

**No invented human/elf/dwarf penalty.** Core states none, so none is shipped.
Only cited mechanics: the Inhumanity tiers, the optional BTA caste effects,
type-scoped powers, and the hard-hatred notes.

**A campaign relations registry, and it is not symmetric.** A campaign registers
its own inhumanity matrix through a hook/setting and it auto-applies. Entries
need not be symmetric — dwarf→elf may differ from elf→dwarf, and forcing symmetry
would have made half the interesting cases unstateable.

Deltas from the original plan, both deliberate: the BTA caste effects ship gated
by the `enableBtaCaste` world setting (default on), and the relations row renders
as its own "Racial relations" group rather than folded into "Both".

---

### Modifiers are offered, never asserted (founding)

The dialog is a recipe, not a rule. Situational modifiers are toggles the table
resolves, not silent additions, because whether a modifier applies is a judgement
about the fiction that the module is not in a position to make.

A mechanic not yet read against the printed page is badged **unaudited** in amber
rather than red: it is probably correct and is genuinely offered, and colouring
it as an error would be a stronger claim than the module can support in either
direction.

---

### An unknown is not a modifier (founding)

An `auto` source whose input cannot be resolved is **skipped**, not scored as
zero. Zero is a claim that the modifier applies and happens to be worth nothing;
skipping is the truthful statement that the module could not tell.

---

### Alignment is translated at the boundary, not renamed (founding)

This feature keeps its own alignment token set (`law` / `chaos` / `neutral` /
`other`), baked into published effect flags, and translates at its boundary to
the shared vocabulary's `lawful` / `neutral` / `chaotic`.

The shared library deliberately ships **no** `normalizeAlignment` fold: with this
feature translating at its own edge there is no live consumer for one, and a
primitive with no consumer is a dead primitive.

---

### The subject of an effect is carried, not folded in (founding)

The roller resolves ONE actor's social roll. An effect aimed at an opponent or an
ally is not a modifier on that roll, and storing it as one is exactly the
inversion the subject field exists to prevent. It is carried through rather than
discarded so an opposed mode can use it — see [../ROADMAP.md](../ROADMAP.md).
