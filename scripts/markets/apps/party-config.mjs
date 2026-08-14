/* global game, ui, foundry */
/**
 * PartyConfigApp — the GM's roster editor for market parties. Availability
 * is per party (RR §IV.3); with no rosters every PC (and their henchmen)
 * trades as one implicit party. Explicit rosters split the table: each
 * party ledgers separately and sizes the 12+-adventurer rule from its own
 * members plus their henchmen.
 */
import { MODULE_ID, LANG } from "../constants.mjs";
import { getSetting } from "../settings.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

const { HandlebarsApplicationMixin, ApplicationV2 } = foundry.applications.api;

export class PartyConfigApp extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: "acks-extras-markets-parties",
    tag: "form",
    classes: ["acks-ui", "acks-extras", "acks-extras-markets-dialog"],
    position: { width: 480, height: "auto" },
    window: { resizable: true },
    form: { handler: PartyConfigApp.#onSubmit, closeOnSubmit: true },
    actions: {
      addParty: PartyConfigApp.#onAddParty,
      removeParty: PartyConfigApp.#onRemoveParty,
    },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/markets/party-config.hbs` },
  };

  get title() {
    return game.i18n.localize(`${LANG}.parties.title`);
  }

  /** Working copy, edited across renders until saved. */
  #parties = null;

  #load() {
    if (!this.#parties) {
      const stored = getSetting("marketParties");
      this.#parties = Array.isArray(stored) ? foundry.utils.deepClone(stored) : [];
    }
    return this.#parties;
  }

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const characters = game.actors.filter((a) => a.type === ACTOR_TYPE.character && !a.system?.retainer?.enabled);
    context.parties = this.#load().map((p, index) => ({
      index,
      name: p.name ?? p.id,
      members: characters.map((a) => ({
        uuid: a.uuid,
        name: a.name,
        checked: (p.memberUuids ?? []).includes(a.uuid),
      })),
    }));
    context.empty = !context.parties.length;
    return context;
  }

  static #onAddParty() {
    const parties = this.#load();
    parties.push({ id: foundry.utils.randomID(8), name: `Party ${parties.length + 1}`, memberUuids: [] });
    this.render();
  }

  static #onRemoveParty(_event, target) {
    const parties = this.#load();
    parties.splice(Number(target?.dataset?.index ?? -1), 1);
    this.render();
  }

  static async #onSubmit(_event, _form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const parties = this.#load().map((p, i) => ({
      id: p.id,
      name: String(data.parties?.[i]?.name ?? p.name ?? p.id),
      memberUuids: Object.entries(data.parties?.[i]?.members ?? {})
        .filter(([, on]) => on)
        .map(([k]) => k.replace(/\|/g, ".")),
    }));
    await game.settings.set(MODULE_ID, "marketParties", parties);
    ui.notifications.info(game.i18n.localize(`${LANG}.parties.saved`));
  }
}
