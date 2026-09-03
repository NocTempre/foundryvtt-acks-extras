/* global game, ui, Roll, ChatMessage, CONFIG */
/**
 * The Rolls tab: every throw the character can make, gathered into groups,
 * and the one function that makes one of them.
 *
 * Nothing here invents a throw. Saves, adventuring throws, the healing rate
 * and the two attack boxes go through the system's own actor methods (which
 * the module's attack patch wraps); a weapon's modes go through the item
 * sheet's roll rows (core's targeting pipeline with the mode forced); an
 * ability's throws go through the abilities feature's roller. Initiative
 * rolls through the combat tracker when the character is a combatant and
 * through core's initiative formula otherwise; surprise rolls the die with
 * the character's modifier and states no threshold (DECISIONS 2026-09-03).
 *
 * Row ids are stable strings because the pinned rolls are stored by id:
 * `save:death`, `adv:climb`, `init`, `surprise:avoid`, `atk:melee`, `bhr`,
 * `unarmed`, `morale`, `loyalty`, `wpn:<itemId>:<mode>`, `abl:<itemId>:<key>`.
 */
import { LANG, SAVE_KEYS, ADVENTURING_KEYS } from "./constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { signed } from "./view-model.mjs";
import { rollGroups as itemRollGroups, rollById as itemRollById } from "../equipment/item-sheet/rolls.mjs";
import { rollUnarmed } from "../equipment/actions.mjs";
import { bestAttackBonus, getLoadout } from "../equipment/loadout.mjs";
import { containedIn } from "../equipment/containers.mjs";
import { rollsOf, keyOf, rollAbility, throwText, scoreTerm, scoreText, labelOf } from "../abilities/ability-rolls.mjs";
import { damageTypeOf, damageTypeLabel } from "../lib/damage-type.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { saveSystemKey, saveLabel } from "./snapshot.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
const skipFor = (event) => {
  try {
    const key = game.settings.get("acks", "skip-dialog-key");
    return !!(event && key && event[key]);
  } catch {
    return false;
  }
};

/** Where a weapon is, as the line under its row. */
function weaponState(actor, item, loadout) {
  if (containedIn(item)) {
    const box = actor.items.get(containedIn(item));
    return loc("rolls.state.stowed", { name: box?.name ?? "" });
  }
  if (loadout.weapons.some((w) => w.item.id === item.id)) return loc("rolls.state.wielded");
  return loc("rolls.state.carried");
}

/**
 * Build the roll groups for an actor.
 * @returns {{groups: object[], ids: string[]}}
 */
