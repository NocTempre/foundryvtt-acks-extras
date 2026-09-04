/* global game, Hooks, ui, document */
/**
 * CLASS MODIFIERS — the character's combat training as its own section of the
 * SYSTEM sheet's Effects tab, above the ordinary effect list, each slot a
 * toggle at class granularity. The module's own character sheet does not
 * mount this: its Stats tab is the one editor, at weapon granularity.
 *
 * The training arrives as an Active Effect whose changes are three CSV strings.
 * In core's effect list that is one row named after the class, and the only way
 * to change what it grants is to open it and hand-edit `dual,twoHanded,
 * weaponShield` in a text field — an editor for the storage format rather than
 * for the thing. So the effect is LIFTED OUT of that list and drawn as the same
 * slot strip the Inventory tab and the follower card use, except that here the
 * pills are buttons: click one and the grant changes. Unarmed is no weapon in
 * the grant grammar — every body strikes unarmed — so its chip only shows.
 *
 * It is the same effect either way. Nothing is duplicated, nothing new is
 * stored, and the section disappears with the effect — a character with no
 * class applied has no Class modifiers section, not an empty one.
 *
 * The loadout effect deliberately does NOT come here. It is derived from what
 * is equipped and recomputed on every change, so there is nothing about it a
 * toggle could hold; it stays in the ordinary list, locked
 * (lib/managed-effects.mjs).
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { SLOT_VOCAB } from "../lib/proficiency-strip.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
import { trainingEffect, grantedKeys, toggleTraining, trainingSourceName } from "./training.mjs";
import { locOr as loc } from "../lib/util.mjs";

// Written out rather than composed: the CSS/JS gate matches selector classes
// literally, and a name built with a template literal reads to it as a dead
// CSS rule that nothing uses.
const SECTION = "acks-extras-classes-modifiers";
const CLS = Object.freeze({
  title: "acks-extras-classes-modifiers__title",
  titleText: "acks-extras-classes-modifiers__title-text",
  source: "acks-extras-classes-modifiers__source",
  disabled: "acks-extras-classes-modifiers__disabled",
  hint: "acks-extras-classes-modifiers__hint",
});

const el = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
};

/** One slot group: its caps label and its row of toggle pills. */
function buildGroup(actor, effect, group, labelKey, tipKey, editable) {
  const wrap = el("span", "fc-build-group");
  wrap.dataset.tooltip = game.i18n.localize(tipKey);
  wrap.append(el("span", "fc-build-label", game.i18n.localize(labelKey)));

  const granted = grantedKeys(effect, group);
  const chip = group === "weapons";
  for (const slot of SLOT_VOCAB[group]) {
    const on = granted.has(slot.key);
    const pill = el("button", `fc-pill${chip ? " chip" : ""}${on ? " on" : ""}`);
    pill.type = "button";
    pill.dataset.tooltip = loc(slot.label, slot.fallback);
    pill.dataset.group = group;
    pill.dataset.slot = slot.key;
    pill.setAttribute("aria-pressed", String(on));
    if (chip) pill.textContent = slot.chip;
    else {
      const icon = el("i");
      icon.className = slot.icon;
      pill.append(icon);
    }
    if (!editable || slot.key === "unarmed") pill.disabled = true;
    else {
      pill.addEventListener("click", (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        // Our controls live inside core's <form>, and an ApplicationV2 sheet
        // submits on change: an unstopped event reaches core's delegated
        // handler and submits the sheet underneath us.
        // A lit chip withdraws its class. At class granularity a chip lights
        // when ANY of the class is granted, so left to decide for itself a
        // partly covered class would complete rather than clear.
        toggleTraining(actor, group, slot.key, { on: chip ? !on : null }).catch((err) => {
          console.error(`${MODULE_ID} | toggling class training failed`, err);
          ui.notifications?.error(game.i18n.localize(`${LANG_PREFIX}.modifiers.failed`));
        });
      });
    }
    wrap.append(pill);
  }
  return wrap;
}

/**
 * Build the section, or null when this actor has no training to show.
 * Read-only for a user who may not edit the actor: the pills still SHOW the
 * grant, because what a character is trained in is not a secret — they simply
 * do not answer the mouse.
 */
function buildSection(actor) {
  const effect = trainingEffect(actor);
  if (!effect) return null;
  const editable = actor.isOwner;

  const section = el("section", SECTION);
  const head = el("div", CLS.title);
  head.append(el("span", CLS.titleText, game.i18n.localize(`${LANG_PREFIX}.modifiers.section`)));
  const source = trainingSourceName(actor);
  if (source) head.append(el("span", CLS.source, source));
  if (effect.disabled) {
    head.append(el("span", CLS.disabled, game.i18n.localize(`${LANG_PREFIX}.modifiers.disabled`)));
  }
  section.append(head);

  const strip = el("div", "acks-lib-build");
  strip.append(
    buildGroup(actor, effect, "styles", "ACKS-LIB.followerCard.stylesShort", "ACKS-LIB.followerCard.styles", editable),
    buildGroup(actor, effect, "weapons", "ACKS-LIB.followerCard.weaponShort", "ACKS-LIB.followerCard.weaponProf", editable),
    buildGroup(actor, effect, "armour", "ACKS-LIB.followerCard.armourShort", "ACKS-LIB.followerCard.armourProf", editable),
  );
  section.append(strip);
  section.append(el("p", CLS.hint, game.i18n.localize(`${LANG_PREFIX}.modifiers.hint`)));
  return section;
}

/**
 * Mount the section on the Effects tab and take the training row out of the
 * ordinary list — the row and the section are the same document, and showing
 * both would be two controls for one thing that can disagree on screen.
 */
function onRenderCharacterSheet(app, element) {
  try {
    const actor = app?.document;
    if (actor?.documentName !== "Actor" || actor.type !== ACTOR_TYPE.character) return;
    const root = element instanceof HTMLElement ? element : element?.[0];
    const tab = root?.querySelector?.(".active-effects");
    if (!tab || tab.querySelector(`.${SECTION}`)) return;

    const effect = trainingEffect(actor);
    if (effect) {
      for (const row of tab.querySelectorAll(`[data-effect-id="${effect.id}"]`)) {
        row.closest(".effect")?.remove();
      }
    }
    const section = buildSection(actor);
    if (!section) return;
    const content = tab.querySelector(".effects-list-content");
    if (content?.parentElement) content.parentElement.insertBefore(section, content);
    else tab.prepend(section);
  } catch (err) {
    console.error(`${MODULE_ID} | class-modifiers section failed; core's effect list stands`, err);
  }
}

export function registerClassModifiers() {
  Hooks.on("renderApplicationV2", onRenderCharacterSheet);
  Hooks.on("renderActorSheetV2", onRenderCharacterSheet);
  console.debug(`${MODULE_ID} | class modifiers section registered.`);
}
