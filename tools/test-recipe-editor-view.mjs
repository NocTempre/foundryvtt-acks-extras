/**
 * Offline tests for what the recipe editor draws (scripts/monsters/recipe-editor-view.mjs and
 * templates/monsters/recipe-*.hbs): the context the window hands its template, the single
 * change each control makes, which document each entry point opens, and the templates
 * rendered against that context: a Player-shaped context draws no write control, a hand row
 * carries its class, a mount part draws its link. Foundry-free and book-free: every part,
 * word, sentence and page reference below is invented.
 *
 * Run: node tools/test-recipe-editor-view.mjs
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Handlebars from "handlebars";
import { readEcologyRecipe } from "../scripts/importer/ecology-recipe.mjs";
import { bookText } from "../scripts/importer/prose.mjs";
import { REGISTER_ORIGIN } from "../scripts/lib/magic-vocab.mjs";
import { readStored, savePart, sentenceMarks } from "../scripts/monsters/recipe-editor-logic.mjs";
import { MONSTERS_LANG, RECIPE_STATES, buildContext, changesFor, countEdit, doorOf, extrasAt, problemsOf } from "../scripts/monsters/recipe-editor-view.mjs";

const tests = [];
const t = (name, fn) => tests.push([name, fn]);

const LANG = JSON.parse(readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const format = (key, data = {}) => (LANG[key] ?? key).replace(/\{(\w+)\}/g, (_, n) => String(data[n] ?? ""));
const loc = (key, data) => format(key, data);
const esc = (v) => Handlebars.escapeExpression(v);
const K = (key) => `${MONSTERS_LANG}.recipe.${key}`;

const hb = Handlebars.create();
hb.registerHelper("localize", (key) => format(key));
const ROW_NAME = "modules/acks-extras/templates/monsters/recipe-row.hbs";
const read = (name) => readFileSync(new URL(`../templates/monsters/${name}`, import.meta.url), "utf8");
hb.registerPartial(ROW_NAME, read("recipe-row.hbs"));
const body = hb.compile(read("recipe-editor.hbs"));
const foot = hb.compile(read("recipe-editor-footer.hbs"));

/** A part in the stored shape, as the import writes it. */
const part = (key, role, over = {}) => ({
  key, origin: REGISTER_ORIGIN, label: over.label ?? key, role,
  source: { uuid: "", templateCell: "", stat: "", name: "", ...(over.source ?? {}) },
  count: { dice: "", literal: null, ratioOf: "", percent: null, round: "", perUnit: "", forEvery: null, ...(over.count ?? {}) },
  chance: over.chance ?? null,
  when: { state: "", place: "", units: [], ...(over.when ?? {}) },
  branch: { group: "", band: "" },
  moraleWhileAlive: over.moraleWhileAlive ?? null, fixedHp: over.fixedHp ?? null, cite: over.cite ?? "XX p. 1", basis: over.basis ?? "page",
});

const IMPORT = [
  part("size-wilderness-wandering", "body", { label: "band", count: { dice: "1d6" }, when: { state: "wandering", place: "wilderness", units: ["band"] } }),
  part("size-dungeon-lair", "unit", { label: "hold", source: { name: "band" }, count: { dice: "1d10" }, when: { state: "lair", place: "dungeon", units: ["hold"] } }),
  part("archers", "body", { count: { ratioOf: "unit", percent: 40, round: "up" }, when: { units: ["band"] } }),
  part("leader-chief", "leader", { label: "QA chief", count: { literal: 1 }, moraleWhileAlive: 2, when: { units: ["hold", "band"] } }),
  part("mounts", "mount", { label: "QA riders' mounts", source: { name: "QA qux" }, count: { dice: "1d4" } }),
  part("pen-lair", "captive", { label: "QA prisoners", count: { dice: "2d4", perUnit: "band" }, chance: 10, when: { state: "lair", units: ["band"] } }),
];
const clone = (x) => structuredClone(x);
const LIBRARY = [{ name: "QA Qux", uuid: "Actor.qux1" }, { name: "QA Qux, giant", uuid: "Actor.qux2" }, { name: "QA Other", uuid: "Actor.oth1" }];

