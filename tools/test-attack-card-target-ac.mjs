/**
 * The attack card's line naming a condition inside a character target's Armor
 * Class (scripts/lib/attack-card-target-ac.mjs, and the seam's hold and stamp in
 * scripts/lib/patches/attack-throw.mjs).
 *
 * Stand-in actors, effects, a libWrapper that keeps the wrappers it is given and
 * a small DOM. What this pins is the procedure: which steps become rows, that
 * the rows are read at the roll and stamped on a card of the system's making
 * (an Apply or none, a spell's carrier) and on no other, and that the line is
 * drawn from the stamp, twice over, once, with the two visibility spans the
 * system's chat message prunes. That the system's chat message prunes the span
 * a viewer may not see, and that the footer shows in the Chat tab, is the live
 * walk's. Every figure comes from the invented-value fixture.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

let passed = 0;
const ok = async (name, fn) => {
  await fn();
  passed++;
  console.log("ok   " + name);
};

const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const format = (key, data = {}) => (LANG[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => data[n] ?? "");

/* --- A small DOM ------------------------------------------------------------------ */

const camel = (name) => name.replace(/^data-/, "").replace(/-(\w)/g, (_, c) => c.toUpperCase());

class Node {
  constructor(tag) {
    this.nodeType = 1;
    this.tag = tag;
    this.className = "";
    this.dataset = {};
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.textContent = "";
  }

  get childElementCount() { return this.children.length; }

  append(...nodes) {
    for (const node of nodes) {
      node.parent = this;
      this.children.push(node);
    }
  }

  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }

  setAttribute(name, value) { this.attrs[name] = value; }

  matches(selector) {
    const cls = /^\.([\w-]+)$/.exec(selector);
    if (cls) return this.className.split(/\s+/).includes(cls[1]);
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(selector);
    if (!attr) throw new Error(`the mock DOM does not read ${selector}`);
    const value = attr[1] in this.attrs ? this.attrs[attr[1]] : this.dataset[camel(attr[1])];
    return attr[2] === undefined ? value !== undefined : value === attr[2];
  }

  querySelectorAll(selector) {
    return this.children.flatMap((c) => [...(c.matches(selector) ? [c] : []), ...c.querySelectorAll(selector)]);
  }

  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
}

globalThis.document = { createElement: (tag) => new Node(tag) };

/** A card as the system renders it: a section with a header, and a footer when it has choice labels. */
const cardOf = ({ footer = false } = {}) => {
  const root = new Node("div");
  const section = new Node("section");
  section.className = "acksii chat-card attack-throw-card";
  section.append(Object.assign(new Node("header"), { className: "card-header" }));
  if (footer) {
    const f = new Node("footer");
    f.className = "attack-throw-card__footer";
    f.append(Object.assign(new Node("span"), { textContent: "a choice" }));
    section.append(f);
  }
  root.append(section);
  return root;
};

/** What the system's chat message does after the render hooks: removes the span the viewer may not see. */
const prune = (root, removed) => root.querySelectorAll(`[data-acks-visibility="${removed}"]`).forEach((n) => n.remove());

/* --- Globals ---------------------------------------------------------------------- */

const noop = function () {};
const registered = {};
const hooks = {};
let speaker = null;
globalThis.game = {
  system: { id: "acks" },
  user: { targets: [] },
  i18n: { format, localize: (k) => LANG[k] ?? k, has: () => false, translations: {} },
};
globalThis.libWrapper = { register: (_id, path, fn) => { registered[path] = fn; } };
globalThis.Hooks = { callAll: noop, on: (name, fn) => (hooks[name] ??= []).push(fn) };
globalThis.ui = { notifications: { warn: noop, info: noop } };
globalThis.Roll = { validate: () => true };
globalThis.ChatMessage = { getSpeakerActor: () => speaker };

class FakeItem {
  constructor(data, { parent } = {}) {
    this.name = data.name;
    this.type = data.type;
    this.parent = parent;
    this.flags = data.flags ?? {};
    this.system = { parent: this, ...data.system, getDamageFormula() { return ""; }, getDamageModifiers() { return []; } };
  }
}

