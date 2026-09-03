# Roadmap

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

Designed but not built. Anything here is deliberately absent from the code, not
missing from it.

---

## Rebuking undead: the borrowers' own recipes

**Shipped:** the crusader's table imports as ladders, and Rebuke Undead gets one
throw per ladder plus the effect roll ([DECISIONS.md](DECISIONS.md)).

What is left is the OTHER entries that read the same table at a fraction of
their own level — a craftpriest at its class level, and the powers and
proficiency that control undead at a stated fraction of theirs. Each is a
`fromLadders` spec on its own entry naming the same class and table; the
fraction and its rounding are printed beside the rule, so each recipe locates
them rather than stating them. No code is needed for any of it — the spec form,
the numerator/denominator on the target, and the resolver all ship.

## Superseded: the throws that point at the ladders

The crusader's Rebuking Undead grid now imports — nine ladders on the class
document, each with its dash rungs, its targets and its two rungs that need no
throw ([DECISIONS.md](DECISIONS.md)). acks-extras performs all of it, including
reading the table at a fraction of class level. What is missing is the last
link: nothing emits the THROWS on `def.power.rebukeUndead` that name those
ladders, so a Judge still adds them by hand.

The throw count is DATA — nine undead types here, and another book may print a
tenth — so the spec cannot enumerate them, and enumerating the row labels in a
recipe would ship a table of options besides. The form wanted is "one throw per
published ladder whose key carries this prefix, read at this fraction", plus one
`measure` throw for the 2d6 that follows a success.

The obstacle is reach: `executeEntry` runs one entry with no sight of any other,
and the ladders belong to the crusader while the throws belong to the power the
crusader awards. Two candidate homes, undecided:

- **At class-award time**, where `bindClass` holds both the ladders it just
  built and the awards it is about to make. Natural, but it makes a power's
  content depend on which class materialized it.
- **A run-level channel** the ability binder can ask for a published class's
  ladders. Cleaner conceptually, and a larger change to a pipeline whose entries
  are deliberately independent.

The borrowers (craftpriest at full level, necromancer at half rounded down,
Black Lore of Zahar at two thirds rounded up) need no extraction at all once the
form exists — each is the same throw at a different fraction.

## Cross-book merging beyond the current signals

Families merge today on a shared member id or a shared family suffix. Entries
that are the same creature under different names in two books — with neither
signal — still import as twins. A chef-authored alias would close it; the
question is whether that belongs in the register or in the binding.

---

## Gear values the tables do not reach

Weapon damage, armour AC, and the cost and weight of anything the price grid
sells are read from the reader's own tables — this was once described as
needing per-entry locators, which measuring it showed to be the wrong shape:
the values are in grids, and grids are read whole.

What is still unpriced, and why:

- **Structures** (43 entries), **lodging** and **provisions** are not in the
  adventuring-gear or clothing grids. They are priced in their own tables,
  which have no reader yet.
- **Barding** prints a dash for cost and encumbrance in the armour table; the
  figures live elsewhere.
- **Traps** carry a price in the equipment list and mechanics in the Judge's
  chapter; the trap documents come from the latter, and the price row is not
  joined to them.
- A handful of grid rows read a cost of zero where the page shows a dash or a
  qualifier, rather than declining to answer.

## What the ACKS Extras sample packs still answer that this importer does not

Four packs in acks-extras were candidates for removal once the importer could
produce their content from the reader's own book. Measured against the
register, none of them can go yet. The gaps, per pack:

- **Class Training (34 documents, 32 carrying mechanics).** Nothing here is
  produced at all. The class import states the same training as effects on a
  class document, which serves a character who HAS one of the printed classes
  — and two of those do not import their training at all. A custom class, a
  homebrew build, or a character configured without a class item has no other
  source for a fighting style, an armour rung or a weapon selection. These
  would have to become importable documents in their own right, from the
  class-construction chapter rather than from any one class's spread.

- **Equipment & Combat Proficiencies (42 documents, 41 carrying mechanics).**
  Four are fully answered. Twenty-five have no importer document at all,
  because the register holds ONE entry where the pack ships a configured
  variant per category: Combat Trickery in seven, Fighting Style
  Specialization in five, Martial Training in seven, Weapon Focus in six. The
  pack's variants are the register's single entry with a choice already made.
  Thirteen more import by name and description with no mechanics — Combat
  Reflexes, Swashbuckling, Precise Shooting, Mounted Combat and the rest carry
  no effect locators, so what imports cannot do anything.

