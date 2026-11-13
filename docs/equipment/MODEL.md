# Equipment — Data Model & Integration Contract

How this feature stores data, the Active-Effect contract it reads, the API it
exposes, and where its responsibilities end. Companion to
the equipment `RULES.md` extract on the local rules shelf (the RAW source of
truth behind the code enums; local-only, never in the repo).

## 1. Design rules

- **Core is frozen.** The feature never edits the `acks` system source. It reads
  core item/actor data and writes only its own flags plus one managed Active
  Effect that targets real core `system.*.mod` fields.
- **Reuse core fields.** Always-on modifiers are written into the fields core
  already sums (`system.ac.mod`, `system.initiative.mod`,
  `system.attack.mod.melee/missile`, `system.damage.mod.melee`) so the
  system's AC and attack throw consume them with no patch.
- **One owner per wrapped core method.** The system's attack throw
  (`AcksActor#makeAttackThrow` and the modifier and mode methods it reads) is
  wrapped once, by `scripts/lib/patches/attack-throw.mjs`, which asks every
  registered contributor for its labelled rows — that seam is where per-attack
  modifiers that cannot be static go. This feature registers a contributor
  (`scripts/equipment/roll-wrap.mjs`, the rows computed in `attack-mods.mjs`)
  and holds one libWrapper registration of its own, `computeEncumbrance`; a
  second registration against the same target fails `tools/validate-extra.mjs`.
- **The non-proficient package's figures are imported.** `attack-mods.mjs`
  reads the throw a non-proficient character fights with and the further
  penalty a character of no level takes from the equipment document's
  `zeroLevelAttackThrow` and `nonProficientUse` tables (`NON_PROFICIENT_TABLES`,
  declared through `expectTables`); until the Judge's import supplies a figure
  the row it sizes is left off and only the cancelled attribute bonus applies.
- **The dual weapon style's and the heavy helmet's figures are imported.** The
  loadout effect writes the dual style's melee attack modifier from the
  `dualWeaponStyle` table (`effects.mjs` `dualStyleFigure`), and an enclosing
  helmet's surprise modifier from `heavyHelm` (`overlays/enclosing-helm.mjs`
  `helmFigures`, which also holds its Listening and Mortal Wounds figures).
  A Judge's override of either table wins; a figure not imported writes
  nothing. `api.HELM_MODIFIERS` keeps its `{surprise, listening,
  mortalWounds}` shape, read at each access, each figure null until imported.
