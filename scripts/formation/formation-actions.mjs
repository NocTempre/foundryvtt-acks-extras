/* global game, foundry, ui, fromUuidSync */
import { dealExperience } from "./xp-app.mjs";
import { openHpTool } from "../lib/apps/hp-app.mjs";
import {
  addBlank,
  addMember,
  autoArrange,
  disband,
  getFrontage,
  getPartyActor,
  getPartyScene,
  getPartyToken,
  maxFrontage,
  removeBlank,
  removeMember,
  swapCells,
  syncPartyActorSpeed,
  toggleRole,
  updateFormation,
} from "./formation-model.mjs";
import { postEncounterThrow } from "./encounter-card.mjs";
import { nextHex, spendActivityHours } from "./journey.mjs";
import { closeDay } from "./day-close.mjs";
import { pickAndTravel } from "./poi.mjs";
import {
  anchorMap,
  archiveSession,
  closeMapSession,
  saveFogAsMapItem,
  startMapSession,
} from "./map-items.mjs";
import {
  deleteTemplate,
  describeResult,
  formUp,
  pickMarchingOrder,
  promptForOrderName,
  saveTemplate,
} from "./marching-templates.mjs";
import { PARTY_CHECKS, rollPartyCheck } from "./party-rolls.mjs";
import { deploymentOf, deployVehicle, strikeVehicle } from "../vehicles/deploy.mjs";
import { requestPartyAction } from "./player-requests.mjs";
import { announce } from "./announce.mjs";
import { toggleDetachMember, toggleMemberLeft } from "./deployment.mjs";
import { dismount } from "../lib/mount.mjs";
import { refuseGoods } from "../lib/bundles.mjs";
import { runForageDay } from "./forage-run.mjs";
import { runSearchHour } from "./search-run.mjs";
import {
  addPlacedPoint,
  clearStock,
  markPointFound,
  openStockDialog,
  placeFromPoint,
  removePoint,
  surveyHex,
  trueHexOf,
} from "./hex-stock-run.mjs";
import { askStrayAndBegin, confirmDiscovery, confirmEnd, confirmReanchor, shiftTruth as moveTruth } from "./lost-dialog.mjs";
import { postNavigationThrow } from "./navigation-card.mjs";
import { applyTravelForm, clearDeclaredCountry, setJourneyMode, rollWeatherNow, travelOf, TRAVEL_MODES } from "./travel.mjs";
import { openCountryBrush, PAINT_LAYERS } from "../battlemap/terrain-paint.mjs";
import { COUNTRY_KEYS } from "../battlemap/country.mjs";
import { forcedMarchBar, confirmBarOverride } from "./march-bar.mjs";
import { makeLoc } from "../lib/util.mjs";
import SkillAuditApp from "./skill-audit.mjs";
import { openTrapbreakApp } from "./trapbreak-app.mjs";
import {
  addLight,
  addSpell,
  adjustSpell,
  advanceRounds,
  advanceTurns,
  consumeRations,
  encounterCheck,
  parseSpellTurns,
  removeLight,
  removeSpell,
  rollPartySave,
  toggleLight,
  toggleShield,
} from "./turn-engine.mjs";

/**
 * The behaviors behind the party sheet — the single formation UI (GM-only
 * controls hidden from players). Handlers run with `this` = the application,
 * which must expose a `formation` getter, `render()`, and `element`.
 */

const loc = makeLoc("ACKS-FORMATION");

function gmFormation(app) {
  const formation = app.formation;
  return formation && game.user.isGM ? formation : null;
}

/** Does the current (non-GM) user own this member's actor? */
function ownsActor(actorId) {
  const actor = game.actors.get(actorId);
  return actor?.testUserPermission?.(game.user, "OWNER") ?? false;
}

/**
 * Reorder a member. GMs move anyone (including blank cells) directly; players
 * move THEIR OWN character by relaying to the GM, who recomputes the target
 * cell from live state — the click's cell index may be stale by the time the
 * request lands, the actor id never is.
 */
async function reorder(app, target, dir) {
  const formation = app.formation;
  if (!formation) return;
  if (game.user.isGM) {
    const cell = Number(target.closest("[data-cell-index]")?.dataset.cellIndex);
    if (!Number.isInteger(cell)) return;
    const frontage = getFrontage(formation);
    const delta = dir === "up" ? -frontage : dir === "down" ? frontage : dir === "left" ? -1 : 1;
    await swapCells(formation, cell, delta);
    app.render();
    return;
  }
  const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
  if (!actorId || !ownsActor(actorId)) return;
  await requestPartyAction(formation.id, "reorder", { actorId, dir });
}

