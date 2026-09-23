/* global game, foundry, Actor, Roll, Hooks, CONST, fromUuid, fromUuidSync */
/**
 * Group operations — the lifecycle of a stacked actor (see data/group-data.mjs).
 * A group holds a LIST of stacks, each with a SPARSE roster (a record per body
 * that has diverged; nothing for pristine bodies). See docs/lib/GROUPS.md,
 * "The lifecycle" for the deploy/recall compatibility strategy and its table
 * of operations, "The roster follows the canvas, not the other way round" and
 * "Group writes are batched, not per-body" for two invariants kept throughout.
 *
 * These operations write world documents (tokens, actors) and so run on the
 * calling client under Foundry's own permission checks; they do not route
 * over a socket — a consumer needing GM-routed writes wraps them.
 */
import { MODULE_ID } from "./constants.mjs";
import GroupData, { GROUP_CATEGORY, GROUP_STATE } from "./data/group-data.mjs";
import {
  GROUP_ACTOR_TYPE,
  bodyCount,
  cleanDelta,
  isDerivedEffect,
  isGroupActor,
  memberName,
  nextOrdinal,
  sizeFromEcology,
} from "./group-logic.mjs";
import { isPrimaryGM } from "./util.mjs";

// Re-export the Foundry-free lifecycle logic so consumers reach it all through
// `acksLib.groups`, while the pure half stays independently Node-importable.
export {
  GROUP_ACTOR_TYPE,
  GROUP_CATEGORY,
  bodyCount,
  cleanDelta,
  isDerivedEffect,
  isGroupActor,
  memberName,
  nextOrdinal,
  sizeFromEcology,
};

/** Token/flag keys linking a deployed token back to its group, stack, and member. */
export const GROUP_FLAG = "group"; // on the token: the group actor's uuid
export const STACK_FLAG = "stack"; // on the token: the stack's key within the group
export const MEMBER_FLAG = "member"; // on the token: the roster member's key

/** Hooks other modules key off. Namespaced per the family convention. */
export const GROUP_HOOKS = Object.freeze({
  DEPLOYED: "acksLibGroupDeployed",
  RECALLED: "acksLibGroupRecalled",
  CASUALTY: "acksLibGroupCasualty",
  DETACHED: "acksLibGroupDetached",
});

/** Is this actor one of our stacks? Read the registered type, not a guess. */
export const isGroup = (actor) => actor?.system instanceof GroupData || isGroupActor(actor);

/* -------------------------------------------- */
/*  Stack storage helpers                        */
/* -------------------------------------------- */

/**
 * Read-modify-write ONE stack by key, re-reading fresh so concurrent writes to
 * different stacks (or members) do not clobber each other. `mutate` edits the
 * stack object in place; a missing key is a no-op that returns false.
 */
export async function patchStack(group, stackKey, mutate) {
  const stacks = group.system.toObject().stacks;
  const stack = stacks.find((s) => s.key === stackKey);
  if (!stack) return false;
  mutate(stack);
  await group.update({ "system.stacks": stacks });
  return true;
}

/**
 * Read-modify-write ONE roster member of ONE stack, re-reading fresh so
 * concurrent deploys of different members do not clobber each other's writes.
 * `mutate` edits the member in place; a missing stack or key is a no-op.
 */
export async function patchMember(group, stackKey, memberKey, mutate) {
  const stacks = group.system.toObject().stacks;
  const stack = stacks.find((s) => s.key === stackKey);
  const member = stack?.roster.find((m) => m.key === memberKey);
  if (!member) return false;
  mutate(member);
  await group.update({ "system.stacks": stacks });
  return true;
}

/* -------------------------------------------- */
/*  Member tokens                                */
/* -------------------------------------------- */

/** The note a body carries once it has fallen. */
function fellNote() {
  return game?.i18n?.localize?.("ACKS-LIB.group.fellInBattle") || "fell in battle";
}

/** Roster order within one band: by ordinal, so "#3 fell" stays legible. */
const byOrdinal = (a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0);

/**
 * The token a deployed member is standing on, or null when it is gone.
 * Resolved SYNCHRONOUSLY — world documents always are — so the token can be
 * collected before a write clears the link that names it.
 */
function memberToken(member) {
  const uuid = member?.tokenUuid;
  if (!uuid) return null;
  const doc = typeof fromUuidSync === "function" ? fromUuidSync(uuid) : null;
  return doc?.documentName === "Token" ? doc : null;
}

