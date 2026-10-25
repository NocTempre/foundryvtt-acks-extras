/* global game, foundry, document, CSS, Hooks */
import { MODULE_ID, PANEL_FLAG } from "./constants.mjs";
import { SHARED_ACTIONS, bindMemberDrop, onChangeForm } from "./formation-actions.mjs";
import { cellBodies, getFormations, getMemberActor, isStackMember, memberHp, partyHeadcount, realMembers } from "./formation-model.mjs";
import { buildFormationView, buildGMExtras, buildPlayerPanel } from "./formation-view.mjs";
import { MODE_TEMPLATES, TAB_IDS, buildFrameView, framePartIds, frameTabs } from "./frame-view.mjs";
import { drawPlate } from "./plate.mjs";
import { travelOf } from "./travel.mjs";
import { acksCompatStubs } from "../lib/actor-compat.mjs";
import { refuseGoods } from "../lib/bundles.mjs";
import { isPick, readPicks, restorePicks } from "../lib/picks.mjs";
import { atTypeScale } from "../lib/util.mjs";
import { clockReading } from "../lib/world-time.mjs";

/**
 * The dedicated "party" actor sub-type backing party tokens, and its sheet.
 * The sheet is the one formation UI: GM-only controls are absent from a
 * player's seat, and member-owning players get a declaration panel.
 */

export const PARTY_TYPE = `${MODULE_ID}.party`;

/**
 * A party actor holds almost NO data of its own — the formation record does.
 * Its schema is the compatibility stub every non-character sub-type needs so
 * the acks system's unguarded per-actor compute (isNew, attack, initiative,
 * movement, saves) does not error on it. That set has one home
 * now: acks-lib's acksCompatStubs().
 *
 * A party does not save on its own — rollPartySave reads each MEMBER's saves —
 * so the stub carries no saves of its own beyond the compat set.
 *
 * Movement is re-declared for two party-specific reasons the shared stub can't
 * carry: `base` defaults to a human's 120 (synced from members on the first
 * formation sync), where the stub's 0 is right for a settlement/domain; and
 * `value` holds the "N'/turn (exploration)" label formation-model.mjs writes.
 * `mod` is deliberately absent — the system only reads movement.mod in
 * _calculateMovement, which runs off computeEncumbrance, which bails on
 * type !== "character" (actor.mjs), so a party never touches it: dead field,
 * not carried.
 *
 * `description` is the party's own prose, the one field the sheet writes to
 * the actor: it reads in the frame's reading column and is edited there.
 */
export class PartyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const { HTMLField, NumberField, SchemaField, StringField } = foundry.data.fields;
    return {
      ...acksCompatStubs(),
      movement: new SchemaField({
        base: new NumberField({ required: true, integer: true, initial: 120 }),
        value: new StringField({ required: true, blank: true, initial: "" }),
        encounter: new NumberField({ required: true, integer: true, initial: 0 }),
      }),
      description: new HTMLField({ required: true, blank: true }),
    };
  }
}

/** The formation record backed by a given party actor. */
export function formationForActor(actor) {
  if (!actor) return null;
  return Object.values(getFormations()).find((f) => f.actorId === actor.id) ?? null;
}

const { HandlebarsApplicationMixin } = foundry.applications.api;

const T = `modules/${MODULE_ID}/templates/formation`;

/**
 * Actions that only LOOK — switch a tab, jump to one from a figure, hide the
 * panel, open the Key — and so stay live on a sheet the viewer cannot edit.
 * DocumentSheetV2 disables every form control on a read-only sheet; these are
 * re-enabled after it does.
 */
const VIEW_ACTIONS = new Set(["tab", "goTab", "togglePanel", "toggleKey"]);

const enrich = (html, actor) =>
  foundry.applications.ux.TextEditor.implementation.enrichHTML(html, { relativeTo: actor, secrets: actor.isOwner });

