/**
 * Register rules over an adventure's rows that a suite can feed invented rows:
 * key spaces and parents, the pairing of a place two books print, the places
 * a market grid's columns name, the printing errors its rows declare, revisions,
 * the kinds labelled by ordinal, the shape of a scene link, and a book's one
 * region map. `lint-register.mjs` reports what they return. Each returns a
 * list of problems, every one opening with the row's id, and never throws.
 */
import { laterBook } from "../../scripts/importer/books.mjs";
import { isRegionRecipe } from "../../scripts/importer/scene-binding.mjs";

/** A row id of some book: `ax1.fort9a`. */
const ROW_ID = /^[a-z][a-z0-9]{1,3}\.[A-Za-z0-9-]+$/;
const bookOf = (id) => String(id).split(".")[0];
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

/**
 * A key number as an adventure prints it before a keyed place: "30.", "36U.",
 * "20/20U.", a range, "1-3." or "1–3.", or a range of a key's lettered rooms,
 * "11c-l.". A pointer of the same standing as a page number.
 */
export const KEY_NUMBER = /^[A-Z]?\d+(?:[A-Za-z][-–][A-Za-z]|[A-Za-z]?(?:[-–]\d+[A-Za-z]?)?)(?:\/[A-Z]?\d+[A-Za-z]?)?\.?$/;

/** A key number without its closing stop, a printed en dash written as a hyphen. */
export const bareKey = (number) => String(number).replace(/\.$/, "").replace(/–/g, "-");

/**
 * The id and label a keyed area in a key space is held to. The id is the
 * space's stem and the key, hyphenated when the stem ends in a digit so that
 * "l1" and "12" cannot read as "l112"; a slashed key takes its first half, as a
 * settlement's does. The label is the space's name and the whole key.
 */
export function spaceKeyed(space, number) {
  const key = bareKey(number);
  const [book, stem] = String(space.id).split(".");
  const sep = /\d$/.test(stem) ? "-" : "";
  return { id: `${book}.${stem}${sep}${key.split("/")[0]}`, label: `${space.name} ${key}` };
}

/**
 * Key spaces and nesting, over every row at once (`rows`: id -> row).
 *
 * A key space is a location row some keyed area names in `meta.space`; it
 * anchors by hash and sits in no space itself. A row in a space anchors by its
 * key number, under the id and label `spaceKeyed` derives, or by hash. A
 * `meta.parent` names a location row of the same book whose space is the
 * row's own, or is the row's space itself; parents never run in a cycle.
 */
