# Vehicles — rulings

Append-only. A superseded entry stays, marked.

## 2026-08-14 — One sub-type, namespaced, rather than waiting for core

Core's [#154](https://github.com/AutarchLLC/foundryvtt-acks-core/issues/154)
asks for vehicle sheets and has been open and untouched since 2026-04. Shipping
`acks-extras.vehicle` NAMESPACED means core can still claim a bare `vehicle`
without a name fight; if it does, this becomes a migration rather than a
collision. Rejected: waiting (the feature is wanted now) and a bare `vehicle`
(takes a name that is not this module's to take).

## 2026-08-14 — Land and sea are one sub-type, not two

`system.kind` distinguishes them. Rejected: separate sub-types, which would
duplicate cargo, attachment, and the whole capacity path to express a
difference that is really about which fields are meaningful — and which the
bucket derivation already answers per vehicle.

## 2026-08-15 — What a hull weighs is a fraction of what hit it

RR ch. 7 scales damage by ATTACKER rather than by armour: a man-sized creature
cannot hurt a vessel at all, and a boarding party hacking at the deck is not
damaging the ship. Implemented as a share table keyed on attacker class rather
than as a damage-reduction number, because the rule is a multiplier and the
zero case must be a real zero — a reduction would let a big enough swing
through.

## 2026-08-15 — Crew loss and hull damage do not stack

The rule is explicit that the two speed penalties are not cumulative: whichever
is worse governs. `speedFactor()` therefore returns `min(crew, hull)` and NAMES
which one is in force, so a Judge does not patch a hull to fix a speed the
missing rowers were costing all along. `voyageDay()` divides the crew fraction
back out before applying it, because `seaSpeeds()` has already scaled by it and
applying it twice would square it.

## 2026-08-15 — A vessel's day is twelve hours and a party's is eight

Kept in separate modules that agree only on the HOUR. A single "miles per day"
field shared between them silently understates a ship by half, and the
round-the-clock rule makes it worse: sailing through the night doubles the day
without changing the speed. `compareToMarch()` exists so a caller that wants
both has one honest way to get them.

## 2026-08-15 — Buckets are derived per vehicle, never assumed per family

The owner's pitch was that a wagon pools cargo with passengers. RAW is richer
and the model follows RAW: the pooling is real, but the exchange rate is
PRINTED PER VEHICLE and is not linear (a small palanquin's first berth is 15
stone, its second 17½), and taking the second passenger can cost speed. So the
rate is read from the vehicle rather than fixed at the vessel's fifty-stone
berth, and non-linear vehicles express themselves through the existing speed
tiers rather than through a new mechanism.

The same section of RR ch. 4 gives ONE column three meanings — "the driver,
driver and warriors (for chariots), or the passengers (for howdahs)" — so the
complement carries what it MEANS. A sheet labelling all three "Crew" is wrong
on two vehicles in three.
