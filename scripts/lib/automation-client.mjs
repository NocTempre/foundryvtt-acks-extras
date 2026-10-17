/* global game, foundry, window */
/**
 * This window's part in its seat's election (`automation-client-logic.mjs`):
 * the one answer to "does THIS window run the automation?". Core elects a
 * user, and every window joined on that user hears every hook; this elects
 * one window per user. `util.mjs`'s `isPrimaryGM` composes it with core's
 * choice of user, and `sockets.mjs` joins it at `ready` over the module's
 * channel. Nothing here touches Foundry until it is called, so it is safe to
 * import from anywhere.
 */
import { createSeatElection } from "./automation-client-logic.mjs";

/** The envelope key on the module's channel, beside socketlib's messages (which carry `type` and `id`). */
const SEAT_KEY = "seatElection";

let election = null;
let resolveJoined = null;
const joined = new Promise((resolve) => (resolveJoined = resolve));

/** A context with no socket listener is headless (the offline suites), and leads. */
const headless = () => typeof game?.socket?.on !== "function";

/** Whether this window runs its seat's automation. False while it is still joining. */
export const isLeadClient = () => (election ? election.isLead() : headless());

/**
 * Resolves once this window knows who leads its seat, at once where headless.
 * Work a local trigger starts (`ready`, `canvasReady`) awaits it; a window
 * that never joins (a view other than the game) never resolves it.
 * @returns {Promise<void>}
 */
export const automationSettled = () => (election || !headless() ? joined : Promise.resolve());

/** This window's view of its seat's election, for a diagnostic read; null before it joined. */
export const automationCensus = () => election?.census() ?? null;

/**
 * Joins this window to its seat's election, once. Messages go to the seat's
 * own sockets only (`recipients`), which the server delivers to every one of
 * them, this window's included, in its order of handling.
 * @param {{channel: string}} o  the module's socket event name
 */
export function joinSeatElection({ channel }) {
  if (election || headless() || game.view !== "game") return;
  const socket = game.socket;
  const selfId = foundry.utils.randomID();
  election = createSeatElection({
    selfId,
    send: (op) => {
      // socket.io queues an emit made while disconnected and delivers it on
      // reconnecting, on state that is stale by then.
      if (!socket.connected) return false;
      socket.emit(channel, { [SEAT_KEY]: { op, from: selfId } }, { recipients: [game.user.id] });
      return true;
    },
  });
  election.settled.then(() => resolveJoined());
  socket.on(channel, (message, senderId) => {
    const seat = message?.[SEAT_KEY];
    if (seat && senderId === game.user.id) election.receive(seat);
  });
  const leave = () => election.leave();
  socket.on("disconnect", () => election.disconnected());
  socket.on("connect", () => {
    sayByeOnClose(socket, leave);
    election.join();
  });
  // The listener is the path for a socket that does not close on unload.
  window.addEventListener("beforeunload", leave);
  sayByeOnClose(socket, leave);
  election.join();
}

const byeOnClose = new WeakSet();

/**
 * Sends the bye from the connection's own `close`. socket.io closes the
 * transport from a `beforeunload` listener its first connection added before
 * any module loaded, and a window runs its listeners in the order they were
 * added, capture phase or not, so a bye sent from a listener of this module's
 * lands in the buffer of a closed transport. Each connection's transport is
 * wrapped as it opens; a transport with no `close` is left alone, and its
 * lead's departure is found by a follower's ping.
 */
function sayByeOnClose(socket, leave) {
  const transport = socket.io?.engine?.transport;
  if (!transport || typeof transport.close !== "function" || byeOnClose.has(transport)) return;
  const close = transport.close;
  transport.close = function closeAfterBye(...args) {
    leave();
    return close.apply(this, args);
  };
  byeOnClose.add(transport);
}
