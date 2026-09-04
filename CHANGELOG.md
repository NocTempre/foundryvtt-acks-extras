# Changelog

## 6.4.2

**A book on the server is a journal.**

### Changed
- **Every book staged on the server is now a journal in the world.** Look in
  the Journal sidebar under *Your Books*: one entry per book, holding a PDF
  page — open it and press *Load PDF* to read the book inside Foundry from any
  GM seat, and share it with a player the way you share any journal. That
  journal is the record of the book: delete it and the book is no longer read
  from the server; the Books window's **Remove** does the same, and each row
  there gains an **Open** button. The file itself stays where it was put. A
  world that staged books before this carries them across the first time a GM
  loads it, and says how many.

### Fixed
- **A weapon proficiency can now say what the book says.** The ability sheet's
  Weapon Proficiency boxes offered the seven weapon groups and nothing else, so
  a class trained in every missile weapon, or in melee weapons up to a size,
  had nowhere to put it and the Training strip lit nothing for the words typed
  in. The boxes now carry the whole grant vocabulary — *Any weapon*, *All
  missile weapons*, one box per melee size, the seven groups — and a tick
  stores the same token the class training and the equipment rules already
  read, so the strip and the Stats tab light every class a pick covers. A
  single weapon typed by name stays as typed: a box is a whole group, so
  "sword" is the one weapon and "swords" ticks the group, and a phrase the
  boxes recognise is stored as its box on the first save.
- **The Class modifiers editor no longer destroys a size- or missile-based
  grant.** For an imported class trained by size and missile it showed every
  weapon pill dark, and the first click rewrote the grant to that one class.
  Pills now light for every class the grant covers; switching one on appends
  it and leaves the printed clauses as written, switching one off rewrites
  the grant as the explicit class list without it — which loses the size
  limit, as the section's own rule for *all* always has; re-applying the class
  restores the clause.

## 6.4.1

**The system's windows open from the new sheet again.**

### Fixed
- **Generate Scores, Modifiers, Tweaks and Mortal Wounds reported "could not
  be reached" from the character sheet.** The sheet reaches those windows
  through the system's own sheet class, and read its action handlers off one
  class's declaration; the system keeps Tweaks on its base actor sheet and
  the other three on the character sheet that extends it, so whichever half
  was read, the other half was missing. The handlers are now gathered down
  the inheritance chain the way ApplicationV2 itself gathers them, and all
  four windows open.

### Changed
- **The class picker says when a class holds no starting packages.** A class
  document without template rows — one imported before the importer wrote
  them, or hand-made — offered only "no starting package" and the sentence
  about the package being optional, which read as the sheet withholding
  them. The template box now carries the generator's sentence for that case,
  naming the class document as the reason. A fresh class import writes the
  rows; a world whose classes predate them updates through
  `acksExtras.importer.cookbookUpdateClasses()` (a Judge's hand edits with
  it) or by removing the imports and importing again.

## 6.4.0

**A character sheet of the module's own, and it is the default.**

### Added
- **The character sheet.** Every character now opens on the module's own
  sheet: the title band in the window header with the class glyph, the level
  title and an XP bar that goes gold at the threshold; the portrait between
  two rails — Influence and the five saves on the left, hit points, armour
  class, movement, the grip, the light you see by and the party on the
  right — with a condition riding on the save that clears it; and tabs
  organised by play: Rolls (every throw with its target, the wielded weapon
  ringed), Abilities, Equipment (every wear slot a drop target, containers
  with their capacity bars, what is kept elsewhere), Stats (attributes,
  training opened to individual weapons, movement, vision, vitals and the
  throw targets), Class (the level-up preview and wizard while the bar is
  full), Magic for a caster, Followers as Follower Cards, Notes, and Effects
  (timers with their bars, riders, resources, modifiers). The chevron before
  the tabs folds the sheet to a table card with the starred rolls, timers
  and counts along the bottom; the fold is remembered per viewer.
  **The system's own sheet is untouched and still registered** — Sheet
  Config switches any actor back, and everything this module adds to it
  keeps working there. Nothing is migrated: both sheets read and write the
  same fields.
- **The party cell.** The last cell of the right rail is the character's own
  party: how many of their henchmen are on the scene as a figure and each
  summon present as an asterisk (`1**` is one henchman and two summons),
  red while any henchman is down with a calamity pending. Clicking lists who
  is here — a pick selects the token and pans to it — with the roster, the
  Followers tab, and for an owner the binding of the controlled tokens as
  this character's summons and their release. While the character marches
  in a formation whose party token is on the scene the cell is that
  formation instead, counting its members present, and opens the party
  sheet.

### Changed
- **Three sheet injectors stand down on the module's own sheets.** The
  casting strip no longer falls back to the window's frame header on a
  non-core sheet, and the Storage tab and the roster header button dress the
  system's sheet alone; the new sheet places the same builders itself.

## 6.3.0

**Page references stay; the figures printed beside them go. Swimming names the
figure it is missing instead of guessing zero.**

### Changed
- **Twenty-one henchmen hints and messages stop quoting numbers off the page —
  and go on pointing at it.** "Cumulative −1 per prior attempt the candidate
  rejected (RR 162)" now reads "Cumulative penalty for each prior attempt the
  candidate rejected (RR 162)": the modifier's size is gone, the reference is
  not. The same for the henchman cap's formula, the weekly split of a town's
  hiring pool, the loyalty adjustments on the chat cards, the officer's command
  limit and the level followers arrive at. Each still says where to read the
  rule, so the figure is a page-turn away rather than printed in your tooltip.
  Nothing moved, nothing was renamed, and no setting changed.
- **Swimming takes its figures from what you have imported.** The swimming
  bonus, the share of your speed you swim at, how far a stone of gear sinks you
  and how long you can hold your breath all arrive with your own books now.
  Import them and the throw resolves as it did. Import nothing and each reads
  as unknown — the throw names the figure it is missing rather than standing in
  a zero and handing you a number that looks calculated. Calm water is the
  exception and stays zero, because no water is the absence of a modifier
  rather than a figure someone printed.

  **If you script against it:** `swimmingBonus()`, `swimSpeedShare()`,
  `sinkFeetPerStone()`, `breathRounds()` and `waterModifier()` return `null`
  where they used to return a number, and `swimmingThrow()` returns a null
  `target` with the missing keys listed in `unknown`. Check for `null` before
  doing arithmetic.

### Internal
- **The leak check stops failing on a page reference, because that had the harm
  backwards.** A citation reproduces nothing — it only pays out to a reader
  who already owns the book — so it is the one thing in a shipped string that
  is always safe, and stripping it from a paraphrase leaves the paraphrase and
  loses the attribution. The check now decides file paths and pasted copyright
  notices; whether a string quotes the book's words or its numbers is a review
  question and is written down as one.

## 6.2.0

**Importing tells you where it has got to, the library is read before it is
judged empty, and two printed tables stop shipping.**

### Added
- **Import Everything shows one progress bar for the whole run.** Five of its
  thirteen steps drew nothing at all, so a long import could sit silent for
  minutes with no way to tell work from a hang. The new bar names the step
  running and counts steps done, beside whatever each step already draws for
  itself. It works the same whether you start the import from the Getting
  Started panel or from the hotbar macro — the macro had nothing before. It
  counts steps rather than items because several steps cannot know how much they
  hold until they begin, and it never invents a number it does not have.

### Fixed
- **The class picker no longer says your world has no classes while it is still
  reading them.** Opening it in the first seconds of a session could report an
  empty world; dropping a class onto a sheet in that moment could open the
  window bound to a *different* class than the one dropped. Both now wait for
  the library. The same wait was added where a pending choice offers its
  options, and to the two startup passes that read the library — one of which
  could create a duplicate of a language it had not finished loading.
- **A class binding applies what the page was showing.** Choosing a starting
  package answers some picks itself and takes them off the page, and the
  Intellect bonus picks only appear once a package is chosen — but answers given
  before that change were still applied on save, granting proficiencies the page
  had stopped asking about. What closes now applies what was offered.

### Changed
- **No compendium is hidden any more.** The setting that folded away ACKS system
  compendiums once you had imported your own content is gone, along with the
  code behind it. It had not worked since 6.0.0 — it counted imported documents
  in the wrong place and hid nothing — and rather than switch it on for the
  first time and have eight shelves vanish from your sidebar, the whole idea is
  withdrawn. Which of the system's shelves you see is not this module's call.
  Nothing was ever deleted or unlinked by it, so there is nothing to restore.
- **The influence attempt ladder and the henchman wage ladder come from your
  own books.** Both were printed tables shipped inside the module. They are now
  read from what you import, like every other table in this family. Until they
  are imported the attempt selector names each attempt by its number instead of
  its time cost, the attempt counter is not capped, and the bribe fee is left
  blank for you to fill in.
- **A carried body's weight and the rest cadence likewise.** The same figures
  were held in two places at once; now they have one owner and arrive with your
  books. Until imported, the party clock counts turns without calling for rest,
  and a rescue load reads as unknown rather than as nothing.

## 6.1.3

**Importing again repairs what it did not create, and the library stops
overlooking half its own shelves.**

### Fixed
- **A description showing `@PdfText[...]` can be repaired.** Import creates
  documents and steps over the ones already in your world, so a description
  written by an older version kept its placeholder however many times you
  imported the book again. *Import Everything* now finishes the abilities step by
  refreshing them, which is also the only path that reaches an ability living on
  a character — *Delete Everything Imported* never looks inside an actor, so a
  proficiency on a player's sheet could not be repaired by any means you had.
  A description you have written in yourself is still asked about before
  anything replaces it.
- **An entry whose book is not open is left alone, instead of losing its text.**
  Refreshing an ability while its book was disconnected rebuilt it from nothing
  and wrote the result: the paragraphs became a bare page citation, and the
  mechanics that are read out of the book's own words — a proficiency's effects
  among them — came back empty. Nothing is read, so nothing is rewritten; the
  report says how many entries were passed over and why.
- **Classes and items from a third-party book are visible again.** Anything
  imported from a book shelved under its own line — Dolmenwood, Old-School
  Essentials, Quick Delve, Planar Compass, Wicked Little Delves — was written to
  its own compendium and then never read back, because the reader recognised
  only the shelf the ACKS books use. Every part of the module that asks "what has
  this world imported?" now sees all of them. Where an ACKS document and a
  third-party one share a name, the ACKS one still answers first.
- **Character creation no longer comes up blank when it is opened early.** The
  imported library loads in the background, and a generator opened in the first
  seconds of a session could see no classes yet. It gave up at that moment and
  core's page never renders itself again, so the window stayed empty until it was
  closed and reopened. It now waits for the library before concluding there is
  nothing to show.
- **The template menu says why it is empty.** A class that prints no starting
  packages left the menu closed while the note beside it asked you to roll the
  template die — a roll that could not open it, and neither could a Judge's
  override. The note now names the real reason, and the die and the override are
  still asked for when they are genuinely what is missing.
- **A build without a package no longer follows the Judge's override down.**
  Ticking *build without a package*, then lowering the override, left the page
  offering packages again while the save still applied the earlier tick — a
  character finished with a class, no starting package and no gold, from a page
  that had shown the opposite. What closes now applies what the page offered.

## 6.1.2

**The Melee and Ranged buttons are the quick roll they look like.**

### Changed
- **The Melee and Ranged boxes show the attack throw and your stat, and nothing
  else.** They name no weapon, so they answer for the character: the throw your
  class and level give you, plus the attribute that throw keys on — the two
  numbers a table needs to roll off the cuff without modelling its equipment in
  Foundry. A weapon's own bonus, anything worn, and fighting-style bonuses are
  deliberately not folded in; the weapon's own roll applies all of those exactly,
  and a summary carrying some of them would disagree with the dice. Clicking the
  button rolls the same figure the box shows, and the tooltip says what is left
  out. Melee and Ranged stay separate, as they always were.
- **Melee names Dexterity where Weapon Finesse applies.** The box, its tooltip
  and its roll all key on whichever attribute the character actually uses —
  Dexterity when Weapon Finesse allows it and Dexterity is the better of the two,
  Strength otherwise. The better one replaces the other; the two never add.


## 6.1.1

**The attack boxes state what this character can actually reach.**

### Fixed
- **The Melee and Ranged boxes on the character sheet show your best.** They
  name no weapon, so they now answer the question a summary is asked: what does
  this character hit on, with gear they are trained for. Melee takes Dexterity
  in place of Strength where Weapon Finesse allows it and Dexterity is the
  better of the two, and both boxes include a fighting-style bonus you are
  trained for but are not holding the weapons to collect right now — a
  Specialization on a style you have put down, the second weapon you are not
  currently wielding. Picking that gear up does not add the bonus twice: the
  boxes only ever show the difference between what your gear earns now and the
  best you could earn, so the number is the same either way. The tooltip names
  which attribute the figure came from.

## 6.1.0

**Training you added after the fact counts, and a proficiency stops charging you for owning it.**

### Fixed
- **A fighting style you add after building the character now counts.** The
  Training row and the Worn & Wielded line beneath it were answering from two
  different places, and only one of them could see a style recorded on a
  proficiency you dropped on the sheet yourself. So the style lit up in the
  badge row while the line under it read *untrained style* — and that was not
  cosmetic: the character took the full non-proficient penalty on every attack,
  and lost the Dexterity bonus to Armour Class, for a style the sheet said they
  had. Both surfaces read one answer now. It looked like a timing problem
  because applying a class writes the training a second way, which the line
  could always see — that is why a character built in one sitting worked and the
  same character edited afterwards did not.
- **Weapon Finesse no longer trades a good Strength for a worse Dexterity.** The
  substitution applied whenever the two scores differed, in either direction, so
  a strong and clumsy character with the proficiency attacked *worse* than one
  without it. It is an option the character takes, so it applies only when it
  helps. It has always replaced the Strength term rather than adding to it, and
  still does.
- **A weapon's sheet names the attribute its attack throw actually uses.** The
  *Granted while equipped* panel always said Strength, even where the roll had
  been re-keyed to something else, and it folded attack and damage into a single
  line. They are separate lines now, each naming the attribute in force.
- **A monster's bow spends its arrows.** Ammunition was deducted only for an
  attack the game marks as a missile attack, and a monster's attacks never carry
  that mark — so no monster ever used a single arrow. A monster's melee weapons
  are untouched: not consumed, and not put down.
- **A monster's proficiencies are reachable again.** A fighting-style, weapon or
  armour proficiency on a monster was hidden from its card on the grounds that
  the training strips would carry it, while the strips declined to draw anything
  for a monster at all. The item was there and nothing rendered it, so its
  options could not be picked.
- **Every harvestable part imports, whatever it weighs.** One of the two copies
  of the same parsing rule required a whole number of stone, so a part weighing
  a fraction of one was dropped without a word. There is one copy now.
- **Windows scroll instead of cutting themselves off.** Foundry caps a window at
  the height of your screen, and past that the content was simply gone with no
  scrollbar to say so. Nineteen windows that sat outside this module's scroll
  handling are inside it now, and the character sheet — whose frame belongs to
  the game system — scrolls its open tab rather than clipping it. The item sheet
  also fits a narrower screen.
- **Changing a field no longer throws you back to the top.** Four sheets asked
  to remember your scroll position in a way that could never work. They remember
  it now.

### Changed
- **A monster's Armour Class says where it comes from.** It is the number typed
  on the header, and nothing a monster carries changes it — armour in a
  monster's inventory is carried, not worn. The Inventory tab's hint says so,
  and the guide lists that tab at last.


## 6.0.2

**The system gets its own shelves back, and the library can be put back.**

### Fixed
- **The game system's compendiums are in the game system's own folders again.**
  This module used to gather all thirteen of them into its own *ACKS II* folder
  at every load. The system declares five shelves of its own — a Rulebook, a
  Revised Rulebook with Equipment and Setting beneath it, a Judges Journal, a
  Monstrous Manual and VTT Vitals — and in a world that had run this module,
  every one of them stood empty. Each package's compendiums now go where that
  package's own manifest says, and this module stays out of the system's tree.
- **A compendium stranded at the root of the sidebar finds its folder.** Foundry
  files a pack once and skips any pack whose configuration already names a
  folder — so a folder you deleted years ago left every pack that named it
  stranded, permanently, with nothing able to fix it. Those are repaired at
  every load now. A folder you put a pack in yourself is never touched.

### Added
- **Restore the Compendium Library (GM)** — a new macro in the *ACKS Extras
  Macros* compendium. It puts the whole library back: the system's packs into
  the system's shelves, this module's and everything you have imported into
  *ACKS II — Extras*, and each pack's ordering, lock and player visibility back
  to their defaults. It asks first, because it overwrites arrangements you made
  yourself — that is what makes it a restore rather than the tidying that
  happens on its own.
- **Your imported library has shelves.** The compendiums the importer writes are
  filed under *ACKS II — Extras › From your books*, and a book line that is not
  ACKS II — Dolmenwood, Quick Delve, a source you registered — gets a folder of
  its own. A line's folder is made by the first pack that needs it, so you never
  see a shelf for a book you have not imported.

### Changed
- **This module ships no library of its own any more.** Four compendiums are
  gone — *ACKS Class Training*, *ACKS Equipment & Combat Proficiencies*, *ACKS
  Equipment Samples* and *ACKS Henchmen Proficiencies & Powers*, 105 documents.
  Everything they held comes from your own books through the importer instead:
  an imported class carries its own weapon, armour and fighting-style training,
  and an imported proficiency or power drives the same automation the pack items
  did. **Anything you already imported from them stays in your world untouched;
  only the compendium rows go.** Three mechanics do not yet come back — the
  Goblin-Slaying and Vermin-Slaying bonuses and Inspire Courage's morale bonus —
  and building a class by hand no longer has ready-made training items to drag
  onto it.
- **Six macros retired.** Four were one-time cleanups for the module merge and
  for worlds upgrading into it: *Clean Up After the Merge*, *Recover Coin from
  Unloadable Locations*, *Migrate Token Vision* and *Advance 1 Week*. The other
  two are replaced by the code that makes them unnecessary — *Repair Henchmen
  References* (a hireling's references are cleaned up when it is deleted, swept
  at load, and the sheet no longer breaks either way) and *Forgive Wage Arrears*
  (writing off back wages is still there, on the roster). **Copies you already
  imported into your world keep working.**
- **A hireling the module never enrolled can no longer be billed from the dawn
  of the world.** An unset wage clock read as time zero rather than as unset in
  one path — the one behind those six-figure invoices — and now reads as unset
  everywhere.

## 6.0.0

**The importer is part of Extras now — one module, one library, and nothing
left behind.**

### Changed
- **ACKS II — Importer merged into this module.** Connecting your books,
  importing everything the cookbook ships, browsing and auditing entries, and
  importing another game's adventures are Extras features now: the four
  macros ship in the *ACKS Extras Macros* compendium under *Your Books* and
  *Import from your books*, the importer's settings sit with the rest under
  ACKS II — Extras, and its guide is
  [Importing from your books](docs/guides/importer.md). The separate module
  is retired — its repository is an archive, and this module declares a
  conflict with it so Foundry says so too.
- **Upgrading is one disable and one reload.** Disable *ACKS II — Importer*
  and reload. While it is still active the built-in importer stays off and
  says so on every load, so two importers never write one library. On the
  first load without it, everything the old module owned is carried over,
  once: the imported library — every document on every *ACKS Cookbook* shelf
  and in the sidebar, at every depth — the server-held book shelf, any
  registered OSE sources, this seat's importer settings, and any imported
  macros still addressing the old module. The notice reports the count.
  Per-seat book locations were never in the old module's name and need
  nothing.
- **`game-icons-net`** moved from the importer's recommendations to this
  module's.

### For module authors
- `globalThis.acksImporter` is gone; the api is `acksExtras.importer`
  (`game.modules.get("acks-extras").api.importer`), the same surface under a
  new key.
- Imported documents are stamped in this module's own flag scope:
  `flags["acks-extras"].cookbook` (was `flags["acks-importer"].cookbook`), and
  the importer's `generated` marker is now `minted`.
- `ability-provider` and `ruledata-import` remain the named seams; nothing
  outside this module registers or is required to.

## 5.8.0

**A city is walked across, not clicked through — and on the road, the day
raises its own end.**

### Changed
- **A city is explored the way a dungeon is: by moving.** Settlement mode used
  to stop the turn clock and hand you a **Take a turn** button; the party stood
  still on the map while the Judge pressed. Now the party's own movement marks
  off city turns, exactly as it does underground, and the button is gone along
  with the one for holing up.

  What this really changes is what a city turn *costs*. With the clock stopped,
  a settlement was a place where torches never burned down, spells never ran
  out, nobody ever grew winded and the world clock stood still — so a heist
  through a guildhouse was free in every currency a delve spends. It is not any
  more. Listening at a door, a hasty or methodical search, spiking a door and
  everything else the delve panel offers now costs the same time in a city that
  it costs in a corridor.

  The street keeps its own two rules: the encounter throw comes round on the
  cadence of where you are standing and whether it is dark — not on the
  dungeon's wandering-monster schedule — and a commuting party still throws not
  to lose its way. An Encounter Zone drawn over a quarter still overrides both
  tables, which is how a bad neighbourhood is drawn.

  **How far a turn carries the party depends on how big a block is on your
  map**, and only your map can say. Declare it in **Scene Configuration → A
  block is** on any scene set up as a settlement. Left blank, the party is
  timed by its walking speed instead and the panel says so.

  **On the road, the day now raises its own end.** Once the party has walked
  off the hexes its march carries it, moving the token asks the question:
  **call it a day**, **push on** into a forced march, or **not yet**. It is
  never answered for you — ending a day spends the provisions, settles the
  ground, rolls tomorrow's sky and moves the calendar, and pushing on is a real
  choice — but you no longer have to notice that the day is done. It asks once,
  and asks again if pushing on bought more road. **End day** is still there and
  still does exactly what it did.

  Fixed along the way: switching to a forced march mid-day used to reset the
  day's hex count to zero, un-walking ground the party had already crossed.

  **Holing up now runs off the calendar.** Set the party somewhere it is
  staying put and advance world time however you like — a rest, a downtime
  week, dragging the clock — and each whole day is thrown for once, as one
  card. Your pickers are all still there: they say what the party is *doing*,
  and nothing on the panel advances the clock any more.

## 5.7.0

**A quiver of arrows weighs a quiver, not twenty of them — and weight is typed
the way the books count it.**

### Changed
- **Weight is entered in sixths of a stone.** The band's weight field now takes
  the number the books count in — six to the stone — and shows the stone
  reading beside it. It used to take stone as a decimal, which made a sixth
  `0.1667` to type and was the only decimal-stone surface in the module: core's
  own item sheet and this module's variation items have always taken sixths.
  **A Judge who typed weights into this field before will type a different
  number now** — `1` is a sixth, where it used to be a whole stone. Stored
  weights are untouched and read exactly as before.

### Added
- **Goods whose weight is stated for a bundle.** The books rate a quiver of
  twenty arrows or a set of six spikes as one item, however many it holds — and
  until now there was no way to say so. Reading such a row off the page and
  typing the printed weight beside the printed count produced an item twenty
  times too heavy, and nothing on the sheet could explain it. Items now carry a
  **Per** count saying how many units one stated weight covers. It appears on
  the Record panel of anything stacked, and stays out of the way on a single
  item.

  A part-used bundle still counts whole: twenty-one arrows weigh two quivers,
  not one and a twentieth, which is how the books count them. The band shows
  both numbers when they differ — what one bundle weighs, and what the whole
  stack costs whoever carries it — and the character sheet's encumbrance agrees
  with it.

  Nothing already in your world changes: a bundle size of one is the ordinary
  case and the arithmetic every existing item already gets.
- **Annotate declares a bundle it can recognise.** Pressing **Annotate** on an
  item whose name states its load — "Quiver, 20 Arrows", "Case, 20 Bolts" —
  now sets the bundle count along with the quantity it already filled in. Until
  now it wrote the count and left the weight to be multiplied by it, which
  manufactured the very over-encumbrance the button exists to tidy. A bundle
  size you have set yourself is never overwritten.

## 5.6.1

**A weight stops quietly rounding itself away, a proficiency throw shows the die
it was decided by, and a scout who steps out comes back as one person instead of
two.**

### Fixed
- **An item's weight is no longer rewritten every time you edit anything else on
  its sheet.** The title band's weight badge shows the stored weight converted
  to stone, and it was writing that converted number back on *every* submit —
  renaming the item, ticking a box, changing its price. For a weight that is a
  whole number of sixths nothing happened, which is why this went unseen. For a
  weight *finer* than a sixth it was total loss: the value collapsed to the
  nearest sixth, and anything under half a sixth collapsed to nothing at all.
  Imported ammunition is stored exactly that way — the printed weight of a
  bundle divided across its arrows — so a quiver of twenty could come to weigh
  nothing the first time anyone opened it and typed in an unrelated field. The
  badge now writes the weight only when the badge is the control you changed.
  **Weights already flattened cannot be recovered from the document; re-import
  the affected items, or type the weight in again.**
- **A proficiency throw's chat card shows its dice again.** The card was built
  expecting Foundry to attach the usual dice box beside it, and Foundry does not
  do that for a card with its own layout — so since 3.7.0 an ability throw has
  posted a banner, a portrait and a verdict with no die, no total and no
  formula anywhere on it. A throw with *no* target — a measure, like the Hit
  Dice a crusader turns — was worse still: with no verdict to print either, the
  card said nothing at all. Both now carry the system's own dice box.
