# Treasure: the treasure table (wip plan)

**Status:** plan, written 2026-11-16. Built on `topic/treasure` (worktree
`foundryvtt-acks-extras.treasure`, opened with `acks-branch open treasure`);
each slice is landed with `branch.mjs land treasure` and walked on `main`.
Results are appended under "Results". This file is deleted when the last
slice has moved its substance into `docs/treasure/{MODEL,DECISIONS,ROADMAP,TESTING}.md`.

The owner, 2026-11-16: "I want new window for treasure rolling, to make it
feel more like a casino for players when they defeat a group or find a stash.
It could let the gm or players roll (including hiding what is magical unless
they detect, and hiding effect unless they identify). Need a way for fixed
items to be quickly added to a roll discretely to seed plot items with a
toggle for if they add or replace some of the rolled treasure value."

## Standing work this plan touches

- `docs/importer/wip/20261116-tt-importer-plan.md` (`topic/tt-importer`):
  its S1 imports the treasure-type, gem, jewelry and special-treasure tables
  this feature deals from; its S4 is the magic-item chain walker; its **S5
  (the hoard generator) moves into this plan as T4 and T5**, answering its
  owner question D with "a new feature". That session rewrites its own S5 row;
  this plan never edits its file.
- Magic DECISIONS "Three features, one vocabulary" stands: `magic-items`
  generates magic items. `treasure` calls it through a lib `services`
  contract, `magic-item-roll`, shaped like `morale-roll` (`docs/lib/API.md`).
  Without a provider a magic card shows the table entry's text alone.

## Design

**Superseded in part 2026-11-17** by "Revised design" below, which replaces the
pot's storage, the doorway, seeding and distribution. The new evidence is the
owner's review of the mockup. What still stands from this section: the home,
the hiding rules, the replace rule's pools and lots, and the IP paragraph.

**Home.** `scripts/treasure/`, `docs/treasure/`, lang root `ACKS-TREASURE`,
CSS `acks-extras-treasure-*`, namespace `acksExtras.treasure`.

**The pot is a ChatMessage the Judge's client creates.**
`flags["acks-extras"].treasure` holds the phase (`staging` → `open` →
`closed`), the audience, who may flip, and one row per card: `{id, pool,
ref | coin{key,count} | valueGp, faceUp, detected, mask{name,img},
claimedBy, seed?}`. The author and GMs write it. Every seat sees the chat
card, which opens the window. A player's flip or claim reaches the
Judge's client through `executeAsGM` (`lib/sockets.mjs`). The handler checks
the attested sender, the phase, ownership, and an in-flight key it claims
before its first await, which is the crossing's relay
(`formation/player-requests.mjs`). No item document exists until a claim
makes one.

**The window** is an ApplicationV2 whose part root scrolls
(`scrollable: [""]`), since it re-renders on every flip. Cards are
`<button>`s with an `aria-label`. A flip is a CSS rotation played when a
card's `faceUp` changes between renders, and a plain swap under
`prefers-reduced-motion`. Coin counts tick up. The haul total's tooltip
lists its parts.

**Rolling.** The Judge deals: rolls are evaluated in code against the
imported tables (`lib/tables.mjs`), and a Judge-only audit card cites each
roll (`citeOf`). The table flips cards. Who rolls the hoard's own dice is
owner question A.

**Hiding is display-level.** Every seat can read the message and the item
behind a card (Foundry gates no read; `equipment/actions.mjs` `disguiseItem`
says the disguise is not a security boundary). The rest of this section is
what each screen shows:

- `detected: false`, a new optional key on the markets flag, is written only
  by a deal. When it is absent the item counts as known, so bought and
  hand-made items behave as they do today. A fourth `ID_STATES` step is
  rejected: `DEPTH_ORDER`, `KNOW_STEPS` and `magic-panel` all assume three.
- Detection is a Judge's mark: JJ ch. 4 "Identifying Magic Items" prints no
  detection throw. A ROADMAP row covers a later link to the spell work's
  detection results.
- One reader, `magicKnowledge(item)` in `lib/item-model.mjs`, sits beside
  `isMagical`. It gates the item sheet's identify button, its effects
  note and its aura, which today show a player that an item at
  `identified: none` is magical. On a player's sheet the slot-use label
  counts only known magic; enforcement still counts the truth.
- A claim creates the item already masked, through a `disguiseData(data,
  apparent)` split out of `disguiseItem`. A listener on the markets
  `IDENTIFIED` hook lifts the name after a recognizing method, and a `full`
  identification calls `revealItem`.

**Seeding.** The Judge drops items onto the pot during staging. During the open
phase a drop draws a warning instead (players get blocks, judges get
warnings). A seeded card takes a random position and id and posts no card. Each one carries a
toggle:

- **adds**: the item joins the haul.
- **replaces**: the item's value comes out of the same pool. A magic seed
  takes from the magic cards; any other seed takes from coins, gems, jewelry
  and special treasures, because a treasure type prints the two as separate
  averages and only treasure earns XP (JJ ch. 4). The unit removed is the
  lot (JJ ch. 4 "Special Treasures"), whose coin size is imported. During
  staging the Judge sees what is removed, struck through and editable. Any
  overshoot is shown. A seed worth more than its pool draws a warning and
  takes the whole pool.
- The seed's value is the disguise's true cost, else `system.cost`. A magic
  item uses `magicBasisOf` (`markets/rules/goods.mjs`). The value is
  multiplied by `stackCountOf` and the Judge can override it.
- On a player's seat every card's tooltip names its pool's page only, so a
  seed cannot be told from a rolled card. This departs from
  `ui-tooltips.md` and needs a treasure DECISIONS entry.

