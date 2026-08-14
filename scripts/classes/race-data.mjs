/* global foundry */
/**
 * Data model for the `acks-extras.race` Item sub-type — a RACE as a document:
 * the racial-value ladder the Judges Journal's class builder spends (0–4,
 * each rung an XP cost, a level cap and the racial powers it grants), plus
 * the race's attribute minimums and prose.
 *
 * The model is structure only: every rung's numbers and every power the book
 * prints reach a world through acks-importer (`def.race.<key>` cookbook
 * entries), or are typed by hand. A race document serves both class modes —
 * advanced mode spends its ladder through the builder, and a simple-mode
 * (imported) class may bind one by ref so its racial traits resolve from the
 * race instead of being restated per class.
 */
import { num, str, int, bool, html, choice, refList } from "../lib/fields.mjs";
import { ATTRIBUTES } from "../lib/vocab.mjs";

export default class RaceData extends foundry.abstract.TypeDataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric-keyed objects. */
  static ARRAY_PATHS = ["values", "minimumAttributes", "traits", "postEight"];

  static defineSchema() {
    const { ArrayField, SchemaField } = foundry.data.fields;

    /** One rung of the racial-value ladder (value 0 is a legal rung: the
     *  book's demi-human 0 classes pay its cost and take its powers). */
    const valueRung = () =>
      new SchemaField({
        value: int(0, { min: 0 }),
        label: str(), // the book's row label ("Dwarf + 2 Proficiencies")
        xpCost: num({ integer: true }), // null = not printed / not imported yet
        maxLevel: num({ integer: true }), // level cap this rung imposes; null = none
        powers: refList(), // racial powers granted AT this rung (cookbook id or uuid:…)
        note: str(),
      });

    return {
      _schemaVersion: int(0, { min: 0 }),

      /** Stable slug ("elf"); builder race refs and dedup key on it. */
      key: str(),
      source: new SchemaField({
        book: str(),
        cite: str(),
        ref: str(), // cookbook entry id ("def.race.elf")
      }),

      description: html(),

      /** Attribute floors the race imposes on any class built with it. */
      minimumAttributes: new ArrayField(new SchemaField({ attr: choice(ATTRIBUTES), min: num({ integer: true }) })),

      /** The racial-value ladder, one rung per spendable value (usually 0–4). */
      values: new ArrayField(valueRung()),

      /** Always-on traits outside the ladder (tongues, size), for the sheet
       *  and for simple-mode classes that bind this race by ref. */
      traits: new ArrayField(new SchemaField({ name: str(), ref: str(), html: html() })),

      /**
       * The tongues this race is born to (RR §I.10: a demi-human begins with
       * its racial language, Common, and certain others). Same shape and same
       * reasoning as the class's — names the book prints, resolved against
       * the world at grant time — and the two ADD: an elven fighter speaks
       * what the race brings and what the class brings.
       */
      languages: new SchemaField({
        granted: refList(),
        count: int(0, { min: 0 }),
      }),

      /** The race's printed save modifiers are already factored into its
       *  classes' printed save tables — the same warning ClassData carries. */
      factored: bool(),

      /**
       * Magic category this race's value STACKS with (JJ: elf points "stack
       * with points allocated to the Arcane Value"). "" = no stacking. The
       * builder adds the racial value to that category's effective value.
       */
      stacksWith: str(),
      /** Printed XP discount on the stacked category's cost (the elf's
       *  Arcane reduction). Null when the race prints none. */
      stackXpDiscount: num({ integer: true }),
      /** Extra hit points per level past 9th the race prints. */
      hpAfter9: num({ integer: true }),
      /** Post-8th-level XP increases: `chassis` is a saves-chassis key,
       *  "crusaderThief" for the shared tier, or "" for every chassis. */
      postEight: new ArrayField(new SchemaField({ chassis: str(), delta: num({ integer: true }) })),
    };
  }

  /** Reconstruct arrays from FormDataExtended's numeric-keyed objects. */
  static normalize(raw) {
    const data = foundry.utils.deepClone(raw ?? {});
    for (const path of RaceData.ARRAY_PATHS) {
      const value = foundry.utils.getProperty(data, path);
      if (value && !Array.isArray(value) && typeof value === "object") {
        foundry.utils.setProperty(data, path, Object.values(value));
      }
    }
    return data;
  }

  /** The ladder rung for one racial value (null when absent). */
  valueRung(value) {
    return (this.values ?? []).find((r) => r.value === value) ?? null;
  }
}
