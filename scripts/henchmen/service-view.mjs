/* global game */
/**
 * The Service panel's reader: a hireling's record, terms, wage clock,
 * employer, ledger, events and recorded rolls as the panel the character
 * sheet's Service tab and the monster sheet's Henchman tab both include
 * (`templates/henchmen/service-panel.hbs`). The decisions are
 * `rules/service.mjs`; this file reads the world and puts words on them.
 */
import { MODULE_ID, FLAG_RECORD } from "./constants.mjs";
import { effectiveLoyaltyFor, effectiveMoraleFor, employerLoyaltyMods, employerMoraleBase } from "./engine/events.mjs";
import { reasonKey } from "./rules/loyalty.mjs";
import { henchmanWage, henchmanWageCite, importedShare, importedShareCite } from "./rules/wages.mjs";
import {
  wageClock, loyaltyParts, moraleParts, ledgerEntries, termsOf, rolledOf, slotOf, keepsLoyalty, serviceBadge, ROLLED_SCORES, signingControls,
  offersClassPick,
} from "./rules/service.mjs";
import * as adapter from "./acks-adapter.mjs";
import { now, secondsPerMonth, dateLabel } from "./time.mjs";
import { SECONDS_PER_DAY } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { signed } from "../lib/frame-model.mjs";
import { classLevel } from "../lib/actor-read.mjs";
import { creditedExperience, keepsExperienceOnFlag } from "../lib/experience.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";

/** The lang root of the panel's strings. */
export const SERVICE_LANG_PREFIX = "ACKS-HENCHMEN.service";
const loc = makeLoc(SERVICE_LANG_PREFIX);

/** How many events the panel lists, newest first; the record itself keeps more. */
export const EVENTS_SHOWN = 50;

const localizeIf = (key, fallback = "") => (key && game.i18n.has(key) ? game.i18n.localize(key) : fallback);

/** The words for a share kind from `shareKind`, or "not imported" for the null a missing figure leaves. */
const shareLabel = (share) => (share == null ? loc("shareUnimported") : share.kind === "pct" ? loc("shareKind.pct", { pct: share.pct }) : loc(`shareKind.${share.kind}`));

/** Whether two shares read the same: both missing, or one kind and figure. */
const sameShare = (a, b) => (a == null || b == null ? a == b : a.kind === b.kind && a.pct === b.pct);

/**
 * Where the two shares came from, as `termsOf` names them: the record's own
 * term, the imported table with the page its import recorded (or "no page
 * recorded" where a Judge's override stands), or not imported. One sentence
 * where both say the same, else each named.
 */
function shareTip(terms) {
  const part = (kind) => {
    const from = terms.shareFrom[kind];
    if (from === "record") return loc("tip.shareRecord");
    if (from === "imported") return loc("tip.shareImported", { page: importedShareCite(kind) ?? loc("tip.noPage") });
    return loc("tip.shareUnimported");
  };
  const treasure = part("treasure");
  const xp = part("xp");
  return treasure === xp ? treasure : loc("tip.shareSplit", { treasure, xp });
}

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
    shares: { treasure: importedShare("treasure"), xp: importedShare("xp") },
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

/**
 * A summed score's tooltip: its parts as `[label, n]`, a note where the
 * score's range held the sum at `total`, and the page under `key`.
 */
function partsTip(parts, total, key) {
  const listed = parts.map(([label, n]) => `${label} ${signed(n)}`).join(" · ");
  const sum = parts.reduce((s, [, n]) => s + n, 0);
  return loc(key, { parts: sum === total ? listed : loc("tip.held", { parts: listed, total: signed(total) }) });
}

/** Where the wage in force came from, as `termsOf` names it, with the ladder's page where it was read. */
function wageTip(terms, { actor, henchman }) {
  if (terms.wageFrom === "agreed") return loc("tip.wageAgreed");
  if (terms.wageFrom === "sheet") return loc("tip.wageSheet");
  if (terms.wageFrom === "ladder") {
    return loc(actor.type === ACTOR_TYPE.monster ? "tip.wageHd" : "tip.wageLevel", {
      n: adapter.getWageLevel(actor),
      page: henchmanWageCite() ?? loc("tip.noPage"),
    });
  }
  return loc(henchman ? "tip.wageUnset" : "tip.wageUnsetOther");
}

/**
 * The experience credited to a creature the system keeps none for, as the
 * row's figure and its tooltip: each source's points, named, adding up to the
 * figure. Null for a character, whose experience is its own sheet's field.
 * Nothing about advancing is read or shown: no imported table gives a
 * monster's thresholds.
 */
export function experienceView(actor) {
  if (!keepsExperienceOnFlag(actor)) return null;
  const { total, parts } = creditedExperience(actor);
  const listed = parts.map(([source, n]) => `${localizeIf(`${SERVICE_LANG_PREFIX}.xpFrom.${source}`, source)} ${n}`).join(" · ");
  return { value: String(total), tip: total ? loc("tip.experience", { parts: listed }) : loc("tip.experienceNone") };
}

