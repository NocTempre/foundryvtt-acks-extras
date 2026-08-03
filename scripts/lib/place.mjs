/* global game, foundry, Hooks, ui, Actor, fromUuidSync */
/**
 * PLACES — nesting, occupancy and stacking over the storage primitive.
 *
 * storage.mjs answered "whose goods are these and where are they kept". This
 * answers the three questions a *place* has that a bare provider does not: what
 * is it inside of, what living thing is in it, and how many of it are there.
 * The rules live in place-logic.mjs (Foundry-free, unit-tested); this file is
 * the document reads and writes around them.
 *
 * THREE DOCUMENTS REDUCE TO ONE SHAPE.
 *
 *   - an `acks-extras.location` actor — the full article: market, roster,
 *     children, storage;
 *   - any other actor flagged a storage provider — a wagon, a pack mule, a
 *     hireling with a strongbox;
 *   - an equipment CONTAINER ITEM — the trivial article, and the one that keeps
 *     the model honest: a chest is a place with no market, no occupants and one
 *     level of nesting.
 *
 * `nodeOf` performs that reduction and nothing downstream knows the difference.
 *
 * WHERE THE PARENT POINTER LIVES, AND WHY IT IS THREE PLACES. A location actor
 * carries `system.parentUuid`, because it is ours and a schema field is
 * validated, migratable and visible in the sheet's own form. A foreign provider
 * carries `flags.acks-extras.place.parentUuid`, because we do not own its
 * schema. A container item carries NOTHING — its parent is *derived* from the
 * carrier it is embedded on and acks-equipment's own `containedIn` pointer,
 * because that module already owns the fact and a second copy would drift the
 * first time somebody moved a sack into a backpack. One fact, one owner, three
 * readers.
 *
 * COST. `allPlaces()` is a single pass over `game.actors` — cheap at world
 * scale, but a scan, so call it once per render and share the result. Container
 * items are deliberately NOT enumerated world-wide (that would be O(actors x
 * items) on every breadcrumb); they are resolved only as the children of the
 * place actually being looked at.
 */
import { MODULE_ID } from "./constants.mjs";
import { holdsGear } from "./item-model.mjs";
import { isProvider, storedItems, storageFlagOf, STORAGE_KEY } from "./storage.mjs";
import {
  LIB_ID,
  OCCUPANT_KIND,
  PLACE_KEY,
  PLACE_KIND,
  ancestorUuids,
  childrenOf,
  depthOf,
  descendantUuids,
  groupOccupants,
  headcount,
  indexPlaces,
  isStacked,
  mergeOccupants,
  placePath,
  planReparent,
  planSplit,
  rollup,
  stackMemberName,
  visibleOccupants,
  wouldCycle,
} from "./place-logic.mjs";

// Re-export the Foundry-free half so consumers reach it all through
// `acksLib.places`, while the pure half stays independently Node-importable.
export {
  LIB_ID,
  OCCUPANT_KIND,
  PLACE_KEY,
  PLACE_KIND,
  ancestorUuids,
  childrenOf,
  depthOf,
  descendantUuids,
  groupOccupants,
  headcount,
  indexPlaces,
  isStacked,
  mergeOccupants,
  placePath,
  planReparent,
  planSplit,
  rollup,
  stackMemberName,
  visibleOccupants,
  wouldCycle,
};

/** Hooks other modules key off. Namespaced per the family convention. */
export const PLACE_HOOKS = Object.freeze({
  REPARENTED: "acksLibPlaceReparented",
  OCCUPANT_ADDED: "acksLibPlaceOccupantAdded",
  OCCUPANT_REMOVED: "acksLibPlaceOccupantRemoved",
  SPLIT: "acksLibPlaceSplit",
});

/** The location actor sub-type. Named here, not imported, to keep lib edge-free. */
const LOCATION_TYPE = `${MODULE_ID}.location`;

/** acks-equipment's container vocabulary — read generically, never imported. */
const CONTAINER_FLAG = "container";
const CONTAINED_IN = "containedIn";

/* -------------------------------------------- */
/*  Recognising places                           */
/* -------------------------------------------- */

