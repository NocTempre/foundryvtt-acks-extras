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
import { findByRef, templatePartOf } from "./registry.mjs";
import { choiceOptions } from "../lib/choice-spec.mjs";
import { ITEM_TYPE } from "../lib/vocab.mjs";
import { libraryItems, cookbookId } from "../lib/library.mjs";
import { foldKey, spellTraditions, spellDedupeKey } from "../magic/spell-logic.mjs";
import { FLAG_SPELL } from "../magic/constants.mjs";

/** The ref a world item is addressed by (the importer's stamp, else uuid). */
export const refOf = (item) => cookbookId(item) || `uuid:${item.uuid}`;

/** The ref an owned copy was granted from, stamped when this file granted it. */
const grantedFrom = (item) => item.flags?.[MODULE_ID]?.grantedFrom ?? null;

/** Normalized name, the identity a hand-made ability has and nothing else. */
const nameKey = (doc) => String(doc?.name ?? "").trim().toLowerCase();

/**
 * Does the actor already own an ability carrying this ref? An owned copy has
 * its own uuid, never the world item's, so recognition runs the importer's
 * stamp → the `grantedFrom` stamp this file writes at grant time → the
 * source's name, for a copy that predates either or that a Judge dragged on
 * by hand. See docs/classes/DECISIONS.md, "An owned copy is not the world
 * item, and the dedupe never knew it."
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

/** Is this item — a world item or an actor's owned copy — the Adventuring
 *  proficiency? Matched by the importer's stamp, which an owned copy carries,
 *  and by name for a hand-made copy that carries none. */
export const isAdventuring = (item) =>
  refOf(item) === ADVENTURING_REF || String(item.name ?? "").trim().toLowerCase() === "adventuring";

/**
 * Every general proficiency a character may still CHOOSE — never Adventuring
 * (RR Ch. 3 §III.4), and never a class's own template copy, only the
 * definition it copied. See docs/classes/DECISIONS.md, "2026-08-30 — a pick
 * list offers definitions, never a class's own copy".
 */
export const choosableGenerals = () =>
  libraryItems().filter(
    (i) =>
      i.type === ITEM_TYPE.ability &&
      i.system.proficiencytype === "general" &&
      !templatePartOf(i) &&
      !isAdventuring(i),
  );

/** The library's Adventuring proficiency document, if it holds one. Never a
 *  class's copy of it, for the reason `choosableGenerals` states. */
export const adventuringDoc = () =>
  libraryItems().find((i) => i.type === ITEM_TYPE.ability && !templatePartOf(i) && isAdventuring(i));

/** Grant the free-with-every-class Adventuring proficiency, once. */
export async function grantAdventuring(actor, grants) {
  const doc = adventuringDoc();
  if (doc) await grantAbility(actor, refOf(doc), grants);
}

/**
 * Every spell a character of this class may CHOOSE from — the only option
 * source that reaches past the library into whatever spell compendia the
 * world has, so the offer is never unredeemable in a world that imported no
 * spell list. Narrowed to the class's own traditions where the documents say
 * which they belong to; a class with no casting row offers no spells at all.
 * See docs/classes/DECISIONS.md, "2026-08-20 — a package resolves through
 * the IMPORTS, and mints what it cannot find".
 */
export function choosableSpells(classItem) {
  const traditions = classItem?.system?.casting ?? [];
  if (!traditions.length) return [];
  const wanted = new Set(traditions.flatMap((t) => [foldKey(t.key), foldKey(t.label)]).filter(Boolean));
  const packed = (game.packs ?? [])
    .filter((p) => p.documentName === "Item")
    .flatMap((p) => [...p.contents].filter((i) => i.type === ITEM_TYPE.spell));
  const seen = new Set();
  const offered = new Set();
  // The library first, so an imported copy of a spell stands for a core-pack
  // copy of the same name: two documents of one spell are one option.
  return [...libraryItems().filter((i) => i.type === ITEM_TYPE.spell), ...packed].filter((doc) => {
    if (seen.has(doc.uuid)) return false;
    seen.add(doc.uuid);
    // A class's own copy of a spell is not a second spell to elect.
    if (templatePartOf(doc)) return false;
    // The traditions a spell names — every list it prints on, else core's
    // free-text class string. An unlabelled spell is OFFERED rather than
    // hidden, because a hidden option is one the player cannot pick and
    // cannot see the absence of.
    const named = spellTraditions(doc.flags?.[MODULE_ID]?.[FLAG_SPELL], doc.system?.class);
    if (named.length && wanted.size && !named.some((t) => wanted.has(t))) return false;
    const key = spellDedupeKey(doc.name, cookbookId(doc));
    if (offered.has(key)) return false;
    offered.add(key);
    return true;
  });
}

/**
 * Load every compendium holding a spell, so `choosableSpells` can see them. A
 * pack's `contents` is empty until its documents load; its index is always
 * present, so which packs to load costs no loading.
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
 * How a choice rung is remembered once answered: position in the ladder plus
 * its level, stable while the class document is left alone. A reordered
 * ladder may ask a rung again; already-held options are filtered out either
 * way, so the worst case is a question, not a duplicate.
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
 * The awards a character is owed for holding `level` in this class: every
 * rung of the ladder at or below it, not merely the one just reached — the
 * same reading a level-up climbs one rung at a time.
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
