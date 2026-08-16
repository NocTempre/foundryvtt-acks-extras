# Variations — an inventory of the ways an item differs from its plain self

**Status: design, nothing built.** Second draft: the first one misread the code
it proposed to replace, and the owner's requirements have sharpened since.

## What is actually there now

`properties.mjs` is closer to the target than the first draft of this document
claimed. It already holds **one** `pristine` snapshot and **recomputes** every
field from it:

```
pristine → + masterwork → + scavenged → + silver → written to the item
```

`layerDeltas` already combines three layers into one delta set
(`bonus`, `damage`, `ac`, `weight6`) and — the part worth preserving carefully —
already resolves **cost in three ordered slots**, for stated reasons:

| Slot | Applied | Why the order |
|---|---|---|
| `costBaseMul` | first, to the item's own listed price | silver is ten times *the weapon's* price |
| `costAdd` | then | masterwork is a flat surcharge, so silver must not multiply it |
| `costMul` | last, to the whole | a scavenged item is worth a fraction of whatever it would otherwise fetch |

So layering, a single baseline, and a considered cost order are **solved**. A
scavenged masterwork blade already works today.

## What is missing

1. **The layer list is closed.** `layerDeltas` takes masterwork, scavenged and
   silvered as named parameters. Shield variants, gem quality, named arms,
   cosmetic differences and (unbuilt) magic each mean editing that function and
   every caller.
2. **The definitions are shipped**, in `config.MASTERWORK` / `SILVER` /
   `SHIELD_VARIANTS`. Under the 2026-08-15 IP doctrine those are page values and
   belong in the register, imported.
3. **There is no conflict model.** Nothing stops an item holding two masterwork
   tiers at once, and nothing expresses the one printed cross-family rule
   (magic supersedes masterwork).
4. **Disguise is a whole-item field swap.** `disguiseItem` overwrites name, img,
   cost, damage and AC, storing `{true, apparent}`. It cannot express "hide the
   magical part and show the rest", which is what it is now needed for.
5. **Nothing else can grant a variation.** A loot table or a class template can
   only name a pre-combined item.

## The shape

An item is a **pristine base** plus an **inventory of variations**. Not one slot
per kind — a list, with an item's variations added and removed the way its
contents are.

```
flags["acks-extras"].pristine     the item as printed (exists today)
flags["acks-extras"].variations   [ { id, key, hidden?, data? }, … ]
```

An entry is a reference and nothing more. What a key *means* is a **definition**
in the register, imported from the GM's own book — never shipped.

```
key         "masterwork.weaponToHit"      what this is
id          a random id                    so an entry can be removed by identity
hidden      GM-only (below)
data        per-instance detail a definition asks for (a gem's carat, a name)
```

### A definition

```
key            "masterwork.weaponToHit"
kind           quality | material | form | named | cosmetic | magical
appliesTo      item types / tags this may go on
deltas         { bonus, damage, ac, weight6 }
cost           { baseMul, add, mul }   the three ordered slots above
label, hint    the words — imported, never shipped
```

### Conflicts are not a published property

**Any combination of variations is legal except two variants of the same
thing.** Nothing in the books declares that one variation excludes another; the
only exclusivity that exists is that an item has one masterwork tier, one
scavenged condition, one shield form — a single value for a single field.

So the family is **derived from the key**, which is already namespaced, and
there is nothing for the importer to author and nothing for a Judge to get
wrong:

> two entries conflict when their keys share a prefix — the part before the
> first dot.

`masterwork.weaponToHit` and `masterwork.armorAC` conflict; `masterwork.*` and
`condition.dented` and `material.silver` and `form.buckler` do not. A
**scavenged masterwork silvered buckler** is four entries in four families and
entirely legal, which is the case the owner named.

An earlier draft gave definitions an authored `slot` field for this. That was a
mechanism for a problem that does not exist: it would have to be filled in on
every imported definition, correctly, forever, to reproduce exactly what the key
prefix already says. Kind is *description* only, and is deliberately not the
exclusivity rule — keying on it would forbid the scavenged masterwork blade.

