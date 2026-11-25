/**
 * The Foundry-free half of the organisation chart's surface (docs/lib/ORGANISATION.md,
 * "The chart's tab"): what a card shows and offers, which branches a fold hides, which
 * rows a Roll at random fills, and the family template a card's Roll reads. Pure, over
 * the view `orgChartView` answers and plain facts the sheet passes in, so it imports
 * under Node and is unit-tested offline (tools/test-org-chart-ui.mjs). It names no
 * creature, unit or rank: every word on a card is the row's own.
 */
import { nodesOf, rowAncestors } from "./org-tree-logic.mjs";

/**
 * The family template a row's Roll reads and the variant it began with: the row's own
 * `gen`, else the nearest row above it that holds one. Blank where none does, and a
 * Roll is then not offered.
 * @param {object[]} rows the host's rows
 * @param {string} key the row
 * @returns {{template: string, variant: string}}
 */
export function templateOf(rows, key) {
  const nodes = nodesOf(rows);
  const byKey = new Map((rows ?? []).map((r) => [r?.toObject?.()?.key ?? r.key, r?.toObject?.() ?? r]));
  for (const k of [key, ...rowAncestors(key, nodes)]) {
    const gen = byKey.get(k)?.gen;
    if (gen?.template) return { template: String(gen.template), variant: String(gen.variant ?? "") };
  }
  return { template: "", variant: "" };
}

/**
 * What a uuid reads as after the pack that holds it has built its index. A world pack's startup
 * index carries only the document class's own core fields; the module's added index fields
 * (a template's plate) reach an index only through a client `getIndex()`, which answers at once
 * once the pack is indexed. A uuid outside a pack has no pack to index and is read as it is.
 * @param {string} uuid
 * @param {{pack?: {getIndex?: () => Promise<unknown>}|null, read: (uuid: string) => unknown}} deps
 *   the pack holding the uuid (or none) and the synchronous read (`fromUuidSync`)
 * @returns {Promise<unknown>} the document, or its index entry, or null
 */
export async function readAfterIndex(uuid, { pack, read }) {
  if (!uuid) return null;
  await pack?.getIndex?.();
  return read(uuid) ?? null;
}

/**
 * The family template a chart's Roll reads and what its first Roll recorded, for the Variant
 * list and the panel's defaults. The template is loaded whole through `load` (`fromUuid`): the
 * Variant list reads `system.axes`, which no index carries.
 * @param {object[]} rows the host's rows
 * @param {string} key the row pressed
 * @param {(uuid: string) => Promise<object|null>} load
 * @returns {Promise<{family: object|null, defaults: {variant: string, context: string, state: string, rules: object, choices: object}}>}
 */
export async function familyOfRows(rows, key, load) {
  const { template, variant } = templateOf(rows, key);
  const began = (rows ?? []).map((r) => r?.toObject?.() ?? r).find((r) => r.gen?.variant)?.gen ?? {};
  let family = null;
  if (template) {
    try {
      family = (await load(template)) ?? null;
    } catch {
      family = null;
    }
  }
  return { family, defaults: { variant: variant || began.variant, context: began.context, state: began.state, rules: began.rules, choices: began.choices } };
}

/** The keys of every empty row, in reading order: what Roll at random fills, each a Roll of its own with all below it. */
export const emptyKeys = (view) => (view?.rows ?? []).filter((r) => r.empty).map((r) => r.key);

/**
 * Where a row stands in its chart, for a slot's unit: how many rows lie between it and the
 * chart's top, and the unit word the top row holds (blank before a roll).
 * @param {object[]} rows the host's rows
 * @param {string} key
 * @returns {{depth: number, topKind: string}}
 */
export function slotPosition(rows, key) {
  const list = (rows ?? []).map((r) => r?.toObject?.() ?? r);
  const above = rowAncestors(key, nodesOf(list));
  const top = list.find((r) => r.key === (above.at(-1) ?? key));
  return { depth: above.length, topKind: String(top?.kind ?? "") };
}

/** The keys of every row with rows beneath it: what Collapse all folds. */
export const branchKeys = (view) => (view?.rows ?? []).filter((r) => r.children.length).map((r) => r.key);

