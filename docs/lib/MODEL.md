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

## The imported library

The importer writes what a world imports into WORLD COMPENDIUMS — one pack per
document type **per line**: `ACKS Cookbook — <Type>` for the ACKS books, and
`ACKS Cookbook — <Line> — <Type>` for every book shelved under a line of its own.
`lib/library.mjs` is the one reader for them, and every "what has this world
imported?" question in this module goes through it. A bare `game.items` finds an
empty shelf.

Shelves are matched on the `ACKS Cookbook — ` PREFIX, never on a whole label:
a reader that demanded the unlined label answered for the ACKS books and called
every lined one absent. The unlined shelf sorts first, so a lookup that has to
choose between two shelves answers with the ACKS document rather than with
whichever pack Foundry registered first.

- `libraryItems()` / `libraryActors()` / `libraryDocs(type)` — the sidebar's
  documents first, then every shelf's. The sidebar still counts: a Judge's
  homebrew class lives there, and so do the class-template packages, which are
  world documents on purpose so a Judge can repair one.
- `libraryPacks(type)` — the shelves themselves, unlined first.
- `byCookbookId(type, id)` — the id lookup, skipping template parts. A skinned
  copy inherits the id of the definition it was made from, so a plain id search
  finds one class's engraved silver waterskin where the shared Waterskin was
  meant.
- `whenReady()` — awaits the warm, for callers that can.

