/* global game, foundry, fromUuid, CONFIG, Roll, ui */
import { MODULE_ID, TRAP_ITEM_TYPE, TRAP_ZONE_TYPE } from "./constants.mjs";
import { getPartyToken, isDown, isHurried, laidOrder, updateFormation } from "./formation-model.mjs";
import { segmentDistance, setWallTrap, trapWallsCrossed, wallTrap } from "./trap-walls.mjs";
import { PARTY_CHECKS, partText, resolveCheck } from "./party-rolls.mjs";
import { advanceRounds, advanceTurns } from "./turn-engine.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { makeLoc } from "../lib/util.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { findZone, regionEdges } from "./zones.mjs";
import { sceneFeetPerCell } from "../lib/distance-units.mjs";
import {
  CRUDE,
  RESOLUTIONS,
  STATES,
  autoSearchers,
  damageTaken,
  disarmPlan,
  firingPlan,
  isBotch,
  lockAfterFailure,
  poleLeadRanks,
  probeSequence,
  repeatLocked,
  searcherReachFeet,
  trapFigures,
  triggerFires,
  victimsOf,
} from "./trap-rules.mjs";

/**
 * "Trap Zone" scene-region behavior: draw a Region over the squares a trap
 * covers, and the party walking through it is resolved by the book.
 *
 * The sequence: anyone searching the ground throws first, then the pole, then
 * the party itself rank by rank, each with its own secret die. The first throw
 * inside the trigger band ends the sequence. The reaches, the die and the band
 * are imported figures (`trapFigures`); a figure not imported is said on the
 * card and never defaulted.
 *
 * Everything the Judge sees is whispered, including a trap the party crossed
 * untouched, which is reported to the Judge alone.
 *
 * The rule itself (probe order, who is caught, the disarm throw, the botch
 * bands) is `trap-rules.mjs`, which holds no dice and no documents. This file
 * is the world: the zone's stored state, the throws, and the cards. See
 * docs/formation/MODEL.md, "Traps".
 */

const LANG_PREFIX = "ACKS-FORMATION.traps";
const loc = makeLoc(LANG_PREFIX);

/** The trap zone's behavior sub-type id, defined in constants.mjs so Foundry-free code can name it. */
export { TRAP_ZONE_TYPE };

/**
 * Update option marking a token write as the trap's own halt. The movement
 * hook ignores it: a halt costs no dungeon turns and must not start a second
 * trap check while the first is still resolving.
 */
export const HALT_OPTION = `${MODULE_ID}.trapHalt`;

/* -------------------------------------------- */
/*  The zone, as data                           */
/* -------------------------------------------- */

/**
 * One trap, buried in one place.
 *
 * The zone holds a reference to a trap Item and the state of this burial
 * (armed, spotted, spent), and nothing else; what the trap is belongs to the
 * trap document. A zone naming no trap resolves nothing.
 */
export class TrapZoneBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
  static LOCALIZATION_PREFIXES = ["ACKS-FORMATION.TRAP_ZONE"];

  static defineSchema() {
    const fields = foundry.data.fields;
    return {
      /** The trap Item this zone is an instance of. */
      trapUuid: new fields.DocumentUUIDField({ type: "Item" }),

      state: new fields.StringField({ required: true, initial: STATES.armed, choices: Object.values(STATES) }),
      /**
       * Who has already failed a hasty attempt here, and at what level.
       * Cleared by re-arming.
       */
      repeatLock: new fields.ObjectField(),
      /** The same ledger for the automatic hasty search, which has its own. */
      searchLock: new fields.ObjectField(),
      /** Has the party learned this trap is here? Not derivable from the state. */
      known: new fields.BooleanField({ initial: false }),
    };
  }
}

/** Register the behavior subtype (called from the init hook). */
export function registerTrapZone() {
  CONFIG.RegionBehavior.dataModels[TRAP_ZONE_TYPE] = TrapZoneBehavior;
  if (CONFIG.RegionBehavior.typeIcons) CONFIG.RegionBehavior.typeIcons[TRAP_ZONE_TYPE] = "fa-solid fa-triangle-exclamation";
}

/** The trap zone the party token currently stands in, if any. */
export function findTrapZone(formation) {
  return findZone(formation, TRAP_ZONE_TYPE);
}


/* -------------------------------------------- */
/*  Placements                                  */
/* -------------------------------------------- */

/**
 * Where a trap is buried, behind one interface: along a wall the party crosses
 * or over a region it walks into. The rules reach a placement only through
 * these members.
 *
 * @typedef {object} Placement
 * @property {"zone"|"wall"} kind
 * @property {string} uuid the placement document's own uuid — what a UI targets
 * @property {string} trapUuid
 * @property {string} state one of `STATES`
 * @property {boolean} known has the party found it?
 * @property {Record<string, number>} repeatLock
 * @property {Record<string, number>} searchLock
 * @property {(patch: object) => Promise<unknown>} write
 */

