/* global game */
/**
 * Granting a class's awards as owned ability items.
 *
 * Owned here rather than in levelup.mjs because THREE paths need it — chargen
 * builds a 1st level, the level-up wizard adds one level, and applying a class
 * at a level SETS every level up to it — and the file that owns the wizard
 * cannot also be imported by the file the wizard calls.
 *
 * Every grant is deduped by ref, so a power a template already carried, or one
 * the character was given by hand, is never doubled.
 */
import { MODULE_ID } from "./constants.mjs";
import { findByRef } from "./registry.mjs";
import { choiceOptions } from "../lib/choice-spec.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { libraryItems } from "../lib/library.mjs";

/** The ref a world item is addressed by (the importer's stamp, else uuid). */
export const refOf = (item) => item.flags?.["acks-importer"]?.cookbook?.id ?? `uuid:${item.uuid}`;

/** The ref an owned copy was granted from, stamped when this file granted it. */
const grantedFrom = (item) => item.flags?.[MODULE_ID]?.grantedFrom ?? null;

/** Normalized name, the identity a hand-made ability has and nothing else. */
const nameKey = (doc) => String(doc?.name ?? "").trim().toLowerCase();

/**
 * Does the actor already own an ability carrying this ref?
 *
 * An OWNED copy is not the world item: it has its own uuid, so a `uuid:` ref
 * never matches one by uuid however obvious that looks — which is why a
 * hand-made ability used to be granted again on every apply. Three things can
 * answer the question, in falling order of certainty: the importer's stamp
 * (copied onto the owned item), the ref this file stamped when it granted the
 * copy, and — for a copy that predates either, or that a Judge dragged on by
 * hand — the source's name, which is the only identity such an item has. The
 * same name-matching `isAdventuring` has always relied on.
 */
export function ownsRef(actor, ref) {
  if (!ref) return false;
  if (actor.items.some((i) => refOf(i) === ref || grantedFrom(i) === ref)) return true;
  const source = findByRef(ref);
  if (!source) return false;
  const key = nameKey(source);
  return actor.items.some((i) => i.type === source.type && nameKey(i) === key);
}

/** Create one granted ability on the actor from a world item ref. */
export async function grantAbility(actor, ref, grants) {
  if (!ref || ownsRef(actor, ref)) return;
  const source = findByRef(ref);
  if (!source) {
    grants.push({ ref, name: ref, missing: true });
    return;
  }
  const data = source.toObject();
  delete data._id;
  // Stamped with where it came from, so the next apply recognises it without
  // falling back to its name.
  data.flags = { ...(data.flags ?? {}), [MODULE_ID]: { ...(data.flags?.[MODULE_ID] ?? {}), grantedFrom: ref } };
  await actor.createEmbeddedDocuments("Item", [data]);
  grants.push({ ref, name: source.name });
}

/** The cookbook ref of the proficiency every character already has. */
export const ADVENTURING_REF = "def.prof.adventuring";

/** Is this world item the Adventuring proficiency? Matched by the importer's
 *  stamp, and by name for a world's hand-made copy that carries none. */
const isAdventuring = (item) =>
  refOf(item) === ADVENTURING_REF || String(item.name ?? "").trim().toLowerCase() === "adventuring";

/**
 * Every general proficiency a character may still CHOOSE.
 *
 * "All player characters are assumed to have Adventuring" (RR Ch. 3 §III.4),
 * so it is never on offer: a pick spent on it buys nothing.
 */
export const choosableGenerals = () =>
  libraryItems().filter(
    (i) => i.type === ITEM_TYPE.ability && i.system.proficiencytype === "general" && !isAdventuring(i),
  );

/** The library's Adventuring proficiency document, if it holds one. */
export const adventuringDoc = () => libraryItems().find((i) => i.type === ITEM_TYPE.ability && isAdventuring(i));

/** Grant the free-with-every-class Adventuring proficiency, once. */
export async function grantAdventuring(actor, grants) {
  const doc = adventuringDoc();
  if (doc) await grantAbility(actor, refOf(doc), grants);
}

/**
 * Every spell a character of this class may CHOOSE from.
 *
 * Unlike every other option source, this one deliberately reaches past the
 * library into whatever spell compendia the world has. The 2026-08-20 ruling —
 * read the imports, never the system's shipped compendium — governs what a
 * PACKAGE materializes into a template from a book the reader may not own. A
 * player electing their own starting spell is a different act: the offer is
 * only worth making from what their world actually holds, and a world that has
 * imported no spell list still has the system's. Offering nothing would leave
 * the pick unredeemable, which is a surface nobody can reach.
 *
 * Narrowed to the class's own traditions where the documents say which they
 * belong to; a class with no casting row offers no spells at all.
 */
