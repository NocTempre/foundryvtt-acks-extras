/* global game, Hooks, Actor, CONST, ui, canvas */
/**
 * Set down a pack: a carried container, and everything inside it, leaves a
 * character for a ground pile at their spot.
 *
 * A pile is an `acks-extras.location` actor made a storage provider, carrying
 * `flags.acks-extras.ground` (`GROUND_FLAG`, read through `lib/place.mjs`
 * `isGroundPile`); this file is its one writer. It is a linked token at the
 * character's spot, observable by every seat and reached only by that token,
 * never by ownership. The goods move through the lib storage `stash`, so they
 * are kept at the pile as the character's and weigh nothing on them; nothing
 * here decides whether they are lost.
 *
 * Everything that writes runs on the Judge's seat: a Player lacks the rights to
 * create an actor or a token and to delete an actor. `setDown` hands the
 * request to that seat (`GROUND_HANDLER`), which authorizes on the user who
 * sent it. Three hooks finish the lifecycle: a pile is deleted once its last
 * item is gone, its tokens go with it, and a container that lands back on its
 * owner is returned to the slot it was set down from.
 * See docs/location/MODEL.md, "On the ground".
 */
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE } from "./constants.mjs";
import { makeLoc, isPrimaryGM } from "../lib/util.mjs";
import { GROUND_FLAG, isGroundPile } from "../lib/place.mjs";
import { isContainer, containedIn, isEquippable, isWorn, setEquipped, wearAt, wornSlotOf } from "../lib/item-model.mjs";
import { coinOrderOf } from "../lib/money-logic.mjs";
import { setCoinOrder } from "../lib/money.mjs";
import { isProvider, resolveActorSync, stash, STORAGE_KEY } from "../lib/storage.mjs";
import { executeAsGM, judgeDeclares, registerHandler } from "../lib/sockets.mjs";
import { tokenCorner } from "../lib/token-centre.mjs";
import { standingSpots } from "./reach.mjs";
import { locationOfScene } from "./scene-link.mjs";
import { SET_DOWN_REFUSALS, pickSpot, planArrival, planSetDown, pileIsEmpty } from "./ground-logic.mjs";

const loc = makeLoc(LANG_PREFIX);

/** The socket handler that makes a set-down on the Judge's seat. */
export const GROUND_HANDLER = "locationGroundSetDown";

/** The flag, under `flags.acks-extras` on a container, that remembers where it came from. */
export const SET_DOWN_FLAG = "setDown";

/** How long a deleted item waits before its pile is looked at again. */
const SWEEP_DELAY_MS = 150;

/**
 * A pile's ownership: every seat may open and read it, nobody owns it. Owned by
 * default, a pile would take deposits from anywhere and from companions
 * (`reach.mjs`); observed, it is reached by its own token alone. Explicit,
 * because a new location is otherwise made owned by everyone.
 */
export const groundOwnership = () => ({ default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER });

/**
 * The creation data of a pile: the one definition of its shape, used by the
 * handler and by anything that must stand a pile up the way the handler does.
 * @param {object} opts
 * @param {{ownerUuid: string, ownerName: string, containerName: string, building?: boolean}} opts.flag
 * @param {string} [opts.img] the container's picture
 * @param {string} [opts.parentUuid] the place the pile lies in; empty for none
 */
export function pileData({ flag, img, parentUuid = "" }) {
  return {
    name: loc("ground.name", { name: flag.containerName }),
    type: LOCATION_TYPE,
    ...(img ? { img } : {}),
    ownership: groundOwnership(),
    system: { parentUuid },
    flags: { [MODULE_ID]: { [STORAGE_KEY]: { provider: true }, [GROUND_FLAG]: flag } },
  };
}

/* -------------------------------------------- */
/*  Setting down (the Judge's seat)              */
/* -------------------------------------------- */

