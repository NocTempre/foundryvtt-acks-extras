/* global game, foundry, ui, fromUuid, fromUuidSync */
/**
 * The organisation chart's surface (docs/lib/ORGANISATION.md, "The chart's tab"): the
 * context the two partials draw on a faction's Org chart and Locations tabs and on a
 * root group's sheet, and the actions behind each card and tool. Every press drives
 * the writers lib already has (`org.addRow`, `org.editRow`, `org.deleteRow`,
 * `org.sendOut`, `org.recall`) and, where a family template is known, the Roll the
 * generating feature registered on the module api; nothing here makes a second path
 * to a document. A press is a control, not a gate: the only refusals are a write
 * nothing can make, and each is said in a notification and never thrown.
 *
 * Both sheets spread `ORG_ACTIONS` into their `actions` (each handler finds its host
 * from the markup it was pressed in, so one set serves both), and read
 * `chartContext` / `locationsContext` in `_prepareContext`.
 */
import { MODULE_ID, ORG_LANG_PREFIX } from "./constants.mjs";
import { bodyCount, isGroupActor, worldGroups } from "./group-logic.mjs";
import * as org from "./org.mjs";
import { branchKeys, chartCards, emptyKeys, nextLevelKind, subtreeView, templateOf } from "./org-chart-ui-logic.mjs";
import { isLocation } from "./place.mjs";
import { docOf, makeLoc } from "./util.mjs";

const loc = makeLoc(ORG_LANG_PREFIX);

/** The classes every chart dialog carries: the scroll contract and the group dialogs' own. */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-lib-group-dialog"];

/** The partials the two sheets include; lib loads them at init. */
export const ORG_PARTIALS = Object.freeze(["org-chart", "org-card", "org-locations", "org-nested", "org-edit", "org-roll-panel", "org-send-out"].map((n) => `modules/${MODULE_ID}/templates/lib/${n}.hbs`));

/** The folded branches of each open window, by window: a press redraws the sheet and the fold stays. */
const folds = new WeakMap();
const foldOf = (app) => {
  if (!folds.has(app)) folds.set(app, new Set());
  return folds.get(app);
};

/** The module api of the generating feature, where one is loaded. */
const generator = () => globalThis.acksExtras?.monsters ?? null;

/**
 * The host a sheet draws a chart from and the row it is rooted at: the actor itself where
 * it hosts rows (or is a faction), else the faction whose row names it.
 * @param {Actor} actor
 * @returns {{host: Actor, rootKey: string}}
 */
export function hostFor(actor) {
  if (org.unitsOf(actor).length || !isGroupActor(actor)) return { host: actor, rootKey: "" };
  const found = org.orgHostOf(actor.uuid);
  if (found && !isGroupActor(found.host)) return { host: found.host, rootKey: found.row.key };
  return { host: actor, rootKey: "" };
}

/** The stacks' page references of a holder, joined: where its figures were read from. */
function citesOf(holder) {
  const cites = (holder?.system?.stacks ?? []).map((s) => s.gen?.cite).filter(Boolean);
  return [...new Set(cites)].join(" · ");
}

/**
 * What the Organisation partial draws for a sheet, or null where the sheet has no chart
 * to show (a group with no rows that no faction lists keeps its sheet as it was).
 * @param {Actor} actor the faction or group whose sheet it is
 * @param {object} app the sheet, for its folds
 * @param {{isGM: boolean}} options
 */
export function chartContext(actor, app, { isGM }) {
  const { host, rootKey } = hostFor(actor);
  const rows = org.unitsOf(host);
  const editable = !!host.isOwner;
  const empty = !rows.length;
  if (empty && isGroupActor(actor)) return null;
  let view = org.orgChart(host, { isGM });
  if (rootKey) view = subtreeView(view, rootKey);
  const outAt = {};
  for (const r of view.rows) {
    if (!r.holderUuid) continue;
    const names = org.rostersHolding(r.holderUuid).map((u) => docOf(u)?.name).filter(Boolean);
    if (names.length) outAt[r.holderUuid] = names;
  }
  const monsters = generator();
  const canRoll = (key) => !!monsters?.rollOrganisation && !!templateOf(rows, key).template;
  const cards = chartCards(view.roots, { collapsed: foldOf(app), outAt, canRoll, canEdit: editable });
  const decorate = (cards_) => cards_.map((c) => ({
    ...c,
    cites: citesOf(docOf(c.holderUuid)),
    countTip: loc("card.countTip", { name: c.name, cites: citesOf(docOf(c.holderUuid)) }),
    children: decorate(c.children),
  }));
  const top = templateOf(rows, view.rows[0]?.key ?? "").template;
  const plate = top ? (fromUuidSync(top)?.flags?.[MODULE_ID]?.plate ?? "") : "";
  return {
    hostUuid: host.uuid,
    rootKey,
    editable,
    isGM,
    empty,
    cards: decorate(cards),
    total: view.total,
    emptyCards: view.empty,
    plate,
    tools: {
      roll: editable && !!monsters?.rollOrganisation && emptyKeys(view).some(canRoll),
      warband: editable && !!view.roots.length,
      expand: view.rows.length > 0,
      recipe: editable && typeof monsters?.openRecipeEditor === "function" && !!top,
    },
  };
}