/** Is this actor our location sub-type? */
export const isLocation = (doc) => doc?.documentName === "Actor" && doc?.type === LOCATION_TYPE;

/**
 * Is this item something gear can go inside?
 *
 * Either ground: a declared capacity — which any gear may have, a coat with
 * hidden pockets as much as a sack — or a container state record for one a
 * Judge made by hand and gave a lock but no stated size. Reading only the
 * record made a place out of the second and not the first.
 */
export const isContainerItem = (doc) =>
  doc?.documentName === "Item" && (holdsGear(doc) || !!doc?.getFlag?.(MODULE_ID, CONTAINER_FLAG));

/** Any document that can hold things: a location, a provider actor, a container. */
export const isPlace = (doc) => isLocation(doc) || isContainerItem(doc) || isProvider(doc);

/** Which of the three a document is, or null when it is not a place at all. */
export function kindOf(doc) {
  if (isLocation(doc)) return PLACE_KIND.LOCATION;
  if (isContainerItem(doc)) return PLACE_KIND.CONTAINER;
  if (isProvider(doc)) return PLACE_KIND.PROVIDER;
  return null;
}

/* -------------------------------------------- */
/*  The reduction                                */
/* -------------------------------------------- */

/**
 * A container item's parent: the container it is nested in, else the actor
 * carrying it. Both are real uuids, so a chest inside a wagon and a chest in a
 * town read identically upstream.
 */
function containerParentUuid(item) {
  const nested = item.getFlag?.(MODULE_ID, CONTAINED_IN);
  if (nested) {
    const sibling = item.parent?.items?.get?.(nested);
    if (sibling) return sibling.uuid;
  }
  // Goods stashed at a place are stamped with whose they are, but they LIVE at
  // the provider — so the carrier is the parent either way.
  return item.parent?.uuid ?? null;
}

/** The parent uuid of any place, read from wherever that place keeps it. */
export function parentUuidOf(doc) {
  if (!doc) return null;
  if (isContainerItem(doc)) return containerParentUuid(doc);
  // A location's own schema field, with the foreign-provider flag as the
  // fallback — so an actor that is BOTH (a location someone also flagged) has
  // one answer, and it is the schema's.
  return doc.system?.parentUuid || doc.getFlag?.(MODULE_ID, PLACE_KEY)?.parentUuid || null;
}

/** How many identical instances this place represents. Always at least 1. */
export function countOf(doc) {
  const raw = doc?.system?.stack?.count ?? doc?.getFlag?.(MODULE_ID, PLACE_KEY)?.count ?? 1;
  const n = Math.floor(Number(raw) || 1);
  return n > 0 ? n : 1;
}

/** Reduce a document to the normalised node the pure rules operate on. */
export function nodeOf(doc) {
  if (!doc) return null;
  const kind = kindOf(doc);
  if (!kind) return null;
  return {
    uuid: doc.uuid,
    parentUuid: parentUuidOf(doc),
    name: doc.name ?? "",
    img: doc.img ?? null,
    kind,
    count: countOf(doc),
  };
}

/**
 * Every ACTOR-backed place in the world, as nodes.
 *
 * Container items are excluded on purpose (see the header): they are resolved as
 * the children of the place being viewed, not enumerated globally. That keeps
 * this a single `game.actors` pass, which is what makes it safe to call on every
 * sheet render.
 */
export function allPlaces() {
  return (game.actors?.contents ?? []).filter((a) => isLocation(a) || isProvider(a)).map(nodeOf).filter(Boolean);
}

/** uuid → node over every actor-backed place. Share one per render. */
export const placeIndex = () => indexPlaces(allPlaces());

/**
 * Resolve a place uuid without awaiting — render paths cannot. Handles the
 * embedded-item case (`Actor.x.Item.y`) that storage's actor-only resolver does
 * not, since a container item is a place.
 */
export function resolvePlaceSync(uuid) {
  if (typeof uuid !== "string") return null;
  try {
    const doc = fromUuidSync(uuid);
    return isPlace(doc) ? doc : null;
  } catch {
    // A uuid pointing into an unloaded compendium throws rather than returning
    // null; a place we cannot see is the same as no place for every caller here.
    return null;
  }
}

