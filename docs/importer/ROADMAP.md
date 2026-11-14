# Roadmap

Re-issued 2026-11-14.

Designed but not built. Anything here is deliberately absent from the code, not
missing from it.

---

## Two phases: unload from the book, then organize in Foundry

The importer builds documents while it reads pages. The owner's hypothesis is
that this one-shot shape drives its order and repair defects ("phase 1 unload
from book, phase 2 organize in foundry. I suspect a lot of wonkiness is getting
driven by attempts to one-shot it", 2026-11-13). Built: the rules tables read
first and applied after the classes, so a first Import Everything is complete
for leader throws, kits, class experience and race tongues (DECISIONS
2026-11-13, "The rules tables are read first and applied after the classes").
Not built:

- **The adventure books** (places, maps, organisations, the pregens' feed,
  adventures) as a read, then a plan, then an apply, so that one confirm is
  counted from the plan. About fourteen landings and nine live walks; the
  risk is walls, storeys, links and the ids that pins and seats rely on.
- **The whole importer.** A record per entry (the executor's output, a reason
  for each miss, a stamp, the side products) held for the run; phase-2 passes
  that each compute a plan (create, update or leave) which one writer applies
  in batches; Repair as the same read run over a scope and the same apply under
  the repair policy, with one confirm and no second pass. About thirty landings
  and fifteen walks, and it is the first thing a new Judge runs. Holding the
  record past the run (a GM-owned world compendium of journal entries) is its
  own owner ruling, since it reverses DECISIONS 2026-10-29, "Nothing is imported
  without the book". It would supersede in part the two-pass repair of
  2026-11-11, the in-place write of 2026-11-04, the dry pass of Import
  everything (2026-11-04) and the page cache and repair scope of 2026-11-13;
  paired places (2026-10-24), later books superseding (2026-10-17) and "Every
  rebuilt document keeps its id" (2026-10-28) stand. The step order has no
  dated entry and needs one.

## Rebuking undead: the borrowers' own recipes

The crusader's table imports as ladders, and Rebuke Undead gets one throw per
ladder plus the effect roll ([DECISIONS.md](DECISIONS.md)).

What is left is the OTHER entries that read the same table at a fraction of
their own level — a craftpriest at its class level, and the powers and
proficiency that control undead at a stated fraction of theirs. Each is a
`fromLadders` spec on its own entry naming the same class and table; the
fraction and its rounding are printed beside the rule, so each recipe locates
them rather than stating them. No code is needed for any of it — the spec form,
the numerator/denominator on the target, and the resolver all ship.

## Cross-book merging beyond the current signals

Families merge today on a shared member id or a shared family suffix. Entries
that are the same creature under different names in two books — with neither
signal — still import as twins. A chef-authored alias would close it; the
question is whether that belongs in the register or in the binding.

The layer that joins books (a place two books print, which printing wins, a
link or an Adventure that crosses books) is rebuilt after each book's own
import is right, not patched meanwhile; the owner left a duplicate import
source unbuilt for now (2026-11-13). Its rows are under "Edits taken", "The
next books" and "What AX1 and AX3 still leave" below.

---

## Gear values the tables do not reach

Weapon damage, armour AC, and the cost and weight of anything the price grid
sells are read from the reader's own tables: the values are in grids, and
grids are read whole.

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
- **An adventure's own price table.** AX1 prints the cost of the three items
  it introduces in a grid beside their descriptions (AX1 p.69). Only the
  Revised Rulebook's grids are read by name, and the three descriptions state
  no cost, so the three import unpriced. A reader for a book's own gear grid,
  keyed by the item's row, closes it. The ballista's description also states
  no damage die, so it imports as a weapon without one.

## Mechanics an imported entry does not yet carry

The system's own packs still answer some things the import does not produce
from the reader's own book. The common shape: a NAME imports, and the
MECHANIC does not. Effect locators are the work that closes most of this, and
the per-category variants need a way to express "this entry, with one of its
choices already made".

- **Class training outside a class.** The class import states training as
  effects on a class document, which serves a character who HAS one of the
  printed classes, and two of those do not import their training at all. A
  custom class, a homebrew build, or a character configured without a class
  item has no other source for a fighting style, an armour rung or a weapon
  selection. These would have to become importable documents in their own
  right, from the class-construction chapter rather than from any one class's
  spread.
- **Per-category proficiency variants.** The register holds ONE entry where a
  configured variant per category is wanted: combat trickery, fighting style
  specialization, martial training and weapon focus each pick a category. And
  a number of combat proficiencies import by name and description with no
  effect locators, so what imports cannot do anything.
- **Henchmen proficiencies and powers.** About fourteen import by name and
  description only, so the hiring, loyalty and morale modifiers they carry
  are absent from the imported versions.
- **Two henchmen mechanics the abilities model cannot yet say.** Imported
  proficiencies and powers reach henchmen's domains through located typed
  effects (extras' `docs/henchmen/MODEL.md` §4, "Imported powers"). Two carry
  no locator: **Utter Domination's morale base** (its shape wants a ruling
  first: extras' `docs/henchmen/ROADMAP.md`), and **Inspire Courage's
  morale-roll bonus**, which reaches nothing at all.
- **The two slayer proficiencies reach no route.** Goblin-Slaying and
  Vermin-Slaying wrote a `slayer` grant (`group:bonus`) as an Active Effect.
  Their register entries carry no effect spec, and `abilities-bridge.mjs` has
  no case for the domain — it handles presence, numeric, style, martial, focus
  and trickery grants and stops there. So an imported Goblin-Slaying is prose:
  the bonus against its kind never reaches `scopeApplies`. Closing it wants
  either a locator on the two entries or a bridge case reading the pick, and
  the bridge case is the cheaper of the two because the group is the
  proficiency's own name.

## Money, trade goods, and rows sold as a bundle

Coins and trade bars (copper, silver, gold, platinum) and furs are not in the
equipment grids at all — they are money and freight, priced in their own
sections. Two rows the price list sells as one purchase (a bundle of torches,
a count of sling stones) import as the single article instead, and the elven
helmet has no row in the books read so far. The rest of the same gap: the
helmet line, the three Saddle and Tack rows, candles by material, Craftsman's
Tools and the ironbound chest.

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

`importEquipment` has ruled that a mule is a creature — a described `animal`
entry becomes an ACTOR. The price grid's own livestock section never got the
same treatment: 26 rows, and seventeen class templates name a riding horse.

Doing it needs two things a patch cannot carry: the actor-side dedup
`importEquipment` uses, and an answer for `resolveBase`, which searches items —
a template naming a horse would stop resolving to one and fall back to a bare
named item. The rows carry the section they were printed under, so the fact
needed to decide is already there.

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

Class 21 (`def.class.class21`) states its combat training in a paragraph the level
table sits inside, so extraction folds the table's cells through the sentence
mid-word. The parse refuses the whole paragraph rather than grant the clauses
that survived. Reading it needs the paragraph located by its COLUMN — the
machinery the prose boxes already use — rather than by the page's reading
order.

The barbarian is a different absence: its training is a table of peoples, one
row per region, and which row applies is the reader's choice. That is a
variant to be registered, not a value to be read.

## Gnostic invocations as documents

The two gnosis-casting classes' casting entries carry the gnosis kind and the
Maximum Invocation Level ladder, but their invocation lists (BTA ch.5) are not
imported as documents. The RR classes' spell lists ride repertoires
(`def.classmeta.spellRepertoires`); the invocation lists should ride the same
mechanism.

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

## Variations: what the documents cannot yet say

`kind.variation` mints `acks-extras.variation` documents through
`importVariations()`: the five masterwork differences the schema can express
exactly, silver (a material multiplier on the listed price, deliberately
`cost.baseMul` so it never multiplies a masterwork surcharge), and cosmetic
ornament, each with its surcharge and deltas read from the seat's own page by
located specs. Not built:

- **The masterwork families the schema cannot yet hold.** Instrument,
  structure and ship are printed in the same passage (RR p.161), but their
  benefits are Performance throws, structural hit points and speed — none of
  which is a `deltas` field. They want either new delta fields in extras or
  `conditional` entries (the schema's own "value claims reported to the Judge,
  never applied").
- **Gems.** The Gem Value table is printed in the Judge's Journal treasure
  chapter, and it is a ROLL TABLE (roll / value / type), not a quality
  variation, so it wants `kind.rolltable` in the treasure wave of "The Judges
  Journal charts not yet read".
- **The `baseTypeFields` table** and the consumers that follow it (loot
  tables and class templates granting variations by default, the legacy item
  flags onto documents, the carry-state model for the shield forms): extras'
  `docs/equipment/ROADMAP.md` owns them.

## A companion's creature, linked to the actor it names

A template names WHICH creature fills an ability's companion slot — "Rat totem
animal" becomes `Totem Animal (rat)`, the selection on the ability — and that
is what the page says. The slot itself is filled from the table: the picker in
`abilities/companions.mjs` asks the moment such an ability lands on a
character, and the Inventory tab offers the slot after that
(`docs/abilities/MODEL.md`). What is not built is the LINK from the selection:
a slot whose selection already names the creature is offered the whole library
rather than opened on the rat.

The pieces are all present and pointing at each other. `resolveCompanion`
fills a slot from a cookbook `ref`, and leaves it alone when there is none —
which is every one of these, because the creature is chosen rather than named
by the ability. The selection is a NAME, and the monsters are imported as
actors from the same book. Matching the one against the other would pre-select
the picker, or fill the slot on import.

Two things to settle before it is built:

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

## What the import does not yet produce from the system's packs

Every compendium a world holds stays in its sidebar (docs/lib/DECISIONS.md,
2026-09-02); the gaps here are content a GM can only get from the system's own
pack. The last measurement was a live import of the seat's six books compared
with each pack document by document; a miss can be a naming or modelling
difference rather than absent content, and the figures have not been re-run,
so re-measure (`npm run verify:compendium`) before authoring against them.

- **The monster legs were never measured.** The import of 287 monsters
  exceeded the audit's budget, so nobody has checked what the 34 monster
  documents the system's pack holds, and the import does not produce, contain.
- **Monster resistances and immunities** print as items in the system's
  monster-abilities pack; this module materializes them into `fields.defenses`
  by scanning the seat's own description prose against a shipped vocabulary
  ([COOKBOOK.md](COOKBOOK.md), "Defenses are materialized, never baked"), so
  the audit lists them as absent by design.
- **`Apostasy` is the one proficiency genuinely absent.** It appears in neither
  the Revised Rulebook nor the Judge's Journal, so it is ACKS I content or
  prints in a book this register has not read. Locate it before deciding
  whether it is a gap at all.
- **Spell lists.** A class whose list the book states in prose rather than on a
  repertoire page keeps an empty list and offers its tradition whole.

---

## A loaded book leaves nothing readable in the world (2026-09-03)

**Owner request.** Loading a book should put it in a **journal in the world**,
not only into places a Judge cannot open and read.

**Built for the shelf:** a book the server holds is a journal with a PDF page
— the book itself, readable from the sidebar and shareable like any journal
(DECISIONS 2026-09-03). What is still not readable:

- A book connected on a seat's own disk. Its **connection** is a
  `FileSystemHandle` in that seat's IndexedDB (`module.mjs`) — per-browser,
  invisible to other seats, and no world document at all. Putting the book on
  the server is the route to its journal, and the guide says so; whether a
  seat-only book should leave any trace in the world is open.
- The **extracted prose**, as a book. It is materialized into the document each
  recipe creates (`prose.mjs`): a proficiency's paragraphs live in that Item's
  description with the page reference as the closing line. Readable, but only
  one entry at a time, and only by finding the Item first. **Location
  journals** are the one existing exception (`cookbookImportJournals` — one
  `JournalEntry` per `meta.group`, one page per keyed entry). The shape works.
  Nothing else uses it.

So a world that has imported everything holds hundreds of readable fragments
and, where its books are on the server, the books whole — but no readable
*extract*: no table of contents of what was taken, no way to read a chapter of
imported entries through, and no record of what came from which book at which
pages beyond the per-document citations.

**What has to be decided before the extract journal is built**, because each
answer changes the shape:

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
  ownership is a deliberate decision and not a default to inherit. The shelf
  journal set the precedent: Foundry's default, the creating GM alone.

Not blocked on anything. The journal-writing machinery exists and is proven by
the location journals and the shelf.

## Import everything waits on the monsters step's own question

`cookbookImportMonsters` confirms through a modal every time it runs, so the
Getting Started chain — whose own note says a chain narrating its progress
must not stop on a modal, and which skips `cookbookUpdateClasses` for that
reason — stops at step 7 of 13 until the Judge answers, and an unattended run
sits there indefinitely. The chain should either ask once, on the panel,
before it starts, or hand the step a confirmed flag so the modal is the
standalone macro's alone.

## Import speed

A full import re-runs each recipe over its pages on every run. The caches that
exist cover folders, packs, the presence of an imported document
(`importedCache` in `scripts/importer/cookbook/target.mjs`) and, per call, a book's
extracted pages in the rules-tables step and the abilities update (DECISIONS,
2026-11-13, "A bulk import reads each page once"). A timed Import Everything took
2728 s, 2377 s of it in the abilities step: 729 item writes and 4169
`getDocuments` calls, which the empty-id-list patch in lib and the ladder
cache's quiet window remove (DECISIONS, 2026-11-13, "An update pass costs a
write, not a library read"). The rules-tables step took 149 s with 132
`getDocuments` before, and 41 s with 13 after on twice the library writes;
the abilities step's count under a burst of writes is not yet measured (that
DECISIONS entry). Not built: a skip for an entry whose source and recipe are unchanged
since its last import, judged by a stamp on the imported document; one write of
the imported-tables setting per run instead of one per document, which the
tables step makes about fifty times; and book Adventures that are assembled
before their stamp is compared. Time a full run live before choosing between
them.

## The debug window's picker

`cookbookDebug` executes a definition id correctly, but the picker it raises
with no argument walks the per-book cookbooks alone, so a Judge can only reach
a content-cookbook entry — every class, power, skill, proficiency and piece of
equipment, ~800 of them — by typing its id from the console. Offering them
means answering what a picker with two thousand options should look like; a
second grouped select, keyed by content type, is the shape that fits the
dialog it already has.

## An actor keeps whatever the recipe said the day it was imported

Every actor import path asks whether the id is already present and stops there,
so a release that corrects an entry's geometry reaches an existing world only
when a Judge repairs the actor in place (a stat-block monster, a vehicle or an
animal; DECISIONS, 2026-09-24). The
Item side can already carry a withdrawn id forward through the `merged` array;
the actor side compares ids exactly and has nothing equivalent, and there is no
per-document prune for an actor whose id no longer resolves — only the
whole-library removal. What is unbuilt is the pair: an actor-side alias so a
retired id resolves to its replacement, and a dangling-actor sweep beside
`cookbookPruneAbilities`. The 2026-09-09 decision records what was measured and
why the first release shipped a written remedy instead.

## `cookbookImportIds` declines an entry without saying so

Which kinds it builds is stated at the entry point; what is unbuilt is the
refusal. `importMany` counts the actors that came back and has no branch for a
null, so a declined id produces no notification, no count and no reason — two
sessions have now spent time probing a change through this entry point
before finding the guard in `importOne`.

Making the refusal audible is a placement question, and `importOne` is the
wrong place for it. Its contract is document-or-null and `importMany` counts
`if (actor)`, so a reason object returned in place of null is truthy and lands
in the success total — the change would have to reach a loop every caller
shares, and that loop is not where the bad input arrives. It arrives in exactly
one place: the dialog and import-all both enumerate through
`actorEntriesAcrossBooks`, which filters on `actorKindOf`, so neither can hand
`importMany` a kind it will decline, and `cookbookImportIds` is the only entry
point given an unvalidated list. It already pre-filters that list once, on
`importedIdSet()`. A kind filter sits beside the presence filter, in the one
place a wrong kind can enter, and the counting loop never learns the check
exists. What the Judge then gets is the declined kinds named beside the count
of what was already present — the two silences that currently look identical,
told apart.

## NPC proficiency tokens the index cannot resolve

An AX3 NPC import logs its statline tokens that match no definition. Three of
274 remain, each a name no shipped cookbook defines: a class's name standing
where a proficiency goes (`ax3.npc31`), a variant spelling of a class power
(`ax3.npc30`), and a proficiency no book in the build defines, carrying a spell
list as its specialty (`ax3.npc20`). Each wants a ruling of its own: an alias
authored on the definition it means, a definition, or a documented skip. The
other four were extraction and text-layer defects (DECISIONS, 2026-09-23).

## A character's spells when the world holds none (T-0540)

A character import resolves the spells its spellbook names against the spells
the world already holds; with none imported, every one is listed as missing.
Proficiencies are imported on demand (`resolveAbilities`); spells are not.
Importing a named spell from its book at that moment is a new surface.

## An NPC description that carries its own statline

`ax3.npc26`'s last description paragraph holds its own statline and the prose
that opens the next column's entry: the description box reaches past the
statline and across the page. The statline itself reads correctly since
`assists.statColumns`; the description flow is its own fix, and whatever
closes it must leave the 2026-09-23 recompile's other entries byte-identical.

## The Judges Journal charts not yet read

Each chart takes the route the 2026-09-23 ruling gives it (rules data with a
RollTable projection, a cookbook RollTable, or a setting table). Wave 1, the
wilderness encounter charts the `encounters` doc already held, shipped as their
projection. Wave 2 read the sub-tables a terrain result names and the treasure
and ruin lookups, and the throw now rolls them (DECISIONS, 2026-09-30). In order:

2. **The rest of the wilderness chain**, into `encounters`. ~~Lairs per hex~~
   and ~~the terrain results that hand off to another draw~~ are read
   (DECISIONS 2026-10-09, "Lairs per hex is read from the procedure's own
   page"): the lairs row, the substitution bands and the settled shares from
   the procedure's page, the either-or share from the placement page, and the
   chain recurses into a double, a monster draw, an either-or and a
   despoiling. **Climate by terrain** stays: read it once something consumes
   it (the monster sub-tables remain a terrain pick, formation DECISIONS
   2026-10-09).
3. **Dungeon**: wandering monsters by level as cookbook RollTables carrying the
   monster-level flag the delve draw reads, the level matrix as a setting
   table, and the dungeon chapter's stocking and treasure charts.
4. **Settlement and NPC completions** for the henchmen consumers that already
   exist. The appearance-by-people tables are not yet read; every title is a
   people's name, so a recipe locates it by key (`locateHeadingKey`,
   DECISIONS 2026-11-13).
5. **The sea chain**, which wants a voyage encounter consumer that no feature
   owns yet.
6. **The Judge-only d-tables**: each a small cookbook RollTable.
7. **Treasure and magic items**: every table read from the Judges Journal,
   with the Treasure Tome layered over it and nothing read from core's
   treasure pack (DECISIONS 2026-11-11, "Treasure is read from the Judges
   Journal"). Gems are this wave (see "Variations" above). The Treasure Tome
   is registered (`tt`) against these consumers and nothing reads it yet,
   which is the one standing exception to the rule that a book id must unlock
   something; its importer is next-roadmap work.
8. **The custom-class, custom-spell and magic-type remainders**, gated on the
   magic work.

Obstacles common to several waves: bands that carry their own dice, two-level
and operator column headers, and chart titles that are printed names, which a
plain-string `locate` would put in source.

## Printed values in the importer's own source

- **Anchors that carry a figure.** `table-recipes.mjs` locates tables by
  strings that include a printed figure (about twenty `locate`/`find` values
  and thirty-eight `labelRe` patterns). A lint gate for the shape, and the
  sweep of the existing ones, are not built.
- **A recipe's own directions for the stat mapper.** `stats-map.mjs`
  `mapPairs` acknowledges "Other Senses" and maps none of it; structured
  senses per recipe are not built. One-off recipe directions for a label the
  mapper does not understand are not built either.
- **The name rule on an identifier.** `dwarvenCastes` (in `table-recipes.mjs`,
  with consumers in `scripts/henchmen/rules/identity.mjs` and
  `builder-binding.mjs`) names a printed people's castes in an identifier; the
  name rule wants a neutral label and a locator.
- **Candidates not yet judged.** The importer and registry candidates the
  comment cut raised and no reviewer has read for printed values.
- **`docs/importer/TESTING.md` states encumbrance figures** in its equipment
  recipe: a page value in a tracked doc.

## The extraordinary variant of a damage-type icon

The text layer reads a damage-type icon as its word (`glyphWords` in
`executor.mjs`) and does not claim the mark's colour, which tells the
extraordinary variant from the mundane. A stat block's typed damage therefore
carries the type and never the variant.

## A monster whose entry runs past its first page

The plain monster recipe reads an entry's description from its anchor page
alone: the anchor's column down to the next display heading, plus the spill
columns a chef authored on that page (`assists.descColumns`). Nothing flows
onto a second page. The Monstrous Manual starts every entry at the top of a
left column, so any page between an entry's first and its successor's first
is that entry's continuation — and the register declares one page for all
but a handful. Seventeen entries lose their tail this way (found 2026-09-25
by listing every entry whose successor starts two or more pages later, then
reading the pages between for a display heading: none had one). Among them
are casters whose spell paragraph sits on the lost page — the draugr, the
kraken, the leyak, the mummy lord, the vampire, the incarnation on p.36 of
the PDF — so `bindMonsterSpells` never sees it and the actor imports with
no spells.

What it takes: a description page-flow in `compileMonster` keyed on
`pages[1..]` — each continuation page's columns from the body top to that
column's first display heading, grids and stat boxes excluded as the template
flow already does — then the seventeen spans widened in the register and each
entry's paragraph count read against the page. A refill in place then
completes every affected actor.

## A monster's lair: what the Encounter field does not reach

The lair or encounter printed after a monster's Spoils is read into its
Encounter field, and a notes block into Notes (MODEL, the spoils bound). The
Lairs & Encounters book's lairs are places (below); the monster book's own are
not. Left:

- **The monster book's own lairs as documents.** The Encounter field stays the
  text's only holder. A Lairs journal of rows waits for routing by kind (owner
  2026-11-13: "Wait for routing"). A lair imported as a place with its roster
  of monsters, its treasure as items, and the monster book's lairs gathered in
  an Adventure of their own is next-roadmap work (owner, 2026-11-13). The
  owner asked whether a lair is a new actor type or an extension of the
  monster group/encounter actor, one that "should link without creating
  duplicates"; the Lairs & Encounters book took the place actor (DECISIONS
  2026-11-13, "Lairs & Encounters is a Judge's book…"), and whether the
  monster book's lairs take the same shape is open.
- **Spoils no register row points at.** Three entries print a Spoils block
  that no `spoilsPage` names, so the block is left unclaimed: two human
  variants and the mummy lord. Seven more carry a Spoils label
  that yields no spoils field.
- **The kraken's first column on p.198 of the PDF** is still unread: the
  continuation reads only that page's second column.
- **The demonic attercop's spoils tail on p.31 of the PDF** sits above its
  section label and is still part of no field.

## A family's leaders: what the Role axis does not reach

The family import reads its leaders, casters and dependants into role cells
(monsters MODEL, "Family templates: the Role axis"). Left:

- **A standalone leader template outlives its creature.** Deleting the
  creature leaves its `.leaders` template standing; nothing removes or flags
  it. A delete hook keyed on `leadersOf`, or a repair check listing a template
  whose creature is gone, would close it.
- **A sentence the locators cannot read.** A leader phrased outside the
  shapes `leader-roles.mjs` matches adds no cell, silently. A debug listing
  of each family's prose sentences that name a role and wrote none would show
  which.
- **A throw the ladder arrived after.** Leader cells and grid rows read the
  attack-throw ladder at import, so a template imported before the rulebook's
  tables has no derived throws until it is repaired; generation does not read
  the ladder again.

### The AXIOMS beastmen (T-0393)

The owner ruled the whole set in (2026-11-04): AXIOMS offered beside the MM as
a source the Judge picks per template or per generation, the MM the default and
the pick shown as provenance, and AXIOMS the only source where the MM prints no
leader. Built: the compendium as one book (`axc`), its leader ladder and steps
as imported tables, and the derived champion, sub-chieftain and chieftain
cells for every family variant and for a beastman-type entry outside a family,
with the Leader figures axis (monsters MODEL, "Derived leaders" and "Leaders
outside a family"), and the Kit axis with its three tables (monsters MODEL,
"The Kit axis"). Left:

- **The compendium's other content.** No anchors, register or cookbook entries
  exist for anything past the beastman tables; the AXIOMS move, encumbrance
  and damage columns of Beastmen by Type are not read.
- **Casters and dependants under the procedure.** Shamans, witch doctors,
  drudges and whelps stay printed-only; the procedure derives the three
  warrior ranks.
- **Mounted troops.** The rider rows of RR ch. 9 Beastman Troops print a
  rider's and its mount's figures in pairs; a kit for them needs a rule for
  which half a rider's cell takes and how the mount is named.
- **A leader's damage in a kit.** A leader keeps its own damage total in any
  kit, so a kit whose row prints more than the warrior's stat block does not
  raise it.
- **The kit on the Full Monster Sheet's speeds.** The kit's move reaches the
  system's movement figure, not the sheet's speed rows.
- **The classes.** The AXIOMS custom beastman classes, through the class
  importer, held by the owner (2026-11-05) until directed to resume. Their
  progression tables read as the title-located grid the class compile already
  has; no new extraction shape. In order:
  - **A. The classes, simple mode**: three `kind.class` entries in a new
    `register/axc/`, anchored on the prime-requisite label; the per-level
    damage column as a progression ladder, a parenthesised cell read as no
    bonus at that level; the attack throw from the imported monster column
    (`monsters`/`attackThrowByHd`), which replaces the page's own progression
    under the later-printing ruling. The owner prefers the reading that agrees
    with the Monstrous Manual's (by Hit Dice); `throwStep` reads monster
    notation and needs an adapter from a class cell's Hit Dice first.
  - **B. Their character templates**, so a player can pick one at chargen: a
    compile path for a lone template block and a 3–18 band for it.
  - **C. Races and the builder**: the race grids, a race value that stacks
    with the fighting value for attacks only, and a race whose experience
    keeps doubling past the usual cap.
  - **D. Mystic paths**: a second level counter with its own caster rows. No
    ACKS II counterpart; until it is built the paths are awarded powers with
    their imported text and casting is not automated.

## Repair in place: what it does not write yet

Repair (MODEL, "The merged repair") writes what a fresh read yields over a
held document. Four things it does not write yet:

- **A field the page stopped printing.** Outside a monster's stat paths, a
  repair cannot tell a field the page states as none from one this seat could
  not read, so the old value stays. Each binder would have to declare which
  fields its entry claims to fill, as `REFILL_STAT_PATHS` does for a monster.
- **The equipment annotation layer.** A repair annotates only a held row that
  declares no slots, so a container capacity or ammunition bundle corrected
  there reaches only new documents. `annotateItem` now fills only the gear keys
  an item leaves blank (equipment DECISIONS 2026-11-10), so the merge this
  waited on exists; whether a repair annotates every held row is still
  undecided.
- **Edits to `system` a Judge made.** A repair keeps only the fields each kind
  lists as the Judge's. A read snapshot stamped at import, under a new flag,
  would let it tell an edited field from a stale one.
- **A per-field force.** Only `repair.force` overwrites a set value, so a
  field the Judge set on a market, such as its gate-toll switch, has no way to
  be forced from the book alone.

Rules tables merge. A repair that removed the world layer before re-reading
would undo "a re-read that finds nothing keeps what it had".

## Edits taken: what a repair still leaves

- **A place two books print.** Either side of a pair is joined by its own step
  and a repair does not rebuild the join, edits taken or not. Wanted: a
  rewrite that rebuilds the joined place from both rows.
- **A pregenerated character's grants.** Answered *Write the book over it*,
  its sheet import runs again and its biography is written, but an item the
  import granted that a Judge edited is
  not replaced. Every grant carries the same `minted` flag and no record of
  what was granted, so an edited grant cannot be told from an untouched one:
  replacing one needs a per-item sum written at import, and an item the class
  bind made does not come back while the bind skips a character already at
  that class and level. Its round trip wants a live walk before it ships.

## Overhead token art: what is not built

- **The variant-suffix tier.** Exact folded-name matching leaves the monsters a
  source prints as a variant of the same creature unmatched, counted as no
  match. A tier that strips a variant suffix needs the owner's rule on which
  variant wins when several share a head.
- **Remembering the answer.** Nothing makes a later import or a Rebuild pick the
  overhead token by itself; the Judge presses Apply again. A remembered choice
  is a second writer and a branch in `importArt`.
- **A repair check for a token that names an inactive package.** Uninstalling
  the source leaves a broken path until Restore.

## A pregen's portrait and spellbook

AX1's pregens import as characters from their write-ups (DECISIONS,
2026-10-24, "A pregen is a write-up read across its columns"). The portrait
the page prints does not reach the sheet: the rows carry no `art` op, so each
character takes the default image. An inhabitant's art path
(`adventureActorArt`) would serve once the rows name the picture's placement.

