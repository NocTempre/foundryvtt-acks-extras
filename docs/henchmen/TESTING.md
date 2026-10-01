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
   actor's coin is up by it, and the flag's `lastPaidTime` moved. No "not
   together" warning: the unit's employer link is the reach. The branch that
   books nothing for a refused transfer has no route from here, since every
   due entry is in reach by its roster or its unit link. The refusal itself
   (a part-payment between two actors who are not together moves nothing) is
   asserted offline in `tools/test-coin-flows.mjs`; the bookkeeping after it
   is not walked.
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

Delete the employer, the hires, the location and any actors the recruit path
created. Confirm `location.system.market.candidates` is gone with the
location.
