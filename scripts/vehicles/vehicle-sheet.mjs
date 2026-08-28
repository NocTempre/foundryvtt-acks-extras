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
import { seaSpeeds, landSpeed, cargoRemaining, WIND, TERRAIN } from "./vehicle-speed.mjs";
import { isSinking, speedFactor, repairPlan, SINK_FORMULA, CREW_PER_POINT } from "./vessel-damage.mjs";
import { voyageDay } from "./voyage.mjs";
import { complementMeans, COMPLEMENT_MEANS } from "./berths.mjs";
import { load6 } from "../lib/capacity.mjs";
import { attach, detach } from "../lib/attachment.mjs";
import { occupantsOf, draftPullOf, normalizeTeamRows, derivedSkills } from "./occupants.mjs";

import { stationsFor, effectiveCrewRoles } from "./stations.mjs";
import { routeActorDrop } from "./drop-dialog.mjs";
import { boardForBestPace, reboardLast } from "./boarding.mjs";
import { explorationSpeedOf } from "../formation/formation-model.mjs";
import { STONE, encumbering6 } from "../lib/item-model.mjs";
import { expeditionFrom, TRAVEL_PACE } from "../lib/movement-scales.mjs";

const LANG_PREFIX = "ACKS-VEHICLES";
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;

export default class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // acks-extras-scroll is the family's whole scroll contract (lib.css):
    // without it .window-content clips, and everything below the fold is
    // unreachable rather than merely below it.
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-scroll", "acks-extras-vehicle"],
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
      stationChipOpen: VehicleSheet.#stationChipOpen,
      stationChipDetach: VehicleSheet.#disembark,
      boardBest: VehicleSheet.#boardBest,
      reboard: VehicleSheet.#reboard,
      openCargo: VehicleSheet.#openCargo,
      unloadCargo: VehicleSheet.#unloadCargo,
    },
    dragDrop: [
      { dropSelector: ".acks-extras-vehicle-team" },
      { dropSelector: ".acks-extras-vehicle-hold" },
      // Freight can be dropped on the sheet at large, not only on the bar.
      { dragSelector: ".acks-extras-vehicle-cargo [data-item-id]", dropSelector: ".acks-extras-vehicle-cargo" },
    ],
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
    // Everyone aboard, assembled ONCE by the occupants feeder. Weights are
    // TRUE: a specific actor costs its specific mass (a stack, every body it
    // stands for); the printed per-head rate prices only the UNNAMED. Crew
    // bodies never charge the hold, but a non-motive crew's gear does (the
    // marines rule), and actor-shaped cargo costs its full mass.
    const occupants = occupantsOf(this.actor);
    const riders = occupants.filter((o) => o.role === "passenger");
    const namedStone = riders.reduce((sum, r) => sum + r.stone, 0);
    const cargoRiders = occupants.filter((o) => o.role === "cargo");
    const cargoActorStone = cargoRiders.reduce((sum, o) => sum + o.stone, 0);
    const crewGearStone = occupants.reduce((sum, o) => sum + (o.cargoGear ? o.gearStone : 0), 0);
    const hold = cargoRemaining(sys, aboardStone + cargoActorStone + crewGearStone, namedStone);


    // The team's real pull and the effective crew count the ATTACHMENTS the
    // pure arithmetic cannot see, so both are STATED to the derivations.
    const pull = draftPullOf(this.actor);
    const effRoles = isSea ? effectiveCrewRoles(sys, occupants) : null;
    const speed = isSea
      ? seaSpeeds(sys, { wind: this.#wind, roles: effRoles })
      : landSpeed(sys, aboardStone, this.#ground, { pull });
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
        marineGear: round2(crewGearStone),
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
      voyage: isSea ? voyageDay(sys, { wind: this.#wind, underSail: true, roles: effRoles }) : null,
      hull: isSea ? hullState(sys, effRoles) : null,
      // The seats, at a glance: who is in what role, what each group still
      // wants, and what an empty officer's chair costs her.
      stations: this.#stationView(stationsFor(sys, occupants, { pull })),
      skills: this.#skillNotes(),
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
      pull,
      cargoRiders,
      // What the printed Crew column means here; blank follows the kind.
      meansOptions: Object.entries(COMPLEMENT_MEANS).map(([value, m]) => ({
        value, label: game.i18n.localize(m.label), selected: value === sys.crew?.means,
      })),
      meansAuto: game.i18n.format(`${LANG_PREFIX}.means.auto`, {
        effective: game.i18n.localize(`${LANG_PREFIX}.bucket.${complementMeans(sys)}`),
      }),
      // What is actually in the hold. A vehicle is an Actor, so its freight is
      // its own items and their weight already reaches the hold figure above
      // through the same sum every carrier uses — this only shows the reader
      // what that figure is made of, and lets them change it.
      cargo: this.actor.items.map((it) => ({
        id: it.id,
        name: it.name,
        img: it.img,
        qty: Number(it.system?.quantity?.value ?? 1) || 1,
        stone: round2(encumbering6(it) / STONE),
        // Only a stackable item offers a count; a sword does not.
        stacks: it.system?.quantity !== undefined,
      })),
      // A team that cannot pull what the vehicle was built for is worth
      // flagging even before a load makes it matter.
      underTeamed: !isSea && sys.team?.required > 0 && pull < sys.team.required,
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
    // `toObject()`, not the model: cloning a live DataModel's array rows does
    // not yield their plain fields. The form's own input names come with it —
    // by now the submission has been cleaned against the schema, so a field
    // with no input is already sitting at its default and cannot be told from
    // one the reader emptied on purpose.
    if (data.system) {
      const named = new Set([...(form?.elements ?? [])].map((el) => el.name).filter(Boolean));
      data.system = VehicleData.mergeSubmit(this.actor.system.toObject(), data.system, named);
    }
    return data;
  }

  /** The wind selector re-renders without touching the document. */
  async _onChangeForm(config, event) {
    const el = event.target;
    // How many of a piece of freight there are. The input carries no `name`,
    // so it never enters the submit path at all: an embedded item's count is
    // not part of the vehicle's own data, and routing it through the form
    // would mean writing it into the actor's system object on its way past.
    if (el?.dataset?.cargoQty !== undefined) {
      const item = this.actor.items.get(el.dataset.itemId);
      if (item) await item.update({ "system.quantity.value": Math.max(0, Number(el.value) || 0) });
      return this.render();
    }
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
    // Freight. An item dropped anywhere on the sheet is being loaded — there
    // is nowhere else on a wagon for it to go, so this does not ask which
    // target it landed on the way an actor drop has to.
    if (data?.type === "Item") {
      const item = await fromUuid(data.uuid);
      if (!item) return;
      // Its own actor keeps it if it came off one: freight is moved, not
      // copied, or loading a cart silently doubles the party's supplies.
      const created = await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
      if (created.length && item.parent instanceof Actor && item.parent !== this.actor) await item.delete();
      return this.render();
    }
    if (data?.type !== "Actor") return super._onDrop?.(event);
    const doc = await fromUuid(data.uuid);
    if (!doc || doc.documentName !== "Actor") return;
    // A drop on a SPECIFIC station is unambiguous and attaches directly; a
    // drop anywhere else asks. The hold and the team keep their historical
    // meanings as the dialog's preselection, so the old gesture is one click.
    const seat = event.target?.closest?.("[data-station]")?.dataset.station ?? null;
    const preselect =
      seat ??
      (event.target?.closest?.(".acks-extras-vehicle-hold")
        ? "passengers"
        : event.target?.closest?.(".acks-extras-vehicle-team")
          ? "team"
          : null);
    const pick = await routeActorDrop(this.actor, doc, { preselect, auto: !!seat });
    if (!pick) return;
    const res = await attach(doc, this.actor, pick.role, { station: pick.station, kind: pick.kind });
    if (!res.ok) {
      const key = res.reason === "circular" ? "team.circular" : "team.cantHitch";
      ui.notifications?.warn(game.i18n.format(`${LANG_PREFIX}.${key}`, { name: doc.name }));
      return;
    }
    this.render();
  }

  /**
   * Station groups resolved for the template: labels localized, chips built,
   * the unnamed stepper named after the field it writes, empty seats counted
   * out, and the half-hand arithmetic (an unqualified body is half a hand,
   * RR ch. 7) stated as an effective count.
   */
  #stationView(groups) {
    const editable = this.isEditable;
    return groups.map((g) => {
      const named = g.named.map((o) => {
        const bodies = Math.max(0, o.bodies ?? 1);
        const base =
          g.role === "draft"
            ? game.i18n.localize(`${LANG_PREFIX}.draft.${o.kind}`)
            : g.role === "passenger" || g.role === "cargo"
              ? `${o.stone} st`
              : o.cargoGear && o.gearStone
                ? `${o.gearStone} st`
                : null;
        return {
          uuid: o.uuid,
          name: o.name,
          img: o.img,
          qual: o.qualified ?? null,
          // A stack says how many it stands for; the sub-line carries it.
          sub: [bodies !== 1 ? `×${bodies}` : null, base].filter(Boolean).join(" · ") || null,
          editable,
          detachTooltip: game.i18n.localize(
            g.role === "draft"
              ? `${LANG_PREFIX}.team.unhitch`
              : g.role === "crew"
                ? `${LANG_PREFIX}.station.relieve`
                : `${LANG_PREFIX}.cargo.disembark`,
          ),
        };
      });
      // An unqualified BODY is half a hand — a stack of twenty is twenty of them.
      const half = g.named.reduce((n, o) => n + (o.qualified === false ? Math.max(0, o.bodies ?? 1) : 0), 0);
      return {
        key: g.key,
        label: g.labelText || game.i18n.localize(g.labelKey),
        role: g.role,
        dropStation: g.key,
        short: g.short,
        count:
          g.counts === "pull"
            ? `${g.filled ?? 0}${g.required ? ` / ${g.required}` : ""}`
            : g.required != null
              ? `${g.filled} / ${g.required}`
              : `${g.filled}`,
        named,
        unnamed: g.unnamed,
        stepperName:
          g.key === "passengers"
            ? "system.cargo.passengers"
            : g.index !== undefined
              ? `system.crew.roles.${g.index}.aboard`
              : null,
        unnamedNote:
          g.key === "team" && g.unnamed ? game.i18n.localize(`${LANG_PREFIX}.station.abstractRows`) : null,
        empties: Array.from({ length: g.emptySlots ?? 0 }),
        effectiveNote:
          half > 0 && g.counts === "people"
            ? game.i18n.format(`${LANG_PREFIX}.station.effective`, { n: g.filled - half / 2 })
            : null,
        consequence: g.consequenceKey ? game.i18n.localize(g.consequenceKey) : null,
      };
    });
  }

  /**
   * What the NAMED crew supply of the typed skill statements, said beside
   * those fields with provenance. The typed fields stay authoritative — the
   * abstract crew is the common case — so this only tells the Judge what the
   * real people aboard would justify.
   */
  #skillNotes() {
    const d = derivedSkills(this.actor);
    return {
      driving: d.driving.has ? game.i18n.format(`${LANG_PREFIX}.station.drivingFrom`, { name: d.driving.from }) : null,
      seafaring:
        d.seafaring.rank > 0
          ? game.i18n.format(`${LANG_PREFIX}.station.seafaringFrom`, { rank: d.seafaring.rank, name: d.seafaring.from })
          : null,
      charts: d.charts.has ? game.i18n.format(`${LANG_PREFIX}.station.chartsFrom`, { name: d.charts.from }) : null,
    };
  }

  /** Open an occupant's own sheet from its chip. */
  static async #stationChipOpen(_e, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    doc?.sheet?.render(true);
  }

  /**
   * @override — convert any team rows still bound to a real actor into draft
   * attachments. Lazy and idempotent: a vehicle written under the row scheme
   * converges the first time an owner opens it, and the guard inside returns
   * before any write when there is nothing to convert.
   */
  _onRender(context, options) {
    super._onRender?.(context, options);
    void normalizeTeamRows(this.actor);
  }

  /** Open a piece of freight's own sheet. */
  static async #openCargo(_e, target) {
    this.actor.items.get(target.dataset.itemId)?.sheet?.render(true);
  }

  /** Take it off the wagon. It is deleted, not dropped on the road. */
  static async #unloadCargo(_e, target) {
    const item = this.actor.items.get(target.dataset.itemId);
    if (!item) return;
    await item.delete();
    this.render();
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
