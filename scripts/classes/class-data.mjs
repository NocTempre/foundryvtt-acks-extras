/* global foundry */
/**
 * Data model for the `acks-extras.class` Item sub-type — a character class as
 * a DOCUMENT: the printed progression tables, the ability inventory, the
 * per-level award ladder, casting traditions, and the eight starting
 * templates.
 *
 * The model is structure only. Every value a printed page supplies — XP
 * thresholds, save bands, titles, hit dice, proficiency lists, template
 * contents — reaches a world through the importer, materialized from the
 * GM's own book, or is typed by hand into the constructor sheet. A blank
 * class document is a valid homebrew starting point, never an error.
 *
 * Save bands store the BOOK's vocabulary (`blast`, `spells`); the released
 * system's actor keys (`breath`, `spell`) are the write layer's concern —
 * see lib/actor-compat.mjs `savesUpdateData`.
 */
import { num, str, int, bool, html, choice, choiceSet, refList, levelValueField, spellRefField } from "../lib/fields.mjs";
import { choiceSpecField } from "../lib/choice-spec.mjs";
import { ATTRIBUTES, RUNG_OUTCOMES } from "../lib/vocab.mjs";
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
    "languages.granted",
    "casting",
    "racialTraits",
    "templates",
    "builder.magic",
    "builder.powers",
    "builder.tradeoffs",
    "builder.thievery.skills",
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
        // Whether a rung a THROW reads is a target at all: blank is, `auto` is
        // reached without one, `none` is not reached. A ladder nothing throws
        // against never sets it, and its non-numeric cells keep meaning exactly
        // what they meant.
        outcome: choice(RUNG_OUTCOMES),
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
        offer: bool(), // this row IS the pick, not a grant — see `isOffer`
      });

    /**
     * One spell inside a starting template's bundle — or the OFFER of one.
     *
     * A printed package sometimes hands over a spell the player still has to
     * name ("and one spell of character's choice"). That is not a spell and is
     * never minted as one, but it is not nothing either: recorded only as a
     * sentence in a note it is invisible on the character and the pick is
     * silently never made. So it rides as a row whose `offer` is set, carrying
     * what may be picked rather than what was granted.
     */
    const templateSpell = () =>
      new SchemaField({
        uuid: str(), // core spell Item uuid, once one exists in the world
        name: str(), // printed name — the fallback when no item is linked
        offer: bool(),
        choice: choiceSpecField(),
      });

    /** One granted item inside a template's bundle, with its printed skin. */
    const templateItem = () =>
      new SchemaField({
        ref: str(), // base equipment doc (cookbook id or uuid:…)
        name: str(), // the printed descriptor ("long bearded axe")
        qty: int(1, { min: 1 }),
        skinName: str(), // display name for the skinned copy ("" = use `name`)
        note: str(),
        // What the page says THIS piece is worth, in gold, where the cell
        // prices it in brackets ("bladedancer's head dress (20gp value)").
        // Most of what carries one has no catalogue row at all — the cell
        // prices it precisely because the shop list does not — so this is the
        // only value the item will ever have. Zero means the cell said nothing.
        cost: num({ min: 0 }),
        choice: choiceSpecField(),
      });

    /**
     * One option inside a path group — a single mutually exclusive choice.
     *
     * `training` is what taking this option is trained to fight with, in the
     * same three parts a class states: the grant tokens, the armour rung, the
     * fighting styles. A class whose training is per-option (the Barbarian's
     * regions) states it HERE and leaves the class-wide one empty.
     */
    const pathOption = () =>
      new SchemaField({
        key: str(), // stable slug ("jutland")
        label: str(), // as printed
        note: str(),
        training: new SchemaField({
          weapons: refList(), // grant tokens: all | missile:all | melee:<size> | category | weapon
          armour: str(), // an armour ladder rung
          styles: refList(),
        }),
      });

    /**
     * A PATH GROUP: one set of mutually exclusive class options.
     *
     * A class carries as many as its spread states — a Barbarian's region, a
     * Zaharan's dark path, a dwarven caste — and starting templates are one
     * more of them rather than a parallel mechanism (2026-08-22, DECISIONS).
     *
     * `source` says where the options live. Empty means they are stated right
     * here, in `options`. `"templates"` means the group's options ARE this
     * class's own `templates` rows, POINTED AT rather than copied: a world that
     * upgrades keeps its rows, its bundles and its 3d6 table exactly where they
     * were, and nothing had to be migrated to gain a selector. Folding them in
     * properly is ROADMAP's, deliberately not taken here.
     */
    const pathGroup = () =>
      new SchemaField({
        key: str(), // "region"
        label: str(), // "Region"
        note: str(),
        source: str(), // "" = options below; "templates" = the class's template rows
        options: new ArrayField(pathOption()),
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
        spells: new ArrayField(templateSpell()),
        // Printed starting coin. Most templates pay in gold; a few pay partly
        // or wholly in silver ("20sp for alms", "1gp, 8sp"), and a template
        // that prints only silver leaves a character with nothing at all if
        // only the gold is read.
        gp: num(),
        sp: num(),
        enc: str(), // printed encumbrance parenthetical, display only
        alt: str(), // Notes-driven alternates ("without banner", elemental spell swaps)
        // Uuid of the materialized bundle Item holding this template's
        // contents as repairable world documents (template-packages.mjs).
        // A CACHE: identity lives on the bundle's own templatePart flag, and
        // the materializer re-derives this after an import rewrites `system`.
        // "" = not materialized; the row's arrays are then the whole package.
        bundle: str(),
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
      // Where this class sits when classes are listed as the books print them:
      // the book's rank times a thousand plus the printed page. Filled by an
      // import, typed by hand on a homebrew class. Zero means "derive it from
      // `source`" (registry.mjs `classSortKey`), so a world that re-imports
      // nothing still lists its classes in book order.
      sortOrder: int(0, { min: 0 }),

      description: html(), // lazy @PdfText content, or hand-written homebrew prose
      codeOfBehavior: html(),

      requirements: new ArrayField(new SchemaField({ attr: choice(ATTRIBUTES), min: num({ integer: true }) })),
      keyAttributes: choiceSet(ATTRIBUTES),
      maximumLevel: int(14, { min: 1 }),
      hitDie: str(), // "1d8"
      // How much Intellect bonus this class's printed TEMPLATES already spend.
      //
      // Most classes' templates assume no bonus, so a character's whole
      // Intellect bonus is theirs to choose with. The studious spellcasters'
      // templates assume one (RR Ch. 2 §II.1) — one bonus proficiency, listed
      // last, and one bonus spell, listed second — so offering their full
      // bonus on top grants it twice, and a character below the assumed band
      // holds more than they are entitled to.
      //
      // WHICH classes those are is a fact off the page: it cannot be derived
      // from the document (the repertoire kind splits them wrongly, and the
      // printed proficiency counts of studious and plain classes overlap in
      // both directions), so the importer fills this from the reader's own
      // book. 0 is the honest default — a class nobody has re-imported keeps
      // behaving exactly as it did.
      templatesAssumeIntBonus: int(0, { min: 0 }),

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

      /**
       * What this class knows how to speak (RR §I.10). `granted` names the
       * tongues it begins with outright; `count` is how many MORE it may pick
       * — a class perk, distinct from the free picks Intellect buys, which are
       * derived from the character and never stored here.
       *
       * Names, not refs: a language is a world document that may not exist
       * yet, so the class records what the book prints and the grant resolves
       * it against the world when it can (an unmatched name still fills its
       * slot, visibly, rather than vanishing).
       */
      languages: new SchemaField({
        granted: refList(),
        count: int(0, { min: 0 }),
      }),

      awards: new ArrayField(award()),

      casting: new ArrayField(tradition()),

      /** Groups of mutually exclusive class options; a starting template is
       *  one such group, pointed at rather than moved. See `pathGroup`. */
      paths: new ArrayField(pathGroup()),

      templates: new ArrayField(template()),
      /** Uuid of the generated 3d6 RollTable linking the template bundles —
       *  a VIEW of the bands; nothing reads it, so it cannot drift into a
       *  second authority. Same cache semantics as a row's `bundle`. */
      templateTable: str(),

      /** The race document this class is an expression of (cookbook id or
       *  uuid:…). Meaningful in BOTH modes: a simple-mode imported class may
       *  bind its race so racial traits resolve from the race document. */
      race: str(),

      /**
       * Advanced mode — the Judges Journal's class-builder workflow held as
       * INPUT state. Derivation (builder-logic.mjs) turns these values into
       * the simple-mode fields above; nothing downstream reads `builder`
       * directly, so a class built either way applies identically. Every
       * number the derivation needs comes from the `acks.classBuilder`
       * ruledata document — the model stores only what was chosen.
       */
      builder: new SchemaField({
        enabled: bool(),
        /** Hit Die value (a ladder row of the ruledata `hd` table). */
        hdValue: int(0, { min: 0 }),
        fighting: new SchemaField({
          value: int(0, { min: 0 }),
          /** The 1-point split: "a" (Crusader) or "b" (Thief); "" elsewhere. */
          sub: str(),
          /** Damage-bonus election where the value offers one: "", "melee",
           *  "missile", "both". Vocabulary is the table's, not an enum. */
          damageBonus: str(),
        }),
        thievery: new SchemaField({
          value: int(0, { min: 0 }),
          /** Chosen thief skills (ability refs); count is checked against
           *  the thievery value's printed allowance. */
          skills: refList(),
        }),
        /**
         * Magic values — an OPEN list of typed value categories. `type` keys
         * a row of the ruledata `magicTypes` table (arcane, divine,
         * ceremonial, gnostic, alchemy, eldritch, fairie, or any imported /
         * hand-authored tradition); nothing in the schema closes the set.
         */
        magic: new ArrayField(
          new SchemaField({
            type: str(),
            label: str(), // display override ("Runecasting"); "" = the type's
            value: int(0, { min: 0 }),
            /** JJ's delayed-progress option (value gains start late). Stored;
             *  derivation flags it rather than silently ignoring it. */
            delayed: bool(),
          }),
        ),
        /** Racial value spent, against the bound race document's ladder. */
        race: new SchemaField({ value: int(0, { min: 0 }) }),
        /** Trade-off elections (keys of the ruledata `tradeoffs` table:
         *  armour/weapon/style narrowings and their kin). */
        tradeoffs: refList(),
        /** Custom powers chosen with the picks the trade-offs yield. */
        powers: new ArrayField(
          new SchemaField({
            ref: str(),
            name: str(),
            cost: num(),
            note: str(),
          }),
        ),
        /** Judge's manual XP delta for anything the tables cannot say. */
        xpAdjustment: num({ integer: true }),
        notes: str(),
      }),
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
    // A checkbox group submits a lone checked box as a scalar string.
    const tradeoffs = foundry.utils.getProperty(data, "builder.tradeoffs");
    if (typeof tradeoffs === "string") foundry.utils.setProperty(data, "builder.tradeoffs", tradeoffs ? [tradeoffs] : []);
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