/**
 * Whether a row's Recall can succeed, so the control is drawn only where it does something:
 * the row has a row above it and that row holds a group to put it back under. A top row has
 * nothing to return to, and an empty parent row has no group to take it.
 * @param {{parentKey?: string}} row the row Recall would act on
 * @param {{holderUuid?: string}|null|undefined} parent the row above it; `undefined` where the
 *   view is cut below it (a group's own chart) and the row above is not in hand, `null` where
 *   the row names a parent the host does not hold
 * @returns {boolean}
 */
export function recallOffered(row, parent) {
  if (!row?.parentKey) return false;
  return parent === undefined ? true : !!parent?.holderUuid;
}

/**
 * The Locations rows with `canRecall` set: a row a seat can write whose Recall `recallOffered` says can succeed.
 * @param {object[]} rows the chart rows standing on the places
 * @param {object[]} hostRows the host's own rows, where each row's parent is looked up
 * @param {boolean} editable whether this seat writes the host
 * @returns {object[]}
 */
export function withRecall(rows, hostRows, editable) {
  const byKey = new Map((hostRows ?? []).map((r) => {
    const plain = r?.toObject?.() ?? r;
    return [plain.key, plain];
  }));
  return (rows ?? []).map((r) => ({ ...r, canRecall: !!editable && recallOffered(r, byKey.get(r.parentKey) ?? null) }));
}

/**
 * The cards a tab draws: the view's tree with each branch's fold applied and each card's
 * controls decided. A folded card keeps its count and drops its children from the tree,
 * leaving the number of rows and bodies beneath it.
 *
 * @param {object[]} roots `orgChartView`'s roots
 * @param {object} state
 * @param {Set<string>} [state.collapsed] keys of the folded branches
 * @param {Object<string, string[]>} [state.outAt] a row's holder uuid → the names of the places it stands on
 * @param {(key: string) => boolean} [state.canRoll] whether a Roll is offered on the row
 * @param {boolean} [state.canEdit] whether this seat writes the host
 * @returns {object[]} the cards, each `{...row, roleKey, folded, hasKids, below: {rows, bodies}, out, canRecall, canRoll, canEdit, children}`; `canRecall` is `recallOffered` on a card standing out; `roleKey` is `roleOf` read before the fold empties `children`, so a folded card keeps its rank
 */
export function chartCards(roots, { collapsed = new Set(), outAt = {}, canRoll = () => false, canEdit = true } = {}) {
  const below = (node) => node.children.reduce((sum, c) => {
    const inner = below(c);
    return { rows: sum.rows + 1 + inner.rows, bodies: sum.bodies + (c.covered ? 0 : c.count) + inner.bodies };
  }, { rows: 0, bodies: 0 });
  const draw = (node, parent) => {
    const folded = collapsed.has(node.key) && node.children.length > 0;
    const out = outAt[node.holderUuid] ?? [];
    const word = String(node.kind ?? "");
    const rank = word && !String(node.label ?? "").toLowerCase().includes(word.toLowerCase()) ? `${word} · ${node.label}` : String(node.label ?? "");
    return {
      ...node,
      rank,
      roleKey: roleOf(node),
      folded,
      hasKids: node.children.length > 0,
      below: folded ? below(node) : null,
      out,
      isOut: out.length > 0,
      canRecall: out.length > 0 && recallOffered(node, parent),
      canRoll: node.empty && !!canRoll(node.key),
      canEdit: !!canEdit,
      children: folded ? [] : node.children.map((c) => draw(c, node)),
    };
  };
  return (roots ?? []).map((n) => draw(n));
}

/**
 * The subtree a group's own sheet shows once it has joined a faction: the faction's
 * chart cut down to the group's row and the rows beneath it, read in place and never copied.
 * @param {object} view `orgChartView`'s answer for the faction
 * @param {string} key the group's row there
 * @returns {{roots: object[], rows: object[], total: number, empty: number}}
 */
export function subtreeView(view, key) {
  const top = (view?.rows ?? []).find((r) => r.key === key);
  if (!top) return { roots: [], rows: [], total: 0, empty: 0 };
  const rows = [];
  const walk = (n) => {
    rows.push(n);
    n.children.forEach(walk);
  };
  walk({ ...top, depth: 0 });
  return { roots: [top], rows, total: rows.reduce((sum, r) => sum + (r.covered ? 0 : r.count), 0), empty: rows.filter((r) => r.empty).length };
}

