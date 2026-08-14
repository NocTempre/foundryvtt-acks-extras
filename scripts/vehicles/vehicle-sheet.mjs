/* global game, foundry, ui, Actor */
/**
 * The vehicle sheet: what it is carrying, who is aboard, what is in harness,
 * and — the number the table actually asks for — how fast it is going right
 * now and what is slowing it down.
 *
 * The speed panel names its own reductions. A galley showing 165' when the
 * book says 330' is either half-manned or hungry, and a Judge should not have
 * to work out which; every factor the derivation applied is listed beside the
 * result.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { VEHICLE_TYPE } from "./constants.mjs";
import VehicleData, { VEHICLE_KINDS, DRAFT_EQUIVALENTS } from "./vehicle-data.mjs";
import { seaSpeeds, landSpeed, cargoRemaining, WIND, draftPull } from "./vehicle-speed.mjs";
import { load6 } from "../lib/capacity.mjs";
import { STONE } from "../lib/item-model.mjs";

const LANG_PREFIX = "ACKS-VEHICLES";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-vehicle"],
    position: { width: 640, height: 720 },
    window: { icon: "fa-solid fa-wagon-covered", resizable: true },
    form: { submitOnChange: true, closeOnSubmit: false },
    actions: {
      addRole: VehicleSheet.#addRole,
      removeRole: VehicleSheet.#removeRole,
      addTier: VehicleSheet.#addTier,
      removeTier: VehicleSheet.#removeTier,
      removeAnimal: VehicleSheet.#removeAnimal,
      togglePulling: VehicleSheet.#togglePulling,
    },
    dragDrop: [{ dropSelector: ".acks-extras-vehicle-team" }],
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/vehicles/vehicle-sheet.hbs`, scrollable: [""] },
  };

  /** The wind the Judge is looking at; a view choice, not stored on the boat. */
  #wind = "moderate";

  async _prepareContext() {
    const sys = this.actor.system;
    const isSea = sys.kind === "sea";

    // What is aboard, weighed the way everything else in the family weighs:
    // sixths of stone, then shown in the stone the book prints.
    const aboard6 = load6(this.actor);
    const aboardStone = aboard6 / STONE;
    const hold = cargoRemaining(sys, aboardStone);

    const speed = isSea ? seaSpeeds(sys, { wind: this.#wind }) : landSpeed(sys, aboardStone);
    const reasons = (speed.reasons ?? []).map((r) => ({
      label: game.i18n.localize(`${LANG_PREFIX}.reason.${r.key}`),
      // A factor reads better as the fraction the book prints than as 0.667.
      factor: r.factor != null ? fractionLabel(r.factor) : null,
      over: r.over,
    }));

    return {
      actor: this.actor,
      system: sys,
      isSea,
      isLand: !isSea,
      editable: this.isEditable,
      kinds: Object.entries(VEHICLE_KINDS).map(([value, k]) => ({
        value, label: game.i18n.localize(k.label), selected: value === sys.kind,
      })),
      hold: {
        ...hold,
        aboardStone: round2(aboardStone),
        free: round2(hold.free),
        over: hold.free < 0,
        // A bar reads faster than two numbers when the answer is "nearly full".
        pct: hold.capacity > 0 ? Math.min(100, Math.round((hold.used / hold.capacity) * 100)) : 0,
      },
      speed,
      reasons,
      winds: Object.entries(WIND).map(([value, w]) => ({
        value, label: game.i18n.localize(w.label), selected: value === this.#wind,
      })),
      wind: this.#wind,
      roles: (sys.crew?.roles ?? []).map((r, index) => ({
        ...r, index,
        short: r.motive && r.required > 0 && r.aboard < r.required,
      })),
      tiers: (sys.speeds?.tiers ?? []).map((t, index) => ({ ...t, index })),
      animals: (sys.team?.animals ?? []).map((a, index) => ({
        ...a, index,
        kindLabel: game.i18n.localize(`${LANG_PREFIX}.draft.${a.kind}`),
        pull: DRAFT_EQUIVALENTS[a.kind] ?? 0,
      })),
      pull: draftPull(sys),
      // A team that cannot pull what the vehicle was built for is worth
      // flagging even before a load makes it matter.
      underTeamed: !isSea && sys.team?.required > 0 && draftPull(sys) < sys.team.required,
      draftKinds: Object.keys(DRAFT_EQUIVALENTS).map((k) => ({
        value: k, label: game.i18n.localize(`${LANG_PREFIX}.draft.${k}`),
      })),
    };
  }

  /**
   * @override — reconstruct arrays before the model cleans the submit.
   *
   * The crew, tier and animal rows submit as dotted index paths
   * (`system.crew.roles.1.aboard`), which reach here as numeric-keyed OBJECTS.
   * Written straight through, an ArrayField rebuilds itself from that partial
   * object and every field the form did not name is LOST — a roster of three
   * roles comes back as two empty ones. normalize turns them back into arrays
   * first.
   */
  _prepareSubmitData(event, form, formData, updateData) {
    const data = super._prepareSubmitData(event, form, formData, updateData);
    if (data.system) data.system = VehicleData.normalize(data.system);
    return data;
  }

  /** The wind selector re-renders without touching the document. */
  async _onChangeForm(config, event) {
    if (event.target?.name === "wind") {
      this.#wind = event.target.value;
      return this.render();
    }
    return super._onChangeForm(config, event);
  }

  /**
   * An animal dropped on the team goes into harness. Bound by uuid, never
   * moved: the horse is still its own actor, standing in its own stable, and
   * a Judge who deletes the wagon has not deleted the team.
   */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type !== "Actor") return super._onDrop?.(event);
    const doc = await fromUuid(data.uuid);
    if (!doc) return;
    const animals = [...(this.actor.system.team?.animals ?? [])];
    if (animals.some((a) => a.uuid === doc.uuid)) {
      ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.alreadyInHarness`, { name: doc.name }));
      return;
    }
    animals.push({ uuid: doc.uuid, name: doc.name, kind: guessDraftKind(doc), pulling: true });
    await this.actor.update({ "system.team.animals": animals });
  }

  static async #addRole() {
    const roles = [...(this.actor.system.crew?.roles ?? []), { key: "", label: "", required: 0, aboard: 0, motive: true }];
    await this.actor.update({ "system.crew.roles": roles });
  }

  static async #removeRole(_e, target) {
    const roles = [...(this.actor.system.crew?.roles ?? [])];
    roles.splice(Number(target.dataset.index), 1);
    await this.actor.update({ "system.crew.roles": roles });
  }

  static async #addTier() {
    const tiers = [...(this.actor.system.speeds?.tiers ?? []), { team: 1, maxLoadStone: 0, feetPerTurn: 0 }];
    await this.actor.update({ "system.speeds.tiers": tiers });
  }

  static async #removeTier(_e, target) {
    const tiers = [...(this.actor.system.speeds?.tiers ?? [])];
    tiers.splice(Number(target.dataset.index), 1);
    await this.actor.update({ "system.speeds.tiers": tiers });
  }

  static async #removeAnimal(_e, target) {
    const animals = [...(this.actor.system.team?.animals ?? [])];
    animals.splice(Number(target.dataset.index), 1);
    await this.actor.update({ "system.team.animals": animals });
  }

  static async #togglePulling(_e, target) {
    const animals = [...(this.actor.system.team?.animals ?? [])];
    const i = Number(target.dataset.index);
    if (!animals[i]) return;
    animals[i] = { ...animals[i], pulling: !animals[i].pulling };
    await this.actor.update({ "system.team.animals": animals });
  }
}

/**
 * What sort of draft animal a dropped actor is, read off its name. A guess the
 * Judge can correct in one click — better than defaulting every ox to a heavy
 * horse and quietly overstating the team.
 */
function guessDraftKind(doc) {
  const n = (doc?.name ?? "").toLowerCase();
  if (/\box\b|oxen|bullock/.test(n)) return "ox";
  if (/mule/.test(n)) return "mule";
  if (/donkey|ass\b|burro/.test(n)) return "donkey";
  if (/medium|light|riding/.test(n)) return "mediumHorse";
  return "heavyHorse";
}

/** 0.6667 → "2/3", because that is how the book says it. */
function fractionLabel(f) {
  const known = [[1 / 3, "1/3"], [1 / 2, "1/2"], [2 / 3, "2/3"], [3 / 2, "3/2"], [0, "0"]];
  const hit = known.find(([v]) => Math.abs(v - f) < 0.001);
  return hit ? hit[1] : `${Math.round(f * 100)}%`;
}

const round2 = (n) => Math.round(n * 100) / 100;

/** This feature owns the sub-type's sheet; registered once, unconditionally. */
export function registerVehicleSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, VehicleSheet, {
    types: [VEHICLE_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.vehicle`,
  });
}
