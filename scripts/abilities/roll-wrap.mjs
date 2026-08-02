/* global libWrapper, CONFIG, game, foundry */
/**
 * Ability-roll integration — the single owner of core's ability roll path.
 *
 * `AcksItem#rollFormula` is the system's ability roller, and it can only ever
 * make ONE roll: it reads `system.roll` / `system.rollType` / `system.rollTarget`
 * directly. Every route into it — the proficiency row on the character sheet,
 * the chat card's Roll button, `item.use()`, a hotbar macro — therefore reaches
 * exactly the first throw an ability has, and there is no way in for the rest.
 *
 * Rather than leave the sheet rolling one way and the rest of the game another,
 * this wraps that one method so ALL of them arrive at `rollAbility()`. The Rolls
 * tab does not get a private roller; it uses the same call these do.
 *
 * SCOPE — this wrap touches `ability` items and nothing else. Spells, weapons
 * and hand-made items fall straight through to `wrapped()`, untouched.
 *
 * OWNERSHIP (CLAUDE.md, "one owner per wrapped core method"): acks-abilities
 * owns `AcksItem#rollFormula` and `AcksItem#getTags` for the `ability` case,
 * because multi-roll abilities are this module's whole domain. No sibling may
 * wrap them; anything else needing to influence an ability roll should go
 * through the API. See docs/MODEL.md.
 *
 * HANDOFF: this exists only because the system stores one roll per ability. If
 * `system.rolls` ever becomes an array upstream, delete this file and let core
 * roll them — the store, not the roller, is the thing that has to change.
 */
import { MODULE_ID, ABILITY_TYPE } from "./constants.mjs";
import { rollAbility, rollsOf, targetOf } from "./ability-rolls.mjs";

/**
 * Route an ability's roll through the multi-roll roller.
 *
 * An ability with NO roll shows itself instead of rolling. Core means to do
 * this already — `use()` has a "no roll, so show it" branch — but it tests
 * `system.roll`, which defaults to the string "1d20" and is therefore always
 * truthy. So a proficiency that makes no throw at all (Access to Capital,
 * Bargaining, most of the economic ones) still posts a d20 scored against a
 * target of 0. Reading "has a roll" from the store instead settles it.
 */
async function onRollFormula(wrapped, options = {}) {
  if (this.type !== ABILITY_TYPE) return wrapped(options);

  const rolls = rollsOf(this);
  if (!rolls.length) return this.show();

  return rollAbility(this, options.key);
}

/**
 * Tag an ability with EVERY roll it offers, not just the first.
 *
 * Core builds one tag from `system.roll` + `system.rollTarget`. An ability with
 * four throws showed one, and a ladder showed its first rung as though fixed.
 */
function onGetTags(wrapped) {
  if (this.type !== ABILITY_TYPE) return wrapped();

  const rolls = rollsOf(this);
  if (!rolls.length) return wrapped();

  const tag = (text) => (text ? `<li class='tag'>${foundry.utils.escapeHTML?.(text) ?? text}</li>` : "");
  const suffix = (t) => (t === "below" ? "-" : t === "result" ? "" : "+");

  const parts = rolls.map((r) => {
    const target = targetOf(r, this.actor, this);
    // A ladder with no actor to resolve against says so, rather than printing
    // a number that is only true at one rank.
    const shown = target == null ? "—" : `${target}${suffix(r.rollType)}`;
    return tag([r.label, shown].filter(Boolean).join(" "));
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
