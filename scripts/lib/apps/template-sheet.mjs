/* global game, foundry, ui, Actor, Folder, fromUuid */
/**
 * The `acks-lib.template` BUILDER sheet.
 *
 * A template is not a creature — it is the book's generation procedure held as
 * a document — so its sheet is a builder: one select per axis (defaulting to
 * "Roll", the book's own procedure), a drop zone for an optional BASE actor
 * (the vampire thrall's victim), and Generate. Pins and the base are
 * per-window UI state, never actor data: closing the sheet forgets them, the
 * template document stays pure.
 *
 * Generation itself is the pure half (template-logic.mjs): pinned > derived >
 * rolled, merged into one engine-ready payload, created as ONE actor. The
 * provenance rides in `flags["acks-extras"].generated` so a sheet can later say
 * "derived from Dragon (Adult · Wyvern)".
 */
import { MODULE_ID, LANG_PREFIX, TEMPLATE_TYPE } from "../constants.mjs";
import { chooseAxes, mergePatch, resolveActor, rollMenu } from "../template-logic.mjs";
import { hitDiceOrLevel } from "../actor-read.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;

export { TEMPLATE_TYPE };

/**
 * The sheet for a template actor — the generator behind a creature the book
 * stats as tables (a dragon by age, type and body form). Builds one concrete
 * actor on demand rather than materializing the cross product.
 */
/**
 * Where a generated creature goes: a top-level folder of its own, made on
 * demand, NEVER the template's.
 *
 * A generator and the creatures rolled off it are different kinds of document.
 * Filing the creature beside the template buries play material in the reference
 * shelf the importer built — and when the template lives in a compendium, the
 * template's folder id belongs to that pack and would leave the new actor in
 * the sidebar pointing at a folder the sidebar does not have.
 *
 * An existing folder of this name is adopted rather than duplicated, so a Judge
 * who renames or refiles it keeps their arrangement.
 */
async function generatedFolder() {
  const name = game.i18n?.localize?.(`${LANG_PREFIX}.template.folder`) ?? "Generated";
  return (
    game.folders?.find((f) => f.type === "Actor" && f.name === name && !f.folder) ??
    (await Folder.create({ name, type: "Actor", sorting: "a" }))
  );
}

