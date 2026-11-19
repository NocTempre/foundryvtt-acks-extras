# Scene search — decisions

Dated: what was ruled, what was rejected, what it cost. The owner's words that
govern the feature are the entry "The owner's words, kept when the plan retires"
(2026-11-19).

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

## 2026-11-19 — The ways in: Search the scene replaces Stage a pot, Search here opens a session — SUPERSEDED IN PART 2026-11-19

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
  Judge who ended the scene by mistake can reopen a card's scene. *Superseded
  2026-11-19: the owner said yes, for a Judge.*
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
  drive the take-off. *Superseded 2026-11-19: the owner said when found.*
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
- **The owner's answers (relayed 2026-11-19).** The first printed throw is
  rolled; the chooser waits for a design. A holder whose item is off or reads no
  figure stays refused as not imported, with the page, under the standing
  "missing imports stay blank". The throwless reading of Sensing Power was put
  to "No house rules ship". It holds because RR ch. 3, Proficiencies, "Sensing
  Power", prints an activation by concentration and no throw (read against the
  reference snapshot before landing).

## 2026-11-19 — Harvest waits on the monster-import audit; a fallen body opens its own sheet

- **Ruled.** The owner, relayed 2026-11-19: "Defer, the MM imports already
  partially carry that data, and those need a full audit in general that I will
  dedicate a full pass to. Put in the entry point that looks at the monster's
  sheet for now as a cutoff point." S7b (harvest and identify) leaves this minor
  for the ROADMAP, and Treasure Tome's MM harvest work (H1–H4) is deferred with
  it.
- **The cutoff.** A fallen body gets a Judge-only control that opens the
  monster's own sheet, where the Judge reads whatever parts the import already
  carries. Nothing is harvested, timed or valued from the scene. The control is
  a new UI element, so it goes to `/design` before it is built; the boards'
  harvest row is not built.
- **Cost.** The scene search ships without a harvest path. The answers already
  settled for it (round up between printed steps; any of a dual-typed creature's
  rows qualifies a harvester, with a per-body override) stay in the plan for the
  pass that picks it up. Rejected: building harvest on the partial import, which
  the audit may reshape.

## 2026-11-19 — A Judge reopens a spent card's scene, and a good leaves its body when its lot is found

The owner answered the two questions the "ways in" entry left open. On whether a
Judge who ended a scene can reopen the card's scene: "Yes, for a Judge". On when
carried goods leave the bodies: "When found". This supersedes in part "The ways
in: Search the scene replaces Stage a pot, Search here opens a session" (its
"One card deals once" and "Goods leave the bodies when the scene opens"
bullets); the new evidence is the owner's two answers. The take-off's side is in
treasure DECISIONS, same date.

- **A spent card reopens for a Judge.** `planPress` answers `reopen` for a Judge
  and keeps `cardSpent` for any press that does not say it is a Judge's. Example:
  a Judge ends the scene by mistake, presses the card's Open the scene, and the
  same bodies, the same pot and the lots' found marks are on the screen, with no
  second deal. A player's press stays refused: `searchHere` is Judge-only, and a
  player's call answers `scene:notAllowed`.
- **The deal is guarded where the deal is.** `api.open` treats a record that is
  `opened` as a reopening whoever calls: no table is drawn, nothing is dealt, and
  the pot is reattached. Rejected: guarding in `ways-in.mjs` alone, which leaves
  the api able to deal a card twice. A deal the caller names with `sources` is the
  caller's own and still runs.
- **The card keeps what its opening made.** `markCardOpened` stamps `potUuid`,
  `placeUuid` and `lots` (`{key, thing, layer}`). Rejected: rebuilding the lots
  from the pot's truths, which carry a lot's key but not its layer, so the layer
  would be assumed. The stamp costs a few strings on a Judge-only card.
- **The place is the stamped one**, not wherever the party stands when the card
  is pressed again, since a reopened search is the fight's. A card stamped with
  no place falls back to the party's place, and one with no place at all is
  refused as before.
- **The pot is reattached, never rebuilt.** `end` only unsets the session flag, so
  the pot is still open with its cards and found marks. A pot the Judge closed is
  deleted, and the scene then reopens with its bodies, no lots and no pot; the
  Judge reads treasure's existing "That treasure pot is gone." and the screen's
  tray already says no pot was dealt. Nothing is dealt in its place, since a
  second roll would break "rolled by judge before interaction".
- **A body's found layers come back from the pot; nothing else does.** A layer
  whose every lot is in the pot and found reads as found again. A failed check's
  lock, and a state where no lot was dealt, were in the discarded session and are
  not recovered. Cost: a locked-out searcher may try a body again after a reopen.
