/* global game, ui, foundry, Actor, Hooks */
/**
 * The GM's storage manager — the tool that makes vaults optional.
 *
 * The sweep gives every character with banked coin a vault of their own, which
 * is safe but not what most tables want long-term ("the party keeps its money at
 * the Rusty Anchor"). This is where a GM merges some or all of one place's
 * holdings into another — existing or newly made — reassigns whose goods are
 * whose, and turns storage on for any actor at all.
 *
 * Writes go direct: this is a GM tool, no sockets. Two GMs driving it at once is
 * last-write-wins on distinct items, which is documented rather than defended
 * against — the socket-and-claim-token machinery exists for player-triggered
 * flows, not for two people sharing one admin screen.
 */
import { makeLoc, libStorage as storage } from "../../lib/util.mjs";
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE } from "../constants.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;
const { DialogV2 } = foundry.applications.api;

const loc = makeLoc(LANG_PREFIX);

/**
 * GM tool for goods held across every provider in the world: which actor holds
 * what, whose it is, and the reassign / release actions for attribution that has
 * gone stale (a deleted owner, goods stored before attribution existed).
 */
export class StorageManager extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-location-storage-manager",
    classes: ["acks-ui", "acks-extras", "acks-location-manager"],
    position: { width: 780, height: 700 },
    window: { title: `${LANG_PREFIX}.manager.title`, resizable: true, icon: "fas fa-warehouse" },
    actions: {
      selectPlace: StorageManager.#onSelectPlace,
      toggleAll: StorageManager.#onToggleAll,
      move: StorageManager.#onMove,
      reassign: StorageManager.#onReassign,
      returnToOwners: StorageManager.#onReturnToOwners,
      enableStorage: StorageManager.#onEnableStorage,
      openPlace: StorageManager.#onOpenPlace,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/location/storage-manager.hbs`, scrollable: [".acks-location-manager-goods"] },
  };

  /** uuid of the place being managed. */
  #placeUuid = null;

  /** itemId → quantity (null = whole stack). Survives re-renders; pruned each time. */
  #selection = new Map();

  constructor(options = {}) {
    super(options);
    this.#placeUuid = options.placeUuid ?? null;
  }

  get place() {
    return storage().resolveActorSync(this.#placeUuid);
  }

  /** @override */
  async _prepareContext() {
    const api = storage();
    const all = api.providers();
    if (!this.place && all.length) this.#placeUuid = all[0].uuid;
    const place = this.place;

    // A selection can outlive the item it names (another client retrieved it).
    if (place) {
      const live = new Set(place.items.map((i) => i.id));
      for (const id of [...this.#selection.keys()]) if (!live.has(id)) this.#selection.delete(id);
    }

    const groups = [];
    if (place) {
      for (const bucket of api.storesByOwner(place).values()) {
        const owner = api.resolveActorSync(bucket.ownerUuid);
        groups.push({
          ownerUuid: bucket.ownerUuid,
          name: owner?.name || bucket.ownerName || loc("storage.unattributed"),
          dangling: !owner,
          coinGC: api.coinTotalGC(bucket.items),
          rows: bucket.items.map((item) => {
            const qty = api.quantityOf(item)?.value ?? null;
            return {
              id: item._id,
              name: item.name,
              img: item.img,
              quantity: qty,
              stackable: qty != null,
              checked: this.#selection.has(item._id),
              take: this.#selection.get(item._id) ?? "",
            };
          }),
        });
      }
      groups.sort((a, b) => a.name.localeCompare(b.name));
    }

    return {
      places: all.map((p) => ({
        uuid: p.uuid,
        name: p.name,
        img: p.img,
        isVault: !!api.vaultOwnerUuid(p),
        active: p.uuid === this.#placeUuid,
        count: api.storedItems(p).length,
      })),
      place: place ? { uuid: place.uuid, name: place.name, isVault: !!api.vaultOwnerUuid(place) } : null,
      groups,
      empty: !groups.length,
      targets: all.filter((p) => p.uuid !== this.#placeUuid).map((p) => ({ uuid: p.uuid, name: p.name })),
      owners: game.actors.filter((a) => a.type === "character").map((a) => ({ uuid: a.uuid, name: a.name })),
      selected: this.#selection.size,
    };
  }

  /** @override */
  _onRender(context, options) {
    super._onRender(context, options);
    const root = this.element;
    // The selection lives on the instance, not the DOM, so re-renders (which
    // item writes trigger constantly) never lose what the GM has ticked.
    for (const box of root.querySelectorAll(".acks-location-manager-goods input[type=checkbox][data-item-id]")) {
      box.addEventListener("change", (event) => {
        const id = event.currentTarget.dataset.itemId;
        if (event.currentTarget.checked) this.#selection.set(id, this.#selection.get(id) ?? null);
        else this.#selection.delete(id);
        this.#updateCount();
      });
    }
    for (const input of root.querySelectorAll(".acks-location-manager-goods input[data-quantity-for]")) {
      input.addEventListener("change", (event) => {
        const id = event.currentTarget.dataset.quantityFor;
        if (!this.#selection.has(id)) return;
        const raw = event.currentTarget.value;
        this.#selection.set(id, raw === "" ? null : Number(raw));
      });
    }
    root.querySelector("select[name=target]")?.addEventListener("change", (event) => {
      root.querySelector(".acks-location-manager-newname")?.classList.toggle("hidden", event.currentTarget.value !== "__new__");
    });
  }

  #updateCount() {
    const el = this.element?.querySelector(".acks-location-manager-count");
    if (el) el.textContent = String(this.#selection.size);
  }

  /** The picked rows as a transfer spec. */
  #spec() {
    return [...this.#selection.entries()].map(([id, quantity]) => ({ id, quantity }));
  }

  static #onSelectPlace(_event, target) {
    this.#placeUuid = target.closest("[data-place-uuid]")?.dataset.placeUuid ?? this.#placeUuid;
    this.#selection.clear();
    this.render();
  }

  static #onOpenPlace() {
    this.place?.sheet?.render(true);
  }

  static #onToggleAll(_event, target) {
    const ownerUuid = target.closest("[data-owner-uuid]")?.dataset.ownerUuid;
    const rows = storage().storedItems(this.place, { ownerUuid });
    const allPicked = rows.every((i) => this.#selection.has(i.id));
    for (const item of rows) {
      if (allPicked) this.#selection.delete(item.id);
      else this.#selection.set(item.id, this.#selection.get(item.id) ?? null);
    }
    this.render();
  }

  /** Merge the picked goods into another place — attribution comes along. */
  static async #onMove() {
    const spec = this.#spec();
    if (!spec.length) {
      ui.notifications.warn(loc("manager.nothingPicked"));
      return;
    }
    const root = this.element;
    const choice = root.querySelector("select[name=target]")?.value;
    if (!choice) {
      ui.notifications.warn(loc("manager.noTarget"));
      return;
    }

    let target;
    if (choice === "__new__") {
      const name = root.querySelector("input[name=newName]")?.value?.trim();
      if (!name) {
        ui.notifications.warn(loc("manager.noName"));
        return;
      }
      target = await Actor.create({ name, type: LOCATION_TYPE, img: "icons/svg/village.svg" });
    } else {
      target = storage().resolveActorSync(choice);
    }
    if (!target) return;

    const result = await storage().moveStored(this.place, target, spec);
    if (result?.ok) {
      ui.notifications.info(loc("manager.moved", { count: result.manifest.length, place: target.name }));
      this.#selection.clear();
    }
    this.render();
  }

  /** Give the picked goods to a different character — the cure for a dangling owner. */
  static async #onReassign() {
    const spec = this.#spec();
    if (!spec.length) {
      ui.notifications.warn(loc("manager.nothingPicked"));
      return;
    }
    const owners = game.actors.filter((a) => a.type === "character");
    if (!owners.length) return;

    const options = owners.map((a) => `<option value="${a.uuid}">${foundry.utils.escapeHTML(a.name)}</option>`).join("");
    const uuid = await DialogV2.prompt({
      window: { title: loc("manager.reassign") },
      classes: ["acks-extras"],
      content: `<p>${loc("manager.reassignPrompt", { count: spec.length })}</p>
        <select name="owner" style="width:100%">${options}</select>`,
      ok: { label: loc("manager.reassign"), callback: (_e, button) => button.form.elements.owner.value },
    }).catch(() => null);
    if (!uuid) return;

    const owner = storage().resolveActorSync(uuid);
    if (!owner) return;
    await this.place.updateEmbeddedDocuments(
      "Item",
      spec.map(({ id }) => ({
        _id: id,
        "flags.acks-extras.storage": { ownerUuid: owner.uuid, ownerName: owner.name },
      })),
    );
    // Reassigning can leave the same character holding two rows of one coin.
    await storage().consolidateMoney(this.place, owner.uuid);
    ui.notifications.info(loc("manager.reassigned", { count: spec.length, name: owner.name }));
    this.#selection.clear();
    this.render();
  }

  /** Hand the picked goods back to whoever they belong to. */
  static async #onReturnToOwners() {
    const spec = this.#spec();
    if (!spec.length) {
      ui.notifications.warn(loc("manager.nothingPicked"));
      return;
    }
    const api = storage();
    const byOwner = new Map();
    for (const { id, quantity } of spec) {
      const uuid = api.ownerOf(this.place.items.get(id))?.uuid;
      const owner = api.resolveActorSync(uuid);
      if (!owner) continue;
      if (!byOwner.has(uuid)) byOwner.set(uuid, { owner, spec: [] });
      byOwner.get(uuid).spec.push({ id, quantity });
    }
    if (!byOwner.size) {
      ui.notifications.warn(loc("manager.noLivingOwners"));
      return;
    }
    for (const { owner, spec: theirs } of byOwner.values()) await api.retrieve(this.place, owner, theirs);
    ui.notifications.info(loc("manager.returned", { count: byOwner.size }));
    this.#selection.clear();
    this.render();
  }

  /** Turn any actor into a place that holds goods — a wagon, a stronghold, a market. */
  static async #onEnableStorage() {
    const api = storage();
    const candidates = game.actors.filter((a) => !api.isProvider(a) && a.type !== "character");
    if (!candidates.length) {
      ui.notifications.warn(loc("manager.nothingToEnable"));
      return;
    }
    const options = candidates
      .map((a) => `<option value="${a.uuid}">${foundry.utils.escapeHTML(a.name)} (${a.type})</option>`)
      .join("");
    const uuid = await DialogV2.prompt({
      window: { title: loc("manager.enable") },
      classes: ["acks-extras"],
      content: `<p>${loc("manager.enablePrompt")}</p><select name="actor" style="width:100%">${options}</select>`,
      ok: { label: loc("manager.enable"), callback: (_e, button) => button.form.elements.actor.value },
    }).catch(() => null);
    if (!uuid) return;
    const actor = api.resolveActorSync(uuid);
    if (!actor) return;
    await api.setProvider(actor, true);
    ui.notifications.info(loc("manager.enabledOn", { name: actor.name }));
    this.#placeUuid = actor.uuid;
    this.render();
  }
}

