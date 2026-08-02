# Equipment, containers and fighting styles

The character sheet's inventory grows containers, wear locations and hand
accounting. Core's own rows are moved into place rather than rebuilt, so every
control you already knew keeps working.

> *Screenshot pending — captured at the next release.*

## Wear and hands

Equip an item and it lands in a **wear bucket** — head to foot, then off-body.
One taxonomy drives the paper doll, the buckets and the loadout summary, so they
cannot disagree.

Hands are counted. A two-handed weapon needs both; a lit torch occupies one, and
you cannot light one with no hand free. The controls sit in their own box beside
core's, because core's control column is a fixed 35–60px and anything added
inside it overflows.

## Containers

**New container** on the equipment tab. Drop items onto its bucket to stow them.

- A container shows its own header, load, and controls next to the gear it
  holds — there is no separate window.
- Coins are stowable (they go in a pouch) even though they have no weight.
- Locked and concealed containers are supported: picking a lock does not remove
  it, so the two states are tracked separately.
- **Emptying** a container leaves its contents loose on the actor rather than
  deleting them.

## Ammunition and thrown weapons

Firing a launcher decrements its matching ammo. A bundle of darts decrements
likewise.

A **single** thrown weapon — a hand axe, a lone javelin — is not destroyed. It is
marked *thrown away*, unequipped, and stops weighing on you until recovered. Use
the **Recover** macro to clear the state.

There is no automatic recovery percentage, because the rules give none: recovery
is the Judge's call and thrown weapons come back by being picked up.

## Proficiency

With enforcement on (the default), a character wielding a weapon with no
Class-Training fighting-style item reads as non-proficient and takes the RR p.106
package — attacks as a 0th-level fighter, no attribute bonus to attack or AC.

Weapon and armour lists stay **permissive** when absent: no list means
proficient, so an unconfigured character is not punished. It is the *style* that
is required.

Configure a character with its Class Training items and the gate is correct. The
`proficiencyEnforcement` setting has `auto` and `off` if you would rather not.

## Named items and overlays

Optional overlays add: named-item rung tracking (advancing on levels gained
while wielding, not on the wielder's absolute level), masterwork and scavenged
condition, enclosing helms, JJ shield variants and combat maneuvers. Each is a
separate setting.

## Common problems

**The container section vanished.** It should not — sections always render, even
empty. If a bucket is missing entirely, report it.

**A shield gives no bonus.** JJ shield variants: a shield strapped on the back
protects only the rear, which is situational rather than ordinary AC.

**"You have no free hand."** Something is already held. Sheathe or stow it — the
loadout summary shows what is occupying what.

**A torch is an item, not a weapon.** Correct: a torch is carried as a stack and
becomes a 1d4 weapon only when one is readied for use.