export function spaceProblems(rows) {
  const out = [];
  const spaces = new Set();
  for (const r of rows.values()) if (r.meta?.space !== undefined) spaces.add(r.meta.space);
  // The space a row's children sit in: its own, or itself when it is one.
  const container = (r) => r.meta?.space ?? (spaces.has(r.id) ? r.id : undefined);
  const where = (s) => (s === undefined ? "outside every key space" : `in the key space ${s}`);

  for (const id of spaces) {
    const s = rows.get(id);
    if (s && s.kind === "kind.location" && s.meta?.space === undefined && s.anchor?.hash === undefined) {
      out.push(`${id}: a key space anchors by hash on its heading, never by its printed words`);
    }
  }
  for (const r of rows.values()) {
    const { id, meta = {} } = r;
    if (meta.space !== undefined) {
      const s = rows.get(meta.space);
      if (r.kind !== "kind.location") out.push(`${id}: meta.space belongs on a location row only`);
      else if (!s) out.push(`${id}: meta.space names ${JSON.stringify(meta.space)}, which no row defines`);
      else if (s.book !== r.book) out.push(`${id}: meta.space names ${s.id}, a key space of another book`);
      else if (s.kind !== "kind.location") out.push(`${id}: meta.space names ${s.id}, which is not a location row`);
      else if (s.meta?.space !== undefined) out.push(`${id}: meta.space names ${s.id}, which is itself in a key space; spaces do not nest`);
      else if (r.anchor?.number !== undefined) {
        if (KEY_NUMBER.test(String(r.anchor.number))) {
          const want = spaceKeyed(s, r.anchor.number);
          if (r.name !== want.label) out.push(`${id}: a keyed area of ${s.id} is named "${want.label}"; its printed name is read at import`);
          if (id !== want.id) out.push(`${id}: a keyed area of ${s.id} keyed ${JSON.stringify(r.anchor.number)} has the id "${want.id}"`);
        }
      } else if (r.anchor?.hash === undefined) {
        out.push(`${id}: a row in a key space anchors by its key number or by hash, never by its printed words`);
      }
    }
    if (meta.parent !== undefined) {
      const p = rows.get(meta.parent);
      if (r.kind !== "kind.location") out.push(`${id}: meta.parent belongs on a location row only`);
      else if (!p) out.push(`${id}: meta.parent names ${JSON.stringify(meta.parent)}, which no row defines`);
      else if (p.id === id) out.push(`${id}: meta.parent names the row itself`);
      else if (p.book !== r.book) out.push(`${id}: meta.parent names ${p.id}, a row of another book`);
      else if (p.kind !== "kind.location") out.push(`${id}: meta.parent names ${p.id}, which is not a location row`);
      else if (meta.space !== container(p)) out.push(`${id}: meta.parent ${p.id} holds rows ${where(container(p))}, and this row is ${where(meta.space)}`);
    }
  }
  // A row on a cycle reports it; a row leading into one is reported through it.
  for (const r of rows.values()) {
    const seen = new Set([r.id]);
    for (let at = r; at?.meta?.parent !== undefined && at.meta.parent !== at.id; at = rows.get(at.meta.parent)) {
      if (!seen.has(at.meta.parent)) {
        seen.add(at.meta.parent);
        continue;
      }
      if (at.meta.parent === r.id) out.push(`${r.id}: meta.parent runs in a cycle back to this row`);
      break;
    }
  }
  return out;
}

/**
 * A place two books print, over every row at once (`rows`: id -> row).
 *
 * The pair is declared once, as `meta.sameAs` on the EARLIER book's location
 * row, naming a row of a later book (`laterBook`) of the same kind and place
 * role. Declaring it on the earlier side is what keeps it from being declared
 * from both. Books whose years tie, or that carry none, cannot be paired. Every
 * pair carries the reviewer's `meta.unique`: the 1-based ordinals of the
 * earlier printing's paragraphs that the later one lacks, positive and
 * unrepeated, `[]` for none. A book pairs one row with each later place.
 * Neither side binds onto a market or an adventure (`meta.market`,
 * `meta.place`): a pair joins two places the importer builds, and that row
 * builds none.
 */
