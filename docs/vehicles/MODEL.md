# Vehicles — how it works now

The `acks-extras.vehicle` Actor sub-type: carts, wagons, chariots, palanquins,
galleys and sailing ships as documents. Rulings are [DECISIONS.md](DECISIONS.md);
what is not built is [ROADMAP.md](ROADMAP.md).

## The document

One sub-type covers land and sea, distinguished by `system.kind`. The model
([vehicle-data.mjs](../../scripts/vehicles/vehicle-data.mjs)) holds what the
books print per vessel — capacity in stone, crew requirements, draft
requirement, the load/speed tiers, sea speeds, AC and structural hit points —
and nothing it can derive. What is ABOARD is never a number typed here: it is
the actor's own inventory and its attachments, weighed by the capacity
primitive, because a typed total and a real one disagree the moment anyone
loads anything.

Registration is unconditional at `init`. A sub-type whose model fails to
register leaves every vehicle in the world unreadable, which is worse than any
capability check could be guarding against.

## Who is aboard

One relationship, five roles, owned by [lib/attachment.mjs](../../scripts/lib/attachment.mjs):
a flag on the CARRIED actor naming its carrier, the STATION it works (a job
the carrier defines), and — for an animal in harness — the KIND it pulls as.
A rider on a horse, a passenger in a wagon, an ox in the traces, a rower at
the bench and a canoe lashed on as cargo are the same binding. Each role
states whether its weight counts against the hold (a passenger and lashed
cargo yes, a draft animal and a crew member no, per RR ch. 7) and whether the
carrier's speed replaces its own. Mounting is the same flag through the
`lib/mount.mjs` facade, so a mounted rider is aboard in every sense the
party's pace can ask — and chains resolve to their ROOT, so a rider whose
horse is harnessed to a wagon moves at the wagon's pace.

[occupants.mjs](../../scripts/vehicles/occupants.mjs) assembles the ONE
occupant list every consumer reads — the sheet, the buckets, boarding — and
answers the team's real pull (`draftPullOf`): the abstract team rows ("2
heavy horses", no documents) plus every attached animal. Rows that still
carry a uuid from the old drop scheme convert to attachments the next time an
owner opens the sheet.

## Stations

[stations.mjs](../../scripts/vehicles/stations.mjs) derives the seat-by-seat
view the sheet renders: which groups exist is a property of the vehicle (a
wagon is pulled and driven, a vessel is crewed), and every group states what
it requires, who fills it, and what a shortfall costs. One counting rule
everywhere: a typed count is the UNNAMED complement — "30 rowers", "2 heavy
horses", "4 passengers" — and named occupants ADD to it, so the abstract
statement and the real people coexist. Officer seats (captain, navigator) are
always offered on a vessel, and an empty one states its rules consequence
where the emptiness shows. Named crew reach the speed derivations through
`effectiveCrewRoles` — officers counting as sailors toward the complement,
per RR ch. 7 — and an unqualified body (no Seafaring at a motive bench, no
Driving at the reins) wears a half-hand badge, the group stating its
effective strength. Occupants render as compact CHIPS
(`templates/lib/station-chip.hbs`, shared with the formation window), never
as full follower cards: a bench of named rowers must stay one glance.

Weights are TRUE: a specific actor charges its specific mass — body, or
every body a stack stands for, plus what it actually carries — and the
vehicle's printed per-head rate prices only the UNNAMED complement. Crew
bodies never charge the hold; a non-motive role's gear does (the marines
rule, RR p. 316), and the hold names that share. Stacks (`acks-extras.group`)
count all their living bodies at every counter, weight, and bench.

Dropping an actor on the sheet ASKS what they are
([drop-dialog.mjs](../../scripts/vehicles/drop-dialog.mjs)): the options are
the same derived groups, each with its cost stated before anything is
written, and a drop on a specific seat skips the question. Qualification is
read from the seated actor's real abilities; the typed
`seafaringRank`/`driverProficient` remain the ABSTRACT crew's statement,
authoritative for the derivations, with what the named crew would justify
shown beside them with provenance.

## Buckets, and which of them share a pool

