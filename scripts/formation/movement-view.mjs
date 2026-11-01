/* global game */
/**
 * What the party sheet shows of how the party moves: the pace line and the
 * group's five tiles for the Movement section, and each member's own row for
 * the Order tab. Reads `conveyance.mjs`; writes nothing.
 */
import { makeLoc } from "../lib/util.mjs";
import { MOVEMENT_MODES } from "../lib/movement-modes.mjs";
import {
  carriedLoad,
  cellBodies,
  explorationSpeedOf,
  getMemberActor,
  memberPace,
  paceSetter,
  partySpeed,
  realMembers,
} from "./formation-model.mjs";
import { AUTOMATIC, ON_FOOT, bestConveyance, carrierPool, heldReason, offersFor, pinOf, rideLabel, rideOf } from "./conveyance.mjs";

const loc = makeLoc("ACKS-FORMATION");

/** Each way of moving's glyph, shared by a tile and the pace line. */
const MODE_ICONS = Object.freeze({
  foot: "fa-solid fa-person-walking",
  mounted: "fa-solid fa-horse",
  vehicle: "fa-solid fa-wagon-covered",
  flying: "fa-solid fa-feather",
  vessel: "fa-solid fa-sailboat",
});

const KIND_MODES = Object.freeze({ foot: "foot", animal: "mounted", land: "vehicle", vessel: "vessel" });

/** The carrier a member could take for a faster ride, or null with none. */
function fasterRide(ride, actor, formation, o) {
  const best = bestConveyance(actor, formation, o);
  return best.carrier && best.carrier.uuid !== ride.carrier?.uuid ? best.carrier : null;
}

/** How many ride, are carried and walk: bodies on the march, a stack counted whole. */
function countsLine(formation, load) {
  const tally = { ride: 0, carried: 0, walk: 0 };
  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor || member.left) continue;
    const { kind } = rideOf(formation, member, actor, load);
    const bucket = { foot: "walk", animal: "ride" }[kind] ?? "carried";
    tally[bucket] += cellBodies(member);
  }
  return Object.entries(tally)
    .filter(([, n]) => n > 0)
    .map(([key, n]) => loc(`conveyance.count.${key}`, { n }));
}

/** Every member's pace, the figure's parts for its tooltip. */
function paceParts(formation, load) {
  return realMembers(formation).flatMap((member) => {
    const actor = getMemberActor(member);
    if (!actor || member.left) return [];
    const speed = memberPace(formation, member, actor, load);
    return typeof speed === "number" ? [`${actor.name} ${speed}'`] : [];
  });
}

/** The line that heads the section: who sets the pace and on what, and the pace. */
function paceLine(formation, load, o) {
  const setter = paceSetter(formation);
  if (!setter) return null;
  const { member, actor } = setter;
  const ride = rideOf(formation, member, actor, load);
  const held = heldReason(member, actor, load);
  const faster = held ? null : fasterRide(ride, actor, formation, o);
  const why = held ? loc(`conveyance.held.${held}`) : !faster && !ride.carrier ? loc("conveyance.noRide") : null;
  return {
    lead: loc("conveyance.paceSet", { name: actor.name, how: rideLabel(ride) }),
    sub: [why, ...countsLine(formation, load)].filter(Boolean).join(" · "),
    icon: MODE_ICONS[KIND_MODES[ride.kind]],
    speed: partySpeed(formation, { dark: false }),
    tip: loc("conveyance.paceParts", { parts: paceParts(formation, load).join(" · ") }),
    faster: faster ? loc("conveyance.faster", { name: faster.name }) : null,
  };
}

/**
 * The Movement section: the pace line, the five tiles and the state of the
 * Judge's word. A tile lights for the word where one stands, and otherwise for
 * how the party reads, so a press with nobody moved still shows as pressed.
 * @param {object} formation
 * @param {object} t  the `travelOf` read
 * @returns {object} `pace`, `tiles`, `automatic`, `judge`, `canUndo`
 */
export function buildMovementView(formation, t) {
  const judge = !!game.user?.isGM;
  const lit = t.movement.set ?? t.movement.mode;
  return {
    pace: paceLine(formation, carriedLoad(formation), { pool: carrierPool(), t }),
    tiles: Object.entries(MOVEMENT_MODES).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      icon: MODE_ICONS[key],
      pressed: key === lit,
    })),
    automatic: !t.movement.set,
    judge,
    canUndo: judge && !!t.lastArrangement,
  };
}

/** Where a pick's figure comes from: a beast's own pace, or a wagon's with the member aboard. */
function offerRow(offer, pinned) {
  const { carrier, kind, speed } = offer;
  return {
    pick: carrier.uuid,
    label: carrier.name,
    figure: speed,
    tip: loc(`conveyance.offerTip.${kind}`, { name: carrier.name }),
    pressed: pinned === carrier.uuid,
  };
}

/**
 * One member's row on the Order tab: how they travel and, where nothing holds
 * them, what they may pick from. A reader with no say over the member sees the
 * first half alone.
 * @param {object} formation
 * @param {object} member
 * @param {Actor} actor
 * @param {object} o
 * @param {boolean} o.canControl  the viewer may press for this member
 * @param {object} o.load  the `carriedLoad` read
 * @param {Array} o.pool  the `carrierPool` read
 * @param {object} o.t  the `travelOf` read
 * @returns {object} `how`, and `held`, or `faster`, `pinOut`, `options`
 */
export function buildMemberConveyance(formation, member, actor, { canControl, load, pool, t }) {
  const ride = rideOf(formation, member, actor, load);
  const how = rideLabel(ride);
  const held = heldReason(member, actor, load);
  if (held) return { how, held: loc(`conveyance.held.${held}`) };
  const pinned = pinOf(actor);
  const offers = offersFor(actor, formation, { pool, t });
  const faster = fasterRide(ride, actor, formation, { pool, t });
  return {
    how,
    held: null,
    faster: faster ? loc("conveyance.couldRide", { name: faster.name }) : null,
    pinOut: !!pinned && pinned !== ON_FOOT && !offers.some((offer) => offer.carrier.uuid === pinned),
    options: canControl
      ? [
        { pick: AUTOMATIC, label: loc("conveyance.automatic"), figure: null, tip: null, pressed: !pinned },
        { pick: ON_FOOT, label: loc("conveyance.onFoot"), figure: explorationSpeedOf(actor), tip: loc("conveyance.offerTip.foot"), pressed: pinned === ON_FOOT },
        // A wagon that cannot roll would stop the party, so it is no pick. A vessel's null is another clock.
        ...offers.filter((offer) => offer.speed !== 0).map((offer) => offerRow(offer, pinned)),
      ]
      : null,
  };
}
