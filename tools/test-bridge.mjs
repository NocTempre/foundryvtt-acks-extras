/**
 * Pure-logic regression tests for the bridge: the binding store's
 * arithmetic, the registry's one guard, the provenance stamp and the text
 * strip. No Foundry — the two facts Foundry owns (who an identity is bound
 * to, who is a Judge) are injected, so these assert that the guard refuses
 * what it claims to refuse rather than what a running world happens to do.
 * Every id is invented fixture data.
 *
 * Run: npm test
 */
import assert from "node:assert";
import {
  emptyStore, normalizeStore, bindUser, unbindUser, boundUserId, externalIdsOf,
  setActive, clearActive, activeOf, bindParty, unbindParty, partyOf, channelsOf,
} from "../scripts/bridge/bindings-logic.mjs";
import { createRegistry, BridgeError, requireOwner, fail } from "../scripts/bridge/registry-logic.mjs";
import { stampFor, flagsFor, provenanceOf } from "../scripts/bridge/provenance.mjs";
import { textOf } from "../scripts/bridge/text.mjs";
import { ERR, MODULE_ID, BRIDGE_FLAG } from "../scripts/bridge/constants.mjs";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
};

console.log("bridge: the binding store");
await test("binding an identity files it under kind:id and returns a new store", () => {
  const s0 = emptyStore();
  const s1 = bindUser(s0, "discord", "111", "userA");
  assert.equal(boundUserId(s1, "discord", "111"), "userA");
  assert.equal(boundUserId(s0, "discord", "111"), null, "the original store is untouched");
  assert.deepEqual(externalIdsOf(s1, "userA"), [{ kind: "discord", id: "111" }]);
});
await test("rebinding an identity replaces the earlier user", () => {
  const s = bindUser(bindUser(emptyStore(), "discord", "111", "userA"), "discord", "111", "userB");
  assert.equal(boundUserId(s, "discord", "111"), "userB");
  assert.deepEqual(externalIdsOf(s, "userA"), []);
});
await test("unbinding drops the active character only when no other identity reaches the user", () => {
  let s = bindUser(emptyStore(), "discord", "111", "userA");
  s = bindUser(s, "discord", "222", "userA");
  s = setActive(s, "userA", "Actor.abc");
  s = unbindUser(s, "discord", "111");
  assert.equal(activeOf(s, "userA"), "Actor.abc", "222 still reaches userA");
  s = unbindUser(s, "discord", "222");
  assert.equal(activeOf(s, "userA"), null);
  assert.equal(boundUserId(s, "discord", "222"), null);
});
await test("the active character is per Foundry user and clears cleanly", () => {
  let s = setActive(emptyStore(), "userA", "Actor.abc");
  assert.equal(activeOf(s, "userA"), "Actor.abc");
  s = clearActive(s, "userA");
  assert.equal(activeOf(s, "userA"), null);
});
await test("a channel binds to a formation and lists back by formation", () => {
  let s = bindParty(emptyStore(), "discord", "chan1", "form1");
  s = bindParty(s, "discord", "chan2", "form1");
  assert.equal(partyOf(s, "discord", "chan1"), "form1");
  assert.deepEqual(channelsOf(s, "form1").map((c) => c.id).sort(), ["chan1", "chan2"]);
  s = unbindParty(s, "discord", "chan1");
  assert.equal(partyOf(s, "discord", "chan1"), null);
});
await test("empty ids are refused, and garbage normalizes to the three maps", () => {
  assert.throws(() => bindUser(emptyStore(), "discord", "", "userA"), TypeError);
  assert.throws(() => bindUser(emptyStore(), "", "111", "userA"), TypeError);
  assert.throws(() => setActive(emptyStore(), "userA", "   "), TypeError);
  assert.deepEqual(normalizeStore(null), emptyStore());
  assert.deepEqual(normalizeStore({ users: "no", active: 3 }), emptyStore());
  assert.deepEqual(normalizeStore({ users: { "discord:1": "u" } }).users, { "discord:1": "u" });
});

console.log("bridge: the registry guard");
const gm = { id: "gm", name: "Judge", isGM: true };
const player = { id: "pl", name: "Player", isGM: false };
const users = { "discord:1": gm, "discord:2": player };
const makeRegistry = () =>
  createRegistry({ resolveUser: (client, args) => (args.asSeat ? gm : client ? (users[`${client.kind}:${client.user}`] ?? null) : null) });

