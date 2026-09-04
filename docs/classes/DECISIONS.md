# Classes — decisions

Dated, append-only. How it works now is [MODEL.md](MODEL.md); what is not
built is [ROADMAP.md](ROADMAP.md).

## 2026-09-02 — a disabled control says why, and the die is not always the reason

**Problem.** Reported from the field as "the template menu doesn't work during
character creation — inactive, will not open, including if Judge Override is
active". Nothing was broken: `stat-page.mjs` and `panels.mjs` are byte-identical
across all of v6, and the select carries `disabled` for exactly one reason —
there is nothing to put in it. Three states reach that, and the override
relieves only the first: the die is unrolled, a package-less build is ticked, or
**the selected class prints no packages at all**. The reporter had eliminated
the first themselves and been given no way to tell the third.

**Ruled.** The note under the menu names the actual cause. A class with no
packages is answered before the die is consulted, because a hint that says "roll
the template die" sends a reader at a control that cannot open however they
answer — and the chargen page auto-selects the first class in book order, so
they may never have chosen the one they are looking at.

**Rejected: giving the chargen page the `noneLabel` escape.** `assign-app.mjs`
passes it and chargen does not, which is the whole lineage of this report — the
4.11.0 fix landed on one of the shared builder's two callers. Adding it here
would make a package-less build reachable without the Judge's own
build-without-a-package tick, which is a behaviour change overlapping
`chargen.manual` and a decision about who may skip a starting package. That is
not a hint fix, and it is not made in passing.

**Rejected: enabling the empty select.** A select with no options opens onto
nothing. The control is honest; only its caption was not.

**Cost:** one more string to translate, and a class whose packages simply have
not been imported yet reads as a class that prints none — the note names both
paths out, but cannot tell the two apart.

**Also ruled, from the same report's evidence: what closes applies what the page
offered.** `refresh` gates the build-without-a-package tick behind the override
(`manual = judge && state.manual`), but three reads in the CLOSE path took the
raw tick and so escaped that gate. A Judge who ticked it, then lowered the
override, saw a live template selector and a hint asking for the die — while the
close path suppressed the auto-template rescue and wrote a package-less build.
The page displayed one thing and wrote another. The gated value is now hoisted
onto the state as `manualInForce`, and `state.manual` is read nowhere but
`refresh`.

**Rejected: clearing `state.manual` when the override goes down.** One line
instead of five, and arguably the truer semantics — a Judge-only option arguably
should not outlive its gate. It destroys a Judge's setting on a transient toggle
(lowering the override to preview the player's view silently loses the tick),
which is a visible behaviour change; this fixes only the write, which is what
was wrong. The counter-argument is real and this may be revisited outside a
hotfix.

**Not changed: `state.keep`.** It has the identical sticky-behind-the-override
shape, but nothing on the page displays it, so there is no contradiction to fix —
an invisible sticky preference is a wart, not a desync. Changing it would be a
behaviour change with no defect behind it.

**2026-09-02 — re-examined, conclusion unchanged, reasoning corrected, and a
guard added. `wipe: !state.keep` is deliberately NOT gated on the Judge
override. Reject any diff that adds one.** Hoisting a `keepInForce = judge &&
state.keep` the way `manualInForce` was hoisted looks like the consistent
follow-up and is a data-loss regression: `state.keep` initialises `false` and is
only ever set true, so the only reachable staleness is keep-true-while-hidden,
which yields `wipe:false` and SKIPS the deletion. Gating it flips that to
`wipe:true` for a Judge who ticked "Add, do not replace" and then lowered the
override — and the wipe deletes EVERY embedded Item on the actor, not only what
chargen granted. The flag is stale in the direction that declines to destroy;
the "fix" points it at destruction. Its worst current outcome is an additive
double-build, which is visible, announced in the chat card, and repairable by
hand.

The reasoning above is also wrong on one point, kept here rather than edited
away: the promise IS made, just not on this page. The reopen dialog states that
the character's existing items will be replaced, and a stale keep silently
breaks that. The contradiction is real and merely benign. If it is ever worth
closing, the safe direction is clearing `state.keep` when the override drops, so
the flag dies with its control — a behaviour change that loses a Judge's tick on
a transient toggle, and therefore a minor with a live check, never a tidy-up.

## 2026-08-30 — a pick list offers definitions, never a class's own copy

**Problem.** Reported from the field as a duplicate IMPORT: the general
proficiency select on the class picker listed "Performance (singing)" five
times, "Performance (chanting)" four, and no plain Performance at all. Nothing
had been imported twice. Materializing a class's starting packages mints one
world proficiency per printed specialty, per class (`planAbility` reuses a copy
only within the same class), so a world that has materialized its packages holds
109 general abilities where the books define 42 — and in the test world every
one of the 67 extras was a template part.

`findByRef` had known since the skinned-gear ruling that a class's own copy
never answers for the definition it copied, and enforced it inline. Every list a
player PICKS from — `choosableGenerals`, and through it the Intellect bonus
selects — read the library raw, so the same distinction the ref lookup makes was
absent exactly where a human has to read the result.

The grants were never wrong: a part carries the importer's stamp, so a pick on
one resolved through `findByRef` back to the definition. The damage was entirely
in what the player was asked to read.

**Ruled.** The stamp becomes a named predicate, `templatePartOf`, owned by
`registry.mjs` beside the lookup that first needed it; `findByRef`,
`choosableGenerals`, `adventuringDoc`, `choosableSpells` and
`template-packages.mjs` all read it instead of restating the flag path. A list a
player picks from offers definitions only.

**Cost.** A Judge who hand-builds a specialized proficiency and wants it on the
general list must leave it unstamped — which is what an unstamped document
already means everywhere else, and a part is only ever stamped by this module.
The offline gate is `test-classes.mjs`; `game.items` is the only global the
option list reads, so the case is testable with no Foundry behind it.

## 2026-08-30 — an unthrown template die is thrown, and a package answers the picks it makes

**Problem.** Three faults on the two character-building surfaces, all reported
from the field on one character.

The Scores Generator read its legal packages from the template die
(`legalTemplates(templates, rolled ?? -1)`). An unthrown die legalises NOTHING,
so the selector rendered empty, `state.template` stayed null, and the close hook
took its "a build with no package is a deliberate choice" branch. A player who
rolled their attributes, chose a class and pressed Save walked away with six
numbers: no class bound, no package, no equipment, no coin — under a notice
reading "No class and template were chosen", which was false about the class.
The step they skipped was not the SELECTOR but the 3d6 button beside it, and
nothing on the page said the omission would void the build.

The class picker asked the level-1 proficiency picks beside a chosen package
that already makes them, and offered the package's own abilities among the
answers. `applyTemplate` grants a printed rank as N copies, so spending a free
pick on one doubled the proficiency.

Every hint on both surfaces rendered at `--acks-fs-fine` — the 6pt step meant
for a table's micro annotations. The vendored `.acks-ui .form-group > .hint`
matches at (0,3,0); the module's `.acks-extras-classes-* .hint` at (0,2,0) had
been losing silently since it was written, and these boxes carry running prose.

**Ruled (user).** The die is thrown FOR a character who reached the end of the
page without it, and the highest band it reaches is taken. The auto-pick half
already existed — the selector defaults to the highest legal band — so only the
die was missing, and a skipped roll and a skipped selection now converge on the
same package. A die reaching no printed band still yields one: the lowest, so a
low roll never costs a character their whole starting package.

**A class that prints no packages is not a skipped step**, and keeps the old
branch. This is deliberate: the class selector always carries a default, so
applying on every submit regardless would let an untouched dropdown wipe and
rebuild a character. The auto-roll is scoped to classes that actually print
packages, which is where the player demonstrably engaged with the column.

**A package answers the level-1 proficiency picks, and is not offered among
them.** The generator already ruled this at the award level
(`answeredByTemplate`, RR Ch. 2) and the picker never got it; the helper moves
to `picks.mjs`, which is the one owner of what a rung asks. The Intellect picks
stay — they are chosen "on top of those listed for the template" — minus the
abilities the package hands over, matched on name because a bundled row carries
no ref.

**Cost.** Removing an option from a rung is the thing `picks.mjs` exists to
forbid, and the exemption is narrow: a HELD option is a truthful answer to the
rung, while one the package grants in the same write buys nothing. The rung
stays closable because both surfaces that pass a package also offer the
"already on the sheet" and "leave open" answers. `templateGrantKeys` matches on
name for bundled rows, so a package and a pick list that disagree about an
ability's name will fail to exclude it — the pick is then wasted, not wrong.

## 2026-08-29 — the 1st-level hit-die floor is imported, and defaults to no floor

**Problem.** RR Ch. 1 §I.5 puts a minimum under the 1st-level hit die and adds
Constitution AFTER it. `hitpoints.mjs` floored the TOTAL at one instead, which
is not the same arithmetic — the modifier is meant to be applied to a die that
has already been raised. Both the code and the docstring above it asserted the
absence as if it were the rule, and the offline tests asserted the wrong totals,
so three statements of it agreed with each other and none agreed with the book.

**Ruled (user).** The floor is a printed value, so it is imported — a
`hitPoints` ruledata document with a `firstLevel.dieMinimum` — and the STRUCTURE
is built around a minimum that the imported number fills in. `rollHitDice` takes
a `dieMinimum` option that raises each face before Constitution is applied to
it, and `rebuildHitPoints` passes it at 1st level ONLY: every level after is a
full reroll with no floor above the per-die one.

**The default is 1, and 1 is not a guess.** It is the arithmetic identity of
"no floor" — it cannot raise any face of any die — so a world that has imported
nothing behaves exactly as it did before this change, byte for byte. A default
of 4 would put the printed number back in the module the whole arrangement
exists to keep it out of.

**World-scoped, not per-class.** `templatesAssumeIntBonus` (2026-08-20) is a
per-class field because WHICH classes are studious is a per-class fact that
failed two structural derivations. This is one number true of every character in
the campaign, and a per-class field would leave every hand-made class unfloored.

**Corrects** the 2026-08-14 chargen entry, which describes 1st level as "one
roll … and its floor of one".

## 2026-08-29 — hit points past 9th: the rate is imported, the summing is ours

**Problem.** A class built through the Judges Journal builder got
`9dX` for every level past 9th with no flat term, where an imported class of the
same spread carries the printed bonus in its own cell. Two 14th-level fighters
in one world could differ by up to ten hit points with nothing on either sheet
saying why. The racial half of the rate had been extracted since the dwarf rules
recipe landed and was read by nothing at all.

**Ruled (user).** Make the structure aware of how to USE the rates and import
the values. The derivation reads `budget.hpAfterNine` by saves chassis, adds
the race's own `hpAfter9` when the build actually spends a racial value (the
gate its four siblings already use), and writes the CUMULATIVE flat onto each
row past 9th — which is the shape `parseHd` already reads, and the shape the
printed tables already use.

