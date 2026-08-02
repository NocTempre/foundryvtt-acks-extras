# acks-lib API (v0.7)

`acks-lib` is the family's shared-primitives library. **Scope is the
effect/ability vocabulary** the abilities program needs, the scoping
primitives the social rolls need (v0.6), and — pulled forward by the table
extraction program (template docs/CONTENT-EXTRACTION.md) — the **layered
tables registry, the service-contract registry, and the ruledata loader**
(v0.7). Still *not* here from [FAMILY.md](../../acks-module-template/docs/FAMILY.md)
§3: the socket relay and sheet helpers (Phase 1 backlog); §3c's
`economy.json` is **superseded** — no book-read value ships in the lib.
`library: true`, `socket: false`, requires only the `acks` system.

## Exposure

- `globalThis.acksLib` — assigned at module evaluation via the core-deferral
  shim `game.acks?.lib ?? localImpl`; re-affirmed at `init`.
- `game.modules.get("acks-lib").api` — the same object, set at `init`.
- Node/offline tooling imports the files directly (sibling-relative), e.g.
  `import { resolveLevelValue } from "../../acks-lib/scripts/vocab.mjs"`.

```
acksLib = {
  apiVersion: 3,
  vocab,               // scripts/vocab.mjs — enums + resolvers (Foundry-free)
  fields,              // scripts/fields.mjs — DataModel field-builders (Foundry-only)
  resolveLevelValue,   // (levelValue, level, scales?) → number | null
  tables,              // scripts/tables.mjs — layered rules-table registry (Foundry-free)
  services,            // scripts/services.mjs — named-contract registry (Foundry-free)
  loadRuledata,        // scripts/ruledata.mjs — fetch+register a module's ruledata (Foundry-only)
}
```

## `tables` — layered rules-table registry (Foundry-free)

Documents are plain JSON carrying `id` (`{ id, source, tables, throws? }`).
Each id holds at most one document per **priority layer**; reads resolve the
highest layer present:

| layer | who registers |
|---|---|
| `PRIORITY.SAMPLE` (0) | a module's shipped defaults — none ship today (extraction-program ruling: no book values, no samples) |
| `PRIORITY.CATALOG` (10) | premium/companion content modules |
| `PRIORITY.WORLD` (20) | per-world imported tables (via the `ruledata-import` contract) |

`registerTable(doc, {priority, source})` (same-layer re-registration
replaces — idempotent re-import) · `initTables(doc)` (drop-in alias, layer
0) · `unregisterTable(docId, {priority?})` (layer removal falls back to the
next-highest; no priority = remove all layers) · `getDoc` / `getTable` /
`getThrowDef` (throw when absent — callers gate with `hasDoc`) · `hasDoc` ·
`docInfo()` → `[{id, priority, source}]` for missing-tables UX ·
`bracketRow(rows, value)` (null max = open-ended) · `resetTables()`.

Consumers read ONLY through this registry — never a sibling module's name —
so any provider can substitute data without consumer changes.

## `services` — named-contract registry (Foundry-free)

`register(name, impl)` at `init`; `get(name)` from hooks onward (→ `null`
when absent, never a throw); `names()`. Contract names and shapes are
defined HERE, never by module ids.

### Contract `ruledata-import` v1

Provider: the location-domain binding target (acks-location). Consumers:
content import flows (acks-content). Shape:

```
{
  importDoc(doc, {priority = 20, source}) → Promise<void>,  // persist + register
  removeDoc(docId, {priority = 20})       → Promise<void>,  // unpersist + unregister
  listDocs() → [{id, priority, source}]
}
```

Persistence (world storage, re-registration on world load, GM permission
checks) is entirely the provider's job; consumers call `importDoc` and
nothing else. No provider registered ⇒ `get("ruledata-import")` is `null`
and import UIs say "no import target installed".

### Contract `ability-provider` v1

Provider: the content binding (acks-content). Consumers: anything that
embeds proficiency/power items on an actor from name tokens (henchmen's
hire-time occupation packages). Shape:

```
{
  resolve(tokens: string[]) → Promise<{ items: ItemData[], missing: string[] }>
}
```

Tokens are printed proficiency names, optionally with a specialty and rank
("Craft (scribe)", "Military Strategy 2"). The provider resolves each to an
embeddable ability ItemData — reusing the world's already-imported item,
else importing the definition from its own pipeline — and reports what it
could not resolve; it never throws on content. The specialty suffix lands
on the embedded copy's name only. No provider ⇒ consumers skip granting.