const { CONDITION_KEYS, actorOf, conditionValue, coreConditions, effectOf, implyingEffect } = await import("./core-conditions-fixture.mjs");
globalThis.CONFIG = {
  ACKS: { conditions: coreConditions() },
  Actor: {
    documentClass: { prototype: { makeAttackThrow: noop } },
    dataModels: { character: { prototype: { getAttackThrowModifiers: noop, getDamageModifiers: noop } } },
  },
  Item: {
    documentClass: FakeItem,
    dataModels: { weapon: { prototype: { getAttackTypes: noop, getDamageModes: noop, getDamageFormula: noop } } },
  },
};

const seam = await import("../scripts/lib/patches/attack-throw.mjs");
const card = await import("../scripts/lib/attack-card-target-ac.mjs");
const { CONDITION_STEP_KEYS } = await import("../scripts/lib/roll-mods.mjs");
const { TARGET_AC_FLAG } = seam;
const { TARGET_AC_CLASS, TARGET_AC_VISIBILITY, targetAcLine, targetAcRows } = card;

const AC = CONDITION_STEP_KEYS.ac;
const FLAG_PATH = `flags.acks-extras.${TARGET_AC_FLAG}`;
const waiverRow = (...conditions) => ({ type: "ability", flags: { "acks-extras": { extras: { effects: [{ type: "modifier", target: "acWaiver", conditions }] } } } });
const character = (effects, name = "Target Person", extra = {}) => actorOf("character", effects, { extra: { name, ...extra } });
const monster = (effects) => actorOf("monster", effects);
const step = (id) => conditionValue(id, AC);
/** A condition's name as the card says it. */
const cond = (id) => LANG[`ACKS-LIB.condition.${id}`];
/** A row's name where the effect's own name differs from its condition's. */
const named = (effect, id) => format("ACKS-LIB.conditionRoll.targetAc.named", { effect, condition: cond(id) });

/* --- The rows --------------------------------------------------------------------- */

await ok("a character target's rows are its condition effects' names, with the condition's where the two differ, and the step each makes", () => {
  const target = character([effectOf("disordered", { name: "Fx One" }), effectOf("shaken", { name: "Fx Two" })]);
  assert.deepEqual(targetAcRows(target), [{ name: named("Fx One", "disordered"), value: step("disordered") }, { name: named("Fx Two", "shaken"), value: step("shaken") }]);
  assert.ok(named("Fx One", "disordered").startsWith("Fx One (") && named("Fx One", "disordered").includes(cond("disordered")));
  // An effect named as its condition is named once.
  assert.deepEqual(targetAcRows(character([effectOf("disordered", { name: cond("disordered") })])), [{ name: cond("disordered"), value: step("disordered") }]);
});

await ok("a step as it stands in the effect keeps its sign, and an effect with no name is named by its condition", () => {
  const target = character([effectOf("disordered", { name: "", changes: [{ key: AC, type: "add", value: -9 }] })]);
  assert.deepEqual(targetAcRows(target), [{ name: cond("disordered"), value: -9 }]);
});

await ok("a state that brings a condition has one row named for both, and the condition set twice has one row", () => {
  const charge = implyingEffect("charging", { name: cond("charging") });
  assert.deepEqual(targetAcRows(character([charge])), [{ name: named(cond("charging"), "disordered"), value: step("disordered") }]);
  for (const order of [[charge, effectOf("disordered", { name: "Hand" })], [effectOf("disordered", { name: "Hand" }), charge]]) {
    const rows = targetAcRows(character(order));
    assert.equal(rows.length, 1, "counted once, as core's own preparation counts it");
    assert.equal(rows[0].value, step("disordered"));
    assert.ok(rows[0].name.startsWith(order[0].name));
  }
});

await ok("a monster, a null actor and an actor of another type have no rows: a monster's steps are terms on the throw", () => {
  assert.deepEqual(targetAcRows(monster([effectOf("disordered")])), []);
  assert.deepEqual(targetAcRows(null), []);
  assert.deepEqual(targetAcRows(actorOf("group", [effectOf("disordered")])), []);
});

