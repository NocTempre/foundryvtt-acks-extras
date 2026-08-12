# Locations — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what the ruling cost. How it behaves *now* is [MODEL.md](MODEL.md); what is not
built yet is [ROADMAP.md](ROADMAP.md).

Entries are dated and append-only. **A superseded entry stays, marked as
superseded** — the value of this file is that a settled question is not
re-opened, and knowing an option was tried and abandoned is worth more than a
tidy list of only the current answers.

---

### Leaving something at a place needs reach; taking it back does not (2026-08-06)

Storage offered a deposit control at every place the viewing user owned, so a
character in a dungeon was invited to stow a chest in a warehouse across the
map. Ruled (user), and the rule has two halves because places do:

- A place with a **linked scene** is somewhere on the map, so a token of the
  character must stand on that scene. Deliberately NOT the active scene: a party
  split across two maps can still bank at the inn one half is sitting in. This
  outranks ownership — a player who owns the inn but is not at it is refused.
- A place with **no linked scene** has no map to be absent from. Ownership
  answers, as does a place pinned to the character's own sheet, and a personal
  vault is always its owner's wherever they stand.

**Companions count, from two sources, deliberately unreconciled.** The user
named the formation module's party; Foundry's own party actor (v13+) exists
too and they are not unified. Both are asked and either answering yes is
enough, pending a later unification that is the owner's to make. The `group`
actor is NOT one of them — it is a troop stack, not a company of characters.

**Retrieval is not gated at all.** A player who cannot reach their own
belongings is a worse failure than one who withdraws from a distance. Where the
deposit control is withheld the tab names the rule that withheld it rather than
leaving a gap, which reads as a broken module.

*Cost:* a GM sees the same refusals a player does, because ownership is not a
bypass. That is deliberate — a tab that shows two different truths depending on
who is looking is harder to reason about than one rule.

### A vault can be asked for, not only earned (2026-08-05)

The sweep that retires the bank column makes a vault for any character with a
balance to move, and that was the only way one ever came into existence. It
reads as automatic until a vault is deleted — at which point the goods go back
to their owner (the delete policy's default), which leaves that character with
nothing banked, and a character with nothing banked is exactly the one the sweep
skips. So the vault never returned, and nothing anywhere could make another.
`Let an actor hold goods` is not that control and was never meant to be: it
excludes characters on purpose and produces a *shared* place.

`vaultFor()` is now exported from `vault-sweep.mjs` and is **the one definition
of a vault** — name, art, ownership, the `vaultOf` flag. The storage manager's
`Give a character a vault` builds on it rather than on a second copy of those
four decisions, so a vault made by hand and a vault made by the sweep are the
same object.

**Rejected: regenerating vaults automatically.** A vault deleted deliberately —
a GM consolidating everyone into one treasury, which is the manager's first job
— must stay deleted. Re-creating it at the next ready would fight that tidy-up,
and nothing distinguishes a deliberate deletion from an accidental one.

---

### A place's notes answer to ownership, not to the Judge's seat (2026-08-05)

The Contents tab gated the `system.notes` editor on `isGM` while `name` and
`system.region` — the same form, the same tab — answered to `editable`. A player
who owned a location could rename it and move it between regions but could only
read its notes. Nothing recorded why, and the read-only branch already showed
those notes to every viewer, so the gate was not keeping a secret; it was
withholding a pen from someone already holding the deed.

Notes are now gated on `editable`, like the fields beside them. A place's notes
are its shared record.

**Rejected: gating `name` and `region` to the Judge instead.** That is the
consistent alternative and it was weighed. It loses more than it protects — a
party that owns a stronghold renaming it is ordinary play — and it would have
taken away a capability owners already had, which is a worse trade than granting
one they were plainly meant to have.

**Rejected: a second, Judge-only notes field.** The right answer if notes were
ever meant to be private, but the field the party can already read is not that,
and adding one is a schema change — a minor, not a patch.

**Cost:** a Judge wanting a private record of a place has nowhere on this sheet
to put it, and must use a journal until a private field exists. That gap is
recorded in [ROADMAP.md](ROADMAP.md) rather than papered over here.

---

### Occupant and special-hire `notes` stay: they are write-only, not dead (2026-08-05)

Reported as inert schema fields to be deleted — declared, never written, never
read. The first half is false. Both are written on every add, through exported
API a consumer can already reach:

- `roster[].notes` — `occupantRow()` (acks-lib `place.mjs`) stamps it from its
  option bag on every `addOccupant`, and `mergeOccupants` deliberately preserves
  it when a stored row absorbs its derived duplicate.
- `market.specialHires[].notes` — `addSpecialHire()` stamps it, and that function
  sits on the henchmen public `api`, as does `registerFoundRecruit`, which
  spreads caller options straight through to it.

Nothing in this repo passes a non-empty value, and no sheet renders either one.
The fields are therefore WRITE-ONLY, and the defect is a missing display rather
than a dead declaration. **Kept; the display is [ROADMAP.md](ROADMAP.md).**

*Rejected: deleting them.* A field nothing ever wrote can go without ceremony; a
field an exported API writes cannot. A consumer that has called
`addOccupant(place, actor, { notes })` or `api.registerFoundRecruit(loc, actor,
{ notes })` has real text in a world DB, and removing the declaration discards it
on the next write with no warning. That is a schema migration, which a hotfix
does not carry.

The cost is that the original complaint stands until the display lands: a caller
can write a note and see nothing. It is now a named gap rather than an
unexplained one.

*Not to be confused with `market.candidates[].notes`* — a different field,
written by `recruitment.mjs` (the proficiency tag a directed search stamps) and
read both by the sheet's candidate identity line and by `directedSpecMatches`.
That one is load-bearing.

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

---

### Storage can be turned off again (2026-08-11)

`setProvider` has always taken `false`, and until now nothing called it with one.
There was no control, no macro and no route back: an actor flagged as a place
that holds goods stayed one forever.

The way in was the shipped **Enable Storage Here** macro, which took
`canvas.tokens.controlled[0]?.actor` with no type check. Selecting your own token
and running it made your CHARACTER a shared warehouse. The storage manager's own
Enable dialog had always excluded characters — deliberately, because a shared
place is a different thing from a personal vault — but the macro never learned
the same rule.

**Ruled: both halves.** The macro refuses a character and points at Create Vault;
and a **Stop holding goods** control on the manager, plus a Disable Storage Here
macro, undo the flag wherever it was set. The guard alone would have been no help
to the world that already has the flag on a character.

**Goods block it.** Clearing the flag moves nothing — the items stay embedded on
the actor, still stamped with whose they are, but the place they are stored at
stops being a place, so no sheet lists them and no owner can ask for them back.
Disabling is refused while anything is stored, and points at Return to Owners on
that same screen.

**Rejected: a migration that un-flags characters on load.** It would decide for a
Judge who deliberately made a character a caravan's quartermaster, and it would
move a player's belongings without being asked. A visible control the Judge
drives is the right shape for a mistake this rare and this easy to see.
