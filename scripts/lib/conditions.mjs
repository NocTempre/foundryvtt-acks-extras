/**
 * Conditions (RR 507-515, Appendix B): the catalogue, and the math it performs.
 *
 * What ships is the PROCEDURE — which conditions exist, what each carries with
 * it, what it takes away, which rolls it reaches, whose roll that is, and how
 * two of them combine. Every size is printed: it arrives through the
 * `conditions` registered document and is read here by slot name. A slot
 * nothing registered contributes nothing and is reported in `unpriced`, so an
 * unimported world toggles conditions and applies no invented figure.
 *
 * A creature either has a condition or does not (RR 507): every reader here
 * takes the SET of a creature's conditions, closed under `implies`, so two
 * effects naming one condition count once. The exceptions are the rows marked
 * `per`, where the rule itself counts causes.
 *
 * Foundry-free: the status-effect registration and the roll seams are
 * `status-effects.mjs`.
 */
import { MODULE_ID } from "./constants.mjs";
import { getDoc, hasDoc } from "./tables.mjs";
import { numOrNull } from "./util.mjs";

/** The registered document the modifier sizes are read from. */
export const CONDITIONS_DOC = "conditions";

/** That document's one table: `{ <condition>: { <slot>: figure } }`. */
export const CONDITIONS_TABLE = "modifiers";

/**
 * What a condition can take away. `act` is every action at once; the rest are
 * the single things a rule withholds while leaving the others.
 */
export const ACTS = Object.freeze([
  "act", "attack", "missile", "cast", "move", "speak", "run", "charge", "forceMarch", "naturalHealing",
]);

/** The three ways an attack throw is made, as a modifier's `scope` names them. */
export const ATTACK_KINDS = Object.freeze(["melee", "missile", "thrown"]);

const MELEE = Object.freeze(["melee"]);
const MELEE_THROWN = Object.freeze(["melee", "thrown"]);

/**
 * One row per roll a condition reaches.
 *
 *  - `on`     the roll: `attack`, `damage`, `ac`, `save`, `throw`, `morale`,
 *             `surprise`, or the multipliers `damageFactor` / `speedFactor`.
 *  - `slot`   the figure's key in the registered row.
 *  - `side`   `against` when the figure belongs to whoever attacks the
 *             creature; absent when it is the creature's own roll.
 *  - `scope`  the attack kinds it reaches; absent for all three.
 *  - `per`    `stack` multiplies by the number of causes, `extraCause` by the
 *             causes past the first.
 *  - `when`   `source`: only against what imposed the condition. Any other
 *             value names a circumstance no roll can see (`fear`, `sight`,
 *             `voice`) and is returned as pending rather than applied.
 *  - `unless` a condition on the same creature that supersedes this row.
 */
const row = (on, slot, extra = {}) => Object.freeze({ on, slot, ...extra });

/**
 * The conditions, keyed by status id. `surprised` and `slumbering` are the
 * system's own ids for the same two conditions.
 *
 *  - `implies`  conditions the creature also has while it has this one.
 *  - `forbids`  members of `ACTS`.
 *  - `shuts`    conditions this one makes the creature immune to.
 *  - `exposes`  a condition the creature's TARGET counts as having.
 *  - `ends`     `turn` (the creature's next initiative) or `combat` — when
 *               the tracker lifts it. The system lifts `surprised` itself.
 *  - `shields`  attack kinds that cannot be made against the creature.
 *  - `autoHit`  attack kinds that need no throw against it, from an attacker
 *               its size or larger.
 *  - `noMorale` the creature never checks morale.
 */
