/* global foundry */
/**
 * DataModel field-builders for the shared ACKS vocabulary. Foundry-only (they
 * touch `foundry.data.fields`), but every builder is a lazy function so the
 * module still evaluates in Node — `foundry` is only dereferenced when a model
 * is actually defined (at `init` or later). acks-abilities builds its effect
 * model from these; acks-monsters is expected to adopt the defense/sense/speed
 * shapes when it migrates (deferred).
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
  PROGRESSION_CLASSES,
  PROGRESSION_LEVELS,
  SPELL_LIKE_FREQ,
  RESOURCE_KINDS,
  ROLL_TYPES,
  REROLL_KEEP,
  OUTCOME_TRIGGERS,
  VALUE_SCALES,
  VALUE_ROUNDING,
} from "./vocab.mjs";

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

/* --- LevelValue: flat | perLevel | breakpoints | progression --- */
export function levelValueField() {
  const { SchemaField, ArrayField } = F();
  return new SchemaField({
    kind: choice(
      {
        flat: { label: "Flat" },
        perLevel: { label: "Per Level" },
        breakpoints: { label: "Breakpoints" },
        progression: { label: "Progression" },
        conditional: { label: "Conditional on a Scale" },
      },
      { initial: "flat" },
    ),
    flat: num(),
    base: num(),
    per: num(),
    // Shared by `breakpoints` and `conditional`: for the latter `atLevel` reads
    // "at this value of `on`" rather than at this class level.
    breakpoints: new ArrayField(new SchemaField({ atLevel: num({ integer: true }), value: num() })),
    on: choice(VALUE_SCALES), // conditional: which scale the ladder is keyed on
    // Fractional per-level values are printed with their rounding — "a bonus
    // to their Mortal Wounds throw of one-half his class level (round up)".
    // Without this the value resolves to 2.5 at 5th level, which is not a
    // number the rule ever produces.
    round: choice(VALUE_ROUNDING),
    as: choice(PROGRESSION_CLASSES),
    atLevel: choice(PROGRESSION_LEVELS),
  });
}

/**
 * ONE named roll an ability offers.
 *
 * An ability is not one roll. Animal Husbandry diagnoses (11+ / 7+ / 3+ by
 * rank), cures (18+), cures serious injury (14+) and extracts venom
 * (18+ / 14+ / 10+) — four different rolls, three of them on their own rank
 * progression. A single `rollTarget` cannot hold that, and picking one of them
 * to be "the" roll silently loses the rest.
 *
 * The RECIPE says how many rolls an ability has and where each one is written.
 * Everything in this shape — the label, the target, the progression, the
 * qualifier — is read from the reader's own book.
 */
export function rollField() {
  return new (F().SchemaField)({
    key: str(), // stable within the ability, so a macro can name one roll
    label: str(), // what the roll is called
    formula: str(), // "1d20"
    rollType: choice(ROLL_TYPES, { initial: "above" }),
    target: levelValueField(), // flat, per-level, or a rank ladder
    scale: choice(VALUE_SCALES, { initial: "level" }), // what `target` is keyed on
    condition: str(), // when it applies, when that is not unconditional
    note: str(),
  });
}

export const rollsField = () => new (F().ArrayField)(rollField());

