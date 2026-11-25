/* global game */
/**
 * The Magic tab's data: the system's spell repertoire by level with the
 * slot pair core stores (`system.spells.<n>`), and the per-tradition pools
 * the classes feature derives from the class document (mounted as its
 * strip). Present only for a caster. A summoning spell's row also carries how
 * many of its creatures stand on the scene the party cell counts on, and how
 * many of those ride in a party (`summonRowOf`), and any
 * spell's row carries a cast declared in a fight and still waiting for the
 * caster's turn (`declaredRowOf`).
 */
import { LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { poolState } from "../../classes/casting.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { isSummonSpell } from "../../magic/summon-spell.mjs";
import { spellEffectOf } from "../../magic/spell-effect.mjs";
import { declarationShown, fightPhrase } from "../../magic/declared-fight.mjs";
import { storedSystem, standingBySpell } from "../view-model.mjs";
import { summonsOnScene, currentScene } from "../snapshot.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/**
 * What a spell's row shows of a cast declared in a fight and waiting for the
 * caster's turn: the tag, the line under the name and the tag's tooltip. The
 * fight is named where one answers (its scene, and the round declared in where
 * the record holds one) and left out where none does; a summoning is placed at
 * the turn and any other spell is cast. There is no control to withdraw it: the
 * row only reads. Null where the spell has no declaration standing.
 *
 * @param {object[]} records  the caster's spell records, as `spellEffectOf` reads them
 * @param {{uuid: string, name: string}} spell
 * @param {{name: string, combatOf: (id: string) => object|null}} from  the caster's name and the fight lookup
 * @returns {{tag: string, line: string, tip: string}|null}
 */
export function declaredRowOf(records, spell, { name, combatOf }) {
  const shown = declarationShown(records, spell.uuid, { combatOf });
  if (!shown) return null;
  const fight = fightPhrase(shown.fight, (key, data) => game.i18n.format(`ACKS-MAGIC.cast.dialog.${key}`, data));
  const tipKey = `${isSummonSpell(spell) ? "declaredTip" : "declaredTipCast"}${fight ? "" : "NoFight"}`;
  return {
    tag: loc("magic.declared"),
    line: loc(fight ? "magic.declaredLine" : "magic.declaredLineNoFight", { fight, name }),
    tip: loc(`magic.${tipKey}`, { spell: spell.name, fight, name }),
  };
}

/**
 * What a summoning spell's row shows of the creatures it left standing: the
 * count, its label, the count's tooltip and, where some ride in a party, a
 * second figure for them. The tooltip names the scene the creatures stand on,
 * or the party where every one of them is held in one; the joined figure names
 * the parties (an entry's `party`, `summonsOnScene`). Where none is held,
 * `joined` is null.
 *
 * @param {{party?: {name?: string}|null}[]} entries  the spell's `summonsOnScene` entries
 * @param {{scene: {name?: string}|null}} from  the scene the row is read on
 * @returns {{standing: number, label: string, tip: string, joined: {n: number, label: string, tip: string}|null}}
 */
export function summonRowOf(entries, { scene }) {
  const n = entries.length;
  const held = entries.filter((e) => e.party);
  const party = [...new Set(held.map((e) => e.party.name).filter(Boolean))].join(", ");
  const tip = held.length === n && n > 0 ? loc("magic.standingTipParty", { n, party }) : loc("magic.standingTip", { n, scene: scene?.name ?? "—" });
  return {
    standing: n,
    label: loc("magic.standing", { n }),
    tip,
    joined: held.length ? { n: held.length, label: loc("magic.joined", { n: held.length, party }), tip: loc("magic.standingTipParty", { n: held.length, party }) } : null,
  };
}

/** Build the tab's data. */
export function buildMagicTab(actor) {
  const sys = actor.system ?? {};
  // The slot maximum is an input: it renders the stored value, which a submit writes back.
  const stored = storedSystem(actor);
  const spells = actor.items.filter((i) => i.type === ITEM_TYPE.spell);
  const scene = currentScene();
  const standing = standingBySpell(summonsOnScene(actor, scene));
  const summonOf = (spell) => {
    if (!isSummonSpell(spell)) return null;
    return summonRowOf(standing.get(spell.id) ?? [], { scene });
  };
  const records = [...(actor.effects ?? [])].map((effect) => spellEffectOf(effect)).filter((record) => record?.pending);
  const combatOf = (id) => (id ? (game.combats?.get(id) ?? null) : null);
  const byLevel = new Map();
  for (const spell of spells) {
    const lvl = Math.max(0, num(spell.system?.lvl));
    if (!byLevel.has(lvl)) byLevel.set(lvl, []);
    byLevel.get(lvl).push(spell);
  }
  const levels = [...byLevel.keys()].sort((a, b) => a - b).map((n) => {
    const rows = byLevel.get(n).sort((a, b) => a.name.localeCompare(b.name));
    const used = rows.reduce((s, r) => s + num(r.system?.cast), 0);
    return {
      n,
      used,
      max: num(stored.spells?.[n]?.max),
      maxPath: `system.spells.${n}.max`,
      rows: rows.map((spell) => ({
        id: spell.id,
        name: spell.name,
        img: spell.img,
        cast: num(spell.system?.cast),
        memorized: num(spell.system?.memorized),
        line: [spell.system?.class, spell.system?.range, spell.system?.duration].filter(Boolean).join(" · "),
        save: spell.system?.save ?? "",
        summon: summonOf(spell),
        declared: declaredRowOf(records, spell, { name: actor.name, combatOf }),
      })),
    };
  });
  const pools = poolState(actor);
  return {
    enabled: !!sys.spells?.enabled || pools.length > 0,
    levels,
    hasSpells: spells.length > 0,
    pools: pools.length,
    editable: actor.isOwner,
    emptyHint: loc("magic.empty"),
    resetLabel: game.i18n.localize("ACKS.spells.ResetSlots"),
  };
}
