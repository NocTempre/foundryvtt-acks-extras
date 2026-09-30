/**
 * Market profiles from a setting book: the Foundry-free half of binding a
 * printed regional demand grid and its domain records onto location actors.
 *
 * A grid row is one market — keyed `mkt<n>` by the register, never by the
 * name the book prints for it — carrying a demand modifier per ACKS I good
 * and a market class. A domain record, where the book prints one, adds the
 * market's urban families and its own class, and titles the place. The grid
 * speaks the ACKS I goods vocabulary; each column is translated to an ACKS II
 * merchandise key, first through the Judge's own merchandise `aliases`, then
 * through the default map below. A column neither resolves is reported, never
 * dropped and never priced. The runtime half (claiming and writing actors)
 * lives in `cookbook.mjs` (`cookbookImportMarketProfiles`). See
 * docs/markets/MODEL.md, "Setting-book market profiles".
 */
import { MODULE_ID } from "./constants.mjs";
import { LOCATION_TYPE } from "../location/constants.mjs";

/**
 * The module's ACKS I → ACKS II goods translation, by the register's column
 * keys. Module vocabulary: which of this module's merchandise keys an older
 * good's column feeds. Columns absent here have no ACKS II counterpart and
 * wait on the Judge's alias.
 */
export const ACKS1_GOODS = Object.freeze({
  grainVegetables: "grainVegetables",
  fishPreserved: "preservedFish",
  woodCommon: "commonWood",
  salt: "salt",
  beerAle: "beerAle",
  oilLamp: "oilsSauces",
  textiles: "textiles",
  hidesFurs: "commonFurs",
  metalsCommon: "commonMetal",
  meatsPreserved: "preservedMeat",
  wineSpirits: "wineSpirits",
  pottery: "pottery",
  tools: "tools",
  armorWeapons: "armorWeapons",
  dyePigments: "dyesPigments",
  glassware: "glassware",
  monsterParts: "monsterParts",
  woodRare: "rareWood",
  fursRare: "rareFurs",
  metalsPrecious: "preciousMetals",
  ivory: "ivory",
  spices: "spices",
  porcelainFine: "finePorcelain",
  booksRare: "rareBooksArt",
  silk: "silk",
  semipreciousStones: "semipreciousStones",
  gems: "gems",
});

/** The grid column that holds the market class rather than a good. */
const CLASS_COLUMN = "marketClass";

const ROMAN = Object.freeze({ I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 });

/** A minus sign, en or em dash: the page prints a negative with any of them. */
const MINUSES = /[−–—]/gu;

/** A printed demand modifier: "+1", "1", "-2", "−3", "0" → integer; anything else null. */
export function parseDm(raw) {
  const m = /^([+-]?)(\d+)$/u.exec(String(raw ?? "").replace(MINUSES, "-").replace(/\s+/gu, ""));
  if (!m) return null;
  const n = Number(m[2]);
  return m[1] === "-" ? -n : n;
}

/** A printed market class: "IV" or "4" → 4; null outside I–VI. */
export function parseMarketClass(raw) {
  const text = String(raw ?? "").trim().toUpperCase();
  const n = ROMAN[text] ?? (/^[1-6]$/u.test(text) ? Number(text) : null);
  return n ?? null;
}

/** A printed family count: "2,550" → 2550; null when the cell holds no whole number. */
export function parseFamilies(raw) {
  const text = String(raw ?? "").replace(/[,\s]/gu, "");
  return /^\d+$/u.test(text) ? Number(text) : null;
}

