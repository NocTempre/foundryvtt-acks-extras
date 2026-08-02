/* global game, ui, foundry, Hooks */
/**
 * RosterApp — an employer's merged hireling roster: core henchmenList plus
 * the module's monster-henchman list, with the 4+CHA(+effects) limit meter,
 * effective-loyalty breakdowns, wage status, and per-row actions (loyalty /
 * obedience throws, calamity, pay wages, record view, transfer, dismiss).
 */
import { MODULE_ID, FLAG_RECORD, FLAG_MONSTER_LIST, HOOKS } from "../constants.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import { checkHenchmanLimit } from "../engine/hire.mjs";
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
} from "../engine/events.mjs";
import { sumPermanents, reasonKey, WOUND_PENALTIES, penaltyReason } from "../rules/loyalty.mjs";
import { henchmanWage } from "../rules/wages.mjs";
import * as adapter from "../acks-adapter.mjs";
import { now, secondsPerMonth } from "../time.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

/**
 * Both permanent-adjustment ledgers as display rows, newest first, each
 * carrying the coordinates the compensate toggle writes back through
 * (`track` + `index` into that track's stored array).
 */
function ledgerRows(record) {
  return ["loyalty", "morale"].flatMap((track) =>
    (record[track]?.permanents ?? [])
      .map((entry, index) => {
        const delta = Number(entry.delta ?? 0);
        return {
          track,
          index,
          compensated: !!entry.compensated,
          trackLabel: game.i18n.localize(`ACKS-HENCHMEN.ledger.track.${track}`),
          delta: delta > 0 ? `+${delta}` : String(delta),
          reasonLabel: game.i18n.has(reasonKey(track, entry.reason))
            ? game.i18n.localize(reasonKey(track, entry.reason))
            : entry.reason ?? "",
          note: entry.note ?? "",
        };
      })
      .reverse()
  );
}

