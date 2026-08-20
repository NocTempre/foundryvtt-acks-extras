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
    module's name. Materialization mirrors rollable tables into world
    RollTables — reader-facing names, filed per ruledata doc under "ACKS
    Imported Tables", identity in a `tableKey` flag — and everything else into
    JSON journal pages named by raw key (the drop-override match). The
    contract's `countMaterializedDocs`/`removeMaterializedDocs` remove the
    documents without touching the imported data.
- **Enhance**: the location sheet — contents, roster and nesting on every place,
  plus the market tabs (pools, demographics, postings, candidates, slander) on
  the places that have a market; a "which tables are present / missing, and from
  which book" panel with import pointers.
- **Invent**: nothing the system provides. No book values, no fallback
  sample tables (ruling 1): absent tables render as stubs + citations.
