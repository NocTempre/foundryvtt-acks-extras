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
- 2026-09-25 — [The order, and the scoping's eleven questions, ruled (2026-09-25)](DECISIONS-through-v11.14.5.md#the-order-and-the-scopings-eleven-questions-ruled-2026-09-25) — its answer 3 (click-to-place as the baseline) qualified 2026-11-25 (a caster marching inside a party is asked for no click) by [A summoning names its creature per seat, lists its creatures as rows and joins a caster's party](#2026-11-25--a-summoning-names-its-creature-per-seat-lists-its-creatures-as-rows-and-joins-a-casters-party-and-a-declared-cast-names-its-fight-board-3)
- 2026-11-11 — [A summoning spell's creature resolves on the GM's client (2026-11-11)](DECISIONS-through-v11.14.5.md#a-summoning-spells-creature-resolves-on-the-gms-client-2026-11-11) — its cast and its count qualified 2026-11-19 by [Summons join the spell cast](#2026-11-19--summons-join-the-spell-cast-1d-b-rulings-157-to-163); its exemption of a spell-named creature from the shelf-readable check withdrawn 2026-11-25 by lib's [A summon is refused by the casting user's level on the creature](../lib/DECISIONS.md#2026-11-25--a-summon-is-refused-by-the-casting-users-level-on-the-creature-and-a-spells-row-grants-nothing-t-0793); its "Creature N" label for an unresolved choice qualified 2026-11-25 (a seat that cannot open the creature reads the neutral label) by [A summoning names its creature per seat, lists its creatures as rows and joins a caster's party](#2026-11-25--a-summoning-names-its-creature-per-seat-lists-its-creatures-as-rows-and-joins-a-casters-party-and-a-declared-cast-names-its-fight-board-3)
- 2026-11-11 — [A cast's end is told on a card, read from the module's own clock math (2026-11-11)](DECISIONS-through-v11.14.5.md#a-casts-end-is-told-on-a-card-read-from-the-modules-own-clock-math-2026-11-11) — its cost line ("a combat's rounds do not age a record") qualified 2026-11-17 by [A condition row can last turns, and lib ends it](#2026-11-17--a-condition-row-can-last-turns-and-lib-ends-it); its rejection of deleting the creatures on expiry SUPERSEDED IN PART 2026-11-19 ("Remove automatically": a `gone` summons is removed at the timed end) by [A summons' control ends as its page says (1d.7)](#2026-11-19--a-summons-control-ends-as-its-page-says-1d7)
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

## 2026-11-17 — Tracked rows and the built summons (1d-A) — SUPERSEDED IN PART 2026-11-19

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

## 2026-11-18 — The power ledger and its chip (M-l, ruling 217) — SUPERSEDED IN PART 2026-11-18, 2026-11-25

Built to board 12, which the owner approved with the v19 canvas: "Approve spell cast
design". The art rule stands: "Find open art to attribute or better yet art/texture
imported from the book. Standing rule for repo no generated art." So an entry leads with
its source document's own `img`, else a Font Awesome glyph the strip already uses; the
board's gradient squares are placeholders and ship nowhere.

Ruling 217 and 218 as built: the ledger is `flags["acks-extras"].power`, magic's, not
`classes.pools` (which a rest clears); classes hosts the chip. Rulings made in building
it, each with the default proceeded on and the counter:

- **Expiry is computed at read, and nothing is written as time moves.** The balance is a
  function of `(entries, today, span)`. *Counter (medium):* a sweep on `updateWorldTime`
  could prune expired lots and keep the flag small; it would also make a dragged-back
  clock lose power for good and give every client a write to race.
- **Spent power takes from the oldest lot that still stands on the spend's day.** The
  page's "spent within" has to be applied to something once a gain is partly spent.
  *Counter (medium):* newest-first or a pooled balance with the earliest expiry would
  differ whenever lots of two days are held; the oldest-first order never lets power
  fade unspent while newer power is spent.
- **A lot expires once a whole span of days has passed since its day** (the day it is
  gained is day zero of it), so a lot gained on day 10 under a 30-day span stands on day
  39 and is gone on day 40. *Counter (low):* the last day inclusive would add a day; the
  page's words give no more than "within".
- **The span is whole calendar days, from the calendar the world runs.** A month is the
  calendar's year over its months rounded up, as core converts an effect's month in
  `cast-expiry.mjs`; a week is the calendar's own weekday list. A unit the calendar
  cannot say is no span. *Counter (medium):* the market's `daysPerMonth` setting is a
  second month in the family, but it carries a 28-day default, which is a figure.
- **A Judge's plus is a gain written by hand, and it fades like any other.** The minus
  is a spend by hand. *Counter (medium):* a hand adjustment could be a permanent offset
  that never expires; that would hide power from the lifetime the Judge imported.
- **The plus and minus are one pair on each tag, with no amount box; the board draws
  one pair for two tags.** One pair cannot name its kind without a selected-tag state the
  board does not draw. Each press moves one. *Counter (low):* a single pair acting on the
  pressed tag is closer to the drawing, at the cost of state a re-render drops.
- **The arcane count is a number box beside the arcane tag, for a Judge only, blank until
  set,** with the page reference in its tooltip. The brief orders the field and the board
  does not draw it. *Counter (low):* it could live on a window of its own, which would
  add a window for one number.
- **Undo is a Judge's, on a spend only.** The board draws it on a spend and not on a
  gain; a gain is taken back by the minus. *Counter (low):* a Player who made a mistaken
  spend could be allowed to undo their own; the board leaves it to the Judge.
- **A Player's spend beyond the balance is refused, a Judge's takes what is held and
  warns** (the 213 shape: a Player is blocked, a Judge is warned), so the ledger never
  goes below nothing. *Counter (low):* a Judge's overspend could write a negative balance
  for the Judge to settle later.
- **A relayed request is authorized on its sender**, as the declaration's flag handler
  is: a gain or spend is an owner's, and the hand adjustment, the undo and the count are
  the Judge's. Direct or relayed is decided by `canUserModify`, never by ownership.
- **The ledger is not stripped by the uninstall tool.** It is data the Judge may want
  after the module is gone, and the tool's contract is the spell primitive. *Counter
  (low).*

Findings, not changed here: lib's `powerEntry` holds a quantity to its cap only from a cap
of one up, so a row built over a balance of nothing counts one (`count` in `bucket.mjs`);
magic's `powerRow` returns no row below one. A week the calendar cannot list is null, which
cannot be checked offline: `calendar.days.values` is read as the weekday list on the live
walk only.

## 2026-11-18 — The ledger's plus and minus: the owner's two answers — SUPERSEDED IN PART 2026-11-18

This entry supersedes in part "The power ledger and its chip (M-l, ruling 217)": its
bullet "A Judge's plus is a gain written by hand, and it fades like any other". The new
evidence is the owner's answers to the two questions M-l raised.

- **One pair per tag stands.** Asked whether the plus and minus should be one pair on
  each tag or a single pair acting on the pressed tag, the owner chose "One pair per
  tag". The chip stays as built: the divine tag and the arcane tag each carry their own.
- **A Judge's plus may fade or stay.** Asked whether a hand plus should fade like any
  gain or stay until removed, the owner answered "Allow both". The Judge picks one of the
  two when adding: a fading point lapses at the lifetime, as before; a permanent point
  stands until a minus takes it. How the Judge picks is a new control, so it waits for a
  board variant the owner approves (`.claude/rules/ui-layout.md`). Until then every hand
  plus fades.
- *Cost:* a permanent lot is held apart from the lifetime the Judge imported, so a
  balance can carry power the page's span would have ended. The Judge chooses it each time.

The two points M-l left open were checked on the walk. Core 14's `calendar.days.values`
is the world calendar's weekday list, with the weekday objects themselves as entries, so
a week is that many days. The two page references (RR 388 arcane, RR 422 divine) are the
pages from which the M-i walk's import read both lifetime passages.

## 2026-11-18 — Research projects at a location, and the facility (M-q1, rulings 220, 221) — SUPERSEDED IN PART 2026-11-25

Built to board 10, which the owner approved, redrawn as a tab of the location sheet. The
owner on board 10: "Sure go with it." On where it lives: "Research board looks like it
should be tab of location." On the whole v19 canvas: "Approve spell cast design". The art
rule stands: "Find open art to attribute or better yet art/texture imported from the book.
Standing rule for repo no generated art." So a project leads with its subject's own `img`,
else a Font Awesome glyph by kind; the board's gradient squares ship nowhere.

Rulings 220 and 221 as built: a project is a record on the location,
`flags["acks-extras"].magic.projects[]`, beside the facility values at `magic.facilities`; the
researcher's sheet links to the project and does not own it, and no project Item sub-type exists.
The Research tab is `{id: "research"}` in the sheet's `TABS.primary`, after Storage, on every
location. Automation blocks a Player and warns a Judge: a facility share below the imported
minimum blocks a Player's project and warns a Judge's (`isOwner` is never the test; a request's
authority is the sender Foundry attested). Judgment calls made in building it, each with the
default proceeded on and the counter:

- **The kinds are spell, item, identify and ritual, and each reads the facility passages
  `research-tables.mjs` already separates.** Spell reads the library, item the workshop,
  identification the library, a ritual both of its own facilities. The kind names a mechanism and
  holds no figure. *Counter (medium):* finer kinds (an item's effect type, a potion against a
  scroll) would match the printed costs; no row imports them, so there is nothing to key on.
- **"Linked to the location" is the location's roster.** The characters a location holds as
  stored occupants or as tokens on its scene, character actors only; a row the Judge hides is
  still linked, since hiding is a view. Nothing else in the module links a character to a place
  except a henchman's `locationUuid`, which says where he was hired. *Counter (medium):* a link
  made on purpose, a second list on the location, would not move when a token does.
- **A facility's sharers are the open projects reading it, a ritual counting on both.** The block
  and the bonus read the same share (`value ÷ sharers`), and an unset value counts as nothing.
  *Counter (medium):* distinct researchers would let one researcher's two projects pool; the
  ruling's own words ("their number, counted from the location's open projects") settle projects.
- **The gate is made when a project starts.** `acksExtras.magic.research.gate` and `verdicts`
  are what crediting (M-q2) and finishing (M-q3) call again. *Counter (medium):* refusing an
  update too would stop a Judge lowering the facility under a running project, which the Judge
  owns; the block belongs to starting and to the acts that spend.
- **A figure not read blocks and warns nothing.** With nothing imported, or no level entered,
  the verdict is `unknown`, the bonus is null and the chip is a page reference alone. *Counter
  (low):* warning that nothing is imported would say something the Judge already sees on the
  chip.
- **An identification's minimum is the imported research figure of that passage.** The reader's
  own note says the identification kind prints no minimum and that its minimum is the research's
  cost; `readIdentification().research` is read as that. *Counter (medium):* no gate on an
  identification at all, with the bonus left blank; the owner should read RR 393 against it.
- **The three costs are entered by the Judge, blank until entered.** M-i imported no spell
  research or item creation cost (DECISIONS, "Not imported here"), so no formula ships. *Counter
  (STRONG):* computing a due from the level is what the Judge-tools rule would want, and it waits
  for those rows to be imported; until then a Judge types them and the tooltip carries the page.
- **Who writes which field.** A Player's seat may start a project for a character it owns, with
  the subject, the level of effect and the assistants, and later change the subject, the
  assistants and the components. The costs, the material paid, the throw and, after the project
  exists, the level are the Judge's, refused with `judge` where they run. *Counter (medium):* the
  level lets a Player pick the minimum their own project is read against; it is the Judge who sees
  the project and can correct it, and a Player who could never enter it would leave every Player
  project unread.
- **A project is closed, never deleted.** It stays on the record, counts for no facility and is
  listed apart. *Counter (low):* a Judge's delete would keep the record small; nothing needs it
  yet.
- **The researcher's sheet link is derived, not stored.** `research.projectsOf(actor)` answers
  the open projects an actor is on across the world's locations; nothing is written on the
  character. Board 10 draws no element on the character sheet, so none is built here. *Counter
  (medium):* a link on the sheet is the ruling's literal words; whether to draw one is an owner
  question.
- **The material is recorded, not charged.** `paid` holds what the Judge says was paid at the
  start, with its day; no coin leaves the researcher. *Counter (medium):* deducting from the
  researcher's purse would match the ruling's "paid at start"; which purse, and what a refusal
  costs, are for the crediting slice to decide with the day rate.
- **The components bucket is lib's bucket, stored as a lib answer.** `bucket: [{uuid, qty, fit}]`
  re-resolves at read, so a row's value is the document's now, and a drop of an item, actor or
  token adds a row. Power rows are not accepted here; the ritual and sacrifice slices bring them.
  Settlement is M-q3's. *Counter (low):* a snapshot of each row's value would not drift.
- **The throw is displayed, not combined.** The panel shows the stored target where one is
  written, else the ladder's throw for the researcher's level; the facility bonus is a chip beside
  it, never subtracted. Resolving the throw is M-q3's. *Counter (low):* showing the bonused
  target would be what a Judge reads at the table.
- **Not drawn in M-q1:** posting days, the day strip and the pace choice (M-q2). Finish is drawn
  disabled with its reason as text beside it (M-q3 enables it). *Counter (low):* leaving Finish
  out would remove a control that does nothing yet; the board draws it, and the reason it states
  is true of the record.
- **Controls write by their own listener, not the form.** The sheet submits on change, so each
  Research control stops its change event and calls the API; none is a named field, and the
  facility inputs exist only on a Judge's render. *Counter (low):* named fields under
  `flags.acks-extras.magic` would save a handler and let any owner of the location write a
  facility by form submit.
- **A write rewrites the field it changes** (the whole `projects` array, or `facilities`); direct
  where Foundry lets the seat write the location (`canUserModify`), else asked of the GM's client
  under the handler `magicProject`. *Counter (low):* an array path per project would write less
  and race less; Foundry's flag update replaces arrays whole either way.

## 2026-11-18 — The hand plus: a Fades/Stays switch (owner, board 14 B) — SUPERSEDED IN PART 2026-11-18, 2026-11-25

This entry supersedes in part "The ledger's plus and minus: the owner's two answers": its
sentence "Until then every hand plus fades", and qualifies "The power ledger and its chip (M-l,
ruling 217)" on one bullet: "Spent power takes from the oldest lot that still stands" now
reads fading lots first. The new evidence is the board the first entry waited for. Board 14
drew two ways to choose: A, a menu on the plus ("Recommended" on the board), and B, a switch
beside each pair. The owner chose B: "B: Fades/Stays switch", and on what it does: "a
Fades/Stays switch beside each +/- pair sets what + adds, with the pin and 'stays until
removed' on the row, and − spending fading points first, as drawn." Both earlier answers
stand and are built on: "Allow both" (a Judge's hand plus may fade or stay: one press of the
plus adds one point that stays after Stays is pressed, one that fades after Fades is) and "One
pair per tag" (the divine tag and the arcane tag each keep their own plus and minus, and now
their own switch).

Built as drawn. A Judge's strip carries a pair of pills in a group, Fades first and pressed,
beside each tag's plus and minus; a Player's strip draws none of it. A point that stays is a
gain with `stays: true`: no lifetime, so it never expires, counts in the balance past any span
and is never due to fade. Its row is led by a pin with "stays until removed", and the chip's
tooltip names it for that entry. A spend, the minus, `spend` and `settle` alike, takes fading
lots first and then lots that stay, each oldest first. Judgment calls made in building it, each
with the default proceeded on and the counter:

- **The switch's state lives in the strip's closure and every render starts it on Fades.** The
  board says so: "state that a re-render resets". A plus writes the actor, which re-renders the
  sheet, so a Judge presses Stays again before each point that should stay, which is what
  choosing from board A's menu costs per press. Fades is also the safe resting state: a
  forgotten Stays would write permanent power. *Counter (medium):* a state kept by the sheet
  window, or by actor and tag, would survive a render and spare the second press; two windows
  on one actor would then share it, and a Stays left on would be written by a later plus
  with nothing on the screen having changed.
- **The mark is a key on the entry, written only on a gain a Judge marked.** A stored entry
  without it reads exactly as before, so no flag is migrated. *Counter (low):* a `permanent`
  list beside `entries` would need its own spend order and its own undo.
- **The spend order follows the mark, not the lifetime.** With no lifetime imported nothing
  expires, yet a minus still takes unmarked points before the ones that stay, so the switch
  means the same with and without an import. *Counter (low):* one pool oldest-first while
  nothing fades would ignore the owner's "fading points first".
- **A gain that stays is a Judge's act on every path.** The API's `gain` takes `stays: true` for
  a Judge and answers `judge` to a Player, before any request is sent; the relay handler
  refuses it on the sender Foundry attested; the apply step keeps the mark only for a Judge
  sender as a third guard. The mark does not need `by: "judge"` beside it, so a Judge's
  ritual or sacrifice slice may write a lot that stays without calling it a hand figure.
  *Counter (medium):* requiring `by: "judge"` would keep every permanent point visibly a
  hand figure; the later slices have no such rule to meet and the row names the source anyway.
- **A lot spent to nothing shows "Used up" and no pin.** The pin and the caption mark a lot
  that is still held. *Counter (low):* a spent lot could keep its pin.
- **Board A's clock glyph on the fading caption is not built.** Board B says "rows and tooltip
  are as in A" and the request lists the pin only; a fading row keeps its existing caption.
  *Counter (low):* the clock would make the pair of captions read alike.
- **Each tag, its plus and minus, its switch and its count box wrap together as one group.**
  The board draws each tag on a line of its own; the group lets the switch drop to a second
  line on a narrow strip without leaving its tag. *Counter (low):* one flat row, as before,
  could strand a switch beside the wrong tag.
- *Cost:* a Judge can now hold power the imported lifetime would have ended, and nothing in the
  ledger says so but the pin; the lot is taken only by a minus, after every fading lot.

## 2026-11-18 — The Research tab's parts beyond board 10 stand as built (owner, board 15) — SUPERSEDED IN PART 2026-11-25

M-q1 built parts of the Research tab that board 10 does not draw. The rule is
`.claude/rules/ui-layout.md`'s, in the owner's words: "when creating or modifying a new UI
element, run /design first and get user feedback before implementing". So those parts were
drawn afterwards, as built, on board 15: the New project prompt, a project's level, cost and
material-paid boxes for a Judge (text for a Player), the subject drop on the tile, and the
closed list. Asked to review it, the owner answered "Approve as built".

- The parts stay as M-q1 shipped them (7089a452), and nothing is reworked. For example, the
  New project prompt keeps its four fields (Kind, Subject, Level of effect, Researcher) and its
  Start button.
- *Cost:* the design step came after the build this once, so the owner reviewed working code
  rather than a drawing. A change asked for then would have been a rework on main.

## 2026-11-18 — The minus follows the switch, and the switch holds (owner) — SUPERSEDED IN PART 2026-11-25

This entry supersedes in part "The hand plus: a Fades/Stays switch (owner, board 14 B)": its
first judgment call (the switch's state lives in the strip's closure and every render starts it
on Fades) and its sentence that a minus takes fading lots first and then lots that stay, for the
Judge's minus on a tag set to Stays. The new evidence, less than a day after the ruling it
changes, is the owner's answer to a question the build raised and what board 14 draws.

- **The minus follows the switch.** Asked whether a Judge should get a direct way to remove a
  point that stays, the owner chose "Yes: − follows the switch". With a tag's switch on Stays, its
  minus removes a point that stays, oldest first; on Fades it spends as before, fading points
  first and then the ones that stay. No new control. For example, a Judge who presses Stays on the
  divine tag and then the minus, holding two staying points and one fading point, ends with one
  staying point and the fading point untouched.
- **The reset was a defect against board 14.** Board 14 draws a switch that holds its setting.
  The first entry shipped one that fell back to Fades after each plus, on its reading of the
  board's words "state that a re-render resets". A build that disagrees with the board the owner
  approved is fixed to the board, not re-decided. The state is kept per sheet window and per tag (divine, arcane), and is never
  written to the actor. A window that has not set it reads Fades. For example, a Judge presses
  Stays and then the plus twice: both points stay, and the switch still reads Stays after each
  render. A second window on the same character opens on Fades.

Judgment calls made in the fix, each with the default proceeded on and the counter:

- **A removal is a spend marked `fromStays: true`, written by hand like any Judge's minus.** Its
  entry is a negative amount with `by: "judge"`, so Undo takes it back as it takes any hand spend
  and the ledger's order of entries is unchanged. The mark is written on a spend only and a stored
  spend without it reads as before, so no flag is migrated. *Counter (low):* reusing `stays` on a
  spend would add no key, and would make one key mean "never expires" on a gain and "drew only on
  lots that stay" on a spend, so a row's glyph and tooltip would have to tell them apart.
- **The mark is the Judge's on all three authorization sites,** the same three the gain that stays
  uses: `run` answers `judge` to a Player before any request is sent, `checkPowerRequest` refuses
  it on the sender Foundry attested, and `apply` refuses it for a sender who is no Judge. A Player
  can never draw from lots that stay alone. *Counter (low):* at `apply` the gain's mark is dropped
  and the gain still runs as a fading point; dropping a spend's mark would run a Player's request as
  an ordinary spend, which is a write nobody asked for, so `apply` refuses.
- **A removal short of the lots that stay takes what they hold and warns `staysShort`; with none
  held it writes nothing.** It never reaches into a fading lot, and a Player is never in this case.
  The chip's minus asks for one, so on the strip the case is the none-held one. *Counter (low):*
  falling back to a fading lot when none stays would make the Stays minus a second Fades minus
  exactly when the Judge pressed it to take a point that stays.
- **The state is a `WeakMap` keyed by the application that hosts the strip, and it ends when the
  window closes.** A document keeps one sheet instance for as long as the world runs, so keying
  alone would carry a Stays across a close and a reopen; `closeApplicationV2` drops the record. A
  forgotten Stays would write permanent power at the next plus, and Fades is the safe resting
  state the first entry named. *Counter (medium):* keeping it for the life of the instance spares
  a Judge who closes and reopens a sheet one press, and leaves a Stays standing after the window
  that set it is gone.
- **Nothing on the document.** No flag, no setting. *Counter (medium):* a stored switch would hold
  across sessions and windows; the owner's word was "never persisted", and two seats on one actor
  would then share a Stays one of them forgot.
- **The minus is labelled for what it does.** Its `aria-label` (which an empty `data-tooltip`
  shows) reads "Remove a point that stays from …" while its tag is on Stays, and the group's name
  and the two pills' tooltips now describe the pair, not the plus alone. A removal's row reads
  "Removed a point that stays" where it has no cast to name. *Counter (low):* the owner said no
  new control; a label is not one, and a minus whose effect changes under an unchanged name would
  hide the switch's state from a keyboard or a screen reader.
- *Cost:* a Judge who leaves a tag on Stays and presses the minus meaning to spend power spends
  nothing from the fading lots; the pressed pill and the minus's label are what tell them. A
  window left open holds its Stays until the Judge presses Fades.

Not changed here, found on the way: the changelog fragment for the switch
(`2026-11-18-spell-effects-power-stays.added.md`) still says every render starts it on Fades.

## 2026-11-18 — Research days are posted and credited once passed (M-q2, ruling 222) — SUPERSEDED IN PART 2026-11-18

Built to board 10, which the owner approved and moved onto the location sheet, adding the day
strip and the pace radios M-q1 left undrawn. The owner on board 10: "Sure go with it." (the
project panel, strip and pace radios as drawn are built; for example, the strip's cells and the
"Today:" radios sit in the project card). On where it lives: "Research board looks like it
should be tab of location." (everything here is in the Research tab after Storage, not in a window
of its own). On the whole v19 canvas: "Approve spell cast design". On the parts M-q1 drew beyond
board 10: "Approve as built" (the New project prompt keeps its four fields, and nothing here reworks
it). The art rule stands: "Find open art to attribute or better yet art/texture imported from the
book. Standing rule for repo no generated art." The strip is CSS cells on the token ramp, no
image. Automation blocks a Player and warns a Judge (`isOwner` is never the test).

