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

## Slices

All slices are built on `topic/treasure` and walked on `main` by the session
itself. The `live-tester` agent re-delegates instead of testing.

| # | Scope | Agent, and why | Waits on | Offline gate | Live walk |
| --- | --- | --- | --- | --- | --- |
| T1 | Pot message, window, relay, manual source, flips, claims, leftovers; `docs/treasure/TESTING.md` | `implementer`: the design is fixed above | nothing | pure tests: planner, relay guards; validate | GM and Player seats: open, flip, claim; a claim onto an unowned actor is refused |
| T2 | `detected`, `magicKnowledge`, sheet gating, `disguiseData`, the `IDENTIFIED` listener | `implementer` | nothing | `test-item-sheet` with a mutation check | Player sheet shows no identify button or aura on an undetected item; recognizing lifts the name |
| T3 | Seeding and the replace planner | `implementer` | answer B | invented rows | A seeded card cannot be told apart on the Player seat |
| T4 | `hoard-logic.mjs`: cell grammar, nouns matched against imported kind names, sub-rolls; an adapter over the tables | `implementer`: the engine now on invented rows, the adapter after tt-importer S1 lands | S1 | asserts the die's size | Real JJ import, deal from a letter |
| T5 | Entry points: the monster statblock's letter, selected tokens grouped by monster, a lair-only warning (`lairOf`) | `implementer` | T4 | | yes |
| T6 | Magic cards through `magic-item-roll` | `implementer` | tt-importer S4 (documents after S6) | | yes |

T1 and T2 can be built in parallel: T1 writes `scripts/treasure/`, while T2
writes `lib/item-model.mjs`, `equipment/` and `markets/`, which T1 does not
touch.

### Requests to the tt-importer session (its S1 is in flight)

- Read the coin columns' "1000s" unit, which sits in a header nothing reads
  today.
- Read the rows that give each gem and jewelry kind its dice.
- Read the special-treasure lot unit, which follows "Special Treasure per" in
  each caption.
- Keep the `typeClassic` / `typeHeroic` shape stable, or announce a change.

## Owner questions

Defaults the phase session proceeds on if they are unanswered:

- **A. Who rolls the hoard's dice?** Default: the Judge chooses per pot.
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

> Orchestrate the treasure table, `docs/treasure/wip/20261116-treasure-table-plan.md`.
> Open `topic/treasure` with `acks-branch`. Message the tt-importer session
> (its plan's "Requests" list and the S5 move) before the first edit. Build T1
> and T2 with fresh `implementer` agents, one slice each, quoting the owner's
> words above in each brief. Land each slice and walk it on `main` from the
> recipe yourself. T3 to T6 follow their "Waits on" column. Proceed on the
> owner-question defaults unless they have been answered. Append results here
> and correct this prompt for the next phase.

## Results

(Appended by each slice.)
