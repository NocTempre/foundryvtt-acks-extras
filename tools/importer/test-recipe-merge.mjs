/**
 * An encounter recipe part rides a repair's per-row held edits
 * (`REPAIR.monster`'s `mergeByOrigin` entry for `extras.encounter.recipe`):
 * a part the import wrote (origin "register") is rewritten from the fresh read,
 * a part a hand changed (origin blank) is held and offered, a part a Judge
 * added stays, and the read copy in the cookbook stamp is written whole. The
 * parts and labels are invented. No Foundry.
 */
import assert from "node:assert/strict";
import { REPAIR, decidedPolicy, refreshPlan, rowTakeKey } from "../../scripts/importer/refresh.mjs";
import { recipeReadStamp } from "../../scripts/importer/ecology-recipe.mjs";
import { describeRecipePart } from "../../scripts/monsters/recipe-describe.mjs";
import { MODULE_ID } from "../../scripts/importer/constants.mjs";

let n = 0;
const t = (name, fn) => {
  fn();
  n++;
};

const PATH = "extras.encounter.recipe";

/** A part in the stored shape, invented: a QA label, a dice count and the register origin unless told otherwise. */
const part = (key, over = {}) => ({
  key, origin: "register", label: `QA ${key}`, role: "guard",
  source: { uuid: "", templateCell: "", stat: "", name: "" },
  count: { dice: "1d4", literal: null, ratioOf: "", percent: null, round: "", perUnit: "" },
  chance: null, when: { state: "", place: "", units: [] }, branch: { group: "", band: "" },
  moraleWhileAlive: null, cite: "XX p.1", basis: "page", ...over,
});
/** The same part after a hand changed it: its figure moved and its origin cleared. */
const byHand = (p, dice) => ({ ...p, origin: "", count: { ...p.count, dice } });

const stored = (recipe, cookbook = {}) => ({ type: "monster", name: "QA Beast", system: {}, flags: { [MODULE_ID]: { cookbook, extras: { encounter: { lairChance: 5, recipe } } } } });
const built = (recipe, { read } = {}) => ({
  type: "monster", system: {},
  flags: { [MODULE_ID]: { cookbook: { id: "qa.x", ...(read ?? recipeReadStamp(recipe)) }, extras: { encounter: { lairChance: 5, ...(recipe.length ? { recipe } : {}) } } } },
});
const after = (plan) => plan.update.flags[MODULE_ID].extras.encounter.recipe;

t("a part changed by hand survives a repair and an untouched part is refreshed", () => {
  const a = part("a");
  const b = part("b");
  const plan = refreshPlan(stored([byHand(a, "9d9"), b]), built([part("a", { count: { ...a.count, dice: "2d2" } }), part("b", { count: { ...b.count, dice: "3d3" } })]), REPAIR.monster);
  const [first, second] = after(plan);
  assert.equal(first.count.dice, "9d9", "the part a hand changed stands");
  assert.equal(first.origin, "");
  assert.equal(second.count.dice, "3d3", "the untouched part takes the fresh read");
  assert.equal(second.origin, "register");
  assert.deepEqual(plan.keptRows.map((r) => [r.path, r.key]), [[PATH, "a"]], "the held part is listed, under the recipe's path");
});

t("a part the hand left equal to the page is not held, and a part the build lost goes with its origin", () => {
  const a = part("a");
  const plan = refreshPlan(stored([{ ...a, origin: "" }, part("gone")]), built([a]), REPAIR.monster);
  assert.deepEqual(after(plan).map((p) => [p.key, p.origin]), [["a", ""]], "kept as it stands; the register part the page no longer yields is dropped");
  assert.deepEqual(plan.keptRows, []);
});

t("a part a Judge added stays, and a part the build adds is placed after the one before it", () => {
  const own = part("_qa1", { origin: "", label: "QA own" });
  const plan = refreshPlan(stored([part("a"), own]), built([part("a"), part("c")]), REPAIR.monster);
  assert.deepEqual(after(plan).map((p) => p.key), ["a", "c", "_qa1"]);
});

t("a recipe the page no longer yields is cleared except for parts a hand holds, with no restamp of an origin-less part", () => {
  const hand = byHand(part("a"), "9d9");
  const plan = refreshPlan(stored([part("b"), hand]), built([]), REPAIR.monster);
  assert.deepEqual(after(plan), [hand]);
  const none = refreshPlan(stored([part("b")]), built([]), REPAIR.monster);
  assert.deepEqual(after(none), []);
});

