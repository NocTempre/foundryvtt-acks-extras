/* global game, foundry, ui, Actor, CONST */
import { BODY_STONE, DEFAULT_PARTY_IMAGE, FLAG_FORMATION_ID, MODULE_ID, POLE_ITEM_PATTERN, ROLES } from "./constants.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import { monsterExplorationSpeed } from "./monster-traits.mjs";
import { canSeeInDark } from "../lib/senses.mjs";

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

export function getFormations() {
  return foundry.utils.deepClone(game.settings.get(MODULE_ID, SETTING_FORMATIONS) ?? {});
}

export function getFormation(id) {
  return id ? (getFormations()[id] ?? null) : null;
}

/** The formation an actor is a member of, or null. (An actor is in at most one.) */
export function getFormationForActor(actorId) {
  if (!actorId) return null;
  for (const f of Object.values(getFormations())) {
    if (f?.members?.some((m) => m?.actorId === actorId)) return f;
  }
  return null;
}

/**
 * How many light sources the actor is BEARING IN HAND right now — the number of
 * hands their lights occupy. A light is in hand while it is lit (a burning
 * torch/lantern) or a shielded-but-carried lantern (shutter closed, still
 * held); a fully doused source is stowed and frees the hand. Consumed by
 * acks-equipment so hands-available matches who is holding a light.
 */
export function heldLightCount(actorId) {
  if (!actorId) return 0;
  let n = 0;
  for (const f of Object.values(getFormations())) {
    for (const l of f?.lights ?? []) {
      if (l.bearerId === actorId && (l.lit || l.shielded)) n++;
    }
  }
  return n;
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
  for (const f of Object.values(getFormations())) {
    if (!f?.members?.some((m) => m?.actorId === actorId)) continue;
    found ??= [];
    for (const l of f.lights ?? []) {
      if (l.bearerId === actorId) found.push(l);
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
  return actor?.items?.some((i) => i.type === "ability" && pattern.test(i.name)) ?? false;
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
      const capacity = 20 + (e.actor?.system?.scores?.str?.mod ?? 0);
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
 * The party moves at the pace of its slowest walking member. Down members do
 * not walk; Carriers move at the speed of their own encumbrance PLUS their
 * share of the carried load.
 */
export function partySpeed(formation) {
  const load = carriedLoad(formation);
  const dark = isPartyInDark(formation);
  const speeds = [];
  for (const member of realMembers(formation)) {
    const actor = getMemberActor(member);
    if (!actor || isDown(actor)) continue;
    let speed;
    if (load.down.length && member.roles?.includes(ROLES.CARRIER)) {
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

/** Does this actor carry a physical pole (or polearm) for probing? */
export function hasPoleItem(actor) {
  return (
    actor?.items?.some(
      (i) =>
        POLE_ITEM_PATTERN.test(i.name) &&
        (i.type === "weapon" || i.type === "item") &&
        (i.system?.quantity?.value ?? 1) > 0,
    ) ?? false
  );
}

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

  await syncPartyActorSpeed(formation);
  await updateFormation(formation);
  return formation;
}

/** Ring of grid offsets used to place restored member tokens around the party. */
export const RESTORE_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [-1, 1], [1, -1], [-1, -1],
  [2, 0], [-2, 0], [0, 2], [0, -2],
  [2, 1], [-2, 1], [2, -1], [-2, -1],
];

async function restoreMemberToken(formation, member, { grid = null, ringSlot = 0 } = {}) {
  if (!member.tokenData) return;
  const scene = getPartyScene(formation) ?? game.scenes.viewed;
  if (!scene) return;

  const data = foundry.utils.deepClone(member.tokenData);
  delete data._id;

  const partyToken = getPartyToken(formation);
  if (partyToken) {
    const gs = scene.grid.size;
    if (grid !== null) {
      // Marching-order shape on the party token's footprint.
      const { dx, dy } = formationOffset(formation, grid);
      data.x = partyToken.x + dx * gs;
      data.y = partyToken.y + dy * gs;
    } else {
      const [ox, oy] = RESTORE_OFFSETS[ringSlot % RESTORE_OFFSETS.length];
      data.x = partyToken.x + ox * gs;
      data.y = partyToken.y + oy * gs;
    }
  }
  await scene.createEmbeddedDocuments("Token", [data]);
  member.tokenData = null;
}

export async function removeMember(formation, actorId, { restore = true } = {}) {
  const idx = formation.members.findIndex((m) => m.actorId === actorId);
  if (idx < 0) return formation;
  const [member] = formation.members.splice(idx, 1);
  if (restore) await restoreMemberToken(formation, member, { ringSlot: Math.floor(Math.random() * RESTORE_OFFSETS.length) });
  // Drop lights borne by, and spells cast by, the departing member.
  formation.lights = formation.lights.filter((l) => l.bearerId !== actorId);
  formation.spells = (formation.spells ?? []).filter((s) => s.casterId !== actorId);
  await syncPartyActorSpeed(formation);
  await updateFormation(formation);
  return formation;
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
  const members = [...formation.members];
  for (let i = 0; i < members.length; i++) {
    const member = members[i];
    if (!member?.tokenData) continue;
    try {
      await restoreMemberToken(formation, member, { grid: i });
      // Persist each cleared stash: a failure mid-loop must not re-restore
      // (duplicate) the already-placed tokens on a retry.
      await patchFormation(formation.id, (rec) => {
        const stored = rec.members.find((m) => m.actorId === member.actorId);
        if (stored) stored.tokenData = null;
      });
    } catch (err) {
      console.error(`${MODULE_ID} | failed to restore a member token`, err);
    }
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

/** How many march abreast (1 = single file; RR p. 264: 2 in corridors ≥6'). */
export function getFrontage(formation) {
  return Math.min(Math.max(Number(formation.frontage) || 1, 1), 3);
}

/** Ranks deep at the current frontage. */
export function partyDepth(formation, count = formation.members.length) {
  return Math.max(1, Math.ceil(Math.max(count, 1) / getFrontage(formation)));
}

/** Grid offset (in grid units) of the index-th position in formation shape. */
export function formationOffset(formation, index) {
  const frontage = getFrontage(formation);
  return { dx: index % frontage, dy: Math.floor(index / frontage) };
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
    const equipped = [...items].filter((i) => i.type === "weapon" && i.system?.equipped);
    const caster = [...items].some((i) => i.type === "spell");
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

export async function toggleRole(formation, actorId, role) {
  const member = formation.members.find((m) => m.actorId === actorId);
  if (!member) return formation;
  member.roles ??= [];
  // The 10' Pole role needs the implement in inventory (pole or polearm).
  if (role === ROLES.POLE && !member.roles.includes(role) && !hasPoleItem(getMemberActor(member))) {
    ui.notifications.warn(
      game.i18n.format("ACKS-FORMATION.warn.noPoleItem", { name: getMemberActor(member)?.name ?? "?" }),
    );
    return formation;
  }
  if (member.roles.includes(role)) member.roles = member.roles.filter((r) => r !== role);
  else member.roles.push(role);
  await updateFormation(formation);
  return formation;
}
