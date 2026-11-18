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
  SCOPE_ALIGNMENT_REFERENCES,
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
  SPELL_LIKE_FREQ,
  HEAL_KINDS,
  SUMMON_FORMATS,
  CONTROL_KINDS,
  RESOURCE_KINDS,
  ROLL_TYPES,
  THROW_TYPES,
  REROLL_KEEP,
  OUTCOME_TRIGGERS,
  VALUE_SCALES,
  VALUE_KINDS,
  VALUE_ROUNDING,
  RUNG_OUTCOMES,
  SAVE_EFFECTS,
  EFFECT_DELIVERIES,
  EFFECT_LASTS,
  EFFECT_RECURRENCES,
  EFFECT_RECUR_MOMENTS,
  EFFECT_RECUR_SAVES,
  EFFECT_RECUR_TARGETS,
} from "./vocab.mjs";
import { LIGHT_LEVELS } from "./light.mjs";
import { ATTACK_KINDS } from "./conditions.mjs";
import { OCCUPANT_KIND } from "./place-logic.mjs";

const F = () => foundry.data.fields;

/* --- leaf helpers (the same builders scripts/monsters/monster-extras.mjs uses) --- */
/** An optional, nullable number field that starts as null. */
export const num = (opts = {}) => new (F().NumberField)({ required: false, nullable: true, initial: null, ...opts });

/** An optional string field that may be blank and starts as "". */
export const str = (opts = {}) => new (F().StringField)({ required: false, blank: true, initial: "", ...opts });

/** A boolean field starting as `initial`. */
export const bool = (initial = false) => new (F().BooleanField)({ initial });

/**
 * A REQUIRED integer that always holds a value — the counterpart to `num` for
 * fields the system writes concrete integers into (stub attack/initiative,
 * counts, indices). It lives here beside num/str so no data file defines its own.
 */
export const int = (initial = 0, opts = {}) =>
  new (F().NumberField)({ required: true, nullable: false, integer: true, initial, ...opts });

/** An optional HTML field that may be blank and starts as "". */
export const html = () => new (F().HTMLField)({ required: false, blank: true, initial: "" });

/** An optional string field restricted to the keys of `enumObj`, blank allowed. */
export const choice = (enumObj, opts = {}) =>
  new (F().StringField)({ required: false, blank: true, initial: "", choices: choicesOf(enumObj), ...opts });

/** A set field of strings restricted to the keys of `enumObj`. */
export const choiceSet = (enumObj) => new (F().SetField)(new (F().StringField)({ choices: choicesOf(enumObj) }));
/** A list of ability refs (def.prof.x / def.power.x). */
export const refList = () => new (F().ArrayField)(new (F().StringField)({ blank: false }));
/** A list of authored words (a school, an element, a save category), none blank. */
export const wordList = () => new (F().ArrayField)(new (F().StringField)({ blank: false }));

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
    // Caller-supplied at placement (lib's `occupantRow` / `addOccupant`
    // option bag), and kept when a stored row absorbs its derived duplicate.
    notes: str(),
    // Display gating only, never a security boundary — the same ruling storage
    // makes about attribution. A row that must genuinely stay secret belongs
    // on a GM-owned document.
    hidden: new BooleanField({ initial: false }),
  });
}

/**
 * A level-dependent value, by `kind`: flat, per level, breakpoints, a borrowed
 * class progression, or one keyed on another scale.
 */
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
    atLevelNum: num({ integer: true }),
    atLevelDen: num({ integer: true }),
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

/** An array field of `rollField` entries. */
export const rollsField =() => new (F().ArrayField)(rollField());

/**
 * A pointer to a spell: the core system's spell item by uuid, the importer's
 * entry id where the spell was imported, and the printed name as the fallback
 * when neither resolves. Enough to link and display; it models nothing about
 * the spell itself — the spell primitive is `magic/spell-extras.mjs`, which
 * uses this for a reversal's other half (`reverseOf`).
 */
export function spellRefField() {
  return new (F().SchemaField)({
    uuid: str(), // core spell Item uuid, once one exists in the world
    // The importer's entry id (`flags.acks-extras.cookbook.id`), which
    // survives a reimport where a uuid does not.
    cookbookId: str(),
    name: str(), // printed name — the fallback when no item is linked
  });
}

/* --- Defenses: immunities / resistances / susceptibilities (shared w/ monsters) --- */
/**
 * The defences an ability or monster carries: `immunities`, `resistances` and
 * `susceptibilities`, each a band of damage types, effects and conditions with
 * the mundane/extraordinary and silver-flaw flags. A susceptibility also
 * carries the creature's own two figures, `factor` (the multiple of damage it
 * takes) and `save` (the signed modifier to its saving throw), blank until
 * read: `defenses.mjs` applies them, and neither has a default.
 */
