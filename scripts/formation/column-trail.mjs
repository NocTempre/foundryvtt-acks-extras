/**
 * Recording the ground a party token walks (`FLAG_TRAIL`), which the drawn
 * column, its lights and a deploy read (`column.mjs`).
 *
 * Written by the primary GM from the party token's own update: a flag-only
 * write, after the step's animation, so it neither moves the token nor bills
 * the clock. With no GM online nothing is written, and the column reads
 * straight behind the head after a reload.
 */
import { FLAG_TRAIL, MODULE_ID } from "./constants.mjs";
import { nextTrail, sceneHasColumn, trailBound, trailDecision } from "./column.mjs";

/** Whether any waypoint of a move was taken by a teleporting action. */
function teleported(waypoints) {
  const actions = globalThis.CONFIG?.Token?.movement?.actions ?? {};
  return (waypoints ?? []).some((w) => !!actions[w?.action]?.teleport);
}

/**
 * Update the party token's trail for one update of it.
 *
 * @param {TokenDocument} tokenDoc the linked party token
 * @param {object} changes the update's changes
 * @param {object} options the update's options
 * @param {object} flags which of the movement hook's markers the update carries
 * @param {boolean} [flags.halt] a trap halted the party
 * @param {boolean} [flags.travel] a priced walk to a point of interest
 * @param {boolean} [flags.truth] a step onto a lost party's true position
 * @param {boolean} [flags.resize] the module's own resize
 * @param {object} formation the record, for the trail's bound
 * @returns {Promise<boolean>} whether a trail was written
 */
export async function recordTrail(tokenDoc, changes, options, flags, formation) {
  const scene = tokenDoc?.parent;
  if (!sceneHasColumn(scene)) return false;
  const movement = options?._movement?.[tokenDoc.id] ?? null;
  const waypoints = movement?.passed?.waypoints ?? [];
  const decision = trailDecision({
    moved: "x" in changes || "y" in changes,
    rotated: "rotation" in changes,
    teleport: teleported(waypoints),
    ...flags,
  });
  const stored = tokenDoc.getFlag(MODULE_ID, FLAG_TRAIL);
  const head = tokenDoc._source ?? tokenDoc;
  // A move with no recorded path (a scripted position write) walked from where
  // the trail last left the head.
  const lastHead = stored?.sceneId === scene.id ? stored.points?.[0] : null;
  const next = nextTrail(stored, {
    decision,
    origin: movement?.origin ?? lastHead ?? null,
    waypoints,
    head: { x: head.x, y: head.y, width: head.width, height: head.height },
    sceneId: scene.id,
    gs: Number(scene.grid.size),
    bound: trailBound(formation, scene),
  });
  if (!next) return false;
  if (JSON.stringify(next) === JSON.stringify(stored)) return false;
  await tokenDoc.update({ [`flags.${MODULE_ID}.${FLAG_TRAIL}`]: next });
  return true;
}