## A book's Adventure in another world

A world compendium is world-scoped, so a second world needs the pack moved by
hand, and its picture needs the same server. Wanted: an export path that
carries the picture, without shipping any of it.

## What the settlement book's register does not yet reach (audited 2026-09-30)

Every keyed place, every quarter's residents section, every list and every
organisation has a row. What has none, by shape:

- **A counted rank a special-encounters list prints without scores** has no
  NPC row; every block with its scores has one, grouped under the quarter's
  special encounters.
- **The two champions of the gladiatorial schools**, whose blocks sit in the
  residents section beside their school's organisation row.
- **Occupants of the keyed interiors** (the special-location writeups) — the
  factions ROADMAP's "People named only in the room-by-room writeups". The
  named persons of the bridge, temple and lake interiors have rows, under
  special-location groups. The old and festival quarters' interiors (AX3
  pp. 87–94, 120–124) have none: their persons and their own ranks (a guard,
  a burglar, a torturer, each with a block), well over eleven blocks across
  more than three interiors, and the unnamed ranks of the bridge, temple and
  lake interiors, wait for a slice of their own.
- **The building tables** (size, type and occupants, occupant tables, style,
  treasure): the printed half of the dynamic-buildings row in
  `docs/formation/ROADMAP.md`.
- **The doing-business page** beyond tolls, duties and the smuggling service:
  moorage, stabling and labour fees, equipment availability, mercantile
  investment, selling treasure. Printed figures with no register kind yet.
