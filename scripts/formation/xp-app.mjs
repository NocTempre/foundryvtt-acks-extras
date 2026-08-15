/* global game, foundry, ChatMessage */
/**
 * Dealing an adventure's experience from the formation window.
 *
 * The division is shown BEFORE it is given. A Judge entering four thousand
 * experience should see, in one glance, that the two players take full shares,
 * the henchman takes half, the hired crossbowmen take nothing because they are
 * paid in coin, and the wagon takes nothing because it is a wagon — and that
 * the character who died on the way out is still on the list, because the rule
 * counts everyone who returned, alive or dead.
 */
import { MODULE_ID } from "./constants.mjs";
import { divideXp, awardXp, participantsOf, reasonLabel } from "./xp-shares.mjs";

const LANG_PREFIX = "ACKS-FORMATION.xp";

/**
 * Ask for the total, show the division, and award it on confirmation.
 * @param {object} formation
 */
export async function dealExperience(formation) {
  const actors = participantsOf(formation);

  const preview = (total) => {
    const d = divideXp(actors, total);
    const rows = d.rows
      .map((r) => `<tr><td>${foundry.utils.escapeHTML(r.name)}</td><td>${r.share}</td><td><strong>${r.xp}</strong></td></tr>`)
      .join("");
    const left = d.excluded
      .map((r) => `<li>${foundry.utils.escapeHTML(r.name)} — ${reasonLabel(r.reason)}</li>`)
      .join("");
    return `<table class="acks-extras-xp-table">
        <tr><th>${game.i18n.localize(`${LANG_PREFIX}.who`)}</th>
            <th>${game.i18n.localize(`${LANG_PREFIX}.share`)}</th>
            <th>${game.i18n.localize(`${LANG_PREFIX}.gets`)}</th></tr>${rows}</table>
      ${left ? `<p class="hint">${game.i18n.localize(`${LANG_PREFIX}.excluded`)}</p><ul class="acks-extras-xp-excluded">${left}</ul>` : ""}`;
  };

  const content = `<div class="form-group">
      <label>${game.i18n.localize(`${LANG_PREFIX}.total`)}</label>
      <div class="form-fields"><input type="number" name="total" min="0" step="1" value="0" autofocus></div>
      <p class="hint">${game.i18n.localize(`${LANG_PREFIX}.totalHint`)}</p>
    </div>
    <div class="acks-extras-xp-preview">${preview(0)}</div>`;

  const total = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize(`${LANG_PREFIX}.title`), icon: "fa-solid fa-star" },
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    position: { width: 460 },
    content,
    ok: { label: game.i18n.localize(`${LANG_PREFIX}.deal`), callback: (_e, b) => Number(b.form.elements.total.value) || 0 },
    render: (_event, dialog) => {
      // Live preview: the division re-renders as the Judge types, so the
      // number they confirm is the number they have already read.
      const input = dialog.element.querySelector('input[name="total"]');
      const box = dialog.element.querySelector(".acks-extras-xp-preview");
      input?.addEventListener("input", () => { box.innerHTML = preview(Number(input.value) || 0); });
    },
  }).catch(() => null);

  if (!total) return null;

  const division = divideXp(actors, total);
  await awardXp(division);

  await ChatMessage.create({
    flavor: game.i18n.format(`${LANG_PREFIX}.flavor`, { total }),
    content: preview(total),
    whisper: ChatMessage.getWhisperRecipients("GM").map((u) => u.id),
  });
  return division;
}

/**
 * Core's party overview deals XP to every actor carrying its own party flag,
 * counting only `character` types and ignoring henchman shares entirely. With
 * this module active the formation is the roster of record, so core's button
 * is hidden rather than left to disagree — one owner per operation.
 *
 * Hiding, not disabling: a Judge who turns this module's setting off gets
 * core's button back untouched, because nothing about core was changed.
 */
export function installCoreXpSuppression() {
  Hooks.on("renderAcksPartyOverviewApp", (app, html) => {
    if (!game.settings.get(MODULE_ID, "ownXpDealing")) return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    const button = root?.querySelector('[data-action="dealXP"]');
    if (!button) return;
    button.hidden = true;
    button.title = game.i18n.localize(`${LANG_PREFIX}.movedHint`);
  });
}
