/* global game, canvas, ui, foundry, ChatMessage, Roll, CONST */
/**
 * Doors, and the four ways past one (RR ch. 6 "Doors"): a key, picking the
 * lock, battering it down, or bashing it open on a Dungeonbashing throw. A
 * door in this module is a wall on the scene — Foundry's own door, with its
 * own open/closed/locked state — and everything ACKS adds to it is a flag
 * beside that state. Spikes are the reason a door needs stored state at
 * all, and are what makes an evil door stayable.
 *
 * Every figure is read from the import and none is held here: the door grid's
 * rows (`doors`, RR p. 266) and the bash paragraph's figures (RR p. 267), each
 * through `formationValue`. The bash target is the basher's own Dungeonbashing
 * throw (`resolveCheck`), never a figure of this file. A bash missing a term it
 * applies is not thrown, and a door with no imported row has no batter; see
 * docs/formation/DECISIONS.md, "An unimported door figure leaves bash or batter
 * blank".
 */
import { MODULE_ID, formationValue } from "./constants.mjs";
import { roundsPerTurn } from "../lib/time-unit.mjs";
import { abilityMod } from "../lib/actor-read.mjs";
import { isAutoFail, isAutoSucceed, dieFloor, throwFigures } from "../lib/throws.mjs";
import { gmIds } from "../lib/util.mjs";

const LANG_PREFIX = "ACKS-FORMATION.doors";

/** The door's ACKS state, stored beside Foundry's own door flags. */
export const DOOR_FLAG = "door";

/** The highest face of the die a bash rolls (a d20). */
const DIE_TOP = 20;

/**
 * One imported magnitude: a finite number at or above `min` (a whole number
 * where `whole`), else null. Nothing stands in for a figure that is not there.
 */
function figure(key, { whole = false, min = 0 } = {}) {
  const raw = formationValue(key);
  if (raw == null || raw === "") return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min || (whole && !Number.isInteger(n))) return null;
  return n;
}

/** The most spikes a door holds (RR p. 267), or null until imported. */
export const maxSpikes = () => figure("doorSpikeMax", { whole: true, min: 1 });

/** What a point of Strength modifier is worth on a Dungeonbashing throw (RR p. 267), or null until imported. */
export const bashStrFactor = () => figure("bashStrengthFactor");

/** The top of the unmodified results that botch a bash (RR p. 267), or null until imported. */
export const bashBotchBand = () => figure("bashBotchBand", { whole: true });

/** The damage a botch costs the basher (RR p. 267), or null until imported. */
export const bashReboundDamage = () => figure("bashReboundDamage", { whole: true });

/**
 * Kept so a caller that named the old constant still resolves it; it holds no
 * figure. The bash target now arrives from the import as the basher's own
 * Dungeonbashing throw: read it through `bashThrow` or `resolveCheck`.
 */
export const BASH_TARGET = null;

/**
 * Kept so a caller that named the old constant still resolves it; it holds no
 * figure. The Strength factor now arrives from the import: read it through
 * `bashStrFactor()`.
 */
export const BASH_STR_FACTOR = null;

/**
 * Kept so a caller that named the old constant still resolves it; it holds no
 * figure. The spike limit now arrives from the import: read it through
 * `maxSpikes()`.
 */
export const MAX_SPIKES = null;

/**
 * Kept so a caller that named the old table still resolves it; it holds no
 * row. The door kinds now arrive from the import as the door grid's rows: read
 * them through `doorRows()`.
 */
export const DOOR_KINDS = Object.freeze([]);

/**
 * Strength's contribution to a Dungeonbashing throw for a given modifier: 0 for
 * a modifier of zero, which needs no figure, and null for any other modifier
 * while the factor is not imported. The one reader every surface that resolves
 * such a throw uses. See docs/formation/DECISIONS.md, "Strength on a
 * Dungeonbashing throw has one owner".
 *
 * @param {number} strMod
 * @returns {number|null}
 */
