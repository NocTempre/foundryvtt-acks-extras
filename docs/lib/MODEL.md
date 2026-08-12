# Library — Design Model

`lib` is the module's shared-primitives subsystem (`scripts/lib/`). It exposes
vocabulary, DataModel field-builders, the core patch layer, and the actor
sub-types the module owns — the surfaces more than one feature reads. Anything
only one feature needs stays with that feature.

- **Reuse**: the `acks` system's damage/save vocabulary and (via the
  `game.acks?.lib` shim) any surface later upstreamed into core.
- **Extend**: the shared ACKS effect/ability vocabulary (`vocab.mjs`) and its
  DataModel field-builders (`fields.mjs`) — the target the abilities feature
  and (deferred) the monsters feature build their models from.
- **Enhance**: the plumbing every feature was duplicating before the merge —
  one socket transport (`sockets.mjs`), one effect-scan core
  (`effect-scan.mjs`), one tables registry (`tables.mjs`), one service registry
  (`services.mjs`).
- **Invent**: `LevelValue` — the level-scaling value type + its resolver — the
  one genuinely new primitive, spanning thief skills, per-level throws, and
  attack/save progressions.

**Overrides of core logic default here.** A feature patches core directly only
when the behavior is unique to that feature's domain, and says so in its own
MODEL. One owner per wrapped core method.

## Theming: one palette, three layers

