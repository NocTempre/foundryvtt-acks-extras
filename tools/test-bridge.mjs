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
import { emptyClientConfig, normalizeClientConfig, emptyAgent, normalizeAgent, configDigest, configGaps, isCurrent, channelsOfGuild, noteMember, memberLabel, MEMBER_CAP } from "../scripts/bridge/client-config-logic.mjs";
import { passwordProblem, userNameProblem, randomSecret, PASSWORD_MAX } from "../scripts/bridge/accounts-logic.mjs";
import { generateSealingPair, seal, unseal, keyIdOf, hintOf, sha256 } from "../scripts/bridge/sealing.mjs";
import { createHash } from "node:crypto";
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

console.log("bridge: the client's configuration");
await test("a configuration read back keeps only what it declares, in the types it declares", () => {
  const c = normalizeClientConfig({
    discord: { guildId: "123456789", chatChannelId: "not-an-id", judgeIds: "111111111, 222222222, 111111111", relay: false, colour: "red" },
    seat: { width: 99, height: 720, readySeconds: "45" },
    service: { logLevel: "shout" },
    revision: 4,
  });
  assert.equal(c.discord.guildId, "123456789");
  assert.equal(c.discord.chatChannelId, "", "anything that is not a Discord id is dropped rather than stored");
  assert.deepEqual(c.discord.judgeIds, ["111111111", "222222222"], "ids come apart on commas and de-duplicate");
  assert.equal(c.discord.relay, false);
  assert.equal(c.seat.width, emptyClientConfig().seat.width, "a size below the floor falls back rather than shipping a seat nothing renders in");
  assert.equal(c.seat.readySeconds, 45);
  assert.equal(c.service.logLevel, "info", "an unknown level is not a level");
  assert.equal(c.discord.colour, undefined);
  assert.equal(c.revision, 4);
});
await test("an announcement read back drops entries with no id and keeps a key", () => {
  const a = normalizeAgent({
    status: { state: "online" },
    guilds: [
      { id: "111111111", name: "The Table" },
      { name: "no id" },
    ],
    channels: [{ id: "222222222", name: "table-talk", guildId: "111111111" }],
    publicKey: { n: "abcdefghijklmnop" },
  });
  assert.equal(a.status.state, "online");
  assert.equal(a.guilds.length, 1);
  assert.deepEqual(
    channelsOfGuild(a, "111111111").map((c) => c.name),
    ["table-talk"],
  );
  assert.deepEqual(channelsOfGuild(a, "999999999"), []);
  assert.equal(normalizeAgent(null).status.state, "unseen", "no announcement is a state, not an error");
});
await test("the gaps name what stands between a configuration and a bot that answers", () => {
  assert.deepEqual(configGaps(emptyClientConfig(), emptyAgent()), ["noClient", "noToken", "noGuild"]);
  const agent = { ...emptyAgent(), status: { state: "awaiting", message: "", at: 1 }, keyId: "abc", publicKey: { n: "x" } };
  assert.deepEqual(configGaps(emptyClientConfig(), agent), ["noToken", "noGuild"]);
  const configured = { ...emptyClientConfig(), discord: { guildId: "111111111", chatChannelId: "222222222", judgeIds: [], relay: true }, token: { sealed: "x", keyId: "abc", hint: "" } };
  assert.deepEqual(configGaps(configured, agent), []);
  assert.deepEqual(configGaps({ ...configured, token: { ...configured.token, keyId: "other" } }, agent), ["staleToken"], "a token sealed to a key the bot lost is named, not silently ignored");
  assert.equal(isCurrent({ ...configured, revision: 2 }, { ...agent, revisionSeen: 2 }), true);
  assert.equal(isCurrent({ ...configured, revision: 3 }, { ...agent, revisionSeen: 2 }), false);
});
await test("the digest ignores a save that changed nothing and moves for one that did", () => {
  const c = { ...emptyClientConfig(), discord: { guildId: "111111111", chatChannelId: "", judgeIds: ["111111111"], relay: true } };
  assert.equal(configDigest(c), configDigest({ ...c, revision: 9, updatedAt: 1234 }));
  assert.notEqual(configDigest(c), configDigest({ ...c, seat: { ...c.seat, width: 800 } }));
  assert.notEqual(configDigest(c), configDigest({ ...c, restartNonce: 1234 }), "a restart request moves the digest, which is what restarts a running bot");
  assert.equal(normalizeClientConfig({ restartNonce: "junk" }).restartNonce, 0);
});
await test("the hand-written SHA-256 answers what the platform's does, at every padding boundary", () => {
  for (const len of [0, 1, 55, 56, 63, 64, 65, 119, 120, 191, 300]) {
    const bytes = Uint8Array.from({ length: len }, (_, i) => (i * 37) % 256);
    assert.equal(Buffer.from(sha256(bytes)).toString("hex"), createHash("sha256").update(bytes).digest("hex"), `length ${len}`);
  }
});
await test("a secret sealed to a published key opens with its own half and with no other", async () => {
  const mine = await generateSealingPair();
  const theirs = await generateSealingPair();
  const sealed = seal(mine.publicKey, "a-bot-token");
  assert.notEqual(sealed, "a-bot-token");
  assert.equal(await unseal(mine.privateKey, sealed), "a-bot-token");
  await assert.rejects(unseal(theirs.privateKey, sealed), "what a player reads out of the setting is not the token");
  assert.notEqual(seal(mine.publicKey, "a-bot-token"), sealed, "the padding is fresh each time, so the ciphertext never repeats");
  assert.equal(await unseal(mine.privateKey, seal(mine.publicKey, "a".repeat(190))), "a".repeat(190), "the longest a token could be still fits");
  assert.throws(() => seal(mine.publicKey, "a".repeat(191)), /more than this key carries/);
  assert.equal(keyIdOf(mine.publicKey).length, 16);
  assert.equal(hintOf("a-bot-token"), "11 characters, ending oken");
});

