import { ROLES, diceFormula, formationValue } from "./constants.mjs";
import { fallFigures } from "./jumping.mjs";
import { positiveFigure } from "../lib/util.mjs";

/**
 * Traps, as arithmetic — no dice, no documents, no Foundry.
 *
 * Who walks into a trap first, who is caught when it goes off, what the disarm
 * throw is before anyone rolls it, and whether a thief may try again.
 * `trap-zone.mjs` supplies the dice and the world; this file is the rule.
 *
 * The mechanisms are written here (a trap resolves as a save, an attack or
 * automatic damage; a crude one is easier to find and remove and weaker when
 * it fires; a pit deals its depth in dice). No printed trap is: a Judge types
 * the formula their own trap deals. Every distance and die arrives in the
 * `formation` registered document (`trapFigures`, `pitFigures`); a figure not
 * imported reads null and each consumer says what it does without it. A rank's
 * depth is the laid column's (`laidOrder`), else the scene's cell.
 */

/** A figure as a whole number of at least zero, or null. */
const whole = (value) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isInteger(n) && n >= 0 ? n : null;
};

/** A positive whole number, or null. */
const wholePositive = (value) => {
  const n = whole(value);
  return n > 0 ? n : null;
};

/** The faces of a single die as `1dN`, or null: a Judge's override is free text, and only dice reach a roll. */
const faces = (value) => {
  const m = /^1d(\d+)$/.exec(diceFormula(value) ?? "");
  return m && Number(m[1]) > 0 ? Number(m[1]) : null;
};

/**
 * The imported trap figures, each null where nothing is imported (the
 * Judge's override layer wins per key). The document's keys: `searchReachFeet`
 * and `poleSearchReachFeet` (how far the automatic hasty search reaches, bare
 * and with a pole), `poleLeadFeet` (how far a pole probes ahead of its
 * bearer), `trapTriggerDie` and `trapTriggerOn` (the secret die and the band
 * that springs the trap), `trapbreakReachFeet`, `trapbreakHastyBotch` and
 * `trapbreakMethodicalBotch` (the unmodified die at or below which a throw goes
 * wrong) and `trapbreakMethodicalBonus`.
 * @returns {{searchFeet: number|null, poleSearchFeet: number|null,
 *   poleLeadFeet: number|null, triggerFaces: number|null, triggerOn: number|null,
 *   trapbreakReachFeet: number|null, botch: {hasty: number|null, methodical: number|null},
 *   methodicalBonus: number|null}}
 */
export function trapFigures() {
  return {
    searchFeet: positiveFigure(formationValue("searchReachFeet")),
    poleSearchFeet: positiveFigure(formationValue("poleSearchReachFeet")),
    poleLeadFeet: positiveFigure(formationValue("poleLeadFeet")),
    triggerFaces: faces(formationValue("trapTriggerDie")),
    triggerOn: whole(formationValue("trapTriggerOn")),
    trapbreakReachFeet: positiveFigure(formationValue("trapbreakReachFeet")),
    botch: {
      hasty: wholePositive(formationValue("trapbreakHastyBotch")),
      methodical: wholePositive(formationValue("trapbreakMethodicalBotch")),
    },
    methodicalBonus: wholePositive(formationValue("trapbreakMethodicalBonus")),
  };
}

/**
 * The dice a pit deals, from the imported `fall` table (the die and the feet
 * it is dealt per, `fallFigures`) and the spike figures: `{count, faces}`, the
 * dice that count the spikes and the die each deals. Either is null where it is
 * not imported; a spike die that is not a single die reads as not imported.
 * @returns {{fall: {count: number, faces: number, feetPerDie: number}|null,
 *   spike: {count: string, faces: number}|null}}
 */
export function pitFigures() {
  const count = diceFormula(formationValue("pitSpikeCount"));
  const each = faces(formationValue("pitSpikeDie"));
  return { fall: fallFigures(), spike: count && !count.includes("*") && each ? { count, faces: each } : null };
}

/** How a trap resolves once it goes off. */
export const RESOLUTIONS = Object.freeze({
  /** Each creature caught throws a save; failure is the full effect. */
  save: "save",
  /** The trap attacks as a fighter of some level; damage on a hit. */
  attack: "attack",
  /** No throw at all — the pit opens and you are in it. */
  automatic: "automatic",
  /** It fires and the Judge narrates; the module rolls nothing. */
  none: "none",
});

