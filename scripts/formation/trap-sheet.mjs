/* global foundry, game */
import { MODULE_ID, SAVE_KEYS } from "./constants.mjs";
import { ON_SUCCESS, RESOLUTIONS, SCOPES, TRAP_LEVELS, emptyTier, pitDamageFormula } from "./trap-rules.mjs";

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
 *
 * **One level is on screen at a time.** A trap holds six rows, and six of these
 * forms stacked would bury the four fields that describe the trap itself. The
 * level selector chooses which row is being edited AND which one a sprung trap
 * fires, because those are the same question: the Judge is looking at the trap
 * as it stands in this dungeon. A strip above the row says which levels have
 * anything in them, so an imported trap does not look empty when the level on
 * screen happens to be one the book left blank.
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

    // The row on screen, and the path its inputs submit under. Assembled here
    // because the template has no concat helper — the same reason the vehicle
    // sheet resolves its keys in context.
    const tier = system.tier;
    context.tier = tier;
    context.tierPath = `system.levels.${Math.max(0, (system.level ?? 1) - 1)}`;

    // Which levels say anything. `stated` is what separates a level the book
    // prints from one nobody has filled in, and it is asked of the row rather
    // than of the array's length: an imported trap carries six rows whatever
    // the book had to say about each.
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
    // Shown so the Judge can see what a depth is worth without doing the
    // arithmetic, and so a typed formula visibly overriding it is not a
    // surprise. Suppressed when a typed formula has already won.
    context.derivedDamage = String(tier.damageFormula ?? "").trim()
      ? null
      : pitDamageFormula(tier.pitDepthFeet, tier.spiked);
    return context;
  }

  /**
   * @override — rebuild `levels` before the model cleans the submit.
   *
   * Only the row on screen has inputs, and they submit as dotted index paths
   * (`system.levels.2.damageFormula`) which arrive here as a numeric-keyed
   * OBJECT. Written straight through, the ArrayField rebuilds itself from that
   * partial and the five levels the form never rendered are LOST — the same
   * failure the vehicle sheet's crew roster hit. Merging over the stored rows
   * is what keeps editing 4th level from emptying the other five.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    const submitted = data.system?.levels;
    if (submitted && !Array.isArray(submitted)) {
      const stored = this.item.system.levels ?? [];
      data.system.levels = Array.from({ length: TRAP_LEVELS }, (_, i) => ({
        ...emptyTier(),
        ...(stored[i] ?? {}),
        ...(submitted[i] ?? {}),
      }));
    }
    return data;
  }
}
