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
  await messages[0].update({ "flags.acks-extras.itemRunCard.entries.ks1.state": "applied", "flags.acks-extras.itemRunCard.entries.ks1.saved": false });
  const failedRows = reachStripFor(actorA).rows;
  await messages[0].update({ "flags.acks-extras.itemRunCard.entries.ks1.state": "open", "flags.acks-extras.itemRunCard.entries.ks1.saved": unset() });
  // The rows a non-engaged reach reads are pinned whole: a raised card's open prompt, a standing part, and the failure a raised card's applied entry reads, each with its tooltip key.
  assert.deepEqual(owed.rows, [{"key":"act:t","name":"Gear","tag":"owed","source":"Bearer","feet":10,"feetTip":"ACKS-LIB.itemRun.card.tip.distance","radius":30,"radiusTip":"","cite":"","target":null,"targetTip":"","left":null,"leftTip":"","part":null,"press":{"itemUuid":"I.1","rowKey":"t","activationId":"act","subject":"S.a","messageId":"M1","entryKey":"ks1"},"tagLabel":"ACKS-LIB.itemRun.strip.tag.owed","tagVariant":"danger","tagTip":"ACKS-LIB.itemRun.strip.tagTip.owed","leftLabel":"","hasFeet":true,"hasRadius":true,"hasTarget":false},{"key":"act2:s","name":"Aura","tag":"always","source":"Bearer","feet":10,"feetTip":"ACKS-LIB.itemRun.card.tip.distance","radius":20,"radiusTip":"","cite":"","target":null,"targetTip":"","left":null,"leftTip":"","part":{"value":"−1","rolls":"ACKS-LIB.itemRun.strip.on.morale","tip":"Aura · ACKS-LIB.itemRun.strip.tip.from · ACKS-LIB.itemRun.strip.tip.away · ACKS-LIB.itemRun.strip.tip.reach · ACKS-LIB.itemRun.strip.on.morale −1"},"press":null,"tagLabel":"ACKS-LIB.itemRun.strip.tag.always","tagVariant":"ghost","tagTip":"ACKS-LIB.itemRun.strip.tagTip.always","leftLabel":"","hasFeet":true,"hasRadius":true,"hasTarget":false}], "a raised reach's open prompt and a standing part read exactly as they did before the engaged states");
  assert.deepEqual(failedRows[0], {"key":"act:t","name":"Gear","tag":"failed","source":"Bearer","feet":10,"feetTip":"ACKS-LIB.itemRun.card.tip.distance","radius":30,"radiusTip":"","cite":"","target":null,"targetTip":"","left":null,"leftTip":"","part":null,"press":null,"tagLabel":"ACKS-LIB.itemRun.strip.tag.failed","tagVariant":"danger","tagTip":"ACKS-LIB.itemRun.strip.tagTip.failed","leftLabel":"","hasFeet":true,"hasRadius":true,"hasTarget":false}, "a failed raised-card entry reads the plain Failed tooltip and no turns");
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

