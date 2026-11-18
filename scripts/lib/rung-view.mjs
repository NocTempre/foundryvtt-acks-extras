/* global game, foundry */
/**
 * The inline rung editor's window half: what a template renders for one ladder
 * and for the Save / Cancel bar under it, the kind switch's button group, the
 * listeners that keep a typed rung out of a submit-on-change form, and the
 * actions a window mixes in. The draft itself is `RungDrafts` (`rung-ladder.mjs`);
 * a window holds one as `this.rungs` and answers four calls: `rungCite(key)`,
 * `rungWrite({key: levelValue})`, `rungRedraw()` and its `element`.
 *
 * The same ladder, bar and button group render in the effect-row editor (a
 * row's `value` and `max`) and in the spell sheet's overview (each spell-wide
 * figure), so the two behave alike: the rungs are drafted until Save, a
 * Player sees them read-only with no bar, and every other field of the window
 * keeps writing on change.
 */
import { LANG_PREFIX } from "./constants.mjs";
import { HAND, INVOCATION_KIND, hasHandWork, invalidRungs, isInvocationLadder, kindChoiceOf, parseFigure, parseLevel } from "./rung-ladder.mjs";

const loc = (key, data) => game.i18n.format(`${LANG_PREFIX}.rungEditor.${key}`, data ?? {});

/** The figure as a box shows it: blank for none. */
const shown = (n) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "");

/** Whether the viewer is a Judge: the one gate on a rung edit and on the invocation choice. */
export const isJudge = () => game.user?.isGM === true;

/** An id-safe form of a figure key (`target.area.size` to `target-area-size`). */
const slug = (key) => String(key).replace(/[^A-Za-z0-9_-]+/g, "-");

/** The tooltip of one rung's figure: where it came from, or what a hand replaced. */
export function rungTip(rung, cite = "") {
  const page = cite ? loc("tip.cite", { cite }) : "";
  if (rung.hand === HAND.added) return loc("tip.added");
  if (rung.hand === HAND.edited) {
    const was = rung.was === null ? loc("tip.wasBlank") : loc("tip.was", { figure: shown(rung.was), level: shown(rung.wasAt) });
    return [loc("tip.edited"), was, page].filter(Boolean).join(" · ");
  }
  const figure = rung.value === null ? "" : loc("tip.imported", { figure: shown(rung.value), level: shown(rung.at) });
  return [figure, page].filter(Boolean).join(" · ");
}

/** The id of the element that names why a group cannot be saved. */
export const errorId = (idBase, group) => `${idBase}-${slug(group)}-error`;

/**
 * The context of one ladder's template: a row per rung of its draft, the marks
 * on the boxes that block a save, and whether Restore has anything to do.
 * @param {RungDrafts} drafts
 * @param {string} key the figure's key
 * @param {{group: string, keys: string[], cite?: string, idBase: string}} scope the bar the ladder saves with
 */
export function ladderContext(drafts, key, { group, keys, cite = "", idBase }) {
  const draft = drafts.draft(key);
  const invalid = invalidRungs(draft);
  const editable = drafts.editable();
  return {
    key,
    group,
    keys: keys.join(" "),
    editable,
    empty: draft.length === 0,
    canRestore: editable && hasHandWork(draft),
    errId: errorId(idBase, group),
    rungs: draft.map((rung, i) => ({
      index: i,
      at: shown(rung.at),
      value: shown(rung.value),
      invalid: invalid.has(i),
      hand: rung.hand,
      tip: rungTip(rung, cite),
      atLabel: loc("rung.at", { n: i + 1 }),
      valueLabel: loc(rung.hand ? "rung.valueEdited" : "rung.value", { n: i + 1 }),
      removeLabel: loc("rung.remove", { n: i + 1 }),
    })),
  };
}

/**
 * The context of a Save / Cancel bar over one or more ladders: the verdict that
 * names the first thing wrong, and whether Save is on.
 * @param {RungDrafts} drafts
 * @param {{group: string, keys: string[], idBase: string, saveLabel?: string}} scope
 */
export function actionsContext(drafts, { group, keys, idBase, saveLabel = "saveRow" }) {
  const error = drafts.verdict(keys);
  return {
    group,
    keys: keys.join(" "),
    editable: drafts.editable(),
    error: error ? loc(`error.${error.key}`, error.data) : "",
    canSave: drafts.editable() && !error,
    errId: errorId(idBase, group),
    saveLabel: loc(saveLabel),
  };
}

/**
 * Whether the viewer may choose this kind for a figure. Moving a figure on or
 * off the invocation scale is a Judge's edit; a Player's switch still chooses
 * between the other kinds.
 * @param {object|number|undefined} stored the figure as stored
 * @param {string} kind the kind chosen
 */
export function kindAllowed(stored, kind) {
  return isJudge() || (kind !== INVOCATION_KIND && !isInvocationLadder(stored));
}

/**
 * The context of the kind switch's button group for one figure.
 * @param {string} name the figure's form name, its `.kind` hidden input beside the group
 * @param {string} label the figure's name
 * @param {object|number|undefined} stored the figure as stored
 * @param {{invocation: boolean, field?: string}} options `invocation` offers "By invocation level"
 */
export function kindContext(name, label, stored, { invocation, field = "" }) {
  const choice = invocation ? kindChoiceOf(stored) : (typeof stored === "number" ? "flat" : stored?.kind || "flat");
  const kinds = ["flat", "perLevel", ...(invocation ? [INVOCATION_KIND] : [])];
  return {
    name,
    field,
    choice,
    groupLabel: game.i18n.format(`${LANG_PREFIX}.figureKind.group`, { name: label }),
    buttons: kinds.map((kind) => ({
      kind,
      label: game.i18n.localize(`${LANG_PREFIX}.figureKind.${kind}`),
      pressed: kind === choice,
      ladder: kind === INVOCATION_KIND,
      disabled: !kindAllowed(stored, kind),
    })),
  };
}

