/* global foundry */
/**
 * GearExtras — where a piece of gear sits, and how fast you can get at it.
 *
 * Stored at `item.flags["acks-extras"].gear` (NOT a document sub-type, the same
 * ruling the abilities feature made for `AbilityExtras`). The system's item
 * models are frozen and disagree with each other: `equipped` is declared on
 * `weapon` and `armor` and NOWHERE ELSE, so a cloak, a pair of gloves, an
 * adventurer's harness and a backpack — every one of them worn in the books —
 * have no way to be worn in the schema. Foundry prunes off-schema keys, so
 * writing `system.equipped` on an `item` does not merely go unread, it is not
 * stored. This model is the missing half.
 *
 * WHAT IT DECLARES, and what it deliberately does not:
 *
 *  - `slots` is the set of places the item MAY sit. Empty means plain goods —
 *    rations, loot, coin — and that is how "equippable" is answered: an item is
 *    equippable when it declares somewhere to go. One field, so nothing can
 *    disagree with itself the way a boolean beside a slot list can.
 *  - `wornAt` is where it sits NOW, and only for items core cannot answer for.
 *    Where core owns `system.equipped` (`weapon`, `armor`) THAT stays the
 *    truth — core's own equip toggle and this module's enforcement wrap both
 *    write it, and a second store would fork them. Read through
 *    `item-model.mjs` `isWorn`/`wornSlotOf`, which hide which store applies.
 *  - `access` is RAW retrieval cost (RR pp. 293-294), and it is per-container
 *    rather than per-slot: a pouch on your belt and a sack on your back differ
 *    by what they are, not only by where they hang.
 *  - `per` is how many units one stated weight covers, for goods the books
 *    rate by the bundle rather than by the piece. It defaults to 1, which is
 *    the arithmetic every existing item already gets.
 *
 * Container `capacity` and the clothing `layer` belong here too and are NOT yet
 * declared: both have a live home today (`flags.acks-extras.container.capacity`
 * and `.layer`), and standing up a second one before their readers move would
 * make one fact true in two places. They move in with their readers.
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
      // from 0, which is a container of unstated size (RAW capacity is a
      // warning, not a limit, so an unstated one simply never warns).
      //
      // Capacity lives HERE rather than on the container record because it is
      // not the exclusive property of things called containers: a coat with
      // hidden pockets, a bandolier and a saddle all hold gear, and gating the
      // concept on "is this a recognised carrying device" made every one of
      // them unable to hold anything at all.
      capacity: new NumberField({ required: false, nullable: true, initial: null, min: 0 }),
      // How many units one stated `weight6` covers. 1 — the default, and the
      // identity — is the ordinary case: the weight is per item and quantity
      // multiplies it.
      //
      // The books price a whole class of goods per BUNDLE: a quiver of twenty
      // arrows, a set of six iron spikes, rated as one item however many it
      // holds. Without this field the two numbers a Judge reads off such a row
      // have no way to say they share a denominator, so typing the printed
      // weight beside the printed count produced an item twenty times too
      // heavy.
      //
      // The FIELD is structure; the value is not. What size bundle a given row
      // is priced for is printed, so it arrives from the importer, from the
      // item's own name, or from the Judge — never from a table shipped here.
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
