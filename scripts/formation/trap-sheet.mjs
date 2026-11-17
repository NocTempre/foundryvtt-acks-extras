/* global foundry, game */
import { FORMATION_DOC, MODULE_ID, SAVE_KEYS } from "./constants.mjs";
import {
  ON_SUCCESS,
  RESOLUTIONS,
  SCOPES,
  TRAP_LEVELS,
  mergeTierSubmit,
  pitDamage,
  pitFigures,
  trapFigures,
} from "./trap-rules.mjs";
import { citeOf } from "../lib/tables.mjs";
import { atTypeScale } from "../lib/util.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

/** Localize and fill a full lang key; the sheet's views take it as an argument so they run without a world. */
const format = (key, data = {}) => game.i18n.format(key, data);

/** The joiner of a tooltip's parts, as the crossing's tooltips use it. */
const TIP_JOIN = " · ";

/**
 * The imported page a figure was read from, else the shipped reference: a
 * Judge's override and a missing import both have no page of their own.
 */
const pageOr = (cite, ref) => cite || ref;

/**
 * The level strip's view: one step per level with its state, and the line that
 * says the state in words. A level is filled when its row holds text, a damage
 * formula, an attack throw or a pit depth; `stated` is asked of the row, never of
 * the array's length, since a trap always holds six rows.
 *
 * @param {object[]} rows the trap's `levels`
 * @param {number} level the level on screen, 1-based
 * @param {number} max how many levels a trap holds
 * @param {(key: string, data?: object) => string} loc full-key formatter
 * @returns {{steps: {level: number, current: boolean, stated: boolean, label: string}[], summary: string}}
 */
export function levelStripView(rows, level, max, loc) {
  const steps = Array.from({ length: max }, (_, i) => {
    const row = rows?.[i];
    const stated =
      !!row &&
      (!!String(row.text ?? "").trim() ||
        !!String(row.damageFormula ?? "").trim() ||
        !!row.attackThrow ||
        !!row.pitDepthFeet);
    const current = i === (level ?? 1) - 1;
    const key = current ? (stated ? "currentFilled" : "currentBlank") : stated ? "filled" : "blank";
    return { level: i + 1, current, stated, label: loc(`ACKS-FORMATION.traps.strip.${key}`, { level: i + 1 }) };
  });
  const summary = loc("ACKS-FORMATION.traps.strip.summary", {
    level: Math.min(Math.max(1, Number(level) || 1), max),
    max,
    filled: steps.filter((s) => s.stated).length,
  });
  return { steps, summary };
}

/**
 * A pit's damage as a tooltip: the depth, then the fall's dice and the spikes'
 * dice, each with the page it was read from. A part the world does not hold is
 * its page reference alone: no figure stands in for it and nothing says it is
 * missing. The depth is the Judge's own entry and always a figure.
 *
 * @param {object} o
 * @param {number} o.depthFeet the level's pit depth
 * @param {boolean} o.spiked
 * @param {object} o.figures `pitFigures()`
 * @param {string[]} o.unknown `pitDamage`'s `unknown`: `fall`, `spikes`
 * @param {(table: string) => string|null} o.cite the imported page of a `formation` table, or null
 * @param {(key: string, data?: object) => string} o.loc full-key formatter
 * @returns {string}
 */
export function pitTooltip({ depthFeet, spiked, figures, unknown = [], cite, loc }) {
  // The fall's dice are read from the landing passage, so they cite the jump's section.
  const refFall = loc("ACKS-FORMATION.crossing.ref.jumping");
  const refSpikes = loc("ACKS-FORMATION.traps.ref.spikes");
  const parts = [];
  if (Number(depthFeet) > 0) parts.push(`${loc("ACKS-FORMATION.crossing.fallPart.depth")} ${depthFeet}`);

  const fall = figures?.fall;
  if (fall && !unknown.includes("fall")) {
    const dice = loc("ACKS-FORMATION.crossing.tip.fallDice", { count: fall.count, faces: fall.faces, feet: fall.feetPerDie });
    parts.push(`${dice} (${pageOr(cite("fall"), refFall)})`);
  } else {
    parts.push(refFall);
  }

  if (spiked) {
    const spike = figures?.spike;
    if (spike && !unknown.includes("spikes")) {
      const dice = loc("ACKS-FORMATION.traps.pit.spikes", { count: spike.count, faces: spike.faces });
      parts.push(`${dice} (${pageOr(cite("pitSpikeCount"), refSpikes)})`);
    } else {
      parts.push(refSpikes);
    }
  }
  return parts.join(TIP_JOIN);
}

/**
 * The trigger band in force and where it comes from. A figure typed on the trap
 * wins and is named as the trap's own; a blank one reads the imported band and
 * names its page; with neither, the figure is blank and the tooltip is the page
 * reference alone. A typed 0 is a figure ("never springs").
 *
 * @param {object} o
 * @param {number|null} o.own the trap's `triggerOn`
 * @param {number|null} o.imported the imported band (`trapFigures().triggerOn`)
 * @param {(table: string) => string|null} o.cite the imported page of a `formation` table, or null
 * @param {(key: string, data?: object) => string} o.loc full-key formatter
 * @returns {{text: string, tip: string}}
 */
