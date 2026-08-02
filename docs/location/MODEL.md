# Locations & Settlements — Design Model

How this module applies the family doctrine **reuse → extend → enhance →
invent**. It is the location-domain **binding target** of the table
extraction program (`acks-module-template/docs/CONTENT-EXTRACTION.md`): the
home of the settlement actor and of the per-world imported rules tables that
sibling modules (henchmen today; domains later) read through acks-lib.

- **Reuse**: the core `acks` system's actor framework and money/inventory
  documents; acks-lib's tables registry and service contracts (`requires
  acks-lib` — the module's only family edge).
- **Extend**:
  - Actor sub-type `acks-location.location` (TypeDataModel) — moved from
    acks-henchmen per the 2026-07-19 ruling (**no compatibility shims**):
    settlement identity, urban families / market class, demographics
    (culture weights), settlement alignment, market state. **Shipped in
    0.5.0 as identity only** (name, region, notes) — see the decision below.
  - **Storage at a place**: acks-lib owns the primitives (providers, stored
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
    acks-content binding writes through that contract, never through this
    module's name.
- **Enhance**: the location sheet (market pools, demographics editor —
  migrating from henchmen in the consume phase); a "which tables are
  present / missing, and from which book" panel with import pointers.
- **Invent**: nothing the system provides. No book values, no fallback
  sample tables (ruling 1): absent tables render as stubs + citations.

## Decisions

- **2026-08-02 — a location is a PLACE, and a market is an option on one.**
  Four rulings taken together, all from the owner:

  1. **Every scene may have a linked location — on demand, never automatically.**
     The scene holds the canonical flag (`scene.flags.acks-extras.location`);
     `system.sceneUuid` is a mirror kept true by `scene-link.mjs`. The scene's
     end wins because scenes get duplicated, imported and deleted by hands that
     never touch the actor directory. Auto-creating one per scene was rejected:
     most scenes in a real world are battle maps and lighting tests, and a
     module that added forty actors on first load is a module that gets turned
     off. The affordances are a scene-config row and two directory context
     entries.
  2. **Places nest, and they unify with containers.** `system.parentUuid` gives
     realm > town > inn > cellar > chest. The primitive lands in acks-lib
     (docs/lib/PLACES.md) because nesting is not settlement-specific. A chest is
     the *trivial* place, and that is a constraint rather than an analogy:
     anything this sheet does to a town it must be able to do to a chest.
  3. **Location inventories hold more than items.** Foundry has no
     actor-inside-an-actor, so groups, monsters, retainers and animals are a
     REFERENCE roster (`system.roster`), denormalised so a deleted actor leaves
     a legible row. Tokens on the linked scene are appended as *derived* rows —
     shown, never stored, promoted only by an explicit pin — so a party crossing
     a map does not take up residence in it. Buildings are not roster entries;
     they are child places.
  4. **Markets are not the default, and the DATA is gated, not just the UI.**
     `system.market` is a **nullable SchemaField**: on a cave, a wagon or a chest
     it is literally `null`, not an object of empty arrays (a nullable field's
     `clean()` short-circuits in `_validateSpecial` before it ever casts). There
     is deliberately no `hasMarket` boolean — the presence of the subtree IS the
     flag, so the two cannot disagree. Cost of the ruling: every market field
     moved from `system.*` to `system.market.*` (90 sites across the recruitment
     engine), the engine's entry points now refuse market-less places outright,
     and `migrateData` folds legacy locations in on load. A location whose market
     was empty and untouched migrates to market-less, which is the new default
     and what its GM would have wanted.

- **2026-08-02 — `returnGoodsTo` was throwing, and the default delete policy was
  losing goods.** The container-nesting line guarded on an `equipment` identifier
  left over from when acks-equipment could be absent; after the merge it was
  simply undeclared, so every call with a non-coin item threw a ReferenceError
  and the caller's try/catch swallowed it. Deleting a place with goods in it
  therefore lost them under the very setting that exists to prevent that. Found
  while building the place layer on top of the same file.

- **2026-07-19 — founded as the extraction program's binding target.**
  Rulings recorded in CONTENT-EXTRACTION.md §4: no fallback samples; the
  location actor migrates here without migration shims; henchmen's shipped
  tables were purged the same day.
- **2026-07-19 — no sibling edges.** Consumers read `acksLib.tables`; this
  module registers into it. Neither side names the other (FAMILY.md §2
  discipline, adopted here from day one even though the wider refactor has
  not landed).
- Structures/strongholds extend this actor in a future module
  (acks-domains program); the "has X" inventory-marker fallback stays the
  interim contract.
- **2026-08-01 — the actor type lands LEAN, and the two location types
  coexist.** The 0.5.0 sub-type carries identity and storage only; acks-henchmen
  keeps its own `acks-henchmen.location` with the market schema (postings,
  candidates, market rolls, slander) and is not touched. Moving that data is its
  own program: doing it as a side effect of the storage work would have put a
  data migration between a player and their belongings, and the type labels
  disambiguate in the meantime ("Location" vs "Location (Henchmen Market)").
  Because acks-lib keys storage on a FLAG rather than a type, a henchmen market
  actor can hold goods today — the manager's "let an actor hold goods" is how.
- **2026-08-01 — the banked-coin column is retired, and the sweep is the
  migration.** The system's `system.quantitybank` was a competing answer to
  "where is my money": coin that is yours, weighs nothing, and is nowhere. Two
  answers would drift the first time a player used both. Per the owner's ruling
  the sweep makes a PERSONAL VAULT per character rather than one shared bank —
  it never guesses that two characters' savings are pooled — and the GM manager
  merges them on demand. The sweep is idempotent and self-healing so a stray
  value from an import is picked up rather than stranded.
- **2026-08-01 — deleting a place returns goods by default, and that is a
  setting, not a rule.** `acks-lib`'s `storageDeletePolicy` defaults to
  returning each owner's goods in a container named after the place, so a GM
  tidying the actor directory does not wipe the party's belongings. The "lose"
  branch is implemented, not stubbed: a campaign where a sacked city takes your
  warehouse with it is the eventual intent.
