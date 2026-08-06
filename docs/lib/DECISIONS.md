# Shared library — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

- **2026-07-18 — v0.1 scope is effect/ability primitives only.** Created ahead
  of the full family-refactor Phase 1 to unblock the abilities program (see the
  program memory + template REFACTOR_PLAN.md status note). The plumbing/interop
  contracts stay pending; this lib is additive to that plan, not a divergence.
- **The shared vocabulary has one definition here** (DAMAGE / MOVEMENT / VISION
  / SENSE / NATURAL_WEAPONS / ALIGNMENTS). These began as a value-identical
  mirror of the monster feature's own enums while it was a separate published
  module; that mirror is **resolved** — `monsters/config.mjs` now re-exports
  from `lib/vocab.mjs`, so its consumers keep one import path and no second copy
  exists. `NATURAL_WEAPONS` here is the superset, carrying the monster sheet's
  sting / feeler / envelopment.
- **Foundry-free split:** `vocab.mjs` (enums + resolver) imports in Node so the
  acks-importer cookbook compiler/executor share one definition; `fields.mjs`
  (Foundry field-builders) is lazy so the module still evaluates under Node.

- **Storage lands in the library, keyed on a flag rather than a type**
  (2026-08-01): "goods kept somewhere other than on you" is the primitive under
  markets, banks, base camps and wagons, and the standing promotion rule names
  stash handling as shared machinery. Two consequences were chosen deliberately.
  (1) **Stored goods are real embedded items on the holding actor**, not a
  ledger: an item that has left the character genuinely weighs nothing on them,
  and every existing reader of `actor.items` sees a location's stock without
  being taught anything. (2) **A provider is any actor with
  `flags.acks-extras.storage.provider`** — the library never names a location
  type, so a settlement, a market actor and a future cart are the same
  machinery, and enabling storage on one is a flag write. The UI, the actor type
  and the lifecycle around it belong to the location feature; only the
  primitives are here. Attribution (`ownerUuid`) is a UI convention, not a
  security boundary — the same ruling the equipment feature makes for containers.
- **The template actor is a generator, never a bulk import** (2026-07-24):
  the book statting a creature as tables (dragon: 11 ages x 9 types x 4 body
  forms) is the book saying "make one when you need one". Materializing the
  cross product would be hundreds of near-duplicate actors; the template +
  builder honors the book procedure instead, and a dropped base actor makes
  the same document a modifier (vampire thrall).
- **One token publisher** (2026-08-01): the vendored design-system token file
  (`vendor/acks-design/tokens.css`, `:root` + one `.theme-dark` block) is the
  ONLY place `--acks-*` palette values are declared, and it loads
  unconditionally — inert values style nothing by themselves, and every
  feature ships in the same module, so consumers read tokens BARE
  (`var(--acks-spot)`, no literal fallback; a fallback masks a missing token,
  which is exactly how `--acks-field` shipped undeclared and rendered white
  boxes on dark seats). Before this, sheet-theme.css pinned ~18 token copies at
  body-class specificity, out-specifying the token file's dark block; the
  vendor layer and the follower card each grew counter-shims, and one card
  rendered FOUR ways across sheet-theme x seat combinations (worst pair
  1.1:1). sheet-theme.css now owns only override RULES for system-rendered
  markup, gated by `body.acks-lib-sheet-theme`; the setting stays the
  whole-client escape hatch. Corollaries: SURFACE vs INK discipline everywhere
  (`background:` takes `--acks-burgundy`, `color:`/`border:` take
  `--acks-spot` — they diverge on dark seats); type sizes come off the
  `--acks-fs-*` scale so the `fontScale` client setting (writes
  `--acks-fs-base` inline on the root element, where the scale steps
  substitute) resizes every ACKS surface with one knob.
