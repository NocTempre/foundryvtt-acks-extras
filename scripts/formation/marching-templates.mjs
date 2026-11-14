/* global game, foundry, ui */
import { MODULE_ID } from "./constants.mjs";
import { getFormation, getFrontage, getMemberActor, getPartyToken, missingRoleGear, updateFormation } from "./formation-model.mjs";
import { isMemberDeployed, recallMembers } from "./deployment.mjs";
import { announceChange } from "../lib/util.mjs";

/**
 * Saved marching orders — a standing arrangement a Judge can put the party back
 * into after a fight has scattered it.
 *
 * A saved order records the SHAPE and nothing else: who stands where, what each
 * of them is doing, and how many march abreast (no token snapshots, hit
 * points, lights or clock). See docs/formation/DECISIONS.md, "A saved marching
 * order restores an arrangement, not a roster".
 *
 * `captureOrder` and `reconcile` are pure; `reconcile` is the one to ask what
 * an order *would* do. Everything that stores or applies one persists
 * immediately: `saveTemplate` and `deleteTemplate` rewrite the world setting,
 * `applyTemplate` and `formUp` rewrite the formation. The applying calls take
 * the saved order OBJECT or its id, and the storing call refuses a reversed
 * argument pair by name. See docs/formation/DECISIONS.md, "The marching-order
 * API is guarded at the boundary, not renamed". The calls for macros are those
 * in `publicApi`, reached as `acksExtras.formation.marchingOrders.<name>` under
 * the names save, apply, get, list, delete, formUp and reconcile.
 */

/** World-setting key holding every saved marching order, keyed by id. */
export const SETTING_TEMPLATES = "marchingTemplates";

/* -------------------------------------------- */
/*  The arrangement, as data                    */
/* -------------------------------------------- */

/**
 * The formation's current arrangement, reduced to what can be restored.
 *
 * A cell naming nobody is recorded as a blank, whether a gap or a record whose
 * actor went missing.
 *
 * @returns {{frontage: number, cells: Array<{actorId?: string, blank?: boolean, roles?: string[]}>}}
 */
export function captureOrder(formation) {
  return {
    frontage: getFrontage(formation),
    cells: (formation?.members ?? []).map((member) =>
      member?.blank || !member?.actorId
        ? { blank: true }
        : { actorId: member.actorId, roles: [...(member.roles ?? [])] },
    ),
  };
}

/**
 * Lay the party as it stands now into a saved arrangement.
 *
 * Pure, and returns NEW member records rather than editing the ones passed in.
 *
 *  - a saved cell naming someone no longer in the party is **dropped and the
 *    line closes up**, and counted in `missing`.
 *  - a member the saved order never knew about is **appended**, keeping their
 *    current roles.
 *  - a role whose gear the character no longer holds is **refused**, as
 *    `toggleRole` refuses it, and counted in `skipped`.
 *
 * Blank cells come from the saved order alone; gaps in the current line are
 * not carried over.
 *
 * @param {object[]} members the formation's current member records
 * @param {object[]} cells the saved order's cells
 * @param {object} [opts]
 * @param {(actorId: string, role: string) => boolean} [opts.roleAllowed] may
 *   this character take this role back up? Injected to keep this file pure.
 * @returns {{members: object[], restored: number, missing: string[], skipped:
 *   Array<{actorId: string, role: string}>, added: number}}
 */
export function reconcile(members, cells, { roleAllowed = () => true } = {}) {
  const current = (members ?? []).filter(Boolean);
  const byActor = new Map();
  for (const member of current) {
    if (!member.blank && member.actorId && !byActor.has(member.actorId)) byActor.set(member.actorId, member);
  }

  const out = [];
  const used = new Set();
  const missing = [];
  const skipped = [];

  for (const cell of cells ?? []) {
    if (!cell || cell.blank || !cell.actorId) {
      out.push({ blank: true });
      continue;
    }
    const member = byActor.get(cell.actorId);
    if (!member) {
      missing.push(cell.actorId);
      continue;
    }
    // A character named twice takes one square: the first mention wins.
    if (used.has(cell.actorId)) continue;
    used.add(cell.actorId);

    const roles = [];
    for (const role of cell.roles ?? []) {
      if (roleAllowed(cell.actorId, role)) roles.push(role);
      else skipped.push({ actorId: cell.actorId, role });
    }
    out.push({ ...member, roles });
  }

  // Everyone the saved order did not place, in the order they already stood.
  const appended = current.filter((m) => !m.blank && m.actorId && !used.has(m.actorId));
  out.push(...appended);

  return { members: out, restored: used.size, missing, skipped, added: appended.length };
}

