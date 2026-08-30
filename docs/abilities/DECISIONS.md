# Class powers & proficiencies — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### A tab panel declares its layout on the active state (2026-08-30)

**Ruled.** Every tab section this module renders emits Foundry's `active` class
from its own template (`tabs.<id>.cssClass`), and any rule giving such a section
a `display` states it on `.active`. Both halves are the rule, because each half
alone fails differently.

A bare class selector on a tab panel is declared after core's `.tab {display:
none}` and out-ranks it by source order, so the panel stands on screen under
every tab. A flex-sized panel then takes the height the OPEN panel wanted: the
Rolls list rendered under Description and squeezed the description panel — the
prose editor with it — to nothing, which reads as the editor having been
removed rather than as a stylesheet winning an argument.

A panel that emits no `active` class is hidden correctly on first render and
blank on every one after it. The sheet submits on change, so a field edit
re-renders, and the tab the Judge is working in empties while its nav button
still reads as chosen.

**Rejected: `!important`, and raising specificity with an element or id
selector.** Both restate "this panel is special" where the real statement is
"this panel is visible when it is the open one", and the next panel added would
have to rediscover it.

### A throw may name a score; no importer recipe carries one yet (2026-08-30)

**Ruled.** A throw carries `score: {key, times}` — an ability score the
character adds to it, times a multiplier — resolved in `withModifiers` beside
the bonuses other abilities grant, so every surface reads one number. An
exact-match throw takes no modifier, so a term declared on one is *stated*
rather than applied and both the preview and the chat card say so; announcing a
bonus the target does not carry is the failure this guard exists to prevent.

**No recipe emits one.** Reading the three core books for throws that take a
score modifier turns up exactly two, and neither belongs in a roll spec today:

- **Dungeonbashing (STR ×4)** — the factor attaches to the throw, not to the
  Adventuring entry, and already has an owner:
  [formation/DECISIONS.md](../formation/DECISIONS.md).
- **Disguise** — the throw is the *observer's*, and `rollField` has no
  `appliesTo`. A modifier on someone else's roll is an effect, which does carry
  one; modelling it as a roll on the disguised character would invert it, the
  same inversion `appliesTo` was added to `effectField` to stop.

So the field ships for the Judge authoring by hand and for a book that states
one; the importer gains nothing until a recipe has a throw to put it on.
Wiring `materializeRolls` for a spec no cookbook entry uses would be the
unreachable half of a feature this family has shipped before.

### An open family's entries are registered; a closed one's are code (2026-08-14)

**Asked.** Are the selection vocabularies registered by import rather than hard
coded — "matters most for setting proper names like languages"?

They were hard-coded with no registration path, while every other table-shaped
thing in the family reaches a world through the layered ruledata registry
(`lib/tables.mjs`). Selection vocabulary was the one that could not be added to.

**Ruled: the two halves are different and stay different.** A CLOSED family —
the six Weapon Focus groups, the five fighting styles, the eight Combat Trickery
manoeuvres, the four elements — names MECHANISMS this module resolves, and stays
in code. Widening one is not a missing feature: a sixth fighting style would be
a box that lights nothing, which the entry below already decided. Registration
is refused for these rather than half-obeyed.

An OPEN family — Art/Craft, Profession, Labor, Performance — is a list of proper
names out of a book. It ships **EMPTY**: `{open: true}` and nothing else. A world
fills it through `acks.selectionVocab`, one table per ability slug,
`{key: {label, aliases}}`, at whatever priority the layer deserves; until
something registers, the free-text line is the whole surface, which is what it
was always for. Nothing is required, which is why this is deliberately NOT
declared through `expectTables`, where a missing optional layer would read as a
broken import.

**Corrected within the day, and the correction is the point.** The first version
of this entry KEPT the eleven printed entries — Bowyer, Gemsmith, Smithing,
Judge, Merchant, Moneylender, Scribe, Bricklaying, Farming, Mining, Musical
Instrument — and called them "examples a world adds to". That is shipping a value
read off a page with a softer word in front of it. **A shortlist is not a smaller
kind of quotation**, and a registration path bolted on top of shipped content
protects nothing: the damage is done the moment the name is written into the
repo. The entries are gone. Read-and-register is the whole mechanism, not an
addition to it, and reading them out of the GM's own book is acks-importer's
work.

The KEYS of the closed families stay, and are not the same thing: `weaponshield`
is an identifier the loadout rules branch on, and the module cannot resolve a
style it has no name for. Their LABELS are a separate open question —
`"Weapon & Shield"` is display text, and whether that too should arrive by
import is recorded in [ROADMAP.md](ROADMAP.md) rather than settled here.

**Languages prompted the question and are the one thing this does not serve.** A
tongue is a document in a slot carrier ([classes](../classes/MODEL.md)), not a
string ticked off a list — setting-defined content a world names, holds and
fills. Nothing about languages moves into this vocabulary.

---

### A selection is chosen from a shortlist, and still typed when it is not on it (2026-08-14)

**Reported.** Weapon Focus, fighting styles, weapon and armour proficiencies
"are neither selectable with enums nor import cleanly on templates".

**Ruled.** `selections` stays free text in the model — the reason has not
changed: the meaningful token set is per-ability and lives in the book, so the
schema cannot enumerate it, and a Judge may approve a craft nobody printed. What
was wrong was the SHEET, which offered boxes only for the three class-build
categories in `SELECTION_VOCAB`. That table is keyed by CATEGORY, and every
ability the report named shares the one `proficiency` category, so a
category-keyed vocabulary could not tell Weapon Focus from Combat Trickery no
matter what was added to it.

`SELECTION_VOCAB_BY_ABILITY` is keyed by the ability instead, and the sheet asks
it first and the category second. Nine families are enumerated; the storage
shape, the flag and every consumer are untouched.

**Fighting styles list the five the mechanics resolve, and no more.** Core's
pack also ships "Fighting Style: Pole Weapon", and `resolveStylePick` returns
null for it — the caller then skips the pick silently, so offering it would
have been offering a choice that grants nothing and says nothing. Verified in
the other direction too: every key in every enumerated family round-trips
through the equipment bridge's resolvers to itself, so ticking a box lights the
mechanic rather than merely recording a word.

**An open family is a shortlist, not a closed set.** Art/Craft, Profession,
Labor and Performance carry `open: true`; anything outside the list goes in the
free-text line, which is also what a cleared selection falls back to, so free
entry is always available.

**The "(spec)" suffix is derived, not typed.** The name is a display of the
pick, so choosing one writes it and clearing them takes it off; an existing
suffix is replaced rather than appended to, or re-picking stacks a second
parenthesis onto the first. Labels rather than keys, because a name is read.
Only abilities that HAVE a vocabulary are renamed — one with no picks to offer
keeps whatever name it was given.

**Matching is what makes a template import cleanly.** A cell's parenthesized
selection is written verbatim, so the shortlist recognises the phrasings the
books and templates actually use (`weapon & shield`, `2-handed weapon`, `Two
Weapon`, `Swords`) through per-entry aliases; the first save then normalizes the
pick to the canonical key. Exact and alias matches are tried across the whole
vocabulary before any loose match — otherwise "crossbow" is claimed by "bow",
which order alone decided — and loose matching needs four characters, or a
one-letter typo lands on a real pick.

### A modifier must name what it modifies, and may name the throw (2026-08-06)

`targetOf` resolved a throw's own ladder and nothing else, so every modifier the
books state against a proficiency sat inert. Measured live: of the world's
ability effects, 42 were proficiency-throw modifiers, 9 named what they
modified, and none named anything but themselves.

Ruled: modifiers are folded in at `targetOf`, so the strip, the roller, the chat
card and Favorites cannot disagree about what a throw comes to. Two guards:

- **A modifier must NAME its subject** (`forWhat`). An unattributed "+2 to
  proficiency throws" is what the importer's generic scan left behind when it
  dropped the activity from the sentence; applying those would give a character
  every bonus in their list on every roll they make. acks-importer now captures
  the name.
- **One ability counts once.** Holding a proficiency twice is RANK (RR §III.3),
  which the ladder's own `rank` scale already answers; counting both copies
  would apply the bonus twice and then let the ladder apply it again.

**A modifier scoped to one way of attempting a thing names that THROW**
(`appliesToRoll`), because the variants are already separate keyed throws.
*Rejected: matching the modifier's `condition` prose* — Lockpicking's names both
of its throws in a single string ("methodical attempt (one turn); not a hasty
attempt"), so any reading of it lands the +4 on the hasty attempt too.

A conditioned modifier naming no throw is returned unapplied rather than guessed
at: that is a gap in what was captured, and the importer closes it.

---

### An ability has a default throw, stored per item (2026-08-06)

Core reaches an ability's roll from one control and can only make one throw, so
every route that cannot name one — the row icon, the chat card button,
`item.use()`, a hotbar macro — reached whichever throw happened to be first.

Ruled: the ability carries which throw those routes reach, cycled from the
sheet. Stored per ITEM, so one character's Lockpicking can default to the
methodical throw while another's does not. Blank, or naming a throw since
deleted, reads as the first — an ability that silently rolls its first throw is
better than one that rolls nothing.

---

- **2026-07-18 — flag-stored model, not a document sub-type** (the same shape
  the monsters feature uses): reuse the system's own `ability` item, add data via
  a flag DataModel + alternate sheet. Nothing mutates the acks system.
- **Effect vocabulary lives in the shared library** (`../lib/fields.mjs`), so it
  is one definition across every feature. The immunity / sense / movement /
  naturalAttack shapes are the ones the monster extras model is the remaining
  adopter of — see [../ROADMAP.md](../ROADMAP.md).
- **Ownership is never stored here.** Which class or monster HAS an ability is
  defined by the container (a class/monster item lists its abilities), per the
  register model — the ability node is a reusable definition. `general` (the
  "(G)" marker) is the one membership fact tracked, because it is intrinsic.
- **Binding target for acks-importer:** on import it writes this flag; the full
  literal prose stays a lazy `@PdfText` descriptor, the mechanical effect
  materializes per seat and persists here.
- **2026-07-24 — this module owns core's ability roll path.** `AcksItem#rollFormula`
  is the system's ability roller and can only ever make **one** roll: it reads
  `system.roll` / `system.rollType` / `system.rollTarget` directly. So every
  route into it — the proficiency row on the character sheet, the chat card's
  Roll button, `item.use()`, a hotbar macro — reached only an ability's *first*
  throw, while the Rolls tab showed all of them. That is one ability rolling two
  different ways depending on where you clicked.

  `scripts/roll-wrap.mjs` wraps `#rollFormula` and `#getTags` (lib-wrapper,
  MIXED) and routes `ability` items to `rollAbility()`. Other item types fall
  through untouched.

  **One owner per wrapped core method: these two are ours.** Multi-roll
  abilities are this module's domain, so the wrap lives here rather than in
  the lib subsystem. No sibling may wrap them; anything else that needs to influence an
  ability roll goes through the API (`rollsOf`, `rollAbility`, `targetOf`).

  A no-roll ability now **shows** itself instead of rolling. Core intends this
  already — `use()` has a "no roll, so show it" branch — but it tests
  `system.roll`, which defaults to the string `"1d20"` and is therefore always
  truthy, so a proficiency that makes no throw still posted a d20 scored
  against a target of 0.

  *Handoff:* this exists only because the system stores one roll per ability. If
  `system.rolls` ever lands upstream as an array, delete the wrap and let core
  roll them — the store, not the roller, is the thing that has to change.