/** The recorded scores, each named by the system's own short label (Will is its `wis`). */
function scoresTip(scores) {
  return scores.map((v, i) => {
    const key = ROLLED_SCORES[i] === "wil" ? "wis" : ROLLED_SCORES[i];
    return `${game.i18n.localize(`ACKS.scores.${key}.short`)} ${v}`;
  }).join(" · ");
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
  const loyalty = loyaltyParts(record, mods, adapter.loyaltyBounds(actor.type));
  const morale = moraleParts(record, adapter.getMorale(actor), employerMoraleBase(employer), adapter.moraleBounds(actor.type));
  const moraleValue = signed(effectiveMoraleFor(actor));
  const pending = !!record.special?.pendingCalamity;

  const standing = {
    pending,
    henchman,
    loyalty: {
      value: signed(effectiveLoyaltyFor(actor)),
      tip: partsTip([
        [loc("loyaltyStart"), loyalty.start],
        [loc("tip.permanents"), loyalty.permanents],
        [loc("loyaltyCha"), loyalty.cha],
        [loc("loyaltyPowers"), loyalty.powers],
      ], loyalty.total, "tip.loyalty"),
      pinned: pins.includes("loyalty"),
      parts: [
        { label: loc("loyaltyStart"), value: signed(loyalty.start), tip: loc("tip.start") },
        { label: loc("loyaltyPermanents", { n: loyalty.uncompensated }), value: signed(loyalty.permanents), tip: loc("tip.ledger") },
        { label: loc("loyaltyCha"), value: signed(loyalty.cha), tip: loc("tip.cha") },
        { label: loc("loyaltyPowers"), value: signed(loyalty.powers), tip: loc("tip.powers") },
      ],
    },
    morale: {
      value: moraleValue,
      tip: partsTip([
        [loc("tip.base"), morale.base],
        [loc("tip.permanents"), morale.permanents],
        [loc("loyaltyPowers"), morale.powers],
      ], morale.total, "tip.morale"),
      pinned: pins.includes("morale"),
      line: loc("moraleLine", { base: signed(morale.base), permanents: signed(morale.permanents), powers: signed(morale.powers) }),
    },
    obedience: { value: moraleValue, tip: loc("tip.obedience") },
  };

  const terms = termsFor(actor, record, retainer);
  const basisKey = terms.basis === "level" && actor.type === ACTOR_TYPE.monster ? "hd" : terms.basis;
  const clock = clockFor(record);
  const termsView = {
    wage: terms.wageUnset ? loc("wageUnset") : loc("wageValue", { gp: terms.wage }),
    wageTip: wageTip(terms, { actor, henchman }),
    wageUnset: terms.wageUnset,
    basis: loc(`wageBasis.${basisKey}`, { n: adapter.getWageLevel(actor) }),
    share: sameShare(terms.treasureShare, terms.xpShare)
      ? shareLabel(terms.treasureShare)
      : loc("shareSplit", { treasure: shareLabel(terms.treasureShare), xp: shareLabel(terms.xpShare) }),
    shareTip: shareTip(terms),
    shareUnset: terms.treasureShare == null && terms.xpShare == null,
    // A bonus the employer could not pay at hire reads as owed, on the row's
    // face as well as in its tooltip.
    signingBonus: terms.signingOwed > 0 ? loc("signingOwedValue", { gp: terms.signingOwed }) : loc("gp", { gp: terms.signingBonus }),
    signingTip: terms.signingOwed > 0 ? loc("tip.signingOwed", { gp: terms.signingBonus || terms.signingOwed }) : loc("tip.signing"),
    signingOwed: terms.signingOwed > 0,
    signingControls: signingControls(terms, { isOwner: !!actor.isOwner, isGM }),
    signingWhere: record.settlementName
      ? loc(terms.signingOwed > 0 ? "signingOwedWhere" : "signingWhere", { where: record.settlementName })
      : "",
    arrears: loc("gp", { gp: terms.arrears }),
    arrearsTip: loc("tip.arrears"),
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
        calamitiesTip: loc("tip.calamities"),
        levelsGained: record.counters?.levelsGainedInService ?? 0,
        levelsGainedTip: loc("tip.levelsGained"),
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
    experience: experienceView(actor),
    employer: employerView,
    ledger: ledgerRows(record),
    events: eventRows(record),
    eventsNote: loc("eventsNote", { n: EVENTS_SHOWN }),
    rolled: rolled.any
      ? {
          scores: rolled.scores ? rolled.scores.join(" · ") : "",
          scoresTip: rolled.scores ? scoresTip(rolled.scores) : "",
          rolledTip: rolled.judgePick ? loc("tip.judgePick") : loc("tip.rolled"),
          classLevel: [rolled.judgePick ? loc("judgePick") : rolled.classKey, rolled.level != null ? rolled.level : ""].filter((x) => x !== "").join(" · "),
          pickClass: offersClassPick(rolled, actor.system?.details?.class, { isGM }),
          template: rolled.template,
          hp: hitPointsView(rolled),
        }
      : null,
  };
}

/**
 * The Recorded rolls' hit-point row: the maximum rolled at hire with each
 * level's roll in its tooltip, "not imported" with what was missing, or that
 * the class was the Judge's to pick.
 * Null where the record holds neither.
 */
function hitPointsView(rolled) {
  if (rolled.hpRoll != null) {
    const steps = rolled.hpSteps.map((s) => loc("hpStep", { level: s.level, formula: s.formula, total: s.total })).join(" · ");
    return { value: String(rolled.hpRoll), unset: false, tip: loc("tip.hpRolled", { steps }) };
  }
  if (!rolled.hpUnrolled) return null;
  if (rolled.hpUnrolled === "judgePick") return { value: loc("hpJudgePick"), unset: true, tip: loc("tip.hpJudgePick") };
  return {
    value: loc("hpUnimported"),
    unset: true,
    tip: loc(rolled.hpUnrolled === "noDice" ? "tip.hpNoDice" : "tip.hpNoClass", { class: rolled.classKey || "—" }),
  };
}