await t("T10: the strip reads an engaged reach from the engaged card and the subject's records: owed with a press on the card's entry for the subject token's owners alone, Failed from the lasts record with its turns left, Immune, and Waiting with neither; one row per kind, and a card change re-renders the subject's open sheets", async () => {
  const { reachStripFor, pressStripSave, installItemRunStrip } = await import("../scripts/lib/item-run-strip.mjs");
  const { lastsRecordId, immunityRecordData, immuneRecordId } = await import("../scripts/lib/item-run-logic.mjs");
  globalThis.CONST = { TOKEN_DISPLAY_MODES: { NONE: 0, OWNER_HOVER: 20, OWNER: 40, ALWAYS: 50 } };
  globalThis.fromUuidSync = (uuid) => t10.items[uuid] ?? t10.tokens[uuid] ?? t10.prior(uuid);
  const cell = (v) => Math.floor(v / 100);
  const regionOf = (bearerId, activationId) => ({ hidden: false, attachment: { token: bearerId }, behaviors: [{ type: "acks-extras.aura", disabled: false, system: { sourceUuid: "I.t10", bearerUuid: "A.b", activationId, rowKey: "engaged" } }] });
  const r1 = regionOf("eb1", "engaged:r1");
  const r2 = regionOf("eb2", "engaged:r2");
  r2.behaviors[0].system.sourceUuid = "I.t10b";
  const other = structuredClone(t10.items["I.t10"].flags);
  other["acks-extras"].itemRun.rows[0].target = "death";
  t10.items["I.t10b"] = { ...t10.items["I.t10"], uuid: "I.t10b", flags: other };
  const scene = { id: "sc-t10", grid: { units: "ft", size: 100, measurePath: ([p, q]) => ({ distance: Math.max(Math.abs(cell(p.x) - cell(q.x)), Math.abs(cell(p.y) - cell(q.y))) * 5 }) }, regions: [r1, r2], tokens: { get: (id) => Object.values(t10.tokens).find((tk) => tk.id === id) } };
  r1.parent = scene;
  r2.parent = scene;
  const subject = t10.tokens["E.s"];
  for (const [key, x] of Object.entries({ "E.b1": 100, "E.b2": 300, "E.s": 0 })) Object.assign(t10.tokens[key], { parent: scene, x, y: 0, width: 1, height: 1, displayName: 50 });
  subject.regions = new Set([r1, r2]);
  subject.actor.system.saves.death = { value: 9 };
  const effects = [];
  effects.get = (id) => effects.find((e) => e.id === id);
  Object.assign(subject.actor, { testUserPermission: ownedBy("gm", "pe", "pn"), getActiveTokens: () => [subject], effects });
  const [message] = engagedMessages();
  const key = "c1:2:1:E~s:kindT";
  const setEntry = (patch) => message.update(Object.fromEntries(Object.entries(patch).map(([k, v]) => [`flags.acks-extras.itemRunCard.entries.${key}.${k}`, v])));
  const rowsFor = (userId) => {
    me.current = users.find((u) => u.id === userId);
    return reachStripFor(subject.actor)?.rows ?? [];
  };

  // Owed: an open entry of this subject and kind. The press names that entry on that card.
  await setEntry({ state: "open", saved: unset(), immune: unset() });
  assert.equal(engagedCard(message).entries[key].state, "open");
  let rows = rowsFor("pe");
  assert.equal(rows.length, 1, "two bearers of one kind are one row");
  assert.deepEqual([rows[0].tag, rows[0].name, rows[0].source, rows[0].feet], ["owed", "T10", "Champion 1", 0], "the row is the nearest bearer's");
  assert.deepEqual(rows[0].press, { itemUuid: "I.t10", rowKey: "engaged", activationId: "engaged:r1", subject: "E.s", messageId: message.id, entryKey: key }, "the Save names the engaged card's entry, which the carrier's press reads the item, row and activation from");
  assert.equal(rows[0].tagTip, "ACKS-LIB.itemRun.strip.tagTip.owed");
  // The entry was asked of another bearer's item of the same kind: the press names the entry's item, row and activation, the only ones the carrier accepts on that card.
  await setEntry({ itemUuid: "I.t10b", activationId: "engaged:r2" });
  assert.equal(rowsFor("pe")[0].target, 9, "and the save it shows is the entry's item's, read off the body");
  assert.deepEqual(rowsFor("pe")[0].press, { itemUuid: "I.t10b", rowKey: "engaged", activationId: "engaged:r2", subject: "E.s", messageId: message.id, entryKey: key }, "the press carries the entry's own ids, not the nearest bearer's");
  await setEntry({ itemUuid: "I.t10", activationId: "engaged:r1" });
  const ownsToken = subject.testUserPermission;
  subject.testUserPermission = ownedBy("gm");
  assert.equal(rowsFor("pe")[0].press, null, "a seat that owns the body and not its token has the row and no press");
  const warned = [];
  const warn = ui.notifications.warn;
  ui.notifications.warn = (m) => warned.push(m);
  await pressStripSave({ dataset: { subject: "E.s", itemUuid: "I.t10", rowKey: "engaged", activationId: "engaged:r1", messageId: message.id, entryKey: key } });
  ui.notifications.warn = warn;
  assert.deepEqual(warned, ["ACKS-LIB.itemRun.refused.notOwner"], "the strip's press is refused for a seat that does not own the token");
  subject.testUserPermission = ownsToken;
  assert.ok(rowsFor("pe")[0].press, "the token's owner has it");

  // Failed: the entry is answered and the lasts record stands on the body.
  await setEntry({ state: "applied", saved: false });
  assert.equal(rowsFor("pe")[0].tag, "waiting", "an answered entry with no record reads nothing but waiting");
  effects.push({ id: lastsRecordId("kindT"), disabled: false, flags: { "acks-extras": { itemRun: { dueAt: 1800 } } } });
  rows = rowsFor("pe");
  assert.deepEqual([rows[0].tag, rows[0].left, rows[0].press], ["failed", 3, null], "the lasts record reads Failed with its turns left from its dueAt, and no press");
  assert.equal(rows[0].leftTip, "T10 · ACKS-LIB.itemRun.strip.tip.window · MM p. 57", "the window's tooltip names the item, the window and the page");
  assert.equal(rows[0].tagTip, "ACKS-LIB.itemRun.strip.tagTip.failedTimed", "and says how a timed failure ends");
  effects[0].flags["acks-extras"].itemRun = {};
  assert.deepEqual([rowsFor("pe")[0].tag, rowsFor("pe")[0].left, rowsFor("pe")[0].leftLabel, rowsFor("pe")[0].tagTip], ["failed", null, "", "ACKS-LIB.itemRun.strip.tagTip.failedTimed"], "a record with no clock reads Failed with no turns, under the same tooltip");
  await setEntry({ state: "open", saved: unset() });
  assert.equal(rowsFor("pe")[0].tag, "owed", "a save asked again while the last failure stands is owed first");
  await setEntry({ state: "applied", saved: false });
  effects[0].id = lastsRecordId("kindU");
  assert.equal(rowsFor("pe")[0].tag, "waiting", "another kind's record is not read");
  effects.length = 0;

  // Immune: the window's own parts shape, as the pass writes it.
  const written = immunityRecordData({ name: "T10", spellKey: "kindT", source: "I.t10", activationId: "card", rowKey: "engaged", dueAt: 1200, cite: "MM p. 57", id: immuneRecordId("kindT"), cardId: "card", entryKey: key });
  effects.push({ id: written._id, disabled: false, flags: written.flags });
  rows = rowsFor("pe");
  assert.deepEqual([rows[0].tag, rows[0].left, rows[0].press], ["immune", 2, null], "a window written by the pass reads Immune with its turns left");
  effects.length = 0;

  // Waiting: no open entry and no record. A closed or undone entry is not owed.
  rows = rowsFor("pe");
  assert.deepEqual([rows[0].tag, rows[0].press ?? null, rows[0].left], ["waiting", null, null], "no entry and no record reads Waiting");
  for (const state of ["closed", "undone"]) {
    await setEntry({ state });
    assert.equal(rowsFor("pe")[0].tag, "waiting", `a ${state} entry is not owed`);
  }
  await setEntry({ state: "open", saved: unset() });
  assert.equal(rowsFor("pe")[0].tag, "owed", "reopened, it is owed again");
  assert.equal(rowsFor("pn")[0].press, null, "a seat that owns the actor and not the token has the row and no press");

  // "and n more": one row per engaged kind, naming the nearest bearer, counting the other bearers the seat is shown.
  const { reachRowsOn, reachLineOf } = await import("../scripts/lib/item-run-strip.mjs");
  const r3 = regionOf("eb3", "engaged:r3");
  r3.parent = scene;
  t10.tokens["E.b3"] = { id: "eb3", uuid: "E.b3", name: "Champion 3", actor: {}, testUserPermission: ownedBy("pall"), parent: scene, x: 500, y: 0, width: 1, height: 1, displayName: 50 };
  const r1b = regionOf("eb1", "engaged:r1b");
  r1b.parent = scene;
  scene.regions.push(r3, r1b);
  const standIn = (...regions) => { subject.regions = new Set(regions); return rowsFor("pe"); };
  rows = standIn(r1);
  assert.deepEqual([rows.length, rows[0].more, rows[0].moreLabel], [1, undefined, undefined], "one bearer reads no more line");
  rows = standIn(r1, r2);
  assert.deepEqual([rows.length, rows[0].source, rows[0].more, rows[0].moreLabel, rows[0].moreTip], [1, "Champion 1", 1, "ACKS-LIB.itemRun.strip.more", "Champion 2"], "two bearers of a kind are one row, the nearest named and one more, the other named in the tooltip");
  rows = standIn(r1, r2, r3);
  assert.deepEqual([rows.length, rows[0].source, rows[0].more, rows[0].moreTip], [1, "Champion 1", 2, "Champion 2, Champion 3"], "three bearers are one row and two more, nearest first");
  rows = standIn(r3, r2, r1);
  assert.deepEqual([rows[0].source, rows[0].more, rows[0].moreTip], ["Champion 1", 2, "Champion 2, Champion 3"], "the order the Regions are met in changes neither the nearest nor the count");
  rows = standIn(r1, r1b);
  assert.deepEqual([rows.length, rows[0].more], [1, undefined], "one bearer holding two Regions of the kind is not more than one");
  subject.regions = new Set([r1, r2, r3]);
  const seen = (...hidden) => reachRowsOn(subject, subject.actor, (found) => found.filter((p) => !hidden.includes(p.region)));
  assert.equal(seen(r3)[0].more, 1, "a bearer the seat is not shown is not counted");
  assert.equal(seen(r2, r3)[0].more, undefined, "with every other bearer out of sight there is no more line");
  assert.deepEqual([seen(r1)[0].source, seen(r1)[0].more], ["Champion 2", 1], "and the nearest bearer is the nearest of those shown");
  assert.match(reachLineOf(seen()[0]), /ACKS-LIB\.itemRun\.strip\.more/, "the canvas readout's line carries the count");
  assert.doesNotMatch(reachLineOf(seen(r2, r3)[0]), /strip\.more/, "and not where there is none");
  delete t10.tokens["E.b3"];
  scene.regions.length = 2;
  subject.regions = new Set([r1, r2]);

  // The refresh hook: an engaged card names a subject, not a list of subjects.
  const hooked = {};
  const priorOn = globalThis.Hooks.on;
  globalThis.Hooks.on = (name, fn) => { hooked[name] = fn; };
  installItemRunStrip();
  globalThis.Hooks.on = priorOn;
  let renders = 0;
  const sheet = { rendered: true, document: Object.assign(subject.actor, { documentName: "Actor", isToken: false }), render() { renders += 1; } };
  globalThis.foundry.applications = { instances: new Map([["w", sheet]]) };
  hooked.updateChatMessage(message);
  assert.equal(renders, 1, "an engaged card's change re-renders the open sheet of its subject");
  hooked.updateChatMessage(engagedMessages().find((m) => engagedCard(m).subject.uuid === "E.s2"));
  assert.equal(renders, 1, "and not another subject's");
  hooked.updateChatMessage({ flags: { "acks-extras": { itemRunCard: { subjects: { a: { uuid: "E.s" } } } } } });
  assert.equal(renders, 2, "a raised card still names the subjects it lists");
  delete globalThis.foundry.applications;
  subject.regions = new Set();
  me.current = users[0];
  globalThis.fromUuidSync = t10.prior;
});

