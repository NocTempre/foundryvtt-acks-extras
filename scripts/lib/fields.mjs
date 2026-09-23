/* global foundry */
/**
 * DataModel field-builders for the shared ACKS vocabulary. Foundry-only (they
 * touch `foundry.data.fields`), but every builder is a lazy function so the
 * module still evaluates in Node — `foundry` is only dereferenced when a model
 * is actually defined (at `init` or later). The abilities effect model is built
 * from these.
 */
import {
  choicesOf,
  ALIGNMENTS,
  ATTRIBUTES,
  INFLUENCE_TONES,
  SCOPE_ALIGNMENT_MODES,
  DAMAGE_TYPES,
  EFFECT_KEYS,
  CONDITION_KEYS,
  MOVEMENT_TYPES,
  VISION_TYPES,
  SENSE_TYPES,
  NATURAL_WEAPONS,
  EFFECT_TYPES,
  EFFECT_MODES,
  EFFECT_SUBJECTS,
  PROFICIENCY_DOMAINS,
  PROFICIENCY_BREADTH,
  PROGRESSION_LEVELS,
  SPELL_LIKE_FREQ,
  RESOURCE_KINDS,
  ROLL_TYPES,
  THROW_TYPES,
  REROLL_KEEP,
  OUTCOME_TRIGGERS,
  VALUE_SCALES,
  VALUE_KINDS,
  VALUE_ROUNDING,
  RUNG_OUTCOMES,
} from "./vocab.mjs";
import { OCCUPANT_KIND } from "./place-logic.mjs";

const F = () => foundry.data.fields;

/* --- leaf helpers (mirror acks-monsters/scripts/monster-extras.mjs) --- */
export const num = (opts = {}) => new (F().NumberField)({ required: false, nullable: true, initial: null, ...opts });
export const str = (opts = {}) => new (F().StringField)({ required: false, blank: true, initial: "", ...opts });
export const bool = (initial = false) => new (F().BooleanField)({ initial });
// A REQUIRED integer that always holds a value — the counterpart to `num` for
// fields the system writes concrete integers into (stub thac0/initiative,
// counts, indices). acks-henchmen defined this verbatim in two data files; it
// belongs here beside num/str.
export const int = (initial = 0, opts = {}) =>
  new (F().NumberField)({ required: true, nullable: false, integer: true, initial, ...opts });
export const html = () => new (F().HTMLField)({ required: false, blank: true, initial: "" });
export const choice = (enumObj, opts = {}) =>
  new (F().StringField)({ required: false, blank: true, initial: "", choices: choicesOf(enumObj), ...opts });
export const choiceSet = (enumObj) => new (F().SetField)(new (F().StringField)({ choices: choicesOf(enumObj) }));
/** A list of ability refs (def.prof.x / def.power.x). */
export const refList = () => new (F().ArrayField)(new (F().StringField)({ blank: false }));

/**
 * One occupant — a living thing recorded on a place's roster, or on a
 * faction's membership: a REFERENCE (uuid), denormalised with name and image.
 * See docs/lib/PLACES.md, "Occupancy: two sources, one list, stored wins".
 * `place-logic.mjs`'s `OCCUPANT_KIND` is the `kind` vocabulary; `place.mjs`'s
 * `occupantRow` builds a row from a live actor.
 */
export function occupantField() {
  const { SchemaField, StringField, BooleanField } = F();
  return new SchemaField({
    uuid: str(),
    name: str(),
    img: str(),
    kind: new StringField({ required: true, initial: OCCUPANT_KIND.ACTOR, choices: Object.values(OCCUPANT_KIND) }),
    // A group row counts its whole stack: a platoon billeted at an inn is 30
    // people asleep in it, and a headcount that said 1 would mislead every
    // capacity decision made from the sheet.
    quantity: int(1),
    ownerUuid: str(), // who put it here / whose it is; "" = the holder's own
    // Caller-supplied at placement (acks-lib `occupantRow` / `addOccupant`
    // option bag), and kept when a stored row absorbs its derived duplicate.
    notes: str(),
    // Display gating only, never a security boundary — the same ruling storage
    // makes about attribution. A row that must genuinely stay secret belongs
    // on a GM-owned document.
    hidden: new BooleanField({ initial: false }),
  });
}

