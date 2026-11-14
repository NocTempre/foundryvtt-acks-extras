/* global CONFIG, game, ui */
/**
 * Core patch: an actor's loyalty roll is refused while its Loyalty field is
 * empty.
 *
 * Core's `rollLoyalty` adds the field to 2d6 as it stands, and an empty field
 * is no score to add. Every Loyalty button on a sheet — the system's header button and
 * hireling list, this module's Service panel, Rolls tab, Follower Card and
 * monster sheet — ends in that method, so wrapping it is the one place a blank
 * score is told from a score. A blank is refused with a warning naming the
 * sheet's Loyalty field, never rolled as if a figure were there; any other
 * score runs core's roll untouched.
 *
 * This is the method's one wrapper.
 */
import { MODULE_ID } from "../constants.mjs";

/** MIXED form: a hireling whose field holds no number is refused, every other call is core's. */
function onRollLoyalty(wrapped, options = {}) {
  const score = this.system?.retainer?.loyalty;
  if (typeof score === "number" && Number.isFinite(score)) return wrapped(options);
  ui.notifications?.warn(game.i18n.format("ACKS-LIB.loyaltyRoll.blank", { name: this.name }));
  return undefined;
}

/** Install at `ready`, when the system's Actor class is final. */
export function installLoyaltyRollPatch() {
  const proto = CONFIG.Actor?.documentClass?.prototype;
  if (typeof proto?.rollLoyalty !== "function") {
    console.warn(`${MODULE_ID} | no Actor#rollLoyalty to wrap; loyalty rolls stay the system's own.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollLoyalty", onRollLoyalty, "MIXED");
    return;
  }
  const original = proto.rollLoyalty;
  proto.rollLoyalty = function (options) {
    return onRollLoyalty.call(this, (o) => original.call(this, o), options);
  };
}
