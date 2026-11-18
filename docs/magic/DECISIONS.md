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

## 2026-11-17 — Tracked rows and the built summons (1d-A)

Session 1d-A's rulings 150 to 156 of the spell-effects plan, with the counter
each carries.

- **A tracked row is a card line plus a caster record (150, ruling 14),**
  `lasts: "duration"` wherever it lasts, so the record is written only for a
  row that says it lasts; thirteen first-level entries carry them, reversed
  twins as their own rows. *Rejected:* `noteFrom` clause lines, which would put
  page prose on every card. *Counter (medium):* until 1d-B the footnote reads
  only the row's subject.
- **Three spells wait for 1d-B (151)**: delayDisease, purifyFoodAndWater and
  sealPortal, each needing a kind the vocabulary lacks. sealPortal is a third
  kind beyond the two the brief named. *Rejected:* `structural` or `ward` for
  sealPortal. *Counter (low):* one kind more than named.
- **The built summons get rows (152)**: callOfTheWolf (a calling) and
  summonManes (a summoning) each with its ref, and conjureCacodemonSpawn (a
  conjuration, Hit Dice located, no ref because its creature imports as a
  template actor). `control` is read from the page and counts are located with
  `articles`; `ROW_KEYS` gains `summonFormat` and `control`. *Counter (medium):*
  the spawn can only be cast by the Judge.
- **faithfulCompanion and unlivingPuppet carry summon rows (153)**, their Hit
  Dice coming from the remains. *Rejected:* a control or transform line through
  `castSpell`, which reaches no map and has no Dismiss. *Counter (medium):* the
  page files these under death spells, and neither path checks the remains.
- **On a summon row, `max` is the count's ceiling at the caster level (154)**,
  carried unresolved by `summonOptionsOf` until 1d-B resolves it.
- **1d-A changes `cast-summon` only where no level or tradition is read
  (155)**: a concentration shape writes the held caster record, and a new cast
  ends the caster's existing concentration after a warning, the same to a
  Player seat and the Judge. Both are additive, behind optional deps; this
  qualifies the 2026-11-11 cost line for a concentration only. *Counter
  (medium):* a held summons' end posts no Dismiss.
- **To 1d-B (156)** is the roadmap's list: caster level for count and duration,
  the capacity verdict and the tradition's pool spend, placement range,
  abilities and declaration in a fight, Dismiss on a held summons' end, a row
  `name`, a summon describe arm reading `max`, the default arm naming its kind,
  the three kinds of 151, and a cast that opens no entry measuring no target.

Owner questions, each proceeded on at its default: **1d.1** animation spells are
placed through the summoning cast; **1d.2** callOfTheWolf's token is placed at
the cast and the arrival delay is the Judge's; **1d.3** predictWeather lasts
`instant`; **1d.4** the sizes of illusoryFigment, wallOfSmoke and iceFloe stay
blank; **1d.5** a summons in a begun fight resolves at once, until 1d-B;
**1d.6** a held summons' end leaves its creatures with no prompt, until 1d-B.

Two findings recorded with the entry. summonManes's `control` is read from its
own page (obedient), which differs from the JJ format note: an owner check, the
page being what the importer reads. summonManes carries no `amount`, because
`summonRefusal` caps a count at `amount` and its count scales with the caster
level; the scaling is `max`, so the cast is capped by nothing until 1d-B reads
it. *Cost:* until then a Player's count for that one spell is held only to the
prompt's own ceiling.

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

## 2026-11-18 — The cast dialog is an ApplicationV2, and its targets bucket is the user's targets

The owner: "Targets should be an inventory bucket that can be added/subtracted
from with X as well as drag and drop. Borrow the color and symbol language from
the character sheet for effects, not just text." The dialog moved from a
`DialogV2` form to an ApplicationV2 (`HandlebarsApplicationMixin`, a scrolling
body and a pinned footer), because a bucket that changes while the window is open
needs parts that render on their own and a drop target, neither of which a
dialog's one content string gives. The bucket IS `game.user.targets`: an X is
`setTarget(false, {releaseOthers: false})`, a drop or the Add my token button is
`setTarget(true, {releaseOthers: false})`, and the window re-renders on
`targetToken`. The cast reads the targets again after the answer, so the bucket
and the cast cannot disagree. Plan rulings 124 (a weapon pick per holder, keyed
by token uuid), 126 (the spell's own save modifier is a dialog toggle, added as
written, and the card stores only that it was applied) and 139 (a kind select
over the `vsKinds` of the rows that offer a choice) land with it; an Actor drop
with several active tokens asks for the token itself (owner question 1c.30).

