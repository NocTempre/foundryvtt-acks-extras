/* global game, ui, foundry */
/**
 * CatalogSourcesApp — the Judge's choice of what stocks the shop: the world's
 * own items and each Item compendium holding priced equipment, one tick each,
 * in the order the catalog takes a name's first copy. Saving writes the
 * sources left unticked (`marketsCatalogExcluded`, rules/sources.mjs).
 */
import { MODULE_ID, LANG, CATALOG_EXCLUDED_SETTING } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { WORLD_SOURCE, excludedFromPicks } from "../rules/sources.mjs";
import { excludedSources } from "../engine/catalog-sources.mjs";
import { CATALOG_INDEX_FIELDS, shopListable } from "../engine/trade.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const loc = makeLoc(LANG);

/** The package a compendium ships in, by its title. */
function originOf(pack) {
  const { packageType, packageName } = pack.metadata ?? {};
  if (packageType === "world") return game.world?.title ?? packageName;
  if (packageType === "system") return game.system?.title ?? packageName;
  return game.modules.get(packageName)?.title ?? packageName;
}

/**
 * The picker's rows: the world's items, then each Item compendium in sidebar
 * order with the count of what the shop could list from it. A compendium with
 * nothing to list is left out unless it is unticked now.
 * @returns {Promise<Array<{key: string, label: string, origin: string, count: number, included: boolean}>>}
 */
export async function catalogSourceRows() {
  const excluded = excludedSources();
  const rows = [
    {
      key: WORLD_SOURCE,
      label: loc("catalog.world"),
      origin: "",
      count: [...(game.items ?? [])].filter((i) => shopListable(i)).length,
      included: !excluded.includes(WORLD_SOURCE),
    },
  ];
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const index = await pack.getIndex({ fields: [...CATALOG_INDEX_FIELDS] }).catch(() => null);
    const count = index ? [...index].filter((e) => shopListable(e)).length : 0;
    const included = !excluded.includes(pack.collection);
    if (!count && included) continue;
    rows.push({ key: pack.collection, label: pack.metadata.label, origin: originOf(pack), count, included });
  }
  return rows;
}

export class CatalogSourcesApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-catalog-sources",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-markets-dialog", "acks-extras-scroll"],
    position: { width: 480, height: "auto" },
    window: { resizable: true },
    form: { handler: CatalogSourcesApp.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/markets/catalog-sources.hbs` },
  };

  get title() {
    return loc("catalog.title");
  }

  /** The rows as last drawn: a tick's form name is its row's index here. */
  #rows = [];

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    this.#rows = await catalogSourceRows();
    context.rows = this.#rows.map((row, index) => ({ ...row, index }));
    return context;
  }

  static async #onSubmit(_event, _form, formData) {
    const ticks = foundry.utils.expandObject(formData.object).rows ?? {};
    const picks = this.#rows.map((row, index) => ({ key: row.key, included: !!ticks[index] }));
    await game.settings.set(MODULE_ID, CATALOG_EXCLUDED_SETTING, excludedFromPicks(picks, excludedSources()));
    ui.notifications.info(loc(picks.some((p) => p.included) ? "catalog.saved" : "catalog.savedEmpty"));
  }
}
