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

**~~Companions count, from two sources, deliberately unreconciled.~~**
SUPERSEDED 2026-08-15 by the ruling below. The user named the formation
module's party; Foundry's own party actor (v13+) existed too and they were not
unified, so both were asked and either answering yes was enough.

**The formation is the party; core's is deprecated (2026-08-15).** Asking both
and taking either meant a character left in a stale party actor kept reaching a
company they were no longer marching with — two rosters unioned, neither able
to revoke the other. The marching order now answers first and, when it answers
at all, alone. The party actor is consulted only for a character no formation
claims, which is what a world mid-migration or one that never built a formation
needs; it is a fallback, not a peer. This is the same deprecation the XP
dealing already applies from the other side, where core's Deal XP button is
hidden while the formation owns the division. The `acks-extras.group` actor is
neither of them — it is a troop stack, not a company of characters.

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

---

### Stored goods are always somebody's; there is no unowned pile (2026-08-11)

Reported from the field: a Judge built a treasure item in the Items sidebar and
dragged it onto a location to serve as a lootable hoard. The drop was refused,
and they concluded that items must belong to an actor and worked around it with
a generic "Treasure" character.

They read it correctly. Storage is **owner-attributed by construction**:
`storageFlagOf` stamps whose a row is, `storedItems` lists only flagged rows,
and the sheet buckets them by owner. A sidebar or compendium item has no owner
to stamp, so `_onDropItem` refuses it rather than filing it under nobody.

**Why the refusal rather than a fallback owner.** Every candidate default is
worse than the notice. Attributing to the dropping GM puts the party's hoard in
one user's name; a null owner makes a row no bucket claims, that `providersFor`
never surfaces and no Retrieve button reaches. Embedding it unflagged — which is
what a directory drop already does — is the worst of the three: the item is
genuinely on the actor and appears nowhere on its sheet.

**Ruled: unchanged, and the guide now says so.** The refusal stands, the notice
stays, and `docs/guides/location.md` states that goods are stowed from a
character's sheet and that stowing is a move where a sheet-to-sheet drag is the
system's copy.

**Not ruled: whether an unowned house pile should exist.** A GM-stocked hoard
that no character owns yet is a real gap, not a misunderstanding — the workaround
(a placeholder actor) is what the model currently offers. Left open.

## 2026-08-13 — The market subtree gains a `goods` fragment owned by markets

**Ruled:** the item-market state (`system.market.goods`) lives inside the
location's market subtree, composed into `marketSchema()` from
`scripts/markets/data/goods-schema.mjs`. The split mirrors the recruitment
precedent: location owns the schema file and this one composition line;
markets owns the fragment's semantics and every writer. Rejected: a
`flags["acks-extras"]` store on the location (typed validation, `clean()`
defaults and the migrate seam would be lost, and market state would split
across two stores that can disagree — the failure mode the market-subtree
unification retired); a second nullable subtree beside `market` (every ACKS
market trades goods — presence of `system.market` is the only gate).

## 2026-08-20 — Materialized tables get names, folders, and a way out

