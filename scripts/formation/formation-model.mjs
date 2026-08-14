/* global game, foundry, ui, Actor, CONST */
import { carrierOf, attachmentOf, ATTACH_ROLES } from "../lib/attachment.mjs";
import { landSpeed } from "../vehicles/vehicle-speed.mjs";
import { VEHICLE_TYPE } from "../vehicles/constants.mjs";
import { load6 } from "../lib/capacity.mjs";
import { STONE } from "../lib/item-model.mjs";
import {
  BODY_STONE,
  DEFAULT_PARTY_IMAGE,
  FLAG_FORMATION_ID,
  MODULE_ID,
  ROLES,
  ROLE_GEAR,
  ROLE_HAND_COST,
  ROLE_LABELS,
} from "./constants.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { bodyCount, isGroupActor } from "../lib/group-logic.mjs";
import { monsterExplorationSpeed } from "./monster-traits.mjs";
import { canSeeInDark } from "../lib/senses.mjs";
import { carriesItem } from "../lib/item-model.mjs";
import { capacityStone } from "../lib/capacity.mjs";
import { announceChange } from "../lib/util.mjs";
import { equipForRole } from "./judge-override.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/** World-setting key holding all formation records, keyed by formation id. */
export const SETTING_FORMATIONS = "formations";

/**
 * A formation record (plain object, persisted in a world setting):
 * {
 *   id: string,
 *   name: string,
 *   actorId: string|null,   // dedicated party actor
 *   sceneId: string|null,   // scene holding the party token
 *   tokenId: string|null,   // the party token on that scene
 *   members: [{ actorId, roles: string[], tokenData: object|null }],
 *   lights:  [{ id, type, bearerId, remaining, lit }],
 *   clock: {
 *     turnsTotal: number,      // dungeon turns elapsed since formation created
 *     turnsSinceRest: number,  // exploration/combat turns since last rest
 *     encounterCounter: number,// turns since last wandering-monster throw
 *     carryFeet: number,       // movement distance not yet worth a full turn
 *     winded: boolean,
 *     paused: boolean,         // suspend movement-driven turn tracking
 *   },
 * }
 *
 * Marching order is the order of `members`. All mutation happens on a GM
 * client; the world setting propagates state to everyone else.
 */

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

/** Every formation, as a deep copy the caller may mutate before saving it back. */
export function getFormations() {
  return foundry.utils.deepClone(readFormations());
}

/**
 * The stored blob ITSELF — no copy, and therefore READ-ONLY. Mutating a record
 * from here edits the live setting cache without ever persisting it, and the
 * next save writes the mutation as if it had been asked for.
 *
 * This exists because the copy is the expensive part: a record carries a full
 * token snapshot per stashed member, so a forty-strong party costs forty token
 * documents to clone for a question as small as "is this actor holding a
 * torch?". The hot paths — a token moving, a loadout recomputing, a scene
 * sweep — ask exactly those questions and never write.
 */
export function readFormations() {
  return game.settings.get(MODULE_ID, SETTING_FORMATIONS) ?? {};
}

export function getFormation(id) {
  const record = id ? readFormations()[id] : null;
  return record ? foundry.utils.deepClone(record) : null;
}

/** The formation an actor is a member of, or null. (An actor is in at most one.) */
export function getFormationForActor(actorId) {
  if (!actorId) return null;
  for (const f of Object.values(readFormations())) {
    // Callers write to what they get back (the equipment sheet lights a torch
    // through it), so the match is copied even though the search is not.
    if (f?.members?.some((m) => m?.actorId === actorId)) return foundry.utils.deepClone(f);
  }
  return null;
}

/** How many light sources the actor is bearing in hand — see `handsOccupied`. */
export function heldLightCount(actorId) {
  return handsOccupied(actorId).lights;
}

/**
 * Every hand the party sheet says this actor already has full, and why.
 *
 * TWO SOURCES, one answer, because acks-equipment reads the total in a single
 * question:
 *  - **lights** — a source is in hand while it burns, and while a lantern is
 *    shuttered but still carried. A fully doused one is stowed and gives the
 *    hand back.
 *  - **mapping** — the mapper works with a quill in one hand and parchment in
 *    the other for as long as the role is held (RR p. 266, one hand per piece
 *    of kit).
 * @returns {{lights: number, mapping: number, total: number}}
 */
export function handsOccupied(actorId) {
  const busy = { lights: 0, mapping: 0, total: 0 };
  if (!actorId) return busy;
  for (const f of Object.values(readFormations())) {
    for (const l of f?.lights ?? []) {
      if (l.bearerId === actorId && (l.lit || l.shielded)) busy.lights++;
    }
    for (const m of f?.members ?? []) {
      if (m?.actorId !== actorId) continue;
      for (const role of m.roles ?? []) busy.mapping += ROLE_HAND_COST[role] ?? 0;
    }
  }
  busy.total = busy.lights + busy.mapping;
  return busy;
}

/**
 * Every light this actor carries as a formation member, or **null** when they
 * belong to no formation.
 *
 * Null is load-bearing: it is how `lib/light.mjs` distinguishes "a member who
 * happens to carry nothing" (an empty array — stay dark) from "not a member,
 * read the actor's own flag instead". Returning `[]` for both would leave every
 * standalone torch unlit.
 */
export function lightsForBearer(actorId) {
  if (!actorId) return null;
  let found = null;
  for (const f of Object.values(readFormations())) {
    if (!f?.members?.some((m) => m?.actorId === actorId)) continue;
    found ??= [];
    // Shallow copies: the search reads the stored blob directly, and a light
    // handed out of here must not be an editable handle on the setting cache.
    for (const l of f.lights ?? []) {
      if (l.bearerId === actorId) found.push({ ...l });
    }
  }
  return found;
}