async function adjustTrackedSpell(app, target, delta) {
  const formation = gmFormation(app);
  if (!formation) return;
  await adjustSpell(formation, target.closest("[data-spell-id]")?.dataset.spellId, delta);
  app.render();
}

export const SHARED_ACTIONS = {
  /**
   * Divide an adventure's experience among the formation, including
   * henchmen, with the split shown to the Judge before it lands.
   */
  async dealXp() {
    const formation = gmFormation(this);
    if (!formation) return;
    await dealExperience(formation);
    this.render?.();
  },

  /** Open the hit-point window on this party's members. */
  adjustHp() {
    const formation = gmFormation(this);
    if (formation) openHpTool({ parties: [formation.id] });
  },

  /**
   * Leave a casualty where they fell, or go back for them. A member left
   * behind sets no pace and weighs on no Carrier, but stays on the roster and
   * keeps their share of the experience — the party owes them that whether or
   * not it brought the body out. The GM acts directly; a member's owner
   * relays the declaration to the GM client.
   */
  async toggleLeftBehind(event, target) {
    const formation = this.formation;
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!formation || !actorId) return;
    if (game.user.isGM) {
      if (await toggleMemberLeft(formation, actorId) === null) return;
      this.render?.();
      return;
    }
    if (!ownsActor(actorId)) return;
    await requestPartyAction(formation.id, "leftBehind", { actorId });
  },

  async openSheet(event, target) {
    const actor = game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
    actor?.sheet?.render(true);
  },

  /** A station chip (mount, train carrier) opens the document it names. */
  async stationChipOpen(event, target) {
    fromUuidSync(target.dataset.uuid)?.sheet?.render(true);
  },

  /**
   * A vehicle in the train deploys as a place beside the party, or strikes
   * and rolls on. Its owner's call, as it is on the vehicle's own sheet.
   */
  async trainDeploy(event, target) {
    const vehicle = fromUuidSync(target.dataset.uuid);
    if (!vehicle?.isOwner) return;
    if (deploymentOf(vehicle)) await strikeVehicle(vehicle);
    else await deployVehicle(vehicle);
    this.render?.();
  },

  /**
   * A member's mount chip dismounts them. GM, or the member's own player —
   * getting off your horse is not a thing you ask permission for.
   */
  async stationChipDetach(event, target) {
    const rider = game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
    if (!rider) return;
    if (!game.user.isGM && !rider.isOwner) return;
    await dismount(rider);
    this.render?.();
  },

  /**
   * Work the country: roll whatever hours the day board set aside for it, and
   * put what is found into the foragers' own packs.
   */
  async forageDay() {
    const formation = gmFormation(this);
    if (!formation) return;
    // `activities` is the day board's own field name; there is no `slots`. Only
    // the hours not yet spent are worked: a slot already done has had its throws.
    const day = travelOf(formation).day;
    const slots = day.activities.map((a, n) => (day.done[n] ? null : a));
    const kinds = slots.includes("forage") ? ["food", "water", "firewood"] : [];
    const hunting = slots.includes("hunt");
    if (!kinds.length && !hunting) {
      const spent = day.activities.some((a, n) => (a === "forage" || a === "hunt") && day.done[n]);
      ui.notifications?.info(game.i18n.localize(`ACKS-FORMATION.forageRun.${spent ? "worked" : "noHours"}`));
      return;
    }
    const results = await runForageDay(formation, { kinds, hunting });
    if (results) await spendActivityHours(formation.id, ["hunt", "forage"], { all: true });
    this.render();
  },

  /**
   * Spend an hour looking. `present` is the Judge's answer to "is there
   * anything here" (the hex's stock, or yes, or no) and `target` what the
   * party is looking for; both are read from the selects at the foot of the
   * Wilderness tab's Points of interest.
   */
  async searchHour(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    const field = (name) => this.element?.querySelector?.(`[name="${name}"]`)?.value;
    const said = travelOf(formation).camp;
    await runSearchHour(formation, {
      present: field("travel.camp.present") ?? said.present ?? "no",
      target: field("travel.camp.target") ?? said.target,
    });
    this.render();
  },

  /** Stock the hex the party stands in: the dialog, then the roll. */
  async hexStock() {
    const formation = gmFormation(this);
    if (!formation) return;
    await openStockDialog(formation);
    this.render();
  },

  /** One Land Surveying attempt on the party's hex. */
  async hexSurvey() {
    const formation = gmFormation(this);
    if (!formation) return;
    await surveyHex(formation, { auto: false });
    this.render();
  },

  /** The party found this point of the hex's stock. */
  async hexFound(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await markPointFound(formation, target.dataset.pointId);
    this.render();
  },

  /** Make a point of the hex's stock a place on the map. */
  async hexPlace(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await placeFromPoint(formation, target.dataset.pointId);
    this.render();
  },

  /** Take a point out of the hex's stock. */
  async hexRemovePoint(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await removePoint(formation, target.dataset.pointId);
    this.render();
  },

  /** Add a point of the Judge's own to the hex's stock: a name and a note. */
  async hexAddPoint() {
    const formation = gmFormation(this);
    if (!formation) return;
    const picked = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("hexStock.addPoint"), icon: "fa-solid fa-location-dot" },
      content: `<div class="form-group"><label>${foundry.utils.escapeHTML(loc("hexStock.pointName"))}
        <input type="text" name="name" autofocus></label></div>
        <div class="form-group"><label>${foundry.utils.escapeHTML(loc("hexStock.pointNote"))}
        <input type="text" name="note"></label></div>`,
      ok: {
        label: loc("hexStock.addPoint"),
        callback: (_event, button) => ({
          name: button.form.elements.name.value.trim(),
          note: button.form.elements.note.value.trim(),
        }),
      },
      rejectClose: false,
    }).catch(() => null);
    if (!picked) return;
    await addPlacedPoint(formation, picked);
    this.render();
  },

  /** Clear the hex's whole stock, after a confirm. */
  async hexClear() {
    const formation = gmFormation(this);
    const here = formation ? trueHexOf(formation) : null;
    if (!here) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("hexStock.clear") },
      content: `<p>${foundry.utils.escapeHTML(loc("hexStock.clearConfirm", { hex: here.label }))}</p>`,
      rejectClose: false,
    }).catch(() => null);
    if (!confirmed) return;
    await clearStock(here.scene, here.key);
    this.render();
  },

  /** Open a lost episode: the Judge names the face, or rolls for it. */
  async lostBegin() {
    const formation = gmFormation(this);
    if (!formation) return;
    await askStrayAndBegin(formation);
    this.render();
  },

  /** They realise they are lost. Gives back nothing else. */
  async lostDiscover() {
    const formation = gmFormation(this);
    if (!formation) return;
    await confirmDiscovery(formation);
    this.render();
  },

  /** They find the last known landmark, and the true track is credited. */
  async lostReanchor() {
    const formation = gmFormation(this);
    if (!formation) return;
    await confirmReanchor(formation);
    this.render();
  },

  /** They turn back, or the Judge closes the episode; nothing is credited. */
  async lostEnd() {
    const formation = gmFormation(this);
    if (!formation) return;
    await confirmEnd(formation);
    this.render();
  },

  /**
   * Shift the truth one hex toward the pressed cell's `data-direction` (a
   * compass name, or `roll` for a blind face); the party token, what the party
   * believes, stays. A rolled face is said to the Judge.
   */
  async shiftTruth(_event, target) {
    const formation = gmFormation(this);
    const direction = target?.dataset?.direction ?? "";
    if (!formation || !direction) return;
    const moved = await moveTruth(formation, direction);
    if (moved?.face != null) ui.notifications?.info(loc("where.rolled", { face: moved.face + 1 }));
    this.render();
  },

  /**
   * Throw the day's navigation by hand. It counts as the day's throw (made
   * `by: "judge"`), and a failure acts as the step's would; a party on a road
   * or following a route owes none, so nothing is thrown and the Judge is told.
   */
  async navigationThrowNow() {
    const formation = gmFormation(this);
    if (!formation || travelOf(formation).mode !== "journey") return;
    const thrown = await postNavigationThrow(formation, { by: "judge" });
    if (!thrown?.result?.throws) ui.notifications?.info(loc("navigation.nothingOwed"));
    this.render();
  },

  /** Open a place named on the board: the one underfoot, or the quarter's own. */
  openPlace(_event, target) {
    const uuid = target?.dataset?.uuid ?? "";
    if (!uuid) return;
    fromUuidSync(uuid)?.sheet?.render(true);
  },

  /**
   * Walk the party to a point of interest on this map for the imported
   * district-travel figure, instead of dragging the token block by block.
   */
  async settlementTravelTo() {
    const formation = gmFormation(this);
    if (!formation) return;
    await pickAndTravel(formation.id);
    this.render();
  },


  /** The Judge rolls the day's sky from the imported tables. */
  async travelWeatherRoll() {
    const formation = gmFormation(this);
    if (!formation) return;
    await rollWeatherNow(formation.id);
    this.render();
  },

  /** The Judge takes back their word on one country key; the map's reading stands again. */
  async clearOverride(_event, target) {
    const formation = gmFormation(this);
    const key = target?.dataset?.key ?? "";
    if (!formation || !COUNTRY_KEYS.includes(key)) return;
    await applyTravelForm(formation.id, { override: { [key]: "" } });
    this.render();
  },

  /** The Judge retires an older record's declaration of one country key; the map or the default answers again. */
  async clearDeclared(_event, target) {
    const formation = gmFormation(this);
    const key = target?.dataset?.key ?? "";
    if (!formation || !COUNTRY_KEYS.includes(key)) return;
    await clearDeclaredCountry(formation.id, key);
    this.render();
  },

  /**
   * Paint the hex the party stands in: the party's scene comes into view if
   * it is not, then the country brush is armed on the card's layer and its
   * palette opens — the toolbar tool's own path. Nothing is written until the
   * Judge clicks the map.
   */
  async paintThisHex(_event, target) {
    const formation = gmFormation(this);
    const scene = formation ? getPartyScene(formation) : null;
    if (!scene) return;
    const layer = Object.hasOwn(PAINT_LAYERS, target?.dataset?.layer ?? "") ? target.dataset.layer : "terrain";
    if (game.scenes?.viewed?.id !== scene.id) await scene.view();
    openCountryBrush({ layer, brush: target?.dataset?.brush || null, by: "sheet" });
  },

  /**
   * The party crosses into the next hex; the label input names it. Spends one
   * encounter-cadence unit's miles, so the clock, the day and the throws follow.
   */
  async travelEnterHex() {
    const formation = gmFormation(this);
    if (!formation) return;
    const label = this.element?.querySelector('input[name="travel.hexLabel"]')?.value ?? "";
    await nextHex(formation.id, label);
    this.render();
  },

  /** The Judge asks the wilderness directly: one encounter throw, one card. */
  async travelEncounterThrow() {
    const formation = gmFormation(this);
    if (!formation) return;
    await postEncounterThrow(formation, { activity: "travel" });
    this.render();
  },

  /**
   * End the day. The figures logged are the ones the panel was showing —
   * derived once, here, not re-derived by the engine.
   */
  async travelEndDay() {
    const formation = gmFormation(this);
    if (!formation) return;
    await closeDay(formation);
    this.render();
  },

  async disband() {
    const formation = gmFormation(this);
    if (!formation) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.localize("ACKS-FORMATION.app.disband") },
      content: `<p>${game.i18n.format("ACKS-FORMATION.app.disbandConfirm", { name: formation.name })}</p>`,
    });
    if (!confirmed) return;
    if (formation.mapSession) await closeMapSession(formation, { silent: true });
    await disband(formation);
    this._afterDisband?.();
  },

  async removeMember(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await removeMember(formation, target.closest("[data-actor-id]")?.dataset.actorId);
    this.render();
  },

  /** Up/down move by a full rank when marching multiple abreast. */
  async memberUp(event, target) {
    await reorder(this, target, "up");
  },

  async memberDown(event, target) {
    await reorder(this, target, "down");
  },

  async memberLeft(event, target) {
    await reorder(this, target, "left");
  },

  async memberRight(event, target) {
    await reorder(this, target, "right");
  },

  /** GM toggles anyone's roles; a player declares roles for their own character. */
  async toggleRole(event, target) {
    const formation = this.formation;
    if (!formation) return;
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    const role = target.dataset.role;
    if (game.user.isGM) {
      // Same authority as the light panel: the kit appears rather than the role
      // being refused.
      await toggleRole(formation, actorId, role, { override: true });
      this.render();
      return;
    }
    if (!actorId || !ownsActor(actorId)) return;
    await requestPartyAction(formation.id, "role", { actorId, role });
  },

  /** Step out of the party token, or step back in. The GM moves anyone; a player moves their own character. */
  async toggleDetach(event, target) {
    const formation = this.formation;
    if (!formation) return;
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (game.user.isGM) {
      const result = await toggleDetachMember(formation, actorId);
      if (result) {
        const name = game.actors.get(actorId)?.name ?? "";
        await announce(formation, loc(`chat.${result}`, { name }));
      } else {
        // Nothing moved. The commonest cause is a formation with no party token
        // on the canvas, where the deploy has no anchor to place a body beside.
        ui.notifications.warn(loc("warn.detachFailed"));
      }
      this.render();
      return;
    }
    if (!actorId || !ownsActor(actorId)) return;
    await requestPartyAction(formation.id, "detach", { actorId });
  },

  /** Skill audit: how every party roll resolves per member; custom-skill flags. */
  async openSkillAudit() {
    const formation = gmFormation(this);
    if (!formation) return;
    new SkillAuditApp({ formationId: formation.id }).render(true);
  },

  /** Change the party's image like any other actor: actor, prototype, and
   *  placed token all update together. */
  async editPartyImage() {
    const formation = gmFormation(this);
    if (!formation) return;
    const actor = getPartyActor(formation);
    if (!actor) return;
    const FilePickerCls = foundry.applications.apps.FilePicker.implementation;
    new FilePickerCls({
      type: "image",
      current: actor.img,
      callback: async (path) => {
        await actor.update({ img: path, "prototypeToken.texture.src": path });
        const token = getPartyToken(formation);
        if (token) await token.update({ "texture.src": path });
        this.render();
      },
    }).browse();
  },

  /** Open a Map item's sheet from the maps list. */
  async openMapItem(event, target) {
    const uuid = target.closest("[data-item-uuid]")?.dataset.itemUuid;
    const item = uuid ? fromUuidSync(uuid) : null;
    item?.sheet?.render(true);
  },

  /** I-formation from roles and sheet data: full front & back lines, utility centered. */
  async autoArrange() {
    const formation = gmFormation(this);
    if (!formation) return;
    await autoArrange(formation);
    this.render();
  },

  /** Remember the current arrangement under a name the Judge gives it. */
  async saveMarchingOrder() {
    const formation = gmFormation(this);
    if (!formation) return;
    const name = await promptForOrderName(formation);
    if (!name) return;
    const saved = await saveTemplate(formation, name);
    if (!saved) return;
    ui.notifications.info(
      loc(saved.replaced ? "marching.replaced" : "marching.saved", { name: saved.template.name }),
    );
    this.render();
  },

  /** Put the party back into a saved arrangement, or forget one. */
  async loadMarchingOrder() {
    const formation = gmFormation(this);
    if (!formation) return;
    const picked = await pickMarchingOrder();
    if (!picked) return;
    if (picked.action === "delete") {
      await deleteTemplate(picked.template.id);
      ui.notifications.info(loc("marching.deleted", { name: picked.template.name }));
      this.render();
      return;
    }
    const result = await formUp(formation, picked.template);
    if (result) ui.notifications.info(describeResult(result));
    this.render();
  },

  async addBlank() {
    const formation = gmFormation(this);
    if (!formation) return;
    await addBlank(formation);
    this.render();
  },

  async removeBlank(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    const cell = Number(target.closest("[data-cell-index]")?.dataset.cellIndex);
    if (!Number.isInteger(cell)) return;
    await removeBlank(formation, cell);
    this.render();
  },

  /** GM shields any light; a player shields lights their character carries. */
  async toggleShield(event, target) {
    const formation = this.formation;
    if (!formation) return;
    const lightId = target.closest("[data-light-id]")?.dataset.lightId;
    if (game.user.isGM) {
      await toggleShield(formation, lightId);
      this.render();
      return;
    }
    const light = formation.lights.find((l) => l.id === lightId);
    if (!light || !ownsActor(light.bearerId)) return;
    await requestPartyAction(formation.id, "lightShield", { lightId });
  },

  /** Pace (RR p. 263): careful exploration, or hurried. */
  async togglePace() {
    const formation = gmFormation(this);
    if (!formation) return;
    const hurried = formation.stance?.pace === "hurried";
    formation.stance = { ...(formation.stance ?? {}), pace: hurried ? "careful" : "hurried" };
    await updateFormation(formation);
    this.render();
  },

  async addLight() {
    const formation = gmFormation(this);
    if (!formation) return;
    const type = this.element.querySelector("[name=lightType]")?.value;
    const bearerId = this.element.querySelector("[name=lightBearer]")?.value;
    if (!type || !bearerId) return;
    // A GM handing out a light is describing the world, not shopping in it.
    await addLight(formation, type, bearerId, { override: true });
    this.render();
  },

  /** GM douses/relights any light; a player, their own character's. */
  async toggleLight(event, target) {
    const formation = this.formation;
    if (!formation) return;
    const lightId = target.closest("[data-light-id]")?.dataset.lightId;
    if (game.user.isGM) {
      await toggleLight(formation, lightId);
      this.render();
      return;
    }
    const light = formation.lights.find((l) => l.id === lightId);
    if (!light || !ownsActor(light.bearerId)) return;
    await requestPartyAction(formation.id, "lightToggle", { lightId });
  },

  async removeLight(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await removeLight(formation, target.closest("[data-light-id]")?.dataset.lightId);
    this.render();
  },

  async addSpell() {
    const formation = gmFormation(this);
    if (!formation) return;
    const pick = this.element.querySelector("[name=spellPick]")?.value ?? "";
    const manualName = this.element.querySelector("[name=spellName]")?.value?.trim() ?? "";
    const manualTurns = Number(this.element.querySelector("[name=spellTurns]")?.value) || 0;
    const manualCaster = this.element.querySelector("[name=spellCaster]")?.value ?? null;

    let name = manualName;
    let casterId = manualCaster;
    let turns = manualTurns;
    if (pick) {
      const [actorId, itemId] = pick.split("|");
      const caster = game.actors.get(actorId);
      const item = caster?.items.get(itemId);
      if (item) {
        name = item.name;
        casterId = actorId;
        turns = manualTurns || parseSpellTurns(item.system?.duration, caster.system?.details?.level ?? 1) || 0;
      }
    }
    if (!name) {
      ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.spellNeedsName"));
      return;
    }
    if (!(turns > 0)) {
      ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.spellNeedsTurns"));
      return;
    }
    await addSpell(formation, { name, casterId, turns });
    this.render();
  },

  async removeSpell(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await removeSpell(formation, target.closest("[data-spell-id]")?.dataset.spellId);
    this.render();
  },

  async spellPlus(event, target) {
    await adjustTrackedSpell(this, target, 1);
  },

  async spellMinus(event, target) {
    await adjustTrackedSpell(this, target, -1);
  },

  /** Every member rolls the pressed save; the saves rail's Magical toggle (`app.magical`) says against what. */
  async partySave(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    const magical = this.magical ?? true;
    await rollPartySave(formation, target.dataset.save, { magical });
  },

  async partyCheck(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await rollPartyCheck(formation, target.dataset.check);
    this.render();
  },

  /**
   * The party's checks, offered in one dialog: the quick tools rail has one
   * press for all of them. A `solo` check is one character's action and is
   * not offered; the dialog's answer is the picked check's key.
   */
  async partyChecks() {
    const formation = gmFormation(this);
    if (!formation) return;
    const buttons = Object.entries(PARTY_CHECKS)
      .filter(([, cfg]) => !cfg.solo)
      .map(([key, cfg]) => ({ action: key, label: game.i18n.localize(cfg.label), icon: `fa-solid ${cfg.icon}` }));
    const picked = await foundry.applications.api.DialogV2.wait({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("frame.checks.title"), icon: "fa-solid fa-ear-listen" },
      content: `<p>${foundry.utils.escapeHTML(loc("frame.checks.prompt"))}</p>`,
      buttons,
      rejectClose: false,
    }).catch(() => null);
    if (typeof picked !== "string" || !Object.hasOwn(PARTY_CHECKS, picked) || PARTY_CHECKS[picked].solo) return;
    await rollPartyCheck(formation, picked);
    this.render();
  },

  /**
   * The sheet's settings that are not figures: the encounter table the party
   * draws from. The pick is written by the form handler, the route the field
   * took when it stood on the sheet.
   */
  async tweaks() {
    const formation = gmFormation(this);
    if (!formation) return;
    const esc = foundry.utils.escapeHTML;
    const options = [
      `<option value="">${esc(loc("app.tableNone"))}</option>`,
      ...game.tables.contents.map(
        (t) => `<option value="${esc(t.id)}"${t.id === formation.tableId ? " selected" : ""}>${esc(t.name)}</option>`,
      ),
    ].join("");
    const picked = await foundry.applications.api.DialogV2.prompt({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: loc("frame.tweaks.title"), icon: "fa-solid fa-sliders" },
      content: `<div class="form-group"><label>${esc(loc("app.table"))}
        <select name="tableId">${options}</select></label>
        <p class="hint">${esc(loc("app.tableHint"))}</p></div>`,
      ok: {
        label: loc("frame.tweaks.save"),
        callback: (_event, button) => ({ tableId: button.form.elements.tableId.value }),
      },
      rejectClose: false,
    }).catch(() => null);
    if (!picked) return;
    await onChangeForm.call(this, null, null, { object: { tableId: picked.tableId } });
  },

  async advanceTurn() {
    const formation = gmFormation(this);
    if (!formation) return;
    await advanceTurns(formation, 1, { reason: "manual" });
    this.render();
  },

  /** One bookkeeping round (1 minute) — hasty actions, short delays. */
  async advanceRound() {
    const formation = gmFormation(this);
    if (!formation) return;
    await advanceRounds(formation, 1, { reason: "manual" });
    this.render();
  },

  async restTurn() {
    const formation = gmFormation(this);
    if (!formation) return;
    await advanceTurns(formation, 1, { resting: true });
    this.render();
  },

  async encounterNow() {
    const formation = gmFormation(this);
    if (!formation) return;
    await encounterCheck(formation, { manual: true });
  },

  async consumeRations() {
    const formation = gmFormation(this);
    if (!formation) return;
    await consumeRations(formation);
  },

  async togglePause() {
    const formation = gmFormation(this);
    if (!formation) return;
    // A journey honours only the Judge's own pause, so it toggles on who paused
    // it; the turn clock's modes toggle the flag itself.
    const was = travelOf(formation).mode === "journey"
      ? formation.clock.pausedBy === "judge"
      : !!formation.clock.paused;
    formation.clock.paused = !was;
    // Who paused it is recorded.
    formation.clock.pausedBy = formation.clock.paused ? "judge" : null;
    // Re-anchor the tracker so distance covered while paused is not counted.
    const token = getPartyToken(formation);
    if (token) formation.clock.lastPosition = { x: token.x, y: token.y };
    await updateFormation(formation);
    this.render();
  },

  /** Clock-only rollback for accidental drags (world time is not rewound). */
  async undoTurn() {
    const formation = gmFormation(this);
    if (!formation) return;
    formation.clock.turnsTotal = Math.max(0, formation.clock.turnsTotal - 1);
    formation.clock.turnsSinceRest = Math.max(0, formation.clock.turnsSinceRest - 1);
    formation.clock.carryFeet = 0;
    await updateFormation(formation);
    this.render();
  },

  /* --- Maps --- */

  async newMap() {
    const formation = gmFormation(this);
    if (!formation) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
      classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
      window: { title: game.i18n.localize("ACKS-FORMATION.map.newMap") },
      content: `<p>${game.i18n.localize("ACKS-FORMATION.map.newMapConfirm")}</p>`,
    });
    if (!confirmed) return;
    await startMapSession(formation);
    this.render();
  },

  async archiveMap() {
    const formation = gmFormation(this);
    if (!formation) return;
    if (await archiveSession(formation, { warn: true })) {
      ui.notifications.info(game.i18n.localize("ACKS-FORMATION.map.archived"));
    }
    this.render();
  },

  async closeMap() {
    const formation = gmFormation(this);
    if (!formation) return;
    await closeMapSession(formation);
    this.render();
  },

  /** GM anchors any map; a player consults (anchors) a map their member holds. */
  async anchorMap(event, target) {
    const formation = this.formation;
    if (!formation) return;
    const itemUuid = target.closest("[data-item-uuid]")?.dataset.itemUuid;
    if (game.user.isGM) {
      await anchorMap(formation, itemUuid);
      this.render();
      return;
    }
    const holder = fromUuidSync(itemUuid)?.parent;
    if (!holder?.testUserPermission?.(game.user, "OWNER")) return;
    await requestPartyAction(formation.id, "anchorMap", { itemUuid });
  },

  async saveFogMap() {
    if (!game.user.isGM) return;
    await saveFogAsMapItem();
    this.render();
  },

  /* --- Player declarations --- */

  async playerLight() {
    const id = this.formation?.id;
    if (!id) return;
    const lightType = this.element.querySelector(".player-light-type")?.value;
    const bearerId = this.element.querySelector(".player-light-bearer")?.value;
    if (!lightType || !bearerId) return;
    await requestPartyAction(id, "light", { lightType, bearerId });
  },

  async playerSpell() {
    const id = this.formation?.id;
    if (!id) return;
    const pick = this.element.querySelector(".player-spell")?.value ?? "";
    const override = Number(this.element.querySelector(".player-spell-turns")?.value) || 0;
    if (!pick) return;
    const [casterId, itemId] = pick.split("|");
    const caster = game.actors.get(casterId);
    const item = caster?.items.get(itemId);
    if (!item) return;
    const turns = override || parseSpellTurns(item.system?.duration, caster.system?.details?.level ?? 1) || 0;
    if (!(turns > 0)) {
      ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.spellNeedsTurns"));
      return;
    }
    await requestPartyAction(id, "spell", { name: item.name, casterId, turns });
  },

  async playerRest() {
    const id = this.formation?.id;
    if (id) await requestPartyAction(id, "rest", {});
  },

  async playerCheck(event, target) {
    const id = this.formation?.id;
    if (id) await requestPartyAction(id, "check", { key: target.dataset.check });
  },

  /**
   * Trapbreaking: pick the character, the trap, and the column of the table.
   *
   * The same action for a Judge and for a player — the dialog itself decides
   * whose characters it offers, which traps it is allowed to list, and whether
   * the throw is rolled here or declared to the Judge's client.
   */
  async openTrapbreak() {
    const id = this.formation?.id;
    if (id) openTrapbreakApp(id);
  },
};

