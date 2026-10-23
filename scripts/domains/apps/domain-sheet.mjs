/* global game, ui, foundry, fromUuid, fromUuidSync, Actor, Hooks */
/**
 * DomainSheet — ActorSheetV2 for the `acks-extras.domain` sub-type, in the
 * character sheet's frame as the party sheet takes it. The band — the
 * heraldry, the title before the name, the morale figures — is the window
 * header (lib `moveBandIntoHeader`). One art row stands above every tab: the
 * chips naming the ruler and the liege, the classification and alignment
 * tags, and the rails of the land and of the month (domain-frame.mjs decides
 * them). Under it the six tabs are pills — Overview, Territory, Holdings,
 * Ledger, Realm and Notes — each a part of its own that scrolls at its root,
 * so each keeps its place across the re-render every edit makes.
 *
 * The record is the Judge's: a player who can open the sheet reads it and
 * edits nothing, and the writers that must check every other domain — the
 * liege and the holdings — or that make a document — a vassal row promoted to
 * a domain, a settlement founded — refuse a player's client.
 *
 * Drops are read by what is dropped: a place is held, a domain dropped on the
 * liege chip becomes the liege and anywhere else becomes a vassal, and any
 * other actor becomes the ruler. Items are refused: a domain carries nothing.
 * The two chips also take a picker, for an actor not to hand to drag.
 *
 * The lists are named form rows (`system.territory.0.families`), written whole
 * on submit: `_processFormData` fills each row's unrendered fields from the
 * stored document and turns the index-keyed objects a form submits back into
 * rows before the model cleans them.
 */
import {
  MODULE_ID, LANG_PREFIX, DOMAIN_TYPE, CLASSIFICATIONS, EXPENSE_LINES, HOLDING_ROLES, REVENUE_LINES,
} from "../constants.mjs";
import { ROW_LISTS, rowsOf } from "../domain-logic.mjs";
import { buildDomainFrame, shownFigure } from "../domain-frame.mjs";
import {
  allDomains, familiesOf, foundSettlement, hold, isDomain, ledgerFor, promoteVassal, setLiege, vassalsOf, wouldCycle,
} from "../domains.mjs";
import { keepUnrenderedFields, rowListUpdate } from "../../lib/sheet-rows.mjs";
import { isLocation, isMarkerActor } from "../../lib/place.mjs";
import { atTypeScale, makeLoc } from "../../lib/util.mjs";
import { isGoods } from "../../lib/item-model.mjs";
import { refuseGoods } from "../../lib/bundles.mjs";
import { moveBandIntoHeader } from "../../lib/header-band.mjs";
import { ALIGNMENTS } from "../../lib/vocab.mjs";
import { FACTION_TYPE } from "../../factions/constants.mjs";

const { HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const loc = makeLoc(LANG_PREFIX);
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];
const T = `modules/${MODULE_ID}/templates/domains`;

/** The actor types the ruler picker offers: the system's own people. A drop takes any actor that is not a marker. */
const RULER_TYPES = new Set(["character", "monster"]);

/**
 * The presses a reader keeps on a sheet core has disabled: the tab pills, the
 * rail cells that open a tab, and the names that open another sheet. Each
 * reads; none writes.
 */
const VIEW_ACTIONS = new Set(["tab", "goTab", "openDoc"]);

/** The classes a dialog this sheet opens wears: the design system's, and the scroll contract. */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll"];

const escape = (s) => foundry.utils.escapeHTML(String(s ?? ""));

/** The document a uuid names, or null. Never throws on a uuid into an unloaded compendium. */
function docOf(uuid) {
  try {
    return uuid ? (fromUuidSync(uuid) ?? null) : null;
  } catch {
    return null;
  }
}

/** A `{uuid, name, missing}` reference for a stored uuid, or null for none. */
function refOf(uuid) {
  if (!uuid) return null;
  const doc = docOf(uuid);
  return { uuid, name: doc?.name ?? uuid, missing: !doc };
}

const opt = (value, label, selected) => ({ value, label, selected });

