# Equipment & fighting styles — decision record

Why this feature is shaped the way it is: what was ruled, what was rejected, and
what it cost. How it behaves *now* is [MODEL.md](MODEL.md).

Entries are dated and append-only. A superseded entry stays, marked.

---

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