await test("an unknown command answers unknownCommand, never throws", async () => {
  const r = makeRegistry();
  assert.deepEqual(await r.run("nope", {}), fail(ERR.unknownCommand, 'no bridge command "nope"'));
});
await test("an unbound identity is refused unless the command allows it", async () => {
  const r = makeRegistry();
  r.register("open", { run: (ctx) => ({ user: ctx.user }), allowUnbound: true });
  r.register("closed", { run: () => "never" });
  const client = { kind: "discord", user: "999" };
  assert.equal((await r.run("closed", { client })).code, ERR.unbound);
  assert.deepEqual(await r.run("open", { client }), { ok: true, data: { user: null } });
});
await test("a Judge command refuses a bound player and admits a bound GM or the seat", async () => {
  const r = makeRegistry();
  r.register("judgeOnly", { run: (ctx) => ctx.user.name, judge: true });
  assert.equal((await r.run("judgeOnly", { client: { kind: "discord", user: "2" } })).code, ERR.forbidden);
  assert.deepEqual(await r.run("judgeOnly", { client: { kind: "discord", user: "1" } }), { ok: true, data: "Judge" });
  assert.deepEqual(await r.run("judgeOnly", { client: { kind: "discord", user: "2" }, asSeat: true }), { ok: true, data: "Judge" });
});
await test("the handler's context says who runs and whether they judge", async () => {
  const r = makeRegistry();
  r.register("who", { run: (ctx, args) => ({ name: ctx.user.name, judge: ctx.judge, echo: args.echo }) });
  assert.deepEqual(await r.run("who", { client: { kind: "discord", user: "2" }, echo: 7 }), { ok: true, data: { name: "Player", judge: false, echo: 7 } });
  assert.deepEqual((await r.run("who", { client: { kind: "discord", user: "1" } })).data.judge, true);
});
await test("a BridgeError becomes its code; any other throw becomes failed", async () => {
  const r = makeRegistry();
  r.register("missing", { run: () => { throw new BridgeError(ERR.notFound, "no such actor"); } });
  r.register("broken", { run: () => { throw new Error("boom"); } });
  const c = { client: { kind: "discord", user: "2" } };
  assert.deepEqual(await r.run("missing", c), fail(ERR.notFound, "no such actor"));
  assert.deepEqual(await r.run("broken", c), fail(ERR.failed, "boom"));
});
await test("an undefined result is null, and a resolver that throws reads as invalid", async () => {
  const r = makeRegistry();
  r.register("nothing", { run: () => undefined });
  assert.deepEqual(await r.run("nothing", { client: { kind: "discord", user: "2" } }), { ok: true, data: null });
  const bad = createRegistry({ resolveUser: () => { throw new Error("bad identity"); } });
  bad.register("x", { run: () => 1 });
  assert.equal((await bad.run("x", {})).code, ERR.invalid);
});
await test("a duplicate name throws at registration, and list() carries no handler", () => {
  const r = makeRegistry();
  r.register("a", { run: () => 1, describe: "first" });
  assert.throws(() => r.register("a", { run: () => 2 }), /registered twice/);
  assert.throws(() => r.register("", { run: () => 2 }), TypeError);
  assert.throws(() => r.register("b", {}), TypeError);
  assert.deepEqual(r.list(), [{ name: "a", judge: false, allowUnbound: false, describe: "first" }]);
  assert.equal(r.has("a"), true);
});
await test("requireOwner asks the document, as the bound user, never the seat", () => {
  const doc = { testUserPermission: (u, level) => level === "OWNER" && u.id === "pl" };
  assert.equal(requireOwner({ user: player }, doc), doc);
  assert.throws(() => requireOwner({ user: gm }, doc), (e) => e.bridgeCode === ERR.forbidden);
  assert.throws(() => requireOwner({ user: null }, doc), (e) => e.bridgeCode === ERR.forbidden);
  assert.throws(() => requireOwner({ user: player }, null), (e) => e.bridgeCode === ERR.forbidden);
});

console.log("bridge: provenance and text");
await test("a stamp names the client, identity, channel and message; no client, no stamp", () => {
  const stamp = stampFor({ kind: "discord", user: "u", guild: "g", channel: "c", message: "m" }, { command: "say" });
  assert.equal(stamp.via, "discord");
  assert.equal(stamp.message, "m");
  assert.equal(stamp.command, "say");
  assert.ok(Number.isFinite(stamp.at));
  assert.equal(stampFor(null), null);
  assert.deepEqual(flagsFor(null), {});
  assert.equal(flagsFor({ kind: "discord", user: "u" })[MODULE_ID][BRIDGE_FLAG].user, "u");
});
await test("provenanceOf reads a live document's getFlag and raw data alike", () => {
  const live = { getFlag: (scope, key) => (scope === MODULE_ID && key === BRIDGE_FLAG ? { via: "discord" } : null) };
  const raw = { flags: { [MODULE_ID]: { [BRIDGE_FLAG]: { via: "discord" } } } };
  assert.deepEqual(provenanceOf(live), { via: "discord" });
  assert.deepEqual(provenanceOf(raw), { via: "discord" });
  assert.equal(provenanceOf({}), null);
  assert.equal(provenanceOf(null), null);
});
await test("textOf strips tags and entities and collapses whitespace", () => {
  assert.equal(textOf('<div class="x">Sword <b>attack</b>\n\n&amp; hits &lt;3<style>p{}</style></div>'), "Sword attack & hits <3");
  assert.equal(textOf(null), "");
});

console.log(`\nbridge: ${passed} passed`);
