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
  assert.ok(pa.includes("itemRun.card.waiting"), "and the row says in its Result that the save waits for the body's moment");
  const cell = (v) => Math.floor(v / 100);
  const scene = { id: "sc", grid: { units: "ft", size: 100, measurePath: ([p, q]) => ({ distance: Math.max(Math.abs(cell(p.x) - cell(q.x)), Math.abs(cell(p.y) - cell(q.y))) * 5 }) } };
  for (const [key, x] of [["S.bear", 0], ["S.a", 300], ["S.b", 100]]) Object.assign(tokens[key], { parent: scene, x, y: 0, width: 1, height: 1 });
  const near = body(users[0]);
  assert.ok(near.includes("10′") && /(^|[^0-9])0′/.test(near) && !near.includes("15′") && !/(^|[^0-9])5′/.test(near), "the distance is measured edge to edge: two empty squares from the bearer is 10′ (its centres are 15′) and a token beside it 0′ (its centres are 5′)");
  assert.ok(pa.includes('data-action="itemRun.tick"'), "an owner of the item may count the bearer in, with no role read");
  assert.ok(!pa.includes('data-action="itemRun.lower"'), "Lower is the bearer's owners'");
  const pb = body(users[2]);
  assert.ok(!pb.includes("Alpha") && pb.includes("Beta") && !pb.includes("itemRun.tick"));
  me.current = users[0];
});

await t("the strip: a body reads the reaches that meet its token, the save owed with a press for its owners alone, an immunity with its turns left, a standing part, and nothing where no reach meets it", async () => {
  const { reachStripFor } = await import("../scripts/lib/item-run-strip.mjs");
  globalThis.CONST = { TOKEN_DISPLAY_MODES: { NONE: 0, OWNER_HOVER: 20, OWNER: 40, ALWAYS: 50 } };
  const item2 = { uuid: "I.2", name: "Aura", type: "item", flags: { "acks-extras": { itemRun: { rows: [{ key: "s", reach: { pulse: "standing", radius: { value: "20" }, modifier: { value: "-1" }, on: ["morale"], filter: {} } }] } } } };
  const prior = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "I.2" ? item2 : prior(uuid));
  const regionOf = (itemUuid, rowKey, activationId) => ({ hidden: false, attachment: { token: "bear" }, behaviors: [{ type: "acks-extras.aura", disabled: false, system: { sourceUuid: itemUuid, bearerUuid: "A.bear", activationId, rowKey } }] });
  const reach = regionOf("I.1", "t", "act");
  const standing = regionOf("I.2", "s", "act2");
  const cell = (v) => Math.floor(v / 100);
  const scene = { id: "sc2", grid: { units: "ft", size: 100, measurePath: ([p, q]) => ({ distance: Math.max(Math.abs(cell(p.x) - cell(q.x)), Math.abs(cell(p.y) - cell(q.y))) * 5 }) }, regions: [reach, standing], tokens: { get: (id) => Object.values(tokens).find((tk) => tk.id === id) } };
  reach.parent = scene;
  standing.parent = scene;
  for (const key of ["S.bear", "S.a", "S.b"]) tokens[key].parent = scene;
  Object.assign(tokens["S.bear"], { displayName: 50, regions: new Set() });
  tokens["S.a"].regions = new Set([reach, standing]);
  tokens["S.b"].regions = new Set();
  const effects = [];
  const actorOf = (key, ...owners) => Object.assign(tokens[key].actor, { testUserPermission: ownedBy(...owners), getActiveTokens: () => [tokens[key]], effects });
  const actorA = actorOf("S.a", "gm", "pa");
  const actorB = actorOf("S.b", "gm", "pb");
  me.current = users[1];
  await presenter.presentReach(moment("prompt", "S.a", { momentKey: "ks1" }));
  const owed = reachStripFor(actorA);
  assert.deepEqual(owed.rows.map((r) => [r.name, r.tag]), [["Gear", "owed"], ["Aura", "always"]], "the save owed comes before the part that asks nothing");
  const row = owed.rows[0];
  assert.deepEqual([row.source, row.feet, row.radius, row.press.subject, row.press.entryKey, row.press.messageId, row.press.itemUuid], ["Bearer", 10, 30, "S.a", "ks1", "M1", "I.1"], "the source's name, the edge-to-edge distance, the reach and the press that names the card's entry");
  assert.equal(owed.rows[1].part.value, "−1", "the standing part's figure is signed");
  assert.equal(reachStripFor(actorB), null, "a body no reach meets has no strip");
  me.current = users[2];
  assert.equal(reachStripFor(actorA), null, "a seat that owns no body of it sees no strip");
  me.current = users[0];
  assert.ok(reachStripFor(actorA).rows[0].press, "the owner's Save is offered by ownership, a Judge owning every body");
  me.current = users[1];
  const ownsToken = tokens["S.a"].testUserPermission;
  tokens["S.a"].testUserPermission = ownedBy("gm");
  assert.equal(reachStripFor(actorA).rows[0].press, null, "the Save is offered by ownership of the token that saves, not of the strip's sheet");
  tokens["S.a"].testUserPermission = ownsToken;
  tokens["S.bear"].displayName = 40;
  assert.equal(reachStripFor(actorA).rows[0].source, "ACKS-LIB.itemRun.strip.unseen", "a name core shows only to the bearer's owners is withheld from the body's");
  tokens["S.bear"].displayName = 50;
  effects.push({ disabled: false, flags: { "acks-extras": { rollMods: { parts: [{ on: "immune", spells: ["t"] }] }, itemRun: { dueAt: 1200 } } } });
  const immune = reachStripFor(actorA).rows.find((r) => r.name === "Gear");
  assert.deepEqual([immune.tag, immune.left, immune.press], ["immune", 2, null], "an immunity reads its turns left from the module clock's dueAt, and offers no press");
  effects.length = 0;
  const { pressStripSave } = await import("../scripts/lib/item-run-strip.mjs");
  const warned = [];
  const warn = ui.notifications.warn;
  ui.notifications.warn = (m) => warned.push(m);
  await pressStripSave({ dataset: { subject: "S.b", itemUuid: "I.1", rowKey: "t", activationId: "act", messageId: "M1" } });
  ui.notifications.warn = warn;
  assert.deepEqual(warned, ["ACKS-LIB.itemRun.refused.notOwner"], "a Save press on a body the seat does not own is refused before anything is rolled");
  globalThis.fromUuidSync = prior;
  await presenter.presentReach(moment("out", "S.a"));
  me.current = users[0];
});

await t("a re-raise after a lowering reads the choice the item kept: a bearer its filter counts in is offered Count out and not Count in", async () => {
  const rowReach = item.flags["acks-extras"].itemRun.rows[0].reach;
  const body = () => presenter.raisedBody(messages[0], stored());
  assert.ok(body().includes("itemRun.tick") && !body().includes("itemRun.untick"), "a bearer its filter does not count is offered Count in");
  rowReach.filter = { self: "count" };
  const counted = body();
  assert.ok(counted.includes("itemRun.untick") && !counted.includes("itemRun.tick"), "the item's own filter decides, whatever the card was posted with");
  rowReach.filter = {};
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
