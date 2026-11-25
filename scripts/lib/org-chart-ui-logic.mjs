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

/** The keys of every empty row, in reading order: what Roll at random fills, each a Roll of its own with all below it. */
export const emptyKeys = (view) => (view?.rows ?? []).filter((r) => r.empty).map((r) => r.key);

/** The keys of every row with rows beneath it: what Collapse all folds. */
export const branchKeys = (view) => (view?.rows ?? []).filter((r) => r.children.length).map((r) => r.key);

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
 * @returns {object[]} the cards, each `{...row, folded, hasKids, below: {rows, bodies}, out, canRoll, canEdit, children}`
 */
export function chartCards(roots, { collapsed = new Set(), outAt = {}, canRoll = () => false, canEdit = true } = {}) {
  const below = (node) => node.children.reduce((sum, c) => {
    const inner = below(c);
    return { rows: sum.rows + 1 + inner.rows, bodies: sum.bodies + (c.covered ? 0 : c.count) + inner.bodies };
  }, { rows: 0, bodies: 0 });
  const draw = (node) => {
    const folded = collapsed.has(node.key) && node.children.length > 0;
    const out = outAt[node.holderUuid] ?? [];
    const word = String(node.kind ?? "");
    const rank = word && !String(node.label ?? "").toLowerCase().includes(word.toLowerCase()) ? `${word} · ${node.label}` : String(node.label ?? "");
    return {
      ...node,
      rank,
      folded,
      hasKids: node.children.length > 0,
      below: folded ? below(node) : null,
      out,
      isOut: out.length > 0,
      canRoll: node.empty && !!canRoll(node.key),
      canEdit: !!canEdit,
      children: folded ? [] : node.children.map(draw),
    };
  };
  return (roots ?? []).map(draw);
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