**A missing rate is a named issue, never an invented flat.** Following the
2026-08-11 ruling: the row keeps its flat-less cell and `missingHpAfterNine`
names what the world has not imported. An unrecognised chassis reaches the same
issue rather than silently taking one of the two rates.

**Judge tool.** `system.hpAfter9` on the race document had no editor in either
direction, so a race the importer has no recipe for could never carry one. The
race sheet now has the input. For a race the importer materializes, the IMPORT
wins — a re-import rebuilds the race's `system` wholesale — so the input serves
hand-made races and worlds with no book, and the hint says so.

## 2026-08-29 — a pick the character owes is an item on the character

**Problem.** A printed package sometimes offers a choice rather than a thing.
Dropped, it was invisible: the player was owed a starting spell, nothing on the
sheet said so, and the pick was never made.

**Ruled (user).** Free-choice options get a placeholder item. It is minted on
the ACTOR when the package is granted, named as a question, and clicking it
opens the chooser that replaces it with the document the player picks.

**This does not reverse 4.20.0.** That ruling (lib/DECISIONS.md, 2026-08-24)
removed placeholders for names a world could not resolve YET — an unresolved
name has a right answer, so a placeholder for it is a duplicate waiting to
happen: it answers its own name search, reads as real, and gets dragged onto a
character beside the real thing when the import finally arrives. An open CHOICE
has no right answer until a player makes one. The line is WHERE THE DOCUMENT
LIVES: nothing in `pending-choices.mjs` writes to the world library, only ever
to the actor who owes the pick, and a test asserts that mechanically. A
placeholder in the library is a lie about what the world contains; a placeholder
on a character is a true statement about what that character owes.

**Identity is content, never position.** Materializing rewrites a row's arrays
and the non-bundle path grants from a spliced copy, so the same printed offer
sits at different indices on different passes. The importer writes a stable
`choice.key`; without one the offer is identified by what it OFFERS. A key
already open or already redeemed is skipped, so re-importing, re-materializing
and re-running chargen cannot mint a second marker and a redeemed pick never
returns.

**The spell options reach past the library.** `choosableSpells` is the one
option source that reads the world's spell compendia as well as the imports.
The 2026-08-20 ruling governs what a PACKAGE materializes into a template from
a book the reader may not own; a player electing their own starting spell is a
different act, and offering nothing would ship a pick that cannot be redeemed.

**Rejected.** Award-rung placeholders: the ladder already has `awardsTaken` and
the rung dialog, and a second authority beside them buys no capability. A
`choicesTaken` actor flag as the only record: chargen's wipe deletes the items
but not the flag, which would silently suppress the re-mint.

## 2026-08-27 — an unqualified damage bonus is elected by the character, not assumed

**Problem.** A class's damage-bonus column reached the class sheet and stopped
there: nothing wrote it to the character, so a fighter's bonus never touched a
damage roll. Writing it needed an answer to a question the document cannot
answer — WHICH attacks it applies to.

**Ruled: the column's key is the authority, and where the key says nothing the
character is asked.** A key carrying `melee` or `missile` (the importer now
guarantees a key carries every qualifier its printed header carries) settles it
outright. A bare `damageBonus` does not mean "both": the fighter's column is
unqualified because the bonus is unrestricted, and the barbarian's because the
player elects melee or missile at 1st level and cannot change it. No field
separates those two, and inventing one would put a number on half the characters
in a world that their page never gave them. So it is asked — once — and the
answer is recorded on the CHARACTER against the class it was made for, because
one world's barbarians do not all specialize alike.

