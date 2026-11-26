/* global foundry, game */
/**
 * The choice a merged repair puts to the Judge after its first pass
 * (`mergedRepair`'s `choose`): every change the reset of a library document
 * makes where it holds something else, grouped by document, as read-only lines
 * with what the document holds beside what the page gives, the page reference
 * and the unstamped mark; every actor the pass left, with what to do with it
 * and one answer for all those with no record of their import; and every copy
 * outside the library that still holds fields the repair changed, each with an
 * unticked box. A library document is reset whole, so an edit has no box: pressing apply
 * takes every one. Each actor is answered from `PREGEN_ANSWERS`,
 * `pregenDefault`'s by default. The answer is a decision `decides` and
 * `pregenAnswer` read. Closing the dialog answers nothing: every edit stays and
 * every actor is left.
 *
 * The pure half (`editGroups`, `valueView`, `decisionFrom`) shapes the rows
 * and reads the answer, so it runs without Foundry.
 */
import { LANG_PREFIX } from "../constants.mjs";
import { escape as esc } from "../../lib/util.mjs";
import { PREGEN_ANSWERS, pregenDefault } from "../held-edits.mjs";

const loc = (key, data) => (data ? game.i18n.format(`${LANG_PREFIX}.ui.${key}`, data) : game.i18n.localize(`${LANG_PREFIX}.ui.${key}`));

/** The longest text a cell shows, and the longest its tooltip carries. */
const SHOWN = 160;
const TIPPED = 600;

/**
 * The held edits grouped by document, documents and edits in the order met.
 * @param {{uuid: string, name?: string}[]} edits as `heldEdit` builds them
 * @returns {{uuid: string, name: string, edits: object[]}[]}
 */
export function editGroups(edits) {
  const groups = new Map();
  for (const edit of edits ?? []) {
    if (!groups.has(edit.uuid)) groups.set(edit.uuid, { uuid: edit.uuid, name: edit.name || edit.uuid, edits: [] });
    groups.get(edit.uuid).edits.push(edit);
  }
  return [...groups.values()];
}

/** Text with its markup taken out and its spaces run together. */
const plain = (html) => String(html ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/\s+/g, " ").trim();

/**
 * How a held value shows in a cell: `empty` for nothing; `rows` with a count
 * for a list, or for an object whose `rows` is one (a strength table); `text`
 * for anything else, its markup taken out, cut to a cell's length with the
 * longer form for the tooltip.
 * @param {unknown} value
 * @returns {{kind: "empty"}|{kind: "rows", n: number}|{kind: "text", text: string, tip: string}}
 */
export function valueView(value) {
  if (value === undefined || value === null || value === "") return { kind: "empty" };
  if (Array.isArray(value)) return value.length ? { kind: "rows", n: value.length } : { kind: "empty" };
  if (typeof value === "object") {
    if (Array.isArray(value.rows)) return value.rows.length ? { kind: "rows", n: value.rows.length } : { kind: "empty" };
    const json = JSON.stringify(value);
    return { kind: "text", text: json.length > SHOWN ? `${json.slice(0, SHOWN)}…` : json, tip: json.slice(0, TIPPED) };
  }
  const text = plain(value);
  if (!text) return { kind: "empty" };
  return { kind: "text", text: text.length > SHOWN ? `${text.slice(0, SHOWN)}…` : text, tip: text.slice(0, TIPPED) };
}

/**
 * The decision a set of answers makes: the keys of the edits taken (`all`
 * "take" takes every edit, those no pass listed included), and each actor's
 * answer, any answer outside `PREGEN_ANSWERS` read as `leave`.
 * @param {{take?: Iterable<string>, pregens?: Iterable<[string, string]>, all?: "keep"|"take", copies?: Iterable<string>}} answers
 *   `copies` the uuids of the copies outside the library ticked to be brought up to it
 * @returns {{take: Set<string>, pregens: Map<string, "restore"|"leave"|"rewrite">, copies: Set<string>, all?: "take"}}
 */
export function decisionFrom({ take = [], pregens = [], all = "keep", copies = [] } = {}) {
  const out = new Map();
  for (const [uuid, answer] of pregens) out.set(uuid, PREGEN_ANSWERS.includes(answer) ? answer : "leave");
  return { take: new Set(take), pregens: out, copies: new Set(copies), ...(all === "take" ? { all } : {}) };
}

