# Native regions: the core Region is the object, module types compose onto it

In-flight plan (docs-doctrine `wip/`): when the last slice lands, its substance
moves into the features' MODEL / DECISIONS / TESTING and this file is deleted.

## Owner rulings (verbatim, 2026-11-16)

- "the maps that import have zones defined (good) but are unreachable
  reimplementation of regions (bad). This needs repaired following the module
  development principles."
- "Both should be fixed to using the foundry native regions instead of polygons
  with unreachable ack-extra code" (dungeon zones and city quarters).
- "The new actor types like districts are a UI for the more complex needs, not a
  replacement for a fundamental object type"
- "Design principles, composition (extend) better than bespoke"
- Answers to the scope questions: all slices below go ahead, with "Non grid
  regions for gridless maps like city districts"; party membership is
  "Core's footprint"; imported Regions "Keep locked".

**Design.** The core Region owns shape, levels, elevation, membership and area.
The module's behaviour types (`district`, `encounterZone`, `trapZone`) are
configuration on it, and location actors name and link it through the
Region's `acks-extras.location` flag. That is the UI layer. Nothing in the
module computes geometry or membership that core keeps.

## What the audit found (2026-11-16, architect)

- F1 `formation/zones.mjs` `regionContains` falls back to its own shape maths
  (`pointInShape`, `pointInPolygon`). On v14, `RegionDocument#testPoint`
  always exists, so only offline mocks reach the fallback, and it answers
  false for a `grid` shape.
- F2 `findZone`, `zoneAt` and `zonesAt` test the token's centre against
  `scene.regions`. Core already keeps `TokenDocument#regions` and
  `RegionDocument#tokens` current. Core's version honours Region `levels` and
  tests every cell of a large token.
- F3 `regionOutlines`, `regionArea`, `regionEdges` and `trap-zone.mjs`
  `pointInsideEdges` duplicate core's `polygonTree`, `area`,
  `PolygonTree#testPoint(point, distance)` and `findClosestPoint`.
- F4 The behaviours are data only, and formation polls in `updateToken`.
  The polling **stays**: core's movement events never carry
  HALT/TRAVEL/RESIZE/TRUTH (`movement.updateOptions` whitelist), and the
  clock-before-trap order needs one trigger.
- F5 Imported Regions are locked; that stays (ruling). Dungeon-plan zones were
  one polygon because `pictureCells` returned cells only on hex grids.
- F6 A place's quarter is copied into `system.parentUuid` when the place is
  made (`poi.mjs` `promoteIncident`, importer `adventure-places`).
  Inferred to go stale once the token moves; not checked. Checked by S5: it
  is the place's filing, read only by hierarchy walks (location DECISIONS
  2026-11-16). One true drift: `promoteIncident` files under the marker's
  drop-time `regionUuid` while placing the token at the note's current point.
- F7 `battlemap/terrain-paint.mjs` and `domains/domain-map.mjs` paint one
  polygon per hex, plus a `terrainHexes`, `territoryHexes` or `domainHexes`
  flag that the terrain is read from. Battlemap DECISIONS 2026-08-28 ("the
  cell key is the identity") rests on "point-in-polygon needs a rendered
  placeable", which v14's document-level `testPoint` disproves.

## Slices

| # | Slice | Tree | Agent | Collides with | State |
|---|---|---|---|---|---|
| S0 | Hex encounter zones as core `grid` shapes | main | this session | none | landed 1f19fc81 |
| S3 | Square-grid (dungeon plan) zones as `grid` shapes; quarters stay polygons | main | this session | none | landed, walked live on AX1's Buried Temple (2000 squares) |
| S1 | `scripts/lib/regions.mjs`: `regionsUnder(token, type)` over `token.regions` (scene order kept, so the delve's "first zone" stands), `regionsAt(scene, point, {elevation, level}, type)` over `includedInLevel` plus `testPoint`, and `regionRings` from `polygonTree`. `zones.mjs` exports become adapters, so callers do not change; the fallback goes, and `regionArea` becomes `region.area`. Fixtures in `test-journey` and `test-trap-rules` gain `testPoint`, `polygonTree` and `area`. | main | `implementer` | dungeon close-out (formation); S1 leaves `encounter-zone.mjs` alone | landed 84ce3c56; walked with S2 (`tools/live/formation-regions.mjs`) |
| S2 | Membership is core's footprint: `findZone` and `zonesAt` for a token read `token.regions`. New formation DECISIONS entry (supersedes the centre rule in MODEL and in the `findZone` docstring); re-walk formation TESTING "A move the GM's client is drawing" 7-9 | main | `implementer` | same as S1 | built; walked with S1 on lane C, `formation-regions` 27 of 27 (FIXTURE_OWN, partial) |
| S1b | Trap sweep on core geometry: `placementDistanceFeet` and `pointInsideEdges` read `PolygonTree#testPoint(point, distance)` and `findClosestPoint` | main | `implementer` | after close-out U16 (eb51e9b2); close-out Phase 4's §7 row 2 (`askDischarge`, `attemptDisarm`) builds on it | built; walked with `formation-regions` step 13 |
| S4 | Paint layers (terrain, territory, domain) as core `grid` shapes; drop the per-hex polygons and cell flags. Supersedes battlemap 2026-08-28, citing the rulings above | `topic/native-paint-regions` (reworks the paint surface) | `architect` ruling on read paths, then `implementer` | battlemap and domains in-flight work | open |
| S5 | Check F6, and if the quarter copy goes stale, read a place's quarter from the Region its token stands in | main | `architect`, then `implementer` | none | ruled: no `parentUuid` change (docs); `promoteIncident` reads the quarter under the note's point after S1 |

Every slice that changes the runtime is walked live on `main` before it is
reported done (`.claude/rules/live-testing.md`).
