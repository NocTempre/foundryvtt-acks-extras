# Henchmen — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

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
  beside `.acks-extras-character-sheet__rule-note`. On the system's sheet
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
4. `openRecruitDialog(location, candidateId)` for one of those candidates and
   hire them.
   *Observable:* the candidate's status leaves `available`, and the hire
   appears on the employer's roster.
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
   `[data-tab="followers"] .acks-extras-character-sheet__rule-note`: other
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
6. Loyalty and obedience: `openLoyaltyRoll` / `openObedienceRoll` on a hired
   henchman, and `recordCalamity`.
   *Observable:* each posts its card, and the henchman's stored loyalty moves
   by the amount the card reported. The obedience page itself, and a group's
   **Roll Morale**, are walked from `docs/influence/TESTING.md` (The morale
   pages).
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
    count, and the candidate's status is `hired`. The stack's
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

The reference repair's check in the repair tool (`henchmen.references`) is
walked in docs/lib/TESTING.md, "The repair tool".

## Teardown

`api.sweepTracked()`: the employer, the hires, the location, and every actor
the recruit path created, each tracked from the id read back when it was
made, and the chat cards the hires posted. Deleting a place that keeps coin
posts a "was destroyed" card; track it and sweep again. Confirm
`location.system.market.candidates` is gone with the location.