export function bashStrBonus(strMod) {
  const mod = Number(strMod) || 0;
  if (!mod) return 0;
  const factor = bashStrFactor();
  return factor == null ? null : mod * factor;
}

/**
 * Strength's part in an actor's own Dungeonbashing figure, as the figure's
 * parts list it: `{kind: "strength", label, value, cite}`, with a positive
 * value lowering the target. Null where it is worth nothing, and
 * `{missing: "bashStrengthFactor"}` where the modifier is not zero and the
 * factor is not imported. The one place that figure takes its thrower's
 * Strength: `adventuringThrow` and `resolveCheck` add it, and a surface that
 * itemizes Strength itself (a door bash, which takes the stronger of a pair; a
 * squeeze push) asks them for the figure without it.
 *
 * @param {Actor} actor
 * @returns {{kind: "strength", label: string, value: number, cite: string}|{missing: string}|null}
 */
export function bashStrPart(actor) {
  const value = bashStrBonus(abilityMod(actor, "str"));
  if (value == null) return { missing: "bashStrengthFactor" };
  if (!value) return null;
  return { kind: "strength", label: game.i18n.localize("ACKS-FORMATION.doors.mod.str"), value, cite: game.i18n.localize("ACKS-FORMATION.doors.page.bash") };
}

/** The unit words a door's batter time can be counted in. */
const BATTER_UNITS = Object.freeze(["turn", "round"]);

/** A row's batter as the import states it, `{count, unit, tool}`, or null for anything else. */
function batterOf(raw) {
  const count = Number(raw?.count);
  if (!raw || !Number.isFinite(count) || count <= 0 || !BATTER_UNITS.includes(raw.unit)) return null;
  const tool = typeof raw.tool === "string" ? raw.tool.trim() : "";
  return tool ? { count, unit: raw.unit, tool } : null;
}

/** The key a door row is stored under: its place in the grid and its printed label together, since two rows can share a name. */
export const doorKey = (row) => `${row.ordinal}:${row.label}`;

/**
 * The imported door grid, in print order: `{key, ordinal, label, batter}`, where
 * `batter` is `{count, unit, tool}` or null for a construction the grid gives no
 * time for. Empty until the grid is imported.
 *
 * @returns {Array<{key: string, ordinal: number, label: string, batter: {count: number, unit: string, tool: string}|null}>}
 */
export function doorRows() {
  const raw = formationValue("doors");
  if (!Array.isArray(raw)) return [];
  const rows = [];
  for (const r of raw) {
    const ordinal = Number(r?.ordinal);
    const label = typeof r?.label === "string" ? r.label.trim() : "";
    if (!Number.isInteger(ordinal) || !label) continue;
    rows.push({ key: doorKey({ ordinal, label }), ordinal, label, batter: batterOf(r.batter) });
  }
  return rows;
}

/** The imported row a stored key names, or null: an unset key and one no row answers to (an older construction name) read alike. */
export const doorRow = (key) => (typeof key === "string" && key ? doorRows().find((r) => r.key === key) ?? null : null);

/**
 * Read a door's ACKS state. Absent flags read as a plain, unspiked door with no
 * construction picked: `kind` is the key of an imported row, or null.
 */
export function doorState(wall) {
  const f = wall?.getFlag?.(MODULE_ID, DOOR_FLAG) ?? wall?.flags?.[MODULE_ID]?.[DOOR_FLAG] ?? {};
  const cap = maxSpikes();
  const spikes = Math.max(0, Number(f.spikes) || 0);
  return {
    spikes: cap == null ? spikes : Math.min(cap, spikes),
    wedged: !!f.wedged,
    evil: !!f.evil,
    kind: doorRow(f.kind) ? f.kind : null,
    jammed: !!f.jammed, // a pick broken off in the lock
    batteredTurns: Math.max(0, Number(f.batteredTurns) || 0),
  };
}

/** Is this wall a door at all? (Foundry: 1 = door, 2 = secret door.) */
export const isDoor = (wall) => Number(wall?.door) > 0;

