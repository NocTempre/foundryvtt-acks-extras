import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fromEnv } from "../src/config.mjs";
import { createLog } from "../src/log.mjs";
import { needsWorldLookup, resolveViaWorld, appIdFor } from "../src/register-commands.mjs";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "acks-reg-cmd-"));
const silent = createLog("error");

test("the environment needs no world lookup once it has a token and a guild", () => {
  assert.equal(needsWorldLookup({ token: "t", guildId: "g" }), false);
  assert.equal(needsWorldLookup({ token: "t", guildId: "" }), true);
  assert.equal(needsWorldLookup({ token: "", guildId: "g" }), true);
  assert.equal(needsWorldLookup({}), true);
});

test("resolveViaWorld takes the seat, reads bridgeClient, and always leaves the seat behind", async () => {
  const config = fromEnv({ FOUNDRY_ORIGIN: "http://localhost:30000", BROWSER: "/usr/bin/chromium" }, { browserAt: () => "" });
  const stateDir = tmp();
  const calls = [];
  const fakeSeat = { start: async () => calls.push("start"), stop: async () => calls.push("stop") };
  const fakeBridge = { run: async (name, args) => { calls.push(name); assert.equal(args.asSeat, true); return { config: { discord: { guildId: "555555555" } } }; } };
  try {
    const settings = await resolveViaWorld({ config, stateDir, log: silent, seatFactory: () => fakeSeat, bridgeFactory: () => fakeBridge });
    assert.equal(settings.discord.guildId, "555555555");
    assert.deepEqual(calls, ["start", "config", "stop"]);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("resolveViaWorld leaves the seat even when reading the world fails", async () => {
  const config = fromEnv({ FOUNDRY_ORIGIN: "http://localhost:30000", BROWSER: "/usr/bin/chromium" }, { browserAt: () => "" });
  const stateDir = tmp();
  const calls = [];
  const fakeSeat = { start: async () => calls.push("start"), stop: async () => calls.push("stop") };
  const fakeBridge = { run: async () => { throw new Error("boom"); } };
  try {
    await assert.rejects(() => resolveViaWorld({ config, stateDir, log: silent, seatFactory: () => fakeSeat, bridgeFactory: () => fakeBridge }), /boom/);
    assert.deepEqual(calls, ["start", "stop"]);
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("appIdFor reads the application id straight off the token, no gateway needed", async () => {
  const calls = [];
  const id = await appIdFor("tok", (token) => {
    calls.push(token);
    return { get: async (route) => { assert.equal(route, "/applications/@me"); return { id: "999999999" }; } };
  });
  assert.equal(id, "999999999");
  assert.deepEqual(calls, ["tok"]);
});