- **Sending a member ahead and then removing them no longer leaves two of
  them.** A detached character was recorded twice over — as a token standing on
  the map, and as the snapshot taken before they left the party. Removing them,
  disbanding the party, or deleting the party actor read the snapshot and built
  a *second* token from it without clearing the first. Disbanding mid-fight
  duplicated everyone who was out, with the copies indistinguishable and the
  stale one still carrying the hit points they had before the fighting started.
  Members are now brought back in before their tokens are restored, so what
  comes back is the body they were actually using, damage and all. **A world
  that already has duplicate tokens from this must have them removed by hand —
  nothing marks them apart from real ones.**
- **The Detach control no longer does nothing in silence.** With no party token
  on the canvas there is nowhere for a character to step out to, but the button
  rendered as usable and simply did not respond. It is now disabled in that
  state, and a player who declares a detach that cannot be carried out is told
  so instead of being left with "sent to the Judge".

### Documentation
- The Formation guide now says that trap resolution needs no button, and names
  the two conditions it quietly depends on: the party must move as the **party
  token** (a table moving characters individually gets no trap throws at all),
  and a Judge must be connected.

## 5.6.0

**Turning undead works the way the book prints it — a table whose top rungs need
no throw, read at half a level where the rule says half, and the roll that says
how many. The template die is thrown for a character who forgot it, a package
makes the picks it prints, the picker's own writing is legible, and gear comes
back out of a pack in one click.**

### Added
- **Gear comes out of a container the same way it goes in — from the row you
  are looking at.** Every item inside an open container on the Inventory tab
  now carries a take-out control, the one the item sheet's Contents tab has
  always had. Until now the only gesture on the character sheet was to drag the
  row all the way back down past every bucket onto one of the type lists below,
  which gave no sign it was a target until the drop landed. Taking a thing out
  asks nothing further about where it should go: it is not worn, so it has no
  slot to choose, and it lands loose among the rest of its kind. Dragging still
  works exactly as before, and a locked container still shows nobody but the
  Judge anything to take out.
- **A ladder rung may say something other than a number.** A printed progression
  is not always a grid of targets: a rebuking table runs a dash where the
  character cannot act at all, then targets, then rungs where the result simply
  happens. A rung now says which of those it is and carries the cell as the page
  prints it. On an automatic rung nothing is rolled — a card is posted with no
  dice and the cell on its success line. On an unavailable one nothing is posted
  at all and the clicker is told, because a throw you cannot make is not a
  failure you could ever turn into a success. Both are typed in the throw editor
  beside the target, and both arrive on a class document's published table.
- **A throw may borrow another class's table, at a fraction of your level.** The
  books' "as a <class> of <fraction> your level" powers are now that sentence:
  the lending class's table is published once, and the borrower names the
  fraction and which way it rounds. You write the fraction as a top and a bottom
  number rather than choosing from a list, so whatever your book states works.
  The sheet shows the borrowed table under the throw, headed by the lending
  class's levels, and says which of those levels you are standing on.
- **A throw that is not rolled against anything.** *Succeeds On* now offers **no
  target**, for the rolls the books put AFTER a successful throw rather than as
  one: the 2d6 that says how many Hit Dice of undead a rebuke turns, the dice a
  treatment heals. Such a throw shows its dice everywhere the others show a
  number, its card reports the total with no success or failure, and its editor
  has no target section to leave blank. An ability score named on one is added to
  the dice, since there is no target for it to move.

### Fixed
- **A thing is in the pack or in the hand, never both.** A weapon inside a
  chest still offered Draw, a cloak inside a backpack still offered Wear, and
  core's own equip toggle sat on those rows too — so gear could be put to use
  without ever coming out. The sheet then went on drawing the sword inside the
  chest, because being in a container outranks every other answer to where a
  thing is, while the loadout counted it in a hand: it spent the hand, granted
  the attack, and let a shield be worn beside it. Taking stowed gear into use
  now takes it out of the container in the same movement, whichever control asks
  — including core's. Two controls no longer appear on a stowed row at all,
  because they name a place on the body that nothing inside a chest can be in:
  a shield's strap position, and lighting a lantern that is still in the pack.
  Stowing is unchanged, and still takes gear off before putting it away.
- **A no-target throw no longer reads as a broken one.** Entered the only way
  that was previously possible — as a throw with its target left empty — a 2d6
  "how many Hit Dice" printed `?` on the Rolls tab, `—` on the row's tag strip
  and in Favorites, and told the card's reader to "open the copy on a character"
  they already had open.
- **A throw with no rung yet says that, instead of blaming a shared item.** A
  laddered throw on a character below its first rung and the same throw on a
  world item gave the same message; only the second is about a shared item.
- **A throw that borrows a class table now resolves.** Naming a published ladder
  has been offered in the throw editor since 4.8.0, but nothing behind the
  picker ever ran: the roller asked the shared library, which cannot see the
  world's class documents and answers "no target" for exactly this kind. Every
  such throw displayed as a throw with no target.
- **The class and table a throw borrows are no longer discarded on save.** The
  stored shape had no field for the chosen ladder at all, so it was dropped the
  first time the throw was edited and the throw fell back to attack throws. The
  class was restricted to the four chassis while the picker offered every class
  in the world, so choosing a real class stored "fighter". Abilities that
  progress as a class carried the same fault and are fixed with it. Throws saved
  before this release kept whatever the fallback produced and want re-picking.
- **A character who reaches the end of the page is generated.** The starting
  package a character gets is read against the 3d6 template die, and a die that
  was never thrown reached no package at all — so a player who rolled their
  attributes, chose their class and pressed Save was told "No class and template
  were chosen" and walked away with six numbers: no class, no proficiencies, no
  equipment, no coin. The die is now thrown for them, the best package it
  reaches is taken, and the roll and the package are named on screen. A roll
  that reaches no printed band still gets the lowest one, so a low die never
  costs a character their whole starting package. A class that prints no
  packages is unchanged.
- **A starting package makes the picks it prints, and is not offered among
  them.** Binding a class beside a chosen package still asked for the 1st-level
  proficiencies the package itself hands over, and listed the package's own
  abilities among the answers — and because a package grants a printed rank as
  separate copies, spending a free pick on one handed the character the same
  proficiency twice. Those picks now come off the page with the package that
  answers them, and the Intellect proficiencies, which are still chosen on top
  of the package, no longer offer anything it is already bringing.
- **A proficiency is offered once, by its own name.** Materializing a class's
  starting packages mints one specialized copy per printed specialty, per class
  — and every list a player picks from was built from the world's proficiencies
  without telling those copies from the definitions they specialize. So the
  general-proficiency and Intellect-bonus selects listed "Performance (singing)"
  once for every class whose package prints it, "Knowledge (history)" seven
  times, and the plain Performance the pick is actually for not at all: 109
  entries where 42 proficiencies exist. The picks now offer definitions only.
- **The class picker is written at a size meant for sentences.** Every note on
  the picker and the Scores Generator — what a package brings, what it costs,
  what a level leaves to choose — was set at the smallest step in the type
  scale, the one meant for a table's micro annotations, and the paragraphs
  describing a starting package were effectively unreadable. They are back at
  reading size.
- **The missing-tables notice names what is actually missing.** The warning a
  Judge meets in a world whose books have not been imported counted a set of
  tables as present the moment anything at all was registered under its name.
  The henchmen rarity tables were therefore never listed, because this module
  registers one small piece of automation of its own under that name from the
  moment it loads — so a world holding none of the book's tables was told the
  rest were all it lacked. The notice now asks after the tables each feature
  actually reads, and a set only part of an import reached is named with how
  much of it arrived.

## 5.5.1

**An ability sheet shows one tab at a time, and the Description tab has room to
write in again.**

### Fixed
- **A proficiency's description is a page you can add to.** The list of throws
  stood on screen under every tab of an ability sheet, and it took the height
  the open tab wanted — so Description opened onto the roll list with its notes
  field squeezed to nothing, and there was nowhere left to type. Each tab now
  shows its own panel and nothing else, and the description editor is back at
  full height. Text already written was never touched.
- **The Mechanics tab survives an edit.** The sheet saves as you type and
  re-draws itself on every save. Changing any field while Mechanics was open
  left that panel blank under a tab button still reading as chosen; it re-draws
  in place now.

## 5.5.0

**The map setup tool says what a map IS — square, hex, or nothing but a scale —
in the units you name; a throw can be written against an ability score; and the
right button goes back to panning.**

### Added
- **A grid FAMILY, chosen first.** Square, hex by rows, hex by columns, or
  scale only. Everything below it reads under that choice: which fields appear,
  what a drawn box measures, and what the apply writes. It opens on the family
  the scene already uses.
- **Hex maps can be set up at all.** Draw a box around one hex, say what a hex
  is worth, and apply: the map is scaled so one drawn hex is one Foundry hex,
  and the grid is shifted so that hex lands on a real one. Foundry's own
  geometry is asked for the hex's shape and packing, so nothing here can drift
  from it. This is also what makes the terrain brush and the road tools
  reachable on a map that arrived without a grid.
- **Scale only, for a map with no grid to fit.** Drag along the printed scale
  bar, say what it reads, and the scene measures true — with no grid written,
  no image rescaled and nothing moved. A gridless map stays gridless.
- **Distance units are a choice.** Feet, yards, miles, metres or kilometres,
  written to the scene with the scale. Everything that owns a real length —
  token footprints, the party token's frontage — converts through them, which
  fixes a party on a six-mile hex map being sized as though six were six feet.
- **A scene can say what a party DOES on it** — dungeon, wilderness or
  settlement. A formation arriving takes that system, and follows if you change
  it while they are standing there. Saying nothing leaves a party alone.
- **Every sample carries a box for what it represents.** A dragged box says how
  many cells it spans, so you can drag across a run instead of pinching one
  cell; the scale bar's printed value sits on the bar's own row.
- **A throw can be written against an ability score.** Pick the score on the
  throw and, where the throw wants a multiple of the modifier, how many times it
  counts. The character's own modifier is folded into the target, so a throw
  reads 4+ for one character and 6+ for another — and the editor's preview, the
  tag strip and the chat card all name the term, because a target that moved
  with no visible cause reads as a typo. A throw that must match exactly says
  the term is not applied rather than claiming it. Throws already written carry
  no score and are unchanged.

### Fixed
- **The right mouse button no longer eats samples.** It was bound to "undo the
  last sample" and it is also the button you pan the canvas with, so working
  across a large map quietly deleted things. Undo is Ctrl+Z; the eraser and the
  per-row control still delete a chosen sample.
- **Every field says what it is and in which unit.** "Map square is" and
  "Foundry square" were bare numbers with no statement of which was the map and
  which was the grid being written.

## 5.4.0

**The first hit die is read at its floor, levels past 9th carry their printed bonus, and a pick you are owed is something you can see.**

### Added
- **A pick a starting package offers is an item on the character.** A printed
  package sometimes hands over a choice rather than a thing — "and one spell of
  character's choice". It arrived as a sentence nobody could act on, so the pick
  was simply never made. It is now minted on the character as a marker named for
  the question it asks; clicking it opens a chooser and the answer replaces it.
  Re-running chargen or re-applying the class never mints a second one, and a
  pick already made never comes back.
- **A race's extra hit points per level after 9th can be typed.** The field
  existed, was imported for the dwarf, and had neither an editor nor anything
  reading it. The race sheet now has the input, and the class builder reads it.
- **A template row can be marked as an offer** on the class sheet, for a class
  typed by hand rather than imported.

### Fixed
- **The 1st-level hit die is read at its printed floor, and Constitution lands
  after it.** RR Ch. 1 §I.5 floors the *die*, not the total; the total was being
  floored at one instead, which is different arithmetic — the modifier is meant
  to apply to a die that has already been raised. A 1st-level character rolling
  under the floor was written short. The floor is a printed value, so it is
  imported: **a world that has not imported it keeps exactly the hit points it
  had**, and the code comment and offline tests that asserted the absence as if
  it were the rule are corrected with it.
- **A custom class gains its printed hit points past 9th.** Every level from 10th
  up was derived with a bare die count and no flat, so a built class fell behind
  an imported class of the same spread by up to ten hit points at 14th with
  nothing on either sheet saying why. The rate is imported per saving-throw
  progression and summed with the race's own; a rate the world has not imported
  is named as an issue rather than replaced by a guess.
- **An Art/Craft assessor is recognised by a trade venture.** The merged
  proficiency is printed "Art/Craft (pottery)", and the name strip matched the
  bare "art" first, leaving "/craft (pottery" — a fragment no merchandise label
  contains. Specialties naming a whole category still matched by the other half
  of the test; ones naming *part* of a category — wood, metal, furs — matched
  neither, so an assessor of those was never recognised.

### Changed
- **`buildPlaceholderAbility` is no longer part of the classes API.** Nothing has
  called it since 4.20.0 removed placeholder minting for unresolved names. A
  placeholder for a pick the character *owes* is a different thing and is the new
  pending-choice surface above.

## 5.3.0

The party sheet gets tabs, the city gets its last four rules, and every table
the module wants can now be written by hand.

### Changed
- **The party sheet is four tabs, not one long scroll.** Twelve sections had
  accumulated in one template, and the overland work in 5.2.0 made a long sheet
  longer — the whole thing ran past five screens. It is now a fixed header over
  **Party** (the clock and the player actions), **Order** (the marching order
  and mounts), **Travel** (the journey, the camp, getting lost, the city) and
  **Kit** (lights, spells, maps). Only the active tab scrolls. The header keeps
  what must never be hidden behind a tab — the party's name, its encounter
  table, and the warnings; a warning you cannot see because you are on another
  tab is not a warning. Switching tabs cannot lose an edit: every tab is part of
  the same form.
- **The weather panel wears its own icons.** Nine temperature bands, eleven
  kinds of sky, six winds and thirteen conditions read as four rows of identical
  dropdowns. Each now carries a glyph — the thermometer falls as the band cools,
  the sky goes sun to cloud to rain to snowflake, the wind builds to a tornado —
  and the condition chips wear theirs, so a strip of five reads at a glance.

### Added
- **Looking for trouble.** A party can take to the streets to make a nuisance of
  itself. That eases the encounter *throw* rather than making the street come
  round sooner, which is what the rules say and a different thing over a long
  walk.
- **Holing up, by the day.** A party out of sight — recuperating, studying,
  training — spends days rather than turns, with one encounter throw each and no
  ground covered. The board offers a day tick in place of the turn tick wherever
  the party is not going anywhere.
- **Travelling by litter or wagon.** Remembered on the board, and deliberately
  worth no speed at all: the rules afford it privacy and say plainly it is not
  any faster.
- **The settlement encounter table.** The d100 table of written incidents now
  arrives as a real RollTable from your own Judges Journal, and the shift the
  dark puts on the roll arrives with it. What the module supplies is the
  procedure — one roll, the after-dark shift, the band it lands in.

### Fixed
- **Every expected table can be written by hand, importer or no importer.** The
  Ruledata Browser listed only tables an import had already provided, so a world
  that had never run the importer opened an empty browser: nothing to export, no
  shape to copy, and no way even to discover which tables the module was asking
  for. It now lists every table the module wants, marking the ones nothing has
  supplied; exporting one gives you a blank page to write into, and dropping it
  back supplies it exactly as an import would.
- **A table stated as a single figure read as "not imported".** The settlement's
  reader took only objects, so a table that is one number — the after-dark shift
  is one number, not a row — looked exactly like a table nobody had imported.

## 5.2.1

### Fixed
- **A score raised to the method's floor states its modifier.** Under the
  standard generation rule a 5d6 score that lands short is raised to the floor
  that rule sets, and the box beside it went blank instead of saying what the
  raised score is worth — so two attributes on a freshly generated character
  showed no modifier at all. The modifier is now written the way the system
  writes the ones beside it, and the box states it like the rest. Nothing about
  the character was ever wrong: that box is display only, and the sheet has
  always computed the real modifier from the saved score.

## 5.2.0

Land travel, end to end. A journey now has weather that comes off the calendar,
ground you can paint and roads you can draw, a party that eats and drinks and
feels the cold, country that can be foraged and searched, cities that can be
crossed a turn at a time, and a way of getting properly, secretly lost. Every
figure behind it — every threshold, target, penalty, yield and rate — arrives
through acks-importer from your own books; the module ships the procedures and
nothing printed.

### Added
- **Getting lost.** A party that fails its navigation throw walks on believing
  it is somewhere it is not. The table's map fills in as they go — the ground
  they think they crossed — while the Judge alone sees where they really are,
  through a hidden marker that moves with them. When they finally realise, that
  ground closes back over and they are told, in as many words, that the last few
  days were not where they thought. They do not learn where they went; finding
  their way back to a known landmark is what puts the country they really
  crossed onto the map, in its right place.
- **Following a river keeps you found.** A party tracing a navigable river, or a
  route it already knows, does not test its way — which the rules have always
  said and the module could not previously express.
- **Roads are drawn, and following one means something.** A hex has edges,
  corners and a centre, and a road is a declared path between them. A road only
  helps a party actually travelling along it, a winding route costs more distance
  than a straight one, and the difference is stated rather than hidden inside a
  multiplier.
- **The sky is shared.** Weather is settled once per day for the ground you are
  on, derived from the date and the climate rather than stored on whoever
  happened to roll it, so two parties in the same country get the same day.
- **The camp.** The journey board grew a section for what the party is living
  on: how many days of food and water the packs hold for everyone in the order,
  who is going hungry, thirsty or cold and what it has cost them, and — for the
  Judge — what tonight's chosen hours are actually worth. Only the suffering are
  named; a list of well-fed companions would bury the one who is starving.
- **The party shares its packs.** Food and water are pooled across the marching
  order and dealt out by a policy you choose: evenly, so everyone goes equally
  short, or by triage, so as many as possible eat properly. Both spend the same
  supply and differ only in who suffers.
- **Hunger, thirst and the cold.** Going short now tells. A day on reduced
  rations makes a body hungry; longer without stops it healing or force
  marching; longer still it starves, and starving costs Constitution every day
  until it is fed or dies. Thirst arrives faster and charges a rolled toll that
  sweltering weather doubles. Cold is its own clock: a body left unprotected in
  frigid or cold weather — or one that simply gets wet — turns hypothermic and
  loses Constitution by the hour until it reaches a fire. Anyone carrying a
  cloak or furs is sheltered. The Judge says how long the order stood in it.
- **Work the country, and eat what you find.** The camp panel rolls the day's
  foraging, hunting and searching, deposits what is found on the people who
  found it, and reports each attempt — including the ones that found nothing.
  Hard country, settled country whose forage is somebody's crop, and the
  Survival proficiency each move the throw, and each is named separately rather
  than summed into a target that cannot explain itself. Firewood is counted in
  stone, not in days of food.
- **Searching the wild.** An hour spent looking around a hex can turn up a lair,
  a ruin or another party — harder the faster you are moving, harder again for
  something particular, and easier from the air over open country. Forest,
  jungle and swamp close over a searcher's head and take that advantage back.
  Surveying a hex tells the Judge how much is left to find, and gets easier with
  every search already made. Looking around also gets you noticed: a search owes
  its own encounter throw.
- **Flying expeditions.** A party that can take to the air covers ground
  differently, and the panel now says how: pick how the order moves, say how
  much of the day was spent aloft and what the flier is carrying, and the march
  is composed accordingly. A flier still meets the ground below it, ignores
  roads entirely, and feels wind by its own rule rather than the one that slows
  a walker — and the readout says which factor replaced which.
- **City travel.** A party can cross a settlement the way it crosses a
  wilderness: a pace, whether it is on the avenues or in the alleys, how well it
  knows the way, and whether it is dark. Take a turn and the party covers its
  blocks, tests its way if the pace and the route call for it, and the street
  gets its own chance at them. Getting lost in a city is a wrong turning the
  party notices at once, not an episode. A large party straggles, and splitting
  it is the way out — at the cost of each group answering for its own
  encounters.

### Changed
- **An animal's training and mountability moved onto the sheet properly.** They
  shipped in 5.1.0 as a panel wedged in above the tab strip; they are now an
  **Animal tab** on the Full Monster Sheet — which, it turns out, is already
  the sheet an animal opens by default. The controls are ordinary sheet fields
  now, saved by the sheet itself, and the tab appears only on an animal. What
  the beast carries is not repeated there: it is set on Classification and drawn
  on Inventory, where it always was.
- **Terrain is no longer a closed list.** The brush offers whatever terrain your
  own books put in the registry, rather than a vocabulary fixed in the module.
  Mud and snow are not paintable at all — they are ground conditions the weather
  produces, and painting one would have let a scene disagree with its own sky.

### Fixed
- **Dehydration and hypothermia cost nothing.** Both charge a rolled toll, and
  both were being read through a number-only gate — so a dehydrated or
  hypothermic body took no damage at all while the panel correctly reported the
  condition. Sweltering weather's doubled thirst toll was likewise computed and
  discarded.
- **The day board's ancillary hours were invisible to two readers**, so the
  camp never showed what tonight's foraging was worth and the forage run
  gathered nothing at all.
- **Foraging for water found nothing outside a handful of terrains**, because
  the book names the same country differently from table to table — "clear"
  where the movement rules say "grassland". The two vocabularies are now
  reconciled on import.
- **An unstated load, price or capacity read as a confident zero** in several
  places, grounding mounts that had no stated maximum and making unpriced flight
  free.

## 5.1.0

Mounts know what they are for, and say so on their own sheet.

### Added
- **The animal panel.** An animal renders on the system's monster sheet, which
  knows its hit dice and nothing about the two facts the mounted and vehicle
  rules actually ask of it. Its own panel now sits at the top of that sheet:
  what it was **trained for**, and whether it **can be ridden** — a different
  question, since an ox is rideable in principle and untrained in practice, and
  a war dog is trained for war and is still not a mount. Imported values show
  up here marked as imported; an animal you made by hand is set here. What it
  CARRIES is read out beside them from the sheet's own load fields, rather than
  offered as a second pair of inputs that could disagree with them.

### Changed
- **The draft substitutions come off your own page.** What an ox or a mule
  pulls against a heavy horse was a table frozen in this module's code. It now
  reads from the `travel` document, imported with ACKS Importer 5.1.0. The
  heavy horse still counts as one without any import — a team is measured in
  heavy-horse equivalents, so the unit's own value is its definition rather
  than a figure off a page — and every other kind is **unpriced** until you
  import: it contributes nothing and the vehicle sheet names it, rather than
  being quietly counted as nothing or confidently counted as one.
- The donkey rate this module used to apply appears in no substitution sentence
  in the rules. It was invented, and is now an unpriced kind like any other.

### Fixed
- **A mount's carrying capacity had no reachable home.** The animal sub-type
  carried load fields that nothing in the module ever read — the figure every
  carrier actually asks for lives with the monster sheet's own Normal/Max Load
  — so an imported or hand-set load could look recorded while every consumer
  still saw an unstated capacity. There is now one store, and the panel reads
  it.
- **Imported mounts arrive flagged.** Animals imported with no training and no
  mountability, so a war horse looked untrained and nothing could be ridden;
  the mounted overlay was falling back to reading English words in names.
  Requires ACKS Importer 5.1.0, which reads both from the page.

### Internal
- `DRAFT_EQUIVALENTS` is replaced by `DRAFT_KINDS` (the structural key list)
  plus `draftEquivalent(kind)`, which reads the registry. The committed test
  suite asserted the printed ratios directly; it now runs on invented ones,
  and the printed substitutions are asserted only against the reader's own
  book.
- Mounts and the carry model are documented for the first time: `docs/lib`
  gains a Carrying section — the one attachment model, `mount.mjs` as its
  permanent facade, training and mountability as separate questions, and how
  teams are counted — and the vehicles guide gains a user-facing Mounts
  section.

## 5.0.0

Overland travel: the journey, the weather, the wilds — and vehicles that carry
what they actually carry.

### Added
- **One carry model, and stations you can read at a glance.** A rider on a
  horse, a passenger in a wagon, an ox in the traces, a rower at the bench and
  a canoe lashed on as cargo are now one relationship. A vehicle sheet shows
  its seats as groups — what each requires, who is in it, what a shortfall
  costs — with compact chips instead of full cards, half-hand badges where a
  body is unqualified, and steppers for the unnamed complement. Dropping an
  actor asks what they are, with the cost of each option stated before
  anything is written.
- **Aboard means what it weighs.** A named occupant charges its own mass —
  every body a stack stands for, plus what it actually carries — and the
  printed per-head rate prices only the unnamed complement. Crew bodies ride
  free; a non-motive role's gear charges the hold (RR ch. 7's marines), and
  the hold names that share.
- **A journey on the party sheet.** A formation can leave the dungeon clock
  behind and count days instead: ground, road and territory, a day board of
  one dedicated activity plus the four ancillary hours the wilderness rules
  budget, an End Day that advances the world clock and writes an append-only
  log, the getting-lost state the Judge alone sees, and the day's march
  derived in the rules' order with every factor on its own line.
- **Hex terrain, painted.** A battlemap tool paints a hex-gridded scene's
  cells into Scene Regions keyed by terrain. On a journey the party token then
  IS the trace: crossing a boundary names the hex and sets the ground from
  what the map says.
- **The mounted and vehicle combat overlay.** Setting-gated prompts for the
  saves that keep a seat — after an attack by rider or mount without Riding or
  Mounted Combat, and on damage to either half without a military saddle — plus
  a card stating who may act by what the mount did, and its vehicle mirror: a
  howdah's beast fights, a wagon's team only on a charge, a palanquin's bearers
  never.