/* -------------------------------------------- */
/*  The fuse card and the burst card             */
/* -------------------------------------------- */

const gear = { prior: globalThis.fromUuidSync, bearerOwners: tokens["S.bear"].testUserPermission };
const vehicle = { uuid: "V.1", id: "v1", name: "Cart", actor: { testUserPermission: ownedBy("gm", "pa") }, testUserPermission: ownedBy("gm", "pa") };
globalThis.fromUuidSync = (uuid) => (uuid === "V.1" ? vehicle : gear.prior(uuid));
tokens["S.bear"].testUserPermission = ownedBy("gm", "pa");
const cardOfAct = (act) => messages.find((m) => m.flags["acks-extras"]?.itemRunCard?.activationId === act);
const fuseResult = (act, over = {}) => ({ ok: true, kind: "fuse", outcome: "lit", light: "lit", activationId: act, itemUuid: "I.1", tokenUuid: "S.bear", roll: { natural: 12, total: 12, formula: "1d20", target: 9, base: 11, modifiers: [{ label: "Craft", value: 2, cite: "" }], proficient: true, proficiency: "Craft", proficiencyRead: true }, fuse: { count: 3, combat: true, spot: { sceneId: "sc", x: 10, y: 20, elevation: 0, level: "" } }, blank: [], ...over });
const burstResult = (act, over = {}) => ({ ok: true, kind: "burst", blank: false, activationId: act, itemUuid: "I.1", itemName: "Gear", actorName: "Bearer", actorUuid: "A.bear", rowKey: "burst", rolled: 11, dice: "3d6", types: ["fire"], radius: 20, spot: { sceneId: "sc", x: 10, y: 20 }, formula: "3d6", saveName: "Death", reduction: 0.5, subjects: [{ key: "S.a", name: "Alpha" }, { key: "S.b", name: "Beta" }], vehicles: [{ uuid: "V.1", name: "Cart" }], card: {}, ...over });
const bodyFor = (kind, act, user) => {
  me.current = user;
  const message = cardOfAct(act);
  return presenter[kind](message, message.flags["acks-extras"].itemRunCard);
};

await t("a light posts one fuse card: the roll with its throw's tooltip, the steps line, and Move the spot and Set it off now for a seat that owns the bearer", async () => {
  const before = messages.length;
  await presenter.presentUse(fuseResult("f1"));
  assert.equal(messages.length - before, 1, "one card");
  const card = cardOfAct("f1").flags["acks-extras"].itemRunCard;
  assert.deepEqual([card.kind, card.outcome, card.title, card.bearer.name, card.fuse.count, card.burned], ["fuse", "lit", "Gear", "Bearer", 3, false], "the card stores what its body draws");
  const gm = bodyFor("fuseBody", "f1", users[0]);
  assert.ok(gm.includes("ACKS-LIB.itemRun.card.throw 9+"), "the throw's tooltip names the target");
  assert.ok(gm.includes("Craft −2") && gm.includes("ACKS-LIB.itemRun.card.proficiencyHeld"), "its parts: the modifier taken off with its label, and whether the bearer has the proficiency");
  assert.ok(gm.includes("ACKS-LIB.itemRun.card.stepsCombat") && gm.includes('data-action="itemRun.moveSpot"') && gm.includes('data-action="itemRun.setOff"'));
  assert.ok(gm.includes('aria-label="ACKS-LIB.itemRun.card.moveSpotAria"') && gm.includes("data-activation-id=\"f1\""), "each press has an accessible name and names the fuse");
  const owner = bodyFor("fuseBody", "f1", users[1]);
  assert.ok(owner.includes('data-action="itemRun.moveSpot"'), "an owner of the bearer, no Judge, is offered the presses");
  const other = bodyFor("fuseBody", "f1", users[2]);
  assert.ok(!other.includes("itemRun.moveSpot") && !other.includes("itemRun.setOff") && other.includes("ACKS-LIB.itemRun.card.lit"), "a seat that does not own the bearer reads the card and presses nothing");
  me.current = users[0];
});

