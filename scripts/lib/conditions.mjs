/**
 * Conditions: the catalogue, and the math it performs. The catalogue is
 * Appendix B (RR 507-515) and the states a combatant declares or takes up in a
 * round (RR 291-303): readied, delayed, casting, defending, countercharging,
 * in cover, retreating, withdrawing.
 *
 * What ships is the PROCEDURE — which conditions exist, what each carries with
 * it, what it takes away, which rolls it reaches, whose roll that is, and how
 * two of them combine. Every size is printed: it arrives through the
 * `conditions` registered document and is read here by slot name. A slot
 * nothing registered contributes nothing and is reported in `unpriced`, so an
 * unimported world toggles conditions and applies no invented figure.
 *
 * A figure the system's own condition Active Effect applies (the eleven that
 * carry `system.changes` in `CONFIG.ACKS.conditions`) has no row here: that
 * effect applies it, and the module reads it only where the effect does not
 * reach (`conditionSteps`, `roll-mods.mjs`).
 *
 * A creature either has a condition or does not (RR 507): every reader here
 * takes the SET of a creature's conditions, closed under `implies`, so two
 * effects naming one condition count once. The exceptions are the rows marked
 * `per`, where the rule itself counts causes.
 *
 * Foundry-free: the status-effect registration and the roll seams are
 * `status-effects.mjs`. A condition's name is read from `globalThis` at the
 * call (`conditionNameKey`, `conditionLabel`), as the figures it reads are.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
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

/** The system's saving throws, by the key each is stored and rolled under, as a modifier's `saves` names them. */
export const SAVE_KINDS = Object.freeze(["death", "implements", "paralysis", "blast", "spell"]);

/**
 * What can take a state away before it ends: the creature takes damage, fails
 * a saving throw, or is moved when it is not its turn to move.
 */
export const LOSSES = Object.freeze(["damage", "save", "moved"]);

const MELEE = Object.freeze(["melee"]);
const THROWN = Object.freeze(["thrown"]);
const MISSILE = Object.freeze(["missile"]);
const MISSILE_THROWN = Object.freeze(["missile", "thrown"]);
const BLAST = Object.freeze(["blast"]);
const HURT_OR_FAILED = Object.freeze(["damage", "save"]);

/**
 * One row per roll a condition reaches.
 *
 *  - `on`     the roll: `attack`, `damage`, `ac`, `save`, `throw`, `morale`,
 *             `surprise`, or the multipliers `damageFactor` / `speedFactor`.
 *  - `slot`   the figure's key in the registered row.
 *  - `side`   `against` when the figure belongs to whoever attacks the
 *             creature; absent when it is the creature's own roll.
 *  - `scope`  the attack kinds it reaches; absent for all three. On an `ac`
 *             row, the kinds of attack the figure stands against.
 *  - `saves`  the saving throws a `save` row reaches; absent for all of them.
 *  - `per`    `stack` multiplies by the number of causes, `extraCause` by the
 *             causes past the first.
 *  - `when`   `source`: only against what imposed the condition. `shield`:
 *             only for a creature known to hold an equipped shield (`shieldOf`);
 *             known not to, the row is left out, and unknown, it is returned as
 *             pending. Any other value names a circumstance no roll can see
 *             (`fear`, `sight`, `voice`) and is returned as pending rather than
 *             applied.
 *  - `unless` a condition that supersedes this row: on the same creature,
 *             or on whoever gave the creature the state.
 */
const row = (on, slot, extra = {}) => Object.freeze({ on, slot, ...extra });

