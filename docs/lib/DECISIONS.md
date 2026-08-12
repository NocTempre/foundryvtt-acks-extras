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

### The sheet theme stops being a setting (2026-08-05) — SUPERSEDED IN PART 2026-08-07

**Superseded by "The look becomes a setting; the palette is handed back rather
than withheld" below.** The ruling "extras overrides core, and there is no
off-state" is reversed. The *reasoning* recorded here does not survive
re-examination either, and the reason it does not is worth keeping: the
"fixed light parchment" premise was measured against `.acks.sheet.actor
.window-content` (`acks.css:63`), a selector that is **inert** — the system's v2
actor sheet root carries `acks actor-v2 character-v2 sheet` and no bare `.actor`,
which is the same class-list mistake recorded two entries down. What the v2
sheets actually take is Foundry's own `.application { background: var(--background) }`,
which *is* theme-aware. The half that does survive: the system publishes no dark
palette of its own (0 `.theme-dark`, 0 `prefers-color-scheme`), which still
governs its own hardcoded light-on-light pairs.

The rest of the entry stands as the record of what was ruled at the time.



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

---

### The attack roll delegates its audience to core, and offers four modes (2026-08-05)

`core.rollMode` and `CONFIG.Dice.rollModes` are deprecated in v14 and removed in
v16, and the remodeled attack roll used both. The trap is that the replacement
changed the values, not just the accessor: `core.messageMode` yields
`public/gm/blind/self`, while `core.rollMode` yields `publicroll/gmroll/
blindroll/selfroll` — v14 keeps the old name working by mapping the new value
back (`client/game.mjs`, `rollModeField.initialize`). So the roll was correct
throughout; only the console suffered.

That back-mapping is what makes the obvious fix dangerous. This roll compared
the value against the legacy spellings to build `whisper` and `blind`. Changing
the settings read alone leaves those comparisons matching nothing, and a blind
or private attack is then created with no whisper list — **broadcast to every
player, with no error anywhere.** The offline suite passes, and a smoke test in
Public mode passes.

The rule: **this roll states a mode and lets `ChatMessage.applyMode` decide the
audience.** It holds no list of mode names to compare against, so there is no
second copy to fall out of step with core's, and a mode added later is handled
without an edit here. It also returns `whisper` as user ids, which is what the
Dice So Nice call downstream wants — `getWhisperRecipients` returns User
documents, and that mismatch was live in the previous shape.

Rejected: renaming the three comparisons to the new spellings. It restores
correctness but keeps the duplicated vocabulary that caused the hazard, and the
next vocabulary change breaks it the same silent way.

**The dialog offers four modes, not five.** `CONFIG.ChatMessage.modes` also
carries `ic`, which styles a message as in-character rather than deciding who
may read it — a different question from "who sees this roll". Adding it would
also be a new user-facing surface. Do not enumerate the config directly here.

### The look becomes a setting; the palette is handed back rather than withheld (2026-08-07)

Players reported the palette and lettering as an irritant and asked for a way
out. The 2026-08-05 ruling above had removed exactly that, on the grounds that an
off-state could not be made legible.

**Ruled (owner): there is an off-state, and it is a `look` setting — `book` or
`core` — that covers every ACKS surface including this module's own windows.**
Not a third value on `sheetStyle`: that setting answers "how much of the ACKS
palette do the SYSTEM's sheets take", and the thing being asked for was "not this
palette, anywhere", which is a different question and a different axis.

**The mechanism is a hand-back, not a withholding, and that is the whole reason
it works this time.** The 2026-08-05 token sweep left one publisher and made every
consumer read `--acks-*` bare. So `core` does not strip a class from a hundred
selectors or ship a second stylesheet — it re-points the tokens themselves at the
equivalent Foundry variables (`foundry.css` § 8), and every surface in the module
follows for free. This is what the owner meant by the cleanup making it a light
change, and it is correct: the runtime is one setting, one attribute, and a
three-way in the code that already existed.

