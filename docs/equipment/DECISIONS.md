# Equipment & fighting styles — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

### What a weapon IS is declared, not read off its name (2026-09-07)

**Reported.** A Barbarian generated from the Jutland template was granted a
"Francisca" — a hand axe under the name its page prints — and the character
sheet marked it NON-PROFICIENT beside an axe-trained character. The same
screenshot carries the second half of the bug unremarked: a "Two-handed iron
sword" offering a two-handed row at a *smaller* die than its one-handed row.

**Cause.** `classifyWeapon` resolved the RAW table row from `item.name` and
nothing else — exact, then alias, then the longest catalogue name the name
CONTAINS. Everything downstream reads off that row: the proficiency category a
class grant is matched against, the Weapon Focus group, the damage type, the
size that sets hand cost. "Francisca" contains no catalogue name, so the item
fell to `cat: "other"` and matched no grant. "Two-handed iron sword" contains
`sword` but not `twohandedsword`, so it classified as the medium versatile
sword and offered that row's smaller two-handed die over its own.

The information was never missing. `buildGearData` records what a template
descriptor was skinned over — `flags.acks-extras.skin.{base,baseName}` — and
`bindWeaponRow` stamps every imported row with `cookbook.id`
(`def.weapon.handAxe`). Both were sitting on the document; only the name was
being read.

**Ruled: a declaration outranks an inference, and the name is an inference.**
`weaponIdentity` is the one place the row is decided, and it reports its own
provenance. Order: the `profileKey` flag, the mint id, the item's exact name,
the skinned base, the loose name match. The name keeps its exact-match rank —
"Silver Dagger" says more than the Dagger row it was cut from — and loses only
its *loose* rank to a recorded base, which is exactly the case that was wrong.

**Ruled: three declarations on the item sheet, not a repair tool beside it.**
The first design was a drag-and-drop window that copied attributes from a
known-good item onto a broken one. Rejected on user direction, and better so: a
copy tool answers "make this like that one" when the actual question is "what is
this", it produces a second item whose provenance is a gesture nobody recorded,
and it needs a donor to exist. The Construction panel now carries **Weapon
type**, **Size** and **Grips**, each with the panel's own Auto-shows-the-guess
shape, plus **Stowed at**. Every one of them writes a flag the resolver already
consults, so a Judge's answer and the importer's answer arrive by the same road.

**Ruled: grips are declarable, and are a capability, not a state.**
`flags.acks-extras.grips` is `1h` | `versatile` | `2h` and answers ahead of the
size derivation. It is not `ITEM_FLAGS.GRIP`, which is the grip a player has
chosen this round out of the ones the weapon offers. The older numeric `hands`
override is still read and is written by nothing; `grips` supersedes it.

**Ruled: unidentified is reported where it is made, not where it is felt.**
Three catches, because there are three places a weapon enters a world:
`importWeapons` warns for any grid row the module has no profile for,
`materializeTemplates` reports `unidentified` on the class sheet, and chargen
prints its own line on the character's card. A weapon with no row does not
throw and does not look broken — it rolls, it weighs, it is silently
category-`other` — so the only symptom without these is a proficiency badge
weeks later with no route back to its cause.

