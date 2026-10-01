/* global game, foundry, ui, Actor, fromUuid, fromUuidSync */
/**
 * The vehicle sheet: how fast it is going and what is slowing it, who is
 * aboard, what is in the hold, and where it stands when it is deployed as a
 * place.
 *
 * A header that never scrolls away — portrait, name, the pace and the hold at
 * a glance, and the warnings — over one tab per question. Every tab renders
 * inside the one form, so an inactive tab's inputs still submit and switching
 * tabs never drops an edit.
 *
 * The travel tab names its own reductions. A vessel showing far less than her
 * printed speed is either short-handed or hungry, and a Judge should not have
 * to work out which; every factor the derivation applied is listed beside the
 * result.
 */
import { MODULE_ID } from "../lib/constants.mjs";
import { VEHICLE_TYPE } from "./constants.mjs";
import VehicleData, { VEHICLE_KINDS, DRAFT_KINDS, CARRIAGE } from "./vehicle-data.mjs";
import { seaSpeeds, landSpeed, draftEquivalent, WIND, TERRAIN } from "./vehicle-speed.mjs";
import { isSinking, speedFactor, repairPlan, sinkFormula } from "./vessel-damage.mjs";
import { SINKING_FLAG, openHazardDialog, openNavigationDialog, startSinkingClock, tickSinkingClock } from "./sea-throws.mjs";
import { voyageDay } from "./voyage.mjs";
import { complementMeans, COMPLEMENT_MEANS } from "./berths.mjs";
import { holdFrom } from "./hold.mjs";
import { deploymentOf, deploySite, deployVehicle, strikeVehicle } from "./deploy.mjs";
import { load6 } from "../lib/capacity.mjs";
import { attach, detach } from "../lib/attachment.mjs";
import { handOver, isProvider, storesByOwner, storageFlagOf, quantityOf } from "../lib/storage.mjs";
import { isLocation, parentUuidOf, placeIndex, placePath, setParent } from "../lib/place.mjs";
import { occupantsOf, draftPullOf, normalizeTeamRows, derivedSkills } from "./occupants.mjs";
import { stationsFor, effectiveCrewRoles } from "./stations.mjs";
import { routeActorDrop } from "./drop-dialog.mjs";
import { fractionLabel } from "../lib/util.mjs";
import { boardForBestPace, reboardLast } from "./boarding.mjs";
import { explorationSpeedOf } from "../formation/formation-model.mjs";
import { STONE, encumbering6, isCurrency } from "../lib/item-model.mjs";
import { landCoin } from "../lib/bundles.mjs";
import { expeditionFrom, TRAVEL_PACE } from "../lib/movement-scales.mjs";
import { ITEM_FLAG as MARKETS_FLAG } from "../markets/constants.mjs";

const LANG_PREFIX = "ACKS-VEHICLES";
const { HandlebarsApplicationMixin } = foundry.applications.api;
const { ActorSheetV2 } = foundry.applications.sheets;
const TEMPLATES = `modules/${MODULE_ID}/templates/vehicles`;

/** The parent select's value for "wherever the party stands when it deploys". */
const SITE_PARENT = "@site";

