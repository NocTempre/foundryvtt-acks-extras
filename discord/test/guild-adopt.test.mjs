import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptGuild } from "../src/guild-adopt.mjs";

test("a bot with no server chosen adopts the guild it just joined, owner included as a judge", () => {
  const adopted = adoptGuild({ guildId: "", judgeIds: [] }, { id: "111111111", ownerId: "222222222" });
  assert.deepEqual(adopted, { guildId: "111111111", judgeIds: new Set(["222222222"]) });
});

test("a bot already pointed at a server keeps it — a second invite changes nothing", () => {
  assert.equal(adoptGuild({ guildId: "999999999", judgeIds: [] }, { id: "111111111", ownerId: "222222222" }), null);
});

test("existing judges survive adoption; a guild with no owner id still adopts", () => {
  const adopted = adoptGuild({ guildId: "", judgeIds: ["333333333"] }, { id: "111111111" });
  assert.deepEqual(adopted, { guildId: "111111111", judgeIds: new Set(["333333333"]) });
});
