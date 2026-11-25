/* global game */
/**
 * The Magic tab's data. Where the bound class casts from a list, the spells
 * stand under a heading per list with that list's slot row per level
 * (`spellStanding`), and the rest under "Other spells"; otherwise the system's
 * spell repertoire by level with the slot pair core stores
 * (`system.spells.<n>`). One row builder serves both. The pools are the
 * classes feature's, derived from the class document; the rest control and the
 * power section stay on the strip it mounts. Present only for a caster. A summoning spell's row also carries how
 * many of its creatures stand on the scene the party cell counts on, and how
 * many of those ride in a party (`summonRowOf`), and any
 * spell's row carries a cast declared in a fight and still waiting for the
 * caster's turn (`declaredRowOf`).
 */
import { LANG } from "../constants.mjs";
import { makeLoc } from "../../lib/util.mjs";
import { poolState } from "../../classes/casting.mjs";
import { classForActor } from "../../classes/registry.mjs";
import { LANG_PREFIX as CLASSES_LANG } from "../../classes/constants.mjs";
import { MODULE_ID, FLAG_SPELL, LANG_PREFIX as MAGIC_LANG } from "../../magic/constants.mjs";
import { spellStanding, spellCapacity } from "../../magic/cast-capacity.mjs";
import { listGate } from "../../magic/cast-plan.mjs";
import { ITEM_TYPE } from "../../lib/vocab.mjs";
import { isSummonSpell } from "../../magic/summon-spell.mjs";
import { spellEffectOf } from "../../magic/spell-effect.mjs";
import { declarationShown, fightPhrase } from "../../magic/declared-fight.mjs";
import { storedSystem, standingBySpell } from "../view-model.mjs";
import { summonsOnScene, currentScene } from "../snapshot.mjs";

const loc = makeLoc(LANG);
const classesLoc = makeLoc(CLASSES_LANG);
const castLoc = makeLoc(`${MAGIC_LANG}.cast`);
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

/**
 * The words of a spell row's lists line and its tooltip, from one appearance
 * `spellStanding` gave: under a heading, its own list then "also" the others;
 * under "Other spells", every list it names. Null where the spell names none.
 * The tooltip says where the lists were read from: the spell flag's own
 * citation, the flag with none, or core's class field where the flag lists none.
 *
 * @param {{lists: {label: string, level: number|null, fromClass: boolean}[], own: object|null, also: object[]}} entry
 * @param {string} cite  the spell flag's `cite`
 * @returns {{text: string, tip: string}|null}
 */
export function listsLineOf(entry, cite = "") {
  if (!entry.lists.length) return null;
  const shown = (l) => (l.level == null ? l.label : `${l.label} ${l.level}`);
  const text = entry.own
    ? [shown(entry.own), entry.also.length ? loc("magic.listsAlso", { lists: entry.also.map(shown).join(", ") }) : ""].filter(Boolean).join(" · ")
    : entry.lists.map(shown).join(" · ");
  const tip = entry.lists.every((l) => l.fromClass) ? loc("magic.listsTipClass") : cite ? loc("magic.listsTipCite", { cite }) : loc("magic.listsTip");
  return { text, tip };
}

/**
 * The hand pips of one slot row, one per slot: the first `used` filled, each
 * named for a keyboard and a screen reader (give back for a filled one, spend
 * for an empty one) and carrying the slot key the write takes.
 *
 * @param {{used: number, max: number}} slot
 * @param {{label: string, level: number}} of  the list's label and the spell level
 * @returns {{slot: string, spent: boolean, label: string}[]}
 */
