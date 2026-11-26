/**
 * The strip's refresh on a token's move and a Region's change
 * (`installItemRunStrip`), offline: a scene with no reach renders no sheet, a
 * scene with one renders only the sheets that carry the strip or a gear row
 * and whose body has a token on that scene, a burst of events costs one render
 * per sheet, the last reach's removal still clears the strip, and a Region that
 * is no reach renders nothing. Foundry-free with stand-ins; every name below is
 * invented.
 *
 * Usage: node tools/test-item-run-strip.mjs
 */
import assert from "node:assert/strict";

const hooked = {};
globalThis.Hooks = { once() {}, on: (name, fn) => { hooked[name] = fn; }, callAll() {} };
globalThis.foundry = {
  utils: { getProperty: (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj), randomID: () => "rid", escapeHTML: (text) => String(text) },
  applications: { api: { HandlebarsApplicationMixin: (Base) => class extends Base {}, ApplicationV2: class { render() {} async _prepareContext() { return {}; } close() {} } }, instances: new Map() },
};
globalThis.game = { i18n: { format: (key) => key, localize: (key) => key }, users: [], user: { isGM: false } };
globalThis.ui = { notifications: { warn() {}, error() {} } };
globalThis.CONST = { TOKEN_DISPLAY_MODES: {} };

const { AURA_BEHAVIOR_TYPE } = await import("../scripts/lib/constants.mjs");
const { installItemRunStrip } = await import("../scripts/lib/item-run-strip.mjs");
installItemRunStrip();

/** More than the strip's wait, so a queued refresh has run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 300));

let passed = 0;
const t = async (name, fn) => {
  await fn();
  passed += 1;
  console.log(`ok - ${name}`);
};

const reachRegion = (parent) => ({ id: "reach", parent, behaviors: [{ type: AURA_BEHAVIOR_TYPE }] });
const plainRegion = (parent) => ({ id: "plain", parent, behaviors: [{ type: "other" }] });
const sceneOf = (id, regions = []) => ({ id, regions });
const CHARACTER = ["acks-ui", "acks-extras-character-sheet"];
const MONSTER = ["acks-ui", "acks-extras-monster"];

/** An open sheet whose body has the given tokens on the canvas scene; `renders` counts its renders. */
function sheet(classes, tokens, documentName = "Actor") {
  const app = { rendered: true, renders: 0, options: { classes }, document: { documentName, isToken: false, getActiveTokens: () => tokens }, render() { this.renders += 1; } };
  return app;
}

/** Open these sheets, and the Region's or token's events run against them. */
const open = (...apps) => {
  globalThis.foundry.applications.instances = new Map(apps.map((app, i) => [String(i), app]));
};

await t("a token's move on a scene with no reach renders no sheet", async () => {
  const scene = sceneOf("S1");
  const token = { uuid: "T1", parent: scene };
  const mine = sheet(CHARACTER, [token]);
  open(mine, sheet(MONSTER, [token]));
  hooked.updateToken(token, { x: 100 });
  await settle();
  assert.equal(mine.renders, 0);
  assert.equal(globalThis.foundry.applications.instances.get("1").renders, 0);
});

await t("with a reach on the scene, a move renders the sheets that carry the strip and whose body is on that scene, once for a burst, and no other", async () => {
  const scene = sceneOf("S1");
  const reach = reachRegion(scene);
  scene.regions = [reach];
  const elsewhere = sceneOf("S2", [reachRegion(sceneOf("S2"))]);
  const token = { uuid: "T1", parent: scene };
  const character = sheet(CHARACTER, [token]);
  const monster = sheet(MONSTER, [{ uuid: "T2", parent: scene }]);
  const notReader = sheet(["acks-ui", "acks-extras-group-sheet"], [token]);
  const otherScene = sheet(CHARACTER, [{ uuid: "T3", parent: elsewhere }]);
  const notActor = sheet(CHARACTER, [token], "Item");
  const closed = Object.assign(sheet(CHARACTER, [token]), { rendered: false });
  open(character, monster, notReader, otherScene, notActor, closed);
  hooked.updateToken(token, { x: 100 });
  hooked.updateToken(token, { y: 100 });
  hooked.updateRegion(reach, { shape: [] });
  await settle();
  assert.deepEqual([character.renders, monster.renders], [1, 1], "a reader with a token on the scene is rendered once for three events");
  assert.deepEqual([notReader.renders, otherScene.renders, notActor.renders, closed.renders], [0, 0, 0, 0], "a sheet that reads no reach, a body on another scene, a window that is no Actor's and a closed one are not");
  hooked.updateToken(token, { name: "renamed" });
  await settle();
  assert.equal(character.renders, 1, "a change that moves nothing renders nothing");
});

await t("the last reach's removal still clears the strip, and a Region that is no reach renders nothing", async () => {
  const scene = sceneOf("S1");
  const token = { uuid: "T1", parent: scene };
  const character = sheet(CHARACTER, [token]);
  open(character);
  hooked.deleteRegion(reachRegion(scene));
  await settle();
  assert.equal(character.renders, 1, "the scene holds no reach after the delete and the sheet is rendered once");
  for (const name of ["createRegion", "updateRegion", "deleteRegion"]) hooked[name](plainRegion(scene));
  await settle();
  assert.equal(character.renders, 1, "a Region with no aura behavior is no reach");
});

await t("a reach Region's making renders the readers of its scene", async () => {
  const scene = sceneOf("S1");
  const character = sheet(CHARACTER, [{ uuid: "T1", parent: scene }]);
  open(character);
  hooked.createRegion(reachRegion(scene));
  await settle();
  assert.equal(character.renders, 1);
});

console.log(`\ntest-item-run-strip: ${passed} checks passed.`);
