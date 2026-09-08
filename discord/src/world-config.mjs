/**
 * The configuration the bot reads out of the world.
 *
 * Everything a Judge would otherwise have typed on the host lives in a
 * hidden world setting the module's config window writes. The bot reads it
 * through its own seat, which is why the seat comes first and why the two
 * values that get the seat there — where Foundry is and who to join as —
 * stay in the environment: a bot that cannot join cannot be told anything.
 *
 * The token cannot travel in the clear. Foundry vends every world setting to
 * every connected client, so a token typed into a window would be a token
 * any player could read out of their console. The bot therefore keeps a key
 * pair in its own state directory, publishes only the public half, and the
 * window seals to it — `scripts/bridge/sealing.mjs`, the one implementation
 * both halves run.
 *
 * The environment still wins wherever it is set: an existing install, a
 * Windows run by hand and a scripted test all keep working untouched.
 */
import fs from "node:fs";
import path from "node:path";
import { generateSealingPair, unseal, keyIdOf } from "../../scripts/bridge/sealing.mjs";
import { normalizeClientConfig, normalizeAgent, configDigest } from "../../scripts/bridge/client-config-logic.mjs";

export { configDigest };

/** How often the bot re-reads the configuration when no event has told it to. */
export const CONFIG_POLL_MS = 30_000;

/** What a catalogue may carry, so one busy server cannot bloat the setting. */
export const CATALOGUE_CAP = Object.freeze({ guilds: 25, channels: 200 });

const KEY_FILE = "client-key.json";
const CACHE_FILE = "world-config.json";

const has = (env, key) => String(env?.[key] ?? "").trim() !== "";

/**
 * The bot's key pair, generated once and kept in the state directory —
 * outside the module directory the updater replaces, so a module update
 * never invalidates a token a Judge already sealed.
 */
export async function ensureKeyPair(stateDir) {
  const file = path.join(stateDir, KEY_FILE);
  if (fs.existsSync(file)) {
    try {
      const stored = JSON.parse(fs.readFileSync(file, "utf8"));
      if (stored?.publicKey?.n && stored?.privateKey?.d) return stored;
    } catch {
      /* unreadable or half written: mint a new pair over it */
    }
  }
  const pair = await generateSealingPair();
  const record = { keyId: keyIdOf(pair.publicKey), ...pair };
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600);
  } catch {
    /* a filesystem without modes (a Windows share): the file is still only in the service's own directory */
  }
  return record;
}

/** The last configuration this bot saw, for the seat it must build before it can read the world. */
export function readCache(stateDir) {
  try {
    return normalizeClientConfig(JSON.parse(fs.readFileSync(path.join(stateDir, CACHE_FILE), "utf8")));
  } catch {
    return normalizeClientConfig(null);
  }
}

/** Remember a configuration for the next start. Best effort: a bot that cannot cache still runs. */
export function writeCache(stateDir, config) {
  try {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(path.join(stateDir, CACHE_FILE), JSON.stringify(normalizeClientConfig(config)));
  } catch {
    /* nothing here is authoritative */
  }
}

/** Read the pair of records the world holds. */
export async function readWorld(bridge) {
  const answer = await bridge.run("config", { asSeat: true });
  return { config: normalizeClientConfig(answer?.config), agent: normalizeAgent(answer?.agent) };
}

/** Announce what this client is and how it is faring; answers the same pair back. */
export async function announce(bridge, patch) {
  const answer = await bridge.run("announce", { asSeat: true, agent: patch });
  return { config: normalizeClientConfig(answer?.config), agent: normalizeAgent(answer?.agent) };
}

/** The token a Judge sealed, or "" when none is stored or it was sealed to another key. */
export async function openToken(config, keys, log) {
  const sealed = normalizeClientConfig(config).token.sealed;
  if (!sealed) return "";
  try {
    return await unseal(keys.privateKey, sealed);
  } catch {
    log?.warn("config: the stored token was sealed to a different key; set it again in Foundry");
    return "";
  }
}

/**
 * Fold the world's configuration into the environment-built one. The
 * environment wins wherever it carries a value, so nothing an operator set
 * on the host is quietly overruled by a window.
 * @param {object} config  the config `fromEnv` built (mutated in place and returned)
 * @param {object} world   the world's configuration
 * @param {string} token   the opened token, or ""
 * @param {object} [env]   the environment that built `config`
 */
export function applyWorldConfig(config, world, token, env = process.env) {
  const w = normalizeClientConfig(world);
  if (!has(env, "DISCORD_TOKEN") && token) config.discord.token = token;
  if (!has(env, "DISCORD_GUILD_ID") && w.discord.guildId) config.discord.guildId = w.discord.guildId;
  if (!has(env, "DISCORD_CHAT_CHANNEL_ID")) config.discord.chatChannelId = w.discord.relay ? w.discord.chatChannelId || null : null;
  if (!has(env, "DISCORD_JUDGE_IDS")) config.discord.judgeIds = new Set(w.discord.judgeIds);
  if (!has(env, "SEAT_WIDTH")) config.seat.width = w.seat.width;
  if (!has(env, "SEAT_HEIGHT")) config.seat.height = w.seat.height;
  if (!has(env, "SEAT_READY_SECONDS")) config.seat.readySeconds = w.seat.readySeconds;
  if (!has(env, "SEAT_GPU")) config.seat.gpu = w.seat.gpu;
  if (!has(env, "LOG_LEVEL")) config.logLevel = w.service.logLevel;
  return config;
}

/** What a client can see of itself, for the window's dropdowns. */
export function catalogueOf(client) {
  const guilds = [];
  const channels = [];
  for (const g of client.guilds?.cache?.values() ?? []) {
    if (guilds.length >= CATALOGUE_CAP.guilds) break;
    guilds.push({ id: g.id, name: g.name });
    for (const ch of g.channels?.cache?.values() ?? []) {
      if (channels.length >= CATALOGUE_CAP.channels) break;
      const sendable = typeof ch.isSendable === "function" ? ch.isSendable() : ch.isTextBased?.();
      if (sendable && !ch.isThread?.()) channels.push({ id: ch.id, name: ch.name, guildId: g.id });
    }
  }
  return { guilds, channels };
}

/**
 * Wait until the world's configuration differs from `digest`, then answer
 * the new pair. An event says so the moment a Judge saves; the poll is the
 * floor under a seat that reconnected and missed one.
 * @param {{ seat: object, bridge: object, digest: string, log?: object, pollMs?: number, signal?: {stopped: boolean} }} opts
 */
export async function waitForConfigChange({ seat, bridge, digest, log, pollMs = CONFIG_POLL_MS }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (pair) => {
      if (done) return;
      done = true;
      clearInterval(timer);
      seat.off("event", onEvent);
      resolve(pair);
    };
    const check = async () => {
      if (done) return;
      try {
        const pair = await readWorld(bridge);
        if (configDigest(pair.config) !== digest) finish(pair);
      } catch (err) {
        log?.warn(`config: re-read failed (${err.message})`);
      }
    };
    const onEvent = (ev) => {
      if (ev?.type === "config") check();
    };
    seat.on("event", onEvent);
    const timer = setInterval(check, pollMs);
    timer.unref?.();
  });
}
