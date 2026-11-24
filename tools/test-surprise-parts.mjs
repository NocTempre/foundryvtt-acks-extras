/**
 * What an opposing creature imposes on the Surprise Matrix's rolls
 * (`scripts/lib/surprise-parts.mjs`) and how `withSurpriseConditions` holds it.
 *
 * Every figure, name and page below is INVENTED: the real ones arrive on an
 * imported ability's row. What this pins is the structure: a monster's row is
 * read and a character's is core's; each side takes the SUM of the other side's
 * carriers and never its own; a carrier with no figure adds nothing; a gate
 * nothing here can decide is left out and told; and a combatant with no
 * conditions of its own is still shifted, and put back afterwards.
 */
import assert from "node:assert/strict";

let passed = 0;
const ok = async (name, fn) => { await fn(); passed++; console.log("ok   " + name); };

const notices = { info: [] };
globalThis.Hooks = { on() {}, off() {} };
globalThis.game = {
  settings: { get: () => false },
  i18n: {
    localize: (k) => k,
    format: (k, d = {}) => `${k.replace("ACKS-LIB.conditionRoll.", "")}|${Object.entries(d).map(([n, v]) => `${n}=${v}`).join(",")}`,
    has: () => true,
  },
};
globalThis.ui = { notifications: { info: (m) => notices.info.push(m), error() {}, warn() {} } };

const { opposingSurpriseParts, surpriseAgainst, sumOfParts, sideOfPool, SURPRISE_TARGET } = await import("../scripts/lib/surprise-parts.mjs");
const { withSurpriseConditions } = await import("../scripts/lib/status-effects.mjs");

const row = (value, extra = {}) => ({ type: "modifier", target: SURPRISE_TARGET, appliesTo: "opponent", value, ...extra });
const ability = (name, effects, cite = "") => ({
  type: "ability",
  name,
  flags: { "acks-extras": { extras: { effects }, ...(cite ? { cookbook: { cite } } : {}) } },
});
const creature = (name, items = [], { type = "monster", statuses = [] } = {}) => ({
  name, type, statuses: new Set(statuses), items, system: { surprise: { avoidsurprise: 0 } },
});
const combatant = (actor) => ({ name: actor.name, actor });

await ok("a monster's opponent row is read with its source and page; a character's is core's", () => {
  const banner = creature("Carrier", [ability("Banner", [row(2)], "Pg 1")]);
  assert.deepEqual(opposingSurpriseParts(banner), { parts: [{ source: "Banner", cite: "Pg 1", value: 2 }], left: [] });
  assert.deepEqual(opposingSurpriseParts(creature("Char", [ability("Banner", [row(2)])], { type: "character" })), { parts: [], left: [] }, "core reads a character's own field");
  assert.deepEqual(opposingSurpriseParts(creature("Own", [ability("Self", [row(2, { appliesTo: "self" })])])).parts, [], "a figure on the creature's own roll is not an imposition");
  assert.deepEqual(opposingSurpriseParts(creature("Other", [ability("Banner", [row(2, { target: "initiative" })])])).parts, [], "another target");
  assert.deepEqual(opposingSurpriseParts(creature("None", [ability("Banner", [row(null)]), ability("Zero", [row(0)])])), { parts: [], left: [] }, "no figure, or none that is not zero, adds nothing");
  assert.deepEqual(opposingSurpriseParts(creature("Neg", [ability("Hush", [row(-3)])])).parts.map((p) => p.value), [-3], "a figure keeps its sign");
  assert.deepEqual(opposingSurpriseParts(null), { parts: [], left: [] });
  assert.deepEqual(opposingSurpriseParts(creature("Copies", [ability("Banner", [row(2)]), ability("Banner", [row(2)])])).parts.length, 1, "copies of one ability count once");
});

await ok("a gate the matrix can decide is asked; one it cannot, and a free-text condition, are left out and named", () => {
  const gated = (gate, extra = {}) => creature("G", [ability("Banner", [row(2, { gate, ...extra })])], { statuses: ["prone"] });
  assert.equal(opposingSurpriseParts(gated({ kind: "status", status: "prone" })).parts.length, 1, "a status the creature carries");
  assert.deepEqual(opposingSurpriseParts(gated({ kind: "status", status: "hidden" })), { parts: [], left: [] }, "a status it does not carry applies nothing and is not news");
  assert.deepEqual(opposingSurpriseParts(gated({ kind: "targetCondition", condition: ["prone"] })).left, [{ source: "Banner", why: "gate" }], "a roll gate has no attack here");
  assert.deepEqual(opposingSurpriseParts(gated({ kind: "unregistered" })).left, [{ source: "Banner", why: "gate" }]);
  assert.deepEqual(opposingSurpriseParts(gated(undefined, { condition: "while it holds" })).left, [{ source: "Banner", why: "condition" }]);
});