/* -------------------------------------------- */
/*  Children                                     */
/* -------------------------------------------- */

/**
 * The places directly inside this one: sub-locations and provider actors that
 * point at it, plus the container items it physically holds.
 *
 * The two halves come from different sources and that is inherent — a child
 * LOCATION is a separate document that names its parent, a child CONTAINER is an
 * embedded item on this very actor. `nodeOf` flattens the difference away.
 */
export function childPlaces(doc, nodes = null) {
  if (!doc) return [];
  const actorChildren = childrenOf(doc.uuid, nodes ?? allPlaces());
  // A container item is only a child of the actor carrying it; items cannot
  // carry items, so a container's own children are its nested containers.
  const items = doc.documentName === "Actor" ? (doc.items?.contents ?? []) : (doc.parent?.items?.contents ?? []);
  const containerChildren = items
    .filter((i) => isContainerItem(i) && containerParentUuid(i) === doc.uuid)
    .map(nodeOf)
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
  return [...actorChildren, ...containerChildren];
}

/* -------------------------------------------- */
/*  Contents                                     */
/* -------------------------------------------- */

/**
 * The items held at a place — the call that makes a chest and a town the same
 * kind of thing.
 *
 * The two backings genuinely differ and cannot be papered over at the document
 * level: an actor-place holds REAL EMBEDDED ITEMS stamped with whose they are
 * (storage.mjs), while a container item holds SIBLING items on the same carrier
 * pointed at it by acks-equipment's `containedIn`. Foundry has no embedded
 * items on items, so there was never a choice about that. What there IS a choice
 * about is whether every caller has to know — and they do not, because this
 * resolves both to a list of Items.
 *
 * Attribution differs with the backing and that is honest rather than papered
 * over: goods at a town are somebody's (`ownerUuid`), goods in your own backpack
 * are yours by virtue of the backpack being yours.
 */
export function contentsOf(doc) {
  if (!doc) return [];
  if (isContainerItem(doc)) {
    const id = doc.id;
    return (doc.parent?.items?.contents ?? []).filter((i) => i.getFlag?.(MODULE_ID, CONTAINED_IN) === id);
  }
  return storedItems(doc);
}

/**
 * Everything at a place, as uniform rows: the sub-places, then the items.
 *
 * Sub-places come first because that is the order a person reads a place in —
 * "the inn has a cellar and a strongroom, and behind the bar there are three
 * casks". A row carries `isPlace` so the sheet can make one drillable and the
 * other draggable without a second pass.
 */
export function contentRows(doc, nodes = null) {
  const places = childPlaces(doc, nodes).map((node) => ({
    ...node,
    isPlace: true,
    stacked: isStacked(node),
  }));
  // A container stashed at a location is BOTH stored goods and a child place.
  // It is listed once, as the place — the drillable row is strictly the more
  // useful of the two, and a row that appeared twice would let a GM retrieve a
  // chest from under its own contents.
  const asPlaces = new Set(places.map((p) => p.uuid));
  const items = contentsOf(doc)
    .filter((item) => !asPlaces.has(item.uuid))
    .map((item) => ({
      uuid: item.uuid,
      id: item.id,
      name: item.name,
      img: item.img,
      kind: item.type,
      isPlace: false,
      ownerUuid: storageFlagOf(item)?.ownerUuid ?? null,
      ownerName: storageFlagOf(item)?.ownerName ?? "",
    }));
  return [...places, ...items];
}

/* -------------------------------------------- */
/*  Re-parenting                                 */
/* -------------------------------------------- */

/**
 * Put a place inside another one (or at the root, with a null parent).
 *
 * Refuses cycles — the one invariant of the model (place-logic.mjs). Container
 * items are refused outright: their parent is derived from where they physically
 * are, so "re-parenting" one means MOVING it, which is storage's job and has
 * entirely different semantics (goods, weight, attribution).
 *
 * @returns {Promise<boolean>} whether anything was written
 */
