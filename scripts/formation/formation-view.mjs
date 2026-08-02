/* global game, canvas, fromUuidSync */
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
  hasAbility,
  hasPoleItem,
  isDown,
  isHurried,
  isPartyInDark,
  mapperIsProficient,
  partySpeed,
} from "./formation-model.mjs";
import { collectMapItems } from "./map-items.mjs";
import { PARTY_CHECKS } from "./party-rolls.mjs";
import { formatTurns, parseSpellTurns } from "./turn-engine.mjs";

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

  const frontage = getFrontage(formation);
  view.frontage = frontage;
  view.frontageOptions = [1, 2, 3].map((value) => ({
    value,
    label: game.i18n.localize(`ACKS-FORMATION.app.frontage${value}`),
    active: value === frontage,
  }));

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
      deployed: !!member.deployedTokenId,
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
    };
  });

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

  view.checks = Object.entries(PARTY_CHECKS).map(([key, cfg]) => ({
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

  // 10' pole role without the physical implement in inventory.
  for (const m of formation.members) {
    if (!m?.roles?.includes("pole")) continue;
    const actor = getMemberActor(m);
    if (actor && !hasPoleItem(actor)) {
      warnings.push(game.i18n.format("ACKS-FORMATION.warnings.poleNoItem", { name: actor.name }));
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
      if (item.type !== "spell") continue;
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
  };
  for (const actor of owned) {
    const level = actor.system?.details?.level ?? 1;
    for (const item of actor.items) {
      if (item.type !== "spell") continue;
      const turns = parseSpellTurns(item.system?.duration, level);
      panel.playerSpells.push({
        key: `${actor.id}|${item.id}`,
        label: `${item.name} — ${actor.name}${turns ? ` (${turns})` : ""}`,
      });
    }
  }
  return panel;
}
