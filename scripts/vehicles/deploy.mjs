/* global game, canvas, ui, fromUuidSync */
/**
 * A vehicle deployed as a PLACE — a wagon circled into a camp, a ship moored
 * in a harbour — and struck again when it moves on.
 *
 * Deploying makes the vehicle a storage provider, files it under the place
 * the party stands at, and stands its own token on the map beside the party
 * as a point of interest (`location/here.mjs` treats that token as it treats
 * a location's). Anyone aboard reaches it wherever it stands
 * (`location/reach.mjs`, "aboard is there").
 *
 * The `deployed` record under the vehicle's place flag remembers what deploy
 * itself turned on — the provider switch, the prior parent, the marker it
 * created — so striking undoes exactly those and nothing a Judge set by hand.
 * Goods stashed aboard while it stood keep the provider switch on: they are
 * aboard, and travel with it.
 *
 * Formation and location are reached through their published APIs rather
 * than by import: both already import vehicles, and reading them at call time
 * keeps the dependency one-way.
 */
import { MODULE_ID, LANG_PREFIX, VEHICLE_TYPE } from "./constants.mjs";
import { isProvider, setProvider } from "../lib/storage.mjs";
import { PLACE_KEY, hasStoredGoods, isLocation, parentUuidOf, setParent } from "../lib/place.mjs";
import { executeAsGM, registerHandler } from "../lib/sockets.mjs";
import { unset } from "../lib/util.mjs";

/** The GM relay that stands or removes a marker for a seat without token rights. */
export const MARKER_HANDLER = "vehicleMarker";

const DEPLOYED_PATH = `flags.${MODULE_ID}.${PLACE_KEY}.deployed`;

const formationApi = () => globalThis.acksExtras?.formation ?? null;
const locationApi = () => globalThis.acksExtras?.location ?? null;

/**
 * The deploy record — `{at, tokenUuid, madeProvider, priorParent}` — or null
 * for a vehicle on the move. `tokenUuid` names only a marker deploy CREATED;
 * a token the Judge had already placed is used and never recorded.
 */
export function deploymentOf(vehicle) {
  if (vehicle?.type !== VEHICLE_TYPE || !isProvider(vehicle)) return null;
  return vehicle.getFlag(MODULE_ID, PLACE_KEY)?.deployed ?? null;
}

/**
 * Where this vehicle would deploy: the party whose train it is in, that
 * party's token and scene, and the place it would be filed under — the
 * location whose marker the party stands at, else the location the whole
 * scene is. A vehicle is never filed inside another deployed vehicle.
 *
 * @returns {{formation: object|null, partyToken: TokenDocument|null,
 *   scene: Scene|null, parent: Actor|null}}
 */
export function deploySite(vehicle) {
  const formations = formationApi();
  const formation = formations?.formationCarrying?.(vehicle) ?? null;
  const partyToken = formation ? (formations.getPartyToken?.(formation) ?? null) : null;
  const scene = partyToken?.parent ?? canvas?.scene ?? null;
  const location = locationApi();
  let parent = formation ? (location?.here?.placeUnderParty?.(formation) ?? null) : null;
  if (!isLocation(parent)) parent = null;
  if (!parent && scene) parent = location?.scenes?.locationOfScene?.(scene) ?? null;
  return { formation, partyToken, scene, parent };
}

/**
 * The top-left corner a new marker takes: the square beside the party token,
 * on its left where the right would leave the scene; with no party on the
 * map, the middle of the scene as this client views it.
 *
 * On a square grid the corner lands on a grid line, rounded AWAY from the
 * party so a party token narrower than a square is never overlapped; a hex or
 * gridless scene takes the corner as computed.
 */
function markerSpot(scene, partyToken, prototype) {
  const gs = scene.grid.size;
  const d = scene.dimensions;
  const w = (Number(prototype?.width) || 1) * gs;
  const h = (Number(prototype?.height) || 1) * gs;
  if (partyToken) {
    const square = !!scene.grid.isSquare;
    const right = partyToken.x + partyToken.width * gs;
    let x = square ? Math.ceil(right / gs) * gs : right;
    if (x + w > d.sceneX + d.sceneWidth) x = square ? Math.floor((partyToken.x - w) / gs) * gs : partyToken.x - w;
    const y = square ? Math.round(partyToken.y / gs) * gs : partyToken.y;
    return { x, y };
  }
  const centre = canvas?.scene === scene && canvas.stage?.pivot
    ? { x: canvas.stage.pivot.x, y: canvas.stage.pivot.y }
    : { x: d.sceneX + d.sceneWidth / 2, y: d.sceneY + d.sceneHeight / 2 };
  return { x: Math.floor((centre.x - w / 2) / gs) * gs, y: Math.floor((centre.y - h / 2) / gs) * gs };
}

/**
 * Create the vehicle's marker: a LINKED token, so the map shows the world
 * actor whose hold the goods are in rather than a synthetic copy.
 */
async function createMarker(vehicle, scene, { x, y }) {
  const data = (await vehicle.getTokenDocument({ x, y, hidden: false, actorLink: true })).toObject();
  delete data._id;
  const [token] = await scene.createEmbeddedDocuments("Token", [data]);
  return token ?? null;
}

