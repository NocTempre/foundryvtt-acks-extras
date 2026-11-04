/**
 * The skill audit's whole-party roll (scripts/formation/audit-roll.mjs) and the
 * evaluator under it (`evaluateThrow` in scripts/abilities/ability-rolls.mjs).
 *
 * Stand-in actors, items, Roll and chat: what this pins is that one ability
 * rolled for the party posts ONE card, a row to each holder, that a member who
 * did not roll is named with the reason, that a party where nobody holds the
 * ability still posts a card saying so and throws no dice, and that the
 * evaluator posts nothing while `rollAbility` still posts exactly once. Every
 * figure is invented, and the dice are supplied here. Who is shown the card
 * live, and the control's behaviour in the window, are the live recipe's
 * (docs/formation/TESTING.md).
 */
import assert from "node:assert/strict";
import fs from "node:fs";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

/* --- the real strings, so a key that does not exist fails here ------------- */
const LANG = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const lookup = (key) => {
  if (key in LANG) return LANG[key];
  const [root, ...rest] = key.split(".");
  return rest.reduce((at, part) => at?.[part], LANG[root]);
};
const format = (key, data = {}) => {
  const text = lookup(key);
  assert.equal(typeof text, "string", `lang key ${key} exists`);
  return text.replace(/\{(\w+)\}/g, (_, name) => String(data[name] ?? ""));
};

/* --- stand-ins -------------------------------------------------------------- */
const GM = { id: "gm1", isGM: true };
const GM2 = { id: "gm2", isGM: true };
const PLAYER = { id: "pl1", isGM: false };

/** What the stand-ins recorded, and the dice they will throw (a natural 1d20 each, in order). */
const seen = { created: [], formulas: [], toMessage: 0, dice: [], warned: [] };
const dice = [];
const reset = () => {
  seen.created.length = 0;
  seen.formulas.length = 0;
  seen.toMessage = 0;
  seen.dice.length = 0;
  seen.warned.length = 0;
  dice.length = 0;
};

