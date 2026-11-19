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

A press does one of four things (`planPress`). A party with a session already
open gets its screen and nothing else. A press while the first is still opening
a session does nothing. A card whose scene was opened once, and has since ended,
is refused, so one card deals once (`record.opened`, stamped when the open
succeeds). Otherwise it opens a session at **the place whose area holds the
party token**: `placesAround`'s first, the closest area first, as a map drop
picks it. A party with no token, or a token no place holds, is refused with a
notice. The session is opened through `api.open` with the card's id as
`recordMessageId`, and the screen opens on success. A deal that rolls nothing
(a letter the tables deal no card for) does not stop the scene: it opens with
the bodies and no pot, so a second press cannot roll again.

A seat reads through a projection. A Judge reads every entry and the whole log.
A player's `read` drops hidden entries, empties every unfound layer's yields,
keeps the public "something more" mark, and returns `playerLog`: only rows at
entries the seat can see, a miss blanked to who and what, no card id.

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
the pot's `origin.carried` (card id to that item) before the pot opens, and the
opening takes the goods off the bodies the way treasure's take-off does (see
[treasure MODEL](../treasure/MODEL.md), "Search the fallen"). The lair warning a
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
the pot's cards. It holds no search state of its own but the open picker.

A card paints a texture only through `treasure/card-art.mjs` `textureArt`; with
none imported it is a plain slab with its frame and words.
