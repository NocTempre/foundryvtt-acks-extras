/* global game, canvas, fromUuidSync */
import { isCasualty, isDead } from "./formation-model.mjs";
import {
  LIGHT_SOURCES,
  REST_INTERVAL,
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
  getPartyScene,
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
import { travelOf, DAY_KINDS, ANCILLARY_ACTIVITIES, ROAD_KINDS, TERRITORY_KEYS } from "./travel.mjs";
import { TERRAIN, travelMultiplier } from "../vehicles/vehicle-speed.mjs";
import { expeditionFrom } from "../lib/movement-scales.mjs";
import { fractionLabel } from "../lib/util.mjs";
import { collectMapItems } from "./map-items.mjs";
import { PARTY_CHECKS, resolveCheck } from "./party-rolls.mjs";
import { formatTurns, parseSpellTurns } from "./turn-engine.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/**
 * Build the display context shared by the GM formation window and the party
 * actor sheet: marching order, roles, lights, tracked spells, the turn clock,
 * and rule warnings.
 */
export function buildFormationView(formation) {
  const speed = partySpeed(formation);
  const hurried = isHurried(formation);
  const view = {
    speed,
    effSpeed: effectiveSpeed(formation),
    hurried,
    combatSpeed: Math.floor((speed / 3) * 10) / 10,
    clock: formation.clock,
    elapsed: formatTurns(formation.clock.turnsTotal),
    restMax: REST_INTERVAL,
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
      canDetach: !formation.combat?.active && !isDown(actor) && (!isMemberDeployed(member) || member.detached),
      // How far this character sees with no light at all, for the chip that
      // explains why the scout can go where the rest of the party cannot.
      darkSight: senseProfile(actor).sightRange,
      down: isDown(actor),
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
  view.travel = buildTravelView(formation, speed);

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

function buildWarnings(formation, speed) {
  const warnings = [];
  // A closed lantern sheds no light at all.
  const anyLitLight = formation.lights.some((l) => l.lit && !l.shielded);
  const mapper = formation.members.find((m) => m.roles?.includes("mapper"));
  if (formation.members.length && !mapper) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.noMapper"));
  }
  if (mapper && !anyLitLight) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.mapperNoLight"));
  }
  if (mapper && !hasAbility(getMemberActor(mapper), /mapping/i)) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.mapperNoProficiency"));
  }
  if (formation.members.length && !anyLitLight) {
    if (isPartyInDark(formation)) {
      const sighted = [];
      const blinded = [];
      for (const m of formation.members) {
        if (m?.blank || !m?.actorId) continue;
        const actor = getMemberActor(m);
        if (!actor || isDown(actor)) continue;
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
    } else {
      warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.noLight"));
    }
  }
  if (formation.clock.winded) {
    warnings.push(game.i18n.localize("ACKS-FORMATION.warnings.winded"));
  } else if (formation.clock.turnsSinceRest >= REST_INTERVAL) {
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
    };
  });
}

/**
 * The day's march, derived in the rules' order: the party's slowest UNSCALED
 * base (feet per turn), times the ground, the road and the weather — each
 * factor its own line, the door-helper idiom — times the day-kind's pace.
 * A camp day derives nothing on purpose.
 */
export function travelReadout(formation, feet) {
  const t = travelOf(formation);
  const kind = DAY_KINDS[t.day?.kind] ?? DAY_KINDS.march;
  if (!kind.travels) return { feet, camp: true, milesPerDay: 0, hexesPerDay: 0, parts: [], multiplier: 1 };
  const m = travelMultiplier({
    terrain: t.ground,
    road: t.road,
    raining: !!t.weather?.raining,
    snowing: !!t.weather?.snowing,
  });
  const e = expeditionFrom(feet, { multiplier: m.multiplier, pace: kind.pace ?? "dedicated" });
  return { feet, camp: false, multiplier: m.multiplier, parts: m.parts, ...e };
}

/**
 * The travel panel's context. Outside a journey it is only the mode flag the
 * template needs to offer "Begin journey"; inside one it is the pickers, the
 * day board, the readout, the hex trace, the GM-only lost state, and the
 * newest slice of the log.
 */
function buildTravelView(formation, feet) {
  const t = travelOf(formation);
  const isJourney = t.mode === "journey";
  const view = { isJourney, dayCount: t.dayCount, hex: t.hex.label, hexesEntered: t.day?.hexesEntered ?? 0 };
  if (!isJourney) return view;

  const opt = (value, label, selected) => ({ value, label, selected });
  view.grounds = Object.entries(TERRAIN).map(([value, cfg]) =>
    opt(value, game.i18n.localize(cfg.label), value === t.ground));
  view.roads = ROAD_KINDS.map((value) =>
    opt(value, game.i18n.localize(`ACKS-FORMATION.travel.road.${value}`), value === t.road));
  view.territories = TERRITORY_KEYS.map((value) =>
    opt(value, game.i18n.localize(`ACKS-FORMATION.travel.territory.${value}`), value === t.territory));
  view.weather = { raining: !!t.weather.raining, snowing: !!t.weather.snowing };

  view.dayKinds = Object.entries(DAY_KINDS).map(([value, cfg]) =>
    opt(value, game.i18n.localize(cfg.label), value === t.day.kind));
  view.forced = !!DAY_KINDS[t.day.kind]?.consumesAncillary;
  const activityOptions = Object.entries(ANCILLARY_ACTIVITIES).map(([value, cfg]) => ({
    value,
    label: game.i18n.localize(cfg.label),
  }));
  view.slots = (t.day.activities ?? []).map((value, index) => ({
    index,
    options: activityOptions.map((o) => ({ ...o, selected: o.value === value })),
    empty: value == null,
  }));

  const r = travelReadout(formation, feet);
  view.readout = {
    ...r,
    // A ×1 factor says nothing — except the NOTE parts (a washed-out road,
    // the tablesMissing line), whose whole point is explaining a silence.
    parts: (r.parts ?? [])
      .filter((p) => p.factor !== 1 || p.note)
      .map((p) => ({
        label: game.i18n.localize(`ACKS-VEHICLES.reason.${p.key}`),
        factor: p.note && p.factor === 1 ? null : fractionLabel(p.factor),
      })),
  };
  view.lost = { active: !!t.lost.active, judgeNote: t.lost.judgeNote ?? "" };
  view.log = t.log.slice(0, 10).map((e) => ({
    ...e,
    kindLabel: game.i18n.localize(DAY_KINDS[e.dayKind]?.label ?? DAY_KINDS.march.label),
  }));
  return view;
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
    // Trapbreaking is offered to a seat that could actually make the throw —
    // by the skill, or by Adventuring, which the book allows methodically. A
    // button that only ever answers "you have no way to work on a trap" is
    // worse than no button.
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