await t("a light that is not lit, a fumble, a blank figure and a proficiency that could not be read each read plainly and press nothing", async () => {
  await presenter.presentUse(fuseResult("f2", { outcome: "unlit", light: "unlit", fuse: null, roll: { natural: 3, total: 3, formula: "1d20", target: 9, base: 11, modifiers: [], proficient: false, proficiency: "Craft", proficiencyRead: false } }));
  const unlit = bodyFor("fuseBody", "f2", users[0]);
  assert.ok(unlit.includes("ACKS-LIB.itemRun.card.unlitLine") && unlit.includes("ACKS-LIB.itemRun.card.unlit") && !unlit.includes("itemRun.moveSpot"));
  assert.ok(unlit.includes("ACKS-LIB.itemRun.card.proficiencyUnread"), "an unread proficiency is a plain note in the throw's tooltip");
  assert.ok(unlit.includes("ACKS-LIB.itemRun.card.fuseTitleTried"), "and the title does not say lit");
  await presenter.presentUse(fuseResult("f3", { outcome: "fumble", light: "fumble", fuse: null }));
  assert.ok(bodyFor("fuseBody", "f3", users[0]).includes("ACKS-LIB.itemRun.card.fumbleLine"));
  await presenter.presentUse(fuseResult("f4", { outcome: null, light: null, roll: null, fuse: null, blank: ["throw", "fumble"] }));
  const blank = bodyFor("fuseBody", "f4", users[0]);
  assert.ok(blank.includes('data-tooltip-text="ACKS-LIB.itemRun.card.citeFuse"') && blank.includes("ACKS-LIB.itemRun.card.judgeLine") && !blank.includes("1d20") && !blank.includes("itemRun.moveSpot"), "no roll and no number: the page alone, and the Judge's line");
  assert.ok(!blank.includes("itemRun.card.notImported"), "no words saying a figure is missing");
  me.current = users[0];
});

await t("the burst fills in the fuse's own card (no second card), each seat reads the bodies it owns, and a Judge alone reads the buildings line", async () => {
  const before = messages.length;
  await presenter.presentUse(burstResult("f1"));
  assert.equal(messages.length, before, "the burst is written onto the fuse card");
  const card = cardOfAct("f1").flags["acks-extras"].itemRunCard;
  assert.deepEqual([card.kind, card.burned, card.title, card.rolled, card.saveName, card.reduction, card.types], ["burst", true, "Gear", 11, "Death", 0.5, ["fire"]]);
  assert.deepEqual([Object.keys(card.subjects), card.subjects["S~a"].uuid, card.vehicles["V~1"]], [["S~a", "S~b"], "S.a", { uuid: "V.1", name: "Cart", state: "open" }], "subjects are keyed by safeKey with their uuid, vehicles open");
  assert.ok(card.roll && card.fuse, "the light's facts stay");
  const gm = bodyFor("burstBody", "f1", users[0]);
  assert.ok(gm.includes("Alpha") && gm.includes("Beta") && gm.includes("Cart"));
  assert.equal((gm.match(/data-action="itemRun.roll"/g) ?? []).length, 2, "each open row has its Save press");
  assert.ok(gm.includes('data-entry-key="S~a"') && gm.includes(`data-message-id="${cardOfAct("f1").id}"`), "a Save press names the card and its entry");
  assert.ok(gm.includes('data-action="itemRun.handOn"') && gm.includes("ACKS-LIB.itemRun.card.buildingsLine") && gm.includes("ACKS-LIB.itemRun.card.areaLine") && gm.includes("ACKS-LIB.itemRun.card.rolledLineTypes"));
  const pa = bodyFor("burstBody", "f1", users[1]);
  assert.ok(pa.includes("Alpha") && !pa.includes("Beta") && pa.includes("Cart") && !pa.includes("buildingsLine"), "an owner reads its own rows and the vehicle it owns, and no buildings line");
  const pb = bodyFor("burstBody", "f1", users[2]);
  assert.ok(pb.includes("Beta") && !pb.includes("Alpha") && !pb.includes("Cart") && !pb.includes("itemRun.handOn"), "a seat reads only what it owns");
  me.current = users[0];
});

await t("a row's presses follow its entry: Apply once it holds a verdict, Apply all for a seat that owns one, Undo on an applied row for its presser or the subject's owner, a judge row's reason, and Hand on gives way to handed", async () => {
  const message = cardOfAct("f1");
  const entries = message.flags["acks-extras"].itemRunCard.entries;
  Object.assign(entries, { "S~a": { subject: "S.a", state: "rolled", saved: true, total: 14, target: 11 }, "S~b": { subject: "S.b", state: "judge", saved: true, total: 12, target: 11, why: "several" } });
  const gm = bodyFor("burstBody", "f1", users[0]);
  assert.ok(gm.includes('data-action="itemRun.apply"') && gm.includes('data-action="itemRun.applyAll"') && gm.includes("ACKS-LIB.itemRun.card.why.several"));
  assert.equal((gm.match(/data-action="itemRun.apply"/g) ?? []).length, 1, "a judge row offers no Apply");
  const pb = bodyFor("burstBody", "f1", users[2]);
  assert.ok(!pb.includes("itemRun.apply") && !pb.includes("itemRun.applyAll") && pb.includes("ACKS-LIB.itemRun.card.why.several"), "a seat owning only the judge row has nothing to apply");
  entries["S~a"] = { subject: "S.a", state: "applied", saved: true, total: 14, target: 11, amount: 5, hp: [{ uuid: "A.a", amount: 5 }], presser: "pb", appliedBy: "pb" };
  assert.ok(bodyFor("burstBody", "f1", users[1]).includes('data-action="itemRun.undo"'), "the subject's owner may undo it");
  assert.ok(!bodyFor("burstBody", "f1", users[1]).includes("itemRun.applyAll"), "and nothing is left to apply");
  entries["S~a"].presser = "pa";
  assert.ok(bodyFor("burstBody", "f1", users[0]).includes('data-action="itemRun.undo"'), "a Judge owns the subject too");
  entries["S~a"].state = "undone";
  assert.ok(!bodyFor("burstBody", "f1", users[0]).includes("itemRun.undo"), "an undone row offers nothing");
  message.flags["acks-extras"].itemRunCard.vehicles["V~1"].state = "handed";
  const done = bodyFor("burstBody", "f1", users[1]);
  assert.ok(!done.includes("itemRun.handOn") && done.includes("ACKS-LIB.itemRun.card.handed"), "a handed vehicle reads handed");
  me.current = users[0];
});

