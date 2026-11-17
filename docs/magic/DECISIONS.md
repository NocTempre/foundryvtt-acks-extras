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
- 2026-11-11 — [A cast's end is told on a card, read from the module's own clock math (2026-11-11)](DECISIONS-through-v11.14.5.md#a-casts-end-is-told-on-a-card-read-from-the-modules-own-clock-math-2026-11-11) — its cost line ("a combat's rounds do not age a record") qualified 2026-11-17 by [A condition row can last turns, and lib ends it](#2026-11-17--a-condition-row-can-last-turns-and-lib-ends-it)
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

## 2026-11-16 — Concentration's end is one funnel on the deleting client

The owner: "automation with transparency is the design principle". Plan ruling
31 made the end of a concentration end the cast's recipient records, with the
primary GM's client driving what the seat does not own and a card with a Judge's
Restore; ruling 24 named the loss and left the trigger to lib's `STATES_LOST_HOOK`.
That trigger is superseded in part, with new evidence the ruling did not know: the
cause of an end exists only on the client that deleted the record, and the hook
fires after the delete and only on the client that ran lib's loss path. It
therefore misses the status's own toggle on the HUD, a hand delete, a recast and the
cap running out, which delete the record without going through that path.
Observed on `main`: `deleteActiveEffect` fires on the deleting client inside
`toggleStatusEffect` for a linked actor and for an unlinked token's, and the
operation's options reach it.

The caster's held record (status-only, `concentrating` or
`concentratingStationary`, carrying the kind held and the tail) is the trigger:
magic's `deleteActiveEffect` hook acts when `userId` is this user's, reads the
cause synchronously (the cast's own delete names `cast` or `time` in the
operation's options, else lib's `lossInFlight` gives `damage` or `save`, else
`removed`), ends the recipient records that client can write by the tail (deleted,
re-timed from now, or kept and listed with End), relays the rest to the GM's
client through `magicHeldEnd`, and posts one card. A cast through the module, or
a declaration, ends the caster's held records at its spend, after the spend and
before any record of the new cast (the dialog warns and never refuses, and a
cancel costs nothing). The GM's client takes the tail from the spell, never from
the request, and accepts the request from a user who owns the caster once no held
record of the cast remains; with no GM connected the records stay and are listed.
Restore is the Judge's: the card's flag holds each ended record's data, and Restore
writes back only the keys this module writes of a record carrying the card's own
cast and caster, with no changes. The card is posted by the deleting client, which
may be a seat, so its flag is the seat's word; the shape check above bounds what a
forged one can write, and a GM presses Restore knowing what the card says.

*Rejected:* `STATES_LOST_HOOK` as the trigger, for the cases above; the primary
GM's client as the driver, since it cannot see the cause. *Cost:* a seat that
disconnects mid-funnel leaves recipients standing with no card, which a Judge ends
by hand; a cast outside the module ends no concentration (lib ROADMAP); deleting a
caster's whole actor fires no hook for its records (ROADMAP).

## 2026-11-16 — A declaration spends at its confirm and lapses with the caster's next turn

The owner: "1 stops, 2 spells track separate, effects don't stack but can
overlap" and "Don't forget to track interaction with spells per day". Plan ruling
23 has a declaration spend at its confirm, since the seam's `spend` stops working
once the cast settles and a disrupted declared spell counts as cast; this entry
builds it and settles what the plan left open.

