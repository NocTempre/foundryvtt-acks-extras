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
| Mapping proficiency (secret error-detection throw) (§3.1) | 📖🔧 | Needs RR p. 114 proficiency text + a "map error" concept — only meaningful once the map-object system exists (an unproficient mapper's Map item could get GM-injected distortions). |
| Light sources & burnout (§4) | ✅ | Burn clock, guttering, inventory consumption, token light emission. |
| Shadowy senses / lightless vision (§4) | ✅ | Both now reach the TOKEN: sight derived from the sheet by the lib subsystem `senses.mjs` (shadowy 30', lightless its recorded range, both as dim monochrome; ordinary eyes range 0, seeing only what is lit). Applies to any actor, in a party or not. Mapping still requires bright light, so the mapper gating is unchanged — RAW, senses cannot do bright-light tasks. |
| Searching & listening throws (§5) | ✅ (v0.5.0) | Party-roll buttons (Listen / Hasty Search / Methodical Search / Bash Door) roll every member using **their sheet's numbers** — a matching ability item's rollTarget (thief skills) first, else the sheet's Adventuring target — GM-whispered as one card. RAW enforced: hasty search skill-only, methodical +4 for skill users and auto-consumes 1 turn, listening once per turn while moving, bashing ±4×STR. |
| Earshot / noise (§5) | 📖 tables captured; automation impractical (Judge adjudication). |
| Doors: bash/pick/batter procedures (§6) | 🔧 | Time costs work via Turn button. A "Door helper" dialog could roll Dungeonbashing 18+ (±4/STR), lockpicking by thief level with jam-on-botch state, and consume the right number of turns. Needs per-actor proficiency access; ACKS system already has adventuring/lockpicking rollers worth reusing. |
| Traps: trigger 1d6, pole probing, disarm throws (§7) | 🔧 | The biggest unautomated delve rule. Proper implementation: trap Regions (reuse the Encounter Zone pattern — a "Trap Zone" region behavior) that watch party movement, roll the secret 1d6 (1–2 triggers), account for the Pole role (5' ahead) and Scout auto-hasty-search, and select victims by marching order. This is the natural next region behavior after zones. |
| Rest & winded (§8) | ✅ | Includes Endurance exemption and combat rounds counting. |
| Sequence of play (§9) | ✅/🟡 | Steps 1, 5 automated; steps 2–4 (stationary actions, traps, deliberate encounters) are GM-driven with helpers. |
| Wandering monsters: throw, distance, minute (§10) | ✅ | Zone-keyed cadence/targets/tables; private table draws. |
| Wandering monsters: number ±50% per level step, reaction modifier by level difference (§10) | 🔧 | Currently table-description notes. Proper fix: give the Encounter Zone a **dungeon level** field and encode monster level in the example tables' flags; then scale the drawn number-appearing roll and pre-roll 2d6 reactions with the ±(monster−dungeon) modifier. Needs a draw post-processor (hook on the table draw or perform the draw manually instead of `table.draw`). |
| Surprise & encounter procedure (§10.4–5) | 📖🔧 | Surprise mechanics and the reaction procedure live in the encounter chapter (RR p. 84 / p. 266 noise interaction) — not in the three PDFs. Supply those pages and this becomes automatable (party surprise roll vs monster, light-source penalties). |
| Spelunking, squeezing, swimming, jumping (§11–12) | 🟡 | Rules captured; these are per-obstacle, round-scale procedures. Could become an "Obstacle" helper (pick obstacle type → per-member throws by proficiency with fall damage rolls), but each member's Climbing/Contortionism/etc. must be read from actor items. Worth doing as its own release. |
| Thief skills table (§13) | 🟡 | Captured in RULES.md; used implicitly once searching/trap automation reads real actor skill targets instead. |
| Rations & daily upkeep (§14.8) | ✅ (v0.5.0) | Week rations now consume as 7 tracked uses before the item decrements. Day boundary remains delve-relative. |
| Spell duration parsing | ✅ (v0.5.0) | "N turns" and "N turns per (caster) level" both parse, per-level multiplied by the caster's sheet level. |
| Strenuous ancillary activity per delve hour (§1) | 📖 | References RR p. 21 (fatigue/ancillary activities) — text not in the PDFs. Supply it to decide whether/how to automate. |

**Rules text worth extracting next** (to unblock the 📖 items): RR p. 21 (ancillary activities/fatigue), p. 84 & 266 context (surprise, reactions, noise), p. 110 (Endurance), p. 114 (Mapping), p. 507/514 (Conditions incl. Vulnerable), and — for a future overland mode — the wilderness expedition rules (expedition speed exists on actors already; none of the wilderness procedure is in hand).

---

## 2. The mapping system (revisited)

[FOG.md](FOG.md) remains the architecture; v0.4.0 made it *simpler*: the module is now **v14-only** (no dual-path fog code needed) and Map items get a natural home — the party actor / member inventories are already tradeable.

**Phase 1 — map sessions (core loop).**
- Force `fog.mode = SHARED` while a formation maps on a scene (today we restore "whatever the scene had"); all members contribute to and see one union.
- "**New map**" button in the formation window: archive the current union into a Map item (base64 bitmap in item flags, held by the mapper), reset the scene's FogExploration documents, start from black. This is the fell-through-a-hole scenario.
- Archive the union into the active Map item on each dungeon-turn tick (cheap: reuse the pixel extraction core already does) and at session end (mapper lost / formation leaves scene / disband).
- New module socket to tell clients "reload fog" after GM-side document surgery.
- Development notes: a PIXI compositing helper (~50 lines, mirrors core's `#compositeTextures`), scene-dimension metadata stored in the Map item to detect misalignment, and the primary-GM-only discipline the module already uses everywhere.

**Phase 2 — anchoring & trade.**
- "**Anchor**" on a held Map item: composite its bitmap into every user's FogExploration and reload — the old area lights up, merged with live exploration. "Unanchor" removes the scene's fog docs and re-anchors the remaining set (cheapest correct implementation: rebuild from live session + anchored items).
- Loot/buy/sell needs zero new code (items). Guard: anchoring requires the item's `sceneId` to match.
- GM-judged by design; an *auto-suggest* ("the party stands in territory 'Map of Level 2' depicts — anchor?") uses `FogManager#isPointExplored`-style pixel testing against the item bitmap.

**Phase 3 — authoring & polish.**
- "Save my current fog as a Map item" (GM) for sellable maps; bake-Regions-to-bitmap for partially revealed merchant maps.
- Mapping-proficiency hooks (📖 above): unproficient mappers could produce items flagged "unreliable" for GM-narrated distortions.
- Optional custom `_unionizeSharedExploration` override so anchored items survive core fog resets.

**Interaction with existing features to watch:** the mapper-gating (fog DISABLED without a mapper) becomes "session paused" in Phase 1 — recording stops but the Map item keeps its archive; losing the mapper permanently (death + looted map) is exactly the item walking away. Combat deploys don't touch fog (member tokens see normally during a fight; their vision contributes to the session — acceptable and arguably correct).

---

## 3. Other parked ideas (from DESIGN.md), re-prioritized

1. **Trap Zones** — deferred by design: traps will live in a separate module. Its half of the link SHIPPED in 4.0: `api.formation` carries the versioned contract (apiVersion 1 — `marchingOrder()`, `ROLES`, `getFormations`, `rollPartyCheck`, `PARTY_CHECKS`). What remains here is nothing; what remains elsewhere is the trap module itself (owner ruling 2026-08-14: a later cycle, not 4.x).
2. **Encounter scaling & reactions** (dungeon-level field on zones; §10 above).
3. **Obstacle helper** (climb/squeeze/swim per-member throws).
4. **Door helper** (bash/pick with time cost + botch states).
5. Deploy members in marching-order file behind the party heading (deploy
   currently rings them). Now one change, not two: the combat deploy and the
   detach share `deployment.mjs`.
6. Formation templates (save/load marching orders); token HUD "form up" button.
7. Wilderness/expedition mode (needs 📖 wilderness chapter; actor `movementacks.expedition` already computed by the system).
8. Spell "per level" duration parsing (quick win, batch with the next release).
9. Week-ration uses counter (quick win).

## validate's missing-i18n-key check is defeated by a longer sibling

`tools/validate.mjs` **does** check that every key referenced in code exists — the
guard is at line 350, `missing key referenced in code`. It has one hole, and
`ACKS-FORMATION.app.frontage` went through it (see [DECISIONS.md](DECISIONS.md)).

Line 349 tolerates dynamic families, where code builds `PREFIX.${value}` and only
the prefix can be captured:

```js
if (langKeys.some((k) => k.startsWith(key))) continue;
```

It cannot tell that prefix from an **exact literal reference**. A literal
`localize("…app.frontage")` is passed as long as *any* defined key starts with
that string — and `…app.frontageHint` did, sitting on the next line of
`lang/en.json`.

Measured, and not a rare coincidence: **217 of 2279 keys (9.5%) are strict
prefixes of a longer sibling**, so any one of them could go missing today and
`validate` would stay green. The `foo` / `fooHint` convention this family writes
labels in is what makes it systematic, and `foo` — the visible label — is always
the shielded one.

Confirmed by experiment: delete `…app.frontage` alone and `validate` passes
clean; delete `…app.frontageHint` as well and it fails on **both** keys. So the
reference is scanned correctly and the flattening is right — only the tolerance
is wrong.

What that needs: distinguish a reference the scanner captured *whole* from one it
truncated at a `${…}`. Only the truncated kind may use `startsWith`; an exact
literal must demand an exact key. The scanner already knows which is which — §6
resolves constant roots and bound localizers, and `OPAQUE_I18N_RE` already
detects the interpolated case — so this is a matter of carrying that fact as far
as the check rather than new analysis.

It belongs in **acks-module-template**, since every repo in the family has the
same exposure; this repo only consumes the synced copy.
