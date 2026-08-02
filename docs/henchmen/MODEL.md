# acks-henchmen — Data Model & Integration Contract

How the module stores data, how proficiencies/powers plug in, and how other
modules extend it. Companion to the local rules extract
(`acks-rules/acks-henchmen/RULES.md`, kept outside the repo).

## 1. Design rules

- **Never write the core system's schema** outside `scripts/acks-adapter.mjs`.
  Sanctioned writes: coin items (`spendGold`/`grantGold`), `system.retainer.*`
  fields, and roster changes via the system's own `addHenchman`/`delHenchman`.
- **Reuse the core hireling plumbing**: hired candidates become real `character`
  actors with `system.retainer.{enabled, loyalty, wage, managerid, category,
  quantity}` set and are pushed into the employer's `system.henchmenList` by
  core `addHenchman` — the stock Hirelings tab keeps working.
- Module-owned data lives in **module flags** (hirelings) or a **module actor
  sub-type** (locations). Rules math is pure (`scripts/rules/`), fed by
  book-cited JSON in `ruledata/`.

## 2. The `acks-henchmen.location` actor sub-type

One actor per settlement (see `scripts/data/location-data.mjs`):

| Field | Meaning |
|---|---|
| `marketClassOverride` / `urbanFamilies` / `domainUuid` | Market-class derivation inputs: override → urban-families bracket (RR 352, local table) → acks-domains courtesy read → default IV. Derived getter: `system.marketClass`. |
| `classRarityTableId` | Which JJ class-rarity variant applies (`default`, `jutland`, or setting-specific additions). |
| `desertRealm`, `compositeVariant` | Camel-troop gate; composite-vs-longbow either/or (RR 164). |
| `postings[]` | One per paid search spec: monthly pool (`totalAvailable`), 3-week `arrivalPlan`, `feesPaid[]`, `monthStartTime`, `status`. |
| `candidates[]` | Plain records (NOT actors): identity, rolled attributes/class/level (feature 4 — recorded, not generated), wage, `availableFromTime`, `status`, `refusals[]`. |
| `slander[]` | Refuse-and-slander registry — the per-town −1 source (RR 162). |
| `searchLedger[]` | Fee history. |

**Extension point**: future domain-family modules (structures/strongholds…)
attach their own data to the same location actor under their own flag
namespace (`actor.flags["<their-module>"]`) — this schema stays minimal.

## 3. `HenchmanRecord` (hireling flag)

Serialized DataModel at `actor.flags["acks-henchmen"].record`
(`scripts/data/henchman-record.mjs`):

- `origin`, `locationUuid`, `settlementName`, `employerUuid`, `hiredTime`
- `rolled.*` — recorded roll results (attributes 3d6×6, double-d100 class,
  1d20 level, template) for the future class-autogeneration module
- `terms.*` — wage + basis, shares (½/½), signing bonus, `lastPaidTime`,
  `arrearsGp`, `vassalDomain`
- `loyalty {start, permanents[]}` / `morale {base, permanents[]}` — the
  ledgers; **effective scores are computed at read time** (base + permanents +
  employer CHA + employer effect bonuses) so transfers recalculate (RR 163).
  Each entry carries `compensated`: RR 166 penalties (permanent wounds,
  tampering side effects) apply only *while uncompensated*, so the Judge
  suspends one from the roster ledger and it stops scoring **without leaving
  the record**. Nothing sets it on its own — not even the wage-arrears repair,
  which compensates instead of deleting so the forgiveness stays auditable and
  reversible
- `counters {calamities, levelsGainedInService, startLevel}`
- `events[]` — capped log (hired, calamity, rolls, wages, wounds, transfer…)
- `special {skipCalamityLoyalty, noSlot, pendingCalamity, irrefusableResult}`

Employer-side flags: `monsterHenchmenList[]` (monster roster — core
`addHenchman` accepts only characters), `retainBonus` (manual extra slots),
`apparent {monthlySpendGp, lastCheckTime}`.

## 4. The Active Effect contract (data-driven modifiers)

**Mechanics live on proficiency/power Items as Active Effect changes — never
hardcoded name lists.** Any effect change keyed `flags.acks-henchmen.<domain>`
feeds that domain (`scripts/effects.mjs` collects them at each roll or
computation):