## `vocab` — Foundry-free enums (Node-importable)

Enum objects are `{ key: { label, … } }`; `vocab.choicesOf(enumObj)` maps them
to `{ key: label }` for DataModel `choices`.

- **Shared with acks-monsters** (value-identical mirror until its deferred
  migration): `DAMAGE_TYPES`, `MOVEMENT_TYPES`, `VISION_TYPES`, `SENSE_TYPES`,
  `NATURAL_WEAPONS`, `ALIGNMENTS`.
- **Ability effect model** (new): `ABILITY_CATEGORIES`, `EFFECT_TYPES`,
  `MODIFIER_TARGETS`, `EFFECT_KEYS`, `CONDITION_KEYS`, `PROGRESSION_CLASSES`,
  `PROGRESSION_LEVELS`, `SPELL_LIKE_FREQ`, `RESOURCE_KINDS`, `ROLL_TYPES`,
  `REROLL_KEEP`, `VALUE_SCALES`, `CONVERSION_STATUS`.
- **Scoping** (v0.6): `INFLUENCE_TONES`, `SCOPE_ALIGNMENT_MODES`.
- **Roll outcomes** (v0.38): `OUTCOME_TRIGGERS` and `outcomeFires(effect, {natural,
  total, target, success})`. An `outcome` effect states "on a roll of X, Y
  happens" — a botch band on the natural die (`naturalBand`/`naturalMax`), the
  result under a fraction of the target (`belowFraction`), or plain `failure`.
  The band edge and fraction are page numbers and locate per-seat; `consequence`
  is a chef conclusion in own words. Owner ruling 2026-08-01: such rules are
  mechanics, never prose. `outcomeFires` returns `null` for "cannot decide" (no
  natural die supplied, number not located) — surface it, never treat as false.

### Scoping — when a modifier applies

`condition` on an effect is free text a human reads. The scoping fields are the
part a machine can decide, and `scopeApplies(effect, ctx)` is the one place
that decides them.