/** Who a trap catches: only whoever set it off, or everything within a radius. */
export const SCOPES = Object.freeze({ triggerer: "triggerer", area: "area" });

/** What beating the trap's throw is worth to the victim; a field on each trap. */
export const ON_SUCCESS = Object.freeze({
  /** Half damage, rounded down. The commonest. */
  half: "half",
  /** Nothing at all — dodged, avoided, missed. */
  none: "none",
  /** The throw changes nothing about the damage; the rider is the point. */
  full: "full",
});

/** The number of level rows a trap holds. */
export const TRAP_LEVELS = 6;

/**
 * The six rows a trap should hold after a sheet submit that rendered ONE of
 * them: rebuilt from what is stored, with exactly one index taken from the
 * submit (Foundry expands the form's dotted paths into an array holding only
 * the named rows, which written through would replace the whole trap).
 *
 * @param {object[]} stored the document's current rows
 * @param {object[]|object} submitted what the form produced
 * @param {number} level 1-based level the form was showing
 */
export function mergeTierSubmit(stored = [], submitted = [], level = 1) {
  const index = Math.min(Math.max(Number(level) || 1, 1), TRAP_LEVELS) - 1;
  const edited = submitted?.[index] ?? submitted?.[String(index)] ?? {};
  return Array.from({ length: TRAP_LEVELS }, (_, i) => ({
    ...emptyTier(),
    ...(stored?.[i] ?? {}),
    ...(i === index ? edited : {}),
  }));
}

/**
 * One level of a trap with nothing said about it yet. A row may be empty; the
 * shape exists without Foundry for the sheet and the offline tests.
 */
export const emptyTier = () => ({
  text: "",
  resolution: RESOLUTIONS.automatic,
  onSuccess: ON_SUCCESS.half,
  saveKey: "",
  attackThrow: 0,
  damageFormula: "",
  pitDepthFeet: 0,
  spiked: false,
  radiusFeet: 0,
  rider: "",
});

/**
 * What a victim actually takes, given the throw and what success is worth.
 *
 * @param {number} rolled the damage the trap rolled
 * @param {boolean|null} beat did the victim beat the throw? null when the trap
 *   allows no throw at all, in which case the damage lands whole.
 * @param {string} onSuccess one of `ON_SUCCESS`
 * @returns {{taken: number, mitigated: boolean}}
 */
export function damageTaken(rolled, beat, onSuccess = ON_SUCCESS.half) {
  const full = Math.max(0, Math.floor(Number(rolled) || 0));
  if (beat !== true) return { taken: full, mitigated: false };
  if (onSuccess === ON_SUCCESS.none) return { taken: 0, mitigated: true };
  if (onSuccess === ON_SUCCESS.full) return { taken: full, mitigated: false };
  return { taken: Math.floor(full / 2), mitigated: true };
}

/** Whether a trap is still waiting, already spotted, or dealt with. */
export const STATES = Object.freeze({
  armed: "armed",
  found: "found",
  disarmed: "disarmed",
  discharged: "discharged",
});

/**
 * A crudely built trap: easier to find and remove, feebler when it fires. One
 * modifier set covers every crude trap (a checkbox on the zone, not a trap
 * kind). Its upkeep decay (JJ p. 238) is a Judge's clock and is not kept here.
 */
export const CRUDE = Object.freeze({ find: 4, remove: 4, attack: -2, save: 2 });

/* -------------------------------------------- */
/*  Who walks into it                           */
/* -------------------------------------------- */

/**
 * The order in which the party presents itself to a trap, front first.
 *
 * A pole is an extra probe: it enters the sequence `poleRanks` (the imported
 * lead, in ranks) ahead of its bearer and throws separately. Where a pole and a
 * body reach the same square the body goes first. Within one square and kind
 * the order is shuffled (RR p. 267), so ranks still meet the trap front to
 * back. See docs/formation/DECISIONS.md, "Probes in one square are shuffled, and a body precedes a pole".
 *
 * @param {object[]} order rows in `marchingOrder()`'s shape
 * @param {object} [opts]
 * @param {boolean} [opts.pole] may poles probe at all? False at combat speed,
 *   which loses the pole along with mapping and the hasty search.
 * @param {number|null} [opts.poleRanks] how many ranks ahead of its bearer a
 *   pole probes (the imported lead over a rank's depth, `poleLeadRanks`); null
 *   where either is not known, and no pole probes.
 * @param {() => number} [opts.random] the source of the shuffle, injected for tests.
 * @returns {Array<{kind: "body"|"pole", actorId: string, name: string|null,
 *   rank: number, file: number, reach: number}>}
 */
