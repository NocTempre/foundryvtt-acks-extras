/* global game, Hooks, socketlib, ui */
/**
 * The module's ONE cross-client transport: one socketlib registration, one
 * handler registry that throws on a duplicate name (the collision has no
 * other tripwire), and one native fallback channel. socketlib is a `requires`
 * in module.json, so the fallback is belt-and-suspenders; only fire-and-forget
 * actions can use it — a result-bearing call needs the socketlib path.
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
 * Runs a handler for a call another client sent. An object payload's
 * `requestUserId` is replaced with the sender Foundry's server attested: null
 * for a GM, the sender's id for anyone else — the shape a seat's own dispatch
 * passes. A handler authorizes on who sent the call, never on what the payload
 * claims; a call from no known user does not run.
 * @param {Function} fn      The registered handler.
 * @param {string} senderId  The user id the server stamped on the message.
 * @param {Array} args       The call's arguments as sent.
 */
export function runRelayed(fn, senderId, args) {
  const sender = game.users.get(senderId);
  if (!sender) return undefined;
  const [payload, ...rest] = args;
  if (payload && typeof payload === "object" && !Array.isArray(payload)) {
    return fn({ ...payload, requestUserId: sender.isGM ? null : sender.id }, ...rest);
  }
  return fn(...args);
}

/** socketlib binds `this.socketdata.userId` to the attested sender, locally too. */
const viaSocketlib = (fn) =>
  function relayed(...args) {
    return runRelayed(fn, this?.socketdata?.userId, args);
  };

/**
 * Register a named handler. Safe at import time (queued until the socket is
 * up). Handler names share one module-wide registry — a duplicate is a
 * programming error and throws rather than silently rebinding. A relayed call
 * reaches the handler through `runRelayed`.
 * @param {string} name  Unique handler name.
 * @param {Function} fn  Handler; its return value reaches socketlib callers.
 */
export function registerHandler(name, fn) {
  if (handlers.has(name)) {
    throw new Error(`${MODULE_ID} | socket handler "${name}" registered twice — one module, one handler namespace`);
  }
  handlers.set(name, fn);
  if (socket) socket.register(name, viaSocketlib(fn));
}

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  for (const [name, fn] of handlers) socket.register(name, viaSocketlib(fn));
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
    // A henchmen-named lang key reused here; the wording is feature-neutral.
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.socket.noGm"));
    return;
  }
  if (socket) return socket.executeAsGM(action, payload);
  game.socket.emit(CHANNEL, { action, payload });
}

// Native-channel fallback listener: wired only when socketlib never came up.
// A context with neither socketlib nor a native socket is headless. The
// server passes the sender's id as the second argument.
Hooks.once("ready", () => {
  if (socket || typeof game.socket?.on !== "function") return;
  game.socket.on(CHANNEL, async ({ action, payload } = {}, senderId) => {
    // Only the first active GM executes, so multiple GMs don't double-run.
    if (game.user !== firstActiveGm()) return;
    const handler = handlers.get(action);
    if (!handler) return;
    try {
      await runRelayed(handler, senderId, [payload]);
    } catch (err) {
      console.error(`${MODULE_ID} | socket action ${action} failed`, err);
    }
  });
});
