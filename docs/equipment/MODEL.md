# Equipment — Data Model & Integration Contract

How this feature stores data, the Active-Effect contract it reads, the API it
exposes, and where its responsibilities end. Companion to
`acks-rules/acks-equipment/RULES.md` (the RAW source of truth behind the code
enums; local-only, never in the repo).

## 1. Design rules

- **Core is frozen.** The feature never edits the `acks` system source. It reads
  core item/actor data and writes only its own flags plus one managed Active
  Effect that targets real core `system.*.mod` fields.
- **Reuse core fields.** Always-on modifiers are written into the fields core
  already sums (`system.aac.mod`, `system.initiative.mod`,
  `system.thac0.mod.melee/missile`, `system.damage.mod.melee`) so
  `computeAC`/`rollAttack` consume them with no patch.
- **One owner per wrapped core method.** `rollAttack` is owned by
  `scripts/lib/patches/attack-roll.mjs`, which remodels it as target-vs-bonus-stack
  and fires a pre-roll hook carrying the mutable term stack — that hook is the seam
  for per-attack modifiers that cannot be static. This feature's own libWrapper
  registration is `computeEncumbrance` and nothing else
  (`scripts/equipment/roll-wrap.mjs`); a second registration against the same
  target fails `tools/validate-extra.mjs`.
- **Single responder.** Loadout writes (auto-unequip, effect sync) run on exactly
  one client — the active GM if online, else the actor owner — to avoid duplicate
  effects (`enforce.primaryResponder`).
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
| Item flag (weapon) | `flags.acks-extras.{size,hands,style,handy,thrown,damageType}` | Per-item classifier overrides (stamped by the annotate macro). |
| Item flag (armor) | `flags.acks-extras.{shieldVariant,strap,masterwork,helmet}` | Overlay metadata. |
| Item flag (weapon/ammo) | `flags.acks-extras.silvered` | RR ch.4 Silver quality. `true` plated, `false` explicitly not, absent = the guess in `silver.mjs` (weapon table, then name). Only `true` applies the 10× price layer — the RAW list already charges Silver Dagger and Silver Arrow their silvered price. |
| Item flag (weapon/shield) | `flags.acks-extras.hand` | `main` \| `off` — which hand the item was drawn into; resolves dual-wield off-hand identity. |
| Item flag (any physical item) | `flags.acks-extras.gear` | `{slots, wornAt, access}` — where this gear MAY sit, where it sits now, and the RAW cost of drawing from it. The model and its read path are the lib subsystem's (`docs/lib/MODEL.md`); this feature infers the values (`profiles.mjs` `inferGear`) and stamps them (Annotate Equipment). |

## 3. Effect contract — `flags.acks-extras.<domain>`

Numeric domains sum; CSV domains collect; boolean-ish domains test presence. Add
`flags.acks-extras.condition` (i18n key/text) to an effect to mark its bonus
**situational** → surfaced as a toggle in the pre-roll dialog.

| Domain | Kind | Consumed for |
|---|---|---|
| `handBudget` | numeric | raises the base 2-hand budget (Four Arms, monster anatomy) |
| `styleProficient` | CSV `style` or `style:spec` | trained styles / Fighting Style Specialization |
| `styleInit` | numeric | flat initiative (Combat Reflexes) |
| `styleAC` `styleAttackMelee` `styleAttackMissile` `styleDamageMelee` | numeric | flat combat mods |
| `maxCleaves` | numeric | Combat Ferocity (roll-time) |
| `weaponFocus` | CSV | Weapon Focus categories (roll-time nat-20 die) |
| `slayer` | CSV `group:bonus` | Goblin-/Vermin-Slaying (roll-time, situational) |
| `martialWeapons` | CSV | weapon categories added to proficiency |
| `armorTraining` | numeric | armour categories added above class |
| `swashbuckling` | boolean | conditional AC (≤ light armour, ≤5 st, by level) → loadout AE |
| `running` | boolean | +30' speed marker — read by movement modules (formation), not written here |
| `finesse` `preciseShooting` `sniping` `ambushing` `skirmishing` `unarmedFighting` `blindFighting` `mountedCombat` `riding` `berserkergang` `freeSwap` | boolean | proficiency presence tests |

Per-actor proficiency profile (not effects): `flags.acks-extras.styles` (trained
fighting styles), `.weaponProficiency` (a CSV of grant tokens), `.armorMax`
(heaviest armour category). Set via the Configure Proficiencies macro.

**Grant tokens** (JJ p. 290) are the shared vocabulary of `.weaponProficiency`
and the `weaponProf` / `martialWeapons` effect domains:

| token | grants |
|---|---|
| `all` | every weapon |
| `missile:all` | every missile weapon (broad choice v) |
| `melee:<size>` | melee weapons of that size — `tiny`/`small`/`medium`/`large`. Broad choices i–ii are size-based, not category-based, so a **bare size is read as this**: `tiny,small,medium` is broad choice i |
| `<category>` | `axe`, `bow`, `crossbow`, `flailHammerMace`, `swordDagger`, `spearPolearm`, `other` |
| `<weapon>` | one named weapon, by any name config.mjs knows (aliases resolve: "Great Sword" → `twohandedsword`) |