console.log("bridge: members and accounts");
await test("a member who knocks is remembered once, most recent first, and the list is capped", () => {
  let m = noteMember([], { id: "111111111", name: "ael", displayName: "Aelin" });
  const same = noteMember(m, { id: "111111111", name: "ael", displayName: "Aelin" });
  assert.strictEqual(same, m, "nothing changed, so the same list answers and no announcement is due");
  m = noteMember(m, { id: "222222222", name: "bo", displayName: "" });
  assert.deepEqual(m.map((e) => e.id), ["222222222", "111111111"]);
  m = noteMember(m, { id: "111111111", name: "ael", displayName: "Aelin the Bold" });
  assert.equal(m[0].displayName, "Aelin the Bold", "a renamed member moves to the front with the new name");
  assert.equal(m.length, 2);
  assert.strictEqual(noteMember(m, { id: "not-an-id", name: "x" }), m, "junk is not a member");
  let big = [];
  for (let i = 0; i < MEMBER_CAP + 20; i++) big = noteMember(big, { id: String(100000000 + i), name: `m${i}` });
  assert.equal(big.length, MEMBER_CAP);
  assert.equal(memberLabel({ id: "333333333", name: "cy", displayName: "" }), "cy");
  assert.equal(memberLabel({ id: "333333333" }), "333333333");
  const a = normalizeAgent({ members: [{ id: "111111111", name: "ael", displayName: "Aelin" }, { name: "no id" }] });
  assert.deepEqual(a.members, [{ id: "111111111", name: "ael", displayName: "Aelin" }]);
});
await test("a password from outside Foundry has a floor and a ceiling, a user a name, and a new user a secret nobody knows", () => {
  assert.equal(passwordProblem("short"), "tooShort");
  assert.equal(passwordProblem("x".repeat(PASSWORD_MAX + 1)), "tooLong");
  assert.equal(passwordProblem("long enough"), "");
  assert.equal(userNameProblem("   "), "empty");
  assert.equal(userNameProblem("x".repeat(65)), "tooLong");
  assert.equal(userNameProblem("Aelin"), "");
  const s1 = randomSecret();
  const s2 = randomSecret();
  assert.equal(s1.length, 32);
  assert.match(s1, /^[A-Za-z0-9]+$/);
  assert.notEqual(s1, s2);
  assert.equal(passwordProblem(s1), "", "the secret a user is born with would itself pass the floor");
});

console.log(`\nbridge: ${passed} passed`);
