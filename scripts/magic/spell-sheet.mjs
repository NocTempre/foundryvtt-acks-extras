/* global foundry, game, fromUuid, fromUuidSync */
/**
 * The ACKS Spell sheet is built at ready as a SUBCLASS of the system's own
 * registered `spell` item sheet, so it inherits the header and the
 * description tab verbatim, and adds two tabs over the spell primitive
 * (`flags["acks-extras"].spell`): **Overview** — the structured stat line,
 * the lists the spell prints on, the reversal pair — and **Mechanics** — the
 * effect rows in the shared vocabulary, with the system's Active Effects
 * folded in below them, as the abilities sheet does.
 *
 * Core's own `lvl`, `class`, `range`, `duration` and `save` strings stay on
 * the description tab, editable, and FOLLOW the flag: a submit that changes a
 * shape rewrites the string it expresses, and a string that is empty is
 * filled from the flag. A string a Judge typed by hand stays until the flag
 * beneath it changes (`docs/magic/DECISIONS.md`, "Core's strings are derived").
 */
import { MODULE_ID, FLAG_SPELL, LANG_PREFIX, SPELL_TYPE } from "./constants.mjs";
import SpellExtras from "./spell-extras.mjs";
import { describeSpellEffect } from "./describe.mjs";
import { displayRange, displayDuration, coreFieldsFrom } from "./spell-logic.mjs";
import { effectRowActions } from "../lib/apps/effect-row-editor.mjs";
import { cookbookId, byCookbookId } from "../lib/library.mjs";
import { classItems } from "../classes/registry.mjs";
import * as V from "../lib/vocab.mjs";
import { vocabChoices, vocabLabel } from "../lib/magic-vocab.mjs";

const T = `modules/${MODULE_ID}/templates/magic`;
/** The system's Active Effects partial, folded into the Mechanics tab. */
const CORE_EFFECTS_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";
/** The flat / per-level value control the Overview tab repeats. */
export const LEVEL_VALUE_PARTIAL = `${T}/level-value.hbs`;
/** The flag's dotted path in an update. */
export const FLAG_PATH = `flags.${MODULE_ID}.${FLAG_SPELL}`;