export function pairProblems(rows) {
  const out = [];
  const claimed = new Map(); // `${book} ${target}` -> first row id
  for (const r of rows.values()) {
    const { id, meta = {} } = r;
    const { sameAs, unique } = meta;
    if (sameAs === undefined) {
      if (unique !== undefined) out.push(`${id}: meta.unique belongs beside meta.sameAs`);
      continue;
    }
    if (r.kind !== "kind.location") out.push(`${id}: meta.sameAs pairs places; it belongs on a location row only`);
    if (typeof sameAs !== "string" || !ROW_ID.test(sameAs)) {
      out.push(`${id}: meta.sameAs is one row id of another book`);
      continue;
    }
    const other = bookOf(sameAs);
    if (other === r.book) out.push(`${id}: meta.sameAs pairs with another book's row, never one of ${r.book}`);
    else {
      const later = laterBook(r.book, other);
      if (later === null) out.push(`${id}: no printing year orders ${r.book} and ${other}; a pair between them waits until the register records which came first`);
      else if (later !== other) out.push(`${id}: meta.sameAs is declared on the earlier book's row, and ${other} is earlier than ${r.book}`);
    }
    const t = rows.get(sameAs);
    if (!t) out.push(`${id}: meta.sameAs names ${sameAs}, which no row defines`);
    else {
      if (t.kind !== r.kind) out.push(`${id}: meta.sameAs names ${sameAs}, a row of another kind`);
      if ((t.meta?.role ?? null) !== (meta.role ?? null)) out.push(`${id}: meta.sameAs names ${sameAs}, a place of another role`);
      if (t.meta?.market !== undefined || t.meta?.place !== undefined) out.push(`${id}: meta.sameAs names ${sameAs}, which binds onto a market or an adventure and builds no place to pair`);
    }
    if (meta.market !== undefined || meta.place !== undefined) out.push(`${id}: a row bound onto a market or an adventure builds no place to pair`);
    const key = `${r.book} ${sameAs}`;
    if (claimed.has(key)) out.push(`${id}: ${sameAs} is already paired with ${claimed.get(key)}; one place is one row per book`);
    else claimed.set(key, id);
    if (unique === undefined) out.push(`${id}: a pair carries meta.unique, the reviewer's list of this printing's paragraphs the later one lacks ([] for none)`);
    else if (!Array.isArray(unique) || !unique.every((n) => Number.isInteger(n) && n > 0)) out.push(`${id}: meta.unique is a list of 1-based paragraph ordinals`);
    else if (new Set(unique).size !== unique.length) out.push(`${id}: meta.unique repeats an ordinal`);
  }
  return out;
}

/**
 * A market grid's columns that say which place they are (`meta.markets`), over
 * every row at once. Each key is one of the grid's own column keys and names
 * exactly one of `sameAs` or `place`. `sameAs` pairs the column's market with
 * a place a later book's (`laterBook`) own steps claim (`pairTargetProblem`);
 * the pair is declared on the earlier book's grid for the reason a place pair
 * is, and a later place pairs with one row of a book, the location rows that
 * pair with it counted. `place` is the book's own settlement ("adventure") or
 * a location row of the same book that builds a place.
 */
export function marketColumnProblems(rows) {
  const out = [];
  const claimed = new Map(); // `${book} ${target}` -> the row (and column) that pairs with it
  for (const r of rows.values()) if (typeof r.meta?.sameAs === "string") claimed.set(`${r.book} ${r.meta.sameAs}`, r.id);
  for (const r of rows.values()) {
    const { id, meta = {} } = r;
    if (meta.markets === undefined) continue;
    if (r.kind !== "kind.marketGrid") {
      out.push(`${id}: meta.markets names a market grid's columns; it belongs on a market grid row only`);
      continue;
    }
    if (!meta.markets || typeof meta.markets !== "object" || Array.isArray(meta.markets)) {
      out.push(`${id}: meta.markets maps a column key to what it names`);
      continue;
    }
    const cols = marketKeysOf(r);
    for (const [col, named] of Object.entries(meta.markets)) {
      const at = `${id}: meta.markets.${col}`;
      if (!cols.has(col)) out.push(`${at} is no market of the grid`);
      const keys = Object.keys(named ?? {});
      if (keys.length !== 1 || !["sameAs", "place"].includes(keys[0])) {
        out.push(`${at} names exactly one of sameAs or place`);
        continue;
      }
      if (named.place !== undefined) {
        const to = named.place;
        if (to === "adventure") continue;
        if (typeof to !== "string" || !ROW_ID.test(to) || bookOf(to) !== r.book) {
          out.push(`${at}.place is "adventure" or the id of a row of ${r.book}`);
          continue;
        }
        const t = rows.get(to);
        if (!t) out.push(`${at}.place names ${to}, which no row defines`);
        else if (t.kind !== "kind.location") out.push(`${at}.place names ${to}, which builds no place`);
        else if (t.meta?.market !== undefined || t.meta?.place !== undefined) out.push(`${at}.place names ${to}, which binds onto another place and builds none`);
        continue;
      }
      const to = named.sameAs;
      if (typeof to !== "string" || !ROW_ID.test(to)) {
        out.push(`${at}.sameAs is one row id of another book`);
        continue;
      }
      const other = bookOf(to);
      if (other === r.book) out.push(`${at}.sameAs pairs with another book's market, never one of ${r.book}`);
      else {
        const later = laterBook(r.book, other);
        if (later === null) out.push(`${at}: no printing year orders ${r.book} and ${other}; a pair between them waits until the register records which came first`);
        else if (later !== other) out.push(`${at}.sameAs is declared on the earlier book's grid, and ${other} is earlier than ${r.book}`);
      }
      const problem = pairTargetProblem(rows, to);
      if (problem) out.push(`${at}.sameAs names ${to}, ${problem}`);
      const key = `${r.book} ${to}`;
      if (claimed.has(key)) out.push(`${at}: ${to} is already paired with ${claimed.get(key)}; one place is one row per book`);
      else claimed.set(key, `${id} ${col}`);
    }
  }
  return out;
}

