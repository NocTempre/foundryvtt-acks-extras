/* global Roll */
/**
 * Rolling a magic item from the imported tables: the registry read, where a
 * start list comes from, what a list is called and where it was read from, and
 * the Foundry roller. The walk itself is `chain-logic.mjs`.
 *
 * Nothing here holds a table, a caption or a page: every name and cite arrives
 * from the `magicItemTables` document the Judge's own copy filled, and a world
 * with nothing imported answers `not-imported` instead of a figure.
 */
import * as services from "../lib/services.mjs";
import { getDoc, getLayer, hasDoc, citeOf, PRIORITY } from "../lib/tables.mjs";
import { COOKBOOK_ITEMS_CONTRACT, MAGIC_ITEM_DOC } from "./constants.mjs";
import { armsTypeOf, listAt, walkChain } from "./chain-logic.mjs";

/** The document's merged tables, or null while nothing is imported. */
export function readTables() {
  return hasDoc(MAGIC_ITEM_DOC) ? getDoc(MAGIC_ITEM_DOC).tables ?? null : null;
}

/**
 * Where a roll begins. `from` (a list id) wins. Otherwise the classic style
 * begins at its category lists (`category`, or the type list that picks one
 * when none is named), and the heroic and gritty styles, which share the
 * rarity lists, at the one named by `rarity`.
 *
 * @returns {{ok: true, from: string}|{ok: false, reason: string}} `reason` is
 *   `rarity-required` or `unknown-style`
 */
export function startOf({ from, style, rarity, category } = {}) {
  if (from) return { ok: true, from };
  if (style === "classic") return { ok: true, from: category ? `classic.${category}` : "classicType.bands" };
  if (style === "heroic" || style === "gritty") {
    return rarity ? { ok: true, from: `heroic.${rarity}` } : { ok: false, reason: "rarity-required" };
  }
  return { ok: false, reason: "unknown-style" };
}

/**
 * What a list is called and where it was read from: `{caption, cite,
 * overridden}`. A table a Judge has overridden has no page to point at (`cite`
 * null, `overridden` true). Otherwise the list's own pages (`tables.listCites`,
 * the pages of the segments the list was read from, each book where the Tome's
 * version replaced the Journal's) and, when the import recorded none, the page
 * of its table.
 */
export function describeList(id, tables = readTables()) {
  const table = String(id ?? "").split(".")[0];
  const overridden = getLayer(MAGIC_ITEM_DOC, PRIORITY.OVERRIDE)?.tables?.[table] != null;
  const cite = overridden ? null : tables?.listCites?.[id] ?? citeOf(MAGIC_ITEM_DOC, table);
  return { caption: tables?.captions?.[id] ?? null, cite, overridden };
}

/**
 * The lists a roll may begin at, labelled by their captions as imported:
 * `{classicType, classic: [{key, id, caption}], heroic: [...]}`. A list the
 * import did not read is absent, and `classicType` is null then.
 */
export function starts(tables = readTables()) {
  const entry = (table, key) => ({ key, id: `${table}.${key}`, caption: tables?.captions?.[`${table}.${key}`] ?? null });
  const keys = (table) => Object.keys(tables?.[table] ?? {}).filter((k) => listAt(tables, `${table}.${k}`));
  return {
    classicType: listAt(tables, "classicType.bands") ? entry("classicType", "bands") : null,
    classic: keys("classic").map((k) => entry("classic", k)),
    heroic: keys("heroic").map((k) => entry("heroic", k)),
  };
}

/**
 * The Foundry roller: `new Roll(expr).evaluate()`, answering `{total, sides,
 * roll}` with `sides` the faces of the first die. Each Roll is pushed on `rolls`,
 * for a chat card that shows the dice.
 */
export function foundryRoller(rolls = []) {
  return async (expr) => {
    const roll = await new Roll(expr).evaluate();
    rolls.push(roll);
    return { total: roll.total, sides: roll.dice?.[0]?.faces ?? null, roll };
  };
}

/**
 * The document a rolled row links to: `{uuid}` from the `cookbook-items`
 * provider's `documentOf(ref)`, or null when the row carries no `ref`, no
 * provider is registered, the provider answers no document or it throws. Only a
 * row with a `ref` asks.
 */
export async function linkedDocument(ref) {
  if (typeof ref !== "string" || !ref) return null;
  const provider = services.get(COOKBOOK_ITEMS_CONTRACT);
  if (typeof provider?.documentOf !== "function") return null;
  try {
    const doc = await provider.documentOf(ref);
    return typeof doc?.uuid === "string" && doc.uuid ? { uuid: doc.uuid } : null;
  } catch {
    return null;
  }
}

/**
 * Roll one magic item. A world with nothing imported, a start that cannot be
 * named and a list that cannot be rolled each answer `{ok: false, reason}`
 * with whatever was rolled before; nothing here throws on the tables' content.
 *
 * @param {object} [args]
 * @param {string} [args.from] a list id to begin at, over `style`
 * @param {"classic"|"heroic"|"gritty"} [args.style]
 * @param {string} [args.rarity] the heroic or gritty list's key
 * @param {string} [args.category] the classic category list's key
 * @param {string} [args.armsSetting] a setting column's key in the arms grids (`s1` and on); with it, a
 *   row that links to an arms grid is also typed (`item.armsType`), and without it nothing extra is rolled
 * @param {function} [args.roller] `roll(expr) -> {total, sides}`; the Foundry roller by default
 * @param {object} [args.tables] the document's tables; the registry's by default
 * @returns {Promise<{ok: boolean, reason?: string, start: string|null,
 *   steps: object[], item: object|null, error?: object, rolls: Roll[]}>}
 *   Each step is a walk step with the list's `caption`, `cite` and `overridden`.
 *   The item's `uuid` is the linked document's where its `ref` names one the
 *   `cookbook-items` provider answers, else null. `item.arms` is the row's link to
 *   the grid or list that types an arm (`{grid}`, `{kind}` or `{name}`), present
 *   only on a row that has one. `item.armsType` is the type rolled on the setting's
 *   column, as the grid prints it: present only with `armsSetting`, a `{grid}` or
 *   `{kind}` link, and lists that roll. A `{name}` link rolls nothing, since the row's
 *   own noun names the arm. The type's dice are in `rolls` after the chain's, never in `steps`.
 */
export async function rollMagicItem({ from, style, rarity, category, armsSetting, roller, tables } = {}) {
  const rolls = [];
  const refuse = (reason, extra = {}) => ({ ok: false, reason, start: null, steps: [], item: null, rolls, ...extra });
  const source = tables === undefined ? readTables() : tables;
  if (!source) return refuse("not-imported");
  const start = startOf({ from, style, rarity, category });
  if (!start.ok) return refuse(start.reason);
  const roll = roller ?? foundryRoller(rolls);
  const walked = await walkChain({ tables: source, from: start.from, roll });
  const steps = walked.steps.map((s) => ({ ...s, ...describeList(s.list, source) }));
  if (walked.error) {
    return { ok: false, reason: walked.error.code, start: start.from, steps, item: null, error: walked.error, rolls };
  }
  const linked = await linkedDocument(walked.item?.ref);
  const item = linked ? { ...walked.item, uuid: linked.uuid } : walked.item;
  const armsType = await armsTypeOf({ tables: source, arms: item?.arms, setting: armsSetting, roll });
  return { ok: true, start: start.from, steps, item: armsType ? { ...item, armsType } : item, rolls };
}
