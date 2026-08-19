import { ROLES } from "./constants.mjs";

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
 * when it fires; a pit deals its depth in dice. The eleven worked traps the
 * Judge's book prints — their damage by level, their areas, their riders — are
 * book content with an owner, and none of them is here. A Judge types the
 * formula their own trap deals, the same way the obstacle helper knows the
 * shape of a climb without knowing any particular cliff.
 */

/** A rank of the marching order is one 5' square of corridor. */
export const FEET_PER_RANK = 5;

/**
 * How far the automatic hasty search reaches — one square, or two with a pole.
 *
 * A thief moving at exploration speed throws against any hidden feature he
 * passes within reach of, whether or not the party was walking into it. That is
 * why these are reaches and not "the trap in the way": the sweep is what finds
 * the pit beside the corridor, and the corridor is what the party is looking at.
 *
 * Expressed as squares rather than as printed distances because that is what
 * they are: the same square a rank occupies, and the pole's extra one.
 */
export const SEARCH_REACH_FEET = FEET_PER_RANK;
export const POLE_REACH_FEET = FEET_PER_RANK * 2;

/**
 * How far a character can reach the trap they are working on.
 *
 * The combat action list gives Hastily Trapbreak as "within 5' of the
 * combatant", and nothing about the methodical column says otherwise — a thief
 * disabling a trap is kneeling at it.
 */
export const TRAPBREAK_REACH_FEET = FEET_PER_RANK;

/** The trigger die. 1–`triggerOn` springs it; the Judge may widen or narrow. */
export const TRIGGER_DIE = 6;
export const TRIGGER_DEFAULT = 2;

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
 * decay without an hour of upkeep a day; that is a Judge's clock, not a throw,
 * and nothing here pretends to keep it.)
 */
export const CRUDE = Object.freeze({ find: 4, remove: 4, attack: -2, save: 2 });

/** The unmodified die at or below which a Trapbreaking throw goes wrong. */
export const BOTCH_BANDS = Object.freeze({ hasty: 3, methodical: 1 });

/* -------------------------------------------- */
/*  Who walks into it                           */
/* -------------------------------------------- */

/**
 * The order in which the party presents itself to a trap, front first.
 *
 * A 10' pole is an extra probe, not a modifier: the book counts it as an
 * adventurer moving 5' ahead of its bearer, so it enters the sequence one rank
 * further forward than the person holding it and is thrown for separately. That
 * is the whole value of carrying one — the pole meets the pressure plate while
 * its bearer is still a square back.
 *
 * Where a pole and a body reach the same square the BODY goes first: someone
 * already walking that ground got there before a pole was waved over it. The
 * pole still throws separately — the Judge may roll many times — but what it
 * buys is untrodden ground ahead of the column, not precedence over a man
 * standing in the square already.
 *
 * **Within a rank the order is shuffled.** Men marching abreast step onto the
 * same ground at the same moment, and each still throws separately — that much
 * is the book's ("you might secretly roll many times"). What is not the book's
 * is deciding that the leftmost of them always goes first: the sequence ends at
 * the throw that springs the trap, so a fixed file order makes whoever stands
 * in file 0 spring every trap in the dungeon. The shuffle is per rank, so ranks
 * still meet the trap front to back.
 *
 * @param {object[]} order rows from `marchingOrder()`
 * @param {object} [opts]
 * @param {boolean} [opts.pole] may poles probe at all? False at combat speed,
 *   which loses the 10' pole along with mapping and the hasty search.
 * @param {() => number} [opts.random] the source of the shuffle, injected so
 *   the sequence can be pinned in a test without pinning the bias back in.
 * @returns {Array<{kind: "body"|"pole", actorId: string, name: string|null,
 *   rank: number, file: number, reach: number}>}
 */
