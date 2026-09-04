# Shared library — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

- **2026-09-02 — hiding compendiums was a BAD DIRECTION. Explored, shipped,
  withdrawn; do not propose it again without new argument.** The whole of
  `hideSupersededPacks` is removed — the `SUPERSEDED` map, the coverage floors,
  the `idPrefix` mechanism, the stylesheet hide, the setting, and
  `scripts/lib/pack-dedupe.mjs` itself. **Every compendium a world holds stays
  in its sidebar, always.** This ABANDONS the 2026-08-15 ruling below (marked
  there) rather than refining it: the thing that entry was tuning should not
  have existed.

  **Why it was a bad direction, stated so the next session does not rediscover
  it as a good one.** A module does not decide which of the SYSTEM's shelves a
  Judge may see. The sidebar is the system's surface; folding rows out of it was
  this module reaching past its own boundary, and every problem the feature then
  had followed from that overreach — the coverage floors that could not actually
  prove coverage, the type-wide probes that let one pack's imports hide another
  pack, the default-on that made it everyone's problem, and a hide keyed on a
  guess about what a Judge no longer needs. Three sessions were spent tuning a
  gate whose premise was wrong. The design ladder in CLAUDE.md — reuse → extend
  → enhance → invent — has an unstated fourth question: whether the surface is
  ours to change at all.

  **The new evidence the original ruling did not have: the feature had not
  worked since 6.0.0, and nobody noticed.** Its coverage gate counted imported
  documents out of `game.items` / `game.actors` directly, but the importer
  writes into world compendium packs, so the gate counted zero in exactly the
  worlds the feature existed for. It was default-ON and fully inert across
  6.0.0, 6.0.1, 6.0.2, 6.1.0, 6.1.1, 6.1.2 and 6.1.3 while these entries
  asserted it worked. Five releases of a duplicate-hiding feature hiding
  nothing, with no report, is the measurement the 2026-08-15 entry was missing:
  the duplicate rows it set out to fold away were not costing anyone enough to
  mention.

  **Rejected: repairing the gate to count the packs.** It is the smaller diff
  and it restores the ruling as written, but it makes an upgrading world lose
  eight sidebar rows in a patch — on floors this record already admits are not
  coverage proofs, where twenty generic imported items satisfy `acks-clothing`
  and `acks-adventuring-equipment` alike. Restoring a hide nobody has missed, on
  a gate we know to be loose, is a worse trade than dropping it.

  **Rejected: repairing the gate and defaulting the setting OFF.** It keeps the
  code working and hides nothing until a Judge asks, which sounds like the
  cautious middle. It is the worse end state: it leaves a loose coverage gate in
  the tree as a supported feature, and the first Judge to switch it on gets the
  bad behaviour with our blessing. A direction that should not have been taken
  is not made safe by putting it behind a toggle.

  Imported documents remain what this module READS — that rule is untouched and
  lives at the resolution layer (`template-packages.mjs`), which is inside our
  own boundary.

  **Cost:** a world that imported its own corpus sees both copies in the
  sidebar again, which is the duplicate noise the original entry set out to
  remove. Judged acceptable on the evidence above. The orphaned world setting
  is left where it is: an unregistered setting is inert in Foundry, and a
  migration to delete a boolean nobody reads is more risk than the row it
  occupies. **No migration ships for this.**

- **2026-09-02 — the library reads every shelf, and a caller that cannot
  re-render awaits.** Two faults with one shape: the reader answered a smaller
  question than any of its callers asked. (a) It matched the WHOLE pack label
  `ACKS Cookbook — <Type>`, while the importer shelves a lined book on its own
  pack `ACKS Cookbook — <Line> — <Type>`; a class from Dolmenwood, OSE, Quick
  Delve, Planar Compass or Wicked Little Delves was invisible to every consumer,
  and the chargen page — which bails entirely on an empty class list — showed
  nothing at all. Every other reader in the family already matched on the prefix;
  this one was the outlier, and it had been since before the importer merged.
  Matching now follows the writer's own shape, with the unlined shelf sorted
  first so a name collision between an ACKS document and a third-party one
  resolves to the ACKS one instead of to pack-registration order.
  (b) The cold-pack rule — "the read answers with what is in hand" — assumed the
  caller renders again. **This does not supersede "one reader, and it is
  synchronous" (2026-08-24); the readers stay synchronous.** What that entry got
  wrong was its stated cost: *"the re-render that follows is complete"* assumes a
  re-render, and core's Scores Generator never performs one. A first render that
  beat the warm lost its injected boxes for the LIFE of that window, not for a
  moment. Callers that cannot re-render now await `whenReady()` — which that same
  entry provisioned for exactly this — before concluding they found nothing.
  **Rejected: a loading state.** It is a new user-facing surface and new strings
  for a wait nothing has yet measured as visible. **Rejected: re-running the
  injection when the warm resolves.** It creates a second entry point into a
  function whose guards all close over the first `root`. Awaiting keeps one
  injection and needs no new guard.
  **Cost, measured before shipping rather than assumed.** Warming now loads every
  line's shelf rather than four packs. On a world holding ~2030 documents across
  ten shelves (Item ×2, Actor ×6, JournalEntry, RollTable), `whenReady()` from a
  cold reload took **1.1–3.7 s** over repeated readings — a range, not a point,
  the spread being IO variance rather than anything in the reader, and
  `warmLibrary` awaits all four types together rather than the one a caller
  wanted. Accepted because the warm does not block `ready` — `registerLibraryWarm`
  does not await it — and because the alternative is a whole class of imported
  content staying invisible. It is charged in one visible place: a generator
  opened in those first seconds waits that long instead of rendering blank, and
  grows as the boxes arrive (below).

  **Known and accepted: the generator visibly grows on the cold path.** Measured
  at 1100×400 before injection and 1100×822 after, with no scrollbar and no
  clipping at either point — `position.height` is already `auto` and `setPosition`
  runs once, early, so the frame simply follows its content. A reader opening the
  page in the first seconds of a session sees core's compact layout for the warm
  interval above and then a jump. Left alone deliberately: reserving height or
  showing a loading state is a new user-facing surface, and the state being
  replaced is a window that stayed blank permanently.

- **2026-09-01 — the system's compendium tree is the system's, and the library
  can be put back.** Supersedes the 2026-08-15 ruling below. `organizeFamilyPacks`
  gathered the system's thirteen packs into this module's own "ACKS II" folder,
  on the reasoning that one folder is tidier than two. What that actually did is
  visible in a world that had run it: the system declares five compendium trees
  of its own — a Rulebook shelf, a Revised Rulebook with Equipment and Setting
  beneath it, a Judges Journal, a Monstrous Manual, VTT Vitals — and every one
  of them stood **empty**, because a module had taken their contents. A module
  is a guest in the sidebar. **Ruled: each package's packs go where that
  package's own manifest says**, read live from `packFolders` at runtime, so
  neither this module nor the system states a folder name belonging to the
  other and a system release that re-shelves its own compendiums needs nothing
  here.

  **Ruled: two strengths, and the difference is consent.** The pass that runs at
  every load only FILLS — a pack with no folder, or one naming a folder that no
  longer exists, is filed where its manifest says; a reference that resolves is
  a Judge's arrangement and is untouched. That half of the old ruling was the
  good half and survives intact. The new *Restore the Compendium Library* macro
  OVERRULES: it re-files every ACKS pack and resets each pack's configuration —
  custom sort, lock, ownership grant — to the package's default. Overwriting a
  Judge's arrangement is what "restore" means, so it is a macro a GM runs and
  never something that happens to them.

  **Cost, and the bug it bought:** the first build planned nothing and built as
  it walked, so the gentle pass created the entire declared tree at every load
  and then declined to move anything into it — a second, empty copy of the
  library appearing on a live world's first reload. Planning is now separate
  from building and **a folder comes into existence only where a pack is
  actually being written to it**, which is also what makes a per-line import
  shelf materialize on the first pack that needs it instead of standing empty in
  every world.

  **Ruled: a dead configuration entry does not hold a folder open.** A world
  keeps the `compendiumConfiguration` entry of every pack it has ever had. Four
  entries for packs this release stopped shipping, and one for the retired
  importer module, pinned the old "ACKS II" folder open through the restore —
  an empty shelf nothing could remove, which is the exact disease the file
  exists to end. An entry counts only while its pack exists, and is dropped with
  the folder it named.

- **2026-08-30 — a missing-tables notice asks which TABLES are readable, never
  which document ids are registered.** Both features that greet a Judge with
  "these rules tables have not been imported" filtered their document list with
  `hasDoc`, which answers whether any layer holds the id. Henchmen registers a
  `rarity` document of its own at SAMPLE priority — one inferred
  alignment-openness shift, module automation rather than book data — so the id
  is occupied in every world from setup onward and the rarity tables could never
  be named as missing. A world with nothing imported at all was told the other
  five were all it lacked, which reads as "rarity arrived". **Ruled:** the
  notice reads `missingCoverage(docIds)`, which compares each document against
  the tables consumers declared through `expectTables` — the declarations that
  already drive placeholder generation — and a document nothing declared falls
  back to id presence, which is all that can be known about it. A partly
  arrived import is named with how much of it arrived, because "not imported"
  about a document holding four of its five tables is the same false statement
  in the other direction. **Gate:** `test-lib.mjs` reads both features' sources
  and fails if an id they announce has no `expectTables` declaration — the drift
  that would silently return the check to id presence. **Cost:** a feature's
  announced list and its declarations must now agree, which they were already
  documented to do. *Rejected: moving the rarity automation to a document id of
  its own.* Per-table layering exists precisely so a module's automation and an
  import can share a document, and the same trap would then wait for the next
  feature that uses it. *Rejected: naming the missing tables themselves in the
  notice.* Twenty table ids in a toast is not a message anyone reads; the count
  says how much is absent and the ruledata browser holds the detail.

