/**
 * What the monster sheet's Body Form control and band take from the Judge's
 * import: the rows of the `monsters` document's `bodyForms` table, a stored key
 * the table does not hold, a Judge's override of the table, and a world with
 * nothing imported.
 *
 * Foundry-free and book-free. Every form, sample and page reference below is
 * invented; the localizer returns the key with its data, so the words the view
 * assembles are asserted without a language file. What this pins is the
 * procedure: nothing imported leaves the select empty (the sheet renders it
 * disabled, which keeps the stored key out of the submit), a stored key the
 * table lacks keeps an option of its own, and the tooltip names where the list
 * came from.
 * Run: node tools/test-monster-body-forms.mjs
 */
import assert from "node:assert/strict";
import { BODY_FORM_DOC, bodyFormOrigin, bodyFormRows, bodyFormView } from "../scripts/monsters/body-forms.mjs";
import { PRIORITY, registerTable, resetTables } from "../scripts/lib/tables.mjs";

let pass = 0;
const check = (label, cond) => {
  assert.ok(cond, label);
  pass++;
};

const loc = (key, data) => (data ? `${key}:${JSON.stringify(data)}` : key);
const rows = {
  zorvine: { label: "Zorvine", example: "Quill (any)" },
  brindle: { label: "Brindle", example: "" },
  mirth: { label: "Mirth", example: "Plain" },
};
const world = (tables, cites = { bodyForms: "XX p. 1" }) => registerTable({ id: BODY_FORM_DOC, cites, tables }, { priority: PRIORITY.WORLD });

/* --- nothing imported ---------------------------------------------------------- */
resetTables();
let view = bodyFormView("zorvine", loc);
check("no document: no rows and a missing origin", bodyFormRows().length === 0 && bodyFormOrigin().state === "missing");
check("the select is empty and unavailable, the stored key is not offered", view.imported === false && Object.keys(view.options).length === 0);
check("the band shows no name and the tooltip is the page reference alone", view.label === "" && view.tip === "bodyForm.page");
world({ sizeSquare: { squares: { feet: 5 } } });
check("a document without the table is the same state", bodyFormView("zorvine", loc).imported === false && bodyFormOrigin().state === "missing");
resetTables();
world({ bodyForms: {} });
check("an empty placeholder table is the same state", bodyFormView("", loc).imported === false && bodyFormView("", loc).tip === "bodyForm.page");
resetTables();
world({ bodyForms: { form1: { __missing: true }, form2: { label: "   ", example: "x" }, form3: "text" } });
check("a missing-row placeholder, a nameless row and a non-row are skipped, leaving nothing", bodyFormRows().length === 0 && bodyFormView("", loc).imported === false);

/* --- imported ------------------------------------------------------------------ */
resetTables();
world({ bodyForms: { ...rows, form9: { __missing: true } } });
view = bodyFormView("brindle", loc);
check("the rows come in the table's order, the placeholder skipped", bodyFormRows().map((r) => r.key).join() === "zorvine,brindle,mirth");
check("an option reads the name and its sample monsters, the name alone where the page lists none",
  view.options.zorvine === 'bodyForm.option:{"name":"Zorvine","example":"Quill (any)"}' && view.options.brindle === "Brindle");
check("the select is available and the band names the stored form", view.imported === true && view.label === "Brindle");
check("the tooltip names the field and the page it was read from", view.tip === 'bodyForm.read:{"label":"field.bodyForm","cite":"XX p. 1"}');
check("a stored key the table holds adds no option", Object.keys(view.options).join() === "zorvine,brindle,mirth");
check("no stored form reads no name", bodyFormView("", loc).label === "");

/* --- a stored key the table does not hold -------------------------------------- */
view = bodyFormView("old-key", loc);
check("an orphan key gets its own option showing the raw key, so another field's submit keeps it", view.options["old-key"] === "old-key" && Object.keys(view.options).length === 4);
check("an orphan key names no form on the band", view.label === "");

/* --- no page on record --------------------------------------------------------- */
resetTables();
world({ bodyForms: rows }, {});
check("an import with no page on record has the field's name as its tooltip", bodyFormView("", loc).tip === "field.bodyForm");

/* --- a Judge's override -------------------------------------------------------- */
resetTables();
world({ bodyForms: rows });
registerTable({ id: BODY_FORM_DOC, tables: { bodyForms: { quux: { label: "Quux", example: "Own" } } } }, { priority: PRIORITY.OVERRIDE });
view = bodyFormView("quux", loc);
check("the override replaces the table whole and is read like the import", Object.keys(view.options).join() === "quux" && view.label === "Quux");
check("its origin is the Judge's own, with no page", bodyFormOrigin().state === "override" && bodyFormOrigin().cite === null);
check("its tooltip says so", view.tip === 'bodyForm.judge:{"label":"field.bodyForm"}');
check("a key of the replaced import is an orphan under the override", bodyFormView("zorvine", loc).options.zorvine === "zorvine");

console.log(`test-monster-body-forms: all ${pass} checks passed`);
