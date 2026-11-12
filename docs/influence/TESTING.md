# Influence — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

The hiring page and its table are driven by `tools/live/henchmen.mjs`
(`node tools/live/run.mjs henchmen`; `tools/live/README.md` is the contract),
whose header names the steps of this recipe it covers; the rest is walked by
hand.

## Fixtures

- A disposable `character` actor as the influencer.
- A disposable `monster` or `character` as the target.
- A disposable `acks-extras.attitude` Item only when testing the sheet
  directly; the roll path mints its own.

## Core drive mechanics (non-obvious, learned live)

- **The target is an OPTION, not a second positional argument.**
  `open(actor, {targetActor})`. Calling `open(actor, target)` opens the app
  with an unbound target, and it still rolls — the card says "→ Target" and
  the test looks like it passed. Assert the target's NAME in the card.
- **The attitude item lands on the INFLUENCER, not on the target.** After a
  roll, look for `Attitude: <target name>` in `influencer.items` filtered to
  `acks-extras.attitude`. Looking on the target finds nothing and reads as the
  write having failed.
- Modifiers are listed on the card by name. With the tone page imported, an
  alignment match contributes its figure without anything being configured, so
  a "no modifiers" expectation fails on two actors that happen to share an
  alignment — set them deliberately.
- A player's roll against a hidden target is re-resolved on a GM client
  through the `resolveHiddenRoll` socket handler. Testing it needs a real
  second seat (the capture driver's browser), not a second pane tab.
- **Rows pushed through the modifier hook are read from the context, and a
  note is told apart in the DOM.** `app._prepareContext({}).externalModifiers`
  carries `{label, value, note}`; on the dialog each is an
  `.influence-external-mod`, and a note is the one with no
  `.influence-external-value` beside its label. The posted card's modifier
  list leaves notes out. These rows, and the social status row's pre-fill from
  two rank markers, are walked from `docs/factions/TESTING.md` (steps 7, 8
  and 12); a district's own row from `docs/formation/TESTING.md` (The
  districts).

Steps 1 to 8 name a result and an attitude, which the tone pages read from the
`influence` document's reaction and attitude tables: run them with those
imported, or registered invented in the client as the tone pages' drive
mechanics below describe. Without them the roll names no result (step 27).

## Steps

1. `open(influencer, {targetActor: target})`.
   *Observable:* `InfluenceApp` renders with the target named, the five
   attitude buttons, the three tones, and a relationship modifier line.
2. Press the app's own roll button on Diplomacy.
   *Observable:* one chat card naming both actors, the 2d6, every applied
   modifier by name, the reaction band, and the attitude transition
   (`from → to`).
3. Re-roll after setting the initial attitude to Hostile.
   *Observable:* the transition starts from Hostile, and the relationship
   modifier line changes with it.
4. Intimidation and Seduction.
   *Observable:* each names its own tone on the card and applies the tone's
   own modifiers — the three are not the same roll relabelled.
5. Attitude persistence: re-open the app on the same pair.
   *Observable:* the current attitude is the one the last roll left, read from
   the influencer's attitude item rather than reset to Neutral.
6. Attitude sheet: open the minted attitude item.
   *Observable:* `AttitudeSheet`, with the target named and the five-step
   attitude selector reflecting the stored value.
7. Racial relations: enable the BTA caste setting and the race-relations
   setting, then roll across two races with a declared relation.
   *Observable:* the relation appears as a named modifier; turning the setting
   off removes it — an inert setting is a bug.
8. Player seat: from a seat owning the influencer, roll against a target the
   seat cannot see.
   *Observable:* the result is re-resolved GM-side and the player's card does
   not disclose the target's hidden data.
8a. A bribe moves coin. As GM, give the influencer silver worth more than the
   first bribe tier and no gold (`lib.money.creditCoin`), arm that tier on
   Diplomacy and roll. The fee fills itself from the target's wage only where
   the wage ladder is imported and has a row for the target; where it reads 0,
   type the fee before rolling.
   *Observable:* the influencer's purse is down by the fee and the target's
   is up by it (`lib.money.purseGp` on both), in coin the influencer held.
   Empty the influencer's purse, arm the tier and roll again: a warning names
   the influencer, and neither purse changed. The card's modifier list leaves
   the tier's figure out, and its notes say the bribe was not paid.
