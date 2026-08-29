/**
 * How a thing moves decides which modifiers it meets.
 *
 * The family grew three speed derivations independently — a march, a voyage, a
 * flight — and each grew its own opinion about which factors apply. That is
 * three places to change when a factor arrives, and three chances to disagree.
 *
 * A movement MODE is the missing middle. Each declares the ordered layers it
 * consumes and, where it differs, what it replaces or refuses. Two shapes fall
 * out of that, and they are the two the family actually needs:
 *
 *  - **An adjustment.** A vehicle is a march with gates on it — it meets every
 *    factor a walker meets and then refuses some ground outright. Its mode
 *    consumes the land layers and adds its own.
 *  - **An independent layer.** A vessel meets none of the land factors: no
 *    terrain, no road, no footing. Its mode declares its own layers, and the
 *    land stack is simply not consulted.
 *
 * A flier sits between them, which is why it needed this: RR prints the terrain
 * multipliers under Flight Speed, so a flier DOES meet the ground below it, and
 * weather applies "normally" — with wind the stated exception, which the flight
 * layer replaces rather than adds to.
 *
 * This file composes; it never prices. Every factor arrives as a part from the
 * derivation that owns it, and the mode only decides which are consulted and
 * in what order.
 */

/**
 * The layer a part belongs to, from its key. Parts are keyed `layer.detail`
 * (`terrain.forest`, `condition.muddy`) or bare (`aloft`, `windy`), so the
 * layer is the head.
 */
export function layerOf(key) {
  const s = String(key ?? "");
  const dot = s.indexOf(".");
  return dot === -1 ? s : s.slice(0, dot);
}

/**
 * The modes, and what each consumes.
 *
 * `layers` is ORDERED and the order is the rules' own — the road multiplier
 * lands after the terrain it passes through, because a road makes bad country
 * passable rather than good. Superseding is NOT declared here: the part that
 * supersedes names its own victim (`supplants`), because only the layer
 * contributing a special case knows which general case it stands in for.
 */
export const MOVEMENT_MODES = Object.freeze({
  foot: {
    label: "ACKS-LIB.movement.mode.foot",
    layers: ["terrain", "road", "condition", "pace"],
  },
  mounted: {
    label: "ACKS-LIB.movement.mode.mounted",
    layers: ["terrain", "road", "condition", "pace"],
  },
  /** A march with gates: it meets everything a walker does, and refuses more. */
  vehicle: {
    label: "ACKS-LIB.movement.mode.vehicle",
    layers: ["terrain", "road", "condition", "pace"],
    gates: ["wheels", "footing"],
  },
  /**
   * Above the country, not out of it. RR prints the terrain multipliers under
   * Flight Speed, so terrain is consumed; weather applies as it does below,
   * except that wind bites fliers specifically — so the flight layer REPLACES
   * the wind condition rather than stacking with it.
   */
  flying: {
    label: "ACKS-LIB.movement.mode.flying",
    layers: ["terrain", "condition", "aloft", "pace"],
    refuses: ["road"],
  },
  /** Its own world: no ground beneath it to be worth anything. */
  vessel: {
    label: "ACKS-LIB.movement.mode.vessel",
    layers: ["wind", "current", "condition", "pace"],
    independent: true,
    refuses: ["terrain", "road", "footing"],
  },
});

/** Is this a mode the family knows? */
export function isMode(mode) {
  return Object.hasOwn(MOVEMENT_MODES, String(mode));
}

/**
 * Compose one speed multiplier from parts, under a mode.
 *
 * Parts a mode refuses are DROPPED and reported rather than silently ignored —
 * a caller handing terrain to a vessel has a bug, and a readout that quietly
 * swallowed it would hide the bug behind a plausible number.
 *
 * Ordering is the mode's `layers`, not the caller's array order, so a
 * derivation may contribute parts in whatever order suits it and still read out
 * in the order the rules apply them.
 *
 * @param {object} o
 * @param {string} o.mode a key of `MOVEMENT_MODES`
 * @param {Array<{key: string, factor: number}>} o.parts contributed factors
 * @returns {{multiplier: number|null, parts: Array, dropped: Array, missing: boolean}}
 */
export function composeMovement({ mode = "foot", parts = [] } = {}) {
  const spec = MOVEMENT_MODES[mode];
  if (!spec) return { multiplier: null, parts: [], dropped: [], missing: true, unknownMode: true };

  const refuses = new Set(spec.refuses ?? []);
  const order = spec.layers;

  // What a special case stands in for. A flier's wind supersedes the ground's
  // wind rather than multiplying with it — but only because the flier actually
  // contributed one; nobody supplanting anything leaves the general case
  // standing, so a flier in a gale with no flight-wind rule still feels it.
  const supplanted = new Set(
    parts.filter((p) => p?.supplants).map((p) => String(p.supplants)),
  );
  const isSupplanted = (part) =>
    !part.supplants && (supplanted.has(part.key) || supplanted.has(layerOf(part.key)));

  const kept = [];
  const dropped = [];
  for (const part of parts) {
    if (!part?.key) continue;
    const layer = layerOf(part.key);
    if (refuses.has(layer)) { dropped.push({ ...part, why: "refused" }); continue; }
    if (isSupplanted(part)) { dropped.push({ ...part, why: "replaced" }); continue; }
    if (!order.includes(layer) && !part.note && !part.missing) {
      dropped.push({ ...part, why: "unused" });
      continue;
    }
    kept.push(part);
  }

  kept.sort((a, b) => {
    const ai = order.indexOf(layerOf(a.key));
    const bi = order.indexOf(layerOf(b.key));
    return (ai === -1 ? order.length : ai) - (bi === -1 ? order.length : bi);
  });

  const missing = kept.some((p) => p.missing);
  const multiplier = kept.reduce((n, p) => {
    const f = Number(p.factor);
    return Number.isFinite(f) && !p.note ? n * f : n;
  }, 1);

  return { multiplier, parts: kept, dropped, missing };
}