*Rejected:* a private list the window keeps (a second source of truth: a target
set on the canvas would not show and an X would not clear the seat's target, so
the cast would act on what the window did not show); a GM-only read of other
users' targets (targets are per user, and a Player's window works from its own);
an `isOwner` gate on the controls (the doctrine is block a Player, warn a Judge,
by verdict). *Cost:* a re-render on every target change, which costs the focus of
a field being typed in, so the window captures its named controls before each
render and a split input's typing waits for its change event. *Counter (medium):*
a Player's X unsets that Player's own target only, which is correct for the cast
and surprising beside a shared targeting habit.

## 2026-11-18 — A declared cast resolves on what was declared

The owner: "BTW, in combat, they should get this popup when they declare casting,
so when it gets to their turn it's ready to resolve." The popup was already the
declaration's, but the answer it stored was incomplete: the targets and the throw
split were not kept, so the cast at the turn read whatever `game.user.targets`
held then, on whichever client pressed it. The pending record now stores the
seat's target uuids and the split, in one table of answer fields
(`ANSWER_FIELDS`), and the turn finds the tokens by uuid, makes them the user's
targets and resolves on them with no dialog. Example: a caster declares at two
foes, the Judge targets a third while the round runs, and at the caster's turn
the card is made for the two declared. Where a declared token is gone, or a
stored weapon no longer fits, the dialog opens prefilled with the stored answer
and the remaining targets, with a notice.

*Rejected:* reading the user's targets at the turn (what the owner's "ready to
resolve" excludes); storing token names beside the uuids so a notice can name a
deleted target (a copy that can only drift; the notice counts them); opening the
dialog at every turn (the declaration's point is that it need not). *Cost:* a
record written before this carries no targets and resolves on the user's as
before; a token on another scene is in the seat but cannot be targeted on the
canvas. *Counter (medium):* a Judge who retargets at the turn expecting it to
count finds the cast on the declared seat; the seat changes only where a declared
token is gone (the dialog reopens) or by declaring again.

## 2026-11-18 — The invocation level's edges (R-b, rulings 200 to 202)

Three calls the rulings left open, made while building the magic half of the
level.

An invocation bound that is missing or runs backwards drops its row at the
import, `onMiss: "blank"` or not. A blank figure is only an unread one, but a
row with no bound stands at every level, which is a wrong effect. Example: a
row whose upper bound reads as nothing would apply at every level above the
one the page prints. The per-option `conditions` miss is the precedent for a
blank that is not allowed to leave the row.

`invocationUnset` is drawn only where a raw row or figure reads the scale. A
tradition whose cap offers the level but whose rows read nothing misses
nothing, so a Player is not blocked on a control the cast never reads. The
alternative, blocking whenever the level is offered, would stop every capped
cast until the dialog's control exists. *Counter (medium):* a procedure that
reads the level from the card (rulings 205 to 207) gets no value from a cast
that left it unset, so it must ask for the level itself or add its own verdict.

`flattenAt` copies only the branches that change and hands back every other
row as the very object it was. Ruling 200 says "copies"; a row with nothing on
the scale needs none, and nothing in `scripts/magic` compares rows by identity.
A flattened row is a new object and the spell's own is never written.

## 2026-11-18 — The procedure seam's edges (R-p, rulings 204 to 206, 214, 215, 228) — SUPERSEDED IN PART 2026-11-18

Calls the rulings left open, made while building the seam.

`perform` runs at every moment but `declare`, `long` included. Ruling 206(d)
says "at the free and resolve moments only"; read to the letter it would run a
Judge's long cast's rows with no procedure step, which is the cast the ruling
says resolves at its confirm. Reading it as "never at a declaration" keeps one
rule: a declaration performs nothing, every cast that resolves performs.
*Counter (medium):* a tradition that wants no performing on a long cast must
check `ctx.moment` itself.

A procedure's finding is `{key, notice}` where `notice` is the text the seat
reads, worded by the procedure, which owns its lang keys under its own root.
The plan gives the severity and the dialog and the cast's notice print the text.
The alternative, a lang key the cast localizes, would tie a tradition's strings
to the magic root. *Counter (medium):* a text is localized where it is built, so
a procedure that caches one keeps it in the language of the moment.

The procedure's answer is one object, `answer.procedure`, and ruling 214's
`buckets` is its reserved key; the declaration stores it with the tradition kind
(`procedureKind`) so a lost declaration finds the procedure without reading the
class again. The controls of a band are named `procedure.<key>` and are read
back under `<key>`.

A stored bucket entry the world no longer holds reopens the dialog on what was
declared, as a gone target does, in addition to the `bucketChanged` verdict.
With the verdict alone a Player would be refused with no dialog to fix it in.
*Counter (medium):* until the bucket's own control exists the reopened dialog
can only show the verdict, so a Player's declared cast with a missing item is
blocked until the Judge casts it.

A `perform` that throws leaves no section, so the card carries a line of the
module's own saying the step did not complete. The spend and the end of the
caster's concentration have already happened by then. *Counter (medium):* the
spend is not given back.

Each member of a procedure is called through one guard that logs a throw and
answers as if the member were absent, so a faulty procedure cannot take the
dialog down. A second registration of a kind replaces the first, as
`registerCastSpell` does.

A rowless ritual spell whose tradition has no procedure is not claimed, since
the claim needs rows or a procedure, so `ritualPending` is never drawn for it and
the system casts it as before. Ruling 224 stands for the spells the claimant
takes.

## 2026-11-18 — A lost item leaves the cast, and the band is headed by its tradition (R-p2, rulings 231 and 232)

Supersedes, in the entry above, the paragraph that reopens the dialog on a stored
bucket entry the world no longer holds and the `bucketChanged` verdict it paired
with. The entry is under 7 days old; the new evidence is the owner's answer to
R-p's question, ruling 231: "They have to drag a valid component to the spell. Edge
case of item is lost before use removes it from attached cards too." The interim
block R-p offered is the default the owner did not take.

An entry exists only by a drag of a real document, so no typed path stands and the
procedure's answer keeps the buckets' key out of reach of a field and a control.
An item that leaves its holder before the cast uses it is struck from the stored
answers at the moment it leaves, by the client that made the change, so a Player
never meets the loss as a refusal. `deleteItem` carries a delete. The update half
reads a stack left empty, because an item's uuid names its holder and a move to
another holder is a delete and a create under another uuid; Foundry has no update
that changes an item's holder. At the cast an entry still missing (the strip
could not reach it: no GM to ask, a write refused) is dropped without a word, and
the bucket's own verdicts judge what is left. A seat that cannot write a record
asks the GM's client, which authorizes on the fact that the item is gone, never on
the asker's ownership. *Counter (medium):* a Judge or Player who drops a component
in the dialog and then deletes it sees the entry vanish from a declaration with no
notice; the cast card's coverage verdict is where the shortfall shows. A strip is
not an undo: a restored item is dragged in again.