**Rejected — defaulting an unqualified column to both.** Right for the fighter
and silently wrong for the barbarian, and silently wrong is the worse half: a
missile-elected barbarian would carry a melee bonus nobody granted, on a sheet
that shows the number without showing where it came from.

**Rejected — a row in the confirm dialog.** Chargen, the level-up wizard and the
picker all pass `confirm: false`, so an election collected there would never be
asked on any path that matters. It is its own prompt, resolved before the
confirm dialog is built, and `tools/test-classes.mjs` pins that ordering against
the source so the two cannot drift back together.

**Dismissing cancels the apply.** The choice is permanent for this character in
this class; a dismissed prompt that picked one anyway would make a permanent
decision out of a keystroke meant to back out.

**Cost.** One more prompt the first time a class with an unqualified column is
applied. It does not repeat — the answer is honoured by every later apply — and
a class whose column is qualified never asks at all.

**Written through core's own fields.** `system.damage.mod.melee` / `.missile`
are the only route by which a class bonus reaches a damage roll: core pushes
them onto the damage parts, and nothing else in the family writes them. The
loadout effect ADDS to them, so a base written here composes with fighting-style
specialization instead of overwriting it.

## 2026-08-25 — the class's training is edited as slots, in a section of its own

**Ruled: the training effect is lifted out of the ordinary effect list and drawn
as toggleable slots.** It is an Active Effect whose changes are three CSV
strings, so in core's list it is one row whose only editor is a text field
holding `dual,twoHanded,weaponShield` — an editor for the storage format rather
than for the thing. It is now a **Class modifiers** section on the Effects tab,
drawn as the same slot strip the Inventory tab and the follower card use, with
each pill a toggle. Same document, no second store. The row is removed from the
list below it, because two controls for one thing can disagree on screen.

**Ruled: the section shows THIS EFFECT'S grant, not the effective profile.**
Different questions. A pill lit by a proficiency item or an actor flag would
refuse to switch off and read as a broken control, so the Inventory strip keeps
answering "what is this character trained in, however it was granted" and this
answers "what does the class give".

**Ruled: `all` expands on first edit and never collapses back.** Switching one
weapon class off cannot be expressed by editing a wildcard, so the grant is
written out explicitly minus the one dropped. Re-selecting everything leaves the
explicit list: it means the same thing to the profile, and silently rewriting a
Judge's list to `all` would discard the distinction the next edit depends on.

**Ruled: armour toggles as a ladder.** Clicking a rung sets the ceiling;
clicking the current ceiling clears the grant. Trained-in-heavy-but-not-light is
not a state the profile has.

**Cost:** clearing the armour grant leaves the character on acks-equipment's
permissive `heavy` fallback rather than restricting them — that module's
documented behaviour for an unconfigured profile, and the reason the strips draw
unconfigured as grey rather than as a grant.

*Rejected: leaving the row in the list as well.* The loadout effect does stay
there, locked ([lib DECISIONS](../lib/DECISIONS.md)), because it is derived from
what is equipped and has nothing a toggle could hold.

## 2026-08-24 — a template row resolves everything, then writes once

**Ruled: `materializeTemplates` writes one row per call, not one entry per
call.** `gearFor`/`abilityFor`/`spellFor` became `planGear`/`planAbility`/
`planSpell`, which return either a document that already exists or the data to
create, and `writeRow` writes a row's new documents in a single
`createDocuments`.

A write costs a round trip whose price is set by how many documents the
collection ALREADY holds — the collection is re-indexed per call — so writing a
package a piece at a time is quadratic in the library being built, and visibly
slowed as the classes went by. Rebuilding every class's packages from scratch
took 618s; it takes 184s, and ends with the same 1,353 documents and 168
bundles.

**Deferral is within one ROW, deliberately.** `worldGear()` and
`worldAbilities()` find parts an earlier row already made, so the buffer must be
flushed before the next row reads them. Two entries on ONE row naming the same
thing are deduplicated by name key inside `writeRow`, which is the case an
immediate create used to handle for free.

**Cost:** a batch that fails takes its row with it, so `writeRow` falls back to
writing that row singly and says so.

## 2026-08-24 — a class row in a compendium still builds its package

**Ruled: `materializeTemplates` accepts a pack class document.** It used to
return empty for any class with a `pack`, reasoning that the registry never read
a compendium class. That reason expired twice over: `lib/library.mjs` (4.19.0)
made every registry read span the sidebar AND acks-importer's packs, and
acks-importer 3.0.0 moved every imported class into a pack — so the guard turned
template packages into a permanent no-op for precisely the classes that ship
with them. `importTemplatePackages()` reported "0 created" on a world holding 21
classes with template rows, and said nothing about why.

**What did NOT change is where the package lands.** Bundles, their skinned gear
and the per-class table are created in the WORLD, because a package exists to be
repaired and a Judge repairs nothing inside a compendium. `defaultFolder` files
them under `Class Templates / <Class>`; a caller supplying `folder` must supply
a world folder, which is the matching fix acks-importer 3.0.0 made on its side —
it had been passing the id of a folder it created in the pack, so every bundle
and every piece of gear was created pointing at a folder the sidebar does not
have.

**Cost:** the class row and its package now live in different places. That is
what the repairability rule already implied; the guard was hiding it.

## 2026-08-22 — a class's training is copied to the character, because transfer cannot reach one

**Evidence.** A Mage wearing full plate reported as proficient with it, and no
character has ever been untrained with a weapon or a fighting style. The class
document carried the right effect all along — `armourProficiency=unarmored`,
`weaponProf=club,dagger,dart,staff` — with `transfer: true` on it, which does
nothing here: a character does not OWN the class document. The class is recorded
as a name and a ledger flag while the world item stays in the directory, so the
effect sat where nothing read it, for every class in every world.

**Ruled:** `applyClass` copies the class's effects onto the ACTOR, stamped
`flags["acks-extras"].fromClass`. Copies, not links — a character's proficiency
is theirs, and editing a class afterwards must not silently retrain everyone who
ever took it; re-applying is how a Judge asks for that. The stamp is what a
re-apply deletes, so applying a second class removes the first one's training
instead of leaving a character trained by both, and a Judge's own effects are
never touched.

A class stating no training writes nothing, and the character stays
unrestricted — which is what an unstated training means.

## 2026-08-22 — a class's mutually exclusive options are PATHS, and a starting template is one

**Evidence.** The Barbarian's combat training does not exist as a sentence. Its
spread prints a grid — Region | Armor Proficiencies | Weapon Proficiencies, with
a row per region — so the class has no single answer to "what armour may it
wear", and the twelve-class training audit could never have fixed it by reading
prose harder. The Zaharan's dark paths and the dwarven castes have the same
shape, and the template schema has been half-recording it all along: a row
carries an `annotation` ("Jutland") and a `caste`, with nothing reading either.

**Ruled (user):** the concept is generalized rather than special-cased. A class
carries **paths** — named groups of MUTUALLY EXCLUSIVE options — and a group's
option may differ in anything the class states per option, training first.
Starting templates become one such group rather than a parallel mechanism.

    system.paths: [{ key: "region", label: "Region", options: [{ key: "jutland", … }] }]

