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
// Generic actor reads (ability mod, class level, HD parse) live once in the
// lib subsystem — the influence feature reads the same schema. `monsterHd`'s
// union also covers the "1/2"-HD form. Henchman-specific reads (retainer,
// henchmenList, gold) stay here.
import { abilityMod, classLevel, monsterHd } from "../lib/actor-read.mjs";
import { ACTOR_TYPE } from "../lib/vocab.mjs";
// A bare `export … from` re-export creates no local binding — spendGold's
// receipt whisper needs the import itself.
import { gmIds } from "../lib/util.mjs";
import { acksExtras } from "../namespace.mjs";

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
 * sidebar, raising each henchman's ownership to match the employer's. Chains
 * nest — a henchman who is itself an employer gets its own sub-folder inside
 * its manager's.
 * GM-only. Idempotent: the per-employer folder is found by its
 * `flags.acks-extras.employerId` and reused, so re-running re-homes moved
 * actors instead of making duplicates.
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

/**
 * What the actor can pay with, in gp — the lib's one reading of the coin a
 * payment may draw on (`spendableGp`), every store inside `within`.
 */
export const getGold = (actor, { within = null } = {}) => acksExtras.lib.money.spendableGp(actor, { within });

/**
 * Spend gp from an actor's coin. With `to` (an actor or a location) the coins
 * move there through the lib's location-gated transfer; without one the payee
 * is off-stage and the coin leaves the world through the lib's sink. Both
 * plan the spend the same way. Returns false (and warns) when funds are
 * insufficient or the transfer is refused.
 * @param {Actor} actor
 * @param {number} gp
 * @param {string} reason - for the chat receipt and any refusal warning
 * @param {object} [opts]
 * @param {boolean} [opts.chat=true] - post a receipt to chat
 * @param {Actor}  [opts.to]   - the payee (actor or location); coin lands there
 * @param {Actor}  [opts.at]   - the place whose exchange terms govern change
 * @param {boolean} [opts.gate=true] - apply the reach gate
 * @param {"all"|"hand"|Actor|Scene|null} [opts.within] - how far the payment
 *   reaches into coin kept away from the actor (the lib's `transferCoin`)
 * @param {boolean} [opts.judge=false] - the Judge declares the payment (the
 *   lib's `judgeDeclares`): a reach refusal does not stop it
 */
export async function spendGold(actor, gp, reason, { chat = true, to = null, at = null, gate = true, within = null, judge = false } = {}) {
  const money = acksExtras.lib.money;
  if (to) {
    const r = await money.transferCoin({ from: actor, to, at, gp, reason, gate, within, judge });
    if (!r.ok) return false;
  } else {
    // The sink reports a short purse and leaves the telling to its caller.
    const r = await money.sinkCoin(actor, gp, { within });
    if (!r.ok) {
      ui?.notifications?.warn(
        game.i18n.format("ACKS-HENCHMEN.gold.insufficient", { name: actor.name, gp: gp.toFixed(0), reason })
      );
      return false;
    }
  }
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
 * Credit gp to an actor's coin. With `from` (a market's till, an employer) it
 * is a transfer out of that payer's coin; without one it is the Judge's mint,
 * in standard denominations, each landing as the actor's own coin of that rate
 * (the lib's `mintCoin`). Either way it lands where the actor keeps arriving
 * coin, as far as `within` reaches. `judge` is `spendGold`'s.
 * @returns {Promise<number>} the gp credited — 0 when a transfer was refused
 */
export async function grantGold(actor, gp, { from = null, at = null, allowMint = false, gate = true, within = null, judge = false } = {}) {
  if (!(Math.round(gp * 100) > 0)) return 0;
  const money = acksExtras.lib.money;
  if (from) {
    const r = await money.transferCoin({ from, to: actor, gp, at, allowMint, gate, within, judge });
    return r.ok ? gp : 0;
  }
  await money.mintCoin(actor, gp, { within });
  return gp;
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

export { gmIds };

export function firstActiveGm() {
  return game.users.activeGM ?? game.users.find((u) => u.isGM && u.active) ?? null;
}