const fold = (s) => String(s ?? "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/gu, "");

/**
 * The column translator for one catalogue: a column key and the header the
 * page printed over it → a merchandise key, or null. A catalogue row whose
 * `aliases` name the column key or the header (folded) wins over the default
 * map, so a Judge's mapping is always the one applied. `resolve.judged` says
 * whether a column is translated by such an alias.
 * @param {Array<{key: string, aliases?: string[]}>} catalog
 * @returns {((column: string, header?: string) => string|null) & {judged: (column: string, header?: string) => boolean}}
 */
export function goodsResolver(catalog = []) {
  const byAlias = new Map();
  for (const row of catalog) {
    for (const alias of row?.aliases ?? []) {
      const k = fold(alias);
      if (k && !byAlias.has(k)) byAlias.set(k, row.key);
    }
  }
  const known = new Set(catalog.map((r) => r?.key).filter(Boolean));
  const aliased = (column, header = "") => byAlias.get(fold(column)) ?? byAlias.get(fold(header)) ?? null;
  const resolve = (column, header = "") => {
    const judged = aliased(column, header);
    if (judged) return judged;
    const mapped = ACKS1_GOODS[column] ?? null;
    // An empty catalogue translates by the default map alone; a stocked one
    // only to keys it actually holds.
    return mapped && (!known.size || known.has(mapped)) ? mapped : null;
  };
  resolve.judged = (column, header = "") => !!aliased(column, header);
  return resolve;
}

/**
 * One profile per market row across a book's grids.
 * @param {object} args
 * @param {Array<{rows: Array<{key: string, cells: object}>, header?: object}>} args.grids executed grid outputs
 * @param {Record<string, {families?: string, marketClass?: string}>} [args.records] domain-record reads by market key
 * @param {(column: string, header?: string) => string|null} args.resolve see `goodsResolver`
 * @returns {Array<{market: string, marketClass: number|null, gridClass: number|null, recordClass: number|null,
 *   families: number|null, demand: Array<{category: string, modifier: number}>,
 *   unmapped: Array<{column: string, header: string}>, duplicates: string[], classConflict: boolean}>}
 */
export function marketProfiles({ grids = [], records = {}, resolve }) {
  const out = [];
  for (const grid of grids) {
    const header = grid?.header ?? {};
    for (const row of grid?.rows ?? []) {
      if (!row?.key) continue;
      const demand = [];
      const unmapped = [];
      const duplicates = [];
      const taken = new Set();
      // Judge-aliased columns first: where two columns feed one good, the one
      // the Judge mapped on purpose stands and the default-mapped one is the
      // duplicate. Otherwise page order decides.
      const judged = (column) => (resolve.judged?.(column, header[column]) ? 0 : 1);
      const columns = Object.entries(row.cells ?? {}).sort(([a], [b]) => judged(a) - judged(b));
      for (const [column, cell] of columns) {
        if (column === CLASS_COLUMN) continue;
        const modifier = parseDm(cell);
        if (modifier === null) continue;
        const category = resolve(column, header[column]);
        if (!category) {
          unmapped.push({ column, header: String(header[column] ?? column) });
          continue;
        }
        // Two columns feeding one good: the first in the order above stands,
        // the other is reported.
        if (taken.has(category)) {
          duplicates.push(column);
          continue;
        }
        taken.add(category);
        demand.push({ category, modifier });
      }
      const record = records[row.key] ?? null;
      const gridClass = parseMarketClass(row.cells?.[CLASS_COLUMN]);
      const recordClass = parseMarketClass(record?.marketClass);
      out.push({
        market: row.key,
        // The domain record is the market's own entry; the grid is a summary.
        marketClass: recordClass ?? gridClass,
        gridClass,
        recordClass,
        families: parseFamilies(record?.families),
        demand,
        unmapped,
        duplicates,
        classConflict: gridClass !== null && recordClass !== null && gridClass !== recordClass,
      });
    }
  }
  return out;
}

/**
 * A place's name from its record heading: a trailing parenthetical (a
 * heading that also says what kind of record follows) is not part of the
 * place's name and is dropped.
 */
export const placeName = (title) => String(title ?? "").replace(/\s*\([^()]*\)\s*$/u, "").trim();

/** The cookbook id a market row is claimed under. */
export const marketEntryId = (book, market) => `${book}.${market}`;

/** The ordinal a market key carries: "mkt12" → 12. */
export const marketOrdinal = (market) => Number(/(\d+)$/u.exec(String(market ?? ""))?.[1] ?? 0);

/**
 * Whether a place's base demand may be written by a book import: it is empty,
 * or it already came from this same source. A base the Judge generated or
 * typed is theirs and is left standing.
 */
export function baseIsImportable(goods, source) {
  if (!(goods?.demand ?? []).length) return true;
  const held = goods?.dmProfile?.source;
  return !!held && held.book === source.book && held.page === source.page;
}

/**
 * The update that lands a profile on a place. Class and families are written
 * only where the place holds none; the base demand only where
 * `baseIsImportable`. A place with no market yet gains the whole subtree.
 * @param {object|null} market the place's current `system.market`
 * @param {object} profile one `marketProfiles` row
 * @param {{book: string, page: string}} source
 * @returns {{update: object, wrote: {marketClass: boolean, families: boolean, demand: boolean}}}
 */
export function marketProfileUpdate(market, profile, source) {
  const writeClass = profile.marketClass !== null && !market?.marketClassOverride;
  const writeFamilies = profile.families !== null && (market?.urbanFamilies ?? null) === null;
  const writeDemand = profile.demand.length > 0 && baseIsImportable(market?.goods, source);
  const wrote = { marketClass: writeClass, families: writeFamilies, demand: writeDemand };
  if (!market) {
    return {
      wrote,
      update: {
        "system.market": {
          ...(writeClass ? { marketClassOverride: profile.marketClass } : {}),
          ...(writeFamilies ? { urbanFamilies: profile.families } : {}),
          goods: writeDemand ? { demand: profile.demand, dmProfile: { source } } : {},
        },
      },
    };
  }
  const update = {};
  if (writeClass) update["system.market.marketClassOverride"] = profile.marketClass;
  if (writeFamilies) update["system.market.urbanFamilies"] = profile.families;
  if (writeDemand) {
    update["system.market.goods.demand"] = profile.demand;
    update["system.market.goods.dmProfile.source"] = source;
  }
  return { update, wrote };
}

/** Actor data for a market the book gives no other place for. */
export function marketActorData({ name, entryId, book, bookLabel = "", folderId = null }) {
  return {
    name,
    type: LOCATION_TYPE,
    img: "icons/svg/city.svg",
    folder: folderId,
    system: { region: bookLabel, notes: "", parentUuid: "" },
    flags: {
      [MODULE_ID]: {
        cookbook: { id: entryId, book, kind: "kind.marketRecord", unaudited: true },
      },
    },
  };
}