/** Fresh-row templates; the schema's initials fill the rest. */
const ROW_DEFAULTS = {
  territory: () => ({ id: foundry.utils.randomID() }),
  holdings: () => ({ role: "settlement" }),
  structures: () => ({ id: foundry.utils.randomID() }),
  vassalRows: () => ({ id: foundry.utils.randomID() }),
  favors: () => ({ id: foundry.utils.randomID() }),
  duties: () => ({ id: foundry.utils.randomID() }),
  otherRevenue: () => ({ id: foundry.utils.randomID() }),
  otherExpenses: () => ({ id: foundry.utils.randomID() }),
};

/** A modal yes-or-no, resolving true only on yes. */
async function confirm(title, text) {
  const ok = await DialogV2.confirm({
    classes: DIALOG_CLASSES,
    window: { title },
    content: `<p>${escape(text)}</p>`,
    modal: true,
    rejectClose: false,
  });
  return ok === true;
}

/**
 * Ask for one of `options` (`{value, label}`), or null when the dialog is
 * closed. The select is wrapped by its caption, so it is named without an id.
 */
async function pickOne({ title, label, options }) {
  if (!options.length) {
    ui.notifications.info(loc("frame.pickNone"));
    return null;
  }
  const choices = options.map((o) => `<option value="${escape(o.value)}">${escape(o.label)}</option>`).join("");
  const picked = await DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title },
    content: `<label class="acks-extras-domain-sheet__pick">${escape(label)} <select name="choice">${choices}</select></label>`,
    ok: { label: loc("frame.choose"), callback: (_event, button) => button.form.elements.choice.value },
    modal: true,
    rejectClose: false,
  });
  return typeof picked === "string" && picked ? picked : null;
}

