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
 * World setting holding the client's own configuration — which Discord
 * server, which relay channel, how the seat is sized, and the bot's token
 * sealed to the key the seat published. Written by the Judge's config window
 * and read by the client through the `config` command. Hidden from the
 * settings UI: the window owns it.
 */
export const SETTING_CLIENT = "bridgeClient";

/**
 * World setting the CLIENT writes and the config window reads: the public
 * key a token is sealed to, what the client can see of itself (its
 * application, the servers and channels it reaches) and how it is faring.
 * A client announces; nobody edits this by hand.
 */
export const SETTING_AGENT = "bridgeAgent";

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
  // The command is registered and the caller is entitled to it, but this seat
  // cannot serve it. Distinct from `failed` because nothing is wrong and
  // retrying will not help — the client says so instead of offering hope.
  unavailable: "unavailable",
  failed: "failed",
});
