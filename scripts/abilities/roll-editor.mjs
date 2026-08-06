/* global foundry, game */
/**
 * The roll editor — one window per throw, and the four sheet actions that add,
 * remove, roll and open them.
 *
 * The Rolls tab is an INVENTORY of throws: add a row, delete a row, open a row
 * to edit it. Everything about a throw is edited in this window, including its
 * level table, because a ladder is part of the throw rather than a second thing
 * attached to it — Animal Husbandry's diagnosis target IS "11+ at rank 1, 7+ at
 * 2, 3+ at 3", and splitting the table out of the throw would ask the reader to
 * assemble the rule from two places.
 *
 * Edits apply as they are made, the way an item sheet applies them; there is no
 * Save button and no draft to lose. Every write goes through `writeRolls()`, so
 * this window has no privileged access to the store.
 *
 * The table is INTERNAL — its rungs live on the roll. The alternative is the
 * `progression` kind, which NAMES a published table instead: the four chassis
 * or any class document the world holds, resolved through the classes
 * registry at roll time.
 */
import { MODULE_ID } from "./constants.mjs";
import { blankRoll, keyOf, readRolls, rollAbility, rollsOf, targetOf, writeRolls, scalesFor } from "./ability-rolls.mjs";
import { choicesOf, ROLL_TYPES, VALUE_KINDS, VALUE_ROUNDING, VALUE_SCALES, PROGRESSION_CLASSES, PROGRESSION_LEVELS } from "../lib/vocab.mjs";
import { classItems } from "../classes/registry.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * The kinds a roll's TARGET may take, in the order they are offered.
 *
 * `conditional` is absent by design. It names its own scale, which a roll
 * already declares — offering both would put two scale pickers on one window
 * that disagree with each other. A roll that arrived carrying one still reads
 * correctly (resolveLevelValue honours it); opening it here presents it as the
 * table it is, keyed on the roll's scale.
 */
const TARGET_KINDS = ["flat", "perLevel", "breakpoints", "progression"];

/** The kinds whose value is a table of rungs rather than a single number. */
const isLadder = (kind) => kind === "breakpoints" || kind === "conditional";

/**
 * One throw of one ability, in a window of its own.
 *
 * Identified by KEY rather than by index, so a roll deleted elsewhere closes
 * this window instead of silently editing whichever throw slid into its place.
 */
export class AbilityRollEditor extends HandlebarsApplicationMixin(ApplicationV2) {
  /**
   * @param {object} options
   * @param {Item} options.item the ability whose roll this is
   * @param {string} options.rollKey the roll's handle (see `keyOf`)
   */
  constructor({ item, rollKey, ...options } = {}) {
    super({ id: `acks-abilities-roll-${item.id}-${foundry.utils.randomID(8)}`, ...options });
    this.item = item;
    this.rollKey = rollKey;
  }

