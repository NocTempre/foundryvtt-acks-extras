/* global game, ui, foundry, fromUuid, fromUuidSync, Actor, Hooks */
/**
 * DomainSheet — ActorSheetV2 for the `acks-extras.domain` sub-type.
 *
 * A plain working form over the whole record: every field the record holds
 * is editable here, every list takes rows added and removed, and the sums are
 * read off `domain-logic.mjs` beside the figures they sum. Six tabs —
 * Overview (who rules it, under whom, its morale), Territory, Holdings (the
 * places held and the stronghold's structures), Ledger, Realm (the vassals,
 * the favors and the duties) and Notes.
 *
 * The record is the Judge's: a player who can open the sheet reads it and
 * edits nothing, and the two writers that must check every other domain —
 * the liege and the holdings — refuse a player's client.
 *
 * Drops are read by what is dropped: a place is held, a domain dropped on the
 * liege row becomes the liege and anywhere else becomes a vassal, and any
 * other actor becomes the ruler. Items are refused: a domain carries nothing.
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
import {
  allDomains, familiesOf, hold, isDomain, ledgerFor, setLiege, vassalsOf, wouldCycle,
} from "../domains.mjs";
import { keepUnrenderedFields, rowListUpdate } from "../../lib/sheet-rows.mjs";
import { isLocation } from "../../lib/place.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { isGoods } from "../../lib/item-model.mjs";
import { refuseGoods } from "../../lib/bundles.mjs";
import { ALIGNMENTS } from "../../lib/vocab.mjs";
import { FACTION_TYPE } from "../../factions/constants.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const loc = makeLoc(LANG_PREFIX);
const ROMAN = ["I", "II", "III", "IV", "V", "VI"];

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

/** A figure as the sheet shows it: the number, or a dash for none. */
const shown = (n) => (n === null || n === undefined || !Number.isFinite(Number(n)) ? "—" : String(Math.round(Number(n) * 100) / 100));

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

export class DomainSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // no-scroll: this sheet scrolls at its body PART root, not at
    // `.window-content`. ApplicationV2 restores scroll per part, and a sheet
    // whose fields submit on change re-renders on every edit; the scroller
    // lives in styles/domains.css.
    classes: ["acks-ui", "acks-extras", "acks-extras-domain-sheet"],
    position: { width: 720, height: 680 },
    window: { resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      openDoc: DomainSheet.#onOpenDoc,
      clearRuler: DomainSheet.#onClearRuler,
      rowAdd: DomainSheet.#onRowAdd,
      rowDelete: DomainSheet.#onRowDelete,
      releaseVassal: DomainSheet.#onReleaseVassal,
    },
  };

  static PARTS = {
    header: { template: `modules/${MODULE_ID}/templates/domains/domain-header.hbs` },
    body: { template: `modules/${MODULE_ID}/templates/domains/domain-body.hbs`, scrollable: [""] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "overview", icon: "fas fa-chess-rook" },
        { id: "territory", icon: "fas fa-map" },
        { id: "holdings", icon: "fas fa-city" },
        { id: "ledger", icon: "fas fa-coins" },
        { id: "realm", icon: "fas fa-sitemap" },
        { id: "notes", icon: "fas fa-book" },
      ],
      initial: "overview",
      labelPrefix: `${LANG_PREFIX}.sheet.tab`,
    },
  };

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
    // The liege picker offers every other domain that would not close a loop.
    // It is a named field, so it always carries the stored value among its
    // options, or the next submit-on-change would write the liege away.
    const domains = allDomains();
    context.liegeOptions = [
      opt("", loc("sheet.none"), !sys.parentUuid),
      ...domains
        .filter((d) => d.uuid !== actor.uuid && (d.uuid === sys.parentUuid || !wouldCycle(actor, d)))
        .map((d) => opt(d.uuid, d.name, d.uuid === sys.parentUuid)),
    ];
    if (sys.parentUuid && !domains.some((d) => d.uuid === sys.parentUuid)) {
      context.liegeOptions.push(opt(sys.parentUuid, context.liege.name, true));
    }
    context.classificationOptions = [
      opt("", loc("sheet.unclassified"), !sys.classification),
      ...CLASSIFICATIONS.map((k) => opt(k, loc(`classification.${k}`), k === sys.classification)),
    ];
    context.classificationLabel = sys.classification ? loc(`classification.${sys.classification}`) : "";
    context.alignmentOptions = [
      opt("", loc("sheet.rulersAlignment"), !sys.alignment),
      ...Object.keys(ALIGNMENTS).map((k) => opt(k, loc(`alignment.${k}`), k === sys.alignment)),
    ];

    // --- the sums ----------------------------------------------------------
    const families = familiesOf(actor);
    context.families = families;
    context.hexCount = sys.hexCount;
    context.strongholdValue = { ...sys.strongholdValue, shown: shown(sys.strongholdValue.total) };

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
          placeFamilies: shown(market?.urbanFamilies),
          placeMarketClass: market ? (ROMAN[(doc.system.marketClass ?? 0) - 1] ?? "—") : "—",
          roleOptions: HOLDING_ROLES.map((r) => opt(r, loc(`role.${r}`), r === row.role)),
          roleLabel: loc(`role.${row.role}`),
          marketClassOptions: [opt("", "—", row.marketClass === null), ...ROMAN.map((n, i) => opt(i + 1, n, row.marketClass === i + 1))],
        };
      })
      .filter((row) => isGM || !row.hidden);
    context.structures = rowsOf(sys.structures).map((row, index) => ({ ...row, index }));

    // --- the month -----------------------------------------------------------
    const ledger = ledgerFor(actor);
    const lineView = (side, keys, amounts) => keys.map((key, i) => ({
      key,
      path: `system.${side}.${key}`,
      label: loc(`line.${key}`),
      line: sys[side][key],
      amount: amounts[i],
      peasantShown: shown(amounts[i].peasant),
      urbanShown: shown(amounts[i].urban),
      totalShown: shown(amounts[i].total),
    }));
    context.ledger = {
      revenue: lineView("revenue", REVENUE_LINES, ledger.revenue),
      expenses: lineView("expenses", EXPENSE_LINES, ledger.expenses),
      otherRevenue: rowsOf(sys.otherRevenue).map((row, index) => ({ ...row, index })),
      otherExpenses: rowsOf(sys.otherExpenses).map((row, index) => ({ ...row, index })),
      tributeIn: { ...ledger.tributeIn, shown: shown(ledger.tributeIn.total) },
      tributeOwed: ledger.tributeOut.owed,
      revenueShown: shown(ledger.totals.revenue),
      expensesShown: shown(ledger.totals.expenses),
      incomeShown: shown(ledger.totals.income),
      partial: ledger.partial,
      partialNote: loc("sheet.partial", { unset: ledger.unset, unknown: ledger.unknown }),
    };

    // --- the realm -----------------------------------------------------------
    context.vassalDomains = vassalsOf(actor).map((d) => {
      const f = familiesOf(d);
      return {
        uuid: d.uuid,
        name: d.name,
        ruler: refOf(d.system.rulerUuid)?.name || d.system.rulerName || "",
        families: f.peasant + f.urban,
        tributeShown: shown(d.system.tributeGp),
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

  static async #onClearRuler() {
    await this.actor.update({ "system.rulerUuid": "" });
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
    const ok = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("sheet.removeRowTitle") },
      content: `<p>${foundry.utils.escapeHTML(loc("sheet.removeRow"))}</p>`,
      modal: true,
      rejectClose: false,
    });
    if (ok !== true) return;
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
