/* global game, foundry, ChatMessage */
/**
 * Dealing an adventure's experience from the formation window.
 *
 * The division is previewed before it is given: each row's share and
 * adjustment, who is left out and why, and the fallen still listed.
 */
import { MODULE_ID } from "./constants.mjs";
import { divideXp, awardXp, participantsOf, reasonLabel } from "./xp-shares.mjs";
import { importedShareCite } from "../henchmen/rules/wages.mjs";
import { elementOf, gmIds } from "../lib/util.mjs";
import { xpBonusFor } from "../classes/xp-bonus.mjs";

const LANG_PREFIX = "ACKS-FORMATION.xp";

/**
 * Ask for the total, show the division, and award it on confirmation.
 * @param {object} formation
 */
export async function dealExperience(formation) {
  const actors = participantsOf(formation);

  // Read once per dialog.
  const bonuses = new Map(actors.map((a) => [a, xpBonusFor(a)]));
  const bonusOf = (a) => bonuses.get(a);

  const preview = (total) => {
    const d = divideXp(actors, total, { bonusOf });
    const rows = d.rows
      .map((r) => `<tr><td>${foundry.utils.escapeHTML(r.name)}</td><td data-tooltip-text="${foundry.utils.escapeHTML(shareTip(r))}">${r.share}</td><td>${bonusCell(bonuses.get(r.actor))}</td>`
        + `<td><strong>${r.xp}</strong>${r.onRecord ? `<br><span class="hint">${game.i18n.localize(`${LANG_PREFIX}.onRecord`)}</span>` : ""}</td></tr>`)
      .join("");
    const left = d.excluded
      .map((r) => `<li>${foundry.utils.escapeHTML(r.name)} — ${reasonLabel(r.reason)}</li>`)
      .join("");
    return `<table class="acks-extras-xp-table">
        <tr><th>${game.i18n.localize(`${LANG_PREFIX}.who`)}</th>
            <th>${game.i18n.localize(`${LANG_PREFIX}.share`)}</th>
            <th>${game.i18n.localize(`${LANG_PREFIX}.bonus`)}</th>
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
      // The preview re-renders as the total is typed.
      const input = dialog.element.querySelector('input[name="total"]');
      const box = dialog.element.querySelector(".acks-extras-xp-preview");
      input?.addEventListener("input", () => { box.innerHTML = preview(Number(input.value) || 0); });
    },
  }).catch(() => null);

  if (!total) return null;

  const division = divideXp(actors, total, { bonusOf });
  await awardXp(division);

  await ChatMessage.create({
    flavor: game.i18n.format(`${LANG_PREFIX}.flavor`, { total }),
    content: preview(total),
    whisper: gmIds(),
  });
  return division;
}

/**
 * A row's share tooltip: why the row takes a share, and for a henchman where
 * the figure came from — its own record, or the imported table with the page
 * its import recorded.
 */
function shareTip(row) {
  const reason = reasonLabel(row.reason);
  if (row.from === "record") return game.i18n.format(`${LANG_PREFIX}.shareRecord`, { reason });
  if (row.from === "imported") {
    const page = importedShareCite("xp") ?? game.i18n.localize(`${LANG_PREFIX}.shareNoPage`);
    return game.i18n.format(`${LANG_PREFIX}.shareImported`, { reason, page });
  }
  return reason;
}

/** The adjustment column: the percentage and where it was read from. */
function bonusCell(b) {
  if (!b) return "—";
  if (b.source === "tweaks") return `${signed(b.bonus)} <span class="hint">${game.i18n.localize(`${LANG_PREFIX}.bonusTweaks`)}</span>`;
  if (b.source === "keyAttribute") return `${signed(b.bonus)} <span class="hint">${foundry.utils.escapeHTML(b.attrLabel ?? "")}</span>`;
  if (b.unread) return `<span class="hint" data-tooltip="${LANG_PREFIX}.bonusCite"></span>`;
  return "—";
}

const signed = (n) => `${n > 0 ? "+" : ""}${n}%`;

/**
 * Hide core's party-overview Deal XP button while `ownXpDealing` is on: core
 * counts only `character` actors with its own party flag and ignores henchman
 * shares, and the formation is the roster of record. The button is hidden, not
 * disabled, so turning the setting off restores it untouched.
 */
export function installCoreXpSuppression() {
  Hooks.on("renderAcksPartyOverviewApp", (app, html) => {
    if (!game.settings.get(MODULE_ID, "ownXpDealing")) return;
    const root = elementOf(html);
    const button = root?.querySelector('[data-action="dealXP"]');
    if (!button) return;
    button.hidden = true;
    button.title = game.i18n.localize(`${LANG_PREFIX}.movedHint`);
  });
}
