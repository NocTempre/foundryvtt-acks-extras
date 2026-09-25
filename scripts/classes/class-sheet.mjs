/* global game, foundry, fromUuid, fromUuidSync, ui */
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
 * Tabs are sheet-local (a `data-action="classTab"` toggle over sections in
 * one form): every field of every tab stays in the DOM, so submitOnChange
 * carries every field the sheet renders. An array row renders only some of
 * its fields and an array update replaces its rows whole, so
 * `_processFormData` fills the rest from the stored row.
 */
import { MODULE_ID, LANG_PREFIX, CHASSIS_KEYS, CASTING_KINDS, REPERTOIRE_KINDS } from "./constants.mjs";
import { pathGroups } from "./paths.mjs";
import { AWARD_KINDS } from "./class-data.mjs";
import ClassData from "./class-data.mjs";
import { classByKey, findByRef } from "./registry.mjs";
import { setClassTraining } from "./training.mjs";
import { classTrainingEffect, trainingOf } from "./training-logic.mjs";
import { armourOptionsFor, bindDropHighlight, confirmRowDelete, openRef, rejectDrop } from "./sheet-helpers.mjs";
import { refOf } from "./grants.mjs";
import { builderTables, raceItems, raceForClass, planFor, applyBuilder, issueLabel } from "./builder.mjs";
import { materializeTemplates, detachTemplatePackages } from "./template-packages.mjs";
import { CHOICE_SOURCES, CHOICE_FILTERS } from "../lib/choice-spec.mjs";
import { keepUnrenderedFields, rowListUpdate } from "../lib/sheet-rows.mjs";
import { ATTRIBUTES, ITEM_TYPE } from "../lib/vocab.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const TABS = ["overview", "builder", "progression", "awards", "casting", "paths", "templates", "inventory"];

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

