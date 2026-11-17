/* global game, foundry, Roll, ui */
/**
 * The crossing on the table: the party's way over one obstacle or one gap, a
 * member at a time (RR ch. 6, Spelunking and Jumping and Leaping). The rules
 * are `crossing-logic.mjs`'s; this file holds the state, the roll, the card
 * and the view the party sheet's "The crossing" section draws.
 *
 * Storage is the party actor's `flags["acks-extras"].crossing`: the setup (id,
 * kind, length, depth, rope, Judge modifier, gap, run-up, precarious,
 * charging) and `members`, one record per actor id (`covered`, `throws`,
 * `state`, `last`). Only a GM client writes it. Begin replaces the whole flag
 * with a fresh id and no members; End unsets it. A setup edit writes the
 * setup keys it changes by dotted path and a throw writes its member's record
 * by dotted path, so neither can drop the other's concurrent write. A throw
 * reads the flag again after its roll and writes only while the crossing it
 * rolled for still stands; an in-flight set keyed by crossing and member
 * refuses a second throw for the same member until the first has landed.
 *
 * A jump row carries the verdict first, and an attempt (`jumpFor`) rolls the
 * distance's die against the gap: the record keeps the die's face, the
 * distance, the landing save where one was asked (core's own `rollSave`, then
 * the imported shortfall die for a failed one) and the footing that follows
 * (`jumpResult`), so a later reader of the round's movement finds the feet in
 * `members.<id>.jump.distance`. A jumper left hanging at the edge climbs up
 * through the climb rows' own throw (`climbUpRow`, `stepMember`). The Judge's
 * own landing save press (`landFor`) and footing pick (`reportLanding`) stand
 * beside it, as an override: the press writes nothing, and the pick, on a
 * member who has attempted, writes the record's `jump.footing` and state.
 *
 * A member on an obstacle holds the conditions the Spelunking grid names for it
 * (`CROSSING_STATUSES`), as held conditions (`lib/held-condition.mjs`) whose
 * holder names this crossing and the status. A throw writes them after its record
 * lands, on the member's body (`carriersOf`), and they come off when the member is
 * across or fell, when the crossing ends, when the party drops the member, and as
 * strays when a crossing begins; a jump, the climb up included, holds none. A crossing spends no time on the clock and posts
 * no damage: the card reports a fall's distance and dice and touches no hit
 * points. A player's client never writes or rolls: its press is relayed
 * (`player-requests.mjs`, kind `crossing`) and the GM client answers it with
 * `throwFor` read for a player's seat.
 */
import { MODULE_ID, FORMATION_DOC } from "./constants.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import {
  carriedLoad, encumbranceOf, getFormations, getMemberActor, getPartyActor, hasAbility, isCasualty, isStackMember, realMembers,
} from "./formation-model.mjs";
import { carriersOf } from "./mapper-kit.mjs";
import { citedSource, partText, resolveCheck } from "./party-rolls.mjs";
import { OBSTACLES, adventuringTarget, outcomeProvenance, readThrow, stretchFeet } from "./obstacles.mjs";
import { NO_ACROBATICS, fallFigures, jumpAt, jumpDistance, jumpFaces, shortfallDie } from "./jumping.mjs";
import {
  CLIMB_CHECK, CROSSING_STATUSES, FOOTINGS, FOOTING_STATE, HANGING, LANDING, SETTLED, STALLED, climbUpRow, crossingHeld, crossingOfHolder, fallFromClimb,
  fallFromDepth, heldAfter, isHanging, jumpResult, jumpRow, landingOutcome, landingRow, memberRow, stepMember, withFooting,
} from "./crossing-logic.mjs";
import { BOOK_TO_RELEASED_SAVES } from "../lib/actor-compat.mjs";
import { skipDialogKey } from "../lib/roll-dialog.mjs";
import { saveSpec } from "../lib/saves.mjs";
import { HELD_CONDITION_FLAG, heldEffects, holdCondition, releaseCondition } from "../lib/held-condition.mjs";
import { conditionNameKey } from "../lib/status-effects.mjs";
import { citeOf } from "../lib/tables.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { postToJudges } from "../lib/roll-audience.mjs";
import { makeLoc, unset } from "../lib/util.mjs";

/** The party actor's flag holding the crossing. */
export const CROSSING_FLAG = "crossing";

/** The kind a crossing takes over a gap; every other kind is a key of `OBSTACLES`. */
export const JUMP_KIND = "jump";

/** The kinds a Judge may begin, in the order the pick lists them. */
export const CROSSING_KINDS = Object.freeze([...Object.keys(OBSTACLES), JUMP_KIND]);

const loc = makeLoc("ACKS-FORMATION");

const memberPath = (actorId) => `flags.${MODULE_ID}.${CROSSING_FLAG}.members.${actorId}`;
const setupPath = (key) => `flags.${MODULE_ID}.${CROSSING_FLAG}.${key}`;

/** The throws in flight, keyed by crossing and member. */
const inFlight = new Set();

/* -------------------------------------------- */
/*  Held conditions                             */
/* -------------------------------------------- */

/** The effect's description: what the module did, read at write time so a changed language reaches the next one made. */
const describeHeld = () => loc("crossing.heldDescription");

/**
 * Make each body carry exactly `wanted` of the crossing's statuses: the ones
 * named are held, the rest of `CROSSING_STATUSES` released. Only effects this
 * crossing marked are read or written, so the same status from a spell, a hand
 * or the mapper's kit stands.
 */
async function syncHeld(bodies, crossingId, wanted) {
  for (const body of bodies) {
    for (const statusId of CROSSING_STATUSES) {
      const held = crossingHeld(crossingId, statusId);
      if (wanted.includes(statusId)) await holdCondition(body, held, { description: describeHeld() });
      else await releaseCondition(body, held);
    }
  }
}

/** The bodies of the members a crossing's record names: a member the party still holds by its own, one it dropped by the world actor of its id. */
function bodiesOfRecord(formation, ids) {
  const here = new Map(crossingMembers(formation).map((entry) => [entry.member.actorId, entry.member]));
  const bodies = new Set();
  for (const id of ids) {
    const found = here.has(id) ? carriersOf(here.get(id)) : [game.actors?.get?.(id)].filter(Boolean);
    for (const body of found) bodies.add(body);
  }
  return [...bodies];
}

/** Every actor that can carry a held condition for these formations: the world's, and the unlinked tokens on the scenes they stand on. */
function carrierPool(formations) {
  const pool = [...(game.actors ?? [])];
  for (const sceneId of new Set(formations.map((f) => f.sceneId).filter(Boolean))) {
    for (const token of game.scenes?.get?.(sceneId)?.tokens ?? []) if (!token.actorLink && token.actor) pool.push(token.actor);
  }
  return pool;
}

/**
 * Take off every crossing-held condition whose crossing no party has open: what
 * a dropped member, a flag removed by hand or a client that went away mid-throw
 * left. A crossing another party has open is spared.
 * @returns {Promise<number>} how many actors were written to
 */
async function releaseStrays() {
  const formations = Object.values(getFormations());
  const open = new Set(formations.map((f) => readCrossing(f)?.id).filter(Boolean));
  let released = 0;
  for (const actor of carrierPool(formations)) {
    let wrote = false;
    for (const effect of [...(actor.effects ?? [])]) {
      const holder = effect.getFlag?.(MODULE_ID, HELD_CONDITION_FLAG);
      const id = crossingOfHolder(holder);
      if (id && !open.has(id) && (await releaseCondition(actor, { holder }))) wrote = true;
    }
    if (wrote) released += 1;
  }
  return released;
}

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