/**
 * A deployed body's hit points, read so it survives the token's destruction:
 * the synthetic actor is torn down with the token, but the delta the member's
 * own HP was rolled into is still on the document. Null when neither can say.
 */
function tokenHp(tokenDoc) {
  const live = tokenDoc?.actor?.system?.hp?.value;
  if (typeof live === "number") return live;
  const delta = tokenDoc?.delta?.toObject?.() ?? tokenDoc?.delta ?? {};
  const stored = foundry.utils.getProperty(delta, "system.hp.value");
  return typeof stored === "number" ? stored : null;
}

/** Did this body come off the field at or below zero hit points? */
function fell(tokenDoc) {
  const hp = tokenHp(tokenDoc);
  return typeof hp === "number" && hp <= 0;
}

/** Delete tokens across however many scenes they are on, one call per scene. */
async function removeTokens(tokens) {
  const perScene = new Map();
  for (const token of tokens) {
    if (!token?.parent) continue;
    if (!perScene.has(token.parent)) perScene.set(token.parent, []);
    perScene.get(token.parent).push(token.id);
  }
  for (const [scene, ids] of perScene) {
    try {
      await scene.deleteEmbeddedDocuments("Token", ids);
    } catch (err) {
      console.warn(`${MODULE_ID} | could not remove ${ids.length} member token(s)`, err);
    }
  }
}

/**
 * Fold a batch of deployed members back into their stacks in ONE write: store
 * what happened to each body while it was out, drop the ones that came back at
 * ≤0 hp to casualties, and shrink each stack by the number that fell. Callers
 * stash through here before deleting the tokens the folds were read from.
 *
 * @param {{stackKey: string, memberKey: string, delta: object, fell: boolean}[]} folds
 * @returns {Promise<number>} how many of them fell
 */
async function foldMembers(group, folds) {
  if (!folds.length) return 0;
  let casualties = 0;
  const stacks = group.system.toObject().stacks;
  for (const fold of folds) {
    const stack = stacks.find((s) => s.key === fold.stackKey);
    const member = stack?.roster.find((m) => m.key === fold.memberKey);
    // A body already dead or promoted out left the headcount when that
    // happened; folding it a second time would take it off twice.
    if (!member || member.state === GROUP_STATE.dead || member.state === GROUP_STATE.detached) continue;
    member.delta = fold.delta;
    member.tokenUuid = "";
    if (fold.fell) {
      member.state = GROUP_STATE.dead;
      member.note = member.note || fellNote();
      stack.size.current = Math.max(0, (stack.size.current ?? 0) - 1);
      casualties++;
    } else {
      member.state = GROUP_STATE.materialized;
    }
  }
  await group.update({ "system.stacks": stacks });
  return casualties;
}

/**
 * A `deployed` record whose token no longer exists is a body still standing,
 * not a body spent: flip it back to `materialized` so it is chosen again,
 * rather than shrinking the headcount. See docs/lib/DECISIONS.md, "The roster
 * follows the canvas, not the other way round".
 *
 * @returns {Promise<number>} how many records were freed
 */
export async function reconcileStrandedMembers(group) {
  if (!isGroup(group)) return 0;
  const stacks = group.system.toObject().stacks;
  let freed = 0;
  for (const stack of stacks) {
    for (const member of stack.roster ?? []) {
      if (member.state !== GROUP_STATE.deployed) continue;
      if (memberToken(member)) continue;
      member.state = GROUP_STATE.materialized;
      member.tokenUuid = "";
      freed++;
    }
  }
  if (freed) await group.update({ "system.stacks": stacks });
  return freed;
}

/**
 * A member's token was removed from a scene by something other than a recall
 * (the Judge clearing the fallen off the board). Reconcile the roster with
 * what the canvas now says: fold the body back in, and drop the stack's
 * headcount if it left at ≤0 hp. Keyed on the record still naming THIS token,
 * which every deliberate route (recall, casualties, detach) clears first.
 */
async function reconcileDeletedToken(tokenDoc) {
  const groupUuid = tokenDoc.getFlag(MODULE_ID, GROUP_FLAG);
  const group = groupUuid ? await fromUuid(groupUuid) : null;
  if (!isGroup(group)) return;
  const stackKey = tokenDoc.getFlag(MODULE_ID, STACK_FLAG) ?? group.system.primaryStack?.key;
  const memberKey = tokenDoc.getFlag(MODULE_ID, MEMBER_FLAG);
  const member = group.system.stackOf(stackKey)?.roster.find((m) => m.key === memberKey);
  if (member?.state !== GROUP_STATE.deployed || member.tokenUuid !== tokenDoc.uuid) return;
  const dead = await foldMembers(group, [
    { stackKey, memberKey, delta: cleanDelta(tokenDoc.delta?.toObject?.() ?? {}), fell: fell(tokenDoc) },
  ]);
  if (dead) Hooks.callAll(GROUP_HOOKS.CASUALTY, group, dead, stackKey);
}

