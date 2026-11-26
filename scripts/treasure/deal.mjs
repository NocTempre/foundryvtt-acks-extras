/* global game, canvas, fromUuid, ui */
/**
 * Dealing treasure letters into a staged pot: the Foundry side of
 * `deal-logic.mjs`. It reads the selected tokens as monster groups, and deals
 * letters through the hoard generator (`hoard.mjs`) into a pot the way Search
 * the fallen stages one (`pot.mjs` `addTruths`), behind the lair warning, with
 * each magic card rolled on the imported item tables first. The
 * pot window (`pot-sheet.mjs`) asks for a deal and supplies `confirmLair`; the
 * monster sheet and the scene control open a pot staged with monster rows
 * (`newDealPot`).
 */
import { acksExtras } from "../namespace.mjs";
import { masterworkFigure } from "../equipment/printed-layers.mjs";
import { keyOfItem } from "../equipment/weapon-rows.mjs";
import { VARIATION_TYPE } from "../lib/constants.mjs";
import { isWorldCopy, libraryDocsWhere } from "../lib/library.mjs";
import * as services from "../lib/services.mjs";
import { citeOf, getDoc, hasDoc } from "../lib/tables.mjs";
import { MAGIC_ITEM_DOC } from "../magic-items/constants.mjs";
import { makeLoc } from "../lib/util.mjs";
import { LANG, MAGIC_ITEM_ROLL_CONTRACT, MODULE_ID } from "./constants.mjs";
import { dealKey, dealLines, dealMessages, groupMonsters, monsterRows, runLetterDeal } from "./deal-logic.mjs";
import { dealHoard } from "./hoard.mjs";
import { armsBases, armsColumns, holdsMagicPlaceholder, isArmsBaseRow, rollMagicTruths } from "./magic-deal-logic.mjs";
import { addTruths, markDealt, newPot, openPot, postTableLine, potOf, truthsFromItem } from "./pot.mjs";

const loc = makeLoc(LANG);

/**
 * The selected monster tokens (a character or any other actor type is skipped),
 * grouped one row per kind of monster. A token's kind is
 * its base actor (`TokenDocument#actorId`), so unlinked tokens of one actor are
 * one row; its letter is read from the token's own actor, whose data an
 * unlinked token may have changed. Empty where no canvas is up.
 * @returns {Array<{actorId: string|null, name: string, count: number, letter: string|null}>}
 */
export function selectedMonsterGroups() {
  const controlled = canvas?.tokens?.controlled ?? [];
  return groupMonsters(
    controlled.filter((token) => token.actor?.type === "monster").map((token) => {
      const actorId = token.document?.actorId ?? token.actor?.id ?? null;
      return {
        actorId,
        name: (actorId && game.actors?.get(actorId)?.name) || token.name || "",
        letter: token.actor?.system?.details?.treasure?.type ?? null,
      };
    }),
  );
}

/**
 * A new pot in staging with one monster row per kind in `groups`, one hoard each,
 * nothing rolled. Without a kind it is the By hand pot
 * `newPot()` makes. Judge-only.
 * @param {Array<{actorId: string|null, name: string, count: number, letter: string|null}>} [groups]
 *   `groupMonsters`' rows; the selected tokens' by default
 * @returns {Promise<Cards|null>}
 */
export function newDealPot(groups = selectedMonsterGroups()) {
  const rows = monsterRows(groups);
  return newPot(rows.length ? { deal: { monsters: rows } } : {});
}

/**
 * Deal treasure letters into a staged pot, once per letter, behind the lair
 * warning. Judge-only. The warning stands unless the pot's "Met in their lair"
 * toggle is set: `confirmLair(warning)` is awaited and the deal runs only on
 * `true`; with no `confirmLair` the deal refuses `lairUnconfirmed` and stages
 * nothing. The pot's deal toggles are honoured; the truths are staged face down.
 * @param {Cards} pile the staged pot
 * @param {object} args
 * @param {Array<string|{letter: string|null}>} args.letters one entry per hoard to deal
 * @param {"classic"|"heroic"|"gritty"} [args.style]
 * @param {boolean} [args.special]
 * @param {(warning: {letters: string[]}) => (boolean|Promise<boolean>)} [args.confirmLair]
 * @returns {Promise<{ok: boolean, reason?: string, dealt?: object[], staged?: string[]}>}
 */
export async function dealLettersIntoPot(pile, { letters, style, special, confirmLair, roller } = {}) {
  const pot = pile ? potOf(pile) : null;
  const outcome = await runLetterDeal({
    isGM: !!game.user?.isGM,
    pot,
    letters,
    confirmLair,
    deal: ({ letter, toggles }) => dealHoard({ letter, style, toggles, special }),
    rollMagic: magicRollerFor({ pot, style, roller }),
    stage: (truths) => addTruths(pile, truths),
  });
  // The list that was dealt is recorded, so a Table-mode Open does not roll it again.
  if (outcome.ok && outcome.staged.length) await markDealt(pile, dealKey({ hand: letters.map((l) => ({ letter: typeof l === "string" ? l : l?.letter })) }));
  return outcome;
}

/**
 * The Judge's client's half of a seat dealing an offered pot (the relay's
 * `deal`): the list is dealt as the Judge's own Deal deals it (unless `resume`,
 * a list already dealt whose open did not land), the pot opens with its
 * offer's doorway kept, and one line is said under `user`'s name. `lair`
 * carries the Judge's confirmation of the lair warning. What a Deal tells a
 * Judge (a table not imported, nothing staged) is told here, on this client.
 * @param {Cards} pile the offered pot
 * @param {User} user the seat that pressed, or the Judge
 * @param {{lair: boolean, resume: boolean}} how
 * @returns {Promise<{ok: boolean, reason?: string, hoards?: number}>}
 */