/** The open crossing as a copy the caller may change, or null with no party actor or none open. */
export function readCrossing(formation) {
  const raw = getPartyActor(formation)?.getFlag?.(MODULE_ID, CROSSING_FLAG);
  return raw && typeof raw === "object" && raw.id ? foundry.utils.deepClone(raw) : null;
}

/**
 * Open a crossing: the flag is replaced whole, with a fresh id and no members.
 * Nothing is written for a kind that is neither an obstacle nor a jump, or
 * while one stands, or from a seat that is no GM.
 * @returns {Promise<string|null>} the new crossing's id, or null
 */
export async function beginCrossing(formation, kind) {
  const actor = getPartyActor(formation);
  if (!actor || !game.user.isGM || !CROSSING_KINDS.includes(kind) || readCrossing(formation)) return null;
  await releaseStrays();
  const setup = { id: foundry.utils.randomID(), kind, judgeMod: 0, ropeFixed: false, runUp: true, precarious: false, charging: false, members: {} };
  await actor.update({ [`flags.${MODULE_ID}.${CROSSING_FLAG}`]: foundry.data.operators.ForcedReplacement.create(setup) });
  return setup.id;
}

/**
 * Close the crossing: what it holds is released from every member its record
 * names, then the flag is unset, members and all.
 * @returns {Promise<boolean>} whether a crossing was closed
 */
export async function endCrossing(formation) {
  const actor = getPartyActor(formation);
  const crossing = readCrossing(formation);
  if (!actor || !game.user.isGM || !crossing) return false;
  await syncHeld(bodiesOfRecord(formation, Object.keys(crossing.members ?? {})), crossing.id, []);
  await actor.update({ [`flags.${MODULE_ID}.${CROSSING_FLAG}`]: unset() });
  return true;
}

