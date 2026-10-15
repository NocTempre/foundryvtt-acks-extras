/* global game */
/**
 * What the world holds for a name written on the official sheet: the class,
 * an ability with its pick, a spell, a language, a henchman on the roster, the
 * coin a box counts. Lookups only — nothing here writes — so the import window
 * can show what will match before anything is applied, and `apply.mjs` matches
 * the same way when it writes.
 */
import { MODULE_ID } from "../../lib/constants.mjs";
import { ITEM_TYPE, slug, selectionVocabFor, matchSelectionKey } from "../../lib/vocab.mjs";
import { libraryItems } from "../../lib/library.mjs";
import { classItems, classByKey, templatePartOf } from "../../classes/registry.mjs";
import { refOf } from "../../classes/grants.mjs";
import { resolveLanguage } from "../../classes/languages.mjs";
import { ownCoin } from "../../lib/money.mjs";
import { henchmanIds } from "../snapshot.mjs";

/** A name with any trailing bracket dropped, folded: what two spellings of one thing share. */
export const nameSlug = (name) => slug(String(name ?? "").replace(/\s*\([^)]*\)\s*$/, ""));

/** The class a sheet names, by name and then by key, or null. */
export function matchClass(name) {
  const s = slug(name);
  if (!s) return null;
  return classItems().find((c) => slug(c.name) === s && !c.system?.isStub) ?? classByKey(s);
}

/** The library's own definitions of a type — never a class's copy of one. */
const definitions = (type) => libraryItems().filter((i) => i.type === type && !templatePartOf(i));

/**
 * The library ability a sheet's proficiency names, with its pick read against
 * the ability's own shortlist: the shortlist's key where it names one, else
 * the pick as written.
 * @param {{name: string, selection: string|null}} entry
 * @returns {{doc: Item, ref: string, selection: string|null}|null}
 */
export function matchAbility(entry) {
  const want = slug(entry?.name);
  if (!want) return null;
  const pool = definitions(ITEM_TYPE.ability);
  const whole = entry.selection ? slug(`${entry.name}${entry.selection}`) : null;
  const doc = pool.find((i) => nameSlug(i.name) === want) ?? (whole ? pool.find((i) => slug(i.name) === whole) : null);
  if (!doc) return null;
  let selection = null;
  if (entry.selection && nameSlug(doc.name) === want) {
    const vocab = selectionVocabFor(doc, doc.flags?.[MODULE_ID]?.extras?.category);
    selection = (vocab && matchSelectionKey(vocab, entry.selection)) || entry.selection;
  }
  return { doc, ref: refOf(doc), selection };
}

/** The picks an owned ability carries, as `grantRanked` writes them. */
const picksOf = (item) => item.flags?.[MODULE_ID]?.extras?.selections ?? [];

/**
 * The actor's copies of one matched ability: by the importer's stamp, the
 * `grantedFrom` stamp, or the definition's name, and — where a pick was
 * written — carrying that pick.
 */
export function ownedCopies(actor, match) {
  const want = nameSlug(match.doc.name);
  return actor.items.filter((i) => {
    if (i.type !== match.doc.type) return false;
    const same = refOf(i) === match.ref || i.flags?.[MODULE_ID]?.grantedFrom === match.ref || nameSlug(i.name) === want;
    if (!same) return false;
    const picks = picksOf(i).map((p) => slug(p));
    return match.selection ? picks.includes(slug(match.selection)) : true;
  });
}

/** The library spell a sheet names, or null. */
export function matchSpell(name) {
  const s = slug(name);
  if (!s) return null;
  const pool = [...definitions(ITEM_TYPE.spell), ...(game.items?.filter((i) => i.type === ITEM_TYPE.spell) ?? [])];
  return pool.find((i) => slug(i.name) === s) ?? null;
}

/** The language document a sheet's entry resolves to, or null (never minted). */
export const matchLanguage = (name) => resolveLanguage(name);

/** The actor's item a sheet line names, by name, or null. */
export const ownedNamed = (actor, name, types = null) =>
  actor.items.find((i) => (!types || types.includes(i.type)) && slug(i.name) === slug(name)) ?? null;

/** The roster member a henchman slot names, or null. */
export function matchHenchman(employer, name) {
  const s = slug(name);
  if (!s) return null;
  return henchmanIds(employer).map((id) => game.actors?.get(id)).find((a) => a && slug(a.name) === s) ?? null;
}

/**
 * The coin each box counts, by the metal the system's own coins are named for.
 * A row is that coin when its name starts with the metal, so "Gold" and "Gold
 * Pieces" are one coin and a Judge's own denominations are counted in no box.
 */
export const COIN_METALS = Object.freeze({ pp: "platinum", ep: "electrum", gp: "gold", sp: "silver", cp: "copper" });

/** Whether a coin row is the coin a box counts. */
export const isCoinOf = (row, box) => !!COIN_METALS[box] && slug(row?.name).startsWith(COIN_METALS[box]);

/** How many of a box's coin the actor carries on their person. */
export const coinsHeld = (actor, box) =>
  ownCoin(actor)
    .filter((row) => isCoinOf(row, box))
    .reduce((n, row) => n + Math.max(0, Number(row.system?.quantity) || 0), 0);