/**
 * Why a grid column cannot pair with `to`, or null. A pair is found by the id
 * the later book's step claims the place under, so `to` is that id: a market's
 * (`<book>.mkt<n>`), which its record, a location row naming it
 * (`meta.market`) or its grid alone prints, or the row's own id for a location
 * that builds a place. A market a grid column lands on a place, and a location
 * bound onto a market or a settlement, are claimed under another id.
 */
function pairTargetProblem(rows, to) {
  const t = rows.get(to);
  if (t?.kind === "kind.marketRecord") return t.meta?.place === undefined ? null : "which binds onto its book's settlement and builds no market to pair";
  if (t?.kind === "kind.location") {
    if (t.meta?.market !== undefined) return `which is claimed as its market; pair with ${bookOf(to)}.${t.meta.market}`;
    return t.meta?.place === undefined ? null : "which binds onto its book's settlement and builds no place to pair";
  }
  if (t) return "which is no market record or place";
  const book = bookOf(to);
  const key = to.slice(book.length + 1);
  const ofBook = [...rows.values()].filter((r) => r.book === book);
  const lands = ofBook.find((r) => r.kind === "kind.marketGrid" && r.meta?.markets?.[key]?.place !== undefined);
  if (lands) return `which ${lands.id} lands on ${lands.meta.markets[key].place}; pair with that place`;
  if (ofBook.some((r) => r.kind === "kind.location" && r.meta?.market === key && r.meta?.place === undefined)) return null;
  if (ofBook.some((r) => r.kind === "kind.marketGrid" && marketKeysOf(r).has(key))) return null;
  return "which no row defines";
}

/** A market grid's market keys: its columns where it is transposed, else its row bands. */
const marketKeysOf = (r) =>
  new Set(Object.values(r.assists?.grids ?? {}).flatMap((g) => (g?.transpose ? g?.cols : g?.rowBands) ?? []).map((b) => b.key));

/**
 * The printing errors a book's market rows declare, each by an id
 * `docs/importer/ERRATA.md` holds. A grid's `meta.errata` names the markets whose figures the module
 * reads from a band other than the one printed beside the name: a market of
 * the grid, or one a row of the book claims (`meta.market`) whose figures no
 * band of any of its grids holds. A record's `meta.gridClassErratum` says the
 * grid's class for its row is the misprint, so the two are not a conflict.
 * @param {Map<string, object>} rows every register row, by id
 * @param {Set<string>} errataIds the ids `ERRATA.md` defines
 */