- **2026-08-25 — the effects the module maintains refuse hand-deletion, and
  nothing else about them changes.** A character's combat training and its
  equipment loadout sit in core's ordinary Effects list beside notes a Judge
  made, with the same trash button; deleting either breaks the character in a
  way nothing announces, because from Foundry's side a document was deleted
  exactly as asked. `preDeleteActiveEffect` now refuses a delete of any effect
  carrying a registered marker, the sheet shows a lock where the trash was, and
  editing, emptying and disabling are untouched — a Judge who wants a character
  untrained empties the effect, which is a decision visible afterwards, rather
  than removing the row and leaving nothing to read. *Rejected: a global unlock
  the module sets around its own deletes.* The sync path awaits repeatedly and a
  global would stay open across every one of those awaits; the module authorizes
  each call instead, by passing `managedDelete()` in the operation options, so
  the permission travels with the one call that asked for it. *Rejected: hiding
  the managed effects from the list.* They are the reason a weapon is refused or
  an AC is what it is, and a character whose modifiers come from somewhere
  invisible is worse to debug than one who cannot delete a row. **Cost:** each
  feature must claim its marker at init, so a feature that is off cannot lock a
  row it no longer maintains — deliberate, and the reason the registry is not a
  hardcoded list.

- **2026-08-24 — the name-form rules live in `lib/vocab.mjs`, once.** A book
  prints one physical thing several ways — "Oil, Military (1 pint)" in the price
  catalogue, "Military Oil" everywhere else, "Waterskin/Wineskin" as one row
  naming two things — and each printing feeds a different importer. The rules
  for reading those forms existed as `nameVariants` inside
  `classes/template-packages.mjs`, whose own docstring said acks-importer
  "applies the same rules… the two must agree": an invariant asserted in prose
  between two copies. They did not agree, and a flask of military oil was two
  documents in every imported world. `nameVariants` / `nameKeys` are now lib
  exports and both modules read them. *Rejected: a comma-flip helper in the
  importer's price code.* It fixes the reported case and leaves the slash and
  parenthetical forms to be rediscovered separately — the pattern is "the same
  thing printed differently", not "commas". *Cost:* a dedup rule now depends on
  lib being present; the importer says so loudly rather than silently minting
  duplicates when it is not.

- **2026-08-24 — a package links what exists and mints nothing empty.** A
  template that grants a proficiency used to COPY it whenever the definition
  lived in a compendium, on the reasoning that a Judge cannot repair a pack
  document — which stopped being true when the library moved into an unlocked
  world pack, so every granted ability became a duplicate of one the GM had
  imported. It now links, wherever the definition lives; only a printed
  SELECTION ("Weapon Focus (spear)") still becomes its own document, because
  writing the selection onto the shared one would specialize it for everybody.
  A name nothing defines yields NULL instead of an empty placeholder: the caller
  already keeps such an entry on the row, printed, which is this file's rule for
  a cell that resolved to nothing — and a printed cell says "not imported yet"
  better than a document with a name and no mechanics, which reads as real and
  gets dragged onto a character. Measured on a full re-import: 1,353 template
  parts where the old rules produced 1,960, with zero unresolved placeholders.

- **2026-08-24 — one reader for the imported library, and it is synchronous.**
  acks-importer 3.0.0 writes every import into a world compendium, so every
  `game.items` read here for a class, race, proficiency or language was pointed
  at an empty shelf: a blank class list, `findByRef` null for every imported
  ref, chargen with no proficiencies on offer, and ability relations rendered as
  raw ids. `lib/library.mjs` answers for the sidebar and the packs together.
  **Synchronous on purpose** — its callers are sheet getters and
  `_prepareContext` bodies that cannot await — paid for by warming the packs
  once at `ready`. *Rejected: making the readers async.* It threads a promise
  through every sheet that displays an imported name, to buy nothing: the
  documents were all in memory before, as `game.items`. *Rejected: reading the
  pack INDEX instead of instantiating.* The index carries name, img and type;
  the callers need `system`. *Cost:* a first render before the warm settles sees
  the sidebar alone; `libraryDocs` kicks off the load and the re-render that
  follows is complete. Registered from the lib module's ready hook rather than
  at module scope, because the offline suite imports this file's consumers with
  no Foundry globals and a top-level `Hooks` call is a ReferenceError there.

- **2026-08-24 — a generated creature never lands in its template's folder.**
  `TemplateSheet` created the actor with `folder: this.actor.folder`, which put
  play material inside the imported reference shelf — and, once templates moved
  into a compendium, handed a sidebar actor a folder id that belongs to a pack.
  It goes to a top-level `Generated` folder, adopted by name if one exists so a
  Judge who renames or refiles it keeps their arrangement.

- **2026-07-18 — v0.1 scope is effect/ability primitives only.** Created ahead
  of the full family-refactor Phase 1 to unblock the abilities program (see the
  program memory + template REFACTOR_PLAN.md status note). The plumbing/interop
  contracts stay pending; this lib is additive to that plan, not a divergence.
- **The shared vocabulary has one definition here** (DAMAGE / MOVEMENT / VISION
  / SENSE / NATURAL_WEAPONS / ALIGNMENTS). These began as a value-identical
  mirror of the monster feature's own enums while it was a separate published
  module; that mirror is **resolved** — `monsters/config.mjs` now re-exports
  from `lib/vocab.mjs`, so its consumers keep one import path and no second copy
  exists. `NATURAL_WEAPONS` here is the superset, carrying the monster sheet's
  sting / feeler / envelopment.
- **Foundry-free split:** `vocab.mjs` (enums + resolver) imports in Node so the
  acks-importer cookbook compiler/executor share one definition; `fields.mjs`
  (Foundry field-builders) is lazy so the module still evaluates under Node.

- **Storage lands in the library, keyed on a flag rather than a type**
  (2026-08-01): "goods kept somewhere other than on you" is the primitive under
  markets, banks, base camps and wagons, and the standing promotion rule names
  stash handling as shared machinery. Two consequences were chosen deliberately.
  (1) **Stored goods are real embedded items on the holding actor**, not a
  ledger: an item that has left the character genuinely weighs nothing on them,
  and every existing reader of `actor.items` sees a location's stock without
  being taught anything. (2) **A provider is any actor with
  `flags.acks-extras.storage.provider`** — the library never names a location
  type, so a settlement, a market actor and a future cart are the same
  machinery, and enabling storage on one is a flag write. The UI, the actor type
  and the lifecycle around it belong to the location feature; only the
  primitives are here. Attribution (`ownerUuid`) is a UI convention, not a
  security boundary — the same ruling the equipment feature makes for containers.
- **The template actor is a generator, never a bulk import** (2026-07-24):
  the book statting a creature as tables (dragon: 11 ages x 9 types x 4 body
  forms) is the book saying "make one when you need one". Materializing the
  cross product would be hundreds of near-duplicate actors; the template +
  builder honors the book procedure instead, and a dropped base actor makes
  the same document a modifier (vampire thrall).
- **One token publisher** (2026-08-01): the vendored design-system token file
  (`vendor/acks-design/tokens.css`, `:root` + one `.theme-dark` block) is the
  ONLY place `--acks-*` palette values are declared, and it loads
  unconditionally — inert values style nothing by themselves, and every
  feature ships in the same module, so consumers read tokens BARE
  (`var(--acks-spot)`, no literal fallback; a fallback masks a missing token,
  which is exactly how `--acks-field` shipped undeclared and rendered white
  boxes on dark seats). Before this, sheet-theme.css pinned ~18 token copies at
  body-class specificity, out-specifying the token file's dark block; the
  vendor layer and the follower card each grew counter-shims, and one card
  rendered FOUR ways across sheet-theme x seat combinations (worst pair
  1.1:1). sheet-theme.css now owns only override RULES for system-rendered
  markup, gated by `body.acks-lib-sheet-theme`; the setting stays the
  whole-client escape hatch. Corollaries: SURFACE vs INK discipline everywhere
  (`background:` takes `--acks-burgundy`, `color:`/`border:` take
  `--acks-spot` — they diverge on dark seats); type sizes come off the
  `--acks-fs-*` scale so the `fontScale` client setting (writes
  `--acks-fs-base` inline on the root element, where the scale steps
  substitute) resizes every ACKS surface with one knob.
- **2026-08-03 — Perception rises to lib; `monochromatic`, not `darkvision`.**
  The sense model, the RR light table and the token writes moved out of the
  formation feature (`monster-traits.mjs`, `formation/constants.mjs`,
  `formation-model.canSeeInDark`) because a second sibling needed them: a
  standalone actor has no formation, and its torch and its infravision have to
  work anyway. `capabilities.mjs` came along for the ride — `senses.mjs` needs
  the `kw:lightlessvision` check and lib may not import a feature — with
  `ability-bridge.mjs` re-exporting so no consumer changed.
  - **Ruled:** dark senses render `monochromatic`. Core's `darkvision` remaps
    DIM to BRIGHT, which would let a creature read a scroll in a black
    corridor; both ACKS senses see only "as dim light", and dim light cannot
    discern colours or read (RULES §4). Rejected `darkvision` for that reason
    and `blindness` for inherently blind creatures — that mode models the
    *blinded condition* and renders black, which would cripple a creature that
    navigates perfectly well by echolocation. A blind creature gets its best
    sense range instead, or 30' when its stat block records none.
  - **Cost:** the first sync overwrites a token the GM configured by hand
    before installing this, because a never-stamped token is indistinguishable
    from a stock one. Accepted: the alternative is leaving every monster pack's
    stock 60' dark sight in place, which is the defect. `managedVision` makes
    it a one-time cost — edit the token once and it is yours forever — and
    `manageVision` turns the whole pass off.
  - **Not done:** `detectionModes` are never written. Core derives
    `basicSight` and `lightPerception` from `sight`
    (`client/documents/token.mjs:541`), so writing them would add a field to
    clobber and buy nothing. Terrestrial mechanoreception could plausibly map
    to core's `feelTremor` instead of a sight radius; kept uniform with the
    other dark senses for now, one rule and one answer.
    — **SUPERSEDED 2026-08-03 (below).** "Buys nothing" was wrong: a radius
    without a detection mode makes every sense behave like eyes.

