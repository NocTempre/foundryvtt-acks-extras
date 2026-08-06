/* global foundry */
/**
 * Data model for the `acks-extras.class` Item sub-type — a character class as
 * a DOCUMENT: the printed progression tables, the ability inventory, the
 * per-level award ladder, casting traditions, and the eight starting
 * templates.
 *
 * The model is structure only. Every value a printed page supplies — XP
 * thresholds, save bands, titles, hit dice, proficiency lists, template
 * contents — reaches a world through acks-importer, materialized from the
 * GM's own book, or is typed by hand into the constructor sheet. A blank
 * class document is a valid homebrew starting point, never an error.
 *
 * Save bands store the BOOK's vocabulary (`blast`, `spells`); the released
 * system's actor keys (`breath`, `spell`) are the write layer's concern —
 * see lib/actor-compat.mjs `savesUpdateData`.
 */
import { num, str, int, bool, html, choice, choiceSet, refList, levelValueField, spellRefField } from "../lib/fields.mjs";
import { choiceSpecField } from "../lib/choice-spec.mjs";
import { ATTRIBUTES } from "../lib/vocab.mjs";
import { CASTING_KINDS, REPERTOIRE_KINDS } from "./constants.mjs";

/** Award kinds: an automatic grant at a level, or an offered pick. */
export const AWARD_KINDS = {
  fixed: { label: "Fixed Grant" },
  choice: { label: "Choice" },
};

