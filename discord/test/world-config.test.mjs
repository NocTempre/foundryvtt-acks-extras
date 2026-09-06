import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromEnv } from "../src/config.mjs";
import { ensureKeyPair, readCache, writeCache, openToken, applyWorldConfig, catalogueOf, configDigest, CATALOGUE_CAP } from "../src/world-config.mjs";
import { seal, keyIdOf } from "../../scripts/bridge/sealing.mjs";
import { emptyClientConfig } from "../../scripts/bridge/client-config-logic.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "acks-extras-discord-test-"));
const env = { FOUNDRY_ORIGIN: "http://localhost:30000", BROWSER: "/usr/bin/chromium" };
const base = () => fromEnv(env, { browserAt: () => "" });

test("a key pair is minted once and kept, and what the window seals to it opens here", async () => {
  const dir = tmp();
  try {
    const keys = await ensureKeyPair(dir);
    assert.equal(keys.keyId, keyIdOf(keys.publicKey));
    assert.deepEqual(await ensureKeyPair(dir), keys, "a second start keeps the key a token was sealed to");

    // What the config window does, in the browser, with the announced public half.
    const config = { ...emptyClientConfig(), token: { sealed: await seal(keys.publicKey, "a-bot-token"), keyId: keys.keyId, hint: "" } };
    assert.equal(await openToken(config, keys), "a-bot-token");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a token sealed to a key this bot no longer holds opens as nothing, not as a crash", async () => {
  const dir = tmp();
  const other = tmp();
  try {
    const mine = await ensureKeyPair(dir);
    const theirs = await ensureKeyPair(other);
    const config = { ...emptyClientConfig(), token: { sealed: await seal(theirs.publicKey, "a-bot-token"), keyId: theirs.keyId, hint: "" } };
    const warned = [];
    assert.equal(await openToken(config, mine, { warn: (m) => warned.push(m) }), "");
    assert.equal(warned.length, 1);
  } finally {
    for (const d of [dir, other]) fs.rmSync(d, { recursive: true, force: true });
  }
});

test("the world fills what the environment left empty", () => {
  const world = {
    discord: { guildId: "111111111", chatChannelId: "222222222", judgeIds: ["333333333"], relay: true },
    seat: { width: 1280, height: 720, readySeconds: 60 },
    service: { logLevel: "debug" },
  };
  const c = applyWorldConfig(base(), world, "a-bot-token", env);
  assert.equal(c.discord.token, "a-bot-token");
  assert.equal(c.discord.guildId, "111111111");
  assert.equal(c.discord.chatChannelId, "222222222");
  assert.deepEqual([...c.discord.judgeIds], ["333333333"]);
  assert.equal(c.seat.width, 1280);
  assert.equal(c.logLevel, "debug");
});

test("the environment wins wherever it carries a value", () => {
  const world = { discord: { guildId: "111111111", chatChannelId: "222222222", judgeIds: ["333333333"], relay: true }, seat: { width: 1280 }, service: { logLevel: "debug" } };
  const set = { ...env, DISCORD_TOKEN: "env-token", DISCORD_GUILD_ID: "999999999", DISCORD_JUDGE_IDS: "888888888", SEAT_WIDTH: "1024", LOG_LEVEL: "warn" };
  const c = applyWorldConfig(fromEnv(set, { browserAt: () => "" }), world, "sealed-token", set);
  assert.equal(c.discord.token, "env-token");
  assert.equal(c.discord.guildId, "999999999");
  assert.deepEqual([...c.discord.judgeIds], ["888888888"]);
  assert.equal(c.seat.width, 1024);
  assert.equal(c.logLevel, "warn");
  assert.equal(c.discord.chatChannelId, "222222222", "what the environment does not carry still comes from the world");
});

test("relaying turned off in Foundry silences the channel the world names", () => {
  const world = { discord: { guildId: "111111111", chatChannelId: "222222222", relay: false } };
  assert.equal(applyWorldConfig(base(), world, "", env).discord.chatChannelId, null);
});

test("the digest moves for a change the bot runs on and stands still for one it does not", () => {
  const world = { discord: { guildId: "111111111" }, seat: { width: 1280 }, revision: 3 };
  assert.equal(configDigest(world), configDigest({ ...world, revision: 4, updatedAt: Date.now() }), "a save that changed nothing must not bounce a running bot");
  assert.notEqual(configDigest(world), configDigest({ ...world, discord: { guildId: "444444444" } }));
});

test("the cache survives a round trip and answers defaults when there is none", () => {
  const dir = tmp();
  try {
    assert.deepEqual(readCache(dir), emptyClientConfig());
    writeCache(dir, { seat: { width: 1280, height: 720, readySeconds: 45 } });
    assert.equal(readCache(dir).seat.width, 1280);
    assert.equal(readCache(dir).seat.readySeconds, 45);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("the catalogue carries the servers and sendable channels, capped", () => {
  const channels = new Map(Array.from({ length: CATALOGUE_CAP.channels + 50 }, (_, i) => [`c${i}`, { id: `${100000 + i}`, name: `chan-${i}`, isSendable: () => true, isThread: () => false }]));
  channels.set("thread", { id: "999999999", name: "a thread", isSendable: () => true, isThread: () => true });
  channels.set("voice", { id: "888888888", name: "voice", isSendable: () => false, isThread: () => false });
  const client = { guilds: { cache: new Map([["g", { id: "111111111", name: "The Table", channels: { cache: channels } }]]) } };
  const { guilds, channels: out } = catalogueOf(client);
  assert.deepEqual(guilds, [{ id: "111111111", name: "The Table" }]);
  assert.equal(out.length, CATALOGUE_CAP.channels);
  assert.ok(out.every((c) => c.guildId === "111111111"));
  assert.ok(!out.some((c) => c.name === "a thread" || c.name === "voice"));
});