/**
 * The bash throw, as arithmetic — no dice, no documents, so the rule can be
 * tested and shown to a player before anyone commits a round to it.
 *
 * The target is the basher's own Dungeonbashing throw, passed in. Each term
 * applies only when its input is in play (a Strength modifier, a partner, a
 * crowbar, a size step, a spike past the free first) and reads its imported
 * magnitude; the signs are the procedure's. A term that applies and is not
 * imported, and the botch band and rebound every bash needs, are named in
 * `missing`, and a plan with anything missing, or with no target, is not `ready`:
 * its `needs` and `hopeless` are null and nothing may be thrown from it.
 *
 * @param {object} o
 * @param {number|null} o.target  the basher's Dungeonbashing target; null where there is none
 * @param {boolean} [o.proficient] the basher holds the skill that throw names
 * @param {number} o.strMod      Strength adjustment of the basher (the STRONGER, if a pair)
 * @param {boolean} o.pair       two adventurers heaving together
 * @param {boolean} o.crowbar    someone has a crowbar in hand
 * @param {number} o.sizeSteps   size categories away from man-sized (positive larger, negative smaller)
 * @param {number} o.spikes      spikes currently holding the door
 * @param {number} o.extra       the Judge's own modifier for an unusual door
 * @returns {{target: number|null, modifier: number, parts: object[], missing: string[], noThrow: boolean,
 *   ready: boolean, needs: number|null, hopeless: boolean|null}} `needs` is the lowest
 *   natural result that succeeds, `hopeless` is true where neither the best
 *   natural result nor an automatic success can
 */
export function bashPlan({ target = null, proficient = false, strMod = 0, pair = false, crowbar = false, sizeSteps = 0, spikes = 0, extra = 0 } = {}) {
  const parts = [];
  const missing = [];
  const term = (key, count, tableKey, sign) => {
    if (!count) return;
    const unit = figure(tableKey);
    if (unit == null) {
      if (!missing.includes(tableKey)) missing.push(tableKey);
      return;
    }
    const value = sign * count * unit;
    if (value) parts.push({ value, key });
  };
  term("str", Number(strMod) || 0, "bashStrengthFactor", 1);
  term("pair", pair ? 1 : 0, "bashPairBonus", 1);
  term("crowbar", crowbar ? 1 : 0, "bashCrowbarBonus", 1);
  const steps = Math.trunc(Number(sizeSteps) || 0);
  term("size", Math.max(0, steps), "bashSizeBonus", 1);
  term("size", Math.max(0, -steps), "bashSizePenalty", -1);
  term("spikes", Math.max(0, (Number(spikes) || 0) - 1), "bashSpikePenalty", -1);
  if (Number(extra)) parts.push({ value: Number(extra), key: "judge" });
  // The band and the rebound are read for every bash: the die is always rolled.
  if (bashBotchBand() == null) missing.push("bashBotchBand");
  if (bashReboundDamage() == null) missing.push("bashReboundDamage");

  const modifier = parts.reduce((sum, p) => sum + p.value, 0);
  const noThrow = !Number.isFinite(target);
  const ready = !noThrow && !missing.length;
  let needs = null;
  let hopeless = null;
  if (ready) {
    const { succeedMin } = throwFigures();
    const wanted = target - modifier;
    needs = Math.max(dieFloor() ?? 1, proficient && succeedMin != null ? Math.min(wanted, succeedMin) : wanted);
    hopeless = DIE_TOP + modifier < target && isAutoSucceed(DIE_TOP, { proficient: !!proficient }) !== true;
  }
  return { target: noThrow ? null : target, modifier, parts, missing, noThrow, ready, needs, hopeless };
}

/**
 * The basher's Dungeonbashing throw, `{target, proficient}`, or null where the
 * actor has none (no actor, or a creature whose sheet carries no Adventuring
 * figure and holds no such skill). `proficient` is the party check's own report
 * of whether a skill supplied the figure. Loaded here, not at the top: the party
 * check pulls in the Foundry-bound half of the module, and this file's pure
 * arithmetic is imported without it.
 *
 * @param {Actor|null} actor
 * @returns {Promise<{target: number, proficient: boolean}|null>}
 */
