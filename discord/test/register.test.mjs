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
  assert.equal(digest(body), digest(commandBody(commands)));
  assert.notEqual(digest(body), digest([...body, { name: "extra" }]));
});

test("nothing stored means register; a matching digest means skip", () => {
  const sha = digest([{ name: "a" }]);
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