export const CONDITIONS = Object.freeze({
  beholding: { label: "Beholding", img: "icons/svg/eye.svg" },
  berserk: {
    label: "Berserk", img: "icons/svg/combat.svg",
    shuts: ["cowering", "faltering", "frightened"], noMorale: true, ends: "combat",
    mods: [row("attack", "attack", { scope: MELEE_THROWN }), row("ac", "ac")],
  },
  bewitched: { label: "Bewitched", img: "icons/svg/heal.svg" },
  blessed: {
    label: "Blessed", img: "icons/svg/angel.svg",
    mods: [row("attack", "all"), row("ac", "all"), row("morale", "all"), row("save", "all", { when: "fear" })],
  },
  blinded: {
    label: "Blinded", img: "icons/svg/blind.svg", forbids: ["missile"],
    mods: [
      row("surprise", "surprise"), row("attack", "attack", { scope: MELEE }),
      row("throw", "proficiency", { when: "sight" }), row("speedFactor", "speedFactor"),
    ],
  },
  burning: { label: "Burning", img: "icons/svg/fire.svg" },
  charging: {
    label: "Charging", img: "icons/svg/thrust.svg", implies: ["disordered"], ends: "turn",
    mods: [row("attack", "attack", { scope: MELEE })],
  },
  choking: { label: "Choking / Vomiting", img: "icons/svg/acid.svg", forbids: ["act", "speak"] },
  clambering: {
    label: "Clambering", img: "icons/svg/ladder.svg", exposes: "vulnerable",
    mods: [row("attack", "attack", { when: "source" }), row("attack", "against", { side: "against", when: "source" })],
  },
  concentrating: { label: "Concentrating", img: "icons/svg/aura.svg" },
  concentratingStationary: {
    label: "Concentrating and Stationary", img: "icons/svg/obelisk.svg",
  },
  cowering: { label: "Cowering", img: "icons/svg/cowled.svg", implies: ["vulnerable"], forbids: ["act"] },
  deafened: {
    label: "Deafened", img: "icons/svg/deaf.svg",
    mods: [row("surprise", "surprise"), row("throw", "proficiency", { when: "voice" })],
  },
  dehydrated: {
    label: "Dehydrated", img: "icons/svg/sun.svg", forbids: ["forceMarch", "naturalHealing"],
  },
  // `diseased` and `frostbitten` are marks the weather leaves (RR 277-279), not
  // Appendix B entries: they carry no figures and forbid nothing, and name a
  // body the Judge resolves from the book.
  diseased: { label: "Diseased", img: "icons/svg/pill.svg" },
  disfavored: { label: "Disfavored", img: "icons/svg/holy-shield.svg" },
  disordered: { label: "Disordered", img: "icons/svg/downgrade.svg", ends: "turn", mods: [row("ac", "ac")] },
  dominated: { label: "Dominated", img: "icons/svg/direction.svg" },
  drowning: {
    label: "Drowning", img: "icons/svg/waterfall.svg", implies: ["vulnerable"], forbids: ["act"],
  },
  enervated: { label: "Enervated", img: "icons/svg/degen.svg" },
  engaged: { label: "Engaged", img: "icons/svg/sword.svg", forbids: ["charge"] },
  enlarged: { label: "Enlarged", img: "icons/svg/up.svg", mods: [row("attack", "attack", { scope: MELEE })] },
  enslaved: { label: "Enslaved", img: "icons/svg/anchor.svg" },
  enthralled: { label: "Enthralled", img: "icons/svg/wing.svg", forbids: ["attack", "cast", "speak"] },
  faltering: {
    label: "Faltering", img: "icons/svg/leg.svg",
    mods: [
      row("attack", "all", { when: "source" }), row("throw", "all", { when: "source" }),
      row("save", "all", { when: "source" }),
    ],
  },
  fatigued: {
    label: "Fatigued", img: "icons/svg/clockwork.svg",
    mods: [
      row("attack", "all", { per: "stack" }), row("throw", "all", { per: "stack" }),
      row("save", "all", { per: "stack" }), row("damage", "all", { per: "stack" }),
    ],
  },
  flanked: {
    label: "Flanked", img: "icons/svg/target.svg",
    mods: [row("attack", "against", { side: "against", unless: "vulnerable" })],
  },
  forgetful: { label: "Forgetful", img: "icons/svg/light-off.svg" },
  frightened: { label: "Frightened", img: "icons/svg/terror.svg", forbids: ["attack", "cast", "speak"] },
  frostbitten: { label: "Frostbitten", img: "icons/svg/ice-aura.svg" },
  grabbed: {
    label: "Grabbed", img: "icons/svg/pawprint.svg", implies: ["vulnerable"], forbids: ["attack", "cast", "move"],
  },
  helpless: { label: "Helpless", img: "icons/svg/trap.svg", implies: ["vulnerable"], forbids: ["act"], autoHit: MELEE },
  hidden: {
    label: "Hidden", img: "icons/svg/mystery-man.svg", shields: ["missile", "thrown"],
    mods: [row("attack", "against", { side: "against", scope: MELEE })],
  },
  hungry: {
    label: "Hungry", img: "icons/svg/tankard.svg",
    mods: [row("attack", "all"), row("throw", "all"), row("save", "all")],
  },
  hypothermic: {
    label: "Hypothermic", img: "icons/svg/frozen.svg", forbids: ["forceMarch", "naturalHealing"],
  },
  immune: { label: "Immune", img: "icons/svg/shield.svg" },
  incapacitated: {
    label: "Incapacitated", img: "icons/svg/blood.svg", forbids: ["attack", "cast", "run", "forceMarch"],
    mods: [row("speedFactor", "speedFactor")],
  },
  infuriated: {
    label: "Infuriated", img: "icons/svg/explosion.svg", shuts: ["cowering", "frightened"], noMorale: true, forbids: ["speak"],
    mods: [row("attack", "attack"), row("ac", "ac")],
  },
  inspired: {
    label: "Inspired", img: "icons/svg/sound.svg",
    mods: [row("attack", "all"), row("ac", "all"), row("morale", "all"), row("save", "all", { when: "fear" })],
  },
  mad: { label: "Mad", img: "icons/svg/card-joker.svg" },
  mesmerized: { label: "Mesmerized", img: "icons/svg/daze.svg", implies: ["mute"], forbids: ["act"] },
  mute: { label: "Mute", img: "icons/svg/silenced.svg", forbids: ["speak", "cast"] },
  paralyzed: { label: "Paralyzed", img: "icons/svg/paralysis.svg", implies: ["helpless", "mute"] },
  petrified: { label: "Petrified", img: "icons/svg/statue.svg", implies: ["helpless"] },
  prone: {
    label: "Prone", img: "icons/svg/falling.svg", implies: ["vulnerable"], forbids: ["run", "charge"],
    mods: [row("attack", "attack")],
  },
  queasy: {
    label: "Queasy", img: "icons/svg/poison.svg",
    mods: [row("attack", "all"), row("throw", "all"), row("damage", "all")],
  },
  resistant: { label: "Resistant", img: "icons/svg/mage-shield.svg" },
  restrained: {
    label: "Restrained", img: "icons/svg/padlock.svg", implies: ["vulnerable"], forbids: ["move"],
    mods: [row("attack", "perCause", { per: "extraCause" })],
  },
  shaken: {
    label: "Shaken", img: "icons/svg/lightning.svg",
    mods: [row("attack", "all"), row("ac", "all"), row("morale", "all"), row("save", "all", { when: "fear" })],
  },
  shrunk: {
    label: "Shrunk", img: "icons/svg/down.svg",
    mods: [row("attack", "attack", { scope: MELEE }), row("damageFactor", "damageFactor")],
  },
  slumbering: {
    label: "Slumbering", img: "icons/svg/sleep.svg", implies: ["helpless", "blinded", "deafened", "mute"],
  },
  sneaking: { label: "Sneaking", img: "icons/svg/mole.svg" },
  starving: {
    label: "Starving", img: "icons/svg/bones.svg", implies: ["hungry"],
    forbids: ["forceMarch", "naturalHealing"],
  },
  stuck: { label: "Stuck", img: "icons/svg/cave.svg", implies: ["vulnerable"], forbids: ["attack", "cast", "move"] },
  subjacent: {
    label: "Subjacent", img: "icons/svg/mountain.svg", mods: [row("attack", "against", { side: "against" })],
  },
  surprised: {
    label: "Surprised", img: "systems/acks/assets/icons/surprised.svg", implies: ["vulnerable"],
    forbids: ["act"],
  },
  unconscious: {
    label: "Unconscious", img: "icons/svg/unconscious.svg",
    implies: ["helpless", "blinded", "deafened", "mute"],
  },
  underfed: {
    label: "Underfed", img: "icons/svg/barrel.svg", implies: ["hungry"],
    forbids: ["forceMarch", "naturalHealing"],
  },
  vexed: { label: "Vexed", img: "icons/svg/biohazard.svg" },
  vulnerable: {
    label: "Vulnerable", img: "icons/svg/hazard.svg", mods: [row("attack", "against", { side: "against" })],
  },
  webbed: {
    label: "Webbed", img: "icons/svg/net.svg", implies: ["vulnerable"], forbids: ["move"],
    mods: [row("attack", "perCause", { per: "extraCause" })],
  },
  winded: { label: "Winded", img: "icons/svg/walk.svg", forbids: ["run", "charge"] },
  wrestled: {
    label: "Wrestled", img: "icons/svg/stoned.svg", implies: ["vulnerable"], forbids: ["attack", "cast", "move"],
  },
});