/**
 * Keep every stack's roster true to the canvas. One client does the write, so
 * the primary GM alone reconciles; other clients see the result through the
 * actor update.
 */
export function registerGroupCleanup() {
  Hooks.on("deleteToken", (tokenDoc) => {
    if (!isPrimaryGM() || !tokenDoc?.getFlag?.(MODULE_ID, GROUP_FLAG)) return;
    reconcileDeletedToken(tokenDoc).catch((err) => {
      console.error(`${MODULE_ID} | group roster reconciliation failed`, err);
    });
  });
}

/* -------------------------------------------- */
/*  Prototype / stacks                           */
/* -------------------------------------------- */

/** The one-body stat block the GROUP token shows: mirror the source onto the
 *  representative fields. Called when the FIRST stack's prototype is set. */
function representativeMirror(source) {
  const sys = source.system ?? {};
  const mirror = {};
  if (sys.hp) mirror["system.hp"] = { hd: sys.hp.hd, value: sys.hp.value, max: sys.hp.max, bhr: sys.hp.bhr };
  if (sys.aac) mirror["system.aac"] = { value: sys.aac.value ?? 0, mod: sys.aac.mod ?? 0 };
  if (sys.saves) mirror["system.saves"] = foundry.utils.deepClone(sys.saves);
  if (sys.thac0?.throw != null) mirror["system.thac0.throw"] = sys.thac0.throw;
  if (sys.movement?.base != null) mirror["system.movement.base"] = sys.movement.base;
  if (sys.details?.alignment) mirror["system.details.alignment"] = sys.details.alignment;
  if (sys.details?.morale != null) mirror["system.details.morale"] = sys.details.morale;
  return mirror;
}

/** A stack source object seeded from an actor: snapshot + label + type + size. */
function stackFromSource(source, { count = 0, key } = {}) {
  return {
    key: key ?? foundry.utils.randomID(),
    template: {
      uuid: source.uuid ?? null,
      type: source.type ?? "monster",
      label: source.name ?? "",
      snapshot: source.toObject(),
      snapshotTime: Math.floor(game?.time?.worldTime ?? 0),
    },
    size: { current: Math.max(0, count | 0), initial: Math.max(0, count | 0), formula: sizeFromEcology(source) ?? "" },
    roster: [],
  };
}

/**
 * Add a new stack to the group from a source actor (a monster, character, or
 * acks-lib.animal). This is how a mixed unit is built: one `addStack` per
 * troop type — swordsmen, then spearmen. If it becomes the FIRST stack, the
 * group's representative-individual block (the token's bar) is seeded from it.
 *
 * @returns {Promise<string|null>} the new stack's key, or null
 */
export async function addStack(group, source, { count = 0 } = {}) {
  if (!isGroup(group) || !source) return null;
  const stacks = group.system.toObject().stacks;
  const stack = stackFromSource(source, { count });
  stacks.push(stack);
  const update = { "system.stacks": stacks };
  if (stacks.length === 1) Object.assign(update, representativeMirror(source));
  await group.update(update);
  return stack.key;
}

/**
 * Re-point an existing stack at a new prototype (snapshot ⊕ label ⊕ type),
 * preserving its headcount and roster. Reseeds the representative block if this
 * is the first stack.
 */
export async function setStackPrototype(group, stackKey, source) {
  if (!isGroup(group) || !source) return false;
  const stacks = group.system.toObject().stacks;
  const idx = stacks.findIndex((s) => s.key === stackKey);
  if (idx < 0) return false;
  stacks[idx].template = {
    uuid: source.uuid ?? null,
    type: source.type ?? "monster",
    label: source.name ?? "",
    snapshot: source.toObject(),
    snapshotTime: Math.floor(game?.time?.worldTime ?? 0),
  };
  if (!stacks[idx].size.formula) stacks[idx].size.formula = sizeFromEcology(source) ?? "";
  const update = { "system.stacks": stacks };
  if (idx === 0) Object.assign(update, representativeMirror(source));
  await group.update(update);
  return true;
}

