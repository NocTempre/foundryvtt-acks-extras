/* global foundry, game */
/**
 * The choice a merged repair puts to the Judge after its first pass
 * (`mergedRepair`'s `choose`): every edit the pass held, grouped by document,
 * with what the document holds beside what the page gives, the page reference
 * and the unstamped mark; and every pregenerated character the pass left, with
 * what to do with it. Each edit is kept or taken one by one, or all at once;
 * each character is answered from `PREGEN_ANSWERS`, `pregenDefault`'s by default. The
 * answer is a decision `decides` and `pregenAnswer` read. Closing the dialog
 * answers nothing: every edit stays and every character is left.
 *
 * The pure half (`editGroups`, `valueView`, `decisionFrom`) shapes the rows
 * and reads the answer, so it runs without Foundry.
 */
import { LANG_PREFIX } from "../constants.mjs";
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
 * The decision a set of answers makes: the keys of the edits taken, and each
 * character's answer, any answer outside `PREGEN_ANSWERS` read as `leave`.
 * @param {{take?: Iterable<string>, pregens?: Iterable<[string, string]>}} answers
 * @returns {{take: Set<string>, pregens: Map<string, "restore"|"leave"|"rewrite">}}
 */
export function decisionFrom({ take = [], pregens = [] } = {}) {
  const out = new Map();
  for (const [uuid, answer] of pregens) out.set(uuid, PREGEN_ANSWERS.includes(answer) ? answer : "leave");
  return { take: new Set(take), pregens: out };
}

/** One value cell: its view, with a tooltip saying where the figure came from. */
function valueCell(value, tip) {
  const esc = foundry.utils.escapeHTML;
  const view = valueView(value);
  const face = view.kind === "empty" ? loc("repairMergedChooseEmpty") : view.kind === "rows" ? loc("repairMergedChooseRows", { n: view.n }) : view.text;
  const full = view.kind === "text" && view.tip !== view.text ? `${tip} — ${view.tip}` : tip;
  return `<span class="acks-extras-held-value" data-tooltip-text="${esc(full)}">${esc(face)}</span>`;
}

/** The rows of one document's edits. */
function groupHtml(group) {
  const esc = foundry.utils.escapeHTML;
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
        <label class="acks-extras-held-take"><input type="checkbox" name="take" value="${esc(edit.key)}"> ${esc(loc("repairMergedChooseTake"))}</label>
      </div>`;
    })
    .join("");
  return `<fieldset class="acks-extras-held-doc"><legend>${esc(group.name)}</legend>${rows}</fieldset>`;
}

/** A character's note: changed since its import, imported before its stamp, or as imported. */
export const pregenNoteKey = (pregen) =>
  pregen?.unstamped ? "repairMergedPregenUnstamped" : pregen?.changed === false ? "repairMergedPregenMatches" : "repairMergedPregenPlayed";

/** The rows of the pregenerated characters, each with its note and its answer, `pregenDefault`'s chosen. */
function pregensHtml(pregens) {
  const esc = foundry.utils.escapeHTML;
  if (!pregens.length) return "";
  const labels = { restore: loc("repairMergedPregenRestore"), leave: loc("repairMergedPregenLeave"), rewrite: loc("repairMergedPregenRewrite") };
  const options = (chosen) =>
    PREGEN_ANSWERS.map((answer) => `<option value="${answer}"${answer === chosen ? " selected" : ""}>${esc(labels[answer])}</option>`).join("");
  const rows = pregens
    .map((p) => `<label class="acks-extras-held-pregen"><span>${esc(p.name || p.uuid)}</span>
      <span class="notes">${esc(loc(pregenNoteKey(p)))}</span>
      <select name="pregen" data-uuid="${esc(p.uuid)}">${options(pregenDefault(p))}</select></label>`)
    .join("");
  return `<fieldset class="acks-extras-held-doc"><legend>${esc(loc("repairMergedChoosePregens"))}</legend>
    <p class="notes">${esc(loc("repairMergedChoosePregensHint"))}</p>${rows}</fieldset>`;
}

/** The answers a form holds: the ticked edits, or every edit or none, and each character's select. */
function formAnswers(form, take) {
  const keys = [...form.querySelectorAll('input[name="take"]')].filter((i) => take === "all" || (take === "ticked" && i.checked)).map((i) => i.value);
  const pregens = [...form.querySelectorAll('select[name="pregen"]')].map((s) => [s.dataset.uuid, s.value]);
  return decisionFrom({ take: keys, pregens });
}

/**
 * Ask the Judge what a repair does with the edits and the pregenerated
 * characters its first pass listed.
 * @param {object[]} edits the held edits (`heldEdit`)
 * @param {{pregens?: {uuid: string, name?: string}[]}} [more]
 * @returns {Promise<{take: Set<string>, pregens: Map<string, string>}|"keep">} "keep" when closed
 */
export async function chooseHeldEditsDialog(edits, { pregens = [] } = {}) {
  const groups = editGroups(edits);
  const content = `
    ${edits.length ? `<p class="notes">${foundry.utils.escapeHTML(loc("repairMergedChooseIntro", { n: edits.length }))}</p>` : ""}
    <div class="acks-extras-held-list">${groups.map(groupHtml).join("")}${pregensHtml(pregens)}</div>`;
  const answered = await foundry.applications.api.DialogV2.wait({
    window: { title: loc("repairMergedChooseTitle"), resizable: true },
    classes: ["acks-ui", "acks-extras-importer-dialog", "acks-extras-held-dialog"],
    position: { width: 680, height: 640 },
    content,
    buttons: [
      { action: "apply", default: true, label: loc("repairMergedChooseApply"), callback: (event, button) => formAnswers(button.form, "ticked") },
      ...(edits.length
        ? [
            { action: "takeAll", label: loc("repairMergedChooseTakeAll"), callback: (event, button) => formAnswers(button.form, "all") },
            { action: "keepAll", label: loc("repairMergedChooseKeepAll"), callback: (event, button) => formAnswers(button.form, "none") },
          ]
        : []),
    ],
    rejectClose: false,
  });
  return answered && typeof answered === "object" ? answered : "keep";
}
