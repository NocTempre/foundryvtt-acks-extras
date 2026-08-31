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
import { blankRoll, keyOf, labelOf, measures, readRolls, rollAbility, rollsOf, scoreApplies, scoreTerm, scoreText, throwOutcome, writeRolls, scalesFor } from "./ability-rolls.mjs";
import {
  ATTRIBUTES,
  choicesOf,
  THROW_TYPES,
  VALUE_KINDS,
  VALUE_ROUNDING,
  VALUE_SCALES,
  PROGRESSION_CLASSES,
  RUNG_OUTCOMES,
} from "../lib/vocab.mjs";
import { classItems, laddersOf } from "../classes/registry.mjs";

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
    return `${this.item.name} — ${labelOf(roll)}`;
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
    // A MEASURE has no target, so the whole second fieldset is withheld —
    // including `#shownKind`, which must stay null while nothing is on screen
    // for it to describe. A stale "breakpoints" there would let #fromForm read
    // the absent rung inputs as an emptied table and wipe a ladder the reader
    // only switched away from.
    const measure = measures(roll);
    if (measure) {
      context.roll = { ...roll };
      context.kind = this.#shownKind = null;
      context.isMeasure = true;
      context.choices = { rollType: choicesOf(THROW_TYPES), score: choicesOf(ATTRIBUTES) };
      context.hasScore = !!roll.score?.key;
      context.preview = this.#preview(context.roll);
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
    // The multiplier only exists once a score is named, so the window has to
    // know which state it rendered in — the same reason `#shownKind` exists.
    context.hasScore = !!roll.score?.key;
    context.choices = {
      rollType: choicesOf(THROW_TYPES),
      score: choicesOf(ATTRIBUTES),
      // Only the kinds this window authors. A roll carrying `conditional` is
      // shown as the table it is; it is not offered as something to choose.
      kind: Object.fromEntries(TARGET_KINDS.map((k) => [k, VALUE_KINDS[k].label])),
      scale: choicesOf(VALUE_SCALES),
      round: choicesOf(VALUE_ROUNDING),
      outcome: choicesOf(RUNG_OUTCOMES),
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
      // The ladders the NAMED class publishes, so a throw can borrow a thief's
      // Climb Walls rather than only a chassis attack row. Blank means the
      // attack bands, which is what a progression meant before ladders were
      // reachable and what every throw already stored keeps meaning.
      table: Object.fromEntries(
        (() => {
          try {
            return laddersOf(roll.target?.as).map((k) => [k, k]);
          } catch {
            return [];
          }
        })(),
      ),
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
    // A measure reads the same for everyone — there is no target to resolve
    // against a character — so it previews on the shared definition too, where
    // every other shape can only say it has no one to read against.
    if (measures(roll)) {
      // The score is shown INSIDE the dice, which is where the roller puts it
      // (`measuredFormula`). Naming it as a separate inclusion beside "nothing
      // is scored against it" reads as a contradiction of the sentence it is
      // in; the reader wants to see what will actually be rolled.
      const bonus = (actor ? scoreTerm(roll, actor)?.bonus : 0) || 0;
      const dice = roll.formula || "1d20";
      return game.i18n.format("ACKS-ABILITIES.roll.previewMeasure", {
        formula: bonus ? `${dice} ${bonus >= 0 ? "+" : "-"} ${Math.abs(bonus)}` : dice,
      });
    }
    if (!actor) return game.i18n.localize("ACKS-ABILITIES.roll.previewUnowned");
    const scaleKey = roll.scale || "level";
    const at = scalesFor(actor, this.item)[scaleKey];
    const verdict = throwOutcome(roll, actor, this.item);
    const target = verdict.target;
    const suffix = roll.rollType === "below" ? "-" : roll.rollType === "result" ? "" : "+";
    const where = { scale: VALUE_SCALES[scaleKey]?.label ?? scaleKey, at: at ?? "?", formula: roll.formula || "1d20" };
    // A rung that is not a target is not a target that failed to resolve. The
    // preview exists to answer "did I type that right", and "no target at that
    // rung" over a correctly typed automatic rung answers it wrong.
    if (verdict.outcome !== "throw") {
      return game.i18n.format(
        verdict.outcome === "auto" ? "ACKS-ABILITIES.roll.previewAuto" : "ACKS-ABILITIES.roll.previewNone",
        { ...where, cell: verdict.text || "—" },
      );
    }
    if (target == null) return game.i18n.format("ACKS-ABILITIES.roll.previewNoTarget", where);
    const line = game.i18n.format("ACKS-ABILITIES.roll.preview", { ...where, target: `${target}${suffix}` });
    // The score is already inside that number, which is exactly why it is said
    // out loud: a target that moved with no visible cause reads as a typo. On a
    // throw the term does not reach, `scoreText` says that instead, so the line
    // never claims an inclusion the number does not show.
    const term = scoreTerm(roll, actor);
    if (!term) return line;
    return scoreApplies(roll)
      ? `${line} ${game.i18n.format("ACKS-ABILITIES.roll.previewScore", { term: scoreText(term) })}`
      : `${line} ${scoreText(term, roll)}`;
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
    // `score` merges field by field for the same reason `target` does: the
    // multiplier leaves the form when no score is named, and a shallow merge
    // would read its absence as a deletion.
    const next = {
      ...rolls[index],
      ...form,
      target: { ...rolls[index]?.target, ...form.target },
      score: { ...rolls[index]?.score, ...form.score },
    };
    mutate?.(next);
    // The scale is stated once, on the roll. A `conditional` that came in
    // carrying its own must not keep it: two scales on one throw is exactly the
    // disagreement this window exists to remove. Only when the target section
    // was actually RENDERED, though — the same rule the rungs follow. A measure
    // shows none of it, and re-keying an untouched ladder to class level on the
    // way past is not an edit the reader made.
    if (this.#shownKind && next.target.kind !== "conditional") next.target.on = "";
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
      steps.push({ atLevel: last ? Number(last.atLevel ?? 0) + 1 : 1, value: last?.value ?? null, outcome: "", text: "" });
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
  const name = labelOf(rolls[index]);
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

/**
 * Move a throw one place through the printed order.
 *
 * ORDER IS THE ARRAY, so a move is a splice — but `keyOf` falls back to
 * `roll<index>` for a throw that never got an explicit key, and other records
 * point AT those keys (an effect names the throw it belongs to; the sheet
 * remembers the last one rolled). Moving would silently re-point them. So the
 * pass stamps every unkeyed throw with the key it has RIGHT NOW before
 * anything moves: after that the key is a name, not a position, and reordering
 * cannot rename anything.
 */
async function moveRoll(item, rollKey, delta) {
  const rolls = readRolls(item);
  const index = rolls.findIndex((r, i) => keyOf(r, i) === rollKey);
  const to = index + delta;
  if (index < 0 || to < 0 || to >= rolls.length) return;
  for (let i = 0; i < rolls.length; i++) if (!rolls[i].key) rolls[i].key = keyOf(rolls[i], i);
  const [moved] = rolls.splice(index, 1);
  rolls.splice(to, 0, moved);
  await writeRolls(item, rolls);
}

const moveRollUp = function (event, target) {
  return moveRoll(this.item, target.dataset.rollKey, -1);
};
const moveRollDown = function (event, target) {
  return moveRoll(this.item, target.dataset.rollKey, 1);
};

/** The Rolls tab's actions, mixed into the ability sheet. */
export const ROLL_ACTIONS = { rollOne, addRoll, editRoll, deleteRoll, moveRollUp, moveRollDown };
