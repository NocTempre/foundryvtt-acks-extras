/* global foundry, game, ui, fromUuid */
/**
 * Sheet for a market report Item: the market, when and by whom, and what the
 * owner believes about each good's demand.
 *
 * Read-mostly. A player holds OBSERVER on the trade house, so the sheet is a
 * plain window rather than a form: nothing on it submits through the document,
 * and the two things a viewer may change are handled here. The owner (or the
 * Judge) saves their notes through the GM relay; the Judge alone edits the
 * outcome and the believed modifiers. The stored outcome `false` is shown to a
 * non-GM as partial, on every surface.
 */
import { MODULE_ID, LANG, REPORT_TYPE } from "../constants.mjs";
import { merchandiseFor } from "../engine/merchandise.mjs";
import { plainReport, performNotes } from "../engine/trade-objects.mjs";
import { ownerOf, resolveActorSync } from "../../lib/storage.mjs";
import { REPORT_OUTCOMES, shownOutcome, htmlToNotes } from "../rules/reports.mjs";
import { SECONDS_PER_DAY } from "../../henchmen/constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const t = (key, data) => (data ? game.i18n.format(`${LANG}.report.${key}`, data) : game.i18n.localize(`${LANG}.report.${key}`));
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** A good's display name: the catalogue's label (a Judge's own good included), else its key. */
export const goodName = (category) => merchandiseFor(category)?.label ?? category;

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

export default class ReportSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-markets-report-sheet"],
    position: { width: 480, height: 560 },
    tag: "div",
    window: { resizable: true },
    actions: { saveNotes: ReportSheet.#onSaveNotes },
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
    context.beliefs = report.beliefs.map((belief, index) => ({
      index,
      category: belief.category,
      label: goodName(belief.category),
      dm: belief.dm,
      dmLabel: signed(belief.dm),
    }));
    context.canEditNotes = canEditNotes;
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
        if (row) row.dm = Math.round(Number(input.value) || 0);
        return this.item.update({ "system.beliefs": beliefs });
      });
    }
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
