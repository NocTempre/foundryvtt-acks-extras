/* global game, ui, foundry, Roll */
/**
 * DemandGenerator: the Judge's window for generating a market's base demand
 * (JJ 199-202, Step 7 A-D) for every good in the merchandise catalogue.
 *
 * The window keeps its working state on the instance and writes nothing until
 * Apply. Step A's roll per good is stored so a regeneration repeats, and the
 * Judge may edit any cell; Step C's picks come from the imported land-revenue
 * table's counts, drawn on the merchandise items' random bands or chosen by
 * hand. B and D read the environment and racial columns of the merchandise
 * items themselves. The preview shows each step per good and the base that
 * Apply writes through `applyGenerated`, which never touches the Judge's pinned
 * overrides.
 *
 * The state form submits on change and re-renders, so the body is a scroll part
 * and the footer stays pinned outside it.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { DEMAND_AGE_HEADERS_SETTING } from "../merchandise-keys.mjs";
import { merchandiseCatalog } from "../engine/merchandise.mjs";
import { applyGenerated } from "../engine/demand.mjs";
import {
  STEP_A_ROLL,
  RANDOM_GOOD_DIE,
  AGE_BANDS,
  DEMAND_WATER,
  DEMAND_BIOMES,
  DEMAND_ELEVATIONS,
  baseDemand,
  racesOf,
  landRevenueCounts,
  drawLandPicks,
  hasRandomBands,
} from "../rules/demand.mjs";
import { optTable } from "../../henchmen/rules/tables.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

const t = (key, data) => (data ? game.i18n.format(`${LANG}.demand.${key}`, data) : game.i18n.localize(`${LANG}.demand.${key}`));
const envLabel = (key) => game.i18n.localize(`${LANG}.merchandise.env.${key}`);
const signed = (n) => (n > 0 ? `+${n}` : `${n}`);

/** The age-band header text the merchandise import wrote, by column key; empty before an import. */
function ageHeaders() {
  try {
    return game.settings.get(MODULE_ID, DEMAND_AGE_HEADERS_SETTING) ?? {};
  } catch {
    return {};
  }
}

/** A whole-number input's value, or null when it is blank or not a number. */
function wholeOrNull(value) {
  if (value === "" || value == null) return null;
  const n = Math.trunc(Number(value));
  return Number.isFinite(n) ? n : null;
}

/** The land-revenue counts for a revenue, or null when the table is unread or names no such row. */
function countsFor(revenueGp) {
  if (revenueGp == null) return null;
  const rows = optTable("demand", "landRevenueProse")?.rows;
  return typeof rows === "string" ? landRevenueCounts(rows, revenueGp) : null;
}

/** One d100 for a random-merchandise draw. */
const rollGood = async () => (await new Roll(`1d${RANDOM_GOOD_DIE}`).evaluate()).total;

