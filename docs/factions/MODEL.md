# Factions — how it works now

A faction is an organisation the party deals with as a body: a guild, a
temple, a syndicate, a noble house, the watch, a merchant company. It is an
Actor sub-type, `acks-extras.faction`, so everything the rest of the module
does with an actor — drag it onto a sheet, key an attitude item to it, roll a
reaction against it, shelve it in a compendium — works on a faction unchanged.
What the sub-type adds is a **standing ledger**: rows of the Judge's own
values, toward the party, one of its characters or another organisation, that
the reception roller, the settlement board and the hiring market read; a set of
**relations**, which is what it thinks of the other organisations; and the
**places** it is behind the door of. Why the ledger holds values the rules never
print is [DECISIONS.md](DECISIONS.md); what is not built is
[ROADMAP.md](ROADMAP.md); the live recipe is [TESTING.md](TESTING.md).

| File | Owns |
|---|---|
| `scripts/factions/constants.mjs` | The sub-type id, the kinds, the standing sources and scopes, the relation stances, the setting key, the hook names. |
| `scripts/factions/data/faction-data.mjs` | `FactionData` — the sub-type's schema and its own readers (`standingFor`, `wants`, `controlsRegion`, `hasMember`, `headcount`, `relationTo`, `holdsPlace`, `placeUuids`). |
| `scripts/factions/standing-logic.mjs` | The pure derivations: subject sets, row matching, sums, hunters, market steps, the parent-loop guard, and the relation readers (`relationOf`, `regardedBy`, `placesHeld`). Foundry-free. |
| `scripts/factions/standing.mjs` | The world-facing readers, the Judge's writers (the ledger's, the relations', the holdings'), and `marketClassShift`. |
| `scripts/factions/influence-listener.mjs` | The reception rows, pushed through the influence feature's modifier hook. |
| `scripts/factions/apps/faction-sheet.mjs` | The sheet: overview, members, relations, standing, notes; every drop a faction accepts. |
| `scripts/factions/module.mjs` | Registration (data model, sheet, setting, listener, token defaults) and the `acksExtras.factions` api. |
| `scripts/formation/hunt.mjs` | The hunt feed onto the settlement board — the formation feature's, because the board is. |
| `scripts/importer/faction-binding.mjs` | A settlement book's organisations, bound as factions (the importer's docs own the ruling). |

## Design doctrine

- **Reuse**: Actor documents and everything built on them; the lib place
  layer's roster row (`occupantField` in `scripts/lib/fields.mjs`, the same
  row a place keeps); the district Region behaviour as the thing a faction
  controls; the influence feature's modifier hook as the way a faction
  reaches a reaction roll.
- **Extend**: the `acks-extras.faction` sub-type (TypeDataModel) — `kind`,
  `notes` and a Judge-only `gmNotes`, a `seatUuid` (a place), `holdings` (the
  other places it keeps), a `leaderUuid`, a `parentUuid` (a faction,
  loop-guarded), `members` (roster rows), `relations` (its stance toward each
  other organisation), `controls` (district Region uuids) and `standing` (the
  ledger). Both new arrays default to empty, so an actor written before them
  loads unchanged and nothing migrates. Its prototype token draws as a marker:
  hover name, neutral, no bars, no sight.
- **Enhance**: the faction sheet; a listener on the reaction roll; a feed onto
  the settlement board's `wanted`; a market-class seam the henchmen engine
  asks at call time.
- **Invent**: nothing. No score, no band, no rule the book does not print.

## The ledger

A standing row is `{subject: {scope, uuid, name}, value, reason, time,
source}`. The **scope** says whom the row is about — `all` (everyone), `party`
(one party actor, by uuid), `character` (one actor, by uuid) or `faction` (one
other organisation, by uuid) — and the name
is copied in when the row is written so the ledger still reads after the
actor is gone; while the actor exists the sheet shows its own name, so a
renamed party is not remembered under the old one. The **source** says why: `favour`, `offence`, `crime`,
`wanted` or `manual`. The **value** is whatever the Judge typed, signed; a
`wanted` row usually carries none, because what it says is the source.

