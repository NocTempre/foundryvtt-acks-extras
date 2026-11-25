/* global game */
/**
 * Who serves whom, read once for every surface that shows it. Service is stored
 * as child pointers: core's `henchmenList` (with each hireling's
 * `retainer.managerid`), this module's `monsterHenchmenList` flag, and a hired
 * unit's `unit.employerUuid` with its `unit.officerUuid`. `hirelingBuckets` and
 * `hiredUnitsOf` are those reads; `serviceNodes` reduces them to the node shape
 * lib's organisation views walk (docs/lib/ORGANISATION.md), so the Followers tab's
 * cards, the payroll and a chart of the service tree cannot disagree.
 *
 * Reads only. No employer pointer is written to any actor, and a generated
 * monster never gains one.
 */
import { MODULE_ID, FLAG_MONSTER_LIST } from "../constants.mjs";
import { GROUP_ACTOR_TYPE } from "../../lib/group-logic.mjs";
import { docOf } from "../../lib/util.mjs";
import { ACTOR_TYPE } from "../../lib/vocab.mjs";

/**
 * An employer's hirelings as live actors, in the buckets the Followers tab and
 * the Hirelings grid draw: core's character henchmen, with this module's monster
 * henchmen after them, then mercenaries and specialists. Core's `getHirelings`
 * hands back duplicated snapshots, so each is resolved to its world document, and
 * an id the world no longer holds is dropped.
 * @returns {{henchmen: Actor[], mercenaries: Actor[], specialists: Actor[]}}
 */
export function hirelingBuckets(employer) {
  const live = (h) => game.actors.get(h?._id ?? h?.id) ?? null;
  const raw = employer?.getHirelings?.() ?? {};
  const bucket = (key) => (raw[key] ?? []).map(live).filter(Boolean);
  const monsters = (employer?.getFlag?.(MODULE_ID, FLAG_MONSTER_LIST) ?? [])
    .map((id) => game.actors.get(id))
    .filter((a) => a && a.type === ACTOR_TYPE.monster);
  return {
    henchmen: [...bucket("henchman"), ...monsters],
    mercenaries: bucket("mercenary"),
    specialists: bucket("specialist"),
  };
}

/** The units an employer hires: the group actors whose `unit.employerUuid` names it. */
export const hiredUnitsOf = (employer) =>
  employer?.uuid ? game.actors.filter((a) => a.type === GROUP_ACTOR_TYPE && a.system?.unit?.employerUuid === employer.uuid) : [];

/**
 * The service tree under `employer`, as `{key, parentKey, label, holderUuid,
 * kind}` nodes in breadth-first order. The employer is the root; under each
 * actor stand its hired units, then its hirelings in the Followers tab's order,
 * each of them an employer in turn. A unit's officer stands under the unit it
 * leads, once: an officer who is also on the employer's roster is placed there
 * and not beside the unit. `key` is the holder's uuid, and a holder met a second
 * time is skipped, so a service chain that loops ends. `kind` is the category the
 * data carries (`retainer.category`, `unit.category`), blank for the root.
 * Reads only.
 * @param {Actor} employer
 * @returns {{key: string, parentKey: string, label: string, holderUuid: string, kind: string}[]}
 */
export function serviceNodes(employer) {
  if (!employer?.uuid) return [];
  const nodes = [];
  const seen = new Set();
  const stand = (doc, parentKey, kind) => {
    if (!doc?.uuid || seen.has(doc.uuid)) return false;
    seen.add(doc.uuid);
    nodes.push({ key: doc.uuid, parentKey, label: String(doc.name ?? ""), holderUuid: doc.uuid, kind: String(kind ?? "") });
    return true;
  };
  const kindOf = (actor) => actor?.system?.retainer?.category ?? "";

  stand(employer, "", "");
  const queue = [employer];
  while (queue.length) {
    const boss = queue.shift();
    const units = hiredUnitsOf(boss);
    // Units first, so a rostered officer is placed under its unit before the roster meets it.
    for (const unit of hiredUnitsOf(boss)) {
      if (!stand(unit, boss.uuid, unit.system?.unit?.category)) continue;
      const officer = docOf(unit.system?.unit?.officerUuid);
      if (officer && stand(officer, unit.uuid, kindOf(officer))) queue.push(officer);
    }
    const { henchmen, mercenaries, specialists } = hirelingBuckets(boss);
    for (const hireling of [...henchmen, ...mercenaries, ...specialists]) {
      if (stand(hireling, boss.uuid, kindOf(hireling))) queue.push(hireling);
    }
  }
  return nodes;
}
