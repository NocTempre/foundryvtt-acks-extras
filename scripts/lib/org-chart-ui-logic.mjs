/**
 * The Foundry-free half of the organisation chart's surface (docs/lib/ORGANISATION.md,
 * "The chart's tab"): what a card shows and offers, which branches a fold hides, which
 * rows a Roll at random fills, and the family template a card's Roll reads. Pure, over
 * the view `orgChartView` answers and plain facts the sheet passes in, so it imports
 * under Node and is unit-tested offline (tools/test-org-chart-ui.mjs). It names no
 * creature, unit or rank: every word on a card is the row's own.
 */
import { MODULE_ID } from "./constants.mjs";
import { nodesOf, rowAncestors } from "./org-tree-logic.mjs";
import { ORG_PROTOTYPE_FLAG } from "./org-write-logic.mjs";

/**
 * Whether a row is a part of the Roll's entry rather than a unit: the Roll wrote it for one non-body
 * part and recorded that part's source on its `gen` (`planRoll` writes `gen.part`). Such a row has no
 * unit shape to roll, so a Roll is never offered on it and is refused if asked.
 * @param {object[]} rows the host's rows
 * @param {string} key the row
 * @returns {boolean}
 */
export function isPartRow(rows, key) {
  const row = (rows ?? []).map((r) => r?.toObject?.() ?? r).find((r) => r?.key === key);
  return !!row?.gen?.part;
}

/**
 * The family template a row's Roll reads and the variant it began with: the row's own
 * `gen`, else the nearest row above it that holds one, else the record on the host itself
 * (`hostGen`, left by a Roll whose top unit is the host, which has no row to carry it).
 * Blank where none does, and a Roll is then not offered.
 * @param {object[]} rows the host's rows
 * @param {string} key the row
 * @param {object|null} [hostGen] the host's own record (`org.hostGenOf`)
 * @returns {{template: string, variant: string}}
 */