- **2026-08-03 — Perception rises to lib; `monochromatic`, not `darkvision`.**
  The sense model, the RR light table and the token writes moved out of the
  formation feature (`monster-traits.mjs`, `formation/constants.mjs`,
  `formation-model.canSeeInDark`) because a second sibling needed them: a
  standalone actor has no formation, and its torch and its infravision have to
  work anyway. `capabilities.mjs` came along for the ride — `senses.mjs` needs
  the `kw:lightlessvision` check and lib may not import a feature — with
  `ability-bridge.mjs` re-exporting so no consumer changed.
  - **Ruled:** dark senses render `monochromatic`. Core's `darkvision` remaps
    DIM to BRIGHT, which would let a creature read a scroll in a black
    corridor; both ACKS senses see only "as dim light", and dim light cannot
    discern colours or read (RULES §4). Rejected `darkvision` for that reason
    and `blindness` for inherently blind creatures — that mode models the
    *blinded condition* and renders black, which would cripple a creature that
    navigates perfectly well by echolocation. A blind creature gets its best
    sense range instead, or 30' when its stat block records none.
  - **Cost:** the first sync overwrites a token the GM configured by hand
    before installing this, because a never-stamped token is indistinguishable
    from a stock one. Accepted: the alternative is leaving every monster pack's
    stock 60' dark sight in place, which is the defect. `managedVision` makes
    it a one-time cost — edit the token once and it is yours forever — and
    `manageVision` turns the whole pass off.
  - **Not done:** `detectionModes` are never written. Core derives
    `basicSight` and `lightPerception` from `sight`
    (`client/documents/token.mjs:541`), so writing them would add a field to
    clobber and buy nothing. Terrestrial mechanoreception could plausibly map
    to core's `feelTremor` instead of a sight radius; kept uniform with the
    other dark senses for now, one rule and one answer.
    — **SUPERSEDED 2026-08-03 (below).** "Buys nothing" was wrong: a radius
    without a detection mode makes every sense behave like eyes.

- **2026-08-03 — Every sense gets its own detection mode; `basicSight` off.**
  The entry above modelled all five ACKS senses as a sight radius. That
  silently gave each of them sight's weaknesses and none of its own: a bat's
  echolocation was defeated by invisibility and by a *darkness* spell, tremor
  could not reach through a floor, and Hiding could not beat infravision — all
  four wrong at the table, and none visible in a screenshot.
  - **Ruled:** `DetectionMode.type` carries the rule. Core's `_canDetect`
    defeats only SIGHT with the Blind status and an invisible target, and only
    wall-respecting modes with magical darkness — so SOUND for echolocation and
    shadowy senses, MOVE for mechanoreception, SIGHT for lightless vision.
    Echolocation overrides the darkness bail (core keys it to `walls`, not to
    type: sound does not care how dark it is). Terrestrial mechanoreception
    reuses core's `feelTremor` rather than inventing a twin.
  - **`basicSight` is disabled wherever a real sense replaces it.** This is the
    load-bearing part and was missed until the live check: core derives that
    mode from `sight.range`, and left on it shadows every specific mode, so the
    hiding thief is seen and the invisible one found regardless. Safe because
    the vision source radius reads `sight.range` itself (`Token#sightRange`),
    so environment vision is untouched.
  - **Source conditions resolve in `senses.mjs`, target conditions in
    `_canDetect`.** Suppressing a sense by rewriting the token costs nothing per
    visibility test and keeps `canSeeInDark` agreeing with the canvas. Only what
    depends on the target, or on where the perceiver stands, can't be
    precomputed.
  - **Cost:** two status effects this module now registers (Hiding, Running),
    because core ships neither. Both are toggles — inferring "is running" from
    token movement would fight the GM every time they repositioned someone.
  - **Rejected:** reusing core's `invisible` for hiding (different rule,
    different detection semantics), and inferring Hiding from `token.hidden`
    (that is the GM's "not on the map yet" switch, not a character's action).

### The item taxonomy is declared over core's types, not invented beside them (2026-08-03)

The system's eight Item sub-types share no base, so "wearable" had no home:
`equipped` is declared on `weapon` and `armor` and nowhere else, and Foundry
prunes off-schema keys, so the whole `acks-clothing` pack and every carrying
device in `acks-adventuring-equipment` were unwearable however they were written.
Three RAW rules were silently inert as a result — the adventurer's harness's
stone of relief (RR p. 142), gloves blocking lockpicking (RR p. 145), and the
worn bucket for clothing on the character sheet.

**Ruled: declare the taxonomy over core's types.** A `GearExtras` flag model
(`flags["acks-extras"].gear`) plus one predicate module, mirroring the ruling the
abilities feature made for `AbilityExtras`.

**Rejected: module-owned `gear`/`wearable` Item sub-types.** They would have a
genuine shared base, at these costs — core's `_prepareItems` is a five-bucket
`switch` with no default, so a module sub-type renders **nowhere** on the
character sheet (and the equipment feature's whole technique is moving core's own
rows into wear buckets); `computeEncumbrance` sums `item`/`weapon`/`armor` by
name, so it would weigh nothing; core's inventory template draws the equip toggle
in the weapons and armours sections only; and every existing world, both core
gear packs, the importer and acks-importer produce core types, so adopting them
means a destructive per-document `type` rewrite. That is the "invent" tier for
something the system provides badly rather than not at all.