- **Equipment Samples (9 documents).** Six are shields, and they are ANSWERED
  (2026-09-01): the pack ships them as armour with an AC and an encumbrance,
  and the importer now produces the same six as armour of type shield, each
  carrying the form flag the pack's samples carry and the numbers read from the
  Judge's own page. The armour table import still produces only the generic
  shield; the forms come from their JJ passages. The remaining three are
  demonstrations rather than content: a masterwork weapon and armour with the
  bonus already applied, and an invented named weapon.

- **Henchmen Proficiencies & Powers (20 documents, 19 carrying mechanics).**
  Six are fully answered; fourteen import by name and description only —
  Leadership, Command, Mercantile Network, Military Genius and the rest — so
  the hiring, loyalty and morale modifiers the pack items carry are absent
  from the imported versions.

The common shape: a NAME imports, and the MECHANIC does not. Effect locators
are the work that closes most of this, and the per-category variants need a
way to express "this entry, with one of its choices already made".

## Money, trade goods, and rows sold as a bundle

Coins and trade bars (copper, silver, gold, platinum) and furs are not in the
equipment grids at all — they are money and freight, priced in their own
sections. Two rows the price list sells as one purchase (a bundle of torches,
a count of sling stones) import as the single article instead, and the elven
helmet has no row in the books read so far.

## A training stated as a subtraction

One spread grants "all weapons except" two of them. The grant vocabulary
(acks-extras `equipment/proficiency.mjs`, JJ p. 290) has no way to say that:
its tokens are additive, so the sentence's unrestricted half would grant
precisely the two weapons the class is denied. `parseCombatTraining` refuses
the clause and the class imports with its armour and fighting styles and no
weapon grant — which reads on the sheet as a class that was never asked.

The refusal is right; being SILENT about it is the part that costs. Two ways
out, both starting in the other repo: a denial token the grant vocabulary
understands (`!longbow`), which `weaponProficiency` would subtract after
matching; or a stated-but-unresolved surface beside `unresolvedProfs`, so the
sheet says a clause was read and refused rather than showing nothing. Either
one changes what a class item carries, so neither is a patch.

## A priced livestock row is still a thing, not a creature

`importEquipment` has ruled since the animals work that a mule is a creature —
a described `animal` entry becomes an ACTOR, and `repairAnimalItems` removes
the ones an older import left as items. The price grid's own livestock section
never got the same treatment: 26 rows, and seventeen class templates name a
riding horse.

Doing it needs three things a patch cannot carry: the actor-side dedup
`importEquipment` uses, `repairAnimalItems` extended to `def.priced.*` ids, and
an answer for `resolveBase`, which searches items — a template naming a horse
would stop resolving to one and fall back to a bare named item. The rows now
carry the section they were printed under, so the fact needed to decide is
already there.

## A variant group is labelled from the register, which never reaches it

`bindClass` reads `entry.class?.tables?.training?.labelHeader` to name a path
group. The compiler CONSUMES that field to lay the grid out and never emits it
onto the compiled entry, so the read is always undefined and every printed
variant table imports as a group labelled "Variant" with the key `variant` —
the barbarian's regions among them.

The fix is one field in the compile, but the group KEY is what a character's
chosen path is stored under (`actorPaths`, keyed by group), so changing
`variant` to the printed heading orphans a selection already made. It needs a
migration, and a recompiled cookbook.

## A class whose paragraph is interleaved with its own table

The zaharan ruinguard states its combat training in a paragraph the level
table sits inside, so extraction folds the table's cells through the sentence
mid-word. The parse refuses the whole paragraph rather than grant the clauses
that survived. Reading it needs the paragraph located by its COLUMN — the
machinery the prose boxes already use — rather than by the page's reading
order.

The barbarian is a different absence: its training is a table of peoples, one
row per region, and which row applies is the reader's choice. That is a
variant to be registered, not a value to be read.

## Gnostic invocations as documents

The Earthforger and Furnacewife casting entries carry the gnosis kind and the
Maximum Invocation Level ladder, but their invocation lists (BTA ch.5) are not
imported as documents — matching the RR classes, whose spell lists are also
empty on the casting entry. When spell-list references land for the vancian
classes, the invocation lists should ride the same mechanism.

---

## Merging duplicate imports already in a world

