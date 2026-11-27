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
import { MODULE_ID, FLAG_SPELL, LANG_PREFIX } from "./constants.mjs";
import SpellExtras from "./spell-extras.mjs";
import { effectRowView } from "./describe.mjs";
import { displayRange, displayDuration, coreFieldsFrom, retiredWith } from "./spell-logic.mjs";
import { effectRowActions } from "../lib/apps/effect-row-editor.mjs";
import { RungDrafts, isInvocationLadder, withKindChoice } from "../lib/rung-ladder.mjs";
import { RUNG_ACTIONS, actionsContext, kindAllowed, kindContext, ladderContext, wireRungs } from "../lib/rung-view.mjs";
import { cookbookId, byCookbookId, cookbookRow } from "../lib/library.mjs";
import { creatureOpens, packIdOfUuid } from "../lib/summons-logic.mjs";
import { creatureByStamp, resolveCreature, seatNameOf } from "../lib/summon-list.mjs";
import { classItems } from "../classes/registry.mjs";
import * as V from "../lib/vocab.mjs";
import { vocabChoices, vocabLabel } from "../lib/magic-vocab.mjs";
import { feetPerUnit } from "../lib/distance-units.mjs";
import { areaExtent } from "./cast-area.mjs";

const T = `modules/${MODULE_ID}/templates/magic`;
/** The system's Active Effects partial, folded into the Mechanics tab. */
const CORE_EFFECTS_PARTIAL = "systems/acks/templates/items/v2/common/item-active-effects.hbs";
/** The flat / per-level value control the Overview tab repeats. */
export const LEVEL_VALUE_PARTIAL = `${T}/level-value.hbs`;

/** The lib partials the level-value partial draws: the kind switch, the rungs and their Save / Cancel bar. */
export const RUNG_PARTIALS = ["figure-kind", "rung-ladder", "rung-actions"].map((name) => `modules/${MODULE_ID}/templates/lib/${name}.hbs`);
/** The fields of one duration, used for the spell's own and for its reversed form's. */
export const DURATION_PARTIAL = `${T}/duration-fields.hbs`;
/** The flag's dotted path in an update. */
export const FLAG_PATH = `flags.${MODULE_ID}.${FLAG_SPELL}`;