/**
 * The conditions, keyed by status id. An id the system ships in
 * `CONFIG.ACKS.conditions` or `combatStates` takes the system's name and icon,
 * so its row carries neither `label` nor `img` (`conditionNameKey`,
 * `conditionLabel`); `surprised`, `slumbering`, `readied` and `delayed` are the
 * system's own ids for the same four, so the system's tracker and this
 * catalogue mark one thing. A row for an id the system does not ship carries
 * its own `label` and `img`, and a lang name of the module's own
 * (`conditionNameKey`).
 *
 *  - `label`    the English name of a row the system does not ship: what a
 *               printed word is matched against, and the name before lang loads.
 *  - `img`      the icon of a row the system does not ship.
 *  - `state`    the palette files it under States rather than Conditions:
 *               a posture, a cover or a mark the weather leaves, not an
 *               Appendix B entry.
 *  - `implies`  conditions the creature also has while it has this one.
 *  - `forbids`  members of `ACTS`.
 *  - `shuts`    conditions this one makes the creature immune to.
 *  - `exposes`  a condition the creature's TARGET counts as having.
 *  - `ends`     `turn` (the creature's next initiative) or `combat` — when
 *               the tracker lifts it. The system lifts `surprised` itself.
 *  - `given`    another combatant can give the creature the state: it then
 *               ends at the giver's next initiative, not the creature's.
 *  - `lost`     members of `LOSSES` that take the state away early.
 *  - `shields`  attack kinds that cannot be made against the creature.
 *  - `autoHit`  attack kinds that need no throw against it, from an attacker
 *               its size or larger.
 *  - `noMorale` the creature never checks morale.
 */
