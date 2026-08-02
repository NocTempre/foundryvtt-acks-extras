/* global game, foundry, Actor, Roll, Hooks, CONST, fromUuid */
/**
 * Group operations — the lifecycle of a stacked actor (see data/group-data.mjs).
 *
 * A group holds a LIST of stacks; every operation here addresses ONE stack by
 * its key (a mixed unit of 10 swordsmen + 10 spearmen is two stacks, deployed
 * and depleted independently). Each stack holds a SPARSE roster: a record per
 * body that has diverged, and nothing for pristine bodies. These functions move
 * a stack's members through that lifecycle while keeping the one invariant true
 * at every step — a stack's `size.current` (living bodies) is never less than
 * the number of its living records.
 *
 * DEPLOY/RECALL is the compatibility strategy. Deploying spawns unlinked tokens
 * of a stack's prototype with each member's ActorDelta pre-applied, so on the
 * canvas a member is an ordinary token over an ordinary actor and every
 * system/module that reads an actor reads it unchanged. Recalling folds
 * `token.delta` back into the member record and removes the token.
 *
 * These operations write world documents (tokens, actors) and so run on the
 * calling client under Foundry's own permission checks — a GM, or an owner with
 * token-create rights on the scene. They are defensive (try/caught, half-steps
 * persisted before destructive ones) but they do not route over a socket; a
 * consumer that needs GM-routed writes wraps them.
 */
import { MODULE_ID } from "./constants.mjs";
import GroupData, { GROUP_CATEGORY, GROUP_STATE } from "./data/group-data.mjs";
import { cleanDelta, isDerivedEffect, memberName, nextOrdinal, sizeFromEcology } from "./group-logic.mjs";

// Re-export the Foundry-free lifecycle logic so consumers reach it all through
// `acksLib.groups`, while the pure half stays independently Node-importable.
export { cleanDelta, isDerivedEffect, memberName, nextOrdinal, sizeFromEcology, GROUP_CATEGORY };

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
export const isGroup = (actor) => actor?.system instanceof GroupData || actor?.type === `${MODULE_ID}.group`;

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
 * Ensure a STACK has a WORLD actor to be the ActorDelta base. ActorDelta merges
 * onto a real world actor; a compendium uuid cannot be that base. If the stack's
 * prototype points at a world actor already, that is used; otherwise one is
 * minted from the snapshot (hidden, owned by nobody) and remembered on the stack.
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
 * Turn a pristine body of ONE stack into a roster record — the transition that
 * first makes a member individual. Rolls its HP (a body is only worth its own
 * hit points once it matters) and stores it in the member's delta. Does NOT
 * change `size.current` (the body already existed; it just gained a record).
 *
 * @returns {Promise<object|null>} the new member record, or null if none pristine
 */
export async function materializeMember(group, stackKey, { name = "", extraDelta = {} } = {}) {
  if (!isGroup(group)) return null;
  const stack = group.system.stackOf(stackKey);
  if (!stack || group.system.pristineCountOf(stack) <= 0) return null;
  const hp = await rollBodyHp(stack);
  const member = {
    key: foundry.utils.randomID(),
    ordinal: nextOrdinal(stack),
    name,
    delta: foundry.utils.mergeObject({ system: { hp: { value: hp, max: hp } } }, extraDelta, { inplace: false }),
    state: GROUP_STATE.materialized,
    tokenUuid: "",
    actorUuid: "",
    note: "",
  };
  await patchStack(group, stackKey, (s) => s.roster.push(member));
  return member;
}

/**
 * Record `n` casualties in ONE stack. Pristine bodies fall FIRST — they leave no
 * record, so the stack simply shrinks — and only once the pristine are spent
 * does a living record become a `dead` one (kept for the report). The stack's
 * `size.current` drops by the number actually removed.
 *
 * @returns {Promise<number>} casualties actually applied
 */
export async function applyCasualties(group, stackKey, n) {
  if (!isGroup(group) || !(n > 0)) return 0;
  const stack = group.system.stackOf(stackKey);
  if (!stack) return 0;
  const remove = Math.min(n, stack.size.current ?? 0);
  if (remove <= 0) return 0;

  const pristine = group.system.pristineCountOf(stack);
  let left = remove - Math.min(remove, pristine); // what remains after pristine fall

  await patchStack(group, stackKey, (s) => {
    if (left > 0) {
      const living = s.roster
        .filter((m) => m.state === GROUP_STATE.materialized || m.state === GROUP_STATE.deployed)
        .sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0));
      for (const m of living.slice(0, left)) {
        m.state = GROUP_STATE.dead;
        m.note = m.note || game?.i18n?.localize?.("ACKS-LIB.group.fellInBattle") || "fell in battle";
      }
    }
    s.size.current = Math.max(0, (s.size.current ?? 0) - remove);
  });
  Hooks.callAll(GROUP_HOOKS.CASUALTY, group, remove, stackKey);
  return remove;
}