/* --- LevelValue: flat | perLevel | breakpoints | progression --- */
export function levelValueField() {
  const { SchemaField, ArrayField } = F();
  return new SchemaField({
    kind: choice(VALUE_KINDS, { initial: "flat" }),
    flat: num(),
    base: num(),
    per: num(),
    // Shared by `breakpoints` and `conditional`: for the latter `atLevel` reads
    // "at this value of `on`" rather than at this class level.
    //
    // A rung is not always a number: a printed progression may run rungs the
    // character cannot act on and rungs reached without a throw. So a rung may
    // DECLARE its outcome (`auto`, `none`; blank is a target) and carries the
    // cell's printed text for display. `text` is what the page says; `outcome`
    // is the only part a machine acts on.
    breakpoints: new ArrayField(
      new SchemaField({ atLevel: num({ integer: true }), value: num(), outcome: choice(RUNG_OUTCOMES), text: str() }),
    ),
    on: choice(VALUE_SCALES), // conditional: which scale the ladder is keyed on
    // Fractional per-level values are printed with their rounding; without
    // this a half-per-level value resolves to a fraction the rule never produces.
    round: choice(VALUE_ROUNDING),
    // WHOSE table, as a class KEY — the four chassis, or any class document the
    // world holds. Not a closed enum: a value outside a closed list is
    // silently rewritten to the first one, so choosing a real class stored
    // `fighter`.
    as: str(),
    // WHICH of that class's ladders — blank means its attack bands. See
    // docs/lib/DECISIONS.md, "A borrowed progression can name its ladder".
    table: str(),
    // The FRACTION of class level the borrowed table is read at, as the page
    // writes it — a numerator over a denominator. It is data because which
    // fraction a rule uses is printed: enumerating the ones some book happens
    // to state would transcribe those rules and still miss the next one.
    // `atLevel` is the legacy shorthand and is read when no fraction is set.
    atLevelNum: num({ integer: true }),
    atLevelDen: num({ integer: true }),
    atLevel: choice(PROGRESSION_LEVELS),
  });
}

/**
 * ONE named roll an ability offers — an ability is not always one roll, so a
 * single `rollTarget` cannot hold every throw it makes. Everything in this
 * shape — the label, the target, the progression, the qualifier — is read
 * from the reader's own book.
 */
export function rollField() {
  const { SchemaField } = F();
  return new SchemaField({
    key: str(), // stable within the ability, so a macro can name one roll
    label: str(), // what the roll is called
    formula: str(), // "1d20"
    // The three comparisons core knows, plus `measure` — a throw with nothing
    // to beat, whose result IS the answer. Never written to core's own
    // `system.rollType`, whose choices are three.
    rollType: choice(THROW_TYPES, { initial: "above" }),
    target: levelValueField(), // flat, per-level, or a rank ladder — none on a measure
    scale: choice(VALUE_SCALES, { initial: "level" }), // what `target` is keyed on
    // An ability score the character adds to this throw. `key` is an
    // ATTRIBUTES key (`system.scores` path); blank means no score. `times`
    // multiplies the modifier (1 for a plain score term). Kept on the ROLL
    // rather than in the formula, so every surface reads the same number.
    score: new SchemaField({
      key: choice(ATTRIBUTES),
      times: num({ initial: 1 }),
    }),
    condition: str(), // when it applies, when that is not unconditional
    note: str(),
  });
}

export const rollsField = () => new (F().ArrayField)(rollField());