/** Every condition key, in catalogue order. */
export const CONDITION_IDS = Object.freeze(Object.keys(CONDITIONS));

/**
 * The slots each condition's registered row is read by — the contract the
 * importer's binding fills. Derived from the catalogue, so a row added there
 * is asked for here without a second list.
 */
export const CONDITION_SLOTS = Object.freeze(
  Object.fromEntries(
    Object.entries(CONDITIONS)
      .filter(([, c]) => c.mods?.length)
      .map(([key, c]) => [key, Object.freeze([...new Set(c.mods.map((m) => m.slot))])]),
  ),
);

/**
 * The conditions a creature has, given the status ids on it: those ids that
 * name a condition, plus everything they imply, less whatever one of them
 * shuts out. Ids that name no condition are dropped.
 *
 * @param {Iterable<string>} statuses
 * @returns {Set<string>}
 */
export function conditionSet(statuses) {
  let seeds = [...new Set(statuses ?? [])].filter((s) => CONDITIONS[s]);
  // A shut-out condition takes what it implied with it, so the closure is
  // retaken from the seeds that survive rather than pruned in place.
  for (;;) {
    const out = closure(seeds);
    const shut = new Set([...out].flatMap((key) => CONDITIONS[key].shuts ?? []));
    const kept = seeds.filter((s) => !shut.has(s));
    if (kept.length === seeds.length) {
      for (const key of shut) out.delete(key);
      return out;
    }
    seeds = kept;
  }
}