- **2026-08-03 — Every sense gets its own detection mode; `basicSight` off.**
  The entry above modelled all five ACKS senses as a sight radius. That
  silently gave each of them sight's weaknesses and none of its own: a bat's
  echolocation was defeated by invisibility and by a *darkness* spell, tremor
  could not reach through a floor, and Hiding could not beat infravision — all
  four wrong at the table, and none visible in a screenshot.
  - **Ruled:** `DetectionMode.type` carries the rule. Core's `_canDetect`
    defeats only SIGHT with the Blind status and an invisible target, and only
    wall-respecting modes with magical darkness — so SOUND for echolocation and
    shadowy senses, MOVE for mechanoreception, SIGHT for lightless vision.
    Echolocation overrides the darkness bail (core keys it to `walls`, not to
    type: sound does not care how dark it is). Terrestrial mechanoreception
    reuses core's `feelTremor` rather than inventing a twin.
  - **`basicSight` is disabled wherever a real sense replaces it.** This is the
    load-bearing part and was missed until the live check: core derives that
    mode from `sight.range`, and left on it shadows every specific mode, so the
    hiding thief is seen and the invisible one found regardless. Safe because
    the vision source radius reads `sight.range` itself (`Token#sightRange`),
    so environment vision is untouched.
  - **Source conditions resolve in `senses.mjs`, target conditions in
    `_canDetect`.** Suppressing a sense by rewriting the token costs nothing per
    visibility test and keeps `canSeeInDark` agreeing with the canvas. Only what
    depends on the target, or on where the perceiver stands, can't be
    precomputed.
  - **Cost:** two status effects this module now registers (Hiding, Running),
    because core ships neither. Both are toggles — inferring "is running" from
    token movement would fight the GM every time they repositioned someone.
  - **Rejected:** reusing core's `invisible` for hiding (different rule,
    different detection semantics), and inferring Hiding from `token.hidden`
    (that is the GM's "not on the map yet" switch, not a character's action).

### The item taxonomy is declared over core's types, not invented beside them (2026-08-03)

The system's eight Item sub-types share no base, so "wearable" had no home:
`equipped` is declared on `weapon` and `armor` and nowhere else, and Foundry
prunes off-schema keys, so the whole `acks-clothing` pack and every carrying
device in `acks-adventuring-equipment` were unwearable however they were written.
Three RAW rules were silently inert as a result — the adventurer's harness's
stone of relief (RR p. 142), gloves blocking lockpicking (RR p. 145), and the
worn bucket for clothing on the character sheet.

**Ruled: declare the taxonomy over core's types.** A `GearExtras` flag model
(`flags["acks-extras"].gear`) plus one predicate module, mirroring the ruling the
abilities feature made for `AbilityExtras`.

**Rejected: module-owned `gear`/`wearable` Item sub-types.** They would have a
genuine shared base, at these costs — core's `_prepareItems` is a five-bucket
`switch` with no default, so a module sub-type renders **nowhere** on the
character sheet (and the equipment feature's whole technique is moving core's own
rows into wear buckets); `computeEncumbrance` sums `item`/`weapon`/`armor` by
name, so it would weigh nothing; core's inventory template draws the equip toggle
in the weapons and armours sections only; and every existing world, both core
gear packs, the importer and acks-importer produce core types, so adopting them
means a destructive per-document `type` rewrite. That is the "invent" tier for
something the system provides badly rather than not at all.

**Equippable is derived, not tagged.** `slots.length > 0` *is* the tag. A boolean
sitting beside a slot list can disagree with it; one field cannot disagree with
itself. Rations, loot and coin declare no slots and get the wear features
switched off without a flag saying so.

**`declaresSlots` is a third state, and it was needed.** "Declared to sit
nowhere" and "never annotated" both leave `slotsOf` empty, but they must behave
differently: every name-heuristic fallback gates on `declaresSlots`, so a Judge
who sets a Great Helm to sit nowhere is not overruled by its name.

