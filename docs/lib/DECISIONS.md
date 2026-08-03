# Shared library — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

- **2026-07-18 — v0.1 scope is effect/ability primitives only.** Created ahead
  of the full family-refactor Phase 1 to unblock the abilities program (see the
  program memory + template REFACTOR_PLAN.md status note). The plumbing/interop
  contracts stay pending; this lib is additive to that plan, not a divergence.
- **The shared vocabulary has one definition here** (DAMAGE / MOVEMENT / VISION
  / SENSE / NATURAL_WEAPONS / ALIGNMENTS). These began as a value-identical
  mirror of the monster feature's own enums while it was a separate published
  module; that mirror is **resolved** — `monsters/config.mjs` now re-exports
  from `lib/vocab.mjs`, so its consumers keep one import path and no second copy
  exists. `NATURAL_WEAPONS` here is the superset, carrying the monster sheet's
  sting / feeler / envelopment.
- **Foundry-free split:** `vocab.mjs` (enums + resolver) imports in Node so the
  acks-content cookbook compiler/executor share one definition; `fields.mjs`
  (Foundry field-builders) is lazy so the module still evaluates under Node.

- **Storage lands in the library, keyed on a flag rather than a type**
  (2026-08-01): "goods kept somewhere other than on you" is the primitive under
  markets, banks, base camps and wagons, and the standing promotion rule names
  stash handling as shared machinery. Two consequences were chosen deliberately.
  (1) **Stored goods are real embedded items on the holding actor**, not a
  ledger: an item that has left the character genuinely weighs nothing on them,
  and every existing reader of `actor.items` sees a location's stock without
  being taught anything. (2) **A provider is any actor with
  `flags.acks-extras.storage.provider`** — the library never names a location
  type, so a settlement, a market actor and a future cart are the same
  machinery, and enabling storage on one is a flag write. The UI, the actor type
  and the lifecycle around it belong to the location feature; only the
  primitives are here. Attribution (`ownerUuid`) is a UI convention, not a
  security boundary — the same ruling the equipment feature makes for containers.
- **The template actor is a generator, never a bulk import** (2026-07-24):
  the book statting a creature as tables (dragon: 11 ages x 9 types x 4 body
  forms) is the book saying "make one when you need one". Materializing the
  cross product would be hundreds of near-duplicate actors; the template +
  builder honors the book procedure instead, and a dropped base actor makes
  the same document a modifier (vampire thrall).
- **One token publisher** (2026-08-01): the vendored design-system token file
  (`vendor/acks-design/tokens.css`, `:root` + one `.theme-dark` block) is the
  ONLY place `--acks-*` palette values are declared, and it loads
  unconditionally — inert values style nothing by themselves, and every
  dependent module `requires` acks-lib, so consumers read tokens BARE
  (`var(--acks-spot)`, no literal fallback; a fallback masks a missing token,
  which is exactly how `--acks-field` shipped undeclared and rendered white
  boxes on dark seats). Before this, sheet-theme.css pinned ~18 token copies at
  body-class specificity, out-specifying the token file's dark block; the
  vendor layer and the follower card each grew counter-shims, and one card
  rendered FOUR ways across sheet-theme x seat combinations (worst pair
  1.1:1). sheet-theme.css now owns only override RULES for system-rendered
  markup, gated by `body.acks-lib-sheet-theme`; the setting stays the
  whole-client escape hatch. Corollaries: SURFACE vs INK discipline everywhere
  (`background:` takes `--acks-burgundy`, `color:`/`border:` take
  `--acks-spot` — they diverge on dark seats); type sizes come off the
  `--acks-fs-*` scale so the `fontScale` client setting (writes
  `--acks-fs-base` inline on the root element, where the scale steps
  substitute) resizes every ACKS surface with one knob.
- **2026-08-03 — Perception rises to lib; `monochromatic`, not `darkvision`.**
  The sense model, the RR light table and the token writes moved out of the
  formation feature (`monster-traits.mjs`, `formation/constants.mjs`,
  `formation-model.canSeeInDark`) because a second sibling needed them: a
  standalone actor has no formation, and its torch and its infravision have to
  work anyway. `capabilities.mjs` came along for the ride — `senses.mjs` needs
  the `kw:lightlessvision` check and lib may not import a feature — with
  `ability-bridge.mjs` re-exporting so no consumer changed.
  - **Ruled:** dark senses render `monochromatic`. Core's `darkvision` remaps
    DIM to BRIGHT, which would let a creature read a scroll in a black
    corridor; both ACKS senses see only "as dim light", and dim light cannot
    discern colours or read (RULES §4). Rejected `darkvision` for that reason
    and `blindness` for inherently blind creatures — that mode models the
    *blinded condition* and renders black, which would cripple a creature that
    navigates perfectly well by echolocation. A blind creature gets its best
    sense range instead, or 30' when its stat block records none.
  - **Cost:** the first sync overwrites a token the GM configured by hand
    before installing this, because a never-stamped token is indistinguishable
    from a stock one. Accepted: the alternative is leaving every monster pack's
    stock 60' dark sight in place, which is the defect. `managedVision` makes
    it a one-time cost — edit the token once and it is yours forever — and
    `manageVision` turns the whole pass off.
  - **Not done:** `detectionModes` are never written. Core derives
    `basicSight` and `lightPerception` from `sight`
    (`client/documents/token.mjs:541`), so writing them would add a field to
    clobber and buy nothing. Terrestrial mechanoreception could plausibly map
    to core's `feelTremor` instead of a sight radius; kept uniform with the
    other dark senses for now, one rule and one answer.
    — **SUPERSEDED 2026-08-03 (below).** "Buys nothing" was wrong: a radius
    without a detection mode makes every sense behave like eyes.

