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
| Corridor-width formation (single file ≤5', two abreast ≥6') (§3) | 🟡 | The party token now WEARS its face: `faceWidthFeet` (frontage × the `marchFeetPerBody` setting) sizes it at the scene's scale, swapping axes with the heading (see MODEL "Data flow"). What remains is the **auto-squeeze**: probing corridor width by wall rays and narrowing `effectiveFrontage()` (the seam already exists) when the passage is tighter than the declared face, reforming when it opens — a per-formation toggle. Storage sketch: `autoSqueeze` boolean + `squeeze: {active, frontage}` on the record; triggers on party-token movement and wall create/update/delete. |
| Mapper: bright light, both hands, **vulnerable** (§3.1) | 🟡 | Light requirement drives fog. **Hands are now real**: the role needs a quill and parchment (`ROLE_GEAR`) and each piece occupies a hand in the equipment loadout, so a mapper cannot also hold a drawn weapon. v0.5.0 warns when the mapper lacks the Mapping proficiency (vague measurements, no passive error detection). Only *vulnerable* is still a reminder — auto-applying the Active Effect needs 📖 the Conditions rules (RR p. 514). |
| Mapping proficiency (secret error-detection throw) (§3.1) | 🔧 | **Unblocked 2026-08-16** — the proficiency text is now in the local extract (`acks-rules/acks-formation/PROFICIENCIES.md`), which states the throw: one turn and an 11+ to interpret a layout, map from memory, or notice an irregularity in one's own map. What is still missing is development, not text: a "map error" concept, which is only meaningful now the map-object system exists (an unproficient mapper's Map item could get GM-injected distortions). |
| Light sources & burnout (§4) | ✅ | Burn clock, guttering, inventory consumption, token light emission. |
| Shadowy senses / lightless vision (§4) | ✅ | Both now reach the TOKEN: sight derived from the sheet by the lib subsystem `senses.mjs` (shadowy 30', lightless its recorded range, both as dim monochrome; ordinary eyes range 0, seeing only what is lit). Applies to any actor, in a party or not. Mapping still requires bright light, so the mapper gating is unchanged — RAW, senses cannot do bright-light tasks. |
| Searching & listening throws (§5) | ✅ (v0.5.0) | Party-roll buttons (Listen / Hasty Search / Methodical Search / Bash Door) roll every member using **their sheet's numbers** — a matching ability item's rollTarget (thief skills) first, else the sheet's Adventuring target — GM-whispered as one card. RAW enforced: hasty search skill-only, methodical +4 for skill users and auto-consumes 1 turn, listening once per turn while moving, bashing ±4×STR. |
| Earshot / noise (§5) | 📖 tables captured; automation impractical (Judge adjudication). |
| Doors: bash/pick/batter procedures (§6) | ✅ (4.2.0) | Door helper on the Walls layer: the bash throw shown BEFORE it is rolled and broken into its parts (±4/STR, +4 for a pair on the stronger adjustment, +2 crowbar, ±8 per size step), an unwinnable throw named as such, batter-down turns by construction, and SPIKES as real state — one round each, four maximum, -4 to force per spike after the first, torn out when the door is forced. Published on `api.formation.doors`. |
| Traps: trigger 1d6, pole probing, disarm throws (§7) | ✅ (4.9.0, extended 4.12.0) | The whole of §7. A trap is an Item; a Trap Zone region or a wall's trap layer places one. Searchers throw first (§9.3), then the pole 5' ahead of its bearer, then the party on the secret 1d6 — victims by marching order, or by area. Hasty/Methodical Trapbreaking with their botch bands, disarm-or-discharge, re-arming, and the repeat lock. The printed traps arrive through `acks-importer`, which imports their construction cost but not yet their mechanics (scoped in that repo's roadmap, 2026-08-16). |
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

   Also still open, added 2026-08-18 with the automatic-search sweep and the
   Trapbreaking dialog: **the disarm-or-discharge choice is asked of the wrong
   seat.** The book gives it to whoever made the throw; the throw runs on the
   Judge's client, so a player who declares an attempt has the Judge answer for
   them. Fixing it properly means a second socket round-trip back to the
   declaring user, held open while the Judge's client waits — worth doing, not
   worth papering over.
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
7. Wilderness/expedition mode — THE MODE NOW EXISTS (2026-08-28): the
   `travel` subtree on the record, the journey/delve switch coupled to the
   turn clock, the day board with its ancillary budget, the hex trace, the
   derived day's march applied once to the slowest unscaled base, the lost
   state, and the capped day log — `scripts/formation/travel.mjs`, published
   as `api.formation.travel` (apiVersion 4). What remains on this row:
   **Path B's importer half** — the extras side landed the same day (the
   terrain/road/wind values read from the `travel`/`voyages` registered
   tables, ×1 with a stated reason until imported; ruling in
   `docs/vehicles/DECISIONS.md`). The land recipes LANDED 2026-08-28
   (terrain multipliers, roads, getting-lost, encounter frequency, and the
   whole `weather` document); still owed are the `voyages` recipes (wind
   strength, tacking — the naval tail) and JJ App R's per-kind road
   refinement that replaces the RR-derived roads table;
   **supply consumption** at End Day (member rations at the day boundary,
   animal feed and water as Normal-Load fractions, crew rations against the
   hold). Encounter cadence + the chain LANDED 2026-08-28 (`MODEL.md` §The
   encounters); of its importer recipes, the core chain tables ride the
   owed-recipes row and the 17×4 monster sub-tables are a committed BATCH
   PROGRAM (extras resolves whatever is registered and whispers "draw from
   your book" for the rest, so batches land without extras changes).
   Generated weather LANDED 2026-08-28
   (`MODEL.md` §The weather; the `weather` document's importer recipes ride
   the same owed-recipes row as the travel tables above). The scene/hex
   integration LANDED 2026-08-28 exactly as the record
   shape anticipated: the battlemap feature's terrain painting
   (`docs/battlemap/MODEL.md` §Terrain painting) names the hex and sets the
   ground from the party token on painted hex scenes, and the manual
   Next-hex button remains the trace everywhere else.
8. Spell "per level" duration parsing (quick win, batch with the next release).
9. Week-ration uses counter (quick win).
10. **`levelFactor` stays a free float** in this feature's own skill-audit
    override (`skill-audit.mjs`, `party-rolls.mjs` — 0.25–2, unlabeled), unlike
    `lib/vocab.mjs`'s named `PROGRESSION_LEVELS` (full/half/third/quarter) that
    abilities and classes already read. Adopting the enum here was the smaller
    half of the original abilities-integration audit's Phase 4 sketch and was
    never split out as its own change.

## 4. Land travel — RAW coverage checklist (audited 2026-08-29)

A walk through RR §VI.2 *Wilderness Expeditions*, JJ ch. 2's expedition
sequence, and JJ ch. 2 *Settlement Adventures*, rule by rule. **Built** rules
are described in `MODEL.md` and are listed here only so the coverage is
honest; everything else is work.

### Built

Expedition speed and the terrain multiplier; the road rate and its driver's
rate; mud and snow as footing; the weather bands, conditions and the footing
state machine; visibility in the wild (`visibilityMax`, `headEquivalents`);
encounter distance, surprise, evasion and reactions; the encounter cadence by
territory; the day board and its ancillary slots as a *record*.

### Not built — the wilderness

| Rule | State | Note |
|---|---|---|
| ~~The day's end~~ | **BUILT** — walking off the day's march raises the question (call it a day / push on / not yet); `closeDay` is the one closer behind both it and the button (DECISIONS 2026-08-31). |
| ~~**Navigating the Wild**~~ | **BUILT** — the throw is rolled and whispered on End day, reads the imported target, applies the marching order's competence, and is skipped on a road, a river or a known route. |
| Pathfinding / Navigation bonus | **built** | `navigationCompetence` scans the marching order for either competence; holding both is worth more, and the two figures come from the imported `navigationBonus` row. |
| ~~Straying direction~~ | **BUILT** — the Judge names the hex face or rolls for it; the grid's own neighbour order IS the face order. |
| ~~Lost consequence~~ | **BUILT** — the full episode: shadow token, faked reveal, discovery, and re-anchor. UI-complete on the journey panel. |
| ~~**Searching the Wild**~~ | **BUILT** — the specs (22 checks) and `search-run.mjs`, rolled from the camp panel, paying its encounter throw through the journey's own chain. |
| Searching for specific points of interest | **built** | A penalty on the same throw. |
| Aerial reconnaissance | **built** | Two corrections, never both: more throws over open ground, a worse target under canopy. |
| Land surveying | **built** | Three outcomes: right, confidently wrong on a natural 1, or nothing yet. |
| Splitting up | **built** | Sub-parties throw and draw encounters separately; mutually supporting groups are not split. |
| ~~**Flight speed**~~ | **BUILT** — `flight.mjs` composes into the march readout through the movement-mode layer: a *Moving by* picker, hours aloft out of a stated day, and the load band. A flier meets the terrain below it, refuses roads, and its wind rule supersedes the ground's rather than stacking. |
| ~~**Starvation**~~ | **BUILT** — `runProvisionDay` walks every member's ladder at End day and writes it to the body, not the marching order. |
| ~~**Dehydration**~~ | **BUILT** — as above, and its toll is ROLLED: the caller throws the registry's die per body, and the heat multiplies it. |
| ~~Hunting and foraging~~ | **BUILT** — the specs (11 checks) and `forage-run.mjs`, which rolls them from the camp panel and deposits into the foragers' packs. Live-verified the pool then sees it. |
| ~~Survival, simplified~~ | **BUILT** — `simplifiedSupply` recommends what to carry; watered country waives the water entirely. |
| ~~Animal daily food and water~~ | **BUILT** — `animalNeeds` reads each creature's own figures; unstated is null, never zero. |
| ~~Temperature effects~~ | **BUILT** — hypothermia as an hourly condition, and the heat as modifiers: more water needed, a worse drain, an armour save. Live-felt in the pool. |

### The settlement — complete

City travel landed as `settlement.mjs`: the paces, the street locations, the
route memory, the straggling ladder and the derivations that price them from
the registry. Every row below is now built — kept here, struck through, so the
walk stays honest about what was once outstanding.

| Rule | State | Note |
|---|---|---|
| ~~Settlement panel~~ | **BUILT** — pickers, the derived rate and the throw prospect. The Take-a-turn button is **gone**: a city turn is walked off the map like a delve turn (DECISIONS 2026-08-31). |
| ~~Street encounter throws~~ | **BUILT** — the movement-driven turn tick fires them on the street's own cadence, whispered, in place of the dungeon's wandering-monster throw. |
| ~~Settlement encounters table~~ | **BUILT** — the d100 table imports as a real RollTable from the Judge's own Judges Journal (a new `jj` register and cookbook), and the after-dark shift arrives as a registered figure. `settlementEncounter` performs the procedure: one roll, the shift, the band. |
| ~~Looking for trouble~~ | **BUILT** — a declared intent that eases the THROW rather than shortening the interval, which is what the page says and the difference compounds over a long walk. |
| ~~Holing up~~ | **BUILT** — `advanceSettlementDays` spends a stay in DAYS, one throw each, credited off the world clock (`creditHoledUpDays`) rather than from a control. |
| ~~Travel by litter or wagon~~ | **BUILT** — a conveyance the board remembers and that deliberately carries no rate at all, pinned by a test: the page says it is not any faster. |

### Cross-cutting defects found in the audit

- ~~**Weather is stored, not derived.**~~ **FIXED 2026-08-29** — `sky.mjs`
  derives the day from `date × climate` and caches per pair, so advancing the
  calendar any other way no longer leaves yesterday's sky standing and two
  parties in the same country get the same day.
- ~~**Road and development are per-day pickers.**~~ **FIXED 2026-08-29** —
  roads are painted as declared paths between a hex's sides, corners and
  centre (`hex-topology.mjs`, `hex-routes.mjs`, `route-paint.mjs`); the picker
  remains for a party not travelling a drawn route.
- ~~**The terrain vocabulary is frozen.**~~ **FIXED 2026-08-29** — the brush
  now paints the union of shipped and imported keys, with a derived hue for a
  kind the palette has never seen.
- ~~**`mud` and `snow` are paintable terrain.**~~ **FIXED 2026-08-29** — both
  are withheld from the brush and derived from the footing alone. They remain
  valid terrain keys for the multiplier lookup.

## 5. Rulings taken 2026-08-29, and what each unblocks

All ten open questions from the audit are answered
(`docs/formation/DECISIONS.md`, `docs/battlemap/DECISIONS.md`). Remaining work,
now unblocked:

| Work | Ruling it waited on |
|---|---|
| Following a river or known route | **BUILT** — the RAW exemption, now with a picker; the branch had existed with no field to read |
| ~~The lost episode~~ | **BUILT** — ledger, shadow token, faked reveal, both endings; live-verified end to end |
| ~~Hooking the daily throw into End day~~ | **BUILT** — `navigation-card.mjs` whispers the throw on End day. It reports and never steers: RAW hands the stray direction to the Judge |
| ~~The Wilderness Searching throw for the last known landmark~~ | **BUILT** — it is `searching.mjs`'s `landmark` quarry, and it feeds `reanchorEpisode` |
| ~~Weather from `date × climate`~~ | **BUILT** — `sky.mjs`, 8 checks; live-verified that two parties share one morning |
| ~~Hex topology~~ | **BUILT** — the model (14 checks), the scene storage, the Routes tools, and the march consulting it. Live-verified that a crossing is a crossing: the same hex's other neighbours stay off-road |
| Route tax | **BUILT** — `routeCost` reports it apart from the speed multiplier. A path's own encounter profile is not built |
| ~~Survival~~ | **BUILT** — the ladders (12 checks), pooling and sharing (11 checks), and `provision-day.mjs` ticking every body on End day. Live-verified that one carrier's rations feed the whole order |
| ~~Flight as a third travel model~~ | **BUILT** — `flight.mjs`, 11 checks. The blend, the wind cut and the load threshold; whether terrain multiplies a flight is a registered ruling, since the printed table's placement and the fiction disagree |

Done in the same pass: the open terrain vocabulary, mud/snow withheld,
straggling shipped ON behind a world setting, and `landNavigationSpec` /
`navigationCompetence` giving `gettingLost` its first reader.

---

## 6. The door numbers leave the module (ruled 2026-08-30)

`doors.mjs` is the last formation surface holding printed values in code — the
bash target, the Strength/pair/crowbar/size/spike magnitudes, the spike cap, the
botch damage, and `DOOR_KINDS`, which is RR Ch.6's door grid retyped (and which
had already acquired a "portcullis" row the books do not print). Ruled content,
not structure: [DECISIONS.md](DECISIONS.md).

Two steps, importer first — extras cannot read a table no world can supply.

| Step | Where | Work |
|---|---|---|
| 1 | acks-importer | An RR Ch.6 recipe: the door grid through `assists.grids` with `ac` / `shp` columns (as `def.vehicle.seaTable` p.319 already does), the batter-down turns per construction, and the bash modifiers as `from: {pattern}` reads out of the section's prose. Ch.6 has no register file yet, so the page range is new; the extraction shape is not. |
| 2 | extras | `doors.mjs` reads a `doors` document via `getDoc` / `expectTables`, as `classes/hitpoints.mjs` does. `bashPlan` keeps its shape — only the magnitudes are passed in. |

Degradation is a refusal, not a default: no imported table means bash and batter
say so, while every structural door gesture (open, close, lock, spike, unspike,
evil doors) keeps working. There is no identity value for a missing throw target
the way `1` is the identity for a missing hit-die floor, and falling back on the
target the module remembers would reinstate the very value the ruling removes.

Also in that pass: this file and `doors.mjs`'s own module docstring state the
magnitudes in prose. `docs/` is not shipped, but it is tracked.
- **The lost-episode shadow token has no ending that retires it.** MODEL.md
  says the shadow survives discovery and retires at a later re-anchor, but
  `discoverLost` closes the episode and `reanchorLost` refuses a closed one —
  so `clearShadow`'s only caller is unreachable after the commonest ending, and
  a hidden token of the party actor stays on the scene forever. Wants a
  `known` state on the ledger (knows it is lost, does not know where) so the
  two endings stop sharing one bit, `sceneFor` resolving `formation.sceneId`
  rather than whatever scene the Judge is looking at, the raw `lostActive`
  checkbox removed so the episode transitions own the state alone, shadow
  clearing in `dissolveFormation`, and a `ready` sweep to clear shadows whose
  formation is gone. TESTING.md step 3 asserts the leak as the expected
  observable and changes with it.
- **Players enrolling their own tokens.** Both add paths are hard-gated to the
  Judge and the player relay has no `join` case — structurally, because every
  case validates that the actor is already a member. Ruled 2026-08-31: a player
  may enrol a token they own into a formation they already hold a member in,
  behind a `playersAddMembers` world setting defaulting off (the shape
  `playersMoveParty` already set). The relay must resolve the token GM-side by
  id and never trust a payload. MODEL.md's player-capability table needs the
  new row and the three it is already missing (`detach`, `trapbreak`,
  `trapRearm`).
- **The night, and what a night restores.** ROADMAP §4 claims to walk JJ's
  expedition sequence rule by rule and omits steps 10 and 11 — fatigue and
  rest healing — along with RR §VI.2's sleep block. Four clocks that must not
  be conflated: the dungeon rest turn clears Winded, a night's sleep restores
  every tradition's castings and **no** hit points, a dedicated day restores
  hit points, and fatigue clears only to both together. **ACKS II has no watch
  procedure** — standing watch is an activity, not a throw, and the Surprise
  Matrix takes no watch input — so a watch roster would be invention and is not
  planned. Every hour count, healing die and fatigue run is a printed value:
  the importer recipes ship first and this degrades by refusing to adjudicate
  the night, never by defaulting. `survival.mjs`'s `naturalHealing` forbid has
  no consumer until this exists.
- **One owner for chat visibility.** Three spellings of "the GMs" (`gmIds()`,
  a hand-rolled filter, `getWhisperRecipients`) and three hand-rolled versions
  of the public/private split (`initiative-card`, `surprise-card`,
  `influence-app`). Wants one `lib/` helper taking an explicit policy —
  `secret`, `declared` (a public notice naming the actor plus a whispered
  result), `public` — absorbing all of them. **Traps take `secret`
  explicitly**, stated in the helper's own docstring: a trap crossing has no
  declaration, and announcing that the party checked is the leak the 2026-08-18
  secrecy ruling exists to prevent.
