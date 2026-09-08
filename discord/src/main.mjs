/**
 * Entry: take the seat, read what the world says this bot is, then answer
 * Discord.
 *
 * The seat comes first and its first life must succeed — a wrong browser
 * path, no world, a misspelt user — so the operator sees the misconfiguration
 * at once rather than a bot that is online and answers nothing. It is also
 * how everything else arrives: the token, the server, the relay channel and
 * the seat's own size are read from the world through it, so a Judge
 * configures the bot in Foundry and never on the host.
 *
 * A bot with nothing to log in with is not an error. It announces itself,
 * says it is waiting, and sits on its seat until a Judge saves the window —
 * which it hears as an event, not a poll.
 *
 * Two things end the process, both cleanly and both for the service manager
 * to restart: the module directory being replaced by Foundry's updater, and
 * the configuration changing under a bot already running on it.
 */
import { Events } from "discord.js";
import { loadConfig } from "./config.mjs";
import { createLog } from "./log.mjs";
import { Seat, sleep, reconnectDelay } from "./seat.mjs";
import { Bridge } from "./bridge.mjs";
import { createBot } from "./bot.mjs";
import { attachRelay } from "./relay.mjs";
import { commands } from "./commands/index.mjs";
import { registerGuildCommands, stateDirectory } from "./register.mjs";
import { watchModule, moduleJsonPath, readManifest } from "./update-watch.mjs";
import { ensureKeyPair, readCache, writeCache, announce, openToken, applyWorldConfig, catalogueOf, configDigest, waitForConfigChange } from "./world-config.mjs";
import { noteMember } from "../../scripts/bridge/client-config-logic.mjs";
import { adoptGuild } from "./guild-adopt.mjs";

/** How often the bot says it is still there, so the window can show when it was last heard from. */
const HEARTBEAT_MS = 10 * 60 * 1000;
/** How long after a new member knocks the bot announces them — long enough to fold a burst of first commands into one write. */
const MEMBER_ANNOUNCE_MS = 3000;

const stateDir = stateDirectory();
const version = readManifest(moduleJsonPath())?.version ?? "";

// The seat has to be built before the world can be read, so it is built on
// what the world said last time. A first-ever start uses the defaults.
const cached = readCache(stateDir);
const bootstrap = applyWorldConfig(loadConfig(), cached, "");
const log = createLog(bootstrap.logLevel);

const seat = new Seat({ ...bootstrap.seat, ...bootstrap.foundry }, log);
seat.on("down", (reason) => log.warn(`seat: ${reason}`));
await seat.start();

const bridge = new Bridge(seat);
const keys = await ensureKeyPair(stateDir);
const identity = { kind: "discord", version, keyId: keys.keyId, publicKey: keys.publicKey };
const state = (code, message = "") => ({ ...identity, status: { state: code, message, at: Date.now() } });

// Leaving is armed before anything can take a while, so a bot still waiting
// to be configured still answers a signal and still follows a module update.
// `code` tells the two paths apart in the journal: 0 for a shutdown this
// process chose (a signal, a module update, a configuration change), 1 for
// one an unhandled failure forced.
let bot = null;
let leaving = false;
const shutdown = async (reason, code = 0) => {
  if (leaving) return;
  leaving = true;
  log.info(`${reason}: shutting down`);
  try {
    await bot?.stop();
  } catch {
    /* already gone */
  }
  await seat.stop();
  process.exit(code);
};
for (const s of ["SIGINT", "SIGTERM"]) process.on(s, () => shutdown(s));
watchModule({
  log,
  onChange: (change) => shutdown(change.reason === "version" ? `module updated ${change.from} → ${change.to}; restarting on the new code` : "module directory replaced; restarting on the new files"),
});

// A rejection or a throw nothing local caught used to fall straight through
// to the process and exit whatever the runtime does with an unhandled one —
// no seat teardown, and on Windows the profile directory and the browser it
// pointed at outlive it. Both land here instead: logged, the seat and the
// Discord client taken down the same way a signal takes them down, and a
// non-zero exit so the difference shows in the journal.
process.on("unhandledRejection", (reason) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  log.error(`unhandled rejection: ${err.message}`, err);
  shutdown("unhandled rejection", 1);
});
process.on("uncaughtException", (err) => {
  log.error(`uncaught exception: ${err.message}`, err);
  shutdown("uncaught exception", 1);
});