/* -------------------------------------------- */
/*  Argument shapes                             */
/* -------------------------------------------- */

/** What the caller passed, named for an error message ("a formation", "an array"). */
function describeArg(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value !== "object") return `a ${typeof value}`;
  if (Array.isArray(value.members)) return "a formation";
  return "an object carrying no `cells`";
}

/**
 * The saved order an applying call was handed: the order OBJECT, or its id.
 *
 * An id that names nothing throws rather than resolving to null.
 *
 * @param {object|string} order the saved order, or its id
 * @param {string} caller the published name a macro typed, for the error text
 * @returns {object} the saved order
 * @throws {Error} when the id names nothing, or the argument is neither shape
 */
function resolveOrder(order, caller) {
  if (typeof order === "string") {
    const found = getTemplate(order);
    if (found) return found;
    throw new Error(`${MODULE_ID} | ${caller}: no saved marching order has id "${order}"`);
  }
  if (order && Array.isArray(order.cells)) return order;
  throw new Error(
    `${MODULE_ID} | ${caller}: wanted a saved marching order (from marchingOrders.get/list) ` +
      `or its id, got ${describeArg(order)}`,
  );
}

/**
 * Guard the `(formation, …)` argument order on the calls that store one: a
 * reversed pair would otherwise store an order with no cells.
 */
function assertFormation(formation, caller, second) {
  if (Array.isArray(formation?.members)) return;
  // Keyed on the SECOND argument looking like a formation: one rule catches both
  // `marchingOrders.save(name, formation)` and `marchingOrders.apply(order, formation)`.
  if (Array.isArray(second?.members)) {
    throw new Error(`${MODULE_ID} | ${caller}: arguments are reversed — the formation comes first`);
  }
  throw new Error(`${MODULE_ID} | ${caller}: wanted a formation as the first argument, got ${describeArg(formation)}`);
}

/* -------------------------------------------- */
/*  Storage                                     */
/* -------------------------------------------- */

/** Every saved order, as stored. Read-only — mutate a `deepClone` instead. */
export function readTemplates() {
  return game.settings.get(MODULE_ID, SETTING_TEMPLATES) ?? {};
}

/** Every saved order, by name, as a list a picker can render. */
export function listTemplates() {
  return Object.values(readTemplates()).sort((a, b) => String(a?.name).localeCompare(String(b?.name)));
}

/** One saved order by id, or null. */
export function getTemplate(id) {
  return readTemplates()[id] ?? null;
}

/**
 * Save the formation's current arrangement under `name`.
 *
 * Re-saving under a name already in use OVERWRITES it.
 *
 * WRITES the world setting. `formation` first, `name` second.
 *
 * @returns {Promise<{template: object, replaced: boolean}|null>} null when the
 *   name was blank.
 */
export async function saveTemplate(formation, name) {
  assertFormation(formation, "marchingOrders.save", name);
  const label = String(name ?? "").trim();
  if (!label) return null;
  const all = foundry.utils.deepClone(readTemplates());
  const existing = Object.values(all).find((t) => t?.name === label);
  const template = {
    id: existing?.id ?? foundry.utils.randomID(),
    name: label,
    ...captureOrder(formation),
  };
  all[template.id] = template;
  await game.settings.set(MODULE_ID, SETTING_TEMPLATES, all);
  return { template, replaced: !!existing };
}

/**
 * Forget a saved order, by id or by the order itself. WRITES the world setting.
 *
 * @returns {Promise<boolean>} false when no saved order had that id
 */
export async function deleteTemplate(order) {
  const id = typeof order === "string" ? order : order?.id;
  const all = foundry.utils.deepClone(readTemplates());
  if (!id || !(id in all)) return false;
  delete all[id];
  await game.settings.set(MODULE_ID, SETTING_TEMPLATES, all);
  return true;
}

/* -------------------------------------------- */
/*  Applying one                                */
/* -------------------------------------------- */

