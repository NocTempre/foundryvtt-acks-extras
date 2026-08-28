/**
 * The stations of a vehicle: who is in what role, seat by seat, at a glance.
 *
 * A vehicle's people are not a list — they are a set of STATIONS the vehicle
 * itself defines: a driver's seat (or the whole printed complement, on the
 * vehicles whose "crew" column means something else), a bench of rowers with a
 * complement to fill, officer seats whose emptiness has rules consequences, a
 * team in the traces, berths for passengers. This module derives those groups
 * from the vehicle's own data plus the occupant list, so the sheet renders
 * what it is told: which groups exist, what each requires, who fills it, and
 * what a shortfall costs.
 *
 * Pure derivation over plain objects — no documents, no i18n, no DOM. Labels
 * are returned as KEYS (or the vehicle's own typed text) for the view layer
 * to resolve; occupants arrive already weighed and qualified (occupants.mjs).
 *
 * Counting rule, everywhere: a typed count is the UNNAMED complement ("30
 * rowers", "2 heavy horses", "4 passengers"), and named occupants ADD to it.
 * One pattern, every group — the abstract statement and the real people
 * coexist, exactly as the team's rows and harnessed animals do.
 */
import { complementMeans } from "./berths.mjs";

/** Officer seats a vessel always offers, and the station each assigns. */
export const OFFICER_STATIONS = Object.freeze(["captain", "navigator"]);

/** How many empty seats a group renders before collapsing to a number. */
const MAX_EMPTY_SLOTS = 12;

const num = (v) => Number(v) || 0;

/** Heads in a list of occupants: a stack counts every body it stands for. */
const headsOf = (list) => list.reduce((n, o) => n + Math.max(0, o.bodies ?? 1), 0);

/**
 * The station groups of one vehicle, in the order a sheet shows them.
 *
 * @param {object} sys the vehicle's `system` data
 * @param {object[]} occupants occupants.mjs rows: {uuid, name, img, role,
 *   station, kind, stone, qualified}
 * @param {object} [o]
 * @param {number} [o.pull] the team's whole pull (abstract + attached), HHE
 * @returns {object[]} groups: {key, labelKey?, labelText?, station, role,
 *   counts, required, filled, named, unnamed, emptySlots, short, singleton,
 *   consequenceKey?, pull?, abstract?}
 */
export function stationsFor(sys, occupants = [], { pull = null } = {}) {
  const sea = sys?.kind === "sea";
  const by = (role, station = undefined) =>
    occupants.filter((o) => o.role === role && (station === undefined || (o.station ?? null) === station));
  return sea ? seaStations(sys, occupants, by) : landStations(sys, occupants, by, pull);
}

function landStations(sys, occupants, by, pull) {
  const groups = [];

  // The team is counted in heavy-horse equivalents, not heads: a mule is half
  // a slot, so it renders as a pull fraction against the build requirement
  // rather than as seats.
  const abstract = (sys?.team?.animals ?? []).map((a, index) => ({ ...a, index }));
  groups.push({
    key: "team",
    labelKey: "ACKS-VEHICLES.bucket.draft",
    station: "team",
    role: "draft",
    counts: "pull",
    required: num(sys?.team?.required) || null,
    filled: pull ?? null,
    named: by("draft"),
    abstract,
    unnamed: abstract.filter((a) => !a.uuid).reduce((s, a) => s + Math.max(1, num(a.count)), 0),
    emptySlots: 0,
    short: num(sys?.team?.required) > 0 && pull != null && pull < num(sys.team.required),
    singleton: false,
  });

  // The printed complement: one driver's seat, or the whole complement when
  // the column means warriors or passengers (the howdah rule). Named crew
  // occupants sit here whatever their station says — a land vehicle has one
  // complement, not a roster of roles.
  const means = complementMeans(sys);
  const crew = by("crew");
  const crewHeads = headsOf(crew);
  const driverSeat = means === "driver";
  groups.push({
    key: "complement",
    labelKey: `ACKS-VEHICLES.bucket.${means}`,
    station: "driver",
    role: "crew",
    counts: "people",
    required: driverSeat ? 1 : null,
    filled: crewHeads,
    named: crew,
    unnamed: 0,
    emptySlots: driverSeat ? Math.max(0, 1 - crewHeads) : 0,
    short: false,
    singleton: driverSeat,
  });

  groups.push(passengerGroup(sys, by));
  return groups;
}

