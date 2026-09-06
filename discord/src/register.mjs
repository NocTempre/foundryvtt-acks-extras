/**
 * Registration of the slash commands on the guild: from the running bot at
 * every start, and from `npm run register` on demand. Guild commands apply
 * at once, and Discord counts registrations, so the bot keeps a digest of
 * the last body it sent and skips the PUT when nothing changed.
 */
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { REST, Routes } from "discord.js";

/** The bodies Discord receives, in command order. */
export const commandBody = (commands) => commands.map((c) => c.data.toJSON());

/** A stable digest of a registration body. */
export const digest = (body) => createHash("sha256").update(JSON.stringify(body)).digest("hex");

/** Whether a body must be sent, given the digest of the last one sent (null when none). */
export const needsRegistration = (sha, stored) => !stored || stored.trim() !== sha;

/** Where the bot keeps its own small state: systemd's StateDirectory, else a dot-directory under HOME. */
export const stateDirectory = (env = process.env) => env.STATE_DIRECTORY || path.join(os.homedir(), ".acks-extras-discord");

/**
 * Register unless the stored digest says the guild already holds this body.
 * @param {{ config: object, commands: object[], stateDir?: string|null, force?: boolean, log?: object, rest?: { put: Function } }} opts
 * @returns {Promise<{ registered: boolean, count: number, names?: string[] }>}
 */
export async function registerGuildCommands({ config, commands, stateDir = null, force = false, log, rest }) {
  const body = commandBody(commands);
  const sha = digest(body);
  const marker = stateDir ? path.join(stateDir, "commands.sha256") : null;
  const stored = marker && fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : null;
  if (!force && !needsRegistration(sha, stored)) {
    log?.info(`commands: the guild already holds these ${body.length}; nothing to register`);
    return { registered: false, count: body.length };
  }
  const client = rest ?? new REST().setToken(config.discord.token);
  const result = await client.put(Routes.applicationGuildCommands(config.discord.appId, config.discord.guildId), { body });
  if (marker) {
    fs.mkdirSync(stateDir, { recursive: true });
    fs.writeFileSync(marker, sha);
  }
  const names = result.map((c) => `/${c.name}`);
  log?.info(`commands: registered ${names.length} on guild ${config.discord.guildId}: ${names.join(" ")}`);
  return { registered: true, count: names.length, names };
}
