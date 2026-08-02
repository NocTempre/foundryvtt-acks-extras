# Locations — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what the ruling cost. How it behaves *now* is [MODEL.md](MODEL.md); what is not
built yet is [ROADMAP.md](../ROADMAP.md).

Entries are dated and append-only. **A superseded entry stays, marked as
superseded** — the value of this file is that a settled question is not
re-opened, and knowing an option was tried and abandoned is worth more than a
tidy list of only the current answers.

---

### A location is a PLACE, and a market is an option on one (2026-08-02)

Four rulings taken together, all from the owner.

**1. Every scene may have a linked location — on demand, never automatically.**
The scene holds the canonical flag (`scene.flags.acks-extras.location`);
`system.sceneUuid` is a mirror kept true by `scene-link.mjs`. The scene's end
wins because scenes get duplicated, imported and deleted by hands that never
touch the actor directory.

*Rejected:* auto-creating a location per scene. Most scenes in a real world are
battle maps, lighting tests and half-finished sketches; a module that added forty
actors on first load is a module that gets turned off. The affordances are a
scene-config row and two directory context entries. A battle map is not a place
until somebody says it is.

**2. Places nest, and they unify with containers.** `system.parentUuid` gives
realm > town > inn > cellar > chest. The primitive lands in acks-lib
([docs/lib/PLACES.md](../lib/PLACES.md)) because nesting is not
settlement-specific. A chest is the *trivial* place, and that is a constraint
rather than an analogy: anything the location sheet does to a town it must be
able to do to a chest.

**3. Location inventories hold more than items.** Foundry has no
actor-inside-an-actor, so groups, monsters, retainers and animals are a
REFERENCE roster (`system.roster`), denormalised so a deleted actor leaves a
legible row. Tokens on the linked scene are appended as *derived* rows — shown,
never stored, promoted only by an explicit pin — so a party crossing a map does
not take up residence in it. Buildings are not roster entries; they are child
places.

**4. Markets are not the default, and the DATA is gated, not just the UI.**
`system.market` is a nullable SchemaField: on a cave, a wagon or a chest it is
literally `null`, not an object of empty arrays (a nullable field's `clean()`
short-circuits in `_validateSpecial` before it ever casts). There is deliberately
no `hasMarket` boolean — the presence of the subtree IS the flag, so the two
cannot disagree.

*Cost of the ruling, accepted knowingly:* every market field moved from
`system.*` to `system.market.*` (~90 sites across the recruitment engine), the
engine's entry points now refuse market-less places outright, and `migrateData`
folds legacy locations in on load. A location whose market was empty and
untouched migrates to market-less — the new default, and what its GM would have
wanted.

---

### The location sub-type has one owner, and it is this feature (2026-07-19)

henchmen and location each declared a `location` Actor sub-type with its own
sheet, distinguishable only by module id. `docs/location/MODEL.md` named this
feature the owner on 2026-07-19; the only thing blocking the move was a data
migration, which the merge removed the need for.

The data model and the sheet now register in `scripts/location/module.mjs` and
nowhere else, and the sheet is the union — market tabs plus storage.

**The registration must never sit behind a capability check.** A gate there was
an `apiVersion` guard with a bare `return`, from when acks-lib was a
separately-installed dependency that could be older or absent. After the merge
lib is a sibling that attaches at import time, so the guard could only ever fire
spuriously — and firing it would skip the sheet registration below and take the
whole location sheet, market and all, down with it. The code carries the
constraint; this entry carries why it exists.

---

### `returnGoodsTo` was throwing, and the default delete policy was losing goods (2026-08-02)

The container-nesting line guarded on an `equipment` identifier left over from
when acks-equipment could be absent. After the merge it was simply undeclared, so
every call with a non-coin item threw a `ReferenceError` and the caller's
try/catch swallowed it. Deleting a place with goods in it therefore lost them
under the very setting that exists to prevent that.

Found while building the place layer on top of the same file — not by a test.
The offline suite was green throughout.

---

### The banked-coin column is retired, and the sweep is the migration (2026-08-01)

The system's `system.quantitybank` was a competing answer to "where is my
money": coin that is yours, weighs nothing, and is nowhere. Two answers drift the
first time a player uses both.

Per the owner's ruling the sweep makes a **personal vault per character** rather
than one shared bank — it never guesses that two characters' savings are pooled —
and the GM manager merges them on demand. The sweep is idempotent and
self-healing, so a stray value arriving later from an import is picked up rather
than stranded.

---

### Deleting a place returns goods by default, and that is a setting, not a rule (2026-08-01)

`acks-lib`'s `storageDeletePolicy` defaults to returning each owner's goods in a
container named after the place, so a GM tidying the actor directory does not
wipe the party's belongings. The "lose" branch is implemented, not stubbed: a
campaign where a sacked city takes your warehouse with it is the eventual intent.

---

### Imported tables become Foundry documents (2026-07-22)

User directive: imported tables materialize as world documents, prefilled with
current data; every table gets a drag-a-replacement slot and a delete/revert.
Rollable tables become `RollTable`s, everything else a JSON journal page. A
dropped replacement overrides at registry priority 30, with the world import
still underneath so revert has somewhere to fall back to.

---

### The sheet is tabs, not one long page (2026-07-22)

User direction. A place accumulates unrelated concerns — identity, contents,
roster, and sometimes a whole recruitment domain — and a single scrolling page
made the market's absence look like a defect rather than the norm.

Contents rather than Recruitment leads, because what a place holds and what it
sits inside are true of every place, while the market is the exception.

---

### A write to the table store is verified, not assumed (2026-07-19)

Seen in the wild: a world DB that loses the import write silently un-imports
every table on the next reload, with no error anywhere. The store now reads back
after writing and fails loudly instead.

---

### SUPERSEDED — the actor type lands lean, and the two location types coexist (2026-08-01)

> **Superseded by the 2026-08-02 unification above.** Kept because the reasoning
> was sound at the time and explains why the schema looked split for a day.

The 0.5.0 sub-type carried identity and storage only; acks-henchmen kept its own
`acks-henchmen.location` with the market schema (postings, candidates, market
rolls, slander), untouched. Moving that data was to be its own program: doing it
as a side effect of the storage work would have put a data migration between a
player and their belongings, and the type labels disambiguated in the meantime
("Location" vs "Location (Henchmen Market)"). Because acks-lib keys storage on a
flag rather than a type, a henchmen market actor could hold goods immediately.

The merge removed the migration that was the sole blocker, and the two types
became one.

---

### Founded as the extraction program's binding target (2026-07-19)

Rulings recorded in `acks-module-template/docs/CONTENT-EXTRACTION.md` §4: no
fallback sample tables, the location actor migrates here without compatibility
shims, and henchmen's shipped tables were purged the same day.

**No sibling edges.** Consumers read `acksLib.tables`; this feature registers
into it. Neither side names the other — FAMILY.md §2 discipline, adopted here
from day one even though the wider refactor had not landed.
