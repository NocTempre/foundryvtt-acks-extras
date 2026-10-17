/**
 * Which window of a seat automates: the Foundry-free half.
 *
 * Every window joined on one user hears every hook, so a seat with two
 * windows open elects one of them. The windows talk over a channel that
 * delivers each message to every window of the seat, the sender's own
 * included, in the one order the server handles messages in — the order every
 * document event reaches them in too. The lead is the window the LAST claim
 * named, applied by every window in the one handler that reads it, so for any
 * event the server broadcasts the seat's windows agree which claim came
 * before it. No timer decides who leads; timers decide only how soon a
 * missing lead is replaced, and a spurious claim moves the lead without ever
 * making two.
 *
 * Messages are `{op, from}`, `from` the sending window's id:
 * - `hello` — a window joining. The lead answers `here`. Sent by the window
 *   believed to lead, it means that window left the lead (a reconnect), so a
 *   follower claims.
 * - `here` — the lead answering a `hello` or a `ping`. It names the lead to a
 *   window that has heard no claim, and proves the lead alive to a follower
 *   that believes it leads; it never changes a lead already known.
 * - `claim` — the only message that changes the lead.
 * - `ping` — a follower asking whether the lead is alive.
 * - `bye` — the lead's page unloading. It changes nothing by itself: a
 *   follower hearing it claims, and a cancelled unload needs no repair.
 */

/** How long a joining window waits for a lead, and how a follower watches it, in ms. */
export const SEAT_TIMINGS = Object.freeze({ joinWaitMs: 3000, pingEveryMs: 15000, pingWaitMs: 5000 });

/** The election's message ops. */
export const SEAT_OPS = Object.freeze({ HELLO: "hello", HERE: "here", CLAIM: "claim", PING: "ping", BYE: "bye" });

const { HELLO, HERE, CLAIM, PING, BYE } = SEAT_OPS;

/**
 * One window's part in its seat's election. Nothing happens until `join`.
 *
 * @param {object} o
 * @param {string} o.selfId  this window's id, unique to the page load
 * @param {(op: string) => boolean} o.send  sends `{op, from: selfId}` to every
 *   window of the seat, this one included; false when nothing could be sent
 * @param {Function} [o.schedule]  `setTimeout`'s shape
 * @param {Function} [o.cancel]  `clearTimeout`'s shape
 * @param {{joinWaitMs: number, pingEveryMs: number, pingWaitMs: number}} [o.timings]
 * @returns {{join: Function, receive: Function, disconnected: Function, leave: Function,
 *   isLead: () => boolean, census: () => object, settled: Promise<boolean>}}
 *   `settled` resolves once, with whether this window led when it first knew
 *   who leads.
 */
export function createSeatElection({ selfId, send, schedule = setTimeout, cancel = clearTimeout, timings = SEAT_TIMINGS }) {
  let joined = false;
  let lead = null;
  let claiming = false;
  let heard = false;
  let byeSent = false;
  let joinTimer = null;
  let pingTimer = null;
  let waitTimer = null;
  let isSettled = false;
  let resolveSettled = null;
  const settled = new Promise((resolve) => (resolveSettled = resolve));

  const settle = () => {
    if (isSettled) return;
    isSettled = true;
    resolveSettled(lead === selfId);
  };

  const stop = (timer) => {
    if (timer != null) cancel(timer);
    return null;
  };

  const stopTimers = () => {
    joinTimer = stop(joinTimer);
    pingTimer = stop(pingTimer);
    waitTimer = stop(waitTimer);
  };

  function claim() {
    if (!joined || claiming) return;
    claiming = send(CLAIM);
  }

  // A follower's watch on the lead. The lead runs none: it answers from the
  // message handler, so a timer throttled in a background tab cannot unseat it.
  function watch() {
    if (pingTimer != null || waitTimer != null) return;
    pingTimer = schedule(function tick() {
      pingTimer = null;
      if (!joined || lead === selfId) return;
      const asked = lead;
      heard = false;
      if (send(PING)) {
        waitTimer = schedule(() => {
          waitTimer = null;
          if (joined && lead === asked && !heard) claim();
          else watch();
        }, timings.pingWaitMs);
      } else pingTimer = schedule(tick, timings.pingEveryMs);
    }, timings.pingEveryMs);
  }

  function follow(id) {
    lead = id;
    joinTimer = stop(joinTimer);
    watch();
    settle();
  }

  function applyClaim(from) {
    lead = from;
    joinTimer = stop(joinTimer);
    if (from === selfId) {
      claiming = false;
      byeSent = false;
      pingTimer = stop(pingTimer);
      waitTimer = stop(waitTimer);
    } else watch();
    settle();
  }

  return {
    settled,

    /** Joins (or rejoins) the seat: no lead is known until a claim or an answer names one. */
    join() {
      stopTimers();
      joined = true;
      lead = null;
      claiming = false;
      if (!send(HELLO)) return;
      joinTimer = schedule(() => {
        joinTimer = null;
        if (joined && lead === null) claim();
      }, timings.joinWaitMs);
    },

    /** One message from a window of this seat (this window's own included). */
    receive({ op, from } = {}) {
      if (!joined || typeof from !== "string" || !from) return;
      switch (op) {
        case CLAIM:
          applyClaim(from);
          return;
        case HELLO:
          if (from === selfId) return;
          if (lead === selfId) send(HERE);
          else if (from === lead) {
            lead = null;
            claim();
          }
          return;
        case PING:
          if (from !== selfId && lead === selfId) send(HERE);
          return;
        case HERE:
          if (from === selfId) return;
          if (from === lead) heard = true;
          else if (lead === null && !claiming) follow(from);
          return;
        case BYE:
          if (from !== selfId && from === lead) claim();
          return;
      }
    },

    /** The connection dropped: this window leads no longer and waits to rejoin. */
    disconnected() {
      stopTimers();
      joined = false;
      lead = null;
      claiming = false;
    },

    /** The page is unloading: the lead says so, once, and changes nothing else. */
    leave() {
      if (!joined || lead !== selfId || byeSent) return;
      byeSent = send(BYE);
    },

    /** Whether this window is the one its seat elected. */
    isLead: () => joined && lead === selfId,

    /** What this window believes, for a diagnostic read. */
    census: () => ({ selfId, lead, joined, isLead: joined && lead === selfId, settled: isSettled }),
  };
}