/** Remove a stack entirely (its bodies and records go with it). */
export async function removeStack(group, stackKey) {
  if (!isGroup(group)) return false;
  const stacks = group.system.toObject().stacks.filter((s) => s.key !== stackKey);
  await group.update({ "system.stacks": stacks });
  return true;
}

/**
 * Back-compat convenience: point the group at ONE prototype. With no stacks yet
 * it creates the first; otherwise it re-points the primary stack. New callers
 * building a mixed unit should use `addStack` per troop type.
 */
export async function setPrototype(group, source, { count = 0 } = {}) {
  if (!isGroup(group) || !source) return false;
  const primary = group.system.primaryStack;
  if (!primary) return (await addStack(group, source, { count })) != null;
  return setStackPrototype(group, primary.key, source);
}

/**
 * Ensure a STACK has a WORLD actor to be the ActorDelta base (a compendium uuid
 * cannot be one — see docs/lib/GROUPS.md, "Member records ARE ActorDeltas").
 * Uses the stack's prototype if it already points at a world actor; otherwise
 * mints one from the snapshot (hidden, owned by nobody) and remembers it.
 *
 * @returns {Promise<Actor|null>}
 */
export async function ensureBaseActor(group, stackKey) {
  const stack = group.system.stackOf(stackKey);
  if (!stack) return null;
  const tmpl = stack.template ?? {};
  if (tmpl.uuid) {
    const existing = await fromUuid(tmpl.uuid);
    // A world Actor is a valid base; a token/compendium doc is not.
    if (existing?.documentName === "Actor" && !existing.pack) return existing;
  }
  const snap = foundry.utils.deepClone(tmpl.snapshot ?? {});
  if (!snap.type) return null; // nothing to mint from
  delete snap._id;
  snap.name = tmpl.label || snap.name || "Group template";
  foundry.utils.setProperty(snap, "prototypeToken.actorLink", false);
  // Keep template actors out of the way and non-playable: owned by nobody, hidden.
  snap.ownership = { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.NONE };
  foundry.utils.setProperty(snap, `flags.${MODULE_ID}.templateFor`, group.uuid);
  const base = await Actor.implementation.create(snap);
  if (base) await patchStack(group, stackKey, (s) => (s.template.uuid = base.uuid));
  return base ?? null;
}

/* -------------------------------------------- */
/*  Roster mutation (per stack)                  */
/* -------------------------------------------- */

/** A stack's hit-dice formula: from its own prototype snapshot, else 1d8. */
function stackHd(stack) {
  return stack?.template?.snapshot?.system?.hp?.hd || "1d8";
}

/** Roll a body's hit points from a hit-dice formula, mirroring the system's own
 *  unlinked-monster HP roll. Falls back to a single die's worth on error. */
async function rollBodyHp(stack) {
  const hd = stackHd(stack);
  try {
    const roll = await new Roll(hd).evaluate();
    return roll.total;
  } catch {
    return 4;
  }
}

/**
 * Turn `n` pristine bodies of ONE stack into roster records in ONE write — the
 * transition that first makes members individual. Each rolls its own HP (a body
 * is only worth its own hit points once it matters) into its delta. Does NOT
 * change `size.current` (the bodies already existed; they just gained records).
 *
 * Capped at the pristine that exist, so asking for more than the stack holds
 * returns what it could give rather than inventing bodies.
 *
 * @param {object} [opts]
 * @param {string[]} [opts.names] a name per body, in order; absent → numbered
 * @param {object} [opts.extraDelta] merged into every new member's delta
 * @returns {Promise<object[]>} the new member records
 */
export async function materializeMembers(group, stackKey, n, { names = [], extraDelta = {} } = {}) {
  if (!isGroup(group)) return [];
  const stack = group.system.stackOf(stackKey);
  if (!stack) return [];
  const count = Math.min(Math.max(0, Math.floor(n)), group.system.pristineCountOf(stack));
  if (count <= 0) return [];

  const members = [];
  let ordinal = nextOrdinal(stack);
  for (let i = 0; i < count; i++) {
    const hp = await rollBodyHp(stack);
    members.push({
      key: foundry.utils.randomID(),
      ordinal: ordinal++,
      name: names[i] ?? "",
      delta: foundry.utils.mergeObject({ system: { hp: { value: hp, max: hp } } }, extraDelta, { inplace: false }),
      state: GROUP_STATE.materialized,
      tokenUuid: "",
      actorUuid: "",
      note: "",
    });
  }
  await patchStack(group, stackKey, (s) => s.roster.push(...members));
  return members;
}