/** `seeds` and everything they imply, in catalogue order so every reader lists them alike. */
function closure(seeds) {
  const found = new Set();
  const queue = [...seeds];
  while (queue.length) {
    const key = queue.pop();
    if (found.has(key)) continue;
    found.add(key);
    for (const implied of CONDITIONS[key].implies ?? []) queue.push(implied);
  }
  return new Set(CONDITION_IDS.filter((key) => found.has(key)));
}

/** The registered modifier rows, or an empty object when nothing is imported. */
export function conditionValues() {
  if (!hasDoc(CONDITIONS_DOC)) return {};
  return getDoc(CONDITIONS_DOC)?.tables?.[CONDITIONS_TABLE] ?? {};
}

/** True once any condition's figures are registered. */
export const conditionsReady = () => Object.keys(conditionValues()).length > 0;

/**
 * A subject as the readers below take it.
 *
 * @typedef {object} ConditionSubject
 * @property {Iterable<string>} statuses  status ids on the creature
 * @property {Record<string, number>} [counts]  causes per condition, where more than one
 * @property {Record<string, string[]>} [sources]  the origin uuid of each effect imposing a condition
 * @property {string} [id]  the creature's own uuid, matched against another's `sources`
 */

/** Flag key under `flags["acks-extras"]` on an effect: how many causes it stands for. */
export const STACKS_FLAG = "conditionStacks";

/**
 * An actor as a subject: its statuses, how many enabled effects carry each
 * condition, and where those effects came from. Null for no actor.
 *
 * @returns {ConditionSubject|null}
 */
export function subjectOf(actor) {
  if (!actor) return null;
  const counts = {};
  const sources = {};
  for (const effect of actor.appliedEffects ?? actor.effects ?? []) {
    if (effect?.disabled) continue;
    const stacks = Math.max(1, Math.floor(numOrNull(effect.flags?.[MODULE_ID]?.[STACKS_FLAG]) ?? 1));
    for (const status of effect.statuses ?? []) {
      if (!CONDITIONS[status]) continue;
      counts[status] = (counts[status] ?? 0) + stacks;
      if (effect.origin) (sources[status] ??= []).push(String(effect.origin));
    }
  }
  return { statuses: actor.statuses ?? [], counts, sources, id: actor.uuid ?? null };
}

const emptyMath = () => ({ total: 0, parts: [], pending: [], unpriced: [] });

/** How many times a `per` row counts. */
function multiplier(mod, key, subject) {
  const causes = Math.max(1, Math.floor(numOrNull(subject?.counts?.[key]) ?? 1));
  if (mod.per === "stack") return causes;
  if (mod.per === "extraCause") return causes - 1;
  return 1;
}