export function pipsOf({ used, max }, { label, level }) {
  return Array.from({ length: Math.max(0, max) }, (_, i) => ({
    slot: `s${level}`,
    spent: i < used,
    label: classesLoc(i < used ? "casting.pipGive" : "casting.pipSpend", { list: label, level }),
  }));
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
  const classItem = classForActor(actor);
  const classLevel = Math.max(1, Number(sys.details?.level) || 1);
  const cite = classItem?.system?.source?.cite || "";
  const pools = poolState(actor);
  const stands = spellStanding({
    casting: classItem?.system?.casting ?? [],
    pools,
    spells: spells.map((spell) => ({
      ref: spell,
      name: spell.name,
      lvl: spell.system?.lvl,
      class: spell.system?.class,
      cast: spell.system?.cast,
      extras: spell.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {},
    })),
    coreSpells: stored.spells,
  });
  const casting = classItem?.system?.casting ?? [];
  const castsAt = (level) => spells.filter((s) => Number(s.system?.lvl) === level).reduce((sum, s) => sum + (Number(s.system?.cast) || 0), 0);
  const isGM = game.user?.isGM === true;
  /**
   * What a list raises against this row's cast before the press: the spell is
   * on no list the class casts from, or the list the row stands under has no
   * slot left at the row's level. The reading is the cast's own
   * (`spellCapacity`) and the verdict is `listGate`'s, which the gate claimant
   * judges with too. A seat that is not a GM is blocked and a GM warned. Null
   * where nothing stands in the way, and where no list's slot row answers.
   */
  const gateOf = (entry, tradition) => {
    const spell = entry.ref;
    const { offList, capacity } = spellCapacity({
      casting,
      pools,
      coreSpells: sys.spells,
      castsAt,
      spell: { extras: spell.flags?.[MODULE_ID]?.[FLAG_SPELL] ?? {}, lvl: spell.system?.lvl, class: spell.system?.class },
      prefer: tradition,
    });
    const found = listGate({ capacity, offList, isGM });
    if (!found) return null;
    const blocked = found.severity === "block";
    return { key: found.key, blocked, text: castLoc(`notice.${blocked ? "blocked" : "verdict"}.${found.key}`) };
  };
  /**
   * One spell row, for either mode: `entry` is what `spellStanding` gave for its
   * appearance and `tradition` the key of the list it stands under (none under
   * "Other spells" and in levels mode). A row carries a gate only where the class
   * casts from lists, and a spell with a cast declared and waiting is exempt: its
   * slot was spent at the declaring.
   */
  const rowOf = (entry, tradition = null) => {
    const spell = entry.ref;
    const lists = entry.lists ? listsLineOf(entry, spell.flags?.[MODULE_ID]?.[FLAG_SPELL]?.cite ?? "") : null;
    const declared = declaredRowOf(records, spell, { name: actor.name, combatOf });
    return {
      id: spell.id,
      name: spell.name,
      img: spell.img,
      cast: num(spell.system?.cast),
      memorized: num(spell.system?.memorized),
      // The lists line names the list and its level, so the row line drops core's class string where one is drawn.
      line: [lists ? "" : spell.system?.class, spell.system?.range, spell.system?.duration].filter(Boolean).join(" · "),
      save: spell.system?.save ?? "",
      summon: summonOf(spell),
      declared,
      lists,
      offList: entry.offList === true,
      tradition: tradition ?? "",
      gate: entry.lists && !declared ? gateOf(entry, tradition) : null,
      countTip: loc("magic.castTip", { spell: spell.name }),
    };
  };
  const provenance = (stem, data) => (cite ? loc(`magic.${stem}Cite`, { ...data, cite }) : loc(`magic.${stem}`, data));
  const className = classItem?.name ?? "";
  return {
    enabled: !!sys.spells?.enabled || pools.length > 0,
    mode: stands.mode,
    byList: stands.mode === "lists",
    levels: stands.levels.map((l) => ({
      n: l.level,
      used: l.used,
      max: l.max,
      maxPath: `system.spells.${l.level}.max`,
      rows: l.spells.map((entry) => rowOf(entry)),
    })),
    groups: stands.groups.map((g) => ({
      key: g.key,
      label: g.label,
      className,
      kind: g.kind,
      note: g.note,
      noteTip: g.note ? provenance("ladderTip", { class: className, level: classLevel }) : "",
      points: g.pool
        ? { used: g.pool.used, max: g.pool.max, tip: provenance("poolTip", { used: g.pool.used, max: g.pool.max, class: className, level: classLevel }) }
        : null,
      levels: g.levels.map((l) => ({
        n: l.level,
        rows: l.spells.map((entry) => rowOf(entry, g.key)),
        slot: l.slot
          ? {
              used: l.slot.used,
              max: l.slot.max,
              tip: provenance("slotsTip", { used: l.slot.used, max: l.slot.max, class: className, level: classLevel }),
              pips: pipsOf(l.slot, { label: g.label, level: l.level }),
              groupLabel: classesLoc("casting.pipsGroup", { list: g.label, level: l.level }),
            }
          : null,
      })),
    })),
    other: stands.other.map((l) => ({ n: l.level, rows: l.spells.map((entry) => rowOf(entry)) })),
    hasSpells: spells.length > 0,
    pools: pools.length,
    editable: actor.isOwner,
    emptyHint: loc("magic.empty"),
    resetLabel: game.i18n.localize("ACKS.spells.ResetSlots"),
  };
}
