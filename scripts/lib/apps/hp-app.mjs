/* global foundry, game, ui, canvas, Hooks */
/**
 * The hit-point window (GM only): one change — damage, healing or a value
 * set outright — applied to every ticked row, each row with its own
 * multiplier and, where the Judge types one, its own amount. It writes
 * through `adjustHp` and keeps the values from before the last change, so
 * that change can be undone while the window is open. One window per world;
 * opening it again re-seeds its rows.
 */
import { MODULE_ID, LANG_PREFIX } from "../constants.mjs";
import { makeLoc } from "../util.mjs";
import { openCoreWindow } from "../core-windows.mjs";
import { ACTOR_TYPE } from "../vocab.mjs";
import { HP_MODE, planHpChange } from "../hp-logic.mjs";
import {
  adjustHp,
  isFlatAmount,
  multiplierLabel,
  postHpReport,
  refreshTarget,
  resolveTargets,
  restoreHp,
  rollAmounts,
} from "../hp.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const loc = makeLoc(LANG_PREFIX);

/** The multipliers a row offers. */
const MULTIPLIERS = Object.freeze([0, 0.5, 1, 2]);

let instance = null;

/** The canvas's selected tokens, when there is a canvas. */
const selectedTokens = () => canvas?.tokens?.controlled ?? [];