**Ruled (user): the word is "paths", not "variants".** `acks-extras.variation`
already means an EQUIPMENT difference — a sword's qualities — and the docs
doctrine allows one feature-slug vocabulary and no synonyms. Two meanings of
"variant" in one module is the collision that rule exists to prevent, and the
books' own "dark path" language makes `path` the natural word for the rest.

**Ruled (user): templates join the group BY REFERENCE, and are not moved.** A
world that upgrades keeps `system.templates[]`, its bundle documents and its 3d6
RollTable exactly where 4.14.0 put them; the group points at that array rather
than absorbing it. Nothing is rewritten, so there is nothing for an existing
world to survive — which is the right trade for a feature four versions old,
where the alternative is a migration standing between a player and their
starting kit. Fully folding templates into the group is recorded in ROADMAP as
the later move, deliberately not taken now.

**Not a chooser of its own.** `lib/choice-spec.mjs` is already the family's one
"choose N from …" primitive and every pick reduces to it; a path group is that
shape at class scope, not a second one.

## 2026-08-21 — a ref answers with the definition, never a class's own copy of it

**New evidence** (a third cause under yesterday's entry below, which found two).
A field report showed a template's "Polished sword" on a character sheet as a
plain `item`. The world audit behind it found something the two known causes do
not explain: **1277 of 1624 materialized gear documents carried the importer's
own `cookbook.id`**, inherited wholesale by `toObject()` from the base they
skin. `findByRef` answers with the first document carrying a ref, so a lookup
for `def.weapon.staff` could return one template's *aged and dusty staff*, and
the next template would skin itself over that — a cosmetic copy standing in as
the base item, and the same hazard for every other `findByRef` consumer in this
subsystem (grants, languages, the class sheet).

**Ruled:** a document carrying `flags["acks-extras"].templatePart` never answers
a cookbook-id lookup. Identity is the flag, never the name, so a Judge who
renames a part loses nothing; a `uuid:` ref is left alone, because it names one
document on purpose and a bundle row pointing at a part is asking for that part.
The flag key moves to `constants.mjs` (`FLAG_TEMPLATE_PART`) so `registry.mjs`
can read it without importing `template-packages.mjs` back.

**Ruled:** a skin does not carry the importer's claim at all — `buildGearData`
strips it, because what the copy IS is already recorded on its own `skin` flag.
That fixes it at the source; the `findByRef` guard covers the worlds already
holding mis-stamped copies.

## 2026-08-21 — a template item carries the price its page printed for it

**Evidence:** of the printed descriptors that resolve to no catalogue row at
all — correctly, because the shop list has no entry for them — 18 are PRICED in
the cell that names them. The gear arrived with that number dropped, so the one
value the page ever gave the item was gone.

**Ruled:** `templateItem` gains a `cost`, and `buildGearData` writes it to
`system.cost` on every path — over a base's own price where there is a base,
because a cell that prices a staff at 45gp is describing the gemstone on that
one. `upgradeUnresolved` carries it across a repair rather than letting a
replacement built from a base arrive priced as the plain version. The number
comes off the reader's page through acks-importer, like every other value.

## 2026-08-21 — the catalogue's naming conventions are read here too

**Evidence:** the repair pass (`upgradeUnresolved`) re-matches a bare document
by its printed DESCRIPTOR alone — no ref survives on it — so it is the one path
that depends entirely on `bestBaseMatch`. Against a world's imported items it
could not find "1 week's iron rations", because the price list calls that row
"Rations, Iron".

**Ruled:** every candidate name is matched in each form its own catalogue
prints it in — the comma rotated back, slash alternatives expanded
("Waterskin/Wineskin") — the same rules ACKS Importer applies when it resolves
a descriptor against the equipment menu, and pinned to it by comment in both
files. The head of a qualified name is deliberately not a form: "Sandals/Shoes,
Leather, High" must not answer for a bare "sandals", which is another row's own
name.

## 2026-08-21 — a short base name is a whole word, and a plural is part of it

**Evidence:** the same audit. "Torches" (21 documents), "Darts" and "Swords"
resolved to nothing and arrived as trinkets with no damage on them, because
`bestBaseMatch`'s word-boundary escape for 4–5 letter names required the base to
end where the descriptor's word ends.

**Ruled:** the word-boundary test accepts a trailing plural (`(?:e?s)?`) — a
cell prints what the character carries, not what the catalogue calls it. Seams
inside a multi-word name are `\s*`, never `\s+`: real extraction welds words
together. ACKS Importer applies the same rule when it resolves a printed
descriptor against its equipment menu; the two are pinned to each other by
comment in both files, because a descriptor that resolves to one base there and
skins itself over another one here is exactly the confusion this fixes.

## 2026-08-20 — a package resolves through the IMPORTS, and mints what it cannot find

**The minting half was superseded 2026-08-24** (`lib/DECISIONS.md`) on measured
evidence: placeholders for UNRESOLVED names were removed, and nothing in
`scripts/` sets `unresolved: true` any more. The resolution half — a package
reads the imports, not the system's shipped compendium — still stands. A
placeholder for a pick the player OWES is a different thing, ruled 2026-08-29
above.

**New evidence** (amending yesterday's entry below, which rejected placeholder
minting): the first field run produced packages with **no proficiencies at
all**, nothing openable to edit, and nothing landing on the character. One
cause under all three symptoms — acks-importer can be configured to import
into a **compendium pack** rather than the world (`packFor`), and every
resolver this feature used (`findByRef`, `resolveBase`) reads `game.items`
alone. In such a world no ability ref and no gear base can resolve, so every
proficiency stayed as text on the class row and every base item fell through
to a bare `item`. That is also a second, independent cause of the staff bug
the whole feature was built for: the short-name defect was real, but a
compendium-mode world would have produced the same un-wieldable staff with
the resolver fixed.

**Ruled:** materialization resolves **world first, then the IMPORTS held in a
pack** — `findSource` (ref via the importer's stamp in the pack index, then
exact name) and `resolveBaseDoc` (the same fuzzy base match run over the
index). A pack document is **copied into the world**, never linked: a locked
compendium document is precisely what a Judge cannot repair, and repairability
is the entire point. A proficiency the world already defines is still linked,
not copied — one shared document, no duplicate Adventuring per band.

**Ruled (user): the imports, never the system's shipped compendium.** Only a
**world-level** Item pack whose index actually carries the importer's stamp is
a source (`importPacks`) — which is exactly what the importer's compendium
mode creates. A shipped "Staff" carries the SYSTEM's values, so pulling one
would put content into a template that the reader's own book never supplied;
extras already treats imported documents as superseding the shipped packs
(`hideSupersededPacks`), and this is that same rule at the resolution layer.
A world with nothing imported therefore mints placeholders — which is the
honest answer, and tells the Judge what to import.

**Ruled, reversing yesterday:** a proficiency nothing can define yet is
**minted as a placeholder** — the printed name, an empty system, flagged
`unresolved` — rather than left on the row. Yesterday's argument (a
mechanically empty proficiency that looks real is worse than a visible gap)
was answered by the field: the gap was NOT visible. An entry on the class row
is invisible on the character, cannot be dragged, retyped, or replaced, and
silently vanishes from what the template hands over — which is the failure
this container shape exists to end. A placeholder is a document with a name
and nothing else; it ships no rules text, so the IP line is untouched.

