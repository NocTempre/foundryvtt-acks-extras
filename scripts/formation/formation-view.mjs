/* global game, canvas, fromUuidSync */
import { isCasualty, isDead } from "./formation-model.mjs";
import {
  LIGHT_SOURCES,
  restInterval,
  ROLE_HINTS,
  ROLE_LABELS,
  ROLE_ORDER,
  SAVE_KEYS,
} from "./constants.mjs";
import {
  canSeeInDark,
  carriedLoad,
  effectiveSpeed,
  getPartyActor,
  explorationSpeedOf,
  getFrontage,
  getMapperActor,
  getMemberActor,
  realMembers,
  getPartyScene,
  getPartyToken,
  hasAbility,
  isDown,
  isHurried,
  isPartyInDark,
  mapperIsProficient,
  maxFrontage,
  missingRoleGear,
  partySpeed,
} from "./formation-model.mjs";
import { isMemberDeployed } from "./deployment.mjs";
import { senseProfile } from "../lib/senses.mjs";
import { mountOf } from "../lib/mount.mjs";
import { carrierChain } from "../lib/attachment.mjs";
import { carrierSpeedFor } from "./formation-model.mjs";
import { VEHICLE_TYPE } from "../vehicles/constants.mjs";
import { occupantsOf, draftPullOf } from "../vehicles/occupants.mjs";
import { stationsFor } from "../vehicles/stations.mjs";
import { deploymentOf } from "../vehicles/deploy.mjs";
import { driftSummary } from "./lost.mjs";
import { shadowFor, shadowsOf, truePositionToken } from "./shadow.mjs";
import {
  travelOf, trueTravelOf, countryOf, tokenCentre, dayBudget, dayIsSpent, effectiveSeason, navigationOwed,
  DAY_KINDS, ANCILLARY_ACTIVITIES, FOLLOWING_KINDS, ROAD_KINDS, SHOWN_KINDS, TERRITORY_KEYS,
} from "./travel.mjs";
import { episodeScene } from "./lost-episode.mjs";
import { compassBetween, compassPad } from "./plate.mjs";
import { cadenceOf } from "./march.mjs";
import { cadenceMilesFor } from "./encounter-card.mjs";
import {
  colorFor, hexLabelFromOffset, isHexScene, labelFor, layerColorFor, layerLabelFor, layerValueAt, paintableValues,
} from "../battlemap/terrain-paint.mjs";
import { COUNTRY_KEYS } from "../battlemap/country.mjs";
import { ROAD_TINT, WATER_TINT } from "../battlemap/road-markers.mjs";
import { sceneBlockFeet, sceneIncidents } from "../battlemap/scene-setup.mjs";
import { feetPerUnit, isExpeditionScale, sceneMilesPerCell } from "../lib/distance-units.mjs";
import { clockReading } from "../lib/world-time.mjs";
import {
  SETTLEMENT_PACES, SETTLEMENT_LOCATIONS, ROUTE_KNOWLEDGE,
  SETTLEMENT_INTENTS, CONVEYANCES, HOUR_MODES,
  blocksPerTurn, citySpec, streetCadence, strayBlocks,
  resolveCityCadence, cadenceAttribution, districtReaction,
  pickIncidentSource, incidentRouting, isNight,
} from "./settlement.mjs";
import { streetUnder } from "./zones.mjs";
import { findEncounterZone } from "./encounter-zone.mjs";
import { findDistrict } from "./district-zone.mjs";
import { hunterName } from "./hunt.mjs";
import { TERRAIN, travelMultiplier, canEnter } from "../vehicles/vehicle-speed.mjs";
import {
  CLIMATES,
  CONDITIONS,
  PRECIPITATION_KINDS,
  SEASONS,
  TEMPERATURE_BANDS,
  WIND_BANDS,
  conditionsOf,
  generatorReady,
} from "./weather.mjs";
import { ENCOUNTER_TERRAINS, encounterTerrainFor } from "./encounters.mjs";
import { expeditionFrom } from "../lib/movement-scales.mjs";
import { fractionLabel } from "../lib/util.mjs";
import { collectMapItems } from "./map-items.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { formatTurns, parseSpellTurns, turnDistance } from "./turn-engine.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { provisionForecast, daysCarried } from "./provisions.mjs";
import { survivalStateOf, FOOD_SOURCES, WATER_SOURCES } from "./provision-day.mjs";
import {
  NOURISHMENT, HYDRATION, EXPOSURE, heatBurden, exposureBites,
} from "../lib/survival.mjs";
import { MOVEMENT_MODES, composeMovement } from "../lib/movement-modes.mjs";
import { flightMultiplier, FLIGHT_LOADS } from "./flight.mjs";
import { FORAGE_KINDS, forageSpec, huntSpec, standingWaterOf } from "./foraging.mjs";
import { searchSpec, searchesAvailable } from "./searching.mjs";
import { weatherEffects, throwPenalty, foragePenalty } from "./weather-effects.mjs";
import { hexStockView, readStock } from "./hex-stock-run.mjs";
import { hexStockKey } from "./hex-stock.mjs";

/**
 * Build the display context shared by the GM formation window and the party
 * actor sheet: marching order, roles, lights, tracked spells, the turn clock,
 * and rule warnings.
 */
export function buildFormationView(formation) {
  // A journey's speed never reads the scene's darkness: its night is the clock's.
  const journeying = travelOf(formation).mode === "journey";
  const speed = partySpeed(formation, journeying ? { dark: false } : undefined);
  const hurried = isHurried(formation);
  const view = {
    speed,
    effSpeed: effectiveSpeed(formation),
    hurried,
    combatSpeed: Math.floor((speed / 3) * 10) / 10,
    clock: formation.clock,
    elapsed: formatTurns(formation.clock.turnsTotal),
    restMax: restInterval(),
    inCombat: !!formation.combat?.active,
  };

  // Frontage is a free width, so the field is a number and the only ceiling
  // offered is the one the map imposes. A scene that cannot be measured (none
  // loaded yet) offers no ceiling rather than an invented one.
  const frontage = getFrontage(formation);
  view.frontage = frontage;
  view.frontageMax = maxFrontage(getPartyScene(formation) ?? canvas?.scene ?? game.scenes?.viewed);

  const dark = isPartyInDark(formation);
  view.dark = dark;
  view.partyImg = getPartyActor(formation)?.img ?? null;
  const load = carriedLoad(formation);
  const count = formation.members.length;
  let ordinal = 0;
  view.members = formation.members.map((member, index) => {
    const grid = {
      cellIndex: index,
      rank: Math.floor(index / frontage) + 1,
      rankStart: frontage > 1 && index % frontage === 0,
      canUp: index - frontage >= 0,
      canDown: index + frontage < count,
      showHoriz: frontage > 1,
      canLeft: frontage > 1 && index % frontage !== 0,
      canRight: frontage > 1 && index % frontage !== frontage - 1 && index + 1 < count,
    };
    if (member?.blank || !member?.actorId) return { ...grid, blank: true };
    const actor = getMemberActor(member);
    const memberSpeed = explorationSpeedOf(actor);
    const owned = actor?.testUserPermission?.(game.user, "OWNER") ?? false;
    return {
      ...grid,
      actorId: member.actorId,
      index: ++ordinal,
      // Players steer their own characters: reorder + roles on owned members.
      owned,
      canControl: game.user.isGM || owned,
      // A casualty's row says so, and offers the only two things that clear it.
      casualty: isCasualty(actor, member),
      // Leaving in place is offered to a casualty (who otherwise stops the
      // column) and to anyone already out on the map — the camp, the parked
      // wagons, the packs dropped before a fight.
      canLeave: isCasualty(actor, member) || isMemberDeployed(member) || !!member.left,
      dead: isDead(actor, member),
      left: !!member.left,
      name: actor?.name ?? game.i18n.localize("ACKS-FORMATION.app.missingActor"),
      img: actor?.img ?? "icons/svg/mystery-man.svg",
      speed: memberSpeed,
      slowest: memberSpeed === speed && formation.members.length > 1,
      enc: (() => {
        const base = actor?.system?.encumbrance?.value ?? "—";
        const carrier = load.down.length && member.roles?.includes("carrier")
          ? load.carriers.find((c) => c.actor?.id === actor?.id)
          : null;
        return carrier ? `${base}→${carrier.effEnc}` : base;
      })(),
      encMax: actor?.system?.encumbrance?.max ?? "—",
      stashed: !!member.tokenData,
      deployed: isMemberDeployed(member),
      // Out on their own feet rather than swept out by a combat. Only a detach
      // can be undone from here; a fighter is recalled when the fight ends.
      detached: !!member.detached,
      // A detach places the member's token beside the party token, so with no
      // party token on the canvas there is nowhere to step out to and the
      // deploy returns empty. Without this term the control renders enabled and
      // does nothing at all when pressed. Only stepping out needs a member on
      // their feet, since a deploy carries a casualty rather than placing them;
      // recall is open to anyone out on a detach, down or not, to be carried.
      canDetach:
        !!formation.tokenId && !formation.combat?.active
        && (isMemberDeployed(member) ? !!member.detached : !isDown(actor, member)),
      // How far this character sees with no light at all, for the chip that
      // explains why the scout can go where the rest of the party cannot.
      darkSight: senseProfile(actor).sightRange,
      down: isDown(actor, member),
      blind: dark && !canSeeInDark(actor),
      first: index === 0,
      last: index === formation.members.length - 1,
      roles: ROLE_ORDER.map((role) => ({
        key: role,
        label: game.i18n.localize(ROLE_LABELS[role]),
        hint: game.i18n.localize(ROLE_HINTS[role]),
        active: member.roles?.includes(role) ?? false,
      })),
      // Riding: the mount as a chip, so who-is-on-what reads off the roster.
      mount: (() => {
        const m = mountOf(actor);
        if (!m) return null;
        return {
          uuid: m.uuid,
          name: m.name,
          img: m.img,
          sub: null,
          qual: null,
          editable: game.user.isGM || owned,
          detachTooltip: game.i18n.localize("ACKS-FORMATION.app.dismount"),
        };
      })(),
    };
  });

  // The TRAIN: every carrier under a member — mounts, wagons, the horse in a
  // wagon's traces — each with its pace and, for a vehicle, its stations at a
  // glance. Carriers are not members; this is where they show anyway.
  view.train = buildTrain(formation, speed);

  // The JOURNEY: the day board, the ground, the derived day's march, the log.
  view.travel = buildTravelView(formation);
  // The strip is the play surface in every mode; it reads the travel view it
  // sits beside so the camp forecast and the city board are derived once.
  view.strip = buildStripView(formation, speed, view.travel);

  view.lights = formation.lights.map((light) => {
    const bearerActor = game.actors.get(light.bearerId);
    const owned = bearerActor?.testUserPermission?.(game.user, "OWNER") ?? false;
    return {
      ...light,
      label: game.i18n.localize(LIGHT_SOURCES[light.type]?.label ?? light.type),
      bearer: bearerActor?.name ?? "?",
      shieldable: !!LIGHT_SOURCES[light.type]?.shieldable,
      shielded: !!light.shielded,
      // A player manages the lights their own character carries.
      canControl: game.user.isGM || owned,
    };
  });

  view.spells = (formation.spells ?? []).map((spell) => ({
    ...spell,
    caster: game.actors.get(spell.casterId)?.name ?? "—",
  }));

  view.saves = SAVE_KEYS.map((key) => ({
    key,
    label: game.i18n.localize(`ACKS.saves.${key}.long`),
    tooltip: game.i18n.format("ACKS-FORMATION.app.saveTooltip", {
      save: game.i18n.localize(`ACKS.saves.${key}.long`),
    }),
  }));

  // `solo` checks are one character's action, not the party's — a Trapbreaking
  // button that made everyone roll would be six wrong answers and one right.
  view.checks = Object.entries(PARTY_CHECKS)
    .filter(([, cfg]) => !cfg.solo)
    .map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
      hint: game.i18n.localize(cfg.hint),
      icon: cfg.icon,
    }));

  Object.assign(view, buildMapsView(formation));

  view.warnings = buildWarnings(formation, speed);
  return view;
}