**Cost:** the slot for 143 core pack items is inferred, not read — the books
assign no slots. Accepted deliberately (owner: "a bad guess with a dropdown to
select/correct is fine") because the Treasure Tome makes a slot's only mechanical
job exclusivity, so a wrong guess mis-scopes that and nothing else. The item
sheet's Construction tab carries the correction.

**Deferred, against the original plan:** container `capacity` and the clothing
`layer` were to move into `GearExtras`. They did not. `capacity` belongs with
`locked`/`fragile` in the container record — splitting one coherent record across
two flags would create the duplication rather than remove it — and `layer` has a
single reader and no second copy to collapse. Neither move would have removed a
duplicate; both would have cost a data migration.

### Capacity belongs to gear, not to containers (2026-08-03)

Capacity was deferred out of `GearExtras` a day earlier on the grounds that it
belonged with `locked`/`fragile` in the container record. **That was wrong, and
the reason it was wrong is instructive:** it treated "container" as a kind of
thing rather than as a thing that happens to hold something. Under that model a
coat could carry magical qualities and hidden pockets in its description, and
carry nothing in the fixture — because the module had not annotated it as a
carrying device, and only carrying devices could have a capacity.

Capacity now lives on the gear model and `holdsGear` derives container identity
from it. The container record keeps only the lock's state, which is genuinely
about being a container. Read order is new home then legacy, so 1.2.0 worlds
need no migration.

Owner, same day: **encumbrance is a special case of capacity** — mounts, wagons,
crates and the hands of a team lifting a body all ask the same question, so a
container function is the wrong home going forward. That refactor is a major
release and is scoped in [../ROADMAP.md](../ROADMAP.md); this entry records only
the move off the container record.

### The world clock has one owner, and it is lib (2026-08-04)

`advanceWorldTime` was registered twice under the one module id — by
`formation/module.mjs` and by `henchmen/settings.mjs`, with different names and
different hints. Foundry keeps one entry per (namespace, key), so it was already
a single shared toggle: whichever registration ran last supplied the label, and
one feature's switch was described to the GM in the other feature's words. The
types and defaults happened to agree, so nothing misbehaved — but a change to
either default would have silently applied to both.

**Ruled: one key, owned by lib** (`scripts/world-time.mjs` holds the constant
and the `mayAdvanceWorldTime()` predicate; `lib/module.mjs` registers it). Both
clock writers now read the same predicate instead of the same string. lib owns
it because it already owns the module-wide policies — `manageVision`,
`storageDeletePolicy` — and because there are only two `game.time.advance` calls
in the module and both are gated by this one key.

**Rejected: two distinct keys** (`formation.advanceWorldTime`,
`henchmen.advanceWorldTime`). The step sizes differ — ten minutes a dungeon
turn against seven days a button press — but the question does not: both write
Foundry's one world clock through the same contract, and the reason to say no is
the same reason in both cases, that some other module (Simple Timekeeping, a
calendar) is the clock authority. Splitting the key would have made a GM answer
that twice and let the two answers disagree.

**Cost:** the setting moves out of the Formations group in Configure Settings
and into Library, so a GM who knew where it was has to look somewhere else. The
key string and namespace are unchanged, so existing worlds keep their stored
value and no migration is needed. Three lang strings were retired
(`ACKS-FORMATION.settings.advanceWorldTime.*` and
`ACKS-HENCHMEN.setting.advanceWorldTime*`) for one reconciled pair under
`ACKS-LIB`; a translation carrying the old keys loses them.

### The Follower Card selects fields by schema, never by actor type (2026-08-05)

The card branched on `isMonster` — a strict `type === "monster"` test — at nine
places: class, level/HD, XP, ability grid, speed, encumbrance, attack bonus, the
natural-attack fallback and adventuring throws. Every branch was a two-way choice
between "character" and "everything else", and "everything else" was written
against the monster's field paths.

The module's own `acks-extras.animal` is neither. It took the CHARACTER branch
throughout and was read at paths it does not have: `details.level` (absent),
`details.xp.value` (its XP is a flat number), `movementacks.*`, `scores.*`,
`encumbrance.value6`. An animal hireling in an employer's hirelings grid showed
level 1, 0 XP, speed 0, a blank ability grid and an encumbrance bar for a body
that carries no inventory — all of it plausible-looking and all of it wrong.

**Ruled: no branch in the card may test `actor.type`.** Each displayed value is
selected by whether the actor's data model DECLARES the field it needs
(`actorProvides`, which asks the model's schema and falls back to the value for
fields that only a derived pass creates). A rating the model does not carry is
left out of the card instead of read off another type's path. The editable card
binds its inputs to a `*Path` computed the same way, so an edit can never write a
character-shaped object over a creature's flat number. The `animal` needed no
code of its own: it renders correctly because it declares the monster's paths,
which is the whole point of that schema.

The type test is a closed set. It cannot be right about a type added after it was
written, and it fails *silently* — the card renders, the numbers are simply
someone else's. 1.4.1 had already fixed the notes field this way and the rest of
the card was left on the type test; that is the shape of the cost of fixing one
branch at a time.

**Rejected: a per-type view-model table** (`character` → these fields, `monster`
→ those). It is the same closed set with more ceremony, and every new type still
has to be added by hand before its card is right.

**Rejected: showing an animal's carrying capacity in the encumbrance slot.** The
animal model does declare `animal.capacity6` / `animal.unencumbered6`, so the row
has something true to say — but the card computes no load against them, and a
capacity bar with no load is a new feature, not a repair. The row is absent.

**Rejected: folding `thac0.mod.*` into the displayed attack bonus for an actor
with no ability scores.** The attack bonus is now "the ability mod, where the
model declares scores", which leaves the Actor-Tweaks attack adjustment out for a
monster or an animal exactly as before. Including it is arguably the correct
reading of the model, but it changes what an already-tweaked monster's card shows
— a visible change to a type this fix is not repairing, in a hotfix.

**Cost, deliberate:** the class slot on a model with no class now shows the
actor's own localized TYPE name rather than a hard-coded "Monster", so
`ACKS-LIB.followerCard.monster` no longer has a reader (`TYPES.Actor.monster` is
the identical string, so the monster card is unchanged). `ctx.isMonster` and
`ctx.levelReadonly` are gone from the view model and the card root no longer
carries `is-monster`; nothing read any of the three.

**Left standing, outside the card:** an actor's *route* to the card is still
type-gated in files this fix does not own — `lib/module.mjs` registers the
Follower Card sheet and its retainer default for `["character", "monster"]`, and
`henchmen/apps/hirelings-grid.mjs` filters the monster-henchman bucket to
`type === "monster"`. An animal reached through core's `henchmenList` now renders
correctly; one recruited into the module's own monster list is still dropped
before the card is asked for.

### One palette, both seats — sheet theming retires into the tokens (2026-08-05)

The module drew its own colours. Seven feature stylesheets carried 32 distinct
hex literals — golds, purples, blues, four separate reds — plus 88 reads of
Foundry's legacy `--color-*` variables. Those variables are the load-bearing
part: Foundry v14 defines every one of them ONCE, globally, with no theme
scoping (they are v10-era light-theme constants kept for back-compat and absent
from all 185 of its `.theme-dark` blocks). So the module's borders and secondary
text were pinned to the light theme in seven files, and a dark seat rendered
light-theme ink on dark ground. The literal fallbacks in those reads were a red
herring — the variables resolve; they resolve to the wrong value.

**Ruled: every colour comes from an `--acks-*` token, read bare.** The design
system already published both palettes; nothing needed inventing. Two
consequences were chosen deliberately.

**Category is not encoded by hue.** Blues and purples marked magical vs mundane
light sources, and "the GM set this, not the rules". The palette is one burgundy
spot plus a warm black — "resist adding hues" is the design system's own
instruction, and a categorical ramp would have been the first exception. The
distinctions are now carried structurally: the glyph (`fa-moon` / `fa-lightbulb`
already differed), the glyph's weight where both states shared one, and rule
weight. Gold was the exception that proved it — `--acks-gold` already existed as
a real token, so those uses were migrations, not inventions.

**No rule branches on the seat's colour scheme.** `lib-sheet-theme.css` used to
carry nine `:not(.theme-dark)` / `.theme-dark` pairs. Every token it spends
already holds both values, so the branches were removed rather than repaired —
one declaration serves both seats. This also closed a defect the branches
created: Foundry v14 lets `colorScheme.applications` differ from
`colorScheme.interface` and stamps `.themed.theme-dark` on the APPLICATION root
while `<body>` stays light. The token file follows that class; a body-scoped gate
does not, so the pair rendered hybrid — dark tokens under light-seat rules.

**Rejected: a second token publisher for forced light.** The `theme` client
setting pins `data-acks-theme` on `<html>`. Forcing dark needs nothing new. But
forcing light has to defeat a `.theme-dark` that Foundry may have put *below* the
pin, and an ancestor cannot undo a descendant's declaration — the obvious fix is
to re-publish the light palette in a second block. That would put every colour in
the file in two places, which is how a theme drifts out of sync. Instead the dark
block WITHHOLDS itself: two `:not()` guards exclude the pinned element and its
whole subtree, and the `:root` values simply inherit. Excluding is cheaper than
restating. Verified in Chromium across eight host/override combinations.

**Known limitation, accepted:** the inverse split — `interface: dark` with
`applications: light` — leaves ACKS tokens dark inside an application Foundry
stamped light. The dark block is published at `<body>` and nothing below
re-publishes light, which is the one case the withholding technique cannot reach.
It is not visibly broken (`.acks-ui` remaps Foundry's own variables inside an
ACKS root, so those windows read as uniformly dark rather than mixed), and the
`theme` setting's "Always light" is a direct remedy. The real fix is to give the
light palette the same multi-selector treatment the dark block gets, which means
restructuring the vendored token file — out of scope for the release that found
it.

### The sheet theme stops being a setting (2026-08-05) — SUPERSEDED IN PART 2026-08-07

**Superseded by "The look becomes a setting; the palette is handed back rather
than withheld" below.** The ruling "extras overrides core, and there is no
off-state" is reversed. The *reasoning* recorded here does not survive
re-examination either, and the reason it does not is worth keeping: the
"fixed light parchment" premise was measured against `.acks.sheet.actor
.window-content` (`acks.css:63`), a selector that is **inert** — the system's v2
actor sheet root carries `acks actor-v2 character-v2 sheet` and no bare `.actor`,
which is the same class-list mistake recorded two entries down. What the v2
sheets actually take is Foundry's own `.application { background: var(--background) }`,
which *is* theme-aware. The half that does survive: the system publishes no dark
palette of its own (0 `.theme-dark`, 0 `prefers-color-scheme`), which still
governs its own hardcoded light-on-light pairs.

The rest of the entry stands as the record of what was ruled at the time.



`sheetTheme` toggled `body.acks-lib-sheet-theme`, the layer that restyles markup
the **system** renders. It shipped default-on with an opt-out, on the reasoning
that a table might want the system's sheets left alone.

**Ruled (owner): extras overrides core, and there is no off-state.** The opt-out
did not do what its name suggested. Turning it off did not return a neutral
Foundry — it left this module's own windows in the ACKS look and the system's in
Foundry's default one, which is precisely the split this release exists to close.

It could not be made safe in the off position either. The `acks` system publishes
no dark palette: its stylesheet has zero `.theme-dark` rules and its sheet ground
is a fixed light parchment image, so a core sheet is a LIGHT surface whatever the
seat. Six features inject their own DOM into those sheets through
`renderActorSheetV2` / `renderItemSheetV2`, and once the token sweep put those
regions on theme-aware colours they resolved dark against that fixed cream —
about 1.55:1. Before the sweep they spent light-theme constants and stayed
readable, so the off position was a regression this work introduced and could
only have been fixed by re-pinning light constants, which is the defect the sweep
removed.

**Consequences.** The class stays and lands unconditionally at `ready` — it is
still what lets these rules clear core's own `.acks.sheet.actor` pairings at
(0,4,0). A `renderApplicationV2` hook adds `acks-ui` to every root carrying
`acks` or `acks2`, which carries the design system's remap of Foundry's own
custom properties onto the system's sheets and dialogs; that remap, not the
decoration, is the load-bearing half. Core fires render hooks for each class in
an application's inheritance chain, so the base hook name reaches every
ApplicationV2 rather than needing one registration per sheet class.

**Cost:** a table that preferred the system's stock look no longer has a switch
for it, and the setting count is unchanged only because `theme` replaced it.
Accepted: the thing being asked for was a colour scheme, and that is what `theme`
now is.

**Rejected: gating the module's injected colour on the setting instead.** It
would have made the off position legible by letting those regions inherit core's
colours, but it preserves the two-ways-rendered split as a supported state, which
is the thing being removed.

### The palette crosses to core's sheets; the chrome is a setting (2026-08-05)

Carrying the ACKS look onto the system's own windows began as one class:
`renderApplicationV2` added `acks-ui` to every root carrying `acks` or `acks2`.
It looked right and it clipped. Measured live on the character sheet, the
attributes tab rendered 871px of content in a 782px box.

The cause was not typography, which was the obvious suspect and the wrong one:
the computed font size is 14px with the frame on or off. It was
`vendor/acks-design/foundry.css` giving every input, select and textarea
`4px 6px` of padding. Core's attribute grid is sized around core's own field
metrics, and a dozen widened fields is 89px.

**First answer, and it was the wrong shape: withhold the chrome.** The design
system grew `.acks-palette` — the variable remap with no geometry — and core's
sheets took that instead. It measured clean, and it gave up the burgundy caps
labels and the boxed tabs to buy back 89px. Owner, immediately: *how was
"revert everything" easier than adding some pixels to the width of one window's
default?* Correct. The window is what should give.

**Ruled: the sheet gets a `min-width`, and the split becomes a setting.**
`lib-sheet-theme.css` widens `.acks.sheet.actor-v2.acks-ui` to 900px — a
minimum, not a width, so a player who drags it wider keeps that. `.acks-palette`
survives as the other value of the new `sheetStyle` client setting, for a table
that wants the colours without the furniture. Both classes carry the identical
light/dark remap, so the setting is how much ACKS, never whether dark mode
works. Verified live across all four `sheetStyle` x `theme` combinations: zero
overflow and the correct ink in every one.

**A selector written against the wrong class is silently inert.** The first
min-width targeted `.acks.sheet.actor`, and the system's v2 actor sheet carries
`actor-v2` with no bare `.actor` — so the rule matched nothing and the overflow
persisted unchanged. It read as "min-width does not override Foundry's inline
width", which is false and would have been the wrong lesson. Read the class list
off the live element before scoping to it.

**The general rule this establishes:** a design system may hand another owner's
layout its colours freely. If it also wants to hand over its geometry, it has to
give that layout the room, not take away the geometry.

---

### Goods the system leaves un-draggable are marked — and only those (2026-08-05)

`ActorSheetV2` binds its drag sources with `dragSelector: ".draggable"`, and
core's inventory template marks every row with that class except money. Coin
therefore could not be dragged into a container or onto a place at all, and the
failure was invisible in the worst way: no handler of ours ever ran, so there was
nothing in the console to find. Every drop target in the family was waiting on a
drag that could not begin.

`patches/goods-drag.mjs` adds the class after render and then **re-binds the
sheet's own DragDrop**. The re-bind is the fix, not a tidy-up — `DragDrop.bind`
assigns `ondragstart` element by element, so a class added after that pass is
inert until another one runs. Binding twice is safe precisely because those
handlers are assigned rather than added.

**Only rows whose `data-item-id` resolves to `isGoods` are marked.** Core also
leaves the favourites panel and the languages list un-draggable, and making every
row on the sheet a drag source is a wider behaviour change than this defect
warrants. Gating on the predicate rather than on `type === "money"` means
whatever the system forgets next is covered without another patch.


---

- **2026-08-05 — Sub-type data models register at `init`, never at `setup`.**
  This module declares three actor sub-types (`animal`, `group`, `template`) and
  gave them their models in the `setup` hook. `Game#setupGame` calls
  `initializeDocuments()` — which constructs every world Document — *before* it
  fires `setup`, and a Document whose sub-type has no registered model keeps a
  plain Object as its `system` for the rest of the session. Nothing
  re-initializes it. So every animal and every monster template already in a
  world came up with no schema behind it, while one created later in that same
  session was correct: an animal sheet threw
  `Cannot read properties of undefined (reading 'fields')` from the system's own
  `_prepareContext`, and templates rendered on empty fields. Sub-types owned by
  other features (`party`, `location`, the `encounterZone` region behaviour)
  registered at `init` and were never affected — the outlier was the bug.

  **Supersedes the earlier ruling that `setup` was required.** That entry held
  that Foundry finalized `CONFIG.Actor.dataModels` from the manifests'
  `documentTypes` after a `library: true` module's `init`, overwriting an
  assignment made there. No such finalization exists in v14 — nothing between
  `init` and `ready` rewrites that object (verified live: the models were
  present at `ready` under both timings, and only the construction order
  differed), and Foundry's own module sub-type documentation prescribes `init`.
  The merge dropped `library: true` in any case.

  **No data was ever at risk.** A model-less `system` is the stored source
  passed through untouched, so an affected actor was intact on disk the whole
  time — `actor.reset()` alone restored one, which is what proved the diagnosis.

---

### The attack roll delegates its audience to core, and offers four modes (2026-08-05)

`core.rollMode` and `CONFIG.Dice.rollModes` are deprecated in v14 and removed in
v16, and the remodeled attack roll used both. The trap is that the replacement
changed the values, not just the accessor: `core.messageMode` yields
`public/gm/blind/self`, while `core.rollMode` yields `publicroll/gmroll/
blindroll/selfroll` — v14 keeps the old name working by mapping the new value
back (`client/game.mjs`, `rollModeField.initialize`). So the roll was correct
throughout; only the console suffered.

That back-mapping is what makes the obvious fix dangerous. This roll compared
the value against the legacy spellings to build `whisper` and `blind`. Changing
the settings read alone leaves those comparisons matching nothing, and a blind
or private attack is then created with no whisper list — **broadcast to every
player, with no error anywhere.** The offline suite passes, and a smoke test in
Public mode passes.

The rule: **this roll states a mode and lets `ChatMessage.applyMode` decide the
audience.** It holds no list of mode names to compare against, so there is no
second copy to fall out of step with core's, and a mode added later is handled
without an edit here. It also returns `whisper` as user ids, which is what the
Dice So Nice call downstream wants — `getWhisperRecipients` returns User
documents, and that mismatch was live in the previous shape.

Rejected: renaming the three comparisons to the new spellings. It restores
correctness but keeps the duplicated vocabulary that caused the hazard, and the
next vocabulary change breaks it the same silent way.

**The dialog offers four modes, not five.** `CONFIG.ChatMessage.modes` also
carries `ic`, which styles a message as in-character rather than deciding who
may read it — a different question from "who sees this roll". Adding it would
also be a new user-facing surface. Do not enumerate the config directly here.

### The look becomes a setting; the palette is handed back rather than withheld (2026-08-07)

Players reported the palette and lettering as an irritant and asked for a way
out. The 2026-08-05 ruling above had removed exactly that, on the grounds that an
off-state could not be made legible.

**Ruled (owner): there is an off-state, and it is a `look` setting — `book` or
`core` — that covers every ACKS surface including this module's own windows.**
Not a third value on `sheetStyle`: that setting answers "how much of the ACKS
palette do the SYSTEM's sheets take", and the thing being asked for was "not this
palette, anywhere", which is a different question and a different axis.

**The mechanism is a hand-back, not a withholding, and that is the whole reason
it works this time.** The 2026-08-05 token sweep left one publisher and made every
consumer read `--acks-*` bare. So `core` does not strip a class from a hundred
selectors or ship a second stylesheet — it re-points the tokens themselves at the
equivalent Foundry variables (`foundry.css` § 8), and every surface in the module
follows for free. This is what the owner meant by the cleanup making it a light
change, and it is correct: the runtime is one setting, one attribute, and a
three-way in the code that already existed.

**Why this cannot reproduce the ~1.55:1 the old opt-out hit.** That failure needed
two authorities: the host choosing a region's ground and the ACKS dark block
choosing its ink, disagreeing. Three things now make disagreement unrepresentable:
surfaces in the adapter are `transparent`, so a region inherits the window's own
ground rather than naming one; washes that must read as recessed are `color-mix`ed
*from* the host's own text colour, so they invert with it by construction; and the
`theme` pin stands down under `core`, which removes the only remaining way to
force the ACKS branch against the host's. The pin was in fact the real decoupler
all along — `tokens.css` keys on Foundry's own `.theme-dark`, so with `theme:
follow` the two authorities are the same class and *cannot* diverge.

**Rejected: authoring an ACKS-flavoured "system" palette.** Considered, because it
would keep every surface deliberately designed. It means writing a second real
palette — including a dark counterpart the `acks` system does not ship — and
auditing it, which is a design project rather than an opt-out, and it would have
put literal colours in a second file: the exact second-publisher shape
"One token publisher" forbids. The adapter earns its keep by containing **no
literal colour and no literal face at all**; every value is a `var()` read of a
host token, so there is nothing in it that can drift.

**Rejected: `data-acks-look` on `<body>`, and a selector keyed on `.themed`
alone.** Both are substitution bugs. Custom properties inherit as
already-substituted values, so the adapter has to re-run substitution wherever the
host re-declares its own theme variables. Foundry v14 does that on `<body>` and
again on each `.themed` application root — but `Game##configureColorScheme` adds
the bare `theme-<scheme>` class to `<body>` and `themed` only to the interface
elements it walks afterwards (`client/game.mjs:1855` vs `:1874`). A selector
trusting `.themed` would miss the ordinary case and bake the light ramp in at
`<html>`. The block names `body` explicitly for that reason.

**The dark block's guards are widened, not duplicated.** `core` needs the ACKS
dark palette withheld wherever the adapter applies, and `tokens.css` already had
the withholding technique built for the forced-light pin. Two more `:not()`
components on the existing key; no new declaration, no light counterpart block.
Same trade the file documents: excluding is cheaper than restating.

**Ownership is read off the declaration, not the DOM.** Under `book` +
`palette`, the hook was stripping `acks-ui` from the five module sheets that
extend a core sheet and inherit `acks`/`acks2` into their class list — so this
module's own ability sheet, roll editor, equipment item sheet, Full Monster Sheet
and Follower Card lost their chrome on a palette seat. The class list cannot
distinguish them (and the hook writes to it, so reading it back is circular);
`app.options.classes` can, because it is computed once at construction. Fixing
this was not optional here: `core` has to decide the same question, and having two
different ownership tests would guarantee they drift.

**Cost.** `theme` and `sheetStyle` become inert under `core`, which is three
settings where two would do if the looks were merged into one list. Kept separate
because collapsing them would cost "Follow Foundry" — the default, and the answer
most players want — and because the two questions really are independent under
`book`. The hints now say when a setting is ignored, which is the honest version
of that cost rather than a fix for it.

**Not fixed here, found while reading:** `styles/abilities.css:270` sets
`border: 1px solid var(--acks-rule)`, and `--acks-rule` is `2px`, not a colour —
`1px solid 2px` is invalid, so the declaration is dropped entirely and the
throw-tag has no border at all. Intended token is `--acks-rule-color`. Left alone
because fixing it moves every seat, `book` included, and it is unrelated to the
look. Same for the legacy `--color-*` reads in `styles/classes.css`, which are
masked under `book` and would surface under `core`.

---

- **2026-08-11 — Night Vision doubles a light it did not light.** The sense was
  implemented as the dim→bright promotion alone (`sight.range: 0`), which is half
  of MM §5: *moonlight → daylight; indoors 2× light range; not total dark*. The
  indoor clause was never built, so a night-eyed creature saw exactly as far as
  the torches reached and no further — and there was no way to give a monster
  working indoor sight short of writing a `lightlessRange` it does not have, or
  hand-editing its token.

  **Ruled: the range is read off the SQUARE, not the sheet.**
  `brightestLightReaching` finds the largest bright radius covering the token —
  ambient lights and light-emitting tokens alike, the creature's own lamp
  included — and `senseProfile` doubles it. This is the only sense that takes an
  argument, and it is the only one whose reach is not a property of the creature.

  Three things fall out of that shape rather than needing rules of their own.
  "Not total dark" holds because an unlit square has nothing to double. Foundry's
  `sight.range` means *sees in darkness*, which would otherwise contradict that
  clause outright; keyed to a live light it cannot. And `seesInDark` stays false,
  because the formation asks that flag whether a creature can march with no light
  at all, which this one cannot.

  **Rejected: 2× the light the creature BEARS.** Exact where it applies and much
  cheaper — the bearer's lights are already in hand, with no scene sweep and no
  new invalidation. Rejected because it almost never applies: monsters do not
  carry torches, and the case the rule exists for is the creature watching a lit
  party from the dark.

  **Cost: an invalidation surface the sheet hooks cannot cover.** A torch being
  struck, doused or simply carried across the room changes the answer without
  touching any sheet, so light and token movement now re-run the pass. Held down
  by debouncing it and narrowing it to the creatures that have the sense; a
  scene with none pays nothing. Distance is straight-line and ignores walls
  ([ROADMAP.md](ROADMAP.md)) — occlusion needs the live canvas, and this answers
  for scenes nobody is looking at.

- **2026-08-11 — the world sweep is a macro, and reclaiming is opt-in.** Every
  vision pass was local: the scene on screen, the actor just edited. Turning
  `manageVision` on mid-campaign left every unopened scene as it was, with no way
  to ask for all of them. `migrateWorldVision` is that ask, surfaced as the
  **Migrate Token Vision** macro, and it reports counts rather than finishing
  silently — a sweep that says nothing is indistinguishable from one that did
  nothing.

  Taking back tokens stamped `released` is a **separate question the macro puts
  to the Judge**, defaulting to no. The release marker is the override working as
  designed; undoing every one of them as a side effect of the word "migrate"
  would be the destructive reading, and the edits it discarded are not
  recoverable.

- **2026-08-11 — the `core` adapter re-points the STATE tokens too.** Reported as
  unreadable warnings on the exploration party sheet. Two faults, found in that
  order, and only the second was the reported one.

  **The local fault.** `.warnings` set `background: var(--acks-warning-tint)` and
  no `color`, so its prose inherited the *window's* ink — a colour the token file
  knows nothing about. A ground and the type on it must come from the same block
  or they are free to disagree. Ruled: take the design system's
  `.acks-callout--warning` **whole** rather than restate a piece of it; every
  other warning surface in the family already does, and the component carries the
  keyline and padding the bespoke version had also skipped.

  **The real fault.** That alone did not reproduce the report, which measured
  **1.06:1** — a cream panel under near-white type. `foundry.css` §8 withholds the
  ACKS dark palette under `look = core` and re-points ink, paper, washes, rules
  and faces at the host — but it never re-pointed `--acks-danger/-warning/-success`
  or their `-ink`/`-tint` variants. So on a dark seat under `core` a state tint
  fell through to the LIGHT `:root` literal while the ink beside it came from the
  host's dark ramp. **Every surface in the family pairing a state tint with ink
  had it**, not just this panel; the party sheet is only where it was noticed.

  Ruled: re-point the three states at Foundry's own severity ramp
  (`--color-level-*`, in scope at `<body>` like the text ramp), keeping §8's two
  standing disciplines. The **tint** is a wash mixed to transparent, so the
  window's own ground shows through and it inverts with the seat by construction.
  The **ink** carries the state hue into the host's text colour, so it keeps the
  severity while staying legible on whatever ground the host chose — a bare
  `--color-level-error` is a mid red that reads on neither seat. No literal is
  introduced, so §8 stays an adapter rather than a second palette publisher.

  **Third fault, exposed by the second.** Six rules coloured a GLYPH with the
  plain state token, each with a comment asserting an icon takes the fill token.
  That only held while the tint was an opaque book colour. The plain token is for
  bars and buttons — a saturated mark with nothing read through it; anything drawn
  as **type takes `-ink`**, glyphs included. Fixed in `formation.css` (warnings
  icon, distorted-map alarms, down badge), `abilities.css` (conflict hint) and
  `influence.css` (effect and unaudited badges).

  **Measured after, all four combinations** (text / icon contrast):
  book-dark 11.7 / 8.2 · book-light 14.3 / 6.1 · core-dark 14.2 / 10.8 ·
  core-light 10.4 / 4.1. The reported configuration was 1.06.

  **Cost.** The `core` seat no longer gets the books' state hues at all — a
  warning there is Foundry's amber, not the books' gold. That is what `core`
  already promises for every other colour, and matching the host was the point.

---

### A character alone can strike a light (2026-08-11)

The sheet's Light / Douse / Shutter controls were gated on the actor being in a
party formation: `injectLightControls` returned early when there was none, so a
character standing alone in a corridor saw **no control at all** on a lantern.
Dragging one in from a compendium did nothing visible, which is exactly what it
looked like from the outside — a lamp that could not be lit.

`light.mjs` had promised the lone case in its own header from the beginning ("a
lone actor with a torch must burn just as brightly with no formation in sight")
and `bearerLights` already fell back to the actor's own flag. Only the READ half
existed. Nothing ever wrote that flag, because every mutator lived in the
formation's turn engine.

**Rejected: putting a lone character in a formation of one.** The formation
record is a world setting only a GM may write, which is why a player's click has
to travel through the GM relay to reach it. A player alone with a lantern would
then need a Judge connected to light it. Their own actor is a document they
already own.

**Ruled: mutators on the actor's own flag, and one shared gate above both.** The
rules that decide whether a flame may be struck — a hand to hold it, the gear RR
p265 requires, one unit of fuel off the stack — belong to the light source, not
to whether anyone happens to be marching in formation. They moved to
`prepareToLight` in lib, and the turn engine now asks it too, so the two ways of
lighting a lamp cannot drift apart. The equipment-enforcement setting is read
there for the same reason.

**Cost: no burn-down outside a formation.** Duration is tracked by the dungeon-
turn engine, and a lone character has no clock to burn against. These mutators
track the STATE of a flame — lit, doused, shuttered — and say nothing about how
long it lasts. That is the honest half, and it is the half that was missing
entirely. The token lights up because the actor's flag write already fires the
`updateActor` hook the vision sync listens on.

## 2026-08-11 — Surprise results consolidate onto one card

The Surprise Matrix posted one chat message per combatant. Six fighters meant
six one-line messages in roll order, each read separately to answer the single
question the matrix exists to answer. Party saves and party checks had already
settled the family's answer to this shape — one card, one row per member — so
surprise was the odd one out.

**Ruled: presentation only, and the roll stays core's.** The matrix cell, the
modifier stack, the threshold and the `surprised` condition are the system's.
They are also unreachable — the released system is one minified bundle with no
exports, and `SURPRISE_MATRIX`, `#rollSurprise` and `#rollSurpriseForGroup` are
a private constant and two private methods. So the patch wraps the instance's
`rollSurprise` action, lets core's handler run inside a scoped
`preCreateChatMessage` hook that captures and blocks its messages, and reprints
the rows.

**Rejected: reimplementing the matrix.** A module-side copy of the table would
be inventing what the system provides, and would silently disagree with the
book the first time the system corrected a cell.

**Rejected: parsing the message text against hardcoded English.** Each total is
read back using the very i18n template that rendered it — the key is formatted
with sentinels to find where `{result}` and `{formula}` landed — so the reader
follows any translation of those two strings. A template carrying no `{result}`
stands the patch down for that click rather than blocking output it cannot
reproduce.

**Ruled: two cards when something is hidden, not one wider audience.** Core
whispers a hidden monster's result to the Judges, and a chat message cannot be
part public. Widening the card to everyone would leak; narrowing it to the
Judges would take from players results they can see today. The hidden rows get
their own Judges-only card instead, so the ordinary encounter still posts
exactly one.

**Cost: no dice-roll animation, unchanged.** Core attaches no `Roll` to these
messages, so there was none to lose; the formula survives as the total's
tooltip.

**A setting, defaulting to the new card.** The usual promise — a default that
preserves existing behaviour — is deliberately not kept here: the card is what
the release is for. **Surprise results on one card** turns it off, and is read
at click time so it needs no reload.

**Found live, and only live: the class name is not usable as a hook.** The first
build bound `renderSurpriseMatrix`, which never fired — the released system is
terser-minified and the class arrives as `E`. The app is matched on
`surprise-matrix-app` in its own `options.classes` instead, which survives
minification. Offline validation could not have caught this; it mocks the
globals, not the shipped bundle.

**Found live: `acks-ui` defeats the chat component's own banner.** The design
system's chat card documents `acks-ui acks-chat` on the root, but
`.acks-ui :is(h1,h2,h3,h4)` in base.css paints headings the spot colour at
(0,2,0) and out-specifies `.acks-chat-title` (0,1,0) — burgundy lettering on the
burgundy banner. The card carries `acks-chat` alone; nothing it needs is
`acks-ui`-scoped. The vendored component's guidance is wrong on this point and
the next consumer will hit it too.

## 2026-08-11 — One renderer for every card where several people roll

Three surfaces post the same shape — the exploration party's checks, the party's
saving throws, and the Surprise Matrix's results — and each had its own
renderer: two hand-built `<ul class="results">` lists in the formation feature
and, as of the surprise work above, a third that used the design system's table.

**Ruled: one renderer, `lib/roll-card.mjs`, and the lists go.** Same question
every time (who rolled, what did they get, did it land), so three answers were
three chances to drift — and they already had. Only the checks card showed the
modifier stack, only two showed a target, and neither list had the design
system's tabular figures, banded rows or column rules. Folding them in also
carried the surprise card's own fixes backwards for free: the tables now line up
their numbers, and the cards take their ground and their ink from one place.

**Ruled: the card owns the CARD, and nothing about any throw.** What a row
means, what counts as success and every localized word are the caller's; the
module knows only rows, sections, and three kinds of emphasis. That is what lets
the surprise card sit on it without teaching it about surprise.

**`neutral` is a third emphasis, not a missing verdict.** A surprised row is
marked but not scored: whether being surprised is good news depends on which of
the two tables you are reading. Success and failure take the state tint and its
`-ink` variant; neutral takes the palette's plain nested-surface tint.

**Cost: two visible changes to cards that were not broken.** The party's checks
and saves now arrive as a table rather than a bulleted list, the modifier stack
moved from an inline parenthesis to a small line under the name, and the target
moved into its own column. Both were re-shot. `success`/`failure` gained capital
letters, which they needed once they were a Result column rather than the tail
of a sentence, and the saving-throw card's bare `(magical)` tag became a line
saying which bonuses that means are applying.

**Not folded in: the turn report and encounter cards.** They also use
`.acks-formation-card` with a `<ul>`, but they are lines of prose about what
happened during a turn, not one row per person with a number and a verdict.
Forcing them into a table would be a worse card, not a shared one.

## 2026-08-14 — Tokens split colour from structure; the light palette is a real branch

**Ruled:** `vendor/acks-design/tokens.css` is restructured into one `:root`
structure block (type, space, line widths, sheet geometry, depth, texture
knobs, layout — `--acks-fs-base` and the density-pinned steps live here and
nowhere lower, or the host's inline font-scale knob stops reaching themed
applications) and two SYMMETRIC palette blocks. The light palette publishes at
`:root` and re-publishes at every root Foundry stamps light; each palette
block ends with the same var()-containing derived tail so substitution re-runs
where that palette's literals are in scope.

**Why:** with split `colorScheme` settings Foundry stamps `theme-<scheme>`
per-region (body follows `applications`; interface elements and disagreeing
windows get `.themed.theme-<scheme>`), and the old exclusion-only design left
a light-stamped root under a dark body drawing dark tokens — including
derived tokens already substituted dark at `<body>`, which exclusion cannot
un-bake. Live-verified in both split directions, plus the font-scale knob
reaching a themed root, the `data-acks-look="core"` exclusion withholding
both palettes, and forced light under a dark body.

**Rejected:** a duplicated light block (every colour in two places — the
2026-08-05 ruling); four theme×look combinations (owner, 2026-08-14: light/
dark and look on/off are separate toggles — two palettes only, the core look
withholds both).

**Also:** the last nine v10-era `--color-*`/`--font-size-*` reads are swept
from module styles (classes.css, markets.css), and validate-extra now fails
any non-`foundry.css` stylesheet that reads a legacy Foundry variable.

## 2026-08-14 — Money is physical; four rulings land at once

**Ruled (owner, this date):** (1) one spend policy — smallest denomination
first with change made by breaking the larger coin; (2) coin KIND is name and
rate together, so a local variation is a separate stack everywhere it travels
and only valuation is contextual; (3) a payment is a location-gated TRANSFER —
reach checked before denomination math, coin landing on the payee's stacks
(actor purse or location till under the `acks-extras:house` sentinel), change
returned by the same planner, wages taking the exact-representable `upTo` road
with the remainder booked as arrears; (4) markets exchange denominations
freely (the till is liquid and mints its change), everywhere else barters —
a GM `exchangeOverride` on the market subtree outranks the derivation.

**Consequences:** every in-repo payment names a destination; grantGold without
a payer and spendGold without a payee remain the Judge's mint and sink, as
explicit choices; the house pile makes a location's own goods first-class —
Judge takes freely, players take rows marked retrievable, spoils unlock
through a proficiency throw whose specific proficiency is a rules extraction
still owed; empty unremarkable locations self-clean at ready (setting-gated,
default on).

**Rejected:** burn-on-spend as any payment's default; per-location re-rating
baked into stacks (splits every merge path); silently overcharging when no
changer can split a coin.

---

### 2026-08-15 — a hidden pack must be one the import really replaces (ABANDONED 2026-09-02 — the whole direction was withdrawn; see the head of this file)

`hideSupersededPacks` folds a system compendium out of the sidebar once the
world holds imported documents "covering" it. Every probe was a TYPE-WIDE
FLOOR — twenty imported items of type `item`, ten monsters — which is not a
coverage test: the same twenty adventuring-gear items satisfy the floor for
`acks-clothing` and `acks-adventuring-equipment` alike, and the module's own
docstring already forbade exactly that ("where a system pack is NOT
superseded, that is an importer gap, not a reason to hide it").

So the packs were measured instead of assumed. Everything the cookbook can
materialize was imported against the seat's six books — 1,307 documents — and
each pack compared document by document.

**Ruled: `acks-languages` is superseded and is now hidden.** All 58 languages
come back from the reader's own book (acks-importer 2.9.x reads the Appendix A
taxonomy), and neither side carries an Active Effect, so nothing is lost by
folding the row away. Its probe counts languages specifically, via a new
`idPrefix` on the spec, because a floor of "40 abilities" would fire in a world
that imported a hundred proficiencies and no book at all.

**Ruled: `acks-treasure` is NOT superseded and leaves the map.** Its probe was
"five imported roll tables of any kind", which is not a statement about
treasure at all, and nothing in the register replaces the treasure tables.

**Ruled: the remaining seven keep their floors, and their shortfalls are
recorded rather than fixed here.** Each still has documents the import does not
produce — 43 named equipment entries, twelve thief-skill powers, and a monster
leg that has never been measured — and each is now a named gap in
acks-importer's ROADMAP. Tightening those floors into real coverage tests
changes which rows an existing world loses and wants its own decision; the
`idPrefix` mechanism languages uses is there when it is taken. The cost is
visible in the live check: forty imported abilities of ANY kind satisfy the
`acks-proficiencies`, `acks-class-abilities` and `acks-monster-abilities`
floors at once, while the languages probe correctly ignores them.

**Ruled: the hide defaults ON.** It was off, so the feature did nothing in
every world that never found the setting. Defaulting on is safe *because* it is
coverage-gated — a world that has imported nothing has replaced nothing, and
sees no change at all (verified: an empty world hides zero rows with the
setting on).

### The same day — one folder for the family's compendiums (SUPERSEDED 2026-09-01)

The modules' own packs are placed by `packFolders` in their manifests, both
declaring the name **ACKS II**, which is how Foundry merges them: its
initializer matches a folder by hierarchy name across packages, so six packs
from two modules land in one folder rather than one folder each.

The SYSTEM's thirteen packs cannot be placed that way — a manifest folder only
accepts packs belonging to the package that declares it — so `organizeFamilyPacks`
writes the same assignment Foundry's own initializer writes, at ready, GM-only.

**Ruled: repair a dangling folder reference, never overrule a real one.** A
pack whose `core.compendiumConfiguration` entry names a folder that no longer
exists is stranded at the sidebar root permanently, because the initializer
only assigns a folder to a pack whose config does not already name one. That is
why the system's own five declared folders had never appeared in the test
world: every pack still pointed at folders deleted long ago. A reference that
resolves is a Judge's own arrangement and is left alone.

### The same day — telling Polyglot what the world imported

The system registers its own Polyglot provider and it is a good one: it answers
what a character speaks by reading the actor's `language` items, which is
exactly what the family writes once languages are documents
([classes](../classes/DECISIONS.md)). So the half that matters needed no code
here at all.

**Ruled: feed the system's provider, never replace it.** Polyglot's
`defaultProvider()` prefers a `system.*` registration over a `module.*` one, so
a provider registered from this module would sit unused until a GM found the
setting and chose it — a working integration that is off by default is worse
than none, because it looks installed.

**Ruled: add the world's languages to the list, and only add.** The system's
provider builds its language list from its own compendium and nothing else, so
a tongue read out of a Judge's own book was spoken by the character and still
absent from the chat selector — known, but unusable. `publishWorldLanguages`
appends the world's `language` documents to the list the provider already
built, keeping any font and rng the GM chose, and leaves an entry the provider
already has exactly as it is. Withdrawing one is deliberately not done:
removing a language from a live provider strips it from every message already
written in it, so a deleted language leaves the selector at the next reload.

**Cost:** the bridge reaches into another module's live object rather than
going through an API, because Polyglot exposes no "add a language" call. It is
guarded on the provider existing and is inert in a world without Polyglot —
the hook it listens on simply never fires.

## 2026-08-18 — One owner for the attack roll, and one seam for future modifiers

Recorded from the 2026-07-31 ruling (memory archive). lib owns
`AcksActor#rollAttack` (`patches/attack-roll.mjs`, libWrapper OVERRIDE when
present; pure math in `attack-logic.mjs`; world setting `attackRollPatch`
default on). The model: **throw = moving target** (class/level), **bonuses =
labeled roll terms**; hit ⇔ `die + Σterms ≥ throw + targetAC`; outcomes are
bit-identical to core's folded resolution (14,400-case parity sweep in the
test suite, `legacyCoreResolves` as oracle). The chat card renders core's own
`roll-attack.hbs` so damage-apply listeners are untouched.

**Every future combat modifier goes through the `acksLibPreAttackRoll(actor,
ctx)` hook** — ctx carries mutable `terms` (stable keys:
ability/adjustment/weapon/situational), a movable `throwTarget`, and
`targetAc`. REJECTED: additional wraps of `rollAttack` anywhere (equipment's
existing WRAPPER composes on top unchanged), and folding target moves into
bonus terms — a target adjustment that arrives as a bonus delta hides the
rolled value the remodel exists to expose. Known intentional leftover: core's
attributes-tab Melee/Ranged display omits bba (core is read-only); the
Follower Card shows the honest split.

## 2026-08-24 — Initiative reuses the roll CARD, not an invented grouping

**Ruled:** a round's initiative posts through `renderRollCard` as one card
(`patches/initiative-card.mjs`, world setting `initiativeCard`, default on),
and a combat group prints as a single row naming its members. The wrapper is a
libWrapper WRAPPER around `Combat#rollInitiative`; presentation only.

**Why it is a card and not a grouping.** "Everyone is rolling individually" has
two possible cures, and only one of them was ours to build: the system already
rolls once per combat group and already has the control that makes one. What it
lacks is any way to SEE that — a group's single roll is printed under one
member's name and the rest say nothing, so a grouped fight and an ungrouped one
produce indistinguishable logs. The gap was legibility, and inventing a second
grouping mechanism beside core's would have been inventing what the system
provides (reuse → extend → enhance → invent).

**REJECTED: auto-grouping a deployed stack.** A stack's bodies are not
automatically a combat group, and the party bridge still creates one combatant
per body. Which combatants share a roll is the Judge's explicit choice — the
maintainer's ruling, this date — because the cases that want it (a stack, a
summoner and their summons) are the Judge's to declare and the cases that do
not (a party of adventurers, RAW) outnumber them.