export async function setParent(doc, parentUuid) {
  if (!doc) return false;
  if (isContainerItem(doc)) {
    warn("place.containerMove");
    return false;
  }
  if (!doc.isOwner) {
    warn("place.notOwner");
    return false;
  }
  const plan = planReparent(doc.uuid, parentUuid || null, placeIndex());
  if (!plan.ok) {
    if (plan.reason === "cycle") warn("place.cycle");
    return false;
  }
  const next = parentUuid || null;
  if (isLocation(doc)) await doc.update({ "system.parentUuid": next ?? "" });
  else await doc.setFlag(MODULE_ID, PLACE_KEY, { ...(doc.getFlag(MODULE_ID, PLACE_KEY) ?? {}), parentUuid: next ?? "" });
  Hooks.callAll(PLACE_HOOKS.REPARENTED, { uuid: doc.uuid, parentUuid: next });
  return true;
}

/* -------------------------------------------- */
/*  Occupancy                                    */
/* -------------------------------------------- */

/**
 * What kind of occupant an actor is, for display bucketing. Reads the registered
 * type and the core retainer flag — never a name or a guess.
 */
export function occupantKindOf(actor) {
  if (!actor) return OCCUPANT_KIND.ACTOR;
  if (actor.type === `${MODULE_ID}.group`) return OCCUPANT_KIND.GROUP;
  if (actor.system?.retainer?.enabled) return OCCUPANT_KIND.HENCHMAN;
  if (actor.type === "monster") return OCCUPANT_KIND.MONSTER;
  return OCCUPANT_KIND.ACTOR;
}

/** One stored roster row from a live actor. Denormalised so it survives deletion. */
export function occupantRow(actor, { ownerUuid = "", quantity = null, notes = "", hidden = false } = {}) {
  return {
    uuid: actor.uuid,
    name: actor.name ?? "",
    img: actor.img ?? "",
    kind: occupantKindOf(actor),
    // A group's headcount IS its quantity — a platoon billeted here is 30
    // people, and a roster that said 1 would mislead every capacity decision.
    quantity: quantity ?? (actor.type === `${MODULE_ID}.group` ? groupHeadcount(actor) : 1),
    ownerUuid,
    notes,
    hidden,
  };
}

/** Living bodies in a group actor, or 1 for anything else. */
function groupHeadcount(actor) {
  const stacks = actor?.system?.stacks ?? [];
  const total = stacks.reduce((sum, s) => sum + (Number(s?.size?.current) || 0), 0);
  return total > 0 ? total : 1;
}

/**
 * The tokens standing on a place's linked scene, as DERIVED occupant rows.
 *
 * Only linked tokens and tokens over world actors produce a row: a synthetic
 * actor's uuid dies with its token, so a row built from one would be a dead
 * reference the moment the GM cleaned up the map — the same reasoning that makes
 * storage refuse token actors as transfer endpoints.
 */
