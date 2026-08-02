/* global game, foundry, Hooks, document */
/**
 * Item-sheet flag injector. The core weapon / ability / item schemas can't hold
 * the Monstrous Manual enum metadata (damage type, ability category, spoil
 * component data), so — when such an item is owned by a `monster` — we inject a
 * compact "ACKS Monster" fieldset that reads/writes `flags["acks-monsters"]`.
 * Consumer modules read those flags; this module only stores them.
 *
 * Uses the generic `renderApplicationV2` hook (fires for every ApplicationV2,
 * including the system's item sheet) and keys off `app.document`.
 */
import { MODULE_ID } from "./constants.mjs";
import { DAMAGE_TYPES, NATURAL_WEAPONS, SPECIAL_ABILITIES, USAGE, choicesOf } from "./config.mjs";

/** Build <option> markup from a { key: i18nLabelKey } choices map. */
function options(choices, current, blankKey) {
  const opts = [];
  if (blankKey !== undefined) {
    opts.push(`<option value="" ${!current ? "selected" : ""}>${game.i18n.localize(blankKey)}</option>`);
  }
  for (const [value, label] of Object.entries(choices)) {
    opts.push(`<option value="${value}" ${value === current ? "selected" : ""}>${game.i18n.localize(label)}</option>`);
  }
  return opts.join("");
}

/** Field definitions per item type. */
function fieldsFor(item) {
  const flag = (key, fallback = "") => item.getFlag(MODULE_ID, key) ?? fallback;
  switch (item.type) {
    case "weapon":
      return `
        <div class="acksm-flag-row">
          <label>${game.i18n.localize("ACKS-MONSTERS.item.naturalWeapon")}</label>
          <select data-field="naturalWeapon">${options(choicesOf(NATURAL_WEAPONS), flag("naturalWeapon"), "ACKS-MONSTERS.item.none")}</select>
          <label>${game.i18n.localize("ACKS-MONSTERS.item.damageType")}</label>
          <select data-field="damageType">${options(choicesOf(DAMAGE_TYPES), flag("damageType"), "ACKS-MONSTERS.item.none")}</select>
          <label class="checkbox">
            <input type="checkbox" data-field="extraordinary" ${item.getFlag(MODULE_ID, "extraordinary") ? "checked" : ""} />
            ${game.i18n.localize("ACKS-MONSTERS.item.extraordinary")}
          </label>
        </div>`;
    case "ability":
      return `
        <div class="acksm-flag-row">
          <label>${game.i18n.localize("ACKS-MONSTERS.item.abilityCategory")}</label>
          <select data-field="abilityCategory">${options(choicesOf(SPECIAL_ABILITIES), flag("abilityCategory"), "ACKS-MONSTERS.item.none")}</select>
          <label>${game.i18n.localize("ACKS-MONSTERS.item.usage")}</label>
          <select data-field="usage">${options(choicesOf(USAGE), flag("usage"), "ACKS-MONSTERS.item.none")}</select>
        </div>`;
    case "item":
      return `
        <div class="acksm-flag-row">
          <label class="checkbox">
            <input type="checkbox" data-field="spoil" ${item.getFlag(MODULE_ID, "spoil") ? "checked" : ""} />
            ${game.i18n.localize("ACKS-MONSTERS.item.spoil")}
          </label>
          <label class="checkbox">
            <input type="checkbox" data-field="component" ${item.getFlag(MODULE_ID, "component") ? "checked" : ""} />
            ${game.i18n.localize("ACKS-MONSTERS.item.component")}
          </label>
          <label>${game.i18n.localize("ACKS-MONSTERS.item.researchEffects")}</label>
          <input type="text" data-field="researchEffects"
                 value="${foundry.utils.escapeHTML((item.getFlag(MODULE_ID, "researchEffects") ?? []).join(", "))}"
                 placeholder="${game.i18n.localize("ACKS-MONSTERS.item.researchEffectsHint")}" />
        </div>`;
    default:
      return null;
  }
}

async function writeFlag(item, field, target) {
  let value;
  if (target.type === "checkbox") value = target.checked;
  else if (field === "researchEffects") {
    value = target.value
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  } else value = target.value;

  const empty = value === "" || value === false || (Array.isArray(value) && value.length === 0);
  if (empty) await item.unsetFlag(MODULE_ID, field);
  else await item.setFlag(MODULE_ID, field, value);
}

export function registerItemAnnotations() {
  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      const item = app?.document;
      if (item?.documentName !== "Item") return;
      // Only annotate monster-owned attack/ability/spoil items.
      if (item.parent?.type !== "monster") return;
      if (!["weapon", "ability", "item"].includes(item.type)) return;

      const root = element instanceof HTMLElement ? element : element?.[0];
      if (!root || root.querySelector(".acks-monsters-flags")) return;
      const inner = fieldsFor(item);
      if (!inner) return;

      const host = root.querySelector(".window-content") ?? root;
      const section = document.createElement("fieldset");
      section.className = "acks-monsters-flags";
      section.innerHTML = `<legend><i class="fa-solid fa-dragon"></i> ${game.i18n.localize("ACKS-MONSTERS.item.section")}</legend>${inner}`;

      for (const el of section.querySelectorAll("[data-field]")) {
        el.addEventListener("change", (event) => {
          const t = event.currentTarget;
          writeFlag(item, t.dataset.field, t).catch((err) =>
            console.error(`${MODULE_ID} | item flag write failed`, err),
          );
        });
      }
      host.appendChild(section);
    } catch (err) {
      console.error(`${MODULE_ID} | item annotation injection failed`, err);
    }
  });
}