8b. A bribe from the Player seat. The seat owns the influencer and not the
   target; the influencer keeps coin in a container their order pays from
   first, loose, and at a vault. Open the page with
   `acksExtras.influence.open(influencer, {targetActor})`. A target the seat
   cannot observe masks the bribe select (the page has no
   `[name="mod.bribe"]`), so type the offer in `[name="mod.bribeFee"]` (a
   `change`) and press `[data-action="roll"]`. Then roll with no target and a
   small fee, where the select is back and wants its first tier set, and with
   a fee above everything the influencer can pay with.
   *Observable:* the first roll is resolved at the Judge's seat and its card,
   whispered there, carries `.influence-chat-bribe` stating the fee, the
   payer and the payee. The fee left the container first and landed on the
   target. With no target the line names the payer alone and the coin is
   gone from the world. Above what can be paid there is no bribe line on the
   card, no row changed, the bribe's figure is absent from the card's list of
   modifiers and the total (the same roll with the fee covered totals that
   much higher), the card's notes (`.influence-chat-notes li`) say the bribe
   was not paid, and the warning shows on the Player seat too, before the roll
   is handed over, as well as on the Judge's seat when it resolves it.
   `api.track` every card the three rolls posted, read on the Judge's seat:
   a whispered card is not in the Player seat's log.
8c. The bribe note. Roll Diplomacy with a tier armed for an influencer with
   no `ability` item named Bribery, then for one who has it, then with no
   tier armed.
   *Observable:* the first card's notes (`.influence-chat-notes li`) include
   one that marks the risk and cites its page; the other two cards carry no
   such note. Against a target the seat cannot observe, the note is on the
   Judge's whispered card and the public card lists no notes.
