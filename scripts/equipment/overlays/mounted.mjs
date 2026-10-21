/* global game, Hooks, ChatMessage, foundry */
/**
 * Overlay: mounted combat (RR p. 308; acks-rules/acks-equipment/RULES.md §15).
 * Gated by the `overlayMounted` world setting. The blocker that section
 * recorded — "nothing models a mounted state" — is gone: acks-lib's
 * attachment layer knows who rides what, and this overlay hangs the RULES'
 * bookkeeping off it.
 *
 * What it automates is the STRUCTURE — the triggers and the action economy:
 *
 *  - **Staying-mounted saves.** After every attack by a mounted rider or by
 *    a ridden mount, a rider without Riding or Mounted Combat owes a
 *    Paralysis save (the post-attack seam, `POST_ATTACK_HOOK`). Whenever the
 *    rider or the mount takes damage, a rider without a military saddle owes
 *    one too — waived only by holding BOTH proficiencies. The overlay
 *    whispers the save prompt to the Judge and the rider's player; rolling
 *    it and applying the page's consequence stay at the table.
 *  - **The action-economy card.** Who may act — {rider, passengers, mount} ×
 *    {mount moved, stationary, charged}, a war-trained mount joining the
 *    charge — and the vehicle mirror for TRANSPORTERS (a back-carrier may
 *    fight where a puller may only join a charge, and a hand-carrier never
 *    fights), rendered as a chat card on demand.
 *
 * What it deliberately does NOT automate yet: the proficiencies' printed
 * attack bonuses and the subjacent height-advantage modifier. Those are
 * VALUES that arrive with the imported abilities; pushing them into the
 * attack term stack waits on the abilities→attack effects bridge
 * (docs/equipment/ROADMAP.md). The card states that they apply; the numbers
 * come from the reader's own imported proficiency.
 */
import { overlayGate } from "../settings.mjs";
import { MODULE_ID, SETTINGS } from "../constants.mjs";
import { POST_ATTACK_HOOK } from "../../lib/patches/attack-throw.mjs";
import { mountOf, riderOf } from "../../lib/mount.mjs";
import { abilityRank } from "../../lib/capabilities.mjs";
import { gmIds, isPrimaryGM, numOrNull } from "../../lib/util.mjs";
import { SIZES } from "../../monsters/config.mjs";

export const overlayEnabled = overlayGate(SETTINGS.OVERLAY_MOUNTED);

const L = (key, data = {}) => game.i18n.format(`ACKS-EQUIPMENT.mounted.${key}`, data);

/* -------------------------------------------------------------------- */
/*  Pure rules shapes (committed tests)                                 */
/* -------------------------------------------------------------------- */

/** The size ladder, smallest first — SIZES' own declaration order. */
export const SIZE_ORDER = Object.freeze(Object.keys(SIZES));

/** A size key's rung; an unstated size is man-sized. */
export const sizeRankOf = (key) => {
  const i = SIZE_ORDER.indexOf(key);
  return i < 0 ? SIZE_ORDER.indexOf("man") : i;
};

/**
 * Height advantage: the rider's mount stands taller than the target — or the
 * target's own mount — so the target counts as subjacent. The comparison is
 * structural; what subjacency is WORTH is the combat rule's own number.
 */
export function heightAdvantage({ attackerMountSize, defenderSize, defenderMountSize = null }) {
  return sizeRankOf(attackerMountSize) > sizeRankOf(defenderMountSize ?? defenderSize);
}

/**
 * Who owes a staying-mounted save after an ATTACK: the rider, whenever the
 * rider or the mount attacks, unless the rider holds Riding or Mounted
 * Combat.
 */
export function attackSaveDue({ hasWaiver }) {
  return !hasWaiver;
}

/**
 * Who owes one on DAMAGE to either half of the pair: the rider, without a
 * military saddle — waived only by holding BOTH proficiencies.
 */
export function damageSaveDue({ militarySaddle, hasBothProficiencies }) {
  return !militarySaddle && !hasBothProficiencies;
}

/**
 * The mounted action economy for one round, by what the mount did.
 * `oneOf` means exactly one of the three parties acts; `mountOr` means the
 * mount alone, or the riders together; `charge` frees rider and passengers,
 * with a war-trained mount joining.
 */
export function whoMayAct(state, { warTrained = false } = {}) {
  if (state === "stationary") return { kind: "mountOr", rider: true, passengers: true, mount: true };
  if (state === "charged") return { kind: "charge", rider: true, passengers: true, mount: warTrained };
  return { kind: "oneOf", rider: true, passengers: true, mount: true };
}

/**
 * The vehicle mirror, for TRANSPORTERS only — the rule discriminates on HOW
 * the vehicle is carried: a back-carrier (a howdah's beast) may fight even
 * without a charge; a puller may only join one; a hand-carrier (a
 * palanquin's bearers) never fights.
 */
export function vehicleTransportersMayAct({ carriage = "pulled", charged = false } = {}) {
  if (carriage === "handCarried") return false;
  if (carriage === "backCarried") return true;
  return !!charged;
}

/* -------------------------------------------------------------------- */
/*  Foundry reads                                                       */
/* -------------------------------------------------------------------- */

/** Riding or Mounted Combat, read from the rider's real abilities. */
export function riderWaivers(rider) {
  const riding = abilityRank(rider, "Riding", "kw:riding") > 0;
  const mountedCombat = abilityRank(rider, "Mounted Combat", "kw:mountedcombat") > 0;
  return { riding, mountedCombat, either: riding || mountedCombat, both: riding && mountedCombat };
}

/** A military saddle among the MOUNT's own gear (the saddle is tack). */
export function hasMilitarySaddle(mount) {
  return (mount?.items ?? []).some((it) => /military\s+saddle|saddle,\s*military/i.test(it.name ?? ""));
}