let instance = null;

/** Open the manager, focused on a place if one is given. */
export function openStorageManager(place = null) {
  if (!game.user.isGM) {
    ui.notifications.warn(loc("manager.gmOnly"));
    return null;
  }
  if (instance?.rendered) {
    if (place) {
      instance.close();
      instance = null;
    } else {
      instance.bringToFront();
      return instance;
    }
  }
  instance = new StorageManager({ placeUuid: place?.uuid ?? null });
  instance.render(true);
  return instance;
}

/**
 * Settings-menu entry point. Foundry builds its own instance for a menu, so this
 * hands off to (or becomes) the singleton — one manager per world, however it
 * was opened.
 */
export class StorageManagerMenu extends StorageManager {
  async render(...args) {
    if (instance && instance !== this && instance.rendered) {
      instance.bringToFront();
      return this;
    }
    instance = this;
    return super.render(...args);
  }
}

/** Keep an open manager honest when goods move underneath it. */
export function installManagerRefresh() {
  const hooks = storage()?.STORAGE_HOOKS ?? {};
  for (const name of [hooks.STASHED, hooks.RETRIEVED, hooks.MOVED, hooks.PROVIDER_CHANGED]) {
    if (name) Hooks.on(name, () => instance?.rendered && instance.render(false));
  }
}