- **2026-08-03 — rolls are entered by hand, as an inventory.** The Rolls tab
  showed what an import had written and offered no way to write one. Everything
  the model can express was reachable only by editing a flag, which is not a way
  to enter a book. The tab now adds, deletes and opens throws, and each throw has
  a window.

  **The window is per THROW, not per tab.** A throw is the unit the book prints —
  "Diagnose Illness, 11+ at one rank" — and its target, its qualifier and its
  ladder are one statement. A tab-wide grid of every throw's every field was
  rejected: it fits the storage shape, not the page anyone is copying from.

  **Fields apply as they are typed; there is no Save button.** Same as a sheet.
  A Save button on a subordinate window creates a draft that can be lost by
  closing it, and answering "was that kept?" is exactly the doubt manual entry
  does not need.

  *Cost:* every keystroke-group writes the item, so a roll cannot be edited by a
  seat that cannot update the item. That is already true of the sheet.
- **2026-08-03 — a target is read at the scale its roll declares.** `rollField`
  has carried `scale` since it was written, the sheet labelled its ladder with
  it, and `targetOf()` resolved against class level regardless — so Animal
  Husbandry's rank ladder, read on a 5th-level character who had taken the
  proficiency once, answered with the third rung. It resolves at `scales[scale]`
  now. A scale nothing can supply yet (Arcane Value, Hit Dice) answers null for a
  ladder and the sheet shows the whole ladder, rather than a number read at the
  wrong rung.

  Consequently the editor does not author `conditional`, which names a scale of
  its own: two scale pickers on one throw can disagree, and one of them would be
  a lie. A roll that arrives carrying one still resolves correctly, and opens as
  the table it is with its own scale already in the picker.