**Cost.** One new item flag (`profileKey`), one new declaration flag (`grips`),
and `annotateItem` now writes the resolved key rather than only the values
derived from it — the category has no flag of its own, so recording the
derivations alone left it being re-guessed from the name on every render.
Live-verified; see [TESTING.md](TESTING.md#weapon-identity).

**Not fixed by this.** The `WEAPONS` table is still a closed list, so a weapon
outside it can be declared no type at all. That list's retirement onto base type
+ item is already [ROADMAP.md](ROADMAP.md)'s.

---

### The module stops shipping a library of its own (2026-09-01)

User direction: there is to be no non-import library. Three packs went with it
here — `equipment-training` (34 class-training abilities), `equipment-proficiencies`
(42) and `equipment-samples` (9) — and `proficiencies-powers` (20) went from
henchmen. 105 documents, 92 of them carrying Active Effects. Nothing in
`scripts/` ever resolved a document out of any of them, so the removal is a
content decision and not a code one.

**What replaces each, measured rather than assumed.**

- **Training (34).** No cookbook entry matches any of them, and none is wanted:
  an imported class carries its combat training as one embedded Active Effect
  the importer writes, on the SAME three flag keys these items used
  (`weaponProf`, `armourProficiency`, `styleProficient`). The pack was the
  hand-assembly route to a fact the class now states itself.
- **Proficiencies (42).** All 42 have a cookbook entry. 15 of the 41 that carry
  this module's mechanical markers get them back as typed effect specs from the
  entry itself; 24 more reach the same effect domains through
  `abilities-bridge.mjs`, which resolves presence, numeric, style, martial,
  focus and trickery grants off the definition id.
- **Powers (20).** All 20 have an entry. 16 of the 19 carrying markers are
  recovered by `NAME_FALLBACKS`, which reads the mechanic off the item's own
  name precisely for items that arrive without an Active Effect.
- **Samples (9).** The six shield variants have entries. The three masterwork
  and named examples never could: they are module-authored demonstrations that
  a tier is expressible in fields core already has, not book content.

**The gaps this leaves, in full — three mechanics and one workflow:**

| Lost | Marker | Why nothing covers it |
| --- | --- | --- |
| Goblin-Slaying | `slayer` | no effect spec on its entry, and no `abilities-bridge` case |
| Vermin-Slaying | `slayer` | same |
| Inspire Courage | `moraleRoll` | no effect spec, and no `NAME_FALLBACKS` pattern |

And the workflow: a Judge building a class **by hand** no longer has ready-made
training items to drag onto it, because the replacement rides on the class
import. Hand-built classes set the three flags directly.

**Cost.** A world that imported from these packs keeps every document it made;
what disappears is the compendium row. The three mechanics above are named in
the importer's ROADMAP rather than fixed here — closing them means adding effect
specs to cookbook entries, which is extraction work, not a pack.

### Putting gear to use takes it out of the pack (2026-08-30)

**Problem.** The sheet's row controls attach to gear wherever it renders, and
once the Stowed section claimed a container's rows they attached there too. So a
sword inside a chest offered Draw, a cloak inside a pack offered Wear, and
core's own equip toggle sat on the same rows — each of them writing "in use"
onto an item that stayed inside the container. `wearLocation` answers
`containedIn` before anything else, so the sheet went on drawing the sword
inside the chest while the loadout, which reads `equipped`, spent a hand on it,
granted its attack and counted the shield beside it. The two halves of the
module described different characters. A lantern in a backpack could be lit.

**Ruled:** a thing is in the pack or in the hand, never both — the other half of
the rule `storeIn` has always kept from the stowing side, where an equipped item
is taken off as part of being put away. The seam is the UPDATE rather than the
control (`unstowOnUse`, patched into the pending write in `preUpdateItem`), so
one rule covers this module's controls, core's toggle and a macro alike, and the
gear leaves the container and enters use in a single document write with no
render of the halfway state.

**Rejected:** hiding Draw and Wear on stowed rows. It removes the incoherent
state by removing the gesture, leaves core's own toggle still able to produce it,
and answers a player reaching for their sword with a missing button. Two controls
*are* hidden, because they describe a position on the BODY and no write could
give them one inside a chest: the shield strap (hand / back / front), and the
light control, which names a light TYPE rather than the document under the
cursor and so cannot bring the right lantern out on its way.

**Rejected:** refusing to draw from a *locked* container. Reaching the contents
at all is already decided upstream — a locked container shows its rows to the
Judge alone, and the Judge is who opens it at the table. A second refusal there
would only contradict the Empty control standing beside it.

### Whether it is on comes before where it goes (2026-08-21)

**Problem.** A character wearing imported plate showed it under Worn & Wielded /
BODY with an AC of 0. Two stores answer "is this worn" — core's
`system.equipped` for armour and weapons, and this module's `gear.wornAt` for
everything core cannot speak for — and `isWorn` exists precisely so no caller
reads one alone. `wearLocation` read one alone: it returned a declared slot
before ever asking. Core's own equip toggle writes `equipped = false` and knows
nothing of the flag, so the moment a Judge unequips through core the two drift,
and the panel went on calling the armour worn on the strength of the stale half
while the loadout, which reads `equipped`, gave the character nothing. Worn and
wielded became a list of things doing nothing.

**Ruled:** the `isWorn` gate runs first, and a declaration only decides WHERE
something already worn sits. Swept every other reader of `wornSlotOf`/`wornAt`;
this was the only one bypassing the accessor.

### A declaration bounds where gear goes, not whether it can be put on (2026-08-21)

**Problem.** `setWorn` refused any slot the item did not declare — and every
IMPORTED armour and weapon arrives declaring nothing, because the annotate pass
is something a Judge runs and not a precondition. So an imported suit of armour
could not be worn at all through the wear model: the call returned false and
wrote nothing, silently.

**Ruled:** the refusal keeps its job — gear that declares nowhere to go cannot
be put somewhere — and loses the job it should never have had. A core-equippable
item answers through `equipped`, a boolean with no slot to be wrong about, so an
undeclared one is simply put on. Undeclared and non-equippable still refuses.

### A variation is a document, and applying it is putting it inside (2026-08-15)

> "the variation items that apply onto base items reusing inventory container
> logic" — owner

**Ruled:** a variation is an `acks-extras.variation` Item, applied by the
`containedIn` relation `containers.mjs` already uses for gear in a backpack.
The gesture, the listing, the removal and the nesting guard all come from a
relation that was already carrying weight; nothing new had to be invented for a
second kind of "inside".

**Superseding 4.10.0's flag list.** That release stored variations as
`{id, key, hidden, read, data}` objects in a flag, with their meanings looked up
in the ruledata register. It shipped as groundwork with no interface, and is
replaced whole rather than migrated: there was no way to create an entry except
through the API, and an entry is only a key — the definition it needed lived in
a register that no world had filled. Converting one would have produced an empty
document, which is worse than the honest absence.

**What the document changed about the model.** Definition and instance now live
in one object. A variation applied to a sword carries its own numbers, so
re-importing the register cannot revalue a blade a Judge already priced, and an
item exported to a world that imported nothing still reads correctly. `entryOf`
and `definitionFrom` split the two halves back out, so `variations.mjs` stays
Foundry-free and its rules are tested without a document.

**Rejected: `storeIn`.** The obvious reuse is the wrong one. That verb is about
cargo — it checks capacity, refuses through a shut lock, and unequips what it
stows. A variation goes on a sword the sword is wielding, weighs nothing, and is
refused for reasons of its own. It shares the flag and nothing else, and the
schema carries no `cost`/`weight6` so encumbrance never sees it and a Judge
cannot put one in a sack by mistake.

**Cost, stated plainly.** Containment resolves against a sibling collection, so
a compendium item holds nothing — importing one item does not bring its
variations. `siblingsOf` returns null there rather than an empty list, because
"none" and "cannot say" are different answers.

**The legacy flags own their families until the importer replaces them.**
`layerDeltas` sums both halves, so a masterwork flag and a masterwork variation
on one item would count masterwork twice. Applying into a family a flag already
holds is refused by name. This is a bridge with a stated end: it comes out when
`acks-importer` publishes masterwork, silver and the shield forms as documents.

---

### The equipment root: gear is a special class of item, and shares its root (2026-07-24)

> "Equipment is just a special class of item; they should share a root." — owner

Given only a NAME, `equipmentClass()` says which core item type a piece of gear
should become and the stats that type needs. A torch (a 1d4 light-weapon) and a
flask of military oil or holy water (thrown splash flasks) resolve as WEAPONS,
while a lantern or candle stays a plain light-bearing item.

**This feature owns that root, and it is the single source.** Consumers read it
rather than re-deriving the rules — including `acks-importer`, whose cookbook
binding classifies imported gear through it and falls back to the register's own
type when this module is absent. Matching is strict (exact or alias) so ordinary
gear is never reclassified by a loose substring hit.

A **torch is carried as a stack** — a bundle in a pack — and becomes a weapon
only when one is READIED (owner, 2026-07-25: "torches can just carry a stack").
So the root imports it as a quantity-bearing light item and records the weapon
stats the prepare step needs under `prepareAs`. It is the only weapon-table entry
tagged `light`.

---

### Ammunition does what RAW says and no more (2026-07-24)

Owner decision, against the temptation to automate recovery. RAW (RR): a missile
attack is "subject to available ammunition" (p304); a bundle of 20 arrows is ONE
inventory item (p144). The base rules give **no** automatic recovery percentage —
recovery is the Judge's call, and thrown weapons come back by being picked up.

- **Consume on use** — firing a launcher decrements its matching ammo; a
  stackable thrown weapon (a bundle of darts) decrements likewise.
- **Thrown state, not destruction** — a *single* thrown weapon (a hand axe, a
  lone javelin) is marked "thrown away", unequipped, and stops weighing on the
  carrier until recovered.
- **No retrieval automation** — recovery is a manual action; fired ammo is
  restocked by hand.

Consumption is a fire-and-forget side effect *after* the core roll, never
blocking or failing it.

---

### One canonical wear taxonomy (founding)

"Where is this gear?" was implied in three unrelated places — the Paper Doll slot
layout, the per-item flags, and the derived buckets in `getLoadout` — which could
disagree without anything noticing. Everything that groups gear by position now
resolves through `wear.mjs` against one key set: the ACKS character sheet, the
Paper Doll, and the loadout summary. Order is display order, head to foot then
off-body.

---

### Proficiency enforcement is a policy, and it is on by default

This feature infers proficiency from its own actor flags and effect markers — the
ones the ACKS Class Training compendium items set. Weapon and armour resolvers
stay **permissive** when an actor carries no such flags (no list ⇒ proficient),
so an unconfigured character is not punished. A trained fighting **style**,
however, is required to use any weapon at all (RR p.106), so a weapon-wielding
character with no Class-Training style item reads as non-proficient once
enforcement is on.

`proficiencyEnforcement` selects: `on` (default), `auto` (enforce only while the
abilities feature is absent — the pre-merge default, kept for worlds whose
characters rely on the abilities model), `off`.

Scope is the **penalties** (the RR p.106 non-proficient package), not the
feature. Equip limits, containers, wear buckets, the loadout effect and bridged
ability bonuses are unaffected.

---

### Container sections always render (bug-driven)

The container UI used to return null unless a row had actually been moved into a
bucket. That deadlocked the whole feature: a container you had just created was
empty, so its section vanished — taking the bucket, its controls, its drop zone
and the button that creates containers with it. The only way to fill a container
is to drop onto its bucket, so a container that hides until it is non-empty can
never become non-empty.

A bucket is content whether or not anything is in it. "Has anything moved?" was
never the right question.

---

### Our controls get their own box in the inventory row

Core's control column is fixed-width — `.controls { 60px }` for armour, 35px for
an item, neither growing — so anything added there overflowed it. The grip,
draw/sheathe, strap, light and ready controls sit in their own auto-sized box
beside core's rather than inside it, scoped so rows this feature never claims
keep core's layout untouched.

The rows themselves are **moved, not rebuilt**: core's own `<li>` elements are
relocated into the buckets, so every core control on them keeps working and
nothing is re-templated, cloned or corrupted.

---

### The Container Manager popout is retired

It existed because there was nowhere else to put container controls. There is
now: the container sits on the equipment tab next to the gear it holds, and
opening it there is the same gesture as opening it at the table.

---

### Shields cancel rather than fight core (JJ variants)

Where RAW says a shield variant gives nothing, this feature contributes a
*negative correction* to `system.aac.mod` to cancel core's bonus, rather than
trying to prevent core from applying it. A shield strapped on the back protects
only the rear, which is situational rather than ordinary AC.

Mounted use is no longer blocked outright: the lib subsystem records who is riding what,
and whether to protect self or mount is a player's decision each round rather
than a derivable fact.

---

### Named-item rungs advance on level-up, not absolute level

An item does not leap forward because a high-level character picked it up. Rungs
unlock per level *gained* while wielding it. Application is idempotent: every
application recomputes from the BASE rather than adding to the current value.

Renaming is a state edit, not automation, so it is never gated on the overlay
setting — gating it there made renaming impossible whenever the overlay was off.

---

### Gear declares where it sits; the heuristics are only a fallback (2026-08-03)

"Where is this gear?" used to be reconstructed on every call from type, flags and
**item names** — `/helm/i` was written out four separate times, cloaks were
`/cloak|cape/i`, gloves `/\bglove|gauntlet/i`, containers a name-prefix match. A
rename changed an item's identity, and nothing could express a Judge's ruling.

Gear now carries a declaration (the lib subsystem's `GearExtras`; see `docs/lib/DECISIONS.md`
for why it is a flag model and not an Item sub-type). Every classifier reads it
first, and **a declaration, once present, replaces the heuristic entirely** —
consulting the name afterwards would let "Great Helm" overrule a Judge who set
the slot to the body. The name tests survive only for gear nobody has annotated,
which is every world until the Annotate macro runs over it.

Ownership moved with the rule: `isHelmet`/`isShield` live in `profiles.mjs`, the
feature's classifier, and the copies in `loadout.mjs`, `wear.mjs` and the
enclosing-helm overlay are gone.

The Annotate macro now sweeps `armor` as well as `weapon` and `item` — armour is
where the head/body distinction is declared, and filtering it out left that
undeclared.

### Retrieval cost is per-container, not per-slot (2026-08-03)

RR pp. 293–294 makes drawing from an adventurer's harness, belt pouch, bowcase,
quiver or sheath **free**, and from a backpack, rucksack or sack an **action in
lieu of movement**. That is a fact about the container, not about where it hangs:
a pouch on your belt and a sack on your back differ by what they are. So `access`
sits on the gear model beside `slots`, and the container profile table carries
both — one table, because capacity, slot and access are all the same fact about
one piece of kit.

### Silver is a quality, not a material (2026-08-06)

The construction tab already had a **Material** picker, but its whole meaning was
destructibility for the JJ p398 item-loss overlay — its vocabulary is `metal`,
`wood`, `cloth` and the like, and it says so on the sheet. A reader who wanted a
silvered blade found the field that looked like the answer and got nothing, which
is the report this work came from.

Reading the books settled what "more materials" amounts to: **no second material
changes what a weapon or a suit can do.** Silver is the only one, it is printed
as a *weapon quality* beside Cleave and Impact rather than as a substance, and it
moves no number — "apart from gaining the Silver feature, the weapon's
characteristics do not change" (RR ch.4).

Stated carefully, because the words turn up without the rules behind them. Swept:
RR, MM, JJ, the Treasure Tome and By This Axe (the Heroic Fantasy Handbook is
ACKS I, so out of scope).

- **Cold iron** is in ACKS II — as the *name* of "Sword +2, Cold Iron", a
  domination ring, and a surgeon's saw, plus one in-world essay musing that
  "even such crude material as cold iron can demonstrate occult properties".
  Names and lore; no material rule anywhere.
- **Dragonhide** appears exactly once in the Treasure Tome, on a flavour collar.
  It is not an armour material.
- **Monster parts are a real system and a different one.** MM pp. 366–370
  (mundane) turns antlers, pelts and venoms into *trade goods* priced in gp and
  weighed in stone — rugs, capes, coats, trophies — and pp. 371–384 (special)
  makes them components for magic research, which is what a dragon's "dorsal
  scales (armor +1)" means: an input to research, not a hide anyone wears. That
  belongs to the monsters feature's spoils model, not to item materials, and
  nothing here touches it.
- The Treasure Tome only reinforces silver: silver weapons "have been proven to
  have potency against the incorporeal shadows of the Outer Darkness, without any
  enchantment laid on them."

So silver is modelled where the book puts it, as a quality, and the Material
picker was left exactly as it was. Two things follow from that:

- **Silver rides its own flag, not the material vocabulary.** Adding `silver`
  beside `metal` in `MATERIALS_BY_DAMAGE_TYPE` would have been the cheap move and
  it would have been wrong twice over: it would claim a silvered sword is
  destroyed by a different set of damage types than a steel one (it is not), and
  it would make the two facts mutually exclusive when a silvered blade is still
  metal for item loss.
- **Three rulings, one question.** A monster's silver flaw (RR ch.6), the spells
  that turn aside mundane damage, and the masterwork caveat at RR p159 all reduce
  to "does this attack deal extraordinary damage" — which the monsters feature
  already asks of a weapon through its own `extraordinary` flag. Silver answers
  that question (`dealsExtraordinaryDamage`) rather than opening a second one
  beside it.

**The price layer keys on an explicit answer only.** Silvering costs 10× the
weapon's listed price, but the RAW price list already sells Silver Dagger and
Silver Arrow at their silvered price — so multiplying anything that merely
*reads* as silver would bill the plating twice. Only plating a reader asked for
through the control charges for it. That is also why `false` is a storable
answer and not just an absence: it is how a Judge denies a name that says silver.

**What was rejected: deciding the outcome.** The module says what the weapon
counts as; whether a given monster's resistance carries the flaw is the Judge's
reading of its stat block, and the attack-roll pipeline was left alone. Its
`notes` reach `console.debug` and never the chat card, so a silver note added
there would have been invisible to the player anyway.

### The weapon table is searched longest-key-first (2026-08-06)

`weaponKey()`'s substring fallback walked the table in declaration order, and
`dagger` is declared one line before `silverdagger`. "Silver Dagger, masterwork"
therefore resolved to a plain dagger and dropped the Silver quality without a
word — a shorter key winning purely on being written first. Sorting the keys by
length picks the most specific weapon the name actually contains, whatever order
the table happens to be in.

This does **not** cover every spelling: "Silvered Dagger" slugs to
`silvereddagger`, which does not contain `silverdagger` at all. That is the
reason `isSilvered` consults the name in its own right rather than depending on
the weapon table to carry the quality.

---

**2026-08-11 — a Rolls tab only where core's details field-set is rolls.**

The sheet moved core's `.field-set--narrow` out of the description's side-column
into a Rolls tab for every equipment type. That reads correctly for a weapon,
whose field-set *is* throws: damage, attack bonus, melee/missile, range, save.
It reads as nothing for the other two. An armour's field-set is its AC and armour
type; an item's is its subtype and quantity. Both are facts about what the thing
IS, and sending them to a tab labelled Rolls both hid them behind a click and
left the description with an empty column where they used to sit.

**Ruled: `weapon` alone gets the tab.** Armour and items keep core's own sidebar
beside their prose, and the tab is dropped for them entirely rather than shown
empty — the same treatment Spells already gets on anything that is not a spell
book. Leaving the node where core put it is also strictly safer than putting it
back would be: it is never detached, so no core binding is even briefly orphaned.

Not done: splitting the weapon field-set so its non-roll members (the tag input,
Favorite) stay with the description. They are core's markup in core's order, and
re-templating them to sort two controls would forfeit the reason the whole node
is moved rather than rebuilt.

---

**2026-08-11 — the abilities bridge reads the typed effect model, not the name.**

The bridge translated an imported ability into effect domains through slug
tables keyed on the definition id's LAST segment. That is the ability's own name
for a proficiency (`def.prof.weaponFinesse` → `weaponfinesse`) but carries the
owning class for a class power (`def.power.bladedancerWeaponFinesse` →
`bladedancerweaponfinesse`). So the bladedancer's Weapon Finesse, Strength of
Faith and Graceful Fighting reached no domain, and none of the three moved a
die — Weapon Finesse in particular failed while the `finesse` domain and the
roll-wrap consuming it both worked perfectly, with nothing feeding them.

**Rejected: adding the class-power slugs to the tables.** It fixes exactly the
three powers reported and nothing else, and it commits the tables to carrying
one entry per class per rule — every class that grants Weapon Finesse under its
own name, forever.

**Ruled: read `flags["acks-extras"].extras.effects`.** acks-importer already
classifies each entry into typed specs, so `attributeSubstitution dex insteadOf
str on attackThrow` states the mechanic without anyone naming the ability. Every
ability that declares one is covered, whatever it is called and whichever book
it came from. The slug tables stay for the mechanics the model does not yet
express (fighting styles, weapon groups, armour training).

Cost, and the guard it needed: an ability can now be described twice. Combat
Reflexes hardcodes +1 initiative in the numeric table AND, on a seat that owns
the book, classifies the same +1 out of its prose — so the bridge returns the
domains a typed spec claimed and the tables stand down on those. Without it the
seats with the book would have silently paid twice.

Not done: honouring the *narrowing* each substitution prints. The proficiency's
Weapon Finesse covers tiny/small/medium melee weapons; the bladedancer's covers
the weapons she is proficient with, and the page says the two do not stack. That
distinction lives only in the spec's `condition` prose, and reading a restriction
out of prose is how a bonus gets granted where RAW does not grant it. Both map to
the one size-gated `finesse` domain, which can only ever withhold the swap on a
weapon larger than medium — the safe direction to be wrong.

---

**2026-08-11 — a device sold with its load is the ammunition, not a container.**

"Quiver, 20 Arrows" contains the word `quiver`, so the gear-profile match
claimed it and stamped a 1-stone capacity on it. The sheet then showed a full
quiver as **0 / 1 st — empty**, with the twenty arrows readable only in its name
and no way to put anything in it; and because the count lived in the name rather
than in `system.quantity`, firing a bow could never spend one.

**Ruled: it keeps its place and loses its capacity.** Where it rides and what it
costs to draw from are facts about the quiver and stay true — RR pp293-294 make
a quiver free to reach into, which is the whole reason an archer wears one. What
it is not is somewhere to put things: it arrives full of its own arrows. Core's
own equipment pack agrees, shipping it as one `item` carrying `quantity: 20`.

The load is read off the name so the ammunition tracker can spend it, and the
annotate pass is the one place that UNDOES its own earlier answer: a world
already carrying the wrong capacity clears it by re-running the annotate button,
because nothing else will. ~~The count is written only onto an item that has none,
so a half-spent quiver does not refill itself every time gear is annotated.~~
**Superseded 2026-09-05 — see *Annotate declares the bundle and never the
count*: the count was never absent, so the write never happened, and it is gone.**

`holds` is what separates a load from a capacity — core names every pack, sack
and pouch "(holds N stone)", and `stone` is both the unit they are measured in
and the shot a sling throws.

---

**2026-08-11 — clothing the named slots do not claim is still worn.**

`inferGear` had patterns for belts, boots, gloves, cloaks, hats, necklaces and
rings, and a structural fallback (`isClothing`) that reads
`system.subtype === "clothing"`. Core sets that subtype on its own clothing
items; nothing sets it on an item built from a book's starting-equipment list.
So a character imported with "low boots" and a "blue robe with crescents" could
wear the boots and not the robe — purely on which words had patterns.

**Ruled: a broad body-garment pattern, last in the list.** Every named slot wins
its own word first, so a leather belt is still belt-worn. What the pattern
catches lands in `worn`, which is uncapped, rather than `body`, which is the one
suit of armour — a robe and a mail hauberk are not competing for the same place.
No capacity is invented for any of it: whether a coat has usable pockets is a
ruling about that coat.

---

**2026-08-11 — an occupied hand names its occupant, wherever the count is shown.**

Field report: a mace wielded one-handed read `Hands 2/2`, and equipping a shield
raised a yellow "auto-unequipped" toast that named only the shield. Both were the
party sheet holding a hand — a lit torch, counted by `handsOccupied` — for a
character whose Worn & Wielded section listed one weapon and nothing else. The
count was right, and unreadable: the only hand the player could see held the
mace, so the sheet appeared to charge two hands for a one-handed weapon and then
refuse a legal shield for no stated reason.

**Ruled: the rule stands, the silence does not.** A burning or shuttered light
occupies a hand (RR p. 266; `formation-model.mjs`) and a shield needs a free one,
so both the count and the refusal were correct. What was wrong is that no surface
quoting a hand total could account for it. `heldHandsClause` names the hands
holding nothing the equipment sheet lists, and the status line, the hand-overflow
violation and the auto-unequip toast all state it.

The toast also now leads with the violation it already had in hand. Rejected:
suppressing the light's hand while a weapon is wielded, which would have made the
shield equip by making the torch weightless — a rules change dressed as a UI fix.

---

**2026-08-11 — every inventory list takes gear back out of a container.**

Stowing gear works by dropping onto a container's bucket, and un-stowing by
dropping back onto core's ordinary inventory. Core prints one list per item type
— Weapons, Armor, Items, Clothes, Money — and only the first of them was ever
wired as the "loose" target. So dragging a rope out of a backpack worked if it
was released over Weapons and did nothing over Items, where a rope belongs and
where the gesture actually ends. The container's empty-all button was unaffected,
which is why the report read as "only the button works".

**Ruled: wire them all.** The target is "the ordinary inventory", which is every
one of those lists, not whichever one core happened to print first.

---

**2026-08-15 — a shipped layered item carries its own pristine baseline.**

The two masterwork samples shipped `flags.acks-extras.masterwork` as a COPY OF
THE TABLE ROW — `{toHit: 1}`, `{ac: 1}` — while every reader wants the TIER KEY
(`masterworkTierOf` reads `.tier`, `setMasterwork` writes `{tier}`). So the
sheet's masterwork select read "None" on the two items whose entire purpose is
to demonstrate a tier, and `ITEM_FLAGS.MASTERWORK`'s own comment documented the
wrong shape.

**Ruled: the flag names a tier, never the row the tier names.** The row lives
once, in `config.MASTERWORK`; a second copy on the item is a value that can
disagree with it.

**Ruled: a sample whose fields already REFLECT a layer ships the `pristine`
snapshot too.** `recomputeItemFields` treats an item with no snapshot as
pristine, so a finished masterwork sword flagged with its tier and nothing else
would be read as a mundane sword that happens to have +1 — and clearing
masterwork would restore it to +1 and 90gp. The baseline is what makes the
layer removable, which is the whole point of the pristine model
(`properties.mjs`). This is the same discipline the named-item sample already
followed with its `base` object.

**What it cost.** Nothing shipped could read these two items correctly, and no
check noticed: the runtime tests exercise `setMasterwork` on items they build
themselves, so they never touched the shipped data. `test-equipment.mjs` now
asserts the samples' flag against `config.MASTERWORK` — that the tier is a real
key, and that baseline plus row reproduces every shipped field.

---

### Base type is a flag on the item, and it refines the document type rather than replacing it (2026-08-15)

**Ruled (owner):** what an item IS — armour, clothing, gear, food, gem, coin,
trade good — is `flags["acks-extras"].baseType`, never a bespoke Item
sub-type and never a unique item per category. Core's `actor.mjs` derives AC,
initiative and encumbrance straight from `item.type`, so the document type
stays whatever makes core behave correctly (plate stays `armor`, a gem stays
an ordinary `item`) and the flag carries the category on top.

**Rejected: a bespoke sub-type per category.** Multiplies `documentTypes`,
needs a world relaunch per addition, and every "is this ordinary goods" query
in core stops seeing the new type.

**Rejected: a unique Item per case**, the route already taken in places — a
category becomes a document instead of a property, and a second one means
copying the first rather than choosing a type.

**The category KEYS ship; the fields and every printed value import.** `"gem"`
as a vocabulary key names a concept; what a gem records, and every number in
it, arrives from the GM's own book through the field-spec register — the same
line `lib/tables.mjs` already draws.

**No interaction matrix beyond what a page states**, the same restraint the
variation conflict model uses: `appliesTo` gates the obvious, and a Judge
combining anything else is not arguing with a table nobody printed.

**Inference is the fallback, not the retirement.** `base-type-infer.mjs`
still guesses from the name for items that predate the flag; the declared flag
always wins, and the guess retires once the importer sets base types on what
it materialises — retiring it sooner would strip an unflagged world's
clothing of its slots.

---

### One item sheet, this module's own markup (2026-08-23)

**Evidence:** the owner's design handoff (ACKS Item Sheet v3) — one sheet for
every item type, fixed shape, conditional tabs, the identities and the lock on
tabs rather than header strips. It supersedes two earlier rulings: the founding
"identity overlays ride the header, not a tab", and 2026-08-11's "a Rolls tab
only where core's details field-set is rolls". Both were rulings about how to
restructure CORE's sheet; this is a different sheet.

**Ruled:** a standalone `HandlebarsApplicationMixin(ItemSheetV2)` with a pure
view-model (`item-sheet/view-model.mjs`), registered at `init` for weapon /
armor / item / money. **Rejected: keep subclassing the system's sheet and
moving its nodes.** That sheet bought the form bindings core wrote, at the
price of a DOM-injection layer whose every decoration needed an idempotency
guard and a `stopPropagation`, and whose layout was core's. The design's
layout is not core's, and a sheet whose whole markup is its own has no nodes
to relocate and no foreign form to fight.

**Ruled: simple mode keeps a Details affordance.** The design drops the tab
strip on an item with nothing to roll, no effects, no durability and no
contents. Taken literally, a coin could never be priced or made a container —
the only controls that change its shape live on Details. A quiet button
unfolds that one panel; the default look is the design's.

**Ruled: nothing the prototype mocked is invented.** Its Upkeep, Study,
Reading The Chart and Ability Rolls Boosted groups, the inscription legibility
rows and the named-item note prose have no data behind them in this module.
They are not built from placeholder copy; they arrive when a feature owns
them (ROADMAP).

**Ruled: the rails draw Foundry's icons.** The prototype's geometric
dingbats are replaced by the damage-type glyph (the real Acks Symbols font,
now vendored under the author grant — `vendor/acks-design/glyphs.css`), the
game-icons SVGs Foundry ships under `icons/svg/`, and Font Awesome; the wear
slot draws the icon `WEAR_SLOTS` already names. No mark on the sheet is this
module's own drawing.

**Ruled: a chart is a scene binding plus a fog capture.** Dropping a Scene on
an item binds it; "Update From Exploration" reduces the viewer's
`FogExploration` texture to a 320px PNG and counts its painted share. A
capture, not a live view — a chart shows what was seen when it was drawn.

**Ruled: what a container accepts is a kind vocabulary, not a list of items.**
Thirteen kinds (`item-sheet/accept-kinds.mjs`) read off document type, base
type and name; nothing ticked takes anything, and a refusal quotes the
container's own wording (`flags.acks-extras.container.refusal`). The kinds
are this module's classification keys, the same standing as base types.

**Ruled: a manoeuvre is an attack with the manoeuvre declared.** Core's
`targetAttack` forwards only the type, so the sheet calls `rollAttack` per
target with `options.maneuver`, and `computeAttackMods` folds the penalty into
the one bonus stack every other modifier uses. No second roll path.

**Cost.** The construction controls and the markets magic panel are still
DOM built by their owners and mounted into the new sheet; they are styled
under its rules rather than rewritten, which is the right boundary (markets
owns its flag) and an uneven seam on the page. Real drag-and-drop could not
be driven in the headless live session; every drop target was exercised
through the API it calls (`storeIn`, `disguiseItem`, `bindScene`) and stays
on the TESTING recipe as a pointer-driven check.


## 2026-08-28 — The mounted overlay ships its structure; the numbers wait

**Ruled:** `overlayMounted` registers at last — §15's blocker ("nothing
models a mounted state") died when acks-lib's attachment layer shipped — and
what it automates is the bookkeeping: the two staying-mounted save TRIGGERS
(post-attack via the lib's new `POST_ATTACK_HOOK`; damage via preUpdateActor,
where the old hp still exists to compare, spoken by the primary GM's client
only) as whispered prompts, and the action-economy CARD, including the
vehicle transporters' mirror keyed on the new `carriage` field. The save is
prompted, never rolled: which die falls and what a failure costs stay at the
table.

**Ruled: the proficiencies' printed numbers are not pushed into the roll.**
Mounted Combat's attack bonus and subjacency's worth are values that arrive
with the reader's imported abilities; hard-coding them is the value rule
broken, and reading them needs an abilities→attack effects bridge that does
not exist yet (ROADMAP). The pure comparators (`heightAdvantage`,
`whoMayAct`, the save predicates) ship tested and published so the bridge
lands on a finished surface.

**Also ruled:** `abilityRank` moved from vehicles/occupants into
`lib/capabilities.mjs` — rank counting is that module's question, the
mounted waivers and the vehicle stations both ask it, and the vehicles
surface re-exports it unchanged. The attack ctx gained `targetActor`
(additive; height advantage compares mounts, and AC alone cannot say what
the defender rides).

---

### A derived control writes back only when it is the control that fired (2026-08-31)

**Ruled.** Every badge on the item sheet that displays a *converted* view of a
stored field writes that field only when `event.target.name` names it. The
quantity badge already did; the weight badge did not, and the rule is now
stated rather than remembered.

The weight badge shows `system.weight6` as decimal stone and writes back what
it shows. With `submitOnChange`, every change to *any* field on the sheet
submitted the badge's displayed value too — so the stored weight was
re-quantised to the nearest whole sixth on every rename, every checkbox, every
unrelated edit.

For a whole number of sixths that is a no-op, which is why it was invisible.
For a **fraction** of a sixth it is total loss: `0.05` displays as `0.008` and
comes back `0`. Those fractions are real data — `acks-importer` divides a
printed bundle weight across its units and stores exactly this, with a
docstring noting that `weight6` is a plain `NumberField` so the fraction
survives. It survived the importer and not the sheet: twenty arrows silently
came to weigh nothing the first time anyone edited the item.

**The conversion is now a pair of pure functions** (`weightStoneOf` /
`weight6FromStone` in `item-sheet/format.mjs`) with the round trip pinned in
`tools/test-item-sheet.mjs` — both directions: whole sixths survive, fractions
demonstrably do not. The lossiness is the reason the guard exists, so the test
asserts it rather than treating it as a bug to fix later.

**The listed-price badge has the same missing guard and is NOT lossy** — it
binds the raw unrounded base, so its round trip returns what it was given. It
is left alone deliberately; noted here so the next reader does not take its
silence for correctness.

**Entry in stone is the real fault** and is not fixed here. Core's item sheet
and this module's own variation item both take sixths directly; the band is the
only decimal-stone surface in the family, and the conversion only exists
because of it. Changing what a Judge types is a user-facing change — see
[ROADMAP.md](ROADMAP.md).

---

### A stated weight may cover a bundle (2026-08-31)

**Ruled.** `GearExtras` gains `per` — how many units one stated `weight6`
covers, defaulting to 1. `weight6Of` counts `weight × ceil(quantity / per)`,
and `encumbranceDelta6` corrects core's sum by the difference.

The books rate a whole class of goods by the bundle: a quiver of twenty arrows,
a set of six iron spikes, one item however many it holds. `weight6` meant the
weight of ONE unit and quantity multiplied it, so the two numbers a Judge reads
off such a row had no way to say they share a denominator. Typing the printed
weight beside the printed count produced an item twenty times too heavy, and the
error propagated into container loads.

**`ceil`, not linear division.** A part-used bundle is still one item — twenty-one
arrows weigh two quivers, not one and a twentieth. Linear division would also
reintroduce the fractional weights the sheet used to destroy.

**The correction must go through `encumbranceDelta6`.** Core owns the character
encumbrance loop (`weight6 × quantity.value`) and is unmodifiable, so fixing only
this module's reader would leave the item sheet and the character sheet printing
different numbers for the same quiver. `coreWeight6Of` exists solely to say what
core counted, so the delta can cancel exactly that. The correction is restricted
to the shape core multiplies — a plain `item` that is not clothing.

**The field ships; the value does not.** What size bundle a given row is priced
for is printed, so `per` arrives from the importer, from the item's own name
(`bundledAmmoCount`, a heuristic over world data), or from the Judge. A shipped
`BUNDLE_SIZES` map would be the frozen-table failure `ip-doctrine.md` names.

**Annotate now sets it.** ~~`annotateItem` already backfilled `quantity.value` from
a bundled name and would otherwise have manufactured this defect itself — a
weight for the whole quiver multiplied by the arrow count it had just written.~~
**Superseded 2026-09-05 — see *Annotate declares the bundle and never the
count*: the backfill never fired; `per` stands on its own.** It never overwrites
a bundle size a Judge has set.

**No migration.** `per` defaults to 1, which is exactly the arithmetic every
stored item already gets.

**Reachability.** The control appears on a stack or on anything already
declaring a bundle, and is silent on a single item. It is deliberately NOT
"hidden until set": a field only the API can reach is a field nobody can
populate.

### Weight is entered in sixths (2026-08-31)

**Ruled.** The band's weight badge binds `system.weight6` directly, at `step=1`.
The stone reading stays beside it as a label, and the carried total joins it
whenever a bundle makes the two differ.

The badge used to take decimal stone and convert on the way in and out. That was
the only decimal-stone surface in the family — core's own item sheet and this
module's variation item both take sixths — and the conversion existed solely to
serve it. It was also lossy: any weight finer than a sixth collapsed through the
displayed decimal, which is what 5.6.1 had to guard against
(*A derived control writes back only when it is the control that fired*).

Binding the stored field removes the round trip rather than guarding it, so the
guard, the `weightStoneOf`/`weight6FromStone` pair and their round-trip tests all
came out with it. **Superseding note:** that 5.6.1 entry stands as the record of
why the guard existed; the control it guarded no longer exists. The new evidence
is nothing more than finishing the job — the guard was the hotfix-safe half.

**What a Judge types changes**, which is why this is a minor and not a patch: a
sixth is now `1` where it was `0.1667`.

### The band types the listed price where it reads it (2026-09-04)

Field report: *"There does not seem to be a way to edit the value field on
this one"* — a spoil item's sheet, Details folded, the value badge reading
0 gp. The price WAS editable, one fold away in the Details ledger; the weight
beside it was a field on the band and the value was not, and nothing on the
badge said where its number came from.

Ruling: the value badge is a field for the listed price wherever it would read
the plain value, and stays a reading everywhere else — apparent worth, a
disguise's value, an unappraised or unsaleable mode are set where those states
are set, and a field under a number the badge does not show would write what
it does not display. The field takes its own form name and writes only when it
fired, the rule already ruled for the quantity badge.

Rejected: making the badge open Details on click. It answers "where" but not
"why is the number I typed in Details different from the one up here" on a
silvered blade; the field with the worth beside it answers both.

Cost: two controls for one number on an open Details panel. Accepted; the
fired-control rule keeps them from writing over each other.

### A shield counts only with its style, and a grip is never volunteered (2026-09-05)

Field report: *"the Weapon & Shield fighting style does not add the
additional AC +1 when equipping a weapon and shield"* — and, in the same
batch, that the belt could not hold a belt pouch, that the harness holds by
count rather than weight, and that nothing said whether something was
reducing the encumbrance.

Ruling: reproduction showed the style working as the rules read (RR ch. 3):
the base style's benefit is the shield's own AC, Specialization adds its
bonus above it, and both landed. Two things the reproduction found were not
right. A character without the style still counted the shield, where the
rules give none: the Loadout carries `shieldStyled`, false while enforcement
is live and a shield is in hand without the style, and the loadout effect
cancels the shield's AC through the same `system.aac.mod` change the variant
overlay uses, taking the deeper cut once. And the `auto` grip took the
two-handed grip for a character untrained in the two-handed style, which
walked them into the non-proficient package by default: the auto grip widens
only when that style is trained or enforcement is off, and an explicit `2h`
stays the player's call. The belt and the back are uncapped, since the
one-of-a-form rule caps a form and not a place, and "Belt Pouch" and "Purse"
carry profile keys of their own so the garment patterns cannot claim them as
a belt. The harness was already relieving by weight; it now also secures a
light weapon, which hangs from a strap like anything else under a stone, and
never a thrown one. And what a bearer answers for was misread in three places
— a thrown weapon in `borneWeight6`, and the monster sheet's rider line and
the formation's casualty haul, which both read an encumbrance, a walking
figure the carrying rules had already lightened: all three read the kit as
it weighs.

Rejected: an extra bonus for the base style. The report read the style's
benefit as something on top of the shield; the rules make the shield the
benefit, and the guide now says so. Rejected: cancelling the shield's AC
through a second change beside the variant overlay's — two rules against
the same one addition would have cut twice. Rejected: a mount-side flag to
opt a rider out of the rider line's reading; a mount's load is a fact about
mass.

Cost: a character with a shield and no style loses the AC it was wrongly
counting, under the advisory that already existed; a versatile weapon drawn
alone by a character untrained in the two-handed style defaults to one hand
and the lesser die until the grip is set; the test fixture that relied on the
auto grip to gate an unconfigured actor had to become a weapon two-handed by
nature.

### A harness secures what its own text says, and the default grip is the best option (2026-09-05)

Evidence, the same day as the entry above: that entry left the harness's
relief as a shipped constant, and the guide printed it; the owner ruled that
the value follows the rules and the IP doctrine — the book's figure, arriving
with the item — and that a default is the character's best option under the
rules.

Ruling: the weight a harness secures is `gear.relief`, in stone, on the item.
Annotate reads it off the item's own name or description (the sentence that
says what may be ignored), the Construction tab's **Secures** field takes it
from the Judge, and a harness with no stated relief secures nothing — the
same law as an unstated capacity. The heavy line a harness cannot secure past
stays `STONE`: the unit itself, not a figure. The auto grip is restated as
the character's best option: the better die when the two-handed style is
trained or nothing is enforced, one hand where the wider grip would cost the
non-proficient package. "Belt Pouch" and "Purse" keep their place and their
reach and state no capacity; core's own pouch carries its figure in its name.

