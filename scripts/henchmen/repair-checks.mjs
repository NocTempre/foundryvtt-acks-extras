/* global game, fromUuid */
/**
 * Henchmen's repair checks. The first: an employer's list, a monster list or a
 * manager pointer naming an actor that no longer exists; it wraps `repair.mjs`,
 * which stays the one owner of what counts as dangling and how it is cleared.
 * The second: a mercenary group holding the combined composite/longbow entry
 * with no stored wage type, which payroll cannot bill.
 */
import { fixEach, registerRepairCheck } from "../lib/repair.mjs";
import { GROUP_ACTOR_TYPE } from "../lib/group-logic.mjs";
import { keyWageStacks } from "./rules/wages.mjs";
import { isClean, repairActor, scanActor } from "./repair.mjs";

const loc = (key, data = {}) => game.i18n.format(`ACKS-HENCHMEN.repair.check.${key}`, data);

/** What one actor's scan found, as a sentence of counts. */
function describe(found) {
  const bits = [];
  if (found.henchmen.length) bits.push(loc("henchmen", { count: found.henchmen.length }));
  if (found.monsters.length) bits.push(loc("monsters", { count: found.monsters.length }));
  if (found.duplicates.length) bits.push(loc("duplicates", { count: found.duplicates.length }));
  if (found.manager) bits.push(loc("manager"));
  return bits.join("; ");
}

/**
 * What an employer-paid group needs keyed: how many stacks hold the combined
 * entry with no wage type, the settlement the group was hired at (null once
 * gone), that settlement's variant and the group's stacks as plain sources.
 * Null for a group with nothing to key.
 */
async function unkeyedWageGroup(group) {
  if (group.type !== GROUP_ACTOR_TYPE || !group.system?.unit?.employerUuid) return null;
  const location = group.system.unit.locationUuid ? await fromUuid(group.system.unit.locationUuid).catch(() => null) : null;
  const variant = location?.system?.market?.compositeVariant ?? "";
  // Counted on a copy, so the stacks handed back are the group's own, untouched.
  const count = keyWageStacks(group.system.toObject().stacks ?? [], variant);
  return count ? { count, location, variant, stacks: group.system.toObject().stacks ?? [] } : null;
}

/** Registers the checks. Called once, at `init`. */
export function registerHenchmenRepairChecks() {
  registerRepairCheck({
    id: "henchmen.references",
    label: "ACKS-HENCHMEN.repair.check.label",
    hint: "ACKS-HENCHMEN.repair.check.hint",
    order: 10,
    scan: () =>
      game.actors.contents
        .map((actor) => [actor, scanActor(actor)])
        .filter(([, found]) => !isClean(found))
        .map(([actor, found]) => ({ key: actor.uuid, uuid: actor.uuid, name: actor.name, detail: describe(found) })),
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const actor = await fromUuid(f.uuid);
        if (actor) await repairActor(actor);
      }),
  });
  registerRepairCheck({
    id: "henchmen.wageType",
    label: "ACKS-HENCHMEN.repair.check.wageType.label",
    hint: "ACKS-HENCHMEN.repair.check.wageType.hint",
    order: 20,
    scan: async () => {
      const out = [];
      for (const group of game.actors.contents) {
        const found = await unkeyedWageGroup(group);
        if (!found) continue;
        // The variant is the settlement's; a group whose settlement is gone has
        // none to read, and no guess is written in its place.
        out.push({
          key: group.uuid,
          uuid: group.uuid,
          name: group.name,
          detail: loc("wageType.detail", { count: found.count }),
          fixable: !!found.location,
          reason: found.location ? null : loc("wageType.noSettlement"),
        });
      }
      return out;
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const group = await fromUuid(f.uuid);
        const found = group ? await unkeyedWageGroup(group) : null;
        if (!found?.location) throw new Error(loc("wageType.noSettlement"));
        keyWageStacks(found.stacks, found.variant);
        await group.update({ "system.stacks": found.stacks });
      }),
  });
}