/**
 * Make ONE pristine body individual.
 * @returns {Promise<object|null>} the new member record, or null if none pristine
 */
export async function materializeMember(group, stackKey, { name = "", extraDelta = {} } = {}) {
  const [member] = await materializeMembers(group, stackKey, 1, { names: [name], extraDelta });
  return member ?? null;
}

/**
 * Record `n` casualties in ONE stack, in one write. Bodies fall in the order
 * that costs the least to lose: pristine ones first (no record), then resting
 * records (→ `dead`), then deployed bodies last (token removed with them).
 * @returns {Promise<number>} casualties actually applied
 */
export async function applyCasualties(group, stackKey, n) {
  if (!isGroup(group) || !(n > 0)) return 0;
  const stack = group.system.stackOf(stackKey);
  if (!stack) return 0;
  const remove = Math.min(Math.floor(n), stack.size.current ?? 0);
  if (remove <= 0) return 0;

  // Pristine bodies absorb the first casualties without leaving a record; only
  // the remainder has to be taken out of the roster.
  const recorded = Math.max(0, remove - group.system.pristineCountOf(stack));
  const resting = (m) => (m.state === GROUP_STATE.materialized ? 0 : 1);
  const fated = [...group.system.livingRecordedOf(stack)]
    .sort((a, b) => resting(a) - resting(b) || byOrdinal(a, b))
    .slice(0, recorded);
  const keys = new Set(fated.map((m) => m.key));
  // Collect the tokens BEFORE the write, which is what clears the link naming them.
  const tokens = fated.map(memberToken).filter(Boolean);

  await patchStack(group, stackKey, (s) => {
    for (const m of s.roster) {
      if (!keys.has(m.key)) continue;
      m.state = GROUP_STATE.dead;
      m.tokenUuid = "";
      m.note = m.note || fellNote();
    }
    s.size.current = Math.max(0, (s.size.current ?? 0) - remove);
  });
  await removeTokens(tokens);
  Hooks.callAll(GROUP_HOOKS.CASUALTY, group, remove, stackKey);
  return remove;
}

/* -------------------------------------------- */
/*  Deploy / recall                              */
/* -------------------------------------------- */

/**
 * The default square the i-th body of a deploy lands on: five abreast from the
 * anchor. A caller with its own shape — a formation laying a stack out at the
 * party's frontage — passes `place` instead.
 */
function defaultPlacer(scene, x, y) {
  const gridStep = scene.grid?.size ?? 100;
  return (i) => ({ x: x + (i % 5) * gridStep, y: y + Math.floor(i / 5) * gridStep });
}

/**
 * Put `count` members of ONE stack onto a scene as unlinked tokens, each
 * carrying its member delta. Resting records go out first, then pristine
 * bodies materialize on the way (they need a record to hold their token link
 * and rolled HP); stranded records are freed first so a stack that took
 * casualties can march again. One creation call and one roster write however
 * many bodies deploy.
 *
 * @param {Actor} group
 * @param {Scene} scene
 * @param {object} [opts]
 * @param {string} [opts.stackKey] which stack (default: the primary one)
 * @param {number} [opts.count] how many bodies to send out
 * @param {number} [opts.x] anchor for the default five-abreast placement
 * @param {number} [opts.y] anchor for the default five-abreast placement
 * @param {(i: number) => {x: number, y: number}} [opts.place] the caller's own
 *   layout, asked once per body in order
 * @returns {Promise<TokenDocument[]>}
 */
