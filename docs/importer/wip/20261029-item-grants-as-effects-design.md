> **NOT IN EFFECT — proposal.** An architect's design for reading an imported adventure item's grants into effects (scope B of the 2026-10-28 item report). Nothing here is ruled; the rulings it would need are importer DECISIONS 2026-10-28 "An item a book introduces is worn where its page says" (*Rejected: reading the grants into effects now*) and the ROADMAP row "The items' grants". When a slice lands, its substance moves into MODEL/DECISIONS/TESTING and this file is deleted.

# Item grants as effects: design

The ten items that `kind.adventureItem` imports get the slot, cost and magic mark today (`scripts/importer/adventure-item-binding.mjs`, `cookbook.mjs` `importAdventureItem`). What each one grants stays in its description.

Importer DECISIONS 2026-10-28 ("An item a book introduces is worn where its page says", under *Rejected: Reading the grants into effects now*) and importer ROADMAP ("The items' grants") name four missing pieces:
- attack and damage domains scoped to natural and thrown attacks;
- a wearer-level extraordinary mark;
- worn-gating of a plain item's transferred effects;
- a ruling on what a player character's claws are.

This design supplies all four. It reverses no ruling: that entry rejected the work because the machinery was missing, and this is the machinery.

The grant shapes are described by structure only:
- a flat bonus to attack and damage on one natural attack a turn;
- the same bonus on every natural attack;
- the same bonus on thrown attacks;
- extraordinary damage on those same attacks;
- a daily-limited surge;
- a daily spell;
- a flat bonus to AC and to every save;
- concealment against searching;
- consumables with timed effects.

## 0. Findings (grounded unless marked)