/** The tokens of this pile on every scene. */
function tokensOf(pile) {
  const out = [];
  for (const scene of game.scenes ?? []) {
    for (const token of scene.tokens?.filter?.((t) => t.actorId === pile.id) ?? []) out.push({ scene, token });
  }
  return out;
}

/** Delete every token of a pile, scene by scene. */
async function removePileTokens(pile) {
  const byScene = new Map();
  for (const { scene, token } of tokensOf(pile)) byScene.set(scene, [...(byScene.get(scene) ?? []), token.id]);
  for (const [scene, ids] of byScene) await scene.deleteEmbeddedDocuments("Token", ids);
}

/** The linked token of a pile, centred on a spot at its elevation. */
async function placePileToken(pile, spot) {
  const doc = await pile.getTokenDocument({ hidden: false, actorLink: true, elevation: spot.elevation ?? 0 });
  const data = doc.toObject();
  delete data._id;
  Object.assign(data, tokenCorner(spot.point, doc, spot.scene));
  const [token] = (await spot.scene.createEmbeddedDocuments("Token", [data])) ?? [];
  return token ?? null;
}

/**
 * Undo a set-down that did not complete: the token, then the pile, then the
 * record on the character's own container. A pile that holds goods the move
 * left on the character as well (`duplicated`) is kept, so that deleting it
 * does not hand a third copy back.
 */
async function unwind({ pile, item, keepPile = false }) {
  try {
    if (item && !item.isDeleted && item.getFlag?.(MODULE_ID, SET_DOWN_FLAG)) await item.unsetFlag(MODULE_ID, SET_DOWN_FLAG);
  } catch (err) {
    console.error(`${MODULE_ID} | set-down could not clear the container's record`, err);
  }
  if (!pile) return;
  try {
    if (keepPile) {
      await pile.update({ [`flags.${MODULE_ID}.${GROUND_FLAG}.building`]: false });
      return;
    }
    await removePileTokens(pile);
    await pile.delete();
  } catch (err) {
    console.error(`${MODULE_ID} | set-down could not remove its pile`, err);
  }
}

/**
 * The Judge's half of a set-down. Authorizes on `requestUserId`, the user the
 * transport attests (null for a Judge): a Player must own the character.
 * Answers `{ok, reason?, pileUuid?, warn?}`; the asking seat says it.
 * @param {{actorUuid: string, itemId: string, sceneId?: string|null, requestUserId?: string|null}} request
 */
export async function setDownRelay({ actorUuid, itemId, sceneId = null, requestUserId = null } = {}) {
  const actor = resolveActorSync(actorUuid);
  if (!actor) return { ok: false, reason: "missing" };
  const sender = requestUserId ? game.users?.get(requestUserId) : null;
  const judge = judgeDeclares(requestUserId);
  const item = actor.items?.get(itemId) ?? null;

  const spot = pickSpot(standingSpots(actor), sceneId);
  const plan = planSetDown({
    seat: { judge, ownsCharacter: !!sender && !!actor.testUserPermission?.(sender, "OWNER") },
    actor: { uuid: actor.uuid, name: actor.name, isToken: !!actor.isToken },
    item: item && {
      id: item.id,
      name: item.name,
      isContainer: isContainer(item),
      nested: !!containedIn(item),
      worn: isWorn(item),
      slot: wornSlotOf(item),
    },
    hasSpot: !!spot,
  });
  if (!plan.ok) return { ok: false, reason: plan.reason };

  let pile = null;
  let landed = false;
  try {
    const scene = spot?.scene ?? (sceneId ? game.scenes?.get(sceneId) : null);
    pile = await Actor.create(pileData({ flag: plan.flag, img: item.img, parentUuid: locationOfScene(scene)?.uuid ?? "" }));
    if (!pile) return { ok: false, reason: "failed" };
    if (spot && !(await placePileToken(pile, spot))) {
      await unwind({ pile });
      return { ok: false, reason: "failed" };
    }

    // The record rides through the transfer on the container's own flags.
    await item.setFlag(MODULE_ID, SET_DOWN_FLAG, plan.record);
    const moved = await stash(actor, pile, [{ id: item.id }], { quiet: true, userId: requestUserId });
    if (!moved.ok) {
      await unwind({ pile, item, keepPile: moved.reason === "duplicated" });
      return { ok: false, reason: moved.reason === "duplicated" ? "duplicated" : "failed" };
    }
    landed = true;
    // Built: from here the pile is deleted when its last item goes.
    await pile.update({ [`flags.${MODULE_ID}.${GROUND_FLAG}.building`]: false });
  } catch (err) {
    console.error(`${MODULE_ID} | set down failed`, err);
    // Once the goods have landed the pile is theirs: deleting it would hand
    // them back through the storage cleanup. It is kept still marked building,
    // which no hook deletes.
    if (!landed) {
      await unwind({ pile, item });
      return { ok: false, reason: "failed" };
    }
  }
  return { ok: true, pileUuid: pile.uuid, ...(plan.tokenless ? { warn: "noTokenJudge" } : {}) };
}

