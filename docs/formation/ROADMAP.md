# Roadmap & Rules Gap Analysis

Status of every rule in the local rules extract (`acks-rules/acks-formation/RULES.md`, kept outside the repo) against the module as of **v0.4.0**, the refreshed plan for the **map-object fog system** ([FOG.md](FOG.md)), and — per the campaign requirements — the rules that need **additional development** (or additional rules text we don't yet have) to implement properly.

Legend: ✅ automated · 🟡 partial / assisted · 🔧 needs development · 📖 needs rules text not in the three source PDFs

---

## 1. Where v0.4.0 stands (rules-extract coverage)

| Rules area (extract §) | Status | Notes / what's missing |
|---|---|---|
| Turns & rounds, 6 turns/hour (§1) | ✅ | Movement-driven ticks, manual Turn/Rest, world-time advance, combat rounds → turns (10:1) with carry. |
| Speeds by encumbrance (§2) | ✅ | Party speed = slowest member, live from system encumbrance. |
| Running fatigue, winded from running (§2) | 🔧 | Only the 5-turns-without-rest winded is automated. Per-round running fatigue (Paralysis save after 10±CON rounds, Endurance +4) is a combat-scale rule — needs a combat-round hook + save automation. Low priority; fights rarely last 10 rounds. |
| Marching order & roles (§3) | ✅ | Ordered list, Scout/Mapper/Pole/Rear Guard/Non-combatant chips. |
| Corridor-width formation (single file ≤5', two abreast ≥6') (§3) | 🔧 | Not modeled. Could be a formation "frontage" toggle that only matters once trap/encounter victim selection (below) exists. |
| Mapper: bright light, both hands, **vulnerable** (§3.1) | 🟡 | Light requirement drives fog. **Hands are now real**: the role needs a quill and parchment (`ROLE_GEAR`) and each piece occupies a hand in the equipment loadout, so a mapper cannot also hold a drawn weapon. v0.5.0 warns when the mapper lacks the Mapping proficiency (vague measurements, no passive error detection). Only *vulnerable* is still a reminder — auto-applying the Active Effect needs 📖 the Conditions rules (RR p. 514). |
| Mapping proficiency (secret error-detection throw) (§3.1) | 🔧 | **Unblocked 2026-08-16** — the proficiency text is now in the local extract (`acks-rules/acks-formation/PROFICIENCIES.md`), which states the throw: one turn and an 11+ to interpret a layout, map from memory, or notice an irregularity in one's own map. What is still missing is development, not text: a "map error" concept, which is only meaningful now the map-object system exists (an unproficient mapper's Map item could get GM-injected distortions). |
| Light sources & burnout (§4) | ✅ | Burn clock, guttering, inventory consumption, token light emission. |
| Shadowy senses / lightless vision (§4) | ✅ | Both now reach the TOKEN: sight derived from the sheet by the lib subsystem `senses.mjs` (shadowy 30', lightless its recorded range, both as dim monochrome; ordinary eyes range 0, seeing only what is lit). Applies to any actor, in a party or not. Mapping still requires bright light, so the mapper gating is unchanged — RAW, senses cannot do bright-light tasks. |
| Searching & listening throws (§5) | ✅ (v0.5.0) | Party-roll buttons (Listen / Hasty Search / Methodical Search / Bash Door) roll every member using **their sheet's numbers** — a matching ability item's rollTarget (thief skills) first, else the sheet's Adventuring target — GM-whispered as one card. RAW enforced: hasty search skill-only, methodical +4 for skill users and auto-consumes 1 turn, listening once per turn while moving, bashing ±4×STR. |
| Earshot / noise (§5) | 📖 tables captured; automation impractical (Judge adjudication). |
| Doors: bash/pick/batter procedures (§6) | ✅ (4.2.0) | Door helper on the Walls layer: the bash throw shown BEFORE it is rolled and broken into its parts (±4/STR, +4 for a pair on the stronger adjustment, +2 crowbar, ±8 per size step), an unwinnable throw named as such, batter-down turns by construction, and SPIKES as real state — one round each, four maximum, -4 to force per spike after the first, torn out when the door is forced. Published on `api.formation.doors`. |
| Traps: trigger 1d6, pole probing, disarm throws (§7) | ✅ (4.9.0) | The whole of §7. A trap is an Item; a Trap Zone region or a wall's trap layer places one. Searchers throw first (§9.3), then the pole 5' ahead of its bearer, then the party on the secret 1d6 — victims by marching order, or by area. Hasty/Methodical Trapbreaking with their botch bands, disarm-or-discharge, re-arming, and the repeat lock. The printed traps arrive through `acks-importer`, which imports their construction cost but not yet their mechanics (scoped in that repo's roadmap, 2026-08-16). |
| Rest & winded (§8) | ✅ | Includes Endurance exemption and combat rounds counting. |
| Sequence of play (§9) | ✅/🟡 | Steps 1, 5 automated; steps 2–4 (stationary actions, traps, deliberate encounters) are GM-driven with helpers. |
| Wandering monsters: throw, distance, minute (§10) | ✅ | Zone-keyed cadence/targets/tables; private table draws. |
| Wandering monsters: number ±50% per level step, reaction modifier by level difference (§10) | ✅ (4.2.0) | The Encounter Zone carries a **dungeon level**, a table carries its **monster level** in a flag, and the draw is post-processed: number appearing ×1.5 per step deeper (×0.5 per step shallower, rounding up) and an equal, opposite reaction modifier, rolled and whispered. Nothing scales unless BOTH levels are set. |
| Surprise & encounter procedure (§10.4–5) | 📖🔧 | **These are two items, and only one is still blocked.** The REACTION half is extracted — `acks-rules/acks-influence/ACKS-Reactions-Reference.md` carries the 2d6 roll, the attitude ladder, the relationship modifier and the exhaustive modifier tables — and it belongs to the influence feature, which owns reactions. SURPRISE is what is still missing (party surprise roll vs monster, light-source penalties, the p. 266 noise interaction); the proficiency extract has only the bonuses that modify it (Alertness +1, Attunement to Nature +1 in wilderness), never the procedure they modify. Supply that and this becomes automatable. |
| Spelunking, squeezing, swimming, jumping (§11–12) | ✅ (4.2.0) | Obstacle helper over the Spelunking table: six obstacle kinds, each with its own permission (Adventuring 8+ or a real climbing proficiency), failure cost (a round, or a fall), botch row and vulnerability. Members who may NOT attempt are reported before anyone rolls. A fixed rope or supervising mountaineer turns a sheer face into an easy climb. One throw per 100'. Published on `api.formation.obstacles`. Swimming is now its own derivation (`swimming.mjs`, published on `api.formation.swimming`) because it shares nothing with the table: its target is the swimmer's own encumbrance, it is thrown every round rather than per hundred feet, and failure is a drowning with its own sink rate, breath clock and rescue weight. **Jumping is likewise its own derivation** (`jumping.mjs`, `api.formation.jumping`) and for a sharper reason: clearing a gap is not a throw at all. It is a distance — DEX + 1d6, less a foot per stone, halved without a 20' run-up, scaled by running speed / 120 for a creature — reported as the RANGE the d6 makes it, with the count of faces that clear the gap. Acrobatics raises the DEX the jump is figured from, but **what it is worth is not held here**: the cap on that score and its bonus to the landing save are printed with the proficiency, so they arrive with the character's own imported ability and are passed in (`NO_ACROBATICS` is what an unimported one contributes — nothing). The DEX modifier likewise comes from the sheet, which the system already computes, rather than from a copy of the attribute table. The only saving throw is on LANDING, owed solely for a precarious destination or a charge into melee: Paralysis, and failing it lands the jumper 1d6 short — prone, hanging by the fingers, or falling at 1d6 per 10'. Neither swimming nor jumping has a UI surface yet. |
| Thief skills table (§13) | 🟡 | Captured in RULES.md; used implicitly once searching/trap automation reads real actor skill targets instead. |
| Rations & daily upkeep (§14.8) | ✅ (v0.5.0) | Week rations now consume as 7 tracked uses before the item decrements. Day boundary remains delve-relative. |
| Spell duration parsing | ✅ (v0.5.0) | "N turns" and "N turns per (caster) level" both parse, per-level multiplied by the caster's sheet level. |
| Strenuous ancillary activity per delve hour (§1) | 📖 | References RR p. 21 (fatigue/ancillary activities) — text not in the PDFs. Supply it to decide whether/how to automate. |

**Rules text worth extracting next** (to unblock the 📖 items), as of 2026-08-16:
RR p. 21 (ancillary activities/fatigue), p. 84 & 266 context (**surprise** and
the noise interaction — reactions are now extracted under `acks-influence`),
p. 110 (Endurance), p. 507/514 (Conditions incl. Vulnerable), and — for a future
overland mode — the wilderness expedition rules (expedition speed exists on
actors already; none of the wilderness procedure is in hand). **Mapping (p. 114)
is off this list** — it is extracted, and its row above is now 🔧.

---

## 2. The mapping system — Phases 1 and 2 SHIPPED; the remainder

[FOG.md](FOG.md) remains the architecture, and most of it is built: map
sessions force `fog.mode = SHARED` while a formation maps (the scene's own
mode is preserved in a flag and restored when mapping stops), "New map"
archives the union into a Map item held by the mapper and restarts from
black, the union re-archives on each dungeon-turn tick and at session end,
the fog-reload socket tells clients to re-pull after GM-side surgery,
anchoring composites a held Map item into every user's FogExploration
(sceneId-guarded), and "Save my current fog as a Map item" gives the GM the
sellable-map author. Mapping pauses — session intact — while there is no
working mapper, no unshielded lit light (setting-gated), a hurried pace, or
an active combat.

Still unbuilt, in likely order:
- **Auto-suggest anchoring** — pixel-test the party's position against a held
  Map item's bitmap and offer the anchor (GM-judged stays the rule).
- **Bake-Regions-to-bitmap** for partially revealed merchant maps.
- **Mapping-proficiency distortions** — unproficient mappers producing items
  flagged unreliable. **No longer blocked on rules text** (2026-08-16): the
  proficiency and its 11+ irregularity throw are extracted, so what remains is
  the distortion mechanism itself.
- **Optional `_unionizeSharedExploration` override** so anchored items
  survive core fog resets.

## 3. Other parked ideas (from DESIGN.md), re-prioritized

1. ~~**Trap Zones — traps come home to this feature**~~ — SHIPPED 4.9.0, as the
   whole of §7. A trap is an Item sub-type (`acks-extras.trap`) holding the
   definition; a **Trap Zone** region behavior or a **trap layer on a wall**
   places one. The sequence is the sequence of play's: searchers throw first,
   then the 10' pole probing 5' ahead of its bearer, then the party rank by
   rank on the secret 1d6 — victims by marching order, or by area for the traps
   that take everything within reach. Hasty and Methodical Trapbreaking with
   their botch bands, the disarm-or-discharge choice, re-arming, and the
   "cannot repeat until higher level" lock. Crude traps and the adjustable
   trigger band are in; the thirteen printed traps are NOT, and arrive through
   `acks-importer`. See [DECISIONS.md](DECISIONS.md).

   Two corrections to what this row used to say. **Trapfinding is not a throw**
   — it is +2 on Searching and Trapbreaking (RR p. 121), which `party-rolls.mjs`
   already applied; the finding throw is the hasty Search the party already had.
   And the pieces named here were right but incomplete: the resolution ORDER
   comes from §9.3, not from §7, and the area-effect traps come from the Judge's
   book chapter 8, not from the delve chapter at all.

   Still open on this row: **the importer half**, now half-built. As of
   2026-08-16 that repo carries a `kind.trap` and all thirteen trap entries
   authored against the Judge's Journal, so the mechanics text materializes from
   a Judge's own book. What it does NOT yet have is the binding that turns one
   into an `acks-extras.trap`, and that is gated on a question this feature
   owns: `TrapData` holds one trap at ONE level, while the book prints thirteen
   traps at six levels each — so the import produces either thirteen documents
   carrying the tier run as prose, or seventy-eight complete ones. Until it is
   answered a Judge fills traps in by hand, which this model always allowed.
   (The traps also import today as construction COSTS — thirteen
   `kind.equipment` rows off the RR price list — which is a different thing and
   springs nothing.) Separate release, separate repo.
2. ~~Encounter scaling & reactions~~ — SHIPPED 4.2.0.
3. ~~Obstacle helper~~ — SHIPPED 4.2.0 (climb and traverse); swimming 4.7.0 and
   jumping 4.8.0, each as its own derivation. What all three still lack is a
   **surface**: the throws and distances are published on `api.formation` and
   tested, but nothing in the party sheet asks the party to cross anything. That
   is the next piece of work on this row, and it is one UI for all three.
4. ~~Door helper~~ — SHIPPED 4.2.0, with spiking.
5. ~~Deploy needs a HEADING, not a file~~ — SHIPPED. `formationOffset` lays file
   along the heading's `right` and rank against its `forward`, and `blockOrigin`
   clamps over the block's real reach in each direction instead of assuming span
   is horizontal and depth vertical. The heading is the party token's `rotation`
   snapped to a cardinal, with nothing stored — see
   [DECISIONS.md](DECISIONS.md) for why south is the default, which is the one
   behaviour change (a party whose token has never turned now trails its column
   north instead of south). All four cardinals are pinned by
   `tools/test-formation-heading.mjs`.
6. ~~Formation templates (save/load marching orders); token HUD "form up"
   button~~ — SHIPPED as **saved marching orders** (`marching-templates.mjs`,
   world setting `marchingTemplates`), the word *template* being already spoken
   for by the Monster Manual generator. Save/load live on the party sheet's
   march controls; the party token's HUD forms the party up, gathering anyone on
   the map back inside the token. See [MODEL.md](MODEL.md) for how a saved order
   reconciles against a party that has changed since.
   ~~**Open on this row: the API's grip.**~~ CLOSED 4.9.0. The applying calls
   take an order or its id interchangeably, a reversed argument pair is refused
   by name, and every call states whether it writes. What stays open is the
   NAME: `applyTemplate` is also a chargen export with a different signature
   (`scripts/classes/chargen.mjs`), and this file's own header already concedes
   that *template* belongs to the Monster Manual generator. Renaming these to
   `…MarchingOrder` is the real fix and was deliberately not bundled into a
   fix-driven release — see [DECISIONS.md](DECISIONS.md).
7. Wilderness/expedition mode — PARTLY UNBLOCKED. The wilderness chapter is now in hand: 4.4.0 added the movement-scale vocabulary (`lib/movement-scales.mjs`, published on `api.lib`) with the Expedition Speed table reproduced to all twelve rows, travel pace (dedicated / forced march ×3/2 / ancillary half), and terrain and road multipliers on `vehicles/vehicle-speed.mjs`. What remains is the MODE: a formation that knows which hex it is in, what ground it is crossing, and a day-scale clock beside the turn-scale one. The formation record has no `ground` field yet, so a party's vehicle currently travels at its printed pace rather than a terrain-adjusted one.
8. Spell "per level" duration parsing (quick win, batch with the next release).
9. Week-ration uses counter (quick win).
