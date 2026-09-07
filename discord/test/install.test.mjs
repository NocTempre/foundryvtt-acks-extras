import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installReason, npmCommand, installArgs } from "../src/prestart.mjs";
import { PassThrough, Writable } from "node:stream";
import { renderUnit, parseEnv, renderEnv, discordHalf, makeAsker } from "../src/install-service.mjs";
import { findBrowser, BROWSERS } from "../src/browsers.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("prestart installs when node_modules is missing, incomplete, or older than the lock", () => {
  assert.equal(installReason({ lockMtime: 10, installedMtime: null, hasDependency: false }), "node_modules is missing");
  assert.equal(installReason({ lockMtime: 10, installedMtime: 20, hasDependency: false }), "discord.js is not installed");
  assert.equal(installReason({ lockMtime: 30, installedMtime: 20, hasDependency: true }), "package-lock.json is newer than the install");
  assert.equal(installReason({ lockMtime: 10, installedMtime: 20, hasDependency: true }), null);
  assert.equal(installReason({ lockMtime: null, installedMtime: 20, hasDependency: true }), null);
  assert.ok(npmCommand().length > 0);
});

test("the unit keeps the bot's own state directory, where its key lives", () => {
  const template = fs.readFileSync(path.join(ROOT, "deploy", "acks-extras-discord.service"), "utf8");
  assert.match(template, /^StateDirectory=acks-extras-discord$/m);
});

test("the unit template renders with no placeholder left and this machine's values in place", () => {
  const template = fs.readFileSync(path.join(ROOT, "deploy", "acks-extras-discord.service"), "utf8");
  const unit = renderUnit(template, { node: "/usr/bin/node", workDir: "/srv/foundry/Data/modules/acks-extras/discord", user: "foundry" });
  assert.doesNotMatch(unit, /\{\{/);
  assert.match(unit, /^User=foundry$/m);
  assert.match(unit, /^WorkingDirectory=\/srv\/foundry\/Data\/modules\/acks-extras\/discord$/m);
  assert.match(unit, /^ExecStartPre=\/usr\/bin\/node src\/prestart\.mjs$/m);
  assert.match(unit, /^ExecStart=\/usr\/bin\/node src\/main\.mjs$/m);
  assert.match(unit, /^EnvironmentFile=\/etc\/acks-extras-discord\.env$/m);
  assert.match(unit, /^Restart=always$/m);
});

test("the environment file round-trips through parse and render", () => {
  const text = renderEnv({ DISCORD_TOKEN: "abc", DISCORD_APP_ID: "1", DISCORD_GUILD_ID: "2", FOUNDRY_ORIGIN: "http://localhost:30000", BROWSER: "/usr/bin/chromium" });
  const back = parseEnv(`# a comment\n${text}\nQUOTED="x y"\n`);
  assert.equal(back.DISCORD_TOKEN, "abc");
  assert.equal(back.FOUNDRY_ORIGIN, "http://localhost:30000");
  assert.equal(back.DISCORD_CHAT_CHANNEL_ID, "");
  assert.equal(back.QUOTED, "x y");
  assert.ok(text.endsWith("\n"));
});

test("the browser search takes the first present candidate and answers blank for none", () => {
  const second = BROWSERS[1];
  assert.equal(findBrowser((p) => p === second), second, "the first present candidate wins even when an earlier one is absent");
  assert.equal(findBrowser(() => false), "");
});

test("dependencies install against the shipped lock, and without one npm install stands in for ci", () => {
  assert.equal(installArgs(true)[0], "ci");
  assert.equal(installArgs(false)[0], "install");
  assert.ok(installArgs(true).includes("--omit=dev"));
});

test("a re-install drops an earlier file's Discord half and says so, unless the operator sets it on purpose", () => {
  const had = { DISCORD_TOKEN: "old", DISCORD_GUILD_ID: "1", FOUNDRY_ORIGIN: "http://localhost:30000" };
  const dropped = discordHalf(had, {});
  assert.equal(dropped.values.DISCORD_TOKEN, "");
  assert.equal(dropped.values.DISCORD_GUILD_ID, "");
  assert.deepEqual(dropped.dropped, ["DISCORD_TOKEN", "DISCORD_GUILD_ID"]);
  const kept = discordHalf(had, { DISCORD_GUILD_ID: "2" });
  assert.equal(kept.values.DISCORD_GUILD_ID, "2");
  assert.deepEqual(kept.dropped, ["DISCORD_TOKEN"]);
  assert.deepEqual(discordHalf({}, {}).dropped, []);
});

// A terminal readline believes in: it writes escape sequences to `output`,
// which the reading strips so the assertions see what a person would.
const terminal = () => {
  const input = new PassThrough();
  let shown = "";
  const output = new Writable({ write(chunk, _enc, cb) { shown += String(chunk); cb(); } });
  return { input, output, seen: () => shown.replace(/\x1b\[[0-9;]*[A-Za-z]/g, "") };
};

test("on a terminal every question is on screen while it waits, an empty answer keeps the fallback, and a secret is never echoed", async () => {
  const t = terminal();
  const asker = makeAsker({ input: t.input, output: t.output, tty: true });
  const first = asker.ask("FOUNDRY_ORIGIN", "Foundry address", "http://localhost:30000");
  assert.match(t.seen(), /Foundry address \[http:\/\/localhost:30000\]: $/, "the question is drawn before readline waits");
  t.input.write("\n");
  assert.equal(await first, "http://localhost:30000");
  const second = asker.ask("FOUNDRY_PASSWORD", "Password", "", { secret: true });
  assert.match(t.seen(), /Password: $/);
  t.input.write("hunter2\n");
  assert.equal(await second, "hunter2");
  assert.ok(!t.seen().includes("hunter2"), "the secret is muted");
  asker.close();
});

test("off a terminal nothing is asked: the environment answers, else the fallback", async () => {
  const asker = makeAsker({ tty: false, env: { FOUNDRY_USER: " Discord " } });
  assert.equal(await asker.ask("FOUNDRY_USER", "user", "x"), "Discord");
  assert.equal(await asker.ask("SEAT_PORT", "port", "9334"), "9334");
});