- **The appendix's new magic items.**
- **Counts a body's page states in prose** rather than in a strength grid —
  the factions ROADMAP's "A count the page states in a sentence".

## The next books, in order

AX3's above-ground city is finished, as one Adventure with its features,
and its region map imports on its hexes with the gazetteer's sites. The four
adventures the region holds are registered for what the region needs of
them — AX1's tables, AX4's tables and forest zone, AX5's new monsters, tables
and two zones, AX6's tables and zone (the user's ruling of 2026-10-09: ACKS II
supersedes only where identical, else the more specific printing is correct).
The underground city stays out of scope.

**AX1 whole** is built under the rulings of 2026-10-17 (DECISIONS), with what
has landed in MODEL and TESTING: one Adventure per book; key spaces of neutral
rows; four maps and the fort's floor plans joined as scenes, with walls traced
at import on the plans a tracer mode reads; characters from the page; later
books superseding a shared place. What is left is listed under "What AX1 and
AX3 still leave" below.

- **AX1's narrower encounter rules.** Two areas and a room of the first
  level print their own interval and chance inside the level's (pp. 37, 43,
  45). They wait for the delve to compose the zones under the party smallest
  first, as a journey does. Today the delve reads the first zone, which
  would be the level's (formation DECISIONS 2026-10-09). The fort's rooms
  that throw on entering, by day and by night (pp. 12, 13, 17), are a
  settlement's shape and wait for the fort's plans. The forest's zone carries
  its list and its chance but not its hourly interval, and one hex's crossing
  throw (p. 35) is a throw on entering, a trigger no zone has.

