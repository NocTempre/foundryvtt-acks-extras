/* global game, Hooks, foundry */
/**
 * acks-influence integration (soft — everything is guarded).
 *
 * With acks-influence apiVersion 3+ the HIRING and LOYALTY rolls render inside
 * the influence app as external-mode pages (consistent UI, auto-derived
 * subject/target features, effect-granted modifiers, the three core tones
 * hidden); apiVersion 6+ adds OBEDIENCE and the IRREFUSABLE OFFER. This module
 * supplies ctx (signing-bonus options, refusal/slander counts, effective
 * loyalty and morale) and applies the consequences when
 * `acksInfluenceRollComplete` fires with our context. Without influence (or on
 * an older apiVersion) everything falls back to the module's own ThrowDialog.
 *
 * Also consumed: `flags.acks-influence.reaction` Active Effects feed hiring
 * throws (scripts/effects.mjs); influence rolls AGAINST managed hirelings
 * are logged into their HenchmanRecord.
 */
import { MODULE_ID } from "../constants.mjs";
import HenchmanRecord from "../data/henchman-record.mjs";
import * as adapter from "../acks-adapter.mjs";

const INFLUENCE_ID = "acks-influence";

export function influenceApi() {
  const module = game.modules.get(INFLUENCE_ID);
  return module?.active ? module.api : null;
}

/** True when influence can host the hiring/loyalty pages (apiVersion 3+). */
export function hostsModes() {
  return (influenceApi()?.apiVersion ?? 0) >= 3;
}

/**
 * True when influence also hosts the morale-family pages — Hireling Obedience
 * and the Irrefusable Offer (apiVersion 6+).
 */
export function hostsMoraleModes() {
  return (influenceApi()?.apiVersion ?? 0) >= 6;
}

/**
 * Open the secret Hireling Obedience throw (RR 167) as an influence-hosted
 * page. The morale score comes from this module's record (base + permanents),
 * which the sheet alone does not know.
 */
export function openObedienceViaInfluence(o) {
  const api = influenceApi();
  if (!api) return null;
  return api.open(o.employer ?? null, {
    mode: "obedience",
    targetActor: o.hireling ?? null,
    ctx: {
      effectiveMorale: o.effectiveMorale ?? 0,
      targetName: o.hireling?.name ?? "",
      targetImg: o.hireling?.img ?? "",
    },
    context: { module: MODULE_ID, ...o.context },
  });
}

/** Open the Irrefusable Offer (MM 351) for a captured monster. */
export function openIrrefusableViaInfluence(o) {
  const api = influenceApi();
  if (!api) return null;
  return api.open(o.employer ?? null, {
    mode: "irrefusableOffer",
    targetActor: o.monster ?? null,
    ctx: {
      targetName: o.monster?.name ?? "",
      targetImg: o.monster?.img ?? "",
    },
    context: { module: MODULE_ID, ...o.context },
  });
}

/**
 * Open the Reaction to Hiring Offer as an influence-hosted page.
 * @param {object} o - { employer, targetActor, targetName, targetImg,
 *   signingBonusOptions, signingTiers, previousRefusals, slanderCount,
 *   context } — context is echoed back on the completion hook.
 */
export function openHiringViaInfluence(o) {
  const api = influenceApi();
  if (!api) return null;
  return api.open(o.employer, {
    mode: "hiring",
    targetActor: o.targetActor ?? null,
    ctx: {
      signingBonusOptions: o.signingBonusOptions ?? [],
      previousRefusals: o.previousRefusals ?? 0,
      slanderCount: o.slanderCount ?? 0,
      targetName: o.targetName ?? "",
      targetImg: o.targetImg ?? "",
    },
    context: { module: MODULE_ID, ...o.context },
  });
}

/** Open the secret Hireling Loyalty roll as an influence-hosted page. */
export function openLoyaltyViaInfluence(o) {
  const api = influenceApi();
  if (!api) return null;
  return api.open(o.employer ?? null, {
    mode: "loyalty",
    targetActor: o.hireling ?? null,
    ctx: {
      effectiveLoyalty: o.effectiveLoyalty ?? 0,
      apparentLevelDiff: o.apparentLevelDiff ?? 0,
      targetName: o.hireling?.name ?? "",
      targetImg: o.hireling?.img ?? "",
    },
    context: { module: MODULE_ID, ...o.context },
  });
}

/** The signing-bonus tier (+1..+3) chosen on an influence-hosted roll. */
export function signingTierFromParts(parts) {
  const entry = (parts ?? []).find((p) => /signing/i.test(p.label ?? "") || p.key === "signingBonus");
  return Number(entry?.value) || 0;
}

