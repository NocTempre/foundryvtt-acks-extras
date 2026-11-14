/* global game */
/**
 * Paths: a class's groups of mutually exclusive options ("exactly one of
 * these"), any of which can change what the character is trained to fight with.
 * See docs/classes/DECISIONS.md, "a class's mutually exclusive options are
 * PATHS, and a starting template is one".
 *
 * A group whose `source` is `"templates"` draws its options from the class's
 * own `system.templates` rows, which stay where they are; the selector keeps no
 * copy.
 *
 * The resolution is pure: it takes a class's `system` object and a selection
 * map and answers what was chosen and what it grants. Walking documents and
 * writing to actors belongs to the callers.
 */
import { MODULE_ID, LANG_PREFIX, FLAG_CLASSES } from "./constants.mjs";
import { trainingChanges } from "./training-logic.mjs";

/** Folded for comparison — a printed annotation is prose, not a key. */
const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The stable key a template row contributes as a path option: its annotation
 *  where it prints one, else its name. */
export const templateOptionKey = (row) => fold(row?.annotation || row?.name);

/**
 * A group's options, resolved.
 *
 * A `templates` group has none of its own: its options are the class's rows in
 * the same `{key, label}` shape.
 * @returns {{key: string, label: string, note: string, training: object|null}[]}
 */
export function pathOptions(system, group) {
  if (!group) return [];
  if (group.source === "templates") {
    return (system?.templates ?? []).map((row) => ({
      key: templateOptionKey(row),
      label: row.annotation ? `${row.name} (${row.annotation})` : row.name,
      note: row.caste ?? "",
      training: null, // a template grants gear and abilities, not a training
    }));
  }
  return (group.options ?? []).map((o) => ({
    key: o.key || fold(o.label),
    label: o.label || o.key,
    note: o.note ?? "",
    training: o.training ?? null,
  }));
}

/** Every group a class states, with its options resolved. */
export function pathGroups(system) {
  return (system?.paths ?? []).map((g) => ({
    key: g.key || fold(g.label),
    label: g.label || g.key,
    note: g.note ?? "",
    source: g.source ?? "",
    options: pathOptions(system, g),
  }));
}

/**
 * The option a selection names inside one group, or null.
 *
 * Matched on the folded key, so a caller may pass what the page printed. An
 * unknown selection resolves to null, never to the first option.
 */
export function chosenOption(system, groupKey, selection) {
  const group = pathGroups(system).find((g) => g.key === groupKey);
  if (!group || !selection) return null;
  const want = fold(selection);
  return group.options.find((o) => fold(o.key) === want || fold(o.label) === want) ?? null;
}

/**
 * The training every chosen option grants, as effect changes.
 *
 * Same three keys a class-wide training writes, with `add`, so a path's training
 * is cumulative with the class's. A group whose option states no training
 * contributes nothing (a starting template, for one).
 */
export function pathTrainingChanges(system, selections = {}) {
  const changes = [];
  for (const group of pathGroups(system)) {
    const option = chosenOption(system, group.key, selections?.[group.key]);
    if (option?.training) changes.push(...trainingChanges(option.training));
  }
  return changes;
}

/** What a class needs answered before it can be applied: every group with no
 *  valid selection yet. A class stating no paths asks nothing. */
export function unansweredGroups(system, selections = {}) {
  return pathGroups(system).filter((g) => g.options.length && !chosenOption(system, g.key, selections?.[g.key]));
}

/* ------------------------------------------------------------------ */
/*  Reading and writing a character's selections                       */
/* ------------------------------------------------------------------ */

/** The selections a character has made, keyed by group. */
export const actorPaths = (actor) => actor?.getFlag?.(MODULE_ID, FLAG_CLASSES)?.paths ?? {};

/**
 * Record one selection on the character, leaving the rest of the class ledger
 * alone. Returns the merged map so a caller can apply from it without re-reading.
 */
export async function setActorPath(actor, groupKey, optionKey) {
  if (!actor || !groupKey) return actorPaths(actor);
  const merged = { ...actorPaths(actor), [groupKey]: String(optionKey ?? "") };
  const ledger = actor.getFlag(MODULE_ID, FLAG_CLASSES) ?? {};
  await actor.setFlag(MODULE_ID, FLAG_CLASSES, { ...ledger, paths: merged });
  return merged;
}

/**
 * The selection a TEMPLATE makes for the character who takes it.
 *
 * A template row's annotation is the option key in whichever group the class
 * states it under, so applying a template answers that group without asking.
 * @returns {{group: string, option: string}|null}
 */
export function templateSelection(system, row) {
  const printed = row?.annotation || row?.caste;
  if (!printed) return null;
  for (const group of pathGroups(system)) {
    if (group.source === "templates") continue;
    const option = group.options.find((o) => fold(o.key) === fold(printed) || fold(o.label) === fold(printed));
    if (option) return { group: group.key, option: option.key };
  }
  return null;
}

/** Localized label for a group with no label of its own. */
export const groupLabel = (group) =>
  group?.label || game?.i18n?.localize?.(`${LANG_PREFIX}.paths.group`) || "Path";