/**
 * Every write to the formations setting funnels through one promise chain, so
 * two async flows can never interleave their read-modify-write halves. The
 * chain survives failures (a rejected save must not wedge every later one).
 */
let saveChain = Promise.resolve();

function enqueueSave(fn) {
  const run = saveChain.then(fn, fn);
  saveChain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

async function saveFormations(all) {
  return enqueueSave(() => game.settings.set(MODULE_ID, SETTING_FORMATIONS, all));
}

export async function updateFormation(formation) {
  const all = getFormations();
  all[formation.id] = formation;
  await saveFormations(all);
  return formation;
}

/**
 * Targeted mutation for BACKGROUND writers (map sessions, cleanup hooks):
 * re-reads the record FRESH inside the save lock, applies `mutate` to that
 * copy only, and persists. `mutate` may return `false` to decline (its guards
 * re-checked against current reality, not the stale copy it was called with).
 *
 * This exists because `updateFormation` writes the WHOLE record: a slow async
 * flow holding a copy from before someone else's save will erase that save on
 * completion. Deploy's combat flag was being erased exactly this way by the
 * environment sync that every settings change triggers.
 */
export async function patchFormation(id, mutate) {
  return enqueueSave(async () => {
    const all = getFormations();
    const record = all[id];
    if (!record) return null;
    if ((await mutate(record)) === false) return record;
    await game.settings.set(MODULE_ID, SETTING_FORMATIONS, all);
    return record;
  });
}

export async function createFormation(name, { actorId = null } = {}) {
  const id = foundry.utils.randomID();
  const formation = {
    id,
    name: name || game.i18n.localize("ACKS-FORMATION.app.defaultName"),
    actorId,
    sceneId: null,
    tokenId: null,
    tableId: null,
    frontage: 1,
    members: [],
    lights: [],
    spells: [],
    combat: null,
    clock: {
      turnsTotal: 0,
      turnsSinceRest: 0,
      encounterCounter: 0,
      carryFeet: 0,
      winded: false,
      paused: false,
    },
  };
  await updateFormation(formation);
  return formation;
}

export async function deleteFormationRecord(id) {
  const all = getFormations();
  delete all[id];
  await saveFormations(all);
}

/** Find the formation whose party token matches the given token document. */
export function formationForToken(tokenDoc) {
  const id = tokenDoc?.getFlag?.(MODULE_ID, FLAG_FORMATION_ID);
  return id ? getFormation(id) : null;
}

/* -------------------------------------------- */
/*  Derived data                                */
/* -------------------------------------------- */

export function getMemberActor(member) {
  return game.actors.get(member.actorId) ?? null;
}

/** Does this actor have a proficiency/class power matching the pattern? */
export function hasAbility(actor, pattern) {
  return actor?.items?.some((i) => i.type === ITEM_TYPE.ability && pattern.test(i.name)) ?? false;
}

/** The formation's mapper actor, if a member has the Mapper role. */
export function getMapperActor(formation) {
  const member = formation.members.find((m) => m.roles?.includes("mapper"));
  return member ? getMemberActor(member) : null;
}

/** Is the formation's mapper proficient in Mapping (RR p. 114)? */
export function mapperIsProficient(formation) {
  const mapper = getMapperActor(formation);
  if (!mapper) return false;
  return hasCapability(mapper, "kw:mapping") || hasAbility(mapper, /mapping/i);
}

/** Exploration speed in feet/turn. Monsters with a Full Monster Sheet report
 *  their own Speed table (running/exploration rate); otherwise the acks system
 *  value computed from encumbrance is used. */
export function explorationSpeedOf(actor) {
  const monster = monsterExplorationSpeed(actor);
  if (typeof monster === "number") return monster;
  const v = actor?.system?.movementacks?.exploration;
  if (typeof v === "number") return v;
  return actor?.system?.movement?.base ?? 0;
}

/** Real members of the marching order (grid cells minus blank slots). */
export function realMembers(formation) {
  return formation.members.filter((m) => m && !m.blank && m.actorId);
}

/**
 * Is this cell held by a STACK — one `acks-lib.group` actor standing for the
 * bodies it counts, rather than for itself?
 *
 * A formation occupant is either an individual or a stack, and that is the only
 * difference between them: a stack marches, fights, takes casualties and is
 * removed through the same model an individual is, at the headcount its own
 * sheet keeps.
 */
export function isStackMember(member) {
  return isGroupActor(getMemberActor(member));
}

/**
 * How many bodies this cell puts on the ground. One for an individual, one for
 * a blank (a gap is a square somebody deliberately left empty), and a stack's
 * whole living headcount for a stack.
 *
 * A member whose actor is gone still holds its square: the marching order should
 * not silently close up around a character whose sheet was deleted.
 */
export function cellBodies(member) {
  if (!member || member.blank || !member.actorId) return 1;
  const actor = getMemberActor(member);
  return actor ? bodyCount(actor) : 1;
}

/** Every body the marching order lays out, blank squares included. */
export function formationBodies(formation) {
  return (formation?.members ?? []).reduce((n, m) => n + cellBodies(m), 0);
}

/**
 * How many bodies the party musters — the number a Judge counts heads to get.
 * Blanks are gaps, not people, so they do not count here; a stack counts as the
 * bodies it holds, not as the one row it occupies.
 */
export function partyHeadcount(formation) {
  return realMembers(formation).reduce((n, m) => n + cellBodies(m), 0);
}

/** Down: at or below zero hit points (carried, dead, or dying). */
export function isDown(actor) {
  const hp = actor?.system?.hp?.value;
  return typeof hp === "number" && hp <= 0;
}

/** Exploration speed for an encumbrance total (RR speed tiers). */
function encToExplorationSpeed(enc, strMod = 0) {
  if (enc <= 5) return 120;
  if (enc <= 7) return 90;
  if (enc <= 10) return 60;
  if (enc <= 20 + strMod) return 30;
  return 0;
}

/**
 * Carried load: each down member counts as 7 3/6 stone plus half their
 * equipment encumbrance (the rescue rule, RULES.md §12), split evenly among
 * members with the Carrier role.
 */
export function carriedLoad(formation) {
  const members = realMembers(formation).map((m) => ({ member: m, actor: getMemberActor(m) }));
  const down = members.filter((e) => isDown(e.actor));
  const carriers = members.filter((e) => !isDown(e.actor) && e.member.roles?.includes(ROLES.CARRIER));
  const totalStone = down.reduce(
    (sum, e) => sum + BODY_STONE + Number(e.actor?.system?.encumbrance?.value ?? 0) / 2,
    0,
  );
  const sharePerCarrier = carriers.length ? Math.round((totalStone / carriers.length) * 10) / 10 : 0;
  return {
    down: down.map((e) => e.actor),
    carriers: carriers.map((e) => {
      const baseEnc = Number(e.actor?.system?.encumbrance?.value ?? 0);
      // The primitive answers with core's own maximum, which resolves a GM's
      // forced max against 20 + STR — never re-derive the formula here.
      const capacity = capacityStone(e.actor) ?? 20 + (e.actor?.system?.scores?.str?.mod ?? 0);
      const effEnc = Math.round((baseEnc + sharePerCarrier) * 10) / 10;
      return {
        actor: e.actor,
        name: e.actor.name,
        baseEnc,
        effEnc,
        capacity,
        speed: encToExplorationSpeed(effEnc, e.actor?.system?.scores?.str?.mod ?? 0),
        over: effEnc > capacity,
      };
    }),
    totalStone: Math.round(totalStone * 10) / 10,
    sharePerCarrier,
  };
}


/**
 * A carrier's pace in the same unit the party's other speeds use (feet per
 * turn), for the ground the formation is travelling.
 *
 * A vessel is not asked: a party at sea moves at the ship's voyage speed,
 * which is a different clock entirely (miles per day, not feet per turn) and
 * belongs to the voyage rules rather than to marching order.
 */
function carrierSpeedFor(carrier, formation) {
  // A wagon answers from its own load/speed tiers; a horse is just an actor
  // with a movement rate, so it answers the same way any member would.
  if (carrier?.type === VEHICLE_TYPE) {
    if (carrier.system?.kind !== "land") return null;
    const aboardStone = load6(carrier) / STONE;
    return landSpeed(carrier.system, aboardStone, formation?.ground ?? null).feetPerTurn;
  }
  return explorationSpeedOf(carrier);
}

/**
 * The party moves at the pace of its slowest WALKING member — and a member
 * riding in a wagon is not walking.
 *
 * Down members do not walk either; Carriers move at the speed of their own
 * encumbrance PLUS their share of the carried load. A passenger aboard a
 * vehicle contributes the VEHICLE's pace instead of their own, which is the
 * whole point of putting the heavily-laden merchant in the cart: their legs
 * stop setting the party's speed, and the wagon's wheels start. Every
 * passenger of one wagon contributes the same number, so a full cart counts
 * once in effect.
 */
export function partySpeed(formation) {
  const load = carriedLoad(formation);
  const dark = isPartyInDark(formation);
  const speeds = [];
  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor || isDown(actor)) continue;
    let speed;
    // Riding in or on ANYTHING — a wagon, a horse — means these legs are not
    // the ones setting the party's pace.
    const attachment = attachmentOf(actor);
    const carrier = ATTACH_ROLES[attachment?.role]?.setsPace ? carrierOf(actor) : null;
    if (carrier) {
      // The wagon's pace, for the ground the party says it is on. A vehicle
      // that cannot move at all (nothing in harness, or overloaded) makes the
      // party's speed zero, which is exactly what a stuck cart does to a road.
      speed = carrierSpeedFor(carrier, formation);
    } else if (load.down.length && member.roles?.includes(ROLES.CARRIER)) {
      const enc = Number(actor.system?.encumbrance?.value ?? 0) + load.sharePerCarrier;
      speed = encToExplorationSpeed(enc, actor.system?.scores?.str?.mod ?? 0);
    } else {
      speed = explorationSpeedOf(actor);
    }
    if (typeof speed !== "number") continue;
    // Blinded creatures move at 1/3 speed (RULES §4) — members who cannot
    // see in the dark slow the whole party unless they have dark senses.
    if (dark && !canSeeInDark(actor)) speed = Math.floor(speed / 3);
    speeds.push(speed);
  }
  if (!speeds.length) return 0;
  return Math.min(...speeds);
}