What each book still owes, in the order it is worth doing:

- **AX2 whole.** The adventure is registered for what the region needs of it
  (its tables, monsters and entrance caves). Imported whole, as AX1 is — keyed
  places, plans, characters, one Adventure — it is not read; the owner left it
  to the next roadmap (2026-11-12).
- **Dungeon maps** (AX2, AX4, AX5, AX6) as scenes with their keyed areas
  placed, the way AX1's are planned.
- **Terrain from the render:** painting the region's terrain from the page's
  picture, which a density, orientation and component classifier could not
  do at the page's resolution; the Judge paints it for now.
- **Military forces** the adventures print, as the factions feature's
  strength grids.
- **The d100 stocking tables** beyond the ruined-building one, and **AX5's
  spells**.
- **Amended terrain multipliers** where an adventure overrides the core's
  figures.
- **Zone results as creature links:** a zone's drawn result naming a monster
  the world holds becomes a link to it.
- **Adventure links from the sites:** a site that is an adventure's own
  location (25 to AX4, 44 and 46 to AX5, 52 to AX6) opens that adventure's
  document. AX1's (27 and 28) wait with the cross-book layer.

## AX1's text no row reads

`verify-cookbook ax1` lists the runs of each page that no row claims. Once
the passages, sidebars, room tables, headings and captions are claimed, what
is left falls in two classes:

