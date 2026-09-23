/* global libWrapper, CONFIG, game, foundry */
/**
 * Ability-roll integration — the single owner of core's ability roll path.
 *
 * `AcksItem#rollFormula` reads one roll (`system.roll` / `rollType` /
 * `rollTarget`), so every route into it — the character sheet's proficiency
 * row, the chat card's Roll button, `item.use()`, a hotbar macro — reaches only
 * an ability's first throw. This wraps it, and `#getTags`, so all of them
 * arrive at `rollAbility()`, the same call the Rolls tab makes.
 *
 * Touches `ability` items only; every other item type falls through to
 * `wrapped()` untouched. No other feature wraps these two methods: anything
 * that needs to influence an ability roll goes through the API. Ownership,
 * and the condition under which this file is deleted: see
 * docs/abilities/DECISIONS.md, "2026-07-24 — this module owns core's ability
 * roll path".
 */
import { MODULE_ID, ABILITY_TYPE } from "./constants.mjs";
import { rollAbility, rollsOf, keyOf, defaultKeyOf, throwText } from "./ability-rolls.mjs";
import { THROW_TAG_CLASS, THROW_DEFAULT_CLASS } from "./sheet-rolls.mjs";

/**
 * Route an ability's roll through the multi-roll roller.
 *
 * An ability with no throw shows its card instead of rolling. Core's own
 * "no roll, so show it" branch in `use()` tests `system.roll`, which defaults
 * to "1d20" and is never empty, so "has a roll" is read from the store instead.
 */
async function onRollFormula(wrapped, options = {}) {
  if (this.type !== ABILITY_TYPE) return wrapped(options);

  const rolls = rollsOf(this);
  if (!rolls.length) return this.show();

  return rollAbility(this, options.key);
}

/**
 * Tag an ability with every roll it offers. Core builds one tag from
 * `system.roll` + `system.rollTarget`; this builds one per throw.
 */
function onGetTags(wrapped) {
  if (this.type !== ABILITY_TYPE) return wrapped();

  const rolls = rollsOf(this);
  if (!rolls.length) return wrapped();

  const esc = (text) => foundry.utils.escapeHTML?.(text) ?? text;
  const tag = (text) => (text ? `<li class='tag'>${esc(text)}</li>` : "");
  const current = defaultKeyOf(this);

  // Each tag carries its own KEY (sheet-rolls.mjs binds the click). Stays an
  // <li>: core wraps this string in its own <ol class="tag-list">.
  const parts = rolls.map((r, i) => {
    // `throwText` is the one renderer: a ladder with no actor shows its
    // caveat rather than one rank's number; a measure shows its dice.
    const text = [r.label, throwText(r, this.actor, this)].filter(Boolean).join(" ");
    if (!text) return "";
    const key = keyOf(r, i);
    const isDefault = rolls.length > 1 && key === current;
    return `<li class='tag ${THROW_TAG_CLASS}${isDefault ? ` ${THROW_DEFAULT_CLASS}` : ""}' data-acks-throw='${esc(key)}'>${esc(text)}</li>`;
  });

  return `${tag(this.system.requirements)}${parts.join("")}`;
}

/** Register the wrappers. Called at `ready`, once, by module.mjs. */
export function registerRollWrap() {
  if (typeof libWrapper === "undefined") {
    console.warn(
      `${MODULE_ID} | lib-wrapper is not active — ability rolls made outside this module's sheet will reach only the first roll.`,
    );
    return false;
  }
  libWrapper.register(MODULE_ID, "CONFIG.Item.documentClass.prototype.rollFormula", onRollFormula, "MIXED");
  libWrapper.register(MODULE_ID, "CONFIG.Item.documentClass.prototype.getTags", onGetTags, "MIXED");
  console.debug(`${MODULE_ID} | ability roll wrappers registered.`);
  void CONFIG;
  void game;
  return true;
}
