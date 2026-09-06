/* global game */
/**
 * The client's configuration on Foundry: two hidden world settings, one
 * writer each, and the two commands the client reads and announces through.
 *
 * The window writes `bridgeClient` — the Judge's answers, with the bot token
 * sealed to the key the client published. The client writes `bridgeAgent` —
 * its key, what it can see of itself, how it is faring. Neither side edits
 * the other's record, so a browser saving the form and a bot announcing at
 * the same moment cannot lose each other's fields.
 *
 * `revision` rises on every save. A client compares `configDigest`, not the
 * revision, before restarting: a form saved with nothing changed must not
 * bounce a running bot.
 */
import { MODULE_ID, SETTING_CLIENT, SETTING_AGENT } from "./constants.mjs";
import { emptyClientConfig, normalizeClientConfig, emptyAgent, normalizeAgent } from "./client-config-logic.mjs";

/** Register both hidden world settings. Called once at `init`. */
export function registerClientConfigSettings() {
  game.settings.register(MODULE_ID, SETTING_CLIENT, { scope: "world", config: false, type: Object, default: emptyClientConfig() });
  game.settings.register(MODULE_ID, SETTING_AGENT, { scope: "world", config: false, type: Object, default: emptyAgent() });
}

/** The configuration as it stands. */
export const readClientConfig = () => normalizeClientConfig(game.settings.get(MODULE_ID, SETTING_CLIENT));

/** The client's own announcement as it stands. */
export const readAgent = () => normalizeAgent(game.settings.get(MODULE_ID, SETTING_AGENT));

/**
 * Persist a configuration built by the window. The revision and the stamp
 * are this function's to set, never the form's.
 */
export async function writeClientConfig(config) {
  const next = normalizeClientConfig(config);
  next.revision = readClientConfig().revision + 1;
  next.updatedAt = Date.now();
  await game.settings.set(MODULE_ID, SETTING_CLIENT, next);
  return readClientConfig();
}

/**
 * Ask a running client to restart: the stamp moves, the digest moves with
 * it, and the client leaves for its service manager to bring back. Nothing
 * on the host is reached — a client that is not running hears nothing, which
 * is why the window offers this only while one has been heard from.
 */
export async function requestRestart() {
  return writeClientConfig({ ...readClientConfig(), restartNonce: Date.now() });
}

/**
 * Persist what a client announces about itself. Fields absent from `patch`
 * keep the value they had, so a client can report a status without
 * re-sending its catalogue.
 */
export async function writeAgent(patch) {
  const next = normalizeAgent({ ...readAgent(), ...(patch && typeof patch === "object" ? patch : {}), seenAt: Date.now() });
  await game.settings.set(MODULE_ID, SETTING_AGENT, next);
  return readAgent();
}

/**
 * The two commands the client itself calls, both as the seat: `config` reads
 * the pair, `announce` writes the client's half and answers the pair, so one
 * round trip both reports and refreshes.
 *
 * Judge commands: a client reaches them with `asSeat`, whose user is the
 * seat's own Assistant GM. No bound member ever needs them, and a member
 * whose user is a GM sees only what the settings UI would already show them.
 */
export function registerClientConfigCommands(registry) {
  registry.register("config", {
    judge: true,
    describe: "the client's configuration and its own last announcement",
    run: () => ({ config: readClientConfig(), agent: readAgent() }),
  });

  registry.register("announce", {
    judge: true,
    describe: "record what this client is, sees and is doing; answers the configuration",
    run: async (ctx, args) => {
      const agent = await writeAgent(args.agent);
      return { config: readClientConfig(), agent };
    },
  });
}