/**
 * Does a `when: "source"` row reach this opponent? With no source recorded it
 * does: a condition toggled by hand names nobody, and a row that then never
 * applied would be a condition with no effect.
 */
function reaches(key, subject, opponent) {
  const sources = subject?.sources?.[key];
  if (!sources?.length || !opponent?.id) return true;
  // An origin is the opponent itself or a document it holds.
  return sources.some((origin) => origin === opponent.id || origin.startsWith(`${opponent.id}.`));
}

/**
 * Walk one creature's rows for one roll, collecting what applies.
 *
 * @param {object} p
 * @param {Set<string>} p.set  the creature's conditions, already closed
 * @param {ConditionSubject} p.subject
 * @param {string} p.on  the roll
 * @param {"own"|"against"} p.side
 * @param {string} [p.kind]  the attack kind, for `scope`
 * @param {ConditionSubject} [p.opponent]  for `when: "source"`
 * @param {object} p.values  the registered rows
 * @param {object} p.out  `{parts, pending, unpriced}` appended to
 * @param {number} [p.sign]  -1 turns a figure on a creature's AC into one on its attacker's roll
 */
function collect({ set, subject, on, side, kind, opponent, values, out, sign = 1 }) {
  for (const key of set) {
    for (const mod of CONDITIONS[key].mods ?? []) {
      if (mod.on !== on) continue;
      if ((mod.side === "against") !== (side === "against")) continue;
      if (mod.scope && kind && !mod.scope.includes(kind)) continue;
      if (mod.unless && set.has(mod.unless)) continue;
      const figure = numOrNull(values?.[key]?.[mod.slot]);
      if (figure == null) {
        out.unpriced.push(key);
        continue;
      }
      const value = figure * multiplier(mod, key, subject) * sign;
      if (!value) continue;
      if (mod.when && mod.when !== "source") {
        out.pending.push({ condition: key, value, when: mod.when });
        continue;
      }
      // A source-bound row on a roll that names no opponent cannot be placed.
      if (mod.when === "source") {
        if (side !== "against" && !opponent && on !== "attack") {
          out.pending.push({ condition: key, value, when: "source" });
          continue;
        }
        if (!reaches(key, subject, opponent)) continue;
      }
      out.parts.push({ condition: key, value, side: side === "against" || sign < 0 ? "target" : "own" });
    }
  }
}

const total = (parts) => parts.reduce((sum, p) => sum + p.value, 0);

/** The conditions in `set` that take `act` away. */
export function forbiddenBy(set, act) {
  const out = [];
  for (const key of set) {
    const forbids = CONDITIONS[key].forbids ?? [];
    if (forbids.includes("act") || forbids.includes(act)) out.push(key);
  }
  return out;
}

/**
 * What the conditions on both sides do to one attack throw.
 *
 * The defender's own AC figures are returned as terms on the ATTACKER's roll,
 * sign reversed: a throw that must beat a lower AC and a throw with that much
 * added are the same throw, and a term carries the condition's name where a
 * moved AC would not.
 *
 * @param {object} p
 * @param {ConditionSubject} p.attacker
 * @param {ConditionSubject|null} [p.target]
 * @param {"melee"|"missile"|"thrown"} p.kind
 * @param {number|null} [p.attackerSize]  ordinal; with `targetSize`, decides `autoHit`
 * @param {number|null} [p.targetSize]
 * @param {object} [p.values]  the registered rows; the registry's when omitted
 * @returns {{terms: Array<{condition: string, value: number, side: "own"|"target"}>,
 *   damage: Array<{condition: string, value: number}>, damageFactor: number,
 *   damageFactorBy: string[], forbidden: string[], shielded: string[],
 *   autoHit: string|null, pending: object[], unpriced: string[]}} `autoHit` is
 *   the target's condition that waives the throw; `damageFactorBy` the
 *   attacker's conditions that scaled the damage.
 */
