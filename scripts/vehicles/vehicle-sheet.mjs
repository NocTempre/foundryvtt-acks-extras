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
import { seaSpeeds, landSpeed, cargoRemaining, WIND, TERRAIN, draftPull } from "./vehicle-speed.mjs";
import { isSinking, speedFactor, repairPlan, SINK_FORMULA, CREW_PER_POINT } from "./vessel-damage.mjs";
import { voyageDay } from "./voyage.mjs";
import { fillBuckets, complementMeans, crewCargoTrade } from "./berths.mjs";
import { load6 } from "../lib/capacity.mjs";
import { attachedTo, attach, detach } from "../lib/attachment.mjs";
import { borneBy6 } from "../lib/capacity.mjs";
import { boardForBestPace, reboardLast } from "./boarding.mjs";
import { explorationSpeedOf } from "../formation/formation-model.mjs";
import { STONE } from "../lib/item-model.mjs";
import { expeditionFrom, TRAVEL_PACE } from "../lib/movement-scales.mjs";

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
      disembark: VehicleSheet.#disembark,
      boardBest: VehicleSheet.#boardBest,
      reboard: VehicleSheet.#reboard,
    },
    dragDrop: [{ dropSelector: ".acks-extras-vehicle-team" }, { dropSelector: ".acks-extras-vehicle-hold" }],
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/vehicles/vehicle-sheet.hbs`, scrollable: [""] },
  };

  /** The wind the Judge is looking at; a view choice, not stored on the boat. */
  #wind = "moderate";

  /** The ground the cart is on — likewise a view choice, not a property of it. */
  #ground = { terrain: "grassland", road: false, raining: false, pavedRoad: false };

  /** How the day is being spent: dedicated travel, a forced march, or an hour here and there. */
  #pace = "dedicated";

  async _prepareContext() {
    const sys = this.actor.system;
    const isSea = sys.kind === "sea";

    // What is aboard, weighed the way everything else in the family weighs:
    // sixths of stone, then shown in the stone the book prints.
    const aboard6 = load6(this.actor);
    const aboardStone = aboard6 / STONE;
    // Everyone aboard rides as fifty stone, named or not, and both are charged
    // against the hold together.
    // A named passenger costs their body PLUS what they are carrying — never
    // their encumbrance, which this family bends with harnesses and quivers to
    // describe how well a load is carried rather than how much of it there is.
    // The book's fifty-stone berth is a floor: a passenger takes a passenger's
    // room whether or not they weigh it.
    const berth = Number(sys.cargo?.passengerStone) || 50;
    const riders = attachedTo(this.actor, "passenger").map((r) => ({
      uuid: r.uuid, name: r.name,
      stone: Math.max(berth, round2(borneBy6(r) / STONE)),
    }));
    const namedStone = riders.reduce((sum, r) => sum + r.stone, 0);
    const hold = cargoRemaining(sys, aboardStone, namedStone);

    // What this vehicle has ROOM for, bucket by bucket. Derived rather than
    // assumed per family: which buckets exist, what the complement means, and
    // whether passengers draw on the hold are all properties of the vehicle.
    const occupants = ["passenger", "crew", "draft"].flatMap((role) =>
      attachedTo(this.actor, role).map((o) => ({
        uuid: o.uuid,
        name: o.name,
        role,
        stone: role === "passenger" ? Math.max(berth, round2(borneBy6(o) / STONE)) : round2(borneBy6(o) / STONE),
      })),
    );
    const filled = fillBuckets(sys, occupants, aboardStone);

    const speed = isSea ? seaSpeeds(sys, { wind: this.#wind }) : landSpeed(sys, aboardStone, this.#ground);
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
      ground: this.#ground,
      // A wagon's day, in the scale a journey is actually planned in. The
      // terrain multiplier is already inside feetPerTurn, so it is not applied
      // a second time here.
      expedition: isSea ? null : expeditionFrom(speed.feetPerTurn, { pace: this.#pace }),
      // A vessel's day is TWELVE hours where the wagon above counts eight, so
      // the two are never shown as the same kind of number.
      voyage: isSea ? voyageDay(sys, { wind: this.#wind, underSail: true }) : null,
      hull: isSea ? hullState(sys) : null,
      // Which buckets this vehicle has, what each holds, and — the part that
      // is per-vehicle rather than per-family — whether passengers and cargo
      // are the same room. Labels come from what the complement MEANS, since
      // the books use one column for a driver, a chariot crew and a howdah.
      buckets: filled.buckets.map((b) => ({
        ...b,
        label: game.i18n.localize(`${LANG_PREFIX}.bucket.${b.key === "driver" || b.key === "crew" ? complementMeans(sys) : b.key}`),
      })),
      pools: filled.pools,
      poolLabel: game.i18n.localize(`${LANG_PREFIX}.bucket.${filled.pools ? "pooled" : "berthed"}`),
      berthTrade: isSea ? crewCargoTrade(sys, 0) : null,
      pace: this.#pace,
      paces: Object.entries(TRAVEL_PACE).map(([value, p]) => ({
        value, label: game.i18n.localize(p.label), selected: value === this.#pace,
      })),
      terrains: Object.entries(TERRAIN).map(([value, t]) => ({
        value, label: game.i18n.localize(t.label), selected: value === this.#ground.terrain,
        needsRoad: !!t.wheelsNeedRoad,
      })),
      // A cart on ground it may not enter without a road is stopped, not slow.
      blockedByGround: !isSea && !!TERRAIN[this.#ground.terrain]?.wheelsNeedRoad && !this.#ground.road,
      roles: (sys.crew?.roles ?? []).map((r, index) => ({
        ...r, index,
        short: r.motive && r.required > 0 && r.aboard < r.required,
      })),
      tiers: (sys.speeds?.tiers ?? []).map((t, index) => ({ ...t, index })),
      animals: (sys.team?.animals ?? []).map((a, index) => ({
        ...a, index,
        count: Math.max(1, Number(a.count) || 1),
        kindLabel: game.i18n.localize(`${LANG_PREFIX}.draft.${a.kind}`),
        // What the ROW pulls, which is the whole stack it stands for.
        pull: (DRAFT_EQUIVALENTS[a.kind] ?? 0) * Math.max(1, Number(a.count) || 1),
      })),
      pull: draftPull(sys),
      riders,
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
    // Over what the vehicle already holds: these rows carry fields no input
    // names (an animal's uuid and name), and rebuilding them from the form
    // alone drops every one of them.
    if (data.system) data.system = VehicleData.mergeSubmit(this.actor.system, data.system);
    return data;
  }

  /** The wind selector re-renders without touching the document. */
  async _onChangeForm(config, event) {
    const el = event.target;
    if (el?.name === "wind") {
      this.#wind = el.value;
      return this.render();
    }
    // The ground is a view choice too: where the cart is TODAY, not what it is.
    if (el?.name === "pace") {
      this.#pace = el.value;
      return this.render();
    }
    if (el?.name?.startsWith("ground.")) {
      const key = el.name.slice("ground.".length);
      this.#ground = { ...this.#ground, [key]: el.type === "checkbox" ? el.checked : el.value };
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
    // A drop on the HOLD is a passenger boarding; a drop on the team is an
    // animal being hitched. Same event, two meanings, told apart by target.
    if (event.target?.closest?.(".acks-extras-vehicle-hold")) {
      await attach(doc, this.actor, "passenger");
      return this.render();
    }
    const animals = [...(this.actor.system.team?.animals ?? [])];
    if (animals.some((a) => a.uuid === doc.uuid)) {
      ui.notifications?.info(game.i18n.format(`${LANG_PREFIX}.alreadyInHarness`, { name: doc.name }));
      return;
    }
    animals.push({ uuid: doc.uuid, name: doc.name, kind: guessDraftKind(doc), count: 1, pulling: true });
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

  static async #disembark(_e, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    if (doc) await detach(doc);
    this.render();
  }

  /**
   * Load the party for the best pace. The candidates are the members of any
   * formation this vehicle's passengers already belong to, falling back to
   * every player character — a Judge with no formation set up still gets the
   * one-click load.
   */
  static async #boardBest() {
    const api = game.modules.get(MODULE_ID)?.api?.formation;
    const raw = api?.getFormations?.() ?? [];
    const forms = Array.isArray(raw) ? raw : Object.values(raw ?? {});
    const members = forms.flatMap((f) => (f.members ?? []).map((m) => game.actors.get(m.actorId)).filter(Boolean));
    const candidates = members.length ? members : game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
    await boardForBestPace(this.actor, candidates, { ground: this.#ground, speedOf: explorationSpeedOf });
    this.render();
  }

  static async #reboard() {
    await reboardLast(this.actor);
    this.render();
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

/**
 * 0.6667 → "2/3", because that is how the book says it. Whole numbers stay
 * whole ("2", not "200%"), so a row of factors reads in one idiom rather than
 * mixing fractions and percentages.
 */
function fractionLabel(f) {
  if (Math.abs(f - Math.round(f)) < 0.001) return String(Math.round(f));
  const known = [[1 / 3, "1/3"], [1 / 2, "1/2"], [2 / 3, "2/3"], [3 / 2, "3/2"], [2 / 9, "2/9"], [1 / 4, "1/4"], [3 / 4, "3/4"]];
  const hit = known.find(([v]) => Math.abs(v - f) < 0.001);
  return hit ? hit[1] : `${Math.round(f * 100)}%`;
}

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * A hull, said plainly: how much of her is left, what her damage is costing
 * her, and — the part a Judge needs at exactly one moment — that she is going
 * down, and roughly how long the people aboard have.
 *
 * The repair line is stated for the crew she actually has, because "five hands
 * per point per turn" is arithmetic nobody should be doing mid-battle, and
 * because only half of what she took at sea can be put back before a dock.
 */
function hullState(sys) {
  const value = Number(sys?.shp?.value) || 0;
  const max = Number(sys?.shp?.max) || 0;
  if (max <= 0) return null;
  const { factor, worst, crew, hull } = speedFactor(sys);
  const aboard = (sys?.crew?.roles ?? []).reduce((sum, r) => sum + (Number(r.aboard) || 0), 0);
  const plan = repairPlan(max - value, aboard, { atSea: true });
  return {
    value,
    max,
    pct: Math.max(0, Math.min(100, Math.round((value / max) * 100))),
    sinking: isSinking(sys),
    sinkFormula: SINK_FORMULA,
    factor,
    factorLabel: fractionLabel(factor),
    // Naming which of the two governs stops a Judge patching the hull to fix a
    // speed the missing rowers were costing all along. The KEY is resolved
    // here rather than assembled in the template, which has no concat helper.
    worst,
    governsKey: `${LANG_PREFIX}.damage.governs.${worst}`,
    crewFactorLabel: fractionLabel(crew),
    hullFactorLabel: fractionLabel(hull),
    damage: max - value,
    repairable: plan.repairable,
    dockOnly: plan.dockOnly,
    repairTurns: Number.isFinite(plan.turns) ? plan.turns : null,
    crewPerPoint: CREW_PER_POINT,
    handsAboard: aboard,
  };
}

/** This feature owns the sub-type's sheet; registered once, unconditionally. */
export function registerVehicleSheet() {
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, VehicleSheet, {
    types: [VEHICLE_TYPE],
    makeDefault: true,
    label: `${LANG_PREFIX}.sheet.vehicle`,
  });
}
