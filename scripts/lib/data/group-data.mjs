/* global foundry */
/**
 * `acks-extras.group` — a STACK of near-identical creatures held as one actor:
 * a mercenary platoon, a pack of kobolds, a flight of manes. See
 * docs/lib/GROUPS.md for the model (member records as ActorDeltas, the
 * laziness invariant, the representative individual) and the lifecycle ops
 * (group.mjs).
 *
 * A group is a LIST of `stacks`, not one prototype: a uniform pack is one
 * stack, a mixed unit (10 swordsmen beside 10 spearmen) is two, each with its
 * own base actor and its own sparse roster.
 */
import { acksCompatStubs, creatureAttackModifiers, migrateLegacyCombatSource, savingThrowFields } from "../actor-compat.mjs";
import { attackThrowModifiersFor, damageModifiersFor } from "../patches/attack-throw.mjs";
import { platoonCapacity } from "../group-logic.mjs";
import { clampScore, moraleBounds } from "../score-bounds.mjs";
import { ACTOR_TYPE } from "../vocab.mjs";

/** A roster member's lifecycle. Records only ever exist for non-pristine bodies. */
export const GROUP_STATE = Object.freeze({
  materialized: "materialized", // has a record, resting in the stack (not on canvas)
  deployed: "deployed", // a token exists for this member right now
  detached: "detached", // promoted out to a standalone actor; no longer a body of this group
  dead: "dead", // a casualty, retained for the after-action report
});

/** What the stack represents. Drives wages, morale, and default collective noun. */
export const GROUP_CATEGORY = Object.freeze({
  mercenary: "ACKS-LIB.group.category.mercenary",
  monster: "ACKS-LIB.group.category.monster",
  specialist: "ACKS-LIB.group.category.specialist",
  follower: "ACKS-LIB.group.category.follower",
});

/** The data model for the group actor sub-type, a list of stacks. */
export default class GroupData extends foundry.abstract.TypeDataModel {
  /**
   * Array paths, so a sheet's FormDataExtended (numeric-keyed objects) round-trips
   * back to arrays. Only `stacks` is form-editable at the top level; each stack's
   * `roster` is written by the lifecycle ops (group.mjs) via explicit array
   * writes, never through the form, so it needs no path here.
   */
  static ARRAY_PATHS = ["stacks"];

