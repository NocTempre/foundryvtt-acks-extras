# Magic — Decisions

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force


- 2026-09-24 — [Three features, one vocabulary (2026-09-24)](DECISIONS-through-v11.14.5.md#three-features-one-vocabulary-2026-09-24)
- 2026-09-24 — [The spell primitive is a flag on core's spell Item (2026-09-24)](DECISIONS-through-v11.14.5.md#the-spell-primitive-is-a-flag-on-cores-spell-item-2026-09-24)
- 2026-09-24 — [A code enum names a mechanism; a pick-list ships empty (2026-09-24)](DECISIONS-through-v11.14.5.md#a-code-enum-names-a-mechanism-a-pick-list-ships-empty-2026-09-24)
- 2026-09-24 — [One frequency vocabulary (2026-09-24)](DECISIONS-through-v11.14.5.md#one-frequency-vocabulary-2026-09-24)
- 2026-09-24 — [Range and duration shapes come from the printed lines (2026-09-24)](DECISIONS-through-v11.14.5.md#range-and-duration-shapes-come-from-the-printed-lines-2026-09-24)
- 2026-09-24 — [The first tagged release is the foundation (2026-09-24)](DECISIONS-through-v11.14.5.md#the-first-tagged-release-is-the-foundation-2026-09-24)
- 2026-09-24 — [A spell's stat block is one raw field, parsed at import (2026-09-24)](DECISIONS-through-v11.14.5.md#a-spells-stat-block-is-one-raw-field-parsed-at-import-2026-09-24)
- 2026-09-24 — [A body-size heading is found by its line; a proper name by its hash (2026-09-24)](DECISIONS-through-v11.14.5.md#a-body-size-heading-is-found-by-its-line-a-proper-name-by-its-hash-2026-09-24)
- 2026-09-24 — [One document per printed heading; the reverse is a name on it (2026-09-24)](DECISIONS-through-v11.14.5.md#one-document-per-printed-heading-the-reverse-is-a-name-on-it-2026-09-24)
- 2026-09-24 — [A damage-type mark in prose becomes its word (2026-09-24)](DECISIONS-through-v11.14.5.md#a-damage-type-mark-in-prose-becomes-its-word-2026-09-24)
- 2026-09-24 — [Spells land before the classes (2026-09-24)](DECISIONS-through-v11.14.5.md#spells-land-before-the-classes-2026-09-24)
- 2026-09-24 — [Core's strings are derived (2026-09-24)](DECISIONS-through-v11.14.5.md#cores-strings-are-derived-2026-09-24)
- 2026-09-24 — [An unread stat line reaches core's string; `unlimited` is a range shape (2026-09-24)](DECISIONS-through-v11.14.5.md#an-unread-stat-line-reaches-cores-string-unlimited-is-a-range-shape-2026-09-24)
- 2026-09-25 — [An "and" can be a title's own word (2026-09-25)](DECISIONS-through-v11.14.5.md#an-and-can-be-a-titles-own-word-2026-09-25)
- 2026-09-25 — [A creature's repertoire is drawn to its slots (2026-09-25)](DECISIONS-through-v11.14.5.md#a-creatures-repertoire-is-drawn-to-its-slots-2026-09-25)
- 2026-09-25 — [The order, and the scoping's eleven questions, ruled (2026-09-25)](DECISIONS-through-v11.14.5.md#the-order-and-the-scopings-eleven-questions-ruled-2026-09-25)
- 2026-11-11 — [A summoning spell's creature resolves on the GM's client (2026-11-11)](DECISIONS-through-v11.14.5.md#a-summoning-spells-creature-resolves-on-the-gms-client-2026-11-11)
- 2026-11-11 — [A cast's end is told on a card, read from the module's own clock math (2026-11-11)](DECISIONS-through-v11.14.5.md#a-casts-end-is-told-on-a-card-read-from-the-modules-own-clock-math-2026-11-11)
- undated — [Where the lang-key convention is recorded](DECISIONS-through-v11.14.5.md#where-the-lang-key-convention-is-recorded)

## 2026-11-16 — A cast's modifiers ride one record per recipient, read at the roll by lib

The owner: "1 stops, 2 spells track separate, effects don't stack but can
overlap, 3 on cast if target", "automation with transparency is the design
principle, size per spell, normalize for stats, ask case by case" and "Damage
should just use "magic" as a weapon roller type".

A cast's modifier and ward rows for one recipient are one Active Effect, free
of statuses and changes, carrying lib's `flags["acks-extras"].rollMods`: a part
per row that waits for a roll, built by `cast-mods.mjs` with the figure resolved
at the cast and every part providing `SPELL_RECORD_CAP`. Lib reads it at the
attack, the attack against the bearer and the bearer's save, and the larger of
two spell records applies, so a spell cast twice leaves two records that overlap
and never add. A row that stands, or whose target no part sits on, stays a card
line; a blank figure writes no part and shows its page reference alone.

A buff on a weapon names the weapon at the cast. Any kept row gated on the
weapon needs one bearer, the seat's one targeted token, and the weapon is picked
in the dialog from that token's actor's weapons. The part carries the weapon's
`itemId` and the gates are read at the roll, so a magic weapon is never refused
at the pick; the pair of rows the print splits on a weapon's being magic picks
itself. A Player with no one bearer is blocked (`oneBearer`) and a Judge warned,
the weapon rows written for nobody and listed on the card. The relay refuses
`badItem` unless the weapon is one of the target's actor.

The card gives each modifier or ward row a section; an entry's figure is the
part's value with a tooltip naming the spell, the weapon and the page, and a dry
run at the cast tells which part would yield to the weapon's own bonus (masterwork,
registered by equipment as lib's item bonus source). The dry run is a courtesy:
a later tier or a second cast changes the answer, and the attack card is the
record. A target's modifier entries are one group, applied in one request and
undone together.

*Rejected:* a record per row, because owner ruling 2's own example counts two
records for two casts of one spell; writing the figure into the weapon's
`system.bonus`, which is masterwork's field and is erased by the next recompute;
refusing a magic weapon at the pick, since the row pair already splits it.
*Cost:* Undo on one modifier entry takes the cast's other modifiers off that
target (its tooltip says so); a buff stays with the holder if the weapon is
traded; the card can read stale against a later change.

## 2026-11-16 — The relay builds every record from the spell's rows

S2a's relay built a condition's records from `card.rows`, the display rows of a
message the requesting seat wrote, while this model says a record is built from
the spell's row: a seat could have named a condition, a duration or a `lasts`
the spell does not carry. Every record, whichever client writes it, is built
from the spell's own keyed rows for the card's mode and picks (`castInputs` in
`cast-apply.mjs`); `applyOnTarget` has no fallback to the card, and `card.rows`
is display only. The GM's client recomputes the duration from the spell and the
card's caster level, and reads the spell's id and page and the caster's
alignment from the documents. A `dice` duration was rolled on the casting
client and cannot be recomputed, so the card's figure stands where it lies
between the formula's extremes in the same units, and the shortest otherwise.

*Rejected:* comparing `card.rows` with the spell's rows, which is a second copy
to keep equal. *Cost:* a Judge's edit to the spell between the cast and an
Apply changes what applies; the edit is the Judge's. The card's caster level and
the spell's save still come from the card, which the seat's own cast supplies.
