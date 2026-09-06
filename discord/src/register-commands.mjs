/**
 * Put the slash commands on the guild now, whether or not they changed. The
 * running bot does the same at every start when its digest says they did;
 * this is the by-hand form for a first install without the service, or
 * after Discord lost them.
 *
 *   npm run register
 */
import { loadConfig } from "./config.mjs";
import { commands } from "./commands/index.mjs";
import { registerGuildCommands, stateDirectory } from "./register.mjs";

const config = loadConfig({ browser: false });
const result = await registerGuildCommands({ config, commands, stateDir: stateDirectory(), force: true });
console.log(`registered ${result.count} command(s) on guild ${config.discord.guildId}: ${result.names.join(" ")}`);
