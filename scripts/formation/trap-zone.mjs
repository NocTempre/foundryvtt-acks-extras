/* global game, foundry, fromUuid, CONFIG, ChatMessage, Roll, ui */
import { MODULE_ID, ROLES, TRAP_ITEM_TYPE, TRAP_ZONE_TYPE } from "./constants.mjs";
import { getPartyToken, isDown, isHurried, marchingOrder, updateFormation } from "./formation-model.mjs";
import { segmentDistance, setWallTrap, trapWallsCrossed, wallTrap } from "./trap-walls.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { advanceRounds, advanceTurns } from "./turn-engine.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { gmIds, makeLoc } from "../lib/util.mjs";
import { findZone, regionEdges } from "./zones.mjs";
import {
  CRUDE,
  FEET_PER_RANK,
  POLE_REACH_FEET,
  RESOLUTIONS,
  SEARCH_REACH_FEET,
  STATES,
  TRAPBREAK_REACH_FEET,
  TRIGGER_DIE,
  damageTaken,
  disarmPlan,
  firingPlan,
  isBotch,
  lockAfterFailure,
  probeSequence,
  repeatLocked,
  triggerFires,
  victimsOf,
} from "./trap-rules.mjs";

/**
 * "Trap Zone" scene-region behavior: draw a Region over the squares a trap
 * covers, and the party walking through it is resolved by the book instead of
 * by the Judge's memory.
 *
 * The sequence is the one the delve's own sequence of play lays down, in that
 * order and for its reasons: anyone searching the ground throws FIRST, because
 * a trap found is a trap not sprung; then the 10' pole, which is an adventurer
 * moving 5' ahead of its bearer; then the party itself, rank by rank, each with
 * its own secret 1d6. The first throw that comes up inside the trigger band
 * ends the sequence — one trap goes off once.
 *
 * Everything the Judge sees is whispered. A trap the party crossed untouched is
 * reported too, and only to the Judge: knowing that the corridor was clear is
 * how a Judge keeps track of a trap that is still armed, and telling the table
 * would give away that there was ever anything to cross.
 *
 * The rule itself — probe order, who is caught, the disarm throw, the botch
 * bands — is `trap-rules.mjs`, which holds no dice and no documents. This file
 * is the world: the zone's stored state, the throws, and the cards.
 */

const LANG_PREFIX = "ACKS-FORMATION.traps";
const loc = makeLoc(LANG_PREFIX);

// The sub-type id lives in constants.mjs so Foundry-free code can name it.
export { TRAP_ZONE_TYPE };

/**
 * Update option marking a token write as the trap's own halt.
 *
 * The movement hook must ignore it. A halt is not the party walking, so it
 * costs no dungeon turns and — the reason this exists at all — must not start
 * a second trap check while the first is still resolving.
 */
export const HALT_OPTION = `${MODULE_ID}.trapHalt`;

/* -------------------------------------------- */
/*  The zone, as data                           */
/* -------------------------------------------- */

/**
 * One trap, buried in one place.
 *
 * The zone holds a REFERENCE to a trap Item and the state of this particular
 * burial, and nothing else. What a scything blade is belongs to the trap
 * document — shared, importable from the GM's own book, editable once for every
 * corridor it sits in. Whether THIS one is still armed, already spotted, or
 * spent belongs here, because it is true of the place and not of the idea.
 *
 * A zone naming no trap resolves nothing; it is an unfinished note to the Judge
 * rather than an error.
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
       * Who has already failed a hasty attempt here, and at what level — the
       * "cannot repeat until higher level" rule needs to know WHEN, not just
       * that it happened. Cleared by re-arming.
       */
      repeatLock: new fields.ObjectField(),
      /** The same ledger for the automatic hasty SEARCH, which has its own. */
      searchLock: new fields.ObjectField(),
      /**
       * Has the party learned this trap is here?
       *
       * Not derivable from the state. A trap the thief found, disarmed and
       * re-armed reads `armed` again and is still perfectly well known; a trap
       * the Judge rebuilt from scratch reads `armed` and is not.
       */
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
 * Where a trap is buried, behind one interface.
 *
 * A trap can be laid two ways — along a wall the party crosses, or over a
 * region the party walks into — and the rules do not care which. The sequence,
 * the searching, the probe order, the disarm throws and the botch bands are one
 * body of code, and it reaches its placement only through these four members.
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
    // Objects go in as forced replacements: an ordinary update merges, so a
    // patch emptying a ledger leaves every entry in it standing.
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
 * live. A crossed WALL wins over a region: the party met the line on the way
 * in, so that is the trap they met first.
 */
