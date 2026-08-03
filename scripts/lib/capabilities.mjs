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

import { satisfies } from "./vocab.mjs";

/**
 * The importer owns its provenance flags; they persist even when it is
 * uninstalled. Declared locally rather than shared: the flag-scope validator
 * resolves every scope to its literal VALUE inside the calling file, so a scope
 * imported from elsewhere reads as unresolvable and fails the check.
 */
const DEFINITION_SCOPE = "acks-importer";

/** The abilities feature's own flag scope, holding the acks-abilities effect model. */
const ABILITIES_ID = "acks-extras";

/**
 * One ability item as the `{id, provides}` shape acks-lib reasons over.
 *
 * `id` is the register's definition id, written by acks-content on import
 * (`flags["acks-importer"].cookbook.id`). `provides` comes from the
 * acks-abilities effect model. An item with neither is a hand-made ability and
 * simply has no capability — a caller's name path still covers it.
 */
function abilityRef(item) {
  const id = item?.getFlag?.(DEFINITION_SCOPE, "cookbook")?.id ?? null;
  const provides = item?.getFlag?.(ABILITIES_ID, "extras")?.provides ?? [];
  if (!id && !provides.length) return null;
  return { id, provides };
}

/** Every capability-bearing ability item on this actor. */
export function abilityRefs(actor) {
  const out = [];
  for (const item of actor?.items ?? []) {
    if (item.type !== "ability") continue;
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