/** Recently applied roll resolutions (signature → ms) — see the dedupe below. */
const _seenResolutions = new Map();

export function registerInfluenceIntegration() {
  if (!game.modules.get(INFLUENCE_ID)?.active) return;

  Hooks.on("acksInfluenceRollComplete", async (payload) => {
    try {
      const context = payload?.context;
      // --- Our hosted pages: apply the consequences ---
      if (context?.module === MODULE_ID) {
        // One roll = one application. Multiple open dialog instances for the
        // same candidate each report the shared completion (found live
        // 2026-07-22: two stale hiring windows → two hires, two actors) —
        // collapse identical resolutions reported within a short window.
        const sig = [context.candidateId ?? context.specialHireId ?? context.actorUuid ?? "", payload.mode, payload.natural, payload.total, payload.outcome].join(":");
        const nowMs = Date.now();
        for (const [k, t] of _seenResolutions) if (nowMs - t > 15000) _seenResolutions.delete(k);
        if (_seenResolutions.has(sig)) return;
        _seenResolutions.set(sig, nowMs);
        if (payload.mode === "hiring") {
          const signingTier = signingTierFromParts(payload.parts);
          const signingGp = signingTier > 0 ? (context.signingTiers?.[signingTier] ?? 0) : 0;
          // Local-first: a seat that can write the location applies the
          // outcome itself — no GM client required (dynamic import avoids
          // the module cycle with the recruit dialog).
          const { deliverHiringOutcome } = await import("../apps/recruit-dialog.mjs");
          await deliverHiringOutcome({
            locationUuid: context.locationUuid,
            candidateId: context.candidateId ?? null,
            specialHireId: context.specialHireId ?? null,
            employerUuid: context.employerUuid,
            result: { outcome: payload.outcome, natural: payload.natural, total: payload.total, parts: payload.parts },
            signingGp,
            // one id per ROLL: every GM socket that receives this delivery
            // claims with the same id, so exactly one applies it
            resolutionId: foundry.utils.randomID(),
          });
        } else if (payload.mode === "loyalty") {
          // Loyalty pages open on the GM client; apply directly there.
          const { applyLoyaltyOutcome } = await import("../engine/events.mjs");
          const actor = context.actorUuid ? await fromUuid(context.actorUuid) : null;
          if (actor) {
            await applyLoyaltyOutcome(actor.actor ?? actor, {
              outcome: payload.outcome,
              total: payload.total,
              note: context.reason ?? "",
            });
          }
        } else if (payload.mode === "obedience") {
          const { applyObedienceOutcome } = await import("../engine/events.mjs");
          const actor = context.actorUuid ? await fromUuid(context.actorUuid) : null;
          if (actor) {
            await applyObedienceOutcome(actor.actor ?? actor, {
              outcome: payload.outcome,
              total: payload.total,
              note: context.reason ?? "",
            });
          }
        }
        return;
      }
      // --- Core-tone rolls against managed hirelings: log them ---
      const target = payload?.target;
      if (!target || !adapter.isRetainer(target)) return;
      if (game.user !== game.users.activeGM) return;
      await HenchmanRecord.logEvent(target, {
        type: "adjustment",
        note: game.i18n.format("ACKS-HENCHMEN.influence.rollNote", {
          name: payload.actor?.name ?? "?",
          tone: payload.tone ?? payload.mode ?? "",
          band: payload.band ?? payload.outcome ?? "",
          attitude: payload.newAttitude ?? "",
        }),
        rollTotal: payload.total,
        outcome: payload.band ?? payload.outcome ?? "",
      });
    } catch (err) {
      console.warn(`${MODULE_ID} | acksInfluenceRollComplete handling failed`, err);
    }
  });
  console.log(`${MODULE_ID} | acks-influence integration active (hostsModes: ${hostsModes()})`);
}

/**
 * Open the core influence roller for an employer with the location's
 * slander penalty injected (RR 162's town-wide −1).
 */
export function openInfluenceFor(employer, location = null, targetActor = null) {
  const api = influenceApi();
  if (!api) return null;
  const modifiers = [];
  const slanderCount = location?.system?.slanderCountFor?.({ employerUuid: employer?.uuid }) ?? 0;
  if (slanderCount > 0) {
    modifiers.push({
      label: game.i18n.format("ACKS-HENCHMEN.influence.slanderLabel", { name: location.name }),
      value: -slanderCount,
    });
  }
  return api.open(employer, { targetActor, modifiers });
}
