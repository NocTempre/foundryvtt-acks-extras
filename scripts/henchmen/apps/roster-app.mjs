/* global game, ui, foundry, Hooks, fromUuid */
/**
 * RosterApp — an employer's merged hireling roster on the lib frame's band:
 * core's henchmen list plus this module's monster-henchman list, under the
 * henchman-limit meter and the wage rule, filtered by bucket, a row per
 * hireling with its effective scores and its controls (loyalty and obedience
 * throws, a calamity, a wound or tampering penalty, transfer, dismissal), the
 * row's record under it when opened, and a drop zone that enrols a character
 * with no hire behind them. The row readings are `rules/service.mjs`.
 */
import { MODULE_ID, FLAG_RECORD, FLAG_MONSTER_LIST, HOOKS } from "../constants.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import { checkHenchmanLimit, enrollHenchman } from "../engine/hire.mjs";
import { unvaluedPowers } from "../effects.mjs";
import {
  openLoyaltyRoll,
  openObedienceRoll,
  recordCalamity,
  payWagesFor,
  effectiveLoyaltyFor,
  effectiveMoraleFor,
  employerLoyaltyMods,
  addLoyaltyPermanent,
  setPermanentCompensated,
  syncLoyalty,
  wageBill,
} from "../engine/events.mjs";
import { WOUND_PENALTIES, penaltyReason } from "../rules/loyalty.mjs";
import { ROSTER_FILTERS, bucketOf, keepsLoyalty, loyaltyParts, slotOf, filterRows, filterCounts } from "../rules/service.mjs";
import { ledgerRows, eventRows, termsFor, clockFor, clockLine } from "../service-view.mjs";
import * as adapter from "../acks-adapter.mjs";
import { dateLabel } from "../time.mjs";
import { FRAME_CLASS } from "../../lib/frame.mjs";
import { moveBandIntoHeader } from "../../lib/header-band.mjs";
import { signed, clampPct } from "../../lib/frame-model.mjs";
import { classLevel, monsterHd } from "../../lib/actor-read.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";
import { makeLoc } from "../../lib/util.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/** The lang root of the roster's strings. */
export const ROSTER_LANG_PREFIX = "ACKS-HENCHMEN.roster";
const loc = makeLoc(ROSTER_LANG_PREFIX);

/** How many events an open row lists, newest first. */
const ROW_EVENTS = 8;

