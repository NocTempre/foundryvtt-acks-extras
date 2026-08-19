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

## Teardown

Delete the influencer, the target, and every `acks-extras.attitude` item the
rolls minted. Confirm none remain on either actor.
