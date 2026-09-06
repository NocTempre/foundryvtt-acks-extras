import { test } from "node:test";
import assert from "node:assert";
import { fromEnv, JUDGE_COMMANDS, EMIT_BINDING } from "../src/config.mjs";

/** Nothing on this machine decides a test: the browser search is always given its answer. */
const noBrowsers = { browserAt: () => "" };

const full = {
  DISCORD_TOKEN: "t", DISCORD_APP_ID: "a", DISCORD_GUILD_ID: "g", DISCORD_JUDGE_IDS: "1, 2,,3",
  FOUNDRY_ORIGIN: "http://localhost:30000/", FOUNDRY_USER: "Discord", BROWSER: "C:\\x\\edge.exe", SEAT_PORT: "9400",
  SEAT_BROWSER_ARGS: "--foo  --bar",
};

test("a complete environment builds the whole config", () => {
  const c = fromEnv(full, noBrowsers);
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

test("the Discord half is optional — the world carries it — and demanding it still refuses a gap", () => {
  const { DISCORD_TOKEN, DISCORD_APP_ID, DISCORD_GUILD_ID, ...noDiscord } = full;
  assert.equal(fromEnv(noDiscord, noBrowsers).discord.token, "", "a bot with no token starts and waits to be configured");
  assert.throws(() => fromEnv(noDiscord, { ...noBrowsers, discord: true }), /DISCORD_TOKEN/, "the by-hand registration still needs one");
});

test("the browser is found when it was not given, and its absence is the one thing that stops a start", () => {
  const { BROWSER, ...noBrowser } = full;
  assert.throws(() => fromEnv(noBrowser, noBrowsers), /BROWSER/);
  assert.equal(fromEnv(noBrowser, { browserAt: () => "/usr/bin/chromium" }).seat.browser, "/usr/bin/chromium");
  assert.equal(fromEnv(full, { browserAt: () => "/usr/bin/chromium" }).seat.browser, full.BROWSER, "what was set wins over what was found");
  assert.equal(fromEnv(noBrowser, { ...noBrowsers, browser: false }).seat.browser, "");
});

test("the bot's Foundry user has a default, so a standard install answers nothing", () => {
  const { FOUNDRY_USER, ...bare } = full;
  assert.equal(fromEnv(bare, noBrowsers).foundry.user, "Discord");
  assert.equal(fromEnv({ ...full, FOUNDRY_USER: " " }, noBrowsers).foundry.user, "Discord");
});

test("the Judge commands are exactly the bridge's Judge verbs", () => {
  assert.deepEqual([...JUDGE_COMMANDS].sort(), ["bindings", "enroll", "link", "map", "parties", "party", "unlink", "users"]);
});