export const CONDITIONS = Object.freeze({
  beholding: {},
  berserk: {
    shuts: ["cowering", "faltering", "frightened"], noMorale: true, ends: "combat",
    // The melee and missile throws are core's Active Effect; the thrown throw is the module's.
    mods: [row("attack", "attack", { scope: THROWN })],
  },
  bewitched: {},
  blessed: {
    mods: [row("morale", "all"), row("save", "all", { when: "fear" })],
  },
  blinded: {
    forbids: ["missile"],
    mods: [
      row("surprise", "surprise"), row("throw", "proficiency", { when: "sight" }), row("speedFactor", "speedFactor"),
    ],
  },
  burning: {},
  // A spell declared before initiative (RR 291, 293). Declaring one ends what
  // a Defend action gave (RR 294), which is the `unless` on those rows.
  casting: { label: "Casting", img: "icons/svg/book.svg", state: true, ends: "turn", lost: HURT_OR_FAILED },
  charging: { implies: ["disordered"], ends: "turn" },
  choking: { forbids: ["act", "speak"] },
  clambering: {
    exposes: "vulnerable",
    mods: [row("attack", "attack", { when: "source" }), row("attack", "against", { side: "against", when: "source" })],
  },
  concentrating: { lost: HURT_OR_FAILED },
  "concentrating-and-stationary": { lost: HURT_OR_FAILED },
  // A readied attack made against a charge (RR 295). It leaves its maker
  // Disordered, whose Armor Class figure is the system's effect.
  countercharging: {
    label: "Countercharging", img: "icons/svg/jump.svg", state: true, implies: ["disordered"], ends: "turn",
    mods: [row("attack", "attack")],
  },
  // Cover comes in two grades (RR 297, 303); the chest-high grade supersedes the waist-high.
  "cover-waist-high": {
    label: "Cover, waist-high", img: "icons/svg/wall-direction.svg", state: true,
    mods: [
      row("attack", "against", { side: "against", scope: MISSILE_THROWN, unless: "cover-chest-high" }),
      row("save", "blast", { saves: BLAST, unless: "cover-chest-high" }),
    ],
  },
  "cover-chest-high": {
    label: "Cover, chest-high", img: "icons/svg/castle.svg", state: true,
    mods: [row("attack", "against", { side: "against", scope: MISSILE_THROWN }), row("save", "blast", { saves: BLAST })],
  },
  cowering: { implies: ["vulnerable"], forbids: ["act"] },
  deafened: {
    mods: [row("surprise", "surprise"), row("throw", "proficiency", { when: "voice" })],
  },
  // The Defend action (RR 294), on whoever it protects: the defender, or the
  // ally it stands beside. The melee figure is the action's own; the other
  // three wait on a shield, read at the roll (`shieldOf`).
  defending: {
    label: "Defending", img: "icons/svg/tower.svg", state: true, ends: "turn", given: true,
    mods: [
      row("ac", "melee", { scope: MELEE, unless: "casting" }),
      row("ac", "thrown", { scope: THROWN, when: "shield", unless: "casting" }),
      row("ac", "missile", { scope: MISSILE, when: "shield", unless: "casting" }),
      row("save", "blast", { saves: BLAST, when: "shield", unless: "casting" }),
    ],
  },
  dehydrated: { forbids: ["forceMarch", "naturalHealing"] },
  // Holding an initiative for later in the round (RR 292). The system's
  // tracker sets and clears it.
  delayed: {},
  // `diseased` and `frostbitten` are marks the weather leaves (RR 277-279), not
  // Appendix B entries: they carry no figures and forbid nothing, and name a
  // body the Judge resolves from the book.
  diseased: { label: "Diseased", img: "icons/svg/pill.svg", state: true },
  disfavored: {},
  disordered: { ends: "turn" },
  dominated: {},
  drowning: { implies: ["vulnerable"], forbids: ["act"] },
  enervated: {},
  engaged: { forbids: ["charge"] },
  enlarged: { mods: [row("attack", "attack", { scope: MELEE })] },
  enslaved: {},
  enthralled: { forbids: ["attack", "cast", "speak"] },
  faltering: {
    mods: [
      row("attack", "all", { when: "source" }), row("throw", "all", { when: "source" }),
      row("save", "all", { when: "source" }),
    ],
  },
  fatigued: {
    mods: [
      row("attack", "all", { per: "stack" }), row("throw", "all", { per: "stack" }),
      row("save", "all", { per: "stack" }), row("damage", "all", { per: "stack" }),
    ],
  },
  // The bonus for attacking a flanked creature is the system's own: the attack
  // dialog's direction choice carries it, so the status marks the state and
  // puts no row of its own on the throw.
  flanked: {},
  forgetful: {},
  frightened: { forbids: ["attack", "cast", "speak"] },
  frostbitten: { label: "Frostbitten", img: "icons/svg/frozen.svg", state: true },
  grabbed: { implies: ["vulnerable"], forbids: ["attack", "cast", "move"] },
  helpless: { implies: ["vulnerable"], forbids: ["act"], autoHit: MELEE },
  hidden: {
    shields: ["missile", "thrown"],
    mods: [row("attack", "against", { side: "against", scope: MELEE })],
  },
  hungry: {
    mods: [row("throw", "all")],
  },
  hypothermic: { forbids: ["forceMarch", "naturalHealing"] },
  immune: { label: "Immune", img: "icons/svg/shield.svg" },
  incapacitated: {
    forbids: ["attack", "cast", "run", "forceMarch"],
    mods: [row("speedFactor", "speedFactor")],
  },
  infuriated: { shuts: ["cowering", "frightened"], noMorale: true, forbids: ["speak"] },
  inspired: {
    mods: [row("morale", "all"), row("save", "all", { when: "fear" })],
  },
  mad: {},
  mesmerized: { implies: ["mute"], forbids: ["act"] },
  mute: { forbids: ["speak", "cast"] },
  paralyzed: { implies: ["helpless", "mute"] },
  petrified: { implies: ["helpless"] },
  prone: { implies: ["vulnerable"], forbids: ["run", "charge"] },
  queasy: {
    mods: [row("throw", "all")],
  },
  // An action held for a trigger (RR 295): it lasts until the creature's own
  // initiative comes round again.
  readied: { ends: "turn", lost: LOSSES },
  resistant: { label: "Resistant", img: "icons/svg/mage-shield.svg" },
  restrained: {
    implies: ["vulnerable"], forbids: ["move"],
    mods: [row("attack", "perCause", { per: "extraCause" })],
  },
  // The two defensive movements, declared before initiative (RR 291, 293-294).
  retreating: { label: "Retreating", img: "icons/svg/door-exit.svg", state: true, implies: ["disordered"], ends: "turn" },
  shaken: {
    mods: [row("morale", "all"), row("save", "all", { when: "fear" })],
  },
  shrunk: {
    mods: [row("attack", "attack", { scope: MELEE }), row("damageFactor", "damageFactor")],
  },
  slumbering: {
    implies: ["helpless", "blinded", "deafened", "mute"],
    lost: ["damage", "moved"],
  },
  sneaking: {},
  starving: {
    implies: ["hungry"],
    forbids: ["forceMarch", "naturalHealing"],
  },
  stuck: { implies: ["vulnerable"], forbids: ["attack", "cast", "move"] },
  // A subjacent target's modifier is the attack dialog's own checkbox, as the
  // flank's bonus is its direction choice.
  subjacent: { label: "Subjacent", img: "icons/svg/mountain.svg" },
  surprised: {
    implies: ["vulnerable"],
    forbids: ["act"],
  },
  unconscious: {
    implies: ["helpless", "blinded", "deafened", "mute"],
  },
  underfed: {
    implies: ["hungry"],
    forbids: ["forceMarch", "naturalHealing"],
  },
  vexed: {},
  vomiting: { forbids: ["act", "speak"] },
  vulnerable: {
    mods: [row("attack", "against", { side: "against" })],
  },
  webbed: {
    implies: ["vulnerable"], forbids: ["move"],
    mods: [row("attack", "perCause", { per: "extraCause" })],
  },
  winded: { forbids: ["run", "charge"] },
  withdrawing: { label: "Withdrawing", img: "icons/svg/door-open-outline.svg", state: true, ends: "turn" },
  wrestled: { implies: ["vulnerable"], forbids: ["attack", "cast", "move"] },
});

