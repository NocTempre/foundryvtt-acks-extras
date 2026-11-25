/* global game, ui */
/**
 * Where a die typed into the Unarmed Strike prompt is kept: on the world, as
 * the Judge's override of the `unarmedStrike` table, or on the character, as a
 * flag its owner writes. The two writes and the tests of who may make them.
 */
import { LANG, MODULE_ID, ACTOR_FLAGS } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { PRINTED_FIGURE_TABLES } from "./attack-mods.mjs";
import { RULEDATA_DOC } from "./overlays/scavenged.mjs";

const loc = makeLoc(LANG);

/** The permission Foundry asks of a write to a world setting, which is where the world's die is stored. */
const KEEP_PERMISSION = "SETTINGS_MODIFY";

/** Whether this seat may keep a die for the world. */
export const mayKeepUnarmedDie = () => !!game.user?.can?.(KEEP_PERMISSION);

/**
 * Which keep this seat is offered for a strike by `actor`: `"world"` where it
 * may modify world settings, else `"character"` where Foundry lets it update
 * the actor, else null.
 * @returns {"world"|"character"|null}
 */
export function keepScopeFor(actor) {
  if (mayKeepUnarmedDie()) return "world";
  if (actor?.canUserModify?.(game.user, "update")) return "character";
  return null;
}

/**
 * Keep `die` as the world's unarmed die: the Judge's override of the
 * `unarmedStrike` table's damage, through the `ruledata-import` contract.
 * Resolves whether it was written; a failure is said on the screen.
 * @param {string} die
 * @returns {Promise<boolean>}
 */
export async function keepUnarmedDie(die) {
  const svc = globalThis.acksExtras?.lib?.services?.get?.("ruledata-import");
  try {
    if (typeof svc?.setOverride !== "function") throw new Error("no provider can write an override");
    await svc.setOverride(RULEDATA_DOC, PRINTED_FIGURE_TABLES.unarmed, { damage: die }, { sourceName: "unarmed strike prompt" });
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | the unarmed die was not kept`, err);
    ui.notifications?.warn(loc("damagePrompt.keepFailed"));
    return false;
  }
}

/**
 * Keep `die` on the character: the flag its Unarmed Strike reads first.
 * Resolves whether it was written; a failure is said on the screen.
 * @param {Actor} actor
 * @param {string} die
 * @returns {Promise<boolean>}
 */
export async function keepCharacterDie(actor, die) {
  try {
    await actor.setFlag(MODULE_ID, ACTOR_FLAGS.UNARMED_DIE, die);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | the character's unarmed die was not kept`, err);
    ui.notifications?.warn(loc("damagePrompt.keepCharacterFailed", { name: actor?.name ?? "" }));
    return false;
  }
}

/**
 * Clear the die kept on a character, so its strike reads the world's. Resolves
 * whether the flag is gone.
 * @param {Actor} actor
 * @returns {Promise<boolean>}
 */
export async function clearCharacterDie(actor) {
  try {
    await actor.unsetFlag(MODULE_ID, ACTOR_FLAGS.UNARMED_DIE);
    return true;
  } catch (err) {
    console.warn(`${MODULE_ID} | the character's unarmed die was not cleared`, err);
    return false;
  }
}
