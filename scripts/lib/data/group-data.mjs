/* global foundry */
/**
 * `acks-lib.group` — a STACK of near-identical creatures held as one actor:
 * a mercenary platoon, a pack of kobolds, a flight of manes.
 *
 * THE PROBLEM. A hired mercenary platoon is, in the system today, ONE
 * `character` actor with `system.retainer.quantity = 30`. The 30 is a label:
 * there is no per-body hit points, no casualties, no "this one has a different
 * sword". The same gap swallows every monster group. But the books stat these
 * as many individuals who happen to be alike, and play needs them to diverge —
 * one takes an arrow, one loots a better blade, one becomes a named villain.
 *
 * THE MODEL. Foundry already has a sparse per-instance override document: an
 * unlinked token's `ActorDelta` stores only what differs from its base actor,
 * embedded item overrides included, and the acks system already writes into it
 * (an unlinked monster token rolls its HP straight into `token.delta`). So a
 * member's individuality IS an ActorDelta source object — same shape, same
 * merge rules — and a member that has never diverged needs NO record at all.
 *
 * MANY STACKS PER GROUP. A group is not one prototype but a LIST of `stacks`.
 * A uniform pack is one stack; a mixed unit — 10 swordsmen beside 10 spearmen —
 * is two, each with its OWN base actor. Different gear is then just a different
 * base actor, not a per-body override: the ActorDelta layer above still handles
 * the divergence WITHIN a stack (one swordsman loots a better blade), while the
 * coarse "these ten are archers, those ten are pikes" split is a second stack.
 * Each stack is a self-contained sub-group: its own prototype, its own
 * headcount, its own sparse roster tracking its own bodies' HP and casualties.
 *
 * THE INVARIANT (per stack). `size.current` counts a stack's living bodies. Its
 * `roster` holds a record ONLY for members that have become interesting
 * (materialized, deployed to the canvas, detached to their own actor, or
 * fallen). Pristine bodies are the DIFFERENCE:
 *
 *     pristine = stack.size.current − (materialized + deployed records)
 *
 * A 30-strong platoon that has never fought is one stack, `size.current: 30,
 * roster: []`. Storage is proportional to how interesting the group has become,
 * not to its headcount. That is the whole point.
 *
 * THE COMPAT STRATEGY is deploy/recall (see group.mjs): a deployed member is an
 * ordinary token over an ordinary actor, so combat, acks-equipment and
 * acks-formation all work on it with no special-casing. Undeployed, the group
 * carries a REPRESENTATIVE INDIVIDUAL's stat block (the FIRST stack's one-body
 * hp/aac/saves) so the token is still attackable and shows a sensible bar — the
 * same reason `acks-lib.animal` mirrors the monster field paths (actor-compat).
 */
