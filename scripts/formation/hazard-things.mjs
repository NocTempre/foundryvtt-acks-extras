/**
 * Formation's three kinds of thing a place carries: `trap`, `obstacle` and
 * `condition`. Each is registered once, in the one `kindOfDrop` table
 * (`lib/place-things-logic.mjs`), with the predicate that says which dropped
 * document becomes it (`region-place-logic.mjs`). Foundry-free, so a test
 * registers and unregisters them.
 */
import { THING_KINDS, registerThingKind } from "../lib/place-things-logic.mjs";
import { acceptsCondition, acceptsObstacle, acceptsTrap } from "./region-place-logic.mjs";

/**
 * Register the three kinds. A kind has one registrant, so this runs once, at
 * init.
 * @returns {() => void} unregisters all three
 */
export function registerHazardThingKinds() {
  const off = [
    registerThingKind(THING_KINDS.TRAP, { accepts: acceptsTrap }),
    registerThingKind(THING_KINDS.OBSTACLE, { accepts: acceptsObstacle }),
    registerThingKind(THING_KINDS.CONDITION, { accepts: acceptsCondition }),
  ];
  return () => off.forEach((fn) => fn());
}
