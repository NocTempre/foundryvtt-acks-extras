# Light sensitivity: a penalty while caught in daylight (in flight)

Built on `topic/light-sensitivity`. Owner, 2026-11-15, asked whether to build
the light-sensitivity penalty next: "Yes, build it". The daylight band it reads
is lib DECISIONS 2026-11-15, "A magic light can state a daylight radius".
Delete this file when the work lands; its substance moves to lib
MODEL/DECISIONS/ROADMAP/TESTING and importer MODEL/DECISIONS.

## Ruling (architect, 2026-11-16)

**Sources.** MM prints a penalty in daylight on two creature entries (one to
attack throws; one to attack throws, proficiency throws and morale), and MM
ch. 4 lists the generic disability. Characters can carry one too (RR ch. 2, a
class weakness; JJ ch. 12, a custom power; JJ ch. 15; RR App. C). The penalty
size is printed per source: it is imported or Judge-typed, never shipped.

**Representation.** A typed `modifier` row with
`gate: {kind: "light", light: "daylight"}`, read at the roll on any actor.
`registerGate(kind, fn, {at: "roll"})` marks a roll gate; `modifierDisposition`
returns AT_ROLL `{reason: "gate"}` for one (unless the target is consumed), so
the loadout never writes the row and a monster's chip reads "at the roll". The
evaluator answers null without `ctx.token`. Monsters are reached because their
stat line prints the throw and the prose the conditional penalty apart. The
typed-modifiers header's "characters only" narrows to standing modifiers.
Rejected: a monster-only field (a second schema for the character sources); a
scope field (scope ctx describes the opponent; light describes the roller).

**Reader** (`lib/light.mjs`):
`lightLevelAt(scene, point, {extra, daylit}) → {level, by} | null`, level
`daylight|bright|dim|dark`; `lightLevelOf(tokenDoc, opts)`.
- Scene daylight: `environment.globalLight.enabled`, darkness inside
  `globalLight.darkness`, darkness < 0.5; a point inside a Region flagged
  `cookbook.indoors` is not under the sky (`RegionDocument#testPoint`).
  `daylit` lets a journey clock override.
- Daylight from a light: each token's `shedLight(actor).daylight` in scene
  units; column points carry `daylight` and `dim`.
- Bright and dim: `strongestReach` taking a band. Walls ignored. No scene or
  point: null, not applied.

**Value.** Importer: `compileMonster` passes `entry.effects` (as
`compileDefinition` does); `effects` recipes on the two register rows with
`onMiss: "blank"` and condition label "in some light"; `bindMonster` binds
recipe-origin effects onto one embedded `ability` item carrying the cite.
Judge: the row editor gets a `gate.light` select. A blank value is skipped.

**This slice: attack throws only.** Core's dialog shows label and value, so the
page reference rides the label: `{name} · {level} (cite)`. ROADMAP: saves,
proficiency throws and morale reading the gate; an ambient light's daylight
band; "clear" weather; walls; daylight's other consequences; the sheet's throw.

Owner question (default yes): does a magic daylight band count for a penalty
printed "in sunlight"?

## Slices (each an `implementer`: scope fixed by this ruling)

1. Reader, `fields.mjs` gate `light: choice(LIGHT_LEVELS)`, roll gates in
   `typed-modifiers.mjs`, attacker token on the attack ctx
   (`patches/attack-throw.mjs`), a `lib/roll-gates.mjs` contributor beside
   `installConditionRolls`, column points carrying daylight/dim. Tests:
   `test-lib.mjs`, `test-typed-modifiers.mjs`.
2. Row editor `gate.light` select and `mergeRowEdit`; its test.
3. Importer passthrough, register recipes, `monster.mjs` binding; tests on
   invented prose in `tools/importer/test-executor.mjs`.
4. Optional: an AmbientLight daylight flag.

## Results

(appended per slice)
