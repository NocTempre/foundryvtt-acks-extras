# Henchmen — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

The walk that drives this recipe is `tools/live/henchmen.mjs`, in two stages
(`STAGE=1` and `STAGE=2` before `node tools/live/run.mjs henchmen`;
`tools/live/README.md` is the contract). Its header names the steps it covers;
a step it does not name is walked by hand.

## Fixtures

- A disposable `character` actor as the employer.
- A disposable `acks-extras.location` actor with a market added — recruitment,
  postings and candidates all hang off the market subtree.
- A second disposable `character` or `monster` to hire.
- For a group hire, a troop row written straight into
  `system.market.candidates` — a posting's weekly roll decides what arrives,
  and the step needs a troop on the market now: `kind: "mercenary"`, a
  `troopType`, `status: "available"`, a `quantity` above 1, and a `level`,
  `classKey`, `hitDice` line and `attributes` a new character does not carry
  (a 1d6 die, a level above 1), so a stat block the create path emptied cannot
  pass for the candidate's.

## Core drive mechanics (non-obvious, learned live)

- **Each entry point takes a different first argument. Guessing costs a
  throw.**
  - `openRosterApp(actor)` — the employer.
  - `openPostingDialog(actor)` — the employer.
  - `openThrowDialog(throwId, context)` — a **throw id string**, not an actor.
    Passing an actor throws `getThrowDef: no throw "[object Object]"`.
  - `openRecruitDialog(location, candidateId, employer)` — a location plus an
    id from `location.system.market.candidates`, so a posting must have
    produced a candidate first.
  - `openFollowersDialog(actor)` — the employer, and it is double-gated (see
    below).
- **The throw ids come from imported ruledata**, not from a constant here:
  `acksExtras.lib.tables.getDoc("throws")` lists them. As shipped they include
  `reactionToHiring`, `irrefusableOffer`, `hirelingLoyalty`,
  `hirelingObedience`, `liberationLoyalty`.
- **Followers are gated twice and say so out loud.** Without the followers
  tables imported the dialog refuses with a notification naming them; with the
  tables present it still refuses below 9th level. Both refusals are the
  observable — a silent no-op means the gate broke, not that the tables are
  missing.
- Level ladders inside the followers and availability paths are read with
  `lib/tables.mjs`'s `bracketRow`, which returns null off the end of a table
  rather than clamping.
- **A market's rarity overrides and the standing shift are walked from
  `docs/factions/TESTING.md`** (steps 10 and 11). The pool roller is
  importable in page context for a throw with chosen dice:
  `rollMonthlyPool(spec, marketClass, rollDice, rand, variant, overrides)`
  from `scripts/henchmen/rules/availability.mjs`, where `overrides` is the
  location's `system.market.rarityOverrides` read as plain rows, and the
  result's `rarity` says which tier was rolled on.
- **A dangling hireling reference is seeded, not made by deleting a hire.**
  Deleting a hireling runs the `deleteActor` prune on the active GM's client
  and leaves nothing to repair. Write an id no actor holds straight onto the
  employer — `employer.update({"system.henchmenList": ["zzDanglingId0001"]})`
  — and scope the repair to the fixture:
  `acksExtras.henchmen.repair.repairWorld({actors: [employer]})`. The bare
  call sweeps every actor in the shared world.
- **A hireling is linked by hand through core's own call.**
  `employer.addHenchman(hirelingId)` opens a confirm titled "Assign … as a
  Hireling of … ?" and waits on it; answer it, then set
  `system.retainer.enabled` and a `system.retainer.wage` on the hireling and
  call `enrollNewcomers(employer)`, which starts the wage clock. A wage set on
  the fixture keeps the step off the imported wage table.
- **A month is made due on the record, never on the clock.** The world's
  time is shared. Write the hireling's
  `flags.acks-extras.record.terms.lastPaidTime` to `now() - secondsPerMonth()
  - 60`, both read from `scripts/henchmen/time.mjs`, and a unit's
  `flags.acks-extras.groupPay.lastPaidTime` the same way.
