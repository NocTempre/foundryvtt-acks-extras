/* global game, ui, CONFIG, ChatMessage */
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
 * `unarmed`, `morale`, `loyalty`, `wpn:<itemId>:atk:<mode>` (the item sheet's
 * own row id after the item id), `abl:<itemId>:<key>`, `grant:<ref>:<key>` (a
 * throw a spell grants: the proficiency's reference and the throw's key, so a
 * record cast by another character and one cast on oneself are one row; held by
 * no item, so its row has none). A grant a record holds is a gold row that rolls
 * for as long as the record lasts; one the character could cast on itself and
 * has not is a pale row that shows and does not roll (`latent`), and `post:<itemId>` —
 * an ability with no throw, which posts its card instead of rolling. Its own
 * kind, so a throw added later can never take its id.
 */
import { LANG, SAVE_KEYS, ADVENTURING_KEYS } from "./constants.mjs";
import { makeLoc, numOrNull, plainRoll } from "../lib/util.mjs";
import { FRAME_LANG_PREFIX } from "../lib/frame.mjs";
import { carriesMorale, signed } from "./view-model.mjs";
import { rollGroups as itemRollGroups, rollById as itemRollById } from "../equipment/item-sheet/rolls.mjs";
import { rollUnarmed } from "../equipment/actions.mjs";
import { bestAttackBonus, getLoadout } from "../equipment/loadout.mjs";
import { containedIn } from "../equipment/containers.mjs";
import { rollsOf, keyOf, rollAbility, throwText, throwProvenance, noteProvenance, autoText, grantedThrows, availableThrows, rollGrantedThrow, scoreTerm, scoreText, labelOf } from "../abilities/ability-rolls.mjs";
import { renderRollCard } from "../lib/roll-card.mjs";
import { autoCardRow } from "../formation/party-rolls.mjs";
import { adventuringThrow } from "../abilities/adventuring-throw.mjs";
import { damageTypeOf, damageTypeLabel } from "../lib/damage-type.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { saveSystemKey, saveLabel } from "./snapshot.mjs";
import { isAdventuring } from "../classes/grants.mjs";
import { skipDialogFor } from "../lib/roll-dialog.mjs";
import { blankLoyaltyCite } from "../lib/score-bounds.mjs";

const loc = makeLoc(LANG);
const frameLoc = makeLoc(FRAME_LANG_PREFIX);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * Where an Adventuring row's figure came from: the source that won, with the
 * other figure when there is one, and the page the skill's import names. Text
 * for `data-tooltip-text`; no figure is written here, only the actor's own.
 */
function adventuringTip(found) {
  if (found.auto) return autoText({ record: found.record });
  return [adventuringBase(found), noteProvenance(found.record)].filter(Boolean).join(" · ");
}