export class DomainSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // no-scroll: this sheet scrolls at its tab PART roots, not at
    // `.window-content`. ApplicationV2 restores scroll per part, and a sheet
    // whose fields submit on change re-renders on every edit; the scroller
    // lives in styles/domains.css.
    classes: ["acks-ui", "acks-extras", "acks-extras-domain-sheet"],
    position: { width: 780, height: 720 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      openDoc: DomainSheet.#onOpenDoc,
      goTab: DomainSheet.#onGoTab,
      editHeraldry: DomainSheet.#onEditHeraldry,
      pickRuler: DomainSheet.#onPickRuler,
      clearRuler: DomainSheet.#onClearRuler,
      pickLiege: DomainSheet.#onPickLiege,
      clearLiege: DomainSheet.#onClearLiege,
      rowAdd: DomainSheet.#onRowAdd,
      rowDelete: DomainSheet.#onRowDelete,
      releaseVassal: DomainSheet.#onReleaseVassal,
      promoteVassal: DomainSheet.#onPromoteVassal,
      foundSettlement: DomainSheet.#onFoundSettlement,
    },
  };

  /** The band, the frame, the tab row, then one part per tab, each its own scroller. */
  static PARTS = {
    band: { template: `${T}/domain-band.hbs` },
    frame: { template: `${T}/domain-frame.hbs` },
    tabs: { template: `${T}/domain-tabs.hbs` },
    overview: { template: `${T}/domain-tab-overview.hbs`, scrollable: [""] },
    territory: { template: `${T}/domain-tab-territory.hbs`, scrollable: [""] },
    holdings: { template: `${T}/domain-tab-holdings.hbs`, scrollable: [""] },
    ledger: { template: `${T}/domain-tab-ledger.hbs`, templates: [`${T}/domain-lines.hbs`], scrollable: [""] },
    realm: { template: `${T}/domain-tab-realm.hbs`, templates: [`${T}/domain-bonds.hbs`], scrollable: [""] },
    notes: { template: `${T}/domain-tab-notes.hbs`, scrollable: [""] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", icon: "fa-solid fa-chess-rook" },
        { id: "territory", icon: "fa-solid fa-map" },
        { id: "holdings", icon: "fa-solid fa-city" },
        { id: "ledger", icon: "fa-solid fa-coins" },
        { id: "realm", icon: "fa-solid fa-sitemap" },
        { id: "notes", icon: "fa-solid fa-book" },
      ],
      initial: "overview",
      labelPrefix: `${LANG_PREFIX}.sheet.tab`,
    },
  };

  /**
   * Open at the width for the seat's type size. `DEFAULT_OPTIONS` is
   * evaluated before settings exist, so the scale is applied at construction;
   * core clamps the result to the viewport.
   */
  _initializeApplicationOptions(options) {
    const opts = super._initializeApplicationOptions(options);
    if (opts.position?.width) opts.position.width = atTypeScale(opts.position.width);
    return opts;
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const isGM = game.user.isGM;
    context.actor = actor;
    context.system = sys;
    context.isGM = isGM;
    // The record is the Judge's: a reader with the sheet open edits nothing.
    context.canEdit = this.isEditable && isGM;
    context.lock = context.canEdit ? "" : "disabled";
    context.tabs = this._prepareTabs("primary");
    for (const [id, tab] of Object.entries(context.tabs)) tab.label = loc(`sheet.tab.${id}`);

    // --- who rules it, and under whom -----------------------------------
    context.ruler = refOf(sys.rulerUuid);
    context.liege = refOf(sys.parentUuid);
    context.classificationOptions = [
      opt("", loc("sheet.unclassified"), !sys.classification),
      ...CLASSIFICATIONS.map((k) => opt(k, loc(`classification.${k}`), k === sys.classification)),
    ];
    context.alignmentOptions = [
      opt("", loc("sheet.rulersAlignment"), !sys.alignment),
      ...Object.keys(ALIGNMENTS).map((k) => opt(k, loc(`alignment.${k}`), k === sys.alignment)),
    ];

    // --- the sums ----------------------------------------------------------
    const families = familiesOf(actor);
    const ledger = ledgerFor(actor);
    const partialNote = loc("sheet.partial", { unset: ledger.unset, unknown: ledger.unknown });
    context.families = families;
    context.hexCount = sys.hexCount;
    context.strongholdValue = { ...sys.strongholdValue, shown: shownFigure(sys.strongholdValue.total) };
    context.frame = buildDomainFrame({
      ruler: context.ruler,
      rulerName: sys.rulerName,
      liege: context.liege,
      liegeName: sys.liegeName,
      canEdit: context.canEdit,
      classification: sys.classification,
      alignment: sys.alignment,
      families,
      hexCount: sys.hexCount,
      strongholdValue: sys.strongholdValue,
      ledger,
      partialNote,
    }, loc);

    // --- the land ----------------------------------------------------------
    context.territory = rowsOf(sys.territory).map((row, index) => ({
      ...row,
      index,
      hexLabelsText: (row.hexLabels ?? []).join(", "),
      painted: !!row.map,
      landShown: isGM || row.revealed,
    }));

    // --- what it holds -----------------------------------------------------
    context.holdings = rowsOf(sys.holdings)
      .map((row, index) => {
        const doc = row.uuid ? docOf(row.uuid) : null;
        const market = doc?.system?.market ?? null;
        return {
          ...row,
          index,
          placed: !!row.uuid,
          missing: !!row.uuid && !doc,
          shownName: doc?.name ?? (row.name || loc("sheet.unnamed")),
          placeFamilies: shownFigure(market?.urbanFamilies),
          placeMarketClass: market ? (ROMAN[(doc.system.marketClass ?? 0) - 1] ?? "—") : "—",
          roleOptions: HOLDING_ROLES.map((r) => opt(r, loc(`role.${r}`), r === row.role)),
          marketClassOptions: [opt("", "—", row.marketClass === null), ...ROMAN.map((n, i) => opt(i + 1, n, row.marketClass === i + 1))],
        };
      })
      .filter((row) => isGM || !row.hidden);
    context.structures = rowsOf(sys.structures).map((row, index) => ({ ...row, index }));

    // --- the month -----------------------------------------------------------
    const lineView = (side, keys, amounts) => keys.map((key, i) => ({
      key,
      path: `system.${side}.${key}`,
      label: loc(`line.${key}`),
      line: sys[side][key],
      amount: amounts[i],
      totalShown: shownFigure(amounts[i].total),
    }));
    context.ledger = {
      revenue: lineView("revenue", REVENUE_LINES, ledger.revenue),
      expenses: lineView("expenses", EXPENSE_LINES, ledger.expenses),
      otherRevenue: rowsOf(sys.otherRevenue).map((row, index) => ({ ...row, index })),
      otherExpenses: rowsOf(sys.otherExpenses).map((row, index) => ({ ...row, index })),
      tributeIn: { ...ledger.tributeIn, shown: shownFigure(ledger.tributeIn.total) },
      tributeOwed: ledger.tributeOut.owed,
      revenueShown: shownFigure(ledger.totals.revenue),
      expensesShown: shownFigure(ledger.totals.expenses),
      incomeShown: shownFigure(ledger.totals.income),
      partial: ledger.partial,
      partialNote,
    };

    // --- the realm -----------------------------------------------------------
    context.vassalDomains = vassalsOf(actor).map((d) => {
      const f = familiesOf(d);
      return {
        uuid: d.uuid,
        name: d.name,
        ruler: refOf(d.system.rulerUuid)?.name || d.system.rulerName || "",
        families: f.peasant + f.urban,
        tributeShown: shownFigure(d.system.tributeGp),
      };
    });
    const classChecks = (hexes) => CLASSIFICATIONS.map((k) => ({ key: k, label: loc(`classification.${k}`), checked: (hexes?.classes ?? []).includes(k) }));
    context.vassalRows = rowsOf(sys.vassalRows).map((row, index) => ({
      ...row,
      index,
      domainLabels: (row.domainHexes?.labels ?? []).join(", "),
      realmLabels: (row.realmHexes?.labels ?? []).join(", "),
      domainClasses: classChecks(row.domainHexes),
      realmClasses: classChecks(row.realmHexes),
    }));
    context.favors = rowsOf(sys.favors).map((row, index) => ({ ...row, index }));
    context.duties = rowsOf(sys.duties).map((row, index) => ({ ...row, index }));

    const enrich = (html) => foundry.applications.ux.TextEditor.implementation.enrichHTML(html ?? "", { relativeTo: actor });
    context.notesHTML = await enrich(sys.notes);
    context.gmNotesHTML = isGM ? await enrich(sys.gmNotes) : "";
    return context;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    // Core disables every control of a sheet its reader cannot edit, the
    // pills and the presses that only read among them.
    if (!this.isEditable) {
      for (const button of this.element.querySelectorAll("button[data-action]")) {
        if (VIEW_ACTIONS.has(button.dataset.action)) button.disabled = false;
      }
    }
    try {
      moveBandIntoHeader(this.element);
    } catch (err) {
      console.error(`${MODULE_ID} | domain sheet: band failed`, err);
    }
  }

  /* -------------------------------------------- */
  /*  Form                                         */
  /* -------------------------------------------- */

  /**
   * @override — every list is written whole: a row's unrendered fields keep
   * their stored values, and each submitted list is turned back into rows and
   * normalised before the model cleans it.
   */
  _processFormData(event, form, formData) {
    const data = keepUnrenderedFields(super._processFormData(event, form, formData), this.actor._source);
    if (data.system) {
      for (const [key, normalize] of Object.entries(ROW_LISTS)) {
        if (key in data.system) data.system[key] = rowsOf(data.system[key]).map((row) => normalize(row));
      }
    }
    return data;
  }

  /* -------------------------------------------- */
  /*  Drops                                        */
  /* -------------------------------------------- */

  /** @override — a domain carries nothing; goods are refused in the words every such sheet uses. */
  async _onDropItem(event, item) {
    if (isGoods(item)) refuseGoods(this.actor);
    return null;
  }

  /** @override */
  async _onDropActor(event, actor) {
    if (!actor || actor.uuid === this.actor.uuid || !this.isEditable) return;
    if (!game.user.isGM) {
      ui.notifications.warn(loc("sheet.judgeOnly"));
      return;
    }
    if (isLocation(actor)) return this.#hold(actor);
    if (isDomain(actor)) {
      if (event?.target?.closest?.('[data-drop-zone="liege"]')) return this.#setLiege(this.actor, actor);
      return this.#setLiege(actor, this.actor);
    }
    if (actor.type === FACTION_TYPE) {
      ui.notifications.warn(loc("sheet.notARuler", { name: actor.name }));
      return;
    }
    await this.#setRuler(actor);
  }

  async #setRuler(actor) {
    await this.actor.update({ "system.rulerUuid": actor.uuid, "system.rulerName": actor.name });
    ui.notifications.info(loc("sheet.rulerSet", { name: actor.name }));
  }

  async #hold(place) {
    const result = await hold(this.actor, place);
    if (result.ok) ui.notifications.info(loc("sheet.held", { name: place.name }));
    else if (result.reason === "heldElsewhere") {
      ui.notifications.warn(loc("sheet.heldElsewhere", { name: place.name, other: result.other?.name ?? "" }));
    }
  }

  /** Make `liege` the liege of `vassal`, with the loop refused in words. */
  async #setLiege(vassal, liege) {
    const result = await setLiege(vassal, liege);
    if (result.ok) ui.notifications.info(loc("sheet.liegeSet", { vassal: vassal.name, liege: liege.name }));
    else if (result.reason === "cycle") ui.notifications.warn(loc("sheet.cycle", { vassal: vassal.name, liege: liege.name }));
  }

  /* -------------------------------------------- */
  /*  Actions                                      */
  /* -------------------------------------------- */

  static async #onOpenDoc(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    if (!uuid) return;
    const doc = await fromUuid(uuid).catch(() => null);
    doc?.sheet?.render(true);
  }

  /** A rail cell opens the tab its figure is kept on. */
  static #onGoTab(_event, target) {
    const tab = target.dataset.tab;
    if (tab) this.changeTab(tab, "primary");
  }

  /** The heraldry: the domain's picture, and its token's where the token still wears the old one. */
  static async #onEditHeraldry() {
    const actor = this.actor;
    const FilePickerCls = foundry.applications.apps.FilePicker.implementation;
    await new FilePickerCls({
      type: "image",
      current: actor.img,
      callback: async (path) => {
        const update = { img: path };
        if (actor.prototypeToken?.texture?.src === actor.img) update["prototypeToken.texture.src"] = path;
        await actor.update(update);
      },
    }).browse();
  }

  /** Choose the ruler from the world's people, for one not to hand to drag. */
  static async #onPickRuler() {
    if (!game.user.isGM) return;
    const options = (game.actors?.contents ?? [])
      .filter((a) => RULER_TYPES.has(a.type) && !isMarkerActor(a))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.uuid, label: a.name }));
    const uuid = await pickOne({ title: loc("frame.pickRuler"), label: loc("field.ruler"), options });
    const actor = uuid ? docOf(uuid) : null;
    if (actor) await this.#setRuler(actor);
  }

  static async #onClearRuler() {
    await this.actor.update({ "system.rulerUuid": "" });
  }

  /** Choose the liege from every other domain that would not close a loop. */
  static async #onPickLiege() {
    if (!game.user.isGM) return;
    const actor = this.actor;
    const options = allDomains()
      .filter((d) => d.uuid !== actor.uuid && d.uuid !== actor.system.parentUuid && !wouldCycle(actor, d))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((d) => ({ value: d.uuid, label: d.name }));
    const uuid = await pickOne({ title: loc("frame.pickLiege"), label: loc("field.liege"), options });
    const liege = uuid ? docOf(uuid) : null;
    if (liege) await this.#setLiege(actor, liege);
  }

  static async #onClearLiege() {
    const result = await setLiege(this.actor, null);
    if (result.ok) ui.notifications.info(loc("frame.liegeCleared", { vassal: this.actor.name }));
  }

  /* A row control submits the form first: it writes a whole list from the
   * stored document, so an edit still in flight would be written over. */
  static async #onRowAdd(_event, target) {
    const path = target.dataset.array;
    if (!path || !(path in ROW_DEFAULTS)) return;
    await this.submit();
    const update = rowListUpdate(this.actor.system.toObject(), path, (list) => list.push(ROW_DEFAULTS[path]()));
    if (update) await this.actor.update(update);
  }

  static async #onRowDelete(_event, target) {
    const path = target.dataset.array;
    const index = Number(target.dataset.index);
    if (!path || !(path in ROW_LISTS) || !Number.isInteger(index)) return;
    if (!(await confirm(loc("sheet.removeRowTitle"), loc("sheet.removeRow")))) return;
    await this.submit();
    const update = rowListUpdate(this.actor.system.toObject(), path, (list) => list.splice(index, 1));
    if (update) await this.actor.update(update);
  }

  /** Cut a vassal domain loose: it keeps its record and answers to no liege. */
  static async #onReleaseVassal(_event, target) {
    const uuid = target.closest("[data-uuid]")?.dataset.uuid;
    const vassal = uuid ? await fromUuid(uuid).catch(() => null) : null;
    if (isDomain(vassal)) await setLiege(vassal, null);
  }

  /** Make a vassal row a domain of its own, answering to this one; the row goes. */
  static async #onPromoteVassal(_event, target) {
    if (!game.user.isGM) return;
    const rowId = target.closest("[data-row-id]")?.dataset.rowId;
    const row = rowsOf(this.actor.system.vassalRows).find((r) => r.id === rowId);
    if (!row) return;
    const name = row.name || loc("sheet.unnamed");
    if (!(await confirm(loc("frame.promoteTitle"), loc("frame.promoteConfirm", { name })))) return;
    await this.submit();
    const result = await promoteVassal(this.actor, rowId, { label: (key) => loc(key) });
    if (result.ok) ui.notifications.info(loc("frame.promoted", { name: result.domain.name }));
  }

  /** Found a settlement: a world location with a market, held here at once, its sheet opened for its families. */
  static async #onFoundSettlement() {
    if (!game.user.isGM) return;
    const name = await DialogV2.prompt({
      classes: DIALOG_CLASSES,
      window: { title: loc("frame.foundTitle") },
      content: `<label class="acks-extras-domain-sheet__pick">${escape(loc("field.name"))} <input type="text" name="settlement" value="${escape(loc("sheet.newSettlement"))}"></label>`,
      ok: { label: loc("frame.found"), callback: (_event, button) => button.form.elements.settlement.value.trim() || loc("sheet.newSettlement") },
      modal: true,
      rejectClose: false,
    });
    if (typeof name !== "string" || !name) return;
    const result = await foundSettlement(this.actor, { name });
    if (result.ok) {
      ui.notifications.info(loc("frame.founded", { name: result.place.name }));
      result.place.sheet?.render(true);
    } else if (result.reason === "heldElsewhere") {
      ui.notifications.warn(loc("sheet.heldElsewhere", { name: result.place?.name ?? name, other: result.other?.name ?? "" }));
    }
  }
}

