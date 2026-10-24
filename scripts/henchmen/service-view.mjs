/* global game */
/**
 * The Service panel's reader: a hireling's record, terms, wage clock,
 * employer, ledger, events and recorded rolls as the panel the character
 * sheet's Service tab and the monster sheet's Henchman tab both include
 * (`templates/henchmen/service-panel.hbs`). The decisions are
 * `rules/service.mjs`; this file reads the world and puts words on them.
 */
import { MODULE_ID, FLAG_RECORD } from "./constants.mjs";
import { effectiveLoyaltyFor, effectiveMoraleFor, employerLoyaltyMods } from "./engine/events.mjs";
import { reasonKey } from "./rules/loyalty.mjs";
import { henchmanWage } from "./rules/wages.mjs";
import {
  wageClock, loyaltyParts, moraleParts, ledgerEntries, termsOf, rolledOf, slotOf, keepsLoyalty, serviceBadge,
} from "./rules/service.mjs";
import * as adapter from "./acks-adapter.mjs";
import { now, secondsPerMonth, dateLabel } from "./time.mjs";
import { SECONDS_PER_DAY } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { signed } from "../lib/frame-model.mjs";
import { classLevel } from "../lib/actor-read.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

/** The lang root of the panel's strings. */
export const SERVICE_LANG_PREFIX = "ACKS-HENCHMEN.service";
const loc = makeLoc(SERVICE_LANG_PREFIX);

/** How many events the panel lists, newest first; the record itself keeps more. */
export const EVENTS_SHOWN = 50;

const localizeIf = (key, fallback = "") => (key && game.i18n.has(key) ? game.i18n.localize(key) : fallback);

/** The words for a share kind from `shareKind`. */
const shareLabel = (share) => (share.kind === "pct" ? loc("shareKind.pct", { pct: share.pct }) : loc(`shareKind.${share.kind}`));

/** A ledger entry with its words: the track, the reason and the toggle's tooltip. */
export function ledgerRows(record) {
  return ledgerEntries(record).map((e) => ({
    ...e,
    trackLabel: game.i18n.localize(`ACKS-HENCHMEN.ledger.track.${e.track}`),
    reasonLabel: localizeIf(reasonKey(e.track, e.reason), e.reason),
    toggleTitle: game.i18n.localize(e.compensated ? "ACKS-HENCHMEN.ledger.restoreHint" : "ACKS-HENCHMEN.ledger.compensateHint"),
  }));
}

/** The record's events, newest first, each with its words and its date. */
export function eventRows(record, limit = EVENTS_SHOWN) {
  return (record?.events ?? [])
    .slice(-limit)
    .reverse()
    .map((e) => ({
      ...e,
      date: dateLabel(e.time),
      typeLabel: localizeIf(`ACKS-HENCHMEN.event.${e.type}`, e.type ?? ""),
      outcomeLabel: localizeIf(`ACKS-HENCHMEN.outcome.${e.outcome}`, e.outcome ?? ""),
    }));
}

/** The wage in force for a hireling, as `termsOf` decides it, with the ladder read for a henchman. */
export function termsFor(actor, record, retainer) {
  const category = retainer.category || "henchman";
  return termsOf(record, {
    sheetWage: retainer.wage,
    ladder: keepsLoyalty(category) ? henchmanWage(adapter.getWageLevel(actor)) : 0,
    category,
  });
}

/** The wage clock of one hireling, read at `currentTime`. */
export function clockFor(record, currentTime = now()) {
  return wageClock({
    lastPaid: record?.terms?.lastPaidTime ?? record?.hiredTime ?? null,
    now: currentTime,
    month: secondsPerMonth(),
    day: SECONDS_PER_DAY,
  });
}

/** The clock's one-line reading: behind, unset, or since and until. */
export function clockLine(clock) {
  if (clock.unset) return loc("clockUnset");
  if (clock.behind > 0) return loc("clockBehind", { n: clock.behind });
  return loc("clockLine", { since: clock.sinceDays, until: clock.untilDays });
}

/**
 * The Service panel's context for `actor`. `inService` false when the actor
 * serves nobody, and the template then renders its empty hint alone.
 * @param {Actor} actor the hireling
 * @param {{isGM?: boolean, pins?: string[]}} viewer `pins` are the sheet's pinned roll ids, so the Loyalty and Morale rows show their star
 */
