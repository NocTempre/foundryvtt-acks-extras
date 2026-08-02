/* global game, ui, foundry, Actor, TextEditor */
/**
 * LocationSheet — the sheet for `acks-location.location`.
 *
 * A place, and what is kept there. Goods are grouped by whose they are, because
 * a warehouse holding three characters' gear is three inventories in one actor,
 * not one shared pile — and because that grouping is what the character sheet's
 * storage tab is the other half of.
 *
 * Retrieval is offered on the rows a user can actually claim: their own
 * characters' goods, or everything for a GM. That is a UI convention and not a
 * security boundary (acks-lib's storage header makes the same ruling) — anything
 * that must genuinely stay private belongs on a GM-owned actor.
 */
import { MODULE_ID, LANG_PREFIX, LOCATION_TYPE } from "../constants.mjs";
import { openStashDialog } from "./stash-dialog.mjs";

const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

const storage = () => globalThis.acksExtras.lib.storage;
const loc = (key, data = {}) => game.i18n.format(`${LANG_PREFIX}.${key}`, data);

export class LocationSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // `acks-ui` opts this window into the library's vendored ACKS design layer;
    // the rest are our own scoped hooks.
    classes: ["acks-ui", "acks-extras", "acks-location-sheet"],
    position: { width: 620, height: 640 },
    window: { resizable: true },
    form: { submitOnChange: true },
    actions: {
      retrieveRow: LocationSheet.#onRetrieveRow,
      retrieveAll: LocationSheet.#onRetrieveAll,
      depositHere: LocationSheet.#onDepositHere,
      openManager: LocationSheet.#onOpenManager,
      openOwner: LocationSheet.#onOpenOwner,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/location/location-sheet.hbs` },
  };

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const api = storage();

    context.actor = actor;
    context.system = actor.system;
    context.fields = actor.system.schema.fields;
    context.isGM = game.user.isGM;
    context.editable = this.isEditable;
    context.vaultOwner = api.resolveActorSync(api.vaultOwnerUuid(actor))?.name ?? null;
    context.notesHTML = await TextEditor.implementation.enrichHTML(actor.system.notes ?? "", { relativeTo: actor });

    // The characters this user could stash FROM — the deposit button is
    // pointless (and its dialog empty) without one.
    context.canDeposit = game.actors.some((a) => a.type === "character" && a.isOwner);

    const groups = [];
    for (const bucket of api.storesByOwner(actor).values()) {
      const owner = api.resolveActorSync(bucket.ownerUuid);
      groups.push({
        ownerUuid: bucket.ownerUuid,
        // A deleted owner keeps their name on the goods — that is exactly why
        // the name is stored alongside the uuid. The GM's manager reassigns it.
        name: owner?.name || bucket.ownerName || loc("storage.unattributed"),
        dangling: !owner,
        canTake: game.user.isGM || !!owner?.isOwner,
        coinGC: api.coinTotalGC(bucket.items),
        rows: bucket.items.map((item) => ({
          id: item._id,
          name: item.name,
          img: item.img,
          type: item.type,
          quantity: api.quantityOf(item)?.value ?? null,
          stackable: !!api.quantityOf(item),
        })),
      });
    }
    groups.sort((a, b) => a.name.localeCompare(b.name));
    context.groups = groups;
    context.empty = !groups.length;
    return context;
  }

  /** The character this user is taking goods back to. */
  #claimant(ownerUuid) {
    const owner = storage().resolveActorSync(ownerUuid);
    if (owner?.isOwner) return owner;
    if (!game.user.isGM) return null;
    // A GM claiming for a deleted owner has nowhere to send the goods; the
    // manager's reassign is the cure, so say that rather than failing silently.
    return owner ?? null;
  }

  #rowContext(target) {
    const row = target.closest("[data-item-id]");
    const group = target.closest("[data-owner-uuid]");
    return { itemId: row?.dataset.itemId ?? null, ownerUuid: group?.dataset.ownerUuid ?? "" };
  }

  static async #onRetrieveRow(_event, target) {
    const { itemId, ownerUuid } = this.#rowContext(target);
    const owner = this.#claimant(ownerUuid);
    if (!itemId) return;
    if (!owner) {
      ui.notifications.warn(loc("storage.noClaimant"));
      return;
    }
    const input = target.closest(".acks-location-row")?.querySelector("input[data-quantity]");
    const quantity = input?.value === "" || input == null ? null : Number(input.value);
    await storage().retrieve(this.actor, owner, [{ id: itemId, quantity }]);
    this.render();
  }

  static async #onRetrieveAll(_event, target) {
    const ownerUuid = target.closest("[data-owner-uuid]")?.dataset.ownerUuid ?? "";
    const owner = this.#claimant(ownerUuid);
    if (!owner) {
      ui.notifications.warn(loc("storage.noClaimant"));
      return;
    }
    const spec = storage()
      .storedItems(this.actor, { ownerUuid })
      .map((i) => ({ id: i.id }));
    if (!spec.length) return;
    await storage().retrieve(this.actor, owner, spec);
    this.render();
  }

  static async #onDepositHere() {
    const mine = game.actors.filter((a) => a.type === "character" && a.isOwner);
    if (!mine.length) {
      ui.notifications.warn(loc("storage.noCharacter"));
      return;
    }
    await openStashDialog(mine, this.actor);
    this.render();
  }

  static async #onOpenManager() {
    const { openStorageManager } = await import("./storage-manager.mjs");
    openStorageManager(this.actor);
  }

  static async #onOpenOwner(_event, target) {
    const uuid = target.closest("[data-owner-uuid]")?.dataset.ownerUuid;
    storage().resolveActorSync(uuid)?.sheet?.render(true);
  }

  /**
   * Dropping an item from another actor STORES it here — a real move, not the
   * system's copy. Core's drop handler creates on the target and never deletes
   * from the source, which for a location would quietly duplicate the party's
   * gear, so this path never falls through to it.
   */
  async _onDropItem(event, item) {
    const source = item?.parent;
    if (!source || source.documentName !== "Actor") {
      // A compendium or sidebar item is not anybody's property yet; there is no
      // owner to attribute it to. GMs stock a location through the item
      // directory onto the actor directly.
      ui.notifications.warn(loc("storage.dropNeedsOwner"));
      return null;
    }
    if (source.uuid === this.actor.uuid) return null;
    await storage().stash(source, this.actor, [{ id: item.id }]);
    this.render();
    return null;
  }

  /** Locations do not employ people through this sheet — that is henchmen's. */
  async _onDropActor() {
    return null;
  }
}

/** Register the sheet as the default for our own actor type. */
export function registerLocationSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, LocationSheet, {
    types: [LOCATION_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.location`,
  });
}
