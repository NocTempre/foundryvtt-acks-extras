/* global game */
import { MODULE_ID } from "./constants.mjs";
import { columnFor, memberCells } from "./column.mjs";
import { columnLights } from "./column-light-logic.mjs";
import { isMemberDeployed, standsElsewhere } from "./deployment.mjs";
import {
  actorMapsProficiently,
  getMemberActor,
  getPartyScene,
  getPartyToken,
  isHurried,
  mapperMembers,
  memberCanWork,
  sceneIsDark,
} from "./formation-model.mjs";
import { formationMapping, mapperLit } from "./mapper-logic.mjs";
import { isNight } from "./settlement.mjs";
import { feetToUnits } from "../lib/distance-units.mjs";
import { brightestLightAt, effectLight, lightFigures, shedLight } from "../lib/light.mjs";
import { clockReading } from "../lib/world-time.mjs";

/**
 * The world-reading half of mapping (RR ch. 6, "Marching and Mapping"): where
 * each mapper stands, what light reaches that place, and whether they can work.
 * The verdicts are `mapper-logic.mjs`; this file gathers the facts from the
 * formation, the scene and the actors, so the fog, the measurement flag, the
 * Map item and the warnings strip all read one answer.
 *
 * A mapper's place is the point they stand on in the party's column, or the
 * centre of their own token while they stand out on the map. The light reaching
 * it is read straight-line and through no wall, as `lib/light.mjs` reads every
 * light it is asked about.
 */

/**
 * Whether the journey stands after dark: the Judge's word on the hour, else the
 * world clock. The same answer the journey makes (`journey.mjs`), which this
 * file cannot import.
 */
export function journeyIsNight(formation) {
  return isNight({ hour: formation?.travel?.hour }, { dark: clockReading()?.dark ?? null });
}

/**
 * Is the day outside bright around the party? A journey answers to the clock
 * (a scene's darkness is not its day); anything else to the scene's darkness.
 */
export function ambientBright(formation, scene) {
  if (formation?.travel?.mode === "journey") return !journeyIsNight(formation);
  return !sceneIsDark(scene);
}

/**
 * Whether mapping needs light at all: the Judge's automation switch. With it
 * off the module assumes light. A world that has not registered the setting
 * (a test) reads as on.
 */
export function mappingNeedsLight() {
  try {
    return game.settings.get(MODULE_ID, "mapperNeedsLight") !== false;
  } catch {
    return true;
  }
}

/** A token document's footprint centre in pixels. */
function tokenCentre(token, gs) {
  return { x: token.x + ((Number(token.width) || 1) * gs) / 2, y: token.y + ((Number(token.height) || 1) * gs) / 2 };
}

/** A member's effect light, feet: what their Active Effects shed. */
const effectsOf = (actorId) => effectLight(game.actors?.get?.(actorId));

/**
 * Every light the formation's own record puts on its scene, as points the
 * light reader takes (`{x, y, bright}`, bright in scene units) and whether a
 * lit, open flame has no imported reach.
 *
 * Read from the record, never from the canvas: column lights are drawn
 * client-side and only when light sync is on, so mapping must answer the same
 * with it off.
 */
function recordLights(formation, scene, at, gs) {
  const units = scene?.grid?.units;
  const points = [];
  if (at && gs > 0) {
    for (const p of columnLights(formation, at.points, effectsOf)) {
      points.push({ x: p.x, y: p.y, bright: feetToUnits(p.bright, units) });
    }
  }
  for (const member of formation.members ?? []) {
    if (!member?.actorId || member.blank || !isMemberDeployed(member) || !scene) continue;
    const token = scene.tokens?.get?.(member.deployedTokenId);
    const actor = getMemberActor(member);
    if (!token || !actor || !(gs > 0)) continue;
    const bright = shedLight(actor).bright;
    if (bright > 0) points.push({ ...tokenCentre(token, gs), bright: feetToUnits(bright, units) });
  }
  const unimportedFlame = (formation.lights ?? []).some((l) => l?.lit && !l.shielded && lightFigures(l.type).bright == null);
  return { points, unimportedFlame };
}

/**
 * Where a mapper stands, as a pixel point, or null when the record gives none
 * (no party token to lay a column from).
 */
function placeOf(formation, member, index, scene, at, gs) {
  if (isMemberDeployed(member) && scene) {
    const token = scene.tokens?.get?.(member.deployedTokenId);
    if (token) return tokenCentre(token, gs);
  }
  return at ? (memberCells(formation, at.points)[index]?.[0] ?? null) : null;
}

/**
 * With no place to measure from (no party token to lay a column from), does the
 * party carry any bright light at all? Then it lights every mapper.
 */
function partySheds(formation, points) {
  if (points.length) return true;
  return (formation.members ?? []).some((m) => m?.actorId && shedLight(getMemberActor(m)).bright > 0);
}

/**
 * The facts about each mapper in the formation, in marching order:
 * `{actorId, name, working, lit, litBy, proficient}`.
 *
 * `working` is `memberCanWork` and a mapper standing out on another scene
 * does not map this one. `litBy` is a `LIT_BY` value, null when unlit.
 *
 * @param {object} formation
 * @param {object} [opts]
 * @param {boolean} [opts.needsLight] the light requirement; read from the world's setting when omitted
 */
export function mappersOf(formation, { needsLight = mappingNeedsLight() } = {}) {
  const scene = getPartyScene(formation);
  const token = getPartyToken(formation);
  const gs = Number(scene?.grid?.size) || 0;
  const at = needsLight && token && gs > 0 ? columnFor(formation, token) : null;
  const ambient = ambientBright(formation, scene);
  const record = needsLight ? recordLights(formation, scene, at, gs) : { points: [], unimportedFlame: false };
  const placed = new Set(mapperMembers(formation));
  const out = [];
  (formation.members ?? []).forEach((member, index) => {
    if (!placed.has(member)) return;
    const actor = getMemberActor(member);
    const working = memberCanWork(member, actor) && !standsElsewhere(formation, member, scene);
    let reach = 0;
    if (needsLight && working && !ambient) {
      const place = placeOf(formation, member, index, scene, at, gs);
      if (place) reach = brightestLightAt(scene, place, { extra: record.points });
      else reach = partySheds(formation, record.points) ? 1 : 0;
    }
    const { lit, litBy } = mapperLit({ needsLight, ambient, reach, unimportedFlame: record.unimportedFlame });
    out.push({
      actorId: member.actorId,
      name: actor?.name ?? "",
      working,
      lit,
      litBy,
      proficient: actorMapsProficiently(actor),
    });
  });
  return out;
}

/**
 * Whether a formation is mapping now, and why not when it is not: the
 * `formationMapping` verdict over its mappers, with the fight and the pace.
 * `{mapping, proficient, block, mappers, working, lit}`.
 */
export function mappingOf(formation, opts = {}) {
  return formationMapping(mappersOf(formation, opts), { combat: !!formation.combat?.active, hurried: isHurried(formation) });
}
