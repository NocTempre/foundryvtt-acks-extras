/* global game, ui, ChatMessage, Folder */
/**
 * THE ONLY file that reads or writes the acks system's actor schema
 * (acks-domains adapter pattern). Everything degrades gracefully: a missing
 * field returns 0/null rather than throwing, so a system update breaks only
 * this file.
 *
 * Sanctioned writes: coin items (spendGold/grantGold), `system.retainer.*`
 * fields, and roster changes through the system's own addHenchman/delHenchman.
 */
import { MODULE_ID, FLAG_RETAIN_BONUS } from "./constants.mjs";
import { sumEffectModifiers } from "./effects.mjs";
// The generic actor reads (ability mod, class level, HD parse) live once in
// acks-lib — acks-influence read the same schema. `monsterHd`'s union also picks
// up the "1/2"-HD form this module's own parser missed. Henchman-specific reads
// (retainer, henchmenList, gold) stay here.
import { abilityMod, classLevel, monsterHd } from "../lib/actor-read.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";

/* ------------------------------ reads ------------------------------ */

export const getChaMod = (actor) => abilityMod(actor, "cha");

/** Core derives cha.loyalty = cha.mod (actor.mjs:1027) but never uses it. */
export function getChaLoyalty(actor) {
  return Number(actor?.system?.scores?.cha?.loyalty ?? getChaMod(actor));
}

/** Core derives cha.retain = cha.mod + 4 (the ACKS 4+CHA henchman cap). */
export function getRetainBase(actor) {
  const retain = Number(actor?.system?.scores?.cha?.retain);
  return Number.isFinite(retain) && retain !== 0 ? retain : 4 + getChaMod(actor);
}

/** Max henchmen = 4 + CHA + effect bonuses (Leadership etc.) + manual flag. */
export function getRetainMax(actor) {
  const manual = Number(actor?.getFlag?.(MODULE_ID, FLAG_RETAIN_BONUS) ?? 0);
  return getRetainBase(actor) + sumEffectModifiers(actor, "retainBonus") + (Number.isFinite(manual) ? manual : 0);
}

export const getLevel = classLevel;

export function getMorale(actor) {
  return Number(actor?.system?.details?.morale ?? 0);
}

export function getAlignment(actor) {
  return actor?.system?.details?.alignment ?? "";
}

export function getRetainer(actor) {
  const r = actor?.system?.retainer ?? {};
  return {
    enabled: !!r.enabled,
    loyalty: Number(r.loyalty ?? 0),
    wage: Number(r.wage ?? 0) || 0, // core stores wage as a String
    managerid: r.managerid ?? "",
    category: r.category ?? "henchman",
    quantity: Number(r.quantity ?? 1),
  };
}

export function isRetainer(actor) {
  return !!actor?.system?.retainer?.enabled;
}

export function getManager(actor) {
  const id = actor?.system?.retainer?.managerid;
  return id ? game.actors.get(id) : null;
}

/** Actor ids in the employer's core henchmen list. */
export function getHenchmenIds(actor) {
  return Array.isArray(actor?.system?.henchmenList) ? [...actor.system.henchmenList] : [];
}

/**
 * Organize hirelings into a Folder named after their employer in the Actors
 * sidebar: for each employer with henchmen, ensure a folder, move the employer
 * and its henchmen into it, and raise each henchman's ownership to match the
 * employer's so the employing player sees them. Chains nest — a henchman who is
 * itself an employer gets its own sub-folder inside its manager's, and ownership
 * flows down the chain. Circular chains are invalid and not expected; a cheap
 * guard prevents a runaway anyway.
 *
 * GM-only (creates/updates world documents). Idempotent: the per-employer folder
 * is found by its `flags.acks-extras.employerId` and reused, so re-running
 * re-homes moved actors instead of making duplicate folders.
 *
 * @param {Actor[]} [actors] - the pool to organize; default = every actor
 * @returns {Promise<{folders:number, moved:number}>} counts of folders created
 *          and actors moved
 */
