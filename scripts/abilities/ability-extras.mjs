/* global foundry */
/**
 * AbilityExtras — the extended effect model the core ACKS `ability` item does
 * not carry. Stored at `item.flags["acks-extras"].extras` (NOT a document
 * sub-type): the core ability item keeps owning name, description,
 * proficiencytype, roll/rollType/rollTarget, requirements and save; this adds
 * the structured, level-aware EFFECTS plus the classification meta the books
 * express (general flag, repeatable, custom-power cost, prerequisites, choice
 * branches, deprecation).
 *
 * Built from the shared acks-lib field-builders so the effect vocabulary is one
 * definition across the family (sibling-relative import — the side-by-side
 * layout the toolchain assumes; resolves under /modules/ at runtime).
 */
import { MODULE_ID, FLAG_EXTRAS } from "./constants.mjs";
import { num, str, bool, choice, refList, effectsField, defensesField, rollsField } from "../lib/fields.mjs";
import { ABILITY_CATEGORIES, CONVERSION_STATUS } from "../lib/vocab.mjs";

export default class AbilityExtras extends foundry.abstract.DataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric-keyed objects. */
  static ARRAY_PATHS = ["effects", "rolls", "choice.options", "selections"];

  static defineSchema() {
    const { SchemaField, ArrayField } = foundry.data.fields;
    return {
      // --- Classification (intrinsic; NEVER which class/monster owns it) ---
      category: choice(ABILITY_CATEGORIES, { initial: "proficiency" }),
      general: bool(), // the "(G)" general-proficiency marker
      repeatable: bool(), // "may be selected multiple times"
      // How many times this character has taken it. ONE item carrying a count,
      // never N identical rows — the same way a stack of arrows is one
      // inventory line.
      //
      // `qty` is only the COUNT. What it MEANS is per-ability and not yet
      // modelled: Animal Husbandry taken twice is rank 2 of one thing, while
      // Weapon Proficiency taken twice is two different weapons, and Art/Craft
      // taken twice may be either a second discipline or a better first one.
      // So do not read qty as rank — rankOf() is one INTERPRETATION of qty,
      // correct for rank-scaled abilities and wrong for list-expanding ones.
      // Modelling that (and where a character's actual picks live) is the open
      // half of the merged-ability work.
      //
      // qty is NOT the effective rank. Holding one ability by two routes can
      // legitimately read as rank 2, but the second route must not become a
      // second copy: an alias/variant grants "+1 rank of X" and the root
      // ABSORBS it, leaving its own qty alone. So the mechanics read
      // `qty + Σ(granted ranks)`, and the two numbers answer different
      // questions — "how often did you take it" vs "what does it read at".
      qty: num({ integer: true, initial: 1, min: 1 }),
      // --- The picks: what each take CHOSE (the other half of qty) ---
      // `qty` says how often the ability was taken; `selections` records what
      // each take selected, for the list-expanding abilities where a take IS a
      // choice: Weapon Focus's category, Martial Training's weapon group,
      // Fighting Style Specialization's style, Art/Craft's discipline. One
      // string per take, order-aligned with the count; rank-scaled abilities
      // (where a second take deepens rather than widens) leave it empty.
      //
      // Free vocabulary BY DESIGN — the meaningful token set is per-ability
      // (weapon groups for one, crafts for another) and lives in the book, so
      // the schema cannot enumerate it. Consumers normalize (lowercase,
      // alphanumeric fold) and match against their own vocabularies; they read
      // through selectionsOf(), which also absorbs the legacy "(X)" name-suffix
      // convention, so no consumer ever parses item names itself.
      //
      // Stored only on a CHARACTER'S copy. The definition side stays
      // selection-free for the same reason it stays ownership-free (MODEL.md):
      // the book defines the ability; who took it and what they picked is the
      // character's data.
      selections: new ArrayField(str()),
      powerValue: num(), // custom-power cost (0.5 / 1 / 1.5 / 2 / 3 / 5); powers only
      deprecated: bool(), // "removed from ACKS II" — still ingested, just flagged
      replacedBy: str(), // what supersedes it (a def id), so references can redirect
      // Set when the ability arrived from a converted/legacy source: `deleted`
      // (removed on purpose) reads as a caution, `absent` (merely omitted) as
      // info, `renamed` as a note. All three are surfaced.
      conversionStatus: choice(CONVERSION_STATUS),
      conversionFrom: str(), // the PRE-conversion name — what the older source called it
      // An alias is its OWN ability, not a redirect: the books list a name whose
      // text lives under another entry. It gets a real item (so it can be picked,
      // granted and shown), a pointer to where its text is, and — because the two
      // are the same capability — a non-stacking relation to the target.
      aliasOf: str(),
      // What this ability lets you DO, named independently of this entry, as
      // acks-lib `kw:` capability tokens. A prerequisite written against a
      // capability is satisfied by any ability providing it — which is what
      // makes a gate survive the books printing the same capability as a
      // proficiency, a skill, a class power and an alias. Two abilities sharing
      // a capability are the same capability twice, so they do not stack.
      provides: refList(),
      requires: str(), // prerequisite marker (detail lives in the lazy description)
      // The mechanics below are a MACHINE DRAFT: classified from the reader's
      // book by a generic scan, not yet read against the page by a chef. A
      // number's meaning is contextual — a smaller penalty is a bonus, an
      // opponent's modifier is not yours — so until the cookbook entry carries
      // its audit sign-off, the sheet says so and the printed text governs.
      unaudited: bool(),
      // --- A pick-one branch (Combat Trickery maneuver, Elementalism element…) ---
      choice: new SchemaField({
        prompt: str(),
        options: new ArrayField(new SchemaField({ label: str(), ref: str() })),
      }),
      // --- The rolls this ability offers ---
      // An ability is not one roll. Animal Husbandry diagnoses, cures, cures
      // serious injury and extracts venom — four rolls, three of them on their
      // own rank progression. The core item carries a single roll/rollTarget,
      // which cannot express that, so the set lives here and the Rolls tab
      // presents them individually.
      rolls: rollsField(),
      // Which of them the single d20 reaches — the row's icon, the chat card's
      // Roll button, `item.use()`, a hotbar macro. Holds a roll's KEY, and the
      // key is the handle precisely because it survives a relabelling. Blank
      // (or naming a throw that has since been deleted) reads as the first
      // roll, so an ability nobody has chosen for still rolls what it always
      // did. Stored per ITEM, so one character's Lockpicking can default to
      // the methodical throw while another's does not.
      defaultRoll: str(),
      // --- The structured, level-aware effects (acks-lib vocabulary) ---
      effects: effectsField(),
      // --- Immunities / resistances / susceptibilities (mostly monster abilities) ---
      defenses: defensesField(),
    };
  }

  /* -------------------------------------------- */

  /** Build from an item's stored flag (lenient: never throws on stale data). */
  static fromItem(item) {
    const raw = item?.getFlag(MODULE_ID, FLAG_EXTRAS) ?? {};
    try {
      return AbilityExtras.fromSource(foundry.utils.deepClone(raw), { strict: false });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not parse ability extras; using defaults`, err);
      return new AbilityExtras({});
    }
  }

  /**
   * Normalize raw form/flag input into a complete, cleaned extras object:
   * reconstructs arrays from FormDataExtended's numeric-keyed objects and runs
   * the whole thing through the schema (defaults + coercion, null-safe).
   */
  static normalize(raw) {
    const data = foundry.utils.deepClone(raw ?? {});
    for (const path of AbilityExtras.ARRAY_PATHS) {
      const value = foundry.utils.getProperty(data, path);
      if (value && !Array.isArray(value) && typeof value === "object") {
        foundry.utils.setProperty(data, path, Object.values(value));
      }
    }
    // The sheet edits selections as one comma-separated line.
    if (typeof data.selections === "string") {
      data.selections = data.selections.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return AbilityExtras.fromSource(data, { strict: false }).toObject();
  }
}

/**
 * The picks recorded on a character's copy of an ability — the ONLY supported
 * way to read them (consumer contract, README). Prefers the stored
 * `selections` array; absent that, absorbs the legacy convention of carrying
 * the pick as a "(X)" suffix on the item name ("Martial Training (Axes)",
 * and the "(specialty)" suffix the the importer ability-provider stamps), so
 * no consumer ever parses item names itself.
 * @param {Item} item
 * @returns {string[]} trimmed, non-empty picks; [] when none are recorded
 */
export function selectionsOf(item) {
  const stored = (AbilityExtras.fromItem(item).selections ?? [])
    .map((s) => String(s).trim())
    .filter(Boolean);
  if (stored.length) return stored;
  const m = /\(([^)]+)\)\s*$/.exec(item?.name ?? "");
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
}
