/* global game */
/**
 * Who a monster hireling answers to. Core's roster refuses a non-character, so
 * a monster's employment is held in three places that must agree: the
 * employer's `FLAG_MONSTER_LIST`, the monster's `retainer.managerid`, and the
 * `employerUuid` of its record. `assignMonsterEmployer` is the one writer of
 * all of them for a monster changing hands.
 */
import { MODULE_ID, FLAG_RECORD, FLAG_MONSTER_LIST } from "../constants.mjs";
import * as adapter from "../acks-adapter.mjs";

/**
 * Put a monster hireling under `employer`: off every other actor's monster
 * list, on this one's, `managerid` and the record's `employerUuid` pointed at
 * it. Idempotent: a write is made only where the stored value differs. The
 * callers announce the roster change, once for `employer` and once for each
 * actor returned in `previous`.
 * @param {Actor} monster the hireling
 * @param {Actor} employer the employer it now serves
 * @returns {Promise<{previous: Actor[]}>} the actors whose monster lists held it
 */
export async function assignMonsterEmployer(monster, employer) {
  const previous = [];
  for (const other of game.actors.contents) {
    if (other.id === employer.id) continue;
    const held = other.getFlag(MODULE_ID, FLAG_MONSTER_LIST);
    if (!Array.isArray(held) || !held.includes(monster.id)) continue;
    await other.setFlag(MODULE_ID, FLAG_MONSTER_LIST, held.filter((id) => id !== monster.id));
    previous.push(other);
  }
  const list = employer.getFlag(MODULE_ID, FLAG_MONSTER_LIST) ?? [];
  if (!list.includes(monster.id)) await employer.setFlag(MODULE_ID, FLAG_MONSTER_LIST, [...list, monster.id]);
  if (adapter.getRetainer(monster).managerid !== employer.id) await adapter.setRetainer(monster, { managerid: employer.id });
  const record = monster.getFlag(MODULE_ID, FLAG_RECORD);
  if (record && record.employerUuid !== employer.uuid) await monster.setFlag(MODULE_ID, FLAG_RECORD, { ...record, employerUuid: employer.uuid });
  return { previous };
}
