/**
 * The implement-set bucket a tradition's cast procedure asks for: an inventory
 * bucket (lib's `bucket`, drawn by the cast dialog in the tradition's band) that
 * opens holding the sets the caster carries, takes a dragged set, and picks the
 * one the cast uses. A set is an item carrying an implement level (`ceremony-state`);
 * its effective level is its level less its damage, and the set used must reach
 * the invocation level the seat chose. The pick opens on the LOWEST set that does
 * (`usableSets`, lowest effective level first), a set too low is listed and
 * dimmed with its reason, and with no set reaching the level the bucket's finding
 * is `noSetReaches`, which the plan turns into a Player's block or a Judge's
 * warning. The procedure that wants the line returns `implementsBucket(ctx)` from
 * its `buckets(ctx)` and reads the pick from `answer.picked[IMPLEMENTS_KEY]`.
 * Nothing here states a figure: levels and damage are the item's own, the needed
 * level is the seat's, and the page a figure answers to is the procedure's `cite`.
 * FOUNDRY-FREE: the text is built by an injected `loc`, and a row's document is
 * read from the held row.
 */
import { MODULE_ID, LANG_PREFIX } from "./constants.mjs";
import { readItemState, effectiveLevel, usableSets } from "./ceremony-state.mjs";
import { ENTRY_KIND } from "../lib/bucket.mjs";
import { makeLoc } from "../lib/util.mjs";

/** The bucket's key, and the key its pick has in `answer.picked`. */
export const IMPLEMENTS_KEY = "implements";

/** The lang prefix of the strings this bucket words itself. */
export const IMPLEMENTS_LANG_PREFIX = `${LANG_PREFIX}.cast.implements`;

/** The flag a set's level and damage live under, as `ceremony-state` reads it from a plain row. */
const asItem = (basis) => ({ flags: { [MODULE_ID]: { ceremony: { implementLevel: basis?.level ?? null, damage: basis?.damage ?? 0 } } } });

/**
 * The implement sets a caster carries: the items with an implement level.
 * @param {{items?: Iterable<object>}|null} actor
 * @returns {object[]}
 */
export const carriedSets = (actor) => [...(actor?.items ?? [])].filter((item) => readItemState(item).implementLevel !== null);

/**
 * The bucket a procedure returns from `buckets(ctx)`: `{key, policy, initial}`.
 *
 * @param {{actor?: object, invocationLevel?: number|null}} ctx  the cast's ctx; the level the sets must reach is `ctx.invocationLevel`
 * @param {{loc?: (key: string, data?: object) => string, cite?: string}} [o]  `loc` words the bucket (keys under `IMPLEMENTS_LANG_PREFIX`); `cite` is the page the procedure's rule is printed on, kept in a figure's tooltip
 */
export function implementsBucket(ctx, { loc = makeLoc(IMPLEMENTS_LANG_PREFIX), cite = "" } = {}) {
  const needed = Number.isInteger(ctx?.invocationLevel) ? ctx.invocationLevel : null;
  const pageText = cite ? ` (${cite})` : "";
  const reaches = (doc) => readItemState(doc).implementLevel !== null && (needed === null || effectiveLevel(doc) >= needed);
  const policy = {
    pick: "one",
    legend: loc("legend"),
    icon: "fa-gem",
    dropText: loc("drop"),
    emptyText: loc("empty"),
    accepts: {
      kinds: [ENTRY_KIND.item],
      // A row that cannot be the set used is listed and dimmed, and says why in words of its own.
      reason: (_entry, doc) => {
        const { implementLevel } = readItemState(doc);
        if (implementLevel === null) return loc("notSet");
        return needed !== null && effectiveLevel(doc) < needed ? loc("tooLow", { effective: effectiveLevel(doc), needed }) : null;
      },
    },
    // The level and damage ride the entry as its value's basis, so a row is drawn from the entry alone.
    value: (doc) => ({ gp: null, source: "implement", cite: null, basis: { level: readItemState(doc).implementLevel, damage: readItemState(doc).damage } }),
    due: null,
    parts: [],
    settle: {},
    usable: (row) => reaches(row.doc),
    opens: (rows) => {
      const first = usableSets(rows.map((r) => r.doc), needed)[0];
      return rows.find((r) => r.doc === first)?.uuid ?? null;
    },
    rowView: (entry) => {
      const level = entry.value?.basis?.level;
      if (level === null || level === undefined) return {};
      const damage = entry.value.basis.damage ?? 0;
      const effective = effectiveLevel(asItem(entry.value.basis));
      return {
        caption: loc("caption", { level, effective }),
        captionTip: loc("captionTip", { level, damage, effective, cite: pageText }),
        diamonds: { filled: effective, lost: Math.max(0, level - effective) },
      };
    },
    verdicts: (rows) => (needed !== null && !usableSets(rows.map((r) => r.doc), needed).length ? [{ key: "noSetReaches", notice: loc("noSetReaches", { needed }) }] : []),
  };
  return { key: IMPLEMENTS_KEY, policy, initial: carriedSets(ctx?.actor).map((item) => ({ uuid: item.uuid, qty: 1 })) };
}