- **The two Pay wages controls are different elements.** On this module's
  sheet it is the chip `[data-action="payWages"]` in the Followers tab's rule,
  beside `.acks-extras-frame__rule-note`. On the system's sheet
  (opened as docs/lib/TESTING.md, "Coin", describes) it is
  `.tab[data-tab="hirelings"] [data-action="payWages"]`.
- **A payday's hook fires on the seat that ran it.** Listen for
  `acksExtras.henchmen.HOOKS.WAGES_PAID` on both seats: a payday the Player
  seat hands over reports on the GM's.
- **What a seat was told is read off the notification.** Wrap
  `ui.notifications.info` and `.warn` for the length of the step. A seat that
  has just joined also raises the book loader's own toasts ("Reading …",
  "ACKS Extras | … open") for a minute or more; leave them out of the count.
- **A payroll entry out of the employer's reach is made by hiring a monster
  away.** `hireMonster(monster, first)` and then `hireMonster(monster,
  second)`: the first employer's `monsterHenchmenList` keeps the monster, its
  `retainer.managerid` names the second, and with no scene holding the first
  employer and the monster `lib.money.coinReach(first, monster)` answers
  `notTogether`. Hire while both employers are the GM's and give the Player
  the employer afterwards: a hire raises the monster's ownership to the
  employer's owners, and a seat that owns the hireling runs the payday itself.
- **A hire posts chat cards it does not return.** Wrap `ChatMessage.create`
  on the seat for the length of the call and `api.track` the ids it made.
- **What a handed-over payday answered is read on both seats.** The module's
  socket is `socketlib.modules.get("acks-extras")`: wrap the
  `henchmenPayWages` entry of its `functions` on the GM's seat for what that
  seat answered, and its `executeAsGM` on the asking seat for what arrived.
- **New Posting is disabled for a seat that does not own the place**, so the
  posting dialog is driven from a seat that does. Its employer select is
  `[name="employerId"]` and takes an actor id.

## Steps

1. `openRosterApp(employer)`.
   *Observable:* `RosterApp` renders, showing the henchman count against the
   CHA limit and a wage total — and the count is the employer's real one, not
   a placeholder.
2. `openThrowDialog("hirelingLoyalty", {actor: employer})`, then press its own
   **Roll** button.
   *Observable:* the dialog itemises base throw, loyalty score, level
   difference and the Judge's adjustment before rolling; the chat card names
   the band the result landed in and what it means in play.
3. `openPostingDialog(employer)` and post a notice at the location.
   *Observable:* `location.system.market.postings` gains the notice; advancing
   the market a week produces candidates in `market.candidates`.
3a. The employer-level cap on a leveled search. Where the world's `wages`
   holds no `employerLevelCap`, read `TABLE_RECIPES.wages.tables.employerLevelCap`
   off the connected book as step 4a reads the limit's base, and register it
   at priority 30 in this client only. The dialog's **Level** options stop
   below most rungs' caps, so drive the cap by **Presented level**: on the
   posting dialog, with a disposable employer, present a level whose rung
   allows less than the highest option and submit a **henchman** search at
   the cap and one above it, then the above-cap search again with **Domain
   ruler** ticked. Then present the open rung's floor plus one and submit the
   highest option.
   *Observable:* the search at the cap lands in `market.postings`; the one
   above it does not, and the dialog's error names the cap; the ruler's search
   and the open rung's land. With the table unregistered,
   `maxHenchmanLevel(level)` is null and the above-cap search lands; take the
   ruler's search down first, since a second active search of one segment for
   one employer is refused as a duplicate, which reads as the cap refusing.
