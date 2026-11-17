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
 * A jump is a distance against a gap, so its rows carry a verdict and no throw.
 * Where the setup marks the landing precarious or the jump charging, a Judge's
 * press rolls the member's landing save through the system's own `rollSave`
 * (`landFor`), and a failed landing is reported on the footing the Judge
 * picks (`reportLanding`). Both are the Judge's alone; neither writes the flag.
 *
 * A crossing applies no condition, spends no time on the clock and posts no
 * damage: the card reports a fall's distance and dice and touches no hit
 * points. A player's client never writes or rolls: its press is relayed
 * (`player-requests.mjs`, kind `crossing`) and the GM client answers it with
 * `throwFor` read for a player's seat.
 */
import { MODULE_ID, FORMATION_DOC } from "./constants.mjs";
import { hasCapability } from "./ability-bridge.mjs";
import {
  carriedLoad, encumbranceOf, getMemberActor, getPartyActor, hasAbility, isCasualty, isStackMember, realMembers,
} from "./formation-model.mjs";
import { partText, resolveCheck } from "./party-rolls.mjs";
import { OBSTACLES, adventuringTarget, outcomeProvenance, readThrow, stretchFeet } from "./obstacles.mjs";
import { NO_ACROBATICS, fallFigures, jumpDistance } from "./jumping.mjs";
import {
  CLIMB_CHECK, FOOTINGS, SETTLED, STALLED, fallFromClimb, jumpRow, landingOutcome, landingRow, memberRow, stepMember,
} from "./crossing-logic.mjs";
import { BOOK_TO_RELEASED_SAVES } from "../lib/actor-compat.mjs";
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
  const setup = { id: foundry.utils.randomID(), kind, judgeMod: 0, ropeFixed: false, runUp: true, precarious: false, charging: false, members: {} };
  await actor.update({ [`flags.${MODULE_ID}.${CROSSING_FLAG}`]: foundry.data.operators.ForcedReplacement.create(setup) });
  return setup.id;
}

/**
 * Close the crossing: the flag is unset, members and all.
 * @returns {Promise<boolean>} whether a crossing was closed
 */
