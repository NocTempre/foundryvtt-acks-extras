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

## 2026-08-19 — SIZES frontage structured into numeric footprints

**Ruled:** each `SIZES` entry gains `footprint: { w, h }` — the prose
`frontage` string restructured into whole battle-grid squares — so the
battlemap feature can size tokens from a monster's size category. The prose
label stays (it is what the sheet shows); the numbers are its machine shape,
not a second source. Sub-square frontages floor to 1×1: one body never
occupies less than a token square.

**Reviewer flag (ip-doctrine value rule):** these numbers restate the
frontage column of MM Overview p.11 that already ships in this file alongside
`weightMax` / `acMod` / `maxHD`. No gate distinguishes a structural constant
from a printed one — a human ruled that restructuring an already-shipped
column adds no new book content. If that premise is ever revisited, the whole
SIZES table goes together.

## 2026-08-28 — The animal's fields are a tab on this sheet, not an injected panel

Superseded the same-day ruling in `docs/vehicles/DECISIONS.md` that shipped
these fields as a panel prepended into `.window-content` by a render hook.
**The new evidence is what the first ruling did not check: which sheet an
animal actually opens.** It assumed a foreign host — the system's monster
sheet — that had to be decorated from outside. In fact `monsters/module.mjs`
registers the Full Monster Sheet for the animal sub-type with
`makeDefault: true`, so an animal's default sheet is OURS, and it already has
a tab structure, a form submission and a per-actor part filter. Injected DOM
was solving a problem that did not exist, and it landed the controls in the
one place a sheet has no room for them: floating above the tab strip, owning
its own change listener and its own writes.

Ruling: an **Animal tab**, a real `PARTS` entry and `TABS` row next to
Classification, gated per-actor both ways. The controls bind by `name` and the
sheet submits them, so the panel's hand-rolled change listener and its
`actor.update` calls are gone. `scripts/lib/animal-panel.mjs` is deleted and
its ten `ACKS-LIB.animalPanel.*` keys move under `ACKS-MONSTERS`.

Cost: the fields are now tied to this sheet. A world that switches an animal
to the system's own monster sheet loses them — accepted, because that is true
of every other field this sheet adds, and the alternative was decorating a
sheet we already own from the outside.

## 2026-09-04 — The Hit Dice rating writes core's roll formula

Field report: raising *Hit Dice* under Rating & Saves left the header reading
`1d8` and the follower card reading 1 HD, and core's HP roll rolled the old
die. The rating (`hd.count`, `dieType`, `bonus`) and core's `system.hp.hd`
were two authored fields for one fact, and only the header's was read by
anything.

Ruling: the rating is the authored source. A change to count, die or bonus
rewrites `system.hp.hd` on submit through `lib/actor-read.mjs` `hdFormula`,
the inverse of the parser the family already shared; a fraction of one die
scales the die (a ½ rating on a d8 is 1d4). Only the rating's OWN change
writes, so a formula typed straight into the header survives every other
submit. A dice button on the Rating & Saves legend submits the form and calls
core's `rollHP`, which sets current and maximum.

Rejected: parsing a header edit back into the rating. `1d4` cannot say whether
it is a ½ HD monster or a 1 HD one on a small die, so the reverse direction
would guess; one direction, from the field that carries the information, is
enough to keep the two agreeing whenever the rating is the one touched.

Rejected: rolling hit points automatically when the rating changes. A Judge
who set 4/4 by hand and then corrects a die type would lose the hand-set
value; the roll is one click, and it is the Judge's.
