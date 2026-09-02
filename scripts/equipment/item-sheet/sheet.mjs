/* global foundry, game, ui, Item, Hooks */
/**
 * The ACKS item sheet — one window for every piece of gear: weapons, armour,
 * gear, containers, charts, spell books, coin and treasure. Its shape is fixed;
 * what varies is which flanking cells carry data and which tabs exist.
 *
 * Three layers, and this file is only the outermost:
 *   snapshot.mjs   reads the document into plain data
 *   view-model.mjs decides what to show (pure, tested offline)
 *   sheet.mjs      binds the decisions to Foundry — the form, the actions,
 *                  the drops, and the window chrome
 *
 * The window chrome is merged into the sheet's own first row: the title band
 * part is rendered into the window content and then MOVED into Foundry's
 * `.window-header`, so the header stays the drag handle and keeps its close
 * and controls buttons while the band's inputs live inside the form. Pointer
 * presses on the band's controls are stopped before they reach the header, or
 * every click on the name field would start a window drag.
 *
 * Registered as the default sheet for the four goods types. It replaces the
 * subclass-of-core sheet that moved core's nodes around: the whole surface is
 * this module's own markup now, so nothing depends on the shape of the
 * system's template.
 */
import { MODULE_ID, ITEM_FLAGS, VARIATION_ITEM_TYPE } from "../constants.mjs";
import { LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { buildConstructionPanel } from "../sheet.mjs";
import { buildMagicPanel } from "../../markets/apps/magic-panel.mjs";
import { ITEM_FLAG as MARKETS_FLAG } from "../../markets/constants.mjs";
import { applyVariation, isVariationItem, removeVariation, revealVariation, concealVariation } from "../variation-items.mjs";
import { setBaseType } from "../variation-items.mjs";
import { baseTypesFor } from "../base-types.mjs";
import { disguiseItem, revealItem, setGearCapacity } from "../actions.mjs";
import { PRISTINE, recomputeItemFields } from "../properties.mjs";
import { containerOf, setLocked, storeIn, takeOut, setContainerRecord } from "../containers.mjs";
import { isSpellbook, spellbookSpells, setSpellbookSpells, parseSpellList, formatSpellList } from "../spellbook.mjs";
import * as named from "../overlays/named.mjs";
import { containedIn, setWorn, slotsOf, siblingsOf, isEquippable, isWorn } from "../../lib/item-model.mjs";
import { inferGear } from "../profiles.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { snapshotItem, SHEET_FLAGS } from "./snapshot.mjs";
import { buildItemSheetModel, togglePin, KNOW_STEPS, VALUE_MODES } from "./view-model.mjs";
import { rollById, rollIds } from "./rolls.mjs";
import { bindScene, unbindScene, updateFromExploration, chartScene } from "./chart.mjs";
import { splitOne, restack, canSplit, splitFromOf } from "./stack.mjs";
import { ACCEPT_KINDS } from "./accept-kinds.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ItemSheetV2 } = foundry.applications.sheets;

const T = `modules/${MODULE_ID}/templates/equipment/item-sheet`;
/** The four document types this sheet is the default for. */
export const ITEM_SHEET_TYPES = Object.freeze([ITEM_TYPE.weapon, ITEM_TYPE.armor, ITEM_TYPE.item, ITEM_TYPE.money]);
/** Every template the body includes as a partial, preloaded at init. */
export const ITEM_SHEET_TEMPLATES = Object.freeze([
  "band", "body", "rails", "rolls", "chart", "durability", "effects", "contents", "appearance", "details", "record",
].map((n) => `${T}/${n}.hbs`));

const loc = makeLoc(LANG);
const enrich = (html, item) =>
  foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: item, secrets: item.isOwner });

