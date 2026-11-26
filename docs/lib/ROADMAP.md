# Lib — not built

Re-issued 2026-11-14.

## A record's parts, not yet read

- **Perception's hiding test reads grants.** `hasCapability` reads ability items
  only, so a bearer a record grants a proficiency to is not found by
  `perception.mjs`; `recordParts(actor, "grant")` is the reader to call.
- **Attack damage reads only the base damage's `extraordinary` mark** (`attack-apply`),
  so a rider row's quality does not reach a weapon's defenses check (inferred
  from a read of the file, not walked).

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

## What the org chart's officer drop does not do yet

- **A replaced officer who is also the faction's leader.** A drop or a press on a row's officer line
  replaces only the group's officer; where that actor is also the faction's `leaderUuid`, the field keeps
  naming it until Clear on the faction's leader line releases it.

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
- **The Judge's override on every surface.** The repo's rule for automation
  (DECISIONS 2026-11-14, "Where the automation would refuse, a player is
  blocked and a Judge is warned") is built on a market's payments, its changer,
  the fee that opens a recruiting post, a hire's signing bonus and a deposit at
  a place out of reach. What remains is the list of surfaces that still block a
  Judge, which no census has made: each refusal in `scripts/` that a Judge's
  seat can reach is read against the rule, and one that blocks is changed to a
  warning that says what it would have refused.

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
- **A damage type pick, and the printed rounding.** The tool's amounts are
  untyped and it still rounds up as the system does, where a spell's and a
  weapon's amount round half to the even whole. Its multiplier is the Judge's
  way to apply a defense by hand. A type pick would send the row through
  `defenseStage` and one rounding.

## What damage against defenses does not do yet

The procedure is built ([MODEL.md](MODEL.md), "Damage against defenses"). Not
built:

- **A weapon Apply a player can press.** Only a Judge presses, as in the
  system. A player's press would go through a relay the Judge's client
  re-checks, as a cast's does.
- **Quality per type within one band.** A band holds one quality flag for all
  its types, so a defense that is mundane-only against one type and absolute
  against another is two bands or the Judge's.
- **The incorporeal-weapon rule.** Which weapons hurt an incorporeal creature
  is not read.
- **Spell records as defense sources.** A defense a spell grants lives on the
  record the cast writes, and `actorDefenses` reads only the stat block and
  owned items.
- **Magic resistance.** A creature's resistance to magic as such is not read.
- **Core's sheet save.** A save rolled from the system's sheet gets no defense
  part, because the sheet knows nothing of what is resisted; the notice is the
  Judge's cue.
- **Effect and condition bands.** A band's `effects` and `conditions` act on
  the grant path, not on damage, and are not read here.
- **A silvered stack of ammunition.** Only core's `special.silver` meets a
  silver flaw, and ammunition has none; the work is in
  `docs/equipment/ROADMAP.md`, "Silver ammunition reaches the attack stamp".

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

## What daylight from a magic light does not do yet

A magic light can state a daylight radius (`MAGIC_LIGHT_BANDS`), and the
`light` roll gate reads the level on the attack throw (MODEL, "The light level
at a point"). Not yet:

- **Other throws under the light gate.** Saving throws, proficiency throws and
  morale do not read a `light` gate; an MM entry prints its penalty on all
  three, and only its attack throw row is imported.
- **An ambient light's daylight band.** A placed light stores only bright and
  dim, so only a token whose actor sheds a magic daylight radius, or the sky,
  makes daylight.
- **"Clear" weather.** A penalty printed for clear daylight is read as any
  daylight; the weather is not consulted.
- **Walls.** The level is read straight-line, as every light reader is.
- **Daylight's other consequences.** Dormancy, helplessness, destruction and
  being barred from a lit area (MM ch. 4's special-ability list) are not
  automated.
- **The sheet's throw.** A light-gated penalty shows on the attack dialog and
  card, never on the sheet's standing throw.
- **A darkness that steps light down.** The reverse of a light spell lowers
  each level by its own rule, daylight included (RR ch. 5). A darkness source
  is read only as `negative`, which sheds nothing.
- **What the token draws.** Foundry has two radii, so the token draws a
  daylight band as bright light; nothing on the canvas marks it.

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
- **Concentration.** Attacking, other actions and movement do not end it, and
  a cast the module does not run ends nothing.
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
- **A waiver on a character who holds the condition directly is not applied.**
  The system folds a condition's `ac.mod` step into a character's `ac.value`
  itself, so the Armor Class waiver reaches a monster's directly held condition
  and a condition that rides on a waived state's own effect (Foundry's implicit
  statuses), and a character's own is suffered. No ability writes the
  waiver for a character today. The route if one does is a second refusal in
  the wrap of `shouldApplyChange` that carries `countsOnce`
  (`status-effects.mjs`): drop the waived condition's `system.ac.mod` change
  from an effect of that actor, as Foundry prepares it.
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

## Magic's turn-end detection is its own

`magic/cast-declare.mjs` `turnEnded(prior, current)` and its `combatTurnChange` listener
decide that a turn ended, a second owner of the reading `turn-life.mjs` `turnEdges`
and `acksExtras.turnEnded` now give (MODEL.md, "Turn hooks"). Not built: the
declaration's lapse listens to the hook and the local predicate goes, so the tracker's
rounds that open before initiative is rolled are read once.

## What System style does not hand back yet

System style (the client `look` set to `core`) moves every ACKS colour and
face onto Foundry's own, and TESTING ("The UI preset and its prompt", step 6)
walks what holds. Players who asked for sheets that look like Foundry's
default still find what follows. Each item changes what a user sees, so each
starts with `/design`.

- **Buttons, table heads and gold.** `.acks-btn` and `.acks-table` carry no
  `.acks-ui` scope, so they keep their own fills in place of
  Foundry's. The gold tokens and the text colours drawn on burgundy are not
  re-pointed at Foundry's variables (`vendor/acks-design/foundry.css` §8).
  Foundry declares its `--button-*` variables only on `a.button`, `button`
  and `kbd`, so an `<a class="acks-btn">` needs a fallback of its own.
- **The frame's layout.** The band in the header, the portrait rails and the
  design canvas's measured sizes (`styles/lib-frame.css`) hold under every
  look. System style changes their colours and faces, not their shape.
- **A player's own choice of sheets.** Which sheet a document type opens on is
  the world's `uiPreset`, which the Judge sets. A player can choose their own
  look but cannot choose the system's sheets for their seat alone. The ladder
  already writes its defaults into each client's memory
  (`scripts/lib/ui-preset.mjs`), so a client setting could pick the rung for
  its seat. A Judge's pin on a type, a document's own sheet choice and the
  sub-types only this module draws would still outrank it, and a new setting
  makes it a minor.
- **Foundry's own Font Size setting.** It sets only `html { font-size }`, so
  this module's text follows `--acks-fs-base` and not core's knob. Whether
  System style should follow core's knob is not ruled.

- **The cast engine's recurring prompt may move onto the carrier's lib card.** The cast card, its recurring prompts and Undo are spell-bound and walked, and the carrier (`item-run.mjs`) builds a second prompt, relay and apply loop over lib's `roll-card.mjs` and `sockets.mjs`. Folding the cast's non-spell-bound half onto the carrier's card would leave one loop; it is a refactor of a shipped surface with its own walk and is not scheduled.
- **A standing part's parts from a row.** `standingPartRecordData` builds the record under its kind's fixed id, and `handleReachMoment` takes it off at an exit; turning a row's modifier rows into the part's `rollMods` parts, and writing it on an `on`, comes with the first item that carries one.

## The system's blank alternate

The weapon model gives `damage.alternate.formula` the damage field's default die,
and `scripts/lib/patches/weapon-alternate.mjs` blanks it until the system does.
Delete the patch, its install in `scripts/lib/module.mjs`, its README row and
`tools/test-weapon-alternate.mjs` once the system minimum names a release whose
schema starts the alternate blank, and re-walk the two-handed die steps of
`docs/lib/TESTING.md` without it.

## The system's group control

`AcksCombat#manageGroup` hands every stored group the lowest initiative value of the tokens
of the latest call, and returns nothing to wait on. `scripts/lib/patches/group-initiative.mjs`
corrects the first and returns the write for the second. Delete the patch, its install in
`scripts/lib/module.mjs`, its README row and `tools/test-group-initiative.mjs` once the
system minimum names a release that carries both fixes. `groupGangs` keeps its await. Re-walk the group-initiative recipe of
`docs/lib/TESTING.md` without it.

## The system's welcome-version write

`displayWelcomeMessage` stores the system version in the world setting
`acks.welcomeMessageVersion` from every seat, and a Player's write is refused.
`scripts/lib/patches/welcome-version.mjs` answers it from a seat without the
settings permission. Delete the patch, its install in `scripts/lib/module.mjs`, its
README row and `tools/test-welcome-version.mjs` once the system minimum names a release
that guards its own write, and re-walk the welcome-version recipe of
`docs/lib/TESTING.md` without it.

## Circumstances named by the cast engine

A save part narrowed to a circumstance (`when`, with `magical`) is applied only where a caller of `saveSpec`, `saveModParts` or `sheetSaveShift` names the circumstance through `circumstances`, and no caller does: every call passes at most `damage`. So a narrowed part is told on every throw and never added. A spell whose row says what a throw resists (a fear effect) names its circumstance, and the cast engine passes it to `saveSpec` for each saver. Conditions' own `row("save", "all", {when: "fear"})` rows are told the same way and wait on the same caller.

## One home for live figures

A reach's live figures sit in three places: `reach.radius`, `reach.save`, `reach.immunity` and `reach.modifier` (a `figureRefField` each, read only by a pulse); the row's own stated `value`, which the cast engine reads; and the activation's `throw`, `fumble`, `fuseDice` and `uses`. Each has one reader today. Merge them into one group a Judge edits in one place, with one resolver, once a second reader of any of them appears.

## The system's abandoned combat start

`AcksCombat#internalStartCombat` sets `flags.acks.initDone` before the declaration
prompt and leaves it, with the matrix's Surprised statuses, when the prompt is
cancelled. `scripts/lib/patches/combat-start.mjs` unsets the flag and lifts the
statuses after a cancel, and before a Begin Combat that meets an abandoned start.
Delete the patch, its install in `scripts/lib/module.mjs`, its README row and
`tools/test-combat-start.mjs` once the system minimum names a release whose method
undoes its own flag and its matrix's statuses on a cancel, and re-walk "A cancelled
declaration" in `docs/lib/TESTING.md` without it.

## A fuse item's sheet row

A fuse item is lit from the item's use (`Item#use`, so the hotbar and a sheet's use control) and nothing on a sheet row says it is lit. The words and the reader exist and nothing draws them: the press `ACKS-LIB.itemRun.press.light`, the tag `ACKS-LIB.itemRun.strip.tag.lit` ("Lit · n rounds left") and `litStateOf(effects, itemUuid)` on lib's `itemRun` api, which answers `{roundsLeft, combat, dueAt}` or null. To wire: the monster sheet's inventory row and the character sheet's gear row (the S8b-2 lane, with the other sheet-row presses of the item carrier), a Light press that calls the item's use and the tag read from the actor's effects. A fuse lit on the world clock answers `roundsLeft` null and a `dueAt`, which the tag's words do not yet cover.

## One clock advance per round of a fight

In a fight that holds no deployed party the world clock does not move: core 14's `CONFIG.time.turnTime` and `roundTime` are 0, and the system's tracker passes its advance under an option name core 14's server does not read. Every record lib ends on the clock therefore runs long by the length of such a fight: an item run's turn-timed condition and immunity window (`dueAt`, T-0848), on-hit delayed damage, and a fuse lit outside a fight. A fight with a deployed party is unaffected, since formation advances the clock per round itself.

Not built: one lib-owned advance per round for every fight. It has to take over formation's own advance, or the clock moves twice a round, and it reverses two standing rulings (lib DECISIONS 2026-11-17, turn-timed records lift on the subject's own turns; magic's "the world clock does not move while a fight runs"). It also makes every world-clock listener fire each round of a plain fight, in formation, henchmen, magic and the open sheets, so it waits on the clock listeners being measured (T-0870). The narrower fix that was set aside for it: a per-turn count written beside `dueAt` on each record, at one flag write per subject turn.

## What a temporary ally does not do yet

- **A secretly hostile member.** A hostility only the Judge knows is not read by the party sheet's warning, which reads what every seat sees. Who is told, and how, is undecided.
- **A creature bound by hand.** A creature with a summoner flag and no cast record can join a party through an actor drop and is not read as temporary, so a hostile reading of it is warned of as of a person and its control never ends.
- **A temporary ally with no spell behind it.** A creature that is on loan and not conjured (the owner: "not just conjures, could even be nonmagical") has no record the module can read, so it never leaves the party when it turns hostile. A mark a Judge sets on a member is the open design, and `isTemporaryAlly` is where it would be read.