export function buildServicePanel(actor, { isGM = false, pins = [] } = {}) {
  const retainer = adapter.getRetainer(actor);
  if (!retainer.enabled) return { inService: false, emptyHint: loc("empty") };
  const record = actor.getFlag(MODULE_ID, FLAG_RECORD) ?? {};
  const employer = adapter.getManager(actor);
  const category = retainer.category || "henchman";
  const henchman = keepsLoyalty(category);
  const mods = employerLoyaltyMods(employer);
  const loyalty = loyaltyParts(record, mods);
  const morale = moraleParts(record, adapter.getMorale(actor));
  const pending = !!record.special?.pendingCalamity;

  const standing = {
    pending,
    henchman,
    loyalty: {
      value: signed(effectiveLoyaltyFor(actor)),
      pinned: pins.includes("loyalty"),
      parts: [
        { label: loc("loyaltyStart"), value: signed(loyalty.start) },
        { label: loc("loyaltyPermanents", { n: loyalty.uncompensated }), value: signed(loyalty.permanents) },
        { label: loc("loyaltyCha"), value: signed(loyalty.cha) },
        { label: loc("loyaltyPowers"), value: signed(loyalty.powers) },
      ],
    },
    morale: {
      value: signed(effectiveMoraleFor(actor)),
      pinned: pins.includes("morale"),
      line: loc("moraleLine", { base: signed(morale.base), permanents: signed(morale.permanents) }),
    },
  };

  const terms = termsFor(actor, record, retainer);
  const basisKey = terms.basis === "level" && actor.type === ACTOR_TYPE.monster ? "hd" : terms.basis;
  const clock = clockFor(record);
  const termsView = {
    wage: terms.wageUnset ? loc("wageUnset") : loc("wageValue", { gp: terms.wage }),
    wageUnset: terms.wageUnset,
    basis: loc(`wageBasis.${basisKey}`, { n: adapter.getWageLevel(actor) }),
    share: terms.treasureShare.kind === terms.xpShare.kind && terms.treasureShare.pct === terms.xpShare.pct
      ? shareLabel(terms.treasureShare)
      : loc("shareSplit", { treasure: shareLabel(terms.treasureShare), xp: shareLabel(terms.xpShare) }),
    signingBonus: loc("gp", { gp: terms.signingBonus }),
    signingWhere: record.settlementName ? loc("signingWhere", { where: record.settlementName }) : "",
    arrears: loc("gp", { gp: terms.arrears }),
    arrearsOwed: terms.arrears > 0,
    clock,
    clockLine: clockLine(clock),
  };

  const hiredDate = dateLabel(record.hiredTime);
  const employerView = employer
    ? {
        name: employer.name,
        uuid: employer.uuid,
        line: employer.type === ACTOR_TYPE.character ? loc("employerLine", { level: classLevel(employer) }) : "",
        hired: record.settlementName
          ? loc("hiredAt", { where: record.settlementName, date: hiredDate })
          : hiredDate ? loc("hiredOn", { date: hiredDate }) : "",
        calamities: record.counters?.calamities ?? 0,
        levelsGained: record.counters?.levelsGainedInService ?? 0,
        startLevel: record.counters?.startLevel ? loc("startLevel", { n: record.counters.startLevel }) : "",
        slot: slotOf(record, category),
      }
    : null;

  const rolled = rolledOf(record);
  return {
    inService: true,
    isGM,
    pending,
    badge: serviceBadge(record),
    category: game.i18n.localize(`ACKS-HENCHMEN.category.${category}`),
    standing,
    terms: termsView,
    employer: employerView,
    ledger: ledgerRows(record),
    events: eventRows(record),
    eventsNote: loc("eventsNote", { n: EVENTS_SHOWN }),
    rolled: rolled.any
      ? {
          scores: rolled.scores ? rolled.scores.join(" · ") : "",
          classLevel: [rolled.classKey, rolled.level != null ? rolled.level : ""].filter((x) => x !== "").join(" · "),
          template: rolled.template,
          hpRoll: rolled.hpRoll,
        }
      : null,
  };
}
