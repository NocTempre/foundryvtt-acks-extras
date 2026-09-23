/* global game, foundry, Hooks, ui, Actor, fromUuidSync */
/**
 * PLACES — nesting, occupancy and stacking over the storage primitive. The
 * document reads and writes around the Foundry-free rules in
 * place-logic.mjs. Three document shapes (a location actor, a foreign
 * storage provider, an equipment container item) reduce to one node through
 * `nodeOf`; nothing downstream knows the difference. See docs/lib/PLACES.md.
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
import { ITEM_TYPE, ACTOR_TYPE } from "./vocab.mjs";

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

/** The equipment feature's container vocabulary — read generically, never imported. */
const CONTAINER_FLAG = "container";
const CONTAINED_IN = "containedIn";

/* -------------------------------------------- */
/*  Recognising places                           */
/* -------------------------------------------- */

/** Is this actor our location sub-type? */
export const isLocation = (doc) => doc?.documentName === "Actor" && doc?.type === LOCATION_TYPE;

/**
 * Is this item something gear can go inside? True for a declared capacity
 * (any gear may have one) or a container state flag — checking only the
 * flag would miss a capacity-only container.
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
 * One place node from a compendium INDEX row — its own reduction, since an
 * index row has no `documentName` or `getFlag` for the predicates above to
 * read. Only the two actor-backed kinds can appear here.
 */
function packNodeOf(row, uuid) {
  const flag = row?.flags?.[MODULE_ID]?.[PLACE_KEY];
  const isOurs = row?.type === LOCATION_TYPE;
  if (!isOurs && !flag) return null;
  return {
    uuid,
    parentUuid: (isOurs ? row.system?.parentUuid : null) || flag?.parentUuid || null,
    name: row.name ?? "",
    img: row.img ?? null,
    kind: isOurs ? PLACE_KIND.LOCATION : PLACE_KIND.PROVIDER,
    count: Math.max(1, Math.floor(Number(flag?.count) || 1)),
  };
}

/** The pack a compendium uuid names, or null for a world uuid. */
export function packIdOf(uuid) {
  if (typeof uuid !== "string" || !uuid.startsWith("Compendium.")) return null;
  const [, scope, name] = uuid.split(".");
  return scope && name ? `${scope}.${name}` : null;
}

/**
 * The places one compendium holds, read from its already-loaded index — no
 * fetch on a render path. Scoped to a single pack; see docs/lib/PLACES.md,
 * "Cost".
 */
export function packPlaces(packId) {
  const pack = packId ? game.packs?.get(packId) : null;
  if (!pack || pack.documentName !== "Actor") return [];
  const nodes = [];
  for (const row of pack.index ?? []) {
    const uuid = pack.getUuid?.(row._id) ?? `Compendium.${pack.collection}.Actor.${row._id}`;
    const node = packNodeOf(row, uuid);
    if (node) nodes.push(node);
  }
  return nodes;
}

/**
 * Every actor-backed place in the world, as nodes — plus, when a pack is
 * named, the places that pack holds. Container items are excluded (see
 * docs/lib/PLACES.md, "Cost"); pass the viewed document's `pack` so a place
 * living in a compendium sees its own family.
 */
export function allPlaces({ pack = null } = {}) {
  const world = (game.actors?.contents ?? []).filter((a) => isLocation(a) || isProvider(a)).map(nodeOf).filter(Boolean);
  return pack ? [...world, ...packPlaces(pack)] : world;
}

/** uuid → node over every actor-backed place. Share one per render. */
export const placeIndex = (opts) => indexPlaces(allPlaces(opts));

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
 * The places directly inside this one: sub-locations and provider actors
 * that name it as parent, plus the container items it physically holds.
 * `nodeOf` flattens the two different sources into one shape.
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
 * The items held at a place — a list of Items whichever backing holds them:
 * an actor-place's real embedded items (storage.mjs), or a container item's
 * siblings pointed at it by the equipment feature's `containedIn`. See
 * docs/lib/PLACES.md, "A container is the trivial place".
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
 * Everything at a place, as uniform rows: sub-places first, then items — the
 * order a person describes a place in. Each row carries `isPlace` so the
 * sheet can make one drillable and the other draggable in one pass.
 */
export function contentRows(doc, nodes = null) {
  const places = childPlaces(doc, nodes).map((node) => ({
    ...node,
    isPlace: true,
    stacked: isStacked(node),
  }));
  // A container stashed at a location is both stored goods and a child
  // place; listed once, as the place, so a chest cannot be retrieved from
  // under its own contents.
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
 * Refuses cycles (docs/lib/PLACES.md, "The one invariant") and refuses
 * container items outright. See docs/lib/DECISIONS.md, "Re-parenting a
 * container item is a move, not a re-parent".
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
  if (actor.type === ACTOR_TYPE.monster) return OCCUPANT_KIND.MONSTER;
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
 * The tokens standing on a place's linked scene, as derived occupant rows.
 * Only linked tokens and tokens over world actors produce a row — an
 * unlinked token's actor uuid dies with it, same as storage's refusal of
 * token actors as transfer endpoints.
 */
export function sceneOccupants(scene) {
  if (!scene) return [];
  const rows = [];
  const seen = new Set();
  for (const token of scene.tokens ?? []) {
    const actor = token.actor;
    if (!actor || actor.isToken) continue; // unlinked: uuid dies with the token
    // A place's token is a point of interest on the map, not somebody living
    // here: a shrine standing in the market square is not the square's tenant.
    if (isLocation(actor)) continue;
    if (seen.has(actor.uuid)) continue;
    seen.add(actor.uuid);
    rows.push(occupantRow(actor));
  }
  return rows;
}

/**
 * The roster a sheet renders: stored rows merged with the scene's tokens,
 * then filtered to what this viewer may see. The order matters — see
 * docs/lib/PLACES.md, "Occupancy: two sources, one list, stored wins".
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
 * Split one instance out of a stacked place into its own actor. See
 * docs/lib/PLACES.md, "Stacking, and how it differs from a group".
 */
export async function splitPlace(place, take = 1) {
  if (!place || !place.isOwner) return null;
  const plan = planSplit(countOf(place), take);
  if (!plan) {
    warn("place.cannotSplit");
    return null;
  }
  const source = place.toObject();
  // Flags carry across except `vaultOf`: two actors claiming the one
  // personal vault would make `findVaultOf` ambiguous.
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
 * Coin held at a place and everything under it, in gold — what nesting buys
 * that a flat model does not: a town's total includes what its cellars hold.
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
    .filter((i) => i.type === ITEM_TYPE.money)
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
