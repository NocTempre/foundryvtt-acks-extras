/* global foundry, game */
import { MODULE_ID } from "./constants.mjs";
import { VARIATION_KIND } from "./variations.mjs";
import { BASE_TYPE } from "./base-types.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Sheet for a variation Item: the hand-editing half of the document, for a
 * variation a Judge invents rather than imports.
 *
 * The sub-type needs a sheet of its own: the system renders an item's details
 * from a partial named after the document type, and with no sheet the fallback
 * looks for `details-acks-extras.variation.hbs` and the application fails to
 * render.
 */
export default class VariationSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-variation-sheet"],
    position: { width: 460, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
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

    // Core 14 serves TextEditor from foundry.applications.ux; the bare global is deprecated.
    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      this.item.system.description ?? "",
      { relativeTo: this.item, secrets: this.item.isOwner },
    );

    const label = (key) => game.i18n.localize(`ACKS-EQUIPMENT.variations.${key}`);
    context.kindChoices = [
      { value: "", label: label("kindUnset") },
      ...Object.values(VARIATION_KIND).map((value) => ({ value, label: label(`kind.${value}`) })),
    ];
    // `appliesTo` and `supersedes` are lists, edited as one comma-separated line each.
    context.appliesToText = (this.item.system.appliesTo ?? []).join(", ");
    context.supersedesText = (this.item.system.supersedes ?? []).join(", ");
    context.baseTypeHint = Object.values(BASE_TYPE).join(", ");
    return context;
  }

  /**
   * Split the two comma-separated lines back into arrays before they are stored.
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
