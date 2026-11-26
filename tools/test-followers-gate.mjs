/**
 * Offline tests for the follower roll's gates (`openFollowersDialog`): a Player
 * is blocked where the arrival level is unmet or no stronghold is found, a
 * Judge is warned and proceeds. The live function is driven with mocked
 * globals and an invented, minimal followers table, so no book content is here.
 *
 * Usage: node tools/test-followers-gate.mjs
 */
import assert from "node:assert/strict";

const warned = [];
let prompts = 0;
const state = { isGM: false };

globalThis.game = {
  user: {
    get isGM() {
      return state.isGM;
    },
  },
  i18n: { localize: (k) => k, format: (k) => k },
  modules: new Map(),
  users: [],
};
globalThis.ui = { notifications: { warn: (m) => warned.push(m), info: () => {} } };
// The dialog is dismissed, so a run that reaches the prompt stops there.
globalThis.foundry = { applications: { api: { DialogV2: { prompt: async () => (prompts++, null) } } } };
const TABLES = {
  arrivalLevel: { level: 9 },
  followersByClass: { rows: [{ class: "fighter", stronghold: 1, value: 1, grants: [] }] },
  troopTypeTables: { tables: {} },
  companionLevel: {},
  followerLoyalty: { fanatic: { classes: [] } },
};
globalThis.acksExtras = { lib: { tables: { hasDoc: () => true, getTable: (_d, id) => TABLES[id], citeOf: () => null } } };

const { openFollowersDialog } = await import("../scripts/henchmen/apps/followers-dialog.mjs");
const { followerGate } = await import("../scripts/henchmen/rules/followers.mjs");

let n = 0;
const t = async (name, fn) => {
  await fn();
  n++;
  console.log(`ok - ${name}`);
};

const actorOf = (level, stronghold) => ({
  name: "Tester",
  system: { details: { level, class: "fighter" } },
  getFlag: () => (stronghold ? { name: "Keep", value: 1 } : null),
  items: [],
});

/** Open the dialog for an actor on a seat; returns what the seat was warned and whether the class prompt opened. */
async function open({ isGM, level, stronghold }) {
  warned.length = 0;
  prompts = 0;
  state.isGM = isGM;
  await openFollowersDialog(actorOf(level, stronghold));
  return { warned: [...warned], prompted: prompts > 0 };
}

await t("a Player with no stronghold is warned and stopped before the class prompt opens", async () => {
  const r = await open({ isGM: false, level: 12, stronghold: false });
  assert.deepEqual(r.warned, ["ACKS-HENCHMEN.followers.strongholdMissing"]);
  assert.equal(r.prompted, false);
});

await t("a Judge with no stronghold is warned and proceeds to the prompt", async () => {
  const r = await open({ isGM: true, level: 12, stronghold: false });
  assert.deepEqual(r.warned, ["ACKS-HENCHMEN.followers.strongholdMissing"]);
  assert.equal(r.prompted, true);
});

await t("a Player below the arrival level is blocked; a Judge is warned the same and proceeds", async () => {
  const player = await open({ isGM: false, level: 3, stronghold: true });
  assert.deepEqual(player.warned, ["ACKS-HENCHMEN.followers.levelGate"]);
  assert.equal(player.prompted, false);
  const judge = await open({ isGM: true, level: 3, stronghold: true });
  assert.deepEqual(judge.warned, ["ACKS-HENCHMEN.followers.levelGate"]);
  assert.equal(judge.prompted, true);
});

await t("a Judge below the level with no stronghold hears both and proceeds; a Player hears the level gate only", async () => {
  const judge = await open({ isGM: true, level: 3, stronghold: false });
  assert.deepEqual(judge.warned, ["ACKS-HENCHMEN.followers.levelGate", "ACKS-HENCHMEN.followers.strongholdMissing"]);
  assert.equal(judge.prompted, true);
  const player = await open({ isGM: false, level: 3, stronghold: false });
  assert.deepEqual(player.warned, ["ACKS-HENCHMEN.followers.levelGate"]);
  assert.equal(player.prompted, false);
});

await t("a seat that meets both gates is not warned and reaches the prompt", async () => {
  for (const isGM of [false, true]) {
    const r = await open({ isGM, level: 9, stronghold: true });
    assert.deepEqual(r.warned, []);
    assert.equal(r.prompted, true);
  }
});

await t("followerGate: the decision as data", async () => {
  assert.deepEqual(followerGate({ isGM: false, level: 12, arrival: 9, hasStronghold: true }), { block: false, warn: [] });
  assert.deepEqual(followerGate({ isGM: false, level: 12, arrival: 9, hasStronghold: false }), { block: true, warn: ["strongholdMissing"] });
  assert.deepEqual(followerGate({ isGM: true, level: 12, arrival: 9, hasStronghold: false }), { block: false, warn: ["strongholdMissing"] });
  assert.deepEqual(followerGate({ isGM: true, level: 9, arrival: 9, hasStronghold: true }), { block: false, warn: [] }, "the arrival level itself is met");
});

console.log(`${n} tests passed`);
