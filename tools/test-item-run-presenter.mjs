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
class ForcedDeletion {}
const unset = () => new ForcedDeletion();
globalThis.foundry = { data: { operators: { ForcedDeletion } }, utils: { randomID: () => "rid", escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") } };
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
        // A forced deletion deletes the key it is written to, as core's update does.
        if (value instanceof ForcedDeletion) {
          const parts = path.split(".");
          let node = message;
          for (const part of parts.slice(0, -1)) node = node[part] ??= {};
          delete node[parts.at(-1)];
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

await t("a once-only use's card lists the bodies its filter could not settle, with a Count in offered by ownership of the ITEM and not of the body or a role, for a use with a save and one without", async () => {
  const post = async (activationId, over) => {
    await presenter.presentUse({ ok: true, kind: "once", itemUuid: "I.1", rowKey: "t", activationId, subjects: [{ key: "S.a", name: "Alpha" }], undetermined: [{ key: "S.b", name: "Beta" }], ...over });
    const message = messages.at(-1);
    return { message, card: message.flags["acks-extras"].itemRunCard };
  };
  const bodyFor = (posted, user) => {
    me.current = user;
    return presenter.onceBody(posted.message, posted.card);
  };
  const withSave = await post("o1", { card: { title: "Gear", subtitle: "Bearer" } });
  const direct = await post("o2", { written: [{ key: "S.a", name: "Alpha", recordIds: ["E1"] }] });
  assert.equal(direct.card.direct, true);
  for (const posted of [withSave, direct]) {
    const owner = bodyFor(posted, users[1]);
    assert.ok(owner.includes("Beta") && owner.includes('data-action="itemRun.tickSubject"'), "an owner of the item sees the undetermined body and its Count in, owning neither body");
    assert.ok(owner.includes("ACKS-LIB.itemRun.card.countSubjectTip"), "the control says what it does in its tooltip");
    const bodyOwner = bodyFor(posted, users[2]);
    assert.ok(!bodyOwner.includes("Beta") && !bodyOwner.includes("itemRun.tickSubject"), "the owner of the undetermined body who does not own the item sees neither the row nor the tick");
    assert.ok(bodyFor(posted, users[0]).includes('data-action="itemRun.tickSubject"'), "a Judge owns the item here, so it is offered by that");
  }
  assert.ok(!bodyFor(withSave, users[1]).includes('data-action="itemRun.tick"'), "no bearer tick leaks into a once-only card");
  me.current = users[0];
});

await t("a raised card lists the bodies its filter could not settle with a Count in for the owners of the item, a body counted in reads as held under a standing reach, and lowering returns it to undetermined for the next raise's card to start without it", async () => {
  const { patchCountIn } = await import("../scripts/lib/item-run-card-logic.mjs");
  tokens["S.c"] = { id: "c", uuid: "S.c", name: "Gamma", actor: {}, testUserPermission: ownedBy("gm", "pb") };
  const own = { activationId: "act3" };
  const at = (act, key, over = {}) => ({ ...moment(act, key, over), config: own });
  const rowReach = item.flags["acks-extras"].itemRun.rows[0].reach;
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act3", itemUuid: "I.1", rowKey: "t", tokenUuid: "S.bear", regionUuid: "S.R3" });
  const message = messages.at(-1);
  const card = () => message.flags["acks-extras"].itemRunCard;
  await presenter.presentReach(at("undetermined", "S.c"));
  assert.deepEqual(Object.keys(card().undetermined), ["S~c"], "the filter's null is kept on the raised card");
  const bodyFor = (user) => {
    me.current = user;
    return presenter.raisedBody(message, card());
  };
  const judge = bodyFor(users[0]);
  assert.ok(judge.includes("Gamma") && judge.includes('data-action="itemRun.tickSubject"') && judge.includes("ACKS-LIB.itemRun.card.undetermined"), "an owner of the item sees the undetermined section with a Count in on the row");
  assert.ok(judge.includes("ACKS-LIB.itemRun.card.countSubjectRaisedTip") && !judge.includes("ACKS-LIB.itemRun.card.countSubjectTip"), "its tooltip says the count lasts while the item stays raised, not for a use");
  assert.ok(bodyFor(users[1]).includes('data-action="itemRun.tickSubject"'), "an owner of the item that owns no body sees it as well");
  const bodyOwner = bodyFor(users[2]);
  assert.ok(!bodyOwner.includes("Gamma") && !bodyOwner.includes("itemRun.tickSubject"), "the owner of the undetermined body who does not own the item sees neither its row nor a Count in");
  await message.update({ "flags.acks-extras.itemRunCard.lowered": true });
  assert.ok(!bodyFor(users[0]).includes("itemRun.tickSubject"), "a lowered card offers no Count in");
  await message.update({ "flags.acks-extras.itemRunCard.lowered": false });
  // Counted in: the row joins the table and the section empties.
  const countIn = async () => {
    const patch = patchCountIn(card(), { uuid: "S.c", name: "Gamma" });
    await message.update(Object.fromEntries(Object.entries(patch).map(([path, value]) => [`flags.acks-extras.itemRunCard.${path}`, value])));
  };
  await countIn();
  assert.deepEqual([Object.keys(card().undetermined), Object.keys(card().counted)], [[], ["S~c"]], "the body moves from undetermined to counted");
  const prompting = bodyFor(users[0]);
  assert.ok(prompting.includes("Gamma") && prompting.includes("ACKS-LIB.itemRun.card.waiting") && !prompting.includes("itemRun.tickSubject"), "under a prompting reach the counted body waits for its moment");
  rowReach.pulse = "standing";
  try {
    const standing = bodyFor(users[0]);
    assert.ok(standing.includes("ACKS-LIB.itemRun.card.counted") && !standing.includes("ACKS-LIB.itemRun.card.waiting"), "under a standing reach, which asks no save, it reads as counted in");
    await presenter.presentReach(at("list", "S.a"));
    const listed = bodyFor(users[0]);
    assert.ok(listed.includes("ACKS-LIB.itemRun.card.always") && !listed.includes("ACKS-LIB.itemRun.card.waiting") && !listed.includes("itemRun.roll"), "a body the filter admitted reads held too, in its own word, with no Save for the Judge");
  } finally {
    rowReach.pulse = "turnStart+moveIn";
  }
  // Lowering returns the counted body to undetermined, and the next raise's card starts empty.
  await presenter.onLifted(own);
  assert.deepEqual([card().lowered, Object.keys(card().counted), Object.keys(card().undetermined)], [true, [], ["S~c"]], "a lowered card holds the body undetermined again and counts nobody");
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act4", itemUuid: "I.1", rowKey: "t", tokenUuid: "S.bear", regionUuid: "S.R3" });
  const next = messages.at(-1).flags["acks-extras"].itemRunCard;
  assert.deepEqual([next.activationId, next.counted, next.undetermined], ["act4", {}, {}], "a re-raise posts a card of its own that counts nobody");
  await presenter.onLifted({ activationId: "act4" });
  delete tokens["S.c"];
  me.current = users[0];
});

await t("the strip reads a body its filter could not settle only once an owner of the item counted it in for the raise", async () => {
  const { reachStripFor } = await import("../scripts/lib/item-run-strip.mjs");
  const { patchCountIn } = await import("../scripts/lib/item-run-card-logic.mjs");
  const rowReach = item.flags["acks-extras"].itemRun.rows[0].reach;
  const cell = (v) => Math.floor(v / 100);
  const scene = { id: "sc3", grid: { units: "ft", size: 100, measurePath: ([p, q]) => ({ distance: Math.max(Math.abs(cell(p.x) - cell(q.x)), Math.abs(cell(p.y) - cell(q.y))) * 5 }) }, tokens: { get: (id) => Object.values(tokens).find((tk) => tk.id === id) } };
  const region = { hidden: false, parent: scene, attachment: { token: "bear" }, behaviors: [{ type: "acks-extras.aura", disabled: false, system: { sourceUuid: "I.1", bearerUuid: "A.bear", activationId: "act", rowKey: "t" } }] };
  scene.regions = [region];
  globalThis.CONST = { TOKEN_DISPLAY_MODES: { NONE: 0, OWNER_HOVER: 20, OWNER: 40, ALWAYS: 50 } };
  const prior = { regions: tokens["S.a"].regions, parent: tokens["S.a"].parent, bearer: tokens["S.bear"].parent, actor: tokens["S.a"].actor };
  tokens["S.a"].regions = new Set([region]);
  tokens["S.a"].parent = scene;
  tokens["S.bear"].parent = scene;
  tokens["S.a"].actor = { testUserPermission: ownedBy("gm", "pa"), getActiveTokens: () => [tokens["S.a"]], effects: [] };
  const card = messages[0];
  rowReach.filter = { kinds: ["zzz"] };
  me.current = users[1];
  try {
    assert.equal(reachStripFor(tokens["S.a"].actor), null, "a body the filter leaves undetermined has no row");
    const patch = patchCountIn(card.flags["acks-extras"].itemRunCard, { uuid: "S.a", name: "Alpha" });
    await card.update(Object.fromEntries(Object.entries(patch).map(([path, value]) => [`flags.acks-extras.itemRunCard.${path}`, value])));
    assert.deepEqual(reachStripFor(tokens["S.a"].actor)?.rows.map((r) => r.name), ["Gear"], "counted in, the reach is read over it as over an admitted body");
  } finally {
    rowReach.filter = {};
    Object.assign(tokens["S.a"], { regions: prior.regions, parent: prior.parent, actor: prior.actor });
    tokens["S.bear"].parent = prior.bearer;
    await card.update({ "flags.acks-extras.itemRunCard.counted.S~a": unset() });
    me.current = users[0];
  }
});

await t("Check range again reads a counted body as admitted, so a body that went out and came back is listed again, and lists an uncounted undetermined one for the Count in", async () => {
  tokens["S.c"] = { id: "c", uuid: "S.c", name: "Gamma", actor: {}, testUserPermission: ownedBy("gm", "pb") };
  tokens["S.d"] = { id: "d", uuid: "S.d", name: "Delta", actor: {}, testUserPermission: ownedBy("gm") };
  tokens["S.R5"] = { tokens: [tokens["S.c"], tokens["S.d"]] };
  const rowReach = item.flags["acks-extras"].itemRun.rows[0].reach;
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act5", itemUuid: "I.1", rowKey: "t", tokenUuid: "S.bear", regionUuid: "S.R5" });
  const message = messages.at(-1);
  const card = () => message.flags["acks-extras"].itemRunCard;
  const write = (patch) => message.update(Object.fromEntries(Object.entries(patch).map(([path, value]) => [`flags.acks-extras.itemRunCard.${path}`, value])));
  const { patchCountIn, patchOut } = await import("../scripts/lib/item-run-card-logic.mjs");
  rowReach.filter = { kinds: ["zzz"] };
  try {
    await write(patchCountIn(card(), { uuid: "S.c", name: "Gamma" }));
    await write(patchOut(card(), { uuid: "S.c", name: "Gamma" }).patch);
    assert.equal(card().subjects["S~c"].state, "out", "the counted body left");
    me.current = users[0];
    assert.equal((await presenter.recheckHere({ messageId: message.id })).ok, true);
    assert.equal(card().subjects["S~c"].state, "in", "back inside, a counted body is listed again");
    assert.deepEqual([Object.keys(card().undetermined), card().subjects["S~d"], card().counted["S~d"]], [["S~d"], undefined, undefined], "a body no one counted stays undetermined for its Count in");
  } finally {
    rowReach.filter = {};
    await presenter.onLifted({ activationId: "act5" });
    delete tokens["S.c"]; delete tokens["S.d"]; delete tokens["S.R5"];
  }
});

await t("a standing reach's raised card reads every body in reach as held, with the part and its page in the tooltip and no Save for any seat, mutes it at its exit and holds it again at its re-entry, and drops an undetermined body that left, by the card's own exit and by Check range again", async () => {
  const standingItem = { uuid: "I.3", name: "Aura", type: "item", testUserPermission: ownedBy("gm", "pa"), flags: { "acks-extras": { cookbook: { cite: "XX p. 6" }, itemRun: { activation: { kind: "toggle" }, rows: [{ key: "s", reach: { pulse: "standing", radius: { value: "20" }, modifier: { value: "-1" }, on: ["morale"], filter: {} } }] } } } };
  const priorFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "I.3" ? standingItem : priorFrom(uuid));
  const reachRow = standingItem.flags["acks-extras"].itemRun.rows[0].reach;
  tokens["S.c"] = { id: "c", uuid: "S.c", name: "Gamma", actor: {}, testUserPermission: ownedBy("gm", "pb") };
  tokens["S.d"] = { id: "d", uuid: "S.d", name: "Delta", actor: {}, testUserPermission: ownedBy("gm") };
  tokens["S.R6"] = { tokens: [tokens["S.c"], tokens["S.d"]] };
  const own = { activationId: "act6" };
  const at = (act, key) => ({ ...moment(act, key), config: own, rowKey: "s", item: standingItem });
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act6", itemUuid: "I.3", rowKey: "s", tokenUuid: "S.bear", regionUuid: "S.R6" });
  const message = messages.at(-1);
  const card = () => message.flags["acks-extras"].itemRunCard;
  const bodyFor = (user) => {
    me.current = user;
    return presenter.raisedBody(message, card());
  };
  const format = game.i18n.format;
  game.i18n.format = (key, data) => (data && Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key);
  try {
    // Check range again lists the bodies the filter admits: a standing reach asks no save, so they are held and not waiting.
    assert.equal((await presenter.recheckHere({ messageId: message.id })).ok, true);
    assert.deepEqual([card().subjects["S~c"].state, card().subjects["S~d"].state], ["in", "in"], "both are listed in reach");
    for (const user of users) {
      const body = bodyFor(user);
      for (const name of ["Gamma", "Delta"]) if (user.id === "gm" || (user.id === "pb" && name === "Gamma")) assert.ok(body.includes(name), `${user.id} sees ${name}`);
      assert.ok(!body.includes("ACKS-LIB.itemRun.card.waiting"), `${user.id}: a standing reach waits for no moment`);
      assert.ok(!body.includes("itemRun.roll"), `${user.id}: no Save and no early Save on a held row, a Judge included`);
    }
    const judge = bodyFor(users[0]);
    assert.equal(judge.split("ACKS-LIB.itemRun.card.always").length - 1, 2, "both read in the held word, which is not the counted one");
    assert.ok(!judge.includes("ACKS-LIB.itemRun.card.counted"));
    const heldTips = [...judge.matchAll(/<td data-tooltip-text="(ACKS-LIB.itemRun.card.tip.held[^"]*)"><strong>/g)].map((m) => m[1]);
    assert.equal(heldTips.length, 2, "each held row carries the tooltip on its Result");
    for (const tip of heldTips) assert.ok(tip.includes("Aura") && tip.includes("itemRun.strip.on.morale") && tip.includes("−1") && tip.endsWith("(XX p. 6)"), "it names the item, the part held with its figure and the page");
    // No figure imported: the page reference alone, and no figure in its place.
    const modifier = reachRow.modifier;
    delete reachRow.modifier;
    const blank = bodyFor(users[0]);
    assert.equal(blank.split('<td data-tooltip-text="XX p. 6"><strong>').length - 1, 2, "a blank figure leaves the page alone as the Result's tooltip");
    assert.ok(!blank.includes("ACKS-LIB.itemRun.card.tip.held") && !blank.includes("−"), "and names no figure");
    reachRow.modifier = modifier;
    // An exit mutes the row and a re-entry holds it again.
    await presenter.presentReach(at("out", "S.c"));
    assert.equal(card().subjects["S~c"].state, "out");
    const gone = bodyFor(users[0]);
    assert.ok(gone.includes("ACKS-LIB.itemRun.card.out") && gone.split("ACKS-LIB.itemRun.card.always").length - 1 === 1, "the body that left is out, the other still held");
    await presenter.presentReach(at("list", "S.c"));
    assert.equal(card().subjects["S~c"].state, "in");
    assert.equal(bodyFor(users[0]).split("ACKS-LIB.itemRun.card.always").length - 1, 2, "back in reach it is held again");
    // A counted body keeps its own word and the same tooltip.
    const { patchCountIn } = await import("../scripts/lib/item-run-card-logic.mjs");
    await message.update(Object.fromEntries(Object.entries(patchCountIn(card(), { uuid: "S.c", name: "Gamma" })).map(([path, value]) => [`flags.acks-extras.itemRunCard.${path}`, value])));
    const counted = bodyFor(users[0]);
    assert.equal(counted.split("ACKS-LIB.itemRun.card.counted").length - 1, 1, "counted in reads Counted in");
    assert.equal(counted.split("ACKS-LIB.itemRun.card.tip.held").length - 1, 2, "and every held row carries the part");
    await message.update({ "flags.acks-extras.itemRunCard.counted.S~c": unset() });
    // An uncounted body held undetermined is dropped at its exit, and listed again at its entry.
    reachRow.filter = { kinds: ["zzz"] };
    await message.update({ "flags.acks-extras.itemRunCard.subjects.S~d": unset(), "flags.acks-extras.itemRunCard.subjects.S~c": unset() });
    await presenter.presentReach(at("undetermined", "S.d"));
    assert.deepEqual(Object.keys(card().undetermined), ["S~d"]);
    await presenter.presentReach(at("forget", "S.d"));
    assert.deepEqual([Object.keys(card().undetermined), card().subjects["S~d"]], [[], undefined], "its exit takes it off the list, and no muted row is made of it");
    assert.ok(!bodyFor(users[0]).includes("Delta"), "the card no longer shows it");
    await presenter.presentReach(at("undetermined", "S.d"));
    assert.deepEqual(Object.keys(card().undetermined), ["S~d"], "its next entry lists it again for a Count in");
    // Check range again drops a body held undetermined that is no longer inside.
    tokens["S.R6"].tokens = [tokens["S.c"]];
    assert.equal((await presenter.recheckHere({ messageId: message.id })).ok, true);
    assert.deepEqual([Object.keys(card().undetermined), card().subjects["S~d"]], [["S~c"], undefined], "a recheck drops it too, and lists the body still inside that the filter cannot settle");
  } finally {
    game.i18n.format = format;
    reachRow.filter = {};
    await presenter.onLifted(own);
    globalThis.fromUuidSync = priorFrom;
    delete tokens["S.c"]; delete tokens["S.d"]; delete tokens["S.R6"];
    me.current = users[0];
  }
});

await t("a counted bearer reads by its reach's kind: under a standing reach its row is held, in the held word with the part in the tooltip, no Save for any seat and a Count out for the owners of the item, and under a prompting reach it waits for its turn start", async () => {
  const standingItem = { uuid: "I.3", name: "Aura", type: "item", testUserPermission: ownedBy("gm", "pa"), flags: { "acks-extras": { cookbook: { cite: "XX p. 6" }, itemRun: { activation: { kind: "toggle" }, rows: [{ key: "s", reach: { pulse: "standing", radius: { value: "20" }, modifier: { value: "-1" }, on: ["morale"], filter: { self: "count" } } }] } } } };
  const priorFrom = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => (uuid === "I.3" ? standingItem : priorFrom(uuid));
  const reachRow = standingItem.flags["acks-extras"].itemRun.rows[0].reach;
  const own = { activationId: "act7" };
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act7", itemUuid: "I.3", rowKey: "s", tokenUuid: "S.bear", regionUuid: "S.R7" });
  const message = messages.at(-1);
  const card = () => message.flags["acks-extras"].itemRunCard;
  const bodyFor = (user) => {
    me.current = user;
    return presenter.raisedBody(message, card());
  };
  const format = game.i18n.format;
  game.i18n.format = (key, data) => (data && Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key);
  try {
    // The item's filter counts the bearer (a choice kept across raises): the raise lists its row, as a Count in does.
    assert.deepEqual([card().selfCount, card().subjects["S~bear"].state], [true, "in"], "the raised card lists the counted bearer without a press");
    for (const user of users) {
      const body = bodyFor(user);
      if (user.id === "pb") { assert.ok(!body.includes("ACKS-LIB.itemRun.card.bearer"), "a seat that owns neither the bearer nor the item sees no bearer row"); continue; }
      assert.ok(body.includes("ACKS-LIB.itemRun.card.always"), `${user.id}: the bearer's row reads held`);
      assert.ok(!body.includes("ACKS-LIB.itemRun.card.waiting") && !body.includes("itemRun.roll"), `${user.id}: it waits for no moment and offers no Save or early Save`);
      assert.ok(body.includes("ACKS-LIB.itemRun.card.tip.held") && body.includes("XX p. 6"), `${user.id}: the Result's tooltip names the part and the page`);
    }
    const judge = bodyFor(users[0]);
    assert.ok(judge.includes('data-action="itemRun.untick"') && !judge.includes('data-action="itemRun.tick"'), "the owners of the item are offered Count out, and no Count in");
    assert.equal(judge.split("ACKS-LIB.itemRun.card.always").length - 1, 1, "the bearer reads held in the held word");
    assert.ok(!judge.includes("ACKS-LIB.itemRun.card.counted"), "and not as a body an owner counted in");
    // Under a prompting reach the same row waits for its turn start, and a Judge keeps the early Save.
    reachRow.pulse = "turnStart+moveIn";
    const prompting = bodyFor(users[0]);
    assert.ok(prompting.includes("ACKS-LIB.itemRun.card.waiting") && prompting.includes('data-action="itemRun.roll"') && !prompting.includes("ACKS-LIB.itemRun.card.tip.held"), "a prompting reach's bearer waits and holds no part");
    reachRow.pulse = "standing";
    // Lowered, the row is muted whatever the pulse, and a Count in pressed on the dead card lists a row that is not read as held.
    await presenter.onLifted(own);
    assert.equal(card().subjects["S~bear"].state, "out");
    assert.ok(!bodyFor(users[0]).includes("ACKS-LIB.itemRun.card.always"), "a lowered card holds nothing");
    await message.update({ "flags.acks-extras.itemRunCard.subjects.S~bear.state": "in" });
    assert.ok(!bodyFor(users[0]).includes("ACKS-LIB.itemRun.card.always"), "a bearer listed on a lowered card is not read as held");
  } finally {
    game.i18n.format = format;
    globalThis.fromUuidSync = priorFrom;
    me.current = users[0];
  }
});

await t("under a prompting reach an exit leaves a body in one list and a re-entry lists it again: a body held undetermined that leaves goes off the list, one that is listed in reach and held undetermined at once is muted in a row alone, and one that comes back unsettled is listed undetermined without the muted row", async () => {
  tokens["S.c"] = { id: "c", uuid: "S.c", name: "Gamma", actor: {}, testUserPermission: ownedBy("gm", "pb") };
  const own = { activationId: "act8" };
  const at = (act, key) => ({ ...moment(act, key), config: own });
  await presenter.presentUse({ ok: true, kind: "toggle", active: true, activationId: "act8", itemUuid: "I.1", rowKey: "t", tokenUuid: "S.bear", regionUuid: "S.R8" });
  const message = messages.at(-1);
  const card = () => message.flags["acks-extras"].itemRunCard;
  const lists = (key) => [card().undetermined[key] !== undefined, card().subjects[key] !== undefined];
  try {
    await presenter.presentReach(at("undetermined", "S.c"));
    assert.deepEqual(lists("S~c"), [true, false], "held undetermined");
    await presenter.presentReach(at("out", "S.c"));
    assert.deepEqual([lists("S~c"), card().subjects["S~c"].state], [[false, true], "out"], "its exit mutes a row and leaves the undetermined list: one list");
    await presenter.presentReach(at("undetermined", "S.c"));
    assert.deepEqual(lists("S~c"), [true, false], "back inside and unsettled, it is listed undetermined and the muted row is gone");
    await presenter.presentReach(at("list", "S.c"));
    assert.deepEqual(lists("S~c"), [false, true], "listed in reach once the filter settles it");
    await message.update({ "flags.acks-extras.itemRunCard.undetermined.S~c": { uuid: "S.c", name: "Gamma" } });
    assert.deepEqual(lists("S~c"), [true, true], "a body in both lists, as a card kept before the fix held it");
    await presenter.presentReach(at("out", "S.c"));
    assert.deepEqual([lists("S~c"), card().subjects["S~c"].state], [[false, true], "out"], "its exit leaves it in the one");
  } finally {
    await presenter.onLifted(own);
    delete tokens["S.c"];
  }
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


await t("the cards no T10 slice touched render byte for byte as before: an E4 raised card open and answered with its whisper, an E9 standing card and an E3 once-only card are pinned by their hash", async () => {
  const { createHash } = await import("node:crypto");
  const hash = (html) => createHash("sha256").update(html).digest("hex").slice(0, 16);
  const mk = (rows, activation = { kind: "toggle" }) => ({ uuid: "P.item", name: "Gear", type: "item", testUserPermission: ownedBy("gm", "pa"), flags: { "acks-extras": { itemRun: { activation, rows } } } });
  const kinds = {
    e4: mk([{ key: "t", conditions: ["held"], reach: { pulse: "turnStart+moveIn", radius: { value: "30" }, filter: {} } }]),
    e9: mk([{ key: "t", reach: { pulse: "standing", radius: { value: "20" }, modifier: { value: "-1" }, on: ["morale"], filter: {} } }]),
    e3: mk([{ key: "t", conditions: ["held"], reach: { pulse: "action", radius: { value: "30" }, filter: {} } }], { kind: "once" }),
  };
  let current = kinds.e4;
  const prior = globalThis.fromUuidSync;
  const pinTokens = { "P.bear": { id: "pbear", uuid: "P.bear", name: "Bearer", actor: {}, testUserPermission: ownedBy("gm") }, "P.a": { id: "pa1", uuid: "P.a", name: "Alpha", actor: {}, testUserPermission: ownedBy("gm", "pa") } };
  globalThis.fromUuidSync = (uuid) => (uuid === "P.item" ? current : pinTokens[uuid] ?? null);
  const card = (over) => ({ itemUuid: "P.item", rowKey: "t", activationId: "pact", kind: "toggle", cardId: "c", regionUuid: "", bearer: { uuid: "P.bear", name: "Bearer" }, selfCount: false, lowered: false, subjects: {}, undetermined: {}, counted: {}, entries: {}, ...over });
  const sub = { "P~a": { uuid: "P.a", name: "Alpha", state: "in", latest: "k1" } };
  const open = card({ subjects: sub, entries: { k1: { subject: "P.a", moment: "turnStart", momentKey: "k1", state: "open" } } });
  const done = card({ subjects: sub, entries: { k1: { subject: "P.a", moment: "turnStart", momentKey: "k1", state: "applied", saved: false, total: 4, target: 11, recordIds: ["E1"], names: ["Held"], life: "turn", presser: "gm" } } });
  messages.push({ id: "PIN1", flags: { "acks-extras": { itemRunCard: open } }, getFlag: () => open });
  try {
    me.current = users[0];
    const pins = {
      e4Open: hash(presenter.raisedBody({ id: "PIN1" }, open)),
      e4Done: hash(presenter.raisedBody({ id: "PIN1" }, done)),
      e4Whisper: hash(presenter.whisperBody({ messageId: "PIN1", entryKey: "k1", subject: "P.a", itemUuid: "P.item", rowKey: "t", activationId: "pact" })),
    };
    current = kinds.e9;
    pins.e9 = hash(presenter.raisedBody({ id: "PIN2" }, card({ subjects: { "P~a": { uuid: "P.a", name: "Alpha", state: "in", latest: "" } } })));
    current = kinds.e3;
    pins.e3 = hash(presenter.onceBody({ id: "PIN3" }, { ...card({ kind: "once" }), title: "Gear", subjects: { "P~a": { uuid: "P.a", name: "Alpha", state: "in", latest: "" } }, entries: { "P~a": { subject: "P.a", state: "open" } } }));
    pins.e3Direct = hash(presenter.onceBody({ id: "PIN3" }, { ...card({ kind: "once" }), direct: true, title: "Gear", subjects: { "P~a": { uuid: "P.a", name: "Alpha", state: "in", latest: "" } }, entries: { "P~a": { subject: "P.a", state: "applied", recordIds: ["E1"], presser: "gm" } } }));
    assert.deepEqual(pins, { e4Open: "315cb1defc703ba0", e4Done: "10f5560dd9abefdb", e4Whisper: "64fa2f13746bf948", e9: "ad4f3776a3832bff", e3: "2053bac0b727e37b", e3Direct: "416b562c1c7d51be" });
  } finally {
    messages.splice(messages.findIndex((m) => m.id === "PIN1"), 1);
    globalThis.fromUuidSync = prior;
  }
});


/* --- T10: the engaged card (board 5b) --- */
const withParams = async (fn) => {
  const prior = game.i18n.format;
  game.i18n.format = (key, data) => (data && Object.keys(data).length ? `${key}${JSON.stringify(data)}` : key);
  try {
    return await fn();
  } finally {
    game.i18n.format = prior;
  }
};
const engagedMessages = () => messages.filter((m) => m.flags["acks-extras"]?.itemRunCard?.kind === "engaged");
const engagedCard = (message) => message.flags["acks-extras"].itemRunCard;
const t10 = {};

await t("T10: a prompt of an always-on engaged reach posts one card per subject per moment, one row per item kind with every same-kind bearer named on it, and whispers 4c's save card titled for the trait to the subject's owners", async () => {
  const reach = await import("../scripts/lib/aura-reach.mjs");
  const run2 = await import("../scripts/lib/item-run.mjs");
  const hooked = {};
  const priorOn = globalThis.Hooks.on;
  globalThis.Hooks.on = (name, fn) => { hooked[name] = fn; };
  presenter.installItemRunPresenter();
  globalThis.Hooks.on = priorOn;
  t10.hooked = hooked;
  run2.installItemRun();
  users.push({ id: "pe" }, { id: "pn" }, { id: "pbb" }, { id: "pall" });
  game.combat = { id: "c1", started: true, round: 2, turn: 1, combatants: { find: () => null } };
  const created = [];
  const actorOf = (saves) => ({ type: "monster", system: { saves }, effects: [], createEmbeddedDocuments: async (...args) => { created.push(args); return []; } });
  Object.assign(t10, {
    reach, run: run2, created, actorOf,
    tokens: {
      "E.s": { id: "es", uuid: "E.s", name: "Subject One", actor: actorOf({ paralysis: { value: 12 } }), testUserPermission: ownedBy("gm", "pe", "pall") },
      "E.s2": { id: "es2", uuid: "E.s2", name: "Subject Two", actor: actorOf({ paralysis: { value: 12 } }), testUserPermission: ownedBy("gm", "pn") },
      "E.b1": { id: "eb1", uuid: "E.b1", name: "Champion 1", actor: {}, testUserPermission: ownedBy("pbb", "pe", "pall") },
      "E.b2": { id: "eb2", uuid: "E.b2", name: "Champion 2", actor: {}, testUserPermission: ownedBy("pbb", "pall") },
    },
  });
  const itemOf = (uuid, name, kind) => ({ uuid, name, type: "item", testUserPermission: ownedBy("pbb"), flags: { "acks-extras": { cookbook: { id: kind, cite: "MM p. 57" }, itemRun: { rows: [{ key: "engaged", target: "paralysis", conditions: ["held"], reach: { engaged: true, pulse: "turnStart+enter", filter: {}, lasts: { value: "3" }, immunity: { value: "2" } } }] } } } });
  const nameless = itemOf("I.t12", "Third", "kindV");
  delete nameless.flags["acks-extras"].itemRun.rows[0].target;
  t10.items = { "I.t10": itemOf("I.t10", "T10", "kindT"), "I.t11": itemOf("I.t11", "Other", "kindU"), "I.t12": nameless };
  t10.prior = globalThis.fromUuidSync;
  globalThis.fromUuidSync = (uuid) => t10.items[uuid] ?? t10.tokens[uuid] ?? t10.prior(uuid);
  t10.prompt = (over = {}) => {
    const item = over.item ?? t10.items["I.t10"];
    const token = over.token ?? t10.tokens["E.s"];
    const turn = game.combat.turn;
    return { ok: true, kind: "reach", act: "prompt", moment: "turnStart", config: { activationId: "engaged:r1" }, rowKey: "engaged", item, subject: { token, actor: token.actor }, momentKey: `c1:2:${turn}:${token.uuid}:${item.flags["acks-extras"].cookbook.id}`, engagedBy: ["E.b1", "E.b2"], ...over };
  };
  const key = "c1:2:1:E.s:kindT";
  reach.holdReachMoment(key, "c1:2:1");
  await withParams(() => presenter.presentReach(t10.prompt()));
  assert.equal(engagedMessages().length, 1, "one card for the subject's moment");
  const [message] = engagedMessages();
  const card = engagedCard(message);
  assert.equal(card.kind, "engaged");
  assert.deepEqual(Object.keys(card.entries), ["c1:2:1:E~s:kindT"], "the entry is keyed by its moment key, free of dots");
  const entry = card.entries["c1:2:1:E~s:kindT"];
  assert.deepEqual([entry.state, entry.itemUuid, entry.rowKey, entry.activationId, entry.kindKey], ["open", "I.t10", "engaged", "engaged:r1", "kindT"], "each entry names its own item, row and the Region's activation");
  assert.deepEqual(entry.bearers.map((b) => b.name), ["Champion 1", "Champion 2"], "several bearers of one kind are one row");
  assert.equal(card.activationId, "", "the card names no activation of its own, so a lifted Region never finds it");
  assert.equal(message.whisper, undefined, "the card is posted as 4b's is, to the chat; each seat's body shows what it may press");
  const whisperNow = whispers().at(-1);
  assert.deepEqual([...whisperNow.whisper], ["gm", "pe", "pall"], "the save card goes to the owners of the subject's token, as 4b's does");
  assert.ok(whisperNow.content.includes("itemRun.card.engagedTitle") && !whisperNow.content.includes("itemRun.card.whisperTitle"), "titled for the trait");
  assert.equal(whisperNow.flags["acks-extras"].itemRunWhisper.engaged, true);
  assert.ok(whisperNow.content.includes("itemRun.card.life.timed"), "a row that names its own interval tells the subject its failure is timed, not until its next turn");
  assert.equal(whisperNow.flags["acks-extras"].itemRunWhisper.messageId, message.id);
  assert.equal(card.entries["c1:2:1:E~s:kindT"].whisperId, whisperNow.id, "the card keeps the whisper's id");
  // A second kind asked at the same moment is a second row of the same card.
  await presenter.presentReach(t10.prompt({ item: t10.items["I.t11"], engagedBy: ["E.b2"] }));
  assert.equal(engagedMessages().length, 1, "still one card");
  assert.deepEqual(Object.keys(engagedCard(message).entries), ["c1:2:1:E~s:kindT", "c1:2:1:E~s:kindU"], "one row per kind key");
  assert.equal(whispers().at(-1).flags["acks-extras"].itemRunWhisper.itemUuid, "I.t11", "and its own whisper");
  // Another subject, and the same subject at another moment, each get a card of their own.
  reach.holdReachMoment("c1:2:1:E.s2:kindT", "c1:2:1");
  await presenter.presentReach(t10.prompt({ token: t10.tokens["E.s2"] }));
  assert.equal(engagedMessages().length, 2, "another subject, another card");
  game.combat.turn = 2;
  reach.holdReachMoment("c1:2:2:E.s2:kindT", "c1:2:2");
  await presenter.presentReach(t10.prompt({ token: t10.tokens["E.s2"] }));
  assert.equal(engagedMessages().length, 3, "the same subject at its next moment, another card");
  assert.deepEqual(Object.keys(engagedCard(engagedMessages()[1]).entries), [], "the earlier card's open row of the same kind is struck");
  assert.equal(reach.holdReachMoment("c1:2:1:E.s2:kindT", "c1:2:2"), true, "and its held key is released");
  reach.releaseReachMoment("c1:2:1:E.s2:kindT");
  reach.releaseReachMoment("c1:2:2:E.s2:kindT");
  game.combat.turn = 1;
  // Acts that draw nothing: a skip, an undetermined body and a listing post no card and are not parked for a raised card.
  const before = messages.length;
  for (const act of ["skip", "undetermined", "list", "out"]) await presenter.presentReach(t10.prompt({ act, token: t10.tokens["E.s2"] }));
  assert.equal(messages.length, before, "nothing is drawn for an act that is no prompt");
  assert.equal(presenter.messageIdFor("engaged:r1"), null, "no raised card is found by the Region's activation");
  assert.equal(presenter.lifeWord("timed"), "ACKS-LIB.itemRun.card.life.timed", "a timed row's failed save has a word of its own");
  assert.deepEqual(["turn", "mark", "raised", "nonsense"].map(presenter.lifeWord), ["ACKS-LIB.itemRun.card.life.turn", "ACKS-LIB.itemRun.card.life.mark", "ACKS-LIB.itemRun.card.life.raised", "ACKS-LIB.itemRun.card.life.raised"], "and the others are as they were");
});

await t("T10: each seat's body shows the row to the subject's owners and to a seat that owns every bearer, the Save to the subject's owners alone, and the read line and Not engaged to a seat that owns every bearer on the row, by Foundry's ownership and never by role", async () => {
  const [message] = engagedMessages();
  const card = engagedCard(message);
  const body = (id) => {
    me.current = users.find((u) => u.id === id);
    return presenter.engagedBody(message, card);
  };
  const shape = (html) => [html.includes("Champion 1, Champion 2"), html.includes('data-action="itemRun.roll"'), html.includes('data-action="itemRun.notEngaged"'), html.includes("itemRun.card.engagedRead")];
  assert.deepEqual(shape(body("gm")), [true, true, false, false], "the Judge owns the subject and not the bearers here: a Save, and neither the read line nor Not engaged, whatever the role");
  assert.deepEqual(shape(body("pe")), [true, true, false, false], "a seat owning the subject and one of two bearers sees neither");
  assert.deepEqual(shape(body("pall")), [true, true, true, true], "a seat owning the subject and every bearer sees all of it");
  assert.deepEqual(shape(body("pbb")), [true, false, true, true], "the bearers' owners see the row, Not engaged and the line, and no Save");
  assert.equal(body("pn").includes("Champion 1"), false, "a seat that owns neither sees no row of this subject's");
  assert.equal(body("pa").includes('data-action'), false, "and no press");
  const shell = { body: { innerHTML: "", querySelectorAll: () => [] } };
  me.current = users.find((u) => u.id === "pall");
  t10.hooked.renderChatMessageHTML(message, { nodeType: 1, querySelector: () => shell.body });
  assert.ok(shell.body.innerHTML.includes("Champion 1, Champion 2") && shell.body.innerHTML.includes("itemRun.card.engagedBy</th>"), "the render hook draws an engaged card with the engaged body, not the raised card's");
  const html = body("pall");
  assert.ok(html.includes("itemRun.card.engagedBy</th>") && html.includes("itemRun.card.save</th>"), "the columns read Engaged by and Save");
  assert.ok(html.includes('itemRun.card.engagedByTip (MM p. 57)"'), "Engaged by's tooltip is computed and cites the item's page");
  assert.ok(html.includes('itemRun.card.notEngagedAria"'), "Not engaged is named for assistive technology");
  assert.ok(html.includes('itemRun.card.notEngagedTip"'), "and carries its tooltip");
  assert.ok(html.includes('itemRun.card.engagedNoteTip"') && html.includes("itemRun.card.engagedNote"), "the note says what engaged is, with the pages in its tooltip");
  assert.ok(!html.includes("itemRun.card.lower") && !html.includes("itemRun.card.check") && !html.includes("itemRun.card.colDistance"), "no Lower, no Check range again, no distance column");
  const { saveSpec } = await import("../scripts/lib/saves.mjs");
  const target = saveSpec(t10.tokens["E.s"].actor, "paralysis").target;
  assert.ok(html.includes(`>${target}+</td>`), "the Save column holds the subject's own target");
  assert.match(html, /data-tooltip-text="[^"]*\(MM p\. 57\)"[^>]*>\d+\+/, "its tooltip cites the page that prints the row");
  assert.equal(shape(body("pall"))[3], true);
  me.current = users[0];
});

await t("T10: a blank save leaves the Save target blank with the page reference alone in its tooltip, and its press is refused for every seat", async () => {
  const { actorOf } = t10;
  t10.tokens["E.blank"] = { id: "eblank", uuid: "E.blank", name: "Blank", actor: actorOf({}), testUserPermission: ownedBy("gm", "pall") };
  game.combat.turn = 4;
  await presenter.presentReach(t10.prompt({ token: t10.tokens["E.blank"], momentKey: "c1:2:4:E.blank:kindT" }));
  const blankMessage = engagedMessages().at(-1);
  me.current = users.find((u) => u.id === "pall");
  const html = presenter.engagedBody(blankMessage, engagedCard(blankMessage));
  assert.ok(html.includes('data-tooltip-text="MM p. 57">\u00a0</td>'), "a blank cell whose tooltip is the page alone, with no words saying it is missing");
  assert.ok(!html.includes('data-tooltip-text="paralysis'), "no figure stands in for it");
  const row = Object.values(engagedCard(blankMessage).entries)[0];
  const key = Object.keys(engagedCard(blankMessage).entries)[0];
  const priorRoll = globalThis.Roll;
  globalThis.Roll = class { async evaluate() { return { total: 1 }; } };
  for (const [seat, isGM] of [["Judge", true], ["Player", false]]) {
    me.current = isGM ? users[0] : users.find((u) => u.id === "pall");
    const out = await t10.run.pressRoll({ itemUuid: row.itemUuid, rowKey: row.rowKey, activationId: row.activationId, subject: row.subject, messageId: blankMessage.id, entryKey: key });
    assert.deepEqual(out, { ok: false, reason: "noFigure" }, `refused for the ${seat}'s seat`);
  }
  // A save kind that was never imported leaves the row with no save name at all: the same blank cell and the same refusal.
  game.combat.turn = 5;
  await presenter.presentReach(t10.prompt({ item: t10.items["I.t12"], token: t10.tokens["E.s2"], momentKey: "c1:2:5:E.s2:kindV" }));
  const bareMessage = engagedMessages().at(-1);
  me.current = users.find((u) => u.id === "gm");
  const bareHtml = presenter.engagedBody(bareMessage, engagedCard(bareMessage));
  assert.ok(bareHtml.includes('data-tooltip-text="MM p. 57">\u00a0</td>'), "no save name: a blank cell with the page alone");
  const bareKey = Object.keys(engagedCard(bareMessage).entries)[0];
  assert.deepEqual(await t10.run.pressRoll({ itemUuid: "I.t12", rowKey: "engaged", activationId: "engaged:r1", subject: "E.s2", messageId: bareMessage.id, entryKey: bareKey }), { ok: false, reason: "noFigure" }, "and the Judge's press is refused");
  t10.reach.releaseReachMoment("c1:2:5:E.s2:kindV");
  game.combat.turn = 4;
  globalThis.Roll = priorRoll;
  me.current = users[0];
  game.combat.turn = 1;
  t10.reach.releaseReachMoment("c1:2:4:E.blank:kindT");
});

await t("T10: Not engaged closes a row for a seat that owns every bearer: the row keeps its bearers and says who closed it, no save and no record is written, the moment key is released and the whisper is answered; any other seat is refused, a Judge included; Undo reopens it", async () => {
  const [message] = engagedMessages();
  const key = "c1:2:1:E~s:kindT";
  const card = () => engagedCard(message);
  const whisperOf = () => messages.find((m) => m.id === card().entries[key].whisperId);
  t10.reach.holdReachMoment("c1:2:1:E.s:kindT", "c1:2:1");
  const press = (userId) => t10.run.notEngagedHere({ messageId: message.id, entryKey: key, requestUserId: userId });
  const writes = t10.created.length;
  assert.deepEqual(await press("pe"), { ok: false, reason: "notBearer" }, "one of two bearers is refused by the handler");
  assert.deepEqual(await press("pa"), { ok: false, reason: "notBearer" }, "a seat that owns no bearer");
  me.current = users[0];
  assert.deepEqual(await press(null), { ok: false, reason: "notBearer" }, "the Judge's own seat, which owns the subject and no bearer here: no role is read");
  assert.equal(card().entries[key].state, "open", "refused presses change nothing");
  assert.equal(t10.reach.holdReachMoment("c1:2:1:E.s:kindT", "c1:2:1"), false, "and release no key");
  assert.deepEqual(await t10.run.notEngagedHere({ messageId: message.id, entryKey: "gone", requestUserId: "pall" }), { ok: false, reason: "struck" }, "a row the card no longer holds");
  assert.deepEqual(await press("pall"), { ok: true }, "a seat owning every bearer closes it");
  const closed = card().entries[key];
  assert.deepEqual([closed.state, closed.closedBy.id, closed.presser], ["closed", "pall", "pall"], "closed, by whom, and the closer may Undo it");
  assert.deepEqual(closed.bearers.map((b) => b.name), ["Champion 1", "Champion 2"], "the row keeps its bearers");
  assert.equal(t10.created.length, writes, "no condition, no immunity window and no record is written");
  assert.equal(t10.reach.holdReachMoment("c1:2:1:E.s:kindT", "c1:2:2"), true, "the moment key is released");
  t10.reach.releaseReachMoment("c1:2:1:E.s:kindT");
  assert.equal(whisperOf().flags["acks-extras"].itemRunWhisper.answered, "closed", "the whispered card is answered");
  assert.deepEqual(await press("pall"), { ok: false, reason: "applied" }, "a second press is refused");
  me.current = users.find((u) => u.id === "pall");
  const closedBody = presenter.engagedBody(message, card());
  assert.ok(closedBody.includes("Champion 1, Champion 2") && closedBody.includes("itemRun.card.closedBy") && closedBody.includes('class="is-muted"'), "the row keeps its names, reads Not engaged and who closed it, in the muted look");
  const closedRow = closedBody.split("<tr").find((r) => r.includes("itemRun.card.closedBy"));
  assert.ok(!closedRow.includes('data-action="itemRun.roll"') && !closedRow.includes('data-action="itemRun.notEngaged"') && closedRow.includes('data-action="itemRun.undo"'), "no Save and no Not engaged on a closed row, and 4b's Undo to reopen it");
  me.current = users[0];
  const whisperHtml = await withParams(() => presenter.whisperBody(whisperOf().flags["acks-extras"].itemRunWhisper));
  assert.ok(whisperHtml.includes("itemRun.card.engagedTitle") && !whisperHtml.includes("itemRun.card.whisperTitle") && whisperHtml.includes("itemRun.card.life.timed"), "the whispered card keeps its title and its timed interval when it is drawn again");
  assert.ok(!whisperHtml.includes("itemRun.card.rollSave") && whisperHtml.includes("itemRun.card.closedBy"), "the whispered card offers no roll once the row is closed");
  const undone = await t10.run.undoCardEntry({ messageId: message.id, entryKey: key });
  assert.deepEqual([undone.ok, card().entries[key].state, card().entries[key].closedBy], [true, "open", undefined], "Undo reopens it");
  assert.equal(t10.reach.holdReachMoment("c1:2:1:E.s:kindT", "c1:2:1"), false, "its moment key is held again");
  t10.reach.releaseReachMoment("c1:2:1:E.s:kindT");
  me.current = users.find((u) => u.id === "pall");
  const reopened = presenter.engagedBody(message, card());
  const reopenedRow = reopened.split("<tr").find((r) => r.includes("Champion 1, Champion 2"));
  assert.ok(reopenedRow.includes('data-action="itemRun.roll"') && reopenedRow.includes('data-action="itemRun.notEngaged"'), "the reopened row has its Save and its Not engaged again");
  me.current = users[0];
  assert.equal(presenter.whisperBody(whisperOf().flags["acks-extras"].itemRunWhisper).includes("itemRun.card.rollSave"), true, "and its whisper offers the roll");
});

await t("T10: the failed save's well names the condition and the timed interval, a pass reads its immunity with its tooltip, and a pass with none imported cites the page alone", async () => {
  const [message] = engagedMessages();
  const key = "c1:2:1:E~s:kindT";
  const keep = engagedCard(message).entries[key];
  me.current = users.find((u) => u.id === "pall");
  const set = async (patch) => message.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`flags.acks-extras.itemRunCard.entries.${key}.${k}`, v])));
  await set({ state: "applied", saved: false, total: 4, target: 12, recordIds: ["E1"], names: ["Held Name"], life: "timed", presser: "pall" });
  let html = presenter.engagedBody(message, engagedCard(message));
  assert.ok(html.includes("itemRun.card.failed") && html.includes("itemRun.card.well: Subject One: Held Name, ACKS-LIB.itemRun.card.life.timed"), "a failure reads Failed and the well says what it wrote and that it is timed");
  assert.ok(html.includes('data-action="itemRun.undo"'), "with 4b's Undo");
  await set({ saved: true, total: 15, recordIds: [], names: [], life: "raised", immune: 2 });
  html = presenter.engagedBody(message, engagedCard(message));
  assert.ok(html.includes("itemRun.card.engagedHolds") && html.includes('itemRun.card.engagedHoldsTip (MM p. 57)"'), "a pass reads Saved with its immunity and where that figure came from");
  assert.ok(!html.includes('data-action="itemRun.undo"'), "a pass that wrote no record has nothing to undo");
  await set({ immune: unset() });
  html = presenter.engagedBody(message, engagedCard(message));
  assert.ok(html.includes("itemRun.card.saved") && html.includes('data-tooltip-text="MM p. 57"'), "a pass with no window imported says Saved and cites the page alone");
  await message.update({ [`flags.acks-extras.itemRunCard.entries.${key}`]: keep });
  me.current = users[0];
  globalThis.fromUuidSync = t10.prior;
  game.combat = null;
});

console.log(`\ntest-item-run-presenter: ${passed} checks passed.`);
