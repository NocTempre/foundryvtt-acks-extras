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
    const natural = dice.shift() ?? 10;
    this.dice = [{ results: [{ result: natural }] }];
    this.total = natural + extra;
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
const { evaluateThrow, rollAbility, rollsOf, throwOutcome } = await import("../scripts/abilities/ability-rolls.mjs");
const { registerTable, unregisterTable, PRIORITY } = await import("../scripts/lib/tables.mjs");
const { CONDITIONS_DOC, CONDITIONS_TABLE } = await import("../scripts/lib/conditions.mjs");
const { renderRollCard } = await import("../scripts/lib/roll-card.mjs");
const { FORMATION_DOC } = await import("../scripts/formation/constants.mjs");
const { THROWS_DOC, THROW_TABLE } = await import("../scripts/lib/throws.mjs");
/** An invented Strength factor, registered the way an import registers it; no page's figure. */
const STR_FACTOR = 3;
const importFactor = (tables = { bashStrengthFactor: STR_FACTOR }) =>
  registerTable({ id: FORMATION_DOC, source: "invented", tables }, { priority: PRIORITY.WORLD, source: "test" });
const { PARTY_CHECKS, boundChecks, checkTip, citedParts, citedSource, resolveCheck, rollCheckFor, rollPartyCheck, usedForOptions } = await import("../scripts/formation/party-rolls.mjs");

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
    const flags = { "acks-extras": { extras: { rolls: spec.rolls ?? [], effects: spec.effects ?? [], provides: spec.provides ?? [] }, ...spec.flags } };
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

/** An imported-shape bonus: it provides one capability and adds to throws that name another, when the character holds a third. */
const alertness = (flat = 2) => ({
  name: "Alertness",
  provides: ["kw:alertness"],
  flags: { cookbook: { id: "def.prof.alertness", cite: "XX p.1" } },
  effects: [{ type: "modifies", target: "proficiencyThrow", refs: ["kw:searching"], ifHas: ["kw:searching"], mode: "add", value: { flat } }],
});
const searching = (flat = 15, flags = {}) => ({ name: "Searching", provides: ["kw:searching"], rolls: [throwOf(flat)], system: { rollTarget: flat }, flags });

await ok("a row a party check takes rolls the check's resolved target, parts itemized, on a bare die", async () => {
  reset();
  const a = actor("Alder", [searching(15, { targetMod: 1 }), alertness()]);
  const hasty = PARTY_CHECKS.searchHasty;
  assert.equal(boundChecks(a.items[0])[0].checkKey, "searchHasty", "the first check in table order that takes the item");
  assert.deepEqual(boundChecks(a.items[1]), [], "a bonus-giving ability is not itself a check");
  const table = resolveCheck(a, hasty);
  assert.equal(table.target, 12, "the abilities' figure less the Judge's throw bonus");
  assert.equal(table.bonus, 0, "every bonus is in the target, none rides the die");
  assert.deepEqual(table.parts.map((p) => [p.label, p.value]), [["Alertness", 2], ["Throw bonus", 1]]);

  dice.push(12);
  const result = await rollAbilityForParty(party("Alder"), SEARCH);
  assert.equal(result.rolled, 1);
  assert.equal(seen.formulas[0], "1d20", "a bare die: the bonuses are in the target");
  const html = seen.created[0].content;
  assert.match(html, /data-tooltip-text="Target 12\+: Searching \[\+1\]; \+2 Alertness \(XX p\.1\), \+1 Throw bonus\.">12\+<\/td>/);
  assert.match(html, /<td class="acks-nums"[^>]*>12<\/td>/, "the die as thrown");
  assert.match(html, /Rolled as the party check: Hasty Search\./);
  // The card's row is the party card's row for the same member and die.
  dice.push(12);
  const direct = await rollCheckFor(a, hasty);
  assert.deepEqual([direct.row.target, direct.row.total, direct.row.source], [table.target, 12, "Searching [+1]; +2 Alertness, +1 Throw bonus"]);
});

