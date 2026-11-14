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
import { MANEUVERS, maneuverMods, overlayEnabled as maneuverOverlayEnabled, trickeryFor } from "../overlays/maneuvers.mjs";
import { RULEDATA_DOC } from "../overlays/scavenged.mjs";
import { citeOf } from "../../lib/tables.mjs";
import { isSpellbook, spellbookSpells } from "../spellbook.mjs";
import { containerOf, isLocked } from "../containers.mjs";
import { pickLock, bashOpen, canPick, canBash, wearingGloves } from "../locks.mjs";
import { isWeaponProficient } from "../proficiency.mjs";
import { figureState, figureTip, heldDieTip } from "../weapon-figures.mjs";
import { ATTACK_TYPE, DAMAGE_MODE, heldGrip } from "../attack-mods.mjs";
import { damageGlyphOf, damageTypeLabel, damageTypeOf } from "../../lib/damage-type.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../../lib/vocab.mjs";
import { signed, DASH } from "./format.mjs";

const loc = makeLoc(LANG);

/** Short mnemonics for the manoeuvres, for the pinned-roll cells. */
const MANEUVER_MNEMONIC = Object.freeze({
  disarm: "DIS", forceBack: "FRC", incapacitate: "INC", knockDown: "KNK", overrun: "OVR", sunder: "SND", wrestling: "WRS",
});

/**
 * Where a manoeuvre's penalty came from, as the tooltip on the figure: the
 * parts that make it up, each named and carrying its own number, and the page
 * (or the Judge's hand) each was read from. A penalty with a part not
 * imported has no tooltip.
 * @param {{attackPenalty: number|null, missing: string[], parts: {part: string, value: number, table: string}[]}} mods a `maneuverMods` result
 */