- **A price list** (p.24). It is a grid of offerings and prices, which is
  content a market or a journal table would carry, and no kind reads it yet.
- **A person's spells, special abilities and equipment** (p.65). The person
  printed as prose before the statistics imports as NPC 11, read up to the
  end of the stat line; the labelled run-in paragraphs after it have no
  compiler path.

Headings on pages whose rows are prose, items or pregens are claimed as
skips by a row on another page (`axAssistSkips` honours a skip's own
`page`), because `compileProse`, `compileAdventureItem` and
`compilePregen` emit no `_skips`.

## What AX1 and AX3 still leave

- **Double doors the box reader misses** (AX1 p12). The two passages between
  corridor and courtyard are drawn in ink lighter than the threshold (a second
  box pass at a lighter cut reads one and adds a false door on a bench), and
  the east gate's upper leaf is not found; each stands as an asserted
  correction. p12 carries 14 corrections against its budget of 12, and the
  fort's p19 plan 13 against 12.
- **Walls on AX3's plans.** The building plans have no tracer run yet. The
  city map's streets and gates stay shelved.
- **AX1's domain record (p.28)** waits for the domain sheet. When the sheet
  exists, the record's market fields could ride the market-record path: the
  fort is the second market of AX1's demand grid.
- **Occupants deployed as tokens.** A room's roster carries count and
  per-instance hit points as notes. A structured hit-point field, or members
  as a group actor's deltas (`docs/lib/GROUPS.md`), waits for something that
  deploys them onto a scene and reads them back.