/**
 * The frontage the Judge typed, or null to leave the width alone. Blank is
 * not an error. A zero, negative or fractional value is refused rather
 * than rounded; a value wider than the scene is clamped to it, and the
 * Judge is told where it stopped.
 */
function readFrontage(value, formation) {
  if (value === "" || value === null || value === undefined) return null;
  const wanted = Number(value);
  if (!Number.isInteger(wanted) || wanted < 1) {
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.frontageInvalid"));
    return null;
  }
  const max = maxFrontage(getPartyScene(formation) ?? game.scenes?.viewed);
  if (max && wanted > max) {
    ui.notifications.warn(game.i18n.format("ACKS-FORMATION.warn.frontageMax", { max }));
    return max;
  }
  return wanted;
}

/**
 * Form submit handler (GM only): formation rename, default table, frontage,
 * the travel fields, and the party actor's description — the one field the
 * sheet writes to the actor itself.
 */
export async function onChangeForm(event, form, formData) {
  const data = foundry.utils.expandObject(formData.object);
  const formation = gmFormation(this);
  if (!formation) return;
  let changed = false;
  // A refused or clamped entry writes nothing but must still redraw, or the
  // field keeps showing the number the formation did not take.
  let redraw = false;
  const description = foundry.utils.getProperty(data, "system.description");
  const actor = typeof description === "string" ? getPartyActor(formation) : null;
  if (actor && description !== (actor.system?.description ?? "")) {
    await actor.update({ "system.description": description });
    redraw = true;
  }
  if (typeof data.name === "string" && data.name.trim() && data.name !== formation.name) {
    formation.name = data.name.trim();
    // The actor mirrors the formation identity (and vice versa on rename).
    await getPartyActor(formation)?.update({ name: formation.name });
    changed = true;
  }
  if (typeof data.tableId === "string" && data.tableId !== (formation.tableId ?? "")) {
    formation.tableId = data.tableId || null;
    changed = true;
  }
  if ("frontage" in data) {
    const frontage = readFrontage(data.frontage, formation);
    if (frontage === null || frontage !== Number(data.frontage)) redraw = true;
    if (frontage !== null && frontage !== getFrontage(formation)) {
      formation.frontage = frontage;
      changed = true;
    }
  }
  if (changed) await updateFormation(formation);
  // The travel fields ride the same form and write through their own
  // TARGETED patch, applied after any whole-record write above so the stale
  // copy cannot clobber what the patch lays down.
  if (game.user.isGM && data.travel) {
    // The band's mode picker rides this submit: a select reports its change
    // here, where an action (which fires on click) would read the old value.
    if (TRAVEL_MODES.includes(data.travel.mode) && data.travel.mode !== travelOf(formation).mode) {
      await setJourneyMode(formation.id, data.travel.mode, { sceneId: formation.sceneId });
    }
    // A forced march the survival ladder bars is the Judge's call: ask once,
    // here, so a Cancel drops the kind from the write and the select redraws
    // on the day it was.
    let override = false;
    const day = data.travel.day;
    if (day?.kind === "forced" && day.kind !== travelOf(formation).day.kind) {
      const barred = forcedMarchBar(formation);
      if (barred.length) {
        override = await confirmBarOverride(barred);
        if (!override) delete day.kind;
      }
    }
    await applyTravelForm(formation.id, data.travel, { override });
    redraw = true;
  }
  if (changed || redraw) this.render();
}

/** Bind GM drag-drop of actors/tokens as new members; a dropped item is refused (`refuseGoods`). */
export function bindMemberDrop(app) {
  if (!game.user.isGM) return;
  const dragDropConfig = {
    permissions: { drop: () => game.user.isGM },
    callbacks: { drop: (event) => onDropMember(app, event) },
  };
  new foundry.applications.ux.DragDrop.implementation(dragDropConfig).bind(app.element);
}

async function onDropMember(app, event) {
  if (!game.user.isGM) return;
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  // A party carries nothing itself; its members do.
  if (data.type === "Item") return void refuseGoods(app.actor);
  const formation = app.formation;
  if (!formation) return;
  if (data.type === "Actor") {
    const actor = await foundry.utils.getDocumentClass("Actor").fromDropData(data);
    if (actor) await addMember(formation, actor);
  } else if (data.type === "Token") {
    const tokenDoc = await foundry.utils.getDocumentClass("Token").fromDropData(data);
    if (tokenDoc?.actor) await addMember(formation, tokenDoc.actor, tokenDoc);
  }
  app.render();
}
