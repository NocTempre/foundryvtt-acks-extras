# Vehicles — not built

How it behaves now is [MODEL.md](MODEL.md); rulings are
[DECISIONS.md](DECISIONS.md).

- **The bucket sheet** — `berths.mjs` derives the buckets, what each holds and
  which share a pool, and it is tested and published; the SHEET still renders
  the older cargo/crew/team sections rather than the derived buckets. What is
  left is the rendering, plus a control for the vessel crew↔cargo trade.
- **War machines** — a ballista or catapult rides on a vessel as cargo with its
  own stone cost, and the damage share table already knows what each class of
  engine does to a hull. What is missing is the engine as a THING: an item that
  occupies its cargo stone, names its damage class, and needs a crew to lay and
  loose it. Siege engines proper are their own chapter and are not this.
- **Hazards and navigation have no surface** — the throws and the hazard table
  are derived and published, but nothing rolls them. They want the shape the
  door helper has: the throw broken into its parts and shown before it is
  rolled.
- **Sinking has no clock** — `isSinking` and the 1d10 are known; nothing counts
  the rounds down or tells the people aboard.
- **Automatons are not vehicles.** BtA ch. 6 is a crafting economy — the
  machinist's design / build / repair project system, with blueprints, a
  proficiency throw sliding 14+ at L1 to 5+ at L10, major/minor ability tiers,
  workshop values, fuel and maintenance — whose output is an ACTOR. Its binding
  targets are equipment (the crafting) and monsters (the construct). Only two
  register powers exist today (`def.power.personalAutomaton`,
  `def.power.designBuildAndRepairAutomatons`).
- **Import cookbooks for the sea tables** — the Sea Vessels table (crew, cargo,
  AC, shp, oar and sail speeds per vessel) is not a register recipe yet, so a
  world types its vessels by hand. Same for the land vehicle table's crew/cargo
  pairs, which is what would let a palanquin arrive with its non-linear berths
  already stated.
