/* global game, foundry, Hooks, document */
import { MODULE_ID } from "./constants.mjs";
import { LEVEL_FLAG, tableLevel } from "./encounter-scaling.mjs";
import { associateLabels } from "../lib/a11y.mjs";
import { elementOf } from "../lib/util.mjs";

/**
 * A "Monster level" row in a RollTable sheet's Summary tab, beside the
 * table's formula: a named input the sheet's own Save writes to
 * `flags["acks-extras"].monsterLevel`, which `tableLevel` reads. Never
 * written on change — a write re-renders the sheet from the document and
 * discards the editor's unsaved edits — and added only to a Summary part that
 * lacks it, so a render of the other parts keeps a typed value. The row is
 * drawn on any sheet that is editable for its seat (`app.isEditable`: a
 * RollTable update needs OWNER), since the save is the sheet's own.
 */
export function installMonsterLevelRow() {
  Hooks.on("renderRollTableSheet", (app, element) => {
    if (!app.isEditable) return;
    const root = elementOf(element);
    // The Summary part exists only in the edit view of an editable table.
    const summary = root?.querySelector('.tab[data-tab="summary"]');
    if (!summary || summary.querySelector(".acks-extras-monster-level")) return;

    const say = (key) => foundry.utils.escapeHTML(game.i18n.localize(`ACKS-FORMATION.scaling.${key}`));
    const group = document.createElement("div");
    group.className = "form-group acks-extras-monster-level";
    group.innerHTML = `<label>${say("levelLabel")}</label>
      <div class="form-fields">
        <input type="number" name="flags.${MODULE_ID}.${LEVEL_FLAG}" min="1" step="1" value="${tableLevel(app.document) ?? ""}">
      </div>
      <p class="hint">${say("levelHint")}</p>`;
    summary.append(group);
    associateLabels(group);
  });
}
