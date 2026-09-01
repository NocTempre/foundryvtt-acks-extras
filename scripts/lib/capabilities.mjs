/**
 * Capability matching — "does this actor hold an ability that provides X?"
 *
 * The books print one capability several ways: *Searching* is a thief skill, a
 * proficiency, and what several class powers hand out. Matching on item NAME
 * catches whichever spelling a sheet happens to use; matching on a `kw:`
 * capability token catches every route to the mechanic. Callers generally want
 * the UNION of both — the capability register is precise but only as complete as
 * its contents, and a strict capability check silently drops the abilities that
 * do not declare one yet.
 *
 * This lives in lib because more than one feature asks the question: the
 * formation's ability bridge (roll candidates, mapper proficiency) and the sense
 * model (`senses.mjs`, which reads `kw:lightlessvision` to decide whether a
 * creature needs a torch). Pure reads; nothing here writes.
 */

import { satisfies, ITEM_TYPE } from "./vocab.mjs";
import { cookbookId } from "./library.mjs";

/** The abilities feature's own flag scope, holding the acks-abilities effect model. */
const ABILITIES_ID = "acks-extras";

/**
 * One ability item as the `{id, provides}` shape acks-lib reasons over.
 *
 * `id` is the register's definition id, written by the importer on import
 * (`flags["acks-extras"].cookbook.id`). `provides` comes from the
 * acks-abilities effect model. An item with neither is a hand-made ability and
 * simply has no capability — a caller's name path still covers it.
 */
/**
 * The register definition id stamped on an imported item ("def.power.longeval"),
 * or null for a hand-made one. Delegates to `library.mjs`'s `cookbookId`, the
 * ONE read of that stamp.
 */
export function definitionId(item) {
  return cookbookId(item) || null;
}

function abilityRef(item) {
  const id = definitionId(item);
  const provides = item?.getFlag?.(ABILITIES_ID, "extras")?.provides ?? [];
  if (!id && !provides.length) return null;
  return { id, provides };
}

/** Every capability-bearing ability item on this actor. */
export function abilityRefs(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.ability) continue;
    const ref = abilityRef(item);
    if (ref) out.push(ref);
  }
  return out;
}

/**
 * Does this actor hold an ability satisfying `token` (e.g. "kw:alertness")?
 * A falsy token matches nothing (checks without a capability use names only).
 */
export function hasCapability(actor, token) {
  if (!token) return false;
  return satisfies(abilityRefs(actor), token);
}

/** Does this specific item satisfy `token`? Used to pick roll candidates. */
export function itemHasCapability(item, token) {
  if (!token) return false;
  const ref = abilityRef(item);
  return ref ? satisfies([ref], token) : false;
}

/**
 * How many of this actor's ability items answer to `name` — a proficiency
 * taken three times is three items, which is exactly what a rank is. Name
 * and capability token are a UNION, per this module's own rule: the register
 * is precise but only as complete as its contents. Vehicle stations read
 * Seafaring ranks through this; the mounted overlay reads its waivers.
 */
export function abilityRank(actor, name, token = null) {
  const prefix = String(name).toLowerCase();
  let rank = 0;
  for (const item of actor?.items ?? []) {
    if (item.type !== ITEM_TYPE.ability) continue;
    const n = (item.name ?? "").trim().toLowerCase();
    if (n === prefix || n.startsWith(`${prefix} (`) || n.startsWith(`${prefix}:`)) rank++;
    else if (token && itemHasCapability(item, token)) rank++;
  }
  return rank;
}
