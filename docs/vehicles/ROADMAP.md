# Vehicles — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

- **Printed values still in code.** Each is a figure off the page that a
  derivation reads as a literal, and each moves to the imported `voyages` (or
  `travel`) document with an importer recipe, the way Path B moved the rest
  (DECISIONS 2026-08-28):
  - `conditionMultiplier`'s fractions (vehicle-speed.mjs): an underfed and a
    starving crew (RR ch. 7);
  - the stowed mast's cost to the oars (vehicle-speed.mjs `seaSpeeds`, RR ch. 7);
  - the Seafaring ranks a seat asks (occupants.mjs `handProficiency`,
    `seatQualification`) and the master mariner's rank (vehicle-speed.mjs
    `seaSpeeds`) (RR ch. 3);
  - the voyage and march day lengths (voyage.mjs `VOYAGE_HOURS`,
    `MARCH_HOURS`, RR ch. 7), deferred to the movement-scales pass.
- **Venture logistics a vehicle would carry** — moorage and stabling by the
  day, cargo handling time, warehousing and hiring a hold out as a carrier
  (RR §VIII.6) are `docs/markets/ROADMAP.md` (Venture logistics). The deploy
  record and the hold are the pieces each would read.
- **War machines** — a ballista or catapult rides on a vessel as cargo with its
  own stone cost, and the damage share table already knows what each class of
  engine does to a hull. What is missing is the engine as a THING: an item that
  occupies its cargo stone, names its damage class, and needs a crew to lay and
  loose it. Siege engines proper are their own chapter and are not this.
- **Voyage-day surfaces** — `voyageDay`/`canSailRoundTheClock` derive but
  nothing offers the day: a voyage panel (the journey panel's sea mirror)
  would wire the officer seats' consequences (no navigator, no
  round-the-clock) to a visible control, roll the daily wind from the
  imported rows, and log the leg. River current bands and draft gates, and
  the scurvy/morale calamity prompts, land with it.
  (The marines' gear rate, the crew-for-cargo trade, the navigation and
  hazard dialogs and the sinking clock all LANDED 2026-08-28 — MODEL.md.)
- **Automatons are not vehicles.** BtA ch. 6 is a crafting economy — the
  machinist's design / build / repair project system, with blueprints, a
  proficiency throw that eases with level, major/minor ability tiers,
  workshop values, fuel and maintenance — whose output is an ACTOR. Its binding
  targets are equipment (the crafting) and monsters (the construct). Only two
  register powers exist today (`def.power.personalAutomaton`,
  `def.power.designBuildAndRepairAutomatons`). An automaton that CARRIES — a
  howdah-backed colossus — does so through the same attachment layer as any
  monster; no vehicle work is needed for it.
- **Import cookbooks for the sea tables** — the Sea Vessels recipe exists in
  the importer's tree (2026-08-28, all 20 rows cell-perfect), and the
  `voyages` document's recipes joined it the same day (wind grid, tacking,
  navigation, hazard throw and effects, damage shares, repair, rounding,
  berth — dev-executed oracle-exact; the unproficient-crew rate joined
  2026-09-30, run against the local printing), and the importer now ships
  inside extras, so this closes when the import is live-verified in a world.
  Still genuinely open: the land vehicle table's crew/cargo
  pairs, which is what would let a palanquin arrive with its non-linear
  berths already stated.

## Flight design space (nothing precludes it; nothing implements it)

No skyship system exists anywhere in the ACKS II corpus this family holds —
the one aerial-vessel hook is the **Flying Fortress** ritual (RR ch. 8
§VIII.8), which imbues a structure OR VESSEL with flight: its own speed
triple, an altitude floor and ceiling, an ascent rate, piloting from a seat
of power (strenuous stationary concentration above an HD threshold; several
pilots enable round-the-clock travel), drift when the seat is empty, and a
crash on dispel. When it is modelled, it is an EFFECT a vessel or structure
gains — a `flight {speed, altitudeFloor, altitudeCeiling, ascentRate}` block
plus a `pilot` STATION — not a third vehicle family; the stations surface
above seats a pilot with no new mechanism. Until then, one rule keeps the
door open: **no new two-way `kind === "sea"` branches** — a branch that
buckets "sea, else land" must be written so a third kind fails loudly rather
than silently landing in the wrong arm (`bucketsFor` is the one grandfathered
case). The unit-scale
Air Combat layer stays out of scope with the rest of D@W (root
`docs/DECISIONS.md` §15). Sleds need no design space at all: a sled is a
homebrew land vehicle whose snow gates arrive with the terrain tables.
