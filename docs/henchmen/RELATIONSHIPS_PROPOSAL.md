# Relationships — Attitude & Slander

> **IN EFFECT** (accepted and implemented 2026-07-22). Describes shipped
> behavior in acks-influence (attitude) and acks-henchmen (slander).
> Companion to `MODEL.md`; local rules at `acks-rules/acks-henchmen/RULES.md`.
> The family-wide relationship-registry refactor remains explicitly out of
> scope — each module keeps its own store; only the conventions match.

Two social ties in the ACKS stack are the same shape — a directional edge from a
subject to a held-on endpoint, keyed by a soft uuid — and are modeled with
matching conventions but **no** shared cross-module relationship primitive.

| Edge | Subject → endpoint | Held on | Owner module | Rule |
|---|---|---|---|---|
| **Attitude** | character → character | the influencer | acks-influence | reaction ladder |
| **Slander** | party *or* character → location | the **location** | acks-henchmen | RR 162 town-wide −1 |

Attitude holds on the *influencer* because it is one person's personal stance.
Slander holds on the *location* because it is the town's collective stance, and —
per the accepted decision — one location-held entry can cover a **party or an
individual** in a single record, so a subject is counted once and never
double-tallied across a party and its members.

---

## Part A — Attitude relationship (acks-influence)

The `acks-influence.attitude` Item implements the edge.

**Store** (`scripts/attitude-data.mjs`) — one Item on the influencer per target:
`targetUuid` / `targetName` / `targetImg`, `attitude` (0–4 ladder),
`attempts.{diplomacy,intimidation,seduction}`, `notes`.

**Behavior:**

- **Auto-create on resolve.** `#saveAttitude` creates the Item the first time an
  influence roll resolves against a target, updates it thereafter
  (`influence-app.mjs`). All three resolution paths route through it:
  visible-target, hidden-target/GM-relay (`resolveExternal`), and
  GM-as-influencer.
- **Per-tone attempt tracking** so a resumed conversation picks up at the right
  attempt level per tone.
- **Sheet affordances** (`module.mjs → injectRelationships`, Notes tab): click a
  row to open the record, drag it to transfer to another actor, delete
  (owner-only). The injection anchors on the core sheet's
  `.tab[data-tab="notes"]` DOM; the host lookup is hardened with fallback
  selectors and warns once (instead of silently dropping the section) if the
  core sheet's DOM shape ever changes — edges are still created either way.
- **Consumer hook** `acksInfluenceAttitudeChanged` fires on every change.

---

## Part B — Slander relationship (acks-henchmen)

**Store** (`scripts/data/location-data.mjs`): `slander[]` on the location, each
entry a structured **subject** — one entry, held on the location:

```js
slander: new fields.ArrayField(new fields.SchemaField({
  subject: new fields.SchemaField({
    scope: str(),             // "all" | "party" | "character" (initial "all")
    uuid:  str(),             // employer/party actor uuid, or character uuid; "" when scope="all"
  }),
  npcName: str(), time: int(), note: str(),
}))
```

**Count resolution — single pass, each entry once** (no double count):

```
slanderCountFor({ employerUuid, characterUuid }) =
  count of entries where
      subject.scope === "all"
   || (subject.scope === "party"     && subject.uuid === employerUuid)
   || (subject.scope === "character" && subject.uuid === characterUuid)
```

A bare-string argument is accepted as `employerUuid` (back-compat shim for one
release). Because every entry lives once on the location and matches at most one
branch, a party-scoped slander and a character-scoped slander against a member
are two distinct entries that each count once — the "party and individual in one
structure without double counting" property that motivated holding on the
location rather than replicating edges onto each character.

**Writers:** refuse-and-slander (`recruit-dialog.mjs`) records
`{scope:"party", uuid: employer.uuid}`; the location-sheet ledger adds rows
(default `{scope:"all"}`, editable scope select + uuid) and deletes them.