/* -------------------------------------------- */
/*  Maps (shared, per-user sanitized)           */
/* -------------------------------------------- */

/**
 * The mapping status and the party's Map items — for EVERY user, because the
 * party carries the maps. Sanitized per viewer: whether the record is
 * distorted, and whether the mapper is actually proficient, are Judge secrets
 * (the whole point of a warped map is that its holders cannot tell), so those
 * fields exist only in the GM's context and never reach a player's DOM.
 * Players may anchor a map held by a member they own.
 */
function buildMapsView(formation) {
  const gm = game.user.isGM;
  const viewing = !!formation.sceneId && canvas?.scene?.id === formation.sceneId;
  const mapper = getMapperActor(formation);

  const mapping = {
    session: !!formation.mapSession,
    viewing,
    hasMapper: !!mapper,
    mapperName: mapper?.name ?? null,
    canStart: viewing && !!mapper,
  };
  if (gm) mapping.proficient = mapperIsProficient(formation);
  if (formation.mapSession) {
    mapping.itemName = fromUuidSync(formation.mapSession.itemUuid)?.name ?? "?";
  }

  const mapItems = collectMapItems(formation).map(({ item, holder, map }) => {
    let anchorReason = null;
    if (map.anchored) anchorReason = "ACKS-FORMATION.map.reasonAnchored";
    else if (!map.explored) anchorReason = "ACKS-FORMATION.map.reasonEmpty";
    else if (map.sceneId !== formation.sceneId) anchorReason = "ACKS-FORMATION.map.reasonScene";
    else if (!viewing) anchorReason = "ACKS-FORMATION.map.reasonViewing";
    const owned = holder?.testUserPermission?.(game.user, "OWNER") ?? false;
    const row = {
      uuid: item.uuid,
      name: item.name,
      holder: holder.name,
      sceneName: map.sceneName ?? "?",
      anchored: !!map.anchored,
      active: !!map.active,
      owned,
      canAnchor: !anchorReason && (gm || owned),
      anchorReason: anchorReason ? game.i18n.localize(anchorReason) : null,
      // Opening the item sheet needs Foundry-side permission on the item.
      canOpen: gm || owned,
    };
    if (gm) {
      row.quality = map.quality;
      row.distorted = map.quality === "distorted";
    }
    return row;
  });

  return { mapping, mapItems };
}

/**
 * The warnings strip, header and strip both. On a journey the dark is the
 * journey's own night (the Judge's word on the hour, else the world clock) and
 * not the scene's darkness, and the turn tracker's rest and winded warnings are
 * left out because a march keeps neither, and by daylight it wants no lantern.
 */
export function buildWarnings(formation, speed) {
  const warnings = [];
  const journeying = travelOf(formation).mode === "journey";
  const inDark = journeying ? journeyIsNight(formation) : isPartyInDark(formation);
  // By daylight a journey needs no lantern: its light warnings are the night's.
  const lightMatters = !journeying || inDark;
  // A closed lantern sheds no light at all.
  const anyLitLight = formation.lights.some((l) => l.lit && !l.shielded);
  const mapper = formation.members.find((m) => m.roles?.includes("mapper"));
  if (formation.members.length && !mapper) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.noMapper"));
  }
  if (mapper && !anyLitLight && lightMatters) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.mapperNoLight"));
  }
  if (mapper && !hasAbility(getMemberActor(mapper), /mapping/i)) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.mapperNoProficiency"));
  }
  if (formation.members.length && !anyLitLight) {
    if (inDark) {
      const sighted = [];
      const blinded = [];
      for (const m of formation.members) {
        if (m?.blank || !m?.actorId) continue;
        const actor = getMemberActor(m);
        if (!actor || isDown(actor, m)) continue;
        (canSeeInDark(actor) ? sighted : blinded).push(actor.name);
      }
      if (blinded.length) {
        warnings.push(
          game.i18n.format("ACKS-FORMATION.warnings.darkBlinded", {
            blinded: blinded.join(", "),
            sighted: sighted.length ? sighted.join(", ") : "—",
          }),
        );
      } else if (sighted.length) {
        warnings.push(game.i18n.format("ACKS-FORMATION.warnings.darkSighted", { sighted: sighted.join(", ") }));
      }
    } else if (lightMatters) {
      warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.noLight"));
    }
  }
  if (!journeying && formation.clock.winded) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.winded"));
  } else if (!journeying && restInterval() != null && formation.clock.turnsSinceRest >= restInterval()) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.restDue"));
  }
  if (speed <= 0 && formation.members.length) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warn.overburdened"));
  }
  if (formation.combat?.active) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.inCombat"));
  }

  // A role held without the implement it needs — the 10' pole, or the mapper's
  // quill and parchment. A Judge can put anyone in any job (judge-override.mjs),
  // so this is the standing reminder of what that job is still missing.
  for (const m of formation.members) {
    const actor = getMemberActor(m);
    if (!actor) continue;
    for (const role of m.roles ?? []) {
      const missing = missingRoleGear(actor, role);
      if (!missing.length) continue;
      warnings.push(
        game.i18n.format("ACKS-FORMATION.warnings.roleNoKit", {
          name: actor.name,
          role: game.i18n.localize(ROLE_LABELS[role] ?? role),
          items: missing.map((spec) => game.i18n.localize(spec.label)).join(", "),
        }),
      );
    }
  }

  // Down members: carried (with the load shown) or in need of carriers.
  const load = carriedLoad(formation);
  if (load.down.length) {
    const names = load.down.map((a) => a.name).join(", ");
    if (load.carriers.length) {
      const detail = load.carriers
        .map((c) =>
          game.i18n.format(
            c.over ? "ACKS-FORMATION.warnings.carrierOver" : "ACKS-FORMATION.warnings.carrierLine",
            { name: c.name, base: c.baseEnc, eff: c.effEnc, cap: c.capacity, speed: c.speed },
          ),
        )
        .join(" · ");
      warnings.push(
        game.i18n.format("ACKS-FORMATION.warnings.carrying", {
          names,
          stone: load.totalStone,
          carriers: load.carriers.length,
          share: load.sharePerCarrier,
        }) + ` ${detail}`,
      );
    } else {
      warnings.push(game.i18n.format("ACKS-FORMATION.warnings.downNoCarrier", { names }));
    }
  }
  return warnings;
}

/* -------------------------------------------- */
/*  GM controls context                         */
/* -------------------------------------------- */

/**
 * Every carrier under a member — the mounts, the wagons, the horse in a
 * wagon's traces — deduplicated across the roster. Carriers are never
 * MEMBERS (their legs reach the party's pace through whoever rides them), so
 * this is the surface where they show: name, pace, and for a vehicle its
 * stations at a glance, with the carrier actually setting the party's pace
 * marked.
 */
function buildTrain(formation, partyPace) {
  const seen = new Map();
  for (const member of formation.members) {
    if (member?.blank || !member?.actorId) continue;
    const actor = getMemberActor(member);
    if (!actor) continue;
    for (const carrier of carrierChain(actor)) {
      if (!seen.has(carrier.uuid)) seen.set(carrier.uuid, carrier);
    }
  }
  return [...seen.values()].map((carrier) => {
    const pace = carrierSpeedFor(carrier, formation);
    const isVehicle = carrier.type === VEHICLE_TYPE;
    let summary = null;
    if (isVehicle) {
      const groups = stationsFor(carrier.system, occupantsOf(carrier), { pull: draftPullOf(carrier) });
      summary = groups
        .filter((g) => g.required != null)
        .map((g) => `${g.labelText || game.i18n.localize(g.labelKey)} ${g.filled}/${g.required}`)
        .join(" · ");
    }
    return {
      uuid: carrier.uuid,
      name: carrier.name,
      img: carrier.img,
      isVehicle,
      pace: typeof pace === "number" ? `${pace}'/${game.i18n.localize("ACKS-FORMATION.app.turn")}` : "—",
      summary,
      setsPace: typeof pace === "number" && pace === partyPace && formation.members.length > 0,
      // A vehicle stood as a place beside the party (vehicles/deploy.mjs), and
      // whether this seat may deploy or strike it.
      deployed: isVehicle && !!deploymentOf(carrier),
      canDeploy: isVehicle && carrier.isOwner,
    };
  });
}

/**
 * The day's march, derived in the rules' order: the party's slowest UNSCALED
 * base (feet per turn), times the ground, the road and the weather — each
 * factor its own line, the door-helper idiom — times the day-kind's pace.
 * A camp day is priced at the dedicated pace so its travel slots can be walked,
 * and still reports `camp: true`. Hexes per day are stated only against a party
 * scene whose cell is a mile or more across.
 */
