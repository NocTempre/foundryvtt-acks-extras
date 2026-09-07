/**
 * One-command install on the Linux host that runs the Foundry server:
 *
 *   sudo npm run install-service              ask, write, enable, start
 *   sudo npm run install-service -- --remove  stop, disable, remove
 *   npm run install-service -- --dry-run      print what would be written
 *
 * It asks only what a bot needs to REACH the world — where Foundry is, who
 * to join as, which browser to sit in. Everything else (the token, the
 * Discord server, the relay channel, the seat's size) is set in Foundry
 * afterwards, in Settings → Extras → Discord Bot, and read from the world by
 * the running bot. Enter keeps a value it already has, and on a host with a
 * default Foundry and a browser installed, every answer is already right.
 *
 * It writes the environment file the service reads — root-only, in /etc —
 * renders the systemd unit from deploy/ with this machine's node, directory
 * and user, installs the bot's dependencies in front of the operator as that
 * user, and enables it. Nothing is copied by hand, and a module update
 * replaces none of it: both files live outside the module directory.
 *
 * Running it again is the whole install again, over whatever an earlier
 * attempt left: the unit is stopped and its failure state cleared, both files
 * are rewritten, and a node_modules another account made is handed to the
 * service's. The Discord half of an earlier environment file is dropped, not
 * carried — it is Foundry's now.
 *
 * Without a terminal (a scripted install) every value comes from the
 * environment instead of a prompt; the Discord half may be set that way too,
 * where an operator would rather keep it on the host.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { isMain } from "./entry.mjs";
import { findBrowser } from "./browsers.mjs";

export const ENV_FILE = "/etc/acks-extras-discord.env";
export const UNIT_NAME = "acks-extras-discord";
export const UNIT_FILE = `/etc/systemd/system/${UNIT_NAME}.service`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "deploy", `${UNIT_NAME}.service`);
const KEYS = ["DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_GUILD_ID", "DISCORD_JUDGE_IDS", "DISCORD_CHAT_CHANNEL_ID", "FOUNDRY_ORIGIN", "FOUNDRY_USER", "FOUNDRY_PASSWORD", "BROWSER", "SEAT_PORT"];

/** Fill the unit template's placeholders. Pure. */
export function renderUnit(template, { node, workDir, user }) {
  return template.replaceAll("{{NODE}}", node).replaceAll("{{WORKDIR}}", workDir).replaceAll("{{USER}}", user);
}

/** KEY=VALUE lines to an object; comments and blanks skipped, one layer of quotes removed. Pure. */
export function parseEnv(text) {
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m) out[m[1]] = m[2].replace(/^"(.*)"$/, "$1");
  }
  return out;
}

/** The environment file's text: every key the bot reads, in a fixed order. Pure. */
export function renderEnv(values) {
  return `${KEYS.map((k) => `${k}=${values[k] ?? ""}`).join("\n")}\n`;
}

const DISCORD_KEYS = ["DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_GUILD_ID", "DISCORD_JUDGE_IDS", "DISCORD_CHAT_CHANNEL_ID"];

/**
 * The Discord half of the environment file: taken from the installer's own
 * environment when an operator sets it there on purpose, and otherwise left
 * EMPTY — never carried over from an earlier file. Those values are Foundry's
 * to hold now, and a stale one on the host would win over the window without
 * a word. Answers what it dropped, so the operator is told. Pure.
 */
export function discordHalf(had, env) {
  const values = {};
  const dropped = [];
  for (const k of DISCORD_KEYS) {
    const given = String(env?.[k] ?? "").trim();
    values[k] = given;
    if (!given && String(had?.[k] ?? "").trim()) dropped.push(k);
  }
  return { values, dropped };
}

