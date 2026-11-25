/* global game */
/**
 * The light spells a seat can cast from a list of casters, each offered by the
 * Magic tab's own reading: the list it stands under, that list's slots at its
 * level and the sentence a list raises against the cast. `lightOffers` is pure,
 * every world read injected so plain objects test it; `lightOffersFor` binds the
 * live readers. A spell is offered once for each list it stands under on the
 * caster (once with no list where the class casts from none), so one spell
 * under two lists is two offers with two keys.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { canCastNow } from "./repertoire.mjs";

/** The effect rows a spell carries in its flag. */
const effectRowsOf = (spell) => spell?.flags?.[MODULE_ID]?.[FLAG_SPELL]?.effects ?? [];

/** Whether a spell has a light row of its own form: the reverse form's rows belong to the reverse, and a cast of this form never writes them. */
export const hasLightRow = (spell) => effectRowsOf(spell).some((row) => row?.type === "light" && !row.reversed);

/**
 * Every place a spell stands on a caster, as the Magic tab draws it: `entry` is
 * the `spellStanding` appearance, `tradition` the key of the list it stands
 * under ("" in levels mode and under "Other spells"), `listLabel` that list's
 * name ("" with none), and `level` and `slot` where it stands and the slot row
 * there (null where the list keeps none; in levels mode core's grid, null where
 * it holds no maximum).
 */
function appearancesOf(stands) {
  const out = [];
  for (const l of stands.levels ?? []) {
    const slot = Number.isFinite(l.max) && l.max > 0 ? { used: l.used, max: l.max } : null;
    for (const entry of l.spells) out.push({ entry, tradition: "", listLabel: "", level: l.level, slot });
  }
  for (const g of stands.groups ?? []) {
    for (const l of g.levels) for (const entry of l.spells) out.push({ entry, tradition: g.key, listLabel: g.label, level: l.level, slot: l.slot });
  }
  for (const l of stands.other ?? []) {
    for (const entry of l.spells) out.push({ entry, tradition: "", listLabel: "", level: l.level, slot: null });
  }
  return out;
}

/**
 * The light spells a seat is offered. A caster is the seat's own where
 * `isOwner` holds (Foundry's ownership; a GM owns every actor, which a plain
 * object does not say, so `isGM` stands for it); each spell it carries with a
 * light effect row of its own form that it can cast now is offered once for
 * each list it stands under. Where the spell is on none of the lists the class
 * casts from, or the list has no slot left at its level, `refusal` is the
 * Magic tab's gate sentence: `blocked` is true for a seat that is not a GM (the
 * cast stays off) and false for a GM (warned, casting anyway). Sorted by
 * caster name, spell name, then list label.
 *
 * @param {object} from
 * @param {object[]} from.casters  actors: `{id, name, isOwner, items}`
 * @param {boolean} from.isGM
 * @param {(actor: object, seat: {isGM: boolean}) => object} from.standingOf  `magicStanding`
 * @param {(standing: object, entry: object, at: {level: number, slot: object|null}) => {list: {text: string, tip: string}, slots: {text: string, tip: string}|null}} from.lineOf  `standingLineOf`
 * @param {(actor: object, spell: object, from: {standing: object, tradition: string}) => boolean} from.castable  whether the caster can cast the spell under that list now
 * @param {(key: string, data: object) => string} from.format  localizes a full lang key
 * @returns {{key: string, actorId: string, itemId: string, tradition: string, label: string, line: string, listText: string, listTip: string, slotsText: string, slotsTip: string, refusal: string, blocked: boolean}[]}
 */
export function lightOffers({ casters, isGM, standingOf, lineOf, castable, format }) {
  const offers = [];
  for (const actor of casters ?? []) {
    if (!isGM && actor?.isOwner !== true) continue;
    const spells = [...(actor.items ?? [])].filter(hasLightRow);
    if (!spells.length) continue;
    const standing = standingOf(actor, { isGM });
    for (const at of appearancesOf(standing.stands)) {
      const spell = at.entry.ref;
      if (!spells.includes(spell) || !castable(actor, spell, { standing, tradition: at.tradition })) continue;
      const { list, slots } = lineOf(standing, at.entry, { level: at.level, slot: at.slot });
      // With no list the line reads the spell's own level and core's slot grid, whose tooltips the tab does not carry:
      // the level points at the spell's page, and the slots name the sheet count they are read from.
      const cite = String(spell.flags?.[MODULE_ID]?.[FLAG_SPELL]?.cite ?? "");
      const listTip = list.tip || cite;
      const slotsTip = slots ? slots.tip || format("ACKS-FORMATION.app.lightCastSlotsCore", { used: slots.used, max: slots.max, caster: actor.name, level: at.level }) : "";
      const gate = standing.gateFor(at.entry, at.tradition || null);
      const data = { spell: spell.name, caster: actor.name, tradition: at.listLabel };
      offers.push({
        order: [actor.name, spell.name, at.listLabel],
        offer: {
          key: `${actor.id}|${spell.id}|${at.tradition}`,
          actorId: actor.id,
          itemId: spell.id,
          tradition: at.tradition,
          label: format(`ACKS-FORMATION.app.${at.listLabel ? "lightCastOption" : "lightCastOptionBare"}`, data),
          line: [list.text, slots?.text].filter(Boolean).join(" · "),
          listText: list.text,
          listTip,
          slotsText: slots?.text ?? "",
          slotsTip,
          refusal: gate?.text ?? "",
          blocked: gate?.blocked === true,
        },
      });
    }
  }
  const same = (a, b) => String(a ?? "").localeCompare(String(b ?? ""));
  return offers.sort((a, b) => same(a.order[0], b.order[0]) || same(a.order[1], b.order[1]) || same(a.order[2], b.order[2])).map(({ offer }) => offer);
}

/**
 * `lightOffers` read from the live world: the viewing seat's own GM flag, the
 * Magic tab's reading (`magicStanding`, `standingLineOf`) and the cast's own
 * (`castReading`, answered by the register's `canCastNow`, or off list, which
 * the gate sentence then names). The caller passes the member actors.
 *
 * @param {object[]} actors
 * @returns {ReturnType<typeof lightOffers>}
 */
export async function lightOffersFor(actors) {
  const [{ magicStanding, standingLineOf }, { castReading }] = await Promise.all([import("../character-sheet/tabs/magic.mjs"), import("./cast-spell.mjs")]);
  return lightOffers({
    casters: actors,
    isGM: game.user?.isGM === true,
    standingOf: magicStanding,
    lineOf: standingLineOf,
    castable: (actor, spell, { standing, tradition }) => {
      const reading = castReading(actor, spell, { classItem: standing.classItem, pools: standing.pools, tradition: tradition || null });
      return reading.offList || canCastNow(reading, actor.system?.spells?.enabled === true);
    },
    format: (key, data) => game.i18n.format(key, data),
  });
}
