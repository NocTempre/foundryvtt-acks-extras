/* global game, foundry, fromUuid */
/**
 * The class CONSTRUCTOR sheet — the editable face of `acks-extras.class`.
 *
 * Composition-first: the overview picks chassis from the published set, the
 * awards tab configures fixed grants and ChoiceSpec offers, and the inventory
 * tab assembles the class's ability pool from what the world already carries
 * (imported or hand-made) — with plain inputs underneath as the fallback for
 * anything a picker cannot say. Imported documents open in the same sheet, so
 * review-and-tweak and from-scratch homebrew are one workflow.
 *
 * Tabs are sheet-local (a `data-action="tab"` toggle over sections in one
 * form): every field of every tab stays in the DOM, so submitOnChange always
 * carries the whole system object and array round-trips stay whole-document.
 */
import { LANG_PREFIX, CHASSIS_KEYS, CASTING_KINDS } from "./constants.mjs";
import { AWARD_KINDS } from "./class-data.mjs";
import ClassData from "./class-data.mjs";
import { findByRef } from "./registry.mjs";
import { CHOICE_SOURCES, CHOICE_FILTERS } from "../lib/choice-spec.mjs";
import { ATTRIBUTES } from "../lib/vocab.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const MODULE_ID = "acks-extras";
const TABS = ["overview", "progression", "awards", "inventory"];

/** Options list from a vocab enum, with the current value marked selected. */
const optionsOf = (enumObj, current, { blankLabel } = {}) => {
  const out = Object.entries(enumObj).map(([value, def]) => ({
    value,
    label: def.label,
    selected: value === current,
  }));
  if (blankLabel != null) out.unshift({ value: "", label: blankLabel, selected: !current });
  return out;
};

/** The ref a world item is addressed by: its cookbook id, else its uuid. */
const refOf = (item) => item.flags?.["acks-importer"]?.cookbook?.id ?? `uuid:${item.uuid}`;