await ok("an effect that moves Armor Class but carries no condition status has no row", () => {
  const hand = effectOf("disordered", { statuses: [], name: "Hand Effect" });
  const plain = effectOf("restrained", { name: "Plain Core", changes: [{ key: AC, type: "add", value: 5 }] });
  assert.deepEqual(targetAcRows(character([hand, plain])), []);
  assert.deepEqual(targetAcRows(character([hand, effectOf("shaken", { name: "Real" })])).map((r) => r.name), [named("Real", "shaken")]);
});

await ok("a step the Armor Class waiver spares is still listed, since the system's effect folded it into the Armor Class shown; a disabled effect makes none", () => {
  assert.ok(CONDITION_KEYS.disordered.includes(AC) && CONDITION_KEYS.shaken.includes(AC));
  const waived = character([effectOf("disordered", { name: "Spared" }), effectOf("shaken", { name: "Kept" })], "Target Person", { items: [waiverRow("disordered")] });
  assert.deepEqual(targetAcRows(waived), [
    { name: named("Kept", "shaken"), value: step("shaken") },
    { name: named("Spared", "disordered"), value: step("disordered") },
  ]);
  assert.deepEqual(targetAcRows(character([effectOf("disordered", { disabled: true })])), []);
});

await ok("a waived charge's disorder is listed once, on the charging effect", () => {
  const charge = implyingEffect("charging", { name: cond("charging") });
  const waived = character([charge], "Target Person", { items: [waiverRow("charging")] });
  assert.deepEqual(targetAcRows(waived), [{ name: named(cond("charging"), "disordered"), value: step("disordered") }]);
});

/* --- The line --------------------------------------------------------------------- */

const stamp = { target: "Ghoul Token", rows: [{ name: "Fx One", value: step("disordered") }, { name: "Fx Two", value: -9 }] };

await ok("the line names each condition with its signed step, and the hidden line names them alone", () => {
  const line = targetAcLine(stamp);
  assert.equal(line.shown.text, format("ACKS-LIB.conditionRoll.targetAc.line", { rows: `Fx One +${step("disordered")}, Fx Two −9` }));
  assert.equal(line.hidden.text, format("ACKS-LIB.conditionRoll.targetAc.line", { rows: "Fx One, Fx Two" }));
});

await ok("the shown tooltip names effect, target and step with the page; the hidden one carries no step", () => {
  const line = targetAcLine(stamp);
  for (const part of ["Fx One", "Fx Two", "Ghoul Token", `+${step("disordered")}`, "−9", "RR 291-303, 507-515"]) {
    assert.ok(line.shown.tip.includes(part), `shown tip names ${part}`);
  }
  assert.ok(line.hidden.tip.includes("Ghoul Token") && line.hidden.tip.includes("Fx One") && line.hidden.tip.includes("RR 291-303, 507-515"));
  assert.ok(!/\d/.test(line.hidden.tip.replace("RR 291-303, 507-515", "")), "no figure in the hidden tooltip");
});

await ok("a stamp with no usable row draws no line", () => {
  for (const bad of [null, {}, { rows: [] }, { target: "T", rows: [{ name: "A", value: "x" }] }, { target: "T", rows: [null] }]) assert.equal(targetAcLine(bad), null);
});

/* --- The hold and the stamp -------------------------------------------------------- */

const attacker = { name: "Attacker", uuid: "Actor.attacker", type: "character", system: { attack: { throw: 10 } }, getActiveTokens: () => [] };
const target = character([effectOf("disordered", { name: "Fx One" }), effectOf("shaken", { name: "Fx Two" })]);
const targetWith = (actor, name = "Ghoul Token") => ({ document: { name, actor } });
const ATTACK_CARD = '<section class="acksii chat-card attack-throw-card"><h3>Test</h3></section>';
const WITH_APPLY = '<section class="attack-throw-card"><div class="card-buttons"><button type="button" data-action="applyDamage" data-damage="4" data-target-uuid="Actor.victim">Apply</button></div></section>';

/** A message about to be created: it records what `updateSource` was given. */
const messageOf = (content) => {
  const message = { speaker: {}, content, rolls: [], updates: [] };
  message.updateSource = (update) => {
    message.updates.push(update);
    if (typeof update.content === "string") message.content = update.content;
  };
  return message;
};
const merged = (message) => Object.assign({}, ...message.updates);

