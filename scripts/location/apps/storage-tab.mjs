/* global game, ui, foundry, Hooks */
/**
 * The character sheet's Storage tab, and the retirement of the bank column.
 *
 * WHY THE BANK COLUMN GOES. The system keeps banked coin as a second number on
 * each money item (`system.quantitybank`) — money that is somehow yours, weighs
 * nothing, and is nowhere. Once coin can be kept at a place, that column is a
 * competing answer to the same question and the two would drift the first time a
 * player used both. So it is removed from the inventory tab and replaced by a
 * line summarising what is really in storage; the sweep (vault-sweep.mjs) moves
 * the old values into a vault so nothing is lost.
 *
 * WHY DOM INJECTION AND NOT A SHEET SUBCLASS. The core sheet declares its tabs
 * as statics and the system is an unmodifiable reference; a subclass would fight
 * every other module that wants a tab. The family's shipped pattern (acks-
 * formation's skill audit) injects on render and REBUILDS EVERY TIME rather than
 * latching: ApplicationV2 replaces its parts on re-render, so the nav anchor is
 * destroyed while an injected section (not being a part) survives — removing
 * both and re-adding them is what keeps the two halves consistent.
 */
import { makeLoc, libStorage as storage, ownsSheet } from "../../lib/util.mjs";
import { MODULE_ID, LANG_PREFIX, STORAGE_TAB_ID } from "../constants.mjs";
import { openStashDialog } from "./stash-dialog.mjs";
import { depositReach, pinnedPlaces, setPinnedPlace } from "../reach.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../../lib/vocab.mjs";

const ANCHOR_CLASS = "acks-location-storage-anchor";
const TAB_CLASS = "acks-location-storage-tab";
const SUMMARY_CLASS = "acks-location-coin-summary";
const TEMPLATE = `modules/${MODULE_ID}/templates/location/storage-tab.hbs`;

const loc = makeLoc(LANG_PREFIX);

/* -------------------------------------------- */
/*  Data — one world scan per render             */
/* -------------------------------------------- */

function collect(actor) {
  const api = storage();
  const held = api.providersFor(actor);
  const entry = (provider, items, coinGC) => {
    // `canReach` decides whether the DEPOSIT control is offered. Retrieval is
    // deliberately not gated by it (reach.mjs): a player who cannot reach
    // their own belongings at all is a worse failure than one who withdraws
    // from a distance.
    const reach = depositReach(actor, provider);
    return {
    uuid: provider.uuid,
    name: provider.name,
    img: provider.img,
    isVault: !!api.vaultOwnerUuid(provider),
    canReach: reach.can,
    reachReason: reach.can ? null : loc(`storage.reach.${reach.reason}`, { scene: reach.scene?.name ?? "" }),
    coinGC,
    rows: items.map((item) => {
      const qty = api.quantityOf(item.toObject())?.value ?? null;
      return { id: item.id, name: item.name, img: item.img, quantity: qty, stackable: qty != null };
    }),
    };
  };

  const places = held.map(({ provider, items, coinGC }) => entry(provider, items, coinGC));
  // Places with nothing of yours at them yet still belong here — otherwise
  // there is nowhere to put the first thing. Reachable ones, and the ones
  // pinned to this sheet, which is what pinning is FOR.
  const pinned = pinnedPlaces(actor);
  const empty = api
    .providers()
    .filter((p) => !places.some((e) => e.uuid === p.uuid) && (p.isOwner || pinned.has(p.uuid) || depositReach(actor, p).can))
    .map((p) => entry(p, [], 0));

  return {
    places: [...places, ...empty],
    anywhere: places.length + empty.length > 0,
    hasGoods: places.length > 0,
    coinGC: places.reduce((sum, p) => sum + p.coinGC, 0),
    placeCount: places.length,
  };
}

/* -------------------------------------------- */
/*  Injection                                    */
/* -------------------------------------------- */

const clear = (root) => {
  for (const el of root.querySelectorAll(`.${ANCHOR_CLASS}, .${TAB_CLASS}, .${SUMMARY_CLASS}`)) el.remove();
};