/** The region behavior as a placement. */
export function zonePlacement(zone) {
  const s = zone.behavior.system;
  return {
    kind: "zone",
    doc: zone.behavior,
    region: zone.region,
    uuid: zone.behavior.uuid,
    trapUuid: s.trapUuid ?? "",
    state: s.state,
    known: !!s.known,
    repeatLock: s.repeatLock ?? {},
    searchLock: s.searchLock ?? {},
    // Objects go in as forced replacements: an update merges, so a patch
    // emptying a ledger would leave every entry standing.
    write: (patch) =>
      zone.behavior.update(
        Object.fromEntries(
          Object.entries(patch).map(([k, v]) => [
            `system.${k}`,
            v && typeof v === "object" && !Array.isArray(v) ? foundry.data.operators.ForcedReplacement.create(v) : v,
          ]),
        ),
      ),
  };
}

/** A trapped wall as a placement. */
export function wallPlacement(wall) {
  const t = wallTrap(wall) ?? {};
  return {
    kind: "wall",
    doc: wall,
    uuid: wall.uuid,
    trapUuid: t.trapUuid ?? "",
    state: t.state ?? STATES.armed,
    known: !!t.known,
    repeatLock: t.repeatLock ?? {},
    searchLock: t.searchLock ?? {},
    write: (patch) => setWallTrap(wall, patch),
  };
}

/** The trap document a placement names, or null. */
export async function trapFor(placement) {
  if (!placement?.trapUuid) return null;
  const item = await fromUuid(placement.trapUuid);
  return item?.type === TRAP_ITEM_TYPE ? item : null;
}

/**
 * The placement the party is standing in or has just crossed, whichever is
 * live; a crossed wall wins over a region, as the line was met first.
 */
export async function livePlacement(formation, { from = null, to = null } = {}) {
  const token = getPartyToken(formation);
  if (token && from && to) {
    // `from`/`to` arrive as the token's top-left corner; what meets a tripwire
    // is its centre, so the path is shifted onto it before anything is
    // intersected, and `haltParty` shifts the crossing back.
    const gs = token.parent.grid.size;
    const half = { x: (token.width * gs) / 2, y: (token.height * gs) / 2 };
    const path = [from, to].map((p) => ({ x: p.x + half.x, y: p.y + half.y }));
    const crossed = trapWallsCrossed(token.parent, path[0], path[1]).find((h) => h.trap.state === STATES.armed);
    // `approach` is where the party came from, in centre coordinates, so the
    // halt pulls up on the near side of the line.
    if (crossed) return { placement: wallPlacement(crossed.wall), haltAt: crossed.at, approach: path[0] };
  }
  const zone = findTrapZone(formation);
  if (zone && zone.behavior.system.state === STATES.armed) {
    return { placement: zonePlacement(zone), haltAt: null, approach: null };
  }
  return { placement: null, haltAt: null, approach: null };
}

/* -------------------------------------------- */
/*  Everything within reach                     */
/* -------------------------------------------- */

/**
 * The ground the party covered, in canvas pixels and centre coordinates; a
 * standing party is a zero-length segment at its own centre.
 *
 * @returns {{seg: number[], gs: number, feetPerPixel: number, halfToken: number}|null}
 *   null for a scene that says no cell size: no distance in feet can be read off it
 */
function partyPath(formation, { from = null, to = null } = {}) {
  const token = getPartyToken(formation);
  if (!token) return null;
  const scene = token.parent;
  const gs = scene.grid.size;
  const feetPerCell = sceneFeetPerCell(scene);
  if (!(feetPerCell > 0) || !(gs > 0)) return null;
  const half = { x: (token.width * gs) / 2, y: (token.height * gs) / 2 };
  const centre = (p) => ({ x: p.x + half.x, y: p.y + half.y });
  const a = centre(from ?? { x: token.x, y: token.y });
  const b = centre(to ?? { x: token.x, y: token.y });
  return {
    scene,
    gs,
    seg: [a.x, a.y, b.x, b.y],
    // Distances are measured from the token's edge, not its centre: a party
    // token is often larger than a square.
    halfToken: Math.max(half.x, half.y),
    feetPerPixel: feetPerCell / gs,
  };
}

/** How far a placement lies from the ground the party covered, in feet. */
function placementDistanceFeet(placement, path) {
  if (!path) return Infinity;
  let px;
  if (placement.kind === "wall") {
    px = segmentDistance(path.seg, placement.doc.c);
  } else {
    const edges = regionEdges(placement.region);
    if (!edges.length) return Infinity;
    px = Math.min(...edges.map((e) => segmentDistance(path.seg, e)));
    // Inside the outline is zero away; the edge distance alone would put a
    // party in the middle of a region far from it.
    const inside = [
      { x: path.seg[0], y: path.seg[1] },
      { x: path.seg[2], y: path.seg[3] },
    ].some((pt) => edges.length && pointInsideEdges(edges, pt));
    if (inside) px = 0;
  }
  return Math.max(0, px - path.halfToken) * path.feetPerPixel;
}