/**
 * A pointer to a spell.
 *
 * TODO(magic): this is a PLACEHOLDER. It points at the core system's existing
 * spell item by uuid and carries the printed name as a fallback, which is
 * enough to link and display but models nothing about the spell itself. When
 * the magic work lands, this becomes a real spell primitive (school, range,
 * duration, save, reversibility, ritual/formula cost) and the `spell` string on
 * `effectField` retires in favour of it. Nothing consumes this yet — it exists
 * so the shape is agreed before anything depends on it.
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
    roll: str(), // e.g. "1d20"
    rollType: choice(ROLL_TYPES),
    /* --- attributeSubstitution ---
     * `attribute` is applied INSTEAD OF `insteadOf` on `target`. Both are
     * ATTRIBUTES keys, which are the core system's own score paths, so a
     * consumer swaps `system.scores[insteadOf].mod` for
     * `system.scores[attribute].mod` without a translation table. The rule is
     * always narrowed in prose (Weapon Finesse: tiny/small/medium melee
     * weapons; the bladedancer's: weapons she is proficient with) — that
     * narrowing lives in `condition`, as it does for every other effect. */
    attribute: choice(ATTRIBUTES),
    insteadOf: choice(ATTRIBUTES),
    // progressionAs
    as: choice(PROGRESSION_CLASSES),
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
    /* --- Relational: depend on / grant / alter OTHER abilities ---
     * `ref`/`refs`  the ability this effect targets (modifies) or requires/grants.
     * `ifHas`       gate: the effect applies only while the character also has
     *               these — the books' "if separately proficient in Searching…"
     *               and "if the character also has Bright Lore of Aura…".
     * `mode`        add | replace | set — "instead of" is a replace variant.
     * `stacksWith` / `notStacksWith`  explicit stacking rules, e.g. Diplomacy
     *               stacks with Mystic Aura but NOT Intimidation or Seduction.
     * `choose`      for `grants`: pick N of `refs`. */
    ref: str(),
    refs: refList(),
    ifHas: refList(),
    mode: choice(EFFECT_MODES),
    stacksWith: refList(),
    notStacksWith: refList(),
    choose: num({ integer: true }),
    /* --- Scoping: WHEN this modifier applies to a particular roll ---
     * `condition` (below) is free text a human reads; these are the parts a
     * machine can decide, and `scopeApplies()` in vocab.mjs is the one place
     * that decides them.
     *
     * `vsKinds`     target kind tokens — "animal", "dwarf", "human",
     *               "demi-human", "monster". Beast Friendship is +2 vs normal
     *               animals; without this it stores as an unconditional +2 and
     *               applies to everything the character talks to. The token
     *               vocabulary is the CONSUMER's (acks-influence types actors
     *               from class names and acks-monsters' typing) — lib only
     *               carries the list and does the matching.
     * `vsAlignment` / `vsAlignmentMode`  gate vs sign-flip; see
     *               SCOPE_ALIGNMENT_MODES, which exists because Ancient Pacts
     *               and Deathly Visage are different rules wearing the same
     *               shape.
     * `tones`       restrict to some of the three encounter tones.
     * `optionalRule` the effect obeys a world setting of this name (the By
     *               This Axe dwarven-caste rule is the first). Absent from the
     *               world's settings means enabled — content for an unheard-of
     *               rule should not silently vanish. */
    vsKinds: refList(),
    vsAlignment: choice(ALIGNMENTS),
    vsAlignmentMode: choice(SCOPE_ALIGNMENT_MODES, { initial: "gate" }),
    tones: new (F().ArrayField)(new (F().StringField)({ choices: choicesOf(INFLUENCE_TONES) })),
    optionalRule: str(),
    /* --- Kicker: a rider that fires on a good enough total ---
     * Mystic Aura's "+1, and if that brings the total to 12+ the subject acts
     * as if bewitched" is two mechanics in one sentence. The modifier is the
     * number; this is the rest. `kickerAt` is the total that triggers it,
     * `kickerNote` what happens — deliberately prose, because the outcomes the
     * books describe here (bewitched-while-present, deduces it afterwards) are
     * rulings, not numbers. */
    kickerAt: num({ integer: true }),
    kickerNote: str(),
    /* --- reroll: "roll twice and keep the better" ---
     * `times` is the number of EXTRA rolls (default 1). `keep` decides which
     * result stands; `resolveReroll` reads `rollType` above so "better" means
     * higher on a roll-high throw and lower on a roll-low one. Reuses
     * `target`/`forWhat`/`condition` to say WHAT is rerolled and when. */
    keep: choice(REROLL_KEEP),
    times: num({ integer: true }),
    /* --- outcome: "on a roll of X, Y happens" ---
     * `trigger` picks the machine rule (see OUTCOME_TRIGGERS / outcomeFires).
     * `naturalMax` / `belowFraction` are the page's numbers, located per-seat —
     * an outcome without its number cannot fire and surfaces as undecidable.
     * `consequence` is WHAT happens, a chef conclusion in own words, never the
     * page's sentence. Variant scoping (hasty vs methodical) rides `condition`
     * like every other effect. */
    trigger: choice(OUTCOME_TRIGGERS),
    naturalMax: num({ integer: true }),
    belowFraction: num(),
    consequence: str(),
    /* --- companion: a creature the ability confers ---
     * `ref` is the monster entry id (the recipe knows which — that pointer is
     * not the book's text and ships safely). `actorUuid` is the loaded bucket:
     * empty until the citing book is available or a GM drops an actor in, so a
     * bookless seat still gets the slot and can fill it later. `amount` is how
     * many the ability confers. */
    actorUuid: str(),
    // shared
    condition: str(), // free-text situational qualifier (when no structured form fits)
    note: str(),
  });
}

export const effectsField = () => new (F().ArrayField)(effectField());