export async function bashThrow(actor) {
  if (!actor) return null;
  const { PARTY_CHECKS, resolveCheck } = await import("./party-rolls.mjs");
  // The bash itemizes Strength itself, as the stronger of a pair (`bashPlan`).
  const check = resolveCheck(actor, PARTY_CHECKS.dungeonbashing, { strength: false });
  return check && Number.isFinite(check.target) ? { target: check.target, proficient: !!check.skilled } : null;
}

/**
 * The Strength adjustment a bash uses: the basher's own, whatever its sign, and
 * the stronger of the two where a partner heaves too (RR p. 267). No basher
 * reads 0.
 *
 * @param {Actor|null} actor
 * @param {Actor|null} [partner]
 * @returns {number}
 */
export function bashStrength(actor, partner = null) {
  const mods = [actor, partner].filter(Boolean).map((who) => Number(abilityMod(who, "str")) || 0);
  return mods.length ? Math.max(...mods) : 0;
}

/** Write door state, merging over what is stored: only the keys passed are written. */
async function setDoorState(wall, patch) {
  return wall.setFlag(MODULE_ID, DOOR_FLAG, patch);
}

/**
 * The Judge's record of what the door is: its construction, and whether it is
 * evil or jammed. Only the keys passed are written; a `kind` that is not the key
 * of an imported row (or the empty string, which clears it) is ignored rather
 * than stored. Returns the state as stored afterwards.
 *
 * @param {WallDocument} wall
 * @param {{kind?: string, evil?: boolean, jammed?: boolean}} traits
 */
export async function setDoorTraits(wall, { kind, evil, jammed } = {}) {
  if (!isDoor(wall)) return { ok: false, reason: "notADoor" };
  const patch = {};
  if (kind !== undefined && (kind === "" || doorRow(kind))) patch.kind = kind;
  if (evil !== undefined) patch.evil = !!evil;
  if (jammed !== undefined) patch.jammed = !!jammed;
  if (Object.keys(patch).length) await setDoorState(wall, patch);
  return { ok: true, state: doorState(wall) };
}

/**
 * Hammer one spike home. A round per spike, up to the imported limit — and a
 * spiked door is the only thing that keeps an evil door from opening for
 * whatever is on the other side. With no limit imported nothing is hammered.
 */
export async function spikeDoor(wall, actor = null) {
  if (!isDoor(wall)) return { ok: false, reason: "notADoor" };
  const cap = maxSpikes();
  if (cap == null) return { ok: false, reason: "missing", missing: ["doorSpikeMax"] };
  const state = doorState(wall);
  if (state.spikes >= cap) return { ok: false, reason: "full" };
  await setDoorState(wall, { spikes: state.spikes + 1 });
  await announce(wall, "spiked", { name: actor?.name ?? game.i18n.localize(`${LANG_PREFIX}.someone`), n: state.spikes + 1 });
  return { ok: true, spikes: state.spikes + 1 };
}

/** Pull a spike back out — a Judge's correction, or a party recovering its iron. */
export async function unspikeDoor(wall) {
  const state = doorState(wall);
  if (!state.spikes) return { ok: false, reason: "none" };
  await setDoorState(wall, { spikes: state.spikes - 1 });
  return { ok: true, spikes: state.spikes - 1 };
}

/**
 * Heave at the door. Rolls the basher's own Dungeonbashing throw with the
 * plan's modifier, applies the RAW outcome — the door opens at once on a
 * success, and a failure whose natural result falls in the botch band hurts the
 * basher (RR p. 267) — and says what happened. Never consumes the spikes:
 * forcing a spiked door tears it open, so the spikes go with it.
 *
 * The natural die is read first: an automatic success (a basher holding the
 * skill) or an automatic failure decides the throw whatever the total, each read
 * through `lib/throws.mjs` and absent until imported; otherwise the total against
 * the target decides. A botch is a failure whose natural result is in the door's
 * own band.
 *
 * A bash is refused, before any die is rolled, with `{ok: false, reason: "noThrow"}`
 * where the actor has no Dungeonbashing throw, and `{ok: false, reason: "missing",
 * missing}` where a term it applies is not imported; `missing` names the figures.
 * A pair throws at the basher's own target with the stronger Strength adjustment
 * of the two and the pair term (RR p. 267).
 */