export function defensesField() {
  const { SchemaField } = F();
  const band = (figures = {}) =>
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
      ...figures,
    });
  return new SchemaField({
    immunities: band(),
    resistances: band(),
    susceptibilities: band({ factor: num(), save: num() }),
  });
}

/* --- Movement / senses / vision (shapes shared w/ monster Speed & Senses) --- */
/**
 * An array of Speed-table rows: the ACKS split of encounter/combat speed (⅓ of
 * running) and running speed, plus whether a flyer can hover. `num()` is
 * nullable, so a blank cell reads as "unspecified", never a real 0.
 */
export const speedsField = () =>
  new (F().ArrayField)(
    new (F().SchemaField)({
      type: choice(MOVEMENT_TYPES, { initial: "land" }),
      combat: num({ integer: true }),
      run: num({ integer: true }),
      hover: bool(false),
    }),
  );
/** An array of senses, each a sense type with an optional range and note. */
export const sensesField =() =>
  new (F().ArrayField)(
    new (F().SchemaField)({ type: choice(SENSE_TYPES, { initial: "acuteHearing" }), range: num({ integer: true }), note: str() }),
  );
/** A set of vision types. */
export const visionField =() => choiceSet(VISION_TYPES);

/**
 * One typed effect primitive: a wide, all-optional schema whose `type` says
 * which of its fields apply.
 */
