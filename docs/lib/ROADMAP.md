# Lib — not built

Re-issued 2026-11-14.

## Behavioral dedups awaiting a hygiene sweep

What remains changes behavior or needs design, so it ships through a
dedicated `/acks-hygiene-sweep` with live verification, not as drive-by
edits:

- **A lib dialog helper.** Raw `DialogV2` in 64 files under `scripts/` and
  many separate `openXDialog` functions; the loudest missing primitive. Needs a design pass
  over the confirm/prompt/form shapes actually in use (and DialogV2's
  attribute-stripping hazard baked in once).
- **`classLevel`/`abilityMod` bypasses.** ~25 inline reads with drifting
  fallbacks (`?? 0` vs `?? 1` vs `Math.max(1, …)`) — each replacement must
  decide which fallback was load-bearing.
- **`collectEffectModifiers` merge.** equipment and henchmen export same-named
  same-shape collectors over `lib/effect-scan.mjs`; the divergence is
  documented as deliberate in effect-scan's header — merging needs that
  ruling revisited, not silently overridden.
- **Chat cards onto `roll-card.mjs`.** Direct `ChatMessage.create` in 49
  files under `scripts/`; henchmen has a parallel card layer.
- **The band copies onto `header-band.mjs`.** The item sheet and the party
  sheet each move their band into the header with a private copy of
  `moveBandIntoHeader`; the frame and the domain sheet are the helper's
  callers. Each move is a live check of that sheet's header (drag, double
  click, the band's own fields).
- **The domain and party sheets onto the frame.** Each draws a band, rails
  and tabs with a vocabulary of its own (`acks-extras-domain-sheet__*`,
  `acks-extras-party-sheet__*`) beside the frame's (MODEL.md, "The sheet
  frame"). Each move replaces that sheet's copy with the frame's partials and
  `FrameMixin`, and is a live check of the whole window.
- **Settings registration convention.** Three competing styles (dedicated
  settings.mjs / feature module.mjs / arbitrary file); pick one, document it,
  move the strays.

## What coin does not do yet

- **A reach chosen for one payment.** A payment's reach is stated by the
  transaction's own code or by the world setting. No dialog offers the payer
  "from what I carry" or "from this place" for a single payment.
- **A ranking of every store.** A coin order names the one store drawn on
  first and the one store arrivals land in. The rest follow the standing
  order, which a holder cannot rearrange.
- **Coin on the road.** The reach rule makes carrying coin to a market
  necessary. Nothing prices or endangers the carrying; that is played at the
  table.
- **The Judge's override on every surface.** A market's payments, its changer
  and the fee that opens a recruiting post pass `judge`. A hire's signing
  bonus paid to the till, and the deposit controls of the Storage tab and the
  Equipment tab, still answer the Judge as they answer a player.

## What the repair tool only reports

- **Coin on a document the world cannot load.** `lib.strandedCoin` lists it
  and writes nothing. Its fix mints coin from a document it cannot read back,
  so it waits for a scratch world, where no create-and-destroy fixture in the
  shared test world can hold such a document. Designed: the coin credited to
  an actor the Judge picks, with the fixed keys kept in a hidden
  `repairLedger` world setting so that a rescan cannot mint the coin twice
  (the unloadable actor cannot record that it was emptied), and a per-check
  forget.
- **Vaults and stored goods whose owner is gone.** `location.orphanVaults`
  points at the place's Storage tab. A fix that moves them to an actor the
  Judge picks is the same picker the coin fix wants.
- **Goods and coin on an actor whose sheet lists none.** Freight dragged out
  of a hold onto an organisation is handed to it, as coin is. No check lists
  either.
- **More checks.** Class-training effects whose class uuid no longer resolves:
  they refuse hand-deletion, and `resetTraining` returns false for them.

## Printed values still in lib's source

Each moves onto the import the way `acks-printed-value` describes: the importer
reads it from the Judge's own copy, a Judge can edit it, and with nothing
imported the field stays blank with the page as its tooltip.

