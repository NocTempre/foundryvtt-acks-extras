/* global game, foundry, ui, fromUuid, fromUuidSync, Actor, document */
/**
 * The organisation chart's surface (docs/lib/ORGANISATION.md, "The chart's tab"): the
 * context the two partials draw on a faction's Org chart and Locations tabs and on a
 * root group's sheet, and the actions behind each card and tool. Every press drives
 * the writers lib already has (`org.addRow`, `org.editRow`, `org.unlistRow`,
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
import { renderFollowerCard } from "./follower-card.mjs";
import * as services from "./services.mjs";
import { bodyCount, isGroupActor, worldGroups } from "./group-logic.mjs";
import * as org from "./org.mjs";
import { CONFIRM_REMOVE_SETTING, asksBeforeRemoving, branchKeys, byHandOf, chartCards, emptyKeys, familyOfRows, hostLeaderState, isPartRow, officerCreatureTypes, leaderRoleOf, liftedBy, nextLevelKind, officerActorData, officerChangeOf, officerControls, officerDropVerdict, officerLineRole, officerLineShown, officerSourceOf, officerStateOf, readAfterIndex, removalRows, roleOf, slotPosition, subtreeView, templateOf, unlistedView, withRecall, windowNames } from "./org-chart-ui-logic.mjs";
import { DELETE_LINKED_SETTING, WARN_DELETE_SETTING, deleteOffered, linkedToDelete, makeUndoMemory, undoOffered, undoView, warningModel } from "./org-delete-logic.mjs";
import { isLocation, packIdOf } from "./place.mjs";
import { outputActorType } from "./template-generate.mjs";
import { docOf, escape, makeLoc } from "./util.mjs";

const loc = makeLoc(ORG_LANG_PREFIX);

/** The classes every chart dialog carries: the scroll contract and the group dialogs' own. */
const DIALOG_CLASSES = ["acks-ui", "acks-extras", "acks-extras-scroll", "acks-lib-group-dialog"];

/** The partials the two sheets include; lib loads them at init. */
export const ORG_PARTIALS = Object.freeze(["org-chart", "org-card", "org-officer-line", "org-delete-warning", "org-locations", "org-nested", "org-roll-panel", "org-roll-sections", "org-send-out"].map((n) => `modules/${MODULE_ID}/templates/lib/${n}.hbs`));

/** The folded branches of each open window, by window: a press redraws the sheet and the fold stays. */
const folds = new WeakMap();
const foldOf = (app) => {
  if (!folds.has(app)) folds.set(app, new Set());
  return folds.get(app);
};

/** The cards in edit of each open window, and what its last Remove unlisted: a press redraws the sheet and both stay. */
const edits = new WeakMap();
const editsOf = (app) => {
  if (!edits.has(app)) edits.set(app, new Set());
  return edits.get(app);
};
const unlisteds = new WeakMap();
const unlistedOf = (app) => unlisteds.get(app) ?? null;

/** The one step of Undo each open chart holds: what its last Delete took. Memory only, so a reload loses it. */
const undos = makeUndoMemory();

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

/** The troop choice of a stack's prototype and its options, through the generator's service; null where it has none. */
const troopFor = (stack) => services.get("org-chart")?.troopOf?.(stack) ?? null;

/**
 * A card's role as its head shows it: the frame class, the word that is always written beside the
 * frame, the accessible name of both, and the tooltip saying what the role was read from.
 * @param {object} card a view row
 * @returns {{key: string, word: string, label: string, tip: string}|null} null for an empty card
 */
function roleView(card, { part = false } = {}) {
  // A part row's record names no officer role, so a leader on it wears the rank-and-file frame and
  // the generic word, never a role read from the chart's shape.
  if (part && (card.officer || card.officerGone)) {
    const word = loc("officer.bareTitle");
    return { key: "file", word, label: loc("role.label", { word, name: card.officer?.name ?? card.name ?? "" }), tip: card.officerGone ? loc("officer.deletedTip", { word: word.toLocaleLowerCase() }) : loc("role.officerTip"), gone: !!card.officerGone };
  }
  const key = card.officerGone ? card.leaderRoleKey : (card.roleKey ?? roleOf(card));
  if (!key) return null;
  const word = loc(`role.${key}`);
  return {
    key,
    word,
    label: loc("role.label", { word, name: card.officer?.name ?? card.name ?? "" }),
    tip: card.officerGone ? loc("officer.deletedTip", { word: word.toLocaleLowerCase() }) : loc(`role.${key}Tip`),
    gone: !!card.officerGone,
  };
}

/**
 * What a uuid names now: the document, or the index entry of one in a compendium, read after the
 * pack that holds it has built its index so a compendium actor is never missed before the index is
 * there. Null where nothing answers.
 * @param {string} uuid
 * @returns {Promise<{name?: string}|null>}
 */
async function readActor(uuid) {
  if (!uuid) return null;
  try {
    return (await readAfterIndex(uuid, { pack: game.packs?.get(packIdOf(uuid)), read: fromUuidSync })) ?? null;
  } catch {
    return null;
  }
}

/**
 * Does the actor a uuid names still exist? The read of `readActor`, never `fromUuidSync` alone.
 * @param {string} uuid
 * @returns {Promise<boolean>}
 */
export async function actorExists(uuid) {
  return !!(await readActor(uuid));
}

/**
 * Is this card's group gone: a row that names a holder no document answers for, as against a row
 * never filled, which names none. Read after the pack index, never by `fromUuidSync` alone.
 * @param {{empty?: boolean, holderUuid?: string}} card a view row
 * @returns {Promise<boolean>}
 */
async function groupGoneOf(card) {
  return !!card.empty && !!card.holderUuid && !(await actorExists(card.holderUuid));
}

/** The actor type a row's Make creates, read from its family template where the world holds it, else the generator's default. */
function makeTypeOf(rows, key, hostGen) {
  const uuid = templateOf(rows, key, hostGen).template;
  let family = null;
  try {
    family = uuid ? fromUuidSync(uuid) : null;
  } catch {
    family = null;
  }
  return outputActorType(family?.system);
}

/**
 * A card's officer line: where the link stands and the controls this seat is offered on it, each
 * by Foundry's own test. A write of the line reaches the host and the card's group, so both must
 * be the seat's to own for Make, Clear and Delete actor; Open needs the actor's own limited
 * permission, Delete actor its delete permission, and Make the world's actor-create permission
 * and a leader the generating feature can name from the row.
 * @param {object} card a view row with `officer`, `officerUuid` and `leaderRoleKey`
 * @param {{holder: Actor|null, editable: boolean, rows: object[], hostGen?: object|null}} where the card's group, whether the seat owns the host, the host's rows and the host's own record
 * @returns {Promise<object|null>} the line as the partial draws it; null on a part row whose group names no officer and whose seat may not add one
 */