await ok("the cited-parts helper prints a part's page after it, and the roll row's source and tip are as the card always printed them", async () => {
  reset();
  const parts = [{ label: "Alertness", value: 2, cite: "XX p.1" }, { label: "Throw bonus", value: -1 }];
  assert.equal(citedParts(parts), "+2 Alertness (XX p.1), −1 Throw bonus");
  assert.equal(citedParts(parts, [`+${2 * STR_FACTOR} STR×${STR_FACTOR}`]), `+2 Alertness (XX p.1), −1 Throw bonus, +${2 * STR_FACTOR} STR×${STR_FACTOR}`, "extra parts follow, as given");
  assert.equal(citedParts([], [`+${2 * STR_FACTOR} STR×${STR_FACTOR}`]), `+${2 * STR_FACTOR} STR×${STR_FACTOR}`);
  assert.equal(citedParts(undefined), "");
  assert.equal(citedSource({ source: "Searching", parts }), "Searching; +2 Alertness (XX p.1), −1 Throw bonus");
  assert.equal(citedSource({ source: "Searching", parts: [] }), "Searching", "no parts, the line alone");
  assert.equal(checkTip({ target: 12, source: "Searching", parts }), "Target 12+: Searching; +2 Alertness (XX p.1), −1 Throw bonus.");

  const a = actor("Alder", [searching(15, { targetMod: 1 }), alertness()]);
  const search = await rollCheckFor(a, PARTY_CHECKS.searchHasty);
  assert.equal(search.row.source, "Searching [+1]; +2 Alertness, +1 Throw bonus");
  assert.equal(search.row.sourceTip, "Searching [+1]; +2 Alertness (XX p.1), +1 Throw bonus");

  // A Strength-scaled check: Strength is a cited part of the figure, and a level-scaled throw names the level.
  const ladderThrow = throwOf(0, { target: { kind: "breakpoints", breakpoints: [{ atLevel: 1, value: 16 }, { atLevel: 3, value: 14 }] } });
  const basher = actor("Birch", [{ name: "Dungeonbashing", rolls: [ladderThrow], system: { rollTarget: 14 }, flags: { targetMod: 1 } }]);
  basher.system.scores = { str: { mod: 2 } };
  importFactor();
  const bash = await rollCheckFor(basher, PARTY_CHECKS.dungeonbashing);
  unregisterTable(FORMATION_DOC, "test");
  const strTerm = `+${2 * STR_FACTOR} ${game.i18n.localize("ACKS-FORMATION.doors.mod.str")}`;
  assert.equal(bash.check.target, 14 - 1 - 2 * STR_FACTOR, "Strength is inside the figure, beside the other parts");
  assert.equal(bash.row.source, `Dungeonbashing (L3) [+1]; +1 Throw bonus, ${strTerm}`);
  assert.equal(bash.row.sourceTip, `Dungeonbashing (L3) [+1]; +1 Throw bonus, ${strTerm} (${game.i18n.localize("ACKS-FORMATION.doors.page.bash")})`);
  assert.equal(bash.check.source, "Dungeonbashing (L3) [+1]", "the level tag is the lang string's, the same text as before");
  assert.equal(usedForOptions().filter((o) => o.value === "search").length, 1, "one option per flag");
  assert.deepEqual(usedForOptions().map((o) => o.value), ["", "listen", "search", "bash", "trapbreak", "track"]);
  assert.equal(usedForOptions()[0].label, "— by name —");
  assert.deepEqual(
    usedForOptions().filter((o) => o.value === "search" || o.value === "trapbreak").map((o) => o.label),
    ["Search", "Trapbreaking"],
    "a flag two checks share is named for itself, not for its first check",
  );
});

await ok("a Strength-scaled check with a modifier and no imported factor is not thrown and is no member who cannot attempt it; a zero modifier needs none", async () => {
  reset();
  const strong = actor("Birch", [{ name: "Dungeonbashing", rolls: [throwOf(14)], system: { rollTarget: 14 } }]);
  strong.system.scores = { str: { mod: 2 } };
  const rolled = await rollCheckFor(strong, PARTY_CHECKS.dungeonbashing);
  assert.deepEqual([rolled.roll, rolled.row, rolled.missing], [null, null, ["bashStrengthFactor"]], "nothing is rolled");
  assert.equal(seen.formulas.length, 0, "no die was thrown");
  const result = await rollAbilityForParty(party("Birch"), { key: "name:dungeonbashing", name: "Dungeonbashing" });
  assert.deepEqual([result.rolled, result.cannot, result.unthrown], [0, [], ["Birch"]], "the audit leaves the member out and files them as not thrown");
  assert.match(seen.created.at(-1).content, /Not thrown for Birch \(RR p\. 267\)\./);
  assert.doesNotMatch(seen.created.at(-1).content, /cannot attempt/);
  strong.system.scores = { str: { mod: 0 } };
  dice.push(11);
  const plain = await rollCheckFor(strong, PARTY_CHECKS.dungeonbashing);
  assert.deepEqual([plain.row.target, plain.row.total], [14, 11], "a modifier of zero rolls with nothing imported");
  assert.equal(plain.missing, undefined);
});

await ok("the party check's card words a member it did not throw for apart from one who cannot attempt it", async () => {
  reset();
  const skill = () => [{ name: "Dungeonbashing", rolls: [throwOf(14)], system: { rollTarget: 14 } }];
  const strong = actor("Birch", skill());
  strong.system.scores = { str: { mod: 2 } };
  const plain = actor("Oak", skill());
  plain.system.scores = { str: { mod: 0 } };
  dice.push(11);
  const rows = await rollPartyCheck(party("Birch", "Oak"), "dungeonbashing", { spend: false });
  assert.equal(rows, 1, "only the member with nothing owed rolled");
  const card = seen.created.at(-1).content;
  assert.match(card, /Not thrown for Birch \(RR p\. 267\)\./);
  assert.doesNotMatch(card, /Cannot attempt/, "a missing figure is never reported as incapable");
  reset();
  assert.equal(await rollPartyCheck(party("Birch"), "dungeonbashing", { spend: false }), 0, "nobody thrown");
  assert.match(seen.warned.at(-1), /Not thrown for Birch/);
  assert.doesNotMatch(seen.warned.at(-1), /No member can attempt/);
});

