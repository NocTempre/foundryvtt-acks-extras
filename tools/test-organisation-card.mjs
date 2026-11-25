/**
 * Offline tests for the Judges' card's view model (scripts/monsters/organisation-card.mjs):
 * a step and a unit row each carry a tooltip naming where the figure came from, an
 * unresolved reference and a table gap are findings the card lists, the treasure line
 * and the pot's rows are the roll's, and a pot already holding the creature has its
 * hoards raised. Every name and figure is invented.
 *
 * Run: node tools/test-organisation-card.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { cardView, withHoards } from "../scripts/monsters/organisation-card.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);
const text = (key, data = {}) => `${key}${Object.keys(data).length ? ` ${JSON.stringify(data)}` : ""}`;
const node = (over = {}) => ({ key: "r1", word: "band", label: "", camp: false, troop: "", trait: "", officers: [], stacks: [], children: [], ...over });
const tree = (over = {}) => ({
  top: node({ officers: [{ part: "leader-a", cite: "XX p. 2" }], stacks: [{ count: 4, gen: { part: "warriors", cite: "XX p. 1" } }], troop: "t1", children: [node({ key: "r2", word: "cell", stacks: [{ count: 3, gen: { part: "warriors", cite: "XX p. 1" } }] })] }),
  steps: [{ formula: "2d4", total: 5, why: "warriors count" }, { formula: "1d100", total: 12, why: "lair chance" }],
  findings: [{ what: "reference", status: "none", word: "zorps", candidates: [] }, { what: "gap", table: "troops", unit: "cell", roll: 99 }],
  treasure: { deal: true, hoards: 2 },
  ...over,
});

t("each step carries the page its part prints on and says what was thrown", () => {
  const v = cardView({ tree: tree(), text });
  assert.equal(v.steps[0].cite, "XX p. 1");
  assert.match(v.steps[0].tip, /2d4/);
  assert.match(v.steps[0].tip, /XX p\. 1/);
  assert.equal(v.steps[1].cite, "", "a throw no part owns has no page of its own");
});

t("a unit row counts its own bodies and names its troop from the table, else the key", () => {
  const v = cardView({ tree: tree(), text, troops: [{ key: "t1", label: "T1" }] });
  assert.deepEqual(v.units.map((u) => [u.label, u.bodies, u.troop, u.leaders]), [["band", 4, "T1", 1], ["cell", 3, "", 0]]);
  assert.equal(cardView({ tree: tree(), text }).units[0].troop, "t1");
});

t("the findings are listed in the order they were made, each with its words", () => {
  const v = cardView({ tree: tree(), text });
  assert.deepEqual(v.findings.map((f) => f.what), ["reference", "gap"]);
  assert.match(v.findings[0].text, /zorps/);
});

t("an unlinked finding renders its own text key with the part's label and role, and the lang holds that key", () => {
  const v = cardView({ tree: tree({ findings: [{ what: "unlinked", part: "hound", label: "QA hounds", role: "beast" }] }), text });
  assert.equal(v.findings[0].what, "unlinked");
  assert.match(v.findings[0].text, /^organisation.card.finding.unlinked /);
  assert.match(v.findings[0].text, /"label":"QA hounds"/);
  assert.match(v.findings[0].text, /"role":"beast"/);
  const lang = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
  const root = "ACKS-MONSTERS";
  const held = "organisation.card.finding.unlinked".split(".").reduce((o, k) => o?.[k], lang[root]);
  assert.equal(typeof held, "string", "the card's text key is in the lang");
  assert.match(held, /{label}/, "and it names the part's label");
});

t("the treasure line and the links belong to the roll", () => {
  assert.match(cardView({ tree: tree(), text }).treasure, /"n":2/);
  assert.equal(cardView({ tree: tree({ treasure: { deal: false, hoards: 2 } }), text }).treasure, "");
  const v = cardView({ tree: tree(), text, group: { uuid: "G", name: "G" }, pot: { uuid: "P" }, stacks: 2, bodies: 7 });
  assert.deepEqual([v.group.uuid, v.pot.uuid], ["G", "P"]);
  assert.match(v.wrote, /"stacks":2,"bodies":7/);
});

t("a pot already holding the creature has its hoards raised, else a row is added", () => {
  const rows = [{ actorId: "a1", name: "A", count: 1, letter: "q", hoards: 1 }];
  assert.equal(withHoards(rows, { actorId: "a1", name: "A", letter: "q" }, 3)[0].hoards, 4);
  assert.equal(withHoards(rows, { actorId: "a2", name: "B", letter: "r" }, 2).at(-1).hoards, 2);
  assert.equal(rows[0].hoards, 1, "the pot's own list is not edited");
});

let failures = 0;
for (const [name, fn] of tests) {
  try {
    fn();
    console.log(`ok    ${name}`);
  } catch (err) {
    failures++;
    console.error(`FAIL  ${name}\n      ${err.message}`);
  }
}
console.log(`\ntest-organisation-card: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
