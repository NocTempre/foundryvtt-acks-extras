/**
 * The navigation card's system icon: what a card shows for each declared
 * system and for none, that only a GM's root is drawn on and bound to the
 * picker, what the picker offers and writes, that a right click clears, that
 * the writer refuses a write the scene already says, and that the setup
 * panel's session follows the viewed scene's record. Every scene and flag is
 * invented; nothing here is a printed value.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("ok   " + name); };
const okAsync = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* -------------------------------------------- */
/*  Foundry mock                                */
/* -------------------------------------------- */

/** Every picker core would build, with what it was bound to. */
const menus = [];
globalThis.foundry = {
  utils: {
    hasProperty: (obj, path) => path.split(".").every((k) => (obj && typeof obj === "object" && k in obj ? ((obj = obj[k]), true) : false)),
  },
  applications: {
    ux: {
      ContextMenu: {
        implementation: class {
          constructor(container, selector, menuItems, options) {
            Object.assign(this, { container, selector, menuItems, options });
            menus.push(this);
          }
        },
      },
    },
  },
};
globalThis.game = {
  user: { isGM: true },
  scenes: new Map(),
  // Every key answers as itself, with its data appended, so a label is asserted by the key it was built from.
  i18n: {
    localize: (key) => key,
    format: (key, data = {}) => `${key} ${JSON.stringify(data)}`,
    has: () => false,
  },
};
const hooks = new Map();
globalThis.Hooks = {
  on: (name, fn) => {
    if (!hooks.has(name)) hooks.set(name, []);
    hooks.get(name).push(fn);
  },
};

/* -------------------------------------------- */
/*  A DOM small enough to hold in one hand       */
/* -------------------------------------------- */

const camel = (s) => s.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());

/** `.cls`, `.cls[data-x]` or `.cls.other`: the only shapes the module asks for. */
function matches(node, selector) {
  const m = selector.match(/^((?:\.[\w-]+)+)(?:\[data-([\w-]+)\])?$/);
  if (!m) throw new Error(`selector not mocked: ${selector}`);
  const classes = m[1].split(".").filter(Boolean);
  const own = node.className.split(/\s+/);
  if (!classes.every((c) => own.includes(c))) return false;
  if (m[2] && node.dataset[camel(m[2])] === undefined) return false;
  return true;
}

function el(tag, { className = "", dataset = {} } = {}) {
  return {
    tag,
    nodeType: 1,
    className,
    dataset: { ...dataset },
    attrs: {},
    children: [],
    parent: null,
    listeners: {},
    setAttribute(k, v) { this.attrs[k] = String(v); },
    getAttribute(k) { return this.attrs[k] ?? null; },
    append(...kids) { for (const k of kids) { k.parent = this; this.children.push(k); } },
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((c) => c !== this); },
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
    dispatch(type, event) { for (const fn of this.listeners[type] ?? []) fn(event); },
    descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); },
    querySelectorAll(selector) { return this.descendants().filter((n) => matches(n, selector)); },
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; },
    closest(selector) { for (let n = this; n; n = n.parent) if (matches(n, selector)) return n; return null; },
  };
}
globalThis.document = { createElement: (tag) => el(tag) };

const { MODULE_ID } = await import("../scripts/lib/constants.mjs");
const {
  SCENE_SYSTEM_CLASS, SCENE_SYSTEM_ACTION, SYSTEM_GLYPHS,
  sceneSystemFace, declareSceneSystem, pickerEntries, decorateSceneNavigation, bindScenePicker,
  sessionFollowsScene, installSceneNavigation,
} = await import("../scripts/battlemap/scene-nav.mjs");
const { writeSceneSystem, sceneSetup } = await import("../scripts/battlemap/scene-setup.mjs");

/* -------------------------------------------- */
/*  Fixtures                                    */
/* -------------------------------------------- */

/** A scene whose flag accessors read and write its raw flags and record each write. */
function makeScene(id, battlemap = null) {
  const scene = {
    id,
    flags: battlemap ? { [MODULE_ID]: { battlemap } } : {},
    writes: [],
    getFlag(scope, key) { return this.flags?.[scope]?.[key]; },
    async setFlag(scope, key, value) {
      this.writes.push({ key, value });
      (this.flags[scope] ??= {})[key] = value;
      return this;
    },
  };
  game.scenes.set(id, scene);
  return scene;
}