- **Single responder.** Loadout writes (auto-unequip, effect sync) run in one
  window — the active GM's elected window if one is online, else an owner's
  elected window (`enforce.primaryResponder`, lib's seat election) — and each
  window serialises its own (`queueSync`). Several owners can each pass the
  second, so the effect itself is made one document: it is created under
  `LOADOUT_EFFECT_ID`, a second window's create is refused, and that window
  reconciles the effect the first made. A write another window overtook is
  swallowed only where the effect is already created or gone under it
  (`writeUnlessRaced`). On load the elected window rebuilds the effect of every
  character it owns, once its seat's election has settled; a window still
  joining is elected by nobody.
- **Violation wording.** `enforce.violationMessage` formats
  `ACKS-EQUIPMENT.violation.<type>`; a type with no key reads as the key
  itself. A message names the violation and the items compared, with the page.
  A scavenged item's breakage reads "Breakable" with its page on the sheet,
  the chat card and the layer summary, and states no roll.
- **Data-driven, not name-driven.** Proficiency mechanics live as Active-Effect
  changes keyed `flags.acks-extras.<domain>` on `ability` items, read through the
  shared effect-scan core in `scripts/lib/effect-scan.mjs` with this feature's
  own domain list layered on top. Name matching is only a last-resort fallback.

## 2. Storage map

| Location | Key | Meaning |
|---|---|---|
| Actor flag | `flags.acks-extras.styles` | CSV/array of fighting styles the actor is trained in (adds to the mandatory `single,missile`). |
| Actor flag | `flags.acks-extras.activeStyle` | Player's chosen style when two apply this round (overrides inference). |
| Actor AE | name `Equipment Loadout`, `flags.acks-extras.loadout = true` | Module-managed effect; `changes[]` target core `system.*.mod`; rebuilt on every loadout change; deleted when empty. |
| Item flag (weapon) | `flags.acks-extras.profileKey` | WHICH imported weapon row this is. The top of the identity ladder below; written by Annotate and by the item sheet's Weapon type control. |
| Item flag (weapon) | `flags.acks-extras.grips` | `1h` \| `versatile` \| `2h` — which grips the weapon OFFERS. Answers ahead of the size derivation in `handCost`/`isTwoHandedOnly`/`canOneHand`. Distinct from `grip`, which is the grip a player picked this round out of these. |
| Item flag (weapon) | `flags.acks-extras.category` | Which proficiency CLASS the weapon belongs to (a `WEAPON_CATEGORY` value), read by `classifyWeapon` ahead of the table row's own. Written by the item sheet's Class control; absent = the row's. |
| Item flag (weapon) | `flags.acks-extras.{size,style,damageType}` | Per-item classifier overrides, a Judge's or the sheet's, which outrank the row. Annotate does not stamp them; thrown and handy are read from the item's special properties and the row, never from a flag. |
| Item flag (armor) | `flags.acks-extras.{shieldVariant,strap,masterwork,helmet}` | Overlay metadata. |
| Item flag (weapon/ammo) | `flags.acks-extras.silvered` | RR ch.4 Silver quality. `true` plated, `false` explicitly not, absent = the guess in `silver.mjs` (weapon table, then name). Only `true` applies the price layer — the RAW list already charges Silver Dagger and Silver Arrow their silvered price. |
| Item flag (weapon/shield) | `flags.acks-extras.hand` | `main` \| `off` — which hand the item was drawn into; resolves dual-wield off-hand identity. |
| Item flag (any physical item) | `flags.acks-extras.gear` | `{slots, wornAt, access, holds, capacity, relief, loaded6}` — where this gear MAY sit, where it sits now, the RAW cost of drawing from it, whether it is a container, how much it holds (the figure its price row states, written at import, or typed on its Details tab) and, on a harness, how much it secures (the item's own figure, read from its text by Annotate or typed on its Construction tab). The model and its read path are the lib subsystem's (`docs/lib/MODEL.md`); this feature infers the values (`profiles.mjs` `inferGear`: slots, access, `holds`, relief, `loaded6`) and stamps them (Annotate Equipment, and the importer on every gear and price row it makes), each key only where the item leaves it blank. `capacity` is never inferred; see "Figures the book prints" below. An item that declares no `slots` is read through `wearableSlots` — its inferred places — by every Wear control this feature draws, and `actions.mjs` `wearItem` declares them in the write that puts it on. |
| Item flag (container) | `flags.acks-extras.container.{quality,lockMod,keys,accepts,refusal}` | The lock's quality text and pick modifier, the keys that open it (`[{uuid,name}]`), the kinds it will accept (`item-sheet/accept-kinds.mjs`) and the refusal it gives a wrong drop. Beside the `locked/opened/concealed/fragile` fields `containers.mjs` already holds. |
| Item flag | `flags.acks-extras.pins` | Roll ids the item pins to its art, oldest first, at most two. |
| Item flag | `flags.acks-extras.valueMode` | `priced` \| `unknown` \| `na` — what the value badge reads (`item-sheet/view-model.mjs` `valueBadge`). |
| Item flag | `flags.acks-extras.disguisable` | The Appearance tab offers the disguise drop target. The disguise itself stays `flags.acks-extras.disguise`. |
| Item flag | `flags.acks-extras.destroyed` | The item is wrecked: struck through and tagged, still carried and weighed. |
| Item flag | `flags.acks-extras.chart` | `{sceneUuid, explored, pct, capturedAt}` — the scene a map item draws and its reduced fog-of-war capture (`item-sheet/chart.mjs`). |
| Item flag | `flags.acks-extras.splitFrom` | On an item split out of a stack to be worn: the stack's id, so it can be restacked (`item-sheet/stack.mjs`). |
| Item flag (markets) | `flags.acks-extras.markets.aura` | `arcane` \| `divine` \| `eldritch` — the school a detecting player senses, beside the markets feature's `magic`/`identified`. |

## 3. Effect contract — `flags.acks-extras.<domain>`

Numeric domains replay their changes in Foundry's order (`activeNumericChanges`):
`add`s sum and an `override` sets the figure, the later of two by priority
winning (DECISIONS, "Two overrides of one numeric domain"). CSV domains
collect; boolean-ish domains test presence.
A CSV domain is a set of grants (`collectStringFlags`): an `add`, an
`override` and a `custom` change each join it and a `subtract` takes its
tokens out, so two items that both override `weaponProf` grant both, and the
class training's `add` beneath them still stands (lib DECISIONS, "A CSV grant
is a union"). A single-valued domain reads its one value through
`stringFlagValue`: the highest-priced grant's first token. Add
`flags.acks-extras.condition` (i18n key/text) to an effect to mark its bonus
**situational** → surfaced as a toggle in the pre-roll dialog.

| Domain | Kind | Consumed for |
|---|---|---|
| `handBudget` | numeric | raises the base 2-hand budget (Four Arms, monster anatomy) |
| `styleProficient` | CSV `style` or `style:spec` | trained styles / Fighting Style Specialization |
| `styleInit` | numeric | flat initiative, for a hand-made effect |
| `styleAC` `styleAttackMelee` `styleAttackMissile` `styleDamageMelee` | numeric | flat combat mods, for a hand-made effect |
| `weaponFocus` | CSV | Weapon Focus categories (roll-time nat-20 die) |
| `slayer` | CSV `group:bonus` | Goblin-/Vermin-Slaying (roll-time, situational) |
| `martialWeapons` | CSV | weapon categories added to proficiency |
| `weaponProf` | CSV grant tokens (below) | weapon proficiency from class training |
| `armourProficiency` | CSV | armour categories granted by class training; the heaviest one counts |
| `maneuverTrickery` | CSV | Combat Trickery manoeuvres |
| `damageAttribute` | single value | the score that replaces STR on a damage roll STR modifies (Strength of Faith) |
| `armorTraining` | numeric | armour categories added above class; from an ability, its `modifies`/`armor` row's step times its rank (below) |
| `running` | boolean | +30' speed marker — read by movement modules (formation), not written here |
| `finesse` `preciseShooting` `sniping` `ambushing` `skirmishing` `unarmedFighting` `blindFighting` `mountedCombat` `riding` `berserkergang` `freeSwap` | boolean | proficiency presence tests |

### Armour Training's step

An imported ability raises the wearable armour category through its typed
`modifies` row on the `armor` domain (`abilities-bridge.mjs`
`addTypedEffects`): the row's `value`, a LevelValue read off the page at
import (RR ch. 3 and JJ ch. 12, Armor Training) or a bare number on a copy
whose step was not located, times the ability's rank, whatever the
ability is called. Nothing is keyed on the name, so a copy with no such row,
hand-made or imported without its book, adds nothing. `armourTrainingRows`
lists every ability that carries the row or is named Armour Training (either
spelling) with `{step, rank, steps, cite}`, `step` null where no step was
imported; the Stats tab draws one line per row under the armour rungs, the
rungs it adds with their parts as the tooltip, or "step not imported" and no
figure (`stats.mjs` `armourStepRow`).

The Judge edits the step on the ability's own sheet, in the row's editor
(abilities MODEL, "The Mechanics tab"); a `modifies` row shows its domain
beside its value. Repair in place, with the book open, reads the step again
from the page over that edit; without the book the copy is left as it is.

### The loadout effect writes, and says who wrote what

The managed loadout effect (`acksExtLoadout00`, `effects.mjs`
`buildLoadoutParts` / `syncLoadoutEffect`) is the one writer of the core
fields this feature moves. Each contribution is its own change, priority 20,
in document order, and `flags.acks-extras.loadoutParts[i]` names what wrote
`changes[i]`: `{label}` for an ability or a hand-made domain effect,
`{labelKey}` for one of this feature's rules, plus `itemId`, `target`,
`unverified` and `gated` for an ability's typed modifier (`loadoutPart(effect,
change)` reads it). Typed modifiers come from lib's `standingModifiers`, with
the loadout as the gates' context, so equipping armour drops a gated part.
The effect rebuilds on any equip change, any `acks-extras` flag write, and a
level change. Gates registered here: `lightlyEquipped` (`proficiency.mjs`
`lightlyEquipped`: the armour rung at most `armourMax` and the load at most
`loadMax` stone, null when either was not imported) and `activeStyle`.

Per-actor proficiency profile (not effects): `flags.acks-extras.styles` (trained
fighting styles), `.weaponProficiency` (a CSV of grant tokens), `.armorMax`
(heaviest armour category). Set via the Configure Proficiencies macro.

**Imported proficiency items widen the profile.** A character's ability items
of the weapon-proficiency, armour-proficiency and fighting-style categories,
read through `lib/proficiency-strip.mjs` `abilityContributions` and
`abilityGrants` (the Training pills' own reader), count toward the gate:
`weaponProficiency` reads each weapon pick in the grant grammar below (the
sheet vocabulary's key, else a named weapon, else the class
`weaponTokenClasses` files it under), `armorMax` takes the stated rung as one
more candidate, and `trainedStyles` adds the style. They widen a declared
weapon list or armour limit and never declare one, so a character with
neither stays permissive. A pick naming one weapon passes that weapon while
its pill lights the weapon's class, as a named token from the flag or a
marker does.

**Grant tokens** (JJ p. 290) are the shared vocabulary of `.weaponProficiency`
and the `weaponProf` / `martialWeapons` effect domains:

| token | grants |
|---|---|
| `all` | every weapon |
| `missile:all` | every missile weapon (broad choice v) |
| `melee:<size>` | melee weapons of that size — `tiny`/`small`/`medium`/`large`. Broad choices i–ii are size-based, not category-based, so a **bare size is read as this**: `tiny,small,medium` is broad choice i |
| `<category>` | `axe`, `bowCrossbow`, `flailHammerMace`, `swordDagger`, `spearPolearm`, `other` |
| `<weapon>` | one named weapon, by any name or spelling the imported rows know (aliases resolve: "Great Sword" → `twohandedsword`) |
| `weapon:<key>` | the same, written so it cannot be read as a category where the key is also one; what a per-weapon control writes |

A token outside the grammar matches nothing — `api.classifyGrantToken` reports
which kind a token is, or `"unknown"`. A profile that parses to **no** tokens is
treated as *no profile* (permissive), never as a restriction granting nothing:
the alternative made one typo silently non-proficient with everything.

**What every class throws is not a grant.** A flask, a bottle, a rock, a stick
or a torch is thrown proficiently whatever the grants say (RR ch. 1, Weapon
Proficiency). The classifier marks it `profile.anyoneThrows`: a row of a
throwables kind (`weapon-source.mjs`, from the book's oil, holy water and torch
entries), a thrown row whose printed name calls it a flask, bottle, vial, rock,
stick or torch, anything that bursts (`splash`, or a `splash` custom tag), or a
thrown weapon no row places whose own name says so. No tag marks a throwable:
a Judge's own grenade is classified as every throwable is, through a Weapon
type set on the item that names a throwables row, its name, or a burst. A
category set by hand does not reach it, since the categories are the grants'
and none is a throwables category. A placed weapon is never read by the item's name. `isWeaponProficient` answers yes for it, so
carrying one equipped is never the non-proficient use package; only a melee
swing (`{attack: "melee"}`, a torch) asks the grants, and `attack-mods.mjs`
asks that for the swing alone, as the item roll groups' Non-proficient tag
(`item-sheet/rolls.mjs`) does per mode. The Stats tab's Training pills pass
`grantsOnly`, since they edit grants and the rule is not one.

The same tokens are the keys of the ability sheet's weapon-proficiency boxes
(`lib/vocab.mjs` `SELECTION_VOCAB.weaponProficiency`), and
`lib/proficiency-strip.mjs` `weaponTokenClasses` is the one reading of them at
class granularity — the strips and the system sheet's class-modifiers section
both go through it — and `training-view.mjs` (below) the one reading at the
weapon. Nothing else spells a grant.

### What makes a sword a sword — `weaponIdentity`

One weapon-table row decides everything a weapon does: the proficiency category
a class grant is matched against, the Weapon Focus group, the damage type, and
the size that sets hand cost. `profiles.mjs` `weaponIdentity(item)` is the only
place that row is chosen, and it returns its own provenance so a sheet, a
report and a bug can all say which source answered.

A DECLARATION OUTRANKS AN INFERENCE, and the item's name is an inference — the
only source that can be wrong about an item everything else describes
correctly. Most-authoritative first:

| Source | Read from | Written by |
|---|---|---|
| `flag` | `flags.acks-extras.profileKey` | Annotate, and the item sheet's Weapon type control |
| `mint` | `flags.acks-extras.cookbook.id` (`def.weapon.<name>`) | the importer's weapon-grid recipe |
| `name` | the item's own name, exactly or by alias | — |
| `skin` | `flags.acks-extras.skin.base`, then `.baseName` | `template-packages.mjs` `buildGearData` |
| `loose` | the longest catalogue name the item's name CONTAINS | — |

The exact name keeps its rank above the skin ("Silver Dagger" says more than
the Dagger row it was cut from); only the LOOSE match falls below it, which is
the reading that made a template's "Two-handed iron sword" a medium sword.

`isUnidentifiedWeapon(item)` is the whole ladder coming up empty. Nothing
throws: size, hand cost, damage type and category all fall back to defaults, so
the item rolls and weighs and reads as a medium category-`other` weapon, and a
character trained on it is told it is not proficient. Because it cannot be seen
from the item, it is reported where items are MADE — `importWeapons` warns per
grid row, `materializeTemplates` reports `unidentified`, chargen prints its own
line on the character's card — and corrected on the item sheet's Construction
tab, which carries Weapon type, Class, Size, Grips and Worn at.

## 4. Public API & hooks

`game.modules.get("acks-extras").api.equipment` (mirror
`globalThis.acksExtras.equipment`): `getLoadout(actor)`, `handBudget`,
`trainedStyles`, `specializedStyles`, `classifyWeapon`, `handCost`,
`focusGroup`, `weaponKey`, `weaponIdentity`, `isUnidentifiedWeapon`,
`inferredGrips`, `setWeaponProfile`, `setWeaponSize`, `setWeaponGrips`,
`setGearSlotList`, `annotateItem(item)`, `refreshLoadout(actor)`, the
effect collectors, `config`, `HOOKS`, `VIOLATION`, `roomForLight(actor, type)`,
`unlitInHand(actor, type)`, plus the hand and gear surfaces below.

### Hands: free, committed, spare

Three numbers on the Loadout, and asking for the wrong one is the classic bug:

| Field | Question it answers |
|---|---|
| `handsFree` | What is empty *right now*. |
| `handsCommitted` | What something would have to be **put down** to free. |
| `handsSpare` | Whether there is **room for one more thing**. |

They differ because a lone versatile weapon widens to a two-handed grip to fill
any hand going, and gives it straight back the moment a torch or a map wants it.
That grip is elective, so it commits nothing — and it is elected only where it
costs nothing: the `auto` grip widens when the two-handed style is trained or
enforcement is off, and stays one-handed otherwise, so a default never puts a
character into an untrained style. An explicit `2h` is the player's call and is
honoured. Anything asking "can this character take up one more object?" reads
`handsSpare` (API: `spareHands`) — reading `handsFree` tells a swordsman with an
empty off hand that he has no hands.

**A two-handed grip deals the row's larger die.** `classifyWeapon`'s
`damage2h` (`twoHandedDamage`) is the row's two-handed figure, carrying any flat
modifier the item holds on the row's own die (a masterwork tier, a dent, a
Judge's +1). An item whose die is not the row's has no two-handed figure: a
two-handed grip deals the item's own damage.

**One answer says which die a melee swing deals.** `heldGrip(actor, item,
attackType)` (`attack-mods.mjs`, on the API) reads the loadout's hold
(`wieldTwoHanded`: a chosen grip, or the auto grip, which yields to a second
weapon, a shield in hand or a held light) and answers `{mode, twoHanded,
versatile, formula, declared, key}`. `mode` is `alternate` only for a melee
swing by a character's drawn weapon that is held in both hands and has a
larger die to offer (the item's own alternate, or the row's two-handed figure
of a versatile weapon); every other case is `base`. Everything that shows or
sends a melee die reads it: the Rolls tab's single `atk:melee` row (it shows
`formula`, names the two-handed grip and carries the no-shield note when
`mode` is `alternate`, and `rollById` sends `mode` through
`options.acksLib.damageMode`), the character sheet's Equipment-tab row line,
the Follower Card's melee option (`lib/damage-type.mjs` reaches it through the
equipment API, so lib imports nothing here), and `damageModesFor`'s default,
which puts the held grip's mode first for a caller that names none. Each die
carries a tooltip (`heldDieTip`) naming the grip where the weapon offers a
choice of grips, and whether the die is the item's own or a row's with its
page, or not imported. A hand-set die on a Follower Card replaces the weapon's
base die and is rolled in the base mode.

A weapon whose minimum cost is both hands — a bow, a crossbow, a great sword —
is held in both (`wieldTwoHanded`) whatever else is carried; anything beside
it is a hand overflow, never a one-handed bow. Only a versatile weapon's second
hand is a grip, and only a versatile weapon offers the choice (`canTwoHand`:
the grip changes the cost).

On core's inventory the both-hands bucket is headed by the two hands it spans,
with the grip as the header's note; the character sheet folds the place
(`docs/character-sheet/MODEL.md`).

### The shield and its style

Core's `computeAC` adds the last equipped shield's AC unconditionally. Two
rules say a shield grants nothing, and both are applied through the loadout
effect's one `system.ac.mod` change: the JJ shield-variant overlay
(`shieldACCorrection` — a buckler without Specialization, a shield strapped on
the back, a phalanx shield mounted) and the fighting styles (RR ch. 3 — no
Weapon & Shield style, no benefit from a shield). The Loadout carries the
second as `shieldStyled`, false only while enforcement is live and a shield is
in hand without the style, with the `shieldNoStyle` advisory beside it. The
effect takes the deeper of the two cuts, once: two rules cancelling the same
addition never cancel it twice. The style's own benefit is the shield's AC;
Specialization in it adds its bonus above that.

**A helmet never replaces the suit.** Core's `computeAC` reads its base off
the last equipped armour not typed "shield", and a helmet is armour, so one
put on after the suit stands in for the suit's AC. The Loadout names both
picks: `coreArmorBase`, the item core reads, and `armorBase`, the same pick
with the helmets (`isHelmet`) left out. The loadout effect's
`ACKS-EQUIPMENT.part.armorBase` change writes the difference to
`system.ac.mod`: the suit's AC plus the AC each helmet states, less core's
base. A helmet worn before the suit, or alone, writes nothing; a helmet
stating no AC adds nothing.

**Specialization's bonuses are the proficiency's own rows.** Fighting Style
Specialization's recipe carries one modifier per style, its figure read off the
page's bonus table at import and its gate `specializedStyle` with the style.
The gate (registered in `effects.mjs`) is met while that style is the active
one and the character is specialized in it, a `<style>:spec` token of
`styleProficient` from any copy, and for Weapon and Shield only where the
shield variant lets the shield take it (`specApplies`). The row then arrives
with the abilities' typed modifiers, named for the proficiency. A hand-made
`styleProficient` token still trains the style and still decides the shield
correction; it carries no figure of its own.

`formationHands(actor)` gathers the hands held full by something other than a
drawn weapon or a shield in hand: the actor's burning lights (lib's
`bearerLights`, which reads the party sheet's record for a member and the
actor's own flag for anyone else — a lone character's lit torch costs the
same hand a member's does), the hands the mapper's kit takes
(`handsOccupied`, the formation feature's count), and the kit items it lists
at them (`kitInHand`, the quill then the parchment the mapper carries, less a
piece stowed in a container).

**A light burns in the hand that holds it.** A readied torch in hand is a
weapon flagged `light`; a burning record is the party sheet's or the actor's
flag. Both describe one torch, so each drawn light source absorbs one burning
record of its type (`lightsInHand`, each with the record it absorbed), and
only the records left over — a lantern, a torch lit from the stack, a torch
burning with its weapon sheathed — hold a hand of their own (`heldLights`).
A sheathed torch's record keeps burning and keeps its hand: the record is the
authority on whether the flame is lit, the weapon on where it is. Striking a
light asks `roomForLight(actor, type)` (API) before it asks for a spare hand:
a source of that type drawn and unlit is lit where it is. `unlitInHand(actor,
type)` names that source, and lib's `prepareToLight` and the formation
feature's Judge override both ask it: a flame struck on a torch in hand
empties no hand (emptying one sheathed the torch itself) and spends nothing
off the stack it was readied from — the torch in hand is the gear, and burns
on its own timer.

**The clause names the hands no listed row explains.** `heldHandsClause(source)`
turns a Loadout — or a hand-overflow violation's `detail`, which carries the
same counts — into a display clause: the burning lights no drawn source
absorbed (`heldLights`) and the kit hands no row lists (`mappingUnlisted`,
the kit hands less the kit shown at the hands). The Worn & Wielded status
line, the character sheet's hands badge, the `handOverflow` violation, the
auto-unequip notice and lib's light refusal (through the API's
`heldHandsClause(actor)`) all append it. A total the visible gear cannot add
up to reads as a miscount, and sends the player unequipping things that were
never the problem; a lit torch listed in hand and a quill listed in the main
hand explain their hands themselves.

A torch is carried as a stack (an `item`, `equipmentClass` `prepareAs: weapon`)
and held as a weapon: `prepareTorch(actor, stack, {draw})` readies one — a
light weapon at the torch row's damage, under the torch's own name, one off
the bundle — and with `draw`
puts it in hand at once. The stack itself declares no place and is never worn,
so "equip a torch" is that gesture: a stack dropped on a hand place, or its
sheet's Equip control, readies one torch into the hand, where the hand count
charges it like any weapon. Dropped anywhere else the stack is refused as gear
declaring no such place.

The mapper's kit is held, not worn: `wearLocation` lists the loadout's
`mappingKit` at the hands — the quill in the main hand, the parchment in the
off hand — ahead of the worn gate, so the character sheet's places and core's
inventory buckets both show what the mapping hands hold. The rows are plain
items with no wear control; the character sheet's row says *held for mapping*
and counts the piece against the hand's capacity like a weapon.

Putting a carried item at a body place is `placement.mjs` `placeItem`: a
weapon is drawn into the hand named, anything core equips is equipped, a torch
stack on a hand readies one, and anything else is worn at the place or
refused. The character sheet's place drop and the official-sheet import both
call it, so the two never disagree about where a thing ends up.

### Giving gear, and making room for it — `grant.mjs`

`grantGear(actor, specs)` puts gear in a character's pack, preferring a world
item or compendium entry over a synthesized stand-in — a granted torch should
be the system's torch. A spec with a `name` takes the entry of that name. A
spec without one is gear known by what it is: `findGearByPattern` takes, among
the items its `pattern` matches, the stack holding the most by
`system.quantity.value`, the world's items before any compendium's, so a light's
fuel arrives as a bundle without any count written into a name; its stand-in
is named by the spec's `label`. `clearHands(actor, n)` sheathes held
gear (shields first, then weapons newest-first) until there is room, and reports
what it put away; it can fall short and says so, because hands full of lit
torches are not freed by sheathing anything.

Neither decides *whether* a character should be given anything. That is a rule,
and it stays with the feature holding the rule — see the formation feature's
[judge-override](../formation/MODEL.md#the-judges-override).

Hooks fired — prefixed with the camelCase namespace `acksExtras` per
acks-module-template `docs/TOOLCHAIN.md` §5b (shared registries carry the module
key): `acksExtras.loadoutChanged (actor, loadout)`,
`acksExtras.equipBlocked (actor, item, {reason, resolution})`,
`acksExtras.purchased (actor, item, cost)`,
`acksExtras.preRollAttack (actor, item, mods, ctx)` — our own pre-roll hook,
and the shape proposed for a future core `acks.preRollAttack` — plus
`acksExtras.lockPicked (actor, container)` and
`acksExtras.containerBashed (actor, container, {fragile})`.

Pack document `_id`s carry the prefix declared in `module.json` at
`flags.acks-extras.idPrefix` (validator enforces it once declared).

## The mounted overlay

`overlays/mounted.mjs`, gated by `overlayMounted` — the overlay §15's
research describes, resting on the lib's record of who rides what. It
automates the STRUCTURE: **staying-mounted save prompts** (after every
attack by a mounted rider or a ridden mount, unless the rider holds Riding
or Mounted Combat — the lib's `POST_ATTACK_HOOK` seam; and whenever either
half of the pair takes damage without a military saddle among the mount's
tack, waived only by holding both proficiencies — the fall is marked by the
pre-update on the client that makes the change
(`options["acks-extras"].mountedHpFell`), and `updateActor` on the primary
GM's client speaks, once, whoever dealt it), whispered to the Judge and the
rider's player, rolled and adjudicated at the table; and the **action-economy card**
(`api.equipment.mounted.mountedCombatCard`): who may act by what the mount
did, a war-trained mount joining the charge, and the vehicle mirror for
transporters keyed on the vehicle's `carriage` (a back-carrier fights, a
puller only joins a charge, a palanquin's bearers never). The proficiencies'
printed attack bonuses and the subjacent height-advantage number are NOT
pushed into the roll: those values arrive with the imported abilities, and
automating them waits on the abilities→attack effects bridge
([ROADMAP.md](ROADMAP.md)) — the card states that they apply.

## 5. Boundaries with sibling features (in force)

- **formation** owns encumbrance→speed, light/ration consumption. This feature
  never writes `system.movement.*` and never re-implements encumbrance; it wraps
  `computeEncumbrance` (see §1) only to apply the RAW rules core's flat sum gets
  wrong, so formation keeps reading one consistent core value.
- **lib** owns coin: counting, valuing, weighing and moving it are
  `lib/money.mjs` and the stack half of `lib/item-model.mjs`
  (docs/lib/MODEL.md, "Currency"). This feature states a coin's rate on its
  sheet and puts the purse's weight into a character's encumbrance; it never
  writes a coin row's count outside the sheet's own quantity field.
- **monsters** owns gear storage and the `DAMAGE_TYPES`/`NATURAL_WEAPONS`
  enums, read raw/soft so a monster with no stat block still resolves. The classifier's `damageType`
  aligns to them.
- **Surprise** determination + the `surprised` status are core's; this feature
  only reads them (first-round interrupt helpers).
- **abilities** owns the companion slot — the `companion` effect on an
  ability and its `actorUuid` pointer. This feature only injects the slots into
  the SYSTEM sheet's inventory as a **Companions** section (`sheet.mjs`
  `buildCompanionSection`); the module's own character sheet lists them on its
  Equipment tab. Both forward their controls to `abilities/companions.mjs`;
  nothing is stored for a companion here (`docs/abilities/MODEL.md`).

## 6. Shared library — BUILT (`scripts/lib/`)

The Active-Effect modifier collector, the DOM-injection idiom and the
`DAMAGE_TYPES` enum were duplicated across the pre-merge modules. They are now
single implementations under `scripts/lib/` — see [`docs/lib/MODEL.md`](../lib/MODEL.md)
— and this feature layers on them rather than vendoring copies. `build-packs.mjs`
is a synced template file with one `tools/pack-data.mjs` behind it.

Overrides of core logic default to `lib`; this feature patches core directly only
where the behavior is unique to equipment, and §1 says which and why.

## The item sheet

One sheet for weapon, armor, item and money documents (`scripts/equipment/item-sheet/`),
registered at `init` as the default for those four types. It is this module's
own `HandlebarsApplicationMixin(ItemSheetV2)`, not a subclass of the system's
sheet: nothing in it depends on the shape of core's templates.

**Three layers.** `snapshot.mjs` reads the document into plain data through the
feature's own accessors (the container record, the named record, the property
layers, the gear model, the markets flag). `view-model.mjs` makes every
decision about what to show on that data — tab order, the simple-mode
collapse, the pin FIFO, the value badge, identification and disguise gating —
and is pure, so `tools/test-item-sheet.mjs` asserts it offline. `sheet.mjs`
binds the decisions to Foundry: the form, the actions, the drops, the chrome.

**Tabs exist only when earned**, always in the order Rolls · Chart ·
Durability · Effects · Contents · Appearance · Details. Rolls, Effects and
Details are always defined; Chart needs a bound scene, Durability a physical or
damaged or container item, Contents a declared capacity or a spell book,
Appearance a Judge and a magical or disguisable item. An item that earns
nothing beyond the always-on three — coin, gems, a trinket — is **simple**: no
tab strip, no state rail, and a quiet Details button that unfolds the one
panel. Anything with somewhere to be worn is not simple — a belt whose slot
is only inferred from its name included (`snap.wearable`) — and neither is a
torch stack: each earns the state rail's equip cell, the torch stack's
readying one torch into the hand (`snap.readiable`), since the stack itself
is never worn.

**The band is the window header.** The title band renders as its own part and
`_onRender` moves it into Foundry's `.window-header`, where it keeps the drag
handle and the close/controls buttons while its inputs stay inside the form.
A pointer press on any control in the band is stopped before the header's
drag-start sees it. On re-render the mixin cannot find the moved part inside
the content and appends a fresh one, so the stale band in the header is
removed first.

**The band types the two numbers it reads.** Weight is a field in sixths
(below). The value badge is a field for the LISTED price wherever the badge
would read the plain value (`valueBadge` reason `value`): an apparent worth, a
disguise's value, an unappraised or unsaleable mode is set where that state is
set, and the badge stays a reading there. The field submits under its own name
(`acksBandValue`), as the Details ledger's copy does (`acksListedPrice`), and
each writes only when it is the control that fired — the same rule as the
quantity badge (DECISIONS, *A derived control writes back only when it is the
control that fired*). Where the layers change the price, the worth they make
of it reads beside the field.

**A field the layers write is typed as it reads.** With layers applied
(`properties.mjs`, the `pristine` snapshot), the Record panel's damage, bonus
and AC and the band's St read as the layers make them. A value typed into one
goes into the snapshot less the layers' delta (`baseForTyped`), and the fields
are recomputed from it, so the next layer change keeps what was typed. Only the
control that fired moves the snapshot.

**A coin's band states how many make a stone.** On a `money` document the
weight badge is replaced by **Per stone**: the rate in force
(`perStoneOf`), with the stack's weight beside it. In edit mode it is a field
for the coin's own rate, `flags["acks-extras"].gear.perStone`, whose
placeholder is the system's rate; blank, zero and anything that is not a
count store `null`, which leaves the weighing to the system. The Record panel
binds the same path, and the band's copy submits under its own name
(`acksBandPerStone`) by the rule above. A coin's value badge is its count at
its rate and is never a field, its ledger is that one line, and it is offered
no appraisal mode. A coin row is a stack at any count, so its quantity badge
shows at one, and at none on a row a hand emptied; a payment that empties a
row removes it.

**Sibling changes re-render it.** The sheet shows facts held on other
documents — what is stored inside it, the variations applied to it, whether
the bearer holds Lockpicking — and a document sheet re-renders only on its own
updates. `_onFirstRender` watches the Item/ActiveEffect/Actor hooks for
documents in the same collection and re-renders, debounced; `_onClose`
detaches them.

**Rolls are never invented.** `rolls.mjs` gathers a weapon's attack modes
(the system's own throw, its kind of attack named and the one melee row
sending the held grip's damage mode through `options.acksLib`), the
manoeuvre overlay (an attack with `options.acksLib.maneuver`, whose penalty
the contributor adds as a row), a spell book's formulae (listed, not rollable)
and the lock rows (`locks.mjs`). A row gets a Roll button only where a real
path exists.

**Gating.** A player sees a disguised item as the document is — the disguise
WRITES the apparent fields — so the sheet adds nothing for them; a Judge sees
the true name and description from the disguise flag, a Masked chip and a
striped border. A magical item hides its own effects and shows its apparent
value until `markets.identified` is `full`; the aura shows from `partial`.
Grants from the bearer stay visible throughout. The condition tag in the band
reads off the real condition whatever else is masked.

**Editing is armed, not assumed.** `editable` is the permission; `editing` is
the permission AND the editor rail's pencil, held on the sheet instance and
reset on close. Every control that writes the document (the band's fields, the
Details fields, the construction controls, the effect and key removers, the
drop zones) is disabled until armed; the use-actions (equip, roll, pin, take
out, add or configure an effect, identify) answer to `editable` alone. While the
sheet is locked for a viewer who may edit it, a disabled control with no
tooltip of its own names the pencil when pointed at (`#hintLockedFields`). A
control in the header band keeps its pointerdown and double click from the
window header, so pressing or double-clicking the name neither drags nor
minimizes the window.

**One Add effect control.** An effect is added from one control, `addEffect`:
the Effects tab's own group and, for an item with no effect (the simple view,
which has no Effects tab), the footer beside Details. It opens a small choice,
a blank effect or a magic light (`effect-starts.mjs`, `EFFECT_STARTS`), then
creates the effect transferred to the bearer and opens its config sheet.
Closing the choice creates nothing. The light start writes both radius changes
as `upgrade` with no figure (lib MODEL, Senses), so the Judge types the feet
from their own copy.