export function triggerBandView({ own, imported, cite, loc }) {
  const ref = loc("ACKS-FORMATION.traps.ref.trap");
  const page = pageOr(cite("trapTriggerOn"), ref);
  if (own != null) {
    const tip =
      imported != null
        ? loc("ACKS-FORMATION.traps.band.ownOver", { band: imported, page })
        : loc("ACKS-FORMATION.traps.band.own", { page: ref });
    return { text: String(own), tip };
  }
  if (imported != null) return { text: String(imported), tip: loc("ACKS-FORMATION.traps.band.imported", { page }) };
  return { text: "", tip: ref };
}

/**
 * Sheet for a trap Item, the hand-editing half of the trap document. Fields
 * that matter to one kind of trap show only once that kind is chosen. One level
 * row is on screen at a time: the level selector picks the row edited and the
 * row a sprung trap fires, and a strip says which levels hold anything.
 * See docs/formation/DECISIONS.md, "A trap is one document at six levels, not six documents".
 */
export default class TrapSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    // no-scroll: this sheet submits on change, so it scrolls at its form PART
    // root, not at `.window-content`. The shared contract would make the
    // frame the scroller, which is not a part, and ApplicationV2 restores
    // scroll per part, so the part's `scrollable: [""]` below would stop
    // working. The scroller lives in styles/formation.css, in the trap sheet's block.
    classes: ["acks-ui", "acks-extras", "acks-extras-trap-sheet"],
    // The canvas width; `_initializeApplicationOptions` scales it to the seat's type size.
    position: { width: 460, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/formation/trap-item.hbs`, scrollable: [""] },
  };

  /**
   * Open at the canvas width for the seat's type size. `DEFAULT_OPTIONS` is
   * evaluated before settings exist, so the scale is applied here at
   * construction; the height stays `auto`.
   */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    return opts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const system = this.item.system;
    context.system = system;
    context.editable = this.isEditable;
    // The description editor needs the item's uuid, which DocumentSheetV2's context lacks.
    context.item = this.item;

    // The bare `TextEditor` global is deprecated in v14.
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

    // The row on screen and its submit path (the template has no concat helper).
    const tier = system.tier;
    context.tier = tier;
    context.tierPath = `system.levels.${Math.max(0, (system.level ?? 1) - 1)}`;

    context.levelMax = TRAP_LEVELS;
    const strip = levelStripView(system.levels, system.level, TRAP_LEVELS, format);
    context.levelStrip = strip.steps;
    context.levelSummary = strip.summary;

    context.isSave = tier.resolution === RESOLUTIONS.save;
    context.isAttack = tier.resolution === RESOLUTIONS.attack;
    context.isArea = system.scope === SCOPES.area;
    const cite = (table) => citeOf(FORMATION_DOC, table);
    // The pit's derived damage; no line when a typed formula has won or there is no depth.
    // The line stays with no fall imported: blank, its tooltip the page reference.
    const typed = String(tier.damageFormula ?? "").trim();
    const pitFigs = pitFigures();
    const pit = typed ? null : pitDamage(tier.pitDepthFeet, tier.spiked, pitFigs);
    context.pitLine =
      pit && Number(tier.pitDepthFeet) > 0
        ? {
            formula: pit.formula ?? "",
            tip: pitTooltip({
              depthFeet: tier.pitDepthFeet,
              spiked: !!tier.spiked,
              figures: pitFigs,
              unknown: pit.unknown,
              cite,
              loc: format,
            }),
          }
        : null;

    // The trigger band: blank reads the imported one; the die's faces bound a typed band.
    const figures = trapFigures();
    context.triggerMax = figures.triggerFaces;
    context.triggerOnPlaceholder = figures.triggerOn ?? "";
    context.triggerBand = triggerBandView({ own: system.triggerOn, imported: figures.triggerOn, cite, loc: format });
    return context;
  }

  /**
   * @override — rebuild `levels` from what is stored before the model cleans
   * the submit, overlaying only the row that was on screen (see
   * `mergeTierSubmit`: the form's dotted index paths expand into an array
   * holding only the named row). The submitted value is always an array, so
   * that is no guard.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    // A blank band is stored as null (the imported one), never 0 ("never springs").
    if (data.system && "triggerOn" in data.system) {
      const band = data.system.triggerOn;
      data.system.triggerOn = band === "" || band == null || Number.isNaN(Number(band)) ? null : Number(band);
    }
    const submitted = data.system?.levels;
    if (submitted) {
      const level = data.system.level ?? this.item.system.level;
      data.system.levels = mergeTierSubmit(this.item.system.levels, submitted, level);
    }
    return data;
  }
}
