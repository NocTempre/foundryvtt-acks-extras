/* global foundry, game */
import { MODULE_ID } from "./constants.mjs";
import { HAZARD_GROUPS, hazardChoices } from "./hazard-keys.mjs";
import { atTypeScale } from "../lib/util.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * The Kind select's groups: obstacles, then conditions, each with its caption
 * and its options labelled, the stored key marked. The blank option the
 * template adds first is a hazard not yet chosen.
 *
 * @param {string} selected the hazard's stored key
 * @param {(key: string) => string} say turns a lang key into text
 * @returns {{label: string, options: {value: string, label: string, selected: boolean}[]}[]}
 */
export function kindGroups(selected, say) {
  const labels = hazardChoices(say);
  return HAZARD_GROUPS.map(({ label, keys }) => ({
    label: say(label),
    options: keys.map((value) => ({ value, label: labels[value], selected: value === selected })),
  }));
}

/**
 * Sheet for a Hazard Item: a name, a picture, the kind, and the Judge's own
 * description. The kind and the description submit on change; the sheet holds
 * no figure, so it never re-renders under a half-typed number.
 */
export default class HazardSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-hazard-sheet"],
    // The canvas width; `_initializeApplicationOptions` scales it to the seat's type size.
    position: { width: 440, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/formation/hazard-item.hbs` },
  };

  /**
   * Open at the canvas width for the seat's type size. `DEFAULT_OPTIONS` is
   * evaluated before settings exist, so the scale is applied here at
   * construction; the height stays `auto`.
   */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    return opts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.system;
    context.system = system;
    context.editable = this.isEditable;
    // The description editor needs the item's uuid, which DocumentSheetV2's context lacks.
    context.item = this.item;
    context.kindGroups = kindGroups(system.key ?? "", (key) => game.i18n.localize(key));
    // Enriched for display only; the raw text is what the editor edits. The bare `TextEditor` global is deprecated in v14.
    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      system.description ?? "",
      { relativeTo: this.item, secrets: this.item.isOwner },
    );
    return context;
  }
}