await t("a burst that could not happen whispers the Judges a line naming the item and bearer and posts no table, and the fuse card offers no more controls; a blank burst posts a plain card", async () => {
  await presenter.presentUse(fuseResult("f5"));
  assert.ok(bodyFor("fuseBody", "f5", users[0]).includes("itemRun.moveSpot"));
  const before = messages.length;
  await presenter.presentUse({ ok: false, kind: "burst", reason: "noScene", activationId: "f5", itemUuid: "I.1", itemName: "Gear", actorName: "Bearer", actorUuid: "A.bear" });
  const whisper = messages.at(-1);
  assert.equal(messages.length - before, 1);
  assert.deepEqual([...whisper.whisper], ["gm"], "the Judges alone");
  assert.ok(whisper.content.includes("ACKS-LIB.itemRun.card.burstFailed.noScene") && !whisper.flags["acks-extras"]?.itemRunCard);
  const after = cardOfAct("f5").flags["acks-extras"].itemRunCard;
  assert.deepEqual([after.kind, after.burned, bodyFor("fuseBody", "f5", users[0]).includes("itemRun.moveSpot")], ["fuse", true, false], "the fuse is burned and its presses are gone");
  await presenter.presentUse({ ok: false, kind: "burst", reason: "noBearer", activationId: "none", itemUuid: "I.1", itemName: "Gear", actorName: "Bearer", actorUuid: "A.bear" });
  assert.ok(messages.at(-1).content.includes("ACKS-LIB.itemRun.card.burstFailed.noBearer") && messages.at(-1).whisper.length === 1, "a bearer that cannot be found is told the same way, with no fuse card to mark");
  await presenter.presentUse(burstResult("none2", { blank: true, why: "figure", rowKey: undefined, subjects: [], vehicles: [], card: null }));
  const blank = bodyFor("burstBody", "none2", users[0]);
  assert.ok(blank.includes("ACKS-LIB.itemRun.card.blastRow") && blank.includes('data-tooltip-text="ACKS-LIB.itemRun.card.citeFuse"') && blank.includes("ACKS-LIB.itemRun.card.burstJudgeLine") && !blank.includes("<button"), "the blast's blank cell is the page alone, a Judge's line, no press");
  gear.bearerOwners && (tokens["S.bear"].testUserPermission = gear.bearerOwners);
  globalThis.fromUuidSync = gear.prior;
  me.current = users[0];
});
/* -------------------------------------------- */
/*  The swig and the on-hit save                 */
/* -------------------------------------------- */

const swigEnv = { prior: globalThis.fromUuidSync, format: globalThis.game.i18n.format, warn: globalThis.ui.notifications.warn };
const drinkerActor = { uuid: "A.d", name: "Drinker", system: { saves: { death: { value: 12 } } }, testUserPermission: ownedBy("gm", "pa") };
const drinkerToken = { id: "d", uuid: "S.d", name: "Drinker", actor: drinkerActor, testUserPermission: ownedBy("gm", "pa") };
const struckActor = { uuid: "A.s", name: "Struck", system: { saves: { blast: { value: 14 } } }, testUserPermission: ownedBy("gm", "pb") };
const struckToken = { id: "st", uuid: "S.s", name: "Struck", actor: struckActor, testUserPermission: ownedBy("gm", "pb") };
const archer = { uuid: "A.at", name: "Archer", testUserPermission: ownedBy("gm", "pa") };
const swigDocs = { "S.d": drinkerToken, "A.d": drinkerActor, "S.s": struckToken, "A.s": struckActor, "A.at": archer };
globalThis.fromUuidSync = (uuid) => swigDocs[uuid] ?? swigEnv.prior(uuid);
// A format that keeps its data, so a figure a line was built with is visible: `key[a=1,b=2]`.
globalThis.game.i18n.format = (key, data = {}) => {
  const bits = Object.entries(data).map(([k, v]) => `${k}=${v}`).join(",");
  return bits ? `${key}[${bits}]` : key;
};
const warned = [];
globalThis.ui.notifications.warn = (text) => warned.push(text);
const L = (key) => `ACKS-LIB.itemRun.card.${key}`;
const seen = [];
const outcomeFor = (act) => cardOfAct(act).flags["acks-extras"].itemRunCard;
const bodyOf = (kind, act, user) => {
  const html = bodyFor(kind, act, user);
  seen.push(html);
  return html;
};
const outcomePost = (kind, act, over = {}) => ({ ok: true, kind, itemUuid: "I.dr", itemName: "Jug", activationId: act, rowKey: kind, actorUuid: "A.d", actorName: "Drinker", subtitle: "Drinker", subjects: [{ key: "S.d", name: "Drinker" }], saveName: "death", saveMod: null, facts: { successHealDice: "1d6", condition: "held", cite: "Book p. 7" }, card: {}, ...over });
const buttons = (html, action) => (html.match(new RegExp(`data-action="${action}"`, "g")) ?? []).length;

await t("a drinker's own swig posts one small card: the heal with its dice, what they rolled and the page, and the swigs left with the count before; an uncounted jug draws no count; a Judge's reason carries the page alone", async () => {
  const consume = { ok: true, kind: "consume", outcome: "heal", itemUuid: "I.dr", itemName: "Jug", actorUuid: "A.d", actorName: "Drinker", tokenUuid: "S.d", left: { before: 3, after: 2 }, heal: { dice: "2d4", rolled: 7, amount: 5 }, why: "" };
  const before = messages.length;
  await presenter.presentUse(consume);
  assert.equal(messages.length - before, 1, "one card");
  const card = messages.at(-1).flags["acks-extras"].itemRunCard;
  assert.deepEqual([card.kind, card.title, card.bearer.name, card.outcome, card.heal, card.left], ["consume", "Jug", "Drinker", "heal", { dice: "2d4", rolled: 7, amount: 5 }, { before: 3, after: 2 }], "it stores what its body draws");
  const html = presenter.consumeBody(messages.at(-1), card);
  seen.push(html);
  assert.ok(html.includes(L("swigTitle") + "[item=Jug]") && html.includes(L("healedLine") + "[amount=5]"), "titled for the item, the line names what the write healed");
  assert.ok(html.includes(`data-tooltip-text="5: 2d4 ${L("damageTip.rolled")} 7 (${L("citeSwig")})"`), "the heal's tooltip: the amount, the dice, the rolled figure and the page");
  assert.ok(html.includes(L("swigsLeft") + "[after=2]") && html.includes(`data-tooltip-text="${L("swigsLeftTip")}[before=3] (${L("citeSwig")})"`), "the swigs left, and the count before this swig");
  assert.ok(!html.includes("<button"), "no press");
  await presenter.presentUse({ ...consume, left: { before: null, after: null } });
  const bare = presenter.consumeBody(messages.at(-1), messages.at(-1).flags["acks-extras"].itemRunCard);
  assert.ok(!bare.includes(L("swigsLeft")), "an uncounted jug names no count");
  await presenter.presentUse({ ...consume, outcome: "judge", heal: null, why: "several" });
  const judge = presenter.consumeBody(messages.at(-1), messages.at(-1).flags["acks-extras"].itemRunCard);
  seen.push(judge);
  assert.ok(judge.includes(L("why.several")) && !judge.includes(L("healedLine")) && judge.includes(`data-tooltip-text="${L("citeSwig")}"`), "a Judge's reason, its tooltip the page alone");
  await presenter.presentUse({ ...consume, outcome: "judge", heal: null, why: "figure" });
  assert.ok(presenter.consumeBody(messages.at(-1), messages.at(-1).flags["acks-extras"].itemRunCard).includes(L("why.figure")), "a blank figure reads as the Judge's");
});

