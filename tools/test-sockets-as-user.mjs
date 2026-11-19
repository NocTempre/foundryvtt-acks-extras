/**
 * `executeAsUser` (scripts/lib/sockets.mjs): a question put to one user's own
 * client. Foundry and socketlib are stand-ins.
 *
 * What this pins: the user's own id runs the registered handler here, with no
 * socketlib needed; another user's active seat is asked through socketlib's
 * `executeAsUser` and its answer comes back; and every way the answer cannot
 * come (no socketlib, a user who is not connected or unknown, no user id, an
 * unregistered handler, a throw here or over the wire) answers undefined, never
 * a rejection. The one-window-per-user half is the seat election's own
 * (test-automation-client.mjs): a relayed non-broadcast call runs on the lead
 * window of the seat it reached, and a player's only window leads that seat.
 *
 * Run: node tools/test-sockets-as-user.mjs
 */
import assert from "node:assert/strict";

let passed = 0;
const test = async (name, fn) => {
  await fn();
  passed++;
  console.log(`ok   ${name}`);
};

const once = new Map();
globalThis.Hooks = {
  once: (name, fn) => once.set(name, [...(once.get(name) ?? []), fn]),
  on() {},
};
const fire = (name) => {
  for (const fn of once.get(name) ?? []) fn();
  once.delete(name);
};
const asked = [];
let wire = async (name, userId, ...args) => (asked.push({ name, userId, args }), "wired");
globalThis.socketlib = {
  registerModule: () => ({ register() {}, executeAsUser: (...a) => wire(...a) }),
};
globalThis.game = {
  user: { id: "me" },
  users: new Map([
    ["me", { id: "me", active: true }],
    ["there", { id: "there", active: true }],
    ["away", { id: "away", active: false }],
  ]),
};

const sockets = await import("../scripts/lib/sockets.mjs");
const ran = [];
sockets.registerHandler("ask", (payload) => (ran.push(payload), "local answer"));
sockets.registerHandler("boom", () => {
  throw new Error("handler threw");
});
const quiet = async (fn) => {
  const keep = console.error;
  const logged = [];
  console.error = (...a) => logged.push(a);
  try {
    return [await fn(), logged];
  } finally {
    console.error = keep;
  }
};

await test("before socketlib is up, another user's call answers undefined and sends nothing", async () => {
  assert.equal(await sockets.executeAsUser("ask", "there", { q: 1 }), undefined);
  assert.deepEqual(asked, []);
});

await test("the user's own id runs the handler here, with the payload as given, even without socketlib", async () => {
  assert.equal(await sockets.executeAsUser("ask", "me", { q: 2 }), "local answer");
  assert.deepEqual(ran, [{ q: 2 }]);
  assert.deepEqual(asked, [], "nothing crossed the wire");
});

fire("socketlib.ready");

await test("another active user is asked through socketlib and the answer comes back", async () => {
  assert.equal(await sockets.executeAsUser("ask", "there", { q: 3 }), "wired");
  assert.deepEqual(asked, [{ name: "ask", userId: "there", args: [{ q: 3 }] }]);
  assert.equal(ran.length, 1, "the handler did not run here");
});

await test("a user who is not connected, or unknown, or no user at all, answers undefined without a send", async () => {
  asked.length = 0;
  assert.equal(await sockets.executeAsUser("ask", "away", {}), undefined);
  assert.equal(await sockets.executeAsUser("ask", "nobody", {}), undefined);
  assert.equal(await sockets.executeAsUser("ask", null, {}), undefined);
  assert.equal(await sockets.executeAsUser("ask", undefined, {}), undefined);
  assert.deepEqual(asked, []);
});

await test("an unregistered handler on this client answers undefined", async () => {
  assert.equal(await sockets.executeAsUser("missing", "me", {}), undefined);
});

await test("a throw here, or over the wire, answers undefined and is logged", async () => {
  const [local, localLog] = await quiet(() => sockets.executeAsUser("boom", "me", {}));
  assert.equal(local, undefined);
  assert.equal(localLog.length, 1);
  wire = async () => {
    throw new Error("the user's client refused");
  };
  const [remote, remoteLog] = await quiet(() => sockets.executeAsUser("ask", "there", {}));
  assert.equal(remote, undefined);
  assert.equal(remoteLog.length, 1);
});

console.log(`\n${passed} passed`);