async function officerLineOf(card, { holder, editable, rows, hostGen = null }) {
  const user = game.user;
  const officerUuid = card.officerUuid ?? "";
  const doc = card.officer ? docOf(card.officer.uuid) : null;
  const found = doc ?? (officerUuid ? await readActor(officerUuid) : null);
  const state = officerStateOf({ officerUuid, resolves: !!found });
  const part = isPartRow(rows, card.key);
  const group = isGroupActor(holder) ? holder : null;
  const controls = officerControls({
    state,
    owns: !!editable && !!group?.isOwner,
    canOpen: !!doc?.testUserPermission?.(user, "LIMITED"),
    canDelete: !!doc?.canUserModify?.(user, "delete"),
    canCreate: !!user?.can?.("ACTOR_CREATE"),
    canMake: !!services.get("org-chart")?.canMakeLeader?.(rows, card.key, hostGen),
    part,
  });
  if (!officerLineShown({ state, part, offered: controls.add || controls.drop })) return null;
  const { frame, key: role, bare } = officerLineRole(card, { part, derived: leaderRoleOf(card) });
  const title = bare ? loc("officer.bareTitle") : loc(`role.${role}`);
  const word = bare ? loc("officer.bareWord") : title.toLocaleLowerCase();
  const name = card.officer?.name ?? found?.name ?? "";
  const labelled = bare ? name : loc("role.label", { word: title, name });
  return {
    state,
    img: state === "live" ? doc?.img || found?.img || "" : "",
    frame,
    uuid: officerUuid,
    gone: state === "deleted",
    none: state === "empty",
    controls,
    drop: !!controls.drop,
    dropTypes: controls.drop ? officerCreatureTypes(Object.keys(game.system?.documentTypes?.Actor ?? {}), makeTypeOf(rows, card.key, hostGen)).join(" ") : "",
    text: state === "live" ? labelled : state === "deleted" ? loc("officer.deleted", { word: title }) : loc("officer.none", { word }),
    nameTip: controls.drop && state === "live" ? loc("officer.nameTip") : "",
    deletedTip: loc("officer.deletedTip", { word }),
    openTip: loc("officer.openTip", { word }),
    makeLabel: loc("officer.make", { word }),
    makeTip: loc("officer.makeTip", { word }),
    addTip: officerSourceOf(group?.system?.stacks) ? loc("officer.addTip") : loc("officer.addBlankTip"),
    clearTip: loc(state === "deleted" ? "officer.clearDeletedTip" : "officer.clearTip", { word }),
    deleteLabel: loc("officer.deleteLabel", { word }),
    deleteTip: loc("officer.deleteTip", { word }),
  };
}

/** One card's leader as the chart draws it: the follower card in a role frame with its badges, or null where the row has none. */
async function leaderHtml(card) {
  const actor = card.officer ? docOf(card.officer.uuid) : null;
  if (!actor) return "";
  const badges = (services.get("org-chart")?.badges?.({ actor, row: card }) ?? []).map((b) => ({ corner: b.corner, label: b.label, tip: b.tip, icon: b.icon, byHand: b.byHand }));
  const html = await renderFollowerCard(actor, { editable: false, controls: false, frame: { role: card.role.key, word: card.role.word, label: card.role.label, tip: card.role.tip, badges } });
  return `<div class="acks-extras-org-card__leader" data-uuid="${escape(actor.uuid)}">${html}</div>`;
}

/**
 * What the Organisation partial draws for a sheet, or null where the sheet has no chart
 * to show (a group with no rows that no faction lists keeps its sheet as it was).
 * @param {Actor} actor the faction or group whose sheet it is
 * @param {object} app the sheet, for its folds, the cards in edit and what a Remove left
 * @param {{isGM: boolean}} options
 */
export async function chartContext(actor, app, { isGM }) {
  const { host, rootKey } = hostFor(actor);
  const rows = org.unitsOf(host);
  const hostGen = org.hostGenOf(host);
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
  const canRoll = (key) => !!monsters?.rollOrganisation && !isPartRow(rows, key) && !!templateOf(rows, key, hostGen).template;
  const cards = chartCards(view.roots, { collapsed: foldOf(app), outAt, canRoll, canEdit: editable, hostLeads: !!hostGen });
  const editing = editsOf(app);
  const decorate = async (list) => Promise.all(list.map(async (c) => {
    const holder = docOf(c.holderUuid);
    const stacks = isGroupActor(holder) ? (holder.system.stacks ?? []) : [];
    const cites = citesOf(holder);
    const hand = byHandOf(stacks);
    const inEdit = editable && editing.has(c.key);
    const officerLine = c.empty ? null : await officerLineOf(c, { holder, editable, rows, hostGen });
    const officerGone = !!officerLine?.gone;
    const groupGone = await groupGoneOf(c);
    const role = roleView({ ...c, officerGone }, { part: isPartRow(rows, c.key) });
    return {
      ...c,
      officerLine,
      officerGone,
      groupGone,
      canRoll: c.canRoll && (!groupGone || !!game.user?.can?.("ACTOR_CREATE")),
      cites,
      countTip: loc("card.countTip", { name: c.name, cites }),
      byHand: !!hand,
      handTip: hand ? loc("card.handTip", { n: hand.now, rolled: hand.rolled, cites }) : "",
      role,
      leader: await leaderHtml({ ...c, role }),
      editing: inEdit,
      edit: inEdit ? await editOf(c, stacks, deleteGate(host, c.key).offered) : null,
      children: await decorate(c.children),
    };
  }));
  const top = templateOf(rows, view.rows[0]?.key ?? "", hostGen).template;
  const plate = top ? ((await readAfterIndex(top, { pack: game.packs?.get(packIdOf(top)), read: fromUuidSync }))?.flags?.[MODULE_ID]?.plate ?? "") : "";
  return {
    hostUuid: host.uuid,
    rootKey,
    editable,
    isGM,
    empty,
    cards: await decorate(cards),
    total: view.total,
    emptyCards: view.empty,
    plate,
    unlisted: unlistedOf(app),
    undo: undoView(undos.peek(app), { canCreate: !!game.user?.can?.("ACTOR_CREATE"), owns: editable }),
    tools: {
      roll: editable && !!monsters?.rollOrganisation && emptyKeys(view).some(canRoll),
      design: editable && !!monsters?.rollOrganisation && emptyKeys(view).some(canRoll) && !!services.get("org-roll"),
      warband: editable && !!view.roots.length,
      expand: view.rows.length > 0,
      recipe: editable && typeof monsters?.openRecipeEditor === "function" && !!top,
    },
  };
}