export class TemplateSheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-lib-template-sheet"],
    position: { width: 520, height: 600 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      generate: TemplateSheet.#onGenerate,
      clearBase: TemplateSheet.#onClearBase,
      editToggle: TemplateSheet.#onEditToggle,
      addAxis: TemplateSheet.#onAddAxis,
      deleteAxis: TemplateSheet.#onDeleteAxis,
      addOption: TemplateSheet.#onAddOption,
      deleteOption: TemplateSheet.#onDeleteOption,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/lib/template-sheet.hbs`, scrollable: [""] },
  };

  /** Per-window build state (never persisted): axis pins + the dropped base. */
  #pins = {};
  #baseUuid = null;
  #baseName = "";
  /** Edit mode: structure editing + capture-from-actor (GM extensibility). */
  #editing = false;

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const sys = this.actor.system;
    context.editable = this.isEditable;
    context.system = sys;
    context.actor = this.actor;
    context.isStub = sys.isStub;
    context.base = this.#baseUuid ? { uuid: this.#baseUuid, name: this.#baseName } : null;

    context.editing = this.#editing && this.isEditable;
    context.axes = (sys.axes ?? []).map((axis) => ({
      key: axis.key,
      label: axis.label || axis.key,
      multi: !!axis.multi,
      rollLabel: axis.roll
        ? game.i18n.format("ACKS-LIB.template.rollDie", { die: axis.roll })
        : game.i18n.localize("ACKS-LIB.template.rollUniform"),
      derived: !!axis.derive?.from && !!this.#baseUuid,
      pinned: this.#pins[axis.key] ?? "",
      options: (axis.options ?? []).map((o) => ({
        key: o.key,
        label: o.label || o.key,
        selected: axis.multi
          ? (this.#pins[axis.key] ?? []).includes?.(o.key)
          : (this.#pins[axis.key] ?? "") === o.key,
        empty: !Object.keys(o.merge ?? {}).length && !(o.items ?? []).length,
      })),
    }));

    const budgetAxis = sys.menu?.budgetAxis;
    context.hasMenu = !!(sys.menu?.rows ?? []).length;
    context.menuNote = context.hasMenu
      ? game.i18n.format("ACKS-LIB.template.menuNote", { n: sys.menu.rows.length, axis: budgetAxis || "?" })
      : "";

    context.biographyHTML = await foundry.applications.ux.TextEditor.implementation.enrichHTML(
      sys.details?.biography ?? "",
      { relativeTo: this.actor, secrets: this.actor.isOwner }
    );
    return context;
  }

  /** @override — record pin changes; they are UI state, not document fields. */
  async _onRender(context, options) {
    await super._onRender(context, options);
    for (const sel of this.element.querySelectorAll("select.acks-lib-template-pin")) {
      sel.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.axis;
        const value = ev.currentTarget.value;
        if (value) this.#pins[key] = value;
        else delete this.#pins[key];
      });
    }
    // Multi-select axes pin an ARRAY of checked options (stacked add-ons).
    for (const box of this.element.querySelectorAll("input.acks-lib-template-multi")) {
      box.addEventListener("change", (ev) => {
        const key = ev.currentTarget.dataset.axis;
        const picked = [...this.element.querySelectorAll(`input.acks-lib-template-multi[data-axis="${key}"]:checked`)]
          .map((b) => b.value);
        if (picked.length) this.#pins[key] = picked;
        else delete this.#pins[key];
      });
    }
    if (!this.isEditable) return;
    new foundry.applications.ux.DragDrop.implementation({
      permissions: { drop: () => this.isEditable },
      callbacks: { drop: (event) => this.#onDropActor(event) },
    }).bind(this.element);
  }

  async #onDropActor(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Actor") return;
    const source = await foundry.utils.getDocumentClass("Actor").fromDropData(data);
    if (!source || source.uuid === this.actor.uuid) return;
    // In edit mode, dropping onto an OPTION row CAPTURES that actor as the
    // option's preset — the extensibility gesture: build/adjust an exemplar
    // actor however you like, then snapshot it as a variant.
    const optionRow = this.#editing ? event.target?.closest?.("[data-axis-key][data-option-key]") : null;
    if (optionRow) {
      await this.#captureOption(optionRow.dataset.axisKey, optionRow.dataset.optionKey, source);
      return;
    }
    this.#baseUuid = source.uuid;
    this.#baseName = source.name;
    ui.notifications.info(game.i18n.format("ACKS-LIB.template.baseSet", { name: source.name }));
    this.render();
  }

  /** Snapshot an actor's whole sheet-facing state into one option's patches. */
  async #captureOption(axisKey, optionKey, source) {
    const axes = this.actor.system.toObject().axes;
    const option = axes.find((a) => a.key === axisKey)?.options?.find((o) => o.key === optionKey);
    if (!option) return;
    const flags = foundry.utils.deepClone(source.flags ?? {});
    delete flags.core;
    delete flags[MODULE_ID]?.generated; // a captured generation must not chain provenance
    const token = source.prototypeToken
      ? { width: source.prototypeToken.width, height: source.prototypeToken.height }
      : {};
    Object.assign(option, {
      merge: source.system.toObject(),
      items: source.items.map((i) => i.toObject()),
      flags,
      token,
      art: source.img ?? "",
    });
    // First capture into an otherwise-empty template adopts the source's TYPE:
    // capture a warhorse and the template generates `acks-lib.animal` actors,
    // capture a monster and it generates monsters. (Mounts and pack animals
    // are container roots too.)
    const hasOther = axes.some((a) =>
      a.options.some((o) => o !== option && (Object.keys(o.merge ?? {}).length || (o.items ?? []).length))
    );
    const update = { "system.axes": axes };
    if (!hasOther) update["system.output.actorType"] = source.type;
    await this.actor.update(update);
    ui.notifications.info(game.i18n.format("ACKS-LIB.template.info.captured", { name: source.name, option: option.label || optionKey }));
    this.render();
  }

  static async #onClearBase() {
    this.#baseUuid = null;
    this.#baseName = "";
    this.render();
  }

  /* --- structure editing (GM extensibility: new families without import) --- */

  static #onEditToggle() {
    this.#editing = !this.#editing;
    this.render();
  }

  /** One-line text prompt via DialogV2; null on cancel. */
  static async #prompt(title, label, initial = "") {
    const esc = foundry.utils.escapeHTML;
    return foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title },
      content: `<label>${esc(label)} <input type="text" name="value" value="${esc(initial)}" autofocus /></label>`,
      ok: { callback: (event, button) => button.form.elements.value.value.trim() },
      rejectClose: false,
    });
  }

  static async #onAddAxis() {
    const label = await TemplateSheet.#prompt(
      game.i18n.localize("ACKS-LIB.template.addAxis"),
      game.i18n.localize("ACKS-LIB.template.axisName")
    );
    if (!label) return;
    const key = label.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ")
      .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
    const axes = this.actor.system.toObject().axes;
    if (axes.some((a) => a.key === key)) return ui.notifications.warn(game.i18n.localize("ACKS-LIB.template.warn.dupKey"));
    axes.push({ key, label, roll: "", derive: { from: "", max: null }, options: [] });
    await this.actor.update({ "system.axes": axes });
    this.render();
  }

  static async #onDeleteAxis(event, target) {
    const key = target.closest("[data-axis-key]")?.dataset.axisKey;
    const axes = this.actor.system.toObject().axes.filter((a) => a.key !== key);
    await this.actor.update({ "system.axes": axes });
    this.render();
  }

  static async #onAddOption(event, target) {
    const axisKey = target.closest("[data-axis-key]")?.dataset.axisKey;
    const label = await TemplateSheet.#prompt(
      game.i18n.localize("ACKS-LIB.template.addOption"),
      game.i18n.localize("ACKS-LIB.template.optionName")
    );
    if (!label) return;
    const key = label.replace(/[^A-Za-z0-9]+/g, " ").trim().split(" ")
      .map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("");
    const axes = this.actor.system.toObject().axes;
    const axis = axes.find((a) => a.key === axisKey);
    if (!axis) return;
    if (axis.options.some((o) => o.key === key)) return ui.notifications.warn(game.i18n.localize("ACKS-LIB.template.warn.dupKey"));
    axis.options.push({
      key, label, nameLabel: null, rollMin: null, rollMax: null, menuBudget: null,
      art: "", merge: {}, items: [], html: "", flags: {}, token: {},
    });
    await this.actor.update({ "system.axes": axes });
    this.render();
  }

  static async #onDeleteOption(event, target) {
    const row = target.closest("[data-axis-key][data-option-key]");
    if (!row) return;
    const axes = this.actor.system.toObject().axes;
    const axis = axes.find((a) => a.key === row.dataset.axisKey);
    if (!axis) return;
    axis.options = axis.options.filter((o) => o.key !== row.dataset.optionKey);
    await this.actor.update({ "system.axes": axes });
    this.render();
  }

  static async #onGenerate() {
    const sys = this.actor.system;
    if (sys.isStub) return ui.notifications.warn(game.i18n.localize("ACKS-LIB.template.warn.stub"));

    // Values an axis may derive from a dropped base (the thrall's victim HD).
    let base = null;
    const baseValues = {};
    if (this.#baseUuid) {
      base = await fromUuid(this.#baseUuid);
      if (base) {
        const hd = hitDiceOrLevel(base);
        if (hd != null) baseValues.hd = hd;
      }
    }

    const { choices, log } = chooseAxes(sys, { pinned: this.#pins, baseValues });
    const resolved = resolveActor(sys, choices, { baseName: base?.name ?? "", templateName: this.actor.name });

    // STACKING: a dropped base actor SEEDS generation — its full system,
    // items, and flags first, the template's patches layered on top. That is
    // what makes templates compose: generate a Goblin Chieftain, drop it on
    // Vampire Thrall, and the thrall keeps whatever the thrall's own rows do
    // not override.
    if (base) {
      const seeded = base.system.toObject();
      mergePatch(seeded, resolved.system);
      resolved.system = seeded;
      resolved.items = [...base.items.map((i) => i.toObject()), ...resolved.items];
      const baseFlags = foundry.utils.deepClone(base.flags ?? {});
      delete baseFlags.core;
      if (baseFlags[MODULE_ID]) delete baseFlags[MODULE_ID].generated;
      const stackedFlags = baseFlags;
      mergePatch(stackedFlags, resolved.flags ?? {});
      resolved.flags = stackedFlags;
      if (!resolved.art && base.img) resolved.art = base.img;
    }

    // The rolled ability menu: budget printed on the budget axis's chosen row.
    let menuPicks = [];
    if ((sys.menu?.rows ?? []).length) {
      const axis = (sys.axes ?? []).find((a) => a.key === sys.menu.budgetAxis);
      const option = axis?.options?.find((o) => o.key === choices[axis.key]);
      const budget = option?.menuBudget ?? 0;
      menuPicks = rollMenu(sys.menu, budget).picks;
    }

    // Description: the option snippets, then the rolled abilities — each a
    // lazy tag the importer authored; a bookless viewer sees stubs, as ever.
    // A resolved sub-roll ("aura type") rides its ability as a rolled note.
    const htmlParts = [...resolved.htmlParts];
    for (const pick of menuPicks) {
      let part = pick.html || `<p>${pick.label}</p>`;
      if (pick.subResult) {
        const s = pick.subResult;
        part += `<p><em>${s.die}${s.twice ? " ×2" : ""} → ${s.rolls.join(", ")}: ${s.texts.join("; ")}</em></p>`;
      }
      htmlParts.push(part);
    }
    const biography = htmlParts.join("");

    const type = sys.output?.actorType || "monster";
    const system = resolved.system;
    if (biography) {
      system.details = { ...(system.details ?? {}), biography: `${system.details?.biography ?? ""}${biography}` };
    }

    // Actor-level channels from preset options (family variants): sheet-extras
    // flags and prototype-token fragments ride the resolved payload; the
    // provenance flag is ours and always wins its own key.
    const prototypeToken = {
      ...(resolved.art || resolved.tint
        ? { texture: { ...(resolved.art ? { src: resolved.art } : {}), ...(resolved.tint ? { tint: resolved.tint } : {}) } }
        : {}),
      ...(resolved.token ?? {}),
    };
    const created = await Actor.create({
      name: resolved.name || this.actor.name,
      type,
      folder: (await generatedFolder())?.id ?? null,
      ...(resolved.art ? { img: resolved.art } : {}),
      ...(Object.keys(prototypeToken).length ? { prototypeToken } : {}),
      system,
      items: resolved.items,
      flags: {
        ...(resolved.flags ?? {}),
        [MODULE_ID]: {
          ...(resolved.flags?.[MODULE_ID] ?? {}),
          generated: {
            templateUuid: this.actor.uuid,
            choices,
            log,
            menu: menuPicks.map((p) => p.label),
          },
        },
      },
    });
    if (!created) {
      return ui.notifications.warn(game.i18n.localize("ACKS-LIB.template.warn.rejected"));
    }
    ui.notifications.info(game.i18n.format("ACKS-LIB.template.info.generated", { name: created.name }));
    created.sheet?.render(true);
  }
}
