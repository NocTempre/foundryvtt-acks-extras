# Henchmen — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

## Fixtures

- A disposable `character` actor as the employer.
- A disposable `acks-extras.location` actor with a market added — recruitment,
  postings and candidates all hang off the market subtree.
- A second disposable `character` or `monster` to hire.

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
5. Wages: `payWagesFor(employer)` with too little coin, then with enough.
   *Observable:* the shortfall is booked as arrears rather than silently
   ignored, and `forgiveWageDebts` clears it.
6. Loyalty and obedience: `openLoyaltyRoll` / `openObedienceRoll` on a hired
   henchman, and `recordCalamity`.
   *Observable:* each posts its card, and the henchman's stored loyalty moves
   by the amount the card reported.
7. Followers: `openFollowersDialog(employer)` below 9th level and, with the
   tables imported, at 9th.
   *Observable:* the level gate names the character and their level; with the
   tables absent the refusal names the tables instead.

## Teardown

Delete the employer, the hires, the location and any actors the recruit path
created. Confirm `location.system.market.candidates` is gone with the
location.