/** Core's navigation as it renders: one `li.scene` per scene, a level row carrying its scene's id beside its own. */
function navRoot(ids, { levelOf = null } = {}) {
  const root = el("nav", { className: "faded-ui flexcol" });
  const menu = el("menu", { className: "scene-navigation-menu flexcol" });
  root.append(menu);
  for (const id of ids) {
    const li = el("li", { className: "ui-control flexrow scene", dataset: { sceneId: id, action: "viewScene" } });
    li.append(el("span", { className: "ellipsis" }));
    menu.append(li);
  }
  if (levelOf) {
    const row = el("div", { className: "ui-control scene scene-level", dataset: { sceneId: levelOf, levelId: "L1", action: "viewLevel" } });
    menu.append(row);
  }
  return root;
}

const iconsOf = (root) => root.querySelectorAll(`.${SCENE_SYSTEM_CLASS}`);
const iconFor = (root, id) => iconsOf(root).find((b) => b.closest(".scene").dataset.sceneId === id);

/* -------------------------------------------- */
/*  The face                                    */
/* -------------------------------------------- */

ok("each declared system has its glyph, tooltip key and spoken label; none has a face of its own", () => {
  const faces = {
    delve: sceneSystemFace(makeScene("f1", { mapSystem: "delve" })),
    journey: sceneSystemFace(makeScene("f2", { mapSystem: "journey" })),
    settlement: sceneSystemFace(makeScene("f3", { mapSystem: "settlement" })),
    none: sceneSystemFace(makeScene("f4")),
  };
  for (const [key, face] of Object.entries(faces)) {
    assert.equal(face.key, key);
    assert.equal(face.glyph, SYSTEM_GLYPHS[key]);
    assert.equal(face.tooltip, `ACKS-BATTLEMAP.nav.tip.${key}`);
  }
  assert.equal(faces.delve.system, "delve");
  assert.equal(faces.none.system, null);
  assert.equal(faces.delve.label, 'ACKS-BATTLEMAP.nav.face {"system":"ACKS-BATTLEMAP.system.delve"}');
  assert.equal(faces.none.label, 'ACKS-BATTLEMAP.nav.face {"system":"ACKS-BATTLEMAP.nav.none"}');
  // A value the vocabulary does not know reads as none, as the record's reader rules.
  assert.equal(sceneSystemFace(makeScene("f5", { mapSystem: "orbit" })).key, "none");
  assert.equal(new Set(Object.values(SYSTEM_GLYPHS)).size, 4, "four faces, each its own glyph");
});

/* -------------------------------------------- */
/*  Render                                      */
/* -------------------------------------------- */

ok("a GM's root gets one icon per scene card, none on a level row, drawn once per render", () => {
  makeScene("s1", { mapSystem: "delve" });
  makeScene("s2");
  const root = navRoot(["s1", "s2"], { levelOf: "s1" });
  assert.equal(decorateSceneNavigation(root), 2);
  const icons = iconsOf(root);
  assert.equal(icons.length, 2);
  const [a, b] = [iconFor(root, "s1"), iconFor(root, "s2")];
  assert.equal(a.tag, "button");
  assert.equal(a.type, "button");
  assert.equal(a.dataset.action, SCENE_SYSTEM_ACTION, "a data-action of its own, so core's viewScene is not the nearest");
  assert.equal(a.dataset.system, "delve");
  assert.equal(a.dataset.tooltip, "ACKS-BATTLEMAP.nav.tip.delve", "the tooltip is a lang key for core's manager");
  assert.equal(a.getAttribute("aria-label"), 'ACKS-BATTLEMAP.nav.face {"system":"ACKS-BATTLEMAP.system.delve"}');
  assert.equal(a.getAttribute("aria-haspopup"), "menu");
  assert.equal(a.attrs.title, undefined, "never a title attribute");
  assert.equal(a.children[0].className, "fa-solid fa-dungeon");
  assert.equal(a.children[0].getAttribute("inert"), "");
  assert.equal(b.dataset.system, "none");
  assert.equal(b.children[0].className, "fa-solid fa-circle-question");
  assert.ok(!a.closest(".scene").dataset.levelId, "the icon sits on the scene's card");
  assert.equal(root.querySelectorAll(".scene-level").length, 1);
  assert.equal(root.querySelector(".scene-level").querySelectorAll(`.${SCENE_SYSTEM_CLASS}`).length, 0, "the level row carries no icon");
  // Core re-renders the navigation on every scene update: the icons are replaced, not doubled.
  assert.equal(decorateSceneNavigation(root), 2);
  assert.equal(iconsOf(root).length, 2);
  assert.ok(iconFor(root, "s1") !== a, "a fresh control each render");
});