/** Even-odd containment against a region's own edge list. */
function pointInsideEdges(edges, pt) {
  let inside = false;
  for (const [x1, y1, x2, y2] of edges) {
    const hits = y1 > pt.y !== y2 > pt.y && pt.x < ((x2 - x1) * (pt.y - y1)) / (y2 - y1 || 1e-9) + x1;
    if (hits) inside = !inside;
  }
  return inside;
}

/**
 * How far from the party a trap can be and still be worked on, in feet: the
 * imported trapbreak reach, else 0, which reaches only a trap the party's
 * token is touching or standing in.
 */
export function trapbreakReach() {
  return trapFigures().trapbreakReachFeet ?? 0;
}

/**
 * Every trap placed on this scene, as placements — trapped walls and enabled
 * Trap Zone behaviors alike, read off the scene and not the canvas.
 */
export function allPlacements(scene) {
  const out = [];
  for (const wall of scene?.walls ?? []) {
    if (wallTrap(wall)) out.push(wallPlacement(wall));
  }
  for (const region of scene?.regions ?? []) {
    for (const behavior of region.behaviors) {
      if (behavior.type === TRAP_ZONE_TYPE && !behavior.disabled) out.push(zonePlacement({ region, behavior }));
    }
  }
  return out;
}

/**
 * The traps within `feet` of the party, nearest first, each carrying how far
 * off it is.
 *
 * @param {object} formation
 * @param {object} [opts]
 * @param {number} [opts.feet] the reach being measured; `trapbreakReach()` by
 *   default
 * @param {object} [opts.from] where the party started this move, if it moved
 * @param {object} [opts.to] where it ended
 * @returns {Array<Placement & {distanceFeet: number}>}
 */
export function placementsNear(formation, { feet = trapbreakReach(), from = null, to = null } = {}) {
  const path = partyPath(formation, { from, to });
  if (!path) return [];
  return allPlacements(path.scene)
    .map((placement) => ({ ...placement, distanceFeet: placementDistanceFeet(placement, path) }))
    .filter((p) => p.distanceFeet <= feet)
    .sort((a, b) => a.distanceFeet - b.distanceFeet);
}

/**
 * The traps within reach that the party knows about: what a Trapbreaking
 * attempt may be pointed at, and the only trap list a player-facing surface
 * may show.
 */
export function knownPlacementsNear(formation, feet = trapbreakReach()) {
  return placementsNear(formation, { feet }).filter((p) => p.known);
}

/** One placement by its document uuid, if it is within reach of the party. */
export function placementNearByUuid(formation, uuid, feet = trapbreakReach()) {
  return placementsNear(formation, { feet }).find((p) => p.uuid === uuid) ?? null;
}

/* -------------------------------------------- */
/*  Cards                                       */
/* -------------------------------------------- */

/** Whisper one card to the Judges. Traps are secret; nothing here is public, not even that dice were rolled. */
async function whisper(html, formation, rolls = []) {
  return postToJudges({
    content: html,
    rolls,
    speaker: { alias: formation?.name ?? game.i18n.localize(`${LANG_PREFIX}.title`) },
  });
}

/* -------------------------------------------- */
/*  Walking into it                             */
/* -------------------------------------------- */

/** The member record behind a marching-order row, which `isDown` reads a member's own hit points from. */
const memberOf = (formation, actorId) => formation?.members?.find((m) => m?.actorId === actorId) ?? null;

/**
 * The automatic hasty search, swept over every hidden trap the party came
 * within reach of, not merely the one it was about to step on. It runs on
 * every party move, silently, and says something only when a trap is spotted.
 * Who reaches is `autoSearchers`, by the imported reaches and the laid
 * column's rank depth.
 *
 * With no search reach imported only the front rank searches, and only the
 * trap the party crossed (`include`); the result's `reachImported` is false so
 * the card can say so.
 *
 * A searcher gets one attempt per trap per level (the `searchLock` ledger), as
 * a failed hasty search cannot be repeated until the character has grown. At
 * combat speed there is no sweep.
 *
 * @param {object} formation
 * @param {object} [opts]
 * @param {object} [opts.from] the move's start, token top-left
 * @param {object} [opts.to] the move's end
 * @param {boolean} [opts.hurried] combat speed — no automatic searching
 * @param {Placement} [opts.include] a placement to sweep whatever the distance
 *   says: the wall the party crossed is met however far the step carried them
 *   past it.
 * @returns {Promise<{found: Set<string>, rows: object[], rolls: Roll[],
 *   reachImported: boolean}>} `reachImported` is false when searchers stood in
 *   the party and no search reach is imported
 */