- **2026-08-03 — a roll's key is assigned once and never rewritten.** It is what
  a macro or an importing module holds. Deriving it from the label — considered,
  because `diagnoseillness` reads better than `roll0` — would retarget those
  silently every time a throw was renamed. The label is what a reader identifies
  a throw by; the key is what code does, and it is never shown.
- **2026-08-03 — deleting the last roll resets core's `roll` / `rollTarget`.**
  `rollsOf()` folds those fields in when the store is empty, so a throw that had
  never been edited here came back on the next render after being deleted. The
  values written are the schema initials (`1d20`, 0) — which the fold already
  reads as "not a roll", so this clears core's stale copy rather than authoring
  anything into it. The alternative, a marker flag saying "the list is
  deliberately empty", adds a field whose only reader is this one case.
- **2026-08-05 — blind is per ABILITY, and it is core's `system.blindroll`.**
  Two docstrings asserted that blind "lives on the Rolls tab". No tab, template
  or editor ever carried it, the replacement details partial had dropped core's
  checkbox, and `rollAbility()` set no roll mode — so an ability could not be
  rolled blind at all, and this record had never ruled anything about it.

  Ruled: reuse core's field. The checkbox is back on Description with core's own
  markup and core's `ACKS.items.BlindRoll` key, and `rollAbility()` posts under
  Foundry's `blind` message mode — `self` when the roller is the GM, which is
  the distinction `AcksDice.#sendRoll` makes. It reaches every throw, because
  `rollAbility()` is the single point both the Rolls tab and core's roll path
  arrive at. The mode is passed as `messageMode`; the legacy `rollMode` spelling
  core still uses logs a deprecation on every call under 14.

  **Per-throw blind was rejected.** It needs a new field on acks-lib's
  `rollField` — a schema change to re-express, per throw, the one ability-wide
  fact core already stores — plus a checkbox in every throw window. Nothing in
  the books prints blind per throw: whether a result is hidden is a table
  convention about the ability (Hear Noise, Hide in Shadows), not part of what
  the throw is.

  **Blind on the Rolls tab was rejected**, asserted though it was. That tab is
  one row per throw; an ability-wide control standing among them reads as
  belonging to whichever row it sits nearest.

  *Cost:* the checkbox renders only while the ability HAS a throw. An ability
  with none does not roll — the wrap shows its card instead — so there is
  nothing for blind to hide, and a control offered there would be exactly the
  dead switch this entry exists to remove. A blind flag already stored on a
  throwless ability is inert and unseen until a throw is added; it is not
  cleared, because the ability may simply not have been entered yet.