Ruling 232, "Name per tradition": the band's heading is the tradition's. A
procedure supplies a `label` (a lang key its tradition owns); without one the
heading is the tradition's own label, and a tradition with neither keeps the
generic Invocation string. The one menu stays. *Counter (low):* a procedure whose
label has no string in the language falls back to the tradition's label rather
than printing the key.

The strip reads every actor's effects at each delete of an item, and each update
that leaves a stack empty. *Counter (low):* a world with thousands of effects pays
a scan per such write; only a pending record that names the uuid costs a write.

## 2026-11-18 — The Invocation band: one menu, an inventory bucket, and the pick on the answer (R-c, rulings 202, 228, 229, 231, 232)

Builds board 7 as approved ("Approve as drawn"; the owner on the band: "Invocation
should be one menu, not a series of them"; on the line: "Inventory, not a check box";
for BtA's implements: "BTA implements should follow raw with values and tiered
effects. You get the effect you use the supply for..."; the heading: "Name per
tradition"). Calls the rulings left open:

The level's options are the whole levels from 1 to the top of the cap ladder (or the
cap, if higher), not the distinct rung values. A ladder of 1, 2 and 4 would otherwise
offer no 3 under a cap of 4, and 202 says the range is 1 to the cap. *Counter
(medium):* "options come from the ladder's rungs" read strictly lists rung values.
With no cap read every level of the ladder is offered; with no ladder at all there is
nothing to list, so the level stays 202's number box, marked as set by hand.

The pick of a `pick: "one"` bucket rides the procedure's answer as `picked[bucketKey]`,
a reserved key beside `buckets`. BtA's branch names no key (`usableSets` has no caller
yet), so this is the contract its procedure reads. The window stores only the seat's own
pick; the pick the cast opened on is read again, so it follows the invocation level and
the rows. *Counter (low):* a seat that picks, then raises the level past that set,
loses the pick silently and the lowest reaching set stands.