**Ruled:** materialized RollTables are named for readers ("Class Percentages —
Level 0"), filed under per-doc subfolders of "ACKS Imported Tables", and
identified by a `tableKey` flag rather than by name; the folder tree and the
JSON journal carry a `ruledataDocs` flag; and the `ruledata-import` contract
gains v1.3 (additive) `countMaterializedDocs()` / `removeMaterializedDocs()`
so the importer's Remove ALL Imports can sweep what materialization created.
Reported: a sidebar of raw dotted keys in one flat folder, and a cleanup macro
that missed all of it.

The dotted key stays as machine identity — in the flag and the export
description — because re-export and drag-drop round-trips must survive a GM
renaming or refiling a table. A pre-flag world migrates on its next
materialize: the raw-key NAME is the legacy match, and matching it renames,
refiles and stamps instead of duplicating. Removal deletes DOCUMENTS only; the
imported table data in the world store stays registered, so automation keeps
its values and a re-materialize rebuilds the documents without a re-import.
Journal PAGES keep raw-key names: they are the JSON audit surface, and the
page name is what drop-overrides match on.

## 2026-08-20 — Materializing tables batches its writes, and stops saying `text`

**Ruled:** `materializeAll()` collects its writes and issues one call per kind
— folders, table creates, table updates, page creates, page updates, the stale
sweep — instead of one call per document; result sets are compared before
being rebuilt; and `rollTableSpec` emits `description` rather than the
deprecated `text`.

Measured on 2026-08-20: a six-book world materialized 208 entries (71
RollTables, 137 journal pages) in 2-3 minutes, and this runs automatically
after every `importDoc()`. The cost was round trips, not work.

Embedded collections are the one thing that cannot be batched across parents
(`EmbeddedCollectionField` is `readonly`, so a results array cannot ride a
document update), so a result set still costs its own delete-and-recreate.
That is why they are compared first: re-materialize is usually the same
registry data rendered again.

Document-level updates are compared too, so an unchanged pass writes **nothing
at all**. The saving is not the round trip — that was already one batched call
— but `_stats.modifiedTime`: stamping every table on every import shows the
whole sidebar as just-touched and grows a world backup that holds no new
information. Only what actually drifted is written, which is also what makes
"materialize again and see" a safe thing to tell a GM to do.

**Rejected: delete-and-recreate every table**, which would have batched into
two calls flat. Recreating changes the uuid, and an override's `_meta`
provenance and any GM's own links point at the old one — adoption by
`tableKey` is the property the identity flag exists to provide, and throwing
it away for a faster loop trades a correctness guarantee for a benchmark.

`text` on a TableResult has been a deprecation shim since v13, scheduled for
removal in v15 (`_addDataFieldShim(data, "text", "description", {until: 15})`)
— this repo's floor is 14. It was migrating silently on every create; writing
`description` is the same document without the shim. `parseRollTable` already
read `description ?? text`, so the drop-override round trip is unaffected.

The write COUNTS are asserted offline in `tools/test-table-docs.mjs` against a
recording mock, because "how many round trips" is the behaviour that
regressed and a passing functional test never sees it.

## 2026-08-20 — Stored table text is HTML-normalized, and comparing it raw was wrong

**Found by the live gate for the batching change**, not by the offline suite:
two occupation tables deleted and recreated their entire result set on every
materialize pass, forever. Both contain a bare `&` in the book's own wording
("grain & vegetables", "armor & weapons"). `TableResult.description` is an
HTML field, a bare `&` is not valid markup, and storage normalizes it to
`&amp;` — so a comparison against the freshly rendered spec could never match.

**Ruled:** result text is decoded (`plainText`) on both sides of the
comparison, and on the way back out of `parseRollTable`. Decoding is for
reading and comparing only; what is stored is unchanged, so no existing world
is rewritten.

The read-back half was a pre-existing data bug the same root cause exposed: a
table dropped as an override wrote `grain &amp; vegetables` into the rules
data itself, where the name-matching in `parseRollTable` and every later
reader would see the entity rather than the character it stands for.

Two lessons, both about what a check can see. The rebuild was **invisible**:
the text displayed correctly the whole time, the documents were right, and
only the number of writes was wrong — which is why the offline suite now
asserts write COUNTS against a mock that reproduces the normalization, rather
than only asserting the resulting documents. And a value that survives a
round trip through storage is not the value that was sent: comparing "what I
would write" against "what is there" has to account for what storage does to
it in between.

## 2026-08-20 — Result sets compare as a multiset, because storage reorders them

**Found by the second live gate**, after the entity-decoding fix above had
landed and three tables still rebuilt themselves on every pass. The decoding
was correct and insufficient: the remaining cause is that an embedded
collection does not hand back the array it was given. A rebuilt table reads
back in some other order, a comparison that read POSITION called that a
change, rebuilt it, got another order — and never stopped. The live run
proved it was general rather than particular to those tables, by overriding a
stable table once and watching it join the churning set permanently.

**Ruled:** `resultsMatch` compares normalized rows as a multiset.

The original positional comparison was justified in the code as the
conservative reading — treat a reorder as drift, rebuild, never go stale.
That was wrong twice over. The reorder is manufactured by storage, not by
anyone editing, so it is not evidence of anything; and position carries no
meaning to any reader, because a draw resolves by range and
`RollTableSheet#_sortResults` sorts by range for display. Two orderings of
the same rows ARE the same table, so the only thing the "conservative"
reading conserved was an infinite loop.

No repair pass is needed for worlds already holding scrambled tables: the
multiset comparison simply starts answering true for them.

**The pattern worth keeping** — this is the third finding in a row of the same
shape. Materialization asks "does what I would write match what is there?",
and each bug was a way the stored form legitimately differs from the written
form without differing in MEANING: the deprecated field name, the HTML
normalization, now the collection order. A comparison against storage is only
as good as its model of what storage does, and none of these were visible in
the resulting documents — only in the number of writes.