**Construction is one shape.** `item-sheet/construction.mjs` builds the
Details tab's Construction rule over the pure `construction-model.mjs`: a
select for every registered single answer, with *Auto (guess)* first wherever
the module infers; a strip of toggles for every registered set, showing every
option, with a declared option solid, an inferred one dashed and an *Auto*
chip that returns the set to inference; and *Other tags* for free text. The
strips are grips, the system's weapon qualities as Qualities (its `melee` and
`missile` booleans and every key of its `special` field, each read from and
written to that field; *Other tags* is its `customTags` set),
and the `WEAR_SLOT_ORDER` places as Worn at, where a weapon's hand places are
locked and no place lit while declared is `gear.slots = []`. The Class select
is the character sheet's `CATEGORY_TOKENS` vocabulary and writes
`flags.acks-extras.category`. A quality writes the system's own field and,
for melee/missile/slow, the boolean field beside it; a stored tag is matched
by the slug of its key, label or raw value, since core's registry reads as lang
keys in source and as localized words in a running world. The markets feature's magic panel mounts under Appearance for
the Judge and, for an owner identifying a magical item, under Details.

## 2026-07-24 — containers live on the sheet; locks roll the character's own proficiency

Containers have no window of their own: the equipment tab holds their controls,
and a container opened next to the gear it holds matches the gesture at the
table.

