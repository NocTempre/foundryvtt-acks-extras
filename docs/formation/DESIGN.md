# acks-formation — Architecture

Follows the conventions of `acks-influence` (ApplicationV2 + HandlebarsApplicationMixin, Foundry v13/v14, `acks` system).

## Libraries

Rather than recreate core infrastructure, the module leans on community libraries instead of hand-rolled equivalents.

**Required** (`relationships.requires`) — the module cannot run without them:

- **libWrapper** — wraps the ruler classes' `_getWaypointLabelContext` (`measure-fuzz.mjs`) so it composes with other ruler modules instead of clobbering the class.
- **socketlib** — all cross-client messaging (`socket.mjs`): named handlers with GM routing for player action requests and fog reloads.

**Recommended** (`relationships.recommends`) — optional, degrades gracefully:

- **simple-timekeeping** — a front-end for the world clock, calendar, and scene-darkness sync. Dungeon turns feed it through the standard `game.time.advance` contract, so it needs no integration code: with it installed you get the calendar UI and time-of-day darkness; without it, turns still advance core world time and the module is unaffected. The module only *reads* scene darkness (`isPartyInDark`), never writes it, so the two never fight over darkness.
- **acks-monsters** — the Full Monster Sheet stores a creature's real vision modes, special senses, and multi-row Speed table. `scripts/monster-traits.mjs` reads that structured data (the raw `flags["acks-monsters"].extras`, so it works even when the module is inactive) so a monster party member's dark sight and exploration pace come from its stat block rather than human defaults — see below. Without it, actors fall back to ability/effect name matching and the system encumbrance speed.

### Monster senses & movement

For monsters carrying an acks-monsters stat block, `canSeeInDark` and `explorationSpeedOf` defer to `monster-traits.mjs` instead of the generic heuristics:

- **Dark operation** is authoritative from `extras.vision` + `extras.otherSenses`. Only modes that function in *total* darkness count: **Lightless Vision** and **Blind** navigation, plus **Echolocation** and the **Mechanoreception** senses (their "sight" reads as dim light). **Night Vision is excluded** — it upgrades dim light but fails in total dark, the exact human assumption this fixes. Acute hearing/olfaction/vision only aid surprise and never defeat darkness.
- **Exploration speed** is the *running* value of the creature's land Speed row (ACKS records speed as `[combat] / [exploration = running]`); a purely aquatic/aerial creature falls back to its primary row. Blinded creatures still take the 1/3-speed dark penalty unless one of the dark senses above applies.

## Files

| File | Responsibility |
|---|---|
| `scripts/constants.mjs` | Rules constants (turn length, rest interval, light sources, roles, speed tiers). |
| `scripts/formation-model.mjs` | Formation records: storage (world setting `acks-formation.formations`), membership, party actor/token lifecycle, marching order, derived speeds. |
| `scripts/turn-engine.mjs` | Dungeon-turn tick: world time, lights, rest/winded, effect expiry, wandering-monster throws, rations, movement→turn conversion, chat cards. |
| `scripts/formation-app.mjs` | The formation window (GM controls, player read-only). |
| `scripts/encounter-zone.mjs` | `acks-formation.encounterZone` RegionBehavior subtype (table UUID + cadence overrides) and point-in-region lookup for the party token (core `testPoint` when available, manual shape math as a headless fallback). |
| `scripts/scene-sync.mjs` | Mapper-gated fog (`scene.fog.exploration`, original value stashed in a scene flag) and party-token light emission mirroring lit sources. Reconciled by the primary GM after every formation change (idempotent, compare-before-write). |
| `scripts/socket.mjs` | socketlib registration (`socketlib.ready`) and a queue so handlers can register at import time; exposes `getSocket`/`registerHandler`. |
| `scripts/module.mjs` | Settings, hooks, scene-control button, `/formation` chat command, public API. |

## Data flow