export class DemandGenerator extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} o
   * @param {Actor} o.location  The market location the result is written to.
   * @param {Application} [o.sheet]  The sheet to re-render after Apply.
   */
  constructor({ location, sheet = null, ...options } = {}) {
    super(options);
    this.location = location;
    this.sheet = sheet;
    // Never `this.state`: ApplicationV2 defines `state` as a getter, and the
    // assignment throws before the window can open.
    this.draft = DemandGenerator.#initialState(location);
    /** Race keys as last listed, so a checkbox index names the same race on submit. */
    this.raceKeys = [];
    /** Catalogue keys as last listed, so a roll cell's index names the same good on submit. */
    this.goodKeys = [];
  }

  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-demand-generator-{id}",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-markets-generator"],
    position: { width: 780, height: 720 },
    window: { resizable: true, icon: "fas fa-dice" },
    form: { handler: DemandGenerator.#onForm, submitOnChange: true, closeOnSubmit: false },
    actions: {
      rollA: DemandGenerator.#onRollA,
      rollPicks: DemandGenerator.#onRollPicks,
      addPick: DemandGenerator.#onAddPick,
      removePick: DemandGenerator.#onRemovePick,
      clearPicks: DemandGenerator.#onClearPicks,
      apply: DemandGenerator.#onApply,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE_ID}/templates/markets/demand-generator.hbs`,
      scrollable: [".acks-extras-markets-generator-body"],
    },
  };

  get title() {
    return t("title", { location: this.location.name });
  }

  /** The window's starting inputs: the market's stored profile, so a regeneration repeats its rolls and picks. */
  static #initialState(location) {
    const profile = location.system.market.goods.dmProfile;
    const a = {};
    for (const row of profile?.rolls ?? []) a[row.category] = Number(row.a) || 0;
    return {
      ageBand: profile?.ageBand ?? null,
      water: new Set(profile?.water ?? []),
      biome: new Set(profile?.biome ?? []),
      elevation: profile?.elevation ?? null,
      landRevenueGp: profile?.landRevenueGp ?? null,
      races: new Set(profile?.races ?? []),
      a,
      picks: (profile?.landPicks ?? []).map((p) => ({ category: p.category, delta: Number(p.delta) || 0 })),
      pickDelta: null,
    };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const s = this.draft;
    const catalog = merchandiseCatalog();
    const headers = ageHeaders();
    this.goodKeys = catalog.map((row) => row.key);
    this.raceKeys = racesOf(catalog);

    context.hasCatalog = catalog.length > 0;
    context.ageOptions = [
      { value: "", label: t("none"), selected: s.ageBand == null },
      ...AGE_BANDS.map((n) => ({ value: n, label: headers[`age${n}`] || game.i18n.format(`${LANG}.merchandise.env.age`, { n }), selected: s.ageBand === n })),
    ];
    context.waterBoxes = DEMAND_WATER.map((key) => ({ key, label: envLabel(key), checked: s.water.has(key) }));
    context.biomeBoxes = DEMAND_BIOMES.map((key) => ({ key, label: envLabel(key), checked: s.biome.has(key) }));
    context.elevationOptions = [
      { value: "", label: t("none"), selected: !s.elevation },
      ...DEMAND_ELEVATIONS.map((key) => ({ value: key, label: envLabel(key), selected: s.elevation === key })),
    ];
    context.landRevenueGp = s.landRevenueGp ?? "";
    context.raceBoxes = this.raceKeys.map((key, index) => ({ index, label: key, checked: s.races.has(key) }));

    const counts = countsFor(s.landRevenueGp);
    context.countsLine = counts
      ? t("counts", { plus: counts.plus, plusDelta: signed(counts.plusDelta), minus: counts.minus, minusDelta: signed(counts.minusDelta) })
      : "";
    context.countsMissing = s.landRevenueGp != null && !counts;
    context.canRollPicks = !!counts && hasRandomBands(catalog);

    const labelOf = new Map(catalog.map((row) => [row.key, row.label]));
    context.picks = s.picks.map((p, index) => ({ index, label: labelOf.get(p.category) ?? p.category, delta: signed(p.delta) }));
    context.goodOptions = catalog.map((row) => ({ value: row.key, label: row.label }));
    context.pickDelta = s.pickDelta ?? "";

    const landDeltas = new Map();
    for (const p of s.picks) landDeltas.set(p.category, (landDeltas.get(p.category) ?? 0) + p.delta);
    context.rows = catalog.map((row, index) => {
      const step = baseDemand({
        environment: row.environment,
        ageBand: s.ageBand,
        water: [...s.water],
        biome: [...s.biome],
        elevation: s.elevation,
        racial: row.racial,
        races: [...s.races],
        a: s.a[row.key] ?? 0,
        landDelta: landDeltas.get(row.key) ?? 0,
      });
      return {
        index,
        label: row.label,
        a: step.a,
        b: step.b == null ? t("noEnvironment") : signed(step.b),
        c: signed(step.c),
        d: signed(step.d),
        base: signed(step.base),
      };
    });
    context.stepARoll = STEP_A_ROLL;
    return context;
  }

  /** Copy the form's inputs into the working state, then redraw the preview. */
  static async #onForm(event, _form, formData) {
    const d = foundry.utils.expandObject(formData.object);
    const s = this.draft;
    s.ageBand = wholeOrNull(d.ageBand);
    s.water = new Set(DEMAND_WATER.filter((key) => d.water?.[key]));
    s.biome = new Set(DEMAND_BIOMES.filter((key) => d.biome?.[key]));
    s.elevation = d.elevation || null;
    const revenue = d.landRevenueGp === "" || d.landRevenueGp == null ? null : Number(d.landRevenueGp);
    s.landRevenueGp = Number.isFinite(revenue) ? revenue : null;
    s.races = new Set(this.raceKeys.filter((_, i) => d.race?.[i]));
    for (const [i, key] of this.goodKeys.entries()) {
      const value = d.a?.[i];
      if (value !== undefined) s.a[key] = Math.trunc(Number(value) || 0);
    }
    s.pickDelta = wholeOrNull(d.pickDelta);
    // The add-a-pick controls are read by their button; redrawing on their
    // change would replace the button under the click.
    if (["pickCategory", "pickDelta"].includes(event?.target?.name)) return;
    await this.render();
  }

  /** Roll Step A for every good and store the results. */
  static async #onRollA() {
    for (const key of this.goodKeys) this.draft.a[key] = (await new Roll(STEP_A_ROLL).evaluate()).total;
    await this.render();
  }

  /** Draw Step C's picks from the imported counts on the random bands. */
  static async #onRollPicks() {
    const counts = countsFor(this.draft.landRevenueGp);
    if (!counts) return void ui.notifications.warn(t("countsMissing"));
    const catalog = merchandiseCatalog();
    if (!hasRandomBands(catalog)) return void ui.notifications.warn(t("noBands"));
    const { picks, short } = await drawLandPicks(catalog, counts, rollGood);
    this.draft.picks = picks;
    if (short) ui.notifications.warn(t("drawShort", { n: short }));
    await this.render();
  }

  /** Add one hand-picked good with the signed change typed beside it. */
  static async #onAddPick() {
    const category = this.element.querySelector("[name='pickCategory']")?.value;
    const delta = wholeOrNull(this.element.querySelector("[name='pickDelta']")?.value);
    if (!category || !delta) return void ui.notifications.warn(t("pickNeeds"));
    this.draft.picks.push({ category, delta });
    this.draft.pickDelta = null;
    await this.render();
  }

  /** Remove one pick by its position. */
  static async #onRemovePick(_event, target) {
    this.draft.picks.splice(Number(target.dataset.index), 1);
    await this.render();
  }

  /** Drop every pick. */
  static async #onClearPicks() {
    this.draft.picks = [];
    await this.render();
  }

  /** Confirm where a base already exists, then write the generated base. */
  static async #onApply() {
    if (!game.user.isGM) return;
    const goods = this.location.system.market.goods;
    const source = goods.dmProfile?.source;
    const hasBase = (goods.demand ?? []).length > 0;
    if (source || hasBase) {
      const escape = foundry.utils.escapeHTML;
      const body = source ? t("confirmSource", { book: escape(source.book ?? ""), page: escape(source.page ?? "") }) : t("confirmBase");
      const ok = await foundry.applications.api.DialogV2.confirm({
        classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
        window: { title: t("confirmTitle") },
        content: `<p>${body}</p><p>${escape(t("confirmOverrides"))}</p>`,
        rejectClose: false,
        yes: { default: false },
      }).catch(() => false);
      if (!ok) return;
    }
    const s = this.draft;
    const landDeltas = new Map();
    for (const p of s.picks) landDeltas.set(p.category, (landDeltas.get(p.category) ?? 0) + p.delta);
    const catalog = merchandiseCatalog();
    const results = catalog.map((row) => ({
      category: row.key,
      base: baseDemand({
        environment: row.environment,
        ageBand: s.ageBand,
        water: [...s.water],
        biome: [...s.biome],
        elevation: s.elevation,
        racial: row.racial,
        races: [...s.races],
        a: s.a[row.key] ?? 0,
        landDelta: landDeltas.get(row.key) ?? 0,
      }).base,
    }));
    const result = await applyGenerated(this.location, {
      profile: {
        ageBand: s.ageBand,
        water: [...s.water],
        biome: [...s.biome],
        elevation: s.elevation,
        landRevenueGp: s.landRevenueGp,
        races: [...s.races],
        rolls: catalog.map((row) => ({ category: row.key, a: s.a[row.key] ?? 0 })),
        landPicks: s.picks,
      },
      results,
    });
    if (result?.error) return void ui.notifications.warn(game.i18n.localize(`${LANG}.trade.error.${result.error}`));
    ui.notifications.info(t("applied", { n: result.written }));
    this.sheet?.render();
    await this.close();
  }
}

/**
 * Open the generator for a market location. GM only.
 * @param {Actor} location
 * @param {Application} [sheet]  Re-rendered after Apply.
 * @returns {DemandGenerator|null}
 */
export function openDemandGenerator(location, sheet = null) {
  if (!game.user.isGM) return null;
  const app = new DemandGenerator({ location, sheet });
  app.render(true);
  return app;
}