- **Weather over the march.** Three throws a day under the hex's Köppen climate
  and the season, the night temperature read from the same roll, freezing air
  turning drizzle to flurries and rain to snow, still air turning them to mist
  and fog, an optional weather-fronts drift, thirteen mechanical conditions
  that stack, and the footing they leave — mud that forms, freezes, thaws and
  dries, and snow that lies and melts to mud. Wheels stop where the footing
  says so, and the panel names the wagon that cannot roll.
- **The wilderness encounter chain, end to end.** One throw runs the territory
  d20 on the column the party's territory, road and the night pick, then a
  civilized draw, or a rarity throw into the terrain-and-rarity monster draw,
  or a terrain encounter — standing down while the party rests or retraces its
  own route. The Judge gets one whispered card with every roll shown, the
  encounter distance, the party's visibility and evasion target, and a drawn
  creature resolved against the world and the imported library as a link.
  Surprise resolves on the system's own matrix; reactions with the influence
  tools.
- **Seamanship on the vessel sheet.** The day's navigation and hazard throws in
  the door-helper shape — decomposed and shown before anything is rolled, with
  the arts and the helm prefilled from the people actually aboard — a sinking
  clock that counts a holed hull down, the crew-for-cargo trade deriving itself
  from the hands a vessel is short, and a per-head gear rate so an abstract
  contingent of marines stops being weightless freight.

### Changed
- **Printed values arrive from your own books.** Terrain and road multipliers,
  wind and tacking, the navigation and hazard targets, hazard dice and rates,
  hull damage shares, the sinking die, repair rates, speed rounding and the
  general berth no longer ship in code. They read from ruledata documents
  imported by ACKS Importer 5.0.0 or later. Every surface that cannot answer
  says so — a stated reason, an unpriced line, "draw this from your book" —
  and never a guess. **Until you import, worlds visibly lose numbers they used
  to have.** That is the trade, and it is deliberate.
- **`acksExtras.vehicles` is apiVersion 2.** `NAVIGATION_TARGETS`, `HAZARDS`,
  `DAMAGE_SHARE`, `SINK_FORMULA`, `CREW_PER_POINT` and `BERTH_STONE` are
  removed rather than aliased; the registry-reading functions and the
  structural key lists beside them replace each one.
- **`acksExtras.formation` is apiVersion 6**, adding the travel mode, the
  weather generator and the encounter chain.

### Internal
- The carry model is a forest by construction: one flag on the carried actor,
  a chain guard that refuses a cycle, and a reverse index that is a cache and
  never the truth. Chains resolve to their root, so a rider whose horse is
  harnessed to a wagon moves at the wagon's pace.
- `lib/mount.mjs` is a permanent facade over the one model; legacy symmetric
  pairs still read, and every write converges them.

## 4.28.0

Your class's damage bonus reaches your damage roll.

### Added
- **A class's damage bonus is applied to the character.** It had reached the
  class sheet and stopped there: the column was read, displayed, and never
  written, so a fighter's bonus never touched a damage roll. Applying a class
  now writes it to the character's own melee and missile damage modifiers — the
  fields the system pushes onto a damage roll — so it shows up where you throw
  the dice. Fighting-style specialization adds to it rather than replacing it.
- **Where the book qualifies the bonus, so does the character sheet.** A column
  headed *Melee Damage Bonus* applies to melee and to nothing else. The
  paladin's is the one in the core rules; it needs ACKS Importer 4.4.0 or later,
  which is the release that carries the qualification through the import.
- **Where the book does not qualify it, you are asked.** An unqualified column
  is not the same as "both": the fighter's is unrestricted, while the
  barbarian's is unqualified because the player picks melee or missile at 1st
  level and cannot change it. Nothing in a class document tells those apart, so
  applying such a class asks once — melee, missile, or both — and remembers the
  answer on that character for that class. Later applies never ask again.
  Dismissing the question cancels the apply rather than choosing for you.

### Internal
- The Battlemap panel registers only the actions it has controls for. `wipe` and
  `setMode` were handlers no control called — both described buttons that
  stopped existing when arming and wiping moved to the scene-control toolbar —
  and `setMode` left a dead context behind it.

## 4.27.1

The map tools come back as a window you can close.

### Fixed
- **The Battlemap panel is a window again.** It had been docked into the
  sidebar, where it sat under whatever directory you had open — on every
  scene, whether or not you were aligning a map, with no way to put it away.
  The off switch that shipped in 4.27.0 stops the sampling; it was never able
  to dismiss the panel. Now the panel opens as an ordinary window when you
  enter the **Battlemap** control group, closes on its own close button, and
  can be dragged wherever suits the map you are working on. Your samples and
  the numbers you typed survive a close, as before — they belong to the scene,
  not to the window.

## 4.27.0

The map tools get an off switch, and the two scale numbers stop disagreeing.

### Added
- **An off switch for the Battlemap tools.** The group now opens on an arrow
  that arms nothing, and picking that arrow again stops sampling. So does
  **Escape**, and so does the **Stop sampling** button that appears in the
  panel whenever a mode is armed — which also tells you at a glance that
  clicks on the map are being taken as samples. Every tool in the group used
  to draw on the map, so the only way to stop was to leave the group
  altogether, and coming back dropped you straight into drawing again.
- **The custom token size exists now.** The guide had always described a
  custom value beside the footprint chips, and there was no box to type it
  into. There is one.

### Fixed
- **Escape no longer eats a sample.** It used to delete the newest one, so the
  one key you press to get out of a tool was the key that destroyed your work.
  Undo stays on right-click, where it already was.
- **"Map square is" and its chips are one number.** Typing 10 and then
  pressing the 20 chip left the box reading 10 while everything downstream
  used 20, and whichever you touched last quietly won. The field and its chips
  now write the same value, and each row of chips sits under the field it
  belongs to rather than between the two.

## 4.26.1

### Fixed
- **The item sheet had no window behind it on a Foundry-look seat.** With the
  look set to Foundry's own rather than the book's, opening any weapon, armour,
  gear or coin — a monster's new attack, say — drew the sheet's contents over a
  see-through window: whatever sat behind it read straight through the page,
  and the sheet was near-impossible to use. The item sheet was the one window
  that named its own paper ground instead of leaving it to the ACKS dress, and
  the Foundry look works by taking that dress off. It now takes the same ground
  every other window takes, and the book look is unchanged.

## 4.26.0

The map alignment panel moves off the map.

### Changed
- **Calibration now lives in the sidebar, beside the map instead of on top of
  it.** The panel that carries the numbers used to be a window, and a window
  covers the very thing you are trying to line up. It is a **Battlemap** tab in
  the sidebar now, with the fit — the cell it has measured and how well your
  samples agree — read at a glance in a card at the top, and **Apply grid**
  pinned to the bottom where it cannot scroll out of reach. If you preferred
  the window, right-click the tab and it pops out as one; the two stay in step.
  Sampling stays where it was, on the Battlemap tools beside the canvas.

### Fixed
- **You can draw more than one box again.** After the first sample, the red
  preview grid was drawn over the top of the map and quietly caught the mouse
  before the map did, so a second box, corner or scale bar never registered —
  the tools looked armed and did nothing. It lets the mouse through now.

## 4.25.0

The machinery stops looking like a note, and the class's training is a row of switches.

### Added
- **Class modifiers, on the Effects tab.** A class's combat training arrives as
  an Active Effect whose changes are three comma-separated lists, so the only
  way to alter what it granted was to open it and edit `dual,twoHanded,
  weaponShield` in a text box — an editor for the storage format rather than for
  the thing. It now has a section of its own at the top of the Effects tab,
  drawn as the same slots the Inventory tab and the follower card show, with
  every slot a switch: click a fighting style, a weapon class or an armour rung
  to grant or withdraw it. It is the same effect, so nothing new is stored and
  the section is gone the moment the effect is. Armour behaves as the ladder it
  is — a click sets the ceiling, and clicking the ceiling clears it.
- **What the section shows is what the CLASS gives**, which is deliberately not
  the same question as the Inventory tab's Training row. Training also arrives
  from proficiencies, items and flags, and a slot lit by one of those could not
  honestly be switched off here. The row is the character's total; this is the
  class's share of it.

### Changed
- **The effects this module maintains can no longer be deleted by hand.** A
  character's combat training and its equipment loadout sat in the ordinary
  effect list beside notes a Judge had made, with the same trash button, and
  deleting either broke the character silently: training vanished and every
  weapon read as untrained until the class was applied again, and the loadout's
  modifiers vanished until some later change happened to rebuild them. They now
  refuse deletion and show a lock where the trash was. Everything else is
  unchanged — they can still be edited, emptied and disabled, so a Judge who
  wants a character untrained empties the training rather than removing the row
  and leaving nothing behind to read. Deleting the character still works.

## 4.24.1

### Fixed
- **A place kept in a compendium shows what is inside it.** An adventure
  imported into a library listed nothing at all — "Nothing is kept here yet"
  over thirty-two rooms that each named it as their parent — because the
  children pass only ever looked through the actors in the world. A location
  now also reads the compendium it lives in, so an imported dungeon reads as a
  dungeon in the library, and a room dragged out of one still names the
  adventure it came from.

## 4.24.0

What a character is trained to use now reads beside what they carry.

### Added
- **Training sits on the Inventory tab.** The fighting styles, weapon classes
  and armour a character is trained in were only ever visible on a follower
  card, so a player reading their own sheet had to open the class — or take the
  equipment warnings on faith — to find out why a weapon was refusing them. The
  same strip now heads the Inventory tab, directly above Worn & Wielded: every
  slot always shows, a trained one lights up, and a specialized or focused one
  goes gold. It states nothing new, only what the character already has, so a
  sheet with no class applied reads grey rather than guessing at proficiency.

### Fixed
- **Armour training never lit the ladder.** A character whose class trained
  them in armour still showed the whole armour row greyed out as unknown — on
  the new Inventory strip and on every follower card that ever showed one. The
  check asked a set of granted categories for its `length`, which a set does
  not carry, so the answer was always "nothing was granted". The ladder now
  lights up to the heaviest armour the character is actually trained in.

## 4.23.0

A crooked map straightens itself, and a trap answers the mouse.

### Changed
- **A map with no grid can be calibrated.** The assistant refused any scene
  whose grid was not already square — which a freshly imported map never is,
  because it arrives with no grid at all. Sampling a gridless map now works,
  and applying gives the scene the square grid it was missing; the panel says
  so before you press it. Only a hex scene is still refused, because the solver
  fits a rectangular lattice and a hex map is not one.
- **Correcting a crooked map now fixes stretched cells too.** Baking a
  corrected image straightened skew and rotation but kept each axis at its own
  edge length, so a scan whose cells were taller than they were wide came out
  straight and still oblong — and the only way to live with it was a scene
  whose squares were not square. The correction now squares the cells in the
  image itself. It stretches the short axis to meet the long one rather than
  squeezing the long one down, because resampling up throws away less. The
  button is offered whenever the fit is crooked *or* out of square, and your
  original file is still never touched.
- **The panel is the numbers, and the toolbar is the sampling.** The mode
  buttons have left the window — 4.22.0 kept a copy of them there, and two
  places to arm the same tool is what let one silently disarm the other. What
  the panel shows first is now the fit itself, with the fields that decide the
  scale side by side underneath instead of stacked a paragraph apart.

### Added
- **A trap's marker is now its control.** Left-click sets the trap or makes it
  safe; right-click decides whether the party can see it, and a ring round the
  marker means they can; hovering names the trap, its state, and who is looking
  at it. They are the same two gestures a door takes, because a trap sits on a
  wall and that is the gesture you already know there. Left-clicking a trap
  that has already gone off rebuilds it — armed again, a fresh secret, and
  nobody's failed attempts held against the new mechanism. Neither gesture
  rolls anything; a character working on a trap is still Trapbreaking.
  The markers answer the mouse only while you are on the **Walls** or
  **Regions** controls, so a trap can never be disarmed by a stray click while
  you are dragging tokens, and never by a player at all.

### Fixed
- **A trap line is drawn where you want it.** Pressing the trap tool with
  nothing selected dropped a wall in the middle of your view and asked you to
  drag its ends into place. It now works like the *Secret Door* button beside
  it: press it and every wall you draw from then on is a tripwire, with the dot
  on the button telling you it is still armed. Nothing is placed for you, and
  laying a row of them is one press and several drags. With walls selected it
  still traps exactly those.
- **A second sample could not be drawn.** Re-entering the Battlemap controls,
  or pressing a mode button, disarmed the tool that was already armed — so the
  toolbar showed a tool armed, and the map ignored every drag. Arming is now a
  setting, not a toggle.
- **Rebuilding a spent trap really does clear the attempts made against it.**
  It reported the trap rebuilt and a fresh secret, and left every failed
  Trapbreaking and every spent search exactly where they were, because the
  write merged into the old record instead of replacing it. A thief who had
  failed hastily still could not try again against a mechanism that no longer
  existed. Both the trapped-wall and the trap-area halves are fixed.
- **The custom token size is back in the panel.** The rework above took its
  field out while leaving the button behind it working, so the only footprints
  you could set were the ones on the chip row.

## 4.22.0

Map alignment gets a toolbar of its own.

### Changed
- **The map tools are their own set of scene controls.** Calibration used to
  hide behind one unlabelled button at the end of the token toolbar, with the
  four ways of sampling a map buried as buttons inside its window. There is
  now a **Battlemap** group in the controls down the side of the canvas —
  drawing a box, picking corners, measuring the scale bar and erasing are
  tools in it, like any other tool on the canvas, so the one you have armed is
  visible where you armed it. Entering the group opens the panel where the
  numbers and the apply buttons still live; the panel's own mode buttons stay,
  mirroring the toolbar.
- **Your samples outlive the panel.** Closing the window used to throw away
  every box and corner you had drawn. What you sample now belongs to the map,
  so you can shut the panel, go and look at something, and carry on where you
  left off.

## 4.21.1

### Fixed
- **A group that shares one initiative roll now reads as one.** The system
  already rolls a single die for a combat group and hands that number to
  everyone in it — but it announced the roll under whichever member came first
  and said nothing about the others, so a grouped fight and a fight where
  everybody rolled separately produced the same thing in the log: one one-line
  message per combatant, to be read one at a time to answer who goes first.
  Initiative now comes back on a single card, one row per roll, highest first,
  where a combat group is ONE row labelled as the tracker labels it and naming
  its members underneath. Nothing is grouped for you — which creatures share a
  roll is still declared with the combat tracker's own people control, so a
  stack, or a summoner and everything they called up, are grouped when you say
  so and never behind your back. A hidden combatant's number still travels on a
  Judges-only card, and a group holding one puts its open members on the public
  card and the hidden one on the Judges'. The rolls themselves are untouched.
  Turn **Initiative results on one card** off for the system's original
  messages.

## 4.21.0

### Fixed
- **Building class template packages is three times faster.** Each template row
  resolved and then wrote its gear one piece at a time, and a document write
  costs what the collection already holds rather than what you are adding — so
  materializing twenty-one classes got slower the longer it ran. A row now
  resolves everything first and writes once. Rebuilding every class's packages
  from scratch: 618s before, 184s after, with the same 1,353 documents and 168
  bundles at the end.

## 4.20.0

### Changed
- **A starting template links the ability it grants instead of copying it.** It
  used to copy whenever the definition lived in a compendium — reasoning that a
  Judge cannot repair a pack document — which stopped being true once the
  library moved into an unlocked world pack. Every granted proficiency was a
  duplicate of one you had already imported. A printed *selection* like "Weapon
  Focus (spear)" still gets its own document, because writing the selection onto
  the shared one would specialize it for everybody.
- **A template no longer ships an empty item for something it cannot find.** A
  name nothing defines stays printed on the class row, where it reads as "not
  imported yet" — a document with a name and no mechanics reads as a real thing
  and gets dragged onto a character. On a full re-import: 1,353 template parts
  where the old rules made 1,960, and none of them empty.
- **The rules for reading a printed name live in one place.** A book writes one
  thing several ways — "Oil, Military (1 pint)" in the price catalogue, "Military
  Oil" everywhere else, "Waterskin/Wineskin" as one row naming two things — and
  those rules existed in two copies whose docstring simply asserted they must
  agree. They did not, so one flask of military oil was two documents in every
  imported world. `nameVariants` and `nameKeys` are now shared library exports
  that acks-importer reads too.

## 4.19.1

### Fixed
- **A class held in a compendium can build its starting-template packages
  again.** The materializer refused any class document that lived in a pack,
  on the stated grounds that the registry never read one — which stopped being
  true in 4.19.0, and which acks-importer 3.0.0 turned into a permanent no-op
  for every imported class, since that is now where they all live. The packages
  themselves are still created in the sidebar: a package exists to be repaired,
  and nobody repairs anything inside a compendium.

## 4.19.0

### Changed
- **Everything that asks "what has this world imported?" now looks in the
  compendium.** acks-importer 3.0.0 writes its library into world packs instead
  of the sidebar, and every read here was pointed at the sidebar: the class list
  came up blank, races and languages resolved to nothing, chargen offered no
  proficiencies, and an ability sheet rendered each of its relations as a raw
  id. One shared reader (`lib/library.mjs`) answers for the sidebar and the
  imported packs together, so a Judge's own homebrew class still wins over an
  imported one of the same name.
- **A creature generated from a template goes into a "Generated" folder of its
  own.** It used to be created in the template's folder — which put play
  material in the middle of the imported reference shelf, and, once templates
  moved into a compendium, gave the new actor a folder id the sidebar does not
  have.

## 4.18.3

### Fixed
- **A disbanded party stops leaving a ghost of itself behind.** Deleting a
  formation's actor and its members together — one after another, or several
  at once from the sidebar — could leave the party's record still sitting in
  the world, holding people who were no longer anywhere. Nothing showed it
  until the next time someone connected, and until then those characters could
  be refused a place in another party on the grounds that they were already in
  one. A record the world has let go of now stays gone: writing a party back
  whole is a way to change one that exists, never a way to restore one that
  does not.
- **Taking someone out of a party works when one of the others has been
  deleted.** Their tokens all come back in a single stroke, so one member
  whose actor was gone stopped the rest from returning — and the removal
  itself was abandoned partway, leaving the person you were removing still on
  the roster however many times you asked. Members whose actors still exist
  are now put back, and the ones that cannot be are passed over quietly.
- **A party token deleted from the map unlinks the party it belonged to,
  and nothing else.** Deciding that against the party as it stands, rather
  than as it stood when the token went, keeps the unlinking from undoing a
  token placed in the meantime along with the clock, the lights and the roster.

## 4.18.2

### Fixed
- **Clearing out a party no longer fills the console with errors.** Deleting a
  formation's actor and its members one after another — or several documents
  at once from the sidebar — raised a run of failures from the housekeeping
  pass that keeps fog and measurement in step with who is on which map. Two
  reasons: that pass could be running several times over itself, each copy
  working from documents the others were deleting, and it kept hold of a scene
  across the moment it was removed. It now runs once at a time, re-reads what
  it is about to touch, and treats a document that was deleted out from under
  it as the ordinary end of that document's housekeeping rather than a fault.
  A step that genuinely fails still reports as loudly as before.

## 4.18.1

### Fixed
- **The party token stops shrinking and swelling while it moves.** Since the
  face-width sizing arrived in 4.14.0, dragging a formation's token made it
  visibly collapse and stretch again along the way. Two causes: the size was
  written as an animated change, so every adjustment tweened through the
  sizes between; and it was recalculated on every step of a move, though a
  token's face depends only on which way it points, how many march abreast,
  how deep the ranks are, and the scene's scale — never on where it stands.
  Size now changes only when the column actually turns, and it changes
  outright instead of morphing.

## 4.18.0

### Added
- **One item sheet for every piece of gear.** Weapons, armour, gear, containers,
  charts, spell books, coin and treasure all open in the same window: a title
  band merged into the window header (name, quantity, value, weight in stone,
  condition), rails of small cells around the art — the item's kind and worn
  place, up to two pinned rolls, equip / favourite / capacity / lock — and tabs
  that exist only when earned: Rolls, Chart, Durability, Effects, Contents,
  Appearance (Judge only) and Details. An item with nothing to roll, hold or
  track collapses to band, art and description, with a quiet Details button.
- **Rolls, gathered.** A weapon's attack modes roll through core's own attack
  pipeline; the special manoeuvres overlay rolls as an attack with the
  manoeuvre's penalty in the same modifier stack; a locked container offers
  Pick and Break through the character's own Lockpicking and Dungeon Bashing;
  a spell book lists its recorded formulae. A roll's lozenge pins it to the
  art, two at most, oldest out first.
- **Containers say what they take.** A container can name the kinds it accepts
  and the refusal it gives a wrong drop, in its own words; the lock gains a
  quality, a pick modifier and the keys that open it (drop key items on the
  row). Stored gear lists on the Contents tab with a capacity bar.
- **Charts.** Drop a Scene on any item and it becomes a chart of that scene;
  Update From Exploration captures the explored fog of war and records how
  much of the scene is charted.
- **What the players know.** A magical item's own effects and true value stay
  hidden until it is identified (the markets ladder); its aura and school show
  from the second step. The Judge's disguise moves to the Appearance tab with
  a drop target, a player preview, and a striped border on the true view.
- **Stacks split to equip.** A stack cannot be worn; its equip cell splits one
  out, wears it, and restacks it on the next click.

### Changed
- The equipment item sheet no longer restructures the system's own sheet; the
  Construction controls and the named-item record live on the new sheet's
  Details and Effects tabs. The Acks Symbols damage-glyph font ships in the
  vendored design system under Autarch's author grant.

## 4.17.0

### Added
- **You can write a class's paths by hand.** The Paths tab lists a class's
  groups; now it also builds them. **+** adds a group, **+** inside it adds an
  option, and each option takes the weapons it grants, the heaviest armour it
  allows and its fighting styles — or the group can be pointed at the class's
  starting templates instead. 4.16.0 shipped the paths themselves with no way
  to author one and no importer writing any, so every class read "No paths";
  this is the half that makes them reachable.

## 4.16.0
## 4.16.0

### Added
- **A class can offer paths, and a starting template is one of them.** Some
  classes are not one thing: a Barbarian's training depends on their region, a
  Zaharan has a dark path, a dwarf has a caste. A class sheet now has a **Paths**
  tab holding those groups — one choice from each — and an option may carry its
  own weapon, armour and fighting-style training, which is how a class whose
  training differs per region states it at all. Applying a class asks once per
  group, with whatever the character already chose pre-selected; choosing again
  swaps the training rather than adding a second, and a group left unanswered
  grants nothing rather than picking for you. Taking a template that names a
  variant answers its group — "Pit Fighter (Jutland)" chooses Jutland — while a
  template naming none leaves your choice alone.
  *Your starting templates are one of these groups and nothing about them moved:
  the same rows, the same package bundles, the same 3d6 table. A world that
  upgrades has nothing to migrate.*

### Fixed
- **The class sheet's tabs are words again.** The Paths strings were added in a
  shape `lang/en.json` does not use for that section, and every other label in
  the class sheet — Overview, Progression, Awards, Casting, Templates, Inventory
  — stopped resolving and rendered as raw key names. Caught before release by
  the release snapshot, which is what a snapshot is for.

## 4.15.1
## 4.15.1

### Fixed
- **A class's combat training reaches the character who took it.** Every class
  states what it is trained to fight with — which weapons, how heavy an armour,
  which fighting styles — and that statement has never left the class document.
  A Mage in full plate reported as proficient with it; no character has ever
  been untrained with a weapon or a fighting style, whatever their class said.
  The training now arrives on the character when the class is applied, so a
  Mage in plate is out of their depth, a Thief is held to leather, and a
  Fighter is not held to anything. Applying a second class removes the first
  one's training rather than leaving a character trained by both, and re-
  applying the same class replaces what it wrote before instead of stacking it.
  A class that states no training still writes nothing, and that character stays
  unrestricted.
  *Characters already made keep whatever they have until their class is applied
  again — the class picker, the level-up wizard and chargen all do it.*

## 4.14.4
## 4.14.4

### Fixed
- **Armour on the character is armour the character is wearing.** A suit could
  sit under Worn & Wielded while contributing nothing to Armour Class: the panel
  was reading where a piece of gear sits, which survives being taken off, rather
  than whether it is on. Unequipping through the system's own control left the
  two answers disagreeing, and the sheet believed the wrong one. It now asks
  whether a thing is worn before asking where it goes, so what the panel lists
  and what your AC counts are the same set of things.
- **Imported armour and weapons can be worn without being annotated first.**
  Putting one on quietly did nothing at all — the wear model refused any gear
  that had not been told which slots it has, and nothing the importer creates
  has been told yet. A sword or a suit of armour now goes on when you put it on,
  annotated or not.

## 4.14.3

### Fixed
- **A piece of starting gear keeps the price its page printed for it.** The
  templates name a good deal of gear the shop list has no row for — a
  bladedancer's head dress, a silver amulet, an ornamental crystal ball — and
  price it where they name it. That value now arrives on the item, and it wins
  over a catalogue base's own price where there is one: a staff the page
  describes as worth 45gp is worth 45gp, not what a plain staff costs. Repairing
  a package carries the printed price across instead of replacing it with the
  base's.

## 4.14.2

### Fixed
- **A base is found by the words the page uses for it.** The books' own price
  list writes a name head-first with its qualifier after a comma — "Rations,
  Iron", "Saddle and tack, Riding" — while a template describes the same thing
  as English, and a slash names one row by either word ("Waterskin/Wineskin").
  Rebuilding a package reads each piece by its printed description alone, with
  no import reference to help it, so until now it could not put those two
  spellings together: rations, rope and waterskins came back as inventory with
  nothing behind them.

