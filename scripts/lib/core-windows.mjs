/* global CONFIG, ui, game */
/**
 * Reaching the system's own character windows — Tweaks, Mortal Wounds,
 * Tampering with Mortality, the Modifiers summary, the Scores Generator —
 * from a window that is not the system's sheet.
 *
 * The system ships as one minified bundle with no exports, so those classes
 * cannot be imported. They can be REACHED: the system's character sheet is in
 * the sheet registry, and an ApplicationV2 keeps its action handlers on
 * `DEFAULT_OPTIONS.actions`, where a private static method is stored as a
 * plain function. Each of the five reads nothing but `this.actor`, so calling
 * it with `{actor}` for `this` opens the very window core's sheet opens. See
 * docs/character-sheet/DECISIONS.md, "Core windows are reached through the
 * sheet registry, not reimplemented".
 */
import { ACTOR_TYPE } from "./vocab.mjs";
import { LANG_PREFIX } from "./constants.mjs";
import { makeLoc } from "./util.mjs";

const loc = makeLoc(LANG_PREFIX);

/**
 * The action handlers a sheet class answers to, merged down its inheritance
 * chain the way ApplicationV2 merges `DEFAULT_OPTIONS` at construction. The
 * system keeps Tweaks on its base actor sheet and the character windows on
 * the character subclass, so reading one class's own static finds only half.
 */
export function sheetActions(cls) {
  const chain = [];
  for (let c = cls; typeof c === "function" && c !== Function.prototype; c = Object.getPrototypeOf(c)) chain.unshift(c);
  const actions = {};
  for (const c of chain) {
    if (Object.hasOwn(c, "DEFAULT_OPTIONS")) Object.assign(actions, c.DEFAULT_OPTIONS?.actions ?? {});
  }
  return actions;
}

/** The system's registered character sheet class, found by scope rather than by name. */
export function coreCharacterSheetClass() {
  const entries = CONFIG.Actor?.sheetClasses?.[ACTOR_TYPE.character] ?? {};
  for (const [id, entry] of Object.entries(entries)) {
    if (!id.startsWith(`${game.system.id}.`)) continue;
    const actions = sheetActions(entry?.cls);
    if (actions.showTweaksDialog || actions.generateScores) return entry.cls;
  }
  return null;
}

/** Every core action a character can be handed to. */
export const CORE_ACTIONS = Object.freeze({
  tweaks: "showTweaksDialog",
  mortalWounds: "rollMortalWounds",
  tampering: "rollTamperingWithMortality",
  modifiers: "showModifiersSummary",
  generateScores: "generateScores",
});

/**
 * Open one of the system's character windows for `actor`.
 * @returns {boolean} whether the window was reachable
 */
export function openCoreWindow(key, actor) {
  const action = CORE_ACTIONS[key];
  const cls = coreCharacterSheetClass();
  const handler = cls ? sheetActions(cls)[action] : null;
  if (typeof handler !== "function") {
    ui.notifications?.warn(loc("core.unreachable", { what: key }));
    return false;
  }
  try {
    handler.call({ actor, document: actor, isEditable: actor.isOwner }, new Event("click"), null);
    return true;
  } catch (err) {
    console.error(`acks-extras | core window "${key}" failed to open`, err);
    ui.notifications?.warn(loc("core.unreachable", { what: key }));
    return false;
  }
}