export function probeSequence(order, { pole = true, random = Math.random } = {}) {
  const probes = [];
  for (const row of order ?? []) {
    const base = { actorId: row.actorId, name: row.name ?? null, rank: row.rank, file: row.file };
    probes.push({ ...base, kind: "body", reach: row.rank });
    if (pole && (row.roles ?? []).includes(ROLES.POLE)) {
      probes.push({ ...base, kind: "pole", reach: row.rank - 1 });
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

/**
 * Who the trap catches, given which probe set it off.
 *
 * Two rules, because the book's traps come in two kinds. A needle or a pit
 * takes whoever touched it. A collapsing ceiling, a scything blade or a rolling
 * rock takes everything within reach of where it went off, which in a column
 * means a run of ranks either side.
 *
 * **A pole-sprung trap catches nobody within its own square**, and that is the
 * point of the pole rather than an edge case: the trap fires 5' ahead of the
 * party into empty corridor. An area effect still reaches back for the bearer
 * if its radius is long enough, which is why the pole is protection and not
 * immunity.
 *
 * @param {object[]} probes from `probeSequence`
 * @param {number} index which probe sprang it
 * @param {object} [opts]
 * @param {string} [opts.scope] one of `SCOPES`
 * @param {number} [opts.radiusFeet] how far an area effect reaches
 * @returns {object[]} the probes' bodies that are caught, front to back
 */
export function victimsOf(probes, index, { scope = SCOPES.triggerer, radiusFeet = 0 } = {}) {
  const sprung = probes?.[index];
  if (!sprung) return [];
  const bodies = (probes ?? []).filter((p) => p.kind === "body");

  if (scope !== SCOPES.area) {
    // The pole took it, so the corridor took it.
    if (sprung.kind === "pole") return [];
    return bodies.filter((p) => p.actorId === sprung.actorId && p.rank === sprung.rank);
  }

  const ranksReached = Math.floor(Math.max(0, radiusFeet) / FEET_PER_RANK);
  return bodies.filter((p) => Math.abs(p.rank - sprung.reach) <= ranksReached);
}

/** Did the trigger die spring it? */
export function triggerFires(die, triggerOn = TRIGGER_DEFAULT) {
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
 * adds four for a skilled thief, and may be repeated after a failure. Hasty may
 * not: a thief who fails a hasty attempt has learned everything they are going
 * to learn about this trap until they gain a level.
 *
 * @param {object} o
 * @param {"hasty"|"methodical"} o.mode
 * @param {boolean} [o.crude] a crudely built trap, +4 to remove
 * @param {boolean} [o.skilled] resolving through a real Trapbreaking skill
 *   rather than through the Adventuring proficiency
 * @param {number} [o.extra] the Judge's own modifier
 * @returns {{mode: string, bonus: number, parts: object[], botchBand: number,
 *   repeatable: boolean, adventuringAllowed: boolean}}
 */
export function disarmPlan({ mode = "methodical", crude = false, skilled = true, extra = 0 } = {}) {
  const methodical = mode === "methodical";
  const parts = [];
  const push = (value, key) => {
    if (value) parts.push({ value, key });
  };
  // The book's +4 is the SKILL used methodically. A non-thief working through
  // Adventuring is already being given a target they would not otherwise have,
  // and does not also collect the skilled thief's bonus.
  push(methodical && skilled ? 4 : 0, "methodical");
  push(crude ? CRUDE.remove : 0, "crude");
  push(extra, "judge");
  return {
    mode,
    bonus: parts.reduce((sum, p) => sum + p.value, 0),
    parts,
    botchBand: methodical ? BOTCH_BANDS.methodical : BOTCH_BANDS.hasty,
    repeatable: methodical,
    // "Using Adventuring: not permitted" on the hasty column.
    adventuringAllowed: methodical,
  };
}

/** Did the throw go wrong badly enough to spring the thing being disarmed? */
export function isBotch(natural, mode = "methodical") {
  const band = mode === "hasty" ? BOTCH_BANDS.hasty : BOTCH_BANDS.methodical;
  return Number.isFinite(natural) && natural >= 1 && natural <= band;
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
 * The damage a fall into this pit deals: a d6 per 10' fallen, and the spikes at
 * the bottom if it has them (1d4 of them, 1d6 each).
 *
 * Returns null rather than "0" for a pit with no depth — a trap that is not a
 * pit has no pit damage, which is not the same as a pit that does nothing.
 */
export function pitDamageFormula(depthFeet, spiked = false) {
  const dice = Math.floor(Number(depthFeet) / 10);
  if (!Number.isFinite(dice) || dice < 1) return null;
  // `(1d4)d6`, not `1d4 * 1d6`: the book impales the victim on 1d4 spikes
  // dealing 1d6 EACH, which is that many separate dice. Multiplying one d6
  // instead has a different spread — flatter, and four times as swingy at the
  // top. Foundry's parser resolves the nested count first, so this is exactly
  // the rule and not an approximation of it.
  return spiked ? `${dice}d6 + (1d4)d6` : `${dice}d6`;
}

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
 * @returns {{resolution: string, saveKey: string|null, saveBonus: number,
 *   attackThrow: number|null, attackModifier: number, formula: string|null}}
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
} = {}) {
  const typed = String(damageFormula ?? "").trim();
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
    formula: typed || pitDamageFormula(pitDepthFeet, spiked),
  };
}