/**
 * What the Locations partial draws: each place with the groups of this host's rows on
 * its roster, the chips beneath each, and the rows whose group stands on no place.
 * @param {Actor} host the faction
 * @param {{isGM: boolean}} options
 */
export function locationsContext(host, { isGM }) {
  const view = org.locations({ isGM });
  const mine = (r) => r.hostUuid === host.uuid;
  const places = view.places
    .map((p) => ({
      uuid: p.uuid,
      name: p.name,
      total: p.total,
      groups: p.groups
        .map((g) => ({ ...g, rows: g.rows.filter(mine), countTip: loc("locations.countTip", { name: g.name, place: p.name, cites: citesOf(docOf(g.uuid)) }) }))
        .filter((g) => g.rows.length),
    }))
    .filter((p) => p.groups.length);
  return { hostUuid: host.uuid, editable: !!host.isOwner, places, unplaced: view.unplaced.filter(mine), isEmpty: !places.length && !view.unplaced.filter(mine).length };
}

/** The groups standing directly inside this group: what "Groups in this group" lists. */
export function nestedGroups(group) {
  if (!isGroupActor(group)) return [];
  return worldGroups()
    .filter((g) => g.system?.unit?.parentGroupUuid === group.uuid)
    .map((g) => ({ uuid: g.uuid, name: g.name ?? "", count: bodyCount(g), countTip: loc("nested.countTip", { name: g.name ?? "", cites: citesOf(g) }) }));
}

/* -------------------------------------------- */
/*  Presses                                      */
/* -------------------------------------------- */

/** The host and row a press was made on, read from the markup. */
async function targetOf(target) {
  const at = target.closest("[data-org-host]");
  const host = at?.dataset.orgHost ? await fromUuid(at.dataset.orgHost).catch(() => null) : null;
  const key = target.closest("[data-key]")?.dataset.key ?? "";
  return { host, key, root: at?.dataset.orgRoot ?? "" };
}

/** Say why nothing was written, in the reason's own words where the lang file has them. */
function refuse(result, scope = "refused") {
  const key = `${ORG_LANG_PREFIX}.${scope}.${result.reason}`;
  ui.notifications.warn(game.i18n.has(key) ? game.i18n.format(key, { name: result.name ?? "" }) : loc("refused.other"));
  return result;
}

const render = (app) => app.render();