  static defineSchema() {
    const { ArrayField, DocumentUUIDField, NumberField, ObjectField, SchemaField, StringField } = foundry.data.fields;
    const int = (initial, opts = {}) => new NumberField({ required: true, integer: true, initial, ...opts });
    const str = (opts = {}) => new StringField({ required: false, blank: true, initial: "", ...opts });
    // Money and wages: null = "not stated" (never 0, which would claim "free").
    const coin = () => new NumberField({ required: false, nullable: true, initial: null, min: 0 });

    /**
     * ONE stack: the prototype every one of its bodies copies, a headcount, and
     * a sparse roster. `template.uuid` points at a WORLD actor (ActorDelta needs
     * a real base to merge onto), minted from `snapshot` on first deploy if
     * absent. Named `template`, not `prototype` — see docs/lib/GROUPS.md, "Why
     * the field is `template`, not `prototype`".
     */
    const stack = () =>
      new SchemaField({
        key: str(), // stable stack id (randomID); lifecycle ops address a stack by it
        template: new SchemaField({
          uuid: new DocumentUUIDField({ required: false, blank: true, nullable: true, initial: null }),
          type: str({ initial: "monster" }), // the base actor's type: monster | character | acks-extras.animal
          label: str(),
          snapshot: new ObjectField(),
          snapshotTime: int(0),
        }),
        size: new SchemaField({
          current: int(0, { min: 0 }), // living bodies in THIS stack
          initial: int(0, { min: 0 }),
          // The dice formula the Roll reads (sizeFromEcology), or last rolled.
          formula: str(),
        }),
        // What the last Roll made of this stack. A null total is a stack no roll
        // sized, whose count a roll leaves alone. See docs/lib/GROUPS.md, "The Roll".
        rolled: new SchemaField({
          total: new NumberField({ required: false, nullable: true, integer: true, initial: null, min: 0 }),
          state: str(), // wandering | lair
          context: str(), // dungeon | wilderness
          noun: str(), // the noun this roll wrote, told from one a hand typed
        }),
        // Troops addendum (skirmish scale). `mounted` bodies count DOUBLE toward
        // the RR 169 command capacity (a platoon is 30 infantry OR 15 cavalry).
        // `baseMorale` is this troop type's RR 166 base (−2..+2, demi-humans +1);
        // the consumer sets both from the mercenary rules at hire.
        mounted: new foundry.data.fields.BooleanField({ initial: false }),
        baseMorale: int(0, { min: -4, max: 4 }),
        /** The sparse roster: one entry per body that has diverged. See docs/lib/GROUPS.md, "The laziness invariant". */
        roster: new ArrayField(
          new SchemaField({
            key: str(), // randomID, stable for the member's whole life
            ordinal: int(0), // "Swordsman #7" — assigned once within the stack, never reused
            name: str(), // "" → template label + ordinal at display time
            // ActorDelta-shaped sparse override. Validated by ActorDelta when
            // applied to a token, not here — an ObjectField holds it verbatim.
            delta: new ObjectField(),
            state: new StringField({ required: true, initial: "materialized", choices: GROUP_STATE }),
            tokenUuid: str(), // while deployed
            actorUuid: str(), // if detached to a standalone actor
            note: str(), // free text for the report ("felled by the ogre")
          })
        ),
      });

    return {
      // Schema-version marker, matching the system + animal convention so a
      // future migration can tell an unmigrated group from a current one.
      // v1 introduced `stacks` (was a single top-level template/size/roster).
      _schemaVersion: new NumberField({ required: true, initial: 1, integer: true, min: 0 }),

      /** The stacks that make up this group: one for a uniform pack, several for a mixed unit. */
      stacks: new ArrayField(stack()),

      /**
       * The displayed collective noun, filled from the monster stat block's
       * ecology or the unit category and always GM-overridable. Blank falls
       * back to a category default. See docs/lib/GROUPS.md, "The collective
       * noun is data".
       */
      noun: str(),

      /**
       * What a seat reads off an encounter's token (REVEAL): the noun alone, or
       * the name and the count. Blank is a group that is no encounter, whose
       * token this module leaves alone. See docs/lib/GROUPS.md, "The reveal".
       */
      reveal: str(),

      /** Unit-level bookkeeping — the mercenary/specialist half. Shared across stacks. */
      unit: new SchemaField({
        category: new StringField({ required: true, initial: "monster", choices: GROUP_CATEGORY }),
        troopType: str(), // keys into the henchmen availability/wages tables
        wageGpEach: coin(),
        wageUnit: str({ initial: "month" }),
        employerUuid: str(),
        locationUuid: str(),
        // The commanding officer (RR 171): a lone leveled actor, not a stack.
        // Only the skirmish-scale bit lives here (uuid + cached morale
        // modifier, so `commandMorale` computes without loading the officer);
        // domain-scale command is the army layer's.
        officerUuid: str(),
        officerMoraleBonus: int(0, { min: 0, max: 4 }),
        // The commander's level (cached from the officer, or the personally-leading
        // employer) — drives the RR 169 "personally led" command capacity.
        officerLevel: int(0, { min: 0 }),
        // Unit morale / loyalty (mercenary side). Same signed range the system
        // uses for a monster's morale and a retainer's loyalty.
        morale: int(0, { min: -6, max: 4 }),
        loyalty: int(0, { min: -4, max: 4 }),
      }),

      // --- The representative individual. See docs/lib/GROUPS.md, "The
      // representative individual". ---
      ...acksCompatStubs(),
      ...savingThrowFields(),
      hp: new SchemaField({
        hd: new StringField({ required: true, initial: "1d8", blank: false }),
        value: new NumberField({ required: true, initial: 4 }),
        max: new NumberField({ required: true, initial: 4 }),
        bhr: new StringField({ required: true, initial: "1d3", blank: false }),
      }),
      damage: new SchemaField({
        mod: new SchemaField({
          missile: new NumberField({ initial: 0 }),
          melee: new NumberField({ initial: 0 }),
        }),
      }),
      details: new SchemaField({
        biography: new StringField({ blank: true, initial: "" }),
        alignment: new StringField({ blank: true, initial: "Neutral" }),
        xp: new NumberField({ initial: 0 }),
        morale: new NumberField({ integer: true, min: -6, max: 4, initial: 0 }),
      }),
    };
  }

  /**
   * A source stored under the system's earlier combat field names is read onto
   * the current ones.
   * @override
   */
  static migrateData(source) {
    migrateLegacyCombatSource(source);
    return super.migrateData(source);
  }

  /**
   * A group's token is linked from the start: stacks live on the world actor,
   * and an unlinked token would write them to its delta alone. An explicit
   * `actorLink` in the create data stands.
   * @override
   */
  async _preCreate(data, options, user) {
    const allowed = await super._preCreate(data, options, user);
    if (allowed === false) return false;
    if (data.prototypeToken?.actorLink === undefined) this.parent.updateSource({ "prototypeToken.actorLink": true });
    return allowed;
  }

