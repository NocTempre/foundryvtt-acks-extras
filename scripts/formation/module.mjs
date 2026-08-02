/* global Hooks, game, foundry, canvas, ui, CONFIG, Actor */
import {
  DEFAULT_PARTY_IMAGE,
  DEFAULT_ENCOUNTER_EVERY,
  DEFAULT_ENCOUNTER_TARGET,
  FLAG_FORMATION_ID,
  MODULE_ID,
} from "./constants.mjs";
import { onCombatEnd, onCombatRoundChange, onPartyCombatantCreated } from "./combat-bridge.mjs";
import { SETTING_ABILITY_OVERRIDES, initLadders } from "./ability-bridge.mjs";
import { registerEncounterZone } from "./encounter-zone.mjs";
import {
  SETTING_FORMATIONS,
  addMember,
  createFormation,
  dissolveFormation,
  getFormation,
  getFormationForActor,
  getFormations,
  getPartyActor,
  heldLightCount,
  getPartyToken,
  patchFormation,
  pruneFormations,
  syncPartyActorSpeed,
  updateFormation,
} from "./formation-model.mjs";
import { anchorMap, archiveSession, registerMapSocket, saveFogAsMapItem, startMapSession } from "./map-items.mjs";
import { registerFuzzyRulers } from "./measure-fuzz.mjs";
import { PARTY_TYPE, PartyData, PartySheet } from "./party-actor.mjs";
import { PARTY_CHECKS, rollPartyCheck } from "./party-rolls.mjs";
import { registerRequestSocket, requestPartyAction } from "./player-requests.mjs";
import { registerSkillFlagEditor } from "./skill-audit.mjs";
import { syncEnvironments } from "./scene-sync.mjs";
import { addLight, advanceRounds, advanceTurns, onPartyTokenMoved, removeLight, toggleLight, toggleShield } from "./turn-engine.mjs";

/** Open the formation window. */
function openPartySheet() {
  const formation = Object.values(getFormations())[0] ?? null;
  const actor = formation ? game.actors.get(formation.actorId) : null;
  if (actor) actor.sheet.render(true);
  else ui.notifications.info(game.i18n.localize("ACKS-FORMATION.warn.noFormationYet"));
}

/** True on exactly one client: the active GM responsible for automation. */
function isPrimaryGM() {
  return game.users.activeGM?.isSelf ?? false;
}

