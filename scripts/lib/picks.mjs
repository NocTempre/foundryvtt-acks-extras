/**
 * A staging pick is a control whose value an action reads when its button is
 * pressed — the member a light goes to, the spell a tracker starts — and that
 * nothing stores. It carries `data-pick="<key>"` and no `name`, so it never
 * rides a form's submit data.
 *
 * A sheet re-renders while the user is between the pick and the press: a
 * submit-on-change form submits on a change to ANY control in it, named or
 * not, and a formation write elsewhere redraws every open party sheet. The
 * template has no state to rebuild a pick from, so it comes back on its first
 * option and the press reads that. `readPicks` takes the values out of the
 * element being replaced and `restorePicks` writes them into its replacement,
 * from a sheet's `_preSyncPartState` / `_syncPartState`; `isPick` is the test
 * its change handler returns on, so a pick alone is never a submit.
 * `PicksMixin` is all three on one window.
 *
 * A restore writes `value` and fires no change event, so a window that shows
 * or hides something by a pick's value sets that from the restored value in
 * `_onRender`, which runs after the parts are synced.
 *
 * Foundry-free: the controls are read through `querySelectorAll`, `dataset`,
 * `value` and, on a select, `options`; the mixin only calls up its base.
 */

/** Every staging pick inside a part. */
export const PICK_SELECTOR = "[data-pick]";

/**
 * The value of every staging pick under `root`, by its `data-pick` key. A key
 * names one control: where a template repeats a pick per row, the row's key
 * goes into it, or every row is restored to the last row's value.
 * @param {ParentNode|null|undefined} root
 * @returns {Map<string, string>}
 */
export function readPicks(root) {
  const picks = new Map();
  for (const control of root?.querySelectorAll?.(PICK_SELECTOR) ?? []) picks.set(control.dataset.pick, control.value);
  return picks;
}

/**
 * Write the picks read off the replaced element into the new one. A select
 * whose options no longer hold the value keeps the template's own default,
 * since setting a select to a value it does not offer leaves it with no
 * option chosen at all.
 * @param {ParentNode|null|undefined} root
 * @param {Map<string, string>|null|undefined} picks
 */
export function restorePicks(root, picks) {
  if (!picks?.size) return;
  for (const control of root?.querySelectorAll?.(PICK_SELECTOR) ?? []) {
    const key = control.dataset.pick;
    if (!picks.has(key)) continue;
    const value = picks.get(key);
    if (control.options && ![...control.options].some((option) => option.value === value)) continue;
    control.value = value;
  }
}

/** Whether an event's target is a staging pick or sits inside one. */
export function isPick(target) {
  return !!target?.closest?.(PICK_SELECTOR);
}

/**
 * Staging picks on a window. `Base` is a HandlebarsApplicationMixin over an
 * ApplicationV2, which owns the two part-sync hooks. Every part keeps its
 * picks across a re-render, and a pick's change never reaches the form's
 * submit, which on a submit-on-change form would write and redraw.
 */
export function PicksMixin(Base) {
  return class PicksApplication extends Base {
    /** @override — a staging pick's value is read off the part being replaced. */
    _preSyncPartState(partId, newElement, priorElement, state) {
      super._preSyncPartState(partId, newElement, priorElement, state);
      state.picks = readPicks(priorElement);
    }

    /** @override — and written into its replacement. */
    _syncPartState(partId, newElement, priorElement, state) {
      super._syncPartState(partId, newElement, priorElement, state);
      restorePicks(newElement, state.picks);
    }

    /** @override — a pick's change is not the form's. */
    _onChangeForm(formConfig, event) {
      if (isPick(event?.target)) return;
      return super._onChangeForm(formConfig, event);
    }
  };
}