- **A character's choice awards.** A character from the page holds its
  class's fixed awards and Adventuring; a choice award needs an answer the
  page does not give, and stays open.
- **AX3's people as characters.** They stay monster NPCs. Converting them
  means re-minting stable ids and re-pointing every organisation and roster
  slot that names them.
- **The AXIOMS Compendium against the adventures.** `axc` and AX2–AX6 all
  carry 2018, and the owner's 2026-10-28 order places the adventures and the
  AXIOMS issues among themselves but not the compendium among the adventures,
  so a pair between `axc` and one of them is still refused (DECISIONS
  2026-11-13, K9).
- **A sideways grid's duplicate goods.** A good a transposed grid names twice
  is reported by its key, not its printed label: the duplicate report in the
  market-profile step reads `grid.header` only, and a transposed grid keeps
  its printed labels in `grid.labels`. An unmapped good is reported by its
  label.
- **AX1's fort as AX3's site 28.** Site 28 binds onto its market, so it
  builds no place of its own to join, and the fort stands apart until joining
  two places that both stand is ruled.
- **A restamped world copy's notes.** A world copy made before its place
  joined is restamped by the maps step, and its notes stay as copied until the
  copy is deleted and brought again.
- **Removing one book of a pair.** Remove Imports for the later book deletes
  the place, and the earlier book's rooms name a deleted parent until its
  places step runs again. Removing the earlier book leaves its id in the
  place's `merged`.
