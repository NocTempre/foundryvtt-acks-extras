/**
 * The cards and strips an item raised or pressed draws (canvas 4, boards 4b and
 * 4c), as data: the raised-item card's table (who is in range, how far, the save
 * and its result), the whispered save card, the strip a body in reach reads on
 * its sheet, and the tooltips that say where each figure came from. Words are
 * the caller's, localized; a tooltip is assembled text for `data-tooltip-text`.
 * Foundry-free.
 *
 * A figure's tooltip is one of three, by where it came from: read from an
 * import (`importTip`, the row and the page the importer read it from), computed
 * by the module (`saveTip`, its parts named with the actor's own numbers and the
 * page that prints the procedure), or nothing behind it (`blankTip`, the page
 * reference alone, no number and no words saying it is missing).
 */
import { numOrNull } from "./util.mjs";

/** The tooltip of a figure read from an imported table: the row's label, the figure and the page the importer read it from. Null where there is no page to point at. */
export function importTip({ label, figure, cite }) {
  return cite ? `${label}: ${figure} (${cite})` : null;
}

/** The tooltip of a figure with nothing behind it: the page reference alone, or null where the module ships none. */
export const blankTip = ({ cite }) => (cite ? String(cite) : null);

/**
 * The tooltip of a saving-throw target the module computed: the save's name,
 * the target and the parts that make it (each `{label, value}`, in the actor's
 * own numbers), then the page that prints the procedure.
 *
 * @param {{save: string, target: number, parts?: Array<{label: string, value: number}>, cite?: string}} p
 */
export function saveTip({ save, target, parts = [], cite = "" }) {
  const list = parts.map((p) => `${p.label} ${p.value >= 0 ? "+" : ""}${p.value}`).join(" · ");
  return `${save} ${target}+${list ? `: ${list}` : ""}${cite ? ` (${cite})` : ""}`;
}

/**
 * The model a raised-item card (board 4b) is rendered from: one row per body
 * the reach meets, with its distance under the name, its save target and total,
 * its result and a Roll for an open row or an Undo for a Judge on an applied
 * one; a body that left reach is greyed with its word. Data only.
 *
 * @param {object} p
 * @param {string} p.title
 * @param {string} [p.subtitle]
 * @param {string} [p.note] the reach line, already assembled
 * @param {string} [p.noteTooltip]
 * @param {{roll: string, undo: string, saved: string, failed: string, out: string, notTarget: string}} p.words
 * @param {Array<{key: string, name: string, feet?: number|null, state: "open"|"applied"|"out"|"notTarget", saved?: boolean, total?: number, target?: number, targetTip?: string, recordIds?: string[]}>} p.rows
 * @param {{itemUuid: string, rowKey: string, activationId: string}} p.ids
 * @param {boolean} [p.isGM] shows Undo
 * @param {{check: string, lower: string}} [p.footer] the Judge's footer buttons' words
 */
export function reachCardModel({ title, subtitle, note, noteTooltip, words, rows, ids, isGM = false, footer }) {
  const detail = (feet) => (numOrNull(feet) === null ? undefined : `${feet}′`);
  const cards = rows.map((r) => {
    const base = { name: r.name, detail: detail(r.feet), total: "" };
    if (r.state === "out") return { ...base, outcome: words.out, emphasis: "neutral" };
    if (r.state === "notTarget") return { ...base, outcome: words.notTarget, emphasis: "neutral" };
    const data = { ...ids, subject: r.key };
    if (r.state === "open") return { ...base, actions: [{ action: "itemRun.roll", label: words.roll, icon: "fa-solid fa-dice-d20", data }] };
    const undo = isGM && r.recordIds?.length ? [{ action: "itemRun.undo", label: words.undo, icon: "fa-solid fa-rotate-left", data }] : [];
    return {
      ...base,
      total: r.total ?? "",
      ...(numOrNull(r.target) !== null ? { target: r.target, ...(r.targetTip ? { targetTooltip: r.targetTip } : {}) } : {}),
      outcome: r.saved ? words.saved : words.failed,
      emphasis: r.saved ? "success" : "failure",
      ...(undo.length ? { actions: undo } : {}),
    };
  });
  const buttons = isGM && footer ? [
    { action: "itemRun.recheck", label: footer.check, icon: "fa-solid fa-crosshairs", data: ids },
    { action: "itemRun.lower", label: footer.lower, icon: "fa-solid fa-arrow-down", data: ids },
  ] : undefined;
  return { title, ...(subtitle ? { subtitle } : {}), ...(note ? { note } : {}), ...(noteTooltip ? { noteTooltip } : {}), sections: [{ rows: cards }], ...(buttons ? { buttons } : {}) };
}

/**
 * The whispered save card (board 4c): the item's name, the body, the save's
 * target with its tooltip and a Roll the save for the body's owners and the
 * Judges.
 *
 * @param {{title: string, subtitle: string, words: {target: string, save: string, roll: string}, target: number|null, targetTip?: string|null, ids: object, subject: string}} p
 */
export function saveCardModel({ title, subtitle, words, target, targetTip = null, ids, subject }) {
  return {
    title,
    subtitle,
    sections: [{
      rows: [{
        name: words.save,
        total: "",
        ...(numOrNull(target) !== null ? { target, ...(targetTip ? { targetTooltip: targetTip } : {}) } : {}),
        actions: [{ action: "itemRun.roll", label: words.roll, icon: "fa-solid fa-dice-d20", data: { ...ids, subject } }],
      }],
    }],
  };
}

/**
 * The rows of the "In reach of" strip on a body's sheet (board 4c): one per
 * reach that meets the body, its item's name, a tag (a save owed, or always on)
 * and, for a save, the target. A body no reach meets has no rows, and the strip
 * is absent.
 *
 * @param {Array<{name: string, owed: boolean, target?: number|null, feet?: number|null, tip?: string|null}>} reaches
 */
export function stripModel(reaches) {
  const rows = (reaches ?? []).map((r) => ({ name: r.name, tag: r.owed ? "owed" : "always", ...(numOrNull(r.target) !== null ? { target: r.target } : {}), ...(numOrNull(r.feet) !== null ? { feet: r.feet } : {}), ...(r.tip ? { tip: r.tip } : {}) }));
  return { count: rows.length, rows };
}

/** The line a morale card's working adds for a standing part: `{label, value, cite}` becomes `{left, right, tip}` with its words the caller's. */
export function moraleLine({ item, value, cite = "", words }) {
  const signedValue = `${value >= 0 ? "+" : "−"}${Math.abs(value)}`;
  return { left: `${words.inReachOf} ${item}`, right: signedValue, ...(cite ? { cite } : {}) };
}