/**
 * A pointer to a spell: the core system's spell item by uuid, with the printed
 * name as a fallback. Enough to link and display; it models nothing about the
 * spell itself. Nothing consumes it yet — see docs/ROADMAP.md § Magic.
 */
export function spellRefField() {
  return new (F().SchemaField)({
    uuid: str(), // core spell Item uuid, once one exists in the world
    name: str(), // printed name — the fallback when no item is linked
  });
}

/* --- Defenses: immunities / resistances / susceptibilities (shared w/ monsters) --- */
export function defensesField() {
  const { SchemaField } = F();
  const band = () =>
    new SchemaField({
      damage: choiceSet(DAMAGE_TYPES),
      effects: choiceSet(EFFECT_KEYS),
      conditions: choiceSet(CONDITION_KEYS),
      mundane: bool(), // only harmed by extraordinary
      extraordinary: bool(), // only harmed by mundane
      // RR ch.6's common flaw: silver counts as magic against this defence, so
      // a silver weapon deals extraordinary damage. Meaningless on a
      // susceptibility, which is a weakness rather than a defence.
      silverFlaw: bool(),
      // Printed qualifiers the closed sets cannot carry ("except from its own
      // kind", a named spell). Prose for the reader; the sets are the machine's.
      note: str(),
    });
  return new SchemaField({ immunities: band(), resistances: band(), susceptibilities: band() });
}

/* --- Movement / senses / vision (shapes shared w/ monster Speed & Senses) --- */
// One Speed-table row: the ACKS split of encounter/combat speed (⅓ of running)
// and running speed, plus whether a flyer can hover. num() is nullable, so a
// blank cell reads as "unspecified", never a real 0.
export const speedsField = () =>
  new (F().ArrayField)(
    new (F().SchemaField)({
      type: choice(MOVEMENT_TYPES, { initial: "land" }),
      combat: num({ integer: true }),
      run: num({ integer: true }),
      hover: bool(false),
    }),
  );
export const sensesField = () =>
  new (F().ArrayField)(
    new (F().SchemaField)({ type: choice(SENSE_TYPES, { initial: "acuteHearing" }), range: num({ integer: true }), note: str() }),
  );
export const visionField = () => choiceSet(VISION_TYPES);