/** Roll at random's panel or a card's first Roll: the choices a roll takes, or null where the dialog closed. */
async function askRoll(family, defaults = {}) {
  const axis = (family?.system?.toObject?.().axes ?? family?.system?.axes ?? []).find((a) => a.key === "variant");
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/org-roll-panel.hbs`, {
    family: family?.name ?? "",
    variants: (axis?.options ?? []).map((o) => ({ key: o.key, label: o.label ?? o.key, selected: o.key === defaults.variant })),
    context: ["dungeon", "wilderness"].map((k) => ({ key: k, label: loc(`roll.context.${k}`), selected: k === (defaults.context ?? "wilderness") })),
    state: ["wandering", "lair", "chance"].map((k) => ({ key: k, label: loc(`roll.state.${k}`), selected: k === (defaults.state ?? "wandering") })),
    rules: ["troops", "traits", "gear"].map((k) => ({ key: k, label: loc(`roll.rules.${k}`), checked: defaults.rules?.[k] !== false })),
  });
  const { DialogV2 } = foundry.applications.api;
  return DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title: loc("roll.title") },
    content,
    ok: {
      label: loc("roll.press"),
      callback: (_event, button) => {
        const f = button.form.elements;
        return {
          variant: f.namedItem("variant")?.value ?? "",
          context: f.namedItem("context")?.value ?? "wilderness",
          state: f.namedItem("state")?.value ?? "wandering",
          leaderSource: f.namedItem("leaderSource")?.value ?? "",
          rules: Object.fromEntries(["troops", "traits", "gear"].map((k) => [k, !!f.namedItem(`rules-${k}`)?.checked])),
        };
      },
    },
    rejectClose: false,
  }).then((v) => v || null);
}

/** Roll one empty row with everything beneath it; the answer is the provider's. */
async function rollRow(host, key, options) {
  const { template, variant } = templateOf(org.unitsOf(host), key);
  const run = await generator().rollOrganisation({ host, rowKey: key, template, scope: "below", ...options, variant: options.variant || variant });
  if (!run.ok) refuse(run, "roll.refused");
  return run;
}

/** The family template a host's chart began with, and the choices its first roll recorded. */
function familyOf(host, key) {
  const { template, variant } = templateOf(org.unitsOf(host), key);
  const began = org.unitsOf(host).map((r) => r?.toObject?.() ?? r).find((r) => r.gen?.variant)?.gen ?? {};
  return { family: template ? fromUuidSync(template) : null, defaults: { variant: variant || began.variant, context: began.context, state: began.state, rules: began.rules } };
}

/**
 * A card's Roll: fills that card and the cards beneath it. A chart that has no variant
 * yet asks first, in the panel Roll at random opens.
 */
async function onRoll(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host || !generator()?.rollOrganisation) return;
  const { family, defaults } = familyOf(host, key);
  const options = defaults.variant ? {} : await askRoll(family, defaults);
  if (!defaults.variant && !options) return;
  const run = await rollRow(host, key, options ?? {});
  if (run.ok) ui.notifications.info(loc("roll.done", { rows: run.rows?.length ?? 0 }));
  render(this);
}

/** Roll at random: every empty card, each with everything beneath it, after the panel's choices. */
async function onRollAll(_event, target) {
  const { host, root } = await targetOf(target);
  if (!host || !generator()?.rollOrganisation) return;
  const first = emptyKeys(org.orgChart(host, { isGM: true }))[0] ?? "";
  const { family, defaults } = familyOf(host, first);
  const options = await askRoll(family, defaults);
  if (!options) return;
  let filled = 0;
  for (let guard = 0; guard < 200; guard++) {
    const view = org.orgChart(host, { isGM: true });
    const view_ = root ? subtreeView(view, root) : view;
    const key = emptyKeys(view_).find((k) => templateOf(org.unitsOf(host), k).template);
    if (!key) break;
    const run = await rollRow(host, key, options);
    if (!run.ok) break;
    filled++;
  }
  if (filled) ui.notifications.info(loc("roll.doneAll", { n: filled }));
  render(this);
}

/** Add an empty row under the card pressed, or at the top where the chart has none. */
async function onAdd(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const result = await org.addRow(host, key, { label: loc("card.newRow") });
  if (!result.ok) refuse(result);
  render(this);
}

/** + Warband: an empty row under the top row, taking the unit word the level already uses. */
async function onAddWarband(_event, target) {
  const { host, root } = await targetOf(target);
  if (!host) return;
  const view = org.orgChart(host, { isGM: true });
  const top = root || view.roots[0]?.key || "";
  const result = await org.addRow(host, top, { label: loc("card.newWarband"), kind: nextLevelKind(view) });
  if (!result.ok) refuse(result);
  render(this);
}

/** Open the Edit dialog on a card: label, note, visibility, and each stack's count. An empty card is given its group first. */
async function onEdit(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  let row = org.unitsOf(host).find((r) => r.key === key);
  if (!row) return refuse({ reason: "noRow" });
  if (!row.holderUuid) {
    const made = await org.ensureHolder(host, key);
    if (!made) return refuse({ reason: "failed" });
    row = org.unitsOf(host).find((r) => r.key === key);
  }
  const group = docOf(row.holderUuid);
  const stacks = isGroupActor(group) ? (group.system.stacks ?? []).map((s) => ({ key: s.key, label: s.template?.label ?? "", count: s.size?.current ?? 0 })) : [];
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/org-edit.hbs`, {
    label: row.label, notes: row.notes, hidden: !!row.hidden, isGM: game.user.isGM, stacks, onMap: isGroupActor(group) && (group.system.stacks ?? []).some((s) => (s.roster ?? []).some((m) => m.tokenUuid)),
  });
  const { DialogV2 } = foundry.applications.api;
  const change = await DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title: loc("edit.title") },
    content,
    ok: {
      label: loc("edit.press"),
      callback: (_event_, button) => {
        const f = button.form.elements;
        return {
          fields: { label: f.namedItem("label").value, notes: f.namedItem("notes").value, ...(f.namedItem("hidden") ? { hidden: !!f.namedItem("hidden").checked } : {}) },
          stacks: stacks.map((s) => ({ stack: s.key, count: Number(f.namedItem(`count-${s.key}`)?.value) })).filter((s, i) => Number.isFinite(s.count) && s.count !== stacks[i].count),
        };
      },
    },
    rejectClose: false,
  }).then((v) => v || null);
  if (change) {
    const result = await org.editRow(host, key, change);
    if (!result.ok) refuse(result);
  }
  render(this);
}

