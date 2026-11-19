# Scene search — how it works

Present tense. The owner's words are in `wip/20261118-scene-search-plan.md`;
rulings and rejections are in `DECISIONS.md`; the live-test recipe is
`TESTING.md`.

## Entries and checks

A party searches a place (an `acks-extras.location` actor). Every inspectable
there is one **entry**: a thing of the place's list (`flags["acks-extras"].things`,
shape in lib's `place-things-logic.mjs`), or one derived from the map or a fight
(a body). `scene-logic.mjs` is the arithmetic: `sceneEntries`, `seatView`,
`remainingKinds`, `layerOptions`, `outcomeOf`, `recordOutcome`. It has no dice,
documents or words, and every printed figure (a throw target, the reach) is an
argument.

Each entry has two checks, **hasty** (a round) and **methodical** (a turn). A
check answers `scene:found` with what its layer yields, or `scene:foundNothing`;
a member without the capability a hasty check wants gets `scene:vague` (a hint
that something more is here). A failed hasty throw locks that character at that
entry until a level is gained.

## The session

`flags["acks-extras"].sceneSearch` on the party actor: place, scene, pot,
`shown`, bodies, dealt lots, the log. `api.mjs` opens, ends and shows it
(Judge-only), assigns members, and answers `read(partyId)`.

## Ways in

Two controls open a session, and both are `acksExtras.sceneSearch.searchHere`
(`ways-in.mjs`; `ways-in-logic.mjs` is its pure half):

- **Search the scene** on the fight-over chat card (Judges only, from
  `treasure/search.mjs`). The card's record names the fight's scene, and the
  party is the one party whose token is on it, else the world's only party
  (`partyOfRecord`); two parties on that scene are not told apart and none is
  named.
- **Search here** on the party sheet, Dungeon tab, in the Turn plan section
  (`formation-actions.mjs` `searchHere`). A Judge's press is the call with the
  sheet's party. A player who owns a member sees the button too, and a player's
  press is a declaration, not this call: the party's request relay takes a
  `declareSearch` request (closed: no payload is read, any-member ownership),
  announces it, and moves nothing. The Judge then presses.

A press does one of five things (`planPress`). A party with a session already
open gets its screen and nothing else. A press while the first is still opening
a session does nothing. A card whose scene was opened once, and has since ended,
reopens for a Judge and is refused for anyone else, so one card deals once
(`record.opened`, stamped when the open succeeds; see "Reopening a spent card").
Otherwise it opens a session at **the place whose area holds the party token**:
`placesAround`'s first, the closest area first, as a map drop picks it. A party
with no token, or a token no place holds, is refused with a notice. The session
is opened through `api.open` with the card's id as `recordMessageId`, and the
screen opens on success. A deal that rolls nothing (a letter the tables deal no
card for) does not stop the scene: it opens with the bodies and no pot, so a
second press cannot roll again.

A seat reads through a projection. A Judge reads every entry and the whole log.
A player's `read` drops hidden entries, empties every unfound layer's yields,
keeps the public "something more" mark, and returns `playerLog`: only rows at
entries the seat can see, a miss blanked to who and what, no card id.

## Reopening a spent card

The first opening stamps its card (`markCardOpened`) with `opened` and what it
made: the pot's uuid, the place it opened at, and each dealt lot's key, entry and
layer. Ending a session (`api.end`) only unsets the party's session flag: the pot
stays open, with its cards, their found marks and the goods it maps, so
everything a reopening needs is on the pot and the card.

A Judge's press on a card whose scene has ended is `planPress`'s `reopen`.
`api.open` sees a record that is `opened` and never draws a table nor deals:
the session is made from the record's bodies, at the stamped place (not where the
party stands now; a card stamped with no place falls back to it), with the pot
reattached when it still exists and is open (`haul.mjs` `reattachSceneHaul`).
The stamped lots are put through `lotsInPot` against the pot, so each lot returns
attached to its entry and layer with its card, and the bodies take back what the
pot can say of their state: a layer whose every lot is found reads as found
(`haul-logic.mjs` `bodiesWithFound`). A failed check's lock, and a body's state
where no lot was dealt, are not recovered. The card is not stamped again.

If the card kept a pot and it is gone (a closed pot is deleted), the scene
reopens with its bodies and no lots, the Judge reads treasure's "That treasure
pot is gone.", and the screen's tray says no pot was dealt. A deal the caller
names with `sources` is the caller's own and runs as asked, on an opened card too.
A player's press never reaches this: `searchHere` is Judge-only, and `planPress`
refuses a spent card (`cardSpent`) to a press that is not a Judge's.

## Time