  /**
   * The encounter speed the system derives for every actor, so a group is not
   * the one token on the table without one. Mirrors AnimalData.prepareDerivedData.
   * @override
   */
  prepareDerivedData() {
    this.movement.encounter = Math.floor((this.movement.base ?? 0) / 3);
  }

  /** The attack throw's modifiers from the representative body: its Tweaks adjustment for the attack's kind, then the attack seam's. */
  getAttackThrowModifiers(attackType) {
    return attackThrowModifiersFor(this, attackType, creatureAttackModifiers(this, attackType).attack);
  }

  /** The damage roll's modifiers from the representative body: its Tweaks adjustment for the attack's kind, then the attack seam's. */
  getDamageModifiers(attackType) {
    return damageModifiersFor(this, attackType, creatureAttackModifiers(this, attackType).damage);
  }

  /* -------------------------------------------- */
  /*  Derived views (pure — safe offline)          */
  /* -------------------------------------------- */

  /** Find a stack by its key. */
  stackOf(key) {
    return this.stacks.find((s) => s.key === key) ?? null;
  }

  /** The first stack — the one the representative-individual block mirrors. */
  get primaryStack() {
    return this.stacks[0] ?? null;
  }

  /** A stack's members with a record that are still living bodies. */
  livingRecordedOf(stack) {
    return (stack?.roster ?? []).filter((m) => m.state === "materialized" || m.state === "deployed");
  }

  /**
   * A stack's living bodies that have NO record — the sparse difference. Never
   * negative: a corrupt world where records outnumber the headcount reads as
   * zero pristine rather than a negative count.
   */
  pristineCountOf(stack) {
    return Math.max(0, (stack?.size?.current ?? 0) - this.livingRecordedOf(stack).length);
  }

  /** A stack's casualties retained for the after-action report. */
  deadOf(stack) {
    return (stack?.roster ?? []).filter((m) => m.state === "dead");
  }

  /* --- group-wide aggregates --- */

  /** Total living bodies across every stack. */
  get totalCurrent() {
    return this.stacks.reduce((n, s) => n + (s.size?.current ?? 0), 0);
  }

  /** Total pristine (recordless) bodies across every stack. */
  get totalPristine() {
    return this.stacks.reduce((n, s) => n + this.pristineCountOf(s), 0);
  }

  /** Total casualties across every stack. */
  get totalDead() {
    return this.stacks.reduce((n, s) => n + this.deadOf(s).length, 0);
  }

  /**
   * The invariant that must always hold in EVERY stack: a stack's headcount is
   * never smaller than its living records. Callers assert this after any
   * mutation; the sheet surfaces a warning if a hand-edited world breaks it.
   */
  get invariantHolds() {
    return this.stacks.every((s) => (s.size?.current ?? 0) >= this.livingRecordedOf(s).length);
  }

  /** Unit morale including the commanding officer's RR 171 modifier (skirmish
   *  scale), held to the morale range the system gives a character
   *  (`moraleBounds`), the hireling's own score. `unit.morale` carries the
   *  employer's leader modifiers (CHA, Command, led-by-5th …) that the consumer
   *  computes; a stack's own troop-type base is added per stack. */
  get commandMorale() {
    const m = (this.unit?.morale ?? 0) + (this.unit?.officerMoraleBonus ?? 0);
    return clampScore(m, moraleBounds(ACTOR_TYPE.character));
  }

  /** One stack's effective morale: its troop-type base + the shared leader
   *  modifiers (employer + officer), held to the same range (RR 166). */
  unitMoraleOf(stack) {
    return clampScore((stack?.baseMorale ?? 0) + this.commandMorale, moraleBounds(ACTOR_TYPE.character));
  }

  /* --- RR 169 command capacity (skirmish "personally led") --- */

  /** Group strength in INFANTRY-EQUIVALENTS: living bodies, cavalry counted
   *  double (a platoon is 30 infantry OR 15 cavalry). */
  get troopStrength() {
    return this.stacks.reduce((n, s) => n + (s.size?.current ?? 0) * (s.mounted ? 2 : 1), 0);
  }

  /** How many infantry-equivalents the commanding officer may personally lead
   *  (RR 169), from the cached commander level. 0 = no valid commander. */
  get commandCapacity() {
    return platoonCapacity(this.unit?.officerLevel ?? 0);
  }

  /** True when the group is larger than its commander can personally lead — it
   *  needs a higher-level officer, or (past a platoon) the multi-unit army
   *  command structure that is army scale, not skirmish scale. A group with
   *  troops but no commander (capacity 0) is over-command by definition. */
  get overCommand() {
    const cap = this.commandCapacity;
    return cap > 0 ? this.troopStrength > cap : this.troopStrength > 0;
  }
}