## 4.14.1

### Fixed
- **A template's gear is what the page names it, not the first thing that
  shares a few letters with it.** A starting sword arrived on the character
  sheet as plain inventory rather than a weapon, and it was not alone: the
  match that finds a base item behind a printed description could not see a
  name of four or five letters unless the description ended exactly where the
  name did. Torches, darts and swords — printed in the plural, as a character
  carries them — matched nothing at all and came through as trinkets with no
  damage on them. A short name is now found as a whole word of the
  description, plural included, while a name buried inside a longer word still
  matches nothing: a mace is not found in a grimace.
- **A class's own copy of an item never stands in for the item itself.**
  A package skins its gear by copying the base document, and the copy came
  away carrying the base's identity — so a world could hold a dozen documents
  all claiming to be the Staff, and a lookup for the Staff could answer with
  one template's "aged and dusty staff". The next template then skinned itself
  over *that*, and the drift compounded. A skin now keeps only its own record
  of what it is a skin of, and a lookup for a definition passes over every
  package part on its way to the real one. Worlds that already hold
  mis-stamped copies are covered by the second half of that on sight; nothing
  needs deleting.

Both fixes reach an existing world through **Build packages** on a class's
Templates tab (or the importer's *Build Class Template Packages* macro), which
retypes gear that came through as bare inventory and leaves anything you have
edited alone. A package whose gear was welded together by the older import —
one item named for two weapons — is not repaired by that pass: detach that
class's packages, delete the welded documents, and build again.

## 4.14.0

### Added
- **A map alignment and token scale assistant.** Open it from the token
  controls (or the scene's configuration): drag boxes over the map's drawn
  squares, click grid corners, or drag along its printed scale bar, and the
  assistant best-fits the scene grid to the image — offset, cell size, and
  what a square is worth, with the derived value shown for you to confirm or
  round. Stretched scans fit each axis independently; crooked ones report
  their skew and can be baked into a straightened copy of the image (your
  original file is never touched). Applying the grid and rescaling tokens are
  separate buttons: tokens size to their real footprint at the scene's scale —
  monsters by their size category, everything else man-sized — with a hotbar
  of footprint chips for the selected tokens and a reset back to defaults. A
  calibrated scene sizes tokens as they are dropped; the output square is
  yours to choose, so a wilderness sheet drawn at 100' a box can carry a 5'
  combat grid.
- **A class's starting templates become packages you can repair.** Each printed
  template can be built as a container item holding the actual abilities and
  gear it hands over, linked from a 3d6 roll table on the class. When an import
  gets a piece wrong — a Wonderworker Messiah's staff arriving as plain
  inventory instead of a weapon that can be wielded — open the package, fix that
  one item, and every character generated from that template afterwards gets the
  corrected version. Repairs survive re-importing: anything you have edited is
  left alone and reported rather than rewritten. Packages draw from your
  imported items without altering them, and **Detach all packages** on the class
  sheet puts a class back to applying its printed entries exactly as before.

### Changed
- **The party token wears the formation's face.** Instead of staying pinned to
  one square, it is now as wide as its marching frontage in feet — each body's
  width is the new **March width per body** world setting — and as deep as its
  ranks, at whatever scale the scene uses. Turn the column east and the token
  turns with it. Set frontage on the party sheet as always.

### Fixed
- **Imported rules tables land readable, filed, and removable.** Materialized
  roll tables are named for readers instead of raw dotted keys, filed under
  per-source subfolders of "ACKS Imported Tables", survive being renamed or
  refiled by a GM, and the importer's Remove All Imports can now sweep every
  document materialization created — documents only, so the imported values
  stay registered and a re-materialize rebuilds them without a re-import.
- **Starting gear with a short name resolves to the real item again.** A
  template naming a staff, mace, spear, sword or sling could never match the
  item it meant — only names of six letters or more were ever considered — so
  that piece arrived as an un-wieldable plain item however well it was imported.
  Names now match exactly at any length, with shorter ones matched on word
  boundaries so a "grimace" is never mistaken for a mace.
- **Templates find what you imported into a compendium.** Where the importer was
  pointed at a compendium rather than the world, a template's proficiencies and
  base items could not be found at all. They are now resolved from your imports
  either way — and copied into the world, where you can edit them.

## 4.13.1

### Fixed
- **The Source tab names three more reasons a field was left alone.** An armour
  class stated in words rather than a figure, saving throws quoted as another
  creature's, and printed letters that make up no complete save row are all
  reported by the importer as of 2.11.0 — without these the tab showed an
  internal key where the explanation belongs.

## 4.13.0

Where a converted creature came from, and what was left alone.

### Added
- **A Source tab on creatures imported from another game's book.** Import a
  monster from an Old-School Essentials adventure with acks-importer 2.10.0 and
  its sheet grows a tab showing the stat block exactly as printed, every field
  that was converted with the rule behind it, and every field deliberately left
  alone with the reason. If a number looks wrong at the table, that is where you
  check it against your own book. Monsters you built yourself are unchanged and
  show no such tab.

# Changelog

## 4.12.0

Traps stop announcing themselves, and the thief chooses which one to kneel at.

### Added
- **The party searches for traps on its own, and silently.** A thief moving at
  exploration speed now throws against every hidden trap the party passes
  within 5' of — 10' with a pole — and not only the one it was walking into.
  The throw is made against the ground the party actually walked, so a pit
  beside the corridor gets its chance; it is whispered to the Judge only when
  something is spotted, and nothing at all is posted when the throw fails. Each
  character gets one attempt per trap per level, which is the price the book
  puts on a hasty search.
- **A Trapbreaking dialog, with a target picker.** Choose who is working on the
  trap, WHICH trap, and whether they go at it hastily or methodically, and see
  the throw before spending the round or the turn. It lists only traps within
  5' that the party has found — a party halted in a corridor can be standing at
  more than one, and offering an unfound trap would give it away. Players open
  it from the party sheet whenever one of their characters could make the throw
  at all, including a non-thief going at it methodically; the Judge's client
  rolls it, as with every other player declaration. A Judge additionally sees
  the traps in reach the party has not found, with a control to mark one
  spotted for a discovery made some other way.
- **Traps have a hidden stage and a known one.** A player is shown nothing at
  all while a trap is armed and unfound. Once the party finds it, springs it or
  disarms it, the marker is theirs too — which is also what gives the
  Trapbreaking dialog something to point at.

### Fixed
- **The trap tool no longer leaves a wall-drawing tool armed.** Pressing "lay a
  trap" while the wall tool was selected drew the non-blocking tripwire, told
  you to drag its ends into place, and then made that drag draw a brand-new
  fully blocking wall across the corridor. The tool now hands back the select
  tool, so the drag moves the tripwire instead of walling the party in.
- **One press of a trap tool does one thing.** Foundry calls both handlers on a
  toolbar button, so every press ran twice — the line tool laid two tripwires
  on top of each other, and the door helper opened two dialogs.
- **A trap area is a Judge's secret again.** Trap Zone regions are created
  GM-visible: players are given the Regions control, and Foundry's default
  draws a region for anyone who opens that layer.
- **A trap nobody has found cannot be disarmed.** Working on one used to be
  allowed, which both departs from the book — you find a trap, then you disable
  it — and told the party a trap was there.

## 4.11.6

The money in a vault nobody can open comes back.

### Added
- **Recover Coin from Unloadable Locations (GM).** A safehouse or vault built
  by one of the pre-merge modules is an actor of a sub-type that no longer
  exists, so the world refuses to open it — and the coin inside it is embedded
  in a document nobody can reach. The new macro reads it out anyway, lists what
  each location holds and what it comes to in gold, and mints it onto an actor
  you pick. It changes nothing else: the locations stay exactly as they are,
  and the cleaner is still what removes them afterwards. Run it once — pressing
  it twice mints the coin twice.

### Fixed
- **Clean Up After the Merge finds the encounter zones too.** It swept actors
  and items, but a region behaviour hangs off a region inside a scene and is in
  no world collection, so an encounter zone drawn by the old formation module
  survived the clean-up and went on failing on every load.

## 4.11.5

A wagon carries things.

### Added
- **The hold lists what is in it.** Drag an item onto a vehicle to load it, and
  it appears in the hold with its weight and, where it stacks, a count you can
  change. Its weight was always counted against the hold — that is what the bar
  has been measuring — but there was no way to see what made up the figure, add
  to it, or take anything out. Loading moves the item off whoever was carrying
  it rather than copying it, so a cart cannot double the party's supplies.

### Fixed
- **Editing a harnessed animal no longer forgets which animal it is.** The
  first attempt at this in 4.11.4 did not work: by the time a submission
  reaches the sheet it has already been filled out against the schema, so a
  name that was never on screen arrives blank and is indistinguishable from
  one deliberately cleared. Only the fields the sheet actually shows are now
  taken from it. This also keeps a crew role's identity when its numbers
  change.

## 4.11.4

A team is counted, and editing one no longer forgets the animals in it.

### Fixed
- **Changing anything about a harnessed animal no longer erases which animal
  it is.** The team rows carry a name and a link to the animal's own sheet,
  and neither has a box on the sheet — so picking a different kind for one
  rebuilt the row from the two boxes that do, and the horse came back nameless
  and linked to nothing. Rows now keep everything the sheet does not show. The
  same applies to a vessel's crew roles and its speed table.

### Added
- **A team row says how many animals it is.** A four-horse wagon was four rows
  to create and four to unharness; it is now one row with a count, and the pull
  it contributes counts the whole stack. Rows made before this are one animal,
  which is what they already were.

## 4.11.3

A class trained with hammers can use one.

### Fixed
- **A hammer named the way a class names it is recognised.** Class training
  lists the weapon without its prefix, and the weapon grouping it belongs to is
  written the same way, so a character trained in hammers was read as
  non-proficient with the only hammer there is.

## 4.11.2

Editing one level of a trap leaves the other five alone.

### Fixed
- **A trap keeps all six of its levels when you edit one.** Setting a trap to
  its 4th level and changing anything on it — the damage, the save, the text —
  replaced the whole trap with that one level: the rows above it vanished and
  the rows below it were emptied. The sheet shows one level at a time, and only
  that level was being written back. It now rebuilds from what the trap already
  holds and changes only the row you were looking at.

  A trap imported from your book can be imported again to restore it. A trap
  you typed by hand cannot: whatever the other five levels held is gone, and
  this release cannot bring it back.

## 4.11.1

A trap knows what it does at every level it is printed at.

### Changed
- **A trap is one document at six levels.** The books print each trap at all
  six, and a trap document described exactly one — so a scything blade used at
  1st and wanted at 4th was two documents, kept in step by hand. Each trap now
  carries a row per level, and the level you set on it chooses which row fires
  and which one you are editing. Everything that does not change with the level
  — what springs it, how crudely it was built, whether it catches one man or a
  radius — stays where it was.
- **Each level keeps the book's own sentence for it.** Beside the typed damage
  and save sits the printed text for that level, so there is always something to
  check the numbers against.
- **The sheet shows one level at a time**, with a strip of the six numerals
  marking which of them have anything filled in. A trap imported from your book
  states all six; one you wrote states the ones you filled.

## 4.11.0

An item's differences are documents you drag onto it, and a class stops hiding
the answer you already have.

### Added
- **A variation is a document, and applying it is putting it inside the item.**
  Masterwork, silver plating, a notch, a stranger's crest, a name — each is an
  `acks-extras.variation` Item, and it goes onto a sword the way a rope goes
  into a backpack: drag it on, and it is listed under what it changed until you
  take it off. Several can be true of one blade at once, and two of the same
  kind cannot: the refusal names the one already there. The item's attack bonus,
  damage, AC, weight and price recompute from its plain self every time, so the
  numbers are always the sum of what is on it now.
- **A variation has its own sheet**, so a Judge with no imported book writes
  one: what it is, what it changes, what it costs, and who may know about it.
  Nothing about variations waits on an import.
- **Hidden and legible are separate questions.** A concealed variation still
  does everything it does — a disguised magic sword hits as a magic sword — but
  the players see the item without it and priced without it. An inscription in
  a tongue nobody present reads is visible and not understood, which is a
  different state again.
- **The Judge can be asked for a proficiency the character already has.**
  Applying a class offered, for each choice, only proficiencies the character
  did NOT hold, so a rung whose real answer was "I have that" had no truthful
  answer and the way through it was to pick something unwanted and delete it
  afterwards. A held option is now shown and grouped first; choosing it closes
  the choice and grants nothing. Beside the options sit "already covered", for
  the proficiency the rung never listed, and "leave open", the one answer that
  closes nothing.
- **A starting package can be chosen when a class is bound from the picker** —
  the gap a character bound from their own sheet fell into. Opt-in, defaults to
  none, and it is added to what the character already holds rather than
  replacing it.

### Changed
- **The class picker is the Scores Generator's own layout.** The column for
  attribute dice gives way to the level being set and the ladder picks that come
  with it, then the class and its starting package, then the opening choices —
  so one question is worded one way wherever it is asked.
- **A choice answered anywhere is remembered.** The level-up wizard and
  character generation now record an answered rung the way the picker does, so a
  character levelled to 5th no longer meets every choice they ever made a second
  time when their class is re-applied.

### Removed
- 4.10.0's variation entry list, replaced whole by the documents above. It
  shipped as groundwork with no interface and no way to create an entry except
  through the API, and an entry was only a key — the definition it needed lived
  in a register no world had filled. Converting one would have produced an empty
  document, so nothing is converted. **Not yet:** the masterwork, silver and
  shield-variant fields on the Construction tab still work as they did, and
  still hold their own numbers. Until the importer can publish those as
  documents, whichever of the two you use owns that kind of difference — the
  other is refused by name so the same change can never count twice.

## 4.10.4

### Added
- **A proficiency or power that grants languages now buys the slots.** The
  Language proficiency grants three tongues and is explicitly repeatable, so
  taking it twice buys six; the Judge's Journal custom power that does the
  same grants its three. They are never gated on Intellect — the book offers
  the proficiency to a low-Intellect character precisely so they can become
  literate in what they already speak. Any ability you mark yourself with a
  `languageGrant` flag grants that many, so a homebrew power joins in without
  waiting on this module.
## 4.10.3

### Fixed
- **A granted "Common" finds the language your book actually names.** The
  books grant a tongue by its short name where the taxonomy prints it in full,
  so a class granting "Common" was minting a second, bare language beside the
  "Common Auran" already in your world. A granted name that is a word-prefix
  of exactly one language adopts that language; anything ambiguous still
  creates what was printed, because guessing between two is how a character
  ends up speaking the wrong one.

## 4.10.2

### Fixed
- **The language box says what it now takes.** Its hint still invited you to
  drag a language *ability* onto it — the shape 4.10.1 replaced — and dropping
  one is refused. The hint asks for a language, and the refusal explains that
  an ability dropped there is an older copy from before the change.

## 4.10.1

Languages are documents now, and Polyglot can see them.

### Fixed
- **A language your character speaks is a real language item.** The system has
  its own `language` type — it gives languages their own section on the
  character sheet, and the Polyglot support the system ships reads that type
  and nothing else. This module was recording tongues as names inside a hidden
  field on an ability, so a character who spoke six languages appeared to speak
  none: not on the sheet's Languages list, and not to Polyglot. What a class,
  a race or a player's own pick hands over is now a document, where everything
  already looks for it.
- **A named language finds the one you already have.** Granting "Common" looks
  for it on the character, then among the world's languages, then in the
  system's own compendium, and only builds a new one when nothing answers — so
  you end up holding the world's language, with its description and art,
  instead of a bare namesake of it.
- **Your existing characters convert themselves.** On first load every tongue
  recorded the old way becomes a language item on the character that spoke it,
  and languages imported as abilities become languages. Nothing is removed
  until its replacement exists.
- **Open slots still work the way they did.** The "Languages (open)" ability
  keeps counting what Intellect and your class or race still owe you; picking
  or dropping one now hands the character the document. Delete a language off
  the sheet and its slot is free again.
- **Polyglot is told about the languages you imported from your own books.**
  The system's support reads only its own compendium, so a tongue out of your
  Revised Rulebook was known but missing from the chat selector.
- **The Languages compendium hides on the right test again.** The check that
  folds it away counted abilities; it counts languages.
- **A henchman's carried weight shows to everyone who can see the card.** The
  system computes encumbrance only for an owner or the GM, and the Follower
  Card read that figure straight — so a fellow player, or a hireling whose
  ownership never reached them, saw 0/0 with nothing to say it was stale rather
  than true. It now falls back to the owner-independent weight sum already used
  for mounts and monsters. What an owner or GM sees is unchanged.
- **A movement speed shows all of its digits.** The six movement fields share
  a narrow input width the system sized around two-digit saves, so Charge and
  Run in the hundreds — and the tenth on Climb and Stealth — had their tails
  clipped, with no amount of resizing bringing them back. Those six fields get
  the room their numbers need; every other narrow field is untouched.

## 4.10.0

Groundwork. Nothing on a sheet changes.

### Added
- **Items can record what they ARE** — weapon, armour, shield, clothing, gear,
  food, gem, coin, trade good — instead of it being guessed from their name.
  Nothing is guessed differently yet: anything undeclared is still worked out
  the way it always was, and there is no control to declare one with. This is
  the vocabulary the rest of it needs.
- **A model for the ways one item differs from a plain example of its kind**,
  published on the equipment api: an ordered list an item carries, definitions
  imported from your own books, and one resolution that answers both what the
  item IS worth and what it APPEARS to be worth. Concealing a variation hides
  it from the players and from the apparent price while it goes on working.
- **The old masterwork, silver and condition controls are untouched** and feed
  the same calculation, so nothing you own changes in any way.

### Not yet
- **There is no interface for any of this, on purpose.** The definitions come
  from `acks-importer`, which does not build them yet, so a list on the sheet
  today would be a picker with nothing in it dressed up as a feature. The
  interface ships when there is something behind it.

## 4.9.2

### Fixed
- **A trap that missed you no longer reports damage.** The damage line was
  printed beside the throw rather than worked out from it, so a trap whose
  attack missed still showed a number, and a victim who made their save got the
  same number as one who failed. The card now carries what the victim actually
  took.
- **What a made save is worth is now the trap's own business.** A new field says
  whether beating the throw halves the damage, avoids it entirely, or buys only
  the rider — the book's traps disagree, and assuming one of them was wrong for
  the other two.
- **The man on the left stops springing every trap.** Everyone in a rank throws
  separately, which is right, but they were always thrown for in file order and
  the sequence stops at the throw that springs the trap — so whoever stood
  leftmost took every pit in the dungeon. A rank is now shuffled; ranks are
  still met front to back.

## 4.9.1

### Fixed
- **Trapping a wall no longer changes the wall.** Laying a trap used to strip a
  wall's movement, sight, sound and light so a tripwire would not seal the
  corridor it sat in — which also meant trapping a secret door quietly stopped
  it being secret. A trap is a layer now and nothing else: whatever the wall did
  before, it still does.
- **The trap tool draws its own tripwire.** With nothing selected it creates a
  one-square wall that blocks nothing, left selected so you can drag its ends
  into place. That is the corridor case the old behaviour was trying to solve.
- **Enclosing the same outline twice reuses the area instead of stacking a
  second one**, and moving a trap into an area now lifts it off the walls that
  drew the outline. Two overlapping trap areas each rolled their own secret
  throw, so the party met one trap twice for walking in once.
- **Trap markers no longer hide behind each other.** Two traps sharing a point —
  a trapped door beside core's own door control, or two segments drawn over one
  another — now lay out in a row, centred on the spot.
- **Hint text says what the field does, not what the book says.** Roughly eighty
  shipped strings and compendium descriptions quoted or pointed at page numbers
  — settings hints, item descriptions, the trap sheet added last week. They now
  describe the control in front of you. Every number stays exactly where it was:
  the rules the module performs are unchanged, and nothing rolls differently.
  Where a hint got shorter, the explanation it used to carry will come back from
  your own books through `acks-importer` rather than from this module.

## 4.9.0

A trap can be buried where the party will walk, and every ACKS compendium files
under one folder.

### Fixed
- **A masterwork sample says which tier it is.** The two shipped masterwork
  items carried a copy of the table row instead of the tier key, so the sheet's
  masterwork select read "None" on the very items that exist to demonstrate a
  tier. They now name their tier and carry the pristine baseline that has to
  come with it — without it, clearing masterwork would have left the +1 and the
  higher price behind.
- **A compendium no longer strands itself at the sidebar root.** Every ACKS pack
  pointed at a folder that no longer existed, and Foundry only files a pack whose
  config does not already name one — so a stale id left by a deleted folder
  defeated every folder declaration silently, the system's own five included.
  A reference that still resolves is a Judge's own arrangement and is left alone.
- **A marching-order call that is wrong is refused, by name.** Reversing
  `saveTemplate`'s arguments used to save an order with no cells in it, named
  after whatever the formation stringified to, and hand an id to
  `applyTemplate` and it quietly rearranged nothing. Both now stop and say what
  they wanted — *"arguments are reversed — the formation comes first"* — and the
  applying calls take a saved order **or its id** interchangeably, so the
  commonest mistake is no longer a mistake. Every call that writes says so
  beside its signature; `reconcile` remains the one that only computes. No
  correct call changes. A macro that was silently saving empty orders will now
  fail loudly, which is the point.

### Added
- **Every ACKS compendium sits in one "ACKS II" folder.** The two modules'
  six packs and the system's own thirteen gathered together instead of scattered
  down the sidebar root. Both manifests name the same folder, which is how
  Foundry merges them into one rather than one per module; the system's packs
  are filed the same way its own initializer would.
- **Traps.** The whole of the delve chapter's trap rule, and the largest one
  that was still resolved by hand. A trap is an **item** — its level, what
  springs it, whether it is crudely built, how it resolves and what it deals —
  so one trap can be laid in four corridors and edited once.
- **Two ways to bury one**, both on the Walls layer: lay a trap along selected
  walls, or enclose a closed loop of walls as a trap area. A trap on a wall
  **blocks nothing** — the wall keeps doing its own job, which is what lets a
  door be trapped and still be a door — and the party is stopped at the crossing
  when the trap is found or springs, rather than three squares later. Drag a
  Trap item onto a wall, onto a wall's sheet, or onto a region's Trap field to
  assign it.
- **The party meets a trap in the order the sequence of play gives.** Anyone
  searching throws first, and a thief who makes it spots the trap before anyone
  touches it; then the 10' pole, one square ahead of its bearer; then the party
  rank by rank, each on its own secret 1d6. The first throw inside the trigger
  band springs it. A pole-sprung trap catches nobody in its own square, though
  an area effect still reaches back for the bearer. At combat speed there is no
  pole and no searching.
- **Hasty and Methodical Trapbreaking**, with the parts of the throw shown
  before it is rolled. Hasty is skill-only, costs a round, goes off on an
  unmodified 1–3, and cannot be retried until the character gains a level — the
  module remembers who failed and at what level. Methodical costs a turn, adds
  +4 for a skilled thief, lets a non-thief try through Adventuring, goes off
  only on a 1, and may be tried again. Beat it and the thief chooses: disarm it,
  and it can be re-armed later, or discharge it deliberately and spend it.
- **You see your traps; the players see nothing.** A marker on each trap shows
  whether it is armed, spotted, disarmed or spent, drawn only on a Judge's
  client — the same bargain a secret door makes.
- **Damage is reported, not applied.** The card carries the number and the
  sheets stay yours, so a made save can be halved and a rider can be set aside.

### Changed
- **Hiding superseded compendiums is now on by default.** A feature whose whole
  purpose is to remove duplicate rows did nothing unless a GM went looking for
  the setting. It is safe on because it is coverage-gated: a world that has
  imported nothing hides nothing.
- **The Languages compendium folds away once your own book supplies them**, and
  Treasure no longer does. All 58 languages come back from the reader's own
  book and neither side carries an effect, so nothing is lost by hiding the row;
  Treasure was only ever gated on "five imported roll tables of any kind", which
  says nothing about treasure and hid a pack nothing replaced.
- **Trapfinding is a bonus, not a throw.** It was listed as a throw of its own
  and is not: it is +2 on Searching *and* Trapbreaking, which the party rolls
  already applied. The finding throw is the hasty Search the party always had.
- The point-in-region geometry the Encounter Zone used is now shared with the
  Trap Zone rather than copied. No behaviour changes.

### Not yet
- The Judge's book prints eleven worked traps at six levels each. **None of them
  ships here** — they are book content, and they will arrive through
  `acks-importer` from your own copy, the way the thief ladders do. Until that
  recipe lands, traps are made by hand, which is a first-class path and not a
  workaround.

## 4.8.0

The column points where the party is going, a marching order can be saved and
put back, and a chasm is measured rather than rolled against.

### Added
- **The column trails the party.** Deployed members were laid out rightward and
  downward whatever direction the party faced, so a company marching west
  trailed its line east. The block now files along the party token's own
  heading. **A party whose token has never turned now trails north instead of
  south** — Foundry's zero rotation is southward, and marching north reproduces
  the old arrangement exactly.
- **Saved marching orders, and a form-up button.** Keep an arrangement and put
  it back: who stands where, which roles they hold, and the frontage. A member
  who has since left is dropped and the line closes up; a newcomer keeps their
  place at the back; a role whose gear is gone is refused exactly as the roster
  refuses it, and each is counted and reported. Form-up gathers anyone standing
  on the map back inside the party token, refuses during combat, and costs no
  dungeon turns.
- **Jumping.** Its own derivation, not a seventh row of the climbing table: a
  gap is a distance against a width, not a throw, so `canClear` answers with the
  range and how many faces of the die clear it. Standing and running leaps,
  encumbrance, creature scaling, and what a failed landing costs.
- **A throw can name a published ladder.** A progression target could only ever
  read the attack rows, so "as a thief's Climb Walls at half his level" had to
  be retyped as rungs on every ability wanting it. Naming a table reads that
  ladder instead — by the last rung the level has reached, which is what keeps a
  character from losing at 5 the rung they climbed at 4.
- **A vehicle shows the buckets it actually has** — a wagon is in-harness,
  driver, passengers and cargo; a vessel is crew, passengers and cargo with no
  draft team offered. The complement is labelled by what it MEANS, since the
  books use one column for a driver, a chariot's crew and a howdah's passengers,
  and the buckets sharing a pool are marked.

### Fixed
- **Jumping shipped printed tables and no longer does.** The attribute-modifier
  bands and Acrobatics' own numbers were baked into the module; the modifier now
  comes from the character sheet, which the system already computes, and the cap
  and save bonus arrive with the imported proficiency. That refactor exposed a
  trap worth knowing: `Number(null)` is `0`, not `NaN`, so a defaulted option
  read as "supplied zero" — it was capping uncapped scores at zero and zeroing
  every modifier.
- **Eight test suites reproduced book values as assertions** and are no longer
  distributed. They still run on a machine that owns the books; a fresh checkout
  runs the thirteen suites that assert only what this module's own code does,
  and says how many it skipped.

## 4.7.0

Deep water, a way back to the generator, and every element on every sheet
finally dressed by something.

### Added
- **Deep water is its own rule.** Swimming looked like a seventh row of the
  climbing table and shares nothing with it: the target is what the swimmer is
  CARRYING, so a naked man crosses freely and a mailed one is attempting an 8+
  he has no business attempting; it is thrown every round rather than once per
  hundred feet; and failing it does not cost progress, it starts a drowning —
  no actions, no further throws, sinking ten feet a round for every stone,
  with breath measured in Constitution and a rescuer lifting the whole body
  plus half its baggage. Cold and rough water make it worse for everyone,
  including the swimmer carrying nothing.
- **A character can be sent back through the Scores Generator.** The system
  offers it only while it considers a character new, and clears that on the
  first update touching scores — so a character built by hand could never be
  sent back, and the page had no way in. There is now a control beside the
  class picker, behind a confirmation that names how many items generating
  again would replace.

### Fixed
- **Fifty-four elements were dressed by nothing.** Across all eight features,
  templates wrote `acks-*` classes that no stylesheet mentioned — the element
  inherited whatever it happened to inherit and the layout its author had in
  mind never existed. Nothing errors when that happens, which is why it built
  up. One of them was a wrong name rather than a missing rule: a button asked
  for an emphasis variant the design layer does not publish, and got none.
- **A door's throw, a group's stack, a rung ladder and a market queue** all had
  their structure written and never styled; they lay out now as they read.

### Toolchain
- Two silences are now gate failures. `audit-styles` fails on a class with no
  rule and on a rule reading a token nobody declares — the second caught an
  invented `--acks-row-alt` in this very release, which CSS would have dropped
  without a word. `audit-imports` resolves every named import against what the
  target module actually exports: a wrong name there is module-breaking and
  offline-invisible, and one shipped that way during this release before live
  testing found it.

## 4.6.0

The sea half of the vehicle rules, and two owner rulings that had been open
long enough to cost something.

### Added
- **A hull is not a big creature.** Most attacks cannot hurt a vessel at all —
  a man-sized or large creature swinging at a warship does nothing, which is
  what stops a boarding party emptying a ship like a sack of hit points. Light
  and medium ballistae reach a tenth of the way; huge creatures, heavy
  ballistae and the lighter catapults a third; siege artillery and the truly
  enormous the whole of it. A spell does a tenth to timber, multiplied by its
  own footprint.
- **Damage slows her, and says so.** A battered ship is a slow ship, in
  proportion to the hull she has lost — and casualties slow her too, but the
  two are **not cumulative**: whichever is worse governs, alone. The sheet
  names which one is in force, so nobody patches a hull to fix a speed the
  missing rowers were costing all along. At nothing left she cannot move under
  her own power and goes down in 1d10 rounds.
- **Repair, priced in hands and turns.** Five of the crew, one turn, one point,
  doing nothing else while they do it — and only half of what she took at sea
  can be put back before she reaches a dock. The sheet does that arithmetic for
  the hands actually aboard rather than leaving it to a Judge mid-battle.
- **A vessel keeps her own clock.** A voyage speed is miles over a TWELVE-hour
  day, because crewing is unstrenuous, where a marching party's is eight — so
  reading one against the other understates a ship by half. Both are now stated
  per hour, which is the only figure they share. Under sail in open water with
  a navigator and a full crew she may work around the clock: twice the distance
  in a day, at exactly the same speed.
- **Getting lost, and getting holed.** The Navigation throw each day and each
  night — a river is nearly unmissable, the open sea is not — with Pathfinding
  or Navigation aboard worth +4 and both together worth +8. Separately, the
  captain's Seafaring throw on entering water that holds a hazard, where
  slowing down helps twice: it makes the throw easier and halves the damage if
  she strikes anyway. Kelp holds her, rock and reef hole her, a shoal grounds
  her until the tide or until the crew throws enough cargo over the side.
- **Buckets, derived per vehicle rather than assumed.** What a vehicle has room
  for, and which of those buckets are the same room twice: a land vehicle pools
  passengers with cargo at its own printed rate, a vessel berths them apart and
  trades crew for hold at fifty stone a hand. The rate is the vehicle's own,
  because the books print it per vehicle and it is not linear — a small
  palanquin's first berth is fifteen stone and its second seventeen and a half,
  and the second passenger costs speed as well as room. What "crew" MEANS is
  per vehicle too: the books use one column for the driver, for a chariot's
  driver and warriors, and for a howdah's passengers.

### Fixed
- **A generated character rolls for their own hit points.** The Scores
  Generator never threw the die at all, so every generated character kept
  whatever the bare actor was made with — the same number every time, whatever
  their class or Constitution.
- **The formation is the party; core's is deprecated.** Storage reach asked
  both the marching order and the party actor and took either, which unioned
  two rosters: a character left in a stale party actor kept reaching a company
  they had stopped marching with. The marching order now answers alone where it
  answers at all, and the party actor is a fallback for a character no
  formation claims.
- **Every ACKS field is dressed the same.** A window carrying neither the
  system's `acks` class nor the design layer's opt-in on its fields was dressed
  by nobody, so most of this module's sheets rendered raw Foundry chrome inside
  an ACKS frame.

## 4.5.0

The party divides its own experience, and decides what to do about the people
who cannot walk out.

### Added
- **Deal experience from the formation window.** The division follows the
  book: everyone who returned takes a share *alive or dead*, henchmen take
  half — or whatever their own terms say, if the hiring negotiation moved it —
  and hired mercenaries and specialists take none at all, being paid in coin.
  Animals, wagons and summoned things are not party members and are listed as
  excluded with the reason, so a Judge dividing four thousand experience can
  see why the mule was left out. The whole division is shown as you type the
  total, before a point is given. The system's own button is hidden while this
  is on, and a setting puts it back untouched.
- **Leave the fallen, and still owe them their share.** Dead or unconscious
  drops that member's own speed to zero, which stops the column — until the
  party either carries them or leaves them behind. Leaving drops their token on
  the map where they fell and keeps them on the roster, so they still divide
  the treasure they died for.
- **Left in place means no tether.** A member left behind is no longer held to
  the marching order's leash, which makes the same gesture work for a camp, a
  parked wagon, or the packs everyone drops before a fight.

### Fixed
- **A tethered member frozen in place could roam anywhere.** A zero allowance
  was read as "no limit", so anything immobilised was exempt from the leash it
  most needed. A stated zero now refuses the move; a sheet that states no speed
  at all still has no limit invented for it.
- **A share is a percentage, not a fraction.** A full share is stored as 100,
  which mixed with a henchman's 0.5 put a henchman standing beside two players
  on about a two-hundredth of the loot instead of a fifth.
- **A wagon is not a casualty.** Vehicles sit at zero hit points their whole
  lives, so every cart in a formation read as a body on the ground and froze
  the party where it stood.
- **An open editor takes the full width, on every sheet.** A rich-text field
  opened inside a narrow column had its toolbar clipped away; that is now a
  property of the family's windows rather than of the one card that hit it
  first. The follower card's own field colours are restated so the sheet theme
  no longer quietly overrides them.
- **A power's ref is readable on a race rung.** The field was three and a half
  characters wide, which showed `def.pov` of `def.power.hardyPeople`. It is
  wide enough to tell two refs apart now, and grows while focused.

## 4.4.0

One relationship for everyone being carried, and an honest answer about what
they weigh.

### Fixed
- **A harness no longer lightens your horse.** What a mount or wagon bears was
  reading the rider's ENCUMBRANCE, which this module deliberately bends: an
  adventurer's harness ignores a stone of gear, a mounted shield rides
  lighter, a bowquiver counts as two items, a thrown weapon stops weighing on
  the hand that threw it. Every one of those describes how well a load is
  carried, not how much of it exists — so none of them may reach the animal.
  A carrier now bears the rider's body plus what their kit actually masses.

### Added
- **One relationship, four hats.** A rider on a horse, a passenger in a wagon,
  an ox in the traces and a rower at the bench are the same binding in
  different roles, and they are now modelled once: a flag on the carried actor
  naming its carrier. One writer per fact, so nobody can be aboard two things
  and a deleted wagon leaves no phantom roster. Each role states whether its
  weight counts against the hold (a passenger yes, a draft animal and a crew
  member no, per the book) and whether the carrier's speed replaces its own.
- **Board for best pace** loads everyone the vehicle would carry faster than
  their own legs — slowest first, since that is the member holding the party
  back — stopping when the hold is full, and never boarding someone who walks
  faster than the wagon rolls.
- **Re-board as before** puts everyone back exactly where the last change
  found them, so unloading at a ford and reloading on the far bank is two
  clicks rather than twelve.
- A named passenger is charged what they actually cost — body plus kit — with
  the book's fifty-stone berth as a floor, since a passenger takes a
  passenger's room whether or not they weigh it.
- **Expedition speed, by its proper name.** ACKS measures movement at four
  scales — combat and running in feet per round, exploration in feet per turn,
  and **expedition in miles per day** — and quoting one where another is meant
  is how a party ends up marching sixty miles down a corridor. All four are
  now named vocabulary, with the printed Expedition Speed table reproduced
  exactly (all twelve rows, in miles per day, hexes per day and miles per
  hour). A vehicle shows its day's march beside its pace per turn, and the
  day's pace can be a **forced march** (twelve hours for +50%) or an hour at a
  time as an ancillary activity (half speed). A forced march is not faster per
  hour — it is longer, and the miles-per-hour figure says so.

## 4.3.0

The ground a vehicle is on, and the two proficiencies that answer to it.

### Added
- **Terrain, and what a road is worth.** Grassland goes at full pace, barrens
  and desert and hills and forest at two thirds, jungle and mountain and swamp
  and mud and snow at half — and a road is worth half again on top, applied
  AFTER the country it runs through, because a road makes bad country passable
  rather than good. Heavy rain washes an earthen road out entirely, which is
  exactly when a caravan most wishes it hadn't.
- **Driving doubles the road.** A cart handled by someone with the Driving
  proficiency takes a road at twice speed rather than half again — and gains
  nothing at all off one, because what the proficiency buys is a better road,
  not better country. A driver on a swamp road makes exactly open-country pace.
- **Seafaring ranks**, and the one that matters at sea: taken three times it
  makes a master mariner, who alone can tack in a strong or very strong wind,
  at two-ninths speed. Everyone else simply cannot beat upwind in that weather.
- Land vehicles now say when the country ahead is closed to wheels rather than
  merely slow — desert, mountains, forest and swamp need a road.
- **Passengers ride, and the party knows it.** Drag a character onto a
  vehicle's hold to put them aboard: they weigh their fifty stone against the
  cargo like any other passenger, and — the point of the exercise — the party
  no longer marches at their pace. A member riding contributes the VEHICLE's
  speed to the slowest-member reckoning instead of their own legs, so loading
  the footsore merchant into the cart does what putting him in a cart should.
  A wagon with nothing in harness stops the party dead, which is also correct.

## 4.2.0

Vehicles arrive, and the formation burn-down finishes: the party can now get
through a door, past a wall, and down a road with something pulling it.

### Added
- **Carts, wagons, galleys and ships as documents.** A vehicle is four things
  at once and the sheet keeps them straight: a hold weighed against what is
  actually loaded, a crew whose gaps slow the vessel in proportion, a team of
  animals with the book's substitutions built in (an ox or two mules pull as
  one heavy horse), and a speed derived from all of it. The speed panel shows
  the real number and names every factor that reduced it — short-handed, a
  hungry crew, a stowed mast, the wind, or simply too heavy a load. Drag an
  animal onto the team to hitch it; a lame one stays on the roster and stops
  pulling.
- **The door helper, with spikes.** The four ways past a stuck door, and the
  state that makes one interesting: a spike takes a round, a door holds four,
  and each after the first costs -4 to force. The throw is shown before it is
  rolled and broken into its parts — Strength, a second pair of shoulders, a
  crowbar, size — so the party can decide whether heaving is worth the round.
  When no roll can succeed it says so instead of letting you find out. Forcing
  a door tears its spikes out with it.
- **Obstacles**, one member at a time: easy climbs and crawling traverses any
  adventurer may try, sheer faces and precarious ledges that need a real
  climbing proficiency — reported before anyone rolls, not as a failure. A
  fixed rope or a supervising mountaineer turns a sheer face into an easy
  climb for whoever follows.
- **Wandering monsters met on the wrong floor** come in different numbers and
  in a different mood: half again as many per level deeper, an equal penalty
  to their reaction, and the reverse going up. Set the dungeon level on an
  Encounter Zone and the monster level on the table; without both, nothing is
  scaled.

### Fixed
- Vehicles no longer log a data-preparation error on every update (the system
  prepares every actor type alike and expects fields a wagon has no use for).
- A door dialog label that shadowed its own children in the translation file,
  which silently blanked the surrounding text.

## 4.1.0

Roadmap burn-down: languages become real, the sidebar stops showing two of
everything, and six parked items ship.

### Added
- **Languages, as the books hand them out.** A class and a race each declare
  the tongues they speak and how many more they may choose; the two ADD (an
  elven fighter speaks what both bring, and a tongue printed twice is learned
  once), an Intellect bonus buys that many open slots that may be left empty
  and filled during play, and an Intellect penalty costs literacy rather than
  tongues. A character carries them in a slot-holding ability — fill one from
  the picker or by dragging a language onto it, empty one that was a mistake.
  Applying a class grants and REFRESHES the carriers, so a character whose
  Intellect rose gains the slots they are owed without losing what they chose.
  Which languages exist stays your campaign's answer: they arrive from your
  own books through the importer, or you name them yourself.
- **The Judge's own notes on a place**, beside the shared ones and readable
  only by the Judge, plus a note on any roster row or special hire — the
  storage those rows always had, finally with a surface.
- **Stock a lair by dropping treasure straight on it.** A compendium or
  sidebar item dropped on a location is filed under the house, so a hoard
  needs no placeholder character to own it.
- **Declare which ammunition to fire.** "The silver ones, now" — a nocked
  stack outranks the plain-before-silver default until it runs out.
- **An opposed influence contest**: the target answers with their own
  charisma and reaction effects, and the card reports who prevailed by how
  much. It moves no attitude — ACKS prints no band for one.
- Throws reorder in place on the Rolls tab.

### Changed
- **One of each thing in the compendium sidebar.** Once a world has imported
  content from its own books, the system compendiums it replaced fold away —
  coverage-gated, so a world that has imported nothing sees no change and a
  pack whose replacement is deleted comes straight back. Off by default;
  display only, with every pack still loaded and every link still working.
- **The example compendiums retire**: the bestiary, spoils and treasure
  samples, and the four sample characters. The importer builds 287 monsters,
  stamps spoils onto every one, and materializes 23 tables from your books.
  The equipment samples STAY — the JJ shield variants and masterwork gear
  they demonstrate have no importer coverage yet, which is now a recorded gap
  rather than a silent one.

## 4.0.0

The major: capacity answers once, money is physical, the light palette is a
real branch, and the formation record is a contract.

### Added
- **Money is a physical thing that always sits somewhere.** A payment is a
  location-gated transfer: the coins taken from the payer land on the payee's
  stacks — a purse, or a location's own till — and change comes back by the
  same smallest-first arithmetic, the one spend policy this release keeps.
  Market buys, sells, tolls, fees, commissions and cargo pay through the
  till; wages and signing bonuses land on the hireling, with what no changer
  can split booked as arrears until one is found. A market exchanges
  denominations freely (the Trade tab gains the changer); anywhere else
  barters, and the Judge's `exchangeOverride` outranks the derivation.
- **The house pile.** A location's own coin and stock are first-class storage
  rows under the house owner: the Judge takes freely, players take what the
  Judge marks retrievable, and a spoil is claimed through a proficiency
  throw. Empty locations that are nothing in particular self-clean at world
  start (setting-gated, default on).
- **One capacity primitive over any document.** `capacityStone` / `loadStone`
  / `overCapacity` in the shared lib answer for a character (core's own
  maximum, forced max included), a monster or mount (MM p. 13 loads, with a
  mounted rider counted at body weight plus carried gear per RR ch. 6, named
  on the sheet), and a container item against its nested contents. The party
  sheet's carry math reads the same primitive — a GM's forced maximum now
  reaches it.
- **The formation record is a published contract.** `api.formation` declares
  apiVersion 1: `marchingOrder()` (rank/file rows without token payloads),
  `ROLES`, `getFormations`, `rollPartyCheck`, `PARTY_CHECKS` — the surface a
  trap module keys on.
- **Market tills refresh to their market level.** Each market month the
  house till tops up to `system.market.tillTargetGp` — a stored field, not a
  buried formula, because trade routes will turn it. Unset, it derives once
  from urban families × monthly family income (an imported economy table
  when your books supply one; an explicitly-placeholder world setting until
  then) and writes itself back.
- A coin kind is its name AND rate: a debased local gold is a separate stack
  everywhere it travels; what a place gives for it is valuation, never baked
  into the stack.

### Changed
- **The design tokens split colour from structure, and light became a real
  branch.** A light-stamped application inside a dark interface now draws the
  light palette — derived tokens included, which exclusion alone could never
  fix — and the font-scale knob still reaches every themed window. Two
  palettes only; the core look withholds both.
- The monster model's defence bands are the shared lib shape (the same bands
  abilities store), each with a prose note; legacy free-text effects migrate
  once into the closed sets with the remainder kept in the note.