Ruling 222 as built: each participant's rate is the imported ladder's rate for the class level, the
ancillary share an imported row; a posted day is credited only once world time has passed its
calendar day (`dayOfWorldTime`); the due is computed from the rates while they are imported and
the Judge's until then; an assistant counts only where the imported levels say so. Judgment calls,
each with the default proceeded on and the counter:

- **A day is a calendar day, posted `{day, pace}` and credited when `day` is before today.** The
  venture queue stamps seconds and resolves a day later; the ruling names `dayOfWorldTime`, and a
  project's days are what the strip counts. *Counter (low):* seconds would match the ventures'
  `resolveTime` exactly.
- **A Player posts today and no other day; a Judge posts any.** A past day is credited at once, and
  a future one commits days nobody has worked. *Counter (medium):* a Player pre-posting a week is
  how a table might run a long project; the Judge can post those days.
- **One pace per project per day, for every participant.** The board draws one radio group per
  project. *Counter (medium):* an assistant working ancillary beside a dedicated researcher.
- **Both is the whole rate plus the ancillary share.** Overtime is dedicated and ancillary
  together, and the module adds the two. *Counter (medium):* overtime might be a different sum; the
  helper is one line (`paceFactor`).
- **The rate is read at the class level `system.details.level`.** The page says caster level, and
  core's `details.casterlevel` is a field nothing writes (default 0); M-q1 already read the level
  for the throw. *Counter (medium):* a multiclass caster's level would differ.
