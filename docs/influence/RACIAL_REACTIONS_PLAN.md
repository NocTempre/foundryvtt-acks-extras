# Racial & Cross-Species Reactions — Implementation Plan

> ✅ **IMPLEMENTED 2026-07-16** (scripts/racial.mjs + roller integration +
> compendium items + settings). This document is retained as the design
> record; see README "Racial & cross-species reactions" for usage. Deltas from
> the plan: the BTA caste effects ship gated by the `enableBtaCaste` world
> setting (default on, per user request); the relations row renders as its own
> "Racial relations" group rather than inside "Both".

Rules basis: `ACKS-Reactions-Reference.md` §6 (racial & cross-species
reactions). Design decisions confirmed 2026-07-16:

1. **Strict RAW** — no invented human/elf/dwarf penalty (none exists in core;
   see §6.1). Ship only cited mechanics: Inhumanity tiers, BTA optional caste
   effects, type-scoped powers, hard-hatred RAW notes.
2. **Campaign relations registry** — a hook/setting where a campaign can
   register its own "inhumanity between races" matrix that then auto-applies.
   Entries **need not be symmetric** (dwarf→elf may differ from elf→dwarf).
3. Implementation waits until the external-modes session commits.

---

## A. Actor race / kind typing

New helpers in `actor-data.mjs`:

- `kindOf(actor)` → `{ race, categories: Set<string> }`
  - **Characters**: reuse the existing class-name → race inference (the age
    table already does this); a human fighter → `{race: "human",
    categories: {"human"}}`, an elven spellsword → `{race: "elf",
    categories: {"elf", "demi-human"}}`, dwarf → `{"dwarf", "demi-human"}`.
  - **Monsters with acks-monsters**: read
    `flags.acks-monsters.extras.types` (Set: animal, beastman, construct,
    enchanted, giant, humanoid, incarnation, monstrosity, ooze, plant,
    undead, vermin) plus `.subtype` (free text, e.g. "goblin") — categories
    become the type tokens + normalized subtype token.
  - **Fallback**: name/class regex, else empty set (UI shows "unknown").
- Tokens are lowercase slugs. The matching vocabulary is open — any token an
  effect's `vs` list names can match any token an actor's categories carry.

**UI**: an auto-populated, overridable "Target kind" row in the roller
(comma-list text input with the wand badge, like other autos). Masked when the
target is hidden (GM-relay path resolves with real values). Influencer race
shown read-only next to the portrait.

## B. `vs` effect flag (target-scoped modifiers)

Extend the reaction-effect convention (`flags.acks-influence.*`):

- `vs: "human,demi-human"` — comma-list of kind tokens. The modifier
  **auto-activates** when any token matches the target's categories, and
  auto-deactivates (still manually toggleable) when typing is known and
  doesn't match. When target typing is unknown, it renders as a situational
  checkbox with the vs-list in its label.
- Composes with existing flags (`tone`, `situational`, `alignmentSign`,
  `bewitched`, `actsAs`, `label`). `alignmentSign` keeps handling
  Chaotic/Lawful scoping (Ancient Pacts, Deathly Visage); `vs` handles
  species/type scoping. Both may appear on one change (e.g. "intelligent
  Chaotic monsters" = `vs: "monster"` + `alignmentSign: "chaos"` — see D).
- Paired-sign powers (Inhumanity) are expressed as **two changes** on one
  effect: `-N` with `vs: "human,demi-human"` and `+N` with `vs: "<kin>"`.

## C. Campaign race-relations registry (asymmetric)

Two entry points, one store:

- **World setting** `acks-influence.raceRelations` (GM-editable JSON):
  `[{ "from": "dwarf", "to": "elf", "value": -1, "label": "Grudge of the
  Vaults" }, …]` — `from` = influencer race/category, `to` = target
  race/category, **directional** (no implied symmetry).
- **API**: `api.registerRaceRelations(relations, {source})` for modules to
  contribute rows at ready-time (e.g. a setting module). Registered rows merge
  with the world setting; setting rows win on exact `from`+`to` collision.
- The roller resolves `relationFor(influencerKind, targetKind)` by best match
  (exact race token first, then category token), applies it as an
  auto-populated, overridable "Racial relations" modifier row on **all tones**,
  and — because RAW Inhumanity hits loyalty and morale — the same lookup feeds
  the **hiring** and **loyalty** external modes.
- Chat card lists the applied relation with its label.

## D. Compendium additions (all RAW, via the effect convention)

> **Superseded 2026-07-19.** These items shipped as designed, then stopped
> shipping in 0.10.0 — the lib/abilities/content path replaces them (see
> `SOCIAL_ROLLS_AUDIT.md` §6.1). The **effect structures** below are still the
> canonical design; only the shipped items are gone. Reference copies are kept
> at `acks-rules/acks-influence/compendium-reference/`.

| Item | Changes | Notes |
|---|---|---|
| Inhumanity 1..4 (four items) | `−N vs human,demi-human` + `+N vs <kin>` | kin defaults to `lizardman` (Thrassian exemplar); GMs duplicate + retoken for other races. Loyalty/morale applicability noted in description. |
| Highborn Caste (BTA, optional) | `+1 vs dwarf` (+2 own-clan as situational) | description flags BTA p.56 optional rule |
| Oathsworn/Craftborn/Workborn Caste (BTA, optional) | `+1 vs dwarf` situational (own clan only) | |
| Houseless (BTA, optional) | `−2 vs dwarf` | |
| Ancient Pacts (upgrade existing) | add `vs: "monster"` alongside `alignmentSign: chaos` | darklord/sorcerer +2 variant added |
| Beast Friendship / Animal Husbandry (upgrade) | add `vs: "animal"` | auto-activates from monster typing |
| Dragon Incarnate Voice (BCK) | `+2` all tones, bewitched-style 12+ charm kicker | WIS>CHA immunity is a RAW chat note |
| Troll-Blood Stench (BTA) | `−2 vs` everything except troll kin — implement as `−2` default-on with note | |

**Hard hatreds** (MM): when influencer/target kinds match a known pair
(dwarf↔goblin sentries, gnome↔kobold), the roller does **not** force a result —
it adds a RAW note to the chat card quoting the automatic-Hostile rule, per the
no-inventions policy.

## E. Hiring / loyalty integration

- The hiring mode already includes effect mods; `vs`-scoped effects match
  against the **candidate** actor's kind.
- Loyalty mode: race relations + Inhumanity apply (RAW: "reactions, loyalty,
  and morale"). Morale consumers (acks-henchmen) can read the same effects via
  the exported helpers; kind-matching helper exported on the api
  (`api.kindOf`, `api.relationFor`).

## F. Out of scope

- No automation of caste *clan* identity (own-clan bonuses stay situational
  checkboxes — the data model has no clan field).
- No forced auto-Hostile results (notes only).
- Slavery, liberation, and troop-scale racial availability stay in
  acks-henchmen.
