import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { commandBody, digest, needsRegistration, registerGuildCommands, stateDirectory } from "../src/register.mjs";
import { commands } from "../src/commands/index.mjs";

const config = { discord: { token: "t", appId: "app", guildId: "guild" } };

test("the digest is stable for the same body and changes with it", () => {
  const body = commandBody(commands);
  const ids = { appId: "app", guildId: "guild" };
  assert.equal(digest(body, ids), digest(commandBody(commands), ids));
  assert.notEqual(digest(body, ids), digest([...body, { name: "extra" }], ids));
});

test("the digest also moves when the application or the guild does, not just the bodies", () => {
  const body = [{ name: "a" }];
  const base = digest(body, { appId: "app1", guildId: "guild1" });
  assert.notEqual(base, digest(body, { appId: "app2", guildId: "guild1" }), "a different application id must re-register — a guild the bot was reinvited to has none of its old commands");
  assert.notEqual(base, digest(body, { appId: "app1", guildId: "guild2" }), "a different guild must re-register — nothing sent to the old one reaches the new one");
  assert.equal(base, digest(body, { appId: "app1", guildId: "guild1" }));
});

test("nothing stored means register; a matching digest means skip", () => {
  const sha = digest([{ name: "a" }], { appId: "app", guildId: "guild" });
  assert.equal(needsRegistration(sha, null), true);
  assert.equal(needsRegistration(sha, `${sha}\n`), false);
  assert.equal(needsRegistration(sha, "other"), true);
});

test("the state directory is systemd's when it names one", () => {
  assert.equal(stateDirectory({ STATE_DIRECTORY: "/var/lib/x" }), "/var/lib/x");
  assert.ok(stateDirectory({}).endsWith(".acks-extras-discord"));
});

test("a first start registers and remembers; the next skips; force sends again", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-reg-"));
  const puts = [];
  const rest = { put: async (route, { body }) => { puts.push(route); return body; } };
  const first = await registerGuildCommands({ config, commands, stateDir, rest });
  assert.equal(first.registered, true);
  assert.equal(first.count, commands.length);
  assert.ok(first.names.includes("/whoami"));
  assert.ok(fs.existsSync(path.join(stateDir, "commands.sha256")));
  const second = await registerGuildCommands({ config, commands, stateDir, rest });
  assert.equal(second.registered, false);
  const forced = await registerGuildCommands({ config, commands, stateDir, rest, force: true });
  assert.equal(forced.registered, true);
  assert.equal(puts.length, 2);
  assert.match(puts[0], /applications\/app\/guilds\/guild\/commands/);
  fs.rmSync(stateDir, { recursive: true });
});

test("a guild that lost its commands registers again once the bot is reinvited or repointed, with no force needed", async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "acks-reg-"));
  const puts = [];
  const rest = { put: async (route, { body }) => { puts.push(route); return body; } };
  await registerGuildCommands({ config, commands, stateDir, rest });
  assert.equal(puts.length, 1);
  // Same bodies, same marker file — but the bot is now answering for a
  // different guild (kicked and reinvited, or pointed elsewhere): Discord
  // holds none of the earlier registration, so this must not be skipped.
  const reinvited = { discord: { token: "t", appId: "app", guildId: "guild-2" } };
  const second = await registerGuildCommands({ config: reinvited, commands, stateDir, rest });
  assert.equal(second.registered, true);
  assert.equal(puts.length, 2);
  assert.match(puts[1], /applications\/app\/guilds\/guild-2\/commands/);
  fs.rmSync(stateDir, { recursive: true });
});