**Cost:** two cards where one hidden combatant is present, and a group with a
hidden member appears on both — its open members publicly, the hidden one to
the Judges. One chat message cannot be part public, and widening the card to
avoid the split would publish what core whispered.

**Note on the namespacing gate:** the group flag is read as
`combat.flags?.acks?.groups`, deliberately not through the flag accessors, which
`validate-extra` fails for a foreign scope. The gate is right — a module has no
business writing the system's namespace — and a plain property read is the
honest expression of "core owns this, we only look".

## 2026-08-25 — A window never names its own ground; the dress does

**Ruled: a sheet's stylesheet may set geometry on its application root, never
`background`, `color` or `border`.** Those three belong to the `.acks-ui` dress
(`vendor/acks-design/foundry.css` § 2), which is the only layer that stands down
when the `core` look hands the client back to Foundry.

The item sheet had pinned `background: var(--acks-paper)` on
`.acks-extras-item-sheet` itself. Under `book` the declaration never won —
`.acks-ui.application` out-specifies a bare root class and names the same value —
so it read as harmless duplication. Under `core` it was the only rule left
standing: the look strips `.acks-ui` from the root AND re-points `--acks-paper`
at `transparent`, so the class-pinned ground painted that transparency, and
module CSS is unlayered where Foundry's is layered, so it beat the host's own
window ground whatever the specificity said. The sheet rendered with no ground at
all — its contents readable only against whatever window sat behind it.