| field | meaning |
|---|---|
| `vsKinds` | target kind tokens (`animal`, `dwarf`, `human`, `demi-human`, `monster`). The token vocabulary belongs to the **consumer** — lib carries the list and matches it. |
| `vsAlignment` | an `ALIGNMENTS` key the target must be |
| `vsAlignmentMode` | `gate` (default) — applies only versus that alignment; `sign` — applies always, negated otherwise |
| `tones` | restrict to some of the three `INFLUENCE_TONES` |
| `optionalRule` | obeys a world setting of this name; **absent means enabled** |
| `kickerAt` / `kickerNote` | a rider that fires when the roll total reaches `kickerAt` (Mystic Aura's 12+ bewitched) |

```js
scopeApplies({ vsKinds: ["animal"] }, { kinds: ["animal"] })
// → { applies: true, sign: 1, undetermined: false }
```

`gate` and `sign` are separate modes because the books write both and they are
different rules: Ancient Pacts is +1 versus Chaotic monsters and nothing
otherwise; Deathly Visage is +2 versus Chaotic and −2 versus everyone else.
Storing either as the other is wrong by double the value, in the direction that
matters most.

**`undetermined` is the field to respect.** It means a scope was declared but
`ctx` could not settle it — an untyped target, no tone chosen yet. That is not
the same as a scope that failed, and collapsing the two makes a bonus vanish
against a target the GM simply has not classified. Offer an undetermined
modifier as a manual toggle; never drop it and never auto-apply it.

### LevelValue

A value that may be flat or a function of class level. `resolveLevelValue(lv,
level, scales)` returns the number at `level`:

| shape | example | @level → |
|---|---|---|
| flat number | `5` | `5` |
| `{ kind:"perLevel", base, per }` | `{base:18, per:-1}` | `18 + per·(level−1)` |
| `{ kind:"breakpoints", breakpoints:[{atLevel,value}] }` | `+1/+2/+3 @1/7/13` | last `value` whose `atLevel ≤ level` |
| `{ kind:"progression", as, atLevel }` | thief skills | `null` — caller resolves via the class table |
| `{ kind:"conditional", on, breakpoints }` | cost by Arcane Value | ladder keyed on `scales[on]`, not level |

A `conditional` reuses the breakpoint ladder unchanged — only the number fed
into it differs — so `atLevel` there reads *"at this value of `on`"*. `on` is a
`VALUE_SCALES` key. Returns `null` when the caller did not supply that scale.

### Rerolls

`{type:"reroll", keep, times, target, rollType}` — `times` counts the *extra*
rolls and defaults to 1, so the common "roll twice" needs no field set.
`resolveReroll(results, keep, rollType)` picks the result that stands, and
`rerollTotal(effect)` says how many to roll.

**"Better" is not "higher."** ACKS throws run both ways: an attack or
proficiency throw is roll-high (`above`), so better is the maximum; a roll
measured against a ceiling (`below`) is roll-low, so better is the minimum.
Pass the effect's own `rollType` and the polarity stays honest.

### Companions

`{type:"companion", ref, actorUuid, amount}` — `ref` is the **monster entry id**
the ability confers. The pointer ships; the creature's text does not. `actorUuid`
is the bucket the actor lands in, empty until the citing book is available or a
GM drops one in, so a bookless seat still gets the slot and can fill it later.

### Capabilities — the gate pattern

A **capability** is what an ability lets you do, named independently of which
ability grants it. Abilities declare what they `provide`; prerequisites, gates
and stacking are written against the capability.

| token | meaning |
|---|---|
| `def.<class>.<slug>` | one exact ability |
| `kw:<slug>` | a capability — any ability providing it |

Either form works anywhere a ref is accepted (`requires`, `ifHas`,
`stacksWith`, `notStacksWith`).

```js
satisfies(abilities, token)       // abilities: [{ id, provides }]
satisfiesAll(abilities, tokens)
capabilityForId("def.prof.sensingEvil")   // "kw:sensingevil"
nonStackingGroups(abilities)      // { capability: [ids] } held more than once
```

This exists because the books print one capability several ways. *Searching* is
a thief skill, a proficiency, and what several class powers hand out — and an
alias prints it under another name again. A gate naming `def.prof.searching`
misses every other route to it; `kw:searching` catches them all. An ability
always implicitly provides its own id's capability, so a gate resolves before
anything has been tagged.

It also collapses aliases and non-stacking into one mechanism: two abilities
providing the same capability *are* that capability twice, so they do not stack.
That falls out of the data instead of being asserted per pair.

### Conversion status

`CONVERSION_STATUS[status]` → `{ label, severity, icon, tip }`, and
`conversionTip(status, name)` fills the `{name}` placeholder. All three are
marked: `renamed` is a note (*"{name} has been renamed for ACKS II"*), `deleted`
a caution, `absent` an info. Read the wording from here so the family says the
same thing everywhere.

## `fields` — DataModel field-builders (Foundry-only, lazy)

Each is a function dereferencing `foundry.data.fields` only when called (at model
definition). Leaf helpers `num/str/bool/html/choice/choiceSet`, plus:

- `levelValueField()` — a LevelValue SchemaField.
- `spellRefField()` — **placeholder** (`{uuid, name}`) pointing at the core
  system's existing spell item. See *Not yet consumed* below.
- `defensesField()` — `{ immunities, resistances, susceptibilities }`, each
  `{ damage:Set, effects:Set, conditions:Set, mundane, extraordinary }`
  (the shape acks-monsters' defenses adopt on migration).
- `speedsField()` / `sensesField()` / `visionField()` — Speed/Senses/Vision
  shapes shared with the monster sheet.
- `effectField()` / `effectsField()` — one typed effect primitive (wide
  all-optional schema discriminated by `type` ∈ `EFFECT_TYPES`) and the array of
  them. This is what acks-abilities stores as an ability's `effects[]`.

### Relational effects — requires / grants / modifies, stacking and chaining

ACKS abilities constantly depend on, confer, or alter *other* abilities, so
these are structured refs rather than free text. Any effect may carry:

| field | meaning |
|---|---|
| `ref` / `refs` | the ability this effect targets (`modifies`), requires, or grants |
| `ifHas` | gate — applies only while the character *also* has these |
| `mode` | `add` \| `replace` \| `set` ("instead of" is a replace variant) |
| `stacksWith` / `notStacksWith` | explicit stacking rules |
| `choose` | for `grants`: pick N of `refs` |

How the book's recurring shapes map:

- **Modifies another ability** — Skulking's *+2 to Hiding and Sneaking throws*:
  `{type:"modifies", refs:[hiding, sneaking], target:"proficiencyThrow", value:2, mode:"add"}`.
- **Conditional override ("instead")** — Alertness searches at 14+, *but if you
  are separately proficient in Searching you get +2 to that throw instead*: a
  base `throw` effect plus
  `{type:"modifies", refs:[searching, listening], ifHas:[searching, listening], value:2, mode:"replace"}`.
- **Stacking rules** — Diplomacy's *+1 reaction stacks with Mystic Aura but not
  Intimidation or Seduction*:
  `{type:"modifier", target:"reaction", value:1, stacksWith:[mysticAura], notStacksWith:[intimidation, seduction]}`.
- **Chaining / partial stack** — Counterspelling is +2 caster levels, *three
  rather than two* with Bright Lore of Aura: the base
  `spellcastingMod` plus `{…, ifHas:[brightLoreOfAura], casterLevelDelta:3, mode:"replace"}`.
- **Prerequisite** — Eldritch Warrior *requires* Eldritch Talent:
  `{type:"requires", refs:[eldritchTalent]}`.
- **Grants a choice** — Expert Traveler *begins play with Driving or Seafaring*:
  `{type:"grants", refs:[driving, seafaring], choose:1}`.

## Not yet consumed (built ahead of the magic work)

These exist so the shape is agreed before anything depends on it. Nothing reads
them today; treat a change here as cheap until magic lands.

- **`VALUE_SCALES.arcaneValue` / `.divineValue` + `conditional` LevelValue.** A
  custom-class power can cost differently by the class's spellcasting value
  ("1 power at Arcane Value 1–2, 2 at Arcane Value 3–4"). The resolver handles
  it; acks-abilities still stores a plain numeric `powerValue`. **TODO(magic):**
  move `powerValue` onto `levelValueField()`.
- **`spellRefField()`.** Points at the core system's spell item by uuid with the
  printed name as a fallback — enough to link and display, but it models nothing
  about the spell. **TODO(magic):** replace with a real spell primitive (school,
  range, duration, save, reversibility, ritual cost) and retire the free-text
  `spell` string on `effectField`.

## Versioning

Semver + `apiVersion`. Additive enum/field growth is a minor bump; a shape
change to an existing field is a major bump with coordinated consumer updates.
Consumers pin `compatibility.minimum` on their `requires acks-lib`.

## Patch layer (v0.10) — what the library adds to the system

The acks system is an **unmodifiable reference**. Anything the family needs
that it does not provide lands here, once. A module patches core directly only
for behaviour unique to its own domain (e.g. acks-abilities owns the ability
roll path); everything shared is here.

### `acksCompatStubs()` / `savingThrowFields()`

`AcksActor` runs for every actor and touches `isNew`, `thac0`, `initiative`,
`movement` and `saves.implements`/`.wand` unguarded — the setup-time
`updateWeightsLanguages` sweep reads them on *every actor in the world*, so one
module actor with an incomplete schema aborts the system's own ready work.

Spread `acksCompatStubs()` into any module actor sub-type's `defineSchema()`.
Four copies of this existed across acks-domains, acks-formation and
acks-henchmen before it moved here; a system patch four modules maintain
separately is one system update away from three of them being wrong.

`savingThrowFields()` is separate, for a sub-type that genuinely saves — same
field paths and initials as the system's own `SavingThrowsTemplate`.

### `acks-lib.animal` — the animal/monster bridge

An animal is a monster you can also buy, load and ride. `AnimalData` mirrors the
monster's field paths (`hp`, `aac`, `thac0`, `movement`, `saves`,
`details.morale`) **on purpose**, so anything already reading a monster reads an
animal unchanged, and adds the shop-and-stable half under `system.animal`:
`species`, `training`, `capacity6`, `unencumbered6`, `mountable`, `cost`.
Loads are in `weight6` (sixths of a stone), the family's only weight unit.

Registered at `init` into `CONFIG.Actor.dataModels`; declared in `module.json`
`documentTypes`.

Animals use the **system's own monster sheet**, registered for the type at
`ready`. The library ships no sheet: the schema mirrors the monster's field
paths precisely so the monster sheet renders an animal unchanged, and a second
sheet over the same fields would just be a second thing to keep in step. The
schema therefore also carries the four fields that sheet reads unguarded
(`pattern`, `counter`, `spells.enabled`, `details.treasure`), for the same
reason the compat stubs exist.

### `mount` — who is riding what

```js
const { mountOf, riderOf, isMounted, mountActor, dismount, unseat } = acksLib.mount;
```

The binding is **symmetric** — stored on both actors — because a combat hook
holds the rider and an encumbrance calculation holds the animal, and searching
every actor for the other end on each read is not viable. Both readers verify
the far end still agrees, so a half-broken pair reads as "not mounted" rather
than throwing. Hooks: `acksLibMounted`, `acksLibDismounted`. A mount need not be
an `acks-lib.animal` — in ACKS plenty of people ride monsters.

This exists because acks-equipment's mounted-combat overlay was blocked on
there being any mounted state in the system at all.

### `itemModel` — the shared item baseline

The system declares `cost`/`weight6` per type, `equipped` separately on `weapon`
and `armor`, and `favorite`/`save`/`pattern` across overlapping subsets — so
every module re-derived "is this physical / can it be equipped / what does it
weigh" with its own type list, and they disagreed.

```js
const { isPhysical, isEquippable, isEquipped, weight6Of, weightStoneOf,
        physicalItems, equippedItems, setEquipped, STONE } = acksLib.itemModel;
```

These read the **schema**, not a type name (`"cost" in item.system`), so they
keep working when the system adds a physical type this library never heard of.
`weight6Of` multiplies by quantity only where a quantity field exists.
`physicalFields()` / `equippableFields()` build a module sub-type's own schema
to match the system exactly rather than approximately.

### `storage` — goods kept somewhere other than on you (v0.39, apiVersion 11)

The system has no inventory anywhere except an actor's own item list, and no way
to move an item between actors at all: its drop handlers **copy** — they create
on the target and never delete from the source. Markets, banks, base camps and
"leave it at the inn" all need that same missing primitive, so it lives here.

```js
const { isProvider, setProvider, findVaultOf, storedItems, storesByOwner,
        providersFor, storedCoinGC, stash, retrieve, moveStored,
        depositCoin, consolidateMoney, returnGoodsTo, STORAGE_HOOKS } = acksLib.storage;
```

**The model.** Stored goods are REAL EMBEDDED ITEMS on a provider actor, stamped
`flags.acks-lib.storage = {ownerUuid, ownerName}`. That is what makes the rest
work: the goods stop weighing on the character because they are genuinely not on
the character, and every sheet, macro and rule that reads an actor's items reads
a location's stock unchanged — nothing has to stay in sync with a parallel record
of what is really where.

A **provider** is any actor carrying `flags.acks-lib.storage.provider`; a
personal vault also carries `vaultOf: <owner uuid>`. This library deliberately
does not know what a "location" is — acks-location's settlement, acks-henchmen's
market actor and the carts a later pass turns into base camps are all just actors
with the flag, so `setProvider(actor)` is the whole of "this can hold goods now".

**Transfers** plan everything before writing, then create on the target *before*
deleting from the source: a half-finished move duplicates goods rather than
destroying them, and the source half failing triggers a compensating delete (with
a loud error if even that fails). Arrivals are normalised — nothing arrives
equipped, the retired `quantitybank` never travels, and acks-equipment's
`containedIn` pointers are remapped when a container travels with its contents
and stripped when it does not. `spec` is `[{id, quantity?}]` — omit `quantity`
for the whole stack.

Arriving stacks **merge into matching rows** rather than piling up beside them:
the system's own merge matches on document ID, which only works for items
sharing an id lineage, so without this a retrieved 20 gp becomes a second "Gold"
row and half a stack of torches comes back as a second torch row. Coin is keyed
on denomination (two gold pieces are the same money whatever their art); every
other stackable is keyed on the whole document minus the quantity, which is
strict on purpose — a torch in a backpack, a torch that costs more, and an item
carrying its own Active Effects each keep their own row, because over-merging
destroys data silently while under-merging is a tidy-up. At a provider the key
also carries the owner, so two characters' goods stay two rows.

**When the place is destroyed**, `registerStorageCleanup()` (installed at init)
applies the world setting **`storageDeletePolicy`**: `return` (default) hands
each owner their goods back inside a container named after the place, `lose`
drops them. Exactly one client executes — elected via `game.users.activeGM`,
unlike the idempotent mount cleanup — because this one creates documents. The
manifest is whispered to chat *before* anything moves, so a failure still leaves
a record. Hooks: `acksLibStorageStashed`, `…Retrieved`, `…Moved`, `…Returned`,
`…Lost`, `…ProviderChanged`.

**Attribution is a UI convention, not a security boundary.** `ownerUuid` lets
sheets group and gate rows; a player with ownership of a shared location can
still reach every item on it from the console — the same ruling acks-equipment
makes for containers. Anything that must genuinely stay secret belongs on a
GM-owned actor.

`providersFor(actor)` scans the world's actors once; call it per render and share
the result rather than per row.

### `acks-lib.template` — the generator actor (v0.16)

The MM's "characteristics by rank/age/tier" creatures (dragon, cacodemon,
elemental) have no stat block — every cell points at tables on the following
pages — and modifier creatures (vampire thrall) rewrite a victim rather than
standing alone. `TemplateData` holds that procedure as a document: AXES whose
options carry **engine-ready patches** (`system.*` fragments, embedded-item
payloads, name pieces, art paths, description snippets), N-dimensional `cells`
refinements, and a rolled special-ability `menu`. The importing module
(acks-content) materializes all of it from the reader's own book; this library
never interprets book content — a bookless template has empty axes and the
sheet says so instead of offering an empty Generate.