**Gear moves by drag, both ways.** A container's bucket is a drop target that
stows what lands on it; every one of core's inventory lists — Weapons, Armor,
Items, Clothes, Money — is a `loose` target that takes gear back out. All of
them, because the lists are split by item type and the drop happens wherever the
item belongs: wiring one makes un-stowing work only for gear whose type core
printed first.

**Visibility is inherited from ownership, gated by the lock.** Picking up a
locked crate tells you that you are carrying a locked crate, not what is inside.
Two flags rather than one — `locked` is the lock's existence, `opened` records
that it has been defeated — because picking a lock does not remove it and the
Judge should not have to re-describe the lock to shut it again.

### Weight, and the bundle

Weight is stored in `system.weight6` — sixths of a stone, core's own unit — and
is typed that way on the item sheet's band. The stone reading rides beside the
field as a label.

`gear.per` says how many units one stated weight covers. It is 1 for almost
everything, meaning the weight is per item and quantity multiplies it. For goods
the books rate by the bundle — a quiver of arrows, a set of spikes — it is the
bundle's size, and `weight6Of` counts one bundle's weight per started bundle:
twenty-one arrows out of a twenty-arrow quiver weigh two, because a part-used
bundle is still one item.

Annotate declares `per` from a name that states its load ("Quiver, 20 Arrows")
and never overwrites one already declared. It does not write the count: that
is core's `system.quantity.value`, arriving with the item from the compendium,
the importer or the Judge, and Annotate leaves it as it finds it.