/* -------------------------------------------- */
/*  Setting down (the asking seat)               */
/* -------------------------------------------- */

/** The notice each refusal is said with, as a lang key. */
const REFUSAL_KEYS = Object.freeze({
  [SET_DOWN_REFUSALS.permission]: "ACKS-LIB.storage.notOwner",
  [SET_DOWN_REFUSALS.token]: "ACKS-LIB.storage.tokenActor",
  [SET_DOWN_REFUSALS.notContainer]: `${LANG_PREFIX}.ground.notContainer`,
  [SET_DOWN_REFUSALS.notOnMap]: `${LANG_PREFIX}.ground.notOnMap`,
  duplicated: "ACKS-LIB.storage.duplicated",
});

/**
 * Say an answer on the seat that asked. The transport has already said
 * `noGm`; any other refusal without a line of its own is the generic one.
 */
function speak(answer, { name }) {
  if (answer.ok) {
    ui.notifications?.info(loc("ground.setDown", { name }));
    if (answer.warn === "noTokenJudge") ui.notifications?.warn(loc("ground.noTokenJudge"));
    return;
  }
  if (answer.reason === "noGm") return;
  // Storage says a duplicated move on the seat that wrote it, which is this
  // one when a Judge sets down; a Player's seat hears it here, naming the pile.
  if (answer.reason === "duplicated") {
    if (!game.user?.isGM) ui.notifications?.error(game.i18n.format(REFUSAL_KEYS.duplicated, { name: loc("ground.name", { name }) }));
    return;
  }
  const key = REFUSAL_KEYS[answer.reason] ?? `${LANG_PREFIX}.ground.failed`;
  ui.notifications?.warn(game.i18n.format(key, { name }));
}

/**
 * Set a carried container, and everything inside it, down on the ground at the
 * character's spot. The Judge's seat makes it; this seat says how it went.
 * @param {Actor} actor the character
 * @param {Item} item the container
 * @returns {Promise<{ok: boolean, reason?: string, pileUuid?: string, warn?: string}>}
 */
export async function setDown(actor, item) {
  if (!actor || !item) return { ok: false, reason: "missing" };
  const request = { actorUuid: actor.uuid, itemId: item.id, sceneId: canvas?.scene?.id ?? null };
  const answer = (await executeAsGM(GROUND_HANDLER, request)) ?? { ok: false, reason: "noGm" };
  speak(answer, item);
  return answer;
}

/* -------------------------------------------- */
/*  Hooks                                        */
/* -------------------------------------------- */

/**
 * Does this window do the pile's writing? Only a Judge's: one window of the
 * active Judge's seat, so a hook every window hears acts once. A Player's seat
 * never writes or deletes a pile.
 */
const writesHere = () => game.system?.id === "acks" && !!game.user?.isGM && isPrimaryGM();