- The last v10-era `--color-*`/`--font-size-*` reads are swept from module
  styles, and the validator now refuses new ones.

## 3.10.1

### Fixed
- **A magic item sold is not destroyed.** Mundane goods leave play when sold;
  a magic item now passes into the market location's own holdings, markets
  flag intact — a real object a party could buy back or steal.
- The full-coverage hygiene sweep's High-severity findings: formation chat
  escapes document names at the sink and validates player-supplied light
  types, check keys and roles against their closed sets; the skill audit
  reports what the party roll will actually do (a Skill-unchecked item no
  longer shows active); committing follower-card overrides clears only what
  was baked, so the encumbrance override and itemless attack edits survive to
  Reset; a failed henchman transfer no longer rewrites the employment record
  toward an employer who never received the hireling, and says so; spendGold
  makes change in the purse's other denominations instead of silently keeping
  an overpayment; chargen's compendium coin lookups and influence's lib
  bindings fail loudly instead of degrading silently.

## 3.10.0

Item markets: buying and selling at ACKS II availability and prices, on a new
Trade tab every market location carries.

### Added
- **Item markets** — the location sheet's market grows a Trade tab: every
  priced item the world knows, with live monthly availability per party at
  the settlement's class (scarce goods as percent chances, the party's own
  roll first and the town's tenfold stock never contradicting a find).
  Purchases stack (quantity merge, or one bundle for thirty swords); sales
  price by condition-reduced value and leave play. Demand modifiers,
  Bargaining with opposed rolls, extended search days, the twelve-adventurer
  dedicated shopping day, and masterwork gear behind a Judge-set contact.
- **Merchant imports, directed searches, and commissions** — source goods
  from a local or regional hub (2d6 days or weeks, lost on a 12), post a
  standing search the merchant re-examines each market month, or have a
  craftsman build the item at the imported construction rates; everything
  delivers through one due-work sweep as game time passes.
- **The magic-item market** — items carry apparent value, rarity, and
  identification state on a panel the equipment sheet hosts; the JJ
  identification ladder is automated (any qualified character or henchman,
  level-gated retries); unidentified items trade at apparent value, fully
  identified ones at base cost, Tower purchases at 225%.
- **Mercantile ventures** — market entry with tolls and cargo impact,
  supply-and-demand assessment writing per-party beliefs (wrong ones
  indistinguishable), merchandise soliciting and trading at monthly rolled
  prices with spot-price negotiation; every dedicated day posts now and
  resolves as time passes. Trade networks remain on the roadmap.
- Market party rosters (settings menu); five new importer recipes deliver
  the availability, merchandise, market characteristics, magic-item
  transaction, and construction-rate tables from the GM's own books.

### Fixed
- Every gold-spending receipt threw at runtime (a bare re-export left
  `gmIds` unbound in the coin adapter) — caught by the markets live gate on
  its first purchase.


## 3.9.0

Stabilization release — the 2026-08-07 hygiene sweep's backlog applied whole,
plus two live bugs its full-coverage follow-up caught.

### Fixed
- **Combat Trickery picks crashed the equipment ability bridge** — a local
  variable shadowed the shared slug normalizer, so declaring a trickery
  maneuver threw instead of granting it. The maneuver grants flow again.
- **An unpayable bribe minted gold.** The bribe flow deducted what it could
  (down to zero), reported success, and credited the recipient the full fee.
  A fee the payer's gold cannot cover now fails cleanly: nothing is deducted,
  nothing is credited, and the "no gold" warning names the payer.
- Domain income for henchmen facts read fields the acks-domains schema does
  not have (and silently found nothing); it now asks the domains module's own
  published API, and warns once if the shape ever drifts.
- Henchmen pack Active Effects carried v14-deprecated numeric change modes;
  they now use the string forms, with a test guarding the contract.

### Changed
- Document-type checks across the module read one frozen vocabulary
  (`ITEM_TYPE` / `ACTOR_TYPE` in the shared lib) instead of ~160 scattered
  string literals.
- Sheet-base resolution (abilities, equipment, monsters, animal landing sheet)
  no longer adopts an arbitrary registry entry silently: real ambiguity warns
  with the chosen class, and the monster resolver only accepts the acks
  system's own registration.
- Drag-and-drop on the equipment sheet, influence app, and location sheet
  goes through the framework's DragDrop plumbing (declared options, cached
  instances, `getDragEventData`), and the deprecated `TextEditor` global
  fallbacks are gone.
- The wage guard registers through libWrapper (MIXED) so the one-owner-per-
  wrapped-method gate can see it.
- Swallowed failures now say what failed: template preloads, token sense
  syncs, and the abilities feature's silent catches log through the module
  prefix.

## 3.8.0

### Added
- **The class constructor gains an advanced mode — the Judges Journal's class
  builder, automated.** A Builder tab on the class sheet takes build values
  (Hit Die, Fighting with its 1a/1b split, Thievery with chosen skills, magic
  values, a racial value) plus trade-offs and custom powers, shows the
  accounting (points spent, power picks, the 2nd-level XP cost), and derives
  the whole printed spread on demand: XP schedule with the printed smoothing
  and post-8th increments, hit die and mortal-wounds bonus, maximum level from
  the racial cap table, attack throws, the saves chassis, cleaves, damage-bonus
  and thief-skill ladders, and one casting tradition per magic value from the
  printed per-value spell grids — including the delayed-acquisition variants.
  Derivation writes the same fields an import fills, so applying, levelling
  and chargen see no difference, and every value it uses arrives from your own
  book: the tables ship nowhere. Magic values are an open set — arcane and
  divine are just the first rows a world imports; ceremonial, gnostic,
  alchemy, eldritch, fairie or homebrew traditions are rows of the same shape.
- **Races are documents.** A new race item (`ACKS Race` sheet) holds the
  racial-value ladder — each rung's XP cost, level cap and granted powers —
  plus attribute minimums, always-on traits, and how the race stacks with a
  magic category (an elf's points raise its arcane value, at the printed
  discount). The builder spends the ladder of the race a class binds; a
  simple-mode imported class may bind one too.
- **Imported classes arrive as working examples.** With ACKS Importer 2.5.0,
  the Judges Journal table import stamps the printed Ready-for-Play builds
  onto the core and demi-human classes and materializes the Dwarf and Elf race
  documents — open any of the twelve on the Builder tab and Derive reproduces
  that class's own printed tables.
- **The docs site names its Patreon, twice and no more.** A header icon beside
  GitHub, and one line under every page's pagination that states the terms
  before the link: everything is free, nothing is gated.

### Fixed
- **Adjustment fields start empty, not standing in a zero you must clear
  first.** Situational bonus on attack rolls, the morale dialog's other
  modifier, and a throw's misc field all pre-filled with 0, so typing an
  adjustment meant selecting and deleting first. They now sit blank with a 0
  placeholder, matching core's own roll dialog; every reader of these values
  already falls back to 0 on empty input.