  static DEFAULT_OPTIONS = {
    tag: "form",
    classes: ["acks-ui", "acks", "acks-extras", "acks-extras-scroll", "acks-abilities-roll-editor"],
    position: { width: 460, height: "auto" },
    window: { icon: "fa-solid fa-dice-d20", contentClasses: ["standard-form"], resizable: true },
    form: { handler: AbilityRollEditor.#onChange, submitOnChange: true, closeOnSubmit: false },
    actions: { addStep: AbilityRollEditor.#onAddStep, removeStep: AbilityRollEditor.#onRemoveStep },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/abilities/roll-editor.hbs`, scrollable: [""] },
  };

  /**
   * The target kind the window was RENDERED with, which is not the kind its
   * picker currently reads: a change event fires while the old layout is still
   * on screen. What is on screen is what the form can be read for.
   */
  #shownKind = null;

  /** @override */
  get title() {
    const roll = this.#find().roll;
    return `${this.item.name} — ${roll?.label || game.i18n.localize("ACKS-ABILITIES.roll.unnamed")}`;
  }

  /** This window's roll and where it sits, re-resolved from the store on demand. */
  #find() {
    const rolls = rollsOf(this.item);
    const index = rolls.findIndex((r, i) => keyOf(r, i) === this.rollKey);
    return { rolls, index, roll: index < 0 ? null : rolls[index] };
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const { roll } = this.#find();
    // The roll went away underneath us — another window deleted it, or the item
    // was rebuilt. Close rather than render an editor over nothing.
    if (!roll) {
      this.close();
      return context;
    }
    const stored = roll.target?.kind;
    // An unrecognised kind is either `conditional` — a table, shown as one — or
    // data written around the schema, which is read by what it actually holds.
    const kind = TARGET_KINDS.includes(stored)
      ? stored
      : stored === "conditional" || roll.target?.breakpoints?.length
        ? "breakpoints"
        : "flat";
    // ONE scale on screen. A `conditional` names its scale inside the target
    // and every other shape reads the roll's, so a converted table has to
    // arrive with its own scale already in the picker — otherwise the first
    // edit re-keys a rank ladder to class level without saying so.
    const scale = (stored === "conditional" ? roll.target?.on : roll.scale) || "level";
    context.roll = { ...roll, scale };
    context.kind = this.#shownKind = kind;
    context.isFlat = kind === "flat";
    context.isPerLevel = kind === "perLevel";
    context.isLadder = isLadder(kind);
    context.isProgression = kind === "progression";
    context.steps = context.isLadder ? (roll.target?.breakpoints ?? []) : [];
    context.scaleLabel = VALUE_SCALES[scale]?.label ?? scale;
    context.choices = {
      rollType: choicesOf(ROLL_TYPES),
      // Only the kinds this window authors. A roll carrying `conditional` is
      // shown as the table it is; it is not offered as something to choose.
      kind: Object.fromEntries(TARGET_KINDS.map((k) => [k, VALUE_KINDS[k].label])),
      scale: choicesOf(VALUE_SCALES),
      round: choicesOf(VALUE_ROUNDING),
      // The four chassis, then every class DOCUMENT the world holds — a
      // published table is named here instead of retyping its rungs. A class
      // whose key matches a chassis takes the class's own label.
      as: {
        ...choicesOf(PROGRESSION_CLASSES),
        ...Object.fromEntries(
          (() => {
            try {
              return classItems().map((c) => [c.system.key, c.name]);
            } catch {
              return [];
            }
          })(),
        ),
      },
      atLevel: choicesOf(PROGRESSION_LEVELS),
    };
    context.preview = this.#preview(context.roll);
    return context;
  }

  /**
   * What this throw reads as for the character holding it — the answer to "did
   * I enter that right?", which is the whole reason to type a table by hand. A
   * definition with no owner has no rung to stand on and says so instead.
   */
  #preview(roll) {
    const actor = this.item.actor;
    if (!actor) return game.i18n.localize("ACKS-ABILITIES.roll.previewUnowned");
    const scaleKey = roll.scale || "level";
    const at = scalesFor(actor, this.item)[scaleKey];
    const target = targetOf(roll, actor, this.item);
    const suffix = roll.rollType === "below" ? "-" : roll.rollType === "result" ? "" : "+";
    const where = { scale: VALUE_SCALES[scaleKey]?.label ?? scaleKey, at: at ?? "?", formula: roll.formula || "1d20" };
    return target == null
      ? game.i18n.format("ACKS-ABILITIES.roll.previewNoTarget", where)
      : game.i18n.format("ACKS-ABILITIES.roll.preview", { ...where, target: `${target}${suffix}` });
  }

  /* -------------------------------------------- */