/** The hit-point window. */
export class HpApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-hp",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-hp"],
    position: { width: 640, height: 560 },
    window: { title: `${LANG_PREFIX}.hp.title`, icon: "fa-solid fa-heart-pulse", resizable: true },
    actions: {
      apply: HpApp.#onApply,
      undo: HpApp.#onUndo,
      addSelected: HpApp.#onAddSelected,
      mortalWounds: HpApp.#onMortalWounds,
      openRow: HpApp.#onOpenRow,
    },
  };

  // The body is its own scroller so a re-render keeps its place; the footer
  // is a second part so Apply never scrolls away.
  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lib/hp.hbs`, scrollable: [""] },
    footer: { template: `modules/${MODULE_ID}/templates/lib/hp-footer.hbs` },
  };

  /** @type {import("../hp.mjs").HpTarget[]} */
  #targets = [];
  /** target key → `{include, multiplier, amount}`. */
  #rows = new Map();
  #mode = HP_MODE.damage;
  #amount = "";
  #perTarget = false;
  #floorAtZero = false;
  #visible = false;
  /** The last change, for Undo and for the results list: `{results, mode, visible}`. */
  #last = null;
  #busy = false;

  constructor(options = {}) {
    super(options);
    this.#seedRows(resolveTargets(options.from ?? {}));
  }

  /** Replace the rows with the targets `from` names, keeping the change being set up. */
  seed(from) {
    this.#last = null;
    this.#targets = [];
    this.#rows.clear();
    this.#seedRows(resolveTargets(from ?? {}));
    return this.render(true);
  }

  /** Add targets as rows, each ticked when it can be adjusted. */
  #seedRows(targets) {
    for (const target of targets) {
      if (this.#rows.has(target.key)) continue;
      this.#targets.push(target);
      this.#rows.set(target.key, { include: !target.reason, multiplier: 1, amount: "" });
    }
  }

  /** The amount a row takes: its own when typed, else the window's. */
  #amountFor(row) {
    return row.amount.trim() || this.#amount.trim();
  }

  /** @override */
  async _prepareContext() {
    this.#targets = this.#targets.map(refreshTarget);
    const rows = this.#targets.map((target, index) => {
      const row = this.#rows.get(target.key);
      const amount = this.#amountFor(row);
      const plan =
        target.hp && isFlatAmount(amount)
          ? planHpChange(target.hp, { mode: this.#mode, amount, multiplier: row.multiplier, floorAtZero: this.#floorAtZero })
          : null;
      const unavailable = !!target.reason || !target.hp;
      return {
        index,
        key: target.key,
        name: target.name,
        img: target.img,
        partyName: target.partyName,
        openable: !!target.document,
        hp: target.hp ? `${target.hp.value} / ${target.hp.max ?? "—"}` : "—",
        reason: target.reason ? loc(`hp.reason.${target.reason}`) : !target.hp ? loc("hp.why.gone") : "",
        unavailable,
        include: row.include && !unavailable,
        multipliers: MULTIPLIERS.map((m) => ({
          value: m,
          label: multiplierLabel(m) || "×1",
          selected: m === row.multiplier,
        })),
        amount: row.amount,
        after: plan ? plan.after : "?",
        down: !!plan && plan.after <= 0,
      };
    });
    const picked = rows.filter((r) => r.include).length;
    const results = (this.#last?.results ?? []).map((r) => {
      const actor = r.target.document;
      return {
        name: r.target.name,
        text: r.ok ? `${r.before} → ${r.after}` : loc(`hp.why.${r.why}`),
        failed: !r.ok,
        down: !!r.crossedDown,
        key: r.target.key,
        mortalWounds: !!(r.crossedDown && actor && actor.type === ACTOR_TYPE.character),
      };
    });
    return {
      modes: Object.values(HP_MODE).map((value) => ({
        value,
        label: loc(`hp.mode.${value}`),
        checked: value === this.#mode,
      })),
      amount: this.#amount,
      formula: !!this.#amount.trim() && !isFlatAmount(this.#amount),
      perTarget: this.#perTarget,
      floorAtZero: this.#floorAtZero,
      floorDisabled: this.#mode !== HP_MODE.damage,
      visible: this.#visible,
      rows,
      results,
      busy: this.#busy,
      pickedLabel: loc("hp.picked", { count: picked, total: rows.length }),
      cannotApply: this.#busy || !picked || !this.#amount.trim(),
      cannotUndo: this.#busy || !this.#last?.results?.some((r) => r.ok && r.after !== r.before),
    };
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.element.addEventListener("change", (event) => this.#onChange(event));
  }

  /** @override */
  _onClose(options) {
    super._onClose(options);
    if (instance === this) instance = null;
  }

  /** A control changed: the change being set up, or one row's settings. */
  #onChange(event) {
    const el = event.target;
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement)) return;
    const key = el.closest("[data-row]")?.dataset.row;
    if (key) {
      const row = this.#rows.get(key);
      if (!row) return;
      if (el.dataset.field === "include") row.include = el.checked;
      else if (el.dataset.field === "multiplier") row.multiplier = Number(el.value);
      else if (el.dataset.field === "amount") row.amount = el.value;
    } else if (el.name === "mode") this.#mode = el.value;
    else if (el.name === "amount") this.#amount = el.value;
    else if (el.name === "perTarget") this.#perTarget = el.value === "each";
    else if (el.name === "floorAtZero") this.#floorAtZero = el.checked;
    else if (el.name === "visible") this.#visible = el.checked;
    else return;
    this.render();
  }

  /** Roll what needs rolling, write every ticked row, and report. */
  static async #onApply() {
    if (this.#busy) return;
    const picked = this.#targets.filter((t) => this.#rows.get(t.key)?.include && !t.reason && t.hp);
    if (!picked.length || !this.#amount.trim()) return;
    this.#busy = true;
    await this.render({ parts: ["footer"] });
    try {
      // Rows with an amount of their own take it as typed; the rest share the
      // window's amount, rolled once or once each.
      const shared = picked.filter((t) => !this.#rows.get(t.key).amount.trim());
      const rolled = shared.length
        ? await rollAmounts(this.#amount, shared.length, { perTarget: this.#perTarget })
        : { amounts: [], rolls: [], formula: null };
      const entries = [];
      for (const target of picked) {
        const row = this.#rows.get(target.key);
        const own = row.amount.trim();
        let amount;
        if (own) {
          if (!isFlatAmount(own)) throw new Error(loc("hp.badRowAmount", { name: target.name }));
          amount = parseInt(own, 10);
        } else amount = rolled.amounts[shared.indexOf(target)];
        entries.push({ target, amount, multiplier: row.multiplier });
      }
      const results = await adjustHp(entries, { mode: this.#mode, floorAtZero: this.#floorAtZero });
      this.#last = { results, mode: this.#mode, visible: this.#visible };
      await postHpReport(results, { mode: this.#mode, formula: rolled.formula, rolls: rolled.rolls, visible: this.#visible });
    } catch (err) {
      ui.notifications.error(err.message);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  /** Put back what the last change wrote, and say so where its report went. */
  static async #onUndo() {
    if (this.#busy || !this.#last) return;
    this.#busy = true;
    await this.render({ parts: ["footer"] });
    try {
      const restored = await restoreHp(this.#last.results);
      await postHpReport(restored, { mode: HP_MODE.set, visible: this.#last.visible, undone: true });
      this.#last = null;
    } catch (err) {
      ui.notifications.error(err.message);
    } finally {
      this.#busy = false;
      this.render();
    }
  }

  /** Add the canvas's selected tokens as rows. */
  static async #onAddSelected() {
    const tokens = selectedTokens();
    if (!tokens.length) return ui.notifications.info(loc("hp.noneSelected"));
    this.#seedRows(resolveTargets({ tokens }));
    this.render();
  }

  /** Open core's Mortal Wounds window for a character the last change took to 0 or below. */
  static async #onMortalWounds(_event, target) {
    const result = this.#last?.results?.find((r) => r.target.key === target.dataset.key);
    const actor = result && refreshTarget(result.target).document;
    if (!actor) return ui.notifications.warn(loc("hp.why.gone"));
    openCoreWindow("mortalWounds", actor);
  }

  /** Open a row's sheet. */
  static async #onOpenRow(_event, target) {
    const row = this.#targets.find((t) => t.key === target.dataset.key);
    const doc = row && refreshTarget(row).document;
    if (!doc?.sheet) return ui.notifications.warn(loc("hp.why.gone"));
    doc.sheet.render(true);
  }
}

/**
 * Open the hit-point window on the targets `from` names — tokens, actors and
 * party ids — or on the canvas's selected tokens when it names none. GM only;
 * a second call re-seeds the open window.
 * @param {{tokens?: object[], actors?: object[], parties?: string[]}} [from]
 * @returns {HpApp|null}
 */
export function openHpTool(from = null) {
  if (!game.user?.isGM) {
    ui.notifications.warn(loc("hp.gmOnly"));
    return null;
  }
  const seed = from ?? { tokens: selectedTokens() };
  if (instance?.rendered) {
    instance.seed(seed);
    instance.bringToFront();
    return instance;
  }
  instance = new HpApp({ from: seed });
  instance.render(true);
  return instance;
}

/**
 * The Tokens layer gets a button for it, for the GM, seeded with the
 * selection.
 */
export function installHpControl() {
  Hooks.on("getSceneControlButtons", (controls) => {
    const tokens = controls.tokens ?? controls.find?.((c) => c.name === "tokens" || c.name === "token");
    if (!tokens) return;
    const tool = {
      name: "acksHitPoints",
      title: game.i18n.localize(`${LANG_PREFIX}.hp.tool`),
      icon: "fa-solid fa-heart-pulse",
      button: true,
      visible: game.user.isGM,
      // One handler only: v13+ calls BOTH `onChange` and `onClick` on a
      // `button: true` tool, so a second window opens over the first.
      onChange: () => openHpTool(),
    };
    // v13+ hands these over as an object keyed by name; older builds as an
    // array.
    if (Array.isArray(tokens.tools)) tokens.tools.push(tool);
    else tokens.tools[tool.name] = tool;
  });
}