export async function sweepForTraps(formation, { from = null, to = null, hurried = false, include = null } = {}) {
  const empty = { found: new Set(), rows: [], rolls: [], reachImported: true };
  if (hurried) return empty;

  const { order, rankFeet } = await laidOrder(formation);
  const figures = { ...trapFigures(), rankFeet };
  const reachOf = (row) => searcherReachFeet(row, figures);
  const searchers = autoSearchers(order, figures).filter((row) => {
    const actor = game.actors.get(row.actorId);
    return actor && !isDown(actor, memberOf(formation, row.actorId));
  });
  if (!searchers.length) return empty;
  const reachImported = figures.searchFeet !== null;

  const path = partyPath(formation, { from, to });
  if (!path) return { ...empty, reachImported };

  // With no search reach imported only the crossed placement is swept.
  const reach = reachImported ? Math.max(...searchers.map((row) => reachOf(row) ?? 0)) : -1;
  const candidates = allPlacements(path.scene)
    .map((p) => ({ ...p, distanceFeet: placementDistanceFeet(p, path) }))
    .filter((p) => p.state === STATES.armed && !p.known && p.distanceFeet <= reach);
  if (include && include.state === STATES.armed && !include.known && !candidates.some((p) => p.uuid === include.uuid)) {
    candidates.push({ ...include, distanceFeet: 0 });
  }
  if (!candidates.length) return { ...empty, reachImported };

  const found = new Set();
  const rows = [];
  const rolls = [];

  for (const placement of candidates) {
    const trap = await trapFor(placement);
    const crude = !!trap?.system?.crude;
    let lock = placement.searchLock;
    let spotted = false;

    for (const row of searchers) {
      if (spotted) break;
      // A null reach is the not-imported case: the crossed placement alone.
      const own = reachOf(row);
      if (own === null ? placement.uuid !== include?.uuid : placement.distanceFeet > own) continue;
      const actor = game.actors.get(row.actorId);
      const check = resolveCheck(actor, PARTY_CHECKS.searchHasty);
      if (!check) continue; // no Searching skill: no automatic search to make
      const level = Number(actor?.system?.details?.level) || 1;
      if (repeatLocked(lock, actor.id, level)) continue;

      const bonus = check.bonus + (crude ? CRUDE.find : 0);
      const formula = bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20";
      const roll = await new Roll(formula).evaluate();
      rolls.push(roll);
      const success = roll.total >= check.target;
      if (success) spotted = true;
      else lock = lockAfterFailure(lock, actor.id, level);

      const breakdown = (check.parts ?? []).map(partText);
      if (crude) breakdown.push(`+${CRUDE.find} ${loc("partCrude")}`);
      rows.push({
        name: actor.name,
        total: roll.total,
        target: check.target,
        detail: breakdown.length ? `${check.source}; ${breakdown.join(", ")}` : check.source,
        outcome: game.i18n.localize(`${LANG_PREFIX}.${success ? "spotted" : "sawNothing"}`),
        emphasis: success ? "success" : "failure",
      });
    }

    if (spotted) {
      found.add(placement.uuid);
      await placement.write({ state: STATES.found, known: true, searchLock: lock });
    } else if (lock !== placement.searchLock) {
      await placement.write({ searchLock: lock });
    }
  }

  return { found, rows, rolls, reachImported };
}

/**
 * The party crosses a trap zone: search, then probe, then walk into it.
 *
 * Called when the party token has moved. Answers null when there is nothing to
 * resolve: no zone, or a zone whose trap is already spotted, disarmed or spent.
 *
 * @returns {Promise<{outcome: string, victims?: object[]}|null>}
 */
