/**
 * The magic-item card and the Judge's roller, offline: `chainCard` (rows, the
 * tooltip's three shapes, the nested tail's roll text, the item strip, the
 * footnote of a flag or an error), the roller's options and the arguments a
 * window's values make, and `rollAndPost` (who may call it, what each refusal
 * says, what is posted and to whom). Every caption, cite and item is invented.
 */
import assert from "node:assert";
import fs from "node:fs";
import { chainCard, rollText, stepTooltip } from "../scripts/magic-items/card-model.mjs";
import { appliesTo, rollable, rollArgs, rollerContext } from "../scripts/magic-items/roller-options.mjs";
import { LANG_PREFIX } from "../scripts/magic-items/constants.mjs";

let pass = 0;
const check = (label, cond) => { assert.ok(cond, label); pass++; };
const eq = (label, got, want) => { assert.deepStrictEqual(got, want, label); pass++; };

// The localizer the pure model is given: a key and its values, readable in an assertion.
const loc = (key, data) => (data && Object.keys(data).length ? `${key}[${Object.values(data).join(",")}]` : key);

const lang = JSON.parse(fs.readFileSync(new URL("../lang/en.json", import.meta.url), "utf8"));
const hasKey = (key) => typeof lang[`${LANG_PREFIX}.${key}`] === "string";

/* --- the roll text ------------------------------------------------------------------ */
eq("a plain step reads die and total", rollText({ die: "1d100", total: 57 }), "1d100 = 57");
eq("a tail reads the face, then the inner roll", rollText({ die: "1d8", total: 7, inner: { die: "1d6", total: 2, band: { min: 1, max: 2 } } }), "7 › 2");

/* --- the tooltip's three shapes ------------------------------------------------------- */
const plain = { list: "q.a", die: "1d100", total: 57, band: { min: 41, max: 60 }, cite: "ZZ p.4" };
eq("die, band and cite", stepTooltip(plain, loc), "card.tip.die[1d100] · card.tip.band[41–60] · ZZ p.4");
eq("a list set by hand says so in the cite's place", stepTooltip({ ...plain, overridden: true, cite: null }, loc), "card.tip.die[1d100] · card.tip.band[41–60] · card.tip.byHand");
eq("an override wins over a cite it somehow still carries", stepTooltip({ ...plain, overridden: true }, loc), "card.tip.die[1d100] · card.tip.band[41–60] · card.tip.byHand");
eq("the cite alone where there is no die or band", stepTooltip({ list: "q.a", cite: "ZZ p.4" }, loc), "ZZ p.4");
eq("no cite adds no words in its place", stepTooltip({ ...plain, cite: null }, loc), "card.tip.die[1d100] · card.tip.band[41–60]");
eq("a one-number band is one number", stepTooltip({ ...plain, band: { min: 5, max: 5 } }, loc), "card.tip.die[1d100] · card.tip.band[5] · ZZ p.4");
eq(
  "a tail names both dice and both bands",
  stepTooltip({ ...plain, die: "1d8", band: { min: 7, max: 8 }, inner: { die: "1d6", total: 2, band: { min: 2, max: 3 } } }, loc),
  "card.tip.die[1d8 › 1d6] · card.tip.band[7–8 › 2–3] · ZZ p.4",
);
eq("nothing known is an empty tooltip", stepTooltip({ list: "q.a" }, loc), "");

/* --- the card ------------------------------------------------------------------------- */
const typeStep = { list: "ty.bands", die: "1d6", total: 3, band: { min: 3, max: 4 }, fields: { item: "Zq Kk", hop: "x" }, caption: "Zq types", cite: "ZZ p.1" };
const itemStep = { list: "kk.list", die: "1d20", total: 12, band: { min: 11, max: 14 }, fields: { item: "Xx twelve" }, caption: "Kk things", cite: "ZZ p.2" };
const done = { ok: true, start: "ty.bands", steps: [typeStep, itemStep], item: { list: "kk.list", text: "Xx twelve", fields: { item: "Xx twelve" }, flag: null, uuid: null }, rolls: [] };

const card = chainCard(done, { loc, style: "classic" });
eq("the banner and its style", [card.title, card.subtitle], ["card.title", "style.classic"]);
eq("a row per step: caption, roll, the row's text beneath", card.sections[0].rows.map((r) => [r.name, r.total, r.detail]), [["Zq types", "1d6 = 3", "Zq Kk"], ["Kk things", "1d20 = 12", "Xx twelve"]]);
eq("each total's tooltip is its step's", card.sections[0].rows.map((r) => r.tooltipText), [stepTooltip(typeStep, loc), stepTooltip(itemStep, loc)]);
eq("the item strip is a section of its own", [card.sections[1].title, card.sections[1].rows.map((r) => r.name)], ["card.itemTitle", ["Xx twelve"]]);
eq("a clean chain has no footnote", card.footnote, undefined);
eq("no style, no subtitle", chainCard(done, { loc }).subtitle, undefined);
eq("a list with no caption is named by its id", chainCard({ ...done, steps: [{ ...itemStep, caption: null }] }, { loc }).sections[0].rows[0].name, "kk.list");