The reads are **synchronous**, because their callers are sheet getters and
`_prepareContext` bodies. That is paid for by warming the packs once at `ready`
(`registerLibraryWarm`, called from the lib module's own ready hook):
`getDocuments()` instantiates them, Foundry keeps the collection current as
documents are created and deleted, and every read afterwards is a filter over
memory — the same cost the `game.items` reads had. A pack that is still cold
(the importer creates its packs on first use, and core emits no hook when a
compendium is created) starts loading in the background and the read answers
with what is in hand.

**A caller that would be WRONG for the life of its window must await instead.**
Answering with what is in hand assumes the caller renders again; a surface that
never re-renders — core's Scores Generator is the one that bit — turns a
half-warm read into a permanent empty. Such a caller awaits `whenReady()` before
deciding it has found nothing, which costs nothing once the shelves are warm.

Consumers: the class registry and `findByRef`, the race list, proficiency
grants, the language resolver and its migration, the ability sheet's relation
labels, and template-packages' source resolution — where `findSource` reads
`world` off `doc.pack` rather than assuming it, because a ref now resolves to
either side and only a world document may be LINKED rather than copied.

## The compendium sidebar

`lib/compendium-folders.mjs` decides where every ACKS pack sits, and reads each
package's own manifest `packFolders` to do it — the system's declaration for the
system's packs, this module's for this module's. Neither states a folder name
belonging to the other, and a system release that re-shelves its own compendiums
re-shelves them here with nothing to change.

Two strengths:

| | `organizeCompendiumFolders()` | `restoreCompendiumLibrary()` |
| --- | --- | --- |
| When | every load, GM only | the *Restore the Compendium Library (GM)* macro |
| Claims | a pack with no folder, or one naming a folder that is gone | every ACKS pack |
| Per-pack config | untouched | reset to the package's defaults — sort, lock and ownership grants dropped |
| Empty folders | never made, never removed | the ones it empties, and any empty shelf inside this module's own tree |

Foundry files a package's packs once, matches a folder by hierarchy NAME, and
skips a pack whose configuration already names a folder — so a folder deleted
long ago strands every pack that named it at the sidebar root permanently. Both
strengths exist to answer that; the gentle one repairs it, the macro overrules
whatever a world has become.

Planning is separate from building: a folder is created only where a pack is
actually being written to it. That is what stops the gentle pass from growing a
second empty copy of the tree at every load, and it is also how a per-line
import shelf works — the importer's world packs are filed under this module's
folder in `From your books`, and a line's own folder (`Dolmenwood`, `Quick
Delve`) is made by the first pack that needs it. The ACKS library carries no
line in its label and gets none in the sidebar; it is the default shelf. The
importer calls `fileImportedPack` from `packFor` at the moment it mints a pack,
so a new shelf and its pack appear together.

A configuration entry holds a folder open only while its PACK still exists. A
world keeps the entry of every pack it has ever had, and a dead one would
otherwise pin an empty shelf open forever; those are dropped with the folder
they named.

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

**An open editor is a mode, not a column.** `styles/lib.css` keys on core's own
`prose-mirror[open]`, so any container holding an open rich-text editor spans
its whole row and the toolbar wraps instead of clipping. ProseMirror's menubar
wants roughly 870px; inside a multi-column layout it loses every control to
overflow, and the fix belongs to the family's windows rather than to whichever
card hit it first.

**The theme dresses fields at (0,4,2), and reaches only `.acks` windows.**
`body.acks-lib-sheet-theme .acks .window-content input:not([type="checkbox"])`
sets colour, background and border. A component rule that colours an input
while leading with its own class tops out at (0,4,1) and loses — silently, and
only for the properties the theme also sets, so the rest of the rule lands and
the loss reads as "that rule does nothing". A component that must win restates
itself under `body.acks-lib-sheet-theme`. `select` is not claimed by that rule
and never competes with it.

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

### The UI preset: whose defaults the world opens on

One world setting, `uiPreset` (`lib/ui-preset.mjs`), chosen by the Judge from a
startup prompt or Configure Settings: `foundry`, `acksCore` or `acksExtras`
(the default). It is two defaults in one:

- **The world's look.** `foundry` is the `core` look below; the other two are
  `book`. A client's own `look` setting reads `world` by default and defers to
  it; `effectiveLook()` is the one resolver, and every reader that used to ask
  the client setting asks it instead.
- **The world's default sheet per Actor and Item type**, resolved by the ladder
  in `ui-preset-logic.mjs`. Every registered sheet belongs to a rung by the
  scope of its id (`acks-extras.`, the system's id, `core.`); the preset names
  the preferred rung, and a type that rung has no sheet for falls through the
  rest in one fixed order — extras, then the system, then Foundry. Within a
  rung the rung's own `makeDefault` choice stands (the monster's follower
  card), captured before the first re-flag moves it. Foundry registers no Actor
  or Item sheet, so its rung is empty there and the ladder lands on this
  module's.

The ladder writes the `default` flag in `CONFIG.<Document>.sheetClasses`, the
flag `ClientDocument#_getSheetClass` reads. It runs from a `ready` hook
registered during `init` — after every ready-time registration in this module,
which were all queued at import time — and again on every client when the
preset changes, closing and forgetting open world sheets the way core does after
Configure Default Sheets. Two things outrank it, both a Judge's explicit act
through Foundry's UI: a type pinned in `core.sheetClasses`, and a document's
`core.sheetClass` flag. Applying a preset drops the pins that name a ladder
sheet so the ladder governs again, and leaves a third-party pin standing; a
type whose current default is outside the ladder is left alone too.

The prompt (`promptUiPreset`) fires once per world for the primary GM, until a
choice is applied or *Keep as is* is pressed — both set the hidden
`uiPresetPrompted` world flag. Closing the window sets nothing, so it asks again
at the next launch. Applying offers Foundry's own reload-all confirmation, since
an embedded item's sheet is not re-resolved until then.

**Four client settings drive it**, all in `lib/module.mjs` and all per player:

- `look` — `world` (default), `book` or `core`, per the sections above. Sets
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
| `scripts/lib/senses.mjs` | Reading ACKS senses off the sheet, and what each grants. |
| `scripts/lib/perception.mjs` | What those senses ARE to Foundry: vision modes, detection modes, and the two status effects the rules need. |
| `scripts/lib/light.mjs` | The RR light table, and which record holds a given actor's lights. |
| `scripts/lib/token-sync.mjs` | The guarded writes that put any of it on a token. |

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

`brightestLightReaching` (`scripts/lib/light.mjs`) answers what that light is — the
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

## Carrying: mounts, teams and everything aboard

One relationship covers every actor carried by another
([attachment.mjs](../../scripts/lib/attachment.mjs)): a flag on the CARRIED
actor naming its carrier, the STATION it works, and — for an animal in
harness — the KIND it pulls as. A rider on a horse, a passenger in a wagon,
an ox in the traces, a rower at a bench and a canoe lashed on as cargo are
the same binding, which is why a rider whose horse is harnessed to a wagon
moves at the wagon's pace: chains resolve to their ROOT. One flag per actor
makes the graph a forest by construction, `attach` refuses a carrier whose
chain already contains the actor, and the reverse index is a cache that is
re-verified against the flag on every hit — never the truth.

[mount.mjs](../../scripts/lib/mount.mjs) is a permanent FACADE over that one
model, not a second one: it keeps the mounted-combat vocabulary
(`mountActor`/`dismount`/`mountOf`/`riderOf` and the `acksLibMounted` /
`acksLibDismounted` hooks) that acks-equipment's overlay was promised, and
implements it as a `rider` attachment. Worlds written before the
unification still read: a legacy symmetric mount/rider pair answers
`mountOf`, and every write converges it to the single flag. A rider whose
attachment exists is never also read from a stale pair.

### What a mount knows about itself

The `acks-extras.animal` sub-type ([data/animal-data.mjs](../../scripts/lib/data/animal-data.mjs))
carries the two facts the mounted rules ask of a creature, and they are
different questions:

- **`animal.training`** — what it was trained for (`ANIMAL_TRAINING`:
  untrained, riding, draft, war, hunting, herding). A war-trained mount
  joins its rider's charge; an untrained one does not.
- **`animal.mountable`** — whether it can be ridden at all, which is a fact
  about the species rather than its schooling: an ox is mountable in
  principle and untrained in practice, and a war DOG is trained for war and
  is still not a mount.

**What it CARRIES is a third question, and it has exactly one store.**
`capacity6()` reads `flags[MODULE_ID].extras.load` — the pair the monster
sheet already edits under Rating & Saves — so that is where a mount's normal
and maximum load live, and where acks-importer writes the loads it reads from
the creature's own printed description. The animal sub-type's like-named
`capacity6` / `unencumbered6` fields are LEGACY: no consumer reads them and
nothing writes them, and filling them would make a mount look provisioned
while `capacity6()` still answered null.

The GM-entry surface for `training` and `mountable` is the Full Monster
Sheet's **Animal tab** — `docs/monsters/MODEL.md`. It is a monsters surface,
not a lib one: an animal's default sheet IS that sheet.

Both training and mountability arrive by import. The RR prices animals BY ROLE — a "Heavy War" horse,
a "Draft" mule, a "Riding" camel — so the qualifier in the name the book
printed is its statement of training, and acks-importer reads it there
(`trainingFromName`); mountability is taken from the species having a
riding form priced in that same book (`mountableSpecies`). A field the book
supplies directly always wins over the name. Nothing about which animals
exist, what they cost or what they carry ships here.

`training` initialises to `untrained`, which is the schema's default rather
than a claim — so consumers read it as UNSTATED and may fall back to the
name. That is why `looksWarTrained` treats `untrained` as "not stated" and
consults the name, while any explicit non-war training is authoritative
over it.

### Teams

A team is counted in HEAVY-HORSE EQUIVALENTS, so the heavy horse's own value
is the unit's definition and ships; what every other draft kind is worth
against it is printed (RR ch. 4 substitutes oxen, mules and medium horses at
stated rates) and reads from the `travel` document's `draftEquivalents`
table. Unimported, a team of heavy horses still counts and every other
animal is UNPRICED — contributing nothing and named on the sheet as
unpriced, rather than being guessed at. `DRAFT_KINDS` in the vehicle model
is the structural key list only.

Which equivalence class a harnessed animal belongs to is stated by its
attachment when it was hitched; `guessDraftKind` is a NAME-form fallback for
an animal that never said, and is a convenience, not a source of truth.

## The world clock

`scripts/world-time.mjs` owns the module's one clock policy: the
`advanceWorldTime` world setting and the `mayAdvanceWorldTime()` predicate that
gates every `game.time.advance` the module performs. Two features spend the
clock — formation's dungeon turns (a minute per bookkeeping round) and the
location sheet's "Advance 1 week" button — and both go through this gate, so a
GM whose table runs Simple Timekeeping or a calendar module answers once.

The setting is registered here, in `module.mjs`, rather than by either feature.
Each feature still decides its own step size and what it does when the gate is
shut.

**Watching the clock is the other half, and it is shared too.**
`onWorldTimeAdvanced` registers a callback on the one GM client responsible for
acting on a change — henchmen's downtime processing and formation's holed-up
city stays both ride it. The "am I the active GM" test is what stops a two-GM
table processing the same day twice, so there is exactly one copy of it;
`henchmen/time.mjs`'s `onTimeAdvanced` is a name its engine kept, delegating
here. Callbacks are idempotent by contract — the hook fires for a calendar the
Judge dragged as readily as for a rest — so each keeps its own watermark.

## Effects the module maintains

Two effects on a character are machinery rather than notes: the class's combat
training (`flags.acks-extras.fromClass`, a copy taken when the class was
applied) and the equipment loadout (`flags.acks-extras.loadout`, derived from
what is equipped). `managed-effects.mjs` holds a registry of those markers —
each feature claims its own at init — and three things follow from a marker:

- **Deletion is refused.** `preDeleteActiveEffect` cancels it and says which
  owner maintains the effect. The module's own deletes pass `managedDelete()`
  in the operation options and go through; an option travels with the single
  call that asked for it, where a global unlock would stay open across every
  `await` in the sync path.
- **The sheet shows a lock** where core drew the trash, on any sheet listing
  effects. It is the sheet declining to offer a refused gesture, not the gate.
- **Everything else is untouched** — editing, clearing the changes, disabling.

Emptying means different things by owner, and neither is hidden: training is a
copy, so an emptied one stays emptied until the class is applied again; the
loadout is derived, so an emptied one refills at the next recompute.

Deleting the ACTOR still works — Foundry's cascade does not route through the
per-effect refusal.

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

## The consolidated initiative card

`scripts/lib/patches/initiative-card.mjs` does for a round's initiative what the
patch above does for surprise: one card, one row per roll, highest first, in
place of core's message per combatant.

The roll and the GROUPING are both core's. `AcksCombat#rollInitiative` already
rolls a single `1d6+bonus` for a combat group and writes that total to every
member; what it cannot do is show it. The group's one roll is announced under
whichever member came first in its loop and every other member is silent, so a
grouped roll and an individual roll are indistinguishable in the log — which is
what makes a grouped fight read as though everyone rolled separately. The card
is where the grouping becomes legible: a group is ONE row, labelled as the
tracker labels it (`[G0]` → Group 0) and listing its members underneath.

Nothing is grouped automatically. Which combatants share a roll stays the
Judge's explicit choice through core's own tracker control — stacks, a summoner
with their summons — and this patch only reports what that choice produced.

Three details are load-bearing:

- **The rows are read off the COMBATANTS after core has written them**, not off
  the captured messages. A member who took the group's number is one core
  printed nothing about, and reading the messages alone would drop them from the
  card that exists to show they were there.
- **The group flag is read as a plain property, never through the flag
  accessors.** The system owns `flags.acks.groups`; a bare read cannot create,
  rename or write that namespace, and it is what the namespacing gate
  (`validate-extra`) is protecting.
- **Nothing is posted where core posted nothing.** Rolling combatants that
  already carry their group's number produces no message and no card.

`renderRollCard` prints the Result column only when a row carries an outcome, so
this card is Name and Total — initiative has no verdict to render. The
`initiativeCard` world setting gates the patch, read per roll.

## Movement modes

Three speed derivations grew independently — a march, a voyage, a flight — and
each grew its own opinion about which factors apply. That is three places to
change when a factor arrives and three chances to disagree.
[movement-modes.mjs](../../scripts/lib/movement-modes.mjs) is the middle they
were missing. It composes; it never prices.

Each mode declares the ORDERED layers it consumes, and the order is the rules'
own — a road multiplier lands after the terrain it passes through, because a
road makes bad country passable rather than good. Two shapes fall out, and they
are the two the family needs:

- **An adjustment.** A vehicle is a march with gates: it meets every factor a
  walker meets, then refuses some ground outright.
- **An independent layer.** A vessel meets no land factor at all — no terrain,
  no road, no footing — so it declares its own layers and the land stack is
  never consulted.

A flier is neither, which is why this was needed. RR prints the terrain
multipliers under Flight Speed, so a flier DOES meet the country below it; it
refuses roads, since there is no road at altitude; and weather applies as it
does on the ground with wind the stated exception.

That exception is the one subtlety. Superseding is not declared by the mode:
the part that supersedes names its own victim (`supplants`), because only the
layer contributing a special case knows which general case it stands in for. A
flier's wind therefore REPLACES the ground's rather than multiplying with it —
and if no flight-wind rule was imported, nothing is supplanted and the flier in
a gale still feels the ground's wind rather than none at all.

Refused parts are dropped LOUDLY, with the reason. Handing a vessel a terrain
multiplier is a caller bug, and a readout that quietly swallowed it would hide
the bug behind a plausible number.

## Survival

Hunger and thirst as ladders a day at a time
([survival.mjs](../../scripts/lib/survival.mjs)). Its own subsystem rather than
part of travel, because starving reaches well past a march — a besieged
stronghold starves, and so does a prisoner. Formation AUTOMATES it for a
marching order; it does not own it.

Two ladders, different shapes because the rules make them different. **Food has
three rungs and climbs slowly**: short rations bite first as a penalty on every
throw, going without long enough stops a body healing and forbids a forced
march, and longer still it costs Constitution to death. **Water has one rung
and arrives fast** — there is no thirsty-but-fine step.

Two behaviours are worth stating because they are easy to get wrong:

- **A full meal steps a starving body DOWN, not clear.** Rescue is not
  recovery, and the rule says so. A full day's water, having only one rung to
  fall from, ends dehydration outright.
- **The clocks only climb.** Half rations reset the went-without counter, which
  would otherwise re-derive a lower rung and quietly heal a starving character
  who ate half a meal.

**The weather is a third pressure, and it is not one shape.** Cold makes a
CONDITION the body carries — hypothermia, which ticks by the HOUR rather than
the day, forbids a forced march and natural healing, and ends only at a fire.
Getting wet skips the clock entirely, however well dressed. Heat makes
MODIFIERS instead: more water needed per person, a worse drain once it runs
out, and a saving throw for anyone under heavy armour. Forcing them into a
matching ladder would misstate both, so they are modelled apart.

The heat's extra thirst is felt where it should be — in the POOL. `dealProvisions`
takes a per-mouth `need`, so a party crossing a desert finds the same skins
covering fewer days without anyone drinking faster.

An unimported subsystem starves nobody: with no thresholds the ladders do not
advance, though the clocks still run, so importing later starts from the truth
rather than from zero.

