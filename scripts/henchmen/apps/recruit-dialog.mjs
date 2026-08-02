/* global game, ui, foundry, ChatMessage, Hooks */
/**
 * Recruit flow — the Reaction to Hiring Offer (RR 162) for market candidates
 * AND special hires (real actors). When acks-influence hosts the modes (apiVersion 3+) the
 * roll renders as an influence-hosted "hiring" page (consistent UI, auto
 * subject/target detection, core tones hidden); otherwise the module's own
 * ThrowDialog carries it. Every attempt is tracked PER NPC (refusals build
 * the cumulative −1; refuse-and-slander blocks the party permanently).
 * Mutations (actor creation, location writes) execute on the GM client.
 */
import { MODULE_ID, HOOKS } from "../constants.mjs";
import { openThrowDialog } from "./throw-dialog.mjs";
import { collectEffectModifiers, toDialogModifiers } from "../effects.mjs";
import { signingBonusCost } from "../rules/wages.mjs";
import { henchmanWage } from "../rules/wages.mjs";
import { hire, updateCandidate, hireExistingActor, updateSpecialHire } from "../engine/hire.mjs";
import * as adapter from "../acks-adapter.mjs";
import { executeAsGM, registerSocketAction } from "../sockets.mjs";
import { hostsModes, openHiringViaInfluence } from "../integrations/influence.mjs";
import { now } from "../time.mjs";

function hasBribery(employer) {
  return (employer?.items ?? []).some(
    (i) => (i.type === "ability" || i.type === "item") && /^bribery/i.test(i.name ?? "")
  );
}

/** Resolve which character is attempting the recruitment. Players offer on
 *  behalf of characters they OWN; GMs may pick any PC. */
export async function pickEmployer(preferred) {
  if (preferred) return preferred;
  if (game.user.character) return game.user.character;
  const choices = game.actors.filter(
    (a) =>
      a.type === "character" &&
      !a.system?.retainer?.enabled &&
      (game.user.isGM || a.testUserPermission(game.user, "OWNER"))
  );
  if (!choices.length) return null;
  if (choices.length === 1) return choices[0];
  const options = choices.map((a) => `<option value="${a.id}">${a.name}</option>`).join("");
  const id = await foundry.applications.api.DialogV2.prompt({
    window: { title: game.i18n.localize("ACKS-HENCHMEN.recruit.pickEmployer") },
    content: `<select name="employerId">${options}</select>`,
    ok: {
      callback: (_event, button) => button.form.elements.employerId.value,
    },
  }).catch(() => null);
  return id ? game.actors.get(id) : null;
}

/** Signing-bonus tiers priced from the wage and Bribery (RR 162 + screen). */
function signingSetup(employer, wage) {
  const bribery = hasBribery(employer);
  const options = [{ label: game.i18n.localize("ACKS-HENCHMEN.mod.signingBonusNone"), value: 0 }];
  const tiers = {};
  for (const tier of [1, 2, 3]) {
    const cost = signingBonusCost(tier, wage, bribery);
    if (!cost) continue;
    tiers[tier] = cost.gp;
    options.push({
      label: game.i18n.format("ACKS-HENCHMEN.mod.signingBonusTierLabel", {
        gp: cost.gp,
        wages: game.i18n.localize(`ACKS-HENCHMEN.wages.${cost.wages}`),
      }),
      value: tier,
    });
  }
  return { bribery, options, tiers };
}

