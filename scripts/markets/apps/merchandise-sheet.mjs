/* global foundry, game */
import { MODULE_ID, LANG, MERCHANDISE_TYPE } from "../constants.mjs";
import {
  DEMAND_AGE_HEADERS_SETTING,
  DEMAND_AGE_KEYS,
  DEMAND_TERRAIN_KEYS,
  MARKET_CLASS_COUNT,
  MERCHANDISE_TIERS,
} from "../merchandise-keys.mjs";
import { listFromLine, racialFromRows, raceKeyOf } from "../merchandise-form.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Roman numerals for the market classes, class I first. */
const CLASS_NUMERALS = Object.freeze(["I", "II", "III", "IV", "V", "VI"]);

/** The list fields the sheet edits as one comma-separated line each. */
const LIST_FIELDS = Object.freeze(["aliases", "lootKinds", "itemCategories"]);

/**
 * Sheet for a merchandise Item — the hand-editing half of the catalogue.
 *
 * A Judge who has imported their books never needs it for the printed goods;
 * a Judge adding a good, or overriding one for their world, fills it in (a
 * world Item with the same key wins over the imported one). The sections run
 * in the order a Judge answers them: what the good is, what it costs, how
 * much is on offer, what demand does to it, and what else it goes by.
 *
 * The body scrolls inside the window, not the frame: every field submits on
 * change and re-renders the sheet, and only a part's descendant keeps its
 * scroll position across that.
 */
export default class MerchandiseSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-merchandise-sheet"],
    position: { width: 620, height: 720 },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: true },
    actions: {
      racialAdd: MerchandiseSheet.#onRacialAdd,
      racialDelete: MerchandiseSheet.#onRacialDelete,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/markets/merchandise-sheet.hbs`,
      scrollable: [".acks-extras-merchandise-body"],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.system;
    const t = (key, data) => (data ? game.i18n.format(`${LANG}.merchandise.${key}`, data) : game.i18n.localize(`${LANG}.merchandise.${key}`));
    context.item = this.item;
    context.system = system;
    context.editable = this.isEditable;
    context.descriptionHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(system.description ?? "", {
      relativeTo: this.item,
      secrets: this.item.isOwner,
    });

    context.tierChoices = MERCHANDISE_TIERS.map((value) => ({ value, label: t(`tier.${value}`), selected: value === system.tier }));
    context.randomTableChoices = [
      { value: "", label: t("tier.none"), selected: !system.random?.table },
      ...MERCHANDISE_TIERS.map((value) => ({ value, label: t(`tier.${value}`), selected: value === system.random?.table })),
    ];
    context.dailyStones = Array.from({ length: MARKET_CLASS_COUNT }, (_, index) => ({
      index,
      label: t("field.marketClass", { class: CLASS_NUMERALS[index] }),
      value: system.dailyStones?.[index] ?? null,
    }));

    // The age columns carry the book's own header text, read at import and
    // kept in a world setting; before an import it is a plain ordinal.
    let headers = {};
    try {
      headers = game.settings.get(MODULE_ID, DEMAND_AGE_HEADERS_SETTING) ?? {};
    } catch {
      /* the setting is registered at init; a sheet opened before it falls back to ordinals */
    }
    context.ageColumns = DEMAND_AGE_KEYS.map((key, i) => ({
      key,
      label: headers[key] || t("env.age", { n: i + 1 }),
      value: system.environment?.[key] ?? null,
    }));
    context.terrainColumns = DEMAND_TERRAIN_KEYS.map((key) => ({
      key,
      label: t(`env.${key}`),
      value: system.environment?.[key] ?? null,
    }));

    context.racialRows = Object.entries(system.racial ?? {}).map(([race, value], index) => ({ index, race, value }));
    // Lists are edited as one comma-separated line each: they are usually empty
    // or a few words, and a repeating sub-form for them is more chrome than the
    // answer is worth.
    context.aliasesText = (system.aliases ?? []).join(", ");
    context.lootKindsText = (system.lootKinds ?? []).join(", ");
    context.itemCategoriesText = (system.itemCategories ?? []).join(", ");
    return context;
  }

  /**
   * Turn the racial rows back into the object the model stores, and the
   * comma-separated lines back into arrays. The racial object replaces the
   * stored one whole (`==`), so a row the Judge cleared is dropped rather
   * than merged back in.
   * @override
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    for (const field of LIST_FIELDS) {
      const value = data.system?.[field];
      if (typeof value === "string") data.system[field] = listFromLine(value);
    }
    if (data.racialRows !== undefined) {
      data.system ??= {};
      data.system["==racial"] = racialFromRows(data.racialRows);
      delete data.racialRows;
    }
    return data;
  }

  /** Add a race row, submitting first so an edit in flight is not written over. */
  static async #onRacialAdd() {
    await this.submit();
    const racial = this.item.system.racial ?? {};
    let n = Object.keys(racial).length + 1;
    while (`race${n}` in racial) n++;
    await this.item.update({ [`system.racial.race${n}`]: 0 });
  }

  /** Remove one race row by its key. */
  static async #onRacialDelete(event, target) {
    const race = raceKeyOf(target.dataset.race);
    if (!race) return;
    await this.submit();
    await this.item.update({ [`system.racial.-=${race}`]: null });
  }
}

/** Register the sheet as the default for the merchandise sub-type. */
export function registerMerchandiseSheet() {
  foundry.documents.collections.Items.registerSheet(MODULE_ID, MerchandiseSheet, {
    types: [MERCHANDISE_TYPE],
    makeDefault: true,
    label: `${LANG}.merchandise.sheet`,
  });
}