**Why this window and no other.** The adapter's rule — surfaces go transparent
rather than picking a Foundry background (`foundry.css` § LOOK) — is safe for
every region INSIDE a window, because a region that paints no ground inherits the
window's. The window itself is the one surface with nothing behind it, so it is
the one surface that rule cannot serve, and the dress is what serves it. A sheet
naming its own ground opts out of the hand-back without saying so. Every root
class in `styles/` was read for this: it was the only window doing it.

**REJECTED: qualifying the sheet's paint with the dress
(`.acks-ui.acks-extras-item-sheet`).** It fixes `core` equally well, and it would
have made the sheet's spot-coloured border finally apply — which is the argument
against it. That border has never rendered; honouring it now is a design change
smuggled in as a bugfix. Deleting the three declarations leaves `book`
byte-identical, which is what a fix for a look nobody was testing has to be.

**Cost: nothing enforces this.** `validate` reads stylesheets for class
namespacing, not for which properties a root class may set, and the failure is
invisible in the default seat — the seat a session tests in. The guard is a
comment at the declaration and an observable in `docs/equipment/TESTING.md`
step 12; a second window can still acquire the same pin without anything failing.


- **2026-08-28 — one carry model: attachment absorbs mounting, and the mount
  API becomes a permanent facade.** Three stores answered "who is on what" —
  `mount.mjs`'s symmetric rider↔mount pair, `attachment.mjs`'s one-way flag
  (only ever written for passengers), and vehicles' `team.animals[]` rows — and
  they disagreed by construction: the draft bucket read attachment roles no
  writer fed, and a mounted character was invisible to the party's pace. Ruled:
  the attachment flag on the CARRIED actor is the single truth for every carry
  — riding, boarding, harnessing, lashed-on cargo (a new `cargo` role) — and
  grows `station` (the job at the carrier) and `kind` (a draft animal's
  equivalence class). `mount.mjs` keeps its API and hooks as the
  mounted-combat vocabulary, reimplemented over the flag; legacy pairs are
  still read, and every write converges them, so worlds migrate lazily with no
  sweep.