**Why this cannot reproduce the ~1.55:1 the old opt-out hit.** That failure needed
two authorities: the host choosing a region's ground and the ACKS dark block
choosing its ink, disagreeing. Three things now make disagreement unrepresentable:
surfaces in the adapter are `transparent`, so a region inherits the window's own
ground rather than naming one; washes that must read as recessed are `color-mix`ed
*from* the host's own text colour, so they invert with it by construction; and the
`theme` pin stands down under `core`, which removes the only remaining way to
force the ACKS branch against the host's. The pin was in fact the real decoupler
all along — `tokens.css` keys on Foundry's own `.theme-dark`, so with `theme:
follow` the two authorities are the same class and *cannot* diverge.

**Rejected: authoring an ACKS-flavoured "system" palette.** Considered, because it
would keep every surface deliberately designed. It means writing a second real
palette — including a dark counterpart the `acks` system does not ship — and
auditing it, which is a design project rather than an opt-out, and it would have
put literal colours in a second file: the exact second-publisher shape
"One token publisher" forbids. The adapter earns its keep by containing **no
literal colour and no literal face at all**; every value is a `var()` read of a
host token, so there is nothing in it that can drift.

**Rejected: `data-acks-look` on `<body>`, and a selector keyed on `.themed`
alone.** Both are substitution bugs. Custom properties inherit as
already-substituted values, so the adapter has to re-run substitution wherever the
host re-declares its own theme variables. Foundry v14 does that on `<body>` and
again on each `.themed` application root — but `Game##configureColorScheme` adds
the bare `theme-<scheme>` class to `<body>` and `themed` only to the interface
elements it walks afterwards (`client/game.mjs:1855` vs `:1874`). A selector
trusting `.themed` would miss the ordinary case and bake the light ramp in at
`<html>`. The block names `body` explicitly for that reason.

**The dark block's guards are widened, not duplicated.** `core` needs the ACKS
dark palette withheld wherever the adapter applies, and `tokens.css` already had
the withholding technique built for the forced-light pin. Two more `:not()`
components on the existing key; no new declaration, no light counterpart block.
Same trade the file documents: excluding is cheaper than restating.

**Ownership is read off the declaration, not the DOM.** Under `book` +
`palette`, the hook was stripping `acks-ui` from the five module sheets that
extend a core sheet and inherit `acks`/`acks2` into their class list — so this
module's own ability sheet, roll editor, equipment item sheet, Full Monster Sheet
and Follower Card lost their chrome on a palette seat. The class list cannot
distinguish them (and the hook writes to it, so reading it back is circular);
`app.options.classes` can, because it is computed once at construction. Fixing
this was not optional here: `core` has to decide the same question, and having two
different ownership tests would guarantee they drift.

**Cost.** `theme` and `sheetStyle` become inert under `core`, which is three
settings where two would do if the looks were merged into one list. Kept separate
because collapsing them would cost "Follow Foundry" — the default, and the answer
most players want — and because the two questions really are independent under
`book`. The hints now say when a setting is ignored, which is the honest version
of that cost rather than a fix for it.

**Not fixed here, found while reading:** `styles/abilities.css:270` sets
`border: 1px solid var(--acks-rule)`, and `--acks-rule` is `2px`, not a colour —
`1px solid 2px` is invalid, so the declaration is dropped entirely and the
throw-tag has no border at all. Intended token is `--acks-rule-color`. Left alone
because fixing it moves every seat, `book` included, and it is unrelated to the
look. Same for the legacy `--color-*` reads in `styles/classes.css`, which are
masked under `book` and would surface under `core`.

---

- **2026-08-11 — Night Vision doubles a light it did not light.** The sense was
  implemented as the dim→bright promotion alone (`sight.range: 0`), which is half
  of MM §5: *moonlight → daylight; indoors 2× light range; not total dark*. The
  indoor clause was never built, so a night-eyed creature saw exactly as far as
  the torches reached and no further — and there was no way to give a monster
  working indoor sight short of writing a `lightlessRange` it does not have, or
  hand-editing its token.

  **Ruled: the range is read off the SQUARE, not the sheet.**
  `brightestLightReaching` finds the largest bright radius covering the token —
  ambient lights and light-emitting tokens alike, the creature's own lamp
  included — and `senseProfile` doubles it. This is the only sense that takes an
  argument, and it is the only one whose reach is not a property of the creature.

  Three things fall out of that shape rather than needing rules of their own.
  "Not total dark" holds because an unlit square has nothing to double. Foundry's
  `sight.range` means *sees in darkness*, which would otherwise contradict that
  clause outright; keyed to a live light it cannot. And `seesInDark` stays false,
  because the formation asks that flag whether a creature can march with no light
  at all, which this one cannot.

  **Rejected: 2× the light the creature BEARS.** Exact where it applies and much
  cheaper — the bearer's lights are already in hand, with no scene sweep and no
  new invalidation. Rejected because it almost never applies: monsters do not
  carry torches, and the case the rule exists for is the creature watching a lit
  party from the dark.

  **Cost: an invalidation surface the sheet hooks cannot cover.** A torch being
  struck, doused or simply carried across the room changes the answer without
  touching any sheet, so light and token movement now re-run the pass. Held down
  by debouncing it and narrowing it to the creatures that have the sense; a
  scene with none pays nothing. Distance is straight-line and ignores walls
  ([ROADMAP.md](ROADMAP.md)) — occlusion needs the live canvas, and this answers
  for scenes nobody is looking at.