## 3.7.0

### Fixed
- **An occupied hand says what is holding it.** A character wielding a mace
  one-handed read `Hands 2/2`, and equipping a shield raised a yellow notice that
  removed the shield again without saying why. Both were a lit torch: the party
  sheet counts a burning or shuttered light as a hand held, which is the rule, but
  the light appears nowhere in Worn & Wielded — so the sheet looked like it was
  charging two hands for a one-handed weapon and then refusing a legal shield.
  The status line now names those hands (`Hands 2/2 · Single Weapon · 1 held for
  light`), and the notice leads with the count it was working from and what is
  using it. Douse the light and the shield goes on as before; nothing about what
  occupies a hand has changed.
- **Gear comes back out of a pack wherever you drop it.** Dragging a single item
  out of a worn backpack did nothing, while the container's empty-all button
  worked — so a pack could only be unloaded whole. Core prints one inventory list
  per item type, and only the first of them was wired to accept gear back; a rope
  released over Items, where a rope belongs, landed on nothing. Every list takes
  it now. Dropping gear onto a container to stow it is unchanged.
- **Dragging a coin row no longer mints a coin.** Picking up a currency entry and
  releasing it anywhere on your own sheet added one to that denomination, as if
  the coin had arrived from somewhere else — quietly, with no notice, every time.
  Foundry treats a drop whose item is already yours as a re-ordering, but the
  system reads the item's type first and sends money down the path that credits
  an incoming payment, which then found the row already on the sheet and topped
  it up. Coin dropped on its owner's sheet now sorts like every other row and
  writes nothing. Dragging coin into a pouch or out to a place is unchanged, and
  a purse arriving from a bundle still pays out as before. Worlds that have been
  dragging coin around should expect the count they see to be the count they
  have from here; the earlier drift cannot be told apart from spending after the
  fact, so nothing is unwound.
- **Handing coin to another character moves it instead of minting it.** Dragging
  a coin row onto somebody else's sheet used to copy the whole stack to them, add
  one to the copy, and leave the original where it was — hand over 100 gold and
  the table came away with 201. It now does what the gesture means: the stack
  leaves the giver and arrives on the receiver, merging into their existing row
  of that denomination rather than opening a second one, with their other coin
  untouched. It is the same transfer that stowing goods at a place already used,
  so it refuses politely if you do not control both sheets and says so loudly
  rather than quietly if only half the move lands. Coin from a compendium or a
  bundle has no giver to debit and still simply arrives.
- **A warning, an alarm or a success mark is legible on every seat.** Reported on
  the exploration party sheet, where the warnings — no mapper, no lit light
  source, someone carrying more than they can lift — rendered as pale type on a
  pale panel: there, and impossible to read. It was never only that panel. With
  **ACKS look** set to *System style*, the module hands its colours back to
  Foundry, and the three state colours were the ones it forgot to hand over — so
  a warning drew its panel from the ACKS palette and its lettering from Foundry's,
  and on a dark seat those are opposite answers. Everywhere the two met was
  affected. The states now follow the host like everything else under System
  style: the panel is a tint of Foundry's own warning colour with the window
  showing through, and the type on it keeps the warning's hue while staying
  readable on whatever ground the client is using. Six alarm glyphs that were
  drawn in the fill colour rather than the reading colour — the party sheet's
  warnings and distorted-map marks, a downed member's badge, the ability
  conflict hint, and two influence badges — are readable on both seats too.
- **A proficiency throw arrives on the same card as every other roll.** Throws
  posted as a bare line of text — no banner, no portrait, no marked result —
  beside attack and saving throws that had all three. A throw now posts on the
  system's own card: the ability named across the top, its image beside it, and
  the verdict with the number it was read against. A condition the book puts on
  the throw sits under the result, and a throw made from a compendium item still
  says why it cannot be scored.
- **Armour says what it is where you are reading about it.** An armour's AC and
  armour type, and an ordinary item's subtype and quantity, sat behind a tab
  called Rolls — where nothing is rolled, and one click away from the description
  they belong beside. They are back in the column next to the prose, and the
  Rolls tab now appears on weapons alone, holding the throws it is named for:
  damage, attack bonus, melee or missile, range and save.
- **The marching order's Frontage field is labelled.** It read
  `ACKS-FORMATION.APP.FRONTAGE` — the identifier behind the label rather than
  the label. Its tooltip was there the whole time and is unchanged.
- **A class power that grants a proficiency's rule now moves the same dice.**
  The bladedancer's three combat powers were inert: Weapon Finesse did not put
  Dexterity in place of Strength on her melee attack throws, Strength of Faith
  did not put Wisdom in place of Strength on her damage, and Graceful Fighting
  granted no initiative — all three had to be typed into the Tweaks tab by hand.
  Abilities were recognised by name, and a class power is filed under the class
  that grants it, so a power naming the very rule a proficiency already
  automated reached nothing. Powers are now read from what they *declare* rather
  than what they are called, so these three work on any bladedancer — and so
  does any other ability whose book states its mechanic, whatever its class
  calls it. Graceful Fighting's initiative applies only while she is dressed for
  it: light armour or less, five stone or less, the same clause Swashbuckling
  carries. A weapon that takes no damage bonus at all, such as a torch, still
  takes none.
- **A character with nobody else around can light their lantern.** The Light,
  Douse and Shutter controls only appeared for a character in a marching party.
  Alone, a lantern showed no control at all, so a lamp dragged onto a character
  sat there unlightable — and the flame icon on a bundle of torches is Ready,
  which pulls one out to carry, not a match. Any character can now strike, close
  and douse their own light from their sheet, and their token lights the room
  for it. It costs the same as it always did: a free hand, the lamp and a flask
  of oil, one of which is burnt. A party's lights are still the party's, tracked
  and burnt down by the marching order; a light struck alone has no dungeon turn
  to burn against, so it stays lit until it is put out.
- **A quiver of arrows is arrows.** "Quiver, 20 Arrows" was read as an empty
  quiver — the sheet showed it as *0 / 1 st, empty*, offered nowhere to put the
  arrows, and firing a bow spent nothing, because the twenty were written in its
  name rather than counted anywhere. It is now the ammunition it says it is, with
  a count that goes down as you shoot; it still rides your belt and is still free
  to draw from. A bolt case and a bundle of sling stones read the same way.
  **A quiver already in your world clears its phantom capacity when you run
  Annotate carrying gear** — and a half-empty one is not refilled by doing so.
- **A robe can be worn.** Clothing was recognised either by a marking the system
  puts on its own clothing items or by name, and the list of names covered
  belts, boots, gloves, cloaks, hats, necklaces and rings. A garment for the
  body was on neither list, so a character who arrived wearing low boots and a
  blue robe could put on the boots and not the robe. Robes, tunics, gowns,
  dresses, shirts, coats, jerkins, breeches, skirts and their kin are worn now.
  Nothing is assumed about their pockets.
- **A character cannot be made into a warehouse by accident, and can be made
  back.** The Enable Storage Here macro took whatever token was selected — so
  selecting your own and running it turned your character into a place other
  people leave their belongings, which the storage manager had always refused to
  do for exactly that reason. The macro now refuses too, and points at Give a
  character a vault. For a world where it already happened, see below.

### Added
- **Night vision sees twice as far as the light it is seeing by.** Only half of
  the sense was built: it brightened dim light to daylight, but indoors it
  granted nothing, so a creature with night vision and no lightless vision saw
  exactly as far as the torches reached and no further. Indoors it now carries
  **twice** the reach of the brightest light covering it — a creature standing in
  a torch's 15' bright radius sees 30' — and the light need not be its own, which
  is the creature watching your party from past the edge of your lamp. Nothing
  burning nearby means nothing to double, so total darkness still blinds it, and
  it still cannot march without a light. It updates as the light does: strike a
  torch, douse it, or carry it across the room and the creature's sight follows.
  Distance is measured straight through walls for now.
- **Migrate Token Vision**, a new macro in the ACKS Extras compendium, derives
  every token's sight from its sheet across every scene in the world and reports
  how many it rewrote. Until now that only happened on the scene you had open or
  the actor you had just edited, so a campaign already under way kept whatever
  its other scenes were last set to. It asks one question before it runs: tokens
  whose vision you edited by hand are left alone permanently, and taking that
  protection back is a deliberate answer, defaulting to no — those edits cannot
  be recovered afterwards.
- **Stop holding goods**, a new control on the storage manager, turns storage
  off for a place — the way back that never existed. Anything at all could be
  made a place that holds goods, and nothing could ever stop being one, so a
  character flagged by mistake stayed a shared warehouse permanently. Its
  shelves must be empty first: clearing the flag moves nothing, and goods left
  at a place that has stopped being a place cannot be asked for back, so return
  them to their owners with the button beside it. A Disable Storage Here macro
  does the same for a selected token.
- **A surprise roll answers for the whole encounter on one card.** Starting a
  combat and picking a square of the Surprise Matrix posted a separate chat
  message per combatant — six one-line messages for six fighters, in roll order,
  each having to be read on its own to work out the one thing being asked: who
  is surprised. The results now arrive as a single card, monsters in one table
  and adventurers in the other, each with the name, the total and the verdict,
  and the surprised rows marked. Hovering a total shows the dice and every
  modifier that went into it. The rolls themselves are the system's and are
  untouched — the same numbers, the same threshold, the same Surprised condition
  applied to the same creatures. A hidden monster keeps its privacy: those rows
  travel on a second card the Judges alone can see, exactly as their individual
  messages used to, so with nothing hidden there is one card and with something
  hidden there are two. **Surprise results on one card** is a new setting; turn
  it off for the system's original per-combatant messages.

### Changed
- **Every roll the whole party makes at once now arrives on the same card.** The
  party's checks — Listen, Search, Bash, Track — and the party's saving throws
  posted as bulleted lists, each built its own way, and the new surprise card
  made a third. They are now one card: a table of who rolled, what they got, the
  number they needed and whether it landed, with numbers that line up in their
  column and the row marked by its result. The modifier stack behind a check has
  moved from a parenthesis on the end of the line to a small line under the
  name, so it is still there and no longer crowds the number, and the target has
  a column of its own. A saving throw's terse `(magical)` tag is now a line
  saying which bonuses that actually applies. Nothing about what is rolled or
  how it is scored has changed, and the checks card is still whispered to the
  Judges. The turn report and encounter notices are unchanged — those are prose
  about what happened, not one row per character.

## 3.6.3

### Fixed
- **A window that takes the ACKS lettering takes the ACKS page under it.** With
  styling on system sheets set to *Palette only* and the ACKS colour scheme
  pinned against the rest of the client — light ACKS on a dark seat, or the
  reverse — the system's plainer dialogs took their lettering from the ACKS
  palette and their page from Foundry, and the two answered to different
  settings. Mortal Wounds, the Stat Generator, Party Overview and the Surprise
  Matrix rendered near-black on near-black, near enough to invisible. The page
  now travels with the lettering, so no combination of the two settings can
  separate them. The character and item sheets already had a page of their own
  and are unchanged.

## 3.6.2

### Added
- **A table that wants its own colours keeps them.** **ACKS look** is a new
  per-player setting with two values. *Book style* is everything as it was —
  burgundy, inscriptional capitals, square corners. *System style* stands the
  whole look down: no ACKS palette and no ACKS lettering on any surface,
  including this module's own windows, so every panel draws in the colours and
  faces the client is already using. Roll cards in chat change the most
  visibly, because those are dressed by this module and nothing else. Two things
  it deliberately does not promise: it hands the sheets back to the ACKS
  *system*, not to a neutral Foundry — the system paints its own window headers
  and dialog colours, and no setting here reaches those — and light against dark
  becomes Foundry's own colour scheme, because there is no ACKS palette left to
  hold steady. The **ACKS colour scheme** and **ACKS styling on system sheets**
  settings say so, and are ignored while System style is chosen. Text size is
  not part of the look and keeps working either way.

### Fixed
- **A window this module opens wears this module's look, whatever the system's
  sheets are set to.** With styling on system sheets set to *Palette only*, five
  of the module's own windows — the ability sheet, the roll editor, the
  equipment item sheet, the Full Monster Sheet and the Follower Card — lost their
  banners and controls along with the system's. Those five are built on top of a
  system sheet and so answer to the same name in the markup; each is now
  recognised by what it declares itself to be rather than by that inherited
  name, and the setting speaks only for the windows the system opens.
- **A throw you can press looks like one.** The chip that rolls an ability's
  throw from the character sheet asked for a border in a measurement rather than
  a colour, which is not a border a browser can draw — so it drew none, and the
  heavier outline that marks which throw the row's own icon reaches had nothing
  to outline. Both are back: the chip is ruled, and the default throw is ruled
  more strongly than the rest.
- **The encumbrance reading is legible on a light seat.** "Unencumbered" and its
  companions are printed on a bar the system paints near-black in every colour
  scheme, while the lettering took its colour from the page — so on a light seat
  the words were dark on dark and effectively invisible. They are reversed out
  in white now, as lettering on a dark band should be, on both seats and under
  either look.

## 3.6.1

### Fixed
- **An imported ability answers even when the importer is away.** In a world
  running acks-extras without acks-importer, reading an ability's imported
  identity threw: opening an ability's sheet failed outright, and every
  question built on those identities — the sense model's lightless-vision
  check, the formation bridge's roll candidates and skill ladders, the party
  skill roller — failed with it. The importer's provenance flags persist on
  the item whether or not the module is present, and they are now read in a
  way that never requires it to be active. A world running both modules sees
  no change.
- **A missing monster sheet costs the animal alias its sheet, and nothing
  else.** When the system's monster sheet cannot be resolved at ready, the
  group, template and follower-card sheets still register and the one-time
  sheet sweeps still run; before, everything after the failed lookup was
  silently dropped along with the animal sheet, and the warning named only
  the animal.

## 3.6.0

### Added
- **A Judge may build a character without a package at all.** Under the override
  there is now the Judges Journal's template-less option: no equipment and no
  spellbook, every proficiency the character is owed chosen from the class and
  general lists rather than printed, and 3d6×10 gold to outfit them with. The
  gold row is where that roll happens, and it is the only circumstance in which
  it is rolled — a package pays its own coin, so with one chosen the gold die
  says so and stays out of reach.

### Fixed
- **A package hands over the coin it prints, in the coin it prints.** Starting
  money was gold and only gold, so a package paying in silver paid nothing: a
  proselytizer's twenty silver for alms, a priest's twenty-five and a tribal
  warrior's sixty-five never arrived, and those three characters began play with
  an empty purse. Silver now lands in the character's silver, gold in their
  gold, and the page names both before the package is taken. Existing class
  documents carry no silver until they are imported again.

## 3.5.0

### Added
- **The Scores Generator is laid out in the order a character is built.** The
  attributes and the rule they are rolled under stand on the left, the class and
  the template die read against it in the middle — a die that means nothing
  until a class is chosen now sits directly beneath the class it answers to —
  and what is left to choose, with what the character comes to, on the right.
  The window opens wide enough to hold all three and can be dragged wider. The
  sum, average and spread of the roll are gone — they described the dice rather
  than the character, and the rule governing those dice is now stated beside
  them.
- **A package says what it brings before you take it.** Under the template
  selection the page now lists the proficiencies, the starting equipment and the
  spellbook the chosen template hands over, and the printed encumbrance stands
  with the coin it is carried alongside. The die and the package it reaches are
  no longer two rows both labelled Template.
- **A campaign says how attributes are rolled, and the page enforces it.** The
  printed method is the default: one attribute on 5d6 drop two, raised to 13 if
  it falls short, two on 4d6 drop one raised to 9, and 3d6 for the remaining
  three, with you choosing which attribute gets which. The dice you have spent
  are struck through and the page says what is left to roll. The Judges Journal
  options — gritty, heroic and legendary — are offered beside it, each a single
  formula for every attribute. A Judge override ignores all of it.
- **One Judge override governs the whole page**, in place of the two that
  governed half each. It offers every class and every template whatever the dice
  say, lets a Judge type into any rolled field by hand, and is remembered, so it
  comes back the next time that Judge opens the page. The summary statistics and
  a score's modifier stay derived — they are computed from the scores rather
  than set.
- **Generating a character replaces the last attempt.** Rerolling a class used
  to leave the previous package sitting underneath the new one. A Judge who
  means to add rather than replace now says so, on the same page.
- **A class can state where it sits in book order**, on its own sheet — the
  book's rank times a thousand plus the printed page. A class that says nothing
  has it worked out from its citation, so nothing needs re-importing.

### Fixed
- **A character built on the Scores Generator is a character that gets built.**
  Rolling the scores, choosing a class and rolling the template die ended with
  "only the scores were saved" and an otherwise empty character sheet. The page
  had been waiting a fixed eight-tenths of a second for a roll to appear on
  screen, and a roll does not appear until the dice have finished being thrown —
  which, with 3D dice, takes several seconds. The template die was the last
  thing rolled, so it was the one thing never seen. The page now waits for the
  roll itself rather than for a stopwatch, and reads the page as submitted
  before it builds anything, so what you were looking at is what you get.
- **A score you have not rolled yet rules nothing out.** An empty score box
  counted as a zero, which is below every requirement in print — so before the
  first die was thrown the class list silently withheld every class that asks
  for anything, which in a fully imported world is fourteen of thirty-two. What
  was left looked like the whole list. A class now leaves the list at the moment
  a rolled score contradicts it, and not before.
- **A starting template brings the proficiencies it prints.** The page asked for
  a class proficiency and a general proficiency beside a template that had
  already chosen both, so every character began with two proficiencies the book
  never gave them. The template now says what it brings, and is not asked again
  for it. A choice among named alternatives — a warlock's dark path, a witch's
  tradition — is not something a template lists, so it is still yours to make,
  and the Intellect bonus is still spent on top of the package exactly as
  printed.
- **Adventuring is free with every class.** It sorts first among the general
  proficiencies, so an untouched dropdown handed a character their one starting
  general proficiency spent on the one thing every character already has. It is
  now granted with the class and never offered as a pick — at chargen and on
  gaining a level alike. Characters generated before this keep the surplus;
  nothing reaches back into a sheet to take a proficiency away.
- **The template pays the starting coin, into the purse the system counts.**
  The coin a template prints landed in a pile named "Gold Pieces", which the
  system's own money handling cannot find and which valued the whole purse at
  copper. It now lands in the character's `Gold`, at a gold piece's worth,
  topping up a purse that already exists rather than starting a second one. The
  page's gold row shows the figure the chosen package pays.
- **A score row is one row.** Each score sat with its two boxes stacked and its
  dice wrapped onto a second line, three lines deep, six times over — the row
  rule that gave the reset button its place had let a score box claim a whole
  line to itself. The rows are rows again.
- **A group calls its members what its kind calls them.** A group sheet showed
  `ACKS-LIB.group.noun.mercenary` where it meant "unit", and the same for a
  pack, a team and a band, and for all four category names. Two labels on that
  sheet were named the same thing as the group of words beneath them, and a name
  cannot be both — so the eight words underneath were discarded when the file
  was read. Worth knowing because the same mistake made one line further along
  costs the whole translation file rather than eight words of it.
- **The dice button that opens the generator stops flashing.** It announced
  itself for as long as the character was new, which is for as long as it was on
  screen. It settles after a few passes and stays where it was.
- **Classes are listed as the books print them** — the Revised Rulebook, then By
  This Axe, each in page order — rather than alphabetically across both. A class
  may state its own place on its sheet; one that does not has it worked out from
  its citation, so nothing needs re-importing.

## 3.4.0

### Fixed
- **Every throw an ability offers can be rolled.** The system stores one roll
  per ability and reaches it from one control, so a proficiency the book prints
  with two ways of attempting it — picking a lock hastily, or methodically for
  a turn and a bonus — had one of them reachable and the other only from inside
  the item. The strip in an expanded row now rolls the throw it prints, so the
  thing showing you "methodically 9+" is the thing you press. A favourited
  ability offers one control per throw, because a favourite exists to be rolled
  without going looking for it. And an ability with more than one throw carries
  a control that says which throw everything else reaches — the row's own icon,
  the chat card's button, a hotbar macro — and steps to the next one.
- **A bonus reaches the ladder it names.** The books state a great many —
  Lockpicking Expertise adds two to Lockpicking throws, a methodical attempt
  adds four to its own — and every one of them was recorded against the
  ability granting it and read by nothing, so none of them ever moved a number.
  A fourth-level thief with Lockpicking Expertise now picks at 13+ rather than
  15+, and methodically at 9+. A bonus that does not say what it is a bonus to
  is still not applied to anything: guessing would give a character every bonus
  in their list on every roll they make. Taking a proficiency twice is
  unchanged — that is rank, which its own ladder already answers.
- **Setting a level by hand builds the character that level describes.**
  Choosing a class or a level from the picker wrote the printed cells and left
  hit points and experience describing somebody else — a fourth-level thief
  with first-level hit points, and an experience total three bands from the
  level beside it. Hit points are now rolled from first level upward, each
  level after the first rerolling the whole Hit Dice and keeping at least a
  point more than the level before, and the dice are shown before anything is
  written. Experience moves the shortest distance that makes it agree with the
  level: to the floor of the new band when the level rises, to one short of the
  next when it falls, and not at all where the class prints no number to move
  to. Levelling up normally is untouched, and so is chargen.
- **Constitution applies to each Hit Die, and cannot take any of them below a
  point.** It was applied to the total instead — the same arithmetic only while
  Constitution is a bonus. A third-level character with a penalty rolling 1, 1
  and 2 holds three points by the book and fewer than none by the shortcut.
- **A starting package follows the class and the template it was chosen for.**
  The proficiency picks offered during character generation were built once and
  never rebuilt, and the template list did not follow the class, so the picks
  could belong to a template nobody had selected.
- **Leaving something somewhere means being there.** Storage asked only whether
  you owned a place and then offered every place that said yes, so a character
  standing in a dungeon was invited to put a chest into a warehouse three
  hundred miles away. A place with a map is now reached by standing on it — any
  scene, not only the one you are looking at, so a party split across two maps
  can still bank at the inn half of it is sitting in. A place with no map is
  reached by holding it, and your own vault is yours wherever you stand.
  Anyone you travel with holding a place lends you their access, asked of a
  formation's marching order and of a party actor alike. None of this gates
  taking your goods back: retrieval is offered wherever the goods are, and
  where the deposit control is withheld the tab says which rule withheld it.
- **An open editor takes the whole card.** A follower card's notes editor wants
  more width than the column it sits in, so every one of its controls was
  clipped away and it read as an editor that had none.
- **A value box holds one value.** Hit points drew a box around its own two
  boxes, an attack drew one inside the panel that already framed it, and a rail
  could hold a narrow box and a full-width one claiming to be the same field.
- **An override says so in colour, not only in weight.** A number overridden on
  a card was meant to print in the spot colour and printed in bold ordinary ink
  instead, because the sheet theme's own field colour outweighed the card's by
  a hair — so the one signal saying a value was yours rather than the actor's
  never appeared.
- **A count that contradicts its own rules prints as a fault.** An ability taken
  more times than it may be was ringed in the alarm colour while its own figure
  stayed in ordinary ink, so a contradicted count looked much like a settled one.
- **The skill audit's settings row sets as one line.** Its labels were smaller
  than the dropdowns and number fields they named.

### Added
- **A character is built on the page that rolls them.** The Scores Generator
  rolled six attributes, a template die and a purse, and then threw the template
  die away — it was never read. Character generation now happens there: a class
  is chosen once the scores are known and before the template is rolled,
  offering only those whose requirements the scores actually meet, and the
  template die is read against that class under the printed rule — the band you
  rolled or any below it. The class's own first-level picks and the Intellect
  bonus proficiencies are chosen on the same page, and everything rebuilds as
  the scores change. A Judge can offer any class or any template regardless.
  The separate chargen window is gone; it asked the same questions again and
  rolled a second, different template die.
- **Anything rolled can be taken back.** Every score, the template die and the
  starting purse carry a control that clears them, and the sum, average and
  spread follow rather than describing scores that are no longer there.
- **A template that assumes an Intellect its character has not got no longer
  hands out what they cannot hold.** The studious spellcasters' packages are
  built assuming a bonus — one proficiency, listed last, and one spell, listed
  second. A character below that band is now given neither, and one above it
  chooses only the difference rather than the whole bonus a second time. Which
  classes those are is a fact off the page: it arrives with the class from your
  own book, so re-import your classes to pick it up. A class you have not
  re-imported assumes nothing and behaves exactly as it did.
- **A place can be pinned to a character.** Drag a location onto a sheet and it
  stays offered for storage from then on — for the cellar or the caravan a
  character has standing access to without owning it and without standing on
  its map.
- **A card's derived numbers can be told otherwise.** Speed and encumbrance were
  printed and nothing more, in boxes that looked exactly like the ones beside
  them that accept typing. Both now take a card-only override the way armour
  class already did — the row reads in the override colour while it holds one,
  Reset drops it, and Commit writes the speed onto the actor. Encumbrance is
  summed from what the body carries, so it has nothing to be written onto and
  stays a card note until Reset.

## 3.3.0

### Fixed
- **Resting refreshes spent magic again.** The rest control on the casting
  strip wrote an empty spend record over the old one, but Foundry merges
  updates — merging nothing changes nothing, so every pip stayed spent
  through any number of rests, for every caster, since the strip shipped.
  The record is now deleted outright and a night's rest clears the strip.