/* -------------------------------------------- */

/** The element of one ladder in a window, by its figure key. */
function ladderEl(root, key) {
  return [...(root?.querySelectorAll?.("[data-rung-ladder]") ?? [])].find((el) => el.dataset.rungLadder === key) ?? null;
}

/**
 * After a typed edit: the invalid marks on every level box, the edited mark and
 * tooltip on the rung's figure box, Restore's state, and the bar's verdict and
 * Save. No box is redrawn, so the focus and the caret stay where they are.
 * @param {object} host the window (`rungs`, `rungCite`, `element`)
 * @param {string} key the figure's key
 * @param {number} index the rung that changed
 */
export function paintRungs(host, key, index) {
  const ladder = ladderEl(host.element, key);
  if (!ladder) return;
  const draft = host.rungs.draft(key);
  const invalid = invalidRungs(draft);
  for (const box of ladder.querySelectorAll("[data-rung-at]")) {
    if (invalid.has(Number(box.dataset.rungAt))) box.setAttribute("aria-invalid", "true");
    else box.removeAttribute("aria-invalid");
  }
  const restore = ladder.querySelector('[data-action="rungRestore"]');
  if (restore) restore.disabled = !hasHandWork(draft);
  const rung = draft[index];
  const figure = ladder.querySelector(`[data-rung-value="${index}"]`);
  if (rung && figure) {
    figure.classList.toggle("is-edited", !!rung.hand);
    figure.setAttribute("aria-label", loc(rung.hand ? "rung.valueEdited" : "rung.value", { n: index + 1 }));
    figure.setAttribute("data-tooltip-text", rungTip(rung, host.rungCite(key)));
  }
  paintBar(host, ladder.dataset.rungGroup, (ladder.dataset.rungKeys ?? "").split(" ").filter(Boolean));
}

/** The Save / Cancel bar of a group, redrawn in place from the drafts' verdict. */
export function paintBar(host, group, keys) {
  const error = host.rungs.verdict(keys);
  for (const bar of host.element?.querySelectorAll?.("[data-rung-actions]") ?? []) {
    if (bar.dataset.rungGroup !== group) continue;
    const text = bar.querySelector("[data-rung-state-text]");
    if (text) text.textContent = error ? loc(`error.${error.key}`, error.data) : "";
    const icon = bar.querySelector("[data-rung-state-icon]");
    if (icon) icon.hidden = !error;
    const save = bar.querySelector('[data-action="rungSave"]');
    if (!save) continue;
    if (error) save.setAttribute("aria-disabled", "true");
    else save.removeAttribute("aria-disabled");
    save.classList.toggle("is-disabled", !!error);
  }
}

/**
 * Wire every ladder under the window's element, once each. A typed rung updates
 * the draft and repaints in place. The `change` event of a rung box is stopped
 * below the form, since the form submits on change and a rung is drafted, never
 * submitted; the Enter key is kept from submitting the form the same way. Call
 * it from `_onRender`: a re-rendered part brings new, unwired ladders.
 * @param {object} host the window
 */
export function wireRungs(host) {
  for (const ladder of host.element?.querySelectorAll?.("[data-rung-ladder]") ?? []) {
    if (ladder.dataset.rungWired) continue;
    ladder.dataset.rungWired = "1";
    ladder.addEventListener("change", (event) => event.stopPropagation());
    ladder.addEventListener("keydown", (event) => {
      if (event.key === "Enter") event.preventDefault();
    });
    ladder.addEventListener("input", (event) => {
      const box = event.target;
      // A node is told by `nodeType`, never `instanceof`: a window drawn in a detached browser window has its own constructors.
      if (box?.nodeType !== 1) return;
      const isAt = box.matches("[data-rung-at]");
      if (!isAt && !box.matches("[data-rung-value]")) return;
      const index = Number(isAt ? box.dataset.rungAt : box.dataset.rungValue);
      const typed = box.validity?.badInput === true ? Number.NaN : isAt ? parseLevel(box.value) : parseFigure(box.value);
      if (host.rungs.change(ladder.dataset.rungLadder, index, isAt ? { at: typed } : { value: typed })) paintRungs(host, ladder.dataset.rungLadder, index);
    });
  }
}

/** The figure keys a button names. */
const keysOf = (target) => (target.dataset.rungKeys ?? "").split(" ").filter(Boolean);

/**
 * The actions a window mixes into its `DEFAULT_OPTIONS.actions`; each runs with
 * the window as `this`. Add, remove and restore change a draft and redraw; Cancel
 * drops it; Save validates, hands the window's `rungWrite` every changed figure
 * at once, and drops the drafts after the write lands. A Player's call changes
 * and writes nothing.
 */
export const RUNG_ACTIONS = {
  rungAdd(event, target) {
    if (this.rungs.add(target.dataset.rungKey)) this.rungRedraw();
  },
  rungRemove(event, target) {
    if (this.rungs.remove(target.dataset.rungKey, Number(target.dataset.index))) this.rungRedraw();
  },
  rungRestore(event, target) {
    if (this.rungs.restore(target.dataset.rungKey)) this.rungRedraw();
  },
  rungCancel(event, target) {
    this.rungs.discard(keysOf(target));
    this.rungRedraw();
  },
  async rungSave(event, target) {
    const keys = keysOf(target);
    if (!this.rungs.editable() || this.rungs.verdict(keys)) return;
    const values = this.rungs.toSave(keys);
    if (Object.keys(values).length) await this.rungWrite(values);
    this.rungs.discard(keys);
    this.rungRedraw();
  },
};
