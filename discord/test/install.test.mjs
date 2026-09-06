import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installReason, npmCommand, installArgs } from "../src/prestart.mjs";
import { renderUnit, parseEnv, renderEnv, discordHalf } from "../src/install-service.mjs";
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
