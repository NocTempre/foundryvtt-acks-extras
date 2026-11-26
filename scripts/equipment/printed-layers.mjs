/* global game */
/**
 * The figures a silver plating and a masterwork tier apply, read from the
 * variation documents the importer mints for them.
 *
 * Both layers are flags on an item (`silvered`, `masterwork.tier`); what each
 * is worth is the library's variation document for its key (`config.SILVER`,
 * `config.MASTERWORK`), summed by the same rule an applied variation is
 * (`variations.mjs` `sumDeltas`). A world that has not imported the document
 * has no figure: every read answers null, the layer applies nothing, and the
 * surface says so (`unstatedLayers` in properties.mjs). A document that exists
 * but carries nothing in any slot counts as not imported, since a variation
 * whose figures did not read has only the schema's neutral defaults.
 *
 * A figure's provenance is the document it was read from: the page its import
 * stamp names, "by hand" where the document was typed in, or "edited by hand"
 * where a Judge changed the figures the import stamped as read.
 */
import { libraryItems, libraryDocsWhere, cookbookId } from "../lib/library.mjs";
import { containedIn, capacityOf, contentsIn } from "../lib/item-model.mjs";
import { MODULE_ID, ITEM_FLAGS, VARIATION_ITEM_TYPE } from "./constants.mjs";
import { MASTERWORK, SILVER } from "./config.mjs";
import { sumDeltas, definitionFrom, entryOf, familyOf } from "./variations.mjs";

/** The key family the masterwork variations share. */
const MASTERWORK_FAMILY = "masterwork";

/**
 * The library's variation document carrying `key`, or null. A variation
 * applied to an item is a document in the same collection and is not the
 * library's published copy, so contained ones are skipped. `items` is the
 * library documents it searches: the instantiated library by default, or a list
 * a caller has read with `libraryDocsWhere`.
 */
export function libraryVariation(key, items = libraryItems()) {
  if (!key) return null;
  return items.find((i) => i.type === VARIATION_ITEM_TYPE && i.system?.key === key && !containedIn(i)) ?? null;
}

/**
 * Every library variation document, read by type from the shelves' indexes
 * (`libraryDocsWhere`) with no whole-shelf load, and held by the shelves
 * afterwards, so the synchronous figure readers below find them. The list is
 * what a caller hands those readers as `items` where it must not depend on the
 * shelf still holding them. An action that reads a figure awaits this first:
 * Foundry drops a shelf's documents after it idles, and a figure read from an
 * evicted shelf reads as not imported.
 */
export const libraryVariations = () => libraryDocsWhere("Item", (row) => row.type === VARIATION_ITEM_TYPE);

/** The page a variation document's import stamp names, or the empty string. */
const citeOfVariation = (doc) =>
  String(doc?.system?.source?.cite ?? doc?.flags?.[MODULE_ID]?.cookbook?.cite ?? doc?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? "");

/** A variation's `deltas` and `cost` summed into the slots `sumDeltas` fills, neutral where unstated. */
const slotsOf = ({ deltas = null, cost = null } = {}) => sumDeltas([{ key: "slots" }], () => ({ deltas, cost }));

/** Does a summed variation say anything, in any slot? */
const says = (t) =>
  t.bonus !== 0 || t.damage !== 0 || t.ac !== 0 || t.weight6 !== 0 || t.costAdd !== 0 || t.costMul !== 1 || t.costBaseMul !== 1;

/**
 * Does a minted document hold figures other than the ones its import stamped
 * as read? A document with no stamp has nothing to compare and reads as
 * unedited.
 */
function editedSinceRead(doc) {
  const read = doc?.flags?.[MODULE_ID]?.cookbook?.read;
  if (!read) return false;
  const was = slotsOf(read);
  const now = slotsOf(doc.system ?? {});
  return Object.keys(was).some((slot) => was[slot] !== now[slot]);
}

/**
 * Where a figure was read from: the document's name, the page it cites,
 * whether it was made by hand (carries no import stamp), and whether a Judge
 * edited the figures its import read.
 *
 * @returns {{name: string, cite: string, byHand: boolean, edited: boolean}}
 */
export function sourceOf(doc) {
  const byHand = !cookbookId(doc);
  return { name: String(doc?.name ?? ""), cite: citeOfVariation(doc), byHand, edited: !byHand && editedSinceRead(doc) };
}

/**
 * What a library variation document applies, summed into the delta slots
 * `layerDeltas` uses, with its source; null when the document is absent or
 * says nothing.
 */
function figureOf(key, items) {
  const doc = libraryVariation(key, items);
  const def = doc ? definitionFrom(doc) : null;
  if (!def) return null;
  const total = sumDeltas([entryOf(doc)], (k) => (k === def.key ? def : null));
  return says(total) ? { ...total, source: sourceOf(doc) } : null;
}

