/**
 * Put the slash commands on the guild now, whether or not they changed. The
 * running bot does the same at every start when its digest says they did;
 * this is the by-hand form for after Discord lost them (the bot was kicked
 * and reinvited, or is now pointed at a different server).
 *
 * A bot configured in Foundry keeps its token and its server sealed in the
 * world, not on this host — `install-service.mjs` strips them from the
 * environment file on purpose, because they are Foundry's to hold once a
 * Judge has set them. So when the environment does not already have what it
 * needs, this takes a seat and reads `bridgeClient` the way `main.mjs`
 * boots: `ensureKeyPair` for the sealing key, `readWorld` for the
 * configuration, `openToken` to unseal it, `applyWorldConfig` to fold it in
 * — with the environment winning wherever it already carries a value, so a
 * dev run with `DISCORD_TOKEN`/`DISCORD_APP_ID`/`DISCORD_GUILD_ID` set never
 * needs a world at all.
 *
 *   npm run register
 */
import { REST, Routes } from "discord.js";
import { fromEnv, loadConfig } from "./config.mjs";
import { createLog } from "./log.mjs";
import { Seat } from "./seat.mjs";
import { Bridge } from "./bridge.mjs";
import { commands } from "./commands/index.mjs";
import { registerGuildCommands, stateDirectory } from "./register.mjs";
import { ensureKeyPair, readWorld, openToken, applyWorldConfig } from "./world-config.mjs";
import { isMain } from "./entry.mjs";

/** Whether the environment alone has enough to register: a token and a guild. `bridgeClient` never carries an application id — see `appIdFor`. Pure. */
export const needsWorldLookup = (discord) => !discord?.token || !discord?.guildId;

/**
 * Fill in what the environment left empty by joining the seat and reading
 * the world's configuration, exactly as `main.mjs` boots. Left to the
 * caller: the seat's own config (so a test can hand it a fake one) and a
 * factory for the seat and the bridge, so a test never launches a browser.
 * @param {{ config: object, stateDir: string, log: object, seatFactory?: Function, bridgeFactory?: Function }} opts
 */
export async function resolveViaWorld({ config, stateDir, log, seatFactory = (c, l) => new Seat(c, l), bridgeFactory = (s) => new Bridge(s) }) {
  const seat = seatFactory({ ...config.seat, ...config.foundry }, log);
  await seat.start();
  try {
    const bridge = bridgeFactory(seat);
    const keys = await ensureKeyPair(stateDir);
    const { config: world } = await readWorld(bridge);
    return applyWorldConfig(config, world, await openToken(world, keys, log));
  } finally {
    await seat.stop();
  }
}

/**
 * The application id for a token, read straight over REST — `bridgeClient`
 * has nowhere to keep it (nothing there needs it), and the running bot only
 * ever gets it for free because a logged-in gateway client carries its own
 * application. A plain token is enough for the same fact without one.
 */
export async function appIdFor(token, restFactory = (t) => new REST().setToken(t)) {
  const app = await restFactory(token).get(Routes.currentApplication());
  return app.id;
}

async function main() {
  const stateDir = stateDirectory();
  let settings = loadConfig({ discord: false, browser: false });

  if (needsWorldLookup(settings.discord)) {
    const log = createLog(settings.logLevel);
    console.log("register: no token or server in the environment — taking the seat to read Foundry's configuration…");
    settings = await resolveViaWorld({ config: fromEnv(process.env, { discord: false, browser: true }), stateDir, log });
  }
  if (needsWorldLookup(settings.discord)) {
    console.error("register: DISCORD_TOKEN and DISCORD_GUILD_ID are not set, and Foundry has none configured yet (Settings → Extras → Discord Bot). Set them, or configure the bot there first.");
    process.exit(2);
  }
  if (!settings.discord.appId) settings.discord.appId = await appIdFor(settings.discord.token);

  const result = await registerGuildCommands({ config: settings, commands, stateDir, force: true });
  console.log(`registered ${result.count} command(s) on guild ${settings.discord.guildId}: ${result.names.join(" ")}`);
}

if (isMain(import.meta.url)) await main();