/** Make an attack with `wrapped` standing in for the system's roll; `during` runs inside it, as the card's creation does. */
const attack = async (actor, targets, during, options = {}) => {
  game.user.targets = targets;
  speaker = actor;
  const wrapper = registered["CONFIG.Actor.documentClass.prototype.makeAttackThrow"];
  return wrapper.call(actor, async () => { await during(); return { done: true }; }, options);
};
const preCreate = (message) => hooks.preCreateChatMessage.forEach((fn) => fn(message));

await ok("the seam installs, and with no reader installed a card takes no stamp", async () => {
  assert.equal(seam.installAttackThrowPatch(), true);
  const message = messageOf(ATTACK_CARD);
  await attack(attacker, [targetWith(target)], () => preCreate(message));
  assert.deepEqual(message.updates, []);
});

await ok("installing the line sets the reader and hooks the render once, however often it is called", () => {
  card.installAttackCardTargetAc();
  card.installAttackCardTargetAc();
  assert.equal(hooks.renderChatMessageHTML.length, 1);
});

await ok("a card made inside an attack on a character target is stamped with the target's name and the rows read at the roll", async () => {
  const message = messageOf(ATTACK_CARD);
  await attack(attacker, [targetWith(target)], () => preCreate(message));
  assert.deepEqual(merged(message)[FLAG_PATH], { target: "Ghoul Token", rows: [{ name: named("Fx One", "disordered"), value: step("disordered") }, { name: named("Fx Two", "shaken"), value: step("shaken") }] });
});

await ok("a card with an Apply keeps the Apply's own stamp and loses the button, and a miss card with none is still stamped", async () => {
  const hit = messageOf(WITH_APPLY);
  const miss = messageOf(ATTACK_CARD);
  await attack(attacker, [targetWith(target)], () => { preCreate(hit); preCreate(miss); });
  const update = merged(hit);
  assert.ok(update[FLAG_PATH] && update["flags.acks-extras.attackApply"], "both stamps on the hit");
  assert.ok(!update.content.includes('data-action="applyDamage"'), "the system's Apply is stripped");
  assert.deepEqual(Object.keys(merged(miss)), [FLAG_PATH], "the miss card takes the one stamp and nothing else");
});

await ok("a spell carrier's attack card takes the stamp beside its cast mark", async () => {
  const carrier = seam.spellCarrier(attacker, { roll: "1d4" }, { castId: "cast1", rowKey: "row1", delivery: "melee" });
  const message = messageOf(WITH_APPLY);
  await attack(attacker, [targetWith(target)], () => preCreate(message), { item: carrier });
  const update = merged(message);
  assert.ok(update["flags.acks-extras.magicAttack"], "the carrier's own mark");
  assert.equal(update[FLAG_PATH].rows.length, 2);
  assert.ok(!update.content.includes('data-action="applyDamage"'));
});

await ok("no stamp for a monster target, a target with no condition steps, no target, or a message that is no attack card", async () => {
  const cases = [
    [[targetWith(monster([effectOf("disordered")]))], ATTACK_CARD],
    [[targetWith(character([]))], ATTACK_CARD],
    [[targetWith(character([effectOf("disordered", { statuses: [] })]))], ATTACK_CARD],
    [[], ATTACK_CARD],
    [[targetWith(target)], "<p>a plain message</p>"],
  ];
  for (const [targets, content] of cases) {
    const message = messageOf(content);
    await attack(attacker, targets, () => preCreate(message));
    assert.deepEqual(message.updates, [], JSON.stringify(content));
  }
});

await ok("what an attack held is let go with it: a card made after the roll, or by another speaker, takes no stamp", async () => {
  await attack(attacker, [targetWith(target)], noop);
  const late = messageOf(ATTACK_CARD);
  preCreate(late);
  assert.deepEqual(late.updates, []);
  const other = messageOf(ATTACK_CARD);
  await attack(attacker, [targetWith(target)], () => { speaker = { uuid: "Actor.someoneElse" }; preCreate(other); });
  assert.deepEqual(other.updates, []);
});