/** A positive number from a field, or null for anything else. */
const positive = (value) => {
  const n = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** The setup keys a form may carry, each with how its value is read; null means unset. */
const SETUP_FIELDS = Object.freeze({
  length: positive,
  depth: positive,
  gap: positive,
  judgeMod: (v) => (Number.isFinite(Number(v)) && String(v).trim() !== "" ? Number(v) : 0),
  ropeFixed: (v) => v === true,
  runUp: (v) => v === true,
  precarious: (v) => v === true,
  charging: (v) => v === true,
});

/**
 * Write the setup fields a form carries that differ from the stored setup, each
 * by its own dotted path, so a member's step landing at the same time is not
 * overwritten. A blank number unsets its key. `members` and `id` are never
 * written here.
 * @param {object} formation
 * @param {object} form the `crossing` object of a submit
 * @returns {Promise<boolean>} whether anything was written
 */
export async function applyCrossingForm(formation, form) {
  const actor = getPartyActor(formation);
  const crossing = readCrossing(formation);
  if (!actor || !game.user.isGM || !crossing || !form) return false;
  const update = {};
  for (const [key, read] of Object.entries(SETUP_FIELDS)) {
    if (!(key in form)) continue;
    const next = read(form[key]);
    if ((crossing[key] ?? null) === next) continue;
    update[setupPath(key)] = next === null ? unset() : next;
  }
  if (!Object.keys(update).length) return false;
  await actor.update(update);
  return true;
}

/**
 * Write one member's record, only while the crossing the caller worked from
 * still stands. A record for a member the party no longer holds is unset at the
 * same write, and what the crossing held on that member is released.
 * @returns {Promise<boolean>} whether the write was made
 */
export async function writeMemberStep(formation, crossingId, actorId, step) {
  const actor = getPartyActor(formation);
  if (!actor || !game.user.isGM) return false;
  const current = readCrossing(formation);
  if (!current || current.id !== crossingId) return false;
  const update = { [memberPath(actorId)]: step };
  const held = new Set(realMembers(formation).map((m) => m.actorId));
  const dropped = Object.keys(current.members ?? {}).filter((id) => !held.has(id));
  for (const id of dropped) update[memberPath(id)] = unset();
  await actor.update(update);
  if (dropped.length) await syncHeld(bodiesOfRecord(formation, dropped), current.id, []);
  return true;
}

/** Drop the records of members the party no longer holds, and release what the crossing held on them. @returns {Promise<boolean>} whether any was dropped */
export async function pruneMembers(formation) {
  const actor = getPartyActor(formation);
  const current = readCrossing(formation);
  if (!actor || !game.user.isGM || !current) return false;
  const held = new Set(realMembers(formation).map((m) => m.actorId));
  const dropped = Object.keys(current.members ?? {}).filter((id) => !held.has(id));
  if (!dropped.length) return false;
  await actor.update(Object.fromEntries(dropped.map((id) => [memberPath(id), unset()])));
  await syncHeld(bodiesOfRecord(formation, dropped), current.id, []);
  return true;
}

/* -------------------------------------------- */
/*  Reading a member                            */
/* -------------------------------------------- */

/** Does this actor hold Climbing: by the capability an imported entry answers to, or by a hand-made ability of that name. */
export const holdsClimbing = (actor) => !!actor && (hasCapability(actor, CLIMB_CHECK.capability) || hasAbility(actor, CLIMB_CHECK.pattern));

/** Does this actor hold Acrobatics, read the same two ways. */
export const holdsAcrobatics = (actor) => !!actor && (hasCapability(actor, "kw:acrobatics") || hasAbility(actor, /acrobatics/i));

/** Why the party's own state stops a member, or null: left behind, detached or down. */
function standingOf(member, actor) {
  if (member.left) return "leftBehind";
  if (member.detached) return "detached";
  return isCasualty(actor, member) ? "down" : null;
}

/** The stone a member carries for a jump: a carrier's share included, from the party's own reading. */
function carriedBy(actor, load) {
  const carrier = load.carriers.find((c) => c.actor?.id === actor.id);
  return carrier ? carrier.effEnc : encumbranceOf(actor);
}

/** The members a crossing lists: real members with an actor, not a stack standing for several bodies. */
export function crossingMembers(formation) {
  return realMembers(formation)
    .filter((member) => !isStackMember(member))
    .map((member) => ({ member, actor: getMemberActor(member) }))
    .filter((entry) => entry.actor);
}

/**
 * One member's row for a seat: the logic's answer with the figure it was read
 * from. A seat that is a GM is the Judge; any other is its owner's or a
 * bystander's. `owns` states the seat's ownership outright where the caller
 * has established it for a user other than this client's (the GM client
 * answering a relayed throw); left null it is read from this client's user.
 */
export function rowFor(formation, crossing, { member, actor }, { judge = game.user.isGM, owns = null, load = null } = {}) {
  owns = owns ?? (judge || (actor.testUserPermission?.(game.user, "OWNER") ?? false));
  const seat = { judge, owns };
  const standing = standingOf(member, actor);
  const record = crossing.members?.[member.actorId] ?? null;
  if (crossing.kind === JUMP_KIND) {
    const level = Number(actor.system?.details?.level) || 0;
    const options = {
      dex: actor.system?.scores?.dex?.value,
      encumbrance: carriedBy(actor, load ?? carriedLoad(formation)),
      acrobatics: holdsAcrobatics(actor),
      level,
      runningStart: crossing.runUp !== false,
    };
    const gap = positive(crossing.gap);
    const row = jumpRow(gap ?? 0, { options, seat, standing, member: record });
    // What Acrobatics is worth to the save is passed in as the logic's neutral figure.
    const landing = landingRow(row, {
      precarious: !!crossing.precarious, charging: !!crossing.charging, acrobatics: options.acrobatics, saveBonus: NO_ACROBATICS.saveBonus,
    });
    const hanging = isHanging(record);
    // A jumper hanging at the edge climbs up: the member's own climb figure, on the climb rows' logic.
    const figure = hanging ? resolveCheck(actor, CLIMB_CHECK) : null;
    const holds = hanging ? holdsClimbing(actor) : false;
    const climb = hanging ? climbUpRow({ ropeFixed: !!crossing.ropeFixed, holds, figure, seat, standing, member: record }) : null;
    return { actor, member, jump: true, standing, options, gapSet: gap !== null, row, landing, record, hanging, figure, holds, climb };
  }
  const figure = resolveCheck(actor, CLIMB_CHECK);
  const holds = holdsClimbing(actor);
  const row = memberRow({
    kind: crossing.kind, ropeFixed: !!crossing.ropeFixed, feet: positive(crossing.length), holds, figure,
    judgeMod: crossing.judgeMod, seat, standing, member: record,
  });
  return { actor, member, jump: false, standing, figure, holds, row };
}

/* -------------------------------------------- */
/*  Tooltips                                    */
/* -------------------------------------------- */

/** The page every Spelunking figure names. */
const spelunkingRef = () => loc("crossing.ref.spelunking");

/** The page every jump figure names. */
const jumpingRef = () => loc("crossing.ref.jumping");

/** The imported page of a table of the formation's document, or null. */
const citeFor = (table) => citeOf(FORMATION_DOC, table);

/**
 * A member's target as a tooltip: where the figure was read from with the figure
 * it starts at, each part that moved it with the page its import cites, and the
 * Judge's modifier where one is set. `resolveCheck` itemizes only what lowered
 * the figure, so the starting figure (a ladder's rung at the member's level, or the
 * sheet's stored figure) is read back as the target plus those parts. Conditions
 * arrive as a part of the figure. The procedure's page ends the line unless a
 * part names its own.
 */
export function targetTooltip(figure, judgeMod = 0) {
  if (!figure) return spelunkingRef();
  const parts = figure.parts ?? [];
  const mod = Number(judgeMod) || 0;
  const start = Number.isFinite(figure.target) ? figure.target + parts.reduce((sum, part) => sum + part.value, 0) : null;
  const source = start === null ? figure.source : loc("crossing.tip.base", { source: figure.source, base: start });
  const line = citedSource({ source, parts }, mod ? [partText({ value: mod, label: loc("crossing.judgeMod") })] : []);
  return parts.some((part) => part.cite) ? line : [line, spelunkingRef()].join(" · ");
}

/** What a stretch count reads as, in a tooltip: the stretch and the page, or the page alone. */
function stretchTooltip(stretches) {
  const stretch = stretchFeet();
  const cite = citeFor("spelunking");
  if (stretch === null || stretches === null) return spelunkingRef();
  return [loc("crossing.tip.stretches", { stretches, stretch }), cite].filter(Boolean).join(" · ");
}

/** A jump's working as a tooltip: each part of the distance, then the page. */
function jumpTooltip(options, cleared) {
  const distance = jumpDistance(options);
  if (distance.min === null) return jumpingRef();
  const parts = distance.parts.map((part) => `${loc(`crossing.jumpPart.${part.key}`)} ${part.value}`);
  if (cleared.faces) parts.push(loc("crossing.tip.faces", { clearing: cleared.clearing, faces: cleared.faces }));
  return [...parts, citeFor("jumping") ?? jumpingRef()].join(" · ");
}

/** A fall's working as a tooltip: covered and midpoint, then the dice and their page. */
function fallTooltip(fall) {
  if (fall.feet === null) return spelunkingRef();
  const parts = fall.parts.map((part) => `${loc(`crossing.fallPart.${part.key}`)} ${part.value}`);
  const figures = fallFigures();
  const cite = citeFor("fall");
  if (figures) parts.push(loc("crossing.tip.fallDice", { count: figures.count, faces: figures.faces, feet: figures.feetPerDie }));
  return [...parts, cite].filter(Boolean).join(" · ");
}

/** The words a refusal gets on the row. A refusal for a figure nobody imported has none. */
function refusalText(refusal, actor) {
  if (!refusal || refusal.cls === "absence") return "";
  const key = `ACKS-FORMATION.crossing.refusal.${refusal.reason}`;
  return game.i18n.has(key) ? game.i18n.format(key, { name: actor.name }) : "";
}

/**
 * The words a refused player's press is told, or "" for a reason with none (an
 * absence refusal says nothing about what was not imported). The relay's own
 * keys come first, so a reason the row never words (not the owner, a member
 * whose crossing is over, a member the party no longer holds) can be said here
 * without appearing on the row.
 * @param {string} reason a refusal's reason, from the row or from `throwFor`
 * @param {object|null} actor the member
 */
export function relayRefusalWords(reason, actor) {
  const key = SETTLED.includes(reason) ? "settled" : reason;
  for (const path of [`ACKS-FORMATION.crossing.relay.${key}`, `ACKS-FORMATION.crossing.refusal.${key}`]) {
    if (game.i18n.has(path)) return game.i18n.format(path, { name: actor?.name ?? game.i18n.localize("ACKS-FORMATION.crossing.relay.unnamed") });
  }
  return "";
}

/**
 * Whether this seat may press a throw now: a crossing is open and a member this
 * seat owns has a row that allows it and a throw left, or, over a gap, an
 * attempt or a climb up to make. This is the question the player panel asks,
 * answered from the rows the section draws.
 */
export function canCross(formation) {
  const crossing = readCrossing(formation);
  if (!crossing) return false;
  if (crossing.kind === JUMP_KIND) {
    return crossingMembers(formation).some((entry) => {
      const seen = { ...entry, ...rowFor(formation, crossing, entry) };
      return attemptRefusal(seen) === null || climbRefusal(seen) === null;
    });
  }
  return crossingMembers(formation).some((entry) => {
    const { row } = rowFor(formation, crossing, entry);
    return row.can && !SETTLED.includes(row.state);
  });
}

/** A kind's label: the jump's own, or the obstacle's. */
export function kindLabel(kind) {
  return kind === JUMP_KIND ? loc("crossing.kind.jump") : game.i18n.localize(OBSTACLES[kind]?.label ?? "ACKS-FORMATION.obstacles.unknown");
}

/* -------------------------------------------- */
/*  The view                                    */
/* -------------------------------------------- */

/**
 * The Permitted cell and its tooltip. A member who holds Climbing is permitted
 * at any obstacle the row resolves (`memberRow` plans a holder as permitted
 * whatever the table says), so the cell reads the permitted word and the tip
 * names the proficiency; the table's cell is not read for them. Anyone else
 * reads the Adventuring column: blank while it is not imported, with the page
 * reference alone as the tip.
 * @param {boolean} holds the member holds Climbing
 * @param {number|false|null} adventuring `adventuringTarget` for the row's kind
 * @param {string|null} effective the kind the row resolved to, null for an unknown kind
 * @param {string} kind the crossing's kind
 * @returns {{permitted: string, permittedTip: string}}
 */
function permittedCell(holds, adventuring, effective, kind) {
  const cite = citeFor("spelunking") || spelunkingRef();
  if (holds) {
    if (effective === null) return { permitted: "", permittedTip: spelunkingRef() };
    return {
      permitted: loc("crossing.permitted"),
      permittedTip: [loc("crossing.tip.permittedHolder", { kind: kindLabel(effective), holds: loc("crossing.holds") }), cite].join(" · "),
    };
  }
  if (adventuring === null) return { permitted: "", permittedTip: spelunkingRef() };
  return {
    permitted: loc(adventuring === false ? "crossing.refused" : "crossing.permitted"),
    permittedTip: [loc("crossing.tip.permitted", { kind: kindLabel(effective ?? kind) }), citeFor("spelunking")].filter(Boolean).join(" · "),
  };
}

/**
 * The chips of the conditions this crossing holds on a member, read off the
 * member's body and not recomputed from the table, so a chip stands only while
 * the effect does. A member who is across or fell shows none. Each carries the
 * condition's own name and a tooltip saying this crossing holds it, with the
 * page the figure is imported from.
 */
function heldChips(crossing, entry, settled) {
  if (settled) return [];
  const bodies = carriersOf(entry.member);
  return CROSSING_STATUSES
    .filter((statusId) => bodies.some((body) => heldEffects(body, crossingHeld(crossing.id, statusId)).length))
    .map((statusId) => {
      const label = game.i18n.localize(conditionNameKey(statusId));
      return { statusId, label, tip: [loc("crossing.tip.held", { condition: label }), citeFor("spelunking") ?? spelunkingRef()].join(" · ") };
    });
}

/** One obstacle row for the template. */
function obstacleRowView(crossing, entry) {
  const { actor, row, figure } = entry;
  const record = crossing.members?.[entry.member.actorId] ?? null;
  const target = Number.isFinite(row.target) ? row.target : null;
  const permitted = adventuringTarget(row.effective ?? crossing.kind);
  const settled = SETTLED.includes(row.state);
  const fall = row.state === "fell"
    ? fallFromClimb({ kind: row.effective ?? crossing.kind, covered: row.covered, feet: positive(crossing.length), depth: crossing.depth })
    : null;
  const last = record?.last ?? null;
  const said = refusalText(row.refusal, actor);
  return {
    actorId: entry.member.actorId,
    name: actor.name,
    state: row.state,
    stateLabel: loc(`crossing.state.${row.state}`),
    settled,
    stalled: row.state === STALLED,
    target: target === null ? "" : `${target}+`,
    targetTip: target === null ? spelunkingRef() : targetTooltip(figure, row.judgeMod),
    holds: entry.holds,
    holdsLabel: entry.holds ? loc("crossing.holds") : "",
    ...permittedCell(entry.holds, permitted, row.effective, crossing.kind),
    covered: row.stretches === null ? "" : `${row.covered} / ${row.stretches}`,
    coveredTip: stretchTooltip(row.stretches),
    held: heldChips(crossing, entry, settled),
    throws: row.throws,
    can: row.can && !settled,
    warn: row.warn,
    blocked: !row.can && !!said,
    said,
    last: last && last.total != null
      ? {
        total: last.total,
        natural: last.natural,
        tip: loc("crossing.tip.lastThrow", { natural: last.natural, total: last.total }),
        outcome: last.outcome ?? "",
        outcomeTip: last.outcome ? outcomeProvenance({ text: last.outcome }) : "",
        success: last.success === true,
      }
      : null,
    fall: fall
      ? {
        feet: fall.feet,
        damage: fall.damage ?? "",
        tip: fallTooltip(fall),
        text: fall.feet === null ? "" : loc(fall.damage ? "crossing.fell" : "crossing.fellNoDice", { feet: fall.feet, damage: fall.damage ?? "" }),
      }
      : null,
  };
}

/** The system's key for the save a landing asks for. */
const saveKeyOf = (landing) => BOOK_TO_RELEASED_SAVES[landing.save] ?? landing.save;

/** The save's name as the system words it, or the crossing's own words for it. */
function saveName(landing) {
  const key = `ACKS.saves.${saveKeyOf(landing)}.long`;
  return game.i18n.has(key) ? game.i18n.localize(key) : loc("crossing.landing.label");
}

/** A landing save's working as a tooltip: its name, a bonus where one is held, then the page. */
function landingTooltip(landing) {
  const parts = [saveName(landing)];
  if (landing.bonus) parts.push(loc("crossing.tip.landingBonus", { bonus: landing.bonus }));
  return [...parts, citeFor("jumping") ?? jumpingRef()].join(" · ");
}

/**
 * The landing's part of a jump row: null where the landing asks for no throw.
 * A Judge's row carries the press and the footing pick; any other seat reads
 * that a save is asked for, with its working in the tooltip.
 */
function landingView(entry) {
  const { landing, actor } = entry;
  if (!landing.needed) return null;
  const isGM = game.user.isGM;
  return {
    label: saveName(landing),
    tip: landingTooltip(landing),
    ref: jumpingRef(),
    canRoll: isGM && landing.can,
    warn: landing.warn,
    rollLabel: loc(landing.warn ? "crossing.landing.rollAnyway" : "crossing.landing.roll"),
    rollAria: loc("crossing.landing.rollFor", { name: actor.name }),
    canReport: isGM,
    failedAria: loc("crossing.landing.failedFor", { name: actor.name }),
    footings: FOOTINGS.map((value) => ({ value, label: loc(`crossing.footing.${value}`) })),
  };
}

/**
 * Why an attempt cannot be made for this member now, or null. The row's own
 * refusal comes first, an absence reading as `absence` so the words a throw's
 * refusal carries are never borrowed for it; then what the attempt needs
 * beyond the row: a gap, and, where the landing asks for a save, the member's
 * save cell and the imported shortfall die its failure is rolled on.
 */
function attemptRefusal(seen) {
  if (!seen.row.can) return seen.row.refusal?.cls === "absence" ? "absence" : seen.row.refusal?.reason ?? "member";
  if (!seen.gapSet) return "noGap";
  if (seen.landing.needed) {
    if (seen.actor.system?.saves?.[saveKeyOf(seen.landing)]?.value == null) return "noCell";
    if (shortfallDie() === null) return "absence";
  }
  return null;
}

/** Why a hanging jumper's climb up cannot be thrown now, or null; `stale` where the member is not hanging. */
function climbRefusal(seen) {
  if (!seen.hanging) return "stale";
  const row = seen.climb;
  return row.can && row.plan ? null : row.refusal?.reason ?? "member";
}

/**
 * Why this client's seat cannot press `step` ("attempt" or "climbUp") for a
 * member of an open jump now, or null: the refusal `jumpFor` would give, read
 * for the seat the row is read for. A relayed press is checked here first so
 * one that cannot succeed is never sent.
 */
export function jumpPressRefusal(formation, crossing, entry, step) {
  if (step !== "attempt" && step !== "climbUp") return "stale";
  const seen = { ...entry, ...rowFor(formation, crossing, entry) };
  return step === "climbUp" ? climbRefusal(seen) : attemptRefusal(seen);
}

/** The rolled distance as a tooltip: the die's face, each part of the distance, then the page. */
function rolledTooltip(options, face) {
  const distance = jumpDistance(options);
  const parts = distance.parts.map((part) => `${loc(`crossing.jumpPart.${part.key}`)} ${part.value}`);
  return [loc("crossing.tip.face", { face }), ...parts, citeFor("jumping") ?? jumpingRef()].join(" · ");
}

/** The gap as a tooltip: the Judge's figure and the page. */
function gapTooltip() {
  return [loc("crossing.tip.judgeSet"), citeFor("jumping") ?? jumpingRef()].join(" · ");
}

/** The fall a failed jump reports, in the shape `fallTooltip` reads, or null where the jumper does not fall. */
function jumpFall(result) {
  if (result?.footing !== "empty") return null;
  return { feet: result.feet, damage: result.damage, parts: result.feet === null ? [] : [{ key: "depth", value: result.feet }] };
}

/** The words of a fall's distance and dice, on the card (hit points said to stand) or on the row; unknown where the depth is blank. */
function fallWords(fall, onCard) {
  if (fall.feet === null) return loc(onCard ? "crossing.card.fallUnknown" : "crossing.fellUnknown");
  const key = onCard ? (fall.damage ? "crossing.card.fall" : "crossing.card.fallNoDice") : (fall.damage ? "crossing.fell" : "crossing.fellNoDice");
  return loc(key, { feet: fall.feet, damage: fall.damage ?? "" });
}

/**
 * What an attempt left on the row: the rolled distance, the save, the slip and
 * the footing. Null before an attempt. The footing the record holds is read
 * over the one the attempt reached, so a Judge's pick shows as made.
 */
function resultView(crossing, entry) {
  const jump = entry.record?.jump;
  if (!jump) return null;
  const reached = jumpResult({
    gap: jump.gap, distance: jump.distance, save: jump.save ? { passed: jump.save.passed === true } : null, slip: jump.slip ?? null, depth: crossing.depth,
  });
  if (!reached) return null;
  const overridden = FOOTINGS.includes(jump.footing) && jump.footing !== reached.footing;
  const result = overridden ? withFooting(reached, jump.footing, crossing.depth) : reached;
  const fall = jumpFall(result);
  const cite = citeFor("jumping") ?? jumpingRef();
  const slipped = result.slip !== null;
  return {
    rolled: loc("crossing.result.rolled", { distance: result.distance }),
    rolledTip: rolledTooltip(entry.options, jump.face),
    clears: result.clears,
    clearsLabel: loc(result.clears ? "crossing.result.clears" : "crossing.result.short"),
    save: jump.save
      ? {
        text: loc("crossing.result.save", { total: jump.save.total, target: jump.save.target ?? "" }),
        passed: jump.save.passed === true,
        label: loc(jump.save.passed === true ? "crossing.result.saved" : "crossing.result.failed"),
        tip: landingTooltip(entry.landing),
      }
      : null,
    pending: entry.record.state === LANDING,
    footing: !result.clears || slipped || overridden
      ? {
        text: result.clears && !slipped
          ? loc("crossing.result.override")
          : loc(slipped ? "crossing.result.slip" : "crossing.result.shortBy", { feet: slipped ? result.slip : result.shortBy }),
        outcome: result.outcome ? loc(`crossing.landing.outcome.${result.outcome}`) : "",
        footing: result.footing ? loc(`crossing.footing.${result.footing}`) : "",
        tip: [
          loc("crossing.tip.footingParts", { distance: result.distance, gap: result.gap, slip: result.slip ?? 0 }),
          ...(overridden ? [loc("crossing.tip.judgeSet")] : []),
          cite,
        ].join(" · "),
        fall: fall ? { text: fallWords(fall, false), tip: fallTooltip(fall) } : null,
      }
      : null,
  };
}

/** The climb up a hanging jumper has to make: the press, the member's own figure and the reason where it is blocked. */
function climbView(entry) {
  if (!entry.hanging || !entry.climb) return null;
  const { climb, actor, figure } = entry;
  const target = Number.isFinite(climb.target) ? climb.target : null;
  const said = refusalText(climb.refusal, actor);
  return {
    can: climbRefusal(entry) === null,
    warn: climb.warn,
    label: loc(climb.warn ? "crossing.climbUp.anyway" : "crossing.climbUp.press"),
    aria: loc("crossing.climbUp.for", { name: actor.name }),
    target: target === null ? "" : `${target}+`,
    targetTip: target === null ? spelunkingRef() : targetTooltip(figure, 0),
    said,
    blocked: !climb.can && !!said,
  };
}

/** The attempt's press for a row: its label, and whether this seat is offered it. */
function attemptView(entry) {
  const refusal = attemptRefusal(entry);
  const resume = entry.record?.state === LANDING;
  return {
    can: refusal === null,
    warn: refusal === null && entry.row.warn,
    label: loc(resume ? "crossing.attempt.resume" : entry.row.warn ? "crossing.attempt.anyway" : "crossing.attempt.press"),
    aria: loc(resume ? "crossing.attempt.resumeFor" : "crossing.attempt.for", { name: entry.actor.name }),
  };
}

/** One jump row for the template. */
function jumpRowView(crossing, entry) {
  const { actor, row, options } = entry;
  const said = refusalText(row.refusal, actor);
  const range = row.min === null ? "" : `${row.min}–${row.max}`;
  const state = entry.record?.state ?? "";
  const attempted = !!entry.record?.jump;
  const landing = landingView(entry);
  if (landing && attempted) landing.canRoll = false;
  return {
    landing,
    attempt: attemptView(entry),
    result: resultView(crossing, entry),
    climb: climbView(entry),
    state,
    stateLabel: state && game.i18n.has(`ACKS-FORMATION.crossing.state.${state}`) ? loc(`crossing.state.${state}`) : "",
    actorId: entry.member.actorId,
    name: actor.name,
    verdict: entry.gapSet ? row.verdict : "",
    verdictLabel: entry.gapSet && row.verdict !== "unknown" ? loc(`crossing.verdict.${row.verdict}`) : "",
    verdictTip: entry.gapSet && row.verdict !== "unknown" ? jumpTooltip(options, row) : jumpingRef(),
    range,
    holdsAcrobatics: options.acrobatics,
    blocked: !!said && !row.can,
    warn: row.warn,
    said,
  };
}

/**
 * The context of "The crossing" on the Dungeon tab. A Judge always gets a begin
 * row; every seat gets the member rows while a crossing is open, and a Judge
 * also the setup fields. A player gets nothing while none is open (null).
 *
 * Every figure is the logic's answer on what the tables hold: a figure nobody
 * imported is blank, with the page reference alone in its tooltip, and never
 * stands in for another figure.
 */
export function buildCrossingView(formation) {
  const isGM = game.user.isGM;
  const crossing = readCrossing(formation);
  if (!crossing && !isGM) return null;
  const view = {
    isGM,
    open: !!crossing,
    kinds: CROSSING_KINDS.map((value) => ({ value, label: kindLabel(value) })),
    refs: { spelunking: spelunkingRef(), jumping: jumpingRef() },
  };
  if (!crossing) return view;
  const jump = crossing.kind === JUMP_KIND;
  view.id = crossing.id;
  view.kind = crossing.kind;
  view.kindLabel = kindLabel(crossing.kind);
  view.jump = jump;
  view.setup = {
    length: crossing.length ?? "",
    depth: crossing.depth ?? "",
    gap: crossing.gap ?? "",
    judgeMod: crossing.judgeMod ?? 0,
    ropeFixed: !!crossing.ropeFixed,
    runUp: crossing.runUp !== false,
    precarious: !!crossing.precarious,
    charging: !!crossing.charging,
  };
  const load = jump ? carriedLoad(formation) : null;
  const entries = crossingMembers(formation).map((entry) => ({ ...entry, ...rowFor(formation, crossing, entry, { load }) }));
  view.rows = entries.map((entry) => (jump ? jumpRowView(crossing, entry) : obstacleRowView(crossing, entry)));
  view.canThrowAll = isGM && !jump && entries.some((entry) => entry.row.can && !entry.row.warn && !SETTLED.includes(entry.row.state));
  return view;
}

/* -------------------------------------------- */
/*  Throwing                                    */
/* -------------------------------------------- */

/** The card for one throw, from what `readThrow`, `stepMember` and `fallFromClimb` answered. */
function throwCard({ crossing, entry, plan, read, roll, natural, stepped, fall, title = "" }) {
  const { actor, row, figure } = entry;
  const target = Number.isFinite(plan.target) ? plan.target : null;
  const foot = [];
  if (plan.overRefusal) {
    foot.push(loc("crossing.card.overRefusal", { reason: refusalText(row.refusal, actor) || loc("crossing.card.overRefusalBare") }));
  }
  if (row.stretches !== null && row.stretches > 1 && stepped.state !== "across") {
    foot.push(loc("crossing.card.covered", { covered: stepped.covered, stretches: row.stretches }));
  }
  if (fall) {
    foot.push(fall.feet === null
      ? loc("crossing.card.fallUnknown")
      : loc(fall.damage ? "crossing.card.fall" : "crossing.card.fallNoDice", { feet: fall.feet, damage: fall.damage ?? "" }));
  }
  const missed = !read.success && read.outcome?.text;
  return renderRollCard({
    title: title || loc("crossing.card.title", { kind: kindLabel(row.effective ?? crossing.kind) }),
    subtitle: actor.name,
    note: missed ? read.outcome.text : "",
    noteTooltip: missed ? outcomeProvenance(read.outcome) : "",
    sections: [{
      rows: [{
        name: actor.name,
        total: roll.total,
        target: target ?? undefined,
        targetTooltip: target === null ? "" : targetTooltip(figure, row.judgeMod),
        detail: read.botch ? loc("crossing.card.botch", { natural }) : "",
        outcome: loc(`crossing.state.${stepped.state}`),
        emphasis: read.success ? "success" : "failure",
      }],
    }],
    footnote: foot.join(" · "),
  });
}

/**
 * Throw one stretch for one member, from a GM client: the Judge's own press or
 * the executing client of a relayed one. The row is read for a Judge's seat, so
 * a permission refusal goes ahead and is marked on the card, and an absence
 * refusal rolls nothing. The record is written after the roll, only while the
 * crossing still stands, and the card goes to the Judges.
 *
 * A player's throw is the same throw read for a player's seat, over a member
 * the caller has already established the player owns: the row is read with
 * `owns` true and `judge` false, so a permission refusal blocks where it would
 * only warn a Judge. `crossingId` is the crossing the requester saw; a throw
 * for any other is refused as `stale`. `beforeRoll` runs once every check has
 * passed and the member's in-flight key is held, so a declaration it posts is
 * made only for a throw that goes ahead and a second request for the member is
 * refused as `busy` before it declares.
 *
 * @param {object} formation
 * @param {string} actorId the member's actor id
 * @param {object} [o]
 * @param {boolean} [o.player] read the row for a player's seat
 * @param {string|null} [o.crossingId] the crossing id the requester held; null skips the check
 * @param {Function|null} [o.beforeRoll] awaited after the checks, before the die
 * @returns {Promise<{ok: boolean, refused?: string, message?: object, step?: string}>}
 *   `refused` names why nothing was thrown: `notGM`, `closed`, `member`, `jump`,
 *   `busy`, `stale` or the row's refusal reason; a refusal that went ahead is no refusal
 */
export async function throwFor(formation, actorId, { player = false, crossingId = null, beforeRoll = null } = {}) {
  if (!game.user.isGM) return { ok: false, refused: "notGM" };
  const crossing = readCrossing(formation);
  if (!crossing) return { ok: false, refused: "closed" };
  if (crossingId !== null && crossingId !== crossing.id) return { ok: false, refused: "stale" };
  const entry = crossingMembers(formation).find((e) => e.member.actorId === actorId);
  if (!entry) {
    await pruneMembers(formation);
    return { ok: false, refused: "member" };
  }
  if (crossing.kind === JUMP_KIND) return { ok: false, refused: JUMP_KIND };
  const seen = { ...entry, ...rowFor(formation, crossing, entry, player ? { judge: false, owns: true } : { judge: true }) };
  const { row } = seen;
  if (!row.can || !row.plan) return { ok: false, refused: row.refusal?.reason ?? "member" };
  const key = `${crossing.id}:${actorId}`;
  if (inFlight.has(key)) return { ok: false, refused: "busy" };
  if (row.plan.overRefusal) {
    ui.notifications.warn(refusalText(row.refusal, seen.actor) || loc("crossing.card.overRefusalBare"));
  }
  inFlight.add(key);
  try {
    await beforeRoll?.();
    const record = crossing.members?.[actorId] ?? null;
    return await rollStretch(formation, crossing, seen, {
      record,
      fallOf: () => fallFromClimb({ kind: row.effective, covered: record?.covered ?? 0, feet: positive(crossing.length), depth: crossing.depth }),
    });
  } finally {
    inFlight.delete(key);
  }
}

/**
 * One stretch thrown for one member, the roll and everything after it: the
 * natural die read against the row's plan, where the throw leaves the member
 * (`stepMember`), the record written while the crossing still stands, the
 * conditions held or released, and the card to the Judges. The caller has made
 * every check and holds the member's in-flight key.
 *
 * @param {object} formation
 * @param {object} crossing the open crossing as read before the roll
 * @param {object} seen the member's entry with its row, read for the pressing seat
 * @param {object} o
 * @param {object|null} o.record the member's record the step starts from
 * @param {Function} o.fallOf the fall a failed step reports, read only when the member fell
 * @param {object} [o.row] the row thrown; the entry's own by default
 * @param {string} [o.title] the card's title, in place of the obstacle's
 * @param {boolean} [o.hold] hold the grid's conditions on a member still on the obstacle; false touches none
 * @returns {Promise<{ok: boolean, refused?: string, message?: object, step?: string, fall?: object|null}>}
 */
async function rollStretch(formation, crossing, seen, { record, fallOf, row = seen.row, title = "", hold = true }) {
  const actorId = seen.member.actorId;
  const roll = await new Roll("1d20").evaluate();
  const natural = roll.dice?.[0]?.results?.[0]?.result ?? roll.dice?.[0]?.total ?? roll.total;
  const read = readThrow({ plan: row.plan, natural, total: roll.total });
  const stepped = stepMember({ member: record, stretches: row.stretches, read, natural, total: roll.total });
  const fall = stepped.state === "fell" ? fallOf() : null;
  if (!(await writeMemberStep(formation, crossing.id, actorId, stepped))) return { ok: false, refused: "stale" };
  if (hold) {
    const wanted = heldAfter({ state: stepped.state, vulnerable: read.vulnerable });
    const bodies = carriersOf(seen.member);
    await syncHeld(bodies, crossing.id, wanted);
    // An End that landed between the record's write and the hold released nothing, so what was just held goes too.
    if (wanted.length && readCrossing(formation)?.id !== crossing.id) await syncHeld(bodies, crossing.id, []);
  }
  const message = await postToJudges({
    content: throwCard({ crossing, entry: { ...seen, row }, plan: row.plan, read, roll, natural, stepped, fall, title }),
    speaker: { alias: formation.name },
    rolls: [roll],
  });
  return { ok: true, message, step: stepped.state, fall };
}

/**
 * Throw a stretch for every member whose row allows it with no warning, one
 * after another. A member who is across, fell, stalled, refused or warned is
 * left for the Judge to press.
 * @returns {Promise<{thrown: number, left: number, messages: object[]}>}
 */
export async function throwAll(formation) {
  const crossing = readCrossing(formation);
  const out = { thrown: 0, left: 0, messages: [] };
  if (!crossing || crossing.kind === JUMP_KIND || !game.user.isGM) return out;
  for (const entry of crossingMembers(formation)) {
    const { row } = rowFor(formation, crossing, entry, { judge: true });
    if (!row.can || row.warn || SETTLED.includes(row.state)) {
      out.left++;
      continue;
    }
    const result = await throwFor(formation, entry.member.actorId);
    if (result.ok) {
      out.thrown++;
      out.messages.push(result.message);
    } else out.left++;
  }
  return out;
}

/* -------------------------------------------- */
/*  The landing                                 */
/* -------------------------------------------- */

/** The open crossing, a jump, and the member's entry with its row read for a Judge; or the reason there is none. */
function landingEntry(formation, actorId) {
  if (!game.user.isGM) return { refused: "notGM" };
  const crossing = readCrossing(formation);
  if (!crossing) return { refused: "closed" };
  if (crossing.kind !== JUMP_KIND) return { refused: "notJump" };
  const entry = crossingMembers(formation).find((e) => e.member.actorId === actorId);
  if (!entry) return { refused: "member" };
  return { crossing, seen: { ...entry, ...rowFor(formation, crossing, entry, { judge: true }) } };
}

/**
 * Roll one member's landing save, from a GM client: the system's own `rollSave`
 * on the member, whose dialog and card are the system's. The row is read for a
 * Judge, so an unreachable gap or a member who is down warns and goes ahead,
 * and a jump nobody imported the figures for rolls nothing. Nothing is written
 * to the flag. The save's bonus is not an argument of the system's roll; a
 * situational bonus is the dialog's field. A card to the Judges records the
 * total.
 *
 * @param {object} formation
 * @param {string} actorId the member's actor id
 * @param {object} [o]
 * @param {Event|null} [o.event] the press, so the system's skip-dialog key reads from it
 * @returns {Promise<{ok: boolean, refused?: string, message?: object, total?: number}>}
 *   `refused` is `notGM`, `closed`, `notJump`, `member`, `noSave`, `noCell`, `busy`, `cancelled`,
 *   `absence` (a figure was never imported) or the row's refusal reason
 */
export async function landFor(formation, actorId, { event = null } = {}) {
  const { crossing, seen, refused } = landingEntry(formation, actorId);
  if (refused) return { ok: false, refused };
  if (!seen.landing.needed) return { ok: false, refused: "noSave" };
  if (!seen.landing.can) return { ok: false, refused: seen.row.refusal?.cls === "absence" ? "absence" : seen.row.refusal?.reason ?? "member" };
  // The system's roll reads the save's cell unguarded and throws where a member has none.
  if (seen.actor.system?.saves?.[saveKeyOf(seen.landing)]?.value == null) return { ok: false, refused: "noCell" };
  const key = `${crossing.id}:${actorId}:landing`;
  if (inFlight.has(key)) return { ok: false, refused: "busy" };
  if (seen.landing.warn) ui.notifications.warn(refusalText(seen.row.refusal, seen.actor) || loc("crossing.card.overRefusalBare"));
  inFlight.add(key);
  try {
    const roll = await seen.actor.rollSave(saveKeyOf(seen.landing), { event });
    if (!roll) return { ok: false, refused: "cancelled" };
    const foot = [];
    if (seen.landing.warn) foot.push(loc("crossing.card.overRefusal", { reason: refusalText(seen.row.refusal, seen.actor) || loc("crossing.card.overRefusalBare") }));
    const message = await postToJudges({
      content: renderRollCard({
        title: loc("crossing.card.landingTitle"),
        subtitle: seen.actor.name,
        sections: [{ rows: [{ name: seen.actor.name, total: roll.total, detail: saveName(seen.landing), tooltipText: landingTooltip(seen.landing) }] }],
        footnote: foot.join(" · "),
      }),
      speaker: { alias: formation.name },
    });
    return { ok: true, message, total: roll.total };
  } finally {
    inFlight.delete(key);
  }
}

/**
 * Report a failed landing on the footing the Judge picked, from a GM client:
 * `landingOutcome`'s answer on a card to the Judges. A fall's distance is the
 * setup's depth. No hit point, condition or position changes. Where the member
 * has made an attempt the pick is the Judge's override of its footing, and the
 * record takes it: `jump.footing` and the state the footing implies, so the
 * row, the climb up and the state follow it. A member with no attempt has no
 * record, and the pick is reported alone.
 *
 * @param {object} formation
 * @param {string} actorId the member's actor id
 * @param {string} footing one of `FOOTINGS`
 * @returns {Promise<{ok: boolean, refused?: string, message?: object, outcome?: object, step?: string}>}
 *   `refused` is `notGM`, `closed`, `notJump`, `member`, `footing`, `busy` or `stale`; `step` is the state
 *   the record was written to, absent where nothing was written
 */
export async function reportLanding(formation, actorId, footing) {
  const { crossing, seen, refused } = landingEntry(formation, actorId);
  if (refused) return { ok: false, refused };
  const outcome = landingOutcome({ footing, depth: crossing.depth });
  if (!outcome) return { ok: false, refused: "footing" };
  const key = `${crossing.id}:${actorId}`;
  if (inFlight.has(key)) return { ok: false, refused: "busy" };
  inFlight.add(key);
  try {
    const record = crossing.members?.[actorId];
    let step;
    if (record?.jump) {
      step = FOOTING_STATE[footing];
      const written = await writeMemberStep(formation, crossing.id, actorId, {
        state: step, covered: 0, throws: record.throws ?? 0, jump: { ...record.jump, footing },
      });
      if (!written) return { ok: false, refused: "stale" };
    }
    return { ...(await postLanding(formation, seen, outcome)), ...(step ? { step } : {}) };
  } finally {
    inFlight.delete(key);
  }
}

/** The card a reported landing posts to the Judges; the result of `reportLanding` less what it wrote. */
async function postLanding(formation, seen, outcome) {
  const foot = [];
  if (outcome.shortBy) foot.push(loc("crossing.card.landingShort", { die: outcome.shortBy }));
  if (outcome.outcome === "fall") {
    foot.push(outcome.feet === null
      ? loc("crossing.card.fallUnknown")
      : loc(outcome.damage ? "crossing.card.fall" : "crossing.card.fallNoDice", { feet: outcome.feet, damage: outcome.damage ?? "" }));
  }
  const message = await postToJudges({
    content: renderRollCard({
      title: loc("crossing.card.landingFailed"),
      subtitle: seen.actor.name,
      note: citeFor("jumping") ?? jumpingRef(),
      sections: [{ rows: [{ name: seen.actor.name, total: "", outcome: loc(`crossing.landing.outcome.${outcome.outcome}`) }] }],
      footnote: foot.join(" · "),
    }),
    speaker: { alias: formation.name },
  });
  return { ok: true, message, outcome };
}

/* -------------------------------------------- */
/*  The jump attempt and the climb up           */
/* -------------------------------------------- */

/**
 * The event a landing save is rolled with. A relayed player's press has no
 * event of its own on the GM client, and the system's dialog would open there
 * for a save nobody at that seat is making, so it carries the system's own
 * skip-dialog key where the setting names one.
 */
function saveEvent(event, player) {
  if (!player) return event;
  const key = skipDialogKey();
  return typeof key === "string" && key ? { [key]: true } : event;
}

/** The card for a jump attempt: the distance against the gap, the landing save where one was rolled, and where the jumper stands. */
function jumpCard({ seen, result, face, save, over }) {
  const { actor } = seen;
  const rows = [{
    name: actor.name,
    total: result.distance,
    tooltipText: rolledTooltip(seen.options, face),
    target: result.gap,
    targetTooltip: gapTooltip(),
    targetSuffix: " ft",
    detail: loc("crossing.card.jumpDetail", { face }),
    outcome: loc(result.clears ? "crossing.result.clears" : "crossing.result.short"),
    emphasis: result.clears ? "success" : "failure",
  }];
  if (save) {
    rows.push({
      name: actor.name,
      total: save.total,
      target: save.target ?? undefined,
      targetTooltip: landingTooltip(seen.landing),
      detail: saveName(seen.landing),
      outcome: loc(save.passed ? "crossing.result.saved" : "crossing.result.failed"),
      emphasis: save.passed ? "success" : "failure",
    });
  }
  const foot = [];
  if (over) foot.push(loc("crossing.card.overRefusal", { reason: refusalText(seen.row.refusal, actor) || loc("crossing.card.overRefusalBare") }));
  if (result.footing) {
    foot.push(loc(result.slip !== null ? "crossing.result.slip" : "crossing.result.shortBy", { feet: result.slip !== null ? result.slip : result.shortBy }));
    foot.push(`${loc(`crossing.footing.${result.footing}`)}: ${loc(`crossing.landing.outcome.${result.outcome}`)}`);
    const fall = jumpFall(result);
    if (fall) foot.push(fallWords(fall, true));
  }
  if (result.unknown.includes("shortfallDie")) foot.push(loc("crossing.card.slipUnknown"));
  return renderRollCard({
    title: loc("crossing.card.jumpTitle"),
    subtitle: actor.name,
    note: citeFor("jumping") ?? jumpingRef(),
    sections: [{ rows }],
    footnote: foot.join(" · "),
  });
}

/**
 * Roll a member's jump, the attempt at the gap: the distance's die, the
 * distance it gives against the gap, and, where the landing asks for a save and
 * the jump reaches, core's own save and, for a failed one, the imported
 * shortfall die. `jumpResult` says where the jumper stands, and the record
 * keeps it under `jump` (the face, the distance in feet, the save, the slip,
 * the footing). Only the first press rolls the die: a dialog dismissed on the
 * save leaves the distance rolled and the state `landing`, and the press that
 * follows finishes the save without rolling the die again.
 *
 * `step: "climbUp"` throws a hanging jumper's climb up: one stretch of
 * `HANG_CLIMB` through the climb rows' own throw, the member's own figure
 * against it, and a fall from it is the setup's depth.
 *
 * Every check is made before the first die; the row is read for the pressing
 * seat, so a permission refusal warns a Judge and blocks a player, and an
 * absence (a figure not imported, no gap set, the shortfall die a precarious
 * landing rolls on) rolls nothing for anyone. `beforeRoll` runs once those
 * checks pass and the member's in-flight key is held.
 *
 * @param {object} formation
 * @param {string} actorId the member's actor id
 * @param {object} [o]
 * @param {"attempt"|"climbUp"} [o.step] which press this is; any other is refused as `stale`
 * @param {boolean} [o.player] read the row for a player's seat
 * @param {string|null} [o.crossingId] the crossing id the requester held; null skips the check
 * @param {Function|null} [o.beforeRoll] awaited after the checks, before the die
 * @param {Event|null} [o.event] the press, so the system's skip-dialog key reads from it
 * @returns {Promise<{ok: boolean, refused?: string, message?: object, step?: string, result?: object}>}
 *   `refused` is `notGM`, `closed`, `stale`, `notJump`, `member`, `noGap`, `noCell`, `busy`, `cancelled`,
 *   `absence`, or the row's refusal reason
 */
export async function jumpFor(formation, actorId, { step = "attempt", player = false, crossingId = null, beforeRoll = null, event = null } = {}) {
  if (!game.user.isGM) return { ok: false, refused: "notGM" };
  const crossing = readCrossing(formation);
  if (!crossing) return { ok: false, refused: "closed" };
  if (crossingId !== null && crossingId !== crossing.id) return { ok: false, refused: "stale" };
  if (crossing.kind !== JUMP_KIND) return { ok: false, refused: "notJump" };
  const entry = crossingMembers(formation).find((e) => e.member.actorId === actorId);
  if (!entry) {
    await pruneMembers(formation);
    return { ok: false, refused: "member" };
  }
  if (step !== "attempt" && step !== "climbUp") return { ok: false, refused: "stale" };
  const seen = { ...entry, ...rowFor(formation, crossing, entry, player ? { judge: false, owns: true } : { judge: true }) };
  const refused = step === "climbUp" ? climbRefusal(seen) : attemptRefusal(seen);
  if (refused) return { ok: false, refused };
  const key = `${crossing.id}:${actorId}`;
  if (inFlight.has(key)) return { ok: false, refused: "busy" };
  const over = step === "climbUp" ? seen.climb.warn : seen.row.warn;
  if (over) {
    const refusal = step === "climbUp" ? seen.climb.refusal : seen.row.refusal;
    ui.notifications.warn(refusalText(refusal, seen.actor) || loc("crossing.card.overRefusalBare"));
  }
  inFlight.add(key);
  try {
    await beforeRoll?.();
    if (step === "climbUp") {
      const record = { ...(seen.record ?? {}), state: "climbing", covered: 0 };
      return await rollStretch(formation, crossing, seen, {
        record,
        row: seen.climb,
        title: loc("crossing.card.climbUp"),
        fallOf: () => fallFromDepth(crossing.depth),
        hold: false,
      });
    }
    return await attemptJump(formation, crossing, seen, { event: saveEvent(event, player), over });
  } finally {
    inFlight.delete(key);
  }
}

/** The attempt itself, once `jumpFor` has made its checks and holds the member's key. */
async function attemptJump(formation, crossing, seen, { event, over }) {
  const { actor } = seen;
  const actorId = seen.member.actorId;
  const gap = positive(crossing.gap);
  const prior = seen.record;
  const resume = prior?.state === LANDING && prior.jump;
  const throws = Math.max(0, Number(prior?.throws) || 0) + (resume ? 0 : 1);
  const rolls = [];
  let face;
  let distance;
  if (resume) ({ face, distance } = prior.jump);
  else {
    const die = await new Roll(`1d${jumpFaces()}`).evaluate();
    face = die.dice?.[0]?.results?.[0]?.result ?? die.dice?.[0]?.total ?? die.total;
    distance = jumpAt(seen.options, face);
    rolls.push(die);
  }
  if (distance === null) return { ok: false, refused: "absence" };
  const clears = distance >= gap;
  let save = null;
  let slip = null;
  if (clears && seen.landing.needed) {
    const key = saveKeyOf(seen.landing);
    const target = saveSpec(actor, key, { magical: false }).target;
    const rolled = await actor.rollSave(key, { event });
    if (!rolled) {
      await writeMemberStep(formation, crossing.id, actorId, { state: LANDING, covered: 0, throws, jump: { face, distance, gap, clears, save: null, slip: null, footing: null } });
      return { ok: false, refused: "cancelled" };
    }
    save = { total: rolled.total, target, passed: target !== null && rolled.total >= target };
    if (!save.passed) {
      const lost = await new Roll(shortfallDie()).evaluate();
      slip = lost.total;
      rolls.push(lost);
    }
  }
  const result = jumpResult({ gap, distance, save: save && { passed: save.passed }, slip, depth: crossing.depth });
  const jump = { face, distance, gap, clears, save, slip, footing: result.footing };
  if (!(await writeMemberStep(formation, crossing.id, actorId, { state: result.state, covered: 0, throws, jump }))) return { ok: false, refused: "stale" };
  const message = await postToJudges({
    content: jumpCard({ seen, result, face, save, over }),
    speaker: { alias: formation.name },
    rolls,
  });
  return { ok: true, message, step: result.state, result };
}