export async function bashDoor(wall, { actor = null, partner = null, crowbar = false, sizeSteps = 0, extra = 0 } = {}) {
  if (!isDoor(wall)) return { ok: false, reason: "notADoor" };
  const state = doorState(wall);
  const pair = !!partner;
  const strMod = bashStrength(actor, partner);
  const thrown = await bashThrow(actor);
  const plan = bashPlan({ target: thrown?.target ?? null, proficient: thrown?.proficient ?? false, strMod, pair, crowbar, sizeSteps, spikes: state.spikes, extra });
  if (!plan.ready) return { ok: false, reason: plan.noThrow ? "noThrow" : "missing", missing: plan.missing };

  const roll = await new Roll(`1d20 + ${plan.modifier}`).evaluate();
  const natural = roll.dice[0]?.results?.[0]?.result ?? roll.total - plan.modifier;
  const success = isAutoSucceed(natural, { proficient: thrown.proficient }) === true
    ? true
    : isAutoFail(natural) === true ? false : roll.total >= plan.target;
  const band = bashBotchBand();
  const botch = !success && natural >= 1 && natural <= band;

  if (success) {
    // Forced open: Foundry's own door state opens, and the spikes tore out
    // with it. A door held shut by nothing is no longer locked either.
    await wall.update({ ds: 1 });
    await setDoorState(wall, { spikes: 0, wedged: false });
  }

  const name = actor?.name ?? game.i18n.localize(`${LANG_PREFIX}.someone`);
  const damage = botch ? bashReboundDamage() : 0;
  // The rebound's damage is reported on the card and never written to the
  // sheet, the way a trap reports its own.
  const damageLine = damage
    ? `<p><strong>${game.i18n.format(`${LANG_PREFIX}.damageTo`, { name: foundry.utils.escapeHTML(name), damage })}</strong>`
      + ` <em>${game.i18n.localize(`${LANG_PREFIX}.damageIsReported`)}</em></p>`
    : "";

  await ChatMessage.create({
    speaker: ChatMessage.getSpeaker({ actor }),
    flavor: game.i18n.localize(`${LANG_PREFIX}.bashFlavor`),
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.bashResult`, {
      name,
      total: roll.total,
      target: plan.target,
      outcome: game.i18n.localize(`${LANG_PREFIX}.${success ? "opened" : botch ? "botched" : "held"}`),
    })}</p>${damageLine}`,
    rolls: [roll],
  });

  return { ok: true, success, botch, natural, total: roll.total, plan, damage };
}

/**
 * Battering a door down asks no throw at all — only time, and only for a
 * construction whose imported row names a time and a tool. Returns the time as
 * the grid counts it (`count` of `unit`, with `tool`) and in `rounds`, so the
 * turn engine can spend it. A door with no row picked answers `noRow` and shows
 * nothing; a row whose notes give no time answers `tooSolid`. Whether the party
 * holds the tool is the Judge's call.
 *
 * `rounds` is null for a time the grid counts in turns while the rounds to a
 * turn are not imported; `count` and `unit` stand either way.
 *
 * @returns {{ok: true, count: number, unit: string, tool: string, rounds: number|null, row: object}|{ok: false, reason: "noRow"|"tooSolid", row?: object}}
 */
export function batterPlan(wall) {
  const row = doorRow(doorState(wall).kind);
  if (!row) return { ok: false, reason: "noRow" };
  if (!row.batter) return { ok: false, reason: "tooSolid", row };
  const { count, unit, tool } = row.batter;
  return { ok: true, count, unit, tool, rounds: unit === "turn" ? turnRounds(count) : count, row };
}