The bucket's findings and opening pick are read synchronously from the stored uuids
(`ctx.resolve`, the cast's `fromUuidSync`), not from the window's async entries, so a
declared cast is judged again at its turn with no dialog, and a pick lost before the
turn (ruling 231) opens on the lowest set that still reaches. Lib's `entriesFromAnswer`
and `entryFromDrop` serve the window's drawing and drops. *Counter (medium):* a
compendium uuid resolves to an index entry synchronously, so only world and actor items
are judged; implements are carried items.

The cap's tooltip names the ladder and the class level and carries no page: the class
ladder holds none, so the page reference is a ui-tooltips finding, not borrowed from the
spell. An implement row's page is its procedure's `cite`.

## 2026-11-18 — A declared cast keeps its level and its pick (S-R, finding 1c.35)

The level and the procedure's answer (buckets and the pick) were already fields of the
stored answer (`ANSWER_FIELDS`); R-c is what writes them, so a declaration made in the
dialog now resolves at its turn from the level and the pick it stored, with no dialog.

## 2026-11-18 — The research, ritual and sacrifice figures are imported rows (M-i, rulings 219, 227) — SUPERSEDED IN PART 2026-11-18

Every figure the research, ritual, sacrifice and power-ledger slices read is printed,
so it arrives through the importer into one registry document, `magicResearch`, and
nothing ships as a constant: the research ladder, the other-projects rate its footnote
gives, the ancillary share, the automatic-failure band, the substitution penalty and
its minimum, the assistants' levels and counts, the library, workshop, ritual-library
and ritual-workshop minimums, steps and bonuses, a library's share of a research's
spend, the sample's bonus, identification's costs and level, the ritual costs by level,
the victim-trait table, both power lifetimes and the demonologist's multiple. The
recipes are a file of the Rulebook's own folder (`books/rr/table-recipes-research.mjs`,
merged by `books/rr/index.mjs`), so the Treasure Tome work in `table-recipes.mjs` shares
no hunk with this, and the book gate (`check-silos`) counts no new book reference
outside `books/`.

Rulings made in building it, each with the default proceeded on:

- **One table per passage, one reader per table.** A figure cites the folio that
  prints it, and the facility kinds are separate tables because each prints its own
  step, size and cap. A cap is never borrowed across kinds: an unread cap answers null,
  and so does the bonus that needs it. *Counter (medium):* the four bonus sentences
  read alike, so one shared row would be smaller; it would also state a figure on a
  page that does not print it.
- **The ladder footnote is read from its figure, not its mark.** The mark is a lone
  glyph that `gridRows` drops from the cells, so which rungs it marks is not read. The
  footnote names a rate for other projects and the reader takes the lesser of that and
  a rung's rate, which is the footnote's own effect; `researchRateAt` answers null for
  a capped read while the footnote's rate is unread. *Counter (medium):* it reads a
  rung as marked only if its rate exceeds the footnote's, so a page that marked a rung
  at or under it would be misread; the ladder is monotone and the marked rungs are the
  top of it, which the rules test confirms against the wiki capture.
- **The substitution penalty rounds toward zero.** The page says to round up with a
  minimum of one; read as a negative number's "up", the minimum has work to do, and read
  as a larger size it would have none. The helper takes the integer part of the
  pro-rated penalty and applies the minimum. *Counter (medium):* "round up" read as
  "away from zero" gives one point more on every uneven share. The page's worked
  example is exact either way, so it cannot decide; the helper is one line
  (`substitutionPenalty`) if the owner rules the other way.
- **A sacrifice row with no factor counts once.** The first trait prints the component
  value and no multiplication, which the reader reads as a factor of one. *Counter
  (low):* a row with no factor could be read as unknown; the row's own text says what it
  adds, so it is not.
- **The assistant count adds one per point of Intellect bonus.** The page prints "one
  assistant plus an additional assistant for each point", with no other figure than the
  base count, so the per-point ratio is the procedure and not a row.
- **Arcane power's lifetime is a unit with no count.** The page names the month and no
  number, so `arcaneLifetime` carries a unit and the reader's `count` is null; the
  ledger slice supplies the count.
- **Not imported here, by design.** The ritual's throw increase is "the level of the
  ritual spell", the item-creation effect-type costs and the spell-research cost per
  level are not named by rulings 219 or 227 and are not read; the XP award by level that
  ruling 226 values a character victim by is a class-experience table whose producer
  was not checked here. Each is reported as a finding for the slice that reads it.

The recipes' shape and each reader's parse of every field are held against the real
book by `test-recipe-content` (no figure asserted); the figures themselves are checked
against the fan wiki's capture in a local-only rules test (ladder, sacrifice, ritual
lists and scalars, as counts).

## 2026-11-18 — The substitution penalty rounds away from zero (owner)

This entry supersedes in part "The research, ritual and sacrifice figures are imported
rows (M-i, rulings 219, 227)": its bullet "The substitution penalty rounds toward zero".
The new evidence is the owner's answer. Asked "When the share is uneven (e.g. a -2.5
penalty), which way should it round?", the owner chose "Bigger penalty (-3)".

- `substitutionPenalty` rounds the pro-rated size up as a magnitude, so an uneven share
  takes the larger penalty, and the minimum still holds for any substitution. With an
  invented figure of 2 per level, a third-level spell with 0.4 substituted gives 2.4,
  which is -3, not -2.
- *Cost:* one point more on every uneven share than the reading this replaces.
