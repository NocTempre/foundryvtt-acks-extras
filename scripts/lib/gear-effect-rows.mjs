/* global foundry */
/**
 * A carried item's effect rows, as the item sheet lists them: the store the
 * row editor writes through and the one-line summary each row wears. The rows
 * are `flags["acks-extras"].itemRun.rows`, the list the item runner reads
 * (`item-run-logic.mjs` `itemRunRowsOf`); an item that carries rows and no
 * `itemRun.activation` has them always on.
 *
 * The summary says what KIND of thing a row does and whether it has a reach
 * and a save, never how much: a reach's figure is read from the import at
 * render, with a tooltip that names the row and page it was read from, and a
 * reach with no figure shows the page reference alone. The sheet that draws
 * the list is `gear-effect-sheet.mjs`.
 */
import { FLAG_ITEM_RUN, MODULE_ID } from "./constants.mjs";
import { EFFECT_TYPES, GEAR_DOMAIN } from "./vocab.mjs";
import { figureNumber, readReach } from "./aura-reach-logic.mjs";
import { itemCite, reachFigures } from "./item-run-logic.mjs";
import { blankTip, importTip } from "./item-run-card-logic.mjs";
import { citeOf } from "./tables.mjs";
import { unset } from "./util.mjs";

/** The stored `itemRun` flag of an item, whole and uncoerced. */
const storedRun = (item) => item?.getFlag?.(MODULE_ID, FLAG_ITEM_RUN) ?? item?.flags?.[MODULE_ID]?.[FLAG_ITEM_RUN];

/** The stored rows of an item, whole and uncoerced, `[]` where it holds none. */
function storedRows(item) {
  const rows = storedRun(item)?.rows;
  return Array.isArray(rows) ? rows : [];
}

/**
 * What the effect-row editor's reach group reads and writes of the ITEM a row
 * belongs to, as the store's `carrier`: the item's page, its stored activation
 * kind, the one write of that kind, the once-only mark and the face of a
 * reach's figure. A carried item and an ability item hold the same
 * `itemRun.activation`, so both stores hand over this one. A write of the kind
 * touches `activation.kind` alone, so a raised item's state and the figures a
 * fuse or a counted item names are kept, with one exception: a move into or out
 * of `once` also removes `activation.uses`, since on a once-only item `uses`
 * is the tick and nothing else, and a toggle or a fresh once item must not
 * inherit another kind's. An absent kind removes the activation, which leaves
 * the item always on.
 *
 * @param {Item} item
 * @returns {{cite: Function, activationKind: Function, usesNamed: Function, setUses: Function, raised: Function, setActivation: Function, reachFace: Function}}
 *   `reachFace(reach, say)` is `reachFace` for this item; `raised()` is whether
 *   the item is raised now (its activation's `state.active`); `setActivation(kind)`
 *   takes a kind, or null to remove the activation; `usesNamed()` is whether the
 *   activation names `uses` (a stored object, as `readItemRun` reads it) and
 *   `setUses(on)` stores an empty object where on, else removes `uses`.
 */
export function itemCarrier(item) {
  const path = `flags.${MODULE_ID}.${FLAG_ITEM_RUN}.activation`;
  return {
    cite: () => itemCite(item),
    activationKind: () => String(storedRun(item)?.activation?.kind ?? ""),
    raised: () => storedRun(item)?.activation?.state?.active === true,
    usesNamed: () => {
      const uses = storedRun(item)?.activation?.uses;
      return !!uses && typeof uses === "object";
    },
    setUses: (on) => item.update({ [`${path}.uses`]: on ? {} : unset() }),
    setActivation: (kind) => {
      const stored = String(storedRun(item)?.activation?.kind ?? "");
      const update = { [kind ? `${path}.kind` : path]: kind || unset() };
      if (kind && kind !== stored && (kind === "once" || stored === "once")) update[`${path}.uses`] = unset();
      return item.update(update);
    },
    reachFace: (reach, say) => reachFace(reach, { itemName: item.name, cite: itemCite(item), say }),
  };
}

/**
 * The store the effect-row editor writes a carried item's rows through: the
 * stored `itemRun.rows` flag, read and written whole and uncoerced, so a row
 * the window did not touch (its `reach` included) is written back as it was
 * stored. `write` touches only the rows path; the item's `itemRun.activation`
 * is written by the `carrier` the reach group's "How it is used" calls.
 *
 * @param {Item} item
 * @returns {{key: string, label: string, domain: string, cite: Function, carrier: object, read: Function, write: Function, editable: Function}}
 *   `editable()` is Foundry's ownership: the item's pack is not locked and the
 *   user owns it. Nothing here reads the user's role.
 */