/** Does this character still hold what the role needs? The `toggleRole` rule. */
function roleIsAvailable(actorId, role) {
  return missingRoleGear(game.actors.get(actorId), role).length === 0;
}

/**
 * Put the formation into a saved arrangement: order, roles and frontage.
 *
 * Role changes are announced one by one as `toggleRole` announces them: the
 * equipment feature recomputes a loadout off that hook.
 *
 * WRITES the formation — not a dry run. Ask `reconcile` what an order would do.
 *
 * @param {object} formation the formation to rearrange
 * @param {object|string} template the saved order, or its id
 * @returns {Promise<object>} the `reconcile` report
 */
export async function applyTemplate(formation, template) {
  assertFormation(formation, "marchingOrders.apply", template);
  const order = resolveOrder(template, "marchingOrders.apply");
  const before = new Map(
    formation.members.filter((m) => m?.actorId).map((m) => [m.actorId, new Set(m.roles ?? [])]),
  );
  const result = reconcile(formation.members, order.cells ?? [], { roleAllowed: roleIsAvailable });

  formation.members = result.members;
  const frontage = Math.floor(Number(order.frontage));
  if (Number.isFinite(frontage) && frontage >= 1) formation.frontage = frontage;
  await updateFormation(formation);

  for (const member of formation.members) {
    if (!member?.actorId) continue;
    const was = before.get(member.actorId) ?? new Set();
    const now = new Set(member.roles ?? []);
    for (const role of new Set([...was, ...now])) {
      if (was.has(role) === now.has(role)) continue;
      announceChange("acksExtras.roleChanged", getMemberActor(member), {
        actorId: member.actorId,
        role,
        held: now.has(role),
      });
    }
  }
  return result;
}

/**
 * Form the party up: gather anyone standing on the map back inside the party
 * token, and put the marching order back the way it was saved.
 *
 * Refused during a combat, as `toggleDetachMember` refuses. A fight no combat
 * still holds a body of is over: it reforms first, and the order is applied to
 * the party that comes back.
 *
 * The clock's last position is re-anchored BEFORE the party token moves to the
 * reform point, so the jump spends no dungeon turns.
 *
 * WRITES the formation and moves tokens. Not a dry run.
 *
 * A nullish `formation` or `template` is a DECLINED request (a dismissed
 * picker) and returns null where a wrong-shaped argument throws.
 *
 * @param {object} formation the formation to form up
 * @param {object|string} template the saved order, or its id
 * @returns {Promise<object|null>} the report, plus how many were gathered in;
 *   null when the request was declined.
 */
export async function formUp(formation, template) {
  if (!formation || !template) return null;
  assertFormation(formation, "marchingOrders.formUp", template);
  template = resolveOrder(template, "marchingOrders.formUp");
  if (formation.combat?.active) {
    // Loaded late, like the turn engine below: the bridge imports this file.
    const { reformIfOver } = await import("./combat-bridge.mjs");
    const reformed = await reformIfOver(formation.id);
    const fresh = reformed ? getFormation(formation.id) : null;
    if (!fresh) {
      ui.notifications.warn(game.i18n.localize("ACKS-FORMATION.marching.notInCombat"));
      return null;
    }
    formation = fresh;
  }

  const result = await applyTemplate(formation, template);

  // Read AFTER the arrangement lands: reconcile hands back fresh records, so
  // the ones carrying the deployed markers are these, not the originals.
  const out = formation.members.filter((m) => isMemberDeployed(m));
  let fallen = [];
  if (out.length) {
    // Loaded late: the turn engine's graph declares classes over core's at
    // import, and this module also loads where core does not.
    const { storedPosition } = await import("./turn-engine.mjs");
    const recall = await recallMembers(formation, { members: out });
    fallen = recall.fallen;
    const partyToken = getPartyToken(formation);
    if (recall.anchor) formation.clock.lastPosition = recall.anchor;
    // At the stored corner: a move this client is still drawing has its
    // prepared corner part way along.
    else if (partyToken) formation.clock.lastPosition = storedPosition(partyToken);
    await updateFormation(formation);
    if (partyToken) await partyToken.update({ hidden: false, ...(recall.anchor ?? {}) });
  }
  return { ...result, recalled: out.length, fallen };
}

/* -------------------------------------------- */
/*  Choosing one                                */
/* -------------------------------------------- */