export async function endCrossing(formation) {
  const actor = getPartyActor(formation);
  if (!actor || !game.user.isGM || !readCrossing(formation)) return false;
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
 * same write.
 * @returns {Promise<boolean>} whether the write was made
 */
export async function writeMemberStep(formation, crossingId, actorId, step) {
  const actor = getPartyActor(formation);
  if (!actor || !game.user.isGM) return false;
  const current = readCrossing(formation);
  if (!current || current.id !== crossingId) return false;
  const update = { [memberPath(actorId)]: step };
  const held = new Set(realMembers(formation).map((m) => m.actorId));
  for (const id of Object.keys(current.members ?? {})) if (!held.has(id)) update[memberPath(id)] = unset();
  await actor.update(update);
  return true;
}

/** Drop the records of members the party no longer holds. @returns {Promise<boolean>} whether any was dropped */
export async function pruneMembers(formation) {
  const actor = getPartyActor(formation);
  const current = readCrossing(formation);
  if (!actor || !game.user.isGM || !current) return false;
  const held = new Set(realMembers(formation).map((m) => m.actorId));
  const update = {};
  for (const id of Object.keys(current.members ?? {})) if (!held.has(id)) update[memberPath(id)] = unset();
  if (!Object.keys(update).length) return false;
  await actor.update(update);
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
    const row = jumpRow(gap ?? 0, { options, seat, standing });
    // What Acrobatics is worth to the save is passed in as the logic's neutral figure.
    const landing = landingRow(row, {
      precarious: !!crossing.precarious, charging: !!crossing.charging, acrobatics: options.acrobatics, saveBonus: NO_ACROBATICS.saveBonus,
    });
    return { actor, member, jump: true, standing, options, gapSet: gap !== null, row, landing };
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
 * A member's target as a tooltip: where the figure was read from, each part with
 * the page its import cites, and the Judge's modifier where one is set. Conditions
 * arrive as a part of the figure.
 */
export function targetTooltip(figure, judgeMod = 0) {
  if (!figure) return spelunkingRef();
  const parts = (figure.parts ?? []).map((part) => `${partText(part)}${part.cite ? ` (${part.cite})` : ""}`);
  const mod = Number(judgeMod) || 0;
  if (mod) parts.push(partText({ value: mod, label: loc("crossing.judgeMod") }));
  return [figure.source, ...parts].filter(Boolean).join(" · ");
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
    if (game.i18n.has(path)) return game.i18n.format(path, { name: actor?.name ?? "?" });
  }
  return "";
}

/**
 * Whether this seat may press a throw now: a crossing over an obstacle is open
 * and a member this seat owns has a row that allows it and a throw left. This
 * is the question the player panel asks, answered from the rows the section
 * draws.
 */
export function canCross(formation) {
  const crossing = readCrossing(formation);
  if (!crossing || crossing.kind === JUMP_KIND) return false;
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
    permitted: entry.holds || permitted === null ? "" : loc(permitted === false ? "crossing.refused" : "crossing.permitted"),
    permittedTip: permitted === null
      ? spelunkingRef()
      : [loc("crossing.tip.permitted", { kind: kindLabel(row.effective ?? crossing.kind) }), citeFor("spelunking")].filter(Boolean).join(" · "),
    covered: row.stretches === null ? "" : `${row.covered} / ${row.stretches}`,
    coveredTip: stretchTooltip(row.stretches),
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

/** One jump row for the template. */
function jumpRowView(crossing, entry) {
  const { actor, row, options } = entry;
  const said = refusalText(row.refusal, actor);
  const range = row.min === null ? "" : `${row.min}–${row.max}`;
  return {
    landing: landingView(entry),
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
function throwCard({ crossing, entry, plan, read, roll, natural, stepped, fall }) {
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
    title: loc("crossing.card.title", { kind: kindLabel(row.effective ?? crossing.kind) }),
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
    const roll = await new Roll("1d20").evaluate();
    const natural = roll.dice?.[0]?.results?.[0]?.result ?? roll.dice?.[0]?.total ?? roll.total;
    const read = readThrow({ plan: row.plan, natural, total: roll.total });
    const record = crossing.members?.[actorId] ?? null;
    const stepped = stepMember({ member: record, stretches: row.stretches, read, natural, total: roll.total });
    const fall = stepped.state === "fell"
      ? fallFromClimb({ kind: row.effective, covered: record?.covered ?? 0, feet: positive(crossing.length), depth: crossing.depth })
      : null;
    if (!(await writeMemberStep(formation, crossing.id, actorId, stepped))) return { ok: false, refused: "stale" };
    const message = await postToJudges({
      content: throwCard({ crossing, entry: seen, plan: row.plan, read, roll, natural, stepped, fall }),
      speaker: { alias: formation.name },
      rolls: [roll],
    });
    return { ok: true, message, step: stepped.state, fall };
  } finally {
    inFlight.delete(key);
  }
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
 * setup's depth. The figures are reported and applied to nothing: no hit point,
 * condition or position changes, and the flag is not written.
 *
 * @param {object} formation
 * @param {string} actorId the member's actor id
 * @param {string} footing one of `FOOTINGS`
 * @returns {Promise<{ok: boolean, refused?: string, message?: object, outcome?: object}>}
 *   `refused` is `notGM`, `closed`, `notJump`, `member` or `footing`
 */
export async function reportLanding(formation, actorId, footing) {
  const { crossing, seen, refused } = landingEntry(formation, actorId);
  if (refused) return { ok: false, refused };
  const outcome = landingOutcome({ footing, depth: crossing.depth });
  if (!outcome) return { ok: false, refused: "footing" };
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
