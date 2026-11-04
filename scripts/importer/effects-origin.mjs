/* global game, fromUuid */
/**
 * Which reader produced an imported ability's `effects`, and the repair check
 * that stamps it on copies imported before the stamp existed.
 *
 * A register recipe (`fields.effects.specs`) replaces the vocabulary scan
 * outright, so an entry's origin is "recipe" exactly when it carries specs.
 * A copy is stamped from what it HOLDS, not from what the cookbook says today:
 * an entry that gained a recipe after the copy was imported still holds the
 * scan's effects until Update Abilities reads the recipe, so it is stamped
 * "scan" until then.
 */
import { MODULE_ID } from "./constants.mjs";
import { fixEach, registerRepairCheck, worldActors } from "../lib/repair.mjs";

/** The flag key, under `flags["acks-extras"]`, holding an ability's extended model. */
const FLAG_EXTRAS = "extras";
const ABILITY_TYPE = "ability";

/** "recipe" when a cookbook entry ships a register recipe for its effects, else "scan". */
export const effectsOriginOf = (entry) => (entry?.fields?.effects?.specs?.length ? "recipe" : "scan");

/**
 * One effect's shape, without its figures: what a recipe fixes and a scan
 * guesses. A condition counts by its presence, never its text: the words are
 * the page's or a label, and either changes under a copy without changing
 * which reader wrote it.
 */
const shapeOf = (e) => [e?.type ?? "", e?.target ?? "", e?.forWhat ?? "", e?.condition ? "c" : "", e?.gate?.kind ?? ""].join("|");
const shapes = (list) => (list ?? []).filter((e) => e?.type !== "capability").map(shapeOf);

/**
 * The origin a held copy's effects show: "recipe" when they have the recipe's
 * shape, effect for effect, else "scan". Pure.
 *
 * @param {object[]} held the copy's `extras.effects`
 * @param {object} entry its cookbook entry
 * @returns {"recipe"|"scan"}
 */
export function heldOrigin(held, entry) {
  if (effectsOriginOf(entry) !== "recipe") return "scan";
  const want = shapes(entry.fields.effects.specs);
  const have = shapes(held);
  return want.length === have.length && want.every((s, i) => s === have[i]) ? "recipe" : "scan";
}

/**
 * The finding for one item, or null: an imported ability with no origin stamp
 * whose cookbook entry this seat's cookbook knows.
 */
function unstamped(item, label, lookup) {
  if (item?.type !== ABILITY_TYPE) return null;
  const id = item.getFlag?.(MODULE_ID, "cookbook")?.id;
  const extras = item.getFlag?.(MODULE_ID, FLAG_EXTRAS);
  if (!id || !extras || extras.effectsFrom) return null;
  const found = lookup(id);
  if (!found?.entry) return null;
  const origin = heldOrigin(extras.effects, found.entry);
  return {
    key: item.uuid,
    uuid: item.uuid,
    name: label,
    origin,
    detail: game.i18n.localize(origin === "recipe" ? "ACKS-ABILITIES.repair.effectsOrigin.recipe" : "ACKS-ABILITIES.repair.effectsOrigin.scan"),
  };
}

/**
 * Registers `abilities.effectsOrigin`. Called once, at `init`, by the importer,
 * which owns the cookbook `lookup` (`cookbookEntry`) the check reads.
 */
export function registerEffectsOriginCheck(lookup) {
  registerRepairCheck({
    id: "abilities.effectsOrigin",
    label: "ACKS-ABILITIES.repair.effectsOrigin.label",
    hint: "ACKS-ABILITIES.repair.effectsOrigin.hint",
    order: 20,
    scan: () => {
      const out = [];
      for (const item of game.items ?? []) out.push(unstamped(item, item.name, lookup));
      for (const actor of worldActors()) {
        for (const item of actor.items) out.push(unstamped(item, `${actor.name} → ${item.name}`, lookup));
      }
      return out.filter(Boolean);
    },
    fix: (findings) =>
      fixEach(findings, async (f) => {
        const item = await fromUuid(f.uuid);
        if (!item) return;
        await item.update({ [`flags.${MODULE_ID}.${FLAG_EXTRAS}.effectsFrom`]: f.origin });
      }),
  });
}
