/* global game, foundry, ui, fromUuidSync */
import { dealExperience } from "./xp-app.mjs";
import {
  addBlank,
  addMember,
  autoArrange,
  disband,
  getFormation,
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
import { maybeHexThrow, postEncounterThrow, rollDayEncounters } from "./encounter-card.mjs";
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
import { rollPartyCheck } from "./party-rolls.mjs";
import { requestPartyAction } from "./player-requests.mjs";
import { announce } from "./announce.mjs";
import { toggleDetachMember, deployMembers, recallMembers, isMemberDeployed } from "./deployment.mjs";
import { dismount } from "../lib/mount.mjs";
import { runSettlementTurn, runSettlementDays } from "./settlement-turn.mjs";
import { runForageDay } from "./forage-run.mjs";
import { runSearchHour } from "./search-run.mjs";
import { askStrayAndBegin, confirmDiscovery, confirmReanchor } from "./lost-dialog.mjs";
import { applyTravelForm, setJourneyMode, enterHex, endDay, rollWeatherNow } from "./travel.mjs";
import { travelReadout } from "./formation-view.mjs";
import { partySpeed } from "./formation-model.mjs";
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
   * Divide an adventure's experience among the formation. Lives here rather
   * than on core's party overview because the formation is this module's
   * roster of record — and because core's own division counts only
   * `character` actors at a flat share, which loses the henchman half and
   * hands nothing to the Judge to check before it lands.
   */
  async dealXp() {
    const formation = gmFormation(this);
    if (!formation) return;
    await dealExperience(formation);
    this.render?.();
  },

  /**
   * Leave a casualty where they fell, or go back for them. A member left
   * behind sets no pace and weighs on no Carrier, but stays on the roster and
   * keeps their share of the experience — the party owes them that whether or
   * not it brought the body out.
   */
  async toggleLeftBehind(event, target) {
    const formation = gmFormation(this);
    const actorId = target.closest("[data-actor-id]")?.dataset.actorId;
    if (!formation || !actorId) return;
    const member = formation.members.find((m) => m.actorId === actorId);
    if (!member) return;
    const leaving = !member.left;
    member.left = leaving;
    await updateFormation(formation);

    // Leaving someone means leaving them SOMEWHERE. Their token drops onto the
    // scene where the party stood, so the map shows the body and the party can
    // find its way back; going back for them recalls it into the party token.
    // They stay on the roster throughout — a member left behind is still owed
    // their share of the experience.
    //
    // Deployed WITHOUT the detached flag on purpose: that flag arms the
    // movement leash that keeps a scouting detachment near the party, and a
    // body on the floor is not going to follow anybody. The party walks away,
    // which is the entire point of leaving them.
    //
    // A combat has its own reasons for who is on the map, so this never
    // touches the canvas mid-fight — the roster still records the decision.
    if (!formation.combat?.active) {
      if (leaving && !isMemberDeployed(member)) {
        await deployMembers(formation, { members: [member] });
      } else if (!leaving && isMemberDeployed(member)) {
        await recallMembers(formation, { members: [member] });
      }
    }
    this.render?.();
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

  /** Begin a journey, or return to the delve. Couples the two clocks. */
  async travelMode() {
    const formation = gmFormation(this);
    if (!formation) return;
    await setJourneyMode(formation.id, formation.travel?.mode !== "journey" ? "journey" : "delve");
    this.render();
  },

  /**
   * One city turn: the party walks, may lose its way, and the street gets its
   * chance. Rolls here rather than in the pure tick, which owns no dice.
   */
  async settlementTurn() {
    const formation = gmFormation(this);
    if (!formation) return;
    await runSettlementTurn(formation);
    this.render();
  },

  /**
   * A stay holed up, spent in days. Offered instead of the turn tick when the
   * party is somewhere it is not going anywhere from.
   */
  async settlementDays() {
    const formation = gmFormation(this);
    if (!formation) return;
    await runSettlementDays(formation);
    this.render();
  },

  /**
   * Work the country: roll whatever hours the day board set aside for it, and
   * put what is found into the foragers' own packs.
   */
  async forageDay() {
    const formation = gmFormation(this);
    if (!formation) return;
    // `activities` is the day board's own field name; there is no `slots`.
    const slots = formation.travel?.day?.activities ?? [];
    const kinds = slots.includes("forage") ? ["food", "water", "firewood"] : [];
    const hunting = slots.includes("hunt");
    if (!kinds.length && !hunting) {
      ui.notifications?.info(game.i18n.localize("ACKS-FORMATION.forageRun.noHours"));
      return;
    }
    await runForageDay(formation, { kinds, hunting });
    this.render();
  },

  /**
   * Spend an hour looking. `present` comes from the Judge's own map — the
   * module never invents whether a hex holds anything.
   */
  async searchHour(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    const present = !!this.element?.querySelector?.('[name="camp.present"]')?.checked;
    await runSearchHour(formation, { present });
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

  /** Enter the city, or leave it. The third mode, on the same clock rule. */
  async settlementMode() {
    const formation = gmFormation(this);
    if (!formation) return;
    await setJourneyMode(formation.id, formation.travel?.mode !== "settlement" ? "settlement" : "delve");
    this.render();
  },


  /** The Judge rolls the day's sky from the imported tables. */
  async travelWeatherRoll() {
    const formation = gmFormation(this);
    if (!formation) return;
    await rollWeatherNow(formation.id);
    this.render();
  },

  /** The party crosses into the next hex; the label input names it. */
  async travelEnterHex() {
    const formation = gmFormation(this);
    if (!formation) return;
    const label = this.element?.querySelector('input[name="travel.hexLabel"]')?.value ?? "";
    await enterHex(formation.id, label);
    await maybeHexThrow(getFormation(formation.id));
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
    const r = travelReadout(formation, partySpeed(formation));
    const entry = await endDay(formation.id, {
      miles: r.camp ? 0 : r.milesPerDay,
      hexes: r.camp ? 0 : r.hexesPerDay,
    });
    if (entry) await rollDayEncounters(getFormation(formation.id), entry);
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

  /**
   * Step out of the party token, or step back in. The GM moves anyone; a player
   * moves their own character, which is the point — scouting ahead is a thing
   * you decide to do, not a thing you ask permission for.
   */
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

  /** Pace (RR p. 263): careful exploration, or hurried at combat speed ×10
   *  rounds per turn — losing mapping, poles, and hasty search, and making
   *  much more noise. */
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

  async partySave(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    const magical = this.element.querySelector(".save-magical")?.checked ?? true;
    await rollPartySave(formation, target.dataset.save, { magical });
  },

  async partyCheck(event, target) {
    const formation = gmFormation(this);
    if (!formation) return;
    await rollPartyCheck(formation, target.dataset.check);
    this.render();
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
    formation.clock.paused = !formation.clock.paused;
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
 * The frontage the Judge typed, or null to leave the width alone.
 *
 * Any positive whole number is a line: a war party crossing open ground is as
 * wide as it likes. A zero, a negative or a fraction is REFUSED out loud rather
 * than rounded into something legal — a field that silently corrects what was
 * typed reads as a field that ignored it. Blank is not an error; it is a
 * half-finished edit.
 *
 * The ceiling is the map. A line wider than the scene has nowhere to put its
 * flanks, so the request is honoured as far as the scene goes and the Judge is
 * told where it stopped.
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

/** Form submit handler: formation rename, default table, frontage (GM only). */
export async function onChangeForm(event, form, formData) {
  const data = foundry.utils.expandObject(formData.object);
  const formation = gmFormation(this);
  if (!formation) return;
  let changed = false;
  // A refused or clamped entry writes nothing but must still redraw, or the
  // field keeps showing the number the formation did not take.
  let redraw = false;
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
  // The travel panel's fields ride the same form and write through their own
  // TARGETED patch, applied after any whole-record write above so the stale
  // copy cannot clobber what the patch lays down.
  if (game.user.isGM && data.travel) {
    await applyTravelForm(formation.id, data.travel);
    redraw = true;
  }
  if (changed || redraw) this.render();
}

/** Bind GM drag-drop of actors/tokens as new members. */
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
