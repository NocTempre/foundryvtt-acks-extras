/* global foundry, game */
import { MODULE_ID, SAVE_KEYS } from "./constants.mjs";
import { ON_SUCCESS, RESOLUTIONS, SCOPES, pitDamageFormula } from "./trap-rules.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Sheet for a trap Item — the hand-editing half of the trap document.
 *
 * A Judge who has imported the book's traps picks one and never opens this; a
 * Judge inventing their own fills it in. Both are first-class, which is why the
 * fields are the book's own questions rather than a form shaped around what an
 * importer happens to emit.
 *
 * Fields that only matter for one kind of trap are hidden until that kind is
 * chosen — a save key on a trap that makes an attack throw is a number with
 * nowhere to go, and showing it invites someone to fill it in and expect it to
 * do something.
 */
export default class TrapSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-trap-sheet"],
    position: { width: 460, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: false },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/formation/trap-item.hbs` },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.system;
    context.system = system;
    context.editable = this.isEditable;
    // DocumentSheetV2 supplies only `document`/`model`/`source`/`fields`; the
    // description editor needs the item's uuid, so hand the item over by name.
    context.item = this.item;

    // Never reach for the bare `TextEditor` global — v14 serves it from
    // foundry.applications.ux and the global is deprecated.
    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      system.description ?? "",
      { relativeTo: this.item, secrets: this.item.isOwner },
    );

    const label = (key) => game.i18n.localize(`ACKS-FORMATION.traps.${key}`);
    context.resolutionChoices = Object.values(RESOLUTIONS).map((value) => ({
      value,
      label: label(`resolution.${value}`),
    }));
    context.scopeChoices = Object.values(SCOPES).map((value) => ({ value, label: label(`scope.${value}`) }));
    context.onSuccessChoices = Object.values(ON_SUCCESS).map((value) => ({ value, label: label(`onSuccess.${value}`) }));
    context.saveChoices = [
      { value: "", label: label("noSave") },
      ...SAVE_KEYS.map((value) => ({ value, label: game.i18n.localize(`ACKS.saves.${value}.long`) })),
    ];

    context.isSave = system.resolution === RESOLUTIONS.save;
    context.isAttack = system.resolution === RESOLUTIONS.attack;
    context.isArea = system.scope === SCOPES.area;
    // Shown so the Judge can see what a depth is worth without doing the
    // arithmetic, and so a typed formula visibly overriding it is not a
    // surprise. Suppressed when a typed formula has already won.
    context.derivedDamage = String(system.damageFormula ?? "").trim()
      ? null
      : pitDamageFormula(system.pitDepthFeet, system.spiked);
    return context;
  }
}
