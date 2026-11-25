/**
 * The Foundry-free write plans of a generated organisation (docs/lib/ORGANISATION.md,
 * "The Roll, Add and Edit plans"): the Roll that fills an empty row from a rolled
 * tree of units, the Add of an empty row, and the Edit of a filled one. Pure, over
 * plain rows and a plain tree the generating feature hands in, so it imports
 * under Node and is unit-tested offline (tools/test-org-write.mjs). It names no
 * creature, unit or rank: every word, count and figure arrives in the tree.
 *
 * A plan is `{ok, reason?, ops, ...}` in `org-tree-logic.mjs`'s format, and an
 * executor carries `ops` out in order. Documents the plan makes do not exist yet,
 * so it names them by a **ref**, a string `"new:<id>"`: the executor creates the
 * document each `createGroup`, `prototype` and `makeActor` op names, remembers its
 * uuid under the ref, and substitutes that uuid wherever the ref stands later,
 * including a row's `holderUuid`. The ops of a Roll, in the order they come:
 *
 * - `{op: "prototype", ref, key, spec}`: one creature to mint, once for each
 *   distinct `key` (the tree's `prototypes` are deduped by it), so identical
 *   creatures across the whole roll share one prototype. An executor may find a
 *   world prototype already carrying `key` and answer its uuid for the ref.
 * - `{op: "createGroup", ref, name}` and `{op: "parent", uuid, parentUuid}`: a
 *   group for each filled row, nested as the rows nest.
 * - `{op: "addStack", group, prototype, count, gen, fixedHp?, mount?, carry?,
 *   speakers?}`, or `{op: "addLabelledStack", group, label, count, gen}` for a
 *   creature no entry answered. `prototype` is a ref, or a library uuid.
 * - `{op: "makeActor", ref, spec, role, ...}` and `{op: "setOfficer", group,
 *   officer, moraleBonus}`: a leader is an actor, never a stack; the first of a
 *   unit's leaders is its group's officer, and its morale part goes with it.
 * - `{op: "update", uuid, update}`: the host's rows (`system.units`), and, for a
 *   faction host and its top row, its `system.leaderUuid`.
 * - `{op: "addOccupant", place, actor}`: the roll's top group onto a roster.
 *
 * The tree: `{top, prototypes, gen, treasure, findings}`; a unit node is `{key,
 * word, kind, shareKind?, label, camp, trait, troop, officers, stacks, children}`.
 */
import { blankRow, nodesOf, planAdd, subtreeKeys } from "./org-tree-logic.mjs";

const REFUSED = (reason) => ({ ok: false, reason, ops: [] });

/**
 * The module flag key a minted prototype carries, holding its prototype key. It is
 * how a later Roll finds the actor again instead of making a second one, and the
 * only mark that lets Delete remove an actor: a library entry or an actor a hand
 * made carries none.
 */
export const ORG_PROTOTYPE_FLAG = "organisationPrototype";

/** Plain copies of a list's rows, safe to edit. */
const copyRows = (rows) => (rows ?? []).map((r) => structuredClone(r?.toObject?.() ?? r));

/**
 * How many levels of units a node holds beneath it, itself not counted: 0 for a unit of
 * bodies, 1 for a unit of those, and on. A camp is no unit. It is the rank a unit stands
 * at, read from the evaluated line, so a row keeps it before the units beneath are rolled.
 */
const tierOf = (node) => Math.max(-1, ...(node.children ?? []).filter((c) => !c.camp).map(tierOf)) + 1;

/**
 * What a roll fixed for a unit, as the unit's row records it: the share it took, the
 * troop and the trait, and its tier. An empty row reads the first three as what an
 * ancestor's roll decided for it; a filled row keeps them to show, and to tell a hand's
 * change from the roll's.
 */
const pickedOf = (node) => ({ ...(node.shareKind ? { shareKind: node.shareKind } : {}), ...(node.troop ? { troop: node.troop } : {}), ...(node.trait ? { trait: node.trait } : {}), ...(node.camp ? {} : { tier: tierOf(node) }), ...leaderRecord(node) });

