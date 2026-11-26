/* global game, foundry, ui, Hooks, document, fromUuid, fromUuidSync */
/**
 * The "Place" row the module adds to core's own Region window, and the picker
 * both it and the District behaviour's row are built from. The row names the
 * place that holds the region's traps, obstacles and conditions, counts what
 * the place holds, and takes a dropped trap, obstacle or condition onto it,
 * making the place first when the region has none. Reads and writes the link
 * through the location feature's own api (`acksExtras.location.scenes`) and the
 * list through `lib/place-things.mjs`, so this window knows nothing of how
 * either is stored. DOM injection, rebuilt on every render since ApplicationV2
 * replaces its parts. The Judge's row edits the link; a Player who owns the
 * Region gets a read-only row of what Foundry's ownership lets them see, and a
 * drop from their seat is relayed to the Judge's client, which re-resolves the
 * place and tests the sender's own ownership (`placeDropRelay`).
 */
import { MODULE_ID } from "./constants.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";
import { placesAround } from "../location/places-around.mjs";
import { associateLabels } from "../lib/a11y.mjs";
import { elementOf, escape as esc } from "../lib/util.mjs";
import { executeAsGM, registerHandler } from "../lib/sockets.mjs";
import { THING_KINDS, kindOfDrop } from "../lib/place-things-logic.mjs";
import { addThingTo, thingsOf } from "../lib/place-things.mjs";
import { countsOf, descriptorOf, dropAuthority, placeRowOf, refusalOfDrop, thingOfDrop, thingsShownTo } from "./region-place-logic.mjs";

const ROW = "acks-extras-region-place";
const LANG_PREFIX = "ACKS-FORMATION.REGION_PLACE";

/** The socket handler a Player's drop is relayed to; the Judge's client runs it. */
export const PLACE_DROP_HANDLER = "formationPlaceDrop";

/** The refusals a drop's own kind can earn, which the seat words as the row does. */
const KIND_REFUSALS = Object.freeze(["notItem", "blankHazard", "notAccepted"]);