/** What a card in edit shows: its label, whether its Delete is offered, and each stack's bodies and troop options. */
async function editOf(card, stacks, canDelete) {
  return {
    label: card.label,
    canDelete: !!canDelete,
    stacks: await Promise.all(stacks.map(async (s) => {
      const troop = await troopFor(s);
      return {
        key: s.key,
        name: s.template?.label ?? "",
        count: s.size?.initial ?? 0,
        troop: troop ? { options: troop.options.map((o) => ({ ...o, selected: o.key === troop.current })) } : null,
      };
    })),
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
  const hostRows = org.unitsOf(host);
  const editable = !!host.isOwner;
  const places = view.places
    .map((p) => ({
      uuid: p.uuid,
      name: p.name,
      total: p.total,
      groups: p.groups
        .map((g) => {
          const rows = withRecall(g.rows.filter(mine), hostRows, editable).map((r) => ({ ...r, countTip: loc("locations.countTip", { name: r.label, place: p.name, cites: citesOf(docOf(r.holderUuid)) }) }));
          return { ...g, rows, holds: rows.some((r) => r.inside), countTip: loc("locations.countTip", { name: g.name, place: p.name, cites: citesOf(docOf(g.uuid)) }) };
        })
        .filter((g) => g.rows.length),
    }))
    .filter((p) => p.groups.length);
  return { hostUuid: host.uuid, editable, places, unplaced: view.unplaced.filter(mine), isEmpty: !places.length && !view.unplaced.filter(mine).length };
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

/** The Roll panel's two readings and the slots' options for a set of picks, through the generator's service; null where it has none. */
const describeRoll = (args) => services.get("org-roll")?.describe?.(args) ?? null;

/** What the panel's controls hold now: the variant, place, state, rules and the choices where the page is silent. */
function readPanel(form) {
  const f = form.elements;
  const choices = { branch: {} };
  for (const el of form.querySelectorAll('[name^="choice-"]')) {
    const name = el.name.slice("choice-".length);
    if (name.startsWith("branch:")) choices.branch[name.slice("branch:".length)] = el.value;
    else choices[name] = el.value;
  }
  return {
    variant: f.namedItem("variant")?.value ?? "",
    context: f.namedItem("context")?.value ?? "wilderness",
    state: f.namedItem("state")?.value ?? "wandering",
    leaderSource: f.namedItem("leaderSource")?.value ?? "",
    rules: Object.fromEntries(["troops", "traits", "gear"].map((k) => [k, !!f.namedItem(`rules-${k}`)?.checked])),
    choices,
  };
}

/**
 * The slots' picks: a share and a troop for each unit row the panel offers, blank where the Judge left
 * it to the roll, and the unit word its Roll rolls. A slot the state does not name a unit for is not
 * offered and picks nothing.
 */
function readSlots(form) {
  const picks = {};
  for (const el of form.querySelectorAll("[data-slot]")) {
    if (el.dataset.unsure === "true") continue;
    const key = el.dataset.slot;
    const share = form.elements.namedItem(`share-${key}`);
    const troop = form.elements.namedItem(`troop-${key}`);
    picks[key] = { shareKind: share && !share.hidden ? share.value : "", troop: troop && !troop.hidden ? troop.value : "", kind: el.dataset.kind ?? "" };
  }
  return picks;
}

/**
 * Roll at random's panel, a card's first Roll and Design by selection: the choices a roll takes,
 * or null where the dialog closed. The two readings redraw when anything they depend on changes;
 * the choices where the page is silent start at what the evaluator takes, so a Roll never waits
 * on them. `slots` (Design) lists unit rows whose share and troop the Judge may pick, and `onSlot`
 * carries a slot's die out.
 */
async function askRoll(family, defaults = {}, { slots = [], title = loc("roll.title"), onSlot = null } = {}) {
  const axis = (family?.system?.toObject?.().axes ?? family?.system?.axes ?? []).find((a) => a.key === "variant");
  const variants = (axis?.options ?? []).map((o) => ({ key: o.key, label: o.label ?? o.key, selected: o.key === defaults.variant }));
  const first = defaults.variant || variants[0]?.key || "";
  const rules = Object.fromEntries(["troops", "traits", "gear"].map((k) => [k, defaults.rules?.[k] !== false]));
  const slotArgs = slots.map(({ key, depth, topKind }) => ({ key, depth, topKind }));
  const described = describeRoll({ family, variant: first, context: defaults.context ?? "wilderness", state: defaults.state ?? "wandering", rules, chosen: defaults.choices ?? {}, slots: slotArgs });
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/org-roll-panel.hbs`, {
    family: family?.name ?? "",
    variants,
    context: ["dungeon", "wilderness"].map((k) => ({ key: k, label: loc(`roll.context.${k}`), selected: k === (defaults.context ?? "wilderness") })),
    state: ["wandering", "lair", "chance"].map((k) => ({ key: k, label: loc(`roll.state.${k}`), selected: k === (defaults.state ?? "wandering") })),
    rules: ["troops", "traits", "gear"].map((k) => ({ key: k, label: loc(`roll.rules.${k}`), checked: rules[k] })),
    choices: described?.choices ?? [],
    make: described?.make ?? null,
    slots: slots.map((s) => ({ ...s, rowKind: s.kind, kind: described?.slotUnits?.[s.key]?.word ?? "", unsure: !described?.slotUnits?.[s.key]?.sure && !s.kind })),
    shares: described?.shares ?? [],
    troops: described?.troops ?? [],
  });
  const { DialogV2 } = foundry.applications.api;
  const sectionsTemplate = `modules/${MODULE_ID}/templates/lib/org-roll-sections.hbs`;
  return DialogV2.prompt({
    classes: DIALOG_CLASSES,
    window: { title },
    content,
    render: (_event, dialog) => {
      const root = dialog.element;
      const form = root.querySelector("form");
      if (!form) return;
      let current = described;
      const options = (select, list) => {
        const kept = select.value;
        select.replaceChildren(...[{ key: "", label: loc("design.rolled") }, ...list].map((o) => {
          const option = root.ownerDocument.createElement("option");
          option.value = o.key;
          option.textContent = o.label;
          return option;
        }));
        select.value = list.some((o) => o.key === kept) ? kept : "";
      };
      const syncSlots = () => {
        const special = current?.special ?? "";
        const shares = current?.shares ?? [];
        for (const el of form.querySelectorAll("[data-slot]")) {
          const key = el.dataset.slot;
          const unit = current?.slotUnits?.[key];
          const unsure = !(unit?.sure) && !el.dataset.rowKind;
          el.dataset.unsure = String(unsure);
          el.dataset.kind = unit?.word ?? "";
          for (const control of el.querySelectorAll("select, button")) control.hidden = unsure;
          const note = el.querySelector("[data-org-slot-note]");
          if (note) note.hidden = !unsure;
          const share = form.elements.namedItem(`share-${key}`);
          if (share) {
            options(share, shares);
            if (!unsure) share.hidden = shares.length === 0;
          }
          const troop = form.elements.namedItem(`troop-${key}`);
          if (troop) troop.hidden = unsure || !(special && share?.value === special);
        }
      };
      const redraw = async () => {
        const now = readPanel(form);
        const out = describeRoll({ family, variant: now.variant, context: now.context, state: now.state, rules: now.rules, chosen: now.choices, slots: slotArgs });
        current = out;
        const holder = root.ownerDocument.createElement("div");
        holder.innerHTML = await foundry.applications.handlebars.renderTemplate(sectionsTemplate, { choices: out?.choices ?? [], make: out?.make ?? null });
        const old = form.querySelector("[data-org-sections]");
        if (old && holder.firstElementChild) old.replaceWith(holder.firstElementChild);
        syncSlots();
      };
      form.addEventListener("change", (event) => {
        const name = event.target?.name ?? "";
        if (/^(variant|context|state|rules-|choice-)/.test(name)) redraw();
        else syncSlots();
      });
      for (const die of form.querySelectorAll("[data-org-slot-roll]")) {
        die.addEventListener("click", async () => {
          die.disabled = true;
          const key = die.dataset.orgSlotRoll;
          const ok = await onSlot?.(key, { ...readPanel(form), picks: { [key]: readSlots(form)[key] } });
          if (ok) die.closest("[data-slot]")?.remove();
          else die.disabled = false;
        });
      }
      syncSlots();
    },
    ok: { label: loc("roll.press"), callback: (_event, button) => ({ ...readPanel(button.form), picks: readSlots(button.form) }) },
    rejectClose: false,
  }).then((v) => v || null);
}

/**
 * Roll one empty row with everything beneath it; the answer is the provider's. A row whose group
 * was deleted outside the chart is emptied first, since the Roll refuses a row that names a holder.
 */
async function rollRow(host, key, options) {
  if (isPartRow(org.unitsOf(host), key)) return refuse({ ok: false, reason: "part" }, "roll.refused");
  const named = org.unitsOf(host).find((r) => r.key === key);
  if (named?.holderUuid && !(await actorExists(named.holderUuid))) {
    const cleared = await org.setHolder(host, key, "");
    if (!cleared.ok) return refuse(cleared);
  }
  const { template, variant } = templateOf(org.unitsOf(host), key, org.hostGenOf(host));
  const run = await generator().rollOrganisation({ host, rowKey: key, template, scope: "below", ...options, variant: options.variant || variant });
  if (!run.ok) refuse(run, "roll.refused");
  return run;
}

/** The family template a host's chart began with, loaded whole, and the choices its first roll recorded. */
const familyOf = (host, key) => familyOfRows(org.unitsOf(host), key, fromUuid, org.hostGenOf(host));

/**
 * A card's Roll: fills that card and the cards beneath it. A chart that has no variant
 * yet asks first, in the panel Roll at random opens.
 */
async function onRoll(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host || !generator()?.rollOrganisation) return;
  if (isPartRow(org.unitsOf(host), key)) return void refuse({ reason: "part" }, "roll.refused");
  const { family, defaults } = await familyOf(host, key);
  const options = defaults.variant ? {} : await askRoll(family, defaults);
  if (!defaults.variant && !options) return;
  const run = await rollRow(host, key, options ?? {});
  if (run.ok) ui.notifications.info(loc("roll.done", { rows: run.rows?.length ?? 0 }));
  await showFaction(run);
  if (!run.deleted?.includes(host.uuid)) render(this);
}

/**
 * Open the faction a Roll made or wrote onto, on its Org chart tab: the window the Judge was in
 * held a group the Roll deleted, so this is the one that shows the result.
 * @param {{faction?: string}} run `rollOrganisation`'s answer
 */
async function showFaction(run) {
  const faction = run.faction ? await fromUuid(run.faction).catch(() => null) : null;
  const sheet = faction?.sheet;
  if (!sheet) return;
  if (sheet.tabGroups) sheet.tabGroups.primary = "orgChart";
  sheet.render(true);
}

/** The host a loop of Rolls continues on: the faction a Roll wrote onto where it deleted the host the loop began with. */
async function hostAfter(host, run) {
  return run.deleted?.includes(host.uuid) && run.host ? (await fromUuid(run.host).catch(() => null)) ?? host : host;
}

/** Roll at random: every empty card, each with everything beneath it, after the panel's choices. */
async function onRollAll(_event, target) {
  const start = await targetOf(target);
  let host = start.host;
  const root = start.root;
  if (!host || !generator()?.rollOrganisation) return;
  const first = emptyKeys(org.orgChart(host, { isGM: true }))[0] ?? "";
  const { family, defaults } = await familyOf(host, first);
  const options = await askRoll(family, defaults);
  if (!options) return;
  let filled = 0;
  for (let guard = 0; guard < 200; guard++) {
    const view = org.orgChart(host, { isGM: true });
    const view_ = root ? subtreeView(view, root) : view;
    const key = emptyKeys(view_).find((k) => !isPartRow(org.unitsOf(host), k) && templateOf(org.unitsOf(host), k, org.hostGenOf(host)).template);
    if (!key) break;
    const run = await rollRow(host, key, options);
    if (!run.ok) break;
    filled++;
    await showFaction(run);
    host = await hostAfter(host, run);
  }
  if (filled) ui.notifications.info(loc("roll.doneAll", { n: filled }));
  if (host.uuid === start.host.uuid) render(this);
}

/**
 * Write a slot's picks to its row's own record: the share and troop a Roll of that row reads as what
 * its ancestors fixed. Blank clears the key. Same writer as every hand edit, so a filled row refuses.
 */
async function writeSlot(host, key, pick) {
  const gen = { shareKind: pick?.shareKind ?? "", troop: pick?.troop ?? "" };
  const blank = !org.unitsOf(host).find((r) => r.key === key)?.kind;
  return org.editRow(host, key, { fields: { gen, ...(blank && pick?.kind ? { kind: pick.kind } : {}) } });
}

/**
 * Design by selection: the same panel as Roll at random with each empty unit row's share and troop as
 * slots, written to the row's record before a Roll reads it. A slot's die rolls that one row; the
 * button rolls every row still blank. Same Roll, no second path.
 */
async function onDesign(_event, target) {
  const start = await targetOf(target);
  let host = start.host;
  const root = start.root;
  if (!host || !generator()?.rollOrganisation) return;
  const view = org.orgChart(host, { isGM: true });
  const scope = root ? subtreeView(view, root) : view;
  const rows = org.unitsOf(host);
  const slotKeys = emptyKeys(scope).filter((k) => !isPartRow(rows, k) && templateOf(rows, k, org.hostGenOf(host)).template && rows.find((r) => r.key === k)?.parentKey);
  const { family, defaults } = await familyOf(host, emptyKeys(scope)[0] ?? slotKeys[0] ?? "");
  const slots = slotKeys.map((k) => ({ key: k, label: scope.rows.find((r) => r.key === k)?.label ?? k, kind: rows.find((r) => r.key === k)?.kind ?? "", ...slotPosition(rows, k) }));
  const onSlot = async (key, options) => {
    const wrote = await writeSlot(host, key, options.picks[key]);
    if (!wrote.ok) {
      refuse(wrote);
      return false;
    }
    const run = await rollRow(host, key, options);
    return !!run.ok;
  };
  const options = await askRoll(family, defaults, { slots, title: loc("design.title"), onSlot });
  if (!options) return render(this);
  for (const key of slotKeys) {
    if (org.unitsOf(host).find((r) => r.key === key)?.holderUuid) continue;
    if (!options.picks?.[key]) continue;
    const wrote = await writeSlot(host, key, options.picks[key]);
    if (!wrote.ok) refuse(wrote);
  }
  // A slot the panel did not offer (no one unit named for its level) is left empty, as it was listed.
  const left = new Set(slotKeys.filter((k) => !options.picks?.[k]));
  let filled = 0;
  for (let guard = 0; guard < 200; guard++) {
    const now = org.orgChart(host, { isGM: true });
    const key = emptyKeys(root ? subtreeView(now, root) : now).find((k) => !left.has(k) && !isPartRow(org.unitsOf(host), k) && templateOf(org.unitsOf(host), k, org.hostGenOf(host)).template);
    if (!key) break;
    const run = await rollRow(host, key, options);
    if (!run.ok) break;
    filled++;
    await showFaction(run);
    host = await hostAfter(host, run);
  }
  if (filled) ui.notifications.info(loc("roll.doneAll", { n: filled }));
  if (host.uuid === start.host.uuid) render(this);
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
  // Where the host holds the chief, the warbands are the chart's top rows and a new one stands beside them.
  const hostLeads = !!org.hostGenOf(host) && !root;
  const top = hostLeads ? "" : root || view.roots[0]?.key || "";
  const result = await org.addRow(host, top, { label: loc("card.newWarband"), kind: nextLevelKind(view, hostLeads) });
  if (!result.ok) refuse(result);
  render(this);
}

/** The pen: open the card's own form. An empty card is given its group first, so its form has somewhere to write. */
async function onEdit(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const row = org.unitsOf(host).find((r) => r.key === key);
  if (!row) return refuse({ reason: "noRow" });
  if (!row.holderUuid && !(await org.ensureHolder(host, key))) return refuse({ reason: "failed" });
  editsOf(this).add(key);
  render(this);
}

/**
 * Done on a card in edit: its label, each stack's bodies and troop, and its champion, read from
 * the card's own controls and carried out by `org.editRow`. A troop change names the prototype the
 * generator finds or makes as its Roll does; bodies already on a map keep what they went out with.
 */
async function onEditDone(_event, target) {
  const { host, key } = await targetOf(target);
  const card = target.closest("[data-key]");
  if (!host || !card) return;
  const field = (el, name) => el.querySelector(`[data-org-field="${name}"]`);
  const row = org.unitsOf(host).find((r) => r.key === key);
  const group = docOf(row?.holderUuid);
  const had = isGroupActor(group) ? group.system.stacks ?? [] : [];
  const stacks = [];
  for (const el of card.querySelectorAll("[data-org-stack]")) {
    const stack = had.find((s) => s.key === el.dataset.orgStack);
    if (!stack) continue;
    const change = { stack: stack.key };
    const count = Number(field(el, "count")?.value);
    if (Number.isFinite(count) && count !== (stack.size?.initial ?? 0)) change.count = count;
    const troop = field(el, "troop");
    if (troop && troop.value !== troop.dataset.was) {
      const uuid = await services.get("org-chart")?.prototypeFor?.(stack, troop.value);
      if (uuid) change.prototype = uuid;
      else ui.notifications.warn(loc("edit.noTroop"));
    }
    if (change.count !== undefined || change.prototype !== undefined) stacks.push(change);
  }
  const change = { fields: { label: field(card, "label")?.value ?? row?.label ?? "" }, stacks };
  const result = await org.editRow(host, key, change);
  if (!result.ok) return refuse(result);
  editsOf(this).delete(key);
  render(this);
}

/**
 * The control a card in edit offers for its leader: it clears the card's group's officer and writes at
 * once, as every press does. The actor stays in the world, and a faction's own leader is not touched.
 */
async function onClearLeader(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const result = await org.editRow(host, key, { officer: { officer: "", moraleBonus: null } });
  if (!result.ok) refuse(result);
  render(this);
}

/** The row a press names, the group it holds and the actor that group names as officer, as the world has them now. */
function officerTargetOf(host, key) {
  const row = org.unitsOf(host).find((r) => r.key === key);
  const group = docOf(row?.holderUuid);
  const officer = isGroupActor(group) ? docOf(group.system?.unit?.officerUuid) : null;
  return { row, group: isGroupActor(group) ? group : null, officer };
}

/**
 * "+ Make the <officer>": a new leader actor made for the card by the generating feature, from what
 * the row recorded, then set as the card's officer through `org.editRow`. On a faction's top row it
 * also becomes the faction's leader while that field is blank. Every test is made before
 * the actor is: the seat must create actors and own the host and the card's group, and the feature
 * must be able to name the leader. Where the link is refused after the actor was made, the notice
 * names the actor, which stays in the world.
 */
async function onMakeLeader(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const { row, group } = officerTargetOf(host, key);
  const service = services.get("org-chart");
  if (!game.user.can("ACTOR_CREATE")) return refuse({ reason: "noCreate" });
  if (!host.isOwner || !group?.isOwner) return refuse({ reason: "notOwner", name: (group ?? host).name });
  if (!service?.canMakeLeader?.(org.unitsOf(host), key, org.hostGenOf(host))) return refuse({ reason: "noLeader" });
  const uuid = await service.makeLeader(org.unitsOf(host), key, org.hostGenOf(host));
  if (!uuid) return refuse({ reason: "leaderNotMade" });
  const moraleBonus = (row?.toObject?.() ?? row)?.gen?.leader?.moraleBonus ?? null;
  const result = await org.editRow(host, key, { officer: { officer: uuid, moraleBonus, leaderIfBlank: true } });
  if (!result.ok) {
    refuse(result);
    ui.notifications.warn(loc("refused.leaderUnlinked", { name: docOf(uuid)?.name ?? uuid }));
  }
  render(this);
}

/**
 * The actor a "+ Officer" press makes: a copy of the creature the row's group's first stack names,
 * else a blank actor of the type the chart's Make creates (the family template's output type, read
 * from the row's own record, else the generator's default). Named by the row's label. Null where
 * the world refused the create.
 * @param {Actor} host
 * @param {{key: string, label?: string}|undefined} row
 * @param {Actor} group the row's group
 * @returns {Promise<Actor|null>}
 */
async function makeOfficerActor(host, row, group) {
  const sourceUuid = officerSourceOf(group.system?.stacks);
  const found = sourceUuid ? await fromUuid(sourceUuid).catch(() => null) : null;
  const source = found?.documentName === "Actor" && !isGroupActor(found) ? found : null;
  const family = source ? null : await fromUuid(templateOf(org.unitsOf(host), row?.key ?? "", org.hostGenOf(host)).template || "").catch(() => null);
  const data = officerActorData({ source: source?.toObject?.() ?? null, label: row?.label || group.name || "", type: outputActorType(family?.system) });
  try {
    return (await Actor.implementation.create(data)) ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | an officer actor could not be made`, err);
    return null;
  }
}

