/**
 * How a thing moves decides which modifiers it meets. Each movement mode
 * declares the ordered layers it consumes and what it replaces or refuses.
 * This file composes; it never prices. See docs/lib/MODEL.md, "Movement
 * modes".
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
 * The modes, and what each consumes. `layers` is ORDERED to the rules' own
 * sequence. Superseding is declared per-part (`supplants`), not here — only
 * the special-case layer knows which general case it replaces.
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
   * Above the country, not out of it: terrain is consumed (RR — Flight
   * Speed); weather applies as below except wind, which the flight layer
   * replaces rather than stacks with.
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
 * Parts a mode refuses are dropped and reported, never silently ignored.
 * Ordering follows the mode's `layers`, not the caller's array order.
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

  // Supplanted only by a part that actually claims the layer; absent that,
  // the general case still applies.
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
