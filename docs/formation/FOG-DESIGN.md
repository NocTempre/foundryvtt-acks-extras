# Investigation: Maps as Objects — a per-map fog of war

Goal (from the campaign requirements):

1. Without a mapper, fog exploration is **not recorded at all** (not merely hidden).
2. When mapping starts in unknown territory (e.g. the party falls through a hole), a **new, blank map** begins — no memory of previously explored areas, no hint of where the entrance is or how far away.
3. Each mapped area is an **object**: it can be carried, looted, bought, and sold, and can have **portions revealed** (a purchased map).
4. Two maps only combine when the party **physically connects** one mapped area to another.

This document records what Foundry's fog layer actually does (verified against the installed **v14.364** source), what the engine gives us for free, and the design for the rest.

---

## 1. How Foundry's fog actually works (v14)

Sources: `client/canvas/perception/fog.mjs` (FogManager, 1017 lines), `client/documents/fog-exploration.mjs`, `common/documents/fog-exploration.mjs`, `client/canvas/groups/visibility.mjs`.

### Storage

- Exploration is persisted as **`FogExploration` documents**: one per `(scene, user, level)`, whose `explored` field is a **base64 webp image** of the explored mask (red channel = explored). There is no vector data — it's a bitmap the size of the scene's fog texture.
- The scene setting is **`scene.fog.mode`** (`CONST.FOG_EXPLORATION_MODES`): `DISABLED: 0`, `INDIVIDUAL: 1` (per-user fog, the classic behavior), `SHARED: 2` (v14: all players see the **union** of player explorations; unions are recomputed on load and synced live via the core `shareFog` socket).
  - v13 instead has a boolean `scene.fog.exploration`; v14 shims it (deprecated until v16). **Writing the boolean on v14 fails validation** — module code must write `fog.mode` on v14 (fixed in `scene-sync.mjs`).

### Runtime (`canvas.fog`, a `FogManager`)

- `load()` fetches the user's FogExploration document (plus, in SHARED mode, all players' documents, unioned via MAX_COLOR compositing) into a PIXI texture on `canvas.fog.sprite`, which `CanvasVisibility` composites as the "explored" overlay.
- `commit()` renders the current vision polygons into that texture after each perception refresh — **it early-returns when `fog.mode === DISABLED`**, so DISABLED means *neither displayed nor recorded*.
- `save()` (debounced 2 s) extracts the texture to base64 and updates the user's FogExploration document.
- `reset()` emits the core `resetFog` socket → server deletes all FogExploration documents for the scene → all clients redraw with blank fog.

### Extension points the engine explicitly offers

- **`CONFIG.Canvas.fogManager` is swappable** — `board.mjs` even re-instantiates the manager if the configured class changes. Protected methods documented for overriding: `_createExplorationDocument`, `_unionizeSharedExploration` ("Override this method to change union rules"), `_applySharedExploration`, `_prepareFogUpdateData`, `_extractBase64`, `_createExplorationObject`.
- Limits: `load()/save()/commit()` internals use private `#fields` (`#explorationSprite`, `#extractor`, `#queue`), so a subclass can *wrap* the public methods but cannot surgically alter their middles. The design below deliberately avoids needing to.

---

## 2. What we already get for free

| Requirement | Status |
|---|---|
| Not recorded without a mapper | **Done** (this release): `scene-sync.mjs` sets `fog.mode = DISABLED` when no mapper (or no lit light); `commit()` then records nothing. Restores the original mode when mapping resumes; leaves scenes alone whose fog the GM already disabled. |
| Party-wide shared map | **Free on v14**: while a mapper is active we restore the scene's mode; a GM can set SHARED so every member sees the same accumulated map. (Phase 1 below forces SHARED while a formation maps.) |
| Blank map after falling through a hole | **Not yet**: DISABLED stops recording, but old FogExploration documents persist in the DB, so prior memory resurfaces when the mode is re-enabled. This is the gap the map-object system closes. |

---

## 3. Design: map sessions and map items

### Core idea

Never let exploration accumulate anonymously. All live exploration belongs to a **map session**, and a map session is always backed by a **Map item** — an ordinary (ACKS) Item with module flags, sitting in a member's inventory. Items are already lootable, tradeable, and sellable, which satisfies requirement 3 with zero new economy code.