export function travelReadout(formation, feet) {
  const t = travelOf(formation);
  const kind = DAY_KINDS[t.day?.kind] ?? DAY_KINDS.march;
  const conditions = conditionsOf(t.weather);
  const m = travelMultiplier({
    terrain: t.ground,
    road: t.road,
    raining: !!t.weather?.raining,
    snowing: !!t.weather?.snowing,
    conditions,
  });

  // The mode decides which of those factors the order actually meets, and a
  // flier contributes its own layer on top. Composing through the mode is what
  // keeps one answer for "how fast" across a march, a flight and a voyage —
  // the parts arrive from whoever prices them, and the mode only says which
  // are consulted, in what order, and which stand in for which.
  const mode = t.movement.mode;
  const parts = [...m.parts];
  let flight = null;
  if (mode === "flying") {
    flight = flightMultiplier({
      hoursAloft: t.movement.hoursAloft,
      // An unstated day is one spent entirely aloft — the common case, and
      // the only reading that invents no figure.
      dayHours: t.movement.dayHours || t.movement.hoursAloft,
      windy: conditions.includes("windy"),
      stormy: conditions.includes("stormy"),
      stormyAirSpeed: weatherEffects(["stormy"]).airSpeed,
      load: t.movement.load,
    });
    if (flight.parts) parts.push(...flight.parts);
    if (flight.multiplier == null) parts.push({ key: "aloft.unpriced", factor: 1, missing: true, note: true });
  }

  const composed = composeMovement({ mode, parts });
  const multiplier = composed.multiplier ?? m.multiplier;
  const scene = getPartyScene(formation);
  const e = expeditionFrom(feet, {
    multiplier,
    pace: kind.pace ?? "dedicated",
    milesPerHex: isExpeditionScale(scene) ? sceneMilesPerCell(scene) : null,
  });
  return {
    feet, camp: !kind.travels, multiplier, parts: composed.parts, conditions,
    mode,
    modeLabel: game.i18n.localize(MOVEMENT_MODES[mode]?.label ?? ""),
    // What the mode refused or replaced, so a factor that vanished says why
    // rather than simply not appearing.
    dropped: composed.dropped,
    grounded: !!flight?.grounded,
    ...e,
  };
}

/**
 * The miles a day the party covers on the march, whatever the day board says:
 * the figure a search is priced against, since looking is paced on the march
 * and not on a camp day's dedicated pace. Read from a march-kind copy of the
 * record through `travelReadout` at the dark-free speed; 0 when the readout
 * cannot price a day.
 */
export function expeditionMiles(formation) {
  const t = travelOf(formation);
  const marching = { ...formation, travel: { ...(formation.travel ?? {}), day: { ...t.day, kind: "march" } } };
  return Number(travelReadout(marching, partySpeed(marching, { dark: false })).milesPerDay) || 0;
}

/** The modes the band's select offers, in order, with the label of each. */
const STRIP_MODES = Object.freeze({
  delve: "ACKS-FORMATION.strip.modeDelve",
  journey: "ACKS-FORMATION.travel.legend",
  settlement: "ACKS-FORMATION.settlement.legend",
});

const tenths = (n) => Math.round((Number(n) || 0) * 10) / 10;

/**
 * Whether the journey stands after dark: the Judge's word on the hour, else the
 * world clock. The same answer as `journeyNight` in journey.mjs, which this
 * file cannot import (it imports `travelReadout` from here).
 */
function journeyIsNight(formation) {
  return isNight({ hour: travelOf(formation).hour }, { dark: clockReading()?.dark ?? null });
}

/**
 * The strip's clock cell for a journey: the time, whether it is night by the
 * journey's own reckoning, and the hours (in the calendar's own hours) to the
 * next dusk or dawn. Every figure is null where the world keeps no calendar or
 * has no dark.
 */
function journeyClock(t) {
  const reading = clockReading();
  const night = isNight({ hour: t.hour }, { dark: reading?.dark ?? null });
  const out = {
    time: "",
    dark: night,
    hourMode: t.hour,
    // The Judge's word on the hour stands in for the clock, and says so.
    overridden: t.hour !== "clock",
    hourLabel: game.i18n.localize(HOUR_MODES[t.hour]?.label ?? ""),
    hoursToDusk: null,
    hoursToDawn: null,
  };
  if (!reading) return out;
  const pad = (n) => String(n).padStart(2, "0");
  out.time = `${pad(reading.hour)}:${pad(reading.minute)}`;
  if (reading.dawn === reading.dusk) return out;
  const now = reading.hour + (reading.minute + reading.second / 60) / 60;
  const until = (target) => {
    const ahead = (target - now) % reading.hoursPerDay;
    return tenths(ahead > 0 ? ahead : ahead + reading.hoursPerDay);
  };
  if (night) out.hoursToDawn = until(reading.dawn);
  else out.hoursToDusk = until(reading.dusk);
  return out;
}

/**
 * The play surface's context, by mode: the clock strip on the mode tab, which
 * the frame's band, rails and heads read as well.
 *
 * Every mode carries the mode picker, the pause state, and the camp's supplies.
 * The delve and the city also carry the turn tracker's four stats (the city
 * keeps the turn clock); a journey carries the speed in miles, the day's walked
 * tally against its budget, the hex (the travel view's, so as the seat is
 * shown it), the next throw, the clock and the supplies; a city adds the
 * board's rate, tally and cadence lines.
 *
 * @param {object} formation
 * @param {number} speed  `partySpeed` in feet per turn (dark-free on a journey)
 * @param {object|null} [travelView]  `buildTravelView`'s result when the caller
 *   already has it, so the camp forecast and the city board are derived once
 */
export function buildStripView(formation, speed, travelView = null) {
  const t = travelOf(formation);
  const tv = travelView ?? buildTravelView(formation);
  const clock = formation.clock ?? {};
  const mode = t.mode;
  const loc = (key) => game.i18n.localize(key);

  const stock = tv.camp
    ? { forecast: tv.camp.forecast, short: tv.camp.short }
    : campSupplies(formation, t);
  const strip = {
    mode,
    isDelve: mode === "delve",
    isJourney: mode === "journey",
    isSettlement: mode === "settlement",
    modeLabel: loc(STRIP_MODES[mode]),
    modeOptions: Object.entries(STRIP_MODES).map(([value, label]) => ({
      value, label: loc(label), selected: value === mode,
    })),
    // A journey honours only the Judge's own pause; the turn clock's flag is
    // the one the delve and the city read.
    paused: mode === "journey" ? clock.pausedBy === "judge" : !!clock.paused,
    // `known` is false for an order with no mouths in it, whose days are null.
    supplies: {
      known: stock.forecast.foodDays != null,
      foodDays: stock.forecast.foodDays,
      waterDays: stock.forecast.waterDays,
      short: stock.short,
    },
  };

  if (mode !== "journey") {
    strip.delve = {
      speed,
      effSpeed: effectiveSpeed(formation),
      hurried: isHurried(formation),
      combatSpeed: Math.floor((speed / 3) * 10) / 10,
      turns: clock.turnsTotal,
      elapsed: formatTurns(clock.turnsTotal),
      roundsPartial: clock.roundsPartial ?? 0,
      sinceRest: clock.turnsSinceRest,
      restMax: restInterval(),
      winded: !!clock.winded,
      carryFeet: clock.carryFeet,
    };
  }

  if (mode === "settlement") {
    const s = tv.settlement ?? {};
    strip.settlement = {
      clockLine: s.clockLine ?? "",
      rateBlocks: s.rateBlocks,
      blocksUnpriced: !!s.blocksUnpriced,
      straggling: !!s.straggling,
      headcount: s.headcount,
      blocks: s.blocks,
      turns: s.turns,
      lost: !!s.lost,
      cadenceLine: s.cadenceLine ?? "",
      cadence: s.cadence ?? null,
      cadenceMissing: !!s.cadenceMissing,
      unpricedIntent: !!s.unpricedIntent,
      poiTargets: s.poiTargets ?? 0,
    };
  }

  if (mode === "journey") {
    const readout = travelReadout(formation, speed);
    const milesPerHour = Number(readout.milesPerHour) || 0;
    const budget = dayBudget(t, milesPerHour);
    const scene = getPartyScene(formation);
    // The cadence the engine spends by: the territory where the party REALLY
    // is (`spendJourneyMiles` reads the same), not the one it believes in.
    const cadence = cadenceOf({
      isHex: scene ? isHexScene(scene) : false,
      milesPerCell: scene ? sceneMilesPerCell(scene) : 0,
      mileHex: cadenceMilesFor(trueTravelOf(formation).territory),
    });
    const left = cadence.by === "miles" ? Math.max(0, cadence.miles - (Number(t.day.cadenceCarry) || 0)) : null;
    let next;
    // A player shown unknown country is shown no countdown either: the miles
    // to the next throw are the territory's, and would name it.
    if (tv.blank && !tv.shownUnknown) next = "";
    else if (cadence.by === "grid") next = loc("ACKS-FORMATION.strip.onEnteringHex");
    else if (cadence.by === "miles") next = `${tenths(left)} ${loc("ACKS-FORMATION.travel.milesShort")}`;
    else next = loc("ACKS-FORMATION.strip.unpricedCadence");

    strip.speed = {
      milesPerHour,
      milesPerDay: Number(readout.milesPerDay) || 0,
      hexesPerDay: readout.hexesPerDay ?? null,
      camp: !!readout.camp,
      // The factors the figure was derived from, for the cell's tooltip. A ×1
      // factor says nothing, except the NOTE parts (a washed-out road, the
      // tablesMissing line), whose whole point is explaining a silence.
      partsLine: [
        `${readout.feet}'/${loc("ACKS-FORMATION.app.turn")}`,
        ...(readout.parts ?? [])
          .filter((p) => p.factor !== 1 || p.note)
          .map((p) => {
            const label = loc(`ACKS-VEHICLES.reason.${p.key}`);
            return p.note && p.factor === 1 ? label : `${label} ×${fractionLabel(p.factor)}`;
          }),
      ].join(" · "),
    };
    strip.walked = { miles: tenths(t.day.miles), hours: tenths(t.day.hours) };
    strip.budget = { hours: tenths(budget.hours), miles: tenths(budget.miles) };
    strip.spent = dayIsSpent(t.day, budget);
    // The hex as the seat is shown it: the travel view's, blank while the
    // Judge shows the party nothing of where it stands.
    strip.hex = { label: tv.hex ?? "", entered: t.day.hexesEntered ?? 0 };
    strip.cadence = {
      by: cadence.by,
      miles: cadence.miles,
      missing: cadence.missing ?? null,
      next,
      nextMiles: left == null ? null : tenths(left),
    };
    strip.clock = journeyClock(t);
    strip.dayCount = t.dayCount;
  }
  return strip;
}

