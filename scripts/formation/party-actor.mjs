/* global game, foundry */
import { MODULE_ID } from "./constants.mjs";
import { SHARED_ACTIONS, bindMemberDrop, onChangeForm } from "./formation-actions.mjs";
import { getFormations } from "./formation-model.mjs";
import { buildFormationView, buildGMExtras, buildPlayerPanel } from "./formation-view.mjs";
import { acksCompatStubs } from "../lib/actor-compat.mjs";

/**
 * The dedicated "party" actor sub-type backing party tokens, and its sheet.
 * The sheet renders the SAME shared formation body as the formation manager
 * window — one UI, with GM-only controls hidden from players and a
 * declaration panel for member-owning players.
 */

export const PARTY_TYPE = `${MODULE_ID}.party`;

/**
 * A party actor holds almost NO data of its own — the formation record does.
 * Its schema is the compatibility stub every non-character sub-type needs so
 * the acks system's unguarded per-actor compute (isNew, thac0, initiative,
 * movement, saves.implements|wand) does not error on it. That set has one home
 * now: acks-lib's acksCompatStubs().
 *
 * NOTE this used to carry six saves (the legacy breath/wand names among them)
 * and a hand-rolled movement block, plus a local `save` helper. The extra saves
 * were never read — a party does not save on its own; rollPartySave reads each
 * MEMBER's saves — so folding to the canonical drops them.
 *
 * Movement is re-declared for two party-specific reasons the shared stub can't
 * carry: `base` defaults to a human's 120 (synced from members on the first
 * formation sync), where the stub's 0 is right for a settlement/domain; and
 * `value` holds the "N'/turn (exploration)" label formation-model.mjs writes.
 * `mod` is deliberately absent — the system only reads movement.mod in
 * _calculateMovement, which runs off computeEncumbrance, which bails on
 * type !== "character" (actor.mjs), so a party never touches it: dead field,
 * not carried.
 */
export class PartyData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    const { NumberField, SchemaField, StringField } = foundry.data.fields;
    return {
      ...acksCompatStubs(),
      movement: new SchemaField({
        base: new NumberField({ required: true, integer: true, initial: 120 }),
        value: new StringField({ required: true, blank: true, initial: "" }),
        encounter: new NumberField({ required: true, integer: true, initial: 0 }),
      }),
    };
  }
}

/** The formation record backed by a given party actor. */
export function formationForActor(actor) {
  if (!actor) return null;
  return Object.values(getFormations()).find((f) => f.actorId === actor.id) ?? null;
}

const { HandlebarsApplicationMixin } = foundry.applications.api;

export class PartySheet extends HandlebarsApplicationMixin(foundry.applications.sheets.ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-formation", "party-sheet"],
    position: { width: 540, height: 700 },
    window: { resizable: true },
    // Replace the document sheet's submit pipeline: form inputs configure the
    // FORMATION record (rename, table), never the actor document itself.
    form: {
      submitOnChange: true,
      closeOnSubmit: false,
      handler: onChangeForm,
    },
    actions: { ...SHARED_ACTIONS },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/formation/formation-body.hbs`, scrollable: [""] },
  };

  /** Re-render all open party sheets (called on any formation change). */
  static refreshAll() {
    for (const app of foundry.applications.instances.values()) {
      if (app instanceof PartySheet && app.rendered) app.render();
    }
  }

  get formation() {
    return formationForActor(this.actor);
  }

  /**
   * The sheet's form is interactive for the GM and for any player who owns a
   * MEMBER of the formation — decoupled from ownership of the party actor
   * itself. Foundry force-disables every control in the window when a sheet is
   * not editable (DocumentSheetV2#_toggleDisabled), which would grey out a
   * member-owner's own reorder/role/light controls just because the party
   * actor grants them only Observer. Per-control gating (`canControl` in the
   * view) remains the authority over WHICH controls each user may touch; this
   * getter only decides whether the window is live at all.
   */
  get isEditable() {
    if (super.isEditable) return true;
    const formation = this.formation;
    if (!formation) return false;
    return formation.members.some((m) => {
      const actor = m?.actorId ? game.actors.get(m.actorId) : null;
      return actor?.testUserPermission(game.user, "OWNER") ?? false;
    });
  }

  /** @override */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const formation = this.formation;
    context.isGM = game.user.isGM;
    context.formation = formation;
    if (!formation) return context;
    Object.assign(context, buildFormationView(formation));
    if (context.isGM) Object.assign(context, buildGMExtras(formation));
    else Object.assign(context, buildPlayerPanel(formation));
    return context;
  }

  /** Preserve the window-content scroll position across live re-renders. */
  #scrollTop = 0;

  /** @override */
  async _preRender(context, options) {
    await super._preRender(context, options);
    this.#scrollTop = this.element?.querySelector(".window-content")?.scrollTop ?? this.#scrollTop;
  }

  /** @override */
  async _onRender(context, options) {
    await super._onRender(context, options);
    bindMemberDrop(this);
    const content = this.element?.querySelector(".window-content");
    if (content && this.#scrollTop) content.scrollTop = this.#scrollTop;
  }
}
