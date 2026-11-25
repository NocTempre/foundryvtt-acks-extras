/**
 * The item runner's presenter (`item-run-presenter.mjs`), offline: a raise posts
 * one card, a moment that comes before it waits and replays, a listing, a
 * refusal, a prompt and an exit change the stored card, a prompt whispers the
 * save to the owners of the subject's token (Foundry's ownership, no role), and
 * each seat's body shows only what that seat may press. Foundry-free with
 * stand-ins; every name and figure below is invented.
 *
 * Usage: node tools/test-item-run-presenter.mjs
 */
import assert from "node:assert/strict";

globalThis.Hooks = { once() {}, on() {}, callAll() {} };
globalThis.foundry = { utils: { randomID: () => "rid", escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") } };
globalThis.CONFIG = { statusEffects: [{ id: "held", name: "Held" }] };
const messages = [];
messages.get = (id) => messages.find((m) => m.id === id);
class Users extends Array {
  get(id) { return this.find((u) => u.id === id); }
}
const users = Users.from([{ id: "gm", isGM: true }, { id: "pa" }, { id: "pb" }]);
users.activeGM = { isSelf: true };
const me = { current: users[0] };
globalThis.game = { i18n: { format: (k) => k, localize: (k) => k }, users, messages, time: { worldTime: 0 }, get user() { return me.current; }, combat: null };
const walk = (obj, path, value) => {
  const parts = path.split(".");
  let at = obj;
  for (const part of parts.slice(0, -1)) at = at[part] ??= {};
  at[parts.at(-1)] = value;
};
let minted = 0;
globalThis.ChatMessage = {
  getSpeaker: () => ({}),
  create: async (data) => {
    const message = { id: `M${++minted}`, ...data, flags: structuredClone(data.flags ?? {}), getFlag(scope, key) { return this.flags[scope]?.[key]; }, async update(change) { for (const [path, value] of Object.entries(change)) path.startsWith("flags.") ? walk(this, path, value) : (this[path] = value); } };
    const update = message.update;
    message.update = async (change) => {
      const next = {};
      for (const [path, value] of Object.entries(change)) {
        // A `-=` segment deletes the key after it, as core's update does.
        const parts = path.split(".");
        const at = parts.findIndex((p) => p.startsWith("-="));
        if (at >= 0) {
          let node = message;
          for (const part of parts.slice(0, at)) node = node[part] ??= {};
          delete node[parts[at].slice(2)];
        } else next[path] = value;
      }
      return update.call(message, next);
    };
    messages.push(message);
    return message;
  },
};
globalThis.ui = { notifications: { warn() {}, error() {} } };

const presenter = await import("../scripts/lib/item-run-presenter.mjs");
const run = await import("../scripts/lib/item-run.mjs");

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const ownedBy = (...ids) => (user) => ids.includes(user?.id);
const tokens = {
  "S.bear": { id: "bear", uuid: "S.bear", name: "Bearer", actor: {}, testUserPermission: ownedBy("gm") },
  "S.a": { id: "a", uuid: "S.a", name: "Alpha", actor: {}, testUserPermission: ownedBy("gm", "pa") },
  "S.b": { id: "b", uuid: "S.b", name: "Beta", actor: {}, testUserPermission: ownedBy("gm", "pb") },
};
const item = { uuid: "I.1", name: "Gear", type: "item", testUserPermission: ownedBy("gm", "pa"), flags: { "acks-extras": { itemRun: { activation: { kind: "toggle" }, rows: [{ key: "t", conditions: ["held"], reach: { pulse: "turnStart+moveIn", radius: { value: "30" }, filter: {} } }] } } } };
globalThis.fromUuidSync = (uuid) => (uuid === "I.1" ? item : tokens[uuid] ?? null);
const config = { activationId: "act" };
const moment = (act, key, over = {}) => ({ ok: true, kind: "reach", act, moment: "turnStart", config, rowKey: "t", item, subject: { token: tokens[key], actor: tokens[key].actor }, ...over });
const stored = () => messages.find((m) => m.flags["acks-extras"]?.itemRunCard)?.flags["acks-extras"].itemRunCard;
const whispers = () => messages.filter((m) => m.flags["acks-extras"]?.itemRunWhisper);

await t("a moment that comes before the raised card waits for it and is replayed when the card is posted", async () => {
  await presenter.presentReach(moment("list", "S.a"));
  await presenter.presentReach(moment("refuse", "S.b"));
  assert.equal(messages.length, 0, "no card yet, nothing posted");
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act", itemUuid: "I.1", rowKey: "t", tokenUuid: "S.bear", regionUuid: "S.R" });
  assert.equal(messages.length, 1, "one raised card");
  assert.deepEqual([stored().subjects["S~a"].state, stored().subjects["S~b"].state], ["in", "notTarget"]);
  assert.equal(stored().selfCount, false, "the bearer is not counted by default");
  assert.equal(whispers().length, 0, "a raise whispers nobody");
});

await t("a prompt opens an entry under its moment key and whispers the owners of the subject's token, a Judge among them", async () => {
  await presenter.presentReach(moment("prompt", "S.a", { momentKey: "c1:1:0:S.a:kind" }));
  const card = stored();
  assert.equal(card.entries["c1:1:0:S~a:kind"].state, "open");
  assert.equal(card.subjects["S~a"].latest, "c1:1:0:S~a:kind");
  const [whisper] = whispers();
  assert.deepEqual([...whisper.whisper], ["gm", "pa"], "Foundry's ownership: the body's owner and the Judge, never the other player");
  assert.deepEqual([whisper.flags["acks-extras"].itemRunWhisper.messageId, whisper.flags["acks-extras"].itemRunWhisper.entryKey], [messages[0].id, "c1:1:0:S~a:kind"], "the whisper names the raised card and the entry");
  assert.equal(card.entries["c1:1:0:S~a:kind"].whisperId, whisper.id);
  await presenter.presentReach(moment("prompt", "S.a", { momentKey: "c1:2:0:S.a:kind" }));
  assert.deepEqual(Object.keys(stored().entries), ["c1:2:0:S~a:kind"], "a later initiative strikes the earlier open entry");
  await presenter.presentReach(moment("out", "S.a"));
  assert.equal(stored().subjects["S~a"].state, "out");
  assert.deepEqual(Object.keys(stored().entries), [], "leaving strikes the open entry");
  await presenter.presentReach(moment("undetermined", "S.b"));
  assert.equal(stored().undetermined["S~b"], undefined, "a listed subject is not undetermined");
});

await t("each seat's body shows only what it may press: the Judge every row, an owner its own, and the bearer's tick to an owner of the item", async () => {
  await presenter.presentReach(moment("list", "S.a"));
  const body = (user) => {
    me.current = user;
    return presenter.raisedBody(messages[0], stored());
  };
  const judge = body(users[0]);
  assert.ok(judge.includes("Alpha") && judge.includes("Beta"), "the Judge sees every row");
  assert.ok(judge.includes('data-action="itemRun.roll"'), "and the early press on a waiting row");
  assert.ok(judge.includes('data-action="itemRun.tick"'), "the Judge owns the item here");
  const pa = body(users[1]);
  assert.ok(pa.includes("Alpha") && !pa.includes("Beta"), "an owner sees the rows of the tokens it owns");
  assert.ok(!pa.includes('data-action="itemRun.roll"'), "a waiting row has no press for a seat that is not a Judge");
  assert.ok(pa.includes('data-action="itemRun.tick"'), "an owner of the item may count the bearer in, with no role read");
  assert.ok(!pa.includes('data-action="itemRun.lower"'), "Lower is the bearer's owners'");
  const pb = body(users[2]);
  assert.ok(!pb.includes("Alpha") && pb.includes("Beta") && !pb.includes("itemRun.tick"));
  me.current = users[0];
});

await t("lowering marks the card lowered, mutes every row and strikes what was open", async () => {
  await presenter.presentReach(moment("prompt", "S.a", { momentKey: "k9" }));
  assert.equal(stored().entries.k9.state, "open");
  await presenter.onLifted({ activationId: "act" });
  assert.equal(stored().lowered, true);
  assert.deepEqual([stored().subjects["S~a"].state, stored().subjects["S~b"].state], ["out", "out"]);
  assert.deepEqual(Object.keys(stored().entries), []);
  const before = JSON.stringify(stored());
  await presenter.presentReach(moment("list", "S.a"));
  assert.equal(JSON.stringify(stored()), before, "a lowered card takes no more moments");
  assert.ok(!presenter.raisedBody(messages[0], stored()).includes("itemRun.lower"), "nothing left to lower");
  assert.equal(typeof run.setUsePresenter, "function");
});

console.log(`\ntest-item-run-presenter: ${passed} checks passed.`);