export default class ClassSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-extras-classes-sheet"],
    position: { width: 680, height: 720 },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    window: { resizable: true },
    actions: {
      // NEVER "tab": ApplicationV2 reserves that action for its own tab
      // machinery, which throws without a data-group and swallows the click.
      classTab: ClassSheet.#onTab,
      rowAdd: ClassSheet.#onRowAdd,
      rowDelete: ClassSheet.#onRowDelete,
      builderDerive: ClassSheet.#onBuilderDerive,
      templatesBuild: ClassSheet.#onTemplatesBuild,
      templatesDetach: ClassSheet.#onTemplatesDetach,
      templateOpen: ClassSheet.#onTemplateOpen,
      templateUnbind: ClassSheet.#onTemplateUnbind,
      refOpen: ClassSheet.#onRefOpen,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/classes/class-sheet.hbs`, scrollable: [".acks-extras-classes-body"] },
  };

  /** The active sheet-local tab. */
  #tab = "overview";

  /** Training writes land in order: each edit rewrites the effect the last one left. */
  #trainingWrite = Promise.resolve();

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
    // Ladders are read through the class key; a class with ladders and no key
    // has tables nothing can reach.
    context.keyMissing = !sys.key && (sys.ladders ?? []).length > 0;
    // The keys `apply.mjs` reads a damage-bonus ladder by, offered wherever a
    // field must match a ladder key.
    context.ladderKeyHints = ["damageBonus", "meleeDamageBonus", "missileDamageBonus", "electedDamageBonus"];

    // Prose renders ENRICHED — an imported class holds its book text in the
    // field, and enrichment is what resolves the links and rolls written
    // alongside it — inside a toggled prose-mirror, the same view-then-edit
    // element the system's own sheets use. Never reach for the bare
    // TextEditor global.
    const enrich = (html) =>
      foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", {
        relativeTo: this.item,
        secrets: this.item.isOwner,
      });
    context.prose = {};
    for (const field of ["description", "codeOfBehavior"]) {
      context.prose[field] = {
        html: await enrich(sys[field]),
        source: sys[field] ?? "",
      };
    }

    // --- overview ---
    const chassisBlank = game.i18n.localize(`${LANG_PREFIX}.sheet.ownTables`);
    // A chassis is named by the class that publishes it, when that class is in
    // the world or the library; its key stands in until it is.
    const chassis = Object.fromEntries(CHASSIS_KEYS.map((k) => [k, { label: classByKey(k)?.name ?? k }]));
    context.saveChassisOptions = optionsOf(chassis, sys.saveChassis, { blankLabel: chassisBlank });
    context.attackChassisOptions = optionsOf(chassis, sys.attackChassis, { blankLabel: chassisBlank });
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

    // --- builder (advanced mode) ---
    const tables = builderTables();
    const b = sys.builder ?? {};
    context.builderState = b;
    context.builderHasTables = !!tables;
    const magicTypes = tables?.magicTypes ?? {};
    context.magicTypeKeys = Object.keys(magicTypes);
    context.builderMagic = (b.magic ?? []).map((m, index) => ({
      index,
      type: m.type,
      label: m.label,
      value: m.value,
      delayed: m.delayed,
      typeLabel: magicTypes[m.type]?.label ?? null,
    }));
    const boundRace = raceForClass(this.item);
    context.builderRaces = raceItems().map((race) => {
      const value = refOf(race);
      return { value, label: race.name, selected: race === boundRace };
    });
    context.raceUnresolved = !!sys.race && !boundRace;
    context.builderTradeoffs = (tables?.tradeoffs ?? []).map((row) => ({
      key: row.key,
      label: row.label ?? row.key,
      checked: (b.tradeoffs ?? []).includes(row.key),
    }));
    context.builderUnknownTradeoffs = (b.tradeoffs ?? []).filter(
      (key) => !(tables?.tradeoffs ?? []).some((row) => row.key === key),
    );
    context.builderPowers = (b.powers ?? []).map((p, index) => ({
      index,
      ...p,
      refName: p.ref ? (findByRef(p.ref)?.name ?? null) : null,
    }));
    context.builderSkills = (b.thievery?.skills ?? []).map((ref, index) => ({
      index,
      ref,
      name: findByRef(ref)?.name ?? null,
    }));
    if (b.enabled) {
      const plan = planFor(this.item);
      context.builderSummary = plan.summary;
      context.builderIssues = plan.issues.map(issueLabel);
    }

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

    // --- languages (RR §I.10): what the class speaks, and how many it may
    // still choose. The race's own list adds to this at grant time. ---
    context.languageRows = (sys.languages?.granted ?? []).map((ref, index) => ({ index, ref }));

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
      choiceRefs: (award.choice?.refs ?? []).map((ref, ri) => ({ index: ri, ref, name: findByRef(ref)?.name ?? null })),
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

    // --- casting ---
    context.casting = (sys.casting ?? []).map((t, index) => ({
      index,
      key: t.key,
      label: t.label,
      casterLevel: t.casterLevel,
      kindOptions: optionsOf(CASTING_KINDS, t.kind),
      repertoireOptions: optionsOf(REPERTOIRE_KINDS, t.repertoire, { blankLabel: "—" }),
      // The printed list the picker narrows to, by count: the references
      // themselves are written by the importer and read by the picker.
      spellListCount: (t.spellList ?? []).length,
      slots: (t.slots ?? []).map((row, rowIndex) => ({ index: rowIndex, ...row })),
      pool: (t.pool ?? []).map((row, rowIndex) => ({ index: rowIndex, ...row })),
    }));

    // --- paths: the groups of mutually exclusive options this class offers.
    // A `templates` group is shown with the rows it POINTS AT, so the sheet
    // says plainly that the eight starting templates are one of these groups
    // and not a separate mechanism.
    // The RAW rows are what the form edits (indices are the write paths); the
    // resolved ones are what a `templates` group has instead of options of its
    // own, and are shown read-only because the rows are edited on their own tab.
    const resolved = pathGroups(sys);
    context.pathsEdit = (sys.paths ?? []).map((g, index) => {
      const fromTemplates = g.source === "templates";
      return {
        index,
        key: g.key,
        label: g.label,
        note: g.note,
        source: g.source ?? "",
        fromTemplates,
        // A templates group borrows the rows; an authored one owns its options.
        borrowed: fromTemplates ? (resolved[index]?.options ?? []) : null,
        options: fromTemplates
          ? []
          : (g.options ?? []).map((o, oIndex) => ({
              oIndex,
              key: o.key,
              label: o.label,
              weapons: (o.training?.weapons ?? []).join(", "),
              styles: (o.training?.styles ?? []).join(", "),
              // Precomputed the way every other select on this sheet is, so the
              // template needs no comparison helper and no `../../` climbing.
              armourOptions: armourOptionsFor(o.training?.armour),
            })),
      };
    });

    // --- templates ---
    context.templatesEdit = (sys.templates ?? []).map((t, index) => {
      const bundleDoc = t.bundle ? fromUuidSync(t.bundle) : null;
      const leftovers = [
        ...(t.abilities ?? []).map((a) => a.name || a.ref),
        ...(t.items ?? []).map((it) => it.name || it.ref),
        ...(t.spells ?? []).map((s) => s.name || s.uuid),
      ].filter(Boolean);
      return {
        index,
        rollMin: t.rollMin,
        rollMax: t.rollMax,
        name: t.name,
        annotation: t.annotation,
        caste: t.caste,
        gp: t.gp,
        enc: t.enc,
        bundle: t.bundle,
        bundleName: bundleDoc?.name ?? null,
        bundleMissing: !!t.bundle && !bundleDoc,
        bundleContents: (bundleDoc?.system?.itemList ?? []).map((r) =>
          (r.quantity || 1) > 1 ? `${r.name} ×${r.quantity}` : r.name,
        ),
        // The printed entries always stay on the row; when a package is bound
        // they are the RECORD and the fallback, not what applies.
        leftoverNames: t.bundle ? leftovers.join(", ") : "",
        abilities: (t.abilities ?? []).map((a, ai) => ({
          index: ai,
          ...a,
          refName: a.ref ? (findByRef(a.ref)?.name ?? null) : null,
        })),
        items: (t.items ?? []).map((it, ii) => ({
          index: ii,
          ...it,
          // A `name:` reference is matched at build time and names nothing yet.
          refByName: it.ref?.startsWith("name:") ? it.ref.slice(5) : null,
          refName: it.ref && !it.ref.startsWith("name:") ? (findByRef(it.ref)?.name ?? null) : null,
        })),
        spells: (t.spells ?? []).map((s, si) => ({
          index: si,
          ...s,
          uuidName: s.uuid ? (fromUuidSync(s.uuid)?.name ?? null) : null,
        })),
      };
    });
    const tableDoc = sys.templateTable ? fromUuidSync(sys.templateTable) : null;
    context.templateTable = tableDoc ? { name: tableDoc.name, uuid: tableDoc.uuid } : null;

    // --- training: the class document's own effect, edited as three fields
    // named outside `system` so the form's submit leaves them to the effect.
    const training = trainingOf(classTrainingEffect(this.item)?.changes ?? []);
    context.training = {
      weapons: training.weapons.join(", "),
      armour: training.armour,
      styles: training.styles.join(", "),
      armourOptions: armourOptionsFor(training.armour),
    };
    return context;
  }

  /** @override — a row's fields the form does not render keep their stored values. */
  _processFormData(event, form, formData) {
    const data = keepUnrenderedFields(super._processFormData(event, form, formData), this.item._source);
    delete data.training;
    return data;
  }

  /** @override — an edit inside the training fieldset writes the class's effect, after the system update. */
  async _processSubmitData(event, form, submitData, options) {
    await super._processSubmitData(event, form, submitData, options);
    if (!event?.target?.closest?.("[data-class-training]")) return;
    const read = (name) => form.elements.namedItem(name)?.value ?? "";
    const training = { weapons: read("training.weapons"), armour: read("training.armour"), styles: read("training.styles") };
    this.#trainingWrite = this.#trainingWrite.then(() => setClassTraining(this.item, training)).catch((error) => console.error(error));
    await this.#trainingWrite;
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

  static async #onBuilderDerive() {
    await applyBuilder(this.item);
    this.render();
  }

  /** Materialize this class's template packages (bundles, contents, table). */
  static async #onTemplatesBuild() {
    const report = await materializeTemplates(this.item);
    ui.notifications?.info(
      game.i18n.format(`${LANG_PREFIX}.sheet.templates.package.buildDone`, {
        created: report.created.length,
        relinked: report.relinked.length,
        skipped: report.skippedEdited.length,
      }),
    );
    // A weapon nothing could identify is worth its own warning: the build
    // reports success, the item looks complete, and the only symptom is a
    // proficiency badge on a character sheet built from it weeks later.
    if (report.unidentified.length) {
      ui.notifications?.warn(
        game.i18n.format(`${LANG_PREFIX}.sheet.templates.package.unidentified`, {
          items: report.unidentified.join(", "),
        }),
      );
    }
    this.render();
  }

  /** Detach every package: the class applies from its printed entries again. */
  static async #onTemplatesDetach() {
    await detachTemplatePackages(this.item);
    ui.notifications?.info(game.i18n.localize(`${LANG_PREFIX}.sheet.templates.package.detachDone`));
    this.render();
  }

  /** Open a linked document (a template's bundle, or the 3d6 table). */
  static #onTemplateOpen(event, target) {
    fromUuidSync(target.dataset.uuid ?? "")?.sheet?.render(true);
  }

  /** Detach a row's bundle — the row's own arrays become the package again. */
  static async #onTemplateUnbind(event, target) {
    const index = Number(target.dataset.index);
    if (!Number.isInteger(index)) return;
    const templates = foundry.utils.deepClone(this.item.system.toObject().templates ?? []);
    if (!templates[index]) return;
    templates[index].bundle = "";
    await this.item.update({ "system.templates": templates });
  }

  /* Row templates a fresh array entry starts from; the schema's own initials
   * fill everything not named here. String lists push "" (a blank ref row).
   * Nested-array paths are keyed with N standing for any index
   * ("casting.N.slots"), matched after the live path's indices are erased. */
  static #ROW_DEFAULTS = {
    levels: (sys) => ({ level: (sys.levels?.at(-1)?.level ?? 0) + 1 }),
    saves: (sys) => ({ minLevel: (sys.saves?.at(-1)?.maxLevel ?? 0) + 1 }),
    attack: (sys) => ({ minLevel: (sys.attack?.at(-1)?.maxLevel ?? 0) + 1 }),
    awards: (sys) => ({ atLevel: sys.awards?.at(-1)?.atLevel ?? 1 }),
    requirements: () => ({}),
    ladders: () => ({}),
    casting: () => ({ key: "arcane", kind: "vancian" }),
    templates: (sys) => {
      const last = sys.templates?.at(-1);
      const min = last ? (Number(last.rollMax) || 2) + 1 : 3;
      return { rollMin: min, rollMax: min + 1 };
    },
    paths: () => ({ key: "", label: "", source: "", options: [] }),
    "paths.N.options": () => ({ key: "", label: "", training: { weapons: [], armour: "", styles: [] } }),
    "casting.N.slots": () => ({ atLevel: 1 }),
    "casting.N.pool": () => ({ atLevel: 1 }),
    "templates.N.items": () => ({ qty: 1 }),
    "templates.N.abilities": () => ({ rank: 1 }),
    "templates.N.spells": () => ({}),
    "languages.granted": () => "",
    "inventory.classProfs": () => "",
    "inventory.powers": () => "",
    "inventory.skills": () => ({}),
    "builder.magic": () => ({ type: "", value: 0 }),
    "builder.powers": () => ({}),
    "builder.thievery.skills": () => "",
  };

  /* A row control submits the form first: it writes a whole list from the
   * stored document, so an edit still in flight would be written over. */
  static async #onRowAdd(event, target) {
    const path = target.dataset.array;
    if (!path) return;
    await this.submit();
    const sys = this.item.system;
    const make = ClassSheet.#ROW_DEFAULTS[path] ?? ClassSheet.#ROW_DEFAULTS[path.replace(/\.\d+\./g, ".N.")];
    const update = rowListUpdate(sys.toObject(), path, (list) => list.push(make ? make(sys) : {}));
    if (update) await this.item.update(update);
  }

  static async #onRowDelete(event, target) {
    const path = target.dataset.array;
    const index = Number(target.dataset.index);
    if (!path || !Number.isInteger(index)) return;
    if (!(await confirmRowDelete(target))) return;
    await this.submit();
    const update = rowListUpdate(this.item.system.toObject(), path, (list) => list.splice(index, 1));
    if (update) await this.item.update(update);
  }

  static #onRefOpen(event, target) {
    openRef(target.dataset.ref ?? "");
  }

  /** @override — the inventory ACCEPTS ability items; nothing is offered. */
  _onRender(context, options) {
    super._onRender(context, options);
    if (!this.isEditable) return;
    bindDropHighlight(this.element);
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: "[data-accept-drop]",
      callbacks: { drop: this.#onDrop.bind(this) },
    }).bind(this.element);
  }

  /**
   * What lands where. On a template: a bundle binds the package, an ability,
   * a piece of equipment or a spell fills the row of its kind under the cursor
   * or adds one. Elsewhere only an ability is taken: into the list, into the
   * award row (a custom choice lists it; a fixed award becomes it), or onto
   * the awards as a fixed grant at the last level listed. A drop a list does
   * not take says so.
   */
  async #onDrop(event) {
    // A row zone sits inside a list zone and both are bound; the innermost takes the drop alone.
    event.stopPropagation();
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Item" || !data.uuid) return;
    const dropped = await fromUuid(data.uuid);
    if (!dropped) return;
    const templateRow = event.target.closest("[data-template-row]");
    if (templateRow) return this.#dropOnTemplate(event, templateRow, dropped);
    if (dropped.type !== ITEM_TYPE.ability) return rejectDrop(dropped, "abilityDoc");
    const ref = refOf(dropped);
    const zone = event.target.closest("[data-accept-drop]");
    const list = zone?.dataset.list;
    const sys = this.item.system.toObject();
    if (list === "classProfs" || list === "powers") {
      const current = sys.inventory?.[list] ?? [];
      if (current.includes(ref)) return;
      await this.item.update({ [`system.inventory.${list}`]: [...current, ref] });
    } else if (list === "builderPowers") {
      const current = sys.builder?.powers ?? [];
      if (current.some((p) => p.ref === ref)) return;
      await this.item.update({ "system.builder.powers": [...current, { ref, name: dropped.name, cost: null, note: "" }] });
    } else if (list === "builderSkills") {
      const current = sys.builder?.thievery?.skills ?? [];
      if (current.includes(ref)) return;
      await this.item.update({ "system.builder.thievery.skills": [...current, ref] });
    } else if (list === "skills") {
      const current = sys.inventory?.skills ?? [];
      if (current.some((row) => row.ref === ref)) return;
      await this.item.update({ "system.inventory.skills": [...current, { ref, ladderKey: "" }] });
    } else if (zone?.dataset.award != null) {
      const awards = sys.awards ?? [];
      const award = awards[Number(zone.dataset.award)];
      if (!award) return;
      if (award.kind === "choice" && award.choice?.from === "custom") {
        const refs = award.choice.refs ?? [];
        if (refs.includes(ref)) return;
        award.choice.refs = [...refs, ref];
      } else {
        award.ref = ref;
        award.name = dropped.name;
      }
      await this.item.update({ "system.awards": awards });
    } else if (list === "awards") {
      const awards = sys.awards ?? [];
      awards.push({ kind: "fixed", ref, name: dropped.name, atLevel: awards.at(-1)?.atLevel ?? 1 });
      await this.item.update({ "system.awards": awards });
    }
  }

  /** The template-row half of a drop: the row of the dropped kind under the cursor is filled, else one is added. */
  async #dropOnTemplate(event, templateRow, dropped) {
    const templates = this.item.system.toObject().templates ?? [];
    const t = templates[Number(templateRow.dataset.templateRow)];
    if (!t) return;
    const rowUnder = (kind) => {
      const at = Number(event.target.closest(`[data-template-${kind}]`)?.dataset[`template${kind[0].toUpperCase()}${kind.slice(1)}`]);
      return Number.isInteger(at) ? at : null;
    };
    const fill = (rows, kind, row) => {
      const at = rowUnder(kind);
      if (at !== null && rows[at]) rows[at] = { ...rows[at], ...row };
      else rows.push(row);
      return rows;
    };
    if (dropped.type === ITEM_TYPE.bundle) t.bundle = dropped.uuid;
    else if (dropped.type === ITEM_TYPE.ability) t.abilities = fill(t.abilities ?? [], "ability", { ref: refOf(dropped), name: dropped.name, rank: 1 });
    else if ([ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item].includes(dropped.type)) t.items = fill(t.items ?? [], "item", { ref: refOf(dropped), name: dropped.name, qty: 1 });
    else if (dropped.type === ITEM_TYPE.spell) t.spells = fill(t.spells ?? [], "spell", { uuid: dropped.uuid, name: dropped.name });
    else return rejectDrop(dropped, "templateDrop");
    await this.item.update({ "system.templates": templates });
  }
}