/** Shared launcher for candidates and special hires. */
async function launchOffer({ location, employer, offer }) {
  const signing = signingSetup(employer, offer.wage);
  const slanderCount = location.system.slanderCountFor?.({ employerUuid: employer.uuid }) ?? 0;

  if (hostsModes()) {
    openHiringViaInfluence({
      employer,
      targetActor: offer.targetActor ?? null,
      targetName: offer.name,
      targetImg: offer.img ?? "",
      signingBonusOptions: signing.options,
      previousRefusals: offer.refusals,
      slanderCount,
      context: {
        locationUuid: location.uuid,
        candidateId: offer.candidateId ?? null,
        specialHireId: offer.specialHireId ?? null,
        employerUuid: employer.uuid,
        signingTiers: signing.tiers,
      },
    });
    return;
  }

  // Fallback: the module's own throw dialog.
  const optionLabels = { signingBonus: {} };
  for (const [tier, gp] of Object.entries(signing.tiers)) {
    optionLabels.signingBonus[`tier${tier}`] = game.i18n.format("ACKS-HENCHMEN.mod.signingBonusTierLabel", {
      gp,
      wages: game.i18n.localize(
        `ACKS-HENCHMEN.wages.${signingBonusCost(Number(tier), offer.wage, signing.bribery)?.wages ?? "week"}`
      ),
    });
  }
  openThrowDialog("reactionToHiring", {
    title: `${offer.name} — ${employer.name}`,
    actor: employer,
    derived: {
      chaMod: adapter.getChaMod(employer),
      previousRefusals: offer.refusals,
      slanderCount,
    },
    dynamicModifiers: toDialogModifiers(collectEffectModifiers(employer, "hiring")),
    optionLabels,
    infoText: game.i18n.format("ACKS-HENCHMEN.recruit.info", {
      name: offer.name,
      wage: offer.wage,
      bribery: signing.bribery
        ? game.i18n.localize("ACKS-HENCHMEN.recruit.briberyYes")
        : game.i18n.localize("ACKS-HENCHMEN.recruit.briberyNo"),
    }),
    onResolve: async (result) => {
      const signingTier = result.parts.find((p) => p.id === "signingBonus")?.value ?? 0;
      const signingGp = signingTier > 0 ? (signing.tiers[signingTier] ?? 0) : 0;
      await deliverHiringOutcome({
        locationUuid: location.uuid,
        candidateId: offer.candidateId ?? null,
        specialHireId: offer.specialHireId ?? null,
        employerUuid: employer.uuid,
        result: { outcome: result.outcome, natural: result.natural, total: result.total, parts: result.parts },
        signingGp,
        resolutionId: foundry.utils.randomID(), // multi-GM-socket claim key
      });
    },
  });
}

/** Recruit a rolled market candidate. */
export async function openRecruitDialog(location, candidateId, preferredEmployer = null) {
  const candidate = (location.system.candidates ?? []).find((c) => c.id === candidateId);
  if (!candidate) return;
  if (candidate.status === "slandered") {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.recruit.slanderedBlock"));
    return;
  }
  if (candidate.status !== "available") {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.recruit.notAvailable"));
    return;
  }
  const employer = await pickEmployer(preferredEmployer);
  if (!employer) {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.recruit.noEmployer"));
    return;
  }
  await launchOffer({
    location,
    employer,
    offer: {
      candidateId,
      name: candidate.name,
      wage: Number(candidate.wageGp) || 12,
      refusals: (candidate.refusals ?? []).length,
    },
  });
}

/** Recruit a special hire (a real actor: GM-placed or found on adventure). */
export async function openRecruitSpecial(location, specialHireId, preferredEmployer = null) {
  const entry = (location.system.specialHires ?? []).find((s) => s.id === specialHireId);
  if (!entry) return;
  if (entry.status !== "available") {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.recruit.notAvailable"));
    return;
  }
  if ((entry.refusals ?? []).some((r) => r.result === "refuseSlander")) {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.recruit.slanderedBlock"));
    return;
  }
  const employer = await pickEmployer(preferredEmployer);
  if (!employer) {
    ui.notifications.warn(game.i18n.localize("ACKS-HENCHMEN.recruit.noEmployer"));
    return;
  }
  const doc = await fromUuid(entry.actorUuid).catch(() => null);
  const target = doc?.actor ?? doc;
  const wage = Number(target?.system?.retainer?.wage) || henchmanWage(adapter.getWageLevel(target ?? {}));
  await launchOffer({
    location,
    employer,
    offer: {
      specialHireId,
      name: entry.name,
      img: entry.img,
      targetActor: target ?? null,
      wage,
      refusals: (entry.refusals ?? []).length,
    },
  });
}