- **A ritual reads the ladder's own rung; every other kind reads the lesser rate the footnote gives
  other projects** (`FULL_RATE_KINDS`). The footnote names a short list of project types, of which
  only the ritual is a kind here. The reader answers an unread rate while the footnote's figure is
  unread. *Counter (medium):* spell and item at the rung's own rate would be simpler and wrong at the
  top rungs.
- **An assistant counts when at or above the aiding level and within the number managed, which is
  the base plus the Intellect bonus read off `scores.int.mod`; a figure not read means it does not
  count, and blocks and warns nothing.** The gate runs where an assistant is added, in `create` and
  `update`, and again when a day is posted. A Judge's add stands with a warning and adds no rate.
  *Counter (medium):* an unread figure counting the assistant would add a rate nobody could check.
- **A day with no rate to read is credited as a day worked with no gold: one row, null amount, blank
  `by`.** The Judge's days are then counted against the Judge's due. *Counter (STRONG):* leaving the
  posted day standing until the ladder is imported would value it later, which the null row never
  is. It was ruled out because a Judge-entered due needs days that count without any rate, and a day
  that never leaves `posted` cannot. *Cost:* days credited before an import carry no gold, and
  `post` refuses a day already credited, so nothing re-posts them. A Judge can raise the research
  cost by the gold those days would have added, or post further days. The case that costs most is a
  ladder imported with the footnote's rate not: every non-ritual day is then credited for nothing.
  **Owner question:** should a passed day with an unread rate be credited as a bare day (built), or
  stay posted until the rates are read?
- **The gate is made at the post, not at the credit.** The facility share and the assistants are read
  when a day is posted; a day already posted is credited whatever has changed since. *Counter
  (medium):* re-reading at credit would stop a Player's day when the Judge lowers the facility under
  it, which M-q1's entry already leaves to the Judge.
- **Who credits, and why it happens once.** The primary GM's client credits on each forward step of
  the clock (lib `onWorldTimeAdvanced`, already gated to it) and once at `ready`. `credit` is a
  function of the record and today; a `(day, participant)` is stored once (`cleanCredited` keeps the
  first row of a key) and a credited day leaves `posted` in the same write, so a second sweep, a clock
  dragged back and forward again and two clients writing the same result all leave one set of rows.
  *Counter (medium):* crediting lazily at render by any seat would credit with the GM offline and race
  two writers; with no GM connected, days wait and are credited at the next `ready`.
- **The due is computed at a dedicated day's rate from what is left, counting the days already
  credited and posted; the Judge's `dueDays` stands only while it cannot be computed.** It is days and
  not a date, since a project has no fixed start; `dueDay` (the calendar day the last needed day falls
  on) is derived for M-q3 and shown nowhere. *Counter (medium):* the Judge's entry overriding the
  computed one would let a Judge shorten a project; they can edit the research cost.
- **The material is still recorded and not charged.** M-q1 left "which purse, and what a refusal
  costs" to this slice. No day here spends coin, so there is still nothing to charge it against.
  *Counter (medium):* deducting at the start would match "paid at start"; the purse is the open
  question, and it is the Judge's `paid` box meanwhile.
- **The pace is held per window and never written, and it outlives the window's closing.** A
  document keeps one sheet instance, so the choice stays until the world reloads, where the
  Fades/Stays switch is forgotten on close. *Counter (low):* a pace left on ancillary reads as the
  default of the next day posted.
- **The pace radios belong to no form.** A radio group
  needs a `name`, so each radio's `form` names no form, which keeps the sheet's own submit from
  carrying a stray field. The group's name carries the window's part id, so two windows on one place
  do not share a group. A radio carries `data-research-control` (the controls the location sheet's lock
  lifts for a viewer) only where the viewer may act on the project, and the Post button only while
  today is not yet posted, so the lock keeps a used Post disabled. *Counter (low):* a named radio
  inside the form would have been submitted with every other field.
- **The strip draws one cell per due day, at most 60; the chip and the aria label carry the whole
  count.** *Counter (low):* a longer project would draw more cells and a very long one a wall of them.
- **The tab's Post button posts today at the chosen pace; there is no count prompt.** The board labels
  it "Post days…" with a count prompt that no board draws, so it is labeled "Post day" and each press
  posts the one day.

Not built, because no board draws it, and reported: a Judge's box for the due in days (the
field is the Judge's through `update(location, id, {dueDays})`, and no control reaches it), the
count prompt behind "Post days…", and a way to withdraw a posted day. Each is a new control and
goes to the owner as a design first.

## 2026-11-18 — A day with an unread rate stays posted, and the footnote is read from the page (M-q2, doctrine fix)

Supersedes two of the M-q2 entry's judgment calls, and the "footnote is read from its figure, not
its mark" bullet of the M-i entry ("The research, ritual and sacrifice figures are imported rows"),
each in part. The new evidence is the doctrine's own sentence, which the two calls were built
against: `ip-doctrine.md` says that without an imported value "the feature only has to fail without
breaking: nothing throws and no wrong figure is written", and the owner's 2026-11-14 ruling "missing
imports stay blank". A credited row with no amount is a wrong figure written, since a day is credited
for nothing and nothing re-posts it; a rate chosen by a guess about the project types is a printed
fact held in source.

- **A passed day whose rates are not all read stays posted and is credited by a later sweep.** The
  M-q2 call was "a day with no rate to read is credited as a day worked with no gold", with the
  owner question whether it should stay posted instead; the strong counter it recorded was this
  entry. Now `creditDue` credits a day whole or not at all (`creditableDay`): every counted
  participant's rate at the day's pace must be read and above zero, and no assistant's counting may
  be unread, since a credit written without an assistant who later counts could never be corrected.
  Otherwise the day stays in `posted`, nothing is written (the sweep answers 0 days and the record
  comes back unchanged), and a later sweep with the rates read credits it at the pace it was posted.
  `cleanCredited` drops a row with no amount above zero, so no path writes one. The strip and the
  posted row show the day as posted, and the row's tooltip says it is held, with the page of the
  rate it waits on (`postedTipUnread`). *Counter (medium):* a Judge-entered due needs days that
  count without any rate, and a held day does not. *Cost:* with nothing imported no day ever
  credits, so `dueDays` is met by nothing until the ladder is read; the field stays as it was, with
  no control (its box is designed separately), and counts credited days only.
- **A Judge's `dueDays` no longer counts unread days.** Held days are posted and not credited, so
  `complete` against the Judge's days reads credited days alone, and a held day is not a pending day
  in `dueDay`. The computed due is not computed while a day is held or an assistant's counting is
  unread, since it would be a guess.
- **The ladder's marks and the footnote's list come from the import.** M-q2's `FULL_RATE_KINDS`
  ("ritual only") named the project kinds that read the printed rate on the footnote's marked
  rungs; the M-i call took the lesser of a rung and the footnote's rate, which decides the marks by
  their size. Both are printed facts. The cookbook reaches them: `gridRows` gained `markKey`, which
  records on each rung whether a lone mark glyph sits in its cell band (a boolean `marked`), and
  `researchLadderNote` keeps the raw span before its anchor, which holds the footnote's sentence,
  as `markedProjects`. The reader cuts it after the last mark glyph at the period into phrases. An
  unmarked rung is its printed rate; a marked one is the printed rate for a kind the list names and
  the footnote's rate for any other; a mark, list or rate not read leaves the rate null. A kind is
  named when a word of a phrase opens with the kind's own name (`footnoteNames`), so the page's words
  are matched against the module's `PROJECT_KIND` at run time, and neither the words nor a kind list
  are in source, tests or lang. *Counter (medium):* matching a kind's name against a printed word is
  a heuristic; a kind that no listed word opens with reads as unnamed. It fails toward the footnote's
  lesser rate, and a Judge can override the note's list. *Cost:* a ladder imported before the marks
  were read has no `marked`, so every rung reads unknown and no rate reads until the Rules tables
  are imported again; a Judge's override of the ladder must carry `marked` on its rows for the same
  reason. No migration is written (owner, 2026-11-11: none for previous-version data).

## 2026-11-18 — Research days: the Judge's due, Post days… and withdrawing (owner, board 16) — SUPERSEDED IN PART 2026-11-18, 2026-11-25

Supersedes in part the M-q2 entry ("Research days are posted and credited once passed"): its bullet
"The tab's Post button posts today at the chosen pace; there is no count prompt" and its closing
"Not built" paragraph, which listed a Judge's box for the due in days, the count prompt behind
"Post days…" and a way to withdraw a posted day, each held for a design. The new evidence is the
owner's approval of that design, board 16 (A, B and C as drawn): "Approve, build it". Governing
words that stand: "Sure go with it." on board 10 (the Research tab's project panel, strip and pace
radios); "Approve as built" on board 15 (the parts beyond board 10); "Find open art to attribute
or better yet art/texture imported from the book. Standing rule for repo no generated art." (the
waiting cell is a dashed warning-coloured border on the `--acks-*` tokens, no hatch or procedural
pattern); and the standing rule that automation blocks a Player and warns a Judge, never an
`isOwner` gate (a range is refused to a Player at the relay on the attested sender, and a
facility or assistant shortfall warns a Judge's range once).

What is built, to board 16:

- **A. The Judge's due, by hand.** A number box in the project's parts, under the credited row,
  writing `dueDays` through the existing Judge-only `update` field. Once the due is computed the
  computed due is text and the box is gone; a Player sees the due as text always.
- **B. Post days….** A Judge's Post button reads "Post days…" and opens a prompt (days, from day,
  pace pills) that names the module's dialog classes, so it scrolls and has a drag corner. The new
  op `postRange` posts each day once, skips a day already posted or credited and names it in the
  notification, and tells a facility or assistant warning once. A Player's button stays "Post day".
- **C. Withdrawing.** Each posted day not yet credited is a row under the strip: "Day N · Pace", a
  tag (posted, or waiting with the page of the rate when it is held for an unread one) and an X.
  The new op `withdraw` takes a posted day back. A held day is the strip's dashed waiting cell.

Judgment calls, each with the default proceeded on and the counter:

- **The box is keyed on "the due cannot be computed" (`dueBy` is not "ladder"), not on "no rate is
  imported".** That is the exact condition under which `dueDays` is read (`progressOf`), so a Judge
  with the rates read and no research cost entered, a held day or an assistant whose counting is
  unread is not left with a due nobody can set. The tooltip therefore says what the due waits on
  and carries the ladder's page, where the board's caption says only that no rate is imported.
  *Counter (medium):* the board's wording is narrower; a Judge could read a box standing beside an
  imported rate as a fault. *Cost:* the box can show while rates are read.
- **A `dueDays` the Judge entered stays on the record when the computed due takes over, unseen.**
  *Counter (low):* clearing it on computing would lose a figure the Judge may want back if the
  rates are re-imported.
- **A range is its own op, `postRange`, not `post` with a count.** One write, the gates read once,
  and `post` keeps its Player-today rule untouched. Judge-only is enforced in `apply`, so the relay
  holds it on the sender Foundry attested. *Counter (low):* one op with an optional count would be
  one name; it would blur the Player's rule.
- **One range takes at most `RANGE_MAX` (366) days.** A bound on one write, not a rule of the book.
  *Counter (low):* a longer project is posted in two ranges; no bound would let a typo write a
  record of any length.
