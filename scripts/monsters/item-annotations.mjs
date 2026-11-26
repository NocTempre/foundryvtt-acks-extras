/* global game, foundry, Hooks */
/**
 * Item-sheet annotation injector. Core's ability / item schemas cannot hold the
 * monster enum metadata (ability category, spoil component data), so an item
 * owned by a `monster` gets an "ACKS Monster" group that reads and writes
 * `flags["acks-extras"]`; the monster sheet's abilities and spoils tabs render
 * tags from those flags. A weapon's damage type and extraordinary mark are
 * core's own fields (`system.damage.base.types` and `.extraordinary`, which
 * core's attack roll reads), so the group edits those through `item.update`;
 * only the natural-weapon choice is a flag, since core has no field for it.
 *
 * Hooks the generic `renderApplicationV2` (it fires for the system's item
 * sheet too) and keys off `app.document`. The group goes INSIDE the sheet's
 * scrolling body, last in its Details tab, so it scrolls with the tab and
 * shows on no other: a block appended to `.window-content` sits outside every
 * part's scroller, keeps its full height, and takes it from the body.
 */
import { MODULE_ID } from "./constants.mjs";
import { DAMAGE_TYPES, NATURAL_WEAPONS, SPECIAL_ABILITIES, USAGE, choicesOf } from "./config.mjs";
import { ACTOR_TYPE, ITEM_TYPE } from "../lib/vocab.mjs";
import { elementOf } from "../lib/util.mjs";
import { findItemSheetHost, scrollerOf } from "../lib/item-sheet-host.mjs";
import { coreDamageKey, damageTypeUpdate, extraordinaryOf, ownDamageType } from "../lib/damage-type.mjs";

const SECTION_CLASS = "acks-monsters-flags";
const ANNOTATED_TYPES = [ITEM_TYPE.weapon, ITEM_TYPE.ability, ITEM_TYPE.item];

/** Scroll offsets read before a re-render, re-applied once the group is back. */
const pendingScroll = new WeakMap();

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

/** A labelled select: the label wraps its control, so each window's copy names its own. */
function selectField(labelKey, field, choices, current) {
  return `
    <label class="${SECTION_CLASS}__field">
      <span class="${SECTION_CLASS}__label">${game.i18n.localize(labelKey)}</span>
      <select data-field="${field}">${options(choices, current, "ACKS-MONSTERS.item.none")}</select>
    </label>`;
}

/** A checkbox row spanning the group's width. */
function checkField(labelKey, field, checked) {
  return `
    <label class="${SECTION_CLASS}__check">
      <input type="checkbox" data-field="${field}" ${checked ? "checked" : ""} />
      ${game.i18n.localize(labelKey)}
    </label>`;
}

/** The damage types the system's weapon accepts, as a choices map. */
const coreChoices = () => Object.fromEntries(Object.entries(choicesOf(DAMAGE_TYPES)).filter(([key]) => coreDamageKey(key)));

/** Field definitions per item type. */
function fieldsFor(item) {
  const flag = (key, fallback = "") => item.getFlag(MODULE_ID, key) ?? fallback;
  switch (item.type) {
    case ITEM_TYPE.weapon:
      return (
        selectField("ACKS-MONSTERS.item.naturalWeapon", "naturalWeapon", choicesOf(NATURAL_WEAPONS), flag("naturalWeapon")) +
        selectField("ACKS-MONSTERS.item.damageType", "damageType", coreChoices(), ownDamageType(item) ?? "") +
        checkField("ACKS-MONSTERS.item.extraordinary", "extraordinary", extraordinaryOf(item))
      );
    case ITEM_TYPE.ability:
      return (
        selectField("ACKS-MONSTERS.item.abilityCategory", "abilityCategory", choicesOf(SPECIAL_ABILITIES), flag("abilityCategory")) +
        selectField("ACKS-MONSTERS.item.usage", "usage", choicesOf(USAGE), flag("usage"))
      );
    case ITEM_TYPE.item:
      return (
        checkField("ACKS-MONSTERS.item.spoil", "spoil", item.getFlag(MODULE_ID, "spoil")) +
        checkField("ACKS-MONSTERS.item.component", "component", item.getFlag(MODULE_ID, "component")) +
        `
        <label class="${SECTION_CLASS}__field is-wide">
          <span class="${SECTION_CLASS}__label">${game.i18n.localize("ACKS-MONSTERS.item.researchEffects")}</span>
          <input type="text" data-field="researchEffects"
                 value="${foundry.utils.escapeHTML((item.getFlag(MODULE_ID, "researchEffects") ?? []).join(", "))}"
                 placeholder="${game.i18n.localize("ACKS-MONSTERS.item.researchEffectsHint")}" />
        </label>`
      );
    default:
      return null;
  }
}

