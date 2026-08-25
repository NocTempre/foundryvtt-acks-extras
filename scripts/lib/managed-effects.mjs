/* global game, ui, Hooks */
/**
 * Module-managed Active Effects — the ones this module writes, rewrites and
 * owns, and which a hand must not delete.
 *
 * Two effects on a character are machinery rather than notes a Judge made:
 * the class's combat training (`fromClass`) and the equipment loadout
 * (`loadout`). Both sit in core's ordinary Effects list beside hand-made ones,
 * with the same trash button, and deleting either breaks the character
 * silently — training vanishes and every weapon reads as untrained until the
 * class is applied again; the loadout's modifiers vanish until the next equip
 * happens to rebuild them. Nothing announces it, because from Foundry's side a
 * document was deleted exactly as asked.
 *
 * So deletion is REFUSED and everything else is left alone. Editing, clearing
 * the changes and disabling all still work: a Judge who wants a character
 * untrained can empty the effect, which is a decision they can see afterwards,
 * rather than removing the row and leaving no trace of what used to be there.
 *
 * The module's own deletes are the exception, and they authorize themselves by
 * passing `managedDelete()` in the operation options rather than by unsetting a
 * global. An option travels with the one call that asked for it; a global
 * unlock would still be open across every `await` inside it, and the sync path
 * awaits repeatedly.
 *
 * WHAT EMPTYING MEANS DIFFERS BY OWNER, and the difference is not hidden:
 * training is a COPY taken when the class was applied, so an emptied one stays
 * emptied until the class is applied again; the loadout is DERIVED from what is
 * equipped, so an emptied one refills the next time the loadout is recomputed.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";

/**
 * Flag key under `flags["acks-extras"]` → the i18n key naming what owns it.
 * A feature claims its marker at init; nothing is managed until it does, so a
 * feature that is switched off cannot lock a row it no longer maintains.
 */
const MARKERS = new Map();

/** Operation-option key that marks a delete as the module's own. */
const AUTHORIZED = "managedDelete";

/**
 * Claim a flag key as marking a module-managed effect.
 * @param {string} flagKey key under `flags["acks-extras"]` carrying a truthy value
 * @param {string} labelKey i18n key naming the owner, for the refusal message
 */
export function registerManagedEffect(flagKey, labelKey) {
  MARKERS.set(flagKey, labelKey);
}

/**
 * The i18n key naming what manages this effect, or null when nothing does.
 * Truthiness, not `=== true`: the loadout marker is a boolean and the class
 * marker is the class's uuid, and both mean "this one is ours".
 */
export function managedEffectOwner(effect) {
  for (const [flagKey, labelKey] of MARKERS) {
    if (effect?.getFlag?.(MODULE_ID, flagKey)) return labelKey;
  }
  return null;
}

/** Is this effect maintained by the module? */
export const isManagedEffect = (effect) => managedEffectOwner(effect) !== null;

/**
 * Operation options authorizing a delete of a managed effect. Spread into the
 * `operation` argument of `deleteEmbeddedDocuments` or `Document#delete`;
 * without it the guard below refuses.
 * @param {object} [extra] other operation options to carry alongside
 */
export function managedDelete(extra = {}) {
  return { ...extra, [MODULE_ID]: { ...(extra[MODULE_ID] ?? {}), [AUTHORIZED]: true } };
}

/**
 * Refuse hand-deletion of managed effects.
 *
 * Returning false from `preDeleteActiveEffect` cancels the delete for everyone,
 * on the client that asked — so the refusal lands where the gesture happened
 * rather than as a silent no-op on someone else's screen.
 */
export function registerManagedEffectGuard() {
  Hooks.on("preDeleteActiveEffect", (effect, options) => {
    if (options?.[MODULE_ID]?.[AUTHORIZED]) return true;
    const labelKey = managedEffectOwner(effect);
    if (!labelKey) return true;
    ui.notifications?.warn(
      game.i18n.format(`${LANG_PREFIX}.managedEffect.refused`, {
        name: effect.name ?? "",
        owner: game.i18n.localize(labelKey),
      }),
    );
    return false;
  });
}

/**
 * Take the trash control off managed rows wherever core lists effects.
 *
 * The guard above is the gate; this only stops the sheet offering a gesture
 * that will be refused. The control is REPLACED rather than hidden, so the row
 * keeps its shape and says why — an effect that simply lost a button reads as
 * a rendering fault.
 */
export function lockManagedEffectRows(doc, root) {
  const tip = game.i18n.localize(`${LANG_PREFIX}.managedEffect.locked`);
  for (const control of root.querySelectorAll('[data-action="deleteEffect"][data-effect-id]')) {
    const effect = doc?.effects?.get?.(control.dataset.effectId);
    if (!effect || !isManagedEffect(effect)) continue;
    const span = control.ownerDocument.createElement("span");
    span.className = "effect-control button acks-lib-effect-locked";
    span.dataset.tooltip = tip;
    const icon = control.ownerDocument.createElement("i");
    icon.className = "fas fa-lock";
    span.append(icon);
    control.replaceWith(span);
  }
}