export async function deploy(group, scene, { stackKey, count = 1, x = 0, y = 0, place = null } = {}) {
  if (!isGroup(group) || !scene) return [];
  const key = stackKey ?? group.system.primaryStack?.key;
  if (!key) return [];
  await reconcileStrandedMembers(group);
  const base = await ensureBaseActor(group, key);
  if (!base) return [];

  const wanted = Math.max(0, Math.floor(count));
  const stack = group.system.stackOf(key);
  // Resting records first — a body that has already diverged keeps its history
  // rather than a pristine one being spent beside it.
  const going = [...(stack?.roster ?? [])].filter((m) => m.state === GROUP_STATE.materialized).sort(byOrdinal);
  going.length = Math.min(going.length, wanted);
  going.push(...(await materializeMembers(group, key, wanted - going.length)));
  if (!going.length) return [];

  const at = typeof place === "function" ? place : defaultPlacer(scene, x, y);
  const named = group.system.stackOf(key);
  const toCreate = [];
  for (let i = 0; i < going.length; i++) {
    const member = going[i];
    const tokenData = (await base.getTokenDocument(at(i) ?? { x, y })).toObject();
    delete tokenData._id;
    tokenData.actorLink = false;
    tokenData.delta = foundry.utils.deepClone(member.delta ?? {});
    tokenData.name = memberName(named, member);
    foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${GROUP_FLAG}`, group.uuid);
    foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${STACK_FLAG}`, key);
    foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${MEMBER_FLAG}`, member.key);
    toCreate.push(tokenData);
  }

  const created = await scene.createEmbeddedDocuments("Token", toCreate);
  // Creation preserves order, so the i-th token is the i-th body's.
  await patchStack(group, key, (s) => {
    created.forEach((tokenDoc, i) => {
      const record = s.roster.find((m) => m.key === going[i]?.key);
      if (!record || !tokenDoc) return;
      record.state = GROUP_STATE.deployed;
      record.tokenUuid = tokenDoc.uuid;
    });
  });
  if (created.length) Hooks.callAll(GROUP_HOOKS.DEPLOYED, group, created, key);
  return created;
}

/**
 * Fold every deployed member of the group (across all stacks) back into its
 * stack: read the token's delta (minus derived effects), store it on the member,
 * drop the member to a casualty if it came back at ≤0 HP, and delete the token.
 * Reconciles by the group flag so a token orphaned by a crash is still
 * collected; the stack flag routes it back to the right stack's roster.
 *
 * @returns {Promise<{recalled:number, casualties:number}>}
 */
export async function recall(group, { scene = null } = {}) {
  if (!isGroup(group)) return { recalled: 0, casualties: 0 };
  const scenes = scene ? [scene] : [...(game.scenes ?? [])];
  const folds = [];
  const collected = [];

  for (const sc of scenes) {
    for (const token of sc.tokens.filter((t) => t.getFlag(MODULE_ID, GROUP_FLAG) === group.uuid)) {
      folds.push({
        stackKey: token.getFlag(MODULE_ID, STACK_FLAG) ?? group.system.primaryStack?.key,
        memberKey: token.getFlag(MODULE_ID, MEMBER_FLAG),
        delta: cleanDelta(token.delta?.toObject?.() ?? {}),
        fell: fell(token),
      });
      collected.push(token);
    }
  }
  if (!folds.length) return { recalled: 0, casualties: 0 };

  // Stash before destroy: one write folds every body back in, and only then do
  // the tokens come off the canvas.
  const casualties = await foldMembers(group, folds);
  await removeTokens(collected);
  const recalled = folds.length;
  Hooks.callAll(GROUP_HOOKS.RECALLED, group, { recalled, casualties });
  return { recalled, casualties };
}

/* -------------------------------------------- */
/*  Detach / absorb                              */
/* -------------------------------------------- */

/**
 * Promote a member of ONE stack to a standalone actor (snapshot ⊕ delta): the
 * mercenary who becomes a henchman, the kobold who becomes a named villain. The
 * body leaves its stack — `size.current` drops by one and the record is kept as
 * `detached` for provenance, pointing at the new actor.
 *
 * @returns {Promise<Actor|null>}
 */
export async function detach(group, stackKey, memberKey, { folder = null } = {}) {
  const stack = group.system.stackOf(stackKey);
  const member = stack?.roster.find((m) => m.key === memberKey);
  if (!member || member.state === GROUP_STATE.detached) return null;

  const snap = foundry.utils.deepClone(stack.template?.snapshot ?? {});
  if (!snap.type) return null;
  delete snap._id;
  // The member delta overlays the snapshot. `system`/items/name from the delta win.
  const data = foundry.utils.mergeObject(snap, cleanDelta(member.delta), { inplace: false });
  data.name = member.name || memberName(stack, member);
  data.folder = folder ?? null;
  foundry.utils.setProperty(data, "prototypeToken.actorLink", true);

  const actor = await Actor.implementation.create(data);
  if (!actor) return null;
  await patchMember(group, stackKey, memberKey, (m) => {
    m.state = GROUP_STATE.detached;
    m.actorUuid = actor.uuid;
    m.tokenUuid = "";
  });
  await patchStack(group, stackKey, (s) => (s.size.current = Math.max(0, (s.size.current ?? 0) - 1)));
  Hooks.callAll(GROUP_HOOKS.DETACHED, group, actor, member);
  return actor;
}