**Distribution.**

- A card goes to an actor the claiming seat owns. A Judge may give it to any
  actor, with a warning.
- Items arrive through `deliverItems` (`lib/bundles.mjs`). Coin arrives by
  name through a `creditCoin` built on `coinTemplate`, since `mintCredits`
  knows only 100/10/1.
- Party members come from the `party-roster` contract.
- "Divide by shares" extends `formation/xp-shares.mjs` `shareFor` with the
  imported treasure share.
- Leftovers go to a place through `lib/storage.mjs`.

Out of scope: the XP award (a ROADMAP row), selling, identifying inside the
pot, carry limits, and encounter-group row N.

**IP.** No table, band edge, coin-lot size, gem value or rule sentence ships.
All of it is imported. Tests use invented rows. With nothing imported, the
letter source is disabled and cites its page; the manual and seed sources
still work.

## Revised design (2026-11-17)

The owner, after reviewing the mockup
(<https://claude.ai/artifact/LRUmx4L6RjUvXkZv4zz7ik>): "Use the actual card
item type built into foundry if going this direction. It should show up as
part of a search after a battle. Definitely should use icons on the backs
before flipping and color for value bands (with card face color for special
status like magic and curse once identified). It should be an inventory stash
players can click a button or drag and drop pick up items to their own. Quick
grab should calculate the distribution that leaves the party moving as fast as
they can." And: "Don't forget the general rules of every window needs to be
resizable and scrollable. The Seed a plot gets replaces with two inventory
buckets beneath the pot before it's rolled, add and replace. Replace the right
for clicking toggles like no magic or force cursed etc." Owner question A is
answered: "Judge chooses per pot".

An architect read core 14.370's `common/documents/card.mjs` and the client
`cards.mjs`/`card.mjs` for this revision. Each claim below names its source.

**The pot is one core `pile` Cards document.**
- **The pile's flag.** `flags["acks-extras"].treasure` holds `{phase, mode,
  flippers, partyId, origin, deal: {toggles}, order: [cardIds]}`.
  - `order` is the authority, written by the GM. Core lets any user create a
    Card in a pile, so a Card that is not in `order` is ignored by the window
    and the relay.
- **A Card's fields.** Each Card's `suit` is the pool a seat is shown and its
  `value` is the band. Its `back` holds the pool's label and an icon from
  Foundry's image library.
  - Its truth sits in `flags["acks-extras"].card`: `{source: {uuid, data},
    coin | valueGp, weight6, mask, bucket?}`.
  - `data` is a snapshot taken at the deal, because a searched body may be gone
    before anyone claims.
  - A flip writes `faces: [apparent], face: 0` in one update, so no core sheet
    shows a face early. This is display-level only.
- **Ownership.** The pile is GM-only through staging. At open its audience gets
  LIMITED, never OWNER: an owner could pass or delete cards without going
  through the relay. Every player action goes through the GM relay (attested
  sender, in-flight key, one request at a time per pot).
- **The window.** Our `PotSheet` (DocumentSheetV2) is registered for `pile` with
  `makeDefault: false` and chosen per pot by `flags.core.sheetClass`. A chat
  card stays as the doorway and carries only the pot's uuid.
- **Claims and closing.** A claim builds an Item from the snapshot through
  `disguiseData`, then `deliverItems` or `creditCoin`. The Card is marked
  claimed. Closing:
  - sends leftovers to a place (`lib/storage.mjs`);
  - rewrites the chat card as the record of the haul;
  - deletes the pile by its own id with `{chatNotification: false}`.
- **Rejected:** hands (a claim lands in an actor's inventory, so no hand is
  needed), a Cards sub-type (it needs a world relaunch), and a plain
  ApplicationV2 (it loses core's re-render on card changes).

**Search the fallen.**
- Nothing like it exists today: formation's searches are wilderness hours and
  throws for hidden features.
- Treasure adds its own `deleteCombat` hook, run by the primary GM. For each
  defeated hostile combatant it records the actor uuid, carried goods, the
  treasure letter and core's linked RollTable.
- The Judges then get a "Search the fallen" card that stages a pot from that
  record:
  - The linked RollTable is drawn with `displayChat: false`.
  - The letter goes through T4, behind T5's lair warning.
  - Carried goods are moved, not copied: opening the pot takes them off the
    bodies that remain.
- Procedure is cited only by reference: JJ ch. 4 and RR's "Adventures" chapter.

**Backs, bands, faces.**
- **Bands** rank within the pot over apparent worth: coin count × rate, else
  the mask's cost, else `system.cost`. Band = floor(4 × the number of strictly
  lower values / n). Four is a design constant, not a printed one.
  - Ties share a band, and bands freeze at open.
  - An undetected magic item takes its mask's band.
  - The band is also in the card's aria-label and shown as pips, so colour is
    never the only cue.
  - Rejected: gp thresholds set by the Judge, and bands from imported tables.
- **Face colours.** A magic item's face turns magic once identification is past
  `none`; detection changes only the back's icon. A cursed item's face turns
  cursed once the curse is known.
- **Cursed** is stored nowhere today. Add markets keys `cursed` and
  `curseKnown`, written by the Judge's toggle in the magic panel. A full
  identification sets `curseKnown`.

**Seed buckets** are Cards in the same pile, marked `bucket: "add" |
"replace"` and kept out of `order` until the deal. A seed is then already a
card, and only one document needs cleaning up. Rejected: separate piles,
because `pass` posts to chat.

**Deal toggles** are stored on the pile's `deal` and recorded in the Judge's
audit card. "No magic" skips the magic terms of the type row; "force cursed"
sets `cursed` on every magic card's snapshot. They are Judge controls, not
house rules, because each edits this pot's result the way striking cards
would. Rejected as house rules: coin multipliers, scaling by party level, a
chance of curse.

**The stash.**
- A Card drags as `{type: "Card", uuid}`. A treasure `dropActorSheetData` hook
  takes a Card in `order`, returns false synchronously, and sends the relay's
  claim.
- That reaches the system's sheets and extras' character sheet. Sheets that
  override `_onDrop` (vehicle, item, party, unit) are ROADMAP rows.
- Take picks among the actors the seat owns. The window also has a drop zone
  for each party member.

**Quick grab** is the pure `scripts/treasure/grab-logic.mjs`
`planGrab({members, lots, paceWith})`.
- **Pace** comes from a new optional member of the `party-roster` contract
  (v3), `pace(partyId, actorId, {adding6})`. Formation provides it from its
  existing carrier-speed code, so core's encumbrance thresholds never enter
  treasure.
- **Capacity.** Each member is capped by `capacity6`. A member with no stated
  capacity, a casualty, or one with no document takes nothing.
- **The algorithm:**
  1. Try party paces from fastest down.
  2. At each pace, place whole lots heaviest first by best fit, then pour coin
     in by whole coins, splitting a coin card where needed.
  3. The first pace that places everything wins. It is re-packed worst-fit to
     even the loads, if that still fits.
  4. Whatever fits nobody stays in the stash with a note.
  5. For 12 lots or fewer, an exact search replaces best fit.
- **The relay** plans again on the GM's client and never trusts a plan sent in
  the payload.

**Every window** joins `ui-layout.md`: PotSheet's part root scrolls, the
module class gives it the drag corner, the grid reflows, and the toggle panel
drops below the pot when the window is narrow. Every dialog names its classes.
Under ui-layout's "Design before build", the mockup above is the design, and
R1 waits for the owner's go-ahead on it.

## Slices

All slices are built on `topic/treasure` and walked on `main` by the session
itself. The `live-tester` agent re-delegates instead of testing. T2 and the T4
engine are built on the branch (`30ae25be`, `10a5c02f`); the draft of the old
T1 was never committed.

| # | Scope | Agent, and why | Waits on | Offline gate | Live walk |
| --- | --- | --- | --- | --- | --- |
| R0 | The owner's go-ahead on the mockup | this planning session | owner | | |
| R1 | Cards pot, PotSheet, doorway, relay, snapshot, close, buckets, `docs/treasure/TESTING.md` | `implementer`: the design is fixed above | R0 | pure rules and relay guards | GM and Player seats: flip, claim; a planted Card is ignored; close posts nothing |
| R2 | Bands, icons, face colours, deal toggles | `implementer` | R1 | bands with ties and tiny pots; an undetected card's back matches a plain card's | yes |
| R3 | `cursed` / `curseKnown` and the panel toggle | `implementer` | T2 on `main` | mutation-checked suite | the curse shows only after full identification |
| R4 | Drag-and-drop and Take | `implementer` | R1 | | drops on the system sheet and extras' sheet; an unowned target is refused |
| R5 | Quick grab and roster v3 `pace` | `implementer`; message the dungeon-closeout session first (formation owns the pace) | R1 | invented step functions, mutation-checked | predicted pace equals the sheet's pace after delivery |
| R6 | Search the fallen | `implementer` | R1 | | a real fight ends; the record survives the bodies' removal |
| ~~T1~~ | Replaced by R1 to R6 | | | | |
| T2 | `detected`, `magicKnowledge`, sheet gating, `disguiseData`, the `IDENTIFIED` listener | `implementer` | nothing | `test-item-sheet` with a mutation check | Player sheet shows no identify button or aura on an undetected item; recognizing lifts the name |
| T3 | Seeding and the replace planner | `implementer` | answer B | invented rows | A seeded card cannot be told apart on the Player seat |
| T4 | `hoard-logic.mjs`: cell grammar, nouns matched against imported kind names, sub-rolls; an adapter over the tables | `implementer`: the engine now on invented rows, the adapter after tt-importer S1 lands | S1 | asserts the die's size | Real JJ import, deal from a letter |
| T5 | Entry points: the monster statblock's letter, selected tokens grouped by monster, a lair-only warning (`lairOf`) | `implementer` | T4 | | yes |
| T6 | Magic cards through `magic-item-roll` | `implementer` | tt-importer S4 (documents after S6) | | yes |
| T6b | Built on `main` (2026-11-18): the marker is the clause's word order, read by `parseCell` (noun-first), so the import itself is unchanged and no cookbook recompiles. The plan row as ruled: the treasure importer marks the generic magic cell structurally. Its shape: in the classic type table's magic column, a one-word noun that names no category list, standing for a roll on the type list that picks the category. Today it is refused as `no-match` (33 of 55 classic placeholders in the 2026-11-18 census). The importer emits a marker on that cell, and `startFor` begins such a placeholder at `classicType.bands`. The orchestrator ruled 2026-11-18: before the minor, early in the serial queue, so the full roller ships in the minor. No word ships | whoever owns the treasure recipes in `scripts/importer/` at the time | T6 on `main` | invented cell with the marker; a marker-less cell stays refused | step 8 census: classic `no-match` falls to 0 for that shape |
| T6c | The sword, weapon and armor finds rank at their masterwork worth. Those lists link no document, so a rolled one is a named placeholder with no figure. Needs a link from the rolled row to its base item (the import's weapon or armor entry) and the imported masterwork tier cost (equipment `MASTERWORK` variation documents), summed as the book's apparent-value rule for those lists prints (JJ ch.4); with either missing, it stays at nothing. Owner ruling 2026-11-18 (DECISIONS) | `architect` first: the row-to-base link crosses the magic-items import and equipment | T6 on `main` | invented rows: a linked base plus a tier cost ranks at their sum; a missing half ranks at nothing | step 8: a rolled sword-list find's band reflects its base |
| T7 | Moved: the scene screen is its own feature, `scene-search` (docs/scene-search/, `topic/scene-search`), which hosts the pot; see "Progress after handover", 2026-11-18 | architect, then `implementer` | the architect's plan; owner approval of its design | | yes |

The revision changes the T rows above:
- T3 becomes the replace planner over the buckets; a random position is a
  `shuffle({chatNotification: false})`.
- T4's adapter emits R1's card specs and gains the skip option "No magic"
  needs.
- T5 shares R6's builder.
- T6 fills in `mask.cost`.
- The "Out of scope: carry limits" line in "Design" no longer holds.

### Requests to the tt-importer session (its S1 is in flight)

- Read the coin columns' "1000s" unit, which sits in a header nothing reads
  today.
- Read the rows that give each gem and jewelry kind its dice.
- Read the special-treasure lot unit, which follows "Special Treasure per" in
  each caption.
- Keep the `typeClassic` / `typeHeroic` shape stable, or announce a change.

## Owner questions

Defaults the phase session proceeds on if they are unanswered:

- **D. What does Quick grab take?** Default: everything, at the fastest pace
  that carries it. Counter (moderate): taking only what costs no speed keeps
  the pace but leaves loot behind; unticking cards before a grab covers part of
  that.
- **E. Card flip motion.** Default: "swap", a colour change within the ACKS II
  system's colour-only motion rule. Counter (moderate): the owner asked for a
  casino feel, and only a card that turns over reads as one; that departs from
  the system in this window alone.
- **A. Who rolls the hoard's dice?** ANSWERED 2026-11-16: "Judge chooses per
  pot". The text below is the design it adopted.
  **Judge deals**: rolled quietly, and the table flips cards.
  **Table rolls**: a player's click fires the dice through the relay, seeds
  having been staged beforehand, and a replacing seed then takes its lots by
  rule B's auto-pick. Counter (strong): two modes double the walk, and in the
  "table rolls" mode the Judge cannot review the replacement before players
  see it.
- **B. Which lots does a replacing seed take?** Default: the fewest lots that
  cover the value, pre-ticked; in "Judge deals" mode the Judge can change the
  ticks. Counter (moderate): taking the exact amount from coin, in proportion
  across denominations, keeps the total within a coin, while a whole lot can
  overshoot by a gem's worth.
- **C. A new `treasure` feature.** Default: yes. Counter (moderate): it adds a
  fourth root beside the magic features, and "Three features" places
  generation in `magic-items`. Coupling through `magic-item-roll` keeps that
  ruling.

## Start prompt for the phase session

> Continue the treasure table, `docs/treasure/wip/20261116-treasure-table-plan.md`,
> on `topic/treasure`. Read "Revised design (2026-11-17)" first; it replaces
> the old T1. Land and walk T2. Once R0 (the owner's go-ahead on the mockup) is
> recorded here, build R1 with a fresh `implementer`, quoting the owner's words
> from "Revised design" in its brief. Then build R2 to R6 and T3 to T6 by their
> "Waits on" column. Message the dungeon-closeout session before R5 touches the
> party-roster contract. Proceed on the owner-question defaults unless they
> have been answered. Append results here and correct this prompt for the next
> phase.

## Results

(Appended by each slice.)

## Handover (2026-11-17)

The phase session "Treasure table phase 1" stops here and hands the plan to a
successor in the orchestrator's family. This file stays the hand-over.

### Slices

| Slice | State | Commits |
| --- | --- | --- |
| R0 | Owner: "Approved for development" | |
| T2, T2 follow-ups | Landed on `main`, walked | f8a61673, 6acff028, 7e93e64e (walk) |
| R1 | Landed on `main`, walked | e7efe5eb, e9c06d37 (walk), 30afa306 and bce8457d (walk fixes) |
| R3 | Landed on `main`; walked only through R2's force-cursed Take | 46932c12 |
| R2 | Landed on `main`, walked | 37a21e9d |
| R6 | Landed on `main`, walked | 86559252 |
| R5 core | Landed on `main` | 7257a0c1 |
| R4 + R5 wiring | Landed on `main`, walked with one finding (below) | 653bb8ee |
| R2, R4/R5, R6 walks | On `main` | the commit that adds this section |
| T4 engine | Landed on `main` | f281ed1c |
| T4 adapter, T3, 11a warning, T5 logic, T5 slices A and B | Landed on `main`; walked on lane C (below, 2026-11-18) | 92ce7364 |
| T6 | Landed on `main`; step 8 walk-found fix on `main` (below, 2026-11-18) | 2f8c27cd, 424bbeaf |

The topic stays open for T6; `sync` it before each slice, and land in the
orchestrator's order.

### Walks (lane C, FIXTURE_OWN=treasure, partial by design)

- `markets-undetected`: 72 pass, 0 fail.
- `treasure`: 77 pass, 0 fail after the relaunch.
- `treasure-search`: 31 pass, 0 fail (a real fight; the tracker's End Combat
  fires the real `deleteCombat`).
- `treasure-faces`: 37 pass, 0 fail.
- `treasure-party`: 25 pass, 1 fail. **Finding:** the Quick grab button is
  never the element under its own centre after scrolling, at any width, so a
  real pointer press never reaches it (step 7, and both presses in step 5 fell
  back to a scripted click). Not diagnosed: one `elementFromPoint` probe on the
  button's centre is the next step.
- **Unproven, watch it:** one `treasure-search` run of three delivered another
  body's item from a deleted body's card, the signature of `carriedMap`
  pairing card ids with bodies by position when `addTruths` returns ids in
  another order. The walk now pins each card to its body; the two runs since
  passed.
- Walk-side flakes the walks now absorb: the Player seat's doorway card can
  arrive late; the doorway's Open the table sometimes opened no window on the
  first press. Diagnosed 2026-11-18: the press was located on the chat
  notification's copy of the card while it slid in, so the click landed beside
  it and no click reached any doorway button. Not a code issue; the walks wait
  for the card to stop moving before pressing.
- Not walked: search step 4 (a linked RollTable), party step 6 (the Judge's
  grab with a nearly full ally and a down member), a drag onto a sheet the
  seat cannot open, reduced motion, a Tab walk through the cards.

Run them with the scratch launcher pattern in `TEST_ENVIRONMENT.md` "Seat
lanes": lane C is Gamemaster 3 / Player 3 on 9487/9488.

### Fixtures kept (markers, `@treasure` own-tag)

`treasure/player-character`, `judge-character`, `ally`, `coin`,
`item-masked`, `place`, `item-plain`, `item-masked-cheap`, `item-detected`,
`item-identified`, `item-identified-unknown`, `item-expensive`, `weight-a`,
`weight-b`, `weight-huge`, `weight-down`, `search-scene`, `search-hostile`,
`search-hostile-2`, `search-friend`, `undetected-holder`, `undetected-item`,
`known-magic-item`, `mundane-item`, `identifier-engineering`,
`identifier-lore`, `identifier-research`. The party formation "QA Treasure
Party" is a formation record with no marker: found by name, never deleted by
name. Recipe gaps the walks found (fixtures the recipes do not list yet):
`item-identified-unknown`, the four `weight-*`, and the search walk making its
tokens and combat per run.

### Owner questions

Each question gives its options, what is built now, a recommendation, and the
strongest counter-argument with how strong it is. Answer with the option
letters, e.g. "1c, 2a, 3b".

**Answered 2026-11-17.** The owner: "Take recommendations". So 1c, 2b (the
picker after the minor; it needs `/design`), 3b, 4a, 5a, 6a (fully identified
cards only), 7a, 8a, 11a-a plus the Judge warning, and 11b-a. Where each
lands: 1c, 3b and 6a on `main`, since R4 and R5 ship in the minor; the 11a
Judge warning on `topic/treasure`; 8a in the tt-importer track. 4a, 5a, 7a
and 11b-a are what is built.

1. **Who may press Quick grab?**
   (a) Any seat that may Take. This is built: a player's press places goods on
   members that player does not own.
   (b) The Judge only.
   (c) A seat that owns at least one member of the pot's party.
   Recommended: (c). An observer or a player outside the party loses the
   button, and the party's own players still share out one load.
   Counter (moderate): (c) still lets one player load another player's
   character. Only (b) stops that, and it costs the Judge a click on every pot.
2. **What does the pot do in a world with two or more parties?**
   (a) Nothing more. This is built: the pot has no party, so the aside and
   Quick grab stay hidden until a picker exists (ROADMAP row).
   (b) A party picker on the staging rail, built next. It needs `/design`.
   (c) It takes the party whose members own the most tokens on the scene, with
   no control.
   Recommended: (b), after the minor.
   Counter (moderate): most tables run one party. (a) costs nothing until a
   world hits the case, and (c) needs no design.
3. **What does a value card weigh in a grab?**
   (a) Its own `weight6`. This is built.
   (b) The coin it is delivered as.
   Recommended: (b). The member carries the coin after delivery, so a pace
   worked out on the card's own weight is wrong as soon as the grab lands.
   Counter (moderate): a coin's weight is a printed value that arrives by
   import. With nothing imported, (b) has no weight to use and must fall back
   to (a) anyway.
4. **May a Judge un-detect an identified item?**
   (a) Yes. This is built: the control steps back as well as forward.
   (b) No. Identification only moves forward, and a Judge who needs to undo it
   edits the item.
   Recommended: (a). It is how a Judge undoes a misclick.
   Counter (weak): chat cards already posted keep what players saw, so after an
   un-detect the pot and the chat disagree.
5. **Does "No magic" strike Judge-seeded cards?**
   (a) Yes. This is built: the toggle means no magic in the pot at all, and a
   by-hand pot has no roll to skip.
   (b) No. It filters what the table rolls, and a seed is the Judge's explicit
   choice. A seed added while the toggle is on raises a warning to the Judge.
   Recommended: (a). The toggle does what its name says, and the Judge's
   whisper names every card it struck.
   Counter (moderate): a Judge who seeds a magic item on purpose into a "No
   magic" pot loses it at open. The whisper reports the loss only after the
   fact.
6. **Does "Force cursed" set `curseKnown` on an item already fully
   identified?**
   (a) Yes. A fully identified card shows everything, so a curse forced on it
   shows too.
   (b) No. This is built: the toggle sets `markets.cursed` and never
   `curseKnown`, so the curse stays hidden until the Judge ticks it.
   Recommended: (a), for fully identified cards only. Under (b), a card marked
   "full" hides part of itself, which contradicts its own state.
   Counter (moderate): a Judge forcing a curse late may want it to catch the
   party unaware. (b) allows that, and a hand tick reveals it later.
7. **What is the default for special treasure (T4)?**
   (a) Off unless the Judge ticks it. This is built.
   (b) On.
   (c) The Judge's last choice, remembered per world.
   Recommended: (a). A deal does exactly what the rail shows.
   Counter (moderate): under (a), a Judge who wants specials in every deal
   ticks the toggle on every pot. (c) saves those clicks.
8. **Does the tt-importer name each dice-legend row's special list?**
   (a) Yes. The importer tags each row with its list key and marks the "leave
   the lot" row, and T4 drops its pairing by order and wording.
   (b) No. T4 keeps pairing by position, which works on today's import.
   Recommended: (a), in the tt-importer track.
   Counter (moderate): it adds a cookbook recompile and a stamp refresh to a
   track that is already in flight (S6), for a pairing that works today. A
   later printing that reorders the rows breaks only (b), though.
11. **Two T3 behaviours**, answered separately as 11a and 11b.
   11a. **A replacing seed that the free lots cannot cover:**
   (a) takes no lots. This is built.
   (b) takes every free lot.
   (c) is refused, with a warning to the Judge.
   Recommended: (a) plus the Judge warning from (c). The seed still lands, and
   the Judge learns that the pot is worth more than the table rolled.
   Counter (moderate): (b) keeps the pot's total close to the roll. (a)
   inflates it by the seed's whole worth.
   11b. **Where a seed sits in the pot:**
   (a) in its first struck lot's slot. This is built.
   (b) at a drawn position.
   Recommended: (a). The face-down order then still says nothing about which
   lots were rolled.
   Counter (weak): a player watching the pot fill can see the seed land where
   a lot was. (b) hides that, at the cost of a draw the replay cannot pin
   without the injected RNG.

9 and 10 are answered by the `/design` artifact https://claude.ai/artifact/MWGwR5rfqxhhgmzrjvytnR (deal a letter, T5's entry points and lair warning, T3's replace ticks), which waits on the owner's feedback.

**The owner's feedback on that board, 2026-11-17:** "What happened to the card design?", then "These setting should merge with that tool.", then "Ask an advisor to add some extra design flair. Again the repo had a style guide somewhere plus you can use imported art from the books." The four boards drew the deal controls as a separate plain form, away from the approved card table (https://claude.ai/artifact/LRUmx4L6RjUvXkZv4zz7ik and "Revised design"). The revision puts the settings (source, treasure type, worth, table style, special treasure, Deal) inside the card window, as the Judge's staging state of the same stash, with the cards visible: dealt face down, replace ticks on the cards themselves, and the lair warning and the monster-sheet and selected-token entries opening into that window. It draws on the vendored design system's ornaments, glyphs and textures (`vendor/acks-design/`), and gives the cards art slots that fill from the world's imported book images and fall back to a glyph; the module ships no book art. An architect takes the visual pass first. T5 waits on the owner's go for the revision.

**"Met in their lair" is the Judge's toggle, 2026-11-17.** The owner: "These are GM tools, there doesn't need to be a logic, just an input toggle". Nothing infers whether monsters were met in their lair. The Judge's staging state carries a "Met in their lair" toggle, and the lair warning keys off it alone: a letter dealt with it off raises the warning (Cancel, Deal anyway). Core's monster data holds only `treasure.{type, table}`, so no sheet field marks anything carried, and "Carried only" drops.

The plan's T3 line ("a random position is a `shuffle(...)`") no longer matches: placement uses the injected-rng `placeAdds`.

Also outside these slices: trade chat lines say "Apparent value" (not fixed). The price-ledger leak, the slot badge against the full mark and the stale `origin` row are fixed ("Progress after handover").
`acks-extras-treasure-search__*` classes are unstyled. The staging screenshots,
guide step and gallery row are stale. The magic colour is a literal oklch, for
want of a blue token.

### Start prompt for the successor

> Continue the treasure table, `docs/treasure/wip/20261116-treasure-table-plan.md`,
> from its "Handover (2026-11-17)" section. The work is on `topic/treasure`
> (worktree `C:\Proj\foundryvtt-acks-extras.treasure`); do not land until the
> orchestrator says the minor is tagged, then land with `branch.mjs land
> treasure` and walk on `main`. First diagnose the Quick grab press finding
> (one `elementFromPoint` probe) and fix it on `main` as a walk finding. Then,
> on the topic: T6 once tt-importer S6 lands. T5 and the
> deal-a-letter control start with `/design` and the owner's approval. Walk on
> lane C with `FIXTURE_OWN=treasure`. Build slices with fresh `implementer`
> agents and quote the owner's words from "Revised design" in each brief.

### Progress after handover

- 2026-11-17: step 1 started (the Quick grab press finding: an elementFromPoint probe, then a fix on main).
- 2026-11-17: step 2 started (a fresh implementer on the price-ledger leak, the slot badge against the full mark and the MODEL origin row).
- 2026-11-17: step 3 done: /design artifact https://claude.ai/artifact/MWGwR5rfqxhhgmzrjvytnR with four boards (deal a letter, monster sheet and selected tokens, lair warning, replace ticks). Nothing built.
- 2026-11-17: step 1 done: the cover was a member's character sheet the walk opened in step 4 (z 103 over the pot's 102), so no product defect; the walk fronts the pot as the user's corner drag does, and locate names a cover's window. treasure-party on lane C: 26 pass, 0 fail.
- 2026-11-17: step 2 walked: markets-undetected on lane C 74 pass, 0 fail (the player's ledger one line at the apparent 40, the Judge's at the true 250; the place full for the GM and not the player); landing through acks-commit.
- 2026-11-17: step 4 started (owner questions 1 to 8 and 11 rewritten as answerable questions).
- 2026-11-17: step 4 done: questions 1 to 8 and 11 under "Owner questions" above carry options, what is built, a recommendation and the strongest counter with its strength; 9 and 10 point at the design artifact.
- 2026-11-17: the owner answered the questions ("Take recommendations", recorded under "Owner questions"). On `main`: 1c (Quick grab for the Judge and for a seat that owns a member; the window hides the button from any other seat), 3b (a value card weighs the coin `mintCoin` delivers, lib `mintedWeights6`, else its own weight) and 6a (Force cursed marks the curse known on a card identified in full). Walked on lane C with FIXTURE_OWN: treasure-party 28 pass, 0 fail (step 4b: a seat owning no member sees no button and its scripted grab answers `notAllowed`); treasure-faces 39 pass, 0 fail (the full card's snapshot and landed item carry `curseKnown`). 3b's weighing is checked offline only: no walked pot holds a value card. Findings: a value card's tile still shows its own weight while the grab plans the coin's, and a 0 gp value card plans at no weight.
- 2026-11-17: the slice above landed on `main` as 8b4c9867. On `topic/treasure`, committed and not landed (landing order after the minor: importer-books, then treasure): the 11a Judge warning (a175a3c5; a notification on the opening Judge's client naming the uncovered seeds and their summed worth), the cookbook stamp alone (3250b7e0), and T4 (76f445f7), which pairs legend rows by the importer's `list` and keeps the bands marked `keep` (Treasure Tome built 8a on `topic/importer-books`, landing after the minor), falling back to position and to the `1 <kind>` wording where the import has no marks. The brilliant list's leave-the-lot band also offers breaking the stone into the lower kind: `keep` applies to it unchanged, so the deal leaves the brilliant as it was and breaking it stays the table's choice after the deal. Counter (moderate): the deal never offers the break, so a table that wants it splits the card by hand.
- 2026-11-18: T5 logic committed on `topic/treasure` as b33640fa. `lairOf` is superseded by the owner's toggle ruling: "These are GM tools, there doesn't need to be a logic, just an input toggle". Selected tokens deal one hoard per kind of monster.
- 2026-11-18: the canvas was revised to v7 (https://claude.ai/artifact/MWGwR5rfqxhhgmzrjvytnR). It puts the deal settings inside the card window, adds the Stash, MonsterSheet and TileStates boards, and folds in LairWarning and ReplaceTicks. The owner approved: "TT deal controls look fine. I expected some of the treasure pictures as card backs when imported, but that doesn't need a new review. It should evoke the feeling of ripping a TCG pack!" Two defaults stand: the lair callout names the toggle only, and selected tokens deal one hoard per kind of monster. On the cards: "Full art, foils, special borders, fun". On a further review: "approved to pass it to fable for extra design review".
- 2026-11-18: T5 slice A (the staging rail, monster rows, the monster sheet's Deal) committed on the topic as 8b2648b2. Not walked: main commits held.
- 2026-11-18: no imported treasure art exists. Book art goes only to monsters, pregens and scene maps. The card side reads an art source with a fallback, and the importer half went to Treasure Tome, which agreed the contract: `treasureArt({side, pool, band, kind}) → {src, cite} | null` in `scripts/lib/book-art.mjs`. Treasure Tome builds it after S6. Rows live in a "bookArt" registry through lib/tables.mjs as `{side, pool, band, kind, src, cite}`, with `src` under `data/acks-extras-art/tt/`. A back asks `{pool, band}` and then `{pool, band: null}`, never a kind. A face asks by kind, then `{pool, band}`, then `{pool, band: null}`, then `{pool}`. Treasure calls it through a seam stubbed to null.
- 2026-11-18: the Fable pass (the owner's choice of model) was drawn as canvas v8, boards Cards and Reveal. The owner approved: "Only miss is they are not literally cards. So something like "You found X items" makes more sense. This doesn't require a remake, approve and implement." Then: "No motion, or literal card packs. It was a mood to evoke, not a physical procedure to mimic". That supersedes the departure, the seal, the tear, the deal and the turn, and rejects the Reveal board. Then: "These are adventurers rummaging through guts and filth. But it should be somehow justified by the (sometimes literally filthy) lucre". The mood is grime around the find, with the lucre shining through it.
- 2026-11-18: the owner's standing rule, given in the BtA session: "Find open art to attribute or better yet art/texture imported from the book. Standing rule for repo no generated art." It lives in the template's ip-doctrine.md. T5 slice B's drawn grime, foil, vignette and hatch were removed before commit. Their layers paint only a texture read through the seam, `textureArt(kind, band)`, which asks `{side: "texture", kind, band}` and renders no layer when nothing is found. A Treasure Tome row extending the art contract (`side: "texture"`, kinds grime, foil, foil-magic and vignette, cut from page regions, or open art with its licence recorded) was asked of the orchestrator.
- 2026-11-18: T5 slice B committed on the topic as bf87cdd8. It brings the band frames, lozenge corners and breaks, the gold aura frame and the heavy curse frame, the face's own picture in a framed slot, and "You found {n} items" ("In the pot: {n}" while staging), with no user string calling an entry a card. A name-only disguise now shows the pool icon on the Card face, never the true picture (`apparentImg`). The claimed item keeps its true picture, and the Judge's tile warns of it. Two owner questions are open. Q1: does a core raster icon take the framed slot (`CORE_RASTER_SLOTS`, now yes)? Q2: kind-specific face art may become a tell beside a masked card's generic art.
- 2026-11-18: the owner on spoils: "Spoils should be rolled into this too, with the bodies shown as cards to inspect to see if they find anything with the proper skills and tools". That became T7, drawn as canvas v9 "Spoils". On that board: "It should be assigning people to search the area and the bodies, and based on the rolls they find stuff. This rewards having multiple people working together and honors proper time tracking. Check RAW if you need extra hints." On scope: "Scope is all three, part of the next minor." The MM ch. 3 harvest importer request (registries `harvestPrereq`, `harvestParts`, `componentIdentify`, `valueIdentify` and `componentKeep`, read by `scripts/lib/harvest.mjs` `harvestRules()`) went to Treasure Tome through the orchestrator, queued behind S6.
- 2026-11-18: the owner widened T7: "Finding the loot is the hasty check of the room, just like a hasty body check will turn out the pockets/inventory carried gear. Some things might be explicitly hidden up to judge's discretion. There also might be a hint that something feels off (secrets yet to be found) following the GUMSHOE principle. This is becoming a whole scene tool and could incorporate things like inspecting statues/art. To clarify, there is an obvious layer (bodies, doors, lights), an obvious with inspection layer (hasty search, pockets, chests, history, theology check, secrets present incl traps), found with methodical search and/or appropriate skill (spoils, secret doors, hidden keys, trap defeats). Everything beyond that is narrative in GM responsibility. Survey RAW and the adventures for examples. I like this tool as an end combat screen." Then: "It could also be used in general when the party declares searching even without combat... add integration on party sheet?" And: "Seeing there is a fresco is obvious and would show up as a card to assign someone to, inspecting for subject is hasty, learning a secret/clue from it is methodical, as an example". Each scene object is one entry carrying its layers: seen, then hasty inspection, then methodical. There are two entries: the end of combat, and the party sheet's Dungeon tab.
- 2026-11-18: the orchestrator ruled that the scene screen is its own feature, slug `scene-search`, in this minor. It hosts the pot, and the pot stays treasure's. `topic/scene-search` opens only once the architect's plan names its first slice. It lands after `topic/treasure` and before obstacle-regions, unless the two share region or door code. Dungeon close-out owns the turn plan, doors and trap zones. A RAW and adventure survey and an inventory of the module's surfaces per layer were made, LOCAL-ONLY. The Fable visual pass on the scene screen has reported; the architect's plan is pending.
- 2026-11-18: the owner answered the scene-search questions; their words and the plan are `docs/scene-search/wip/20261118-scene-search-plan.md`, its phase run by its own session.
- 2026-11-18: `topic/treasure` landed on `main` as 92ce7364. Walked on lane C with FIXTURE_OWN: `treasure-deal` (new; "Dealing letters" steps 1 to 7) 43 pass, 0 fail; `treasure-faces` with a new step 7 (dress and pictures) 51 pass, 0 fail. The deal walk found that Deal pressed straight after typing the by-hand letter dealt nothing: the field's change re-rendered the window and replaced the button before its click. lib `writeOnChange` (`press-safe-change.mjs`) now writes such a change after the press, committed with this note. Not reached: step 7's registry-unimported half (only the API's `unknown-style` route), the picture checks, a Deal with Special treasure on, and a Tab walk through the rail. TESTING.md "Replace seeds at open" (T3) still has no walk; it is owed before the release.
- 2026-11-18: T6 scoped with the orchestrator. A dealt magic card carries a `tableRef` that nothing consumed, and the truth drops it when normalized, so the roll happens in the deal path: the noun is matched to an imported list caption, `rollMagicItem` is thrown, a resolved item is stored undetected and unidentified, an unresolved one as a named placeholder, and a refusal keeps the placeholder with a row in the Judge's deal notice. Building on the topic.
- 2026-11-18: T6 landed on `main` (2f8c27cd, 424bbeaf). Its first step 8 walk passed 9 checks and failed 4: no real hoard noun matched a real list. A local-only probe of the real import showed five noun shapes. (1) A noun that is a list's own word already matched. (2) A rarity noun printed without the trailing word every rarity caption carries matched nothing; it now also meets the list's own import key (fix on `main`). (3) A generic noun meaning a roll on the type list has no imported marker, so it stays refused as `no-match` with the Judge notice; this is an orchestrator question, and an importer marker is the candidate. (4) A choice among lists and (5) one of each of a parenthesized list are both refused as `compound` before matching; how either is thrown is printed procedure and belongs in `hoard-map`'s noun split, so it is registered, not built. The walk's "pot stays staging" failure was the walk reading the wrong flag key; the open works. The walk now takes a census of every treasure type in both styles, and every later check needs a real roll. Still registered: deal audit rows are never posted (needs a card, so /design first); `mask.cost` has no source but a disguise (on the owner list); the T3 "Replace seeds at open" walk is still owed.
- 2026-11-18: The walk-found fix landed on `main` as 0eee3387. Step 8 then walked on lane C with FIXTURE_OWN: treasure-magic-deal passed 17, failed 0, and the sweep of the run's own ids removed 6, could not find 0 and was refused 0. Census of every treasure type under a floor die: classic 55 placeholders, 16 named a list and rolled, 33 refused as `no-match` (the generic cell, T6b), 6 refused as `compound`; heroic 93 of 93 named a rarity list. The walk's two later failures were the walk's own (rolled cards found by object identity; No magic set before the deal, which leaves the magic column out), and both are fixed in the walk. TESTING step 8 now describes what the walk proves. The feature is walked except T6b and the compound shapes, which stay registered.
- 2026-11-18: T6b landed on `main` as 6255349b, built by one `implementer` agent: a noun-first clause rolls from the imported type list. Step 8 walked on lane C with FIXTURE_OWN: treasure-magic-deal passed 17, failed 0; the classic deal's audit began at both a category list and the type list, and a rolled card linked to a document claimed as it. Census: classic 55 placeholders, 49 roll, 6 refused as `compound`; heroic 93 of 93 roll. The walk's census now passes each placeholder's marker to `startFor`, and it picks a type whose placeholder names its list by its noun, so the claim half stays reached. The compound shapes (a choice among lists; one of each of a list) stay registered for `hoard-map`'s noun split.