- **A day already posted or credited is skipped and keeps what it had; a range that posts nothing
  answers `ok` with an empty `posted` and writes nothing.** The notification then says nothing was
  posted and names the days. *Counter (medium):* refusing the whole range as `duplicate`, or
  re-pacing the posted days, are both readable; skipping is what the board's caption says.
- **A range may start on a past day.** It is credited by the next sweep, as a Judge's `post` of a
  past day already is (M-q2). *Counter (low):* restricting a range to today and later would stop a
  Judge catching up a project that ran while the world clock was elsewhere.
- **The prompt starts on the window's pace, which is dedicated until one is picked, and its pills
  are a `role="group"` of `aria-pressed` buttons.** The board's markup says `radiogroup`; buttons
  with `aria-pressed` are toggle buttons and a radiogroup wants radios, so the group is a plain
  group. *Counter (low):* the board's role would announce a radio that is not one.
- **A Judge's Post days… is never spent by today's post.** A range starts anywhere, so the control
  that a Player's used-up day disables stays live. *Counter (low):* a Judge pressing it with today
  already posted gets a prompt whose first day is skipped; the result says so.
- **Who withdraws.** A Judge any posted day; a Player a posted day of a project of a character they
  own, relayed under the sender's authority (`mayAct`, the rule every project write already uses);
  never a credited day, which is tested before the posted list so a stale write that left a day in
  both is still refused. The list is read by everyone and its X is drawn only where the viewer may
  withdraw. *Counter (medium):* a Player could withdraw a day a Judge posted for their project, or
  re-post today at another pace; the board draws it that way, and a day not yet credited is not
  yet anyone's research.
- **A day due to be credited at the next sweep still wears "posted" and its X.** Only a day held for
  an unread rate is "waiting". If the sweep credits it first, the withdraw is refused (`credited`).
  *Counter (low):* a tag for "passed, awaiting the sweep" is a third state the board does not draw.
- **Two small departures from the board's drawing.** The pills and the list's pace read the existing
  `pace.*` strings ("dedicated", "ancillary", "both (overtime)"), where the board draws them
  capitalised and "Both"; and the strip's aria label counts credited, posted and waiting days, the
  waiting being the held ones, where the board's label names them in its own words. *Counter (low):*
  a second set of capitalised pace strings for one prompt and one list.
- **The waiting tag's tooltip and the due box's tooltip take the page through the ladder's
  `{cite}`.** The board prints "RR p.388"; lang holds the page reference once, as `cite.ladder`, and
  no figure sits in a string.

## 2026-11-18 — Research Finish writes the result (M-q3, ruling 223) — SUPERSEDED IN PART 2026-11-18

Builds plan ruling 223: a project's Finish throws, writes what the subject's kind yields, records the
researcher's formula, settles the components bucket and posts a card. Supersedes in part the board 16 entry
("Research days: the Judge's due, Post days… and withdrawing") on one point only, its "Two small departures"
bullet: the pills and the posted list now read capitalised pace names ("Dedicated", "Ancillary", "Both"), as
board 16 draws them. New evidence: the board's drawing was checked against the strings, and capitalising the
radio strings by CSS reads "Both (Overtime)" in the radio group, which the board does not show, so the pills
and the list take their own `paceName.*` strings and the radios keep `pace.*`. *Counter (low):* a second
set of pace strings for one prompt and one list.

Each call below stands unless the owner says otherwise; the open ones are listed at the end.

- **The throw is a natural d20 plus the facility bonus plus the substitute penalty, against the Judge's
  stored target or the ladder's rung for the researcher's class level.** Nothing imported says which die, so
  `THROW_DIE` is the die the ladder's printed throws are written for. *Counter (medium):* a prose-read die
  would remove the constant; no import carries one, and the rung's form ("11+") is a d20 target.
- **An unread figure the throw needs holds Finish; the throw is never made with one missing.** A facility's
  bonus that cannot be read (its table, its figures or the project's level) disables Finish
  (`bonusUnread`), as an unread target does (`throwUnread`). A substitute's penalty holds it only while a
  substitute is in the bucket and the penalty's size, or the share it is taken on, is unread
  (`penaltyUnread`); with no substitute held an unread penalty holds nothing. The button shows the reason as
  text and its tooltip names what is unread with the page reference, never a figure. Ground: the
  ip-doctrine sentence that without an imported value "nothing throws and no wrong figure is written" (a throw
  rolled with a bonus or penalty left out can write a wrong outcome, and one that stands in a zero is a figure
  the page does not print), and the owner's 2026-11-14 ruling that missing imports stay blank. This replaces
  the first draft of this entry, which let an unread bonus or penalty count as nothing (coordinator, same
  day: it is the research-days doctrine applied here). *Counter (medium):* a Judge with the tables not yet
  imported cannot Finish at all, where counting the figure as nothing would let them play on; the Judge's
  stored target and an import both free it, and a Judge who wants the throw regardless can roll by hand.
- **A die in the imported automatic-failure band is a failure, not a botch.** No imported procedure defines
  a botch, so none is produced. *Counter (medium):* a botch costs something the book may print; it is not
  in the import, and inventing a cost is a house rule (owner, 2026-11-11: none ship).
- **The formula is recorded on a spell's or an item's success, and read by the next throw, and is worth
  nothing yet.** It is `known`, and `used` only where no substitute is held; the tab's chip and the throw's
  tooltip say so. No imported table prints a benefit for it, so adding one would be a printed value written
  in source. *Counter (high):* a formula that changes nothing is a record with no effect, and a Judge may
  read it as a bug; the chip and tooltip name it as applied or off so the Judge can apply the benefit by
  hand.
- **An identification records no formula.** It identifies an item and learns no way to make one.
  *Counter (low):* a Judge may rule a repeated identification easier.
- **A ritual's Finish is refused (`ritual`, disabled with its reason).** Its result is stored as a charge,
  which is M-r's. Throwing and closing it here would spend its research and leave the result unwritten.
  *Counter (medium):* a Judge could still want the throw and the card now and the charge later.
- **Every outcome consumes the bucket by the one settle map.** A success and a failure both spend the rows
  (a creature is marked, never deleted; a power row is spent from the ledger). *Counter (medium):* a failure
  might return some components; no imported figure says so.
- **One write closes the project and stamps `outcome` before any result is written.** A second press, or a
  relayed twin, finds it closed and throws nothing. The cost: a writer that then fails leaves the project
  closed with the result in `failed` and on the card, and the Judge writes it by hand. *Counter (medium):*
  closing last would let a double press throw twice; at-most-once was the safer failure.
- **A Player's Finish is held to what they own, at the attested sender.** Every component in the bucket
  (`bucketOwner`) and an item to identify (`subjectOwner`) must be theirs; a Judge's is not held. The
  control is live by the researcher's ownership (the rule every project write uses) and the refusal comes
  from the GM's client, never from an `isOwner` gate on the button (a GM seat passes it by definition).
  *Counter (low):* a party's shared component would need the owner's own press; this stays the rule of the
  other writes.
- **A seat writes directly only where `canFinish` holds; any other is relayed.** A Judge always; else the
  seat must be able to modify the location and researcher and delete every component. *Counter (low):* the
  check duplicates Foundry's own permission test, but a relay on a refused direct write loses the reason.
- **A novel subject becomes a blank world item (a spell takes its level), opened on a Judge's client.** The
  project's name and picture fill it and nothing else; the Judge finishes it. The formula keeps its uuid.
  *Counter (low):* a created document no Judge opens (a Player's project finished with the Judge away)
  stays blank until someone looks; it is on the card.
- **An identification marks the item `identified: "full"` on the `markets` flag and calls the markets'
  identified hook.** The listener lifts the mask. *Counter (low):* the hook's method name ("research") is a
  new value in markets' vocabulary.
- **A short bucket does not hold Finish.** A project whose rows are fewer than the component cost still
  throws; the fit chip and the substitute penalty are the only consequence. *Counter (medium):* the book
  may expect the full cost; the due is shown beside the bucket, and a Judge refuses by hand. Open question.

Not built, by design: a ritual's result (M-r); any control or window that adds a power row to the research
bucket (none is drawn); a Finish-result presentation beyond the one roll card.

## 2026-11-18 — Research Finish follows the page (RR ch. 8, "Magic Research")

The M-q3 entry's open questions were looked up in RR ch. 8, §VIII.8 ("Magic Research", "Component Cost",
"Researching Spells", "Creating Magic Items", "Identifying Magic Items"). The coordinator ruled, under the
owner's standing rulings, that these are lookups and not owner questions. New evidence, which supersedes
the M-q3 entry (same day) in part: the page itself. That entry was written from the import, and the import
carries no row for these points; the page prints them as procedure, with no figure, so they ship as code.

Stands, now cited:
- **A failure is a failure; there is no botch.** The page prints no botch outcome for the research throw,
  and a failed throw loses everything spent on the research, the components included. A failure writes no
  result and settles the bucket as spent, as built. Experimentation, which the page treats separately,
  stays in ROADMAP phase 5. *Counter (low):* a Judge's table may want a disaster on a bad roll; that is
  experimentation's, not this throw's.
- **Components are always consumed.** The page says so for every kind of component, so nothing returns on
  either outcome, as built.
- **An identification records no formula.** The page's identification discovers the item's properties and
  command words, and names no formula. *Counter (low):* as before.

Supersedes the M-q3 entry's bullets (to be built in M-r's first commit, one gate and one walk):
- **A short bucket holds Finish.** The throw is made after the component cost, the material cost and the
  research cost are paid, so Finish waits while the bucket's counted value is below the component cost
  (a new hold reason beside the others; a kind whose component cost is none is not held). Replaces "A short
  bucket does not hold Finish". *Counter (medium):* a Judge who accepts a short payment must now enter the
  cost the bucket meets; the due is editable, which is the page's own lever.
- **A known formula means no throw for an item.** The page's formula lets the researcher complete the item
  without a research throw, unless experimenting. An item project whose formula is known and applied (no
  substitute held) succeeds without a roll. Replaces "worth nothing yet". The changed button and card go on
  the canvas before they are built. *Counter (medium):* the M-q3 entry declined a benefit no import
  carried; this one is procedure and carries no figure.
- **Power is not a substitute.** The page's penalty and the loss of the formula fall on inappropriate and
  miscellaneous components only. Arcane or divine power, and an identified item whose formula the caster
  holds, pay the component cost without either. A power row counts as matched unless the Judge marks it
  otherwise. *Counter (low):* a Judge marking power by hand keeps the choice.

Findings against the throw, registered for the same commit: the page adds the researcher's Intellect bonus
to the die, raises the target by the level of the spell or effect (a new spell, an item, an
identification), and requires no throw to gain the formula of a common spell, which is the Judge's call.
Ruling 223 names none of them, and a Finish without them writes wrong outcomes. They are procedure and the
actor's or the subject's own numbers, and ship. A sample's bonus and a proficiency's bonus are printed
figures, so they are ROADMAP rows, read from the import when they are built, never constants.

## 2026-11-18 — Board 17 approved: ritual project, power row, formula Finish

The owner, on board 17 (canvas v30): "Approve, build it", A–E as drawn. On ruling 223, relayed by the
coordinator: it did not mean to exclude anything the page prints ("No house rules ship", only printed
procedure). So the previous entry's findings are built as procedure: the Intellect bonus on the die, the
target raised by the level of the spell or effect, and a Judge's no-throw for a common spell, with every
figure imported or left blank.

- **Two slices.** M-r1 builds the procedure fixes (the short-bucket hold, the formula's no-throw, power as
  matched, the Intellect bonus, the level on the target, the common-spell no-throw) with no new surface but
  a hold reason. M-r2 builds board 17's surfaces: A, the ritual band in the cast dialog; B, the ritual
  project's barred row and throw parts; C, where a cast ritual goes; D, Add power; E, the Finish (formula)
  button and card. Each takes one gate and one walk. *Counter (low):* two landings of one board's work;
  the procedure is correct without the surfaces and is walked first.

## 2026-11-19 — M-r1 and M-r2a as built: power in gp, the ritual project, board 18

- **A point of power is a gp.** RR ch. 8 counts arcane and divine power in gp ("gp of divine power",
  "gp value of divine power"), so a power row is worth its held amount toward a component cost
  (`powerRowValue`). The coordinator ruled this a lookup, not an owner question. It is a unit, not a printed
  figure, so nothing is imported. *Counter (low):* a Judge marking a power row otherwise keeps the choice.