export class RosterApp extends HandlebarsApplicationMixin(ApplicationV2) {
  constructor({ employer, ...options } = {}) {
    super(options);
    this.employer = employer;
    this.#hookId = Hooks.on(HOOKS.ROSTER_CHANGED, ({ employer: changed }) => {
      if (changed?.id === this.employer.id) this.render();
    });
  }

  #hookId;

  static DEFAULT_OPTIONS = {
    id: "acks-henchmen-roster-{id}",
    classes: ["acks-extras", "roster-app"],
    position: { width: 640, height: 560 },
    window: { resizable: true },
    actions: {
      loyaltyRoll: RosterApp.#onLoyaltyRoll,
      obedienceRoll: RosterApp.#onObedienceRoll,
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
   * Bulk face-flip for the whole retinue, through acks-lib's one sanctioned
   * switch (followerCard.setSheet — the same flag core's Sheet Config writes).
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
      ui.notifications.info(
        game.i18n.format(useCard ? "ACKS-HENCHMEN.roster.allCardsDone" : "ACKS-HENCHMEN.roster.allFullDone", { count: changed }),
      );
    };
  }

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/henchmen/roster-app.hbs` },
  };

  get title() {
    return game.i18n.format("ACKS-HENCHMEN.roster.title", { name: this.employer.name });
  }

  async close(options) {
    Hooks.off(HOOKS.ROSTER_CHANGED, this.#hookId);
    return super.close(options);
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const employer = this.employer;
    const limit = checkHenchmanLimit(employer);
    context.employer = employer;
    context.isGM = game.user.isGM;
    context.limit = { ...limit, over: limit.count >= limit.max };
    const mods = employerLoyaltyMods(employer);
    context.employerMods = {
      cha: mods.chaLoyalty,
      effects: mods.baseLoyaltyBonus,
    };

    const ids = [
      ...adapter.getHenchmenIds(employer),
      ...(employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? []),
    ];
    const currentTime = now();
    context.rows = ids
      .map((id) => game.actors.get(id))
      .filter(Boolean)
      .map((actor) => {
        const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
        const retainer = adapter.getRetainer(actor);
        const wage = Number(record.terms?.wageGp ?? retainer.wage) || henchmanWage(adapter.getWageLevel(actor));
        const lastPaid = record.terms?.lastPaidTime ?? record.hiredTime;
        // Never derive months from the epoch: an unenrolled pre-existing
        // henchman owes nothing until the wage engine adopts them.
        const monthsDue = lastPaid == null ? 0 : Math.floor((currentTime - lastPaid) / secondsPerMonth());
        // Only the entries that still score: a compensated penalty stays in
        // the ledger below but is out of the breakdown, like the score itself.
        const permanents = sumPermanents(record.loyalty?.permanents ?? []);
        return {
          id: actor.id,
          uuid: actor.uuid,
          name: actor.name,
          img: actor.img,
          isMonster: actor.type === "monster",
          category: game.i18n.localize(`ACKS-HENCHMEN.category.${retainer.category || "henchman"}`),
          level: adapter.getWageLevel(actor),
          loyalty: effectiveLoyaltyFor(actor),
          loyaltyBreakdown: game.i18n.format("ACKS-HENCHMEN.roster.loyaltyBreakdown", {
            start: record.loyalty?.start ?? 0,
            permanents,
            cha: mods.chaLoyalty,
            effects: mods.baseLoyaltyBonus,
          }),
          morale: effectiveMoraleFor(actor),
          wage,
          monthsDue,
          wageDue: monthsDue >= 1,
          arrears: record.terms?.arrearsGp ?? 0,
          calamities: record.counters?.calamities ?? 0,
          noSlot: record.special?.noSlot ?? false,
          origin: record.origin ? game.i18n.localize(`ACKS-HENCHMEN.origin.${record.origin}`) : "",
          ledger: ledgerRows(record),
          rolled: record.rolled ?? {},
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
          events: (record.events ?? []).slice(-8).reverse().map((e) => ({
            ...e,
            typeLabel: game.i18n.has(`ACKS-HENCHMEN.event.${e.type}`)
              ? game.i18n.localize(`ACKS-HENCHMEN.event.${e.type}`)
              : e.type,
            outcomeLabel: e.outcome && game.i18n.has(`ACKS-HENCHMEN.outcome.${e.outcome}`)
              ? game.i18n.localize(`ACKS-HENCHMEN.outcome.${e.outcome}`)
              : e.outcome ?? "",
          })),
        };
      });
    context.totalWages = context.rows.reduce((s, r) => s + (r.wage || 0), 0);
    context.anyDue = context.rows.some((r) => r.wageDue);
    return context;
  }

  #actor(target) {
    const id = target.closest("[data-actor-id]")?.dataset.actorId;
    return id ? game.actors.get(id) : null;
  }

  static #onLoyaltyRoll(_event, target) {
    const actor = this.#actor(target);
    if (actor) openLoyaltyRoll(actor);
  }

  static #onObedienceRoll(_event, target) {
    const actor = this.#actor(target);
    if (actor) openObedienceRoll(actor);
  }

  static async #onCalamity(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const note = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.localize("ACKS-HENCHMEN.roster.calamityPrompt") },
      content: `<input type="text" name="note" placeholder="${game.i18n.localize("ACKS-HENCHMEN.roster.calamityPlaceholder")}" />`,
      ok: { callback: (_e, button) => button.form.elements.note.value },
    }).catch(() => null);
    if (note !== null) await recordCalamity(actor, note);
    this.render();
  }

  /**
   * Record one of the RR 166 penalties that last only while uncompensated —
   * a permanent wound (critical/grievous/mortal) or a tampering-with-mortality
   * side effect. It lands in the loyalty ledger under reason "wound"/
   * "tampering"; the Judge lifts it later with the compensate toggle rather
   * than deleting anything.
   */
  static async #onPenalty(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const options = Object.entries(WOUND_PENALTIES)
      .map(([key, delta]) => `<option value="${key}">${game.i18n.localize(`ACKS-HENCHMEN.penalty.${key}`)} (${delta})</option>`)
      .join("");
    const key = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("ACKS-HENCHMEN.roster.penaltyTitle", { name: actor.name }) },
      content: `<p class="hint">${game.i18n.localize("ACKS-HENCHMEN.roster.penaltyHint")}</p><select name="key">${options}</select>`,
      ok: { callback: (_e, button) => button.form.elements.key.value },
    }).catch(() => null);
    if (!key || !(key in WOUND_PENALTIES)) return;
    await addLoyaltyPermanent(
      actor,
      WOUND_PENALTIES[key],
      penaltyReason(key),
      game.i18n.localize(`ACKS-HENCHMEN.penalty.${key}`)
    );
    this.render();
  }

  /** Suspend or restore one ledger entry (RR 166 "while uncompensated"). */
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

  /** Transfer employment: recalc from the new employer; counts as a calamity (RR 163). */
  static async #onTransfer(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const candidates = game.actors.filter(
      (a) => a.type === "character" && !a.system?.retainer?.enabled && a.id !== this.employer.id
    );
    if (!candidates.length) return;
    const options = candidates.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
    const newId = await foundry.applications.api.DialogV2.prompt({
      window: { title: game.i18n.format("ACKS-HENCHMEN.roster.transferTitle", { name: actor.name }) },
      content: `<select name="employerId">${options}</select>`,
      ok: { callback: (_e, button) => button.form.elements.employerId.value },
    }).catch(() => null);
    const newEmployer = newId ? game.actors.get(newId) : null;
    if (!newEmployer) return;
    try {
      await adapter.delHenchman(this.employer, actor.id);
      await adapter.addHenchman(newEmployer, actor.id);
    } catch (err) {
      console.warn(`${MODULE_ID} | transfer roster ops failed`, err);
    }
    const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
    await actor.setFlag(MODULE_ID, FLAG_RECORD, { ...record, employerUuid: newEmployer.uuid });
    await HenchmanRecord.logEvent(actor, {
      type: "transfer",
      note: game.i18n.format("ACKS-HENCHMEN.roster.transferNote", { from: this.employer.name, to: newEmployer.name }),
    });
    await syncLoyalty(actor); // recalculated from the NEW employer's CHA/effects
    await recordCalamity(actor, game.i18n.localize("ACKS-HENCHMEN.roster.transferCalamity"));
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: this.employer });
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: newEmployer });
    this.render();
  }

  static async #onDismiss(_event, target) {
    const actor = this.#actor(target);
    if (!actor) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      window: { title: game.i18n.format("ACKS-HENCHMEN.roster.dismissTitle", { name: actor.name }) },
      content: `<p>${game.i18n.format("ACKS-HENCHMEN.roster.dismissBody", { name: actor.name })}</p>`,
    }).catch(() => false);
    if (!confirmed) return;
    await HenchmanRecord.logEvent(actor, { type: "dismissed", note: "" });
    if (actor.type === "monster") {
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
    Hooks.callAll(HOOKS.ROSTER_CHANGED, { employer: this.employer });
    this.render();
  }
}

export function openRosterApp(employer) {
  new RosterApp({ employer }).render(true);
}
