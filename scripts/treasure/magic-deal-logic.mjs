/**
 * Rolling a dealt hoard's magic cards on the imported magic-item tables, on
 * plain data and injected seams, Foundry-free. `deal.mjs` binds the seams: the
 * lists a roll may begin at, the roll itself, and the document a rolled item
 * links to.
 *
 * A magic placeholder (`hoard-map.mjs` `truthsFromCards`) carries the noun the
 * hoard cell printed as its `tableRef`. The noun is matched against the
 * captions of the lists the import read, never against a name written here: a
 * noun that names no list, or two lists alike, rolls nothing. A placeholder
 * whose noun the cell printed before its count carries `typeList`; in classic
 * one that names no list begins at the type list instead (`startFor`). Every
 * placeholder that matches is rolled once. A card never invents: where nothing
 * could be rolled it stays the placeholder it was, and an error entry says so.
 *
 * A rolled item is a dealt find, unknown whatever its source document's own
 * marks say: undetected, unidentified, its curse not known.
 */
import { creatureKeys } from "../lib/vocab.mjs";
import { MODULE_ID, POOL } from "./constants.mjs";
import { parseDice } from "./hoard-logic.mjs";
import { normalizeTruth } from "./pot-logic.mjs";

/** The error code a deal carries for magic that could not be rolled; its `reason` says why. */
export const MAGIC_ERROR = "magic-not-rolled";

/**
 * Why a card was not rolled, beside the roll service's own reasons
 * (`not-imported`, `rarity-required` and a walk's error codes, passed through).
 */
export const MAGIC_REASON = Object.freeze({
  noNoun: "no-noun",
  noMatch: "no-match",
  ambiguous: "ambiguous",
  compound: "compound",
  noRoller: "no-roller",
  noItem: "no-item",
  failed: "roll-failed",
});

/** Whether two key sets share a member. */
const overlaps = (a, b) => [...a].some((k) => b.has(k));

/**
 * Whether a noun is several in one: a list of lists, or a count of each of a
 * list, written with a comma, a semicolon or a parenthetical. Matching such a
 * noun by its leading words names one list where the cell named several, so
 * it is refused before matching.
 */
const isCompound = (noun) => /[,;()]/.test(noun);

/**
 * The names a list goes by: its caption as imported, and its own key in the
 * imported tables. A noun printed without a word every caption of its group
 * carries meets the list's key where it misses the caption.
 */
const listKeys = (entry) => new Set([...creatureKeys(entry.caption ?? ""), ...creatureKeys(entry.key ?? "")]);

/**
 * The list a noun names, among the lists a roll may begin at for a style.
 * Classic begins at its category lists; heroic and gritty at the rarity lists.
 * A list and a noun are the same word when the noun's name keys meet the
 * list's caption's or its key's, a plural last word standing for its singular
 * (`creatureKeys`); whole keys only, so a word inside a longer name never
 * stands for it. A compound noun (`isCompound`) names no single list.
 *
 * A noun the hoard cell printed before its count (`typeList`) is a generic
 * term for the type list, which picks the category. Where it names no list and
 * the style is classic, the roll begins at the imported type list
 * (`lists.classicType`); a list it does name still wins, and two stay
 * ambiguous. Heroic and gritty have no type list, so there the noun stays
 * unmatched. A classic hoard with no type list imported is `not-imported`,
 * the reason the roll service itself gives for a table it has not read.
 *
 * @param {string|null} noun the hoard cell's printed noun
 * @param {"classic"|"heroic"|"gritty"} style
 * @param {{classicType?: object|null, classic?: object[], heroic?: object[]}|null} lists `starts()`' shape: `[{key, id, caption}]` per group, and the type list's one entry
 * @param {{typeList?: boolean}} [opts] `typeList` marks a noun printed before its count
 * @returns {{ok: true, id: string}|{ok: false, reason: string}}
 */
export function startFor(noun, style, lists, { typeList = false } = {}) {
  const mine = creatureKeys(noun);
  if (!mine.size) return { ok: false, reason: MAGIC_REASON.noNoun };
  if (isCompound(String(noun))) return { ok: false, reason: MAGIC_REASON.compound };
  const entries = (style === "classic" ? lists?.classic : lists?.heroic) ?? [];
  const hits = entries.filter((e) => e?.id && (e.caption || e.key) && overlaps(listKeys(e), mine));
  if (hits.length > 1) return { ok: false, reason: MAGIC_REASON.ambiguous };
  if (hits.length) return { ok: true, id: hits[0].id };
  if (typeList && style === "classic") {
    const id = lists?.classicType?.id;
    return id ? { ok: true, id } : { ok: false, reason: "not-imported" };
  }
  return { ok: false, reason: entries.length ? MAGIC_REASON.noMatch : "not-imported" };
}

/**
 * What a rolled find passes for: its document's own disguise where it carries
 * one (`truthsFromItem` reads it as `mask`), else the placeholder it replaced,
 * by name. An undetected magic find is ranked and drawn as what it passes for,
 * so it never shows its true name; a cost comes only from a disguise, and
 * without one the find ranks as the placeholder did.
 */
const passesFor = (truth, placeholder) => truth.mask ?? (placeholder?.label ? { name: placeholder.label } : null);

/**
 * A rolled document's truth as a dealt find: magic, undetected, unidentified,
 * wearing what it passes for, with the snapshot marked magic and its own
 * identification and curse-known marks cleared, so a claim cannot create an
 * item that knows more than the card does. A coin truth (a bundle that
 * delivers coin) is left as it is.
 * @param {object} truth a truth of the rolled document
 * @param {object} [placeholder] the placeholder it replaces
 */