/**
 * A war-trained mount. An explicit training kind on the sheet is
 * authoritative; "untrained" is the schema INITIAL, so it and blank read as
 * unstated and fall to the name — an imported war horse nobody hand-edited
 * still shows its line on the advisory card.
 */
export function looksWarTrained(mount) {
  const stated = String(mount?.system?.animal?.training ?? mount?.system?.training ?? "").toLowerCase();
  if (stated && stated !== "untrained") return stated === "war";
  return /\bwar\b/i.test(mount?.name ?? "");
}

/* -------------------------------------------------------------------- */
/*  Prompts and the card                                                */
/* -------------------------------------------------------------------- */

async function whisperSave(rider, mount, reasonKey) {
  const ownerIds = game.users.filter((u) => rider.testUserPermission?.(u, "OWNER")).map((u) => u.id);
  await ChatMessage.create({
    speaker: { alias: L("speaker") },
    whisper: [...new Set([...gmIds(), ...ownerIds])],
    content: `<p><b>${L("saveTitle", { rider: rider.name })}</b></p><p>${L(reasonKey, { rider: rider.name, mount: mount?.name ?? "?" })}</p><p class="hint">${L("saveHint")}</p>`,
  });
}

/** The operation key under which a pre-update tells the update that hit points fell. */
const HP_FELL = "mountedHpFell";

/**
 * Before an actor's update: mark the operation when it lowers the hit points.
 * The earlier value exists only here, and only on the client making the
 * change; the mark travels with the operation to every client.
 */
function markHpFall(actor, changed, options) {
  if (!overlayEnabled()) return;
  const next = numOrNull(foundry.utils.getProperty(changed, "system.hp.value"));
  const prior = numOrNull(actor?.system?.hp?.value);
  if (next == null || prior == null || next >= prior) return;
  options[MODULE_ID] = { ...options[MODULE_ID], [HP_FELL]: true };
}

/** After a marked update: the save either half's damage costs, said by the primary GM's client alone. */
function promptOnHpFall(actor, _changed, options) {
  if (!options?.[MODULE_ID]?.[HP_FELL] || !overlayEnabled() || !isPrimaryGM()) return;
  const asRider = mountOf(actor) ? { rider: actor, mount: mountOf(actor) } : null;
  const asMount = riderOf(actor) ? { rider: riderOf(actor), mount: actor } : null;
  const pair = asRider ?? asMount;
  if (!pair) return;
  const waivers = riderWaivers(pair.rider);
  if (damageSaveDue({ militarySaddle: hasMilitarySaddle(pair.mount), hasBothProficiencies: waivers.both })) {
    void whisperSave(pair.rider, pair.mount, "onDamage");
  }
}

/**
 * The seams. Registered once by equipment's module.mjs; every handler gates
 * on the world setting so the toggle works without a reload.
 */
export function registerMountedOverlay() {
  // After every attack: the attacker as rider, or the attacker as mount.
  Hooks.on(POST_ATTACK_HOOK, (actor) => {
    if (!overlayEnabled()) return;
    const mount = mountOf(actor);
    if (mount) {
      if (attackSaveDue({ hasWaiver: riderWaivers(actor).either })) void whisperSave(actor, mount, "afterAttack");
      return;
    }
    const rider = riderOf(actor);
    if (rider && attackSaveDue({ hasWaiver: riderWaivers(rider).either })) {
      void whisperSave(rider, actor, "afterMountAttack");
    }
  });

  // On damage to either half of the pair. A pre-update runs only on the
  // client making the change, so it marks the fall; the update reaches every
  // client, and only the primary GM's speaks, so the prompt is said once
  // whoever dealt the damage. A token actor's update runs the actor's
  // pre-update; a write to its ActorDelta document runs the delta's.
  Hooks.on("preUpdateActor", markHpFall);
  Hooks.on("preUpdateActorDelta", (delta, changed, options) => markHpFall(delta?.syntheticActor, changed, options));
  Hooks.on("updateActor", promptOnHpFall);
}

/**
 * The action-economy card for an actor's current seat: a rider's mount
 * matrix, or a vehicle occupant's transporter rule. Published on the
 * equipment api; a Judge posts it when the question comes up.
 */
export async function mountedCombatCard(actor) {
  const mount = mountOf(actor) ?? (riderOf(actor) ? actor : null);
  if (!mount) return null;
  const rider = mountOf(actor) ? actor : riderOf(actor);
  const warTrained = looksWarTrained(mount === actor ? actor : mount);
  const rows = ["moved", "stationary", "charged"]
    .map((state) => {
      const may = whoMayAct(state, { warTrained });
      return `<tr><td>${L(`state.${state}`)}</td><td>${L(`economy.${may.kind}`, { mountJoins: may.mount })}${state === "charged" && may.mount ? ` ${L("economy.warMountJoins")}` : ""}</td></tr>`;
    })
    .join("");
  const waivers = riderWaivers(rider);
  const saves = [
    waivers.either ? L("saves.attackWaived") : L("saves.attackDue"),
    hasMilitarySaddle(mount === actor ? actor : mount) || waivers.both ? L("saves.damageWaived") : L("saves.damageDue"),
  ];
  return ChatMessage.create({
    speaker: { alias: L("speaker") },
    content:
      `<p><b>${L("cardTitle", { rider: rider?.name ?? "?", mount: (mount === actor ? actor : mount).name })}</b></p>` +
      `<table><tr><th>${L("state.header")}</th><th>${L("economy.header")}</th></tr>${rows}</table>` +
      `<p class="hint">${saves.join(" ")}</p><p class="hint">${L("bonusesHint")}</p>`,
  });
}