- **A leader's command capacity.** `platoonCapacity` in
  `scripts/lib/group-logic.mjs` (RR p. 169) is a ladder of rungs by the
  commander's level in code, and `troopStrength` in `lib/data/group-data.mjs`
  and the Hire as Group path in `henchmen/engine/hire-group.mjs` read it. The
  first-level rung is an interpretation, not a printed figure (DECISIONS, "The
  squad command-capacity figure is an interpretation, not a printed number"),
  so the import's reading of the page decides it.
- **A slot's capacity and a container's access.** The `ring` entry of
  `WEAR_SLOTS` and `ACCESS_COSTS` in `scripts/lib/vocab.mjs` (RR pp. 293–294
  for the access kinds), and which carriers are free against an action in
  `scripts/equipment/config.mjs`. `ACCESS_COSTS` is also a table of options a
  reader picks from, so it is registered rather than shipped. The ring figure
  is printed on JJ p. 144 as well as in the Treasure Tome.
- **An attack throw that is not there shows a figure.** Four readers fall back
  to a literal when an actor's attack throw is not a number: the monster
  statblock's attacks group and the monster sheet's rail
  (`monsters/statblock.mjs`, `monsters/monster-sheet.mjs`), the character
  sheet's Stats tab (`character-sheet/tabs/stats.mjs`) and the follower card
  (`lib/follower-card.mjs`). The literal is one row of the attack throw column
  (RR p. 296). No read is needed: each shows nothing where the field holds no
  number.
- **The progression shorthand still drives one effect.** `PROGRESSION_LEVELS`
  in `scripts/lib/vocab.mjs` is kept only to decode stored values (abilities
  DECISIONS, 2026-08-30), and the `progressionAs` effect still takes it as its
  vocabulary: the schema in `lib/fields.mjs`, the picker in
  `lib/apps/effect-row-editor.mjs` and the scan in `importer/executor.mjs`.

## What the carry does not do for a token

An unlinked token is found as a rider, a passenger or a draft animal
([MODEL.md](MODEL.md), "Carrying"). Not built:

- **A carrier that is an unlinked token.** Deleting a world carrier frees
  whoever was attached to it. Deleting a token that carried someone leaves
  their binding naming a uuid that is gone: it reads as unattached, and
  nothing clears it. A formation recall deletes tokens too, so a cleanup has
  to tell a recall from a removal.
- **A token rider through a recall.** Whether a member recalled into the party
  token and deployed again keeps its delta, and so its binding, is not
  checked.
- **Snapshots.** `snapshotArrangement` records world actors only.
- **The repair tool.** `lib.attachments` lists world actors whose carrier is
  gone, and no token.

## What the hit-point tool does not do

- **Nonlethal damage.** Stop at 0 holds damage at 0, and nothing records which
  damage was nonlethal or lets it heal on its own schedule.
- **An undo that outlives the window.** Undo covers the last change while the
  window is open, and restores values without checking whether anything else
  changed them since.

## Who carries `acks`, and whether that is deliberate

Five surfaces do — the two item sheets (abilities, equipment), the roll editor,
the door app and the follower card — against roughly forty that carry
`acks-ui acks-extras` alone. The sheet theme's field rule is written
`body.acks-lib-sheet-theme .acks .window-content input:not([type="checkbox"])`,
so it dresses core's windows and those five; everywhere else a field takes
Foundry's default chrome inside an ACKS-dressed frame.

**A surface is exposed to that rule exactly when it carries `acks`** — the
cheap test, and the reason the group and template sheets were never in the
fight the follower card lost.

Whether the split is intended has never been ruled. It is not a defect to fix
blind: adding `acks` to a window opts it into every core `.acks` rule at once,
not just the field dressing, so the answer needs a live read of what each
surface would inherit.

## Night Vision reaches through walls

`brightestLightReaching` measures straight-line distance from every lit source to
the token, so a torch on the far side of a closed door counts as reaching it. A
night-eyed creature therefore sees twice a light it could not actually see by.

Resolving it needs real occlusion — `CONFIG.Canvas.polygonBackends.sight`, or a
`ClockwiseSweepPolygon` per candidate source — and that needs the live canvas.
The pass has to answer for every scene in the world, including the ones nobody
has open, so it cannot depend on one being drawn.

What that needs: a split between the sweep (geometry only, every scene) and the
active scene (which may test line of sight), plus a decision about which answer a
token on an undrawn scene should carry in the meantime.

## What a coarse scene does to a small light

A radius is rounded to the step the token stores (0.01 of the scene's unit), so a
lantern on a scene measured in miles lights a circle of 0.01 mile and a candle on
a kilometre grid lights nothing. That is the stored resolution, not a rounding
choice. A scene that wants a small light visible at that scale would need the
light drawn at a floor or by another means, and nothing here decides which.

## Events no window handled during a hand-over

A seat's lead that crashes, loses its network or sleeps leaves the seat with
no automation until a follower claims (MODEL.md, "Which window automates").
That takes up to 20 s, and longer while the follower's tab is throttled. An
event in that gap is handled by no window. So is one the server relays
between a claim's send and its relay once the old lead is gone. Hooks fire
once per window and nothing replays them. A queue kept by one window (the
formation's movement queue) does not move with the lead either. Not built: a
new lead reconciling what a gap could have dropped, writer by writer.

## What the turn order does not do yet

- **A Judge control to choose the order within a tied side.** Tied combatants of one
  side sort by combatant id, which is stable and arbitrary. The book lets a side pick
  its own order, so the Judge wants a way to drag or nudge a tied combatant ahead of
  its peers, stored on the combatant and read by the same comparator.

## What the conditions do not do yet

The catalogue lists every condition of RR 507-515 and the states of a round
(RR 291-303), and `status-effects.mjs` applies the rows a roll can see. The
rest of each entry is not automated:

- **Rows that wait on a circumstance.** A save against fear, a throw that
  needs sight or hearing, and a save against the source of a condition are
  told to the roller with their figure and not applied. The roll dialog could
  offer each as a tick-box.
- **Damage over time and ability drain.** Burning and Vexed deal nothing on
  their own; Dehydrated, Starving and Hypothermic are driven by `survival.mjs`
  for a marching order and by nothing for a token marked by hand.
- **Size.** Enlarged and Shrunk do not change a creature's size category, its
  extra damage dice, its carrying capacity or its Armor Class. Shrunk's
  halved damage applies to every attack, not only physical ones.
- **Concentration.** Nothing ends a concentrating creature's spell when it is
  struck or moves.
- **Escapes and spell failure.** No throw is offered to slip a hold, and a
  condition that forbids casting only warns on an attack.
- **Monster speed.** The speed share reaches a character's derived speeds
  through `_calculateMovement`; a monster's speed is a stored field and is
  left alone.
- **Core's cards.** A save, an adventuring throw, a morale roll and a surprise
  roll carry the figure in the target or the modifier and name it only in a
  notification.
- **Implied statuses are not on the token.** A slumbering creature is blinded
  for the math, and for the senses' deafness check, but Foundry's own vision
  is blinded only by the Blinded status itself.
- **The Armor Class readout.** `acMath` exists for a sheet to show a
  conditioned AC; no sheet calls it.
- **The states of a round are set by hand.** Nothing marks a combatant
  Defending, Retreating or Withdrawing from a declaration, and the system's
  declared spell (a combatant flag) is not read as Casting.
- **A forced move is not told from a made one.** A token moved while another
  combatant acts costs its Readied, whoever moved it and why. The arrow keys
  and a move undone are covered by the suite and have not been driven in a
  world.
- **A state marked late is its marker's.** A Defending marked on its own
  bearer during another combatant's turn is read as given by that combatant.
  Nothing lets the Judge say otherwise short of marking it on the bearer's
  turn.
- **A round nobody finishes rolling** begins when the Judge moves the tracker
  on, and its first combatant's states end one turn late. A reload of the
  lifting client between a round's opening and its roll forgets that the
  round had not begun.
- **Running does not bring Disordered.** It is a state beside the catalogue
  and carries nothing.
- **Cover is one grade or the other, by hand.** Nothing reads it from the
  scene, and a proficiency that discounts it is not applied.
- **A flank or a rear read from token facing.** The Flanked status
  (`scripts/lib/conditions.mjs`) marks a token and adds no bonus of its own:
  the bonus for attacking a flanked creature is the system's. The side an
  attacker stands on is picked in the system's attack dialog and is not read
  from the two tokens' positions and rotations on the canvas. Not built: that
  read, which would use the token rotation the formation heading already
  reads, and a ruling on which sides count as a flank and which as a rear.

## Active Effects on Foundry v14's model

Nothing here is built. The notes below were checked against the installed
core's source (14.367) and are the record the work starts from; the claims
marked *not run* were read, not exercised in a world.

What the module does today, and what v14 offers in its place:

- **Expiry.** `status-effects.mjs` lifts `ends: "turn"` and `ends: "combat"`
  conditions from `combatTurnChange` and `deleteCombat`. v14 has a registry
  (`ActiveEffect.registry.refresh(event, {combat, actors})`) and a
  `duration.expiry` event per effect. Three things stand in the way of a
  straight move: the default `CONFIG.ActiveEffect.expiryAction` is `"update"`,
  which marks the effect `duration.expired` and leaves it on the actor, where
  the HUD, `toggleStatusEffect` and the system's `hasEffect` still find it; a
  turn event is anchored on `start.combatant`, the combatant acting when the
  effect was made, not its bearer; and outside combat any advance of world
  time expires an effect whose expiry is a combat event.
- **Legacy shapes still written.** `duration: { rounds: 1 }` in the character
  sheet's effect-create action; `effect.update({changes})` in
  `classes/training.mjs` and `lib/actor-compat.mjs` (two each) and
  `tools/pack-data/cleanup.mjs`. Core migrates each on the way in (*not
  run*); `effect.changes` reads go through core's getter. `effect-scan.mjs`
  already reads `system.changes` with string `type`s.
- **A per-actor clock** cannot drive a finite duration as core ships it:
  "duration reached" is computed from world time, so it needs an override of
  the effect's duration preparation or its expiry test.

Checked, for whoever takes it up: changes live at `system.changes`; `mode` is
a string `type` (`custom`, `multiply`, `add`, `subtract`, `downgrade`,
`upgrade`, `override`) with a numeric shim until v16; a change has a `phase`
(`initial` or `final`, more by registration, and a phase nobody applies never
applies); `duration` is `{value, units, expiry, expired}` beside a separate
`start`; a change value's `@path` is substituted from roll data, and
arithmetic on the result is *not confirmed*; a change key prefixed `token.`
reaches the token document (there is no `tokenOverrides` field); core's
effect sheet saves on submit only. No pack in this repo holds an effect.

## A window title cuts what rises above a capital

On an `acks-ui` root the title is one line of `line-height: 1`
(`vendor/acks-design/foundry.css` § 2) inside a box core gives
`overflow: hidden`, so the box is one em tall and clips at its own edges. At
the default type size an accent over a capital loses its top 2px and a
descender half a pixel. The header is not what cuts them. Core's own title
takes the header's height as its line height and loses nothing. A taller line
changes the title's box on every window, and wants its own before-and-after
reading (TESTING, "A long window title stays on one line").

## What Automated Animations does not hear yet

The listener sees only what passes `aa.getRequiredData` (MODEL, "Automated
Animations"). Three things do not:

- **A status effect on a hidden token** plays, and shows where the token stands.
  `AutomatedAnimations-WorkflowStart` carries `stopWorkflow` and fires for that
  path too, so the stop could move there; nothing has tried it.
- **An attack with no item** plays nothing, having no name to match. The
  post-attack hook could call `AutomatedAnimations.playAnimation`, with a row name
  in place of an item, but it holds no message id for the dice wait.
- **A template row** plays on the scene's last region. Read from the source, not
  walked: no system spell places a region for the module to name.

## A creature that is bought, kept, trained and ridden

A mount is reached by four records and none is whole: a priced livestock row
is an item; an `acks-extras.animal` states training and mountability and
takes its stat block from the schema's defaults; a `monster` carries the stat
block and its load and has nowhere to state training; and who keeps it is a
hireling record, a companion record, or nothing. The direction is ruled
([DECISIONS.md](DECISIONS.md), "A mount is a role a creature holds") and none
of it is built.

First, with no stored document changing shape:

- **One statement of training and mountability for any creature**, on the
  extras flag beside `extras.load`. They sit on the animal sub-type alone.
- **One answer to "is this a creature"**, from the same facade. The question
  is a closed type test in several features, and the animal sub-type fails
  them. Read from source, not walked: an animal hired through the roster is
  sent to the system's hire, which takes characters only.
- **A keeper.** Nothing says a bought animal is anyone's. The relation sits
  on the kept creature, and a henchman and a companion are answered from the
  records they have.
- **An animal's stat block at import.** The importer mints the animal with
  its shop facts; the monster of the same kind holds the block.
- **A bought animal that becomes an actor** when its item is dropped on a
  character.
- **A control on the creature's own sheet** that seats a rider or a
  passenger. The binding is made from the rider's sheet alone.
- **Goods between a keeper and what they keep**, moved. They are moved
  between a rider and the mount they ride; any other two actors keep the
  system's copy.
- **A passenger's weight.** `load6` counts one rider.

Not ruled: whether a led animal is a member of the formation, holds an attach
role of its own, or is only listed, and so what it does to pace.

After that, each a change to documents a world has stored:

- **The end of the `acks-extras.animal` type**, decided once every reader
  goes through the facade.
- **A market that delivers the creature** in place of an item.
- **One keeper store**, the henchman's and the companion's records folded
  into it.

### Actors as composed variants

A creature is stated in separate branches: a system type, a module sub-type,
a flag, a hireling record, a companion record. Each restates part of what the
creature is, and the branches now collide, which is where the three documents
for one horse above come from. The direction is to collapse them into
composed variants: one creature made of the parts it has (a stat block,
training, a load, a keeper, a seat), where a rider's mount, a hired monster
and a bought ox are each a combination of parts and none is a branch of its
own. The first steps above move one fact at a time to a single store read
through a facade. Nothing beyond them is designed.