3b. The market's henchman levels, with the `availability` tables imported and
   a month rolled at the location (step 3 rolls one).
   *Observable:* the posting dialog's **Level** options for a **henchman**
   search, the location's `market.marketRolls` henchman segments and
   `postingSegments("henchman:*")` each name exactly the levels of the
   world's `availability.henchmanAvailability` rows. Compare in page and
   report the match, never the levels.
4. `openRecruitDialog(location, candidateId)` for one of those candidates and
   hire them.
   *Observable:* the candidate's status leaves `available`, and the hire
   appears on the employer's roster.
4a. The henchman limit on a special hire. The limit needs its base: where
   `rules/wages.mjs > henchmanLimitBase()` is null, read
   `TABLE_RECIPES.wages.tables.henchmanLimit` off the connected book
   (`locatePageNumber`, `pageItems`, `extractTable`) and register the result
   as `wages` at priority 30 in this client only; unregister it at teardown.
   Bring a disposable employer to its
   limit without enrolling a crowd: write its `flags.acks-extras.retainBonus`
   to `1 - adapter.getRetainMax(employer)` and link one henchman. Register a
   plain `character` with `addSpecialHire(location, actor)` and call
   `hireExistingActor(location, entry.id, employer)`, once per mode of
   `enforceHenchmanLimit`. The setting is the shared world's: on a world other
   sessions use, stub `game.settings.get` for that one key on your own client
   and restore it in a `finally`, rather than writing it. Make a fresh
   candidate for each mode, and one more whose sheet says `specialist`.
   *Observable:* under `block` the call answers `{error: "limit"}` after
   saying the limit is reached. The entry stays `available`, and the roster
   and the actor's `retainer` are untouched. Under `warn` it says the same and
   hires. Under `off` it hires and says nothing. The specialist hires under
   `block` without a word: it takes no slot.
4b. What an offer is priced on, with the `wages` tables imported. Write three
   candidates straight into `system.market.candidates` with no `wageGp`: kind
   `henchman` at level 1, kind `mercenary`, kind `specialist`. Register two
   special hires: a `character` whose sheet says `specialist` with no wage,
   and a plain one at level 1. Open `openRecruitDialog` /
   `openRecruitSpecial` on each for a disposable employer, and read the open
   page's signing-bonus choices: `await app._prepareContext({})` on the
   influence-hosted page, or the throw dialog's `signingBonus` select.
   *Observable:* the two henchmen offer the bonus tiers priced on the
   ladder's 1st-level wage. Both specialists and the mercenary offer only "no
   bonus", and on the throw dialog the line says no wage is set. Close each
   page without rolling.
5. Wages: `payWagesFor(employer)` with a purse worth less than the wages due,
   then `payWagesFor(employer, {markMissed: true})`, then with enough, then
   with enough in coin that cannot make the wage exactly.
   *Observable:* a purse worth too little warns, moves nothing and books
   nothing: no payday, no arrears, no calamity. Marking the month missed books
   the whole wage as arrears with a calamity on the hireling's record, and
   `forgiveWageDebts` clears both. With enough, the employer's purse is down by
   the wage and the hireling's purse is up by it, on carried coin rows: read
   both with `lib.money.purseGp`, and no row's `system.quantitybank` moved. A
   purse that covers the wage but cannot make it exactly pays the larger part
   it can and books the rest as arrears. The settings list offers no "pay
   wages into the bank".