await t("a posted outcome card stores the way a burst card does: the kind's facts, the subject keyed by safeKey, the save and its modifier, and no entries yet", async () => {
  const before = messages.length;
  await presenter.presentUse(outcomePost("swig", "sw1"));
  assert.equal(messages.length - before, 1);
  const card = outcomeFor("sw1");
  assert.deepEqual([card.kind, card.rowKey, card.title, card.itemUuid, card.activationId, card.saveName, card.saveMod, card.actorUuid], ["swig", "swig", "Jug", "I.dr", "sw1", "death", null, "A.d"]);
  assert.deepEqual([card.successHealDice, card.condition, card.cite], ["1d6", "held", "Book p. 7"], "the facts are on the card, since the item may be gone");
  assert.deepEqual([card.bearer, card.subjects, card.entries], [{ uuid: "A.d", name: "Drinker" }, { "S~d": { uuid: "S.d", name: "Drinker", state: "in", latest: "" } }, {}]);
  assert.equal(messages.at(-1).content.includes("Jug"), true, "the stored message reads as the banner");
  await presenter.presentUse(outcomePost("onHit", "sw2", { itemName: "Dart", subtitle: "Archer", actorUuid: "A.at", actorName: "Archer", subjects: [{ key: "S.s", name: "Struck" }], saveName: "blast", saveMod: 2, facts: { formula: "1d4", delayTurns: 3, source: "Barb", cite: "Book p. 12", struckAt: 100 } }));
  const hit = outcomeFor("sw2");
  assert.deepEqual([hit.kind, hit.title, hit.subtitle, hit.bearer.name, hit.saveMod, hit.formula, hit.delayTurns, hit.source, hit.struckAt, Object.keys(hit.subjects)], ["onHit", "Dart", "Archer", "Archer", 2, "1d4", 3, "Barb", 100, ["S~s"]]);
  await presenter.presentUse(outcomePost("swigUnknown", "sw3", { saveName: "", facts: { drinkerTokenUuid: "S.d", drinkerActorUuid: "A.d", healDice: "2d4", saveKind: "death", successHealDice: "1d6", condition: "held", cite: "Book p. 7" } }));
  assert.deepEqual([outcomeFor("sw3").kind, outcomeFor("sw3").drinkerActorUuid, outcomeFor("sw3").healDice, outcomeFor("sw3").saveName], ["swigUnknown", "A.d", "2d4", ""]);
  await presenter.presentUse({ ...outcomePost("swig", "sw4"), ok: false });
  assert.ok(!cardOfAct("sw4"), "a refused post draws nothing");
});

await t("a swig's save card: the Save press is offered to the drinker's owners and the Judges, names the entry's key and the card, and a seat that owns neither reads the row without it", async () => {
  const gm = bodyOf("outcomeBody", "sw1", users[0]);
  const owner = bodyOf("outcomeBody", "sw1", users[1]);
  const other = bodyOf("outcomeBody", "sw1", users[2]);
  for (const html of [gm, owner]) {
    assert.equal(buttons(html, "itemRun.roll"), 1, "one Save press");
    assert.ok(html.includes('data-entry-key="S~d"') && html.includes(`data-message-id="${cardOfAct("sw1").id}"`) && html.includes('data-subject="S.d"') && html.includes('data-row-key="swig"') && html.includes('data-activation-id="sw1"'), "it names the entry's key, the card, the subject and the ids");
    assert.ok(html.includes(`aria-label="${L("saveAria")}"`), "and has an accessible name");
  }
  assert.ok(other.includes('<span class="acks-extras-roll-detail">death</span>') && !other.includes("<button"), "a seat that owns nothing here reads the drinker's row and presses nothing");
  assert.ok(gm.includes(L("swigTitle") + "[item=Jug]") && gm.includes(`data-tooltip-text="death 12+ (Book p. 7)"`), "the target's tooltip names the save, its figure and the page");
  assert.ok(gm.includes('<span class="acks-extras-roll-detail">death</span>'), "the save is named under the drinker");
  me.current = users[0];
});

await t("a swig's verdict lines: a pass reads Saved with what it healed (the success dice and the page in its tooltip), a failure the condition and how long, a judge entry the Judge's line; Undo goes to the presser or an owner while something is written", async () => {
  const entries = outcomeFor("sw1").entries;
  entries["S~d"] = { subject: "S.d", state: "applied", saved: true, total: 14, target: 12, amount: 4, hp: [{ uuid: "A.d", amount: -4 }], recordIds: [], presser: "pa" };
  const pass = bodyOf("outcomeBody", "sw1", users[1]);
  assert.ok(pass.includes(`${L("saved")} · ${L("healed")} 4`), "Saved · healed 4");
  assert.ok(pass.includes(`data-tooltip-text="${L("successHealTip")}: 1d6 (Book p. 7)"`), "the dice that healed and the page");
  assert.ok(pass.includes(">14<") && pass.includes("12+"), "the total and the target");
  assert.equal(buttons(pass, "itemRun.undo"), 1, "the presser may undo the heal");
  assert.equal(buttons(bodyOf("outcomeBody", "sw1", users[0]), "itemRun.undo"), 1, "a Judge owns the drinker too");
  assert.equal(buttons(bodyOf("outcomeBody", "sw1", users[2]), "itemRun.undo"), 0, "a seat that owns neither has none");
  assert.ok(!pass.includes('data-action="itemRun.roll"'), "no Save press once the entry holds a verdict");
  entries["S~d"] = { subject: "S.d", state: "applied", saved: true, total: 14, target: 12, amount: 0, hp: [], recordIds: [], presser: "pa" };
  assert.equal(buttons(bodyOf("outcomeBody", "sw1", users[1]), "itemRun.undo"), 0, "a pass that healed nothing wrote nothing to undo");
  entries["S~d"] = { subject: "S.d", state: "applied", saved: false, total: 5, target: 12, recordIds: ["e1"], names: ["Held"], life: "turn", presser: "pa" };
  const fail = bodyOf("outcomeBody", "sw1", users[1]);
  assert.ok(fail.includes(`${L("failed")} · Held, ${L("life.turn")}`), "Failed · the condition, and how long the existing cards say it lasts");
  assert.ok(fail.includes(`data-tooltip-text="${L("conditionTip")}: Held (Book p. 7)"`) && buttons(fail, "itemRun.undo") === 1);
  entries["S~d"] = { subject: "S.d", state: "judge", saved: true, total: 14, target: 12, why: "figure", presser: "pa" };
  const judge = bodyOf("outcomeBody", "sw1", users[0]);
  assert.ok(judge.includes(L("why.figure")) && judge.includes('data-tooltip-text="Book p. 7"') && buttons(judge, "itemRun.undo") === 0, "the Judge's line, the page alone, nothing to undo");
  entries["S~d"] = { subject: "S.d", state: "undone", saved: false, total: 5, target: 12, presser: "pa" };
  const undone = bodyOf("outcomeBody", "sw1", users[0]);
  assert.ok(undone.includes(L("undone")) && buttons(undone, "itemRun.undo") === 0 && buttons(undone, "itemRun.roll") === 0, "an undone entry says so and offers nothing");
  me.current = users[0];
});

