# Base types — what an item IS, and what that means it must record

**Status: design, nothing built.** Owner direction 2026-08-15. Sibling to
[variations.md](variations.md), which needs this to exist: a variation's
`appliesTo` has to name something, and "the Foundry document type" is the wrong
something.

## The problem

The books sort equipment into categories — armour, clothing, weapons, gear,
food, gems, coins, trade goods — and each category records different things. A
gem has a cut and a carat. Food spoils. Clothing has a station it signals.
Coins have a mint. Armour has an AC and a class.

Foundry gives us eight document sub-types (`ITEM_TYPE`), of which only
`weapon`, `armor`, `item` and `money` are physical goods. Everything the books
distinguish below that line currently has three bad options, and this repo has
used all three:

1. **A bespoke Item sub-type** per category, which multiplies documentTypes,
   needs a world relaunch each time, and fragments every "is this goods?" query.
2. **A unique ITEM per case** — the route already taken in places — so a
   category becomes a document rather than a property, and a Judge who wants a
   second one copies the first.
3. **Nothing**, and the category's fields have nowhere to live.

## The shape

**Base type is a flag on the item, not a document type**, and it selects which
metadata the sheet collects and presents.

```
flags["acks-extras"].baseType   "armour" | "clothing" | "weapon" | "gear"
                                | "food" | "gem" | "coin" | …
```

One field, chosen from a vocabulary the BOOKS define, and everything downstream
reads it:

- **The sheet** shows the fields that base type records, and only those. A gem
  sheet asks for cut and carat; a food sheet asks for spoilage; neither shows
  the other's fields at all. This is the "special sheet" the direction asks for
  — but selected by a flag, not by a document type.
- **`appliesTo` on a variation definition names base types.** Gem quality
  applies to `gem` and nowhere else. Masterwork applies to `weapon` and
  `armour`. That is the vocabulary [variations.md](variations.md) was missing.
- **A category stops being a document.** One "gem" base type replaces however
  many bespoke gem items exist, and a Judge makes a new gem by making an item
  and choosing the type.

**A base type is not exclusive with magic.** A gem can be enchanted, food can be
poisoned, a coin can be cursed. Base type says what a thing IS; variations say
how this one differs. They are orthogonal by construction, and nothing should
be written that assumes otherwise.

## The collision, which is real

`foundryvtt-acks-core`'s `actor.mjs` derives real numbers straight from the
document type:

| Line | What it does |
|---|---|
| ~136 | AC from `item.type === "armor"` |
| ~869 | initiative from `item.type === "weapon" && system.slow` |
| ~885 | encumbrance from `["weapon","armor"].includes(item.type)` |
| ~982 | `items.filter(i => i.type === "armor")` |

So the document type is load-bearing in the SYSTEM, and the system is an
unmodifiable reference (CLAUDE.md). Two consequences, both binding:

1. **Base type must not replace document type — it refines it.** A suit of plate
   stays `armor` so core still computes AC from it; its base type says `armour`
   and adds what the books record beyond AC. Clothing is `item` with base type
   `clothing`. A gem is `item` with base type `gem`. The document type stays
   whatever makes core behave correctly; the flag carries the category.
2. **Where a base type genuinely needs core to treat it differently**, that is a
   wrapper on the shared `lib` subsystem with one owner, not a system edit —
   the standing rule for overriding core.

This is also why base type cannot simply BE a new document sub-type: a `gem`
sub-type is not `item`, so every core path that asks "is this ordinary gear"
stops seeing it, and the module would spend its life re-teaching core about a
category it invented.

## What the vocabulary is

**The books define the categories; this module does not invent them.** Under the
2026-08-15 IP doctrine the list of category NAMES is a structural vocabulary and
may ship (it is how the code talks about itself), but the fields each category
records, and every printed value in them, are content and arrive imported.

The line to hold: shipping `"gem"` as a key is naming a concept; shipping a gem
value table is not.

## Sequencing

Ordered against the standing lesson that the replacement ships before the thing
it replaces retires:

1. This design, agreed.
2. **Base type flag + per-type sheet metadata in `acks-extras`**, with existing
   items unaffected — an item with no base type behaves exactly as it does now.
3. **`acks-importer` sets base types** on what it materialises, and its
   cookbooks are rewritten to match (see below).
4. **Retire the unique-item-per-category cases**, migrating each onto an item
   plus a base type.

## Interaction restrictions — deliberately not built

Per owner direction: **do not enumerate which variations may combine with which
base types beyond what RAW rules on.** `appliesTo` gates the obvious (gem
quality is for gems), and a printed interaction gets an entry when a page states
one. Anything else stays legal, and a Judge who wants a poisoned gem is not
arguing with a matrix somebody invented.

## Migration is total

There is no two-spellings compromise. **Everything migrates, and the import
cookbooks are rewritten as necessary** — including the scavenged condition
labels that are currently PERSISTED into item flags, which
[variations.md](variations.md) had listed as a reason to hesitate. It is not
one. The cookbooks are ours; rewriting them is work, not risk.

## Settled (owner, 2026-08-15)

- **One sheet, swapping sections.** A single item sheet renders the fieldset for
  whatever `baseType` is set. One registration, no new document types, and an
  item that changes base type simply shows different fields.
- **The category KEYS ship; the fields and values import.** `"gem"` as a
  vocabulary key is how the code names a concept. What a gem RECORDS, and every
  printed number in it, arrives from the GM's own book. Same line the doctrine
  draws everywhere else.
- **Base types and variations ship TOGETHER**, in one release, so `appliesTo`
  never has to be keyed on document types and then re-keyed.
- **One flag.** `baseType` alone; what a category records is its metadata, not a
  second axis. A sub-category can be added when a second consumer wants one.

## What is being retired, and it is inference

The thing base types replace is not a set of bespoke documents so much as
**guessing from names**:

| Now | Becomes |
|---|---|
| `CLOTHING_SLOT_PATTERNS` — sixteen regexes deciding whether a name is a garment and where it is worn | `baseType: "clothing"` with a declared slot |
| `GEAR_PROFILES` — keyed by normalised item name, carrying capacity/slots/access | `baseType: "gear"` with declared capacity, slots and access |
| `WEAPON_ALIASES` / `WEAPONS` — name matching onto a weapon table | `baseType: "weapon"` with a declared category |

**Inference stays as the FALLBACK for unflagged items**, and the flag wins when
set. Removing it in the release that introduces the flag would strip every
existing world's clothing of its slots, which is the retire-before-replace trap
the template's own lesson names. Inference retires when the migration has run
and the importer sets base types on what it materialises.

## Open

- **Which bespoke items to retire, and in what order** — the inference tables
  above are the bulk of it, but an inventory of documents-that-should-be-
  properties is still owed.