export function rollInventory(actor) {
  const sys = actor.system ?? {};
  const groups = [];
  const pins = new Set(Array.isArray(actor.getFlag("acks-extras", "sheet")?.pins) ? actor.getFlag("acks-extras", "sheet").pins : []);
  const row = (id, label, value, extra = {}) => ({ id, label, value, line: "", big: false, eq: false, rollable: true, pinned: pins.has(id), item: null, ...extra });

  groups.push({
    key: "saves",
    name: loc("rolls.group.saves"),
    rows: SAVE_KEYS.map((k) => row(`save:${k}`, saveLabel(k), `${num(sys.saves?.[saveSystemKey(k)]?.value)}+`)),
  });

  const surprise = sys.surprise ?? {};
  groups.push({
    key: "initiative",
    name: loc("rolls.group.initiative"),
    rows: [
      row("init", game.i18n.localize("ACKS.Initiative"), signed(num(sys.initiative?.value))),
      row("surprise:others", game.i18n.localize("ACKS.SurpriseOthers"), signed(num(surprise.surpriseothers))),
      row("surprise:avoid", game.i18n.localize("ACKS.AvoidSurprise"), signed(num(surprise.avoidsurprise))),
    ],
  });

  const T = num(sys.thac0?.throw, 10);
  const melee = bestAttackBonus(actor, "melee");
  const missile = bestAttackBonus(actor, "missile");
  const loadout = getLoadout(actor);
  const attackRows = [
    row("atk:melee", game.i18n.localize("ACKS.Melee"), `${T}+ · ${signed(melee.total)}`, { big: true }),
    row("atk:missile", game.i18n.localize("ACKS.Missile"), `${T}+ · ${signed(missile.total)}`, { big: true }),
  ];
  const wielded = new Set(loadout.weapons.map((w) => w.item.id));
  const weapons = actor.items.filter((i) => i.type === ITEM_TYPE.weapon);
  weapons.sort((a, b) => Number(wielded.has(b.id)) - Number(wielded.has(a.id)) || a.name.localeCompare(b.name));
  for (const item of weapons) {
    const modes = itemRollGroups(item, actor).find((g) => g.key === "attackModes")?.rows ?? [];
    const typeLabel = damageTypeOf(item) ? damageTypeLabel(damageTypeOf(item)) : "";
    const state = weaponState(actor, item, loadout);
    for (const mode of modes) {
      const missileMode = mode.id === "atk:missile";
      const bonus = (missileMode ? missile.total : melee.total) + num(item.system?.bonus);
      const suffix = mode.id === "atk:melee2h" ? loc("rolls.mode.twoHanded") : missileMode && item.system?.melee ? loc("rolls.mode.thrown") : "";
      attackRows.push(
        row(`wpn:${item.id}:${mode.id}`, suffix ? `${item.name}, ${suffix}` : item.name, `${T}+ · ${signed(bonus)}`, {
          line: [`${mode.v} ${typeLabel}`.trim(), state].filter(Boolean).join(" · "),
          eq: wielded.has(item.id),
          pinned: !!item.system?.favorite,
          item: item.id,
          mods: mode.mods,
        }),
      );
    }
  }
  if (!loadout.weapons.length) {
    attackRows.push(row("unarmed", game.i18n.localize("ACKS-EQUIPMENT.action.unarmed"), `${T}+ · ${signed(melee.total)}`, { line: loc("rolls.state.unarmed") }));
  }
  groups.push({ key: "attack", name: loc("rolls.group.attack"), note: loc("rolls.note.throwBonus"), rows: attackRows });

  groups.push({
    key: "recovery",
    name: loc("rolls.group.recovery"),
    rows: [row("bhr", game.i18n.localize("ACKS.HealingRate"), String(sys.hp?.bhr ?? sys.fight?.healingrate ?? ""))],
  });

  groups.push({
    key: "adventuring",
    name: loc("rolls.group.adventuring"),
    rows: ADVENTURING_KEYS.map((k) => row(`adv:${k}`, game.i18n.localize(`ACKS.adventuring.${k}`), `${num(sys.adventuring?.[k])}+`)),
  });

  const profRows = [];
  for (const item of actor.items.filter((i) => i.type === ITEM_TYPE.ability)) {
    const rolls = rollsOf(item);
    rolls.forEach((r, i) => {
      const key = keyOf(r, i);
      const term = scoreTerm(r, actor);
      const label = rolls.length > 1 && (r.label || labelOf(r)) ? `${item.name} · ${r.label || labelOf(r)}` : item.name;
      profRows.push(
        row(`abl:${item.id}:${key}`, label, throwText(r, actor, item), {
          line: term ? scoreText(term, r) : "",
          pinned: !!item.system?.favorite,
          item: item.id,
        }),
      );
    });
  }
  if (profRows.length) groups.push({ key: "proficiencies", name: loc("rolls.group.proficiencies"), rows: profRows });

  if (sys.retainer?.enabled) {
    groups.push({
      key: "retainer",
      name: loc("rolls.group.retainer"),
      rows: [
        row("morale", game.i18n.localize("ACKS.details.morale"), signed(num(sys.details?.morale))),
        row("loyalty", game.i18n.localize("ACKS.Loyalty"), signed(num(sys.retainer?.loyalty))),
      ],
    });
  }

  return { groups, ids: groups.flatMap((g) => g.rows.map((r) => r.id)) };
}

/** A plain die to chat: the character's own modifier, no threshold stated. */
async function plainRoll(actor, formula, data, flavor) {
  const roll = await new Roll(formula, data).evaluate();
  await roll.toMessage({ speaker: ChatMessage.getSpeaker({ actor }), flavor });
  return roll;
}

/**
 * Make one roll by id. Returns false when the id names nothing rollable.
 */
export async function rollById(actor, id, { event } = {}) {
  const [kind, a, b] = String(id).split(":");
  const sys = actor.system ?? {};
  switch (kind) {
    case "save":
      await actor.rollSave(saveSystemKey(a), { event });
      return true;
    case "adv":
      await actor.rollAdventuring(a, { event });
      return true;
    case "bhr":
      await actor.rollBHR({ event });
      return true;
    case "morale":
      await actor.rollMorale({ event });
      return true;
    case "loyalty":
      await actor.rollLoyalty({ event });
      return true;
    case "unarmed":
      await rollUnarmed(actor, { event });
      return true;
    case "atk":
      // Core's own attack boxes: the character's throw with no weapon named.
      await actor.targetAttack({ actor, roll: {} }, a, { type: a, skipDialog: skipFor(event) });
      return true;
    case "init": {
      const combatant = game.combat?.combatants?.find((c) => c.actorId === actor.id) ?? null;
      if (combatant && game.combat) {
        await game.combat.rollInitiative([combatant.id]);
        return true;
      }
      const formula = CONFIG.Combat?.initiative?.formula || "1d6 + @initiative.value";
      await plainRoll(actor, formula, actor.getRollData?.() ?? sys, game.i18n.localize("ACKS.Initiative"));
      return true;
    }
    case "surprise": {
      const mod = num(a === "others" ? sys.surprise?.surpriseothers : sys.surprise?.avoidsurprise);
      await plainRoll(actor, `1d6 + ${mod}`, {}, game.i18n.localize(a === "others" ? "ACKS.SurpriseOthers" : "ACKS.AvoidSurprise"));
      return true;
    }
    case "wpn": {
      const item = actor.items.get(a);
      if (!item) return false;
      return itemRollById(item, `atk:${b}`, { event });
    }
    case "abl": {
      const item = actor.items.get(a);
      if (!item) return false;
      await rollAbility(item, b);
      return true;
    }
    default:
      ui.notifications?.warn(loc("rolls.unknown"));
      return false;
  }
}