import { acksCompatStubs, savingThrowFields } from "../actor-compat.mjs";
import { migrateGroupSource, platoonCapacity } from "../group-logic.mjs";

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
     * a real world base to merge onto — a compendium entry cannot be that base),
     * minted from `snapshot` on first deploy if absent. `snapshot` is a cached
     * `toObject()` so the stack survives its source being deleted.
     *
     * NAMED `template`, NOT `prototype`: Foundry blocks `prototype` (with
     * `__proto__` and `constructor`) as a forbidden key in dotted-path expansion
     * — a prototype-pollution guard — so a field named `prototype` can never be
     * written via `actor.update({"system…prototype.x": …})`; the key is silently
     * dropped. Verified live against acks 14.0.1.
     */
    const stack = () =>
      new SchemaField({
        key: str(), // stable stack id (randomID); lifecycle ops address a stack by it
        template: new SchemaField({
          uuid: new DocumentUUIDField({ required: false, blank: true, nullable: true, initial: null }),
          type: str({ initial: "monster" }), // the base actor's type: monster | character | acks-lib.animal
          label: str(),
          snapshot: new ObjectField(),
          snapshotTime: int(0),
        }),
        size: new SchemaField({
          current: int(0, { min: 0 }), // living bodies in THIS stack
          initial: int(0, { min: 0 }),
          // Ecology seam (group.mjs sizeFromEcology): a dice formula, NOT auto-rolled.
          formula: str(),
        }),
        // Troops addendum (skirmish scale). `mounted` bodies count DOUBLE toward
        // the RR 169 command capacity (a platoon is 30 infantry OR 15 cavalry).
        // `baseMorale` is this troop type's RR 166 base (−2..+2, demi-humans +1);
        // the consumer sets both from the mercenary rules at hire.
        mounted: new foundry.data.fields.BooleanField({ initial: false }),
        baseMorale: int(0, { min: -4, max: 4 }),
        /**
         * THE SPARSE ROSTER. One entry per body of this stack that has diverged;
         * pristine bodies are absent by design (see the class comment's invariant).
         */
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

      /**
       * The stacks that make up this group. One for a uniform pack; several for a
       * mixed unit (10 swordsmen + 10 spearmen). Each is self-contained: its own
       * prototype, headcount, and roster with its own HP/casualty tracking.
       */
      stacks: new ArrayField(stack()),

      /**
       * The displayed collective noun is DATA, not a hardcoded word: a *pack* of
       * kobolds wandering, a *tribe* in its lair, a *unit* of mercenaries. Filled
       * from acks-monsters ecology (`encounter.*.noun`) or the unit category, and
       * always GM-overridable. Blank → the sheet falls back to a category default.
       */
      noun: str(),

      /** Unit-level bookkeeping — the mercenary/specialist half. Shared across stacks. */
      unit: new SchemaField({
        category: new StringField({ required: true, initial: "monster", choices: GROUP_CATEGORY }),
        troopType: str(), // keys into the henchmen availability/wages tables
        wageGpEach: coin(),
        wageUnit: str({ initial: "month" }),
        employerUuid: str(),
        locationUuid: str(),
        // The commanding officer (RR 171): a lone leveled actor, not a stack —
        // an officer is a unique individual who COMMANDS the troop stacks. The
        // troops addendum keeps only the skirmish-scale bit here: the uuid and a
        // cached morale modifier the officer confers, so `commandMorale` is
        // computable without loading the officer. Domain-scale command (how many
        // units an officer leads across an army) is acks-troops, not here.
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

      // --- The representative individual (design §8). ---
      // The GROUP token (undeployed) mirrors the FIRST stack's one-body stat
      // block so it is attackable and shows a bar. The compat stubs are the FLOOR
      // the system touches on every actor (isNew, thac0, initiative, movement, a
      // saves stub); savingThrowFields then supplies the FULL five-save block
      // (later keys win, so it upgrades the stub's partial saves). Per-stack stats
      // otherwise live in each stack's template.snapshot.
      ...acksCompatStubs(),
      ...savingThrowFields(),
      hp: new SchemaField({
        hd: new StringField({ required: true, initial: "1d8", blank: false }),
        value: new NumberField({ required: true, initial: 4 }),
        max: new NumberField({ required: true, initial: 4 }),
        bhr: new StringField({ required: true, initial: "1d3", blank: false }),
      }),
      aac: new SchemaField({
        value: new NumberField({ initial: 0 }),
        mod: new NumberField({ initial: 0 }),
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
   * v0 → v1: a single-stack group carried `template`/`size`/`roster` at the top
   * level. Fold them into `stacks[0]` (a fixed key so the migration is stable
   * across the reloads before it is next saved). The representative block
   * (hp/aac/saves/details) stayed at the top level and needs no move — it still
   * mirrors what is now the first stack.
   * @override
   */
  static migrateData(source) {
    migrateGroupSource(source);
    return super.migrateData(source);
  }

  /**
   * The same two values the system derives for every actor, so a group is not
   * the one token on the table with an empty attack bonus or encounter speed.
   * Mirrors AnimalData.prepareDerivedData exactly.
   * @override
   */
  prepareDerivedData() {
    this.thac0.bba = 10 - (this.thac0.throw ?? 10);
    this.movement.encounter = Math.floor((this.movement.base ?? 0) / 3);
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
   *  scale). Clamped to the same signed band unit morale uses. `unit.morale`
   *  carries the employer's leader modifiers (CHA, Command, led-by-5th …) that
   *  the consumer computes; a stack's own troop-type base is added per stack. */
  get commandMorale() {
    const m = (this.unit?.morale ?? 0) + (this.unit?.officerMoraleBonus ?? 0);
    return Math.max(-4, Math.min(4, m));
  }

  /** One stack's effective morale: its troop-type base + the shared leader
   *  modifiers (employer + officer). Clamped to the RR 166 −4..+4 band. */
  unitMoraleOf(stack) {
    return Math.max(-4, Math.min(4, (stack?.baseMorale ?? 0) + this.commandMorale));
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
   *  command structure that is acks-troops, not skirmish scale. A group with
   *  troops but no commander (capacity 0) is over-command by definition. */
  get overCommand() {
    const cap = this.commandCapacity;
    return cap > 0 ? this.troopStrength > cap : this.troopStrength > 0;
  }
}