export async function runTrapCheck(formation, { from = null, to = null } = {}) {
  const { placement, haltAt, approach } = await livePlacement(formation, { from, to });

  const { order, rankFeet } = await laidOrder(formation);
  if (!order.length) return null;

  // At combat speed the party loses its pole and its hasty searching (RR p. 263).
  const hurried = isHurried(formation);
  const rolls = [];
  // The figures are the imported ones (RR ch. 6, Searching and Traps and
  // Trapbreaking; JJ ch. 8 for spikes); a card adds no line for one that is absent.
  const figures = trapFigures();

  /* (a) Anyone searching the ground throws first, against every hidden trap in reach. */
  const search = await sweepForTraps(formation, { from, to, hurried, include: placement });
  rolls.push(...search.rolls);
  const crossedFound = !!placement && search.found.has(placement.uuid);

  if (crossedFound) {
    await haltParty(formation, haltAt, approach);
    await whisper(
      renderRollCard({
        title: loc("foundTitle"),
        subtitle: formation.name,
        note: loc("foundNote"),
        sections: [{ rows: search.rows }],
      }),
      formation,
      rolls,
    );
    return { outcome: "found" };
  }

  // A trap off the line of march turned up: reported alone, and nothing further resolves.
  if (search.found.size) {
    await whisper(
      renderRollCard({
        title: loc("sweepTitle"),
        subtitle: formation.name,
        note: loc("sweepNote", { count: search.found.size }),
        sections: [{ rows: search.rows }],
      }),
      formation,
      rolls,
    );
  }

  if (!placement) return search.found.size ? { outcome: "found" } : null;
  const trap = await trapFor(placement);
  if (!trap) return null;
  const cfg = trap.system;

  // The trap's own band wins; a trap with none reads the imported one. With no
  // die or no band the secret die cannot be rolled, so nothing springs and the
  // Judge resolves the crossing by hand.
  const triggerOn = cfg.triggerOn ?? figures.triggerOn;
  if (figures.triggerFaces === null || triggerOn === null) {
    await whisper(
      renderRollCard({
        title: loc("crossedTitle"),
        subtitle: formation.name,
        sections: search.rows.length ? [{ title: loc("searchSection"), rows: search.rows }] : [],
      }),
      formation,
      rolls,
    );
    return { outcome: "byHand" };
  }

  /* (b) and (c): the pole, then the party, each with its own secret die. */
  const poleRanks = poleLeadRanks(figures.poleLeadFeet, rankFeet);
  const probes = probeSequence(order, { pole: !hurried, poleRanks });
  const probeRows = [];
  let sprungAt = -1;

  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    const actor = game.actors.get(probe.actorId);
    if (actor && isDown(actor, memberOf(formation, probe.actorId))) continue;
    const die = await new Roll(`1d${figures.triggerFaces}`).evaluate();
    rolls.push(die);
    const fires = triggerFires(die.total, triggerOn);
    probeRows.push({
      name: probe.kind === "pole" ? loc("poleOf", { name: probe.name ?? "" }) : (probe.name ?? ""),
      total: die.total,
      detail: loc("rankDetail", { rank: probe.rank + 1 }),
      outcome: game.i18n.localize(`${LANG_PREFIX}.${fires ? "sprung" : "passed"}`),
      emphasis: fires ? "failure" : "neutral",
    });
    if (fires) {
      sprungAt = i;
      break;
    }
  }

  if (sprungAt < 0) {
    await whisper(
      renderRollCard({
        title: loc("crossedTitle"),
        subtitle: formation.name,
        note: hurried ? loc("hurriedNote") : loc("crossedNote"),
        sections: [
          ...(search.rows.length ? [{ title: loc("searchSection"), rows: search.rows }] : []),
          { title: loc("probeSection"), rows: probeRows },
        ],
      }),
      formation,
      rolls,
    );
    return { outcome: "crossed" };
  }

  // Scope is the trap's; how far it reaches is the level's.
  const caught = victimsOf(probes, sprungAt, { scope: cfg.scope, radiusFeet: cfg.tier.radiusFeet, rankFeet });
  await haltParty(formation, haltAt, approach);
  return fireTrap(formation, placement, trap, caught, {
    preface: [
      ...(search.rows.length ? [{ title: loc("searchSection"), rows: search.rows }] : []),
      { title: loc("probeSection"), rows: probeRows },
    ],
    rolls,
    sprungBy: probes[sprungAt],
  });
}

/** How far short of the line the party pulls up, in pixels. */
const HALT_CLEARANCE = 4;

/**
 * Stop the party where it met the trap. A trap wall blocks nothing, so the halt
 * is applied here on detection; a region has no crossing point and needs none.
 */
async function haltParty(formation, haltAt, from = null) {
  if (!haltAt) return;
  const token = getPartyToken(formation);
  if (!token) return;
  const gs = token.parent.grid.size;

  // Stop just short of the line, on the near side: halting on it would leave
  // the party somewhere every later step departs from, springing the trap again.
  let { x, y } = haltAt;
  if (from) {
    const dx = haltAt.x - from.x;
    const dy = haltAt.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len > HALT_CLEARANCE) {
      x -= (dx / len) * HALT_CLEARANCE;
      y -= (dy / len) * HALT_CLEARANCE;
    }
  }
  haltAt = { x, y };
  // The crossing is where the token's centre met the line; back the top-left
  // corner out of it. `HALT_OPTION` keeps this write out of the movement hook.
  await token.update(
    { x: Math.round(haltAt.x - (token.width * gs) / 2), y: Math.round(haltAt.y - (token.height * gs) / 2) },
    { animate: false, [HALT_OPTION]: true },
  );
  formation.clock.lastPosition = { x: token.x, y: token.y };
  await updateFormation(formation);
}

/* -------------------------------------------- */
/*  Going off                                   */
/* -------------------------------------------- */

/**
 * The trap fires. Rolls each victim's save or the trap's attack throw, rolls
 * damage once per victim, and spends the trap.
 *
 * Damage is reported, not applied: the card carries the number and the Judge
 * writes it. See docs/formation/DECISIONS.md, "A trap reports its damage; the Judge writes it".
 */