/**
 * The unit word a chart already uses one level below its top, for a hand-added
 * warband-level row: where the rows beneath the top share a kind, a new row takes it;
 * otherwise it takes none and is named only by its label.
 * @param {object} view `orgChartView`'s answer
 * @returns {string}
 */
export function nextLevelKind(view) {
  const top = view?.roots?.[0];
  const kinds = new Set((top?.children ?? []).map((c) => c.kind).filter(Boolean));
  return kinds.size === 1 ? [...kinds][0] : "";
}

/** The client setting that turns the ask before a multi-row Remove on or off; on by default. */
export const CONFIRM_REMOVE_SETTING = "confirmRemoveRows";

/**
 * The rows a Remove of `key` takes: the row and every row beneath it, in reading order.
 * @param {{rows: object[]}} view `orgChartView`'s answer
 * @param {string} key
 * @returns {{key: string, label: string}[]}
 */
export function removalRows(view, key) {
  const rows = view?.rows ?? [];
  const at = rows.findIndex((r) => r.key === key);
  if (at < 0) return [];
  const keep = new Set([key]);
  const out = [];
  for (const r of rows.slice(at)) {
    if (r.key === key || keep.has(r.parentKey)) {
      keep.add(r.key);
      out.push({ key: r.key, label: r.rank ?? r.label });
    }
  }
  return out;
}

/**
 * Does a Remove ask first? Only where it would take more than one row and the Judge's
 * setting is on; a row on its own is removed at once.
 * @param {{key: string}[]} going the rows the Remove takes
 * @param {boolean} setting the client setting
 */
export const asksBeforeRemoving = (going, setting) => !!setting && (going?.length ?? 0) > 1;

/**
 * The role a card's head is framed and worded as, read from the chart's own data and from no
 * name table. A card with no leader that holds something is **file** (the rank and file, a
 * hairline frame); an empty card has none. A leader is the officer of the card's group, and
 * the unit it leads decides the rest: the officer of a unit of bodies only is a **champion**;
 * the officer of a unit that holds units is the **chief** where its card is the top of the
 * chart (no `parentKey`) and a **sub** chief anywhere below. How many levels of units lie
 * beneath is `gen.tier` where the Roll recorded it, else the rows beneath the card, so a
 * leader set by hand on a hand-added card reads the same way.
 * @param {{officer?: object|null, empty?: boolean, parentKey?: string, gen?: {tier?: number}, children?: object[]}} node a view row
 * @returns {"file"|"champion"|"sub"|"chief"|""}
 */
export function roleOf(node) {
  if (node?.empty) return "";
  if (!node?.officer) return "file";
  const tierOf = (n) => Math.max(-1, ...(n.children ?? []).map(tierOf)) + 1;
  const tier = Number.isInteger(node?.gen?.tier) ? node.gen.tier : tierOf(node);
  if (tier <= 0) return "champion";
  return node.parentKey ? "sub" : "chief";
}

/**
 * Is a count one set by hand? A stack records the total its Roll threw (`gen.rolled`); a
 * stack whose total differs, and a stack nothing rolled (no record), reads the first as
 * by hand and the second as not. Derived each time and never stored.
 * @param {{size?: {initial?: number}, gen?: {rolled?: number|null}, template?: {label?: string}}[]} stacks a group's stacks
 * @returns {{byHand: boolean, rolled: number, now: number, label: string}|null} the first stack that differs, or null
 */
export function byHandOf(stacks) {
  for (const s of stacks ?? []) {
    const rolled = s?.gen?.rolled;
    if (rolled === null || rolled === undefined) continue;
    const now = s.size?.initial ?? 0;
    if (now !== rolled) return { byHand: true, rolled, now, label: s.template?.label ?? "" };
  }
  return null;
}

/**
 * What an Unlist left, for the line above the chart: each group that now hosts what was
 * unlisted and how many rows were dropped for naming no holder.
 * @param {{units?: {uuid: string, name: string}[], dropped?: string[]}} result `org.unlistRow`'s answer
 * @returns {{groups: {uuid: string, name: string}[], dropped: number}|null} null where nothing came off
 */
export function unlistedView(result) {
  const groups = (result?.units ?? []).map((u) => ({ uuid: u.uuid, name: u.name }));
  const dropped = result?.dropped?.length ?? 0;
  return groups.length || dropped ? { groups, dropped } : null;
}