/**
 * "＋ Officer": one actor made for a row that cannot offer Make, then set as the row's group officer
 * through `org.editRow`, the writer Make and Clear use. Every test is made before the actor is: the
 * seat must create actors and own the host and the row's group. Where the link is refused after
 * the actor was made, the notice names the actor, which stays in the world.
 */
async function onAddOfficer(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const { row, group } = officerTargetOf(host, key);
  if (!game.user.can("ACTOR_CREATE")) return refuse({ reason: "noCreate" });
  if (!host.isOwner || !group?.isOwner) return refuse({ reason: "notOwner", name: (group ?? host).name });
  const actor = await makeOfficerActor(host, row, group);
  if (!actor) return refuse({ reason: "officerNotMade" });
  const result = await org.editRow(host, key, { officer: officerChangeOf(actor.uuid) });
  if (!result.ok) {
    refuse(result);
    ui.notifications.warn(loc("refused.leaderUnlinked", { name: actor.name ?? actor.uuid }));
  }
  render(this);
}

/* -------------------------------------------- */
/*  An actor dropped on an officer line          */
/* -------------------------------------------- */

/** The drag in flight, as the last `dragstart` anywhere in the page carried it: a drag's payload is unreadable until the drop, so a line reads the dragged actor's name from here. */
let dragging = null;
/** The lines already listening, so a redraw that keeps an element binds it once. */
const listening = new WeakSet();
let watching = false;

