/* global game, Hooks, foundry */
/**
 * Core patch: on the system's own actor sheets, an input an Active Effect
 * changes shows the STORED value, and the effect's result rides in its
 * tooltip. The system binds those inputs to prepared data and submits the
 * whole form on any change, so a shown result is written back as the base and
 * the effect compounds with every save. This module's character sheet does the
 * same from its own render (`#markOverriddenInputs`); see
 * docs/lib/DECISIONS.md, "The system's sheets show the stored value of a field
 * an effect changes".
 */
import { elementOf } from "../util.mjs";
import { MODULE_ID } from "../constants.mjs";

/** The system's base actor sheet class, inherited by every sheet built on it. */
const CORE_ACTOR_SHEET = "actor-v2";

/** Put the stored value into every effect-changed actor field of one rendered sheet. */
function showStoredValues(app, element) {
  if (game.system?.id !== "acks") return;
  if (!app?.options?.classes?.includes?.(CORE_ACTOR_SHEET)) return;
  showStoredInputs(app.actor ?? app.document, element);
}

/**
 * Put the stored value into every input under `element` that names an actor
 * field an Active Effect changes, with the value in force in its tooltip. For
 * a sheet whose inputs bind to prepared data and submit on change: the
 * system's (above) and the Follower Card.
 */
export function showStoredInputs(actor, element) {
  const overrides = actor?.overrides;
  if (!overrides || foundry.utils.isEmpty(overrides)) return;
  const root = elementOf(element);
  if (!root) return;
  for (const input of root.querySelectorAll('input[name^="system."], select[name^="system."]')) {
    // An embedded item's row names its own document's fields, not the actor's;
    // a wrapper carrying the actor's own id (the Follower Card's) is no row.
    const row = input.closest("[data-item-id], [data-item-uuid]");
    if (row && row.dataset?.itemId !== actor.id) continue;
    if (!foundry.utils.hasProperty(overrides, input.name)) continue;
    const stored = foundry.utils.getProperty(actor._source, input.name);
    if (input.type === "checkbox") input.checked = !!stored;
    else input.value = stored ?? "";
    input.classList.add(`${MODULE_ID}-overridden`);
    input.dataset.tooltip = game.i18n.format("ACKS-LIB.storedInput.effectiveTip", {
      value: String(foundry.utils.getProperty(actor, input.name) ?? ""),
    });
  }
}

/** Registered at ready, with the other core patches. */
export function installStoredInputs() {
  Hooks.on("renderActorSheetV2", (app, element) => {
    try {
      showStoredValues(app, element);
    } catch (err) {
      console.warn(`${MODULE_ID} | stored-value inputs failed`, err);
    }
  });
}
