/* global foundry, game */
import { INFLUENCE_ATTITUDE_LABELS, INFLUENCE_TONE, MODULE_ID } from "./constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Minimal sheet for a stored-attitude Item. */
export default class AttitudeSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-influence-attitude-sheet"],
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
    // DocumentSheetV2 supplies only `document`/`model`/`source`/`fields` — the
    // notes editor needs the item's uuid, so hand it over under its own name.
    context.item = this.item;
    // Enriched for display only; the raw text is what the editor edits (its
    // `value`). Never reach for the bare `TextEditor` global — v14 serves it
    // from foundry.applications.ux and the global is deprecated.
    context.notesHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.item.system.notes ?? "",
      { relativeTo: this.item, secrets: this.item.isOwner },
    );
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