A reader holds a **subject set** for one side of a dealing: the party actor's
uuid, every member's, and every organisation any of them is rostered on
(`subjectsOfFormation`); or an actor's own uuid plus the formation it is the
party of or a member of, the organisations rostering any of them, and the
actor's own uuid again when the actor IS an organisation (`subjectsOfActor`).
Each takes one scan of the world's factions. A row counts for a set on exactly
one branch, so a party-wide favour and a member's own offence are two rows and
are never counted twice. `standingFor(faction, subjects)` is the sum of the
counting rows; `standingRowsFor` lists them; `isWantedBy` asks whether any
counting row's source is `wanted`.

A `faction` row is how a rivalry between organisations reaches a person: a
syndicate that has written −3 against the guild deals that way with every
guildsman, by the same route a party's favour reaches everyone marching in it.

The ledger is written only by a Judge, through `addStanding` and
`removeStanding`; both fire `acksExtras.factionStandingChanged` with the
faction and the row.

## Where a faction stands

A faction has a **seat** — a place, its hall or its temple — **holdings**, the
other places it is behind the door of, and **controls** zero or more districts,
named by the Region that carries the district behaviour.

A holding row is `{uuid, name, note, hidden}`: a chapter hall, a front, a
safehouse. The seat is the principal one and is never also a holding — a place
already held is refused rather than listed twice — so `placeUuids` is the seat
followed by the holdings, deduped, and `holdsPlace(uuid)` asks about both at
once. A `hidden` holding is left out of a player's view of either sheet.

`factionsAt(place)` returns the factions holding the place or a place it is
inside of (a guild seated in the city holds every market in it), or controlling
the place's own district (a place made from a district carries its
`regionUuid`). `factionsHolding(placeUuid)` answers for **that place alone**,
with no ancestor standing in, which is what a place's own sheet asks;
`factionsControlling(regionUuid)` answers by district alone. A faction may sit
**inside** another (`parentUuid`); the sheet refuses a parent that would close
a loop.

A location's sheet lists the organisations at it, read through this feature's
api at render time (`docs/location/MODEL.md`, "Organisations here").

## Relations

A relation row is `{uuid, name, stance, note, hidden}`: how this organisation
regards another. The **stance** is one of `RELATION_STANCES` — allied,
friendly, neutral, rival, hostile — and it is a label the Judge picks, like
`kind`. Nothing derives a number from it, and nothing adds it to a throw.

Relations are **directed**: the other side's view is its own row on its own
sheet, so a guild that thinks it is friendly with a syndicate that thinks it is
hostile is two rows that disagree, which is the state being described.
`relationBetween(a, b)` reads a's row about b; `regardedByFactions(faction)` is
the reverse view, one entry per other world faction that names it, carrying
that faction's own identity rather than the row's copy of this one's. A
`hidden` relation is shown only to a Judge, on the sheet and on the reaction
dialog alike.

The relations writers are the Judge's, like the ledger's: `setRelation` upserts
by uuid and refuses a row about itself, `removeRelation` drops one, and both
fire `acksExtras.factionRelationsChanged`.

**Members** are the same roster rows a place keeps. A row marked hidden is
omitted from a player's view of the sheet; `factionsOfMember(actorUuid)`
finds the factions rostering an actor, hidden or not.

## What reads the ledger

**The reception.** `influence-listener.mjs` listens on the influence
feature's modifier hook (`docs/influence/MODEL.md`, "The modifier hook") and
answers only for the reaction family. It pushes one row per faction, "Standing
with <name>", for the target itself when the target is a faction, for every
faction rostering the target, and — when the actor's party stands in a
district in settlement mode — for every faction controlling that district;
each faction speaks once, and a zero standing is silent. A `watch` or
`noble` faction controlling the district that rosters the actor adds a
"Legal authority here" **note** — the hook's row with no figure, which the
roller keeps because it is marked one and draws on the dialog alone — so the
Judge can see the character is speaking for the law before deciding the
authority tick. It is not a modifier the book prints, and it adds nothing.

