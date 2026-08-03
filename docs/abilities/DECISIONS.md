# Class powers & proficiencies — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

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
- **Binding target for acks-content:** on import it writes this flag; the full
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
  acks-lib. No sibling may wrap them; anything else that needs to influence an
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
- **One store, one read path for rolls.** `extras.rolls` is where an ability's
  throws live; `rollsOf(item)` is the only place anything reads them, and it
  folds core's singleton fields in when this module has not written the flag
  yet. So an unmigrated item presents the same shape as a migrated one, nothing
  writes core's roll fields, and there is no migration to run. A core record
  sitting at its schema defaults (`1d20`, target 0) is **not** a roll — those
  are field initials, not a throw anyone entered.