/** GM-side executor for a resolved hiring throw (socket action + hook).
 *
 *  EXACTLY-ONCE under duplicate delivery. The same resolution reaches every
 *  socket of the addressed GM user (GM open in two windows, a co-GM) — found
 *  live 2026-07-22 as two hires, two actors, 12ms apart. Defense in depth:
 *  an in-flight key kills same-client duplicates, and a persisted CLAIM
 *  settles cross-socket races: each roll carries a resolutionId; the applier
 *  writes it on the candidate, waits a settle beat so every claimant's write
 *  lands, re-reads, and only the socket whose id survived applies. */
const inFlightOutcomes = new Set();
const CLAIM_SETTLE_MS = 300;

async function claimResolution(location, payload) {
  const resolutionId = payload.resolutionId;
  if (!resolutionId) return true; // legacy caller — apply unguarded
  const read = () => {
    const list = payload.candidateId ? location.system.candidates : location.system.specialHires;
    const id = payload.candidateId ?? payload.specialHireId;
    const entry = (list ?? []).find((e) => e.id === id);
    return entry ? (entry.toObject?.() ?? entry) : null;
  };
  const entry = read();
  if (!entry) return false;
  if (entry.lastResolutionId === resolutionId) return false; // replay of an applied roll
  const write = { lastResolutionId: resolutionId };
  if (payload.candidateId) await updateCandidate(location, payload.candidateId, write);
  else await updateSpecialHire(location, payload.specialHireId, write);
  await new Promise((r) => setTimeout(r, CLAIM_SETTLE_MS));
  return read()?.lastResolutionId === resolutionId; // last claim wins; losers abort
}

export async function handleHiringOutcomePayload(payload) {
  const key = `${payload.locationUuid}:${payload.candidateId ?? payload.specialHireId ?? ""}`;
  if (inFlightOutcomes.has(key)) return;
  inFlightOutcomes.add(key);
  try {
    const location = await fromUuid(payload.locationUuid);
    const employer = await fromUuid(payload.employerUuid);
    if (!location || !employer) return;
    if (!(await claimResolution(location.actor ?? location, payload))) return;
    await handleOutcome({
      location,
      candidateId: payload.candidateId,
      specialHireId: payload.specialHireId,
      employer: employer.actor ?? employer,
      result: payload.result,
      signingGp: payload.signingGp,
    });
  } finally {
    inFlightOutcomes.delete(key);
  }
}

/**
 * Route a resolved hiring roll to whoever can APPLY it — no GM client
 * required (user direction 2026-07-22): a seat that can write the location
 * (GM, or a player on an OWNER-default bulletin board) applies locally;
 * otherwise the GM socket relay carries it.
 */
export async function deliverHiringOutcome(payload) {
  const doc = await fromUuid(payload.locationUuid).catch(() => null);
  const location = doc?.actor ?? doc;
  const canLocal = game.user.isGM || (location?.testUserPermission?.(game.user, "OWNER") ?? false);
  if (canLocal) return handleHiringOutcomePayload(payload);
  return executeAsGM("hiringOutcome", payload);
}

/**
 * Materialize hires accepted while no seat could create actors (queued on
 * the location). Runs on GM clients: at ready and after due processing.
 */
export async function materializePendingHires(location) {
  if (!game.user.isGM) return;
  const pending = (location.system.pendingHires ?? []).map((p) => p.toObject?.() ?? foundry.utils.deepClone(p));
  if (!pending.length) return;
  const remaining = [];
  for (const entry of pending) {
    const employerDoc = await fromUuid(entry.employerUuid).catch(() => null);
    const employer = employerDoc?.actor ?? employerDoc;
    if (!employer) continue; // employer gone — drop the queue entry
    const opts = { elan: entry.result?.outcome === "acceptElan", signingBonusGp: entry.signingGp, origin: "market", fromQueue: true };
    const hired = entry.specialHireId
      ? await hireExistingActor(location, entry.specialHireId, employer, opts)
      : await hire(location, entry.candidateId, employer, opts);
    if (hired?.error && hired.error !== "not-available") {
      console.warn(`${MODULE_ID} | queued hire failed (${hired.error}) — keeping in queue`, entry);
      remaining.push(entry);
    }
  }
  await location.update({ "system.pendingHires": remaining });
}

