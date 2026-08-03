# Library — Design Model

acks-lib is the family's shared-primitives library (`library: true`). It ships
**no sheets and no world data** — it exposes vocabulary + DataModel field-
builders that consumer modules assemble into their own models.

- **Reuse**: the `acks` system's damage/save vocabulary and (via the core-
  deferral shim `game.acks?.lib`) any surface later upstreamed into core.
- **Extend**: the shared ACKS effect/ability vocabulary (`scripts/vocab.mjs`)
  and its DataModel field-builders (`scripts/fields.mjs`) — the target both
  acks-abilities and (deferred) acks-monsters build their models from.
- **Enhance**: nothing yet — the FAMILY.md §3 plumbing (tables registry, socket
  relay, effects collector, economy data) is deliberately **out of v0.1 scope**
  and remains the family-refactor Phase 1 backlog.
- **Invent**: `LevelValue` — the level-scaling value type + its resolver — the
  one genuinely new primitive, spanning thief skills, per-level throws, and
  attack/save progressions.

## Perception: senses, light, and the token

Three files answer "what can this creature see, and how brightly does it burn?"
for every actor in the family — a lone monster, a party member, a detached
scout. They live here rather than in a feature because more than one asks.

| File | Owns |
|---|---|
| `scripts/senses.mjs` | Reading ACKS senses off the sheet, and what each grants. |
| `scripts/perception.mjs` | What those senses ARE to Foundry: vision modes, detection modes, and the two status effects the rules need. |
| `scripts/light.mjs` | The RR light table, and which record holds a given actor's lights. |
| `scripts/token-sync.mjs` | The guarded writes that put any of it on a token. |

**Sense resolution** runs in one precedence order, so the movement rules and the
canvas can never disagree: the Full Monster Sheet stat block
(`flags["acks-extras"].extras`), then a `kw:lightlessvision` capability, then
item and active-effect names. `canSeeInDark` (the ⅓-speed blinded rule) and
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
| Lightless Vision | its recorded range (MM default 60') | `…Lightless` | `…LightlessVision` (SIGHT) |
| Shadowy senses | 30' | `…Shadowy` | `…ShadowySenses` (SOUND) |
| Echolocation | its recorded range | `…Echolocation` | `…Echolocation` (SOUND) |
| Mechanoreception, terrestrial | its recorded range | `…Echolocation` | core `feelTremor` (MOVE) |
| Mechanoreception, other | its recorded range | `…Echolocation` | `…Mechanoreception` (MOVE) |
| Blind | its best sense range, else 30' | that sense's | that sense's |
| Night Vision | 0 | `…Night` | core's own |

A creature looks through its **longest** sense and detects with **all** of them,
each at its own range.

### Why the detection modes matter

A radius alone makes every sense behave like eyes, which is wrong in ways that
decide encounters. `DetectionMode.type` is what fixes it: core's own `_canDetect`
defeats only SIGHT modes with the Blind status and with an invisible target, and
defeats only *wall-respecting* modes with magical darkness. So:

- **Echolocation** (SOUND, walls) finds an invisible creature and works inside a
  *darkness* spell — its `_canDetect` deliberately skips core's darkness bail,
  which is keyed to walls rather than to type — but deafness and silence stop it.
- **Shadowy senses** (SOUND, walls) survive blindness and invisibility, and stop
  dead while deafened, silenced, running, or in magical darkness.
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
with the canvas — a deafened thief takes the blinded ⅓-speed penalty. Conditions
that depend on the *target*, or on where the perceiver is standing, cannot be
precomputed and live in `_canDetect` instead.

Core ships `blind`, `deaf`, `silence` and `invisible`. It has no notion of
running or of hiding, so this module registers **Hiding** and **Running** as
status effects. Both are deliberately toggles: whether a character is running
flat out this round, or has gone to ground, is a declaration, not something to
infer from a token's position.

**Light ownership is exclusive.** An actor in a formation takes its lights from
that formation's record (which tracks fuel, shutters and burn-down); only an
actor in no formation reads its own `flags["acks-extras"].lights`. Reading both
would let a member carry two contradictory torches. lib asks the formation
through `globalThis.acksExtras.formation.lightsForBearer`, which returns `null`
— not `[]` — for a non-member, because that is the difference between "carrying
nothing" and "not a member".

**Overrides are respected, differently for each write.** A light is only ever
cleared if we set it (`managedLight`). Vision cannot be that shy — the whole
point is to overwrite the system's stock `sight.range: 60` on every monster — so
it stamps what it wrote (`managedVision`) and compares before writing again; a
token whose sight no longer matches the stamp was edited by a human and is
handed back permanently. `manageVision` is the world-level off switch.