/** One value cell: its view, with a tooltip saying where the figure came from. */
function valueCell(value, tip) {
  const view = valueView(value);
  const face = view.kind === "empty" ? loc("repairMergedChooseEmpty") : view.kind === "rows" ? loc("repairMergedChooseRows", { n: view.n }) : view.text;
  const full = view.kind === "text" && view.tip !== view.text ? `${tip} — ${view.tip}` : tip;
  return `<span class="acks-extras-held-value" data-tooltip-text="${esc(full)}">${esc(face)}</span>`;
}

/** The rows of one document's edits. */
function groupHtml(group) {
  const rows = group.edits
    .map((edit) => {
      const pageTip = edit.cite ? loc("repairMergedChoosePageTip", { cite: edit.cite }) : loc("repairMergedChoosePageNoCite");
      const unstamped = edit.unstamped
        ? ` <span class="acks-extras-held-unstamped" data-tooltip="" aria-label="${esc(loc("repairMergedChooseUnstampedTip"))}">${esc(loc("repairMergedChooseUnstamped"))}</span>`
        : "";
      return `<div class="acks-extras-held-row">
        <div class="acks-extras-held-path"><code>${esc(edit.path)}</code>${unstamped}</div>
        <div class="acks-extras-held-pair">
          <span class="acks-extras-held-label">${esc(loc("repairMergedChooseCurrent"))}</span>${valueCell(edit.current, loc("repairMergedChooseCurrentTip"))}
          <span class="acks-extras-held-label">${esc(loc("repairMergedChoosePage"))}</span>${valueCell(edit.page, pageTip)}
        </div>
      </div>`;
    })
    .join("");
  return `<fieldset class="acks-extras-held-doc"><legend>${esc(group.name)}</legend>${rows}</fieldset>`;
}

/**
 * An actor's note and its figure. A pregenerated character is changed since its
 * import, imported before its stamp, or as imported; any other actor carries
 * its edit count (`edits`) and is changed since its import, holds edits of the
 * Judge's, or has no record of what was imported.
 * @returns {{key: string, data?: {n: number}}}
 */
export const actorNote = (actor) => {
  if (actor?.edits === undefined) {
    return { key: actor?.unstamped ? "repairMergedPregenUnstamped" : actor?.changed === false ? "repairMergedPregenMatches" : "repairMergedPregenPlayed" };
  }
  const data = { n: actor.edits };
  if (actor.unstamped) return { key: "repairMergedChangedNoRecord", data };
  return { key: actor.moved ? "repairMergedChangedMoved" : "repairMergedChangedEdits", data };
};

/** The note's lang key alone, as `actorNote` names it. */
export const pregenNoteKey = (pregen) => actorNote(pregen).key;

/**
 * Set every row of `selects` that marks an actor with no record (its `data-unstamped`) to `value`.
 * @param {Iterable<{value: string, dataset?: object}>} selects
 * @param {string} value one of `PREGEN_ANSWERS`
 * @returns {number} how many rows were set
 */
export function applyBulk(selects, value) {
  let n = 0;
  if (!PREGEN_ANSWERS.includes(value)) return n;
  for (const select of selects) {
    if (select.dataset?.unstamped !== "true") continue;
    select.value = value;
    n++;
  }
  return n;
}

const answerLabels = () => ({ restore: loc("repairMergedPregenRestore"), leave: loc("repairMergedPregenLeave"), rewrite: loc("repairMergedPregenRewrite") });
const answerOptions = (chosen) =>
  PREGEN_ANSWERS.map((answer) => `<option value="${answer}"${answer === chosen ? " selected" : ""}>${esc(answerLabels()[answer])}</option>`).join("");

/**
 * The rows of the actors the pass left, each with its note and its answer,
 * `pregenDefault`'s chosen, and one select above them that answers every row
 * with no record of its import.
 */