/**
 * A distance the settlement board prints beside the scene's own unit.
 * Precision follows magnitude: a whole number at 10 and over, one decimal
 * from 1 up to 10, two significant digits below 1. A genuine zero prints
 * zero. See docs/formation/DECISIONS.md, "Settlement distances round by
 * magnitude, not by a fixed decimal count".
 */
function unitFigure(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 0;
  const size = Math.abs(n);
  if (size >= 10) return Math.round(n);
  if (size >= 1) return Math.round(n * 10) / 10;
  // `floor(log10)` is the place of the leading digit; one more keeps the second.
  const places = Math.min(1 - Math.floor(Math.log10(size)), 20);
  return Number(n.toFixed(places));
}

/**
 * A document's name by uuid, or null for one this world cannot reach. Read
 * synchronously off the compendium index, which is what the panel has; a
 * pack the world no longer holds throws, and that is the same answer.
 */
function nameOfUuid(uuid) {
  try {
    return fromUuidSync(uuid)?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * What the panel says of the clock under the hour picker: the reading the
 * board follows, or the reading the Judge's word stands in for, or that the
 * world keeps no calendar to read. `clock` is `clockReading()`'s answer.
 */
function clockLine(board, clock) {
  const pad = (n) => String(n).padStart(2, "0");
  const time = clock ? `${pad(clock.hour)}:${pad(clock.minute)}` : "";
  if (board.hour !== "clock") return clock ? game.i18n.format("ACKS-FORMATION.settlement.clock.overridden", { time }) : "";
  if (!clock) return game.i18n.localize("ACKS-FORMATION.settlement.clock.unread");
  return game.i18n.format(`ACKS-FORMATION.settlement.clock.${clock.dark ? "night" : "day"}`, {
    time, dawn: clock.dawn, dusk: clock.dusk,
  });
}

/** Why a city turn owes no navigation throw, keyed by `citySpec`'s reason. */
const NO_THROW_REASONS = Object.freeze({
  route: "noThrowRoute",
  pace: "noThrowPace",
  stationary: "noThrowStationary",
});

/**
 * The settlement board's context: the two pickers, the derived block rate with
 * its factors named, and the turn's navigation prospect. Every unpriced
 * answer carries the reason it is unpriced. See docs/formation/DECISIONS.md,
 * "A figure that never arrived is never shown as a zero".
 */
function buildSettlementView(formation, t) {
  const s = t.settlement;
  const opt = (value, label, selected) => ({ value, label, selected });
  const loc = (key) => game.i18n.localize(key);
  // The SAME count the tick straggles by. A marching order keeps blank cells
  // for the ranks a Judge has left open, and counting them puts a straggling
  // tier on the panel that the turn never applies.
  const heads = realMembers(formation ?? {}).length;

  // A party staying put covers no ground, never navigates, and is thrown for
  // by the DAY. The tick branches on exactly this; a panel that did not would
  // show a holed-up party a block rate and a navigation target it is not
  // subject to, which reads as the tick forgetting to apply them.
  // Where the party actually is, by the two readers the tick consults: the road
  // drawn under the token, then the picker. A panel showing the picker's
  // cadence while the tick used the road's reads as the tick ignoring the panel.
  const { road, here } = streetUnder(formation, s);

  const stationary = !!SETTLEMENT_LOCATIONS[here.where]?.stationary;
  const rate = stationary ? { blocks: 0, parts: [] } : blocksPerTurn({ pace: s.pace, headcount: heads });
  const spec = stationary
    ? { throws: false, reason: "stationary" }
    : citySpec({ pace: s.pace, route: s.route });

  // What a Judge has drawn over the ground the party is standing on — the SAME
  // two lookups the tick resolves the cadence with, so the panel can never show
  // a rhythm the tick does not also use. Reading both from one lookup avoids a
  // panel that asked only the street while the turn also asked the zone.
  const zoneHit = findEncounterZone(formation);
  const districtHit = findDistrict(formation);
  const zone = zoneHit?.behavior?.system ?? null;
  const district = districtHit?.behavior?.system ?? null;
  // The hour as the next turn will resolve it: the board's own word, or the
  // world clock's reading, which the panel also prints beside the picker so a
  // cadence that changed at dusk is explained where it is shown.
  const clock = clockReading();
  const night = isNight(s, { dark: clock?.dark ?? null });
  const cadence = resolveCityCadence(
    streetCadence({ where: here.where, night, intent: s.intent }),
    { zone, district, night, intent: s.intent },
  );
  // WHERE the rhythm came from, so a zone or district override never reads as
  // the street's own number. The same reader the turn card uses, and per
  // FIGURE: the interval and the target can have different owners.
  const said = cadenceAttribution(cadence, {
    street: loc("ACKS-FORMATION.settlement.cadenceStreet"),
    zone: zoneHit?.region?.name ?? "",
    district: districtHit?.region?.name ?? "",
  });
  const cadenceLine = said ? game.i18n.format(said.key, said.data) : "";
  const districtName = districtHit?.region?.name ?? "";
  const reaction = districtReaction(district, { where: here.where });
  let districtReactionLine = "";
  if (reaction) {
    // A bare negative already reads as a penalty; a bare positive does not, so
    // the sign is written out rather than trusted to `Number#toString`.
    const modifier = reaction.modifier >= 0 ? `+${reaction.modifier}` : `${reaction.modifier}`;
    districtReactionLine = reaction.scope === "any"
      ? game.i18n.format("ACKS-FORMATION.settlement.district.reaction", { place: districtName, modifier })
      : game.i18n.format("ACKS-FORMATION.settlement.district.reactionWhere", {
        place: districtName, modifier, where: loc(SETTLEMENT_LOCATIONS[reaction.scope].label),
      });
  }

  // What the party's own movement is being timed by here. The scene answers,
  // so the panel and the tracker can never disagree about the rate.
  const scene = getPartyScene(formation);
  const blockFeet = sceneBlockFeet(scene);
  // The block size as the Judge typed it, and the turn's rate, both converted
  // to the scene's unit and rounded through the same `unitFigure` formatter.
  const turnFeet = unitFigure((turnDistance(formation, scene) || 0) / feetPerUnit(scene?.grid?.units));
  // The place the party is standing AT, and the quarter's own place — by the
  // location feature's readers, because which token is a place is that
  // feature's question. Read through its api, which is published at ready and
  // is always there by the time a sheet renders.
  const location = globalThis.acksExtras?.location;
  const placeHere = location?.here?.placeUnderParty?.(formation) ?? null;
  const districtPlace = districtHit?.region
    ? (location?.scenes?.locationOfRegion?.(districtHit.region) ?? null)
    : null;
  const poiTargets = scene ? (location?.here?.placesOnScene?.(scene) ?? []).length : 0;
  const mayView = (place) => !!place?.testUserPermission?.(game.user, "LIMITED");

  // Which list the next incident is read from, by the SAME order the turn
  // walks (`pickIncidentSource`), with every list named ahead of it that no
  // longer exists. Judge-only: it names tables the players cannot see. A
  // party with no token anywhere has no map to have said anything, so the
  // map's list is asked of the scene the party is on.
  const listLines = game.user?.isGM
    ? incidentRouting(
      pickIncidentSource({ district, zone, wanted: s.wanted, city: sceneIncidents(scene) }),
      nameOfUuid,
    ).map((line) => ({
      warn: !!line.warn,
      text: game.i18n.format(`ACKS-FORMATION.settlement.lists.${line.key}`, {
        ...line.data,
        ...(line.data.list ? { list: loc(`ACKS-FORMATION.settlement.lists.source.${line.data.list}`) } : {}),
      }),
    }))
    : [];

  return {
    ...s,
    // The SAME count `blocksPerTurn` straggles by, so a Judge asking why the
    // party is crowded here can be told the number rather than only the word.
    headcount: heads,
    // Null stays null — it is the silence `timedByBlocks` reads, not a size.
    blockFeet: blockFeet == null ? null : unitFigure(blockFeet),
    turnFeet,
    onMap: !!scene,
    units: scene?.grid?.units ?? "",
    paceOptions: Object.entries(SETTLEMENT_PACES).map(([k, v]) => opt(k, loc(v.label), k === s.pace)),
    whereOptions: Object.entries(SETTLEMENT_LOCATIONS).map(([k, v]) => opt(k, loc(v.label), k === s.where)),
    routeOptions: Object.entries(ROUTE_KNOWLEDGE).map(([k, v]) => opt(k, loc(v.label), k === s.route)),
    hourOptions: Object.entries(HOUR_MODES).map(([k, v]) => opt(k, loc(v.label), k === s.hour)),
    // Whether it is dark for the NEXT turn, resolved the way the tick resolves
    // it, and what the clock says beside the picker: the reading it follows,
    // or the reading the Judge's word is standing in for.
    night,
    clockLine: clockLine(s, clock),
    intentOptions: Object.entries(SETTLEMENT_INTENTS).map(([k, v]) => opt(k, loc(v.label), k === s.intent)),
    conveyanceOptions: Object.entries(CONVEYANCES).map(([k, v]) => opt(k, loc(v.label), k === s.conveyance)),
    // Holing up is measured in DAYS, and the world clock credits them: a party
    // that is not going anywhere has no movement for the tracker to read.
    stationary,
    // Which layer priced the cadence below, so the readout can name the
    // quarter or the drawn zone instead of printing an overridden rhythm as
    // though it were the street's own.
    cadenceLine,
    // The district the party is standing in, or "" outside one.
    districtName,
    // Who set the hunted flag, when a faction's ledger did (hunt.mjs): The
    // city section names it under the Judge's own Hunted pill.
    huntedByName: hunterName(s),
    // How the quarter's own reputation reads here, or "" when the district is
    // silent about it (no district, no modifier, or a modifier owed somewhere
    // else in the quarter).
    districtReactionLine,
    // Where the party is standing, as a PLACE: the token under it and the
    // quarter's own place. Null is "nowhere in particular". Each is named to
    // everyone — the token on the map already names it — and opens only for a
    // seat that may view it: an imported place is owned by nobody until the
    // Judge shares it.
    placeHere: placeHere ? { uuid: placeHere.uuid, name: placeHere.name, canOpen: mayView(placeHere) } : null,
    districtPlace: districtPlace ? { uuid: districtPlace.uuid, name: districtPlace.name, canOpen: mayView(districtPlace) } : null,
    // How many places have a token on this map: what a walk can be made to.
    poiTargets,
    // Which list answers here, and which named lists are gone — `{text, warn}`
    // rows, already formatted.
    listLines,
    // Whether The city section has anything for a player: the pickers and the
    // tracker are the Judge's, the places underfoot are the table's.
    shown: !!game.user?.isGM || !!(districtName || placeHere || districtPlace),
    // The RATE, kept apart from the tally the spread above carries.
    rateBlocks: rate.blocks,
    blocksUnpriced: rate.blocks == null,
    straggling: (rate.parts ?? []).some((p) => p.key === "straggling"),
    throws: !!spec.throws,
    // A suppressed throw says WHY: staying put, a known route, or a pace that
    // never gets lost.
    noThrowReason: spec.throws ? "" : loc(`ACKS-FORMATION.settlement.${NO_THROW_REASONS[spec.reason] ?? "noThrowPace"}`),
    navTarget: spec.throws ? spec.target : null,
    navModifier: spec.throws ? (spec.modifier ?? 0) : 0,
    navUnpriced: !!spec.throws && spec.target == null,
    // Been there before, and by how much that helps never arrived. An imported
    // zero and a figure that never came read the same on the panel unless the
    // panel says which it is.
    navRouteUnpriced: !!spec.throws && !!spec.unpricedRoute,
    unpricedIntent: !!cadence?.unpricedIntent,
    // What a failed throw costs, named beside the throw itself rather than
    // only after the fact on the card: a Judge deciding whether to risk the
    // throw at all needs the price up front.
    stray: strayBlocks(),
    cadence,
    cadenceMissing: !cadence,
    // Blocks are timed only when the map declared a block size AND the
    // registry priced the pace; missing either falls back to walking speed.
    timedByBlocks: !stationary && !!blockFeet && rate.blocks != null,
    // The street the MAP says the party is on, when a road says so. The picker
    // stays on its own value — it is what the Judge typed, and a select that
    // silently re-pointed itself would hide the override rather than show it.
    whereFromRoad: here.from === "road",
    roadLine: here.from === "road"
      ? game.i18n.format(
        `ACKS-FORMATION.settlement.road.${road.name ? "here" : "hereUnnamed"}`,
        { road: road.name, where: loc(`ACKS-FORMATION.settlement.street.${here.where}`) },
      )
      : "",
    // Whether the last move was counted along the streets. Null until the party
    // has moved: a tracker claiming either of two measurements before one has
    // been made is naming a rate nothing used.
    measuredAlong: s.measuredAlong,
  };
}

/**
 * What the packs hold against the mouths in the order: the forecast the camp
 * block and the strip both print, read by the SAME reader the provisioning uses
 * so the forecast and the meal can never disagree about what is carried.
 */
function campSupplies(formation, t) {
  const actors = realMembers(formation ?? {}).map(getMemberActor).filter(Boolean);
  const mouths = actors.length;
  const food = actors.reduce((n, a) => n + daysCarried(a, FOOD_SOURCES) + daysCarried(a, { foraged: "hunt" }), 0);
  const water = actors.reduce((n, a) => n + daysCarried(a, WATER_SOURCES), 0);
  const burden = heatBurden({ band: t.weather?.temperature ?? "" });
  const forecast = provisionForecast({ mouths, food, water, waterNeed: burden.waterNeed });
  return {
    actors,
    mouths,
    burden,
    forecast,
    short: (forecast.foodDays != null && forecast.foodDays < 1)
      || (forecast.waterDays != null && forecast.waterDays < 1),
  };
}

/**
 * The camp: what the party is living on, and who is suffering for it — one
 * section, since a Judge asks how long the packs last, who is going short,
 * and whether tonight's foraging is worth the hours together. `milesPerDay` is
 * the expedition's march day (`expeditionMiles`), which prices a search hour.
 * `stock` is the Judge's `hexStockView`, or null for a player: the search
 * selects (`presentOptions`, `targetOptions`) and the point names in them are
 * built only from it.
 */
function buildCampView(formation, t, milesPerDay = 0, stock = null) {
  const { actors, mouths, burden, forecast, short } = campSupplies(formation, t);

  // Only the suffering are listed. A roster of well-fed names is noise, and it
  // would bury the one person who is starving.
  const suffering = actors
    .map((a) => ({ name: a.name, ...survivalStateOf(a) }))
    .filter((r) => r.nourishment !== "fed" || r.hydration !== "watered" || r.exposure !== "sheltered")
    .map((r) => ({
      name: r.name,
      nourishment: r.nourishment === "fed" ? "" : game.i18n.localize(NOURISHMENT[r.nourishment].label),
      hydration: r.hydration === "watered" ? "" : game.i18n.localize(HYDRATION[r.hydration].label),
      exposure: r.exposure === "sheltered" ? "" : game.i18n.localize(EXPOSURE[r.exposure].label),
      conLost: r.conLost,
    }));

  // What the picked slots could actually yield tonight.
  // The day board stores its picks as `activities` — reading a `slots` that
  // no writer ever sets leaves this list permanently empty, which reads as a
  // party that chose no ancillary work rather than as a broken lookup.
  const slots = Array.isArray(t.day?.activities) ? t.day.activities : [];
  const survival = actors.some((a) => hasAbility(a, /survival/i));
  const kinds = ["food", "water", "firewood"].filter((k) => slots.includes("forage") || k === "food");
  const fx = weatherEffects(conditionsOf(t.weather), { terrain: t.ground });
  const forage = slots.includes("forage")
    ? kinds.map((kind) => {
        const spec = forageSpec({
          kind, terrain: t.ground, territory: t.territory, survival,
          standingWater: standingWaterOf(t),
          weather: foragePenalty(fx, kind),
          willingToSteal: t.camp.steal,
        });
        return {
          kind,
          label: game.i18n.localize(FORAGE_KINDS[kind].label),
          ...spec,
          unpriced: !spec.ok,
        };
      })
    : [];
  const hunt = slots.includes("hunt") ? huntSpec({ territory: t.territory }) : null;

  const search = slots.includes("search")
    ? searchSpec({ milesPerDay: Number(milesPerDay) || 0, terrain: t.ground, weather: throwPenalty(fx, "searching") })
    : null;

  // The Judge's two search answers. The stock is offered only where the hex
  // holds one, and is then the default; the point list is the unfound ones.
  // The record's word is selected where the hex still offers it, so the
  // choice survives the re-render its own submit makes; one it no longer
  // offers (the stock of an unstocked hex, a point since found) falls back.
  const presentOptions = [];
  const targetOptions = [];
  if (stock) {
    const said = t.camp.present;
    const answer = said && (said !== "stock" || stock.stocked) ? said : (stock.stocked ? "stock" : "no");
    for (const value of ["stock", "yes", "no"]) {
      if (value === "stock" && !stock.stocked) continue;
      presentOptions.push({
        value, label: game.i18n.localize(`ACKS-FORMATION.searchRun.presentOptions.${value}`), selected: value === answer,
      });
    }
    const unfound = stock.points.filter((p) => !p.found);
    const wanted = ["anything", "elsewhere", ...unfound.map((p) => p.id)].includes(t.camp.target) ? t.camp.target : "anything";
    targetOptions.push(
      { value: "anything", label: game.i18n.localize("ACKS-FORMATION.searchRun.lookingAnything"), selected: wanted === "anything" },
      ...unfound.map((p) => ({ value: p.id, label: p.name || p.kindLabel, selected: wanted === p.id })),
      { value: "elsewhere", label: game.i18n.localize("ACKS-FORMATION.searchRun.lookingElsewhere"), selected: wanted === "elsewhere" },
    );
  }

  return {
    mouths,
    forecast,
    waterNeed: burden.waterNeed,
    thirstyWeather: burden.waterNeed > 1,
    short,
    suffering,
    anySuffering: suffering.length > 0,
    forage,
    hunt,
    search,
    presentOptions,
    targetOptions,
    searchesHeld: searchesAvailable({ slots, forced: t.day?.kind === "forced" }),
    // The camp's declarations. `waterAuto` is the standing-water answer the
    // rest of the record already gives (a followed river, a river pick), so the
    // Camp section can say the water is at hand without the box being ticked.
    steal: t.camp.steal,
    water: t.camp.water,
    waterAuto: standingWaterOf({ ...t, camp: { ...t.camp, water: false } }),
    sleepInArmour: t.camp.sleepInArmour,
    // The weather's inputs, so the Judge can declare them and see them applied.
    // `bites` says whether the hours cost anything today: the band runs a cold
    // clock, the heat asks an armour save by the hour, or the sky burns. A mild
    // day shows the control greyed rather than inviting hours that do nothing.
    exposure: {
      ...t.exposure,
      band: t.weather?.temperature ?? "",
      bites: exposureBites(t.weather?.temperature ?? "")
        || burden.armourAt != null
        || !!weatherEffects(conditionsOf(t.weather ?? {}), { terrain: t.ground }).sunburn,
    },
  };
}

/**
 * The context of the Judge's declarations (the titled sections of the mode
 * tab, the Judge's tab and the Sightings tab). Outside a journey or a city it
 * is only the mode; inside a journey it is the pickers, the day board, the
 * camp, the hex trace, the GM-only lost state, and the newest slice of the log;
 * inside a city, the board's pickers and place lines. What the strip prints
 * (speed, the walked tally, the clock) is `buildStripView`'s.
 *
 * The hex is the one the party BELIEVES it stands in — the party token's —
 * and `travel.shown` decides what of it a seat is shown, the same on every
 * seat: the hex drawn on the plate (`plate`), its label (`hex`) and the
 * country's cards; or, `unknown`, a blank plate, no label and the one
 * "Unknown country" line (`blank`, and `shownUnknown` on the Judge's copy).
 * `hexField` keeps the record's own label for the Judge's hex field, so a
 * blank never submits over it.
 *
 * `asPlayer` builds what a player's seat gets: no stock, no Judge's marks on
 * the cards, none of the Judge tab's context. A Judge's view carries that
 * context as `judge` (`buildJudgeTravel`), whose preview of a player's
 * rendering is this function's own `asPlayer` branch.
 *
 * @param {object} formation
 * @param {{asPlayer?: boolean}} [options]  `asPlayer` defaults to the seat's own
 */
export function buildTravelView(formation, { asPlayer = !game.user?.isGM } = {}) {
  const t = travelOf(formation);
  const isJourney = t.mode === "journey";
  const isSettlement = t.mode === "settlement";
  const blank = isJourney && t.shown === "unknown";
  const standing = isJourney ? standingLabel(formation, t) : t.hex.label;
  const view = {
    isJourney, isSettlement, mode: t.mode,
    // The bends the day has walked, in hexes. Shown apart from the march so the
    // road's cost and its benefit stay legible as two different things.
    winding: Number(t.day?.winding) || 0,
    dayCount: t.dayCount, hex: blank ? "" : standing, hexField: t.hex.label, hexesEntered: t.day?.hexesEntered ?? 0,
    shown: t.shown,
    blank,
    shownUnknown: blank && !asPlayer,
  };
  if (isSettlement) return { ...view, settlement: buildSettlementView(formation, t) };
  if (!isJourney) return view;
  view.plate = believedPlate(formation, t, { judge: !asPlayer, blank, hexLabel: standing });
  // The Judge's "This hex" block; a player's view carries none of the stock.
  view.hexStock = asPlayer ? null : hexStockView(formation);
  view.camp = buildCampView(formation, t, expeditionMiles(formation), view.hexStock);

  const opt = (value, label, selected) => ({ value, label, selected });
  // The country as read: four cards, the climate the Sky section reads, and
  // the table the encounters draw on. The band's chips read the two lists.
  const country = buildCountryView(formation, t, { judge: !asPlayer });
  view.country = blank ? { unknown: true, cards: [], climate: country.climate, encountersDrawOn: null } : country;
  view.territories = TERRITORY_KEYS.map((value) =>
    opt(value, game.i18n.localize(`ACKS-FORMATION.travel.territory.${value}`), value === t.territory));
  view.followingOptions = FOLLOWING_KINDS.map((value) =>
    opt(value, game.i18n.localize(`ACKS-FORMATION.travel.following.${value}`), value === t.following));
  view.weather = buildWeatherView(t, opt, view.country.climate);
  view.wheels = wheelRefusals(formation, t);
  // The Sky group is the Judge's pickers; a player sees it only for what it
  // already told the table (the chips, the night band, a wagon that cannot roll).
  view.skyShown = !asPlayer || !!(view.weather.chips.length || view.weather.night || view.wheels.length);

  // How the order moves. The flight fields appear only for a flier, because
  // hours aloft mean nothing to a party on foot and an always-visible field
  // that never applies reads as one the Judge forgot to fill.
  view.movement = t.movement;
  view.movementModes = Object.entries(MOVEMENT_MODES).map(([value, cfg]) =>
    opt(value, game.i18n.localize(cfg.label), value === t.movement.mode));
  view.flying = t.movement.mode === "flying";
  view.flightLoads = Object.entries(FLIGHT_LOADS).map(([value, cfg]) =>
    opt(value, game.i18n.localize(cfg.label), value === t.movement.load));

  view.dayKinds = Object.entries(DAY_KINDS).map(([value, cfg]) =>
    opt(value, game.i18n.localize(cfg.label), value === t.day.kind));
  view.forced = !!DAY_KINDS[t.day.kind]?.consumesAncillary;
  const activityOptions = Object.entries(ANCILLARY_ACTIVITIES).filter(([, cfg]) => !cfg.declared).map(([value, cfg]) => ({
    value,
    label: game.i18n.localize(cfg.label),
  }));
  view.slots = (t.day.activities ?? []).map((value, index) => ({
    index,
    options: activityOptions.map((o) => ({ ...o, selected: o.value === value })),
    empty: value == null,
    done: !!t.day.done?.[index],
  }));
  // The day's own declarations: traps managed, and a night without sleep.
  view.traps = t.day.traps;
  view.noSleep = t.day.noSleep;
  view.hourOptions = Object.entries(HOUR_MODES).map(([value, cfg]) =>
    opt(value, game.i18n.localize(cfg.label), value === t.hour));
  // ONE lost view: the fields the episode needs and the fields the panel
  // needs are the same object, filled once.
  const drift = driftSummary(t.lost, t.dayCount);
  const phase = t.lost.phase ?? null;
  view.lost = {
    active: phase === "astray",
    aware: phase === "aware",
    open: !!phase,
    // A shadow standing with no episode open: an earlier ending left it, and
    // the panel's closing buttons still retire it.
    leftover: !phase && !asPlayer ? shadowsOf(formation.id).length > 0 : false,
    judgeNote: t.lost.judgeNote ?? "",
    days: drift?.days ?? 0,
    fakedHexes: drift?.fakedHexes ?? 0,
    hasHex: t.hex?.i != null && t.hex?.j != null,
  };
  // A party shown unknown country is shown no hex on its past days either:
  // the log's rows are named by the hex they ended in.
  view.log = t.log.slice(0, 10).map((e) => ({
    ...e,
    hex: blank ? "" : e.hex,
    kindLabel: game.i18n.localize(DAY_KINDS[e.dayKind]?.label ?? DAY_KINDS.march.label),
    weatherLine: [e.weather?.temperature, e.weather?.precipitation, e.weather?.wind]
      .map((k) => TEMPERATURE_BANDS[k] ?? PRECIPITATION_KINDS[k] ?? WIND_BANDS[k])
      .filter(Boolean)
      .map((cfg) => game.i18n.localize(cfg.label))
      .join(" · "),
  }));
  if (!asPlayer) view.judge = buildJudgeTravel(formation, t);
  return view;
}

/* -------------------------------------------- */
/*  The plates and the Judge's tab              */
/* -------------------------------------------- */

/**
 * A plate's context: what the plate partial renders (`kind`, `draw`, `blank`,
 * `hex`, `aria`, `img`, `edit`, `differ`) and what `drawPlate` paints from
 * (`sceneId`, `center`, `tint`, `points`, `mark`, `judge`). `token` stands in
 * the hex drawn — the party token for the hex the party believes it stands
 * in, the shadow for the true one — and the plate draws nothing without it.
 * The stock's points are this formation's found ones; a Judge's plate also
 * carries the unfound, which it draws dashed. `blank` is the plate of a hex
 * the party is shown nothing of: the frame, no drawing and no label.
 */
function plateOf(formation, { kind, scene, token, judge = false, blank = false, hexLabel = "", mark = null }) {
  const img = getPartyActor(formation)?.img ?? null;
  const base = { kind, judge, blank, img, hex: blank ? "" : hexLabel, draw: false, edit: false, differ: false, aria: "" };
  if (blank) return { ...base, aria: game.i18n.localize("ACKS-FORMATION.plate.blank") };
  if (!scene?.grid || !token) return base;
  // The true and the believed plates stand side by side, so each is named
  // for what it is before the hex; the frame's plate is the only one of its kind.
  const named = kind === "true" || kind === "believed" ? game.i18n.localize(`ACKS-FORMATION.where.${kind}`) : null;
  let aria;
  if (named) {
    aria = hexLabel
      ? game.i18n.format("ACKS-FORMATION.plate.ariaOf", { kind: named, hex: hexLabel })
      : game.i18n.format("ACKS-FORMATION.plate.ariaOfNoHex", { kind: named });
  } else {
    aria = hexLabel ? game.i18n.format("ACKS-FORMATION.plate.aria", { hex: hexLabel }) : game.i18n.localize("ACKS-FORMATION.plate.ariaNoHex");
  }
  const center = tokenCentre(token, scene);
  const hexed = isHexScene(scene);
  const key = hexed ? hexStockKey({ offset: scene.grid.getOffset(center) }) : hexStockKey({ label: hexLabel });
  const record = key ? readStock(scene, key) : null;
  const points = (record?.points ?? [])
    .map((p) => ({ id: p.id, found: Object.hasOwn(p.found ?? {}, formation.id) }))
    .filter((p) => p.id != null && (judge || p.found));
  const painted = hexed ? layerValueAt(scene, center, "terrain") : null;
  return {
    ...base,
    draw: true,
    sceneId: scene.id,
    center,
    tint: painted ? colorFor(painted) : null,
    points,
    mark: mark ?? img,
    aria,
  };
}

/** The image a plate marks the party with: its token's, else its actor's. */
const markOf = (formation) => getPartyToken(formation)?.texture?.src ?? getPartyActor(formation)?.img ?? null;

/**
 * The label of the hex the party believes it stands in: the record's own
 * (the trace's, or the Judge's typed one), else the party token's cell read
 * off a hex scene, so a party placed and not yet walked is still named;
 * empty where neither answers.
 */
function standingLabel(formation, t) {
  if (t.hex.label) return t.hex.label;
  const token = getPartyToken(formation);
  const scene = token?.parent;
  if (!token || !scene?.grid || !isHexScene(scene)) return "";
  return hexLabelFromOffset(scene.grid.getOffset(tokenCentre(token, scene)));
}

/**
 * The plate of the hex the party believes it stands in: the party token's,
 * drawn on the frame of every seat while a journey has a token on a scene, or
 * the blank of a hex the party is shown nothing of. `hexLabel` is the hex's
 * label as the view names it (`standingLabel`).
 */
function believedPlate(formation, t, { judge, blank, hexLabel = t.hex.label }) {
  const token = getPartyToken(formation);
  return plateOf(formation, {
    kind: "frame", scene: token?.parent ?? getPartyScene(formation), token, judge, blank, hexLabel, mark: markOf(formation),
  });
}

/** A compass direction's name on the Judge's tab, long or short. */
const compassName = (dir, { short = false } = {}) =>
  game.i18n.localize(`ACKS-FORMATION.where.compass.${short ? "short." : ""}${dir}`);

/**
 * Where they are, for the Judge: the true hex (`truePositionToken` — the
 * shadow while an episode keeps one, else the party token) and the believed
 * hex (the party token's), each as a plate, whether they differ, and the
 * compass direction from the belief to the truth (`compassBetween`, a name of
 * the six, no distance). With no episode open both are the party token's: a
 * shadow an earlier ending left standing is not where the party is. `pad` is
 * the Shift the truth pad, laid out by the grid's orientation (`compassPad`),
 * while an episode is open and its shadow stands on a hex scene; null
 * otherwise.
 */
function whereView(formation, t) {
  const open = !!t.lost.phase;
  const scene = (open ? episodeScene(formation, t.lost) : null) ?? getPartyScene(formation);
  const party = getPartyToken(formation);
  const believedToken = party && party.parent?.id === scene?.id ? party : null;
  const truthToken = (open && scene ? truePositionToken(scene, formation) : null) ?? believedToken;
  const offsetOf = (token) => (token && scene?.grid ? scene.grid.getOffset(tokenCentre(token, scene)) : null);
  const hexed = !!scene && isHexScene(scene);
  const labelOf = (offset, fallback) => (offset && hexed ? hexLabelFromOffset(offset) : fallback);
  const believedHex = offsetOf(believedToken);
  const trueHex = offsetOf(truthToken);
  const believedLabel = labelOf(believedHex, t.hex.label);
  const trueLabel = labelOf(trueHex, t.hex.label);
  const differ = !!believedHex && !!trueHex && (believedHex.i !== trueHex.i || believedHex.j !== trueHex.j);
  const dir = differ && hexed ? compassBetween(scene, believedHex, trueHex) : null;
  const mark = markOf(formation);
  const layout = open && hexed && shadowFor(scene, formation.id) ? compassPad(scene) : null;
  return {
    open,
    trueHex: trueLabel,
    believedHex: believedLabel,
    differ,
    compass: dir ? { dir, label: compassName(dir) } : null,
    truth: plateOf(formation, { kind: "true", scene, token: truthToken, judge: true, hexLabel: trueLabel, mark }),
    belief: { ...plateOf(formation, { kind: "believed", scene, token: believedToken, judge: true, hexLabel: believedLabel, mark }), differ },
    pad: layout
      ? layout.map((cell) => {
          if (cell == null) return { empty: true };
          if (cell === "center") return { direction: "roll", short: "", label: game.i18n.localize("ACKS-FORMATION.where.roll"), roll: true };
          return { direction: cell, short: compassName(cell, { short: true }), label: compassName(cell) };
        })
      : null,
  };
}

/** The words a route spares the throw by: a road's surface, or what the party follows. */
function routeLabel(owed) {
  if (owed.route === "road") return countryLabel("road", owed.road);
  return countryLabel("following", owed.route);
}

/**
 * Navigation, quietly: when the next throw is owed (`navigationOwed`) as one
 * line, and the record's history, newest first. A row's day is the End-day
 * count the throw was made on, counted from one as the log and the head count
 * it; a throw that could not be made — its target unimported — says so in
 * place of its figures.
 */
function navigationView(formation, t) {
  const owed = navigationOwed(formation);
  const line = {
    owed: game.i18n.localize("ACKS-FORMATION.navigation.owed"),
    thrown: game.i18n.localize("ACKS-FORMATION.navigation.thrown"),
    following: owed.route ? game.i18n.format("ACKS-FORMATION.navigation.following", { what: routeLabel(owed) }) : "",
    none: "",
  }[owed.state];
  const history = t.navigation.history.map((e) => {
    const made = e.success != null;
    return {
      day: e.count == null ? "—" : e.count + 1,
      hex: e.hexLabel || "—",
      figures: made ? game.i18n.format("ACKS-FORMATION.navigation.figures", { total: e.total, target: e.target }) : "",
      verdict: game.i18n.localize(`ACKS-FORMATION.navigation.verdict.${made ? (e.success ? "kept" : "strayed") : "unmade"}`),
      strayed: e.success === false,
      by: game.i18n.localize(`ACKS-FORMATION.navigation.by.${e.by}`),
    };
  });
  return { state: owed.state, line, history, canThrow: owed.state !== "none" };
}

/**
 * The Judge tab's context on a journey: what the party is shown (`shown`, the
 * radio tiles of `SHOWN_KINDS`, and `preview`, a player's plate, hex and
 * country from `buildTravelView`'s own `asPlayer` branch), where they are
 * (`whereView`) and the navigation throw (`navigationView`).
 */
function buildJudgeTravel(formation, t) {
  const preview = buildTravelView(formation, { asPlayer: true });
  return {
    shown: SHOWN_KINDS.map((value) => ({
      value,
      label: game.i18n.localize(`ACKS-FORMATION.shown.${value}`),
      hint: game.i18n.localize(`ACKS-FORMATION.shown.${value}Hint`),
      checked: value === t.shown,
    })),
    preview: { plate: { ...preview.plate, kind: "preview" }, hex: preview.hex, blank: preview.blank, country: preview.country },
    where: whereView(formation, t),
    navigation: navigationView(formation, t),
  };
}

/** The country keys the Country section draws as cards, each with the brush layer it is painted on. */
const COUNTRY_CARDS = Object.freeze([
  { key: "ground", label: "ACKS-FORMATION.travel.ground", layer: "terrain" },
  { key: "road", label: "ACKS-FORMATION.travel.roadLabel", layer: null },
  { key: "following", label: "ACKS-FORMATION.travel.followingLabel", layer: null },
  { key: "territory", label: "ACKS-FORMATION.travel.territoryLabel", layer: "territory" },
]);

/** The label each country key is chosen by in the Judge's hand. */
const COUNTRY_KEY_LABELS = Object.freeze({
  ground: "ACKS-FORMATION.travel.ground",
  encounterTerrain: "ACKS-FORMATION.travel.enc.terrainLabel",
  territory: "ACKS-FORMATION.travel.territoryLabel",
  climate: "ACKS-FORMATION.travel.weather.climate",
  road: "ACKS-FORMATION.travel.roadLabel",
  following: "ACKS-FORMATION.travel.followingLabel",
});

/** A PIXI tint as the CSS colour a swatch is painted in. */
const cssTint = (n) => (Number.isFinite(n) ? `#${n.toString(16).padStart(6, "0")}` : null);

/** The words a country key's value is read in on the sheet; the unset dash where it has none. */
function countryLabel(key, value) {
  if (value == null || value === "") return game.i18n.localize("ACKS-FORMATION.travel.weather.unset");
  if (key === "ground") return labelFor(value);
  if (key === "encounterTerrain") {
    return ENCOUNTER_TERRAINS[value] ? game.i18n.localize(ENCOUNTER_TERRAINS[value].label) : labelFor(value);
  }
  if (key === "climate" || key === "territory") return layerLabelFor(value, key);
  return game.i18n.localize(`ACKS-FORMATION.travel.${key}.${value}`);
}

/**
 * The colour a card's swatch is painted in: the brush's for a ground, a
 * territory or a climate (a ground in the colour of the encounter terrain it
 * stands for, where that one is on it), the overlay's for a road or a river,
 * and none where the party is on neither.
 */
function countrySwatch(key, value, t) {
  if (key === "ground") return colorFor(ENCOUNTER_TERRAINS[t.encounterTerrain]?.ground === value ? t.encounterTerrain : value);
  if (key === "territory" || key === "climate") return value ? layerColorFor(value, key) : null;
  if (key === "road") return value && value !== "none" ? cssTint(ROAD_TINT[value] ?? ROAD_TINT.earth) : null;
  if (key === "following") return value === "river" ? cssTint(WATER_TINT.river) : null;
  return null;
}

/**
 * The chip a reading earns: "override" where the Judge's word stands over a
 * different reading of the map, "declared" where a word — the Judge's, or an
 * older record's — stands with no reading under it, and none where the map or
 * the scene answered, or where the Judge's word says what the map says.
 */
function countryChip(provenance, value, mapValue) {
  if (provenance === "override") {
    if (mapValue == null) return "declared";
    return mapValue !== value ? "override" : null;
  }
  return provenance === "declared" ? "declared" : null;
}

/**
 * The value a paint chip arms its brush with: the card's own where that
 * layer's brush lays it, a bare ground's own table (`encounterTerrainFor`),
 * else the brush's last.
 */
function paintBrushFor(layer, key, t) {
  const values = paintableValues(layer);
  const held = key === "ground"
    ? [t.encounterTerrain, t.ground, encounterTerrainFor(t.ground)]
    : [key === "climate" ? t.weather.climate : t[key]];
  return held.find((v) => v && values.includes(v)) ?? "";
}

/**
 * The Country section's context. Each card — ground, road, following,
 * territory, and the climate the Sky section reads — carries the value
 * `travelOf` resolved, the source that answered it (`provenance`), what the
 * map alone says under it (`mapValue`), the chip their difference earns and
 * the action that retires the word behind the chip (`clearAction`).
 * `paintable` offers a Judge the brush for the card's layer where the party's
 * token stands in a hex the map has not painted on it. `judge` is set on each
 * card a Judge's seat reads, which draws the source, the chips and the brush;
 * a player's cards carry none of them. `encountersDrawOn` names the table the
 * encounter throws use: for a Judge the true position's (`trueTravelOf`), for
 * a player the believed hex's, which is all a party lost without knowing it
 * could say.
 */
function buildCountryView(formation, t, { judge = !!game.user?.isGM } = {}) {
  const { provenance, mapValues } = countryOf(formation);
  const scene = getPartyScene(formation);
  const token = getPartyToken(formation);
  const centre = judge && scene && token && isHexScene(scene) ? tokenCentre(token, scene) : null;
  const card = ({ key, label, layer }) => {
    const value = key === "climate" ? t.weather.climate : t[key];
    const mapValue = mapValues[key] ?? null;
    const paintable = !!layer && !!centre && layerValueAt(scene, centre, layer) == null;
    return {
      key,
      judge,
      label: game.i18n.localize(label),
      value,
      valueLabel: countryLabel(key, value),
      swatch: countrySwatch(key, value, t),
      provenance: provenance[key],
      provenanceLabel: game.i18n.localize(`ACKS-FORMATION.country.provenance.${provenance[key]}`),
      chip: countryChip(provenance[key], value, mapValue),
      clearAction: provenance[key] === "override" ? "clearOverride" : provenance[key] === "declared" ? "clearDeclared" : null,
      mapValue,
      mapLabel: mapValue == null ? null : countryLabel(key, mapValue),
      paintable,
      paintLayer: layer,
      paintBrush: paintable ? paintBrushFor(layer, key, t) : "",
    };
  };
  const drawn = judge ? trueTravelOf(formation) : t;
  const table = Object.hasOwn(ENCOUNTER_TERRAINS, drawn.encounterTerrain) ? drawn.encounterTerrain : encounterTerrainFor(drawn.ground);
  return {
    cards: COUNTRY_CARDS.map(card),
    climate: card({ key: "climate", label: "ACKS-FORMATION.travel.weather.climate", layer: "climate" }),
    encountersDrawOn: table ? game.i18n.localize(ENCOUNTER_TERRAINS[table].label) : null,
  };
}

/** Every climate as `<optgroup>`s by group, `current` selected. */
function climateOptionGroups(current) {
  const groups = new Map();
  for (const [code, cfg] of Object.entries(CLIMATES)) {
    if (!groups.has(cfg.group)) {
      groups.set(cfg.group, { label: game.i18n.localize(`ACKS-FORMATION.travel.weather.climateGroup.${cfg.group}`), options: [] });
    }
    groups.get(cfg.group).options.push({ value: code, label: countryLabel("climate", code), selected: code === current });
  }
  return [...groups.values()];
}

/**
 * The Judge's hand: one select per country key, holding the Judge's word on
 * it (`travel.override`) and blank where the Judge has said nothing, each
 * with whether the map reads anything under it, and what. A word no longer
 * among the options stays offered, so the select still shows it and a submit
 * cannot clear it unasked.
 */
function countryOverrideRows(formation) {
  const t = travelOf(formation);
  const { provenance, mapValues } = countryOf(formation);
  const vocab = {
    ground: Object.keys(TERRAIN),
    encounterTerrain: Object.keys(ENCOUNTER_TERRAINS),
    territory: [...TERRITORY_KEYS],
    climate: [],
    road: [...ROAD_KINDS],
    following: [...FOLLOWING_KINDS],
  };
  return COUNTRY_KEYS.map((key) => {
    const set = provenance[key] === "override";
    const current = set ? t.override[key] : "";
    const offered = key === "climate" || vocab[key].includes(current) || !set ? vocab[key] : [...vocab[key], current];
    const mapValue = mapValues[key] ?? null;
    return {
      key,
      label: game.i18n.localize(COUNTRY_KEY_LABELS[key]),
      name: `travel.override.${key}`,
      options: offered.map((value) => ({ value, label: countryLabel(key, value), selected: value === current })),
      groups: key === "climate" ? climateOptionGroups(current) : [],
      set,
      hasMap: mapValue != null,
      mapLabel: mapValue == null ? null : countryLabel(key, mapValue),
    };
  });
}

/** A modifier with its sign written out, so a positive one does not read as a bare number. */
const signedFigure = (n) => (n > 0 ? `+${n}` : `${n}`);

/**
 * One `weather-effects` readout line as the text printed after its label: a
 * signed modifier for a throw or a forage, feet for a ceiling, a multiplier for
 * a factor or a speed, the localized word for a night's rest, a percentage
 * beside its condition for a disease. A line with no figure (a frostbite
 * clause, a dust wind that states no speed) prints nothing after its label.
 */
function effectValue({ key, value, condition }) {
  const loc = (k) => game.i18n.localize(`ACKS-FORMATION.travel.weather.effects.${k}`);
  if (key.startsWith("throw.") || key.startsWith("forage.")) return signedFigure(value);
  if (key === "visibility.feet") return `${value}'`;
  if (key === "visibility.factor" || key === "airSpeed") return `×${fractionLabel(value)}`;
  if (key === "dust") return value == null ? "" : `×${fractionLabel(value)}`;
  if (key === "rest") return loc(value);
  if (key === "disease") {
    const cond = CONDITIONS[condition] ? game.i18n.localize(CONDITIONS[condition].label) : "";
    return [value == null ? "" : `${value}%`, cond ? `(${cond})` : ""].filter(Boolean).join(" ");
  }
  return value == null ? "" : String(value);
}

/**
 * The weather block's context: the climate as read (`climate`, the country
 * view's reading of it), the generator's pickers, the three band selects
 * (band keys are structural, so a Judge with nothing imported still SETS the
 * sky by hand), the derived condition chips, and the footing.
 */
function buildWeatherView(t, opt, climate = null) {
  const w = t.weather;
  const season = effectiveSeason(t);
  const unset = game.i18n.localize("ACKS-FORMATION.travel.weather.unset");
  const bands = (vocab, current) => [
    opt("", unset, !current),
    ...Object.entries(vocab).map(([value, cfg]) => opt(value, game.i18n.localize(cfg.label), value === current)),
  ];
  // A <select> cannot draw a glyph per option, so the CURRENT choice's icon
  // sits beside its control. An unset band shows none rather than a stand-in.
  const glyph = (vocab, current) => (current ? vocab[current]?.icon ?? null : null);

  const conditions = conditionsOf(w);
  const fx = weatherEffects(conditions, { terrain: t.ground });

  return {
    auto: !!w.auto,
    fronts: !!w.fronts,
    temperatureIcon: glyph(TEMPERATURE_BANDS, w.temperature),
    precipitationIcon: glyph(PRECIPITATION_KINDS, w.precipitation),
    windIcon: glyph(WIND_BANDS, w.wind),
    climate,
    seasons: SEASONS.map((s) => opt(s, game.i18n.localize(`ACKS-FORMATION.travel.weather.seasons.${s}`), s === season.season)),
    // When the calendar names the season the select only shows it: a pick the
    // calendar would override is not a pick.
    seasonFromCalendar: season.fromCalendar,
    seasonHint: season.fromCalendar
      ? game.i18n.format("ACKS-FORMATION.travel.weather.seasonFromCalendar", { name: season.calendarName })
      : "",
    temperatures: bands(TEMPERATURE_BANDS, w.temperature),
    precipitations: bands(PRECIPITATION_KINDS, w.precipitation),
    winds: bands(WIND_BANDS, w.wind),
    night: w.temperatureNight ? game.i18n.localize(TEMPERATURE_BANDS[w.temperatureNight]?.label ?? "") : "",
    // Each chip wears the icon its own condition names, so the strip reads at a
    // glance and a Judge can pick the cold out of a row of five.
    chips: conditions.map((key) => ({
      key,
      label: game.i18n.localize(CONDITIONS[key].label),
      icon: CONDITIONS[key].icon ?? null,
    })),
    // What today's sky does, one line per stated effect; the figures are the
    // imported table's, and an unimported table says so instead of an empty list.
    effects: fx.lines.map((line) => ({
      key: line.key,
      label: game.i18n.localize(`ACKS-FORMATION.travel.weather.effects.${line.key}`),
      value: effectValue(line),
    })),
    effectsUnpriced: conditions.length > 0 && !fx.ok,
    footingMud: ["none", "muddy", "frozen"].map((m) =>
      opt(m, game.i18n.localize(`ACKS-FORMATION.travel.weather.mud.${m}`), m === w.footing.mud)),
    footingSnow: !!w.footing.snow,
    ready: generatorReady(),
  };
}

/**
 * The wagons that cannot roll today: every land vehicle in the party's
 * train, asked against the ground, the road and the footing. Table
 * knowledge — a stuck wagon is not a secret.
 */
function wheelRefusals(formation, t) {
  const seen = new Set();
  const out = [];
  for (const member of formation.members) {
    if (member?.blank || !member?.actorId) continue;
    const actor = getMemberActor(member);
    if (!actor) continue;
    for (const carrier of carrierChain(actor)) {
      if (carrier.type !== VEHICLE_TYPE || seen.has(carrier.uuid)) continue;
      seen.add(carrier.uuid);
      const verdict = canEnter(carrier.system, t.ground, {
        road: t.road,
        mud: t.weather.footing?.mud ?? "none",
        snow: !!t.weather.footing?.snow,
      });
      if (!verdict.ok) {
        out.push({
          name: carrier.name,
          reason: game.i18n.localize(`ACKS-FORMATION.travel.weather.wheels.${verdict.reason}`),
        });
      }
    }
  }
  return out;
}

/** Context for the GM-only controls (light/spell pickers, tables, maps). */
export function buildGMExtras(formation) {
  const extras = {};

  extras.lightTypes = Object.entries(LIGHT_SOURCES).map(([key, cfg]) => ({
    key,
    label: game.i18n.localize(cfg.label),
    turns: cfg.turns,
  }));
  extras.bearerOptions = formation.members
    .map((m) => getMemberActor(m))
    .filter(Boolean)
    .map((a) => ({ id: a.id, name: a.name }));

  // Known spells across members, durations parsed with the caster's level.
  extras.spellOptions = [];
  for (const member of formation.members) {
    const actor = getMemberActor(member);
    const level = actor?.system?.details?.level ?? 1;
    for (const item of actor?.items ?? []) {
      if (item.type !== ITEM_TYPE.spell) continue;
      const turns = parseSpellTurns(item.system?.duration, level);
      extras.spellOptions.push({
        key: `${actor.id}|${item.id}`,
        label: `${item.name} — ${actor.name}${turns ? ` (${turns})` : ""}`,
      });
    }
  }

  extras.tables = game.tables.contents.map((t) => ({
    id: t.id,
    name: t.name,
    active: t.id === formation.tableId,
  }));

  // The Judge's word on a journey's country, over what the map reads.
  if (travelOf(formation).mode === "journey") extras.countryOverrides = countryOverrideRows(formation);

  // Maps and mapping status live in the SHARED view (buildMapsView) so
  // players see the party's maps too; only the GM context carries the
  // quality/proficiency secrets.

  return extras;
}

/* -------------------------------------------- */
/*  Player action panel context                 */
/* -------------------------------------------- */

/** Context for the player declaration panel (non-GM member owners). */
export function buildPlayerPanel(formation) {
  const owned = formation.members
    .map((m) => getMemberActor(m))
    .filter((a) => a?.testUserPermission(game.user, "OWNER"));
  const panel = {
    ownedMembers: owned.map((a) => ({ id: a.id, name: a.name })),
    playerLightTypes: Object.entries(LIGHT_SOURCES).map(([key, cfg]) => ({
      key,
      label: game.i18n.localize(cfg.label),
    })),
    playerSpells: [],
    // Trapbreaking is offered only to a seat that could actually make the
    // throw — by the skill, or by Adventuring.
    canTrapbreak: owned.some(
      (a) => resolveCheck(a, PARTY_CHECKS.trapbreakHasty) || resolveCheck(a, PARTY_CHECKS.trapbreakMethodical),
    ),
  };
  for (const actor of owned) {
    const level = actor.system?.details?.level ?? 1;
    for (const item of actor.items) {
      if (item.type !== ITEM_TYPE.spell) continue;
      const turns = parseSpellTurns(item.system?.duration, level);
      panel.playerSpells.push({
        key: `${actor.id}|${item.id}`,
        label: `${item.name} — ${actor.name}${turns ? ` (${turns})` : ""}`,
      });
    }
  }
  return panel;
}