async function fireTrap(formation, placement, trap, caught, { preface = [], rolls = [], sprungBy = null } = {}) {
  const cfg = trap.system;
  // What the trap does comes from the row its level selects; how it was built
  // (crudely or well) is the same at every level and stays on the trap.
  const tier = cfg.tier;
  const plan = firingPlan({
    resolution: tier.resolution,
    saveKey: tier.saveKey,
    attackThrow: tier.attackThrow,
    damageFormula: tier.damageFormula,
    pitDepthFeet: tier.pitDepthFeet,
    spiked: tier.spiked,
    crude: cfg.crude,
    onSuccess: tier.onSuccess,
  });

  const rows = [];
  for (const victim of caught) {
    const actor = game.actors.get(victim.actorId);
    if (!actor) continue;
    const name = actor.name;
    // Did this victim beat the trap's throw? `null` when it offered none, and
    // the damage then lands whole.
    let beat = null;

    if (plan.resolution === RESOLUTIONS.save && plan.saveKey) {
      const target = Number(actor.system?.saves?.[plan.saveKey]?.value);
      const formula = plan.saveBonus ? `1d20 + ${plan.saveBonus}` : "1d20";
      const roll = await new Roll(formula).evaluate();
      rolls.push(roll);
      const made = Number.isFinite(target) && roll.total >= target;
      beat = made;
      rows.push({
        name,
        total: roll.total,
        target: Number.isFinite(target) ? target : undefined,
        detail: loc(plan.saveBonus ? "saveDetailCrude" : "saveDetail", {
          save: game.i18n.localize(`ACKS.saves.${plan.saveKey}.long`),
          bonus: plan.saveBonus,
        }),
        outcome: game.i18n.localize(`${LANG_PREFIX}.${made ? "saved" : "failedSave"}`),
        emphasis: made ? "success" : "failure",
      });
    } else if (plan.resolution === RESOLUTIONS.attack) {
      const ac = Number(actor.system?.ac?.value) || 0;
      // 1d20 + modifiers against the throw value plus the target's AC; a crude
      // trap's penalty is already in `attackModifier`.
      const needed = plan.attackThrow + ac;
      const roll = await new Roll(plan.attackModifier ? `1d20 + ${plan.attackModifier}` : "1d20").evaluate();
      rolls.push(roll);
      const hit = roll.total >= needed;
      beat = !hit; // beating an attack throw means it missed
      rows.push({
        name,
        total: roll.total,
        target: needed,
        detail: loc(plan.attackModifier ? "attackDetailCrude" : "attackDetail", {
          ac,
          throw: plan.attackThrow,
          penalty: plan.attackModifier,
        }),
        outcome: game.i18n.localize(`${LANG_PREFIX}.${hit ? "hit" : "missed"}`),
        emphasis: hit ? "failure" : "success",
      });
    } else if (plan.resolution === RESOLUTIONS.none) {
      rows.push({ name, total: "—", outcome: loc("judgeAdjudicates"), emphasis: "neutral" });
    } else {
      rows.push({ name, total: "—", outcome: loc("noThrow"), emphasis: "failure" });
    }

    if (plan.formula && plan.resolution !== RESOLUTIONS.none) {
      const dmg = await new Roll(plan.formula).evaluate();
      rolls.push(dmg);
      const { taken, mitigated } = damageTaken(dmg.total, beat, plan.onSuccess);
      // A trap that dealt nothing to this victim says so.
      rows.push({
        name: loc("damageTo", { name }),
        total: taken,
        detail: mitigated || taken !== dmg.total ? loc("damageMitigated", { rolled: dmg.total, formula: plan.formula }) : plan.formula,
        tooltip: plan.formula,
        outcome: loc(taken ? "damageOutcome" : "damageNone"),
        emphasis: taken ? "failure" : "success",
      });
    }
  }

  // Spent, and no longer a secret.
  await placement.write({ state: STATES.discharged, known: true });

  const notes = [loc("sprungNote", { name: sprungBy?.name ?? "" })];
  if (sprungBy?.kind === "pole") notes.push(loc("sprungByPole"));
  if (!caught.length) notes.push(loc("caughtNobody"));
  if (tier.rider) notes.push(tier.rider);

  await whisper(
    renderRollCard({
      title: loc("firedTitle", { trap: trap.name, level: cfg.level }),
      subtitle: formation.name,
      note: notes.filter(Boolean).join(" "),
      sections: [...preface, ...(rows.length ? [{ title: loc("victimSection"), rows }] : [])],
      footnote: loc("damageIsReported"),
    }),
    formation,
    rolls,
  );

  return { outcome: "sprung", victims: caught };
}

/* -------------------------------------------- */
/*  Disabling it                                */
/* -------------------------------------------- */

/**
 * Thieves' tools: disabling a trap needs a set, matched by name against carried
 * gear as the pole is.
 */
export const TOOLS_ITEM_PATTERN = /thie(f|ves)'?s?\s*tools|lock\s*picks?|pick\s*locks?/i;

const carriesTools = (actor) =>
  (actor?.items ?? []).some((i) => TOOLS_ITEM_PATTERN.test(i.name ?? ""));