t("the read copy is written whole, the held part's page twin included, and an empty copy clears a stale one", () => {
  const a = part("a");
  const fresh = [part("a", { count: { ...a.count, dice: "2d2" } }), part("b")];
  const plan = refreshPlan(stored([byHand(a, "9d9")], { read: { recipe: [a] } }), built(fresh), REPAIR.monster);
  assert.deepEqual(plan.update.flags[MODULE_ID].cookbook.read.recipe, fresh, "the copy is the read, not the merged rows");
  const empty = refreshPlan(stored([], { read: { recipe: [a] } }), built([], { read: recipeReadStamp([], { replace: true }) }), REPAIR.monster);
  assert.deepEqual(empty.update.flags[MODULE_ID].cookbook.read.recipe, []);
});

t("the held part is offered under its label and role, and a decision to take it writes the page's", () => {
  const a = part("a", { label: "QA Warden", role: "caster", chance: 30 });
  const page = part("a", { label: "QA Warden", role: "caster", chance: 30, count: { ...a.count, dice: "2d2" } });
  const source = stored([byHand(a, "9d9")]);
  const keep = decidedPolicy(source, built([page]), REPAIR.monster, { uuid: "Actor.qa", cite: "XX p.1" });
  assert.equal(keep.edits.length, 1);
  const [edit] = keep.edits;
  assert.equal(edit.path, `flags.${MODULE_ID}.${PATH}[a]`);
  assert.equal(edit.current, "Caster: QA Warden (9d9, 30% chance)");
  assert.equal(edit.page, "Caster: QA Warden (2d2, 30% chance)");
  assert.equal(after(refreshPlan(source, built([page]), keep.policy))[0].count.dice, "9d9");
  const take = decidedPolicy(source, built([page]), REPAIR.monster, { uuid: "Actor.qa", decision: { take: new Set([edit.key]) } });
  assert.equal(take.edits.length, 0);
  assert.ok(take.policy.takeRows.has(rowTakeKey(PATH, "a")));
  const written = after(refreshPlan(source, built([page]), take.policy))[0];
  assert.deepEqual([written.count.dice, written.origin], ["2d2", "register"]);
});

t("a take is keyed by its path, so the same key at another path is not taken", () => {
  const a = part("a");
  const source = stored([byHand(a, "9d9")]);
  const other = { ...REPAIR.monster, takeRows: new Set([rowTakeKey("spell.effects", "a")]) };
  assert.equal(after(refreshPlan(source, built([part("a")]), other))[0].count.dice, "9d9");
  const mine = { ...REPAIR.monster, takeRows: new Set([rowTakeKey(PATH, "a")]) };
  assert.equal(after(refreshPlan(source, built([part("a")]), mine))[0].count.dice, "1d4");
});

t("a forced repair writes every part from the read", () => {
  const plan = refreshPlan(stored([byHand(part("a"), "9d9")]), built([part("a")]), { ...REPAIR.monster, force: true });
  assert.equal(after(plan)[0].count.dice, "1d4");
});

t("the monster entry takes no retired list and the spell entry still names its own", () => {
  assert.deepEqual(REPAIR.monster.mergeByOrigin, [{ rows: PATH, describe: "recipePart" }]);
  assert.equal(REPAIR.spell.mergeByOrigin[0].retired, "spell.retired");
});

t("describeRecipePart names a part by its role and label, and reads each figure it holds", () => {
  assert.equal(describeRecipePart(part("a", { role: "mount", label: "QA Steed" })), "Mount: QA Steed (1d4)");
  assert.equal(describeRecipePart(part("a", { role: "beast", count: { dice: "", literal: 2, ratioOf: "", percent: null, round: "", perUnit: "gang" }, when: { state: "lair", place: "", units: ["gang"] }, moraleWhileAlive: 1 })),
    "Beast: QA a (2 per gang, morale +1, lair gang)");
  assert.equal(describeRecipePart(part("a", { count: { dice: "", literal: null, ratioOf: "body", percent: 40, round: "up", perUnit: "" } })), "Guard: QA a (40% of body (round up))");
  assert.equal(describeRecipePart({ key: "k" }), "k");
});

console.log(`recipe merge: ${n} checks passed`);