/** The retired bank column: one class covers the header cell and every row. */
const stripBankColumn = (root) => {
  for (const cell of root.querySelectorAll('.tab[data-tab="inventory"] .money__count-bank')) cell.remove();
};

/**
 * Is there anywhere in the world to keep coin at all? Nothing about banked coin
 * is retired before storage exists to replace it.
 */
const worldHasStorage = () => !!storage()?.providers?.().length;

function injectSummary(root, data) {
  if (!data.hasGoods) return;
  const header = root.querySelector('.tab[data-tab="inventory"] .money__count')?.closest(".item-list-section")?.querySelector(".list-header");
  if (!header) return;
  const line = document.createElement("div");
  line.className = SUMMARY_CLASS;
  // A plain tab anchor: Foundry's own delegated action switches tabs, so this
  // needs no listener of ours and cannot go stale.
  line.innerHTML = `<a data-action="tab" data-group="primary" data-tab="${STORAGE_TAB_ID}">
      <i class="fas fa-warehouse"></i> ${loc("storage.summary", { gp: data.coinGC, places: data.placeCount })}
    </a>`;
  header.after(line);
}

function injectTab(app, root, actor, html) {
  const nav = root.querySelector("nav.tabs");
  const sections = root.querySelectorAll('section.tab[data-group="primary"]');
  if (!nav || !sections.length) return;

  const active = app.tabGroups?.primary === STORAGE_TAB_ID;

  const anchor = document.createElement("a");
  anchor.className = `${ANCHOR_CLASS}${active ? " active" : ""}`;
  anchor.dataset.action = "tab";
  anchor.dataset.group = "primary";
  anchor.dataset.tab = STORAGE_TAB_ID;
  anchor.innerHTML = `<i class="fa-solid fa-warehouse" inert></i><span>${loc("storage.tab")}</span>`;
  nav.appendChild(anchor);

  const section = document.createElement("section");
  section.className = `tab ${TAB_CLASS}${active ? " active" : ""}`;
  section.dataset.group = "primary";
  section.dataset.tab = STORAGE_TAB_ID;
  section.innerHTML = html;
  sections[sections.length - 1].after(section);
  section.addEventListener("click", (event) => onAction(event, actor));
}

/** The tab is gone this render; if it was showing, put the sheet somewhere real. */
function restoreTab(app) {
  if (app.tabGroups?.primary !== STORAGE_TAB_ID) return;
  try {
    app.changeTab("inventory", "primary", { force: true });
  } catch (err) {
    console.warn(`${MODULE_ID} | could not restore the inventory tab`, err);
  }
}

/* -------------------------------------------- */
/*  Actions (our own attribute — core never sees them) */
/* -------------------------------------------- */

async function onAction(event, actor) {
  const button = event.target.closest("[data-acksl-action]");
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();

  const api = storage();
  const place = api.resolveActorSync(button.closest("[data-place-uuid]")?.dataset.placeUuid);
  if (!place) {
    ui.notifications.warn(loc("storage.placeGone"));
    return;
  }

  switch (button.dataset.ackslAction) {
    case "openLocation":
      place.sheet?.render(true);
      break;
    case "deposit":
      await openStashDialog(actor, place);
      break;
    case "retrieveAll": {
      const spec = api.storedItems(place, { ownerUuid: actor.uuid }).map((i) => ({ id: i.id }));
      if (spec.length) await api.retrieve(place, actor, spec);
      break;
    }
    case "retrieve": {
      const row = button.closest("[data-item-id]");
      if (!row?.dataset.itemId) break;
      const raw = row.querySelector("input[data-quantity]")?.value ?? "";
      await api.retrieve(place, actor, [{ id: row.dataset.itemId, quantity: raw === "" ? null : Number(raw) }]);
      break;
    }
    default:
      break;
  }
}

/**
 * Dropping a PLACE on a character's sheet pins it to them.
 *
 * The third way to reach an unlinked place (reach.mjs): a wagon, a cellar or a
 * caravan a character has standing access to without owning it and without
 * standing on its map. Dropping the location actor onto the sheet records it;
 * the Storage tab then offers it like any place they can reach.
 *
 * Capture phase, so the core sheet's own drop handler never tries to embed a
 * location actor as an owned item.
 */