**One flag per actor makes the attachments a forest by construction.**
`attach()` therefore refuses a carrier whose own chain contains the actor (the
old guard was one level deep), and `rootCarrierOf` answers who actually moves:
a rider whose horse is harnessed to a wagon travels at the wagon's pace, which
is what `partySpeed` now asks.

**The reverse index is a cache, never truth.** The symmetric pair existed
because `attachedTo` scanned every actor per read — a real cost once `riderOf`
sat inside per-actor capacity loops. It is fixed with a lazily rebuilt
carrier→attached map whose every hit is re-verified against the flag, so a
stale index degrades to a wasted lookup, never a wrong answer.

**Rejected:** keeping the pair beside the flag (two writers per fact is the
disagreement this rules out); a persisted roster on the carrier (a deleted
carrier leaves a roster pointing at ghosts); an eager world migration (the
read-fallback plus clear-on-write converges without a sweep that could
half-run).

## 2026-08-29 — Thirst charges a rolled toll; hunger charges a flat one

Starvation and dehydration were being priced through the same number-only
gate. Starvation's cost is a flat figure per day and read correctly;
dehydration's is a die, so `numOrNull` answered null and the whole condition
cost **nothing**. A party could stay dehydrated indefinitely at no charge
while the ladder reported it correctly — the readout said one thing and the
arithmetic did another.

