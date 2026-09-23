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
 * Built from the lib subsystem's field-builders, so the effect vocabulary is
 * one definition across every feature.
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
      // How many times this character has taken it, as recorded on this item.
      // A count, not a rank: rankOf() reads rank by counting same-named copies
      // (the convention chargen writes), and nothing reads this field as one.
      qty: num({ integer: true, initial: 1, min: 1 }),
      // What each take selected, for abilities where a take is a choice (a
      // weapon group, a fighting style, a craft): one string per take,
      // order-aligned with the count; rank-scaled abilities leave it empty.
      // Free text — consumers fold case and punctuation and match against their
      // own vocabularies, reading through selectionsOf(), never item names.
      // Stored only on a character's copy, never on the definition.
      selections: new ArrayField(str()),
      powerValue: num(), // custom-power cost; powers only
      deprecated: bool(), // "removed from ACKS II" — still ingested, just flagged
      replacedBy: str(), // what supersedes it (a def id), so references can redirect
      // Set when the ability arrived from a converted/legacy source: `deleted`
      // (removed on purpose) reads as a caution, `absent` (merely omitted) as
      // info, `renamed` as a note. All three are surfaced.
      conversionStatus: choice(CONVERSION_STATUS),
      conversionFrom: str(), // the PRE-conversion name — what the older source called it
      // The def id of the entry whose text this alias shares. An alias is a real
      // ability item (pickable, grantable, shown), not a redirect, and does not
      // stack with its target.
      aliasOf: str(),
      // Capability tokens (`kw:<slug>`) this ability provides. A prerequisite
      // written against a capability is met by any ability providing it; two
      // abilities providing one capability do not stack.
      provides: refList(),
      requires: str(), // prerequisite marker (detail lives in the lazy description)
      // Set while the mechanics below are a machine draft — classified by a
      // generic scan, not yet read against the page. The sheet flags them and
      // the printed text governs until the cookbook entry is audited.
      unaudited: bool(),
      // --- A pick-one branch (Combat Trickery maneuver, Elementalism element…) ---
      choice: new SchemaField({
        prompt: str(),
        options: new ArrayField(new SchemaField({ label: str(), ref: str() })),
      }),
      // --- The rolls this ability offers ---
      // Every throw the ability offers; core's single roll/rollTarget holds one.
      // Read through rollsOf(), written through writeRolls().
      rolls: rollsField(),
      // The KEY of the throw a bare roll reaches (the row's icon, the chat
      // card's Roll button, `item.use()`, a hotbar macro). Blank, or naming a
      // deleted throw, reads as the first. Per item, not per definition.
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
 * The picks recorded on a character's copy of an ability — the only supported
 * way to read them. Prefers the stored `selections` array; absent that, reads
 * the legacy "(X)" suffix on the item name, so no consumer parses item names
 * itself.
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
