/**
 * The core patch that keeps a seat without the settings permission from sending
 * the system's welcome-version write (scripts/lib/patches/welcome-version.mjs).
 * A stand-in for core's settings class counts the calls that reach it and holds
 * a stored value per key; the wrapper is installed over it on the plain-wrap
 * path, since libWrapper is not loaded here.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const calls = [];
const stored = new Map([["acks.welcomeMessageVersion", "14.1.0"], ["acks.other", "o"]]);
class ClientSettings {
  get(namespace, key, { document = false } = {}) {
    const value = stored.get(`${namespace}.${key}`);
    return document ? { key: `${namespace}.${key}`, value } : value;
  }
  async set(namespace, key, value, { document = false, ...options } = {}) {
    calls.push({ self: this, namespace, key, value, options });
    stored.set(`${namespace}.${key}`, value);
    return document ? { key: `${namespace}.${key}`, value } : value;
  }
}

let canModify = false;
const asked = [];
globalThis.game = { user: { can: (permission) => { asked.push(permission); return canModify; } } };

const warnings = [];
const realWarn = console.warn;
console.warn = (...args) => warnings.push(args.join(" "));

await ok("a missing settings class warns once and stands down without throwing", async () => {
  globalThis.foundry = { helpers: {} };
  const { installWelcomeVersionPatch } = await import("../scripts/lib/patches/welcome-version.mjs");
  installWelcomeVersionPatch();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /ClientSettings#set/);
  globalThis.foundry = { helpers: { ClientSettings: { prototype: {} } } };
  installWelcomeVersionPatch();
  assert.equal(warnings.length, 2);
});

globalThis.foundry = { helpers: { ClientSettings } };
const { installWelcomeVersionPatch } = await import("../scripts/lib/patches/welcome-version.mjs");
installWelcomeVersionPatch();
const settings = new ClientSettings();
const WELCOME = ["acks", "welcomeMessageVersion"];

await ok("the welcome write from a seat without the permission returns the stored value and never calls core", async () => {
  canModify = false;
  calls.length = 0;
  const result = settings.set(...WELCOME, "14.2.0");
  assert.ok(result instanceof Promise);
  assert.equal(await result, "14.1.0");
  assert.equal(calls.length, 0);
  assert.equal(stored.get("acks.welcomeMessageVersion"), "14.1.0");
  assert.ok(asked.includes("SETTINGS_MODIFY"));
});

await ok("the document option returns the stored Setting document", async () => {
  canModify = false;
  calls.length = 0;
  const doc = await settings.set(...WELCOME, "14.2.0", { document: true });
  assert.deepEqual(doc, { key: "acks.welcomeMessageVersion", value: "14.1.0" });
  assert.equal(calls.length, 0);
});

await ok("a seat with the permission reaches core once, `this` and the arguments intact", async () => {
  canModify = true;
  calls.length = 0;
  assert.equal(await settings.set(...WELCOME, "14.2.0", { document: false, x: 1 }), "14.2.0");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].self, settings);
  assert.deepEqual(calls[0].options, { x: 1 });
  assert.equal(stored.get("acks.welcomeMessageVersion"), "14.2.0");
  stored.set("acks.welcomeMessageVersion", "14.1.0");
});

await ok("another key and another namespace reach core from a seat without the permission", async () => {
  canModify = false;
  for (const [namespace, key] of [["acks", "other"], ["acks-extras", "welcomeMessageVersion"], ["acks", "welcomeMessageVersions"]]) {
    calls.length = 0;
    assert.equal(await settings.set(namespace, key, "v"), "v");
    assert.equal(calls.length, 1, `${namespace}.${key}`);
    assert.equal(calls[0].self, settings);
  }
  stored.set("acks.welcomeMessageVersion", "14.1.0");
});

await ok("the permission is read at call time", async () => {
  calls.length = 0;
  canModify = false;
  await settings.set(...WELCOME, "14.2.0");
  assert.equal(calls.length, 0);
  canModify = true;
  await settings.set(...WELCOME, "14.2.0");
  assert.equal(calls.length, 1);
  canModify = false;
  await settings.set(...WELCOME, "14.3.0");
  assert.equal(calls.length, 1);
  stored.set("acks.welcomeMessageVersion", "14.1.0");
});

await ok("a seat with no user reads as without the permission", async () => {
  const user = globalThis.game.user;
  globalThis.game.user = undefined;
  calls.length = 0;
  assert.equal(await settings.set(...WELCOME, "14.2.0"), "14.1.0");
  assert.equal(calls.length, 0);
  globalThis.game.user = user;
});

await ok("a second install adds no second layer", async () => {
  installWelcomeVersionPatch();
  installWelcomeVersionPatch();
  // Each layer reads the permission once on the way through, so a call that
  // passes the match reaches core after exactly one read.
  asked.length = 0;
  canModify = true;
  calls.length = 0;
  await settings.set(...WELCOME, "14.2.0");
  assert.equal(asked.length, 1);
  assert.equal(calls.length, 1);
  stored.set("acks.welcomeMessageVersion", "14.1.0");
});

console.warn = realWarn;
console.log(`\n${passed} passed`);