- **2026-08-03 — Every sense gets its own detection mode; `basicSight` off.**
  The entry above modelled all five ACKS senses as a sight radius. That
  silently gave each of them sight's weaknesses and none of its own: a bat's
  echolocation was defeated by invisibility and by a *darkness* spell, tremor
  could not reach through a floor, and Hiding could not beat infravision — all
  four wrong at the table, and none visible in a screenshot.
  - **Ruled:** `DetectionMode.type` carries the rule. Core's `_canDetect`
    defeats only SIGHT with the Blind status and an invisible target, and only
    wall-respecting modes with magical darkness — so SOUND for echolocation and
    shadowy senses, MOVE for mechanoreception, SIGHT for lightless vision.
    Echolocation overrides the darkness bail (core keys it to `walls`, not to
    type: sound does not care how dark it is). Terrestrial mechanoreception
    reuses core's `feelTremor` rather than inventing a twin.
  - **`basicSight` is disabled wherever a real sense replaces it.** This is the
    load-bearing part and was missed until the live check: core derives that
    mode from `sight.range`, and left on it shadows every specific mode, so the
    hiding thief is seen and the invisible one found regardless. Safe because
    the vision source radius reads `sight.range` itself (`Token#sightRange`),
    so environment vision is untouched.
  - **Source conditions resolve in `senses.mjs`, target conditions in
    `_canDetect`.** Suppressing a sense by rewriting the token costs nothing per
    visibility test and keeps `canSeeInDark` agreeing with the canvas. Only what
    depends on the target, or on where the perceiver stands, can't be
    precomputed.
  - **Cost:** two status effects this module now registers (Hiding, Running),
    because core ships neither. Both are toggles — inferring "is running" from
    token movement would fight the GM every time they repositioned someone.
  - **Rejected:** reusing core's `invisible` for hiding (different rule,
    different detection semantics), and inferring Hiding from `token.hidden`
    (that is the GM's "not on the map yet" switch, not a character's action).

### The item taxonomy is declared over core's types, not invented beside them (2026-08-03)

The system's eight Item sub-types share no base, so "wearable" had no home:
`equipped` is declared on `weapon` and `armor` and nowhere else, and Foundry
prunes off-schema keys, so the whole `acks-clothing` pack and every carrying
device in `acks-adventuring-equipment` were unwearable however they were written.
Three RAW rules were silently inert as a result — the adventurer's harness's
stone of relief (RR p. 142), gloves blocking lockpicking (RR p. 145), and the
worn bucket for clothing on the character sheet.

**Ruled: declare the taxonomy over core's types.** A `GearExtras` flag model
(`flags["acks-extras"].gear`) plus one predicate module, mirroring the ruling the
abilities feature made for `AbilityExtras`.

**Rejected: module-owned `gear`/`wearable` Item sub-types.** They would have a
genuine shared base, at these costs — core's `_prepareItems` is a five-bucket
`switch` with no default, so a module sub-type renders **nowhere** on the
character sheet (and the equipment feature's whole technique is moving core's own
rows into wear buckets); `computeEncumbrance` sums `item`/`weapon`/`armor` by
name, so it would weigh nothing; core's inventory template draws the equip toggle
in the weapons and armours sections only; and every existing world, both core
gear packs, the importer and acks-content produce core types, so adopting them
means a destructive per-document `type` rewrite. That is the "invent" tier for
something the system provides badly rather than not at all.

**Equippable is derived, not tagged.** `slots.length > 0` *is* the tag. A boolean
sitting beside a slot list can disagree with it; one field cannot disagree with
itself. Rations, loot and coin declare no slots and get the wear features
switched off without a flag saying so.

**`declaresSlots` is a third state, and it was needed.** "Declared to sit
nowhere" and "never annotated" both leave `slotsOf` empty, but they must behave
differently: every name-heuristic fallback gates on `declaresSlots`, so a Judge
who sets a Great Helm to sit nowhere is not overruled by its name.

**Cost:** the slot for 143 core pack items is inferred, not read — the books
assign no slots. Accepted deliberately (owner: "a bad guess with a dropdown to
select/correct is fine") because the Treasure Tome makes a slot's only mechanical
job exclusivity, so a wrong guess mis-scopes that and nothing else. The item
sheet's Construction tab carries the correction.

**Deferred, against the original plan:** container `capacity` and the clothing
`layer` were to move into `GearExtras`. They did not. `capacity` belongs with
`locked`/`fragile` in the container record — splitting one coherent record across
two flags would create the duplication rather than remove it — and `layer` has a
single reader and no second copy to collapse. Neither move would have removed a
duplicate; both would have cost a data migration.