/** The context for one render, with the defaults of a Judge's open window. */
const ctxOf = (over = {}) => buildContext({ recipe: clone(IMPORT), readCopy: clone(IMPORT), state: "lair", canWrite: true, library: LIBRARY, cite: "XX p. 1", loc, ...over });
const html = (over) => body(ctxOf(over));
const handed = (key, changes) => savePart(clone(IMPORT), IMPORT, key, changes);

/* -------------------------------------------- */
/*  The context                                  */
/* -------------------------------------------- */

t("the tables are the tab's state, each row named by its label, its role or its place in the key", () => {
  const c = ctxOf();
  assert.deepEqual(c.units.map((r) => r.key), ["size-dungeon-lair"]);
  assert.deepEqual(c.parts.map((r) => r.key), ["archers", "leader-chief", "mounts", "pen-lair"]);
  assert.deepEqual(c.states.map((s) => [s.key, s.active]), RECIPE_STATES.map((s) => [s, s === "lair"]));
  assert.equal(c.parts[0].name, "archers");
  assert.equal(c.partsLabel, format(K("partsCount"), { n: 4 }));
  assert.ok(c.partsTip.includes("XX p. 1") && c.head.tip.includes("XX p. 1"));
  assert.ok(ctxOf({ cite: "" }).head.tip.length > 0, "the hand count carries a tooltip with no page too");
  assert.equal(c.parts[0].muted, false);
});

t("a Judge's part with no label shows its role's label, muted, and one with no role says so", () => {
  const added = [...clone(IMPORT), { ...part("_a1", "guard", { label: "" }), origin: "" }, { ...part("_a2", "", { label: "" }), origin: "" }];
  const c = ctxOf({ recipe: added });
  const a1 = c.parts.find((r) => r.key === "_a1");
  assert.equal(a1.name, LANG[K("role.guard")]);
  assert.equal(a1.muted, true);
  assert.equal(c.parts.find((r) => r.key === "_a2").name, LANG[K("role.none")]);
});

t("the header counts the parts a hand changed against every part, whatever the state, and names the page", () => {
  const changed = handed("archers", { count: { percent: 55 } });
  const c = ctxOf({ recipe: changed });
  assert.equal(c.head.line, format(K("head.line"), { cite: "XX p. 1", hand: 1, all: IMPORT.length }));
  assert.equal(ctxOf({ cite: "" }).head.line, format(K("head.lineNoCite"), { hand: 0, all: IMPORT.length }));
});