```js
const { chooseAxes, resolveActor, rollMenu, rollDie, mergePatch, seededRng } =
  acksLib.templateLogic; // Foundry-free, Node-importable
```

Per-axis precedence is **pinned > derived > rolled**: the Judge pins what they
care about, an axis with `derive.from` reads a dropped base actor (the thrall
keeps its victim's HD, capped), and everything else rolls per the book's own
die over the printed bands (uniform when the page prints no die). Quick use
pins nothing: drop a Dragon template in and Generate yields a rules-legal
random dragon in one click. `resolveActor` merges the chosen options in axis
order, then the `cells` (so a per-age-per-form damage cell outranks the age
row it refines), and composes the name from `output.nameFormat`
(`"{tier} {element} Elemental"`, `{base}` = the dropped actor's name).

The **builder sheet** (`TemplateSheet`, registered at `ready`) shows one select
per axis defaulting to "Roll", a drop zone for the base actor, and Generate;
pins and the base are per-window UI state, never document data. Generated
actors carry `flags["acks-lib"].generated = {templateUuid, choices, log, menu}`
as provenance.

v0.17 additions: options carry actor-level `flags`/`token` channels (a family
variant is a complete creature — sheet extras and token size included) and a
NULLABLE `nameLabel` (null → label; empty string → contributes nothing, so a
Standard role stays out of generated names). Axes may set `multi: true` —
opt-in, never rolled, every checked option applies in list order (stacked
add-ons instead of a combinatorial option list). A dropped base actor now
SEEDS generation (full system/items/flags, patches layered on top), so
templates COMPOSE: generate a Goblin Chieftain, drop it on Vampire Thrall.
The sheet's edit mode adds/removes axes and options and CAPTURES a dropped
actor as an option's preset — hand-built families with no import, post-import
extension, and cross-book merging all ride that one gesture; capturing into
an otherwise-empty template adopts the source actor's TYPE (mounts and pack
animals are container roots too).

v0.18: `mergePatch` understands RELATIVE leaves — `{"$add": n}` adjusts the
existing numeric value instead of replacing it (missing base counts from 0;
only the exact one-key `{$add: number}` shape is relative). This is the
primitive MODIFIER templates build on: an aging template's "−1 STR" patch
composes with whatever base actor it is stacked onto.

v0.19: menu rows may carry a `sub` generation roll ({die, twice?, outcomes:
[{min,max,text}]}, importer-materialized from the ability's own prose);
`rollMenu` resolves it when the row is picked (picks are row COPIES carrying
`subResult`) via the exported `resolveSubRoll`. Never recurses — an outcome
that itself says "roll 1d8+4 twice" stays text for the Judge.

v0.20: `system.base` {merge, flags} is the FIXED foundation applied before
any axis (the stat rows a template page prints as plain values); options
gain `tint` (token texture tint — a dragon wears its hide color), applied
by the builder alongside art and token-size fragments.