const loc = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.${key}`, data);

/**
 * The effect-row store over one spell item — what the shared editor reads
 * and writes. Rows are written through the whole flag's normalisation, so a
 * row the editor hands back is cleaned exactly as a sheet submit would clean
 * it. A write that names the row a delete took out (`removed`) retires its key
 * in the same update when it is a register's (`retiredWith`), so a repair does
 * not write the row back. `editable()` answers whether this user may write
 * the spell: its pack is not locked and the user owns it.
 */
export function spellEffectStore(item) {
  return {
    key: `${item.uuid}:${FLAG_SPELL}.effects`,
    label: item.name,
    domain: "spell",
    editable: () => !item.compendium?.locked && item.isOwner === true,
    // The page the spell is read from: a blank located figure's tooltip names it.
    cite: () => SpellExtras.fromItem(item).toObject().cite,
    read: () => SpellExtras.fromItem(item).toObject().effects,
    write: async (rows, { removed } = {}) => {
      const data = SpellExtras.fromItem(item).toObject();
      data.effects = rows;
      data.retired = retiredWith(data.retired, removed);
      const clean = SpellExtras.normalize(data);
      await item.update({ [`${FLAG_PATH}.effects`]: clean.effects, [`${FLAG_PATH}.retired`]: clean.retired });
      return clean.effects;
    },
  };
}

/**
 * The Overview's spell-wide figures that are level values, by their path inside
 * the spell flag. Each takes the kind switch's "By invocation level", and the
 * ladder under it is edited inline, drafted until its own Save.
 */
export const LEVEL_VALUE_PATHS = Object.freeze([
  "target.count",
  "target.hdPool",
  "target.area.size",
  "target.area.width",
  "save.modifier",
  "target.hdCap",
  "target.hdBelow",
  "save.exemptBelowHd",
]);

/**
 * A level value as the template's control context. `path` is its place in the
 * flag and its draft's key, `cite` the page the spell is read from, and
 * `drafts` the sheet's rungs: a figure on the invocation scale shows its
 * ladder, drafted inline, with its own Save and Cancel under it. `editable` is
 * the sheet's own answer, which the kind buttons read for the invocation choice.
 */
function levelValue(path, value, label, { cite = "", drafts, idBase, editable }) {
  const v = value ?? {};
  const kind = v.kind || "flat";
  const name = `${FLAG_PATH}.${path}`;
  const isInvocation = isInvocationLadder(v);
  const scope = { group: path, keys: [path], idBase };
  return {
    name,
    path,
    label,
    value: v,
    isInvocation,
    kindGroup: kindContext(name, label, v, { invocation: true, editable }),
    ladder: isInvocation ? ladderContext(drafts, path, { ...scope, cite }) : null,
    ladderActions: isInvocation ? actionsContext(drafts, { ...scope, saveLabel: "saveRungs" }) : null,
    isFlat: kind === "flat",
    isPerLevel: kind === "perLevel",
    rounds: V.choicesOf(V.VALUE_ROUNDING),
  };
}

/**
 * The store over the spell's level-value figures: reads one off the spell's
 * flag by its path and writes it back through the flag's normalisation as a
 * sheet submit would, letting core's strings follow a shape that changed.
 * @param {Item} item the spell
 */
export function spellFigureStore(item) {
  return {
    cite: () => SpellExtras.fromItem(item).toObject().cite,
    read: (path) => foundry.utils.getProperty(SpellExtras.fromItem(item).toObject(), path),
    write: async (path, levelValue) => {
      const stored = SpellExtras.fromItem(item).toObject();
      const data = foundry.utils.deepClone(stored);
      foundry.utils.setProperty(data, path, levelValue);
      const clean = SpellExtras.normalize(data);
      const update = { [`${FLAG_PATH}.${path}`]: foundry.utils.getProperty(clean, path) };
      const before = coreFieldsFrom(SpellExtras.normalize(stored));
      for (const [key, value] of Object.entries(coreFieldsFrom(clean))) {
        const current = item.system?.[key];
        if (before[key] !== value || current == null || current === "") update[`system.${key}`] = value;
      }
      await item.update(update);
      return update[`${FLAG_PATH}.${path}`];
    },
  };
}

/**
 * One duration as the duration partial's context: the flag path its inputs
 * submit to, the stored duration, the controls its shape reads (the rest stay
 * off the sheet rather than sitting inert beside a shape that never consults
 * them) and the line it displays as.
 */
export function durationView(key, duration) {
  const d = duration ?? {};
  const shape = d.shape ?? "";
  return {
    name: `${FLAG_PATH}.${key}`,
    d,
    text: displayDuration(d),
    show: {
      time: ["fixed", "perLevel", "basePlusPerLevel", "concentrationMax"].includes(shape),
      plus: ["basePlusPerLevel", "concentrationPlus"].includes(shape),
      dice: shape === "dice",
      concentration: shape.startsWith("concentration"),
      maxPerLevel: shape === "concentrationMax",
    },
  };
}

/** A level value's figure when it is a flat one; a figure that varies by level has none to show. */
const flatFigure = (value) => ((value?.kind || "flat") === "flat" ? (value?.flat ?? null) : null);

/**
 * The tooltip of a gate figure the Overview edits (the Hit Dice cap, the Hit Dice
 * below which no save is made): the figure held, when there is one, then the
 * page reference. A blank figure carries the page reference alone.
 */
function figureTip(value, cite) {
  const parts = [];
  const flat = flatFigure(value);
  if (flat !== null) parts.push(loc("overview.figureTip.value", { value: String(flat) }));
  else if (value?.kind && value.kind !== "flat") parts.push(V.VALUE_KINDS[value.kind]?.label ?? value.kind);
  if (cite) parts.push(loc("overview.figureTip.cite", { cite }));
  return parts.join(" · ");
}

/** An effect row's editor label: the editor's own field name for it, else the field's key. */
function fieldLabel(name) {
  const key = `ACKS-LIB.effectEditor.field.${name}`;
  return game.i18n.has?.(key) ? game.i18n.localize(key) : name;
}

/**
 * The Overview's normalized area extent: the text the field shows and the
 * tooltip that names its parts, each part read off the spell's own fields, and
 * the page reference alone where nothing could be normalized.
 */
function areaExtentView(area, cite) {
  const unit = area?.unit || "feet";
  const size = flatFigure(area?.size);
  const width = flatFigure(area?.width);
  const extent = areaExtent({ measure: area?.measure, size, width, height: area?.height, unit });
  const figure = (value) => (value === null ? "" : String(Math.round(value * 100) / 100));
  const shown = [
    ["radius", extent.radius],
    ["diameter", extent.diameter],
    ["length", extent.length],
    ["width", extent.width],
    ["height", extent.height],
  ]
    .filter(([, value]) => value !== null)
    .map(([key, value]) => loc(`overview.areaExtent.${key}`, { value: figure(value) }));
  const parts = [];
  if (shown.length && extent.measure) {
    const unitLabel = vocabLabel("distanceUnit", unit);
    parts.push(loc("overview.areaTip.measure", { measure: vocabLabel("areaMeasure", extent.measure) }));
    if (size !== null) parts.push(loc("overview.areaTip.size", { size: figure(size), unit: unitLabel }));
    if (extent.measure === "length" && width !== null) parts.push(loc("overview.areaTip.width", { width: figure(width), unit: unitLabel }));
    parts.push(loc("overview.areaTip.factor", { unit: unitLabel, factor: figure(feetPerUnit(unit)) }));
  }
  if (cite) parts.push(loc("overview.areaTip.cite", { cite }));
  return { text: shown.join(" · "), tip: parts.join(" · ") };
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
  return ref.cookbookId ? byCookbookId("Item", ref.cookbookId) : null;
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
 * The ACKS Spell sheet class, subclassing `Base`; built at ready, once the
 * system's sheet is registered.
 * @param {typeof foundry.applications.api.ApplicationV2} Base the system's spell sheet class
 */
export function createSpellSheet(Base) {
  const P = Base.PARTS ?? {};
  // THREE TABS: overview (the stat line as structure), description (core's
  // own part — prose, and its string fields), mechanics (the effect rows and
  // Foundry's Active Effects). Core's `effects` part is folded into
  // mechanics rather than kept beside it.
  const parts = { header: P.header, tabs: P.tabs };
  parts.overview = { template: `${T}/tab-overview.hbs`, templates: [LEVEL_VALUE_PARTIAL, DURATION_PARTIAL, ...RUNG_PARTIALS], scrollable: [""] };
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
        ...RUNG_ACTIONS,
        figureKind: AcksSpellSheet.#onFigureKind,
      },
    };
    static PARTS = parts;
    static TABS = { primary: { tabs: tabList, initial: tabList[0].id } };

    tabGroups = { primary: tabList[0].id };

    /** The rungs of the Overview's ladders as drafts, keyed by their path in the flag; they outlive every redraw and the sheet's own submit, and closing the sheet drops them. */
    rungs = new RungDrafts({ read: (path) => spellFigureStore(this.item).read(path), editable: () => this.isEditable === true });

    /** The page the spell is read from, for a rung's tooltip. */
    rungCite() {
      return SpellExtras.fromItem(this.item).toObject().cite ?? "";
    }

    /** Redraw the Overview from the drafts. */
    rungRedraw() {
      this.render({ parts: ["overview"] });
    }

    /** Write each changed ladder through the flag's normalisation, one write for each figure. */
    async rungWrite(values) {
      const store = spellFigureStore(this.item);
      for (const [path, levelValue] of Object.entries(values)) await store.write(path, levelValue);
    }

    /** @override */
    async _onRender(context, options) {
      await super._onRender(context, options);
      wireRungs(this);
    }

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
        areaMeasure: vocabChoices("areaMeasure"),
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
      const tm = data.target?.model ?? "";
      context.show = {
        distance: ["touchOrDistance", "distance", "distancePerLevel"].includes(rs),
        castingTimed: data.castingTime?.shape === "timed",
        count: ["creature", "recipient", "object"].includes(tm),
        hdPool: tm === "hdPool",
        area: tm === "area",
        areaWidth: data.target?.area?.measure === "length",
      };
      context.rangeText = displayRange(data.range);
      context.durations = { main: durationView("duration", data.duration), reversed: durationView("reversedDuration", data.reversedDuration) };
      const lv = { cite: data.cite ?? "", drafts: this.rungs, idBase: this.id, editable: this.isEditable === true };
      context.levelValues = {
        count: levelValue("target.count", data.target?.count, loc("overview.count"), lv),
        hdPool: levelValue("target.hdPool", data.target?.hdPool, loc("overview.hdPool"), lv),
        areaSize: levelValue("target.area.size", data.target?.area?.size, loc("overview.areaSize"), lv),
        areaWidth: levelValue("target.area.width", data.target?.area?.width, loc("overview.areaWidth"), lv),
        saveModifier: levelValue("save.modifier", data.save?.modifier, loc("overview.saveModifier"), lv),
        hdCap: levelValue("target.hdCap", data.target?.hdCap, loc("overview.hdCap"), lv),
        hdBelow: levelValue("target.hdBelow", data.target?.hdBelow, loc("overview.hdBelow"), lv),
        exemptBelowHd: levelValue("save.exemptBelowHd", data.save?.exemptBelowHd, loc("overview.exemptBelowHd"), lv),
      };
      context.figureTips = {
        hdCap: figureTip(data.target?.hdCap, data.cite),
        hdBelow: figureTip(data.target?.hdBelow, data.cite),
        exemptBelowHd: figureTip(data.save?.exemptBelowHd, data.cite),
      };
      context.areaExtent = areaExtentView(data.target?.area, data.cite);
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
      // A summon row names its creature as this seat reads it: the name where the seat can open the creature, the neutral label where it cannot.
      // The creature is read off the Actor index, and this sheet redraws once when an index read it started lands.
      const packOf = (uuid) => game.packs?.get?.(packIdOfUuid(uuid)) ?? null;
      const opens = (creature) => creatureOpens(creature, game.user, { packOf });
      const lookups = { fromUuidSync: (uuid) => fromUuidSync(uuid), byCookbookId: creatureByStamp((type, id, prefer) => cookbookRow(type, id, { redraw: this, prefer }), (id) => game.actors?.get(id) ?? null, opens) };
      const seat = { resolve: (ref) => resolveCreature(ref, lookups), user: game.user, packOf, neutral: game.i18n.localize("ACKS-LIB.summons.neutral") };
      const nameOf = (ref) => seatNameOf(ref, seat);
      context.effectRows = (data.effects ?? []).map((e, i) => effectRowView(e, i, { nameOf, cite: data.cite ?? "", fieldLabel, say: loc }));
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
      // The kind switch's invocation choice is no stored kind: it becomes the ladder on that scale.
      for (const path of LEVEL_VALUE_PATHS) {
        const fragment = foundry.utils.getProperty(raw, path);
        if (fragment && typeof fragment === "object") foundry.utils.setProperty(raw, path, withKindChoice(foundry.utils.getProperty(stored, path), fragment));
      }
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

    /**
     * A kind button of a figure: sets the figure's hidden kind input and submits
     * the sheet, as the select it replaces did on change, and drops the figure's
     * drafted rungs. A sheet its user cannot edit refuses the switch where it
     * would move a figure on or off the invocation scale.
     */
    static async #onFigureKind(event, target) {
      const box = target.closest("[data-figure]");
      const path = box?.dataset.figure;
      const input = box?.querySelector("input[data-kind-input]");
      if (!input || !LEVEL_VALUE_PATHS.includes(path) || !target.dataset.kind) return;
      if (!kindAllowed(spellFigureStore(this.item).read(path), target.dataset.kind, this.isEditable === true)) return;
      this.rungs.discard([path]);
      input.value = target.dataset.kind;
      await this.submit();
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
