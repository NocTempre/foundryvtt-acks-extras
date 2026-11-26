/**
 * A seal on a door: what a cast of a spell with a seal row writes to the wall it
 * names, and what its end puts back. FOUNDRY-FREE: every world fact (who sent
 * the request, what the wall is, how far it lies) is passed in, so the checks,
 * the write and the end are plain data in and plain data out.
 *
 * The wall carries `flags["acks-extras"].sealedBy = {was, casts}`: `was` is the
 * door state the first seal found, and `casts` lists the cast ids holding the
 * seal. A seal sets the door LOCKED. A seal's end drops its cast id; once none
 * remains the stamp is cleared, and the door goes to CLOSED only where it is
 * still in the state the spell left (LOCKED) and was not locked before the
 * seal. A door a hand unlocked, opened or already had locked is left as it is.
 *
 * The caster's record carries the wall it sealed (`sealMark`), and the stamp on
 * the wall is the truth the end reads.
 */
import { MODULE_ID, FLAG_SPELL_EFFECT } from "./constants.mjs";

/** The handler on lib's sockets through which a Player's seat has the GM's client write a seal. */
export const SEAL_HANDLER = "magicSeal";

/** Key under `flags["acks-extras"]` on a wall holding its seal stamp. */
export const FLAG_SEALED_BY = "sealedBy";

/** The row type of a spell that seals a way. */
export const SEAL_ROW_TYPE = "seal";

/**
 * Why a seal request was refused, each the last segment of a lang key in the
 * seal's `refused` group. `noGm` is the asking seat's own answer where
 * no Judge is connected to carry the request out; `checkSealRequest` never gives it.
 */
export const SEAL_REFUSED = Object.freeze({
  noGm: "noGm",
  noSealRow: "noSealRow",
  notOwner: "notOwner",
  noWall: "noWall",
  notADoor: "notADoor",
  secretDoor: "secretDoor",
  otherScene: "otherScene",
  outOfRange: "outOfRange",
});

/** Core's door constants, read at the call so a host without them (a test) gets core's own numbers. */
export function doorConstants() {
  const states = globalThis.CONST?.WALL_DOOR_STATES;
  const types = globalThis.CONST?.WALL_DOOR_TYPES;
  return {
    CLOSED: states?.CLOSED ?? 0,
    OPEN: states?.OPEN ?? 1,
    LOCKED: states?.LOCKED ?? 2,
    NONE: types?.NONE ?? 0,
    DOOR: types?.DOOR ?? 1,
    SECRET: types?.SECRET ?? 2,
  };
}

/** Whether a figure was passed as a range: a blank, a non-number and a negative are none, and a none is not measured. */
export const hasRange = (rangeFeet) => rangeFeet !== null && rangeFeet !== undefined && rangeFeet !== "" && Number.isFinite(Number(rangeFeet)) && Number(rangeFeet) >= 0;

/**
 * The point of a wall nearest a point, in scene pixels. A door is reached from
 * wherever along it the caster stands, so range is measured to this point and
 * not to its midpoint.
 *
 * @param {number[]} c  the wall's `[x0, y0, x1, y1]`
 * @param {{x: number, y: number}} p
 * @returns {{x: number, y: number}|null} null for a wall with no usable coordinates
 */
export function nearestOnWall(c, p) {
  if (!Array.isArray(c) || c.length < 4 || c.slice(0, 4).some((v) => !Number.isFinite(Number(v))) || !Number.isFinite(p?.x) || !Number.isFinite(p?.y)) return null;
  const [x0, y0, x1, y1] = c.map(Number);
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  const k = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - x0) * dx + (p.y - y0) * dy) / len2));
  return { x: x0 + k * dx, y: y0 + k * dy };
}

/**
 * Whether a seal request may be carried out. The first failing check names the
 * refusal; none refused is `{ok: true}`. Every fact is read by the caller from
 * the world, never from the request: the requester is the attested sender.
 *
 * @param {object} facts
 * @param {boolean} facts.fromJudge  the request is a Judge's (`judgeDeclares`)
 * @param {boolean} facts.owns  the sender owns the caster (`testUserPermission`, never `isOwner`)
 * @param {boolean} facts.hasSealRow  the spell carries a row of type seal
 * @param {{door: number}|null} facts.wall  the wall asked for, null where it does not exist
 * @param {string} facts.sceneId  the scene the wall is on
 * @param {string[]} facts.casterSceneIds  the scenes the caster has a token on
 * @param {number|string|null} [facts.rangeFeet]  the range of the cast; blank is not measured
 * @param {number|null} [facts.gapFeet]  the measured distance from the caster token to the wall, null where it cannot be
 * @returns {{ok: true, warn?: "outOfRange"}|{ok: false, reason: string}}
 *   `warn`: a Judge's request past a stated range, or with a gap that cannot be measured, goes
 *   ahead and carries the warning; a Player's is refused `outOfRange`.
 */