/** A count of turns as rounds, or null where the rounds to a turn are not imported. */
function turnRounds(turns) {
  const perTurn = roundsPerTurn();
  return perTurn == null ? null : turns * perTurn;
}

/**
 * Batter the door down: Foundry's own door state opens, and the time
 * `batterPlan` priced is spent on the clock of the formation holding the
 * basher (reason "action"). With no basher, or no formation holding them,
 * the door still opens and no time is spent; `spent` is then 0 and `formation`
 * null, so the caller can say so.
 *
 * @param {WallDocument} wall
 * @param {Actor|null} actor  the one swinging the tool
 * @param {object} [opts]
 * @param {boolean} [opts.spend] spend the time on the clock; the turn plan
 *   passes false, having spent its time as it passed
 * @returns {Promise<{ok: boolean, reason?: string, count?: number, unit?: string, tool?: string, rounds?: number, spent?: number, formation?: string|null}>}
 *   `spent` is in rounds, null where the rounds to a turn are not imported
 */
export async function batterDoor(wall, actor = null, { spend = true } = {}) {
  if (!isDoor(wall)) return { ok: false, reason: "notADoor" };
  const plan = batterPlan(wall);
  if (!plan.ok) return { ok: false, reason: plan.reason };
  const { count, unit, tool, rounds } = plan;
  await wall.update({ ds: 1 });
  if (!spend) return { ok: true, count, unit, tool, rounds, spent: 0, formation: null };
  // Loaded here, not at the top: the turn engine pulls in the Foundry-bound
  // half of the module, and this file's pure arithmetic is imported without it.
  const { getFormationForActor } = await import("./formation-model.mjs");
  const { advanceRounds, advanceTurns } = await import("./turn-engine.mjs");
  const formation = actor?.id ? getFormationForActor(actor.id) : null;
  // A time the grid counts in turns is spent as turns, so it needs no rounds to a turn.
  if (formation) await (unit === "turn" ? advanceTurns(formation, count, { reason: "action" }) : advanceRounds(formation, count, { reason: "action" }));
  return { ok: true, count, unit, tool, rounds, spent: formation ? rounds : 0, formation: formation?.name ?? null };
}

/**
 * Show a secret door: the wall becomes an ordinary door. Only `door` is
 * written, so its open/closed/locked state and every flag, the `door` flag
 * included, stay as they were. A wall that is already an ordinary door is
 * left alone and no write is made, so a second call is harmless. Only a GM
 * client writes (a player's client may not update walls); anywhere else the
 * call refuses and nothing is written. Nothing throws.
 *
 * @param {WallDocument|null} wall
 * @returns {Promise<{ok: true, revealed: boolean}|{ok: false, reason: "noWall"|"notGM"|"notADoor"}>}
 *   `revealed` is true when this call turned a secret door into a door and
 *   false when the wall already showed as one; `reason` names the refusal.
 */
export async function revealSecretDoor(wall) {
  if (!wall) return { ok: false, reason: "noWall" };
  if (!game.user?.isGM) return { ok: false, reason: "notGM" };
  const types = CONST.WALL_DOOR_TYPES;
  const secret = types?.SECRET ?? 2;
  if (Number(wall.door) !== secret) {
    return isDoor(wall) ? { ok: true, revealed: false } : { ok: false, reason: "notADoor" };
  }
  await wall.update({ door: types?.DOOR ?? 1 });
  return { ok: true, revealed: true };
}

/** A one-line note in chat, for the things that are not rolls. */
async function announce(wall, key, data) {
  await ChatMessage.create({
    content: `<p>${game.i18n.format(`${LANG_PREFIX}.${key}`, data)}</p>`,
    whisper: gmIds(),
  });
}

/** The door the Judge means: the one selected on the Walls layer. */
export function selectedDoor() {
  const walls = canvas?.walls?.controlled ?? [];
  const doors = walls.map((w) => w.document).filter(isDoor);
  if (!doors.length) {
    ui.notifications?.warn(game.i18n.localize(`${LANG_PREFIX}.selectADoor`));
    return null;
  }
  return doors[0];
}