/** Every condition key, in catalogue order. */
export const CONDITION_IDS = Object.freeze(Object.keys(CONDITIONS));

/**
 * The system's own entry for status `id`, from `CONFIG.ACKS.conditions` then
 * `CONFIG.ACKS.combatStates`, read at the call; undefined where the system
 * ships no such id (or is not loaded).
 *
 * @param {string} id
 * @returns {{id: string, name?: string, img?: string}|undefined}
 */
export function systemEntryOf(id) {
  const acks = globalThis.CONFIG?.ACKS;
  for (const list of [acks?.conditions, acks?.combatStates]) {
    for (const entry of list ?? []) if (entry?.id === id) return entry;
  }
  return undefined;
}

/**
 * The i18n key naming one condition: the system's own `name` key for an id it
 * ships, the module's `ACKS-LIB.condition.<id>` for any other. The one place a
 * condition's name key is built.
 *
 * @param {string} id
 * @returns {string}
 */
export const conditionNameKey = (id) => systemEntryOf(id)?.name || `${LANG_PREFIX}.condition.${id}`;

/**
 * A condition's name as a reader shows it: the localized name where lang
 * resolves the key, else the catalogue's English `label` (a row the system does
 * not ship), else the id. Read at the call, so a name asked before lang or the
 * system has loaded is not frozen.
 *
 * @param {string} id
 * @returns {string}
 */
export function conditionLabel(id) {
  const key = conditionNameKey(id);
  const word = globalThis.game?.i18n?.localize?.(key);
  if (typeof word === "string" && word && word !== key) return word;
  return CONDITIONS[id]?.label ?? String(id);
}

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
 * @property {Record<string, {statuses: Iterable<string>, shield?: boolean|null}>} [gifts]  for a state another combatant gave, that giver's statuses and `shieldOf`
 * @property {string} [id]  the creature's own uuid, matched against another's `sources`
 * @property {string[]} [acWaived]  condition ids whose Armor Class figure the creature does not suffer (`AC_WAIVER_TARGET`)
 * @property {string[]} [implied]  condition ids carried only by effects that also carry a status implying them
 * @property {boolean|null} [shield]  `shieldOf` for the creature; absent reads as unknown
 */

/** Flag key under `flags["acks-extras"]` on an effect: how many causes it stands for. */
export const STACKS_FLAG = "conditionStacks";

/**
 * The `modifier` target of an ability row that waives the Armor Class figures
 * of the conditions its `conditions` list names: `{type: "modifier", target:
 * "acWaiver", conditions: [...]}`, with no value. `subjectOf` reads it off the
 * actor's abilities; a row under a gate or a free-text condition is not read,
 * so a waiver is never applied on a guess.
 */
export const AC_WAIVER_TARGET = "acWaiver";

