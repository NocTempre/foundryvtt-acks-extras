/* global foundry */
import { VARIATION_KIND } from "../variations.mjs";

/**
 * Data model for the `acks-extras.variation` Item subtype — one way an item
 * differs from its plain self, as a document.
 *
 * **Why a document.** A variation applies to a base item the way gear goes into
 * a container: the relation is `containedIn`, and what it holds is a real Item.
 * That buys the whole inventory apparatus at once — drag it on, see it listed
 * under the thing it changed, drag it off — and it gives the importer
 * something to materialize into, exactly as a trap or an ability is.
 *
 * **The definition and the instance are the same object.** A variation Item
 * carries both what masterwork MEANS (`deltas`, `cost`, what it may go on) and
 * what is true of THIS one (`hidden`, `read`, `data`). They are not split
 * because a copy is what applying makes: the blade's masterwork is its own
 * document, so re-importing the register cannot silently revalue a sword a
 * Judge already priced, and an exported item is still readable by a world that
 * imported nothing.
 *
 * **No numbers ship.** Every field below is empty or zero until something fills
 * it — the importer from the reader's own book, or a Judge typing one in. The
 * module knows variations exist and how they combine; what masterwork COSTS is
 * a page value and arrives with the page.
 *
 * The item is deliberately non-physical: no `cost`, no `weight6`. That keeps it
 * out of `isGoods`, so encumbrance never counts it, `storeIn` never treats it
 * as cargo, and its price shows up only through the base item it changed.
 */
export default class VariationData extends foundry.abstract.TypeDataModel {
  static defineSchema() {
    // Resolved in the method, not at module scope: this file is imported by the
    // offline harness, which has no `foundry` global until the mock is built.
    const fields = foundry.data.fields;
    const num = (initial = 0) => new fields.NumberField({ required: true, initial, nullable: false });
    return {
      /**
       * The namespaced key: `masterwork.weaponToHit`, `material.silver`.
       *
       * The prefix IS the exclusivity group — two variations clash when their
       * keys share one, which is why nothing declares a slot. A blank key is
       * allowed so a half-typed hand-made variation still saves; it applies to
       * nothing until filled.
       */
      key: new fields.StringField({ required: true, blank: true, initial: "" }),

      /** Prose about what sort of difference this is. Never the conflict rule. */
      kind: new fields.StringField({
        required: true,
        blank: true,
        initial: "",
        choices: ["", ...Object.values(VARIATION_KIND)],
      }),

      /** Base types this may go on. Empty means any — most do not care. */
      appliesTo: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),

      /** Printed cross-family rules only, `magical.*` style patterns allowed. */
      supersedes: new fields.ArrayField(new fields.StringField({ blank: false }), { initial: [] }),

      /** What it moves. Summed across every variation on the item. */
      deltas: new fields.SchemaField({
        bonus: num(),
        damage: num(),
        ac: num(),
        weight6: num(),
      }),

      /**
       * What it does to the price, in the three slots the rules' own order
       * needs: `baseMul` scales the item's listed price, `add` is then added,
       * and `mul` scales the whole.
       */
      cost: new fields.SchemaField({
        baseMul: num(1),
        add: num(0),
        mul: num(1),
      }),

      /**
       * Do they know it is there? Governs presentation and price only — a
       * disguised magic sword still hits as a magic sword.
       */
      hidden: new fields.BooleanField({ initial: false }),

      /**
       * Do they know what it means? A different question from `hidden`: a
       * visible inscription in an unknown script is legible-false, not hidden.
       */
      read: new fields.BooleanField({ initial: true }),

      /** The language an inscription is in, when being read needs one. */
      language: new fields.StringField({ required: false, blank: true, initial: "" }),

      /**
       * What this variation records about itself, against `dataFields`. Free
       * shape because the specs are imported: a gem's cut, a named blade's
       * ladder, an engraving's subject.
       */
      data: new fields.ObjectField({ initial: {} }),

      /** Field specs for `data`, imported. Empty means it records nothing. */
      dataFields: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),

      /** Worth its own tab on the item that carries it. */
      tab: new fields.BooleanField({ initial: false }),

      /** Conditional value claims — reported to the Judge, never applied. */
      conditional: new fields.ArrayField(new fields.ObjectField(), { initial: [] }),

      description: new fields.HTMLField({ required: false, blank: true, initial: "" }),
    };
  }
}
