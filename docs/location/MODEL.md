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
    nullable `market` subtree carrying demographics, market class, postings,
    candidates and slander.
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
character in a formation has no token of their own: joining deletes it, so the
thing on the ground is the party token and it answers for every member. A
character no formation claims stands wherever their own tokens do, on every map
at once. The geometry is `here.mjs`: a token's footprint padded by one grid
square, and a floor being the scene's own square distance.

`reachScan` is one pass over the world's tokens, built once per render by the
surfaces that ask about every place at once and handed to each call. The rulings
these follow, and what each cost, are in [DECISIONS.md](DECISIONS.md)
(2026-09-12).
