/* global game, canvas, ui, foundry */
/**
 * The Rolls tab: every throw an item can make, gathered into groups, and the
 * one function that makes one of them.
 *
 * Groups come from data the module already holds — a weapon's attack modes,
 * the special manoeuvres overlay, a spell book's recorded formulae, a locked
 * container's lock. Nothing here invents a throw: a row is rollable only when
 * there is a real roll path behind it (core's attack pipeline, the lock
 * actions), and a row with no path — a spell formula recorded in a book — is
 * listed and not offered a die.
 *
 * Row ids are stable strings (`atk:melee`, `man:disarm`, `lock:pick`,
 * `spell:2:0`) because the pinned rolls are stored on the item by id.
 */
import { LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { classifyWeapon, canOneHand, isTwoHandedOnly } from "../profiles.mjs";
import { attackBonusOf, damageFormulaOf } from "../properties.mjs";
import { skipDialogFor } from "../../lib/roll-dialog.mjs";
import { MANEUVERS, overlayEnabled as maneuverOverlayEnabled, trickeryFor } from "../overlays/maneuvers.mjs";
import { isSpellbook, spellbookSpells } from "../spellbook.mjs";
import { containerOf, isLocked } from "../containers.mjs";
import { pickLock, bashOpen, canPick, canBash, wearingGloves } from "../locks.mjs";
import { isWeaponProficient } from "../proficiency.mjs";
import { damageGlyphOf, damageTypeLabel, damageTypeOf } from "../../lib/damage-type.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../../lib/vocab.mjs";
import { signed, DASH } from "./format.mjs";

const loc = makeLoc(LANG);

/** Short mnemonics for the manoeuvres, for the pinned-roll cells. */
const MANEUVER_MNEMONIC = Object.freeze({
  disarm: "DIS", forceBack: "FRC", incapacitate: "INC", knockDown: "KNK", overrun: "OVR", sunder: "SND", wrestling: "WRS",
});

/**
 * The actor a roll is made by: the item's owner, else the controlled token,
 * else the user's own character. Null means "nobody to roll".
 */
export function rollerFor(item) {
  return item?.parent ?? canvas?.tokens?.controlled?.[0]?.actor ?? game.user?.character ?? null;
}

/** The three-letter mnemonic a spell name collapses to. */
const spellMnemonic = (name) => String(name ?? "").replace(/[^a-z]/gi, "").slice(0, 3).toUpperCase() || "SPL";

/**
 * Build the roll groups for an item.
 * @returns {{key:string, name:string, note:string, src:string|null, rows:object[]}[]}
 */
export function rollGroups(item, actor = rollerFor(item)) {
  const groups = [];
  if (!item) return groups;

  if (item.type === ITEM_TYPE.weapon) {
    const profile = classifyWeapon(item);
    const glyph = damageGlyphOf(item);
    const typeLabel = damageTypeOf(item) ? damageTypeLabel(damageTypeOf(item)) : "";
    const damage = damageFormulaOf(item) || profile.damage || "1d6";
    const bonus = attackBonusOf(item);
    const rows = [];
    const mods = [];
    if (actor?.type === ACTOR_TYPE.character && !isWeaponProficient(actor, profile)) mods.push(loc("itemSheet.rolls.mod.nonProficient"));
    if (item.system?.melee ?? profile.melee) {
      const hands = isTwoHandedOnly(profile) ? "2H" : canOneHand(profile) ? "1H" : "2H";
      rows.push({
        id: "atk:melee",
        m: hands,
        glyph,
        v: damage,
        label: loc("itemSheet.rolls.row.melee"),
        line: [`${signed(bonus)} ${loc("itemSheet.rolls.throw")}`, `${damage} ${typeLabel}`.trim()].join(" · "),
        mods: [...mods],
        rollable: !!actor,
      });
      if (profile.damage2h && canOneHand(profile)) {
        rows.push({
          id: "atk:melee2h",
          m: "2H",
          glyph,
          v: profile.damage2h,
          label: loc("itemSheet.rolls.row.twoHanded"),
          line: [`${signed(bonus)} ${loc("itemSheet.rolls.throw")}`, `${profile.damage2h} ${typeLabel}`.trim()].join(" · "),
          mods: [loc("itemSheet.rolls.mod.noShield")],
          rollable: !!actor,
        });
      }
    }
    if (item.system?.missile ?? profile.missile) {
      const r = item.system?.range ?? {};
      const range = [r.short, r.medium, r.long].filter((n) => Number(n) > 0).map((n) => `${n}′`).join(" / ");
      rows.push({
        id: "atk:missile",
        m: profile.thrown ? "HRL" : "SHT",
        glyph,
        v: damage,
        label: loc(profile.thrown ? "itemSheet.rolls.row.hurled" : "itemSheet.rolls.row.shoot"),
        line: [`${signed(bonus)} ${loc("itemSheet.rolls.throw")}`, `${damage} ${typeLabel}`.trim(), range ? loc("itemSheet.rolls.range", { range }) : null].filter(Boolean).join(" · "),
        mods: [...mods],
        rollable: !!actor,
      });
    }
    groups.push({ key: "attackModes", name: loc("itemSheet.rolls.group.attackModes"), note: typeLabel, src: null, rows });

    if (maneuverOverlayEnabled() && actor?.type === ACTOR_TYPE.character) {
      const trickery = trickeryFor(actor);
      const manRows = Object.entries(MANEUVERS).map(([key, m]) => ({
        id: `man:${key}`,
        m: MANEUVER_MNEMONIC[key] ?? key.slice(0, 3).toUpperCase(),
        glyph: null,
        v: signed(m.penalty),
        label: m.label,
        line: m.save ? loc("itemSheet.rolls.maneuver.save", { save: m.save }) : loc("itemSheet.rolls.maneuver.noSave"),
        mods: trickery.has(key.toLowerCase()) ? [loc("itemSheet.rolls.mod.trickery")] : [],
        rollable: true,
      }));
      groups.push({ key: "maneuvers", name: loc("itemSheet.rolls.group.maneuvers"), note: loc("itemSheet.rolls.group.maneuversNote"), src: null, rows: manRows });
    }
  }

  if (isSpellbook(item)) {
    const byLevel = new Map();
    spellbookSpells(item).forEach((sp, i) => {
      const lvl = Math.max(0, Number(sp.lvl ?? 0));
      if (!byLevel.has(lvl)) byLevel.set(lvl, []);
      byLevel.get(lvl).push({
        id: `spell:${lvl}:${i}`,
        m: spellMnemonic(sp.name),
        glyph: "magic",
        v: DASH,
        label: sp.name,
        line: loc("itemSheet.rolls.spell.level", { n: lvl }),
        mods: [],
        rollable: false,
      });
    });
    for (const lvl of [...byLevel.keys()].sort((a, b) => a - b)) {
      const rows = byLevel.get(lvl);
      groups.push({
        key: `spells:${lvl}`,
        name: loc("itemSheet.rolls.group.spells", { n: lvl }),
        note: loc("itemSheet.rolls.group.spellsNote", { n: rows.length }),
        src: loc("itemSheet.rolls.src.contents"),
        rows,
      });
    }
  }

  const rec = containerOf(item);
  if (rec?.locked || Number.isFinite(Number(rec?.lockMod)) && rec?.lockMod) {
    const mod = Number(rec.lockMod ?? 0);
    const gloved = actor ? wearingGloves(actor) : false;
    groups.push({
      key: "theLock",
      name: loc("itemSheet.rolls.group.lock"),
      note: isLocked(item) ? loc("itemSheet.rolls.group.lockShut") : loc("itemSheet.rolls.group.lockOpen"),
      src: null,
      rows: [
        {
          id: "lock:pick",
          m: "PICK",
          glyph: null,
          v: mod ? signed(mod) : DASH,
          label: loc("itemSheet.rolls.row.pick"),
          line: loc("itemSheet.rolls.row.pickLine"),
          mods: gloved ? [loc("itemSheet.rolls.mod.gloved")] : [],
          rollable: !!actor && canPick(actor),
        },
        {
          id: "lock:bash",
          m: "BASH",
          glyph: null,
          v: DASH,
          label: loc("itemSheet.rolls.row.bash"),
          line: rec.fragile ? loc("itemSheet.rolls.row.bashFragile") : loc("itemSheet.rolls.row.bashLine"),
          mods: [loc("itemSheet.rolls.mod.loud")],
          rollable: !!actor && canBash(actor),
        },
      ],
    });
  }

  return groups;
}

/** Every row id, in document order — what the pin store is bounded by. */
export const rollIds = (groups) => groups.flatMap((g) => g.rows.map((r) => r.id));

/**
 * Make one roll by id. Attacks go through the system's own attack throw with
 * the kind chosen: a hurled row is the system's "thrown" where the weapon
 * offers it, the two-handed row opens on the ALTERNATE damage mode, and a
 * manoeuvre is a melee attack with the manoeuvre declared, which the
 * equipment contributor puts on the throw as its own row. The lock rows call
 * the lock actions. Returns false when the id names nothing rollable.
 */
export async function rollById(item, id, { event } = {}) {
  const actor = rollerFor(item);
  if (!actor) {
    ui.notifications?.warn(loc("itemSheet.rolls.noRoller"));
    return false;
  }
  const [kind, key] = String(id).split(":");
  const skipDialog = skipDialogFor(event);
  if (kind === "atk") {
    const types = item.system?.getAttackTypes?.() ?? [];
    const attackType =
      key === "missile"
        ? (types.includes("missile") ? "missile" : types.includes("thrown") ? "thrown" : "missile")
        : "melee";
    const acksLib = key === "melee2h" ? { damageMode: "alternate" } : key === "melee" ? { damageMode: "base" } : {};
    await actor.makeAttackThrow({ item, attackType, skipDialog, acksLib });
    return true;
  }
  if (kind === "man") {
    if (!MANEUVERS[key]) return false;
    await actor.makeAttackThrow({ item, attackType: "melee", skipDialog, acksLib: { maneuver: key } });
    return true;
  }
  if (kind === "lock") {
    if (key === "pick") return (await pickLock(actor, item)).ok;
    if (key === "bash") {
      const fragile = !!containerOf(item)?.fragile;
      const ok = await foundry.applications.api.DialogV2.confirm({
        classes: ["acks-ui", "acks-extras", "acks-extras-scroll"],
        window: { title: item.name },
        content: `<p>${game.i18n.localize(fragile ? "ACKS-EQUIPMENT.container.bashConfirmFragile" : "ACKS-EQUIPMENT.container.bashConfirm")}</p>`,
      });
      if (!ok) return false;
      return (await bashOpen(actor, item)).ok;
    }
  }
  return false;
}