- **A good leaves its body when its lot is found.** Example: two fallen creatures,
  one carrying a spoon and the other a ladle; the hasty check at the first finds its
  lots and the spoon's item is deleted from that body then, while the ladle stays
  on the second until its own check finds its lots (a body's lots are all on its
  hasty layer, so one found check turns all of that body's lots). Opening the pot takes nothing, `markSceneFound` hands the cards
  it just turned to treasure's take-off, and a lot found again, or a search
  reopened, takes nothing a second time. A body gone by then leaves the card
  standing on its snapshot, as before.
- **A good whose lot is never found stays on its body**, and a pot closed with an
  unfound lot loses nothing: the pot's own flows (turning, claiming, Quick grab,
  the close's filing and record) act on found lots only.
- **Cost: cards stamped before this change** carry no pot, place or lots; their
  reopening shows the bodies and no lots, with no notice since no pot was kept. No
  tool is written for them (the owner: no tools for previous-version data).
- **The fight-over card's carried-items tooltip follows the timing.**
  `ACKS-TREASURE.search.itemsTip` said the items leave the body when the scene
  opens; it now says each leaves when its lot is found, keeping its page
  reference. A string that states a timing the code no longer has is a defect,
  so the rewrite rides this change rather than waiting for a ruling.

## 2026-11-19 — An obstacle's crossing figures and picks are keyed in the rail's Crossing fieldset

Asked where the Judge's editor for a thing's crossing `params` goes (obstacle regions H4), the owner chose: "Keying rail (Recommended)". The fieldset sits in the opened rail of an obstacle thing, in both windows that draw the rail, and not inline on the Things here row. Formation DECISIONS, "Which crossing keys a place carries (obstacle regions H4)", left the editor unbuilt and pointed at figure inputs on the hazard group's row; this builds it in the rail, so that entry's "Cost" is now met and nothing in it is reversed.

**Ruled.** The owner ruled the placement only. The fieldset offers what the thing's hazard kind reads that a place may carry, through the seed's own readers: a climb obstacle its length and depth, a jump its gap and depth, a squeeze its shape and length, a swim its water-penalty pick and the larger figure. A blank field removes its key, so the crossing panel's default stands. A figure the crossing's reader refuses (zero, negative, text) removes the key, as the party sheet's own save does; a pick that is not listed is refused in words; leaving the larger pick removes the larger figure in the same write, so the stored `params` never hold more than the seed reads. Lib's `reviseThings` takes a `params` patch merged key by key, a `null` removing the key.

**Built beyond the board, kept by the owner** (relayed 2026-11-19: "Keep all (Recommended)"). Three points go beyond the approved board's text. The fieldset sits below the two checks and above Show and Remove; the board draws it after the as-built list, which stands for every existing field. The two selects lead with a *Not set* row, since without one an unset or stale pick could not be cleared and would read as None. The shape is a select and not the board's radio group: a rail control carries no `name` so it stays out of a form's submit (`lib/picks.mjs`), and unnamed radios do not group.

**Rejected.** Inline inputs on the row, the board's v13 alternative: the row is one button that opens the rail, so inputs on it would need the row split, and the swim's two controls crowd a sheet. Writing `params` whole through the place-things API: it would rewrite keys the editor never read.

**Cost.** The Crossing fieldset is the only window that writes `params`; `movement` and `judgeMod` stay on the crossing panel. A hazard Item dropped from a compendium resolves its kind by loading the document, so the rail draws one async read later than before (`railFor` is async).

## 2026-11-19 — The owner's words, kept when the plan retires

The phase plan (`wip/20261118-scene-search-plan.md`) is deleted now that every slice is landed and walked or moved to `ROADMAP.md`. The owner's words that set the feature's scope move here verbatim, from 2026-11-18 unless dated. How each was built is in `MODEL.md`, and each later ruling has its own entry above.

- "Spoils should be rolled into this too, with the bodies shown as cards to inspect to see if they find anything with the proper skills and tools"
- "It should be assigning people to search the area and the bodies, and based on the rolls they find stuff. This rewards having multiple people working together and honors proper time tracking. Check RAW if you need extra hints."
- "Scope is all three, part of the next minor."
- "Finding the loot is the hasty check of the room, just like a hasty body check will turn out the pockets/inventory carried gear. Some things might be explicitly hidden up to judge's discretion. There also might be a hint that something feels off (secrets yet to be found) following the GUMSHOE principle. This is becoming a whole scene tool and could incorporate things like inspecting statues/art. To clarify, there is an obvious layer (bodies, doors, lights), an obvious with inspection layer (hasty search, pockets, chests, history, theology check, secrets present incl traps), found with methodical search and/or appropriate skill (spoils, secret doors, hidden keys, trap defeats). Everything beyond that is narrative in GM responsibility. Survey RAW and the adventures for examples. I like this tool as an end combat screen."
- "It could also be used in general when the party declares searching even without combat... add integration on party sheet?"
- "Seeing there is a fresco is obvious and would show up as a card to assign someone to, inspecting for subject is hasty, learning a secret/clue from it is methodical, as an example"
- On the obstacle redesign, which shares the carrier: "Conditions are present when added, most easily by dragging. This is akin to a natural trap. Not doing a big switchboard of possibilities.", "Traps, obstacles, conditions can stack arbitrarily." and "This is some variation of location."
- The answers to the design questions on canvas v15 (https://claude.ai/artifact/MWGwR5rfqxhhgmzrjvytnR):
  1. "rolled by judge before interaction, visible as found"
  2. "B" (a hasty check resolves at once, on a Round press)
  3. "missing skill just gets the vague hint there might be something more at hasty search, follow RAW"
  4. "B - GUMSHOE principal, it is meta-public knowledge if more clues remain unless it is hidden behind an unsolved (still something off) clue"
  5. "Unclear question". Built on the drawn default: the Judge may write an optional line, and otherwise the table sees the generic words.
  6. "No picked clean state, only checked hastily and checked methodically for each inspectable, and a found X or did not find X (and a hint if Y is known to be there but unknown what, e.g. a seen trap with a hidden disarm)"
  7. "A" (open loot takes the hasty search throw as printed)
  8. "B" (the imported search reach applies to positions)
  9. "B, there is no "stage a pot" as a thing"
- Where the things live: "Everything to a place that can apply effects to a region. All to region if easiest".
- The go-ahead: "Get this implemented".
- Standing rules: "Standing rule for repo no generated art." and "No house rules ship".

**Cost.** The plan's per-slice Results go with it. Each slice's walk is recorded in `TESTING.md` and in its commit, and its rulings in the entries above. What was registered and not built is in `ROADMAP.md`, including the harvest answers that "Harvest waits on the monster-import audit" left "in the plan": the owner's "Round up" and "Any of its rows", now on the ROADMAP's harvest row.