export class RosterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ employer, ...options } = {}) {
    super(options);
    this.employer = employer;
    this.#hookId = Hooks.on(HOOKS.ROSTER_CHANGED, ({ employer: changed }) => {
      if (changed?.id === this.employer.id) this.render();
    });
  }

  #hookId;

  /** View state that outlives a render: the bucket filter and the rows whose record is open. */
  #ui = { filter: "all", open: new Set() };

  static DEFAULT_OPTIONS = {
    id: "acks-henchmen-roster-{id}",
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll", FRAME_CLASS, "roster-app", "acks-extras-roster-app"],
    position: { width: 760, height: "auto" },
    window: { resizable: true },
    actions: {
      filter: RosterApp.#onFilter,
      toggleRow: RosterApp.#onToggleRow,
      loyaltyRoll: RosterApp.#onLoyaltyRoll,
      obedienceRoll: RosterApp.#onObedienceRoll,
      moraleRoll: RosterApp.#onMoraleRoll,
      calamity: RosterApp.#onCalamity,
      penalty: RosterApp.#onPenalty,
      toggleCompensated: RosterApp.#onToggleCompensated,
      payWages: RosterApp.#onPayWages,
      openActor: RosterApp.#onOpenActor,
      transfer: RosterApp.#onTransfer,
      dismiss: RosterApp.#onDismiss,
      allCards: RosterApp.#onAllSheets(true),
      allFull: RosterApp.#onAllSheets(false),
    },
  };

  /**
   * Bulk face-flip for the whole retinue, through the lib subsystem's one
   * sanctioned switch (followerCard.setSheet — the same flag core's Sheet
   * Config writes).
   * Returns a bound handler so both buttons share one implementation.
   */
  static #onAllSheets(useCard) {
    return async function () {
      const setSheet = globalThis.acksExtras.lib.followerCard.setSheet;
      const ids = [...adapter.getHenchmenIds(this.employer), ...(this.employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [])];
      let changed = 0;
      for (const id of ids) {
        const actor = game.actors.get(id);
        if (actor && (await setSheet(actor, useCard))) changed++;
      }
      ui.notifications.info(loc(useCard ? "allCardsDone" : "allFullDone", { count: changed }));
    };
  }

  static PARTS = {
    band: { template: `modules/${MODULE_ID}/templates/lib/frame/band.hbs` },
    body: { template: `modules/${MODULE_ID}/templates/henchmen/roster-app.hbs` },
  };

  get title() {
    return loc("title", { name: this.employer.name });
  }

  async close(options) {
    Hooks.off(HOOKS.ROSTER_CHANGED, this.#hookId);
    return super.close(options);
  }

  /** The band goes into the window header; the drop zone takes actors. */
  _onRender(context, options) {
    super._onRender(context, options);
    moveBandIntoHeader(this.element);
    if (!context.editable) return;
    new foundry.applications.ux.DragDrop.implementation({
      dropSelector: "[data-roster-drop]",
      callbacks: { drop: this.#onDrop.bind(this) },
    }).bind(this.element);
  }

  /** Whether this seat may act on the roster: the Judge, or the employer's owner. */
  get #editable() {
    return game.user.isGM || !!this.employer.isOwner;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const employer = this.employer;
    const isGM = game.user.isGM;
    const editable = this.#editable;
    const limit = checkHenchmanLimit(employer);
    const mods = employerLoyaltyMods(employer);
    const unknown = limit.max === null;
    context.employer = employer;
    context.isGM = isGM;
    context.editable = editable;
    context.band = {
      glyph: { icon: "fa-solid fa-people-group", title: loc("title", { name: employer.name }) },
      rank: loc("rank"),
      rankTitle: loc("rankTitle"),
      name: employer.name,
      editable: false,
      folded: false,
      chips: [],
      bar: null,
      reading: null,
    };
    context.limit = {
      ...limit,
      over: !limit.ok,
      unknown,
      pct: unknown ? 0 : limit.max > 0 ? clampPct((limit.count / limit.max) * 100) : limit.count > 0 ? 100 : 0,
      note: unknown
        ? loc("limitNoteUnknown", { count: limit.count })
        : loc("limitNote", { count: limit.count, max: limit.max, cha: signed(mods.chaLoyalty), powers: signed(mods.baseLoyaltyBonus) }),
      hint: limit.why === "import" ? "ACKS-HENCHMEN.roster.limitNotImported" : limit.why === "charisma" ? "ACKS-HENCHMEN.roster.limitUnknown" : "ACKS-HENCHMEN.roster.limitHint",
    };
    // The limit and loyalty powers held by name with no imported value: both
    // figures above leave them out, and the meter says so.
    const unvalued = [...new Set([...limit.unvalued, ...unvaluedPowers(employer, "baseLoyalty")])];
    context.unvaluedNote = unvalued.length ? loc("unvalued", { powers: unvalued.join(", ") }) : "";

    const bill = wageBill(employer);
    context.wages = {
      due: bill.due,
      monthly: bill.monthly,
      anyDue: bill.due > 0,
      note: bill.due > 0 ? loc("wagesDue", { due: bill.due, monthly: bill.monthly }) : loc("wagesMonthly", { monthly: bill.monthly }),
      payTitle: loc("payTitle", { name: employer.name }),
    };

    const all = this.#rows(employer, mods);
    const counts = filterCounts(all);
    context.filters = ROSTER_FILTERS.map((key) => ({ key, label: loc(`filter.${key}`), n: counts[key], on: this.#ui.filter === key }));
    context.rows = filterRows(all, this.#ui.filter);
    context.filtered = all.length > 0 && context.rows.length === 0;
    return context;
  }

  /** Every hireling on the roster as a row, in roster order. */
  #rows(employer, mods) {
    const ids = [...adapter.getHenchmenIds(employer), ...(employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [])];
    return ids
      .map((id) => game.actors.get(id))
      .filter(Boolean)
      .map((actor) => this.#row(actor, mods));
  }

  /** One hireling's row: who they are, what they stand at, what they cost, and the record under it. */
  #row(actor, mods) {
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    const retainer = adapter.getRetainer(actor);
    const category = retainer.category || "henchman";
    const henchman = keepsLoyalty(category);
    const isMonster = actor.type === ACTOR_TYPE.monster;
    const pending = !!record.special?.pendingCalamity;
    const open = this.#ui.open.has(actor.id);
    const terms = termsFor(actor, record, retainer);
    const clock = clockFor(record);
    const quantity = Number(retainer.quantity) || 1;
    const parts = loyaltyParts(record, mods);

    const tags = [{ label: game.i18n.localize(`ACKS-HENCHMEN.category.${category}`) }];
    if (isMonster) {
      tags.push({ label: loc("monster"), title: loc("monsterTitle") });
      const hd = adapter.getWageLevel(actor) || monsterHd(actor);
      if (hd) tags.push({ label: loc("hd", { n: hd }) });
    } else if (classLevel(actor)) {
      tags.push({ label: [actor.system?.details?.class, classLevel(actor)].filter(Boolean).join(" ") });
    }
    if (quantity > 1) tags.push({ label: loc("times", { n: quantity }) });
    const slot = slotOf(record, category);
    if (slot === "noSlot") tags.push({ label: loc("noSlotTag"), ghost: true, title: loc("noSlot") });

    const loyalty = henchman
      ? {
          value: signed(effectiveLoyaltyFor(actor)),
          title:
            loc("loyaltyBreakdown", { start: parts.start, permanents: parts.permanents, cha: parts.cha, effects: parts.powers }) +
            (pending ? ` · ${loc("pending")}` : ""),
        }
      : { value: "—", title: loc("noLoyalty") };
    const wage = terms.wageUnset
      ? { value: loc("wageUnset"), unset: true, tone: null, due: false, title: loc("wageUnsetHint") }
      : {
          value: loc("gp", { gp: terms.wage }),
          unset: false,
          tone: clock.behind > 0 ? "neg" : null,
          due: clock.behind > 0,
          title: clock.behind > 0 ? loc("wageDue") : loc("wageMonthly"),
        };

    return {
      id: actor.id,
      uuid: actor.uuid,
      name: actor.name,
      img: actor.img,
      bucket: bucketOf(category),
      henchman,
      isMonster,
      pending,
      open,
      tags,
      loyalty,
      morale: { value: signed(effectiveMoraleFor(actor)), title: loc("moraleTitle") },
      wage,
      clock,
      clockLine: clockLine(clock),
      hired: record.hiredTime != null
        ? record.settlementName
          ? loc("hiredAt", { where: record.settlementName, date: dateLabel(record.hiredTime) })
          : loc("hiredOn", { date: dateLabel(record.hiredTime) })
        : "",
      origin: record.origin ? game.i18n.localize(`ACKS-HENCHMEN.origin.${record.origin}`) : "",
      arrears: loc("gp", { gp: terms.arrears }),
      calamities: record.counters?.calamities ?? 0,
      levelsGained: record.counters?.levelsGainedInService ?? 0,
      ledger: open ? ledgerRows(record) : [],
      rolledLine: [
        record.rolled?.classKey,
        record.rolled?.level != null ? `L${record.rolled.level}` : "",
        record.rolled?.template,
        record.rolled?.attributes?.str != null
          ? `${record.rolled.attributes.str}/${record.rolled.attributes.int}/${record.rolled.attributes.wil}/${record.rolled.attributes.dex}/${record.rolled.attributes.con}/${record.rolled.attributes.cha}`
          : "",
      ]
        .filter(Boolean)
        .join(" · "),
      events: open ? eventRows(record, ROW_EVENTS) : [],
    };
  }

  #actor(target) {
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    return id ? game.actors.get(id) : null;
  }

  static #onFilter(_event, target) {
    this.#ui.filter = ROSTER_FILTERS.includes(target.dataset.filter) ? target.dataset.filter : "all";
    this.render();
  }

  static #onToggleRow(_event, target) {
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!id) return;
    if (this.#ui.open.has(id)) this.#ui.open.delete(id);
    else this.#ui.open.add(id);
    this.render();
  }

  static #onLoyaltyRoll(_event, target) {
    const actor = this.#actor(target);
    if (actor) openLoyaltyRoll(actor);
  }

  static #onObedienceRoll(_event, target) {
    const actor = this.#actor(target);
    if (actor) openObedienceRoll(actor);
  }

  /** A mercenary's or specialist's throw is the sheet's own morale roll. */
  static #onMoraleRoll(event, target) {
    this.#actor(target)?.rollMorale?.({ event });
  }

  static async #onCalamity(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const note = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("calamityPrompt") },
      content: `<input type="text" name="note" placeholder="${loc("calamityPlaceholder")}" />`,
      ok: { callback: (_e, button) => button.form.elements.note.value },
    }).catch(() => null);
    if (note !== null) await recordCalamity(actor, note);
    this.render();
  }

  /**
   * Record a penalty that lasts only while uncompensated — a permanent wound
   * or a tampering-with-mortality side effect. It lands in the loyalty ledger
   * under its reason; the Judge lifts it later with the compensate toggle
   * rather than deleting anything.
   */
  static async #onPenalty(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const options = Object.entries(WOUND_PENALTIES)
      .map(([key, delta]) => `<option value="${key}">${game.i18n.localize(`ACKS-HENCHMEN.penalty.${key}`)} (${delta})</option>`)
      .join("");
    const key = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("penaltyTitle", { name: actor.name }) },
      content: `<p class="hint">${loc("penaltyHint")}</p><select name="key">${options}</select>`,
      ok: { callback: (_e, button) => button.form.elements.key.value },
    }).catch(() => null);
    if (!key || !(key in WOUND_PENALTIES)) return;
    await addLoyaltyPermanent(actor, WOUND_PENALTIES[key], penaltyReason(key), game.i18n.localize(`ACKS-HENCHMEN.penalty.${key}`));
    this.render();
  }

  /** Suspend or restore one ledger entry; the engine refuses a seat that is not the Judge's. */
  static async #onToggleCompensated(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const { track, index, compensated } = target.dataset;
    await setPermanentCompensated(actor, {
      track,
      index: Number(index),
      compensated: compensated !== "true",
    });
    this.render();
  }

  static async #onPayWages() {
    await payWagesFor(this.employer);
    this.render();
  }

  static #onOpenActor(_event, target) {
    this.#actor(target)?.sheet?.render(true);
  }

  /** Transfer employment: recalculated from the new employer; it counts as a calamity. */
  static async #onTransfer(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const candidates = game.actors.filter(
      (a) => a.type === ACTOR_TYPE.character && !a.system?.retainer?.enabled && a.id !== this.employer.id
    );
    if (!candidates.length) return;
    const options = candidates.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
    const newId = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("transferTitle", { name: actor.name }) },
      content: `<select name="employerId">${options}</select>`,
      ok: { callback: (_e, button) => button.form.elements.employerId.value },
    }).catch(() => null);
    const newEmployer = newId ? game.actors.get(newId) : null;
    if (!newEmployer) return;
    try {
      await adapter.delHenchman(this.employer, actor.id);
      await adapter.addHenchman(newEmployer, actor.id);
    } catch (err) {
      // The employment record must keep pointing at whoever actually holds the
      // hireling — a failed move must not rewrite it to the intended employer.
      console.warn(`${MODULE_ID} | transfer roster ops failed`, err);
      ui.notifications?.error(loc("transferFailed", { name: actor.name }));
      return;
    }
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    await actor.setFlag(MODULE_ID, FLAG_RECORD, { ...record, employerUuid: newEmployer.uuid });
    await HenchmanRecord.logEvent(actor, {
      type: "transfer",
      note: loc("transferNote", { from: this.employer.name, to: newEmployer.name }),
    });
    await syncLoyalty(actor); // recalculated from the NEW employer's CHA/effects
    await recordCalamity(actor, loc("transferCalamity"));
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: this.employer });
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: newEmployer });
    this.render();
  }

  static async #onDismiss(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("dismissTitle", { name: actor.name }) },
      content: `<p>${loc("dismissBody", { name: actor.name })}</p>`,
    }).catch(() => false);
    if (!confirmed) return;
    await HenchmanRecord.logEvent(actor, { type: "dismissed", note: "" });
    if (actor.type === ACTOR_TYPE.monster) {
      const list = (this.employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? []).filter((id) => id !== actor.id);
      await this.employer.setFlag(MODULE_ID, FLAG_MONSTER_LIST, list);
      await adapter.setRetainer(actor, { enabled: false, managerid: "" });
    } else {
      try {
        await adapter.delHenchman(this.employer, actor.id);
      } catch (err) {
        console.warn(`${MODULE_ID} | delHenchman failed`, err);
      }
    }
    this.#ui.open.delete(actor.id);
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: this.employer });
    this.render();
  }

  /**
   * A character dropped on the roster is enrolled with no hire behind them:
   * one already in service, a monster or the employer themself is refused
   * with a notice, and so is a seat that may not act here.
   */
  async #onDrop(event) {
    if (!this.#editable) return;
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Actor" || !data.uuid) return;
    const actor = await fromUuid(data.uuid);
    const eligible = actor?.type === ACTOR_TYPE.character && !actor.system?.retainer?.enabled && actor.id !== this.employer.id;
    if (!eligible) {
      ui.notifications.warn(loc("dropRefused"));
      return;
    }
    await enrollHenchman(this.employer, actor);
    ui.notifications.info(loc("enrolled", { name: actor.name }));
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: this.employer });
    this.render();
  }
}

export function openRosterApp(employer) {
  new RosterApp({ employer }).render(true);
}
