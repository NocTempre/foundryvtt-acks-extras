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

Mounted use is no longer blocked outright: acks-lib records who is riding what,
and whether to protect self or mount is a player's decision each round rather
than a derivable fact.

---

### Named-item rungs advance on level-up, not absolute level

An item does not leap forward because a high-level character picked it up. Rungs
unlock per level *gained* while wielding it. Application is idempotent: every
application recomputes from the BASE rather than adding to the current value.

Renaming is a state edit, not automation, so it is never gated on the overlay
setting — gating it there made renaming impossible whenever the overlay was off.
