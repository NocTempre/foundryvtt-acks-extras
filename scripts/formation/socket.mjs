/* global Hooks, socketlib */
import { MODULE_ID } from "./constants.mjs";

/**
 * All cross-client messaging goes through **socketlib**: named handlers with
 * GM routing, instead of a hand-rolled `game.socket` channel. Handlers are
 * registered on the `socketlib.ready` hook (fires after init, before ready);
 * the two consumers register their own functions via `onSocketReady`.
 */

let socket = null;
const pending = [];

/** The socketlib socket for this module, or null before socketlib.ready. */
export function getSocket() {
  return socket;
}

/**
 * Register a socket handler function. Safe to call at import time: if the
 * socket is not up yet the registration is queued until `socketlib.ready`.
 * @param {string} name  Unique handler name.
 * @param {Function} fn  Handler; its return value is delivered to callers.
 */
export function registerHandler(name, fn) {
  if (socket) socket.register(name, fn);
  else pending.push([name, fn]);
}

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  for (const [name, fn] of pending) socket.register(name, fn);
  pending.length = 0;
});
