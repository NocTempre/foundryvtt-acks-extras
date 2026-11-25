/**
 * An encounter recipe part rides a repair's per-row held edits
 * (`REPAIR.monster`'s `mergeByOrigin` entry for `extras.encounter.recipe`):
 * a part the import wrote (origin "register") is rewritten from the fresh read,
 * a part a hand changed (origin blank) is held and offered, a part a Judge
 * added stays, and the read copy in the cookbook stamp is written whole. The
 * parts and labels are invented. No Foundry.
 */
import assert from "node:assert/strict";
import { REPAIR, actorPolicy, decidedPolicy, refreshPlan, rowTakeKey } from "../../scripts/importer/refresh.mjs";
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

/* --- a template's variant options: the same merge, walked through the keyed arrays of `system` --- */

const TPL = `${MODULE_ID}.template`;
const RECIPE_AT = `flags.${MODULE_ID}.extras.encounter.recipe`;
const pathOf = (axisKey, optionKey) => `axes[${axisKey}].options[${optionKey}].${RECIPE_AT}`;

/** A variant option in the stored shape: the read copy beside the recipe it carries, both invented. */
const option = (key, recipe, read = recipe) => ({
  key, label: `QA ${key}`,
  flags: { [MODULE_ID]: { cookbook: { id: `qa.${key}`, ...recipeReadStamp(read) }, extras: { encounter: { lairChance: 5, ...(recipe.length ? { recipe } : {}) } } } },
});
const axis = (key, options) => ({ key, label: `QA ${key}`, options });
const template = (axes) => ({ type: TPL, name: "QA Family", system: { axes, cells: [] }, flags: { [MODULE_ID]: { cookbook: { id: "qa.fam" } } } });
const optionIn = (plan, axisIndex, optionKey) => plan.update.system.axes[axisIndex].options.find((o) => o.key === optionKey);
const recipeOf = (plan, axisIndex, optionKey) => optionIn(plan, axisIndex, optionKey).flags[MODULE_ID].extras?.encounter?.recipe;
const readOf = (plan, axisIndex, optionKey) => optionIn(plan, axisIndex, optionKey).flags[MODULE_ID].cookbook.read?.recipe;

t("a part changed by hand on one option survives a template repair while an untouched part on another refreshes", () => {
  const a = part("a");
  const b = part("b");
  const page = (p, dice) => part(p.key, { count: { ...p.count, dice } });
  const source = template([axis("variant", [option("one", [byHand(a, "9d9")], [a]), option("two", [b])])]);
  const fresh = template([axis("variant", [option("one", [page(a, "2d2")]), option("two", [page(b, "3d3")])])]);
  const plan = refreshPlan(source, fresh, actorPolicy(fresh));
  assert.equal(recipeOf(plan, 0, "one")[0].count.dice, "9d9", "the held part stands");
  assert.equal(recipeOf(plan, 0, "one")[0].origin, "");
  assert.equal(recipeOf(plan, 0, "two")[0].count.dice, "3d3", "the other option's untouched part takes the read");
  assert.deepEqual(plan.keptRows.map((r) => [r.path, r.key]), [[pathOf("variant", "one"), "a"]]);
});

t("two options carrying one part key stay apart, in the plan and in a take", () => {
  const a = part("a");
  const source = template([axis("variant", [option("one", [byHand(a, "7d7")], [a]), option("two", [byHand(a, "8d8")], [a])])]);
  const fresh = template([axis("variant", [option("one", [part("a")]), option("two", [part("a")])])]);
  const plan = refreshPlan(source, fresh, actorPolicy(fresh));
  assert.deepEqual(plan.keptRows.map((r) => r.path), [pathOf("variant", "one"), pathOf("variant", "two")]);
  assert.deepEqual([recipeOf(plan, 0, "one")[0].count.dice, recipeOf(plan, 0, "two")[0].count.dice], ["7d7", "8d8"]);
  const takeTwo = { ...actorPolicy(fresh), takeRows: new Set([rowTakeKey(pathOf("variant", "two"), "a")]) };
  const taken = refreshPlan(source, fresh, takeTwo);
  assert.deepEqual([recipeOf(taken, 0, "one")[0].count.dice, recipeOf(taken, 0, "two")[0].count.dice], ["7d7", "1d4"], "only the named option takes the page's part");
});

t("axes and options are paired by key, not by place", () => {
  const a = part("a");
  const source = template([axis("role", [option("lead", [part("z", { count: { dice: "5d5" } })])]), axis("variant", [option("two", []), option("one", [byHand(a, "9d9")], [a])])]);
  const fresh = template([axis("variant", [option("one", [part("a")]), option("two", [])]), axis("role", [option("lead", [part("z")])])]);
  const plan = refreshPlan(source, fresh, actorPolicy(fresh));
  assert.equal(recipeOf(plan, 0, "one")[0].count.dice, "9d9");
  assert.equal(recipeOf(plan, 0, "two"), undefined, "an option with nothing stored and nothing built gains no recipe");
  assert.equal(recipeOf(plan, 1, "lead")[0].count.dice, "1d4", "the stored option of the same key, not the stored axis of the same place, answers");
  assert.equal(recipeOf(plan, 1, "lead")[0].origin, "register");
});

