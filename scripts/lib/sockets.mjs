/* global game, Hooks, socketlib, ui */
/**
 * The module's ONE cross-client transport: one socketlib registration, one
 * handler registry that throws on a duplicate name (the collision has no
 * other tripwire), and one native fallback channel. socketlib is a `requires`
 * in module.json, so the fallback is belt-and-suspenders; only fire-and-forget
 * actions can use it — a result-bearing call needs the socketlib path. The
 * channel also carries the seat election (`automation-client.mjs`), which
 * decides which window of the GM's seat answers a relayed request.
 */
import { MODULE_ID } from "./constants.mjs";
import { automationSettled, isLeadClient, joinSeatElection } from "./automation-client.mjs";
import { isPrimaryGM } from "./util.mjs";

const CHANNEL = `module.${MODULE_ID}`;
const handlers = new Map();
const broadcasts = new Set();
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

/**
 * Does the Judge declare this act? Authority is the declaring user's, never
 * the executing client's: a player's request relayed to a GM's seat carries
 * that player's id (`runRelayed`) and stays a player's, and a GM's own carries
 * none. A surface the Judge acts through passes the answer to the gate it
 * would otherwise meet; a sweep no user declared passes nothing.
 * @param {string|null} [requestUserId]  The relayed sender, as `runRelayed` stamps it.
 */
export const judgeDeclares = (requestUserId = null) => !requestUserId && !!game.user?.isGM;

/**
 * What a window that does not lead its seat answers a relayed request with: a
 * promise that never settles, so socketlib sends nothing and the requester
 * takes the lead's answer. Never a throw, which socketlib would send back.
 */
const unanswered = () => new Promise(() => {});

/**
 * socketlib binds `this.socketdata.userId` to the attested sender, locally too.
 * A request another window sent runs on the window its seat elected; one still
 * joining waits to learn whether that is itself. A call this window made, and a
 * broadcast, run here.
 */
const viaSocketlib = (name, fn) =>
  function relayed(...args) {
    const senderId = this?.socketdata?.userId;
    if (broadcasts.has(name) || senderId === game.user?.id) return runRelayed(fn, senderId, args);
    return automationSettled().then(() => (isLeadClient() ? runRelayed(fn, senderId, args) : unanswered()));
  };

/**
 * Register a named handler. Safe at import time (queued until the socket is
 * up). Handler names share one module-wide registry — a duplicate is a
 * programming error and throws rather than silently rebinding. A relayed call
 * reaches the handler through `runRelayed`.
 * @param {string} name  Unique handler name.
 * @param {Function} fn  Handler; its return value reaches socketlib callers.
 * @param {{broadcast?: boolean}} [o]  `broadcast` for a handler sent to every
 *   window (`executeForEveryone` / `executeForOthers`), which every window
 *   runs; a request runs on the GM seat's elected window alone.
 */
export function registerHandler(name, fn, { broadcast = false } = {}) {
  if (handlers.has(name)) {
    throw new Error(`${MODULE_ID} | socket handler "${name}" registered twice — one module, one handler namespace`);
  }
  handlers.set(name, fn);
  if (broadcast) broadcasts.add(name);
  if (socket) socket.register(name, viaSocketlib(name, fn));
}

Hooks.once("socketlib.ready", () => {
  socket = socketlib.registerModule(MODULE_ID);
  for (const [name, fn] of handlers) socket.register(name, viaSocketlib(name, fn));
});

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
  if (!game.users.activeGM) {
    ui.notifications.warn(game.i18n.localize("ACKS-LIB.socket.noGm"));
    return;
  }
  if (socket) return socket.executeAsGM(action, payload);
  game.socket.emit(CHANNEL, { action, payload });
}

// This window joins its seat's election on the module's channel. At `ready`,
// not before: the events a page receives while it loads are replayed to it
// just before `ready`, and a window that led before then would answer for
// events the seat's lead already handled.
Hooks.once("ready", () => joinSeatElection({ channel: CHANNEL }));

// Native-channel fallback listener: wired only when socketlib never came up.
// A context with neither socketlib nor a native socket is headless. The
// server passes the sender's id as the second argument.
Hooks.once("ready", () => {
  if (socket || typeof game.socket?.on !== "function") return;
  game.socket.on(CHANNEL, async ({ action, payload } = {}, senderId) => {
    // One window runs a request: the active GM's elected one.
    if (!action) return;
    await automationSettled();
    if (!isPrimaryGM()) return;
    const handler = handlers.get(action);
    if (!handler) return;
    try {
      await runRelayed(handler, senderId, [payload]);
    } catch (err) {
      console.error(`${MODULE_ID} | socket action ${action} failed`, err);
    }
  });
});