/** Say why a drop was refused, in the row's own words. */
const warnRefused = (key) => ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refused.${key}`));

/** Log a rejected promise where a developer looks; the row never throws into core's render. */
const report = (run, what) => Promise.resolve(run).catch((err) => console.error(`${MODULE_ID} | ${what} failed`, err));

/**
 * The picker: a labelled select of the world's places with the region's own
 * pre-selected, a button that makes a place for the region, and a hint. It
 * writes the link at once, since the window's own submit knows nothing of it.
 * Not yet in the document, so the caller inserts it and then runs
 * `associateLabels` on a root that is.
 *
 * @param {object} options
 * @param {RegionDocument} options.region
 * @param {object} options.scenes the location feature's `scenes` api
 * @param {(key: string) => string} options.say text of the picker's own keys: `label`, `none`, `create`, `hint`
 * @param {string} options.cls the group's class; the select and button take `<cls>-select` and `<cls>-new`
 * @param {() => void} [options.afterMake] runs once the place is made
 * @param {() => void} [options.afterLink] runs once the link is changed
 * @returns {HTMLElement}
 */
export function placePickerOf({ region, scenes, say, cls, afterMake, afterLink }) {
  const linked = scenes.locationOfRegion(region);
  const isGM = !!game.user?.isGM;
  // A seat that is not a Judge's is offered only the places it can open, so no closed place is named.
  const places = game.actors
    .filter((a) => a.type === LOCATION_TYPE && (isGM || a.testUserPermission?.(game.user, "LIMITED")))
    .sort((a, b) => a.name.localeCompare(b.name));
  const group = document.createElement("div");
  group.className = `form-group ${cls}`;
  group.innerHTML = `<label>${esc(say("label"))}</label>
    <div class="form-fields">
      <select class="${cls}-select">
        <option value="">${esc(say("none"))}</option>
        ${places.map((a) => `<option value="${esc(a.uuid)}"${linked?.uuid === a.uuid ? " selected" : ""}>${esc(a.name)}</option>`).join("")}
      </select>
      <button type="button" class="${cls}-new" data-tooltip-text="${esc(say("create"))}" aria-label="${esc(say("create"))}">
        <i class="fas fa-plus" aria-hidden="true" inert></i>
      </button>
    </div>
    <p class="hint">${esc(say("hint"))}</p>`;

  group.querySelector(`.${cls}-select`).addEventListener("change", (ev) => {
    const uuid = ev.currentTarget.value;
    const actor = uuid ? game.actors.get(uuid.split(".")[1]) : null;
    report(Promise.resolve(actor ? scenes.linkRegion(region, actor) : scenes.unlinkRegion(region)).then((done) => done !== false && afterLink?.()), "place link");
  });
  group.querySelector(`.${cls}-new`).addEventListener("click", () => {
    report(Promise.resolve(scenes.createLocationForRegion(region)).then((made) => made && afterMake?.()), "place create");
  });
  return group;
}

/** A thing's ref as its document's name, or null where the ref cannot be named without a fetch. */
function nameOfRef(ref) {
  try {
    return fromUuidSync(ref, { strict: false })?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * The counts line: what the place holds by kind, each count carrying its names,
 * or the none string. A seat that is not a Judge's counts and names only the
 * things not marked hidden.
 */
function countsLineOf(place, isGM = true) {
  const line = document.createElement("p");
  line.className = `${ROW}-counts`;
  const rows = place ? countsOf(thingsShownTo(thingsOf(place), isGM), nameOfRef) : [];
  if (!rows.length) {
    line.textContent = game.i18n.localize(`${LANG_PREFIX}.holdsNone`);
    return line;
  }
  const lead = document.createElement("span");
  lead.textContent = game.i18n.localize(`${LANG_PREFIX}.holds`);
  line.append(lead);
  for (const { kind, count, names } of rows) {
    const span = document.createElement("span");
    span.className = `${ROW}-count`;
    span.dataset.tooltipText = names.join(", ");
    span.textContent = game.i18n.format(`${LANG_PREFIX}.${kind}.${count === 1 ? "one" : "other"}`, { count });
    line.append(" ", span);
  }
  return line;
}

/**
 * Resolve a drag's own data to what it becomes: the dropped Item, its
 * descriptor and the kind the one table makes of it (null when none does).
 */
async function dropKind(data) {
  const dropped = data?.type === "Item" && data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
  const drop = descriptorOf(dropped, data?.uuid);
  return { drop, kind: drop ? kindOfDrop(drop) : null };
}

/** Send a drop to the Judge's client, which owns the write. */
const relayPlaceDrop = (payload) => executeAsGM(PLACE_DROP_HANDLER, payload);

/**
 * Relay one drop from a seat that is not a Judge's and word the answer. A drop
 * sent and not refused answers an empty list, whether or not a Judge's client
 * answered. A refusal answers null, warned in the row's words: the drop's own
 * kind refusals as they are, and every other refusal as `none`, which is also
 * what a place the seat does not own answers, so the words never tell a closed
 * place from no place.
 *
 * @param {(payload: object) => Promise<object|undefined>} relay
 * @param {object} payload the closed op's args
 * @param {string|null} none the lang key said for a refusal that is not the drop's own, or null to say nothing
 * @returns {Promise<object[]|null>}
 */
async function sendDrop(relay, payload, none) {
  const answer = await relay(payload);
  if (answer?.ok !== false) return [];
  if (KIND_REFUSALS.includes(answer.refused)) warnRefused(answer.refused);
  else if (none) warnRefused(none);
  return null;
}

/**
 * Take one drop onto the region's place. Resolves the dragged document, asks
 * the one kind table what it becomes, makes the place first when the region has
 * none (without opening its sheet), and adds the thing. A drop no kind accepts
 * warns in words and writes nothing. `point` is where a map drop landed and is
 * left out for a drop on a sheet, which has no place on the map to name. A seat
 * that is not a Judge's sends the drop to the Judge's client instead, which
 * writes it only onto a place that seat owns (`placeDropRelay`).
 *
 * @param {object} options
 * @param {RegionDocument} options.region
 * @param {object} options.scenes the location feature's `scenes` api
 * @param {{type?: string, uuid?: string}|null} options.data the drag's own data
 * @param {{x: number, y: number}|null} [options.point] where a map drop landed, in scene pixels
 * @param {(payload: object) => Promise<object|undefined>} [options.relay] sends a non-Judge seat's drop
 * @returns {Promise<object|null>} the thing's list after the write (an empty list for a drop relayed), or null
 */
export async function dropOnRegionPlace({ region, scenes, data, point = null, relay = relayPlaceDrop }) {
  const { drop, kind } = await dropKind(data);
  const refusal = refusalOfDrop(drop, kind);
  if (refusal) {
    warnRefused(refusal);
    return null;
  }
  if (!game.user?.isGM) return sendDrop(relay, { itemUuid: drop.uuid, regionUuid: region.uuid }, "noPlace");
  const place = scenes.locationOfRegion(region) ?? (await scenes.createLocationForRegion(region, { render: false }));
  if (!place) {
    warnRefused("noPlace");
    return null;
  }
  return addThingTo(place, thingOfDrop(kind, drop, { point }));
}

/**
 * Take one drop onto a place's own sheet, which already is the place: the one
 * kind table says what the document becomes and it is added with no `point`. A
 * drop no kind takes is not this row's and answers false with no word, so the
 * sheet can file it as goods; a Hazard item with no usable key is refused in
 * words and answers true.
 *
 * @param {object} options
 * @param {Actor} options.place the location actor
 * @param {{type?: string, uuid?: string}|null} options.data the drag's own data
 * @returns {Promise<boolean>} whether this took the drop
 */
export async function dropOnPlace({ place, data }) {
  const { drop, kind } = await dropKind(data);
  const refusal = refusalOfDrop(drop, kind);
  if (refusal === "notItem" || refusal === "notAccepted") return false;
  if (refusal) {
    warnRefused(refusal);
    return true;
  }
  await addThingTo(place, thingOfDrop(kind, drop, { point: null }));
  return true;
}

/**
 * The Region a drop on the map lands in when no place holds the point: the
 * smallest Region over it that has no behaviors at all. A Region that already
 * carries a behavior (a zone, a terrain, a district) stands for another
 * feature's area, and a drop there does not make a place of it.
 */
export function bareRegionAt(scene, point, scenes) {
  const holds = (region) => region.behaviors?.size === 0 && !scenes.locationOfRegion(region) && region.testPoint({ ...point, elevation: 0 });
  return [...(scene?.regions ?? [])].filter(holds).sort((x, y) => (x.area ?? 0) - (y.area ?? 0))[0] ?? null;
}

/**
 * Take one drop onto the map. The point is the drop's `x`/`y`. The thing goes
 * to the place whose area holds it (`placesAround`: its Region, its token, its
 * map; the first when more than one does), and with no place there to a bare
 * Region over it, which is made a place first and the thing added through the
 * same path as a drop in the Region window, `point` set. A drop no kind accepts
 * is not this row's and is left alone without a word. A trap is the map drop's
 * wall assignment first: the trap drop asks here only where no wall is near
 * (`includeTraps`), and this row's own hook never takes one. A seat that is not
 * a Judge's sends the drop to the Judge's client after the same checks.
 *
 * @param {object} options
 * @param {Scene} options.scene
 * @param {{type?: string, uuid?: string, x?: number, y?: number}|null} options.data the drag's own data
 * @param {boolean} [options.includeTraps] take a trap drop too (the trap drop's fallback)
 * @param {object} [options.scenes] the location feature's `scenes` api
 * @param {(point: object, scene: Scene) => Array<{place: Actor}>} [options.around] `placesAround`
 * @param {(payload: object) => Promise<object|undefined>} [options.relay] sends a non-Judge seat's drop
 * @returns {Promise<object|null>} the list after the write (an empty list for a drop relayed), or null when nothing took the drop
 */
export async function dropOnMapPlace({ scene, data, includeTraps = false, scenes = globalThis.acksExtras?.location?.scenes, around = placesAround, relay = relayPlaceDrop }) {
  const point = { x: Number(data?.x), y: Number(data?.y) };
  if (!scene || !scenes || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return null;
  const { drop, kind } = await dropKind(data);
  if (!kind || (kind === THING_KINDS.TRAP && !includeTraps)) return null;
  // A refused trap is worded by the trap drop; a hazard has no other wording.
  if (!game.user?.isGM) return sendDrop(relay, { itemUuid: drop.uuid, sceneId: scene.id, x: point.x, y: point.y }, includeTraps ? null : "noRegion");
  const held = around(point, scene)[0]?.place ?? null;
  if (held) return addThingTo(held, thingOfDrop(kind, drop, { point }));
  const region = bareRegionAt(scene, point, scenes);
  if (!region) {
    // The trap drop words its own refusal; a hazard has no other.
    if (!includeTraps) ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.refused.noRegion`));
    return null;
  }
  return dropOnRegionPlace({ region, scenes, data, point });
}

