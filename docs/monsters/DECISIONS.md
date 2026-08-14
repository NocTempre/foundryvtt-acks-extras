# Full monster stat block — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

- **2026-08-02 — the Full Monster sheet is the DEFAULT, not an alternate.** It
  shipped as a non-default sheet a GM had to select per actor, which meant the
  world carried two monster sheets rendering the same monster at different
  depths and the extended stat block was invisible until somebody went looking
  for it. The sheet SUBCLASSES the system's own monster sheet and keeps every
  tab it defines, so defaulting it adds the extended block and takes nothing
  away — the same reasoning that already made the ability and equipment item
  sheets defaults.

- **2026-08-02 — the animal sub-type gets it too.** `acks-extras.animal` mirrors
  the monster's field paths exactly (that is the sub-type's entire premise), and
  the extended block is *more* relevant there than on a wild monster — body
  form, normal/max load, training months and trained value are the animal
  half of the model. It had simply never been registered for the sub-type.

  lib still registers the system's plain sheet for `animal` first and this
  registration takes the default over, rather than lib deferring: registering
  regardless is what guarantees an animal has a working sheet even in the build
  where the Full Monster sheet cannot be constructed.

- **2026-08-02 — REJECTED: unregistering the system's monster sheet.** It would
  have given a single entry in the picker, but it removes the lean view from
  every world that wants it, strands actors pinned to it, and buys nothing the
  default does not — a default already decides what opens. The plain sheet stays
  selectable from Sheet Configuration.

- **2026-08-02 — REJECTED: a replacement character sheet.** Considered while
  making the monster sheet default, and rejected as an inversion of the family's
  doctrine (reuse → extend → enhance → invent). The character side is enhanced
  *in place* through render hooks (wear buckets, proficiency strip, hirelings
  grid), which is already "one correct sheet" — a parallel implementation would
  be a second thing to keep in step with core, for no user-visible gain.

- **2026-08-02 — the base-class lookup ignores this module's own sheets.**
  Consequence of the default above. The base is resolved by scanning
  `CONFIG.Actor.sheetClasses.monster`, and this module registers into that same
  map twice — the Full Monster sheet, and lib's Follower Card. An unfiltered
  lookup could therefore pick one of ours and subclass this module's own output,
  growing a fresh inheritance layer on every reload. The filter is on the
  registration key prefix, so it covers both without naming either class.

## 2026-08-14 — Defence bands adopt the shared shape; capacity answers once

**Ruled:** `defenses` in the monster extras model is lib's `defensesField()` —
the same bands the ability model stores, so a granted immunity and a printed
one read identically. The lib band gains a per-band `note` (additive) for
printed qualifiers the closed sets cannot carry. The pre-4.0 free-prose
`effects` string is migrated once at ready, shape-gated: tokens naming a known
effect or condition become set members, the remainder joins the note. The
sheet's encumbrance now reads lib's capacity primitive — items, coin, and a
mounted rider at body weight plus carried encumbrance (RR ch.6's 15-stone
adventurer) against MM p.13's normal/max loads.

**Rejected:** keeping a monster-local defence shape (two shapes for one
concept across the family), and a setting-gated migration (the shape itself
is the gate — a fired migration cannot match again).