export function sceneOccupants(scene) {
  if (!scene) return [];
  const rows = [];
  const seen = new Set();
  for (const token of scene.tokens ?? []) {
    const actor = token.actor;
    if (!actor || actor.isToken) continue; // unlinked: uuid dies with the token
    if (seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    rows.push(occupantRow(actor));
  }
  return rows;
}

/**
 * The roster a sheet renders: stored rows, plus the linked scene's tokens, then
 * filtered to what this viewer may see. One call, because getting the ORDER of
 * those three steps wrong is how a hidden row leaks (filter last) or a stored
 * row loses its notes to a derived duplicate (merge before filter).
 */
export function rosterFor(doc, { scene = null, isGM = false, ownedUuids = [] } = {}) {
  const stored = (doc?.system?.roster ?? []).map((r) => r.toObject?.() ?? r);
  return visibleOccupants(mergeOccupants(stored, sceneOccupants(scene)), { isGM, ownedUuids });
}

/** Put an actor on a place's roster. A second add is a no-op, not a duplicate. */
export async function addOccupant(place, actor, options = {}) {
  if (!place || !actor || !place.isOwner) return false;
  if (place.uuid === actor.uuid) return false;
  const rows = (place.system?.roster ?? []).map((r) => r.toObject?.() ?? r);
  if (rows.some((r) => r.uuid === actor.uuid)) return false;
  await place.update({ "system.roster": [...rows, occupantRow(actor, options)] });
  Hooks.callAll(PLACE_HOOKS.OCCUPANT_ADDED, { place: place.uuid, occupant: actor.uuid });
  return true;
}

/** Take an actor off a place's roster. Removing a derived row is a no-op. */
export async function removeOccupant(place, uuid) {
  if (!place || !place.isOwner) return false;
  const rows = (place.system?.roster ?? []).map((r) => r.toObject?.() ?? r);
  const next = rows.filter((r) => r.uuid !== uuid);
  if (next.length === rows.length) return false;
  await place.update({ "system.roster": next });
  Hooks.callAll(PLACE_HOOKS.OCCUPANT_REMOVED, { place: place.uuid, occupant: uuid });
  return true;
}

/* -------------------------------------------- */
/*  Stacking                                     */
/* -------------------------------------------- */

/**
 * Split one instance out of a stacked place into its own actor.
 *
 * The stack shrinks, the new place inherits the parent, the name gains an
 * ordinal, and NOTHING ELSE COMES ACROSS — no goods, no roster. That is
 * deliberate: the stack's contents were never per-instance (eight identical bays
 * hold one pooled inventory), so dividing them would be inventing an answer the
 * model never had. The split exists to make one bay *become* interesting; what
 * goes in it is the next thing the GM does.
 */
export async function splitPlace(place, take = 1) {
  if (!place || !place.isOwner) return null;
  const plan = planSplit(countOf(place), take);
  if (!plan) {
    warn("place.cannotSplit");
    return null;
  }
  const source = place.toObject();
  // Carry the flags across, but never `vaultOf`: that names the ONE character a
  // personal vault belongs to, and two actors claiming it would make
  // `findVaultOf` return whichever it happened to reach first.
  const flags = foundry.utils.deepClone(source.flags ?? {});
  if (flags[MODULE_ID]?.[STORAGE_KEY]?.vaultOf) delete flags[MODULE_ID][STORAGE_KEY].vaultOf;
  const created = await Actor.create({
    name: stackMemberName(place.name, plan.from + 1),
    type: place.type,
    img: place.img,
    ownership: source.ownership,
    system: {
      parentUuid: parentUuidOf(place) ?? "",
      region: place.system?.region ?? "",
      stack: { count: plan.to },
    },
    flags,
  });
  await place.update({ "system.stack.count": plan.from });
  Hooks.callAll(PLACE_HOOKS.SPLIT, { from: place.uuid, to: created?.uuid, count: plan.to });
  return created ?? null;
}

/* -------------------------------------------- */
/*  Totals                                       */
/* -------------------------------------------- */

/**
 * Coin held at a place and everything under it, in gold.
 *
 * The roll-up is what nesting buys: "how much is at the Rusty Anchor" should
 * include the strongbox in its cellar, or nesting is just a label.
 */
export function coinRollupGC(doc, nodes = null) {
  const all = nodes ?? allPlaces();
  const counts = new Map();
  for (const node of all) {
    const actor = game.actors?.get(node.uuid.split(".")[1]);
    if (!actor) continue;
    counts.set(node.uuid, coinAt(actor));
  }
  return rollup(doc.uuid, all, counts);
}

/** Coin stored at one provider, in gold. */
function coinAt(actor) {
  return storedItems(actor)
    .filter((i) => i.type === "money")
    .reduce((sum, i) => sum + (Number(i.system?.quantity) || 0) * ((Number(i.system?.coppervalue) || 0) / 100), 0);
}

/** Whether any goods at this place belong to somebody — used to warn on delete. */
export const hasStoredGoods = (doc) => storedItems(doc).some((i) => !!storageFlagOf(i));

/* -------------------------------------------- */
/*  Localisation                                 */
/* -------------------------------------------- */

function warn(key) {
  const full = `ACKS-LIB.${key}`;
  ui.notifications?.warn(game.i18n?.has?.(full) ? game.i18n.localize(full) : full);
}