globalThis.game = {
  user: GM,
  users: [GM, GM2, PLAYER],
  i18n: { localize: (k) => format(k), format },
  settings: { get: () => ({}) },
  dice3d: { showForRoll: async (...args) => { seen.dice.push(args); } },
  actors: new Map(),
};
globalThis.ui = { notifications: { info() {}, warn: (m) => seen.warned.push(m), error() {} } };
globalThis.Hooks = { on() {}, once() {}, off() {}, call() {}, callAll() {} };
globalThis.Roll = class {
  static validate() { return true; }
  constructor(formula) {
    this.formula = formula;
    seen.formulas.push(formula);
  }
  async evaluate() {
    const extra = [...this.formula.matchAll(/([+-])\s*(\d+)/g)].reduce((n, [, sign, num]) => n + (sign === "-" ? -1 : 1) * Number(num), 0);
    this.total = (dice.shift() ?? 10) + extra;
    return this;
  }
  async render() { return `<div class="dice-roll">${this.total}</div>`; }
  async toMessage() { seen.toMessage++; }
};
globalThis.ChatMessage = {
  getSpeaker: ({ actor }) => ({ alias: actor?.name }),
  create: async (data) => { seen.created.push(data); return data; },
};
class Stub {}
globalThis.foundry = {
  abstract: { DataModel: class {}, TypeDataModel: class {} },
  data: { regionBehaviors: { RegionBehaviorType: Stub }, fields: {} },
  utils: {
    escapeHTML: (s) => String(s),
    deepClone: (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
  },
  applications: {
    api: { ApplicationV2: Stub, HandlebarsApplicationMixin: (B) => B, DialogV2: Stub },
    handlebars: { renderTemplate: async () => "<section>card</section>" },
  },
};

const { rollAbilityForParty } = await import("../scripts/formation/audit-roll.mjs");
const { evaluateThrow, rollAbility } = await import("../scripts/abilities/ability-rolls.mjs");
const { renderRollCard } = await import("../scripts/lib/roll-card.mjs");
const { PARTY_CHECKS, boundChecks, resolveCheck, rollCheckFor } = await import("../scripts/formation/party-rolls.mjs");

/* --- fixtures ---------------------------------------------------------------- */
/** A throw as an ability stores it: a flat target, optionally of another kind. */
const throwOf = (flat, extra = {}) => ({
  key: "primary", label: "", formula: "1d20", rollType: "above", target: { kind: "flat", flat }, scale: "level", ...extra,
});

/**
 * An actor holding abilities: `{name, rolls, effects, system, flags}` each.
 * `rolls` is the ability's stored throws; `effects` its modifiers on other
 * abilities; `system` the sheet fields a party check reads (`rollTarget`);
 * `flags` this module's item flags (`targetMod`, `isSkill`, ...).
 */
function actor(id, abilities = [], { hp = 5, level = 3 } = {}) {
  const a = { id, name: id, img: `${id}.webp`, system: { hp: { value: hp }, details: { level } }, items: [] };
  for (const spec of abilities) {
    const flags = { "acks-extras": { extras: { rolls: spec.rolls ?? [], effects: spec.effects ?? [] }, ...spec.flags } };
    a.items.push({
      type: "ability",
      name: spec.name,
      actor: a,
      system: spec.system ?? {},
      flags,
      getFlag: (scope, key) => flags[scope]?.[key],
    });
  }
  game.actors.set(id, a);
  return a;
}
const party = (...ids) => ({ id: "f1", name: "The Company", members: ids.map((actorId) => ({ actorId })) });
const SEARCH = { key: "name:searching", name: "Searching" };

/* ---------------------------------------------------------------------------- */

await ok("several members roll: one card, one row each, with the dice and the verdicts", async () => {
  reset();
  actor("Alder", [{ name: "Searching", rolls: [throwOf(15)] }]);
  actor("Birch", [{ name: "Searching", rolls: [throwOf(12)] }]);
  dice.push(16, 5);
  const result = await rollAbilityForParty(party("Alder", "Birch"), SEARCH);
  assert.equal(result.rolled, 2);
  assert.equal(seen.created.length, 1, "one message for the whole party");
  const msg = seen.created[0];
  assert.deepEqual(msg.whisper, ["gm1", "gm2"], "whispered to the Judges, as a party check is");
  assert.deepEqual(msg.rolls, [], "no roll attached: the card states its own totals");
  assert.equal(seen.dice.length, 2, "the dice are shown to the Judges");
  assert.deepEqual(seen.dice[0].slice(3), [["gm1", "gm2"], false]);
  assert.match(msg.content, /<h3 class="acks-chat-title">Searching<\/h3>/);
  assert.match(msg.content, /The Company/);
  const rows = msg.content.match(/<tr class="is-(success|failure)">/g);
  assert.deepEqual(rows, ['<tr class="is-success">', '<tr class="is-failure">']);
  assert.match(msg.content, /<td>Alder[\s\S]*?<td class="acks-nums"[^>]*>16<\/td><td class="acks-nums"[^>]*>15\+<\/td><td><strong>Success/);
  assert.match(msg.content, /<td>Birch[\s\S]*?<td class="acks-nums"[^>]*>5<\/td><td class="acks-nums"[^>]*>12\+<\/td><td>Failure/);
  assert.equal(msg.content.includes("acks-extras-roll-footnote"), false, "everyone rolled, so no footnote");
  assert.equal(seen.toMessage, 0, "the evaluator posts no card of its own");
});

await ok("a member without the skill is named in the footnote and rolls nothing", async () => {
  reset();
  actor("Alder", [{ name: "Searching", rolls: [throwOf(15)] }]);
  actor("Cedar", [{ name: "Climbing", rolls: [throwOf(10)] }]);
  dice.push(11);
  const result = await rollAbilityForParty(party("Alder", "Cedar"), SEARCH);
  assert.equal(result.rolled, 1);
  assert.deepEqual(result.lacking, ["Cedar"]);
  assert.equal(seen.formulas.length, 1, "one die thrown, not two");
  const html = seen.created[0].content;
  assert.match(html, /<p class="acks-extras-roll-footnote">No roll, does not have it: Cedar\.<\/p>/);
  assert.equal(html.includes("<td>Cedar"), false, "no row for a member who made no roll");
});

await ok("nobody holds it: one card saying nobody rolled, and no die is thrown", async () => {
  reset();
  actor("Cedar", [{ name: "Climbing", rolls: [throwOf(10)] }]);
  actor("Dune", []);
  const result = await rollAbilityForParty(party("Cedar", "Dune"), SEARCH);
  assert.equal(result.rolled, 0);
  assert.deepEqual(result.lacking, ["Cedar", "Dune"]);
  assert.equal(seen.formulas.length, 0, "no throw");
  assert.equal(seen.created.length, 1, "the card is posted all the same");
  const msg = seen.created[0];
  assert.deepEqual(msg.whisper, ["gm1", "gm2"]);
  assert.match(msg.content, /Nobody rolled Searching\./);
  assert.match(msg.content, /No roll, does not have it: Cedar, Dune\./);
  assert.equal(msg.content.includes("<table"), false);
  assert.equal(seen.dice.length, 0);
});

await ok("an empty party still posts the card", async () => {
  reset();
  const result = await rollAbilityForParty(party(), SEARCH);
  assert.equal(result.rolled, 0);
  assert.equal(seen.created.length, 1);
  assert.match(seen.created[0].content, /Nobody rolled Searching\./);
  assert.equal(seen.created[0].content.includes("roll-footnote"), false);
});

await ok("the target's tooltip itemizes the base and the bonuses from the actor's own abilities", async () => {
  reset();
  const bonus = { type: "modifier", target: "proficiencyThrow", forWhat: "Searching", value: { flat: 2 } };
  actor("Alder", [
    { name: "Searching", rolls: [throwOf(15)] },
    { name: "Keen Eyes", effects: [bonus] },
  ]);
  dice.push(13);
  await rollAbilityForParty(party("Alder"), SEARCH);
  const html = seen.created[0].content;
  assert.match(html, /<td class="acks-nums" data-tooltip-text="Target 13\+: Searching gives 15\+, with bonuses other abilities \+2\.">13\+<\/td>/);
  assert.match(html, /<td class="acks-nums" data-tooltip="1d20">13<\/td>/, "the total carries its dice");
});

await ok("a bonus-free target says so, and a target that wants a low total reads that way", async () => {
  reset();
  actor("Alder", [{ name: "Searching", rolls: [throwOf(4, { rollType: "below" })] }]);
  dice.push(3);
  await rollAbilityForParty(party("Alder"), SEARCH);
  const html = seen.created[0].content;
  assert.match(html, /data-tooltip-text="Target 4-: Searching gives 4-, no bonuses\.">4-<\/td>/);
  assert.match(html, /<td><strong>Success/, "a low total meets a below target");

  // A bonus raises a below target, so the base is the target less the bonus.
  reset();
  const bonus = { type: "modifier", target: "proficiencyThrow", forWhat: "Searching", value: { flat: 1 } };
  actor("Alder", [{ name: "Searching", rolls: [throwOf(4, { rollType: "below" })] }, { name: "Keen Eyes", effects: [bonus] }]);
  dice.push(5);
  await rollAbilityForParty(party("Alder"), SEARCH);
  assert.match(seen.created[0].content, /data-tooltip-text="Target 5-: Searching gives 4-, with bonuses other abilities \+1\.">5-<\/td>/);
});

await ok("a member who is down is named, not rolled; an ability with no throw is named too", async () => {
  reset();
  actor("Alder", [{ name: "Searching", rolls: [throwOf(15)] }]);
  actor("Elm", [{ name: "Searching", rolls: [throwOf(15)] }], { hp: 0 });
  actor("Fir", [{ name: "Searching", rolls: [] }]);
  dice.push(14);
  const result = await rollAbilityForParty(party("Alder", "Elm", "Fir"), SEARCH);
  assert.equal(result.rolled, 1);
  assert.deepEqual([result.down, result.noThrow], [["Elm"], ["Fir"]]);
  const html = seen.created[0].content;
  assert.match(html, /No roll, the ability offers no throw: Fir\. No roll, down: Elm\./);
});

await ok("a throw that cannot be rolled is named and does not lose the others", async () => {
  reset();
  actor("Alder", [{ name: "Searching", rolls: [throwOf(15)] }]);
  const broken = actor("Gum", [{ name: "Searching", rolls: [throwOf(15)] }]);
  Object.defineProperty(broken.items[0], "actor", { get() { throw new Error("broken copy"); } });
  const logged = console.error;
  console.error = () => {};
  dice.push(15);
  let result;
  try {
    result = await rollAbilityForParty(party("Gum", "Alder"), SEARCH);
  } finally {
    console.error = logged;
  }
  assert.equal(result.rolled, 1);
  assert.deepEqual(result.failed, ["Gum"]);
  assert.match(seen.created[0].content, /No roll, the throw could not be rolled: Gum\./);
});

await ok("evaluateThrow posts nothing and reports the target, base and parts; rollAbility still posts once", async () => {
  reset();
  const bonus = { type: "modifier", target: "proficiencyThrow", forWhat: "Searching", value: { flat: 1 } };
  const a = actor("Alder", [
    { name: "Searching", rolls: [throwOf(15)] },
    { name: "Keen Eyes", effects: [bonus] },
  ]);
  dice.push(14);
  const ev = await evaluateThrow(a.items[0]);
  assert.deepEqual(
    [ev.outcome, ev.total, ev.target, ev.base, ev.success, ev.modifiers.map((p) => [p.kind, p.value])],
    ["throw", 14, 14, 15, true, [["abilities", 1]]],
  );
  assert.equal(seen.toMessage + seen.created.length, 0, "the evaluator posts nothing");

  dice.push(9);
  const posted = await rollAbility(a.items[0], undefined, { skipDialog: true });
  assert.equal(seen.toMessage, 1, "rollAbility posts one message");
  assert.deepEqual([posted.total, posted.target, posted.success], [9, 14, false]);
});

await ok("a row a party check takes rolls the check's resolved target, parts itemized, the same the table resolves", async () => {
  reset();
  const keen = { name: "Alertness", system: { rollTarget: 0 } };
  const a = actor("Alder", [
    { name: "Searching", rolls: [throwOf(15)], system: { rollTarget: 15 }, flags: { targetMod: 1 } },
    keen,
  ]);
  const hasty = PARTY_CHECKS.searchHasty;
  assert.equal(boundChecks(a.items[0])[0].checkKey, "searchHasty", "the first check in table order that takes the item");
  const table = resolveCheck(a, hasty);
  assert.equal(table.target, 14, "the table's figure: the sheet target less the throw bonus");
  assert.deepEqual(table.parts.map((p) => p.value), [2]);

  dice.push(11);
  const result = await rollAbilityForParty(party("Alder"), SEARCH);
  assert.equal(result.rolled, 1);
  assert.equal(seen.formulas[0], "1d20 + 2", "the check's bonus rides the die, as the party card's does");
  const html = seen.created[0].content;
  assert.match(html, /data-tooltip-text="Target 14\+: Searching \(L3\) \[\+1\]; \+2 Alertness\.">14\+<\/td>/);
  assert.match(html, /<td class="acks-nums"[^>]*>13<\/td>/, "11 and the +2");
  assert.match(html, /Rolled as the party check: Hasty Search\./);
  // The card's row is the party card's row for the same member and die.
  dice.push(11);
  const direct = await rollCheckFor(a, hasty);
  assert.deepEqual([direct.row.target, direct.row.total, direct.row.source], [table.target, 13, "Searching (L3) [+1]; +2 Alertness"]);
});

await ok("an unbound row keeps the ability's own throw and says nothing of a party check", async () => {
  reset();
  const a = actor("Alder", [{ name: "Lore", rolls: [throwOf(13)], system: { rollTarget: 13 } }]);
  assert.deepEqual(boundChecks(a.items[0]), [], "no party check takes it");
  dice.push(12);
  await rollAbilityForParty(party("Alder"), { key: "name:lore", name: "Lore" });
  const html = seen.created[0].content;
  assert.match(html, /data-tooltip-text="Target 13\+: Lore gives 13\+, no bonuses\.">13\+<\/td>/);
  assert.equal(html.includes("Rolled as the party check"), false);
});

await ok("a bound ability the check cannot be made from is named, and the others still roll", async () => {
  reset();
  actor("Alder", [{ name: "Searching", rolls: [throwOf(9)], system: { rollTarget: 15 } }]);
  actor("Birch", [{ name: "Searching", rolls: [throwOf(9)], system: { rollTarget: 15 }, flags: { isSkill: false } }]);
  dice.push(15);
  const result = await rollAbilityForParty(party("Alder", "Birch"), SEARCH);
  assert.deepEqual([result.rolled, result.cannot], [1, ["Birch"]]);
  assert.match(seen.created[0].content, /No roll, cannot attempt the party check: Birch\./);
});

await ok("an ability with no throw evaluates to null", async () => {
  reset();
  const a = actor("Alder", [{ name: "Searching", rolls: [] }]);
  assert.equal(await evaluateThrow(a.items[0]), null);
});

await ok("a card with no rows is empty unless it is given something to say", () => {
  assert.equal(renderRollCard({ title: "T", sections: [{ rows: [] }] }), "");
  assert.equal(renderRollCard({ title: "T", sections: [{ rows: [] }], footnote: "f" }), "");
  const html = renderRollCard({ title: "T", sections: [{ rows: [] }], empty: "none", footnote: "f" });
  assert.match(html, /<p class="acks-extras-roll-note">none<\/p>/);
  assert.match(html, /<p class="acks-extras-roll-footnote">f<\/p>/);
});

console.log(`\n${passed} passed`);
