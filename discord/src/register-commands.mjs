/**
 * Put the slash commands on the guild now, whether or not they changed. The
 * running bot does the same at every start when its digest says they did;
 * this is the by-hand form for after Discord lost them.
 *
 * It reads the environment, not the world: a bot configured in Foundry needs
 * a seat to know its own token, and the bot that holds one registers for
 * itself. Set DISCORD_TOKEN, DISCORD_APP_ID and DISCORD_GUILD_ID to use it.
 *
 *   npm run register
 */
import { loadConfig } from "./config.mjs";
import { commands } from "./commands/index.mjs";
import { registerGuildCommands, stateDirectory } from "./register.mjs";

const config = loadConfig({ browser: false, discord: true });
const result = await registerGuildCommands({ config, commands, stateDir: stateDirectory(), force: true });
console.log(`registered ${result.count} command(s) on guild ${config.discord.guildId}: ${result.names.join(" ")}`);