t("a hand row's tooltip names what the import read, a read row's names where its figures came from", () => {
  const c = ctxOf({ recipe: handed("pen-lair", { chance: 55 }) });
  const row = c.parts.find((r) => r.key === "pen-lair");
  assert.equal(row.hand, true);
  assert.match(row.tip, /set by a hand/);
  assert.match(row.tip, /chance 10%/, "the import's chance, not the hand's");
  assert.match(row.tip, /count 2d4/);
  assert.match(row.tip, /XX p\. 1/);
  assert.doesNotMatch(row.tip, /\{|undefined/);
  const read = c.parts.find((r) => r.key === "archers");
  assert.match(read.tip, /as the import read it/);
  assert.match(read.countTip, /XX p\. 1/);
});

t("a share reads as a share of the units, and a count rolled per unit says which", () => {
  const c = ctxOf();
  assert.equal(c.parts[0].countText, format(K("count.share"), { text: "40%", of: format(K("count.ofUnits")) }));
  assert.equal(c.parts.find((r) => r.key === "pen-lair").countText, format(K("count.per"), { text: "2d4", unit: "band" }));
});

t("a count for every so many bodies reads as its die for every block, names what it counts, and its tooltip gives the block size", () => {
  const dep = part("dep", "dependant", { label: "QA dep", count: { dice: "3d5", ratioOf: "bodies", forEvery: 6 }, when: { units: ["band"] } });
  const recipe = [...clone(IMPORT), dep];
  const row = ctxOf({ recipe, readCopy: recipe }).parts.find((r) => r.key === "dep");
  assert.equal(row.countText, format(K("count.every"), { text: "3d5", n: 6, of: format(K("count.ofBodies")) }));
  assert.match(row.tip, /for every 6 bodies/);
  const named = [...clone(IMPORT), part("dep", "dependant", { label: "QA dep", count: { literal: 1, ratioOf: "archers", forEvery: 4 }, when: { units: ["band"] } })];
  assert.equal(ctxOf({ recipe: named, readCopy: named }).parts.find((r) => r.key === "dep").countText, format(K("count.every"), { text: "1", n: 4, of: "archers" }));
});

t("a share of another part names that part, and a unit word's case does not matter to its checkbox", () => {
  const shares = [...clone(IMPORT), part("warriors", "body", { label: "QA warriors", count: { ratioOf: "archers", percent: 60 }, when: { units: ["band"] } })];
  const row = ctxOf({ recipe: shares, readCopy: shares }).parts.find((r) => r.key === "warriors");
  assert.equal(row.countText, format(K("count.share"), { text: "60%", of: "archers" }));
  assert.match(row.countText, /^60% of archers$/);
  assert.match(ctxOf().parts[0].countText, /^40% of the units$/);
  assert.deepEqual(changesFor("unit", false, { when: { units: ["Band", "hold"] } }, "band").changes, { when: { units: ["hold"] } });
});

t("a blank figure carries the page reference alone", () => {
  const blanked = clone(IMPORT).map((p) => (p.key === "mounts" ? { ...p, count: { ...p.count, dice: "" } } : p));
  const row = ctxOf({ recipe: blanked, readCopy: blanked }).parts.find((r) => r.key === "mounts");
  assert.equal(row.countBlank, true);
  assert.equal(row.countTip, "XX p. 1");
});

t("Found in lists the places the recipe names and filters both tables; none named, no select", () => {
  const c = ctxOf({ state: "wandering" });
  assert.deepEqual(c.places.map((p) => p.value), ["", "wilderness", "dungeon"]);
  assert.equal(c.places[1].label, LANG[K("place.wilderness")]);
  assert.deepEqual(ctxOf({ state: "wandering", place: "dungeon" }).units.map((r) => r.key), []);
  assert.deepEqual(ctxOf({ state: "wandering", place: "wilderness" }).units.map((r) => r.key), ["size-wilderness-wandering"]);
  const none = clone(IMPORT).map((p) => ({ ...p, when: { ...p.when, place: "" } }));
  assert.deepEqual(ctxOf({ recipe: none, readCopy: none }).places, []);
});

t("a read-only seat has no edit box even where a part is named in edit", () => {
  const c = ctxOf({ canWrite: false, editKey: "archers" });
  assert.ok(c.parts.every((r) => !r.inEdit && !r.edit));
  assert.equal(c.foot.line, LANG[K("foot.readOnly")]);
  assert.equal(c.foot.canResetAll, false);
});

/* -------------------------------------------- */
/*  The part in edit                             */
/* -------------------------------------------- */

t("the part in edit has a field for each figure, the shipped roles with Mount and Beast, and the unit words", () => {
  const e = ctxOf({ editKey: "leader-chief" }).parts.find((r) => r.key === "leader-chief").edit;
  assert.deepEqual(e.fields.map((f) => f.name), ["label", "role", "count", "chance", "state", "morale", "cite", "fixedHp"]);
  const role = e.fields.find((f) => f.name === "role");
  assert.deepEqual(role.options.map((o) => o.value), ["", "body", "unit", "leader", "young", "dependant", "guard", "captive", "caster", "mount", "beast"]);
  assert.equal(role.options.find((o) => o.selected).value, "leader");
  assert.equal(e.fields.find((f) => f.name === "morale").value, 2);
  assert.deepEqual(e.units.map((u) => [u.word, u.checked]), [["band", true], ["hold", true]]);
  assert.equal(e.leaderNote, true);
  assert.equal(e.link, null);
  assert.equal(e.canReset, false, "a part as the import wrote it has nothing to reset");
});

t("a hand part offers Reset where the import's copy holds its key, and a Judge's own part does not", () => {
  const recipe = [...handed("leader-chief", { count: { literal: 2 } }), { ...part("_a1", "guard"), origin: "" }];
  const c = ctxOf({ recipe, editKey: "leader-chief" });
  assert.equal(c.parts.find((r) => r.key === "leader-chief").edit.canReset, true);
  assert.equal(ctxOf({ recipe, editKey: "_a1" }).parts.find((r) => r.key === "_a1").edit.canReset, false);
});

t("a value a hand typed and the check refused shows in its field with its problem and the foot says to fix it", () => {
  const draft = { key: "pen-lair", values: { chance: "150" }, problems: [{ field: "chance", key: `${MONSTERS_LANG}.recipe.problem.chance` }] };
  const c = ctxOf({ editKey: "pen-lair", draft });
  const f = c.parts.find((r) => r.key === "pen-lair").edit.fields.find((x) => x.name === "chance");
  assert.equal(f.value, "150");
  assert.equal(f.error, LANG[`${MONSTERS_LANG}.recipe.problem.chance`]);
  assert.equal(c.foot.line, LANG[K("foot.fix")]);
  assert.equal(c.foot.error, true);
});

t("a mount part's creature: the one entry its word names is the link, several are candidates, none leaves a search", () => {
  const link = (library, over = {}) => ctxOf({ editKey: "mounts", library, ...over }).parts.find((r) => r.key === "mounts").edit.link;
  const one = link([{ name: "QA Qux", uuid: "Actor.qux1" }]);
  assert.equal(one.name, "QA Qux");
  assert.equal(one.isLinked, true);
  assert.equal(one.uuid, "Actor.qux1");
  assert.equal(one.open, false);
  assert.equal(link([{ name: "QA Qux", uuid: "Actor.qux1" }], {}).entries.length, 0);
  const many = link([{ name: "QA Qux, giant", uuid: "Actor.qux2" }, { name: "QA Qux, small", uuid: "Actor.qux3" }]);
  assert.equal(many.isLinked, false);
  assert.deepEqual(many.entries.map((e) => e.uuid), ["Actor.qux2", "Actor.qux3"]);
  const none = link([{ name: "QA Other", uuid: "Actor.oth1" }]);
  assert.equal(none.none, true);
  const found = link([{ name: "QA Other", uuid: "Actor.oth1" }], { linkQuery: "oth" });
  assert.deepEqual(found.entries.map((e) => e.uuid), ["Actor.oth1"]);
  const changing = link([{ name: "QA Qux", uuid: "Actor.qux1" }, { name: "QA Other", uuid: "Actor.oth1" }], { changing: true, linkQuery: "other" });
  assert.equal(changing.open, true);
  assert.deepEqual(changing.entries.map((e) => e.uuid), ["Actor.oth1"]);
});

t("choosing Mount before the write lands shows the link block from the draft's role", () => {
  const draft = { key: "archers", values: { role: "beast" }, problems: [] };
  const e = ctxOf({ editKey: "archers", draft }).parts.find((r) => r.key === "archers").edit;
  assert.notEqual(e.link, null);
});

/* -------------------------------------------- */
/*  One change from one control                  */
/* -------------------------------------------- */

t("a control makes only its own field's change, so a field left alone is never rewritten", () => {
  assert.deepEqual(changesFor("label", "QA new", IMPORT[3]), { ok: true, changes: { label: "QA new" } });
  assert.deepEqual(changesFor("state", "lair", IMPORT[3]), { ok: true, changes: { when: { state: "lair" } } });
  assert.deepEqual(changesFor("morale", "3", IMPORT[3]).changes, { moraleWhileAlive: "3" });
  assert.deepEqual(changesFor("fixedHp", "", IMPORT[3]).changes, { fixedHp: "" });
  assert.equal(changesFor("nope", "x", IMPORT[3]).ok, false);
});

t("a unit word's checkbox keeps the part's other words", () => {
  const leader = IMPORT[3];
  assert.deepEqual(changesFor("unit", false, leader, "band").changes, { when: { units: ["hold"] } });
  assert.deepEqual(changesFor("unit", true, leader, "gang").changes, { when: { units: ["hold", "band", "gang"] } });
  const next = savePart(clone(IMPORT), IMPORT, "leader-chief", changesFor("unit", false, leader, "band").changes);
  assert.deepEqual(next.find((p) => p.key === "leader-chief").when.units, ["hold"]);
  assert.equal(next.find((p) => p.key === "leader-chief").origin, "");
});

t("a for-every count keeps what it counts and its block size when a die or figure is typed, and takes no percentage", () => {
  const dep = part("dep", "dependant", { count: { dice: "3d5", ratioOf: "bodies", forEvery: 6 } });
  assert.deepEqual(countEdit("3d4", dep), { ok: true, count: { dice: "3d4", literal: null, ratioOf: "bodies", percent: null, forEvery: 6 } });
  assert.deepEqual(countEdit("2", dep), { ok: true, count: { dice: "", literal: 2, ratioOf: "bodies", percent: null, forEvery: 6 } });
  assert.equal(countEdit("40%", dep).ok, false, "a percentage is a count only for a share");
  assert.deepEqual(countEdit("", dep), { ok: true, count: { dice: "", literal: null, ratioOf: "", percent: null, forEvery: null } }, "blank clears the count whole");
  const recipe = [...clone(IMPORT), dep];
  const saved = savePart(recipe, recipe, "dep", changesFor("count", "3d4", dep).changes);
  assert.deepEqual([saved.find((p) => p.key === "dep").count.dice, saved.find((p) => p.key === "dep").count.forEvery], ["3d4", 6]);
});

t("a share keeps its ratio when a percentage is typed, and a figure typed over it replaces the share", () => {
  const share = IMPORT[2];
  assert.deepEqual(countEdit("55%", share), { ok: true, count: { percent: 55 } });
  assert.deepEqual(countEdit("40%", share), { ok: true, count: { percent: 40 } });
  assert.equal(countEdit("3", share).count.ratioOf, "");
  assert.equal(countEdit("1d8", share).count.dice, "1d8");
  assert.equal(countEdit("55%", IMPORT[0]).ok, false, "a percentage is a count only for a share");
  const same = savePart(clone(IMPORT), IMPORT, "archers", changesFor("count", "40%", share).changes);
  assert.equal(same.find((p) => p.key === "archers").origin, REGISTER_ORIGIN);
  const other = savePart(clone(IMPORT), IMPORT, "archers", changesFor("count", "55%", share).changes);
  assert.equal(other.find((p) => p.key === "archers").origin, "");
  assert.equal(other.find((p) => p.key === "archers").count.ratioOf, "unit");
});

t("a value the checks refuse is a problem on its field, and a count the editor cannot read is a count problem", () => {
  assert.deepEqual(problemsOf(IMPORT[5], { chance: "150" }).map((p) => p.field), ["chance"]);
  assert.deepEqual(problemsOf(IMPORT[5], { chance: "" }), []);
  assert.deepEqual(problemsOf(IMPORT[3], { fixedHp: "0" }).map((p) => p.field), ["fixedHp"]);
  assert.equal(changesFor("count", "lots", IMPORT[3]).ok, false);
});

/* -------------------------------------------- */
/*  The doors                                    */
/* -------------------------------------------- */

const TEMPLATE = {
  type: "acks-extras.template", name: "QA Family", uuid: "Actor.fam1",
  system: { axes: [{ key: "variant", options: [{ key: "qa", label: "QA Breed", flags: { "acks-extras": { extras: { encounter: { dungeon: {} }, recipe: [] } } } }] }] },
};
const MONSTER = { type: "monster", name: "QA Creature", uuid: "Actor.mon1", flags: { "acks-extras": { extras: { description: { combat: "<p>x</p>" } } } } };

t("a monster actor opens its own recipe, a template opens the option named, a host opens the option its record names", () => {
  const m = doorOf(MONSTER);
  assert.deepEqual([m.ok, m.target.kind, m.option], [true, "actor", ""]);
  const o = doorOf(TEMPLATE, { optionKey: "qa" });
  assert.deepEqual([o.ok, o.target.kind, o.option, o.name, o.doc], [true, "option", "QA Breed", "QA Family", TEMPLATE]);
  const h = doorOf({ type: "faction", name: "QA Host", system: { units: [] } }, { hostTemplate: { doc: TEMPLATE, variant: "qa" } });
  assert.deepEqual([h.ok, h.doc, h.target.optionKey, h.option], [true, TEMPLATE, "qa", "QA Breed"]);
});

t("nothing opens where the subject, the option or the host's record is missing, each with its own reason", () => {
  assert.equal(doorOf(null).reason, "noDoc");
  assert.equal(doorOf(TEMPLATE).reason, "noOption", "a template with no option named");
  assert.equal(doorOf(TEMPLATE, { optionKey: "zz" }).reason, "noOption");
  const host = { type: "faction", name: "QA Host", system: { units: [] } };
  assert.equal(doorOf(host).reason, "noRecord");
  assert.equal(doorOf(host, { hostTemplate: { doc: TEMPLATE, variant: "" } }).reason, "noRecord");
  assert.equal(doorOf(host, { hostTemplate: { doc: TEMPLATE, variant: "zz" } }).reason, "noOption");
});

t("a target's extras are the actor's own or the variant option's", () => {
  assert.equal(extrasAt(MONSTER, doorOf(MONSTER).target).description.combat, "<p>x</p>");
  const o = doorOf(TEMPLATE, { optionKey: "qa" });
  assert.deepEqual(Object.keys(extrasAt(TEMPLATE, o.target)), ["encounter", "recipe"]);
});

/* -------------------------------------------- */
/*  The reading pane                             */
/* -------------------------------------------- */

const COMBAT = ["35% of gangs or warbands encountered will be archers (round down), 65% will be warriors (round up).", "A QA sentence no locator reads."];
const ECOLOGY = ["Each zorb gang will be led by two champions with 9 AC and 14 HD. A zorb lair or village will be led by a chieftain with 13 AC and 21 HD."];
const stored = (paras) => bookText(paras, "XX p. 2", { id: "qa-1" });

t("the pane's sentences are grouped by paragraph, read ones name their parts, and the unread are counted", () => {
  const wrote = readEcologyRecipe({ combat: COMBAT, ecology: ECOLOGY, encounter: null, variant: "zorb", cite: "XX p. 2" });
  const r = readStored({ combat: stored(COMBAT), ecology: stored(ECOLOGY), encounter: null, variant: "zorb", cite: "XX p. 2" });
  const marks = sentenceMarks(r.paragraphs, wrote, r.sentences);
  const c = ctxOf({ recipe: wrote, readCopy: wrote, marks, editKey: "leader-chieftain" });
  assert.equal(c.pane.paragraphs.length, 3);
  const flat = c.pane.paragraphs.flatMap((p) => p.sentences);
  assert.ok(flat.some((s) => s.read && s.keys.includes("leader-chieftain")));
  assert.ok(flat.some((s) => s.unread));
  assert.equal(c.pane.unread, flat.filter((s) => s.unread).length);
  assert.ok(c.pane.selected.length > 0 && c.pane.selected.every((s) => flat.some((f) => f.text === s.text && f.selected)));
  assert.ok(flat.every((s) => s.press));
  assert.ok(ctxOf({ recipe: wrote, readCopy: wrote, marks, canWrite: false }).pane.paragraphs.flatMap((p) => p.sentences).every((s) => !s.press));
});

/* -------------------------------------------- */
/*  The templates                                */
/* -------------------------------------------- */

const WRITE_CONTROLS = ['data-action="editPart"', 'data-action="addPart"', 'data-action="sentence"', 'data-action="resetAll"', 'data-action="donePart"', "<input", "<select name"];

t("a Player-shaped context draws every table and sentence and no control that writes", () => {
  const wrote = readEcologyRecipe({ combat: COMBAT, ecology: ECOLOGY, encounter: null, variant: "zorb", cite: "XX p. 2" });
  const r = readStored({ combat: stored(COMBAT), ecology: stored(ECOLOGY), encounter: null, variant: "zorb", cite: "XX p. 2" });
  const marks = sentenceMarks(r.paragraphs, wrote, r.sentences);
  const player = body({ ...ctxOf({ recipe: wrote, readCopy: wrote, marks, canWrite: false, editKey: wrote[0].key }), name: "QA Creature" }) + foot(ctxOf({ canWrite: false }));
  for (const control of WRITE_CONTROLS) assert.ok(!player.includes(control), control);
  assert.ok(player.includes("acks-extras-recipe-item"), "the rows are drawn");
  assert.ok(player.includes("acks-extras-recipe-sentence"), "the sentences are drawn");
  assert.ok(player.includes('data-action="state"'), "the tabs are views, not writes");
  assert.ok(player.includes('data-action="close"'));
  const judge = body({ ...ctxOf({ editKey: "leader-chief" }), name: "QA Creature" }) + foot(ctxOf());
  for (const control of ['data-action="editPart"', 'data-action="addPart"', 'data-action="donePart"', 'data-action="resetAll"'.replace("resetAll", "close")]) assert.ok(judge.includes(control), control);
});

t("a hand row carries its class and a read row does not; the part in edit carries the open class", () => {
  const out = html({ recipe: handed("pen-lair", { chance: 55 }), editKey: "archers" });
  const item = (key) => new RegExp(`<li class="([^"]*)" data-key="${key}"`).exec(out)[1];
  assert.match(item("pen-lair"), /\bis-hand\b/);
  assert.doesNotMatch(item("archers"), /\bis-hand\b/);
  assert.match(item("archers"), /\bis-on\b/);
});

t("every control of the edit box is named: a label wraps it or an aria-label does, and no literal id is written", () => {
  const out = html({ editKey: "mounts" });
  assert.doesNotMatch(out, /\sid="/);
  const controls = out.match(/<(?:input|select|button)\b[^>]*>/g) ?? [];
  assert.ok(controls.length > 8);
  for (const c of controls.filter((x) => /^<button/.test(x) && !/data-action="(?:donePart|changeLink|state|addPart|resetPart|sentence)"/.test(x))) assert.match(c, /aria-label=/, c);
  assert.match(out, /<label class="acks-extras-recipe-field"[^>]*>\s*<span class="acks-extras-recipe-cap">Label<\/span>\s*<input type="text" name="label"/);
});

t("a mount part draws its creature as a link with Change, and an unlinked one draws Not linked with each candidate's Link button", () => {
  const linked = html({ editKey: "mounts", library: [{ name: "QA Qux", uuid: "Actor.qux1" }] });
  assert.match(linked, /data-action="openCreature" data-uuid="Actor\.qux1"/);
  assert.match(linked, /data-action="changeLink"/);
  assert.ok(linked.includes(esc(LANG[K("link.linkedNote")])));
  const open = html({ editKey: "mounts", library: [{ name: "QA Qux, giant", uuid: "Actor.qux2" }, { name: "QA Qux, small", uuid: "Actor.qux3" }] });
  assert.ok(open.includes(LANG[K("link.none")]));
  assert.equal((open.match(/data-action="linkEntry"/g) ?? []).length, 2);
  assert.ok(open.includes(esc(LANG[K("link.unlinkedNote")])));
});

t("a leader part draws the Leader figures line and nothing that sets a grade", () => {
  const out = html({ editKey: "leader-chief" });
  assert.ok(out.includes(esc(LANG[K("leaderFigures")])) && out.includes(esc(LANG[K("leaderNote")])));
  assert.doesNotMatch(out, /name="(?:level|grade)"/);
});

t("the foot offers Reset all only where a hand changed a part, and names a refused field", () => {
  assert.ok(!foot(ctxOf()).includes("resetAll"));
  assert.ok(foot(ctxOf({ recipe: handed("archers", { count: { percent: 55 } }) })).includes('data-action="resetAll"'));
  const draft = { key: "pen-lair", values: { chance: "150" }, problems: [{ field: "chance", key: `${MONSTERS_LANG}.recipe.problem.chance` }] };
  assert.match(foot(ctxOf({ editKey: "pen-lair", draft })), /is-error/);
});

t("every string the editor draws is a key of lang/en.json", () => {
  const used = new Set();
  for (const file of ["recipe-editor.hbs", "recipe-row.hbs", "recipe-editor-footer.hbs"]) for (const m of read(file).matchAll(/localize "([^"]+)"/g)) used.add(m[1]);
  for (const m of readFileSync(new URL("../scripts/monsters/recipe-editor-view.mjs", import.meta.url), "utf8").matchAll(/K\(`?"?([\w.${}]+)/g)) {
    if (!m[1].includes("$")) used.add(K(m[1]));
  }
  for (const key of used) assert.ok(key in LANG, key);
  for (const r of ["body", "unit", "leader", "young", "dependant", "guard", "captive", "caster", "mount", "beast", "none"]) assert.ok(K(`role.${r}`) in LANG, r);
  for (const k of ["notice.noDoc", "notice.noOption", "notice.noRecord", "notice.noWrite", "notice.noPart", "title", "titleOption"]) assert.ok(K(k) in LANG, k);
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
console.log(`\ntest-recipe-editor-view: ${tests.length - failures}/${tests.length} passed`);
if (failures) process.exit(1);