ok("a card whose scene is unknown gets no icon", () => {
  const root = navRoot(["nowhere"]);
  assert.equal(decorateSceneNavigation(root), 0);
  assert.equal(iconsOf(root).length, 0);
});

ok("the picker binds once to the root, by click, at the icon, and not twice", () => {
  const root = navRoot(["s1"]);
  menus.length = 0;
  assert.equal(bindScenePicker(root), true);
  assert.equal(bindScenePicker(root), false);
  assert.equal(menus.length, 1);
  const menu = menus[0];
  assert.equal(menu.container, root);
  assert.equal(menu.selector, `.${SCENE_SYSTEM_CLASS}`);
  assert.equal(menu.options.eventName, "click");
  assert.equal(menu.options.fixed, true);
  assert.equal(menu.options.relative, "target");
  assert.equal(menu.options.jQuery, false);
  assert.deepEqual(menu.menuItems, []);
});

ok("the render hook draws and binds; a second render of the same root binds nothing new", () => {
  installSceneNavigation();
  const render = hooks.get("renderSceneNavigation");
  assert.equal(render?.length, 1);
  const root = navRoot(["s1", "s2"]);
  menus.length = 0;
  render[0]({}, root);
  assert.equal(iconsOf(root).length, 2);
  assert.equal(menus.length, 1);
  render[0]({}, [root]);
  assert.equal(iconsOf(root).length, 2, "a root handed as a jQuery-like array is the same root");
  assert.equal(menus.length, 1);
  render[0]({}, null);
  assert.equal(menus.length, 1, "no root, nothing drawn, nothing thrown");
});

/* -------------------------------------------- */
/*  Pick                                        */
/* -------------------------------------------- */

await okAsync("the picker offers the three systems with the declared one marked, and the clearing entry only where one is declared", async () => {
  const declared = makeScene("p1", { mapSystem: "journey", autoScale: true });
  const silent = makeScene("p2");
  const root = navRoot(["p1", "p2"]);
  decorateSceneNavigation(root);
  menus.length = 0;
  bindScenePicker(root);
  const menu = menus[0];

  menu.options.onOpen(iconFor(root, "p1"));
  const labels = menu.menuItems.map((e) => e.label);
  assert.deepEqual(labels, ["ACKS-BATTLEMAP.system.delve", "ACKS-BATTLEMAP.system.journey", "ACKS-BATTLEMAP.system.settlement", "ACKS-BATTLEMAP.setup.systemNone"]);
  assert.deepEqual(menu.menuItems.map((e) => e.classes), ["", `${SCENE_SYSTEM_CLASS}-current`, "", undefined]);
  assert.equal(menu.menuItems[3].visible, true, "a declared map can be cleared");
  assert.ok(menu.menuItems.every((e) => e.icon.startsWith("fa-solid fa-")));

  // Picking a system writes the whole record with the new system, the rest kept.
  await menu.menuItems[2].onClick();
  assert.deepEqual(declared.writes, [{ key: "battlemap", value: { mapSystem: "settlement", autoScale: true } }]);
  assert.equal(sceneSetup(declared).mapSystem, "settlement");
  // Picking the one it already declares writes nothing.
  await menu.menuItems[2].onClick();
  assert.equal(declared.writes.length, 1);
  // The clearing entry writes null.
  await menu.menuItems[3].onClick();
  assert.deepEqual(declared.writes[1], { key: "battlemap", value: { mapSystem: null, autoScale: true } });
  assert.equal(sceneSetup(declared).mapSystem, null);

  menu.options.onOpen(iconFor(root, "p2"));
  assert.equal(menu.menuItems[3].visible, false, "an undeclared map offers nothing to clear");
  assert.deepEqual(menu.menuItems.map((e) => e.classes), ["", "", "", undefined], "nothing marked");
  await menu.menuItems[0].onClick();
  assert.deepEqual(silent.writes, [{ key: "battlemap", value: { mapSystem: "delve" } }]);

  // An icon on no card, or a card of no scene, opens an empty picker rather than throwing.
  menu.options.onOpen(el("button"));
  assert.deepEqual(menu.menuItems, []);
});

/* -------------------------------------------- */
/*  Clear                                       */
/* -------------------------------------------- */