export function probeSequence(order, { pole = true, poleRanks = null, random = Math.random } = {}) {
  const probes = [];
  const lead = positiveFigure(poleRanks);
  for (const row of order ?? []) {
    const base = { actorId: row.actorId, name: row.name ?? null, rank: row.rank, file: row.file };
    probes.push({ ...base, kind: "body", reach: row.rank });
    if (pole && lead !== null && (row.roles ?? []).includes(ROLES.POLE)) {
      probes.push({ ...base, kind: "pole", reach: row.rank - lead });
    }
  }

  // Group by the square each probe reaches, shuffle inside the group, then lay
  // the groups out front to back; the shuffle runs within a kind, not across
  // body and pole.
  const groups = new Map();
  for (const probe of probes) {
    const key = `${probe.reach}:${probe.kind}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(probe);
  }
  for (const group of groups.values()) {
    for (let i = group.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [group[i], group[j]] = [group[j], group[i]];
    }
  }

  const kindRank = (kind) => (kind === "pole" ? 1 : 0);
  return [...groups.entries()]
    .sort(([a], [b]) => {
      const [ar, ak] = a.split(":");
      const [br, bk] = b.split(":");
      return Number(ar) - Number(br) || kindRank(ak) - kindRank(bk);
    })
    .flatMap(([, group]) => group);
}

/** The depth of one rank in feet: `rankFeet` where it is a length, else null. */
export function rankDepth(rankFeet) {
  return positiveFigure(rankFeet);
}

/**
 * How many ranks a pole probes ahead of its bearer: the imported lead over how
 * deep a rank stands. Null when either is not known.
 */
export function poleLeadRanks(poleLeadFeet, rankFeet) {
  const lead = positiveFigure(poleLeadFeet);
  const depth = rankDepth(rankFeet);
  return lead !== null && depth !== null ? lead / depth : null;
}

/**
 * How far ahead of the party token this searcher's own reach extends, in feet.
 *
 * The reach is the character's and the distance is measured from the party
 * token, so the searcher's own place (rank times the rank's depth) is
 * subtracted. A pole with no imported reach is a plain searcher. Null where the
 * search reach is not imported, or the searcher stands behind the front rank
 * and no depth says how far back.
 *
 * @param {object} row a marching-order row
 * @param {object} figures
 * @param {number|null} figures.searchFeet the bare search reach
 * @param {number|null} figures.poleSearchFeet the search reach with a pole
 * @param {number|null} figures.rankFeet how deep one rank stands
 * @returns {number|null}
 */
export function searcherReachFeet(row, { searchFeet = null, poleSearchFeet = null, rankFeet = null } = {}) {
  const bare = positiveFigure(searchFeet);
  if (bare === null) return null;
  const own = (row.roles ?? []).includes(ROLES.POLE) ? (positiveFigure(poleSearchFeet) ?? bare) : bare;
  if (!row.rank) return own;
  const depth = rankDepth(rankFeet);
  return depth === null ? null : own - row.rank * depth;
}

/**
 * Who is close enough to notice a trap on the way past: the rows whose reach
 * extends beyond the front of the party. With no reach imported only the front
 * rank searches, and only the trap the party crossed (the caller's choice);
 * a row whose reach is not stated is out unless it stands in the front rank.
 */
export function autoSearchers(order, figures = {}) {
  return (order ?? []).filter((row) => {
    const reach = searcherReachFeet(row, figures);
    return reach === null ? !row.rank : reach > 0;
  });
}

/**
 * Who the trap catches, given which probe set it off.
 *
 * A `triggerer` scope takes whoever touched it; an `area` scope takes every
 * body within its radius of where it went off. A pole-sprung trap catches
 * nobody within its own square, though an area effect still reaches back for the
 * bearer.
 *
 * @param {object[]} probes from `probeSequence`
 * @param {number} index which probe sprang it
 * @param {object} [opts]
 * @param {string} [opts.scope] one of `SCOPES`
 * @param {number} [opts.radiusFeet] how far an area effect reaches
 * @param {number|null} [opts.rankFeet] how deep one rank stands, in feet: the
 *   imported rank interval where the column is laid by it, else the scene's
 *   cell. A figure that is no length leaves an area effect on the rank it
 *   sprang in.
 * @returns {object[]} the probes' bodies that are caught, front to back
 */
export function victimsOf(probes, index, { scope = SCOPES.triggerer, radiusFeet = 0, rankFeet = null } = {}) {
  const sprung = probes?.[index];
  if (!sprung) return [];
  const bodies = (probes ?? []).filter((p) => p.kind === "body");

  if (scope !== SCOPES.area) {
    // A pole-sprung trap fires into empty corridor.
    if (sprung.kind === "pole") return [];
    return bodies.filter((p) => p.actorId === sprung.actorId && p.rank === sprung.rank);
  }

  // A body is caught where its distance from the spot, in ranks of this depth,
  // is within the radius; with no depth, only the rank the trap sprang in.
  const depth = rankDepth(rankFeet);
  const radius = Math.max(0, Number(radiusFeet) || 0);
  return bodies.filter((p) => {
    const apart = Math.abs(p.rank - sprung.reach);
    return depth === null ? apart === 0 : apart * depth <= radius + 1e-9;
  });
}

/**
 * Did the trigger die spring it? False for a band that is not a number: a trap
 * with no band to compare against springs nothing.
 */
export function triggerFires(die, triggerOn) {
  if (triggerOn == null || triggerOn === "") return false;
  return Number(die) >= 1 && Number(die) <= Number(triggerOn);
}

/* -------------------------------------------- */
/*  Disabling it                                */
/* -------------------------------------------- */

/**
 * The Trapbreaking throw, itemized before it is rolled. Methodical takes a turn
 * instead of a round, permits a non-thief through Adventuring, adds the imported
 * bonus for a skilled thief and may be repeated after a failure; hasty does
 * none of these. A bonus or a botch band that is not imported contributes
 * nothing (RR ch. 6, Traps and Trapbreaking).
 *
 * @param {object} o
 * @param {"hasty"|"methodical"} o.mode
 * @param {boolean} [o.crude] a crudely built trap, easier to remove
 * @param {boolean} [o.skilled] resolving through a real Trapbreaking skill
 *   rather than through the Adventuring proficiency
 * @param {number} [o.extra] the Judge's own modifier
 * @param {object} [o.figures] `trapFigures()`, injectable
 * @returns {{mode: string, bonus: number, parts: object[], botchBand: number|null,
 *   repeatable: boolean, adventuringAllowed: boolean}}
 */
export function disarmPlan({ mode = "methodical", crude = false, skilled = true, extra = 0, figures = trapFigures() } = {}) {
  const methodical = mode === "methodical";
  const parts = [];
  const push = (value, key) => {
    if (value) parts.push({ value, key });
  };
  // The methodical bonus is the skill's; a non-thief working through
  // Adventuring does not collect it.
  push(methodical && skilled ? (figures.methodicalBonus ?? 0) : 0, "methodical");
  push(crude ? CRUDE.remove : 0, "crude");
  push(extra, "judge");
  return {
    mode,
    bonus: parts.reduce((sum, p) => sum + p.value, 0),
    parts,
    botchBand: (methodical ? figures.botch?.methodical : figures.botch?.hasty) ?? null,
    repeatable: methodical,
    // No Adventuring on the hasty column (RR p. 267).
    adventuringAllowed: methodical,
  };
}

/**
 * Did the throw go wrong badly enough to spring the thing being disarmed? Never
 * where the mode's band is not imported.
 * @param {number} natural the unmodified die
 * @param {"hasty"|"methodical"} [mode]
 * @param {object} [figures] `trapFigures()`, injectable
 */
export function isBotch(natural, mode = "methodical", figures = trapFigures()) {
  const band = mode === "hasty" ? figures.botch?.hasty : figures.botch?.methodical;
  return band != null && Number.isFinite(natural) && natural >= 1 && natural <= band;
}

/**
 * May this character try a hasty attempt on this trap again?
 *
 * A failed hasty attempt is remembered against the level it failed at, and
 * reopens when the character's level passes it.
 *
 * @param {Record<string, number>} lock actorId → level the attempt failed at
 * @param {string} actorId
 * @param {number} level the character's level now
 */
export function repeatLocked(lock, actorId, level) {
  const failedAt = Number(lock?.[actorId]);
  if (!Number.isFinite(failedAt)) return false;
  return Number(level) <= failedAt;
}

/** Record a failed hasty attempt. Returns a NEW lock; the input is not touched. */
export function lockAfterFailure(lock, actorId, level) {
  const failedAt = Number(lock?.[actorId]);
  const now = Number(level) || 1;
  // Keeps the highest level failed at.
  return { ...(lock ?? {}), [actorId]: Number.isFinite(failedAt) ? Math.max(failedAt, now) : now };
}

/* -------------------------------------------- */
/*  What it does when it goes off               */
/* -------------------------------------------- */

/**
 * The damage a fall into this pit deals: dice by the depth fallen (the
 * imported `fall` figures), and the spikes at the bottom if it has them, each
 * spike its own damage die.
 *
 * `formula` is null for a pit with no depth and for a depth under one die's
 * feet. `unknown` names what the world does not hold: `fall` when no fall
 * figures are imported (no formula at all), `spikes` when a spiked pit has no
 * spike figures (the fall's dice alone).
 *
 * @param {number} depthFeet
 * @param {boolean} [spiked]
 * @param {object} [figures] `pitFigures()`, injectable
 * @returns {{formula: string|null, unknown: string[]}}
 */
export function pitDamage(depthFeet, spiked = false, { fall, spike } = pitFigures()) {
  const depth = Number(depthFeet);
  if (!(depth > 0)) return { formula: null, unknown: [] };
  if (!fall) return { formula: null, unknown: ["fall"] };
  const dice = Math.floor(depth / fall.feetPerDie) * fall.count;
  if (dice < 1) return { formula: null, unknown: [] };
  const parts = [`${dice}d${fall.faces}`];
  const unknown = [];
  if (spiked) {
    // A nested count `(N)dX`, never a product. See docs/formation/DECISIONS.md,
    // "A pit's spikes are a nested dice count, not a product".
    if (spike) parts.push(`(${spike.count})d${spike.faces}`);
    else unknown.push("spikes");
  }
  return { formula: parts.join(" + "), unknown };
}

/** The formula alone of `pitDamage`. */
export const pitDamageFormula = (depthFeet, spiked = false, figures = pitFigures()) => pitDamage(depthFeet, spiked, figures).formula;

/**
 * What a trap firing asks of one victim, before any of it is rolled.
 *
 * The one place that applies what a crude trap is worth. `attackThrow` is
 * supplied by the Judge, not derived from a level, and combines with the
 * victim's AC as every attack throw does.
 *
 * @param {object} [o.pit] `pitFigures()`, injectable
 * @returns {{resolution: string, saveKey: string|null, saveBonus: number,
 *   attackThrow: number|null, attackModifier: number, formula: string|null,
 *   pitUnknown: string[]}} `pitUnknown` is `pitDamage`'s `unknown`, empty where a
 *   typed formula or no pit stands in the way of the derivation
 */
export function firingPlan({
  resolution = RESOLUTIONS.automatic,
  saveKey = null,
  attackThrow = null,
  damageFormula = "",
  pitDepthFeet = 0,
  spiked = false,
  crude = false,
  onSuccess = ON_SUCCESS.half,
  pit = pitFigures(),
} = {}) {
  const typed = String(damageFormula ?? "").trim();
  const derived = typed ? { formula: null, unknown: [] } : pitDamage(pitDepthFeet, spiked, pit);
  return {
    resolution,
    saveKey: resolution === RESOLUTIONS.save ? saveKey || null : null,
    saveBonus: crude ? CRUDE.save : 0,
    attackThrow: resolution === RESOLUTIONS.attack ? (Number(attackThrow) || 0) : null,
    attackModifier: crude ? CRUDE.attack : 0,
    // A missed attack deals nothing, so `onSuccess` governs only the save case.
    onSuccess: resolution === RESOLUTIONS.attack ? ON_SUCCESS.none : onSuccess,
    // A typed formula wins; the pit derivation is the fallback.
    formula: typed || derived.formula,
    pitUnknown: derived.unknown,
  };
}