A token outside the grammar matches nothing — `api.classifyGrantToken` reports
which kind a token is, or `"unknown"`. A profile that parses to **no** tokens is
treated as *no profile* (permissive), never as a restriction granting nothing:
the alternative made one typo silently non-proficient with everything.

## 4. Public API & hooks

`game.modules.get("acks-extras").api.equipment` (mirror
`globalThis.acksExtras.equipment`): `getLoadout(actor)`, `handBudget`,
`trainedStyles`, `specializedStyles`, `classifyWeapon`, `handCost`,
`focusGroup`, `weaponKey`, `annotateItem(item)`, `refreshLoadout(actor)`, the
effect collectors, `config`, `HOOKS`, `VIOLATION`, plus the hand and gear
surfaces below.

### Hands: free, committed, spare

Three numbers on the Loadout, and asking for the wrong one is the classic bug:

| Field | Question it answers |
|---|---|
| `handsFree` | What is empty *right now*. |
| `handsCommitted` | What something would have to be **put down** to free. |
| `handsSpare` | Whether there is **room for one more thing**. |

They differ because a lone versatile weapon widens to a two-handed grip to fill
any hand going, and gives it straight back the moment a torch or a map wants it.
That grip is elective, so it commits nothing. Anything asking "can this character
take up one more object?" reads `handsSpare` (API: `spareHands`) — reading
`handsFree` tells a swordsman with an empty off hand that he has no hands.

`formationHands(actor)` is the one call into the formation feature for hands the party
sheet has already filled: lights borne, and the mapper's kit.

Those hands hold nothing the equipment sheet lists, so every surface quoting a
hand total says so: `heldHandsClause(source)` turns a Loadout — or a hand-overflow
violation's `detail`, which carries the same two counts — into a display clause,
and the Worn & Wielded status line, the `handOverflow` violation and the
auto-unequip notice all append it. A total the visible gear cannot add up to
reads as a miscount, and sends the player unequipping things that were never the
problem.

### Giving gear, and making room for it — `grant.mjs`

`grantGear(actor, specs)` puts named gear in a character's pack, preferring a
world item or compendium entry of that name over a synthesized stand-in — a
granted torch should be the system's torch. `clearHands(actor, n)` sheathes held
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

## 5. Boundaries with sibling features (in force)

- **formation** owns encumbrance→speed, light/ration consumption. This feature
  never writes `system.movement.*` and never re-implements encumbrance; it wraps
  `computeEncumbrance` (see §1) only to apply the RAW rules core's flat sum gets
  wrong, so formation keeps reading one consistent core value.
- **henchmen** owns coin math. The purchase-from-market macro (not yet built)
  reuses `game.modules.get("acks-extras").api.henchmen.adapter.spendGold/grantGold`
  rather than re-implementing denomination handling.
- **monsters** owns gear storage and the `DAMAGE_TYPES`/`NATURAL_WEAPONS`
  enums, read raw/soft so a monster with no stat block still resolves. The classifier's `damageType`
  aligns to them.
- **Surprise** determination + the `surprised` status are core's; this feature
  only reads them (first-round interrupt helpers).

## 6. Shared library — BUILT (`scripts/lib/`)

The Active-Effect modifier collector, the DOM-injection idiom and the
`DAMAGE_TYPES` enum were duplicated across the pre-merge modules. They are now
single implementations under `scripts/lib/` — see [`docs/lib/MODEL.md`](../lib/MODEL.md)
— and this feature layers on them rather than vendoring copies. `build-packs.mjs`
is a synced template file with one `tools/pack-data.mjs` behind it.

Overrides of core logic default to `lib`; this feature patches core directly only
where the behavior is unique to equipment, and §1 says which and why.

## 2026-07-24 — containers live on the sheet; locks roll the character's own proficiency

The Container Manager popout is retired. It existed only because there was
nowhere to put its controls; the equipment tab is that place, and a container
opened next to the gear it holds matches the gesture at the table.

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

The doll's header button used to obtain its click handler by re-firing core's
`getHeaderControlsActorSheetV2` into a scratch array and reading the entry Paper
Doll pushed. That looked like reuse. It was not: `Hooks.callAll` runs *every*
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

For items that predate the flag, `base-type-infer.mjs` still guesses from the
name using the same clothing patterns and gear profiles the rest of the feature
reads. The declared flag always wins. The guess retires once the migration has
run and the importer sets base types on what it materialises.

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
  variation documents from `acks-importer`; what a base TYPE records arrives
  separately as field specs in acks-lib's ruledata registry
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

`layerDeltas` sums applied variations alongside the three legacy flags into one
delta set, sharing the cost order documented above. Until those flags retire, a
flag OWNS its family: applying a `masterwork.*` variation to an item whose
masterwork flag is set is refused by name, because the two would otherwise both
count.

**Field specs** (`lib/field-spec.mjs`) are how both a base type's metadata and a
variation's own storage get rendered without being shipped: a definition
declares its fields as data and one renderer builds the form. A spec naming a
kind this version cannot render is reported by name rather than dropped.
