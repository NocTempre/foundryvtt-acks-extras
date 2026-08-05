/* global foundry, game */
import { INFLUENCE_ATTITUDE_LABELS, INFLUENCE_TONE, MODULE_ID } from "./constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Minimal sheet for a stored-attitude Item. */
export default class AttitudeSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-extras", "acks-extras-scroll", "acks-influence-attitude-sheet"],
    position: { width: 380, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: false },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/influence/attitude-item.hbs` },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.item.system;
    context.editable = this.isEditable;
    context.attitudeChoices = INFLUENCE_ATTITUDE_LABELS[INFLUENCE_TONE.DIPLOMACY].map((key, index) => ({
      value: index,
      label: game.i18n.localize(key),
    }));
    context.tones = [INFLUENCE_TONE.DIPLOMACY, INFLUENCE_TONE.INTIMIDATION, INFLUENCE_TONE.SEDUCTION].map((t) => ({
      key: t,
      label: game.i18n.localize(`ACKS-INFLUENCE.tone.${t}`),
      value: this.item.system.attempts?.[t] ?? 0,
    }));
    return context;
  }
}