await t("a swig that names no save has no Save press: the target cell is blank with the page alone, and the Judge's line says so", async () => {
  await presenter.presentUse(outcomePost("swig", "sw5", { saveName: "", facts: { successHealDice: null, condition: null, cite: "" } }));
  const html = bodyOf("outcomeBody", "sw5", users[0]);
  assert.ok(!html.includes("<button") && html.includes(L("noSaveLine")), "no press, the Judge's line");
  assert.ok(html.includes(`data-tooltip-text="${L("citeSwig")}"`), "a blank swig kind cites the swig's page; no number stands in");
  assert.ok(!html.includes("acks-extras-roll-detail"), "no save is named");
});

await t("an on-hit card speaks for the attacker: the struck token's owner presses Save, the attacker's owner does not, the save reads with its modifier and the row it came from, and a failure reads the delayed damage with its tooltip", async () => {
  const gm = bodyOf("outcomeBody", "sw2", users[0]);
  const struckOwner = bodyOf("outcomeBody", "sw2", users[2]);
  const attackerOwner = bodyOf("outcomeBody", "sw2", users[1]);
  assert.equal(buttons(gm, "itemRun.roll"), 1);
  assert.ok(struckOwner.includes('data-action="itemRun.roll"') && struckOwner.includes('data-entry-key="S~s"'), "the struck body's owner presses, with the entry's key");
  assert.ok(!attackerOwner.includes("<button") && !attackerOwner.includes("Struck"), "owning the attacker is not owning the struck body: its row is not shown to that seat");
  assert.ok(gm.includes("Dart") && gm.includes("Archer") && !gm.includes(L("swigTitle")), "titled for the source, speaking as the attacker");
  assert.ok(gm.includes('<span class="acks-extras-roll-detail">blast +2</span>'), "the save with its modifier");
  assert.ok(gm.includes(`data-tooltip-text="${L("saveModTip")}[source=Barb]: +2 (Book p. 12)"`), "the modifier's tooltip names its source row and the page");
  assert.ok(gm.includes("blast 14+") && gm.includes("Situational"), "the target's tooltip lists the modifier among its parts");
  const entries = outcomeFor("sw2").entries;
  entries["S~s"] = { subject: "S.s", state: "applied", saved: false, total: 3, target: 14, recordIds: ["r1"], names: ["Barb"], life: "timed", presser: "pb" };
  const failed = bodyOf("outcomeBody", "sw2", users[2]);
  assert.ok(failed.includes(`${L("failed")} · ${L("onHitLine")}[formula=1d4,delayTurns=3]`), "Failed · the formula in its turns");
  assert.ok(failed.includes(`data-tooltip-text="${L("onHitTip")}[source=Barb]: ${L("onHitLine")}[formula=1d4,delayTurns=3] (Book p. 12)"`), "read from the imported row, with its page");
  assert.equal(buttons(failed, "itemRun.undo"), 1, "undo for the presser");
  entries["S~s"] = { subject: "S.s", state: "applied", saved: true, total: 15, target: 14, recordIds: [], presser: "pb" };
  const passed = bodyOf("outcomeBody", "sw2", users[2]);
  assert.ok(passed.includes(L("saved")) && !passed.includes(L("onHitLine")) && buttons(passed, "itemRun.undo") === 0, "a pass is Saved and writes nothing");
  entries["S~s"] = { subject: "S.s", state: "judge", saved: false, total: 3, target: 14, why: "figure", presser: "pb" };
  assert.ok(bodyOf("outcomeBody", "sw2", users[0]).includes(L("why.figure")), "a blank figure is the Judge's line");
  await presenter.presentUse(outcomePost("onHit", "sw6", { itemName: "Dart", actorUuid: "A.at", actorName: "Archer", subjects: [{ key: "S.s", name: "Struck" }], saveName: "blast", saveMod: null, facts: { formula: "1d4", delayTurns: 3, source: "Barb", cite: "", struckAt: null } }));
  const plain = bodyOf("outcomeBody", "sw6", users[0]);
  assert.ok(!plain.includes("blast +") && !plain.includes(L("saveModTip")), "no modifier, none drawn");
  outcomeFor("sw6").entries["S~s"] = { subject: "S.s", state: "applied", saved: false, total: 3, target: 14, recordIds: ["r1"], names: ["Barb"], life: "timed", presser: "pb" };
  const noPage = bodyOf("outcomeBody", "sw6", users[0]);
  assert.ok(noPage.includes(`data-tooltip-text="${L("onHitTip")}[source=Barb]: ${L("onHitLine")}[formula=1d4,delayTurns=3]"`), "an item that prints no page cites none, and no page is borrowed");
  me.current = users[0];
});

await t("an unknown drinker's card: Heal and Ask the save for a seat that owns the drinker's actor (a Judge's seat owns every one), the note alone for any other seat, and blank dice a blank cell with the page", async () => {
  const gm = bodyOf("swigUnknownBody", "sw3", users[0]);
  const owner = bodyOf("swigUnknownBody", "sw3", users[1]);
  const other = bodyOf("swigUnknownBody", "sw3", users[2]);
  for (const html of [gm, owner]) {
    assert.ok(buttons(html, "itemRun.swigHeal") === 1 && buttons(html, "itemRun.swigAskSave") === 1, "both presses");
    assert.ok(html.includes(`data-message-id="${cardOfAct("sw3").id}"`) && html.includes(`aria-label="${L("healAria")}"`) && html.includes(`aria-label="${L("askSaveAria")}"`), "each names the card and has an accessible name");
    assert.ok(html.includes(L("unknownNote") + " (Book p. 7)") && html.includes(L("unknownHeal") + "[dice=2d4]") && html.includes(L("unknownAsk") + "[kind=death]"), "the note with its page, and each choice with its figure");
    assert.ok(html.includes(`data-tooltip-text="${L("unknownHealLabel")}[item=Jug]: 2d4 (Book p. 7)"`) && html.includes(`data-tooltip-text="${L("unknownAskLabel")}[item=Jug]: death (Book p. 7)"`), "each figure's tooltip: read from the imported row, with its page");
    assert.ok(html.includes(L("swigTitle") + "[item=Jug]"));
  }
  assert.ok(!other.includes("<button") && other.includes(L("unknownNoteOther") + " (Book p. 7)") && !other.includes(L("unknownHeal")), "a seat that does not own the drinker reads the card without the choice");
  await presenter.presentUse(outcomePost("swigUnknown", "sw7", { saveName: "", facts: { drinkerTokenUuid: "S.d", drinkerActorUuid: "A.d", healDice: null, saveKind: null, successHealDice: null, condition: null, cite: "" } }));
  const blank = bodyOf("swigUnknownBody", "sw7", users[0]);
  assert.ok(blank.includes(L("unknownHealBlank")) && blank.includes(L("unknownAskBlank")) && !blank.includes("dice=") && !blank.includes("kind="), "a blank figure is blank");
  assert.ok(blank.includes(`data-tooltip-text="${L("citeSwig")}"`) && buttons(blank, "itemRun.swigHeal") === 1, "its tooltip is the page alone, and the press stays");
  me.current = users[0];
});