Core's own encumbrance loop multiplies `weight6` by the whole quantity and
cannot be changed, so `encumbranceDelta6` contributes the difference. That is
the only place the two sums are reconciled; `coreWeight6Of` exists to say what
core counted so the delta can cancel exactly it.

Coin is reconciled there too. Core lumps every coin on the actor into one
purse and counts it in whole stones (`getTotalMoneyEncumbrance`), so the delta
takes that figure back out and puts in `sumWeight6` of the coin rows, which
weighs each row's count against how many of that coin make a stone and keeps
the part-stone (RR ch. 1, Speed and Encumbrance). Where any coin row has no
rate to weigh by, core's figure stands whole. The wrapper is registered at
`setup` (`registerEncumbranceWrap`), apart from the attack-roll wrapper and
before the roll-automation setting is read, so a load is weighed the same
with that setting on or off. That is after the world's actors were first
prepared, so every world character is prepared again once it is in place; a
load is the same figure at world load as after the first edit.

Annotate reads a coin's rate from the item's own text where it states one
(`perStoneStated`: a count of coins set against a weight in stone) and writes
`gear.perStone`, leaving a rate already on the item alone. Both of its
surfaces sweep coin: the sheet's control beside the stowed section, and the
macro, whose notice counts coin stacks apart from weapons, carrying devices
and other items.

The band therefore prints two numbers where they differ: what one bundle weighs,
and what the whole stack costs the bearer.

The **load is never hidden**. A locked chest still drags on encumbrance, and
concealing its weight would make the number on the sheet unexplainable. This is
a UI rule and not a security boundary: contents are ordinary items on the actor
and Foundry replicates them to their owner regardless. It means "the sheet does
not tell you", which is what a locked chest at the table means. Anything that
must genuinely stay secret belongs on a GM-owned actor.