registerSocketAction("hiringOutcome", handleHiringOutcomePayload);

async function handleOutcome({ location, candidateId, specialHireId, employer, result, signingGp }) {
  const outcome = result.outcome;
  Hooks.callAll(HOOKS.HIRING_OUTCOME, { location, candidateId, specialHireId, employer, result });

  const pushRefusal = async (kind) => {
    const refusal = { employerUuid: employer.uuid, time: now(), result: kind };
    if (specialHireId) {
      const entry = (location.system.specialHires ?? []).find((s) => s.id === specialHireId);
      await updateSpecialHire(location, specialHireId, {
        refusals: [...(entry?.refusals ?? []).map((r) => r.toObject?.() ?? r), refusal],
      });
    } else if (candidateId) {
      const candidate = (location.system.candidates ?? []).find((c) => c.id === candidateId);
      await updateCandidate(location, candidateId, {
        refusals: [...(candidate?.refusals ?? []).map((r) => r.toObject?.() ?? r), refusal],
      });
    }
  };

  switch (outcome) {
    case "acceptElan":
    case "accept": {
      const opts = { elan: outcome === "acceptElan", signingBonusGp: signingGp, origin: "market" };
      const hired = specialHireId
        ? await hireExistingActor(location, specialHireId, employer, opts)
        : await hire(location, candidateId, employer, opts);
      if (hired.error === "actor-create-denied") {
        // No GM online and this seat cannot create actors: RESERVE the
        // candidate and QUEUE the hire — it materializes at next GM connect.
        const entry = {
          id: foundry.utils.randomID(),
          candidateId: candidateId ?? "",
          specialHireId: specialHireId ?? "",
          employerUuid: employer.uuid,
          signingGp: signingGp ?? 0,
          time: now(),
          result: { outcome: result.outcome, natural: result.natural ?? 0, total: result.total ?? 0 },
        };
        const queue = [...(location.system.pendingHires ?? []).map((p) => p.toObject?.() ?? p), entry];
        const log = [...(location.system.marketLog ?? []).map((l) => l.toObject?.() ?? l), { time: now(), type: "reserve", note: `queued hire for ${employer.name}` }].slice(-100);
        await location.update({ "system.pendingHires": queue, "system.marketLog": log });
        if (candidateId) await updateCandidate(location, candidateId, { status: "reserved" });
        ChatMessage.create({
          content: game.i18n.format("ACKS-HENCHMEN.hire.queuedChat", { employer: employer.name }),
          speaker: ChatMessage.getSpeaker({ actor: employer }),
        });
      } else if (hired.error) {
        ui.notifications.error(game.i18n.localize(`ACKS-HENCHMEN.hire.error.${hired.error}`));
      }
      break;
    }
    case "tryAgain": {
      await pushRefusal("tryAgain");
      ChatMessage.create({
        content: game.i18n.format("ACKS-HENCHMEN.recruit.tryAgainChat", { employer: employer.name }),
        speaker: ChatMessage.getSpeaker({ actor: employer }),
      });
      break;
    }
    case "refuse": {
      await pushRefusal("refuse");
      break;
    }
    case "refuseSlander": {
      await pushRefusal("refuseSlander");
      let npcName = "";
      if (candidateId) {
        const candidate = (location.system.candidates ?? []).find((c) => c.id === candidateId);
        npcName = candidate?.name ?? "";
        await updateCandidate(location, candidateId, { status: "slandered" });
      } else if (specialHireId) {
        npcName = (location.system.specialHires ?? []).find((s) => s.id === specialHireId)?.name ?? "";
      }
      const slander = [
        ...(location.system.slander ?? []).map((s) => s.toObject?.() ?? s),
        {
          subject: { scope: "party", uuid: employer.uuid },
          npcName,
          time: now(),
          note: game.i18n.localize("ACKS-HENCHMEN.recruit.slanderNote"),
        },
      ];
      await location.update({ "system.slander": slander });
      Hooks.callAll(HOOKS.SLANDER_CHANGED, { location, subject: { scope: "party", uuid: employer.uuid } });
      break;
    }
  }
}