5a. A paid unit. Take the group step 10 hires (its
   `system.unit.employerUuid` is the employer's uuid), with no scene holding
   both actors, set `flags.acks-extras.groupPay.lastPaidTime` a month back
   and run `payWagesFor(employer)`.
   *Observable:* the employer's purse is down by the unit's wage, the group
   actor's coin is up by it, and the flag's `lastPaidTime` moved. The group's
   sheet lists that coin under **Purse**. No "not together" warning: the
   unit's employer link is the reach. A refused transfer is walked in 5e.
5b. The controls, as GM. With a month due and coin that cannot make the wage
   exactly, open the employer's sheet on its Followers tab and press **Pay
   wages**. With nothing due, call `employer.payWages()`. With a month due
   again and enough coin, open the system's sheet on its Hirelings tab and
   press its Pay Wages button; then once more with too little coin.
   *Observable:* before the press the Followers line reads the wages due and
   the chip is drawn; `wageBill(employer)` answers the same `due`. The press
   moves what the coin can make onto the hireling, books the rest on the
   record, logs the payment as part-paid, fires `wagesPaid` with what moved
   and what was booked, and tells the seat both figures. The line then reads
   the monthly cost and the chip is gone. With nothing due the seat is told
   so and no coin moves. The system sheet's button moves the wage from the
   employer onto the hireling and records the payday; with too little coin it
   warns, moves nothing and leaves the month due. No chat card is posted by
   any of the four.
5b-i. The days to the next payday, from the Player seat owning both. Leave
   the wage clock where a hire puts it, then set
   `flags.acks-extras.record.terms.lastPaidTime` on the hireling so that
   three days less an hour remain of its month (`now() - secondsPerMonth() +
   3 * 86400 - 3600`, both from `scripts/henchmen/time.mjs`), then one hour,
   then a day and a second, re-opening the Followers tab after each. With
   nothing due press the system sheet's Pay Wages button. Then take the
   hireling's ownership from the seat and press it again. For an employer
   with nobody on the payroll call `employer.payWages()`.
   *Observable:* the line reads the monthly cost and `next due in N day(s)`:
   the world's `daysPerMonth` for a hireling just hired or just paid, then 3,
   1 and 2, a part day counting as a whole one; `wageBill(employer).nextDue`
   is the clock plus one month. Each press with nothing due tells the seat
   that pressed the same days and moves no coin, whether that seat ran the
   payday or handed it over. With nobody on the payroll the notice names no
   days and the tab draws no wage line. A paid unit's clock
   (`flags.acks-extras.groupPay.lastPaidTime` on the group actor) counts the
   same way: alone on the payroll it sets the days, beside a hireling the
   nearer of the two does, and with the unit's month due the line reads the
   wages due beside the chip. Read the line as
   `[data-tab="followers"] .acks-extras-frame__rule-note`: other
   tabs draw rule notes of their own, and the sheet's first is not this one.
5b-ii. The line under a clock that moves. The world's clock is shared, so
   move the seat's own reading of it: with five days left on the wage clock
   and the sheet open on Followers, shadow `game.time.worldTime` on that
   seat's page with a getter a minute ahead
   (`Object.defineProperty(game.time, "worldTime", {configurable: true, get,
   set() {}})`) and call
   `Hooks.callAll("updateWorldTime", game.time.worldTime, 60)`; repeat two
   days ahead, then past the month; `delete game.time.worldTime` and call it
   once more. Count the sheet's renders with a `renderApplicationV2` hook and
   ask for none yourself. The property is the prototype's, so the instance
   has no descriptor of its own to save: one read after the first shadow is
   the shadow, and putting it back leaves the seat's clock ahead.
   *Observable:* a minute ahead renders nothing and the line reads 5 days;
   two days ahead renders once and reads 3; past the month it reads the wages
   due and draws the chip; with the shadow gone it reads 5 again. A real
   advance of the clock is not walked: it would bill every employer in a
   shared world.
5c. The controls, from the Player seat. The seat owns the employer and not
   the hireling, and a month is due. Press **Pay wages** on the Followers
   tab. As GM make a month due again, close the GM seat's page, and press it
   again. Bring the GM back, give the seat ownership of the hireling, make a
   month due and press it a third time.
   *Observable:* the first press pays: the wage leaves the store the
   employer's order names first and lands on the hireling, the record's
   payday moved, the Player's seat is told what was paid, and the hook fired
   on the GM's seat and not the Player's. With no GM connected the seat is
   warned that one must be, nothing moved and the month is still due. With
   every document owned the payday runs on the Player's seat and its hook
   fires there.
5d. A fee paid where the hire is made, as GM. The employer keeps coin at the
   market (`storage.depositCoin`) and carries none a payment may draw on.
   On the market's Recruitment tab press **New Posting**, choose the employer
   and post.
   *Observable:* the fee leaves the row the market keeps for the employer and
   joins the market's own coin; coin the employer keeps at any other place,
   and coin behind a lock on their person, is as it was. The posting is in
   `system.market.postings`. A signing bonus states the same reach
   (`within: location` in `engine/hire.mjs`) and is not walked here.
5e. A payday refused whole. As GM hire a monster for the employer and then
   for a second employer (above), set a wage on its record and make a month
   due; the Player seat owns the employer and not the monster. From the
   Player seat press **Pay wages** on the Followers tab, then the system
   sheet's Pay Wages button. As GM press the Followers control. Give the seat
   ownership of the monster and press it from the Player seat again. Repeat
   the first press for an employer with two such monsters, and for one with
   one such monster beside a monster hired once.
   *Observable:* each press the Player hands over answers `{status:
   "refused", reason: "notTogether", payees: [the monster's id]}`. The
   Player's seat is told once that the wages were not paid, in a warning
   naming the employer and the monster, and the GM's seat hears the
   transfer's own warning. No coin moves, the month is still due and no hook
   fires on either seat. The GM's own press is told once, by the transfer,
   and the Player's seat hears nothing of it. With the monster owned the
   payday runs on the Player's seat: one warning, the transfer's, and nothing
   is handed over. With two such monsters the one notification names both and
   the GM's seat hears two warnings. With one in reach beside one that is
   not, the Player's seat is told what was paid, the hook fires on the GM's
   seat, and the refusal is heard there alone.
5f. Hirelings enrolled by hand, by kind. Link three `character` actors to a
   disposable employer as above, `system.retainer.category` `mercenary`
   (wage 6), `specialist` (no wage) and `henchman` (no wage, level 1), and run
   `enrollNewcomers(employer)`. Read `wageBill(employer, now() +
   secondsPerMonth() + 60)`.
   *Observable:* `monthly` is the mercenary's 6 plus the henchman's ladder
   wage for 1st level, and `count` is 2. The wageless specialist is not
   billed and adds nothing to `nextDue`.
6. Loyalty and obedience: `openLoyaltyRoll` / `openObedienceRoll` on a hired
   henchman, and `recordCalamity`. Then write
   `flags.acks-extras.record.terms.claimedEmployerLevel` to the employer's
   level + 2 on a henchman and on a mercenary, and open `openLoyaltyRoll` on
   each.
   *Observable:* each posts its card, and the henchman's stored loyalty moves
   by the amount the card reported. The henchman's roll carries a level
   difference of 2, and the mercenary's carries 0. The obedience page itself,
   and a group's **Roll Morale**, are walked from `docs/influence/TESTING.md`
   (The morale pages).
7. Followers: `openFollowersDialog(employer)` below 9th level and, with the
   tables imported, at 9th.
   *Observable:* the level gate names the character and their level; with the
   tables absent the refusal names the tables instead.
8. Dangling-reference repair: seed a dangling id on the employer (above), call
   `employer.getTotalWages()`, render the employer's sheet, then run the scoped
   `repairWorld`.
   *Observable:* `getTotalWages` returns without throwing and the console warns
   once, naming the API call; the sheet renders; the repair reports the
   employer (`describeRepair` → "1 henchman") and `system.henchmenList` no
   longer holds the id. The setting's hint in Configure Settings names the
   same call.
9. Hosteller occupants, with the `people` tables imported. Read the street
   band of the `hosteller` row from
   `getDoc("people").tables.occupationTypes.rows` (`bands.generalStreet`),
   then call `generateOccupation(rand, "human")` from
   `scripts/henchmen/rules/identity.mjs` with a `rand` that returns
   `(band.min - 0.5) / 100` first and `0.5` after.
   *Observable:* `occupationSubTables.categories.hosteller.rows` covers 1–100
   with no gap, and the draw returns category `hosteller` with the occupation
   of the row whose band holds 51 — not the bare word "Hosteller", which is
   what a world without that sub-table returns.
10. Hire as a group: on the location's **Mercenaries** tab press **Hire as
    Group**, choose the employer (a GM seat with no assigned character is
    asked which), take part of the troop row and press **Hire the unit**.
    *Observable:* a group actor named for the employer holds one stack of that
    count. The troop row keeps its id and the heads not taken, still
    `available`, and a new row of the count taken reads `hired`. The stack's
    `template.snapshot` and the prototype actor its `template.uuid` names carry
    the candidate's level, class, hit die (read from the `hitDice` line) and
    scores, and the prototype holds no items. Track the group and the
    prototype from those two reads; the dialog reports counts, not ids.
11. A unit hired before 9.3.3, rebuilt on purpose: a disposable
    `acks-extras.group`, a troop actor made with
    `Actor.implementation.create` (it comes back first-level, classless, 1d8,
    carrying coins), and `acksExtras.lib.groups.addStack(group, troop, {count})`.
    Edit the troop's level, class and hit die, open the group's sheet, and drop
    the troop onto its stack row (`[data-stack-key]`) — a `DragEvent("drop")`
    carrying a `DataTransfer` of `{type: "Actor", uuid}` reaches the sheet's own
    drop handler.
    *Observable:* the "Re-pointed the stack" notice; the stack's snapshot
    carries the edits, and its key and headcount are unchanged.
12. An offer to part of a bulk row, head by head. Write a specialist row
    straight into `system.market.candidates`: `kind: "specialist"`, a
    `specialistType`, a `segment` of `specialist:<type>`, `status:
    "available"`, a `quantity` of 20, a `wageGp`. Give the employer coin. As the
    Player seat, press the row's Hire button on the location sheet, enter 6 in
    the **Offer to how many?** prompt, and roll the hiring page with a signing
    bonus chosen.
    *Observable:* the page's subject reads the row's name ×6; one chat card
    shows five further hiring rolls and a tally whose counts sum to 6. The
    row keeps its id at quantity 14; each outcome that occurred is a row of
    its own carrying that many heads; a refusal or try-again row carries a
    refusal naming the employer, a slander row reads `slandered`, and the
    location's `slander` gains one entry per slandering head. The accepting
    heads are ONE new actor whose `system.retainer.quantity` is the accept
    count, an élan group a second actor whose loyalty is one higher, and the
    employer paid the bonus once per head hired. Rig the dice
    (`CONFIG.Dice.randomUniform`, read from the top) to force a mix the first
    time it lands all one way. Track every hired actor from the roster.
    Then offer all 14 of the remainder: afterwards no row carries the old id.
13. A posting with a mercantile network. Give the employer an `ability` item
    named Mercantile Network whose `flags.acks-extras.extras.effects` holds
    one typed modifier: `target: "marketClass"`, a `condition`, and an
    invented step of 2 (`{kind: "flat", flat: 2}`), so the walk proves the
    value is read and not assumed. Set the location's `marketClassOverride`
    to 5, and put the market on the employer's Judge's list
    (docs/markets/TESTING.md, the known-market walk). Open the posting dialog
    from the owning seat and pick the employer.
    *Observable:* the **Search with the mercantile network** row shows, ticked,
    with a "Counted here" note; picking an employer without the power hides
    it. Post a general henchman search with it ticked.
    *Observable:* `system.market.networkRolls` holds one row per henchman
    level for the employer at the market's `monthAnchorTime`, each with
    `marketClass` 3. Every candidate the post added carries `networkFor` set to
    the employer. The posting's `totalAvailable` is the town's henchman total
    plus, per level, the network roll's excess over the town's. The fee card's
    formula is the class-3 fee. From a Player seat owning only a second
    character, none of the `networkFor` rows show on the sheet, and
    `openRecruitDialog(location, id, second)` warns "Only the character whose
    mercantile network…" before any roll. Close the posting and post again:
    no new `networkRolls` row and no new candidate. Post a mercenary search
    with the box unticked: no network roll, and the fee is the class-5 fee.
14. Powers valued from the page, and powers held by name only.
    - **Build the powers fresh.** `importAbility` hands back a copy the
      world's shared cookbook shelf already holds, built by whatever version
      made it, and that copy is not yours to refresh or delete. With the books
      open on the seat, build each power without a write instead. Import
      `cookbook.mjs` and `executor.mjs` from `/modules/acks-extras/scripts/
      importer/` and, for each id, resolve `cookbookEntry(id)`. Its book is
      `found.cb.book?.id ?? found.entry.book`. Then call
      `executeEntry(cookbookSessionDoc(book), found.cb, cookbookRegisters(),
      id)` and `bindAbility(found.entry, node, id, {ladders})`.
    - **Employer A.** Embed Leadership, Blood of Kings, Command, Diplomacy,
      Beast Friendship and Command of Voice built that way, at level 5.
    - **Employer B.** Hand-made `ability` items named Leadership, Command and
      Diplomacy with no effects, Charisma 3.
    - **A hireling for each.** Create each with `items: []`: an actor payload
      with `system` and no items comes back blank. Link it through
      `addHenchman`.
    - **A monster.**

    Open the roster for each employer, then `recruitMonster(monster,
    employer)` from `engine/monster.mjs`.
    *Observable:*
    - **Employer A's roster:** the max is the imported base (registered as in
      step 4a) plus A's Charisma modifier plus the two
      `retainBonus` values on the embedded copies'
      `flags.acks-extras.extras.effects`; read the values there, never off
      the page. `employerLoyaltyMods(A).baseLoyaltyBonus` is Blood of Kings'
      `baseLoyalty` value. No `[data-unvalued]` note shows.
    - **A's roster with the base unregistered:** it reads `1 / —`,
      `adapter.retainGap(A)` is `"import"`, and the `.limit-meter` tooltip is
      `ACKS-HENCHMEN.roster.limitNotImported`. Register the base again.
    - **Employer A's hiring dialog:** Diplomacy (its tone), Beast Friendship
      (`animal`) and Command of Voice (unaudited) are unticked.
    - **Employer B's roster:** with its limit pinned at one through the
      manual flag (its Charisma is the fixture's, its base the book's), it
      reads `1 / 1` and the note names Leadership.
    - **A monster employer's roster:** `count / —`, `retainGap` `"charisma"`,
      tooltip `ACKS-HENCHMEN.roster.limitUnknown`.
    - **Employer B's recruit:** the limit warning names Leadership, and its
      dialog shows Diplomacy locked at no value with the "No value imported"
      hint.

    Then reach the obedience fallback in this client only. The integration is
    a module namespace and cannot be patched. Swap
    `acksExtras.henchmen.integrations.influence` for `{...ns,
    hostsMoraleModes: () => false}` around `openObedienceRoll(hireling)`, and
    put `ns` back in a `finally`.
    *Observable:* employer A's hireling shows Command unticked at its located
    value. Employer B's hireling shows Command locked at no value. With `ns`
    restored, the same call opens the influence page again.