/**
 * Write one group control. A weapon's damage type and extraordinary mark go to
 * the system's fields, which core's roll reads, and set no flag; every other
 * control is a flag of the module.
 */
async function writeField(item, field, target) {
  if (item.type === ITEM_TYPE.weapon && field === "damageType") return item.update(damageTypeUpdate(target.value));
  if (item.type === ITEM_TYPE.weapon && field === "extraordinary") return item.update({ "system.damage.base.extraordinary": target.checked });
  return writeFlag(item, field, target);
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

  // A picked frequency replaces the importer's phrase for the previous one.
  if (field === "usage" && item.getFlag(MODULE_ID, "usageText") !== undefined) await item.unsetFlag(MODULE_ID, "usageText");
  const empty = value === "" || value === false || (Array.isArray(value) && value.length === 0);
  if (empty) await item.unsetFlag(MODULE_ID, field);
  else await item.setFlag(MODULE_ID, field, value);
}

/** The item sheet's document when it is an annotated item owned by a monster, else null. */
function annotatedItem(app) {
  const item = app?.document;
  if (item?.documentName !== "Item") return null;
  if (item.parent?.type !== ACTOR_TYPE.monster) return null;
  return ANNOTATED_TYPES.includes(item.type) ? item : null;
}

/**
 * Register the render hooks that place the annotation group in monster-owned
 * item sheets. The group is added after core has restored each part's scroll
 * offset, and a group at the end of a scroller lengthens it: an offset inside
 * the group was clamped to the shorter body, so it is read before the render
 * and put back once the group is in.
 */
export function registerItemAnnotations() {
  Hooks.on("preRenderApplicationV2", (app) => {
    try {
      if (!annotatedItem(app)) return;
      const root = elementOf(app.element);
      const section = root?.querySelector(`.${SECTION_CLASS}`);
      const scroller = section ? scrollerOf(section, root) : null;
      if (scroller) pendingScroll.set(app, scroller.scrollTop);
    } catch (err) {
      console.error(`${MODULE_ID} | item annotation scroll read failed`, err);
    }
  });

  Hooks.on("renderApplicationV2", (app, element) => {
    try {
      const item = annotatedItem(app);
      if (!item) return;
      const root = elementOf(element);
      if (!root || root.querySelector(`.${SECTION_CLASS}`)) return;
      const inner = fieldsFor(item);
      if (!inner) return;

      const host = findItemSheetHost(root);
      const section = host.ownerDocument.createElement("div");
      section.className = SECTION_CLASS;
      section.setAttribute("role", "group");
      section.setAttribute("aria-label", game.i18n.localize("ACKS-MONSTERS.item.section"));
      section.innerHTML = `<div class="${SECTION_CLASS}__head">${game.i18n.localize("ACKS-MONSTERS.item.section")}</div><div class="${SECTION_CLASS}__fields">${inner}</div>`;

      for (const el of section.querySelectorAll("[data-field]")) {
        el.addEventListener("change", (event) => {
          // The host sheet submits its form on a bubbling change; the group's write is its own.
          event.stopPropagation();
          const t = event.currentTarget;
          writeField(item, t.dataset.field, t).catch((err) =>
            console.error(`${MODULE_ID} | item annotation write failed`, err),
          );
        });
      }
      host.appendChild(section);

      const saved = pendingScroll.get(app);
      pendingScroll.delete(app);
      const scroller = scrollerOf(section, root);
      if (scroller && saved > scroller.scrollTop) scroller.scrollTop = saved;
    } catch (err) {
      console.error(`${MODULE_ID} | item annotation injection failed`, err);
    }
  });
}