/** Send a card's group out to a place the Judge picks from the world's. An empty card's press makes its group. */
async function onSendOut(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const places = [...(game.actors ?? [])].filter((a) => isLocation(a) && Array.isArray(a.system?.roster));
  if (!places.length) return ui.notifications.warn(loc("send.noPlace"));
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/org-send-out.hbs`, { places: places.map((p) => ({ uuid: p.uuid, name: p.name })) });
  const { DialogV2 } = foundry.applications.api;
  const picked = await DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title: loc("send.title") },
    content,
    ok: { label: loc("send.press"), callback: (_event_, button) => button.form.elements.namedItem("place")?.value || null },
    rejectClose: false,
  });
  if (!picked) return;
  const result = await org.sendOut(host, key, picked);
  if (!result.ok) refuse(result);
  render(this);
}

/** Recall a card's group from the place it stands on. */
async function onRecall(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const result = await org.recall(host, key);
  if (!result.ok) refuse(result, "recallRefused");
  render(this);
}

/** Delete a card, the cards beneath it and their groups, after a confirmation that says what goes. */
async function onDelete(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const { DialogV2 } = foundry.applications.api;
  const yes = await DialogV2.confirm({
    classes: DIALOG_CLASSES,
    window: { title: loc("delete.title") },
    content: `<p>${loc("delete.ask")}</p>`,
    rejectClose: false,
    yes: { label: loc("delete.press"), callback: () => true },
    no: { callback: () => false },
  });
  if (!yes) return;
  const result = await org.deleteRow(host, key);
  if (!result.ok) refuse(result);
  else {
    ui.notifications.info(loc("delete.done", { rows: result.rows.length, groups: result.groups.length }));
    if (result.leaders.length) ui.notifications.info(loc("delete.leaders", { names: result.leaders.map((u) => docOf(u)?.name ?? u).join(", ") }));
  }
  render(this);
}

/** Open the sheet of what a card or a chip names. */
async function onOpen(_event, target) {
  const uuid = target.closest("[data-uuid]")?.dataset.uuid;
  const doc = uuid ? await fromUuid(uuid).catch(() => null) : null;
  doc?.sheet?.render(true);
}

/** Open the recipe editor, where the generating feature has one. */
function onRecipe(_event, target) {
  const uuid = target.closest("[data-org-host]")?.dataset.orgHost;
  generator()?.openRecipeEditor?.(uuid);
}

/** Fold or unfold one branch. */
function onToggle(_event, target) {
  const key = target.closest("[data-key]")?.dataset.key;
  const folded = foldOf(this);
  if (key) folded.has(key) ? folded.delete(key) : folded.add(key);
  render(this);
}

/** Expand all: every branch open. */
function onExpandAll() {
  foldOf(this).clear();
  render(this);
}

/** Collapse all: every branch with rows beneath it folded. */
async function onCollapseAll(_event, target) {
  const { host, root } = await targetOf(target);
  if (!host) return;
  const view = org.orgChart(host, { isGM: true });
  for (const k of branchKeys(root ? subtreeView(view, root) : view)) foldOf(this).add(k);
  render(this);
}

/** The presses of the chart and locations partials, for a sheet to spread into its `actions`. */
export const ORG_ACTIONS = Object.freeze({
  orgRoll: onRoll,
  orgRollAll: onRollAll,
  orgAdd: onAdd,
  orgAddWarband: onAddWarband,
  orgEdit: onEdit,
  orgSendOut: onSendOut,
  orgRecall: onRecall,
  orgDelete: onDelete,
  orgOpen: onOpen,
  orgRecipe: onRecipe,
  orgToggle: onToggle,
  orgExpandAll: onExpandAll,
  orgCollapseAll: onCollapseAll,
});
