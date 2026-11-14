/* global foundry, game */
import { MODULE_ID, SAVE_KEYS } from "./constants.mjs";
import { ON_SUCCESS, RESOLUTIONS, SCOPES, TRAP_LEVELS, mergeTierSubmit, pitDamage, trapFigures } from "./trap-rules.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/**
 * Sheet for a trap Item, the hand-editing half of the trap document. Fields
 * that matter to one kind of trap show only once that kind is chosen. One level
 * row is on screen at a time: the level selector picks the row edited and the
 * row a sprung trap fires, and a strip says which levels hold anything.
 * See docs/formation/DECISIONS.md, "A trap is one document at six levels, not six documents".
 */
export default class TrapSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-trap-sheet"],
    position: { width: 460, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
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
    // The description editor needs the item's uuid, which DocumentSheetV2's context lacks.
    context.item = this.item;

    // The bare `TextEditor` global is deprecated in v14.
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

    // The row on screen and its submit path (the template has no concat helper).
    const tier = system.tier;
    context.tier = tier;
    context.tierPath = `system.levels.${Math.max(0, (system.level ?? 1) - 1)}`;

    // `stated` is asked of the row, not the array's length: a trap always holds six rows.
    context.levelStrip = Array.from({ length: TRAP_LEVELS }, (_, i) => {
      const row = system.levels?.[i];
      return {
        level: i + 1,
        current: i === (system.level ?? 1) - 1,
        stated:
          !!row &&
          (!!String(row.text ?? "").trim() ||
            !!String(row.damageFormula ?? "").trim() ||
            !!row.attackThrow ||
            !!row.pitDepthFeet),
      };
    });

    context.isSave = tier.resolution === RESOLUTIONS.save;
    context.isAttack = tier.resolution === RESOLUTIONS.attack;
    context.isArea = system.scope === SCOPES.area;
    // The pit's derived damage; suppressed when a typed formula has won.
    const typed = String(tier.damageFormula ?? "").trim();
    const pit = typed ? { formula: null, unknown: [] } : pitDamage(tier.pitDepthFeet, tier.spiked);
    context.derivedDamage = pit.formula;
    // A pit whose dice are not imported says so.
    context.pitUnknown = pit.unknown.includes("fall")
      ? label("pitFallNotImported")
      : pit.unknown.includes("spikes")
        ? label("pitSpikesNotImported")
        : "";

    // The trigger band: blank reads the imported one; the die's faces bound a typed band.
    const figures = trapFigures();
    context.triggerMax = figures.triggerFaces;
    context.triggerOnDefault = figures.triggerOn;
    context.triggerOnPlaceholder = figures.triggerOn ?? "";
    context.triggerNotImported = figures.triggerOn === null || figures.triggerFaces === null;
    return context;
  }

  /**
   * @override — rebuild `levels` from what is stored before the model cleans
   * the submit, overlaying only the row that was on screen (see
   * `mergeTierSubmit`: the form's dotted index paths expand into an array
   * holding only the named row). The submitted value is always an array, so
   * that is no guard.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    // A blank band is stored as null (the imported one), never 0 ("never springs").
    if (data.system && "triggerOn" in data.system) {
      const band = data.system.triggerOn;
      data.system.triggerOn = band === "" || band == null || Number.isNaN(Number(band)) ? null : Number(band);
    }
    const submitted = data.system?.levels;
    if (submitted) {
      const level = data.system.level ?? this.item.system.level;
      data.system.levels = mergeTierSubmit(this.item.system.levels, submitted, level);
    }
    return data;
  }
}