await ok("the natural die is read first: an automatic failure fails a total over the target, and a proficient automatic success passes one under it, only for a holder of the skill", async () => {
  reset();
  registerTable({ id: THROWS_DOC, source: "invented", tables: { [THROW_TABLE]: { autoFailMax: 2, autoSucceedMin: 19 } } }, { priority: PRIORITY.WORLD, source: "test" });
  importFactor();
  try {
    const holder = (mod) => {
      const a = actor("Birch", [{ name: "Dungeonbashing", rolls: [throwOf(14)], system: { rollTarget: 14 } }]);
      a.system.scores = { str: { mod } };
      return a;
    };
    const outcome = async (a, natural) => {
      dice.push(natural);
      return (await rollCheckFor(a, PARTY_CHECKS.dungeonbashing)).row;
    };
    // A natural 2 against a target Strength lowered by 15, to -1, is over it and still fails.
    const over = await outcome(holder(5), 2);
    assert.deepEqual([over.total, over.target, over.success], [2, -1, false], "an automatic failure ignores the total");
    // A natural 19 against a target Strength raised by 15, to 29, is under it, and a holder succeeds.
    const under = await outcome(holder(-5), 19);
    assert.deepEqual([under.total, under.target, under.success], [19, 29, true], "a proficient automatic success ignores the total");
    // The same natural from a member whose throw is the Adventuring figure alone is not proficient.
    const unskilled = actor("Cedar", []);
    unskilled.system.adventuring = { dungeonbashing: 14 };
    unskilled.system.scores = { str: { mod: -5 } };
    const bare = await outcome(unskilled, 19);
    assert.deepEqual([bare.total, bare.target, bare.success], [19, 29, false], "no skill, no automatic success");
    // Between the two edges the total against the target decides.
    const middle = await outcome(holder(5), 10);
    assert.deepEqual([middle.total, middle.success], [10, true]);
    unregisterTable(THROWS_DOC, "test");
    const none = await outcome(holder(5), 2);
    assert.equal(none.success, true, "with nothing imported the target alone decides");
  } finally {
    unregisterTable(THROWS_DOC, "test");
    unregisterTable(FORMATION_DOC, "test");
  }
});

await ok("a bonus whose ifHas the character does not hold, or a renamed holder of it, does not change the figure", async () => {
  reset();
  const bare = actor("Alder", [searching(), { ...alertness(), effects: [{ ...alertness().effects[0], ifHas: ["kw:somethingelse"] }] }]);
  assert.equal(resolveCheck(bare, PARTY_CHECKS.searchHasty).target, 15, "an unmet ifHas applies nothing");
  const renamed = actor("Birch", [searching(), { ...alertness(), name: "Sharp Senses" }]);
  assert.deepEqual(resolveCheck(renamed, PARTY_CHECKS.searchHasty).parts.map((p) => [p.label, p.value]), [["Sharp Senses", 2]], "found by what it provides, not by its name");
  const handmade = actor("Cedar", [searching(), { name: "Alertness", system: { rollTarget: 5 } }]);
  assert.equal(resolveCheck(handmade, PARTY_CHECKS.searchHasty).target, 15, "a hand-made item named for a bonus, carrying no row of its own, gives nothing");
});

await ok("the party's target is the figure the skill's own sheet resolves, conditions applied once and named", async () => {
  reset();
  const a = actor("Alder", [searching(15), alertness()]);
  const item = a.items[0];
  const roll = rollsOf(item)[0];
  assert.equal(resolveCheck(a, PARTY_CHECKS.searchHasty).target, throwOutcome(roll, a, item).target, "the sheet and the party read one figure");

  registerTable({ id: CONDITIONS_DOC, source: "invented", tables: { [CONDITIONS_TABLE]: { queasy: { all: -4 } } } }, { priority: PRIORITY.WORLD, source: "test" });
  try {
    a.statuses = new Set(["queasy"]);
    a.appliedEffects = [{ statuses: ["queasy"], flags: {} }];
    const found = resolveCheck(a, PARTY_CHECKS.searchHasty);
    assert.equal(found.target, throwOutcome(roll, a, item).target, "with a condition the two still agree");
    assert.equal(found.target, 13 + 4, "the penalty applies once, not on both sides of the die");
    assert.deepEqual(found.parts.filter((p) => p.label === "conditions").map((p) => p.value), [-4], "named once, as the creature's");
    assert.equal(found.bonus, 0);
  } finally {
    unregisterTable(CONDITIONS_DOC, "test");
  }
});

await ok("a member with no skill rolls Adventuring, and a bonus that needs the skill is not carried over", async () => {
  reset();
  const a = actor("Elm", [alertness()]);
  a.system.adventuring = { searching: 17 };
  assert.equal(resolveCheck(a, PARTY_CHECKS.searchHasty), null, "a hasty search is not permitted through Adventuring");
  const found = resolveCheck(a, PARTY_CHECKS.searchMethodical);
  assert.deepEqual([found.target, found.source, found.skilled], [17, "Adventuring", false]);
  assert.deepEqual(found.parts, [], "the bonus names a skill the character does not hold");
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
