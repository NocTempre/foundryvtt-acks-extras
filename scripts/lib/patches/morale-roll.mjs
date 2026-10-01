/* global CONFIG, game */
/**
 * Core patch: an actor's morale roll, handed to whichever feature provides
 * the `morale-roll` contract (docs/lib/API.md).
 *
 * Core's `rollMorale` posts 2d6 plus the sheet's morale and a field for one
 * unnamed modifier. Every Morale button on a sheet — the system's, this
 * module's — ends in that method, so wrapping it is the one place a page that
 * names its modifiers can stand in for all of them. The wrapper decides only
 * who answers; with no provider, the setting off, or the system's skip-dialog
 * key held, core's roll runs untouched.
 *
 * A provider's page returns no Roll. Core's own callers discard the return,
 * and a caller that needs the Roll holds the skip key's path: `wrapped`.
 *
 * See docs/lib/DECISIONS.md, "One owner for the morale roll, and the page is
 * a provider's".
 */
import { MODULE_ID } from "../constants.mjs";
import * as services from "../services.mjs";
import { skipDialogFor } from "../roll-dialog.mjs";

/** Contract name a feature registers its morale page under. */
export const MORALE_ROLL_CONTRACT = "morale-roll";

/** World setting: whether a sheet's Morale button opens the provider's page. */
export const SETTING_MORALE_PAGE = "moralePage";

function pageEnabled() {
  try {
    return game.settings.get(MODULE_ID, SETTING_MORALE_PAGE) !== false;
  } catch {
    return false;
  }
}

/**
 * MIXED form: the provider's page replaces the roll, and everything that
 * declines it falls through to core's.
 */
function onRollMorale(wrapped, options = {}) {
  const provider = services.get(MORALE_ROLL_CONTRACT);
  if (typeof provider?.open !== "function" || !pageEnabled() || skipDialogFor(options?.event)) return wrapped(options);
  try {
    return provider.open(this, options);
  } catch (err) {
    // A page that cannot open must not cost the table its roll.
    console.error(`${MODULE_ID} | the morale page failed to open; rolling the system's own`, err);
    return wrapped(options);
  }
}

/** Install at `ready`, when the system's Actor class is final. */
export function installMoraleRollPatch() {
  const proto = CONFIG.Actor?.documentClass?.prototype;
  if (typeof proto?.rollMorale !== "function") {
    console.warn(`${MODULE_ID} | no Actor#rollMorale to wrap; morale rolls stay the system's own.`);
    return;
  }
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollMorale", onRollMorale, "MIXED");
    return;
  }
  const original = proto.rollMorale;
  proto.rollMorale = function (options) {
    return onRollMorale.call(this, (o) => original.call(this, o), options);
  };
}