/**
 * Why a character may not work on this trap right now, or null if they may.
 * Every refusal is reported before anything is rolled.
 */
export function disarmRefusal(placement, actor, mode) {
  if (!placement) return "noZone";
  // An unfound trap cannot be worked on, and offering it would announce it;
  // the Judge marks a discovery made some other way as spotted first.
  if (!placement.known) return "notFound";
  if (!placement.trapUuid) return "noTrap";
  if (placement.state === STATES.discharged) return "alreadyDischarged";
  if (placement.state === STATES.disarmed) return "alreadyDisarmed";
  if (!carriesTools(actor)) return "noTools";

  const check = resolveCheck(actor, PARTY_CHECKS[mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical"]);
  if (!check) return "cannotTry";
  // A hasty attempt is skill-only (RR p. 267).
  if (mode === "hasty" && !check.skilled) return "hastyNeedsSkill";

  const level = Number(actor?.system?.details?.level) || 1;
  if (mode === "hasty" && repeatLocked(placement.repeatLock, actor.id, level)) return "alreadyFailedHasty";
  return null;
}

/**
 * Work on the trap: one character, one throw, by the column of the table they
 * chose. A made throw lets the thief choose whether the trap is disarmed (and
 * so re-armable) or discharged; a plain failure ends a hasty attempt at this
 * level but leaves a methodical one open; and the imported botch bands
 * (`isBotch`; none imported, none botch) set the trap off with the thief on top
 * of it (RR ch. 6, Traps and Trapbreaking).
 *
 * @param {object} formation
 * @param {Actor} actor the character doing the work
 * @param {object} [opts]
 * @param {"hasty"|"methodical"} [opts.mode]
 * @param {number} [opts.extra] the Judge's own modifier
 * @param {boolean} [opts.spend] spend the attempt's time on the clock; the turn
 *   plan passes false, having spent its turn before anything resolves
 * @returns {Promise<{ok: boolean, reason?: string, outcome?: string}>}
 */
export async function attemptDisarm(formation, actor, { mode = "methodical", extra = 0, targetUuid = "", spend = true } = {}) {
  // The target is named, never guessed: a halted party may stand at more than
  // one trap.
  const target = targetUuid
    ? placementNearByUuid(formation, targetUuid)
    : (knownPlacementsNear(formation)[0] ?? null);
  if (!target) return { ok: false, reason: "noZone" };

  const refusal = disarmRefusal(target, actor, mode);
  if (refusal) {
    ui.notifications.warn(loc(`refuse.${refusal}`, { name: actor?.name ?? "" }));
    return { ok: false, reason: refusal };
  }

  const trap = await trapFor(target);
  if (!trap) return { ok: false, reason: "noTrap" };
  const crude = !!trap.system.crude;
  const cfgKey = mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical";
  const check = resolveCheck(actor, PARTY_CHECKS[cfgKey]);
  const plan = disarmPlan({ mode, crude, skilled: check.skilled, extra });

  // `resolveCheck` carries the character's bonuses in its target; the die adds
  // what is true of the trap.
  const bonus = check.bonus + (crude ? CRUDE.remove : 0) + (Number(extra) || 0);
  const roll = await new Roll(bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20").evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total - bonus;
  const success = roll.total >= check.target;
  const botched = isBotch(natural, mode);

  const breakdown = (check.parts ?? []).map(partText);
  if (crude) breakdown.push(`+${CRUDE.remove} ${loc("partCrude")}`);

  let outcome;
  if (success) {
    // The thief's call: a disarmed trap can be re-armed later, a discharged one is spent.
    const discharge = await askDischarge(actor);
    outcome = discharge ? STATES.discharged : STATES.disarmed;
    await target.write({ state: outcome, known: true });
  } else if (botched) {
    outcome = "botched";
  } else {
    outcome = "failed";
    if (mode === "hasty") {
      const level = Number(actor?.system?.details?.level) || 1;
      await target.write({ repeatLock: lockAfterFailure(target.repeatLock, actor.id, level) });
    }
  }

  await whisper(
    renderRollCard({
      title: loc(mode === "hasty" ? "disarmHastyTitle" : "disarmMethodicalTitle"),
      subtitle: formation?.name,
      note: loc(`disarm.${outcome}`, { name: actor.name }),
      sections: [
        {
          rows: [
            {
              name: actor.name,
              total: roll.total,
              target: check.target,
              detail: breakdown.length ? `${check.source}; ${breakdown.join(", ")}` : check.source,
              outcome: loc(`disarmOutcome.${outcome}`),
              emphasis: outcome === STATES.disarmed || outcome === STATES.discharged ? "success" : "failure",
            },
          ],
        },
      ],
      footnote: plan.repeatable ? loc("mayTryAgain") : loc("noSecondHastyTry"),
    }),
    formation,
    [roll],
  );

  // A botch springs it on the thief alone.
  if (botched) {
    await fireTrap(
      formation,
      target,
      trap,
      [{ actorId: actor.id, name: actor.name, rank: 0, file: 0, kind: "body" }],
      { rolls: [], sprungBy: { name: actor.name, kind: "body" } },
    );
  }

  // Time cost: a round hastily, a full turn methodically.
  if (!spend) return { ok: true, outcome };
  if (mode === "hasty") await advanceRounds(formation, 1, { reason: "action" });
  else await advanceTurns(formation, 1, { reason: "trapbreaking" });

  return { ok: true, outcome };
}

/**
 * Disarm, or set it off on purpose? The choice is the thrower's, and only a
 * disarmed trap can be re-armed afterwards.
 */
async function askDischarge(actor) {
  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: loc("chooseTitle"), icon: "fa-solid fa-screwdriver-wrench" },
    content: `<p>${loc("chooseHint", { name: actor.name })}</p>`,
    buttons: [
      { action: "disarm", default: true, icon: "fa-solid fa-lock", label: loc("chooseDisarm"), callback: () => false },
      { action: "discharge", icon: "fa-solid fa-burst", label: loc("chooseDischarge"), callback: () => true },
    ],
    rejectClose: false,
  }).catch(() => null);
  // Dismissing the question leaves the trap disarmed.
  return chosen === true;
}

