/* global foundry */
/**
 * `acks-lib.template` — a GENERATOR actor: the book's "characteristics by
 * rank/age/tier" pages held as a document that stamps out concrete creatures.
 *
 * THE PROBLEM. Four MM entries (dragon, cacodemon, elemental, vampire thrall)
 * have no stat block — every cell reads "varies by rank/age/tier", resolved by
 * tables on the following pages. They cannot import as `monster` actors, and
 * bulk-materializing the cross product (11 ranks × 5 body forms × …) would be
 * hundreds of near-duplicate actors nobody asked for.
 *
 * THE MODEL. The template actor stores AXES (rank, age, element, HD…), each
 * option carrying ENGINE-READY patches — `system.*` fragments, embedded-item
 * payloads, a name piece, an art path, a description snippet — that the
 * importing module (acks-content) materialized from the reader's own book.
 * Generation is then pure selection + merge (template-logic.mjs): pinned >
 * derived-from-a-dropped-base > rolled per the book's own dice. A dropped base
 * actor makes the same document a MODIFIER (vampire thrall rewriting its
 * victim); with no base the template self-generates. This library never
 * interprets book content — a bookless template simply has empty axes and the
 * sheet says so.
 *
 * All book-derived values live in WORLD data (the hand-typed-table
 * equivalence); the module ships only structure.
 */
import { acksCompatStubs, savingThrowFields } from "../actor-compat.mjs";

export default class TemplateData extends foundry.abstract.TypeDataModel {
  /** Array paths, so FormDataExtended round-trips arrays (system convention). */
  static ARRAY_PATHS = ["axes", "cells", "menu.rows"];

  static defineSchema() {
    const { ArrayField, NumberField, ObjectField, SchemaField, StringField } = foundry.data.fields;
    const str = (opts = {}) => new StringField({ required: false, blank: true, initial: "", ...opts });
    const intN = () => new NumberField({ required: false, nullable: true, initial: null, integer: true });
    const numN = () => new NumberField({ required: false, nullable: true, initial: null });

    /** One selectable option of one axis, with its importer-built patches. */
    const optionField = () =>
      new SchemaField({
        key: str(), // stable slug of the printed row/column label
        label: str(), // the printed label ("Adult (51-75 years)")
        // Short piece for generated names ("Adult"). NULL falls back to the
        // label; the EMPTY STRING means "contributes nothing" — a Standard
        // role must not suffix every generated name with "Standard".
        nameLabel: new StringField({ required: false, nullable: true, blank: true, initial: null }),
        rollMin: intN(), // printed die band, when the page prints one
        rollMax: intN(),
        menuBudget: numN(), // "N abilities" cell feeding the menu roll
        art: str(), // per-option art path (distinct art stays linked)
        tint: str(), // token texture tint ("#b22222") — a dragon's hide color
        merge: new ObjectField(), // system.* patch (engine vocabulary, importer-built)
        items: new ArrayField(new ObjectField()), // embedded-item payloads
        html: str(), // description snippet (lazy tags authored by the importer)
        // Actor-level channels for PRESET options (a family variant is a
        // complete creature): flags (e.g. the Full Monster Sheet extras the
        // importer computed) and prototype-token fragments (size, art).
        flags: new ObjectField(),
        token: new ObjectField(),
      });

    return {
      _schemaVersion: new NumberField({ required: true, initial: 0, integer: true, min: 0 }),

      /** What Generate creates and what it is called. `{age}`/`{element}`… are
       *  axis keys; `{base}` is the dropped base actor's name. */
      output: new SchemaField({
        actorType: str({ initial: "monster" }),
        nameFormat: str(),
      }),

      /** FIXED foundation every generated actor starts from — the stat rows
       *  the template page prints as plain values rather than "varies by…"
       *  (a dragon is always a Monstrosity with lightless vision), applied
       *  BEFORE any axis patch. `flags` carries the matching sheet extras. */
      base: new SchemaField({
        merge: new ObjectField(),
        flags: new ObjectField(),
      }),

      axes: new ArrayField(
        new SchemaField({
          key: str(),
          label: str(),
          roll: str(), // the book's die ("1d100"); "" → uniform
          // MULTI-SELECT axis: several options may apply cumulatively
          // (add-ons — special troops, stacked modifiers) instead of every
          // combination becoming its own option. Defaults to none selected;
          // multi axes never roll.
          multi: new foundry.data.fields.BooleanField({ required: true, initial: false }),
          // Read this choice off a dropped base actor: `from` names a base
          // value ("hd"), `max` caps it (a thrall caps at 8 HD).
          derive: new SchemaField({ from: str(), max: numN() }),
          options: new ArrayField(optionField()),
        })
      ),

      /** N-dimensional refinements: `by` names the axes, `key` the chosen
       *  option keys joined "|" — the dragon's per-age-per-form damage. */
      cells: new ArrayField(
        new SchemaField({
          by: new ArrayField(str()),
          key: str(),
          merge: new ObjectField(),
          items: new ArrayField(new ObjectField()),
        })
      ),

      /** The rolled special-ability menu (cacodemon p.74, dragon p.110). */
      menu: new SchemaField({
        die: str(), // "1d100"; "" → uniform pick
        budgetAxis: str(), // axis whose chosen option carries menuBudget
        rows: new ArrayField(
          new SchemaField({
            min: intN(),
            max: intN(),
            label: str(),
            cost: numN(), // slots spent (null → 1; the dragon prints fractions)
            html: str(), // lazy description snippet for the generated actor
            // A GENERATION sub-roll the ability's own prose enumerates
            // ("roll 1d8 for the type of aura: 1, arcane; …"), materialized
            // by the importer: {die, twice?, outcomes: [{min,max,text}]}.
            // Resolved when the row is rolled; nested rolls inside an outcome
            // stay text for the Judge.
            sub: new ObjectField(),
          })
        ),
      }),

      details: new SchemaField({
        biography: str(), // the template's own description (lazy tags)
      }),

      // The system touches these on every actor (see actor-compat.mjs);
      // without them one template in the world aborts the system's ready sweep.
      ...acksCompatStubs(),
      ...savingThrowFields(),
    };
  }

  /** Same two derived values the system computes for every actor. */
  prepareDerivedData() {
    this.thac0.bba = 10 - (this.thac0.throw ?? 10);
    this.movement.encounter = Math.floor((this.movement.base ?? 0) / 3);
  }

  /** A template with no materialized options yet (bookless seat) — the sheet
   *  explains instead of offering an empty Generate. */
  get isStub() {
    return !(this.axes ?? []).some((a) => (a.options ?? []).length);
  }
}