export function effectField() {
  const { SchemaField } = F();
  // One branch of an `anyOf` disjunction: the target-side clauses and never a
  // `sign` mode, since a branch decides applies or fails and no more.
  const scopeBranch = () =>
    new SchemaField({
      vsKinds: refList(),
      vsAlignment: choice(ALIGNMENTS),
      vsAlignmentOf: choice(SCOPE_ALIGNMENT_REFERENCES),
      vsAlignmentMode: choice(SCOPE_ALIGNMENT_MODES, { initial: "gate" }),
      vsEnemy: bool(),
    });
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
    // that it progressed as a fighter. The fraction of class level is the
    // `atLevelNum` over `atLevelDen` pair, as on a progression target.
    as: str(),
    atLevelNum: num({ integer: true }),
    atLevelDen: num({ integer: true }),
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
    // spellLike / spellcastingMod. `spell` is the printed name; `spellRef`
    // points at the spell document once one exists — readers take the ref's
    // name where it is set and fall back to the string.
    spell: str(),
    spellRef: spellRefField(),
    frequency: choice(SPELL_LIKE_FREQ),
    // The phrase the importer read for a `printed` frequency, as the Judge's copy prints it.
    frequencyText: str(),
    castingTime: str(),
    school: str(),
    casterLevelDelta: num({ integer: true }),
    // What a `spellcastingMod` row narrows on, beside `school`, `spell` and
    // `spellRef`: the spell's schools and elements (authored words, folded
    // when matched), whether the ability copies' pooled picks name one of the
    // spell's elements or schools (`bySelection`), the categories of save a
    // `save` row concerns, and, on a `damage` row, whether its size is per die
    // of the scaled formula (`perDie`). Fields AND; members of one list OR.
    schools: wordList(),
    elements: wordList(),
    bySelection: bool(),
    saveCategories: wordList(),
    perDie: bool(),
    // Spell kinds (`domain: "spell"` in EFFECT_TYPES). `roll` carries the dice
    // a damage or heal effect rolls; `damage` its damage types; `amount` a
    // summon's creature count and `value` its Hit Dice; `ref` the creature.
    healKind: choice(HEAL_KINDS),
    // Cast behaviour of a spell row (docs/magic/MODEL.md, "Importing spells"):
    // `saveEffect` overrides the spell's `save.effect` for this row (blank
    // inherits it); `delivery` is the attack throw the caster must land first;
    // `extraordinary` is the damage's printed mark, null where nothing read
    // it (a missed capture is not a "no"); `lasts` and `recur` say whether the
    // row is spent in the cast or runs with the spell; `pick` names a choice
    // group of which the caster takes one row; `reversed` marks the reverse
    // form's rows; `max` is the ceiling on a damage or heal row's instance
    // count, its `value`. `origin` is "register" on a
    // row the importer wrote, and cleared when a Judge edits it, which is how
    // a repair tells the two apart. `unread` lists the fields a capture missed.
    // `key` names the row for the life of the spell: the register authors one
    // on each row it writes (a module word, unique within the spell), and a row
    // a Judge adds gets `_` and a random id, which no register key can equal. A
    // repair matches a stored row to the register's by it.
    // `pickOption` names the option of the `pick` group a row belongs to (rows
    // sharing both are one option). `recurAt`, `recurSave` and `recurTarget` say
    // where a recurring row resolves, what its bearer throws first and who it
    // meets; `rounds` is the dice formula a `rounds` lasting counts, and
    // `exemptSizeFrom` the monsters size key at or above which a target is
    // exempt from this row; the importer locates both from the page.
    key: str(),
    pickOption: str(),
    recurAt: choice(EFFECT_RECUR_MOMENTS),
    recurSave: choice(EFFECT_RECUR_SAVES),
    recurTarget: choice(EFFECT_RECUR_TARGETS),
    rounds: str(),
    exemptSizeFrom: str(),
    // `exemptSizeOver` is the size key a target must be strictly above to be
    // exempt (`exemptSizeFrom` is at or above); the importer locates it too.
    exemptSizeOver: str(),
    // `attackKinds` narrows a row to the kinds of attack made against the
    // bearer (`conditions.mjs` `ATTACK_KINDS`); blank is every kind.
    attackKinds: choiceSet(Object.fromEntries(ATTACK_KINDS.map((kind) => [kind, kind]))),
    // `ownSave` marks a modifier on the saving throw made against the spell
    // itself, tested per saver at that throw (`roll-mods.mjs` `ownSaveParts`).
    ownSave: bool(),
    // `pickKind` marks a row whose creature kind the caster picks at the cast.
    pickKind: bool(),
    // `endsOn` lists what the record this row writes ends on (`ends-on.mjs`
    // `ENDS_ON_CAUSES`: damage, attack); `untimed` lists the condition keys the
    // row writes with no clock of their own.
    endsOn: wordList(),
    untimed: wordList(),
    saveEffect: choice(SAVE_EFFECTS),
    delivery: choice(EFFECT_DELIVERIES),
    extraordinary: new (F().BooleanField)({ required: false, nullable: true, initial: null }),
    origin: str(),
    reversed: bool(),
    lasts: choice(EFFECT_LASTS),
    recur: choice(EFFECT_RECURRENCES),
    pick: str(),
    max: levelValueField(),
    unread: new (F().ArrayField)(new (F().StringField)({ blank: false })),
    summonFormat: choice(SUMMON_FORMATS),
    control: choice(CONTROL_KINDS),
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
    // `source` reads the alignment of whoever the effect comes from instead of
    // a fixed `vsAlignment`; `vsEnemy` applies only against the source's
    // enemy; `anyOf` is a disjunction ANDed with the clauses above.
    vsAlignmentOf: choice(SCOPE_ALIGNMENT_REFERENCES),
    vsEnemy: bool(),
    anyOf: new (F().ArrayField)(scopeBranch()),
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
    // Gate: the structured form of WHEN a modifier stands, decided against the
    // character's state by the evaluator `lib/typed-modifiers.mjs`
    // `registerGate` holds for `kind` (equipment's `lightlyEquipped`,
    // `activeStyle`, `specializedStyle` and `armourCeiling`, lib's `status` and
    // `light`). The arguments are read off the
    // ability's own page by the import; one it did not read leaves the gate
    // undecided, and the modifier is listed rather than applied. A `light` gate
    // is read at the roll, from the roller's token (`registerGate`'s `at: "roll"`).
    // See docs/lib/API.md, "Typed modifiers".
    gate: new SchemaField({
      kind: str(),
      light: choice(Object.fromEntries(LIGHT_LEVELS.map((level) => [level, level]))), // the dimmest level that satisfies it
      armourMax: str(), // an armour rung: unarmored, veryLight, light, medium, heavy
      // A shield also breaks an `armourCeiling` limit. Null where nothing says
      // so, so a row that never named it stores no verdict either way.
      noShield: new (F().BooleanField)({ required: false, nullable: true, initial: null }),
      loadMax: num(), // in stone
      style: str(), // a fighting-style key
      status: str(), // a status id
      // A status gate on a record's part that belongs to one occasion (the daily
      // save an enervated creature makes) holds only where the roller names
      // that occasion; `partHolds` leaves it pending otherwise.
      occasion: bool(),
    }),
    // shared
    condition: str(), // free-text situational qualifier (when no structured form fits)
    note: str(),
  });
}

/** An array field of `effectField` entries. */
export const effectsField =() => new (F().ArrayField)(effectField());