Rejected: a fallback to the old constant when the item is silent. It would
keep the shipped value in force for every existing harness and defeat the
ruling. Rejected: reading the heavy line from the text as well — it is the
unit.

Cost: a harness in an existing world secures nothing until Annotate is run
once (it reads core's own description) or the figure is typed; and the frozen
capacities of the other profiles — backpack, sacks, saddlebag, bowquiver, the
chest and the barrel — are the same kind of value, left for a ruling of their
own.

### Annotate declares the bundle and never the count (2026-09-05)

Evidence, five days after *A stated weight may cover a bundle* and against
its premise: a live pass over a freshly created "Quiver, 20 Arrows" set
`gear.per` to 20 and left the count at 1. The branch meant to fill the count
fired only where `system.quantity.value` was null, and a core item never
arrives that way — the field is a `NumberField` with `initial: 1`
(`foundryvtt-acks-core` `src/module/data/item/item-data.mjs`), and Foundry
writes a field's initial into the source of every document it creates. The
count was never absent. The guard that "a half-spent quiver must not refill"
protected a write that never happened, and the 2026-08-31 entry's "already
backfilled" was that comment read as fact.

What the branch could reach, it should not have. The field is nullable
(Foundry's `NumberField` default, which the schema does not override), and a
number input submitted blank stores null (`FormDataExtended` returns null for
an empty number field), so the one `item` that ever met the test was one
whose Judge had cleared its count. A weapon-typed bundle, with no `quantity`
in its schema, met it too, and there the write had nowhere to land.

**Ruled: the branch goes. Annotate stamps what a thing IS, never how much of
it is left.** `per` — that the stated weight covers twenty — is the item's
shape, and Annotate keeps declaring it from the name. The count is state,
and it arrives with the item: core's compendium ships the quiver at 20, the
importer's bare stack carries its unit count and its loaded device ships at
1 with the printed load on its `ammo` flag by that pipeline's own ruling
(`weapon-tables.mjs` `bindAmmoRow`), and a hand-typed item has the quantity
field on its sheet.

Rejected: keeping the branch under its literal reading, a cleared count
re-read from the name. The sheet prints a cleared count as 1
(`item-sheet/snapshot.mjs`), the ammunition tracker falls back to a legacy
`rounds` flag for it, and the next submit of any field writes the 1 back; a
state nothing else honours is not a control. Rejected: filling a count of 1
when no bundle is declared yet. No stored signal tells core's initial from a
deliberate one, so that fills a quiver spent down to its last arrow on the
world's first Annotate pass — the one failure the guard exists to prevent.
Every proxy tried (compendium provenance, the bundle flag's absence) fails
at that same edge.

Cost: none in any shipped world; the branch has never written. A hand-typed
"Quiver, 20 Arrows" left at core's count of 1 is one arrow to the tracker
until the Judge types twenty, which was already so. The offline suite holds
the ruling: a fresh bundle annotates to `per` with its count untouched, and
a half-spent one keeps both.

### A weapon that needs both hands is held in both (2026-09-07)

Field report: a character carrying a sword and a bow could not equip a
torch. Reproduced live: with the bow drawn, the character sheet listed it in
the Main hand at 1 / 1 and showed the Off hand empty at 0 / 1; the readied
torch dropped there was refused — *Not enough hands (3/2); free up: Torch,
Long Bow* — and came straight back off. The count was right and the listing
was not. `getLoadout` marked a weapon as held in both hands only inside the
lone-melee grip branch, so a bow, a crossbow, or a great sword beside a
shield never reached the both-hands place: the resolver put it in the main
hand, the sheet drew an empty off hand, and the grip cell showed one hand
open beside a two-hand weapon.

**Ruled: held in both hands is a fact of the weapon before it is a choice of
grip.** Every weapon whose minimum cost is two hands is marked
`wieldTwoHanded`, whatever else is carried; the lone-melee branch keeps only
the versatile grip, and a versatile weapon is now one whose grip changes its
cost (`canTwoHand`), so a Judge's hand-count override can no longer offer a
grip control on a weapon it has fixed. The hand arithmetic is unchanged.

Rejected: keying the sheet's place on the hand cost and leaving the flag as
the grip. Two readers of one fact — the wear resolver, the grip cell — would
have to agree to ask the second question, and the roll wrapper already gates
its die upsize on `damage2h`, which no two-hand-only weapon carries, so the
one flag is safe to widen.

Two smaller findings from the same walk, fixed alongside. Core's compendium
names the torch stack "Torches (6)", and the strict classifier the importer
owns passes it over, so the Ready control it was offered — gated on the
light model's torch pattern — created nothing and said nothing. The ready
step now recognises what the control recognises, readies it under the
torch's own name, and says so when handed something else. And a plain item
dropped on a hand place was refused by the wear model in silence, since it
declares no place; the sheet now says which place it lacks.

Cost: a bow beside a dagger lists in the spanning row and the dagger in the
main hand beneath it, which is the overflow the count reports. An unarmed
strike was suspected and is not involved: it is an unsaved weapon that
persists nothing, verified live.

### Two hands are two places, and a torch is equipped by readying it (2026-09-07)

Evidence, second walk of the same report. A group's two-weapon fighter listed
both daggers under Main Hand (2 / 1) with the off hand empty; a weapon dragged
onto Off Hand landed in Main Hand, and the row's draw control did the same.
`wearLocation` put every one-hand weapon in the main hand unless its `hand`
flag said `off`, and nothing wrote that flag — the drop handler drew the
weapon and ignored which hand it was dropped on; the comment beside the test
described a rule ("unless something else already claims it") the code never
implemented. Separately, a torch stack dropped on a hand place was refused
as gear declaring no place (silently before 7.1.3, with a notice after), and
the stack's own Equip control said it declares nowhere to be worn: the only
route into the hand was the Ready control, and it left the torch carried.

A fresh sword-and-bow character, nothing drawn, never has a hand counted
(verified live, every draw order): the report's "blocked hands" was the torch
that could not be put in one, and the second weapon that would not go where
it was dropped. The one state where hands are counted with nothing drawn is
the party sheet's — the mapper's kit, a light borne there — and on this sheet
its reason lived in a tooltip; lib's light refusal did not state it at all.

**Ruled.** A weapon dropped on a hand is drawn into that hand by name
(`drawInto`, one write, so the equip limit weighs it once); a weapon drawn
without a name takes the main hand unless another one-hand weapon already
holds it and no shield holds the off hand, then the off hand. Sheathing
forgets the hand. A torch stack dropped on a hand place, or its Equip
control, readies one torch and draws it (`prepareTorch` with `draw`). The
held-hands clause is visible on the hands badge, not a tooltip, and lib's
light refusal carries it.

Rejected: placing the second weapon by the loadout alone, with no flag. It
answers the row control but cannot honour a drop — the user names a hand and
the resolver overrules them, which is the report. Rejected: wearing the
stack itself in the hand through the gear model. A bundle is not a thing you
hold, and a worn `item` is not in the hand count; the readied torch is the
weapon the count charges.

Cost: the `hand` flag now has writers, so a weapon auto-unequipped by the
resolver keeps its name and returns to that hand when redrawn — the sheathe
control is what forgets it. A named main hand shifts an unnamed weapon to the
off hand, which is visible and is what the drop asked for.

### The item sheet's canvas figures scale with the type knob (2026-09-07)

The item sheet is the second surface transcribed from a px design canvas, and
it failed the `fontScale` setting exactly as the character sheet did — 44 of
its 47 `font-size` declarations were literal px, and core's font-size pins on
`.window-content` and `.window-header` stopped the rest at the frame.

Same treatment, same reasons: every px multiplied by `--acks-extras-k`, the
space ramp re-declared scaled at the sheet root, `flex: 0 0 auto` on the header
so the band is not clipped, and the opening width scaled at construction
(`atTypeScale`) while `min-width: 420px` stays literal. The ruling and the
alternatives it rejects are character sheet DECISIONS 2026-09-07 — not
restated here.

Shipped in the same release as that one rather than after it: the item sheet
opens *from* the character sheet, so a scaled sheet next to an unscaled one
reads as a broken module rather than a migration in progress.