/**
 * The unit's first officer as its row records it, so a leader made later by hand is the one
 * the roll would have made: the template role it took, the troop it was made under and the
 * morale part that goes with it. Empty for a unit with no officer.
 * @param {{officers?: {role?: string, troop?: string, moraleBonus?: number|null}[]}} node a tree node
 * @returns {{leader?: {role: string, troop: string, moraleBonus?: number}}}
 */
export function leaderRecord(node) {
  const first = node?.officers?.[0];
  if (!first?.role) return {};
  return { leader: { role: first.role, troop: first.troop ?? "", ...(Number.isInteger(first.moraleBonus) ? { moraleBonus: first.moraleBonus } : {}) } };
}

/** The next keys no row holds: `u1`, `u2`, and on, skipping every key in `taken`. */
export function keySource(taken) {
  const used = new Set(taken);
  let n = 0;
  return () => {
    do n += 1;
    while (used.has(`u${n}`));
    used.add(`u${n}`);
    return `u${n}`;
  };
}

/**
 * The Roll: fill an empty row from a rolled tree, or start a chart with it. With
 * `scope: "one"` only the row's own unit is filled (its group, bodies, leader
 * and camp) and each unit beneath it becomes an empty row that waits to be
 * rolled; with `"below"` every unit beneath is filled too. A row with a holder is
 * never rolled again. Nothing outside the row and its new descendants is touched.
 *
 * @param {object} args
 * @param {{uuid: string, kind: "faction"|"group"}|null} args.host the chart's host; null makes the top unit's group the host
 * @param {object[]} args.rows the host's rows
 * @param {string} [args.rowKey] the empty row to fill; blank starts a new top row
 * @param {object} args.tree what the generating feature rolled
 * @param {"one"|"below"} [args.scope]
 * @param {Object<string, string>} [args.labels] words for rows and groups, by unit word; `camp` for the camp. The caller localises
 * @param {string} [args.placeUuid] a place whose roster the top group is put on
 * @param {string} [args.topHolder] an existing group that is the top unit's group: no group is made for the top, and the stacks, leader and officer go on this one. The host group itself, for a root group whose empty top row waits to be rolled; ignored for a row below the top
 * @param {() => string} [args.newKey] row keys, one per call
 * @returns {{ok: boolean, reason?: "noTree"|"noRow"|"filled", ops: object[], rows?: object[], groups?: Object<string, string>, treasure?: object, findings?: object[]}}
 */