// The world may not be reachable the moment this starts — a restart mid
// deploy, a slow world boot, a timed-out first call — and that is not a
// reason to hand the failure to the service manager as a crash. Retry with
// the seat's own backoff and keep the seat, the way a missing token already
// keeps it below.
let world;
let known;
for (let attempt = 0; ; attempt++) {
  try {
    ({ config: world, agent: known } = await announce(bridge, state("starting")));
    break;
  } catch (err) {
    const delay = reconnectDelay(attempt);
    log.warn(`startup: could not announce to the world (${err.message}); retrying in ${Math.round(delay / 1000)}s`);
    await sleep(delay);
  }
}
writeCache(stateDir, world);

// Members who have knocked — run any command — kept in the world's own
// record across restarts, so the Judge's window can offer them by name.
// Announced a moment after a new one, and with every heartbeat.
let members = known.members;
let announceMembers = () => {};
let membersDue = null;
const noteKnock = (m) => {
  const next = noteMember(members, m);
  if (next === members) return;
  members = next;
  clearTimeout(membersDue);
  membersDue = setTimeout(announceMembers, MEMBER_ANNOUNCE_MS);
  membersDue.unref?.();
};

const settingsNow = async () => applyWorldConfig(loadConfig(), world, await openToken(world, keys, log));
let settings = await settingsNow();

while (!settings.discord.token) {
  log.warn("configuration: no bot token yet — in Foundry, open Settings → Extras → Discord Bot and paste one");
  await announce(bridge, { ...state("awaiting", "Waiting for a bot token"), revisionSeen: world.revision });
  ({ config: world } = await waitForConfigChange({ seat, bridge, digest: configDigest(world), log }));
  writeCache(stateDir, world);
  settings = await settingsNow();
}

bot = createBot({ config: settings, bridge, seat, log, commands, onMember: noteKnock });
const ready = new Promise((resolve) => bot.client.once(Events.ClientReady, resolve));

// From here a configuration change is a restart: the bot is running on the
// one it read, and re-logging a client in place is a state machine the ten
// seconds of a restart buys off.
waitForConfigChange({ seat, bridge, digest: configDigest(world), log }).then((pair) => {
  writeCache(stateDir, pair.config);
  return shutdown("the configuration changed in Foundry; restarting on it");
});

await bot.login();
const client = await ready;

// A guild reference cell `online` closes over before it exists: Discord can
// hand this client a brand-new guild (an invite accepted while it is already
// running) the instant it is logged in, and the handler has to be in place
// for that from here — `online` itself is only assigned once the catalogue
// below is built, and every call before then is a no-op.
let online = () => {};
client.on(Events.GuildCreate, async (guild) => {
  const adopted = adoptGuild(settings.discord, { id: guild.id, ownerId: guild.ownerId });
  if (!adopted) return; // already pointed at a server; a second invite is the Judge's to choose in Foundry
  settings.discord.guildId = adopted.guildId;
  settings.discord.judgeIds = adopted.judgeIds;
  log.info(`configuration: joined ${guild.name} (${guild.id}); adopting it since no server was chosen`);
  try {
    await registerGuildCommands({ config: settings, commands, stateDir, log });
  } catch (err) {
    log.warn(`commands: registration failed (${err.message}); the guild keeps what it had`);
  }
  await online();
});

// Facts only a logged-in client knows: which application this token is, and
// which servers it actually reaches. A bot invited to exactly one server
// needs nobody to say which.
settings.discord.appId ||= client.application?.id ?? "";
if (!settings.discord.guildId && client.guilds.cache.size === 1) {
  const only = client.guilds.cache.first();
  const adopted = adoptGuild(settings.discord, { id: only.id, ownerId: only.ownerId });
  settings.discord.guildId = adopted.guildId;
  settings.discord.judgeIds = adopted.judgeIds;
  log.info(`configuration: no server chosen; using the only one this bot is in (${settings.discord.guildId})`);
} else {
  // The server's owner is a Judge without being linked: the bootstrap has to
  // belong to someone who exists before any binding does.
  const owner = client.guilds.cache.get(settings.discord.guildId)?.ownerId;
  if (owner) settings.discord.judgeIds.add(owner);
}

if (settings.discord.guildId) {
  try {
    await registerGuildCommands({ config: settings, commands, stateDir, log });
  } catch (err) {
    log.warn(`commands: registration failed (${err.message}); the guild keeps what it had`);
  }
} else {
  log.warn("configuration: no Discord server chosen, so no commands were registered — choose one in Foundry");
}

attachRelay({ seat, client, config: settings, log });

online = () => announce(bridge, { ...state("online", settings.discord.guildId ? "" : "No Discord server chosen"), application: { id: client.application?.id ?? "", name: client.application?.name ?? "" }, ...catalogueOf(client), members, revisionSeen: world.revision }).catch((err) => log.warn(`announce: ${err.message}`));
announceMembers = online;
await online();
const heartbeat = setInterval(online, HEARTBEAT_MS);
heartbeat.unref();