In a begun fight a cast at any moment but the caster's own rolled turn declares: it
spends once, ends the caster's concentration, writes a status-only `casting`
record and a status-free pending record and posts no card; at the turn the pending
record resolves the cast with its stored answers, no dialog, no capacity check and
no spend. The pending record alone is the declaration. Core's `acks.prepareSpell`
follows it, but a Player cannot update a combatant (observed live: "lacks
permission to update Combatant"), so the GM's client sets and clears it through
`magicDeclareFlag` on request, checked as the requester owning the combatant's
actor and a pending record of that caster naming the fight; with no GM connected
the flag is left alone and nothing depends on it. A flag set by hand counts as a
declaration for the missing-declaration verdict, as the plan says; its cast then
runs fresh, asks and spends, since the module cannot tell whether the Judge has
already lowered core's count.

A declaration lapses when the caster's own turn that follows it ends unresolved
(`lapseRound`: this round where the caster's turn is still to come or its
initiative unrolled, next round's once it has passed), and when the fight is
deleted; the primary GM deletes the records and the spend stands. A turn ends
when the round advances or the tracker moves forward to another combatant; a
change of the current combatant that is the tracker re-sorting after an initiative
roll (the same combatant at a new place, or another taking the same place) ends
nothing, and neither does a move backward. Core may have reset the initiatives
of a round that is opening, so an unrolled initiative is no reason to skip a turn
that ended. A Judge's fresh cast through a lost declaration ends it.

*Rejected:* a pending record that waits any number of rounds, because core resets
initiative each round and lib lifts `casting` at the turn with no hook, so a later
round's record could no longer be lost and would resolve unspent; a combatant flag
as the declaration, since a Player cannot write it. *Cost:* a misclicked
declaration is spent (the Judge lowers core's count by hand); a declaration made
after the caster's turn waits for the next round's turn; a Judge's second
declaration replaces the first, which stays spent.

## 2026-11-17 — A cast's save meets defenses over the spell's rows, not the rolled ones

The damage a target's save resists (plan ruling 71) is the union of the types of
the spell's own damage rows for the mode and picks that the save governs, whether
or not a row's figure was read. The cast and the relay both compute it the same
way from the spell, so the throw the relay recomputes is the throw that was
rolled; a union built from the rows the card opened could not be reproduced on
the GM's client without trusting the card. An unstated quality is stated only
where every such row states the same one, else it is undetermined and a band that
waits on it is the Judge's. A defense case the module does not price changes no
number: the resist lists it as `defensePending` and the card's save tooltip says
so, so a throw that went undefended is never silent about it.

*Rejected:* building the union from the card's rows (the relay cannot check it);
skipping rows whose figure is blank (a second source of truth for the relay to
reproduce). *Cost:* a spell with a damage row whose figure was left unread beside
a damage row of another type reads as dealing both types, so a defense covering
only the rolled row's type is partial and the save is rolled; and a spell whose
save effect the module cannot price (neither negation nor half) is the Judge's
before its defense stage, so an immune target of such a spell is also the
Judge's.

## 2026-11-17 — A throw row is thrown once per instance, split among the targets

The owner: "Spells want their proper effects, damage/effects should apply with
correct amount and type", "Damage should just use "magic" as a weapon roller
type" and "automation with transparency is the design principle". A damage or
heal row's `value` is its instance count (plan ruling 88), held to `max` and
read at the caster level; a row with no throw rolls once for the count, and a
row with a throw is thrown that many times, each throw one core
`makeAttackThrow` on the spell's carrier, split among the targets in the
cast dialog (round-robin by default, the split editable). An entry per target
and row holds the instances; each hit rounds and meets the target's defenses
alone, the amounts are summed, and the entry writes one `adjustHp` and takes one
Undo. Over-allocation is `tooManyInstances` (a Player blocked, a Judge warned),
and `severalTargets` is left for a count of one or a blank one.

*Supersedes plan ruling 41 in part* (2026-11-16: a throw row takes one target,
several targets block a Player), on new evidence: two of this slice's rows print
several throws per cast split among targets, which no earlier row did. Ruling 41
stands for a count of one. The cast also owns the seat's targets around each
core throw (plan ruling 89): exactly the instance's token, the prior targets
restored in `finally`, because core aims a throw at the seat's targets and the
presser's were wrong for a Throw press.

A blank count (unread, or needing a level none resolved) makes no throw and no
roll and posts the page reference: a count is never defaulted.

*Rejected:* an entry id per instance (the relay, Undo and the card's keys all
address an entry by target and row); one throw per target (a count above the
target count would lose throws); core's `buildAttackThrow` (it skips core's
dialog and card); patching core. *Cost:* a card per cast holds the split and
every instance, so a large count writes a larger flag, and other seats see the
caster's targets flicker during a throw. *Counter (medium):* a page that splits
by creature needs another default; the split is editable.

## 2026-11-17 — A condition row can last turns, and lib ends it

The owner: "cast time and spell duration (and if it requires concentration to
hold) are the other obvious buckets to think about", "1 stops" (a record that
runs out stops applying by itself, nothing pressed), "2 spells track separate,
effects don't stack but can overlap" and "automation with transparency is the
design principle". A row's `lasts` gains `nextTurn` and `rounds` (plan rulings
94 and 95; the `rounds` figure is the row's own dice formula, read from the
page). In a begun fight, with the bearer a combatant of it
(`cast-moment.mjs` `fightHolding`, the same begun-fight notion `castMoment`
reads), a condition record carries lib's `turnLife` flag: `nextTurn` ends at the
end of the bearer's next turn (`{edge: "end", count: 1}`), `rounds` at the start
of the bearer's turn that reaches the rolled count (`{edge: "start", count}`).
Every such record also carries its `startTime` and the flag clock of one round,
or the rolled rounds, at `ROUND_SECONDS`; whichever end comes first deletes the
record by id, lib's at its turn edge and the clock's at the next step. Outside a
fight, with the bearer no combatant, or after the fight, the clock alone ends it.
The turn handling stays lib's (`status-effects.mjs` fires the turn hooks on the
primary GM and lifts the record); magic registers no tracker hook.

The rounds count is rolled once per target's record on the casting client, at
the cast, shown on the card, and carried in the apply request; the relay holds it
to the reach of the spell's own formula (`badRounds`) and reads whether the
bearer holds a turn on its own client, never from the request. A rolled total
below one lasts one round, the floor the damage rolls also keep. A blank formula
leaves the record untimed, with the page reference alone on the card.

*Qualifies the cost line* of "A cast's end is told on a card, read from the
module's own clock math" (2026-11-11: "a combat's rounds do not age a record"),
on new evidence: the rows this slice adds last a next turn or a few rounds
inside one fight, and the world clock does not move while a fight runs, so the
clock alone would never end them. The ruling's other parts stand: the clock
remains the only end of a record with no turn to count, and core's `expired` is
still not read. A turn-anchored record is the one kind a combat's rounds age,
and only through lib's flag; a record with a duration and no flag is aged as
before.

*Rejected:* counting the combat's rounds (initiative is rerolled each round, so
a round is no fixed span of one creature's turns); magic listening on
`combatTurnChange` (a second owner of turn handling beside lib); one roll per
row for every target (every target's record would end together, where the
owner's "spells track separate" treats each record as its own). *Cost:* a write to the record's flag
at each of the bearer's turn starts for a `rounds` record. *Counter (medium):*
the end edge of a next turn is not printed on the page it is read from (owner
question F, at its default), so the Judge deletes the record by hand where a
table reads it another way.