await ok("each side takes the sum of the other side's carriers and none of its own", () => {
  const pools = {
    friendly: [combatant(creature("Scout", [ability("Quiet", [row(-1)], "Pg 9")]))],
    hostile: [combatant(creature("A", [ability("Banner", [row(2)], "Pg 1")])), combatant(creature("B", [ability("Banner", [row(3)], "Pg 1")]))],
    neutral: [combatant(creature("Plain"))],
    secret: [combatant(creature("D", [ability("Drum", [row(4)])]))],
  };
  const found = surpriseAgainst(pools);
  assert.deepEqual(found.imposedOn.adventurers.map((p) => [p.bearer, p.value]), [["A", 2], ["B", 3], ["D", 4]], "the monsters' carriers, whichever of their three pools");
  assert.equal(sumOfParts(found.imposedOn.adventurers), 9, "two carriers add");
  assert.deepEqual(found.imposedOn.monsters.map((p) => [p.bearer, p.source, p.cite, p.value]), [["Scout", "Quiet", "Pg 9", -1]]);
  assert.deepEqual(found.left, []);
  assert.equal(sumOfParts(surpriseAgainst({ friendly: [combatant(creature("P"))], hostile: [combatant(creature("Q"))] }).imposedOn.monsters), 0, "no carrier, nothing");
  assert.equal(sumOfParts(surpriseAgainst({ hostile: [combatant(creature("A", [ability("Banner", [row(2)])]))] }).imposedOn.monsters), 0, "a carrier does not impose on its own side");
  const odd = surpriseAgainst({ hostile: [{ name: "Ghost", actor: null }, null], elsewhere: [combatant(creature("Z", [ability("Banner", [row(5)])]))] });
  assert.deepEqual([odd.imposedOn.monsters, odd.imposedOn.adventurers], [[], []], "no actor, and a key that is no pool, contribute nothing");
  const undecided = surpriseAgainst({ hostile: [combatant(creature("G", [ability("Banner", [row(2, { gate: { kind: "unregistered" } })])]))] });
  assert.deepEqual(undecided.left, [{ source: "Banner", why: "gate", bearer: "G" }]);
  assert.deepEqual(undecided.imposedOn.adventurers, []);
  assert.deepEqual([sideOfPool("friendly"), sideOfPool("secret"), sideOfPool("x")], ["adventurers", "monsters", null]);
});

await ok("the matrix's roll holds each combatant's figure shifted by the other side's carriers, and puts it back", async () => {
  notices.info.length = 0;
  const party = [creature("Fighter"), creature("Scout", [], { type: "character", statuses: ["prone"] })];
  const warband = [creature("Brute", [ability("Banner", [row(2)], "Pg 1")]), creature("Brute 2", [ability("Banner", [row(3)], "Pg 1")]), creature("Cub")];
  const pools = { friendly: party.map(combatant), hostile: warband.map(combatant), neutral: [], secret: [] };
  const seen = {};
  await withSurpriseConditions(pools, async () => {
    for (const actor of [...party, ...warband]) seen[actor.name] = actor.system.surprise.avoidsurprise;
  });
  assert.deepEqual(seen, { Fighter: 5, Scout: 5, Brute: 0, "Brute 2": 0, Cub: 0 }, "the party takes both carriers; the warband takes none, its own carriers included");
  for (const actor of [...party, ...warband]) assert.equal(actor.system.surprise.avoidsurprise, 0, `${actor.name} is put back`);
  assert.equal(notices.info.length, 1, "told once");
  assert.match(notices.info[0], /Fighter: term\.imposedCited\|source=Banner,cite=Pg 1,value=\+2, term\.imposedCited\|source=Banner,cite=Pg 1,value=\+3;/, "each part is named with its source and page");
  assert.match(notices.info[0], /Scout: /, "a creature with conditions of its own is named too");
});

await ok("a side facing no carrier is not shifted and no notice is posted; a figure that cannot be decided is told and left out", async () => {
  notices.info.length = 0;
  const lone = creature("Lone");
  await withSurpriseConditions({ friendly: [combatant(lone)], hostile: [combatant(creature("Wolf"))] }, async () => {
    assert.equal(lone.system.surprise.avoidsurprise, 0);
  });
  assert.deepEqual(notices.info, []);
  const target = creature("Target");
  const gated = creature("Gated", [ability("Banner", [row(2, { gate: { kind: "unregistered" } })])]);
  await withSurpriseConditions({ friendly: [combatant(target)], hostile: [combatant(gated)] }, async () => {
    assert.equal(target.system.surprise.avoidsurprise, 0, "not applied on a guess");
  });
  assert.equal(notices.info.length, 1);
  assert.match(notices.info[0], /^notice\.surpriseLeft\|rows=Gated: Banner$/);
});

await ok("a roll that throws still puts every figure back, and a combatant whose actor re-prepared is left alone", async () => {
  const target = creature("Target");
  const prep = creature("Prep");
  const pools = { friendly: [combatant(target), combatant(prep)], hostile: [combatant(creature("Brute", [ability("Banner", [row(2)])]))] };
  await assert.rejects(
    withSurpriseConditions(pools, async () => {
      assert.equal(target.system.surprise.avoidsurprise, 2);
      prep.system.surprise = { avoidsurprise: 7 };
      throw new Error("core threw");
    }),
    /core threw/,
  );
  assert.equal(target.system.surprise.avoidsurprise, 0);
  assert.equal(prep.system.surprise.avoidsurprise, 7, "a fresh field is not written over");
});

console.log(`\n${passed} surprise-part checks passed.`);
