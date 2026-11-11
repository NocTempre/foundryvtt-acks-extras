/**
 * The repair's choice dialog (`scripts/importer/apps/held-edits-dialog.mjs`):
 * how held edits group and show, what each button answers, that a closed
 * dialog answers nothing, and the play stamp (`playStamp`) that sets each
 * character's default answer. Core's `DialogV2.wait` is mocked to hand each
 * button's callback a form whose controls are read the way core's are; every
 * value is invented.
 */
import assert from "node:assert";
import { editGroups, valueView, decisionFrom, chooseHeldEditsDialog } from "../../scripts/importer/apps/held-edits-dialog.mjs";
import { decides, heldEdit, playStamp, pregenAnswer, pregenDefault } from "../../scripts/importer/held-edits.mjs";

let pass = 0;
const ok = (label, cond, detail = "") => {
  assert.ok(cond, `${label}${detail ? ` — ${detail}` : ""}`);
  pass++;
};

const edits = [
  heldEdit({ uuid: "Actor.a", name: "Room", path: "system.roster", current: [{ q: 5 }], page: [{ q: 2 }], cite: "ZZ 3", unstamped: true }),
  heldEdit({ uuid: "Item.b", name: "Lamp", path: "system.description", current: "<p>A note of the Judge's.</p>", page: "<p>Page text.</p>", cite: "ZZ 4" }),
  heldEdit({ uuid: "Actor.a", name: "Room", path: "name", current: "Hall", page: "Room", cite: "ZZ 3" }),
];
const pregens = [
  { uuid: "Actor.p1", name: "Hero", id: "zz.npc1", changed: true },
  { uuid: "Actor.p2", name: "Sage", id: "zz.npc2", changed: false },
  { uuid: "Actor.p3", name: "Scout", id: "zz.npc3", changed: true, unstamped: true },
];

/* --- the pure half --- */
{
  const groups = editGroups(edits);
  ok("edits group by document, in the order met", groups.map((g) => `${g.name}:${g.edits.map((e) => e.path).join("+")}`).join() === "Room:system.roster+name,Lamp:system.description");
  ok("a list shows as its row count, a strength table by its rows", valueView([1, 2]).n === 2 && valueView({ rows: [1] }).kind === "rows");
  ok("nothing shows as empty", ["", null, undefined, [], { rows: [] }].every((v) => valueView(v).kind === "empty"));
  ok("prose shows without its markup", valueView("<p>A <b>bold</b> note.</p>").text === "A bold note.");
  const long = valueView("x".repeat(400));
  ok("long text is cut for the cell and kept longer for the tooltip", long.text.length === 161 && long.text.endsWith("…") && long.tip.length === 400);
  const d = decisionFrom({ take: ["k1"], pregens: [["Actor.p1", "rewrite"], ["Actor.p2", "burn"]] });
  ok("a decision takes the ticked keys and keeps the rest", decides(d, "k1") === "take" && decides(d, "k2") === "keep");
  ok("each character takes its answer, an unknown one read as leave", pregenAnswer(d, "Actor.p1") === "rewrite" && pregenAnswer(d, "Actor.p2") === "leave" && pregenAnswer(d, "Actor.p3") === "leave");
  ok("the decision itself holds an unknown answer as leave", d.pregens.get("Actor.p2") === "leave");
  ok("a word decision leaves every character", pregenAnswer("take", "Actor.p1") === "leave");
  const actor = { name: "Hero", system: { a: 1, b: { c: 2 } }, items: [{ name: "Rope", type: "item", system: { q: 1 } }, { name: "Axe", type: "weapon", system: {} }] };
  const reordered = { items: [actor.items[1], { system: { q: 1 }, type: "item", name: "Rope", _id: "x", sort: 9 }], system: { b: { c: 2 }, a: 1, gone: undefined }, name: "Hero", flags: { z: 1 } };
  ok("a play stamp reads neither key order, item order, ids, sort, flags nor an undefined member", playStamp(actor) === playStamp(reordered));
  ok("and moves with a system field, an item's system, or an item's name",
    [{ ...actor, system: { ...actor.system, a: 2 } }, { ...actor, items: [{ ...actor.items[0], system: { q: 2 } }, actor.items[1]] }, { ...actor, items: [{ ...actor.items[0], name: "Cord" }, actor.items[1]] }]
      .every((v) => playStamp(v) !== playStamp(actor)));
  ok("its default is leave only for a character known unchanged", pregenDefault({ changed: false }) === "leave" && pregenDefault({ changed: true }) === "restore" && pregenDefault({ changed: true, unstamped: true }) === "restore" && pregenDefault({}) === "restore");
}