8d. What a bribe costs, on `influence/bribe-influencer` (a character the
   Player seat owns, topped up to a thousand gp at the step's start) and
   `influence/bribe-target` (a character the Player seat cannot observe). The
   staged Revised Rulebook must be named in `ACKS_TEST_BOOKS`.
   - Connect the staged book on the GM seat and run
     `cookbookImportTables(["wages"])`, the import a Judge runs.
     *Observable:* no missing book; `henchmanWageImported()` holds and
     `signingBonusCost(1, …)` answers.
   - Open the page on the GM seat against the target and set
     `[name="mod.bribe"]` to the first tier (a `change`).
     *Observable:* `[name="mod.bribeFee"]` holds `signingBonusCost(1,
     henchmanWage(level))`'s gp for the target's level, above 0, and its
     `data-tooltip-text` names that figure, with no raw key.
   - Under a registry layer of the walk's own on the GM seat, at a priority
     no import or override uses, whose `wages.signingBonus` holds no periods:
     the same page, then a blind offer typed in the Player seat's page and
     rolled.
     *Observable:* the GM's fee is 0 and its tooltip is
     `ACKS-INFLUENCE.bribe.feeTipMissing`; the Player's page masks the tier;
     the card the GM seat posts carries no `.influence-chat-bribe`, the
     influencer's purse is unchanged, and the GM seat shows
     `ACKS-INFLUENCE.bribe.unpriced`. `api.track` the card. Walked by
     `tools/live/influence-bribe-price.mjs`.

## The morale pages

Fixtures: a disposable `monster` with a morale score; a disposable
`acks-extras.group`; a disposable employer and henchman (`character` each,
joined with `employer.addHenchman(henchman.id)`); the `morale` ruledata
document, imported by the run and removed by it.

Drive mechanics:

- **The page is reached through the system's own method.**
  `actor.rollMorale({})` is what every Morale button calls, and the open app
  is the `InfluenceApp` in `foundry.applications.instances`. Passing
  `{event: {shiftKey: true}}` — whichever key `acks.skip-dialog-key` names —
  is the skip-key path.
- **`addHenchman` raises a confirm dialog and resolves only when it is
  answered.** Awaiting it in the call that should press Yes hangs the call.
  Fire it, then click `button[data-action="yes"]` on the `DialogV2` in a
  second call.
- **Import one document, not all of them.** Connect the book with
  `connectBookUrl("rr", <staged path>, {remember: false, bridge: false})` and
  run `cookbookImportTables(["morale"])`; a full run is minutes. Fire it into
  a global and read the global back, since a hidden pane stretches the wait.
  `bookStatus()` opens a dialog and waits on it — do not call it in the chain.
  Remove with `services.get("ruledata-import").removeDoc("morale")`. Compare
  what a card adds against the table numerically; a rung's wording is the
  book's and stays out of a report.
- **A group's menu entry is collected from the hook.**
  `Hooks.callAll("getActorContextOptions", ui.actors, options)`, find the
  entry labelled `ACKS-HENCHMEN.unitMorale.menu`, and call its `onClick` with
  the directory `li` (`[data-entry-id]`). A group created a moment ago has no
  `li` until `ui.actors.render()` has run.
- **A priced condition needs no world write.** Register invented figures in
  the client's own registry — `tables.registerTable({id: "conditions", tables:
  {modifiers: {<id>: {all: <n>}}}}, {priority})` — and `unregisterTable` them
  after.

Steps:

9. With no `morale` document: `monster.rollMorale({})`, type a figure into an
   unread row, press **Roll**.
   *Observable:* the page opens with the subject alone, four badged typed
   fields and the notice; the card lists each modifier by name with its
   figure, the dice and the total, and says no result is named; the message's
   `rollResult.outcome` is null.
10. Hold the skip key; then turn `moralePage` off and roll without it.
    *Observable:* the system's own card with the key, the system's own dialog
    with the setting off, and no `InfluenceApp` either time. Turn the setting
    back on.
11. Import `morale`, reopen, choose a rung on two ladders, tick the single
    figure, roll.
    *Observable:* each ladder is a select of a blank and its rungs, drawn
    under its name at the row's width; no badge and no notice; the card's
    modifiers equal the table's figures for the options chosen, and its
    result is the band the total falls in.
12. The group's **Roll Morale** entry.
    *Observable:* the entry is offered for the group and not for a monster;
    the page opens on the group with its command morale as the rating.
13. `openObedienceRoll(henchman)`, choose rungs, push the adjustment far
    enough down to refuse, roll.
    *Observable:* the page names the employer and the hireling, the card is
    whispered to the Judges and names the refusal, and the henchmen feature's
    insist card follows it.
14. Player seat (the capture driver's browser, with the monster owned by that
    seat): `rollMorale({})` and roll.
    *Observable:* the page opens with the imported ladders and the card is
    authored by the player.
15. Remove the `morale` document and reopen.
    *Observable:* typed fields, badges and the notice again.
16. Give the monster two conditions, one that carries a morale figure and one
    that exempts it, and open the page; then roll with the skip key.
    *Observable:* with no figures imported, two notes and nothing added; with
    figures registered, a named row per figure, in the total and on the card.
    The skip-key roll raises the conditions' own notices and leaves the
    stored score as it was.

## The hiring page

Fixtures: three `character` actors, each created with `items: []` — one
holding a Diplomacy built fresh from the books (docs/henchmen/TESTING.md
step 14, "Build the powers fresh"), one holding a hand-made `ability` named
Diplomacy with no effects, one holding nothing. The walk keeps them as
`henchmen/employer-a`, `-b` and `-c`, and brings each to its creation shape,
holding no item, before step 14 builds the powers again (docs/henchmen/TESTING.md,
Fixtures). The `influence` document is imported by the run and removed by it.

Drive mechanics:

- **Open the page with no hire behind it.**
  `acksExtras.influence.open(actor, {mode: "hiring", ctx: {previousRefusals,
  slanderCount, signingBonusOptions: [{label: "—", value: 0}]}})` with no
  `context`: the henchmen feature applies a result only to a roll whose
  context names it, so nothing is hired. The hosted page with a real
  candidate behind it is walked from docs/henchmen/TESTING.md step 15.
- **Check before importing, and import one document.** Read
  `acksExtras.lib.tables.hasDoc("influence")` first: a world that already
  holds the document is not the run's to remove, so register invented figures
  in the client instead (`registerTable({id: "influence", tables:
  {hiringOffer: {bands, refusalPenalty, slanderPenalty}}}, {priority})`,
  unregistered after). Otherwise `cookbookImportTables(["influence"])`, as for
  `morale` above, and `removeDoc("influence")` at teardown.

Steps:

17. With no `influence` document: open the page with a refusal count and a
    slander count, and press **Roll**.
    *Observable:* both count rows are badged typed fields and the notice
    names the page; the roll warns that the table is not imported, and no
    card is posted.
18. Import `influence` and reopen.
    *Observable:* no badge and no notice; each count row shows the figure
    each count adds; `_prepareContext({})` totals the count times the figure
    for each; **Roll** posts a card whose result is the band the total falls
    in, and the roll-complete payload's `outcome` is that band's key.
19. Open the page for each fixture actor.
    *Observable:* the fresh-built Diplomacy draws one Diplomacy box worth the
    value on its own `flags.acks-extras.extras.effects`, with the figure in
    its label, and no Intimidation, Seduction or Mystic Aura box; the
    hand-made Diplomacy draws a typed field with the no-value badge; the actor
    holding nothing draws no proficiency box at all. The same holds on the
    markets feature's assessment page.

## The loyalty page

The page opens from the henchmen feature's `openLoyaltyRoll` on a henchman
whose record claims a higher employer level; the fixtures, the unread and
read layers and the drive are docs/henchmen/TESTING.md step 16.

20. Open the page with the `influence` document's `apparentLevel` and
    `hirelingLoyalty` unread, then read, and press **Roll** each time.
    *Observable:* unread, the apparent-level row is a typed field with the
    unread badge, the notice names RR 166, and the card names no result (the
    roll-complete payload's `outcome` is null, and the henchmen feature
    applies no consequence). Read, the row shows the figure each level adds
    and contributes the count times it, the `parts` carry that line, and the
    card names the result the page's edges give the total.

## The irrefusable offer and the insist card

Fixtures: a disposable character as the employer and a disposable monster as
the captive; the henchmen feature opens the page (`openIrrefusableViaInfluence`,
`docs/henchmen/TESTING.md`). For the insist card, a hireling on a refusal:
`openObedienceRoll(henchman)` with the adjustment pushed down far enough to
refuse (step 13). Check `hasDoc("influence")` and `hasDoc("morale")` first and
register invented tables in the client when a world holds them.

21. Open the irrefusable offer with `influence.irrefusableOffer` unread, then
    with invented edges and an invented opposite-alignment figure registered,
    and roll each time.
    *Observable:* unread, the opposite-alignment row is a typed field with the
    unread badge, the notice names MM 351, and the card names no result. Read,
    the row is a tick worth the registered figure with its tooltip naming the
    page, and the card names the result the edges give.
22. Refuse an obedience roll with `morale.hirelingObedience.insistPenalty`
    unread, press the insist card's button; then register a figure, refuse
    again, press it.
    *Observable:* unread, the button's tooltip says the penalty is not
    imported, pressing it warns, adds no loyalty entry to the hireling's
    record and opens the obedience roll again. Read, the tooltip names the
    registered figure and its page, and pressing adds one permanent loyalty
    entry of exactly that figure, reason "insistence".

## The tone pages

The three reaction tones read `influence.diplomacyModifiers`,
`intimidationModifiers` and `seductionModifiers`. Fixtures: the influencer and
target above, set to differing alignments and a level gap wide enough to clear
the floor, and a character holding Diplomacy.

Drive mechanics:

- **Check before importing, and import one document.** As for the hiring page
  above: `hasDoc("influence")` first. A world that already holds it is not the
  run's to remove, so register invented tables in the client instead
  (`registerTable({id: "influence", tables: {diplomacyModifiers: {...}}},
  {priority})`, unregistered after). Otherwise
  `cookbookImportTables(["influence"])` with the Judges Journal connected, and
  `removeDoc("influence")` at teardown.
- Read a row's state from `app._prepareContext({}).groups`: a disabled row has
  `isDisabled`, an unread one `isNotImported`, and `figureTip` is the string the
  label's tooltip shows.

Steps:

23. With no `influence` tone table: open each tone page.
    *Observable:* every row that names a figure is disabled with the
    not-imported badge, the notice above the rows names the page, the total
    contributes nothing from them, a pre-fill (alignment, level gap, age,
    social status) fills none of them, and the character's Diplomacy item is
    offered in its own row with its own effect rather than a dead box. No label
    shows a number other than a page reference or a tier.
24. Import the tables, or register invented ones, and reopen each tone.
    *Observable:* no disabled row, no notice; each figured row shows its figure
    and the label's tooltip names the page it was read from; a rung select
    lists the rungs that were read under a blank option, and choosing a rung
    changes the total by that rung's figure; the pre-fills fill from the
    imported figures; a level gap short of the imported floor fills nothing.
25. Set an override layer for one table and reopen.
    *Observable:* that table's tooltips say the figure is the Judge's own.
26. Delete the tables again (the DELETE path) and reopen.
    *Observable:* step 23's state returns without a reload.
27. Roll each tone with its `<tone>Reaction` table unread, then read (invented
    edges, and a count for each result), with the character's current
    attitude set to each rung in turn.
    *Observable:* unread, the notice names the page, the card says the reaction
    table is not imported and names no result, the attitude on the page and in
    the influencer's attitude item is unchanged and the next roll is still the
    same attempt. Read, an initial reaction sets the attitude by the result's
    position; a continuing roll moves it by that result's count toward the
    hostile end, the other end, or Neutral for the middle result, never past
    either end; the shift line on the card names the count and the end. A
    count left out of the registered table leaves a continuing roll with no
    result and the attitude where it was.
28. With `<tone>Attitude` unread, then read (invented figures for the rungs
    the page prints), hover each rung of the ladder.
    *Observable:* unread, every rung's tooltip says not imported and the line
    under the ladder shows "none"; read, a rung with a figure names it and the
    page it came from, a rung without one says the page prints none, and the
    total changes by the figure when that rung is the current attitude and not
    for a rung without one.
29. Diplomacy with `influence.bribeTiers` unread, with one tier left out, then
    read, and choose each tier.
    *Observable:* unread or partial, the bribe select is disabled holding only
    the blank, flagged not imported, with a tooltip naming RR 287, and the
    fee is not asked. Read, the select lists Tier 1 to Tier 3 each with the
    registered bonus beside it; choosing a tier adds that bonus, and the fee
    field fills with the henchmen api's price for that tier's place.
29a. The bribery charge mark (RR 287), on a Diplomacy roll by an influencer
    holding the Bribery proficiency with a tier chosen and the fee covered:
    `influence.bribeCrime` read (the world's import, or
    `TABLE_RECIPES.influence.tables.bribeCrime` read into a priority-30
    layer), absent (an empty table at priority 30), and overridden (an
    invented `natural` at priority 30, as the Ruledata Browser writes it).
    Rig the dice so the unmodified roll equals the figure in force, then so
    it does not.
    *Observable:* read, the card's notes carry the charge-mark line only on
    the rigged roll that meets it, followed by "Read from your own book at
    import" with the page; a roll that misses carries none. Overridden, the
    line appears on the invented figure and says a Judge's override set it;
    lifting the layer returns the page's figure. Absent, every such roll's
    card notes that the mark is not imported, and none names a charge. An
    influencer without Bribery gets the risk note (RR 287) in every state.
30. Seduction with `characterAging` unread, then read (invented year spans
    for a human row), against two actors of the class "Fighter" at ages
    spanning different categories.
    *Observable:* unread, the notice names the aging table and the age row's
    count stays zero. Read, the count is the number of categories the target
    stands above the character's, with Ancient counted as Old.
31. A roll with the Mystic Aura box ticked and `influence.mysticAura` unread,
    then read (an invented total), then rolled to meet it.
    *Observable:* unread, the card says the bewitching mark is not imported.
    Read, the card names the subject bewitched only on a total at or above the
    registered figure.
32. A people race read off the class, with RR and JJ imported: two actors whose
    `details.class` is the printed name of `def.class.class20` and of
    `def.class.class21`. Read `racial.mjs > kindOf(actor)` for each, then the
    seduction aging row against a target of the other.
    *Observable:* the races are `people1` and `people2`, each with the `human`
    category and not `demi-human`; with `characterAging` read, each actor's
    age row is the `people1` / `people2` row of the table, not the human one.

## Teardown

Delete the influencer, the target, and every `acks-extras.attitude` item the
rolls minted. Confirm none remain on either actor. For the morale pages:
every actor and chat message the run made, by its own uuid, and the `morale`
document, if the run imported it. For the hiring and loyalty pages, walked by
`tools/live/henchmen.mjs`: no actor is swept, since its fixtures are kept and
its cards are retired by the next run (docs/henchmen/TESTING.md, Teardown);
remove the `influence` document if the run imported it, or unregister the
figures it registered; the tone pages' walk (steps 23-31) leaves the same
layers behind and removes them the same way.
Unregister any condition figures the run registered in the client.
