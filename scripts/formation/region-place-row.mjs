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
 * replaces its parts, and for the Judge only.
 */
import { MODULE_ID } from "./constants.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";
import { associateLabels } from "../lib/a11y.mjs";
import { elementOf, escape as esc } from "../lib/util.mjs";
import { kindOfDrop } from "../lib/place-things-logic.mjs";
import { addThingTo, thingsOf } from "../lib/place-things.mjs";
import { countsOf, descriptorOf, refusalOfDrop, thingOfDrop } from "./region-place-logic.mjs";

const ROW = "acks-extras-region-place";
const LANG = "ACKS-FORMATION.REGION_PLACE";

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
  const places = game.actors.filter((a) => a.type === LOCATION_TYPE).sort((a, b) => a.name.localeCompare(b.name));
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
    report(Promise.resolve(actor ? scenes.linkRegion(region, actor) : scenes.unlinkRegion(region)).then(() => afterLink?.()), "place link");
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

/** The counts line: what the place holds by kind, each count carrying its names, or the none string. */
function countsLineOf(place) {
  const line = document.createElement("p");
  line.className = `${ROW}-counts`;
  const rows = place ? countsOf(thingsOf(place), nameOfRef) : [];
  if (!rows.length) {
    line.textContent = game.i18n.localize(`${LANG}.holdsNone`);
    return line;
  }
  const lead = document.createElement("span");
  lead.textContent = game.i18n.localize(`${LANG}.holds`);
  line.append(lead);
  for (const { kind, count, names } of rows) {
    const span = document.createElement("span");
    span.className = `${ROW}-count`;
    span.dataset.tooltipText = names.join(", ");
    span.textContent = game.i18n.format(`${LANG}.${kind}.${count === 1 ? "one" : "other"}`, { count });
    line.append(" ", span);
  }
  return line;
}

/**
 * Take one drop onto the region's place. Resolves the dragged document, asks
 * the one kind table what it becomes, makes the place first when the region has
 * none (without opening its sheet), and adds the thing. A drop no kind accepts
 * warns in words and writes nothing.
 *
 * @param {object} options
 * @param {RegionDocument} options.region
 * @param {object} options.scenes the location feature's `scenes` api
 * @param {{type?: string, uuid?: string}|null} options.data the drag's own data
 * @returns {Promise<object|null>} the thing's list after the write, or null
 */
export async function dropOnRegionPlace({ region, scenes, data }) {
  const warn = (key) => ui.notifications?.warn(game.i18n.localize(`${LANG}.refused.${key}`));
  const dropped = data?.type === "Item" && data.uuid ? await fromUuid(data.uuid).catch(() => null) : null;
  const drop = descriptorOf(dropped, data?.uuid);
  const kind = drop ? kindOfDrop(drop) : null;
  const refusal = refusalOfDrop(drop, kind);
  if (refusal) {
    warn(refusal);
    return null;
  }
  const place = scenes.locationOfRegion(region) ?? (await scenes.createLocationForRegion(region, { render: false }));
  if (!place) {
    warn("noPlace");
    return null;
  }
  return addThingTo(place, thingOfDrop(kind, drop));
}

/**
 * Build the row into one Region window: under the Name field on the Appearance
 * tab, which is where core 14 keeps it. Idempotent, so a render that touched
 * only some parts rebuilds it without leaving a second.
 */
function mountRegionPlaceRow(app) {
  if (!game.user?.isGM) return;
  const region = app?.document;
  const scenes = globalThis.acksExtras?.location?.scenes;
  if (!region || typeof scenes?.locationOfRegion !== "function") return;
  const root = elementOf(app.element);
  if (!root) return;
  root.querySelectorAll(`.${ROW}`).forEach((n) => n.remove());
  const tab = root.querySelector('section[data-tab="appearance"]');
  if (!tab) return;

  // A write can re-render the window and strand the nodes this closed over,
  // so a refresh finds the window's present element again rather than reusing one.
  const remount = () => mountRegionPlaceRow(app);
  const say = (key) => game.i18n.localize(`${LANG}.${key}`);
  const place = scenes.locationOfRegion(region);

  const row = document.createElement("div");
  row.className = ROW;
  const zone = document.createElement("div");
  zone.className = `${ROW}-drop`;
  zone.textContent = say("drop");
  row.append(placePickerOf({ region, scenes, say, cls: `${ROW}-picker`, afterMake: remount, afterLink: remount }), countsLineOf(place), zone);

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

/** Add the Place row to every Region window. */
export function installRegionPlaceRow() {
  Hooks.on("renderRegionConfig", (app) => mountRegionPlaceRow(app));
}