**Second chances:** `upgradeUnresolved` runs before any row is read — a
placeholder or bare item that the world can now answer for is REPLACED (not
retyped: the item's `type` is what must change), every bundle row pointing at
it repointed, and the old document deleted. An edited placeholder is a
Judge's work and is skipped and reported.

**Ruled (user): a package never consumes its own contents, and it supersedes
the row.** Two halves of one shape. The item library is a SOURCE — a template
naming a sword copies the imported Sword and leaves it in place, and a
proficiency the world defines is linked, so deleting a package can never
subtract from what was imported (every deletion is gated on this module's own
`templatePart` stamp). And where a package exists it is the authority: the
per-row entry editors that used to be the only implementation are superseded
by it, hidden on the sheet behind the package block, and what the package
carries no longer applies from the row.

**Single ownership stands, and is what makes this safe.** Materializing still
strips from the row exactly what the bundle carries — but the removal is
per-entry and evidence-based (`stripRepresented`), so anything the package
could not carry stays printed and keeps applying the old way. The transient
reversal of that rule during this session was wrong: the fault was never
single ownership, it was that resolution filled the bundle less completely
than the printed path did, which is what the rulings above repair.
`detachTemplatePackages` exists regardless — adding containers must not be a
one-way door.

**Cost:** a compendium-only definition now exists twice — once in the pack,
once as the world copy the package links. Accepted: the copy is the
repairable one, it carries the importer's stamp so `ownsRef` and dedupe still
recognise it, and a world that later imports the definition properly gets it
linked by the same stamp.

## 2026-08-19 — a template is a bundle of repairable documents, in a table on the class

Reported from the field: the Wonderworker Messiah's staff arrives as a bare
`item` and cannot be wielded. Root cause was in `resolveBase` — no exact-match
branch, so any base whose folded name is under six characters (staff, spear,
mace, sword, sling…) could NEVER resolve and every skin over one landed as an
unwieldable `type: "item"`. And even once resolved correctly, there was
nothing a Judge could repair in one place: template contents were data rows on
the class, re-skinned per character at grant time, so a mis-typed item had to
be fixed on every generated character or by re-import.

**Ruled (user):** each template becomes a container of its abilities and items
— real, independent, GM-repairable world documents — linked from a RollTable
attached to the class. Realized as core's own `bundle` Item type (reuse over
invention: core's actor sheet already explodes one on drop; no new sub-type,
no `documentTypes` change, no world relaunch) holding uuid links; the 3d6
RollTable is a generated view that nothing reads. Repair the bundle's staff
once — every future character gets a weapon. Mechanics, ownership and the
apply path are [MODEL.md](MODEL.md) § Template packages.

**Also ruled:** `resolveBase` gains the exact-fold branch at any length and
word-boundary containment for 4–5-character names (bare substring stays
banned — "grimace" must not find Mace); the shortfall positions ("last
proficiency, second spell") read the bundle's own order; a Judge's money item
in a bundle IS the coin and overrides the row's `gp`/`sp` — silently ignoring
a document a Judge deliberately added is the failure this design removes.

**Rejected:** a new `acks-extras.template` Item sub-type (invents what core
ships, collides with the `acks-extras.template` ACTOR sub-type name, forces a
world relaunch); a folder per template (no quantity, no order, not droppable,
not linkable from a table result); the RollTable as band authority (chargen's
refresh is synchronous, and the at-or-below rule cannot live in a table);
contents kept on the row AND in the bundle (the exact two-authorities drift
this exists to end — materialized entries are stripped from the row, and
`stripRepresented` re-strips after an importer Update rewrites `system`);
minting placeholder abilities for unresolved names (an empty proficiency that
looks real is worse than a visible gap).

**Cost:** the class document alone no longer describes a materialized
template's contents — deleting a bundle loses them (the row then falls back
to whatever entries never resolved, or nothing). Accepted: the bundle is the
single owner, and `Build packages` rebuilds from any still-full rows.

Reported from the field: applying a class to a played character offered, for
each choice award, only proficiencies they did **not** already have. The rung
had no truthful answer, so the way through it was to pick something unwanted
and delete it from the sheet afterwards.

The filter was deliberate and it was wrong. It read "do not offer what would
grant nothing" — but a rung's answer and a rung's grant are two different
things, and only the grant was ever in question. `grantAbility` has always
declined to double what `ownsRef` recognises, so an owned option was already
safe to offer; removing it protected nothing and cost the player the only
honest answer they had.

**Ruled:** an option the character holds is shown, marked and grouped first,
and selecting it closes the rung without granting. Beside the options sit
*already covered* — for the proficiency that came from somewhere this rung
never listed — and *leave open*, which is the one answer that closes nothing.
`picks.mjs` owns all of it, and `grantsFrom` / `closesRung` keep the two
questions apart in code as well as in the UI.

**Rejected:** a blanket "already assigned" checkbox for the whole apply. It
answers every rung at once with no record of which proficiency answered which,
so the next apply has nothing to reason from — and a character who genuinely
owed one of five picks would silently lose it.

**Cost:** a rung can now be closed by a claim rather than by a grant, so
`awardsTaken` records an assertion the module cannot verify. That is the right
trade — the alternative was a fictitious item on the sheet — but a Judge who
wants the rung asked again has to clear the flag, and nothing in the UI does
that yet ([ROADMAP.md](ROADMAP.md)).

## 2026-08-15 — three pickers were one question

The same field report named the cause: the class picker, the level-up wizard
and the Scores Generator each built their own `<select>` for a choice award.
Three copies drifted, exactly as three copies do — only one considered what the
character owned (by deleting those options, above), only one offered starting
packages, only one counted the Intellect bonus. A player met a different, worse
version of the same question depending on which door they came through.

**Ruled:** one control (`picks.mjs`), one set of boxes (`panels.mjs`), and the
picker rebuilt as the Scores Generator's own layout with the attribute column
replaced by the level being set and the ladder picks that come with it
(`assign-app.mjs`). `optionsForChoice` has exactly one caller now, and a test
fails if a fourth surface grows its own.

**Also ruled — the question the 2026-08-14 deferral left open.** A starting
package is now offered when the picker binds a class, which was deferred
because `applyChargen` WIPES the actor's items and a character bound from
their sheet may already own gear. Replace / merge / refuse is settled as
**merge, opt-in, never wipe**: the package defaults to none, and when one is
chosen it goes through `applyTemplate` — chargen's merging half — and the
panel says in as many words that it adds. Generating a character replaces the
last run of the page because that is what generating means; binding a class to
a played character is the opposite act and must not borrow its destructiveness.

**Cost:** `applyTemplate` grants a printed rank as N copies by design, so a
package added to a character who already holds its proficiencies doubles them.
That is why the package is opt-in and says so rather than being applied by
default. Deduping it would break the rank-N convention the family relies on
elsewhere, so it was not done here.

**Rejected:** re-opening the real Scores Generator for an existing character.
The system offers that page only while `system.isNew`, and the module's own way
back to it (`reopen-chargen.mjs`) is destructive by design and confirmed as
such. Binding a class must not require making a played character new again.

