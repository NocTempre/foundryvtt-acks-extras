/* global Hooks, game, foundry, canvas, ui, CONFIG, Actor */
import { isPrimaryGM } from "../lib/util.mjs";
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import {
  DEFAULT_PARTY_IMAGE,
  DEFAULT_ENCOUNTER_EVERY,
  DEFAULT_ENCOUNTER_TARGET,
  FLAG_FORMATION_ID,
  MODULE_ID,
  ROLES,
  TRAP_ITEM_TYPE,
} from "./constants.mjs";
import { onCombatEnd, onCombatRoundChange, onPartyCombatantCreated } from "./combat-bridge.mjs";
import { SETTING_ABILITY_OVERRIDES, initLadders } from "./ability-bridge.mjs";
import { registerEncounterZone } from "./encounter-zone.mjs";
import { registerTrapZone, runTrapCheck } from "./trap-zone.mjs";
import { installTrapControls, installTrapDrop } from "./trap-walls.mjs";
import { installTrapMarkers } from "./trap-markers.mjs";
import TrapData from "./data/trap-data.mjs";
import TrapSheet from "./trap-sheet.mjs";
import {
  SETTING_FORMATIONS,
  addMember,
  createFormation,
  dissolveFormation,
  formationForToken,
  getFormation,
  getFormationForActor,
  getFormations,
  getPartyActor,
  handsOccupied,
  heldLightCount,
  lightsForBearer,
  getPartyToken,
  marchingOrder,
  patchFormation,
  pruneFormations,
  removeMembers,
  syncPartyActorSpeed,
  updateFormation,
} from "./formation-model.mjs";
import { findDeployedMember, leashBreach, reanchorDetached } from "./deployment.mjs";
import {
  SETTING_TEMPLATES,
  describeResult,
  formUp,
  listTemplates,
  pickMarchingOrder,
} from "./marching-templates.mjs";
import { anchorMap, archiveSession, registerMapSocket, saveFogAsMapItem, startMapSession } from "./map-items.mjs";
import { registerFuzzyRulers } from "./measure-fuzz.mjs";
import { PARTY_TYPE, PartyData, PartySheet } from "./party-actor.mjs";
import { PARTY_CHECKS, rollPartyCheck } from "./party-rolls.mjs";
import { installDoorControl, openDoorApp } from "./door-app.mjs";
import { installCoreXpSuppression } from "./xp-app.mjs";
import * as xpShares from "./xp-shares.mjs";
import * as doors from "./doors.mjs";
import * as obstacles from "./obstacles.mjs";
import * as swimming from "./swimming.mjs";
import * as jumping from "./jumping.mjs";
import * as encounterScaling from "./encounter-scaling.mjs";
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


Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "ownXpDealing", {
    name: "ACKS-FORMATION.xp.settingName",
    hint: "ACKS-FORMATION.xp.settingHint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // The Walls layer gets a door tool: a door IS a wall, so that is where a
  // Judge already is when a stuck one stops the party.
  installDoorControl();
  installTrapControls();
  installTrapDrop();
  installTrapMarkers();
  // Core's party overview deals XP by its own reckoning; with this module's
  // formation as the roster of record the two would disagree, so core's
  // button is hidden rather than left to argue. Off restores core untouched.
  installCoreXpSuppression();
  /* --- Settings --- */
  game.settings.register(MODULE_ID, SETTING_FORMATIONS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Saved marching orders. World-scoped and keyed by id, like the formations
  // themselves: an arrangement is worth reusing across parties, not owned by
  // the one it was captured from.
  game.settings.register(MODULE_ID, SETTING_TEMPLATES, {
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

  /* --- Trap Zone region behavior, trap Item sub-type + sheet --- */
  // Wrapped whole: everything below this point in `init` — the party actor,
  // its sheet, the public api — is dead if anything here throws, and traps are
  // the newest and least load-bearing thing in the hook. Never let them take
  // the feature down with them.
  try {
    registerTrapZone();
    CONFIG.Item ??= {};
    CONFIG.Item.dataModels ??= {};
    CONFIG.Item.dataModels[TRAP_ITEM_TYPE] = TrapData;
    foundry.documents.collections.Items.registerSheet(MODULE_ID, TrapSheet, {
      types: [TRAP_ITEM_TYPE],
      makeDefault: true,
      label: "ACKS-FORMATION.traps.sheet",
    });
  } catch (err) {
    console.error(`${MODULE_ID} | trap registration failed`, err);
  }

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
    /**
     * THE CONTRACT a companion module keys on (the trap module's half lives in
     * its own repo). Frozen at 1: `marchingOrder(formation)` rows
     * ({actorId, name, roles, rank, file}), `ROLES`, `getFormations()`,
     * `rollPartyCheck(formation, key)` and `PARTY_CHECKS`. Additions bump this;
     * removals or shape changes are a major of this module.
     *
     * 2 adds `doors` — `bashPlan()` (the throw as arithmetic, no dice),
     * `bashDoor`/`spikeDoor`/`unspikeDoor`/`batterPlan`, `doorState(wall)` and
     * `openDoorApp(wall)`. A trap module wanting to spike a door shut, or to
     * ask what forcing one would take, calls these rather than re-deriving the
     * modifiers.
     */
    apiVersion: 2,
    doors: { ...doors, openDoorApp },
    // The Spelunking table and the wrong-floor encounter adjustment, published
    // for the same reason as doors: a companion module asking what a sheer
    // face costs, or how a level-3 table lands on level 5, should read the
    // rule from here rather than re-derive it.
    obstacles,
    // Deep water is NOT one of the obstacles: its target is the swimmer's own
    // encumbrance, it is thrown every round rather than per hundred feet, and
    // failing it starts a drowning rather than costing progress.
    swimming,
    // Nor is a chasm: clearing one is not a throw at all but a DISTANCE the
    // jumper has against a gap the dungeon has, with a saving throw owed only
    // for a precarious landing.
    jumping,
    encounterScaling,
    // Dividing adventure XP: full shares, henchman halves, and the mercenaries
    // and wagons that take none.
    xp: xpShares,
    ROLES,
    marchingOrder,
    open: openPartySheet,
    PartySheet,
    advanceTurns,
    advanceRounds,
    getFormations,
    // Drop several members at the cost of one write — the batched primitive a
    // caller with a whole squad to disband uses instead of a remove per name.
    removeMembers,
    rollPartyCheck,
    PARTY_CHECKS,
    startMapSession,
    archiveSession,
    anchorMap,
    saveFogAsMapItem,
    requestPartyAction,
    // Hand integration (acks-equipment). handsOccupied tells equipment how many
    // hands the party sheet has already filled — lights borne, and the mapper's
    // kit — and is the ONE call its loadout makes; getFormationForActor + the
    // light mutators let equipment's sheet controls light/douse/shutter by actor.
    handsOccupied,
    heldLightCount,
    getFormationForActor,
    // lib/light.mjs reads this to decide which record owns an actor's lights.
    // It is consumed through the namespace, so removing it here silently sends
    // every member's token back to reading its own (empty) actor flag.
    lightsForBearer,
    addLight,
    toggleLight,
    removeLight,
    toggleShield,
  };
  acksExtras.formation = api;

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
  assertAcksSystem("exploration speeds cannot be read from actors.");
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
  // The party caught up: every scout ahead of it may range a fresh round.
  reanchorDetached(formationId).catch((err) => console.error(`${MODULE_ID} | re-anchor failed`, err));

  // Where the party came FROM, read before the clock consumes it: a trap wall
  // is met by CROSSING it, so the check needs the path and not just the
  // destination. `onPartyTokenMoved` overwrites `clock.lastPosition`.
  const before = getFormation(formationId)?.clock?.lastPosition;
  const from = before ? { x: before.x, y: before.y } : null;

  onPartyTokenMoved(tokenDoc, formationId)
    .then(() => {
      const formation = getFormation(formationId);
      if (!formation) return null;
      return runTrapCheck(formation, { from, to: { x: tokenDoc.x, y: tokenDoc.y } });
    })
    .catch((err) => console.error(`${MODULE_ID} | movement processing failed`, err));
});

/*
 * The leash on a detached member (deployment.mjs): they may not get further than
 * one round's movement from where they stood when the party last moved.
 *
 * Cancelling in preUpdateToken rather than snapping the token back afterwards —
 * a refused move should never have happened, and a corrective second write is
 * one more thing to fail. Runs on whichever client is dragging, which is the
 * client that must be told no.
 *
 * The GM is warned, not stopped: they are the one who decides where anything
 * ends up, and hard-blocking them would make repositioning a scout impossible
 * without first recalling them.
 */
Hooks.on("preUpdateToken", (tokenDoc, changes) => {
  if (!("x" in changes) && !("y" in changes)) return;
  const found = findDeployedMember(tokenDoc.id);
  if (!found?.member?.detached) return;
  const target = { x: changes.x ?? tokenDoc.x, y: changes.y ?? tokenDoc.y };
  const actor = game.actors.get(found.member.actorId);
  const breach = leashBreach(found.member, tokenDoc, target, actor);
  if (!breach) return;

  const name = actor?.name ?? tokenDoc.name;
  ui.notifications.warn(game.i18n.format("ACKS-FORMATION.app.leashed", { name }));
  if (!game.user.isGM) return false;
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

/**
 * Put the party back into a saved marching order from the party token itself.
 *
 * The picker only appears when there is a choice to make: one saved order is
 * applied outright, because a dialog whose every run has one answer is a click
 * spent on nothing.
 */
async function formUpFromHud(tokenDoc) {
  // By the token's own flag first, then by whose party actor this is. Never by
  // `getFormationForActor`: that searches MEMBERS, and a party actor is not a
  // member of its own formation, so it would answer null every time.
  const formation =
    formationForToken(tokenDoc) ??
    Object.values(getFormations()).find((f) => f.actorId === tokenDoc.actor.id) ??
    null;
  if (!formation) return;
  const saved = listTemplates();
  if (!saved.length) return;
  const template = saved.length === 1 ? saved[0] : (await pickMarchingOrder())?.template;
  if (!template) return;
  const result = await formUp(formation, template);
  if (result) ui.notifications.info(describeResult(result));
  game.actors.get(formation.actorId)?.sheet?.render(false);
}

/**
 * One HUD button per token kind: an ordinary token joins the party, and the
 * party token forms it back up.
 */
Hooks.on("renderTokenHUD", (hud, html) => {
  if (!game.user.isGM) return;
  const tokenDoc = hud.object?.document;
  if (!tokenDoc?.actor) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".acks-formation-hud")) return;

  const isParty = tokenDoc.actor.type === PARTY_TYPE;
  // A saved order is what the button restores, so with none saved there is
  // nothing to offer and the button stays off the HUD entirely.
  if (isParty && !listTemplates().length) return;
  if (!isParty && tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon acks-formation-hud";
  button.dataset.tooltip = game.i18n.localize(
    isParty ? "ACKS-FORMATION.hud.formUp" : "ACKS-FORMATION.hud.addToParty",
  );
  button.innerHTML = `<i class="fa-solid ${isParty ? "fa-people-line" : "fa-people-group"}"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const run = isParty ? formUpFromHud(tokenDoc) : addTokensToParty(tokenDoc);
    run.catch((err) => console.error(`${MODULE_ID} | ${isParty ? "form up" : "add to party"} failed`, err));
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