/** The figure's own sentence: where it was read from, its parts and the other figure. A figure a spell set has none but the spell's. */
function adventuringBase(found) {
  if (found.source === "stored" && found.record?.set) return "";
  const cite = found.cite ? ` (${found.cite})` : "";
  const fill = { target: num(found.target), other: num(found.other), skill: found.skillName ?? "", cite };
  const included = (found.parts ?? []).length
    ? ` ${loc("rolls.adv.parts", { parts: found.parts.map((p) => `${p.label} ${signed(p.value)}${p.cite ? ` (${p.cite})` : ""}`).join(", ") })}`
    : "";
  if (found.source === "skill") return loc(found.other == null ? "rolls.adv.fromSkillOnly" : "rolls.adv.fromSkill", fill) + included;
  if (found.source === "standIn") {
    const stand = { ...fill, skill: found.standIn.name, cite: found.standIn.cite ? ` (${found.standIn.cite})` : "" };
    return loc(found.other == null ? "rolls.adv.fromStandInOnly" : "rolls.adv.fromStandIn", stand) + included;
  }
  if (found.target == null) return "";
  return loc(found.skillName ? "rolls.adv.fromStoredBetter" : "rolls.adv.fromStored", fill) + included;
}

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

  // The throw leads each attack's figure; an actor with no number for it shows the bonus alone.
  const T = numOrNull(sys.attack?.throw);
  const lead = T == null ? "" : `${T}+ · `;
  const melee = bestAttackBonus(actor, "melee");
  const missile = bestAttackBonus(actor, "missile");
  const loadout = getLoadout(actor);
  const attackRows = [
    row("atk:melee", game.i18n.localize("ACKS.Melee"), `${lead}${signed(melee.total)}`, { big: true }),
    row("atk:missile", game.i18n.localize("ACKS.Missile"), `${lead}${signed(missile.total)}`, { big: true }),
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
      const bonus = (missileMode ? missile.total : melee.total) + num(item.system?.bonus?.attack);
      const suffix = mode.twoHanded ? loc("rolls.mode.twoHanded") : missileMode && item.system?.melee ? loc("rolls.mode.thrown") : "";
      attackRows.push(
        row(`wpn:${item.id}:${mode.id}`, suffix ? `${item.name}, ${suffix}` : item.name, `${lead}${signed(bonus)}`, {
          line: [`${mode.v} ${typeLabel}`.trim(), state].filter(Boolean).join(" · "),
          lineTip: mode.tip ?? "",
          eq: wielded.has(item.id),
          pinned: !!item.system?.favorite,
          item: item.id,
          mods: mode.mods,
        }),
      );
    }
  }
  if (!loadout.weapons.length) {
    attackRows.push(row("unarmed", game.i18n.localize("ACKS-EQUIPMENT.action.unarmed"), `${lead}${signed(melee.total)}`, { line: loc("rolls.state.unarmed") }));
  }
  groups.push({ key: "attack", name: loc("rolls.group.attack"), note: loc("rolls.note.throwBonus"), rows: attackRows });

  groups.push({
    key: "recovery",
    name: loc("rolls.group.recovery"),
    rows: [row("bhr", game.i18n.localize("ACKS.HealingRate"), String(sys.hp?.bhr ?? sys.fight?.healingrate ?? ""))],
  });

  // Each row is the better of the stored figure and the held skill's throw
  // (`adventuringThrow`). The skill throw a row stands for is left out of the
  // proficiencies below, so it is listed once.
  const backed = new Set();
  groups.push({
    key: "adventuring",
    name: loc("rolls.group.adventuring"),
    rows: ADVENTURING_KEYS.map((k) => {
      const found = adventuringThrow(actor, k);
      if (found.backs) backed.add(`${found.backs.itemId}:${found.backs.rollKey}`);
      const shown = found.auto ? game.i18n.localize("ACKS-ABILITIES.roll.autoShort") : found.target == null ? "—" : `${found.target}+`;
      return row(`adv:${k}`, game.i18n.localize(`ACKS.adventuring.${k}`), shown, {
        line: found.source === "skill" ? found.skillName : (found.standIn?.name ?? ""),
        tip: adventuringTip(found),
      });
    }),
  });

  // The Adventuring proficiency's own throws are the five the group above
  // already lists from the system's fields, which Stats edits; listing the
  // item's copy too doubles every one of them.
  const profRows = [];
  for (const item of actor.items.filter((i) => i.type === ITEM_TYPE.ability && !isAdventuring(i))) {
    const rolls = rollsOf(item);
    rolls.forEach((r, i) => {
      const key = keyOf(r, i);
      if (backed.has(`${item.id}:${key}`)) return;
      const term = scoreTerm(r, actor);
      const label = rolls.length > 1 && (r.label || labelOf(r)) ? `${item.name} · ${r.label || labelOf(r)}` : item.name;
      profRows.push(
        row(`abl:${item.id}:${key}`, label, throwText(r, actor, item), {
          line: term ? scoreText(term, r) : "",
          pinned: !!item.system?.favorite,
          item: item.id,
          // Where a spell record moved the figure the value says so; blank keeps the row as it was.
          tip: throwProvenance(r, actor, item),
        }),
      );
    });
  }
  // A throw a spell record grants stands in the same group, in the same row, for as long as its record lasts (gold, whoever cast it).
  const grantLabel = (g) => (g.label ? `${g.name} · ${g.label}` : g.name);
  for (const g of grantedThrows(actor)) {
    profRows.push(row(g.id, grantLabel(g), g.text, { line: g.spell, tip: g.tip, granted: true }));
  }
  // A throw the character could cast on itself and has not stands beside them, pale and display only: it rolls nothing and cannot be pinned.
  for (const g of availableThrows(actor, { viewer: game.user })) {
    profRows.push(row(g.id, grantLabel(g), g.text, { line: g.spell, tip: g.tip, latent: true, rollable: false, pinned: false }));
  }
  if (profRows.length) groups.push({ key: "proficiencies", name: loc("rolls.group.proficiencies"), rows: profRows });

  // Every ability with no throw, as a row that posts its card: a starred one
  // reaches the folded card like any pinned roll, and an unstarred one stays
  // here rather than vanishing when its star is cleared.
  const postRows = actor.items
    .filter((i) => i.type === ITEM_TYPE.ability && !isAdventuring(i) && !rollsOf(i).length)
    .map((item) => row(`post:${item.id}`, item.name, "", { post: true, pinned: !!item.system?.favorite, item: item.id }));
  if (postRows.length) groups.push({ key: "post", name: loc("rolls.group.post"), rows: postRows });

  const morale = () => row("morale", game.i18n.localize("ACKS.details.morale"), signed(num(sys.details?.morale)));
  // An empty Loyalty field is a blank figure that names the page printing it; the row still rolls, and the roll refuses with the reason.
  const loyalty = () => {
    const score = numOrNull(sys.retainer?.loyalty);
    return row("loyalty", game.i18n.localize("ACKS.Loyalty"), score === null ? "" : signed(score), score === null ? { tip: blankLoyaltyCite() } : {});
  };
  if (sys.retainer?.enabled) {
    groups.push({
      key: "retainer",
      name: loc("rolls.group.retainer"),
      rows: [morale(), loyalty()],
    });
  } else if (carriesMorale(actor)) {
    groups.push({ key: "morale", name: game.i18n.localize("ACKS.details.morale"), rows: [morale()] });
  }

  // A pale row is no roll, so its id is no id a pin can name.
  return { groups, ids: groups.flatMap((g) => g.rows.filter((r) => !r.latent).map((r) => r.id)) };
}

