/* global foundry, game */
import { MODULE_ID } from "./constants.mjs";
import { VARIATION_KIND } from "./variations.mjs";
import { BASE_TYPE } from "./base-types.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Sheet for a variation Item — the hand-editing half of the document.
 *
 * A Judge who has imported their books picks a published variation and never
 * opens this; a Judge inventing one — a dent, a crest, a family blade — fills
 * it in. Both are first-class, which is the same bargain the trap sheet makes.
 *
 * Its own sheet is not optional. The system renders an item's details from a
 * partial named after the document type, so a sub-type with no sheet of its own
 * cannot be opened at all: the fallback goes looking for
 * `details-acks-extras.variation.hbs` and the whole application fails to render.
 *
 * The fields are the model's, in the order a Judge answers them: what it is,
 * what it changes, what it costs, and who may know about it.
 */
export default class VariationSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-variation-sheet"],
    position: { width: 460, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: false },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/equipment/variation-item.hbs` },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.system = this.item.system;
    context.editable = this.isEditable;
    // DocumentSheetV2 supplies document/model/source/fields; the description
    // editor needs the item's uuid, so hand the item over by name.
    context.item = this.item;

    // Never the bare `TextEditor` global — v14 serves it from
    // foundry.applications.ux and the global is deprecated.
    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.item.system.description ?? "",
      { relativeTo: this.item, secrets: this.item.isOwner },
    );

    const label = (key) => game.i18n.localize(`ACKS-EQUIPMENT.variations.${key}`);
    context.kindChoices = [
      { value: "", label: label("kindUnset") },
      ...Object.values(VARIATION_KIND).map((value) => ({ value, label: label(`kind.${value}`) })),
    ];
    // `appliesTo` and `supersedes` are lists, edited as one comma-separated line
    // each: they are usually empty or one entry, and a repeating sub-form for a
    // field that rarely holds anything is more chrome than the answer is worth.
    context.appliesToText = (this.item.system.appliesTo ?? []).join(", ");
    context.supersedesText = (this.item.system.supersedes ?? []).join(", ");
    context.baseTypeHint = Object.values(BASE_TYPE).join(", ");
    return context;
  }

  /**
   * Split the two comma-separated lines back into arrays before they are
   * stored. Everything else submits as itself.
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const key of ["system.appliesTo", "system.supersedes"]) {
      if (typeof data[key] !== "string") continue;
      data[key] = data[key].split(",").map((s) => s.trim()).filter(Boolean);
    }
    return data;
  }
}

/** Register the sheet as the default for the variation sub-type. */
export function registerVariationSheet(type) {
  foundry.documents.collections.Items.registerSheet(MODULE_ID, VariationSheet, {
    types: [type],
    makeDefault: true,
    label: "ACKS-EQUIPMENT.variations.sheet",
  });
}