/**
 * The place line of a seat that is not a Judge's: a caption and the place's
 * name as text, or a stand-in where the seat may not name it. The caption is a
 * `<span>` because it names no control.
 */
function seatPlaceLine(say, text) {
  const group = document.createElement("div");
  group.className = `form-group ${ROW}-seat`;
  const caption = document.createElement("span");
  caption.className = `${ROW}-caption`;
  caption.textContent = say("label");
  const fields = document.createElement("div");
  fields.className = "form-fields";
  const name = document.createElement("span");
  name.className = `${ROW}-name`;
  name.textContent = text;
  fields.append(name);
  group.append(caption, fields);
  return group;
}

/**
 * Build the row into one Region window: under the Name field on the Appearance
 * tab, which is where core 14 keeps it. Idempotent, so a render that touched
 * only some parts rebuilds it without leaving a second. It is mounted for any
 * seat that owns the Region, and `placeRowOf` says what each seat is shown.
 */
function mountRegionPlaceRow(app) {
  const region = app?.document;
  if (!region?.isOwner) return;
  const scenes = globalThis.acksExtras?.location?.scenes;
  if (typeof scenes?.locationOfRegion !== "function") return;
  const root = elementOf(app.element);
  if (!root) return;
  root.querySelectorAll(`.${ROW}`).forEach((n) => n.remove());
  const tab = root.querySelector('section[data-tab="appearance"]');
  if (!tab) return;

  // A write can re-render the window and strand the nodes this closed over,
  // so a refresh finds the window's present element again rather than reusing one.
  const remount = () => mountRegionPlaceRow(app);
  const say = (key) => game.i18n.localize(`${LANG_PREFIX}.${key}`);
  const place = scenes.locationOfRegion(region);
  const isGM = !!game.user?.isGM;
  const show = placeRowOf({
    isGM,
    linked: !!place,
    canOpen: !!place?.testUserPermission?.(game.user, "LIMITED"),
    owns: !!place?.testUserPermission?.(game.user, "OWNER"),
    canCreate: !!game.user?.can?.("ACTOR_CREATE"),
  });

  const row = document.createElement("div");
  row.className = ROW;
  const zone = document.createElement("div");
  zone.className = `${ROW}-drop`;
  // The Judge's zone keeps its words; a Player dropping on a place they own makes none.
  zone.textContent = say(!isGM && place ? "dropOwned" : "drop");
  if (show.picker) row.append(placePickerOf({ region, scenes, say, cls: `${ROW}-picker`, afterMake: remount, afterLink: remount }));
  else row.append(seatPlaceLine(say, show.name === "text" ? place.name : say(show.name)));
  if (show.counts) row.append(countsLineOf(place, isGM));
  if (show.zone) row.append(zone);
  if (show.hiddenNote) {
    const note = document.createElement("p");
    note.className = "hint";
    note.textContent = say("dropHidden");
    row.append(note);
  }

  const over = (on) => zone.classList.toggle("is-over", on);
  zone.addEventListener("dragover", (ev) => {
    ev.preventDefault();
    over(true);
  });
  zone.addEventListener("dragleave", () => over(false));
  zone.addEventListener("drop", (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    over(false);
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(ev);
    report(dropOnRegionPlace({ region, scenes, data }).then(remount), "region place drop");
  });

  const anchor = tab.querySelector('[name="name"]')?.closest(".form-group");
  if (anchor) anchor.after(row);
  else tab.prepend(row);
  associateLabels(row);
}