export function unknownTruth(truth, placeholder = null) {
  if (truth.coin) return truth;
  const data = truth.source?.data ? structuredClone(truth.source.data) : null;
  if (data) {
    data.flags = { ...(data.flags ?? {}) };
    data.flags[MODULE_ID] = { ...(data.flags[MODULE_ID] ?? {}) };
    const markets = { ...(data.flags[MODULE_ID].markets ?? {}), magic: true, identified: "none", detected: false };
    delete markets.curseKnown;
    data.flags[MODULE_ID].markets = markets;
  }
  return normalizeTruth({ ...truth, source: { uuid: truth.source?.uuid ?? null, data }, pool: POOL.magic, magical: true, detected: false, identified: "none", mask: passesFor(truth, placeholder) });
}

/**
 * Whether a truth of a rolled document is the magic part of it: the document
 * itself (the first truth, the one `truthsFromItem` reads its magic from), or
 * a delivered good its own data marks magic. A bundle's other goods stay as
 * they were dealt.
 */
const isMagicPart = (truth, i) => i === 0 || truth.magical === true || truth.source?.data?.flags?.[MODULE_ID]?.markets?.magic === true;

/**
 * One walk as audit rows in the hoard's shape (`where`, `expr`, `sides`,
 * `min`, `max`, `total`, `cite`), one per die thrown, each also naming the
 * list it was thrown on, its caption and where the roll began. The last row
 * names the item reached, where there is one.
 */
function auditRows(result, where, item) {
  const rows = [];
  for (const step of result?.steps ?? []) {
    const row = (die, total, extra) => {
      const p = parseDice(die);
      return { where, expr: die ?? null, sides: p?.sides ?? null, min: p?.min ?? null, max: p?.max ?? null, total, cite: step.cite ?? null, magic: true, start: result.start ?? null, list: step.list ?? null, caption: step.caption ?? null, ...extra };
    };
    rows.push(row(step.die, step.total, {}));
    if (step.inner) rows.push(row(step.inner.die, step.inner.total, { inner: true }));
  }
  if (rows.length && item?.text) rows.at(-1).item = item.text;
  return rows;
}

/**
 * Roll every magic placeholder among `truths` once and put what was rolled in
 * its place; every other truth passes through.
 *
 * A matched placeholder is rolled through `roll({from, style})`, a result's
 * item resolved through `resolve(uuid)` to the truths of its document. Where
 * the item names a document the card is that document, a dealt find whose
 * magic part alone is made unknown (`isMagicPart`); where it does not, the
 * card is a placeholder named for the item. Either wears what it passes for
 * (`passesFor`), never its true name. A roll the
 * service refused or could not finish, an item no row of the list reached
 * (`item.flag`, no name), a noun that names no list or two, and a missing
 * roller or list set leave the card as it was and add one error entry
 * `{code: MAGIC_ERROR, reason, noun}`. Nothing throws.
 *
 * @param {object} args
 * @param {object[]} args.truths a deal's truths; a placeholder is a magic truth carrying `tableRef`, and `typeList` where its noun was printed before its count
 * @param {"classic"|"heroic"|"gritty"} args.style
 * @param {string} args.where the audit rows' place, e.g. `<letter>.magic`
 * @param {{classicType?: object|null, classic?: object[], heroic?: object[]}|null} args.lists `startFor`'s lists
 * @param {((args: {from: string, style: string}) => Promise<object>)|null} args.roll the roll service's `roll`, with its roller bound
 * @param {(uuid: string) => Promise<object[]|null>} args.resolve the truths of the document a uuid names, or null
 * @returns {Promise<{truths: object[], errors: object[], audit: object[]}>}
 */
export async function rollMagicTruths({ truths, style, where, lists, roll, resolve }) {
  const out = [];
  const errors = [];
  const audit = [];
  const starts = new Map();
  for (const truth of truths ?? []) {
    if (truth?.pool !== POOL.magic || !("tableRef" in truth)) {
      out.push(truth);
      continue;
    }
    const noun = truth.tableRef ?? null;
    const keep = (reason) => {
      out.push(truth);
      errors.push({ code: MAGIC_ERROR, reason, noun });
    };
    if (typeof roll !== "function") { keep(MAGIC_REASON.noRoller); continue; }
    const typeList = truth.typeList === true;
    const memo = `${typeList ? 1 : 0}|${noun}`;
    if (!starts.has(memo)) starts.set(memo, startFor(noun, style, lists, { typeList }));
    const start = starts.get(memo);
    if (!start.ok) { keep(start.reason); continue; }

    let result;
    try {
      result = await roll({ from: start.id, style });
    } catch {
      result = null;
    }
    audit.push(...auditRows(result, where, result?.ok ? result.item : null));
    if (!result?.ok) { keep(result?.reason ?? MAGIC_REASON.failed); continue; }
    const item = result.item;
    if (!item || item.flag || typeof item.text !== "string" || !item.text.trim()) { keep(MAGIC_REASON.noItem); continue; }

    let found = null;
    if (typeof item.uuid === "string" && item.uuid) {
      try {
        found = await resolve?.(item.uuid);
      } catch {
        found = null;
      }
    }
    if (Array.isArray(found) && found.length) out.push(...found.map((t, i) => (isMagicPart(t, i) ? unknownTruth(t, truth) : t)));
    else out.push(normalizeTruth({ pool: POOL.magic, label: item.text.trim(), magical: true, detected: false, mask: passesFor({}, truth) }));
  }
  return { truths: out, errors, audit };
}