Hooks.once("init", () => {
  /* --- Settings --- */
  game.settings.register(MODULE_ID, SETTING_FORMATIONS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  game.settings.register(MODULE_ID, "partyTokenImage", {
    name: "ACKS-FORMATION.settings.partyTokenImage.name",
    hint: "ACKS-FORMATION.settings.partyTokenImage.hint",
    scope: "world",
    config: true,
    type: String,
    filePicker: "image",
    default: DEFAULT_PARTY_IMAGE,
  });

  game.settings.register(MODULE_ID, "playersMoveParty", {
    name: "ACKS-FORMATION.settings.playersMoveParty.name",
    hint: "ACKS-FORMATION.settings.playersMoveParty.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "advanceWorldTime", {
    name: "ACKS-FORMATION.settings.advanceWorldTime.name",
    hint: "ACKS-FORMATION.settings.advanceWorldTime.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "publicTurnCards", {
    name: "ACKS-FORMATION.settings.publicTurnCards.name",
    hint: "ACKS-FORMATION.settings.publicTurnCards.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Light-source equipment enforcement (RR p265): lighting a torch needs a
  // torch, a lantern needs the lantern AND a flask of oil. "require" (default)
  // blocks lighting without the gear; "warn" lights anyway with a warning;
  // "off" ignores equipment entirely. When enforced (require/warn) the fuel is
  // consumed — the torch/candle itself, or a lantern's flask of oil.
  game.settings.register(MODULE_ID, "lightItemEnforcement", {
    name: "ACKS-FORMATION.settings.lightItemEnforcement.name",
    hint: "ACKS-FORMATION.settings.lightItemEnforcement.hint",
    scope: "world",
    config: true,
    type: String,
    choices: {
      require: "ACKS-FORMATION.settings.lightItemEnforcement.require",
      warn: "ACKS-FORMATION.settings.lightItemEnforcement.warn",
      off: "ACKS-FORMATION.settings.lightItemEnforcement.off",
    },
    default: "require",
  });

  game.settings.register(MODULE_ID, "encounterEvery", {
    name: "ACKS-FORMATION.settings.encounterEvery.name",
    hint: "ACKS-FORMATION.settings.encounterEvery.hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_ENCOUNTER_EVERY,
    range: { min: 0, max: 12, step: 1 },
  });

  game.settings.register(MODULE_ID, "encounterTarget", {
    name: "ACKS-FORMATION.settings.encounterTarget.name",
    hint: "ACKS-FORMATION.settings.encounterTarget.hint",
    scope: "world",
    config: true,
    type: Number,
    default: DEFAULT_ENCOUNTER_TARGET,
    range: { min: 2, max: 6, step: 1 },
  });

  game.settings.register(MODULE_ID, "manageFog", {
    name: "ACKS-FORMATION.settings.manageFog.name",
    hint: "ACKS-FORMATION.settings.manageFog.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "mapperNeedsLight", {
    name: "ACKS-FORMATION.settings.mapperNeedsLight.name",
    hint: "ACKS-FORMATION.settings.mapperNeedsLight.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "syncTokenLight", {
    name: "ACKS-FORMATION.settings.syncTokenLight.name",
    hint: "ACKS-FORMATION.settings.syncTokenLight.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  game.settings.register(MODULE_ID, "signalAffectsEncounters", {
    name: "ACKS-FORMATION.settings.signalAffectsEncounters.name",
    hint: "ACKS-FORMATION.settings.signalAffectsEncounters.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: false,
  });

  game.settings.register(MODULE_ID, "fuzzMeasurement", {
    name: "ACKS-FORMATION.settings.fuzzMeasurement.name",
    hint: "ACKS-FORMATION.settings.fuzzMeasurement.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // GM rulings from the Skill Audit window: which abilities party-roll
  // automation may use. Absent key = automatic (see ability-bridge).
  game.settings.register(MODULE_ID, SETTING_ABILITY_OVERRIDES, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  /* --- Encounter Zone region behavior --- */
  registerEncounterZone();

  /* --- Party-roll flag editor on ability item sheets --- */
  registerSkillFlagEditor();

  /* --- Party actor sub-type & sheet --- */
  Object.assign(CONFIG.Actor.dataModels, { [PARTY_TYPE]: PartyData });
  foundry.applications.apps.DocumentSheetConfig.registerSheet(Actor, MODULE_ID, PartySheet, {
    types: [PARTY_TYPE],
    makeDefault: true,
    label: "ACKS-FORMATION.sheet.party",
  });

  /* --- Public API (used by macros and companion modules, e.g. traps) --- */
  const api = {
    open: openPartySheet,
    PartySheet,
    advanceTurns,
    advanceRounds,
    getFormations,
    rollPartyCheck,
    PARTY_CHECKS,
    startMapSession,
    archiveSession,
    anchorMap,
    saveFogAsMapItem,
    requestPartyAction,
    // Light ↔ hand integration (acks-equipment). heldLightCount tells equipment
    // how many hands an actor's lights occupy; getFormationForActor + the light
    // mutators let equipment's sheet controls light/douse/shutter by actor.
    heldLightCount,
    getFormationForActor,
    addLight,
    toggleLight,
    removeLight,
    toggleShield,
  };
  const module = game.modules.get(MODULE_ID);
  if (module) module.api = api;
  globalThis.acksFormation = api;

  /* --- Template preload (best-effort) --- */
  try {
    foundry.applications.handlebars.loadTemplates([
      `modules/${MODULE_ID}/templates/formation/formation-body.hbs`,
      `modules/${MODULE_ID}/templates/formation/skill-audit.hbs`,
    ]);
  } catch (err) {
    console.warn(`${MODULE_ID} | template preload skipped`, err);
  }
});

/* Wrap the ruler classes after every module's init has configured them. */
Hooks.once("setup", () => {
  try {
    registerFuzzyRulers();
  } catch (err) {
    console.error(`${MODULE_ID} | failed to register fuzzy rulers`, err);
  }
});

Hooks.once("ready", () => {
  if (game.system?.id !== "acks") {
    console.warn(`${MODULE_ID} | Active system is not "acks"; exploration speeds cannot be read from actors.`);
  }
  registerMapSocket();
  registerRequestSocket();
  // Index the skill ladders acks-content imported (item directory or the world
  // compendium it writes to when importToCompendium is on).
  initLadders();
  if (isPrimaryGM()) {
    // Prune dead records FIRST (formations whose party actor is gone — the
    // phantom source), then sync the environments of what remains.
    pruneFormations()
      .then(() => syncEnvironments())
      .catch((err) => console.error(`${MODULE_ID} | startup sync failed`, err));
  }
});

/* -------------------------------------------- */
/*  Actor deletion cleanup                       */
/* -------------------------------------------- */

/* Deleting a party actor dissolves its formation: stashed member tokens are
 * restored and the record removed. Without this, the record lingered, the next
 * "Add to party" adopted it, and ensurePartyActor resurrected the deleted
 * actor — the "phantom actor that cannot be deleted". A deleted MEMBER actor
 * is likewise dropped from every formation, so its ghost cannot hold a rank. */
Hooks.on("deleteActor", (actor) => {
  if (!isPrimaryGM()) return;
  if (actor.type === PARTY_TYPE) {
    const formation = Object.values(getFormations()).find((f) => f.actorId === actor.id);
    if (!formation) return;
    dissolveFormation(formation)
      .then(() => PartySheet.refreshAll())
      .catch((err) => console.error(`${MODULE_ID} | formation cleanup failed`, err));
    return;
  }
  const formations = Object.values(getFormations()).filter((f) => f.members.some((m) => m.actorId === actor.id));
  for (const formation of formations) {
    patchFormation(formation.id, (rec) => {
      rec.members = rec.members.filter((m) => m.actorId !== actor.id);
      rec.lights = (rec.lights ?? []).filter((l) => l.bearerId !== actor.id);
      rec.spells = (rec.spells ?? []).filter((s) => s.casterId !== actor.id);
    })
      .then(() => PartySheet.refreshAll())
      .catch((err) => console.error(`${MODULE_ID} | member cleanup failed`, err));
  }
});

/* -------------------------------------------- */
/*  Party token movement → dungeon turns        */
/* -------------------------------------------- */

Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
  if (!("x" in changes) && !("y" in changes)) return;
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (!formationId) return;
  // Only the active GM client runs the automation, regardless of who moved the token.
  if (!isPrimaryGM()) return;
  onPartyTokenMoved(tokenDoc, formationId).catch((err) => console.error(`${MODULE_ID} | movement processing failed`, err));
});

/* If the party token is deleted outside of "disband", unlink it so the
 * formation survives and a new token can be placed later. */
Hooks.on("deleteToken", (tokenDoc) => {
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (!formationId || !isPrimaryGM()) return;
  const formation = getFormation(formationId);
  if (!formation || formation.tokenId !== tokenDoc.id) return;
  formation.tokenId = null;
  formation.sceneId = null;
  updateFormation(formation).then(() => PartySheet.refreshAll());
});

/* -------------------------------------------- */
/*  Keep party speed in sync with members       */
/* -------------------------------------------- */

Hooks.on("updateActor", (actor, changes) => {
  if (!isPrimaryGM()) return;
  const ownershipChanged = foundry.utils.hasProperty(changes, "ownership");
  const dataChanged = foundry.utils.hasProperty(changes, "system") || foundry.utils.hasProperty(changes, "items");
  if (!ownershipChanged && !dataChanged) return;
  const formations = Object.values(getFormations()).filter((f) => f.members.some((m) => m.actorId === actor.id));
  if (!formations.length) return;
  if (ownershipChanged) {
    // A member changed hands: re-derive who sees through the party token.
    syncEnvironments().catch((err) => console.error(`${MODULE_ID} | environment sync failed`, err));
  }
  if (dataChanged) {
    for (const formation of formations) {
      syncPartyActorSpeed(formation).then(() => PartySheet.refreshAll());
    }
  }
});

/* Encumbrance changes arrive as item create/update/delete on member actors. */
for (const hook of ["createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (item) => {
    if (!isPrimaryGM()) return;
    const actor = item?.parent;
    if (!actor?.id) return;
    const formations = Object.values(getFormations()).filter((f) => f.members.some((m) => m.actorId === actor.id));
    for (const formation of formations) {
      syncPartyActorSpeed(formation).then(() => PartySheet.refreshAll());
    }
  });
}

/* -------------------------------------------- */
/*  Cross-client refresh                        */
/* -------------------------------------------- */

function onFormationsChanged(setting) {
  if (setting.key !== `${MODULE_ID}.${SETTING_FORMATIONS}`) return;
  PartySheet.refreshAll();
  // Any formation change may affect fog (mapper/lights) or the party light.
  if (isPrimaryGM()) {
    syncEnvironments().catch((err) => console.error(`${MODULE_ID} | environment sync failed`, err));
  }
}

// The very first save in a world CREATES the Setting document; later saves
// update it. Both must refresh open windows on every client.
Hooks.on("createSetting", onFormationsChanged);
Hooks.on("updateSetting", onFormationsChanged);

/* -------------------------------------------- */
/*  Combat integration                          */
/* -------------------------------------------- */

Hooks.on("createCombatant", (combatant) => {
  if (!isPrimaryGM()) return;
  onPartyCombatantCreated(combatant).catch((err) => console.error(`${MODULE_ID} | combat deploy failed`, err));
});

Hooks.on("deleteCombat", (combat) => {
  if (!isPrimaryGM()) return;
  onCombatEnd(combat).catch((err) => console.error(`${MODULE_ID} | combat reform failed`, err));
});

/* Spells, lights, and rest tick live as combat rounds advance. */
Hooks.on("updateCombat", (combat, changes) => {
  if (!isPrimaryGM() || changes.round === undefined) return;
  onCombatRoundChange(combat).catch((err) => console.error(`${MODULE_ID} | combat round tick failed`, err));
});

/* -------------------------------------------- */
/*  UI entry points                              */
/* -------------------------------------------- */


/** `/formation` chat command. */
Hooks.on("chatMessage", (_chatLog, message) => {
  const command = message.trim().toLowerCase();
  if (command !== "/formation" && command !== "/form") return true;
  openPartySheet();
  return false;
});

/* -------------------------------------------- */
/*  Party entry points                          */
/* -------------------------------------------- */

/**
 * Token HUD "Add to party": adds the token (plus any other controlled,
 * eligible tokens) to the scene's formation — creating one if the scene has
 * none — and opens the party sheet.
 */
async function addTokensToParty(seedToken) {
  const scene = seedToken.parent;
  const eligible = (tokenDoc) =>
    tokenDoc.actor && tokenDoc.actor.type !== PARTY_TYPE && !tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  const tokens = (canvas?.tokens?.controlled ?? []).map((t) => t.document).filter(eligible);
  if (!tokens.some((t) => t.id === seedToken.id) && eligible(seedToken)) tokens.unshift(seedToken);
  if (!tokens.length) return;

  const formations = Object.values(getFormations());
  let formation = formations.find((f) => f.sceneId === scene.id && f.tokenId && scene.tokens.get(f.tokenId));
  // A fresh formation (hand-created Party Formation actor, no token placed
  // yet) is adopted rather than silently spawning a duplicate party — but ONLY
  // when its party actor still exists. A record whose actor is gone is dead:
  // adopting it would resurrect the deleted actor with its stale members.
  formation ??= formations.find((f) => !getPartyToken(f) && getPartyActor(f));
  formation ??= await createFormation();

  for (const tokenDoc of tokens) {
    formation = (await addMember(formation, tokenDoc.actor, tokenDoc)) ?? formation;
  }
  game.actors.get(formation.actorId)?.sheet?.render(true);
}

Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;
  const tokenDoc = hud.object?.document;
  if (!tokenDoc?.actor || tokenDoc.actor.type === PARTY_TYPE) return;
  if (tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return;

  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".acks-formation-hud")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon acks-formation-hud";
  button.dataset.tooltip = game.i18n.localize("ACKS-FORMATION.hud.addToParty");
  button.innerHTML = '<i class="fa-solid fa-people-group"></i>';
  button.addEventListener("click", (event) => {
    event.preventDefault();
    addTokensToParty(tokenDoc).catch((err) => console.error(`${MODULE_ID} | add to party failed`, err));
  });
  (root.querySelector(".col.right") ?? root).appendChild(button);
});

/* A hand-created Party Formation actor becomes a real formation record. */
Hooks.on("createActor", (actor) => {
  if (!isPrimaryGM() || actor.type !== PARTY_TYPE) return;
  if (actor.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return; // module-created
  if (Object.values(getFormations()).some((f) => f.actorId === actor.id)) return;
  (async () => {
    const formation = await createFormation(actor.name, { actorId: actor.id });
    await actor.setFlag(MODULE_ID, FLAG_FORMATION_ID, formation.id);
  })().catch((err) => console.error(`${MODULE_ID} | party actor adoption failed`, err));
});

/* Placing a party actor's token adopts it as THE party token (also how a
 * formation moves between scenes after its old token was removed). */
Hooks.on("createToken", (tokenDoc) => {
  if (!isPrimaryGM() || tokenDoc.actor?.type !== PARTY_TYPE) return;
  // Module-created tokens carry the formation flag in their creation data and
  // ensurePartyToken records their linkage itself. Adopting them here too
  // would write back a STALE settings copy read mid-addMember — the write
  // race that erased freshly added members. Only manual placements (dragged
  // from the sidebar, no flag yet) need adoption.
  if (tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return;
  const formation = Object.values(getFormations()).find((f) => f.actorId === tokenDoc.actor.id);
  if (!formation) return;
  const existing = getPartyToken(formation);
  if (existing && existing.id !== tokenDoc.id) {
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.duplicatePartyToken"));
    return;
  }
  (async () => {
    await tokenDoc.setFlag(MODULE_ID, FLAG_FORMATION_ID, formation.id);
    formation.sceneId = tokenDoc.parent.id;
    formation.tokenId = tokenDoc.id;
    formation.clock.lastPosition = { x: tokenDoc.x, y: tokenDoc.y };
    await updateFormation(formation);
    await syncPartyActorSpeed(formation);
  })().catch((err) => console.error(`${MODULE_ID} | party token adoption failed`, err));
});