**Equippable is derived, not tagged.** `slots.length > 0` *is* the tag. A boolean
sitting beside a slot list can disagree with it; one field cannot disagree with
itself. Rations, loot and coin declare no slots and get the wear features
switched off without a flag saying so.

**`declaresSlots` is a third state, and it was needed.** "Declared to sit
nowhere" and "never annotated" both leave `slotsOf` empty, but they must behave
differently: every name-heuristic fallback gates on `declaresSlots`, so a Judge
who sets a Great Helm to sit nowhere is not overruled by its name.

**Cost:** the slot for 143 core pack items is inferred, not read — the books
assign no slots. Accepted deliberately (owner: "a bad guess with a dropdown to
select/correct is fine") because the Treasure Tome makes a slot's only mechanical
job exclusivity, so a wrong guess mis-scopes that and nothing else. The item
sheet's Construction tab carries the correction.

**Deferred, against the original plan:** container `capacity` and the clothing
`layer` were to move into `GearExtras`. They did not. `capacity` belongs with
`locked`/`fragile` in the container record — splitting one coherent record across
two flags would create the duplication rather than remove it — and `layer` has a
single reader and no second copy to collapse. Neither move would have removed a
duplicate; both would have cost a data migration.

### Capacity belongs to gear, not to containers (2026-08-03)

Capacity was deferred out of `GearExtras` a day earlier on the grounds that it
belonged with `locked`/`fragile` in the container record. **That was wrong, and
the reason it was wrong is instructive:** it treated "container" as a kind of
thing rather than as a thing that happens to hold something. Under that model a
coat could carry magical qualities and hidden pockets in its description, and
carry nothing in the fixture — because the module had not annotated it as a
carrying device, and only carrying devices could have a capacity.

Capacity now lives on the gear model and `holdsGear` derives container identity
from it. The container record keeps only the lock's state, which is genuinely
about being a container. Read order is new home then legacy, so 1.2.0 worlds
need no migration.

Owner, same day: **encumbrance is a special case of capacity** — mounts, wagons,
crates and the hands of a team lifting a body all ask the same question, so a
container function is the wrong home going forward. That refactor is a major
release and is scoped in [../ROADMAP.md](../ROADMAP.md); this entry records only
the move off the container record.

### The world clock has one owner, and it is lib (2026-08-04)

`advanceWorldTime` was registered twice under the one module id — by
`formation/module.mjs` and by `henchmen/settings.mjs`, with different names and
different hints. Foundry keeps one entry per (namespace, key), so it was already
a single shared toggle: whichever registration ran last supplied the label, and
one feature's switch was described to the GM in the other feature's words. The
types and defaults happened to agree, so nothing misbehaved — but a change to
either default would have silently applied to both.

**Ruled: one key, owned by lib** (`scripts/world-time.mjs` holds the constant
and the `mayAdvanceWorldTime()` predicate; `lib/module.mjs` registers it). Both
clock writers now read the same predicate instead of the same string. lib owns
it because it already owns the module-wide policies — `manageVision`,
`storageDeletePolicy` — and because there are only two `game.time.advance` calls
in the module and both are gated by this one key.

**Rejected: two distinct keys** (`formation.advanceWorldTime`,
`henchmen.advanceWorldTime`). The step sizes differ — ten minutes a dungeon
turn against seven days a button press — but the question does not: both write
Foundry's one world clock through the same contract, and the reason to say no is
the same reason in both cases, that some other module (Simple Timekeeping, a
calendar) is the clock authority. Splitting the key would have made a GM answer
that twice and let the two answers disagree.

**Cost:** the setting moves out of the Formations group in Configure Settings
and into Library, so a GM who knew where it was has to look somewhere else. The
key string and namespace are unchanged, so existing worlds keep their stored
value and no migration is needed. Three lang strings were retired
(`ACKS-FORMATION.settings.advanceWorldTime.*` and
`ACKS-HENCHMEN.setting.advanceWorldTime*`) for one reconciled pair under
`ACKS-LIB`; a translation carrying the old keys loses them.

### The Follower Card selects fields by schema, never by actor type (2026-08-05)

The card branched on `isMonster` — a strict `type === "monster"` test — at nine
places: class, level/HD, XP, ability grid, speed, encumbrance, attack bonus, the
natural-attack fallback and adventuring throws. Every branch was a two-way choice
between "character" and "everything else", and "everything else" was written
against the monster's field paths.

The module's own `acks-extras.animal` is neither. It took the CHARACTER branch
throughout and was read at paths it does not have: `details.level` (absent),
`details.xp.value` (its XP is a flat number), `movementacks.*`, `scores.*`,
`encumbrance.value6`. An animal hireling in an employer's hirelings grid showed
level 1, 0 XP, speed 0, a blank ability grid and an encumbrance bar for a body
that carries no inventory — all of it plausible-looking and all of it wrong.

**Ruled: no branch in the card may test `actor.type`.** Each displayed value is
selected by whether the actor's data model DECLARES the field it needs
(`actorProvides`, which asks the model's schema and falls back to the value for
fields that only a derived pass creates). A rating the model does not carry is
left out of the card instead of read off another type's path. The editable card
binds its inputs to a `*Path` computed the same way, so an edit can never write a
character-shaped object over a creature's flat number. The `animal` needed no
code of its own: it renders correctly because it declares the monster's paths,
which is the whole point of that schema.

The type test is a closed set. It cannot be right about a type added after it was
written, and it fails *silently* — the card renders, the numbers are simply
someone else's. 1.4.1 had already fixed the notes field this way and the rest of
the card was left on the type test; that is the shape of the cost of fixing one
branch at a time.

**Rejected: a per-type view-model table** (`character` → these fields, `monster`
→ those). It is the same closed set with more ceremony, and every new type still
has to be added by hand before its card is right.

**Rejected: showing an animal's carrying capacity in the encumbrance slot.** The
animal model does declare `animal.capacity6` / `animal.unencumbered6`, so the row
has something true to say — but the card computes no load against them, and a
capacity bar with no load is a new feature, not a repair. The row is absent.

**Rejected: folding `thac0.mod.*` into the displayed attack bonus for an actor
with no ability scores.** The attack bonus is now "the ability mod, where the
model declares scores", which leaves the Actor-Tweaks attack adjustment out for a
monster or an animal exactly as before. Including it is arguably the correct
reading of the model, but it changes what an already-tweaked monster's card shows
— a visible change to a type this fix is not repairing, in a hotfix.

**Cost, deliberate:** the class slot on a model with no class now shows the
actor's own localized TYPE name rather than a hard-coded "Monster", so
`ACKS-LIB.followerCard.monster` no longer has a reader (`TYPES.Actor.monster` is
the identical string, so the monster card is unchanged). `ctx.isMonster` and
`ctx.levelReadonly` are gone from the view model and the card root no longer
carries `is-monster`; nothing read any of the three.

**Left standing, outside the card:** an actor's *route* to the card is still
type-gated in files this fix does not own — `lib/module.mjs` registers the
Follower Card sheet and its retainer default for `["character", "monster"]`, and
`henchmen/apps/hirelings-grid.mjs` filters the monster-henchman bucket to
`type === "monster"`. An animal reached through core's `henchmenList` now renders
correctly; one recruited into the module's own monster list is still dropped
before the card is asked for.

### One palette, both seats — sheet theming retires into the tokens (2026-08-05)

The module drew its own colours. Seven feature stylesheets carried 32 distinct
hex literals — golds, purples, blues, four separate reds — plus 88 reads of
Foundry's legacy `--color-*` variables. Those variables are the load-bearing
part: Foundry v14 defines every one of them ONCE, globally, with no theme
scoping (they are v10-era light-theme constants kept for back-compat and absent
from all 185 of its `.theme-dark` blocks). So the module's borders and secondary
text were pinned to the light theme in seven files, and a dark seat rendered
light-theme ink on dark ground. The literal fallbacks in those reads were a red
herring — the variables resolve; they resolve to the wrong value.

**Ruled: every colour comes from an `--acks-*` token, read bare.** The design
system already published both palettes; nothing needed inventing. Two
consequences were chosen deliberately.

**Category is not encoded by hue.** Blues and purples marked magical vs mundane
light sources, and "the GM set this, not the rules". The palette is one burgundy
spot plus a warm black — "resist adding hues" is the design system's own
instruction, and a categorical ramp would have been the first exception. The
distinctions are now carried structurally: the glyph (`fa-moon` / `fa-lightbulb`
already differed), the glyph's weight where both states shared one, and rule
weight. Gold was the exception that proved it — `--acks-gold` already existed as
a real token, so those uses were migrations, not inventions.

**No rule branches on the seat's colour scheme.** `lib-sheet-theme.css` used to
carry nine `:not(.theme-dark)` / `.theme-dark` pairs. Every token it spends
already holds both values, so the branches were removed rather than repaired —
one declaration serves both seats. This also closed a defect the branches
created: Foundry v14 lets `colorScheme.applications` differ from
`colorScheme.interface` and stamps `.themed.theme-dark` on the APPLICATION root
while `<body>` stays light. The token file follows that class; a body-scoped gate
does not, so the pair rendered hybrid — dark tokens under light-seat rules.

**Rejected: a second token publisher for forced light.** The `theme` client
setting pins `data-acks-theme` on `<html>`. Forcing dark needs nothing new. But
forcing light has to defeat a `.theme-dark` that Foundry may have put *below* the
pin, and an ancestor cannot undo a descendant's declaration — the obvious fix is
to re-publish the light palette in a second block. That would put every colour in
the file in two places, which is how a theme drifts out of sync. Instead the dark
block WITHHOLDS itself: two `:not()` guards exclude the pinned element and its
whole subtree, and the `:root` values simply inherit. Excluding is cheaper than
restating. Verified in Chromium across eight host/override combinations.

**Known limitation, accepted:** the inverse split — `interface: dark` with
`applications: light` — leaves ACKS tokens dark inside an application Foundry
stamped light. The dark block is published at `<body>` and nothing below
re-publishes light, which is the one case the withholding technique cannot reach.
It is not visibly broken (`.acks-ui` remaps Foundry's own variables inside an
ACKS root, so those windows read as uniformly dark rather than mixed), and the
`theme` setting's "Always light" is a direct remedy. The real fix is to give the
light palette the same multi-selector treatment the dark block gets, which means
restructuring the vendored token file — out of scope for the release that found
it.

### The sheet theme stops being a setting (2026-08-05)

`sheetTheme` toggled `body.acks-lib-sheet-theme`, the layer that restyles markup
the **system** renders. It shipped default-on with an opt-out, on the reasoning
that a table might want the system's sheets left alone.

**Ruled (owner): extras overrides core, and there is no off-state.** The opt-out
did not do what its name suggested. Turning it off did not return a neutral
Foundry — it left this module's own windows in the ACKS look and the system's in
Foundry's default one, which is precisely the split this release exists to close.

It could not be made safe in the off position either. The `acks` system publishes
no dark palette: its stylesheet has zero `.theme-dark` rules and its sheet ground
is a fixed light parchment image, so a core sheet is a LIGHT surface whatever the
seat. Six features inject their own DOM into those sheets through
`renderActorSheetV2` / `renderItemSheetV2`, and once the token sweep put those
regions on theme-aware colours they resolved dark against that fixed cream —
about 1.55:1. Before the sweep they spent light-theme constants and stayed
readable, so the off position was a regression this work introduced and could
only have been fixed by re-pinning light constants, which is the defect the sweep
removed.

**Consequences.** The class stays and lands unconditionally at `ready` — it is
still what lets these rules clear core's own `.acks.sheet.actor` pairings at
(0,4,0). A `renderApplicationV2` hook adds `acks-ui` to every root carrying
`acks` or `acks2`, which carries the design system's remap of Foundry's own
custom properties onto the system's sheets and dialogs; that remap, not the
decoration, is the load-bearing half. Core fires render hooks for each class in
an application's inheritance chain, so the base hook name reaches every
ApplicationV2 rather than needing one registration per sheet class.

**Cost:** a table that preferred the system's stock look no longer has a switch
for it, and the setting count is unchanged only because `theme` replaced it.
Accepted: the thing being asked for was a colour scheme, and that is what `theme`
now is.

**Rejected: gating the module's injected colour on the setting instead.** It
would have made the off position legible by letting those regions inherit core's
colours, but it preserves the two-ways-rendered split as a supported state, which
is the thing being removed.

### The palette crosses to core's sheets; the chrome is a setting (2026-08-05)

Carrying the ACKS look onto the system's own windows began as one class:
`renderApplicationV2` added `acks-ui` to every root carrying `acks` or `acks2`.
It looked right and it clipped. Measured live on the character sheet, the
attributes tab rendered 871px of content in a 782px box.

The cause was not typography, which was the obvious suspect and the wrong one:
the computed font size is 14px with the frame on or off. It was
`vendor/acks-design/foundry.css` giving every input, select and textarea
`4px 6px` of padding. Core's attribute grid is sized around core's own field
metrics, and a dozen widened fields is 89px.

**First answer, and it was the wrong shape: withhold the chrome.** The design
system grew `.acks-palette` — the variable remap with no geometry — and core's
sheets took that instead. It measured clean, and it gave up the burgundy caps
labels and the boxed tabs to buy back 89px. Owner, immediately: *how was
"revert everything" easier than adding some pixels to the width of one window's
default?* Correct. The window is what should give.

**Ruled: the sheet gets a `min-width`, and the split becomes a setting.**
`lib-sheet-theme.css` widens `.acks.sheet.actor-v2.acks-ui` to 900px — a
minimum, not a width, so a player who drags it wider keeps that. `.acks-palette`
survives as the other value of the new `sheetStyle` client setting, for a table
that wants the colours without the furniture. Both classes carry the identical
light/dark remap, so the setting is how much ACKS, never whether dark mode
works. Verified live across all four `sheetStyle` x `theme` combinations: zero
overflow and the correct ink in every one.

**A selector written against the wrong class is silently inert.** The first
min-width targeted `.acks.sheet.actor`, and the system's v2 actor sheet carries
`actor-v2` with no bare `.actor` — so the rule matched nothing and the overflow
persisted unchanged. It read as "min-width does not override Foundry's inline
width", which is false and would have been the wrong lesson. Read the class list
off the live element before scoping to it.

**The general rule this establishes:** a design system may hand another owner's
layout its colours freely. If it also wants to hand over its geometry, it has to
give that layout the room, not take away the geometry.

---

### Goods the system leaves un-draggable are marked — and only those (2026-08-05)

`ActorSheetV2` binds its drag sources with `dragSelector: ".draggable"`, and
core's inventory template marks every row with that class except money. Coin
therefore could not be dragged into a container or onto a place at all, and the
failure was invisible in the worst way: no handler of ours ever ran, so there was
nothing in the console to find. Every drop target in the family was waiting on a
drag that could not begin.

`patches/goods-drag.mjs` adds the class after render and then **re-binds the
sheet's own DragDrop**. The re-bind is the fix, not a tidy-up — `DragDrop.bind`
assigns `ondragstart` element by element, so a class added after that pass is
inert until another one runs. Binding twice is safe precisely because those
handlers are assigned rather than added.

**Only rows whose `data-item-id` resolves to `isGoods` are marked.** Core also
leaves the favourites panel and the languages list un-draggable, and making every
row on the sheet a drag source is a wider behaviour change than this defect
warrants. Gating on the predicate rather than on `type === "money"` means
whatever the system forgets next is covered without another patch.


---

- **2026-08-05 — Sub-type data models register at `init`, never at `setup`.**
  This module declares three actor sub-types (`animal`, `group`, `template`) and
  gave them their models in the `setup` hook. `Game#setupGame` calls
  `initializeDocuments()` — which constructs every world Document — *before* it
  fires `setup`, and a Document whose sub-type has no registered model keeps a
  plain Object as its `system` for the rest of the session. Nothing
  re-initializes it. So every animal and every monster template already in a
  world came up with no schema behind it, while one created later in that same
  session was correct: an animal sheet threw
  `Cannot read properties of undefined (reading 'fields')` from the system's own
  `_prepareContext`, and templates rendered on empty fields. Sub-types owned by
  other features (`party`, `location`, the `encounterZone` region behaviour)
  registered at `init` and were never affected — the outlier was the bug.

  **Supersedes the earlier ruling that `setup` was required.** That entry held
  that Foundry finalized `CONFIG.Actor.dataModels` from the manifests'
  `documentTypes` after a `library: true` module's `init`, overwriting an
  assignment made there. No such finalization exists in v14 — nothing between
  `init` and `ready` rewrites that object (verified live: the models were
  present at `ready` under both timings, and only the construction order
  differed), and Foundry's own module sub-type documentation prescribes `init`.
  The merge dropped `library: true` in any case.

  **No data was ever at risk.** A model-less `system` is the stored source
  passed through untouched, so an affected actor was intact on disk the whole
  time — `actor.reset()` alone restored one, which is what proved the diagnosis.
