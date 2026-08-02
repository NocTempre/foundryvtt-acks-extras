/* global game, foundry, ui, fromUuidSync */
import {
  addBlank,
  addMember,
  autoArrange,
  disband,
  getFrontage,
  getPartyActor,
  getPartyToken,
  removeBlank,
  removeMember,
  swapCells,
  syncPartyActorSpeed,
  toggleRole,
  updateFormation,
} from "./formation-model.mjs";
import {
  anchorMap,
  archiveSession,
  closeMapSession,
  saveFogAsMapItem,
  startMapSession,
} from "./map-items.mjs";
import { rollPartyCheck } from "./party-rolls.mjs";
import { requestPartyAction } from "./player-requests.mjs";
import SkillAuditApp from "./skill-audit.mjs";
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
  async openSheet(event, target) {
    const actor = game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
    actor?.sheet?.render(true);
  },

  async disband() {
    const formation = gmFormation(this);
    if (!formation) return;
    const confirmed = await foundry.applications.api.DialogV2.confirm({
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
      await toggleRole(formation, actorId, role);
      this.render();
      return;
    }
    if (!actorId || !ownsActor(actorId)) return;
    await requestPartyAction(formation.id, "role", { actorId, role });
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
    await addLight(formation, type, bearerId);
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
};

/** Form submit handler: formation rename, default table, frontage (GM only). */
export async function onChangeForm(event, form, formData) {
  const data = foundry.utils.expandObject(formData.object);
  const formation = gmFormation(this);
  if (!formation) return;
  let changed = false;
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
  const frontage = Number(data.frontage);
  if (frontage >= 1 && frontage <= 3 && frontage !== (Number(formation.frontage) || 1)) {
    formation.frontage = frontage;
    changed = true;
  }
  if (changed) {
    await updateFormation(formation);
    this.render();
  }
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