const tail = { list: "k.t", die: "1d8", total: 8, band: { min: 8, max: 8 }, inner: { die: "1d4", total: 3, band: { min: 3, max: 3 } }, fields: { item: "Xx tail" }, caption: "Tails", cite: "ZZ p.3" };
eq("a nested tail reads face › inner", chainCard({ ...done, steps: [tail] }, { loc }).sections[0].rows[0].total, "8 › 3");

for (const flag of ["unresolved-hop", "missing-list", "cycle", "too-deep"]) {
  const flagged = chainCard({ ...done, item: { ...done.item, flag, hop: "nx.list" } }, { loc });
  check(`a ${flag} item keeps its strip`, flagged.sections.length === 2);
  eq(`a ${flag} item is footnoted`, flagged.footnote, `card.flag.${flag}[nx.list]`);
}
const stopped = chainCard({ ok: false, reason: "die-mismatch", steps: [typeStep], item: null, error: { code: "die-mismatch", list: "kk.list" }, rolls: [] }, { loc });
eq("a stopped walk keeps the steps it has", stopped.sections[0].rows.length, 1);
eq("a stopped walk has no strip", stopped.sections.length, 1);
eq("a stopped walk names its error and list", stopped.footnote, "card.error.die-mismatch[kk.list]");
eq("an item with no text has no strip", chainCard({ ...done, item: { ...done.item, text: null } }, { loc }).sections.length, 1);

// Every key the card can ask for exists in the language file.
const asked = new Set();
const recording = (key, data) => { asked.add(key); return loc(key, data); };
for (const style of ["classic", "heroic", "gritty"]) chainCard(done, { loc: recording, style });
for (const flag of ["unresolved-hop", "missing-list", "cycle", "too-deep"]) chainCard({ ...done, item: { ...done.item, flag } }, { loc: recording });
for (const code of ["not-imported", "bands-untiled", "roll-failed", "die-mismatch", "roll-out-of-range"]) {
  chainCard({ ...done, ok: false, item: null, error: { code, list: "x.y" } }, { loc: recording });
}
chainCard({ ...done, steps: [{ ...plain, overridden: true, fields: {} }] }, { loc: recording });
for (const key of asked) check(`lang has ${key}`, hasKey(key));
check("the card asked for its flag, error and style keys", asked.size >= 14);

/* --- the roller's options ------------------------------------------------------------- */
const entry = (table, key, caption) => ({ key, id: `${table}.${key}`, caption });
const full = {
  classicType: entry("classicType", "bands", "Zq types"),
  classic: [entry("classic", "kk", "Kk things"), entry("classic", "nn", null)],
  heroic: [entry("heroic", "rr", "Rr tier"), entry("heroic", "ss", "Ss tier")],
};
const ctx = rollerContext(full, { loc });
eq("every style is offered, the first selected", ctx.styles.map((o) => [o.value, o.disabled, o.selected]), [["classic", false, true], ["heroic", false, false], ["gritty", false, false]]);
eq("the type roll leads the categories, then each imported list by caption", ctx.categories.map((o) => [o.value, o.label]), [["", "option.rollType"], ["kk", "Kk things"], ["nn", "classic.nn"]]);
eq("the first category is selected", ctx.categories.map((o) => o.selected), [true, false, false]);
eq("the rarities are the heroic lists by caption", ctx.rarities.map((o) => [o.value, o.label, o.selected]), [["rr", "Rr tier", true], ["ss", "Ss tier", false]]);
eq("classic opens with the rarity off", [ctx.style, ctx.categoryOff, ctx.rarityOff], ["classic", false, true]);
eq("heroic opens with the category off", [rollerContext(full, { loc, style: "heroic" }).categoryOff, rollerContext(full, { loc, style: "heroic" }).rarityOff], [true, false]);
eq("gritty uses the rarity too", rollerContext(full, { loc, style: "gritty" }).rarityOff, false);
eq("an unknown style opens on the first that can be rolled", rollerContext(full, { loc, style: "zz" }).style, "classic");

