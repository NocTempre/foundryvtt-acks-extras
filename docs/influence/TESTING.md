# Influence — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`.

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
- Modifiers are listed on the card by name. An alignment match contributes +1
  without anything being configured, so a "no modifiers" expectation fails on
  two actors that happen to share an alignment — set them deliberately.
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

## Teardown

Delete the influencer, the target, and every `acks-extras.attitude` item the
rolls minted. Confirm none remain on either actor. For the morale pages:
every actor and chat message the run made, by its own uuid, and the `morale`
document, if the run imported it.