t("a part a Judge added to an option stays, and a build's new part is placed after the one before it", () => {
  const own = part("_qa1", { origin: "", label: "QA own" });
  const source = template([axis("variant", [option("one", [part("a"), own])])]);
  const fresh = template([axis("variant", [option("one", [part("a"), part("c")])])]);
  assert.deepEqual(recipeOf(refreshPlan(source, fresh, actorPolicy(fresh)), 0, "one").map((p) => p.key), ["a", "c", "_qa1"]);
});

t("each option's read copy is the read, whole, whatever the rows merged to", () => {
  const a = part("a");
  const page = [part("a", { count: { ...a.count, dice: "2d2" } }), part("b")];
  const source = template([axis("variant", [option("one", [byHand(a, "9d9")], [a])])]);
  const fresh = template([axis("variant", [option("one", page)])]);
  const plan = refreshPlan(source, fresh, actorPolicy(fresh));
  assert.deepEqual(readOf(plan, 0, "one"), page);
  assert.equal(recipeOf(plan, 0, "one")[0].count.dice, "9d9");
  assert.deepEqual(fresh.system.axes[0].options[0].flags[MODULE_ID].extras.encounter.recipe, page, "the build is not written into");
});

t("an option the build no longer has is not written, and one it carries from the held template keeps its stored parts", () => {
  const a = part("a");
  const hand = byHand(a, "9d9");
  const source = template([axis("variant", [option("one", [part("a")]), option("gone", [part("g")]), option("merged", [hand], [a])])]);
  const dropped = template([axis("variant", [option("one", [part("a")])])]);
  const planDropped = refreshPlan(source, dropped, actorPolicy(dropped));
  assert.deepEqual(planDropped.update.system.axes[0].options.map((o) => o.key), ["one"]);
  assert.deepEqual(planDropped.keptRows, []);
  const carried = template([axis("variant", [option("one", [part("a")]), option("merged", [hand], [a])])]);
  const planCarried = refreshPlan(source, carried, actorPolicy(carried));
  assert.deepEqual(recipeOf(planCarried, 0, "merged"), [hand]);
  assert.deepEqual(planCarried.keptRows, [], "a carried option is the stored one, so nothing differs from the page");
  const fresher = template([axis("variant", [option("one", [part("a")]), option("added", [part("n")])])]);
  assert.deepEqual(recipeOf(refreshPlan(source, fresher, actorPolicy(fresher)), 0, "added").map((p) => p.key), ["n"]);
});

t("a held option part is offered with its own path and line, and a decision to take it writes the page's", () => {
  const a = part("a", { label: "QA Warden", role: "caster", chance: 30 });
  const page = part("a", { label: "QA Warden", role: "caster", chance: 30, count: { ...a.count, dice: "2d2" } });
  const source = template([axis("variant", [option("one", [byHand(a, "9d9")], [a])])]);
  const fresh = template([axis("variant", [option("one", [page])])]);
  const policy = actorPolicy(fresh);
  const keep = decidedPolicy(source, fresh, policy, { uuid: "Actor.qa", cite: "XX p.1" });
  assert.equal(keep.edits.length, 1);
  const [edit] = keep.edits;
  assert.equal(edit.path, `system.${pathOf("variant", "one")}[a]`);
  assert.equal(edit.current, "Caster: QA Warden (9d9, 30% chance)");
  assert.equal(edit.page, "Caster: QA Warden (2d2, 30% chance)");
  assert.equal(recipeOf(refreshPlan(source, fresh, keep.policy), 0, "one")[0].count.dice, "9d9");
  const take = decidedPolicy(source, fresh, policy, { uuid: "Actor.qa", decision: { take: new Set([edit.key]) } });
  assert.equal(take.edits.length, 0);
  assert.equal(recipeOf(refreshPlan(source, fresh, take.policy), 0, "one")[0].count.dice, "2d2");
});

t("a forced template repair writes every option's parts from the read", () => {
  const source = template([axis("variant", [option("one", [byHand(part("a"), "9d9")])])]);
  const fresh = template([axis("variant", [option("one", [part("a")])])]);
  assert.equal(recipeOf(refreshPlan(source, fresh, { ...actorPolicy(fresh), force: true }), 0, "one")[0].count.dice, "1d4");
});

t("only a template build carries the option entry, and the monster's own entry is unchanged", () => {
  assert.deepEqual(actorPolicy(template([])).mergeByOrigin, [{ rows: `axes.*.options.*.${RECIPE_AT}`, root: "system", describe: "recipePart" }]);
  assert.equal(actorPolicy({ type: "monster", system: {}, flags: {} }).mergeByOrigin, undefined);
  assert.deepEqual(REPAIR.monster.mergeByOrigin, [{ rows: PATH, describe: "recipePart" }]);
});

console.log(`recipe merge: ${n} checks passed`);
