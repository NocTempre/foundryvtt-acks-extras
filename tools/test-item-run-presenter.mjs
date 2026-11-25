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
    await card.update({ "flags.acks-extras.itemRunCard.counted.-=S~a": null });
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
    await message.update({ "flags.acks-extras.itemRunCard.counted.-=S~c": null });
    // An uncounted body held undetermined is dropped at its exit, and listed again at its entry.
    reachRow.filter = { kinds: ["zzz"] };
    await message.update({ "flags.acks-extras.itemRunCard.subjects.-=S~d": null, "flags.acks-extras.itemRunCard.subjects.-=S~c": null });
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

console.log(`\ntest-item-run-presenter: ${passed} checks passed.`);
