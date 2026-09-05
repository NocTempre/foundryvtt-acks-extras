# Importer — decision record

> Merged from the separate acks-importer repo on 2026-09-01. Text written before then names paths as they were there: `scripts/x.mjs` is now `scripts/importer/x.mjs`, `tools/x.mjs` is `tools/importer/x.mjs`, `flags["acks-importer"]` is `flags["acks-extras"]` (the importer's `generated` key is now `minted`), and `acksImporter.fn()` is `acksExtras.importer.fn()`.

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### The barbarian's column is declared elected (2026-09-04)

**Problem.** The barbarian's damage-bonus column is headed exactly like the
fighter's, so the header-driven key could not tell the column the player
narrows at 1st level from the column that is simply unrestricted — and the
consumer's answer to that ("ask every unqualified column") had every fighter,
bard and assassin answering a barbarian's question.

**Ruled.** The register declares the barbarian's column `electedDamageBonus`.
The qualifier is read off the class's own combat paragraph, which is where the
page states it; the header stays the locator. `tools/importer/lint-register.mjs`
is unchanged — it asks that a header's narrowing be present in the key, and an
elected column's header carries none. `repairClassLadderKeys` reaches a
barbarian imported before the declaration by its existing rule (the one
declared key that is the bare name behind a qualifier), so no world needs a
re-import. Every other bare `damageBonus` column now means both, which is what
acks-extras writes for it.

Supersedes the last paragraph of the 2026-08-27 entry below.

---

### A book the server holds is a journal (2026-09-03)

**Ruled: a staged book is a `JournalEntry` in the world — one per book, filed
under "Your Books", with a single PDF page whose `src` is the staged path — and
that page is the shelf record.** The world setting that held the shelf since
2026-08-21 is read once by the first GM seat to arrive, turned into journals,
and emptied; nothing reads it after that. `shelf()`, the join-time restore and
the Books window all read the journals, so every consumer sees the destination
the write chose.

**Why a journal.** The owner asked that a loaded book leave something readable
in the world (ROADMAP, 2026-09-03), and the shelf already held the one thing
that reads as the whole book: the PDF. Foundry's own PDF page renders it in
pdf.js with the book's own contents, so a Judge opens the book from the
sidebar instead of from their disk, and shares it the way any journal is
shared. The file system alone gave them a path in a setting nobody could open.

**Why the page is the record, and not a mirror of the setting.** Two records
of one shelf drift — the 2026-08-25 window bands were exactly that failure, at
the scale of one dialog. With the page as the record, a Judge deleting the
journal has unstaged the book, and a Judge re-pointing the page has re-pointed
the shelf; both are gestures they already know, and the restore's fingerprint
refuses a page that no longer answers for its book.

**Rejected: the bytes in the document.** A hundred-megabyte book as a field on
a JournalEntry is a hundred megabytes sent to every seat at every join, before
anything renders. The page points at the file; the file stays under the data
directory, as it always did.

**Ownership is Foundry's default — the creating GM, and nobody else.** Handing
a book to a player is a deliberate gesture on the journal. The 2026-08-21
caveat stands unchanged: a file under the data directory is fetchable by anyone
signed in who learns its path, and the journal changes who can FIND the book,
not who can fetch it.

**Not an import.** The journals and their folder carry the `shelf` flag, never
the `cookbook` one, so Remove Imports leaves them alone the way Forget Books
already did: the shelf is the GM's staged library, not something the module
made from it.

**Cost.** One more migration at ready, GM-only and idempotent — an entry that
fails to land leaves the setting for the next load. A player seat that joins
before any GM has sees an empty shelf until then. Live, 18 staged books
carried across in one load, and a book staged twice stayed one journal with
one page.

---

### The whole chain gets one bar, and it counts steps (2026-09-02)

**Ruled.** *Import Everything* opens a single progress notification for the run
and clears it in a `finally`. Five of the thirteen steps drew nothing at all, so
a run could sit silent for minutes with no way to tell work from a hang — the
report that prompted this said exactly that.

**A progress notification belongs to no window, which is what makes it the
right surface.** The chain runs from the Getting Started band AND from the
hotbar macro, where there is no window and the old per-step toasts were all a
Judge got. One notification serves both, and it does not expire while short of
its total, so it persists for the whole run. **Rejected: a window of its own.**
A new surface, new strings, and a thing to keep on screen for nine minutes,
when core already has the shape.

**It counts STEPS, because that is the only total knowable in advance.**
Several steps cannot say how much they hold until they begin — a table recipe
scans until it hits, a vehicle expands into rows only the page knows — and the
per-step bars already report items where an item count exists. So the two
answer different questions and both are needed: the per-step bar ticking is
what says *still working*, and this one says *how much is left*. **Nothing is
faked**: no invented denominator, and no smoothing across steps of wildly
unequal length.

**A step counts as done whether it succeeded or threw.** The chain already
survives a failing step; a bar that stalled on one would report a hang that is
not happening.

**Known and accepted:** core stacks newest-first and caps at five live
notifications, so this bar sits below the per-step bar and shares the cap with
anything else the session raises. Neither costs correctness, and both are
core's behaviour rather than ours to fix.

### Importing again refreshes what it did not create (2026-09-02)

**Ruled.** `cookbookUpdateAbilities` closes `stepAbilities`. Refreshing the
abilities is part of importing them, not a separate gesture a Judge is asked to
know about.

**Rejected: doing the same for classes.** `cookbookUpdateClasses` is the
matching half and stays out of the chain. It has no ownership guard — it asks
once, then replaces each class's whole `system`, hand edits with it — and it
asks through a MODAL, which a chain that narrates its own progress must not
stop on. The gap that justifies routing the abilities pass does not exist here
either: classes are world documents, so removing the imports and importing
again already rewrites them. Abilities are routed because an ability can live
on an actor, where that gesture cannot follow.

**This supersedes the "Accepted cost" paragraph of "Imported text is written
into the world, once, by the GM who owns the book" (2026-08-24)**, which said
worlds imported before the change hold `@PdfText` tags, that the repair is
*Remove ALL Imports* + import again, and that there is no repair pass. Two
things that ruling did not know:

- **Its stated repair cannot reach the documents that matter.** *Remove ALL
  Imports* enumerates world collections and label-matched packs and never
  descends into an actor. `cookbookUpdateAbilities` is the only function that
  walks an ability owned by a character, so a proficiency on a player's sheet
  was unrepairable by any gesture a user had — permanently, by construction.
  Import itself never revisits an existing document, so importing again could
  not have cleared it either.
- **The repair pass it declined to build already existed.** The cost it weighed
  — "would keep the whole per-seat resolution path alive" — does not apply,
  because nothing is built here. The pass was written, correct, and reachable
  only from a sidebar button and the API. This routes it; it does not add it.

**Rejected: a separate *Update Abilities* macro.** The macro pack deliberately
ships only what a Judge chooses between — connect books, import everything,
delete everything, rebuild one shelf — because the individual steps have a
dependency order and offering them invites running them in the wrong one.
Refreshing is not a decision; it is the second half of importing.

**Rejected: widening the import path's overwrite to match legacy-scoped
documents.** `cookbookImportAbilities` has no ownership guard at all, so a
broadened match there would clobber a Judge's own copies and edits
unconditionally. The guard lives only on the update path, which is why the
update path is the one that got routed.

**A book that is not connected must not cost text — or mechanics.** With no
session for an entry's book the executor yields no node, and everything rebuilt
from one degrades together: the description becomes the citation line alone, and
the extras block loses its node-derived parts. The stamp marks that description
as this module's own, so the ownership guard read it as overwritable and the
write went through — trading a Judge's imported paragraphs for a stub on any
seat that ran the pass without every book open.

**An entry whose book yielded no node is now passed over entirely**, and counted
as such in the report. A narrower first attempt held back only the description
and let the rest of the rebuild land, on the reasoning that the register repairs
the mechanics without the book. Live verification refuted it: `category` and
`deprecated` did come back from the register, and `extras.effects` came back
**empty**, because effect detection reads the extracted text. Holding back one
field of a rebuild that is uniformly impoverished is a guess about which fields
are node-derived, and it was wrong on the first one checked. What cannot be read
is not rewritten.

**Cost:** *Import Everything* now walks every ability in the world, actors
included, so it takes longer on a large world. An unflagged, hand-made ability
whose description is **empty** and whose name matches a definition is adopted and
stamped by a run a Judge may have thought of as import-only; anything holding
words is asked about first, as before. A seat that has not connected its books
now repairs nothing rather than repairing a little — which is the honest report,
and the notification says how many were passed over and why.

---

### One picture per entry, one register per kind (2026-09-01)

**Ruled.** Every one of the 819 register entries that becomes an Item carries an
`icon`, no two differently-named entries share one, and each kind draws from a
visual register that says what the row is before its name is read:

| Kind | Register | Source |
|---|---|---|
| proficiency, combat proficiency, skill | flat white-on-black pictogram | `systems/acks/assets/icons/` |
| class | heraldic banner | `icons/sundries/flags/` |
| power | effect art — spell, knack, or stronghold | `icons/magic|skills|creatures|environment/` |
| equipment | painted object | `icons/commodities|consumables|containers|equipment|tools|weapons|sundries|environment/` |
| variation | forge and material | `icons/tools/smithing/`, `icons/commodities/`, `icons/equipment/shield/` |
| trap | the mechanism, or the thing that hits you | `icons/environment|weapons|magic|tools|commodities|skills/` |
| vehicle | conveyance | `icons/environment/vehicles|settlement/`, `icons/tools/nautical|navigation/` |

Before this, 73 of 819 were placed: 437 powers had no icon at all and fell back
to one book, 68 goods shared one bag, 43 structures shared one castle, 13 traps
shared one trap, every class was one of nine grey glyphs. A sidebar of imported
items was a wall of repeats, which is the same as no icon at all.

**`icons/svg/*` is banned outright, in entries and in generated documents.**
Those flat greys are what Foundry gives a document nobody chose a picture for,
so choosing one is indistinguishable from not choosing — every duplicate above
was one. Generated documents (a monster's attack, a spoil, a grid row, an
ability with no entry behind it) cannot have a per-entry icon, so they take
`DEFAULT_IMG` from `scripts/constants.mjs` — painted art from the same folders,
one named symbol rather than a scatter of literals.

**Sameness is per printed NAME, not per id.** Lay on Hands is one ability under
three classes and Manacles is one item in two books; each keeps one picture, and
the ledger counts a collision only when one path answers to two names. That is
also why the power register reaches into the ACKS tree: where a class power *is*
a printed proficiency (Alertness, Armor Training, Deciphering), it wears the
proficiency's pictogram rather than a second picture for one concept.

**Rejected: keyword-scored auto-assignment.** `tools/propose-icons.mjs` already
measured it — 2 right and 14 wrong in a 42-entry sample, with Battle Magic
scored onto a battle AXE — and its verdict stands. Every path here was picked by
reading the entry; the tool's `--search` mode and the ledger's `--free` are what
made that tractable.

**The gate is a ratchet, not a snapshot.** `tools/icon-ledger.mjs --check`
(against `register/_icons.json`) fails when unplaced entries increase, so a new
entry authored without an icon is caught where it lands rather than at the next
release. `--apply` refuses any path not present in an installed library, which
is what keeps a typo from shipping as a broken image on every seat.

**Cost.** A handful of picks are approximate because the libraries have no
better answer: four horseshoes stand in for three chariots and a saddle, a
stable stands in for a donkey, a bolt of cloth for a signal flag. Eleven of
those carry an `iconNiche` upgrade from game-icons.net for seats that have the
pack. The one surface still sharing pictures is the weapons and armour grids,
whose rows are minted from the page and take `DEFAULT_IMG.WEAPON`/`.ARMOR`/
`.SHIELD`: giving each printed row its own art needs a name-keyed table in
shipped code, which is the IP structure-vs-content line and wants its own
ruling.

### A shield form is a shield, not a difference applied to one (2026-09-01)

**Ruled.** The six Judges Journal shield forms — auxiliary, buckler, crescent,
heater, kite, phalanx — import as core `armor` items of type `shield`, one base
item each, filed on Equipment / Shields. They imported as `acks-extras.variation`
documents from 2026-08-16; that is reversed, and the entries are `kind.equipment`
now.

A variation is a difference a reader applies to a thing they already own:
masterwork, silvering, an ornament. A form is not that. Nothing in the books
sells a shield and then sells kite-ness to fit onto it — the passage describes a
complete piece of equipment a soldier is issued, and a reader who wants one buys
one. The two shapes were also visibly the same thing twice: extras' sample pack
ships all six as playable armour while this module shipped six documents of the
same names that could only be dragged onto a shield, and extras' own variation
layer refuses a `form` variation on any item already carrying the shield-form
flag, because the flag and the document say the same thing.

**The item states an ordinary AC, and that is what changed.** The earlier ruling
recorded none, on the reasoning that a form does not state a magnitude — the book
repeats "+1" because a standard shield is +1, and what a form states is where the
AC applies and when it does not. That reasoning holds for what the number MEANS
and the conditions are still enums on the entry (`grantsAC`, `mounted`,
`deniedWhen`, `noBack`, `noMount`, `requiresStyleSpecialization`). What it cannot
survive is the document becoming the shield itself: core adds an equipped
shield's `aac.value` unconditionally and the overlay reading those enums corrects
DOWNWARD from it, so a form with no AC is not conservative, it is an unusable
shield and a broken correction. Each entry therefore locates its own in-hand AC
and its own encumbrance from the seat's page, by a locator anchored in that
entry's own sentence — never one pattern swept across six passages, which is the
mistake the 2026-08-16 entry was written against and which is what produced a
bare `equippedAC: 1` on all six.

Encumbrance is now read for all six rather than three. As a difference, a figure
that changes with the carry state stated nothing unconditional and was left out;
as a base item, the weight in hand is the item's weight and the carry states are
the overlay's business — so the crescent takes the figure its passage states
first, and the kite and phalanx take their dismounted one.

**Rejected: the Armor shelf**, beside the shields the RR grid materializes. The
shelf a document lands on is the shelf that rebuilds it: "Armor" is refilled by
`importArmor`, which reads a printed grid and cannot mint a described entry, so
one shelf rebuild would have deleted the six with nothing to put back. Equipment
refills from the entries, which is where they now are.

**Cost.** A world that imported the forms before this holds six documents of a
type that cannot be changed in place, under ids that moved with the kind, so
`repairShieldVariations` deletes the library copies and the equipment import
re-creates them — the `repairAnimalItems` pattern. Variations a Judge already
applied to a shield are embedded copies on that document and are never touched.
The forms carry no price: the Judges Journal prints none for them.

### A grid may be keyed on a name, and its cells need not be numbers (2026-08-30)

**Ruled.** A table recipe may declare `labelText`, saying its label column holds
a NAME rather than a level. The compiler's row walk judged data rows by "the
first cell is a number", which every level-keyed table satisfies and which the
Crusader Rebuking Undead grid (RR p.39) cannot: its label column is the undead
type and its columns are the crusader's levels. Under the numeric rule the table
resolved one data row and warned.

With `labelText` the header lines are told apart by what they ARE — the line
carrying the declared label header, a spanning line of bare integers, a line too
narrow to be a row — instead of by not being numeric. The walk also skips a lone
footnote marker sitting on its own baseline between two rows: it carries no
cells so it can never be read as data, and breaking on it cost the table its
last row, which is the asterisked one.

**The cell rule is structural and holds no printed letter.** A cell that parses
as a number is a target, a dash is a rung the character cannot act on, and
anything else non-empty is a rung reached without a throw. Which letter the page
prints there rides through as the rung's `text`, read from the seat's own book.
Writing "R means automatic" into the recipe would have shipped the rule, and
naming the nine undead types in it would have shipped a table of options; the
row labels come off the reader's page and become the ladder keys.

**Each row becomes one class LADDER on the crusader**, rather than roll targets
on the Rebuke Undead power. A published table is borrowable: a craftpriest
rebukes as a crusader of their class level, a necromancer controls as a chaotic
crusader of half (rounded down), and the Black Lore of Zahar raises that to two
thirds. All four read the one table at a different fraction — which is what
acks-extras' `progression` target already expresses — where nine targets copied
onto each power would be four transcriptions of one page.

**Still open:** nothing yet EMITS the throws that point at those ladders. The
throw count is data (nine types here, and a Judge's own book may print another),
so the spec form has to expand per published ladder, and an ability entry is
executed with no sight of the class that awards it. Where that linkage lives is
undecided — ROADMAP.md.

### A list is bounded by the label that introduces it (2026-08-30)

**Problem.** A class's printed Proficiency List arrived with prose welded into
its names — "paladins select one class" fused to "Berserkergang". The box was
computed from the detected COLUMN, and a class page is dominated by its
templates table, which starves the column detector into reporting one column.
A one-column read boxes the list across the full page width, so the Proficiency
Progression paragraph printed beside it fell inside; in reading order the two
columns' runs interleave, and every welded name arrived unresolved. 115 names
across the thirty-one class lists.

**Ruled.** The box never starts left of its LABEL. A run-in label sits on the
left edge of the column it introduces, so the label's own x is a better left
bound than a detected column start that may not exist. That alone recovered 96
of the 115.

Three residues needed measuring rather than inferring, and the register now
carries `class.profList` `x0`/`x1`/`y1` for them: a list whose comma-aligned
entries voted a phantom column mid-list, losing every line's tail; one that ran
on into the prose printed under it with no gap the stop heuristic could see; and
the chapter TAB the page paints into its own margin, which on a recto lands
inside a right-hand list's column between two lines. The tab is dropped by TEXT,
not geometry — it reads the same as the running head, and no proficiency is ever
named after the chapter.

**Rejected.** Repairing the column detector. Its docstring already records why:
lowering its threshold invents columns out of table cells and page tabs, and
supplying the edges run-in headings imply leaves the false edges in place. The
fix here needs no such evidence — it uses a bound the field already has.

**Cost.** Three per-class measurements that a re-printing can invalidate. They
are visible: `tools/dev-proflists.mjs` reports every class's list against the
surface index and names what fails, and the release recipe reads its total.

**Also ruled: two more printed short forms are aliases.** By This Axe writes
"Dungeon Bashing" and "Fighting Style" where the Revised Rulebook writes
"Dungeonbashing Expertise" and "Fighting Style Specialization". Same footing as
Art/Craft (2026-08-29): a second printed surface for an entry this module
already ships. That the BTA form means the RR proficiency is a reading of the
books, not a mechanical fact — it is the entry a class list can offer, and the
alternative left eight dwarven classes silently short two proficiencies.

---


### A printed floor and a printed rate are read, not shipped (2026-08-29)

**Problem.** Two numbers the rules define reached the engine as nothing at all.
The 1st-level hit die carries a printed minimum and the engine applied none, so
a character rolling under it kept the raw roll. Hit points per level past 9th
are set by the saves chassis and adjusted by race; the racial half was already
extracted and read by nobody, and the chassis half had no recipe at all, so a
class built with the Judges Journal builder gained a flat-less die count past
9th while an imported class of the same spread carried the printed bonus.

**Ruled.** Both are imported, both through the machinery that already exists.
The floor is a new `hitPoints` ruledata document read from the chargen chapter
by a `proseValues` recipe; the rates ride the EXISTING `savesRule` recipe,
because they key on the saves chassis and the book prints them in that section —
a second page scan would buy nothing. `builder-binding.mjs` assembles them into
`budget.hpAfterNine`, keyed as the book PAIRS them (crusader+mage,
fighter+thief), which is a different pairing from the post-8 XP increments
beside it, so the two cannot share keys.

**Rejected.** `kind.constant` for the floor: those entries are harvested box
geometry against a fixed rectangle, and the sentence carrying this floor is
running prose. Folding the rates into `acks.classBuilder`'s own tables: that
document is builder INPUT handed wholesale to the derivation, and a hit-point
floor is not a build point.

**Cost.** Two anchors that a re-printing can move. Both are `find` strings on
lowercase clauses carrying no digit before the number, which is the shape most
tolerant of the welded words and interleaved superscript runs real extraction
produces; `tools/test-hitpoint-tables.mjs` and the class-builder table test
assert against the real books that the anchor still lands on an integer, and
deliberately assert nothing about WHAT the integer is.

**Verified negative, recorded so it is not re-investigated.** Only the dwarf
prints a racial post-9th hit-point rate. The elf, halfling, Nobiran and Zaharan
sections carry the boilerplate sentence naming the category and state no value,
so `hpAfter9: null` for those races is the printed absence and not an
unfinished extraction.

---

### A second printed name for a shipped entry is authored on the entry (2026-08-29)

**Problem.** Two resolvers in `cookbook.mjs` answered the same question
differently. The class Proficiency List read a flat last-wins map; a template's
proficiency cell read a length-sorted menu whose ties fell to cookbook load
order. Twenty printed names resolved to a class POWER on one path and the
PROFICIENCY on the other — "Acrobatics", "Climbing" and "Weapon Finesse" among
them. A template then granted a power the character was never owed and, because
ownership is matched on type and name, silently refused them the proficiency
ever afterwards. Separately, the merged Art/Craft proficiency was reachable
under neither of the short forms the books also print for it, and the gap was
papered over by a literal in shipped source.

**Ruled.** One `abilitySurfaceIndex` feeds both paths, arbitrating collisions
with the category ranking the monster path already uses. A printed short form
is authored on the entry that owns it as `aliases`, compiled into the cookbook,
and gated by `lint-register`: an alias may only give another printed surface to
an entry this module already ships, never introduce a name for something it does
not, and never collide with another entry's name or alias. The world's holdings
are deliberately NOT consulted — what a spread MEANS is a fact about the book,
not about what has been imported yet.

**Rejected.** Generalising the equipment list's slash convention: `Art/Craft` is
the only slashed awardable name of the corpus, and a rule authored for a
population of one is a rule that will be wrong for the second member. Keeping
the `Spec.` abbreviation hatch beside the alias rule: two coexisting rules make
the longest-first scan order-dependent, so the hatch was deleted and the same
abbreviation is now authored as an alias.

**Cost.** The alias field is authored data with no in-app editor, correctly —
it is a fact about a printing, not about a world. It reaches the compiled
cookbook only through one line in `compile-cookbook.mjs`, and it fails SILENTLY
if that line is lost, which is why `test-cookbook-coherence.mjs` asserts the
shipped entries carry their aliases end to end rather than asserting the
compiler in isolation.

---

### A printed pick rides as an offer, not as a dropped sentence (2026-08-29)

**Problem.** A starting package sometimes hands over a choice rather than a
thing — "and one spell of character's choice". Minting it as a spell produced a
document called "One spell of character's choice", so it was dropped instead and
preserved only in the item's note. That is invisible on the character: the
player is owed a spell and nothing anywhere says so, and the pick is simply
never made.

**Ruled.** The clause rides in the spells array as a row carrying no name whose
`offer` is set, with a ChoiceSpec naming what may be picked and a stable `key`
built from the book it came out of. The printed sentence still stays on the
note. Nothing is minted here — the importer records the OFFER, and acks-extras
turns it into something the player can answer.

**Cost.** `offer` is a flag, not an inference. An emptiness test would be
cheaper and is wrong: a blank row added by hand on the class sheet has no name
and an initialised ChoiceSpec, and would read as an offer.

### The library is the packs AND the sidebar this module stamped (2026-08-29)

**Problem.** A world that imported before imports moved into compendia keeps
that library in the sidebar. Every item-side read asked the packs alone and
took the sidebar only as a fallback for a pack that would not open, so those
documents were invisible: the dedup gate called each one missing and the next
run minted a twin into the pack. The field report was a chargen class list
offering all 31 classes twice, the two generations interleaved by the page
their citations name — the tell that they were made by releases either side of
the move.

**Ruled.** "Imported" means a cookbook flag, not a shelf. `sidebarImports`
gives the item reads the same world-then-pack reach the actor reads
(`importedIdsOfType`, `importedActor`) have always had, so an import is found
wherever a release put it. Packs are read first, so an id a world holds twice
answers with the copy on the shelf a write lands on.

**Rejected: a migration that moves sidebar imports into the pack.** It rewrites
every uuid a character, a class template or a Judge's own macro points at, to
tidy documents that work where they are. And **rejected: deleting the twin
automatically** — both copies are legitimately the Judge's, and which one their
world already points at is not knowable from here. The existing controls now
reach both: Remove Imports always swept the sidebar, and rebuilding a shelf
sweeps it as of this ruling.

**Cost.** `importedDocs` now returns only flagged documents. In a pack-less
world it used to answer with every document of the type, homebrew included, so
a hand-made item could claim a printed name in the price list's library check.
That was never intended and the reads all filter for our own flag anyway.

---

### A column key carries every qualification its printed header carries (2026-08-27)

**Problem.** The paladin's progression column is headed *Melee Damage Bonus* and
was keyed `damageBonus`. The header is a LOCATOR — it finds the column and is
dropped at compile — so the key is the only part of a column that reaches a
class document's ladder, and the only thing a consumer can read to decide who a
value applies to. Keyed unqualified, the paladin's melee-only bonus arrived
shaped exactly like the fighter's unqualified one, and nothing downstream could
tell them apart.

**Ruled.** A key spells out every attack-type qualifier its header states.
`tools/lint-register.mjs` enforces it over `melee`, `missile` and `unarmed`: a
header carrying one and a key that does not is a lint failure naming the key it
should have. The check is register-only by necessity — the compiler keeps a
column's key and geometry and discards its header, so this is the last point at
which the two can be compared at all.

**Only attack-type qualifiers are checked.** They are the ones that change WHO a
value applies to. A header word the key merely spells differently is not a
defect, so the gate asks that the narrowing be present, not that the names match.

**A repair, because no ordinary re-import would reach one.** `importClasses`
skips a class the world already holds, so a wrongly-keyed ladder would survive
every re-run. `repairClassLadderKeys` compares each imported class against the
keys the cookbook declares NOW and re-keys a ladder whose key has since been
qualified — document-driven, so no book need be connected and no class is named
in code. It re-keys only where exactly ONE declared key is that same name behind
a qualifier; anything less certain is left alone rather than guessed at. A label
moves with the key only while it still reads as the one import derived, so a
Judge who retitled the column keeps their title.

**Unqualified is not a synonym for "both".** *(Superseded 2026-09-04: the
barbarian's column is declared `elected`, and bare now means both.)* The
fighter's column is printed
without a qualifier because the bonus is unrestricted; the barbarian's is
printed without one because the player elects melee or missile and cannot change
it. No field of a class document separates those two, and the importer does not
invent one — what an unqualified column means is the consuming module's
question, and acks-extras asks the player rather than assuming.

---

### A citation names the printed folio; everything else names the PDF page (2026-08-27)

**Problem.** A field report showed a class power citing a page two past its own
entry. Every core-book citation was wrong the same way, and had been since the
first one shipped: the Judges Journal prints folio 314 on PDF page 316, and the
Revised Rulebook, Monstrous Manual and Treasure Tome carry the same two pages of
front matter (By This Axe carries one). 1154 shipped citations sent a reader
past what they were looking for.

**Why nothing caught it.** The registry already had `printedOffset`, added for
the AX line whose folios visibly disagreed with their PDF pages, and exactly one
cite composer applied it — the one written beside it. The other six interpolated
the raw page, and the five core books were never given an offset at all, so the
composers agreed with each other and with the register. Page numbers are never
converted anywhere else in the pipeline: no gate, no probe and no round-trip
compares a citation against anything that knows what the paper says.

**Ruled.** Every book carries a `printedOffset`, and `citeFor` in
`scripts/books.mjs` is the ONE place a page number is translated for a reader.
Register entries, compiled instructions and art pointers keep addressing the PDF
page — that is what the reader hands the extractor — and the conversion happens
at the single point a number is shown.

**Rejected — deriving the citation at runtime from `book` + `pages`.** It would
make the offset impossible to forget, but 29 entries cite a page their `pages[0]`
does not name: an alias is read from the passage its text prints in, and its
citation follows the text rather than the listing. Deriving would lose exactly
what the 2026-08-12 alias ruling established.

**Rejected — a migration.** Consistent with the 2026-08-24 ruling: existing
documents keep the citation they were written with, and *Update Abilities* —
which already rewrites the generated surface — repairs them. An item whose prose
a Judge has edited keeps its old citation, because that path holds the whole
description back; that is the accepted cost of never clobbering someone's
writing.

**The gate that was missing.** `test-cookbook-coherence.mjs` now asserts that
every citation equals `citeFor(book, description page ?? pages[0])` — a check per
shipped citation that fails on the raw page and passes only on the folio. The
offset itself is not derivable from shipped data, so the gate proves the
composer, not the number; the five offsets were measured off the books' own
folios, sampled the length of each book, before being declared.

---

### A grid row is what the SECTION above it says, not what its name looks like (2026-08-26)

**Problem.** A vaultguard's leather belt arrived as ordinary inventory. Core
files a `clothing` item on its own part of the character sheet and leaves it
out of encumbrance, so the belt sat among the rope and the torches and was
weighed with them. The reporter noticed it on two classes and read it as a
class-import bug; it is neither about classes nor about belts.

`importPricedGear` wrote `subtype: "item"` on every row it materialized. A
DESCRIBED entry gets its subtype from the register (`bindEquipment` reads
`meta.subtype`), but a priced row has no entry — it exists precisely because
the shop list itemizes what a description treats as one subject, and three
printed belts is exactly that case. So every clothing row the entries did not
claim imported as plain inventory: 38 of them, and the classes' own starting
templates skin 70-odd pieces of gear off that half of the grid.

**Ruled: the row carries the heading it was printed under.** One recipe reads
a grid that stacks clothing, then livestock, then provisions, so `table` — the
recipe that read the row — cannot answer what the row IS. `extractPrices`
carries the last section heading forward onto every row; a heading is a line
where nothing is priced and only the first column has text, which the
column-heading line under it can never be, because that one repeats across
every column.

**Ruled: which headings MEAN something is the system's question, not ours.**
`subtypeForSection` folds the printed heading against `CONFIG.ACKS.item_subtypes`
— by key and by localized label — so the importer writes down no name off the
page and a heading the system's vocabulary does not know stays plain inventory.
The alternative was declaring the three headings in the recipe beside the
column geometry, which would have put three of the book's words in shipped
source to say something core already says in its own.

**A wrong subtype is corrected in place, not re-created.** Re-import cannot
reach these: the id is already claimed and the loop skips it, so a belt filed
as inventory would stay filed there forever. Only documents carrying our
`generated` flag are touched, and only the one field — this is
`repairAnimalItems`' posture without the delete, which an item's mutable
subtype does not need. Skins already copied onto a character are the template
package's to refresh, not ours.

**Left standing, and why:** the livestock rows on the same grid still import as
ITEMS, though `importEquipment` has ruled since the animals work that a mule is
a creature and a described animal entry becomes an actor. Seventeen class
templates name a riding horse. Making a priced row an actor moves it out of the
collection `resolveBase` searches and wants the `repairAnimalItems` migration
extended to `def.priced.*`; that is a release with a migration in it, not a
patch.

### Reconciling is a claim about one game's library (2026-08-25)

**Ruled: `reconcileByName` skips any candidate on a different LINE.** Neither
branch below it is meaningful across games — merging rewrites the name, system
and identity of the loser, and tagging labels it as an edition of a book it has
nothing to do with.

The whole function is the claim *two BOOKS printed the same thing*: merge the
reprint and record the loser's id, or keep both and tag them so a reader can
tell which book each came from. Two games printing "Rope" is not that claim.

**The loser would always have been the non-ACKS one.** `reconcileByName` is
only reached from `importEquipmentItem`, so the incoming is always ACKS, and
`bookRank` puts every ACKS book ahead — MAX_SAFE_INTEGER for a Judge-registered
`ose.*` source that is in no registry, and a real-but-later index for the
shipped OSE books, which are declared after the ACKS ones. Either way
`incomingWins`, and someone's imported OSE item silently becomes an ACKS entry
with an ACKS id. Not a duplicate to notice — an identity quietly overwritten.

Latent when found, and by a wider margin than it looked: no world Item carries
an OSE id at all, because the OSE paths put converted gear in `items:` embedded
on the actor rather than minting world documents. It is also **not** a
regression from shelving reads across packs — before that there was exactly one
Item pack, so the candidate set is identical. It is a landmine for the first
line-bearing book that mints an item.

### A batched write files by identity, never by position (2026-08-25)

**Ruled: `createDocs` returns one slot per input — `null` where the document
was not created — and pairs results to inputs by COOKBOOK ID.**

Two faults, and the second was introduced while fixing the first.

**The original.** `createDocs` pushed only successes, and the abilities import
paired them back by index: `written.forEach((doc, i) => rememberImported(
batch[i].id, doc))`. One failed create shifted every later slot, so documents
were filed in the dedup index under their neighbours' ids — a lookup that
answers confidently with the wrong document, which is worse than a lost import.
That pairing was also **redundant**: `createDocs` already runs every document
through `remembered`, which reads the id off the document's own flag. Its
comment — "`createDocs` cannot, it is type-generic" — was true when written and
stopped being true when `remembered` moved inside. The lines are deleted.

**The one introduced.** The first fix rebuilt the array positionally with
`made.forEach((doc, k) => out[chunk[k].i] = ...)`, on the assumption that
`createDocuments` answers with one document per input. **It does not throw on a
document that fails validation — it drops it and returns fewer, in order.** So
`made[k]` stops being `chunk[k]` at the first invalid document and everything
after it lands one slot early: the same off-by-one, rebuilt inside its own fix.
A live probe of five documents with a bad one third caught it — slot 3 held
slot 4's document — where every offline gate passed. Pairing is now by the
cookbook id every document this module creates carries; anything unidentifiable
takes the chunk's first free slot so the count stays honest.

**Also ruled: a batched write groups by line.** One resolved pack for a mixed
list writes everything to whichever shelf the first document wanted. Nothing
batched carries a non-ACKS id today, so this groups into one bucket and changes
no behaviour — "not per-line today" is a property of the current book list, not
of the code.

---

### Another game's books get their own shelf (2026-08-25)

**Ruled: imports are shelved by SERIES.** A book declares a `line` in
`books.mjs` and its documents go to that line's own compendia — `ACKS Cookbook
— Dolmenwood — Actor` beside `ACKS Cookbook — Actor`. A book that declares no
line is ACKS and uses the unsuffixed packs, which is every ACKS book: the ACKS
line is the default rather than a name in the source.

**This refines "The pack is the container" (2026-08-24), one day old, and the
new evidence is what shipping the OSE step made visible.** That ruling settled
that a pack is the unit of ownership and that the pack's own name inside it was
redundant; both stand. What it could not have known is what the library would
hold a day later: 4.2.0 wired `importAuthoredOse` into the one import control,
so a single press now fills one Actor pack with the ACKS Monstrous Manual, the
Advanced Fantasy Referee's Tome, the Dolmenwood Monster Book, three Quick
Delves, three Wicked Little Delves and three Planar Compass issues. One pack was
the right answer for one publisher's library and the wrong one for six.

**Three things were unorganized, and only one of them was the pack.**

- The registered-source and by-hand paths called `createDoc(Actor, data)` with
  no folder at all, so every creature a Judge converted themselves was created
  loose at the top of the library among the ACKS monsters.
- `importOseBook` and `importOseAreas` defaulted `folderId` to null and nothing
  passed one, so the authored books did the same thing at scale — 340 Referee's
  Tome creatures in a heap, and the 165 Dolmenwood ones on top of them.
- Everything shared one pack per type, so there was no shelf to file them on
  even once they had folders.

**The shelf is derived from the document's own cookbook flag, not passed in.**
`createDoc` reads `flags["acks-importer"].cookbook` and resolves the line
through `lineOf`; twenty-odd importers create documents and every one of them
already stamps that flag. Threading a `line` argument through all of them
instead would have been twenty chances to add the twenty-first importer and
forget — and, worse, the destination would then be decided by the CALLER while
the presence checks derive it from the id. `importedActor` asking a different
pack than `createDoc` wrote to reports "not imported" and mints a twin, which is
the exact failure the claim rules already exist to prevent. One pure function
over the id answers for both.

**Reads span every pack; only writes pick one.** `importedIdsOfType`,
`importedIndex`, `importedDocs` and `importedActorsOfType` now enumerate every
world pack whose label starts with `ACKS Cookbook — `. A batch mixes lines —
"import everything" walks the ACKS books and the OSE ones in one pass — so a
check that asked one pack would call every Dolmenwood creature new on every run.
`deleteImported` groups by the pack each document is actually on, because a
delete addressed to the wrong pack removes nothing and says nothing.

**The prefix is load-bearing.** Every label keeps `ACKS Cookbook — ` whatever
line it holds: the sidebar sorts packs by label, so the library stays one block
instead of scattering; and `cookbookRemoveImports` finds this module's packs by
that prefix alone, so a line added by a later release is swept up by a Remove
Imports that has never heard of it.

**A registered source is ASKED which line it belongs to**, in the register
dialog, offered as a datalist of what this world already shelves. The module
cannot know who published a file it has never seen — a source's metadata title
is already known to be unreliable evidence (one sample book carries its author's
word-processor filename there), and inferring a publisher from it would put two
adventures on two nearly-identical shelves or one on the wrong one. Suggesting
is what keeps the list short; requiring a choice from it would refuse every book
nobody here has heard of. Blank is allowed and lands on a shared shelf.

**Rejected: naming PUBLISHERS rather than series.** It is the more natural
grouping and it was the first plan. Two things killed it. `ip-scan.mjs`
hard-fails on publisher attribution in `scripts/` — the ACKS line could not be
named in the file that would have to name it — and beyond the two lines whose
publisher is common knowledge, this session could not have named the rest
without guessing, which would have shipped a wrong attribution in a
user-visible pack label. A series name is printed on the book's own cover and
is already in `books.mjs` as part of every one of these titles.

**Rejected: a migration for worlds imported before this.** Consistent with the
2026-08-24 ruling: delete-and-re-import is the upgrade path. Nothing breaks
without it — the reads span every pack, so documents already in `ACKS Cookbook —
Actor` are still found, still counted as imported, and still removed by Remove
Imports. They simply stay where they are until the library is rebuilt.

**Cost:** more packs in a sidebar — up to six Actor compendia where there was
one, for a Judge who owns all these books. That is the point of the change, but
it is a cost for a Judge who owns one OSE adventure and now has a second pack
for it.

---

### Imported text is written into the world, once, by the GM who owns the book (2026-08-24)

**Ruled.** An import materializes the entry's own paragraphs into the document
it creates, with the page reference as the closing line, and the world holds
them from then on. The `@PdfText` enricher, the per-seat reveal and every
"connect your PDF on this seat to read it here" stub are retired with it.

**This supersedes the closing paragraph of "The refresh bridge" (2026-07-29)** —
"nothing enters world data, and prose remains memory-only everywhere". The new
evidence is not about the bridge, which stands unchanged: it is that the
conditional text failed as a reading surface. Resolution ran at render time, so
a description was only as readable as the seat looking at it, and the reveal
path had already broken silently — the import path caches paragraph OBJECTS
where the reveal expected a string, so a revealed cookbook entry rendered
`[object Object]`. A surface whose failure mode is invisible to the seat that
imported it is not a surface anyone can rely on.

**What the shape has to carry, and why each part is load-bearing:**

- **Escaped, never parsed.** Extracted text is plain text that happens to be
  about to live in an HTML field; an angle bracket in a printed formula is a
  character. The reveal path got this for free through `textContent`; a stored
  description does not.
- **Stamped** (`data-acks-entry` on the wrapper). `handWrittenProse` used to ask
  "is this description exactly one `@PdfText` tag?" to decide whether a re-import
  may overwrite it. With text in the field that test is impossible without a
  mark, and losing it would mean either clobbering a Judge's own writing or
  never updating anything.
- **The citation is part of the block, not a separate field.** Attribution
  travels with the reproduction or it is lost the first time someone copies the
  text out of one field.

**The Full Monster Sheet routes sections to six separate fields**, so the page
reference closes the last one that received text — the creature carries it once,
at the bottom of the Description tab, rather than six times.

**Accepted cost: worlds imported before this hold `@PdfText` tags, and there is
no repair pass.** — SUPERSEDED 2026-09-02 by "Importing again refreshes what it
did not create": the repair named here reaches no ability owned by an actor, and
the pass this paragraph declined to build already existed and is now routed into
*Import Everything*. The rest of the entry stands. The enricher that used to
render them is gone, so an
unrepaired document shows the literal `@PdfText[mm.ghoul]{MM p.112}` until it is
re-imported (*Remove ALL Imports*, then import again). A citation-only shim was
rejected: it would keep the whole per-seat resolution path alive to pretty-print
documents that a single re-import fixes properly.

**Also retired, because it lost its only consumer:** the eager per-recipe
extraction inside `ingestBook`. Connecting a book is now an open and a
fingerprint; text is read from the page an import names, at the moment it is
imported.

**IP posture, stated out loud.** This is app-licensed in-app content the GM
materialized from their own copy, which `.claude/rules/ip-doctrine.md` allows —
the same hand-typed equivalence that already governs imported stat blocks and
roll-table rows. What changes is that a world backup now carries the book's
sentences where it used to carry citations. Nothing about the SHIPPED artifact
changes: no rules words, no page values, no `ruledata/`.

---

### Same name, two books: merge unless they differ beyond their source (2026-08-24)

**Ruled.** Two imports that share a printed name are ONE document unless they
differ in more than where they came from. Identical-but-for-provenance merges,
and the higher-precedence book's copy is what the library keeps. Genuinely
different keeps both, TAGGED with each book's short name, so a reader can tell
`Boots (RR)` from `Boots (BTA)` instead of finding two rows called "Boots".

**Precedence is the order `BOOKS` declares** — Revised Rulebook, Judges Journal,
By This Axe, Monstrous Manual — read at run time rather than restated, so a new
book takes its rank from where it is added.

**The comparison is DIRECTIONAL, and getting that wrong is why this took two
attempts.** A live document's `system` is a data model carrying every field the
schema declares, defaults included; creation data carries only what the binding
set. Comparing them whole never matches, so the first build declared two
identical printings of Laborer's Tools different and tagged them. `sameMaterial`
asks only whether the existing document already says everything the incoming
would.

**A merged id is recorded, not discarded.** The absorbed entry's id goes into
`cookbook.merged` and `importedIndex` answers for it, or the loser's id resolves
to nothing and the next run imports the twin again. **A tagged document keeps
its printed name** in `cookbook.printed`, and collisions are judged on that —
tagging rewrites the name, and a rewritten name would never collide again, so a
pair tagged by an older build could never later be reconsidered.

**A regional or racial version with the same stats is a VARIANT, not another
base item** — so it merges. All five Rulebook/By This Axe pairs do: Boots,
Cloak, Journal, Manacles, Whistle, plus Laborer's Tools and Special Components.
Running the imports twice more in reverse order changed nothing — 1,006
documents before and after.

Getting there needed a register fix, and the failure to merge is what found it:
Boots and Cloak differed only in `subtype`, because EVERY By This Axe equipment
entry was authored `group: "gear"` with no `subtype` at all. Dwarven belts,
boots, caps, cloaks, coats, turbans and tunics were therefore shelved with the
rope and carried the wrong item subtype, and the war and guard bears imported as
inventory rather than as animals. The comparison was doing its job; the data was
wrong. (What this does NOT do is build a variant DOCUMENT linking to the base —
the merge only guarantees one base item, which is what the rule asks for.)

**Cost:** the check runs per document, so it reads a name index built once
(`libraryNameIndex`) rather than the library. Loading every pack document per
item made the equipment import quadratic again inside the check meant to keep it
clean — measured at seven minutes before the index, and the index is dropped by
the same `forgetImportedIndex` that drops the id index.

### Three controls, not twenty-one (2026-08-24)

**Ruled: the macro pack ships four entries** — connect your books, import
everything, reimport one shelf, delete everything imported.

It shipped twenty-one. Nearly all were one step of a larger job, on the shelf
because it happened to be a function: import traps, import variations, import
vehicles, import rules tables, build template packages, fill companion slots. A
Judge does not choose those individually — they are what "import everything" is
made of, they have a dependency order, and offering them as a list invites
running them in the wrong one.

`cookbookReimportShelf(shelf)` is the one genuinely new control: empty one
top-level shelf and import it again, for a book reconnected at a different
printing or a shelf edited past recognition. Deleting first is the point —
import is idempotent and passes over what it already has, so importing "again"
over a populated shelf changes nothing.

**Which shelves exist is NOT restated.** `ITEM_SHELF` already says which id
namespaces land where; `SHELF_REFILL` names only what `ITEM_SHELF` cannot, which
run rebuilds a shelf. A shelf with no refill cannot be rebuilt alone and says so.

**Nothing is lost.** Every dropped macro's function is still on the api, and a
world that imported the old pack keeps its copies working. Their ids are not
reused: an id is identity, and re-issuing one would hand such a world a
duplicate.

### Writes are batched, because a write costs what the shelf already holds (2026-08-24)

**Ruled: every bulk importer BUILDS all its documents, then writes them in
chunks** (`createDocs`, `WRITE_CHUNK` 50).

**The measurement that settled it.** A write costs one round trip whose price is
set by how many documents the target already holds — each call re-indexes the
collection — not by the payload. Against a live world: a create into a
19-document pack, ~35ms; the same create into a 1,039-document pack, ~950ms.
Twenty-five individual creates at that size, 23,866ms; the same twenty-five in
one call, 1,107ms. So a one-at-a-time loop is quadratic in the library it is
building and visibly slows as it goes — which is exactly what a whole-corpus
import did.

The ability import went from **not finishing in forty minutes** to **9.1
seconds**.

**Rejected: a time-window write queue** that coalesces concurrent creates
transparently. Sequential `await`s never overlap, so such a queue accumulates
one document and batches nothing; the callers have to stop awaiting each write,
which is a structural change, not a wrapper.

**Rejected first, and wrong: blaming page extraction.** `executeEntry` built a
fresh page cache per call and 82% of the ability corpus's page reads were
redundant, which looked like the answer. Threading a shared cache through
changed nothing measurable — a definition parses in about 7ms. The cache is
still right and is kept; it was never the cost. Measure before believing.

**Cost:** `importAbility` is split into `abilityData` (build) and the write, and
the bulk path no longer goes through `claimImport` — so `createDoc` and
`createDocs` now teach the dedup index themselves (see below).

### Every create teaches the dedup index (2026-08-24)

**Ruled: `createDoc`/`createDocs` remember any Item carrying a cookbook id.**

Only `claimImport` updated the index, so a document created through `createDoc`
alone was invisible to the next presence check IN THE SAME SESSION. Running the
class-builder table import twice produced two `def.race.dwarf` and two
`def.race.elf`, every time. Keyed off the document's own flag rather than a
caller-supplied id, so no creator can forget.

**Found by asserting idempotency, not by reading code:** a full import was run,
then every step re-run out of order and repeated, and the two end states
compared by fingerprint. They differed by exactly two documents.

### One name has many printed forms, and the rule lives in lib (2026-08-24)

**Ruled: the price-list claim asks `acksExtras.lib.vocab.nameKeys`.**

The catalogue writes a thing head-first with its qualifier after a comma — "Oil,
Military (1 pint)" — while the weapon table writes "Military Oil". Two ids, two
shelves, one flask, two documents. The claim also only consulted the equipment
chapter's *declared* entries, so it could never see a weapon minted at run time
from a grid.

The claim now folds every printed form (comma-flip, parenthetical, slash
alternatives) and matches against the whole LIBRARY, which is why the price list
runs last. `Oil, Military` and `Oil, Common` are claimed; **`Oil, Olive` is
kept**, because nothing else in the library is olive oil — the check dedups what
is duplicated and preserves what is not.

**Rejected: a comma-flip helper here.** It fixes the reported case and leaves
the slash and parenthetical forms to be rediscovered one at a time. The pattern
is "the same thing printed differently", and acks-extras already had those rules
— in a second copy, with a docstring asserting the two must agree. They now live
once, in `lib/vocab.mjs`.

**Known, not fixed — and not what it first looked like.** Two pairs of equipment
entries share a printed name across books: `def.equip.laborersTools` (By This
Axe) / `def.equip.laborerSTools` (Revised Rulebook), and
`def.equip.specialComponents` / `def.equip.specialComponentsMiscellaneous`.
These are NOT duplicate rows in one corpus — each book needs its own entry
because a recipe is page coordinates. Whether each pair is one item printed
twice or two things sharing a name is a question about what those pages say,
and it decides the fix; ROADMAP carries it.

### The audit: a recipe answers for itself, without importing (2026-08-24)

**Ruled: `cookbookAudit()` parses every recipe and reports per-recipe, writing
nothing.** A recipe is page coordinates and probes, and only the printing in
front of it decides whether it still matches — so "does this recipe work?" must
be answerable without the import that would act on the answer.

**What it found:** nothing. 720 recipes across the Revised Rulebook and Judges
Journal, and 291 in the Monstrous Manual — **1,011 parsed, zero failures**, in
about fourteen seconds. The suspicion that failing recipes were behind the slow
import was wrong. It did surface 36 register-token misses across 29 monsters
(mostly `magicProperty` names the register has no row for), which is register
data to add, not geometry to re-measure.

**Art is skipped by default**, because an audit asks a text question: the `art`
op walks a page's operator list to choose an image and costs 1.8s for one
Monstrous Manual creature and 15s for another, against 7ms for a proficiency.

### The art op is skipped when the picture is already on disk (2026-08-24)

**Ruled: `importOne` skips the `art` op when `cachedArt(id)` answers.**

The upload cache has always short-circuited the decode-and-upload half. It never
saved the WALK — and the walk is what costs the seconds. So a world whose art
was entirely cached still paid 1.8–15s per creature to choose an image it was
never going to extract. Measured after: three monsters with cached art imported
in 321ms, 101ms and 121ms, each with its illustration correctly applied.

The art gate moved from `node.fields.art` (the op's result) to the RECIPE's own
art field, or a cached illustration would never reach the actor once the op was
skipped.

### The pack is the container: compendium-only, two levels deep (2026-08-24)

**Ruled: every import is written to a world compendium, and no folder tree
inside one is more than two levels deep.** `importToCompendium` is removed —
where imports land stops being a setting.

**The problem was ownership, and it was structural.** Foundry's folder
ownership dialog writes `folder.contents`, which is a folder's DIRECT children
(`client/applications/apps/document-ownership.mjs`); it does not recurse. The
tree was `ACKS Cookbook / <book> / <group>`, so configuring ownership at the
root reached nothing — a live world measured 229 flagged actors and 2,317
items of which 38 and 178 were reachable, both only because they were
misfiled. Covering the library properly meant opening the dialog on 99 leaf
folders. A compendium answers the same question with one role-keyed setting on
the pack, and world packs are unlocked by default, so the documents stay
editable and draggable exactly as sidebar ones were.

**With the pack as the container, its own name inside it was redundant**, and
the level it cost mattered: a pack caps folders one shallower than the world
(`CONST.FOLDER_MAX_DEPTH - 1`), and `ACKS Cookbook / Classes / Templates /
<Class>` was already four. Dropping the root put every tree at two with a level
to spare. `ensureFolderPath` now truncates a deeper path rather than creating
it — a gate, because this grew back one level at a time.

**Rejected: a module-side recursive ownership button.** It would have worked
and would have rescued existing worlds without a re-import. It leaves the
underlying shape — a library the sidebar has to hold and a hundred dialogs to
share — exactly as it was, and adds a second gesture a Judge has to know about.

**Rejected: migrating existing worlds into the packs.** Delete-and-re-import is
the upgrade path, stated in the changelog. A migration would have to move
~3,200 documents, re-point every uuid on every character that referenced one,
and be right about which of two same-id documents was the real definition —
for a world the re-import rebuilds correctly in minutes.

**Cost:** a breaking change, and the reason this is 3.0.0. A world upgraded
without re-importing keeps its sidebar documents, which the module no longer
reads; Remove Imports still finds them by flag, so nothing is stranded.

**Superseding note:** class-template packages stay WORLD documents. That is not
an exception grudgingly kept — acks-extras copies pack documents into the world
precisely so a Judge can repair one (its `template-packages.mjs` header), and a
package exists to be repaired. Their folder is `Class Templates / <Class>` in
the sidebar, which is what acks-extras' own `defaultFolder` already built; the
two paths now agree, where before this file's ruling of 2026-08-19 gave the
importer a different four-level one.

### A namespace with no shelf is a failing test, not a folder nobody notices (2026-08-24)

**Ruled: `tools/test-item-shelves.mjs` asserts the shelf table against the
DATA.** Every `def.*` namespace the cookbooks carry must have an `ITEM_SHELF`
row or be named as something that is deliberately not an item, with the reason;
every row must name a namespace something actually mints.

`itemShelfFor` answered null for an unknown namespace and the document was
filed at the top of the library with nothing said. Three namespaces drifted in
that way — `def.priced`, `def.race`, `def.constant` — and one live world held
178 items loose above the shelves. Nothing could have caught it: validate does
not know what a shelf is, and a test written against the table alone agrees
with itself.

The shelf table is deliberately DUPLICATED into the test (parsed out of the
source), because importing `cookbook.mjs` offline would drag in the Foundry
globals — and the duplication is what gives the check teeth: it fails when the
two disagree. The first run found a fourth namespace, `def.classmeta`, which
had no shelf either; it is a passage read for one name at import time and never
a document, so it is now stated as such.

**Also ruled:** a namespace declared not-an-item must be excluded from
`NON_ABILITY_KINDS` too, and the test asserts both together. `kind.constant`
was missing from that set, so the generic ability walk minted four `ability`
items for the SCG's conversion constants — numbers the converter is handed, not
documents. The comment above that set already warned this would happen; the
warning is now a gate.

### Organize is deleted, because destination has one author (2026-08-24)

**Ruled: `cookbookOrganize` and its macro are removed.**

It existed to re-file documents made by older releases into the current tree.
Delete-and-re-import now does that, and Organize was itself the worst filing
bug in the module: a class template's skinned gear carries the cookbook id of
the definition it was copied from, so Organize read a Barbarian's engraved
silver waterskin as the shared Waterskin and moved it to the Equipment shelf.
The correlation in the world that found it was exact — all 1,191 skinned parts
carrying an importer id had been moved out of their class folder, and all 436
without one were still in it.

**The general rule it violated:** a document's destination has ONE author, the
importer that creates it, and it is decided at creation time (see the "FILE IT
NOW" note in `importOne`). Organize was a second author with a different
opinion, and the price list proved the two disagreed even for the importer's
own documents — its importer filed 172 rows under `Equipment / Price List`
while `ensureItemFolder` said the top level, so whichever ran last won.
`itemShelfPath` is now the only path-builder for items, and every item importer
calls `ensureItemFolder`.

**Rejected: keeping Organize with a `templatePart` exclusion.** It fixes the
symptom and leaves the second author in place. A GM who hand-moves an imported
document can move it back; nothing else needed it.

**Cost:** no recovery gesture for a hand-moved document, and no repair for
worlds that already ran the broken Organize. Both are answered by
delete-and-re-import.

---

### Four macros, three dialogs, one question (2026-08-21)

**Ruled: the book surfaces collapse into ONE window, and a book's own ROW is
how a book gets named.**

"1 · Your Book" shipped four macros onto three dialogs. Getting Started carried
a *Connect a book…* button; the Connect dialog carried a `<select multiple
size=6>` over twenty books, a file picker and a folder picker; the Books dialog
carried a SECOND folder picker, a bulk picker and the per-book rows. Two of the
three asked "which book do you mean?" in different words, and the answer the
reader liked — a row with a button on it — was the one buried behind the other
two. The reported symptom was the list: twenty books, six visible rows.

The window is four bands: the walkthrough (open on a seat with nothing, folded
once there is something), the server shelf, the controls that answer for
several books at once, and the books themselves grouped Waiting / Open / Not
connected, the last two collapsed behind their counts. `connectBook`,
`bookStatus`, `reconnectBooks` and `gettingStarted` all resolve to it, because
a compendium macro outlives the build that shipped it and three of the four
macros are dropped from the pack rather than renamed. Their ids are not reused.

**What the select was hiding.** `pairPicks` existed only because a
`<select multiple>` cannot say which file is which: it paired by evidence and
then fell back to POSITION for whatever was left. With the naming on the row
there is nothing left to guess, so the fallback and its function are deleted
and `matchFilesToBooks` — evidence, or a named refusal — is the whole matcher.
This makes the 2026-08-11 "position is not evidence" ruling total rather than
last-resort, and the offline test now asserts the refusal where it used to
assert the guess.

**Reconnect all**, asked for and missing, is shaped by the gesture rule rather
than pretending it away: it does everything needing no permission first (the
shelf, served paths, bridged bytes, handles still granted), then spends its one
transient activation on the remembered FOLDER, which re-grants a whole shelf at
once. Whatever a folder cannot answer for is NAMED as still needing its own
click. The permission request goes first in the handler, before any await that
could outlive the activation window — a permission asked for after a 100 MB
read is a permission asked for too late.

**Cost.** `booksDialog` is meaningfully bigger and now renders conditional
bands. The join-time auto-close is kept but narrowed to the join-time offer:
opened by hand the window is also the shelf and the import chain, and closing
it under the reader mid-task is not tidiness.

---

### A book the server holds asks nobody for anything (2026-08-21)

**Ruled: a PDF staged under the Foundry data directory is recorded in WORLD
settings, and every GM seat reads it on join with no gesture.** — The record
clause is SUPERSEDED 2026-09-03 by "A book the server holds is a journal": the
shelf is a journal per book now, not a setting. The rest stands.

Every location kind before this was a property of one browser: a handle needing
a permission click, or a filename needing the picker again. That is a fair
price for a book only that browser can reach, and no price at all for a book
the server can reach. The `url` kind and `connectBookUrl` already existed and
were reachable only from the api — this makes them a surface, and moves the
memory from the seat to the world so it holds for every GM seat on any machine.

Two routes in, because GMs keep their books differently: **Add to server** on
an open book's row uploads it through the same `FilePicker.upload` the art
importer uses, and **Scan the folder** reads `acks-importer-books/` for a GM
who copied files there by hand. `FilePicker.browse` answers with paths and no
sizes, so a scan matches on remembered name and title-in-filename and the size
pass never fires — the right strength for a directory the GM curated.

**A shelf entry is never written on a filename.** Both routes connect and
fingerprint the file first, and `ingestBook`'s wrong-book refusal is what
decides; a refusal must not leave an entry behind promising a book is
available. `connectBookUrl` therefore THROWS where it used to warn and return,
because a soft return told the shelf that a failed read had succeeded.

**Stated rather than discovered:** a file under the data directory is fetchable
by any signed-in user who learns its path. Staging makes a book undiscoverable,
not inaccessible, and the guide says so in those words. A table that needs more
than that keeps its books on its own disks.

**Rejected — clearing the shelf from "Forget books".** Forgetting is a
statement about this browser. A GM tidying their own seat must not silently
unstage the books every other seat reads, so `forgetBooks` leaves world data
alone and says which it touched.

**Found by the live gate: the scan could not read the module's own handwriting.**
`shelveUpload` writes `<bookId>.pdf`, and the evidence rules — remembered name,
size, the book's title in the filename — match none of that: "jj.pdf" contains
neither a name this seat remembers nor the words "Judges Journal". A shelf
staged from the rows therefore read as EMPTY the moment it was scanned. The
scan gains one pass of its own, ahead of the others, matching a filename stem
that is exactly a book id. It is confined to the shelf directory, where the
module controls the naming; a folder of the reader's own files is still matched
on its own merits only. The pass still only PROPOSES a book — the same live run
staged a Monstrous Manual named `rr.pdf` and watched the fingerprint refuse it.

**Also found live: `singleton` had two states where it needed three.** The
entry is dropped when its promise settles, which is a microtask, so anything
that closed the window and reopened it in the same turn met an entry whose app
was already closed — and `bringToFront` on a closed application reads the style
of an element that is gone. "Still building" (no app captured yet) and "closed
under us" are now distinguished: the first is waited on, the second is dropped
and reopened. Its `finally` also checks the slot is still its own before
clearing it, so a replacement is not deleted by the dialog it replaced.

---

### A class's variants are PATHS, and the grid that prints them is read by geometry (2026-08-23)

**Problem.** The Barbarian's combat training does not exist as a sentence. Its
spread prints a table — Region | Armor | Weapon Proficiencies | Fighting Style
Proficiencies, a row per region — so the prose reader could never find it, and
the class imported with no training of any kind. The Zaharan's dark paths and
the dwarven castes have the same shape.

**Ruled.** ACKS Extras owns the shape (`system.paths`, its DECISIONS
2026-08-22); this side fills it from the reader's page. `buildPaths` emits the
printed variant table as a group of options, each carrying its own training, and
adds a `templates` group for any class that has starting templates — so EVERY
imported class gets at least one path group and the feature is not reserved for
the one class that motivated it.

**Ruled: per-option data stays on the option** (user), even where every row
agrees. All three Barbarian regions permit armour up to medium; hoisting that to
the class would bake in a coincidence of this printing and leave nowhere for a
custom path, or a later one that differs, to say otherwise.

**Three things the page defeated, and what was authored instead of guessed:**

- **The table is mentioned before it is printed** ("as shown on the Barbarian
  Combat Proficiencies table below"), and the title search found the prose
  first, anchoring the whole table's geometry on the wrong column. `titleLast`
  says the heading is the later occurrence.
- **Rows are anchored on the label column, read off the page.** The print lines
  stand four to nine points apart, so the line assembler folds a region's name
  in with the armour rung above it; the first cell of that merged row is
  whatever sorts leftmost, and the whole table read as one band. The label
  column is a geometric fact and is taken as one. A label that WRAPS — "Ivory"
  over "Kingdoms" — is one label, recognised as a gap much smaller than the gap
  between real rows.
- **The column x's are authored.** The heading lines fold into the first data
  row too, so the header search cannot find "Weapon Proficiencies" as a cell of
  its own. Where the page defeats the search the recipe gives the geometry
  rather than a better guess.

### A totem animal is a creature, and the template is which one (2026-08-21)

**Problem.** "Rat totem animal", "Black cat familiar" — printed in a Starting
Equipment cell, and read as gear because that is the cell they are in. Eleven of
them became items with no base, no mechanics and no creature behind them: a rat
on the character's equipment list. One was worse than mistyped. The witch's band
carried BOTH the `Familiar` ability (from her proficiency column) and an item
named for her cat, which is the same fact imported twice.

The model for this already existed and was pointing the other way.
`resolveCompanion` leaves an ability's companion slot EMPTY when the creature is
built or chosen rather than named — "there is no single entry to point at" —
because which creature it is was never a property of the ability. It is a
property of the TEMPLATE, and the template was the one place saying it.

**Ruled.** A phrase in `register/_refs/companionPhrase.json` names the ability
whose slot it fills; the descriptor is lifted off the item list and becomes that
ability's SELECTION. It fills the row's existing entry where the proficiency
column already granted the ability — the witch gets `Familiar (black cat)`, one
document, not two — and never overwrites a selection the column already made
(`Familiar (eagle)` stands). Where the row has no entry, one is added carrying
the ref, and the specialized copy's `grantedFrom` stamp is what stops the
class's own award of the same ability from granting it a second time; verified
live, `ownsRef` answers true and re-applying the class adds nothing.

**Not done, and named:** the creature is a NAME, not a ref, so the ability's
`actorUuid` is still empty — the Judge drops the actor in, exactly as before.
Matching a selection against the imported monsters would fill it, and that is
worth doing; it is a different subsystem (effects) and did not belong in a
hotfix.

### A head dress is a hat (2026-08-21)

Ruled: a bladedancer's, a priestess's and a gossamer head dress resolve to the
shop list's **Hat**, not to Helmet (Light). They are worn, not armour — nothing
about them protects — and what makes one cost 20gp is the ornament, which the
cell prices in place and the skin now carries. One register row either way if
this is ever ruled the other.

### What the page says a thing is worth is imported with it (2026-08-21)

**Problem.** 50 printed descriptors reach the end of the ladder with no
catalogue row behind them, and that is correct: the shop list has no entry for a
bladedancer's head dress or a gaudy silver ring. But 18 of them are PRICED where
they stand — "(20gp value)", "(45gp value)", the same amount written bare — and
that bracketed number was read only to be skipped, so the item arrived with the
one value its page ever gave it thrown away, and the Judge was handed something
to repair with nothing to repair it from.

**Ruled.** A bracketed amount is read onto the item as its cost, and it
OVERRIDES a base's price where there is a base: a cell that says a staff is
worth 45gp is describing the gemstone on that one, not the shop list's plain
staff. It reaches the character through the template item's own `cost` field
(acks-extras `class-data.mjs`), and a repair pass carries it across rather than
letting a replacement built from a base arrive priced as the plain version.

This is the same rule every other imported number follows — it comes off the
reader's own page at import time and nothing is shipped.

**Left as it is, and named:** the 11 totem animals and familiars printed in
equipment cells are class features, not gear, and carry no value to read. They
import as named items with no base, which is visible and deletable; the bundle
holds items, and minting an actor from an equipment cell would be a second
pipeline for one line of flavour.

### The catalogue's conventions are rules; what is left is authored (2026-08-21)

**Problem.** With the menu and the containment floor fixed (below), 545 of a
printed 168 cells' descriptors still pointed at nothing. Reading them showed the
misses were not random: the price list writes a name HEAD FIRST with its
qualifier after a comma — "Rations, Iron", "Rope, 50’", "Sack, Small", "Horse,
Medium riding" — and a template's cell writes the same thing as English. A slash
names one row by either word ("Waterskin/Wineskin", "Sandals/Shoes"). The two
halves of one book could never meet: "1 week's iron rations" alone accounted for
142 of the misses.

**Ruled.** A convention the catalogue uses throughout is a RULE, not an
exception. `nameForms` gives every menu row the forms its own list prints it in
— comma rotated back, slash alternatives expanded — and the HEAD alone is
deliberately not among them, or "Sandals/Shoes, Leather, High" would answer for
a bare "sandals" that is another row's own name. 545 misses fell to 265.

**Ruled.** Three more printed constructions are read across the separators,
because the cell writes them across the separators:

- **A catalogue SET.** "Quiver, 20 Arrows" and "Case, 20 Bolts" are single
  priced rows; the cell writes them "quiver with 20 arrows". The container split
  tore them into two things the price list has never heard of and counted the
  encumbrance twice, so it now stands down when the set resolves whole.
- **A book's CONTENTS.** "Bark-bound prayer book with remove fear, angelic
  choir, and counterspell" is one book, and an English list is commas until the
  "and". Split, its spells went on the character as inventory. The clause is
  rejoined up to the chunk that opens with "and" — and only if the list actually
  closes that way within a few chunks.
- **"UNDER" IS A PAIR.** "leather armor under blue mage's cassock" dresses a
  character in both; read whole, nine characters lost a garment they are printed
  as wearing.

**Ruled.** What survives all of that is authored, once, in
`register/_refs/equipmentPhrase.json` — 37 rows across three kinds: the same
object under other words ("hide armor" for Hide and Fur Armor), a row the list
files under a category prefix ("1 lb garlic" for "Herb, Garlic"), and a
real-world weapon name used as flavour ("scimitar", "francisca", "glaive"). It
is BOOK-level because the evidence is: "scimitar" appears in eight classes, and
the three aliases that already existed were authored on the Fighter's entry
alone and so answered for the Fighter alone. Per-class `equipAliases` remain and
win over it. An authored key matches on exactly the terms a menu name does, so a
four-letter key like "pole" can no more fire from inside "polearm" than a
catalogue name can.

**Rejected: authoring the whole list.** Every one of these would have worked as
a phrase row, and 280 of them would have been wrong to write down — a convention
recorded as three hundred exceptions is a convention nobody can see, and the next
book's list would need all three hundred again.

**Cost.** 719 unresolved descriptors became 57, and the 57 that remain are
honest: goods the book prices in place because the catalogue has no row for them
("bladedancer's head dress (20gp value)"), and totem animals and familiars,
which are class features printed in the equipment cell and are not gear at all.
They import as named items with no base — visible and repairable, which is what
the package shape is for.

### Two things read off a cell that were never in it (2026-08-21)

Found by auditing all 623 distinct descriptors against the row each was matched
to, rather than only the ones that matched nothing.

**A bracketed amount prices the item, whatever follows it.** The coin lift
skipped an amount only when the word "value" came after it, and the same tables
also print "(20gp)" bare. The lift eats to the next comma, so a witch's
"silver earrings (20gp)" arrived named `silver earrings (` with 20gp added to
her purse. The BRACKET is the test now, not the word after the amount.

**A closing bracket can end a descriptor.** One cell prints its holy book and
the quill after it with no comma between them, and the quill was swallowed by
the book's name. It splits under the pair rule's own guard — only when what
follows the bracket is itself a known item — so every "(20gp value)" and
"(white bird)" that ENDS a descriptor is left exactly as printed.

**A full stop can be a separator.** One template's list runs "…waterskin. 1
week's iron rations…" where every other one has a comma; read as one descriptor
the rations vanished into the waterskin's name. A stop followed by the start of
another descriptor separates — never one inside brackets, which is where the
abbreviations live.

**A hyphen at the end of a line is inside a word.** These cells wrap where a
compound breaks, and the grid joined the lines with a space: "Well- made wool
dress", "Blood- stained club" — fifteen of them. The hyphen is KEPT rather than
swallowed: it is a real one in every compound these tables print, so keeping it
can only ever misspell visibly, where dropping it would silently invent a word.

### A template's equipment menu is BOTH pipelines, and a short name is a whole word (2026-08-21)

**Problem.** A class's starting gear resolved against `equipmentMenu()`, built
from the cookbook's `kind.equipment` entries alone. But weapons, armour and
priced rows do not come from the cookbook — they are materialized from the
reader's own GRIDS and mint their own ids (`def.weapon.sword`,
`def.armor.plate`, `def.priced.silk-1-lb`). The menu therefore contained no
weapon and no armour at all, and three separate symptoms followed from that one
fact. A sword pointed at nothing and imported as a nameless trinket. "War
hammer" bound to the carpentry **Hammer (small)** the shop list *does* carry, so
every dwarven template handed over a tool where its weapon should be. And a
printed pair — "polished sword and dagger" — never split, because the pair rule
only fires when BOTH halves are known items: the character got one weapon
carrying the dagger's damage and the sword silently gone.

A second, independent floor hid the short names even once the menu held them.
Containment required a folded length of six, and most printed weapons are
shorter: sword, staff, spear, club, mace, torch, dart.

**Ruled.** The menu is built from both pipelines: the cookbook first, then the
gear this world has already materialized, read from the imported index (so a
compendium-mode world resolves too). Equipment lands before classes in the
Getting Started order, so a class binds after its weapons exist. A cookbook
entry wins on a shared id.

**Ruled.** Containment keeps its floor of six for a BARE substring, and a name
of four or five characters matches only as a whole WORD of the descriptor —
"sword" in "polished sword", never "mace" in "grimace" — with a trailing plural
counted part of the word, because a cell printing "torches" names the Torch.
Below four characters nothing matches this way at all: "oil", "net", "sap".
ACKS Extras applies the same rule to world documents (`bestBaseMatch`), and the
two are pinned to each other by comment in both files — a descriptor that
resolved to one base here and skinned itself over another one there is the
failure this shape prevents.

**Rejected: reading the rule out of ACKS Extras at runtime.** It is on its
public API and the dependency runs the right way, but `parseEquipment` is a pure
parser with an offline test suite, and coupling it to a live global would make
what a cell splits into depend on module load order.

**Cost.** The menu now carries a few hundred more rows, and a descriptor
mentioning an incidental short noun can bind to it ("wineskins with honey-mead"
finds Honey). That was already true of the extras side, so the two now agree
about it; the wrong base is a document the Judge can retype, which is what
packages are for.

### A template part is not an import (2026-08-21)

**Problem.** Extras skins a template's gear by COPYING the base document, and a
copy carries the original's flags — the importer's `cookbook.id` included. A
world therefore held a dozen documents stamped `def.weapon.staff`, only one of
which was the Staff. The gear menu above would have taken whichever came first
and made one template's "aged and dusty staff" the catalogue name every other
template matched against.

**Ruled.** Extras strips the importer's claim from a skin (its own `skin` flag
records what the copy is), and the menu skips any document carrying the
`templatePart` flag extras publishes — belt and braces, because a world imported
before the fix still holds the mis-stamped copies.

### Template packages: extras owns the shape, this side owns the folders (2026-08-19)

> **Folders superseded 2026-08-24** — the path below (`ACKS Cookbook / Classes
> / Templates / <Class>`) is now `Class Templates / <Class>`, the same path
> acks-extras' own `defaultFolder` builds. Everything else in this entry stands.

**Problem.** A class's starting templates imported as data rows on the class
document, so a mis-classified piece of starting gear (the Wonderworker's staff
as an unwieldable `item`) had no single document a Judge could repair — the
fix was re-import or per-character surgery.

**Ruled (user):** templates materialize as core `bundle` Items of linked,
repairable world documents, with a generated 3d6 RollTable per class. The
materializer lives in **acks-extras** (`acksExtras.classes.templates
.materializeTemplates`) because it is document-driven — it works off the
class document's own rows, needs no book, and owns the class model, the base
resolver and the skin layer. This side calls it after `importClasses` and
`cookbookUpdateClasses` (whose whole-`system` rewrite wipes the rows' cached
bundle uuids; the call re-derives them from the bundles' own flags) and ships
`importTemplatePackages()` — macro, api, Getting Started step after classes —
as the no-book upgrade path for worlds imported before packages existed.
Folders are this side's only contribution: bundles and their gear under
`ACKS Cookbook / Classes / Templates / <Class>`, tables under `ACKS Cookbook /
Class Templates`. Created documents carry an `asImported` snapshot; an edited
one is skipped and counted, never clobbered — the ruling's whole point is
that a Judge's repair survives every re-run. Shape, ownership and the apply
path: acks-extras `docs/classes/MODEL.md` § Template packages; the ruling
record is its `DECISIONS.md` 2026-08-19.

**Rejected:** minting `def.class.*.tpl.*` cookbook ids for generated
documents (they are derivations of a class document, not book entries; the
extras `templatePart` flag is their identity, and a cookbook id would drag
them into importedItem claims they must not answer).

**Cost:** `cookbookUpdateClasses`' confirm says hand edits on the CLASS are
replaced, and that stays true — but bundles and gear are separate documents
the update never touches, which the confirm text does not say. Accepted; the
skip report names what was preserved.

### A block that reaches the foot of the last column turns the page (2026-08-16)

**Problem.** `subheading` entries followed a column turn but not a page turn,
which the `display` branch has always done. Scything Blade is the last trap on
its spread: its fifth level was cut mid-sentence at the foot of the page and its
sixth was lost entirely. Twelve traps of thirteen were whole, so the defect was
invisible in aggregate and only showed against the wiki's own outline.

**Ruled:** the branch follows the turn, and what stops it there is tested by
SHAPE, in three parts — because each of the first two, alone, is wrong:

- **Not by font alias.** pdf.js names fonts per PAGE, so the alias that
  identifies an anchor's siblings means nothing on the page after it.
- **Not by "alone on its line" either.** A wrapped sentence at the top of a page
  is frequently a single run, and it stopped the flow before it carried
  anything — indistinguishable from the turn never happening.
- **So: alone on its line, in a face the page's body is not, AND body-sized.**
  The third clause is owed to the ordinals: the `th` of the very tier being
  carried over is alone, in its own face, and stopped the flow at the page's
  first line.

`assists.flowColumns` states the continuation page's columns, reusing the AX
path's own vocabulary — a page that defeated column detection for the entry
defeats it for the turn as well, and Scything Blade's continuation page is one.

**Cost, and the second thing this taught.** The first version carried the
next page's "column zero" wholesale, and on RR p18 that is the MARGIN TAB: the
`nonProficientUse` entry gained three paragraphs that dropped to empty strings.
Furniture is now excluded before paragraphs are built rather than left to the
drop fixes, so an entry with no real continuation gains no paragraph at all.
With that, the whole-corpus diff is `powers.json` only — `proficiencies.json` is
byte-identical, which is the check that the turn fires where it should and
nowhere else.

### A margin tab is known by where it sits, not by how tall it stands (2026-08-16)

**Problem.** Authoring the trap entries surfaced `marginTabs` failing in both
directions on one page. The rule separated a vertical chapter tab from a
superscript ordinal by the height of the stack: three or more small runs sharing
an x, spanning at least twenty points, is a tab. Neither half holds. The Judge's
Journal sets its "Dungeons" tab as four glyphs over sixteen points — under the
threshold, so it was kept, and materialized as a word of gibberish at the end of
every entry that reached the foot of the last column. Meanwhile a trap's six
tier ordinals share one indent and span two hundred points — over the threshold,
so the `st` was dropped off every `1st level`.

**Ruled:** position, which is the direct test. A tab is set in the trimmed
margin, OUTSIDE the block of body type; an ordinal sits on a line of it. The
extent is measured from the runs of body height on the page, deliberately not
from the detected columns — a tab stack can drag a column left onto itself, and
an edge derived from that places the tab inside the very block it is meant to be
outside of. That was tried first and it un-dropped the Revised Rulebook's own
`ProFIcIEncIES` tab, which is how the reasoning got checked.

**Measured, whole corpus:** twelve entries changed, all of them in `powers.json`,
all shedding drops rather than gaining them — ordinal superscripts on the class
tables and a row of footnote asterisks that had been silently deleted from the
text for as long as the rule has existed. `proficiencies.json` is byte-identical,
which is the check that the margin tabs are all still caught.

**Cost:** the rule now trusts that body type reaches further than furniture
does. A page whose only body runs are themselves in the margin would defeat it,
and none exists in six books.

### The coverage audit counted a naming difference as absent content (2026-08-16)

**Problem.** `verify-against-compendium` reported 98 differences against the
system's packs — 16 proficiencies and 45 powers the register supposedly lacked.
That report is not idle: it is where this roadmap's authoring priorities come
from, and extras' `hideSupersededPacks` map is built on the same question. Read
one by one, most of the 61 were content the register already holds.

Three separate blindnesses, each mechanical:

- **A kind the pairing does not read.** The proficiency pairing read
  `kind.proficiency` and `kind.combatProficiency` only. The Revised Rulebook's
  own table names eight thief skills — Climbing, Hiding, Listening, Lockpicking,
  Pickpocketing, Searching, Sneaking, Trapbreaking — and the register carries all
  of them as `kind.skill`, which neither pairing looked at.
- **A directory the reader cannot reach.** `registerEntries` walks the book
  directories and skips everything beginning with `_`, so `register/_refs/` was
  invisible. Animal, Beastman, Construct, Demon, Humanoid, Ooze, Undead and
  Vermin are creature-type tokens there; the pack ships each as an item.
- **A name the edition replaced.** The pack predates ACKS II and carries ACKS I
  spellings. Each was settled by searching the RR for both: *Righteous Turning*,
  *Master of Charms & Illusions*, *Dungeon Bashing* and *Apostasy* do not appear
  in it; *Righteous Rebuke*, *Mastery of Enchantments & Illusions* and
  *Dungeonbashing Expertise* do.

**Ruled:** an answer is reported at the tier that is true of it, rather than as
coverage or as a gap. Content under a kind the pairing does not read, and content
carried as a descriptor token, each get their own bucket and their own sentence —
counting them as covered would hide a real modelling difference, and counting
them as missing sends a chef to author an entry that already exists. Settled
renames go in `compendium-aliases.json`, which had never been authored: it held
its own example and nothing else. Proficiencies fell from 16 to 1, powers from
45 to 26 with 8 descriptor and 4 cross-kind.

**Ruled — the thief-skill question, which the roadmap left as neither.** It is a
modelling difference, and the register's model is the ACKS II one: these are
class powers whose target improves with level, so they are ladders the class
entries reference, not twelve standalone documents. The pack ships *Backstab*,
*Climb Walls*, *Hear Noise*, *Hide in Shadows*, *Move Silently* and *Find Traps*
because it was built against ACKS I. Nothing is owed here.

**Cost:** the ten monster resistances and immunities are still reported. They are
materialized into `fields.defenses` from the seat's own prose and will never be
documents, which is a standing decision rather than a lookup — so it is written
in the roadmap where the audit lives, and a chef meets it while reading the
report rather than finding it silenced inside the tool.

**One genuine gap survived the pass:** *Apostasy*, which appears in neither the
Revised Rulebook nor the Judge's Journal. It is named in the roadmap as content
to locate rather than aliased away.

### A page the histogram cannot read is authored, not out-detected (2026-08-15)

**Problem.** Sixteen definitions extracted whatever printed beside them instead
of their own text — Coat, Tunic and Pants and Turban shipped a column of price
digits. `detectColumns` bins body-run x-origins and needs a bin holding >8% of
them, which a table starves: BTA p95 prints columns at 36 and 306 and the
detector returns 240 and 310, both edges of the price list below.

**Rejected: a better detector.** Two were built and measured against the whole
corpus. Reading the gutters as whitespace over the page fails where a wide table
crosses them (RR p71 sets seventeen stat lines across the gutter). Reading them
from the anchor's own lines works on BTA but breaks pages where the block is
short and a table follows it: recompiled, that version fixed sixteen entries and
broke four that had been correct, `def.power.jargon` among them. Every variant
traded one set of pages for another, because the pages that defeat the detector
are irregular in different ways.

**Ruled:** `assists.columns` — the per-entry override the repo already had, and
already used on six register files — is the answer for these, and the detector
is left alone. An authored pair of numbers is exact, verifiable by reading the
entry's own text, and risks nothing on the eleven hundred entries that were
never in doubt. Sixteen entries authored across eleven pages.

**Cost:** a page that defeats detection now needs a human to notice. So the
measure became a gate rather than a note: `tools/check-prose-boxes.mjs` fails
when a definition's first paragraph does not contain its own anchor's x, and
names the entries needing the assist. It reads only the compiled cookbook, so
CI carries it.

**Two compiler rules were sharpened in the same pass**, both of them cases where
a test of SHAPE matched something that was not that shape:

- A section heading may not end in a full stop. Turban's closing line — "Meniri
  dwarves south of Opelenea and Kemesh." — is forty-four characters,
  capitalised, alone on its line, and set in a face that is not its column's
  commonest only because a price table below it holds the vote. It read as a
  heading and cut the entry in half.
- A run-in anchored on a PREFIX ending in "(" does not end at the prefix. The
  anchor is written that way because the level ordinal varies, but "(9th):" is
  still heading: 62 of 69 prefix-anchored definitions opened their description
  with their own heading's tail. Absorption now runs to the closing parenthesis
  and the colon after it, and only where the line actually holds that shape.

---

### Prose continues across a column and a page; never across a heading (2026-08-13)

**Problem.** A definition block that reaches the bottom of its column resumes
in the next one, and `columnFlow` / `pageFlow` ended that continuation at the
next anchor of the SAME kind. Nothing else stopped it, so a block ran through
whatever lay between: an equipment entry swallowed a weapon table and the next
item's entry, a dwarven whistle swallowed a fuels price list, a class power
swallowed a race's traits.

**Ruled:** a continuation also ends at a display heading, whatever kind it
belongs to. Body runs sit below the display-heading size, so the size alone
tells them apart without knowing what the heading says. Measured over the whole
shipped corpus: 15 of 1204 entries changed, every one of them shorter, none
longer — and the text each one shed was another entry's.

**Superseded same day for the body-size case — see the entry below.** This
ruling stands for display headings; the body-size run-in it declined to handle
was closed in 2.6.3.

---

### A block ends at its section heading, calibrated on the body (2026-08-13)

**Problem.** The reported entry survived the rule above. `def.power.longeval`
(and the four aliases that follow its text, *Ageless* among them) ends at "Code
of Behavior", which is a heading in neither of the senses the compiler knew: not
a display heading — it is set at body size — and not the next entry, because the
stop matched `alias === anchor.alias` and required a colon, and a section
heading is a THIRD font carrying no colon. The page sets a run-in face, a body
face and a heading face; the stop could see only its own.

**Ruled:** calibrate on the BODY, not on the anchor. Whatever face most of a
block is set in is prose, and a line-initial run in any other face that occupies
its whole line is a heading that ends the block. Testing the RUN's own text
rather than the line's is what keeps a bullet glyph — its own tiny face, empty
string, sitting at the column edge of a wrapped sentence — from reading as one.

**The half that mattered more.** Finding the stop is not enough: a block
continues into the next column and overleaf only because it ran out of column,
and a block that ended at a heading ran out of nothing. Those two branches were
gated on the run-in stop alone, so an entry that had already finished still
collected the next column and the page after it. `longeval` shed its Code of
Behavior and went on gathering a template table until the continuation was
gated on the section stop too.

**Rejected — stopping at any non-body face without the bracket test.** The JJ
closes a power with the classes that may take it, and that list wraps:
"[Elven Wizard," ends a line and "Nobiran Wizard, Wizard]" begins the next, in
the list's own face, flush left — a heading by every other test. Cutting there
leaves the bracket open, which is worse than not cutting: `stripOwnerList` no
longer recognises the list it exists to remove, so half of it stays on the page.
`def.power.flawlessPrecision` did exactly this until a heading was forbidden
from opening inside an unclosed bracket.

**One printed style, several fonts.** The stop that ends a block at the next
entry matched the anchor's own font, and BTA p98 sets "Firewood:" and "Refined
Oil:" — adjacent entries in one column, identically styled — in two different
aliases, so firewood described the oil beneath it. Matching "not the body font"
instead fixes that and breaks JJ p310, where the see-references ARE set in the
body font: "Alien Senses: See alertness." swallowed the entry after it, its
see-reference stopped parsing, and it silently ceased to be an alias at all —
caught only because the alias count fell by one. A heading is either: the
anchor's font, or not the body's. Neither test alone covers both pages.

**Measured, whole corpus, against all six books:** 34 of 1206 entries changed,
every one shorter, none longer, and 30 of the 33 now end on sentence
punctuation, and every cut lands where the DROPPED text opens a new section
rather than continuing the entry's own sentence — the weaker "ends on a period"
test scores a cut at any heading as clean, including a wrong one, so it was
replaced. Three entries end in table wreckage they ended in before — shorter,
not worse, and owed to their own boxes rather than to this rule. What the rest
shed was another section's: three witch traditions dropped from 5012 characters
to 915 by no longer reciting the whole Additional Class Powers list, and
`refinedOil` from 2561 to 309 by no longer reciting a weapon table.

**Confirmed against the wiki snapshot**, which preserves the paragraph
boundaries PDF extraction destroys: Longeval's page there ends exactly where
this rule now cuts. `flawlessPrecision` is confirmed by the book itself — the
Judges Journal closes a custom power with its class list, and the kept text
ends immediately before `[Elven Wizard, Nobiran Wizard, Wizard]`.

---

### An alias is read from the book its text prints in (2026-08-12)

**Problem.** A field report showed the class power *Ageless* describing itself
with a poison table and the general Proficiency Throws rules, in mangled
spacing, starting mid-word. Not an extraction fault: an alias — a name the books
list whose rules text prints under another entry — carries a pointer to its
target's passage, and that pointer is page geometry. The compiler copied the
geometry, and the citation, onto the alias without moving `book`. Nothing at
runtime could notice: an entry is read from `entry.book` alone, the instruction
set has no cross-document read, and the only correctness gate is the `expect`
probe on the name — which kept passing, because the name was the one field still
pointing at the right book. So 31 Judges Journal powers executed Revised
Rulebook rectangles against the JJ and extracted whatever printed there.

**Ruled:** an alias follows its text. Where the target lives in another book the
alias adopts that book, its pages and its name probe — the probe is what proves
the page, and the alias's own probe points at the listing it is leaving behind.
The ability's own name is a different field and does not move. The citation
already named the target's book, so this makes the entry agree with itself
rather than changing what it claims.

**Rejected — refuse the cross-book pointer.** The textless-alias path already
exists and degrades cleanly, so refusing would have been the smaller change. It
also leaves all 31 permanently unreadable and leaves a reveal button with
nothing behind it. Wrong text is worse than no text; no text is still not the
goal.

**Rejected — a per-field book.** Correct in the long run: it would let a JJ
entry keep its own book and still read a passage from the RR. It needs a second
document at runtime and a change to a frozen instruction set, which is not a
hotfix.

**Cost, accepted:** the book that unlocks these 31 moves from the JJ to the RR.
A seat with only the JJ connected loses their text — it never had their real
text, but it did have something. Worlds that imported them under the old data
hold mechanics scanned from the wrong prose; only a GM re-run of Update
Abilities repairs that, and nothing detects it automatically.

**The gate that was missing.** `expect` proves the name and nothing else, so a
mis-pointed field is invisible to it. `tools/test-cookbook-coherence.mjs` now
asserts over shipped data that an alias is read from its target's book, and that
an entry's citation names the book it is read from — the second is the
user-visible face of the same defect, and it catches all 31.

---

### The class-builder import leaves working examples, not just tables (2026-08-12)

**Problem.** acks-extras grew an advanced mode that derives a class from JJ
build values, consuming an `acks.classBuilder` ruledata doc, race documents
and per-class builder state — none of which ships anywhere (every number is
book content).

**Ruled (user):** the JJ table import produces all three. `table-recipes.mjs`
extracts the raw builder chapter (category ladders, the per-value spell grids
including the delayed-acquisition set, trade-offs, smoothing and post-8
prose, the dwarf/elf sections, the Ready-for-Play build paragraphs);
`builder-binding.mjs` assembles the engine shape into the same ruledata doc,
materializes `acks-extras.race` items stamped `def.race.<key>`, and writes
each Ready-for-Play build onto its class document — scoped, by the same
ruling, to the RR core classes and the demi-humans; the rest of the JJ
roster and races is extras-ROADMAP work. Live-verified: derive reproduces
the printed Fighter and Elven Spellsword spreads exactly.

**Mechanics that earned comments in code, recorded here once:** superscript
ordinal runs interleave mid-sentence ("capped th at 10 level"), so prose
anchors stop at the printed number and parses never assume adjacency; verso
pages sit ~26pt left of recto (the delayed grids), and one verso column
starts at x≈299, under the default 300 column split.

**Rejected: parsing trade-off elections out of the build paragraphs.** Which
sentence maps to which trade-off row is a judgment; the paragraph lands in
`builder.notes` and the Judge elects by hand.

### Position is not evidence, and a file that is another book is refused (2026-08-11)

**Problem.** A reader selected four books in the connect dialog, picked their
four PDFs, and every one of them landed in the wrong book — each warning that it
was a "different edition/printing" of the book it was not. The pairing was
positional: nth book selected takes nth file picked, which the dialog's own note
advertised as "paired in the order you chose them".

**Ruling.** That order does not exist. A `<select multiple>` reports
`selectedOptions` in *document* order however it was clicked, so the reader's
sequence is gone before the callback runs; the OS file picker returns its files
in its own order, usually alphabetical. Position therefore carries no information
about which file is which, and pairing on it is a coin toss that looks
deliberate. The filename matcher that had always existed — remembered name, then
byte size, then the book's title in the filename — was consulted only for
*surplus* files, i.e. never in the case that mattered. It now decides the named
books first, and position survives only as the last resort for files no evidence
could place. The matcher moved to its own module so the pairing can be exercised
offline instead of only against four real PDFs.

**Also ruled: a wrong-book file is refused, not warned about.** The fingerprint
check already knew the file was wrong and said so — and read it anyway. Every
recipe this build extracts is a page number, so a book filled from the wrong PDF
imports the wrong page's content under the right name and nothing downstream can
tell. `identifyBook` asks the fingerprint the other way round ("whose file is
this?") and the read is refused when the answer is another book in the registry.
A printing that fits *no* book still only warns: that is edition drift, which is
what the warning was for.

**Cost.** One case the guard cannot catch cleanly: a variant printing whose page
count exactly equals another book's and which carries no metadata title at all
would be refused as that other book. No shipped printing does this — the
registry's page counts are distinct, and a test holds them that way — and the
alternative was reading it into the wrong slot in silence.

**Rejected: asking the reader which file is which.** A row per book with its own
picker already exists for reconnect, and it costs one trip through the OS dialog
per book. The whole point of the multi-select is that one trip does the lot; the
evidence is good enough to earn it, and what it cannot place it names.

---

### One dedup rule for every importer: ask the shelf you write to, and claim before you build (2026-08-06)

**Problem.** Duplicate imports, reported from a live table as "double-importing
(or worse), especially the classes". Four independent causes, none of which the
offline suite can see (it has no compendium, no concurrency and one user):

1. *World read, pack write.* `importToCompendium` moved where documents are
   created. `importedIndex`/`importedIdSet` were taught to follow it; equipment,
   location journals, adventure roll tables and `resolveCompanion` were not, and
   kept asking `game.items` / `game.journal` / `game.tables` / `game.actors`.
   With the setting on, each of those saw an empty shelf on every run.
2. *Check and create are not atomic.* `importAbility` read the dedup index, then
   spent a page extraction and a socket round-trip building the item. Imports
   run four at a time and every creature resolves its own proficiency list, so
   four creatures reaching for one shared ability in that window each made one.
   This is the "or worse": the copy count is the concurrency, not two.
3. *No GM guard.* `importClasses`, `importAllEquipment` and
   `cookbookUpdateClasses` were the only bulk entry points without one, while
   their macros are labelled "(GM)" and executable by every seat.
4. *No dedup at all.* `cookbookImportIds` and the browse-and-load path created
   unconditionally.

**Taken: the two rules, applied everywhere.** A presence check reads whichever
target the matching write goes to — `importedIdsOfType(type, worldCollection)`
is that question asked once, and `importedItem` / `importedActor` are its
document-returning forms. And a build is *claimed* before it starts:
`claimImport(id, build)` caches the in-flight promise keyed by cookbook id, so
the second caller waits for the first one's document. This is the same shape
`ensureFolderPath` already used for folders, generalized. Because the claim is
keyed on the cookbook id alone and shared by every item importer, it is also
what guarantees the class import and the ability import resolve to the same
item rather than one each — the cross-importer half of the report.

**Rejected: a de-duplicating repair pass.** Worlds that already ran the broken
importers hold twins. Merging them means choosing which copy the actors that
embedded it should follow, and that is a migration with a new user-facing
surface — a minor, not a patch. The clean-slate path already ships and works:
Remove ALL Imports, then import again. Recorded in ROADMAP.

**Amended 2026-08-06 (2.4.2): a claim is a window, not a cache.** The first cut
of `claimImport` kept the resolved promise in `inflightImports` forever, which
made it a second cache — one `forgetImportedIndex` reached but nothing else did.
Deleting an imported document therefore left the claim answering for it, and
delete-then-re-import (the only way to refresh a value derived at CREATE time)
silently did nothing until a page reload. The claim is now released in a
`finally`; `rememberImported` has already run by then, so the verified index
holds the result and no window is reopened. `importedItem` also confirms a
cached document against its collection before trusting it, since the index is
built once and the GM may delete from the sidebar at any time. Caught by live
testing — the delete path has no offline coverage, and both faults are
invisible to a single-pass import.

**Cost.** `importEquipment` splits in two so the item half can be claimed while
the animal half (an Actor) stays outside the item index. `poc.mjs` gains a
`browsed` flag so a browse-loaded document can be found again — documents
created before this release carry no such flag and will still be twinned once,
after which they are stable.

---

### The refresh bridge: bytes may cross a reload, and nothing longer (2026-07-29)

**Problem.** The possession model persists a book's *location*, never the book.
Three location kinds existed, and only two could reopen themselves: a
`FileSystemFileHandle` (one permission click) and a fetchable `url` (silent).
Both are out of reach for the seat that needs them most — the File System
Access API does not exist outside a secure context, so a player on plain
`http://` over the LAN, and every Firefox seat regardless of origin, fell to the
`file` kind: the remembered *name* of a PDF and nothing else. That seat re-picked
every book through the OS file dialog on every page load, and a Foundry client
reloads constantly.

**Rejected: caching the PDF per seat.** IndexedDB is the only store not gated on
a secure context, so a durable byte cache is the only thing that would have made
a remote seat reconnect with no gesture at all. It was rejected because it
quietly converts "you must keep the book" into "you must have had the book
once": the cache outlives the file, and the module's central claim stops being
true.

**Taken: a 60-second window, measured from when the page went away.** The bytes
of an *already open* book are held in IndexedDB and are readable only while a
`touched` stamp — refreshed every 20s by a live page, and once more on
`pagehide` — is inside the window. Every join sweeps first: inside the window,
books reopen silently; outside it, the bytes are deleted before anything else
runs. `Forget Books` and setting the window to `0` both empty it immediately.

The stamp is deliberately not written at connect time. Measured from the
connect, an hour of play would leave the window long expired at exactly the
reload it exists to cover, which is the whole failure it addresses.

Three properties of that stamp are load-bearing, and 0.61.0 shipped with all
three wrong — the bridge never once fired on a real refresh. Recorded because
each is invisible until tested against an actual reload:

1. **The stamp lives in localStorage, not IndexedDB.** It is written from
   `pagehide`, and an async IndexedDB transaction opened there never commits —
   the page is destroyed first. Measured directly: the localStorage write lands
   every time, the IndexedDB write lands never. With the async write silently
   lost, the freshest stamp was whatever the 20s heartbeat last managed.
2. **The comparison is against `performance.timeOrigin`, not "now".** Foundry
   takes 20–45s to reach `ready`, so comparing at `ready` charged the reader's
   window for the boot they had just sat through — a 60s window bought perhaps
   fifteen, and a slower world bought none. The question is "how long was this
   seat away?", which is timeOrigin minus stamp and nothing else.
3. **A slightly negative gap is the normal case, not clock drift.** A reload
   records the incoming document's `timeOrigin` *before* the outgoing page is
   given `pagehide`, so an ordinary refresh yields a gap a few milliseconds
   below zero. A `gap >= 0` guard therefore rejected every single refresh. Only
   a stamp more than `CLOCK_TOLERANCE_MS` ahead means the clock actually moved.

Worth stating plainly: the byte cache was never the fragile part. An
FSA-derived `File` stored in IndexedDB was verified to survive a reload and
read back byte-identical. Every failure was in deciding *whether* to use it.

What this does and does not concede: a reload is not a new session, so bridging
it enforces nothing less than before. A *session* still cannot begin without the
reader's own file. Nothing is uploaded, nothing enters world data, no other seat
can read it, and prose remains memory-only everywhere.

> **The last sentence is superseded** by "Imported text is written into the
> world, once, by the GM who owns the book" (2026-08-24): what a GM imports —
> prose included — now persists in world data. The bridge itself, and everything
> else in this entry, stands: it still governs the BYTES of a book, which are
> never stored beyond the window and never uploaded.

**Also:** where a gesture is still required, it is now one gesture for the whole
shelf. A plain file picker grants no persistent permission and so consumes no
user gesture (unlike `requestPermission` on a handle, which is why the per-book
rows exist at all), so a seat re-picking two or more books gets a single
multi-file control that matches files to books by remembered name → remembered
size → the book's title in the filename. Unmatched files are named, never
guessed at: a book filled from the wrong PDF is worse than a book left closed.

### Dialogs are singletons (2026-07-29)

`connectBook()` and the reconnect pass are each reachable from more than one
place — a macro, the Getting Started button, the join hook — and none of them
checked whether their dialog was already open. Every extra call stacked another
identical window, so a reader who clicked "Connect your book" twice got two book
pickers, two dropdowns listing the same six books, and two chances to read the
same PDF into the same slot. Both now register a key *synchronously*, before
their async content build, and a second call brings the open dialog forward
instead.

---

### Withdrawn surface

Things this module used to ship and deliberately does not. Recorded because the
absence is a decision, and a reader of the registry would otherwise re-add them.

**The demo book (2026-07-19).** A fake entry ("cw", Codex of Whispers) sat in the
book registry to demonstrate the missing-book path. The cookbook now spans three
real books and no seat is expected to own all of them, so an unreadable entry is
the ordinary case and needs no prop to show it off.

**The Judge's Screen inserts (2026-07-24).** Listed as a book ("js") because four
hiring tables were read off them. Every one of those tables is printed in a book
the reader already needs — three in the JJ, the signing bonus in the RR — so the
screen only ever added a fifth PDF to connect for content the seat could already
read. A book id is a promise that connecting that PDF unlocks something; the
cheatsheet no longer unlocks anything.

**The PoC driver and its audit popout (2026-07-19).** A fixed sample set and a
side-by-side contrast of the two language options. Both demonstrated a question
the cookbook has since answered in production, and both leaned on the fake book.

**A third copy of the LevelValue resolver.** A local `levelValueAt()` flattened
an imported ability's roll target to a first-level number to fit core's single
`rollTarget`. Ladders now travel whole into the abilities flag and resolve there
against the character — this module locates and classifies, it does not evaluate.

**An offline-resolved `powerValue`.** The custom-class build cost used to be
resolved during compilation and shipped as a number, which put book values in the
module. It is now a shipped *pattern* matched against the reader's own extracted
text at runtime, like the defence and effect scans. The pattern ships; the number
it finds never does.

---

### The book-progress denominator measured the wrong thing

The "how much of this book can I read" count compared the handful of hand-written
PoC recipes against `proseMem`, the prose extracted eagerly on connect. Both
predate the cookbook, so a seat holding the whole Monstrous Manual was told about
a denominator of a dozen against a numerator that starts at zero and stays there
— cookbook prose is extracted lazily per reveal and never lands in `proseMem`.

The number was not wrong so much as measuring something nobody asked about. What
a reader wants to know is how many SHIPPED entries this book's connection
unlocks.

---

### Fingerprints are page count plus metadata title, never file hashes

DriveThruRPG watermarks each customer's copy, so the bytes differ per person. A
hash-based fingerprint would identify one buyer's PDF and reject everybody
else's.

---

### A second class book joins without a second import path (2026-08-06)

**Problem.** By This Axe prints ten dwarven classes plus reprints of the RR
craftpriest and vaultguard, in a typography measurably different from RR:
body type at exactly 10pt (RR sets 9), glyph runs joined without inter-word
spaces, XP figures kissing their Title neighbours at 6-8px, proficiencies as
run-ins rather than display headings, and the class C/G schedule stated only
in prose because the RR grid does not know these classes.

**Ruled: RR wins every overlap, and no BTA register entry re-anchors what
another book already defines.** The two reprinted classes got no bta recipes
- their rows in the source matrix carry the bta spread page and a note of
what the diff found (the craftpriest reprint is value-identical; the
vaultguard differs at two mid-table XP thresholds). Powers the JJ
consolidated chapter or an RR spread already anchors keep their ids and
anchors; a world with RR+JJ loses nothing by not owning BTA. Only what no
book has is authored bta-primary.

**Ruled: typography is a per-book constant, not a global.** Widening the
definition body ceiling globally to admit BTA leaked RR sidebar quotes into
neighbouring entries; widening cell glue globally would have re-fused RR
columns. Both are dispatched per entry book. The prose C/G schedule is a
binder fallback that fires only when the grid lookup misses, so RR classes
never touch it.

### The printed name and the defined name are two different names (2026-08-14)

**Problem.** A class or race spread names a power in the short form its own
paragraph uses; the definition it points at carries the full one. A dwarf's
value-0 rung prints "Hardy" for `def.power.hardyPeople`, and prints "Dwarf
Tongues" and "Elf Tongues" for `def.power.giftOfTongues` — a name no
definition carries at all. Race materialization resolved rung powers by exact
item name, so the misses landed in the rung's note and the rung granted
nothing. In a world that has not yet imported its powers, *every* name misses
and every rung comes up empty.

**Ruled: the source matrix is the alias index.** `register/_refs/powerSource`
already records, per class, the name a spread prints beside the ref it means —
it was built as a provenance matrix, but that pairing is exactly the alias
mapping, and authoring a second list of aliases beside it would give one fact
two owners. Resolution now falls through to it: world item by exact name
first, register second.

**Ruled: a register hit binds even when the world does not hold the power.**
A `def.*` id is a ref in its own right, so the rung points at the definition
and resolves the moment those powers are imported — better than a note naming
a power nothing links to. Only a name the register cannot place stays in the
note.

**Ruled: an ambiguous printed name resolves to nothing.** Nine classes print
a "Renown" of their own, and four print a "Lay on Hands"; binding a rung to
whichever came first would attach another class's power. Five names are
ambiguous today and every one of them is dropped from the index rather than
guessed at.

**Cost, and what it exposed.** `powerSource` was the one reference register
that never declared `registry`, and the compiler keys tables by that field
(`refs[r.registry] = r`) — so it had always compiled into the cookbook as the
literal key `undefined`. Nothing could name it, and a second omission would
have silently overwritten the first. The lint now requires the field and
requires it to equal the file's basename, which is why the file is
`powerSource.json` rather than `power-sources.json`.

### A language is a name and a page, not a description (2026-08-15)

**Problem.** `kind.language` had a folder and a category but no entries. The
obvious authoring — model it on `kind.proficiency` — does not fit what the book
prints. The Auran Empire languages are not descriptor blocks: RR Appendix A
sets all 58 as one indented family tree, each a single cell naming the language
beside its real-world counterpart, and no page anywhere describes an individual
language. There is no run-in heading, no display heading and no prose.

**Ruled: languages compile to their name check alone.** *Superseded same day —
see the entry below: 58 name-only entries turned out to BE the list, and none
ship.* `compileLanguage`
anchors the printed cell (`anchor.label`, matched folded so Argollëan survives
extraction differences) and emits one `expect`. Every other definition kind's
`description` instruction would have nothing to point at. Aiming it at the rows
below the cell — the only text there is — would hand each language its
children's names as its own prose, which is how `def.equip.coat` already fails
(ROADMAP).

**Ruled: the tree stays on the page.** *Superseded same day — see the entry
below: the names do NOT ship, and the tree is read into the world from the
seat's own book.* Names ship, as every entry's name does.
Descent, and which real-world tongue each language stands in for, is the page's
own arrangement — the table IS the content — so the entry ships neither. A
reader follows the citation. This also keeps the register honest about what it
knows: nothing in the module can be wrong about a relationship it never claims.

**Cost.** A language item's description is a citation stub with no reveal. The
`@PdfText` reveal link is now gated on the recipe HAVING a description
instruction rather than on the seat having the book, because otherwise every
language showed a reveal that opened on an empty string.

**Ruled: `def.language.*`, never `def.lang.*`.** `itemShelfFor` keys on an id's
first two segments, and the shelf commit bab3055 added is `def.language` — so
`def.lang.*` ids lint clean, compile clean, and file all 58 languages in the
unsorted root folder. Nothing else in the register or the compiled cookbook
collides: no existing definition's id tail matches a language's, and no
cross-reference in any book resolves to one. The single name collision is
`mm.lizardman`, a monster in a book cookbook, which shares no lookup with a
content-type definition.

**Ruled: languages stay out of the printed-name tokenizers.** A class's
Proficiency List and a template's Proficiencies cell name proficiencies, skills
and powers, never a language. Feeding 58 short common words ("Orc", "Ithean",
"Draconic") to a greedy longest-first matcher only gives them a chance to claim
the head of a cell that belongs to something else.

### The taxonomy is read from the seat's own book, and a list cannot ship (2026-08-15)

Supersedes the first two rulings of the entry above, hours after they shipped.

**Problem.** Fifty-eight register entries whose every field was the same name
— camelCased in the id, plain in `name`, folded in `anchor.label` — passed
both IP gates. `ip-scan` caps string LENGTH and hunts for prose; the register
lint caps a label at sixty characters. Neither counts how MANY name-only
entries a kind ships, and a taxonomy transcribed one cell per entry is not a
way of finding the list, it IS the list. The family's rule is that no value
read off a page ships in any repo, history included; the entries were removed
and the commits that carried them were squashed out of history before the
branch and tags moved.

**Ruled: the recipe carries geometry, never names.** The `languages` table
recipe (`table-recipes.mjs`) holds a section heading, two x-bands and an
indent step. `extractIndentTree` (`table-extract.mjs`) turns cell indentation
into depth and parentage at import time, in the world doing the importing,
against the seat's own Revised Rulebook. What the rows SAY never enters this
repo; a derived id is not shipped content.

**Ruled: extracted languages become shelved ability items.**
`language-binding.mjs` derives `def.language.*` ids — honoring this entry's
own earlier `def.language.*`-never-`def.lang.*` ruling, which the first cut
of the binding violated (it minted `def.lang.*`, which `itemShelfFor` cannot
key, so all 58 items landed loose in the world root). Creation goes through
`ensureItemFolder`, the same shelf machinery every other imported ability
uses. The items do not set the `generated` flag: Prune removes generated items
whose definition no longer resolves, and a language never had a definition to
resolve — flagging them would offer all 58 for deletion on the next prune.

**Ruled: the gate that was missing now exists.** `audit-transcription.mjs`
fails validate when any kind ships more than a dozen name-only entries. It
caught nothing the day it landed only because the list was already gone; it is
the check that would have refused the list on the day it was authored.

**Cost.** A world whose seat never imports the Revised Rulebook has no
language items at all. That is the right failure: the alternative was the
module knowing the answer.

### 2026-08-15 — an imported language is a `language`

The taxonomy imported as `ability` items carrying `system.category:
"language"`. The system has owned a first-class `language` item type all along:
it declares the type, gives it an icon and a details template, files it in its
own section of the character sheet, and reads it in the Polyglot provider it
registers at startup. Minting abilities put all 58 tongues outside every one of
those at once — imported languages showed up in the proficiency list, and no
character speaking one was visible to Polyglot.

**Ruled: the type is the system's.** `LANGUAGE_TYPE` replaces the ability
constant, and the descent record moves from `system` to flags, because the
system's language type carries a description and nothing else and a field it
does not declare is dropped on the way in. Nothing about the IP posture
changes: the names still come from the reader's own book and the ids are still
derived at runtime.

**Ruled: find before minting, in three places.** A tongue is looked for by its
derived id, then by name among the world's languages, then in the system's own
compendium. The first is the old idempotence guard; the second stops the import
laying a twin beside a language a Judge typed themselves; the third means a
world gets the system's furnished document — description and art — rather than
a bare name. An adopted document is stamped with the derived id so the next run
finds it by the fast path.

**Ruled: the retype creates before it deletes.** A document's type cannot be
updated, so an ability minted by an earlier version is replaced rather than
changed. The replacement is committed first and the ability removed only once
its successor exists, so a run that dies halfway leaves a duplicate — which the
next run adopts — never a world that has lost a language.

**Cost.** The name index spans every type, not just `language`, so a world
holding the old abilities is recognised as already having the tongue. Without
that, the release that fixes the type is also the release that doubles
everyone's language list.

### 2026-08-16 — who speaks which: read off the spread, defaulted off the chapter

The roadmap entry of a day earlier said the language lists were "not a
pattern away" — measured against `cookbookProse`, which returns only the
register's description window. Wrong measurement: the spreads DO print the
lists, as a `Tongues:` runin in Racial Traits, and the class binder's `body`
(the full spread, the same read the cleave phrase uses) reaches it.

**Ruled: the runin is the granted list, whole.** It names the racial tongue,
the common one, and the rest, so a demi-human class imports with `granted` =
the parse and `count` = 0; Intellect's slots are the extras module's business
at grant time. The parse keeps only proper-name-shaped items, so a
speak-with-beasts power can never be granted as a language.

**Ruled: a human class is the chargen chapter's rule.** No runin means human:
one open homeland pick beside the common tongue, whose NAME is extracted once
per run from the chapter's own "often called" sentence
(`def.classmeta.startingTongues`, the compiler's new prose-window classMeta
shape). Bookless imports grant nothing rather than a guess.

**Ruled: race documents inherit through the runin's own subject.** "Dwarf
Tongues" names its race; the label, folded, keys the builder's race item, and
only an EMPTY race list is written — a Judge's edit is never replaced.

**Found while shipping, not fixed here: repeated compiles disagree.** Six
from-scratch compiles produced four distinct powers.json hashes, differing in
paragraph box coordinates — so the drift gate flagged different entries on
different runs. UNRESOLVED whether the compiler itself is nondeterministic or
the measurement was contaminated: a concurrent session was hand-editing the
compiler and the bta registers during the same window, and this session's own
compiler edit was overwritten mid-run by that session, so the hashes may have
been comparing different programs. Re-measure on a quiet tree before treating
the compiler as guilty. The committed cookbook is the modal output of six runs, which also
repaired 22 BTA entries whose committed boxes pointed at the WRONG page
column — stale survivors of the margin fix that the in-place compile's
folding behaviour never replaced. The determinism bug is toolchain work and
is recorded in the intake ledger, not patched in a hotfix.

**Ruled: a clause the page interleaves is dropped whole.** The Spellsword's
spread lands its proficiency list mid-sentence in the raw column text,
capitalised exactly like tongues, so no shape test can separate them. The
speak-clause capture is capped at 80 characters — every real list fits in 48
with all its spaces glued out — and a clause that cannot reach its terminator
under the cap is interleaved and dies; the class falls back to the human
default. One class granting fewer languages beats one class granting
Fighting Style Specialization as a tongue.

### 2026-08-16 — a class is its race's whether or not its page reads

The Spellsword fallback shipped in 2.9.3 was the right refusal and the wrong
resting place: the class got the human default, which is not merely less
information but WRONG information — an elf handed a homeland pick it does not
get.

**Ruled: the register declares the race; the book still supplies the list.**
`class.race` on the six demi-human RR entries is a classification, the same
kind of statement as `chassis` or `factored`, and the class's name already
says it. The tongues are then borrowed from a sibling of the same race whose
page parsed, so every name still came off the reader's own book — only the
page it was read from changes.

**Ruled: only a class that read its OWN runin may lend, and only a class that
did not may borrow.** Without that pair of tests a human-default list
propagates itself around a race and the fallback silently becomes the answer.
The borrower also hands back the homeland slot the default had spent, keeping
whatever its own spread granted on top.

**Ruled: Nobirans are their own race and stay on the default.** Their spread
prints no Tongues runin, so there is no sibling to borrow from and nothing is
invented; the declaration is there for the day a page provides one.

**Ruled: bonus languages are picks, never names.** Multilingual and Linguistics
grant languages of the reader's own choosing — the book says so and leaves them
to the campaign's regions — so they land in `count`, not `granted`. The largest
grant found wins rather than the sum, because a spread states its allowance once
and then talks about it.

**Cost, and the shape of the whole feature:** every pattern here is `\s*`
between tokens and explicit in its alternations, because raw body extraction
glues inter-run spaces out. That is not defensive style, it is the measured
behaviour of the source — `ElfTongues:`, `theCommon`, `AncientZaharan`,
`called“Common”`. The last of those cost a release: 2.9.3 shipped with the
common tongue silently unfound, so every human class imported speaking nothing.

---

### The Compatibility Guide becomes a book the reader connects (2026-08-19)

`tools/harvest-conversions.mjs` has said since it was written that the System
Compatibility Guide "needs NO recipe … only the CONCLUSION ships", and its OGL
name table ships exactly that way. The OSE path needed the guide's *other* half
— the arithmetic on printed page 2 — and the same posture would have shipped
four integers read off a page.

**Ruled: `scg` joins `BOOKS`, and the constants are extracted per reader.** The
rule is structural and ships in `ose-convert.mjs`; the numbers arrive as an
argument, the shape `formation/jumping.mjs` already uses for printed values it
needs but may not carry. This is deliberately stricter than the standing ruling
for the same book, and stricter than `stats.mjs`'s save table.

**Ruled: the anchor carries no standalone number.** Each constant is an `expect`
on a clause that names the conversion, plus an `int` read of the clause that
carries it. A printing that moves the text fails the anchor and the entry
degrades to a stub, instead of reading an integer out of whatever sentence now
occupies the box. `lint-register.mjs` enforces the no-number rule on the anchor,
and the digit test is for a STANDALONE number, because the lineage lists that
make the best anchors name editions like "3E".

**Rejected: a gate that lists the forbidden values.** The obvious check —
"`ose-convert.mjs` must not contain 9, 10, 11 or 20" — writes those numbers into
a tracked file and defeats itself. `validate-extra.mjs` §3 is an ALLOW list
instead: every numeric literal in the converter must be one of six structural
ones, each justified in the comment. Strictly stronger, and it names nothing.

**Cost:** a `kind.constant` with its own compiler branch, because a constant is
a definition by role with no heading to locate and no prose block to bound —
the same shape problem `kind.vehicle` has.

---

### Morale is mapped from the scale's endpoints, not clamped (2026-08-19)

OSE morale is a 2d6 score, 2–12. The ACKS field admits −6…+4 and *hard-clamps*
(`monster-data.mjs`). `cookbook.mjs`'s `bindNpc` clamps too, correctly, because
an AX quick-stat line is already on the ACKS scale. Reusing that binder for OSE
would have pinned every morale of 5 or more to +4 — most of any book's roster.

**Ruled: the two scales are the same width, so the endpoints fix the mapping.**
Eleven values each; the lowest morale in one is the lowest in the other, giving
2→−6, 8→0, 12→+4. Nothing is chosen. OSE's steady 7–8 landing on the ACKS normal
of 0 is the corroboration, not the derivation.

**Ruled: the offset is read, never written down.** `moraleOffset()` takes the
ACKS bounds from the live schema and the OSE bounds from the dice, so the
converter holds no morale constant and a system that rebalanced the field would
not silently acquire a wrong mapping. Where the widths differ, no endpoint
mapping exists and the axis becomes a gap.

**Ruled: this is a derivation, not a printed rule.** The guide is silent on
morale. The Source tab labels the route "scale endpoints" rather than citing the
guide, so a Judge can see which values rest on a printed rule and which do not.

**Ruled: `ose-convert.mjs` never reaches a clamp.** A score outside 2–12 is a
mis-read and becomes a gap; it is not squeezed into range.

---

### A source is registered by the Judge, and a dialect belongs to one book (2026-08-19)

**Ruled: page count is the fingerprint; the document title is evidence only.**
One of the sample books carries its author's word-processor filename in its
metadata title, so a registry that trusted titles would mis-name it. Page count
survives the per-customer watermarking that makes bytes useless, and a Judge can
read it off any file.

**Ruled: ambiguity is resolved by asking, not by refusing.** `identifyBook`
refuses to name a book on ambiguous evidence, which is right for a shipped
registry. Two adventures of the same length is an ordinary situation, and the
Judge knows which file they just picked — so `identifyOseSource` returns a
single answer only on more than page count alone, and the caller asks otherwise.

**Ruled: a label spelling learned from one book changes only that book.** One
sample heads its hit dice "HIT DICE". Widening the shared alternation to
`HD|HIT DICE` is this project's named standing failure mode — it converts one
verified reading into an unverified claim about every book nobody has opened.
The spelling lands on that source's profile row and nowhere else, and
`test-ose-statline.mjs` asserts the canonical profile does not learn it.

**Ruled: what the geometry cannot separate is marked, not converted.** Two
armour-class labels in one candidate means two creatures were gathered
together — a narrow stat block set inside a prose column, a sub-column the
page-wide histogram cannot see. The grammar would still return a full-looking
reading of two creatures mixed, so the candidate carries `mergedBlocks` and
stays out of any unattended path. A block from a different game carries
`suspectLineage` for the same reason: read as OSE, its ascending armour class
inverts silently.

**Cost, and what it bought:** the locator segments on stat-bearing LINES rather
than vertical gaps, because a block set inside body text has no gap above or
below it. Getting there cost two real bugs, both from reading the raw run
concatenation instead of the geometry: the PDF emits no space characters, so
"ML 5" arrives as `ML` and `5` with a gap between them and every word-boundary
test failed on the whole line.

---

### Three things a converter cannot tell you, found in one live run (2026-08-19)

The OSE path's offline suites were green — 5 files, every axis asserted, the
constants round-tripping off the real guide. The first live run found three
bugs, and the shape they share is the lesson: **each one sits in the gap between
a value being computed correctly and that value arriving where anything reads
it.** A suite that stops at the converter cannot see any of them.

**The extended stat block was computed and then dropped.** `convertOse` returned
`extras` — hit-dice rating, saves-as, the speed table, the encounter numbers —
and `oseActorData` never assigned it to the document. Every one of those fields
was correct in the converter's output and absent from the created actor. The
offline tests asserted `converted.extras`, which was right, and never asserted
the document, which was wrong. `test-ose-binding.mjs` now asserts the document.

**A creature opened on a sheet that could not show its own provenance.** The
Full Monster sheet registers for `monster` but is deliberately NOT the default
for it, so an imported creature landed on a sheet with no Source tab — the audit
surface existed and was unreachable by ordinary use. Fixed by pinning
`flags.core.sheetClass` on the imported actor, **not** by changing its type: an
OSE monster is not an `acks-extras.animal`, and `monster` is what every other
import in this module already creates.

**Calibration never fired, on any book.** `unknownLabels` passed a one-label
profile into the block finder to widen the net, and did the opposite: a
candidate needs several distinct labels before it is a block at all, so the
narrowed profile matched nothing anywhere — including the pages that most needed
the prompt. The consequence was worse than a missing prompt, because of the
fourth finding below.

**A clause under an unrecognised label was swallowed without trace.** In this
idiom a comma separates fields, so words that are not a label fall inside the
PREVIOUS field's segment. Every reader takes what it recognises off the front,
so a block reading `AC 7 [12], HIT DICE 1 (4hp)` reported an armour class and
lost the hit dice entirely — no gap, no warning, nothing in `extra`. The residue
rule had been applied only to single-token fields; it now covers every field
whose reader does not keep its clause verbatim.

**Ruled: an offline suite for an import path must assert the DOCUMENT, not the
transform.** The three highest-value checks written after this run — the extras
flag, the pinned sheet, the surviving unknown clause — were all cheap, all
offline, and all absent because the suite tested the function that was easy to
test. Each was added with the pre-fix code confirmed failing first.

**Cost:** the release stopped at the gate with the version bumped, the changelog
written and the snapshots half-captured. That is the gate working. The morale
mapping — the axis most likely to be silently wrong, and the one the whole run
was designed around — was correct on the first live attempt: 7→−1, 8→0, 9→+1,
12→+4, read back off persisted actors.

---

### Hand conversion edits clauses, not parsed values (2026-08-19)

The import path needs a readable PDF, and a good deal of what a Judge wants to
convert is not one: a scan with no text layer, a block the locator refused
because it could not tell two creatures apart, a monster off a forum. Those need
a way in that does not involve a page.

**Ruled: the editor holds each label's CLAUSE, in the source game's idiom, and
converting re-runs the ordinary grammar over a reassembled stat line.** The
obvious alternative — a widget per parsed value, a number box for morale and a
dropdown for the save class — is easier to build and would have frozen the
editor at whatever the grammar understood on the day it was written. Every rule
learned afterwards would have needed a second implementation here, and the two
would have drifted. As ruled, a new hit-dice spelling or a mangled dash reaches
hand entry the moment it reaches the parser. `parseOseStatline` grew a
`segments` return for it, which is the clause as written rather than what was
understood.

**Ruled: pasted text is read with everything the world has learned; a book is
not.** These look contradictory and are not. The per-source rule exists so one
book's wording cannot silently change how a different book parses. Pasted text
belongs to no book — there is no reading to corrupt, the Judge sees the result
in an editable form before anything exists, and the reader names which learned
spelling fired and which source taught it. So the pool is safe exactly where the
per-book restriction is necessary, and calibrating one adventure now makes every
later paste better.

**Ruled: `oseActorData` splits, and the fields half is the real one.** It
re-derived its fields from the raw text, so a corrected clause would have been
discarded between the form and the document — the same fault as converting a
value and never writing it, which this feature had already shipped once and had
caught live. `oseActorDataFromFields` takes settled fields; the old entry point
is a wrapper that parses and delegates.

**Ruled: `origin` is recorded.** "Read off a page" and "typed in by a person"
deserve different amounts of trust at the table, and the Source tab can only say
so if the record distinguishes them.

**Cost:** the line-joining rule that closes up a word the typesetter broke
across a line had been living in the locator, where pasted text never reached
it. It moved into the grammar as `joinLines`, so both paths get it — pasted
text is the same page, copied, and carries the same broken words.

---

### The corpus is the feedback loop, and evidence promotes a spelling (2026-08-19)

A block that has to be corrected by hand is a **defect report against the
grammar**. The manual editor exists so a Judge is never stuck; it is not where a
misreading is supposed to end. `tools/ose-coverage.mjs` sweeps the local
third-party library and ranks what the grammar could not read, so those reports
arrive in bulk instead of one Judge at a time. Take the top line, write the
rule, run it again — the number that matters is the share of blocks read
completely.

**Ruled: the report is SHAPES, never values.** Every digit run folds to `#`, so
one finding covers every book that prints that shape. A shape is what a rule is
written against, and a report of shapes carries no publisher's numbers — which
is what makes it safe to read, quote and act on. It prints to stdout and writes
nothing: a coverage file in the repo would be a corpus of other publishers'
stat lines in a tracked file.

**Ruled: multiple independent books promote a spelling from per-source to
canonical.** This AMENDS the same-day ruling that a spelling learned from a book
stays on that book's profile. That ruling was right on the evidence it had —
ONE book heading its hit dice `HIT DICE`, from which generalising is this
project's named standing failure. The new evidence is different in kind: a sweep
of 93 books found `Hit Dice` in four independent titles across two publishers,
and `Saves D# R# H# B# S#` — B/X's own letter names — in several more. A wording
several unrelated publishers use is the family's, not one book's. The per-source
mechanism stays exactly as it was for everything that has been seen once.

**Ruled: a partial reading is worse than none, and the corpus is how you find
them.** The alternate save letters did not fail loudly. `SV D12 R13 H14 B15 S16`
matched three of five letters and quietly produced a creature with three saving
throws, the other two left at their defaults with nothing to show the
difference. A row is now accepted only when its letters make up a complete known
set; anything else is reported. The same rule now guards the bare-number
fallback, which used to turn a broken row into a confident single value.

**Cost, and what it says about the method:** the two largest findings in the
whole sweep were bugs in rules added earlier the same day. The residue cut,
introduced so nothing read is dropped, cut at the first comma anywhere — so it
severed a group's hit points (`(hp 4, 6, 7)`) and every thousands separator in
the corpus, the latter 141 times across 22 books, presenting as an unexplained
bare number. Both are one-line fixes and neither was visible from the three
books the feature was built against. Coverage over the whole corpus went
72% → 90% on these findings alone.

---

### A label that is also an English word cannot be canonical (2026-08-19)

Several books print `Attacks:`, `Morale` and `Saving Throws:` as stat-block
labels, and by the evidence rule above — used by unrelated publishers — they
looked like promotions. Adding all three made coverage WORSE: nine more
"blocks" appeared and two publishers lost three points apiece.

**Ruled: a spelling earns a canonical place only if it is both used across
publishers AND unlikely to occur as ordinary prose.** The locator decides what
is a stat block by counting how many labels a cluster carries, so a label that
is also an English word manufactures blocks out of room descriptions — and each
one then reads as a creature with a paragraph stuck to it. Books that really do
print those words as labels get them on their own profile, where a Judge has
confirmed what the page is. The measurement is what caught this; the reasoning
alone said promote.

**Ruled: a sentence that MENTIONS statistics is not a stat line.** Room text
quotes them constantly — "1d4 giant toads (AC 7 (12), HD 2+2 …) have hopped in",
"(Use normal goblin stats: …)". `isStatLine` now weighs density: a line of a
dozen words or more carrying fewer than three stat markers is prose. A real stat
line is nearly all statistics; prose is long and carries a handful.

**Note on the metric.** Coverage is a share of blocks FOUND, so a locator change
moves the denominator and percentages stop being comparable across one. The
density rule took the corpus from 1127 blocks to 1239 and from 1015 read to
1120 — a hundred more creatures importable, at 92% → 93%. Judge locator work by
the absolute count and grammar work by the share.

---

### Third-party books get shipped cookbooks (2026-08-19)

`docs/OSE.md` said the opposite in as many words — "a module cannot ship a list
of other publishers' books anyway" — and the whole OSE path was built on that:
a grammar that ships, sources that are registered per world and never shipped.

**Ruled by the IP reviewer: named third-party titles get full cookbooks,
shipped like the ACKS books.** The scope is the OSE Advanced Fantasy Referee's
Tome, the Dolmenwood Monster Book, and the Quick Delves, Wicked Little Delves
and Planar Compass series. The target is 100% coverage — geometry patches where
the grammar cannot reach, plus prose, tables, and art for creature entries —
and keyed locations become location actors as well.

The reviewer is the only one who can make this call: `ip-doctrine.md` says the
value rule needs a human, and this is that rule applied to whose books may be
recipe'd in public. Recorded here rather than assumed, because the shipped
posture now differs between the ACKS library and everything else only by who
authored it, and a later session reading OSE.md alone would conclude the
reverse.

**What does NOT change.** Structure ships and content is imported, exactly as
before: a cookbook carries boxes, anchors and citations, never values or prose.
Every number and every sentence still arrives from the reader's own copy at run
time. The IP gates are unchanged and still apply — `lint-register.mjs` caps and
`ip-scan.mjs` still refuse book text in tracked files, whoever published it.

**Ruled: an OSE cookbook entry supplies GEOMETRY, and the existing grammar does
the reading.** `kind.monster` is shaped for the Monstrous Manual's bold
label/value rows and cannot read an inline OSE stat line. Rather than a second
reader, an OSE entry names the box and the shipped `ose-statline.mjs` reads what
comes out of it — so the corpus-driven grammar and the hand-authored books
improve together instead of drifting apart. That is what makes 100% reachable:
geometry solves precisely the cases the locator cannot find, and the grammar
already reads 93% of what it does find.

### Silence is the failure a corpus-driven grammar cannot learn from (2026-08-19)

**Ruled: an unrecognised label ENDS the clause before it and is reported under
the word the page printed.** Previously only a KNOWN label bounded a clause, so
an unknown one fell inside its neighbour: the Dolmenwood line

    Att 2 hooves (+1, 1d4) Speed 80 Morale 7 XP 35

read as an attack whose text happened to run on, with `extra` empty. Every
measurement then called the block perfectly understood while its speed and its
morale sat inside an attack string, and the sweep that exists to find gaps
reported none.

The cost is measured and was worth paying. The Monster Book's honest score is
**11%**, not the 94% the sweep had been reporting — the 83 points between them
were entirely swallowed text. Three other books moved by a point or two for the
same reason. A number that only ever moves up is not a measurement.

**Rejected: widening the canonical labels instead.** That is the failure already
recorded under *A label that is also an English word cannot be canonical* —
"Morale" and "Speed" are ordinary English, and teaching every book to read them
manufactures stat blocks out of room descriptions. The boundary rule is narrow
on purpose: a capitalised word followed by a number, at bracket depth zero.
Attack text names its weapons in lower case and brackets its dice, so it does
not collide.

### Dolmenwood is a dialect and a lineage, not a spelling (2026-08-19)

**Ruled: `dmb` declares `profile: "ose.dolmenwood"` and `lineage: "dolmenwood"`,
and the lineage answers what a lone armour class means.** The Monster Book sits
on the OSE shelf and prints none of OSE's block: an ASCENDING armour class with
no bracket beside it, hit points as a die expression and its total ("HP 4d8
(18)"), one label per movement mode, an attack bonus inside the attack instead
of a THAC0 line, and Morale/Enc/Hoard for ML/NA/TT.

The armour class is why this could not be left to a profile alone. "AC 14" is
valid OSE and valid Dolmenwood and means opposite things; read with the wrong
lineage it converts five points away from the page and looks entirely plausible
on the sheet. So the grammar keeps reporting the first printed figure without
deciding what it is, `readAc` marks the block `bare`, and `LINEAGES` — which
already recorded a progression per family — decides. Reading dmb correctly took
it from 11% to 90%.

**Rejected: refusing dmb until a Dolmenwood importer exists.** Its saves, morale
and hit dice are B-X's; only four axes differ, and gap-and-flag already covers
what a dialect cannot reach.

### A harvested name is checked, and one picture belongs to one creature (2026-08-19)

**Ruled: the harvester emits a creature only when the name and the art can be
defended, and reports the rest for hand authoring.** Both defaults were wrong in
the same direction — they produced output that looked complete.

*Names.* The nearest display heading is not always the creature's. A bestiary
that sets descriptive prose large gave actors called "And Bony Claws. Servants
of Grim, Forgotten Gods, Doomed t" — 87 of dmb's 166 rows. A keyed adventure's
nearest heading is the ROOM, so Quick Delve monsters were named "13. Hallway".
Now the name comes from the block itself, else a RUN-IN LABEL in the block's own
column (calibrated against the surrounding prose height, because these books set
a stat block SMALLER than the paragraph describing it), else the display
heading — and a name that reads as an area key or a sentence is refused.

*Art.* Each illustration goes to the block nearest IT, not each block to the
illustration nearest itself. The second rule gave one picture to every creature
on the page: 81 distinct images covering 224 assignments in aft, `img_p23_1`
shared by acolyte, amphisbaena, ankheg and ape. Matching image-first leaves
creatures the page never illustrated with no art, which is correct.

The cost is fewer rows — dmb 166 to 79, and 120 of 483 entries carry art (25%)
rather than a nominal 66%. A wrong name is the first thing a Judge reads and the last thing
they think to check; a missing one is a gap a human closes in a minute.

### Saves go in under the names the SYSTEM has, not the ones ACKS II is moving to (2026-08-19)

**Ruled: the binder renames converted saves to whatever the target schema
actually declares, and the converter keeps emitting the ACKS II names.**

Found live, and unfindable offline. The converter emits `blast` and
`implements`; release `acks` 14.0.1 still calls those saves `breath` and `wand`,
and a Foundry `SchemaField` DROPS a key it has no field for — without an error,
a warning, or a trace. Every OSE creature imported against that build arrived
with four of its five saving throws, and the fifth was gone before the document
existed. No mocked check could see it, because the mock has whatever fields the
test gives it.

The rename lives in the binder, not the converter: the converter stays free of
Foundry, and the choice is made where the live schema can be read. A build
carrying the new name is written under the new name, so this expires by itself
instead of becoming a permanent alias. Every path that writes a document goes
through the one helper — a generator would otherwise drop the save once per
creature it stamps.

### A creature stated across a range is a generator, not a creature (2026-08-19)

**Ruled: a block printing "HD 3 to 8", or a series of blocks printing one step
each, becomes an `acks-extras.template` actor.**

Eleven Referee's Tome entries print a range in one block; twenty-one Dolmenwood
retainers print a block per level. Read as single creatures the first kind
arrives as the WEAKEST member of its own kind — a three-hit-dice ankheg, with
the other five steps leaving no trace — and the second arrives as three
unrelated monsters that happen to share a name.

The family already had the right document. `acks-extras.template` was built for
the Monstrous Manual's four varies-by-rank entries, and a varies-by-hit-dice
entry is the same shape, so this uses it rather than inventing a second
mechanism. The two routes differ in what they must prove:

- **Several entries, one axis.** Nothing is derived: every option carries its own
  printed block, fully converted. Grouping is declared in the register
  (`meta.templateGroup`), derived from the entry NAME this tool wrote — never
  from the page, which says nothing about grouping.
- **One entry, a printed range.** Each step's hit points are printed and are
  transcribed. The attack throw is printed only at the two ENDS, so the steps
  between are filled ONLY when the bonus divides evenly across the range — the
  book's own table restricted to those rows. Where it does not divide, the
  middle of the range carries no throw at all and the gap says why. A plausible
  straight line through unprinted figures is invention wearing arithmetic's
  clothes, and refusing is the whole reason this is safe to ship.

### A caption is furniture, and 276 identical warnings hid thirteen real ones (2026-08-19)

**Ruled: residue triage drops the caption line that labels a claimed box, and
`compileMonster` gains the `descColumns` and `skips` assists the AX path had.**

The Monstrous Manual compiled with 289 residue warnings. 276 were the same
thing — "Amphisbaena Primary Characteristics", the line naming the stat column
under it — which binds nothing and is furniture exactly as a running head is.
Behind them sat thirteen entries where real PROSE was going unclaimed, including
one whose description was missing 88 items because it spilled into a second
column the single-column prose model never looked at.

Only ONE line per band is dropped, and only a line lying wholly inside it: a
paragraph the boxes genuinely missed runs to several lines and still warns,
quieter by its first line and never silent. `descColumns` is authored per entry
rather than detected, because everywhere else in the book the next column holds
the stat block and a rule that guessed would claim it.

Warnings went 289 → 0. The number that mattered was never 289; it was the
thirteen nobody could see.

### The book connectors are one surface, and a folder is a group (2026-08-20)

**Ruled: Book Status, the join-time reconnect offer, and on-demand reconnect
all open a single Books dialog; the separate Reconnect macro is dropped from
the pack; the Connect dialog gains a parent-folder route; and every shipped
macro runs behind the same two guards with a unique in-folder sort.**

The four "Your Book" macros had four surfaces: a walkthrough window, a form
dialog, a toast-or-dialog, and a console dump behind a toast that said to go
read the console. A reader could not tell from the macro list which button
would show them anything — the reported symptom was an X drawn over Reconnect
and a line under Book Status. Status and the control that changes it now share
one dialog: every book renders a row (open / remembered / absent), remembered
rows keep their per-gesture Unlock/Retry/picker controls, absent rows hand
over to Connect, and the refresh-bridge state prints on the dialog instead of
only the console. `api.reconnectBooks()` survives for old worlds' imported
macros and opens the same dialog after retrying the silent pass.

The folder route answers the group case the per-file rules cannot: picking the
folder that holds the PDFs self-identifies every book inside (evidence-only
matching — remembered name, size, title-in-filename; the connect dialog's
positional fallback never runs against a folder, because a folder full of
adventures must not have one dealt into an empty slot). On File System Access
seats the directory handle is remembered under a reserved store key, so next
session ONE permission gesture re-grants the whole shelf — the per-book
gesture rule binds file handles, not directories. Elsewhere a
`webkitdirectory` input scans the same way and falls back to name-only
records. Unrecognised PDFs are counted, named on the console, and never
warned about — in a folder they are the normal case.

Macro commands were also normalized: every macro runs its api function behind
the same ready-guard and exists-guard (older module builds get "needs a newer
build", not a TypeError), and the Import folder's duplicate sort keys (two
220s, two 230s) — which rendered in load order, i.e. no order — are unique
again. Remove ALL Imports now also sweeps the rules-table documents the
ruledata provider materialized (contract v1.3, ACKS Extras): documents only,
counted in the confirm; the imported table DATA stays registered, because
removing documents is a tidy-up, not an un-import.

### A picture is pointed at, not reasoned toward (2026-08-20)

**Ruled: an entry POINTS at its illustration — page, XObject name, box — and the
harvester decides which entry a picture belongs to once per page, by
containment.**

Proximity was tried twice and was wrong both times. Measured per creature, it
handed one bestiary picture to every creature on the page: 81 distinct images
covering 224 assignments in the Referee's Tome, `img_p23_1` shared by acolyte,
amphisbaena, ankheg and ape. Measured per picture, it ignored which COLUMN the
picture was in and gave a Rhagodessa's portrait to a Robber Fly two columns
away. A picture standing inside an entry's own region is that entry's, regions
do not overlap, and what is left over goes to the nearest entry that still has
none — no tie-break, and nothing claimed twice.

**What actually held coverage down was not matching at all.** The Monster Book
prints one creature to a page with a full portrait beside it — 123 illustrated
pages — and only 17 had produced an ENTRY. The pictures were never hard to find;
the creatures were, and the missing art was the symptom. Two page-geometry
faults were behind it, both recorded in the harvester: a bestiary that sets its
opening description large enough to read as a heading, so the nearest heading
over a block is flavour text and the real title sits above it; and a region
whose span ends exactly at the next column's edge, where an inclusive skip test
passed over the column the art lives in. 79 entries became 165, and art went
from a quarter of the corpus to better than a third.

The lower size bound came down with it. Containment does the real work — an
ornament must stand inside a creature's own entry AND be the largest thing there
— so the stricter bound was discarding more than half of what one book holds.

### A keyed room is a place, not a page of prose (2026-08-20)

**Ruled: `kind.oseLocation` binds to an `acks-extras.location` actor, and the
adventure becomes a location the rooms nest inside.**

The obvious binding is a journal page. A place in this family is an ACTOR — it
has a parent it sits inside, a roster of what lives there, contents, and
optionally a market — and a room imported as prose can never grow any of that.
The Judge who later wants the storefront to hold the goods it sells would have
to build a second document and keep the two in step by hand. So the room arrives
as the thing a room is, and its text arrives as every imported text does: a lazy
tag against the reader's own copy.

Locating them needs no grammar and no confidence rules, which is why
`harvest-ose-areas.mjs` is a separate tool rather than a mode of the creature
harvester: a keyed area announces itself with a number and a full stop, and a
heading that is not numbered is not one.

**Two anchoring faults, both found by RUNNING the compiled entries rather than
reading them.** An area title is regularly split across runs ("5." then "The
Docks"), so testing one item's prefix found nothing — headings are matched as
headings now, joined from their runs. And two areas are regularly titled side by
side, so a box spanning the whole baseline reads as one run-on heading matching
neither; the expect box is the heading's own column. The second failed at
IMPORT rather than at compile, which is the worst place for it: the entry looks
authored and quietly imports nothing. Five of seventeen in one book became zero
of a hundred and seventeen.

Wicked Little Delves ships no areas. It keys its rooms another way, and a tool
that guessed would invent areas rather than find them.

### Staging is a property of the world, so it must not cost a seat-local connect (2026-08-24)

**Ruled: any book can be put on the server from its own row or from a picker in
the shelf band, whether or not that book is open on this computer.**

"Add to server" was offered only on a book already OPEN this session, because
the file has to be read before anything can vouch for what it is. True, and it
put the control on the wrong side of the work: a GM with nineteen PDFs on disk
and a fresh browser saw a shelf band with nothing in it and nineteen rows with
no way to stage anything. The reported symptom was "no button on most rows" —
the button was on the two rows that happened to be open.

Reading first is kept; what changed is WHERE the reading happens. `stageFile`
reads the picked file here, lets `ingestBook`'s fingerprint refuse a wrong one,
and only then uploads — so the guarantee is now stronger than it was: nothing
reaches the server before it has been identified, where the open-book route
uploaded first and read back after. The read-back is dropped for a caller that
fingerprinted the bytes it is sending (`verified`), which also takes a
hundred-megabyte re-fetch-and-reparse off every use of the original button.

**Found while shipping it: Foundry refuses to overwrite a non-media file.** The
upload of a name already taken fails the whole request — so a shelf staged
once could never be re-staged, and the reader was told "the upload did not
complete" over a book that was sitting on the server the whole time. A taken
name is now answered by reading the copy already there and staging it if it is
that book, which costs nothing and is the outcome the reader wanted; a file
that is a DIFFERENT book is named, with its path, rather than silently adopted.

**The shelf copy is always `<bookId>.pdf`.** One name per book is what makes
"is this book already up there?" a question with an answer, it is the name the
scan's first pass already reads, and the directory is the module's own.

**Rejected — matching picked files by an exact id stem.** The bulk picker takes
the reader's own filenames and matches them on evidence only (a remembered
name, a size this seat has seen, the book's title in the filename), leaving the
id-stem pass confined to the shelf directory where the module controls the
naming. A file that names no book is reported by name and left alone; its own
row takes it in one pick, which is the strongest evidence in the window.

### An authored entry is an identity, and that is what puts the OSE books in the import (2026-08-24)

**Ruled: an import from an authored book stamps the ENTRY id on what it makes,
and "import everything" gains an OSE step that walks every authored book the
seat has open.**

`importOseBook` and `importOseAreas` were on the api and on nothing else — no
macro, no button, no step. The module's one import control therefore walked
past about seven hundred authored entries in books it had just read, and the
only way to reach them was the console. A shipped cookbook nobody can reach is
a cookbook that does not ship.

Wiring it in needed an identity first. The OSE binding stamped
`<bookId>.p<page>`, which is not one creature: Dolmenwood prints up to nine on
a page. So an authored import passes its entry id — `aft.woollyRhinoceros`,
`qd3.area5` — and the page-derived id stays only where there is no entry to
name (the registered-source and by-hand paths, which a Judge drives one block
at a time and which stay undeduplicated rather than deduplicated WRONG). A
generator built from several entries carries its group under its book,
`dmb.group.bard`, because group keys are bare words — "bard", "cleric" — that
repeat from book to book. The adventure a book's rooms nest inside gets
`<book>.adventure`, so a second run nests its rooms under the dungeon already
there instead of building a second one beside it.

**The presence check is taken BEFORE the page is read, not before the write.**
Every entry costs a page render and a parse, and this now runs inside a chain a
Judge re-runs over a world that already holds the books: asking after the read
would pay for six hundred creatures to decide it wanted none of them. Measured
on this library: 643 documents in 41 seconds the first time, 0 in 1 second the
second.

**Rooms and adventures gained the same `cookbook` flag every other import
writes.** They had only an `ose` flag, so nothing could ask whether a room was
already imported. Their removal never depended on it — imports live in the
module's own compendia and those are deleted whole — but identity did.

### A book the server holds is never bridged (2026-08-24)

**Ruled: `connectBookUrl` takes `bridge`, and the shelf passes it false.**

The refresh bridge exists for a file this seat cannot reopen without a gesture.
A shelved book is refetched on every join with no gesture at all, so bridging
one buys nothing — and the shelf is the case where the cost is real: seventeen
books, better than half a gigabyte, written into this seat's storage at every
single join, for reads that were never going to ask the reader for anything. It
is also what pinned the renderer for the first minute of a session.

The open-book **Add to server** button asks the server before it asks the
bridge, which is why dropping those bytes costs nothing: a book whose copy is
already up there is staged from that copy, and only a name that is free needs
bytes from this seat at all.

### A window whose bands are a snapshot has to be built again (2026-08-25)

**Ruled: every change to the shelf closes the Books window and opens it again,
carrying its report into the new one.**

Staging a book wrote the world setting, updated the row it was pressed from,
and left every other band describing the world as it was when the window
opened. A GM who staged thirteen books through the new picker therefore saw
"On the server" still listing the six it had at open, thirteen rows in ANOTHER
band claiming to be read from the server, and — because the scan counted a file
whose book was already staged as a file that matched no book — "nothing new to
stage: 19 PDF(s) there matched no book" over a shelf that was completely full.
Every one of those is the same fault, and patching rows one at a time is how it
happened: the bands are derived from world state, so the honest refresh is to
derive them again.

The report travels as a `notice` rather than dying with the old window, because
the thing worth keeping from a staging run is exactly what it could not name —
the files that matched no book.

**`close()` must be AWAITED before the reopen.** The window is a singleton
keyed on being open, so an application asked for while the last one is still
closing is answered with the one going away — the first cut of this closed the
window and opened nothing, which is worse than the bug it fixed. Found in the
live run, not in review.

**A full shelf collapses behind its count**, like the book groups below it. A
reader who owns nineteen books had them listed twice in one window, and the
controls under the first list were a scroll away.

### The anchor is not advice — it decides whether a page is written (2026-08-29)

**Ruled: any path that materializes a document from an executed entry consults
`ok` first, no exceptions.** `cookbookImportJournals` was the one that did not:
it asked for the anchor and then read `node.fields` regardless, so an entry
whose heading no longer framed its box wrote whatever prose occupied those
coordinates — under the room's own name and its own citation, which is a page
nothing downstream can distinguish from a good one.

The failure is not hypothetical and not confined to a moved printing. A file
that fingerprints as no book in the registry is accepted into whatever slot it
was picked for (`identifyBook` can only refuse a file it recognises as another
book), so a mis-picked PDF reaches every entry in that book. That is the field
report this came from: a proficiency whose page rendered Judges Journal prose
under an RR citation, on a seat whose RR slot held the JJ file.

The same hole existed once before and was reached by readers rather than by
imports — `cookbookProse`, the lazy `@PdfText` reveal, took
`res.fields.description` with `res.ok` unread. It died with the enricher in
4.0.0, which is why this one survived alone: the invariant was being kept by
twenty call sites and broken by one, and nothing states it in a place a new
call site has to pass.

**Rejected: refusing the wrong file at connect instead.** Fingerprinting cannot
tell a stranger from a printing this build has not seen, and hardening it into a
refusal would lock out every legitimate edition drift — the registry's page
counts are a warning surface on purpose. The anchor is the check that knows what
it is looking at, and it is per-entry, which is the granularity the answer
actually has.

**The empty container stays.** A book whose every room refuses still leaves its
journal behind with no pages. That is honest — the shelf says nothing was
imported — and a later good run fills it. A page of wrong prose was the defect;
an empty journal is not.

### The weapons grid prints three types, and ammunition is not a weapon (2026-08-30)

The grid on RR ch.4's weapons page files four rows under **Ammunition** — the
bolt case, the arrow quiver, the silver arrow, the sling stones — each with an
em-dash where every weapon carries a die. `extractValueRows` had read that type
since the recipe was written and `extractWeapons` dropped it when it attached
the canonical names, so all four materialized as `weapon` documents.

That type cannot hold one of them. It has no `quantity` field at all, so a
bundle's count could only live in its name, where the ammunition tracker cannot
spend it and the sheet cannot show it; and its `damage` field defaults to a die,
so a case of bolts arrived as something to swing, listed among the weapons, with
neither `melee` nor `missile` set. A field report described it exactly: "came in
as a case, but with 20 bolts as a name".

**Ruled: an Ammunition row materializes as inventory.** That is also the shape
the rest of the family already assumes — `isAmmoItem` and `canBeSilvered` in
acks-extras both read an `item` — so this removes a divergence rather than
creating one.

**Two shapes, because the grid prints two.** A row whose printed name names a
carrying device is that device, and its load rides on the `ammo` flag to be
minted when the device reaches an actor; a row that is bare units is a stack of
them. Whether a name is a device is the equipment root's question — it owns the
gear profiles that answer it — so it is asked at import rather than restated
here.

**The catalogue holds ONE document per priced row.** Minting the case and its
bolts as two catalogue documents was rejected: RR sells the pair as one priced
line, `containedIn` is an actor-embedded relation, and a class template copies a
single base document, so a paired catalogue entry would arrive on a character
with its contents left behind on the shelf. Recording the load and filling the
device at the point of grant keeps one document per row and puts the pair where
it is actually carried.

**A loaded device carries the printed encumbrance whole; a bare stack divides
it.** RR counts a bundle as one item however full it is, so a case that weighs
its 1/6 st whether it holds twenty bolts or three is the printed rule, and it
keeps encumbrance from drifting mid-combat as shots are spent. A bare stack has
no device to hold that weight, so the printed figure is divided across the units
it was printed for and `quantity` multiplies it back exactly — `weight6` is a
plain NumberField, so the fraction survives.

**The repair deletes rather than migrates.** A document's type cannot be changed
in place, so `repairAmmoWeapons` removes the `weapon`-typed ones and the same
run re-creates them — the `repairAnimalItems` pattern, with the same guard: only
documents carrying our own `generated` flag are touched, so a Judge's hand-made
case is never deleted. A class template's copy carries no importer stamp and is
not reached from here; acks-extras re-derives those with its packages.

The container model this feeds — a case that actually holds its bolts, and what
a loaded device's capacity is — is ruled in acks-extras
`docs/equipment/DECISIONS.md`, which owns it.

### A printed class power is an award, and nothing offline was asking (2026-08-30)

**Problem.** A field report said the Dwarven Excavator imported without Expert
Caving, Loadbearing and Mine Working — three of the four powers printed under
its own Starting Class Powers heading. The class's register entry simply never
named them, and an award that is not named imports as nothing at all: the class
document carries no row, the sheet shows no gap, and the omission reads exactly
like a class that has no such power. Nothing offline compared what a spread
prints against what its register awards, so the only detector was a Judge
reading the book beside the sheet.

**It was not one class.** Auditing all thirty-one found seventeen powers missing
across eight of the ten By This Axe classes — every one of them a starting
power, and every RR class clean. The dwarven chapter was authored from its
progression tables and its additional-powers section; the Starting Class Powers
column was read for some classes and skipped for others.

**Ruled: the audit is the gate, not the prose.** `tools/dev-award-scan.mjs`
reads every class's own pages through the shipping extractor, reconstructs each
run-in label, and reports the ones no award ref accounts for. A clean run is
zero, so it is runnable after authoring a class rather than only when a report
arrives. Labels that introduce structure are filtered by name; labels that name
an OPTION are filtered by an explicit per-class list, because the alternative —
a scan that always reports the same twenty residues — is a scan nobody reads.

**Ruled: what a reader PICKS or ROLLS is not an award.** The Earthforger's four
sigils, the Rhetor's rhetorical effects, the Sporecaster's optional powers and
the table it rolls on when it takes one, and the Warlock's corruptions are all
printed as run-in labels beside the powers, and none of them is granted. The
Earthforger's sigil already had the shape this needs — a `choice` award over
named refs — and the others are left unauthored rather than turned into grants
that a class does not have.

**Ruled: a proficiency-equivalent power is the proficiency, only where the
spread says so.** The Excavator's Expert Caving and Mine Working, and the
Pugilist's Combat Trickery and Endurance, each close with the sentence that
names the proficiency they equal, so each awards that `def.prof.*` with the
printed name in its note — the shape the Delver already shipped. The Pugilist's
Combat Trickery was nearly authored as a power of its own on the reasoning that
it obviously *is* the proficiency; the sentence at the end of the paragraph is
what settled it, and reading to the end of the paragraph is the rule.

**Cost.** Three powers had no definition to arrive as at all — the Earthforger's
Extemporaneous Invocations, the Rhetor's Linguistics, the Sporecaster's
Conventional Brewing. Two of the three ran on into their class's progression
tables, because a run-in that reaches the foot of the last column continues
overleaf; both carry `assists.descStopY`, which is the assist that gates both
the column flow and the page flow.
