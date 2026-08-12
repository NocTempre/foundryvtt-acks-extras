# Equipment & fighting styles — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

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
because nothing else will. The count is written only onto an item that has none,
so a half-spent quiver does not refill itself every time gear is annotated.

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