/**
 * The GM half of the relay. Authorizes on the SENDER's ownership of the
 * vehicle (the transport stamps `requestUserId`), and removes only the marker
 * the vehicle's own deploy record names.
 */
async function markerRelay({ op, vehicleUuid, sceneId, x, y, tokenUuid, requestUserId } = {}) {
  const vehicle = fromUuidSync(vehicleUuid);
  if (vehicle?.type !== VEHICLE_TYPE) return null;
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  if (!user || !vehicle.testUserPermission(user, "OWNER")) return null;
  if (op === "stand") {
    const scene = game.scenes.get(sceneId);
    return scene ? ((await createMarker(vehicle, scene, { x, y }))?.uuid ?? null) : null;
  }
  if (op === "strike") {
    if (!tokenUuid || deploymentOf(vehicle)?.tokenUuid !== tokenUuid) return false;
    const token = fromUuidSync(tokenUuid);
    if (!token || token.actorId !== vehicle.id) return false;
    await token.delete();
    return true;
  }
  return null;
}

registerHandler(MARKER_HANDLER, markerRelay);

/**
 * Stand the vehicle's marker on a scene: a visible token of it already there
 * is used as it is; otherwise one is created — by this client where it may
 * create tokens, through the GM where it may not.
 * @returns {Promise<{token: TokenDocument|null, created: boolean}>}
 */
async function standMarker(vehicle, scene, partyToken) {
  const existing = scene.tokens.find((t) => t.actorId === vehicle.id && !t.hidden) ?? null;
  if (existing) return { token: existing, created: false };
  const spot = markerSpot(scene, partyToken, vehicle.prototypeToken);
  if (game.user.can("TOKEN_CREATE")) {
    const token = await createMarker(vehicle, scene, spot);
    return { token, created: !!token };
  }
  const uuid = await executeAsGM(MARKER_HANDLER, { op: "stand", vehicleUuid: vehicle.uuid, sceneId: scene.id, ...spot });
  const token = uuid ? fromUuidSync(uuid) : null;
  return { token, created: !!token };
}

/**
 * Deploy a vehicle as a place.
 *
 * @param {Actor} vehicle
 * @param {object} [o]
 * @param {string|null} [o.parentUuid] the place to file it under; omitted, the
 *   place `deploySite` finds, and null files it at the root
 * @param {boolean} [o.marker] stand its token on the map (default true)
 * @returns {Promise<{ok: boolean, reason?: string, parentUuid?: string|null,
 *   markerUuid?: string|null, created?: boolean}>}
 */
export async function deployVehicle(vehicle, { parentUuid, marker = true } = {}) {
  if (vehicle?.type !== VEHICLE_TYPE) return { ok: false, reason: "notAVehicle" };
  if (!vehicle.isOwner) return { ok: false, reason: "notOwner" };
  if (deploymentOf(vehicle)) return { ok: false, reason: "already" };
  const site = deploySite(vehicle);
  const madeProvider = !isProvider(vehicle);
  if (madeProvider && !(await setProvider(vehicle, true))) return { ok: false, reason: "notOwner" };

  const priorParent = parentUuidOf(vehicle);
  const next = parentUuid === undefined ? (site.parent?.uuid ?? null) : parentUuid || null;
  if (next !== priorParent) await setParent(vehicle, next);

  let markerUuid = null;
  let tokenUuid = null;
  if (marker && site.scene) {
    const stood = await standMarker(vehicle, site.scene, site.partyToken);
    markerUuid = stood.token?.uuid ?? null;
    if (stood.created) tokenUuid = markerUuid;
  }
  await vehicle.update({
    [DEPLOYED_PATH]: { at: game.time?.worldTime ?? 0, tokenUuid, madeProvider, priorParent: priorParent ?? "" },
  });
  const where = next ? (fromUuidSync(next)?.name ?? "") : "";
  ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.place.deployed${where ? "At" : ""}`, { name: vehicle.name, place: where }));
  return { ok: true, parentUuid: parentUuidOf(vehicle), markerUuid, created: !!tokenUuid };
}

/**
 * Strike a deployed vehicle: remove the marker deploy created, restore the
 * parent it had before, and turn storage back off when deploy turned it on
 * and nobody's goods are left aboard.
 * @returns {Promise<{ok: boolean, reason?: string, removed?: boolean, providerOff?: boolean}>}
 */
export async function strikeVehicle(vehicle) {
  const record = deploymentOf(vehicle);
  if (!record) return { ok: false, reason: "notDeployed" };
  if (!vehicle.isOwner) return { ok: false, reason: "notOwner" };

  let removed = false;
  const token = record.tokenUuid ? fromUuidSync(record.tokenUuid) : null;
  if (token) {
    if (game.user.can("TOKEN_DELETE")) {
      await token.delete();
      removed = true;
    } else {
      removed = !!(await executeAsGM(MARKER_HANDLER, { op: "strike", vehicleUuid: vehicle.uuid, tokenUuid: record.tokenUuid }));
    }
  }
  await vehicle.update({ [DEPLOYED_PATH]: unset() });
  const prior = record.priorParent || null;
  if (parentUuidOf(vehicle) !== prior) await setParent(vehicle, prior);
  const providerOff = record.madeProvider && !hasStoredGoods(vehicle) ? await setProvider(vehicle, false) : false;
  ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.place.struck`, { name: vehicle.name }));
  return { ok: true, removed, providerOff };
}
