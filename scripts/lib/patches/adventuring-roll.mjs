/* global CONFIG, ChatMessage, Roll, foundry, game */
/**
 * Core patch: the adventuring throws the Judge makes in secret (RR 265) are
 * posted blind.
 *
 * Core's `rollAdventuring` builds its roll with no blind flag and takes no
 * option that sets one. Every sheet's adventuring row — the system's, this
 * module's, the Follower Card's — ends in that method, so the wrapper is the
 * one place a secret throw is told from the rest. A secret throw is posted
 * here, on the system's own card and under the system's own blind contract:
 * whispered to the GMs with `blind` set, or whispered to the roller alone when
 * the roller is a GM. Foundry shows a blind message's author `???` in place of
 * its content, and the card's body carries the mark core's render hook
 * withholds. The message carries no roll, as core's carries none: a whisper
 * that does is shown to every seat as a placeholder. Every other throw runs
 * core's roll.
 *
 * This is the method's one wrapper, so what else reaches an adventuring throw
 * rides it: both paths run inside `withAdventuringConditions`, which holds the
 * creature's conditions on the stored target while it is read.
 *
 * See docs/lib/DECISIONS.md, "The throws the Judge makes in secret are posted
 * blind by the adventuring throw's one wrapper".
 */
import { MODULE_ID } from "../constants.mjs";
import { gmIds } from "../util.mjs";
import { rollDetailsDialog, skipDialogFor, situationalTerm } from "../roll-dialog.mjs";
import { showDice } from "../roll-audience.mjs";
import { withAdventuringConditions } from "../status-effects.mjs";

/** The `system.adventuring` keys whose throw is the Judge's to make in secret (RR 265). */
export const SECRET_ADVENTURING = Object.freeze(["listening", "searching"]);

/** The system's own throw card; its `.blindable` body is what core's render hook withholds. */
const CARD_TEMPLATE = "systems/acks/templates/chat/roll-result.hbs";

const esc = (text) => foundry.utils.escapeHTML?.(String(text ?? "")) ?? String(text ?? "");

/**
 * Make one secret adventuring throw and post it blind. The target is read
 * before anything is awaited, so a shift held across the call is the figure
 * thrown against. The dialog states the visibility and asks only for a
 * situational modifier; the system's skip key rolls without it.
 *
 * The wrapper's own route for a secret key, and the route of a surface that
 * throws against a figure the actor does not store: `target` replaces the
 * stored one, and the creature's conditions are then the caller's to apply.
 *
 * @param {Actor} actor
 * @param {string} advKey one of `SECRET_ADVENTURING`
 * @param {object} [opts]
 * @param {Event} [opts.event]    the gesture that asked, read for the skip key
 * @param {number} [opts.target]  thrown against in place of the stored target
 * @returns {Promise<Roll|undefined>} the Roll, or undefined when the dialog is
 *   closed — what core's own roll answers
 */
export async function rollSecretAdventuring(actor, advKey, { event, target: stated } = {}) {
  const target = stated ?? actor.system?.adventuring?.[advKey];
  const title = game.i18n.format("ACKS.roll.adventuring", { adventuring: game.i18n.localize(`ACKS.adventuring.${advKey}`) });
  // Core's distinction: a GM's own blind throw is whispered to that GM.
  const blind = !game.user.isGM;
  let bonus = 0;
  if (!skipDialogFor(event)) {
    const asked = await rollDetailsDialog({ title, formula: "1d20", messageMode: blind ? "blind" : "self", lockMode: true });
    if (!asked) return undefined;
    bonus = asked.bonus;
  }
  // The Roll carries its target where core's does, for a caller that reads it.
  const rollData = { roll: { target, blindroll: true } };
  const roll = await new Roll(`1d20${situationalTerm(bonus)}`, rollData).evaluate();
  const success = roll.total >= target;
  const dice = await roll.render();

  let content;
  try {
    content = await foundry.applications.handlebars.renderTemplate(CARD_TEMPLATE, {
      title,
      data: { actor: { img: actor.img }, ...rollData },
      result: { isSuccess: success, isFailure: !success, target },
      rollACKS: dice,
    });
  } catch (err) {
    // A moved or renamed core template costs the throw its banner, never its
    // secrecy: the stand-in keeps the body core's hook withholds.
    console.error(`${MODULE_ID} | could not render ${CARD_TEMPLATE}; posting the throw without its card`, err);
    const word = game.i18n.localize(success ? "ACKS.Success" : "ACKS.Failure");
    content = `<h2>${esc(title)}</h2><div class="blindable" data-blind="true"><b>${esc(word)}</b> (${esc(target)})${dice}</div>`;
  }

  const whisper = blind ? gmIds() : [game.user.id];
  await showDice(roll, { whisper, blind });
  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    content,
    whisper,
    blind,
    // Core's own cue when no dice box plays one.
    ...(game.dice3d ? {} : { sound: CONFIG.sounds?.dice }),
  });
  return roll;
}

/**
 * MIXED form: a secret throw is posted here and core's roll is not called;
 * every other throw is core's. Either runs with the creature's conditions
 * held on the target.
 */
function onRollAdventuring(wrapped, advKey, ...rest) {
  const roll = SECRET_ADVENTURING.includes(advKey)
    ? () => rollSecretAdventuring(this, advKey, { event: rest[0]?.event })
    : () => wrapped(advKey, ...rest);
  return withAdventuringConditions(this, advKey, roll);
}

/**
 * Install at `ready`, when the system's Actor class is final. A registration
 * that fails leaves adventuring throws the system's own and costs nothing
 * else.
 */
export function installAdventuringRollPatch() {
  const proto = CONFIG.Actor?.documentClass?.prototype;
  if (typeof proto?.rollAdventuring !== "function") {
    console.warn(`${MODULE_ID} | no Actor#rollAdventuring to wrap; adventuring throws stay the system's own.`);
    return;
  }
  try {
    if (globalThis.libWrapper?.register) {
      globalThis.libWrapper.register(MODULE_ID, "CONFIG.Actor.documentClass.prototype.rollAdventuring", onRollAdventuring, "MIXED");
      return;
    }
    const original = proto.rollAdventuring;
    proto.rollAdventuring = function (...args) {
      return onRollAdventuring.call(this, (...inner) => original.apply(this, inner), ...args);
    };
  } catch (err) {
    console.error(`${MODULE_ID} | could not wrap rollAdventuring; adventuring throws stay the system's own`, err);
  }
}
