# Changelog

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