export function planRoll({ host, rows, rowKey = "", tree, scope = "one", labels = {}, placeUuid = "", topHolder = "", newKey = null } = {}) {
  if (!tree?.top) return REFUSED("noTree");
  const list = copyRows(rows);
  const target = rowKey ? list.find((r) => r.key === rowKey) : null;
  if (rowKey && !target) return REFUSED("noRow");
  if (target?.holderUuid) return REFUSED("filled");
  const fresh = newKey ?? keySource(list.map((r) => r.key));

  const ops = [];
  const protoRef = new Map();
  let serial = 0;
  const ref = (kind) => `new:${kind}${++serial}`;
  const refOfProto = (key) => {
    const spec = tree.prototypes?.[key];
    if (!spec) return null;
    if (spec.kind === "entry") return spec.uuid || null;
    if (!protoRef.has(key)) {
      protoRef.set(key, ref("p"));
      ops.push({ op: "prototype", ref: protoRef.get(key), key, spec: { ...spec } });
    }
    return protoRef.get(key);
  };

  // Which nodes are filled, in top-down order, and which become empty rows.
  const filled = [];
  const empties = [];
  const visit = (node, depth) => {
    filled.push(node);
    for (const child of node.children ?? []) {
      if (scope === "below" || depth > 0 || child.camp) visit(child, depth + 1);
      else empties.push(child);
    }
  };
  visit(tree.top, 0);

  const groupOf = new Map();
  const rowKeyOf = new Map();
  const parentRowKey = target ? target.parentKey : "";
  const parentRow = parentRowKey ? list.find((r) => r.key === parentRowKey) : null;
  for (const node of filled) rowKeyOf.set(node, node === tree.top ? (target?.key ?? fresh()) : fresh());
  for (const node of empties) rowKeyOf.set(node, fresh());

  const wordOf = (node) => (node.camp ? "camp" : node.word);
  const nameOf = (node) => labels[wordOf(node)] || node.label || node.word || "";

  // The top unit's group is the host's own where the caller names it: the one write the top row's holder is, and no group of its own to nest or leave behind.
  const reusesTop = !!topHolder && !parentRowKey;
  for (const node of filled) {
    if (reusesTop && node === tree.top) {
      groupOf.set(node, topHolder);
      continue;
    }
    const g = ref("g");
    groupOf.set(node, g);
    ops.push({ op: "createGroup", ref: g, name: nameOf(node) });
  }
  for (const node of filled) {
    const parent = node === tree.top ? null : filled.find((n) => (n.children ?? []).includes(node));
    if (parent) ops.push({ op: "parent", uuid: groupOf.get(node), parentUuid: groupOf.get(parent) });
    else if (node === tree.top && parentRow?.holderUuid) ops.push({ op: "parent", uuid: groupOf.get(node), parentUuid: parentRow.holderUuid });
  }

  const actorOf = new Map();
  for (const node of filled) {
    const group = groupOf.get(node);
    for (const s of node.stacks ?? []) {
      const spec = tree.prototypes?.[s.proto];
      if (spec?.kind === "label") ops.push({ op: "addLabelledStack", group, label: s.label || spec.label, count: s.count, gen: { ...s.gen, rolled: s.count } });
      else {
        const stack = { op: "addStack", group, prototype: refOfProto(s.proto), count: s.count, gen: { ...s.gen, rolled: s.count } };
        if (s.fixedHp != null) stack.fixedHp = s.fixedHp;
        if (s.mount) stack.mount = { prototype: refOfProto(s.mount.proto), perBody: s.mount.perBody ?? 1 };
        if (s.carry) stack.carry = { ...s.carry };
        if (s.speakers != null) stack.speakers = s.speakers;
        ops.push(stack);
      }
    }
    (node.officers ?? []).forEach((o, i) => {
      const a = ref("a");
      actorOf.set(o, a);
      const made = { op: "makeActor", ref: a, spec: refOfProto(o.proto), role: o.role, troop: o.troop ?? "", trait: node.trait ?? "", group };
      if (o.gear?.length) made.gear = [...o.gear];
      if (o.mount) made.mount = { prototype: refOfProto(o.mount.proto) };
      if (o.speaksCommon != null) made.speaksCommon = o.speaksCommon;
      ops.push(made);
      if (i === 0) ops.push({ op: "setOfficer", group, officer: a, moraleBonus: o.moraleBonus ?? null });
    });
  }

  // The rows: the target filled (the record rides on it), its descendants new, the empties waiting.
  const out = list.filter((r) => r.key !== target?.key);
  const insertAt = target ? list.findIndex((r) => r.key === target.key) : out.length;
  const written = [];
  for (const node of filled) {
    const key = rowKeyOf.get(node);
    const parent = node === tree.top ? null : filled.find((n) => (n.children ?? []).includes(node));
    const row = node === tree.top && target ? { ...target } : blankRow(key);
    row.key = key;
    row.parentKey = parent ? rowKeyOf.get(parent) : parentRowKey;
    row.label = node === tree.top && target?.label ? target.label : nameOf(node);
    row.kind = node.camp ? "" : (node.kind ?? node.word ?? "");
    row.holderUuid = groupOf.get(node);
    row.gen = node === tree.top ? { ...tree.gen, tier: tierOf(node), ...leaderRecord(node) } : { ...(row.gen ?? {}), ...pickedOf(node) };
    written.push(row);
  }
  for (const node of empties) {
    const parent = filled.find((n) => (n.children ?? []).includes(node));
    const row = blankRow(rowKeyOf.get(node), { parentKey: rowKeyOf.get(parent), label: nameOf(node), kind: node.kind ?? node.word ?? "" });
    row.gen = pickedOf(node);
    written.push(row);
  }
  out.splice(insertAt, 0, ...written);

  const hostUuid = host?.uuid ?? groupOf.get(tree.top);
  ops.push({ op: "update", uuid: hostUuid, update: { "system.units": out } });
  const chief = tree.top.officers?.[0];
  if (host?.kind === "faction" && !parentRowKey && chief) ops.push({ op: "update", uuid: host.uuid, update: { "system.leaderUuid": actorOf.get(chief) } });
  if (placeUuid) ops.push({ op: "addOccupant", place: placeUuid, actor: groupOf.get(tree.top) });

  const groups = {};
  for (const node of filled) groups[rowKeyOf.get(node)] = groupOf.get(node);
  return { ok: true, ops, rows: out, groups, treasure: tree.treasure ?? null, findings: tree.findings ?? [] };
}