| Change key (`flags.acks-henchmen.`) | Feeds | Example |
|---|---|---|
| `hiring` | Reaction to Hiring Offer rolls | Diplomacy +1, Beast Friendship +2 (animals) |
| `loyaltyRoll` / `moraleRoll` / `obedienceRoll` | those 2d6 throws | Inspire Courage +1 morale rolls |
| `retainBonus` | henchman limit (4 + CHA + …) | Leadership +1, Blood of Ancient Kings +1 |
| `baseLoyalty` | starting/effective loyalty of hires | Blood of Ancient Kings +1 |
| `henchmanMorale` | employer's morale modifier to hirelings | Command +2, Battlefield Prowess +1 (led) |
| `marketClass` | availability market-class shift | Mercantile Network +1 (known markets) |
| `moraleBase` | base-morale override for hirelings | Utter Domination +4 |
| `skipCalamityLoyalty` | boolean: no loyalty rolls on calamity | Utter Domination |
| `recruitKinds` | unlock henchman kinds (CSV string) | Beast Friendship → `animal` |
| `reactionRollTwice` | roll 2d6 twice, take better/worse | White Luck Presence |

Effect-level metadata (on the effect's own flags, `flags["acks-henchmen"]`):

- `condition` — i18n key/text; its presence marks the bonus **situational**:
  roll dialogs render it as a toggle (GM/player decides applicability).
  Without it the bonus is always-on (locked, pre-applied).
- `target` — scope note appended to the label (e.g. "animals").
- `label` — display override (defaults to the effect/item name).

Interop: hiring rolls **also honor acks-influence's**
`flags.acks-influence.reaction` effects (with their `situational`/`tone`/
`label` flags). Fallback: items named like classic proficiencies with no
acks-henchmen changes are recovered via `config.mjs > NAME_FALLBACKS`
regexes (Leadership, Command, Blood of Kings, Diplomacy…); an item with any
acks-henchmen effect change opts out of name matching. Bribery is detected by
name to select the cheaper signing-bonus scale.

The compendium pack `proficiencies-powers` ships ready-made items carrying
these effects (`tools/pack-data.mjs`).

## 5. Time model

Everything is anchored on `game.time.worldTime` seconds. A GM-client
`updateWorldTime` watcher processes every location idempotently (arrival
tranches, weekly fees, month rollover — watermarked, never double-charged).
Months are day-counted via the `daysPerMonth` setting (the v14 calendar month
component advances 0 seconds). Any worldTime clock works — Simple Timekeeping
is the recommended UI; fallback "Advance 1 week" buttons are gated by the
`advanceWorldTime` setting.

## 6. Public API & hooks

`game.modules.get("acks-henchmen").api` (mirrored to `globalThis.acksHenchmen`):
apps (`openPostingDialog`, `openRecruitDialog`, `openThrowDialog`…), engine
(`createPosting`, `processLocation`, `processAllLocations`, `hire`,
`checkHenchmanLimit`, candidate rollers), `getRecord(actor)`, pure `rules.*`,
`tables`, `adapter`, `effects`, `time`.

Hooks fired (`Hooks.on("acks-henchmen.<event>", …)`): `postingCreated`,
`candidatesArrived`, `candidateRolled`, `hiringOutcome`, **`hired`**
(`{employer, actor, location, record, candidate}` — the class-autogen
module's entry point), `loyaltyEvent`, `loyaltyRolled`, `calamity`,
`wagesPaid`, `wagesMissed`, `rosterChanged`.

## 7. Cross-module facts — the "has X" fallback chain

Facts owned by WIP/future modules resolve through a chain, so those modules
supersede transparently later: **module API (if active) → actor flag →
inventory marker item → GM dialog.** Marker items are plain Items on the
actor whose name declares the fact with its value, e.g. `Stronghold: Border
Fort` (cost 15,000 gp), `Domain Income: 350gp/month`, `Syndicate Member:
<boss>`. Used for: follower stronghold prerequisites, vassal-domain wage
waivers, ruffian syndicate loyalty, urban families.
