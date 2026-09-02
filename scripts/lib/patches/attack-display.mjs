/* global game, Hooks */
/**
 * Core patch (display half of patches/attack-roll.mjs): the character sheet's
 * Melee/Ranged boxes, REPLACED at every render.
 *
 * Core's attributes tab prints Melee/Ranged as `ability mod + attack adjustment`
 * — a bonus-only number with the attack throw (the moving target) omitted, so
 * editing the throw never visibly changes it and the number contradicts what the
 * roll actually does. Core is a read-only reference, so the wrong display cannot
 * be deleted at the source; instead this hook overwrites the rendered value and
 * tooltip on every render, making the folded number UNREACHABLE in play. The
 * replacement states the model the patched roll uses:
 *
 *     10+ +2      — attack throw (target, moves with class/level) · roll bonus
 *
 * The rollable headers keep their own `data-action="rollAttack"` wiring — only
 * the displayed value/tooltip are superseded. Character sheets only: monsters
 * have no such boxes, and the Follower Card already renders the split.
 */
import { toNum as num } from "../util.mjs";
import { MODULE_ID } from "../constants.mjs";
import { ACTOR_TYPE } from "../vocab.mjs";

const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

/** The equipment subsystem, when it is live. Optional by design. */
const equipment = () => globalThis.acksExtras?.equipment ?? game.modules?.get(MODULE_ID)?.api?.equipment ?? null;

/**
 * The stat these buttons state — Strength or Dexterity, whichever this
 * character's throw actually keys on. Equipment owns that decision (Weapon
 * Finesse re-keys melee), and the same call backs the button's ROLL, so the two
 * cannot drift. Without equipment the boxes fall back to the plain reading.
 */
function bestBonus(actor, type) {
  const api = equipment();
  if (!api?.bestAttackBonus) return null;
  try {
    const b = api.bestAttackBonus(actor, type);
    return b && Number.isFinite(b.total) ? b : null;
  } catch {
    return null;
  }
}

/** A score's own name, from the system's field labels; the key if it has none. */
function scoreLabel(key) {
  const path = globalThis.CONFIG?.ACKS?.scores?.[key];
  const label = typeof path === "string" ? game.i18n.localize(path) : "";
  return label && label !== path ? label : key.toUpperCase();
}

function fixAttackDisplays(app, element) {
  if (game.system?.id !== "acks") return;
  const actor = app.actor ?? app.document;
  if (actor?.type !== ACTOR_TYPE.character) return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const sys = actor.system;
  const T = num(sys.thac0?.throw, 10);
  for (const type of ["melee", "missile"]) {
    const header = root.querySelector(`a[data-action="rollAttack"][data-attack="${type}"]`);
    const input = header?.closest(".form-group")?.querySelector("input");
    if (!input) continue; // not this sheet's markup (e.g. the Follower Card)
    // These buttons name no weapon, so they answer for the CHARACTER: the base
    // attack throw and the stat, which is what a table needs off the cuff. The
    // situational terms are deliberately absent — `system.thac0.mod` (where the
    // current loadout and any magic item deposit their results), a weapon's own
    // bonus, a style bonus. The weapon's own roll applies all of those exactly,
    // and a summary carrying them would disagree with the dice.
    //
    // Melee and Ranged stay separate, as they are on the sheet: each asks
    // equipment for its own throw, so neither figure can reach the other.
    const best = bestBonus(actor, type);
    const abilityKey = best?.abilityKey ?? (type === "missile" ? "dex" : "str");
    const bonus = best ? best.total : num(sys.scores?.[abilityKey]?.mod);
    input.value = `${T}+ ${signed(bonus)}`;
    input.dataset.dtype = "String";
    input.dataset.tooltip = game.i18n.format("ACKS-LIB.attack.displayTooltip", {
      target: T,
      bonus: signed(bonus),
      ability: scoreLabel(abilityKey),
    });
  }
}

/** Registered alongside the roll patch, under the same world setting. */
export function installAttackDisplayPatch() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      fixAttackDisplays(app, element);
    } catch (err) {
      console.warn(`${MODULE_ID} | attack display replacement failed`, err);
    }
  });
}
