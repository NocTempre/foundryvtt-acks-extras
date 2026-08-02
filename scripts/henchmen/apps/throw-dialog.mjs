/* global game, ui, foundry, Roll */
/**
 * The shared Throw Dialog — one ApplicationV2 dialog parameterized entirely
 * by a throw definition from `ruledata/throws.json` (ported from the
 * acks-domains throw framework, extended with:)
 *
 *  - dynamic modifiers: effect-derived rows injected at open time via
 *    `context.dynamicModifiers` (built by effects.mjs from the actor's
 *    proficiency/power Active Effects — the data-driven modifier contract);
 *  - secret throws: resolved GM-side, whispered to GMs, with a "Reveal
 *    outcome" button that posts a sanitized public card;
 *  - natural-roll clamps by OUTCOME (Hireling Loyalty: a natural 2 is never
 *    better than Resignation, a natural 12 never worse than Loyalty).
 *
 * Modifier kinds: "auto" (derived, locked; GM can unlock) and "situational"
 * (the user ticks what applies). Controls: checkbox / stepper / select.
 * A free "misc" field is always present. A live total updates on change.
 */
import { MODULE_ID } from "../constants.mjs";
import { getThrowDef, getTable } from "../rules/tables.mjs";
import { postThrowCard } from "../chat/cards.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class ThrowDialog extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {string} options.throwId - id in ruledata/throws.json
   * @param {object} [options.context]
   *   { title?, derived?: {deriveKey: value}, dynamicModifiers?: [],
   *     speaker?, actor?, secretOverride?: boolean, infoText?,
   *     disabledOptions?: {modId: [optionId]}, optionLabels?: {modId: {optionId: text}},
   *     onResolve?: (result) => void }
   */
  constructor({ throwId, context = {}, ...options } = {}) {
    super(options);
    this.throwId = throwId;
    this.context = context;
    this.def = getThrowDef("throws", throwId);
  }

  static DEFAULT_OPTIONS = {
    id: "acks-henchmen-throw-{id}",
    tag: "form",
    classes: ["acks-henchmen", "throw-dialog"],
    position: { width: 460 },
    window: { resizable: false, contentClasses: ["standard-form"] },
    form: {
      handler: ThrowDialog.#onSubmit,
      closeOnSubmit: true,
    },
    actions: { unlockAuto: ThrowDialog.#onUnlockAuto },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/henchmen/throw-dialog.hbs` },
  };

  get isSecret() {
    return this.context.secretOverride ?? this.def.secret ?? false;
  }

  /** Static def modifiers + dynamic effect-derived ones. */
  get allModifiers() {
    return [...this.def.modifiers, ...(this.context.dynamicModifiers ?? [])];
  }

  /** @override */
  get title() {
    const base = game.i18n.localize(this.def.label);
    return this.context.title ? `${base} — ${this.context.title}` : base;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const derived = this.context.derived ?? {};
    context.formula = this.def.formula;
    context.secret = this.isSecret;
    context.modifiers = this.allModifiers.map((m) => {
      const hasDerived = m.derive != null && derived[m.derive] !== undefined;
      const isDynamic = m.dynamicInitial !== undefined;
      const initial = hasDerived ? derived[m.derive] : isDynamic ? m.dynamicInitial : this.#defaultValue(m);
      return {
        ...m,
        labelText: m.label?.startsWith?.("ACKS-HENCHMEN.") ? game.i18n.localize(m.label) : m.label,
        hintText: m.hint?.startsWith?.("ACKS-HENCHMEN.") ? game.i18n.localize(m.hint) : (m.hint ?? ""),
        locked: (m.kind === "auto" && hasDerived) || m.dynamicLocked === true,
        sourceTooltip: hasDerived ? game.i18n.format("ACKS-HENCHMEN.throwUi.derivedFrom", { key: m.derive }) : "",
        initial,
        isCheckbox: m.control === "checkbox",
        isStepper: m.control === "stepper",
        isSelect: m.control === "select",
        options: (m.options ?? []).map((o) => ({
          ...o,
          labelText:
            this.context.optionLabels?.[m.id]?.[o.id] ??
            (o.label?.startsWith?.("ACKS-HENCHMEN.") ? game.i18n.localize(o.label) : o.label),
          selected: o.value === initial,
          disabled: (this.context.disabledOptions?.[m.id] ?? []).includes(o.id),
        })),
      };
    });
    context.infoText = this.context.infoText ?? "";
    context.total = this.#formatTotal(this.#computeTotal(this.element));
    return context;
  }

  #defaultValue(m) {
    if (m.control === "checkbox") return false;
    if (m.control === "select") return m.options?.[0]?.value ?? 0;
    return 0;
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.addEventListener("change", () => this.#refreshTotal());
    this.element.addEventListener("input", () => this.#refreshTotal());
    this.#refreshTotal();
  }

  #refreshTotal() {
    const el = this.element?.querySelector("[data-throw-total]");
    if (el) el.textContent = this.#formatTotal(this.#computeTotal(this.element));
  }

  #computeTotal(root) {
    const parts = [];
    if (!root) return { total: 0, parts };
    for (const m of this.allModifiers) {
      const input = root.querySelector(`[name="mod.${m.id}"]`);
      if (!input) continue;
      let value = 0;
      if (m.control === "checkbox") value = input.checked ? m.value : 0;
      else if (m.control === "stepper") value = (parseInt(input.value, 10) || 0) * m.valuePerStep;
      else if (m.control === "select") value = parseInt(input.value, 10) || 0;
      if (value !== 0) {
        const label = m.label?.startsWith?.("ACKS-HENCHMEN.") ? game.i18n.localize(m.label) : m.label;
        parts.push({ id: m.id, label, value });
      }
    }
    const misc = parseInt(root.querySelector('[name="mod.misc"]')?.value, 10) || 0;
    if (misc !== 0) parts.push({ id: "misc", label: game.i18n.localize("ACKS-HENCHMEN.throwUi.misc"), value: misc });
    return { total: parts.reduce((s, p) => s + p.value, 0), parts };
  }

  #formatTotal({ total }) {
    return total >= 0 ? `+${total}` : `${total}`;
  }

  /** GM-only: unlock auto-derived controls and disabled options. */
  static #onUnlockAuto(_event, _target) {
    if (!game.user.isGM) {
      ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.throwUi.gmOnlyOverride"));
      return;
    }
    this.element.querySelectorAll("[data-locked]").forEach((el) => (el.disabled = false));
    this.element.querySelectorAll("option[disabled]").forEach((el) => (el.disabled = false));
  }

  /** Resolve the throw: roll, clamp, look up the outcome, post the card. */
  static async #onSubmit(_event, _form, _formData) {
    const { total, parts } = this.#computeTotal(this.element);
    const roll = await new Roll(`${this.def.formula} + (${total})`).evaluate();
    const natural = roll.dice[0]?.total ?? roll.total - total;
    const outcome = this.#resolveOutcome(natural, roll.total);
    const result = { throwId: this.throwId, natural, modifier: total, total: roll.total, parts, outcome };
    await postThrowCard({
      def: this.def,
      title: this.title,
      roll,
      natural,
      parts,
      total,
      outcome,
      secret: this.isSecret,
      speaker: this.context.speaker,
      actor: this.context.actor,
    });
    await this.context.onResolve?.(result);
    return result;
  }

  /**
   * Outcome lookup with by-outcome natural clamps:
   * `naturalClamps.natural2.noBetterThan` / `naturalClamps.natural12.noWorseThan`
   * name outcome effects; ordering = the outcome array (worst → best).
   */
  #resolveOutcome(natural, adjusted) {
    if (!this.def.outcomeTable) return null;
    const table = getTable("throws", this.def.outcomeTable);
    const rows = table.outcomes;
    const rowIndex = (lookup) =>
      rows.findIndex((o) => (o.min === undefined || lookup >= o.min) && (o.max === undefined || lookup <= o.max));
    let idx = rowIndex(adjusted);
    if (idx < 0) idx = adjusted < (rows[0].min ?? -Infinity) ? 0 : rows.length - 1;
    const clamps = table.naturalClamps;
    if (clamps) {
      if (natural === 2 && clamps.natural2?.noBetterThan) {
        const cap = rows.findIndex((o) => o.effect === clamps.natural2.noBetterThan);
        if (cap >= 0 && idx > cap) idx = cap;
      }
      if (natural === 12 && clamps.natural12?.noWorseThan) {
        const floor = rows.findIndex((o) => o.effect === clamps.natural12.noWorseThan);
        if (floor >= 0 && idx < floor) idx = floor;
      }
    }
    return rows[idx]?.effect ?? null;
  }
}

/**
 * Open a throw dialog.
 * @param {string} throwId
 * @param {object} [context] - see ThrowDialog constructor
 * @returns {ThrowDialog}
 */
export function openThrowDialog(throwId, context = {}) {
  const dialog = new ThrowDialog({ throwId, context });
  dialog.render(true);
  return dialog;
}