export function choosableSpells(classItem) {
  const traditions = classItem?.system?.casting ?? [];
  if (!traditions.length) return [];
  const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const wanted = new Set(traditions.flatMap((t) => [fold(t.key), fold(t.label)]).filter(Boolean));
  const packed = (game.packs ?? [])
    .filter((p) => p.documentName === "Item")
    .flatMap((p) => [...p.contents].filter((i) => i.type === ITEM_TYPE.spell));
  const seen = new Set();
  return [...libraryItems().filter((i) => i.type === ITEM_TYPE.spell), ...packed].filter((doc) => {
    if (seen.has(doc.uuid)) return false;
    seen.add(doc.uuid);
    // The tradition field is free text a Judge may leave blank; an unlabelled
    // spell is OFFERED rather than hidden, because a hidden option is one the
    // player cannot pick and cannot see the absence of.
    const tradition = fold(doc.system?.class);
    return !tradition || !wanted.size || wanted.has(tradition);
  });
}

/**
 * Load every compendium that holds a spell, so `choosableSpells` can see them.
 *
 * A compendium's `contents` is empty until its documents are loaded, and the
 * system's spell packs are cold in a fresh session — so an offer resolved
 * without this returns nothing at all and the pick reads as unredeemable in
 * exactly the world it exists to serve (one that has imported no spells of its
 * own). The index is always present, so the decision of WHICH packs to load
 * costs no loading.
 */
export async function warmSpellPacks() {
  const wanted = [];
  for (const pack of game.packs ?? []) {
    if (pack.documentName !== "Item") continue;
    const index = await pack.getIndex({ fields: ["type"] }).catch(() => null);
    if (index?.some((e) => e.type === ITEM_TYPE.spell)) wanted.push(pack.getDocuments().catch(() => null));
  }
  await Promise.all(wanted);
}

/** Resolve a ChoiceSpec's options against this class doc and the world. */
export function optionsForChoice(choice, classItem) {
  const generalRefs = choosableGenerals().map(refOf);
  const refs = choiceOptions(choice, {
    inventory: classItem.system.inventory,
    generalRefs,
    spellRefs: choice?.from === "spellList" ? choosableSpells(classItem).map(refOf) : [],
  });
  return refs
    .map((ref) => ({ ref, name: findByRef(ref)?.name ?? ref }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * How a choice rung is remembered once it has been answered. Position in the
 * ladder plus the level it sits at — stable for a class document that is
 * imported and left alone, which is the normal life of one. A Judge who
 * reorders the ladder afterwards may be asked a rung again; the options a
 * character already holds are filtered out either way, so the worst case is a
 * question, not a duplicate.
 */
export const awardKey = (award, index) => `${index}:${award.atLevel ?? 1}`;

/** Every rung of the ladder, each carrying the key it is remembered by. The key
 *  is positional, so it is taken from the FULL list — a caller that filters to
 *  one level must filter these rather than index its own slice. */
const keyedAwards = (classItem) =>
  (classItem.system.awards ?? []).map((award, index) => ({ award, key: awardKey(award, index) }));

/**
 * Split a set of rungs into what would actually land.
 *
 * A fixed award whose ability the character already carries is dropped, and a
 * choice rung already answered (`seen`) is not asked twice — so re-applying a
 * class, which is how a character collects what they were owed, adds what is
 * missing instead of handing out a second set.
 */
function splitOwed(actor, rungs, seen) {
  const fixed = rungs
    .filter(({ award }) => award.kind === "fixed" && award.ref)
    .filter(({ award }) => !ownsRef(actor, award.ref))
    .map(({ award }) => award);
  const choices = rungs
    .filter(({ award, key }) => award.kind === "choice" && award.choice && !seen.has(key))
    .map(({ award, key }) => ({ ...award, key }));
  return { fixed, choices };
}

/**
 * The awards a character is owed for holding `level` in this class: every rung
 * of the ladder AT OR BELOW it, not merely the one just reached.
 *
 * The level-up wizard asks for one rung because a level is EARNED one at a
 * time. Setting a level asks for all of them, which is the same reading of the
 * ladder the printed spread has — a 5th-level fighter has taken every award
 * the table prints through 5th, whatever order they arrived in.
 */
export function awardsThrough(actor, classItem, level, taken = []) {
  return splitOwed(
    actor,
    keyedAwards(classItem).filter(({ award }) => (award.atLevel ?? 1) <= level),
    new Set(taken),
  );
}

/**
 * The awards owed for REACHING exactly this level — the one rung a level-up
 * climbs, carrying the same keys `awardsThrough` remembers rungs by, so a
 * question answered in the wizard is a question the picker does not ask again.
 */
export function awardsAt(actor, classItem, level, taken = []) {
  return splitOwed(
    actor,
    keyedAwards(classItem).filter(({ award }) => (award.atLevel ?? 1) === level),
    new Set(taken),
  );
}
