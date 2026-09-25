# Magic — Decisions

Dated rulings, what was rejected, what each cost. Append-only.

### Three features, one vocabulary (2026-09-24)

**Ruled.** Magic is three feature slugs: `magic` (the spell primitive, the
vocabulary, the builder, casting, tracking, repertoires, magic types),
`magic-items` (the item model, powers, charges, use, generation) and
`research` (the project document, its kinds, its clock). Lang roots
`ACKS-MAGIC`, `ACKS-MAGICITEMS`, `ACKS-RESEARCH`; one feature-slug vocabulary
across `docs/`, guides and release snapshots.

**Rejected.** One `magic` feature. The Treasure Tome alone is item content on
the scale of a feature, and a research project is a long-running document
with its own clock; both would bury the spell.

**What it cost.** Three roots to keep in step, and a second hyphen
(`ACKS-MAGIC-ITEMS`) is not available: validate's key regex allows one, so
the items root is `ACKS-MAGICITEMS`.

### The spell primitive is a flag on core's spell Item (2026-09-24)

**Ruled.** Spell data lives at `flags["acks-extras"].spell`, a DataModel read
through the flag, on the acks system's own `spell` Item. Core's `lvl`,
`class`, `range`, `duration` and `save` stay the compatibility and display
surface and are written from the structured flag.

**Rejected.** An `acks-extras.spell` sub-type. Every consumer in this module
keys on `type === "spell"` (the character sheet, the follower card, the class
grants, formation, monsters, markets), and core's packs, the community
compendia and hand-made spells are all `spell` Items; a sub-type orphans all
of them.

**What it cost.** Validation happens on read, not on write, and two surfaces
(the sheet and the importer) share the duty of keeping core's display strings
in step with the flag.

### A code enum names a mechanism; a pick-list ships empty (2026-09-24)

**Ruled.** A family is code (`lib/magic-vocab.mjs`) only where the module
implements a mechanism its members select: a stat-line shape the importer
parses onto, a builder table axis, a branch of the cast engine. A list a
reader picks from — schools, elements, shades, components, transformation
aspects, detection modes, protection kinds, wall properties — ships empty as
an open vocabulary family (`SELECTION_VOCAB_DOC`) and fills from the Judge's
book. A member moves from the open family into a code enum only when the
engine gains a branch on it, and the entry recording the move names that
branch.

**Rejected.** Every repeated effect as a shipped code enum, which is what the
owner's "like weapon types" asks for read literally. The strongest counter,
rated MEDIUM: the family already ships `DAMAGE_TYPES`, `CONDITION_KEYS` and
`EFFECT_KEYS` as code, and the school tags are common words. The reply is
that those enums each back an engine branch, and that the words are not what
the page supplies — the membership is. The owner may still rule the other
way; only the file the members live in changes.

**What it cost.** Schools, elements and shades are strings validated at
runtime against the world's vocabulary document, not schema `choices`, so an
import from a book nobody has aliased yet cannot be checked offline.

### One frequency vocabulary (2026-09-24)

**Ruled.** `SPELL_LIKE_FREQ` is the union of the three tables that stated how
often a power may be used — lib's own, the monsters feature's `USAGE` and the
importer's frequency scan: thirteen members, from at will to by caster level.
`USAGE` is a re-export of it and every key a monster sheet stored is a
member; the importer's scan gains the three phrasings it could not read.

**Rejected.** Three tables that agreed on seven members and disagreed on six,
each read by one consumer.

**What it cost.** Nothing at the data: no stored key changes. The monsters
select offers thirteen options where it offered ten.

### Range and duration shapes come from the printed lines (2026-09-24)

**Ruled.** `RANGE_SHAPES` has six members and `DURATION_SHAPES` twelve,
folded from every distinct shape a range or duration line takes in RR ch. 5
§V.8 with its numbers removed; the unit (feet or miles; rounds to years) is
a field of its own. A concentration shape reads `CONCENTRATION_KINDS` for
whether the caster may move.