await ok("a nested attack by the same actor restores the outer attack's rows when it ends", async () => {
  const other = character([effectOf("blessed", { name: "Inner" })], "Other Target");
  const outer = messageOf(ATTACK_CARD);
  const inner = messageOf(ATTACK_CARD);
  await attack(attacker, [targetWith(target)], async () => {
    await attack(attacker, [targetWith(other, "Inner Token")], () => preCreate(inner));
    speaker = attacker;
    preCreate(outer);
  });
  assert.equal(merged(inner)[FLAG_PATH].target, "Inner Token");
  assert.equal(merged(outer)[FLAG_PATH].target, "Ghoul Token");
});

await ok("a reader that throws leaves the attack rolling with no stamp", async () => {
  seam.setTargetAcReader(() => { throw new Error("test reader failure"); });
  const errors = console.error;
  console.error = noop;
  try {
    const message = messageOf(ATTACK_CARD);
    const result = await attack(attacker, [targetWith(target)], () => preCreate(message));
    assert.deepEqual(result, { done: true });
    assert.deepEqual(message.updates, []);
  } finally {
    console.error = errors;
    seam.setTargetAcReader(targetAcRows);
  }
});

/* --- The markup -------------------------------------------------------------------- */

const render = (root, flag = stamp) => hooks.renderChatMessageHTML[0]({ flags: { "acks-extras": flag === null ? {} : { [TARGET_AC_FLAG]: flag } } }, root);
const spansOf = (root) => root.querySelectorAll(`.${TARGET_AC_CLASS}`);

await ok("both spans join the card's own footer, each marked for the system's visibility prune, with a tooltip as text", () => {
  const root = cardOf({ footer: true });
  render(root);
  const footer = root.querySelector(".attack-throw-card__footer");
  assert.equal(root.querySelectorAll(".attack-throw-card__footer").length, 1);
  const spans = spansOf(root);
  assert.deepEqual(spans.map((s) => s.parent), [footer, footer]);
  assert.equal(footer.children.length, 3, "the card's own choice label stays");
  assert.deepEqual(spans.map((s) => s.dataset.acksVisibility), [TARGET_AC_VISIBILITY.shown, TARGET_AC_VISIBILITY.hidden]);
  const line = targetAcLine(stamp);
  assert.deepEqual(spans.map((s) => [s.textContent, s.dataset.tooltipText]), [[line.shown.text, line.shown.tip], [line.hidden.text, line.hidden.tip]]);
  assert.ok(spans.every((s) => !("title" in s.attrs)), "core's tooltip manager, never a title");
});

await ok("a card with no footer gets one, and a second render of the same element leaves one footer and one pair", () => {
  const root = cardOf();
  render(root);
  assert.equal(root.querySelectorAll(".attack-throw-card__footer").length, 1);
  assert.equal(spansOf(root).length, 2);
  render(root);
  render(root);
  assert.equal(root.querySelectorAll(".attack-throw-card__footer").length, 1);
  assert.equal(spansOf(root).length, 2);
  const withFooter = cardOf({ footer: true });
  render(withFooter);
  render(withFooter);
  assert.equal(spansOf(withFooter).length, 2);
  assert.equal(withFooter.querySelectorAll(".attack-throw-card__footer").length, 1);
});

await ok("the viewer who may see the Armor Class reads the step, and the one who may not reads the names alone", () => {
  const line = targetAcLine(stamp);
  const seen = cardOf({ footer: true });
  render(seen);
  prune(seen, TARGET_AC_VISIBILITY.hidden);
  assert.deepEqual(spansOf(seen).map((s) => s.textContent), [line.shown.text]);
  const blind = cardOf({ footer: true });
  render(blind);
  prune(blind, TARGET_AC_VISIBILITY.shown);
  assert.deepEqual(spansOf(blind).map((s) => s.textContent), [line.hidden.text]);
});

await ok("a card with no stamp, and an element that is no attack card, are left as they are", () => {
  const plain = cardOf({ footer: true });
  render(plain, null);
  assert.equal(spansOf(plain).length, 0);
  const other = new Node("div");
  render(other);
  assert.deepEqual(other.children, []);
  assert.doesNotThrow(() => hooks.renderChatMessageHTML[0]({ flags: {} }, null));
});

console.log(`\n${passed} attack-card-target-ac checks passed.`);