export function erratumProblems(rows, errataIds) {
  const out = [];
  const known = (id, at) => {
    if (typeof id !== "string" || !errataIds.has(id)) out.push(`${at} names ${JSON.stringify(id)}, which ERRATA.md does not define`);
  };
  const banded = new Map(); // book -> every market key a grid of it bands
  const claimed = new Map(); // book -> every market key a row of it claims
  for (const r of rows.values()) {
    if (r.kind === "kind.marketGrid") for (const k of marketKeysOf(r)) (banded.get(r.book) ?? banded.set(r.book, new Set()).get(r.book)).add(k);
    if (typeof r.meta?.market === "string") (claimed.get(r.book) ?? claimed.set(r.book, new Set()).get(r.book)).add(r.meta.market);
  }
  for (const r of rows.values()) {
    const { id, meta = {} } = r;
    if (meta.errata !== undefined) {
      if (r.kind !== "kind.marketGrid") out.push(`${id}: meta.errata names a market grid's corrected markets; it belongs on a market grid row only`);
      else if (!meta.errata || typeof meta.errata !== "object" || Array.isArray(meta.errata)) out.push(`${id}: meta.errata maps a market key to an erratum id`);
      else {
        const own = marketKeysOf(r);
        for (const [market, erratum] of Object.entries(meta.errata)) {
          const at = `${id}: meta.errata.${market}`;
          known(erratum, at);
          if (own.has(market)) continue;
          if (banded.get(r.book)?.has(market)) out.push(`${at} is a market another grid of ${r.book} bands`);
          else if (!claimed.get(r.book)?.has(market)) out.push(`${at} is no market of the grid, and no row of ${r.book} claims it`);
        }
      }
    }
    if (meta.gridClassErratum !== undefined) {
      if (r.kind !== "kind.marketRecord") out.push(`${id}: meta.gridClassErratum belongs on a market record only`);
      else known(meta.gridClassErratum, `${id}: meta.gridClassErratum`);
    }
  }
  return out;
}

/**
 * The erratum ids an `ERRATA.md` defines: each entry opens with a level-two
 * heading that is its id alone, so its anchor is the id.
 */