export default class ClassData extends foundry.abstract.TypeDataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric-keyed objects. */
  static ARRAY_PATHS = [
    "requirements",
    "levels",
    "ladders",
    "saves",
    "attack",
    "awards",
    "casting",
    "racialTraits",
    "templates",
  ];

  static defineSchema() {
    const { ArrayField, SchemaField } = foundry.data.fields;

    /** One printed level-progression row, exactly as the table prints it. */
    const levelRow = () =>
      new SchemaField({
        level: int(1, { min: 0 }),
        xp: num({ integer: true }),
        title: str(),
        hd: str(), // "5d8", "9d8 + 2" — the flat post-9 bonus keeps the book's no-CON footnote semantics
      });

    /** One rung of a named numeric ladder (an extra progression column). */
    const ladderRung = () =>
      new SchemaField({
        atLevel: int(1, { min: 0 }),
        value: num(),
        text: str(), // non-numeric cells ("+2d" backstab dice) — value stays null
      });

    /** One printed save band; null cells mean "not printed" (never 0). */
    const saveBand = () =>
      new SchemaField({
        minLevel: int(1, { min: 0 }),
        maxLevel: num({ integer: true }), // null = open-ended
        paralysis: num(),
        death: num(),
        blast: num(),
        implements: num(),
        spells: num(),
      });

    const attackBand = () =>
      new SchemaField({
        minLevel: int(1, { min: 0 }),
        maxLevel: num({ integer: true }),
        throw: num(),
      });

    /** One award-ladder entry (flat: each row carries its own level). */
    const award = () =>
      new SchemaField({
        atLevel: int(1, { min: 0 }),
        kind: choice(AWARD_KINDS, { initial: "fixed" }),
        ref: str(), // fixed: the granted ability (cookbook id or uuid:…)
        name: str(), // display fallback while the ref is unresolved
        choice: choiceSpecField(), // choice: the offer
        note: str(),
      });

    /** One casting tradition (0 for most classes; 2 only for the Nobiran). */
    const tradition = () =>
      new SchemaField({
        key: str(), // "arcane" / "divine" — stable within the class
        label: str(),
        kind: choice(CASTING_KINDS, { initial: "vancian" }),
        repertoire: choice(REPERTOIRE_KINDS),
        spellList: refList(),
        // vancian: printed slots per spell level, one row per class level
        slots: new ArrayField(
          new SchemaField({
            atLevel: int(1, { min: 0 }),
            s1: num({ integer: true }),
            s2: num({ integer: true }),
            s3: num({ integer: true }),
            s4: num({ integer: true }),
            s5: num({ integer: true }),
            s6: num({ integer: true }),
          }),
        ),
        // non-vancian capacity (points, gnosis…): one number per class level
        pool: new ArrayField(new SchemaField({ atLevel: int(1, { min: 0 }), value: num() })),
        casterLevel: str(), // ladder key when caster level lags class level ("" = class level)
      });

    /** One granted ability inside a starting template's bundle. */
    const templateAbility = () =>
      new SchemaField({
        ref: str(),
        name: str(), // the printed cell text ("Manual of Arms 2")
        rank: int(1, { min: 1 }),
        selection: str(), // parenthesized specialization ("weapon & shield")
        role: str(), // bold-cell convention: "region" / "joat" / "mandatory" / "intBonus" / "totem"
        choice: choiceSpecField(), // a pick the cell offers instead of a fixed grant
      });

    /** One granted item inside a template's bundle, with its printed skin. */
    const templateItem = () =>
      new SchemaField({
        ref: str(), // base equipment doc (cookbook id or uuid:…)
        name: str(), // the printed descriptor ("long bearded axe")
        qty: int(1, { min: 1 }),
        skinName: str(), // display name for the skinned copy ("" = use `name`)
        note: str(),
        choice: choiceSpecField(),
      });

    /** One printed starting template (8 per class, 3d6 bands). */
    const template = () =>
      new SchemaField({
        rollMin: int(3, { min: 3, max: 18 }),
        rollMax: int(4, { min: 3, max: 18 }),
        name: str(),
        annotation: str(), // parenthetical variant ("Jutland", a dark path, a tradition)
        caste: str(), // the dwarven templates' fifth column
        abilities: new ArrayField(templateAbility()),
        items: new ArrayField(templateItem()),
        spells: new ArrayField(spellRefField()),
        gp: num(),
        enc: str(), // printed encumbrance parenthetical, display only
        alt: str(), // Notes-driven alternates ("without banner", elemental spell swaps)
      });

    return {
      _schemaVersion: int(0, { min: 0 }),

      /** Stable slug ("fighter"); chassis borrowing and the registry key on it. */
      key: str(),
      source: new SchemaField({
        book: str(), // "rr"
        cite: str(), // "RR p.24"
        ref: str(), // cookbook entry id ("def.class.fighter")
      }),

      description: html(), // lazy @PdfText content, or hand-written homebrew prose
      codeOfBehavior: html(),

      requirements: new ArrayField(new SchemaField({ attr: choice(ATTRIBUTES), min: num({ integer: true }) })),
      keyAttributes: choiceSet(ATTRIBUTES),
      maximumLevel: int(14, { min: 1 }),
      hitDie: str(), // "1d8"

      levels: new ArrayField(levelRow()),
      ladders: new ArrayField(
        new SchemaField({
          key: str(), // "damageBonus", "acBonus", "backstab", "casterLevel", "hiding"…
          label: str(),
          values: new ArrayField(ladderRung()),
        }),
      ),

      /** "" = this class prints its own bands below; else a chassis class key. */
      saveChassis: str(),
      attackChassis: str(),
      saves: new ArrayField(saveBand()),
      attack: new ArrayField(attackBand()),

      cleaves: levelValueField(),

      /** Demi-human tables carry racial modifiers pre-applied — consumers must
       *  never add a racial-trait save bonus on top of a factored table. */
      factored: bool(),
      /** Offered by default in the pickers; everything else sits behind the
       *  show-all toggle. The book's six core classes ship marked. */
      core: bool(),
      racialTraits: new ArrayField(new SchemaField({ name: str(), ref: str(), html: html() })),

      /** The class's pool of available abilities — every class-scoped chooser
       *  and the constructor's browsers draw from here. */
      inventory: new SchemaField({
        classProfs: refList(),
        powers: refList(),
        skills: new ArrayField(new SchemaField({ ref: str(), ladderKey: str() })),
      }),
      /** Printed proficiency names that matched no world document at
       *  materialize time — surfaced by the sheet, never silently dropped. */
      unresolvedProfs: refList(),

      awards: new ArrayField(award()),

      casting: new ArrayField(tradition()),

      templates: new ArrayField(template()),
    };
  }

  /**
   * Normalize raw form/system input: reconstructs arrays from
   * FormDataExtended's numeric-keyed objects (every path in ARRAY_PATHS plus
   * the nested per-row arrays), leaving schema coercion to the model.
   */
  static normalize(raw) {
    const data = foundry.utils.deepClone(raw ?? {});
    const toArray = (obj, path) => {
      const value = foundry.utils.getProperty(obj, path);
      if (value && !Array.isArray(value) && typeof value === "object") {
        foundry.utils.setProperty(obj, path, Object.values(value));
      }
      return foundry.utils.getProperty(obj, path);
    };
    for (const path of ClassData.ARRAY_PATHS) toArray(data, path);
    for (const ladder of data.ladders ?? []) toArray(ladder, "values");
    for (const trad of data.casting ?? []) {
      toArray(trad, "slots");
      toArray(trad, "pool");
    }
    for (const t of data.templates ?? []) {
      toArray(t, "abilities");
      toArray(t, "items");
      toArray(t, "spells");
    }
    toArray(data, "inventory.skills");
    return data;
  }

  /** A class with no progression rows yet — the sheet explains instead of
   *  offering an empty apply. */
  get isStub() {
    return !(this.levels ?? []).length;
  }

  /** The printed row for one class level (null when absent). */
  levelRow(level) {
    return (this.levels ?? []).find((r) => r.level === level) ?? null;
  }

  /** XP threshold of the NEXT level, null at (or past) maximum level. */
  nextXp(level) {
    if (level >= this.maximumLevel) return null;
    return this.levelRow(level + 1)?.xp ?? null;
  }
}
