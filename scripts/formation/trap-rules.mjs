import { ROLES, diceFormula, formationValue } from "./constants.mjs";
import { fallFigures } from "./jumping.mjs";

/**
 * Traps, as arithmetic — no dice, no documents, no Foundry.
 *
 * Everything here answers a question the Judge could answer with the book open:
 * who walks into the thing first, who is caught when it goes off, what the
 * disarm throw is before anyone rolls it, and whether a thief is allowed to try
 * again. `trap-zone.mjs` supplies the dice and the world; this file is the rule.
 *
 * **What is here and what is not.** The MECHANISMS are the rule itself and are
 * written down: a trap resolves as a saving throw, an attack throw, or damage
 * with no throw at all; a crude one is easier to find and remove and weaker
 * when it fires; a pit deals its depth in dice. The worked traps the Judge's
 * book prints — their damage by level, their areas, their riders — are book
 * content with an owner, and none of them is here. A Judge types the formula
 * their own trap deals, the same way the obstacle helper knows the shape of a
 * climb without knowing any particular cliff.
 *
 * **Every distance and die is read, never held.** The search and pole reaches,
 * the pole's lead, the trigger die and its band, the trapbreak reach, the botch
 * bands, the methodical bonus and the pit's dice arrive in the `formation`
 * registered document (`trapFigures`, `pitFigures`); a figure not imported
 * reads null and each consumer says what it does without it. A rank's depth
 * is the laid column's (`laidOrder`), else the scene's cell.
 */

/** A figure as a positive length or count, or null. */
const positive = (value) => {
  const n = Number(value);
  return value != null && value !== "" && Number.isFinite(n) && n > 0 ? n : null;
};

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
    searchFeet: positive(formationValue("searchReachFeet")),
    poleSearchFeet: positive(formationValue("poleSearchReachFeet")),
    poleLeadFeet: positive(formationValue("poleLeadFeet")),
    triggerFaces: faces(formationValue("trapTriggerDie")),
    triggerOn: whole(formationValue("trapTriggerOn")),
    trapbreakReachFeet: positive(formationValue("trapbreakReachFeet")),
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

/**
 * How a trap resolves once it goes off. Every trap the Judge's book works
 * through is exactly one of these.
 */
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

/**
 * What beating the trap's throw is worth to the victim.
 *
 * The book's traps do not agree on this and the difference is the whole
 * outcome: a ceiling collapse halves on a made save, a deadfall is dodged
 * outright, one fire trap deals a smaller die instead, and a portcullis grants
 * a choice of which side you land on rather than any mitigation at all. A model
 * with no field for it can only report the throw and the damage side by side
 * and leave the reader to guess whether one affected the other.
 */
export const ON_SUCCESS = Object.freeze({
  /** Half damage, rounded down. The commonest. */
  half: "half",
  /** Nothing at all — dodged, avoided, missed. */
  none: "none",
  /** The throw changes nothing about the damage; the rider is the point. */
  full: "full",
});

/** 1st through 6th: the levels the books print every trap at. */
export const TRAP_LEVELS = 6;

/**
 * One level of a trap with nothing said about it yet.
 *
 * Rows are allowed to be empty — a Judge inventing a trap for one level owes
 * nothing for the other five — so the shape has to exist independently of any
 * row being filled. Lives here rather than on the data model because the sheet
 * and the offline tests both need it without Foundry.
 */
/**
 * The six rows a trap should hold after a sheet submit that rendered ONE of
 * them.
 *
 * Foundry expands the form's dotted index paths into an array built only from
 * the paths the form named: every row below the edited index arrives as an
 * empty default and every row above it is simply absent. Writing that through
 * replaces the whole trap with its one edited level. So the answer is rebuilt
 * from what is STORED, and exactly one index is taken from the submit.
 *
 * Lives here, Foundry-free, so the rule is unit-tested rather than only
 * reachable by opening a sheet.
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
 * A crudely built trap: easier to find and remove, feebler when it fires.
 *
 * One modifier set covers every crude trap, which is why it is a checkbox on
 * the zone rather than a trap kind of its own. (The book also has a crude trap
 * decay without daily upkeep (JJ p. 238); that is a Judge's clock, not a throw,
 * and nothing here pretends to keep it.)
 */