1. **A transferred item effect applies whether or not the item is worn.** Foundry 14 `Actor#allApplicableEffects` yields every `transfer` effect on every owned item (`client/documents/actor.mjs`). `ActiveEffect#isSuppressed` is `system.isSuppressed ?? duration.expired` (`client/documents/active-effect.mjs`). Neither acks core nor extras overrides either one: there is no `CONFIG.ActiveEffect` registration anywhere. So the premise is confirmed by reading the code, not by a live walk: a hand-authored effect on gloves applies from the pack.
2. **A gate at read time re-evaluates on every wear change.** Embedded create, update and delete each call `parent?.reset()` (`client/data/client-backend.mjs`).
3. **`dealsExtraordinaryDamage` (`equipment/silver.mjs`) has no runtime caller.** It appears only in `api.mjs` and `test-equipment.mjs`, and it never reads core's own `system.damage.base.extraordinary`.
   - Core reads that field directly in `buildAttackThrow` (`attack-throw-builder.mjs:166-170`), not through any method the lib seam wraps.
   - Core shows it only as a colour class on each damage-type icon (`DamageData#prepareDerivedData`; the card's `damageIcons` come from `item.system.damage.base.icons`). An untyped weapon, including the synthetic unarmed strike, shows nothing.
   - Nothing in core or extras compares extraordinary damage against a target's defences. The monsters item-annotation checkbox writes `flags.acks-extras.extraordinary`, which no roll reads, so silver and that checkbox never reach the card today.
4. **Doc drift: equipment MODEL §3's "situational → surfaced as a toggle in the pre-roll dialog" does not exist.**
   - `collectEffectModifiers` marks a situational row and `sumModifiers` drops it.
   - `HOOKS.PRE_ROLL_ATTACK` (`equipment/constants.mjs`) is declared and never fired.
   - Core's attack dialog has only a free-text situational field.
   - The real per-attack seam is `makeAttackThrow({acksLib: {terms, damageTerms}})` (`lib/patches/attack-throw.mjs` `attackContext`).
5. **`flags.acks-extras.naturalWeapon` includes the key `weapon`, meaning a manufactured-weapon attack** (`importer/stats-map.mjs` `NATURAL_WEAPON_KEYS`). `monsters/monster-sheet.mjs` reads `natural: !!naturalWeapon`, so it counts those attacks as natural.
6. **`system.save.mod` means two things.**
   - Core's `rollSave` adds it to every save, for characters only (`documents/actor.mjs` `rollSave`; Actor Tweaks labels it "Saving Throw Bonus").
   - Formation's `rollPartySave` applies it only against magic (`formation/turn-engine.mjs`).
   - Core's `computeAC` adds `ac.mod` for characters only and returns early for monsters.
7. **The loadout never resyncs when a plain item's wear changes.** `enforce.mjs` `isEquipToggle` requires `isEquippable`, so a `gear.wornAt` change is ignored. The loadout effect also exists only on characters (`managesLoadout`).
8. **No shipped document carries `"transfer": true` effects.** A grep found none in core's `src/packs/_source` or in extras' `packs/_source`. The only writers are the equipment item sheet's Add-effect action (`item-sheet/sheet.mjs` `#onAddEffect`, `transfer: true`) and the class training effect on class items.
9. **Every entry's description is already scanned for effects.** `executeEntry` scans any entry with a description into `fields.effects` (`effectScan`) unless the entry carries authored `effects.specs` (`executor.mjs`). Authored specs replace the scan and go through `materializeEffects`, which is all-or-nothing. So the ten item nodes already hold guessed effects, and the binding ignores them.
10. **`abilityModifiers` (`lib/effect-scan.mjs`) reads `flags.acks-extras.extras.effects` on every item an actor holds, of any type, with no worn test.**

## (a) Gating a worn plain item's transferred effects

**Recommendation: suppress at read time, owned by lib.**

A new file, `scripts/lib/patches/worn-effects.mjs`, registers one libWrapper WRAPPER on the getter `CONFIG.ActiveEffect.documentClass.prototype.isSuppressed`. libWrapper wraps getters by default (its README, the `#set` note).

The rule: an effect is suppressed when all of these hold:
- the effect is `transfer`;
- its parent is an Item;
- `isWearable(item)` is true;
- `!isWorn(item)` is true;
- the effect does not carry the opt-out flag `flags.acks-extras.whileCarried` (for an item that works merely carried).

Mechanics:
- Register at `init`, as `patches/legacy-source.mjs` does, so the wrap is in place before `initializeDocuments`.
- The predicate reads only source data (`gear.wornAt`, `system.equipped`). It runs inside `applyActiveEffects("initial")`, after `prepareEmbeddedDocuments`.
- It composes with no other change: `actor.appliedEffects`, and so every effect-scan collector, filters on `effect.active`.

Why this scope: the gate covers every wearable, not an opt-in subset. Finding 8 means the only existing-world change falls on effects a Judge authored on unworn weapons, armour or gear. That change is what the brief asks for, and core's own AC already counts only equipped armour.

Cost:
- One patch file and one docs/lib MODEL section ("Effects an item carries, and when they apply").
- A lib repair-check, report-only: "transferred effects on unworn wearables", so a Judge sees what the gate newly silences.
- A docs/lib DECISIONS entry, and a walk of the pre-upgrade shape.
- Effects lists should show "not worn" where they now show only `disabled` (`character-sheet/tabs/effects.mjs`).
- Two readers test `disabled` rather than `active` and will still count a suppressed effect: `lib/senses.mjs` `matchesByName` and `formation/turn-engine.mjs` `memberEffects`. They are named here as a cost, not a slice.
- Rule for authors: a worn item's grants must key core fields or the roll-time domains below. A loadout-folded domain such as `styleAC` stays stale until `isEquipToggle` widens to `gear.wornAt` (finding 7), so widen it in the same slice.

**Strongest counter (moderate):** wrapping a Foundry getter is global. A third-party module that also overrides suppression collides with it (libWrapper reports the clash), and a Judge's carried-not-worn effect on an armour silently stops applying. The opt-out flag and the repair listing cover the second risk; nothing covers the first except libWrapper's report.

**Rejected:**
- *A hook that toggles `disabled`.* It stores derived state, needs the single responder and `queueSync`, races across clients, clobbers a disable a Judge set on purpose, and leaves library copies in whatever state they were last left in.
- *The loadout folding worn items' domains.* It reaches characters only, covers only the domains the loadout folds, goes stale (finding 7), and an effect with `transfer: false` is invisible to every other reader.
- *An ActiveEffect sub-type whose `system.isSuppressed` gates it.* This is Foundry's own seam, but it gates only effects of that type, so a Judge's plain effect still leaks; it also needs `documentTypes` and a world relaunch. Keep it as the fallback if the getter wrap fails live.
- *Suppressing at a magic slot's over-capacity (`slotOverfilled`).* It is the natural next rule but scans O(items) per effect. Leave it for a follow-up.

## (b) Natural- and thrown-scoped attack and damage

**Recommendation.**

Equipment's `EFFECT_DOMAINS` gains four numeric, roll-time domains: `attackNatural`, `damageNatural`, `attackThrown`, `damageThrown`. They are never folded into the loadout effect: core's `AttackTweaks` folds thrown into missile and has no natural split, and the loadout reaches characters only.

They are read by `equipmentContributor.attack`/`.damage` (`roll-wrap.mjs`) through `collectEffectModifiers`, which keeps each row's label, the item's name, as its provenance (ui-tooltips: "set by an effect: which").

Three rules for where the rows go and what counts:
- **The rows sit outside `weaponContext`**, which returns null for any non-character. An NPC wearing the item must get them.
- **Natural** is one lib predicate, `isNaturalAttack(item)`: a weapon whose `flags.acks-extras.naturalWeapon` is a `NATURAL_WEAPONS` key other than `weapon`. The importer already stamps that flag (`bindMonster`, `weaponPayload`), and the monsters sheet edits it. The predicate lives in `lib/item-model.mjs` or `lib/damage-type.mjs`; lib holds the vocabulary in `vocab.mjs` `NATURAL_WEAPONS`. Equipment MODEL §5 says monsters owns that enum, which is drift. `monster-sheet.mjs` switches to the predicate (finding 5).
- **Thrown** is the attack in flight's `attackType === "thrown"`, so a dagger stabbed takes nothing. Whether a thrown weapon used in melee takes the bonus is the Judge's reading: swapping to a weapon-class test is a one-line change, and it is listed under Questions.

Natural weapons skip the proficiency package: `weaponContext` returns null for `isNaturalAttack`.

**"One natural attack a turn"** is an election, not automation:
- The effect carries `flags.acks-extras.condition` (a lang key saying what the toggle does), so `sumModifiers` keeps it out of always-on sums. That is today's behaviour.
- The module's own attack surfaces (character sheet, monster sheet, Follower Card) offer "apply to this attack" and pass the row in `acksLib.terms`/`damageTerms`.
- On core's sheet the player has the dialog's free-text situational field.
- A checkbox injected into core's dialog (lib, also serving `slayer`) is ROADMAP, not this scope.

**Strongest counter (moderate):** nothing enforces once a turn. That is accepted: which attack takes the bonus is the player's choice, and counting it belongs to the table.

**Rejected:**
- *Folding into `system.attack.mod.melee`.* Swords would take the bonus.
- *An effect on each natural weapon.* Foundry Items apply no effects.
- *Writing `bonus.attack` onto the weapon.* That is a stored write, and it goes stale when the item is taken off.

## (c) A wearer-level extraordinary mark

**Recommendation.**

Two boolean domains, `extraordinaryNatural` and `extraordinaryThrown`. `dealsExtraordinaryDamage(item, {actor, attackType} = {})` widens to stay the one question. It returns true when any of these hold:
- core's `system.damage.base.extraordinary`;
- `flags.acks-extras.extraordinary`;
- silver;
- `isNaturalAttack(item)` and the wearer has `extraordinaryNatural` (`hasEffectFlag`);
- `attackType === "thrown"` and the wearer has `extraordinaryThrown`.

The answer reaches the card through a new seam question, `extraordinary(ctx, attackType, current)`, in `lib/patches/attack-throw.mjs`. Lib asks it inside its existing `getDamageFormula` wrapper, which is the builder's only caller there and runs two lines before core destructures `weapon.system.damage.base`. Equipment answers it from `dealsExtraordinaryDamage`. No new libWrapper registration is needed.

The wrapper:
- (i) sets the prepared `this.damage.base.extraordinary`, then re-runs `DamageData#prepareDerivedData`, because both the card and the dialog preview read `.icons`;
- (ii) records the touched weapon in `ctx`, and `onMakeAttackThrow`'s `finally` restores it;
- (iii) acts only while `attackInFlight` is set, so a sheet drawing attack boxes keeps core's answer;
- (iv) depends on core reading the formula before the field, which a walk step asserts.

Scope, stated honestly: the card says it; nothing adjudicates it. The same route makes silver and the monsters checkbox reach the card for the first time. Natural weapons should carry a damage type so an icon exists: `NATURAL_WEAPONS` defaults one per key, and the unarmed strike has none (finding 3).

**Strongest counter (moderate to strong):** the payoff is display-only, a red glyph, and it rests on in-flight mutation of a prepared model plus core's line order. If a second attack by the same actor with the same weapon overlaps, one restore can clear the other's mark.

**Rejected:**
- *Deriving the mark at the weapon's `prepareDerivedData`.* It cannot express thrown, which depends on the attack type, and it adds a wearer read to every weapon's preparation.
- *Annotating the card after the post-attack hook.* That is an extra write and a race.
- *No card mark at all, the API plus the Judge's checkbox.* This is the conservative fallback; its cost is that thrown and player-character cards never say extraordinary.

## (d) AC and saves from a worn item

Core's mod fields do take them today, but for characters only:
- `system.ac.mod` is added in `computeAC` during derived data, after the initial phase;
- `system.save.mod` is added in `rollSave`.

A monster or NPC wearer gets nothing, and `save.mod`'s meaning is split (finding 6).

**Recommendation: keys that work for any actor type**, since an item authored once travels between types:
- `system.ac.value` `add` with change `phase: "final"`. Foundry 14 runs the final phase after derived data (`ACTIVE_EFFECT_CHANGE_PHASES`; `shouldApplyChange` matches on phase), so the change lands after `computeAC` on a character and on a monster's stored AC.
- `system.saves.<paralysis|death|blast|implements|spell>.value` `subtract`. Both models store these targets (`SavingThrowsTemplate`), and every roller reads them, the party save included. `character-sheet/snapshot.mjs` `saveModifiers` already reports a lowered target as help.

The stored-inputs patch (lib MODEL "A field an effect changes") already keeps the system's sheets, the module's character sheet and the Follower Card from writing these values back.

**Strongest counter (moderate):** the sheet shows a moved target, not "+N", and five changes stand in for one. The `final` phase is new to the family, and effect-scan replays every change regardless of phase. Unverified: whether the character sheet's AC rail breakdown accounts for a final-phase change on `ac.value`.

**Rejected:** `ac.mod`/`save.mod`. They reach characters only and collide with the party save.

## (e) A player character's claws: question for the user

The community book's class powers carry claws as prose; `register/cat` holds only icons. Until this is ruled, (b) and (c) reach NPC natural weapons and thrown attacks, but no player's natural attack.

**Question E: what is a player character's natural attack?** Answer "E1", "E2" or "E3", plus yes or no on E-sub.

- **E1: an embedded `weapon` the power grants, flagged `naturalWeapon`.**
  - For: core's sheets list it, and it matches monsters.
  - Against: it is `isPhysical`, so it shows in inventory, markets, storage and handover. It costs a hand (`loadout.mjs` counts equipped weapons). It must be exempted in each of those places, and re-made when the class is re-applied.
- **E2 (recommended): a roll-time weapon built from the power's typed `naturalAttack` row**, the way `rollUnarmed` builds the unarmed strike, and flagged so (b) and (c) apply.
  - The lib `effectField` already has `naturalWeapon`, `routine`, `roll` and `damage`.
  - For: the power is the one store, and nothing becomes goods.
  - Against: it appears only where this module draws a button, and a Judge tweaks it by editing the row.
  - Cost: the die is a page value, and `executor.mjs` `LOCATABLE_FIELDS` has no dice kind; `materializeRolls`' `formula` locator is the nearest thing. The class register rows gain a spec.
- **E3: the unarmed strike counts as the natural attack** for an actor holding such a power. Cheapest, but it takes the unarmed die and lethality.
- **E-sub:** does an ordinary unarmed strike count as a natural attack for these items at all?

## (f) What stays prose, and why

Each item below needs a use flow, a charge store or a reader that does not exist. A partial automation would read as complete and not be, which is why `materializeEffects` is all-or-nothing.

- **The daily-limited surge and the daily spell:** activation, frequency and charges are magic ROADMAP 4a; the timed effect and the cast are release 2.
- **Concealment against searching:** it changes another character's searching throw, and no seam lets a searcher's roll read the searched actor's gear. How much it hides is a page value.
- **Consumables:** one-use consumption is 4a; timed effects are release 2.

The binding writes no rows for these. The item's effects tab shows what it automates, and its prose holds the rest.

## (g) The importer side

**Recommendation: one binding, not a new kind.**

- The ten rows in `register/cat/p24-p26-items.json` gain authored `effects.specs`.
- `register/_kinds/adventureItem.json` declares the assist field and its note drops "until a magic-item binding". Unverified: which compiler stage copies specs for a composite kind.
- The specs ship structure plus short locators around the digit; the figures come from the Judge's own book at import.
  - Example row: `{type: "modifier", target: "attackThrow", attackScope: "natural", condition: "situational", from: {pattern}}`.
  - `tools/lint-register.mjs` caps literals at 60 characters and needs the new keys whitelisted.
- `executeEntry` already materializes authored specs.
- The binding reads `node.fields.effects` **only when** the cookbook entry carries `fields.effects.specs`. Otherwise it would apply the scan's guesses (finding 9).
- New vocabulary goes in lib:
  - `vocab.mjs` gains `ATTACK_SCOPES` (natural, thrown) and an `EFFECT_TYPES` kind `damageQuality`;
  - `fields.mjs` `effectField` gains `attackScope` and `quality`.
- Equipment translates rows into effect changes in a new `scripts/equipment/grant-changes.mjs` `grantChanges(rows)`, because equipment owns the effect contract. The importer already imports equipment modules (`cookbook.mjs`). The mapping:
  - attack and damage rows → the (b) domains;
  - `damageQuality` → the (c) marks;
  - `ac` and `save` → the (d) keys;
  - `condition` → the effect flag.
- `importAdventureItem` writes one `transfer: true` effect, named for the item, with `flags.acks-extras.cookbook: {id}`.
- **Never store the rows in `extras.effects` on the item:** `abilityModifiers` would read them ungated (finding 10). The effect is the one store.

Not `kind.magicItem`: magic 4a reserves that kind for its `magicItem` power model, which is not built. When 4a lands, its binder reads these same rows into a power whose activation is a permanent bonus.

Judge tools: the item sheet's Add effect, plus a `docs/guides/equipment.md` section listing the keys. A row picker is ROADMAP.

## (h) Ownership

| Piece | Owner, file | Doc |
|---|---|---|
| Worn gate (the one `isSuppressed` wrap), the repair listing | lib, `patches/worn-effects.mjs`, `repair-checks.mjs` | lib MODEL/DECISIONS/TESTING |
| `isNaturalAttack`, `ATTACK_SCOPES`, `effectField` keys | lib, `item-model.mjs`, `vocab.mjs`, `fields.mjs` | lib MODEL |
| The seam's `extraordinary` question and its restore | lib, `patches/attack-throw.mjs` | lib MODEL "attack seam" |
| Domains, contributor rows, `dealsExtraordinaryDamage`, `grantChanges`, the natural exemption | equipment, `constants.mjs`, `roll-wrap.mjs`, `attack-mods.mjs`, `silver.mjs`, `grant-changes.mjs` | equipment MODEL §3 (fix the drift), DECISIONS, TESTING |
| The binding and the register specs | importer, `adventure-item-binding.mjs`, `cookbook.mjs`, `register/cat` | importer DECISIONS, TESTING; close the ROADMAP row |
| Player natural attacks (after E) | equipment `actions.mjs` beside `rollUnarmed`; abilities owns the row | equipment and abilities MODEL |
| The `natural` predicate on the monster sheet | monsters, `monster-sheet.mjs` | — |

No core method gains a second owner.

## Order of work (each slice lands and is walked on its own)

1. **Worn gate (lib).**
   - Tests: `tools/test-lib.mjs` covers the predicate on a mock effect and item, worn, unworn, goods (never gated), `whileCarried`, and an equippable item.
   - Walk: a fixture character holding a plain item that declares a slot and carries a hand-made `system.ac.mod` effect.
   - Observables: worn → `actor.system.ac.value` changes and `actor.overrides` lists the path; unworn, or stowed in a pack → it does not; the effects tab says not worn.
   - Also walk the pre-upgrade shape: an unequipped armour with an effect, and check the repair listing shows it.
2. **AC and saves (equipment `grantChanges`, the (d) keys).**
   - Tests: `test-equipment.mjs` covers the change shapes.
   - Walk: the same item worn by a character and by a monster.
   - Observables: AC and save targets move on both; the stored-inputs underline shows the base; `rollSave` targets differ.
3. **Thrown domains.**
   - Tests: `test-equipment.mjs`.
   - Walk: a thrown weapon, rolled thrown and then melee.
   - Observables: the card's modifier list carries the item-labelled row on the thrown roll only, and on an NPC wearer too.
4. **The extraordinary question.**
   - Tests: `test-attack-damage-formula.mjs` covers set and restore.
   - Walk: a silver dagger, and a natural weapon on an NPC wearing a mark.
   - Observables: the card's icon carries `acks-icon-extraordinary`; after the roll the item's prepared field reads its source value again.
5. **Natural domains plus the election.**
   - Walk: an imported natural attack on an NPC, a `weapon`-key attack, and the elected row.
   - Observables: rows on the natural attack only; the elected row appears only when chosen.
6. **Ruling E, then player natural attacks.**
7. **Importer binding.**
   - Tests: the new `tools/importer/test-adventure-item-binding.mjs` covers authored-only reading and the scan guard.
   - Walk: extend `tools/live/importer-typography.mjs` step 2.
   - Observables: each item carries one transferred effect whose numbers match its page, read by the walker; prose-only items carry none.

## Questions

Both ruled 2026-10-29 — DECISIONS, "A player character's natural attack is a
power's row": E2, the unarmed strike is not a natural attack, and a thrown
bonus follows the attack's kind. Section (e) is settled; the design is still
not in effect until its slices land.

## Unverified

- Live behaviour of the getter wrap.
- How the character sheet's AC breakdown treats a final-phase change.
- Which compiler stage carries specs for a composite kind.
- That the monsters checkbox writes only the flag (read from `item-annotations.mjs` markup, not run).
