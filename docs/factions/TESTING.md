# Factions — live-test recipe

Format per docs-doctrine: fixtures → steps → observable → teardown. Server and
driver mechanics are `C:\Proj\acks-rules\TEST_ENVIRONMENT.md`; the settlement
board and district fixtures are `docs/formation/TESTING.md`, and this recipe
builds on its city steps.

## Before anything else

`game.documentTypes.Actor.includes("acks-extras.faction")` must be true. The
sub-type is read by the server at world launch, not on reload: on a world
launched before the module carried it, `Actor.create({type: "acks-extras.faction"})`
returns falsy with "not a valid type" on the console and nothing persists.
Shut the world down and relaunch it, then check again.

## Fixtures

- A disposable city scene with one district Region carrying the district
  behaviour (the formation recipe's district fixture) and a party formation
  in settlement mode standing inside it.
- Two disposable `acks-extras.faction` actors: a `watch` controlling the
  district, and a `guild` with no holdings.
- A disposable `acks-extras.location` with a market (press **Add a market**),
  and a disposable character to hire with.
- A disposable character to roll a reception with, and one to be its target.
- A third disposable `acks-extras.faction` — a `syndicate` — so the relation
  rows have two sides, and a second disposable `acks-extras.location` to serve
  as a holding beyond the guild's seat.

## Core drive mechanics (non-obvious, learned live)

- **A faction is made like any actor**: `Actor.create({name, type:
  "acks-extras.faction"})`; the sheet is the module's by default. Its
  `controls` wants Region uuids — `acksExtras.factions.districtRegionOptions()`
  lists every district on every scene as `{uuid, label}`; pick from it rather
  than composing a uuid.
- **Create, then update — creation `system` data does not survive the
  system's own class.** The ACKS system overrides `Actor.create` on its
  document class and replaces a single create's `system` wholesale unless the
  data carries `items`. The capture driver's `api.create`, and anything else
  that goes through `getDocumentClass("Actor").create`, therefore lands a
  faction with `kind: "other"` and empty `controls` whatever it was given,
  while the base `Actor.create` keeps it. Create the bare actor and `update`
  its `system.*` afterwards, which is also the order a Judge works in.
- **Schema rows are plain objects.** `system.standing`, `system.members` and
  a location's `market.rarityOverrides` are arrays of plain objects, not data
  models: `row.toObject()` throws. Read them as they are.
- **A standing row is written through the api, not `update`**:
  `acksExtras.factions.addStanding(faction, {subject: {scope: "party", uuid:
  partyActor.uuid}, value: -2, source: "wanted", reason: "…"})` stamps the
  world time and the subject's name; a row pushed by `update` has neither.
  The `acksExtras.factionStandingChanged` hook carries the faction's **uuid**
  in `faction`, not the document.
- **The hunt fires on a quarter change, not on a turn.** `withHunt` runs
  inside `setJourneyMode` (entering the city) and inside the city turn; to
  see it after adding a wanted row, either leave the city and enter it again
  or move the party across a district edge. **Setting settlement mode on a
  party already in that city is not an entry** and asks nothing: press the
  tracker's city button (`[data-action="settlementMode"]`) twice, once to
  leave and once to come back, which starts the fresh tally an arrival gets.
  Ticking a turn in the same quarter deliberately changes nothing.
- **A drop on the faction sheet lands on the tab that is showing.** An actor
  dropped while Standing is up opens the Record-standing prompt for that actor
  and enrols nobody; on any other tab it joins the membership. Click the
  Members tab (`[data-action="tab"][data-tab="members"]`) before scripting an
  enrolment. A FACTION dropped while Relations is up opens a relation at
  neutral, while Standing is up opens the prompt about that organisation, and
  anywhere else becomes the parent. A PLACE takes the seat when it lands on the
  seat row (`[data-drop-zone="seat"]`) or when there is no seat yet, and joins
  the holdings otherwise — so seat the faction first, then drop the second
  location to see a holding. The leader row (`[data-drop-zone="leader"]`) takes
  a leader.
- **The relation and holding row controls carry no form `name`.** They are
  `[data-row-field="relations.stance"]`, `"relations.note"` and
  `"holdings.note"`, and they answer to a `change` event, not to a form submit
  — a scripted edit must set `.value` and dispatch `new Event("change", {bubbles: true})`
  rather than submitting the sheet. They render for a GM only; an owner-player
  reads them.
- **A relation is directed, so both sides need writing.** `setRelation(faction,
  other, {stance, note, hidden})` writes one side;
  `regardedByFactions(faction)` is the other side's view and is derived, so it
  appears on the first sheet the moment the second one is written. The
  `acksExtras.factionRelationsChanged` hook carries the faction's **uuid** in
  `faction` and no row.
- **The party token's size and the parking move** that a measured drag needs
  are in `docs/formation/TESTING.md` (The city): a scripted first drag from a
  cell corner is short by the token's own offset and completes no turn.
- **The reception rows are readable without the dialog**: open the roller
  with `acksExtras.influence.open(actor, {targetActor})` and read
  `app._prepareContext({})` — the faction rows are in the external rows with
  their labels — then finish with one real roll.
- **Availability with the knob at 0 is the default**; set
  `standingPerClassStep` to a number in the settings UI to see a shift, and
  set it back to 0 (the fixture is the setting's value — restore it).

## Steps

1. **Create the watch faction**, set its kind to `watch`, and on Overview
   pick the district in the Controls picker and press **Control**.
   *Observable:* the district is listed under Controls and leaves the picker;
   `factionsControlling(uuid)` returns the faction; × takes it off again.
2. **Record a wanted row** for the party actor. *Observable:* the Standing
   tab shows the row with its source, the party's name and today's day; the
   header tag says 1 wanted.
3. **Leave the city and enter it again** (the tracker's city button, twice)
   with the party inside the district. *Observable:* the first press reads
   `delve` and the second `settlement`; the tracker's Hunted here is ticked
   and reads "— by <watch>"; `travelOf(formation).settlement.huntedBy` is the
   faction's uuid and `huntRegion` the district's.
4. **Tick a city turn.** *Observable:* the card's wanted line names the
   faction; the district's hunted table is the one drawn, when the district
   has one.
5. **Untick Hunted here** as the Judge and tick a turn in the same quarter.
   *Observable:* it stays unticked — the ledger is not asked again until the
   quarter changes.
6. **Move the party into a district nobody hunts in**, then back.
   *Observable:* across the edge `huntRegion` is the new district,
   `huntedBy` clears and the flag keeps the Judge's last word; back across
   it the ledger is asked again and the watch is named again.
7. **Record a favour row** (+2, `favour`) on the guild toward the party, and
   roster the target character on the guild. **Open the reaction roller** from
   the rolling character against the target. *Observable:* an external row
   "Standing with <guild>: +2" beside the district row; the watch, whose
   standing toward the party is 0, is absent. Roll once; the card carries the
   row.
8. **Roster the rolling character on the watch** and open the roller again
   inside the district. *Observable:* a "Legal authority here: <watch>" note
   in the dialog's external rows with no figure beside it; the posted card's
   list of modifiers leaves it out and the total is unmoved by it.
9. **Join as the Player seat** and open the guild's sheet. *Observable:* the
   Standing tab is read-only and the notes tab has no Judge's notes; a member
   row marked hidden is absent.
9a. **Open a relation.** On the guild's **Relations** tab, pick the syndicate
   in the picker and press **Add**, then set the stance to `hostile` and type
   a note. *Observable:* the row keeps the stance across a re-render and
   `system.relations` holds one row with the note; the picker no longer offers
   the syndicate, and a second drop of the same faction adds nothing. Drag the
   watch onto the tab. *Observable:* a second row, at `neutral`.
9b. **Write the other side.** On the syndicate's sheet open a row about the
   guild at `friendly`. *Observable:* the guild's **How others regard it**
   section names the syndicate as friendly while its own row still reads
   hostile — the two sides disagree and neither overwrote the other.
9c. **The reception says the stance and adds nothing.** Roster the target
   character on the syndicate and the rolling character on the guild, then open
   the roller. *Observable:* an external row "<Syndicate> regards <Guild> as
   Friendly" with no figure beside it; the posted card leaves it out and the
   total is unmoved. Set the syndicate's row to `neutral`. *Observable:* the
   row is gone from the dialog entirely.
9d. **A faction ledger row reaches a member's roll.** On the syndicate, press
   **Record standing**, choose **An organisation**, pick the guild and record
   −3. Open the reception again from the same rolling character (a guildsman)
   against the same target. *Observable:* "Standing with <Syndicate>: −3" among
   the external rows, and the same figure from
   `acksExtras.factions.standingFor(syndicate, acksExtras.factions.subjectsOfActor(roller))`.
   Take the rolling character off the guild's roster and open the roller again.
   *Observable:* the row is gone — the row reached them through the guild, not
   through their own name.
9e. **Holdings on both sheets.** With the guild seated, drop the second
   location onto its Overview. *Observable:* it appears under **Places**, not
   as the seat; a note typed on the row survives a re-render. Open that
   location's own sheet. *Observable:* an **Organisations here** section naming
   the guild as holding this place; the guild's seat location names it as
   seated here, and a location inside the watch's district names the watch as
   controlling this quarter.
9f. **Hidden rows on a Player seat.** Mark the guild's relation about the
   syndicate hidden, and the holding hidden, then join as the Player seat with
   ownership of the guild and of the holding's location. *Observable:* neither
   the relation row nor the holding is on the faction sheet, the location's
   **Organisations here** does not name the guild, and the reception dialog
   rolled from that seat carries no relation note for it. As the Judge, all
   three are there.
10. **Set `standingPerClassStep` to 1**, seat the guild at the market
    location, and open the location's hiring with the employer the party's
    character. *Observable:* with the guild's +2 and a step of 1 the market
    is two classes larger than the sheet's own for the party's character and
    exactly the sheet's for a stranger; at 0 it is exactly the sheet's for
    everyone (`acksExtras.factions.marketClassShift(location, employer)` is
    the shift on its own).
11. **Add a rarity override** (class `mage`, tier `common`) on the location's
    GM Settings and run a directed class search for a mage. *Observable:* the
    pool rolls on the common expression, whatever the table variant says.
12. **Set a rank marker** — an item named `Rank: 3 (Baron)` on the rolling
    character and `Rank: 1 (Knight)` on the target — and open Seduction.
    *Observable:* the social status row is pre-filled with 2.
13. **Connect AX3 and run the organisations step** of the getting-started
    chain. *Observable:* four factions on the book's Factions shelf, each
    seated in its quarter's place (the city's for the company), with the
    group's imported people on the roster; a second run reports them held and
    rosters nobody twice.

## Teardown

Delete by the run's own ids: the factions (the syndicate with them), the
locations (the holding with them), the characters, the scene (its Region goes
with it), the imported factions and the district places the import made.
Relations and holdings are rows on the factions, so they go when the factions
do — nothing is left on a document this run did not create. Quote
`api.sweepTracked()`'s result. Restore the setting to 0.