/** What a drag event carries: Foundry's drag data trimmed to its type and uuid, or null. */
function dragData(event) {
  try {
    const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
    return data?.type ? data : null;
  } catch {
    return null;
  }
}

/** The kinds an officer line ignores: a group, a faction (the one non-group actor that hosts rows) and a place. */
/** The types a line takes, read from the line's markup (`officerLineOf` writes them). */
const typesOfLine = (line) => (line?.dataset?.orgDropTypes ?? "").split(" ").filter(Boolean);

/** What the page can say of a drag before it drops: whether this line takes it and the actor's name; `known: false` where nothing in the world or an index answers for the uuid. */
function dragInfoOf(drag, line) {
  if (!drag) return { known: false };
  if (drag.type !== "Actor") return { known: true, accepts: false };
  let doc = null;
  try {
    doc = drag.uuid ? fromUuidSync(drag.uuid) : null;
  } catch {
    doc = null;
  }
  if (!doc) return { known: false };
  return { known: true, accepts: officerDropVerdict({ isActor: true, type: doc.type, creatureTypes: typesOfLine(line), owns: true }) !== "ignore", name: doc.name ?? "" };
}

/** Put a line back to rest: no outline and no drop line. */
function restLine(line) {
  line.classList.remove("is-drop-target");
  const hint = line.querySelector(".acks-extras-org-officer__drop");
  if (!hint) return;
  hint.hidden = true;
  hint.textContent = "";
}