export default class ClassSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-classes-sheet"],
    position: { width: 680, height: 720 },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: true },
    actions: {
      tab: ClassSheet.#onTab,
      rowAdd: ClassSheet.#onRowAdd,
      rowDelete: ClassSheet.#onRowDelete,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/classes/class-sheet.hbs`, scrollable: [".acks-extras-classes-body"] },
  };

  /** The active sheet-local tab. */
  #tab = "overview";

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.item.system;
    context.item = this.item;
    context.system = sys;
    context.editable = this.isEditable;
    context.tabs = TABS.map((id) => ({
      id,
      active: id === this.#tab,
      label: game.i18n.localize(`${LANG_PREFIX}.sheet.tab.${id}`),
    }));
    context.show = Object.fromEntries(TABS.map((id) => [id, id === this.#tab]));
    context.isStub = sys.isStub;

    // --- overview ---
    const chassisBlank = game.i18n.localize(`${LANG_PREFIX}.sheet.ownTables`);
    context.saveChassisOptions = optionsOf(
      Object.fromEntries(CHASSIS_KEYS.map((k) => [k, { label: k }])),
      sys.saveChassis,
      { blankLabel: chassisBlank },
    );
    context.attackChassisOptions = optionsOf(
      Object.fromEntries(CHASSIS_KEYS.map((k) => [k, { label: k }])),
      sys.attackChassis,
      { blankLabel: chassisBlank },
    );
    context.keyAttributes = Object.entries(ATTRIBUTES).map(([value, def]) => ({
      value,
      label: def.label ?? value,
      checked: sys.keyAttributes?.has?.(value) ?? false,
    }));
    context.requirements = (sys.requirements ?? []).map((row, index) => ({
      index,
      min: row.min,
      attrOptions: optionsOf(ATTRIBUTES, row.attr, { blankLabel: "—" }),
    }));

    // --- progression ---
    context.levels = (sys.levels ?? []).map((row, index) => ({ index, ...row }));
    context.saves = (sys.saves ?? []).map((row, index) => ({ index, ...row }));
    context.attack = (sys.attack ?? []).map((row, index) => ({ index, ...row }));
    context.ladders = (sys.ladders ?? []).map((ladder, index) => ({
      index,
      key: ladder.key,
      label: ladder.label,
      values: (ladder.values ?? []).map((rung, rungIndex) => ({ index: rungIndex, ...rung })),
    }));

    // --- awards ---
    context.awards = (sys.awards ?? []).map((award, index) => ({
      index,
      atLevel: award.atLevel,
      ref: award.ref,
      name: award.name,
      note: award.note,
      isChoice: award.kind === "choice",
      kindOptions: optionsOf(AWARD_KINDS, award.kind),
      refName: award.ref ? (findByRef(award.ref)?.name ?? null) : null,
      choice: award.choice,
      fromOptions: optionsOf(CHOICE_SOURCES, award.choice?.from),
      filterOptions: optionsOf(CHOICE_FILTERS, award.choice?.filter),
    }));

    // --- inventory ---
    const resolveList = (refs) =>
      (refs ?? []).map((ref, index) => ({ index, ref, name: findByRef(ref)?.name ?? null }));
    context.inventory = {
      classProfs: resolveList(sys.inventory?.classProfs),
      powers: resolveList(sys.inventory?.powers),
      skills: (sys.inventory?.skills ?? []).map((row, index) => ({
        index,
        ref: row.ref,
        ladderKey: row.ladderKey,
        name: findByRef(row.ref)?.name ?? null,
      })),
    };
    context.unresolvedProfs = sys.unresolvedProfs ?? [];

    context.castingSummary = (sys.casting ?? []).map((t) => ({
      label: t.label || t.key,
      kind: CASTING_KINDS[t.kind]?.label ?? t.kind,
      rows: (t.slots ?? []).length + (t.pool ?? []).length,
    }));
    context.templateCount = (sys.templates ?? []).length;
    return context;
  }

  /** @override — reconstruct arrays before the model cleans the submit. */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    if (data.system) data.system = ClassData.normalize(data.system);
    return data;
  }

  static #onTab(event, target) {
    this.#tab = target.dataset.tab ?? "overview";
    this.render();
  }

  /* Row templates a fresh array entry starts from; the schema's own initials
   * fill everything not named here. String lists push "" (a blank ref row). */
  static #ROW_DEFAULTS = {
    levels: (sys) => ({ level: (sys.levels?.at(-1)?.level ?? 0) + 1 }),
    saves: (sys) => ({ minLevel: (sys.saves?.at(-1)?.maxLevel ?? 0) + 1 }),
    attack: (sys) => ({ minLevel: (sys.attack?.at(-1)?.maxLevel ?? 0) + 1 }),
    awards: (sys) => ({ atLevel: sys.awards?.at(-1)?.atLevel ?? 1 }),
    requirements: () => ({}),
    ladders: () => ({}),
    "inventory.classProfs": () => "",
    "inventory.powers": () => "",
    "inventory.skills": () => ({}),
  };

  static async #onRowAdd(event, target) {
    const path = target.dataset.array;
    if (!path) return;
    const sys = this.item.system;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(sys, path) ?? []);
    const make = ClassSheet.#ROW_DEFAULTS[path];
    current.push(make ? make(sys) : {});
    await this.item.update({ [`system.${path}`]: current });
  }

  static async #onRowDelete(event, target) {
    const path = target.dataset.array;
    const index = Number(target.dataset.index);
    if (!path || !Number.isInteger(index)) return;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item.system, path) ?? []);
    current.splice(index, 1);
    await this.item.update({ [`system.${path}`]: current });
  }

  /** @override — the inventory ACCEPTS ability items; nothing is offered. */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: "[data-accept-drop]",
      callbacks: { drop: this.#onDrop.bind(this) },
    }).bind(this.element);
  }

  /** A dropped ability item lands in the list (or award row) under the cursor. */
  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const dropped = await fromUuid(data.uuid);
    if (dropped?.type !== "ability") return;
    const ref = refOf(dropped);
    const zone = event.target.closest("[data-accept-drop]");
    const list = zone?.dataset.list;
    if (list === "classProfs" || list === "powers") {
      const path = `inventory.${list}`;
      const current = foundry.utils.deepClone(foundry.utils.getProperty(this.item.system, path) ?? []);
      if (!current.includes(ref)) {
        current.push(ref);
        await this.item.update({ [`system.${path}`]: current });
      }
    } else if (list === "skills") {
      const current = foundry.utils.deepClone(this.item.system.inventory?.skills ?? []);
      current.push({ ref, ladderKey: "" });
      await this.item.update({ "system.inventory.skills": current });
    } else if (zone?.dataset.award != null) {
      const index = Number(zone.dataset.award);
      const awards = foundry.utils.deepClone(this.item.system.awards ?? []);
      if (awards[index]) {
        awards[index].ref = ref;
        awards[index].name = dropped.name;
        await this.item.update({ "system.awards": awards });
      }
    }
  }
}