export default class VehicleSheet extends HandlebarsApplicationMixin(ActorSheetV2) {
  static DEFAULT_OPTIONS = {
    // acks-extras-scroll is the family's scroll contract (lib.css); the tab
    // panels scroll inside it, so it is the backstop rather than the scroller.
    classes: ["acks-ui", "acks", "acks2", "acks-extras", "acks-extras-scroll", "acks-extras-vehicle"],
    position: { width: 660, height: 720 },
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
      stationChipOpen: VehicleSheet.#openUuid,
      stationChipDetach: VehicleSheet.#disembark,
      boardBest: VehicleSheet.#boardBest,
      reboard: VehicleSheet.#reboard,
      openCargo: VehicleSheet.#openCargo,
      unloadCargo: VehicleSheet.#unloadCargo,
      seaNavigation: VehicleSheet.#seaNavigation,
      seaHazard: VehicleSheet.#seaHazard,
      sinkStart: VehicleSheet.#sinkStart,
      sinkTick: VehicleSheet.#sinkTick,
      deploy: VehicleSheet.#deploy,
      strike: VehicleSheet.#strike,
      openPlace: VehicleSheet.#openUuid,
    },
  };

  /**
   * A header that is always on screen, a tab strip, and one part per tab.
   * Each tab's root is its own scroller (`scrollable: [""]`), so a re-render
   * on every submitted field keeps each tab where its reader left it.
   */
  static PARTS = {
    header: { template: `${TEMPLATES}/vehicle-header.hbs` },
    tabs: { template: "templates/generic/tab-navigation.hbs" },
    travel: { template: `${TEMPLATES}/vehicle-tab-travel.hbs`, scrollable: [""] },
    aboard: { template: `${TEMPLATES}/vehicle-tab-aboard.hbs`, scrollable: [""] },
    hold: { template: `${TEMPLATES}/vehicle-tab-hold.hbs`, scrollable: [""] },
    place: { template: `${TEMPLATES}/vehicle-tab-place.hbs`, scrollable: [""] },
    details: { template: `${TEMPLATES}/vehicle-tab-details.hbs`, scrollable: [""] },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "travel", icon: "fa-solid fa-route" },
        { id: "aboard", icon: "fa-solid fa-people-group" },
        { id: "hold", icon: "fa-solid fa-boxes-stacked" },
        { id: "place", icon: "fa-solid fa-campground" },
        { id: "details", icon: "fa-solid fa-book" },
      ],
      initial: "travel",
      labelPrefix: `${LANG_PREFIX}.tab`,
    },
  };

  /** The wind the Judge is looking at; a view choice, not stored on the boat. */
  #wind = "moderate";

  /** The ground the cart is on — likewise a view choice, not a property of it. */
  #ground = { terrain: "grassland", road: false, raining: false, pavedRoad: false };

  /** How the day is being spent: dedicated travel, a forced march, or an hour here and there. */
  #pace = "dedicated";

  /** Where the next deploy files the vehicle: the site's place, a chosen one, or "" for none. */
  #deployParent = SITE_PARENT;

  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const actor = this.actor;
    const sys = actor.system;
    const isSea = sys.kind === "sea";

    // Everyone aboard, assembled ONCE by the occupants feeder, and the hold
    // computed from it by the one reader boarding, the land tiers and a
    // market's loading all share (hold.mjs).
    const occupants = occupantsOf(actor);
    const hold = holdFrom(sys, { aboardStone: load6(actor) / STONE, occupants });

    // The team's real pull and the effective crew count the ATTACHMENTS the
    // pure arithmetic cannot see, so both are STATED to the derivations. The
    // whole load, riders included, prices a land vehicle's tier.
    const pull = draftPullOf(actor);
    const effRoles = isSea ? effectiveCrewRoles(sys, occupants) : null;
    const speed = isSea
      ? seaSpeeds(sys, { wind: this.#wind, roles: effRoles })
      : landSpeed(sys, hold.used, this.#ground, { pull });
    const reasons = (speed.reasons ?? []).map((r) => ({
      label: game.i18n.localize(`${LANG_PREFIX}.reason.${r.key}`),
      // A factor reads better as the fraction the book prints than as 0.667.
      factor: r.factor != null ? fractionLabel(r.factor) : null,
      over: r.over,
    }));
    const stations = this.#stationView(stationsFor(sys, occupants, { pull }));
    const hull = isSea ? hullState(sys, effRoles) : null;
    const place = this.#placeView();

    return Object.assign(context, {
      actor,
      system: sys,
      isSea,
      isLand: !isSea,
      editable: this.isEditable,
      isGM: game.user.isGM,
      header: {
        kindLabel: game.i18n.localize(VEHICLE_KINDS[sys.kind]?.label ?? ""),
        pace: isSea ? null : speed.feetPerTurn,
        holdUsed: round2(hold.used),
        holdCapacity: round2(hold.capacity),
        deployedAt: place.deployed ? (place.parentName || game.i18n.localize(`${LANG_PREFIX}.place.nowhere`)) : null,
        sinking: !!hull?.sinking,
        over: hold.over,
        short: stations.some((s) => s.short),
      },
      kinds: Object.entries(VEHICLE_KINDS).map(([value, k]) => ({
        value, label: game.i18n.localize(k.label), selected: value === sys.kind,
      })),
      // How the vehicle is carried; blank reads as pulled, the common case.
      carriages: Object.entries(CARRIAGE).map(([value, c]) => ({
        value, label: game.i18n.localize(c.label), selected: (sys.carriage || "pulled") === value,
      })),
      hold: {
        ...hold,
        used: round2(hold.used),
        capacity: round2(hold.capacity),
        free: round2(hold.free),
        aboardStone: round2(hold.aboardStone),
        passengerStone: round2(hold.passengerStone),
        marineGear: round2(hold.marineGear),
      },
      sinkingClock: actor.getFlag(MODULE_ID, SINKING_FLAG) ?? null,
      speed,
      reasons,
      winds: Object.entries(WIND).map(([value, w]) => ({
        value, label: game.i18n.localize(w.label), selected: value === this.#wind,
      })),
      ground: this.#ground,
      // A wagon's day, in the scale a journey is actually planned in. The
      // terrain multiplier is already inside feetPerTurn, so it is not applied
      // a second time here.
      expedition: isSea ? null : expeditionFrom(speed.feetPerTurn, { pace: this.#pace }),
      // A vessel's day and the wagon's day run on different clocks, so the
      // two are never shown as the same kind of number.
      voyage: isSea ? voyageDay(sys, { wind: this.#wind, underSail: true, roles: effRoles }) : null,
      hull,
      stations,
      skills: this.#skillNotes(),
      paces: Object.entries(TRAVEL_PACE).map(([value, p]) => ({
        value, label: game.i18n.localize(p.label), selected: value === this.#pace,
      })),
      terrains: Object.entries(TERRAIN).map(([value, t]) => ({
        value, label: game.i18n.localize(t.label), selected: value === this.#ground.terrain,
      })),
      // A cart on ground it may not enter without a road is stopped, not slow.
      blockedByGround: !isSea && !!TERRAIN[this.#ground.terrain]?.wheelsNeedRoad && !this.#ground.road,
      roles: (sys.crew?.roles ?? []).map((r, index) => ({
        ...r, index,
        short: r.motive && r.required > 0 && (effRoles?.[index]?.aboard ?? r.aboard) < r.required,
      })),
      tiers: (sys.speeds?.tiers ?? []).map((t, index) => ({ ...t, index })),
      animals: (sys.team?.animals ?? []).map((a, index) => ({
        ...a, index,
        count: Math.max(1, Number(a.count) || 1),
        kindLabel: game.i18n.localize(`${LANG_PREFIX}.draft.${a.kind}`),
        // What the ROW pulls, which is the whole stack it stands for — null
        // where the registry cannot price that kind, so the sheet can say
        // "unpriced" rather than show a confident nothing.
        pull: draftEquivalent(a.kind) == null
          ? null
          : draftEquivalent(a.kind) * Math.max(1, Number(a.count) || 1),
      })),
      pull,
      cargoRiders: occupants.filter((o) => o.role === "cargo"),
      // What the printed Crew column means here; blank follows the kind.
      meansOptions: Object.entries(COMPLEMENT_MEANS).map(([value, m]) => ({
        value, label: game.i18n.localize(m.label), selected: value === sys.crew?.means,
      })),
      meansAuto: game.i18n.format(`${LANG_PREFIX}.means.auto`, {
        effective: game.i18n.localize(`${LANG_PREFIX}.bucket.${complementMeans(sys)}`),
      }),
      cargo: this.#cargoView(),
      // A team that cannot pull what the vehicle was built for is worth
      // flagging even before a load makes it matter.
      underTeamed: !isSea && sys.team?.required > 0 && pull < sys.team.required,
      draftKinds: Object.keys(DRAFT_KINDS).map((k) => ({
        value: k, label: game.i18n.localize(`${LANG_PREFIX}.draft.${k}`),
      })),
      // Any harnessed kind the registry cannot price, named once. Joined
      // here because the template layer has no list-joining helper.
      draftUnpriced: [...new Set((sys.team?.animals ?? [])
        .filter((a) => a.pulling !== false && draftEquivalent(a.kind) == null)
        .map((a) => game.i18n.localize(`${LANG_PREFIX}.draft.${a.kind}`)))].join(", "),
      place,
      descriptionHTML: await foundry.applications.ux.TextEditor.implementation.enrichHTML(sys.description ?? "", {
        relativeTo: actor,
        secrets: actor.isOwner,
      }),
    });
  }

  /** Each tab part renders against its own tab record. */
  async _preparePartContext(partId, context, options) {
    context = await super._preparePartContext(partId, context, options);
    if (context.tabs?.[partId]) context.tab = context.tabs[partId];
    return context;
  }

  /**
   * What is actually in the hold. A vehicle is an Actor, so its freight is its
   * own items and their weight already reaches the hold figure through the
   * same sum every carrier uses — this only shows the reader what that figure
   * is made of. Goods stashed for somebody say whose; a market's trade goods
   * say so.
   */
  #cargoView() {
    return this.actor.items.map((it) => ({
      id: it.id,
      name: it.name,
      img: it.img,
      qty: Number(it.system?.quantity?.value ?? 1) || 1,
      stone: round2(encumbering6(it) / STONE),
      // Only a stackable item offers a count; a sword does not.
      stacks: it.system?.quantity !== undefined,
      ownerName: storageFlagOf(it)?.ownerName || null,
      merchandise: !!it.getFlag(MODULE_ID, MARKETS_FLAG)?.merchandise,
    }));
  }

  /**
   * The Place tab: whether the vehicle stands as a place, what it is filed
   * under, where its marker is, and whose goods are aboard.
   */
  #placeView() {
    const actor = this.actor;
    const record = deploymentOf(actor);
    const provider = isProvider(actor);
    const index = placeIndex();
    const pathOf = (uuid) => placePath(uuid, index).map((n) => n.name).join(" › ");
    const parentUuid = parentUuidOf(actor);
    const site = record ? null : deploySite(actor);
    // A place is filed under a location; a vehicle is never filed inside
    // another vehicle, and nobody sees a location they cannot see.
    const locations = game.actors
      .filter((a) => isLocation(a) && a.testUserPermission(game.user, "LIMITED"))
      .map((a) => ({ value: a.uuid, label: pathOf(a.uuid) || a.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
    const chosen = provider ? (parentUuid ?? "") : this.#deployParent;
    const options = locations.map((o) => ({ ...o, selected: o.value === chosen }));
    const marker = record?.tokenUuid ? fromUuidSync(record.tokenUuid) : null;
    const goods = provider
      ? [...storesByOwner(actor).values()].map((bucket) => ({
          ownerName: bucket.ownerName || game.i18n.localize(`${LANG_PREFIX}.place.nobody`),
          rows: bucket.items.map((i) => ({ name: i.name, qty: quantityOf(i)?.value ?? null })),
        }))
      : [];
    return {
      deployed: !!record,
      provider,
      parentUuid,
      parentName: parentUuid ? pathOf(parentUuid) || (fromUuidSync(parentUuid)?.name ?? "") : "",
      options,
      siteOption: provider
        ? null
        : {
            value: SITE_PARENT,
            label: site?.parent
              ? game.i18n.format(`${LANG_PREFIX}.place.siteParent`, { place: site.parent.name })
              : game.i18n.localize(`${LANG_PREFIX}.place.siteNone`),
            selected: chosen === SITE_PARENT,
          },
      noneSelected: chosen === "",
      markerScene: marker?.parent?.name ?? null,
      markerMissing: !!record?.tokenUuid && !marker,
      siteScene: site?.scene?.name ?? null,
      goods,
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
    // alone drops every one of them. `toObject()`, not the model: cloning a
    // live DataModel's array rows does not yield their plain fields. By now
    // the submission is cleaned against the schema, so a field with no input
    // is already at its default and indistinguishable from one the form
    // actually cleared.
    if (data.system) {
      const named = new Set([...(form?.elements ?? [])].map((el) => el.name).filter(Boolean));
      data.system = VehicleData.mergeSubmit(this.actor.system.toObject(), data.system, named);
    }
    return data;
  }

  /** View choices re-render without touching the document. */
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
    // The place it is filed under: written at once where the vehicle already
    // is a place, remembered for the next deploy where it is not. Unnamed like
    // the count above, so it never enters the actor's own submit.
    if (el?.dataset?.placeParent !== undefined) {
      if (isProvider(this.actor)) await setParent(this.actor, el.value || null);
      else this.#deployParent = el.value;
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
   * An item dropped anywhere on the sheet is being loaded; an actor dropped on
   * a station takes that seat, and anywhere else asks which.
   *
   * Freight off an actor is MOVED through the family's one transfer, never
   * copied: loading a cart must not double the party's supplies, and a drop
   * from a sheet this user does not control is refused rather than duplicated.
   * An animal is bound by uuid, never moved: the horse is still its own actor,
   * and a Judge who deletes the wagon has not deleted the team.
   */
  async _onDrop(event) {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    if (data?.type === "Item") {
      const item = await fromUuid(data.uuid);
      if (!item || item.parent === this.actor) return;
      // Coin goes where it goes on every sheet (`landCoin`): moved off an actor
      // like the rest, and from nobody onto the hold's row of its own kind — a
      // copy would be a second purse, at whatever count the shelf's is.
      if (isCurrency(item)) await landCoin(this.actor, item);
      else if (item.parent instanceof Actor) await handOver(item.parent, this.actor, [{ id: item.id }]);
      else await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
      return this.render();
    }
    if (data?.type !== "Actor") return;
    const doc = await fromUuid(data.uuid);
    if (!doc || doc.documentName !== "Actor") return;
    // A drop on a SPECIFIC station is unambiguous and attaches directly; a
    // drop anywhere else asks, preselecting the hold or team target so the
    // drop stays one click.
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
   * out, and — at a bench where unproficient hands are worth less than a full
   * one — what the bench is worth (`effective`, stations.mjs), or that
   * nothing imported could weigh them (`unweighed`).
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
      const effective = g.effective != null ? round2(g.effective) : null;
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
          effective != null && g.counts === "people" && effective !== g.filled
            ? game.i18n.format(`${LANG_PREFIX}.station.effective`, { n: effective })
            : null,
        unweighedNote: g.unweighed ? game.i18n.localize(`${LANG_PREFIX}.station.unweighed`) : null,
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

  /** Open the document a chip or a place link names. */
  static async #openUuid(_e, target) {
    const doc = await fromUuid(target.dataset.uuid).catch(() => null);
    doc?.sheet?.render(true);
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

  /** Stand the vehicle as a place, filed where the Place tab says. */
  static async #deploy() {
    const parentUuid = this.#deployParent === SITE_PARENT ? undefined : this.#deployParent || null;
    const res = await deployVehicle(this.actor, { parentUuid });
    if (!res.ok && res.reason !== "already") {
      ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.place.refused.${res.reason}`));
    }
    this.#deployParent = SITE_PARENT;
    this.render();
  }

  /** Strike the camp: the marker comes up, and the vehicle is ready to roll. */
  static async #strike() {
    const res = await strikeVehicle(this.actor);
    if (!res.ok && res.reason !== "notDeployed") {
      ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.place.refused.${res.reason}`));
    }
    this.render();
  }

  static async #seaNavigation() {
    await openNavigationDialog(this.actor);
  }

  static async #seaHazard() {
    await openHazardDialog(this.actor);
  }

  static async #sinkStart() {
    await startSinkingClock(this.actor);
    this.render();
  }

  static async #sinkTick() {
    await tickSinkingClock(this.actor);
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

const round2 = (n) => Math.round(n * 100) / 100;

/**
 * A hull, said plainly: how much of her is left, what her damage is costing
 * her, and — the part a Judge needs at exactly one moment — that she is going
 * down, and roughly how long the people aboard have.
 *
 * `roles` are the effective crew rows (`effectiveCrewRoles`): the speed factor
 * weighs a bench by what its hands are worth, and the repair line counts every
 * body aboard, named or not (`heads`), since hauling on a line asks no
 * proficiency. Only a printed fraction of what she took at sea can be put back
 * before a dock.
 */
function hullState(sys, roles) {
  const value = Number(sys?.shp?.value) || 0;
  const max = Number(sys?.shp?.max) || 0;
  if (max <= 0) return null;
  const { factor, worst, crew, hull } = speedFactor(sys, { roles });
  const aboard = (roles ?? sys?.crew?.roles ?? []).reduce((sum, r) => sum + (Number(r.heads ?? r.aboard) || 0), 0);
  const plan = repairPlan(max - value, aboard, { atSea: true });
  return {
    value,
    max,
    pct: Math.max(0, Math.min(100, Math.round((value / max) * 100))),
    sinking: isSinking(sys),
    sinkFormula: sinkFormula(),
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
    crewPerPoint: plan.crewPerPoint,
    repairMissing: !!plan.missing,
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