export function attackMath({ attacker, target = null, kind = "melee", attackerSize = null, targetSize = null, values = conditionValues() }) {
  const own = conditionSet(attacker?.statuses);
  const theirs = new Set(target ? conditionSet(target.statuses) : []);
  if (target) {
    for (const key of own) {
      if (CONDITIONS[key].exposes && reaches(key, attacker, target)) theirs.add(CONDITIONS[key].exposes);
    }
  }

  const out = { parts: [], pending: [], unpriced: [] };
  collect({ set: own, subject: attacker, on: "attack", side: "own", kind, opponent: target, values, out });
  if (target) {
    collect({ set: theirs, subject: target, on: "attack", side: "against", kind, opponent: attacker, values, out });
    collect({ set: theirs, subject: target, on: "ac", side: "own", values, out, sign: -1 });
  }

  const dmg = { parts: [], pending: [], unpriced: [] };
  collect({ set: own, subject: attacker, on: "damage", side: "own", values, out: dmg });
  const factor = { parts: [], pending: [], unpriced: [] };
  collect({ set: own, subject: attacker, on: "damageFactor", side: "own", values, out: factor });

  const act = kind === "melee" ? "attack" : "missile";
  const forbidden = [...new Set([...forbiddenBy(own, "attack"), ...forbiddenBy(own, act)])];
  const shielded = [...theirs].filter((key) => CONDITIONS[key].shields?.includes(kind));
  const sized = numOrNull(attackerSize) != null && numOrNull(targetSize) != null && attackerSize >= targetSize;
  const autoHit = sized ? ([...theirs].find((key) => CONDITIONS[key].autoHit?.includes(kind)) ?? null) : null;

  return {
    terms: out.parts,
    damage: dmg.parts.map(({ condition, value }) => ({ condition, value })),
    damageFactor: factor.parts.reduce((f, p) => f * p.value, 1),
    damageFactorBy: factor.parts.map((p) => p.condition),
    forbidden,
    shielded,
    autoHit,
    pending: out.pending,
    unpriced: [...new Set([...out.unpriced, ...dmg.unpriced, ...factor.unpriced])],
  };
}

/**
 * What a creature's conditions add to one of its own rolls: `save`, `throw`
 * (proficiency and adventuring), `morale` or `surprise`. A positive total
 * helps the roll. Rows bound to a circumstance the roll does not state are
 * returned in `pending`, unapplied.
 *
 * @param {"save"|"throw"|"morale"|"surprise"} on
 * @param {ConditionSubject} subject
 * @param {object} [values]
 * @returns {{total: number, parts: Array<{condition: string, value: number}>,
 *   pending: Array<{condition: string, value: number, when: string}>,
 *   unpriced: string[], exempt: string[]}}
 */
export function rollMath(on, subject, values = conditionValues()) {
  const set = conditionSet(subject?.statuses);
  const out = emptyMath();
  collect({ set, subject, on, side: "own", values, out });
  return {
    total: total(out.parts),
    parts: out.parts.map(({ condition, value }) => ({ condition, value })),
    pending: out.pending,
    unpriced: [...new Set(out.unpriced)],
    exempt: on === "morale" ? [...set].filter((key) => CONDITIONS[key].noMorale) : [],
  };
}

/**
 * What a creature's conditions do to its own Armor Class, as a signed total.
 * A sheet's readout; an attack reads the same rows through `attackMath`.
 */
export function acMath(subject, values = conditionValues()) {
  const out = emptyMath();
  collect({ set: conditionSet(subject?.statuses), subject, on: "ac", side: "own", values, out });
  return { total: total(out.parts), parts: out.parts.map(({ condition, value }) => ({ condition, value })), unpriced: out.unpriced };
}

/**
 * The share of its speed a creature keeps. Several reductions do not compound:
 * the slowest governs.
 *
 * @returns {{factor: number, parts: Array<{condition: string, value: number}>, unpriced: string[]}}
 */
export function speedMath(subject, values = conditionValues()) {
  const out = emptyMath();
  collect({ set: conditionSet(subject?.statuses), subject, on: "speedFactor", side: "own", values, out });
  const parts = out.parts.filter((p) => p.value > 0 && p.value < 1).map(({ condition, value }) => ({ condition, value }));
  return { factor: parts.reduce((f, p) => Math.min(f, p.value), 1), parts, unpriced: out.unpriced };
}

/**
 * Which of a combatant's conditions the tracker lifts at this moment.
 *
 * @param {Iterable<string>} statuses  the ids actually on the creature, not the closure
 * @param {"turn"|"combat"} moment
 */
export function endingAt(statuses, moment) {
  return [...(statuses ?? [])].filter((s) => CONDITIONS[s]?.ends === moment);
}