- **State** lives in one world setting (`formations`, keyed by id — see the shape documented at the top of `formation-model.mjs`). Only GM clients write it; the `updateSetting` hook re-renders the window on every client.
- **Marching order** = order of `members[]`. Roles are per-member string arrays.
- **Member tokens** are stashed as raw `toObject()` snapshots in `members[].tokenData` when the actor joins, and re-created around the party token on removal/disband.
- The **party token** belongs to a dedicated `monster`-type actor (one per formation) whose `system.movement.base` mirrors the party's exploration speed (min over members' `system.movementacks.exploration`, which the acks system derives from encumbrance). `updateActor`/`create|update|deleteItem` hooks keep it in sync.

## Movement → turns

`updateToken` (x/y change on a token flagged with `acks-formation.formationId`) is processed **only on the active GM client** (`game.users.activeGM.isSelf`), no matter who dragged the token. Distance = straight-line pixels → feet via the scene grid; accumulated in `clock.carryFeet`; each full exploration-speed's worth pops one call to `advanceTurns`. `clock.lastPosition` anchors measurement (re-anchored when tracking is un-paused, seeded at party-token creation).

## Turn tick (`advanceTurns`)

Per turn, in order (mirrors JJ sequence of play step 5):

1. `game.time.advance(600)` (setting-gated) — snapshot member effects with `duration.remaining > 0` beforehand, report the ones that hit ≤ 0 after.
2. Rest counter (or reset when `resting`); winded at `> 5` turns; marker Active Effect applied/removed on members (Endurance-proficient members skipped, matched by item name).
3. Lit lights `remaining--`, guttering warning at 1, burnout at 0.
4. Encounter counter; every N turns roll 1d6 vs target, whispered to GMs; on encounter, pre-roll 2d6×10 distance and 1d10 minute-of-turn, then draw privately from the resolved RollTable. Parameters resolve zone → formation → world settings: an `encounterZone` region behavior under the party token overrides frequency/target (0 = inherit) and supplies a table UUID; else the formation's `tableId`; else announce-only.
5. Day boundary (144 turns) → ration reminder.
6. Persist + chat summary card (public or GM-only per setting).

## The player surface (v0.22)

One sheet, two capability tiers — never two UIs. Formation state lives in a
world setting only GMs can write, so every player mutation is a **declaration**:
relayed over socketlib to the active GM client, which validates ownership
against the *passed user id* (never the requesting client's say-so) and
executes. Players act on what is THEIRS:

| Surface | Player capability | Route |
|---|---|---|
| Marching order | Move their own character (up/down/left/right; target recomputed GM-side from the actor id, not the click's stale cell) | `reorder` |
| Roles | Take up / set down roles on their own character (10'-pole item gate enforced GM-side) | `role` |
| Lights | Douse/relight and shutter lights their character carries; add via the declaration panel | `lightToggle` / `lightShield` / `light` |
| Spells | See all tracked spells; add their own via the declaration panel | `spell` |
| Maps | See the party's maps and session status; consult (anchor) a map their character holds | `anchorMap` |
| Checks & rest | Declare listen/search/bash/track and rest turns | `check` / `rest` |

Judge secrets never reach a player's DOM: map `quality`/`distorted` and the
mapper's proficiency exist only in the GM render context — a warped map must
be indistinguishable from an accurate one to its holders. Removals, blanks,
frontage, the clock, saves, tables, and session lifecycle stay GM-only.
Role and light declarations are announced publicly, so the table sees who
changed the party's posture.

## Deliberate non-features (v0.1)

- Combat rounds are not auto-counted toward rest (10 rounds = 1 turn); the GM uses the manual Turn button after fights.
- ~~No socket layer: players never mutate formation state directly~~ — superseded: socketlib relays player declarations (see *The player surface*); token drags are still processed by the GM client's hook.
- Waypointed drags are measured start→end as a straight line.
- The wandering-monster *tables* (which monster appears) are not rolled — dungeon-specific tables belong to the Judge; we roll the throw, distance, and minute only.

## Ideas for later

Superseded by [ROADMAP.md](ROADMAP.md), which tracks the full rules gap analysis and
the phased mapping plan ([FOG-DESIGN.md](FOG-DESIGN.md)). Combat-round counting
shipped in v0.4.0 (on combat end, 10 rounds = 1 turn with carry).