export const CRUDE = Object.freeze({ find: 4, remove: 4, attack: -2, save: 2 });

/* -------------------------------------------- */
/*  Who walks into it                           */
/* -------------------------------------------- */

/**
 * The order in which the party presents itself to a trap, front first.
 *
 * A pole is an extra probe, not a modifier: the book counts it as an
 * adventurer moving ahead of its bearer by the pole's lead (`poleRanks`, the
 * imported lead in ranks), so it enters the sequence that far forward of the
 * person holding it and is thrown for separately. That is the whole value of
 * carrying one — the pole meets the pressure plate while its bearer is still
 * back.
 *
 * Where a pole and a body reach the same square the BODY goes first: someone
 * already walking that ground got there before a pole was waved over it. The
 * pole still throws separately — the Judge may roll many times — but what it
 * buys is untrodden ground ahead of the column, not precedence over a man
 * standing in the square already.
 *
 * **Within a rank the order is shuffled.** Men marching abreast step onto the
 * same ground at the same moment, and each still throws separately — that much
 * is the book's (RR p. 267). What is not the book's
 * is deciding that the leftmost of them always goes first: the sequence ends at
 * the throw that springs the trap, so a fixed file order makes whoever stands
 * in file 0 spring every trap in the dungeon. The shuffle is per rank, so ranks
 * still meet the trap front to back.
 *
 * @param {object[]} order rows in `marchingOrder()`'s shape
 * @param {object} [opts]
 * @param {boolean} [opts.pole] may poles probe at all? False at combat speed,
 *   which loses the pole along with mapping and the hasty search.
 * @param {number|null} [opts.poleRanks] how many ranks ahead of its bearer a
 *   pole probes (the imported lead over a rank's depth, `poleLeadRanks`); null
 *   where either is not known, and no pole probes.
 * @param {() => number} [opts.random] the source of the shuffle, injected so
 *   the sequence can be pinned in a test without pinning the bias back in.
 * @returns {Array<{kind: "body"|"pole", actorId: string, name: string|null,
 *   rank: number, file: number, reach: number}>}
 */
