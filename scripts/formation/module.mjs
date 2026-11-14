/* global Hooks, game, foundry, canvas, ui, CONFIG, Actor */
import { ROLL_CONTEXT_HOOK } from "../lib/group-encounter-logic.mjs";
import { elementOf, isPrimaryGM, replacementToken } from "../lib/util.mjs";
import { acksExtras, assertAcksSystem } from "../namespace.mjs";
import {
  DEFAULT_PARTY_IMAGE,
  DELVE_ENCOUNTER_DOC,
  FLAG_FORMATION_ID,
  FORMATION_DOC,
  MODULE_ID,
  PARTY_TOKEN_SHAPES,
  ROLES,
  SETTING_PARTY_TOKEN_SHAPE,
  SETTING_REST_REQUIRED,
  TRAP_ITEM_TYPE,
} from "./constants.mjs";
import { onCombatEnd, onCombatRoundChange, onPartyCombatantCreated } from "./combat-bridge.mjs";
import { HELD_CONDITION_FLAG } from "../lib/held-condition.mjs";
import { registerManagedEffect } from "../lib/managed-effects.mjs";
import { kitStatusChange, stashOnTurn } from "./mapper-kit.mjs";
import { STATUS_SURPRISED } from "./mapper-kit-logic.mjs";
import { SETTING_ABILITY_OVERRIDES, initLadders } from "./ability-bridge.mjs";
import { journeyZones, registerEncounterZone } from "./encounter-zone.mjs";
import { installMonsterLevelRow } from "./monster-level-row.mjs";
import { registerDistrictZone, findDistrict, DISTRICT_TYPE } from "./district-zone.mjs";
import { districtReaction } from "./settlement.mjs";
import { districtFromSelection, installDistrictControls, installDistrictPlaceRow, markControlledRegions } from "./district-tools.mjs";
import { installDistrictInfluence } from "./district-influence.mjs";
import {
  HALT_OPTION,
  TRAP_ZONE_TYPE,
  allPlacements,
  attemptDisarm,
  attemptRearm,
  findTrapZone,
  knownPlacementsNear,
  livePlacement,
  markTrapFound,
  placementNearByUuid,
  placementsNear,
  registerTrapZone,
  resetTrap,
  runTrapCheck,
  sweepForTraps,
  toggleArmed,
  toggleKnown,
  trapFor,
  wallPlacement,
  zonePlacement,
} from "./trap-zone.mjs";
import {
  armTrapPreset,
  assignTrapToWall,
  clearWallTrap,
  installTrapControls,
  installTrapDrop,
  chainWalls,
  drawTrapWall,
  layTrapOnSelection,
  regionFromSelection,
  setWallTrap,
  trapWallsCrossed,
  wallTrap,
} from "./trap-walls.mjs";
import { installTrapMarkers, refreshTrapMarkers } from "./trap-markers.mjs";
import { openTrapbreakApp } from "./trapbreak-app.mjs";
import * as trapRules from "./trap-rules.mjs";
import TrapData from "./data/trap-data.mjs";
import TrapSheet from "./trap-sheet.mjs";
import {
  SETTING_FORMATIONS,
  addMember,
  adoptPartyActor,
  adoptPartyToken,
  createFormation,
  dissolveFormation,
  formationForToken,
  getFormation,
  getFormationForActor,
  getFormations,
  getPartyActor,
  isLinkedPartyToken,
  getPartyToken,
  patchFormation,
  pruneFormations,
  publicApi as formationModelApi,
  syncPartyActorSpeed,
} from "./formation-model.mjs";
import { findDeployedMember, followMemberToken, leashBreach, reanchorDetached } from "./deployment.mjs";
import {
  SETTING_TEMPLATES,
  describeResult,
  formUp,
  listTemplates,
  pickMarchingOrder,
  publicApi as marchingOrdersApi,
} from "./marching-templates.mjs";
import { anchorMap, archiveSession, registerMapSocket, saveFogAsMapItem, startMapSession } from "./map-items.mjs";
import { registerLostSocket } from "./lost-fog.mjs";
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
import { registerRequestSocket, requestBringIn, requestPartyAction } from "./player-requests.mjs";
import { canJoin, partyHolding, partyOnScene, refusalText } from "./membership.mjs";
import { registerSkillFlagEditor } from "./skill-audit.mjs";
import { RESIZE_OPTION, stepFinished, syncEnvironments, syncPartyTokenSize } from "./scene-sync.mjs";
import { recordTrail } from "./column-trail.mjs";
import { installColumnView } from "./column-view.mjs";
import { carriedLightPoints } from "./column-light.mjs";
import { SHADOW_FLAG, TRUTH_MOVE_OPTION, clearOrphanShadows } from "./shadow.mjs";
import { addLight, advanceRounds, advanceTurns, removeLight, storedPosition, toggleLight, toggleShield } from "./turn-engine.mjs";
import { onPartyTokenMoved } from "./journey.mjs";
import * as journey from "./journey.mjs";
import * as travel from "./travel.mjs";
import { PAINT_LAYER_CHANGED_HOOK } from "../battlemap/terrain-paint.mjs";
import { primaryGMSettled } from "../lib/util.mjs";
import * as weather from "./weather.mjs";
import * as settlement from "./settlement.mjs";
import * as lost from "./lost.mjs";
import * as shadow from "./shadow.mjs";
import * as lostEpisode from "./lost-episode.mjs";
import { SETTLEMENT_DOC } from "./settlement.mjs";
import * as encounters from "./encounters.mjs";
import { ENCOUNTERS_DOC, ENCOUNTER_TABLE_IDS } from "./encounters.mjs";
import { SETTING_TRAVEL_ENCOUNTERS, maybeHexThrow, postEncounterThrow, resolveCreature, rollDayEncounters } from "./encounter-card.mjs";
import { SETTING_TRAVEL_LOG_CAP, settleAllOnDayChange } from "./travel.mjs";
import { SETTING_SEASON_MAP } from "./weather.mjs";
import { SETTING_STRAGGLING } from "./settlement.mjs";
import { creditHoledUpDays } from "./settlement-turn.mjs";
import {
  SETTING_TRANSIENT_TURNS, TRAVEL_OPTION, dropIncidentNote, expireTransientNotes, installIncidentCardActions,
  pickAndTravel, poiTargets, promoteIncident, transientNotesOn, travelToPlace,
} from "./poi.mjs";
import { closeDay, offerDayEnd } from "./day-close.mjs";
import { onWorldTimeAdvanced, calendarDay, clockReading, dawnWithin } from "../lib/world-time.mjs";
import { arrangeAllAtDawn, arrangeJoined, seatChanged } from "./conveyance.mjs";
import { SETTING_SKY_CACHE } from "./sky.mjs";
import * as provisions from "./provisions.mjs";
import * as foraging from "./foraging.mjs";
import { FORAGING_DOC } from "./foraging.mjs";
import * as searching from "./searching.mjs";
import { SEARCHING_DOC } from "./searching.mjs";
import { SETTING_SHARE_POLICY, SHARE_POLICIES } from "./provisions.mjs";
import * as sky from "./sky.mjs";
import * as flight from "./flight.mjs";
import { FLIGHT_DOC } from "./flight.mjs";
import { SURVIVAL_DOC } from "../lib/survival.mjs";
import { expectTables } from "../lib/tables.mjs";
import { TRAVEL_DOC, WEATHER_DOC } from "../vehicles/vehicle-speed.mjs";
import { registerFormationRepairChecks } from "./repair-checks.mjs";
import { registerPartyRoster } from "./party-roster.mjs";
import { registerFormationActivities } from "./turn-plan.mjs";
import {
  clearStock, hexStockView, installHexStockCardActions, placeFromPoint, readStock, stockFromInputs, surveyHex, trueHexOf, writeStock,
} from "./hex-stock-run.mjs";
import {
  creditSearch, falseCount, hexStockKey, markFound, recordAssessment, stockHex, stockSummary, unfoundPoints,
} from "./hex-stock.mjs";
import { installNavigationCardActions } from "./navigation-card.mjs";