/** The condition ids an actor's abilities waive the Armor Class figure of, each once, catalogue conditions only. */
function waivedBy(actor) {
  const ids = new Set();
  for (const item of actor?.items ?? []) {
    if (item?.type !== "ability") continue;
    const extras = item.getFlag?.(MODULE_ID, "extras") ?? item.flags?.[MODULE_ID]?.extras;
    for (const spec of Array.isArray(extras?.effects) ? extras.effects : []) {
      if (spec?.type !== "modifier" || spec.target !== AC_WAIVER_TARGET || spec.gate?.kind || spec.condition) continue;
      for (const id of Array.from(spec.conditions ?? [])) if (CONDITIONS[id]) ids.add(id);
    }
  }
  return [...ids];
}

/**
 * Does the actor hold an equipped shield? True for an armour item of the
 * shield type that is equipped. With none, false for a character, whose
 * armour the sheet records, and null for any other actor type, whose Armor
 * Class is typed by hand and whose carried gear nothing imports: no item reads
 * as unknown there, not as absent. Read off the items, never off
 * `system.ac.shield`, which is the sum of the shields' Armor Class values and
 * reads as none for an equipped shield whose Armor Class is blank.
 *
 * The item test is `item-model.mjs`'s `isShield` and `isWorn` for an armour
 * item, spelled out here with bare literals as `waivedBy` does: `vocab.mjs`
 * reads this catalogue at load, so this file imports nothing that reaches it,
 * and `item-model.mjs` does.
 *
 * @param {object|null} actor
 * @returns {boolean|null}
 */
export function shieldOf(actor) {
  if (!actor) return null;
  for (const item of actor.items ?? []) {
    if (item?.type === "armor" && item.system?.type === "shield" && item.system.equipped) return true;
  }
  return actor.type === "character" ? false : null;
}

/**
 * Who gave `actor` the state an effect carries: the combatant that was acting
 * when the effect was made, where that is another creature still in that
 * fight. Null for a state the creature took up itself, one made outside a
 * running fight, one made before that round's initiative was rolled (the
 * tracker's current combatant is not acting then), and one whose giver has
 * left the fight. Foundry records the acting combatant and its initiative on
 * every effect an actor is given (`start`).
 *
 * @returns {{id: string, actor: object}|null} the giver's combatant
 */
export function giverOf(effect, actor) {
  const start = effect?.start;
  if (start?.initiative == null) return null;
  const giver = start.combat?.combatants?.get?.(start.combatant) ?? null;
  if (!giver?.actor || !actor) return null;
  return giver.actor === actor || (giver.actor.uuid != null && giver.actor.uuid === actor.uuid) ? null : giver;
}

/**
 * An actor as a subject: its statuses, how many enabled effects carry each
 * condition, where those effects came from, who gave it the states another
 * can give, and which conditions only an effect that also carries a status
 * implying them carries (`implied`). Null for no actor.
 *
 * @returns {ConditionSubject|null}
 */
export function subjectOf(actor) {
  if (!actor) return null;
  const counts = {};
  const sources = {};
  const gifts = {};
  const own = new Set(actor.statuses ?? []);
  const ownRight = new Set();
  const held = new Set();
  for (const effect of actor.appliedEffects ?? actor.effects ?? []) {
    if (effect?.disabled) continue;
    const stacks = Math.max(1, Math.floor(numOrNull(effect.flags?.[MODULE_ID]?.[STACKS_FLAG]) ?? 1));
    const carried = [...(effect.statuses ?? [])].filter((status) => CONDITIONS[status]);
    const brought = new Set(carried.flatMap((status) => CONDITIONS[status].implies ?? []));
    for (const status of carried) {
      const entry = CONDITIONS[status];
      (brought.has(status) ? held : ownRight).add(status);
      counts[status] = (counts[status] ?? 0) + stacks;
      if (effect.origin) (sources[status] ??= []).push(String(effect.origin));
      const giver = entry.given ? giverOf(effect, actor) : null;
      if (!giver) continue;
      const gift = { statuses: giver.actor.statuses ?? [], shield: shieldOf(giver.actor) };
      gifts[status] = gift;
      // What a given state implies came with it, unless the creature has that in its own right.
      for (const implied of entry.implies ?? []) if (CONDITIONS[implied]?.given && !own.has(implied)) gifts[implied] = gift;
    }
  }
  const implied = [...held].filter((status) => !ownRight.has(status));
  return { statuses: actor.statuses ?? [], counts, sources, gifts, id: actor.uuid ?? null, acWaived: waivedBy(actor), implied, shield: shieldOf(actor) };
}