- **A ritual's facility is the workshop.** The page names a workshop for casting a ritual. *Counter (low):*
  learning a ritual names a library, which is the spell-research kind's facility.
- **A cast ritual waits for its placement.** A successful ritual stamps `pending: "placement"` and is listed
  as awaiting, not closed, until board 17 C (M-r2b) writes where its effect goes. *Counter (medium):* until
  then a Judge records the placement by hand.
- **A part's XP is taken whole, and 0 reads as unread.** A monster part's value for a ritual is its source
  monster's award (`xpPartValue`), blank and held where unread. *Counter (low):* a creature whose award is
  genuinely 0 holds; no such creature yields special components.
- **A ritual spell is claimed as a ritual first,** ahead of a summoning claim, and its dialog hides the
  ordinary bands. Finding 1c.36 is closed by the same claim.
- **Board 18 approved.** The owner: "Approve, build it", the Judge's "Common spell (no throw)" check as
  drawn. It builds as M-r3.

## 2026-11-18 — The Blood sacrifice window (M-s, rulings 209, 211, 212, 213, 217; K.2 to K.4, K-b.3) — SUPERSEDED IN PART 2026-11-18

Built to board 11, which the owner approved with the v19 canvas: "Approve spell cast design". The model is
`scripts/magic/sacrifice.mjs`, the world's half `sacrifice-live.mjs`, the window `apps/sacrifice-window.mjs`. The
page's procedure is the structure and every figure is an imported row (`sacrificeTraits`, `powerOfSacrifice`, the
research ladder), so no figure ships. Rulings made in building it, each with the default proceeded on and the counter:

- **One throw for the act, over every victim.** The page's worked example makes one research throw for a sacrifice
  and adds the traits on its success. The throw is `throwPlan` for a project with no level of effect and no facility,
  so the research ladder and the Intellect bonus are the only parts. *Counter (medium):* one throw per victim would
  fit "each victim yields" read alone; the example's single throw over the sacrifice decides it.
- **The class power's multiple applies to base and traits alike.** The page counts "any arcane power from blood
  sacrifice" at the multiple. *Counter (low):* the base alone would leave the traits at their face value; the page's
  words name no such split.
