/**
 * The summon-spell model: which spells on a character can summon, what each
 * one offers, and how an offer's creature reference becomes an Actor.
 * FOUNDRY-FREE: every lookup that touches the world (`fromUuid`,
 * `fromUuidSync`, `byCookbookId`) is passed in, so the logic runs under Node.
 *
 * It reads the raw spell flag (`flags["acks-extras"].spell`) rather than the
 * `SpellExtras` model, which extends a Foundry class at load. A summon row is
 * an `effects` row of type `summon` in the shared vocabulary; its creature is
 * `ref`, its count `amount`, its Hit Dice `value` (a LevelValue object, passed
 * through unresolved), its `summonFormat` and `control`.
 */
import { MODULE_ID, FLAG_SPELL } from "./constants.mjs";
import { ITEM_TYPE, ACTOR_TYPE } from "../lib/vocab.mjs";
import { cookbookId } from "../lib/library.mjs";

/** The effect-row type a summon is. */
const SUMMON_ROW = "summon";
/** The spell-type word that marks a summoning spell, a key of `SPELL_TYPES`. */
export const SUMMONING_TYPE = "summoning";

/** The raw spell flag of an item, or an empty object. */
const flagOf = (item) => {
  const raw = item?.flags?.[MODULE_ID]?.[FLAG_SPELL];
  return raw && typeof raw === "object" ? raw : {};
};

/** An item's `summon` effect rows; `effects` may arrive as a numeric-keyed object. */
function summonRows(item) {
  const effects = flagOf(item).effects;
  const rows = Array.isArray(effects) ? effects : effects && typeof effects === "object" ? Object.values(effects) : [];
  return rows.filter((row) => row?.type === SUMMON_ROW);
}

/**
 * Whether a spell can summon on a character's behalf: a `spell` item held by
 * an actor of type `character` whose flag carries a `summon` effect row, or
 * whose type words (`schools`, which keeps every word a stat line printed) or
 * primary `type` name the summoning type. A spell on a monster, or on no
 * actor, is never summonable: the cast belongs to a player's character.
 */
export function isSummonSpell(item) {
  if (item?.type !== ITEM_TYPE.spell) return false;
  if (item.parent?.type !== ACTOR_TYPE.character) return false;
  if (summonRows(item).length) return true;
  const flag = flagOf(item);
  const words = [flag.type, ...(Array.isArray(flag.schools) ? flag.schools : [])];
  return words.some((word) => String(word ?? "").trim().toLowerCase() === SUMMONING_TYPE);
}

/**
 * The creatures a summon spell offers, one per `summon` row, as `{ ref,
 * amount, value, summonFormat, control }`. The rows come from the spell's own
 * flag; a spell with none of its own (a copy that lost them) reads its
 * library `twin`'s. An empty array means the spell names no creature, which
 * the caller reads as "pick from the open shelf".
 *
 * @param {object} spell
 * @param {{twin?: object|null}} [options]
 */
export function summonOptionsOf(spell, { twin = null } = {}) {
  let rows = summonRows(spell);
  if (!rows.length && twin) rows = summonRows(twin);
  return rows.map((row) => ({
    ref: String(row.ref ?? "").trim(),
    amount: Number(row.amount) || 0,
    value: row.value ?? null,
    summonFormat: row.summonFormat ?? "",
    control: row.control ?? "",
  }));
}

/**
 * The library document an embedded spell was copied from: the one carrying its
 * cookbook stamp id (`byCookbookId("Item", id)`), else the document its
 * `_stats.compendiumSource` names. Null when neither answers, or when the
 * answer would be the spell itself.
 *
 * @param {object} spell
 * @param {{byCookbookId: (type: string, id: string) => object|null, fromUuidSync: (uuid: string) => object|null}} lookups
 */
export function libraryTwin(spell, { byCookbookId, fromUuidSync }) {
  const id = cookbookId(spell);
  let twin = id ? byCookbookId("Item", id) : null;
  if (!twin) {
    const source = spell?._stats?.compendiumSource;
    if (source) {
      try {
        twin = fromUuidSync(source);
      } catch {
        twin = null;
      }
    }
  }
  return twin && twin !== spell ? twin : null;
}

/**
 * The Actor a summon row's `ref` names: a uuid (a `uuid:` prefix is dropped)
 * first, else a cookbook id on the Actor shelf, else null. A uuid that names
 * something other than an Actor, or that the world cannot parse, falls through
 * to the cookbook lookup.
 *
 * @param {string} ref
 * @param {{fromUuid: (uuid: string) => Promise<object|null>, byCookbookId: (type: string, id: string) => object|null}} lookups
 * @returns {Promise<object|null>}
 */
export async function resolveSummonRef(ref, { fromUuid, byCookbookId }) {
  let key = String(ref ?? "").trim();
  if (key.startsWith("uuid:")) key = key.slice(5);
  if (!key) return null;
  try {
    const doc = await fromUuid(key);
    if (doc && (doc.documentName ?? "Actor") === "Actor") return doc;
  } catch {
    // an id that is no uuid: the cookbook lookup below answers for it
  }
  return byCookbookId("Actor", key) ?? null;
}
