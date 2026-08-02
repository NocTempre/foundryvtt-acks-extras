/* global game, ui */
/**
 * Player → GM relay. Players cannot create actors or write the location
 * actor, so recruit outcomes and similar mutations execute on the first
 * active GM's client. Uses socketlib when it is active (staged in the user's
 * module library), else the native socket channel — same pattern as
 * acks-influence's hiddenRoll relay.
 */
import { MODULE_ID, SOCKET_CHANNEL } from "./constants.mjs";
import { firstActiveGm } from "./acks-adapter.mjs";

const handlers = new Map();
let socketlibSocket = null;

/** Register a named GM-side action. */
export function registerSocketAction(action, handler) {
  handlers.set(action, handler);
  if (socketlibSocket) socketlibSocket.register(action, handler);
}

/**
 * Run an action on the active GM's client (runs locally when we ARE the GM).
 * @returns {Promise<void>} resolves when dispatched (not when completed,
 * on the native path — socketlib path awaits the remote result).
 */
export async function executeAsGM(action, payload) {
  if (game.user.isGM) {
    const handler = handlers.get(action);
    if (handler) return handler(payload);
    return;
  }
  if (!firstActiveGm()) {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.socket.noGm"));
    return;
  }
  if (socketlibSocket) return socketlibSocket.executeAsGM(action, payload);
  game.socket.emit(SOCKET_CHANNEL, { action, payload, userId: game.user.id });
}

/** Wire the transport. Called once at ready. */
export function registerSockets() {
  const socketlibModule = game.modules.get("socketlib");
  if (socketlibModule?.active && globalThis.socketlib) {
    socketlibSocket = globalThis.socketlib.registerModule(MODULE_ID);
    for (const [action, handler] of handlers) socketlibSocket.register(action, handler);
    console.log(`${MODULE_ID} | socketlib transport active`);
    return;
  }
  game.socket.on(SOCKET_CHANNEL, async ({ action, payload } = {}) => {
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
}
