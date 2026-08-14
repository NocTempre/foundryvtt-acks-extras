/* global game, ui, foundry */
/**
 * CommissionDialog — have an item built (RR §IV.11): pick the buyer, the
 * quantity, and the worker; the plan (days and wages) previews live from
 * the imported Wage and Construction Rates row.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { performCommission } from "../engine/imports.mjs";
import { commissionPlan } from "../rules/commissions.mjs";
import { toGp } from "../rules/pricing.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";
import { getSetting as henchmenSetting } from "../../henchmen/settings.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class CommissionDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ location, item, ...options } = {}) {
    super(options);
    this.location = location;
    this.item = item; // catalog row {name, img, costGp}
  }

  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-commission-{id}",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-markets-dialog"],
    position: { width: 420 },
    window: { contentClasses: ["standard-form"] },
    form: { handler: CommissionDialog.#onSubmit, closeOnSubmit: true },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/markets/commission-dialog.hbs` },
  };

  get title() {
    return game.i18n.format(`${LANG}.commissions.title`, { name: this.item.name, location: this.location.name });
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    context.item = this.item;
    const mayUse = (a) => game.user.isGM || a.testUserPermission(game.user, "OWNER");
    context.buyers = game.actors
      .filter((a) => a.type === ACTOR_TYPE.character && !a.system?.retainer?.enabled && mayUse(a))
      .map((a) => ({ id: a.uuid, name: a.name }));
    const daysPerMonth = Number(henchmenSetting("daysPerMonth")) || 28;
    context.workers = (optTable("construction", "wageAndConstructionRates")?.rows ?? []).map((row) => {
      const plan = commissionPlan({ costCp: Math.round(this.item.costGp * 100), rateRow: row, daysPerMonth });
      return {
        id: row.worker,
        label: game.i18n.localize(`${LANG}.commissions.worker.${row.worker}`),
        planLine: plan
          ? game.i18n.format(`${LANG}.commissions.planLine`, { days: plan.days, wages: toGp(plan.wagesCp) })
          : game.i18n.localize(`${LANG}.commissions.noRate`),
      };
    });
    context.noRates = !context.workers.length;
    return context;
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const result = await performCommission(this.location, {
      buyerUuid: data.buyerUuid,
      itemName: this.item.name,
      qty: Number(data.qty) || 1,
      worker: data.worker,
      resolutionId: foundry.utils.randomID(),
    });
    if (result?.error) {
      ui.notifications.warn(game.i18n.format(`${LANG}.trade.error.${result.error}`, { remaining: result.remaining ?? 0 }));
      return;
    }
    if (result?.ok) {
      ui.notifications.info(
        game.i18n.format(`${LANG}.commissions.placed`, { name: this.item.name, days: result.days, wages: result.wagesGp })
      );
    }
  }
}

export function openCommissionDialog(location, item) {
  new CommissionDialog({ location, item }).render(true);
}
