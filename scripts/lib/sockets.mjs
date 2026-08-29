/* global game, Hooks, socketlib, ui */
/**
 * The module's ONE cross-client transport.
 *
 * Pre-merge, three features each ran their own: formation and influence both
 * called `socketlib.registerModule` on `socketlib.ready`, henchmen again at
 * `ready` plus a hand-rolled native-channel fallback — three sockets on one
 * module id, with nothing guarding the shared handler-name space. Now there
 * is one socketlib registration, one handler registry that THROWS on a
 * duplicate name (the collision has no other tripwire), and one native
 * fallback channel. socketlib is a `requires` in module.json, so the
 * fallback is belt-and-suspenders; only fire-and-forget actions can use it —
 * a result-bearing call (the hidden influence roll) needs the socketlib path,
 * exactly as it always did.
 */
import { MODULE_ID } from "./constants.mjs";

const CHANNEL = `module.${MODULE_ID}`;
const handlers = new Map();
let socket = null;

/** The socketlib socket, or null before `socketlib.ready` / without socketlib. */
export function getSocket() {
  return socket;
}

/**
 * Register a named handler. Safe at import time (queued until the socket is
 * up). Handler names share one module-wide registry — a duplicate is a
 * programming error and throws rather than silently rebinding.
 * @param {string} name  Unique handler name.
 * @param {Function} fn  Handler; its return value reaches socketlib callers.
 */
export function registerHandler(name, fn) {
  if (handlers.has(name)) {
    throw new Error(`${MODULE_ID} | socket handler "${name}" registered twice — one module, one handler namespace`);
  }
  handlers.set(name, fn);
  if (socket) socket.register(name, fn);
}

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  for (const [name, fn] of handlers) socket.register(name, fn);
});

/** First active GM — the one client that executes relayed mutations. */
const firstActiveGm = () => game.users.activeGM ?? game.users.find((u) => u.isGM && u.active) ?? null;

/**
 * Run an action on the active GM's client (runs locally when we ARE the GM).
 * @returns {Promise<*>} the handler result on the socketlib path; resolves on
 * dispatch (without a result) on the native fallback.
 */
export async function executeAsGM(action, payload) {
  if (game.user.isGM) {
    const handler = handlers.get(action);
    if (handler) return handler(payload);
    return;
  }
  if (!firstActiveGm()) {
    // henchmen-rooted key by history; the wording is feature-neutral.
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.socket.noGm"));
    return;
  }
  if (socket) return socket.executeAsGM(action, payload);
  game.socket.emit(CHANNEL, { action, payload, userId: game.user.id });
}

// Native-channel fallback listener: only wired when socketlib never came up.
// A context with neither socketlib NOR a native socket is headless — there is
// nobody to hear the channel, and throwing here would take the whole ready
// hook down with it, killing every registration that follows.
Hooks.once("ready", () => {
  if (socket || typeof game.socket?.on !== "function") return;
  game.socket.on(CHANNEL, async ({ action, payload } = {}) => {
    // Only the first active GM executes, so multiple GMs don't double-run.
    if (game.user !== firstActiveGm()) return;
    const handler = handlers.get(action);
    if (!handler) return;
    try {
      await handler(payload);
    } catch (err) {
      console.error(`${MODULE_ID} | socket action ${action} failed`, err);
    }
  });
});
