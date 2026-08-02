/* global game, foundry, ui */
/**
 * "Hire as Group" — assemble a unit from the location's available market and
 * hire it as ONE acks-lib.group: pick troop rows (with quantities) and an
 * optional officer, and the engine turns troops into counted merc stacks and
 * links the officer as commander (see engine/hire-group.mjs). Troops = the
 * mercenary rows; officers = the mercOfficer/marshal leader specialists.
 */
import { hireAsGroup } from "../engine/hire-group.mjs";
import { pickEmployer } from "./recruit-dialog.mjs";

const isOfficer = (c) => /^(mercOfficer|marshal)/i.test(c.specialistType ?? "");
const isTroop = (c) => c.kind === "mercenary" || !!c.troopType;

/** Localised troop-type name, falling back to the raw key. */
function troopLabel(c) {
  const key = `ACKS-HENCHMEN.troop.${c.troopType}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : c.troopType || c.name || "Trooper";
}

/** Localised officer label, disambiguated by the officer's own name (several
 *  of a type can be on the market — a bare type label repeats in a dropdown). */
function officerLabel(c) {
  const key = `ACKS-HENCHMEN.specialist.${c.specialistType}`;
  const base = game.i18n.has(key) ? game.i18n.localize(key) : c.specialistType || "Officer";
  return c.name && c.name !== c.specialistType ? `${base} — ${c.name}` : base;
}

/**
 * Wire the +/− steppers and the "take all" affordance on the group dialog, and
 * keep every count within [0, cap]. Event-delegated off the dialog root so it
 * survives DialogV2's DOM, and defensive: a missing root simply leaves the
 * number inputs (which already carry min/max) as the fallback.
 */
function wireSteppers(root) {
  if (!(root instanceof HTMLElement)) return;
  const clamp = (input) => {
    const cap = Number(input.dataset.cap) || 0;
    const v = Math.floor(Number(input.value) || 0);
    input.value = String(Math.max(0, Math.min(cap, v)));
  };
  const inputFor = (target) => (target ? root.querySelector(`[name="${target}"]`) : null);
  root.addEventListener("click", (event) => {
    const step = event.target.closest(".hg-step");
    if (step) {
      const input = inputFor(step.dataset.target);
      if (input) {
        input.value = String((Number(input.value) || 0) + Number(step.dataset.delta));
        clamp(input);
      }
      return;
    }
    const max = event.target.closest(".hg-max");
    if (max) {
      const input = inputFor(max.dataset.target);
      if (input) input.value = input.dataset.cap ?? input.value;
    }
  });
  root.addEventListener("input", (event) => {
    if (event.target.matches?.('input[type="number"][data-cap]')) clamp(event.target);
  });
}

export async function openHireGroupDialog(location) {
  const employer = await pickEmployer(game.user.character);
  if (!employer) return ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.group.noEmployer"));

  const available = (location.system.candidates ?? []).map((c) => c.toObject?.() ?? c).filter((c) => c.status === "available");
  const troops = available.filter(isTroop);
  const officers = available.filter(isOfficer);
  if (!troops.length && !officers.length) return ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.group.noneAvailable"));

  const esc = foundry.utils.escapeHTML;
  // Each troop type is a stepper capped at what the market has (0 = not taken).
  // The number stays editable (type a big count directly); the − / + step by
  // one; the "/ N" affordance fills to the cap. All three respect the cap.
  const cap = (c) => Math.max(0, Number(c.quantity ?? 1));
  const troopCells = troops
    .map(
      (c) => `<div class="hg-cell">
        <span class="hg-name" title="${esc(troopLabel(c))}">${esc(troopLabel(c))}</span>
        <div class="hg-stepper">
          <button type="button" class="hg-step" data-target="q_${c.id}" data-delta="-1" aria-label="−">&minus;</button>
          <input type="number" name="q_${c.id}" value="0" min="0" max="${cap(c)}" data-cap="${cap(c)}" inputmode="numeric" />
          <button type="button" class="hg-step" data-target="q_${c.id}" data-delta="1" aria-label="+">+</button>
        </div>
        <button type="button" class="hg-max" data-target="q_${c.id}" title="${game.i18n.localize("ACKS-HENCHMEN.group.takeAll")}">${game.i18n.format("ACKS-HENCHMEN.group.ofAvailable", { n: cap(c) })}</button>
      </div>`
    )
    .join("");
  const officerBlock = officers.length
    ? `<div class="hg-officer">
        <label for="hg-officer-select">${game.i18n.localize("ACKS-HENCHMEN.group.officer")}</label>
        <select id="hg-officer-select" name="officer">
          <option value="">${game.i18n.localize("ACKS-HENCHMEN.group.noOfficer")}</option>
          ${officers.map((c) => `<option value="${c.id}">${esc(officerLabel(c))}</option>`).join("")}
        </select>
      </div>`
    : "";

  const content = `<div class="acks-henchmen-hire-group">
      <p>${game.i18n.format("ACKS-HENCHMEN.group.forEmployer", { name: esc(employer.name) })}</p>
      ${troops.length ? `<fieldset><legend>${game.i18n.localize("ACKS-HENCHMEN.group.troops")}</legend><div class="hg-grid">${troopCells}</div></fieldset>` : ""}
      ${officerBlock}
    </div>`;

  const picks = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("ACKS-HENCHMEN.group.hireTitle") },
    content,
    render: (_event, dialog) => wireSteppers(dialog?.element),
    ok: {
      label: game.i18n.localize("ACKS-HENCHMEN.group.hireButton"),
      callback: (_event, button) => {
        const f = button.form.elements;
        const chosen = troops
          .map((c) => ({
            candidateId: c.id,
            // Clamp again here so the cap holds even if the UI wiring never ran.
            quantity: Math.max(0, Math.min(cap(c), Math.floor(Number(f[`q_${c.id}`]?.value) || 0))),
          }))
          .filter((x) => x.quantity > 0);
        return { troops: chosen, officerCandidateId: f.officer?.value || null };
      },
    },
  }).catch(() => null);
  if (!picks || (!picks.troops.length && !picks.officerCandidateId)) return;

  const result = await hireAsGroup(location, employer, picks);
  if (result.error) {
    return ui.notifications.warn(game.i18n.format("ACKS-HENCHMEN.group.hireFailed", { reason: result.error }));
  }
  ui.notifications.info(
    game.i18n.format("ACKS-HENCHMEN.group.hiredInfo", { group: result.group.name, stacks: result.stacks.length })
  );
  result.group.sheet?.render(true);
  location.sheet?.render(false);
}