## 2026-08-15 — a language is the system's document, not our private string

The system owns a `language` item type and has since before this module: it
declares the type, gives it an icon and a details template, files it in its own
section of the character sheet, and reads it in the Polyglot provider it
registers at startup, whose `getUserLanguages` scans an actor for
`type === "language"` and looks at nothing else.

This module recorded a known tongue as a `{name, uuid}` pair inside a
`languageSlots` flag on an ability. Not a document of the wrong type — **not a
document at all**, so a character who spoke six languages was invisible to the
sheet section and to Polyglot alike. The abilities DECISIONS entry of 2026-08-14
already described a tongue as "a document in a slot carrier"; the intent was
right and the implementation never matched it, which is why this is a defect
and not a design change.

**Ruled: the document is the truth, and the carrier keeps only what the system
cannot say.** Granted tongues are `language` items on the actor. The open-slot
carrier survives because "may still choose two more" has no representation in
the system and the rules require it — an Intellect bonus may be left open and
filled during play. It records `capacity` and the ids of the languages chosen
against it; `entries` is gone.

**Ruled: the carrier reads its slots back through the documents.** A recorded
id whose item no longer exists is simply absent, so deleting a language off the
sheet frees its slot with nothing to reconcile. The alternative — mirroring
names into the flag and keeping both in step — is two sources of truth for one
fact, and the drift is one-directional and silent.

**Ruled: find before minting.** A granted name is looked for on the actor, then
among the world's languages, then in the system's compendium, and only built
when nothing answers. A class's `languages.granted` is a ref list whose sheet
field is free text, so an entry may be a name or a ref; both resolve. Before
this, a class naming a language the world already held gave the character a
bare namesake of it.

**Ruled: capacity never shrinks below what was spent.** A character whose
Intellect fell does not un-learn a language they chose while it was high.

**Rejected: registering our own Polyglot provider.** Polyglot's
`defaultProvider()` prefers a `system.*` registration over a `module.*` one, so
ours would sit unused until a GM found the setting and picked it. Feeding the
system's provider is both the working answer and the one reuse-before-invent
asks for. The one thing left to add is the world's imported languages, which
the system's provider cannot know about — it builds its list from its own
compendium ([lib](../lib/DECISIONS.md) owns that bridge).

**Cost:** a world's existing carriers and imported language abilities must
convert, which `language-migration.mjs` does at `ready`, GM-only and
idempotent. The "Tongues" carrier is retired outright — everything it held is a
document now — so the v4.1.0 gallery shot of it no longer describes the sheet.

## 2026-08-14 — Chargen rolls the hit die it was assumed to have already rolled

The Scores Generator produced characters whose hit points were never rolled at
all. `applyChargen` called `applyClass` without `rebuildVitals`, which defaults
to false, so no die was thrown, Constitution was never applied and the per-die
floor never ran. A generated character kept whatever the bare actor was created
with — the same number every time, whatever their class die or Constitution.

The 2026-08-06 entry below is **superseded in its chargen half**. It recorded
that "chargen builds its own 1st level … rebuilding underneath either would
discard a roll the player watched". That holds for the level-up wizard, which
does roll its own die. It was never true of chargen, which rolls none: the
page's `roll` is the 3d6 that picks a template, not a hit die. The protection
was written for a roll that did not exist, and cost every generated character
their hit points.

Chargen now asks for the same rebuild the picker does. At first level that is
one roll of the class's own die with Constitution applied per die and its floor
of one; experience is left alone, because the level has not moved.

Not migrated, per the standing rule — a character already generated is repaired
by generating again, or by applying their class from the picker.

## 2026-08-14 — A level set is a level owed: applying a class grants its ladder

Binding a class granted **no abilities at all**. `applyClass` wrote the printed
numbers and (for the picker) rebuilt hit points and experience; `grantAbility`
had exactly two callers, and neither was on that path — chargen granted a 1st
level on the Scores Generator, and the level-up wizard granted the single rung
it was climbing. So a character bound at 5th stood there with a 5th-level
attack throw, 5th-level saves, 5th-level hit points and not one class power,
not one proficiency, not even Adventuring. A character bound at 1st got the
same nothing, which is the case that was reported.

Ruled: the 2026-08-06 reading already decided this — the picker SETS a level
rather than earning one, "so it rebuilds what that level implies". Abilities
are as implied by a level as hit points are. `{grantAwards: true}` on the two
paths that set a level hands over every award AT OR BELOW it.

**Every rung, not the last one.** A ladder read as "the awards at level N" is
the level-up wizard's question, because a level is earned one at a time. The
question a set level asks is what a character who HOLDS 5th has taken, and the
printed spread answers all five rungs.

**The choices are asked in the apply dialog**, not deferred. The level-up
wizard only ever offers the rung it is climbing, so a pick owed at 2nd is
unreachable forever once a character stands at 5th — deferring would have left
the character permanently short in a way no surface could repair.

**The dialog opens for abilities alone.** It used to be skipped when no printed
number changed, which would have made re-applying — the one way an
already-bound character collects what they were owed — silently do nothing.

**An owned copy is not the world item, and the dedupe never knew it.** Found by
live-testing the re-apply above: `ownsRef` matched a `uuid:` ref against the
owned item's own uuid, which is an embedded id and can never equal the world
item's — so every hand-made (uuid-ref) ability was granted again on every pass,
and the repair path this ruling creates doubled Adventuring and the first-level
power. Recognition now runs importer stamp → a `grantedFrom` stamp written at
grant time → the source's name, the same name-matching that already identified
a world's hand-made Adventuring. The importer-stamped path was always sound,
which is why level-up and chargen never showed it.

**A choice rung answered is remembered** (`awardsTaken` on the class flag), so
re-applying adds what is missing instead of asking every question again. Keyed
by ladder position and level: a Judge who reorders a ladder afterwards may be
asked a rung a second time, and the options a character already holds are
filtered out either way, so the cost is a question rather than a duplicate.

**Not migrated**, per the standing rule against dev-cycle migrations: existing
characters are repaired by applying their class again, which the guide now
says, rather than by a sweep that writes items onto player-owned actors.

## 2026-08-12 — Import makes the examples: builds stamped, races materialized