/**
 * Set a disarmed trap going again. Only a disarmed trap can be re-armed; a
 * discharged one has fired.
 */
export async function attemptRearm(formation, actor, { targetUuid = "" } = {}) {
  const target = disarmedPlacementAt(formation, targetUuid);
  if (!target) return { ok: false, reason: "noZone" };
  if (target.state !== STATES.disarmed) {
    ui.notifications.warn(loc("refuse.notDisarmed"));
    return { ok: false, reason: "notDisarmed" };
  }
  if (!carriesTools(actor)) {
    ui.notifications.warn(loc("refuse.noTools", { name: actor?.name ?? "" }));
    return { ok: false, reason: "noTools" };
  }
  const check = resolveCheck(actor, PARTY_CHECKS.trapbreakMethodical);
  if (!check?.skilled) {
    ui.notifications.warn(loc("refuse.rearmNeedsSkill", { name: actor?.name ?? "" }));
    return { ok: false, reason: "rearmNeedsSkill" };
  }

  const roll = await new Roll(check.bonus ? `1d20 + ${check.bonus}` : "1d20").evaluate();
  const success = roll.total >= check.target;
  // Re-armed by the party's own hand, so they still know where it is.
  if (success) await target.write({ state: STATES.armed, repeatLock: {}, known: true });

  await whisper(
    renderRollCard({
      title: loc("rearmTitle"),
      subtitle: formation?.name,
      sections: [
        {
          rows: [
            {
              name: actor.name,
              total: roll.total,
              target: check.target,
              detail: check.source,
              outcome: loc(success ? "rearmed" : "rearmFailed"),
              emphasis: success ? "success" : "failure",
            },
          ],
        },
      ],
    }),
    formation,
    [roll],
  );
  return { ok: true, outcome: success ? "rearmed" : "failed" };
}

/* -------------------------------------------- */
/*  Judge's controls                            */
/* -------------------------------------------- */

/**
 * Put a trap back the way it was: armed, unfound, and with both lock ledgers
 * cleared, since a rebuilt trap is not the one anybody failed against. A
 * thief's re-arm of a disarmed trap is `attemptRearm`'s throw.
 */
export async function resetTrap(placement) {
  return placement.write({ state: STATES.armed, repeatLock: {}, searchLock: {}, known: false });
}

/**
 * The Judge says the party has found it, by some way other than a Searching
 * throw; the state moves to `found` as a made throw would move it.
 */
export async function markTrapFound(placement) {
  return placement.write({ state: STATES.found, known: true });
}

/**
 * Set the mechanism, or make it safe: an armed trap goes safe and anything
 * else goes armed, except a spent trap, which defers to `resetTrap` (rebuilding
 * it drops the throws failed against the old one). Never touches `known`.
 */
export async function toggleArmed(placement) {
  if (placement.state === STATES.armed) return placement.write({ state: STATES.disarmed });
  if (placement.state === STATES.discharged) return resetTrap(placement);
  return placement.write({ state: STATES.armed });
}

/**
 * Show the trap to the party, or take it back out of sight. Writes `known` and
 * nothing else, so a trap revealed this way stays armed; `markTrapFound` is
 * the different act that also moves the state to `found`.
 */
export async function toggleKnown(placement) {
  return placement.write({ known: !placement.known });
}

/** The disarmed trap the party is standing at, nearest first. */
function disarmedPlacementAt(formation, targetUuid = "") {
  const known = knownPlacementsNear(formation);
  if (targetUuid) return known.find((p) => p.uuid === targetUuid) ?? null;
  return known.find((p) => p.state === STATES.disarmed) ?? null;
}