/** Any lit, unshuttered light source? */
export function formationHasLight(formation) {
  return formation.lights.some((l) => l.lit && !l.shielded);
}

/**
 * Can this actor operate without light (shadowy senses, lightless vision,
 * spell)? Owned by `lib/senses.mjs`, which answers the same reading of the
 * sheet that token vision is derived from — re-exported here so the movement
 * rules and the formation window keep their existing import.
 */
export { canSeeInDark };

/**
 * Is the party effectively in darkness? Only when the scene itself is dark
 * (so daylight travel is unaffected) and no unshuttered light is lit.
 */
export function isPartyInDark(formation) {
  const scene = getPartyScene(formation);
  if (!scene) return false;
  const darkness = scene.environment?.darknessLevel ?? scene.darkness ?? 0;
  if (darkness < 0.5) return false;
  return !formationHasLight(formation);
}

/**
 * The pieces of a role's kit this actor is NOT carrying, in declaration order.
 * Empty for a role that needs no implement, and empty for a character already
 * equipped — so an empty list is always "nothing stands in the way".
 */
export function missingRoleGear(actor, role) {
  return (ROLE_GEAR[role] ?? []).filter((spec) => !carriesItem(actor, spec.pattern));
}

/** Is this actor carrying everything the role needs? */
export const hasRoleGear = (actor, role) => missingRoleGear(actor, role).length === 0;

