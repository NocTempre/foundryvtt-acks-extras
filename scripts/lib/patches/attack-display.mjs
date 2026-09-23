/* global game, Hooks */
/**
 * Core patch (display half of patches/attack-roll.mjs): the character sheet's
 * Melee/Ranged boxes, replaced at every render with the patched roll's model —
 * attack throw and roll bonus shown separately (`10+ +2`) instead of folded
 * into one number.
 *
 * The rollable headers keep their own `data-action="rollAttack"` wiring — only
 * the displayed value/tooltip are superseded. Character sheets only: monsters
 * have no such boxes, and the Follower Card already renders the split. See
 * docs/lib/DECISIONS.md, "One owner for the attack roll, and one seam for
 * future modifiers".
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
    // These buttons name no weapon, so they show the throw and stat alone,
    // with no situational term (the weapon's own roll applies those). Melee
    // and Ranged stay separate, each reading its own throw from equipment.
    // See docs/lib/DECISIONS.md, "The Melee/Ranged boxes show the base throw
    // and stat alone".
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