**No throw is invented.** The module ships no target for picking a lock or
bashing a chest because it has not read one off anyone's page (scans locate,
recipes interpret — a fabricated target is worse than no automation). `locks.mjs`
finds the character's own Lockpicking or Dungeon Bashing item and rolls it
through the abilities feature's roller, so the number comes from the reader's book by
the same path every other proficiency throw does. Missing proficiency, missing
roller, or an ability with no throw are all reported as such and left to the
table. Proficiency names are matched on a normalised prefix, because the shipped
compendium, the RR register and a hand-made item spell them differently
("Lockpicking" / "Lockpicking Expertise", "Dungeon Bashing" / "Dungeonbashing
Expertise") and this module should not maintain a rename table.

Enforced RAW: gloves block lockpicking (RR p. 145). Bashing destroys the
container; a `fragile` one takes its contents with it.

## 2026-08-01 — never re-fire another application's hooks

The doll's header button does not obtain its click handler by re-firing core's
`getHeaderControlsActorSheetV2` into a scratch array and reading the entry Paper
Doll pushed. That looks like reuse and is not: `Hooks.callAll` runs *every*
registered listener, so borrowing one module's entry ran all the others'
side effects too — dice-so-nice dereferenced `app.document` unguarded and threw,
and Paper Doll's own listener re-armed its auto-open timer. **A hook belongs to
whoever fires it.** Read another module's published surface (`ui.paperDoll` is
the doll's own class) or its documents; never re-fire its hooks to get at data.

The second half of the same bug was the render gate. `renderApplicationV2`
offers every ApplicationV2, and `app.actor?.type === "character"` is true for a
great many windows that are not a character sheet — the doll's own window among
them, which also draws a `.window-header` and so looked injectable. The gate for
"is this a sheet" is the **document** (`app.document?.documentName === "Actor"`),
never the presence of an `.actor`.

Reconciliation writes once. `syncActorToDoll` plans every placement against one
in-memory `slots` object and issues a single `setFlag`, because that flag write
fires `updateActor`, which the doll answers with a re-render, which calls the
reconciler back. One write per item made opening a doll a write→render→reconcile
storm; one write per pass settles in a single no-op follow-up.

## Base types and variations

**What an item IS** is a flag, not a document type: `flags["acks-extras"].baseType`
naming one of weapon, armour, shield, clothing, gear, food, gem, coin or trade
good. It REFINES the document type rather than replacing it — core's `actor.mjs`
derives AC, initiative and encumbrance straight from `item.type`, so plate stays
an `armor` document and a gem is an ordinary `item`. `BASE_TYPE_DOCUMENTS` says
which flag may sit on which document, and a base type its document cannot carry
is refused whether it was declared or guessed.

For an item with no declared flag, `base-type-infer.mjs` guesses from the
document type and name using the same clothing patterns and gear profiles the
rest of the feature reads. It reads core's clothing subtype first, which is a
declaration, not a guess. The declared flag always wins. The importer writes no
base type, so the guess answers for every imported item.

**Clothing is declared on two fields that say one thing.** The flag is what the
rail shows; core's `system.subtype` is what core leaves out of the weight
(`isClothing`, mirroring core's encumbrance). A create or update that moves one
of them gets the other in the same write: `clothingDeclarationPatch`
(`base-types.mjs`), applied by the `preCreateItem`/`preUpdateItem` hooks in
`clothing-declaration.mjs`. So the rail, core's sheet, the importer, a macro and
the API all end in the same weight. When one write moves both apart, the flag
wins. A write that moves neither leaves an existing disagreement alone, and
Annotate writes the flag's half through where the flag says clothing. The item
sheet has no subtype control of its own; the rail is the one control. Clothing
sits on `item` documents only, because core weighs every `armor` document
whatever it is flagged.

**How one item DIFFERS** is its CONTENTS. A variation is an
`acks-extras.variation` Item flagged `containedIn` at the item it changes —
the same relation gear in a backpack uses — so it is applied by dragging it on,
listed under what it changed, and removed by taking it off. One verb set covers
every kind of difference (`variation-items.mjs`).

Each variation document carries both halves at once: what masterwork MEANS
(`deltas`, `cost`, `appliesTo`, `supersedes`) and what is true of THIS one
(`hidden`, `read`, `data`). `entryOf` and `definitionFrom` split them for the
pure rules in `variations.mjs`. Applying COPIES the source, so re-importing the
register cannot revalue a blade a Judge already priced.

Containment resolves against whatever collection the item is in — an actor's
items when it is carried, the world's when it is loose (`siblingsOf`). A
compendium item holds nothing, because its pack is not loaded and an empty list
would be a guess rather than an answer.

- **Conflict is derived from the key's namespace.** Two entries clash when their
  keys share a prefix, so an item has one masterwork tier and one shield form,
  while a scavenged masterwork silvered buckler is four families and legal.
  Nothing is authored, so nothing can be authored wrong. A printed cross-family
  rule is a definition's `supersedes` and is enforced in both directions.
- **Definitions are imported**, never shipped. They arrive as a compendium of
  variation documents from the importer; what a base TYPE records arrives
  separately as field specs in the lib's ruledata registry
  (`variation-defs.mjs`). A world that has imported nothing has no variations to
  drag, and a Judge can still make one by hand on the Items tab — the same
  first-class path a trap has.
- **`hidden` and `read` are different questions.** Hidden is whether they know
  it is there; read is whether they know what it means. An inscription in a
  language nobody present has is visible and unread — not hidden.
- **Hidden governs presentation, never mechanics.** Deltas count every entry, so
  a disguised magic sword still hits as one. True and apparent value come from
  one resolution over two subsets, so the price is never stored twice.
- **Conditional value is gathered, never applied.** Who the buyer is and what a
  crest is worth to them are facts the world holds; the module offers the claim.
  `audience` is a Judge-read string, not a structured vocabulary — a market
  surface offers the claim and never matches it automatically.

`layerDeltas` sums applied variations alongside the flag layers (masterwork,
silvered, scavenged) into one delta set, sharing the cost order documented
above. A flag OWNS its family: applying a `masterwork.*` variation to an item whose
masterwork flag is set is refused by name, because the two would otherwise both
count.

**The silver and masterwork flags read the imported documents**
(`printed-layers.mjs`). `config.SILVER` and `config.MASTERWORK` hold no figure:
`SILVER.variation` and each `MASTERWORK` tier name the key of the variation
document the importer mints (`material.silver`, `masterwork.<tier>`, the
damage tier registered as `weaponDamage`). `libraryVariation(key)` finds the
library's copy, the world sidebar's before a shelf's, skipping any variation
applied to an item. The figure is that document summed by `sumDeltas`, the
rule an applied variation follows, so `layerDeltas`, the price ledger and the
Net row all read one answer.

- **No document, no figure.** An absent document, or one carrying only the
  schema's neutral figures (an import whose locators did not read), answers
  null. The layer then applies nothing and the flag stays recorded, so the
  layer takes effect on the next import. Nothing falls back to a constant.
- **The surface says so.** `unstatedLayers(item)` lists each layer an item is
  set to whose document is missing. The Details tab's price ledger shows that
  layer's line with "not imported" in place of a figure, and the Net row on the
  Construction tab names it.
- **Each figure carries where it came from.** The ledger line and the Net row
  take a tooltip: the page the document's import stamp cites, "set by hand" on a
  document with no import stamp (a Judge's own), "edited by hand" with the page
  on a minted document whose figures differ from the ones its stamp records as
  read (`cookbook.read`), or "not imported" naming the variation key to import
  or make. A document whose stamp records no figures has nothing to compare
  and cites its page. A Judge's edit to the document is the
  override; the registry's override layer holds tables and these are items. A
  repair rewrites the figures and the stamp together.
- **The weapon-table tag stays structural.** `SILVER.quality` is the tag the
  weapon list marks a silvered row with, read by `silver.mjs`.

## Weapon rows — `weapon-rows.mjs`

The importer mints a core `weapon` item per printed row of the seat's weapons
grid (`def.weapon.*`), writing size, melee and missile, the special qualities,
the cleave limit, the base and alternate damage and its damage types into the
system's own fields, and the grid sub-header the row sits under into
`flags["acks-extras"].weapon.block`. `weapon-rows.mjs` reads them back and
registers the `weapons` ruledata document at WORLD priority, table `grid`, one
row per weapon: `name`, `block` (null where the row sat under none), `size`
(null where the system's size is `na`), `melee`, `missile`, `thrown`, `handy`,
`special`, `cleaveLimit` (only on a weapon that cleaves), `damage`, `damage2h`,
`types` (the item's own base damage types, sorted) and `cite`. The row states
itself: which category, focus or damage type it belongs to is the resolver's
question (`lib/weapons.mjs`, `docs/importer/MODEL.md` "The weapon lists"), asked
of the row's name and block.

- **The key is the tail of the item's mint id** (`def.weapon.<tail>`), folded
  to lowercase letters and digits. It is what the grid printed and nothing the
  module knows about weapons, so no table of names has to exist for a row to be
  found, and renaming an item does not move its row. Where two items carry one
  mint id, library order decides.
- A row is exactly what the item carries. An item whose structured fields were
  never written yields no row: it holds the system's
  defaults, which a live document always has, so the mark is shape (a melee
  weapon with no size, or a quality word kept as a custom tag while its special
  property is unlit). An item the importer did not mint yields no row either.
- Each row's `cite` is the item's stored citation, so a tooltip can name the
  page; the table's own `cites` entry is set when every row shares one.
- It publishes once the library has loaded, and again on create, update or
  delete of a library weapon (a weapon on an actor moves nothing). A delete
  leaves the deleted document out explicitly, since its hook can fire while
  the collection still lists it. With no row left the document is withdrawn.
- **A reader waits with `rowsReady()`**, which resolves when the first
  publication has landed (also where it failed, which is logged), and at once
  where the publisher was never registered. **An action a user starts waits
  with `rowsSettled()`**, the same wait bounded at `ROWS_WAIT_MS`: it holds
  until the publication lands, which it does with zero rows in a world that
  imported none, and a publication that never lands releases it with a warning.
  The actions that wait are the draw (`drawItem`, `drawInto`), readying a torch
  (`prepareTorch`), every loadout write (`onUpdateItem`'s resolve step and
  `refreshLoadout`, inside the per-actor queue) and the attack throw, through
  the attack contributor's `ready` (`lib/patches/attack-throw.mjs` awaits every
  contributor's `ready()` before it builds the throw, so the kinds of attack,
  the grips, the proficiency gate and every row are answered once, from the
  rows). An action started in the load window therefore reads what one started
  long after it reads. **A reader that redraws listens
  for `acksExtras.weaponRowsChanged`**, fired once, 50 ms after the last
  publication or withdrawal of a burst. Neither is exposed on the module api
  yet; no consumer reads the document.
- Every reader of the weapon table asks `lib/weapons.mjs` (docs/lib/MODEL.md,
  "The weapon seam"); the source equipment registers there at `init`
  (`weapon-source.mjs`) reads this document, with the `weaponLists` document
  that places each row, and nothing else. See "Weapon rows read from the
  book" below.

**Field specs** (`lib/field-spec.mjs`) are how both a base type's metadata and a
variation's own storage get rendered without being shipped: a definition
declares its fields as data and one renderer builds the form. A spec naming a
kind this version cannot render is reported by name rather than dropped.

## Weapon rows not imported — what every reader does

Every reader of the weapon table asks the weapon seam, and the seam answers
empty where no rows are registered, so each reader has a defined answer for a
weapon, a size or a class nothing imported states. Undecided never penalises.

- `classifyWeapon` states `size` and `cat` as null and the die as "" where
  nothing states them: not the item (a flag, the system's own field, its die)
  and not a row. No stand-in figure exists for a weapon no row places, with or
  without rows imported; a row that leaves a figure out leaves it unstated.
- `grantVerdict(token, profile)` is true, false, or null where the figure the
  token asks of the profile is not imported (a size grant against no size, a
  class grant against no class, a weapon name when the table holds no rows).
  `grantMatches` is the true case. `isWeaponProficient` reads a weapon that
  no grant covers and some grant cannot decide as proficient, except for the
  Training pills (`grantsOnly`), which light only for a grant that covers it.
  `weaponProficiencyDecided` names the undecided state for a surface. A token
  outside the grammar is still false, never null, while the table holds rows.
- A size nothing states is one hand: `handCost` is 1 for either grip,
  `canOneHand` is true, and the Auto grip is `1h`.
- `weaponUnits()` is empty with no rows, `canonicalGrant` of no units is "",
  never `all`, and a grant covers nothing.
- `readiedWeaponData` readies a torch only from a torch row and states that
  row's die and type; a row that states neither readies one with neither.
- `annotateItem` writes a weapon's identity (`profileKey`) and the item's two
  attack booleans from a row that states a use; no size, damage type, `handy`
  or `thrown` is stamped, since the row is read at every use.
- `ready` awaits `rowsReady()` before the first loadout sync. Before the first
  publication every reader answers as above, so an action is never started
  from that state (see "A reader waits"); what is drawn on screen before then
  (a sheet opened in the load window) shows the same answers until the
  publication lands, and then `sheet.mjs` `redrawWeaponReaders` redraws it:
  on `acksExtras.weaponRowsChanged` it renders every window that is open
  (`rendered`) and whose document is an actor, or a weapon item, once per
  announcement, which the publisher has already debounced. A closed window is
  never opened by it, and nothing is stored. Core's own equip toggle in `veto` mode is judged in `preUpdateItem`, which
  cannot wait.
- A container that declares `gear.holds` and no capacity is a container with no
  limit: `holdsGear` is true, `capacityStated` false, `containerReport` says
  `capacityUnimported`, and the equipment tab's header says so.
- The item sheet's Construction panel words each weapon figure's tooltip as one
  of three states (`weapon-figures.mjs`): declared on the item, read from the
  weapon row with its page, or not imported with no number.

## Figures the book prints, and what is read without them

These figures arrive through the importer and reach a consumer only as the
reader's own book gave them. Nothing falls back to a shipped number.

- **A container's capacity** (RR gear price grid, the rows whose own label
  states what they hold). `gear-prices.mjs` `labelCapacity` reads the stone
  figure off the label and `capacityFor` hands it over only where the row IS
  the entry (the same `priceKey`), never a variant the prefix lookup fell back
  to. The cookbook writes it to `gear.capacity` and records the figure in the
  import stamp (`cookbook.read.capacity`), so `printed-layers.mjs`
  `capacitySource` tells a page-read figure (cites the page) from a typed one
  (the hand's). `GEAR_PROFILES` states only `holds: true`: structure. A
  container with no stated capacity is still a container with no limit; its
  figure tooltip says "not imported" and shows no number (`capacityTip`, on the
  equipment tab's container header and the item sheet's Details and Contents).
  An item sheet's "Holds other items" toggle shows and writes the gear flag's
  declaration (`holdsGear`, `setGearHolds`), not `isContainer`: a container
  record (a lock, its keys) makes an item a container with the toggle
  unticked. Unticking clears `holds`, the capacity and the record's
  `HOLDING_KEYS` (`accepts`, `refusal`, a `capacity` stated on the record), and drops the
  record only when nothing else is in it. The sheet's submit writes the
  record's fields (the lock's quality, its modifier, fragile, the refusal) only
  when one of them fired it (`containerFieldsOnlyWhenFired`), so the toggle's
  own change event writes nothing back to the record. The capacity is the field beside it. A rebuild of the
  importer repairs `gear` on an imported item and prices row (`REPAIR`), so
  a stale stamped figure is replaced by the page's.
- **A bowquiver's loaded count** (`gear.loaded6`). Annotate reads it from the
  item's own description (`profiles.mjs` `loadedStated`: a "counts as N items"
  clause) and never from source; `encumbranceDelta6` corrects a quiver's
  encumbrance only where the item states one and has contents.
- **Weapon Finesse sizes and the unarmed strike die** (RR 121 and RR 299). The
  `weaponFinesse` and `unarmedStrike` tables of the `equipment` ruledata doc
  are `proseValues` reads (`sizeList` and `dice` takes). `attack-mods.mjs`
  `finesseTakes(size)` is true, false or null: only false refuses, a size or
  list the import cannot answer never does, and the ledger row says the list is
  not imported (`finesseSizesImported`). `unarmedStrikeDie()` answers the
  imported die or null; `unarmedStrikeData` then carries a blank formula (an
  attack throw with no damage roll, core's reading of a blank formula) and
  `rollUnarmed` says "no die imported".
- **Item loss from damage** (JJ p. 398, the optional rule; `overlays/item-loss.mjs`,
  gated by `overlayItemLoss`). The `equipment` doc carries two tables read from
  that page: `itemLoss` (`proseValues`: the threshold, the step, what a layer of
  clothing counts as, where a light item ends and a heavy one begins, and the
  armour class a full stone costs) and `itemLossMaterials` (`gridRows`, one
  row per `lib/vocab.mjs` `DAMAGE_TYPES` key but `varies`, each row's
  `materials` read by the `wordList` cell pattern). `planItemLoss` takes both
  as arguments, defaulting to the registry, and returns the split: `destroyed`
  (a light item the budget left covers whole), `marred` (a light item reached
  with less budget than its weight: it takes what is left, nothing changes,
  and the budget ends there), `damaged` (a heavy one, with the stones of
  damage it took and the `acLost` of its full stones, armour only; under one
  full stone it is listed with `stones: 0` and changes nothing) and `unplaced`
  (a weight between the two bounds, which the page states no case for; it
  spends nothing and is the Judge's). With any figure or the table unread the plan is
  `ready: false`, plans nothing and names what to import; an unread type row is
  null from `isVulnerable`, which is not "nothing vulnerable". The materials
  picker and the Materials note on the Construction tab read the same table
  and say "not imported" without it.
  `item-loss-flow.mjs` is the Judge's flow (`api.openItemLoss`, launched by the
  *Item Loss from Damage* macro): hit points, damage type, direction, the plan
  with a tooltip per figure, and on a yes `applyItemLoss`. A write is the
  item's existing condition and nothing more: a light item gets the
  `destroyed` flag (`actions.mjs` `setDestroyed`, which the sheet's Mark
  destroyed button shares), and a heavy armour has its `acLost` added to the
  `itemLossAc` flag (`loseArmourClass` → `setItemLossAc`). That is a layer of
  its own in `properties.mjs` (`itemLossAcOf`, subtracted in `layerDeltas`, an
  `itemLossAc` override and an `anyLayer` member in `recomputeItemFields`), so
  a scavenged roll, pick or clear, which rewrite the whole `scavenged` record,
  never touch it. `clearScavenged` is therefore not a repair of item loss: no
  page prints one, so only `setItemLossAc(item, 0)` lowers it. The one control
  for that is the Durability tab's *Restore lost AC*, beside *Mark destroyed*
  and offered on the same Judge's armed sheet, only while `itemLossAc` is above
  zero (`durability.restoreLoss` in `item-sheet/view-model.mjs`): a
  `DialogV2.confirm` (`item-loss-flow.mjs` `restoreItemLoss`) names the item
  and the count, and only a yes gives the whole loss back. The Durability
  tab's AC line reads full as the
  baseline plus the masterwork, silver and variation layers (neither wear
  layer), its `damaged` tag also stands on item loss, and its tooltip names
  the full figure, the scavenged condition and item loss, the last with the
  page the AC per stone was read from. A plan entry that changes nothing
  writes nothing, and `applyItemLoss` counts as `damaged` only the armour whose
  AC changed. The Durability tab adds an Item loss fact (the item's class
  against the imported weights, its tooltip the weight, the bounds and the
  page) only while the overlay is on. The setting gates the dialog, the write
  and that fact; `planItemLoss` itself is pure. The damage stones a heavy item
  took are not stored (DECISIONS, "Partial damage is not stored"): only full
  stones act, and each hit is judged alone (JJ p. 398).
- **Armour limits on abilities — `armour-limits.mjs`** (JJ ch. 12,
  Limitations on Thief Skill Usage, folio 292). The class-builder doc carries a
  `thiefLimits` table, a `proseValues` read of three parts: the armour the page
  refuses (`forbidden`), the shield rule (`noShield`) and the skills it names
  (`skills`). `parseArmourLimits` turns it into the names, a rung of
  `ARMOR_LADDER` (`ceilingBelow`: the rung under the lowest ladder word found)
  and a shield flag; a part that did not read is null, never a default. The
  limit is generic: a `limitation` effect row whose `gate` is
  `{kind: "armourCeiling"}`, optionally with its own `armourMax` and
  `noShield`. `armourCeiling(loadout, gate)` is the verdict, true meaning the
  limit stands now and null meaning the gate names no rung. A row naming no
  rung resolves its figures LIVE from the table (`resolveArmourGate`), so a
  Ruledata Browser override or a revert reaches every stamped ability with no
  re-stamp and no figure sits on an item; a row stating its own `armourMax`
  states its own shield rule and ignores the table (a shield rule alone is no
  figure). A Judge's own ability carries its own row through the effect row
  editor's Limitation fields.
  The import stamps the row: `thief-limit-binding.mjs` `applyThiefLimitImport`
  runs after the class-builder tables import, adds or clears the imported row
  on every imported `def.skill.*` ability (world items and the copies on
  actors) whose name the table names, and `cookbook.mjs` `bindAbility` re-adds
  it through `limitRowsFor` where Update Abilities rewrites `extras`. A Judge's
  ability with no cookbook id is never stamped. `armourLimitedAbilities(actor,
  loadout)` names the actor's blocked abilities and the undecided ones (a row
  with no resolvable rung); `getLoadout` raises them as advisory violations
  (`abilityArmourLimited`, `abilityArmourUndecided`) and the equipment tab's
  Worn & Wielded header lists them, its tooltip saying where the figures came
  from (the Judge's override, the page, or "not imported" with no figure).
  Nothing imported is nothing blocked: the abilities read as undecided.
- **Special maneuvers** (`overlays/maneuvers.mjs`, gated by `overlayManeuvers`).
  Five `equipment` tables, each a `proseValues` read: `maneuverDisarm` (RR 305:
  disarm's penalty and the save bonus a two-handed grip earns the target),
  `maneuverPenalties` (RR 306: the other penalties, with sunder's second figure
  for a shaft read from the words before the weapon it names),
  `combatTrickery` (RR 109: the reduction, the save modifier and the larger
  reduction for a maneuver with no save), `maneuverQualities` (RR 127: the
  bonus of Entangling, Flexible and Incapacitating) and `hookedWeapon` (MM 56:
  the hooked weapon's reduction and save modifier). `MANEUVERS` holds only the
  procedure: the label, the save, whether it damages, whether size adjusts it
  and `shaftVariant` for sunder. Which qualities help which maneuvers, that
  Trickery takes the no-save reduction where there is no save, and that a
  hooked weapon counts only for disarm are code. `maneuverMods` sums the parts
  that apply and returns `attackPenalty` and `targetSaveMod` as null when a
  part that applies is not imported (never the parts that did read), with
  `missing` naming each `<table>.<field>` and `parts` the read ones with their
  table. `attackThrowRows` leaves a null penalty off the throw, as the
  non-proficient package does. The Rolls tab's manoeuvre rows show the penalty
  this actor's Trickery and this weapon's qualities give, its tooltip naming
  the parts and the pages (`citeOf`, or "set in the Ruledata Browser" for an
  override); with a part unread the row says "penalty not imported" with no
  figure, stays rollable, and the roll warns which tables it went without. The
  `hooked`, `targetShaft` and `targetTwoHanded` options have no caller in the
  module: they are API only.

## Weapon rows read from the book — `weapon-source.mjs`

Equipment ships no weapon. `weapon-source.mjs` exports `librarySource`, the
source `init` registers with the weapon seam (before `registerWeaponRows`);
its fields read the registry at every call.

- **The rows** are the `weapons` document's `grid` table, placed against the
  `weaponLists` document by `lib/weapons.mjs` `resolveRows`, and renamed to the
  fields the readers use: `category` is `cat`, `damageType` (or the item's first
  type) is `type`, and `twoHands === true` is `twoHandedForced`. A row the lists do
  not place has `cat` and `type` null. Adapted rows are memoized on the
  resolver's own answer, so a row keeps its identity until the registry changes.
- **A throwables kind** (oil, holy water, a torch) gets the shape the module
  runs for it: thrown and missile, a torch melee too, `splash`, `consumable`,
  `noDamageBonus` and `light` as the kind says. The die and types are the
  importer's; a kind with no row of its own has a row only from the lists
  (`name` ""), and `weaponName` falls back to its key.
- **Spellings** (`battleax`, `greatsword`, `quarterstaff`) resolve to a key only
  where the key is a row of the imported grid.
- **Focus groups** are the `focus` each row was placed under.
- **`throwsAsAnyone`** is a throwables kind, or a thrown or missile row whose
  printed name matches `config.IMPROVISED_THROWN`.
- **Nothing imported** is no rows: every answer is "not imported" (above), and
  the suites bring invented rows (`tools/weapon-fixture.mjs`).

What reads the rows by name or class: a launcher is told by its imported class
(`ammo.mjs`), never by a bow's name, and only the ammunition it takes, bolts for
a crossbow or an arbalest and arrows for any other bow, is read from its name; the one category
holds both (DECISIONS, "Bows and crossbows are one proficiency category");
`abilities-bridge.mjs` resolves a
Martial Training pick (`resolveWeaponGroupPick`) to the grant tokens of one
martial option's own weapons: an option id, or a phrase naming one option's
nouns, gives `optionUnits(id)`; a stored category key gives the one option
whose weapons all carry it (`martialOption`), else the key; any other pick is
the weapon it names, else the category its words name. Each is spelled by
`canonicalGrant`, so a whole category stays its token, a combination or an
unknown id grants nothing, and with nothing imported the last two steps stand
alone. A Weapon Focus pick goes through `listedKind`, and one no imported focus
names is null; `lib/proficiency-strip.mjs` keeps
only the plain spellings of a category's own name, and places a single weapon
through its row. A weapon needs both hands where its row says so or the item
carries core's Two-handed tag, whatever its size. Weapon Finesse reads its
eligible sizes from the imported `weaponFinesse` table (below), and refuses
only a size the list states is not eligible.

`annotateItem` writes a weapon's identity alone (above).

## Training units and organisations — `training-view.mjs`

The grant grammar above is read one more way: as ATOMIC UNITS. `weaponUnits()`
is every weapon the weapon seam holds as `{key, token, name, cat, size, melee,
missile, icon, profile}` — `token` is what a control for that weapon alone
writes (the bare key, or `weapon:<key>` where the bare key is also a category),
`profile` the shape `grantMatches` reads. `TRAINING_VIEWS` are the
organisations a training list can be regrouped by — *category* (the six
narrow tokens), *size* (`melee:<size>` lightest first, then `missile:all`),
*flat* (`all`) — each group named by the one token that means all of it and
captioned with the token's kind (`TIER`). `arrangeUnits(view)` places every
unit under the first group whose token covers it and the rest under a
trailing `leftovers` group with no token. `coveredUnits(tokens)` folds a grant
to its unit set and the tokens the grammar does not know; `canonicalGrant(set,
unknown)` is the inverse — `all` when everything is covered, else
`missile:all`, the size clauses, the categories (each only when whole and
adding something), then units by name, unknown tokens last as written — and
`toggledGrant(csv, token)` is one edit expressed through both. The character
sheet's Stats tab draws the units; `classes/training.mjs` writes through
`toggledGrant`.