15. The hosted pages say what the fallback dialogs say, with the `influence`
    document's `hiringOffer` read (docs/influence/TESTING.md, The hiring
    page). Employers A and B from step 14, B also holding a hand-made Command
    of Voice with no effects, and an Active Effect on B's Command of Voice
    item carrying `flags.acks-extras.hiring` at an invented figure; a
    candidate on the location; an Active Effect on employer A carrying
    `flags.acks-extras.loyaltyRoll` at an invented figure.
    - `openRecruitDialog(location, candidateId, B)`, then read the open
      `InfluenceApp`'s `_prepareContext({})`.
      *Observable:* the Powers group holds B's hiring effect at its figure,
      once; no note names Command of Voice, since that effect values it;
      Diplomacy is the page's own typed box with the no-value badge and no
      note beside it. Delete the effect and reopen: the note names Command of
      Voice and the row is gone.
    - `openObedienceRoll(hireling)` for each employer's hireling.
      *Observable:* A's hireling's page offers Command at its located value,
      unticked; B's names Command in a note and adds nothing.
    - `openLoyaltyRoll(hireling)` for A's hireling.
      *Observable:* the loyalty-roll effect is a row on the page.
    - `recruitMonster(monster, A)` with the document read, and again after it
      is removed. A monster created with `system.hp.hd: "2d8"` reads HD 2,
      under A's level. The throw dialog rolls from its form's submit button,
      which carries no `data-action`; the card's band is its
      `flags.acks-extras.outcome`.
      *Observable:* the throw dialog's refusal and slander steppers show the
      page's figure per step and the card names the imported band; with the
      document gone, the warning names the table and no dialog opens.