function ownerOf(dir) {
  try {
    return execFileSync("id", ["-nu", String(fs.statSync(dir).uid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/**
 * The installer's questions. On a terminal each is asked through readline;
 * anywhere else (a pipe, `</dev/null`, a script) the answer is the
 * environment variable of the same name, else the fallback, and nothing is
 * asked. `input`, `output`, `tty` and `env` are taken so a test can hold a
 * terminal.
 *
 * The question text goes THROUGH readline, never beside it: in terminal mode
 * readline redraws its line from column 0 and clears the rest before it
 * waits, so a label written to the same line by hand is wiped and the
 * operator sits at a blank cursor. A secret answer mutes the output only
 * once the question has been drawn.
 */
export function makeAsker({ input = process.stdin, output = process.stdout, tty = process.stdin.isTTY, env = process.env } = {}) {
  if (!tty) {
    return { ask: async (key, _label, fallback) => (env[key] ?? "").trim() || fallback, close() {} };
  }
  const mute = { on: false };
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!mute.on) output.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input, output: out, terminal: true });
  return {
    async ask(_key, label, fallback = "", { secret = false } = {}) {
      const shown = secret ? (fallback ? " [kept]" : "") : fallback ? ` [${fallback}]` : "";
      mute.on = false;
      const asked = rl.question(`${label}${shown}: `);
      mute.on = secret;
      const answer = (await asked).trim();
      mute.on = false;
      if (secret) output.write("\n");
      return answer || fallback;
    },
    close: () => rl.close(),
  };
}

async function remove() {
  for (const args of [["disable", "--now", UNIT_NAME], ["daemon-reload"]]) {
    try {
      execFileSync("systemctl", args, { stdio: "inherit" });
    } catch {
      /* not installed, or already gone */
    }
  }
  for (const f of [UNIT_FILE, ENV_FILE]) if (fs.existsSync(f)) fs.rmSync(f);
  execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
  console.log(`removed ${UNIT_NAME}: the unit and ${ENV_FILE}. The module directory is untouched.`);
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  if (!dryRun && process.platform !== "linux") {
    console.error("install-service: this installs a systemd unit. Elsewhere, run the bot with `npm start` and a .env beside src/.");
    process.exit(2);
  }
  if (!dryRun && process.getuid?.() !== 0) {
    console.error("install-service: it writes under /etc — run it as root:  sudo npm run install-service");
    process.exit(2);
  }
  if (!fs.existsSync(path.join(ROOT, "src", "main.mjs"))) {
    console.error(`install-service: ${ROOT} is not the bot's directory`);
    process.exit(2);
  }
  if (args.has("--remove")) return remove();

  const had = !dryRun && fs.existsSync(ENV_FILE) ? parseEnv(fs.readFileSync(ENV_FILE, "utf8")) : {};
  const asker = makeAsker();
  console.log(`Installing the ACKS II Extras Discord bot from ${ROOT}\n`);
  const { values, dropped } = discordHalf(had, process.env);
  if (dropped.length) console.log(`An earlier install kept ${dropped.join(", ")} on this host; those are set in Foundry now and are not carried over.\n`);
  values.FOUNDRY_ORIGIN = await asker.ask("FOUNDRY_ORIGIN", "Foundry address as this machine sees it", had.FOUNDRY_ORIGIN ?? "http://localhost:30000");
  values.FOUNDRY_USER = await asker.ask("FOUNDRY_USER", "The bot's Foundry user (Assistant Gamemaster)", had.FOUNDRY_USER ?? "Discord");
  values.FOUNDRY_PASSWORD = await asker.ask("FOUNDRY_PASSWORD", "That user's password (blank: none)", had.FOUNDRY_PASSWORD ?? "", { secret: true });
  values.BROWSER = await asker.ask("BROWSER", "Chromium-family browser", had.BROWSER || findBrowser());
  values.SEAT_PORT = await asker.ask("SEAT_PORT", "Local DevTools port for the seat", had.SEAT_PORT ?? "9334");
  const sudoUser = process.env.SUDO_USER && process.env.SUDO_USER !== "root" ? process.env.SUDO_USER : null;
  const user = await asker.ask("SERVICE_USER", "Run the service as", sudoUser ?? ownerOf(ROOT) ?? "foundry");
  asker.close();

  if (!values.BROWSER) {
    console.error("install-service: BROWSER is required — install a Chromium-family browser (apt install chromium) or give its path");
    process.exit(2);
  }
  const unit = renderUnit(fs.readFileSync(TEMPLATE, "utf8"), { node: process.execPath, workDir: ROOT, user });
  if (dryRun) {
    console.log(`\n--- ${ENV_FILE} (0600, root) ---\n${renderEnv({ ...values, DISCORD_TOKEN: values.DISCORD_TOKEN ? "<token>" : "", FOUNDRY_PASSWORD: values.FOUNDRY_PASSWORD ? "<password>" : "" })}\n--- ${UNIT_FILE} ---\n${unit}`);
    return;
  }
  // Whatever an earlier attempt left — a unit in a restart loop, a start
  // limit it tripped, a node_modules some `sudo npm` made root's — is taken
  // down and taken over first, so running this again is always the whole
  // install and never a repair of one.
  for (const args of [["stop", UNIT_NAME], ["reset-failed", UNIT_NAME]]) {
    try {
      execFileSync("systemctl", args, { stdio: ["ignore", "ignore", "ignore"] });
    } catch {
      /* not installed yet, or never failed */
    }
  }
  fs.writeFileSync(ENV_FILE, renderEnv(values), { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
  fs.writeFileSync(UNIT_FILE, unit);
  const modules = path.join(ROOT, "node_modules");
  if (fs.existsSync(modules)) execFileSync("chown", ["-R", user, modules]);

  // Dependencies go in HERE, in front of the operator, as the service's user
  // and with the service's HOME. Left to the unit's ExecStartPre, the same
  // npm run happens with its output in the journal and `systemctl start`
  // blocking on it — which reads as an installer that has hung, and hides
  // the one error (no network, a directory the user cannot write) that
  // needs a hand.
  fs.mkdirSync(STATE_DIR, { recursive: true });
  execFileSync("chown", ["-R", user, STATE_DIR]);
  console.log(`\nPutting the bot's dependencies in place as ${user}…`);
  try {
    const [runner, ...as] = fs.existsSync("/usr/sbin/runuser") || fs.existsSync("/sbin/runuser") ? ["runuser", "-u", user, "--"] : ["sudo", "-u", user, "-E", "--"];
    execFileSync(runner, [...as, process.execPath, "src/prestart.mjs"], { cwd: ROOT, stdio: "inherit", env: { ...process.env, HOME: STATE_DIR } });
  } catch {
    console.error(`\ninstall-service: dependencies could not be installed as ${user} (see npm's output above). Fix that, then run this command again; nothing was enabled.`);
    process.exit(1);
  }

  execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["enable", "--now", UNIT_NAME], { stdio: "inherit" });
  console.log(`\ninstalled and started as ${user}. Watching it join the world for a few seconds…`);
  await report();
  console.log(`\nFollow it with:  journalctl -u ${UNIT_NAME} -f`);
  console.log("Now open Foundry: Settings → Extras → Discord Bot, paste the bot token and choose the server.");
  console.log("Run this command again to change an answer; a Foundry module update needs nothing from you.");
}

/** Where the unit's StateDirectory lands — the bot's key and cache, and the HOME its npm and browser get. */
export const STATE_DIR = `/var/lib/${UNIT_NAME}`;

/** The service's state and its last journal lines, once it has had a moment to join or to fail. */
async function report() {
  const out = (cmd, args) => {
    try {
      return execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    } catch (err) {
      return String(err.stdout ?? "").trim();
    }
  };
  let state = "";
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    state = out("systemctl", ["is-active", UNIT_NAME]);
    if (state !== "activating") break;
  }
  console.log(`\nsystemctl is-active ${UNIT_NAME}: ${state}`);
  console.log(out("journalctl", ["-u", UNIT_NAME, "-n", "12", "--no-pager", "-o", "cat"]));
  if (state !== "active") console.log(`\nThe service is not running. The lines above say why; the guide's "When something is off" lists the usual causes.`);
}

if (isMain(import.meta.url)) await main();
