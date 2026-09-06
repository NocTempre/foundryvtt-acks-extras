/**
 * Entry: take the seat, put the commands on the guild, then answer Discord.
 *
 * The seat comes first and its first life must succeed — a wrong browser
 * path, no world, a misspelt user — so the operator sees the misconfiguration
 * at once rather than a bot that is online and answers nothing. Registration
 * is best effort: a guild keeps the commands it has, and a bad token fails
 * the login right after, where it is reported.
 *
 * The bot also watches the module it lives in and leaves cleanly when
 * Foundry's updater replaces it; the service manager starts the new one.
 */
import { loadConfig } from "./config.mjs";
import { createLog } from "./log.mjs";
import { Seat } from "./seat.mjs";
import { Bridge } from "./bridge.mjs";
import { createBot } from "./bot.mjs";
import { attachRelay } from "./relay.mjs";
import { commands } from "./commands/index.mjs";
import { registerGuildCommands, stateDirectory } from "./register.mjs";
import { watchModule } from "./update-watch.mjs";

const config = loadConfig();
const log = createLog(config.logLevel);

const seat = new Seat({ ...config.seat, ...config.foundry }, log);
seat.on("down", (reason) => log.warn(`seat: ${reason}`));
await seat.start();

try {
  await registerGuildCommands({ config, commands, stateDir: stateDirectory(), log });
} catch (err) {
  log.warn(`commands: registration failed (${err.message}); the guild keeps what it had`);
}

const bridge = new Bridge(seat);
const bot = createBot({ config, bridge, seat, log, commands });
attachRelay({ seat, client: bot.client, config, log });

let leaving = false;
const shutdown = async (reason) => {
  if (leaving) return;
  leaving = true;
  log.info(`${reason}: shutting down`);
  try {
    await bot.stop();
  } catch {
    /* already gone */
  }
  await seat.stop();
  process.exit(0);
};
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => shutdown(s));
watchModule({
  log,
  onChange: (change) => shutdown(change.reason === "version" ? `module updated ${change.from} → ${change.to}; restarting on the new code` : "module directory replaced; restarting on the new files"),
});

await bot.login();
