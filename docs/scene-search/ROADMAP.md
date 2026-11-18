# Scene search — roadmap

What is not built. The slices and their owners are in `wip/20261118-scene-search-plan.md`.

- **The Foundry side (S2):** the thing writes, the drop branches (including a trap dropped on a bare Region), `placesAround`, the `sceneHasty` and `sceneMethodical` activities and their resolution, the session API, and a player projection that strips unfound yields. Lot keys stay in the session record and never in the place's authored `yields.lots`.
- **The screen (S4), the ways in (S5)** (with the Dungeon tab's Search here), **keying (S6)** (with the hazard group inside Things here), lore checks (S7a), and harvest and identify (S7b).
- **A per-rank step in `materializeRolls` (R-I1b).** Magical Engineering's and Naturalism's throws improve by a printed step per rank, and Loremastery's by a printed step per level. Today their specs, or for Loremastery the scan's unlabelled lift, give the rank-1 target flat, so an identifier at rank 2 or above reads the rank-1 target. Loremastery keeps the lift's positional key until the step is supported.