/**
 * Is the party hurrying (exploring at combat speed)? RR p. 263: exploration
 * speed is already the careful, quiet pace; a party CAN explore at combat
 * speed instead, but loses 10' poles, mapping, and hasty searching, and
 * makes much more noise.
 */
export function isHurried(formation) {
  return formation.stance?.pace === "hurried";
}

/** Feet covered per turn: exploration speed, or combat speed × 10 rounds. */
export function effectiveSpeed(formation) {
  const speed = partySpeed(formation);
  if (!isHurried(formation)) return speed;
  return Math.floor(speed / 3) * 10;
}

export function getPartyActor(formation) {
  return formation.actorId ? (game.actors.get(formation.actorId) ?? null) : null;
}

export function getPartyScene(formation) {
  return formation.sceneId ? (game.scenes.get(formation.sceneId) ?? null) : null;
}

export function getPartyToken(formation) {
  const scene = getPartyScene(formation);
  return scene && formation.tokenId ? (scene.tokens.get(formation.tokenId) ?? null) : null;
}

/* -------------------------------------------- */
/*  Party actor & token                         */
/* -------------------------------------------- */

async function ensurePartyActor(formation) {
  let actor = getPartyActor(formation);
  if (actor) return actor;

  const img = game.settings.get(MODULE_ID, "partyTokenImage") || DEFAULT_PARTY_IMAGE;
  const ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  if (game.settings.get(MODULE_ID, "playersMoveParty")) {
    ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
  }
  actor = await Actor.implementation.create({
    name: formation.name,
    type: `${MODULE_ID}.party`,
    img,
    ownership,
    prototypeToken: {
      name: formation.name,
      actorLink: true,
      displayName: CONST.TOKEN_DISPLAY_MODES.HOVER,
      disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY,
      texture: { src: img },
      sight: { enabled: true },
    },
    flags: { [MODULE_ID]: { [FLAG_FORMATION_ID]: formation.id } },
  });
  formation.actorId = actor.id;
  // Persist immediately: hooks fired by the creation above (and any later
  // failure) must find the formation already linked to its actor.
  await updateFormation(formation);
  return actor;
}

/** Create the party token at a position (usually the first member's token). */
export async function ensurePartyToken(formation, scene, x, y) {
  if (getPartyToken(formation)) return getPartyToken(formation);
  const actor = await ensurePartyActor(formation);

  const tokenData = (await actor.getTokenDocument({ x, y })).toObject();
  delete tokenData._id;
  foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${FLAG_FORMATION_ID}`, formation.id);
  const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [tokenData]);
  formation.sceneId = scene.id;
  formation.tokenId = tokenDoc.id;
  // Seed the movement tracker so the first drag measures from here.
  formation.clock.lastPosition = { x: tokenDoc.x, y: tokenDoc.y };
  // Persist the token linkage before anything else can read or write the
  // record (the createToken hook and setting listeners fire concurrently).
  await updateFormation(formation);
  await syncPartyActorSpeed(formation);
  return tokenDoc;
}

/**
 * Mirror the party's exploration speed onto the party actor so the system's
 * movement display (and any speed-aware tooling) shows the formation pace.
 */
export async function syncPartyActorSpeed(formation) {
  const actor = getPartyActor(formation);
  if (!actor) return;
  const speed = partySpeed(formation);
  const current = actor.system?.movement?.base;
  const updates = {};
  if (current !== speed) {
    updates["system.movement.base"] = speed;
    updates["system.movement.value"] = `${speed}'/turn (exploration)`;
  }
  if (Object.keys(updates).length) await actor.update(updates);
  // The actor is the source of truth for identity: renaming the party actor
  // (like any other actor) renames the formation, never the reverse.
  //
  // PATCH, not a whole-record write. This runs from the updateActor /
  // create|update|deleteItem hooks, whose `formation` copy was read when the
  // hook fired and may already be stale — and since 0.24 a light change makes
  // acks-equipment refresh the bearer's loadout, so those hooks now fire
  // constantly. A whole-record write here would revert whatever the in-flight
  // turn or light mutation had just saved.
  if (actor.name !== formation.name) {
    formation.name = actor.name;
    await patchFormation(formation.id, (rec) => {
      rec.name = actor.name;
    });
  }
}

/* -------------------------------------------- */
/*  Membership                                  */
/* -------------------------------------------- */

/**
 * Add an actor to a formation. If a canvas token for the actor is supplied
 * (or found on the current scene), it is stashed for later restoration and
 * removed from the canvas. The first member's token position seeds the party
 * token.
 *
 * ORDERING INVARIANT (data-loss guard): the member record — including the
 * stashed token — is PERSISTED to the world setting BEFORE the canvas token
 * is deleted. Anything that fails or interleaves after that point can at
 * worst leave a duplicate, never lose the character.
 */
