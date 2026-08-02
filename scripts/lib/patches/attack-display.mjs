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
import { MODULE_ID } from "../constants.mjs";

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const signed = (n) => (n >= 0 ? `+${n}` : `${n}`);

function fixAttackDisplays(app, element) {
  if (game.system?.id !== "acks") return;
  const actor = app.actor ?? app.document;
  if (actor?.type !== "character") return;
  const root = element instanceof HTMLElement ? element : element?.[0];
  if (!root) return;
  const sys = actor.system;
  const T = num(sys.thac0?.throw, 10);
  for (const type of ["melee", "missile"]) {
    const header = root.querySelector(`a[data-action="rollAttack"][data-attack="${type}"]`);
    const input = header?.closest(".form-group")?.querySelector("input");
    if (!input) continue; // not this sheet's markup (e.g. the Follower Card)
    const ability = type === "missile" ? num(sys.scores?.dex?.mod) : num(sys.scores?.str?.mod);
    const adjustment = num(sys.thac0?.mod?.[type]);
    input.value = `${T}+ ${signed(ability + adjustment)}`;
    input.dataset.dtype = "String";
    input.dataset.tooltip = game.i18n.format("ACKS-LIB.attack.displayTooltip", {
      target: T,
      bonus: signed(ability + adjustment),
      ability: signed(ability),
      adjustment: signed(adjustment),
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
