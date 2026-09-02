/* global game, ui, foundry */
/**
 * VentureTradeDialog — trade merchandise a solicitation opened: category,
 * stones, direction, and the optional spot-price negotiation.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { merchandiseLabel } from "../config.mjs";
import { performVentureTrade, ventureOf } from "../engine/ventures.mjs";
import { marketMonthStart } from "../engine/trade.mjs";
import { partyOf } from "../engine/parties.mjs";
import { toGp } from "../rules/pricing.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class VentureTradeDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ location, trader, ...options } = {}) {
    super(options);
    this.location = location;
    this.trader = trader;
  }

  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-venture-{id}",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-markets-dialog", "acks-extras-scroll"],
    position: { width: 420 },
    window: { contentClasses: ["standard-form"] },
    form: { handler: VentureTradeDialog.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/markets/venture-dialog.hbs` },
  };

  get title() {
    return game.i18n.format(`${LANG}.ventures.tradeTitle`, { location: this.location.name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const goods = this.location.system.market.goods;
    const monthStart = marketMonthStart();
    const party = partyOf(this.trader);
    context.venture = ventureOf(this.location, party.id, monthStart);
    context.rows = (goods.solicitations ?? [])
      .filter((s) => s.partyId === party.id && Number(s.monthStartTime) === monthStart && Math.floor(s.stones) >= 1)
      .map((s) => {
        const price = (goods.merchPrices ?? []).find((p) => p.category === s.category && Number(p.monthStartTime) === monthStart);
        return {
          category: s.category,
          label: game.i18n.localize(merchandiseLabel(s.category)),
          stones: Math.floor(s.stones),
          priceGp: price ? toGp(price.priceCp) : "?",
        };
      });
    context.noRows = !context.rows.length;
    return context;
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const result = await performVentureTrade(this.location, {
      actorUuid: this.trader.uuid,
      category: data.category,
      stones: Number(data.stones) || 1,
      direction: data.direction === "sell" ? "sell" : "buy",
      negotiate: !!data.negotiate,
      resolutionId: foundry.utils.randomID(),
    });
    if (result?.error) {
      ui.notifications.warn(game.i18n.format(`${LANG}.trade.error.${result.error}`, { remaining: result.remaining ?? 0 }));
      return;
    }
    if (result?.ok) {
      ui.notifications.info(game.i18n.format(`${LANG}.ventures.traded`, { stones: result.stones, total: result.totalGp }));
    }
  }
}

export function openVentureTradeDialog(location, trader) {
  new VentureTradeDialog({ location, trader }).render(true);
}