const noType = rollerContext({ ...full, classicType: null }, { loc });
eq("an absent type list is a disabled option marked not imported", noType.categories[0], { value: "", label: "option.absent[option.rollType]", disabled: true, selected: false });
eq("the first list that can be rolled is selected instead", noType.categories.map((o) => o.selected), [false, true, false]);

const noHeroic = rollerContext({ ...full, heroic: [] }, { loc });
eq("heroic and gritty are disabled, marked not imported, with no heroic lists", noHeroic.styles.map((o) => [o.value, o.disabled, o.label]), [["classic", false, "style.classic"], ["heroic", true, "option.absent[style.heroic]"], ["gritty", true, "option.absent[style.gritty]"]]);
eq("the rarity picker holds one disabled line", noHeroic.rarities, [{ value: "", label: "option.noneImported", disabled: true, selected: false }]);

const heroicOnly = rollerContext({ classicType: null, classic: [], heroic: full.heroic }, { loc });
eq("with only heroic lists it opens on heroic", [heroicOnly.style, heroicOnly.styles[0].disabled, heroicOnly.styles[1].selected], ["heroic", true, true]);
eq("with no classic lists the category picker is off and holds only the disabled type roll", [heroicOnly.categoryOff, heroicOnly.categories.map((o) => o.disabled)], [true, [true]]);

check("a full set is rollable", rollable(full));
check("heroic lists alone are rollable", rollable({ classicType: null, classic: [], heroic: full.heroic }));
check("the type list alone is rollable", rollable({ classicType: full.classicType, classic: [], heroic: [] }));
check("nothing imported is not rollable", !rollable({ classicType: null, classic: [], heroic: [] }));
check("nothing at all is not rollable", !rollable(undefined));
eq("classic uses the category", appliesTo("classic"), { category: true, rarity: false });
eq("heroic uses the rarity", appliesTo("heroic"), { category: false, rarity: true });
eq("gritty uses the rarity", appliesTo("gritty"), { category: false, rarity: true });

eq("a classic roll takes the category", rollArgs({ style: "classic", category: "kk", rarity: "rr" }), { style: "classic", category: "kk" });
eq("a classic roll with the type roll takes none", rollArgs({ style: "classic", category: "", rarity: "rr" }), { style: "classic" });
eq("a heroic roll takes the rarity", rollArgs({ style: "heroic", category: "kk", rarity: "rr" }), { style: "heroic", rarity: "rr" });
eq("a gritty roll takes the rarity", rollArgs({ style: "gritty", category: "kk", rarity: "ss" }), { style: "gritty", rarity: "ss" });

// The template asks only for keys the language file has.
const template = fs.readFileSync(new URL("../templates/magic-items/roll-dialog.hbs", import.meta.url), "utf8");
const used = [...template.matchAll(new RegExp(`${LANG_PREFIX}\\.([A-Za-z0-9._-]+)`, "g"))].map((m) => m[1]);
check("the template localizes its pickers, hints and labels", used.length === 6);
for (const key of used) check(`lang has ${key}`, hasKey(key));
check("the template carries no literal id", !/\sid=/.test(template));
check("every label wraps its control", (template.match(/<label>/g) ?? []).length === (template.match(/<\/label>/g) ?? []).length && (template.match(/<select/g) ?? []).length === 3);

/* --- rollAndPost: who may call it and what it posts ----------------------------------- */
const notes = [];
const posted = [];
let failPost = false;
const format = (key, data = {}) => {
  const text = lang[key];
  if (typeof text !== "string") throw new Error(`no lang key ${key}`);
  return text.replace(/\{(\w+)\}/g, (_m, name) => String(data[name] ?? ""));
};
globalThis.foundry = { utils: { escapeHTML: (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) } };
globalThis.ui = { notifications: { warn: (m) => notes.push(m) } };
globalThis.ChatMessage = { create: async (data) => { if (failPost) throw new Error("refused"); posted.push(data); return { id: "m1", ...data }; } };
const seat = { isGM: true };
globalThis.game = {
  user: seat,
  users: [{ id: "g1", isGM: true }, { id: "p1", isGM: false }, { id: "g2", isGM: true }],
  i18n: { format },
  modules: { get: () => null },
};
const { rollAndPost, refusalNotice } = await import("../scripts/magic-items/chat-card.mjs");

const tables = {
  captions: { "classicType.bands": "Zq types", "classic.kk": "Kk things" },
  listCites: { "classicType.bands": "ZZ p.1", "classic.kk": "ZZ p.2" },
  classicType: { bands: [{ min: 1, max: 6, item: "Zq Kk", hop: "classic.kk" }] },
  classic: { kk: [{ min: 1, max: 4, item: "Xx four" }, { min: 5, max: 8, item: "Xx eight" }], nn: [{ min: 1, max: 4, item: "Xx other" }] },
  heroic: { rr: [{ min: 1, max: 4, item: "Hh four" }, { min: 5, max: 8, item: "Hh eight" }] },
};
const fixed = (n) => (expr) => ({ total: n, sides: Number(String(expr).split("d")[1]) });