/** The refusal a relayed drop answers when nothing may take it. */
const refused = (code) => ({ ok: false, refused: code });

/**
 * Run a relayed drop on the Judge's client. The sender is the one the server
 * attested (`requestUserId`, null for a Judge's own call), and only the closed
 * keys of the payload are read: `{itemUuid, regionUuid}` for a drop in the
 * Region window, `{itemUuid, sceneId, x, y}` for a drop on the map. The place is
 * resolved here, never taken from the payload, and the thing is written only
 * onto a place the sender owns, or onto one made for a Region the sender owns
 * when the sender may create Actors. "No place here" and "a place the sender
 * does not own" answer the same refusal, so a drop never reveals a closed
 * place. A trap is stored hidden whoever drops it.
 *
 * @param {object} payload
 * @param {string} [payload.requestUserId] the attested sender
 * @param {object} [seams]
 * @param {object} [seams.scenes] the location feature's `scenes` api
 * @param {(point: object, scene: Scene) => Array<{place: Actor}>} [seams.around] `placesAround`
 * @returns {Promise<{ok: true}|{ok: false, refused: string}>}
 */
export async function placeDropRelay(payload, { scenes = globalThis.acksExtras?.location?.scenes, around = placesAround } = {}) {
  const { itemUuid, regionUuid, sceneId, x, y, requestUserId = null } = payload ?? {};
  const user = requestUserId ? game.users.get(requestUserId) : game.user;
  const byRegion = typeof regionUuid === "string";
  const none = byRegion ? "noPlace" : "none";
  if (!user || typeof itemUuid !== "string" || !scenes) return refused("none");
  const item = await fromUuid(itemUuid).catch(() => null);
  if (!item?.testUserPermission?.(user, "LIMITED")) return refused("none");
  const drop = descriptorOf(item, itemUuid);
  const kind = kindOfDrop(drop);
  const kindRefusal = refusalOfDrop(drop, kind);
  if (kindRefusal) return refused(kindRefusal);

  const owns = (doc) => !!doc?.testUserPermission?.(user, "OWNER");
  const canCreate = !!user.can?.("ACTOR_CREATE");
  let point = null;
  let place = null;
  let region = null;
  if (byRegion) {
    region = await fromUuid(regionUuid).catch(() => null);
    if (region?.documentName !== "Region") return refused(none);
    place = scenes.locationOfRegion(region);
  } else {
    const scene = typeof sceneId === "string" ? game.scenes?.get(sceneId) : null;
    if (!scene || typeof x !== "number" || typeof y !== "number" || !Number.isFinite(x) || !Number.isFinite(y)) return refused(none);
    point = { x, y };
    place = around(point, scene)[0]?.place ?? null;
    if (!place) region = bareRegionAt(scene, point, scenes);
  }
  const authority = dropAuthority({ linked: !!place, owns: owns(place), regionOwns: owns(region), canCreate });
  const target = authority === "place" ? place : authority === "create" ? await scenes.createLocationForRegion(region, { render: false }) : null;
  if (!target) return refused(none);
  await addThingTo(target, thingOfDrop(kind, drop, { point }));
  return { ok: true };
}

/**
 * Add the Place row to every Region window its viewer owns, take a hazard
 * dragged onto the map into the place under it, and answer a Player's relayed
 * drop on the Judge's client. The hook always answers true: the work is async,
 * and a returned promise would read as a truthy "handled" to core.
 */
export function installRegionPlaceRow() {
  registerHandler(PLACE_DROP_HANDLER, (payload) => placeDropRelay(payload));
  Hooks.on("renderRegionConfig", (app) => mountRegionPlaceRow(app));
  Hooks.on("dropCanvasData", (canvasRef, data) => {
    if (data?.type === "Item" && data.uuid) {
      report(dropOnMapPlace({ scene: canvasRef?.scene, data }), "map place drop");
    }
    return true;
  });
}
