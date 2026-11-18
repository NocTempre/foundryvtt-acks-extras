/* global game, canvas */
/**
 * Dealing treasure letters into a staged pot: the Foundry side of
 * `deal-logic.mjs`. It reads the selected tokens as monster groups, and deals
 * letters through the hoard generator (`hoard.mjs`) into a pot the way Search
 * the fallen stages one (`pot.mjs` `addTruths`), behind the lair warning. The
 * pot window (`pot-sheet.mjs`) asks for a deal and supplies `confirmLair`; the
 * monster sheet and the scene control open a pot staged with monster rows
 * (`newDealPot`).
 */
import { groupMonsters, monsterRows, runLetterDeal } from "./deal-logic.mjs";
import { dealHoard } from "./hoard.mjs";
import { addTruths, newPot, potOf } from "./pot.mjs";

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
 * A new pot in staging with one monster row per kind in `groups`, a kind with a
 * letter ticked, nothing rolled. Without a kind it is the By hand pot
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
export function dealLettersIntoPot(pile, { letters, style, special, confirmLair } = {}) {
  return runLetterDeal({
    isGM: !!game.user?.isGM,
    pot: pile ? potOf(pile) : null,
    letters,
    confirmLair,
    deal: ({ letter, toggles }) => dealHoard({ letter, style, toggles, special }),
    stage: (truths) => addTruths(pile, truths),
  });
}
