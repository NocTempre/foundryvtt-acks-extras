/* global game, canvas, fromUuid */
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
import { isWorldCopy, libraryItems, whenReady } from "../lib/library.mjs";
import * as services from "../lib/services.mjs";
import { citeOf, getDoc, hasDoc } from "../lib/tables.mjs";
import { MAGIC_ITEM_DOC } from "../magic-items/constants.mjs";
import { MAGIC_ITEM_ROLL_CONTRACT, MODULE_ID } from "./constants.mjs";
import { groupMonsters, monsterRows, runLetterDeal } from "./deal-logic.mjs";
import { dealHoard } from "./hoard.mjs";
import { armsBases, armsColumns, rollMagicTruths } from "./magic-deal-logic.mjs";
import { addTruths, newPot, potOf, truthsFromItem } from "./pot.mjs";

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
export function dealLettersIntoPot(pile, { letters, style, special, confirmLair, roller } = {}) {
  const pot = pile ? potOf(pile) : null;
  return runLetterDeal({
    isGM: !!game.user?.isGM,
    pot,
    letters,
    confirmLair,
    deal: ({ letter, toggles }) => dealHoard({ letter, style, toggles, special }),
    rollMagic: magicRollerFor({ pot, style, roller }),
    stage: (truths) => addTruths(pile, truths),
  });
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
 * links to a document is that document, dealt as a dropped item is.
 * @param {object} args
 * @param {string} args.letter
 * @param {object[]} args.truths the letter's truths
 * @param {"classic"|"heroic"|"gritty"} [args.style] the deal's style; classic by default, as the hoard is
 * @param {(expr: string) => {total: number, sides: number}|Promise<{total: number, sides: number}>} [args.roller] dice for the walk; core's by default
 * @param {string} [args.armsSetting] the pot's arms column; blank rolls no type, so only a row that names its base is priced
 */
async function rollMagicCards({ letter, truths, style = "classic", roller, armsSetting = "" }) {
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
 * What a rolled arm's apparent worth is read from, once the library is warm: the
 * bases found by import stamp among the library's own items (no world copy, no
 * template part) and a masterwork tier's added cost, from the equipment
 * feature's imported masterwork documents (absent until imported). The live walk
 * reads it to check the figures a deal stores against their documents.
 * @returns {Promise<{bases: object[], masterwork: (tier: string) => number|null|undefined}>}
 */
export async function armsSeam() {
  await whenReady();
  const mints = libraryItems().filter((i) => !isWorldCopy(i) && !i.flags?.[MODULE_ID]?.templatePart && !i.flags?.[MODULE_ID]?.templateFor);
  return { bases: armsBases(mints, keyOfItem), masterwork: (tier) => masterworkFigure(tier)?.costAdd };
}