function maneuverTip(mods) {
  if (mods.attackPenalty == null) return "";
  const names = {
    base: () => loc("itemSheet.rolls.maneuver.part.base"),
    trickery: () => loc("itemSheet.rolls.maneuver.part.trickery"),
    hooked: () => loc("itemSheet.rolls.maneuver.part.hooked"),
    entangling: () => loc("itemSheet.rolls.maneuver.part.entangling"),
    flexible: () => loc("itemSheet.rolls.maneuver.part.flexible"),
    incapacitating: () => loc("itemSheet.rolls.maneuver.part.incapacitating"),
  };
  const cites = [...new Set(mods.parts.map((p) => citeOf(RULEDATA_DOC, p.table) ?? loc("itemSheet.rolls.maneuver.byHand")))];
  return loc("itemSheet.rolls.maneuver.tip", {
    parts: mods.parts.map((p) => `${names[p.part]?.() ?? p.part} ${signed(p.value)}`).join(" · "),
    cite: cites.join("; "),
  });
}

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
    const damage = damageFormulaOf(item) || profile.damage;
    // No die stated by the item or a row is blank, never a die.
    const dieShown = damage || "";
    const bonus = attackBonusOf(item);
    // Where the die came from: the item's own, the weapon row's with its page,
    // or nothing imported. It rides the row's line, which names the die.
    const dieTip = figureTip(figureState({ key: profile.key, field: "damage", declared: damageFormulaOf(item) }), loc("itemSheet.rolls.dieLabel"));
    const rows = [];
    // Asked per mode: a weapon every class may throw can still be one a class
    // may not swing, and the tag has to agree with the roll's own rows.
    // A weapon the grants cannot decide (a figure they ask of it is not
    // imported) is no refusal and carries no tag.
    const nonProficient = (attack) => {
      if (actor?.type !== ACTOR_TYPE.character) return [];
      return isWeaponProficient(actor, profile, undefined, { attack }) ? [] : [loc("itemSheet.rolls.mod.nonProficient")];
    };
    const meleeMods = nonProficient(ATTACK_TYPE.melee);
    const missileMods = nonProficient(ATTACK_TYPE.missile);
    if (item.system?.melee ?? profile.melee) {
      // One row, in the grip the weapon is held in now: the die it shows is
      // the die `rollById` sends the system.
      const held = heldGrip(actor, item);
      const twoHandedDie = held.mode === DAMAGE_MODE.alternate;
      const hands = held.twoHanded || isTwoHandedOnly(profile) ? "2H" : canOneHand(profile) ? "1H" : "2H";
      rows.push({
        id: "atk:melee",
        m: hands,
        glyph,
        v: held.formula || null,
        twoHanded: twoHandedDie,
        label: loc(twoHandedDie ? "itemSheet.rolls.row.twoHanded" : "itemSheet.rolls.row.melee"),
        line: [`${signed(bonus)} ${loc("itemSheet.rolls.throw")}`, `${held.formula || ""} ${typeLabel}`.trim()].filter(Boolean).join(" · "),
        tip: heldDieTip(held, loc("itemSheet.rolls.dieLabel")),
        mods: twoHandedDie ? [...meleeMods, loc("itemSheet.rolls.mod.noShield")] : [...meleeMods],
        rollable: !!actor,
      });
    }
    if (item.system?.missile ?? profile.missile) {
      const r = item.system?.range ?? {};
      const range = [r.short, r.medium, r.long].filter((n) => Number(n) > 0).map((n) => `${n}′`).join(" / ");
      rows.push({
        id: "atk:missile",
        m: profile.thrown ? "HRL" : "SHT",
        glyph,
        v: damage || null,
        label: loc(profile.thrown ? "itemSheet.rolls.row.hurled" : "itemSheet.rolls.row.shoot"),
        line: [`${signed(bonus)} ${loc("itemSheet.rolls.throw")}`, `${dieShown} ${typeLabel}`.trim(), range ? loc("itemSheet.rolls.range", { range }) : null].filter(Boolean).join(" · "),
        tip: dieTip,
        mods: [...missileMods],
        rollable: !!actor,
      });
    }
    groups.push({ key: "attackModes", name: loc("itemSheet.rolls.group.attackModes"), note: typeLabel, src: null, rows });

    if (maneuverOverlayEnabled() && actor?.type === ACTOR_TYPE.character) {
      const trickery = trickeryFor(actor);
      // The penalty the throw will carry: this actor's Combat Trickery and this
      // weapon's qualities included. One not imported has a blank figure; the
      // row still rolls, as the weapon die's does, without the penalty.
      const manRows = Object.entries(MANEUVERS).map(([key, m]) => {
        const man = maneuverMods(actor, profile, key);
        const penalty = man.attackPenalty;
        const saveLine = m.save ? loc("itemSheet.rolls.maneuver.save", { save: m.save }) : loc("itemSheet.rolls.maneuver.noSave");
        return {
          id: `man:${key}`,
          m: MANEUVER_MNEMONIC[key] ?? key.slice(0, 3).toUpperCase(),
          glyph: null,
          v: penalty == null ? "" : signed(penalty),
          label: m.label,
          line: [penalty == null ? "" : `${signed(penalty)} ${loc("itemSheet.rolls.throw")}`, saveLine].filter(Boolean).join(" · "),
          tip: maneuverTip(man),
          mods: trickery.has(key.toLowerCase()) ? [loc("itemSheet.rolls.mod.trickery")] : [],
          rollable: true,
        };
      });
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
 * offers it, the melee row opens on the damage mode of the grip the weapon is
 * held in (`heldGrip`), and a
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
    // The melee row sends the mode its die was shown in.
    const acksLib = key === "melee" ? { damageMode: heldGrip(actor, item).mode } : {};
    await actor.makeAttackThrow({ item, attackType, skipDialog, acksLib });
    return true;
  }
  if (kind === "man") {
    if (!MANEUVERS[key]) return false;
    // A penalty not imported is no penalty to invent: the throw goes out
    // without the row.
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