export async function organizeHenchmenFolders(actors = null) {
  if (!game.user?.isGM) return { folders: 0, moved: 0 };
  const list = (actors ?? game.actors.contents).filter(Boolean);
  const present = new Set(list.map((a) => a.id));
  const managerIn = (a) => {
    const id = a?.system?.retainer?.managerid;
    return id && present.has(id) ? id : null;
  };
  const byName = (a, b) => String(a?.name ?? "").localeCompare(String(b?.name ?? ""));

  // henchmen grouped under their in-list employer's id
  const henchByManager = new Map();
  for (const a of list) {
    const mid = managerIn(a);
    if (!mid) continue;
    if (!henchByManager.has(mid)) henchByManager.set(mid, []);
    henchByManager.get(mid).push(a);
  }
  for (const arr of henchByManager.values()) arr.sort(byName);

  // Every user who owns the employer at some level should own the henchman at
  // least as much — never lower an existing grant, never touch `default`.
  const raiseOwnership = (member, employer) => {
    const out = { ...(member.ownership ?? {}) };
    let changed = false;
    for (const [uid, lvl] of Object.entries(employer.ownership ?? {})) {
      if (uid === "default") continue;
      if ((out[uid] ?? 0) < lvl) {
        out[uid] = lvl;
        changed = true;
      }
    }
    return changed ? out : null;
  };

  const findOrCreateFolder = async (employer, parentId) => {
    let folder = game.folders.find((f) => f.type === "Actor" && f.getFlag(MODULE_ID, "employerId") === employer.id);
    if (folder) {
      const upd = {};
      if (folder.name !== employer.name) upd.name = employer.name;
      if ((folder.folder?.id ?? null) !== (parentId ?? null)) upd.folder = parentId ?? null;
      if (Object.keys(upd).length) await folder.update(upd);
      return { folder, created: false };
    }
    folder = await Folder.create({
      name: employer.name,
      type: "Actor",
      folder: parentId ?? null,
      flags: { [MODULE_ID]: { employerId: employer.id } },
    });
    return { folder, created: true };
  };

  let folders = 0;
  let moved = 0;
  const seen = new Set();
  const fold = async (employer, parentId, includeEmployer) => {
    if (seen.has(employer.id)) return; // circular-chain guard (not expected)
    seen.add(employer.id);
    const hench = henchByManager.get(employer.id) ?? [];
    const { folder, created } = await findOrCreateFolder(employer, parentId);
    if (created) folders++;
    // The root employer joins its own folder; a chained one already sits in its
    // manager's folder, so only its henchmen move here.
    for (const m of includeEmployer ? [employer, ...hench] : hench) {
      const upd = {};
      if ((m.folder?.id ?? null) !== folder.id) upd.folder = folder.id;
      const own = raiseOwnership(m, employer);
      if (own) upd.ownership = own;
      if (Object.keys(upd).length) {
        await m.update(upd);
        moved++;
      }
    }
    // Chains: a henchman that is itself an employer gets a nested folder.
    for (const h of hench) if (henchByManager.has(h.id)) await fold(h, folder.id, false);
  };

  // Roots = employers with henchmen that are not themselves someone's henchman.
  const roots = list.filter((a) => henchByManager.has(a.id) && !managerIn(a)).sort(byName);
  for (const root of roots) await fold(root, null, true);
  return { folders, moved };
}

/** A monster's HD rating from `system.hp.hd` — acks-lib's union parser. */
export const getMonsterHd = monsterHd;

/**
 * "Level" for wage purposes: class level for characters, HD for monsters
 * (MM 351 — substitute Hit Dice for level). Monster extras win when
 * present (integrations/monsters.mjs passes them through here).
 */
export function getWageLevel(actor) {
  if (actor?.type === ACTOR_TYPE.monster) {
    const extras = game.modules.get("acks-extras")?.api?.monsters?.getExtras?.(actor);
    const hd = Number(extras?.hd?.count);
    return Number.isFinite(hd) && hd > 0 ? hd : getMonsterHd(actor);
  }
  return getLevel(actor);
}

/* ------------------------------ coins ------------------------------ */

/** Total funds in gp (carried + banked; coppervalue × quantity is copper). */
export function getGold(actor) {
  let copper = 0;
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.money) continue;
    const cv = Number(item.system?.coppervalue ?? 0);
    copper += cv * (Number(item.system?.quantity ?? 0) + Number(item.system?.quantitybank ?? 0));
  }
  return copper / 100;
}

/**
 * Spend gp from an actor's coin items, largest denominations first, carried
 * before banked. Returns false (and warns) when funds are insufficient.
 * @param {Actor} actor
 * @param {number} gp
 * @param {string} reason - for the chat receipt
 * @param {object} [opts]
 * @param {boolean} [opts.chat=true] - post a receipt to chat
 */