[berths.mjs](../../scripts/vehicles/berths.mjs) derives what a given vehicle has
room for. This is per-vehicle, not per-family:

- a **land vehicle** has no berths — passengers and cargo come out of one pool,
  at the vehicle's own printed rate. The rate is NOT a constant: a small
  palanquin carries "one passenger (or up to 15 stone) at 60′, or two passengers
  (up to 35 stone) at 30′" (RR ch. 4), so one berth is 15 stone and two are 17½
  each, and the second passenger costs speed as well as room. A vehicle whose
  pairs are non-linear states them as speed tiers like any other load;
- a **vessel** berths her passengers apart from her hold, and her crew is not
  cargo — but the two TRADE, at fifty stone a hand (RR ch. 7). Sailing
  short-handed to carry more is a real decision the model represents.

**What "crew" means varies by vehicle.** RR ch. 4: the column "indicates the
driver, driver and warriors (for chariots), or the passengers (for howdahs)".
`complementMeans()` answers which, so a sheet does not label a howdah's
passengers "Crew".

## Speed

[vehicle-speed.mjs](../../scripts/vehicles/vehicle-speed.mjs) derives what a
vehicle actually makes: the printed load/speed tiers for land, wind and oar and
sail for sea, times the crew fraction (the WORST-manned motive role governs — a
galley with every sailor and half its rowers is a half-speed galley), times the
crew's condition, less a stowed mast, times terrain and road. Driving and
Seafaring are read from the vehicle, and Seafaring taken three times is a master
mariner, who alone can tack in a strong wind.

## The sea

- **Damage** ([vessel-damage.mjs](../../scripts/vehicles/vessel-damage.mjs)):
  most attacks cannot hurt a hull at all — a man-sized or large creature does
  NOTHING. Light and medium ballistae deal a tenth; huge creatures, heavy
  ballistae and light and medium catapults a third; other artillery and
  gigantic or colossal creatures the full amount; spells a tenth to timber,
  multiplied by their footprint in 25 sq ft.
- **Sinking**: at 0 or less she cannot move under her own power and goes down
  in 1d10 rounds.
- **Speed loss**: damage costs her speed in proportion to the hull lost, and
  crew losses cost her in proportion to the hands missing — **not cumulative**.
  Whichever is worse governs, alone. Voyage speed rounds to the nearest six
  miles, combat speed to the nearest thirty feet.
- **Repair**: structural hit points are never healed, only repaired — five
  hands, one turn, one point, doing nothing else. Only HALF of what she took at
  sea can be put back before a dock.
- **The clock** ([voyage.mjs](../../scripts/vehicles/voyage.mjs)): a voyage
  speed is miles over TWELVE hours, because crewing is unstrenuous; a party's
  expedition speed is miles over EIGHT. The two are only comparable per hour,
  which is what `compareToMarch()` is for. Under sail in open sea with a
  navigator and a full crew she may work around the clock: twice the distance
  in a day, at the same speed.
- **Navigation** ([navigation.mjs](../../scripts/vehicles/navigation.mjs)): a
  throw each day AND each night — lake or river 4+, coast 7+, open sea 11+;
  +4 for Pathfinding or Navigation aboard, +8 for both. Separately, entering a
  hex holding a hazard asks the CAPTAIN for Seafaring 11+ (7+ master mariner),
  +4 at half speed or less, +4 for a galley or longship over sandbar or shoal.
  Kelp holds her; rock, reef or wreck deals 8d10 piercing; sandbar or shoal
  4d10 bludgeoning and aground — each halved if she was making half speed,
  which is the rule rewarding caution twice for one decision.

## Boarding

`boardForBestPace` loads everyone the vehicle would carry faster than their own
legs, slowest first, stopping when the hold is full and never boarding someone
who walks faster than the wagon rolls. `reboardAsBefore` restores the last
arrangement, so unloading at a ford and reloading beyond it is two clicks.

## Published

`acksExtras.vehicles` carries the sub-type id and every derivation above. It is
published because a domain module costing a caravan, or a battle module asking
how far a wagon train gets in a day, should not re-read the tables.