The importers no longer make twins (DECISIONS, 2026-08-06), but a world that
ran the earlier ones still holds them. Removing the extra copy is not enough:
actors that embedded a shared ability point at whichever copy their import
happened to resolve, so a merge has to re-point those embeds, and a GM who
edited one of the twins has to be told which one wins. That is a migration with
a confirmation surface of its own — a minor.

Until then the clean-slate path is the answer and it works: Remove ALL Imports,
then import again. It is exactly what the test cycle does.

---

## A definition heading that opens mid-line

`def.power.masteryofdominationanddeception` is a run-in whose heading does not
start its line: JJ p323 closes the previous entry with "Elven Courtier]" and
opens this one immediately after, at x=129 in a column starting at 72. Every
rule that locates a run-in assumes it is flush left — the stop that ends the
previous block, the section test, the column-edge check `assists.columns`
states. Nothing is currently wrong with what it extracts (it is an alias and
reads its target's passage), so this is a latent assumption rather than a
defect, and it is written down because the next such heading may not be an
alias.

---

## The printed traps, as mechanics rather than a price

`acks-extras` 4.9.0 built the whole of the delve chapter's trap procedure and an
`acks-extras.trap` Item to hold one, deliberately so this importer would have
something to materialize into. Nothing here fills it.

What already imports is the CONSTRUCTION side and only that: thirteen trap rows
come across as `kind.equipment` / `meta.group: "structure"` from the RR price
list at p.152 — `def.equip.arrowFiringTrap`, `deadfallTrap`, `portcullisTrap`,
`scythingBladeTrap` and the rest — each carrying a name, a citation and its
description. A Judge who imports gets what a trap COSTS to build and no way to
spring one.

The mechanics print in the Judge's Journal, pp. 241–243, under STEP 7: PLACE
TRAPS. Each trap is a named entry giving six tiers, one per trap level, and the
tier states the attack throw or the save, the damage, and whatever rider it
carries. Page 240 holds the two things every trap reads from: the trigger
mechanisms and the trap-level rule.

**DONE 2026-08-16 — the kind and the entries.** `kind.trap` is minted
(`register/_kinds/trap.json`) and all thirteen printed traps are authored in
`register/jj/p241-p243-traps.json`, compiling to `cookbook/traps.json`. Thirteen,
not the eleven this family used to say: the wiki snapshot's chapter-8 outline
lists Ceiling Collapse, Deadfall, Excavated Earth Pit, Fire, Missile, Needle,
Portcullis, Rock-Cut Pit, Rolling Rock, Scything Blade, Spring Snare, Swinging
Log and Whipping Branch, and the pages agree.

They anchor through the existing `subheading` locate mode — the trap names are
solo runs of a distinct font at body size, which is exactly what that mode was
built for, so no new locate strategy was needed. Each carries an
`assists.columns` pair because the indented tier lines defeat column detection
(the 2026-08-15 ruling: author the assist, leave the detector alone), and the
spread is mirrored, so odd pages state `[72, 329]` and even pages `[45, 302]`.
Verified against the wiki: every entry materializes exactly two blocks — the
description and the run of six level tiers — except Portcullis, whose three are
one block broken by a column turn.

**DONE — the binding, and the decision it was waiting on.** Extras 4.12 rebuilt
`TrapData` so ONE document holds all six levels (`levels`, with `level`
selecting the row in force), which settles the question this section used to
pose: thirteen documents, not seventy-eight. A scything blade is one trap; what
changes with its level is what it does, not what it is.

`importTraps()` builds them. Two things are read out of the seat's prose and no
more: the tier SPLIT, which is the book's own numbering and the same kind of
structural cut `parseEquipment` makes on a starting-equipment cell, and the
damage dice, which is the frozen `dice` locate. Each level's printed sentence is
kept WHOLE on the row beside them.

Everything that would take a judgment — save or attack throw, which save, what
beating it is worth, how far the effect reaches — is deliberately left at its
default with the sentence sitting next to it on the sheet. A wrong-but-plausible
save key is worse than a blank one, and reading those out of prose is the
interpretation this pipeline keeps offline (RECIPES §1).

Measured against the reference library: **all thirteen traps yield all six
levels**, and eleven yield damage dice on five or six of them. The two that
yield none are the pits, correctly — a pit's damage is printed as a DEPTH, and
extras derives it from that. Where a tier states several dice the first is
taken, which is not always the headline number (a needle's poison die can beat
the needle's own), so the printed sentence is the authority and the field is the
convenience.

`kind.trap` is in `NON_ABILITY_KINDS` — without that a new definition kind
silently joins the ability import and mints items that fail validation, which is
what shipped in v0.26.0 — and `def.trap` files onto a "Traps" shelf.

---

## Variations: the documents an item's differences are made of

`acks-extras` 4.11 models a difference between one item and its plain self as
an `acks-extras.variation` Item, applied to a base item by the `containedIn`
relation gear uses to sit in a backpack. The module ships the mechanism and no
values: masterwork's surcharge, silver's multiplier, a buckler's rating and a
gem's cut are page values, and a world imports them or has none. A Judge can
type one in by hand, exactly as they can a trap.

**The mechanism is built and the masterwork family is across (2026-08-16).**
`kind.variation` mints documents through `importVariations()`, and the five
masterwork differences the schema can express exactly — a weapon's attack throw,
its damage, both together, armour lightened, armour protecting — arrive with
their surcharges and deltas read from the seat's own page. Verified end to end
against the reference library: all five locate every number they claim.

How the numbers come across, because it settles the pattern for the families
below. Each entry carries `variation` locator specs — a regex over the seat's
prose and the field it fills — compiled through the FROZEN `effects` op rather
than a new one, and materialized by `materializeEffects`, which is all-or-nothing:
a locator that does not match drops its spec, so a field is either the book's
number or absent, never a default wearing the book's authority. The register
holds the structure (key, kind, appliesTo, supersedes) and no values. One
translation happens in the binding: the page says an item "weighs one less
stone" and the schema counts sixths, so the located stone count is negated and
scaled — a change of unit, not of value.

Two corrections to what this section used to assume. The masterwork rules are in
the **Revised Rulebook at p.161**, not the Judge's Journal, and they are set as
**run-in prose** (`Masterwork Weapon:`, `Masterwork Armor:`, …) — there is a
summary table on the page as well, but it extracts as one run-on string, so the
prose is what the locators read. Several variations legitimately share one
passage, which is why they share an anchor.

**Still owed, now scoped:**

- **The masterwork families the schema cannot yet hold.** Instrument, structure
  and ship are printed in the same passage, but their benefits are Performance
  throws, structural hit points and speed — none of which is a `deltas` field.
  They want either new delta fields in extras or `conditional` entries (the
  schema's own "value claims reported to the Judge, never applied").
- ~~**The JJ shield FORMS are variations.**~~ REVERSED 2026-09-01: they are
  SHIELDS, and import as armor items of type shield — see
  [DECISIONS](DECISIONS.md). All six — Auxiliary, Buckler, Crescent, Heater,
  Kite, Phalanx — arrive from JJ pp.409–410 with the in-hand AC and the
  encumbrance their own passages state, located per entry.

  The conditions ride with them as enum keys, which is still the point and is
  still not a bonus: `grantsAC` (`hand`, `front`, `backVsRear`), `mounted`
  (`riderOrMount` / `riderAndMount`), `deniedWhen` (`vulnerable`, `surprised`,
  `retreating`, `attackedFromBehind`), plus `noBack`, `noMount` and the
  buckler's `requiresStyleSpecialization`. Read per entry off the page, never
  patterned across them: an early pass applied one AC regex to all six, which
  is the distinction these rules exist to make, deleted.

  **Owed on the extras side:** a carry-state model that reads those enums off
  the document, after which the frozen `SHIELD_VARIANTS` table in
  `scripts/equipment/config.mjs` retires. Until then the overlay reads only the
  `shieldVariant` flag the import stamps.
- ~~**Silver, and the other material qualities.**~~ DONE 2026-08-16, and there
  are no others. Silver is printed at RR p.129 as a run-in in the weapon-quality
  list — which is why a heading search missed it — and imports as
  `material.silver` with the multiplier read off the page. It scales the listed
  price (`cost.baseMul`), deliberately not `mul`: silver must not multiply a
  masterwork surcharge added on top of it. **Nothing else on that list is a
  variation**: Handy, Impact, Incapacitating, Long, Mounted, Slow and Thrown are
  intrinsic traits of a weapon TYPE, not differences applied to one, and silver
  is the only material ACKS II has.
- **Gems are DEFERRED, and were never a Treasure Tome problem.** The Gem Value
  table is printed in the Judge's Journal treasure chapter, and it is a ROLL
  TABLE (roll / value / type), not a quality variation — so it wants
  `kind.rolltable`, not this section. The Treasure Tome is now registered
  (`tt`, 346pp) against its future consumers, the magic items; nothing reads it
  yet, which is the one standing exception to this file's rule that a book id
  must unlock something.
- **Cosmetics landed** as `appearance.ornamented`: the masterwork passage's own
  rule that ornaments and engraving add to an item's value without changing its
  characteristics. It carries no deltas and no cost on purpose — what the
  ornament is worth is the Judge's, and the variation exists so there is
  somewhere to record it.
- **The `baseTypeFields` table**, below, which is a different artifact from the
  documents and still unbuilt.

The `system` shape a variation document fills:

| Field | What it holds |
|---|---|
| `key` | namespaced, `masterwork.weaponToHit` — the PREFIX is the exclusivity group, so two variations of one family can never sit on one item. Choosing the prefix IS the modelling decision |
| `appliesTo` | base types (`weapon`, `shield`, `gem`, …). Empty means any, which is right for most |
| `supersedes` | printed cross-family rules ONLY, `magical.*` patterns allowed. Empty unless a page states one; magic superseding masterwork is the single known filler |
| `deltas` | `bonus`, `damage`, `ac`, `weight6` |
| `cost` | `baseMul` scales the item's listed price, `add` is a flat surcharge, `mul` scales the whole — the rules' own order, and silver must not multiply a masterwork surcharge |
| `dataFields` | field specs for anything this variation records per instance (a gem's carat, a named blade's ladder) |
| `conditional` | value claims reported to the Judge, never applied |

The pages to read: the masterwork tiers and their surcharges, the silver
quality's multiplier, and gem quality wherever the Judge's Journal and Treasure
Tome print it. The JJ shield forms were read and are not here — a form is a
shield, not a difference applied to one (DECISIONS 2026-09-01).

**The `baseTypeFields` table**, in the ruledata document `variations`, keyed by
base type — the field specs a CATEGORY records, which belong to no one document
because they describe every gem rather than one.

Two consumers follow once those land: loot tables and class templates granting
variations by default, and extras retiring its three legacy flags (masterwork,
silver, shield variant) onto documents. Until then a flag owns its family and
extras refuses a variation that would double-count with it.

---

## Starting equipment: what a descriptor still cannot say

`parseEquipment` splits a template's printed Starting Equipment cell into items,
and most of what this section used to describe as unreachable has since been
built (2026-08-21, DECISIONS): a book's spell list is lifted onto the book and
into the template's spells, a creature named in the cell becomes the selection
on the ability whose companion slot it fills, and a descriptor is matched
against the catalogue in the forms that catalogue prints its names in. Of 719
printed descriptors that resolved to nothing, 30 remain.

Those 30 are not a gap. They are goods the books price where they name them —
a bladedancer's head dress, a lute, an ornamental crystal ball — precisely
because the shop list has no row for them. They import as named items carrying
the price the page printed, which is everything the page said.

What is still genuinely open:

**A choice the cell offers is recorded, not asked.** "and one spell of
character's choice" survives on the book's note, and is deliberately not minted
as a spell — but nothing yet turns it into a decision the sheet puts to the
player. A template's `items` carry a `choice` field and its `spells` do not;
closing this means the spell list learning the same ChoiceSpec shape the
ability entries already use, which is the magic model's to own rather than the
splitter's.

## A companion's creature, linked to the actor it names

Since 2.13.4 a template names WHICH creature fills an ability's companion slot —
"Rat totem animal" becomes `Totem Animal (rat)`, the selection on the ability —
and that is what the page says. What it is not yet is a link: the ability's
`actorUuid` stays empty, so a Judge still drops the rat in by hand.

The pieces are all present and pointing at each other. `resolveCompanion` fills
a slot from a cookbook `ref`, and leaves it alone when there is none — which is
every one of these, because the creature is chosen rather than named by the
ability. The selection is a NAME, and the monsters are imported as actors from
the same book. Matching the one against the other would fill the slot on import.

Two things to settle before it is built, and they are why it was not done in a
hotfix:

- **A name is not a ref.** "black cat" has to find the creature among the
  imported monsters, and a miss must stay a miss: filling the slot with the
  wrong animal is worse than leaving it open, because an empty slot reads as a
  question and a filled one reads as an answer.
- **Whose pass fills it.** `cookbookFillCompanions` already walks every ability
  and fills what it can, and is re-runnable — the natural owner. But the
  selection is written by the CLASS import, which runs before monsters, so the
  link can only ever be made on a later pass. That is the same shape the
  companion slot already has, so it is a matter of reading the selection where
  it reads the ref, not new machinery.

Until then the selection is the record, and it is a complete one: it says which
creature the template gives, which is all the page ever said.

## The system compendiums this importer does NOT yet replace

acks-extras 4.1 folds a system compendium out of the sidebar once the world
holds imported documents covering it (`hideSupersededPacks`). The map behind
that setting is a coverage audit, and every pack ABSENT from it is a gap here
— content a GM can only get from the system's own pack, which is exactly the
dependency materializing from their books is meant to end.

Covered today: weapons and armour (the book's own tables, via
`importWeapons`/`importArmor`), adventuring gear and clothing (178 register
entries), proficiencies (121 + 14 skills + 4 combat proficiencies), powers
(421), monsters (287 + 25 legacy + 4 templates), roll tables (23), languages
(the whole Appendix A taxonomy, read from the seat's own book at import time —
no language entry ships in this module; see DECISIONS 2026-08-15).

**Measured 2026-08-15.** Everything the cookbook can materialize was imported
into a world holding the seat's six books (1,307 documents), and each system
and module pack was compared against it document by document. Counts below are
that comparison. Two cautions on reading them: a miss can be a NAMING or
MODELLING difference rather than absent content (the system pack enumerates
"Craft: Smithing" and "Combat Trickery: Disarm" where the register carries one
`Craft` / `Combat Trickery` entry with picks), and the monster leg did not
finish inside its budget, so the monster numbers are unverified rather than
low.

**The first caution turned out to govern most of the counts.** The separate
register-vs-pack audit (`npm run verify:compendium`) was itself miscounting: it
read neither `kind.skill` nor `register/_refs/`, and its alias file had never
been authored, so a name the edition replaced and content filed under another
kind both read as absent. Corrected 2026-08-16, its proficiency gap fell from 16
to 1 and its power gap from 45 to 26 ([DECISIONS.md](DECISIONS.md)). The table
below is the LIVE IMPORT audit, a different measurement, and it has **not** been
re-run — so read these numbers as an upper bound on what is missing, and
re-measure before authoring against them.

| Pack | Docs | Not produced by the import | Verdict |
|---|---|---|---|
| `acks-languages` | 58 | **0** | **superseded in full** — now hidden by `hideSupersededPacks` |
| `acks-adventuring-equipment` | 103 | 11 | partial |
| `acks-all-equipment` | 55 | 15 | partial |
| `acks-clothing` | 38 | 17 | partial |
| `acks-proficiencies` | 119 | 35 (many pick-modelled) | partial |
| `acks-class-abilities` | 20 | 12 | partial |
| `acks-monsters` | 44 | 27 | UNVERIFIED (import timed out) |
| `acks-monster-abilities` | 52 | 48 | UNVERIFIED (rides the monster import) |

No system pack carries an Active Effect, so for these the question is only
whether the document exists; the module packs are the reverse (41/42, 32/34,
19/20 carry effects) and are covered above.

**Not covered — the gaps:**

- **Named equipment the import does not produce.** Coins and trade bars
  (Copper/Silver/Gold/Platinum, Furs), the helmet line (Light, Heavy Dwarven,
  Heavy Elven), the three Saddle and Tack rows, candles by material, bundled
  rows the price list sells as one purchase (Torches (6), 30 Sling Stones,
  1 Silver Arrow), Craftsman's Tools, and the ironbound chest. Roughly 43
  entries across the three equipment packs.
- ~~**Thief-skill powers as documents.**~~ SETTLED 2026-08-16 as a modelling
  difference, and nothing is owed. The Revised Rulebook's own table names eight
  thief skills — Climbing, Hiding, Listening, Lockpicking, Pickpocketing,
  Searching, Sneaking, Trapbreaking — and the register carries every one as
  `kind.skill`. They are class powers whose target improves with level, so they
  are ladders a class entry references rather than twelve standalone documents.
  `acks-class-abilities` prints Backstab / Climb Walls / Hide in Shadows / Hear
  Noise / Move Silently / Find Traps because it was built against ACKS I; those
  are now aliased onto the ACKS II names. See [DECISIONS.md](DECISIONS.md).
- **Monster resistances and immunities are not documents, by design.** Cold /
  Fire / Gas / Lightning / Piercing / Crushing / Slashing Resistance, Immunity
  to Fire, Regeneration and Superior Regeneration print as items in
  `acks-monster-abilities`. This module materializes them into `fields.defenses`
  by scanning the seat's own description prose against a shipped vocabulary
  ([COOKBOOK.md](COOKBOOK.md), "Defenses are materialized, never baked"), so
  they arrive as a field on the monster and never as their own item. The
  compendium audit still lists them, deliberately — a standing decision should
  be met while reading the report, not silenced inside the tool.
- **`Apostasy` is the one proficiency genuinely absent.** It appears in neither
  the Revised Rulebook nor the Judge's Journal, so it is ACKS I content or
  prints in a book this register has not read. Locate it before deciding
  whether it is a gap at all.
- **The monster legs were never measured.** Importing 287 monsters exceeded the
  audit's budget. Until it completes, `acks-monsters` and
  `acks-monster-abilities` are hidden by `hideSupersededPacks` on a floor of
  ten imported monsters while nobody has checked what the other 34 contain.

- **Spell lists** (system packs: 56 arcane, 19 divine). Deliberately parked —
  spell references land with the magic major (see the classes and repo
  roadmaps); the register carries the casting ladders but no spell documents.
- **Masterwork gear.** One `masterwork` mention across the register when this
  was measured; the rules are entries now (below), so what is left of this row
  is the sample pack's three demonstrations — a masterwork weapon and armour
  with the bonus already applied, and an invented named weapon. The JJ shield
  half of this row is CLOSED: the six forms import as shields (see
  DECISIONS 2026-09-01), which is what extras' six samples were.
- **Class training grants — what a class may WIELD and WEAR.** Imported
  classes carry their training as embedded Active Effects on the class
  document, writing the grant vocabulary (`flags.acks-extras.weaponProf` /
  `.armourProficiency` / `.styleProficient`, documented in extras'
  `scripts/equipment/proficiency.mjs`). The training originates from the JJ
  pp. 290–291 class-construction chapters.
- **Three henchmen mechanics the abilities model cannot yet say.** Imported
  proficiencies and powers reach effect domains through
  `scripts/equipment/abilities-bridge.mjs` and the name fallbacks in
  `scripts/henchmen/config.mjs`. Three cases carry no locators and reach only
  through the name fallback: **Inspire Courage's morale-roll bonus**, **Utter
  Domination's morale BASE of 4** (a floor, not a bonus), and **Beast
  Friendship's hiring magnitude** (the name fallback grants a bonus but not the
  +2). Additionally `def.prof.command` and `def.prof.leadership` are
  `audited: false` with no effects, so the two proficiencies most central to
  henchman morale are carried by the name fallback alone. **Inspire Courage
  reaches nothing at all**: no locator on its entry and no fallback pattern, so
  its morale-roll bonus is silently absent since the pack that carried it
  retired.
- **The two slayer proficiencies reach no route.** Goblin-Slaying and
  Vermin-Slaying wrote a `slayer` grant (`group:bonus`) as an Active Effect
  from the pack that retired. Their register entries carry no effect spec, and
  `abilities-bridge.mjs` has no case for the domain — it handles presence,
  numeric, style, martial, focus and trickery grants and stops there. So an
  imported Goblin-Slaying is prose: the bonus against its kind never reaches
  `scopeApplies`. Closing it wants either a locator on the two entries or a
  bridge case reading the pick, and the bridge case is the cheaper of the two
  because the group is the proficiency's own name.

## Which languages a class or a race speaks — the human homeland pick

Built for classes and races (2.9.4): a spread's `Tongues:` runin becomes the
class's granted list, a class whose page will not parse borrows from a
sibling of its declared race, bonus grants land as picks, and the race
documents inherit. What remains is the homeland pick itself — the regional
languages a human character chooses from print as prose examples rather than
a table, so that one slot is filled by hand from whatever the world holds.

The Nobiran spread prints no Tongues runin at all, so a Nobiran class carries
the human default and its race declaration waits for a page that names them.

**Searched 2026-08-16, and no such page exists.** The Nobiran racial spread
(JJ custom-classes chapter) carries no tongues line, and the only Nobiran
language reference in either book is the *Bonus Languages* POWER — which several
races may take and which grants a count rather than naming a list. So this is
not a page we have failed to read: the human default is the correct answer until
Autarch prints one, and nobody should re-open it looking for the page.

## OSE: what the first cut does not do

The path is built for monsters. Everything below is scoped out on purpose, not
missing by accident.

- **Areas, journals, treasure and NPCs.** A keyed adventure is a second grammar:
  a numbered heading opening a column, a roster line carrying a count and
  per-instance hit points ("2 golems: stats on p6, hp 14, 18"), run-in feature
  labels holding loot, and `Area N` cross-references that want to become links.
  Each publisher keys areas differently, so the heading pattern belongs on the
  per-source profile beside the stat-block labels. `cookbookImportJournals` is
  the path it should build through.
- **Maps and scenes.** Deferred entirely. Area text carries its printed map
  references as text; no Scene, no walls, no token placement.
- **Treasure-type letters.** Transcribed and flagged, never mapped — the two
  games' letters do not denote the same hoards and the guide prints no
  correspondence.
- **The ascending lineage.** ShadowDark and 5e-ish OSR blocks are detected and
  refused. The guide prints their armour-class rule, but range bands and bare
  ability modifiers have no ACKS counterpart, so it is a second grammar with
  several more gaps.
- **Percentile and x-in-6 conversion.** The guide prints both ladders; they are
  thief-skill and dungeoneering prose, not stat-block fields. Reading the ladder
  in one instruction also wants `value`'s documented `split`, which is not
  implemented — `docs/COOKBOOK.md` describes it but `applyPattern` has no branch
  for it. Fix the doc or the code before relying on either.
- **Class import.** The guide maps the B-X dwarf and elf onto ACKS classes, and
  the converter already uses that for saves-as. Importing them as playable
  classes is the class pipeline's job, not this one's.
- **Shareable dialect profiles.** A profile is geometry and label vocabulary
  with no values in it, so it could be exported for other Judges of the same
  book. It needs its own IP gate first.
- **The export direction.** ACKS II out to OSE. Note that the guide's forward
  and reverse formulas are deliberately not inverses — the reverse ones assume a
  fixed difficulty — so a round trip is off by one on saves and proficiencies.

## Deferred with the 2026-08-29 surface-index work

- **A "spell" cookbook kind.** Spells are not a cookbook kind, so a printed
  spell name in a template resolves only against what the world already holds.
  The open-pick offer sidesteps this for a CHOICE; a named spell still needs
  the world to hold it.
- **`liftBookSpells` splits on every "and".** A printed title containing the
  word — "purify food and water" — is torn into two entries. Two RR rows carry
  one. The fix is to split on commas and on the LAST "and" only when the clause
  carries no comma; it is a behaviour change to a shipped read and was not part
  of the 2026-08-29 rulings.

## A loaded book leaves nothing readable in the world (2026-09-03)

**Owner request.** Loading a book should put it in a **journal in the world**,
not only into places a Judge cannot open and read.

Where a loaded book currently lives, and why none of it reads as the book:

- The **connection** is a `FileSystemHandle` in the seat's IndexedDB
  (`module.mjs`). It is per-browser, invisible to other seats, and not a world
  document at all — a GM on a second machine sees no sign a book was ever
  connected.
- The **extracted prose** is materialized into the document each recipe creates
  (`prose.mjs`): a proficiency's paragraphs live in that Item's description with
  the page reference as the closing line. Readable, but only one entry at a
  time, and only by finding the Item first.
- **Location journals** are the one existing exception (`cookbookImportJournals`
  — one `JournalEntry` per `meta.group`, one page per keyed entry). The shape
  works. Nothing else uses it.

So a world that has imported everything holds hundreds of readable fragments
and no readable *book*: no table of contents, no way to read a chapter through,
nothing to hand a player, and no record of what was taken from which book at
which pages beyond the per-document citations.

**What has to be decided before this is built**, because each answer changes
the shape:

- **What a journal is per: the book, the shelf, or the recipe run?** A journal
  per book reads like the book and grows enormous. A journal per shelf matches
  how imports are already grouped and shelved. A journal per run is an import
  log, which is a different artifact answering a different question — possibly
  both are wanted.
- **Does it duplicate the prose, or link to it?** Duplicating gives a readable
  chapter and two copies to keep in step on re-import. Linking gives one copy
  and a page of `@UUID` references, which reads like an index rather than a
  book. `prose.mjs`'s `data-acks-entry` stamp already distinguishes imported
  text from a Judge's edits, so either can be re-imported safely; the choice is
  about what a reader wants, not what is implementable.
- **Ownership.** Imported book content is app-licensed in-world material. A
  journal is the easiest thing in Foundry to hand to a player, so its default
  ownership is a deliberate decision and not a default to inherit.

Not blocked on anything. The journal-writing machinery exists and is proven by
the location journals.