- **A pair's parent in the earlier book's Adventure.** The place is carried
  with its parent in library form, so importing that Adventure into a world
  without the later book's places gives the place a library parent.
- **AX3 places split at a page turn.** Four AX3 rows (two points of interest
  and two people) break a sentence where their text turns a page, so each
  reads one paragraph as two. `assists.joinTurns` joins such a turn on the
  row that asks for it. Turned on for every row, it also joins two rows'
  table cells to the prose above them, so it waits for a guard that tells a
  table from a sentence.
- **The block plates' section drawings** (AX1 pp.11, 14). Each plate prints
  one section of its block below the plan, at another scale and with no
  grid, and the scene stops above it. It would be a scene of its own.
- **The rest of AX1's ways between maps.** The first link rows join the
  region to the fort and to the first level, the two levels by two stairs,
  the fort's four towers to the tower plan, and the tower's storeys
  (DECISIONS 2026-10-25), then the fort's three gates to the gatehouse plans,
  the wall walks between the towers' and the gatehouses' upper storeys, the
  shaft from the first level's key 42 to the second level's key 20 (down
  only), and the way between the first level's key 75 and the second's key 1.
  The plans do not draw which tower a gatehouse's walk meets, so a tower's
  end offers every gatehouse's and the token is asked. Left:
  - the fort's blocks and buildings to their plans, which mark no single
    entrance;
  - the later book's site that is the first level (`ax3.site27`), on that
    book's region map, to the first level's plan: a link that crosses books,
    held with the cross-book layer.