export async function spendGold(actor, gp, reason, { chat = true } = {}) {
  let need = Math.round(gp * 100);
  if (need <= 0) return true;
  if (getGold(actor) * 100 + 0.5 < need) {
    ui?.notifications?.warn(
      game.i18n.format("ACKS-HENCHMEN.gold.insufficient", { name: actor.name, gp: gp.toFixed(0), reason })
    );
    return false;
  }
  const slots = [];
  for (const item of actor.items) {
    if (item.type !== ITEM_TYPE.money) continue;
    slots.push({ item, field: "quantity", cv: Number(item.system.coppervalue ?? 0), qty: Number(item.system.quantity ?? 0) });
    slots.push({ item, field: "quantitybank", cv: Number(item.system.coppervalue ?? 0), qty: Number(item.system.quantitybank ?? 0) });
  }
  slots.sort((a, b) => b.cv - a.cv || (a.field === "quantity" ? -1 : 1));
  const updates = new Map();
  for (const slot of slots) {
    if (need <= 0) break;
    if (slot.cv <= 0 || slot.qty <= 0) continue;
    const take = Math.min(slot.qty, Math.ceil(need / slot.cv));
    need -= take * slot.cv;
    const u = updates.get(slot.item.id) ?? { _id: slot.item.id };
    u[`system.${slot.field}`] = slot.qty - take;
    updates.set(slot.item.id, u);
  }
  // Over-payment in small coin: credit change back on the smallest spent slot.
  if (need < 0) {
    const smallest = slots.filter((s) => updates.has(s.item.id)).sort((a, b) => a.cv - b.cv)[0];
    if (smallest && smallest.cv > 0) {
      const back = Math.floor(-need / smallest.cv);
      if (back > 0) {
        const u = updates.get(smallest.item.id);
        const key = `system.${smallest.field}`;
        u[key] = (u[key] ?? smallest.qty) + back;
      }
    }
  }
  await actor.updateEmbeddedDocuments("Item", [...updates.values()]);
  if (chat) {
    ChatMessage.create({
      content: game.i18n.format("ACKS-HENCHMEN.gold.spent", { name: actor.name, gp: gp.toFixed(0), reason }),
      speaker: ChatMessage.getSpeaker({ actor }),
      whisper: gmIds(),
    });
  }
  return true;
}

/**
 * Credit gp onto the gp denomination (coppervalue 100), else the largest.
 * Creates a standard gp money item when the actor carries none (freshly
 * hired actors own no coins). `toBank` credits `quantitybank` instead of
 * carried coin — wages land in the bank unless overridden.
 */
export async function grantGold(actor, gp, { toBank = false } = {}) {
  const copper = Math.round(gp * 100);
  if (copper <= 0) return 0;
  const coins = actor.items.filter((i) => i.type === ITEM_TYPE.money);
  let target =
    coins.find((c) => Number(c.system.coppervalue) === 100) ??
    coins.sort((a, b) => Number(b.system.coppervalue) - Number(a.system.coppervalue))[0];
  if (!target) {
    const created = await actor.createEmbeddedDocuments("Item", [
      {
        name: game.i18n.localize("ACKS-HENCHMEN.gold.gpItemName"),
        type: "money",
        img: "icons/svg/coins.svg",
        system: { coppervalue: 100, quantity: 0, quantitybank: 0 },
      },
    ]);
    target = created?.[0];
    if (!target) {
      ui?.notifications?.warn(game.i18n.format("ACKS-HENCHMEN.gold.noCoins", { name: actor.name }));
      return 0;
    }
  }
  const add = Math.floor(copper / Number(target.system.coppervalue));
  const field = toBank ? "quantitybank" : "quantity";
  await target.update({ [`system.${field}`]: Number(target.system[field] ?? 0) + add });
  return (add * Number(target.system.coppervalue)) / 100;
}

/* ------------------------------ writes ------------------------------ */

/** Set retainer fields on a hireling actor (sanctioned core write). */
export async function setRetainer(actor, fields) {
  const update = {};
  for (const [k, v] of Object.entries(fields)) update[`system.retainer.${k}`] = v;
  return actor.update(update);
}

/** Write the effective loyalty score so core's own loyalty button agrees. */
export async function setLoyalty(actor, loyalty) {
  return actor.update({ "system.retainer.loyalty": Math.max(-4, Math.min(4, Math.round(loyalty))) });
}

/** Roster changes go through the system's own methods (character hirelings). */
export async function addHenchman(employer, hirelingId) {
  if (typeof employer?.addHenchman === "function") return employer.addHenchman(hirelingId);
  throw new Error(`${MODULE_ID}: employer.addHenchman missing — incompatible acks version?`);
}

export async function delHenchman(employer, hirelingId) {
  if (typeof employer?.delHenchman === "function") return employer.delHenchman(hirelingId);
  throw new Error(`${MODULE_ID}: employer.delHenchman missing — incompatible acks version?`);
}

/* ------------------------------ misc ------------------------------ */

export { gmIds } from "../lib/util.mjs";

export function firstActiveGm() {
  return game.users.activeGM ?? game.users.find((u) => u.isGM && u.active) ?? null;
}
