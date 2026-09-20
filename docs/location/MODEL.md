# Locations & Settlements — Design Model

How this module applies the family doctrine **reuse → extend → enhance →
invent**. It is the location-domain **binding target** of the table
extraction program (`acks-module-template/docs/CONTENT-EXTRACTION.md`): the
home of the settlement actor and of the per-world imported rules tables that
sibling modules (henchmen today; domains later) read through acks-lib.

- **Reuse**: the core `acks` system's actor framework and money/inventory
  documents; the lib subsystem's tables registry and service contracts (`requires
  the lib subsystem` — the module's only family edge).
- **Extend**:
  - Actor sub-type `acks-extras.location` (TypeDataModel), registered here and
    only here: identity and nesting (name, region, notes, `parentUuid`), a
    reference roster, a stack count, and — on the places that have one — a
    nullable `market` subtree carrying demographics, market class, the
    Judge's rarity overrides, postings, candidates and slander.
  - **Storage at a place**: the lib subsystem owns the primitives (providers, stored
    goods, transfers, the deletion fallback); this module owns the experience
    — the location sheet, the character sheet's Storage tab, the retirement of
    the system's banked-coin column, the vault sweep, and the GM manager.
  - **Table schemas**: typed shapes for the people/economy documents
    (cultures & names, occupations, age tables, class registry +
    distribution grids, wages, availability, followers, slavery, monstrous
    recruitment, settlement scale). The schemas ship; the **values never
    do**.
  - World-imported table documents, registered into `acksLib.tables` at
    priority 20 (world) via the lib's `ruledata-import` contract; the
    acks-importer binding writes through that contract, never through this
    module's name. Materialization mirrors rollable tables into RollTables on
    the ACKS library's RollTable shelf — reader-facing names, filed per
    ruledata doc under "ACKS Imported Tables", identity in a `tableKey` flag —
    and everything else into JSON journal pages named by raw key (the
    drop-override match) on its JournalEntry shelf; a shelf is opened by the
    first pass that needs it (`lib/library-target.mjs`), and a sidebar tree an
    earlier release wrote is retired then and rebuilt on the shelf. The
    contract's `countMaterializedDocs`/`removeMaterializedDocs` remove the
    documents without touching the imported data.
- **Enhance**: the location sheet — contents, roster and nesting on every place,
  plus the market tabs (pools, demographics, postings, candidates, slander) on
  the places that have a market; a "which tables are present / missing, and from
  which book" panel with import pointers.
- **Invent**: nothing the system provides. No book values, no fallback
  sample tables (ruling 1): absent tables render as stubs + citations.

## Reaching a place

Depositing is gated on being able to reach the place; **retrieving is not** —
a player who cannot get their own goods back is a worse failure than one who
withdraws from a distance. A refusal returns its reason, because a control that
has quietly vanished reads as a broken module.

Places come in two shapes and the rule has two halves to match. A place with a
**linked scene** IS a map, and being on that map — not the *active* map — is
what reaches it. A place with **no linked scene** answers to a claim (your own
vault, a place you own, a place pinned to your sheet, a place someone you march
with owns) or to standing at its own token, because a market cart or a shrine
can stand on a map without being one.

Both halves ask the same question first — **where is this character actually
standing** — and `standingSpots` (`reach.mjs`) is the only reader of it. A
character riding inside a formation has no token of their own, because joining
deletes it, so the thing on the ground is the party token and it answers for
everyone it carries — and answers for them alone, so a token left behind on
some other map grants nothing. A deploy gives a body back: a member sent out as
an INDIVIDUAL stands at the token the deploy made for them, which is what tells
a live detachment from a leftover, while a cell deployed as a STACK keeps
answering through the party token because its bodies are built from the stack's
template actor and name that, not the cell. A formation with no party token
placed anywhere has no body to answer with, and its members fall back to their
own tokens rather than standing nowhere. A character no formation claims stands
wherever their own tokens do, on every map at once — and one token is one body,
so an unlinked copy reaches what it is beside and never what another copy of the
same sheet is. The geometry is `here.mjs`: a token's footprint padded by one grid
square, and a floor being the scene's own square distance.

`reachScan` is one pass over the world's tokens, built once per render by the
surfaces that ask about every place at once and handed to each call. The rulings
these follow, and what each cost, are in [DECISIONS.md](DECISIONS.md)
(2026-09-12).

## Which places a sheet LISTS

Reach decides whether a place will accept a deposit; it does not decide what a
sheet shows. Every place holding goods of this character's is listed, always. A
place holding nothing of theirs is listed on three narrow grounds, each about
this character alone (`listsWhenEmpty`): their own **vault**, which has to be
reachable before it holds anything; a place they **pinned**, which is what
pinning is for and is the list's manual control; and a place they are
**standing at** right now (`standingAt` — the presence half of reach without
the claim half). Ownership and a companion's ownership are deliberately not
grounds: they are world-wide, so a world that leaves its places open puts every
one of them on every sheet (see [DECISIONS.md](DECISIONS.md), 2026-09-20).

## A place on the map

A place's own token is a **point of interest**: the shrine in the square, the
gate, the tavern the party is looking for. Nothing new is stored for one — it
is the location actor dropped on a scene the ordinary way — and three things
follow from its being an actor's token rather than a marker's.

**It is made to be a marker.** A location actor created without saying
otherwise gets a prototype token whose name shows on hover to anyone, with no
bars, a neutral disposition, no sight, and core's own house for a picture on
both the actor and the token (`preCreateActor`, `module.mjs`), each default
applied only where the creation data was silent. `actorLink` is left alone on
purpose: `here.mjs` matches a place by the token's base actor id, which an
unlinked token carries too, so a Judge who drops one shrine on three maps has
one place on three maps.

**It is not a body.** Every reader that takes a token for somebody standing
there steps over a place's: the roster a linked scene derives
(`sceneOccupants`, lib `place.mjs`), token sync's vision and light writes
(`tokenSyncDelta`), the battlemap's size-by-creature scaling, and a
formation's **Add to party**. A shrine standing in the market square is not
the square's tenant and cannot join a marching order.

**It keeps its place alive.** `pruneEmptyLocations` spares an empty place that
has a token on any scene, hidden or not — a marker the Judge hid is a point of
interest not yet found. The world's tokens are walked once per sweep, not once
per place.

**A quarter's own place.** A scene Region can carry the same
`flags["acks-extras"].location` the scene carries, at the Region's grain, and
the place mirrors it in `system.regionUuid`. `locationOfRegion` /
`regionOfLocation` read the pair with the flag-wins repair the scene link has,
`linkRegion` / `unlinkRegion` / `createLocationForRegion` write it, and the
`updateRegion` / `deleteRegion` / `deleteScene` hooks keep the mirror true (all
`scene-link.mjs`). The one Judge surface is the District behaviour's sheet,
into which the formation feature injects a **Place** row that calls this
feature's api: pick a place, or make one named after the Region and nested
inside the scene's own place. A quarter's place is what answers "where is the
market" when the party stands on no point of interest at all; the ruling is
[DECISIONS.md](DECISIONS.md) 2026-09-16.

## Organisations here

A place's Contents tab lists the organisations at it — seated here, holding
this place, or controlling the quarter it is — for a GM or an owner, each an
open link with a small label. It is read through `acksExtras.factions` at
render time rather than by import, so a world without that feature renders no
section at all and this module keeps its one family edge; a holding its owner
marked hidden reaches a Judge only. What an organisation is, what seating and
holding mean and where the api comes from are the factions feature's
(`docs/factions/MODEL.md`, "Where a faction stands").

`placesOnScene(scene)` lists every visible place token on a map and is what the
settlement panel offers as destinations; the panel, the incident markers and
the walk between points are the formation feature's
(`docs/formation/MODEL.md` "Points of interest").
