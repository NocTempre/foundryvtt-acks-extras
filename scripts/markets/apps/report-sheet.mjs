/* global foundry, game, ui, fromUuid */
import { MODULE_ID, LANG, REPORT_TYPE } from "../constants.mjs";
import { merchandiseCatalog, merchandiseFor } from "../engine/merchandise.mjs";
import { plainReport, performNotes, performChoose, answerFromMarket } from "../engine/trade-objects.mjs";
import { ownerOf, resolveActorSync } from "../../lib/storage.mjs";
import { REPORT_OUTCOMES, shownOutcome, htmlToNotes, isAwaiting, dmLabel, storedDm, beliefTip } from "../rules/reports.mjs";
import { trueDemand } from "../rules/demand.mjs";
import { SECONDS_PER_DAY } from "../../henchmen/constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const t = (key, data) => (data ? game.i18n.format(`${LANG}.report.${key}`, data) : game.i18n.localize(`${LANG}.report.${key}`));

/** A good's display name: the catalogue's label (a Judge's own good included), else its key. */
export const goodName = (category) => merchandiseFor(category)?.label ?? category;

/**
 * The tooltip one belief's figure carries, worded from `beliefTip`. The market's
 * demand is read only for the Judge; a market that no longer resolves says so
 * where the figure would be.
 * @param {object} belief          A plain belief: `{category, dm}`.
 * @param {object} o
 * @param {string} o.outcome       The report's stored outcome.
 * @param {boolean} o.isGM
 * @param {object|null} o.goods    The market's goods record, or null when the market is gone.
 * @param {string} o.day           The day the report was assessed, worded.
 * @param {string} o.assessor      The assessor's name, or empty.
 * @returns {string}
 */
export function beliefTipText(belief, { outcome, isGM, goods, day, assessor }) {
  const truth = isGM ? (goods ? dmLabel(trueDemand(goods, belief.category)) : t("tip.noMarket")) : "";
  const { key, data } = beliefTip({ awaiting: isAwaiting(belief), isGM, outcome, truth, day, assessor: assessor || "—" });
  return t(key, data);
}

/** The figure a belief shows a reader: the signed modifier, or the waiting word while the Judge has not answered. */
export const beliefFigure = (belief) => dmLabel(belief.dm) ?? t("awaiting");

/** The outcome's display label, masked for a non-GM. */
export const outcomeLabel = (outcome, isGM) => game.i18n.localize(`${LANG}.report.outcome.${shownOutcome(outcome, isGM)}`);

/** The world day a report's time falls on, as the henchmen market log words it. */
export const reportDay = (time) => game.i18n.format("ACKS-HENCHMEN.marketLog.day", { day: Math.floor(Number(time) / SECONDS_PER_DAY) });

/** Does this user own the actor the report is stamped to (or is the Judge)? */
export function ownsReport(item, user = game.user) {
  if (user?.isGM) return true;
  const uuid = ownerOf(item)?.uuid;
  const actor = uuid ? resolveActorSync(uuid) : null;
  return !!actor?.testUserPermission(user, "OWNER");
}

/**
 * Sheet for a market report Item: the market, when and by whom, and what the
 * owner believes about each good's demand.
 *
 * Read-mostly: players hold OBSERVER on the trade house, so the sheet is a
 * plain window and nothing on it submits through the document. The owner (or
 * the Judge) saves their notes and chooses the goods a partial assessment left
 * to choose, both through the GM relay; the Judge alone edits the outcome and
 * the believed modifiers, and answers the goods the owner chose (each shows
 * "awaiting" until then). The stored outcome `false` is shown to a non-GM as
 * partial, on every surface.
 */