Assigning a member is a turn-plan lock (`sceneHasty` a round long,
`sceneMethodical` a turn). A Judge's call locks directly; a player's goes
through the party's `plan` relay for a character that seat owns. The Round press
(`round.mjs` `resolveSceneRound`) is the Dungeon tab's own Round press: one
round on the party's clock (`advanceRounds`), then the plan's `resolvePlanRound`,
which resolves every round-length entry due. Spend a turn is the Dungeon tab's own
`resolvePlanTurn`.

Resolution (`activities.mjs` `resolveSceneCheck`) runs on a Judge's client: the
member rolls for themself, the answer is applied to the entry's `state`, found
lots are marked on the pot, a reveal shows the entries it names, the row joins
the log, and the Judges alone get a whispered card. The card's id is kept on the
log row and the throw's figures on the card's flag (`words.mjs` `ROLL_FLAG`), so
the Judge's screen can read the throw and no other seat can. A check never
resolves at an entry the user who locked it cannot see: the plan entry's `by` is
read through the `planBy` seam (both presses stamp an entry and keep it
in the plan while it resolves), because the relay runs a lock on a Judge's client with no word of who asked.

## The haul

The Judge's roll deals the treasure when the session opens, into a pot
(`treasure/pot.mjs`), every lot unfound. A lot is found when the check that
holds it is. The pot's window and the tray show a player the found lots only.

A fight's record turns into the session's bodies and a source for each body
(`session-logic.mjs` `bodiesFromRecord`): the goods it carried, then whatever
its linked table drew (`api.mjs` draws it through treasure's own
`drawFallenTable` before the deal, once the cheap refusals are past, and only
where the record is the deal). Each carried truth keeps the `{actorUuid,
itemId}` it was made from through the source and the lot, so `haul.mjs` writes
the pot's `origin.carried` (card id to that item) before the pot opens. Opening
takes nothing: a check's resolution marks the lots it found (`markSceneFound`) and
then takes each found lot's good off its body, through treasure's own take-off
(`takeOffBodies`, handed in as the `takeOff` seam of `configureSceneChecks`; see
[treasure MODEL](../treasure/MODEL.md), "Search the fallen"). A lot found again
takes nothing, and a body that is gone leaves its card on the snapshot. The lair warning a
body's letter raises is shown to the Judge as a notice and the deal goes on.

## The screen

`screen.mjs` is one window per party (`openSceneScreen(partyId)`), drawn from the
view model `screen-logic.mjs` `buildScreen` makes for the seat that opened it:

- **Header:** the place, the seat, and, for the Judge, whether the scene is shown
  and the Show the scene button. A player's screen reads "The Judge has not shown
  the scene yet" until `session.shown` is true; the button also opens the screen
  on every seat that owns one of the party's characters (a socket broadcast).
- **Bar:** lots found and entries untouched (the visible ones), the press line
  (what a Round and a Turn would resolve now), the party's turn count, and the
  two presses. A Judge's press resolves; a player's asks the Judge (`ask`, the
  party relay's `askPress` request), which announces it and moves no clock.
- **Entries:** one card each: kind and state, a Hidden tag only the Judge sees,
  the name (the document an entry points at, else the word for its kind, told
  apart by order), what its checks found, the public "something more" line once a
  check was made, the Judge's notes (lots waiting, what a hidden entry hides
  behind), and the two rails. A rail lists who is assigned, a struck chip for a
  character the hasty lock holds out, a bar for a check of several turns, and
  `+ Assign`. A found check offers no assigning.
- **Assigning:** the picker lists the members this seat may assign, each with the
  reason where the member may not attempt the check; or a member tile is dragged
  onto a rail (that check) or a card (the first check the member may attempt).
  Both end in `assign`, so a refusal reads the same either way.
