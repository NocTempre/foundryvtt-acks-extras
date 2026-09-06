/**
 * Configuration, in two layers. This file is the bootstrap one: where
 * Foundry is, who to join as, and which browser the seat runs in — the least
 * a bot needs to reach a world, and the only layer that cannot come from
 * inside it. Everything a Judge sets (the token, the server, the relay
 * channel, the seat's size) is read from the world once the seat is up, in
 * `world-config.mjs`, and the environment wins wherever it carries a value.
 *
 * Secrets never live in a file this repo tracks: `.env` is gitignored and
 * loaded when present.
 *
 * `fromEnv` is pure so the tests can hand it an object; `loadConfig` reads
 * the process.
 */
import fs from "node:fs";
import { findBrowser } from "./browsers.mjs";

/** The global the bridge installs its event push through — must match the module's constant. */
export const EMIT_BINDING = "acksExtrasBridgeEmit";

/** Bridge commands that run as the seat when an operator-listed Judge calls them. */
export const JUDGE_COMMANDS = Object.freeze(["link", "unlink", "enroll", "bindings", "users", "parties", "party", "map"]);

const need = (env, key) => {
  const v = String(env[key] ?? "").trim();
  if (!v) throw new Error(`config: ${key} is required`);
  return v;
};
const opt = (env, key, fallback = "") => {
  const v = String(env[key] ?? "").trim();
  return v || fallback;
};
const int = (env, key, fallback) => {
  const v = Number(env[key]);
  return Number.isInteger(v) && v > 0 ? v : fallback;
};

/**
 * Build the config from an environment-shaped object. The Discord half is
 * optional by default now that the world carries it: a bot with no token in
 * its environment starts, takes its seat and waits to be configured.
 * @param {object} env
 * @param {{ discord?: boolean, browser?: boolean, browserAt?: Function }} [require]
 */
export function fromEnv(env, { discord = false, browser = true, browserAt = findBrowser } = {}) {
  const foundBrowser = opt(env, "BROWSER") || browserAt();
  if (browser && !foundBrowser) throw new Error(`config: BROWSER is required — no Chromium-family browser was found in the usual places`);
  const judgeIds = new Set(
    opt(env, "DISCORD_JUDGE_IDS")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  return {
    discord: {
      token: discord ? need(env, "DISCORD_TOKEN") : opt(env, "DISCORD_TOKEN"),
      appId: discord ? need(env, "DISCORD_APP_ID") : opt(env, "DISCORD_APP_ID"),
      guildId: discord ? need(env, "DISCORD_GUILD_ID") : opt(env, "DISCORD_GUILD_ID"),
      judgeIds,
      chatChannelId: opt(env, "DISCORD_CHAT_CHANNEL_ID") || null,
    },
    foundry: {
      origin: opt(env, "FOUNDRY_ORIGIN", "http://localhost:30000").replace(/\/+$/, ""),
      user: opt(env, "FOUNDRY_USER", "Discord"),
      password: String(env.FOUNDRY_PASSWORD ?? ""),
    },
    seat: {
      browser: foundBrowser,
      port: int(env, "SEAT_PORT", 9334),
      width: int(env, "SEAT_WIDTH", 1600),
      height: int(env, "SEAT_HEIGHT", 1000),
      readySeconds: int(env, "SEAT_READY_SECONDS", 120),
      browserArgs: opt(env, "SEAT_BROWSER_ARGS")
        .split(/\s+/)
        .map((s) => s.trim())
        .filter(Boolean),
      bindingName: EMIT_BINDING,
    },
    logLevel: opt(env, "LOG_LEVEL", "info"),
  };
}

/** The file the installed service reads; a by-hand run reads it too when no `.env` sits beside `src/`. */
export const SERVICE_ENV_FILE = "/etc/acks-extras-discord.env";

/**
 * Build from `process.env`, first loading `.env` from the working directory
 * or, failing that, the service's own file (Node's loader; values already in
 * the environment win). An unreadable service file is not an error: under
 * systemd the values arrive through the unit, and by hand `sudo` reads it.
 */
export function loadConfig(options, { serviceFile = process.env.ACKS_DISCORD_ENV || SERVICE_ENV_FILE } = {}) {
  if (fs.existsSync(".env")) process.loadEnvFile(".env");
  else if (serviceFile && fs.existsSync(serviceFile)) {
    try {
      process.loadEnvFile(serviceFile);
    } catch {
      /* root-only and we are not root: the unit hands the values over itself */
    }
  }
  return fromEnv(process.env, options);
}
