import { test } from "node:test";
import assert from "node:assert";
import { fromEnv, JUDGE_COMMANDS, EMIT_BINDING } from "../src/config.mjs";

const full = {
  DISCORD_TOKEN: "t", DISCORD_APP_ID: "a", DISCORD_GUILD_ID: "g", DISCORD_JUDGE_IDS: "1, 2,,3",
  FOUNDRY_ORIGIN: "http://localhost:30000/", FOUNDRY_USER: "Discord", BROWSER: "C:\\x\\edge.exe", SEAT_PORT: "9400",
  SEAT_BROWSER_ARGS: "--foo  --bar",
};

test("a complete environment builds the whole config", () => {
  const c = fromEnv(full);
  assert.equal(c.discord.token, "t");
  assert.deepEqual([...c.discord.judgeIds], ["1", "2", "3"]);
  assert.equal(c.discord.chatChannelId, null);
  assert.equal(c.foundry.origin, "http://localhost:30000", "the trailing slash goes");
  assert.equal(c.foundry.password, "");
  assert.equal(c.seat.port, 9400);
  assert.equal(c.seat.width, 1600);
  assert.deepEqual(c.seat.browserArgs, ["--foo", "--bar"]);
  assert.equal(c.seat.bindingName, EMIT_BINDING);
});

test("the Discord half can be waived for the seat check, the browser for command registration", () => {
  const { DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID, ...noDiscord } = full;
  assert.throws(() => fromEnv(noDiscord), /DISCORD_TOKEN/);
  assert.equal(fromEnv(noDiscord, { discord: false }).discord.token, "");
  const { BROWSER, ...noBrowser } = full;
  assert.throws(() => fromEnv(noBrowser), /BROWSER/);
  assert.equal(fromEnv(noBrowser, { browser: false }).seat.browser, "");
  assert.throws(() => fromEnv({ ...full, FOUNDRY_USER: " " }), /FOUNDRY_USER/);
});

test("the Judge commands are exactly the bridge's Judge verbs", () => {
  assert.deepEqual([...JUDGE_COMMANDS].sort(), ["bindings", "link", "map", "parties", "party", "unlink", "users"]);
});
