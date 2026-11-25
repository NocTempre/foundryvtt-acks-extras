/* global foundry, game */
/**
 * Core patch: a seat that may not modify settings no longer sends the system's
 * welcome-version write.
 *
 * The `acks` system's `displayWelcomeMessage`, called from its `ready` handler,
 * stores the running system version in the world setting
 * `acks.welcomeMessageVersion` on every seat whose stored value is absent or
 * older, unawaited, and then shows the welcome dialog. A world setting is
 * written by users allowed `SETTINGS_MODIFY`; the server refuses anyone else's
 * write and the refusal lands in that seat's console. The wrapper answers that one
 * write from a seat without the permission with the stored value (or its Setting
 * document, for the `document` option) and sends nothing: no request, no relay
 * through another client, no socket. Every other call to `ClientSettings#set`
 * reaches Foundry unchanged.
 *
 * This file is the one owner of `ClientSettings#set`; no other patch in the
 * family wraps it. It follows Foundry's own permission, the check the server
 * applies to a world setting, and invents none: the permission is read from
 * `game.user` at each call, never cached, and covers both a stored setting
 * (an update) and a setting not yet stored (a create).
 *
 * A Player sees the welcome dialog on each load until a user allowed to modify
 * settings has loaded the world on that system version, and no error is logged.
 * Once the system guards its own write, no seat without the permission reaches
 * the match and the wrapper never fires.
 */
import { MODULE_ID } from "../constants.mjs";

/** The wrapped method's path, as libWrapper takes it. */
const TARGET = "foundry.helpers.ClientSettings.prototype.set";

/** The system's namespace and the key it stores its welcome version under. */
const SYSTEM_NAMESPACE = "acks";
const WELCOME_KEY = "welcomeMessageVersion";

/** Whether this wrapper is already in place, so a second install adds no layer. */
let installed = false;

/** Whether a `set` call is the system's welcome-version write from a seat that may not write a setting. */
function isRefusedWelcomeWrite(namespace, key) {
  return namespace === SYSTEM_NAMESPACE && key === WELCOME_KEY && !game.user?.can("SETTINGS_MODIFY");
}

/**
 * MIXED form: the refused welcome-version write resolves to what `set` would
 * return for the stored value, read at call time; anything else is Foundry's.
 */
function onSet(wrapped, namespace, key, value, options) {
  if (!isRefusedWelcomeWrite(namespace, key)) return wrapped(namespace, key, value, options);
  return Promise.resolve(this.get(namespace, key, { document: Boolean(options?.document) }));
}

/**
 * Install at `init`: the system's `ready` handler makes the write, so `ready`
 * is too late. Settingless and unconditional; it never throws, and a missing
 * `ClientSettings` warns once and stands down.
 */
export function installWelcomeVersionPatch() {
  if (installed) return;
  const proto = foundry?.helpers?.ClientSettings?.prototype;
  if (typeof proto?.set !== "function" || typeof proto?.get !== "function") {
    console.warn(`${MODULE_ID} | no ClientSettings#set to wrap; a Player's welcome-version write still reaches the server.`);
    return;
  }
  installed = true;
  if (globalThis.libWrapper?.register) {
    globalThis.libWrapper.register(MODULE_ID, TARGET, onSet, "MIXED");
  } else {
    const original = proto.set;
    proto.set = function (...args) {
      return onSet.call(this, (...a) => original.apply(this, a), ...args);
    };
  }
}