  /** The window's fields as a roll object, with the table rebuilt as an array. */
  #fromForm() {
    const form = this.element;
    if (!form) return null;
    const data = foundry.utils.expandObject(new foundry.applications.ux.FormDataExtended(form).object);
    const target = data.target ?? {};
    // The rungs are authoritative only when the window was RENDERED as a table:
    // then their absence means the user removed them all, and an empty array is
    // the truth. Never read this off the picker's CURRENT value — a change event
    // fires with the new kind selected and the old layout still on screen, so
    // choosing the table would have read the flat layout's zero rungs and wiped
    // a table that was only being looked away from.
    if (isLadder(this.#shownKind)) target.breakpoints = Object.values(target.breakpoints ?? {});
    else delete target.breakpoints;
    return { ...data, target };
  }

  /**
   * Write the window's current state back to the roll and re-render.
   *
   * Everything routes through here — the change handler and both table actions —
   * so a click on "add a rung" cannot discard the field the user was editing
   * when they reached for it.
   */
  async #apply(mutate) {
    const { index } = this.#find();
    if (index < 0) return this.close();
    const rolls = readRolls(this.item);
    const form = this.#fromForm() ?? {};
    // The target merges FIELD BY FIELD, so the shape not currently on screen
    // keeps what was typed into it: switching to Flat to check a number and
    // back must not cost the table. `kind` is what says which one is in force.
    const next = { ...rolls[index], ...form, target: { ...rolls[index]?.target, ...form.target } };
    mutate?.(next);
    // The scale is stated once, on the roll. A `conditional` that came in
    // carrying its own must not keep it: two scales on one throw is exactly the
    // disagreement this window exists to remove.
    if (next.target.kind !== "conditional") next.target.on = "";
    rolls[index] = next;
    const written = await writeRolls(this.item, rolls);
    // Keys are stable once assigned, but re-read it rather than assume: a
    // collision elsewhere in the list can still have suffixed this one.
    this.rollKey = keyOf(written[index], index);
    this.render();
  }

  /** @override */
  static async #onChange(_event, _form, _formData) {
    await this.#apply();
  }

  /** A rung: "at this much of the scale, the target becomes this". */
  static async #onAddStep() {
    await this.#apply((roll) => {
      const steps = roll.target.breakpoints ?? [];
      const last = steps[steps.length - 1];
      // Each rung offered one step further along the scale than the last, which
      // is what a printed table does — typing a ladder should be typing values,
      // not re-typing the levels beside them.
      steps.push({ atLevel: last ? Number(last.atLevel ?? 0) + 1 : 1, value: last?.value ?? null });
      roll.target.breakpoints = steps;
    });
  }

  static async #onRemoveStep(_event, target) {
    const at = Number(target.dataset.index);
    await this.#apply((roll) => {
      const steps = roll.target.breakpoints ?? [];
      if (at >= 0 && at < steps.length) steps.splice(at, 1);
      roll.target.breakpoints = steps;
    });
  }
}

/* -------------------------------------------- */

/** Open (or focus) the editor for one of an item's rolls. */
function openEditor(item, rollKey) {
  const open = foundry.applications.instances?.values?.() ?? [];
  for (const app of open) {
    if (app instanceof AbilityRollEditor && app.item?.id === item.id && app.rollKey === rollKey) {
      app.bringToFront?.();
      return app;
    }
  }
  const editor = new AbilityRollEditor({ item, rollKey });
  editor.render(true);
  return editor;
}

/**
 * Append a throw and open it. Adding then editing is one gesture — an inventory
 * row that appears blank and unexplained is a row the reader has to guess at.
 */
async function addRoll() {
  const rolls = readRolls(this.item);
  rolls.push(blankRoll());
  const written = await writeRolls(this.item, rolls);
  const index = written.length - 1;
  openEditor(this.item, keyOf(written[index], index));
}

function editRoll(event, target) {
  openEditor(this.item, target.dataset.rollKey);
}

/** Delete a throw, on confirmation — it is the only copy of what was typed. */
async function deleteRoll(event, target) {
  const rolls = readRolls(this.item);
  const index = rolls.findIndex((r, i) => keyOf(r, i) === target.dataset.rollKey);
  if (index < 0) return;
  const name = rolls[index].label || game.i18n.localize("ACKS-ABILITIES.roll.unnamed");
  const ok = await foundry.applications.api.DialogV2.confirm({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: game.i18n.localize("ACKS-ABILITIES.roll.deleteTitle") },
    content: `<p>${game.i18n.format("ACKS-ABILITIES.roll.deleteConfirm", { name: foundry.utils.escapeHTML(name) })}</p>`,
  });
  if (!ok) return;
  rolls.splice(index, 1);
  await writeRolls(this.item, rolls);
}

function rollOne(event, target) {
  rollAbility(this.item, target.dataset.rollKey);
}

/** The Rolls tab's actions, mixed into the ability sheet. */
export const ROLL_ACTIONS = { rollOne, addRoll, editRoll, deleteRoll };
