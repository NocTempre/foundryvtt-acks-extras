/* global foundry */
/**
 * GearExtras — where a piece of gear sits, and how fast you can get at it.
 *
 * Stored at `item.flags["acks-extras"].gear`, not a document sub-type. See
 * docs/lib/DECISIONS.md, "The item taxonomy is declared over core's types,
 * not invented beside them".
 *
 * WHAT IT DECLARES, and what it deliberately does not:
 *
 *  - `slots` is the set of places the item MAY sit. Empty means plain goods,
 *    and that is how "equippable" is answered. See docs/lib/MODEL.md, "Slots".
 *  - `wornAt` is where it sits NOW, and only for items core cannot answer for
 *    (core's own `equipped` stays the truth for `weapon`/`armor`). Read
 *    through `item-model.mjs`'s `isWorn`/`wornSlotOf`, which hide which store
 *    applies.
 *  - `access` is RAW retrieval cost (RR pp. 293-294), per-container rather
 *    than per-slot.
 *  - `per` is how many units one stated weight covers, for goods the books
 *    rate by the bundle rather than by the piece; defaults to 1.
 *
 * Container `capacity` and the clothing `layer` belong here too and are NOT
 * yet declared: both have a live home today (`flags.acks-extras.container.capacity`
 * and `.layer`) and move in with their readers.
 */
import { WEAR_SLOTS, ACCESS_COSTS, choicesOf } from "../vocab.mjs";
import { MODULE_ID, FLAG_GEAR } from "../constants.mjs";

export default class GearExtras extends foundry.abstract.DataModel {
  /** Array-valued paths, reconstructed from FormDataExtended's numeric-keyed objects. */
  static ARRAY_PATHS = ["slots"];

  static defineSchema() {
    const { ArrayField, NumberField, StringField } = foundry.data.fields;
    return {
      // The slots this item MAY occupy. Empty ⇒ plain goods.
      //
      // A LIST, not one value, because a legitimately ambiguous item should not
      // be forced into a lie: a shield is `offHand` or `strapped`, a bowcase is
      // `back` or `belt`. The wearer picks; the list bounds the picking.
      slots: new ArrayField(new StringField({ blank: false, choices: choicesOf(WEAR_SLOTS) })),
      // Where it sits now — one of `slots`, or blank for not worn. Only
      // consulted for items whose core type has no `equipped` field.
      wornAt: new StringField({ required: false, blank: true, initial: "", choices: choicesOf(WEAR_SLOTS) }),
      // Retrieval cost for what this container holds. Blank on anything that is
      // not a container: an item you are wearing is not "retrieved" at all.
      access: new StringField({ required: false, blank: true, initial: "", choices: choicesOf(ACCESS_COSTS) }),
      // How much this holds, in STONE. `null` is "holds nothing" — distinct
      // from 0, a container of unstated size that never warns. Capacity lives
      // HERE rather than on the container record; see docs/lib/MODEL.md,
      // "Capacity".
      capacity: new NumberField({ required: false, nullable: true, initial: null, min: 0 }),
      // How many units one stated `weight6` covers — for goods the books
      // price per BUNDLE (a quiver of arrows, a set of spikes) rather than
      // per piece. 1 is the identity. See docs/lib/DECISIONS.md, "A bundled
      // good's weight and its count share a denominator, and the size is
      // printed".
      per: new NumberField({ required: false, nullable: false, initial: 1, min: 1, integer: true }),
    };
  }

  /* -------------------------------------------- */

  /** Build from an item's stored flag (lenient: never throws on stale data). */
  static fromItem(item) {
    const raw = item?.getFlag?.(MODULE_ID, FLAG_GEAR) ?? {};
    try {
      return GearExtras.fromSource(foundry.utils.deepClone(raw), { strict: false });
    } catch (err) {
      console.warn(`${MODULE_ID} | could not parse gear extras; using defaults`, err);
      return new GearExtras({});
    }
  }

  /**
   * Normalize raw form/flag input into a complete, cleaned object: reconstructs
   * arrays from FormDataExtended's numeric-keyed objects, accepts the slot list
   * as one comma-separated line the way a text control submits it, and runs the
   * result through the schema.
   */
  static normalize(raw) {
    const data = foundry.utils.deepClone(raw ?? {});
    for (const path of GearExtras.ARRAY_PATHS) {
      const value = foundry.utils.getProperty(data, path);
      if (value && !Array.isArray(value) && typeof value === "object") {
        foundry.utils.setProperty(data, path, Object.values(value));
      }
    }
    if (typeof data.slots === "string") {
      data.slots = data.slots.split(",").map((s) => s.trim()).filter(Boolean);
    }
    return GearExtras.fromSource(data, { strict: false }).toObject();
  }
}