export async function livePlacement(formation, { from = null, to = null } = {}) {
  const token = getPartyToken(formation);
  if (token && from && to) {
    // `from`/`to` arrive as the token's top-left corner, which is where a
    // TokenDocument stores itself. What meets a tripwire is the token's
    // CENTRE, so the path is shifted onto it before anything is intersected —
    // and `haltParty` shifts the crossing back the other way.
    const gs = token.parent.grid.size;
    const half = { x: (token.width * gs) / 2, y: (token.height * gs) / 2 };
    const path = [from, to].map((p) => ({ x: p.x + half.x, y: p.y + half.y }));
    const crossed = trapWallsCrossed(token.parent, path[0], path[1]).find((h) => h.trap.state === STATES.armed);
    // `approach` is where the party came from, in the same centre coordinates —
    // it is what lets the halt pull up on the NEAR side of the line.
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
 * The ground the party covered, in canvas pixels and centre coordinates.
 *
 * A standing party is a zero-length segment at its own centre, which every
 * distance test below handles without a second code path.
 *
 * @returns {{seg: number[], gs: number, feetPerPixel: number, halfToken: number}|null}
 */
function partyPath(formation, { from = null, to = null } = {}) {
  const token = getPartyToken(formation);
  if (!token) return null;
  const scene = token.parent;
  const gs = scene.grid.size;
  const half = { x: (token.width * gs) / 2, y: (token.height * gs) / 2 };
  const centre = (p) => ({ x: p.x + half.x, y: p.y + half.y });
  const a = centre(from ?? { x: token.x, y: token.y });
  const b = centre(to ?? { x: token.x, y: token.y });
  return {
    scene,
    gs,
    seg: [a.x, a.y, b.x, b.y],
    // Distances are measured from the token's EDGE, not from the pip at its
    // centre: a party token is often larger than a square, and measuring from
    // the middle of a 2×2 marker would put a tripwire it is touching two
    // squares away.
    halfToken: Math.max(half.x, half.y),
    feetPerPixel: (scene.grid.distance || FEET_PER_RANK) / gs,
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
    // Inside the outline is zero away from it, and the edge distance alone
    // would report a party standing in the middle of a pit as far from it.
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
 * Every trap placed on this scene, as placements — trapped walls and enabled
 * Trap Zone behaviors alike.
 *
 * Read straight off the scene rather than from the canvas, so it answers on a
 * client whose canvas is not the one the party is standing on.
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
 * @param {number} [opts.feet] the reach being measured
 * @param {object} [opts.from] where the party started this move, if it moved
 * @param {object} [opts.to] where it ended
 * @returns {Array<Placement & {distanceFeet: number}>}
 */
export function placementsNear(formation, { feet = TRAPBREAK_REACH_FEET, from = null, to = null } = {}) {
  const path = partyPath(formation, { from, to });
  if (!path) return [];
  return allPlacements(path.scene)
    .map((placement) => ({ ...placement, distanceFeet: placementDistanceFeet(placement, path) }))
    .filter((p) => p.distanceFeet <= feet)
    .sort((a, b) => a.distanceFeet - b.distanceFeet);
}

/**
 * The traps within reach that the party actually KNOWS about.
 *
 * What a Trapbreaking attempt may be pointed at, and the only trap list any
 * player-facing surface is allowed to show: offering an unfound trap as a
 * target announces its existence, which is the one thing a hidden feature is
 * for.
 */
export function knownPlacementsNear(formation, feet = TRAPBREAK_REACH_FEET) {
  return placementsNear(formation, { feet }).filter((p) => p.known);
}

/** One placement by its document uuid, if it is within reach of the party. */
export function placementNearByUuid(formation, uuid, feet = TRAPBREAK_REACH_FEET) {
  return placementsNear(formation, { feet }).find((p) => p.uuid === uuid) ?? null;
}

/* -------------------------------------------- */
/*  Cards                                       */
/* -------------------------------------------- */

/** Whisper one card to the Judges. Traps are secret; nothing here is public. */
async function whisper(html, formation, rolls = []) {
  return ChatMessage.create({
    content: html,
    rolls,
    whisper: gmIds(),
    speaker: { alias: formation?.name ?? game.i18n.localize(`${LANG_PREFIX}.title`) },
  });
}

/* -------------------------------------------- */
/*  Walking into it                             */
/* -------------------------------------------- */

/**
 * Who is close enough to notice the trap on the way past.
 *
 * The book gives a moving thief an AUTOMATIC hasty search within 5' of a hidden
 * feature, and 10' if they are probing with a pole. In a column that is the
 * front rank, plus a pole-bearer one rank further back whose pole reaches the
 * same ground. It is not offered to the whole party: a mage six ranks back is
 * not within 5' of anything.
 *
 * Being *capable* is left to `resolveCheck`, which answers null for anyone
 * without a real Searching skill — hasty searching is skill-only, so that gate
 * already says "thief" without this file having to name a class.
 */
export function autoSearchers(order) {
  return (order ?? []).filter((row) => row.rank === 0 || ((row.roles ?? []).includes(ROLES.POLE) && row.rank <= 1));
}

/**
 * How far ahead of the party token this searcher's own reach extends.
 *
 * The reach belongs to the CHARACTER and the distance is measured from the
 * party token, so the searcher's own place in the column is subtracted: a
 * pole-bearer in the second rank probes 10' from himself, which is 5' from the
 * front of the party.
 */
function searcherReachFeet(row) {
  const own = (row.roles ?? []).includes(ROLES.POLE) ? POLE_REACH_FEET : SEARCH_REACH_FEET;
  return own - row.rank * FEET_PER_RANK;
}

/**
 * The automatic hasty search, swept over every hidden trap the party came
 * within reach of — not merely the one it was about to step on.
 *
 * This is the book's own automatic search and it is deliberately wider than the
 * corridor: a thief moving at exploration speed throws against ANY hidden
 * feature he passes within 5' of, 10' with a pole, and the Judge makes the
 * throw in secret. So the sweep runs on every party move, silently, and only
 * says anything when something is spotted.
 *
 * **A searcher gets one attempt per trap per level.** The automatic throw is a
 * hasty search and carries the hasty search's price — a failure is a failure to
 * hastily search that feature, and it cannot be repeated until the character
 * has grown. Without the ledger a party could find every trap in the dungeon by
 * shuffling back and forth over it.
 *
 * At combat speed there is no sweep at all: the party has lost its pole and its
 * hasty searching together.
 *
 * @param {object} formation
 * @param {object} [opts]
 * @param {object} [opts.from] the move's start, token top-left
 * @param {object} [opts.to] the move's end
 * @param {boolean} [opts.hurried] combat speed — no automatic searching
 * @param {Placement} [opts.include] a placement to sweep whatever the distance
 *   says: the wall the party CROSSED is met by definition, however far the step
 *   that crossed it carried them past it.
 * @returns {Promise<{found: Set<string>, rows: object[], rolls: Roll[]}>}
 */
export async function sweepForTraps(formation, { from = null, to = null, hurried = false, include = null } = {}) {
  const empty = { found: new Set(), rows: [], rolls: [] };
  if (hurried) return empty;

  const searchers = autoSearchers(marchingOrder(formation)).filter((row) => {
    const actor = game.actors.get(row.actorId);
    return actor && !isDown(actor);
  });
  if (!searchers.length) return empty;

  const path = partyPath(formation, { from, to });
  if (!path) return empty;

  const reach = Math.max(...searchers.map(searcherReachFeet));
  const candidates = allPlacements(path.scene)
    .map((p) => ({ ...p, distanceFeet: placementDistanceFeet(p, path) }))
    .filter((p) => p.state === STATES.armed && !p.known && p.distanceFeet <= reach);
  if (include && include.state === STATES.armed && !include.known && !candidates.some((p) => p.uuid === include.uuid)) {
    candidates.push({ ...include, distanceFeet: 0 });
  }
  if (!candidates.length) return empty;

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
      if (placement.distanceFeet > searcherReachFeet(row)) continue;
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

      const breakdown = (check.parts ?? []).map((p) => `+${p.value} ${p.label}`);
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

  return { found, rows, rolls };
}

/**
 * The party crosses a trap zone: search, then probe, then walk into it.
 *
 * Called when the party token has moved. Answers null when there is nothing to
 * resolve — no zone, or a zone whose trap is already spotted, disarmed or
 * spent — so a party may walk back and forth over a dealt-with trap freely.
 *
 * @returns {Promise<{outcome: string, victims?: object[]}|null>}
 */
export async function runTrapCheck(formation, { from = null, to = null } = {}) {
  const { placement, haltAt, approach } = await livePlacement(formation, { from, to });

  const order = marchingOrder(formation);
  if (!order.length) return null;

  // At combat speed the party loses its pole and its hasty searching together
  // (RR p. 263) — it is moving too fast for either.
  const hurried = isHurried(formation);
  const rolls = [];

  /* (a) Anyone searching the ground throws first — against every hidden trap
     they passed within reach of, not only the one in the way. */
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

  // Something OFF the line of march turned up. Reported on its own, because the
  // party is not standing at it and nothing further resolves.
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

  /* (b) and (c): the pole, then the party, each with its own secret die. */
  const probes = probeSequence(order, { pole: !hurried });
  const probeRows = [];
  let sprungAt = -1;

  for (let i = 0; i < probes.length; i++) {
    const probe = probes[i];
    const actor = game.actors.get(probe.actorId);
    if (actor && isDown(actor)) continue;
    const die = await new Roll(`1d${TRIGGER_DIE}`).evaluate();
    rolls.push(die);
    const fires = triggerFires(die.total, cfg.triggerOn);
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
  const caught = victimsOf(probes, sprungAt, { scope: cfg.scope, radiusFeet: cfg.tier.radiusFeet });
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

/**
 * Stop the party where it met the trap.
 *
 * A trap wall blocks nothing on its own — the party walks through it as if it
 * were not there, which is what a tripwire does — so the halt is applied here,
 * on detection, rather than by making the wall a barrier. Without it the party
 * would be told about a tripwire three squares after stepping over it.
 *
 * A region has no crossing point and needs no halt: the party is standing in
 * the thing already.
 */
/** How far short of the line the party pulls up, in pixels. */
const HALT_CLEARANCE = 4;

async function haltParty(formation, haltAt, from = null) {
  if (!haltAt) return;
  const token = getPartyToken(formation);
  if (!token) return;
  const gs = token.parent.grid.size;

  // Stop just SHORT of the line, on the near side. Halting exactly on it looks
  // like the party is standing in the tripwire, and leaves them somewhere every
  // subsequent step departs from — which is a trap sprung again on the way out.
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
  // The crossing is where the token's CENTRE met the line; back the top-left
  // corner out of it, and pull up just short so the party stops ON the near
  // side rather than straddling it.
  //
  // `HALT_OPTION` marks this write as the trap's OWN. Without it the update
  // re-enters the movement hook, which starts a second trap check against a
  // trap this one has not finished spending yet — the party takes the damage
  // twice, gets two cards, and pays dungeon turns for a step it did not walk.
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
 * Damage is REPORTED, not applied. A trap's damage lands on a character sheet
 * through the Judge's own hand for the same reason the party's saves do: half
 * on a made save, none if a rider says so, and a Judge who wanted the pit to be
 * a bruise this once. The card carries the number; the sheet is nobody's to
 * write from here.
 */
async function fireTrap(formation, placement, trap, caught, { preface = [], rolls = [], sprungBy = null } = {}) {
  const cfg = trap.system;
  // What the trap does comes from the row its level selects; how it was BUILT
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
    // Did this victim beat the trap's throw? `null` when it offered none, in
    // which case the damage lands whole. The damage line below is computed from
    // this rather than printed beside it — a bolt that missed deals nothing,
    // and a made save is worth whatever the trap says it is worth.
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
      const ac = Number(actor.system?.aac?.value) || 0;
      // The ACKS attack throw: 1d20 + modifiers against the throw value plus
      // the target's AC. A crude trap's -2 is already in `attackModifier`.
      const needed = plan.attackThrow + ac;
      const roll = await new Roll(plan.attackModifier ? `1d20 + ${plan.attackModifier}` : "1d20").evaluate();
      rolls.push(roll);
      const hit = roll.total >= needed;
      beat = !hit; // beating an attack throw means it MISSED you
      rows.push({
        name,
        total: roll.total,
        target: needed,
        detail: loc(plan.attackModifier ? "attackDetailCrude" : "attackDetail", { ac, throw: plan.attackThrow }),
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
      // A trap that dealt nothing to this victim says so, rather than printing
      // a damage line they are meant to know not to apply.
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

  // Spent, and no longer a secret: it went off in front of everybody.
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
 * Thieves' tools. The book gates disabling traps on holding a set, so the
 * pattern is matched against carried gear the same way the 10' pole is.
 */
export const TOOLS_ITEM_PATTERN = /thie(f|ves)'?s?\s*tools|lock\s*picks?|pick\s*locks?/i;

const carriesTools = (actor) =>
  (actor?.items ?? []).some((i) => TOOLS_ITEM_PATTERN.test(i.name ?? ""));

/**
 * Why a character may not work on this trap right now, or null if they may.
 *
 * Every refusal is reported BEFORE anything is rolled, which is the shape the
 * obstacle helper and the door helper both use: a throw nobody is allowed to
 * make should be said, not silently skipped.
 */
export function disarmRefusal(placement, actor, mode) {
  if (!placement) return "noZone";
  // A hidden feature nobody has found is not a thing anyone can kneel down and
  // work on, and offering it as a target would announce it. The Judge who has
  // narrated a discovery some other way marks it spotted first.
  if (!placement.known) return "notFound";
  if (!placement.trapUuid) return "noTrap";
  if (placement.state === STATES.discharged) return "alreadyDischarged";
  if (placement.state === STATES.disarmed) return "alreadyDisarmed";
  if (!carriesTools(actor)) return "noTools";

  const check = resolveCheck(actor, PARTY_CHECKS[mode === "hasty" ? "trapbreakHasty" : "trapbreakMethodical"]);
  if (!check) return "cannotTry";
  // "Using Adventuring: not permitted" — a hasty attempt is skill-only.
  if (mode === "hasty" && !check.skilled) return "hastyNeedsSkill";

  const level = Number(actor?.system?.details?.level) || 1;
  if (mode === "hasty" && repeatLocked(placement.repeatLock, actor.id, level)) return "alreadyFailedHasty";
  return null;
}

/**
 * Work on the trap: one character, one throw, by the column of the table they
 * chose.
 *
 * The outcomes are the book's and they are not symmetrical. A made throw lets
 * the thief choose whether the trap is disarmed (and so re-armable) or
 * deliberately discharged; a plain failure ends a hasty attempt for good at
 * this level but leaves a methodical one open; and the botch bands — an
 * unmodified 1–3 hastily, 1 methodically — set the thing off with the thief on
 * top of it.
 *
 * @param {object} formation
 * @param {Actor} actor the character doing the work
 * @param {object} [opts]
 * @param {"hasty"|"methodical"} [opts.mode]
 * @param {number} [opts.extra] the Judge's own modifier
 * @returns {Promise<{ok: boolean, reason?: string, outcome?: string}>}
 */
export async function attemptDisarm(formation, actor, { mode = "methodical", extra = 0, targetUuid = "" } = {}) {
  // Which trap is being worked on is ASKED, not guessed. A party halted in a
  // corridor may be standing at more than one, and the thief who found the
  // tripwire has no business having their hands moved onto the pressure plate
  // beside it because that one happened to be nearer.
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

  // `resolveCheck` already carries the methodical +4 and Trapfinding's +2; the
  // plan adds what is true of the TRAP rather than of the character.
  const bonus = check.bonus + (crude ? CRUDE.remove : 0) + (Number(extra) || 0);
  const roll = await new Roll(bonus > 0 ? `1d20 + ${bonus}` : bonus < 0 ? `1d20 - ${-bonus}` : "1d20").evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total - bonus;
  const success = roll.total >= check.target;
  const botched = isBotch(natural, mode);

  const breakdown = (check.parts ?? []).map((p) => `+${p.value} ${p.label}`);
  if (crude) breakdown.push(`+${CRUDE.remove} ${loc("partCrude")}`);

  let outcome;
  if (success) {
    // The thief's own call: a disarmed trap can be re-armed later, a
    // discharged one is spent. Only they can say which they wanted.
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

  // A botch springs it, with the thief on top of it and nobody else near.
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
  if (mode === "hasty") await advanceRounds(formation, 1, { reason: "action" });
  else await advanceTurns(formation, 1, { reason: "trapbreaking" });

  return { ok: true, outcome };
}

/**
 * Disarm, or set it off on purpose? The book gives the choice to whoever made
 * the throw, so it is asked rather than assumed — and it matters, because only
 * a disarmed trap can be re-armed afterwards.
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
  // Dismissing the question leaves the trap disarmed: it is the safer of the
  // two and the one a thief who stopped paying attention already achieved.
  return chosen === true;
}

/**
 * Set a disarmed trap going again. Only a DISARMED trap can be re-armed — a
 * discharged one has already fired and there is nothing left to re-arm.
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
  // Re-armed by the party's own hand, so they still know exactly where it is.
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
 * Put a trap back the way it was. A discharged trap can be reset by the Judge
 * (the mechanism is rebuilt); a DISARMED one is what a thief may re-arm, which
 * is the throw `attemptRearm` makes. Clears the hasty repeat-lock either way:
 * a rebuilt trap is not the one anybody failed against.
 */
export async function resetTrap(placement) {
  return placement.write({ state: STATES.armed, repeatLock: {}, searchLock: {}, known: false });
}

/**
 * The Judge says the party has found it — a discovery made some other way than
 * a Searching throw: a warning from a captive, a map, a description read aloud.
 * The state moves to `found` for the same reason a made throw does.
 */
export async function markTrapFound(placement) {
  return placement.write({ state: STATES.found, known: true });
}

/**
 * Set the mechanism, or make it safe — the Judge's hand on the trap itself.
 *
 * Armed and not-armed is the only distinction this makes, because it is the
 * only one the Judge is asserting: an armed trap goes safe, and anything else
 * goes armed. A SPENT trap is a special case and defers to `resetTrap` —
 * re-arming a discharged mechanism means rebuilding it, so the throws anybody
 * failed against the old one do not carry over onto the new one.
 *
 * Deliberately does not touch `known`. What the party has learned is not
 * changed by the Judge's hand on the mechanism, and a trap the party watched
 * being re-armed is still a trap they know about.
 */
export async function toggleArmed(placement) {
  if (placement.state === STATES.armed) return placement.write({ state: STATES.disarmed });
  if (placement.state === STATES.discharged) return resetTrap(placement);
  return placement.write({ state: STATES.armed });
}

/**
 * Show the trap to the party, or take it back out of sight.
 *
 * Writes `known` and nothing else. `markTrapFound` is the other half of this
 * pair and is a different act: it says the party DISCOVERED the trap, and moves
 * the state to `found` accordingly. This one only decides who is looking at the
 * marker, which is why an armed trap revealed this way stays armed — that
 * combination is the one a re-armed trap has always had.
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