export const errataIdsOf = (markdown) =>
  new Set([...String(markdown ?? "").matchAll(/^##[ \t]+([a-z0-9]+(?:-[a-z0-9]+)*)[ \t]*$/gm)].map((m) => m[1]));

/**
 * Meta keys one row decides alone. `meta.revisedBy` sends a row's import to a
 * later printing, so it names a row of a book `laterBook` ranks after the
 * row's own. `meta.actor` binds a person to a core character instead of a
 * monster and is read off an npc row only, with the one value "character".
 */
export function rowMetaProblems(e) {
  const out = [];
  const { id = "?", meta = {} } = e;
  if (meta.revisedBy !== undefined) {
    const to = meta.revisedBy;
    if (typeof to !== "string" || !ROW_ID.test(to)) out.push(`${id}: meta.revisedBy is the row id of a later printing`);
    else if (laterBook(e.book, bookOf(to)) !== bookOf(to)) out.push(`${id}: meta.revisedBy names ${to}, and ${bookOf(to)} is not a later printing than ${e.book}`);
  }
  if (meta.actor !== undefined) {
    if (e.kind !== "kind.npc") out.push(`${id}: meta.actor belongs on an npc row only`);
    else if (meta.actor !== "character") out.push(`${id}: meta.actor ${JSON.stringify(meta.actor)} is not an actor a person binds to (character)`);
  }
  return out;
}

/**
 * The kinds that carry no printed word in their label or id: each row is
 * named `<label> <n>` with the id `<book>.<stem><n>`, and anchors by hash, or
 * not at all where it is geometry other rows locate.
 */
export const ORDINAL_KINDS = Object.freeze({
  "kind.pregen": { label: "PC", stem: "pc", anchor: "hash" },
  "kind.prose": { label: "Prose", stem: "prose", anchor: "hash" },
  "kind.adventureItem": { label: "Item", stem: "item", anchor: "hash" },
  "kind.sceneLink": { label: "Link", stem: "link", anchor: "none" },
});

/** A row of an `ORDINAL_KINDS` kind against its label, id and anchor rule. */
export function ordinalProblems(e, bookId) {
  const rule = ORDINAL_KINDS[e.kind];
  if (!rule) return [];
  const out = [];
  const id = e.id ?? "?";
  const n = new RegExp(`^${rule.label} (\\d+)$`).exec(e.name ?? "")?.[1];
  if (!n) out.push(`${id}: a ${e.kind.slice(5)} row is named "${rule.label} <n>"`);
  else if (id !== `${bookId}.${rule.stem}${n}`) out.push(`${id}: a row named "${rule.label} ${n}" has the id "${bookId}.${rule.stem}${n}"`);
  if (rule.anchor === "hash" && e.anchor?.hash === undefined) out.push(`${id}: a ${e.kind.slice(5)} row anchors by hash, never by its printed words`);
  if (rule.anchor === "none" && e.anchor !== undefined) out.push(`${id}: a ${e.kind.slice(5)} row has no text anchor; its scenes locate it`);
  return out;
}

/**
 * A region's keyed site. A site its page keys by number anchors by that
 * number (checked with every number-anchored row); a site printed under a
 * run-in title anchors by hash with `as: "runin"` and is labelled and
 * identified by its ordinal, `Site <n>` and `<book>.site<n>`.
 */
export function siteProblems(e, bookId) {
  if (e.anchor?.number !== undefined) return [];
  const id = e.id ?? "?";
  if (e.anchor?.hash === undefined || e.anchor.as !== "runin") {
    return [`${id}: a keyed site anchors by its key number, or by hash with as "runin" where its page prints a title, never by its printed words`];
  }
  const n = /^Site (\d+)$/.exec(e.name ?? "")?.[1];
  if (!n) return [`${id}: a site anchored by hash is named "Site <n>"`];
  return id === `${bookId}.site${n}` ? [] : [`${id}: a site named "Site ${n}" has the id "${bookId}.site${n}"`];
}

/** The keys a scene link's block, and each of its ends, may carry. */
const LINK_KEYS = new Set(["mode", "ends", "both", "confirm", "note"]);
const END_KEYS = new Set(["scene", "box", "level", "place", "note"]);
/** How far apart, in page points, the boxes of a level link's ends may sit once each is carried to the first storey. */
const LEVEL_BOX_SLACK = 0.5;

/** The page corner of storey `level` of a scene recipe: its crop's for 0, else that `levels` corner. */
const storeyCorner = (scene, level) => (level ? scene?.levels?.[level - 1] : scene?.crop);
/** How a link moves a token: to another scene, or to another level of one. */
export const LINK_MODES = Object.freeze(["teleport", "level"]);

/**
 * A book's region maps (`isRegionRecipe`) among every row (`rows`: id -> row):
 * one at most. A grid plan that names no place reads as the region's map and
 * would stand on the region's place, so a second is a plan missing its
 * `place`.
 */
export function regionMapProblems(rows) {
  const out = [];
  const first = new Map(); // book -> the first region map's id
  for (const r of rows.values()) {
    if (r?.kind !== "kind.scene" || !isRegionRecipe(r.scene)) continue;
    const book = r.book ?? bookOf(r.id);
    if (!first.has(book)) first.set(book, r.id);
    else out.push(`${r.id}: a grid map that names no place is ${book}'s region map, and ${first.get(book)} already is one; a plan names the place it draws (scene.place)`);
  }
  return out;
}

/**
 * A scene link's block, against every row (`rows`: id -> row). Each end names
 * a scene row of any book, a box in that scene's page points lying on the
 * storey it is drawn on, optionally a level (a storey ordinal of a scene that
 * has `levels`: 0 is the crop's storey, n the n-th corner) and optionally the
 * place it stands for, a location row. A `level` link joins two or more levels
 * of one scene through one box, so its ends' boxes coincide once each is
 * carried to the first storey. The block names everything by id or number,
 * so no printed word can ride in it.
 */
export function sceneLinkProblems(e, rows) {
  const out = [];
  const id = e.id ?? "?";
  const link = e.link;
  if (!link || typeof link !== "object") return [`${id}: a scene link needs a "link" block`];
  for (const k of Object.keys(link)) if (!LINK_KEYS.has(k)) out.push(`${id}: link has an unknown key "${k}"`);
  if (!LINK_MODES.includes(link.mode)) out.push(`${id}: link.mode ${JSON.stringify(link.mode)} is not a way a link moves a token (${LINK_MODES.join("|")})`);
  for (const k of ["both", "confirm"]) if (link[k] !== undefined && typeof link[k] !== "boolean") out.push(`${id}: link.${k} is true or false`);
  if (!Array.isArray(link.ends) || link.ends.length < 2) return [...out, `${id}: link.ends lists two or more ends`];
  link.ends.forEach((end, i) => {
    const at = `link.ends[${i}]`;
    if (!end || typeof end !== "object") return void out.push(`${id}: ${at} is {scene, box, level?}`);
    for (const k of Object.keys(end)) if (!END_KEYS.has(k)) out.push(`${id}: ${at} has an unknown key "${k}"`);
    const b = end.box;
    if (!b || !["x0", "x1", "y0", "y1"].every((k) => isNum(b[k])) || b.x0 >= b.x1 || b.y0 >= b.y1) {
      out.push(`${id}: ${at}.box is {x0, x1, y0, y1} with x0 < x1 and y0 < y1`);
    }
    if (end.level !== undefined && !(Number.isInteger(end.level) && end.level >= 0)) out.push(`${id}: ${at}.level is a storey ordinal, 0 or more`);
    if (end.place !== undefined) {
      const place = rows.get(end.place);
      if (typeof end.place !== "string" || !ROW_ID.test(end.place)) out.push(`${id}: ${at}.place is a location row's id`);
      else if (place?.kind !== "kind.location") out.push(`${id}: ${at}.place names ${end.place}, which is no location row`);
    }
    const scene = typeof end.scene === "string" ? rows.get(end.scene) : undefined;
    if (typeof end.scene !== "string" || !ROW_ID.test(end.scene)) return void out.push(`${id}: ${at}.scene is a scene row's id`);
    if (scene?.kind !== "kind.scene") return void out.push(`${id}: ${at}.scene names ${end.scene}, which is no scene row`);
    const storeys = Array.isArray(scene.scene?.levels) && scene.scene.levels.length ? scene.scene.levels.length + 1 : 0;
    if (end.level !== undefined && Number.isInteger(end.level) && end.level >= storeys) out.push(`${id}: ${at}.level ${end.level} is not a level of ${end.scene}`);
    const corner = storeyCorner(scene.scene, Number.isInteger(end.level) ? end.level : 0);
    const crop = scene.scene?.crop;
    if (b && crop && isNum(corner?.x) && isNum(corner?.y) && (b.x0 < corner.x || b.y0 < corner.y || b.x1 > corner.x + crop.w || b.y1 > corner.y + crop.h)) {
      out.push(`${id}: ${at}.box does not lie on ${end.scene}'s ${end.level ? `storey ${end.level}` : "picture"}`);
    }
  });
  if (link.mode === "level") {
    const scenes = new Set(link.ends.map((end) => end?.scene));
    const levels = link.ends.map((end) => end?.level);
    if (scenes.size !== 1) out.push(`${id}: a level link joins levels of one scene`);
    if (levels.some((l) => l === undefined) || new Set(levels).size !== levels.length) out.push(`${id}: every end of a level link names a different level`);
    const scene = rows.get(link.ends[0]?.scene)?.scene;
    const firstStorey = link.ends.map((end) => {
      const corner = storeyCorner(scene, end?.level);
      const b = end?.box;
      return corner && b ? [b.x0 - corner.x, b.y0 - corner.y, b.x1 - corner.x, b.y1 - corner.y] : null;
    });
    if (scenes.size === 1 && firstStorey.every(Boolean) && firstStorey.some((r) => r.some((v, k) => Math.abs(v - firstStorey[0][k]) > LEVEL_BOX_SLACK))) {
      out.push(`${id}: a level link's ends stand on one spot of every storey, so their boxes coincide once each is carried to the first storey`);
    }
  }
  return out;
}