await okAsync("a right click on the icon clears the declaration and keeps the event from the card", async () => {
  const scene = makeScene("c1", { mapSystem: "delve", calibrated: true });
  const root = navRoot(["c1"]);
  decorateSceneNavigation(root);
  const icon = iconFor(root, "c1");
  const event = { defaultPrevented: false, propagationStopped: false, preventDefault() { this.defaultPrevented = true; }, stopPropagation() { this.propagationStopped = true; } };
  icon.dispatch("contextmenu", event);
  assert.equal(event.defaultPrevented, true, "the browser's menu is kept off");
  assert.equal(event.propagationStopped, true, "core's scene menu on the card is kept off");
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(scene.writes, [{ key: "battlemap", value: { mapSystem: null, calibrated: true } }]);
  assert.equal(sceneSetup(scene).mapSystem, null);
  // A second right click on a map that declares nothing writes nothing.
  icon.dispatch("contextmenu", event);
  await new Promise((r) => setImmediate(r));
  assert.equal(scene.writes.length, 1);
});

/* -------------------------------------------- */
/*  The writer                                  */
/* -------------------------------------------- */

await okAsync("the writer refuses what the scene already says, and writes a value outside the vocabulary as null", async () => {
  const scene = makeScene("w1", { mapSystem: "journey" });
  assert.equal(await writeSceneSystem(scene, "journey"), null);
  assert.equal(scene.writes.length, 0);
  assert.equal(await writeSceneSystem(scene, "delve"), scene);
  assert.equal(await writeSceneSystem(scene, "orbit"), scene, "an unknown word clears, which is what the read makes of it");
  assert.equal(sceneSetup(scene).mapSystem, null);
  assert.equal(await writeSceneSystem(scene, "orbit"), null, "and clears nothing twice");
  assert.equal(scene.writes.length, 2);
  // A write that fails is reported, not thrown through the click.
  const broken = makeScene("w2");
  broken.setFlag = async () => { throw new Error("offline"); };
  const errors = [];
  const orig = console.error;
  console.error = (...args) => errors.push(args);
  try {
    assert.equal(await declareSceneSystem(broken, "delve"), null);
  } finally {
    console.error = orig;
  }
  assert.equal(errors.length, 1);
  assert.match(String(errors[0][0]), /scene system write failed/);
});

/* -------------------------------------------- */
/*  The GM gate                                 */
/* -------------------------------------------- */

await okAsync("a player's root gets no icon and no picker, and the writer refuses a player", async () => {
  game.user.isGM = false;
  try {
    const scene = makeScene("g1", { mapSystem: "delve" });
    const root = navRoot(["g1"]);
    menus.length = 0;
    assert.equal(decorateSceneNavigation(root), 0);
    assert.equal(iconsOf(root).length, 0);
    const render = hooks.get("renderSceneNavigation")[0];
    render({}, root);
    assert.equal(iconsOf(root).length, 0);
    assert.equal(menus.length, 0, "nothing to click, nothing bound");
    assert.equal(await declareSceneSystem(scene, "journey"), null);
    assert.equal(await declareSceneSystem(scene, null), null);
    assert.equal(scene.writes.length, 0);
    assert.equal(sceneSetup(scene).mapSystem, "delve");
  } finally {
    game.user.isGM = true;
  }
});

/* -------------------------------------------- */
/*  The session follows                         */
/* -------------------------------------------- */

ok("the setup session follows the viewed scene's declared system, and nothing else", () => {
  const scene = makeScene("v1", { mapSystem: "delve" });
  const other = makeScene("v2", { mapSystem: "settlement" });
  const session = { sceneId: "v1", mapSystem: null, sets: [], setSetup(patch) { this.sets.push(patch); if (patch.mapSystem !== undefined) this.mapSystem = patch.mapSystem; } };
  const flagChange = { flags: { [MODULE_ID]: { battlemap: { mapSystem: "delve" } } } };
  assert.equal(sessionFollowsScene(session, other, flagChange), false, "another scene's change");
  assert.equal(sessionFollowsScene(session, scene, { name: "x" }), false, "a change outside the record");
  assert.equal(sessionFollowsScene(session, scene, flagChange), true);
  assert.deepEqual(session.sets, [{ mapSystem: "delve" }]);
  assert.equal(sessionFollowsScene(session, scene, flagChange), false, "already held");
  scene.flags[MODULE_ID].battlemap.mapSystem = null;
  assert.equal(sessionFollowsScene(session, scene, flagChange), true, "cleared on the scene, cleared in the session");
  assert.deepEqual(session.sets[1], { mapSystem: null });
  assert.equal(sessionFollowsScene(null, scene, flagChange), false, "no session, nothing to move");
  // The viewed scene is not this one.
  session.sceneId = "elsewhere";
  assert.equal(sessionFollowsScene(session, scene, flagChange), false);
});

console.log(`\n${passed} scene-nav checks passed`);