/** The page-wide watch of drags: the dragged actor is remembered from `dragstart` and forgotten at `dragend`. Added once. */
function watchDrags() {
  if (watching) return;
  watching = true;
  document.addEventListener("dragstart", (event) => { dragging = dragData(event); });
  document.addEventListener("dragend", () => {
    dragging = null;
    for (const line of document.querySelectorAll(".acks-extras-org-officer.is-drop-target")) restLine(line);
  });
}

/** An actor over a line: the outline and the line naming it, where this line takes the drag. Nothing shows for a drag it ignores. */
function onLineOver(event, line) {
  event.preventDefault();
  event.stopPropagation();
  const info = dragInfoOf(dragging ?? dragData(event), line);
  if (info.known && !info.accepts) return restLine(line);
  if (event.dataTransfer) event.dataTransfer.dropEffect = "link";
  line.classList.add("is-drop-target");
  const hint = line.querySelector(".acks-extras-org-officer__drop");
  if (!hint) return;
  hint.textContent = info.name ? loc("officer.dropHint", { name: info.name }) : "";
  hint.hidden = !info.name;
}

/** An actor dropped on a line: it becomes that row's officer and the one there is unlinked, never deleted. */
async function onLineDrop(event, line, app) {
  event.preventDefault();
  event.stopPropagation();
  restLine(line);
  dragging = null;
  const data = dragData(event);
  if (data?.type !== "Actor") return;
  const dropped = await foundry.utils.getDocumentClass("Actor").fromDropData(data).catch(() => null);
  const { host, key } = await targetOf(line);
  if (!host) return;
  const { group } = officerTargetOf(host, key);
  const verdict = officerDropVerdict({
    isActor: !!dropped, type: dropped?.type ?? "", creatureTypes: typesOfLine(line), owns: !!host.isOwner && !!group?.isOwner, uuid: dropped?.uuid ?? "", current: group?.system?.unit?.officerUuid ?? "",
  });
  if (verdict === "refuse") return refuse({ reason: "notOwner", name: (group ?? host).name });
  if (verdict !== "accept") return;
  const result = await org.editRow(host, key, { officer: officerChangeOf(dropped.uuid) });
  if (!result.ok) refuse(result);
  render(app);
}

/**
 * Make every officer line a sheet drew that this seat may write a drop target, by the one handler
 * both chart hosts share. A sheet calls it from its `_onRender`, so the listeners ride the line
 * elements that render made. A drop on any line is the line's alone: it is stopped before the
 * sheet's own drop, which would take the actor as a member, a seat or a stack, and a line this seat
 * may not write takes it and does nothing.
 * @param {object} app the sheet
 * @param {HTMLElement} [root] where the lines are looked for; the sheet's element
 */
export function bindOfficerDrops(app, root = app?.element) {
  watchDrags();
  for (const line of root?.querySelectorAll?.(".acks-extras-org-officer") ?? []) {
    if (listening.has(line)) continue;
    listening.add(line);
    if (!line.hasAttribute("data-org-drop")) {
      line.addEventListener("drop", (event) => { event.preventDefault(); event.stopPropagation(); });
      continue;
    }
    line.addEventListener("dragover", (event) => onLineOver(event, line));
    line.addEventListener("dragleave", (event) => { if (!line.contains(event.relatedTarget)) restLine(line); });
    line.addEventListener("drop", (event) => onLineDrop(event, line, app));
  }
}

/**
 * What a faction's leader line offers: "+ Make the chieftain", where the leader was deleted outside
 * the chart or the field is blank (after a Clear, say), this seat owns the faction and may create
 * actors, and the faction's record (`org.hostGenOf`) names the leader's role and the chart a template.
 * Each is Foundry's own test or the generating feature's, and a control that fails one is absent.
 * @param {Actor} faction the faction whose sheet it is
 * @param {{linked: boolean, gone: boolean}} leader the leader line as the sheet reads it: whether the field holds a uuid, and whether that actor is deleted
 * @returns {{canMake: boolean, makeLabel: string, makeTip: string}}
 */
export function hostLeaderLine(faction, { linked, gone }) {
  const word = loc("role.chief").toLocaleLowerCase();
  const { make: canMake } = officerControls({
    state: hostLeaderState({ linked, gone }), owns: !!faction?.isOwner, canCreate: !!game.user?.can?.("ACTOR_CREATE"),
    canMake: !!services.get("org-chart")?.canMakeLeader?.([], "", org.hostGenOf(faction)),
  });
  return { canMake, makeLabel: loc("officer.make", { word }), makeTip: loc("officer.makeHostTip", { word }) };
}

/**
 * "+ Make the chieftain" on a faction's leader line: a new leader actor made by the generating
 * feature from the record the village's Roll left on the faction, then set as the faction's leader.
 * Every test is made before the actor is. Where the link is refused after the actor was made, the
 * notice names the actor, which stays in the world.
 */
