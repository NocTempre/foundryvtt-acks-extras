# Scene search — decisions

Dated: what was ruled, what was rejected, what it cost. The owner's words that
govern the feature are in `wip/20261118-scene-search-plan.md`.

## 2026-11-18 — A session keeps what a place's list must not: lot keys, bodies' state

Every dealt lot's key is kept in the session's `lots` (`{key, thing, layer,
cardId}`, `thing` being the entry's KEY: `thing:<id>`, `body:<id>`), and
`overlayLots` adds the keys to each entry's layer when the entries are read.
Rejected: writing the keys into the place's `yields.lots` (`attachLots`), which
makes a runtime fact of one search part of what the Judge authored and leaves
a body's keys with no thing to land on (`missing`). A body has no thing either,
so its `state` rides in the session's `bodies`; the cost is that a Reset of the
place does not clear a body, and ending the session discards both.
Doors and old-style traps have no home for state at all and are not entries
yet (`session.mjs` `derivedInputs`).

## 2026-11-18 — Assignment is a plan entry, and the party's `plan` relay carries a player's

`assign` is `lockPlan` for a Judge and the party's existing `plan` request for a
player, checked first on the player's own client with `planRefusal`. The
registry's activity key says which layer rolls and the option id is the entry's
key. `open` and `end` have no relay that fits (the `plan` relay carries a plan
entry and nothing else), so a player's call is refused with `scene:notAllowed`;
the Dungeon tab's Search here (S5) brings its own declaration.
A player's `ok: true` means declared, since the relay answers a plan request
nothing; a character the seat does not own is refused on the seat itself.
Known edge: the relay's registrant calls carry no user, so a hand-made `plan`
request from a player could name an entry the Judge has not shown. The
projection hides hidden entries from every screen and from `options`, but the
relay does not re-check; closing it means passing the requesting user in the
lock's `ctx`.

## 2026-11-18 — The Round press is one seam, `resolveSceneRound` — SUPERSEDED IN PART 2026-11-19

Close-out's `resolvePlanRound` owns the press once `turn-plan.mjs` exports it,
and `resolveSceneRound` calls it and nothing else. Until then it takes this
session's unresolved round-length entries out of the stored plan, then resolves
them through the activities' own `resolve`. Taking them out first is the point:
left in, the next Turn counts them down and rolls them a second time.
Rejected: importing `resolvePlanRound` by name, which is a load-time error
until it exists.

## 2026-11-18 — Writes come from the pressing Judge's client

The brief asked for a frequent `state` write to come from the active GM's
client. `executeAsGM` runs locally on any GM seat and turn-plan's own writes
are the pressing GM's, so a gate on the active GM would drop a second Judge's
Round press without a word. Rejected; the write is `updateThingOn`'s, from
whichever GM client pressed.

## 2026-11-18 — Which Region a drop makes a place of

A drop on the map goes to the place whose area holds the point, closest area
first (Region, then token footprint, then map), and otherwise to the smallest
Region over it that has no behaviors, which is made a place first. A Region
with a behavior is a zone, a terrain or a district, another feature's area, and
is not made a place by a drop. A trap is the wall assignment's first (`installTrapDrop`)
and falls to the place only where no wall is near; the Region row's own map
hook takes obstacles and conditions and never a trap.

## 2026-11-18 — An unimported reach never refuses

Built to the model (`scene-logic.mjs`): a thing with a point is out of reach
only when the reach is imported and the scene has a scale and the party token
is on the scene; otherwise reach is the Judge's call. The brief's "with nothing
imported, nothing is in reach by distance" reads the other way, as a refusal
that would block every point-bearing thing in a world with no import. Open for
the owner. The gate would go in `activities.mjs` `blockedOf` and
`resolveSceneCheck`.

## 2026-11-19 — The screen: what S4 built to the boards, and where it stopped

Built to the approved boards (SceneJudge, ScenePlayer, SceneCards): the header,
the bar, the cards with their two rails, the party, the log and the haul tray,
for both seats. Left to later slices: the Judge's keying aside (S6), harvest
rows (S7b), fight bodies' pictures (S5), and doors and traps read off the map
(R-DC1). Four readings the boards do not settle:

- **A player's Round and Spend a turn ask the Judge.** The board says a player's
  press "asks the Judge (the turn plan's relay)", and the party's relay had no
  kind for it; a kind that moved the clock would let any player advance it. The
  owner chose "Notify the Judge": the relay's new `askPress` request announces
  the ask and moves no clock and resolves no plan; only the Judge's own press
  does either. Rejected: drawing both buttons disabled on a player's seat.
- **`shown` gates the screen, not the read.** A player's screen has nothing to
  show until the Judge shows the scene; `read` and the Dungeon tab's plan select
  still answer a player at an open session, so a seat that calls the api reads
  what the projection lets through. Gating `read` would also empty the Dungeon
  tab's options for a seat. Open for the owner.
- **The "something more" line shows once a check was made at the entry**, as the
  boards draw it (a Seen card carries no mark, a checked one does), though the
  projection holds the mark from the start. The line is the Judge's own hint
  where one was written, else the generic words, else the vague words where the
  latest answer there was the vague one.
- **The bar's cap reads "After the battle" for a search a fight's record opened,
  and "Searching here" otherwise.** The boards draw only the first. The second is
  the one word needed for a search with no fight.

A lock a player's hand-made `plan` request makes at a hidden entry is held back
at resolution, not at the lock: the relay runs `lockPlan` on a Judge's client with
no word of who asked, and `turn-plan.mjs` is the dungeon close-out's. The check
reads the plan entry's `by` (`planBy` seam, `activities.mjs`
`namedBeyondSight`; both presses keep the entry in the plan while it resolves)
and refuses an entry that
user cannot see. The lock itself
still lands in the plan, so a hidden key a player guesses is stored until the
Judge's next press; closing that needs the registrant calls to carry the asking
user (R-DC3). Likewise the Dungeon tab's select labels each entry by the
activity alone (`optionLabel` ignores an option's `label`), so while a session is
open it lists identical lines; the scene's options carry `label`, which that
function can read once R-DC3 lands.

## 2026-11-19 — The Round press spends a round, and the scene's own resolution goes

New evidence since the 2026-11-18 seam entry: close-out's `resolvePlanRound`
landed (R-DC6), and it spends no clock time by design: the Dungeon tab's Round
press spends one round (`advanceRounds`) and then calls it. The scene's Round
press is now that same pair, so a Round on the scene screen costs the clock what
a Round on the Dungeon tab costs. `resolvePlanRound` stamps each due entry and
keeps it in the plan rather than taking it out, so the next Turn rolls nothing
twice and the plan entry's `by` is still there for the locker check; the
scene's fallback (unlock, then resolve) and the `lockedBy` it carried are
removed. The import stays lazy, as the seam entry ruled.

## 2026-11-19 — The ways in: Search the scene replaces Stage a pot, Search here opens a session

The owner, answering Q9: "B, there is no "stage a pot" as a thing", and "rolled
by judge before interaction, visible as found"; and on the party sheet: "It
could also be used in general when the party declares searching even without
combat... add integration on party sheet?". Built to the SceneKey board's "Two
ways in" (design approved). Supersedes in part treasure DECISIONS "2026-11-17 —
Search the fallen" (its Stage a pot); the evidence is the owner's Q9 answer and
S5 itself. Readings the board does not settle:

- **The place is the first of `placesAround`, with no picker.** The board shows
  none for a party standing in several places, and a map drop already takes the
  first. A party in no place is refused with a notice. Open for the owner: a
  picker, if two places at the same area ever tie.
- **The party is named from the card's scene.** A record carries a scene and no
  party. One party on that scene, else the world's only party, else a refusal.
  Rejected: remembering the fight's party on the combat, which the end of the
  fight clears.
- **One card deals once.** The card is stamped when its scene opens, and once
  that scene has ended the same card is refused, since a second deal would
  duplicate goods already taken off the bodies. Open for the owner: whether a
  Judge who ended the scene by mistake can reopen a card's scene.
- **The lair warning is a notice, not a prompt.** A body's treasure letter raises
  treasure's lair warning, which has no control on the board. The Judge pressed
  to search, so the warning is shown with treasure's own words and the deal goes
  on ("judges get warnings"). Rejected: a confirm dialog, which the board does
  not show. Open for the owner.
- **A deal that rolls nothing still opens the scene.** The deal answers empty
  when every letter dealt no card, and the session would not open; the card
  would stay fresh and each press would roll again, against "rolled by judge
  before interaction". The press opens the scene with the bodies and no pot
  instead, and stamps the card.
- **A player's Search here declares and moves nothing**, the same reading as
  `askPress`: any member's owner may declare, the request reads no payload, and
  the Judge opens the scene.
- **Goods leave the bodies when the scene opens**, since the pot opens in the
  same call as the deal. Open for the owner: leaving each good on its body until
  a check finds its lot would be truer to the table but needs the found mark to
  drive the take-off.
- **A text result of a body's table is kept on the fight-over card**, as before,
  since no card shape can deliver it; the draw runs again if a refused open is
  pressed again.
- **A fight whose fallen hold nothing posts no card**, so it has no way in but
  Search here. Left as is.

## 2026-11-19 — Keying: what S6 built to the boards, and where it stopped

Built to SceneKey (the Things here tab) and SceneJudge (the keying aside), both
approved, as one shared partial. The owner's rulings it stands on: the three
layers ("an obvious layer ... an obvious with inspection layer ... found with
methodical search and/or appropriate skill"), "Some things might be explicitly
hidden up to judge's discretion", Q4 ("it is meta-public knowledge if more
clues remain unless it is hidden behind an unsolved (still something off)
clue"), Q5 (the optional line, else the generic words), Q6 ("only checked
hastily and checked methodically for each inspectable"), and "Traps, obstacles,
conditions can stack arbitrarily". Readings the boards do not settle:

- **Lib gains an authored write, `reviseThings` / `reviseThingsOn`.** The
  list had writers for `hidden` and `state` only (`patchThing`), and none for
  `hint` or a layer. The shape is unchanged. The op merges key by key and is
  handed the list as stored at the write, so the screen's view, which carries
  the session's dealt lot keys in each layer, can never write them into the
  place (the 2026-11-18 ruling that rejected it). `patchThing`'s own narrow
  contract is left as it was. The cost is a change to lib's co-signed file;
  nothing signed there moves.
- **Show to the table sets `state.shown`, not `hidden`.** The model's own
  words are that a hidden entry is visible once shown and a Reset hides it
  again; `hidden` is what the Judge authored. The brief's "makes the one entry
  not hidden" is met for the table (the entry is visible now) without editing
  the authored flag; unticking Hidden from the table is the field that does.
  Open for the owner: whether a show should outlive a Reset.
- **Behind is the clue's, not the entry's.** There is no key on a hidden thing
  that names its clue; the reveal lives on the clue's layer. The select offers
  one option per other thing and layer, and takes the key off any clue it was
  behind, so an entry is behind one clue at a time. Rejected: a new `behind`
  key on the thing, which the shape does not have and would duplicate the
  reveal. A thing read from the map cannot be named as a clue in front (it has
  no list row), and cannot itself be put behind one from the rail.
- **Yields is the clue text alone.** The lots belong to the session (dealt at
  open) and the reveals to Behind; both are listed read-only. Rejected: one
  field that edited all three.
- **The Seen line has no home in the shape and is not built.** The plate's name
  is the document an entry points at or the word for its kind; no key holds a
  line of the Judge's. Not invented.
- **Disarm (trap) is not offered.** A named-capability check resolves through an
  ad hoc config with no throw column (`rollKey: null`), where the party's
  Trapbreaking methodical check names its own; the two were not shown to give
  the same figure, so the option is not offered until a check of its own exists.
- **Proficiency needs a picker, which the boards draw only as "Proficiency…".**
  A select of the imported library abilities that stand for a capability
  appears under the check when it is Proficiency; nothing but those names ships.
- **Turns carries no default and no placeholder.** Blank stores nothing, and the
  tooltip carries the page reference.
- **Remove also takes the thing's key out of every reveal**, in a second write,
  so an id the list reuses later is not shown by a clue that named the old one.
  Dealt lots a session keyed to the removed thing stay in the session, as an
  ended place's do.
- **The screen's rail opens by selecting a card**, on the Judge's seat only; with
  none selected the aside says to open one. The boards show a selected entry
  throughout.

## 2026-11-19 — Lore checks: a keyed proficiency rolls its first throw, and a throwless one is made

S7a asked whether the lore proficiencies (Theology, Loremastery, Naturalism,
Magical Engineering, Sensing Power) work as a thing's check. They did, end to
end, once the importer read a throw (R-I1): the rail writes `capability`, the
member's `skillConfig` resolves the ability's throw, and a member without it
gets the owner's vague hint or a refusal. S7a built the two gaps it found and
pinned the rest.

- **A keyed check rolls the ability's first throw.** The rail picks a
  proficiency, not one of its throws, and two of the three recipes carry two
  (the second is a different use of the same proficiency). `rollKey: null` takes
  the first in stored order; a rail control naming the throw is a new UI element
  and goes to `/design` first. Rejected: choosing the lowest figure, which would
  roll the throw nobody keyed.
- **A proficiency that prints no throw is made, not rolled** (Sensing Power, RR
  ch. 3). A holder's check is offered with no target and answers from what the
  layer yields. The signal is explicit and not inferred from a missing target:
  a blank figure on a proficiency that does print one is an import gap and stays
  `scene:notImported`, and an import that dropped a locator leaves the same empty
  `rolls` a throwless proficiency has. Only a token listed in `AUTOMATIC_SKILLS`,
  held by the member, with no figure read, is automatic. The structure ships (that
  this proficiency has no throw); no value does. The owner's "follow RAW" is the
  basis: the page asks one round of concentration and no throw, and the hasty
  check is a round. Rejected: leaving the option unassignable, which would make a
  proficiency the book prints permanently unusable on a check.
- **A blank skill figure names its page.** The refusal for a held skill with no
  figure carries the page the member's own ability cites, and the picker's
  tooltip prints it (`notImportedSkillTip`), as the search's own does (RR ch. 6).
  The proficiency's page ships in no string: the importer stamps it on the item.
  A hand-made ability has no stamp and the tooltip is empty.
- **Not built.** Per-rank and per-level steps in `materializeRolls` stay R-I1b
  (a second rank reads the first rank's figure); a Judges' card naming which of a
  proficiency's throws was rolled; a throw chooser on the rail. All are on the
  ROADMAP.