- **2026-08-11 — the world sweep is a macro, and reclaiming is opt-in.** Every
  vision pass was local: the scene on screen, the actor just edited. Turning
  `manageVision` on mid-campaign left every unopened scene as it was, with no way
  to ask for all of them. `migrateWorldVision` is that ask, surfaced as the
  **Migrate Token Vision** macro, and it reports counts rather than finishing
  silently — a sweep that says nothing is indistinguishable from one that did
  nothing.

  Taking back tokens stamped `released` is a **separate question the macro puts
  to the Judge**, defaulting to no. The release marker is the override working as
  designed; undoing every one of them as a side effect of the word "migrate"
  would be the destructive reading, and the edits it discarded are not
  recoverable.

- **2026-08-11 — the `core` adapter re-points the STATE tokens too.** Reported as
  unreadable warnings on the exploration party sheet. Two faults, found in that
  order, and only the second was the reported one.

  **The local fault.** `.warnings` set `background: var(--acks-warning-tint)` and
  no `color`, so its prose inherited the *window's* ink — a colour the token file
  knows nothing about. A ground and the type on it must come from the same block
  or they are free to disagree. Ruled: take the design system's
  `.acks-callout--warning` **whole** rather than restate a piece of it; every
  other warning surface in the family already does, and the component carries the
  keyline and padding the bespoke version had also skipped.

  **The real fault.** That alone did not reproduce the report, which measured
  **1.06:1** — a cream panel under near-white type. `foundry.css` §8 withholds the
  ACKS dark palette under `look = core` and re-points ink, paper, washes, rules
  and faces at the host — but it never re-pointed `--acks-danger/-warning/-success`
  or their `-ink`/`-tint` variants. So on a dark seat under `core` a state tint
  fell through to the LIGHT `:root` literal while the ink beside it came from the
  host's dark ramp. **Every surface in the family pairing a state tint with ink
  had it**, not just this panel; the party sheet is only where it was noticed.

  Ruled: re-point the three states at Foundry's own severity ramp
  (`--color-level-*`, in scope at `<body>` like the text ramp), keeping §8's two
  standing disciplines. The **tint** is a wash mixed to transparent, so the
  window's own ground shows through and it inverts with the seat by construction.
  The **ink** carries the state hue into the host's text colour, so it keeps the
  severity while staying legible on whatever ground the host chose — a bare
  `--color-level-error` is a mid red that reads on neither seat. No literal is
  introduced, so §8 stays an adapter rather than a second palette publisher.

  **Third fault, exposed by the second.** Six rules coloured a GLYPH with the
  plain state token, each with a comment asserting an icon takes the fill token.
  That only held while the tint was an opaque book colour. The plain token is for
  bars and buttons — a saturated mark with nothing read through it; anything drawn
  as **type takes `-ink`**, glyphs included. Fixed in `formation.css` (warnings
  icon, distorted-map alarms, down badge), `abilities.css` (conflict hint) and
  `influence.css` (effect and unaudited badges).

  **Measured after, all four combinations** (text / icon contrast):
  book-dark 11.7 / 8.2 · book-light 14.3 / 6.1 · core-dark 14.2 / 10.8 ·
  core-light 10.4 / 4.1. The reported configuration was 1.06.

  **Cost.** The `core` seat no longer gets the books' state hues at all — a
  warning there is Foundry's amber, not the books' gold. That is what `core`
  already promises for every other colour, and matching the host was the point.

---

### A character alone can strike a light (2026-08-11)

The sheet's Light / Douse / Shutter controls were gated on the actor being in a
party formation: `injectLightControls` returned early when there was none, so a
character standing alone in a corridor saw **no control at all** on a lantern.
Dragging one in from a compendium did nothing visible, which is exactly what it
looked like from the outside — a lamp that could not be lit.

`light.mjs` had promised the lone case in its own header from the beginning ("a
lone actor with a torch must burn just as brightly with no formation in sight")
and `bearerLights` already fell back to the actor's own flag. Only the READ half
existed. Nothing ever wrote that flag, because every mutator lived in the
formation's turn engine.

**Rejected: putting a lone character in a formation of one.** The formation
record is a world setting only a GM may write, which is why a player's click has
to travel through the GM relay to reach it. A player alone with a lantern would
then need a Judge connected to light it. Their own actor is a document they
already own.

**Ruled: mutators on the actor's own flag, and one shared gate above both.** The
rules that decide whether a flame may be struck — a hand to hold it, the gear RR
p265 requires, one unit of fuel off the stack — belong to the light source, not
to whether anyone happens to be marching in formation. They moved to
`prepareToLight` in lib, and the turn engine now asks it too, so the two ways of
lighting a lamp cannot drift apart. The equipment-enforcement setting is read
there for the same reason.

**Cost: no burn-down outside a formation.** Duration is tracked by the dungeon-
turn engine, and a lone character has no clock to burn against. These mutators
track the STATE of a flame — lit, doused, shuttered — and say nothing about how
long it lasts. That is the honest half, and it is the half that was missing
entirely. The token lights up because the actor's flag write already fires the
`updateActor` hook the vision sync listens on.