**Rejected.** `miles` and `milesPerLevel` as range shapes beside `distance`
and `distancePerLevel` (the scoping's first cut): the unit was being encoded
twice. `unlimited` and `sight` as shapes: no printed line takes them
(superseded the same day for `unlimited` — see "An unread stat line reaches
core's string"). `untilSave` as a duration shape: it is a builder row (JJ ch. 14), not a
printed duration, and reads as `indefinite` with its end condition.

**What it cost.** A shape the books add later is a new member and a lang
key, gated by the suite; the importer's parser is where a new printed
phrasing is first noticed.

### The first tagged release is the foundation (2026-09-24)

**Ruled by the owner.** The first tag ships the vocabulary, the spell
primitive with its sheet, the full RR ch. 5 spell import and the JJ ch. 14
math with the builder. Casting stays the acks system's own counter until the
release after. The alternate systems in scope are JJ ch. 15 custom magic
types, BTA gnosis, the Annals of the North eldritch ceremonies and the ACKS I
Heroic Fantasy Handbook engines (ceremonial magic, eldritch with its shaded
list, spellsinging) as forward-compatible content; ACKS II supersedes on
conflict.

**Rejected.** Casting first. Effect rows need the vocabulary and the imported
tables before a cast can execute anything mechanically.

**What it cost.** For one release a Judge can open every spell and price a
custom one, and still casts through core's counter.

### A spell's stat block is one raw field, parsed at import (2026-09-24)

**Ruled.** The `kind.spell` recipe reads the two-line block under a spell's
heading — magic types with levels, spell type, range, duration — as a single
`value` op with `pattern: "raw"`, and the runtime parses it
(`spell-logic.mjs` `parseStatBlock` → `spellFromStat`) onto the primitive
the moment the document is bound. The cookbook carries geometry and labels;
every value in the block arrives from the seat's page.

**Rejected.** Five authored boxes per entry, one per field: the block wraps
differently on every page and the label positions move with it, so the
boxes would be hand-fitted three hundred times and broken by the next
reprint. Parsing in the compiler: that puts page values into the cookbook.

**What it cost.** The parser is runtime code with its own tests, and a
phrasing it does not know reads as `special` with the printed text kept in
the note, where a Judge can see what was not understood.

### A body-size heading is found by its line; a proper name by its hash (2026-09-24)

**Ruled.** The spell headings print a half-point above the body ceiling, so
the compiler's solo-line scan reaches to that ceiling plus a half point while
the body read stays under it; the heading is the sub-heading anchor, its
siblings (same face, same size, alone on their line, same column) bound the
entry. One sample ritual is headed by a proper name: its row carries a
neutral label and a locator hash (`anchor.hash`), the `heading` op proves the
box by the hash and hands the printed words back for the document's name, and
which row that is stays on the rules shelf.

**Rejected.** Raising the body ceiling to the heading size: two pages set a
sidebar quotation and its attribution at that size, and both would join the
neighbouring entry's prose. A kind-level body-size override, tried and
reverted for the same reason. Naming the ritual's row after the page.

**What it cost.** A heading is told from a run of body text only by standing
alone on its line, so a one-word paragraph in the heading face would anchor
an entry; none prints in the chapter.

### One document per printed heading; the reverse is a name on it (2026-09-24)

**Ruled.** A reversible spell is one printed entry whose reverse is named
inside its prose, so it imports as one document: `reversible` from the
asterisk on the heading, `reversedName` read off the prose by the three
phrasings the chapter uses, `reverseOf` left for a Judge who keeps the
reverse as a document of its own. The scoping's open question is closed by
the page.

**Rejected.** Minting a second document per reverse: nothing on the page
describes it separately, a class's lists would count it twice, and a repair
would have to keep two documents in step from one entry.

**What it cost.** The cast dialog, when it comes, offers the reverse as a
mode of one document rather than as a spell of its own.

### A damage-type mark in prose becomes its word (2026-09-24)

**Ruled.** The RR sets a damage type in running prose as the same icon glyph
the MM's tables use. The executor's text op reads each such glyph through the
shipped `damageGlyph` table and keeps the word; a glyph the table does not
know is stripped as before.

**Rejected.** Stripping the mark, which every prose read did until now: a
typed roll reads as untyped, and a spell that names two types with "or"
between them reads as a sentence with a hole in it. Claiming the mark's
colour, which the book uses for extraordinary against mundane: the text layer
does not carry it.

**What it cost.** The word lands without its extraordinary or mundane
qualifier; the rule that decides it is release 2's.

### Spells land before the classes (2026-09-24)

**Ruled.** The getting-started chain imports spells before it imports
classes, because a class's templates are materialized as it is imported and a
template's spellbook resolves against the spells the world already holds.
Template resolution reads the printed name whole before it reads it loosely.

**Rejected.** Resolving spells by a name fragment first: with three hundred
spells in the library a short title lands on the longer title that sorted
first.

**What it cost.** A world that imported classes before this release holds
templates whose spellbooks resolved to nothing; re-materializing the class
gives them their second chance (`upgradeUnresolved`).

### Core's strings are derived (2026-09-24)

**Ruled.** The acks system's `lvl`, `class`, `range`, `duration` and `save`
are written from the primitive (`spell-logic.mjs` `coreFieldsFrom`), and
only where the flag states a shape: a range whose shape is unset writes no
range string (superseded the same day — an unset shape now writes its note;
see "An unread stat line reaches core's string"). On the sheet, a submit
that changes a shape rewrites the string
it expresses, an empty string is filled from the flag, and a string a Judge
typed by hand stays until the flag beneath it changes. The importer writes
both at once.

**Rejected.** Reading the strings back into the flag: a string is free text
and the flag is structure, and a parse that guesses wrong overwrites a shape
the Judge set. Hiding core's fields: the system sheet, the character sheet
and every consumer keyed on `system.class` still read them.

**What it cost.** Two surfaces keep the strings in step, and a Judge who
edits a string by hand and then a shape sees the string replaced.

### An unread stat line reaches core's string; `unlimited` is a range shape (2026-09-24)

**Ruled.** `displayRange` and `displayDuration` show the note alone when the
shape is blank, so a printed line the parser could not place still writes
core's `range` or `duration` string; a blank shape with a blank note still
states nothing. `RANGE_SHAPES` gains `unlimited`. The reverse-name reader
knows five more phrasings: "the reverse spell, X,", "the reverse form, X,",
"the reverse of <spell> is called X", "X, the reverse of <spell>," opening a
sentence, and "the reverse of this spell (X)".

**Evidence.** The live import of RR ch. 5 (the 1a gate): four ritual stat
lines print their range as "unlimited" and four print a duration that is a
phrase rather than a time — the flag kept each as its note, and the system
sheet showed those spells with no range or no duration at all. Seven of the
thirty-five reversible spells carried no `reversedName`, because their prose
names the reverse in a phrasing the three rules did not know. Neither was
visible offline: the parser suite reads invented lines.

**Supersedes.** In "Range and duration shapes come from the printed lines"
(same day): the rejection of `unlimited` — a printed line does take it. In
"Core's strings are derived": "a range whose shape is unset writes no range
string" — it now writes the note.

**Rejected.** `special` as the fallback shape for an unread duration: it
would state a shape the page does not print, and the sheet's picker would
show it as chosen; the blank shape with its note is what the page says.
`sight` as a range shape: still no printed line takes it.

**What it cost.** Nothing offline. A world imported before this ruling picks
it up with one repair of the *Spells* shelf, which rewrites the flag from
the new bind.

### An "and" can be a title's own word (2026-09-25)

**Ruled.** `spell-names.mjs` `splitSpellNames` splits a printed list on
commas, semicolons and conjunctions, and rejoins two neighbouring fragments on
" and " when neither is a known title and the join is. What is known comes
from a `titleIndex`: the register's spell titles at import (the class
binder's spellbooks and repertoires), the world's spell documents at bind (a
monster's prose). A list nothing can vouch for splits on every conjunction,
as it did before.

**Rejected.** A shipped list of the titles that carry the word: a page value.
The register's titles are already in the repo as entries, and a world's
documents are the Judge's own.

**What it cost.** Nothing offline. A title with "and" that a world has not
imported splits until it is, and a re-import or a package rebuild reads the
book again.

### A creature's repertoire is drawn to its slots (2026-09-25)

**Ruled.** A creature that casts as a class of a level, with no repertoire
printed, carries one drawn at random from that class's own picker list at
that level (`repertoire.mjs` `repertoireFor`), as many distinct spells of
each level as the slots say. The draw is `Math.random` unless the caller
supplies a source, and it happens once per build: at import for a stat block,
at generation for a template (the `acksExtras.templateResolved` hook), and
again at a repair or a re-generation, which replace the minted items. A
printed repertoire is copied as printed, and its counts are the slots when no
class grid says otherwise. A creature that only names spells draws nothing —
those are its abilities.

**Rejected.** Leaving the slots empty for the Judge: an enabled slot block
with no spells is a sheet that says "caster" and casts nothing. A fixed pick
(the first of the list): every dragon of an age would carry the same spells.
A draw for a creature whose entry names spells: the names are the entry's
whole statement.

**What it cost.** Two creatures generated from one template differ, which is
the point; a Judge who wants a particular repertoire edits the actor, and a
repair redraws it.

### Where the lang-key convention is recorded

The convention that a magic family's displayed label comes from
`ACKS-LIB.enum.<family>.<key>` is lib's ruling: `docs/lib/DECISIONS.md`,
"Vocabulary labels live in lang, keyed by family".
