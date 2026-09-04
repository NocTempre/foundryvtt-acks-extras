# lib — the shared subsystem's index

One row per file; `npm run validate` fails when a file and its row disagree
(a lib file with no row, or a row with no file). **Check this table before
writing any helper** — most "missing" utilities are a row below.

Access rule: internal code imports directly from `scripts/lib/<file>.mjs`;
`globalThis.acksExtras.lib` is the EXTERNAL contract (the importer, macros,
sibling modules) — never the import path for this module's own features.

## Core primitives & registries

| File | Owns |
| --- | --- |
| `constants.mjs` | `MODULE_ID`, `LANG_PREFIX`, `FLAG_GEAR` — the module's name constants. The ONLY file that states the module-id literal. |
| `vocab.mjs` | Canonical ACKS enums (damage/movement/vision/senses/natural weapons/alignment), the `LevelValue` resolver, and the NAME-FORM rules (`nameVariants` / `nameKeys`) that know "Oil, Military (1 pint)" and "Military Oil" are one thing — **the importer subsystem reads those too; a second copy is how one flask became two documents.** Foundry-free. |
| `fields.mjs` | DataModel field-builders over vocab. Foundry-only, lazily so Node still evaluates it. |
| `field-spec.mjs` | Data-described form shapes for fields nobody shipped (importer-supplied metadata). |
| `choice-spec.mjs` | The family's one "choose N from …" primitive. |
| `tables.mjs` | Layered rules-table registry (SAMPLE/CATALOG/WORLD) + `bracketRow(rows, value)` — the ONE min/max bracket lookup. Foundry-free. |
| `ruledata.mjs` | Foundry-side loader: fetches `ruledata/<id>.json` and registers it into the tables registry. |
| `services.mjs` | Named-contract service registry — providers register at `init`, consumers look up by contract name (contracts: `docs/lib/API.md`). |
| `sockets.mjs` | The module's ONE cross-client transport (socketlib + handler registry + native fallback). |
| `util.mjs` | `makeLoc` / `toNum` / `gmIds` / `isPrimaryGM` / `libStorage` / `announceChange` / `ownsSheet` — the helpers every feature used to copy, and the one predicate that tells a sheet this module draws from the system's. |
| `world-time.mjs` | The one switch deciding whether this module writes `game.time`. |
| `module.mjs` | The barrel + patch layer: builds `acksExtras.lib`, registers settings, sub-types and patches. Import FROM the individual files, not from here. |

## Reading actors & items

| File | Owns |
| --- | --- |
| `actor-read.mjs` | `abilityMod` / `classLevel` / `monsterHd` / `hitDiceOrLevel` — graceful-degradation reads of the system schema. Never inline these. |
| `actor-compat.mjs` | `acksCompatStubs()` every actor sub-type must spread, + the one BOOK↔RELEASED saving-throw key mapping. |
| `item-model.mjs` | The shared item baseline: `isPhysical` / `isEquippable` / `weight6Of` / wear slots. |
| `capabilities.mjs` | "Does this actor hold an ability that provides X?" — name ∪ `kw:` token matching, and `abilityRank` (a proficiency taken thrice is three items). |
| `effect-scan.mjs` | Active-Effect scanning core: `appliedEffects` / `makeEffectMeta` / `activeNumericChanges` / `csvFlagSet` / `sumModifiers`. |
| `managed-effects.mjs` | The effects this module maintains and a hand must not delete (class training, equipment loadout): the marker registry, the `preDelete` refusal, and the row lock. |
| `proficiency-strip.mjs` | Compact profile strips (fighting style, weapon category, armour) from equipment's profile API, `abilityContributions` (what the imported proficiency items state, by item), and `weaponTokenClasses` — the ONE reading of a weapon grant (`all`, `missile:all`, `melee:<size>`, a category, a weapon) at CLASS granularity; the reading at the weapon is equipment's `training-view.mjs`. |

## Domain models