export default class AcksItemSheet extends HandlebarsApplicationMixin(ItemSheetV2) {
  static DEFAULT_OPTIONS = {
    // no-scroll: this sheet scrolls at its PART root, not at `.window-content`.
    // The shared contract would move the scroller onto `.window-content`, which
    // is not a part — and ApplicationV2 restores scroll per part, so the body's
    // `scrollable: [""]` below would stop working. A sheet whose fields submit
    // on change needs the retention more than it needs the shared rule; the
    // scroller lives in styles/equipment-item-sheet.css instead.
    classes: ["acks-ui", "acks-extras", "acks-extras-item-sheet"],
    position: { width: 620, height: "auto" },
    tag: "form",
    form: { submitOnChange: true, closeOnSubmit: false },
    // Resizable: the design's 620px is the MINIMUM (CSS), not a lock — the
    // window keeps its own controls, the resize grip included.
    window: { resizable: true, contentClasses: ["acks-extras-item-sheet__content"] },
    actions: {
      pinRoll: AcksItemSheet.#onPinRoll,
      roll: AcksItemSheet.#onRoll,
      goTab: AcksItemSheet.#onGoTab,
      equip: AcksItemSheet.#onEquip,
      split: AcksItemSheet.#onSplit,
      restack: AcksItemSheet.#onRestack,
      favorite: AcksItemSheet.#onFavorite,
      editDescription: AcksItemSheet.#onEditDescription,
      changeArt: AcksItemSheet.#onChangeArt,
      editTags: AcksItemSheet.#onEditTags,
      ownership: AcksItemSheet.#onOwnership,
      source: AcksItemSheet.#onSource,
      showDetails: AcksItemSheet.#onShowDetails,
      openScene: AcksItemSheet.#onOpenScene,
      updateChart: AcksItemSheet.#onUpdateChart,
      unbindScene: AcksItemSheet.#onUnbindScene,
      toggleLock: AcksItemSheet.#onToggleLock,
      removeKey: AcksItemSheet.#onRemoveKey,
      markDestroyed: AcksItemSheet.#onMarkDestroyed,
      addEffect: AcksItemSheet.#onAddEffect,
      configureEffect: AcksItemSheet.#onConfigureEffect,
      deleteEffect: AcksItemSheet.#onDeleteEffect,
      guessName: AcksItemSheet.#onGuessName,
      renameItem: AcksItemSheet.#onRenameItem,
      saveNamed: AcksItemSheet.#onSaveNamed,
      unmakeNamed: AcksItemSheet.#onUnmakeNamed,
      openContent: AcksItemSheet.#onOpenContent,
      takeOut: AcksItemSheet.#onTakeOut,
      valueMode: AcksItemSheet.#onValueMode,
      addVariation: AcksItemSheet.#onAddVariation,
      removeVariation: AcksItemSheet.#onRemoveVariation,
      toggleVariationHidden: AcksItemSheet.#onToggleVariationHidden,
      toggleHolds: AcksItemSheet.#onToggleHolds,
      toggleDisguisable: AcksItemSheet.#onToggleDisguisable,
      toggleAccept: AcksItemSheet.#onToggleAccept,
      knowStep: AcksItemSheet.#onKnowStep,
      toggleMagic: AcksItemSheet.#onToggleMagic,
      removeDisguise: AcksItemSheet.#onRemoveDisguise,
      previewAsPlayer: AcksItemSheet.#onPreviewAsPlayer,
      judgeView: AcksItemSheet.#onJudgeView,
    },
  };

  static PARTS = {
    band: { template: `${T}/band.hbs` },
    body: { template: `${T}/body.hbs`, scrollable: [""] },
  };

  tabGroups = { primary: "rolls" };

  /** Sheet-local state that survives the re-render every form change causes. */
  #ui = { previewAsPlayer: false, showDetails: false, editingDescription: false };

  /** The model of the last render — what the actions read their ids against. */
  #model = null;

  /**
   * Hook ids for the sibling watch. The sheet shows facts held on OTHER
   * documents in the same collection — what is stored inside it, the
   * variations applied to it, whether the bearer has Lockpicking — and a
   * document sheet re-renders only on its own updates. So sibling creates,
   * updates and deletes re-render it too, debounced so a loadout sync that
   * touches a dozen items costs one render.
   */
  #siblingHooks = [];