export async function addMember(formation, actor, tokenDoc = null) {
  if (!actor) return formation;
  if (formation.members.some((m) => m.actorId === actor.id)) {
    ui.notifications.warn(game.i18n.format("ACKS-FORMATION.warn.alreadyMember", { name: actor.name }));
    return formation;
  }

  // Find the actor's token on its scene if not given one explicitly.
  if (!tokenDoc) {
    const scene = game.scenes.viewed ?? getPartyScene(formation);
    tokenDoc = scene?.tokens?.find((t) => t.actorId === actor.id && !t.getFlag(MODULE_ID, FLAG_FORMATION_ID)) ?? null;
  }

  const member = { actorId: actor.id, roles: [], tokenData: tokenDoc ? tokenDoc.toObject() : null };

  // New members fill the first empty slot in the grid, else march at the rear.
  const blankIndex = formation.members.findIndex((m) => m?.blank);
  if (blankIndex >= 0) formation.members[blankIndex] = member;
  else formation.members.push(member);
  // Stash before destroy: the member (and its token snapshot) hit storage now.
  await updateFormation(formation);

  if (tokenDoc) {
    const scene = tokenDoc.parent;
    // The first stashed token seeds the party token, wherever it stood.
    const needsPartyToken = !getPartyToken(formation);
    const { x, y } = tokenDoc;
    await scene.deleteEmbeddedDocuments("Token", [tokenDoc.id]);
    if (needsPartyToken) await ensurePartyToken(formation, scene, x, y);
  }

  // No second write: the member is already stored, and `ensurePartyToken`
  // persists its own linkage. Re-saving the record here would only replay a
  // copy that is now older than what those steps wrote.
  await syncPartyActorSpeed(formation);
  return formation;
}

/**
 * Hand out free squares around a point, spiralling outward.
 *
 * Squares already holding a token are skipped, and so is every square handed out
 * earlier in the same pass — that is what keeps a crowd from landing on one
 * cell. Off-scene squares are skipped too, until the spiral has offered as many
 * squares as the scene holds; past that a party is bigger than its map and gets
 * clamped onto it rather than marched off the edge.
 * @returns {() => {x: number, y: number}} call once per token to place
 */
function freeCellPlacer(scene, anchor) {
  const gs = scene.grid.size;
  const bounds = sceneBounds(scene);
  const extent = sceneGridExtent(scene);
  const capacity = extent ? extent.cols * extent.rows : 0;
  const taken = new Set();
  for (const token of scene.tokens) {
    taken.add(`${Math.round((token.x - anchor.x) / gs)},${Math.round((token.y - anchor.y) / gs)}`);
  }
  let slot = 0;
  return () => {
    for (;;) {
      const [dx, dy] = ringOffset(slot++);
      const key = `${dx},${dy}`;
      if (taken.has(key)) continue;
      const x = anchor.x + dx * gs;
      const y = anchor.y + dy * gs;
      const inside = !bounds || (x >= bounds.minX && x <= bounds.maxX && y >= bounds.minY && y <= bounds.maxY);
      if (!inside && slot <= capacity) continue;
      taken.add(key);
      return clampToScene(scene, x, y);
    }
  };
}

/**
 * Put stashed member tokens back on the map in ONE creation call.
 *
 * `grid` restores the marching-order SHAPE (used when the whole formation comes
 * apart at once); otherwise each token takes the next free square spiralling out
 * from the party. Either way the block is fitted to the scene, so a wide or deep
 * formation cannot deposit its rear ranks past the edge of the map.
 *
 * Consumes `tokenData` on the member records it is given — clearing the stash is
 * the caller's cue that these characters are back on the canvas.
 * @param {object[]} members the member records to restore
 * @returns {Promise<number>} how many tokens were created
 */
async function restoreMemberTokens(formation, members, { grid = false } = {}) {
  const stashed = members.filter((m) => m?.tokenData);
  if (!stashed.length) return 0;
  const scene = getPartyScene(formation) ?? game.scenes.viewed;
  if (!scene) return 0;

  const partyToken = getPartyToken(formation);
  const anchor = partyToken ? { x: partyToken.x, y: partyToken.y } : null;
  const origin = anchor && grid ? blockOrigin(formation, scene, anchor) : null;
  const nextFree = anchor && !grid ? freeCellPlacer(scene, anchor) : null;

  const toCreate = stashed.map((member) => {
    const data = foundry.utils.deepClone(member.tokenData);
    delete data._id;
    if (anchor) {
      const { x, y } = grid
        ? cellPosition(formation, scene, origin, formation.members.indexOf(member))
        : nextFree();
      data.x = x;
      data.y = y;
    }
    return data;
  });

  await scene.createEmbeddedDocuments("Token", toCreate);
  for (const member of stashed) member.tokenData = null;
  return toCreate.length;
}

/**
 * Take several members out of the formation at the cost of ONE write.
 *
 * The batched primitive: every departing member's token is restored in one
 * creation call and the record is saved once, so the sheet refresh and the
 * environment sync that ride on that save happen once too — not once per
 * character. `removeMember` is this called with a single id.
 *
 * @param {string[]} actorIds the actors to drop
 * @param {object} [opts]
 * @param {boolean} [opts.restore] put their stashed tokens back on the map
 */
