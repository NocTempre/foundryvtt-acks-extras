/**
 * Shared identifiers for the bridge. Foundry-free, so the pure logic and the
 * Node tests can import them.
 */
export { MODULE_ID } from "../lib/constants.mjs";

/** The feature's lang root. */
export const LANG = "ACKS-BRIDGE";

/**
 * World setting holding the binding store: which external identity is which
 * Foundry user, which external channel is which party, which character each
 * user is speaking as. Hidden from the settings UI — it is edited through the
 * api and the Judge's `link` / `party` commands, never by hand.
 */
export const SETTING_BINDINGS = "bridgeBindings";

/**
 * Flag key under `flags["acks-extras"]` stamped on every document a bridge
 * command writes, and on every chat message a command's roll posts. A write
 * made from outside Foundry stays identifiable after the session is gone.
 */
export const BRIDGE_FLAG = "bridge";

/**
 * The global function a seat holder installs (a DevTools `Runtime.addBinding`)
 * to receive events as they happen. Absent, the tap only buffers, and `drain`
 * still answers a seat that connects late.
 */
export const EMIT_BINDING = "acksExtrasBridgeEmit";

/** Client kinds a binding may name. Discord is the first; the store is keyed so a second can share it. */
export const CLIENT_KINDS = Object.freeze(["discord"]);

/** Events kept in the page for a seat that reconnects and drains what it missed. */
export const EVENT_BUFFER = 200;

/**
 * Error codes a command answers with. Words the client maps to its own text —
 * never shown raw, never localized here.
 */
export const ERR = Object.freeze({
  unknownCommand: "unknownCommand",
  unbound: "unbound",
  forbidden: "forbidden",
  notFound: "notFound",
  noActive: "noActive",
  invalid: "invalid",
  failed: "failed",
});