function bindPlaceDrop(root, actor) {
  if (root.dataset.acksPlaceDrop) return;
  root.dataset.acksPlaceDrop = "1";
  root.addEventListener(
    "drop",
    (event) => {
      let data;
      try {
        data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
      } catch {
        return;
      }
      if (data?.type !== "Actor" || !data.uuid) return;
      const dropped = storage()?.resolveActorSync?.(data.uuid);
      if (!dropped || !storage()?.isProvider?.(dropped)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      setPinnedPlace(actor, dropped.uuid, true)
        .then(() => {
          ui.notifications.info(loc("storage.pinned", { name: dropped.name }));
          refresh(actor);
        })
        .catch((err) => console.error(`${MODULE_ID} | pinning a place failed`, err));
    },
    { capture: true },
  );
}

/* -------------------------------------------- */
/*  Install                                      */
/* -------------------------------------------- */

/** Our sheet parts are injected, so a re-render IS the refresh. */
function refresh(actor) {
  for (const app of Object.values(actor?.apps ?? {})) app.render(false);
}

export function installStorageTab() {
  let epoch = 0;

  Hooks.on("renderActorSheetV2", async (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      const actor = app.actor ?? app.document;
      if (actor?.type !== ACTOR_TYPE.character) return;
      // The module's own character sheet lists storage under its Equipment
      // tab's "Kept elsewhere" rule; this tab dresses the system's sheet alone.
      if (ownsSheet(app)) return;
      const root = element instanceof HTMLElement ? element : element?.[0];
      // The core sheet has a primary tab strip; the Follower Card and our own
      // location sheet do not, and neither wants one bolted on.
      if (!root?.querySelector("nav.tabs") || !root.querySelector('section.tab[data-group="primary"]')) return;

      // Rendering the tab body is async and a second render can start while we
      // await it. Only the newest pass may touch the DOM.
      const mine = ++epoch;
      const data = collect(actor);
      const html = data.anywhere ? await foundry.applications.handlebars.renderTemplate(TEMPLATE, data) : null;
      if (mine !== epoch) return;

      clear(root);
      if (!data.anywhere) {
        restoreTab(app);
        return;
      }
      injectSummary(root, data);
      injectTab(app, root, actor, html);
      bindPlaceDrop(root, actor);
      // The bank column is only removed where its replacement is injected: a
      // sheet that gets no Storage tab keeps core's column, so a world with
      // nowhere to store coin is never left with neither.
      stripBankColumn(root);
    } catch (err) {
      console.error(`${MODULE_ID} | storage tab injection failed`, err);
    }
  });

  // The money ITEM sheet carries its own bank field; retire that entry point too.
  Hooks.on("renderItemSheetV2", (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      if ((app.document ?? app.item)?.type !== ITEM_TYPE.money) return;
      // Same rule as the column: an item sheet has no storage tab to replace the
      // field with, so a world with no providers keeps core's field.
      if (!worldHasStorage()) return;
      const root = element instanceof HTMLElement ? element : element?.[0];
      root?.querySelector('[name="system.quantitybank"]')?.closest(".form-group")?.remove();
    } catch (err) {
      console.error(`${MODULE_ID} | money sheet cleanup failed`, err);
    }
  });

  // A transfer changes both ends; a deleted place must vanish from every open
  // storage tab on every client, not just the one that ran the deletion.
  const hooks = storage()?.STORAGE_HOOKS ?? {};
  for (const name of [hooks.STASHED, hooks.RETRIEVED, hooks.MOVED, hooks.RETURNED, hooks.LOST]) {
    if (!name) continue;
    Hooks.on(name, (payload) => {
      const api = storage();
      for (const uuid of [payload?.ownerUuid, payload?.sourceUuid, payload?.targetUuid]) {
        if (uuid) refresh(api.resolveActorSync(uuid));
      }
    });
  }

  Hooks.on("deleteActor", (doc) => {
    if (!storage()?.isProvider?.(doc)) return;
    for (const actor of game.actors?.filter((a) => a.type === ACTOR_TYPE.character && Object.keys(a.apps ?? {}).length) ?? []) {
      refresh(actor);
    }
  });
}