Every colour any ACKS surface draws comes from an `--acks-*` token. There are no
hex literals in `styles/`. Reads of Foundry's *legacy* `--color-*` variables are
avoided — that set is defined once globally in v14 with no theme scoping, so
those names are light-theme constants and cannot follow a dark seat. (This is a
rule the code does not yet fully keep: `styles/classes.css` still carries a
nine legacy reads. They are masked while an ACKS class is on the root, because
`foundry.css` re-points five of those same names at ACKS tokens — so the drift
is invisible today and would surface under the `core` look. Tracked in
[ROADMAP.md](ROADMAP.md) § "Sweep the legacy `--color-*` reads out of
styles/classes.css".) The *modern* v14 variables — `--color-text-primary`, `--color-border`,
`--font-primary` — are a different set and genuinely theme-aware; the `core` look
below is built on them.

| Layer | File | Applies to |
|---|---|---|
| Tokens | `vendor/acks-design/tokens.css` | the whole page; inert on its own |
| Chrome | `vendor/acks-design/foundry.css` § 1–7 | any application root carrying `acks-ui` |
| Look | `vendor/acks-design/foundry.css` § 8 | everything, when `data-acks-look="core"` is set |
| Core sheets | `styles/lib-sheet-theme.css` | markup the **system** renders, prefixed `body.acks-lib-sheet-theme` |

**Core's own windows are ACKS surfaces too.** A `renderApplicationV2` hook marks
any application root carrying `acks` or `acks2` — every sheet and dialog the
system renders. This is not decoration: the `acks` system publishes no dark
palette at all (zero `.theme-dark` rules, and a sheet ground that is a fixed
light parchment image), so without the remap its widgets draw light-theme values
underneath themed module regions injected into the same sheet.

**`acks-palette` is the colour half of `acks-ui`.** `acks-ui` is the remap PLUS
the ACKS chrome — window band, tabs, control padding, scrollbars.
`acks-palette` is the remap alone. Both carry the identical light/dark values,
so the choice between them is how much ACKS, never whether the seat works.

The `sheetStyle` client setting picks which one lands on the system's windows:

| `sheetStyle` | Class | What core keeps |
|---|---|---|
| `full` (default) | `acks-ui` | nothing — banners, tabs and ACKS fields throughout |
| `palette` | `acks-palette` | its own layout, spacing and field metrics |

**Which windows `sheetStyle` governs is decided by the declaration, not the DOM.**
Five of this module's own sheets extend a core sheet and therefore inherit
`acks`/`acks2` into their class list (Foundry concatenates `classes` up the
inheritance chain), so the rendered class list cannot tell a module window from a
system one — and the hook writes to that class list itself, so reading it back is
circular. `app.options.classes.includes("acks-ui")` is the honest test: every
application this module declares names `acks-ui`, no core application does, and
`options.classes` is computed once at construction. A window that declared itself
an ACKS surface always wears the full dress; `sheetStyle` speaks only for the
system's.

### The `look` setting: whose palette, not how much of it

`look` sits above both of the above. `book` is everything described here. `core`
sets `data-acks-look="core"` on `<html>`, and § 8 of `foundry.css` re-points every
`--acks-*` colour and face at the equivalent **Foundry** variable — so consumers
that spend the tokens bare (after the token sweep, all of them) draw in the host's
palette with no second stylesheet and no class to strip from a hundred selectors.

Three properties make it safe, and each is load-bearing:

- **The adapter declares no colour and no face of its own.** Every value is a
  `var()` read of a Foundry token. That is what keeps it from being the second
  palette publisher the token rules forbid: nothing in it can drift out of step
  with the book palette, because none of it is a copy of it.
- **Surfaces go `transparent` rather than picking a host background.** A region
  that paints no ground inherits the window's, so ground and ink can never be
  chosen by two different authorities — which is precisely the ~1.55:1 failure the
  2026-08-05 opt-out foundered on. Where a region must read as recessed it gets a
  wash mixed *from* the host's own text colour, so it inverts with the seat.
- **The dress classes come off in the same pass that sets the attribute.**
  `acks-ui`/`acks-palette` point Foundry's variables at the ACKS tokens; the `core`
  look points the ACKS tokens at Foundry's. Both at once is a `var()` cycle, which
  resolves to the guaranteed-invalid value and silently unsets everything
  downstream. `dressFor()` returns "wear nothing" under `core` for exactly this
  reason.

`core` also withholds `body.acks-lib-sheet-theme` — the only vehicle by which this
module dresses surfaces that are not application roots at all, namely core's chat
cards and every window header in the client.

**`core` is the system's own look, not a neutral Foundry.** The `acks` system
paints every window header from its own *unscoped* `.window-header` and
`.application .window-header` rules, and its dialogs hardcode their own
foregrounds. Standing down returns those to the system; it cannot return them to
stock Foundry, and the setting's hint must not promise that.

**Full dress needs a wider sheet, and gets one.** The ACKS fields are roomier
than core's, and core sizes its attribute grid around core's own metrics, so the
grid wants ~90px more than core's default width — it clips its last column
otherwise. `lib-sheet-theme.css` gives `.acks.sheet.actor-v2.acks-ui` a
`min-width`. A minimum, not a width, so a player who drags it wider keeps that;
and scoped to `.acks-ui`, so palette mode leaves core's width alone. Note the
class is `actor-v2` — the system's v2 actor sheet does not also carry a bare
`.actor`, so a selector written that way is inert.

**Tokens are published once.** Light at `:root`, dark at a single override block.
Nothing else declares a palette value — a second publisher at higher specificity
out-scopes the dark block, which is how a component ends up rendering four ways.
Consumers read tokens **bare**: `var(--acks-spot)`, never with a literal
fallback, because a fallback masks a missing token rather than revealing it.

**Two roles, one colour.** `--acks-burgundy` is the spot colour as a SURFACE
(bands, fills, anything white text sits on); `--acks-spot` is the same colour as
INK (headings, rules, borders, focus). They are identical in light and diverge in
dark — surface darkens to carry white text, ink lifts to a rose that reads on
dark paper. Using one where the other belongs is invisible on a light seat and
illegible on a dark one. The same split governs `--acks-danger` / `-ink`,
`--acks-warning` / `-ink` and `--acks-success` / `-ink`: the plain token fills,
the `-ink` variant is text.

**No rule asks which seat it is on.** Because every token carries both values, a
single declaration serves both themes, and `styles/` contains no
`:not(.theme-dark)` branches. This is what makes Foundry v14's split colour
scheme work: when `colorScheme.applications` differs from `colorScheme.interface`
the theme class lands on the *application* root, not `<body>`, and a body-scoped
branch would miss it.

**Category is never encoded by hue.** The palette is one burgundy spot plus a
warm black; distinctions that a hue used to carry — magical vs mundane, GM-set vs
by-the-rules — are carried by the glyph, the glyph's weight, or the rule weight.
`--acks-gold` is the one accent beyond the spot colour, and it is a real measured
token, not a per-feature invention.

**Four client settings drive it**, all in `lib/module.mjs` and all per player:

- `look` — `book` (default) or `core`, per the section above. Sets
  `data-acks-look` on `<html>`, toggles the body class, and re-dresses open
  windows. `applyLook()` is the single place the whole client state is applied,
  and `ready` calls it rather than setting anything itself.
- `theme` — `follow` (default), `light`, `dark`. Pins `data-acks-theme` on
  `<html>`; `follow` removes the attribute so Foundry's own scheme governs.
  **Stands down under `look: core`**, and must: the tokens then resolve to
  Foundry's own theme-aware variables, so the seat's light and dark are Foundry's
  to decide, and a pin here could only put the ACKS palette back underneath the
  host's. It is also what keeps one authority choosing ground and ink inside a
  window this module no longer dresses.
- `sheetStyle` — `full` (default) or `palette`, per the table above. Not
  consulted under `look: core`.
- `fontScale` — writes `--acks-fs-base` inline on `<html>`, rescaling every ACKS
  surface from one knob. It survives `core`, because size is a player's own
  accessibility knob rather than part of the look; the ACKS *faces* do stand down.

`applyRootPin()` exists so `applyTheme` and `applyLook` can both write the pin
without calling each other — `core` has to be able to clear a pin `book` set, and
a cycle between the two appliers is the easy way to get that wrong.

Every pin lands on `<html>`, never `<body>`, and that is load-bearing: custom
properties inherit as *already-substituted* values, so a token pinned on `<body>`
never reaches derived tokens whose substitution ran at `:root`. The `core`
adapter is the one block that must name `body` and `.themed` explicitly in its
selector for the mirror-image reason — it *reads* the host's variables, and
Foundry re-declares those on `<body>` (which it does **not** mark `.themed`) and
again on each themed application root.

## Perception: senses, light, and the token

Three files answer "what can this creature see, and how brightly does it burn?"
for every actor in the family — a lone monster, a party member, a detached
scout. They live here rather than in a feature because more than one asks.

| File | Owns |
|---|---|
| `scripts/senses.mjs` | Reading ACKS senses off the sheet, and what each grants. |
| `scripts/perception.mjs` | What those senses ARE to Foundry: vision modes, detection modes, and the two status effects the rules need. |
| `scripts/light.mjs` | The RR light table, and which record holds a given actor's lights. |
| `scripts/token-sync.mjs` | The guarded writes that put any of it on a token. |

**Sense resolution** runs in one precedence order, so the movement rules and the
canvas can never disagree: the Full Monster Sheet stat block
(`flags["acks-extras"].extras`), then a `kw:lightlessvision` capability, then
item and active-effect names. `canSeeInDark` (the ⅓-speed blinded rule) and
`senseProfile` (token sight) are two readings of that one answer.

**The Foundry mapping.** `sight.range` is what a token sees *in darkness* — core
derives `basicSight` at that range and `lightPerception` at infinity
(`client/documents/token.mjs:541`), so range 0 means "sees only what is lit",
which is the correct and common answer for a human. That is also why the system's
monster packs are wrong out of the box: every creature ships at `sight.range: 60`,
handing a peasant and a bugbear the same dark sight.

Dark senses render through this module's own vision modes, never core's
`darkvision`: that mode promotes DIM to BRIGHT, which would let a creature read a
scroll in a lightless corridor. The ACKS senses see only "as dim light", and dim
light cannot discern colours or read (RULES §4). Each reads differently —
lightless vision warm, shadowy senses cold, echolocation flat — so a player can
tell which sense they are looking through. Night vision is the one light-based
sense and keeps the dim-to-bright promotion, without `lightAmplification`'s green.

| ACKS | `sight.range` | `visionMode` | detection mode |
|---|---|---|---|
| Ordinary eyes | 0 | `basic` | core's own |
| Lightless Vision | its recorded range (MM default 60') | `…Lightless` | `…LightlessVision` (SIGHT) |
| Shadowy senses | 30' | `…Shadowy` | `…ShadowySenses` (SOUND) |
| Echolocation | its recorded range | `…Echolocation` | `…Echolocation` (SOUND) |
| Mechanoreception, terrestrial | its recorded range | `…Echolocation` | core `feelTremor` (MOVE) |
| Mechanoreception, other | its recorded range | `…Echolocation` | `…Mechanoreception` (MOVE) |
| Blind | its best sense range, else 30' | that sense's | that sense's |
| Night Vision | **twice** the bright radius reaching it, else 0 | `…Night` | core's own |

A creature looks through its **longest** sense and detects with **all** of them,
each at its own range.

### Night Vision is the one sense read off the square

Every other row above is a property of the sheet. Night Vision is not: MM §5
gives it as *moonlight → daylight; indoors 2× light range; not total dark*, so
its reach is a multiplier on a light somebody else lit and somebody else carries.

`brightestLightReaching` (`scripts/light.mjs`) answers what that light is — the
largest bright radius, among the scene's ambient lights and every light-emitting
token, whose source actually covers the creature's square. `senseProfile` takes
it as `litBy` and doubles it. Nothing else reads it, and the pass only computes
it for creatures that have the sense, because finding it costs a sweep of the
scene.

The last clause of the rule then holds by construction rather than by a check: an
unlit corridor has nothing to double, so the range is 0 and a night-eyed creature
is as blind as anyone else. `seesInDark` stays **false** either way — that flag
asks whether a creature can march with no light at all.

Because the answer depends on the light rather than the sheet, the sheet-driven
hooks cannot see it change. `syncNightVisionTokens` is re-run — debounced, and
narrowed to the creatures that have the sense — whenever an ambient light or a
token's position, light or visibility changes.

Straight-line distance, ignoring **walls**: a torch beyond a closed door still
reads as reaching. Resolving occlusion needs the live canvas, and this has to
answer for scenes nobody is looking at.

### Asking for the whole world at once

Every pass above is local — the scene on screen, the actor just edited. A world
that switches `manageVision` on mid-campaign, or upgrades into a corrected sense
model, keeps whatever its untouched scenes were last set to.
`migrateWorldVision` sweeps every scene in the world and reports what it wrote;
the **Migrate Token Vision** macro is its one user-facing surface.

Taking back tokens released to a hand edit is a second, opt-in answer, never part
of the sweep: a released token is a Judge's override, and undoing all of them
silently is the destructive reading of "migrate".

### Why the detection modes matter

A radius alone makes every sense behave like eyes, which is wrong in ways that
decide encounters. `DetectionMode.type` is what fixes it: core's own `_canDetect`
defeats only SIGHT modes with the Blind status and with an invisible target, and
defeats only *wall-respecting* modes with magical darkness. So:

- **Echolocation** (SOUND, walls) finds an invisible creature and works inside a
  *darkness* spell — its `_canDetect` deliberately skips core's darkness bail,
  which is keyed to walls rather than to type — but deafness and silence stop it.
- **Shadowy senses** (SOUND, walls) survive blindness and invisibility, and stop
  dead while deafened, silenced, running, or in magical darkness.
- **Lightless vision** (SIGHT, walls) is beaten by a character *proficient in
  Hiding* who is hiding (RULES §4) — a check impossible through core's generic
  `basicSight`.
- **Terrestrial mechanoreception** is core's `feelTremor`: through walls, moving
  creatures only. Reused, not reinvented.

**`basicSight` is switched off wherever a real sense replaces it.** Core derives
it from `sight.range`, and left enabled it shadows every specific mode — the
hiding thief is seen anyway, the invisible one found by a bat that should be
listening rather than looking. Environment vision is untouched by this: the
vision source radius reads `sight.range` itself (`Token#sightRange`), never the
detection mode.

### Conditions

Source-side conditions are resolved in `senses.mjs` and written into the token,
so a suppressed sense costs nothing per visibility test and `canSeeInDark` agrees
with the canvas — a deafened thief takes the blinded ⅓-speed penalty. Conditions
that depend on the *target*, or on where the perceiver is standing, cannot be
precomputed and live in `_canDetect` instead.

Core ships `blind`, `deaf`, `silence` and `invisible`. It has no notion of
running or of hiding, so this module registers **Hiding** and **Running** as
status effects. Both are deliberately toggles: whether a character is running
flat out this round, or has gone to ground, is a declaration, not something to
infer from a token's position.

**Light ownership is exclusive.** An actor in a formation takes its lights from
that formation's record (which tracks fuel, shutters and burn-down); only an
actor in no formation reads its own `flags["acks-extras"].lights`. Reading both
would let a member carry two contradictory torches. lib asks the formation
through `globalThis.acksExtras.formation.lightsForBearer`, which returns `null`
— not `[]` — for a non-member, because that is the difference between "carrying
nothing" and "not a member".

**Overrides are respected, differently for each write.** A light is only ever
cleared if we set it (`managedLight`). Vision cannot be that shy — the whole
point is to overwrite the system's stock `sight.range: 60` on every monster — so
it stamps what it wrote (`managedVision`) and compares before writing again; a
token whose sight no longer matches the stamp was edited by a human and is
handed back permanently. `manageVision` is the world-level off switch.

## The item taxonomy: goods, gear, and where it sits

The system's eight Item sub-types share no base. `cost`/`weight6` are hand-spread
into `item`, `weapon` and `armor`; `equipped` is declared **separately on `weapon`
and `armor` and nowhere else**; `money` has neither cost nor weight. So "is this a
thing?", "can it be worn?" and "what does it weigh?" had no schema answer, and
every consumer re-derived them from its own type list.

`scripts/item-model.mjs` is the one place those questions are answered. It reads
the **schema** wherever it can (`"cost" in item.system`), so it keeps working when
the system adds a type this library never heard of.

| Question | Read | Why not a type list |
|---|---|---|
| Is it a thing? | `isPhysical` | schema probe |
| Have they got one? | `findCarried` / `carriesItem` | every "you need a pole / a torch / a quill for this" rule asks the same question; physical-only, so a proficiency named "Spear Fighting" is not an implement, and `hasStock` makes an empty stack read as not carried |
| Can it be put somewhere? | `isGoods` / `isStowable` | coin is goods without being physical — the gap that grew a `\|\| type === "money"` rider at fifteen sites |
| Is it clothing? | `isClothing` | core's `system.subtype`, its one sub-classification |
| What does it add to encumbrance? | `encumbering6` | mirrors core's `computeEncumbrance` exactly, clothing excluded, so a non-character's load matches what core computes for a character |
| Can it be worn? | `isWearable` | core's `equipped` field OR a declared slot |
| Is it worn now? | `isWorn` | **two stores, one question** |
| Where? | `wornSlotOf` / `setWorn` | ditto |
| How much does it hold? | `capacityOf` / `holdsGear` | capacity belongs to gear, not to a category — see below |

### Capacity

`capacityOf(item)` is stone, or `null` for "holds nothing". It reads
`gear.capacity` first and the legacy `container.capacity` second, so worlds
annotated before the concept moved answer correctly with nothing to migrate.

**It is not a container property.** While capacity lived inside the equipment
feature's container record, only items that feature recognised as carrying
devices could have one — so a coat with hidden pockets, a bandolier and a saddle
could hold nothing, and "is this a container" and "does this hold anything" were
the same question by accident. Anything that can be given a capacity is a place
gear can go.

0 is a real answer distinct from `null`: a container of unstated size. RAW
capacity is a warning rather than a limit, so an unstated one never warns.

> Encumbrance is the same question asked of an actor, and mounts, wagons and a
> team lifting a body all ask it too. Unifying those is
> [ROADMAP.md](../ROADMAP.md) work, not done here.

### Two stores, and why nothing outside this file knows

Core owns `system.equipped` on `weapon` and `armor`; its own equip toggle and the
equipment feature's enforcement wrap both write it, so forking it would break
them. Core gives every other type **no such field at all**, and Foundry prunes
keys outside a type's schema — so a cloak, a pair of gloves, an adventurer's
harness and a backpack could not be worn, whatever anyone wrote. Those record
`flags["acks-extras"].gear.wornAt` instead.

`isWorn`/`wornSlotOf`/`setWorn` hide which store applies. **Never re-narrow a worn
test to `system.equipped`**: three RAW rules were silently inert for exactly that
reason (the harness's stone of relief, gloves blocking lockpicks, and the worn
bucket for clothing), each gated on a field their own item type cannot carry.

### Slots

`vocab.mjs` `WEAR_SLOTS` is the canonical list — fourteen places, each with a
`capacity`. A slot is fundamentally an **exclusion**: the Treasure Tome's
Miscellaneous Magic Item Form table states the only wear mechanic ACKS II has,
that a character may not wear two of the same form at once, and its Rings entry
sets the one capacity above 1 (two, and a third stops all of them working).

`gear.slots` is the list an item MAY occupy; `gear.wornAt` is the one it does.
`declaresSlots` separates "declared to sit nowhere" from "never annotated" —
both give `slotsOf` an empty list, and every name-heuristic fallback in the
family gates on the former so a deliberate ruling is not undone by an item's
name.

## The world clock

`scripts/world-time.mjs` owns the module's one clock policy: the
`advanceWorldTime` world setting and the `mayAdvanceWorldTime()` predicate that
gates every `game.time.advance` the module performs. Two features spend the
clock — formation's dungeon turns (a minute per bookkeeping round) and the
location sheet's "Advance 1 week" button — and both go through this gate, so a
GM whose table runs Simple Timekeeping or a calendar module answers once.

The setting is registered here, in `module.mjs`, rather than by either feature.
Nothing else about time lives here: worldTime is Foundry's, and each feature
still decides its own step size and what it does when the gate is shut.

## The multi-roller chat card

`scripts/lib/roll-card.mjs` is the one renderer for every card where several
people roll at once: the exploration party's checks (Listen, Search, Bash,
Track), the party's saving throws, and the Surprise Matrix's results. It owns
the card — banner, note, tables, footnote — and nothing about any particular
throw; what a row means, what counts as success, and every localized word on it
are the caller's.

A row is `{name, total, target?, detail?, tooltip?, outcome, emphasis?}`. The
Target column appears only when some row in that section has one, so a card with
no target to hit (surprise) does not print an empty column. `emphasis` is
`success` / `failure` — a verdict against a target — or `neutral`, which is
emphasis with NO verdict attached: the surprise card's marked rows, where
whether the result is good news depends on which table you are reading.

The markup is the design system's `acks-chat` plus `acks-table`. That is what
makes the card carry its own GROUND as well as its ink — a chat message's panel
is not ACKS-themed, so a card that set only colours draws dark-theme lettering
onto a light panel. **`acks-ui` is deliberately absent**, though the vendored
component's own header pairs the two: `.acks-ui :is(h1,h2,h3,h4)` (base.css)
paints headings the spot colour at (0,2,0) and out-specifies `.acks-chat-title`
(0,1,0), which puts burgundy lettering on the burgundy banner.

## The consolidated surprise card

`scripts/lib/patches/surprise-card.mjs` replaces the Surprise Matrix's output —
one chat message per combatant — with one card (rendered by `roll-card.mjs`
above) holding a Monsters table and an Adventurers table. The roll stays the system's: the matrix cell, the modifier
stack, the surprise threshold and the `surprised` status effect are all core's,
and none of them is reachable from a module. The system ships as a single
minified bundle with no exports, and the matrix constant and both roll methods
are private.

So the patch owns presentation only. It swaps the instance's `rollSurprise`
action for a wrapper, runs core's handler inside a scoped `preCreateChatMessage`
hook that captures and blocks the per-combatant messages, and posts the rows as
tables. Each total and formula is read back out of the message using the very
i18n template that rendered it — the key is formatted with sentinels to locate
`{result}` and `{formula}`, so the reader follows a translation of those strings
and holds no copy of their English. A template that carries no `{result}` stands
the whole patch down for that click, and core's messages post untouched.

Three details are load-bearing:

- **The app is matched by `surprise-matrix-app` in its `options.classes`, never
  by class name.** `render<ClassName>` cannot be used: the released system is
  terser-minified, so `SurpriseMatrix` arrives as `E` and the hook name is
  whatever that build's mangler chose.
- **The action is swapped on the instance, not on `DEFAULT_OPTIONS`.**
  ApplicationV2 shallow-freezes `this.options` but deep-clones `options.actions`
  per instance, and looks the handler up at click time.
- **A hidden combatant's row goes to a second, Judges-only card.** Core whispers
  those results, and one chat message cannot be part public. With nothing
  hidden — the ordinary case — there is exactly one card.

The `surpriseCard` world setting gates it, read per click so it takes effect
with no reload; off, the wrapper defers to core's handler and nothing is
intercepted.