- **One store, one read path for rolls.** `extras.rolls` is where an ability's
  throws live; `rollsOf(item)` is the only place anything reads them, and it
  folds core's singleton fields in when this module has not written the flag
  yet. So an unmigrated item presents the same shape as a migrated one, nothing
  writes core's roll fields, and there is no migration to run. A core record
  sitting at its schema defaults (`1d20`, target 0) is **not** a roll — those
  are field initials, not a throw anyone entered.
- **A proficiency throw wears the system's own chat card.** Throws posted as a
  bare `Roll.toMessage` flavour line — the one roll at the table with no banner,
  no portrait and no success rule, sitting beside attack and save cards that had
  all three. Ruled: render **core's own** `chat/roll-result.hbs`, the template
  the system posts its saves and reactions through, rather than grow a second
  card here. A system that restyles its chat carries proficiency throws along
  with it, and there is no second card to keep in step.

  The resolved target rides core's success row (`Success (14+)`) instead of a
  line of its own, because the template already prints it there and the old
  flavour line stated it twice. The details slot keeps only what core has no
  field for: the book's condition on the throw, and the reason a shared world
  item cannot be scored at all.

  The card is rendered **without** `rollACKS`, deliberately. `toMessage` attaches
  the Roll to the message either way, so embedding the dice in the card as well
  would show them twice; leaving it out keeps blind rolls, roll modes and Dice So
  Nice on the one path every other roll uses. A template the system has moved or
  renamed costs the throw its card and never its result — this roller is the one
  place an ability's throw is posted, and a throw that reached it is one the
  player already made.
