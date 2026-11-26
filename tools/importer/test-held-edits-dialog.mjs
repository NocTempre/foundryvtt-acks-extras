/**
 * The repair's choice dialog (`scripts/importer/apps/held-edits-dialog.mjs`):
 * how held edits group and show, what each button answers, that a closed
 * dialog answers nothing, and the play stamp (`playStamp`) that sets each
 * character's default answer. Core's `DialogV2.wait` is mocked to hand each
 * button's callback a form whose controls are read the way core's are; every
 * value is invented.
 */
import assert from "node:assert";
import { editGroups, valueView, decisionFrom, chooseHeldEditsDialog, applyBulk, actorNote } from "../../scripts/importer/apps/held-edits-dialog.mjs";
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
const copiesOffered = [
  { uuid: "Actor.c1", name: "Sidebar Hero", library: { uuid: "Compendium.fixture.shelf.Actor.l1", name: "Hero" }, paths: ["name", "system.hp.max"] },
  { uuid: "Item.c2", name: "My Lamp", library: { uuid: "Compendium.fixture.shelf.Item.l2", name: "Lamp" }, paths: ["system.cost"] },
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
  ok("a decision takes the keys it names and keeps the rest", decides(d, "k1") === "take" && decides(d, "k2") === "keep");
  ok("one that takes all takes every key, those no pass listed included", decides(decisionFrom({ all: "take" }), "never-listed") === "take");
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
const form = (selects, copies = []) => ({
  querySelectorAll: (sel) => {
    if (sel.includes('name="pregen"')) return Object.entries(selects).map(([uuid, value]) => ({ dataset: { uuid }, value }));
    if (sel.includes('name="copy"')) return copiesOffered.map((c) => ({ value: c.uuid, checked: copies.includes(c.uuid) }));
    return [];
  },
});
globalThis.game = { i18n: { localize: (k) => k, format: (k, d) => `${k}${JSON.stringify(d)}` } };
const shownWithRender = async (dialog) => shown.render?.(null, { element: dialog });
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
  press = { action: "apply", form: form({ "Actor.p1": "restore", "Actor.p2": "leave" }) };
  const applied = await chooseHeldEditsDialog(edits, { pregens });
  ok("apply takes every edit listed, and every one no pass listed", applied.take.size === 3 && decides(applied, edits[1].key) === "take" && decides(applied, "Actor.unlisted#system.x") === "take");
  ok("and each character's select", applied.pregens.get("Actor.p1") === "restore" && applied.pregens.get("Actor.p2") === "leave");
  ok("the dialog wears the importer dialog's classes", shown.classes.includes("acks-extras-importer-dialog") && shown.classes.includes("acks-ui"));
  ok("each document is a frame, its edits read-only rows", (shown.content.match(/<fieldset/g) ?? []).length === 3 && shown.content.includes("system.roster"));
  ok("no edit has a box, and the dialog offers apply alone", !shown.content.includes('type="checkbox"') && shown.buttons.map((b) => b.action).join() === "apply");
  ok("the unstamped mark shows on the edit it marks alone", (shown.content.match(/acks-extras-held-unstamped/g) ?? []).length === 1);
  ok("each page value carries a tooltip naming the page it came from", shown.content.includes("ACKS-IMPORTER.ui.repairMergedChoosePageTip{&quot;cite&quot;:&quot;ZZ 4&quot;}"));
  ok("and each held value one saying it is the document's", (shown.content.match(/data-tooltip-text="ACKS-IMPORTER\.ui\.repairMergedChooseCurrentTip/g) ?? []).length === 3);
  const rowsOf = shown.content.split('name="pregen"').slice(1).map((r) => r.split("</select>")[0]);
  ok("a played or unstamped character's answer starts at restore, an untouched one's at leave",
    rowsOf.filter((r) => r.includes('<option value="restore" selected>')).length === 2 && rowsOf.filter((r) => r.includes('<option value="leave" selected>')).length === 1);
  ok("one select above the rows answers every actor with no record, and only those rows carry the mark",
    shown.content.includes('name="bulk"') && (shown.content.match(/data-unstamped="true"/g) ?? []).length === 1 && shown.content.includes("repairMergedChooseNoRecord"));
  const noteOf = (name) => shown.content.split(`<span>${name}</span>`)[1]?.match(/<span class="notes">([^<]*)<\/span>/)?.[1];
  ok("each character's note says why", noteOf("Hero") === "ACKS-IMPORTER.ui.repairMergedPregenPlayed" && noteOf("Sage") === "ACKS-IMPORTER.ui.repairMergedPregenMatches" && noteOf("Scout") === "ACKS-IMPORTER.ui.repairMergedPregenUnstamped");
  ok("a frame of actors with figures notes each by what it holds, and a pregenerated one as before",
    actorNote({ edits: 2 }).key === "repairMergedChangedEdits" && actorNote({ edits: 2, moved: true }).key === "repairMergedChangedMoved" &&
    actorNote({ edits: 1, unstamped: true }).key === "repairMergedChangedNoRecord" && actorNote({ edits: 1, unstamped: true }).data.n === 1 && actorNote({ changed: false }).key === "repairMergedPregenMatches");
  ok("a value shows as text, never as markup", !shown.content.includes("<p>A note") && shown.content.includes("A note of the Judge's."));

  press = { action: "apply", form: form({ "Actor.p1": "rewrite" }) };
  const all = await chooseHeldEditsDialog(edits, { pregens: pregens.slice(0, 1) });
  ok("apply takes every edit and still reads the characters", all.take.size === 3 && all.pregens.get("Actor.p1") === "rewrite");

  const rows = [{ value: "restore", dataset: { unstamped: "true" } }, { value: "leave", dataset: {} }, { value: "leave", dataset: { unstamped: "true" } }];
  ok("the bulk answer sets the rows with no record and no others, and an unknown answer sets none", applyBulk(rows, "rewrite") === 2 && rows.map((r) => r.value).join() === "rewrite,leave,rewrite" && applyBulk(rows, "burn") === 0);
  const bulkListeners = [];
  const wired = { querySelector: (sel) => (sel.includes("bulk") ? { value: "leave", addEventListener: (type, fn) => bulkListeners.push([type, fn]) } : null), querySelectorAll: () => rows };
  await shownWithRender(wired);
  ok("the bulk select is wired to change, and answers the rows when it does", bulkListeners.length === 1 && bulkListeners[0][0] === "change" && (bulkListeners[0][1](), rows.every((r) => r.dataset.unstamped !== "true" || r.value === "leave")));

  press = { action: "apply", form: form({}, ["Item.c2"]) };
  const withCopies = await chooseHeldEditsDialog([], { pregens: [], copies: copiesOffered });
  ok("a copy outside the library is a row with an unticked box, its fields in a tooltip and its library's name in its note",
    (shown.content.match(/name="copy"/g) ?? []).length === 2 && !/name="copy"[^>]*checked/.test(shown.content) && shown.content.includes("data-tooltip-text=\"name, system.hp.max\"") && shown.content.includes("&quot;library&quot;:&quot;Hero&quot;"));
  ok("apply answers the ticked copies alone", [...withCopies.copies].join() === "Item.c2");
  ok("with copies alone, the dialog still opens and offers apply alone", shown.buttons.map((b) => b.action).join() === "apply");

  press = null;
  ok("a closed dialog keeps every edit and leaves every character", (await chooseHeldEditsDialog(edits, { pregens })) === "keep");

  press = { action: "apply", form: form({ "Actor.p1": "restore" }) };
  await chooseHeldEditsDialog([], { pregens: pregens.slice(0, 1) });
  ok("with characters alone, only apply is offered", shown.buttons.map((b) => b.action).join() === "apply" && !shown.content.includes("repairMergedChooseIntro"));
}

delete globalThis.foundry;
delete globalThis.game;
console.log(`test-held-edits-dialog: ${pass} checks passed.`);