async function onMakeHostLeader() {
  const host = this.actor;
  const service = services.get("org-chart");
  const gen = org.hostGenOf(host);
  if (!game.user.can("ACTOR_CREATE")) return refuse({ reason: "noCreate" });
  if (!host?.isOwner) return refuse({ reason: "notOwner", name: host?.name ?? "" });
  if (!service?.canMakeLeader?.([], "", gen)) return refuse({ reason: "noLeader" });
  const uuid = await service.makeLeader([], "", gen);
  if (!uuid) return refuse({ reason: "leaderNotMade" });
  try {
    await host.update({ "system.leaderUuid": uuid });
  } catch (err) {
    console.warn(`${MODULE_ID} | a leader could not be linked to its faction`, err);
    refuse({ reason: "failed" });
    ui.notifications.warn(loc("refused.leaderUnlinked", { name: docOf(uuid)?.name ?? uuid }));
  }
  render(this);
}

/**
 * "Delete actor…": after a confirm, clear the card's link and then delete the officer's actor, so a
 * refused clear deletes nothing. The seat must be able to delete the actor and own the host and the
 * card's group. Only a delete made outside the chart leaves a link to a missing actor.
 */
async function onDeleteLeaderActor(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  const { row, group, officer } = officerTargetOf(host, key);
  if (!officer) return render(this);
  if (!officer.canUserModify(game.user, "delete")) return refuse({ reason: "noDelete", name: officer.name ?? "" });
  if (!host.isOwner || !group?.isOwner) return refuse({ reason: "notOwner", name: (group ?? host).name });
  const { DialogV2 } = foundry.applications.api;
  const yes = await DialogV2.confirm({
    classes: DIALOG_CLASSES,
    window: { title: loc("officer.deleteTitle", { name: officer.name ?? "" }) },
    content: `<p>${loc("officer.deleteAsk", { name: escape(officer.name ?? ""), card: escape(row?.label ?? "") })}</p>`,
    rejectClose: false,
    yes: { label: loc("officer.deletePress"), callback: () => true },
    no: { callback: () => false },
  });
  if (!yes) return;
  const cleared = await org.editRow(host, key, { officer: { officer: "", moraleBonus: null } });
  if (!cleared.ok) return refuse(cleared);
  await officer.delete();
  render(this);
}

/**
 * Redraw this client's open windows whose chart or leader line names an actor that was deleted.
 * Core fires `deleteActor` on every client, so each client redraws its own windows; it reads the
 * world as it is now and writes nothing, and the link it leaves is cleared by a press of a seat
 * that passes the control's test.
 * @param {Actor} actor the deleted actor
 */
export function redrawWindowsNaming(actor) {
  const uuid = actor?.uuid;
  if (!uuid) return;
  for (const app of foundry.applications.instances.values()) {
    const subject = app.actor ?? app.document;
    if (subject?.documentName !== "Actor" || subject.uuid === uuid) continue;
    const { host } = hostFor(subject);
    const rows = org.unitsOf(host).map((r) => ({ holderUuid: r.holderUuid, officerUuid: docOf(r.holderUuid)?.system?.unit?.officerUuid ?? "" }));
    if (windowNames({ leaderUuid: host.system?.leaderUuid ?? "", rows }, uuid)) Promise.resolve(app.render()).catch((err) => console.warn(`${MODULE_ID} | a window could not redraw after a deleted actor`, err));
  }
}

/** A badge's press: say where the upgrade came from, which a pointer's tooltip says and a keyboard's cannot. */
function onBadge(_event, target) {
  const tip = target.dataset.tooltipText;
  if (tip) ui.notifications.info(tip);
}

