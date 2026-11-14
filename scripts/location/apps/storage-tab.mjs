/* global game, ui, foundry, Hooks */
/**
 * The character sheet's Storage tab, and the retirement of the bank column.
 *
 * The system's bank column (`system.quantitybank` on each money item) is
 * removed from the inventory tab and replaced by a line summarising what is in
 * storage; the sweep (vault-sweep.mjs) moves any banked value to where coin is
 * kept.
 * See docs/location/DECISIONS.md, "Banked is not a state coin can be in".
 *
 * The tab is DOM injection, not a sheet subclass: the core sheet declares its
 * tabs as statics. It injects on render and rebuilds every time, because
 * ApplicationV2 replaces its parts on re-render, destroying the nav anchor
 * while an injected section (not being a part) survives; both are removed and
 * re-added to keep them consistent.
 */
import { elementOf, makeLoc, libStorage as storage, ownsSheet } from "../../lib/util.mjs";
import { MODULE_ID, LANG_PREFIX, STORAGE_TAB_ID } from "../constants.mjs";
import { openStashDialog } from "./stash-dialog.mjs";
import { depositReach, listsWhenEmpty, pinnedPlaces, reachScan, setPinnedPlace } from "../reach.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../../lib/vocab.mjs";
import { COIN_ORDER_TEMPLATE, bindCoinOrder, coinOrderView } from "../../lib/coin-order.mjs";
import { readPicks, restorePicks, spendPicks } from "../../lib/picks.mjs";

const ANCHOR_CLASS = "acks-location-storage-anchor";
const TAB_CLASS = "acks-location-storage-tab";
const SUMMARY_CLASS = "acks-location-coin-summary";
const ORDER_CLASS = "acks-extras-coin-order-line";
const TEMPLATE = `modules/${MODULE_ID}/templates/location/storage-tab.hbs`;

const loc = makeLoc(LANG_PREFIX);

/* -------------------------------------------- */
/*  Data — one world scan per render             */
/* -------------------------------------------- */

function collect(actor) {
  const api = storage();
  // One token pass for every provider below (reach.mjs `reachScan`).
  const scan = reachScan(actor);
  const held = api.providersFor(actor);
  const entry = (provider, items, coinGC) => {
    // `canReach` gates the DEPOSIT control only; retrieval is not gated (reach.mjs).
    const reach = depositReach(actor, provider, { scan });
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
  // Empty places are listed only by `reach.mjs` `listsWhenEmpty`, each with
  // its refusal where reach says no.
  const pinned = pinnedPlaces(actor);
  const empty = api
    .providers()
    .filter((p) => !places.some((e) => e.uuid === p.uuid) && listsWhenEmpty(actor, p, { scan, pinned }))
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
  for (const el of root.querySelectorAll(`.${ANCHOR_CLASS}, .${TAB_CLASS}, .${SUMMARY_CLASS}, .${ORDER_CLASS}`)) el.remove();
};

/**
 * The retired bank column: one class covers the header cell and every row,
 * on whichever tab the sheet draws its inventory.
 */
const stripBankColumn = (root) => {
  for (const cell of root.querySelectorAll(".money__count-bank")) cell.remove();
};

/**
 * The header of the coin list on the system's inventory tab, or null on a
 * sheet that draws none. Found by the count cell the header carries, since a
 * coin row inside a container carries the same cell with no header.
 */
const coinHeader = (root) =>
  root.querySelector('.tab[data-tab="inventory"] .list-header .money__count')?.closest(".list-header") ?? null;

/**
 * The coin order under the coin list's header: the lib's block, rendered by
 * the caller. It is injected after the sheet's render hooks have run, so its
 * controls are bound here.
 */
function injectCoinOrder(root, html) {
  const header = coinHeader(root);
  if (!header || !html) return;
  const line = document.createElement("div");
  line.className = ORDER_CLASS;
  line.innerHTML = html;
  header.after(line);
  bindCoinOrder(line);
}

function injectSummary(root, data) {
  if (!data.hasGoods) return;
  const header = coinHeader(root);
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

/**
 * Add the Storage tab. `picks` are the amounts typed into the previous
 * injection's retrieve boxes (`readPicks`), restored so a redraw keeps them; a
 * blank retrieves the whole stack.
 */
function injectTab(app, root, actor, html, picks) {
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
  restorePicks(section, picks);
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
      // The typed amount is a pick the render hook carries across redraws, so
      // it is read here and then spent: the retrieval has taken it.
      const pick = `qty-${row.dataset.itemId}`;
      const raw = row.querySelector(`input[data-pick="${pick}"]`)?.value ?? "";
      spendPicks(row, [pick]);
      await api.retrieve(place, actor, [{ id: row.dataset.itemId, quantity: raw === "" ? null : Number(raw) }]);
      break;
    }
    default:
      break;
  }
}

