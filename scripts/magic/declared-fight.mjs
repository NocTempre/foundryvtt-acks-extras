/**
 * The fight a declared cast waits in, as the words that name it need it, and
 * which pending declaration a spell's row shows. FOUNDRY-FREE: the fight is read
 * by the caller's lookup and passed in.
 *
 * A fight is named by its scene where it has one, by a plain "no scene" where it
 * has none, and by nothing where no fight answers its id (the record outlived
 * it); the round it was declared in is added where the record holds one. A record
 * written before `declaredRound` was stored reads without a round.
 */

/**
 * The parts of a declared cast's fight name.
 *
 * @typedef {object} FightParts
 * @property {"scene"|"noScene"|"gone"} state  the fight has a scene, has none, or no fight answers its id
 * @property {string} scene  the scene's name; blank unless `state` is `scene`
 * @property {number|null} round  the round the cast was declared in; null where it is not known
 */

/** A round a fight counts: a whole number from one up; anything else is not known. */
const roundOf = (value) => (Number.isInteger(value) && value >= 1 ? value : null);

/**
 * The parts that name the fight a declaration was made in. Pure.
 *
 * @param {{combatId?: string|null, declaredRound?: number|null}} declared  the pending record's fight and the round it was declared in
 * @param {{combatOf: (id: string) => ({scene?: {name?: string, navName?: string}|null}|null)}} lookups  `combatOf` answers the fight document for an id, or null where none stands
 * @returns {FightParts}
 */
export function declaredFightOf({ combatId = null, declaredRound = null } = {}, { combatOf }) {
  const round = roundOf(declaredRound);
  const combat = combatOf(combatId) ?? null;
  if (!combat) return { state: "gone", scene: "", round };
  // The scene is named as core's navigation bar names it to every seat: its navigation name where it has one, else its name.
  const scene = String(combat.scene?.navName || combat.scene?.name || "").trim();
  return scene ? { state: "scene", scene, round } : { state: "noScene", scene: "", round };
}

/**
 * The fight as a phrase, in one lang string for each of its four shapes so a
 * translation reads whole: the scene or its absence, with the round where known.
 * An empty string where no fight answers. Pure.
 *
 * @param {FightParts|null|undefined} parts
 * @param {(key: "fightOn"|"fightOnRound"|"fightNoScene"|"fightNoSceneRound", data: object) => string} say  formats the dialog's lang key of that name
 * @returns {string}
 */
export function fightPhrase(parts, say) {
  if (!parts || parts.state === "gone") return "";
  const round = parts.round != null;
  if (parts.state === "scene") return say(round ? "fightOnRound" : "fightOn", { scene: parts.scene, round: parts.round ?? "" });
  return say(round ? "fightNoSceneRound" : "fightNoScene", { round: parts.round ?? "" });
}

/**
 * The declaration a spell's row shows: of the caster's records, the spell's
 * latest pending one that is not lost, with the parts that name its fight; null
 * where there is none. A declaration that lapsed is not read from the round: the
 * primary GM's client deletes its records when the caster's turn that reaches its
 * lapse round ends, so a record that stands waits for the turn, and one whose
 * fight is gone is shown naming no fight. Pure.
 *
 * @param {Array<{pending?: {spellUuid: string, combatId?: string, declaredRound?: number, at?: number, lost?: object}}>} records  the caster's records, as `spellEffectOf` reads them
 * @param {string} spellUuid
 * @param {{combatOf: (id: string) => object|null}} lookups
 * @returns {{record: object, fight: FightParts}|null}
 */
export function declarationShown(records, spellUuid, { combatOf }) {
  const standing = (records ?? [])
    .filter((r) => r?.pending && r.pending.spellUuid === spellUuid && !r.pending.lost)
    .sort((a, b) => (Number(b.pending.at) || 0) - (Number(a.pending.at) || 0));
  const record = standing[0];
  return record ? { record, fight: declaredFightOf({ combatId: record.pending.combatId, declaredRound: record.pending.declaredRound }, { combatOf }) } : null;
}