- **The Judge's mark of the class power picks the ledger.** With it set the gain is arcane, else a divine caster's is
  divine, else the caster has nothing to gain (`noBasis`). No identifier for the class power exists to detect it by
  (a printed class name would be the book's), so it is a Judge's check in the window. *Counter (medium):* the
  cookbook id of the class's power, once the importer mints one, is what ruling 213 names; the check is replaced by
  that read and the rest holds.
- **Only `sapient` counts as sapient.** A character is sapient; a creature is when its intelligence reads `sapient`,
  and a blank intelligence holds a lawful or neutral caster's act. *Counter (medium):* semi-sapient could be read as
  sapient too; the page says "sapient" and the module's scale has the word.
- **A limit is a verdict and a missing figure is a hold.** Where the rules forbid, a Player is blocked and a Judge
  warned (`castVerdicts`), and a K.3 animal sacrifice by a lawful or neutral caster is a Judge's warning alone. A figure
  not read (a victim's value, a ticked trait's factor, the multiple, the throw's target, the Intellect bonus) holds
  everyone, as research's Finish does, since nothing may be rolled or written with a figure missing. A Judge's value
  box replaces an unread value, and is the only way a character victim yields until an award-by-level table is imported.
- **The Judge's toggles are the window's own state.** They live on the window instance and are not shared, so a Player's
  window starts with them unset and disabled and is blocked until a Judge acts for the character. *Counter (STRONG):*
  shared state would let a Judge set a victim up for a Player's own seat; it needs storage and a place a Player cannot
  edit, which the design does not draw.
- **The order is the throw, the victims marked, then the power gained for the victims that were marked.** A victim that
  could not be marked yields nothing and the card says so. An unwilling chaotic victim, a dead victim and a creature the
  XP bar excludes count for nothing and are left unmarked.
- **A Player's mark is relayed.** The seat marks what it may write and asks the GM's client for the rest, which checks
  the sender against the caster and each victim as it reads them (`checkMarkRequest`). *Cost:* the GM's client cannot
  see the Judge's toggles, so the relay authorizes by ownership of the caster and the victim's state, not by the page's
  limits; a Player's own act is already held by them.

## 2026-11-18 — The sacrifice's checks are shared and the strip opens the window (M-s second pass, board 19)

The owner approved board 19, A to E as drawn: "Approve, build it". New evidence over the entry above: the owner ruled
that the Judge's checks are stored and shared, which that entry's "The Judge's toggles are the window's own state" (and
its "no sheet control opens it yet") could not know. Those two are superseded; the rest of that entry stands.

- **The record is the open sacrifice, kept on the caster.** `flags["acks-extras"].magic.sacrifice = {site, power,
  list}`, each victim in `list` carrying its own facts (`sacrifice-record.mjs`). It is written only by the GM's client,
  as ops applied to the freshest flag (a drop, a removal, the Judge's facts, the clear), so a Player's drop and a Judge's
  tick made together both land. A list is an array because a flag update merges objects and would keep a removed victim.
  `magic.formulas` shares the object on a researcher; only the `sacrifice` key is ever cleared.
- **The sender decides, never the seat.** A drop, a removal and the clear belong to the owner of the caster or a Judge, the
  Judge's facts to a Judge alone (`checkRecordRequest`), from the sender Foundry attested. No `isOwner` test exists.
  *Cost:* Foundry lets an owner update a flag of their own actor directly, and no client code can refuse a hand-made
  call; the module's own seats write only through the handler and a Player's window draws checks as text.
- **A Player's Sacrifice frees itself.** Every window redraws from the record on `updateActor`. What a Judge's check
  settles (the site, a victim not helpless, a victim's value left to enter) is a "Waiting on the Judge" line; a limit
  no check settles stays a block. *Counter (low):* every block could read as waiting; a lawful caster's refused sapient
  victim is no Judge's to set, so it keeps its reason.
- **The record clears whole when the sacrifice is made and when a Judge closes the window,** the class-power mark
  included. *Counter (STRONG):* a class-power holder who is not a chaotic divine caster loses the Player's strip button
  with the mark, until a Judge ticks it again; keeping the mark past the clear would fix that. Built as the brief reads;
  an owner question. A sacrifice that yielded nothing is not "made": it writes nothing and keeps the record.
- **The strip's button** is drawn by the classes feature's chip (`power-chip.mjs`) from magic's `openerFor`, for a Judge
  on every caster the strip draws and a Player on a divine, chaotic caster or a marked class power.
- **Departures from the board.** The young check is a creature's only (a character's value is not read by age, so it
  would be inert); the class-power check is drawn to a Player only where it is ticked.
- **lib's bucket row has an `extra` slot** (a loaded partial named by the row, drawn under the caption, never on a
  pick row), so a caller's per-row controls sit in the row; an unused slot renders as the row always did.

## 2026-11-19 — A summons' control ends as its page says (1d.7)

The owner, on 1d.7: "Specific per summon, check RAW". Each summoning spell's printed text was read in the order
`rules-lookup.md` sets, and the cast does what that spell says about control ending. A spell whose page ends it
when concentration lapses loses its creature with it, while a spell whose page says nothing keeps ownership and its
card says control is lost. On board 24: "Approve (Recommended)".

- **One row key, `controlEnd`,** a member of lib's `CONTROL_ENDS`: `stays`, `gone` or `hostile`. It is structure on the
  register's summon entry, as `control` is, and the row editor's "When control ends" select (a spell's summon row
  only) lets a Judge change it. A blank, an unknown word and a summons with no row read as `stays`.
- **The GM's client reads it from the summoner's own spell,** found through the creatures' recorded `spellId`, and
  never from a card or a request (`cast-control.mjs`). Lib's `applyControlEnd` then acts on the cast's recorded
  tokens and stashed members (`castSummons`: the summoner's uuid and the cast id on the creature's own record),
  never on a name or a type. Every creature is stamped `lost`; `gone` deletes as a dismissal does, a deployed or
  stashed member through the roster's `release`; `hostile` drops the token delta's owners and turns its disposition
  hostile. A stashed creature that stays or turns hostile has no token to write and is left as it was. With no GM
  connected nothing is applied: the card is posted as before and claims no outcome.
- **A creature whose control ended is a Judge's to dismiss.** `checkDismissRequest` refuses a stamped creature to a
  seat that is no GM (`controlLost`), which closes the finding that the sheet's Dismiss admitted owners. The expiry
  card's Dismiss is drawn for a GM seat only, as the held card's is.
- **A conjuration is held.** A `conjuration` row with a duration that is not a concentration casts held, the printed
  duration its cap and the blank default (mobile) its kind, so the clock ends it as a held cast and `hostile` can
  fire. `parseDurationLine` is unchanged: it reads a bare time as `fixed`, and the cast makes the conjuration's
  reading (`heldByConjuration`).
- **Both ends apply it** (the owner on 1d.9: "Remove automatically"). At a held end the card names the outcome. At a
  timed end a `gone` summons is removed by the module, by the summons' own recorded token ids and never by name or
  type, and no Dismiss card is posted for that case; `stays` and `hostile` keep their card.

| Spell key | End | `controlEnd` | Cite |
|---|---|---|---|
| callOfTheWolf | timed | gone | RR ch. 5 |
| summonManes | timed | gone | RR ch. 5 |
| faithfulCompanion | timed | gone | RR ch. 5 |
| unlivingPuppet | held | gone | RR ch. 5 |
| conjureCacodemonSpawn | held (the cap of its printed duration) | hostile | RR ch. 5, Summoning Spells |

Supersedes, with the owner's 1d.7 and 1d.9 answers of 2026-11-19 as the new evidence: 1d.6 ("a held summons' end
leaves its creatures with no prompt, until 1d-B") and the 1d-B ruling that a held end leaves the creatures standing
for every spell; and, in part, the 2026-11-11 entry "A cast's end is told on a card", whose Rejected line refused
deleting the creatures on expiry.

*Rejected:* `free` as a fourth outcome, since no spell's page forces it; a blanket default for every summons, which
is what 1d.7 refused. *Cost:* a creature that stays after its control ends is owned by its owners and cannot be
dismissed by them, so only a Judge removes it; a stashed creature that turns hostile is not written until it is
deployed, and then stands as it was. *Counter (medium):* an owner may want to dismiss a creature that is theirs;
the page says no control is left, so the Judge decides.

## 2026-11-19 — Summons join the spell cast (1d-B, rulings 157 to 163)

Session 1d-B's rulings of the spell-effects plan. The owner, on the boards: "Approve 20, 22, 23 (Recommended)"
(the Summon band, the held-end card, the row editor's `lasts` and effects field). On board 21, first "Build it
now", then, on splitting the magic batch: "finish what's in dev and spells that use them, no new surfaces. Close out
what's in flight." The range ring is not built and is in the ROADMAP.

- **A summons is cast by `castSpellRun` (157).** It claims every `isSummonSpell`, a spell with no row too (the
  shelf pick), and the `castSummonSpell` claimant is retired; the policy and the naming stay. The order is the
  dialog and its verdicts, the seat's clicks, the spend and the pool, `endHeld`, the cast id, `perform`, the
  creatures (only when the cast proceeds) and the card. Every refusal `placeSummons` made before the clicks is a
  verdict before the spend. Supersedes ruling 5 and 206(a) in part, and qualifies the 2026-11-11 entry "A summoning
  spell's creature resolves on the GM's client" (its cast was the claimant's, with the count at the spell's amount).
  *Rejected:* a mirrored `castSummonSpell`; clicks after the spend, where a cancel would cost the slot. *Counter
  (medium):* "place" in ruling 208 could be read as creating the tokens.
- **The record keeps the summons' end path (158).** A held summons writes `heldRecordData`, the one function every
  held cast's record comes from. Any other is core-timed with no `startTime`, so `cast-expiry` announces it with
  Dismiss (Q1-c of 2026-11-11) and the flag-timed silent delete never reaches it. *Counter (medium):* the caster's
  record has two shapes.
- **The count goes through `castAt` (159).** `flattenAt(row, castAt)`, then `max` at the caster level (null with
  none, abilities through S3c's matcher); the ceiling is `max`, else `amount`, and a blank stays blank beside the
  page reference. Duration comes from `castDurationOf`. The verdict is `summonCount`, blocking a Player and warning
  a Judge. Lib's policy request gains `cast {castId, casterLevel, invocationLevel}`, `positions` and the scene. The
  GM trusts the seat's level, as the apply relay does (2026-11-16 "The relay builds every record from the spell's
  rows"). *Rejected:* the GM recomputing it, since a hand-set level cannot be recomputed. *Counter (medium):* a forged
  level buys creatures.
- **Placement range (160)** (JJ ch. 14, Summoning Spell Notes; RR ch. 5, conjurations). A point for a creature beyond
  `rangeFeet` from the centre of the caster's token is refused to a Player and warned to a Judge as it is clicked.
  The GM's policy measures the same points again, never the creature's size. A `calling` and a range the spell does
  not state are exempt. A refusal after the spend is a card line and the spend stands. *Counter (medium):* an
  animation's range could bound the remains.
- **A summons is declared (161)** (RR ch. 6). `summon {ref, count}` joins `ANSWER_FIELDS` (2026-11-18, "A declared
  cast resolves on what was declared"), and a time over a round is a `longCast` (ruling 204). A declared summons
  clicks at its turn, and a cancel there leaves the declaration standing. **Supersedes 1d.5** of the 2026-11-17 entry
  ("a summons in a begun fight resolves at once, until 1d-B") and MODEL's "not declared". That ruling is less than
  seven days old; the new evidence is RR ch. 6, which makes any cast in a begun fight a declaration, ruling 204, and
  1d.5's own "until 1d-B". *Counter (low).*
- **A held summons' end lists the creatures (162)** (RR ch. 5, conjurations). The funnel's card lists the cast's
  standing creatures (`castSummons`) with Dismiss and Dismiss all drawn on a GM seat only (`isGM`, display only), and
  Restore puts the records back and nothing else. What the end does to the creatures is the entry "A summons' control ends as its
  page says (1d.7)", which amended this ruling's "the creatures stay" and closed its finding that the sheet's
  Dismiss admitted owners. *Rejected:* a Dismiss for owners, since as
  written no control is left. *Counter (medium):* the sheet's lib Dismiss still admitted owners until `controlLost`.
- **A row's `name` (163).** Lib's `effectField` gains `name`, and the importer's bind writes the referenced
  creature's materialized name, blank where it is not imported; a repair fills it. *Counter (low):* import order.

*Cost:* two caster-record shapes for a summons, and a Player's level word trusted by the GM.

## 2026-11-19 — The kinds of 1d-A's three waiting spells, and a cast that measures no target (1d-B, rulings 164 to 167)

- **Describe (164).** The summon arm reads `max`, and the default arm leads with its kind. This is wording in existing
  lines and the kind select, so it had no board. *Counter (medium):* `ui-layout.md` says "anything a user sees".
- **Three kinds (165).** `afflictionDelay` (`effects` from `EFFECT_KEYS`, on the recipient, for its duration),
  `purify` (an instant line, the quantity located) and `seal` (the caster's record and a line) are each in
  `APPLY_KINDS`, `APPLIERS` and lang. 1d-A's ruling 151 had left their three spells waiting; their register entries are
  `delayDisease`, `purifyFoodAndWater` and `sealPortal`, with `locateAnimalOrPlant` a `detect` row that lasts its
  duration. A purify row's quantity is read from the page and stays blank on a miss, with a neutral note the page's own
  words replace through `noteFrom`. *Counter (low).*
- **Recipient records (166).** `RECORD_KINDS` gains the six tracked kinds and `afflictionDelay`, counted only where
  `appliesTo` is `recipient`. `ignite` keeps `!aimedAtSelf`. Every tracked row now in the register is an area or a
  target row, so none writes a recipient record yet. *Counter (medium):* latent.
- **No entry, no measure (167).** `takesTargets` gates the range and the count, so a cast whose rows open no entry
  measures no target, and stale targets no longer range-block a Player's cast of a spell that only creates an effect.
  The summon step is `APPLY_KINDS.summon.step`, run from the cast's dependencies. *Counter (medium):* a step is not an
  apply.

## 2026-11-19 — Seal Portal locks the picked door (1d.8, rulings 174 to 177)

The owner, on 1d.8: "Lock the door". Seal Portal sets the picked door's state to locked, and its end unlocks the door
only if the door is still in the state the spell left; no ROADMAP row. On board 24: "Approve (Recommended)".

- **The pick (174)** runs through `APPLY_KINDS.seal`, in the slot a summons clicks in, before the spend. Lib's
  `door-pick.mjs` takes the screen-covering pointer catcher, promoted from `battlemap/` to lib, so the click never
  toggles core's door control. Only the door controls the seat sees are offered, and a secret door never to a Player.
  The range comes from `castAt`, and a blank range is not measured. The pick may be skipped (Enter), since a portal
  need not be a wall, and a skip keeps the spell's record and line; a cancel costs nothing. A Player with no GM is
  refused before the pick, as a summons is, with the notice `sealNoGm`.
- **The write (175)** is `cast-seal.mjs`. A GM seat writes directly and a Player's seat relays through
  `SEAL_HANDLER`. `checkSealRequest` checks that the requester owns the caster, the spell has a seal row, the wall is a
  door (a secret one for a GM only), it is on the caster token's scene and it is in range. It writes `ds: LOCKED` and
  the wall flag `sealedBy {was, casts}`; a second seal appends its cast id.
- **The record (176).** The caster's mark gains `seal {sceneId, wallId}`; the GM-written stamp is the truth.
- **The end (177)** is the active GM's: `sealEndPlan` runs on the record's deletion, and a GM `ready` sweep catches
  orphaned stamps. Once a door's list is empty it goes to CLOSED only if `ds` is still LOCKED and `was` was not.
  With no GM connected the door waits for the next GM `ready`.

*Rejected:* a record and a line only, the default the plan proceeded on until the owner answered. *Counter
(medium):* a wall that is no door cannot be sealed, though a portal may be one.

## 2026-11-25 — A cast's condition record carries the system's changes

The record of a condition a cast writes (`spellEffectData`, `conditionRecords`) is the effect Foundry builds for that
condition: its status, the statuses its entry brings and its `system.changes`, through one builder
(`statusEffectData`, `lib/held-condition.mjs`, which a held condition's effect is built from too). A buff record and a
pending declaration still hold no status and no change.

- **What it reverses.** MODEL's rule that a status record is status-only, at most one status and never with changes.
  It had no entry of its own. Its stated reason was that removing a condition's record by id ends that condition
  alone, which a record holding a status and nothing else did; a record that holds the entry's statuses and figures is
  as much one condition's, and is removed by its id the same way.
- **Evidence.** Core 14.2.0 ships `system.changes` on the entries of its condition list, so a condition set from the
  token HUD already carries its figure. The owner, 2026-11-24: "Revert to core now that it available, repair
  implementations and ties to automation that are downstream"; asked whether the module keeps its figures where
  core's effects do not reach or takes core's scope only, "Extend core"; shown the design boards, "Use exiting foundry
  code before investigating new designs...". `countsOnce` (lib's 2026-11-24 entry "A condition a state brings rides
  on that state's own effect") makes a second carrier of one condition's change count nothing, at Foundry's own apply
  step, so no writer leaves a change out to avoid a double.
- **Rejected.** A helper that built the data from `fromStatusEffect` and dropped the changes where the actor already
  held an active effect with that status and changes. Its cost: delete the effect that carried the changes first and
  a status-only twin is left counting zero, since nothing writes the figure back. A writer that decides, at write
  time, which effect counts is a second mechanism beside the one Foundry runs on every preparation.
- **The brought statuses.** A record of a state that brings a condition holds both statuses, and `liftPlan` reads the
  brought ones from the registered entry: an effect holding the lifted id and only the statuses that id brings is
  plain, and any other two-status effect, or the brought id lifted off the effect of the state that brings it, is
  listed as `twoStatus`. Lib's `lift` ends by the same reading: after the system's toggle it deletes each effect that
  holds the lifted id with only the statuses that id brings, under any id, so a cast's record of such a state is
  lifted, stored on the entry and put back by an Undo like any other.
- **Restore.** A Restore on a concentration's end card puts back each ended record whole. Its figures and statuses are
  the builder's for the record's first status, put back at the press, and never the card's: the card's flag is
  writable by its author, and a record's change list stays something no card can write.
- **Cost.** A cast record of a condition now carries figures, so a creature that a hand also gave the condition holds
  two effects naming it, and the figure counts once by `countsOnce`; core's own breakdown sums raw changes and shows
  such a double beside an "other effects" line of the opposite sign. A record of a state that brings a condition lights
  no HUD tile and is under no static `_id`, so a click on that state's tile does not find it. The held concentration
  and casting records (`cast-held.mjs`, `cast-declare.mjs`) keep their one status and do not go through the builder.

## 2026-11-25 — A summoning names its creature per seat, lists its creatures as rows and joins a caster's party, and a declared cast names its fight (board 3)

**Ruled.** The owner was shown the Summoning board of the 2026-11-25 bug-batch canvas and, on the release hub's
cards, selected "Build as drawn"; for a caster marching inside a party, "Creatures join the party"; for a creature
the seat cannot open, "Neutral label". These are selections of a card's wording. The owner's own words on who sets a
spell up are in lib's entry "A summon is refused by the casting user's level on the creature" (T-0793): "follow
foundry permissions, don't invent new ones."

**Where the board was wrong.** It was drawn before it was read against the code, and three of its "shipped" claims
did not hold. What is built in place of each is a direction of the release hub's and no selection of the owner's;
the hub undertook to report the three to the owner as facts.

- *"The field already stores a list; no migration."* A summon row holds one creature (`ref`) and one number
  (`amount`). What is a list is the spell's `effects`, which may hold several summon rows, and every reader loops over
  them. **Built:** those rows are the list. The window of an open row lists the summon rows that share its invocation
  band, `summonFormat` and `control`; Add makes a row that copies the open one, and Remove deletes a row. No schema,
  importer or migration change.
- *The Creature menu and the drop bucket, drawn together.* They are either/or (`summonView`), and stay so: the bucket
  shows where no row names a creature.
- *The Number, drawn as dice.* The row's `amount` and the cast's count are whole numbers and stay whole. Dice the cast
  rolls are a ROADMAP row.

**Built.**

- **A seat's view of a creature.** `summonOffer` marks each offered creature with whether the seat's user can open
  it, by lib's `creatureOpens` (Observer on the creature, Foundry's own record). A seat that cannot reads the neutral
  label in the Creature menu and in the ceiling tooltip, and a Player who picks such a creature is refused
  `unreadable` on the window's foot, with Cast off, before the press and so before the spend. The refusal after the
  press (`summonJudged`, and the GM's client in the relay) is unchanged and remains the test that binds.
- **The card is worded per seat.** A cast stores its summoning as a record on the card (`card.summoned`: the
  creature's uuid and name, the count made and short, the duration, the party joined), and `summonedLines` words the
  line at render for the seat reading it. The stored `content` is the view of a seat that opens nothing, so the
  neutral label is what a log export or a module reading the message's HTML gets. The summon row's own describe line,
  which printed the row's raw ref, leaves the card: a cookbook id spells its creature. A card stored before this keeps
  its worded line.
- **The limit of the neutral label.** Foundry gates no read: the creature's name is in the message flag and in the
  spell's row, and any seat can read both from the console. The label keeps the name off the cast window, the card
  and the spell's sheet, and does nothing more: the party cell, the party sheet and a token's own name are not worded
  per seat. The board put that limit beside the question, with the alternative of printing the name to whoever owns
  the character; the owner selected the neutral label.
- **A declared cast names its fight.** The pending record gains `declaredRound`, the fight's round when the cast was
  declared (`round` stays the round it lapses in). The cast window's foot, beside Cancel and Declare, names the fight
  by its scene and that round and says what the caster's turn does; the line that stood in the body is gone. The
  scene is named as core's navigation names it to every seat (`navName`, else `name`). The Magic tab's row of any
  spell with a declaration standing shows a Declared tag, a line and a tooltip that name the fight. A record written
  before this names its fight without a round.
- **No Withdraw.** No page prints withdrawing or changing a declared cast, or what becomes of its slot (RR 179, 291
  to 293). The row reads and offers nothing; the declaration lapses as ruled 2026-11-16 ("A declaration spends at its
  confirm and lapses with the caster's next turn").
- **A lapse is not read from the round.** The primary GM's client deletes a declaration's records when the caster's
  turn that reaches its lapse round ends, so a record that stands is shown as waiting. A lost declaration shows no
  row. A record whose fight no document answers shows, naming no fight.
- **The creature list is edited as rows.** In a spell's row window the summon row's `ref` and `amount` give way to
  the list (lib `summon-list.mjs`): one line per row with the creature as the seat can open it, where it is from, a
  Number box and Remove, then a drop zone and a uuid box with Add. Add copies the open row for the new creature;
  Remove splices a row out, and on a list of one keeps the row and blanks its creature, since the row's format,
  number and control are the spell's setup. Add and Remove change the row list, so the window closes and reopens at
  the row's new index, carrying the rungs drafted on the row and not yet saved, which stay unsaved (the hub's
  direction; the first build dropped them). Nothing in the block reads the seat's role: the
  spell's owner sets it up under Foundry's own permissions, and a creature the seat cannot open is listed under the
  neutral label and refused at the cast.
- **Creatures join the caster's party.** A caster who marches inside a party token (a member neither deployed nor
  out as a stack, of a party whose token stands on its scene and is in no fight) has a summoning made as members of
  that party: the relay's `join` request is authorized on the GM's client as a placement is (`checkPlaceRequest`,
  with no places), each creature is stashed as the token it would have been, where the party token stands, and the
  `party-roster` service stores the stashes (`admitSummons`, contract v4). No token is made on any scene, no place is
  picked and no range is read. The relay is Foundry's own requirement here and no new permission: the party's record
  is a world setting and the creature's world copy an Actor create. The cast reads the party before the window opens
  and again when it answers, and follows the second reading. The window's placement line, the card and the Magic
  tab's row name the party. How lib builds it is lib's entry of the same date, "A seat's view of a creature, the
  creature list and the join are lib's".

**Decided in the build, not selected by the owner.** The party's name is shown to every seat: its record is a world
setting every client reads and its token's name shows on hover. A party in a fight answers no party, and the click
placement stays, since a party that joins a combat deploys its members and the caster then has a token. The release
hub ruled that this stands beside the formation change that lets an owner bring a member in or take one out during
a fight: that change does not make a fighting party a place a summoning joins. The Magic
row keeps its scene filter, and the creatures of one cast share one appended number; both are ROADMAP rows. The
row's tooltip reads "creature(s)" where the board drew "creatures", which is wrong for one.

**Qualifies.** It supersedes none.

- Ruling 160 of "Summons join the spell cast (1d-B, rulings 157 to 163)" (2026-11-19): a summoning made into a party
  picks no point, so no range is read, and a spell that states a range is not refused for want of a caster token.
  The ruling stands for every summoning that is placed.
- The archived "A summoning spell's creature resolves on the GM's client (2026-11-11)": its line that an unresolved
  choice is labelled by the row's `name`, else "Creature N", holds for a seat that can open the creature. A seat that
  cannot reads the neutral label, whether or not the row carries a name.
- Answer 3 of the archived "The order, and the scoping's eleven questions, ruled (2026-09-25)", click-to-place as the
  baseline: the baseline stands, and a caster marching inside a party is the one cast that asks for no click.
- Lib's "A summon is refused by the casting user's level on the creature" (2026-11-25, T-0793): its cost line ends
  "its name still prints on the row". The Mechanics tab now names a row's creature through the seat test; the name
  stays in the row's data, as that line's first half says.
- Character-sheet's "A summon marches in its summoner's party" (2026-11-16): its cost line "A cast's `tokenUuids`
  names tokens deleted once the creatures join" describes a summoning that is placed and then gathered. One made
  into the party made no token and names none.
- Character-sheet's archived "A summon is an unlinked token of a GM-made copy (2026-11-10)": a creature made into a
  party is the GM-made copy with its token data stashed and no token; it is that unlinked token once the party
  deploys it.
- Formation's "A summon is a member under a key of its own" (2026-11-16): its "Only a token carrying a cast record
  joins" holds for the gather. `admitSummons` also takes a stash that carries a cast record and was never a token,
  under the same minted key, and the `party-roster` contract that ruling names at v2 is v4.

**New evidence**, which the entries of 2026-11-19 and 2026-11-25 above did not have: the owner's selections on the
board's cards, relayed by the release hub on 2026-11-25, and the reading of the board against the code that found
its three errors.

**Rejected.** *An array of creatures on one row.* Every reader of a summon row, the importer's bind and the stored
spells would change, and the family builds no migration. *Placing the tokens and letting the party gather them*,
which is what a cast from inside a party did before: the board says no token is placed, a click on a map was asked
of a caster who has no token on it, and a spell that states a range was refused to a Player for want of one. *Naming the creature to whoever owns
the character.* The owner selected the neutral label. *A Withdraw on the Declared row.* No page prints one.

**Cost.** An imported summon row edited through the list loses its importer mark, as any edit of a row does. A
summoning made into a party fires no `acksExtras.summonsPlaced`, so a module that listens for arrivals does not hear
it. A monster's hit points are rolled into its stash where the system's own setting rolls a new monster token's; one
deployed later keeps that roll.

## 2026-11-25 — The spell's audit mark, the Research tab's figures and a ritual's charge item follow ownership (T-0792, B1)

**Ruled.** The owner, 2026-11-25: "Tool permissions are hardcoded (e.g. summons) by server role instead of object ownership, only judge secrets are supposed to be an exception to this rule"; of spells (T-0793): "Spell owner can setup the spell as needed. … In either case the approach is follow foundry permissions, don't invent new ones." On the hub's cards the owner selected "Summons plus the party sheet" for this minor, and every one of the thirteen reversals; card 2's "Standing under the same answer" names the research boards' level, cost, paid and due. Severity still reads the role, as the owner's 2026-11-14 rule has it ("players get blocks, judges get warnings"); permission reads Foundry's ownership. Nothing on these surfaces is a Judge secret. An example: a Player who owns a hand-made place and the researcher on it types the place's facility values and a project's cost; on an imported place, which no player owns, the same Player reads those values as text.

- **The spell's Unaudited mark** (spell sheet → Overview → Provenance) is drawn on the sheet's `editable`, where it was drawn for a GM. It records the data's audit state and hides nothing.
- **The Research tab's facility values** are written by an owner of the place: the facility op refuses `owner` where it refused `judge`, and the inputs are drawn on `location.isOwner`. Every hand-made place is default Owner for every player (`location/module.mjs`), so on those places every player may set them.
- **A project's throw, costs, material paid, due and, after it exists, its level** are written by an owner of the researcher, the per-project test the panel and `apply` already make. `JUDGE_FIELDS` keeps `common` alone. The due a hand typed reads "due entered by hand".
- **A ritual's charge item** (Research tab → a ritual project's placement prompt) is any charged item the user owns, on whichever actor holds it; the seat asks `item.isOwner` and the relay asks the attested user's ownership of the item's holder. RR ch. 8, "Ritual Spells", sets the stored effect on a scroll or as a charge in a charged item and does not require the researcher to hold it, so no researcher test survives as a verdict.
- **Left as built, not ruled:** Post days… (a range is a Judge's), a Player's post on a day other than today, and the Common check (board 18). No card names them; they wait on the owner.

**Supersedes IN PART**, none under 7 days: "Research projects at a location, and the facility (M-q1, rulings 220, 221)", its "Who writes which field" (the costs, paid, throw and later level as the Judge's) and "the facility inputs exist only on a Judge's render"; "The Research tab's parts beyond board 10 stand as built (owner, board 15)", its "a project's level, cost and material-paid boxes for a Judge (text for a Player)", where the boxes are now an owner's; "Research days: the Judge's due, Post days… and withdrawing (owner, board 16)", the due only ("a Player sees the due as text always"), while Post days… stands. The charge-item rule was a build call (M-r2b) with no entry.

**Strongest counter, MEDIUM.** A Player can now type the cost and the level their own project is read against, which M-q1 kept with the Judge because "it is the Judge who sees the project and can correct it". Held: the owner's rule makes the record its owner's, the Judge still writes every field, and the facility and assistant shortfalls still block a Player and warn a Judge.

## 2026-11-25 — A spell attack with no damage die asks, and the die is kept per copy

Supersedes the spell carrier's half of "2026-11-25 — The strike and a spell
carrier are never asked for a formula" (`docs/equipment/DECISIONS.md`) and, for
a spell, the reading in "2026-11-11 — Capacities, finesse sizes and the unarmed
die are read, not shipped" (archived in `docs/equipment/DECISIONS-through-v11.14.5.md`,
"In force") that a blank formula is an attack throw with no damage roll.

**Ruled** (owner, on the design board's card): "Build the surface, e.g. magic
missile, then follow offer to save for character (fwd offer to judge to save for
all instances), offer to save for all instances to judge by default". An
example: a Player casts a spell whose damage row states no die; a window asks;
`[dice]` typed with "Save on this character's copy of the spell" ticked is that
copy's die from then on, and the Judge is whispered one press that saves it on
every copy that has none.

**New evidence.** The earlier entry rested on the carrier being built for each
throw and so having nowhere to keep an answer. The spell item it comes from is
that place, and the owner's words name it.

**Decided** (release hub, answering the build's questions):

- **A per-row flag on the copy**, `flags["acks-extras"].spellDie`, keyed by row
  key, read into the row by `withKeptDice`. The copy keeps following its library
  twin for everything else, and a copy with rows of its own is never rewritten.
  The other reading, writing the twin's rows onto each copy, rewrites more and
  detaches the copy from later imports.
- **Every copy** is the source entry and each world item and world actor item
  matched by cookbook id, else compendium source. Unlinked tokens are not
  reached, and the card says so in one line. A token whose delta does not change
  the spell reads its base actor's copy.
- **Once per cast per row**: a thrown row asks at its first instance.
- **A copy has a die** when its effective row states one or one is kept for it;
  no save overwrites either.
- **A locked source entry** is not written; the blank copies are, and the card
  says the entry was not written.
- The window accepts what the row's roll field holds and the roller parses; it
  is not the strike's `NdM` rule. A flat figure is a formula.
- The prompt is registered by the magic feature as a `prepare` contributor and
  by one call before `rollRow` on the cast path, so `attack-throw.mjs` is
  unchanged.
- **A recurring row asks at the cast, never at a later turn** (owner, relayed by
  the release hub: "the die typed at the cast is carried on that cast's record and
  its recurring turns roll it; no prompt opens at a later turn"). A recurring
  damage row that states no die asks in the cast loop where it is lined, and the
  die typed is stored as `card.dice = { [rowKey]: formula }`, the formula as the
  seat typed it. `castAt(card)` returns it and `rowsOfMode` fills the blank row
  with it, so every place that reads a card's rows again (the presses in
  `cast-recur.mjs`, the relay, Apply) reads the one row. A row with no die at all
  still rolls nothing and breaks nothing.

**Rejected.** Writing the die on the carrier (built per throw, nothing to keep
it). A second prompt for each instance. A save that overwrites a copy's own die.
A prompt at a recurring turn, which would stop a press the GM's client answers.

**What it cost.** A spell copy has a third place a damage die can come from, so a
Judge who imports a die later finds copies that keep their own; the sheet shows
no list of them. A recurring row's die typed at one cast is that cast's alone
unless it was kept, so a closed window leaves that cast's turns with none.

## 2026-11-25 — The power line opens from a tag, and its controls are the character's owner's (board 1)

This entry supersedes in part four entries of 2026-11-18, each on the bullets named under
"Superseded" below. The new evidence, which none of them had:

- Two field reports from the owner on the shipped strip (T-0789 and T-0830 on the intake ledger).
  The first: "This massive display of the character's divine / arcane power battery is ... a
  little too much, takes up too much space in the character sheet." The second, with a picture of
  the strip holding no power: "also how do i click out of this (magic power)". The strip as
  built on 2026-11-18 stood open on every caster, entries and controls together, and read as a
  window to be dismissed.
- The owner's standing rule, stated with the same batch: "Tool permissions are hardcoded (e.g.
  summons) by server role instead of object ownership, only judge secrets are supposed to be an
  exception to this rule". And, the same day, as the release hub's session quoted the owner to
  this build: "follow foundry permissions, don't invent new ones." and "owner can use the
  controls, don't hard code permissions unless explictly asked".
- Board 1 of the 2026-11-25 canvas, on which the owner selected "Build as drawn", and two
  selections on the release hub's cards: for a run of hand presses, "Fold into one entry"; and
  "All four are right" for the card's reading that the board's layout stands with its Add, Remove
  and Undo "offered to the character's owner too". The three quoted phrases are the cards' own
  wording, selected, not sentences the owner wrote.

**Ruled.**

- **The power line is a tag and a disclosure.** Each power keeps its tag, with the balance on its
  face and its tooltip. A button beside the tag opens that power's panel, which holds the entries
  and the controls. Every panel is closed when a window opens.
- **Every control is the character's owner's**, by Foundry's own ownership test, and a GM owns
  every character. Add, Remove, the Fades / Stays switch, the amount box, Undo and the arcane
  count are drawn for an owner and refused to nobody else by role. A seat that sees the sheet
  without owning the character reads the tags and the rows.
- **Presses fold.** A run of hand presses by one user is one entry, named for that user.

**Built.**

- The ledger refuses a request only where its sender does not own the actor. The role refusals
  are gone from all three places they stood (`run`, `checkPowerRequest`, `apply`) and the reason
  `judge` is returned by nothing. An entry carries `user`, the id of the user who pressed: the
  client's own on a direct write, the relay's attested sender otherwise, never a value the
  request carries.
- A press by hand folds into the power's last entry where that entry was written by hand by the
  same user, on the same day, with the same sign and the same Fades / Stays mark. The entry keeps
  its id and its day, so no lot's expiry is moved by a later press.
- An amount box, and Add and Remove that send the typed amount in one request.
- Undo on a spend, as before, and on a gain none of which was spent. A gain partly spent has no
  Undo, and its row says why in a line read without hovering.
- The arcane count sits in the arcane panel, beside the amount box. The board does not draw it.
- A window keeps which panels are open, each switch and each typed amount until it closes. A
  second window on the same character starts closed.
- No stored entry is migrated. The stored value `by: "judge"` stays as written and means a figure
  set by hand; an entry stored before this has no `user`, reads as it did and never folds.

**Superseded.**

- "The power ledger and its chip (M-l, ruling 217)": its bullets "The plus and minus are one pair
  on each tag, with no amount box", "The arcane count is a number box beside the arcane tag, for
  a Judge only", and "Undo is a Judge's, on a spend only"; and, in "A relayed request is
  authorized on its sender", the half that makes the hand adjustment, the undo and the count the
  Judge's. Its other half stands: direct or relayed is still decided by `canUserModify`.
- "The ledger's plus and minus: the owner's two answers": "One pair per tag" is qualified. Each
  power still has its own pair; the pair is Add and Remove in that power's panel.
- "The hand plus: a Fades/Stays switch (owner, board 14 B)": the sentence "a Player's strip draws
  none of it", and its bullets "A gain that stays is a Judge's act on every path" and "Each tag,
  its plus and minus, its switch and its count box wrap together as one group".
- "The minus follows the switch, and the switch holds (owner)": its bullet "The mark is the
  Judge's on all three authorization sites", and the sentence that the chip's minus asks for one.
  That the minus follows the switch, and that the switch holds per window, both stand.

**Decided in the build, not selected by the owner**, each with its counter:

- **A press folds only into an entry that was itself made by hand.** Every entry now records a
  user, a cast's and a sacrifice's included, so without this a hand press would join the entry of
  a cast made by the same user that day and lose the cast's name. *Counter (low):* none of the
  owner's words asks for it; the card's reading was of hand presses only.
- **An owner may undo any spend, a cast's included.** The board draws one Undo per entry and the
  ruling gives it to the owner. *Counter (medium):* a Player can take back what a spell cost. It
  is medium and not strong because the same Player can add the same power by hand, and both
  entries name them.
- **A short spend still blocks a Player and warns a Judge.** That is the automation rule (lib,
  2026-11-14, "Where the automation would refuse, a player is blocked and a Judge is warned"),
  not a permission, and it is the one place the ledger's answer still turns on the role. *Counter (medium):* it reads as a role test beside a
  ruling against role tests; the owner's exception names what is explicitly asked, and that rule
  was.
- **An owner reads both tags on a caster, held or not.** The controls need a tag to sit behind.
  Before, a Player saw only a power with entries. *Counter (low):* a tag at nothing is a line of
  the strip a Player did not have.
- **The open panels are a window's, never the actor's.** A stored state would open a panel on
  every seat that has the sheet up. *Counter (low):* a Judge who works the ledger reopens the
  panel once per window.
- **Undo is a button with its word on it**, as the board draws it, in place of the icon.

**Strongest counter to the ruling (medium).** A Player who owns a character can now write power
to it with no Judge in the loop, where every hand figure used to be a Judge's. It is not strong:
Foundry already lets an owner write any field of the actor, hit points and this flag included, so
the role test guarded a button and never the data; and a hand entry now names who pressed.

*Cost:* the walk's last pass is untrue and the walk is rewritten with this entry. The
chip is built and unit-tested (`tools/test-power-ledger.mjs`); until its walk has run on `main`,
the two seats' views are read from the code and a mock DOM and not from a world.

## 2026-11-25 — A caster's spells stand under the list they are cast from, and a cast is gated by its list (board 1)

**The evidence.**

- A field report from the owner (T-0790 on the intake ledger): "Different magic sources (Arcane,
  Divine, Eldritch, Gnostic, etc) spells are not grouped and tracked separately, especially
  important for spells that have different levels based on source". Reading the shipped tab from
  source for that report found two defects under it (T-0795, T-0797): the tab filed a spell under
  the level of the first list it names, whichever list the caster's class casts from, and a class
  with two casting rows had the system's one slot grid written from the first row alone, so the
  second list's casts were counted against the first list's maxima.
- Board 1 of the 2026-11-25 canvas, on which the owner selected "Build as drawn", and one
  selection on the release hub's card: for a spell on no list the character casts from, "Listed,
  Cast blocked for a Player". Both quoted phrases are the cards' own wording, selected, not
  sentences the owner wrote.
- The standing automation rule ([lib DECISIONS](../lib/DECISIONS.md), 2026-11-14, "Where the
  automation would refuse, a player is blocked and a Judge is warned"), and the owner's words the
  same day, as the release hub's session quoted them to this build: "follow foundry permissions,
  don't invent new ones." and "owner can use the controls, don't hard code permissions unless
  explictly asked".

**Ruled.**

- **A spell stands under the list it is cast from.** Where the character's class casts from a
  list, the Magic tab is a heading per list, in the class's order, and under it the spells that
  name that list at the level that list gives them. A spell on two of the class's lists stands
  under both.
- **Slots are counted per list.** Each list's levels carry that list's own used and maximum, read
  from the class's slot row and the character's pools, never from the system's one grid.
- **A spell on no list the character casts from is listed, and its Cast is blocked for a
  Player.** It stands under "Other spells". A Judge is warned and may cast it, by the automation
  rule.

**Built.**

- `spellStanding` (`scripts/magic/cast-capacity.mjs`) answers the tab's groups, and the tab
  (`scripts/character-sheet/tabs/magic.mjs`) draws them; a character with no class bound, or a
  class that casts from no list, keeps the tab by level with the system's slot pair.
- The hand slot pips sit on the list's heading, one row per level, and are the character's
  owner's by Foundry's own ownership test. The casting strip on this sheet draws none; the
  system's own sheet keeps its strip.
- A row sends the list it stands under with its Cast, and the cast reads and spends that list's
  slot (`castReading`'s `tradition`). A spell on two lists pressed under the second spends the
  second's.
- `isOffList` is one predicate for the tab, the row's gate and the cast; `VERDICT.offList` is
  raised in its place by `castVerdicts`, blocks a Player and warns a Judge, and pre-empts the slot
  verdict. A row shows the cast's own verdict before the press, as text on a line of its own.
- A declared cast stores the list it was declared through and resolves through it. A record
  stored before this has none and resolves as it did; none is migrated.

**Superseded.** No entry is reversed. One reading is qualified: where this log and the model
say the system casts a spell the cast claimant declines as it did before, that now holds for a
character with no class bound, a class that casts from no list and a monster. On a class that
casts from a list the gate claimant takes that cast, as the first item below records. The casting
strip's pips on the system's own sheet stand as built; on this module's sheet they moved to the
tab's headings.

**Decided in the build, not selected by the owner**, each with its counter:

- **A spell the cast window does not open for is gated and spends too**
  (`scripts/magic/cast-gate.mjs`, a second claimant on the cast seam). Without it the tab's row
  would say a spell is blocked while a hotbar macro cast it, and a hand-made spell on a class
  caster would spend no slot of its list. It adds no window: core's own cast runs, and the gate
  shows a notification at most. *Counter (medium):* it changes what a cast costs in a world that
  already holds such spells; the release says so under Upgrading, and the hand pips give a slot
  back.
- **A spell that names no list at all is not off list.** It carries no gate on the tab and the
  gate claimant never refuses it. The module blocks only where it knows the answer. *Counter
  (medium):* a hand-made spell with its list left blank spends no slot of any list; naming its
  list on the spell is the Judge's remedy.
- **Only a spell's own lists can put it off list; the system's class field cannot.** The system
  fills that field with a class word on every new spell, so a spell made with the tab's own add
  button would have been off list on any class that casts from a list, and its owner blocked. The
  field still places a spell under a list it matches. *Counter (medium):* a hand-made spell whose
  class field names another class's list is cast by a Player and spends no slot; the field is free
  text and proves nothing about a list.
- **The casting strip's rest control, pips and points pair answer a seat that owns the
  character.** The strip drew its rest anchor for every seat, and a press from a seat that could
  not write the actor failed. *Counter (low):* none found; the tab's own Rest was already the
  owner's.
- **The row and the gate claimant judge a list's own slots, never the system's count**
  (`listGate`, `cast-plan.mjs`). On a class that casts from lists the system's grid is one row of
  maxima for every list, and every list's casts count against it, so a refusal read from it would
  be the defect this board was drawn to remove. *Counter (medium):* the cast window still reads
  that count for a spell with effect rows where no list's slot row answers, so the window can
  refuse a Player what the row let through; that reading predates this board and is on magic's
  roadmap.
- **Where the world holds no slot maximum for a list, nothing blocks.** The used count rises and
  the cast goes through. *Counter (low):* a class made by hand with no slot rows never refuses a
  cast; a refusal there would rest on a figure nobody imported.
- **An off-list spell leaves the castable-spell register** (`repertoire.mjs`), since the register
  reads the same reading the cast does. *Counter (medium):* a surface that offers spells from the
  register will not offer one a Judge could still cast from the tab with a warning.
- **A row's lists line names every other list the spell stands on**, the class's or not, and a
  spell whose list is read from the system's class field carries the line too, its tooltip naming
  that field. Where the line is drawn the row drops the system's class string, which would say
  the same list twice. *Counter (low):* a list the class does not cast from is of no use to the
  Player; it is kept because it is where the spell's level differs.
- **The cast count stays one figure on the spell.** A spell on two lists shows the same count
  under both headings; the per-list figure is the slot row's. *Counter (low):* the count beside
  a row reads as that list's.
- **A points pool's minus and plus sit on its list's heading**, and a pool that is a ladder shows
  its line there, with no slot row per level. The board draws slots only.
- **Cast stays the icon button the sheet ships**, and the row keeps every control it had; the
  board's text button is not built. These two, and that the hand pips stay per level, are the
  release hub's corrections to the board, not the owner's.

**Strongest counter to the ruling (medium).** A Player holding a spell from a list their class
does not cast from cannot cast it without the Judge, where before the press went through. It is
not strong: the selection on the card chose exactly that, the Judge's own press goes through with
a warning, and the row says why in words read without hovering.

*Cost:* the tab's markup changed under every walk that presses its Cast; those walks are named
in the landing report and are rerun after it. The tab, the gates and the claimant are unit-tested
(`tools/test-magic-cast.mjs`, `tools/test-character-sheet.mjs`, `tools/test-cast-gate.mjs`,
`tools/test-cast-declare.mjs`); until the tab's walk has run on `main`, what two seats see is read
from the code and a mock context and not from a world.
