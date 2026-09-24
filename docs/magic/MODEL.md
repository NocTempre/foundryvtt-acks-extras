# Magic — Design Model

The magic feature is the spell primitive on the acks system's `spell` Item,
the vocabulary every magic surface shares, and, as the releases land, the
spell builder, the cast engine and the tracking of what a cast leaves behind.
Two sibling features build on it: `magic-items` and `research`. The design of
the whole program stays in [wip/20260924-scoping.md](wip/20260924-scoping.md)
until each part lands here.

## What exists now

**The vocabulary** (`scripts/lib/magic-vocab.mjs`, re-exported by
`lib/vocab.mjs` so every consumer keeps one import path). Sixteen families:
the thirteen spell types; the shapes a printed range line and a printed
duration line take; distance and time units; the two kinds of concentration;
casting-time shapes; target models and area geometries; the creature filters
a spell applies; save categories and what a passed save does; heal kinds;
control dispositions; summoning formats; and the one frequency table shared
with abilities and monster powers. Each family is a descriptor map with an
inline label. The label a window shows comes from
`ACKS-LIB.enum.<family>.<key>` through `vocabLabel` (`vocabChoices` builds a
select's options the same way), and `tools/test-magic.mjs` proves the lang
file complete in both directions. Which lists are families and which ship
empty is [DECISIONS.md](DECISIONS.md), "A code enum names a mechanism".

**The spell kinds in `EFFECT_TYPES`** — damage, heal, summon, control,
transform, wall, detect, dispel, ward, illusion, light, teleport, createObject,
structural, curse — carry `domain: "spell"`, and `effectTypesFor(domain)`
keeps them out of an ability's picker while a spell may carry every kind.

Nothing casts, prices or imports yet; those are the releases in
[ROADMAP.md](ROADMAP.md).