/** Remove, from a card in edit or from a card whose group is gone: the row alone leaves the chart, after the confirm where rows move. */
async function onRemove(_event, target) {
  const { host, key } = await targetOf(target);
  if (host) {
    editsOf(this).delete(key);
    await removeRow(this, host, key);
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

/**
 * Remove a card: the row alone leaves the chart and the rows directly beneath it move up to its
 * parent. It asks first, naming the rows that move and where they go, only where rows move and
 * the Judge left the ask on in the module's settings; a row with none beneath it goes at once.
 */
async function removeRow(app, host, key) {
  const { row, lifted, under } = liftedBy(org.orgChart(host, { isGM: true }), key);
  if (row && asksBeforeRemoving(lifted, game.settings.get(MODULE_ID, CONFIRM_REMOVE_SETTING))) {
    const { DialogV2 } = foundry.applications.api;
    const content = loc(under ? "remove.askUnder" : "remove.askTop", {
      name: escape(row.label),
      n: `<span data-tooltip-text="${escape(loc("remove.countTip"))}">${lifted.length}</span>`,
      names: lifted.map((r) => escape(r.label)).join(" · "),
      under: escape(under?.label ?? ""),
    });
    const yes = await DialogV2.confirm({
      classes: DIALOG_CLASSES,
      window: { title: loc("remove.title", { name: row.label }) },
      content: `<p>${content}</p>`,
      rejectClose: false,
      yes: { label: loc("remove.press"), icon: "fa-solid fa-xmark", callback: () => true },
      no: { label: loc("remove.cancel"), callback: () => false },
    });
    if (!yes) return null;
  }
  return removeFromChart(app, host, key);
}

/**
 * The one call a Remove ends in: it takes the row off the chart and deletes no document. The rows
 * that moved up, and the row they now stand beneath, are kept for the sheet to draw above its
 * chart until dismissed.
 */
async function removeFromChart(app, host, key) {
  const result = await org.unlistRow(host, key);
  if (!result.ok) return refuse(result);
  unlisteds.set(app, unlistedView(result));
  return result;
}

/**
 * What a Delete of a row takes and whether this seat may make it: the preview, the first group the
 * seat may not delete (null where it may delete them all), and whether the control is offered. Foundry's
 * own tests only: ownership of the host, and the delete permission on each group.
 * @param {Actor} host
 * @param {string} key
 * @returns {{preview: object, blocked: Actor|null, offered: boolean}}
 */
function deleteGate(host, key) {
  const preview = org.deletePreview(host, key);
  if (!preview.ok) return { preview, blocked: null, offered: false };
  const can = (g) => !!g.canUserModify?.(game.user, "delete");
  return { preview, blocked: preview.groups.find((g) => !can(g)) ?? null, offered: deleteOffered({ owns: !!host.isOwner, groups: preview.groups.map((g) => ({ canDelete: can(g) })), takesHost: preview.groups.some((g) => g === host || g.uuid === host.uuid) }) };
}

/** The actors a Delete's groups name as officer, each with whether this seat may delete it. A compendium entry is never deletable here. */
function linkedOf(uuids) {
  return uuids
    .map((uuid) => docOf(uuid))
    .filter((d) => d?.documentName === "Actor")
    .map((d) => ({ uuid: d.uuid, name: d.name ?? "", canDelete: !d.pack && !!d.canUserModify?.(game.user, "delete") }));
}

/**
 * The warning before a Delete: the rows and groups that go, the one tick for the linked actors, and
 * "Don't warn me again". Null where the seat cancelled or closed it.
 * @param {object} model `warningModel`'s answer
 * @returns {Promise<{linked: boolean, dontWarn: boolean}|null>}
 */
async function askDelete(model) {
  const content = await foundry.applications.handlebars.renderTemplate(`modules/${MODULE_ID}/templates/lib/org-delete-warning.hbs`, { ...model, tickNames: model.tick?.names.join(", ") ?? "" });
  const { DialogV2 } = foundry.applications.api;
  const answer = await DialogV2.wait({
    classes: DIALOG_CLASSES,
    window: { title: loc("delete.title", { name: model.top }) },
    content,
    rejectClose: false,
    render: (_event, dialog) => {
      dialog.element.querySelector('[data-action="delete"]')?.setAttribute("data-tooltip-text", loc("delete.pressTip"));
      dialog.element.querySelector('[data-action="cancel"]')?.setAttribute("data-tooltip-text", loc("delete.cancelTip"));
    },
    buttons: [
      {
        action: "delete",
        label: loc("delete.press"),
        icon: "fa-solid fa-trash",
        class: "acks-extras-org-card__delete",
        callback: (_event, button) => ({ linked: !!button.form.elements.namedItem("linked")?.checked, dontWarn: !!button.form.elements.namedItem("dontWarn")?.checked }),
      },
      { action: "cancel", label: loc("delete.cancel"), default: true, callback: () => false },
    ],
  });
  return answer && typeof answer === "object" ? answer : null;
}

/**
 * Delete a card's row: the row, the rows beneath it, their groups and the prototypes no other group
 * uses, and the linked actors the warning's tick (or, with the warning off, the saved choice) names.
 * The seat's tests are made again here, before anything is written. What it took is copied first and
 * held as the chart's one step of Undo. "Don't warn me again" saves both client settings, together,
 * after the Delete has been made.
 */
async function deleteCard(app, host, key) {
  const first = deleteGate(host, key);
  if (!first.preview.ok) return refuse(first.preview);
  if (!host.isOwner) return refuse({ reason: "notOwner", name: host.name ?? "" });
  if (first.blocked) return refuse({ reason: "noDelete", name: first.blocked.name ?? "" });
  const rows = org.unitsOf(host);
  const going = removalRows(org.orgChart(host, { isGM: true }), key).map((r) => ({ ...r, group: docOf(rows.find((x) => x.key === r.key)?.holderUuid)?.name ?? "" }));
  const linked = linkedOf(first.preview.leaders);
  const saved = !!game.settings.get(MODULE_ID, DELETE_LINKED_SETTING);
  let takes;
  let save = null;
  if (game.settings.get(MODULE_ID, WARN_DELETE_SETTING)) {
    const model = warningModel({ going, prototypes: first.preview.prototypes.length, linked, saved });
    const answer = await askDelete(model);
    if (!answer) return null;
    takes = model.tick && answer.linked ? model.tick.uuids : [];
    if (answer.dontWarn) save = model.tick ? answer.linked : saved;
  } else takes = linkedToDelete({ linked, saved });

  const again = deleteGate(host, key);
  if (!again.preview.ok) return refuse(again.preview);
  if (!host.isOwner) return refuse({ reason: "notOwner", name: host.name ?? "" });
  if (again.blocked) return refuse({ reason: "noDelete", name: again.blocked.name ?? "" });
  if (!again.offered) return refuse({ reason: "noDelete", name: host.name ?? "" });
  takes = takes.filter((uuid) => linkedOf(again.preview.leaders).some((a) => a.uuid === uuid && a.canDelete));
  const snapshot = org.deleteSnapshot(host, again.preview, takes);
  // The step is held before the first write, so a Delete that throws partway still leaves its Undo;
  // a refusal writes nothing and puts back the step it displaced.
  const prior = undos.peek(app);
  undos.hold(app, { ...snapshot, label: going[0]?.label ?? "" });
  let result;
  try {
    result = await org.deleteRow(host, key);
  } catch (err) {
    console.warn(`${MODULE_ID} | a Delete stopped partway; its Undo is kept`, err);
    return null;
  }
  if (!result.ok) {
    if (prior) undos.hold(app, prior);
    else undos.drop(app);
    return refuse(result);
  }
  for (const uuid of takes) {
    try {
      await docOf(uuid)?.delete();
    } catch (err) {
      console.warn(`${MODULE_ID} | a linked actor could not be deleted with its row`, err);
    }
  }
  if (save !== null) {
    await game.settings.set(MODULE_ID, WARN_DELETE_SETTING, false);
    await game.settings.set(MODULE_ID, DELETE_LINKED_SETTING, save);
  }
  return result;
}

/** Redraw a window, where it still stands: a Delete of the row a sheet's own actor holds takes the sheet's document with it. */
async function renderUnlessGone(app) {
  try {
    await app.render();
  } catch (err) {
    console.warn(`${MODULE_ID} | a chart window could not redraw after a Delete`, err);
  }
}

/** Delete in a card's form: the row, with the warning, and Undo afterwards. */
async function onDelete(_event, target) {
  const { host, key } = await targetOf(target);
  if (!host) return;
  editsOf(this).delete(key);
  await deleteCard(this, host, key);
  await renderUnlessGone(this);
}

/** Undo the chart's last Delete from memory: the seat must create actors and own the host. */
async function onUndo() {
  const step = undos.peek(this);
  if (!step) return;
  const host = await fromUuid(step.hostUuid).catch(() => null);
  if (!host) {
    undos.drop(this);
    return render(this);
  }
  if (!game.user.can("ACTOR_CREATE")) return refuse({ reason: "noCreate" });
  if (!undoOffered({ canCreate: true, owns: !!host.isOwner })) return refuse({ reason: "notOwner", name: host.name ?? "" });
  const result = await org.undoDelete(host, step);
  if (!result.ok) return refuse(result);
  undos.drop(this);
  render(this);
}

/** Put away the strip a Delete left above the chart; the Delete stays. */
function onDismissUndo() {
  undos.drop(this);
  render(this);
}

/** Put away the line a Remove left above the chart. */
function onDismissUnlisted() {
  unlisteds.delete(this);
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
  orgDesign: onDesign,
  orgAdd: onAdd,
  orgAddWarband: onAddWarband,
  orgEdit: onEdit,
  orgEditDone: onEditDone,
  orgRemove: onRemove,
  orgDelete: onDelete,
  orgUndo: onUndo,
  orgDismissUndo: onDismissUndo,
  orgDismissUnlisted: onDismissUnlisted,
  orgBadge: onBadge,
  orgClearLeader: onClearLeader,
  orgMakeLeader: onMakeLeader,
  orgAddOfficer: onAddOfficer,
  orgMakeHostLeader: onMakeHostLeader,
  orgDeleteLeaderActor: onDeleteLeaderActor,
  hirelingShow: onOpen,
  orgSendOut: onSendOut,
  orgRecall: onRecall,
  orgOpen: onOpen,
  orgRecipe: onRecipe,
  orgToggle: onToggle,
  orgExpandAll: onExpandAll,
  orgCollapseAll: onCollapseAll,
});