export async function removeMembers(formation, actorIds, { restore = true } = {}) {
  const leaving = new Set((actorIds ?? []).filter(Boolean));
  if (!leaving.size) return formation;
  const departing = formation.members.filter((m) => m?.actorId && leaving.has(m.actorId));
  if (!departing.length) return formation;

  formation.members = formation.members.filter((m) => !(m?.actorId && leaving.has(m.actorId)));
  // Drop lights borne by, and spells cast by, the departing members.
  formation.lights = formation.lights.filter((l) => !leaving.has(l.bearerId));
  formation.spells = (formation.spells ?? []).filter((s) => !leaving.has(s.casterId));

  if (restore) await restoreMemberTokens(formation, departing);
  await syncPartyActorSpeed(formation);
  await updateFormation(formation);
  return formation;
}

export async function removeMember(formation, actorId, { restore = true } = {}) {
  return removeMembers(formation, [actorId], { restore });
}

/**
 * Dissolve a formation WITHOUT touching its party actor: restore every stashed
 * member token, remove the party token, and delete the record. This is both
 * the second half of `disband` and the cleanup for a formation whose party
 * actor is already gone (deleted from the sidebar) — the case that used to
 * leave a phantom record behind, silently re-adopted by the next "Add to
 * party" and resurrecting its actor.
 */
export async function dissolveFormation(formation) {
  try {
    const restored = await restoreMemberTokens(formation, formation.members, { grid: true });
    // Clear every stash in one write, and only when there was a stash to clear.
    // The creation above is a single call, so there is no half-restored state to
    // guard against: either the tokens are on the canvas and the stashes go, or
    // nothing happened and a retry starts over from an untouched record.
    if (restored) {
      await patchFormation(formation.id, (rec) => {
        for (const stored of rec.members ?? []) stored.tokenData = null;
      });
    }
  } catch (err) {
    console.error(`${MODULE_ID} | failed to restore member tokens`, err);
  }
  const scene = getPartyScene(formation);
  if (scene && formation.tokenId && scene.tokens.get(formation.tokenId)) {
    await scene.deleteEmbeddedDocuments("Token", [formation.tokenId]);
  }
  await deleteFormationRecord(formation.id);
}

/** Restore all member tokens, then remove the party token, actor, and record. */
export async function disband(formation) {
  await dissolveFormation(formation);
  // The record is already gone, so the deleteActor cleanup hook finds nothing
  // to do — no recursion.
  const actor = getPartyActor(formation);
  if (actor) await actor.delete();
}

/**
 * Drop every formation whose party actor no longer exists (restoring anything
 * stashed inside first). Runs once at ready on the primary GM: it clears the
 * phantom records accumulated by earlier versions, and any record orphaned by
 * a crash mid-flow.
 */
export async function pruneFormations() {
  for (const formation of Object.values(getFormations())) {
    if (formation.actorId && game.actors.get(formation.actorId)) continue;
    console.warn(`${MODULE_ID} | pruning formation "${formation.name}" — its party actor is gone`);
    try {
      await dissolveFormation(formation);
    } catch (err) {
      console.error(`${MODULE_ID} | failed to prune formation "${formation.name}"`, err);
    }
  }
}

/** Swap two grid cells (member↔member or member↔blank). */
export async function swapCells(formation, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= formation.members.length) return formation;
  if (target < 0 || target >= formation.members.length) return formation;
  const cells = formation.members;
  [cells[index], cells[target]] = [cells[target], cells[index]];
  await updateFormation(formation);
  return formation;
}

/** Append an empty slot to the marching grid. */
export async function addBlank(formation) {
  formation.members.push({ blank: true });
  await updateFormation(formation);
  return formation;
}

/** Remove the blank cell at a grid position. */
export async function removeBlank(formation, index) {
  if (formation.members[index]?.blank) {
    formation.members.splice(index, 1);
    await updateFormation(formation);
  }
  return formation;
}

/* -------------------------------------------- */
/*  Marching shape & placement                  */
/* -------------------------------------------- */

/**
 * How many march abreast (1 = single file; RR p. 264: 2 in corridors ≥6').
 *
 * ANY positive whole number is a formation width — a war party crossing open
 * ground lines up as wide as it likes. This is a read of stored state, so a
 * missing or corrupt value degrades to single file; the number a Judge TYPES is
 * validated where it is typed, so a bad entry is refused rather than rounded.
 */
/**
 * The marching order as a companion module consumes it — one row per REAL
 * member, in file order, with the rank/file cell computed from the current
 * frontage and the member's roles named. No token snapshots ride along: this
 * is the delve record (who stands where, who carries the pole, who scouts),
 * not a deployment payload. Published on `api.formation.marchingOrder` as part
 * of the versioned contract a trap module keys on.
 */
export function marchingOrder(formation) {
  const frontage = getFrontage(formation);
  return realMembers(formation).map((member, index) => {
    const actor = getMemberActor(member);
    return {
      actorId: member.actorId,
      name: actor?.name ?? null,
      roles: [...(member.roles ?? [])],
      rank: Math.floor(index / frontage),
      file: index % frontage,
    };
  });
}

export function getFrontage(formation) {
  const stored = Math.floor(Number(formation?.frontage));
  return Number.isFinite(stored) && stored >= 1 ? stored : 1;
}

/** Ranks deep at the current frontage. Measured in BODIES, so a stack takes up
 *  the ground it actually covers. */
export function partyDepth(formation, count = formationBodies(formation)) {
  return Math.max(1, Math.ceil(Math.max(count, 1) / getFrontage(formation)));
}

/** Grid offset (in grid units) of the index-th BODY in formation shape. */
export function formationOffset(formation, index) {
  const frontage = getFrontage(formation);
  return { dx: index % frontage, dy: Math.floor(index / frontage) };
}