/** Open the formation window. */
function openPartySheet() {
  const formation = Object.values(getFormations())[0] ?? null;
  const actor = formation ? game.actors.get(formation.actorId) : null;
  if (actor) actor.sheet.render(true);
  else ui.notifications.info(game.i18n.localize("ACKS-FORMATION.warn.noFormationYet"));
}


Hooks.once("init", () => {
  registerFormationRepairChecks();
  registerPartyRoster();
  // On every client: a player's Turn plan column refuses from the same registrations the Judge's client locks by.
  registerFormationActivities();
  // The mapper's Vulnerable is the formation's to keep and refuses a hand-delete.
  registerManagedEffect(HELD_CONDITION_FLAG, "ACKS-FORMATION.mapperVulnerable.owner");
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
  installDistrictControls();
  installDistrictInfluence();
  installDistrictPlaceRow();
  installMonsterLevelRow();
  installIncidentCardActions();
  installHexStockCardActions();
  installNavigationCardActions();
  installTrapDrop();
  installTrapMarkers();
  installColumnView();
  // Hides core's party-overview XP button, whose reckoning would disagree with
  // the formation's roster; off restores core untouched.
  installCoreXpSuppression();
  /* --- Settings --- */
  game.settings.register(MODULE_ID, SETTING_FORMATIONS, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Saved marching orders: world-scoped and keyed by id, shared across parties.
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

  // The shape a party takes until its sheet picks one (formation-model
  // `partyTokenShape`). A change re-sizes every party token that follows it.
  game.settings.register(MODULE_ID, SETTING_PARTY_TOKEN_SHAPE, {
    name: "ACKS-FORMATION.settings.partyTokenShape.name",
    hint: "ACKS-FORMATION.settings.partyTokenShape.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(PARTY_TOKEN_SHAPES.map((s) => [s, `ACKS-FORMATION.settings.partyTokenShape.${s}`])),
    default: PARTY_TOKEN_SHAPES[0],
    onChange: () => {
      if (!isPrimaryGM()) return;
      syncEnvironments().catch((err) => console.error(`${MODULE_ID} | environment sync failed`, err));
      PartySheet.refreshAll();
    },
  });

  game.settings.register(MODULE_ID, "publicTurnCards", {
    name: "ACKS-FORMATION.settings.publicTurnCards.name",
    hint: "ACKS-FORMATION.settings.publicTurnCards.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // Light-source equipment enforcement (RR p. 265): "require" blocks lighting
  // without the gear, "warn" lights anyway with a warning, "off" ignores
  // equipment. Both enforcing modes consume the fuel.
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

  // The Judge's delve cadence over the imported one (`getEncounterParams`).
  // Nullable, with no slider: blank defers to the import, and 0 turns the
  // automatic throw off, so the two must stay apart.
  game.settings.register(MODULE_ID, "encounterEvery", {
    name: "ACKS-FORMATION.settings.encounterEvery.name",
    hint: "ACKS-FORMATION.settings.encounterEvery.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: false, nullable: true, integer: true, min: 0, initial: null }),
    default: null,
  });

  game.settings.register(MODULE_ID, "encounterTarget", {
    name: "ACKS-FORMATION.settings.encounterTarget.name",
    hint: "ACKS-FORMATION.settings.encounterTarget.hint",
    scope: "world",
    config: true,
    type: new foundry.data.fields.NumberField({ required: false, nullable: true, integer: true, min: 1, initial: null }),
    default: null,
  });

  // Off, the delve counts no turns toward a rest, warns of none and winds no
  // one; the clock and the wandering throw are unaffected (`restEnforced`).
  game.settings.register(MODULE_ID, SETTING_REST_REQUIRED, {
    name: "ACKS-FORMATION.settings.restRequired.name",
    hint: "ACKS-FORMATION.settings.restRequired.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // How long a city incident's marker outlives its turn, in the module's own
  // turns.
  game.settings.register(MODULE_ID, SETTING_TRANSIENT_TURNS, {
    name: "ACKS-FORMATION.settings.transientIncidentTurns.name",
    hint: "ACKS-FORMATION.settings.transientIncidentTurns.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 6,
    range: { min: 0, max: 144, step: 1 },
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

  game.settings.register(MODULE_ID, "fuzzMeasurement", {
    name: "ACKS-FORMATION.settings.fuzzMeasurement.name",
    hint: "ACKS-FORMATION.settings.fuzzMeasurement.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // The delve's own printed figures, all imported: rest, carried load and the
  // swimming throw (`swimming.mjs`).
  expectTables(FORMATION_DOC, [
    "restInterval", "carriedBodyStone", "carriedGearShare",
    "swimWaterModifiers", "swimmingBonus", "swimSpeedShare", "sinkFeetPerStone", "breathRounds",
    // Jumping and the Spelunking tables (`jumping.mjs`, `obstacles.mjs`).
    "jumping", "fall", "spelunking", "spelunkingOutcomes",
    // The column's spacing on the battlemap, in feet.
    "marchFrontageFeet", "wideFrontageFeet", "rankIntervalFeet",
    // The traps' figures (`trap-rules.mjs` `trapFigures`, `pitFigures`).
    "searchReachFeet", "poleSearchReachFeet", "poleLeadFeet", "trapTriggerDie", "trapTriggerOn",
    "trapbreakReachFeet", "trapbreakHastyBotch", "trapbreakMethodicalBotch", "trapbreakMethodicalBonus",
    "pitSpikeCount", "pitSpikeDie",
  ]);
  // The delve's wandering throw (`getEncounterParams`): with no die and target
  // no throw is made, and with no dice no distance is rolled.
  expectTables(DELVE_ENCOUNTER_DOC, ["die", "every", "target", "distance"]);
  // The journey's registry tables: getting lost, encounter frequency and the
  // navigation bonus.
  expectTables(TRAVEL_DOC, ["gettingLost", "encounterFrequency", "navigationBonus"]);
  // The sky's generator, speed factors and condition effects (`weather-effects.mjs`).
  expectTables(WEATHER_DOC, [
    "climateModifiers",
    "dailyTemperatureLow",
    "dailyTemperatureHigh",
    "dailyPrecipitation",
    "dailyWind",
    "conditionSpeed",
    "accumulation",
    "conditionEffects",
  ]);

  // The encounter chain's bands, distances, visibility, evasion and terrain lists.
  expectTables(ENCOUNTERS_DOC, ENCOUNTER_TABLE_IDS);
  // City travel: paces, navigation, the straggling ladder and the street's
  // encounter cadence.
  expectTables(SETTLEMENT_DOC, [
    "paces", "navigation", "straggling", "encounters",
    "encounterIntent", "encounters100", "encounterAfterDark",
    // The dice the street's encounter throw and the incident list are thrown on.
    "dice",
    // The turns a walk between two points of interest costs (`poi.mjs`). It
    // arrives from a second book; declaring it makes its absence visible in the
    // table browser.
    "districtTravel",
    // Gate tolls and the syndicate's smuggling service.
    "gateTolls", "smuggling",
  ]);
  // Flight: the day-aloft, wind and load factors.
  expectTables(FLIGHT_DOC, ["aloftFactor", "windFactor", "loadFactors"]);
  // Hunger, thirst, exposure, fatigue and sleep (`lib/fatigue.mjs`).
  expectTables(SURVIVAL_DOC, ["food", "water", "exposure", "heat", "simplified", "fatigue", "sleep"]);
  // Living off the country: foraging, hunting and the dog pack.
  expectTables(FORAGING_DOC, [
    "targets", "forageTerrain", "forageTerritory", "survivalBonus", "partyGroupSize",
    "huntTarget", "huntTerritory", "dogTarget", "dogHelpPerDog", "dogHelpCap",
    "yields", "barrenTerrains", "efficientGrazers",
  ]);
  // Searching the wild: the ladder of daily distances to targets, the cost of a
  // moving or named quarry, the cadence of a throw and the survey.
  expectTables(SEARCHING_DOC, [
    "targets", "movingQuarry", "specificTarget", "turnsPerThrow",
    "canopyTerrains", "canopyPenalty", "aerialTurnsPerThrow",
    "surveyTarget", "surveyPerSearch", "trackingBonus",
  ]);

  // How many finished days a formation's travel log keeps, oldest trimmed first.
  game.settings.register(MODULE_ID, SETTING_TRAVEL_LOG_CAP, {
    name: "ACKS-FORMATION.settings.travelLogCap.name",
    hint: "ACKS-FORMATION.settings.travelLogCap.hint",
    scope: "world",
    config: true,
    type: Number,
    default: 120,
  });

  // Journeys throw their own encounters: each cadence unit walked and the end
  // of the day roll the owed throws and whisper the chain to the Judge. Off,
  // the panel's own button is the only trigger.
  game.settings.register(MODULE_ID, SETTING_TRAVEL_ENCOUNTERS, {
    name: "ACKS-FORMATION.settings.travelEncounters.name",
    hint: "ACKS-FORMATION.settings.travelEncounters.hint",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
  });

  // The sky cache: one roll per (day, climate, season), shared by every party
  // standing in it. Bounded and disposable (losing it costs a re-roll), and
  // hidden from the settings UI.
  game.settings.register(MODULE_ID, SETTING_SKY_CACHE, {
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });

  // Which generator season each of the calendar's seasons stands for. Blank
  // matches by name; the season select on a party's sheet follows the result.
  game.settings.register(MODULE_ID, SETTING_SEASON_MAP, {
    name: "ACKS-FORMATION.settings.calendarSeasons.name",
    hint: "ACKS-FORMATION.settings.calendarSeasons.hint",
    scope: "world",
    config: true,
    type: String,
    default: "",
  });

  // Who goes short when the packs cannot feed everyone. See
  // docs/formation/DECISIONS.md, "Who goes short when the packs cannot feed everyone is a setting, and even is the default".
  game.settings.register(MODULE_ID, SETTING_SHARE_POLICY, {
    name: "ACKS-FORMATION.settings.provisionSharing.name",
    hint: "ACKS-FORMATION.settings.provisionSharing.hint",
    scope: "world",
    config: true,
    type: String,
    choices: Object.fromEntries(Object.entries(SHARE_POLICIES).map(([k, v]) => [k, v.label])),
    default: "even",
  });

  // See docs/formation/DECISIONS.md, "Straggling ships on".
  game.settings.register(MODULE_ID, SETTING_STRAGGLING, {
    name: "ACKS-FORMATION.settings.straggling.name",
    hint: "ACKS-FORMATION.settings.straggling.hint",
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

  /* --- District region behavior --- */
  registerDistrictZone();

  /* --- Trap Zone region behavior, trap Item sub-type + sheet --- */
  // Wrapped whole: a throw here would leave the party actor, its sheet and the
  // public api below unregistered.
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
     * The contract version of this namespace, which a companion module keys on.
     * It rises on every additive change; a removal or a shape change is a major
     * of the module. The stable core is `marchingOrder(formation)` rows
     * ({actorId, name, roles, rank, file}), `ROLES`, `getFormations()`,
     * `rollPartyCheck(formation, key)` and `PARTY_CHECKS`; every other member
     * publishes one feature's pure pieces and live surface so a consumer reads
     * the rule from here rather than deriving it a second time. The journey's
     * hooks and their payloads are in docs/formation/MODEL.md, "The journey".
     */
    apiVersion: 24,
    travel: { ...travel, ...journey, closeDay, offerDayEnd },
    weather,
    settlement,
    district: {
      DISTRICT_TYPE,
      findDistrict,
      districtReaction,
      markControlledRegions,
      districtFromSelection,
    },
    poi: {
      TRAVEL_OPTION,
      travelToPlace,
      pickAndTravel,
      poiTargets,
      dropIncidentNote,
      expireTransientNotes,
      transientNotesOn,
      promoteIncident,
    },
    lost,
    shadow,
    lostEpisode,
    sky,
    flight,
    provisions,
    foraging,
    searching,
    hexStock: {
      trueHexOf,
      readStock,
      writeStock,
      clearStock,
      stockFromInputs,
      surveyHex,
      placeFromPoint,
      hexStockView,
      pure: { stockHex, stockSummary, unfoundPoints, markFound, creditSearch, recordAssessment, falseCount, hexStockKey },
    },
    encounters: { ...encounters, maybeHexThrow, postEncounterThrow, resolveCreature, rollDayEncounters, journeyZones },
    traps: {
      ...trapRules,
      runTrapCheck,
      sweepForTraps,
      attemptDisarm,
      attemptRearm,
      resetTrap,
      markTrapFound,
      toggleArmed,
      toggleKnown,
      openTrapbreakApp,
      findTrapZone,
      zonePlacement,
      wallPlacement,
      livePlacement,
      allPlacements,
      placementsNear,
      knownPlacementsNear,
      placementNearByUuid,
      trapFor,
      layTrapOnSelection,
      armTrapPreset,
      drawTrapWall,
      regionFromSelection,
      chainWalls,
      assignTrapToWall,
      wallTrap,
      setWallTrap,
      clearWallTrap,
      trapWallsCrossed,
      refreshTrapMarkers,
      TRAP_ITEM_TYPE,
      TRAP_ZONE_TYPE,
    },
    doors: { ...doors, openDoorApp },
    // The Spelunking table and the wrong-floor encounter adjustment.
    obstacles,
    // Deep water is not an obstacle: it is its own throw (`swimming.mjs`).
    swimming,
    // Nor is a chasm: a jump is a distance against a gap (`jumping.mjs`).
    jumping,
    encounterScaling,
    // Dividing adventure XP among the members.
    xp: xpShares,
    ROLES,
    marchingOrders: marchingOrdersApi,
    open: openPartySheet,
    PartySheet,
    advanceTurns,
    advanceRounds,
    ...formationModelApi,
    rollPartyCheck,
    PARTY_CHECKS,
    startMapSession,
    archiveSession,
    anchorMap,
    saveFogAsMapItem,
    requestPartyAction,
    // lib/light.mjs's brightestLightReaching reads the column's lights through
    // this: they stand on no token, so a token sweep never sees them.
    carriedLightPoints,
    addLight,
    toggleLight,
    removeLight,
    toggleShield,
  };
  acksExtras.formation = api;

  /* --- Template preload (best-effort) --- */
  try {
    foundry.applications.handlebars.loadTemplates(
      [
        "formation-band",
        "formation-frame",
        "formation-cell",
        "formation-tabs",
        "formation-tab-wilderness",
        "formation-tab-dungeon",
        "formation-tab-city",
        "formation-strip",
        "formation-plate",
        "formation-country",
        "formation-player-actions",
        "formation-tab-order",
        "formation-tab-kit",
        "formation-tab-sightings",
        "formation-tab-judge",
        "skill-audit",
      ].map((name) => `modules/${MODULE_ID}/templates/formation/${name}.hbs`),
    );
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
  registerLostSocket();
  registerRequestSocket();
  // Index the skill ladders the importer imported.
  initLadders();
  // A party holed up in a city has no movement to read, so its stay is
  // credited off the calendar. Idempotent: the board carries the world time
  // each stay is counted from.
  onWorldTimeAdvanced((_worldTime, dt) => {
    creditHoledUpDays().catch((err) => console.error(`${MODULE_ID} | holed-up day failed`, err));
    // The sky and the ground's footing move with the calendar day, however the
    // clock moved. Idempotent: each formation keeps the day it settled.
    const today = calendarDay();
    const settled = today != null
      ? settleAllOnDayChange(today).catch((err) => console.error(`${MODULE_ID} | day change failed`, err))
      : Promise.resolve();
    // Each party takes its ride for the new day once its sky is settled;
    // arranging twice moves nobody.
    if (dawnWithin(clockReading(), dt)) {
      settled.then(arrangeAllAtDawn).catch((err) => console.error(`${MODULE_ID} | the dawn arrangement failed`, err));
    }
    // An incident's marker lasts a stated number of turns of the same clock.
    expireTransientNotes().catch((err) => console.error(`${MODULE_ID} | incident marker expiry failed`, err));
  });
  // The startup sync waits to learn whether this window automates.
  primaryGMSettled().then((primary) => {
    if (!primary) return;
    // Prune formations whose party actor is gone first, then sync the
    // environments of what remains.
    pruneFormations()
      // A true-position marker whose formation is gone stands in no episode.
      .then(() => clearOrphanShadows(new Set(Object.values(getFormations()).map((f) => f.id))))
      .then(() => syncEnvironments())
      .catch((err) => console.error(`${MODULE_ID} | startup sync failed`, err));
  });
});

/* A group's Roll opens on the line the viewed scene reads. */
Hooks.on(ROLL_CONTEXT_HOOK, (answer) => {
  answer.context = travel.sceneEncounterLine(answer.scene) ?? answer.context;
});

/* -------------------------------------------- */
/*  Actor deletion cleanup                       */
/* -------------------------------------------- */

/* Deleting a party actor dissolves its formation (stashed member tokens are
 * restored, the record removed), so a later "Add to party" cannot adopt it and
 * `ensurePartyActor` cannot resurrect the actor. A deleted member actor is
 * dropped from every formation, so it cannot hold a rank. */
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

// A hand resize of the party token: in the `order` shape the module puts the
// size back; in `fixed` the sync reads it as the Judge's and leaves it.
// Gated on a size change the module did not make.
Hooks.on("updateToken", (tokenDoc, changes, options) => {
  if (!("width" in changes) && !("height" in changes)) return;
  if (options?.[RESIZE_OPTION]) return;
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (!formationId || !isPrimaryGM()) return;
  const formation = getFormation(formationId);
  // Only the token the record links: a flagged copy resized changes nothing.
  if (formation && isLinkedPartyToken(formation, tokenDoc)) syncPartyTokenSize(formation).catch((err) => console.error(`${MODULE_ID} | party size sync failed`, err));
});

// The ground the party token walks, which the drawn column, its lights and a
// deploy read (column-trail.mjs). Runs apart from the movement hook below,
// after the step's animation, as a flag-only write; the early returns of that
// hook have their own answers here (column.mjs `trailDecision`).
Hooks.on("updateToken", (tokenDoc, changes, options) => {
  if (!("x" in changes) && !("y" in changes) && !("rotation" in changes)) return;
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (!formationId || !isPrimaryGM()) return;
  const formation = getFormation(formationId);
  if (!formation || !isLinkedPartyToken(formation, tokenDoc)) return;
  const flags = {
    halt: !!options?.[HALT_OPTION],
    travel: !!options?.[TRAVEL_OPTION],
    truth: !!options?.[TRUTH_MOVE_OPTION],
    resize: !!options?.[RESIZE_OPTION],
  };
  stepFinished(tokenDoc)
    .then(() => recordTrail(tokenDoc, changes, options, flags, getFormation(formationId) ?? formation))
    .catch((err) => console.error(`${MODULE_ID} | the party's trail could not be recorded`, err));
});

Hooks.on("updateToken", (tokenDoc, changes, options, userId) => {
  if (!("x" in changes) && !("y" in changes)) return;
  // Four moves that are not the party walking. A trap's halt costs no turns,
  // and re-entering the trap check would resolve the same trap twice.
  if (options?.[HALT_OPTION]) return;
  // A walk to a point of interest was priced before the token moved, and the
  // clock's baseline moved with it.
  if (options?.[TRAVEL_OPTION]) return;
  // The module's own resize moves the top-left corner every consumer below
  // reads; `syncPartyTokenSize` re-baselines the clock itself.
  if (options?.[RESIZE_OPTION]) return;
  // Stepping onto the lost party's true position moves nothing real.
  if (options?.[TRUTH_MOVE_OPTION]) return;
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (!formationId) return;
  // Only the active GM client runs the automation, regardless of who moved the token.
  if (!isPrimaryGM()) return;
  // Only the token the record links walks the party: a flagged copy on any
  // scene bills nothing and seats nobody.
  const record = getFormation(formationId);
  if (!isLinkedPartyToken(record, tokenDoc)) return;
  // The party caught up: every scout ahead of it may range a fresh round.
  reanchorDetached(formationId).catch((err) => console.error(`${MODULE_ID} | re-anchor failed`, err));

  // Where the party came from, read before `onPartyTokenMoved` overwrites
  // `clock.lastPosition`: a trap wall is met by crossing it, so the check needs
  // the path. Where it went to is the stored position, read once for the clock
  // and the trap check alike, since `tokenDoc.x`/`y` on a client drawing the
  // token are the move's animation.
  const before = record.clock?.lastPosition;
  const from = before ? { x: before.x, y: before.y } : null;
  const to = storedPosition(tokenDoc);

  onPartyTokenMoved(tokenDoc, formationId, to)
    .then(() => {
      const formation = getFormation(formationId);
      if (!formation) return null;
      return runTrapCheck(formation, { from, to });
    })
    // Once the day's march is walked off, or the party marches on after dusk,
    // the Judge is asked whether the day is over. Wired here, not in the
    // tracker, since ending a day spends provisions and the calendar.
    .then(() => offerDayEnd(formationId))
    .catch((err) => console.error(`${MODULE_ID} | movement processing failed`, err));
});

/*
 * The leash on a detached member (deployment.mjs): they may not get further than
 * one round's movement from where they stood when the party last moved.
 *
 * A breach is cancelled in preUpdateToken, on the dragging client, so no
 * corrective write follows. The GM is warned and not stopped.
 */
Hooks.on("preUpdateToken", (tokenDoc, changes) => {
  if (!("x" in changes) && !("y" in changes)) return;
  const found = findDeployedMember(tokenDoc);
  if (!found?.member?.detached) return;
  const target = { x: changes.x ?? tokenDoc.x, y: changes.y ?? tokenDoc.y };
  const actor = game.actors.get(found.member.actorId);
  const breach = leashBreach(found.member, tokenDoc, target, actor);
  if (!breach) return;

  const name = actor?.name ?? tokenDoc.name;
  ui.notifications.warn(game.i18n.format("ACKS-FORMATION.app.leashed", { name }));
  if (!game.user.isGM) return false;
});

/**
 * The token a deletion names as the party token's replacement (lib's
 * `replacementToken`: core moving it to another scene), or null. Only one
 * still flagged for the same formation takes the party over.
 */
function replacementPartyToken(tokenDoc, options) {
  const next = replacementToken(tokenDoc, options);
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  return next?.getFlag?.(MODULE_ID, FLAG_FORMATION_ID) === formationId ? next : null;
}

/* A party token deleted outside of "disband" is unlinked, so the formation
 * survives and a new token can be placed later; one deleted in favour of a
 * replacement hands the linkage to it. */
Hooks.on("deleteToken", (tokenDoc, options) => {
  const formationId = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (!formationId || !isPrimaryGM()) return;
  // Resolved now, not at write time: a party teleported straight back has
  // already deleted this replacement when the write's turn comes.
  const next = replacementPartyToken(tokenDoc, options);
  // A patch, so the guard reads the ledger as it is at write time: the record
  // may be dissolved, or another token adopted, meanwhile. The guard names the
  // scene too, since a token keeps its id across scenes.
  patchFormation(formationId, (record) => {
    if (!isLinkedPartyToken(record, tokenDoc)) return false;
    record.tokenId = next?.id ?? null;
    record.sceneId = next?.parent?.id ?? null;
    // The clock measures from where the party now stands.
    if (next) record.clock = { ...(record.clock ?? {}), lastPosition: { x: next.x, y: next.y } };
  })
    .then(() => PartySheet.refreshAll())
    .catch((err) => console.error(`${MODULE_ID} | a deleted party token's linkage could not be updated`, err));
});

/* A member's own token that core moved to another scene is still theirs: the
 * record follows the replacement (deployment.mjs, `followMemberToken`). A
 * token deleted with no replacement leaves the record as it was, for the
 * recall to find gone. */
Hooks.on("deleteToken", (tokenDoc, options) => {
  if (!isPrimaryGM()) return;
  // Resolved now, as the party token's is.
  const next = replacementToken(tokenDoc, options);
  if (!next || next.actorId !== tokenDoc.actorId) return;
  const found = findDeployedMember(tokenDoc);
  if (!found) return;
  followMemberToken(found.formation.id, tokenDoc, next)
    .then(() => PartySheet.refreshAll())
    .catch((err) => console.error(`${MODULE_ID} | a member's token moved to another scene could not be followed`, err));
});

/* -------------------------------------------- */
/*  Keep party speed in sync with members       */
/* -------------------------------------------- */

// Whoever added the member is a GM, so this one client takes the arrangement.
Hooks.on("acksExtras.memberJoined", ({ formationId, actorId }) => {
  if (!game.user.isGM) return;
  arrangeJoined(formationId, actorId).catch((err) => console.error(`${MODULE_ID} | a joining member could not be arranged`, err));
});

Hooks.on("updateActor", (actor, changes) => {
  if (!isPrimaryGM()) return;
  const ownershipChanged = foundry.utils.hasProperty(changes, "ownership");
  const dataChanged = foundry.utils.hasProperty(changes, "system") || foundry.utils.hasProperty(changes, "items") || seatChanged(changes);
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

/* A member's effect light is a row on the Kit tab, read off the actor: an effect
 * created, changed or deleted on a member, or on an item they carry, redraws
 * the open sheets on this client. A drawing only, so every client does it; the
 * item hooks above already redraw the primary GM's. */
const redrawForMember = (actor) => {
  if (actor?.id && getFormationForActor(actor.id)) PartySheet.refreshAll();
};
for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (effect) => redrawForMember(effect?.parent?.documentName === "Actor" ? effect.parent : effect?.parent?.parent));
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

// The first save in a world creates the Setting document and later ones update
// it; both refresh open windows on every client.
Hooks.on("createSetting", onFormationsChanged);
Hooks.on("updateSetting", onFormationsChanged);

// A board following the world clock reads its hour off it, so every client
// redraws when the clock moves in either direction.
Hooks.on("updateWorldTime", () => {
  if (Object.values(getFormations()).some((f) => f.travel?.mode === "settlement" || f.travel?.mode === "journey")) PartySheet.refreshAll();
});

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

/* The mapper's kit (mapper-kit.mjs): a turn or round change may land on a mapper
 * who is not surprised, which stashes the kit and lifts the condition. A
 * combat's end hands the kit back, so the role's condition returns. */
const syncKit = () => syncEnvironments().catch((err) => console.error(`${MODULE_ID} | mapper kit sync failed`, err));
const stashFor = (combat) =>
  stashOnTurn(combat).then((marked) => marked && syncKit()).catch((err) => console.error(`${MODULE_ID} | mapper kit stash failed`, err));

Hooks.on("updateCombat", (combat, changes) => {
  if (!isPrimaryGM() || (changes.turn === undefined && changes.round === undefined)) return;
  stashFor(combat);
});

Hooks.on("deleteCombat", () => {
  if (isPrimaryGM()) syncKit();
});

/* The system lifts a surprise on its own schedule, and a death takes the kit
 * out of a mapper's hands: either, on a mapper-role member, is a fresh look. */
const holdsMapperRole = (actor) =>
  !!actor?.id && Object.values(getFormations()).some((f) => f.members.some((m) => m.actorId === actor.id && m.roles?.includes(ROLES.MAPPER)));
for (const hook of ["createActiveEffect", "deleteActiveEffect"]) {
  Hooks.on(hook, (effect) => {
    if (!isPrimaryGM() || !kitStatusChange(effect)) return;
    const actor = effect.parent;
    if (!holdsMapperRole(actor)) return;
    syncKit();
    // From round 2 on, a lifted surprise is the cue to look again: it can land
    // after the new round's first turn is already the mapper's.
    if (effect.statuses.has(STATUS_SURPRISED)) {
      for (const combat of game.combats ?? []) if ((combat.round ?? 0) >= 2 && combat.combatant?.actor === actor) stashFor(combat);
    }
  });
}
Hooks.on("updateActor", (actor, changes) => {
  if (!isPrimaryGM() || !foundry.utils.hasProperty(changes, "system.hp") || !holdsMapperRole(actor)) return;
  syncKit();
});

/* Whether a party is mapping reads the light where the mapper stands
 * (mapping.mjs), and little that moves that light writes the formation record:
 * the day turning, an ambient light edited, a token walking or changing its
 * light, a magic light shuttered or stowed. Each is a fresh look at every party
 * with a mapper on that scene, debounced to one sweep per burst. */
const mappingParties = () =>
  Object.values(getFormations()).filter((f) => f.members.some((m) => m.roles?.includes(ROLES.MAPPER)));
const mapsOnScene = (sceneId) => !!sceneId && mappingParties().some((f) => f.sceneId === sceneId);
const memberHoldsMapping = (actor) => !!actor?.id && mappingParties().some((f) => f.members.some((m) => m.actorId === actor.id));
let lookAtMappingSoon = null;
const lookAtMapping = () => {
  lookAtMappingSoon ??= foundry.utils.debounce(
    () => syncEnvironments().catch((err) => console.error(`${MODULE_ID} | mapping sync failed`, err)),
    300,
  );
  lookAtMappingSoon();
};
const ownerActorOf = (doc) => (doc?.parent?.documentName === "Actor" ? doc.parent : doc?.parent?.parent ?? null);
for (const hook of ["createActiveEffect", "updateActiveEffect", "deleteActiveEffect", "createItem", "updateItem", "deleteItem"]) {
  Hooks.on(hook, (doc) => {
    if (!isPrimaryGM()) return;
    const actor = doc?.documentName === "Item" ? doc.parent : ownerActorOf(doc);
    if (memberHoldsMapping(actor)) lookAtMapping();
  });
}
for (const hook of ["createAmbientLight", "updateAmbientLight", "deleteAmbientLight"]) {
  Hooks.on(hook, (light) => {
    if (isPrimaryGM() && mapsOnScene(light?.parent?.id)) lookAtMapping();
  });
}
Hooks.on("updateScene", (scene, changes) => {
  if (!isPrimaryGM() || !mapsOnScene(scene.id)) return;
  if (foundry.utils.hasProperty(changes, "environment") || foundry.utils.hasProperty(changes, "darkness")) lookAtMapping();
});
Hooks.on("updateToken", (tokenDoc, changes) => {
  if (!isPrimaryGM() || !mapsOnScene(tokenDoc.parent?.id)) return;
  const moved = ["x", "y", "width", "height", "hidden", "light", "elevation"].some((key) => key in changes);
  if (moved) lookAtMapping();
});
/* The two switches the verdict and its measurement answer to. */
const MAPPING_SETTINGS = ["mapperNeedsLight", "fuzzMeasurement"].map((key) => `${MODULE_ID}.${key}`);
Hooks.on("updateSetting", (setting) => {
  if (isPrimaryGM() && MAPPING_SETTINGS.includes(setting.key)) lookAtMapping();
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
  const candidates = (canvas?.tokens?.controlled ?? []).map((t) => t.document).filter(canJoin);
  if (!candidates.some((t) => t.id === seedToken.id) && canJoin(seedToken)) candidates.unshift(seedToken);
  // An actor already in a party is refused as a player's request is, before a
  // formation is made for nobody.
  const tokens = [];
  for (const tokenDoc of candidates) {
    const holding = partyHolding(tokenDoc.actor.id);
    if (holding) ui.notifications.warn(refusalText({ key: "inParty", party: holding.name }, tokenDoc.actor));
    else tokens.push(tokenDoc);
  }
  if (!tokens.length) return;

  const formations = Object.values(getFormations());
  let formation = formations.find((f) => f.sceneId === scene.id && f.tokenId && scene.tokens.get(f.tokenId));
  // A fresh formation (a hand-created party actor with no token yet) is
  // adopted, but only while its party actor still exists: adopting a dead
  // record would resurrect the deleted actor with its stale members.
  formation ??= formations.find((f) => !getPartyToken(f) && getPartyActor(f));
  formation ??= await createFormation();

  for (const tokenDoc of tokens) {
    formation = (await addMember(formation, tokenDoc.actor, tokenDoc)) ?? formation;
  }
  game.actors.get(formation.actorId)?.sheet?.render(true);
}

/**
 * Put the party back into a saved marching order from the party token itself;
 * the picker appears only when more than one order is saved.
 */
async function formUpFromHud(tokenDoc) {
  // Never `getFormationForActor`: it searches members, and a party actor is not
  // a member of its own formation.
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

/** A player's own controlled tokens, and the one they pressed on, into the party. */
async function bringTokensIn(formation, seedToken) {
  const tokens = (canvas?.tokens?.controlled ?? []).map((t) => t.document).filter((t) => canJoin(t) && t.actor.isOwner);
  if (!tokens.some((t) => t.id === seedToken.id)) tokens.unshift(seedToken);
  for (const token of tokens) await requestBringIn(formation, token.actor, token);
}

/**
 * One HUD button per token kind: an ordinary token joins the party, and the
 * party token forms it back up. A player has only the first, on a token of
 * their own, and only where a party already stands on the scene.
 */
Hooks.on("renderTokenHUD", (hud, html) => {
  const tokenDoc = hud.object?.document;
  if (!tokenDoc?.actor) return;
  const root = elementOf(html);
  if (!root || root.querySelector(".acks-formation-hud")) return;

  const isGM = game.user.isGM;
  const isParty = tokenDoc.actor.type === PARTY_TYPE;
  // With no saved order the party token's button stays off the HUD.
  if (isParty && (!isGM || !listTemplates().length)) return;
  if (!isParty && !canJoin(tokenDoc)) return;
  const party = isGM ? null : partyOnScene(tokenDoc.parent, game.user);
  if (!isGM && (!party || !tokenDoc.actor.isOwner)) return;

  const button = document.createElement("button");
  button.type = "button";
  button.className = "control-icon acks-formation-hud";
  const tip = isParty ? "formUp" : isGM ? "addToParty" : "bringIn";
  button.dataset.tooltip = game.i18n.localize(`ACKS-FORMATION.hud.${tip}`);
  button.innerHTML = `<i class="fa-solid ${isParty ? "fa-people-line" : "fa-people-group"}"></i>`;
  button.addEventListener("click", (event) => {
    event.preventDefault();
    const run = isParty ? formUpFromHud(tokenDoc) : isGM ? addTokensToParty(tokenDoc) : bringTokensIn(party, tokenDoc);
    run.catch((err) => console.error(`${MODULE_ID} | ${isParty ? "form up" : "add to party"} failed`, err));
  });
  (root.querySelector(".col.right") ?? root).appendChild(button);
});

/* A hand-created Party Formation actor becomes a real formation record. The
 * lead is asked only once the seat election settles, since a GM whose window is
 * still joining is not the lead yet and no other window would adopt it. */
Hooks.on("createActor", (actor) => {
  if (!game.user?.isGM || actor.type !== PARTY_TYPE) return;
  primaryGMSettled()
    .then((lead) => {
      if (!lead || !game.actors.get(actor.id)) return;
      if (actor.getFlag(MODULE_ID, FLAG_FORMATION_ID)) return; // module-created
      if (Object.values(getFormations()).some((f) => f.actorId === actor.id)) return;
      return adoptPartyActor(actor);
    })
    .catch((err) => console.error(`${MODULE_ID} | party actor adoption failed`, err));
});

/* The country under a journeying party is the map's (`travel.map`), and it
 * changes under a party that has not moved (a painted hex, a drawn river, the
 * scene's default). The active GM re-reads it once per burst of edits, and the
 * sheets redraw only when a reading changed. */
const requestCountryRefresh = travel.countryRefresher({
  then: (changed) => {
    if (changed.length) PartySheet.refreshAll();
  },
});
for (const hook of ["createRegion", "updateRegion", "deleteRegion"]) {
  Hooks.on(hook, (region) => requestCountryRefresh(region?.parent?.id));
}
for (const hook of ["createWall", "updateWall", "deleteWall"]) {
  Hooks.on(hook, (wall) => requestCountryRefresh(wall?.parent?.id, { walls: true }));
}
Hooks.on("updateScene", (scene, changes) => {
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.battlemap.country`)) requestCountryRefresh(scene.id);
});
/* A layer's values change what it derives with no region written: every scene
 * a party stands on that holds the layer's paint is re-read. */
Hooks.on(PAINT_LAYER_CHANGED_HOOK, (layer) => {
  for (const sceneId of travel.partyScenesPaintedWith(layer)) requestCountryRefresh(sceneId);
});

/* A second party token placed by hand is refused while the record links a live
 * one. Only an unflagged token is refused: a flagged one is the party's own,
 * and a teleport creates it on the new scene before the delete hands the
 * linkage over. Runs on whichever client places the token. */
Hooks.on("preCreateToken", (tokenDoc) => {
  if (tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID) || tokenDoc.getFlag(MODULE_ID, SHADOW_FLAG)) return;
  const actor = game.actors.get(tokenDoc.actorId);
  if (actor?.type !== PARTY_TYPE) return;
  const formation = Object.values(getFormations()).find((f) => f.actorId === actor.id);
  if (!formation || !getPartyToken(formation)) return;
  ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.duplicatePartyToken"));
  return false;
});

/* Placing a party actor's token adopts it as THE party token (also how a
 * formation moves between scenes after its old token was removed), and the
 * country under it is read once it stands there. */
Hooks.on("createToken", (tokenDoc) => {
  if (!isPrimaryGM() || tokenDoc.actor?.type !== PARTY_TYPE) return;
  // A lost party's true-position marker is a token of the party actor too,
  // and is never the party token.
  if (tokenDoc.getFlag(MODULE_ID, SHADOW_FLAG)) return;
  const arrived = () => requestCountryRefresh(tokenDoc.parent?.id);
  // Module-created tokens carry the formation flag and `ensurePartyToken`
  // records their linkage itself; adopting them here too would write back a
  // stale copy read mid-`addMember`. Only a manual placement needs adoption.
  const owned = tokenDoc.getFlag(MODULE_ID, FLAG_FORMATION_ID);
  if (owned) return void adoptSceneSystem(owned, tokenDoc.parent).then(arrived);
  const formation = Object.values(getFormations()).find((f) => f.actorId === tokenDoc.actor.id);
  if (!formation) return;
  const existing = getPartyToken(formation);
  if (existing && existing.id !== tokenDoc.id) {
    ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.warn.duplicatePartyToken"));
    return;
  }
  adoptPartyToken(formation.id, tokenDoc)
    .then(() => adoptSceneSystem(formation.id, tokenDoc.parent))
    .then(arrived)
    .catch((err) => console.error(`${MODULE_ID} | party token adoption failed`, err));
});

/**
 * The scene says what a party does on it (the battlemap setup tool writes the
 * declaration), and a party standing there follows, on arrival and when the
 * declaration changes under it. The switch is announced, since it starts or
 * pauses a clock.
 */
function adoptSceneSystem(formationId, scene) {
  return travel
    .adoptSceneSystem(formationId, scene)
    .then((adopted) => {
      if (!adopted) return;
      const { mode, source } = adopted;
      const name = getFormation(formationId)?.name ?? "";
      ui.notifications.info(
        game.i18n.format(source === "scale" ? "ACKS-FORMATION.travel.sceneSystemScale" : "ACKS-FORMATION.travel.sceneSystem", {
          name,
          system: game.i18n.localize(`ACKS-BATTLEMAP.system.${mode}`),
        })
      );
    })
    .catch((err) => console.error(`${MODULE_ID} | scene travel system adoption failed`, err));
}

/* A scene's declared system changing, or its scale (an undeclared map's system
 * is read from it), is the same event as arriving on it, for every party
 * already standing there. */
Hooks.on("updateScene", (scene, changes) => {
  if (!isPrimaryGM()) return;
  if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.battlemap`) && !travel.sceneScaleChanged(changes)) return;
  for (const formation of Object.values(getFormations())) {
    if (formation.sceneId === scene.id) adoptSceneSystem(formation.id, scene);
  }
});

/* A hex's stock changing under an open sheet redraws the "This hex" group,
 * whoever wrote it. */
Hooks.on("updateScene", (_scene, changes) => {
  if (foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.hexStock`)) PartySheet.refreshAll();
});

/* The lost party's true-position marker moving changes which hex the stock is
 * read from, so the Judge's group follows it. */
Hooks.on("updateToken", (tokenDoc, changes) => {
  if (!game.user.isGM || !tokenDoc.getFlag(MODULE_ID, SHADOW_FLAG)) return;
  if (!("x" in changes) && !("y" in changes)) return;
  PartySheet.refreshAll();
});