Ruled (user): the JJ import must leave WORKING examples — after the table
import, the twelve RR classes (seven-plus-one core humans and the four
demi-humans) carry their printed Ready-for-Play build as advanced-mode
state, bound to materialized `def.race.dwarf` / `def.race.elf` documents,
and derive reproduces each class's own printed spread. Live-verified exact
on Fighter (2,000 → 250,000 XP) and Elven Spellsword (4,000 → 430,000 XP,
cap 10, the L5 slot row equal to the printed grid). The rest of the JJ
roster and races is ROADMAP by the same ruling ("just the core classes and
the demihumans for now").

**The saves chassis ignores the racial value** — JJ p301 is explicit
("not used … even when the Racial Value stacks"), and the first live derive
caught the engine counting elf stacking toward saves (mage instead of the
spellsword's printed fighter). Casting stacking and saves independence are
now separate paths, tested.

**The build paragraphs' trade-offs stay prose.** The Ready-for-Play text
names each class's trade-offs in sentences ("Armor selection is reduced to
Broad for one class power"); parsing those into elections is a judgment the
binding does not make. The paragraph lands whole in `builder.notes` and the
Judge ticks the trade-off boxes with the source in view.

## 2026-08-11 — The builder IS automated: advanced mode derives the spread

Ruled (user), superseding 2026-08-05 "…and is not automated": the class
document gains an advanced mode that emulates the Judges Journal's builder
workflow — build values in (Hit Die, Fighting, Thievery, magic values,
Racial), the printed-spread fields out (XP schedule, hit die, max level,
attack bands, saves-as chassis, cleaves, casting grids, racial traits).

**Derivation writes the simple-mode fields; nothing downstream reads builder
state.** applyClass, level-up, chargen and the registry see one document
shape, so an imported simple-mode class and a derived one are
indistinguishable to every consumer — and the builder's output stays
hand-editable afterwards, which is the same review-and-tweak workflow the
constructor sheet already rules.

**Every number is imported, none ships.** The engine
([builder-logic.mjs](../../scripts/classes/builder-logic.mjs)) is structure
only; the JJ builder tables (category XP costs, the attack-throw grid, magic
value ladders and fractions, trade-off yields, power costs) reach a world as
the `acks.classBuilder` ruledata document — an acks-importer cookbook recipe
from the GM's own book, or a hand-authored OVERRIDE layer. A missing table
degrades to a named issue on the plan, never a shipped fallback. What IS code
is the arrangement the spreads share: thresholds double to 8th then climb by
a flat rounded increment, halves round up on scaled spell slots, the largest
category decides the saves chassis.

**Rejected: deriving on every builder edit.** The derive is an explicit
action with a shown plan (what will be written, what the tables left open) —
a silent write under submitOnChange would clobber hand tweaks on every
keystroke.

## 2026-08-11 — Race is an Item sub-type; the ladder lives on the race

Ruled (user): a race is a document (`acks-extras.race`), not rows in a global
table — its racial-value ladder (per-rung XP cost, level cap, granted
powers), attribute minimums and always-on traits are the race's own, filled
by acks-importer (`def.race.<key>`) or typed by hand, exactly like classes.
The builder spends the ladder of the race the class binds (`system.race`);
a SIMPLE-mode imported class may bind the same ref so its racial traits
resolve from the race document instead of being restated per class — the
existing demi-human classes benefit without entering advanced mode.

## 2026-08-11 — Magic values are an open, data-defined set

Ruled (user): magic build categories are not two columns. Arcane and divine
are merely the first rows of the `magicTypes` table; ceremonial, gnostic,
alchemy, eldritch, fairie and any later or homebrew tradition are rows of
the same shape (value ladder with costs and fractions, casting kind,
repertoire, saves-as, progenitor grid). The class document stores magic
values as a typed LIST keyed by those row names; no enum in code closes the
set. The casting-kind vocabulary (vancian, points, ritual, ceremonial,
gnosis) stays a code enum because it names MECHANISMS the module implements,
not content.

## 2026-08-07 — A package pays its own coin; only a package-less build rolls for it

Ruled (user): the gold row is not rolled and not rollable while a starting
package governs the character — the package prints what they begin with, so a
die beside it is the same decoration the template die used to be. The one case
the book has a character roll for their own money is the Judges Journal's
template-less option (JJ Ch. 16: "the players roll 3d6 × 10"), which is core's
own gold formula, so nothing new throws dice.

**Building without a package is a Judge's option**, reachable only under the
override: no equipment and no spellbook, and every level-1 choice asked rather
than answered by a printed list.

**Templates pay in the coin they print.** The document had `gp` alone, and five
RR templates print silver — three of them ONLY silver, so a proselytizer, a
priest and a tribal warrior began play with an empty purse. `sp` joins `gp` on
the template, and each lands in the money item of that name because that name is
the only handle the system's `manageMoney` has on a purse. Not migrated: a class
document carries no silver until it is imported again, which is the honest
state — the value is one acks-importer reads off the page, and extras ships no
value read off a page.

## 2026-08-07 — The page is three columns, and it enforces the campaign's dice

Ruled (user): the attributes and the rule they are rolled under stand in the
first column, the class above the template die in the second, and what is left
to choose with the summary and the coin in the third. Core's own template row is
MOVED rather than duplicated — a die that means nothing until a class is chosen
belongs beneath the class it answers to, and two surfaces asking the same
question is how this feature's first version went wrong (below).

The generation rule is a campaign setting, not a per-character one, so the world
holds it and every player's page obeys it. `standard` is held as an ALLOWANCE
rather than a fixed order: RR Ch. 1 §I.2 says "pick one attribute … pick a second
and third", so which attribute gets the good dice is the player's choice and only
the counts are the rule's. The Judges Journal options (JJ Ch. 16) are one formula
for every attribute.

**A raised score re-derives its modifier from the actor, not from a table.** The
system's modifier table is not exposed, and no repo in this family ships a value
read off a page — so a detached clone of the actor is asked
(`computeModifiers`), and a blank box is the honest fallback if that fails.

**Rejected: leaving core's three dice buttons unconditional and explaining the
rule in a hint.** The page already had every formula on every row with no limit,
which is what let a character be rolled six times on 5d6 without anyone noticing.

## 2026-08-07 — A starting template answers the level-1 proficiency picks

RR Ch. 2: a template arrives "with weapons, armor, equipment, proficiencies, and
spells ready for play", and §II.1 spends the Intellect bonus "on top of those
listed for the template". The page had been asking for the class proficiency and
the general proficiency beside the template that already printed them, so every
generated character began with two proficiencies the book never gave them — and
the general dropdown defaulted to the first name alphabetically, which is
Adventuring, which RR Ch. 3 §III.4 gives everybody for free anyway.

Ruled: a level-1 choice drawing on the class inventory or the general list is
the template's to make, and the page shows what the package brings instead of
asking. A choice among NAMED alternatives — a warlock's dark path, a witch's
tradition, an earthforger's sigil — is not a proficiency a template lists, so it
is still offered. Adventuring is granted with the class and never offered as a
pick, at chargen and at level-up alike.

**Not migrated.** A character generated before this keeps the two proficiencies
they were handed; nothing rewrites existing characters, and a silent sweep over
player-owned items to take abilities away is worse than the surplus.

## 2026-08-07 — An unrolled score disqualifies nothing

The class filter read a score that had not been rolled as zero, which is below
every printed minimum — so before a single die was thrown every class with a
requirement was withheld, and the page said nothing about having withheld them.
The list looked unfiltered because what remained was exactly the classes the
book gives no requirement.

Ruled: absence is unknown, not failure — the same way an unrolled template die
legalises no package rather than disqualifying every one. A class leaves the
list when a score contradicts it, not before.

## 2026-08-07 — One Judge unlock, remembered on the Judge

Two checkboxes governed two halves of the same authority. Ruled (user): one
control for the whole page — every class, every template, and the rolled fields
editable by hand — remembered so it comes back the next time that Judge opens
the page.

Remembered as a flag on the user document rather than a registered setting:
there is nothing for a settings panel to configure, the control is GM-only, and
an absent flag reads exactly as today's default.

The derived boxes stay locked. The summary statistics are recomputed from the
scores; a score's modifier box is a path UNDER a field that submits, so freeing
it would put both into the form data core expands.

**Generating a character replaces the last attempt** (user ruling): a class
rerolled is a character rebuilt, not a character with two starting packages.
Under the unlock a second control adds instead of replacing, for the Judge who
means it.

## 2026-08-06 — Chargen lives on the Scores Generator, not in a window of its own

The system's Scores Generator already rolled the six attributes, a 3d6 template
die and starting gold — and discarded the template die on submit, its handler
writing only the scores and the gold. Meanwhile this module's chargen dialog
rolled its OWN template die. Two rolls decided one thing, and the one the
player watched was the one thrown away.

Ruled (user): the chargen surface moves onto that page. A class is chosen after
the scores are known and before the template is rolled; the template die is
read against the chosen class. The separate dialog is deleted, not kept as an
alternative — two entry points asking the same questions is how the two dice
came to disagree.

**Rejected: keeping the dialog and having it read the generator's die.** It
still leaves two surfaces to learn, and the die is only meaningful once a class
is chosen, which the dialog is where you do.

Cost: the surface is reachable only from a character the system considers new
(`system.isNew`, which core clears on the first update touching scores), so a
character generated by hand cannot return to it. Recorded in
[ROADMAP.md](ROADMAP.md).

## 2026-08-06 — Setting a level by hand rebuilds hit points and experience

Ruled (user): the picker SETS a level rather than earning one, so it rebuilds
what that level implies. Hit points are rolled from 1st level upward, each
level after the first following the level-up rule already recorded below.
Experience moves the shortest distance that agrees with the level — the floor
of the new band when raising, one short of the next when lowering — rather than
being zeroed or left contradicting the level beside it.

Only the picker and a dropped class ask for this (`rebuildVitals`). Chargen
builds its own 1st level and the level-up wizard has already rolled the die it
means to add; rebuilding underneath either would discard a roll the player
watched.

**Constitution applies per die, not to the total** (RR Ch. 1, Constitution: the
adjustment applies to each Hit Die and a penalty cannot reduce any of them
below 1). The level-up wizard had been applying it in bulk, which is the same
arithmetic only while Constitution is a bonus. Both now read one file.

## 2026-08-06 — Which classes are studious spellcasters comes from the book, not the document

RR Ch. 2 §II.1: the studious spellcasters' templates assume an Intellect of
13–15, carrying one bonus proficiency (listed last) and one bonus spell (listed
second). Chargen must not offer that bonus again, and must withhold both
entries from a character below the band.

Two structural derivations were tried against the world's 32 imported classes
and BOTH fail, which is why this is a stored field rather than a rule:

- **By repertoire kind** — `studious` names only the Dwarven Craftpriest and
  the Witch. Widening to include `arcaneInt` catches the other five and also
  the Warlock, which the book does not list.
- **By template shape** ("a studious template prints three proficiencies") —
  the studious classes print 2 AND 3 (Mage, Elven Spellsword, Zaharan
  Ruinguard), while plain classes print 3 and 4 (Venturer, Barbarian, Bard).
  The counts overlap in both directions.

Ruled: `templatesAssumeIntBonus` on the class document, filled by acks-importer
from the reader's own book, initial 0. A world that re-imports nothing keeps
today's behaviour exactly.

**Rejected: shipping the list of seven class names in extras.** It is a value
read off a page, which no repo in this family ships.

## 2026-08-05 — Class is an Item sub-type; the constructor is the only editor

Ruled: classes are `acks-extras.class` Items (module sub-type), owned by
extras; acks-importer materializes INTO this model and the dependency edge
stays one-directional. Rejected: a JournalEntry+flags blob (no typed fields,
no validation), an Actor sub-type (token/sheet semantics a class does not
have), extending the system's free-text `details.class` alone (nothing to
hold tables). Imported and hand-made classes share one sheet deliberately —
review-and-tweak and homebrew are the same workflow (user ruling: editable
constructor from v1, composition-first over primitives).

## 2026-08-05 — The JJ custom-class builder informs the model, and is not automated (SUPERSEDED 2026-08-11, above)

The Judges Journal's custom-class rules are how the printed spreads are
arranged under the hood — every class is category progressions (the four
chassis) plus trade-offs. That arrangement is why `saveChassis` /
`attackChassis` are the model's borrowing primitive. Ruled (user): the
builder itself is NOT automated — no build-point validation, no XP-cost
derivation; the document stores what the RR spread prints and the UI stays
RR-spread-simple.

## 2026-08-05 — Inventory accepts; it does not offer

Ruled (user): the constructor's inventory lists accept drops (and typed
refs). No catalogue picker of world abilities is offered by the sheet.