/**
 * Which BODY the given marching-order cell starts at.
 *
 * Cells and bodies are the same thing only while every occupant is one person.
 * A stack of forty pushes everything behind it forty squares down the line, so
 * the ground position of a cell is read from the bodies ahead of it and never
 * from its own index.
 */
export function cellBodyIndex(formation, cell) {
  const cells = formation?.members ?? [];
  let index = 0;
  for (let i = 0; i < cell && i < cells.length; i++) index += cellBodies(cells[i]);
  return index;
}

/**
 * How many grid cells across and down the PLAYABLE area of a scene holds, or
 * null when the scene cannot say (no grid, or dimensions not computed yet).
 * @returns {{cols: number, rows: number}|null}
 */
export function sceneGridExtent(scene) {
  const gs = scene?.grid?.size;
  const rect = scene?.dimensions?.sceneRect ?? scene?.dimensions?.rect ?? null;
  if (!gs || !rect?.width || !rect?.height) return null;
  return { cols: Math.max(1, Math.floor(rect.width / gs)), rows: Math.max(1, Math.floor(rect.height / gs)) };
}

/**
 * The widest line this scene can actually hold, or null when it cannot say.
 * The ceiling on frontage is the map, never a number chosen here.
 */
export function maxFrontage(scene) {
  return sceneGridExtent(scene)?.cols ?? null;
}

/** Pixel range a 1×1 token may occupy on this scene, or null with no scene. */
function sceneBounds(scene) {
  const gs = scene?.grid?.size;
  const rect = scene?.dimensions?.sceneRect ?? scene?.dimensions?.rect ?? null;
  if (!gs || !rect?.width || !rect?.height) return null;
  return {
    minX: rect.x,
    minY: rect.y,
    maxX: rect.x + Math.max(0, rect.width - gs),
    maxY: rect.y + Math.max(0, rect.height - gs),
  };
}