## The OSR Catgirl: what is not built

The `cat` cookbook ships the race's five tiers, the catfolk beastman, the
three classes, the tavern's two floor plans as gridless scenes in the
book's Adventure (DECISIONS 2026-10-18, both entries), the ten items the
book introduces, as core items read whole (DECISIONS 2026-10-19), its six
passages as journal pages and its keeper as a character (DECISIONS
2026-10-23, both entries). Left, each waiting on a kind or a reader rather
than on authoring:

- **The tavern's keyed rooms (p27, 1–11)** and the links between its two
  floors. The tavern's text is a journal page with its room numbers inline
  (kind.prose, DECISIONS 2026-10-23); kind.location rows over the two plans
  would give each room a place of its own, once that path reads a key set
  inside a paragraph rather than at a heading. They join the Adventure the
  plans already stand in.
- **Routing a shelf by kind.** A Judge's book's own rows all close; the day
  one of this book's has to stay open to players — an essay, an item written
  per book rather than as `def.equip` — the destination moves from the book's
  flag to the row's kind (the rejected design in DECISIONS 2026-10-18, "A
  mixed book"). Not before: it re-points every folder site in the importer.
- **The items' grants (p24–26).** Each item is worn where its page says and
  priced from its cost line (DECISIONS 2026-10-28); what it grants stays in
  the description. Reading the grants into effects needs what no feature has
  yet: an attack and damage bonus scoped to natural or thrown attacks (the
  equipment contract's melee and missile domains are flat), a wearer-level
  mark that the wearer's own attacks deal extraordinary damage (the flag is
  per weapon), a plain item's transferred effects gated on its worn state,
  and a ruling on what a player character's claws are, since the class
  powers carry them as prose. Daily powers and the hidden-weapons searching
  penalty stay prose in any design.
- **The classes' picture tables.** All three spreads print their level table
  as a picture (p13, p17, p20), and one its spell-slot table too; the rows,
  hit dice, damage ladder, cleave and gains come from the sentences and the
  experience from each class's build (DECISIONS 2026-10-30), but titles, the
  thief-skill and backstab columns and the slots are only in the pictures, so
  the Judge types them. Reading them is half built: the executor's `art` op already reads a
  page's placed pictures (`pageArtInfo`/`getArt`) and the scene binding cuts
  a region of a page into a picture. The missing half is recognizing the
  cells — a character-recognition library (its wasm and language data,
  shipped or fetched, and its licence) — which is the owner's call. Against
  it: a misread cell imports a wrong figure silently, where a typed one is
  at least the Judge's; any build would need the rows checked against the
  picture before they are written.
- **The classes' powers.** Each spread's class abilities stay in its
  description; a `def.power` row per ability, awarded at its level, is a
  content row each.
- **A race document.** The five tiers ship as class powers under one group
  and the race's history as a journal page; a kind for a race as a document
  (`acks-extras.race`, which the class builder already lists) would hold
  them together: the requirement line (p7) as its minimum attributes, each
  tier's cost line as a value with the tier's power, the history as its
  description. A content kind end to end — row, compiler, binding — rather
  than a row for a kind that exists.

## The Judges Journal's prepared parties: what is not built

The 27 members import as characters in Party 1 to Party 5 folders, with a
Parties journal of their introductions. Left:

- **A formation party built from a prepared party.** A party's members live
  in a world-level record keyed by world actor ids, which cannot travel in a
  compendium, so a party is a folder and not a formation party.
- **Folder names from the page.** The folders carry the neutral `Party <n>`;
  the page's own heading reaches only the journal page's text.
- **Mounts and mercenaries as documents.** A member's mount, holdings and
  followers stay text in the write-up.
- **The appendix's own introduction** (PDF p. 451, before the first party) is
  read by no row.
- **A two-line display heading stops `compileProse`'s flow,** so the party
  introductions anchor on their first body line instead of the heading.

## Lairs & Encounters lairs: what is not built

- **Walls and room pins on the plates.** The plates import as pictures on a
  grid; room keys stay in the listing's prose until a reader for inline keys
  is built (the same reader the picture-tables rows need).
- **The plate pointer in a neighbour's notes.** Eight listings' notes carry
  the pointer line of a plate that belongs to the listing beside them.
- **Ordinary warriors and generic crowds.** Compared with the MM's figures
  (DECISIONS 2026-11-14, "A made L&E stat line is paired…"), five lines match and
  are paired; the other rank-and-file of the beastman and demi-human lairs,
  the sized swarms, the variants of a paired creature and the men of a role
  print a figure the row does not and are made from their stat lines. Left
  to a reviewer: the near misses (a printed weapon's damage against the row's
  "by weapon", a label whose occurrences disagree, a row whose attack text did
  not read) and the rows that print a regular and a veteran profile, which
  cannot be compared line against line.
- **A lair list on the monster.** A monster's sheet does not list the lairs
  whose `meta.of` names it.
- **A lair on a hex.** A lair is not placed on a region map's hex or tied to
  the lairs-per-hex procedure.
- **The grid on plates that print another scale.** One plate is drawn in
  miles with a gridded inset, and several plates' bars read about 4 or 5.3 ft
  a square; all take the owner's 5 ft.
- **A lair inset's storeys as levels.** The p. 214 plate's large inset draws
  two buildings with unequal storey counts on one Scene; they are not split
  into levels.