A fourth row is a note for the same reason: when an organisation across the
table holds a relation row about one the speaker belongs to, and its stance is
anything but neutral, the dialog says so — "<Other> regards <Own> as <stance>".
A stance is a label, so it is said and never added; the figure that goes with a
standing rivalry is a `faction` ledger row, which arrives on the numeric side
because the subject set carries the organisations each side answers for. A
hidden relation reaches a Judge's dialog only.

**The hunt.** A faction that holds a `wanted` row for the party or a member,
and controls the district under the party, marks the settlement board hunted
there. The board is asked once per quarter, on entering the city and on
crossing into another district; while the party stays, the Judge's own word
on the flag stands. How the board carries it (`huntRegion`, `huntedBy`) and
why it is asked per quarter are the formation feature's
(`docs/formation/MODEL.md`, "Being hunted"; `docs/formation/DECISIONS.md`).

**The market.** `marketClassShift(location, employer)` is the standing sum
over `factionsAt(location)` toward the employer, in whole steps of the world
setting `standingPerClassStep`. The henchmen engine's `effectiveMarketClass`
adds it through the api at call time, so a step of 0 — the default — leaves
every market exactly as it was. The step is the Judge's number; the rules
print no reputation.

**Status** is not this feature's. The social-rank fact is the henchmen
feature's chain (`docs/henchmen/MODEL.md` §7) and the status row it feeds is
the influence feature's auto source (`docs/influence/MODEL.md`, "The modifier
stack"); a faction of kind `watch` or `noble` is only what makes the
authority label above fire.

## The sheet

Five tabs. **Overview** — image, name, kind; the seat, the leader and the
parent, each openable and clearable; the places held beneath them, each with a
note, a Judge's hidden toggle and removal; the districts controlled, with a
picker listing every district Region on every scene. **Members** — the roster,
with a hidden toggle and removal. **Relations** — its own rows about the other
organisations (stance, note, hidden, removal, and a picker of every other
faction it has no row about), the read-only reverse view beneath them, and the
ledger's total per subject, so one tab answers how it stands toward an
organisation, a character and a party alike. **Standing** — a total per subject
and the ledger in order, day-stamped from the world clock, with a **Record
standing** prompt (scope, party, character, faction, value, source, reason).
**Notes** — the faction's notes, and the Judge's own beneath them for a GM.

The relations and holdings row controls are the Judge's, like the ledger's:
another editor reads them. They carry no form `name` and answer to their own
change listeners, because a schema array cannot be patched by index through the
form — each edit rewrites the whole array, and the event is stopped before the
form's submit-on-change sees it.

Drops, read by what is dropped and by the tab showing: a location on the seat
row, or anywhere while there is no seat, becomes the seat, and otherwise joins
the holdings — never both. A faction becomes a relation at neutral on the
Relations tab, a ledger row about it on the Standing tab, and the parent
anywhere else. An actor dropped on the leader row becomes the leader, on the
Standing tab opens the prompt with that actor as the subject, and anywhere else
joins the roster.

## Public API — `acksExtras.factions` (apiVersion 2)

`FACTION_TYPE`, `FACTION_KINDS`, `RELATION_STANCES`, `STANDING_SOURCES`,
`SUBJECT_SCOPES`, `HOOKS`, `FactionSheet`; `isFaction`, `allFactions`,
`factionsControlling`, `factionsAt`, `factionsHolding`, `factionsOfMember`,
`authoritiesRostering`, `districtRegionOptions`; `subjectsOf`,
`subjectsOfActor`, `subjectsOfFormation`, `matchesSubject`, `sumStanding`,
`standingFor`, `standingRowsFor`, `isWantedBy`, `huntersOf`, `classStepsFor`,
`marketClassShift`; `relationBetween`, `regardedByFactions`; `addStanding`,
`removeStanding`, `setRelation`, `removeRelation`, `addHolding`,
`removeHolding`.

Hook `acksExtras.factionStandingChanged` — `{faction, row}` after a row is
written, `{faction, removed}` after one is removed. Hook
`acksExtras.factionRelationsChanged` — `{faction}` after a relation row is
written or dropped; a relation is read whole off the document, so the hook
names the organisation and not the row.

## Settings

| Setting | Meaning |
|---|---|
| `standingPerClassStep` | Standing per market-class step (world, default 0 = standing never moves a market). |