/**
 * The silver plating's figures (its `costBaseMul` scales the weapon's listed
 * price), or null when the document is not imported. `items` is the library
 * documents the variation is found among, as `libraryVariation` takes it.
 */
export const silverFigure = (items) => figureOf(SILVER.variation, items);

/**
 * One masterwork tier's figures (`bonus`, `damage`, `ac`, `weight6`,
 * `costAdd`), or null when the tier is unknown or its document is not
 * imported. `items` is the library documents the variation is found among, as
 * `libraryVariation` takes it; left out, the instantiated library is read, and
 * an unknown tier reads nothing.
 */
export const masterworkFigure = (tier, items) => figureOf(MASTERWORK[tier], items);

/**
 * The masterwork share of a weapon's bonus on one roll, as lib's attack seam
 * reads an item bonus source (`registerItemBonusSource`): the parts of what core
 * already carries in the weapon's `system.bonus` and damage, so a spell record's
 * buff that names `kw:masterwork` can yield to it or take it back out. `on` is
 * `attack` (the `bonus` figure) or `damage`; any other roll has none.
 *
 * The figures are the imported ones: the flag's tier through `masterworkFigure`,
 * else an applied `masterwork.*` variation's own (a flag that names a tier owns
 * its family, so a variation beside it is not added). A figure of zero, a tier
 * whose document is not imported, and an item with neither have no part. Each part
 * provides `kw:masterwork` and cites its document the way the sheet's tooltip does.
 *
 * @param {object} item
 * @param {"attack"|"damage"|string} on
 * @returns {{key: string, label: string, value: number, provides: string[], cite: string}[]}
 */
export function masterworkBonusParts(item, on) {
  const field = on === "attack" ? "bonus" : on === "damage" ? "damage" : null;
  if (!field || !item) return [];
  const tier = (item.getFlag?.(MODULE_ID, ITEM_FLAGS.MASTERWORK) ?? item.flags?.[MODULE_ID]?.[ITEM_FLAGS.MASTERWORK])?.tier ?? null;
  const figures = [];
  if (tier && tier !== "none") {
    const figure = masterworkFigure(tier);
    if (figure) figures.push(figure);
  } else {
    // Not `variationItemsOf`: that file imports `properties.mjs`, which imports this one.
    for (const doc of contentsIn(item)) {
      if (doc?.type !== VARIATION_ITEM_TYPE || familyOf(doc.system?.key) !== MASTERWORK_FAMILY) continue;
      const def = definitionFrom(doc);
      if (!def) continue;
      const total = sumDeltas([entryOf(doc)], (k) => (k === def.key ? def : null), { item });
      if (says(total)) figures.push({ ...total, source: sourceOf(doc) });
    }
  }
  const label = game.i18n.localize("ACKS-EQUIPMENT.props.masterwork");
  return figures.filter((f) => f[field] !== 0).map((f) => ({ key: "masterwork", label, value: f[field], provides: ["kw:masterwork"], cite: provenanceTip(f.source) }));
}

/** The tooltip for a figure: the page it was read from, that it was typed by hand, or that a Judge edited it. */
export function provenanceTip(source) {
  const name = source?.name ?? "";
  if (source?.byHand) return game.i18n.format("ACKS-EQUIPMENT.printed.byHand", { name });
  if (source?.edited) return game.i18n.format("ACKS-EQUIPMENT.printed.editedByHand", { name, cite: source.cite || name });
  if (source?.cite) return game.i18n.format("ACKS-EQUIPMENT.printed.fromPage", { name, cite: source.cite });
  return game.i18n.format("ACKS-EQUIPMENT.printed.fromDocument", { name });
}

/**
 * Where an item's stated capacity came from, shaped for `provenanceTip`: the
 * import stamp's `read.capacity` is the figure the page gave, so a capacity
 * equal to it cites the page, one that differs was edited by hand, and an
 * item whose import read none (or that no import made) was set by hand.
 *
 * @returns {{name: string, cite: string, byHand: boolean, edited: boolean}}
 */
export function capacitySource(item) {
  const stamp = item?.flags?.[MODULE_ID]?.cookbook ?? item?.getFlag?.(MODULE_ID, "cookbook");
  const read = stamp?.read?.capacity;
  const base = { name: String(item?.name ?? ""), cite: String(stamp?.cite ?? "") };
  if (!Number.isFinite(read)) return { ...base, byHand: true, edited: false };
  return { ...base, byHand: false, edited: read !== capacityOf(item) };
}

/**
 * The tooltip of an item's capacity figure: its provenance when one is
 * stated, and empty when none is.
 */
export function capacityTip(item) {
  if (capacityOf(item) === null) return "";
  return provenanceTip(capacitySource(item));
}