/* --- Effect: one typed primitive (wide all-optional schema, discriminated by `type`) --- */
export function effectField() {
  const { SchemaField } = F();
  return new SchemaField({
    type: choice(EFFECT_TYPES, { initial: "modifier" }),
    // modifier / throw
    target: str(), // a MODIFIER_TARGETS key, or a save/proficiency name
    value: levelValueField(),
    forWhat: str(), // the activity a throw/modifier applies to ("Dungeonbashing")
    // WHOSE roll this modifies. Without it, a penalty the ability imposes on
    // its victims is indistinguishable from one the character suffers, which
    // inverts the ability. Defaults to self, so existing effects are unchanged.
    appliesTo: choice(EFFECT_SUBJECTS, { initial: "self" }),
    // WHICH of the ability's throws this modifier belongs to, by that throw's
    // key — the throw's own name is the guard, not `condition`'s prose. See
    // docs/abilities/DECISIONS.md, "A modifier must name what it modifies,
    // and may name the throw". Blank means not scoped to a single throw.
    appliesToRoll: str(),
    roll: str(), // e.g. "1d20"
    rollType: choice(ROLL_TYPES),
    /* --- attributeSubstitution ---
     * `attribute` is applied INSTEAD OF `insteadOf` on `target`. Both are
     * ATTRIBUTES keys, which are the core system's own score paths, so a
     * consumer swaps `system.scores[insteadOf].mod` for
     * `system.scores[attribute].mod` without a translation table. The rule is
     * always narrowed in prose (by weapon size, or to the weapons the
     * character is proficient with) — that narrowing lives in `condition`, as
     * it does for every other effect. */
    attribute: choice(ATTRIBUTES),
    insteadOf: choice(ATTRIBUTES),
    // progressionAs — a skill that advances as another class's. A class KEY on
    // the same terms as a progression target's: the four chassis, or any class
    // the world publishes. A closed enum rewrote every non-chassis class to
    // `fighter` on save, so an ability that progressed as a craftpriest stored
    // that it progressed as a fighter.
    as: str(),
    atLevel: choice(PROGRESSION_LEVELS),
    // proficiencyGrant (weapon/armor/fighting-style proficiency)
    domain: choice(PROFICIENCY_DOMAINS),
    breadth: choice(PROFICIENCY_BREADTH), // unrestricted / broad / narrow / restricted
    group: str(), // weapon group / armor weight / fighting-style name (empty when unrestricted)
    // limitation / drawback (a restriction on ANY ability; numeric penalties reuse target+value)
    restriction: str(), // prohibition or behavioral drawback ("may not use shields")
    // immunity / resistance / susceptibility
    damage: choiceSet(DAMAGE_TYPES),
    effects: choiceSet(EFFECT_KEYS),
    conditions: choiceSet(CONDITION_KEYS),
    // sense / movement — NOTE `movementMode` is deliberately not called `mode`:
    // `mode` below is the combination mode (add|replace|set), and two fields of
    // the same name in one schema silently lose one of them.
    sense: choice(SENSE_TYPES),
    vision: choice(VISION_TYPES),
    movementMode: choice(MOVEMENT_TYPES),
    range: num({ integer: true }),
    // naturalAttack
    routine: str(),
    naturalWeapon: choice(NATURAL_WEAPONS),
    // spellLike / spellcastingMod
    spell: str(),
    frequency: choice(SPELL_LIKE_FREQ),
    castingTime: str(),
    school: str(),
    casterLevelDelta: num({ integer: true }),
    // resource / economic
    resource: choice(RESOURCE_KINDS),
    action: choice({ spend: { label: "Spend" }, gain: { label: "Gain" } }),
    amount: num(),
    unit: str(),
    period: str(),
    // Relational: depend on / grant / alter OTHER abilities. See
    // docs/lib/API.md, "Relational effects — requires / grants / modifies,
    // stacking and chaining".
    ref: str(),
    refs: refList(),
    ifHas: refList(),
    mode: choice(EFFECT_MODES),
    stacksWith: refList(),
    notStacksWith: refList(),
    choose: num({ integer: true }),
    // Scoping: WHEN this modifier applies to a particular roll — the parts a
    // machine can decide, resolved by `scopeApplies()` in vocab.mjs. See
    // docs/lib/API.md, "Scoping — when a modifier applies".
    vsKinds: refList(),
    vsAlignment: choice(ALIGNMENTS),
    vsAlignmentMode: choice(SCOPE_ALIGNMENT_MODES, { initial: "gate" }),
    tones: new (F().ArrayField)(new (F().StringField)({ choices: choicesOf(INFLUENCE_TONES) })),
    optionalRule: str(),
    // Kicker: a rider that fires on a good enough total. See docs/lib/API.md,
    // "Scoping — when a modifier applies" (`kickerAt`/`kickerNote`).
    kickerAt: num({ integer: true }),
    kickerNote: str(),
    // reroll: "roll twice and keep the better". See docs/lib/API.md, "Rerolls".
    keep: choice(REROLL_KEEP),
    times: num({ integer: true }),
    // outcome: "on a roll of X, Y happens". See docs/lib/API.md, the
    // "Roll outcomes" bullet under Vocabulary.
    trigger: choice(OUTCOME_TRIGGERS),
    naturalMax: num({ integer: true }),
    belowFraction: num(),
    consequence: str(),
    // companion: a creature the ability confers. See docs/lib/API.md,
    // "Companions".
    actorUuid: str(),
    // shared
    condition: str(), // free-text situational qualifier (when no structured form fits)
    note: str(),
  });
}

export const effectsField = () => new (F().ArrayField)(effectField());