/**
 * Make one roll by id. Returns false when the id names nothing rollable.
 */
export async function rollById(actor, id, { event } = {}) {
  const [kind, a] = String(id).split(":");
  // What follows an item id is the item's own roll key, and a weapon's is the
  // item sheet's row id, which carries a colon of its own (`atk:missile`): it
  // is the whole remainder, never one segment. Cut to one, every weapon mode
  // reads as `atk` and rolls as melee.
  const rest = String(id).split(":").slice(2).join(":");
  const sys = actor.system ?? {};
  // Core builds an attack's target from the actor's own throw, so an attack
  // with none to build it from is refused rather than rolled against nothing.
  if ((kind === "atk" || kind === "unarmed" || (kind === "wpn" && rest.startsWith("atk:"))) && numOrNull(sys.attack?.throw) == null) {
    ui.notifications?.warn(loc("rolls.noAttackThrow"));
    return false;
  }
  switch (kind) {
    case "save":
      await actor.rollSave(saveSystemKey(a), { event });
      return true;
    case "adv": {
      // The derived figure is thrown against in place of the stored one
      // wherever it differs; the throw's wrapper applies the conditions to it.
      const found = adventuringThrow(actor, a);
      // A spell made it automatic: nothing is rolled. A held skill's throw posts its own card; the stored figure has none, so a line says so.
      if (found.auto) {
        const via = found.via ? actor.items.get(found.via.itemId) : null;
        if (via) await rollAbility(via, found.via.rollKey, { event });
        else {
          // One line on the party card's own format.
          const tip = autoText({ record: found.record });
          const content = renderRollCard({ title: game.i18n.localize(`ACKS.adventuring.${a}`), subtitle: actor.name, sections: [{ rows: [autoCardRow({ name: actor.name, source: tip, sourceTip: tip })] }] });
          await ChatMessage.create({ speaker: ChatMessage.getSpeaker({ actor }), content });
        }
        return true;
      }
      const stored = Number(sys.adventuring?.[a]);
      await actor.rollAdventuring(a, { event, ...(found.target != null && found.target !== stored ? { target: found.target } : {}) });
      return true;
    }
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
      await actor.makeAttackThrow({ attackType: a, skipDialog: skipDialogFor(event) });
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
      return itemRollById(item, rest, { event });
    }
    case "abl": {
      const item = actor.items.get(a);
      if (!item) return false;
      await rollAbility(item, rest, { event });
      return true;
    }
    case "grant": {
      // The whole id names the grant: the proficiency's reference and the throw's key, both already inside it.
      const rolled = await rollGrantedThrow(actor, { id: String(id) }, { event });
      return rolled != null;
    }
    case "post": {
      const item = actor.items.get(a);
      if (!item) return false;
      await item.showChatCard();
      return true;
    }
    default:
      ui.notifications?.warn(frameLoc("rollUnknown"));
      return false;
  }
}