16. The apparent-level figure and the level-gain morale bonuses, each first
    unread and then read. Unread is a priority-30 layer holding an empty
    table where the world's import holds one; read is the world's own, or
    the table read off the connected book through the shipped recipe
    (`TABLE_RECIPES.influence.tables.apparentLevel`,
    `TABLE_RECIPES.wages.tables.levelMorale`) into that layer. Fixtures: on
    employer A from step 14, a henchman linked through core's confirm whose
    record's `terms.claimedEmployerLevel` is A's level + 2, and two
    `character` actors created one level below the first rung that stands
    (`levelMoraleRungs()` with the table read) with
    `system.retainer.category: "henchman"`, each linked the same way. A level
    gain is `actor.update({"system.details.level": n})`, the update a sheet
    edit makes; the watcher runs on the primary GM's client, so the seat that
    writes the layer must be the active GM.
    - `openLoyaltyRoll(henchman)`, read the `InfluenceApp`'s
      `_prepareContext({})`, and press **Roll** under a dice rig.
      *Observable:* unread, the apparent-level row is a typed field with the
      unread badge under its bare name, the page shows no notice, and the roll
      names one of the page's bands with no line for the row in the
      roll-complete payload's `parts`. Read, the row's value is 2, its
      contribution two times the figure, the figure is beside its name, and
      the payload's line for it carries that contribution.
    - The same with the integration swapped (step 14's `ns`).
      *Observable:* the throw dialog's apparent-level stepper reads 2; unread,
      `context.stepValues` holds no figure for it and the info line names the
      count; read, the step is the figure and there is no info line.
    - Raise the first actor onto the first rung while unread; read, raise the
      second onto the first rung and then the second, open the roster, and
      raise the first one level more.
      *Observable:* unread, the record gains no morale entry and the card says
      the bonuses are not imported. Read, each gain adds one
      `morale.permanents` entry at its rung's bonus, reason `levelGain`, its
      note the rung's level, under the plain card, and the roster's ledger
      shows both on the morale track. The first actor's last gain adds no
      entry for the first rung: the rung it crossed while unread is not made
      up.
      Walked by `tools/live/henchmen.mjs` stage 1, section 16.

The reference repair's check in the repair tool (`henchmen.references`) is
walked in docs/lib/TESTING.md, "The repair tool".

## Teardown

`api.sweepTracked()`: the employer, the hires, the location, and every actor
the recruit path created, each tracked from the id read back when it was
made, and the chat cards the hires posted. Deleting a place that keeps coin
posts a "was destroyed" card; track it and sweep again. Confirm
`location.system.market.candidates` is gone with the location.
