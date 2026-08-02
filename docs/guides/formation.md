# Exploration formations

A **formation** is the party as one thing: a marching order, one token on the
map, one exploration clock, and party-wide checks that resolve every member.

> *Screenshot pending — captured at the next release.*

## Build one

Select the party's tokens → **Add to party**, or create a **Party Formation**
actor and add members from its sheet.

Members take roles — front, flank, rear, mapper, light-bearer — and the order is
the marching order. The party actor itself holds almost nothing; the formation
record holds the state.

When a formation takes the field, member tokens are stashed and one party token
stands in their place. Disbanding restores every stashed token to where it came
from.

## The clock

Moving the party token advances the exploration clock in turns. Torches burn
down, spell durations tick, and the rest cycle tracks when the party is due one.

Light is real: a lit torch occupies a hand, lights the party token, and goes out
when it burns through.

## Party checks

**Party roll** resolves the check for every member and posts **one GM-whispered
card**, not a wall of per-member public cards.

Every number comes from your own imported book by way of acks-content — this
module ships no skill ladder. Resolution order:

1. an explicit **Used for** binding on an ability item;
2. otherwise the ladder the item itself carries, at the owner's factored level;
3. otherwise the item's cookbook identity naming its skill.

Anything else falls back to the sheet's roll target.

The GM can overturn what the automation decided — the card is theirs.

## Skill audit

**Skill Audit** (GM) shows how every party roll resolves for every member: which
item or target is used, the auto-scaled level and factor, and each bonus in the
stack.

It is also the editor for **custom skills**: flag any ability item to take part
in a party roll, scale it on a thief progression, and set a level factor (0.5
for "as a thief of half his class level").

## Common problems

**A binding shows a skill that isn't there.** Its skill was never imported, or
the import was removed. The binding still lists itself so you can see your own
choice rather than a blank select — import the skill or rebind it.

**The map went dark.** Scene sync steps are fault-isolated, so one failure costs
only itself. Check the console for which step failed.

**A phantom party keeps coming back.** Records whose party actor was deleted are
pruned at world load. If one survives, its actor still exists somewhere.

**Saves look wrong.** The party does not save — `rollPartySave` reads each
member's own saves.