- **The party and the log:** where each member is assigned; the log newest first.
- **The tray:** one tile per lot, the pool word its back shows
  (`cardView`'s `poolKey`, so unidentified magic reads as an item to a player), a
  dashed tile for a lot not yet found (Judge only), and Open the pot.

The window re-renders on the formations record, the party actor, the place and
the pot's cards. It holds no search state of its own but the open picker and, on
the Judge's seat, the entry whose keying fields are open.

A card paints a texture only through `treasure/card-art.mjs` `textureArt`; with
none imported it is a plain slab with its frame and words.

## Keying

The Judge keys what a place holds in one rail, drawn in two windows
(`templates/scene-search/keying-rail.hbs`; `keying-logic.mjs` is its pure half,
`keying.mjs` the Foundry half): the **Things here** tab of the place's sheet
(Judges only; a seat that is not a Judge has neither the tab nor its context),
and the left aside of the scene screen's Judge seat, for the entry selected
there (a card's name, or the card). The tab lists the place's things, each row a
summary of both checks and a flag, and under it, read and never keyed, what the
map says (`derivedInputs`: doors and old-style trap zones; nothing derives them
yet, so that list is empty today). A row opens its rail.
A trap, an obstacle or a condition (the hazard group, a thing like any other) is
a row; an Item dropped on the tab goes through the one kind table
(`region-place-row.mjs` `dropOnPlace`: `kindOfDrop`, `thingOfDrop`,
`addThingTo`, no `point`), and any other Item is the sheet's own goods drop.

Every field writes a key the thing already has, and none adds one:

| Field | Writes |
|---|---|
| Hidden from the table | `hidden` |
| Behind (a clue that shows it) | the OTHER thing's `layers.<layer>.yields.reveal`: this thing's key moves off any clue it was behind onto the layer picked, in one write; a clue the entry itself leads to is not offered |
| Something more (optional line) | `hint`; blank removes it and the table reads the generic words |
| Check | the layer's `check`; leaving Proficiency drops its `capability` |
| Proficiency | the layer's `capability`, picked from the imported library abilities that stand for one |
| Others may look hastily | the hasty layer's `anyone` |
| Yields | `yields.clue`; the lots dealt at open and the reveals are listed read-only |
| Tools | the methodical layer's `tools`, by dropping an item |
| Turns | the methodical layer's `turns`; blank stores nothing |
| Show to the table | `state.shown`, which a Reset clears |
| Remove | lib's remove, then every reveal that named the thing is taken out |

An authored write is lib's `reviseThingsOn`: it reads the list at the moment of
the write, asks the keying logic for edits against the list AS STORED, and
merges each edit key by key. The rail's own view carries the session's dealt lot
keys in each layer; they never reach the place, since an edit names only the
keys it changes and `state` is never written by it. A thing read from the map
or from a fight (a door, an old-style trap zone, a body) has no list row: its
rail says so and holds no field. A change that cannot be kept (a turn count that
is no whole number, a clue that would loop) is refused in words and writes
nothing.

## Lore checks

A layer whose check is Proficiency (`layers.<layer>.check = "skill"`, with a
`capability` token the rail picked) is thrown by the member's own imported
ability. The proficiencies the importer reads a throw for are Theology,
Naturalism and Magical Engineering (a recipe each), and Loremastery (the effect
scan's lift: one throw that moves with level); Sensing Power prints none. The
resolution is the one every check shares, and `lore-logic.mjs` (pure) names the
three facts that are particular to a skill:

- **Who holds it.** A member holds the proficiency when an ability item carries
  the register stamp that stands for the token, or lists the token in
  `provides` (`lib/capabilities.mjs` `hasCapability`). A hand-typed item of the
  same name holds nothing, and gives the check no throw. A second rank is a
  second item and changes nothing here.
- **Which throw.** The check is `skillConfig(token)`: the ability's capability,
  no name pattern, no Adventuring stand-in, and `rollKey: null`, so the party
  check takes the ability's FIRST non-measure throw in its stored order, at the
  member's level (`party-rolls.mjs` `resolveCheck`, `abilities/adventuring-throw.mjs`
  `skillThrow`). Of several holders' items the lowest target is used. The layer
  names a proficiency and not one of its throws, so a proficiency with two
  throws is keyed to the first. Per-rank steps are not modelled yet (ROADMAP,
  R-I1b): a second rank reads the first rank's figure.
- **What the member gets.** With the throw: the held member rolls
  `rollCheckFor` for themself, secretly, and the Judges' card names the ability
  and the figure. Without the proficiency: at the hasty check the vague hint
  where something is here, at the methodical check the refusal
  `scene:capabilityMissing`. With the proficiency and no figure read (nothing
  imported, or an import that dropped its locator): `scene:notImported`, the
  option cannot be assigned, and the picker's tooltip is the page the member's
  own ability item cites (`figures.skillCites`, taken from the item's import
  stamp). A hand-made ability cites none, and the tooltip is empty.
- **A proficiency that prints no throw.** `constants.mjs` `AUTOMATIC_SKILLS`
  lists the tokens whose page prints none. A listed token, held by the member,
  with no throw read off the member's own ability, is made and not rolled: the
  option is offered (`automatic: true`, no target), the check answers
  `scene:found` or `scene:foundNothing` from what the layer yields, nothing is
  rolled and no Judges' card is posted, and the hasty lock cannot apply (it is
  set by a failed throw). Named tools are still required. A listed token whose
  ability carries a throw is thrown like any other; a token not listed is never
  automatic, however empty its figure.

Every figure is the member's own imported one; no target, step or modifier is
shipped. Offline coverage is `tools/test-scene-lore.mjs`, which joins the real
party check to `skillConfig` over ability items shaped like the importer's.