```
flags["acks-formation"].map = {
  sceneId:   string,        // which scene this map depicts
  explored:  string,        // base64 webp, same format as FogExploration#explored
  active:    boolean,       // is this the live session's backing item?
  anchored:  boolean,       // is it currently composited into the live fog?
}
```

### The map lifecycle

1. **Session start** — a formation with a working Mapper stands on a scene with no active session:
   - GM-side: `canvas.fog.reset()` equivalent for that scene (delete its FogExploration documents), force `fog.mode = SHARED`, create a Map item ("Map of &lt;scene&gt; (in progress)") in the mapper's inventory, mark it `active`.
   - Players now explore from **black**: requirement 2's "no memory of the entrance" is automatic because the session began with a fog reset.
2. **While mapping** — core machinery runs untouched (SHARED union, commit, debounced save). Periodically (each dungeon turn tick, and on session end) the primary GM copies the current union into the Map item: read the players' `FogExploration#explored` textures, composite with MAX_COLOR into one render texture, extract base64, write to the item flag. This reuses the exact pattern of FogManager's own `#compositeTextures` (~50 lines with public PIXI APIs; the GM client always has a renderer).
3. **Mapper lost** (role unassigned, light out, mapper dies): `fog.mode = DISABLED` (already implemented) — recording stops, display goes dark, the Map item keeps whatever was archived. The item is still in the dead mapper's inventory: **loot it or lose it**.
4. **Discontinuity** (fell through a hole, teleported): GM presses **"New map"** in the formation window: archive + close the current session (item keeps its exploration, `active: false, anchored: false`), then run *Session start* again → fog reset → blank slate. The old entrance is neither shown nor inferable.
5. **Anchoring a map** (requirement 4): when the GM judges that the party has connected its current position to territory a held Map item depicts (or bought a map and identified a landmark), they press **"Anchor"** on that item in the formation window. GM-side: composite the item's `explored` bitmap into every user's current FogExploration document (update their `explored` fields), then tell clients to `canvas.fog.load({preserve: true})` via the module socket (`module.acks-formation`). The old area lights up as explored, merged seamlessly with the live session.
   - Anchoring is **deliberately GM-judged**, not automated: "does this corridor connect to the map you bought?" is a Judge call, exactly like the tabletop procedure. (A future nicety: auto-suggest anchoring when the party token enters a region whose pixel is explored in a held map — `FogManager#isPointExplored` shows how to test a texture pixel.)
6. **Bought/partial maps** (requirement 3, "portions revealed"): a Map item's `explored` bitmap can come from anywhere:
   - **Author from play**: GM archives a session (step 4) — instant sellable map of what an NPC party explored.
   - **Author from GM fog**: GM explores the area with any token (or reveals it however they like), then "Save my current fog as Map item" — snapshots the GM's own FogExploration.
   - **Partial reveal**: GM draws Regions over the parts the map shows and bakes them into a bitmap (render region polygons into a render texture — same compositing helper). "The merchant's map shows the first two halls but the ink is water-damaged past the stairs."

### Why documents-around-the-engine instead of replacing FogManager

A custom `CONFIG.Canvas.fogManager` subclass that loads/saves directly against Map items was considered and rejected for v1:

- Core's load/save/commit pipeline is private-field-heavy; a faithful reimplementation would fork ~600 lines that Foundry actively refactors (v13→v14 rewrote this file substantially: levels, SHARED mode, share sockets).
- Per-user FogExploration + SHARED union already solves multi-client consistency, throttling, texture formats, and resume-after-tab-sleep. Our approach keeps all of it: we only (a) reset documents at session boundaries, (b) copy union → item flag as archive, (c) copy item flag → documents on anchor.
- Everything we touch is stable public API: FogExploration CRUD (GMs may update any user's), `canvas.fog.load({preserve})`, `canvas.fog.reset()`, scene `fog.mode`, module sockets, PIXI compositing.

The one subclass worth shipping: overriding `_unionizeSharedExploration` to also union **anchored map items** at load time would make anchors self-healing after fog resets — noted as Phase 3 polish, not required.

### Failure modes & mitigations

- **Texture size drift**: fog textures are sized per scene dimensions; archived bitmaps must be composited with the scene's `sceneX/sceneY` offset like core does (`#renderTransform`), and re-anchoring after a scene resize may misalign — store scene dimensions in the flag and warn on mismatch.
- **Base64 weight**: fog webp payloads are typically tens of KB; storing one per Map item in item flags is the same load the core DB already bears per user. Cap archive frequency to the turn tick.
- **v13**: no SHARED mode, no `fog.mode`, different private internals. The map system should require **v14+** (feature-gate: `CONST.FOG_EXPLORATION_MODES` exists); v13 keeps today's behavior (mapper-gated on/off).
- **Non-party vision sources** on the scene (familiar, second party) pollute the session union in SHARED mode. Document it; Judge manages exceptions.
- **No GM online**: sessions can't start/archive — consistent with the module's existing "automation runs on the active GM client" rule.

### Map quality: fuzzing measurement without a proficient mapper

The VTT renders explored geometry pixel-perfectly, which silently hands every party the benefits of a proficient mapper ("reasonably accurate measurements", RR p. 264). Two complementary mitigations, verified against the v14.364 source:

1. **Fuzzed ruler labels (implementable today, independent of Map items).**
   Both measurement surfaces are swappable classes with a documented protected
   override for label content:
   - `CONFIG.Canvas.rulerClass` (`foundry.canvas.interaction.Ruler`) — the ruler tool;
   - `CONFIG.Token.rulerClass` (`...placeables.tokens.TokenRuler`) — drag-measurement labels;
   - both build their waypoint labels via `_getWaypointLabelContext(waypoint, state)` and render them through `WAYPOINT_LABEL_TEMPLATE` — subclass, call super, and rewrite the distance fields before render.
   Rules: applies to **non-GM users only**, on scenes where the active formation's mapper lacks Mapping proficiency (no mapper at all → labels could read "?" outright). The error must be **deterministic** so players can't re-measure and average it out: a per-scene multiplier seeded from a hidden salt (e.g. hash(sceneId + salt) → ×0.75–1.3), applied to all displayed distances and rounded to the grid increment, optionally displayed as "~90'". GM always sees true numbers.
   *Honest caveat:* players can still count grid squares against the map art — label fuzzing is a deterrent and a mood-setter, not information security. Pairing it with hiding grid highlighting on drag (same subclass) tightens it further, but the canvas geometry itself cannot lie.

2. **Distorted map records (the RAW-faithful version; belongs to Phase 3).**
   While exploring, the party is *looking at the dungeon* — their live view is rightly exact. What an unproficient mapper corrupts is the **record**. In the Map-item system this falls out naturally: when a session's exploration is archived into a Map item by an unproficient mapper, warp the stored bitmap (small random scale/shear/offset per archive, seeded per item). The map looks right in hand, but **re-anchoring it later misaligns** — corridors are shorter or longer than the map claims, forcing re-exploration at the edges, exactly the tabletop failure mode. Proficient mappers archive clean bitmaps; the Judge's secret error-detection throw (RR p. 264) maps to a chance of archiving clean anyway.

### Implementation phases

| Phase | Scope | Size |
|---|---|---|
| 1 | Session lifecycle: force SHARED while mapping, "New map" button (fog reset + item create), archive union → item on turn tick & session close | the core loop; formation window UI + compositing helper + module socket |
| 2 | Anchoring: "Anchor/Unanchor" on held Map items (composite into FogExplorations + client reload), loot/trade just works | medium |
| 3 | Authoring tools: "Save my fog as map", bake-Regions-to-map (partial reveals), auto-suggest anchor when standing in a held map's explored pixels | nice-to-have |

---

## 4. Shipped in this release (housekeeping)

- **Member ownership → party vision**: every player owning a member actor is granted OWNER on the party actor (recomputed on membership and ownership changes), so they see through — and can move — the party token while their character is inside. The old grant-everyone setting remains as a coarse override, now default-off.
- **v14 fog compatibility**: fog gating now writes `fog.mode` (v14) vs `fog.exploration` (v13); previously the v14 write failed schema validation. "No mapper" is now correctly *not recorded*, not merely hidden, and scenes whose fog the GM already disabled are left untouched.
