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
twice. `unlimited` and `sight` as shapes: no printed line takes them.
`untilSave` as a duration shape: it is a builder row (JJ ch. 14), not a
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

### Where the lang-key convention is recorded

The convention that a magic family's displayed label comes from
`ACKS-LIB.enum.<family>.<key>` is lib's ruling: `docs/lib/DECISIONS.md`,
"Vocabulary labels live in lang, keyed by family".