const loc = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.${key}`, data);

/**
 * The effect-row store over one spell item — what the shared editor reads
 * and writes. Rows are written through the whole flag's normalisation, so a
 * row the editor hands back is cleaned exactly as a sheet submit would clean
 * it.
 */
export function spellEffectStore(item) {
  return {
    key: `${item.uuid}:${FLAG_SPELL}.effects`,
    label: item.name,
    domain: "spell",
    read: () => SpellExtras.fromItem(item).toObject().effects,
    write: async (rows) => {
      const data = SpellExtras.fromItem(item).toObject();
      data.effects = rows;
      const clean = SpellExtras.normalize(data);
      await item.update({ [`${FLAG_PATH}.effects`]: clean.effects });
      return clean.effects;
    },
  };
}

/** A level value as the template's control context. */
function levelValue(name, value, label) {
  const v = value ?? {};
  const kind = v.kind || "flat";
  return {
    name,
    label,
    value: v,
    isFlat: kind === "flat",
    isPerLevel: kind === "perLevel",
    kinds: V.choicesOf(V.VALUE_KINDS),
    rounds: V.choicesOf(V.VALUE_ROUNDING),
  };
}

/** The reversal partner's document, by uuid then by importer id; null when neither answers. */
function reverseDocument(ref) {
  if (!ref) return null;
  if (ref.uuid) {
    try {
      const doc = fromUuidSync(ref.uuid);
      if (doc) return doc;
    } catch {
      /* a uuid nothing answers falls through to the id */
    }
  }
  return ref.cookbookId ? byCookbookId(SPELL_TYPE, ref.cookbookId) : null;
}

/** The magic-type keys the world's classes cast under — the datalist behind a list's source. */
function knownTraditions() {
  const keys = new Set();
  try {
    for (const cls of classItems()) {
      for (const row of cls.system?.casting ?? []) if (row?.key) keys.add(row.key);
    }
  } catch {
    /* no class registry yet — the field stays free text */
  }
  return [...keys].sort();
}

/**
 * @param {typeof foundry.applications.api.ApplicationV2} Base the system's spell sheet class
 */
export function createSpellSheet(Base) {
  const P = Base.PARTS ?? {};
  // THREE TABS: overview (the stat line as structure), description (core's
  // own part — prose, and its string fields), mechanics (the effect rows and
  // Foundry's Active Effects). Core's `effects` part is folded into
  // mechanics rather than kept beside it.
  const parts = { header: P.header, tabs: P.tabs };
  parts.overview = { template: `${T}/tab-overview.hbs`, templates: [LEVEL_VALUE_PARTIAL], scrollable: [""] };
  if (P.description) parts.description = P.description;
  parts.mechanics = { template: `${T}/tab-mechanics.hbs`, templates: [CORE_EFFECTS_PARTIAL], scrollable: [""] };

  const tabList = [{ id: "overview", icon: "fa-solid fa-wand-sparkles", label: `${LANG_PREFIX}.tab.overview` }];
  if (P.description) tabList.push({ id: "description", icon: "fa-solid fa-scroll", label: "ACKS.category.description" });
  tabList.push({ id: "mechanics", icon: "fa-solid fa-gears", label: `${LANG_PREFIX}.tab.mechanics` });

  const ROW_ACTIONS = effectRowActions(spellEffectStore);

  return class AcksSpellSheet extends Base {
    static DEFAULT_OPTIONS = {
      classes: ["acks-ui", "acks", "acks2", "item-v2", "acks-extras", "acks-extras-scroll", "acks-magic-spell-sheet"],
      actions: {
        ...ROW_ACTIONS,
        listAdd: AcksSpellSheet.#onListAdd,
        listDelete: AcksSpellSheet.#onListDelete,
        openReverse: AcksSpellSheet.#onOpenReverse,
      },
    };
    static PARTS = parts;
    static TABS = { primary: { tabs: tabList, initial: tabList[0].id } };

    tabGroups = { primary: tabList[0].id };

    /** @override */
    async _prepareContext(options) {
      const context = await super._prepareContext(options);
      const data = SpellExtras.fromItem(this.item).toObject();
      context.x = FLAG_PATH;
      context.extras = data;
      context.none = game.i18n.localize("ACKS-LIB.effectEditor.none");
      context.choices = {
        type: vocabChoices("spellType"),
        rangeShape: vocabChoices("rangeShape"),
        distanceUnit: vocabChoices("distanceUnit"),
        durationShape: vocabChoices("durationShape"),
        timeUnit: vocabChoices("timeUnit"),
        concentrationKind: vocabChoices("concentrationKind"),
        castingTimeShape: vocabChoices("castingTimeShape"),
        targetModel: vocabChoices("targetModel"),
        areaShape: vocabChoices("areaShape"),
        saveCategory: vocabChoices("saveCategory"),
        saveEffect: vocabChoices("saveEffect"),
      };
      context.lists = (data.lists ?? []).map((row) => ({ ...row, classesCSV: (row.classes ?? []).join(", ") }));
      context.traditions = knownTraditions();
      context.schoolsCSV = (data.schools ?? []).join(", ");
      context.elementsCSV = (data.elements ?? []).join(", ");
      context.componentsCSV = (data.components ?? []).join(", ");
      // Which controls a shape reads: the rest stay off the sheet rather than
      // sitting inert beside a shape that never consults them.
      const rs = data.range?.shape ?? "";
      const ds = data.duration?.shape ?? "";
      const tm = data.target?.model ?? "";
      context.show = {
        distance: ["touchOrDistance", "distance", "distancePerLevel"].includes(rs),
        time: ["fixed", "perLevel", "basePlusPerLevel", "concentrationMax"].includes(ds),
        plus: ["basePlusPerLevel", "concentrationPlus"].includes(ds),
        dice: ds === "dice",
        concentration: ds.startsWith("concentration"),
        maxPerLevel: ds === "concentrationMax",
        castingTimed: data.castingTime?.shape === "timed",
        count: ["creature", "recipient", "object"].includes(tm),
        hdPool: tm === "hdPool",
        area: tm === "area",
      };
      context.rangeText = displayRange(data.range);
      context.durationText = displayDuration(data.duration);
      context.levelValues = {
        count: levelValue(`${FLAG_PATH}.target.count`, data.target?.count, loc("overview.count")),
        hdPool: levelValue(`${FLAG_PATH}.target.hdPool`, data.target?.hdPool, loc("overview.hdPool")),
        areaSize: levelValue(`${FLAG_PATH}.target.area.size`, data.target?.area?.size, loc("overview.areaSize")),
        saveModifier: levelValue(`${FLAG_PATH}.save.modifier`, data.save?.modifier, loc("overview.saveModifier")),
      };
      const ticked = new Set(data.target?.filters ?? []);
      context.filters = Object.keys(V.TARGET_FILTERS).map((key) => ({
        key,
        label: vocabLabel("targetFilter", key),
        checked: ticked.has(key),
      }));
      const reverse = reverseDocument(data.reverseOf);
      context.reverse = {
        name: reverse?.name ?? data.reverseOf?.name ?? "",
        resolved: !!reverse,
      };
      const id = cookbookId(this.item);
      context.provenance = { id, imported: !!id, cite: data.cite ?? "" };
      context.effectRows = (data.effects ?? []).map((e, i) => ({ index: i, ...describeSpellEffect(e) }));
      return context;
    }

    /** @override */
    async _preparePartContext(partId, context, options) {
      context = await super._preparePartContext(partId, context, options);
      if (partId === "overview") context.tab = context.tabs[partId];
      if (partId === "mechanics") {
        context.tab = context.tabs[partId];
        context.coreEffectsPartial = CORE_EFFECTS_PARTIAL;
        // The Active Effects list is the system's data through its own partial.
        if (typeof this._prepareEffectsContext === "function") {
          context = await this._prepareEffectsContext(context);
        }
      }
      return context;
    }

    /**
     * Merge the submitted flag over the stored one (a field no input renders
     * survives), run it through the schema, and let core's strings follow
     * the shapes that changed.
     * @override
     */
    _prepareSubmitData(event, form, formData, updateData) {
      const submitData = super._prepareSubmitData(event, form, formData, updateData);
      const raw = foundry.utils.getProperty(submitData, FLAG_PATH);
      if (!raw || typeof raw !== "object") return submitData;
      const stored = foundry.utils.deepClone(this.item.getFlag(MODULE_ID, FLAG_SPELL) ?? {});
      const merged = foundry.utils.mergeObject(stored, raw, { inplace: false, overwrite: true, insertKeys: true });
      let clean;
      try {
        clean = SpellExtras.normalize(merged);
      } catch (err) {
        console.error(`${MODULE_ID} | spell extras normalization failed; saving merged data as-is`, err);
        foundry.utils.setProperty(submitData, FLAG_PATH, merged);
        return submitData;
      }
      foundry.utils.setProperty(submitData, FLAG_PATH, clean);
      let before = {};
      try {
        before = coreFieldsFrom(SpellExtras.normalize(stored));
      } catch {
        before = {};
      }
      const after = coreFieldsFrom(clean);
      for (const [key, value] of Object.entries(after)) {
        // A string is empty when the document holds none, and when this very
        // submit clears it: the clear and the refill are one write.
        const current = foundry.utils.getProperty(submitData, `system.${key}`) ?? this.item.system?.[key];
        const empty = current == null || current === "";
        if (before[key] !== value || empty) foundry.utils.setProperty(submitData, `system.${key}`, value);
      }
      return submitData;
    }

    /** The stored lists, after what the form holds has been written. */
    async #lists() {
      await this.submit();
      return SpellExtras.fromItem(this.item).toObject().lists ?? [];
    }

    static async #onListAdd() {
      const rows = await this.#lists();
      // A schema-default row, so its shape is the model's and not a literal here.
      rows.push(SpellExtras.normalize({ lists: [{}] }).lists[0]);
      await this.item.update({ [`${FLAG_PATH}.lists`]: rows });
    }

    static async #onListDelete(event, target) {
      const index = Number(target.dataset.index);
      const rows = await this.#lists();
      if (!(index >= 0 && index < rows.length)) return;
      rows.splice(index, 1);
      await this.item.update({ [`${FLAG_PATH}.lists`]: rows });
    }

    static async #onOpenReverse() {
      const ref = SpellExtras.fromItem(this.item).toObject().reverseOf;
      let doc = reverseDocument(ref);
      if (!doc && ref?.uuid) doc = await fromUuid(ref.uuid).catch(() => null);
      if (!doc) {
        ui.notifications?.warn(loc("overview.reverseMissing"));
        return;
      }
      doc.sheet?.render(true);
    }
  };
}
