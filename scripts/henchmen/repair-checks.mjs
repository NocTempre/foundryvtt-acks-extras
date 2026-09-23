/* global game, fromUuid */
/**
 * Henchmen's repair check: an employer's list, a monster list or a manager
 * pointer naming an actor that no longer exists. It wraps `repair.mjs`, which
 * stays the one owner of what counts as dangling and how it is cleared.
 */
import { fixEach, registerRepairCheck } from "../lib/repair.mjs";
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

/** Registers the check. Called once, at `init`. */
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
}