const emptyMath = () => ({ total: 0, parts: [], pending: [], unpriced: [], waived: [] });

/**
 * The one decision of the Armor Class waiver: the conditions whose Armor Class
 * figure a subject does not suffer. Each id its `acWaived` names that it
 * carries, and each condition it carries only because a waived one implies it
 * (a charge's disorder). A condition another status the creature carries in
 * its own right brings stands: waiving the charge leaves the disorder a
 * countercharge or a hand-set status causes. A status an effect carries beside
 * the condition that implies it (`implied`) is not carried in its own right, or
 * the waived condition would sustain itself.
 *
 * Two appliers read it: `collect` for the module's own `ac` rows, and the step
 * reader (`conditionSteps`, `roll-mods.mjs`) for a monster's `system.ac.mod`
 * steps.
 *
 * @param {ConditionSubject|null} subject
 * @returns {Set<string>}
 */
export function acWaivedSet(subject) {
  const named = [...new Set(subject?.acWaived ?? [])].filter((id) => CONDITIONS[id]);
  if (!named.length) return new Set();
  const implied = new Set(subject?.implied ?? []);
  const statuses = [...(subject?.statuses ?? [])];
  const carried = conditionSet(statuses);
  const standing = conditionSet(statuses.filter((id) => !named.includes(id) && !implied.has(id)));
  return new Set([...carried].filter((id) => named.includes(id) || !standing.has(id)));
}

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
 * Whose shield a `when: "shield"` row reads: the giver's for a state another
 * combatant gave, else the creature's own. A subject or gift that records none
 * is unknown, and so is a gift whose giver's shield is unknown: the creature's
 * own is never read in its place.
 */
function shieldAt(subject, gift) {
  const held = gift ? gift.shield : subject?.shield;
  return held === true || held === false ? held : null;
}

/**
 * Walk one creature's rows for one roll, collecting what applies.
 *
 * @param {object} p
 * @param {Set<string>} p.set  the creature's conditions, already closed
 * @param {ConditionSubject} p.subject
 * @param {string} p.on  the roll
 * @param {"own"|"against"} p.side
 * @param {string} [p.kind]  the attack kind, for `scope`; a scoped row waits on one
 * @param {string} [p.save]  the saving throw, for `saves`; a row naming saves waits on one
 * @param {ConditionSubject} [p.opponent]  for `when: "source"`
 * @param {object} p.values  the registered rows
 * @param {object} p.out  `{parts, pending, unpriced}` appended to
 * @param {number} [p.sign]  -1 turns a figure on a creature's AC into one on its attacker's roll
 */
function collect({ set, subject, on, side, kind, save, opponent, values, out, sign = 1 }) {
  const waived = on === "ac" && side === "own" ? acWaivedSet(subject) : null;
  for (const key of set) {
    // A state another gave is superseded by what its giver does, not its bearer.
    const gift = subject?.gifts?.[key];
    const superseding = gift ? conditionSet(gift.statuses) : set;
    for (const mod of CONDITIONS[key].mods ?? []) {
      if (mod.on !== on) continue;
      if ((mod.side === "against") !== (side === "against")) continue;
      if (mod.scope && !mod.scope.includes(kind)) continue;
      if (mod.saves && !mod.saves.includes(save)) continue;
      if (mod.unless && superseding.has(mod.unless)) continue;
      const shield = mod.when === "shield" ? shieldAt(subject, gift) : undefined;
      if (shield === false) continue;
      const figure = numOrNull(values?.[key]?.[mod.slot]);
      if (figure == null) {
        out.unpriced.push(key);
        continue;
      }
      const value = figure * multiplier(mod, key, subject) * sign;
      if (!value) continue;
      if (waived?.has(key)) {
        (out.waived ??= []).push({ condition: key, value });
        continue;
      }
      if (mod.when && mod.when !== "source" && shield !== true) {
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
 *   autoHit: string|null, pending: object[], unpriced: string[], waived: Array<{condition: string, value: number}>}}
 *   `autoHit` is the target's condition that waives the throw; `damageFactorBy`
 *   the attacker's conditions that scaled the damage; `waived` the target's
 *   Armor Class rows it does not suffer (`acMath`), left out of `terms`, each
 *   with the figure as a term would have carried it.
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
    collect({ set: theirs, subject: target, on: "ac", side: "own", kind, values, out, sign: -1 });
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
    waived: out.waived ?? [],
  };
}