/** A position pinned inside the scene. Unbounded scenes pass through. */
export function clampToScene(scene, x, y) {
  const bounds = sceneBounds(scene);
  if (!bounds) return { x, y };
  return {
    x: Math.min(Math.max(x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(y, bounds.minY), bounds.maxY),
  };
}

/**
 * Where the marching block's front-left cell goes so that the WHOLE block lands
 * on the scene.
 *
 * The block is shifted, never squashed: pinning each token to the edge instead
 * would pile every rear rank onto the last row. A block deeper or wider than the
 * scene itself starts at the top-left corner and the per-cell clamp takes over.
 *
 * @param {{x: number, y: number}} anchor where the block would start unclamped
 *   (the party token)
 */
export function blockOrigin(formation, scene, anchor, { count } = {}) {
  const gs = scene?.grid?.size ?? 0;
  const bounds = sceneBounds(scene);
  if (!bounds || !gs) return { x: anchor.x, y: anchor.y };
  const bodies = count ?? formationBodies(formation);
  // The block is as wide as the bodies actually FILL, not as wide as the frontage
  // allows: a five-strong party ordered twelve abreast is five squares wide, and
  // reserving twelve would shove it away from where the party stands.
  const span = (Math.min(getFrontage(formation), Math.max(bodies, 1)) - 1) * gs;
  const depth = (partyDepth(formation, bodies) - 1) * gs;
  return {
    x: Math.max(bounds.minX, Math.min(anchor.x, bounds.maxX - span)),
    y: Math.max(bounds.minY, Math.min(anchor.y, bounds.maxY - depth)),
  };
}

/** Scene position of one marching-order cell, measured from a block origin. For
 *  a stack this is where its FIRST body stands — see `cellPositions`. */
export function cellPosition(formation, scene, origin, cell) {
  return bodyPosition(formation, scene, origin, cellBodyIndex(formation, cell));
}

/** Scene position of the index-th body of the block. */
export function bodyPosition(formation, scene, origin, body) {
  const gs = scene?.grid?.size ?? 0;
  const { dx, dy } = formationOffset(formation, body);
  return clampToScene(scene, origin.x + dx * gs, origin.y + dy * gs);
}

/**
 * Every square one marching-order cell occupies, in order: one for an
 * individual, and one per living body for a stack.
 *
 * This is what lets a stack lie in the line instead of beside it — forty
 * mercenaries at a frontage of seven fill the rest of their rank and flow into
 * the ranks behind, and the occupant that follows them starts after the last of
 * them rather than on top of the first.
 *
 * @returns {{x: number, y: number}[]} one position per body of the cell
 */
export function cellPositions(formation, scene, origin, cell) {
  const first = cellBodyIndex(formation, cell);
  const bodies = cellBodies(formation?.members?.[cell]);
  return Array.from({ length: bodies }, (_, i) => bodyPosition(formation, scene, origin, first + i));
}

/**
 * Grid offsets around a token as a square spiral: the eight neighbours first,
 * then the ring beyond, outward without limit.
 *
 * Unbounded and repeat-free is the whole point — a fixed table of positions runs
 * out, and any party larger than the table lands on top of itself.
 * @returns {[number, number]} the `[dx, dy]` of the slot-th position out
 */
export function ringOffset(slot) {
  let n = Math.max(0, Math.floor(Number(slot) || 0));
  for (let r = 1; ; r++) {
    const perimeter = 8 * r;
    if (n < perimeter) {
      // Walk the ring clockwise from its top-left corner: top row, right
      // column, bottom row, left column — 8r cells, each visited once.
      const width = 2 * r + 1;
      if (n < width) return [n - r, -r];
      n -= width;
      if (n < 2 * r) return [r, n - r + 1];
      n -= 2 * r;
      if (n < 2 * r) return [r - 1 - n, r];
      n -= 2 * r;
      return [-r, r - 1 - n];
    }
    n -= perimeter;
  }
}

/**
 * Reorder into an **I-formation** (RR p. 264 guidance): a FULL front line of
 * the best fighters and a FULL back line of rear guard / missile users are
 * staffed first; whatever remains — non-combatants, the vulnerable mapper,
 * spellcasters — holds the middle ranks, centered with blank slots padding
 * the edges so the utility core never walks the flanks.
 */
export async function autoArrange(formation) {
  const POLEARM = /spear|polearm|pole\s*arm|lance|pike|halberd|glaive/i;
  const frontage = getFrontage(formation);

  const entries = realMembers(formation).map((member, index) => {
    const actor = getMemberActor(member);
    const items = actor?.items ?? [];
    const roles = member.roles ?? [];
    const equipped = [...items].filter((i) => i.type === ITEM_TYPE.weapon && i.system?.equipped);
    const caster = [...items].some((i) => i.type === ITEM_TYPE.spell);
    const ac = Number(actor?.system?.aac?.value ?? actor?.system?.aac ?? 0);

    // Pools: front-capable, back-capable, utility (middle).
    let pool;
    let priority;
    if (roles.includes(ROLES.NONCOMBATANT) || roles.includes(ROLES.MAPPER)) {
      pool = "mid";
      priority = 0;
    } else if (roles.includes(ROLES.REARGUARD)) {
      pool = "back";
      priority = 0;
    } else if (equipped.some((w) => w.system?.missile && !w.system?.melee)) {
      pool = "back";
      priority = 1;
    } else if (caster) {
      pool = "mid";
      priority = 1;
    } else if (roles.includes(ROLES.SCOUT)) {
      pool = "front";
      priority = 0;
    } else if (equipped.some((w) => POLEARM.test(w.name))) {
      pool = "front";
      priority = 2; // spears behind the shield wall when the front is full
    } else {
      pool = "front";
      priority = 1;
    }
    return { member, index, pool, priority, ac };
  });

  const byOrder = (a, b) => a.priority - b.priority || b.ac - a.ac || a.index - b.index;
  const front = entries.filter((e) => e.pool === "front").sort(byOrder);
  const back = entries.filter((e) => e.pool === "back").sort(byOrder);
  const mid = entries.filter((e) => e.pool === "mid").sort(byOrder);

  // Staff the full front line first, then the full back line, from the most
  // combat-capable available; utility only fills lines as a last resort.
  const take = (n, ...pools) => {
    const out = [];
    for (const pool of pools) while (out.length < n && pool.length) out.push(pool.shift());
    return out;
  };
  const frontLine = take(frontage, front, back, mid);
  const backLine = take(frontage, back, front, mid);
  const middle = [...front, ...mid, ...back]; // leftovers, fighters first

  // Middle ranks: chunk to frontage, centering each rank with blank slots.
  const cells = frontLine.map((e) => e.member);
  while (middle.length) {
    const rank = middle.splice(0, frontage).map((e) => e.member);
    const pad = frontage - rank.length;
    const left = Math.floor(pad / 2);
    cells.push(
      ...Array.from({ length: left }, () => ({ blank: true })),
      ...rank,
      ...Array.from({ length: pad - left }, () => ({ blank: true })),
    );
  }
  if (backLine.length) {
    // Keep the back line the LAST rank: pad the row before it if uneven.
    const remainder = cells.length % frontage;
    if (remainder) cells.push(...Array.from({ length: frontage - remainder }, () => ({ blank: true })));
    cells.push(...backLine.map((e) => e.member));
  }

  formation.members = cells;
  await updateFormation(formation);
  return formation;
}

/**
 * Take up or set down a role.
 *
 * TAKING one is what is gated: a role with a declared kit (`ROLE_GEAR`) needs
 * that kit in the character's hands — a 10' pole to probe with, a quill and
 * parchment to map with. Setting a role DOWN is never gated; a character can
 * always stop doing a job.
 *
 * `override` is the Judge saying it happens anyway: the kit is supplied and the
 * hands emptied (see judge-override.mjs) instead of the role being refused.
 * @param {object} [opts]
 * @param {boolean} [opts.override] GM authority — equip rather than refuse
 */
export async function toggleRole(formation, actorId, role, { override = false } = {}) {
  const member = formation.members.find((m) => m.actorId === actorId);
  if (!member) return formation;
  member.roles ??= [];

  if (!member.roles.includes(role)) {
    const actor = getMemberActor(member);
    if (override) await equipForRole(actor, role);
    const missing = missingRoleGear(actor, role);
    if (missing.length) {
      ui.notifications.warn(
        game.i18n.format("ACKS-FORMATION.warn.noRoleGear", {
          name: actor?.name ?? "?",
          role: game.i18n.localize(ROLE_LABELS[role] ?? role),
          items: missing.map((spec) => game.i18n.localize(spec.label)).join(", "),
        }),
      );
      // A Judge who overrode is told what could not be supplied, not stopped by
      // it — the role goes on regardless.
      if (!override) return formation;
    }
    member.roles.push(role);
  } else {
    member.roles = member.roles.filter((r) => r !== role);
  }

  await updateFormation(formation);
  // A role can fill hands (the mapper's kit), so acks-equipment recomputes the
  // loadout off this exactly as it does off a light being struck.
  announceChange("acksExtras.roleChanged", getMemberActor(member), {
    actorId,
    role,
    held: member.roles.includes(role),
  });
  return formation;
}