/** The world clock as HH:MM, or "" where the world keeps no calendar. */
function clockTime() {
  const reading = clockReading();
  if (!reading) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(reading.hour)}:${pad(reading.minute)}`;
}

/**
 * What a stack calls itself: its own collective noun, else the default for the
 * kind of unit it is. The marching order says the same word the group sheet
 * says, so "40 mercenaries" in the party window is "40 mercenaries" on the sheet
 * that edits them — one concept, one vocabulary.
 */
function stackNoun(actor) {
  const own = actor?.system?.noun;
  if (own) return own;
  const key = `ACKS-LIB.group.noun.${actor?.system?.unit?.category || "monster"}`;
  return game.i18n.has(key) ? game.i18n.localize(key) : "";
}

/**
 * The marching-order rows whose occupant is a stack, by actor id: how many
 * bodies it stands for and what it calls them.
 */
function stackRows(formation) {
  const rows = new Map();
  for (const member of formation.members ?? []) {
    if (!member?.actorId || !isStackMember(member)) continue;
    rows.set(member.actorId, { bodies: cellBodies(member), noun: stackNoun(getMemberActor(member)) });
  }
  return rows;
}

/**
 * The party actor's sheet. It reads the formation record rather than the
 * actor, which carries almost no state of its own, and takes the character
 * sheet's shape: the band (crest, mode, name, the day's or the rest's bar) is
 * the window header; one art row of rails around the party's plate stands
 * above every tab; and the tabs are named by the mode — Dungeon, Wilderness or
 * City; Order, Train or Company; Kit; Sightings; and the Judge's own tab on a
 * GM seat only. Each tab carries its own actions at its head. The decisions
 * are frame-view.mjs's; this class binds them to Foundry.
 *
 * The band renders as a part and is then MOVED into Foundry's `.window-header`,
 * as the character sheet does it, so the header stays the drag handle and keeps
 * its buttons while the band's name field and mode select live in the form.
 * Every part renders inside the one form, so an inactive or hidden tab's inputs
 * are still in the DOM and still submit — switching tabs never drops an edit.
 */
export class PartySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // no-scroll: this sheet scrolls at its tab PART roots, not at
    // `.window-content`. The shared contract would move the scroller onto
    // `.window-content`, which is not a part — and ApplicationV2 restores
    // scroll per part, so the tabs' `scrollable: [""]` below would stop
    // working on a sheet whose fields submit on every change. The scroller
    // lives in styles/formation.css, "The frame".
    classes: ["acks-ui", "acks-extras", "acks-extras-party-sheet", "party-sheet"],
    position: { width: 920, height: "auto" },
    tag: "form",
    window: { resizable: true, contentClasses: ["acks-extras-party-sheet__content"] },
    // Replace the document sheet's submit pipeline: form inputs configure the
    // FORMATION record (rename, mode, the travel fields); the description, the
    // one actor field, is routed by the same handler.
    form: { submitOnChange: true, closeOnSubmit: false, handler: PartySheet.#onSubmit },
    actions: {
      ...SHARED_ACTIONS,
      goTab: PartySheet.#onGoTab,
      togglePanel: PartySheet.#onTogglePanel,
      toggleKey: PartySheet.#onToggleKey,
      toggleMagical: PartySheet.#onToggleMagical,
      editDescription: PartySheet.#onEditDescription,
      ownership: PartySheet.#onOwnership,
    },
  };

  /**
   * The band, the frame (the art row, the Key, the warnings), the tab row, and
   * one part per tab. `_configureRenderParts` drops what a seat or a formation
   * does not have and picks the mode tab's template.
   */
  static PARTS = {
    band: { template: `${T}/formation-band.hbs` },
    frame: { template: `${T}/formation-frame.hbs`, templates: [`${T}/formation-cell.hbs`, `${T}/formation-plate.hbs`] },
    tabs: { template: `${T}/formation-tabs.hbs` },
    mode: {
      template: `${T}/${MODE_TEMPLATES.journey}`,
      templates: [
        `${T}/formation-strip.hbs`, `${T}/formation-player-actions.hbs`, `${T}/formation-country.hbs`, `${T}/formation-country-card.hbs`,
      ],
      scrollable: [""],
    },
    order: { template: `${T}/formation-tab-order.hbs`, scrollable: [""] },
    kit: { template: `${T}/formation-tab-kit.hbs`, scrollable: [""] },
    sightings: { template: `${T}/formation-tab-sightings.hbs`, scrollable: [""] },
    judge: {
      template: `${T}/formation-tab-judge.hbs`,
      templates: [`${T}/formation-plate.hbs`, `${T}/formation-country.hbs`, `${T}/formation-country-card.hbs`],
      scrollable: [""],
    },
  };

  static TABS = {
    primary: { tabs: TAB_IDS.map((id) => ({ id })), initial: "mode" },
  };

  tabGroups = { primary: "mode" };

  /**
   * Open at the canvas width for the seat's type size. `DEFAULT_OPTIONS` is
   * evaluated before settings exist, so the scale is applied here at
   * construction instead; core clamps the result to the viewport. `min-width`
   * does not follow (styles/formation.css, "The frame").
   */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    return opts;
  }

  /** Sheet-local state that survives the re-render every form change causes. */
  #ui = { keyOpen: false, magical: true, editing: false };

  /** Hook ids for the watch on the members' hit points, which the figures rail reads. */
  #watch = [];

  /** The debounced re-render the watch calls, made at first render. */
  #renderSoon = null;

  /** Re-render all open party sheets (called on any formation change). */
  static refreshAll() {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof PartySheet && app.rendered) app.render();
    }
  }

  get formation() {
    return formationForActor(this.actor);
  }

  /**
   * The sheet's form is interactive for the GM and for any player who owns a
   * MEMBER of the formation — decoupled from ownership of the party actor
   * itself. Foundry force-disables every control in the window when a sheet is
   * not editable (DocumentSheetV2#_toggleDisabled), which would grey out a
   * member-owner's own reorder/role/light controls just because the party
   * actor grants them only Observer. Per-control gating (`canControl` in the
   * view) remains the authority over WHICH controls each user may touch; this
   * getter only decides whether the window is live at all.
   */
  get isEditable() {
    if (super.isEditable) return true;
    const formation = this.formation;
    if (!formation) return false;
    return formation.members.some((m) => {
      const actor = m?.actorId ? game.actors.get(m.actorId) : null;
      return actor?.testUserPermission(game.user, "OWNER") ?? false;
    });
  }

  /** Is the panel under the tab row hidden for the viewing user? */
  get panelHidden() {
    return !!game.user.getFlag(MODULE_ID, PANEL_FLAG)?.[this.actor.id];
  }

  /** Whether a party save is against a magical source: the saves rail's toggle, on until turned off. */
  get magical() {
    return this.#ui.magical;
  }

  /** @override */
  async _onFirstRender(context, options) {
    await super._onFirstRender(context, options);
    this.#renderSoon ??= foundry.utils.debounce(() => {
      if (this.rendered) this.render();
    }, 60);
    // The primary GM's formation refresh does not reach other seats when only a
    // member's hit points move, and the hurt figure reads them.
    const isMember = (actorId) => !!actorId && (this.formation?.members ?? []).some((m) => m?.actorId === actorId);
    const onActor = (actor, changes) => {
      if (isMember(actor?.id) && foundry.utils.hasProperty(changes, "system.hp")) this.#renderSoon();
    };
    const onToken = (token, changes) => {
      if (isMember(token?.actorId) && foundry.utils.hasProperty(changes, "delta.system.hp")) this.#renderSoon();
    };
    this.#watch = [
      ["updateActor", Hooks.on("updateActor", onActor)],
      ["updateToken", Hooks.on("updateToken", onToken)],
    ];
  }

  /** @override */
  async _onClose(options) {
    for (const [hook, id] of this.#watch) Hooks.off(hook, id);
    this.#watch = [];
    await super._onClose(options);
  }

  /**
   * The parts this seat renders (`framePartIds`): a player's list never holds
   * `judge`, so nothing Judge-only reaches a player's DOM. The mode tab's
   * template follows the formation's travel mode.
   */
  _configureRenderParts(options) {
    const parts = super._configureRenderParts(options);
    const formation = this.formation;
    const keep = new Set(framePartIds({ isGM: game.user.isGM, hasFormation: !!formation }));
    for (const id of Object.keys(parts)) if (!keep.has(id)) delete parts[id];
    if (parts.mode) parts.mode.template = `${T}/${MODE_TEMPLATES[travelOf(formation).mode] ?? MODE_TEMPLATES.delve}`;
    return parts;
  }

  /**
   * The tab row follows the parts: labels by mode, Judge on a GM seat only.
   * The active tab is remembered per instance, so one that is not on this
   * row falls back to the first rather than leaving every panel inactive.
   */
  _prepareTabs(group) {
    if (group !== "primary") return super._prepareTabs(group);
    const formation = this.formation;
    const tabs = frameTabs({ mode: formation ? travelOf(formation).mode : "delve", isGM: game.user.isGM });
    if (!tabs.some((t) => t.id === this.tabGroups.primary)) this.tabGroups.primary = tabs[0].id;
    return Object.fromEntries(
      tabs.map((tab) => {
        const active = tab.id === this.tabGroups.primary;
        return [tab.id, { ...tab, group, active, cssClass: [tab.cssClass, active ? "active" : ""].filter(Boolean).join(" ") }];
      }),
    );
  }

  /** A pill pressed while the panel is hidden opens the panel on that tab. */
  _onClickTab(event) {
    const tab = event.target?.dataset?.tab;
    if (tab && this.panelHidden) {
      this.#showTab(tab);
      return;
    }
    super._onClickTab(event);
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const formation = this.formation;
    const isGM = game.user.isGM;
    context.isGM = isGM;
    context.formation = formation;
    context.partyName = this.actor.name;
    context.panelHidden = this.panelHidden;
    if (!formation) return context;
    Object.assign(context, buildFormationView(formation));
    if (isGM) Object.assign(context, buildGMExtras(formation));
    else Object.assign(context, buildPlayerPanel(formation));

    // An occupant may stand for a crowd, so the party is counted in BODIES and
    // the rows that hold a stack say how many. The count is the group actor's
    // own headcount — it is never tracked a second time here.
    const stacks = stackRows(formation);
    context.headcount = partyHeadcount(formation);
    for (const row of context.members ?? []) {
      const stack = row?.actorId ? stacks.get(row.actorId) : null;
      if (stack) row.stack = stack;
    }

    const source = String(this.actor.system?.description ?? "");
    const editing = isGM && this.#ui.editing;
    context.description = { source, html: source ? await enrich(source, this.actor) : "", editing };
    context.frame = buildFrameView({
      view: context,
      isGM,
      headcount: context.headcount,
      hitPoints: realMembers(formation).map((member) => memberHp(member)),
      clockTime: clockTime(),
      magical: this.#ui.magical,
      keyOpen: this.#ui.keyOpen,
      editing,
      panelHidden: context.panelHidden,
    });
    return context;
  }

  /**
   * Say what a stacked row stands for, and point at where it is edited.
   *
   * The badge carries the `openSheet` action, so the one route to a stack's
   * headcount and its casualties is the group's own sheet — the formation never
   * grows a second way to do the same thing. Attached after render and skipped
   * where a badge already exists, so row markup that renders one itself wins.
   */
  #markStacks(context) {
    for (const row of context.members ?? []) {
      if (!row?.stack || !this.element) continue;
      const cell = this.element.querySelector(`li.member[data-actor-id="${CSS.escape(row.actorId)}"]`);
      if (!cell || cell.querySelector(".acks-extras-stack-badge")) continue;
      cell.classList.add("acks-extras-stacked");
      const badge = document.createElement("button");
      badge.type = "button";
      badge.className = "acks-extras-stack-badge";
      badge.dataset.action = "openSheet";
      badge.textContent = row.stack.noun ? `${row.stack.bodies} ${row.stack.noun}` : `×${row.stack.bodies}`;
      const hint = "ACKS-FORMATION.app.stackHint";
      if (game.i18n.has(hint)) badge.dataset.tooltip = game.i18n.localize(hint);
      (cell.querySelector(".info .name") ?? cell).append(badge);
    }
  }

  /**
   * @override — a party carries nothing itself; its members do. The GM's
   * seat refuses an item in the member drop (`bindMemberDrop`), which
   * replaces the base class's on this element. Every other seat reaches this,
   * where the base class would create a copy on the party actor.
   */
  async _onDropItem(_event, _item) {
    refuseGoods(this.actor);
    return null;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    this.element.classList.toggle("is-panel-hidden", !!context.panelHidden);
    if (!this.isEditable) {
      for (const button of this.element.querySelectorAll("button[data-action]")) {
        if (VIEW_ACTIONS.has(button.dataset.action)) button.disabled = false;
      }
    }
    const steps = [
      ["band", () => this.#moveBandIntoHeader()],
      ["parts", () => this.#dropStaleParts()],
      ["drop", () => bindMemberDrop(this)],
      ["stacks", () => this.#markStacks(context)],
      ["plates", () => this.#paintPlates(context)],
    ];
    for (const [what, step] of steps) {
      try {
        step();
      } catch (err) {
        console.error(`${MODULE_ID} | party sheet: ${what} failed`, err);
      }
    }
  }

  /**
   * The band is the window header. Each render appends a fresh band to the
   * content (the last one left it), so the stale copy in the header is removed
   * and the new one moved in before the header's controls. A press on the
   * band's own controls stops at the band; anywhere else it falls through to
   * the header and drags the window.
   */
  #moveBandIntoHeader() {
    const header = this.element.querySelector(":scope > .window-header");
    const bands = [...this.element.querySelectorAll('[data-application-part="band"]')];
    const band = bands.find((b) => b.parentElement !== header) ?? bands[0];
    if (!header || !band) return;
    for (const stale of bands) if (stale !== band) stale.remove();
    const controls = header.querySelector("button[data-action=toggleControls]");
    if (band.parentElement !== header) header.insertBefore(band, controls ?? null);
    if (!band.dataset.guarded) {
      band.dataset.guarded = "1";
      for (const type of ["pointerdown", "dblclick"]) {
        band.addEventListener(type, (ev) => {
          if (ev.target.closest("input, button, a, select, textarea, label")) ev.stopPropagation();
        });
      }
    }
  }

  /**
   * Paint every plate canvas the render drew (`drawPlate`). A canvas names its
   * plate (`data-plate-kind`): the frame's, the Judge's true and believed
   * ones, or the preview of a player's; the context holds what each paints.
   */
  #paintPlates(context) {
    const judge = context.travel?.judge;
    const specs = {
      frame: context.frame?.plate,
      true: judge?.where?.truth,
      believed: judge?.where?.belief,
      preview: judge?.preview?.plate,
    };
    for (const canvasEl of this.element.querySelectorAll("canvas.acks-extras-plate__canvas")) {
      const spec = specs[canvasEl.dataset.plateKind];
      if (spec?.draw) drawPlate(canvasEl, spec);
    }
  }

  /** @override — a staging pick's value is read off the part being replaced (lib/picks.mjs). */
  _preSyncPartState(partId, newElement, priorElement, state) {
    super._preSyncPartState(partId, newElement, priorElement, state);
    state.picks = readPicks(priorElement);
  }

  /** @override — and written into its replacement, so a redraw keeps the member or spell picked. */
  _syncPartState(partId, newElement, priorElement, state) {
    super._syncPartState(partId, newElement, priorElement, state);
    restorePicks(newElement, state.picks);
  }

  /**
   * Remove a part this render did not configure. Core replaces the parts it
   * renders and appends new ones, but never removes one that left the list, so
   * a sheet whose formation went away would otherwise keep its tab row.
   */
  #dropStaleParts() {
    const keep = new Set(framePartIds({ isGM: game.user.isGM, hasFormation: !!this.formation }));
    for (const part of this.element.querySelectorAll(".window-content > [data-application-part]")) {
      if (!keep.has(part.dataset.applicationPart)) part.remove();
    }
  }

  /** Make `tab` the active tab, and show the panel if this viewer had hidden it. */
  async #showTab(tab) {
    if (!tab || !this.element?.querySelector(`.tabs [data-group="primary"][data-tab="${CSS.escape(tab)}"]`)) return;
    this.changeTab(tab, "primary", { force: true });
    if (this.panelHidden) await this.#setPanelHidden(false);
  }

  /**
   * Hide or show the panel for this viewer, then let the window take its height
   * from what is left. The flag is written as an explicit true or false per
   * actor: `setFlag` MERGES an object, so a key deleted from a copy would
   * survive the write.
   */
  async #setPanelHidden(hidden) {
    await game.user.setFlag(MODULE_ID, PANEL_FLAG, { [this.actor.id]: hidden });
    await this.render();
    if (this.rendered) this.setPosition({ height: "auto" });
  }

  /* -------------------------------------------- */
  /*  Actions — the frame                          */
  /* -------------------------------------------- */

  /**
   * The form's submit: the formation's own handler, and the description editor
   * closed once a submit has carried its field. A change to a staging pick is
   * no submit, refused before the closing below: core submits on every
   * control's change, and the travel write and redraw would put the pick back
   * on its first option and close an open description editor.
   */
  static async #onSubmit(event, form, formData) {
    if (isPick(event?.target)) return;
    const closing = this.#ui.editing && "system.description" in (formData?.object ?? {});
    if (closing) this.#ui.editing = false;
    await onChangeForm.call(this, event, form, formData);
    if (closing) this.render();
  }

  static #onGoTab(event, target) {
    this.#showTab(target.dataset.tab);
  }

  static async #onTogglePanel() {
    await this.#setPanelHidden(!this.panelHidden);
  }

  static #onToggleKey() {
    this.#ui.keyOpen = !this.#ui.keyOpen;
    this.render();
  }

  static #onToggleMagical() {
    if (!game.user.isGM) return;
    this.#ui.magical = !this.#ui.magical;
    this.render();
  }

  static #onEditDescription() {
    if (!game.user.isGM) return;
    this.#ui.editing = !this.#ui.editing;
    this.render();
  }

  static #onOwnership() {
    if (!game.user.isGM) return;
    const Config = foundry.applications.apps.DocumentOwnershipConfig;
    if (Config) new Config({ document: this.actor }).render(true);
  }
}