- **A decorated name keeps the weapon it names.** "Silver Dagger, masterwork"
  was read as a plain dagger and quietly lost its silver, because the weapon
  table was searched in the order it happens to be written and `dagger` is
  written one line above `silverdagger`. The most specific weapon a name
  contains now wins, whatever order the table is in.

### Added
- **Silver is something a blade can be given, not a substance it is made of.**
  The Material field on an item's Construction tab has only ever decided what
  destroys a thing, and said so — so a reader after a silvered sword found the
  field that looked like the answer and got nothing. Weapons and ammunition now
  carry a *Silver* control of their own: silvering any common weapon costs ten
  times its listed price and changes nothing else about it, exactly as the rules
  have it. What it buys is what the blade counts as — extraordinary damage
  against a defence with the silver flaw, and against the spells that turn aside
  mundane damage. The Material field is untouched, and a Silver Dagger bought
  off the price list still costs what the list charges.
- **A monster's defence can be flawed against silver.** Immunities and
  resistances take a *Silver flaw* box beside Mundane and Extraordinary, for the
  stat blocks that read "silver weapons deal extraordinary damage against it".
  Whether a given monster has it stays the Judge's reading; the module says what
  the weapon counts as and stops there.
- **Silver arrows are not spent by accident.** With plain and silver ammunition
  both in the pack, shots come out of the plain stack first, and a silver round
  announces itself when it goes. Declaring "fire the silver ones now" is not
  built — to shoot silver deliberately, keep it as the only ammunition to hand.
- **Masterwork no longer looks like it buys reach.** A masterwork weapon that is
  not silvered now says on its own sheet that the tier buys numbers and not the
  ability to harm what shrugs off ordinary weapons.
- **Point pools spend and refresh on the strip.** A tradition kept as a pool
  of points (the schema has carried the kind since 3.0.0; content arrives
  with the eldritch and ceremonial chapters) now shows its total with −/+
  controls beside the slot pips, spends by click, and clears on the same
  rest. A tradition whose measure is a ladder rung — the gnostic invocation
  level — shows that rung as a capacity line instead of pips.
- **The sheet files what a class hands out.** Ability lists grow a filter
  bar — fighting skills, thief skills, general proficiencies, class
  proficiencies, class powers, racial traits — and the spell list files by
  casting tradition, one tab per tradition the world's spells actually name.
  The bars only appear where a sheet holds more than one kind.
- **A skinned item says what it is.** Gear granted from a template under a
  printed descriptor — the long bearded axe that is a great axe — carries a
  badge on its sheet naming the base item, with the descriptor's own words
  set apart from the base name.
- **A template's spellbook teaches its spells.** Where a starting package
  prints a spellbook with named contents, chargen now grants those spells as
  spell items alongside the book — matched against the world's imported
  spells, reported when a name finds nothing.
- **The constructor edits casting and templates.** The class sheet's two
  read-only summaries are gone; in their place, a Casting tab (traditions,
  kind, slot grid, pool schedule, caster-level ladder) and a Templates tab
  (the eight 3d6 bands with their abilities, items and spells) — so a
  homebrew class can be authored whole, not just imported. Description and
  code-of-behavior use the system's own rich-text editor.
- **A throw can progress as any class the world holds.** The roll editor's
  progression picker now offers every class document — imported or homebrew
  — not just the four chassis.

## 3.2.0

### Added
- **A first level arrives with its choices made.** Chargen now hands over
  everything the class grants at 1st level, not just the template bundle:
  the fixed starting powers land as owned abilities (racial traits included,
  deduped against what the template already carried), and every first-level
  pick renders as its own select in the dialog — the class and general
  proficiency picks, and the path choices the importer's class documents now
  carry: a warlock chooses a dark path, a witch her tradition, a barbarian a
  tribal origin, a By This Axe earthforger a sigil. The selects rebuild when
  the class selection changes, and the options taken are granted with the
  rest on confirm.

## 3.1.3

### Fixed
- **Hiring a unit as a group works again, and that unit's morale and wages come
  with it.** Three places in the henchmen code still called the group actor by
  the module id it carried before the nine modules merged into one. Foundry does
  not recognise that name, so it refused every actor "Hire as Group" tried to
  create — the hire stopped with an error instead of fielding a unit, and
  nothing reached the world. The same stale name kept "Roll Unit Morale" off a
  group's right-click menu, because the entry was asking for an actor type that
  can no longer exist, and left the monthly wage, arrears and unit-adoption
  passes hunting for units they were never going to find. A mercenary company
  hired through a location's market is now created, shows its morale roll where
  a Judge would reach for it, and is billed each month like any other retainer.
  All three sites now read the single shared constant the rest of the module
  already reads, so they cannot drift from the registered type again. **No world
  data was affected and nothing needs repairing**: the refused creations never
  landed, so no world holds a half-made unit. Actors left behind by the
  pre-merge modules remain the "Clean Up After the Merge (GM)" macro's business,
  exactly as before.

## 3.1.2

### Fixed
- **A missing-tables notice names only what a Judge can go and import.** Every
  world load opened with a warning that the followers and monsters tables were
  not installed, and that market, wage and hiring automation would stay disabled
  until they were. Neither claim held. Those two were the only entries on the
  list that no import produces — there is no recipe for either — so the notice
  could never be cleared however much of the book you imported, and the
  automation it said was disabled had been running the whole time on the six
  tables that *had* arrived. The notice now lists only documents an import can
  actually supply, which means an empty console on a world that has imported its
  books and a warning you can act on where one is genuinely missing. The
  followers tables are still required for follower generation, and the Followers
  dialog still says so — at the moment you open it, where it can name the pages
  to import.
- **An attack roll asks who may see it in the words Foundry 14 uses.** Rolling
  an attack wrote a block of red deprecation errors to the console, once per
  roll and again for every different button that started one. The roll itself
  was never wrong: the old names still resolved, so a private roll stayed
  private. They stop resolving in Foundry 16, so the roll now reads the setting
  and builds its audience through Foundry's own current interface, and hands the
  visibility question to core rather than keeping its own list of mode names to
  fall out of step. Public, private, blind and self-only behave exactly as
  before. The visibility dropdown offers the same four choices and not core's
  new in-character option, which styles a message rather than deciding who reads
  it. The ACKS system makes the same deprecated calls from its own hit-dice,
  initiative and chat-command rolls, so the console does not fall silent — but
  nothing left in it comes from this module.
- **A right-click menu is built the way Foundry 14 expects.** Opening the actor
  or scene directory's context menu logged a deprecation error for each entry
  this module adds. The entries always worked and still work identically — the
  keys naming them were the ones Foundry retired. Two further entries carried a
  third retired key that only complained when a player actually clicked them,
  and those are corrected too, so the whole set is current rather than the two
  the console happened to report.

### Fixed
- **An animal is an animal from the moment the world opens, not from the moment
  you make one.** Clicking any animal a world had already saved — the war dog,
  the mule, the horses — threw an error and opened nothing, while an animal
  created during that same session opened perfectly. Foundry builds every actor
  in a world before this module was getting round to saying what an animal is,
  so the ones already on the shelf came up as loose data with no stat block
  behind them, and the sheet had nothing to read. That declaration now happens
  early enough that every animal in the world is built as one. Monster templates
  were quietly the same story — they opened, but on empty fields — and the same
  change fixes them. Nothing stored was lost: an affected actor was intact on
  disk the whole time, and reads correctly on the first load after this update.

## 3.1.0

### Added
- **A class document dropped on a character binds it.** Dragging a class onto a
  character sheet did the only thing Foundry knows to do with an item — it put
  a copy in their inventory, where an entire class spread sat among the rations
  and torches doing nothing at all. A class dropped on a sheet now binds the
  character to it and opens the same confirm the graduation cap opens, listing
  every field it will change before a word is written, and never embeds itself
  as a carried item. Every other kind of item drops exactly as it always did.
- **The class pickers lead with the six you actually play.** Both the bind
  picker and the character-generation dialog listed every class document in the
  world in one alphabetical run, so a world holding the Revised Rulebook's
  classes, a campaign's own, and a shelf of homebrew opened on a list you had to
  read through to find the Fighter. They now offer the core six, plus whatever
  the character is already bound to, with **Show all classes** one click away
  for the rest. Any class document can mark itself core, so a campaign built on
  its own roster is a checkbox away from leading with it.
- **The Judge can hand out a template the dice did not roll.** Character
  generation offers the template you rolled and any band below it, which is the
  printed rule and stays the default. The dialog now carries an override that
  offers every template on the class whatever the roll — for the character who
  was made before the table sat down, or the concession a Judge decides to make.
  It appears for the Judge only; a player's dialog is unchanged.

### Changed
- **A skinned item carries its count as a count.** A template that prints "2
  flasks of holy water" produced a single item named exactly that, quantity one
  — so the sheet showed one thing, the encumbrance was wrong by a flask, and
  using one of them left you holding a numeral. The count now goes on the
  quantity field where the sheet can read it, and the item is named for what it
  is. Each skinned piece also records which ordinary item it is an embellished
  instance of, so a starting outfit's finery can still be recognised as the
  gear underneath it.

### Fixed
- **The constructor's tabs open the pages they name.** Every tab on the class
  sheet — progression, awards, casting, templates — was unreachable: clicking
  one threw and left you looking at Overview, so a class could be read but only
  the first page of it could be edited. `tab` is vocabulary the application
  framework reserves for its own tab machinery, which took every one of those
  clicks and failed on them. The sheet's tabs answer to a name of their own now.
- **The constructor scrolls once.** The sheet body carried two scrollbars nested
  one inside the other, so a long progression table scrolled the wrong one first
  and reaching the bottom of a page meant two separate drags. There is one, and
  it belongs to the page you are reading.
- **An imported class reads the way your page reads.** Description and code of
  behaviour showed the import's own reference tag rather than the book text it
  points at, which made a correctly imported class look like a failed one. They
  now render as a reader sees them, with the raw source behind a per-field
  **Edit source** toggle for when you mean to change it rather than read it.
- **A class with no requirements says so.** An empty requirements box was
  indistinguishable from an import that had not finished, so a class anyone may
  take looked broken. It now says that any character may take this class.

## 3.0.0

### Added
- **A class is a document, not a word in a field.** The system holds a
  character's class as free text: you type "Fighter" and every number on that
  spread is yours to copy in by hand and keep straight thereafter. A class is
  now a document of its own — **Create Item → Class** opens a constructor
  holding what a class spread prints. Requirements and key attributes, hit die
  and maximum level, the level rows with their experience and titles, saving
  throw and attack bands exactly as printed, the named columns a spread adds
  (damage bonus, armour-class bonus, backstab dice, caster level, the
  assassin's and bard's skill ladders), cleaves, racial traits, the class's own
  proficiency and power lists, a per-level award ladder, casting traditions,
  and the eight starting templates. A class that borrows another's bands names
  it rather than repeating the numbers — the Explorer saves as a Fighter — and
  the two borrowings are independent, because the priestess takes a crusader's
  saves with a mage's attacks. **The module ships no class values.** Nothing is
  read off a page for you: a document is filled by ACKS Importer from books you
  have connected yourself, or typed in by hand. Both produce the same document
  and open in the same sheet, so reviewing an import and building homebrew are
  one workflow rather than two.
- **A character bound to a class is given the printed numbers, and told what
  changes.** A graduation cap sits beside the class field on every character
  sheet. It binds the character to a class document and writes that document's
  values for their current level — saving throws, attack throw, title,
  experience to the next level, hit dice, cleaves, spell slots — behind a
  confirm that lists every field old value against new before anything is
  written. Anything you hand-edited since the last apply is flagged as such, so
  a deliberate departure from the book is not quietly undone by the next apply.
  A cell the book leaves blank is skipped rather than zeroed.
- **A demi-human class names its minimums and leaves them to the Judge.** The
  confirm lists every attribute minimum the character falls short of, then
  applies anyway if you say so — the module states the rule and does not
  enforce it. Demi-human spreads print their racial saving-throw modifiers
  already worked in, and the document records that, so nothing applies them a
  second time on top.
- **A first-level character is dealt the printed starting template.** A dice
  control beside the class field rolls 3d6 and offers the template that number
  lands on, or any band below it. Applying grants the whole bundle: the
  proficiencies as owned abilities, a rank of two granting two copies and a
  named selection carried through; the equipment as each piece reads on the
  page, worn over the mechanics of the ordinary item underneath it, so the
  starting spellbook is named as printed and still behaves as a spellbook; the
  coin as money; and the general proficiency picks an Intellect bonus earns. A
  printed piece nothing in the world matches still arrives, plainly named and
  visibly so, rather than being dropped in silence.
- **A gained level is offered, never taken for you.** Crossing the class's
  experience threshold raises a rising-arrow control and says so; nothing is
  applied until you open it. The wizard rerolls hit points as written — the
  full hit dice rerolled, Constitution counted per die, never on the flat bonus
  past ninth level, and never leaving you worse off than the maximum you
  already had. Rolling a single new die instead is a world setting for tables
  that play it that way, and it is not the default. The new level's fixed
  awards are granted, a picker opens for each award that says choose from the
  class's own list or the world's general one, the printed row for the new
  level is applied, and a summary of the whole thing is posted to chat.
- **A caster's day fits on one strip.** A caster's slots lived in the system's
  single grid of numbers, which counts what you may cast and nothing about what
  you have spent, and cannot describe a Nobiran at all. Casters now get a
  per-tradition strip under the class field: a pip per slot, click to spend,
  click a spent one to refund, and a rest control that gives the day back. The
  class document is authoritative for what you may cast, and the character
  stores only what has been spent — so gaining a level, or correcting a spread
  after the fact, changes the strip with nothing to rewrite. The Nobiran's
  arcane and divine pools sit side by side, which no other surface can show.
  The system's own grid is still written, so anything reading it keeps working.

### Changed
- **"As a fighter of half his level" now resolves to a number.** It was the one
  kind of value the abilities engine could not work out, because nothing in the
  world held the tables it refers to. Class documents publish those tables as
  they change — the four chassis attack and saving-throw progressions, and each
  class's own bands and named columns — so an ability whose effect is printed
  as another class's progression is now read off the same spread a Judge would
  have opened the book to.
- **The book's save names and the system's are kept apart, and a stale
  reference can be repaired.** The book prints *blast* and *spells* where the
  released system stores *breath* and *spell*, and a mismatch between the two
  is invisible until something silently fails to apply. Class documents keep the
  book's vocabulary as printed, and the translation happens once, at the moment
  a character is written. For references already scattered through a world,
  `repairSaveReferences` under `acksExtras.classes` sweeps for save keys the
  system does not carry — on ability items, on Active Effect change keys, in
  leftover data — and reports them. It is a dry run unless you ask it to write.

## 2.2.0

### Changed
- **A monster opens on the block you fight it from.** The extended stat block
  put classification first — types, immunities, defenses, the reference matter —
  so the first thing on screen was the half of the entry you read *before* the
  session, and attacks were a tab away. A monster now opens on its Follower
  Card: attacks, powers and spells on one page, in a window a little over half
  the height of the old one, with everything else one click behind **Expand**.
  Nothing was removed — the full block is the same sheet it always was, and a
  GM who prefers to land there can say so once in the sheet's own configuration.
  Animals and characters open exactly where they did.
- **A world that already had the old sheet moves with it.** Foundry records a
  type's sheet the first time a module claims it, and a recorded choice outranks
  anything a later version asks for — so this change would have reached new
  worlds only, and left every existing one opening the full block forever. On
  first load, a world still pointing at this module's own former default is
  moved to the card. A world where anyone has since chosen a different sheet —
  the system's, or the card itself — is left exactly as it is, and the move
  never happens twice. It is one click to undo.

### Added
- **A named power reads itself out to the table.** A creature's powers sat on
  the card as text, so "Terrifying Visage" meant reaching for the book while
  everyone waited. Any power or spell whose entry carries prose now has a
  speech-bubble beside it that posts the whole entry to chat, where the table
  can read it. Rolling is unchanged and still lives on its own d20; a power with
  no prose gains no button rather than an empty one.
- **A creature's spells are on the card, not just its slots.** The card counted
  a caster's slots per level and stopped, which told you it had spells without
  telling you which. The spells themselves now run under that line by level,
  each with the same read-aloud button. A creature that carries spells without
  the caster flag — the spell-like powers a monster entry gives — counts as a
  caster here, so its spells show rather than nothing at all.

### Fixed
- **Expand opens this module's own full block.** The Expand button asked the
  registry for the type's default sheet and took whatever was left after the
  card — a question with no good answer once the card itself became the default,
  at which point it could land on the system's plain monster sheet instead of
  the extended one it is a summary of. It now names the sheet it belongs to.

## 2.1.1

### Fixed
- **A creature that strikes with whatever it is holding still strikes.** Plenty
  of stat blocks state damage as prose rather than dice — a skeletal slayer
  hits "by weapon", because what it does depends on the sword in its hands. One
  unrollable word cost the entire attack: the dice parser gives up on the whole
  formula when any part of it is not dice, so the click produced no roll, no
  card, and nothing in the log to say why. Worse, the creature was charged for
  it — the attack counter comes down before the roll is made, so a round's
  attacks drained away against a swing that never happened. Such an attack now
  rolls, does a die of damage until you give it a better one, and says which
  item to correct. A weapon whose damage was already dice is untouched.
- **The fall-back behind the attack roll can actually catch.** The remodeled
  attack roll has always promised that any failure inside it hands off to the
  system's own roll instead of breaking the attack. It could not keep that
  promise: the roll is asynchronous, and the failure was being handed back to
  the caller rather than to the guard waiting for it, so the guard only ever saw
  errors raised before the roll began. Every failure now reaches it — which is
  what makes the case above degrade into a usable roll rather than silence.
- **A proficiency throw with an unrollable formula says so.** An ability's dice
  are typed in by hand, and nothing checked them on the way in. A throw carrying
  anything that is not dice failed the same silent way — no card, no complaint.
  It now rolls a d20, names the throw, and points at the field to fix.

## 2.1.0

### Fixed
- **Coin goes where the rest of your gear goes.** A stack of coins was the one
  thing on the sheet that could not be dragged. Pouches and locations both take
  goods, and both ignored coin completely — no refusal, no warning, nothing in
  the console to explain it, because nothing ran at all: the coin row was never
  made a drag source, so the drag never began. Coin now drags into a container
  or onto a place like anything else you carry. Rows that are not goods — the
  favourites panel, your languages — are left exactly as the system draws them.
- **When a stow is refused, it says so in words.** Storage turns a move down for
  five honest reasons — an empty stack, ownership you do not have, an unlinked
  token, a place that does not hold goods, a write that failed — and every one
  of them arrived as `ACKS-LIB.storage.nothingToMove` or one of its siblings: an
  identifier rather than a sentence, with nothing in the console to expand it.
  Each now says what happened and what to do about it.

### Added
- **A character can be given a vault back.** Vaults are made for you by the sweep
  that retires the bank column, and only for a character who still has a balance
  to move — so a vault that is deleted never comes back on its own, because by
  then there is nothing left to sweep. The storage manager gains **Give a
  character a vault**, which makes one on demand, reachable by that character and
  their players and nobody else. *Let an actor hold goods* is unchanged and still
  makes a shared place — a wagon, a stronghold, an inn — which is a different
  thing from a vault of your own.

## 2.0.0

### Changed
- **Every ACKS window is drawn from one palette.** Each feature used to carry its
  own colours — golds in the influence roller, purples and blues on the party
  sheet, four different reds for the same warning — so the module read as eight
  modules wearing eight coats. They are now one: the burgundy spot colour and
  warm black the books are printed in, on parchment or on tooled leather
  depending on your seat. Every window the module opens carries the ACKS frame —
  the porphyry running head, the square letterpress rules, the small-caps banner
  lettering — instead of Foundry's default chrome. Nothing moved: this changes
  what the module is coloured with, not where anything sits.
- **The system's own sheets are ACKS windows too.** Every window the ACKS system
  opens — the character sheet, the item sheet, and its dialogs — now wears the
  same frame and the same palette as everything this module opens, so a dark seat
  is dark all the way through instead of stopping at the module's own windows.
  The character sheet opens a little wider than it used to: the ACKS write-in
  fields are roomier than the ones it was laid out around, and it is given the
  room rather than made to do without them. Drag it wider and it stays where you
  put it.
- **A distinction you could only see in colour is now drawn, not tinted.** A lit
  lamp and an unlit one were the same icon in two hues; a magical light and a
  mundane one were purple and blue. The books have no such palette to spend, so
  those differences are carried by the mark itself — which glyph, and how heavy
  it is drawn. They survive a colourblind seat and a greyscale print, which the
  hues did not.

### Removed
- **The Character-sheet theme on/off toggle is gone, replaced by a choice of how
  much.** Off never returned you to a neutral Foundry — it left this module's
  windows themed and the system's not, which is the split this release closes,
  and the ACKS system publishes no dark palette to fall back to, so a dark seat
  put the module's panels on a page drawn for a light one. **ACKS styling on
  system sheets** takes its place: *Full dress* restyles the furniture too, and
  *Palette only* keeps the system's own layout, spacing and width and changes
  nothing but the colours. Both follow your colour scheme.

### Added
- **You can hold the ACKS look steady while the rest of your client goes the
  other way.** A new per-player setting, ACKS colour scheme, offers Follow
  Foundry (the default), Always light and Always dark. Follow Foundry is the
  honest default and now genuinely follows — including the split configuration
  where your application windows are themed differently from the rest of the
  interface.

### Fixed
- **A dark seat is drawn in dark-seat colours.** Seven of the module's
  stylesheets asked Foundry for their borders and their secondary text through
  variables Foundry only ever defines once, for a light client — so on a dark
  seat the module answered with light-theme ink on a dark ground, and had done
  since those sheets were written. Every colour now comes from the ACKS palette,
  which carries a value for both seats. This was the visible half of the
  complaint that the module "doesn't do dark mode"; it was never a missing
  feature, it was 88 borrowed constants.
- **The printed-sheet theme follows a window themed on its own.** Foundry lets
  you theme application windows differently from the rest of the interface. The
  character-sheet theme decided which seat it was on by looking at the page
  rather than at the window, so in that configuration a sheet drew light-seat
  rules over dark-seat colours — white write-in boxes under pale text. No rule
  asks the page any more.
- **A themed panel is no longer dropped onto an unthemed page.** Six parts of
  this module add their own content to the system's sheets — the wear buckets on
  your inventory, the hirelings grid, the influence row, stored goods, the attack
  line. Those panels followed your colour scheme while the sheet underneath them
  could not, so on a dark seat they were pale text on cream. The sheet under them
  now follows the same scheme they do.

### Notes
- One configuration is still imperfect and has a remedy: with the interface set
  dark and application windows set light, ACKS surfaces stay dark inside those
  windows. Set ACKS colour scheme to Always light. The proper fix restructures
  the shared token file and is recorded in the roadmap.

## 1.4.2

### Fixed
- **An ability can be thrown blind again.** The Blind checkbox had been dropped
  from the ability's Description tab, and nothing read the field behind it. It is
  back, and it works from every route a throw can start — the proficiency row,
  the chat card, a macro, or the Rolls tab — because they all arrive at the same
  roller. Blind is one switch for the whole ability, as the system stores it, and
  it is offered only on abilities that actually throw rather than sitting dead on
  those that do not. A Judge rolling their own blind ability keeps it to
  themselves; a player's goes to the Judge alone.
- **A Follower Card reads the follower it was given.** The card decided what to
  show by asking what *kind* of actor it held, so an animal hireling was read as
  though it were a character: level, experience, speed, ability scores,
  encumbrance and attack bonus were all fetched from paths an animal does not
  have, and came back wrong or blank on the employer's hirelings tab. The card
  now asks each follower's own data what it holds, and leaves out what it does
  not carry instead of borrowing another shape's answer. Committing an armour
  class for an animal wrote to a field nothing reads, so the button did nothing;
  it now lands.
- **A place's notes answer to ownership.** Anyone who could rename a location and
  set its region could only read its notes, though the same tab already showed
  those notes to everyone. Notes are the place's shared record and are now
  written by whoever owns it.
- **The troop-count boxes ask for a number pad.** On a tablet the hiring dialog
  opened the alphabetic keyboard, because Foundry strips that request out of a
  dialog's markup before it is drawn. It is now set on the fields themselves.

### Notes
- Occupant and special-hire notes are written by the module but have nowhere on
  the sheet to be read. The fields are deliberately kept rather than removed, and
  the missing display is recorded in the Locations roadmap.

## 1.4.1

### Fixed
- **A field the module calls rich text can be written as rich text.** The group
  and template actors both declared a biography and offered nowhere to type one:
  the group sheet had no control at all, and the template sheet showed its
  description only once it already had text, so an empty one could never be
  started. Both now carry an editor. The template's Generate action appends to
  that field, so what it accumulates can finally be trimmed.
- **An editor knows which document it belongs to.** All seven prose editors on
  the monster Description tab — Appearance, Combat, Ecology, Encounter Text,
  Lore, Notes and Biography — named the actor through an attribute Foundry does
  not read, so each opened with no document behind it. Links written relative to
  the actor did not resolve, and neither did secret blocks. Typing and saving
  always worked, which is why this read as "links break when I edit here"
  rather than as a broken field.
- **A retainer's notes read as prose, not as markup.** The Follower Card printed
  the notes field escaped, so anything written with formatting came back as
  visible tags on the employer's hirelings tab. An animal hireling showed a
  permanently blank panel, because the card looked for the field by the actor's
  type instead of by what its schema actually holds.