export function templateOf(rows, key, hostGen = null) {
  const nodes = nodesOf(rows);
  const byKey = new Map((rows ?? []).map((r) => [r?.toObject?.()?.key ?? r.key, r?.toObject?.() ?? r]));
  for (const k of [key, ...rowAncestors(key, nodes)]) {
    const gen = byKey.get(k)?.gen;
    if (gen?.template) return { template: String(gen.template), variant: String(gen.variant ?? "") };
  }
  if (hostGen?.template) return { template: String(hostGen.template), variant: String(hostGen.variant ?? "") };
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
 * @param {object|null} [hostGen] the host's own record, read after the rows' (`templateOf`)
 * @returns {Promise<{family: object|null, defaults: {variant: string, context: string, state: string, rules: object, choices: object}}>}
 */
export async function familyOfRows(rows, key, load, hostGen = null) {
  const { template, variant } = templateOf(rows, key, hostGen);
  const began = (rows ?? []).map((r) => r?.toObject?.() ?? r).find((r) => r.gen?.variant)?.gen ?? hostGen ?? {};
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
 * @param {boolean} [state.hostLeads] the host itself holds the chart's chief (a faction whose top unit is the host), so no card is the chief
 * @returns {object[]} the cards, each `{...row, roleKey, folded, hasKids, below: {rows, bodies}, out, canRecall, canRoll, canEdit, children}`; `canRecall` is `recallOffered` on a card standing out; `roleKey` is `roleOf` read before the fold empties `children`, so a folded card keeps its rank
 */
export function chartCards(roots, { collapsed = new Set(), outAt = {}, canRoll = () => false, canEdit = true, hostLeads = false } = {}) {
  const below = (node) => node.children.reduce((sum, c) => {
    const inner = below(c);
    return { rows: sum.rows + 1 + inner.rows, bodies: sum.bodies + (c.covered ? 0 : c.count) + inner.bodies };
  }, { rows: 0, bodies: 0 });
  const draw = (node, parent) => {
    const folded = collapsed.has(node.key) && node.children.length > 0;
    const out = outAt[node.holderUuid] ?? [];
    const rank = rankOf(node);
    return {
      ...node,
      rank,
      roleKey: roleOf(node, hostLeads),
      leaderRoleKey: node.empty ? "" : leaderRoleOf(node, hostLeads),
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
 * What a lord's root card counts: its direct followers, the lone actors (hirelings) apart
 * from the groups (hired units). Read from the view's own children, so a folded root still
 * counts what it hides.
 * @param {{holderUuid?: string}[]} children the root's children in `orgChartView`
 * @param {(holderUuid: string) => boolean} isGroup whether a holder is a group actor
 * @returns {{henchmen: number, units: number}}
 */
export function serviceSummary(children, isGroup) {
  let units = 0;
  for (const c of children ?? []) if (isGroup(c?.holderUuid)) units++;
  return { henchmen: (children ?? []).length - units, units };
}

/**
 * The bodies a lord's chart totals: every card but the root, a card inside another's
 * group counted once. The root is the sheet's own actor and is not one of its followers.
 * @param {{rows: {key: string, count: number, covered?: boolean}[]}} view `orgChartView`'s answer
 * @param {string} rootKey
 * @returns {number}
 */
export function serviceTotal(view, rootKey) {
  return (view?.rows ?? []).reduce((sum, r) => sum + (r.key === rootKey || r.covered ? 0 : r.count), 0);
}

/**
 * The service-mode marks of one card (the Followers tab draws a lord's service tree through the
 * chart partials): no role frame, no form, no die, and a foot of Open, Send out and Recall. A
 * lone actor and the root draw no bodies line (a lone actor is one); the root draws no foot controls
 * (it is the sheet's own actor). Send out and Recall follow the seat's ownership of the employer, and
 * Recall is drawn only for a follower standing on a roster.
 * @param {{isOut?: boolean}} card a `chartCards` card
 * @param {{isGroup: boolean, isRoot: boolean, owns: boolean}} facts
 * @returns {object} the fields laid over the card
 */
export function serviceFlags(card, { isGroup, isRoot, owns }) {
  const mayMove = !!owns && !isRoot;
  return {
    service: true,
    root: !!isRoot,
    lone: !!isRoot || !isGroup,
    role: null,
    canEdit: false,
    canRoll: false,
    editing: false,
    groupGone: false,
    canSend: mayMove,
    canRecall: mayMove && !!card?.isOut,
  };
}

/**
 * The Locations rows of a lord's service tree: every node but the root, each naming the
 * employer as its host, in the shape `locationsView` takes.
 * @param {{key: string, parentKey: string, label: string, holderUuid: string, kind: string}[]} nodes `serviceNodes`' answer
 * @param {string} rootKey the employer's key
 * @param {string} hostUuid the employer
 * @returns {object[]}
 */
export function serviceRows(nodes, rootKey, hostUuid) {
  return (nodes ?? []).filter((n) => n.key !== rootKey).map((n) => ({ ...n, hostUuid }));
}

/**
 * A Locations chip's service marks (`service` on the chip itself, since a template's loops leave the
 * root's flag behind): Send out wherever the seat owns the employer, Recall
 * only for a follower standing directly on a roster (one inside a group on the roster
 * stands on none itself, so there is nothing to take it off).
 * @param {{inside?: boolean}} row a `locationsView` row
 * @param {boolean} owns whether the seat owns the employer
 * @returns {object}
 */
export function serviceRowFlags(row, owns) {
  return { ...row, service: true, canSend: !!owns, canRecall: !!owns && !row?.inside };
}

/**
 * The places each follower stands on, by holder uuid, from the places a reader may see
 * (`org.placesOf`, which has already left out a roster row marked hidden from a seat that
 * is not the Judge's). A row names its holder by `uuid`.
 * @param {{name: string, roster: {uuid: string}[]}[]} places
 * @returns {Object<string, string[]>} a holder uuid → the names of the places whose roster holds it
 */
export function placeNamesOf(places) {
  const at = {};
  for (const place of places ?? []) {
    for (const row of place?.roster ?? []) {
      if (!row?.uuid || !place.name) continue;
      (at[row.uuid] ??= []).push(place.name);
    }
  }
  return at;
}

/** The categories a service node's `kind` can carry: a hireling's retainer category and a hired unit's group category. */
const SERVICE_KINDS = Object.freeze(["henchman", "mercenary", "specialist", "monster", "follower"]);

/**
 * The lang suffix (under `service.kind.`) of the word a service card's rank line names its
 * kind with, blank for a root, a blank category or one this list does not know, which then
 * draw no word.
 * @param {string} kind a service node's `kind`
 * @returns {string}
 */
export function serviceKindKey(kind) {
  const key = String(kind ?? "").trim().toLowerCase();
  return SERVICE_KINDS.includes(key) ? key : "";
}

/**
 * The unit word a chart already uses one level below its top, for a hand-added
 * warband-level row: where the rows beneath the top share a kind, a new row takes it;
 * otherwise it takes none and is named only by its label.
 * @param {object} view `orgChartView`'s answer
 * @param {boolean} [hostLeads] the host holds the chief, so the level is the top rows' own
 * @returns {string}
 */
export function nextLevelKind(view, hostLeads = false) {
  const level = hostLeads ? view?.roots : view?.roots?.[0]?.children;
  const kinds = new Set((level ?? []).map((c) => c.kind).filter(Boolean));
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
 * What a Remove of `key` does to the chart: the row leaves, the rows directly beneath it stay and
 * move up to its parent row, or to the top where it has none.
 * @param {{rows: object[]}} view `orgChartView`'s answer
 * @param {string} key
 * @returns {{row: {key: string, label: string}|null, lifted: {key: string, label: string}[], under: {key: string, label: string}|null}}
 */
export function liftedBy(view, key) {
  const rows = view?.rows ?? [];
  const row = rows.find((r) => r.key === key);
  if (!row) return { row: null, lifted: [], under: null };
  const named = (r) => ({ key: r.key, label: r.rank ?? r.label });
  const parent = rows.find((r) => r.key === row.parentKey);
  return { row: named(row), lifted: rows.filter((r) => r.parentKey === key).map(named), under: parent ? named(parent) : null };
}

/**
 * Does a Remove ask first? Only where rows move (the rows directly beneath the removed one) and
 * the Judge's setting is on; a row with none beneath it goes at once.
 * @param {{key: string}[]} lifted the rows the Remove moves up
 * @param {boolean} setting the client setting
 */
export const asksBeforeRemoving = (lifted, setting) => !!setting && (lifted?.length ?? 0) > 0;

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
 * @param {boolean} [hostLeads] the host holds the chart's chief, so a top card's leader is a sub chief
 * @returns {"file"|"champion"|"sub"|"chief"|""}
 */
export function roleOf(node, hostLeads = false) {
  if (node?.empty) return "";
  if (!node?.officer) return "file";
  return leaderRoleOf(node, hostLeads);
}

/**
 * The rank a card's leader would hold, from the unit alone and whether or not a leader stands:
 * `roleOf`'s reading with the officer taken as given. It names the leader a line with none, or a
 * deleted one, would make.
 * @param {{parentKey?: string, gen?: {tier?: number}, children?: object[]}} node a view row
 * @param {boolean} [hostLeads] the host itself holds the chart's chief (the faction's leader), so a card with no parent row is a sub chief
 * @returns {"champion"|"sub"|"chief"}
 */
export function leaderRoleOf(node, hostLeads = false) {
  const tierOf = (n) => Math.max(-1, ...(n.children ?? []).map(tierOf)) + 1;
  const tier = Number.isInteger(node?.gen?.tier) ? node.gen.tier : tierOf(node);
  if (tier <= 0) return "champion";
  return node.parentKey || hostLeads ? "sub" : "chief";
}

/**
 * Where a card's officer link stands: `empty` where the group names none, `live` where the
 * named actor resolves, `deleted` where it names one that no longer does. The caller reads
 * `resolves` after the pack that would hold the actor has built its index, so an officer in a
 * compendium is never read as deleted before its index exists.
 * @param {{officerUuid?: string, resolves?: boolean}} args
 * @returns {"empty"|"live"|"deleted"}
 */
export function officerStateOf({ officerUuid = "", resolves = false } = {}) {
  if (!officerUuid) return "empty";
  return resolves ? "live" : "deleted";
}

/**
 * Does a window's chart or leader line name an actor? True where the faction's leader is it, or
 * a row's group or that group's officer is. The `deleteActor` relay redraws exactly these windows.
 * @param {{leaderUuid?: string, rows?: {holderUuid?: string, officerUuid?: string}[]}} facts what the window draws
 * @param {string} uuid the actor
 * @returns {boolean}
 */
export function windowNames({ leaderUuid = "", rows = [] } = {}, uuid) {
  if (!uuid) return false;
  return leaderUuid === uuid || rows.some((r) => r.holderUuid === uuid || r.officerUuid === uuid);
}

/**
 * Whether a seat may delete an actor from a chart: Foundry's own delete test, and never an
 * entry of a compendium, which is the library's copy and not the chart's to remove.
 * @param {Actor|null} doc
 * @param {User} user
 */
export const mayDeleteActor = (doc, user) => !!doc && !doc.pack && !!doc.canUserModify?.(user, "delete");

/**
 * Which controls an officer line offers, each by the test Foundry itself makes and none by who
 * the seat is. A control that fails its test is absent, not disabled.
 * @param {object} args
 * @param {"empty"|"live"|"deleted"} args.state
 * @param {boolean} args.owns the seat owns the host and the card's group, which every write of the line reaches
 * @param {boolean} [args.canOpen] the seat may see the actor's sheet
 * @param {boolean} [args.canDelete] the seat may delete the actor
 * @param {boolean} [args.canCreate] the seat may create actors
 * @param {boolean} [args.canMake] the generating feature can make this row's leader
 * @param {boolean} [args.part] the card is a part row, which names no leader role, so Make is absent from its line
 * @returns {{open: boolean, clear: boolean, deleteActor: boolean, make: boolean, add: boolean, drop: boolean}} `add` is "+ Officer", offered on a line that cannot offer Make and never beside it; `drop` is whether an actor dropped on the line is taken
 */
export function officerControls({ state, owns = false, canOpen = false, canDelete = false, canCreate = false, canMake = false, part = false } = {}) {
  const makes = !part && !!canMake;
  const writes = state !== "live" && !!owns && !!canCreate;
  return {
    open: state === "live" && !!canOpen,
    clear: state !== "empty" && !!owns,
    deleteActor: state === "live" && !!owns && !!canDelete,
    make: writes && makes,
    add: writes && !makes,
    drop: !!owns,
  };
}

/**
 * Whether a card draws an officer line at all. A unit row always does, with Make or "+ Officer"
 * where its group has no officer; a part row draws one where its group names an officer or where
 * this seat may add one or drop one on it.
 * @param {{state: "empty"|"live"|"deleted", part?: boolean, offered?: boolean}} args `offered` is whether `officerControls` offers this seat `add` or `drop`
 * @returns {boolean}
 */
export const officerLineShown = ({ state, part = false, offered = false }) => !(part && state === "empty") || !!offered;

/**
 * The frame and word of a card's officer line. A part row names no officer role (it is picked from a
 * tier, which a part has none of), so its line shows the actor's name alone in the neutral frame;
 * every other row keeps the role its unit and place give it.
 * @param {{leaderRoleKey?: string}} card a view row
 * @param {{part?: boolean, derived: string}} args `derived` is the role `leaderRoleOf` reads for the card
 * @returns {{frame: string, key: string, bare: boolean}} `key` is "" where the line is bare
 */
export function officerLineRole(card, { part = false, derived } = {}) {
  if (part) return { frame: "file", key: "", bare: true };
  const key = card?.leaderRoleKey || derived;
  return { frame: key, key, bare: false };
}

/**
 * The source creature a press copies: the prototype the row's group's first stack names, or "" where
 * no stack names one (a labelled stack has none). The caller reads the document and keeps it only
 * where it is a creature.
 * @param {{template?: {uuid?: string}}[]} stacks the group's stacks
 * @returns {string}
 */
export const officerSourceOf = (stacks) => (stacks ?? []).map((s) => s?.template?.uuid ?? "").find(Boolean) ?? "";

/**
 * The creation data of the actor a "+ Officer" press makes, named by the row. A copy of the source
 * carries what the source carries and nothing more: no id, folder, ownership or sort, no core
 * flags, and no mark of a minted prototype, so the copy is never taken for a twin of it. With no
 * source the actor is blank, of the type the chart's Make creates.
 * @param {{source?: object|null, label?: string, type?: string}} args `source` is a plain `toObject()` of the creature
 * @returns {object}
 */
export function officerActorData({ source = null, label = "", type = "monster" } = {}) {
  if (!source) return { name: label, type };
  const data = JSON.parse(JSON.stringify(source));
  for (const k of ["_id", "folder", "sort", "ownership", "_stats"]) delete data[k];
  if (data.flags) {
    delete data.flags.core;
    if (data.flags[MODULE_ID]) delete data.flags[MODULE_ID][ORG_PROTOTYPE_FLAG];
  }
  data.name = label;
  data.prototypeToken = { ...(data.prototypeToken ?? {}), name: label };
  return data;
}

/**
 * The officer change a press or a drop writes through `org.editRow`: the actor, with no morale
 * figure (the source carries none) and never the faction's leader.
 * @param {string} uuid the actor
 * @returns {{officer: string, moraleBonus: null}}
 */
export const officerChangeOf = (uuid) => ({ officer: uuid, moraleBonus: null });

/**
 * The actor types a card's officer line takes: the system's own actor types (the creatures a group
 * stacks) and the type the row's Make creates. Every other type, the module's own sub-types
 * included, is ignored, since the line a drop leaves offers "Delete actor…".
 * @param {string[]} systemTypes the system's declared actor types
 * @param {string} [makeType] the type the row's family template creates
 * @returns {string[]}
 */
export const officerCreatureTypes = (systemTypes = [], makeType = "") => [...new Set([...systemTypes, makeType].filter(Boolean))];

/**
 * What an actor dropped on a card's officer line does: `ignore` for anything that is no actor or
 * whose type is not in `creatureTypes`; `refuse` where the seat does not own what the write
 * reaches; `same` where the actor already is the row's officer; else `accept`.
 * @param {{isActor?: boolean, type?: string, creatureTypes?: string[], owns?: boolean, uuid?: string, current?: string}} args `creatureTypes` from `officerCreatureTypes`; `owns` is the seat's ownership of the host and the row's group; `current` the group's officer now
 * @returns {"accept"|"ignore"|"refuse"|"same"}
 */
export function officerDropVerdict({ isActor = false, type = "", creatureTypes = [], owns = false, uuid = "", current = "" } = {}) {
  if (!isActor || !creatureTypes.includes(type)) return "ignore";
  if (!owns) return "refuse";
  return uuid && uuid === current ? "same" : "accept";
}

/**
 * The state of a faction's leader line, in the words `officerControls` takes: "empty" where the
 * field holds no actor (blank, a Clear's result included), "deleted" where it names one the world
 * no longer holds, "live" otherwise.
 * @param {{linked: boolean, gone: boolean}} args `linked` the field holds a uuid; `gone` that uuid is a deleted actor
 * @returns {"empty"|"live"|"deleted"}
 */
export function hostLeaderState({ linked, gone }) {
  if (!linked) return "empty";
  return gone ? "deleted" : "live";
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

/** A die in a count expression: a term with a die size ("2d4"), as against a figure alone. */
const DICE_TERM = /\d*d\d+/i;

/**
 * The die beside a card's Bodies, for one stack: the expression its Roll recorded (`gen.formula`)
 * where that holds dice and the seat owns what the write reaches. A stack nothing recorded, a
 * count that is a figure alone and a seat without ownership get none.
 * @param {{gen?: {formula?: string, cite?: string}, template?: {label?: string}}} stack
 * @param {{owns?: boolean}} [seat] `owns`: the seat owns the host and the row's group, as `org.editRow` needs
 * @returns {{formula: string, cite: string, name: string}|null}
 */
export function countDieOf(stack, { owns = false } = {}) {
  const formula = String(stack?.gen?.formula ?? "").trim();
  if (!owns || !formula || !DICE_TERM.test(formula)) return null;
  return { formula, cite: String(stack?.gen?.cite ?? ""), name: stack?.template?.label ?? "" };
}

/**
 * What the die's last throw gave for a stack, while the count still stands as thrown: the formula,
 * the dice in the order thrown and the total. Null before a throw, and once the count was changed
 * by hand (a count that no longer equals `gen.rolled` is no throw's result).
 * @param {{size?: {initial?: number}, gen?: {formula?: string, thrown?: number[], rolled?: number|null}}} stack
 * @returns {{formula: string, dice: string, total: number}|null} `dice` is the thrown dice joined for a line
 */
export function thrownOf(stack) {
  const dice = (stack?.gen?.thrown ?? []).filter((d) => Number.isInteger(d));
  const formula = String(stack?.gen?.formula ?? "").trim();
  const rolled = stack?.gen?.rolled;
  if (!dice.length || !formula || rolled === null || rolled === undefined || rolled !== (stack?.size?.initial ?? 0)) return null;
  return { formula, dice: dice.join(", "), total: rolled };
}

/**
 * The write the die's press makes for a stack, from the evaluated roll: the total as the count and
 * the dice as thrown. Null where the roll gave no whole total, so nothing is written.
 * @param {string} stackKey
 * @param {{total?: number, dice?: {results?: {result: number, active?: boolean}[]}[]}} roll an evaluated Foundry `Roll`
 * @returns {{stack: string, count: number, thrown: number[]}|null}
 */
export function dieChangeOf(stackKey, roll) {
  const total = Number(roll?.total);
  if (!stackKey || !Number.isFinite(total)) return null;
  const thrown = (roll.dice ?? []).flatMap((d) => (d.results ?? []).filter((r) => r.active !== false).map((r) => r.result)).filter((n) => Number.isInteger(n));
  return { stack: stackKey, count: Math.max(0, Math.floor(total)), thrown };
}

/**
 * The bodies a stack's roster holds, where a throw's total falls below them: the count the write then keeps.
 * Null where the total stands.
 * @param {{roster?: object[]}} stack
 * @param {{count: number}} change `dieChangeOf`'s answer
 * @returns {number|null}
 */
export function dieFloorOf(stack, change) {
  const held = (stack?.roster ?? []).length;
  return change && change.count < held ? held : null;
}

/**
 * The words a chart card names a row by: its label, led by the row's kind word and a dot where the label does not already hold that word.
 * @param {{kind?: string, label?: string}} node
 * @returns {string}
 */
export function rankOf(node) {
  const word = String(node?.kind ?? "");
  return word && !String(node?.label ?? "").toLowerCase().includes(word.toLowerCase()) ? `${word} · ${node.label}` : String(node?.label ?? "");
}

/**
 * The fields of the cards in edit that a hand changed and has not saved, read before a press redraws
 * them: a field is a draft where its value differs from the one it was drawn with. A field the press
 * itself writes is left out, since the press's value is the one to show.
 * @param {{card: string, stack: string, name: string, value: string, saved: string}[]} fields every control of a card's form, `card` the row's key, `stack` the stack's key (blank for the card's own), `name` the `data-org-field`
 * @param {{card: string, stack: string, name: string}} [written] the field the press writes
 * @returns {{card: string, stack: string, name: string, value: string}[]}
 */
export function formDraftsOf(fields, written = null) {
  return (fields ?? [])
    .filter((f) => f.value !== f.saved && !(written && f.card === written.card && f.stack === written.stack && f.name === written.name))
    .map(({ card, stack, name, value }) => ({ card, stack, name, value }));
}

/**
 * Where each draft goes back after the redraw: the index of the redrawn field it was typed in, and
 * its value. A draft whose field is gone (its card left edit, or the stack left the row) is dropped,
 * and so is a choice the redrawn select no longer offers.
 * @param {{card: string, stack: string, name: string, value: string}[]} drafts `formDraftsOf`'s answer
 * @param {{card: string, stack: string, name: string, choices?: string[]|null}[]} fields the redrawn form's controls, in order; `choices` is a select's values
 * @returns {{at: number, value: string}[]}
 */
export function restorableDrafts(drafts, fields) {
  const out = [];
  for (const d of drafts ?? []) {
    const at = (fields ?? []).findIndex((f) => f.card === d.card && f.stack === d.stack && f.name === d.name);
    if (at < 0) continue;
    const choices = fields[at].choices;
    if (choices && !choices.includes(d.value)) continue;
    out.push({ at, value: d.value });
  }
  return out;
}

/**
 * What a Remove left, for the line above the chart: the row that left and the rows that moved up,
 * with the row they now stand beneath (null for the top). Null where no row moved, so a leaf's
 * Remove says nothing.
 * @param {{removed?: {label: string}, under?: {label: string}|null, lifted?: {label: string}[]}} result `org.unlistRow`'s answer
 * @returns {{removed: string, under: string|null, lifted: string[], names: string}|null} `names` is the moved rows' labels joined for the line
 */
export function unlistedView(result) {
  const lifted = (result?.lifted ?? []).map((r) => r.label);
  if (!lifted.length) return null;
  return { removed: result.removed?.label ?? "", under: result.under?.label ?? null, lifted, names: lifted.join(" · ") };
}
