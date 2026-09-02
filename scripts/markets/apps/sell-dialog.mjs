/* global game, ui, foundry */
/**
 * SellDialog — sell one carried item at a market: quantity (stacks only)
 * and, for the GM, the merchant's Bargaining profile. Shows the sale
 * estimate; the engine re-derives everything on submit.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { performSell, salePlan, demandStepsFor, categoryOf, availabilityFor } from "../engine/trade.mjs";
import { toGp } from "../rules/pricing.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class SellDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ location, seller, item, ...options } = {}) {
    super(options);
    this.location = location;
    this.seller = seller;
    this.item = item; // embedded Item document on the seller
  }

  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-sell-{id}",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-markets-dialog", "acks-extras-scroll"],
    position: { width: 420 },
    window: { contentClasses: ["standard-form"] },
    form: { handler: SellDialog.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/markets/sell-dialog.hbs` },
  };

  get title() {
    return game.i18n.format(`${LANG}.sale.title`, { name: this.item.name, location: this.location.name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isGM = game.user.isGM;
    const itemData = this.item.toObject();
    const goods = this.location.system.market.goods;
    const plan = salePlan(itemData, { demandSteps: demandStepsFor(goods, categoryOf(itemData)) });
    context.item = { name: this.item.name, img: this.item.img, costGp: Number(itemData.system?.cost ?? 0) };
    context.previewGp = toGp(plan.unitCp);
    context.basis = game.i18n.localize(`${LANG}.sale.basis.${plan.basis}`);
    context.stackable = itemData.type === "item";
    context.carried = Number(itemData.system?.quantity?.value ?? 1) || 1;
    const avail = availabilityFor(this.location, {
      itemName: this.item.name,
      costGp: plan.bandValueGp,
      trader: this.seller,
      direction: "sold",
    });
    context.availability = game.i18n.format(`${LANG}.availability.${avail.status}`, avail);
    return context;
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const result = await performSell(this.location, {
      sellerUuid: this.seller.uuid,
      itemId: this.item.id,
      qty: Number(data.qty) || 1,
      merchantRanks: Number(data.merchantRanks) || 0,
      merchantCha: Number(data.merchantCha) || 0,
      resolutionId: foundry.utils.randomID(),
    });
    if (result?.error) {
      ui.notifications.warn(
        game.i18n.format(`${LANG}.trade.error.${result.error}`, { remaining: result.remaining ?? 0 })
      );
      return;
    }
    if (result?.ok) {
      ui.notifications.info(
        game.i18n.format(`${LANG}.sale.sold`, { qty: result.qty, name: this.item.name, total: result.totalGp })
      );
    }
  }
}

export function openSellDialog(location, seller, item) {
  new SellDialog({ location, seller, item }).render(true);
}