await t("Heal turns the unknown card into the heal it wrote, with no press; Ask the save turns it into the swig save card in place, which draws as one and offers Save to the drinker's owners", async () => {
  const stored = outcomeFor("sw3");
  Object.assign(stored, { resolved: "heal", amount: 4, rolled: 6, resolvedBy: "pa" });
  const healed = bodyOf("cardBody", "sw3", users[1]);
  assert.ok(healed.includes(L("healedLine") + "[amount=4]") && healed.includes(`data-tooltip-text="4: 2d4 ${L("damageTip.rolled")} 6 (Book p. 7)"`) && !healed.includes("<button"), "Healed, the dice and the page, no presses");
  Object.assign(stored, { resolved: "judge", why: "figure" });
  const judged = bodyOf("cardBody", "sw3", users[1]);
  assert.ok(judged.includes(L("why.figure")) && !judged.includes("<button"), "a Heal with blank dice leaves the Judge's line and no presses");
  delete stored.resolved;
  delete stored.why;
  Object.assign(stored, { kind: "swig", rowKey: "swig", saveName: "death", asked: true, askedBy: "pa" });
  const asked = bodyOf("cardBody", "sw3", users[1]);
  assert.ok(asked.includes('data-action="itemRun.roll"') && asked.includes('data-entry-key="S~d"') && !asked.includes("itemRun.swigHeal") && asked.includes(`data-tooltip-text="death 12+ (Book p. 7)"`), "it re-dispatches on its live kind");
  me.current = users[0];
});

await t("a press on the unknown card's buttons reaches the runtime's presses and a refusal is told: Ask the save by the drinker's owner flips the card, and a second press is refused as answered", async () => {
  await presenter.presentUse(outcomePost("swigUnknown", "sw8", { saveName: "", facts: { drinkerTokenUuid: "S.d", drinkerActorUuid: "A.d", healDice: "2d4", saveKind: "death", successHealDice: "1d6", condition: "held", cite: "Book p. 7" } }));
  const message = cardOfAct("sw8");
  me.current = users[0];
  const button = (action) => ({ dataset: { action, messageId: message.id } });
  warned.length = 0;
  await presenter.press(message, button("itemRun.swigAskSave"));
  const card = outcomeFor("sw8");
  assert.deepEqual([card.kind, card.rowKey, card.saveName, card.asked, warned.length], ["swig", "swig", "death", true, 0], "the press reached swigAskSave and the card is the save card");
  await presenter.press(message, button("itemRun.swigHeal"));
  assert.deepEqual(warned, ["ACKS-LIB.itemRun.refused.applied"], "a press on a card already answered is refused, and the refusal is told");
});

await t("a press follows the document it writes, by ownership and never by role: Heal and Ask the save read the drinker's actor, Save reads the token, and a seat that declares itself a Judge and owns neither is offered nothing", async () => {
  const held = { token: drinkerToken.testUserPermission, actor: drinkerActor.testUserPermission };
  users.push({ id: "pc" }, { id: "gj", isGM: true });
  const [pa, pc, gj] = [users[1], users.at(-2), users.at(-1)];
  drinkerActor.testUserPermission = ownedBy("gm", "pa");
  drinkerToken.testUserPermission = ownedBy("gm", "pc");
  await presenter.presentUse(outcomePost("swigUnknown", "sw9", { saveName: "", facts: { drinkerTokenUuid: "S.d", drinkerActorUuid: "A.d", healDice: "2d4", saveKind: "death", successHealDice: "1d6", condition: "held", cite: "Book p. 7" } }));
  const actorOwner = bodyOf("swigUnknownBody", "sw9", pa);
  const tokenOwner = bodyOf("swigUnknownBody", "sw9", pc);
  const roleOnly = bodyOf("swigUnknownBody", "sw9", gj);
  assert.ok(buttons(actorOwner, "itemRun.swigHeal") === 1 && buttons(actorOwner, "itemRun.swigAskSave") === 1, "the owner of the drinker's actor is offered the choice");
  assert.ok(!tokenOwner.includes("<button") && !roleOnly.includes("<button"), "an owner of the token alone, and a seat that is a Judge by role only, are not");
  await presenter.presentUse(outcomePost("swig", "sw10"));
  assert.equal(buttons(bodyOf("outcomeBody", "sw10", pc), "itemRun.roll"), 1, "the Save press follows the token: its owner has it");
  assert.equal(buttons(bodyOf("outcomeBody", "sw10", pa), "itemRun.roll"), 0, "and the owner of the actor alone does not");
  assert.equal(buttons(bodyOf("outcomeBody", "sw10", gj), "itemRun.roll"), 0, "a role presses nothing");
  drinkerToken.testUserPermission = held.token;
  drinkerActor.testUserPermission = held.actor;
  users.splice(-2, 2);
  me.current = users[0];
});

await t("every key a swig or on-hit card draws is in lang/en.json, and no card uses a title attribute", async () => {
  const { readFileSync } = await import("node:fs");
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  const used = new Set(seen.flatMap((html) => html.match(/ACKS-LIB\.[A-Za-z0-9_.]+/g) ?? []).map((key) => key.replace(/\.+$/, "")));
  assert.ok(used.size > 15, "the bodies drew their words");
  assert.deepEqual([...used].filter((key) => !(key in lang)), [], "each key exists");
  assert.ok(seen.every((html) => !/\stitle="/.test(html)), "tooltips are core's, never a title attribute");
});

globalThis.fromUuidSync = swigEnv.prior;
globalThis.game.i18n.format = swigEnv.format;
globalThis.ui.notifications.warn = swigEnv.warn;
me.current = users[0];

console.log(`\ntest-item-run-presenter: ${passed} checks passed.`);
