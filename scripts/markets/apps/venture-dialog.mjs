/* global game, ui, foundry */
/**
 * VentureTradeDialog — trade merchandise a solicitation opened: category,
 * stones, direction, the hold the loads go into or come out of, and the
 * optional spot-price negotiation.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { merchandiseFor } from "../engine/merchandise.mjs";
import { performVentureTrade, ventureOf, loadsHeld, ventureVehicles } from "../engine/ventures.mjs";
import { holdOf } from "../../vehicles/hold.mjs";
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
    // Where the loads go or come from: the trader's own packs, or a vehicle
    // the party entered with — the first of those, where there is one, since
    // a market's loads belong in transport.
    const vehicles = ventureVehicles(context.venture);
    const holders = [this.trader, ...vehicles];
    context.holds = [
      { uuid: this.trader.uuid, label: game.i18n.format(`${LANG}.ventures.holdPacks`, { name: this.trader.name }), selected: !vehicles.length },
      ...vehicles.map((v, i) => ({
        uuid: v.uuid,
        label: game.i18n.format(`${LANG}.ventures.holdVehicle`, { name: v.name, free: Math.max(0, Math.floor(holdOf(v)?.free ?? 0)) }),
        selected: i === 0,
      })),
    ];
    context.rows = (goods.solicitations ?? [])
      .filter((s) => s.partyId === party.id && Number(s.monthStartTime) === monthStart && Math.floor(s.stones) >= 1)
      .map((s) => {
        const price = (goods.merchPrices ?? []).find((p) => p.category === s.category && Number(p.monthStartTime) === monthStart);
        const merch = merchandiseFor(s.category)?.label ?? s.category;
        const held = holders.reduce((n, h) => n + loadsHeld(h, s.category, this.trader.uuid), 0);
        return {
          category: s.category,
          merchLabel: merch,
          held,
          // The option text the template prints: the loads of this category
          // the trader could sell — their packs and the party's vehicles —
          // ride beside the name, so a seller sees what is in hand.
          label: game.i18n.format(`${LANG}.ventures.labelCarrying`, { label: merch, held }),
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
      holdUuid: data.hold || "",
      negotiate: !!data.negotiate,
      resolutionId: foundry.utils.randomID(),
    });
    if (result?.error) {
      ui.notifications.warn(game.i18n.format(`${LANG}.trade.error.${result.error}`, { remaining: 0, table: "", crowd: "", hold: "", ...result }));
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