/**
 * The Add: an empty row under any row (or at the top), with the next free key. It
 * is `planAdd` with the key chosen and the write named, so a caller needs only the
 * host.
 *
 * @param {object} args
 * @param {{uuid: string}} args.host
 * @param {object[]} args.rows
 * @param {string} [args.parentKey] blank for the top of the chart
 * @param {{label?: string, kind?: string, notes?: string}} [args.fields]
 * @param {() => string} [args.newKey]
 * @returns {{ok: boolean, reason?: "noRow"|"noKey"|"taken", ops: object[], key?: string, rows?: object[]}}
 */
export function planAddUnit({ host, rows, parentKey = "", fields = {}, newKey = null } = {}) {
  const key = (newKey ?? keySource((rows ?? []).map((r) => r?.toObject?.()?.key ?? r?.key)))();
  const plan = planAdd(rows, parentKey, key, fields);
  if (!plan.ok) return REFUSED(plan.reason);
  return { ok: true, ops: [{ op: "update", uuid: host.uuid, update: { "system.units": plan.rows } }], key, rows: plan.rows };
}

/**
 * The Delete of a row: the row and every row beneath it leave the host's list, and
 * their holders are named so the executor can take the groups away. A group nests
 * inside the group its parent row holds, so a row taken out alone would leave its
 * subtree's groups inside a deleted one. The plan writes the host's rows only; the
 * documents it names are the executor's to find and remove.
 *
 * @param {object} args
 * @param {{uuid: string}} args.host
 * @param {object[]} args.rows
 * @param {string} args.key the row to delete
 * @returns {{ok: boolean, reason?: "noRow", ops: object[], keys?: string[], holders?: string[], rows?: object[]}}
 */
export function planDelete({ host, rows, key } = {}) {
  const list = copyRows(rows);
  if (!key || !list.some((r) => r.key === key)) return REFUSED("noRow");
  const gone = new Set(subtreeKeys(key, nodesOf(list)));
  const kept = list.filter((r) => !gone.has(r.key));
  const holders = list.filter((r) => gone.has(r.key) && r.holderUuid).map((r) => r.holderUuid);
  return { ok: true, ops: [{ op: "update", uuid: host.uuid, update: { "system.units": kept } }], keys: [...gone], holders, rows: kept };
}

/**
 * The Unlist: one row leaves the host's chart and nothing is deleted. The rows directly beneath
 * it stay on the chart, lifted to the removed row's parent (or to the top where it had none), and
 * the rows beneath those keep their own parents, so the structure beneath a level is never taken
 * with it. The plan writes the host's rows only; no group, actor or roster is named.
 *
 * @param {object} args
 * @param {object[]} args.rows the host's rows
 * @param {string} args.key the row to remove
 * @returns {{ok: boolean, reason?: "noRow", removed?: {key: string, label: string}, under?: {key: string, label: string}|null, lifted?: {key: string, label: string}[], kept?: object[]}} `under` is the row the lifted rows now stand beneath, null for the top; `kept` is the host's rows after the removal
 */
export function planUnlist({ rows, key } = {}) {
  const list = copyRows(rows);
  const row = list.find((r) => r.key === key);
  if (!key || !row) return { ok: false, reason: "noRow" };
  const parent = list.find((r) => r.key === row.parentKey) ?? null;
  const named = (r) => ({ key: r.key, label: r.label ?? "" });
  const lifted = list.filter((r) => r.parentKey === key);
  const liftedKeys = new Set(lifted.map((r) => r.key));
  // The removed row's own template record passes to each lifted row that has none of its own, so the
  // Roll, the Make and the recipe tool still find the family the lifted rows were rolled from.
  const carried = row.gen?.template ? { template: row.gen.template, ...(row.gen.variant ? { variant: row.gen.variant } : {}) } : null;
  const lift = (r) => ({ ...r, parentKey: parent?.key ?? "", ...(carried && !r.gen?.template ? { gen: { ...(r.gen ?? {}), ...carried } } : {}) });
  const kept = list.filter((r) => r.key !== key).map((r) => (liftedKeys.has(r.key) ? lift(r) : r));
  return { ok: true, removed: named(row), under: parent ? named(parent) : null, lifted: lifted.map(named), kept };
}

