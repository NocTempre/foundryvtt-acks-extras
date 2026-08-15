# Variations — one shape for every way an item differs from its plain self

**Status: design, nothing built.** Written before the code because the same
model has been implemented four times already, differently each time, and a
fifth one-off would have been cheaper to write and worse to own.

## What is wrong now

An item can differ from the plain printed thing in at least six ways, and this
module models each with its own flag, its own table, its own resolver:

| Difference | Flag | Where its options live |
|---|---|---|
| Masterwork tier | `masterwork` | `config.MASTERWORK`, frozen, shipped |
| Silver | `silver` | `config.SILVER`, frozen, shipped |
| Shield variant | `shieldVariant` | `config.SHIELD_VARIANTS`, frozen, shipped |
| Scavenged condition | `scavenged` | imported ruledata (`equipment` doc) |
| Named arms | `named` | overlay |
| Disguise | `disguised` | overlay |

Three of those tables are book content sitting in a `config.mjs`, which is the
IP ruling above. But the deeper cost is that they do not compose: an item cannot
be a *silvered masterwork buckler* without three flag readers agreeing on the
order they apply in, and nothing makes them agree. `recomputeItemFields` already
has to hold a `pristine` baseline precisely because layered changes are not
modelled as layers.

## The shape

An item is a **pristine base** plus an ordered list of **variations**. That is
the whole model.

```
flags["acks-extras"].pristine   → the item as printed, captured once
flags["acks-extras"].variations → [{ kind, key }, …]
```

A variation TAG on the item is two strings and nothing else. What a tag *means*
is a **definition**, and definitions live in the register, imported from the
GM's own book — never shipped. This is the same bargain the thief ladders made:
the module knows the shape of a variation, not any particular one.

```
kind    what sort of difference this is      quality | material | form | apparent
key     which one of that kind               weaponToHit | silver | buckler | …
```

### The four kinds, and why the split is there

- **quality** — better or worse workmanship of the same object. Masterwork,
  scavenged condition. Changes numbers, never identity.
- **material** — what it is made of. Silver. Changes what the object *counts
  as* against immunities, and may change numbers as a side effect.
- **form** — a named sub-shape of the base object, with its own handling.
  Shield variants. Changes how it is used, not how well.
- **apparent** — the object is not what it appears. Disguise, and aesthetic
  variation generally. **Disguise is apparent value**: it changes name, image
  and worth *as presented*, and nothing about what the thing does.

`apparent` is the kind that pays for the model. Every other system here answers
"what does this item do"; `apparent` answers "what does this item look like it
is", and keeping the two in one list means a disguised silvered masterwork
dagger is expressible without a fourth flag and a fifth resolver.

### Resolution

`pristine` + variations applied in `kind` order (quality → material → form →
apparent) = the item's current fields. Order is fixed and declared rather than
emergent, because "masterwork then silvered" and "silvered then masterwork"
price differently and only one of them is right.

Every variation is removable: drop the tag, recompute from `pristine`. That is
already the promise `recomputeItemFields` makes and the reason the baseline
exists — this just makes it true for more than one layer at a time.

## What this unlocks beyond tidiness

**Class starting-equipment templates.** A template currently has to name a
distinct item for every variant it wants to grant, which is why the sample pack
carries a "Masterwork Sword (+1 attack)" as its own document. With variations a
template grants `sword` + `quality:weaponToHit` and the item is built, so the
list stops being a catalogue of pre-combined objects.

**The importer stops materializing combinations.** It imports the base items and
the variation definitions, and the combinations are made at use time.

## Sequencing — this is the part that bites

Per the template's 2026-08-15 lesson, the receiving end ships before the sending
end is retired. So:

1. **This design.** Agreed before code.
2. **`acks-extras` builds the model**: `pristine` + `variations`, the resolver,
   and register reads for definitions. The existing flags keep working,
   unchanged, reading the existing config tables.
3. **`acks-importer` releases recipes** for quality, material and form
   definitions, against this shape. Released, in a tag — not merely written.
4. **`acks-extras` migrates** the four legacy flags onto variation tags and
   deletes `MASTERWORK`, `SILVER` and `SHIELD_VARIANTS` from `config.mjs`.
   Carries a data migration, so it is a minor at least.

Steps 2 and 4 are separate releases on purpose. Doing them as one is how a
world upgrades into an empty masterwork dropdown.

## Open

- **Where scavenged sits.** It is already imported and already a `quality`, but
  its labels are PERSISTED into item flags (a pre-merge decision). Migrating it
  means rewriting those, or accepting two spellings of the same idea.
- **Whether `named` is a variation or something else.** A named weapon gains
  bonuses *by level*, which is a progression, not a fixed delta. It may belong
  outside this model entirely.
- **Cost composition.** Masterwork adds a flat gp; silver multiplies. The order
  rule above makes that deterministic, but the model has to say whether a kind
  contributes an addend or a factor, and the definitions have to carry which.