| File | Owns |
| --- | --- |
| `attachment.mjs` | THE carry model: one actor attached to another in a role (rider/passenger/draft/crew/cargo) with a station and a draft kind — one flag on the carried actor, a forest by construction, `carrierChain`/`rootCarrierOf`, and a cached (never authoritative) reverse index. |
| `mount.mjs` | Rider-role FACADE over `attachment.mjs` — the mounted-combat vocabulary (`mountOf`/`riderOf`/hooks); legacy symmetric pairs still read, every write converges them. |
| `capacity.mjs` | How much any document can hold / is holding / is it over — in sixths of a stone. |
| `movement-scales.mjs` | The four ACKS speeds (combat/running/exploration/expedition) and their book names. |
| `distance-units.mjs` | What a scene's `grid.units` is worth in FEET — the picker's unit table, `feetPerUnit`, and `sceneFeetPerCell`. Every feet→squares conversion divides by that. Foundry-free. |
| `senses.mjs` | What a creature perceives; `canSeeInDark` + `senseProfile`. |
| `perception.mjs` | Those senses as Foundry vision/detection modes. |
| `light.mjs` | The RR light table + "how brightly does this actor's token burn?". |
| `token-sync.mjs` | The ONLY writer of senses/light onto tokens. |
| `attack-logic.mjs` | Pure attack model: throw as a moving target, bonuses as an auditable term stack. |
| `damage-type.mjs` | Live damage typing for weapons via equipment's classifier (no second copy of the table). |
| `money-logic.mjs` | Coin arithmetic in INTEGER COPPER: `coinSlots` / `planCoinSpend` / `planChange` / `convertCp`. Foundry-free. |
| `money.mjs` | Money as physical: `transferCoin` (location-gated), `creditCoin`, `exchangeCoins`, `HOUSE_OWNER`. The ONE payment path. |
| `storage-logic.mjs` | Pure transfer plans for goods stored off-person. Foundry-free half of storage. |
| `storage.mjs` | Storage at a place — the document writes over storage-logic's plans. |
| `place-logic.mjs` | Pure nesting/occupancy/stacking rules for PLACES. Foundry-free half of place. |
| `place.mjs` | PLACES — nesting, occupancy, stacking over the storage primitive. |
| `group-logic.mjs` | Pure stacked-actor lifecycle decisions. Foundry-free half of group. |
| `group.mjs` | Group operations — per-stack lifecycle of a stacked actor. |
| `template-logic.mjs` | Generator actors (dragon by age, elemental by tier): choice rolling + patch resolution. Foundry-free. |
| `follower-card.mjs` | The printed ACKS II Follower Card: one layout, two surfaces. |
| `roll-card.mjs` | ONE chat card for a roll several people made at once — use this before hand-building a `ChatMessage`. |
| `library.mjs` | The imported library, wherever it lives: sidebar + the importer subsystem's world packs. **Every "what has this world imported?" read goes through it** — a bare `game.items` finds an empty shelf. `cookbookId(doc)` is the ONE read of the importer's stamp. |
| `compendium-folders.mjs` | Where every ACKS compendium sits in the sidebar, read from each package's own manifest `packFolders` — the system's tree is the system's. Two strengths: `organizeCompendiumFolders()` fills an empty or dangling slot at every load, `restoreCompendiumLibrary()` is the macro and overrules. Also shelves the importer's world packs, a line's folder made by the first pack that needs it. |
| `polyglot.mjs` | Publishing world-imported languages to Polyglot's selector (core owns the base integration). |

## apps/

| File | Owns |
| --- | --- |
| `apps/follower-card-sheet.mjs` | The Follower Card as an actor sheet (default for `monster` sub-types). |
| `apps/group-sheet.mjs` | The group (stacked-actor) sheet. |
| `apps/template-sheet.mjs` | The template-generator builder sheet. |

## data/

| File | Owns |
| --- | --- |
| `data/animal-data.mjs` | `animal` sub-type — the bridge between an animal and a monster. |
| `data/gear-extras.mjs` | GearExtras — where gear sits and how fast you can get at it (`flags["acks-extras"].gear`). |
| `data/group-data.mjs` | `group` sub-type — a stack of near-identical creatures held as one actor. |
| `data/template-data.mjs` | `template` sub-type — a generator actor stamping out concrete creatures. |

## patches/

| File | Owns |
| --- | --- |
| `patches/attack-display.mjs` | Core patch: the character sheet's Melee/Ranged boxes, replaced at render. |
| `patches/attack-roll.mjs` | Core patch: the attack roll remodeled as target vs auditable bonus stack. |
| `patches/goods-drag.mjs` | Core patch: drag sources for the goods rows core leaves un-draggable. |
| `patches/initiative-card.mjs` | Core patch: a round's initiative gathered onto one chat card, a combat group as one row. |
| `patches/surprise-card.mjs` | Core patch: the Surprise Matrix's results gathered onto one chat card. |
| `movement-modes.mjs` | Which modifiers a thing meets, and in what order: a vehicle is a march with gates, a vessel is an independent layer with no ground beneath it, and a flier meets the country below while its wind supersedes the ground's. Composes parts contributed by the derivations; never prices anything itself. |
| `survival.mjs` | Hunger and thirst as ladders a day at a time: three food rungs and one water rung, what each forbids, and the Constitution they take and owe back. Its own subsystem because starving reaches past a march; formation automates it for a marching order but does not own it. Every duration and rate is imported. |