/** Register the sheet as the default for the domain sub-type (called from init). */
export function registerDomainSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, DomainSheet, {
    types: [DOMAIN_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.name`,
  });
}

/**
 * Re-render the open domain sheets when an actor they read changes. Core
 * re-renders a sheet for its own document only, and a domain's sheet reads
 * others: every other domain (its vassals, its liege, the liege picker), the
 * places (a held settlement's families and market class, a held place
 * deleted) and its ruler. Renders are gathered and run once per burst of
 * changes. Called from init.
 */
export function registerDomainSheetRefresh() {
  const pending = new Set();
  const flush = foundry.utils.debounce(() => {
    for (const app of pending) if (app.rendered) app.render();
    pending.clear();
  }, 100);
  const reads = (sheetActor, actor) => isDomain(actor) || isLocation(actor) || sheetActor?.system?.rulerUuid === actor.uuid;
  const changed = (actor) => {
    if (!actor) return;
    for (const app of foundry.applications.instances.values()) {
      if (!(app instanceof DomainSheet) || !app.rendered || app.actor === actor) continue;
      if (reads(app.actor, actor)) pending.add(app);
    }
    if (pending.size) flush();
  };
  Hooks.on("updateActor", changed);
  Hooks.on("deleteActor", changed);
  Hooks.on("createActor", (actor) => {
    if (isDomain(actor)) changed(actor);
  });
}
