/* global game, ui, foundry */
/**
 * PurchaseDialog — buy one catalog item at a market: pick the buyer, the
 * quantity, and (GM) the merchant's Bargaining profile. Shows a price
 * preview; the engine re-derives everything on submit.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { performPurchase, availabilityFor, demandStepsFor, categoryOf } from "../engine/trade.mjs";
import { performImportOrder } from "../engine/imports.mjs";
import { quote, toGp } from "../rules/pricing.mjs";
import { partySize, partyOf } from "../engine/parties.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class PurchaseDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ location, item, ...options } = {}) {
    super(options);
    this.location = location;
    /** @type {{name: string, costGp: number, img: string, type: string, system: object}} */
    this.item = item;
  }

  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-purchase-{id}",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-markets-dialog", "acks-extras-scroll"],
    position: { width: 420 },
    window: { contentClasses: ["standard-form"] },
    form: { handler: PurchaseDialog.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/markets/purchase-dialog.hbs` },
  };

  get title() {
    return game.i18n.format(`${LANG}.purchase.title`, { name: this.item.name, location: this.location.name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.isGM = game.user.isGM;
    context.item = this.item;
    const mayUse = (a) => game.user.isGM || a.testUserPermission(game.user, "OWNER");
    context.buyers = game.actors
      .filter((a) => a.type === ACTOR_TYPE.character && !a.system?.retainer?.enabled && mayUse(a))
      .map((a) => ({ id: a.uuid, name: a.name }));
    const first = context.buyers[0] ? game.actors.find((a) => a.uuid === context.buyers[0].id) : null;
    const avail = availabilityFor(this.location, {
      itemName: this.item.name,
      costGp: this.item.costGp,
      trader: first,
    });
    context.availability = {
      ...avail,
      label: game.i18n.format(`${LANG}.availability.${avail.status}`, avail),
    };
    // Preview at list conditions: demand steps included, Bargaining not —
    // the swing depends on who buys and what the merchant rolls.
    const goods = this.location.system.market.goods;
    const preview = quote({
      costGp: this.item.costGp,
      direction: "buy",
      demandSteps: demandStepsFor(goods, categoryOf(this.item)),
    });
    context.previewGp = toGp(preview.unitCp);
    context.partyLarge = first ? partySize(partyOf(first).id) >= 12 : false;
    return context;
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const hubShift = Number(data.hub) || 0;
    const result = hubShift
      ? await performImportOrder(this.location, {
          buyerUuid: data.buyerUuid,
          itemName: this.item.name,
          qty: Number(data.qty) || 1,
          hubShift,
          merchantRanks: Number(data.merchantRanks) || 0,
          resolutionId: foundry.utils.randomID(),
        })
      : await performPurchase(this.location, {
          buyerUuid: data.buyerUuid,
          itemName: this.item.name,
          qty: Number(data.qty) || 1,
          dedicated: !!data.dedicated,
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
    if (!result?.ok) return;
    if (hubShift) {
      ui.notifications.info(game.i18n.format(`${LANG}.imports.placed`, { name: this.item.name, days: result.etaDays }));
    } else {
      ui.notifications.info(
        game.i18n.format(`${LANG}.trade.bought`, { qty: result.qty, name: this.item.name, total: result.totalGp })
      );
    }
  }
}

export function openPurchaseDialog(location, item) {
  new PurchaseDialog({ location, item }).render(true);
}
