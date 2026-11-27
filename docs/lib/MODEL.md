# Library — Design Model

`lib` is the module's shared-primitives subsystem (`scripts/lib/`). It exposes
vocabulary, DataModel field-builders, the core patch layer, and the actor
sub-types the module owns — the surfaces more than one feature reads. Anything
only one feature needs stays with that feature.

- **Reuse**: the `acks` system's damage/save vocabulary and (via the
  `game.acks?.lib` shim) any surface later upstreamed into core.
- **Extend**: the shared ACKS effect/ability vocabulary (`vocab.mjs`, with
  the magic families in `magic-vocab.mjs`) and its DataModel field-builders
  (`fields.mjs`) — the target the abilities and monsters features build their
  models from.
- **Enhance**: the plumbing every feature would otherwise duplicate —
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
  homebrew class lives there with the template package it builds, and so does
  whatever an earlier release wrote there.
- `libraryPacks(type)` — the shelves this seat can open, unlined first.
- `seatOpens(pack)` / `openPacks(type)` — whether this seat can open a pack
  (core's `visible`), and every pack of a type it can. Every scan of
  `game.packs` for content goes through `openPacks`.
- `libraryPackLabel(type, line)` / `findLibraryPack(type, line)` /
  `isLibraryPack(collection)` / `lineOfPack(collection)` — one shelf by its
  label, and whether a document's `pack` is one of ours (and which line).
- `byCookbookId(type, id)` — the id lookup, skipping template parts. A skinned
  copy inherits the id of the definition it was made from, so a plain id search
  finds one class's engraved silver waterskin where the shared Waterskin was
  meant.
- `whenReady()` — awaits the warm, for callers that can.
- `libraryDocsWhere(type, match, {except})` — the narrow, async reader: the
  documents of a type that pass `match`, with no whole-shelf load, and a
  `failed` list on the answer (below). `shelfIndex(pack)` is one shelf's index
  through the shared read.

**A seat's library is the shelves it opens, and a closed shelf is not a
secret one.** A Judge's shelf (`judgeLine`) is made with
`JUDGE_SHELF_OWNERSHIP`, NONE for every player role. On core 14 that keeps
the pack out of a player's Compendium Packs sidebar and refuses a player its
documents' sheets and every write. It refuses no read: the server answers a
`getIndex`, `getDocument` or `getDocuments` from any seat, every seat holds
every pack's index from connect, and module code runs on clients, so nothing
this module ships stands in front of that. What the module does is leave a
shelf the seat cannot open out of its own reads: the warm asks the server for
none, `libraryDocs` and `byCookbookId` answer with no document of one, and a
lookup that would have found its document there finds none. A Gamemaster and
an Assistant open every shelf. Whether a pack is one of the library's
(`importedPacks`, `findLibraryPack`, `isLibraryPack`, `lineOfPack`) is asked
of every shelf, since it reads nothing of the shelf's content. The ruling is
importer DECISIONS, 2026-11-15.

The reads are **synchronous**, because their callers are sheet getters and
`_prepareContext` bodies. That is paid for by warming the packs at `ready`
(`registerLibraryWarm`, called from the lib module's own ready hook):
`getDocuments()` instantiates them, and a read afterwards is a filter over
memory — the same cost the `game.items` reads had. The warm starts a macrotask
after it is registered, so every `ready` hook has begun its own narrow read, and
then waits until no narrow read (`libraryDocsWhere`) is in flight; the weapon
rows and the class registry read the library that way at `ready`, so the
whole-shelf loads follow them rather than queue beside them (a narrow read that
never settles holds the warm back, and a synchronous reader still loads its own
shelf on demand). `registerLibraryWarm` marks its start
(`WARM_MARK_STARTED`). A pack that is cold (the
importer creates its packs on first use, and core emits no hook when a
compendium is created) starts loading in the background and the read answers
with what is in hand.

**A warm shelf does not stay warm.** Foundry evicts a compendium's instantiated
documents `CompendiumCollection.CACHE_LIFETIME_SECONDS` (300) after the last
`pack.get` or `pack.set` — a debounced `clear()` that `super.delete`s every
document with no rendered application, leaving `pack.index` whole. So `isCold`
becomes true again on a repeating five-minute cycle, and it stays true through
this module's own traffic: the reads here take `pack.contents`, which is a bare
`values()` iteration and does not go through the overridden `get` that re-arms
the timer. Foundry keeps the collection current as documents are created and
deleted; it does not keep it populated. Measured on 14.367: eight of nine
imported shelves at `loaded: 0` with their indexes intact after one idle window.

The consequence for callers is that **cold is the normal state, not the opening
seconds of a session**, and a read that happens to be complete is not evidence
that the next one will be.

**The narrow reader answers from the index.** `libraryDocsWhere(type, match,
{except})` returns the world's documents that pass `match`, then each shelf's
(`libraryPacks` order). Per shelf it awaits one `pack.getIndex()`, tests every
index row, answers the documents the shelf holds as they are (`pack.get`), and
loads the rest in one `getDocuments({_id__in})`; a shelf's matches come back in
its index order. It never calls `loadPack`, so `libraryCold()` stays true
and the synchronous readers' own background load is untouched. `match` is
handed `{_id, id, uuid, name, type, flags}` for a world document and an index
row alike and never `system`: core returns an index result as stored, with no
`fromSource` (`client/data/client-backend.mjs`, the `operation.index` branch),
so the system's migration of a document's record (docs/lib/DECISIONS.md, "The
system migrates a stamped record") has not run on a row. A shelf that cannot be read
is reported and the others answer; the answer carries `failed`, the collection
ids of the shelves left out (a non-enumerable property of the array), so a caller
that publishes from it tells "the read failed" from "none match" and does not
publish a short list as whole. Every compendium query is a full pass over
the pack on the server, a `getDocument` included, so a loop of them is a scan
per id and the one `_id__in` is the batch. Core does not share a pass between
concurrent callers, so `shelfIndex(pack)` holds one `getIndex()` per pack while
it is pending and every reader that arrives meanwhile awaits it: the weapon rows
and the class registry, reading at the same `ready`, scan the Item shelf's index
once, and each then loads its own ids in one `_id__in`. The pending read is
dropped when it settles, a rejection included.

**A republished document is read again from the index.** The weapon rows and the
class tables publish a registry document from library documents and republish it
when a library document of theirs is created, updated or deleted. A republish
never takes "the documents held": after the cache lifetime evicts a shelf only
the changed document is held, and a document built from it alone would publish
short. `lib/republish.mjs` coalesces the hooks into reads through
`libraryDocsWhere`: one read per burst, starting `debounceMs` after the burst's
last hook and no later than `maxWaitMs` after its first, a hook that lands during
a read read again after it, the read held behind the feature's first publication,
and a deleted id left out of the next read (its hook can fire while the
collection still lists it). An answer with a non-empty `failed` is not published:
the document stands as last published, a warning says so, and the ids deleted
meanwhile stay left out. A first publication has no earlier one to keep and
publishes what the shelves that answered hold. `whenCurrent()` is how an action
waits for the republish its change causes: it resolves once a read that began
after the change has been applied, so a long import's steady hooks do not hold an
action back past the cap.

The stamps the readers match on are **declared, never passed**.
`declareLibraryIndexFields()`, run at `init`, adds `LIBRARY_INDEX_FIELDS` to the
index fields: `flags.acks-extras.cookbook.id`, `.cookbook.merged` (the ids a
document absorbed on merge) and `.templatePart` for Items, to
`CONFIG.Item.compendiumIndexFields`, beside the family plate on
`CONFIG.Actor`. A pack's startup index holds core fields only; its first
client `getIndex()` after the declaration is one more server pass, and from then
on core builds each index row with the declared fields on every create, update
and re-import of a document it holds, and drops the row on a delete
(`CompendiumCollection#indexDocument`, called from `_onCreate` and `_onUpdate`).
A field passed to `getIndex({fields})` by one caller would be missing from the
rows another caller's `getIndex` rebuilds, so no caller passes one. An
undeclared flag is absent from every shelf row and matches nothing, silently.

**A caller that would be WRONG for the life of its window must await instead.**
Answering with what is in hand assumes the caller renders again; a surface that
never re-renders — core's Scores Generator is the one that bit — turns a
half-warm read into a permanent wrong list. Such a caller awaits `whenReady()`
**unconditionally, before its first read**, and pays one already-settled promise
when nothing is cold.

Never gate that await on the library reading empty. `libraryDocs` answers from
the world sidebar ahead of every pack, so a world holding one homebrew document
of the type makes an evicted shelf read as a stocked one and the emptiness test
never fires. **Emptiness is not coldness**, and a membership test for the one
document a caller came for is not coldness either — finding it says nothing
about the rest of the list.

Consumers: the class registry and `findByRef`, the race list, proficiency
grants, the language resolver and its migration, the ability sheet's relation
labels, and template-packages' source resolution — where `findSource` reads
`linkable` off `doc.pack` rather than assuming it, because a ref now resolves
to either side and only a sidebar document or one on a library shelf may be
LINKED rather than copied.

### Writing to the library

Three writers put documents on the shelves — the importer, the classes
feature's template packages, and the location feature's materialized rules
tables — and every one opens its shelf through `lib/library-target.mjs`:
`ensureLibraryPack(type, line)` finds or creates the pack for a type and line
and files it under the line's sidebar folder (`fileImportedPack`);
`ensureFolderIn(pack, type, names)` makes a stamped folder path inside it, two
deep at most, which is what a pack allows. The importer keeps its own confirmed
cache in front of the opener; the feature writers open a shelf once per run. A
derived document lands where its import lives: a class held on a shelf builds
its package on that line's shelves, the rules tables land on the ACKS RollTable
and JournalEntry shelves, and only a Judge's own sidebar class keeps its parts
in the sidebar. The ruling is [DECISIONS.md](DECISIONS.md) 2026-09-10.

## The compendium sidebar

`lib/compendium-folders.mjs` decides where every ACKS pack sits, and reads each
package's own manifest `packFolders` to do it — the system's declaration for the
system's packs, this module's for this module's. Neither states a folder name
belonging to the other, and a system release that re-shelves its own compendiums
re-shelves them here with nothing to change.

Two strengths:

| | `organizeCompendiumFolders()` | `restoreCompendiumLibrary()` |
| --- | --- | --- |
| When | every load, in the window that automates ("Which window automates"); or a GM's API call | the *Restore the Compendium Library (GM)* macro |
| Claims | a pack with no folder, or one naming a folder that is gone | every ACKS pack |
| Per-pack config | untouched | reset to the package's defaults — sort, lock and ownership grants dropped |
| Empty folders | never made, never removed | the ones it empties, and any empty shelf inside this module's own tree |

Foundry files a package's packs once, matches a folder by hierarchy NAME, and
skips a pack whose configuration already names a folder — so a folder deleted
long ago strands every pack that named it at the sidebar root permanently. Both
strengths exist to answer that; the gentle one repairs it, the macro overrules
whatever a world has become.

A restore writes only what it changes. It compares each pack's entry with the
one it would leave — the folder alone, or for a Judge's shelf the folder and
the shelf's closed ownership — and passes over an entry already in that state.
The macro's message counts the packs it filed, and a library already in order
is not written at all.

Planning is separate from building: a folder is created only where a pack is
actually being written to it. That is what stops the gentle pass from growing a
second empty copy of the tree at every load, and it is also how a per-line
import shelf works — the importer's world packs are filed under this module's
folder in `From your books`, and a series' own folder (`The OSR Catgirl`) is
made by the first pack that needs it. A Judge's shelf sits one level further
in, in a `Judge` folder inside its series' folder, or inside `From your books`
itself for the ACKS library's. The ACKS library carries no series in its label
and gets no series folder; it is the default shelf. The open folders take the
colour of this module's declared root and a `Judge` folder a grey of its own,
so the GM-only shelves read apart; a restore puts both back on folders a world
has re-coloured, inside this module's tree only. The
importer calls `fileImportedPack` from `packFor` at the moment it mints a pack,
so a new shelf and its pack appear together.

A configuration entry holds a folder open only while its PACK still exists. A
world keeps the entry of every pack it has ever had, and a dead one would
otherwise pin an empty shelf open forever; those are dropped with the folder
they named.

## Theming: one palette, three layers

Every colour any ACKS surface draws comes from an `--acks-*` token. The one set
of hex literals in `styles/` is the travel weather chips' three hues in
`formation.css` (cold, hot, mud), each mixed into `--acks-rule-color-soft` so the
border still follows the seat; no token names a temperature. `styles/` reads none
of Foundry's *legacy* `--color-*` variables. That set is defined once globally in
v14 with no theme scoping, so those names are light-theme constants and cannot
follow a dark seat. The *modern* v14 variables — `--color-text-primary`, `--color-border`,
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

**A window in a detached browser window is marked like any other.** Core
builds a window's frame with the document of the browser window that hosts it.
A window first rendered inside a detached one therefore has a root that
window's document built, and no constructor of the main window calls that root
an instance. The hook takes its root through `elementOf` (`util.mjs`), which
tells an element by its `nodeType`, so the mark lands there as it does in the
main window, and keeps landing after core brings the window back. The detached
page has what the mark needs: as it opens, core copies into it the main page's
stylesheets and the attributes of its `<html>` and `<body>`, and from then on
this module writes its pins there as it does in the main page (below, "The
pins are written to every page the client draws in").

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

**`core` hands the capitals back, and every label's case is a token.** Each label
that sets capitals writes `text-transform: var(--acks-caps)`; `tokens.css` sets the
token to `uppercase` and the `core` block sets it to `none`, so the label reads as
its lang string is written. Three seams carry the rest of the lettering, each
declared only in the `core` block: `--acks-caps-font` (Foundry's body face,
`--font-sans`), `--acks-caps-weight` (the medium weight) and `--acks-caps-tracking`
(zero). A capitals rule reads `font-family: var(--acks-caps-font, <its own face>)`,
and likewise for its weight and for a letter-spacing it hard-codes in `em`. Under
`book` the seam is undefined, so the fallback, the rule's own value, is the one
that applies; replacing each seam read with its fallback and the token with
`uppercase` returns the stylesheet to the text it had before. A rule that sets no
face, weight or tracking of its own has no seam for that property and inherits as
it always did. A `font-variant: small-caps` label reads
`var(--acks-caps-variant, small-caps)`, which the block sets `normal`. A rule
whose face is already `--acks-font-ui` or `--acks-font-body` needs no face seam,
since the block re-points those at the same body face. The seams read a token with
a fallback on purpose, because the missing token is what selects `book`. A literal
`text-transform: uppercase` in `styles/` or `vendor/acks-design/` fails
`validate` (§ 8h), and `/* caps-ok: <reason> */` declares a capital that must stay
in both looks.

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
warm black; distinctions a hue could carry — magical vs mundane, GM-set vs
by-the-rules — are carried by the glyph, the glyph's weight, or the rule weight.
`--acks-gold` is the one accent beyond the spot colour, and it is a real measured
token, not a per-feature invention.

### The UI preset: whose defaults the world opens on

One world setting, `uiPreset` (`lib/ui-preset.mjs`), chosen by the Judge from a
startup prompt or Configure Settings: `foundry`, `acksCore` or `acksExtras`
(the default). It is two defaults in one:

- **The world's look.** `foundry` is the `core` look below; the other two are
  `book`. A client's own `look` setting reads `world` by default and defers to
  it; `effectiveLook()` is the one resolver, and every reader asks it rather
  than the client setting.
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
`core.sheetClass` flag.

One kind of type is outside the ladder's reach in the other direction: a
sub-type this module DEFINES (`acks-extras.*`) tries this module's rung only,
whatever the preset names. The system registers its item sheet for every Item
type, but it builds a type's details partial from the type's own name, so it
throws on a type it does not define — a preset would trade a different look for
a window that never opens. [sheet-claim.mjs](../../scripts/lib/sheet-claim.mjs)
holds the other half: the same types take their default back at ready where a
stored pin has it, since a stored default outranks every later registration. Applying a preset — from the prompt, or by changing
the setting through Configure Settings, whose `onChange` performs the same
drop on the primary GM — drops the pins that name a ladder sheet so the
ladder governs again, and leaves a third-party pin standing; a type whose
current default is outside the ladder is left alone too.

The prompt (`promptUiPreset`) fires once per world for the primary GM, until a
choice is applied or *Keep as is* is pressed — both set the hidden
`uiPresetPrompted` world flag. Closing the window sets nothing, so it asks again
at the next launch. Applying offers Foundry's own reload-all confirmation, since
an embedded item's sheet is not re-resolved until then.

**Four client settings drive it**, all in `lib/module.mjs` and all per player:

- `look` — `world` (default), `book` or `core`, per the sections above. Sets
  `data-acks-look` on `<html>`, toggles the body class, and re-dresses open
  windows. `applyLook()` is the single place the look, the theme pin and the
  dress are applied. `applyClientPins()` adds the type size, and `ready` calls
  it rather than setting anything itself.
- `theme` — `follow` (default), `light`, `dark`. Pins `data-acks-theme` on
  `<html>`; `follow` removes the attribute so Foundry's own scheme governs.
  **Stands down under `look: core`**, and must: the tokens then resolve to
  Foundry's own theme-aware variables, so the seat's light and dark are Foundry's
  to decide, and a pin here could only put the ACKS palette back underneath the
  host's. It is also what keeps one authority choosing ground and ink inside a
  window this module does not dress.
- `sheetStyle` — `full` (default) or `palette`, per the table above. Not
  consulted under `look: core`.
- `fontScale` — writes `--acks-fs-base` inline on `<html>`, rescaling every ACKS
  surface from one knob. It survives `core`, because size is a player's own
  accessibility knob rather than part of the look; the ACKS *faces* do stand down.
  Surfaces reach it two ways: off the `--acks-fs-*` ramp, or — for the two
  sheets transcribed from a px design canvas — through `--acks-extras-k`, the
  same knob as a ratio, published on `.acks-extras` in `styles/lib.css` and
  read in JS as `typeScale()` / `atTypeScale()` in `util.mjs`. `validate` §8c
  is what keeps a new size from quietly leaving the knob behind.

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

**The pins are written to every page the client draws in.** A detached browser
window is a second document. Core gives it the main page's `<html>` and
`<body>` attributes as it opens and again at its own interface pass
(`game.configureUI`), setting each attribute the main element has and removing
none, so a pin released in the main page alone would stand in a detached one.
The appliers decide what holds and `client-pins.mjs` writes it. `clientPages()`
answers the main document and the document of each detached window core lists,
read at every call, and `pinLook`, `pinTheme` and `pinFontScale` set or release
one attribute, one class or one custom property on each. None of them copies a
whole `class` or `style` value: a detached `<body>` carries core's own
`detached` class, and the main one does not. A window that has closed stays in
core's list for about a second, and is passed by. `applyClientPins()` runs at
`ready` and on core's `openDetachedWindow`, because core copies the attributes
before it lists a window, and a setting changed between the two reaches neither
the copy nor the list.

**Core's own mark on a detached page is kept.** Core adds `detached` to a
detached `<body>` as the page opens, and four of its rules key on it, the
page's ground and the lift of a window's size cap among them. Its interface
pass then writes the main `<body>`'s whole `class` over the detached one, and
the main one has no such class. `keepDetachedMarks()` puts each detached
`<body>` under a `MutationObserver` of that page's own window, once, and adds
the class back whenever a write to `class` leaves it out. The answer runs in
the microtasks the write queued, which the browser empties before it draws
again. It tests for the class before it writes it: a write to `class` queues a
record whether or not the value changed, and an untested write would answer
its own record without end. `applyClientPins()` calls it, so a page comes
under watch as core lists it. Nothing of core's is wrapped.

## The sheet frame

Every actor sheet this module draws has one shape, stated once:
`scripts/lib/frame.mjs` (the Foundry half), `scripts/lib/frame-model.mjs`
(the decisions, on plain data), `templates/lib/frame/` (the partials) and
`styles/lib-frame.css` (every rule, hung off `acks-extras-frame` and its
`__` members). A sheet on the frame extends `FrameMixin`, adds the frame's
root class beside its own identity class, and renders two parts: a `band`
from the frame's band partial, and a body of its own that includes the
frame's `rails`, `folded` and `tabs` partials. What each sheet SHOWS in the
band and the rails is that sheet's model to decide
(docs/character-sheet/MODEL.md, "The frame"; docs/monsters/MODEL.md, "The
sheet"); what follows is the mechanics every one of them shares.

**The band is the window header.** The band renders as its own part and the
mixin's `_onRender` moves it into Foundry's `.window-header` through
`header-band.mjs`, so the header stays the drag handle and keeps its buttons
while the band's name field lives in the form. The band carries a glyph
button, a rank before the name, the name field, chips, and in the bar's place
either a filling bar (the character's XP) or a plain reading (`is-reading`).
A chip is `{action, attrs, icon, label, title, tone, dot}`; `dot` draws the
red mark after the label that says something is owed on the chip's subject.
The bar and the reading are readings, not controls: no action, so a press on
either falls through to the header and drags the window.

**The art row** is the two rails around the portrait (a sheet may add a third, `cells.cast`, beside the right rail, which the monster sheet leaves out), the prose column and,
for an owner, the sheet-tools rail. A rail cell is one object the cell
partial draws — `{key, action, attrs, cls, fill, title, icon, big, img,
inside, hands, joined, sub, corner, count, disabled, tipText, label}` — so a sheet decides a
cell's reading in its model and its glyph and action in its context, and
never writes cell markup. `attrs` is rendered raw: a sheet builds it through
one escaping helper. `tipText` is a tooltip assembled at render, written as text and taking `title`'s place; `label` is the cell's accessible name.

**The fold** hides everything but the band (compact, with no bar), the
portrait and the rails, and puts the pin bar under the art row. The fold
state is a user flag (`FOLD_FLAG`) keyed by document id, written as an
explicit true or false because `setFlag` merges; a viewing preference lives
with the viewer, so an observer seat can fold a sheet it cannot edit. The
window is resized after render, once the root carries `is-folded`, to the
sheet's `FRAME_WIDTHS` at the seat's type size (`atTypeScale`); the open
sheet's minimum width would otherwise clamp the card's.

**The pins** are the document's sheet flag (`SHEET_FLAG`): `pins`, the roll,
timer and resource ids starred for the folded bar, and `acMode`, the AC
reading the rail cell states. The document's own data, so owner-written;
`_togglePinId` stars or unstars one id.

**Read-only seats.** DocumentSheetV2 disables every form control on a sheet
the viewer cannot edit. The mixin re-enables the actions its `VIEW_ACTIONS`
names afterwards — the frame's fold and tab change, and whatever the sheet
lists beside them: a menu, a roll, a window opened — so an observer can
fold, browse and roll while every write control stays disabled.

**Focus across a press.** A part's HTML is replaced on render, so the control
a user pressed is detached and focus falls to `<body>`. The mixin notes every
`[data-action]` click in the capture phase (ahead of the action's handler) and,
in `_postRender`, focuses the same control in the new DOM (`press-focus.mjs`).
The control is matched by its `data-*` set less the tooltip pair, and by its
position among controls that repeat that set; it is focused only if the press
was recent, focus was inside the window at the press and is lost now, and the
control exists as before. A press stays remembered through every render it
causes (one press can write twice) until the window after it lapses or a
render finds focus held elsewhere. Anything else leaves focus alone.

**The menu under a rail cell** (`_frameMenu`) is one row per option, the
current one marked; a click picks, a click anywhere else closes. It is built
by the anchor's own document, so a sheet first rendered in a detached
browser window gets a menu of that window's. A pick hands its handler the item and the click that picked it.

**The type knob.** Every length in the stylesheet is a canvas figure times
`--acks-extras-k`, the ratio of the seat's base size to the canvas's
(`.claude/rules/ui-layout.md`, "A base-derived ratio"); the window's opening
widths take the same ratio in JS. The frame scrolls at its body part's root,
not at `.window-content`, because a sheet whose fields submit on change
needs scroll retention and only a part has it.

## Label association

Every rendered window binds its captions to their controls. `a11y.mjs`'s
`associateLabels` walks the rendered root; for each
`<label>` that carries no `for` and wraps no control it finds the control the
caption fronts, mints an id on it seeded from the window's own root element id,
and points the label at it. Foundry's `createFormGroup` does the same thing for
a group built from a DataField — this covers the hand-written groups and the
dialogs whose body is a template literal, which is nearly all of them.

The binding is made at runtime because the id has to be unique per WINDOW, not
per template. Two copies of one sheet are ordinary, so a literal `id=` in a
`.hbs` makes the second window's label focus the first window's field; and
`templates/lib/follower-card.hbs` fronts an `<input>` or a `<span>` from one
caption depending on `editable`, so no static `for=` is right for both.

The hook is registered at `ready`, not at import. `renderApplicationV2` handlers
run in registration order and every feature injector registers its own at import
time, so ready-time registration is what puts this one last and lets it see the
DOM the injectors added. The two async injectors, which land after any hook,
call `associateLabels` on the fragment they just built.

**It runs on every window, not only this module's.** The system's sheets and
Foundry's own configuration windows carry the same defect, and this module
already repairs what it finds in the layers beneath it. What a repair does is
bounded: it ADDS an id where there is none and a `for` where there is none, so a
host that sets its own later is unaffected, and a `<label>` the host left naming
nothing stays as the host wrote it.

Two shapes overrule what the host wrote, because in both the host's binding
cannot work and the reader is left with a field that has no name at all. A `for`
naming an id no window holds is treated as absent, and the caption is bound to
what it actually fronts. Of two controls sharing one id — the same literal-`id=`
collision the templates are gated against, arriving from a template this module
does not own — the later one is re-minted and the caption sitting WITH it is
carried across, since `getElementById` was handing that caption its neighbour's
field. Both are measured, not theoretical: the ACKS character sheet ships two
inputs under one `climb` id, and its monster header a `for` for an id nothing
writes.

One shape it leaves alone on purpose: a caption over a GROUP of controls, each
already in its own `<label class="checkbox">`, finds no candidate — a control
inside another label is excluded — so a heading never ticks its first member.
A `<button>` is a last resort rather than an exclusion: label activation
forwards a click, so a field always wins the binding where the group holds one,
and the button takes it only when the group holds nothing else. Core's settings
menus are rows of exactly that shape.

A group holding more than one control gets its caption bound to the first and
the rest named after it with `aria-labelledby` — `for` names a single id, so
binding alone leaves a seat height or a chat channel silent beside the width or
the toggle that took the caption. Naming forwards no click, which is why this
second route may read a caption the binding must refuse, such as one inside a
rollable header.

A `<label>` that fronts nothing is a template bug rather than this pass's work,
and is written as a `<span>` where it stands. So is anything clickable inside a
`<summary>`: a summary is a disclosure toggle, it swallows or is swallowed by
whatever is placed in it, and controls belong in the body it discloses. Both,
and the literal `id=`, are gated in this repo's own templates by
`tools/validate.mjs` §8d–f (`.claude/rules/ui-layout.md`); the runtime pass is
what answers for every window this repo does not author.

## A window title cut short

A window title wider than its header ends in an ellipsis. On an ACKS surface,
`window-title.mjs` shows such a title whole in Foundry's tooltip while the
pointer rests on it.

**Bound once per window, from the marking hook.** The `renderApplicationV2`
hook that marks ACKS roots hands each root it marks to `watchWindowTitle`. A
window's frame is built once and outlives its renders, so the title element is
the same on every pass, and a `WeakSet` of watched titles keeps a later render
from binding again. The watch is three listeners on the title itself:
`pointerenter`, `pointerleave` and `pointerdown`.

**Everything is read when the delay runs out.** The pointer's arrival starts a
timer of the manager's own `TOOLTIP_ACTIVATION_MS`. When it runs out,
`clippedTitle` asks whether the root wears `acks-ui` or `acks-palette` at that
moment, and whether the text overflows its box. Nothing about the window is
kept from render time, so a window resized, minimized, re-titled or re-dressed
by `applyLook` since then is answered as it stands. Arriving from a tooltip
that is already showing, a header control's for one, the title's follows at
once, as the manager moves its own.

**Cut short is read twice.** `scrollWidth > clientWidth` is the box's own
reading, in whole pixels, and it counts a title's padding. The second reading
is the width of the title's contents, taken from a `Range`, against the width
of its box, in fractions of a pixel. Either one is enough.

**The tooltip is the manager's.** `game.tooltip.activate` is called with the
title's text as `text`, which the manager writes as text and never as markup.
It is asked for above the title. Where the viewport's top leaves no room, the
manager pins the tooltip inside the viewport and over the title; the watch
sees the overlap and activates it again below. The manager marks the element
it shows for with `aria-describedby`, and the watch removes it: the tooltip
repeats the heading's own words. Leaving is the manager's to handle. It
dismisses the tooltip half a second after the pointer leaves the title, and
the same after the element under a still pointer changes, which is what
happens when the window closes.

**A press is the start of a drag.** The title is part of the header core
drags the window by. `pointerdown` cancels a pending tooltip and dismisses the
title's own, and nothing starts another until the pointer arrives again. A
drag gives the pointer to the header, so a release over the title is a fresh
arrival; a press that never moved is not one.

**What never answers.** A title that shows whole. A window not wearing the
dress: an unclassed core dialog, and every window under the `core` look. The
character sheet and the item sheet, whose titles are clipped to a 1px box and
take no pointer. A hover while a tour runs, since the tour holds the manager's
one tooltip element. A touch pointer, whose arrival and press are one event
pair.

## The drag corner

Every window naming a class of this module has a drag corner. The class is
`acks-extras` or anything it prefixes, read from `options.classes`, and
`window-resize.mjs` is the one hook that acts on it. A window declares a class
and nothing else. `resizable: false` at a declaration has no effect, and a
`resizable: true` is redundant.

Core reads the option in two places. The frame builds the handle from
`app.options.window.resizable`, once, and the frame update then shows or hides
it from the render's `options.window.resizable` first. The hook runs at
`preRender`, ahead of both, and writes both: writing the first alone builds a
handle and hides it.

**What being resizable changes.** Core's `_refit` returns at once for a
resizable window, so a tab change no longer re-fits an auto-height sheet. A
re-render still measures an auto height until the first drag, and that drag
writes the measured size into `options.position`, so a dragged size holds
across every render after it.

**Reach.** A tabbed sheet's body takes what its header and strip leave. Dragged
shorter than those two, about 190px, the body has no height and its controls
are out of reach until the corner brings the window back. Every other window
scrolls at any height.

**What it does not reach.** A window naming no module class: core's own, the
system's, and a dialog of ours that forgot its classes, which validate refuses.
The Scores Generator is core's page and `classes/stat-page.mjs` gives it a
corner itself, recognising it by what it does.

## Perception: senses, light, and the token

Three files answer "what can this creature see, and how brightly does it burn?"
for every actor in the family — a lone monster, a party member, a detached
scout. They live here rather than in a feature because more than one asks.

| File | Owns |
|---|---|
| `scripts/lib/senses.mjs` | Reading ACKS senses off the sheet, and what each grants. |
| `scripts/lib/perception.mjs` | What those senses ARE to Foundry: vision modes, detection modes, and the two status effects the rules need. |
| `scripts/lib/light.mjs` | The kinds of light, their imported figures (the light table), and which record holds a given actor's lights. |
| `scripts/lib/token-sync.mjs` | The guarded writes that put any of it on a token. |
| `scripts/lib/patches/token-light-padding.mjs` | A managed light's radius on the canvas, with core's token padding taken off. |
| `scripts/lib/patches/compendium-empty-load.mjs` | A compendium read naming no document (`_id__in: []`), answered without the server call core would otherwise make for it. |

**Sense resolution** runs in one precedence order, so the movement rules and the
canvas can never disagree: the Full Monster Sheet stat block
(`flags["acks-extras"].extras`), then a `kw:lightlessvision` capability, then
item and active-effect names. `canSeeInDark` (the blinded speed rule) and
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
| Lightless Vision | its recorded range, else the imported default reach (MM 392) | `…Lightless` | `…LightlessVision` (SIGHT) |
| Shadowy senses | the imported shadowy radius, else none | `…Shadowy` | `…ShadowySenses` (SOUND) |
| Echolocation | its recorded range | `…Echolocation` | `…Echolocation` (SOUND) |
| Mechanoreception, terrestrial | its recorded range | `…Echolocation` | core `feelTremor` (MOVE) |
| Mechanoreception, other | its recorded range | `…Echolocation` | `…Mechanoreception` (MOVE) |
| Blind | its best sense range, else the shadowy radius | that sense's | that sense's |
| Night Vision | the imported multiple of the bright radius reaching it, else 0 (none with no multiple imported) | `…Night` | core's own |

A creature looks through its **longest** sense and detects with **all** of them,
each at its own range. A sense with no range is ranked last and adds no detection
range.

**The senses' printed figures.** The shadowy senses' radius (RR 265), Night
Vision's multiple (MM 13) and the reach a dark sense takes when its stat line
records none (MM 392) are read by the importer's `senses` document into tables
`shadowySensesProse`, `nightVisionProse` and `lightlessDefaultProse` (keys
`shadowyReach`, `indoorFactor`, `defaultReach`) at the WORLD layer of
`tables.mjs`, and `declareSenseTables` names all three among the expected tables
at `init`. `shadowySenseRange()`, `nightLightFactor()` and
`lightlessDefaultRange()` answer a positive number or `null`; `senseCite(kind)` is the page the import read, `null`
for the Judge's own figure from the Ruledata Browser, which wins over the import.
With nothing imported a shadowy or blind creature, or a dark-sighted one with no
recorded range, still sees without light (`seesInDark` is the procedure's) but its
`sightRange` is `null` and its detection gains no range, and a night-eyed creature reached by light has no figure; the
character sheet's vision rows and rail light cell, and the Formation tab's dark-sight
chip, stay blank with no number in their place, and the token receives a
radius of 0 (`token-sync.mjs`) until the figure is imported. A recorded range on the
sheet (`lightlessRange`, an `otherSenses` entry) is the creature's own and never
waits on the import.

**Units.** Every radius the module derives is in feet, and a token stores its
`light.bright`, `light.dim`, `sight.range` and detection ranges in the scene's
`grid.units`. `token-sync.mjs` converts each one by `feetPerUnit` of the token's
scene (`distance-units.mjs`) and rounds it to the step the field stores, before it
compares with the stored value, so a second sync finds nothing to write. A scene in
feet, or in a unit the table does not know, gets the feet figure unchanged. A light
is lit when either radius survives the conversion: a coarse scene can round the
bright radius to 0 and keep the dim one, and one that rounds both to 0 sheds no
light. The stamp that marks a sight range as ours carries the converted figure.
`brightestLightReaching` reads stored light, so its answer is in scene units too;
the pass converts it to feet before Night Vision multiplies it.

**The light table.** `LIGHT_SOURCES` is structure only: which kinds of light
exist, their label and the gear each consumes, and whether one shutters. A
kind's bright and dim reach in feet and its burn time in turns are content,
read from the Judge's book by the importer's `light` document (RR 265) into
table `lightSources` of document `light`, keyed by kind, at the WORLD layer of
`tables.mjs`; `declareLightTables` names it among the expected tables at
`init`. `lightFigures(kind)` reads `{bright, dim, turns}`, each `null` where
nothing is imported, and `lightCite()` the page the import read, `null` for an
override. The Judge edits the figures in the Ruledata Browser (export, edit,
drop back), which writes the OVERRIDE layer and wins over the import. With
nothing imported a lit light sheds nothing (`emittedLight` reads 0), burns
uncounted (`remaining` left unset), and every surface that shows a figure leaves
it blank.

**A magic light is an effect.** Light that is not a carried flame is declared by
an Active Effect with a change per band (`MAGIC_LIGHT_BANDS`):
`flags.acks-extras.magicLight.daylight`, `.bright` and `.dim` (feet), of type
`upgrade`. Each is a radius from the light, brightest first: daylight is a level
no flame reaches, which a magic light may shed nearest, with bright and dim
light beyond it. On an item it transfers to the owner; one placed
on the actor (a spell cast on them) works the same. The figure is typed by the
Judge from their own copy, so nothing printed ships (the item sheet's Effects tab
has an Add effect control whose Magic Light choice creates the effect with all
three values empty; an item with no effect opens in the simple view, which has no tab
strip, so the control also stands beside Details there).
`magicLightChanges(bands)` builds the three changes (a band holding anything but a
positive whole figure is left blank) and `magicLightRecord({bands, cite})` pairs
them with the flags to spread into the effect's `flags["acks-extras"]`. A light row
on a spell carries `lightBands`, its reach in feet by band, each blank until typed
or imported. A magic-light effect may carry `MAGIC_LIGHT_CITE_FLAG`, the page its
reach was read from, which `magicLights` reads back as `cite` (null when absent).
`magicLights(actor)` reads one entry per applied effect that writes any band's key,
`{id, uuid, label, itemName, itemId, daylight, bright, dim, state, cite}`, from the effect's own
change values (not the prepared flag) so each source stays nameable;
`appliedEffects` already leaves out a disabled or suppressed effect, and a
change's type is not read: the largest figure per radius stands. `effectLight(actor)`
is the largest `{daylight, bright, dim}` among the entries whose `state` is
`shining`, with `bright` raised to at least `daylight`, since daylight is bright
light too: every reader of bright reach (mapping, a column point, the token)
counts a light that states only daylight. A flame sheds no daylight, so
`mergeLight` and `shedLight` carry the magic light's `daylight` alone. Foundry
draws two radii, so a token takes `bright` and `dim`; `lightLevelAt` tells
daylight from bright light (below), and nothing else yet does (ROADMAP, "What
daylight from a magic light does not do yet").
`shedLight(actor)` is the stronger of `emittedLight(bearerLights)` and
`effectLight`, each radius taking the larger, with the `kind` that won
(`mergeLight`): `magic` when the effect has the larger bright radius (the dim on
a tie), else `flame`. `tokenSyncDelta` writes it through `lightDelta` with the
kind's look: a flame keeps `CARRIED_LIGHT_LOOK`, a magic light takes
`MAGIC_LIGHT_LOOK` (steady, no tint, the flame's alpha). The look is written
with the radii: a token whose stored radii already match is not rewritten when
only the kind changes.
`lightDelta` and `matchesStamp` compare the token's stored light
(`_source.light`), never the prepared one, so a prepared-only change reads
neither as already written nor as a hand edit. An effect or item with effects
that changes on an actor re-syncs its tokens (`createActiveEffect`,
`updateActiveEffect`, `deleteActiveEffect` and the item hooks) and, for a
formation member, relights the party token's scene for Night Vision.

**A magic light shines where its holder lets it.** `lightStateOf(effect)` is the
gate, read from the item the effect rides on and nothing else, because the item
hooks relight a party for that item's own update. An effect on the actor itself
shines; on an item that is not goods (an ability, a quick-effects transfer) it
shines; on a spell item it is never a carried light (`null`, so `magicLights`
omits it: a spell's light is cast onto a holder, not held). On goods that can be
worn (`canWear`) it shines only while `isWorn`; on goods that cannot, only while
the item is outside every container (`containedIn`), so a torch-like item is
carried and put away. The result is `shining`, `shuttered` or `stowed`;
`lightStateDetail` adds the rule that decided (`why`) and the container's name,
which the surfaces turn into tooltips (`lightControl`). `effectLight`, and so
`shedLight` and a column point, count only a shining light.

**A placed light can shed daylight.** An AmbientLight document carries
`flags.acks-extras.daylight`, a radius in the scene's distance units like core's
`bright` and `dim` beside it (RR p. 228). `ambientDaylight(lightDoc)` reads it:
the radius, or null for a blank, absent, zero or non-finite flag, which sheds
none. The Light Source configuration window gets one control for it
(`ambient-daylight.mjs`): a "Daylight radius" number field on the Basic tab
directly after the group holding core's radii, named for the flag, so core's own
submit and its live preview carry the value and nothing of this module writes
it. A render hook on core's `AmbientLightConfig` adds the control after the first
render and again after any part's re-render replaces it; it is seeded from the
preview document's data, so an unsaved entry survives. Core's two radii are
never written. `strongestSource` reads the flag under the test the light's own
radii pass (`shinesNow` for a strict reader: a darkness source or an activation
range outside the scene's darkness sheds nothing, a hidden light sheds nothing),
and a daylight radius is bright light as well, so a placed light's bright reach
is the larger of core's `bright` and the flag, in `brightestLightAt` and
`brightestLightReaching` alike.

**The light level at a point.** `lightLevelAt(scene, point, {extra, daylit,
elevation})` answers `{level, by, source}`, `level` one of `LIGHT_LEVELS`
(`daylight`, `bright`, `dim`, `dark`, brightest first; `lightAtLeast` orders
them) and `by` `sky`, `light` or `none`; `lightLevelOf(tokenDoc)` asks it at a
token's centre. The sky is daylight when the scene's global light is on, its
darkness sits inside the global light's range and below one half, and the point
is inside no Region flagged `cookbook.indoors`; `daylit` replaces the scene's
sky reading (a journey's clock), and an indoors Region still roofs the point. A
scene with no global light has no sky. Otherwise a light decides: daylight from
a placed light's flag, a token whose actor sheds a magic daylight radius
(`shedLight`, converted to the scene's units), a column point or `extra`; then
the bright and dim reach `strongestSource` reads per band. Straight-line,
ignoring walls. No scene or no point is null, which a reader takes as "cannot
say".

**The reading names its source.** `source` is `{kind, name, cite, id}`, null for a
dark point. `kind` is `sky`, `ambient`, `token`, `column` or `extra`; `name` is
the deciding thing's own name (a token's, a placed light's label) and null where
it has none; `id` is the ambient light's or token's id on the scene, null for the
sky, the column and `extra`, so a caller can ask a permission of the document; `cite` is the page naming the level: the sky's (RR ch. 6) for
`sky`, a light's daylight band (RR p. 228) for a daylight reading from an
ambient light, a token or the column, and null for every other reading, a
caller's `extra` point included, since nothing the module knows names a page for
them. Of several sources reaching the point in the deciding band, the one with
the largest radius is named; a tie goes by kind in the order ambient, token,
column, extra, then by document order within its kind. The sky is read before
any light. `level` and `by` are what they were before `source` was added, so
`lightAtLeast` and the light gate read them unchanged.

**The light gate.** A typed modifier with `gate: {kind: "light", light}` is
read at the roll (`registerGate`'s `{at: "roll"}`, `isRollGate`): its
disposition is `atRoll` with reason `gate` on any actor, monsters included, and
`standingModifiers` never writes it. The evaluator answers null without
`ctx.token`, else whether the token's level is at least `light`.
`roll-gates.mjs` is the attack seam's contributor: for each `attackThrow` row
whose roll gate passes for the attack's context (`attackInFlight(actor)`: the
attacker's token, `actor.token`, else the first active token, else null, and the
target, weapon and delivery), it adds `{name} · {what the gate names} (cite)`
with the row's value (the gates beside the light gate are in API.md, "Typed
modifiers"); a row narrowed by `forWhat` to
melee or missile rides only that attack, and a blank value adds nothing. The
effect row editor writes the gate (an "Only at light level" select on modifier
rows) and never replaces a gate of another kind.

The **shutter** is `flags["acks-extras"].lightShutter` on the effect, written by
`setLightShutter(effect, on)` for any seat that owns the effect, with no relay
and no chat card. It is not `disabled`: an effect may carry other changes, and a
disabled effect leaves `appliedEffects` altogether. It is read last, after the
gate, so a stowed light reads `stowed` whatever the shutter says and keeps the
setting for when it is taken out. It rides the existing effect hooks, which
re-sync the actor's tokens and relight the party. The Kit tab's Light Sources
rows (formation MODEL, Lights) and the item sheet's Effects tab, for an item an
actor carries, show the state as a badge and offer the toggle, both built by
`lightControl` so the names and tooltips are written once.

**A managed light.** A token's light is the module's when the module wrote it:
`applyTokenLight` sets `flags.acks-extras.managedLight` true with every lit
write and false when it clears the light, and stamps the radii it wrote in
`flags.acks-extras.managedLightStamp`. `isManagedLight(token)` holds while the
flag is true and the stored radii still match the stamp (a light written
before the stamp existed carries none and holds on the flag alone, until the
first sync that finds it right stamps it). A light the Judge set on a token the
module never lit carries no flag. One the Judge edited after the module wrote
it stops matching its stamp: it reads as the Judge's at once, and the next
sync releases it for good (`managedLightStamp: {released: true}`, flag false)
and never writes it again, as a hand-edited sight is released; the world
sweep's `reclaim` takes both back. Core pads every token light by the token's `externalRadius`
(half its smaller side) in `Token#getLightRadius`; for a managed light the
padding patch (`patches/token-light-padding.mjs`) rebuilds the light source's
`dim` and `bright` in `_getLightSourceData` from the stored radius alone, so a
lantern reaches its figure on a member's own token exactly as it does from a
marching column's cell (`docs/formation/MODEL.md`, The column), which stands on
no token. A hand-set light keeps core's padding. The patch wraps the light's own
path, not `getLightRadius`, which also converts sight range and detection
ranges.

### Night Vision is the one sense read off the square

Every other row above is a property of the sheet. Night Vision is not: MM §5
gives it as a rule with a moonlight reading, an indoor multiple and a total-dark
exclusion, so its reach is a multiplier on a light somebody else lit and somebody
else carries.

`brightestLightReaching` (`scripts/lib/light.mjs`) answers what that light is — the
largest bright radius, among the scene's ambient lights, every light-emitting
token and every marching column's lights (formation's `carriedLightPoints`,
read through the namespace), whose source actually covers the creature's square. `senseProfile` takes
it as `litBy` and multiplies it by `nightLightFactor()`. Nothing else reads it, and the pass only computes
it for creatures that have the sense, because finding it costs a sweep of the
scene.

The last clause of the rule then holds by construction rather than by a check: an
unlit corridor has nothing to multiply, so the range is 0 and a night-eyed creature
is as blind as anyone else. `seesInDark` stays **false** either way — that flag
asks whether a creature can march with no light at all.

Because the answer depends on the light rather than the sheet, the sheet-driven
hooks cannot see it change. `syncNightVisionTokens` is re-run — debounced, and
narrowed to the creatures that have the sense — whenever an ambient light or a
token's position, light, visibility or column trail changes, and on each scene a
party token stands on when the formations setting is written (a light lit,
doused, shuttered or handed over in a column). Every scene asked for inside one
debounce window is swept.

Straight-line distance, ignoring **walls**: a torch beyond a closed door still
reads as reaching. Resolving occlusion needs the live canvas, and this has to
answer for scenes nobody is looking at.

### Asking for the whole world at once

Every pass above is local — the scene on screen, the actor just edited. A world
that switches `manageVision` on mid-campaign, or upgrades into a corrected sense
model, keeps whatever its untouched scenes were last set to.
`migrateWorldVision` sweeps every scene in the world and returns what it wrote
as counts. Nothing in the module calls it and no macro ships for it: it is
reached as `acksExtras.lib.vision.migrateWorld({reclaim})`. A scene it has not
swept is re-derived by the `canvasReady` pass when the primary GM opens it.

Taking back tokens released to a hand edit is `reclaim`, off unless passed and
never part of the plain sweep: a released token is a Judge's override, and
undoing all of them silently is the destructive reading of "migrate".

### Why the detection modes matter

A radius alone makes every sense behave like eyes, which is wrong in ways that
decide encounters. `DetectionMode.type` is what fixes it: core's own `_canDetect`
defeats only SIGHT modes with the Blind status and with an invisible target, and
defeats only *wall-respecting* modes with magical darkness. So:

- **Echolocation** (SOUND, walls) finds an invisible creature and works inside a
  *darkness* spell — its `_canDetect` deliberately skips core's darkness bail,
  which is keyed to walls rather than to type — but deafness stops it.
- **Shadowy senses** (SOUND, walls) survive blindness and invisibility, and stop
  dead while deafened, running, or in magical darkness.
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
with the canvas — a deafened thief takes the blinded speed penalty. Conditions
that depend on the *target*, or on where the perceiver is standing, cannot be
precomputed and live in `_canDetect` instead.

The statuses the senses read are the condition palette's ("Conditions",
below): **Blinded**, which Foundry's own blindness is pointed at, **Deafened**
— by that condition or by one that carries it, so a slumbering creature hears
nothing — and **Hidden**. A creature in magical silence is marked Deafened;
the palette has no status of its own for it. **Running** is the one palette
entry that is a declaration and no condition. All are toggles: whether a
character is running flat out this round, or has gone to ground, is something
the table says, not something to infer from a token's position.

**Light ownership is exclusive.** An actor in a formation takes its lights from
that formation's record (which tracks fuel, shutters and burn-down); only an
actor in no formation reads its own `flags["acks-extras"].lights`. Reading both
would let a member carry two contradictory torches. lib asks the formation
through `globalThis.acksExtras.formation.lightsForBearer`, which returns `null`
— not `[]` — for a non-member, because that is the difference between "carrying
nothing" and "not a member".

**Overrides are respected, differently for each write.** A light is only ever
cleared if we set it (`managedLight`), and one we set and a human then edited
is released by its stamp (A managed light, above). Vision cannot be that shy — the whole
point is to overwrite the system's stock `sight.range: 60` on every monster — so
it stamps what it wrote (`managedVision`) and compares before writing again; a
token whose sight no longer matches the stamp was edited by a human and is
handed back permanently. `manageVision` is the world-level off switch. A scene
the canvas is still drawing is never written to; the `canvasReady` sweep
re-derives it whole once the draw completes.

## A token moved to another scene

Core v14 has no move between scenes. It re-creates the token on the
destination and deletes the original, with `replacements: {[oldId]: newUuid}`
on the delete operation. The `teleportToken` Region behavior does this
(`RegionDocument#teleportTokens`, one `modifyBatch`), and so does a cut and
paste between scenes (`PlaceablesLayer#pasteObjects`). The new token keeps the
old id unless the destination already holds it. Core's own combat reads the
map (`Combat#_onDeleteTokens`). Only an Assistant GM or above holds
`TOKEN_CREATE` and `TOKEN_DELETE`, so a player's step into a teleport region
is carried out by a GM.

The primary GM's `deleteToken` hook receives the map in its options, whether
its own client ran the batch or it heard another GM's broadcast. Every client
handles a batch's create before its delete, so the successor already resolves
inside the hook. `replacementToken(tokenDoc, options)` (`util.mjs`) returns
it, or null for a deletion that names none.

A record that names a token follows it by these rules:

- **Resolve at the hook.** A token sent out and straight back has deleted its
  first successor before a write queued behind the first hook runs.
- **Guard the write on the scene as well as the id.** A kept id names a token
  on both scenes, and a scene duplicated from either holds its tokens under
  the same ids.
- **Follow only the owner's own body.** The successor must carry what made
  the original the record's: the formation flag, the same actor, the same
  group and member flags. Anything else is a deletion.
- **A deletion with no successor stays a deletion,** with whatever the owner
  does for one.

Three records follow one: the party token (docs/formation/MODEL.md, "Data
flow"), a formation member's own token (docs/formation/MODEL.md, "Detaching a
member") and a group's deployed body ([GROUPS.md](GROUPS.md), "A deleted
body, and a moved one").

## The item taxonomy: goods, gear, and where it sits

The system's eight Item sub-types share no base. `cost`/`weight6` are hand-spread
into `item`, `weapon` and `armor`; `equipped` is declared **separately on `weapon`
and `armor` and nowhere else**; `money` has neither cost nor weight, and keeps
its count as a bare number where every other stackable keeps `{value, max}`.
So "is this a thing?", "can it be worn?", "how many are there?" and "what does
it weigh?" had no schema answer, and every consumer re-derived them from its
own type list.

`scripts/item-model.mjs` is the one place those questions are answered. It reads
the **schema** wherever it can (`"cost" in item.system`), so it keeps working when
the system adds a type this library never heard of.

| Question | Read | Why not a type list |
|---|---|---|
| Is it a thing? | `isPhysical` | schema probe |
| Have they got one? | `findCarried` / `carriesItem` | every "you need a pole / a torch / a quill for this" rule asks the same question; physical-only, so a proficiency named "Spear Fighting" is not an implement, and `hasStock` makes an empty stack read as not carried |
| Can it be put somewhere? | `isGoods` / `isStowable` | coin is goods without being physical — the gap that grew a `\|\| type === "money"` rider at fifteen sites |
| Is it currency? | `isCurrency` | the one stackable whose weight is stated per stone — see "Currency" |
| How many are in the stack? | `stackCountOf` | read by the field's shape (the system's plain number, or the `{value}` object on an item copy a flag saved earlier); `null` for data that carries no quantity. Whether a row divides or merges is `isStackable` (a weapon and armour included); whether a surface draws a count control for it is `offersCount` (a stackable row; where core can equip it, one not in use, `isInUse`) |
| What does it weigh? | `weight6Of` / `sumWeight6` | a stack's weight in sixths, bundle size applied; currency as an exact fraction, summed per rate |
| Is it clothing? | `isClothing` | core's `system.subtype`, its one sub-classification |
| What does it add to encumbrance? | `encumbering6` | what core's `computeEncumbrance` counts, clothing excluded, with coin weighed to the coin where core counts whole stones |
| Can it be worn? | `isWearable` | core's `equipped` field OR a declared slot |
| Is it worn now? | `isWorn` | **two stores, one question** |
| Where? | `wornSlotOf` / `setWorn` | ditto |
| How much does it hold? | `capacityOf` / `holdsGear` | capacity belongs to gear, not to a category — see below |

### Currency

Currency is a stack like any other and is read through the same model, with
two differences: its count is a bare number, and its weight is stated the
other way round. `money-logic.mjs` holds the arithmetic (Foundry-free) and
`money.mjs` the document writes. No feature reads or writes a coin row's
fields itself.

**One count.** A row holds `system.quantity` coins. `stackCountOf`, and
`coinCount` for plain data, is every reader's count; `coinTotalCp` /
`coinTotalGC` is what a set of rows is worth, `purseGp` what the coin a holder
has on them is worth, and `spendableGp` what a payment may draw on. The
system's second field on the row,
`system.quantitybank`, is counted by nothing. The location feature's sweep
moves a balance out of it ([location MODEL](../location/MODEL.md)). Until it
has, a path that would delete an emptied row (`emptyMoneyDeletes`,
`joinStacks`) keeps one that still carries a balance, and a row copied from
one (`arrivalOf`, `divideStack`, a transfer) carries none.

**Kind.** A coin's kind is its name and its rate together (`coinKind`). Two
mints struck to one value are two stacks, and a local variation stays its own
stack wherever it travels. At a place that keeps goods for owners the kind is
per owner, and the place's own coin is owned by the sentinel `HOUSE_OWNER`.
`ownCoin(holder)` is the rows a holder has on them and that are their own: an
actor's purse and what its containers hold, or a place's house-owned stacks.

**Stores.** A holder's coin is kept in stores, and `coinStores(holder)` lists
them in a standing order: coin carried loose, each container the holder
carries, then each place that keeps coin for them, their vault first and the
rest by name. Each store is `{key, kind, name, actor, containerId, rows, shut,
takesCoin, writable, vault}`. Its key is what an order names: `""` for loose
(`LOOSE_STORE`), `item:<id>` for a carried container, `place:<uuid>` for a
place. A container whose lock is shut, or that sits inside one, is `shut`: its
coin is not spent and nothing is put there, though it still counts as carried
and still weighs. `takesCoin` is false for a shut container and for one that
names the kinds it holds and leaves coin out, which the equipment feature
answers. A place is a store when it holds coin stamped for the holder, is
their vault, or is named in their order. Coin inside a locked container at a
place is not among that store's rows. Nothing is kept elsewhere for a
location or for an unlinked token's own actor (`keepsCoinElsewhere`); a
location's stores are the house's own.

**Order.** `flags["acks-extras"].coinOrder = {payFrom, receiveInto}` is the
holder's statement of the store a payment draws on first and the store
arriving coin lands in (`coinOrderOf`, written by `setCoinOrder`). Unstated,
both are coin carried loose. A key whose store is gone reads as loose.

**Reach.** A transaction states how far it reaches with `within`: `"all"` for
every store, `"hand"` for the stores on the holder, a place for those and the
coin that place keeps, a Scene for those and the places on it. One that
states nothing takes the world setting `coinScope` (`standingCoinScope`):
`all` by default, `scene` measured from the scene the payer stands on, or
`hand`. A place is on a scene when the scene is linked to it or its token
stands there. The reach bounds both sides of a payment: which of the payer's
coin is drawn on, and which store an arrival may be sent to. Transactions at
a market state that market ([markets MODEL](../markets/MODEL.md)).

**Weight.** Currency states how many of it weigh one stone. `perStoneOf`
reads the item's own `gear.perStone`, which is typed on its sheet or read off
its text by the annotate pass, and falls back to the rate the system weighs
coin at (RR ch. 1, Speed and Encumbrance). `systemCoinsPerStone` finds that
rate by asking the system's own `getTotalMoneyEncumbrance` how heavy a purse
of N coins is, until it has the smallest N the system calls a stone. The
figure is never written in this module. `weight6Of` returns
`count × 6 / rate`, a fraction of a sixth, unrounded. `sumWeight6` adds the
counts per rate and divides once, so a purse in three rows weighs what one
stack of the same coins would. Whatever prints a weight rounds it; the item
sheet's `stoneLabel` writes `<0.01` for a weight too small to show.

Every sum goes through `sumWeight6`: the borne and carried readings below, a
container's contents (`contentsWeight6`), and a character's burden. Core
computes a character's encumbrance itself and counts the purse in whole
stones, so the equipment feature's wrapper on `computeEncumbrance` takes
core's coin figure back out and puts the item model's in (`encumbranceDelta6`,
step 5), where every coin row has a rate. The wrapper registers at `setup`
and answers to no setting, the roll-automation one included. That is after
the world's actors were first prepared, so each world character is reset once
it is in place.

**Landing.** Coin arrives on a holder two ways, and both end on the row of
its kind in the store it lands in. `creditCoin(holder, credits)` lands coin
known by a source row, by a name, or by its rate alone, in the store the
holder's order names; `into` overrides the order for one credit. A store that
is gone, shut, outside the reach or takes no coin is passed over for coin
carried loose, and so is a place this seat cannot write, except in a payment,
which is relayed whole (below). Coin credited for a named owner (`ownerUuid`)
is put on the holder under that owner whatever any order says, which is how
a place is paid into for somebody. A transfer that moves rows (`handOver`,
`stash`, `retrieve`, `moveStored`) folds them through `planStackMerge`; one
that hands coin to a holder puts it in the carried container their order
names, else loose (`coinContainerOf`), and never sends it on to a place. All
of these write through `landGoods`. A kind the store has none of becomes a
new row copied from the coin that moved, else from a coin of that kind the
holder keeps anywhere, else from one the world or a compendium holds
(`coinTemplate`), so its rate, art and declared weight come with it. A row
stamped for an owner takes only an arrival stamped for the same owner.

**Leaving.** A spend draws on the stores inside the reach that no lock shuts,
the store the order names first and then the rest in the standing order. In
each store it takes smallest coins first, whole coins only, and it breaks one
larger coin when what came before cannot cover the rest (`planCoinSpend`,
whose slots carry the store's `rank`). Change has a planner of its own
(`planChange`): largest first, never more than is owed, and only from stacks
somebody holds. A payment plans its change over the coins being paid before
anything else (`changeKeeping` in `money.mjs`), so small coin a larger coin
makes unnecessary stays in the purse. An order decides which coins go and
never whether the payment can be made: where the ranked plan needs change
nobody can make, the plan that spends smallest first across every store is
tried before the payment is refused. A row a payment empties is deleted
(`emptyMoneyDeletes`).

**One payment.** `moveCoin` in `money.mjs` is the pipeline every call in the
table below runs: the reach gate, the reach, the plan, then both landings
before both takes, so a payment cut short leaves a duplicate and never a
loss. Where the plan touches a document this seat may not write (a place
keeping coin for either side, a payee the seat does not own) the whole
payment is handed to the GM (`libMoveCoin`). The GM's seat checks that the
sender owns the payer and plans again from the same arguments. A relayed
payment never mints. With no GM connected the answer is
`{ok: false, reason: "noGm"}` and nothing is written.

| Call | What moves |
|---|---|
| `transferCoin({from, to, gp, within})` | Coin from one holder to another, after the reach gate. Change is made from the coins being handed over first, which then stay with the payer, and after that from the payee's own stacks. Where neither can make it, a market mints it and anywhere else the transfer is refused. `upTo` pays only what the payer's coin represents exactly and reports the rest as `arrearsCp`; `allowMint` lets a market's till pay out more than it holds. |
| `mintCoin(holder, gp, opts)` | Coin from nowhere, in standard denominations, each as the holder's coin of that rate, where `creditCoin` puts it. |
| `sinkCoin(holder, gp, {within})` | Coin paid to nobody. Coins the change would hand straight back stay where they are; the rest of the change comes back in the holder's own denominations, and what those cannot represent as standard small coin. |
| `exchangeCoins({actor, place, itemId, count, toCv})` | One kind for another at a market's till, at face value. The new coin comes back where the actor keeps arriving coin, on hand or at that place. A seat that cannot write the place relays the exchange to the GM. |
| `depositCoin(provider, {...})` | Coin put at a place for an owner. |

**The reach gate.** `coinReach(from, to)` decides whether two holders can pay
each other at all, before any store is read. It passes a place through the
location feature's deposit reach, an employer and a hireling through the
roster, an employer and a paid unit through the employer the unit's own actor
names, and any other two actors when they stand on one scene. A refusal is a
sentence naming the holder, the place and the map (`reachRefusalText`).

**The Judge's own payment.** `judgeDeclares(requestUserId)` (`sockets.mjs`)
says whether the Judge declares an act: a GM's seat acting for itself, never a
player's request relayed to it. A surface a user acts through passes the
answer as `judge` to `transferCoin` or `exchangeCoins`. Where the reach
would have refused, the payment is made and the Judge is told which refusal
was waived. A payment no user declares, a sweep, passes nothing and is gated.

**Dividing and joining.** `divideStack(item, count)` copies the row at
`count` beside itself and reduces the original. The copy's id is derived from
the row, its `_stats.modifiedTime` and the count it held
(`stack-copy.mjs` `copyIdFor`, over `util.mjs` `seededId`) and the create keeps
it, so two seats dividing one stack in the same moment, by any counts, make the same id and the
server refuses the second create: that seat resolves null and writes nothing,
and the first seat's divide stands. A row with no numeric `modifiedTime` takes an
id of the server's own. The equipment sheet's `splitOne` is made the same way. `joinStacks(item, onto)` adds
one row to another of the same kind, owner and container, and removes it.
Both write the gaining side first, so a write cut short leaves a duplicate
and never a loss. Two rows of one kind are a state the holder may have
chosen, and nothing joins them unasked, except that a row put back to rest
folds into the resting row of the same thing (`foldIntoRest`). A row in use
(equipped, worn at a slot, thrown) and a container have a null stack signature,
which equals nothing; wear leftovers and provenance flags do not tell two
resting rows apart. A row holding a variation, or one something points at, is
not divided or joined, and a transfer moves it whole. Equipping a row of two or
more takes one from it (`takeOneToEquip`, equipment feature): the rest are made
first as a resting row, then one write sets the clicked row to one with the
pending change in it. Divides and folds on one holder run in turn
(`oneAtATime`). `joinStacks` does nothing when either row is no longer on the
holder, and a join asked for from outside a turn, a sheet's drop, goes through
`joinInTurn`, which takes the holder's turn and looks both rows up again when it
comes; a fold queued by an unequip has then already joined them. `promptDivide(item)`
(`stack-prompt.mjs`) is the one prompt every sheet asks a division through: a
dismissed prompt writes nothing and says nothing, and a count outside the
stack, 0 included, is refused with a warning. `gatherCoin(holder)` is the
fold a holder asks for: rows of one kind in one store become one, on the
holder and at each place keeping coin for them that the seat may write.

**The order on a sheet.** `coin-order.mjs` draws the order wherever a
holder's coin is listed: `coinOrderView(holder, {places})` builds the view,
`templates/lib/coin-order.hbs` draws it and `bindCoinOrder(root)` listens.
Both selects offer every store, and each place the sheet lists that may keep
coin for the holder; the pay select leaves out a shut store and the receive
select one that takes no coin. A stated key whose store is gone stays as an
option of its own, so the control shows what the flag says. The gather
control appears only while a fold would take a row away, and names how many.
A note states the world's reach when it is narrower than every store. The
selects carry no `name`, and the listener stops their `change` at the block,
so a form that submits on change neither writes the choice nor submits for
it. `installCoinOrder` binds the block on every actor sheet render; a sheet
that injects the block after its render hooks binds its own. Four sheets host
it: the module's character sheet, the system's own actor sheets, the follower
card and the group sheet.

**Dropped on a sheet.** `bundles.mjs` `landCoin(actor, item)` is the one
statement of where a dropped coin goes. Off another actor it is handed over
(`handOver`, which debits the giver). From a compendium or the sidebar it
arrives as its own count on the row of its kind (`deliverDrop`), an empty
shelf stack counting as one coin. No sheet copies coin. The character sheet,
the vehicle sheet and the group sheet call `landCoin` from their own drop
handlers; the group sheet's replaces the base class's on the same element.
Every other actor sheet reaches Foundry's `ActorSheetV2#_onDropItem`, which
the lib wraps (`patches/goods-drag.mjs`): coin from elsewhere goes to
`landCoin` where the sheet lists the goods its actor carries (`listsGoods`: a
character, a monster or an animal), and is refused on any other, neither
moved nor copied. The same patch guards the system sheets' own money-drop
branch. A place's sheet keeps what is dropped on it for an owner instead
(`stash`, or `stockProvider` for goods that come from nobody).

**Refused aloud.** `bundles.mjs` `refuseGoods(actor)` is the one warning a
sheet gives for an item it does not take, naming the actor. The wrapped base
drop gives it for coin on a sheet that lists no goods. Each sheet that lists
none gives it for the rest, from its own drop, because Foundry's base drop
would otherwise create a copy on the actor: the faction sheet for goods of
any kind (`_onDropItem`), the group sheet for any item that is not coin, and
the party sheet for any item at all, in the GM's member drop and in
`_onDropItem` for every other seat. The vehicles feature gives it for freight
dragged out of a hold onto such a sheet
([vehicles MODEL](../vehicles/MODEL.md)).

### Capacity

`capacityOf(item)` is stone, or `null` when the item states no capacity. It reads
`gear.capacity` first and the `container.capacity` record second, so an item
carrying only that record still answers.
Null is not "holds nothing": an item that declares `gear.holds` is a
container whose size is not imported (its capacity reads blank), so `holdsGear` is true for it,
`capacityStated` false, and it counts no limit.

**It is not a container property.** While capacity lived inside the equipment
feature's container record, only items that feature recognised as carrying
devices could have one — so a coat with hidden pockets, a bandolier and a saddle
could hold nothing, and "is this a container" and "does this hold anything" were
the same question by accident. Anything that can be given a capacity is a place
gear can go.

0 is a real answer distinct from `null`: a container of unstated size. RAW
capacity is a warning rather than a limit, so an unstated one never warns.

Encumbrance is the same question asked of an actor, and
[capacity.mjs](../../scripts/lib/capacity.mjs) answers it for any document
that can carry — `capacity6` / `load6` / `overCapacity`, in sixths — with a
character's capacity read from core's resolved maximum and a mount's from its
load spec. Three readings of an actor's weight, and which one a caller wants
is the whole question:

| Reading | Function | What it is | Who reads it |
|---|---|---|---|
| burden | core's `encumbrance.value6` | what the character moves under, after every carrying rule | movement, the bar's fill |
| borne | `borneWeight6` | the kit a bearer answers for: no carrying overlay, clothing free, nothing that has left the body (a spoil, a thrown weapon) | a mount's load, a formation's casualty haul |
| carried | `carriedWeight6` | everything on the body at what it weighs, clothing included | the character sheet's phantom |

A harness makes the walking easier; it does not make a horse's burden lighter,
and it does not make the kit weigh less.

**What a rider's body weighs is imported.** The man-sized body the book assumes
for purposes of carrying capacity (RR p. 161, Encumbrance and Equipment) is read
by the importer into the `capacity` document's `riderBody` table, and
`riderBody6()` answers it in sixths, or `null` while it is not imported (a
Judge can edit it in the Ruledata Browser; `riderBodySource()` says which).
`borneBy6(actor)` is the body plus the kit: the creature's own stated
`extras.bodyStone` where it has one (a blank field is no statement), else the
imported body, times every body a stack stands for. Where neither is known it
answers `null`, and so does everything built on it: `load6` and `loadStone`
of a mount bearing such a rider, a passenger's cost to a hold
(`passengerCost`), an occupant row's `stone`. `overCapacity` never warns on an
unknown load. Consumers show the figure blank and put the page in its tooltip
(`riderBodyTip`): the monster sheet's rider line and carried figure, the
character sheet's mount line. The swimming rescue's burden on RR p. 271
(`formation` `carriedBodyStone`) is a different figure, read on its own page.

The speed a bearing gives is the system's, never the module's:
`explorationSpeedBearing({stone, max, mod})` runs core's `_calculateMovement`
on a stub shaped as that method reads (`system.encumbrance`, `movement`,
`movementacks`) and returns the exploration figure, or null where the actor
class has no such method. The stub carries no `statuses`, which the condition
wrapper on that method reads as nothing to apply, so a hypothetical bearing is
never slowed by the real actor's conditions. A seat core derived no
encumbrance for, and a carrier's load with a casualty's share added, are the
two bearings the document does not hold. A maximum core derived none for is
not made up: `capacityStone` answers null, and the formation reads a null
maximum as no capacity, no pace and no overload for that carrier.

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
`capacity` (the ring's is `imported`, below). A slot is fundamentally an **exclusion**: the Treasure Tome's
Miscellaneous Magic Item Form table states the only wear mechanic ACKS II has,
that a character may not wear two MAGIC items of the same form at once. The
ring place is the one capacity the module does not hold: the Rings
introduction (JJ p. 144) and the Treasure Tome (p. 74) print how many magic
rings one wearer benefits from, the importer reads it from JJ into the
`wearSlots` document's `ringCapacity` table, and `slotCapacity("ring")`
answers `null` until it is imported (a Judge can edit it in the Ruledata
Browser; `slotCapacitySource` says which). A null capacity is no cap known:
`slotUse` reports `cap: null` and never `full`, and the character sheet's
Equipment tab shows that place's count with the figure after the slash blank
and a tooltip naming the pages. So `capacity` is a place's **magic**
capacity, and `slotUse` counts a place twice: magic items against that, and
what the body cannot carry twice — armour and weapons, anything core can
equip — against one. Clothing and plain gear count against neither: a coif under a helm and a magic circlet over
both are three things at one place and none of them over, while a second helm
or a second magic circlet is. The belt and the back are uncapped (`null`): a
belt, a pouch, a scabbard, a quiver and a harness are five forms hung from one
place, and a pack rides beside a bowcase — the rule refuses a second of the
same form, not the place. `isMagical` is the one reading of "is this magic":
the markets feature's declaration on the item, or a magical variation inside
it.

`gear.slots` is the list an item MAY occupy; `gear.wornAt` is the one it does.
`gear.capacity` is how much it holds and `gear.relief` how much a harness
secures, both in stone and both the book's figures: a capacity is the one the
importer read from the item's price row and wrote, a relief is read off the
item's own text by the annotate pass, and either can be typed on the item's
sheet. Unstated holds nothing and secures nothing.
`declaresSlots` separates "declared to sit nowhere" from "never annotated" —
both give `slotsOf` an empty list, and every name-heuristic fallback in the
family gates on the former so a deliberate ruling is not undone by an item's
name.

Lib reads no names, so the equipment feature registers its reading at `init`
(`registerWearInference`: the places an undeclared item's name puts it, and
how to wear it there). `wearableSlotsOf`, `canWear` and `wearAt` are the
readers a lib surface such as the follower card calls; `isWearable` stays the
declaration's answer, and with nothing registered the three fall back to it.

`gear.access` is the cost of reaching into a carrier: an action in lieu of movement (`action`) or none (`free`), the two ids of `vocab.mjs` `ACCESS_COSTS`. The kinds are procedure; which carriers fall on each side is printed (RR p. 294, Movement Actions) and imported: a `proseValues` recipe, `gearAccess.retrieval`, reads the page's two lists of carrier words into the `gearAccess` document (`{action, free}`), and `retrievalAccess(name)` folds the name and answers the side whose longest listed word it contains. A name the lists do not hold, a word on both sides at the same length, and a world with nothing imported answer blank, and the annotate pass then writes no access. Nothing in lib applies a consequence of it today: the item sheet's Access row sets it, and its tooltip names the page the lists were read from, the Judge's edit of them, or with nothing imported the page alone (`retrievalAccessSource`).

### Goods handed to an actor, and bundles

`bundles.mjs` `deliverItems(actor, goods)` is the one way goods arrive on an
actor from outside it: each stackable folds into an identical stack the actor
already carries (`planStackMerge`, keyed by `stackSignature`), and everything
else is created. `bundles-logic.mjs` shapes the arrivals: `arrivalOf` strips
the source's id, folder, sort, ownership, equipped state, container pointer and
storage attribution. `droppedGoods(item)` is what one document dragged from a
compendium or the sidebar delivers, and `deliverDrop(actor, item)` delivers
it; coin dropped on a sheet goes through `landCoin` ("Currency", above).

Core's bundle is an Item listing references (`system.itemList`), and no actor
sheet lists an embedded one. So nothing embeds one:

- **A bundle dropped on the character sheet** opens through `unpackBundle`.
  Each row resolves by its uuid, then by the library item of the same name and
  type, and a row neither finds is named in a warning while the rest arrive.
  A row delivers the units core's own drop makes of it
  (`_createBundleEntryItem`): coin and every Physical Item as one document
  holding the row's count, a weapon and armour included, except gear carrying
  Active Effects of its own, which arrives as a row of one per unit
  (`goodsForRow`) and is never folded into another. The bundle is read, never
  consumed.
- **A market purchase** (`markets/engine/trade.mjs` `deliverGoods`) counts
  units, so it hands over one stack of the quantity bought, or a row per unit
  for gear with Active Effects of its own, through the same `deliverItems`.
- **A bundle already embedded**, which a path that wrote it whole leaves
  behind, is opened where it lies by `unpackEmbeddedBundle` (the
  repair tool's `lib.embeddedBundles`). It writes three times: the stack
  merges together with a journal on the bundle (`flags.acks-extras.unpack`,
  holding the planned copies), then those copies, each stamped `unpackedFrom`
  with the bundle's id, then the bundle's deletion. `unpackStage` reads which
  writes landed, so a run that stopped part-way resumes at the next one,
  creating the journal's copies rather than resolving the rows again, and
  nothing arrives twice. A bundle with a row nothing resolves is left whole.
  The stamp is provenance only: `stackSignature` and `arrivalOf` ignore it, so
  a copy still folds into its kin.

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

The attached are world actors and the actors of unlinked tokens whose OWN
delta carries the flag. A token that only inherits a binding from its base
actor is that base, attached once however many copies are placed; a token
linked since answers as its base. The index files each by uuid (a token's
actor is `<token uuid>.Actor.<actor id>`), and a hit counts only when it
resolves back under that uuid. An actor, a token or a scene that may have
gained a binding drops the index; a deleted token's entries resolve to nothing
and are passed over.

[mount.mjs](../../scripts/lib/mount.mjs) is a permanent FACADE over that one
model, not a second one: it keeps the mounted-combat vocabulary
(`mountActor`/`dismount`/`mountOf`/`riderOf` and the `acksLibMounted` /
`acksLibDismounted` hooks) that the equipment feature's overlay reads, and
implements it as a `rider` attachment.

The binding is made by a gesture, and the lib answers two drops for it ahead of
the sheet they land on (`registerMountDrop`, on `dropActorSheetData`). An
`acks-extras.animal` dropped on a character seats the character on it (`ride`,
which is `mountActor` with the binding said aloud). Goods dragged between a
rider and the mount they ride are handed over (`handOver`) where the system's
drop would copy them; coin is left to the sheet it lands on, and any two
actors that do not ride each other keep the system's drop. A monster ridden as
a mount is bound from the character sheet's Mount line
(`docs/character-sheet/MODEL.md`), because a monster dropped anywhere else on
a character is a hire.

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
and maximum load live, and where the importer writes the loads it reads from
the creature's own printed description. The animal sub-type's like-named
`capacity6` / `unencumbered6` fields are unused: no consumer reads them and
nothing writes them, and filling them would make a mount look provisioned
while `capacity6()` still answered null.

The GM-entry surface for `training` and `mountable` is the Full Monster
Sheet's **Animal tab** — `docs/monsters/MODEL.md`. It is a monsters surface,
not a lib one: an animal's default sheet IS that sheet.

Both training and mountability arrive by import. The RR prices animals BY ROLE — a "Heavy War" horse,
a "Draft" mule, a "Riding" camel — so the qualifier in the name the book
printed is its statement of training, and the importer reads it there
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
city stays both ride it. `isPrimaryGM()` ("Which window automates") is what
stops a two-GM table, or a Judge with the world open twice, processing the
same day twice, so there is exactly one copy of the test;
`henchmen/time.mjs`'s `onTimeAdvanced` is a name its engine kept, delegating
here. Callbacks are idempotent by contract — the hook fires for a calendar the
Judge dragged as readily as for a rest — so each keeps its own watermark.

**Reading the hour is the third half, and whether it is dark is read here
too.** `clockReading()` returns the calendar's hour, minute and second, the
day's length, the calendar's seconds in an hour, and `dark`. Foundry's
calendar keeps no sunrise, so the dark's bounds are the two world settings
`dawnHour` and `duskHour`, registered here beside the switch; a blank one
stands at a quarter and three quarters of the day (`darkBounds`), which is
the day's own arithmetic and not a printed figure. A world with no calendar
to read answers null, and a feature asking treats that as day and says so.
The settlement board was the first reader (`docs/formation/MODEL.md`, "The
hour"); the journey is the second: it asks whether the march is in the dark,
and its **End day** moves the calendar to the next dawn through
`untilNextDawn()`. `secondsToNextDawn(reading, {secondsPerHour})` is the pure
arithmetic under it — the seconds from a reading to the next time the clock
reads the dawn hour, strictly after now, so standing exactly at dawn waits a
whole day. `dawnWithin(reading, dt)` asks the same arithmetic backwards, from a
reading taken after a step of the clock: a step that lands on the dawn crossed
it, and one that starts there did not, so no watcher needs a stored last dawn.

## The socket transport

`sockets.mjs` is the module's one cross-client channel: one socketlib
registration, one handler registry, and a native-channel fallback for
fire-and-forget calls. A player whose seat cannot write a document asks the
active GM's client to do it, and that client acts with a GM's authority, so
**who asked** is the whole of the security question.

The answer comes from Foundry's server, never from the payload. The server
stamps every module socket message with the id of the user whose connection
sent it; socketlib hands that id to a handler as `this.socketdata.userId`, and
the native channel as the listener's second argument. `runRelayed` sits
between both and every registered handler. It **overwrites** an object
payload's `requestUserId` with the attested sender: null when a GM sent it,
the sender's id otherwise. That is the same shape a seat's own local dispatch
passes (`requestUserId: game.user.isGM ? null : game.user.id`). A call from an
id the world does not know never reaches its handler.

So the convention every handler follows is one line: **authorize against
`requestUserId`**, and when it is set, refuse unless that user owns the actor
the call writes to. Leaving the field out of a payload now means nothing,
because the field is always rewritten, and naming someone else in it means
nothing either. A handler that reads identity from anywhere else — an extra
argument, a user id tucked into the payload under another name — reintroduces
the hole the wrapper exists to close.

A handler called on the GM's own seat (`executeAsGM` when the caller is a GM)
runs without the wrapper: the seat is its own authority.

Which of the active GM's windows answers a relayed call is its seat's
election, which rides this channel too (next section).

## Which window automates

The world's GM-side automation runs in one browser window: a hook that writes
a document, a relayed request, a clock watcher, a sweep at `ready`.
`game.users.activeGM` names a user, and one user can have the world open in
several windows, each hearing every hook. So the active GM's seat elects one
of its windows (`automation-client-logic.mjs`, wired by
`automation-client.mjs`), and `isPrimaryGM()` (`util.mjs`) is true there
alone. The ruling and what it cost: [DECISIONS.md](DECISIONS.md), "One
automation client per seat, chosen by the last relayed claim".

The windows talk on `module.acks-extras`, each message sent with
`recipients: [own user id]`. The server delivers it to every window of that
user, the sender's own included, in the order it handles messages, which is
the order every document event reaches those windows in. Each window's id is
minted at page load.

- **Joining.** A window joins at `ready` and again on every reconnect. Events
  a loading page receives are replayed to it just before `ready`. It says
  `hello` and knows no lead until a `claim` or an answer names one. It claims
  when nothing answers within 3 s.
- **Leading.** The lead is the window the last relayed `claim` names. Every
  window applies a claim when the server relays it back, so for any event the
  seat's windows agree which claim came before it, and at most one believes it
  leads when it reads that event. Only a claim changes the lead.
- **Watching.** The lead answers `hello` and `ping` with `here` from its
  message handler, and runs no timer. A follower pings every 15 s and claims
  when 5 s pass without a `here` from the window it believes leads.
- **Leaving.** A closing lead sends `bye`, and a follower hearing it claims.
  socket.io closes the transport from a `beforeunload` listener of its own,
  added before any module loaded, and a window runs its listeners in the
  order they were added. So the `bye` goes out from the transport's own
  `close`, wrapped on each connection as it opens, and a `beforeunload`
  listener covers a socket that does not close on unload. The `bye` moves
  nothing itself, so a cancelled unload leaves the lead in place. A dropped
  connection
  ends the window's lead at once, and it sends nothing until it rejoins. A
  `hello` from the window a follower believes leads means that window
  rejoined, so the follower claims.
- **Outside it.** A window that is not the game view (`game.view !== "game"`)
  never joins and never leads. A context with no socket, such as an offline
  suite, leads.

Three gates read the election, all in `util.mjs`:

| Gate | Guards |
| --- | --- |
| `isPrimaryGM()` | What a hook, a relayed request or a timer starts. Read once at the trigger and passed down the chain: the answer can change between two reads. |
| `primaryGMSettled()` | What `ready` or `canvasReady` starts. A window still joining answers `isPrimaryGM()` false, so this waits for its first answer. |
| `isActiveGMSeat()` | An act the window's own user asked for, such as a macro or an API call. One window made it, and a follower refusing it would refuse the Judge. |

`sockets.mjs` gates relayed calls itself. A request (socketlib's
`executeAsGM`, the native fallback) runs on the seat's lead, and a window
still joining waits to learn whether it leads. A follower's handler returns a
promise that never settles, so socketlib sends no answer and the requester
takes the lead's. A handler registered with `{broadcast: true}` runs in every
window, and so does a call a window makes to itself.

`executeAsUser(action, userId, payload)` puts a question to one user's own
client and returns its answer, for a result that belongs to the person a
request came from and not to the Judge's seat. A seat's election is per user,
so the call is answered by the targeted user's lead window and a second window
of theirs stays silent. It runs locally for this client's own user; a user who
is not connected, a missing socketlib or a throw answers undefined, and the
caller reads undefined as its own default. A question put to a user who then
leaves while it is open is never answered, since socketlib has no timeout.

`automationCensus()` (`automation-client.mjs`) reports what one window
believes, `{selfId, lead, joined, isLead, settled}`, for a live check
([TESTING.md](TESTING.md)).

### Where a bare `isGM` sits behind a gate

A writer that keeps `game.user.isGM` as a permission floor is reached either
by a user's own gesture or from a trigger that has already read the election.
Three areas where the floor reads as the only gate:

- **The lost episode** (formation MODEL.md, "Lost"). `lost-episode.mjs`, the
  fog it paints (`lost-fog.mjs`) and its markers (`shadow.mjs`) have three
  automatic triggers. The party token's `updateToken` reads `isPrimaryGM()`
  before `onPartyTokenMoved` walks the truth (`walkTheTruth` →
  `walkAstrayPath`) and makes the day's throw (`throwDayNavigation` →
  `postNavigationThrow`, whose failure opens an episode through
  `beginEpisode`). `deleteActor` reads it before `dissolveFormation` clears
  the markers, and `ready` awaits `primaryGMSettled()` before
  `clearOrphanShadows`. The `reloadFog` and `lostDiscovered` broadcasts write
  no document. Every other entry is a Judge's press: the lost dialog, the
  navigation card's buttons, `navigationThrowNow`, `travelEnterHex`.
- **The party sheet's form and drops** (`formation-actions.mjs`).
  `onChangeForm` is the sheet's submit handler, run by a change its user made;
  the sheet does not submit on close. `anchorMap`, `saveFogMap` and
  `onDropMember` are a press and a drop. A player's declaration goes through
  `executeAsGM`, which `sockets.mjs` runs on the lead.
- **The importer's `ready`** (`scripts/importer/module.mjs`). It writes no
  world document. Its load writes this browser's own storage (the refresh
  bridge's sweep, heartbeat and bytes) or opens books into this window, so
  it runs in every window. The adventure hooks (`book-adventure.mjs`) run in the window that
  imported, where core calls `importAdventure`.

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

The loadout is also where a character's imported ability modifiers land: lib
decides which rows apply and how they stack (`typed-modifiers.mjs`, stated in
`API.md`, "Typed modifiers"), and equipment writes each as its own change,
with a parts ledger beside the changes that names what wrote each one
(`docs/equipment/MODEL.md`). A sheet reads the ledger to name every part in a
figure's tooltip.

Deleting the ACTOR still works — Foundry's cascade does not route through the
per-effect refusal.

### A field an effect changes, on the system's sheets

The system's actor sheets (every sheet carrying core's `actor-v2` class, the
module's monster sheet included) bind their inputs to the prepared
`actor.system` and submit the whole form on any change. An input showing an
effect's result would therefore write that result back as the base on every
save, and the effect would apply again on top of it. `patches/stored-inputs.mjs`
runs on every render of such a sheet: each actor-field input or select whose
path appears in `actor.overrides` is given the value from `actor._source`, an
underline, and a tooltip naming the figure in force. Inputs inside an item row
are left alone, since they name the item's fields. The module's character
sheet does the same from its own render, so the patch skips it. The Follower
Card submits on change too, and calls the same `showStoredInputs` from its own
`_onRender`; its wrapper carries the actor's own id in `data-item-id`, which
the item-row test reads as the actor's fields rather than an item's.

### A weapon's two-handed die follows its imported row

A weapon's alternate damage (`system.damage.alternate.formula`) follows the
row the importer made it from. The link is the item's own record: the importer
stamps `flags.acks-extras.weapon.modes` from the Judge's weapon table, and the
mode held two-handed carries the row's second die (`damageModes`,
`importer/weapon-tables.mjs`). Where such a mode names a die, that die is the
alternate; where the modes name none, the alternate is blank. `bindWeaponRow`
writes exactly that at creation. A weapon with no stamped modes has no imported
row, and keeps what it stores. Nothing compares the stored alternate with the
one-handed die, and nothing overrides a stored alternate as the document loads.
An absent alternate is another case: a weapon created or stored with no
alternate, or an empty one, is created with a blank formula and loads blank, so
it offers one grip, by `patches/weapon-alternate.mjs`, which blanks the schema's
default for that one field. A weapon already stored with the system's default
die states an alternate by then, and is unchanged.

Weapons already in the world are brought to their row by the repair check
`lib.twoHandedRow`, which lists the world's weapons and the weapons on world
actors whose stored alternate, compared without spacing or case, differs from
the row's, and writes the row's value when ticked. An unlinked token's actor
is not walked.

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

A row may also carry `tooltipText` (the total's hover text assembled at render,
written as text, and preferred to `tooltip`) and `actions`, buttons in a
trailing column that appears only where some row has one. A section may carry
`titleTooltip` and the card `noteTooltip` and `buttons`, a footer under the
tables classed `acks-extras-roll-actions`. A button is `{action, label, icon?,
data?, tooltip?, disabled?}`; the caller binds its press. None of it is the
system's `.card-buttons` group, which the system's chat handler binds, so a
press on this card never reaches that handler. A card naming none of these
renders exactly as before.

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

Two things run on every click, whether or not the card is on:

- **A combatant with no surprise figures is taken out first.** Core reads
  `system.surprise` from every combatant on both sides with no guard. A
  combatant with no actor, or with an actor type that has no such field
  (party, group, vehicle), would throw the roll. `leaveOutUnrollable` splices
  such combatants out of the matrix's own pool arrays, which ApplicationV2
  deep-clones per instance, so the combat's pools are untouched. An info notice
  names them.
- **A throw out of core's roll is caught.** Foundry neither awaits nor catches
  an action handler, so an uncaught throw would leave the matrix open with
  nothing said. The wrapper logs the throw and raises an error notice. The
  notice names a side left with no combatant when there is one: core's
  opponent maximum over an empty side is `-Infinity`, which no roll formula
  parses. Core's `close` was never reached, so the matrix stays open for
  another cell. Rows captured before the throw still post, since their
  combatants' statuses have already landed.

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

The grouping is core's own call, `combat.manageGroup`, and this patch only
reports what it produced. The Judge makes a group with the tracker's control; a
group token that joins a combat has its gangs grouped by that same call
(`group-combat.mjs`, docs/lib/GROUPS.md, "Initiative groups"). Lib builds no
grouping of its own.

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
`initiativeCard` world setting gates the card, read per roll.

The same wrap guards the roll, on the GM seat whether the card is on or off:

- **A combat that holds a combatant with no token** (none set, or none on its
  scene) sends the WHOLE press, every id given, to Foundry's own
  `Combat#rollInitiative`, with the caller's options as given. The method is
  found by walking the prototype chain up from the wrapped class's parent to
  `foundry.documents.Combat`. The wrapped method and the card are not used for
  that press, so every row gets a number from Foundry's roll and Foundry posts
  its own messages. The system's method reads the token of every combatant in
  the combat, not only of the ids pressed, before it writes any number, so no
  split of the ids lets it number a tokened row there; the trigger is the
  combat's rows, never the ids. No group number is applied, since
  `flags.acks.groups` holds token ids. The system's rollAll refuses a
  combat whose `flags.acks.initDone` is unset (Begin Combat sets it) before it
  calls this method.
- **The notice.** The first time a combat on this client meets any of the three
  paths (Begin Combat, a roll, the group control), one notification names the
  tokenless rows (`combatant.name`, joined with ", ") and says the combat runs on
  Foundry's own start and initiative, with no surprise step and no grouping. A roll
  shows it after the roll has landed, so a press that throws announces nothing.
  The combat ids already told are held for the session, so nothing shows twice.
  The same notice shows on the primary GM's window when a row with no token joins
  a combat that already holds a group (`group-combat.mjs`'s `createCombatant`
  hook), and when the automatic gang grouping meets such a combat, which it then
  leaves ungrouped. It warns and changes nothing: the group stays, and the
  system's tracker hook still reads that group's rows' tokens at each render.
  The notice, the test for such a combat, the walk to Foundry's methods and the
  lock release are `patches/tokenless-combat.mjs`, shared by the three patches.
- **The turn-order lock.** The system sets `flags.acks.lock-turns` for the
  length of its roll. A throw out of either path sets it back to false when it
  is still set, then goes on to the caller. A roll that completes is not
  touched, so a second press in flight keeps its own lock. A roll handed to
  Foundry's method clears a lock already standing before it runs, since no
  system roll runs in such a combat to clear it and `setupTurns` ignores the
  combat while it is set.
- **The registrations.** `rollInitiative`, `startCombat` and `manageGroup` are
  registered `MIXED`, since each skips `wrapped` for such a combat and libWrapper
  unregisters a `WRAPPER` that settles without chaining. `internalStartCombat`
  always chains and stays `WRAPPER`.
- A class whose chain never reaches `foundry.documents.Combat` has no Foundry
  method to hand a press to, and every press goes to the wrapped method with no
  warning.

## Tied initiative sorts the same on every seat

`scripts/lib/patches/turn-order.mjs` is the one wrapper on the system's
`sortCombatantsACKS`, the comparator `setupTurns` sorts the combatants with.
The combat stores `turn` as an index into that order, so two seats that sort a
tie differently disagree on whose turn it is, and End Turn and the tracker's
marker follow the seat's own order.

The system's comparator is a total order for a pair that differs in
outnumbering or in being hostile, and for nothing else on a tie. Two combatants
of one side compare the same sign in both directions, and its name tiebreak is
never reached, so the order of such a pair is whatever the engine's sort and the
sequence the combatants arrive in give it. Browsers differ on both.

The wrapper leaves a pair with different initiative to the system. On a tie it
compares, in order:

1. the combatant on the outnumbering side (the flag the system writes) sorts
   after the one that is not;
2. a combatant whose token is hostile sorts before one whose is not;
3. the lower combatant id sorts first.

The first two are the system's own answers wherever it gives a consistent one;
the third decides what it left open. The id is the one key that is identical on
every client. The name repeats between combatants, and `localeCompare` reads the
seat's locale. The comparator reads nothing from `this`, since `setupTurns` hands
it over unbound, and reads the outnumbering flag as a plain property of the
combatant's `flags`, never through the flag accessors.

A combat is set up before `ready`, ahead of the wrapper, so installing it sorts
every loaded combat's turns again with `setupTurns` and redraws the tracker. That
is in memory and writes nothing; a combat with its turns locked is left alone.
The stored `turn` index is untouched, so a combat whose tied rows moved reads a
different combatant at that index until the next turn is taken.

## The group control keeps each group's own modifier

`scripts/lib/patches/group-initiative.mjs` is the one wrapper on the system's
`AcksCombat#manageGroup`, the call behind the Combat Tracker's group control.
Three defects of that method are repaired for the module's users.

The method stores each group's `initiativeBonus`, the lowest
`system.initiative.value` among its actors, which the group rolls with. Its loop
walks the tokens passed to the call for every stored group, so each new group
overwrites every earlier group's bonus with the lowest among the new tokens. And
its `this.setFlag("acks", "groups", groups)` is neither awaited nor returned;
Foundry applies an update when the server replies, so a caller cannot wait on the
call, and a second call made before the first lands starts from a list that lacks
the first group and drops it. And it never drops a token id that is no longer a
combatant, so a group whose bodies were gathered back to one row stays stored with
dead ids, and the tracker's `[G<index>]` marks count it.

The wrapper runs the system's method unmodified. For the length of that
synchronous call it puts an own `setFlag` on the combat, and a `finally` removes it
(or puts back an own one the combat carried), so `setFlag` is never wrapped and no
other document's write is touched. The shadow answers one write: scope `acks`,
key `groups`, an array. Before the real `setFlag` receives it, every token id that
no combatant of the combat holds is dropped from each stored group (an object with a
`tokens` array), and a group those ids leave with fewer than two tokens is dropped, as
the system drops one; a group with no dead id is left as it is, and the list is pruned
only when a group call writes it. Then a stored group
(an object with a `tokens` array and an `initiativeBonus`) is put right where its
bonus equals the lowest among the tokens just passed and differs from the lowest
among its own tokens; its own tokens are the combatants whose token id matches and
whose actor holds a number. A group with none of them, and any other shape, keeps
the system's figure. The call then returns a promise that resolves, after the real
write, to that write.

It stands down by observation. On a system whose bonus already comes from each
group's own tokens, nothing is corrected, the same array is written and the
promise returned waits on the system's own. There is no version gate. Should the system
move its write behind an `await`, the shadow catches nothing and the system's
behaviour stands, which the live walk (docs/lib/TESTING.md, "A warband's token in a
combat") reports. `groupGangs` awaits the call and polls the stored list after it.
The ruling is in docs/lib/DECISIONS.md, and the row that retires the patch is in
docs/lib/ROADMAP.md.

In a combat that holds a combatant with no token the method is not called at all:
the system reads the token of every combatant and throws on that one. The wrapper
shows the combat's one notice naming the tokenless rows (shown once, as the roll's
is), writes nothing and returns undefined, as the system's own refusals do. The
initiative wrap sends such a combat's rolls to Foundry's method, which makes no
groups. `groupGangs` awaits that return, finds the list without the group and
waits out its timeout for each gang it tried.

## A cancelled declaration leaves the combat unstarted

`scripts/lib/patches/combat-start.mjs` is the one wrapper on the system's
`AcksCombat#internalStartCombat` and `startCombat`, the calls behind the Combat
Tracker's Begin Combat. It is installed at `ready`.

The system's `startCombat` opens the Surprise Matrix, and a click on a cell applies
the Surprised status to the combatants that roll badly and calls
`internalStartCombat`. That method stores `flags.acks.initDone` before it asks the
action-declaration prompt, and on No or the window's X it returns, leaving the combat
at round 0 with the flag set and the statuses on. The system's `surprised` condition
has no duration, so nothing else lifts it for a combat that never starts.

Both wrappers run the system's method unmodified and act on a GM seat only. The
wrapper on `internalStartCombat` counts the starts of each combat in flight on this
seat. When the original fulfils with the combat still in the world, at round 0, and no
other start of it in flight, it unsets the flag and calls the combat's
`cleanupStatus("surprised")`. A Yes leaves round 1 and nothing runs. A rejected
original is rethrown with no cleanup, and an error of the cleanup is warned, never
thrown. The wrapper on `startCombat` does the same before the call goes through for a
combat at round 0 with the flag set and no start in flight, which is a start
abandoned by a reload of the seat while the prompt was open. A start in flight is
never cleaned, since its prompt may be open.

**A combat holding a combatant with no token** is begun by Foundry's own
`Combat#startCombat`, found by the walk up the prototype chain that the initiative
wrap uses (`patches/tokenless-combat.mjs`). The system's `startCombat` reads the
token of every combatant (`#getCombatantPools`) before its matrix opens and throws
on that one, so on a GM seat the wrapper does not call it. Foundry's start plays the
start sound, calls the `combatStart` hook, updates the combat to round 1, turn 0 and
refreshes the effect registry. There is no declaration prompt and no Surprise Matrix
on this path, and the combat's one notice says so. The system's own start would have
left two flags that its later rolls read, so the wrapper sets them before it rolls:

- `flags.acks.initDone` is set true. The system's `internalStartCombat` sets it,
  and the system's `rollAll` and `rollNPC` refuse a combat without it, so a begun
  combat that lacked it would refuse its own Roll All.
- `flags.acks.lock-turns` is set false where it stands set, as a failed roll left it,
  since a combatant write throws while it is set.

It then calls `rollAll()`, the system's override, which passes its check and calls
Foundry's `rollAll`, whose `rollInitiative` is the initiative wrap, which hands the
press to Foundry's roll, so every row has a number. The next round reads no
token: `nextRound` reads each turn's actor and calls `resetInitiative`, which is
Foundry's `resetAll`, and the combat's `pools` (which only the system's roll and
its matrix read) are never set on this path. The one read of a combatant's token on
that path's later surfaces is the tracker's colouring hook in the system's
`combat-helper.mjs`, which reads `combatant.token.id` for each combatant when a
group exists and tracker colours are on; this path makes no group, and the
colouring hook is left as it is.

The status lift reaches every Surprised on the combatants, including one a Judge set
by hand before pressing Begin Combat. The matrix's own apply path does not tell that
one apart either: it ends in `AcksUtility.addUniqueStatus`, which makes the status
active and clears none first, so the matrix never lifts a Surprised it did not apply.

It stands down by observation. A system that undoes its own start leaves no flag and
no status, and nothing is written. There is no version gate, no duration is set on the
status, and nothing in lib's conditions or status files is wrapped. The ruling is in
docs/lib/DECISIONS.md, and the walk is docs/lib/TESTING.md, "A cancelled declaration".

## A Player's welcome-version write is not sent

`scripts/lib/patches/welcome-version.mjs` is the one wrapper on Foundry's
`ClientSettings#set`; no other patch in the family wraps it. It is installed at
`init`, since the system's `ready` handler makes the call it answers.

The system's `displayWelcomeMessage` stores `game.system.version` in the world
setting `acks.welcomeMessageVersion` on every seat whose stored value is absent or
older, unawaited, and then shows the welcome dialog. Foundry refuses a world
setting's write from a user without `SETTINGS_MODIFY`, so a Player's write ends
in "lacks permission" in that seat's console. The window lasts from a system update
until a user allowed to modify settings has loaded the world.

The wrapper matches one call: namespace `acks`, key `welcomeMessageVersion`, and
`game.user` without `SETTINGS_MODIFY`, read when the call is made and never held.
On a match it does not call Foundry's method: it sends no request and relays nothing
through a Judge's client or a socket, and it returns a promise for what `set` would
return, `this.get` of the same setting with the options' `document` flag, which is
the stored value or its Setting document. The permission covers the update of a
stored setting and the create of one not stored yet alike. Every other call, and the
same call from a seat with the permission, reaches Foundry's method unchanged.

A Player sees the welcome dialog on each load until a user allowed to modify settings
has loaded the world on that version, and nothing is logged. The wrapper uses
Foundry's own check and adds no permission. Once the system guards its own write, no
seat without the permission reaches the match and the wrapper never fires. It adds
nothing to the lib API. The ruling is in docs/lib/DECISIONS.md, the row that retires
it is in docs/lib/ROADMAP.md, and the live recipe is in docs/lib/TESTING.md.

## The roll dialog

`scripts/lib/roll-dialog.mjs` is the one dialog a roll this module makes asks
through: every ability throw (the attack throw is the system's, with the
system's dialog). It shows the formula, a
situational modifier (whole numbers), and the message's visibility, opening on
the chat's own mode. Where the visibility is not the roller's to choose — an
ability the system marks blind — the dialog states the mode instead of offering
the select. Closing it returns `null` and nothing is rolled.

`skipDialogFor(event, explicit)` is the one read of the system's skip-dialog key
(`acks.skip-dialog-key`): the dialog is skipped when the caller passes
`skipDialog: true` or the named key is held on the click. A caller that acts on
the result instead of showing it (a lock the throw opens)
passes `skipDialog: true`.

The modifier enters the formula as its own term, `+ 2[Situational]`, so the dice
box and the card agree. `auditOf(roll)` reads an evaluated plain sum back into
its single dice term and the numbers added to it, and `auditLine` prints that as
the ability card's first detail line: "Natural 14 + 2 (Situational) = 16". A
formula with no added terms, two dice terms, or anything but `+`/`-` has no
audit and prints nothing. Rulings: DECISIONS, "One roll dialog, and the natural
die on the card".

## Who reads a roll

`scripts/lib/roll-audience.mjs` decides who sees which part of a roll this
module posts.

**A card for the GMs alone** goes through `postToJudges(data)`: whispered to
`gmIds()`, with `rolls` emptied. Foundry's `ChatMessage#visible` is true for any
whispered message carrying rolls, and a reader outside the whisper then sees a
"privately rolled some dice" line naming the author; with no rolls, the message
is invisible to them. Where the card's content has no markup of its own, the
rolls' boxes become the content, as Foundry would have drawn them; a card with
markup keeps it, and states or draws its own totals. `drawQuietly(table)` is
the one owner of a table draw: it draws with `displayChat` false, so core posts
nothing, shows the dice to the GMs when the draw landed on rows, and hands the
results back for a card of the caller's own — the journey's encounter card
lists a zone table's rows that way. `drawForJudges(table)` is that draw
followed by the table's own result card whispered to the GMs, with a
`preCreateChatMessage` hook — scoped to this user and this table's flag,
removed in a `finally` — taking the roll and the dice sound off it.

**Dice So Nice** is reached through `roll-audience.mjs` alone. `showDice(rolls,
{whisper, blind})` passes the whisper list as the viewers, or `null` when the
list is empty, because Dice So Nice reads an empty list as nobody.
`diceSettled(messageId)` is the promise of a message's dice finishing, undefined
without Dice So Nice.

**A secret adventuring throw** is Listening or Searching
(`SECRET_ADVENTURING`), the two Judge-secret throws (RR 265).
`patches/adventuring-roll.mjs` is the one wrapper of the system's
`Actor#rollAdventuring`, which every sheet's adventuring row ends in, and it
posts those two itself: the system's method sets no blind flag and takes no
option for one. The post follows the system's own blind contract on the
system's own card. From a player's seat the message is `blind` and whispered
to `gmIds()`: Foundry shows a blind message's author `???` in place of its
whole content, and the card's body carries `data-blind`, the mark the
system's render hook withholds. From a GM's seat it is whispered to that GM.
No roll is attached, so a seat outside the whisper is shown nothing. The roll
dialog states the visibility and asks only for the situational modifier, and
the Roll returned carries its target at `data.roll.target`, as the system's
does. Every other adventuring key runs the system's roll.
`rollSecretAdventuring(actor, key, {event, target})` is the same post against
a target the actor does not store, which the Follower Card's card-only
override uses. A caller that has a figure of its own for a key passes it as
`rollAdventuring(key, {target})`, the figure BEFORE conditions: the wrapper
holds it on the stored field with the creature's conditions applied, so the
system's roll and the secret post both read it there and the conditions count
once (the character sheet's Adventuring rows,
[character-sheet DECISIONS](../character-sheet/DECISIONS.md) 2026-11-11). An
ability item's throws are not reached: their visibility is
the ability's own `system.blindroll`
([abilities MODEL](../abilities/MODEL.md)).

**An attack card is the system's.** The module posts no attack card of its
own. `patches/attack-throw.mjs` wraps the system's `makeAttackThrow` and the
modifier and mode methods it reads (the actor model's
`getAttackThrowModifiers`/`getDamageModifiers`, the weapon's
`getAttackTypes`/`getDamageModes`/`getDamageFormula`), and every modifier this
module adds — a condition's figure, the equipment feature's per-weapon rows, a
Follower Card override — is a labelled row the system's dialog and card
already show. Contributors register through `lib.attack.addContributor` and
answer `attack`, `damage`, `attackTypes`, `damageModes` and `damageFormula`,
each returning the list it was given with its own entries added; a
contributor that throws is logged and skipped. A contributor whose answers
read something that loads after `ready` also declares `ready()`: the wrapper on
`makeAttackThrow` awaits every contributor's before it builds the throw, and a
`ready()` that rejects is logged and stops holding the attack (equipment's is
the weapon rows' wait, [equipment MODEL](../equipment/MODEL.md), "Weapon rows").
A contributor may also declare `prepare(ctx)`, asked once per attack after the
waits and before the throw is built; the first that resolves `false` cancels
the attack, which answers null and rolls nothing, and one that throws is logged
and does not hold it (equipment's asks for a missing damage formula,
[equipment MODEL](../equipment/MODEL.md), "Design rules").
That wrapper is registered `MIXED`, because it also refuses: an attacker whose
`system.attack.throw` is no number rolls nothing, warns
(`ACKS-LIB.attack.noThrow`) and answers null, the system's own answer for a
dismissed dialog. Every attack button ends there, the item sheet's and the
Equipment tab's included, so none guards for itself.
A caller passes what the
system's call cannot carry in `options.acksLib` — `terms`, `damageTerms`, a
wanted `damageMode` (honoured by listing it first, since the system opens on
the first mode), a `maneuver` — and `PRE_ATTACK_HOOK` / `POST_ATTACK_HOOK`
fire around the throw with the per-attack context, which
`lib.attack.inFlight(actor)` answers while the throw runs. Rulings: DECISIONS,
"The attack seam rides the system's labelled modifiers" and "A Judge-only
card attaches no rolls".

The system's builder is `getDamageFormula`'s only caller, and it parses the
formula only on a hit. A formula `Roll.validate` refuses would throw there,
outside every sheet's click handler, so the hit would post no card. The
wrapper answers such a formula as none, so the throw rolls no damage, and warns
the Judge once per weapon and text.

## The cast seam

`patches/spell-use.mjs` is the one wrapper of the system's `Item#_useSpell`,
the method a spell's cast count and chat card come from. The cast buttons on
the system's sheet, this module's Magic tab and the monster sheet, and the
system's hotbar macro, all reach it through `item.use()`, so a feature that
changes what a cast does registers a claimant (`lib.spellUse.addClaimant`) and
sees every cast, whichever door the player used. The wrapper offers a cast to the
claimants in registration order; the first whose `claims` answers true runs
`cast(item, options, spend)`, and `spend` is the system's own method behind a
once-only door, so a cast that is refused or cancelled spends nothing. With no
claimant the system's method runs untouched, which keeps every spell a feature
does not name, a monster's attack item included, the system's own. A claimant
that throws is logged and never costs the table a cast. What a caller can await,
and until when `spend` is valid, are in the file's header. Ruling: DECISIONS,
"One owner of the cast seam: lib".

## A spell's damage on the attack seam

A spell's damage runs the system's weapon pipeline as a fourth kind of attack,
`MAGIC_ATTACK_TYPE` ("magic"), so the throw, the dialog and the card are the
system's. The seam in `patches/attack-throw.mjs` makes that possible without a
second wrapper of any core method.

**The carrier.** `spellCarrier(actor, row, cast)` builds an unsaved weapon
parented to the caster and records it in a private `WeakMap`.
`isSpellCarrier(item)` is membership and `carrierOf(item)` what it was made
for (`castId`, `rowKey`, `spellUuid`, `delivery`, the row). Its melee or
missile flag is the row's delivery, and its base damage is the row's own
formula, damage types (`varies` is the system's `variesByWeapon`, an unknown key
is dropped) and extraordinary mark (`carrierData`). Identity and not a flag,
because a flag survives a copy and a drag.

**What the wrappers answer for a carrier.** The weapon's attack types are
`["magic"]`, its modes and its formula the system's own answers, and no
contributor is asked. The attack throw's base is the system's answer for the
delivery kind, asked of the contributors that opted in with the delivery kind
as `attackType` while `ctx.type` stays "magic", so the card reads magic. The
damage base is empty: only the rows a caller passed (`acksLib.damageTerms`) and
the contributors that opted in for `"damage"`. A contributor opts in with
`carriers: ["attack"|"damage"]`; one that declares none is never asked about a
carrier. The conditions and the roll gates opt in for the attack, equipment
declares nothing, so a spell's throw takes conditions and light and a weapon's
own bonuses stay on weapons. A module-owned creature model (`animal`, `group`,
`template`) answers `attackThrowModifiersFor` with its own base for "magic".

**Damage with no throw.** `magicDamageSpec(actor, carrier, {terms})` holds an
attack context with no target around the two modifier questions the system's
builder asks and returns the roll in the builder's shape (`{formula, data,
modifiers, types, extraordinary}`), or null when the carrier has no formula.
`modifiedFormula` composes the formula as the system's own modified formula does:
signed values, a zero left out.

**The card a cast owns.** While a carrier's attack is in flight the seam holds
`{castId, rowKey, spellUuid}` by the attacker's uuid. A `preCreateChatMessage`
listener (`carrierCardMatch`) takes the attack card of that speaker, removes its
apply-damage button and the group it empties (`stripApplyDamage`) and stamps
`flags["acks-extras"].magicAttack`, because the system's handler would write
raw hit points outside the one amount path.

**The card a weapon hit owns.** Every other attack in flight is known by its
weapon's damage (`attackDamageOf`: the base damage's types and extraordinary
mark, and whether the weapon is silver, `silverOf`: core's `system.special.silver`), by the attacker's uuid, restored
when the attack resolves or throws. The same listener (`attackApplyMatch`)
reads `data-damage` and `data-target-uuid` off the card's apply button and,
in one `updateSource`, strips the button and stamps
`flags["acks-extras"].attackApply`, `{targetUuid, rolled, types,
extraordinary, silver}`. A card whose figure or target cannot be read is left
untouched and keeps the system's button. `attack-apply.mjs` draws the press
that replaces it ("Damage against defenses").

**Which speaker a card belongs to.** Both matchers take the speaker's uuids in
order (`speakerActorUuids`): the speaker actor's own uuid, then its base actor's
when it is an unlinked token's synthetic actor. An attack made from a world
actor's sheet is held under the world actor. Core names no token on its card,
so Foundry speaks as one of that actor's tokens on the viewed scene, and the
card is matched under the base actor.

**The label.** The system has no label for the kind; at ready the seam copies
`ACKS-LIB.attack.type.magic` into the translations at the system's own key,
unless the system has one. Ruling: DECISIONS, "A spell's damage is a fourth
attack type on a carrier".

## A weapon's damage type

A weapon's damage type is core's alone: `system.damage.base.types`. The attack
roll, core's card icons and the defence stage below read it, and so does
`damage-type.mjs`: `damageTypeOf` answers the same as `ownDamageType` (the
first named type, `varies` for a weapon typed only as varying) and is null for
a weapon whose set is empty. It consults no flag, no override and no
classifier, so a surface shows the type the roll carries. The Rolls tabs, the
follower card's attack rows and a monster's attack row show no type for an
untyped weapon (the follower card and the item sheet's rail draw their neutral
icons), and the weapons core ships in its own packs are untyped. A write goes to the same field (`damageTypeUpdate`,
`weaponBaseDamage`). Equipment's classifier keeps its own `type`, the row's
for a weapon that states none, for the one question of which condition table a
weapon rolls on. Ruling: DECISIONS, "A weapon's damage type is core's alone".

## Damage against defenses

`defenses.mjs` is the one place a damage type meets a creature's immunities,
resistances and susceptibilities, for a weapon's hit and a spell's alike. The
procedure ships; its figures are read.

**Where the figures come from.** Immunity prints no figure: it removes the
damage and passes the save. Resistance's amount fraction and save modifier are
the `defenses` document's `resistanceProse` table (keys `fraction` and
`saveBonus`), declared with `expectTables` the way `senses.mjs` declares its
own and edited in the Ruledata Browser's override layer. `defenseFigures()`
answers each, null until read (a fraction outside 0 to 1 is no fraction), and
`defenseCite()` the page through `citeOf`. A susceptibility's `factor` (the
multiple of damage) and `save` (a signed modifier, positive helping the saver)
are the creature's own, on its band in `defensesField()`; blank until read.

**The sources.** `actorDefenses(actor)` is the actor's
`flags["acks-extras"].extras.defenses` and each owned item's, each source
named, and leaves out a source none of whose bands lists a damage type or sets
a quality flag. `effects` and `conditions` are not read here.

**Coverage.** A band covers a type dealt when it lists the type, or lists none
and sets a quality flag. A set flag must also match the damage's quality: the
damage is extraordinary when it is marked so, or when a silver weapon meets a
defense's `silverFlaw` (a susceptibility has none), and mundane when it is
marked so. The mark is three-valued: an imported spell row whose mark the import
could not read states none (null), and that is never read as mundane. A band
whose coverage waits on the quality (it sets exactly one flag and would cover
the type if it matched) is undetermined then; the hit is the Judge's, with
`why: "quality"`, unless the outcome is the same whether such bands cover or
not. A band with no flag, or both, covers either quality. A
band that lists a type and sets a flag needs both. A band with no flag and no
type covers nothing, so a creature's three empty default bands are no
defense. Damage with no type (none listed, or one that varies by weapon) is
covered only by a band that lists no type and sets a flag it meets; an empty
type list is never "every type". `defenseCoverage(sources, damage)` classifies a
hit:

- every type covered by an immunity: **immune**;
- every type covered by an immunity or a resistance, one by a resistance:
  **resist**;
- every type covered by a susceptibility: **susceptible**;
- anything else is the **Judge's**: a type met by a susceptibility and another
  band, a susceptibility on some types, a type no band covers beside one that
  is covered, an applying band that carries a `note`, a blank figure, or
  figures that differ between the applying bands.

A type covered twice counts once, so a fraction or a factor never applies
twice; a type met by an immunity and a resistance is immune.

**The stage.** `defenseStage(sources, damage, figures)` is pure and returns
the stage `amountAfter` takes, or null where nothing covers the hit: `{factor:
0}`, `{factor: fraction}` or the creature's `{factor}`, or `{judge: true,
why}`. Each carries the transparency fields `{key: "defense", label, band,
types, source, cite}` (`cite` is the imported page, null for a susceptibility
whose figure is the creature's). `amountAfter` keeps a defense's step even
where it changed nothing, copies those fields onto the step, and answers a
judge stage with `applied: null`, the steps before it and the stage as
`judge`; nothing after it runs and nothing is rounded.

**A reduction per die.** An ability can carry a `modifier` row `{target:
"damageReduction", perDie: true, value, gate?}` (`actorReductions`), the figure
the carrier's own and imported. `reductionStage(reductions, damage)` turns the
ones that hold against a hit into one stage, `{key: "perDie", label, band:
"reduction", minus, per, dice, source, cite}`, with `minus` the carriers'
figures added times the dice the damage roll held; `amountAfter` takes `minus`
off and stops at zero, and keeps the step with its source and page like a
defense's. The gate is one of the weapon's item gates, `weaponMundane` or
`weaponMagical` (`roll-mods.mjs` registers both, reading `isMagical`). The weapon
is not in hand at the press, so the attack seam stamps their verdicts on the
card (`gates`, `weaponGatesOf`) beside the die count of the damage roll the card
holds (`dice`, `damageDiceOf`: the roll core marks as the damage's, each term's
own number, so a critical's doubled dice count). A gate the stamp cannot answer,
and a card with no die count (an older one), give no stage and a `skipped`
list on the plan, `[{source, why}]`, `why` being `gate` or `dice`: nothing is
reduced on a guess. `planAttackApply` runs the reduction BEFORE the defenses'
stage, since it acts on the dice and a defense on what is left; the order is the
module's, not a page's.

**The save.** `defenseSaveParts(sources, damage, figures)` reads the same
coverage: immune is an `auto` success; resist is a target part of `saveBonus`;
susceptible is a target part of the creature's `save`; a figure that is blank,
or any case that is the Judge's, is one `pending` row `{label, value: null,
when: "defense", why}`. `saveSpec` calls it when given `damage` ("Saving
throws as parts").

**The weapon Apply.** `attack-apply.mjs` adds a block under a stamped weapon
card (`flags["acks-extras"].attackApply`), outside the system's
`.card-buttons`. For a Judge it offers Apply with the amount the target's
defenses leave: `planAttackApply` is `amountAfter` over the stamp's rolled
figure (the system's floored `damageTotal`, so a defense can take a hit to 0)
and the stage; a press recomputes it against the target's defenses as they
stand, writes it through `adjustHp` at multiplier 1, and stores `{state,
applied, steps, before, after, by}` on the message's flag. An amount of 0
stores a result and writes nothing; a target `adjustHp` refuses, or a write
that fails, stores nothing. A Judge's Undo puts the hit points back with
`restoreHp`. A judge stage offers no Apply: the line names the defense with
its page reference (the import's, else the section the module cites), and the
hit is applied by hand with the hit-point tool. A defense is named to Judges
and to the target's owners, who also read the target's hit points before and
after; every other seat reads "a defense" and the amount alone. Only a Judge
presses.

**What does not use it.** The hit-point tool and `adjustTargets`,
`planHpChange` and provision-day: their amounts are untyped, and the tool's
multiplier is the Judge's way to apply a defense by hand. Rulings: DECISIONS,
"Damage against defenses is one lib stage, and a weapon hit is applied by
lib".

## The natural die of a throw

`throws.mjs` is the one reader of the general automatic-failure and
automatic-success rule (RR p. 10, "Throwing the Dice"). The procedure ships; its
two figures are read. They are the `throws` document's `throwProse` table, a
`proseValues` recipe in `importer/books/rr/table-recipes-throws.mjs`, declared
with `expectTables` by `declareThrowTables()` at `init` and edited in the
Ruledata Browser's override layer: `autoFailMax`, the highest natural result
that fails, and `autoSucceedMin`, the lowest that succeeds for a thrower
proficient in the task. The page prints one natural result for each, not a
range.

`isAutoFail(natural)` is true at or below the failing edge, false above it.
`isAutoSucceed(natural, {proficient})` takes the thrower's proficiency because
the page grants the success to a proficient thrower only: `proficient: false` is
never an automatic success, and a proficiency that is not stated (not a
boolean) answers null rather than being assumed. `dieFloor()` is the lowest
natural result that can succeed, one past the failing edge. Each answer is null
while its figure is not imported, is no whole number, or contradicts the other
(a succeeding edge no higher than the failing one, which reads as neither), and
`throwsCite()` is the page through `citeOf`, null for a Judge's own figures.

**The caller's order.** The natural die is read before the target, and a
natural result that is automatic never consults the modifiers or the target. A
null answer sends the caller back to the target alone. This is the general
rule only: a throw that prints a band of its own (a botch band, a wider failure
range) keeps that band and does not read these figures.

## A record's modifiers at the roll

An Active Effect carries the figures no field a change can write holds in
`flags["acks-extras"].rollMods`, `{id, label, cite, sourceAlignment, parts}`.
`roll-mods.mjs` reads them at the roll that wants them; the feature that writes a
record resolves the figures, and lib owns the reading and the stacking.

**A part** is `{key, on, value, itemId, gate, stacksWith, notStacksWith,
provides}` plus the scope fields `scopeApplies` reads. `on` is `attack` or
`damage` (the bearer's own weapon), `ac` (an attack made against the bearer),
`save` (a saving throw) or `ward`, a protection with no figure that is told and
never added. `throw`, `reaction`, `grant` and `immune` are read by `recordParts`
and its siblings ("Reading a record's parts at a roll" below). `rollModsOf(actor)` returns one entry per part of every applicable
effect that is active; a disabled effect adds none.

**Only `stackingPart` builds a part.** `resolveStacking` reads a part's
capabilities and reference, so a bare part throws in it, and the attack seam
drops a contributor that throws without saying so. `stackingPart({value, label,
ref, stacksWith, notStacksWith, ...rest})` always gives `caps` and `ref`;
`spellStackingPart(entry)` is the part of one `rollModsOf` entry, stacking as the
record's `id` (so a printed `stacksWith` naming another record matches) with what
the part `provides`. Resolution is per field, never across them. Two parts of one
record on one field share the record's own capability, so the larger applies.

**The weapon's own bonus.** Core's rows already carry what a weapon's bonus
adds, so a record's part is resolved against it rather than beside it.
`registerItemBonusSource(source)` registers a reader, `source(item, on)` giving
`[{key, label, value, provides, cite}]`, and returns its unregister function;
`itemBonusParts(item, on)` turns every source's answer into parts, zeros left
out. `resolveItemParts(itemParts, spellParts)` puts the weapon's parts first, so
a tie keeps the weapon's figure, and returns the rows to add: a kept record part
is a row of its figure labelled `{name} ({cite})` (core's dice tooltip lists the
label, so the tooltip names the record), a weapon part that yielded is a row of
its negative labelled as yielding, and a weapon part that is kept adds nothing.
A record part that yielded is told.

**The attack seam.** `rollModsContributor` is asked for a spell carrier's attack
throw and not its damage, and for both on a weapon. For `attack` and `damage` it
reads the attacker's parts on that field whose `itemId` is the weapon's (or names
none), whose item gate answers yes for the weapon (`gateVerdict(actor, gate,
{item, token})`) and whose scope applies against the target, and resolves them as
above. For `attack` it also reads the target's `ac` parts, scoped against the
attacker, and adds a term of minus each kept figure labelled as the target's, the
target's parts resolved among themselves so two records give one figure. A `ward`
part whose scope applies or cannot be settled is told on the attacking seat and
never refused, since no row says which attacks it stops. An undetermined scope
adds nothing and is told; one that fails adds nothing and says nothing. Each
notice is told once per attack (`ctx.rollModsTold`); the answer is cached per
question and attack type (`ctx.rollMods`), because the dialog's preview asks again
on every keystroke.

**Scope.** `scopeCtxFor(other, {sourceAlignment, enemy})` is the context
`scopeApplies` reads: the other party's kinds and alignment, the record's source
alignment, and `areEnemies` of the two tokens. `vsEnemy` reads the BEARER's side
against the roll's other party, never the caster's: the bearer is the one
attacked or the one attacking, and a caster may have no token on the scene. A
scope's `sign` multiplies the figure.

**The item gates.** `registerGate(kind, evaluate, {at: "item"})` keeps a kind in
its own set (`isItemGate`). A spec gated by one answers `atRoll` with reason `item`
and never `gate`, so the roll gates' readers (`rollGatedModifiers`,
`roll-gates.mjs`) never ask it with no weapon in hand. `weaponMundane` and
`weaponMagical` are registered in `roll-mods.mjs` and read `ctx.item` alone
through `isMagical`; with no weapon they answer null. A weapon is magic by what it
is, never by what a record was put on it.

**The bearer reading.** `modifierDisposition(spec, {actorType, bearer})` with
`bearer` reads a record's row on the actor that carries it: a `target`,
`recipient` or `area` subject is the bearer's own, and the actor-type refusal
waits until the at-the-roll answers have been tried, so a monster bearer's scoped
or item-gated row answers `atRoll`. Without `bearer` every answer is the ability
reader's, unchanged. Rulings: DECISIONS, "A record's buff reaches its roll
through a lib flag, resolved beside the weapon's own bonus".

## Reading a record's parts at a roll

`recordParts(actor, on, {subject, rollKey, save, kind, ctx, rollType})` is the one
reader of a record's parts for a roll the attack seam does not make: a
proficiency's throw, a reaction, a granted proficiency, a saving throw, the
bearer's immunities. The order is fixed because it decides who wins. A part is
narrowed first (`ref` or `refs` through `satisfies` against `subject`, `rollKey`,
`saves` through `saveKindOf`, `attackKinds` against `kind`), so a part that does not
reach this roll cannot take another's place in the stacking: every spell part
provides `kw:spellrecord`, so two of them conflict, and resolving first would let a
larger part for another roll drop the smaller one that applies. Then
`partHolds` tests it; then the parts that apply go through `resolveStacking`,
larger first, so a second record of one kind leaves one figure, which stays until
the last record ends because every reader reads the live effects at the roll. A
part that declares a narrowing the caller named nothing to test goes to
`pending`, never to the roll: a figure on the wrong roll is worse than a figure
told and left out.

A part with no figure never reaches the stacking. The two kinds that have none by
nature are a `grant` (a proficiency the bearer counts as holding while none of its
abilities provides `capabilityForId(ref)`; with `mode: "set"` its `value` is the
throw's target, with no mode the throw is the definition's own) and a `throw` of
mode `auto`. They are grouped apart (a grant's by `ref`, a throw's by mode) and
carry `value: null`; a figured part of its group displaces a blank one. A `set`
figure is a target number, so which of two is better depends on the throw: lower
for `rollType` `above` (the default), higher for `below`; the caller that knows
the definition's roll type passes it.

`throwResolution` reads the `throw` parts as a roller needs them: the bonuses that
apply (`add`, resolved among themselves, with their `total`), the one set target,
and `auto`, whose `outcome` is the same word `resolveLevelOutcome` answers for a
rung with no throw. The roller's own bonuses are its own. `recordImmunity` reads
`immune` parts, `{spells, conditions}`: whether a spell (`{id, provides}`) or a
condition key is granted immunity by a record, with the record's label; marking a
cast's entry exempt is the cast's. `partHolds` takes a part or a spell's row, so
`ownSaveParts` can test the rows of the spell's own saving throw (marked
`ownSave`) for each saver before any record exists.

**An armour class set by the kind of attack** is a term on the attack. The
target's `ac` parts are narrowed by the attack's kind and tested through
`partHolds` (the attacker's weapon as `ctx.item`, the target's token as
`ctx.token`); a `set` part becomes its lift, `max(0, figure - (ac.value - dexMod +
conditions))`, where `ac.value` carries armour, shield, powers and a character's
Dexterity modifier, `dexMod` is read out of the comparison for a character (and is
0 for a monster, whose figure is its stat line's) and `conditions` is
`acMath(…, {kind}).total` and the sum of the steps its condition effects make
to `system.ac.mod` where its `ac.value` does not already hold them, as a
character's does (`acStepsCounted`, below).
Armour, shield, powers and conditions therefore compete
with the set and never add to it, and Dexterity stays on top. The lift joins the
add parts in one resolution, so a set and an add give the larger and two sets
the larger lift. The term is minus the lift, labelled with the spell and the
kind; a lift of 0 is told as yielding to the target's own armour class.

**A saving throw under a condition.** `saveModParts` and `sheetSaveShift` take the
save rolled and an `occasion`: a part's `saves` are read against it, a gate that
is off adds nothing, and a gate that cannot be told (an `occasion` gate the roll
does not name, an item gate with no weapon) is `pending`, as is a part narrowed to
saves when the roll names none. Core's own `rollSave` (`onRollSave`) passes the
save key and no occasion, so an enervated creature's figure shows only as a
told, unapplied one until a roller names the occasion.

## Saving throws as parts

`saves.mjs` composes a saving throw as named parts and makes it. `saveSpec(actor,
save, {magical, conditions, situational, parts, values, against, bearerToken,
rollMods, damage, defenses})` is pure: the stored
target, the roll's parts (a character's own modifier and Wisdom modifier when the
throw is against magic, and there a monster's Wisdom modifier where a Judge
entered the score, `actor-read.mjs` `enteredScore`; a situational figure; the
caller's parts), and the
creature's conditions through `rollMath("save", …)`, which lower the target as the
conditions' own wrapper does. A part is `{key, label, value, side}`; a target
part's value is the figure that lowers the number to roll. The saver's records'
`save` parts (`saveModParts`) join the target the same way: one whose scope
applies against `against` (`{actor, token}`, what the throw is made against, with
`bearerToken` the saver's own token) is a target part labelled as its record; one
that cannot be settled, or any scoped one with no `against`, comes back in
`pending` as `{label, value, when: "source"}` beside the conditions' own rows. An
unscoped part that holds applies, and the applying parts are resolved among
themselves. `ownRows` adds the rows of the spell's own saving throw, each tested
for this saver (`ownSaveParts`); a row that holds is a target part, one that cannot
be told is `pending`. `rollMods` defaults to `conditions`, so the party's save is
unchanged. A save rolled from a sheet goes through `onRollSave`
(`status-effects.mjs`, the method's one owner), which has no `against`: its
unscoped parts that hold join the shift and each scoped one is told and left out. Numbers on the roll
sum into one signed term (`1d20 + 3`), a part that is not a number is appended,
a zero part is not listed. Rows bound to a circumstance come back `pending` and
a figure nobody imported `unpriced`, and neither moves the target. Given
`damage` (`{types, extraordinary, silver}`, what the throw resists), the spec
also reads the saver's defenses against it (`defenseSaveParts`, "Damage against
defenses"): a target part labelled with the band, a `pending` row
`{label, value: null, when: "defense"}` where the figure is blank or the case is
the Judge's, and `auto`, `{label, source, types}` where the saver is immune to
every type dealt, else null. With no `damage` the spec has no defense part and
no `auto` key. `saveThrow` rolls it (a Foundry `Roll`, or an injected roll) and
succeeds at the target or above; with no stored target nothing is rolled; a
spec with `auto` succeeds with nothing rolled (`roll` and `total` null,
`success` true), target or no. It never runs the loss path: the
caller that applies a failed save calls `loseStates`. The party's save
(`formation/turn-engine.mjs`) calls it with `conditions: false`.

## The weapon seam

`lib/weapons.mjs` is the one door to the weapon table. A reader asks
`weaponRow(key)` for a row, `weaponKeys()` for the keys in the source's order,
`keyForName(name)` for the key a written name is (the name folded to letters and
digits, or an alias of a row), `weaponFocusGroup(key)` for the Weapon Focus
group and `weaponThrowsAsAnyone(key)` for whether every class throws it; it
never names where the rows live. `hasWeaponRows()` tells a reader whether
there is a table at all, which is how the Training strips fall back to every
melee class for a size clause when there is none.

The rows come from the one source `registerWeaponSource(source)` installed,
replacing the one before and returning it. A source's `rows`, `aliases` and
`focusGroups` are objects or functions returning them, read at every call;
with no source every accessor answers empty and nothing stands in for one.
Equipment registers the source over the imported rows at `init`
(`equipment/weapon-source.mjs`, docs/equipment/MODEL.md, "Weapon rows read from
the book"); nothing ships a weapon, so before that registration, and in a world
that imported none, every accessor answers empty. A reader never evaluates the
table at load: the training units read it at each call, and a headless suite
registers its own source. `listedKind(table, text)` is the one place a written
Weapon Focus pick is placed: it answers the single key of the imported
`weaponLists` table whose nouns the phrase names, or null.

The printed option lists are read through the same door.
- `resolveRows` adds `row.options`: the ids (`<list>.<n>`) of the noun-list
  and single-weapon options that hold a row, at most one per list. A noun-list
  option is placed by the rule that places `category` (name, then grid
  sub-header, then sub-header mates; an ambiguous match places nothing). A
  single-weapon option names one weapon, so it matches a row by name alone,
  never by sub-header and never by mates. Predicates and combinations place no
  row.
- The third tier serves every table (`category`, `focus`, `damageType` and the
  noun-list options). A row neither its name nor its sub-header places takes
  the kind the other rows under its sub-header were placed into by name or
  sub-header, when those agree on exactly one kind; `placedBy` says `"mates"`.
  Mates that disagree, a sub-header none was placed under and a row with no
  sub-header place nothing, and a mates placement is never itself a mate. A
  row the first two tiers found ambiguous takes the mates' kind only when it
  is one of the kinds they were torn between, so the tier breaks a tie and
  never overrules a row's own words. Ruling: DECISIONS, "A row takes the kind
  its sub-header mates agree on".
- `optionUnits(id)` is the weapon keys an option holds, in grid order: the rows
  whose placement lists a noun-list or single-weapon option, and the rows a
  predicate's use and size accept (`optionVerdict` true; a row of no stated
  size is not held where the predicate lists sizes). A combination, an unknown
  id and an empty import hold none. `optionOfCategory(list, token)` is the one
  option whose weapons all carry a category. `optionFindings()` reports what
  the options leave out: `unplaced`, the weapons no option holds, and
  `notWhole`, the categories no single option holds all of; both are empty
  while no list or no weapon is imported.
- `weaponOptions()` is every imported option, flat, with its kind and cite.
- `optionListImported(list)` says whether a list holds an option.
- `optionVerdict(option, profile)` answers true, false or null for one weapon.
  A predicate is read from the weapon's use and size. A noun or weapon option
  is read from the row's `options`. A combination is always false.
- `listedOption(list, text)` places a written phrase on one option.
- `categoryOptions()` maps each category token to the options that hold any of
  its rows: the provenance between the module's categories and the page's
  groups.
- `martialOption(pick)` is the martial option a Martial Training pick means: an
  option id, else the one option whose nouns the pick names, else the one
  option whose weapons all carry the category the pick is. The file registers
  the martial options as the Martial Training pick vocabulary with
  `registerSelectionVocab("martialtraining", fn)` in `vocab.mjs`: one exact
  entry per option, labelled with its printed words, answering to its nouns and
  to the category keys `martialOption` resolves to it. `selectionVocabFor` asks
  a registered provider first and at every call, so a Judge's override of the
  lists reaches it, and `hasSelectionProvider(item)` answers whether a provider
  is registered for the ability, which tells a provider's empty answer from an
  ability no provider covers; no module surface reads it. `vocab` never imports
  `weapons`.

## Automated Animations

Automated Animations has no handler for this system, so its generic chat reader
serves every card: it takes the item and the actor from the card, the token from
the speaker and the targets from the seat, and matches a row of its menus by the
item's name. A cast and an attack reach it with nothing here. It reads no result
from a card, and its own "play on a miss" setting is not registered on this
system, so unaided every attack it plays is a hit. It draws through Sequencer,
with JB2A's art.

`animations.mjs` is one listener on the hook that reader fires as it gathers a
message, `aa.getRequiredData`. The hook fires inside the card's
`createChatMessage`, so the attack that posted the card is still in flight on
the card's actor (`attackInFlight`). Where a card names an unlinked token for an
attack its world actor made, a world actor's sheet being the usual case, the
speaker resolves to the token's actor and the attack is found on the world actor
instead.

| Card | What the listener writes |
| --- | --- |
| Any card from a hidden token | `stopWorkflow`, since an effect would draw where the token stands |
| An attack card | `targets`: the target the throw was made at, whatever the seat targets now. `extraNames`: the default row. `deferrals`: the wait for the dice |
| An attack card that is neither whispered nor blind | `playOnMiss` and `hitTargets`, from the outcome class on the card |
| Anything else | Nothing |

**The default row.** The item's own name is tried first, so a weapon a row
matches keeps it, and `extraNames` follow it. They are rows of the module's
default menus, named by the kind of attack the throw resolved: `Sword`, `Bow`,
`Dagger`, with `Unarmed Strike` for a melee attack by anything but a character.
A world that has renamed the row loses the fallback and plays nothing for that
weapon. The menus match by the rinsed name holding the row's name, so one word in
a weapon's name is enough ("Bite" is a row of the on-token menu).

**A hit and a miss.** A miss lands off the target through Sequencer's `missed()`.
A whispered or blind attack writes neither field, so the module plays it as it
plays every attack and the map keeps the result.

**The dice.** The wait resolves at once unless Dice So Nice has marked the
message as animating. Dice So Nice does that in its own `createChatMessage`
listener, registered as its code loads, so it runs ahead of the reader, which
registers at `ready`.

**What the listener never sees.** A status effect's animation does not pass
through the hook (`active-effects/handleActiveEffects.js`, in Automated
Animations' source), so it plays on a hidden token too. An attack with no item
leaves the card's item id empty and the reader stops there. A spell plays as it
reads. Automated Animations' template rows, on a system it does not name, take
the scene's last region (`router/traffic-cop.js`), since nothing here tells it
where a spell landed.

Rulings: DECISIONS, "Automated Animations is told what a card cannot say". The
recipe is TESTING, "Automated Animations".

## Expedition figures

[movement-scales.mjs](../../scripts/lib/movement-scales.mjs) turns a party's
exploration speed (feet per turn) into miles per day and per hour, and prices a
day's march. The figures under it are the Expedition Speed page's (RR ch. 6),
and none ships: the feet-per-mile ratio, the dedicated, forced and ancillary
travel hours, and the wilderness factor are the `expedition` table of the
`travel` ruledata document, read by the importer from the Judge's copy
([the importer's MODEL](../importer/MODEL.md), "The expedition figures").

- A pace's multiplier is **derived**: its hours over the dedicated day's. The
  dedicated pace is 1 by definition. A forced march is longer, not faster, so
  `milesPerHour` is the same on every pace and `milesPerDay` scales with the
  hours.
- Nothing imported means **null all the way down**. `expeditionFrom`,
  `explorationFromExpedition`, `inWilderness` and `paceFigures` answer null
  for a figure whose inputs are missing, and one missing figure costs only what
  stands on it: with no forced hours the forced pace has no multiplier, while the
  dedicated day still prices. `explorationFeetPerTurn` stays a number (it is
  the party's own speed). A consumer leaves the figure blank and never shows a
  zero, which a throw target or a day budget would price as a real figure.
- `expeditionTip` is the figure's provenance for a tooltip: the ratio, the
  pace's hours and the page the table was read from (`expeditionCite`); with
  nothing imported it is the empty string. A Judge's override of the table
  replaces it whole and carries no page.
- Consumers: the Formation journey strip and day close, the camp search's target,
  the Vehicle sheet's Travel tab, and the voyage's comparison with a march.

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

**A rung can be set by hand** (`setRung`): the rung chosen, that ladder's two
runs reset, and `handSet[ladder]` marked. `handSet` is `{nourishment,
hydration}`, always carried by `survivalOf` as two booleans, and
`advanceSurvival` clears the mark of every ladder it steps, leaving a `HELD`
one as it was. Neither ladder steps down on a day short of full, so a hand-set
rung above what the clocks give stays until a full day's ration or water.

**Fatigue is the body's third ladder**
([fatigue.mjs](../../scripts/lib/fatigue.mjs)), beside hunger and thirst for
the same reason. Three clocks, each reset by its own answer: days of activity,
reset by a dedicated rest day; nights without restful sleep, reset by one;
forced marches in a row, reset by a day not forced. Each tires the body when
it reaches the imported count. Endurance's allowance (its base, its rate per
point of Constitution bonus, its extra for a labourer) extends the sleepless
count, Labor exempts the run of days, and nothing exempts the forced march. A
fatigued body gains a `fatigued` stack a day until a rest day with a restful
night ends it. What makes a night restful is the same file's (`restfulNight`):
sleep at all, the sky's needs met, and an armoured sleeper's throw over the
stone it bears; the rounds to don the kit are the imported rate per stone.
The caller rolls the die and writes the body; the ladder is pure. Unimported
counts tire nobody, and the clocks still run.

## Conditions

The token palette opens on the conditions of RR 507-515 and the states a
combatant declares or takes up in a round (RR 291-303)
([conditions.mjs](../../scripts/lib/conditions.mjs) is the catalogue and the
math, [status-effects.mjs](../../scripts/lib/status-effects.mjs) the Foundry
half). Three entries beside the catalogue are there because something reads
their id: `dead` (the tracker's defeated marker), `invisible` (core's
detection modes) and Running (the senses). Two more, `diseased` and
`frostbitten`, are the marks the weather leaves (the formation's toll card
applies them): they carry no figures and forbid nothing, and name a body the
Judge resolves from the book. What else the palette offers, and in what order,
is the Judge's ("The palette is arranged by the Judge", below).

**The states of a round.** Readied, Delayed, Casting, Defending,
Countercharging, Cover, waist-high (and Cover, chest-high), Retreating and
Withdrawing are catalogue entries like any condition, toggled from the
palette. Four of them carry figures: a Defend action's are on the Armor Class
of whoever it protects, by the kind of attack, and on its Blast saves; cover's
are on what is shot or thrown at the creature behind it and on its Blast
saves; a countercharge's is on its maker's throw.
Countercharging and Retreating bring Disordered with them. A declared spell
stands down what Defending gave, and the greater cover stands down the lesser.
The ones a combatant declares or takes up for a round are lifted when its turn
comes again; cover stands until taken off. A Defend action can be given:
marked on an ally while its defender acts it is the defender's, and both the
turn that lifts it and the spell that stands it down are the defender's
("Whose state it is", below). `readied`, `delayed`, `surprised`
and `slumbering` are also the ids the system's tracker writes, so a mark the
tracker sets and one toggled from the palette are one status, and Delayed is
the system's to lift: its tracker clears it from every combatant as a round
begins.

**A Defend reads the shield at the roll.** Defending is one condition, one tile
on the palette. Its melee row applies unconditionally; its thrown, missile and
Blast rows are marked `when: "shield"` and apply only for a creature that holds
an equipped shield (`shieldOf`): an armour item of the shield type that is
equipped, read off the items and never off `system.ac.shield`, which is the sum
of the shields' Armor Class values and reads as none for an equipped shield
whose Armor Class was never imported. With none, a character is known to hold
no shield and the rows are left out, as the scope filters leave a row out, so
they are not reported unpriced; any other actor type is unknown, since a
monster's Armor Class is typed by hand and no importer writes armour onto one,
and the rows are returned in `pending` for the roll's notice (`reportPending`).
A Judge settles a monster by equipping a shield item on it. A Defend an ally
was given reads the giver's shield, and the bearer's own where no giver is
found; a hand-built subject with no `shield` field is unknown, never absent.

**The catalogue is structure; every size is imported.** An entry says what a
condition carries with it (`implies`), what it takes away (`forbids`), what it
makes the creature immune to (`shuts`), when the tracker lifts it (`ends`),
whether another combatant can give it (`given`), what takes it away before
then (`lost`), and which rolls it reaches (`mods`). A `mods` row names a roll and a SLOT; the
figure in that slot arrives in the registered `conditions` document's
`modifiers` table, which the importer's `conditions-binding.mjs` assembles
from the Judge's book. `CONDITION_SLOTS` is derived from the rows and is the
contract between the two. A slot nothing registered contributes nothing and is
named in the math's `unpriced` list, so an unimported world toggles conditions
and applies no figure. A row can be narrowed two ways: `scope` names the kinds of
attack it reaches (on an Armor Class row, the kinds it stands against), and
`saves` the saving throws. A roll that states no kind, or no save, takes no
row narrowed that way.

**Core's condition effects carry the figures they reach; nothing else is stored
on an effect.** The system gives eleven of its conditions Active Effect changes
(`CONFIG.ACKS.conditions`, each entry's `system.changes`), and the palette
registers that entry as the catalogue entry's data
(`knownStatuses` in `status-effects.mjs`; the name and the icon stay the
catalogue's), so an effect made by toggling the status holds the system's
changes. The system applies them to the fields they name: a throw's, a
character's Armor Class and a character's save modifier. The catalogue has no
row for a figure that effect applies, so each figure is counted once, by the
effect. Where the effect does not reach, the module reads the effect's applied
step and holds no copy of a figure ("A non-character's Armor Class and save",
below). Every other figure is stored on no effect: a roll reads the creature's
statuses at the moment it is made and closes them under `implies`
(`conditionSet`). Three things follow, and each was a reason for the shape:

- A creature has a condition once, however many effects name it and whether it
  arrived directly or by implication. A prone, webbed and surprised target is
  vulnerable once.
- The math applies whoever created the effect: the palette, a macro, another
  module, an imported spell.
- Figures imported after a condition was applied reach it.

The exceptions to "once" are the rows marked `per`, where the rule itself
counts causes. The count is the number of enabled effects carrying the status,
each weighted by `flags["acks-extras"].conditionStacks` when it has one.
`conditionStacksOf` reads that count for one condition and `setConditionStacks`
writes it, switching the status on when absent and lifting it at zero, so a
ladder that climbs by the day (fatigue) moves the one effect the palette
toggles rather than stacking effects of its own.

**A state that brings a condition rides on one effect, and a condition counts
once.** A catalogue state whose `implies` names a condition that carries changes
in `CONFIG.ACKS.conditions`, and whose own closure does not forbid acting (no
roll the brought change reaches could be made), is registered as one status
entry that names the statuses it brings, with a static `_id` and its own
changes followed by each brought entry's (`knownStatuses`). The set is derived
from the catalogue and the system's list, never listed. The static `_id` is a
pure function of the status id (`conditionEffectId`), because Foundry finds the
effect of a status by it. Toggling the state therefore makes the one effect
Foundry builds, holding the state and the condition it brings and both figures;
toggling it again takes all of it off, and the turn's lift clears it through the
state's own status. An effect that holds one of these states under another id
(one made before the entry took this shape, or a cast's record of the state) is
not found by a click on the state's tile. `lift` ends it with the state: after
the system's toggle it deletes each effect that holds the lifted status with
only the statuses its entry brings, and leaves an effect that holds any other
status beside it.

One condition's change on one field must apply once, however many effects carry
it: a state beside a hand-set copy of the condition it brings, two states that
bring one condition, and a condition set twice. `countsOnce(effect, change)`
(`roll-mods.mjs`) is the rule: a change belongs to the status of its effect
whose system entry carries its key (none, or more than one, and it counts), and
it counts unless an earlier active effect of the same actor, in
`allApplicableEffects()` order, carries that status and a change on that key.
It reads effects and never `actor.statuses`, which Foundry fills in the loop
that asks. The rule runs inside a wrap of the Active Effect class's
`shouldApplyChange` (`status-effects.mjs`, the one owner of that method; the
wrapped answer comes first and a refusal stands), so Foundry's preparation of
every actor, character or monster, applies it; and every reader takes it as the
`admit` option of `orderedChanges` and `activeNumericChanges`
(`effect-scan.mjs`), so a step Foundry did not apply is a step no reader
reports. With one carrier gone the other applies at the next preparation.

**Active and target.** `attackMath` reads both sides of one attack throw. The
attacker's own rows become terms on its throw. The target's `against` rows
become terms on the same throw, and so do the target's own Armor Class rows,
sign reversed — a throw against a lower AC and a throw with that much added
are the same throw, and a term carries the condition's name where a moved AC
would not. A condition the attacker carries can also `expose` its target, and
a row marked `when: "source"` reaches only the opponent that imposed the
condition (matched on the effect's `origin`); an effect that names no origin
reaches everyone. The flank and a subjacent target are choices the system's
attack dialog prices itself (its direction and its subjacent box), so the
**Flanked** and **Subjacent** statuses mark the state and carry no row.

**What an opposing creature imposes on a surprise roll.** A monster's ability can
carry a `modifier` row `{target: "surprise", appliesTo: "opponent"}`: a figure
added to each roll of the side opposing it. A character's row is the loadout's
(`surpriseothers`, which core reads as the highest of a side's opponents); this
reader takes the types that have no such field and follows core: each side's
roll gains ONE part, the most adverse of the opposing carriers (the largest in
magnitude, a penalty before a bonus of the same size), so carriers do not stack
and two with one figure give it once. Sides are the matrix's (hostile,
neutral and secret against friendly), and a carrier never shifts its own side.
`withSurpriseConditions` adds that part to each combatant's held figure, with or
without conditions of its own, and names every part by its source and page in
the notice the roll already posts. A row under a gate or a free-text condition
that nothing at the matrix can decide is told and not applied. The figure is
the row's, imported; no figure, or a zero, adds nothing.

**A non-character's Armor Class and save.** The system adds a condition's
`ac.mod` to a character's `ac.value` when it prepares the actor, adds `save.mod`
to a character's saving throw only, and leaves a monster's `ac.value` as its
stat line. So for a non-character the module reads the condition effects' steps
itself, through one reader (`conditionSteps` in `roll-mods.mjs`):
`activeNumericChanges` on the field, replayed from the field's stored value
(the system's preparation derives neither `ac.mod` nor `save.mod`, so an
override, a multiply or a bound reads as the shift it makes to what the
creature stores), narrowed to the changes `countsOnce`
admits and to the effects whose statuses include an id whose system entry
carries changes, an id set read from `CONFIG.ACKS.conditions` at the call. A
step's `condition` is the status its change belongs to (the Armor Class step on
a charging effect is Disordered's), else the first status of the effect that
carries changes. The reader looks at no actor type; its
callers do, and a character is never asked, since its prepared field already
holds the step. A monster target's Armor Class steps are terms on the
attacker's throw, sign reversed and labelled as the target's
(`conditionContributor`), and are taken into `armourLift`; a monster's save
steps lower its saving throw's number (`onRollSave`) and its spec's
(`saveSpec`). `saveSpec` also lets the steps of a condition reach every save,
as the system's roll does for a character: they are named parts of the throw,
and the rest of `save.mod` stays the magical throw's alone.

Whether a target's Armor Class already holds its steps is one predicate,
`acStepsCounted(actor)` (`roll-mods.mjs`), which the throw's terms, the lift
and the attack card's rows read: true for a character, and for another of the
system's types where `systemCountsAcMod(type)` sees the system count the
modifier. That probe builds two bare actors of the type in memory, never
stored, once the world is ready, differing only in their stored `ac.mod`, and
compares their prepared `ac.value`: a difference of that mod is counted, none
is not, anything else cannot be told and keeps the steps as terms with one
console warning. It runs on the first attack against the type and the answer
is kept per type. A character is never built for it, and neither a package's
sub-type nor a type the system gives no data model (Foundry's `base`, whose
preparation fails) is probed. A system that starts counting a monster's Armor Class modifier
therefore retires the terms, the lift's steps and the card's monster-only rows
without an edit, and such a monster is read as a character is, its waiver not
applied. The save steps do not stand down, since the system's roll leaves no
prepared figure to compare: while the system rolls, `onRollSave` holds their
total off the monster's `save.mod`, so a system that adds that field to a
monster's roll counts its stored part and the module the steps, each once.

**An effect's step is named where it is shown.** `stepLabel(effect, condition,
type)` (`roll-mods.mjs`) names a step by the effect's own name, followed by the
name of the condition the change belongs to where the two differ (a charge's
Armor Class step is its disorder's); an effect with no name is named by its
condition, and `lineLabel` draws the same text from a line. Where the step's
change type is none of `add` and `subtract` (it sets, multiplies or bounds the
figure), the label ends with the type in Foundry's own word, the localized
`EFFECT.CHANGES.TYPES.<type>` that `kindWords` gives for every surface, the
character sheet's tooltips included; a step that adds or subtracts is named
without one. `kindedLabel(label, type)` is the one place a name takes the word
(`stepLabel` calls it). `conditionSteps` carries each step's `type`, a waived
step's too. The attack card's
line, a saving throw's condition parts (`saveSpec`) and the notice a monster's
save step is told by (`onRollSave`) take their names from it, so one effect
reads alike on all of them. A monster target's Armor Class step is a term of the
attacker's throw named by its condition, marked as the target's
(`termLabel`, `status-effects.mjs`), and it gains the same word through
`kindedLabel`: the term and its waived entry carry the step's `type`, and a
term of the module's own carries none and reads bare. `effectLines(actor, key, {base})` is the same
reading for a whole field, in the shape of the system's own attack-card
breakdown (the stored value, a line per effect, the remainder), rebuilt here
because the system ships as one bundle and its function cannot be imported:
`activeNumericChanges` narrowed by `countsOnce`, grouped by effect in
application order into `{name, condition?, value, kinds, effect}`, `value` the
signed step read from the effect document at the call, `condition` present only
where its name differs from the effect's, `kinds` the change types of the
effect's counted changes on the key other than `add` and `subtract`, each once
in the order met (empty for an effect that only adds or subtracts). An effect
that nets to nothing has no line.
A caller states the remainder itself, as the prepared value less the stored
value less the sum of the lines; the character sheet's tooltips do
(`effectBreakdown`, docs/character-sheet/MODEL.md). The builder is not part of
the API.

**A waiver of an Armor Class figure.** An ability can carry a `modifier` row
with `target: "acWaiver"` and a `conditions` list: the creature does not suffer
the Armor Class figure of those conditions. It names the condition and not the
row: a charge has no Armor Class figure of its own, its disorder is what it
costs, so a waiver of the charge leaves out the disorder that the charge alone
brings. A disorder the creature carries in its own right, or one a second
condition implies (a countercharge), stands, and naming the disorder itself
waives it whatever brought it. The decision is one function
(`acWaivedSet(subject)`, from the subject's `acWaived`, which `subjectOf` fills),
and `subjectOf` also names the conditions only an effect carrying the status
that implies them carries (`implied`: an effect of charging and disordered
carries an implied disordered, and an enabled effect of disordered alone, or of
disordered and a status that does not imply it, makes it carried in its own
right). The decision does not read an implied condition as carried in its own
right, or the waived condition would sustain itself. A condition a state implies
rides on that state's own effect, as Foundry's implicit statuses carry it; no
module effect is written for it. Two appliers read the decision, by where the
figure is applied:

- The module's own `ac` rows, which are Defend's: `collect` leaves a waived
  condition's row out of `acMath` and the target's side of `attackMath` and
  reports it in `waived`. The list is empty in practice.
- A monster's directly held condition: the step reader judges each step by its
  own condition, the status its change belongs to, and puts a step whose
  condition sits in the decision into `waived` instead of `steps`, and the
  attack seam merges that list with the rows'. A change that belongs to no one
  status is waived only when every status of its effect sits in the decision:
  no waiver on a guess. A disorder a waived charge brings is the charging
  effect's own Armor Class step and is waived with it, so a waived charge alone
  leaves no step; a countercharge or a hand-set disorder beside it carries the
  condition in its own right, and one step stands.

A character who holds the waived condition directly is not waived: the system
folds the step into `ac.value` itself, and the module has no seat in that
computation, so the waived step is still in the Armor Class the card shows and
the card's line lists it. Only the Armor Class figure is waived: the
condition's own throw figure, what it forbids and what it implies are as
before. A gated row is not read, so no waiver is applied on a guess.

**The attack card names a target's condition.** A character target's `ac.value`
already holds the steps of its condition effects and the system's card prints
that one figure, so the card names none of them. The attack seam asks a reader
slot (`setTargetAcReader`, filled by `attack-card-target-ac.mjs` with
`targetAcRows`) for the target's rows before the system rolls: each step the
condition effects make to `system.ac.mod`, as `{name, value}`, the effect's own
name (with the name of the condition the step belongs to where the two differ,
a charge's step being its disorder's) and the step as it stands in the effect.
A monster target has none unless its waiver spares a step (its steps are terms
on the throw): then the rows are the steps the throw counts, then each waived
step as `{name, waived: true, by}` with no figure, `by` being the abilities
that waive it (`acWaiverSources`: the ability's name and its page, an implied
condition taking the sources of the condition that implies it). A step the
Armor Class waiver spares on a character is listed, because the system folded it
into the Armor Class the card shows. The seam holds the answer by the attacker's uuid beside the weapon's
damage, for a weapon attack and a spell carrier's alike, and stamps it as
`flags["acks-extras"].targetAc`, `{target, rows}`, on the system's attack card
when the message is created, with or without an Apply. The stamp is the record:
the render hook draws from it and never reads the target again, so the line on
an old card is what that throw counted.

A render hook appends two spans to the card's footer (the footer is made where
the card has none): `data-acks-visibility="target-ac-shown"` names each
condition with its signed step, and `target-ac-hidden` names them alone. The
system's chat message removes the one the viewer may not see once the render
hooks have run, so the module tests no setting. A re-render removes the line it
drew before it draws again. The tooltip of the shown span names the effect, the
target, the step and that the step is already in the Armor Class shown, with the
page; the hidden span's names no step. A waived row is told after the counted
rows in both spans, as "not counted: <name>, waived by <ability> (<page>)", and
its tooltip says it is not counted. The line adds nothing to the throw.

**Where each roll takes it.**

| Roll | Seam | How the figure rides |
|---|---|---|
| Attack | a contributor on the attack seam (`patches/attack-throw.mjs`) | Labelled rows added to the system's own attack-throw and damage modifiers, so its card names each condition; a scaled damage roll and a waived throw, which the throw cannot carry, are told in a notification |
| Saving throw | wrap of `rollSave` | `saves.<save>.value` shifted, by the rows and, for a non-character, by the steps its condition effects make to `save.mod`; the save rolled is passed to the math, for the rows that name theirs, under the conditions' name for it (`saveKindOf` in `actor-compat.mjs` reads an older `breath`/`wand` key as its current one) |
| Adventuring throw | `withAdventuringConditions`, called by the throw's own wrapper (`patches/adventuring-roll.mjs`) | `adventuring.<key>` shifted |
| Proficiency throw | `withModifiers` in abilities' `ability-rolls.mjs` | Folded into the target every surface shows |
| Morale | `withMoraleConditions`, called by the morale roll's own wrapper (`patches/morale-roll.mjs`) | `details.morale` shifted |
| Surprise | `withSurpriseConditions`, from the surprise-card patch | `surprise.avoidsurprise` shifted for the matrix's whole roll: by the combatant's own conditions, and by the most adverse part the opposing side's carriers impose (below) |
| Speed | wrap of `_calculateMovement` | Each derived speed scaled; several reductions do not compound, the slowest governs |

A shift is held on the in-memory field only while core reads it and is put
back in a `finally`; no document is written. Core's sheets render those same
fields in editable inputs, so a value changed at prepare time or by an Active
Effect would be submitted back as the creature's own.

**What a roll cannot see is said, not guessed.** A row waiting on a
circumstance the roll does not state (a save against fear, a task that needs
sight) is returned as `pending` and told to the roller with its figure. An
attack a condition rules out, a target a kind of attack cannot be made
against, and a creature that makes no morale roll are warned about; the roll
is still made.

**The tracker lifts what ends.** On `combatTurnChange` the combatant whose
turn begins loses its `ends: "turn"` conditions and the others lose the ones
it gave them, and `deleteCombat` lifts `ends: "combat"` from everyone in it.
The primary GM's client does it. `surprised` and `delayed` are the system's
to lift.

**A round begins when it is rolled.** The system clears every initiative as a
round opens (its `initiativePersistence` setting, `reset` unless the Judge
changed it), and core keeps the tracker on one combatant while a roll re-sorts
the order. A round that opens on a combatant with no initiative has therefore
not begun, and a change of the current combatant inside it is the roll and no
turn. It begins when the last combatant has rolled, with the turn of whoever
then stands at the head of the order. Where the Judge moves the tracker on
before that, the round begins there: the turn the tracker left has passed, and
that combatant loses what it carried into the round and keeps what it took up
in it (`start.round` on the effect). The lifting client holds which rounds
have opened and not begun (`unrolled`), in memory. A fight whose initiative is
kept from round to round never opens one.

**Turn hooks.** Wherever the tracker begins a turn it fires
`acksExtras.turnBegan(combat, combatantId)`, and where it leaves a turn that
began, `acksExtras.turnEnded(combat, combatantId)`, both on the primary GM's
client (`TURN_BEGAN_HOOK`, `TURN_ENDED_HOOK`). One of each per real turn: the
turn that ends is the one the round advance or the forward move left, and it
ends before the next begins. A round that opens unrolled ends the turn it was
advanced from and begins none; leaving a round that never began ends nothing. A
change of the current combatant while a round awaits its rolls, the same
combatant's place in the order moving, and the Judge stepping back fire neither
(`turnEdges`, `turn-life.mjs`). A turn the Judge passes over by hand in an
unrolled round begins and ends as it is passed, since the tracker lifts at it.
The conditions lift as before, on every change of the current combatant; only
the hooks and the records below take the stricter reading. The hook fires after
the records and conditions of that edge are lifted, so a listener reads the
world as the turn finds it. Lib's one listener of its own hooks is the
delayed-damage reader (below).

**A record that lasts turns.** An Active Effect on the actor of any combatant of
a fight (a linked actor, or an unlinked token's own) may carry
`flags["acks-extras"].turnLife`, `{combatId, combatantId, edge, count, seen}`.
At each `turnBegan` for that combatant in that fight the record's `seen` goes up
by one, and the record is deleted by id at its edge: `start`, at the turn start
that brings `seen` to `count`, before the conditions and the hook of that
moment; `end`, at that combatant's `turnEnded` once `seen` is at `count` or
more. A record written during the combatant's own turn has `seen` 0 at that
turn's end, so an `end` record of one turn lasts through the combatant's next
turn. A record is written once at each turn edge it takes part in: a `seen`
update at a begin, or the delete at its edge (a `start` record's last turn is
one delete and no update; an `end` record's last turn is the update at its begin
and the delete at its end, two writes). A
record of another fight is never read, and a record whose fight is deleted is
left where it is: its flag clock ends it. Lib counts turns and deletes; what a
record means is its writer's.

**Damage that lands later.** An Active Effect on the struck creature may carry
`flags["acks-extras"].delayedDamage`: the clock of a `turnLife` record
(`{combatId, combatantId, edge, count, seen}`) and a damage, a flat `amount` or
a dice `formula`, with the `source` and the `cite` the card names. The count is
the bearer's own turns, one a round, so a count of rounds and a count of turns
are the same figure; the amount, the formula and the count are the carrier's,
imported. It is a flag of its own and never `turnLife`: the tracker deletes a
`turnLife` record as it comes due, before anything could apply the damage.
`delayed-damage.mjs` listens on `TURN_BEGAN_HOOK` and `TURN_ENDED_HOOK` (the
primary GM's client, once per real turn, none for a re-sort or a step back),
counts each turn, and when the record is due DELETES it first, then rolls a
formula, writes the damage through `adjustHp` (mode damage, multiplier 1, no
defense stage: the record holds no damage type) and posts the hit-point card
with source, page and amount. A client whose delete fails deals nothing, so the
damage lands once. A bearer whose combatant has left the fight, or that is
defeated or marked dead, gets nothing: the record is deleted and no card
posts. `delayedDamageEffectData` builds the effect a feature creates. The
Judge's Undo of the hit points is the hit-point tool's.

**The world clock, the second clock of that record.** A fight can end before a
record is due, and the world clock does not move during a fight (core's round
time is nothing and neither the system nor this module sets it), so a record
counted only in turns would stay on its bearer for good. The record may
instead carry `{dueAt}`, a reading of `game.time.worldTime` in seconds, and no
combat fields. A record made outside any fight starts there. On `deleteCombat`
the primary GM's client moves each pending record of that fight onto it, in one
write that sets `dueAt` and unsets the five combat keys: the rounds still to run
(the count less the turns seen, at least none, a part of a second counting
whole) times the round's length in seconds, from the clock's reading at that
moment. The round's length is read at that moment through `roundSeconds()`
(`time-unit.mjs`), never kept. Records are
found by actor (every world actor and every unlinked token's), not through the
fight's combatants, since a deleted scene takes tokens with it and the record
stays on the actor. A bearer that has left the fight is still struck, and its
record moves; one that is defeated or marked dead is owed nothing and its
record is deleted. `onWorldTimeAdvanced` (`world-time.mjs`, primary GM only)
then lifts every due `dueAt` record in the order above (delete first, then
`adjustHp`, then the card; a bearer marked dead gets nothing), and the lift also
runs once right after a conversion, so a record already due at the fight's end
lands then. Clock steps are run one after another, so two in quick succession
lift a record once. A `dueAt` that is present wins over combat fields left
beside it, and a turn event never touches a world-clock record.

A fight deleted while no primary GM is seated converts nothing, and its
records stay on their combat clock.

**Whose state it is.** Foundry writes on every effect an actor is given who
was acting when it was made (`start.combatant`, `start.initiative`). A `given`
state made while another combatant of a fight its bearer is also in acts is that
combatant's (`giverOf`): it is lifted at the giver's turn, and a row's `unless`
is read on the giver's statuses (`subjectOf(actor).gifts`). Made with nobody
acting — outside a fight, or before the round's initiative is rolled — or while
the world's current fight is one its bearer holds no combatant in, whatever
scene that fight is on, it is its bearer's own.

**Lost before it ends.** `lost` on an entry names what takes the state away
early (`LOSSES`, RR 293-295). Each is caught on the client that made the
change, which is one client and holds the rights the change needed, and that
client is told what was lost and to what:

- *Damage* is an actor update that lowers `system.hp.value`. The earlier value
  exists only before the update, so the pre-update hook marks the operation
  (`options["acks-extras"].hpFell`) and `updateActor` acts on the mark. An
  unlinked token's actor runs the same hooks: core runs an Actor update's
  pre-update on the synthetic actor and sends only the server an ActorDelta
  update (`client/data/client-backend.mjs`, `#adjustActorDeltaRequest`), and
  `ActorDelta#_onUpdate` calls `updateActor` on every client. A write to the
  ActorDelta document itself (`token.delta.update`) runs `preUpdateActorDelta`
  instead, which marks too.
- *A failed saving throw* is read in the `rollSave` wrap: the roll core
  resolves to, against the number it was rolled against with the shift in it.
- *A move* is `moveToken` for a token whose combatant is not the one acting,
  in a started fight whose acting combatant has an initiative. A move undone
  is not one. The hook says neither who moved the token nor why, so a move
  made out of turn and one forced on the creature are the same event.

All three end in `loseStates(actor, cause)` (`status-effects.mjs`), which takes
the states `cause` costs off the creature, tells the table, answers the ids it
took and fires `STATES_LOST_HOOK` (`acksExtras.statesLost`) with `(actor, ids,
cause)` only when something was lost. A feature that rolls a saving throw of
its own (`saves.mjs`, "Saving throws as parts") calls it for a failed one; the
throw does not.

`casting` and both concentration states are lost to damage and to a failed
saving throw, and to nothing else: a move costs a concentrating creature
nothing. While `loseStates` lifts, it holds `{cause, ids}` under the actor's uuid,
and `lossInFlight(actor)` answers it. The delete hooks `lift` fires run on the
same client while it is held, so a listener can name what cost the state; it is
cleared when the lift finishes, a failed one included, and only by the loss that
set it. `STATES_LOST_HOOK` fires after the lift and cannot say it. A state taken
off by any other path (the token HUD, a hand delete) carries no cause.

**Earlier ids are the system's.** The system renames Foundry's generic status
ids on an actor to its own conditions at upgrade (its migration
`m6-core-status-effects`), and points Foundry's blindness at `blinded` at its
own `init`. This module keeps no table of earlier ids and no repair check for
them.

**The palette is arranged by the Judge.** A status is *known* when something
offers it, and each source has a default. The system writes its own
`CONFIG.statusEffects` at `init` (`ACKS.conditions`, `ACKS.combatStates` and
Foundry's `dead`, `invisible`, `fly`, `burrow`, `hover`, plus the rest of
Foundry's list when its setting "Include Foundry core status effects" is on);
this module is the one writer after it: at its own `init` it remembers that
list, empties it, and writes the palette.

| Source | What it is | By default | Off the palette |
|---|---|---|---|
| `condition` | the catalogue's conditions: every one the system ships, and `immune`, `resistant` and `subjacent` | on | registered, hidden from the HUD |
| `state` | `dead`, `invisible`, Running, and the catalogue's rows marked `state` | on | registered, hidden |
| `custom` | a status the Judge made | on | registered, hidden |
| `system` | `CONFIG.ACKS.combatStates` (Readied and Delayed, which the catalogue names, are on by default), and any `CONFIG.ACKS.conditions` the catalogue does not hold, as the system wrote them | off, but Readied and Delayed | registered, hidden |
| `foreign` | what `CONFIG.statusEffects` held when this module took it, less the above: Foundry's own list | on exactly when the system's setting is on, and never for `dead`, `invisible`, `fly`, `burrow` or `hover` | not registered, but for those five, which the system keeps: registered, hidden |
| `foreign` | what another package registered afterwards | on | registered, hidden |

A status that code toggles by id stays registered off the palette, so the
toggle still finds it; the HUD is told to leave it out (`hud: false`). The
system's combat states are such statuses: its tracker's Done, Readied and
Delayed controls toggle them by id, and the `hud` flag the system gives them
does not follow them onto the palette, though Readied and Delayed, which the
catalogue also names, are on it by default.

**A condition's name, icon and id are the system's.** The catalogue holds an
id's `label` and `img` only where the system ships no entry for it
(`CONFIG.ACKS.conditions`, `combatStates`): a shipped id is offered with the
system's `name` key and `img`, and its whole entry, less `hud`, as the data an
effect made from the palette carries, so the effect `changes` the system
attaches to eleven of its conditions ride on it (this module's rolls still read
the status; see "Conditions"). `conditionNameKey(id)` (`conditions.mjs`) is the
one place a name key is built, read from `CONFIG.ACKS` at the call: the system's
key for a shipped id, the module's `ACKS-LIB.condition.<id>` for the rest, which
are the only lang keys the catalogue has. `conditionLabel(id)` is the localized
name, and `CONDITION_KEYS[id].label` (the lib API's list of conditions an
ability can grant) answers it when read, never when the module loads. The ids
are the system's: `concentrating-and-stationary`, and `vomiting` beside
`choking`; cover's two grades are `cover-waist-high` and `cover-chest-high`,
named as the book grades them. A row marked `state` is filed under States, with
the module's own name and icon: the states of a round, the two cover grades, and
the weather's `diseased` and `frostbitten`. `immune`, `resistant` and
`subjacent`, which the system does not ship, stay under Conditions with the
module's own. The two importer matchers that turn a printed word into an id
(`conditionKeysIn` and `matchCondition`) fold the id to its letters and never
read the localized name, since they run with no lang loaded; a row the module
keeps answers to its own `label` as well. `SYSTEM_KEPT_STATUS_IDS` mirrors the
system's private list of the five Foundry ids it keeps.

The arrangement is one world setting, `statusPalette`:
`{layout, off, custom}`. `layout` is the ids on the palette in order, `off`
the default statuses the Judge took off, `custom` the Judge's own
(`{id, name, img, effect?}`). It names ids only, so a status that becomes
known later takes its source's default and follows the arranged ones, and one
that stops being known drops out with no write. With no `layout` the palette
carries no places and the HUD lists it by name, as core does; once the Judge
orders it every status on it carries its place as `order`.
[status-palette.mjs](../../scripts/lib/status-palette.mjs) is that model,
Foundry-free; `applyStatusPalette` in `status-effects.mjs` writes it to
`CONFIG.statusEffects` at `init` and again on every client when the setting
changes, redrawing an open token HUD.

A status of the Judge's own is a name, an icon and an id (a letter, then
letters, digits and hyphens; not a name an array already answers to, since
core keys the list by id on an array). One made from a dropped Active Effect
also keeps that effect's `system` (its changes), `duration`, `description` and
`tint`, which core copies onto the effect a toggle creates. It has no row in
the catalogue, so the roll seams above read nothing from it: what it does is
what its changes do, applied by core.

**The editor** (`apps/status-palette-app.mjs`, GM only) opens from the
restricted settings menu **Token status palette** and from
`acksExtras.lib.statusPalette.open()`. The palette's tiles are dragged into
order, and onto or off the palette; the statuses off it are grouped by source,
each group with an *Add all*. A focused tile takes the same moves from the
keyboard. *New status* asks for a name, an icon and an id, and an Active
Effect dropped on the window becomes a status at the place it was dropped.
The draft lives on the window: nothing is written until *Save*, closing with
unsaved changes asks first, and *Reset to default* returns every source to
its default and the order to by-name while keeping the Judge's own statuses.

## Summons

A character's owner summons creatures from the monster library without
owning any of them (`summons.mjs` over `summons-logic.mjs`). The contract is
API.md, "`summons`".

**What a summon is.** An UNLINKED token whose actor carries the summoner's
uuid in `flags["acks-extras"].summonedBy`, written into that token's own
delta, beside a `summon` record `{sourceUuid, name, spellId?, spellName?, castId, at}`
(`spellName` is read by the GM's client from the summoner's spell item, never
from the payload, so a cast still reads by name after the spell is deleted).
The token's base actor is a world copy of the library creature that nobody
but the GM owns; the token is owned through `delta.ownership`, which grants
OWNER to every non-GM owner of the summoner and to nobody else. Each token is
therefore its own creature with its own hit points and flags, and leaves the
world with its token. The party cell counts `summonedBy` (character-sheet
MODEL, "The party cell"); the record is what groups a cast.

**A summoning is tied to its spell.** The request names a spell item of the
summoner, and the records it stamps keep that spell, so the cast menu can group
a character's summons by spell (`groupBySpell`: a cast whose spell still
resolves is under it; a record whose spell is gone, or that never named one, is
`loose` and still dismissable as a cast; a token with no record, bound by
hand, is `bound` and only Release acts on it). A request naming no spell is
refused `spellRequired` unless `bareSummonAllowed(user)` says so. That function
is the one switch: the relay's check, the seat's own pre-check and the bare
Summon… prompt all read it. It answers true for a user Foundry grants token
creation (`user.can("TOKEN_CREATE")`, which every GM holds by role and a Player
holds where the world's permission table or the user's own grant says so), so a
seat without the grant summons through a spell, and no server role is read
(DECISIONS, "A bare summon reads Foundry's token-create permission …").
Feature rules over what a spell may call (which creature it names, how many)
are policies a feature registers (`registerSummonPolicy`), run inside
`checkPlaceRequest` after the built-in checks on the seat and on the GM's
client; a policy that throws is logged and counts as an allow. lib imports no
feature.

**The requesting user must observe the creature.** A request names its creature
by a uuid or, where it names a spell, by an importer cookbook id.
`resolveSource` turns that into a document on the seat and on the GM's client
alike: the document the uuid names, else the library Actor carrying the cookbook
id (after the library is warm); the record and the one world copy are keyed by
the resolved uuid. `checkPlaceRequest` then asks `sourceReadable(source, user)`
of the requesting user, which on the GM's client is the sender the transport
attested: a GM always may, and anyone else needs Foundry's OBSERVER on the
document, read through its compendium where it has one. Nothing a request
carries changes the answer. A spell's row naming the creature grants no level,
so a spell item its owner edits cannot reach a creature that owner cannot open.
The check runs in the order badSource, unreadable, badSpell, spellRequired, then
policies: a ref no lookup answers is `badSource`, a document the user holds less
than OBSERVER on is `unreadable`, and a policy only ever sees a creature in
hand. Where several documents carry one cookbook id, `resolveSource` takes the
one the requesting user observes (`byCookbookId`'s `prefer`), so a world actor
a Judge dragged out of an open shelf, which keeps the id and is read first,
does not refuse a Player the shelf's own; with none observed the first is
answered and refused as itself. A seat that is no GM cannot tell a creature
that is gone from one on a shelf closed to it, so `summonVerdict` there reads a
spell's ref nothing answers as `unreadable`; the GM's client says which.
`pickSummon` still offers a row the seat cannot resolve whenever its ref
reads as an id (dotted, no space; `offerRows`), labelled by the row's `name` or
"Creature N", and `placeSummons` passes the ref on as `sourceUuid`; the seat's
own `summonVerdict` refuses it before anything is clicked or sent.

**What a seat reads for a creature it cannot open.** A surface that names a
summoned creature to a seat names it only where that seat could open the
creature, and otherwise reads the neutral label `ACKS-LIB.summons.neutral`
(`seatLabel`). The test is `creatureOpens(doc, user, {packOf})`, the same
answer `sourceReadable` gives at the cast: a GM always opens, any other user
needs Foundry's OBSERVER on the document, or on its compendium where it is a
pack document. A compendium index entry (`fromUuidSync` answers one, and it has
no permission test) is read through the pack its uuid names. A document the
seat could not resolve at all opens for a GM alone. The name is a label only:
it stays readable from the console and the document, and no permission is
added or removed by it.

**Naming a row's creature.** `summonRefName(ref, {fromUuidSync, byCookbookId})`
reads synchronously the name of the creature a ref names: the Actor its uuid
names, else the library Actor carrying it as a cookbook id, else null (a lookup
that throws, or a uuid naming something other than an Actor, is null). The
effect-row editor (`apps/effect-row-editor.mjs`) makes a `summon` row's `ref`
field a drop target: an Actor dropped there writes its uuid, and the field's
hint names the creature the ref reaches, or says none in this world does. A
companion row's `ref` is an importer id and takes no drop. The spell sheet
names the creature in its effect rows through the seat's reading below (magic
MODEL, "The sheet").

**A spell's creature list.** In a spell, a summon row's `ref` and `amount` give
way, in the editor, to a block of the creatures the spell may call
(`summon-list.mjs`; no schema holds a list and one row still holds one creature
and one number). The list is the summon rows that share the open row's
`invocationFrom`, `invocationTo`, `summonFormat` and `control` (blank and missing
compare equal), the open row among them, in store order. Each line shows the
creature's label, a small line saying where it is from (the compendium's label,
"World actor", or the unknown-reference words), a Number box and Remove; under
the lines are the drop hint, a uuid box and Add. A creature reads through
`creatureView`: its name where the seat can open it (`creatureOpens`, Foundry's
own Observer test, a Judge always), else the neutral label with no source line
and the note `ACKS-LIB.summons.refused.unreadable`, and never the name or the
ref, in the label, the aria labels or the tooltips. A Judge's ref nothing
resolves reads the row's imported `name`, else the ref. The block gates nothing
on `isJudge`: the spell's owner sets it up under Foundry's own permissions.

The list is edited as rows. A drop (an Actor, a family, or a token's base
actor, held to the cast window's source-type check, with no ownership refusal:
a creature the seat cannot open is listed under the neutral label and refused
at the cast) or a typed ref goes through `addSummonCreature`: a blank or
repeated ref (compared through `normalizeRef`) changes nothing, a row that
names no creature takes the ref, and otherwise a copy of the open row (no name,
no importer mark, no unread note, a hand key) is inserted after the list's last
row. `removeSummonCreature` splices a sibling out, and the only row keeps its
format, number and control and blanks its creature. Add and Remove change the
row list, so each closes every editor on the store, writes, and opens the row
again at its new index. The rungs drafted on the row and not yet saved go with
it: the closing window's `RungDrafts#carry` hands the changed drafts to the new
window's `adopt`, which takes one only where the row still stores the ladder it
was drafted from, and nothing is saved. A Remove of the open row itself opens
another row and carries none. A row an edit changes loses its `origin`, as any edit
of a row does. The Number box and the uuid box carry no `name`, so the form
never submits them (`_onChangeForm` skips them); a Number box writes its own
row's `amount` through `writeOnChange`, blank as null, and a press on Add or
Remove carries every typed figure in its one write, so the box's held write
finds it taken. The Number box's tooltip is worded for its row alone
(`amountTip`): written by the import, with the store's page reference after
it, or set by hand, and a blank figure carries the page reference alone.

**Placing.** The seat picks the creature and a count: `pickSummon` for a cast
from a spell (the spell's named creatures, preselected with their amount, else
the shelves), or the bare Summon… prompt, which offers the Actor shelves the
seat can open (the importer's, and the system's, by pack index; a pack the seat
cannot open offers nothing) and optionally a spell item of the summoner. It
clicks the places with core's `canvas.tokens.placeTokens(previews, {create:
false, preConfirm})`, which creates nothing and answers with the placed
preview documents. A preview is the creature's own look and nothing that acts
(`previewTokenData`), standing on the SUMMONER's actor: core refuses a preview
the seat does not own, and an unlinked token is owned through its actor, so the
summoner's own is the one actor the seat is certain to own. A caller's
`preConfirm` returning false refuses a click, which is where a summoning that
limits where its creature appears states the limit. The positions go to the
GM.

**The relay** (`summonRelay`, registered at `init` on the one transport,
`sockets.mjs`) answers two operations. It authorizes on the sender the
transport attested, runs `checkPlaceRequest` / `checkDismissRequest`, and
trusts the payload for nothing but ids and positions: the token data is rebuilt
from the world copy, the cast id is the sender's only if it is a short
alphanumeric string, and the time is the GM's clock.

- `place`: the sender owns a character-type summoner (a GM always does); the
  creature is a monster or animal the sender observes ("The requesting user
  must observe the creature", above); the count is a whole number within a fixed request bound
  (`MAX_SUMMONS`, a bound on a relayed call, not a rule); the positions match
  the count, are finite and inside the scene's rectangle; the scene is the
  sender's viewed scene, the active one, or one they have LIMITED access to;
  a named spell is a spell item on the summoner, and an unnamed one needs
  `bareSummonAllowed`; then every registered policy allows. Then the GM finds or makes
  the ONE world copy of that creature (found by `summonCopy.sourceUuid`; made
  once per source even when two requests race), in an Actor folder stamped
  `summonFolder` and named by a lang key, owned by nobody but the GM and shorn
  of the library's cookbook mark, and creates the tokens one after another,
  so each is numbered against the ones before it; the system's own token
  `_preCreate` rolls each unlinked monster token's hit points when its
  auto-roll setting is on.
- `dismiss`: the sender owns the summoner; each named summon is removed only
  if it names this summoner AND carries the module's record: a token by its
  actor's flags, a held summon (below) by its roster row. A creature bound by
  hand, or summoned by another character, is counted as refused and left, and
  so is one whose control ended and left it hostile (`lost: "hostile"`) where
  the sender is no GM: only a Judge dismisses it, and an owner whose request
  names nothing else is refused `controlLost`. A creature that stayed or went
  is dismissed as any other is.
  A held summon arrives as `{partyId, actorId}` and is judged on the row the
  `party-roster` service answers for it, never on what the request says of it.

**Dismissing** confirms on the requesting seat first (`DialogV2.confirm`,
proceeding only on `=== true`, since a closed dialog resolves null), then
relays. The world copy stays in the GM's folder.

**A summon in a party.** A summon can ride in its summoner's party token as a
member record, with no token on any scene. Lib knows it through the
`party-roster` contract alone (API.md) and imports no feature; every call on it
is optional, so with no provider, or a provider without the summon fields, a
summon is the scene token it always was and nothing here runs.

- *Reading.* `summonOfData` (`summons-logic.mjs`) reads the summoner and the
  record off plain token data, the form a stash holds, from the token's
  `delta`; it is the roster provider's reader for a member row. `heldSummonsOf`
  lists the summoner's summons whose member is stashed. A deployed member is a
  scene token, so `summonsOf` lists it and `heldSummonsOf` does not: no summon
  is counted twice. `castSummons` is one cast's tokens across the world's
  scenes beside its held summons.
- *Dismissing.* The relay sorts what it has authorized. A token the roster
  names a member (`memberOfToken`) and a held summon both go to `release`,
  one call for each party; every other token is deleted from its scene as
  before. `release` drops the member record before it deletes a deployed
  member's token, which is the whole defence against a recall restoring a
  dismissed creature from its pre-deploy stash: lib never deletes a member's
  token itself. With `release` absent a held summon is refused, and a token
  goes by its scene.
- *Ending control.* `applyControlEnd` stamps each creature of one cast `lost`
  with the outcome, a token through its actor and a stash through the
  roster's `amendSummons` (contract v5), and `controlEndPlan` names every step
  first. A stash is rewritten whole by `stashAfterControlEnd`, a pure copy: the
  stamp, and for a hostile end its owners at NONE and the hostile disposition,
  which is what the deployed token's write does. `amendSummons` writes only an
  undeployed, unlinked summon member, in one patch, on the GM's client, and
  changes no membership; with no such method on the provider a stash is left as
  it was and counted `unapplied`.
- *Setting control back by hand.* `UNDER_CONTROL` is a fifth value of
  `controlEndPlan` that no spell row carries (`CONTROL_ENDS` stays the row's
  vocabulary; `CONTROL_PICKS` lists the four a Judge may pick). Every token,
  deployed members included, and every stash takes a `control` step: `lost` is
  cleared and nothing is put on a roster or released. A creature whose record
  reads hostile is given back the owners `summonOwnership` grants the summoner's
  owners and the disposition its world copy's prototype token gives; a stash is
  asked its own record, in the same `amendSummons` patch (`stashAfterControlEnd`
  with `back`). `stays` from a hostile start gives the same back; a creature that
  was never hostile keeps what it has and only its stamp is written.
- *A temporary ally that turns hostile leaves its party.* `isTemporaryAlly`
  (`summons-logic.mjs`) is the one test of what the module can tell is
  temporary: a body carrying a cast's record, whatever summon format made it and
  wherever it stands. A person, a hired or charmed creature, a guest, a company
  and a creature bound by hand carry no such record and are not temporary. On a
  `hostile` end the plan gives such a creature a `leave` (a deployed member) or
  an `eject` step (a stashed one), and `applyControlEnd` calls the roster's
  `ejectSummons` (contract v6) in the same pass that stamps it lost, so every
  cause of a held end reaches it. A token stays where it stands, hostile. A
  stash is stood on the party's scene as a hostile token carrying its record,
  and only then dropped from the roster; where the roster has no scene to stand
  it on it stays a member, amended, and the control-end card names it (`kept`).
  `stays` and `gone` never eject. With no `ejectSummons` the creature stays a
  member as before. The Judge puts a creature back by dropping its token on the
  party sheet or Add to party on the token HUD, which needs its summoner in the
  party, and takes a member out with the Order tab's Remove.
- *Authority.* The seat and the GM's client each read the held summon's row
  from the roster; the GM's reading decides. Two casters of the same creature
  never reach each other's: a row names its summoner, and the check is the
  token check's.
- *Made straight into a party.* A caster the roster names a party they march
  inside (`joiningParty`, the contract's `summonerParty`) may have a cast's
  creatures made as that party's members at once (`joinSummons`, the `join`
  op). The GM's client authorizes it as a placement is, with no places and no
  scene to hold (a policy reads both as null), re-reads the party from the
  roster, and stashes each creature as the token it would have been, in the
  party token's own place and unlinked, carrying the summoner's stamps. It
  hands the stashes to `admitSummons`, which stores them as members. No token
  is made on any scene, no range applies, and `SUMMONS_PLACED_HOOK` does not
  fire, since a stash is no arrival to gather. A world that rolls its summoned
  monsters' hit points (the system's auto-roll setting) has each stash's roll
  made here, in the stash's own delta, since no token creation rolls it for a
  stash; the party's later deployment keeps those hit points
  (`KEEP_HIT_POINTS_OPTION`) and a recall stashes them again. A party that has
  gone, entered a fight or lost the caster by the time the request runs is
  refused `noParty`, and the cast reports the refusal as it does a placement's.

**Which packs a Player seat can open** is decided by pack ownership, not by
this module: a pack declares `ownership` by role, defaulting to OBSERVER for
a player, and the importer's Judge shelves are NONE for every player seat
(`JUDGE_SHELF_OWNERSHIP`). The picker lists `pack.visible` shelves only, and
says so when there is none. Ownership decides what a seat is shown, never
what it can read ("The imported library").

## The repair tool

One window for data this module left damaged: a link to a document that is
gone, a bundle no sheet lists, a write that stopped part-way. It is GM-only.
It opens from the restricted settings menu **Repair this world**, from the
*Repair This World (GM)* macro, and from
`acksExtras.lib.repair.open({only, scan})` (`apps/repair-app.mjs`). `only`
limits the window to the named checks; `scan` scans them as the window opens,
or at once when it is already open.

**A check is registered where its knowledge lives.** Each feature's
`repair-checks.mjs` registers its checks at `init` through
`registerRepairCheck` (`repair-logic.mjs`). A check has an id
`<feature>.<name>`, lang keys for its label and hint, a read-only `scan`, and an
optional `fix`. A check with no `fix` is report-only. A finding can also be
unfixable inside a fixable check (`fixable: false`), and either kind can carry a
`reason` naming where it is fixed instead. `danglingRefCheck` builds the common
case: a field naming a document that no longer resolves.

**The rescan decides.** Fixing takes the ticked keys from a fresh scan and
leaves alone any key that scan no longer reports. It hands the fix only the
fixable findings, then scans the check again. A finding the rescan no longer
reports is fixed. One it still reports has failed, whatever the fix said. The
failure is `still` after a fix that reported success, `refused` or `threw`
when the fix said so, and `unverified` when the rescan itself failed. This is
what catches a write that says it worked and did not apply.

**Nothing scans on its own.** There is no scan at `ready`; the window scans
when asked, and a launcher that passes `scan` is asking. Henchmen's own
reference sweep at ready (`autoRepairReferences`) is that feature's, and the
tool does not replace it.

**One report per fix.** After a fix the GMs get one whispered card
(`postToJudges`). It lists, per check, the counts and each subject, with the
reason for every failure. A subject is a link while it exists and its name once
it does not.

| Check | Finds | Fix |
|---|---|---|
| `lib.twoHandedRow` | A weapon, in the world or on a world actor, whose stored alternate damage differs from the one its imported row names ("A weapon's two-handed die follows its imported row") | Writes the row's die, or a blank where it names none. A weapon with no imported row is never listed. |
| `lib.missingImages` | A world document whose image is a local file the server answers 404 or 410 for: an actor's `img` and its prototype token's art, an actor's or world item's `img`, an embedded item's, an effect's on either, a macro's, a roll table's, and the texture of each token on a scene. Also listed: a scene's thumbnail, a level's background, foreground and fog image, a journal page's `src` and a roll-table result's `img`. See the paragraph below the table. | Writes the kind's `DEFAULT_ICON` (`CONFIG.<Document>.documentClass`) into each missing field, one update per document. Token art takes its actor's image instead when that file is present (an actor's own new default counts). A scene, level, journal page or table result has no default image, so its finding is report-only. |
| `lib.embeddedBundles` | A bundle embedded on a world actor or an unlinked token's actor, named as partial when an unpack stopped part-way | `unpackEmbeddedBundle` ("Goods handed to an actor, and bundles"). A bundle with an unresolved row is unfixable, and the finding names the rows. |
| `lib.attachments` | An actor attached to a carrier that is gone | Unsets the attachment |
| `lib.strandedCoin` | An actor that cannot load because its sub-type's package is absent or disabled, holding coin. Only a money row whose carried and banked figures come to more than nothing is coin | Report only. A disabled package is named so it can be enabled. |
| `henchmen.references` | An employer's hireling or monster list, or a hireling's employer, naming a deleted actor, or a hireling listed twice | `repairActor` (henchmen `repair.mjs`) |
| `location.links` | A place's map or region link naming a scene or region that is gone or names another place, and a scene or region naming a place that is gone | Clears the stale link. The place, scene and region stay. |
| `location.vaultSweep` | Coin in an actor's bank column, on a world actor or an unlinked token's own, or owed to a vault by a sweep that stopped part-way (the `acks` system only) | `runVaultSweep` for the chosen actors: a character's balance goes into their vault, and anyone else's joins the coin they carry |
| `location.orphanVaults` | A vault whose character is gone, and goods stored for an owner who is gone | Report only. The row points at the place's Storage tab, whose storage manager moves them. |
| `formation.members` | A marching-order member whose actor is gone | Drops the member, with the lights it bore and the spells it cast |
| `formation.shadows` | A true-position marker with no party, on a party no longer lost, or beside the one its episode keeps on its own scene; a marker only on another scene; a lost party with none | Deletes the first three. A marker from a closed episode also names the Lost section of the party's sheet, which can move the party onto it instead. The last two are report-only and point there. |

**A missing image is found by asking the server, once per file.** The
`lib.missingImages` scan collects the distinct local paths over the documents
above (`missing-images.mjs`), sends each one `HEAD` request (eight at a time,
ten seconds each), and reports a document only for a 404 or 410. Any other
answer, a timeout or a network failure leaves the path unknown and unreported.
A directory listing through the file picker would be one request per folder,
but it needs file-browsing permission and lists one source at a time, where
`HEAD` reaches the world, module and system trees alike. Empty paths, `data:`
and `blob:` images, remote addresses (no CORS grant to ask with) and wildcard
token art, and a `#` virtual texture name, are skipped. Unlinked tokens'
synthetic actors are not walked. A scene's images are its levels', not the
scene's own legacy `background` and `foreground`, which core derives from the
first level. A kind with no `DEFAULT_ICON` on its live document class is
listed and never written; its finding says to choose another file by hand.
Every scan and every fix's rescan probes again,
since a file uploaded between two scans must be seen.

## The hit-point tool

One window for changing the hit points of several creatures at once. It is GM
only (`apps/hp-app.mjs`). It opens:

- on the selected tokens, from the **Adjust hit points** button on the Tokens
  layer and from the *Adjust Hit Points (GM)* macro;
- on a party's members, from the **Hit points** figure on the party sheet's
  rails;
- on whatever `acksExtras.lib.hp.open(from)` names (docs/lib/API.md).

There is one window per world, and opening it again replaces its rows.

**Who a row is** (`resolveTargets`, `hp.mjs`). A linked token is its world
actor, so two tokens of one character make one row. An unlinked token is its
own row, under the token's name. A party token stands for its members, through
the `party-roster` contract that formation provides. A linked member is their
world actor, and an unlinked member on the map is their token's actor. An
unlinked member inside the party token has no document to update. Their hit
points live in the token data the party keeps for them, and formation writes
them there. A stack becomes its bodies on the map, found by their group flag
(`deployedTree`, `group-logic.mjs`: the group's own and those of every group inside it), each its own row. **Add selected
tokens** adds the selection to the rows already listed.

A row that cannot be adjusted is still listed, unticked, with its reason
(`hpEligibility`, `hp-logic.mjs`):

- a stack with no body on the map, whose hit points belong to one
  representative body and not to the stack;
- a template, which is a generator;
- a vehicle, whose hit points are its own field;
- an actor with no hit points.

**One change, per-row factors.** The change is damage, healing, or a value
set outright. Its amount is a whole number or a formula, and a formula is
rolled once for everyone or once for each row. Each row has a multiplier (×0,
×½, ×1, ×2), and an amount of its own may replace the shared one. A row's own
amount is a whole number. **Stop at 0** holds damage at 0 and never raises a
value that is already below it. The **After** column previews each row with
`planHpChange` whenever the amount is a whole number.

**A spell's amount rounds differently.** `planHpChange` rounds up, as core does,
and stays the preview of what core writes. The amount a cast or a weapon hit
applies is `amountAfter(rolled, {fraction, stages})`: the save's fraction, then
each stage in order (the defenses stage, `defenses.mjs` `defenseStage`), then
one rounding of the half to the even whole (`roundHalfEven`), with no floor,
and the steps it took returned for the card to show. A stage with `judge` set
ends it with `applied: null` and no rounding ("Damage against defenses").
This tool still rounds up, so two rounding rules remain; the tool is the Judge's
manual route.

**Core does the arithmetic.** Damage and healing are written by core's
`applyDamage`, so the stored value is exactly what core stores. Core rounds
the multiplied amount up and holds the result between its floor and the
maximum. `planHpChange` computes the same figure for the preview. A value set
outright, and damage that Stop at 0 changes, are written as an update of
`system.hp.value`. Either way the write is an ordinary actor update, and
everything that reacts to one reacts here. Each row is read again just before
its write and planned from that value. A row that fails is reported, and the
rest still land.

**The report.** Every change posts one card (the multi-roller card). It has a
row per target, with its hit points before and after, the amount and the
multiplier, and **Down** or **Back above 0** when the change crossed 0. When
every row came from one party, the party's name is its subtitle. By
default it is whispered to the GMs, with the dice shown only to them
(`postToJudges`). **Show the report to players** posts it openly.

**Undo, while the window is open.** **Undo last** sets every row the last
change wrote back to its value from before, and posts a "restored" card to the
same audience. The window holds only the last change, and closing the window
forgets it. A character that the change took to 0 or below gets a **Mortal
Wounds** button, which opens the system's own window (`openCoreWindow`).

**An unlinked token's own hit points** are read in one place,
`tokenHitPoints` / `tokenHasStatus` (`hp-logic.mjs`). A live token answers
through its synthetic actor. For token data kept off the canvas, the delta's
figures and effects win over the base actor's. Formation's reads of an
unlinked member go through them (docs/formation/MODEL.md).

**A token core creates again under its own id keeps its own hit points.**
The system's `TokenDocument#_preCreate` rolls new hit points into the delta
of every unlinked monster token it creates while its `autoRollMonsterHP`
setting is on. Core creates with `keepId` only a token that already existed:
a move to another scene ("A token moved to another scene"), a cut and paste
between scenes, and an undone deletion. Each create's data is the original's
`toObject()`, delta included, and `_preCreate` writes to the pending document,
never to that data. So `installRecreatedHitPoints` (`hp.mjs`) answers
`preCreateToken`, which core runs after `_preCreate` on the client that asked
for the create (for a teleport, the GM who ran the batch). Where the pending
delta's hit points no longer match the data's, it writes the data's back
(`recreatedHitPointsPatch`); a token whose delta held none shows its actor's
again. A placement and a pasted copy carry no `keepId`, and their roll stands.

**A deployed body keeps its record's hit points.** A caller making a new
token for a creature it already holds creates it with
`KEEP_HIT_POINTS_OPTION` (`constants.mjs`), and the same hook keeps that
token's hit points as it keeps a `keepId` create's: `keepsOwnHitPoints`
(`hp-logic.mjs`) reads either. The group's `deploy` passes it, with each
token's delta copied from its body's record, so a body arrives with the hit
points `materializeMembers` rolled for it, or with those its recall folded
back into the record (GROUPS.md, "The representative individual"). The
formation passes it for a member's token placed from its roster, which
arrives with its stash's hit points (docs/formation/MODEL.md, "Data flow").

## The turn-activity registry

`scripts/lib/turn-activities.mjs` is where features declare what a party member
can spend a stationary turn on (JJ ch. 2, Sequence of Play). It is Foundry-free
and has no document, setting or hook; it is a registry and arithmetic over a
plain object, built on the claimant pattern of `patches/spell-use.mjs`. The
plan's storage, the party sheet column and the live resolution belong to the
formation, not to this file.

**A registration** is `{key, pace, options, turns, blocked, resolve,
oncePerTurn}`. `pace` is `"hasty"` or `"methodical"` (JJ ch. 2) and is
carried, never interpreted. `options(actor, ctx)` answers the member's choices as plain
objects with an `id` (omitted for an activity's single choice) and whatever else
the registrant wants; the registry passes an option through untouched, so a
flag such as `confirm: "judge"` reaches the card that asks the Judge. `blocked`
answers null, a reason id, or `{reason, missing}` with `missing` naming what the
member lacks. `ctx` is the registrant's own bag; the registry passes it on and
reads nothing in it. A key registered again replaces in place, and the function
`registerTurnActivity` returns unregisters only its own declaration.

**The plan** is `{[actorId]: {key, option, remaining, turns, by, advancedTurn?,
resolvedTurn?}}`, one entry per member. A member with no entry keeps watch;
that is the default and it is no entry. Every helper returns a new plan, and
the owner writes it in one update.

**A length past one turn is a value.** `turns` answers the imported figure, or
null for "not imported", and the registry supplies none. Only a positive whole
number is a length; anything else reads as null, and rounding a printed length
to whole turns is the registrant's, who has read the page. An option whose
length is null is listed with `turns: null` and cannot be locked: the refusal is
`notImported` with `missing: ["turns"]`.

**`lockActivity`** refuses, in order: `unknownActivity`, `unknownOption`,
a block (the registrant's reason and `missing` verbatim), `alreadyUsed`,
`notImported`. It replaces whatever the member had chosen, a multi-turn entry's
progress included. A registrant that throws is contained and refuses as
`faulted`, so a broken gate never opens. `TURN_REASONS` names the ids this
module produces; a registrant's reasons are its own.

**Once per turn is the owner's ledger.** A member's plan holds one entry, so the
plan alone cannot exceed one use of an activity per turn; what can is a use
outside the plan (a roll made from a sheet) or a resolution already stamped in
the turn. Which turn a use belongs to depends on when the owner reads its clock
against the advance, so `lockActivity` takes a `usedThisTurn(actorId, key)`
predicate, asks it only of an `oncePerTurn` activity, and refuses
`alreadyUsed` when it answers true.

**`turn`** in `advanceTurn` is any finite number the owner reads once per turn:
different from one turn to the next, the same on a repeat call for one turn.
The helper stamps it and compares it for equality; a non-finite value throws,
since an omitted one would match every fresh entry and freeze the plan.

**`advanceTurn(plan, turn)` stamps before anything resolves.** Each entry
loses a turn; one that reaches zero is due and comes back already stamped
`resolvedTurn = turn` in the returned plan. The owner writes that plan, then
calls `resolveDue(due, …)`, so a resolution that fails part-way is never rolled
twice: a stamped entry is done, and an owner that stops mid-list leaves the
entries it had not reached stamped and never run. Calling again with the same
`turn` changes nothing (a counted entry carries `advancedTurn`), and an entry
stamped in any other turn is finished and leaves the plan. `resolveDue` runs the
due entries one at a time, looking the option up again as it goes: an entry
whose activity, option or member is gone is `dropped` with a reason, a `resolve`
that throws is `failed` and the rest still run.

**`cancelForCombat(plan)`** cancels every unresolved entry locked for one turn
and keeps a multi-turn entry with its progress, judged by the length the entry
was locked at, so a three-turn entry on its last turn is kept. It returns the
plan, what it `cancelled` and what it `kept`, for the one group note card.

**`partyRest(plan, actorIds, {endures, restKey})`** decides whether the turn is
a rest (RR ch. 6, Rest and Recuperation). A member owes rest unless the passed
`endures(actorId)` says they have the endurance capability; the registry looks
nothing up. The turn is a party rest when every member who owes rest chose Rest
and at least one member chose it, so a party that owes none is not rested by
nobody choosing. Rest is an ordinary registered activity under `REST_KEY`.

## The inventory bucket

One list serves every window that holds goods or victims: a ritual's or a
research project's components, a sacrifice's victims, an implement set held for
a cast. `bucket.mjs` is its model, `bucket-value.mjs` its valuation,
`bucket-apply.mjs` its writes, `templates/lib/bucket.hbs` and
`bucket-row.hbs` its face, `styles/lib-bucket.css` its rules. It never imports
a feature. What a window accepts, values, owes and does with its rows is the
policy that window passes in, so the bucket states no rule and no figure
(`.claude/rules/ip-doctrine.md`).

- **A drop becomes an entry** through an injected `resolve`. An Item is valued by
  its own cost times the stack; an Actor or Token only by the policy's `value`,
  since a creature's worth needs the imported multiplier and the callers'
  predicates. The row's picture is the document's own `img`, then Foundry's
  default icon, and a power row (no document) draws a glyph. Nothing is
  generated.
- **A figure not read is null.** `totalOf` counts the rows with no figure
  (`blank`) and `coverage` answers `unknown` rather than covered or short, so a
  window never claims a coverage it cannot compute. The row shows a blank figure
  and the page reference alone in its tooltip.
- **The fit opens on a name match.** `preselectFit` folds the row's name and its
  `effects` with `foldName` against each option's `names`, else the policy's
  fallback, and the seat cycles it with the chip (`nextFit`).
- **A valued creature.** The sum of its component items is never barred; its XP
  award stands in only where no component is priced, and only for a creature no
  predicate bars (ordinary animal, summoned, young).
- **Settlement is data.** `settlementPlan` reads `settle[outcome]` per kind. A
  creature is marked, never consumed: the plan turns consume or destroy into
  `mark`, and `applySettlement` gives it core's dead status through its actor
  (an unlinked token's synthetic one), never a delete. A stack larger than the
  quantity spent is divided first and the new row deleted. A power row and a
  marked item are returned for their owners (magic's ledger; an implement a
  botch damages).
- **Pick-one.** A `pick: "one"` policy renders radios: the caller supplies each
  row's caption, diamonds and dimming; the picked row carries Used; a dimmed
  row dims its picture, name, caption and controls and leaves its reason at
  full strength.

## The aura reach and the item carrier

A reach is a core Region attached to its bearer's token that carries one `acks-extras.aura` behavior (`aura-reach.mjs`; "ACKS Item Reach" in core's Create Behavior list). Its config holds only `{sourceUuid, bearerUuid, activationId, rowKey}`; the radius, filter and pulse are the source row's `reach` read live (`effectField.reach`: a `figureRefField` radius, `{kinds, exceptKinds, side, unit}` and a `REACH_PULSES` key; null on every row that has none; an ability's and a carried item's row editor edits part of it, below). A behavior made by hand holds an empty config and does nothing.

- **The editor's reach group** (`apps/effect-row-editor.mjs`, `reach-edit.mjs`). The row editor of an ability and of a carried item (never a spell's) ends every row with a group, drawn from board 4d of canvas 4. It edits seven things. *How it is used* is the ITEM's `itemRun.activation.kind`, written through the store's `carrier` (`itemCarrier` in `gear-effect-rows.mjs`; both stores hand one over) at that path alone, so a fuse's figures are kept: Raised and lowered is `toggle`, Used up stands for `once`, `fuse` and `consume` (it keeps a kind already stored and otherwise writes `once`), and Always on removes the activation. A move into or out of `once` also removes `activation.uses` in the same write, so a toggle or a fresh once item never inherits another kind's (a consume item's swig reference stays through every other change, and a fuse's figures are never touched). *Each use spends one* is a tick box drawn only while the stored kind reads `once`: it stores `activation.uses` as an empty object where ticked and removes it where not, through the carrier's `setUses`, and reads as ticked where `uses` is any stored object (a figure reference an importer or a walk wrote shows ticked too). `itemRunUsedUp` and `runOnce` test `uses` for truth only, so the empty object is the whole of the mark and names no figure; nothing resolves it, and the count a use spends is the item's own Quantity, which the tooltip says. The box is gated on the stored kind, re-read at the write, since a consume item's `uses` is its swig dice reference and is not the box's to write. Both the box and the use select have no `name` (the window writes each on change, and the row is not written), and the select is disabled, with a tooltip saying to lower the item first, while the item is raised (`itemRun.activation.state.active`), since changing the use of a raised item would strand its Region. *A distance or Engaged* writes `reach.engaged`, and Engaged writes the `turnStart+enter` pulse with it; no control draws the pulse, switching back removes that pulse (the runtime engages on it; any other stored pulse stays), and a reach a hand makes with no pulse is left with none (`readReach` reads it as acting on nothing). *Who counts* writes `filter.side` (the bearer's foes `opposing`, its side `own`, everyone `any`). *Kinds counted* and *left out* are checkbox picks among the closed keys (`actor-read.mjs` `kindKeys`: the race categories and sets, and the monsters feature's creature types where the client has them), and a stored word outside them stays offered and ticked. *Players see the ring* writes `showReach`. The radius ("Reaches", with the page beside it and its provenance tooltip, or the page alone where the figure is blank) and an imported `filter.unit` are read-only. The window submits the whole group on every change of any field, so an edit is a diff: only a control that differs from what the stored reach shows writes, member by member, a reach no control moved comes back as the very object stored, and a row with none stays without one. The group is disabled for a seat whose store's `editable()` is false (Foundry's ownership; no role is read), so it submits nothing, and the use select writes only for such a seat. The group never writes `radius`, `save`, `immunity`, `lasts`, `modifier`, `on`, `saveWhen`, `filter.unit` or `filter.self`.

- **Membership is core's.** `createTokenEmanation` builds a grid-based emanation of the token's footprint, hidden as the token is and visible to GMs; core moves it with the token and deletes it with the token. Raising refuses with a line where the build lacks `attachment.token`, the emanation shape or `createTokenEmanation` (`auraSupport`), where the token does not carry the item, where the radius is blank, or (for a Player) where the bearer is down.
- **A reach's own fields.** `reach.on` is the `REACH_ON` list (the `ROLL_MODS_ON` keys and `morale`); `readReach` drops any other word. `showReach` (a boolean, imported false) draws the raised Region for everyone where true and for the Judge alone otherwise. `saveWhen` (`{when, magical}`) narrows the `save` part `reachParts` writes, and that part alone: `roll-mods.mjs` `narrow()` tests `when` against the `circumstances` a caller names and `magical` against the throw, so the part is told on every save and added only where a caller names the circumstance. A prompt's dedupe key is `momentKey`. `lasts` is a figure reference like the others: how many turns a failed save's condition holds. `namesFigure(ref)` tells a row that names one (its own `value`, or a whole table address) from a cleaned reference left empty, and `reachFigures` answers `lasts` (the resolved number, else null) with `lastsNamed`, so a row that names the figure and resolves none is a blank and never the other kind of row. `engaged` (a boolean) marks a reach whose subjects are the bearer's engaged opponents.
- **Engagement.** `distance-units.mjs` `engagementFeet()` answers the adjacent square, `SQUARE_FEET` (RR p. 288, 291, 509), stated in source (`docs/lib/DECISIONS.md`, "Engagement is the battle map's adjacent square"). `engagementHolds(bearer, subject, {conditionsOf})` is false where either side is hidden or the bearer is helpless, and true otherwise; facing, wards, flight and the optional size table are the Judge's and are not read. `reachContext` applies it for a `turnStart+enter` reach only, and a false there beats whatever `reachAdmits` answered, a null included.
- **The `turnStart+enter` pulse** hears `enter` and `turnStart`. `pulseAct` prompts at a turn start, and on an `enter` only where `onTurn` holds (`handleReachMoment` reads it: the combat has started and the subject's token is the current combatant's), so a body that walks into reach on another's turn waits for its own turn start; every other pulse ignores `onTurn`. At a turn start `onTurnBegan` settles this pulse's reaches of one item kind once for the subject, not one after another: each bearer's context is built (`reachContext`), `groupVerdict` folds their answers (true where any admits, else null where any is unsettled, else false; an empty list is false), the handler is handed the first admitting context (else the first unsettled, else the first), and the one dispatch carries `engagedBy`, the token uuids of the bearers that admit. The other pulses keep the serial loop: reaches of one kind are offered in the order met until one settles the subject.
- **A moment** (a region event, or lib's turn start through `behaviorsUnder`) reaches `dispatchReachMoment` on the primary GM only. `reachAdmits` answers true, false or null for the subject; the registered handler (`handleReachMoment`) reads the subject's immunity and `pulseAct` decides `prompt`, `skip`, `on`, `off`, `undetermined` or `none`. `registerUnitAncestry` lets the monsters feature answer `under`; without it `under` holds for the bearer's own unit and is null otherwise.
- **The teardown is the Region's deletion** (`deleteRegion`): the records carrying its activation id go and the item's toggle state clears. A bearer at zero hit points or on the defeated status has its reaches deleted and `BEARER_DOWN_HOOK` fired (`lowerForBearer`).
- **An always-on reach's Region** (`ensureEngagedReaches` in `aura-reach.mjs`). A started combat's combatant whose token's actor holds an item with no `itemRun.activation` (`alwaysOn`) and an `engaged` reach row has one Region attached to its token, made on the primary GM's window through the same writer a raise uses (`createReachRegion`), at `engagementFeet()` through `feetToUnits` on the scene's units, everyone's where the row's `showReach` is ticked and the GM's otherwise. Its config carries all four fields, and its `activationId` is `engagedActivationId(randomID())`, made once with the Region: the Region's own id, never an item's toggle state, which such an item has none of. It is made at `createCombatant` (that combatant alone), at an `updateCombat` that carries a round, and for a bearer revealed (`updateToken` `hidden: false`) or revived. The making is idempotent, keyed on token, item and row and never on the activation id, and a key being made is claimed before the first await so a second call for the same body passes it by. A bearer that is downed or hidden is skipped, silently, and a combat not begun, or one with no such row, makes none and says nothing. Told to the Judges once per combat as one whispered line (`postToJudges`): a scene whose grid square is not the engagement square, and the first refusal (a combatant with no token, a build without `createTokenEmanation`, Foundry refusing the Region). The Region goes with `deleteCombatant` and `deleteCombat` unless the token is a combatant of another started combat, with the token (a Region core already deleted with it is passed over), and when the bearer goes down (`lowerForBearer`, which lowers every reach); `updateActor` on hit points, an effect carrying the defeated status being disabled or deleted, and the reveal make it again. Only Regions whose activation id is an engaged one are selected, so a raised toggle's reach on the same token is never lowered by any of these paths. The records an engaged reach's prompts write outlive the Region: they carry a card id, and `liftActivation` does not scan the world for an always-on source (one that resolves and has no activation), while a deleted toggle item, which does not resolve, still has its records lifted.
- **`reachSnapshot(scene, centre, rangeFeet)`** answers `{ok, tokens}` from an unsaved Region (an emanation of a token, or a circle at a point), radius in pixels; the centre token and marker tokens are left out.
- **`Item#use`** has one wrapper (`patches/item-use.mjs`), a claimant registry shaped like the cast seam's. The carrier's claimant takes an item whose `flags["acks-extras"].itemRun.activation` kind has a registered runner and declines spells, abilities with no activation and unflagged items. `once` returns who the action row's reach meets as a prompt card model (`promptCardModel`, data over `renderRollCard`); `toggle` raises or lowers the reach and keeps `state` on the item. Nothing here posts a card: the registered presenter does (`setUsePresenter`).
- **The bearer's token.** A use names the token its pressing seat resolved (`tokenUuid`), because the primary GM's window may view another scene than the bearer's and `getActiveTokens` sees only the viewed one. The GM checks the token is the item's actor's (`carriesItem`); with none named it takes the viewed scene's token, then the actor's one linked token on any scene, and refuses a bearer with two (`manyTokens`).
- **Records, press and Undo.** Every record is an Active Effect with `flags["acks-extras"].itemRun = {source, activationId, rowKey}` and `managed: true`, and carries the item's page reference (`cookbook.cite`) as the record's `cite`. A record that ends on the world clock adds `dueAt`, and `liftDueRecords` (on `onWorldTimeAdvanced`) deletes it once the clock reaches it; no core `duration` is written. The immunity window is one: it carries a card id of its own, never the raised activation's, so lowering the item takes its conditions and leaves the window. A press rolls the subject's save on the presser's seat and relays the total; the GM checks the figure against the item's own row, resolved live (`checkPressRequest`), before writing a condition on a failed save. Undo removes exactly the ids a card row stored and nothing else.
- **A row that names `reach.lasts`** writes its records under fixed `_id`s, created with `{keepId: true}`, and every one carries the `cardId` of the card that holds the entry and the `entryKey` that wrote it beside the usual `itemRun` flag; the card's id, never the raised activation's, is its `activationId`, so lowering the reach leaves them. A failed save writes one condition per status the row names, each under `lastsRecordId(kindKey, status, index)` (the first takes the kind's own id, the rest one each suffixed with the status, so two conditions never share an id), ending at `dueAt = now + lasts × turnSeconds()` on the world clock, with no `turnLife` and no `turnMark`. A passed save writes the immunity window under `immuneRecordId(kindKey)` for the row's `immunity` turns, and nothing where the row holds no immunity figure. A record of the same id already on the subject is deleted first with `managedDelete()`, so a later entry replaces an earlier one of the kind. A blank `lasts` (named, no figure resolved) refuses a press from any seat but the Judge's own with `noFigure`, in `checkPressRequest` (`world.blankLasts`) and on the presser's seat in `pressRoll`; the Judge's own press writes the condition under its fixed id with no `dueAt`. A row whose `lasts` is a cleaned empty reference is not a lasts row and writes as every row did: no `_id`, no options, the fight's clock or turn mark. Undo of such an entry passes its stored ids through `undoGuard(ids, byId, entryKey)`, which drops a record carrying another entry's `entryKey` (a later entry replaced it) and keeps a record with none; `undoEntry` applies it where the press names the entry's key.
- **The fuse item** (`activation.kind` `fuse`, `runFuse`; the ruling is `docs/lib/DECISIONS.md`, 2026-11-25, "A fuse item is lit, not thrown"). The activation holds figure references to the light's `throw`, `fumble`, `fuseDice` and `proficiency`, to `sizes` (a bomb size per breed key) and to `blast` (rows by size), and `variant`, the bearer's breed key; one `burst` row's reach names the save and the `fraction` a passed save takes off. Nothing is stated in source: a blank figure is the Judge's, and a light with a blank `fumble` or `fuseDice` rolls nothing or writes nothing and says which figure. A light of an item whose every unit already burns (`secondLight`: no more held than lit, an item with no count holding one) is refused `noSpare` at the runner for a Player's seat, before any die, whatever door it came through (a row, the HUD, a hotbar macro, `Item#use`); the Judge's own seat is warned and lights another. A Player's relayed use that the GM's window refused is told on the Player's own window too (`useItem`).
  - **The light.** A use rolls a shown d20 for the bearer. The target is the item's `throw` less the bearer's standing proficiency modifiers (`setProficiencyReader`, registered by the monsters feature, so lib imports no feature; with none registered the roll says the proficiency was not read), and `fuseLight` reads the unmodified die: at or below `fumble` is a fumble, an automatic failure is unlit, an automatic success is lit for a bearer who holds the proficiency, and any other result is the total against the target. **Unlit** writes nothing. **Fumble** bursts at once at the bearer's token centre (`spotAt`, `tokenCentre`), no fuse record. **Lit** rolls `fuseDice` once for the count and writes one Active Effect on the bearer's actor carrying the fuse flag, its spot the bearer's token centre: on the bearer's clock (`fuseFlag`: the fight, the bearer's combatant, edge `end`, `count`, `seen`) where a started combat holds the bearer's token, else on the world clock (`fuseWorldFlag`: `dueAt` the count of `roundSeconds()` rounds from now). Nothing prints a range, a miss or a scatter, so none is read.
  - **Stepping.** `liftFuses` runs on both turn hooks on the primary GM's window: a turn of the bearer that begins adds one to `seen` (a turn already running at the light never began after it, so it is not counted), and the end of the bearer's turn with `seen` at `count` deletes the record first and then runs the registered burst (`setFuseBurst`). A downed bearer does not stop a fuse. A fight's end moves its fuses to the world clock for the rounds they have left (`convertFuses`), `liftWorldFuses` bursts a world-clock fuse when `onWorldTimeAdvanced` reaches its `dueAt`. With no burst registered, no fuse is stepped. `litStateOf(effects, itemUuid)` reads whether an item is lit and for how long (`{roundsLeft, combat, dueAt}`) for a sheet row.
  - **The controls.** `moveFuseSpot` rewrites the spot (all five keys, no range check) and `setFuseOffNow` bursts it at once; both are for a seat that owns the bearer's actor, by Foundry's ownership on the relayed sender (a Judge owns every document), re-checked on the GM's window. Move the spot takes its point from `point-pick.mjs` `pickPoint`: one click on the board of the scene the fuse is on.
  - **The burst.** `burstFuse` joins the variant to its size and the size to its `blast` row (`blastOf`), takes the tokens the circle holds at the spot (`reachSnapshot`, the bearer's own token among them), rolls the dice once, uses up one of the item (`consumeOne`: a stack loses one, the last deletes the item) and hands the result to the presenter. A passed save takes the imported `fraction` off (`burstAmount`); a passed save with no figure is the Judge's. The bodies that take hit points are subjects; a vessel's token is a `vehicles` row, handed on and never rolled for. A bearer with no token on any scene, or a spot whose scene is gone, bursts nothing and whispers the Judges (`noBearer`, `noScene`). A deleted bearer's token drops its fuse the same way (`dropDeletedBearerFuses` on `deleteToken`): the record goes, nothing bursts, the Judges are told.
  - **A press's writer.** `registerPressOutcome("burst", fn)` is the one place a card kind's outcome is written: the common press keeps its lock, verdict and relay, and the writer answers what the entry holds. The burst's Save press writes nothing (the entry waits as `rolled`); `applyEntry` writes the damage through `adjustHp` after the body's defense stage against the card's damage types (`defenseStage`) and stores `hp: [{uuid, amount}]`, the points actually taken, which `undoPlan`'s `hp` gives back. `applyAllEntries` applies every `rolled` row, each re-checked as the relayed seat, so a row the seat does not own is refused alone.
  - **Structures.** `handOn` lowers a vessel's structural hit points through the one registration `registerStructureDamage`, which the vehicles feature fills (`docs/vehicles/MODEL.md`), by Foundry's ownership of the vessel and once per row (`handed`). With nothing registered it is refused `noStructure`. A building has no document, so the Judges' line on the card carries the rolled total and the page.
- **The consume item** (`activation.kind` `consume`, `runConsume`; the count ruling is `docs/lib/DECISIONS.md`, 2026-11-25, "A consume item's count is rolled when it is handed on with none"). The activation holds `uses` (a figure reference to the swig dice), `left` (an integer, or null: uncounted, a Swig never spends), `leftFrom` (where `left` came from: `{by: "roll", formula, total}`, `{by: "hand"}`, or null) and `bearerUuid`; the drink figures are the item's `flags["acks-extras"].drink` (`FLAG_DRINK`). The drinker is the item's own actor, through its token as every kind.
  - **A swig.** A counted item with no swigs left is refused (`spent`); otherwise one is spent before the outcome. `drinkerKindOf(creatureKinds(actor), drink.ownKind)` (`swig-logic.mjs`) picks the path: the item's own kind heals by `healDice` (a shown roll, through `adjustHp`); a human or demi-human gets a `swig` save card with the drinker as its one subject; any other kind gets a `swigUnknown` card whose Heal and Ask the save (`swigHeal`, `swigAskSave`, relayed, by Foundry's ownership of the drinker) settle it, Ask the save turning the card into the `swig` card in place. A blank figure rolls and writes nothing, and the card says the Judge decides.
  - **The swig card's writer.** `registerPressOutcome("swig", …)`: a passed save heals by `successHealDice` and stores the hit points as a negative `hp`, which an Undo takes back as damage; a failed one writes the condition (`swigOutcome`) to the end of the drinker's next turn in a fight (`lifeOf(token, "end")`), or the mark outside one. A writer's `judge` answer at the Save writes nothing and leaves the entry the Judge's.
  - **The count.** On the primary GM's window, `createActor` stamps each consume item's `bearerUuid` with the new actor and rolls nothing; `createItem` on an actor stamps it, and where the item comes from another actor with `left` still null (`swigStampPlan`) rolls `uses` into `left`, with `leftFrom` naming the formula and total, in the same update. A blank or invalid figure leaves `left` null. The sheet row's "Swigs left" box is the manual way in (above, "The sheet rows' presses").
- **An outcome card from any seat.** `postOutcomeCard({kind, itemUuid, title, subtitle, subjects, saveName, saveMod, facts, speakerActorUuid})` builds a prompt card the way a burst's is and hands it to the presenter; a Player's seat relays it and the GM's window posts it only where the sender owns `speakerActorUuid`. A post's facts never set the keys a card holds for itself, and only a kind with a registered writer, or `swigUnknown`, is posted (never `burst`). A card's `saveMod` rides on the save as a situational modifier, read by the throw and the verdict through `cardSaveOptions`. Equipment's on-hit card is posted this way (`docs/equipment/MODEL.md`).

### The item runner's cards

`item-run-presenter.mjs` draws what the carrier ran; the carrier (`item-run.mjs`) posts nothing. One chat message per raise holds the card's state under `flags["acks-extras"].itemRunCard` (`item-run-card-logic.mjs` `newCard`): the subjects it lists (`in`, `out` or `notTarget`, each with its newest entry) and ONE entry store keyed by moment (`momentKey`, dots made safe so a dotted update reaches one entry). A press on the raised card or on the whispered one names the raised card's message and the entry key and writes that one entry. Writes go through the carrier's per-message chain as dotted patches on the primary GM's window; every other seat asks through a relay that re-checks Foundry's ownership on the server-attested sender.

- **Listing and asking.** A `turnStart+moveIn` reach lists a body that enters (a waiting row, no prompt), mutes one that leaves, and prompts only on `moveIn` and `turnStart`, once per subject, item kind and initiative (`momentKey` held on the primary GM until the prompt is answered or struck, pruned at each turn start). A prompt opens an entry, strikes the subject's older open entry, and whispers the save card to the owners of the subject's token (`testUserPermission`, GMs included). Moments that arrive before the card exists (core reports every token inside as the Region is made) wait and replay.
- **Rows.** Waiting, then open, then applied or undone, and `out` from any state; a body the filter refuses reads "Not a target". Outside a fight a failure carries a turn mark that lib's turn start lifts at the subject's first initiative in a fight. At a reach's teardown a condition is handed to another raised reach of the same item kind that still holds its subject, else deleted.
- **Per seat.** A seat sees the rows of the tokens it owns (a Judge owns them all). Save: the body's owners. Early Save on a waiting row: the Judge's own seat only (`judgeDeclares`); it goes through and a warning line is whispered to the Judges. Every press is written on the primary GM's window (`pressOnPrimary`), where the press listener marks a whisper answered and tells the Judges of an early press: a second GM's press is relayed there, with its user kept as the entry's `presser`. On an outcome card or a burst table that names no save, the Judge's own seat is drawn Passed and Failed on each open row it owns, with a tooltip saying the call stands for the throw: `pressRoll` with `declared` sends no throw, `checkPressRequest` takes the declared verdict only where `judgeDeclares` holds (else `judgeOnly`) and `pressHere` only on such a card (else `figure`), the writer is asked with that verdict, and the entry holds `declared: true` and no total or target, its result reading "(the Judge's call)". Undo takes it back as any entry. Lower and Check range again: the bearer's owners. Undo: the seat that applied the entry and the owners of the body (no role read). The bearer's own row sits in a section of its own, undetermined and not counted; an owner of the ITEM counts it in (`filter.self` is `count`), and it is then read at its own turn start under a prompting reach and held under a standing one (the bearer's tick, below).
- **The well** is a line naming what a failed save wrote and for how long, with no Apply.
- **The fuse's light card and burst table** (`postFuse`, `postBurst`, `fuseBody`, `burstBody`; models `fuseCardModel`, `burstCardModel`, `blankBurstModel`). One chat message per light holds everything its body draws under `itemRunCard` (`kind: "fuse"`: the roll, the outcome, the `fuse` count, clock and spot, the blank figures), since the item is used up by the burst. The light's row reads Lit, Not lit or Fumble with the throw's target and a tooltip of its parts (`throwTip`: the item's figure less each modifier, the proficiency noted, the page); a lit fuse's note reads "Goes off at the end of {bearer}'s initiative in {n} rounds" on a fight's clock and "Goes off in {n} rounds" on the world's. A blank figure is a blank cell whose tooltip is the page alone, and an unlit or a Judge's light says so in a plain line and offers no press. A seat that owns the bearer's token sees Move the spot and Set it off now while the fuse burns. The burst writes its facts onto the same message, which becomes the table (`kind: "burst"`, `burned`): a row per subject the seat owns (a Judge's seat owns every one) with Save while the entry is open, then its target and verdict, the damage the Apply will write (the share a pass takes off, then the body's defenses; a figure that cannot be read is the Judge's, its reason under the name), Apply for a seat that owns the body, Undo on an applied row for the seat that applied it or owns the body; Apply all where the seat owns a row that holds a verdict; a vessel row the seat owns reads "structure" with Hand on, then "handed"; and, for a Judge's seat alone, a line naming the buildings in the area with the rolled total and the page. A burst that rolled nothing (`blankBurstModel`) says the Judge decides; one that could not happen is a line whispered to the Judges and no table.
- **The engaged card** (T10; `engagedBody`, `engagedCardModel`). An always-on engaged reach (`isEngagedActivation`) raises no card, so its prompt posts or joins the card of its subject's moment: one chat message per subject per initiative (`engagedCardKey`, the turn stamp and the subject's token; outside a fight a card is never reused), `kind: "engaged"`, naming no item, row or activation of its own. Each item kind asked is one row on it, an entry under its moment key that carries its own `itemUuid`, `rowKey`, `activationId`, `kindKey` and `bearers` (every bearer of the kind that engages the subject, named together in the "Engaged by" column), so the carrier's Save press and Undo write it as they write a raised card's. A later moment strikes the subject's older open row of the same kind on earlier cards and releases its held key. The save card is whispered to the subject token's owners as 4c's is, titled for the trait and, for a row that names its own `lasts`, telling the subject its failure is timed (`lifeWord` "timed"). A seat sees a row when it owns the subject or every bearer on it. Save: the subject's owners. **Not engaged**: a seat that owns every bearer on the row, by Foundry's ownership and never by role (a Judge owns every token and is offered it on that ground alone). It closes the row with no save and no record, the row keeps its bearers and reads who closed it, the moment key is released and the whisper is answered; a Player's press is relayed and checked again on the GM's window (`notEngagedHere`), and Undo on the closed row reopens it. The **read line** (what the module read of the adjacent square and what it did not, `engagedCardModel`'s `words.engagedRead`) shows to the same seats as Not engaged and only on a card with a row they own every bearer of. The ruling behind both audiences is `docs/lib/DECISIONS.md` (2026-11-25, "Not engaged and the read line follow the engaging bearers' ownership").
- **Distance** is measured edge to edge: `distance-units.mjs` `tokenEdgeGapFeet` runs the scene grid's `measurePath` between the nearest points of the two tokens' footprints (the facing edges where they are apart, one shared coordinate where they touch or overlap), so tokens touching or overlapping are 0 apart and a token one empty square away is one square away. `tokenGapFeet` stays the centre-to-centre figure for its other callers (a cast's range, a roll gate).
- **The "In reach of" strip** (`item-run-strip.mjs`, `templates/lib/item-reach-strip.hbs`, inside the `acks-extras-frame__scroll` of the character and monster sheets): `reachStripFor(actor)` reads the aura behaviors over the body's token on the viewed scene, keeps the reaches whose filter answers true for it, and tags each one: Save owed (an open entry on the raised card, with a Save press offered by ownership of the TOKEN that saves, written by `pressRoll` onto the card's own moment-keyed entry), Waits for its moment, Failed, Always on (a standing reach, with its part and the rolls it names) or Immune (the immunity record's `itemRun.dueAt` against the world clock, in turns). The source token's name follows core's own display rule (`shownTokenName`): never a secret token's, never `NONE`'s, an owner-only name to an owner, else a neutral line. The strip is absent for a seat that does not own the body. Hooks on a card's change (`cardSubjectUuids`: a raised card's listed subjects, an engaged card's subject), a token's move and a Region's change re-render the open actor sheets.
- **The strip's engaged states.** An always-on engaged reach has no raised card to find by activation, so its row reads the body's own records for the item's kind key. Owed: `openEngagedEntryFor` finds the open entry of this body and kind across the engaged cards, and the Save press names that card's message and entry (offered by ownership of the token, as above). Failed: the kind's `lasts` record (`lastsRecordId`) stands on the body, with its turns left from `itemRun.dueAt` and a tooltip of its own saying a timed failure ends with its turns or with the entry's Undo. Immune: the kind's immunity window, as for any reach, and read before the other two. Waiting: neither. A body met by several bearers of one kind has one row, the nearest bearer's, since the body is asked once per kind: `collapsedKind` keeps the nearest (the first on a tie) and carries `more`, the count of the others, and `moreNames`; `stripModel` passes both on and the strip draws "and n more" with the others' names, as that seat is shown them, in its tooltip. Only engaged reaches collapse.

- **The sheet rows' presses** (`item-run-row.mjs`, `item-run-row-view.mjs`, `templates/lib/item-run-row.hbs`). An item the carrier runs says its state on its row of the monster sheet's Inventory tab (generic items, armour and clothes) and the character sheet's gear rows; there is no second list. An item has a row where it carries an `itemRun.activation`, or none and a row that names a reach (always on). The tag, by state: a toggle Lowered or Raised (no round: `activation.state` stores none), a `once`, `fuse` or `consume` item Ready or Used up (`itemRunUsedUp`, the one test the HUD reads too; a `once` item whose activation names `uses` spends one of its count at a use that has done its work, through `consumeOne`, the one spender a fuse's burst uses as well, so a count of three reads two, and the last one leaves the item at none and kept, where a burst deletes its last, after which a use is refused `spent`; a `once` item that names no `uses` is never spent and keeps its press at any count, an item that carries no count spends nothing, a use refused or failed before its effect spends nothing, and the count itself is the item's Quantity, editable by hand on its sheet), a fuse item Lit while one of its fuses burns (`litStateOf`: the bearer's turns left on the combat clock, the rounds to the due moment on the world clock, at least one; the strip's own words and tooltip, MM p. 55), an item with no activation Always on. The line names the activation's words, the reach in feet with the item's page and a tooltip read as the strip's radius is (`radiusFigure`: the imported table's row, else the page alone where no figure was imported), and, raised, the bodies the card lists in reach for this seat (the rows of tokens the seat owns, as the card itself shows them); an engaged always-on reach reads "the adjacent square" with the page the engaged card ships, and "In a fight · n engaged" while its Region stands (`engagedStateOf`: the Region's tokens the row's filter admits and `engagementHolds` allows) or "No ring until it is in a fight". A press is offered only to an owner of the item by Foundry's own test, never by role, and only for a kind some runner takes (`hasActivationRunner`): Raise, Lower, Use and a fuse's Light call `Item#use`, so the one door stays (claimant, `useItem`, relay, `runUse`, presenter); a lit fuse offers Light again only where the stack holds more than it has lit (`litCountOf`), since each light writes its own record; and Card scrolls the chat log to the card `cardOfActivation` finds for the raised activation. A seat that does not own the item reads the tag and nothing else. A `consume` item's row also carries a "Swigs left" box for an owner of the item, drawn where the presses are hidden too (it is a control): it shows `activation.left`, blank where no count was rolled or typed, and writes on change (`writeRunLeft`, wired by `bindItemRunRows` from each sheet's render; the box has no `name`, so the sheet's form never submits it): a whole number with `leftFrom: {by: "hand"}`, a blank clearing both, anything else nothing. Its tooltip says where the count came from: the roll at hand-on (`leftFrom: {by: "roll", formula, total}`, with the item's page), a hand, or how a blank one is filled. A card's making, change or deletion re-renders the open sheet of the actor carrying its item, since the card is posted after the write that raised the item. An ability's rows are not in these tabs.
- **The Token HUD** (`item-run-hud.mjs`). One `control-icon` in the right column for each item on the token's actor that carries an `itemRun.activation`, in the actor's item order. A toggle reads Raise or Lower by its state and lights `active` while raised; a fuse reads Light, and draws none while it burns with no spare in the stack; any other kind reads Use; an always-on item carries no activation and draws none, and an item the sheet row reads as Used up (`itemRunUsedUp`) draws none. The picture is the item's own where it has one (the importer's minted default, the system's and Foundry's count as none) and core's `icons/svg/aura.svg` otherwise. The name is the `aria-label` ("<item> · Raise", "Lower", "Light", "Use") with an empty `data-tooltip`, which core shows as the label. A seat is drawn the control for an item that passes Foundry's `isOwner`, no role read, and a press is `Item#use`, the sheet rows' and the hotbar macro's one door, so nothing is refused here that the door would not refuse. The HUD redraws after a press, when an item of its actor is made, changed or deleted, and when an effect of its actor is made or deleted (a fuse lit or gone).
- **The reach glyph** (`reach-glyph.mjs`, `reach-glyph-logic.mjs`). A body inside a reach wears a small ring on its token, drawn from core's `icons/svg/aura.svg` by each client for itself, with a readout over the token on hover that carries the line the strip carries for each reach (the state added for a Judge and the body's owner). The glyph is a named child of the token, found by name each refresh and never held by document id, never a child of core's `token.effects` and never an Active Effect's `showIcon` (core draws that for every seat, which would show a Judge-only reach to a Player). A seat is shown the reaches whose Region its own view of the Region document shows (`shownReaches`: the Judge's every one, another seat only a Region visible to everyone, or to observers where it observes it), so a Player sees the ring where the row's `showReach` is ticked, the raise having made the Region everyone's. It sits at the middle of the token's right edge at the size of core's effect icons, is worked out on a debounced pass over the viewed scene after a document write that can change membership, and writes no document.
- **An item's effect rows on its item sheet** (`gear-effect-sheet.mjs`, `gear-effect-rows.mjs`, `item-sheet-host.mjs`). Every item of type `item` gets one group at the end of the sheet's Details tab, on the extras item sheet and on the system's, listing `itemRun.rows` with Add row, and Edit and Delete on a row; the row editor is the ability sheet's (`effect-row-editor.mjs`, including the reach group above), run over the item's own store (`gearEffectStore`). `findItemSheetHost` finds a Details host and a sheet with none shows no group, never one on another tab. The group is rebuilt on every render of the sheet, so a row written by the editor, the importer or a macro is listed as it lands. The controls are offered where the store's `editable()` holds (Foundry's ownership, no role read); another seat reads the list, and an item with no rows shows it nothing. The controls carry `data-gear-rows` and the group wires its own clicks, since neither host sheet has the actions.
- A group sheet's stack row can carry the press for the item its carry share names (`registerStackRowControl`); that is lib's own seam and is described in `GROUPS.md`, "A body sent out carrying its item".
- **The morale line.** A morale page's record rows (`influence/record-effects.mjs`) carry `spell`, `cite` and `fromItem` (the record is an item runner's), and `moraleWorkingLine` turns an item's row into `In reach of <item>` with the record's page and the row's tooltip, which the morale roll's working prints. A spell's record keeps its label.
- **The bearer's tick works both ways.** The raised card reads whether the bearer is counted from the item's own `filter.self` (a re-raise after a lowering shows the choice the item kept). Count in writes `count`, Count out writes `no`, both for an owner of the item; Count out strikes the bearer's open prompts and leaves what a save wrote, with its Undo. Lowering resets nothing. Under a standing reach, which core never reports the bearer inside, Count in holds the standing part on the bearer through `holdStanding` under the card's activation (so lowering lifts it, as for any held body), and a standing reach with no figure imported refuses it (on a lowered card nothing is held and the choice is only kept); a raise of a standing item whose filter already counts the bearer, the choice kept across raises, holds the part in `runToggle` and lists the bearer's row on the new card, since core reports no moment for the bearer; the bearer's row then reads held ("Always on", the part and the page in the Result's tooltip, no Save for any seat). Count out releases that part through `releaseStanding`: the bearer's one record, kept (retargeted) where another reach of the kind still holds the bearer, and nothing else the actor holds. Under a prompting reach Count in writes no part, and the bearer is asked at its own turn start.
- **A raised card's undetermined rows.** A body the filter answered null for (a unit clause across groups; a standing reach's own entry lists no body, so on an E9-style card the rows are these, the bodies counted in and the ones Check range again lists) is kept in the card's `undetermined` and listed under "Could not be settled" for an owner of the ITEM, with a Count in (`tickSubject`, the once-only card's own code: `unsettledRows`, `countSubjectIn`). The count is the owner's reading of the filter for this raise: the body is listed as in reach and recorded in the card's `counted`, and every later moment of the reach reads it as admitted through `admittedWithCount` (the handler, Check range again and the "In reach of" strip alike), so a turn start prompts it and a standing entry holds its part on it, written under the card's activation so lowering lifts it. A standing reach with no figure imported refuses the count, and a body outside the Region now is dropped from the list and refused. Every listed body under a standing reach reads as held in the table, since a standing reach asks no save and waits for no moment: "Counted in" where an owner counted it, "Always on" where the filter admitted it. No seat is offered a Save or an early Save on a held row, and its Result's tooltip names the part held on the body (the rolls it names and the imported figure, from `heldTipOf`) and the item's page, the page alone where no figure was imported. A standing exit mutes a row the card holds and a re-entry holds it again (`standingCardAct` reads the card); an exit of a body held only undetermined drops it from that list, and its next entry lists it again, and Check range again drops one that is no longer inside. A body is in one list of the card: any exit that mutes a row (`patchOut`, a prompting reach's as well) drops the body from `undetermined` where it is held there, and a re-entry the filter cannot settle (`patchUndetermined`) lists it undetermined and takes its muted row away, a row in reach or as no target staying as it is. The count is per raise, unlike the bearer's `self` filter: it lives on the card, which belongs to one activation, and lowering writes each counted body back to `undetermined` and counts nobody, so a re-raise starts with none. Nothing is written to the item.
- **A once-only card's undetermined rows** (a body a clause answered null for, such as a unit clause across groups) list under "Could not be settled" for an owner of the ITEM. Count in moves the body into the use: a use with no save writes the part's record under an applied entry the card's Undo reads; a use with a save leaves the body's own Save press open. Nothing is written to the item.
- **A Save is offered by ownership of the body saving** (`testUserPermission` OWNER), with no role read. The one role-shaped decision is the Judge's early Save on a waiting row, taken through `judgeDeclares` in the render and in the press handler (`checkPressRequest`'s `world.judge`); every other seat sees the row's Result say that the save waits for the body's moment, and no press.
