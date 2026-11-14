/**
 * Shared identifiers for the bridge. Foundry-free, so the pure logic and the
 * Node tests can import them.
 */
export { MODULE_ID } from "../lib/constants.mjs";

/** The feature's lang root. */
export const LANG = "ACKS-BRIDGE";

/**
 * Hidden world setting holding the binding store: external identity to Foundry
 * user, external channel to party, user to active character. Edited through the
 * api and the Judge's `link` / `party` commands.
 */
export const SETTING_BINDINGS = "bridgeBindings";

/**
 * Hidden world setting holding the client's configuration: Discord server,
 * relay channel, seat size, and the bot's token sealed to the key the seat
 * published. Written by the Judge's config window, read by the client through
 * the `config` command.
 */
export const SETTING_CLIENT = "bridgeClient";

/**
 * Hidden world setting the CLIENT writes and the config window reads: the
 * public key a token is sealed to, what the client can see of itself, and how
 * it is faring.
 */
export const SETTING_AGENT = "bridgeAgent";

/**
 * Flag key under `flags["acks-extras"]` stamped on every document a bridge
 * command writes and every chat message a command's roll posts.
 */
export const BRIDGE_FLAG = "bridge";

/**
 * The global function a seat holder installs (a DevTools `Runtime.addBinding`)
 * to receive events as they happen. Absent, the tap only buffers, and `drain`
 * still answers a seat that connects late.
 */
export const EMIT_BINDING = "acksExtrasBridgeEmit";

/** Client kinds a binding may name. */
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
  // Registered and permitted, but this seat cannot serve it; unlike `failed`, retrying will not help.
  unavailable: "unavailable",
  failed: "failed",
});
