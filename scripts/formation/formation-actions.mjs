/* global game, foundry, ui, fromUuidSync */
import { dealExperience } from "./xp-app.mjs";
import { participantsOf } from "./xp-shares.mjs";
import { openHpTool } from "../lib/apps/hp-app.mjs";
import {
  addMember,
  disband,
  getFrontage,
  getPartyActor,
  getPartyScene,
  getPartyToken,
  isHurried,
  removeMember,
  swapCells,
  syncPartyActorSpeed,
  toggleRole,
  updateFormation,
} from "./formation-model.mjs";
import { postEncounterThrow } from "./encounter-card.mjs";
import { pickPoiTarget } from "./poi.mjs";
import {
  anchorMap,
  archiveSession,
  closeMapSession,
  saveFogAsMapItem,
  startMapSession,
} from "./map-items.mjs";
import {
  carryOutPick,
  pickMarchingOrder,
  promptForOrderName,
  saveTemplate,
} from "./marching-templates.mjs";
import { PARTY_CHECKS, rollPartyCheck } from "./party-rolls.mjs";
import {
  applyCrossingForm, beginCrossing, endCrossing, haulToSurface, jumpFor, landFor, readCrossing, relayRefusalWords, reportLanding, rescueRefusalWords, setPace, setRescuer, throwAll, throwFor,
} from "./crossing.mjs";
import { lockPlanAsJudge, parsePick, planNote, planRefusal, reasonText, resolvePlanRound, resolvePlanTurn, unlockPlan } from "./turn-plan.mjs";
import { deploymentOf, deployVehicle, strikeVehicle } from "../vehicles/deploy.mjs";
import { requestBringIn, requestCrossingPace, requestCrossingRescue, requestCrossingRun, requestCrossingThrow, requestPartyAction, requestPartyForm, requestPartyPress, requestTakeOut, sayPartyFormAnswer, userOwnsMember } from "./player-requests.mjs";
import { spendPicks } from "../lib/picks.mjs";
import { chooseConveyance } from "./conveyance.mjs";
import { announce } from "./announce.mjs";
import { toggleDetachMember, toggleMemberLeft } from "./deployment.mjs";
import { dismount } from "../lib/mount.mjs";
import { appliedEffects } from "../lib/effect-scan.mjs";
import { isLightShuttered, setLightShutter } from "../lib/light.mjs";
import { pressLightCast } from "./light-cast.mjs";
import { refuseGoods } from "../lib/bundles.mjs";
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
import { applyTravelForm, clearDeclaredCountry, travelOf } from "./travel.mjs";
import { applyPartyForm } from "./party-form.mjs";
import { openCountryBrush, PAINT_LAYERS } from "../battlemap/terrain-paint.mjs";
import { COUNTRY_KEYS } from "../battlemap/country.mjs";
import { forcedMarchBar, confirmBarOverride } from "./march-bar.mjs";
import { escape as esc, makeLoc } from "../lib/util.mjs";
import SkillAuditApp, { auditWindowId } from "./skill-audit.mjs";
import { openTrapbreakApp } from "./trapbreak-app.mjs";
import {
  addLight,
  addSpell,
  advanceRounds,
  consumeRations,
  encounterCheck,
  parseSpellTurns,
  rollPartySave,
  storedPosition,
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

/** The app's formation where this seat owns the party actor (Foundry's own test, true for a Judge), else null. The seat the crossing's presses and setup belong to. */
function partyOwnerFormation(app) {
  const formation = app.formation;
  return formation && getPartyActor(formation)?.isOwner ? formation : null;
}

/** Is the current user a Judge, or the owner of a member of the formation? The seat a save, a ration or a check is the press of. */
function seatOwnsMember(formation) {
  return game.user.isGM || userOwnsMember(formation, game.user);
}

/** May the current user write the saved marching orders, the one world list every party shares? A Judge always may. */
function seatCanSaveOrders() {
  return game.user.isGM || !!game.user.can?.("SETTINGS_MODIFY");
}

/** Does the current (non-GM) user own this member's actor? */
function ownsActor(actorId) {
  const actor = game.actors.get(actorId);
  return actor?.testUserPermission?.(game.user, "OWNER") ?? false;
}

/**
 * Reorder a cell. A blank cell is moved by any seat that owns a member, through
 * the `moveBlank` press. GMs move any member directly; players move THEIR OWN
 * character by relaying to the GM, who recomputes the target cell from live
 * state — the click's cell index may be stale by the time the request lands,
 * the actor id never is.
 */
async function reorder(app, target, dir) {
  const formation = app.formation;
  if (!formation) return;
  const cell = Number(target.closest("[data-cell-index]")?.dataset.cellIndex);
  if (Number.isInteger(cell) && formation.members[cell]?.blank) {
    if (!seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "moveBlank", { cell, dir });
    app.render();
    return;
  }
  if (game.user.isGM) {
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

/**
 * A tracked spell's row pressed: the spell's id and the formation, for a seat that
 * owns the spell's caster (a Judge's seat owns them all). A spell with no caster is
 * the Judge's alone.
 */
function trackedSpellPress(app, target) {
  const formation = app.formation;
  const spellId = target.closest("[data-spell-id]")?.dataset.spellId;
  const spell = formation?.spells?.find((s) => s.id === spellId);
  if (!spell || (!game.user.isGM && !ownsActor(spell.casterId))) return null;
  return { formation, spellId };
}

async function adjustTrackedSpell(app, target, delta) {
  const press = trackedSpellPress(app, target);
  if (!press) return;
  await requestPartyPress(press.formation, "spellAdjust", { spellId: press.spellId, delta });
  app.render();
}

/**
 * A press over a gap, for one member: the Judge's seat rolls it, a player's
 * seat relays it for a member they own, and a refusal the Judge's client gives
 * is said as a warning where it has words.
 */
async function crossingJumpPress(sheet, event, target, step) {
  const formation = sheet.formation;
  const actorId = target.dataset.actorId;
  if (!formation || !actorId) return;
  if (!game.user.isGM) {
    if (ownsActor(actorId)) await requestCrossingThrow(formation, actorId, step);
    return;
  }
  const result = await jumpFor(formation, actorId, { step, event });
  const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
  if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.localize(key));
  sheet.render?.();
}

/** The Judge-facing action handlers shared by the formation windows, run with the window as `this`. */
export const SHARED_ACTIONS = {
  /** A group tile: the word for how the whole party moves. A seat that owns a member sets it too. */
  async movementTile(event, target) {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "movementTile", { mode: target.dataset.mode });
    this.render?.();
  },

  /** Fastest for all, and the way back to automatic: the group word clears. */
  async movementFastest() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "movementFastest");
    this.render?.();
  },

  /** Put the arrangement back as the last group press found it. */
  async movementUndo() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "movementUndo");
    this.render?.();
  },

  /** A member's own say on how they travel. A player relays it to the GM client. */
  async conveyancePick(event, target) {
    const formation = this.formation;
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    const pick = target.dataset.pick;
    if (!formation || !actorId || !pick) return;
    if (game.user.isGM) {
      await chooseConveyance(formation.id, actorId, pick);
      this.render?.();
      return;
    }
    if (!ownsActor(actorId)) return;
    await requestPartyAction(formation.id, "conveyance", { actorId, pick });
  },

  /**
   * Divide an adventure's experience among the formation, including
   * henchmen, with the split shown to the Judge before it lands.
   */
  async dealXp() {
    const formation = this.formation;
    if (!formation) return;
    // The deal credits every participant, so a seat deals only where it owns them all.
    if (!game.user.isGM) {
      const participants = participantsOf(formation);
      if (!participants.length || !participants.every((actor) => actor.isOwner)) return;
    }
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
   * put what is found into the foragers' own packs. A seat that owns a member
   * presses it too: the Judge's client works the country (`workTheCountry`).
   */
  async forageDay() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "forageDay");
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
   * district-travel figure, instead of dragging the token block by block. A
   * seat other than the Judge's is offered the places the Judge has not hidden.
   */
  async settlementTravelTo() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const tokenId = await pickPoiTarget(formation, { shownOnly: !game.user.isGM });
    if (tokenId) await requestPartyPress(formation, "hop", { tokenId });
    this.render();
  },


  /** Roll the day's sky from the imported tables. A seat that owns a member presses it too; the Judge's client rolls. */
  async travelWeatherRoll() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "weatherRoll");
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

  /** The Judge retires a record's declaration of one country key; the map or the default answers again. */
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
   * A seat that owns a member presses it too; the Judge's client spends the miles.
   */
  async travelEnterHex() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const label = this.element?.querySelector('input[name="travel.hexLabel"]')?.value ?? "";
    await requestPartyPress(formation, "enterHex", { label });
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
   * derived once, by `closeDay`, not re-derived by the engine. A seat that owns
   * a member presses it too; the Judge's client closes the day.
   */
  async travelEndDay() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "endDay");
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

  /** Out of the party. A player takes out their own, through the GM client. */
  async removeMember(event, target) {
    const formation = this.formation;
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!formation || !actorId) return;
    if (!game.user.isGM) return void (await requestTakeOut(formation, actorId));
    await removeMember(formation, actorId);
    this.render();
  },

  /** One of a player's own actors into the party, from the Order tab's list. */
  async bringIn(event, target) {
    const formation = this.formation;
    const actor = game.actors.get(target.dataset.actorId);
    if (formation && actor) await requestBringIn(formation, actor);
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

  /** Skill audit: how every party roll resolves per member; custom-skill flags. A seat that owns a member opens it too. */
  async openSkillAudit() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const open = foundry.applications.instances.get(auditWindowId(formation.id));
    if (open) open.render({ force: true }).then(() => open.bringToFront());
    else new SkillAuditApp({ formationId: formation.id }).render(true);
  },

  /** Change the party's image like any other actor: actor, prototype, and
   *  placed token all update together. */
  async editPartyImage() {
    const formation = this.formation;
    if (!formation) return;
    const actor = getPartyActor(formation);
    // The picker browses files, which core withholds from a seat without FILES_BROWSE; the actor write needs its OWNER.
    if (!actor?.isOwner || !game.user.can("FILES_BROWSE")) return;
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
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "autoArrange");
    this.render();
  },

  /**
   * Remember the current arrangement under a name the seat gives it. The saved
   * orders are one world setting every party shares, so the write is direct and
   * only a seat that may change world settings makes it.
   */
  async saveMarchingOrder() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation) || !seatCanSaveOrders()) return;
    const name = await promptForOrderName(formation);
    if (!name) return;
    const saved = await saveTemplate(formation, name);
    if (!saved) return;
    ui.notifications.info(
      loc(saved.replaced ? "marching.replaced" : "marching.saved", { name: saved.template.name }),
    );
    this.render();
  },

  /**
   * Put the party back into a saved arrangement, or forget one. The pick runs on
   * this seat. A seat that is not the Judge's sends the chosen order's id to the
   * Judge's client, which writes the record and answers `{ok: false}` while a
   * fight is on; Forget is offered only to a seat that may write world settings,
   * and writes direct.
   */
  async loadMarchingOrder() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const picked = await pickMarchingOrder();
    if (!game.user.isGM && picked?.template && picked.action === "apply") {
      const answer = await requestPartyAction(formation.id, "formUp", { templateId: picked.template.id });
      if (answer?.ok === false) ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.marching.notInCombat"));
      this.render();
      return;
    }
    if (await carryOutPick(formation, picked)) this.render();
  },

  async addBlank() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "addBlank");
    this.render();
  },

  async removeBlank(event, target) {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const cell = Number(target.closest("[data-cell-index]")?.dataset.cellIndex);
    if (!Number.isInteger(cell)) return;
    await requestPartyPress(formation, "removeBlank", { cell });
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

  /**
   * Shutter or open a member's magic light. The write is the effect's own, so
   * it needs no relay: whoever owns the effect makes it, and the redraw comes
   * from the effect hooks on every client.
   */
  async shutterMagicLight(event, target) {
    const actor = game.actors.get(target.dataset.lightActor);
    const effect = appliedEffects(actor).find((e) => e.id === target.dataset.lightEffect);
    if (!effect) return;
    await setLightShutter(effect, !isLightShuttered(effect));
  },

  /** Cast the light spell the Kit tab's row has picked, as the Magic tab's Cast does (`pressLightCast`). */
  async castLightSpell(event, target) {
    await pressLightCast(this, event, target);
  },

  /**
   * Pace (RR p. 263): careful exploration, or hurried. A seat that owns a member
   * sets it too; the press names the pace it wants, so a second press from another
   * seat changes nothing.
   */
  async togglePace() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await requestPartyPress(formation, "pace", { hurried: !isHurried(formation) });
    this.render();
  },

  async addLight() {
    const formation = gmFormation(this);
    if (!formation) return;
    const type = this.element.querySelector("[data-pick=lightType]")?.value;
    const bearerId = this.element.querySelector("[data-pick=lightBearer]")?.value;
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

  /** The Judge puts out any light; a seat that owns the bearer puts out theirs, through the relay. */
  async removeLight(event, target) {
    const formation = this.formation;
    if (!formation) return;
    const lightId = target.closest("[data-light-id]")?.dataset.lightId;
    const light = formation.lights.find((l) => l.id === lightId);
    if (!light || (!game.user.isGM && !ownsActor(light.bearerId))) return;
    await requestPartyPress(formation, "lightRemove", { lightId });
    this.render();
  },

  /**
   * Track a spell: the Judge writes it direct; a seat that owns the caster sends the
   * name, the turns and the caster to the Judge's client (`spell`, which checks the
   * ownership again).
   */
  async addSpell() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const pick = this.element.querySelector("[data-pick=spellPick]")?.value ?? "";
    const manualName = this.element.querySelector("[data-pick=spellName]")?.value?.trim() ?? "";
    const manualTurns = Number(this.element.querySelector("[data-pick=spellTurns]")?.value) || 0;
    const manualCaster = this.element.querySelector("[data-pick=spellCaster]")?.value ?? null;

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
    if (game.user.isGM) {
      await addSpell(formation, { name, casterId, turns });
      this.render();
      return;
    }
    if (!casterId || !ownsActor(casterId)) return;
    await requestPartyAction(formation.id, "spell", { name, casterId, turns });
  },

  async removeSpell(event, target) {
    const press = trackedSpellPress(this, target);
    if (!press) return;
    await requestPartyPress(press.formation, "spellRemove", { spellId: press.spellId });
    this.render();
  },

  async spellPlus(event, target) {
    await adjustTrackedSpell(this, target, 1);
  },

  async spellMinus(event, target) {
    await adjustTrackedSpell(this, target, -1);
  },

  /**
   * Members roll the pressed save; the saves rail's Magical toggle
   * (`app.magical`) says against what. A Judge rolls for every member; a seat
   * owning a member rolls for the members it owns, the save being each
   * character's own act.
   */
  async partySave(event, target) {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    const magical = this.magical ?? true;
    await rollPartySave(formation, target.dataset.save, game.user.isGM ? { magical } : { magical, only: (actor) => actor.isOwner });
  },

  /**
   * One party check, from a cell that names it. A Judge rolls it directly; a
   * seat owning a member declares it to the Judge's client (the `check` op),
   * which rolls it and keeps the result.
   */
  async partyCheck(event, target) {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    if (!game.user.isGM) {
      await requestPartyAction(formation.id, "check", { key: target.dataset.check });
      return;
    }
    await rollPartyCheck(formation, target.dataset.check);
    this.render();
  },

  /**
   * The party's checks, offered in one dialog: the quick tools rail has one
   * press for all of them. A `solo` check is one character's action and is
   * not offered; the dialog's answer is the picked check's key.
   */
  async partyChecks() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
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
    if (!game.user.isGM) {
      await requestPartyAction(formation.id, "check", { key: picked });
      return;
    }
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

  /**
   * A stationary turn: the clock spends it once and the turn plan resolves. A
   * seat that owns a member asks the Judge for it; nothing moves until the
   * Judge presses.
   */
  async advanceTurn() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    if (!game.user.isGM) {
      await requestPartyAction(formation.id, "askPress", { press: "turn" });
      return;
    }
    await resolvePlanTurn(formation);
    this.render();
  },

  /**
   * One bookkeeping round (1 minute) — hasty actions, short delays. The press
   * also resolves the plan's round-length entries (`resolvePlanRound`); a round
   * that movement, combat or a crossing counts does not. A seat that owns a
   * member asks the Judge for it.
   */
  async advanceRound() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    if (!game.user.isGM) {
      await requestPartyAction(formation.id, "askPress", { press: "round" });
      return;
    }
    await advanceRounds(formation, 1, { reason: "manual" });
    await resolvePlanRound(formation);
    this.render();
  },

  /**
   * Search here: the scene search opens at the place the party stands in (or its
   * screen where one is open). A seat that owns a member sends the press to the
   * Judge's client, which makes the Judge's own call.
   */
  async searchHere() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    if (!game.user.isGM) {
      await requestPartyPress(formation, "searchHere");
      return;
    }
    await globalThis.acksExtras?.sceneSearch?.searchHere?.({ partyId: formation.id });
  },

  /**
   * The rest: the turn rests whatever the plan says, and the plan resolves. A
   * seat that owns a member declares it, and the Judge's client takes the turn.
   */
  async restTurn() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    if (!game.user.isGM) {
      await requestPartyAction(formation.id, "rest");
      return;
    }
    await resolvePlanTurn(formation, { resting: true });
    this.render();
  },

  /**
   * Lock the choice in a member's Turn plan row. The Judge writes it: a
   * refusal a player would get is a warning on the row and the lock stands,
   * and only a choice nothing can be built from stays refused. A player is
   * refused here with the reason, in a toast and on the row, since the relay
   * answers nothing, and otherwise relays the request for the Judge's client
   * to decide again.
   */
  async planLock(_event, target) {
    const formation = this.formation;
    const row = target.closest("[data-plan-actor]");
    const actorId = row?.dataset.planActor;
    const pick = parsePick(row?.querySelector("[data-pick]")?.value);
    if (!formation || !actorId || !pick) return;
    const request = { actorId, key: pick.key, option: pick.option };
    if (!game.user.isGM && !ownsActor(actorId)) return;
    const actor = game.actors.get(actorId);
    const turn = formation.clock?.turnsTotal ?? 0;
    const note = (kind, reason) => {
      const held = planNote(kind, reason, actor, turn);
      if (held) this.planNotes.set(actorId, held);
      else this.planNotes.delete(actorId);
      this.render();
    };
    this.planNotes.delete(actorId);
    if (game.user.isGM) {
      const done = await lockPlanAsJudge(formation, { ...request, by: game.user.id });
      if (done.ok) {
        if (done.warned) note("warned", done.warned.reason);
        return;
      }
      const said = reasonText(done.reason, actor);
      if (said) ui.notifications.warn(said);
      note("refused", done.reason);
      return;
    }
    const refused = planRefusal(formation, request);
    if (refused) {
      const said = reasonText(refused.reason, actor);
      if (said) ui.notifications.warn(said);
      note("refused", refused.reason);
      return;
    }
    await requestPartyAction(formation.id, "plan", request);
  },

  /** Clear a member's Turn plan row: they keep watch again. */
  async planUnlock(_event, target) {
    const formation = this.formation;
    const actorId = target.closest("[data-plan-actor]")?.dataset.planActor;
    if (!formation || !actorId) return;
    this.planNotes.delete(actorId);
    if (game.user.isGM) {
      await unlockPlan(formation, actorId);
      return;
    }
    if (!ownsActor(actorId)) return;
    await requestPartyAction(formation.id, "plan", { actorId, unlock: true });
  },

  /** Open a crossing of the kind the begin row's pick names. The Judge's seat opens it; another seat that owns the party actor sends the press. */
  async crossingBegin(_event, target) {
    const formation = partyOwnerFormation(this);
    const kind = target.closest(".acks-extras-crossing")?.querySelector("[data-pick='crossing-kind']")?.value;
    if (!formation || !kind) return;
    if (game.user.isGM) await beginCrossing(formation, kind);
    else await requestCrossingRun(formation, "begin", { kind });
    this.render?.();
  },

  /** Close the crossing, members and all. The Judge's seat closes it; another seat that owns the party actor sends the press. */
  async crossingEnd() {
    const formation = partyOwnerFormation(this);
    if (!formation) return;
    if (game.user.isGM) await endCrossing(formation);
    else await requestCrossingRun(formation, "end");
    this.render?.();
  },

  /**
   * One stretch thrown for every member whose row allows it with no warning.
   * The Judge's seat throws for all; another seat that owns the party actor
   * sends the press and the Judge's client throws for the members it owns.
   */
  async crossingThrowAll() {
    const formation = partyOwnerFormation(this);
    if (!formation) return;
    const { left } = game.user.isGM ? await throwAll(formation) : (await requestCrossingRun(formation, "throwAll")) ?? {};
    if (left) ui.notifications.info(loc("crossing.leftForJudge", { count: left }));
    this.render?.();
  },

  /**
   * One member's throw. The Judge's seat throws it; a player's seat hands the
   * press to `requestCrossingThrow`, which relays it to the GM client.
   */
  async crossingThrow(_event, target) {
    const formation = this.formation;
    const actorId = target.dataset.actorId;
    if (!formation || !actorId) return;
    if (!game.user.isGM) {
      if (ownsActor(actorId)) await requestCrossingThrow(formation, actorId);
      return;
    }
    const result = await throwFor(formation, actorId);
    const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
    if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.localize(key));
    this.render?.();
  },

  /**
   * One stuck squeezer's way out, the step on the button: wiggling backwards on
   * the save or pushing forward on the Dungeonbashing throw. The Judge's seat
   * throws it; a player's seat hands the press to `requestCrossingThrow`.
   */
  async crossingEscape(event, target) {
    const formation = this.formation;
    const actorId = target.dataset.actorId;
    const step = target.dataset.step;
    if (!formation || !actorId || !step) return;
    if (!game.user.isGM) {
      if (ownsActor(actorId)) await requestCrossingThrow(formation, actorId, step);
      return;
    }
    const result = await throwFor(formation, actorId, { step, event });
    const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
    if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.format(key, { name: game.actors?.get?.(actorId)?.name ?? "" }));
    this.render?.();
  },

  /**
   * One member's jump attempt over a gap. The Judge's seat rolls it; a
   * player's seat hands the press to `requestCrossingThrow`, which relays it.
   */
  async crossingAttempt(event, target) {
    return crossingJumpPress(this, event, target, "attempt");
  },

  /** A hanging jumper's climb up, pressed the same way as the attempt. */
  async crossingClimbUp(event, target) {
    return crossingJumpPress(this, event, target, "climbUp");
  },

  /**
   * A member's landing save, rolled through the system's own save roll. The
   * Judge's alone: a player's seat has no press for it.
   */
  async crossingLand(event, target) {
    const formation = gmFormation(this);
    const actorId = target.dataset.actorId;
    if (!formation || !actorId) return;
    const result = await landFor(formation, actorId, { event });
    const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
    if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.localize(key));
    this.render?.();
  },

  /**
   * A failed landing reported on the footing the row's pick names, with the
   * figures it yields. The Judge's alone; no hit point or condition is applied,
   * and a member who has attempted the jump has the pick written to the record.
   */
  async crossingLandingFailed(_event, target) {
    const formation = gmFormation(this);
    const actorId = target.dataset.actorId;
    const footing = target.closest(".acks-extras-crossing-landing")?.querySelector("[data-pick='crossing-footing']")?.value;
    if (!formation || !actorId) return;
    const result = await reportLanding(formation, actorId, footing);
    const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
    if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.localize(key));
    this.render?.();
  },

  /**
   * A drowning member brought to the surface: afloat again, the rescuer and the
   * held drowning let go. The Judge's alone: a player's seat has no press for it.
   */
  async crossingHaul(_event, target) {
    const formation = gmFormation(this);
    const actorId = target.dataset.actorId;
    if (!formation || !actorId) return;
    const result = await haulToSurface(formation, actorId);
    const key = `ACKS-FORMATION.crossing.refusal.${result.refused}`;
    if (!result.ok && game.i18n.has(key)) ui.notifications.warn(game.i18n.localize(key));
    this.render?.();
  },

  async encounterNow() {
    const formation = gmFormation(this);
    if (!formation) return;
    await encounterCheck(formation, { manual: true });
  },

  /** Spend the party's rations. A Judge spends for every member; a seat owning a member spends for the members it owns, whose packs it may write. */
  async consumeRations() {
    const formation = this.formation;
    if (!formation || !seatOwnsMember(formation)) return;
    await consumeRations(formation, game.user.isGM ? {} : { only: (actor) => actor.isOwner });
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
    // Re-anchor the tracker so distance covered while paused is not counted,
    // at the stored corner: a move this client is still drawing has its
    // prepared corner part way along.
    const token = getPartyToken(formation);
    if (token) formation.clock.lastPosition = storedPosition(token);
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
 * Form submit handler: the party actor's description — the one field the
 * sheet writes to the actor itself, written by whoever owns that actor — and,
 * on a seat that owns a member, the record's fields (`applyPartyForm`): the
 * Judge's applies the whole submit, any other seat relays the allow-listed
 * part to the Judge's client (`requestPartyForm`). The crossing's setup fields
 * are flags on the party actor, written from the seat of whoever owns it.
 */
export async function onChangeForm(event, form, formData) {
  const data = foundry.utils.expandObject(formData.object);
  const formation = this.formation;
  if (!formation) return;
  let changed = false;
  // A refused or clamped entry writes nothing but must still redraw, or the
  // field keeps showing the number the formation did not take.
  let redraw = false;
  const description = foundry.utils.getProperty(data, "system.description");
  const actor = typeof description === "string" ? getPartyActor(formation) : null;
  if (actor?.isOwner && description !== (actor.system?.description ?? "")) {
    await actor.update({ "system.description": description });
    redraw = true;
  }
  // The crossing's setup fields are flags on the party actor, so they follow
  // its owner whether or not the seat owns a member: each changed one is
  // written by its own path, from this client.
  if (data.crossing && getPartyActor(formation)?.isOwner && readCrossing(formation)) {
    await applyCrossingForm(formation, data.crossing);
    redraw = true;
  }
  // The record's fields below follow the seat that owns a member: the Judge's
  // applies them here, any other seat sends them to the Judge's client.
  if (!seatOwnsMember(formation)) {
    if (redraw) this.render();
    return;
  }
  if (!game.user.isGM) {
    // A refused field redraws as well, or the control keeps the refused value.
    await requestPartyForm(formation, data);
    this.render();
    return;
  }
  // A forced march the survival ladder bars is the Judge's call: ask once,
  // here, so a Cancel drops the kind from the write and the select redraws
  // on the day it was.
  let override = false;
  const day = data.travel?.day;
  if (day?.kind === "forced" && day.kind !== travelOf(formation).day.kind) {
    const barred = forcedMarchBar(formation);
    if (barred.length) {
      override = await confirmBarOverride(barred);
      if (!override) delete day.kind;
    }
  }
  const applied = await applyPartyForm(formation, data, { judge: true, override });
  sayPartyFormAnswer(applied);
  changed = applied.changed;
  redraw ||= applied.redraw;
  if (changed || redraw) this.render();
}

/** The rescuer selects already carrying a listener, so a re-render of a part that kept its element does not stack a second. */
const rescuerBound = new WeakSet();

/**
 * Bind each drowning member's Rescuer select: a change names or clears the
 * rescuer. The Judge's seat writes it; a player's relays it for a rescuer they
 * own (`requestCrossingRescue`). The select is a staging pick, so its change
 * is no form submit, and it is spent before the write so the redraw shows what
 * was stored; a refusal is said as a warning and the redraw puts the stored
 * rescuer back.
 */
export function bindCrossingRescuer(app) {
  for (const select of app.element?.querySelectorAll?.("select[data-rescue-for]") ?? []) {
    if (rescuerBound.has(select)) continue;
    rescuerBound.add(select);
    select.addEventListener("change", async () => {
      const formation = app.formation;
      const drownedId = select.dataset.rescueFor;
      if (!formation || !drownedId) return;
      spendPicks(app.element, [select.dataset.pick]);
      if (game.user.isGM) {
        const result = await setRescuer(formation, drownedId, select.value);
        if (!result.ok) {
          const said = rescueRefusalWords(result.refused, game.actors.get(select.value));
          if (said) ui.notifications.warn(said);
        }
      } else {
        await requestCrossingRescue(formation, drownedId, select.value);
      }
      app.render?.();
    });
  }
}

/** The pace selects already carrying a listener, so a re-render of a part that kept its element does not stack a second. */
const paceBound = new WeakSet();

/**
 * Bind each holder's Pace select: a change sets or clears the member's pace. The
 * Judge's seat writes it; a player's relays it for a member they own
 * (`requestCrossingPace`). The select is a staging pick, so its change is no form
 * submit, and it is spent before the write so the redraw shows what was stored; a
 * refusal is said as a warning and the redraw puts the stored pace back.
 */
export function bindCrossingPace(app) {
  for (const select of app.element?.querySelectorAll?.("select[data-pace-for]") ?? []) {
    if (paceBound.has(select)) continue;
    paceBound.add(select);
    select.addEventListener("change", async () => {
      const formation = app.formation;
      const actorId = select.dataset.paceFor;
      if (!formation || !actorId) return;
      spendPicks(app.element, [select.dataset.pick]);
      if (game.user.isGM) {
        const result = await setPace(formation, actorId, select.value);
        if (!result.ok) {
          const said = relayRefusalWords(result.refused, game.actors.get(actorId));
          if (said) ui.notifications.warn(said);
        }
      } else {
        await requestCrossingPace(formation, actorId, select.value);
      }
      app.render?.();
    });
  }
}

/**
 * Bind drag-drop of actors/tokens as new members: the Judge's directly, a
 * player's own through the GM client. A dropped item is refused (`refuseGoods`).
 */
export function bindMemberDrop(app) {
  if (!game.user.isGM && !app.isEditable) return;
  const dragDropConfig = {
    permissions: { drop: () => game.user.isGM || app.isEditable },
    callbacks: { drop: (event) => onDropMember(app, event) },
  };
  new foundry.applications.ux.DragDrop.implementation(dragDropConfig).bind(app.element);
}

async function onDropMember(app, event) {
  const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
  // A party carries nothing itself; its members do.
  if (data.type === "Item") return void refuseGoods(app.actor);
  const formation = app.formation;
  if (!formation) return;
  const tokenDoc = data.type === "Token" ? await foundry.utils.getDocumentClass("Token").fromDropData(data) : null;
  const actor = data.type === "Actor" ? await foundry.utils.getDocumentClass("Actor").fromDropData(data) : tokenDoc?.actor;
  if (!actor) return;
  if (!game.user.isGM) return void (await requestBringIn(formation, actor, tokenDoc));
  await addMember(formation, actor, tokenDoc);
  app.render();
}