**Both-sided access.** Storage stays location-side (the RR 162 penalty is the
town's, and the recruit-time query is location-scoped). The character/party end
— "where am I slandered" — is the api read helper
`acksHenchmen.slanderedAt({ employerUuid, characterUuid })`, which scans
location actors and returns `[{ location, count }]`. A read helper, not a
second store.

**Consumer hook** `HOOKS.SLANDER_CHANGED` (`acks-henchmen.slanderChanged`)
fires on every registry write (refuse-and-slander, ledger add/remove).

---

## Shared conventions (module-local, no shared primitive)

Both edges independently follow the same rules so they behave alike:

1. **Soft uuid references**, resolved lazily; a dangling uuid degrades to the
   stored display name, never throws.
2. **Held on the natural aggregation endpoint** — influencer for attitude, town
   for slander — chosen by which side owns the governing query.
3. **Lifecycle:** entries survive endpoint deletion as display-name tombstones
   (soft references); attitude transfers by drag-to-actor, slander re-keys by
   editing the subject on the ledger.
4. **Affordances parity:** visible ledger, open / transfer / delete, a
   namespaced change hook.

No `acks-lib` registry, no shared edge document — each module keeps its store and
only the shape agrees.

---

## Migration

`slander[].partyKey: str` → `slander[].subject: {scope, uuid}` via
`LocationData.migrateData` (runs before validation on document load):
`partyKey === ""` → `{scope:"all", uuid:""}`; any other value →
`{scope:"party", uuid: partyKey}` (no pre-migration data was
individual-scoped, so no character entries are produced). `slanderCountFor`
keeps the string shim for one release.

---

## Enhancement — relationship map / web browser (PLANNED, not implemented)

A graph view over both edges: attitudes (character→character) and slanders
(party/character→location) rendered as one navigable web. **Integration
first** (user direction 2026-07-23): adopt or feed a maintained community
module before considering a bespoke viewer. Survey of the field (2026-07-23,
family rule: v14-verified or out):

| Module | Author | State (2026-07-23) | Fit |
|---|---|---|---|
| [Foundry Graph](https://foundryvtt.com/packages/foundry-graph) | Luca Gioppo | 0.14.3, Jun 2026, **v14 verified**, AGPL-3.0 | **Primary candidate.** Entity-agnostic nodes (Actors/Items/Scenes/Journals), typed styled edges, per-world persistence, template-based graph types, `api.openGraphById()`. Gaps: beta ("schemas may change"), no *documented* write API or graph-type registration yet. |
| [Target Tree](https://foundryvtt.com/packages/target-tree) | LoboWerewolf | 3.0.0, ~4 wks, **v14 verified** | Networks/hierarchies, drag-drop actors, realtime sync, per-player visibility. No API — display-only unless one appears. |
| [Relations Tracker](https://foundryvtt.com/packages/relations-tracker) | LoboWerewolf | 2.0.1, ~4 wks, **v14 verified** | Sheet-integrated per-character relations — *overlaps our attitude store* rather than complements it; adopting it as a store would mean double bookkeeping. Watch only. |
| [Lore Reference Board](https://foundryvtt.com/packages/lore-reference-board) | Elemor | 2.2.0, ~2 wks, v12–14 | Faction relationship board inside a much larger GM-screen toolbox; heavier dependency than the feature warrants. |
| [R-Maps](https://foundryvtt.com/packages/fvtt-r-maps) | mclemente | 1.1.0, **stale ~1 yr, v13 max** | Canvas-token corkboard; fails the v14-only rule. Out. |

**Ground rules for whichever lands:**

1. **Projection, not relocation.** The stores stay where they are (attitude
   Items on the influencer, slander subjects on the location). The map module
   receives a *projection* — nodes and edges generated from our stores — and
   is never the source of truth. `HOOKS.SLANDER_CHANGED` and
   `acksInfluenceAttitudeChanged` already exist to drive incremental refresh.
2. **Soft integration**, like the influence integration: guarded behind
   `game.modules.get(id)?.active`, zero hard dependency, everything degrades
   to today's ledger/section UI.
3. **Upstream before bespoke.** Foundry Graph's model (typed edges, graph
   types, macro API) is one small step from what we need — a data-driven
   graph-definition/write API. File an upstream issue/PR for that before
   writing any renderer of our own; the author is active. Bespoke (a D3/SVG
   viewer in acks-henchmen) is the last resort, only if no candidate grows an
   API and the beta schemas stabilize elsewhere.
4. AGPL-3.0 (Foundry Graph) is fine for runtime API integration — no code is
   copied into this GPL-family module.