/* --- the dialog, its buttons and its close --- */
let shown = null;
let press = null;
const form = (ticked, selects) => ({
  querySelectorAll: (sel) => {
    if (sel.includes('name="take"')) return edits.map((e) => ({ value: e.key, checked: ticked.includes(e.key) }));
    if (sel.includes('name="pregen"')) return Object.entries(selects).map(([uuid, value]) => ({ dataset: { uuid }, value }));
    return [];
  },
});
globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` } };
globalThis.foundry = {
  utils: { escapeHTML: (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") },
  applications: {
    api: {
      DialogV2: {
        wait: async (config) => {
          shown = config;
          if (!press) return null;
          const button = config.buttons.find((b) => b.action === press.action);
          return button.callback(null, { form: press.form });
        },
      },
    },
  },
};
{
  press = { action: "apply", form: form([edits[1].key], { "Actor.p1": "restore", "Actor.p2": "leave" }) };
  const applied = await chooseHeldEditsDialog(edits, { pregens });
  ok("apply takes the ticked edits alone", [...applied.take].join() === edits[1].key);
  ok("and each character's select", applied.pregens.get("Actor.p1") === "restore" && applied.pregens.get("Actor.p2") === "leave");
  ok("the dialog wears the importer dialog's classes", shown.classes.includes("acks-extras-importer-dialog") && shown.classes.includes("acks-ui"));
  ok("each document is a frame, its edits rows with a take box keyed by the edit", (shown.content.match(/<fieldset/g) ?? []).length === 3 && shown.content.includes(`value="${edits[0].key}"`));
  ok("the unstamped mark shows on the edit it marks alone", (shown.content.match(/acks-extras-held-unstamped/g) ?? []).length === 1);
  ok("each page value carries a tooltip naming the page it came from", shown.content.includes("ACKS-IMPORTER.ui.repairMergedChoosePageTip{&quot;cite&quot;:&quot;ZZ 4&quot;}"));
  ok("and each held value one saying it is the document's", (shown.content.match(/data-tooltip-text="ACKS-IMPORTER\.ui\.repairMergedChooseCurrentTip/g) ?? []).length === 3);
  ok("a played or unstamped character's answer starts at restore, an untouched one's at leave",
    (shown.content.match(/<option value="restore" selected>/g) ?? []).length === 2 && (shown.content.match(/<option value="leave" selected>/g) ?? []).length === 1);
  const noteOf = (name) => shown.content.split(`<span>${name}</span>`)[1]?.match(/<span class="notes">([^<]*)<\/span>/)?.[1];
  ok("each character's note says why", noteOf("Hero") === "ACKS-IMPORTER.ui.repairMergedPregenPlayed" && noteOf("Sage") === "ACKS-IMPORTER.ui.repairMergedPregenMatches" && noteOf("Scout") === "ACKS-IMPORTER.ui.repairMergedPregenUnstamped");
  ok("a value shows as text, never as markup", !shown.content.includes("<p>A note") && shown.content.includes("A note of the Judge's."));

  press = { action: "takeAll", form: form([], { "Actor.p1": "rewrite" }) };
  const all = await chooseHeldEditsDialog(edits, { pregens: pregens.slice(0, 1) });
  ok("take all takes every edit, and still reads the characters", all.take.size === 3 && all.pregens.get("Actor.p1") === "rewrite");

  press = { action: "keepAll", form: form([edits[0].key], { "Actor.p1": "leave" }) };
  const none = await chooseHeldEditsDialog(edits, { pregens: pregens.slice(0, 1) });
  ok("keep all takes none, though one was ticked", none.take.size === 0);

  press = null;
  ok("a closed dialog keeps every edit and leaves every character", (await chooseHeldEditsDialog(edits, { pregens })) === "keep");

  press = { action: "apply", form: form([], { "Actor.p1": "restore" }) };
  await chooseHeldEditsDialog([], { pregens: pregens.slice(0, 1) });
  ok("with characters alone, only apply is offered", shown.buttons.map((b) => b.action).join() === "apply");
}

delete globalThis.foundry;
delete globalThis.game;
console.log(`test-held-edits-dialog: ${pass} checks passed.`);