/** Piles waiting out their delay, by pile id. */
const pending = new Map();

/**
 * Delete a pile that holds nothing: its tokens first, then the actor. The pile
 * is read again here, because a batch delete fires its hook once per item and
 * the answer at the first may no longer be true. A pile still `building` is
 * never deleted: the transfer's own compensation empties it.
 * @returns {Promise<boolean>} whether the pile was deleted
 */
export async function sweepPile(pile) {
  const live = game.actors?.get(pile?.id) ?? null;
  if (!live || !isGroundPile(live)) return false;
  const building = !!live.getFlag(MODULE_ID, GROUND_FLAG)?.building;
  if (!pileIsEmpty({ count: live.items.size, building })) return false;
  await removePileTokens(live);
  await live.delete();
  return true;
}

/** One delayed sweep per pile, however many of its items a batch deletes. */
function scheduleSweep(pile, delay) {
  clearTimeout(pending.get(pile.id)?.timer);
  const run = () => {
    pending.delete(pile.id);
    return sweepPile(pile).catch((err) => console.error(`${MODULE_ID} | ground pile sweep failed`, err));
  };
  pending.set(pile.id, { run, timer: setTimeout(run, delay) });
}

/** Run every waiting sweep now. For a caller that must see the outcome of a delete. */
export async function flushSweeps() {
  const waiting = [...pending.values()];
  for (const { timer } of waiting) clearTimeout(timer);
  await Promise.all(waiting.map(({ run }) => run()));
}

/** An item left a pile: look at the pile again after the delay. */
export function onDeleteItem(item, _options, _userId, { delay = SWEEP_DELAY_MS } = {}) {
  const pile = item?.parent;
  if (!isGroundPile(pile) || !writesHere()) return;
  if (pile.getFlag(MODULE_ID, GROUND_FLAG)?.building) return;
  scheduleSweep(pile, delay);
}

/** A pile was deleted by a hand: its tokens are no use without it. */
export async function onDeleteActor(actor) {
  if (!isGroundPile(actor) || !writesHere()) return;
  try {
    await removePileTokens(actor);
  } catch (err) {
    console.error(`${MODULE_ID} | ground pile tokens were not removed`, err);
  }
}

/**
 * A container carrying a set-down record landed on an actor (`planArrival`):
 * on its owner it goes back to the slot it came from and a coin order that
 * named it is pointed at it again; anywhere else on a character it is taken
 * off; the record is cleared once it is spent.
 * Landing at a place leaves the record alone.
 */
export async function onCreateItem(item) {
  const record = item?.getFlag?.(MODULE_ID, SET_DOWN_FLAG);
  if (!record || item.parent?.documentName !== "Actor" || !writesHere()) return;
  const parent = item.parent;
  try {
    const plan = planArrival({
      record,
      parent: { uuid: parent.uuid, isProvider: isProvider(parent) },
      itemId: item.id,
      equippable: isEquippable(item),
      nested: !!containedIn(item),
      coinOrder: coinOrderOf(parent),
    });
    if (plan.wear?.slot) await wearAt(item, plan.wear.slot);
    else if (plan.wear?.equip) await setEquipped(item, true);
    else if (plan.unwear) await wearAt(item, null);
    if (plan.coinOrder) await setCoinOrder(parent, plan.coinOrder);
    if (plan.clear) await item.unsetFlag(MODULE_ID, SET_DOWN_FLAG);
  } catch (err) {
    console.error(`${MODULE_ID} | set-down arrival failed for "${item?.name}"`, err);
  }
}

/** Register the Judge's handler and the three hooks, once, at init. */
export function registerGround() {
  registerHandler(GROUND_HANDLER, setDownRelay);
  Hooks.on("createItem", onCreateItem);
  Hooks.on("deleteItem", (item, options, userId) => onDeleteItem(item, options, userId));
  Hooks.on("deleteActor", onDeleteActor);
}