export function gearEffectStore(item) {
  const path = `flags.${MODULE_ID}.${FLAG_ITEM_RUN}.rows`;
  return {
    key: `${item.uuid}:${FLAG_ITEM_RUN}.rows`,
    label: item.name,
    domain: GEAR_DOMAIN,
    cite: () => itemCite(item),
    carrier: itemCarrier(item),
    editable: () => !item.compendium?.locked && item.isOwner === true,
    read: () => foundry.utils.deepClone(storedRows(item)),
    write: async (rows) => {
      await item.update({ [path]: rows });
      return rows;
    },
  };
}

/**
 * What a row's reach says on its line: the figure and the tooltip of where it
 * came from. A figure read from an imported table says the row and the page the
 * importer read it from (`importTip`); a reach whose figure is blank draws no
 * number, only the page reference (`blankTip`). The page is the table's own
 * where the reference names one, else the item's.
 *
 * @param {{radius: object|null, engaged: boolean}} reach a stored reach read by `readReach`, or those two members of one
 * @param {{itemName: string, cite: string, say: Function, read?: Function}} ctx
 * @returns {{engaged: boolean, blank: boolean, radius: number|null, tip: string, aria: string, page: string}}
 *   `page` is the page the figure is read from: the table's own where the
 *   reference names one, else the item's
 */
function reachFace(reach, { itemName, cite, say, read }) {
  if (reach.engaged) {
    const tip = say("itemRun.card.engagedNoteTip");
    return { engaged: true, blank: false, radius: null, tip, aria: tip, page: cite };
  }
  const radius = figureNumber(reach.radius, read);
  const ref = reach.radius ?? {};
  const page = (ref.doc && ref.table ? citeOf(ref.doc, ref.table) : null) ?? cite;
  const tip = (radius === null ? blankTip({ cite: page }) : importTip({ label: itemName, figure: `${radius}′`, cite: page })) ?? "";
  return { engaged: false, blank: radius === null, radius, tip, aria: radius === null ? tip || say("gearRows.reach") : tip, page };
}

/**
 * One row's line: its kind, and, where it has them, its reach and its save.
 *
 * @param {object} row a stored row
 * @param {{itemName?: string, cite?: string, say: Function, read?: Function}} ctx
 *   `say(key, data)` reads a lang key under `ACKS-LIB`; `read` is the table
 *   read `resolveFigure` takes (the registry's by default)
 * @returns {{kind: string, reach: object|null, save: boolean, cite: string}} `reach` is null for a row with none; `cite` is the item's page, the reference the save names
 */
export function gearRowSummary(row, { itemName = "", cite = "", say, read } = {}) {
  const reach = readReach(row?.reach);
  const figures = reach ? reachFigures(row, read) : null;
  return {
    kind: EFFECT_TYPES[row?.type]?.label ?? row?.type ?? "",
    reach: reach ? { ...reachFace(reach, { itemName, cite, say, read }), label: say("gearRows.inReach") } : null,
    save: !!figures?.save,
    cite,
  };
}

/**
 * The model the item sheet's group draws: every row's line with the index its
 * Edit and Delete carry, and whether this user may change the list.
 *
 * @param {Item} item
 * @param {{say: Function, read?: Function}} ctx as `gearRowSummary`
 * @returns {{editable: boolean, rows: object[], title: string, add: string, hint: string, none: string, saveWord: string}}
 */
export function gearRowsModel(item, { say, read } = {}) {
  const editable = gearEffectStore(item).editable();
  const cite = itemCite(item);
  const rows = storedRows(item).map((row, index) => ({
    index,
    name: say("gearRows.row", { n: index + 1 }),
    edit: say("gearRows.editRow", { n: index + 1 }),
    del: say("gearRows.deleteRow", { n: index + 1 }),
    ...gearRowSummary(row, { itemName: item.name, cite, say, read }),
  }));
  return { editable, rows, title: say("gearRows.title"), add: say("gearRows.add"), hint: say("gearRows.hint"), none: say("gearRows.none"), saveWord: say("gearRows.save") };
}