## 2026-08-05 — Book vocabulary in the document, released keys at the write

Save bands store `blast`/`spells` as printed. The one book→released mapping
(`blast`→`breath`, `spells`→`spell`, `wand` never written) lives in
lib/actor-compat.mjs `savesUpdateData`; extras also owns the repair pass for
dangling save-key references (user ruling). When the system releases its
breath→blast rename, that file is the single place that changes.

## 2026-08-05 — Level-up HP is RAW: reroll the full HD, minimum +1

Ruled (user): on gaining a level the full Hit Dice are rerolled and the new
maximum is at least one higher than the old; past 9th the printed flat bonus
applies with no CON adjustment. An additive-die house rule may be offered as
a setting, never as the default. (Consumed by the level-up wizard — ROADMAP.)

## 2026-08-05 — Casting is a typed framework from the start

Ruled (user): nothing deferred — the casting schema carries kind-typed
traditions (vancian, points, ritual, ceremonial, gnosis) and per-tradition
pools now, so By This Axe gnosis and Heroic Fantasy ceremonial content
materialize into the same fields; the Nobiran's dual pools are tracked fully
(implementation lands with the casting framework phase, on this schema).

## 2026-09-03 — The training editor reads the whole grant grammar, and expands only what it must

**Problem.** `grantedKeys` recognised class keys and `all`. The importer writes
most classes' weapon training as size and missile clauses —
`missile:all,melee:tiny,melee:small,melee:medium` — so the Class modifiers
section showed every weapon pill dark for a character whose Inventory strip
was lit end to end, and the first click on any pill rewrote the grant to that
one class key and threw the rest away.

**Ruled.** Pills light through `weaponTokenClasses`
(`lib/proficiency-strip.mjs`), the same resolver the strips read, so the two
surfaces cannot disagree about which classes a clause covers. Toggling ON
appends the class key and leaves the wider clauses as written. Toggling OFF
drops the tokens that grant the class alone — its key, or a weapon filed under
it — and only when a wider clause still covers the class is the grant expanded
to the explicit class list minus that one: the rule this record already had
for `all`, applied to every clause that cannot lose one class. A token nothing
recognises is kept as written through either edit.

*Cost, stated:* expanding a size clause widens it — melee up to medium becomes
every sword, two-handed included — because a class pill cannot say "swords of
medium size". Re-applying the class restores the printed clause. The abilities
side of the same change is [abilities](../abilities/DECISIONS.md), same date.
