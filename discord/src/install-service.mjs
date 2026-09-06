/**
 * One-command install on the Linux host that runs the Foundry server:
 *
 *   sudo npm run install-service              ask, write, enable, start
 *   sudo npm run install-service -- --remove  stop, disable, remove
 *   npm run install-service -- --dry-run      print what would be written
 *
 * It asks for what the bot needs (Enter keeps a value it already has),
 * writes the environment file the service reads — root-only, in /etc —
 * renders the systemd unit from deploy/ with this machine's node, directory
 * and user, and enables it. Nothing is copied by hand, and a module update
 * replaces none of it: both files live outside the module directory.
 *
 * Without a terminal (a scripted install) every value comes from the
 * environment instead of a prompt.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline/promises";
import { Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import { isMain } from "./entry.mjs";

export const ENV_FILE = "/etc/acks-extras-discord.env";
export const UNIT_NAME = "acks-extras-discord";
export const UNIT_FILE = `/etc/systemd/system/${UNIT_NAME}.service`;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEMPLATE = path.join(ROOT, "deploy", `${UNIT_NAME}.service`);
const KEYS = ["DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_GUILD_ID", "DISCORD_JUDGE_IDS", "DISCORD_CHAT_CHANNEL_ID", "FOUNDRY_ORIGIN", "FOUNDRY_USER", "FOUNDRY_PASSWORD", "BROWSER", "SEAT_PORT"];
const BROWSERS = ["/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/snap/bin/chromium"];

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

/** The first Chromium-family binary present, or "". */
export const findBrowser = (exists = fs.existsSync) => BROWSERS.find((p) => exists(p)) ?? "";

function ownerOf(dir) {
  try {
    return execFileSync("id", ["-nu", String(fs.statSync(dir).uid)], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Ask on a terminal, or take the environment's value when there is none. */
function makeAsker() {
  if (!process.stdin.isTTY) {
    return { ask: async (key, _label, fallback) => (process.env[key] ?? "").trim() || fallback, close() {} };
  }
  const mute = { on: false };
  const out = new Writable({
    write(chunk, _enc, cb) {
      if (!mute.on) process.stdout.write(chunk);
      cb();
    },
  });
  const rl = readline.createInterface({ input: process.stdin, output: out, terminal: true });
  return {
    async ask(_key, label, fallback = "", { secret = false } = {}) {
      const shown = secret ? (fallback ? " [kept]" : "") : fallback ? ` [${fallback}]` : "";
      process.stdout.write(`${label}${shown}: `);
      mute.on = secret;
      const answer = (await rl.question("")).trim();
      mute.on = false;
      if (secret) process.stdout.write("\n");
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
  const values = {};
  console.log(`Installing the ACKS II Extras Discord bot from ${ROOT}\n`);
  values.DISCORD_TOKEN = await asker.ask("DISCORD_TOKEN", "Discord bot token", had.DISCORD_TOKEN ?? "", { secret: true });
  values.DISCORD_APP_ID = await asker.ask("DISCORD_APP_ID", "Discord application id", had.DISCORD_APP_ID ?? "");
  values.DISCORD_GUILD_ID = await asker.ask("DISCORD_GUILD_ID", "Discord server (guild) id", had.DISCORD_GUILD_ID ?? "");
  values.DISCORD_JUDGE_IDS = await asker.ask("DISCORD_JUDGE_IDS", "Judge's Discord user id(s), comma-separated", had.DISCORD_JUDGE_IDS ?? "");
  values.DISCORD_CHAT_CHANNEL_ID = await asker.ask("DISCORD_CHAT_CHANNEL_ID", "Channel id for the world's chat (blank: none)", had.DISCORD_CHAT_CHANNEL_ID ?? "");
  values.FOUNDRY_ORIGIN = await asker.ask("FOUNDRY_ORIGIN", "Foundry address as this machine sees it", had.FOUNDRY_ORIGIN ?? "http://localhost:30000");
  values.FOUNDRY_USER = await asker.ask("FOUNDRY_USER", "The bot's Foundry user (Assistant Gamemaster)", had.FOUNDRY_USER ?? "Discord");
  values.FOUNDRY_PASSWORD = await asker.ask("FOUNDRY_PASSWORD", "That user's password (blank: none)", had.FOUNDRY_PASSWORD ?? "", { secret: true });
  values.BROWSER = await asker.ask("BROWSER", "Chromium-family browser", had.BROWSER || findBrowser());
  values.SEAT_PORT = await asker.ask("SEAT_PORT", "Local DevTools port for the seat", had.SEAT_PORT ?? "9334");
  const sudoUser = process.env.SUDO_USER && process.env.SUDO_USER !== "root" ? process.env.SUDO_USER : null;
  const user = await asker.ask("SERVICE_USER", "Run the service as", sudoUser ?? ownerOf(ROOT) ?? "foundry");
  asker.close();

  for (const k of ["DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_GUILD_ID", "BROWSER"]) {
    if (!values[k]) {
      console.error(`install-service: ${k} is required`);
      process.exit(2);
    }
  }
  const unit = renderUnit(fs.readFileSync(TEMPLATE, "utf8"), { node: process.execPath, workDir: ROOT, user });
  if (dryRun) {
    console.log(`\n--- ${ENV_FILE} (0600, root) ---\n${renderEnv({ ...values, DISCORD_TOKEN: values.DISCORD_TOKEN ? "<token>" : "", FOUNDRY_PASSWORD: values.FOUNDRY_PASSWORD ? "<password>" : "" })}\n--- ${UNIT_FILE} ---\n${unit}`);
    return;
  }
  fs.writeFileSync(ENV_FILE, renderEnv(values), { mode: 0o600 });
  fs.chmodSync(ENV_FILE, 0o600);
  fs.writeFileSync(UNIT_FILE, unit);
  execFileSync("systemctl", ["daemon-reload"], { stdio: "inherit" });
  execFileSync("systemctl", ["enable", "--now", UNIT_NAME], { stdio: "inherit" });
  console.log(`\ninstalled and started as ${user}. Follow it with:  journalctl -u ${UNIT_NAME} -f`);
  console.log("Run this command again to change an answer; a Foundry module update needs nothing from you.");
}

if (isMain(import.meta.url)) await main();
