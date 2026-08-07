# Classes — how it works

The `acks-extras.class` Item sub-type ([scripts/classes/class-data.mjs](../../scripts/classes/class-data.mjs))
holds a character class as a document: what an RR class spread prints, held as
structure. The module ships no values — a class document is filled by
acks-importer from the GM's own book, or typed by hand in the constructor
sheet. Both produce the same document and open in the same sheet.

## The document

- **Fixed fields** — requirements, key attributes, maximum level, hit die,
  the level-progression rows (`levels`: level / XP / title / printed Hit
  Dice), save and attack **bands** exactly as printed (`minLevel`/`maxLevel`
  runs), named numeric **ladders** for the spread's extra columns (damage
  bonus, AC bonus, backstab dice, caster level, the assassin/bard skill
  columns), cleaves as a lib LevelValue, racial traits, and `factored` —
  demi-human spreads print racial save modifiers already applied, and nothing
  may apply them again.
- **Chassis** — `saveChassis` / `attackChassis` name another class whose
  printed bands this class borrows ("Explorer (Fighter)"); they are
  independent because the priestess and witch borrow crusader saves but mage
  attacks. A class with its own bands leaves them empty. Save bands use the
  BOOK's vocabulary (`blast`, `spells`); translation to the released system's
  actor keys (`breath`, `spell`) happens only in
  [lib/actor-compat.mjs](../../scripts/lib/actor-compat.mjs) `savesUpdateData`.
- **Inventory** — the class's pool of available abilities (class proficiency
  list, powers, skills), as refs: a cookbook id (`def.prof.x`) resolved
  against the importer's stamp, or `uuid:<uuid>` for hand-made items. The
  sheet's lists **accept** drops; nothing is offered from a catalogue.
- **Award ladder** — flat per-level entries: a **fixed** award grants a ref;
  a **choice** award carries a ChoiceSpec
  ([lib/choice-spec.mjs](../../scripts/lib/choice-spec.mjs)) — "choose N from
  the class inventory / the general list / a listed set". One chooser shape
  serves the award ladder, template bundles, and any future pick-N grant.
- **Casting** — 0–2 traditions (2 only for the Nobiran), each typed by kind
  (`vancian` now; `points`, `ritual`, `ceremonial`, `gnosis` are carried by
  the schema so later content lands without a break), with a printed slot
  grid or a pool schedule and a repertoire kind.
- **Templates** — the eight printed 3d6 templates, each an inventory bundle
  of abilities and items (with the printed skin descriptor per item) plus
  spells, gp and the encumbrance note. Applied by chargen.

## The registry

[scripts/classes/registry.mjs](../../scripts/classes/registry.mjs) publishes
class-derived rules tables into lib's layered registry at WORLD priority
whenever world class items change: `acks.classProgressions` (the four chassis
attack/save progressions) and `acks.class.<key>` per class with own bands or
ladders. `resolveLevelValue` completes lib's resolver: the `progression` kind
("as a fighter of half his level") reads the published chassis attack table —
the seam named in [abilities/ROADMAP](../abilities/ROADMAP.md).

## Applying a class

`applyClass` ([scripts/classes/apply.mjs](../../scripts/classes/apply.mjs))
builds one batched update for the character's level — saves (released keys),
attack throw, title, XP-to-next, hit-dice formula, cleaves, the vancian slot
grid — and shows every change old → new before writing. Fields whose current
value differs from what the LAST apply wrote are marked hand-edited; the
written values are recorded at `flags["acks-extras"].classes.applied` so the
next apply can make that distinction again. Cells the book leaves blank are
skipped, never zeroed.

The picker ([scripts/classes/assign.mjs](../../scripts/classes/assign.mjs))
is injected beside the system's free-text class input on character sheets and
binds the actor to a class document (`flags["acks-extras"].classes` +
`details.class` for system compat).

## Level-up

[scripts/classes/levelup.mjs](../../scripts/classes/levelup.mjs) watches XP
cross the class document's next-level threshold and notifies — never applies.
The wizard rolls HP per the world setting (RAW default: reroll the full Hit
Dice, Constitution per die and never on the printed flat bonus past 9th,
minimum one over the old maximum), lists the new level's fixed awards, opens
a picker per choice award (its ChoiceSpec resolved against the class
inventory or the world's general list), then grants the abilities (deduped
by cookbook ref), writes HP, applies the class row for the new level, and
posts a chat summary.

## Chargen

Chargen happens on the system's own Scores Generator — the page that already
rolls the attributes, a 3d6 template die and starting gold.
[scripts/classes/stat-page.mjs](../../scripts/classes/stat-page.mjs) injects
the rest of it: a reset beside everything rollable, a class chosen once the
scores are known and before the template is rolled (offering only classes
whose requirements those scores meet, with a GM-only Judge override), the
template die read against that class under the printed at-or-below rule
(its own Judge override), the class's level-1 choice awards, and the
Intellect bonus general picks. All of it rebuilds on every change, because
all of it is downstream of the scores. Picks are read at submit and applied
at close — the first moment core's own write of the scores is known to have
landed, which the Intellect count depends on.

[chargen.mjs](../../scripts/classes/chargen.mjs) applies what was chosen:
the class at level 1, then the template bundle — proficiencies as owned
abilities, equipment as skins over base items, gp, the spellbook's spells —
then the class's own first-level awards (fixed grants deduped by ref against
what the template carried, plus the chosen picks).

**Intellect is netted against the template.** Most templates assume no bonus
(RR Ch. 2 §II.1), so the whole bonus is the player's to spend. The studious
spellcasters' templates assume one — a proficiency listed last and a spell
listed second — recorded as `templatesAssumeIntBonus` on the class document
and filled by acks-importer, because it cannot be derived from the document
([DECISIONS.md](DECISIONS.md)). Below that band the two printed entries are
withheld and named in the chat summary; above it only the difference is
offered.

## Casting

[scripts/classes/casting.mjs](../../scripts/classes/casting.mjs): the class
document is authoritative for CAPACITY (slot row or pool schedule at the
character's level); the actor stores only what is SPENT
(`flags["acks-extras"].classes.pools`). The character sheet gains a
per-tradition strip — slot pips to spend/refund, a +/− pair on a points
pool, a capacity line for a ladder-backed tradition (the gnostic invocation
level), and a rest control that DELETES the pools key (update merges
objects, so writing an empty object resets nothing). It is the only surface
that can show two traditions at once. The system's own `spells.1..6.max`
grid stays the single-tradition compatibility surface applyClass writes.

## Sheet category tabs

[scripts/classes/sheet-tabs.mjs](../../scripts/classes/sheet-tabs.mjs)
filters the character sheet's ability list by bucket — fighting (the
training flag), thief skills, general and class proficiencies, class
powers, and racial (whatever the bound class awards with a racial-trait
note) — and the spell list by tradition (`system.class`), so new tradition
tabs appear the day such spells exist. A skinned item's sheet carries a
badge naming what it is an instance of, with the embellishment parsed
apart from the base at grant time (`flags.skin.embellishment`).

## Save-reference repair

`repairSaveReferences` (lib/actor-compat.mjs) finds references to save keys
the released schema does not carry — stray dev-schema `saves.blast` data,
ability items whose `save` names a book key, Active Effect change keys — and
remaps them, dry-run by default. It is also the future migration seam for the
system's breath→blast rename.