export function checkSealRequest({ fromJudge, owns, hasSealRow, wall, sceneId, casterSceneIds, rangeFeet = null, gapFeet = null }) {
  const refuse = (reason) => ({ ok: false, reason });
  if (!hasSealRow) return refuse(SEAL_REFUSED.noSealRow);
  if (!fromJudge && !owns) return refuse(SEAL_REFUSED.notOwner);
  if (!wall) return refuse(SEAL_REFUSED.noWall);
  const k = doorConstants();
  const door = Number(wall.door);
  if (door !== k.DOOR && door !== k.SECRET) return refuse(SEAL_REFUSED.notADoor);
  if (door === k.SECRET && !fromJudge) return refuse(SEAL_REFUSED.secretDoor);
  if (!sceneId || !(casterSceneIds ?? []).includes(sceneId)) return refuse(SEAL_REFUSED.otherScene);
  if (hasRange(rangeFeet) && !(Number.isFinite(gapFeet) && gapFeet <= Number(rangeFeet))) {
    return fromJudge ? { ok: true, warn: SEAL_REFUSED.outOfRange } : refuse(SEAL_REFUSED.outOfRange);
  }
  return { ok: true };
}

/** The stamp a wall carries, cleaned: `{was, casts}` with at least one cast id, else null. */
export function readStamp(raw) {
  if (!raw || typeof raw !== "object") return null;
  const casts = (Array.isArray(raw.casts) ? raw.casts : Object.values(raw.casts ?? {})).map(String).filter(Boolean);
  const was = Number(raw.was);
  if (!casts.length || !Number.isFinite(was)) return null;
  return { was, casts: [...new Set(casts)] };
}

/**
 * What a seal writes to a wall: its door state LOCKED and the stamp. The first
 * seal on a door records the state it found; a second seal on a sealed door
 * appends its cast id and keeps the first `was`.
 *
 * @param {object|null} stamp  the wall's stamp as it stands
 * @param {string} castId
 * @param {number} currentDs  the wall's door state now
 * @returns {{ds: number, stamp: {was: number, casts: string[]}}}
 */
export function sealWrite(stamp, castId, currentDs) {
  const held = readStamp(stamp);
  const id = String(castId);
  const next = held ? { was: held.was, casts: held.casts.includes(id) ? held.casts : [...held.casts, id] } : { was: Number(currentDs), casts: [id] };
  return { ds: doorConstants().LOCKED, stamp: next };
}

/**
 * What the end of one cast's seal does to a wall. The cast id leaves the list;
 * while others remain the door stays as it is. Once the list is empty the
 * stamp is cleared, and the door goes to CLOSED only where it is still LOCKED
 * (the state the spell left) and was not LOCKED before the seal.
 *
 * @param {object|null} stamp  the wall's stamp as it stands
 * @param {string} castId  the cast whose seal ends
 * @param {number} currentDs  the wall's door state now
 * @returns {{noop: boolean, stamp: {was: number, casts: string[]}|null, ds: number|null}}
 *   `noop`: nothing to write. `stamp`: what remains, null to clear it. `ds`: the door state to write, null to leave it.
 */
export function sealEndPlan(stamp, castId, currentDs) {
  const held = readStamp(stamp);
  const id = String(castId);
  if (!held || !held.casts.includes(id)) return { noop: true, stamp: held, ds: null };
  const casts = held.casts.filter((c) => c !== id);
  if (casts.length) return { noop: false, stamp: { was: held.was, casts }, ds: null };
  const k = doorConstants();
  const unlock = Number(currentDs) === k.LOCKED && held.was !== k.LOCKED;
  return { noop: false, stamp: null, ds: unlock ? k.CLOSED : null };
}

/**
 * The end of several casts' seals on one wall at once, the sweep's fold of
 * `sealEndPlan`: each id is ended in turn against what the one before left.
 *
 * @param {object|null} stamp
 * @param {string[]} castIds
 * @param {number} currentDs
 * @returns {{noop: boolean, stamp: object|null, ds: number|null}}
 */
export function sealEndAll(stamp, castIds, currentDs) {
  let state = { noop: true, stamp: readStamp(stamp), ds: null };
  let ds = Number(currentDs);
  for (const id of castIds) {
    const step = sealEndPlan(state.stamp, id, ds);
    if (step.noop) continue;
    state = { noop: false, stamp: step.stamp, ds: step.ds ?? state.ds };
    if (step.ds !== null) ds = step.ds;
  }
  return state;
}

/** The cast ids on a stamp that no live record holds. */
export function orphanCasts(stamp, liveCastIds) {
  const live = new Set(liveCastIds);
  return (readStamp(stamp)?.casts ?? []).filter((id) => !live.has(id));
}

/**
 * The caster record's mark for the wall a cast sealed: `{sceneId, wallId}`,
 * or null where either is missing.
 *
 * @param {{sceneId?: string, wallId?: string}} [pick]
 */
export function sealMark(pick) {
  const { sceneId, wallId } = pick ?? {};
  return sceneId && wallId ? { sceneId: String(sceneId), wallId: String(wallId) } : null;
}

/**
 * The seal a cast record names, `{sceneId, wallId}`, or null for a record
 * that is not a caster's or names none.
 *
 * @param {object} effect  an Active Effect document or its plain data
 */
export function sealOf(effect) {
  const mark = effect?.flags?.[MODULE_ID]?.[FLAG_SPELL_EFFECT];
  if (mark?.role !== "caster") return null;
  return sealMark(mark.seal ?? {});
}
