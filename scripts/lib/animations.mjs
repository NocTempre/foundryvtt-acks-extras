/* global ChatMessage, game, Hooks */
/**
 * What Automated Animations cannot read from an attack card.
 *
 * Automated Animations has no handler for this system: its generic chat reader
 * takes the item and the actor from any card and matches an animation by the
 * item's name, so a cast, an attack and a status effect reach it with nothing
 * here. This listener fills in what that reader has no way to know, in the
 * hook it fires while it gathers a message's item, token and targets. Without
 * that module the hook never fires and nothing here runs.
 *
 * The hook runs inside the card's `createChatMessage`, so the attack is still
 * in flight (`attackInFlight`) and its target is the one the throw was made at.
 * See docs/lib/DECISIONS.md, "Automated Animations is told what a card cannot
 * say".
 */
import { attackInFlight } from "./patches/attack-throw.mjs";
import { diceSettled } from "./roll-audience.mjs";
import { ACTOR_TYPE } from "./vocab.mjs";

/** Fired by Automated Animations with the data it has gathered, before it picks an animation. */
const READ_HOOK = "aa.getRequiredData";

/** The outcome core's attack card names in a class: `critical`, `hit`, `auto-hit`, `miss` or `auto-miss`. */
const CARD_OUTCOME = /attack-throw-card__outcome--([a-z-]+)/;

/** The row of Automated Animations' default menu a weapon with no row of its own falls to, by kind of attack. */
const DEFAULT_ROW = Object.freeze({ melee: "Sword", missile: "Bow", thrown: "Dagger" });

/** The row a creature's melee attack falls to: its claw is not a sword. */
const NATURAL_ROW = "Unarmed Strike";

/** The row name an attack falls back to; an attack whose kind the throw never asked about reads as melee. */
function defaultRow({ actor, type }) {
  const row = DEFAULT_ROW[type] ?? DEFAULT_ROW.melee;
  return row === DEFAULT_ROW.melee && actor?.type !== ACTOR_TYPE.character ? NATURAL_ROW : row;
}

/**
 * The `aa.getRequiredData` listener. Writes onto Automated Animations' own data:
 * a card from a hidden token stops the workflow, since an effect on the map
 * gives its position away. On an attack card it sets the target the throw was
 * made at, the default row to fall back to, and the wait for the dice, and on a
 * public card the hit or the miss, which a whispered or blind card keeps to
 * itself by animating every attack alike. Any other card is left as it reads.
 *
 * @param {object} data  Automated Animations' gathered data: `workflow` is the
 *   ChatMessage, `token` the source, and `targets`, `extraNames`, `hitTargets`,
 *   `playOnMiss`, `deferrals` and `stopWorkflow` are its fields to answer.
 */
export function annotateForAnimation(data) {
  const message = data?.workflow;
  if (!message?.speaker) return;
  const source = data.token?.document ?? data.token;
  if (source?.hidden) {
    data.stopWorkflow = true;
    return;
  }
  // A card can name an unlinked token for an attack its world actor made.
  const { speaker } = message;
  const attack = attackInFlight(ChatMessage.getSpeakerActor(speaker)) ?? attackInFlight(game.actors.get(speaker.actor));
  const outcome = message.content?.match(CARD_OUTCOME)?.[1];
  if (!attack || !outcome) return;

  const target = attack.target?.object ?? null;
  data.targets = target ? [target] : [];
  (data.extraNames ??= []).push(defaultRow(attack));
  if (!message.blind && !message.whisper?.length) {
    data.playOnMiss = true;
    data.hitTargets = target && !outcome.includes("miss") ? [target] : [];
  }
  const dice = diceSettled(message.id);
  if (dice) (data.deferrals ??= []).push(dice);
}

/** Register the listener. */
export function installAnimationBridge() {
  Hooks.on(READ_HOOK, annotateForAnimation);
}
