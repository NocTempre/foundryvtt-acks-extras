/* global game */
/**
 * The Magic tab's data: the system's spell repertoire by level with the
 * slot pair core stores (`system.spells.<n>`), and the per-tradition pools
 * the classes feature derives from the class document (mounted as its
 * strip). Present only for a caster.
 */
import { LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { poolState } from "../../classes/casting.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";

const loc = makeLoc(LANG);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

/** Build the tab's data. */
export function buildMagicTab(actor) {
  const sys = actor.system ?? {};
  const spells = actor.items.filter((i) => i.type === ITEM_TYPE.spell);
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
      max: num(sys.spells?.[n]?.max),
      maxPath: `system.spells.${n}.max`,
      rows: rows.map((spell) => ({
        id: spell.id,
        name: spell.name,
        img: spell.img,
        cast: num(spell.system?.cast),
        memorized: num(spell.system?.memorized),
        line: [spell.system?.class, spell.system?.range, spell.system?.duration].filter(Boolean).join(" · "),
        save: spell.system?.save ?? "",
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