seat.isGM = false;
let out = await rollAndPost({ style: "classic", tables, roller: fixed(1) });
eq("a player is refused", [out.ok, out.reason, out.result, out.message], [false, "gm-only", null, null]);
eq("the refusal is a notification, and nothing is posted", [notes.length, posted.length], [1, 0]);
eq("the notification says only a GM may", notes.at(-1), lang[`${LANG_PREFIX}.refused.gm-only`]);
seat.isGM = true;

out = await rollAndPost({ style: "classic", tables, roller: fixed(5) });
check("a Judge's roll is ok", out.ok === true);
eq("it posted once", posted.length, 1);
eq("the card is whispered to every GM and to nobody else", posted[0].whisper, ["g1", "g2"]);
eq("no roll is attached to the message", posted[0].rolls, []);
check("the card names both lists and the item", ["Zq types", "Kk things", "Xx eight"].every((s) => posted[0].content.includes(s)));
check("the card's tooltip carries the list's page", posted[0].content.includes("ZZ p.2"));
check("the banner carries the style", posted[0].content.includes("Classic"));
eq("the rolls are the roller's own", [out.result.steps.length, out.message.id], [2, "m1"]);

out = await rollAndPost({ style: "classic", category: "nn", tables, roller: fixed(2) });
check("a named category starts at that list", out.ok && out.result.steps.length === 1 && posted.at(-1).content.includes("Xx other"));
out = await rollAndPost({ style: "heroic", rarity: "rr", tables, roller: fixed(8) });
check("a heroic roll is one row", out.ok && out.result.steps.length === 1 && posted.at(-1).content.includes("Hh eight"));

const before = posted.length;
notes.length = 0;
out = await rollAndPost({ style: "heroic", tables, roller: fixed(1) });
eq("a heroic roll with no rarity posts nothing and says so", [out.ok, out.reason, posted.length, notes], [false, "rarity-required", before, [lang[`${LANG_PREFIX}.refused.rarity-required`]]]);
notes.length = 0;
out = await rollAndPost({ style: "zz", tables, roller: fixed(1) });
eq("an unknown style is refused", [out.reason, notes], ["unknown-style", [lang[`${LANG_PREFIX}.refused.unknown-style`]]]);
notes.length = 0;
out = await rollAndPost({ style: "classic", tables: null, roller: fixed(1) });
eq("a world with nothing imported is refused", [out.ok, out.reason, posted.length], [false, "not-imported", before]);
check("and told what it lacks, with no figure", notes.length === 1 && notes[0].startsWith(lang[`${LANG_PREFIX}.refused.not-imported`]) && !/\d/.test(notes[0]));

notes.length = 0;
out = await rollAndPost({ style: "heroic", rarity: "missing", tables, roller: fixed(1) });
eq("a start list that is not imported posts nothing and names the list", [out.ok, out.reason, posted.length, notes], [false, "not-imported", before, ["The list heroic.missing is not imported."]]);

out = await rollAndPost({ style: "classic", tables, roller: () => ({ total: 3, sides: 99 }) });
eq("a walk that stops before its first step posts nothing", [out.ok, out.reason, out.message], [false, "die-mismatch", null]);

// A walk that stops after a step keeps its card, with the footnote.
let calls = 0;
const second = () => { calls++; return calls === 1 ? { total: 2, sides: 6 } : { total: 3, sides: 99 }; };
out = await rollAndPost({ style: "classic", tables, roller: second });
check("a walk that stops later posts what it has with its footnote", !out.ok && out.reason === "die-mismatch" && !!out.message && posted.at(-1).content.includes("Zq types") && posted.at(-1).content.includes("classic.kk"));

failPost = true;
const errors = console.error;
console.error = () => {};
notes.length = 0;
out = await rollAndPost({ style: "classic", tables, roller: fixed(1) });
console.error = errors;
eq("a post that fails is reported, not thrown", [out.ok, out.reason, out.message, notes], [false, "post-failed", null, [lang[`${LANG_PREFIX}.refused.post-failed`]]]);
failPost = false;

eq("a refusal with an error names its list", refusalNotice({ reason: "die-mismatch", error: { code: "die-mismatch", list: "a.b" } }), "The die rolled for a.b is not the die its rows are read from.");

console.log(`test-magic-item-card: ${pass} checks passed`);