/**
 * Dropping a PLACE on a character's sheet pins it to them, one of the ways to
 * reach an unlinked place (reach.mjs). Capture phase, so the core sheet's own
 * drop handler never embeds a location actor as an owned item.
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

/** Hooks the Storage tab and the bank-column removal onto the system's actor and item sheets. */
export function installStorageTab() {
  // A second render of a sheet can start while its first awaits; only the
  // newest pass may touch its DOM.
  const epochs = new WeakMap();

  Hooks.on("renderActorSheetV2", async (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      const actor = app.actor ?? app.document;
      // The module's own sheets list storage their own way; everything below
      // dresses the system's sheets alone.
      if (ownsSheet(app)) return;
      const root = elementOf(element);
      if (!root) return;
      // The column goes from every sheet the system draws, Storage tab or not.
      stripBankColumn(root);
      // The Storage tab is a character's, on a sheet with a primary tab strip.
      const tabbed = actor?.type === ACTOR_TYPE.character && !!root.querySelector("nav.tabs") && !!root.querySelector('section.tab[data-group="primary"]');

      const mine = (epochs.get(app) ?? 0) + 1;
      epochs.set(app, mine);
      const data = tabbed ? collect(actor) : null;
      // The coin order goes wherever the system lists coin, for any actor.
      const order = actor && coinHeader(root) ? coinOrderView(actor, { places: data?.places ?? [] }) : null;
      const render = foundry.applications.handlebars.renderTemplate;
      const [html, orderHtml] = await Promise.all([
        data?.anywhere ? render(TEMPLATE, data) : null,
        order?.shown ? render(COIN_ORDER_TEMPLATE, order) : null,
      ]);
      if (epochs.get(app) !== mine) return;

      // The previous injection survives the redraw (it is not a part); its typed
      // amounts are read before it is removed.
      const picks = readPicks(root.querySelector(`.${TAB_CLASS}`));
      clear(root);
      injectCoinOrder(root, orderHtml);
      if (!data) return;
      if (!data.anywhere) {
        restoreTab(app);
        return;
      }
      injectSummary(root, data);
      injectTab(app, root, actor, html, picks);
      bindPlaceDrop(root, actor);
    } catch (err) {
      console.error(`${MODULE_ID} | storage tab injection failed`, err);
    }
  });

  // The money ITEM sheet carries its own bank field; retire that entry point too.
  Hooks.on("renderItemSheetV2", (app, element) => {
    try {
      if (game.system?.id !== "acks") return;
      if ((app.document ?? app.item)?.type !== ITEM_TYPE.money) return;
      const root = elementOf(element);
      root?.querySelector('[name="system.quantitybank"]')?.closest(".form-group")?.remove();
    } catch (err) {
      console.error(`${MODULE_ID} | money sheet cleanup failed`, err);
    }
  });

  // A transfer changes both ends; a deleted place must vanish from every
  // open storage tab on every client.
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