export async function dealOfferedPot(pile, user, { lair, resume }) {
  const pot = potOf(pile);
  const lines = dealLines(pot.deal);
  if (!resume) {
    const outcome = await dealLettersIntoPot(pile, { letters: lines.map((l) => l.letter), style: pot.deal.style, special: pot.deal.special, confirmLair: lair ? () => true : undefined });
    for (const m of dealMessages(outcome)) ui.notifications?.[m.level](loc(m.key, m.args));
    if (!outcome.ok) return outcome;
  }
  const opened = await openPot(pile, { doorway: false });
  if (!opened.ok) return opened;
  await postTableLine(pile, user, lines.length);
  return { ok: true, hoards: lines.length };
}

/**
 * The magic roll of a pot's deal, bound to the pot's arms column and the deal's
 * style: the `rollMagic` a letter deal (`runLetterDeal`) takes. The pot's own
 * deal and a scene's haul both hand it to their letter deal, so a hoard's magic
 * is rolled one way wherever the hoard is dealt.
 * @param {object} args
 * @param {object|null} args.pot the pot's normalized flag, whose `deal.armsSetting` is the arms column
 * @param {"classic"|"heroic"|"gritty"} [args.style]
 * @param {(expr: string) => {total: number, sides: number}|Promise<{total: number, sides: number}>} [args.roller] dice for the walk; core's by default
 * @returns {(args: {letter: string, truths: object[]}) => Promise<{truths: object[], errors: object[], audit: object[]}>}
 */
export const magicRollerFor = ({ pot, style, roller } = {}) => ({ letter, truths }) => rollMagicCards({ letter, truths, style, roller, armsSetting: pot?.deal.armsSetting ?? "" });

/**
 * One letter's magic placeholders rolled on the imported magic-item tables
 * (`magic-deal-logic.mjs`). The roll is the `magic-item-roll` contract's and
 * the lists a roll may begin at are the magic-items API's `starts()`; with
 * either absent the cards stay placeholders and say so. A rolled item that
 * links to a document is that document, dealt as a dropped item is. Truths that
 * hold no magic placeholder come back as they were, and the library is not read.
 * @param {object} args
 * @param {string} args.letter
 * @param {object[]} args.truths the letter's truths
 * @param {"classic"|"heroic"|"gritty"} [args.style] the deal's style; classic by default, as the hoard is
 * @param {(expr: string) => {total: number, sides: number}|Promise<{total: number, sides: number}>} [args.roller] dice for the walk; core's by default
 * @param {string} [args.armsSetting] the pot's arms column; blank rolls no type, so only a row that names its base is priced
 */
async function rollMagicCards({ letter, truths, style = "classic", roller, armsSetting = "" }) {
  if (!holdsMagicPlaceholder(truths)) return { truths: truths ?? [], errors: [], audit: [] };
  const provider = services.get(MAGIC_ITEM_ROLL_CONTRACT);
  const arms = await armsSeam().catch(() => ({}));
  return rollMagicTruths({
    truths,
    style,
    where: `${letter}.magic`,
    lists: acksExtras.magicItems?.starts?.() ?? null,
    roll: typeof provider?.roll === "function" ? (args) => provider.roll({ ...args, roller }) : null,
    resolve: async (uuid) => {
      const item = await fromUuid(uuid);
      return item ? truthsFromItem(item) : null;
    },
    armsSetting,
    ...arms,
  });
}

/**
 * The arms column choices the deal panel offers, read from the imported
 * magic-item tables: the setting columns of the arms grids (`armsColumns`) and
 * the pages the import recorded for them (the grids' own, joined), or null where
 * it recorded none, or a Judge's override holds the table: the document's whole
 * span is no page for them. With no grid imported there are no columns.
 * @returns {{columns: Array<{key: string, label: string}>, cite: string|null}}
 */
export function armsSource() {
  const doc = hasDoc(MAGIC_ITEM_DOC) ? getDoc(MAGIC_ITEM_DOC) : null;
  const named = doc?.cites?.armsSettings;
  return { columns: armsColumns(doc?.tables ?? null), cite: typeof named === "string" && named && citeOf(MAGIC_ITEM_DOC, "armsSettings") ? named : null };
}

/**
 * What a rolled arm's apparent worth is read from: the bases found by import
 * stamp among the library's own items (no world copy, no template part) and a
 * masterwork tier's added cost, from the equipment feature's imported masterwork
 * documents (absent until imported). Only the minted weapons, the minted armour
 * and the variation documents are read (`libraryDocsWhere`), from the shelves'
 * indexes, so no shelf is loaded whole. The live walk reads it to check the
 * figures a deal stores against their documents.
 * @returns {Promise<{bases: object[], masterwork: (tier: string) => number|null|undefined}>}
 */
export async function armsSeam() {
  const docs = await libraryDocsWhere("Item", (row) => isArmsBaseRow(row) || row.type === VARIATION_TYPE);
  const mints = docs.filter((i) => !isWorldCopy(i) && !i.flags?.[MODULE_ID]?.templatePart && !i.flags?.[MODULE_ID]?.templateFor);
  return { bases: armsBases(mints, keyOfItem), masterwork: (tier) => masterworkFigure(tier, docs)?.costAdd };
}