/**
 * What a creature's conditions add to one of its own rolls: `save`, `throw`
 * (proficiency and adventuring), `morale` or `surprise`. A positive total
 * helps the roll. Rows bound to a circumstance the roll does not state are
 * returned in `pending`, unapplied. A row that reaches only some saving throws
 * is read when `save` names one of them, and left out when no save is named.
 *
 * @param {"save"|"throw"|"morale"|"surprise"} on
 * @param {ConditionSubject} subject
 * @param {object} [values]
 * @param {{save?: string}} [options]  `save`: which of `SAVE_KINDS` is rolled
 * @returns {{total: number, parts: Array<{condition: string, value: number}>,
 *   pending: Array<{condition: string, value: number, when: string}>,
 *   unpriced: string[], exempt: string[]}}
 */
export function rollMath(on, subject, values = conditionValues(), { save } = {}) {
  const set = conditionSet(subject?.statuses);
  const out = emptyMath();
  collect({ set, subject, on, side: "own", save, values, out });
  return {
    total: total(out.parts),
    parts: out.parts.map(({ condition, value }) => ({ condition, value })),
    pending: out.pending,
    unpriced: [...new Set(out.unpriced)],
    exempt: on === "morale" ? [...set].filter((key) => CONDITIONS[key].noMorale) : [],
  };
}

/**
 * What the module's own Armor Class rows do to a creature's Armor Class, as a
 * signed total: Defend's, the rows no Active Effect of core's carries. A figure
 * core's condition effect applies is not here: it is in a character's
 * `ac.value`, and a monster's is read by `conditionSteps` (`roll-mods.mjs`).
 * An attack reads the same rows through `attackMath`. With no `kind` it is the
 * Armor Class against every attack, and a row that stands against only some
 * kinds is left out.
 *
 * A condition the subject's `acWaived` names is not suffered (`acWaivedSet`):
 * its row is left out of `parts` and `total` and reported in `waived`, and so
 * is the row of a condition that is carried only because a waived one implies
 * it. Only the Armor Class figure is waived; the caller still reads the
 * condition's other rows and what it forbids.
 *
 * @param {ConditionSubject} subject
 * @param {object} [values]
 * @param {{kind?: "melee"|"missile"|"thrown"}} [options]
 * @returns {{total: number, parts: Array<{condition: string, value: number}>, unpriced: string[],
 *   waived: Array<{condition: string, value: number}>}}
 */
export function acMath(subject, values = conditionValues(), { kind } = {}) {
  const out = emptyMath();
  collect({ set: conditionSet(subject?.statuses), subject, on: "ac", side: "own", kind, values, out });
  return {
    total: total(out.parts),
    parts: out.parts.map(({ condition, value }) => ({ condition, value })),
    unpriced: out.unpriced,
    waived: out.waived,
  };
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

/**
 * Which of a combatant's conditions the tracker lifts as one turn begins: a
 * state that ends with a turn ends at its bearer's, and one another combatant
 * gave at the giver's.
 *
 * @param {Iterable<string>} statuses  the ids actually on the creature
 * @param {object} p
 * @param {string} p.self    the creature's own combatant id
 * @param {string} p.acting  the combatant whose turn begins
 * @param {Record<string, string>} [p.givers]  for a state another gave, the giver's combatant id
 */
export function endingAtTurn(statuses, { self, acting, givers = {} }) {
  return endingAt(statuses, "turn").filter((s) => ((CONDITIONS[s].given && givers[s]) || self) === acting);
}

/**
 * Which of a creature's states `cause` takes away.
 *
 * @param {Iterable<string>} statuses  the ids actually on the creature
 * @param {"damage"|"save"|"moved"} cause  one of `LOSSES`
 */
export function lostTo(statuses, cause) {
  return [...(statuses ?? [])].filter((s) => CONDITIONS[s]?.lost?.includes(cause));
}