/**
 * The Edit: a filled row changed by hand. Its label, note, kind or visibility go
 * to the host's row; a stack's count or prototype, and the officer, go to the
 * unit's group. A change to a stack, or to the officer, while bodies of the unit
 * stand on a map is a warning and no refusal: those bodies keep the figures they
 * went out with until they are recalled. A row no stack or officer change reaches
 * (empty) refuses only what needs a group.
 *
 * @param {object} args
 * @param {{uuid: string, kind?: string, leaderUuid?: string}} args.host `kind` and `leaderUuid` are a faction's, read only to clear its leader with the officer
 * @param {object[]} args.rows
 * @param {string} args.key the row
 * @param {{label?: string, notes?: string, kind?: string, hidden?: boolean, gen?: object}} [args.fields] `gen` is a patch of the row's own record: a blank value removes the key
 * @param {{stack: string, count?: number, prototype?: string}[]} [args.stacks]
 * @param {{officer: string, moraleBonus?: number|null, leaderIfBlank?: boolean}} [args.officer] `leaderIfBlank` also makes the officer a faction host's leader, on a top row and only while the host's leader is blank; a leader already set is never replaced
 * @param {boolean} [args.onMap] a body of the row's group stands on a map
 * @param {string} [args.currentOfficer] the uuid of the row's group's officer now; a blank `officer.officer` clears it, and where it is the faction host's `leaderUuid` the same host write clears that too
 * @returns {{ok: boolean, reason?: "noRow"|"empty", ops: object[], warnings?: string[]}}
 */
export function planEdit({ host, rows, key, fields = {}, stacks = [], officer = null, onMap = false, currentOfficer = "" } = {}) {
  const list = copyRows(rows);
  const row = list.find((r) => r.key === key);
  if (!row) return REFUSED("noRow");
  if (!row.holderUuid && (stacks.length || officer)) return REFUSED("empty");
  const ops = [];
  const changes = {};
  for (const f of ["label", "notes", "kind", "hidden"]) if (f in fields && fields[f] !== row[f]) changes[f] = fields[f];
  if (fields.gen && typeof fields.gen === "object") {
    const next = { ...(row.gen ?? {}) };
    for (const [k, v] of Object.entries(fields.gen)) {
      if (v === "" || v === null || v === undefined) delete next[k];
      else next[k] = v;
    }
    if (JSON.stringify(next) !== JSON.stringify(row.gen ?? {})) changes.gen = next;
  }
  const hostUpdate = {};
  if (Object.keys(changes).length) hostUpdate["system.units"] = list.map((r) => (r.key === key ? { ...r, ...changes } : r));
  if (officer && !officer.officer && currentOfficer && host?.kind === "faction" && host.leaderUuid === currentOfficer) hostUpdate["system.leaderUuid"] = "";
  if (officer?.officer && officer.leaderIfBlank && host?.kind === "faction" && !row.parentKey && !host.leaderUuid) hostUpdate["system.leaderUuid"] = officer.officer;
  if (Object.keys(hostUpdate).length) ops.push({ op: "update", uuid: host.uuid, update: hostUpdate });
  for (const s of stacks) {
    const change = { op: "setStack", group: row.holderUuid, stack: s.stack };
    if (s.count !== undefined) change.count = Math.max(0, Math.floor(Number(s.count)) || 0);
    if (s.prototype !== undefined) change.prototype = s.prototype;
    ops.push(change);
  }
  if (officer) ops.push({ op: "setOfficer", group: row.holderUuid, officer: officer.officer, moraleBonus: officer.moraleBonus ?? null });
  const warnings = onMap && (stacks.length || officer) ? ["onMap"] : [];
  return { ok: true, ops, warnings };
}