export function probeSequence(order, { pole = true, poleRanks = null, random = Math.random } = {}) {
  const probes = [];
  const lead = positive(poleRanks);
  for (const row of order ?? []) {
    const base = { actorId: row.actorId, name: row.name ?? null, rank: row.rank, file: row.file };
    probes.push({ ...base, kind: "body", reach: row.rank });
    if (pole && lead !== null && (row.roles ?? []).includes(ROLES.POLE)) {
      probes.push({ ...base, kind: "pole", reach: row.rank - lead });
    }
  }

  // Group by the square each probe reaches, shuffle inside the group, then lay
  // the groups out front to back. A body still precedes a pole waved into the
  // same square — someone standing there got there first — so the shuffle runs
  // within a kind, not across the two.
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

/** The depth of one rank in feet: `rankFeet` where it is a length, else null (nothing says how deep a rank stands). */
export function rankDepth(rankFeet) {
  return positive(rankFeet);
}

/**
 * How many ranks a pole probes ahead of its bearer: the imported lead over how
 * deep a rank stands. Null when either is not known.
 */
export function poleLeadRanks(poleLeadFeet, rankFeet) {
  const lead = positive(poleLeadFeet);
  const depth = rankDepth(rankFeet);
  return lead !== null && depth !== null ? lead / depth : null;
}

/**
 * How far ahead of the party token this searcher's own reach extends, in feet.
 *
 * The reach belongs to the CHARACTER and the distance is measured from the
 * party token, so the searcher's own place in the column is subtracted: a
 * pole-bearer stands back by its rank times the rank's depth. A pole with no
 * imported reach is a plain searcher. Null where the searcher's reach cannot be
 * stated: the search reach is not imported, or the searcher stands behind the
 * front rank and no depth says how far back.
 *
 * @param {object} row a marching-order row
 * @param {object} figures
 * @param {number|null} figures.searchFeet the bare search reach
 * @param {number|null} figures.poleSearchFeet the search reach with a pole
 * @param {number|null} figures.rankFeet how deep one rank stands
 * @returns {number|null}
 */
export function searcherReachFeet(row, { searchFeet = null, poleSearchFeet = null, rankFeet = null } = {}) {
  const bare = positive(searchFeet);
  if (bare === null) return null;
  const own = (row.roles ?? []).includes(ROLES.POLE) ? (positive(poleSearchFeet) ?? bare) : bare;
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
 * Two rules, because the book's traps come in two kinds. A needle or a pit
 * takes whoever touched it. A collapsing ceiling, a scything blade or a rolling
 * rock takes everything within reach of where it went off, which in a column
 * means a run of ranks either side.
 *
 * **A pole-sprung trap catches nobody within its own square**, and that is the
 * point of the pole rather than an edge case: the trap fires a lead ahead of
 * the party into empty corridor. An area effect still reaches back for the bearer
 * if its radius is long enough, which is why the pole is protection and not
 * immunity.
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
    // The pole took it, so the corridor took it.
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
 * The Trapbreaking throw, itemized before it is rolled — the same courtesy the
 * door helper pays a bash, and for the same reason: a player deciding whether
 * to spend a turn on this should see what they are buying.
 *
 * Hasty and methodical differ in more than the bonus. Methodical takes a turn
 * instead of a round, permits a non-thief to try at all through Adventuring,
 * adds the imported bonus for a skilled thief, and may be repeated after a
 * failure. Hasty may not: a thief who fails a hasty attempt has learned
 * everything they are going to learn about this trap until they gain a level.
 * A bonus or a botch band that is not imported contributes nothing (RR ch. 6,
 * Traps and Trapbreaking).
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
  // The methodical bonus is the SKILL's, used methodically. A non-thief working
  // through Adventuring is already being given a target they would not
  // otherwise have, and does not also collect the skilled thief's bonus.
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
 * A failed hasty attempt is remembered against the LEVEL it failed at, not as a
 * plain "no": the rule reopens when the thief has grown, and a lock that could
 * not say when would either bar them forever or forget by morning.
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
  // Keep the HIGHEST level failed at: a thief who somehow tried again and
  // failed harder should not have the door reopened by the earlier attempt.
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
 * `formula` is null rather than "0" for a pit with no depth — a trap that is
 * not a pit has no pit damage, which is not the same as a pit that does
 * nothing — and null for a depth under one die's feet. `unknown` names what
 * the pit needs and the world does not hold: `fall` when no fall figures are
 * imported (no formula at all), `spikes` when a spiked pit has no spike figures
 * (the fall's dice alone).
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
    // A nested count, not a product: the victim lands on a rolled number of
    // spikes that each deal their own damage, which is that many separate dice.
    // Multiplying one die by the count instead has a different spread — flatter,
    // and far swingier at the top. Foundry's parser resolves the nested count
    // first, so this is exactly the rule and not an approximation of it.
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
 * The save bonus and attack penalty a crude trap grants are applied here rather
 * than at each call site, so the one place that knows a trap is crude is the
 * one place that knows what crude is worth.
 *
 * `attackThrow` is the number the Judge's own book gives for a fighter of the
 * trap's level — "attacks as a 3rd level fighter" is a lookup in a table this
 * module does not hold, so the Judge supplies its answer rather than a level
 * for the module to convert. It is combined with the victim's AC the way every
 * ACKS attack throw is: `1d20 + modifiers ≥ attackThrow + AC`.
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
    // What beating the throw is worth. An ATTACK that misses is always nothing
    // — a bolt that did not hit deals no damage, whatever the trap says about
    // saves — so the field only governs the save case.
    onSuccess: resolution === RESOLUTIONS.attack ? ON_SUCCESS.none : onSuccess,
    // A typed formula is the Judge's own trap and wins; the pit derivation is
    // the fallback for the one trap whose damage the rule itself states.
    formula: typed || derived.formula,
    pitUnknown: derived.unknown,
  };
}