**RAW wins over this, as always.** The prefix rule is a default standing in for
a book that mostly does not speak on the subject — not a claim about what the
rules permit. Where a page DOES state an interaction, the page is right and the
default yields:

- The masterwork entry already carries one such statement: *magic and masterwork
  bonuses do not stack, because enchanting a weapon makes it masterwork
  automatically.* That is a cross-family rule between `magical.*` and
  `masterwork.*`, printed, and it has to be expressible before magic is built.
- Silver is stated NOT to interact: apart from gaining the Silver feature, the
  weapon's characteristics do not change. So `material.silver` composing freely
  with everything is RAW, not merely the default.

So definitions need room for a printed interaction — an `excludes` or
`supersedes` naming other keys, imported with the definition like everything
else. It stays EMPTY unless a page fills it, which is the difference between
this and the `slot` field the earlier draft invented: nobody authors it
speculatively, and when it is set there is a sentence behind it.

Where the extract is silent, the default holds and a Judge may combine freely.

### Hidden variations, and apparent value

**Disguise is not a kind — it is a per-entry `hidden` flag**, and it is what
makes an item lie about itself.

- **True value** resolves every entry.
- **Apparent value** resolves only the entries that are not hidden.
- A player's client is served the apparent one; a Judge sees both, and which
  entries are doing the hiding.

That covers the two jobs at once: hiding an (unbuilt) **magical** variation so an
unidentified sword reads as a plain one, and hiding the **worth** that variation
carries, because the price falls out of the same resolution rather than being
stored separately.

**Hidden governs presentation, not mechanics.** A disguised magic sword still
hits as a magic sword — not knowing what you carry has never stopped it working.
So `deltas` always apply in full; `hidden` decides only what the name, image and
price are computed from, and who sees which answer.

This supersedes `disguiseItem`'s stored `{true, apparent}` payload, which has to
guess which fields a disguise touched in order to undo it. Nothing needs undoing
when the truth was never overwritten.

### Like an inventory

The affordances are an inventory's, and that is the point of the shape:

```
listVariations(item)                  what it has
addVariation(item, key, {data, hidden})   refused on a family clash, by name
removeVariation(item, entryId)        by identity, so duplicates are removable
```

Add, remove, list, see it as rows on the sheet. No `setMasterwork`,
`setShieldVariant`, `clearScavenged` — one verb set for every kind of
difference, and a new kind needs no new API.

### Who grants them

- **The importer builds the register** of published variations from the GM's own
  books, and is the only source of definitions.
- **Loot tables and templates carry variations by default** — an entry names an
  item *and* the variations it comes with, so a table can roll a masterwork
  blade without a pre-combined document existing for it. This is what makes
  class starting-equipment lists stop being catalogues of pre-combined objects,
  and it is why the sample pack ships a distinct "Masterwork Sword" item today.

## Sequencing

Per the template's 2026-08-15 lesson, the receiving end ships before the sending
end is retired:

1. **This design**, agreed.
2. **`acks-extras` builds it**: the entry list, slot conflicts, hidden/apparent
   resolution, and the inventory API — with `layerDeltas` generalised over the
   entries. The three legacy flags keep working, still reading the shipped
   tables, so nothing regresses.
3. **`acks-importer` releases** variation definitions and the register that holds
   them, plus loot-table and template support for granting them. Released, in a
   tag.
4. **`acks-extras` migrates** the legacy flags onto entries and deletes
   `MASTERWORK`, `SILVER` and `SHIELD_VARIANTS`. Carries a data migration.

Steps 2 and 4 are separate releases deliberately.

## Open

- **Named arms are a progression, not a delta.** A named weapon gains bonuses by
  LEVEL, so its entry would have to resolve against the wielder rather than the
  item. Either `deltas` gain a level-scaled form, or named sits outside this
  model. Unresolved.
- **Scavenged labels are persisted into item flags** (a pre-merge decision), so
  migrating that kind means rewriting stored text or carrying two spellings.
- **Gem quality** comes from a different chapter than the equipment qualities
  and may want its own `appliesTo` vocabulary rather than an item type.
- **Whether an entry's `data` is free-form** or schema'd per definition. A gem's
  carat and a named weapon's name are both instance data with nothing in common.