function seaStations(sys, occupants, by) {
  const groups = [];

  // One group per printed crew role. The typed `aboard` is the UNNAMED hands;
  // named crew attach with the row's key as their station and add to it.
  for (const [index, row] of (sys?.crew?.roles ?? []).entries()) {
    const station = stationKeyOf(row, index);
    const named = by("crew", station);
    const unnamed = num(row.aboard);
    const filled = unnamed + headsOf(named);
    const required = num(row.required);
    groups.push({
      key: `role:${station}`,
      labelText: row.label || row.key || "",
      station,
      role: "crew",
      counts: "people",
      index,
      motive: row.motive !== false,
      required: required || null,
      filled,
      named,
      unnamed,
      emptySlots: Math.min(MAX_EMPTY_SLOTS, Math.max(0, required - filled)),
      short: row.motive !== false && required > 0 && filled < required,
      singleton: false,
    });
  }

  // Officer seats: always offered, one each, with the rules consequence of an
  // empty seat stated where the emptiness is shown.
  for (const officer of OFFICER_STATIONS) {
    const named = by("crew", officer);
    const heads = headsOf(named);
    groups.push({
      key: officer,
      labelKey: `ACKS-VEHICLES.station.${officer}`,
      station: officer,
      role: "crew",
      counts: "people",
      required: 1,
      filled: heads,
      named,
      unnamed: 0,
      emptySlots: heads ? 0 : 1,
      short: false,
      singleton: true,
      consequenceKey: heads ? null : `ACKS-VEHICLES.station.${officer}Empty`,
    });
  }

  groups.push(passengerGroup(sys, by));
  return groups;
}

function passengerGroup(sys, by) {
  const named = by("passenger");
  const unnamed = Math.max(0, num(sys?.cargo?.passengers));
  return {
    key: "passengers",
    labelKey: "ACKS-VEHICLES.bucket.passengers",
    station: null,
    role: "passenger",
    counts: "people",
    required: null,
    filled: headsOf(named) + unnamed,
    named,
    unnamed,
    emptySlots: 0,
    short: false,
    singleton: false,
  };
}

/**
 * The station a crew row assigns: its key, else its label slugged, else its
 * index — stable enough to survive a re-label, honest when nothing is typed.
 */
export function stationKeyOf(row, index) {
  const key = (row?.key ?? "").trim();
  if (key) return key;
  const slug = (row?.label ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return slug || `role-${index}`;
}

/**
 * The effective crew rows: the typed unnamed hands plus the named crew at each
 * station — the rows `crewFraction` and the speed derivations should see, so
 * a named rower is a rower and not decoration. Officers count as SAILORS
 * toward the complement (RR ch. 7: navigators, captains and master mariners
 * are sailors, never rowers), so a named officer adds to the `sailors` row
 * where one exists and to nothing otherwise.
 */
export function effectiveCrewRoles(sys, occupants = []) {
  const roles = sys?.crew?.roles ?? [];
  const officers = headsOf(occupants.filter((o) => o.role === "crew" && OFFICER_STATIONS.includes(o.station)));
  return roles.map((row, index) => {
    const station = stationKeyOf(row, index);
    let named = headsOf(occupants.filter((o) => o.role === "crew" && o.station === station));
    if (station === "sailors") named += officers;
    return { ...row, aboard: num(row.aboard) + named };
  });
}
