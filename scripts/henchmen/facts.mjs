/* global game */
/**
 * Cross-module facts — the "has X" fallback chain (docs/MODEL.md §7):
 *   1. owning module's API, when it exists and is active
 *   2. actor flag
 *   3. INVENTORY MARKER ITEM — a plain Item whose name declares the fact,
 *      e.g. "Stronghold: Border Fort" (cost = gp value),
 *      "Domain Income: 350gp/month", "Syndicate Member: <boss>"
 *   4. null → callers fall back to asking the GM
 *
 * Future domain-family modules (structures/strongholds…) supersede the
 * markers transparently by taking over step 1 — no changes needed here
 * beyond adding their API probe.
 */
import { MODULE_ID } from "./constants.mjs";

function markerItems(actor, re) {
  return (actor?.items ?? []).filter((i) => re.test(i.name ?? ""));
}

/**
 * Does the actor own a stronghold (follower prerequisite, RR 334)?
 * @returns {{name: string, value: number|null}|null}
 */
export function getStronghold(actor) {
  // 1. Future structures module API probe (none published yet).
  for (const id of ["acks-structures", "acks-strongholds"]) {
    const api = game.modules.get(id)?.api;
    const found = api?.getStronghold?.(actor);
    if (found) return found;
  }
  // 2. Actor flag (settable by anything, incl. macros).
  const flag = actor?.getFlag?.(MODULE_ID, "stronghold");
  if (flag) return typeof flag === "object" ? flag : { name: String(flag), value: null };
  // 3. Inventory marker item.
  const item = markerItems(actor, /^stronghold\s*[:\-]/i)[0];
  if (item) {
    return {
      name: item.name.replace(/^stronghold\s*[:\-]\s*/i, ""),
      value: Number(item.system?.cost ?? 0) || null,
    };
  }
  return null;
}

/**
 * Monthly domain income in gp (vassal-wage waiver, RR 168).
 * @returns {number|null}
 */
export function getDomainIncome(actor) {
  const domains = game.modules.get("acks-domains");
  if (domains?.active) {
    try {
      const domain = game.actors.find(
        (a) => a.type === "acks-domains.domain" && a.system?.rulerUuid === actor.uuid
      );
      const income = Number(domain?.system?.monthlyIncome);
      if (Number.isFinite(income)) return income;
    } catch {
      /* WIP module — shape may differ; fall through */
    }
  }
  const flag = Number(actor?.getFlag?.(MODULE_ID, "domainIncome"));
  if (Number.isFinite(flag) && flag > 0) return flag;
  const item = markerItems(actor, /^domain income\s*[:\-]/i)[0];
  if (item) {
    const m = (item.name ?? "").match(/([\d,]+)\s*gp/i);
    if (m) return Number(m[1].replace(/,/g, ""));
    const cost = Number(item.system?.cost);
    if (Number.isFinite(cost) && cost > 0) return cost;
  }
  return null;
}

/** Is the actor a member of the employer's crime syndicate (ruffian loyalty)? */
export function isSyndicateMember(actor, bossActor = null) {
  const flag = actor?.getFlag?.(MODULE_ID, "syndicateBoss");
  if (flag) return !bossActor || flag === bossActor.uuid || flag === bossActor.name;
  const item = markerItems(actor, /^syndicate member/i)[0];
  if (item) {
    if (!bossActor) return true;
    return (item.name ?? "").toLowerCase().includes((bossActor.name ?? "").toLowerCase());
  }
  return false;
}