  #renderSoon = foundry.utils.debounce(() => {
    if (this.rendered) this.render();
  }, 50);

  /** Is this document a sibling whose change the sheet should reflect? */
  #concerns(doc) {
    if (!doc || doc.id === this.item.id) return false;
    if (doc.documentName === "Actor") return doc === this.item.parent;
    if (doc.documentName === "ActiveEffect") return doc.parent === this.item || doc.parent === this.item.parent;
    if (doc.documentName !== "Item") return false;
    return this.item.parent ? doc.parent === this.item.parent : !doc.parent;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    const watch = (doc) => {
      if (this.#concerns(doc)) this.#renderSoon();
    };
    for (const hook of ["createItem", "updateItem", "deleteItem", "createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "updateActor"]) {
      this.#siblingHooks.push([hook, Hooks.on(hook, watch)]);
    }
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#siblingHooks) Hooks.off(hook, id);
    this.#siblingHooks = [];
    await super._onClose(options);
  }

  /* -------------------------------------------- */
  /*  Context                                      */
  /* -------------------------------------------- */

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const item = this.item;
    const gm = game.user.isGM;
    const disguise = item.getFlag(MODULE_ID, ITEM_FLAGS.DISGUISE);
    const [descriptionHTML, trueDescriptionHTML] = await Promise.all([
      enrich(item.system?.description, item),
      gm && disguise?.true ? enrich(disguise.true.description, item) : Promise.resolve(""),
    ]);
    const snap = snapshotItem(item, { gm, descriptionHTML, trueDescriptionHTML });
    const model = buildItemSheetModel(snap, {
      isGM: gm,
      editable: this.isEditable,
      previewAsPlayer: this.#ui.previewAsPlayer,
      activeTab: this.tabGroups.primary,
      showDetails: this.#ui.showDetails,
      editingDescription: this.#ui.editingDescription,
    });
    this.#model = model;
    if (model.activeTab) this.tabGroups.primary = model.activeTab;

    return Object.assign(context, model, {
      item,
      snap,
      // Form paths the band binds to: the true name when a Judge looks at a
      // disguised item, the document's otherwise.
      namePath: model.band.nameMasked ? `flags.${MODULE_ID}.${ITEM_FLAGS.DISGUISE}.true.name` : "name",
      descriptionPath: model.band.nameMasked ? `flags.${MODULE_ID}.${ITEM_FLAGS.DISGUISE}.true.description` : "system.description",
      containerPath: `flags.${MODULE_ID}.${ITEM_FLAGS.CONTAINER}`,
      capacityPath: `flags.${MODULE_ID}.gear.capacity`,
      spellbookText: isSpellbook(item) ? formatSpellList(spellbookSpells(item)) : null,
      canSplit: canSplit(item),
      worldItem: !item.parent,
    });
  }

  /**
   * Form values that are not document paths: the weight typed in stone, and a
   * capacity left blank (which is "holds nothing", not zero).
   */
  _processFormData(event, form, formData) {
    const data = super._processFormData(event, form, formData);
    // The band's quantity badge doubles the Record panel's field on screen, so
    // it submits under its own name and counts only when it is the control
    // that fired the change — otherwise the Record field's value (same name
    // as the document path) is already the submit.
    if ("acksBandQty" in data) {
      const qty = Number(data.acksBandQty);
      delete data.acksBandQty;
      if (event?.target?.name === "acksBandQty" && Number.isFinite(qty)) {
        const qtyPath = this.item.type === ITEM_TYPE.money ? "system.quantity" : "system.quantity.value";
        foundry.utils.setProperty(data, qtyPath, Math.max(0, Math.round(qty)));
      }
    }
    const cap = foundry.utils.getProperty(data, `flags.${MODULE_ID}.gear.capacity`);
    if (cap === "" || cap === null) {
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.gear.capacity`, null);
    }
    // The listed price is the PRISTINE cost: with layers applied it lives in
    // the snapshot and the document's cost is recomputed from it; with none,
    // the document's cost is the listed price itself.
    if ("acksListedPrice" in data) {
      const listed = Number(data.acksListedPrice);
      delete data.acksListedPrice;
      if (Number.isFinite(listed)) {
        if (this.item.getFlag(MODULE_ID, PRISTINE)) {
          foundry.utils.setProperty(data, `flags.${MODULE_ID}.${PRISTINE}.cost`, Math.max(0, listed));
          this.#recomputeAfterSubmit = true;
        } else {
          foundry.utils.setProperty(data, "system.cost", Math.max(0, listed));
        }
      }
    }
    return data;
  }

  /** Set when a submit changed the baseline the layers are computed from. */
  #recomputeAfterSubmit = false;

  /** A saved description closes the editor it was typed in. */
  async _processSubmitData(event, form, submitData, options) {
    if (foundry.utils.hasProperty(submitData, "system.description") || foundry.utils.hasProperty(submitData, `flags.${MODULE_ID}.${ITEM_FLAGS.DISGUISE}.true.description`)) {
      this.#ui.editingDescription = false;
    }
    const result = await super._processSubmitData(event, form, submitData, options);
    if (this.#recomputeAfterSubmit) {
      this.#recomputeAfterSubmit = false;
      await recomputeItemFields(this.item);
    }
    return result;
  }

  /* -------------------------------------------- */
  /*  Render                                       */
  /* -------------------------------------------- */

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    const steps = [
      ["band", () => this.#moveBandIntoHeader()],
      ["construction", () => this.#mountConstruction()],
      ["magic", () => this.#mountMagic()],
      ["spellbook", () => this.#wireSpellbook()],
      ["drops", () => this.#markDropZones()],
    ];
    // Each decoration guards itself: one failing must not take the sheet with it.
    for (const [what, step] of steps) {
      try {
        step();
      } catch (err) {
        console.error(`${MODULE_ID} | item sheet: ${what} failed`, err);
      }
    }
  }

  /**
   * The title band is the window header. Foundry's header keeps its drag
   * handle and its two buttons; the icon and title it renders are hidden by
   * CSS rather than removed, so `_updateFrame` still has nodes to write.
   */
  #moveBandIntoHeader() {
    const header = this.element.querySelector(":scope > .window-header");
    // The freshly rendered part lands in the window content; any band already
    // in the header is the previous render's and goes — the mixin cannot
    // replace a part it no longer finds inside the content.
    const bands = [...this.element.querySelectorAll('[data-application-part="band"]')];
    const band = bands.find((b) => b.parentElement !== header) ?? bands[0];
    if (!header || !band) return;
    for (const stale of bands) if (stale !== band) stale.remove();
    const controls = header.querySelector("button[data-action=toggleControls]");
    if (band.parentElement !== header) header.insertBefore(band, controls ?? null);
    if (!band.dataset.guarded) {
      band.dataset.guarded = "1";
      band.addEventListener("pointerdown", (ev) => {
        if (ev.target.closest("input, button, a, select, textarea, label")) ev.stopPropagation();
      });
    }
  }

  #mountConstruction() {
    const mount = this.element.querySelector('[data-mount="construction"]');
    if (!mount || mount.children.length) return;
    mount.append(buildConstructionPanel(this.item));
  }

  #mountMagic() {
    for (const mount of this.element.querySelectorAll('[data-mount="magic"]')) {
      if (mount.children.length) continue;
      mount.append(buildMagicPanel(this.item));
    }
  }

  #wireSpellbook() {
    const ta = this.element.querySelector('[data-field="spellbook"]');
    if (!ta || ta.dataset.wired) return;
    ta.dataset.wired = "1";
    ta.addEventListener("change", (ev) => {
      ev.stopPropagation(); // a flag write, not a form submit
      setSpellbookSpells(this.item, parseSpellList(ta.value)).catch((e) => console.error(`${MODULE_ID} | spellbook`, e));
    });
  }

  /** Drop zones light up while a drag is over them. */
  #markDropZones() {
    for (const zone of this.element.querySelectorAll("[data-drop]")) {
      if (zone.dataset.wired) continue;
      zone.dataset.wired = "1";
      zone.addEventListener("dragenter", () => zone.classList.add("is-over"));
      zone.addEventListener("dragleave", () => zone.classList.remove("is-over"));
      zone.addEventListener("drop", () => zone.classList.remove("is-over"));
    }
  }

  /* -------------------------------------------- */
  /*  Drops                                        */
  /* -------------------------------------------- */

  /**
   * One drop handler, routed by what landed and where: a Scene binds a chart,
   * a variation applies, a key joins the lock, an item masks this one on the
   * disguise target, and anything else is stored if this is a container.
   */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    const zone = event.target?.closest?.("[data-drop]")?.dataset.drop ?? null;
    try {
      if (data?.type === "Scene" && data.uuid) {
        const scene = await foundry.utils.fromUuid(data.uuid);
        if (scene && (await bindScene(this.item, scene))) return this.render();
        return;
      }
      if (data?.type !== "Item" || !data.uuid) return;
      const dropped = await foundry.utils.fromUuid(data.uuid);
      if (!dropped || dropped.id === this.item.id) return;
      if (isVariationItem(dropped)) {
        await applyVariation(this.item, dropped, { move: !!containedIn(dropped) });
        return this.render();
      }
      if (zone === "disguise" && game.user.isGM) {
        await disguiseItem(this.item, {
          name: dropped.name,
          img: dropped.img,
          cost: dropped.system?.cost,
          description: dropped.system?.description ?? "",
          damage: dropped.system?.damage,
          ac: dropped.system?.aac?.value,
        });
        return this.render();
      }
      if (zone === "keys") {
        const rec = containerOf(this.item) ?? {};
        const keys = [...(rec.keys ?? [])];
        if (!keys.some((k) => k.uuid === dropped.uuid)) keys.push({ uuid: dropped.uuid, name: dropped.name });
        await setContainerRecord(this.item, { keys });
        return this.render();
      }
      if (this.#model?.details?.holds) {
        const actor = this.item.parent;
        if (!actor) return void ui.notifications.warn(loc("itemSheet.contents.needsActor"));
        const candidate = dropped.parent === actor ? dropped : null;
        if (!candidate) return void ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.container.foreignItem"));
        await storeIn(actor, candidate, this.item);
        return this.render();
      }
    } catch (err) {
      console.error(`${MODULE_ID} | item sheet drop failed`, err);
    }
  }

  /* -------------------------------------------- */
  /*  Actions — rails and band                     */
  /* -------------------------------------------- */

  static async #onPinRoll(event, target) {
    const ids = rollIds(this.#model ? this.#model.rolls.groups : []);
    const pins = togglePin(this.item.getFlag(MODULE_ID, SHEET_FLAGS.PINS), ids, target.dataset.roll);
    await this.item.setFlag(MODULE_ID, SHEET_FLAGS.PINS, pins);
  }

  static async #onRoll(event, target) {
    await rollById(this.item, target.dataset.roll, { event });
  }

  static #onGoTab(event, target) {
    const tab = target.dataset.tab;
    if (this.#model?.simple && tab === "details") {
      this.#ui.showDetails = true;
      return this.render();
    }
    if (this.element.querySelector(`.tabs [data-group="primary"][data-tab="${tab}"]`)) this.changeTab(tab, "primary");
  }

  static async #onEquip() {
    const item = this.item;
    if (splitFromOf(item)) return restack(item);
    const slot = slotsOf(item)[0] ?? inferGear(item).slots[0] ?? null;
    if (isEquippable(item)) {
      await item.update({ "system.equipped": !isWorn(item) });
      return;
    }
    if (!slot) return void ui.notifications.warn(loc("itemSheet.equip.noSlot"));
    if (!slotsOf(item).length) await item.update({ [`flags.${MODULE_ID}.gear.slots`]: [slot] });
    await setWorn(item, item.getFlag(MODULE_ID, "gear")?.wornAt ? null : slot);
  }

  static async #onSplit() {
    const created = await splitOne(this.item);
    if (created) ui.notifications.info(loc("itemSheet.equip.splitDone", { name: created.name }));
  }

  static async #onRestack() {
    await restack(this.item);
    this.close();
  }

  static async #onFavorite() {
    if (!("favorite" in (this.item.system ?? {}))) return;
    await this.item.update({ "system.favorite": !this.item.system.favorite });
  }

  static #onEditDescription() {
    this.#ui.editingDescription = !this.#ui.editingDescription;
    this.render();
  }

  /**
   * The rail's art cell: Foundry's own `editImage` action accepts only an
   * `<img>` target, so the button opens the same FilePicker itself.
   */
  static #onChangeArt() {
    const FilePicker = foundry.applications.apps.FilePicker.implementation;
    new FilePicker({
      type: "image",
      current: this.item.img,
      callback: (path) => this.item.update({ img: path }),
    }).browse();
  }

  /**
   * The ◇ cell: a weapon edits its core tags, anything else declares its base
   * type. Both are small prompts rather than a tab — a tag is a word, and a
   * base type is one pick.
   */
  static async #onEditTags() {
    const item = this.item;
    const Dialog = foundry.applications.api.DialogV2;
    if (item.type === ITEM_TYPE.weapon) {
      const current = (item.system.tags ?? []).map((t) => t.title || t.value).join("\n");
      const result = await Dialog.prompt({
        window: { title: loc("itemSheet.tags.title") },
        content: `<p class="hint">${loc("itemSheet.tags.hint")}</p><textarea name="tags" rows="6" class="acks-input">${foundry.utils.escapeHTML(current)}</textarea>`,
        ok: { label: loc("itemSheet.tags.save"), callback: (_ev, button) => button.form.elements.tags.value },
        rejectClose: false,
      });
      if (result === null || result === undefined) return;
      const tags = String(result).split(/\r?\n/).map((s) => s.trim()).filter(Boolean).map((title) => ({ title, value: title }));
      await item.update({ "system.tags": tags });
      return;
    }
    const types = baseTypesFor(item.type);
    const options = [`<option value="">${loc("itemSheet.tags.baseTypeNone")}</option>`]
      .concat(types.map((k) => `<option value="${k}" ${this.#snapBaseType() === k ? "selected" : ""}>${game.i18n.localize(`ACKS-EQUIPMENT.baseType.${k}`)}</option>`))
      .join("");
    const picked = await Dialog.prompt({
      window: { title: loc("itemSheet.tags.baseTypeTitle") },
      content: `<p class="hint">${loc("itemSheet.tags.baseTypeHint")}</p><select name="baseType" class="acks-input">${options}</select>`,
      ok: { label: loc("itemSheet.tags.save"), callback: (_ev, button) => button.form.elements.baseType.value },
      rejectClose: false,
    });
    if (picked === null || picked === undefined) return;
    await setBaseType(item, picked || null);
  }

  #snapBaseType() {
    return this.item.getFlag(MODULE_ID, "baseType") ?? "";
  }

  static #onOwnership() {
    const Config = foundry.applications.apps.DocumentOwnershipConfig;
    if (Config) new Config({ document: this.item }).render(true);
  }

  /** The ✳ cell: where the item came from, and the identification state. */
  static #onSource() {
    const source = this.item._stats?.compendiumSource;
    ui.notifications.info(source ? loc("itemSheet.source.from", { source }) : loc("itemSheet.source.none"));
    if (this.#model?.tabs.some((t) => t.key === "appearance")) this.changeTab("appearance", "primary");
  }

  static #onShowDetails() {
    this.#ui.showDetails = !this.#ui.showDetails;
    this.render();
  }

  /* -------------------------------------------- */
  /*  Actions — chart                              */
  /* -------------------------------------------- */

  static #onOpenScene() {
    chartScene(this.item)?.view?.();
  }

  static async #onUpdateChart() {
    const result = await updateFromExploration(this.item);
    if (!result.ok) ui.notifications.warn(loc(`itemSheet.chart.${result.reason}`));
    else ui.notifications.info(loc("itemSheet.chart.updated", { pct: Math.round(result.pct * 100) }));
  }

  static async #onUnbindScene() {
    await unbindScene(this.item);
  }

  /* -------------------------------------------- */
  /*  Actions — durability & the lock              */
  /* -------------------------------------------- */

  static async #onToggleLock() {
    await setLocked(this.item, !containerOf(this.item)?.locked);
  }

  static async #onRemoveKey(event, target) {
    const rec = containerOf(this.item) ?? {};
    await setContainerRecord(this.item, { keys: (rec.keys ?? []).filter((k) => k.uuid !== target.dataset.uuid) });
  }

  static async #onMarkDestroyed() {
    const on = !!this.item.getFlag(MODULE_ID, SHEET_FLAGS.DESTROYED);
    if (on) await this.item.unsetFlag(MODULE_ID, SHEET_FLAGS.DESTROYED);
    else await this.item.setFlag(MODULE_ID, SHEET_FLAGS.DESTROYED, true);
  }

  /* -------------------------------------------- */
  /*  Actions — effects & the name                 */
  /* -------------------------------------------- */

  static async #onAddEffect() {
    const [effect] = await this.item.createEmbeddedDocuments("ActiveEffect", [
      { name: this.item.name, img: this.item.img, transfer: true, disabled: false },
    ]);
    effect?.sheet?.render(true);
  }

  static #onConfigureEffect(event, target) {
    this.item.effects.get(target.dataset.effect)?.sheet?.render(true);
  }

  static async #onDeleteEffect(event, target) {
    await this.item.effects.get(target.dataset.effect)?.delete();
  }

  static async #onGuessName() {
    const item = this.item;
    const spoken = this.element.querySelector('[data-field="guess"]')?.value ?? "";
    const speaker = item.parent ?? game.user.character ?? null;
    if (!speaker) return void ui.notifications.warn(game.i18n.localize("ACKS-EQUIPMENT.named.noSpeaker"));
    const res = named.resolveGuess(item, speaker, spoken);
    if (!res.allowed) return void ui.notifications.warn(game.i18n.format("ACKS-EQUIPMENT.named.noGuess", { name: speaker.name }));
    await item.update(res.updates);
    if (res.correct) {
      await item.update(named.applyUpdates(item));
      ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.named.correct", { item: item.name }));
    } else {
      ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.named.wrong", { name: speaker.name }));
    }
  }

  static async #onRenameItem() {
    const item = this.item;
    const given = (this.element.querySelector('[data-field="rename"]')?.value ?? "").trim();
    if (!given) return;
    const wielderLevel = Number((item.parent ?? game.user.character)?.system?.details?.level ?? 1);
    await item.update(named.renameUpdates(item, given, wielderLevel));
    await item.update(named.applyUpdates(item));
    ui.notifications.info(game.i18n.format("ACKS-EQUIPMENT.named.renamed", { item: given }));
  }

  /** GM: write the record — true name, the unlock ladder, how many are open. */
  static async #onSaveNamed() {
    const item = this.item;
    const rec = named.namedOf(item);
    const field = (k) => this.element.querySelector(`[data-field="${k}"]`)?.value ?? "";
    const keys = Object.keys(named.NAMED_CATEGORIES);
    const ladder = field("ladder").split(",").map((s) => s.trim().toLowerCase()).filter((s) => keys.includes(s));
    const record = {
      ...(rec ?? {}),
      trueName: field("trueName").trim(),
      givenName: rec?.givenName ?? item.name,
      ladder,
      unlocked: Math.max(0, parseInt(field("unlocked"), 10) || 0),
      revealed: rec?.revealed ?? false,
      base: rec?.base ?? named.captureBase(item),
    };
    await item.setFlag(MODULE_ID, ITEM_FLAGS.NAMED, record);
    await item.update(named.applyUpdates(item));
  }

  static async #onUnmakeNamed() {
    const item = this.item;
    const base = named.baseOf(item);
    await item.update({
      "system.bonus": base.bonus,
      ...(item.type === ITEM_TYPE.weapon ? { "system.damage": base.damage } : {}),
      ...(item.type === ITEM_TYPE.armor ? { "system.aac.value": base.aac } : {}),
      "system.weight6": base.weight6,
    });
    await item.unsetFlag(MODULE_ID, ITEM_FLAGS.NAMED);
  }

  /* -------------------------------------------- */
  /*  Actions — contents                           */
  /* -------------------------------------------- */

  static #onOpenContent(event, target) {
    siblingsOf(this.item)?.get?.(target.dataset.item)?.sheet?.render(true);
  }

  static async #onTakeOut(event, target) {
    const stored = siblingsOf(this.item)?.get?.(target.dataset.item);
    if (stored) await takeOut(stored);
  }

  /* -------------------------------------------- */
  /*  Actions — details                            */
  /* -------------------------------------------- */

  static async #onValueMode(event, target) {
    const mode = target.dataset.mode;
    if (!VALUE_MODES.includes(mode)) return;
    await this.item.setFlag(MODULE_ID, SHEET_FLAGS.VALUE_MODE, mode);
  }

  /** A variation made by hand: created applied to this item, then opened. */
  static async #onAddVariation() {
    const item = this.item;
    const data = {
      name: loc("itemSheet.variations.newName"),
      type: VARIATION_ITEM_TYPE,
      flags: { [MODULE_ID]: { [ITEM_FLAGS.CONTAINED_IN]: item.id } },
    };
    const [created] = item.parent ? await item.parent.createEmbeddedDocuments("Item", [data]) : [await Item.implementation.create(data)];
    created?.sheet?.render(true);
  }

  static async #onRemoveVariation(event, target) {
    const v = siblingsOf(this.item)?.get?.(target.dataset.variation);
    if (v) await removeVariation(v);
  }

  static async #onToggleVariationHidden(event, target) {
    const v = siblingsOf(this.item)?.get?.(target.dataset.variation);
    if (!v) return;
    await (v.system?.hidden ? revealVariation(v) : concealVariation(v));
  }

  /** "Holds other items": a declared capacity, unstated size until one is typed. */
  static async #onToggleHolds() {
    const holds = this.#model?.details?.holds;
    await setGearCapacity(this.item, holds ? "" : 0);
  }

  static async #onToggleDisguisable() {
    const on = !!this.item.getFlag(MODULE_ID, SHEET_FLAGS.DISGUISABLE);
    if (on) await this.item.unsetFlag(MODULE_ID, SHEET_FLAGS.DISGUISABLE);
    else await this.item.setFlag(MODULE_ID, SHEET_FLAGS.DISGUISABLE, true);
  }

  static async #onToggleAccept(event, target) {
    const kind = target.dataset.kind;
    if (!ACCEPT_KINDS.includes(kind)) return;
    const rec = containerOf(this.item) ?? {};
    const accepts = new Set(rec.accepts ?? []);
    if (accepts.has(kind)) accepts.delete(kind);
    else accepts.add(kind);
    await setContainerRecord(this.item, { accepts: ACCEPT_KINDS.filter((k) => accepts.has(k)) });
  }

  /* -------------------------------------------- */
  /*  Actions — appearance                         */
  /* -------------------------------------------- */

  static async #onKnowStep(event, target) {
    const step = KNOW_STEPS.find((s) => String(s.n) === target.dataset.step);
    if (!step) return;
    const f = this.item.getFlag(MODULE_ID, MARKETS_FLAG) ?? {};
    await this.item.setFlag(MODULE_ID, MARKETS_FLAG, { ...f, identified: step.key });
  }

  static async #onToggleMagic() {
    const f = this.item.getFlag(MODULE_ID, MARKETS_FLAG) ?? {};
    await this.item.setFlag(MODULE_ID, MARKETS_FLAG, { ...f, magic: !f.magic });
  }

  static async #onRemoveDisguise() {
    await revealItem(this.item);
  }

  static #onPreviewAsPlayer() {
    this.#ui.previewAsPlayer = true;
    this.render();
  }

  static #onJudgeView() {
    this.#ui.previewAsPlayer = false;
    this.render();
  }
}

/**
 * Register the sheet as the default for the goods types. At init: a
 * standalone sheet needs nothing resolved from the system's registry.
 */
export function registerItemSheet() {
  foundry.documents.collections.Items.registerSheet(MODULE_ID, AcksItemSheet, {
    types: [...ITEM_SHEET_TYPES],
    makeDefault: true,
    label: "ACKS-EQUIPMENT.sheet.label",
  });
  console.debug(`${MODULE_ID} | item sheet registered (default for ${ITEM_SHEET_TYPES.join("/")}).`);
}
