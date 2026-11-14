# Class powers & proficiencies — decision record

Rulings through v11.14.5: [DECISIONS-through-v11.14.5.md](DECISIONS-through-v11.14.5.md).

## In force

- 2026-08-30 — [A rung may say something other than a number (2026-08-30)](DECISIONS-through-v11.14.5.md#a-rung-may-say-something-other-than-a-number-2026-08-30)
- 2026-08-30 — [Ability throws resolve through the classes registry (2026-08-30)](DECISIONS-through-v11.14.5.md#ability-throws-resolve-through-the-classes-registry-2026-08-30)
- 2026-08-30 — [The level fraction is data, not a member of a shipped list (2026-08-30)](DECISIONS-through-v11.14.5.md#the-level-fraction-is-data-not-a-member-of-a-shipped-list-2026-08-30) — carried to the `progressionAs` effect by "A progression effect's fraction is data too" (2026-11-14)
- 2026-08-30 — [A throw may have no target at all (2026-08-30)](DECISIONS-through-v11.14.5.md#a-throw-may-have-no-target-at-all-2026-08-30)
- 2026-08-30 — [A tab panel declares its layout on the active state (2026-08-30)](DECISIONS-through-v11.14.5.md#a-tab-panel-declares-its-layout-on-the-active-state-2026-08-30)
- 2026-08-30 — [A throw may name a score; no importer recipe carries one yet (2026-08-30)](DECISIONS-through-v11.14.5.md#a-throw-may-name-a-score-no-importer-recipe-carries-one-yet-2026-08-30)
- 2026-08-14 — [An open family's entries are registered; a closed one's are code (2026-08-14)](DECISIONS-through-v11.14.5.md#an-open-familys-entries-are-registered-a-closed-ones-are-code-2026-08-14)
- 2026-08-14 — [A selection is chosen from a shortlist, and still typed when it is not on it (2026-08-14)](DECISIONS-through-v11.14.5.md#a-selection-is-chosen-from-a-shortlist-and-still-typed-when-it-is-not-on-it-2026-08-14)
- 2026-08-06 — [A modifier must name what it modifies, and may name the throw (2026-08-06)](DECISIONS-through-v11.14.5.md#a-modifier-must-name-what-it-modifies-and-may-name-the-throw-2026-08-06)
- 2026-08-06 — [An ability has a default throw, stored per item (2026-08-06)](DECISIONS-through-v11.14.5.md#an-ability-has-a-default-throw-stored-per-item-2026-08-06) — superseded in part by "The card renders its own dice (2026-08-31)"
- 2026-08-31 — [The card renders its own dice (2026-08-31)](DECISIONS-through-v11.14.5.md#the-card-renders-its-own-dice-2026-08-31)
- 2026-09-03 — [A weapon proficiency's boxes are the grant grammar, and a weapon's name is not a group (2026-09-03)](DECISIONS-through-v11.14.5.md#a-weapon-proficiencys-boxes-are-the-grant-grammar-and-a-weapons-name-is-not-a-group-2026-09-03) — superseded in part by equipment's 2026-11-11 rulings
- 2026-09-10 — [A companion is chosen into a slot the ability confers (2026-09-10)](DECISIONS-through-v11.14.5.md#a-companion-is-chosen-into-a-slot-the-ability-confers-2026-09-10)
- 2026-09-22 — [The imported rows say they are read, not applied (2026-09-22)](DECISIONS-through-v11.14.5.md#the-imported-rows-say-they-are-read-not-applied-2026-09-22) — superseded in part by "Imported modifiers apply (2026-11-04)"
- 2026-09-22 — [The extended sheet is the default (2026-09-22)](DECISIONS-through-v11.14.5.md#the-extended-sheet-is-the-default-2026-09-22)
- 2026-09-22 — [Active Effects live on the Mechanics tab (2026-09-22)](DECISIONS-through-v11.14.5.md#active-effects-live-on-the-mechanics-tab-2026-09-22)
- 2026-09-22 — [History the source comments carried, recorded (2026-09-22)](DECISIONS-through-v11.14.5.md#history-the-source-comments-carried-recorded-2026-09-22)
- 2026-11-04 — [Imported modifiers apply (2026-11-04)](DECISIONS-through-v11.14.5.md#imported-modifiers-apply-2026-11-04)
- 2026-11-04 — [A row's condition comes from the book or names its kind (2026-11-04)](DECISIONS-through-v11.14.5.md#a-rows-condition-comes-from-the-book-or-names-its-kind-2026-11-04)
- 2026-11-04 — [A row's other prose takes the same routes (2026-11-04)](DECISIONS-through-v11.14.5.md#a-rows-other-prose-takes-the-same-routes-2026-11-04)
- 2026-11-11 — [A throw's modifiers are the abilities' rows, and they name their parts](DECISIONS-through-v11.14.5.md#2026-11-11--a-throws-modifiers-are-the-abilities-rows-and-they-name-their-parts)
- 2026-11-11 — [An ability nobody classified is unknown, not a proficiency](DECISIONS-through-v11.14.5.md#2026-11-11--an-ability-nobody-classified-is-unknown-not-a-proficiency)

## 2026-11-13 — The ladder cache re-reads after a burst, and only for library items (T-0353)

**Asked.** Live stacks of a timed import (importer DECISIONS, 2026-11-13, "An
update pass costs a write, not a library read") showed the skill-ladder cache
reading every world Item pack whole while 729 item writes ran. `initLadders`
hooked every item create, update and delete; a hook started a refresh unless
one was in flight, so a loop of writes kept one whole-library read running
beside it, and a change that landed after a read had passed its pack was not
read again.

**Ruled.** The hooks ignore an item with a parent: an actor's copy is read live
by `importedLadderFor` and the cache holds only `game.items` and world Item
packs. `invalidateLadders` is a trailing timer, `LADDER_REFRESH_QUIET_MS`, so a
burst reads once after its last change and a change landing during a read
schedules the next. Each `refreshLadders` takes a generation number and assigns
its map only if no later read began, so a slow read never overwrites a newer
one. The map is still rebuilt without being dropped, since a roll reads it
synchronously (the 2026-09-23 formation ruling stands).

**Rejected.** *A dirty flag re-running after the read in flight:* it fixes the
lost update and keeps back-to-back whole reads for any burst longer than one
read. *Filtering the hooks to `def.skill.*` ids:* an update that removes the
flag would be missed; the parent test and the quiet window are enough.

**Cost.** A write to a library skill reaches a roll one quiet second after the
last write of its burst; until then a roll reads the map from before it. A top
level delete leaves the map holding the skill for that second.

## 2026-11-14 — A progression effect's fraction is data too

**Ruled** (owner: "Caught printed values are fixed on the spot"; "a figure a
page prints is imported; stop asking"). The 2026-08-30 ruling moved a throw's
`progression` target onto `atLevelNum` / `atLevelDen` and left the `progressionAs`
effect on the shipped shorthand: its schema, its editor select and the import
scan still chose among four fractions. The effect now carries the same pair; the
editor asks for a numerator and a denominator; the scan reads the words between
"of" and the pronoun through the importer's word table and `levelFraction`, and
a whole level stores no pair. The four-member shorthand is gone with it:
`PROGRESSION_LEVELS` is removed, the `atLevel` choice field is dropped from the
effect and from the `progression` target, and `levelFactor` and
`levelFactorLabel` read only the pair (a bare string, or a spec with no pair,
is the whole level). Owner, 2026-11-11: no tools for previous-version data; owner
(2026-11-14, 22:30Z): "NO legacy support was ruled long ago. They got one line in
the release to start fresh and all lang, warning, checks even are dropped."

**The session's call, owner may overrule.**

- The scan's capture is any one or two words before the pronoun, where the old
  pattern matched only the half. A proportion the table does not read drops the
  row, as a borrowed throw's does; before, such a sentence produced no row at
  all, so a page wording another fraction now yields a row where it yielded none.
- The shorthand and its decode map are removed outright rather than kept to
  read a stored row, on the owner's 22:30Z words above.

**Cost.** A row stored by an earlier build with an `atLevel` shorthand reads as a
whole level, and no tab line or editor box shows it. Reversing the call means
restoring `PROGRESSION_LEVELS` in `scripts/lib/vocab.mjs`, the `atLevel` field
in both schemas of `scripts/lib/fields.mjs`, and the shorthand fallbacks in
`levelFactor` and `levelFactorLabel`.
