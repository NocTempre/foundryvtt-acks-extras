/* global game, ui, Hooks */
/**
 * Module-managed Active Effects — class combat training (`fromClass`) and
 * the equipment loadout (`loadout`) — refuse hand-deletion; editing, emptying
 * and disabling stay untouched. See docs/lib/DECISIONS.md, "2026-08-25 — the
 * effects the module maintains refuse hand-deletion, and nothing else about
 * them changes." The module's own deletes authorize themselves by passing
 * `managedDelete()` in the operation options, rather than by a global unlock.
 *
 * Emptying means something different per owner: training is a COPY taken at
 * apply time, so an emptied one stays emptied; the loadout is DERIVED from
 * what is equipped, so an emptied one refills on the next recompute.
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