export default class ReportSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-markets-report-sheet"],
    position: { width: 480, height: 560 },
    tag: "div",
    window: { resizable: true },
    actions: { saveNotes: ReportSheet.#onSaveNotes, chooseGoods: ReportSheet.#onChooseGoods, answerFromMarket: ReportSheet.#onAnswerFromMarket },
  };

  static PARTS = {
    body: {
      template: `modules/${MODULE_ID}/templates/markets/report-sheet.hbs`,
      scrollable: [".acks-extras-markets-report-body"],
    },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const report = plainReport(this.item);
    const isGM = game.user.isGM;
    const market = report.marketUuid ? await fromUuid(report.marketUuid).catch(() => null) : null;
    const canEditNotes = ownsReport(this.item);
    const TextEditor = foundry.applications.ux.TextEditor.implementation;

    context.item = this.item;
    context.report = report;
    context.isGM = isGM;
    context.marketLinkHTML = market
      ? await TextEditor.enrichHTML(`@UUID[${report.marketUuid}]{${foundry.utils.escapeHTML(market.name)}}`, { relativeTo: this.item })
      : "";
    context.marketName = market?.name ?? report.marketName;
    context.dayLabel = reportDay(report.time);
    context.assessorName = resolveActorSync(report.assessorUuid)?.name ?? "";
    context.outcomeLabel = outcomeLabel(report.outcome, isGM);
    context.outcomeChoices = REPORT_OUTCOMES.map((value) => ({
      value,
      label: game.i18n.localize(`${LANG}.report.outcome.${value}`),
      selected: value === report.outcome,
    }));
    const goods = (market?.actor ?? market)?.system?.market?.goods ?? null;
    context.beliefs = report.beliefs.map((belief, index) => ({
      index,
      category: belief.category,
      label: goodName(belief.category),
      dm: belief.dm,
      pending: isAwaiting(belief),
      dmLabel: dmLabel(belief.dm),
      tip: beliefTipText(belief, { outcome: report.outcome, isGM, goods, day: context.dayLabel, assessor: context.assessorName }),
    }));
    // The Judge's one-click answer: a good awaiting, a market to read, and an outcome whose figures are not the Judge's to type.
    context.canAnswer = isGM && report.outcome !== "false" && !!goods && context.beliefs.some((b) => b.pending);
    context.canEditNotes = canEditNotes;
    // The goods still to be chosen: every catalogue good the report holds no belief for.
    const believed = new Set(report.beliefs.map((b) => b.category));
    context.picks = report.picks;
    context.canChoose = canEditNotes && report.picks > 0;
    context.chooseOptions = context.canChoose
      ? merchandiseCatalog()
          .filter((m) => !believed.has(m.key))
          .map((m) => ({ key: m.key, label: m.label }))
          .sort((a, b) => a.label.localeCompare(b.label))
      : [];
    context.notesText = htmlToNotes(report.notes);
    context.notesHTML = await TextEditor.enrichHTML(report.notes, { relativeTo: this.item, secrets: false });
    return context;
  }

  /**
   * The Judge's edits ride change events on plain controls: the sheet is not a
   * form, so the document's own submit never sees them.
   * @override
   */
  async _onRender(context, options) {
    await super._onRender(context, options);
    if (!game.user.isGM) return;
    const outcome = this.element.querySelector("[data-report-outcome]");
    outcome?.addEventListener("change", () => this.item.update({ "system.outcome": outcome.value }));
    for (const input of this.element.querySelectorAll("[data-report-dm]")) {
      input.addEventListener("change", () => {
        const beliefs = this.item.system.beliefs.map((b) => ({ category: b.category, dm: b.dm }));
        const row = beliefs[Number(input.dataset.index)];
        if (row) row.dm = storedDm(input.value);
        return this.item.update({ "system.beliefs": beliefs });
      });
    }
  }

  /** Learn the goods ticked, through the GM relay; no more than the picks left. */
  static async #onChooseGoods() {
    const chosen = [...this.element.querySelectorAll("[data-report-choose]:checked")].map((input) => input.value);
    const picks = Number(this.item.system.picks) || 0;
    if (!chosen.length) return ui.notifications.warn(t("error.noneChosen"));
    if (chosen.length > picks) return ui.notifications.warn(t("error.tooMany", { left: picks }));
    const result = await performChoose(this.item, chosen);
    if (result?.error) ui.notifications.warn(t(`error.${result.error}`, { left: result.left ?? picks }));
    else if (result?.ok) this.render();
  }

  /** The Judge answers every awaiting good with the market's demand now. */
  static async #onAnswerFromMarket() {
    const result = await answerFromMarket(this.item);
    if (result?.error) ui.notifications.warn(t(`error.${result.error}`));
    else if (result?.ok) this.render();
  }

  /** Save the owner's notes through the GM relay. */
  static async #onSaveNotes() {
    const text = this.element.querySelector("[data-report-notes]")?.value ?? "";
    const result = await performNotes(this.item, text);
    if (result?.error) ui.notifications.warn(game.i18n.localize(`${LANG}.report.error.${result.error}`));
    else if (result?.ok) this.render();
  }
}

/** Register the sheet as the default for the market report sub-type. */
export function registerReportSheet() {
  foundry.documents.collections.Items.registerSheet(MODULE_ID, ReportSheet, {
    types: [REPORT_TYPE],
    makeDefault: true,
    label: `${LANG}.report.sheet`,
  });
}
