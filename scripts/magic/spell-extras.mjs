/* global foundry */
/**
 * SpellExtras — the spell primitive the core ACKS `spell` item does not
 * carry. Stored at `item.flags["acks-extras"].spell` (NOT a document
 * sub-type: every consumer keys on `type === "spell"`, and core's packs, the
 * community compendia and hand-made spells are all spell Items). Core keeps
 * owning name, description, `lvl`, `class`, `range`, `duration`, `save`,
 * `roll` and the cast counter; this adds the structured stat line — which
 * lists at which levels, the type, the shapes a range and a duration take,
 * casting time, components, target, save — the reversal pair, and the
 * executable effect rows in the shared vocabulary.
 *
 * Core's display strings are WRITTEN from this flag wherever it states a
 * shape (`spell-logic.mjs` `coreFieldsFrom`): the sheet derives them on
 * submit and the importer writes both at once.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { num, str, bool, choice, choiceSet, effectsField, levelValueField, spellRefField } from "../lib/fields.mjs";
import {
  SPELL_TYPES,
  RANGE_SHAPES,
  DISTANCE_UNITS,
  DURATION_SHAPES,
  TIME_UNITS,
  CONCENTRATION_KINDS,
  CASTING_TIME_SHAPES,
  TARGET_MODELS,
  AREA_SHAPES,
  TARGET_FILTERS,
  SAVE_CATEGORIES,
  SAVE_EFFECTS,
} from "../lib/magic-vocab.mjs";
import { splitList } from "./spell-logic.mjs";

const asArray = (v) => (v && !Array.isArray(v) && typeof v === "object" ? Object.values(v) : v);

export default class SpellExtras extends foundry.abstract.DataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric-keyed objects. */
  static ARRAY_PATHS = ["lists", "effects"];
  /** Lists the sheet edits as one comma-separated line. */
  static CSV_PATHS = ["schools", "elements", "components"];

  static defineSchema() {
    const { SchemaField, ArrayField } = foundry.data.fields;
    const strList = () => new ArrayField(str());
    return {
      // Which lists the spell prints on, at which level, for which classes. A
      // spell may print on several at different levels; the first row is
      // what core's `lvl` and `class` show. `source` is an OPEN magic-type
      // key (arcane, divine, …), never a closed enum — the set of magic types
      // is data (docs/classes/DECISIONS.md, 2026-08-11).
      lists: new ArrayField(
        new SchemaField({ source: str(), level: num({ integer: true }), classes: strList(), note: str() }),
      ),
      type: choice(SPELL_TYPES),
      // Open vocabulary keys, validated against the world's vocabulary
      // document rather than a schema list (docs/magic/DECISIONS.md, "A code
      // enum names a mechanism; a pick-list ships empty").
      schools: strList(),
      elements: strList(),
      range: new SchemaField({
        shape: choice(RANGE_SHAPES),
        value: num(),
        unit: choice(DISTANCE_UNITS, { initial: "feet" }),
        note: str(),
      }),
      duration: new SchemaField({
        shape: choice(DURATION_SHAPES),
        value: num(),
        unit: choice(TIME_UNITS),
        dice: str(), // the `dice` shape: "1d6"
        plus: new SchemaField({ value: num(), unit: choice(TIME_UNITS) }), // basePlusPerLevel / concentrationPlus
        concentration: choice(CONCENTRATION_KINDS),
        maxPerLevel: bool(), // concentrationMax: the maximum is per caster level
        note: str(),
      }),
      castingTime: new SchemaField({
        shape: choice(CASTING_TIME_SHAPES),
        value: num(),
        unit: choice(TIME_UNITS),
        note: str(),
      }),
      components: strList(),
      target: new SchemaField({
        model: choice(TARGET_MODELS),
        count: levelValueField(),
        hdPool: levelValueField(),
        area: new SchemaField({ shape: choice(AREA_SHAPES), size: levelValueField(), height: num() }),
        filters: choiceSet(TARGET_FILTERS),
        beholding: bool(),
        note: str(),
      }),
      save: new SchemaField({
        category: choice(SAVE_CATEGORIES),
        effect: choice(SAVE_EFFECTS),
        perTarget: bool(),
        modifier: levelValueField(),
        note: str(),
      }),
      // One Item per printed entry; a reversible pair is linked both ways.
      reversible: bool(),
      reverseOf: spellRefField(),
      reversedName: str(),
      // Learned and cast through research (RR ch. 8); imported with the
      // spells so the document exists before the procedure does.
      ritual: bool(),
      // The executable rows — the lib effect vocabulary, spell kinds included.
      effects: effectsField(),
      notableUse: str(),
      cite: str(), // book and page — a reference ships; the sentence beside it never does
      // Set while the rows below are a machine draft not yet read against the page.
      unaudited: bool(),
    };
  }

  /* -------------------------------------------- */

  /** Build from an item's stored flag (lenient: never throws on stale data). */
  static fromItem(item) {
    const raw = item?.getFlag?.(MODULE_ID, FLAG_SPELL) ?? item?.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {};
    try {
      return SpellExtras.fromSource(foundry.utils.deepClone(raw), { strict: false });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not parse spell extras; using defaults`, err);
      return new SpellExtras({});
    }
  }

  /** Whether an item carries the primitive at all (a core-pack monster attack does not). */
  static has(item) {
    const raw = item?.flags?.[MODULE_ID]?.[FLAG_SPELL];
    return !!raw && typeof raw === "object" && Object.keys(raw).length > 0;
  }

  /**
   * Normalize raw form/flag input into a complete, cleaned object: arrays
   * rebuilt from FormDataExtended's numeric-keyed objects, comma lines split,
   * filter boxes folded to the keys that are ticked, then the whole through
   * the schema (defaults + coercion, null-safe).
   */
  static normalize(raw) {
    const data = foundry.utils.deepClone(raw ?? {});
    for (const path of SpellExtras.ARRAY_PATHS) {
      const value = foundry.utils.getProperty(data, path);
      if (value && !Array.isArray(value) && typeof value === "object") {
        foundry.utils.setProperty(data, path, Object.values(value));
      }
    }
    if (Array.isArray(data.lists)) {
      for (const row of data.lists) {
        if (!row || typeof row !== "object") continue;
        row.classes = typeof row.classes === "string" ? splitList(row.classes) : (asArray(row.classes) ?? []);
      }
    }
    for (const path of SpellExtras.CSV_PATHS) {
      if (typeof data[path] === "string") data[path] = splitList(data[path]);
      else if (data[path]) data[path] = asArray(data[path]);
    }
    const filters = data.target?.filters;
    if (filters && !Array.isArray(filters) && typeof filters === "object") {
      data.target.filters = Object.entries(filters)
        .filter(([, on]) => on === true || on === "true")
        .map(([key]) => key);
    }
    return SpellExtras.fromSource(data, { strict: false }).toObject();
  }
}
