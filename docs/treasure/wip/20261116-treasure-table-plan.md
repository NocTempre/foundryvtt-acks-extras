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