/**
 * Ask what to call the arrangement being saved, offering the formation's name.
 *
 * @returns {Promise<string|null>} the name, or null if dismissed
 */
export async function promptForOrderName(formation) {
  const suggestion = foundry.utils.escapeHTML(formation?.name ?? "");
  const content = `<div class="form-group">
      <label>${game.i18n.localize("ACKS-FORMATION.marching.nameLabel")}</label>
      <div class="form-fields"><input type="text" name="name" value="${suggestion}" autofocus /></div>
      <p class="hint">${game.i18n.localize("ACKS-FORMATION.marching.nameHint")}</p>
    </div>`;
  return foundry.applications.api.DialogV2.prompt({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: game.i18n.localize("ACKS-FORMATION.marching.save"), icon: "fa-solid fa-floppy-disk" },
    content,
    ok: {
      label: game.i18n.localize("ACKS-FORMATION.marching.save"),
      callback: (_event, button) => button.form.elements.name?.value ?? "",
    },
    rejectClose: false,
  }).catch(() => null);
}

/**
 * Choose one of the saved orders, and whether to march into it or forget it.
 *
 * @returns {Promise<{template: object, action: "apply"|"delete"}|null>}
 */
export async function pickMarchingOrder() {
  const saved = listTemplates();
  if (!saved.length) {
    ui.notifications.info(game.i18n.localize("ACKS-FORMATION.marching.none"));
    return null;
  }
  const options = saved
    .map((t) => {
      const named = (t.cells ?? []).filter((c) => c?.actorId).length;
      const label = game.i18n.format("ACKS-FORMATION.marching.option", {
        name: t.name,
        count: named,
        frontage: t.frontage ?? 1,
      });
      return `<option value="${t.id}">${foundry.utils.escapeHTML(label)}</option>`;
    })
    .join("");
  const content = `<div class="form-group">
      <label>${game.i18n.localize("ACKS-FORMATION.marching.pick")}</label>
      <div class="form-fields"><select name="id">${options}</select></div>
      <p class="hint">${game.i18n.localize("ACKS-FORMATION.marching.pickHint")}</p>
    </div>`;

  const chosen = await foundry.applications.api.DialogV2.wait({
    classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
    window: { title: game.i18n.localize("ACKS-FORMATION.marching.load"), icon: "fa-solid fa-people-line" },
    content,
    buttons: [
      {
        action: "apply",
        default: true,
        icon: "fa-solid fa-people-line",
        label: game.i18n.localize("ACKS-FORMATION.marching.formUp"),
        callback: (_event, button) => ({ id: button.form.elements.id?.value, action: "apply" }),
      },
      {
        action: "delete",
        icon: "fa-solid fa-trash",
        label: game.i18n.localize("ACKS-FORMATION.marching.delete"),
        callback: (_event, button) => ({ id: button.form.elements.id?.value, action: "delete" }),
      },
    ],
    rejectClose: false,
  }).catch(() => null);

  const template = chosen?.id ? getTemplate(chosen.id) : null;
  return template ? { template, action: chosen.action } : null;
}

/**
 * A one-line account of what applying an order did, for the Judge: the restored
 * count, then each of recalled, appended, absent and gear-refused that applies.
 */
export function describeResult(result) {
  const parts = [game.i18n.format("ACKS-FORMATION.marching.restored", { count: result.restored })];
  if (result.recalled) {
    parts.push(game.i18n.format("ACKS-FORMATION.marching.recalled", { count: result.recalled }));
  }
  if (result.added) parts.push(game.i18n.format("ACKS-FORMATION.marching.appended", { count: result.added }));
  if (result.missing?.length) {
    parts.push(game.i18n.format("ACKS-FORMATION.marching.absent", { count: result.missing.length }));
  }
  if (result.skipped?.length) {
    const names = result.skipped
      .map((s) => game.actors.get(s.actorId)?.name)
      .filter(Boolean)
      .join(", ");
    parts.push(game.i18n.format("ACKS-FORMATION.marching.noGear", { names }));
  }
  return parts.join(" ");
}

/** The saved-marching-order calls, published as `acksExtras.formation.marchingOrders` under the names a caller types: save, apply, get, list, delete, formUp, reconcile. */
export const publicApi = { save: saveTemplate, apply: applyTemplate, get: getTemplate, list: listTemplates, delete: deleteTemplate, formUp, reconcile };