- **An attitude's notes are the rich text their schema declares.** The field was
  modelled as rich text and rendered as a plain box.
- **The ability sheet offers the saving throw again.** The module's replacement
  for the details panel dropped the save selector that the system provides, so a
  proficiency or power keyed to a save had no way to say which one.
- **Revealing a disguise restores only what the disguise hid.** A disguised
  weapon, armour or item kept its own description and icon while disguised — the
  disguise never masks them — but revealing it wrote both back from the snapshot
  taken when the disguise was first applied, discarding every edit made in
  between.

## 1.4.0

### Added
- **A line marches as wide as the corridor allows.** Marching order offered a
  choice of one, two or three abreast; it is now a number you type, and a
  formation is as wide as the scene can hold. A width of nought, a fraction or a
  negative is refused out loud rather than quietly corrected, and a line ordered
  wider than the map says so instead of marching its rear ranks off the edge.
  Deployment now fits the whole block onto the scene, keeping its shape.
- **A formation occupant can be a stack.** Drop the group actor you hired your
  mercenaries as into a party and the marching order shows it as the bodies it
  holds, in the group's own words, rather than as one person. It deploys as
  those bodies — a platoon of forty at a frontage of seven fills its ranks, and
  the occupant behind it starts after the last of them, not on top of the first.
- **Casualties come off a stack in one stroke.** The badge on a stacked row
  opens the group sheet, where typing a number and pressing **Record
  casualties** removes that many bodies at once — the control that has always
  been there, now reachable from the party. The bodies not in play are taken
  first, and any body it does have to take comes off the map with it, so a unit
  can no longer report two dozen dead while two dozen of them still stand on the
  canvas.
- **A stack that has been in a fight can march again.** A group's strength now
  follows the canvas: a member's token deleted at nought hit points drops the
  stack's count, and one deleted unhurt folds back in. Members left pointing at
  tokens that no longer exist are freed rather than reported as nothing left to
  deploy.

### Fixed
- **The Location sheet is named in the sheet picker.** Sheet Configuration
  listed it as `ACKS-LOCATION.sheet.location` — the key itself, never given an
  English name — leaving the right sheet to be picked by position. It reads
  "ACKS Location", as the module's other sheets always have.
- **A place's notes are written where they are read.** The Notes section on the
  Contents tab was a pane of text with nothing to type into, while a second copy
  of the same field sat on the GM settings tab and worked — so notes appeared to
  save or not depending on which one you had found. Contents now carries the
  one editor, the duplicate is gone, and a note can no longer be overwritten by
  the copy you were not looking at. Notes stay the Judge's to write; a market
  was never what made the difference.
- **A window shows what it holds.** Every window in the module now scrolls its
  contents instead of cutting them off, so an accept button can no longer sit
  below the bottom edge where no amount of dragging reaches it. Lists inside a
  resizable window grow with it rather than stopping at a fixed height and
  leaving dead space beneath. Configure Proficiencies is the one this was worst
  for: it opened taller than a 1080p screen and lost its Save button.
- **Fighting styles are named where they are looked for.** The Configure
  Proficiencies dialog offers the three fighting styles first of all, but under
  a heading a Judge hunting for "weapon style proficiencies" could read past.
  The legend now carries both names. Single-weapon and missile styles are still
  unlisted, because the page makes them everyone's.
- **A cancelled attack costs nothing.** Dismissing the roll dialog spent the
  round anyway; ammunition is now spent only once a roll has actually resolved.
  One shot at several targets spends one round rather than one per target.
- **Ammunition is counted even with the remodelled attack roll switched off.**
  The chain that per-weapon rules modifiers and ammunition ride on was installed
  only when the attack-roll setting was on, so turning that setting off silently
  stopped arrows and bolts being counted, along with the non-proficiency
  penalty, Weapon Finesse, two-handed damage and thrown-weapon Strength. The
  chain now installs either way; the setting chooses only whose roll runs
  innermost.
- **The attack line states the defence once.** Against an unarmoured foe the
  result card read "Attack throw 7+ vs AC 0 → needs 7+", saying the same number
  twice. The defender's armour class is now named only where it changes what the
  roll must reach.
- **The banked-coin column outlives the tab that replaces it.** A world with no
  storage places had the system's banked-coin column taken away and the Storage
  tab that supersedes it never arrived, leaving nowhere at all to record coin.
  The column is now retired only where its replacement is actually on the sheet.
- **A large party is quick again.** Adding or removing members, restoring their
  tokens, and syncing a scene each wrote once per character; they now write once
  for the whole group, so a party of dozens no longer stalls the interface on
  every change, and dragging a token is smooth again. Restored tokens spiral
  outward into free squares rather than piling onto the same handful of cells.
- **One world-clock switch, in one place, under one name.** "Advance world
  time" was registered twice — once by Formations, once by Henchmen — and
  Foundry keeps only one setting per name, so the two features had been sharing
  a single toggle that wore whichever label loaded last. Nothing misbehaved,
  because both sides happened to agree on the default; but the switch found
  under Formations described the henchmen buttons, and a change to either
  default would have silently moved the other. It is now one setting under
  **Library**, "Advance the world clock", worded to cover both the ten minutes
  a dungeon turn spends and the seven days a location's **Advance 1 week**
  button spends. Turning it off still hands the clock to Simple Timekeeping or
  a calendar module, exactly as before. Worlds upgrading from 1.3.2 keep
  whatever they had it set to — the setting moved groups, not identities.
- **The settings reference counts what the module actually registers.** The
  README undercounted at 42, and listed neither the Library's token-vision
  setting nor the henchmen clock toggle. It now reads 43 — 39 configurable, 4
  internal — and the published settings page no longer carries the
  registered-twice caution.

### Upgrading
- Frontage was one of three fixed choices and is now a number. A formation saved
  at one, two or three keeps that width; nothing needs re-entering.
- Worlds carrying the merge's clean-up already have their storage places. A
  world upgraded straight from a pre-merge install has none until a Location
  actor is made, which is why the Storage tab and the banked-coin column can
  both be absent at once — creating one place restores both.

## 1.3.2

### Fixed
- **A power that stands in for a proficiency is counted once too.** A class
  power written to act as Diplomacy fills the Diplomacy box, so that box is its
  whole contribution — but a power whose numbers live in its imported mechanics
  rather than in its effect was still adding a second row underneath, opening
  the roller at +2 for one capability. Where the page offers no box for it — an
  Intimidation attempt, for a power standing in for Diplomacy — the power keeps
  a row of its own, as before.
- **The result card calls the power by its own name.** A box renamed after the
  power filling it went back to reading "Diplomacy proficiency" in the chat
  card's list of what applied. Dialog and card now say the same thing, and a
  character who has both the power and the proficiency itself sees the
  proficiency's name — they are one capability, not two.

## 1.3.1

### Fixed
- **A proficiency is worth what the page says, once.** A character with
  Diplomacy opened the influence roller at +2, and one with Diplomacy and Mystic
  Aura at +4: the proficiency's own checkbox and the same ability's imported
  mechanics were both being counted. Each ability now speaks once per page —
  through the checkbox that page offers — while an ability the page has no
  checkbox for (Beast Friendship, Folkways, or Performance outside a seduction)
  still brings a row of its own. The reaction to a hiring offer is fixed the
  same way, so its ceiling is once again the +2 the book allows.

## 1.3.0

### Added
- **An ability's throws can now be typed in by hand.** The Rolls tab is an
  inventory: add a throw, delete one, or open one to edit it. Each throw gets a
  window of its own holding everything it is made of — its name, its dice,
  whether the result must reach the target or stay under it, and when it
  applies. Changes save as you make them.
- **Level tables are edited in that same window.** Set a throw's target to
  *Breakpoints* and type one step for each point where the printed number
  changes; a step holds until the next one begins, so Animal Husbandry's
  11+ / 7+ / 3+ is three rows rather than one per level. The table belongs to
  the throw that uses it — a table shared between abilities is not built yet.
- A line at the foot of the window shows what the throw comes to for the
  character holding it, which is the quickest way to check a table was typed the
  way the page prints it. A shared definition says it has no character to read
  against instead.
- **A Judge handing out a light hands out the gear with it.** Give a party
  member a torch, a lantern or a candle and they now get what it takes to burn
  it — a lantern arrives with its flask of oil — and a hand is emptied to hold
  it, the shield going on the back before the sword is sheathed. Nothing that
  did not need to be put away is. Players are unchanged: they still need to own
  the gear and have a hand spare.
- **The mapper's kit is a quill and parchment, and it fills both hands.** Taking
  up the Mapper role supplies the kit the same way, and for as long as the role
  is held those two hands are accounted for — so a mapper cannot also have a
  weapon drawn. Set the role down and the hands come back. The 10' Pole role
  supplies its pole on the same terms.

### Fixed
- **A throw is read at the scale it declares.** Throws have always been able to
  say they are rated by rank rather than by class level, and the sheet labelled
  their ladder that way, but the number was resolved against class level
  regardless — so Animal Husbandry on a 5th-level character who had taken the
  proficiency once answered with the third rung instead of the first.
- Clicking the third throw of an imported ability rolled the first, whenever the
  import had left the throws unnamed.
- Deleting an ability's only throw no longer brings it back on the next render.
- **The 10' Pole role never recognised a pole.** Its inventory matcher had been
  committed with stray control characters where the word boundaries belonged, so
  it saw polearms, spears, pikes, halberds, glaives and lances — and not a pole.
- **A lantern could be fuelled with military oil.** The rule meant to keep the
  thrown-weapon flasks out of the lamp never fired, because the RAW item is
  named "Oil, Military (1 pint)" with the word *oil* first. A party's military
  oil was eligible to be burnt for light.
- **A swordsman with an empty off hand could not light a torch.** A lone sword
  widens to a two-handed grip whenever a hand is going spare, and the check read
  that as having no hands free — when in fact the grip yields the moment a torch
  arrives.
- The table is no longer told a player took up a role the party sheet refused
  them.
- **A player's light controls on their own character sheet did nothing.** Light,
  Douse and Shutter on the inventory tab wrote straight into the party's record,
  which only a Judge may change — so a player's click was refused and the lamp
  never lit, with nothing said either way. They now declare the action exactly as
  the party sheet does, and the Judge's client carries it out. A Judge clicking
  the same button still gets the Judge's own authority, never the declaring
  player's. The controls no longer appear to onlookers who do not own the
  character, having never been usable by them.

## 1.2.1

### Fixed
- **Capacity is a property of gear, not of a category called containers.** It
  lived inside the container record, so only items the module recognised as
  carrying devices could hold anything at all — which meant a coat could carry
  magical qualities but not a dagger. Any item may now be given a capacity, on
  its Construction tab, and anything with one is a container: a coat with hidden
  pockets accepts gear exactly as a sack does.
- Gear stowed in a garment still weighs on the carrier. The garment itself stays
  weightless, as the system has always had it, but its contents are ordinary
  items and count — so exploration speed and encumbrance read the same load they
  would if the dagger were loose in a pack.
- The stash dialog and the places model both asked whether an item carried a
  container record rather than whether gear could go inside it, so a coat with
  pockets was not offered as somewhere to put anything. Both now read one answer.
- Worlds annotated under 1.2.0 keep working: capacity is read from its new home
  first and the old one second, so there is nothing to migrate.

## 1.2.0

### Added
- **Gear now says where it is worn.** Cloaks, boots, gloves, belts, hats,
  packs and rigging declare a slot — head, neck, shoulders, body, worn, belt,
  ring, hands, feet, main hand, off hand, both hands, back or strapped — and the
  character sheet groups them under it. Every worn item that is not a weapon or a
  suit of armour also gets a **wear / take off control**, which core does not
  draw because it has nowhere to record the answer.
- **A slot picker on every item**, on the Construction tab. The slot is inferred
  when you run **Annotate Equipment**, and inference is sometimes wrong, so the
  picker is the correction: *Auto* hands it back, *Carried* declares that the
  item is worn nowhere at all.
- **Retrieval cost on containers** (RR pp. 293–294). Drawing from an adventurer's
  harness, belt pouch, bowcase, quiver or sheath is free; opening a backpack,
  rucksack or sack costs an action in lieu of movement.
- Slot capacity, from the Treasure Tome: a character can wear one of most things
  and **two rings** — and the Tome is explicit that a third stops all of them
  working.

### Fixed
- **The adventurer's harness now actually forgives its stone** (RR p. 142). The
  rule asked whether the harness was equipped; a harness is a plain item, which
  the system gives no "equipped" field, so the answer was always no and the rule
  had never once fired.
- **Gloves now block lockpicking** (RR p. 145), for the same reason — and now by
  the hands slot rather than only by the word "glove" in the name.
- **Worn clothing reaches the sheet.** The worn bucket existed but was
  unreachable, so a cloak you were wearing showed as merely carried.
- Renaming an item no longer changes what it is: a helmet, a cloak and a pair of
  gloves are identified by what they declare, not by their names. The name test
  remains for gear nobody has annotated.
- **Annotate Equipment now covers armour**, which it had always skipped — that is
  where the helmet-versus-suit distinction is recorded.
- Monster encumbrance no longer reimplements the system's own carrying-weight
  rule, so a monster's load and a character's are computed the same way.

## 1.1.1

### Fixed
- **Each ACKS sense is now its own sense, not a coat of paint on sight.** 1.1.0
  gave every dark sense a sight radius, which quietly made all of them behave
  like eyes: invisibility defeated a bat's echolocation, a *darkness* spell
  blinded it, tremor could not reach through a floor, and Hiding could not beat
  infravision. Each sense now carries its own detection mode —
  - **Lightless vision** is sight, and a character *proficient in Hiding* who is
    hiding defeats it (RULES §4).
  - **Shadowy senses** are hearing, scent and touch: blindness and invisibility
    no longer defeat them, but they switch off entirely while deafened, in
    magical silence, at running speed, or in magical darkness.
  - **Echolocation** is sound: unaffected by darkness or invisibility, stopped
    by walls, by deafness and by silence.
  - **Terrestrial mechanoreception** is ground vibration, using Foundry's own
    tremorsense — through walls, moving creatures only.
  - **Aerial, aquatic and webbed mechanoreception** sense pressure: darkness,
    silence and invisibility are all irrelevant to them.
- Each sense also renders distinctly instead of every one of them sharing
  Foundry's stock monochrome — lightless vision reads warm, shadowy senses cold,
  echolocation flat. Night vision keeps its dim-to-bright boost without core's
  green night-scope cast.
- A creature with several senses now looks through its longest and **detects
  with all of them**, each at its own range, rather than collapsing to one.
- A sense a condition has switched off no longer counts as seeing in the dark,
  so a deafened thief takes the blinded ⅓-speed penalty the canvas already
  showed them suffering.

### Added
- Two status effects the rules need and Foundry does not ship: **Hiding** and
  **Running**, toggled from the token HUD. Nothing infers them — whether a
  character is running flat out or has gone to ground is a declaration.

## 1.1.0

### Added
- **Token vision from ACKS senses.** Every token's sight is now derived from its
  own sheet, in a party or not. Ordinary eyes see only what a light source
  reveals; lightless vision sees its recorded range and a thief's shadowy senses
  reach 30', both as dim monochrome — no colour, no reading; night vision
  brightens dim light but stays blind in total dark. Monsters answer from their
  Full Monster Sheet stat block. Previously nothing wrote token vision at all,
  so every creature in the system's monster packs carried a stock 60' of dark
  sight and an unlit character saw as far as a bugbear. Edit a token's vision by
  hand and the module leaves that token alone from then on; the world setting
  **Token vision from ACKS senses** turns the pass off entirely.
- **Light follows whoever is carrying it.** A lit torch, lantern or candle now
  lights its bearer's own token, not just the party token — including an actor
  in no formation at all, which previously emitted nothing.
- **Detach a member to scout ahead.** Any member can step out of the party token
  onto their own and still belong to the formation: turns, rest, encounters and
  marching order keep counting them, while their vision and their torch become
  their own. Players may detach their own character; the GM may detach anyone. A
  scout can range one round's movement ahead, then waits for the party to catch
  up or pass — so the party token remains the one thing that spends dungeon
  turns. A fight deploys the party around a detached scout as normal.

### Changed
- The combat deploy and the new detach share one implementation, so the two
  cannot drift apart.

## 1.0.3

### Fixed
- The Influence button no longer appears on the header of an owned item's
  sheet. The character-sheet injectors identified their subject by reading
  `.actor` off the rendering window, and an owned Item's sheet reports its
  owner there — so every item belonging to a character was dressed as a
  character sheet. They now require the window's own document to be the
  character.
- Silenced the "relationships: no Notes-tab host found on the character sheet"
  warning. It was the same misidentification: an item sheet reached the Notes
  tab lookup, failed it, and tripped a once-per-session warning that then
  read as a permanent failure. The Relationships section itself was rendering
  correctly on the character sheet throughout.
- A character sheet with no primary tab strip — the Follower Card, this
  module's location sheet — is no longer reported as a missing Notes tab. It
  has none to extend, which is not a fault.
- Three shipped macros — **Influence Roller**, **Party Sheet** and **Dungeon
  Turn (+10 min)** — reached for the whole module api where they wanted one
  feature's. Since the merge that api is the aggregate (`{lib, abilities,
  equipment, formation, influence, monsters, henchmen, location}`), so it is
  never null and the `??` fallback behind it could never fire: the first two
  reported the module as "not active/enabled" and Dungeon Turn threw on
  `getFormations`. They now read `api.influence` / `api.formation`.
- The Full Monster sheet renders its item tags again. `tab-abilities.hbs` and
  `tab-spoils.hbs` read `item.flags.[acks-monsters]` while the annotations are
  written under `acks-extras`, so the ability-category tag and the spoil
  component / research-effect tags never appeared.

### Changed
- Comments and docs across abilities, equipment, formation, henchmen,
  influence, lib and monsters no longer name pre-merge flag scopes the code
  stopped using — every feature writes `flags["acks-extras"]`. `validate-extra`
  now scans `templates/` and understands Handlebars' bracketed segment
  literals, which is why the two stale templates above were finally caught.

## 1.0.2

### Fixed
- The Full Monster sheet is now the **default** for `monster`, not an alternate
  a GM had to pick per actor. It subclasses the system's own monster sheet and
  keeps every tab it defines, so nothing is taken away — the plain sheet stays
  selectable from Sheet Configuration.
- Animals get the Full Monster sheet too. Their combat block already mirrors the
  monster's field paths exactly, so the extended stat block (body form, load,
  training, reproduction) reads an animal unchanged — it had simply never been
  registered for the sub-type, leaving animals on the lean sheet.
- Resolving the sheet's base class now considers only the *system's* sheets.
  This module registers into the same map (the Full Monster sheet itself, and
  lib's Follower Card), and with the sheet now defaulted, an unfiltered lookup
  could subclass this module's own output.

## 1.0.1

### Fixed
- The 1.0.0 artifact still carried docs/. The tag was pushed before the
  template change that excludes it, so CI resolved the pre-fix workflow.

## 1.0.0

### Changed
- Documentation restructured into four kinds, each answering one question:
  MODEL (how it works now), DECISIONS (what was ruled and rejected), ROADMAP
  (what is not built), and guides/ (how to use it). Nothing is stated twice —
  a fact lives at the deepest level where it is entirely true.
- Code comments now explain mechanics only. Dated rulings, attributions,
  tombstones for deleted code and roadmap notes moved to the decision record.
  One ruling that had been restated at seven call sites is now stated once.
- MERGE-NOTES.md became docs/DECISIONS.md — it was already the repo decision
  record, for one event.

### Added
- docs/guides/ — a user-facing how-to per feature, and the landing page for
  release screenshots. docs/GALLERY.md indexes them with the release each shot
  came from.
- Docstrings on every exported class.

### Fixed
- getLoadout and computeDefaults each had an undocumented parameter.
- Several docs described a state that no longer held: the location sub-type
  collision was recorded as unresolved when it is resolved; the monsters enum
  migration was recorded as deferred when it had already happened, in the
  opposite direction; a referenced test file does not exist.

## 0.3.0

Location enhancements — a location becomes a **place** (2026-08-02).

### Added

- **Places nest.** A location can sit inside another: realm > town > inn >
  cellar > chest. The sheet gains a breadcrumb, a Contents tab listing
  sub-places and goods together, and drag-a-location-onto-a-location to
  re-parent. Cycles are refused at the write, not merely survived by the
  readers. An acks-equipment container item is the trivial case of the same
  model — see `docs/lib/PLACES.md`.
- **`acksLib.places`** — the new shared primitive behind all of it (nesting,
  occupancy, stack splitting, coin roll-up), with the Foundry-free half unit
  tested. `apiVersion` 11 → 12.
- **Location inventories hold living things.** Groups, monsters, retainers and
  animals go on a reference roster; drag an actor onto the sheet to place it
  there. Tokens on the linked scene are shown as *derived* rows — live, never
  stored, and promoted to a permanent record only by an explicit pin.
- **Scenes can be linked to a place.** A picker in Scene Configuration, "Create
  Place for Scene" in the scene directory, and drag-a-scene-onto-a-place. Never
  automatic: nothing is created until a GM asks.
- **Stacked places.** One actor can stand for eight identical warehouse bays;
  split one off when it becomes interesting.

### Changed

- **Markets are now opt-in per place.** A new location has no market: no
  recruitment, henchmen, mercenaries or specialists tabs, and the recruitment
  engine skips it entirely. "Add a market" is one click on the header or GM tab.
  The gate is on the DATA, not just the UI — `system.market` is genuinely `null`
  on a place without one, and every market field moved from `system.*` to
  `system.market.*`. Existing locations migrate on load; one whose market was
  empty and untouched becomes market-less.
- The sheet opens on **Contents** rather than Recruitment.

### Fixed

- **Deleting a place no longer loses the goods stored in it.** `returnGoodsTo`
  guarded on an identifier left undeclared by the module merge, so it threw a
  ReferenceError on any non-coin item and the caller swallowed it — under the
  default "return the goods" policy, which exists precisely to prevent that.

## 0.2.0

Post-merge cleanup pass (2026-08-02).

### Fixed

- **The proficiencies-powers compendium works again.** Its 25 Active Effect
  change keys shipped under the dead `flags.acks-henchmen` scope, so every
  proficiency's mechanics were inert (masked only by the name-fallback net).
- **Influence-hosted henchmen pages open again.** The version gate read
  `apiVersion` off the whole namespace instead of the influence feature, so
  hiring/loyalty/obedience/irrefusable-offer always fell back to plain
  dialogs. Monster wage levels read the same way and always fell back to
  sheet HD.
- **~255 dead CSS rules re-scoped.** The merge renamed the scope classes in
  JS but not the stylesheets — the party sheet, skill audit, monster sheet,
  roster, throw/posting dialogs, location sheet and ruledata browser were
  rendering unstyled. Rules for long-removed UI (the container panel, the
  pre-merge location header) are deleted instead.
- Equipment's proficiency-enforcement "auto" tested the module against
  itself; lock-picked/container-bashed hooks fired under dead
  `acksEquipment*` names; formation's map macro broadcast on an unregistered
  socket channel; 13 icon paths pointed at files Foundry v14 does not ship.

### Changed

- **One hook namespace.** Every custom hook and Handlebars helper now fires
  under `acksExtras.*`; the retired `acksFormation.*` / `acksInfluence*` /
  `acksMonsters*` names FAIL validation.
- **One socket transport** (`scripts/lib/sockets.mjs`) replaces the three
  per-feature ones, with duplicate-handler protection.
- Compendium art: bestiary monsters and sample characters get real portraits
  and token art; 30 ability items adopt the system's purpose-drawn icons.
- Dead compatibility gates, dead exports, duplicated helpers (`loc()` ×11,
  `num()` ×5, `gmIds()` ×4, `overlayEnabled()` ×6, the effect-scan core) and
  the eight copies of the `module.api` assignment are consolidated; stale
  pre-merge module ids are gone from messages, docs and pack prose; the
  loadout chat card is localized.
- `npm test` runs all three suites; `find:dead-config` scans the post-merge
  layout; bestiary builds are deterministic; validate-extra gains guards for
  namespace-root api reads, dead CSS scopes, icon existence and the widened
  stale-id patterns.

## 0.1.0

First release. Eight modules merged into one: `acks-lib`, `acks-abilities`,
`acks-equipment`, `acks-formation`, `acks-henchmen`, `acks-influence`,
`acks-location` and `acks-monsters`.

### Upgrading

Install this module, disable all eight old ones, reload, then run the **Clean Up
After the Merge (GM)** macro. Nothing is migrated — the old modules' data is not
carried across, and the macro removes what they left behind. A document whose
sub-type came from a now-absent module cannot load at all, so this step matters.

### Changed by the merge

- One module id, one flag scope, one global (`globalThis.acksExtras`, with a key
  per feature) and one `game.modules.get("acks-extras").api`.
- **One Location actor.** henchmen and location each defined a `location`
  sub-type; they are now one, with a single sheet carrying the market tabs and a
  storage tab.
- `damageType` was claimed by two features as a deliberate two-tier design (a
  hand-set override over a stamped classifier value); the override is now
  `damageTypeOverride`, because the module id used to be what told them apart.
- Paper Doll support removed.
- All 25 macros are in one *ACKS Extras* compendium folder.

### Fixed

- Equipment and henchmen effect-domain gates test exact domain membership rather
  than a shared flag prefix — which also tightens a pre-existing looseness, since
  the prefix test matched plain item flags that are not effect domains.
- The `attitude` Item sub-type shipped with no type label and rendered
  unlabelled.