/* -------------------------------------------- */
/*  Deploy / recall                              */
/* -------------------------------------------- */

/**
 * Put `count` members of ONE stack onto a scene as unlinked tokens, each
 * carrying its member delta. Pristine bodies materialize on the way out (they
 * need a record to hold their token link and rolled HP). Members already
 * deployed are skipped.
 *
 * @param {Actor} group
 * @param {Scene} scene
 * @param {object} [opts] - { stackKey, count, x, y }
 * @returns {Promise<TokenDocument[]>}
 */
export async function deploy(group, scene, { stackKey, count = 1, x = 0, y = 0 } = {}) {
  if (!isGroup(group) || !scene) return [];
  const key = stackKey ?? group.system.primaryStack?.key;
  if (!key) return [];
  const base = await ensureBaseActor(group, key);
  if (!base) return [];

  const created = [];
  const gridStep = scene.grid?.size ?? 100;
  for (let i = 0; i < count; i++) {
    // Prefer an already-materialized-but-resting member of this stack; else make
    // a pristine body into one. Nothing left → stop.
    const stack = group.system.stackOf(key);
    let member =
      stack?.roster.find((m) => m.state === GROUP_STATE.materialized) ?? (await materializeMember(group, key));
    if (!member) break;

    const tokenData = (await base.getTokenDocument({ x: x + (i % 5) * gridStep, y: y + Math.floor(i / 5) * gridStep })).toObject();
    delete tokenData._id;
    tokenData.actorLink = false;
    tokenData.delta = foundry.utils.deepClone(member.delta ?? {});
    tokenData.name = memberName(group.system.stackOf(key), member);
    foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${GROUP_FLAG}`, group.uuid);
    foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${STACK_FLAG}`, key);
    foundry.utils.setProperty(tokenData, `flags.${MODULE_ID}.${MEMBER_FLAG}`, member.key);

    // Create the token, then record it (we need its id). A crash between leaves
    // an orphan token that recall's reconciliation (by flag) still finds.
    const [tokenDoc] = await scene.createEmbeddedDocuments("Token", [tokenData]);
    if (!tokenDoc) continue;
    await patchMember(group, key, member.key, (m) => {
      m.state = GROUP_STATE.deployed;
      m.tokenUuid = tokenDoc.uuid;
    });
    created.push(tokenDoc);
  }
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
  let recalled = 0;
  const perStackDead = {}; // stackKey → count, to shrink each stack once at the end

  for (const sc of scenes) {
    const tokens = sc.tokens.filter((t) => t.getFlag(MODULE_ID, GROUP_FLAG) === group.uuid);
    for (const token of tokens) {
      const stackKey = token.getFlag(MODULE_ID, STACK_FLAG) ?? group.system.primaryStack?.key;
      const key = token.getFlag(MODULE_ID, MEMBER_FLAG);
      const delta = cleanDelta(token.delta?.toObject?.() ?? {});
      const hp = token.actor?.system?.hp?.value;
      const fell = typeof hp === "number" && hp <= 0;

      await patchMember(group, stackKey, key, (m) => {
        m.delta = delta;
        m.tokenUuid = "";
        if (fell) {
          m.state = GROUP_STATE.dead;
          m.note = m.note || game?.i18n?.localize?.("ACKS-LIB.group.fellInBattle") || "fell in battle";
        } else {
          m.state = GROUP_STATE.materialized;
        }
      });
      await sc.deleteEmbeddedDocuments("Token", [token.id]);
      recalled++;
      if (fell) perStackDead[stackKey] = (perStackDead[stackKey] ?? 0) + 1;
    }
  }
  // A member marked dead on recall is no longer a living body of its stack.
  let casualties = 0;
  for (const [stackKey, dead] of Object.entries(perStackDead)) {
    casualties += dead;
    await patchStack(group, stackKey, (s) => (s.size.current = Math.max(0, (s.size.current ?? 0) - dead)));
  }
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

// sizeFromEcology lives in group-logic.mjs (Foundry-free) and is re-exported at
// the top of this file — the ecology runway is pure enough to unit-test offline.
