/**
 * The apparent-identity mask, as plain data: which fields a disguise
 * overwrites, which it captures as the truth, and which a reveal puts back.
 * No Foundry in reach, so an item's source data (`item.toObject()`) can be
 * dressed before the document exists, and one set of field rules serves the
 * writers (`actions.mjs` `disguiseItem` / `revealItem`) and the callers that
 * mask an item as they create it.
 *
 * The mask is not a security boundary: the flag rides on the item. It hides the
 * truth from the sheet and nothing else. The weight is never masked, so the
 * item stays carryable.
 */
import { MODULE_ID, ITEM_FLAGS } from "./constants.mjs";
import { damageFormulaOf } from "./properties.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";

/** An apparent field was given: neither absent nor blank. */
const given = (v) => v != null && v !== "";

/**
 * What an item-shaped value (a document or its source data) truly is, in the
 * six fields a disguise can mask.
 * @param {object} item
 * @returns {{name:string, img:string, cost:number, damage:string, ac:number, description:string}}
 */
export function trueIdentityOf(item) {
  return {
    name: item.name,
    img: item.img,
    cost: Number(item.system?.cost ?? 0),
    damage: damageFormulaOf(item),
    ac: Number(item.system?.ac?.value ?? 0),
    description: item.system?.description ?? "",
  };
}

/**
 * The update, as dotted paths, that makes an item of `type` wear `apparent`.
 * The name is always masked (it falls back to the truth's own); a weapon takes
 * a damage formula and armour an AC only where the apparent identity gives one.
 * `revealPatch` mirrors these guards.
 * @param {string} type the item's document type
 * @param {{name?,img?,cost?,damage?,ac?,description?}} apparent
 * @param {{name:string}} truth the captured true identity
 * @returns {Object<string, *>}
 */
export function disguisePatch(type, apparent, truth) {
  const update = { name: apparent.name ?? truth.name };
  if (apparent.img) update.img = apparent.img;
  if (given(apparent.cost)) update["system.cost"] = Number(apparent.cost);
  if (type === ITEM_TYPE.weapon && given(apparent.damage)) update["system.damage.base.formula"] = apparent.damage;
  if (type === ITEM_TYPE.armor && given(apparent.ac)) update["system.ac.value"] = Number(apparent.ac);
  if (apparent.description != null) update["system.description"] = apparent.description;
  return update;
}

/**
 * The update, as dotted paths, that restores the fields a stored disguise
 * actually masked. A field the disguise never wrote still holds the owner's
 * later edits, which are the newer truth, so each guard is `disguisePatch`'s
 * against the stored `apparent`. The name is always masked, so it always
 * comes back.
 * @param {string} type the item's document type
 * @param {{true:object, apparent?:object}} disguise the stored flag
 * @returns {Object<string, *>}
 */
export function revealPatch(type, disguise) {
  const t = disguise.true;
  const ap = disguise.apparent ?? {};
  const update = { name: t.name };
  if (ap.img) update.img = t.img;
  if (given(ap.cost)) update["system.cost"] = t.cost;
  if (type === ITEM_TYPE.weapon && given(ap.damage)) update["system.damage.base.formula"] = t.damage;
  if (type === ITEM_TYPE.armor && given(ap.ac)) update["system.ac.value"] = t.ac;
  if (ap.description != null) update["system.description"] = t.description;
  return update;
}

/** Write `value` at a dotted `path`, creating the objects on the way. */
function setAt(obj, path, value) {
  const keys = path.split(".");
  let at = obj;
  for (const key of keys.slice(0, -1)) {
    if (at[key] == null || typeof at[key] !== "object") at[key] = {};
    at = at[key];
  }
  at[keys.at(-1)] = value;
}

/**
 * A copy of an item's source data wearing an apparent identity: the masked
 * fields overwritten from `apparent`, and the truth stored at
 * `flags["acks-extras"][ITEM_FLAGS.DISGUISE]` as `{ true, apparent }`, the flag
 * `disguiseItem` writes. A source already carrying a disguise keeps the truth
 * it captured, so a second mask never loses the first's. Never mutates `data`.
 * @param {object} data item source data, the shape of `item.toObject()`
 * @param {{name?,img?,cost?,damage?,ac?,description?}} [apparent]
 * @returns {object}
 */
export function disguiseData(data, apparent = {}) {
  const out = structuredClone(data);
  const existing = out.flags?.[MODULE_ID]?.[ITEM_FLAGS.DISGUISE];
  const truth = existing?.true ?? trueIdentityOf(data);
  for (const [path, value] of Object.entries(disguisePatch(out.type, apparent, truth))) setAt(out, path, value);
  setAt(out, `flags.${MODULE_ID}.${ITEM_FLAGS.DISGUISE}`, { true: truth, apparent: { ...apparent } });
  return out;
}
