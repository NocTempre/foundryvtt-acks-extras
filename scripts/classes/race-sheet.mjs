/* global game, foundry, fromUuid */
/**
 * The race constructor sheet — the editable face of `acks-extras.race`.
 *
 * One pane: identity, attribute minimums, the racial-value ladder (each rung
 * an XP cost, a level cap and the powers it grants), and always-on traits.
 * Rung power lists and the traits list ACCEPT ability drops, like the class
 * sheet's inventory — nothing is offered from a catalogue.
 */
import { LANG_PREFIX } from "./constants.mjs";
import RaceData from "./race-data.mjs";
import { findByRef } from "./registry.mjs";
import { ATTRIBUTES, ITEM_TYPE } from "../lib/vocab.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const MODULE_ID = "acks-extras";

/** The ref a world item is addressed by: its cookbook id, else its uuid. */
const refOf = (item) => item.flags?.["acks-importer"]?.cookbook?.id ?? `uuid:${item.uuid}`;

export default class RaceSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-classes-sheet"],
    position: { width: 640, height: 640 },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: true },
    actions: {
      rowAdd: RaceSheet.#onRowAdd,
      rowDelete: RaceSheet.#onRowDelete,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/classes/race-sheet.hbs`, scrollable: [".acks-extras-classes-body"] },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.item.system;
    context.item = this.item;
    context.system = sys;
    context.editable = this.isEditable;

    context.prose = {
      description: {
        html: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? "", {
          relativeTo: this.item,
          secrets: this.item.isOwner,
        }),
        source: sys.description ?? "",
      },
    };

    context.minimumAttributes = (sys.minimumAttributes ?? []).map((row, index) => ({
      index,
      min: row.min,
      attrOptions: Object.entries(ATTRIBUTES).map(([value, def]) => ({
        value,
        label: def.label ?? value,
        selected: value === row.attr,
      })),
    }));

    context.values = (sys.values ?? []).map((rung, index) => ({
      index,
      value: rung.value,
      label: rung.label,
      xpCost: rung.xpCost,
      maxLevel: rung.maxLevel,
      note: rung.note,
      powers: (rung.powers ?? []).map((ref, pi) => ({ index: pi, ref, name: findByRef(ref)?.name ?? null })),
    }));

    context.traits = (sys.traits ?? []).map((row, index) => ({
      index,
      name: row.name,
      ref: row.ref,
      refName: row.ref ? (findByRef(row.ref)?.name ?? null) : null,
    }));
    return context;
  }

  /** @override — reconstruct arrays before the model cleans the submit. */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    if (data.system) {
      data.system = RaceData.normalize(data.system);
      // Rung power lists are nested string arrays the generic walk misses.
      for (const rung of data.system.values ?? []) {
        if (rung?.powers && !Array.isArray(rung.powers) && typeof rung.powers === "object") {
          rung.powers = Object.values(rung.powers);
        }
      }
    }
    return data;
  }

  /* Fresh-row templates; the schema's initials fill the rest. */
  static #ROW_DEFAULTS = {
    values: (sys) => ({ value: (sys.values?.at(-1)?.value ?? -1) + 1 }),
    minimumAttributes: () => ({}),
    traits: () => ({}),
    "values.N.powers": () => "",
  };

  static async #onRowAdd(event, target) {
    const path = target.dataset.array;
    if (!path) return;
    const sys = this.item.system;
    const current = foundry.utils.deepClone(foundry.utils.getProperty(sys, path) ?? []);
    const make = RaceSheet.#ROW_DEFAULTS[path] ?? RaceSheet.#ROW_DEFAULTS[path.replace(/\.\d+\./g, ".N.")];
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

  /** @override — rung power lists and traits accept ability drops. */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: "[data-accept-drop]",
      callbacks: { drop: this.#onDrop.bind(this) },
    }).bind(this.element);
  }

  async #onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const dropped = await fromUuid(data.uuid);
    if (dropped?.type !== ITEM_TYPE.ability) return;
    const ref = refOf(dropped);
    const zone = event.target.closest("[data-accept-drop]");
    if (zone?.dataset.rung != null) {
      const index = Number(zone.dataset.rung);
      const values = foundry.utils.deepClone(this.item.system.values ?? []);
      if (values[index] && !(values[index].powers ?? []).includes(ref)) {
        values[index].powers = [...(values[index].powers ?? []), ref];
        await this.item.update({ "system.values": values });
      }
    } else if (zone?.dataset.list === "traits") {
      const traits = foundry.utils.deepClone(this.item.system.traits ?? []);
      traits.push({ name: dropped.name, ref, html: "" });
      await this.item.update({ "system.traits": traits });
    }
  }
}