**Ruled:** the two tolls have different shapes and the code says so.
`advanceSurvival` takes `thirstRoll` from the caller, exactly as
`advanceSettlementTurn` takes `navRoll` — the core stays pure and the impure
shell owns the dice. Each body throws its own; a shared throw would make a
party suffer in lockstep, which is not the printed rule. A die with no roll
supplied reports `unrolled` and charges nothing, so an unsupplied roll is
visible instead of looking like a body that got off free. The heat's
multiplier now reaches the toll — `runProvisionDay` was computing
`heatBurden.dehydrationDrain` and discarding it, so sweltering weather
charged the same as a mild day.

**Cost:** one more argument through the day-runner, and a caller must know to
roll. `thirstDie()` exists so it can ask rather than guess.

**Known limit, deliberately not papered over:** the ration vocabulary has
three levels (full / half / none) and the printed onset has three clauses —
no water, below half, and below full. Those do not line up: "below half"
floors to `none` here, so it is charged on the harsher no-water clock. A
fourth ration level would fix the mapping and would also change what
`dealProvisions` means, which is a larger change than this defect warrants.
Recorded so the next reader knows it is a mapping, not an oversight.

**Rejected:** an injected roller callback (`advanceSurvival` would stop being
pure the moment anyone passed an async one); defaulting an unrolled die to
its average (an invented figure is exactly what the registry exists to
prevent); rolling once for the party (cheaper, wrong).

## 2026-08-29 — An i18n key is a leaf or a parent, never both

Re-keying the march's road factors from `roadDriver` to `road.driver` — so the
movement-mode layer could read `road` as the layer name — left
`ACKS-VEHICLES.reason.road` in `lang/en.json` as a string while three new keys
needed that same path as a parent. Foundry expands flat dotted keys into nested
objects; the expansion hit a string where it wanted an object and dropped the
**entire language file**. Every string in acks-extras rendered as its raw key,
in every feature, with nothing logged.

It survived `JSON.parse` (the file is valid JSON), it survived `validate`'s
i18n check (which asks whether referenced keys exist, and they did), and it
survived a fresh browser. Only looking at a rendered panel found it.

**Ruled:** a key's path is either a leaf or a parent. `validate-extra.mjs`
walks `lang/en.json` — nested branches flattened the way Foundry flattens them
— and fails on any path that is both. The superseded `reason.road`,
`reason.roadDriver` and `reason.roadWashedOut` labels were deleted rather than
kept, because nothing emits those part keys any more.

**Cost:** one release-day debug, and three dead label keys removed. The gate is
cheap and runs on every validate.

**Why it is a gate and not a note:** the failure is silent, total, and
indistinguishable from "the module did not load" — the class of bug this
family's live-testing rule exists for, and the one an offline suite is least
able to see.

**Rejected:** keeping the old keys as aliases (the conflict is the old key's
existence, not its value); flattening the whole file to dotted keys (the nested
roots are how the file stays readable); checking only keys this repo adds (the
conflict is between an old key and a new one, so both halves must be in scope).

## 2026-09-04 — The world chooses its defaults; the ladder fills what the choice lacks

Release 6.4.0 made this module's character sheet the default for every world,
and the look was three per-player client settings with no world half. A table
that wanted the system's sheets, or no ACKS styling at all, had to walk every
seat through Configure Settings and pin sheet types one by one.

**Ruled (owner, 2026-09-04): "the sheet UI defaults" become one dismissible
startup prompt that sets a world default — Foundry, the system's, or this
module's — and the default is a SELECTION BETWEEN DEFAULTS, not a per-type
switch.** Verbatim: *"if a specific sheet for that option doesn't exist, that
sheet uses the extras, core, foundry default in that order."* So the preset
names a preferred rung, and a type the rung has no sheet for falls through the
remaining rungs in that fixed order. The order is deliberately richest-first:
the `foundry` preset lands character actors on this module's sheet, because
Foundry registers none and the alternative is a seat with no sheet.

**Ruled: the client `look` setting gains a `world` value and it is the new
default.** A stored `book` or `core` is a player's own override and stands. A
client that never touched the setting followed `book` before and follows the
world's `book` now — byte-identical for every existing seat until the Judge
picks otherwise.

**Rejected: writing every type's default into `core.sheetClasses`.** Explicit
and visible in Foundry's own UI, but it freezes the world: a later release
that adds a sheet for a type would never become that type's default, because a
stored pin outranks every registration. The ladder instead re-flags in memory
on every load and treats a stored pin as the Judge's word — applying a preset
drops the pins that name a ladder sheet, which is the one moment the Judge has
said "the world's choice, not mine".

**Rejected: a socket to push the look to players.** A world setting's
`onChange` already fires on every client; `look: world` plus that hook is the
whole transport.

**Cost:** two new world settings, a hidden flag, and one more surface a
release must live-walk (the prompt, and the three presets against the
character, monster and party types). Declared a hotfix by the user despite
carrying a setting, which the minor rule would otherwise claim.
