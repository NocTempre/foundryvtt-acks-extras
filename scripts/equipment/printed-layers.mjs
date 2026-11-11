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
 * stamp names, or "by hand" where the document was typed in.
 */
import { libraryItems, cookbookId } from "../lib/library.mjs";
import { containedIn } from "../lib/item-model.mjs";
import { MODULE_ID, VARIATION_ITEM_TYPE } from "./constants.mjs";
import { MASTERWORK, SILVER } from "./config.mjs";
import { sumDeltas, definitionFrom, entryOf } from "./variations.mjs";

/**
 * The library's variation document carrying `key`, or null. A variation
 * applied to an item is a document in the same collection and is not the
 * library's published copy, so contained ones are skipped.
 */
export function libraryVariation(key) {
  if (!key) return null;
  return libraryItems().find((i) => i.type === VARIATION_ITEM_TYPE && i.system?.key === key && !containedIn(i)) ?? null;
}

/** The page a variation document's import stamp names, or the empty string. */
const citeOfVariation = (doc) =>
  String(doc?.system?.source?.cite ?? doc?.flags?.[MODULE_ID]?.cookbook?.cite ?? doc?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? "");

/**
 * Where a figure was read from: the document's name, the page it cites, and
 * whether it was made by hand (carries no import stamp).
 *
 * @returns {{name: string, cite: string, byHand: boolean}}
 */
export function sourceOf(doc) {
  return { name: String(doc?.name ?? ""), cite: citeOfVariation(doc), byHand: !cookbookId(doc) };
}

/** Does a summed variation say anything, in any slot? */
const says = (t) =>
  t.bonus !== 0 || t.damage !== 0 || t.ac !== 0 || t.weight6 !== 0 || t.costAdd !== 0 || t.costMul !== 1 || t.costBaseMul !== 1;

/**
 * What a library variation document applies, summed into the delta slots
 * `layerDeltas` uses, with its source; null when the document is absent or
 * says nothing.
 */
function figureOf(key) {
  const doc = libraryVariation(key);
  const def = doc ? definitionFrom(doc) : null;
  if (!def) return null;
  const total = sumDeltas([entryOf(doc)], (k) => (k === def.key ? def : null));
  return says(total) ? { ...total, source: sourceOf(doc) } : null;
}

/**
 * The silver plating's figures (its `costBaseMul` scales the weapon's listed
 * price), or null when the document is not imported.
 */
export const silverFigure = () => figureOf(SILVER.variation);

/**
 * One masterwork tier's figures (`bonus`, `damage`, `ac`, `weight6`,
 * `costAdd`), or null when the tier is unknown or its document is not
 * imported.
 */
export const masterworkFigure = (tier) => figureOf(MASTERWORK[tier]);

/** The tooltip for a figure: the page it was read from, or that it was typed by hand. */
export function provenanceTip(source) {
  const name = source?.name ?? "";
  if (source?.byHand) return game.i18n.format("ACKS-EQUIPMENT.printed.byHand", { name });
  if (source?.cite) return game.i18n.format("ACKS-EQUIPMENT.printed.fromPage", { name, cite: source.cite });
  return game.i18n.format("ACKS-EQUIPMENT.printed.fromDocument", { name });
}

/** The tooltip for a layer whose document is not imported, naming the key to make or import. */
export const notImportedTip = (key) => game.i18n.format("ACKS-EQUIPMENT.printed.notImportedTip", { key });