function pregensHtml(pregens) {
  if (!pregens.length) return "";
  const rows = pregens
    .map((p) => {
      const note = actorNote(p);
      return `<label class="acks-extras-held-pregen"><span>${esc(p.name || p.uuid)}</span>
      <span class="notes">${esc(loc(note.key, note.data))}</span>
      <select name="pregen" data-uuid="${esc(p.uuid)}"${p.unstamped ? ' data-unstamped="true"' : ""}>${answerOptions(pregenDefault(p))}</select></label>`;
    })
    .join("");
  const bulk = pregens.some((p) => p.unstamped)
    ? `<label class="acks-extras-held-bulk"><span>${esc(loc("repairMergedChooseNoRecord"))}</span>
      <select name="bulk">${answerOptions("restore")}</select></label>`
    : "";
  return `<fieldset class="acks-extras-held-doc"><legend>${esc(loc("repairMergedChoosePregens"))}</legend>
    <p class="notes">${esc(loc("repairMergedChoosePregensHint"))}</p>${bulk}${rows}</fieldset>`;
}

/** The rows of the copies outside the library, each with its field paths in a tooltip and an unticked box. */
function copiesHtml(copies) {
  if (!copies.length) return "";
  const rows = copies
    .map((c) => `<label class="acks-extras-held-copy"><span>${esc(c.name || c.uuid)}</span>
      <span class="notes" data-tooltip-text="${esc((c.paths ?? []).join(", "))}">${esc(loc("repairMergedChooseCopyNote", { library: c.library?.name ?? "", n: c.paths?.length ?? 0 }))}</span>
      <span class="acks-extras-held-take"><input type="checkbox" name="copy" value="${esc(c.uuid)}"> ${esc(loc("repairMergedChooseCopyBring"))}</span></label>`)
    .join("");
  return `<fieldset class="acks-extras-held-doc"><legend>${esc(loc("repairMergedChooseCopies"))}</legend>
    <p class="notes">${esc(loc("repairMergedChooseCopiesHint"))}</p>${rows}</fieldset>`;
}

/** The answers a form holds: every edit taken, each actor's select and each copy whose box is ticked. */
function formAnswers(form, edits) {
  const pregens = [...form.querySelectorAll('select[name="pregen"]')].map((s) => [s.dataset.uuid, s.value]);
  const copies = [...form.querySelectorAll('input[name="copy"]')].filter((i) => i.checked).map((i) => i.value);
  return decisionFrom({ take: edits.map((e) => e.key), pregens, all: "take", copies });
}

/** Wire the one select that answers every row with no record to the rows themselves. */
function wireBulk(dialog) {
  const root = dialog?.element;
  const bulk = root?.querySelector?.('select[name="bulk"]');
  if (!bulk) return;
  bulk.addEventListener("change", () => applyBulk(root.querySelectorAll('select[name="pregen"]'), bulk.value));
}

/**
 * Ask the Judge to read what a repair resets and to answer for the actors its
 * first pass listed.
 * @param {object[]} edits the held edits (`heldEdit`), listed read-only
 * @param {{pregens?: {uuid: string, name?: string}[], copies?: {uuid: string, name?: string, library?: {name?: string}, paths?: string[]}[]}} [more]
 *   `pregens` the actors the pass held back, `copies` the copies outside the library offered the library's fields
 * @returns {Promise<{take: Set<string>, pregens: Map<string, string>}|"keep">} "keep" when closed
 */
export async function chooseHeldEditsDialog(edits, { pregens = [], copies = [] } = {}) {
  const groups = editGroups(edits);
  const content = `
    ${edits.length ? `<p class="notes">${esc(loc("repairMergedChooseIntro", { n: edits.length }))}</p>` : ""}
    <div class="acks-extras-held-list">${groups.map(groupHtml).join("")}${pregensHtml(pregens)}${copiesHtml(copies)}</div>`;
  const answered = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("repairMergedChooseTitle"), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog", "acks-extras-held-dialog"],
    position: { width: 680, height: 640 },
    content,
    buttons: [
      { action: "apply", default: true, label: loc("repairMergedChooseApply"), callback: (event, button) => formAnswers(button.form, edits) },
    ],
    render: (event, dialog) => wireBulk(dialog),
    rejectClose: false,
  });
  return answered && typeof answered === "object" ? answered : "keep";
}
