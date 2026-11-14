/**
 * The pure half of the import kind declaration: which kind owns a cookbook
 * claim, and which importer runs a scope of work needs. Pure, so it runs
 * without Foundry; `cookbook/rebuild.mjs` declares the kinds (`IMPORT_KINDS`) and
 * supplies the live reads each kind's `owns`, `book` and `books` close over.
 *
 * A kind is one family of imported documents and the run that makes it:
 *
 *  - `key`       the kind's name; the entry picker's source key where it has one
 *  - `owns`      `(claim) => boolean`: whether the kind owns that cookbook claim
 *  - `book`      `(claim) => string|null`: the book the claim is read from
 *  - `books`     `() => string[]`, optional: the books the kind holds claims
 *                from; read off `entries` and `book` when the kind omits it
 *  - `entries`   `() => [claim, entry][]`: the claims the kind can name
 *  - `make`      `{run, takes, whole?}`: the importer run that re-creates the
 *                kind. `takes` lists how a narrowed call names its work (`only`,
 *                `ids`, `books`); `whole` is the unnarrowed run where it is not
 *                `run`
 *  - `shelves`   the shelves the kind's documents file on
 *  - `chain`     the key of the import chain step that runs the kind
 *  - `bookSteps` the steps one adventure book's run reports the kind under
 *  - `own`       the kind's claims are a book's own rows, not content rows
 *  - `viaBook`   a book scope names the kind's claims
 */

/** The run that walks one book's own steps (its creatures, pages, places, tables); a book scope names it for the book's own rows. */
export const ADVENTURE_BOOK_RUN = "runAdventureBookSteps";

/**
 * A claim and its dot-ancestors that could name an entry, longest first: a row
 * filed beneath its entry (`<entry>.<row>`) is found under the entry's id. A
 * single segment names no entry.
 * @param {string} claim
 * @returns {string[]}
 */
export function ancestorsOf(claim) {
  const parts = String(claim ?? "").split(".");
  const out = [];
  for (let n = parts.length; n >= 2; n--) out.push(parts.slice(0, n).join("."));
  return out;
}

/** The cookbook id of the generator a book's per-step blocks are gathered into. */
export const groupId = (bookId, key) => `${bookId}.group.${key}`;

/** The book a `groupId` names, or null for any other id. */
export function groupBookOf(id) {
  const m = /^(.+)\.group\.[^.]+$/.exec(String(id ?? ""));
  return m ? m[1] : null;
}

/**
 * Every kind that owns a claim. A sound declaration answers at most one; the
 * count is the check, so a first match never hides an overlap.
 * @param {object[]} kinds the kind declaration
 * @param {string} claim a cookbook id
 * @returns {object[]}
 */
export const ownersOf = (kinds, claim) => kinds.filter((kind) => kind.owns(claim));

/**
 * The one kind that owns a claim, or null where none does. Two owners are a
 * declaration bug and throw.
 * @param {object[]} kinds the kind declaration
 * @param {string} claim a cookbook id
 * @returns {object|null}
 */
export function kindOf(kinds, claim) {
  const owners = ownersOf(kinds, claim);
  if (owners.length > 1) throw new Error(`import kinds: "${claim}" is owned by ${owners.map((kind) => kind.key).join(", ")}`);
  return owners[0] ?? null;
}

/**
 * Every document that claims a set of ids, arranged for writes that hold one
 * document per claim at a time. A document claims an id when its own claim is
 * the id or a row filed beneath it (`<id>.<row>`); it is held under its own
 * claim, since a build writes over the document holding the claim it stamps.
 * Pass `n` holds the `n`th document of each claim, so a claim two documents
 * answer is written on both. A row beneath the id whose claim another kind
 * owns, or no one kind owns, is `foreign` and held by no pass; where the id
 * itself has no one owning kind, every claimer is held. An id no document
 * claims exactly is `missing`.
 *
 * @param {string[]} ids the cookbook ids to write
 * @param {object[]} docs the library's documents to look through
 * @param {object} how
 * @param {(doc: object) => string} how.claimOf a document's own cookbook claim, "" for none
 * @param {object[]} [how.kinds] the kind declaration; omitted, every claimer is held
 * @returns {{passes: Map<string, object>[], missing: string[], foreign: object[]}}
 */
export function claimerPasses(ids, docs, { claimOf, kinds = null }) {
  const kindKey = (claim) => {
    if (!kinds) return null;
    const owners = ownersOf(kinds, claim);
    return owners.length === 1 ? owners[0].key : undefined;
  };
  const byClaim = new Map();
  const foreign = [];
  const missing = [];
  for (const id of ids) {
    const want = kindKey(id);
    let exact = false;
    for (const doc of docs) {
      const claim = claimOf(doc);
      if (claim !== id && !claim.startsWith(`${id}.`)) continue;
      if (want && claim !== id && kindKey(claim) !== want) {
        if (!foreign.includes(doc)) foreign.push(doc);
        continue;
      }
      if (claim === id) exact = true;
      if (!byClaim.has(claim)) byClaim.set(claim, []);
      if (!byClaim.get(claim).includes(doc)) byClaim.get(claim).push(doc);
    }
    if (!exact) missing.push(id);
  }
  const passes = [];
  for (const [claim, held] of byClaim) {
    held.forEach((doc, n) => {
      if (!passes[n]) passes[n] = new Map();
      passes[n].set(claim, doc);
    });
  }
  return { passes, missing, foreign };
}

/** The books a kind holds claims from: its own `books`, else those its entries' claims are read from. */
export const booksOfKind = (kind) =>
  kind.books ? kind.books() : [...new Set(kind.entries().map(([claim]) => kind.book(claim)).filter(Boolean))];

/** Group kinds into runs: kinds that share a run name share one run, kept in declaration order. */
function groupRuns(kinds, runOf) {
  const runs = new Map();
  for (const kind of kinds) {
    const run = runOf(kind);
    if (!runs.has(run)) runs.set(run, { run, kinds: [] });
    runs.get(run).kinds.push(kind.key);
  }
  return [...runs.values()];
}

/** Sort runs by `rank`, a negative rank last; a stable sort, so equal ranks keep their order. */
const ranked = (runs, rank) => {
  const at = (run) => {
    const n = rank(run);
    return n < 0 ? Infinity : n;
  };
  return [...runs].sort((a, b) => at(a) - at(b));
};

/**
 * The importer runs one scope of work needs, derived from the kind declaration.
 *
 *  - `{shelf}`    the run that refills the shelf, whole
 *  - `{book}`     the runs of the kinds a book scope names (`viaBook`), each
 *                 carrying the book's claims of that kind, in `order.book`;
 *                 a book's own rows (its creatures, pages, places, tables)
 *                 are one `ADVENTURE_BOOK_RUN` instead, so nothing is counted
 *                 twice
 *  - `{entries}`  the runs of the ticked ids' kinds, each carrying its ids
 *  - `{all}`      every kind's whole run once, in the order of `order.all`
 *
 * A run is `{run, kinds, ids?, book?}`. An id no kind owns is returned in
 * `unowned` and reaches no run.
 *
 * @param {{shelf: string}|{book: string}|{entries: string[]}|{all: true}} scope
 * @param {object} world
 * @param {object[]} world.kinds the kind declaration
 * @param {{book?: string[], all?: string[]}} [world.order] `book`: the run names in the order a book scope runs them;
 *   `all`: the import chain's step keys in order
 * @returns {{runs: {run: string, kinds: string[], ids?: string[], book?: string}[], unowned: string[]}}
 */
export function runSetFor(scope, { kinds, order = {} }) {
  const keyed = (key) => kinds.find((kind) => kind.key === key);
  if ("shelf" in scope) {
    const owners = kinds.filter((kind) => kind.shelves?.includes(scope.shelf));
    return { runs: groupRuns(owners, (kind) => kind.make.run), unowned: [] };
  }
  if ("book" in scope) {
    const { book } = scope;
    const named = kinds.filter((kind) => booksOfKind(kind).includes(book));
    const steps = named.filter((kind) => kind.own && kind.bookSteps?.length);
    const plain = named.filter((kind) => kind.viaBook && !steps.includes(kind));
    const grouped = groupRuns(plain, (kind) => kind.make.run);
    for (const run of grouped) {
      run.ids = run.kinds.flatMap((key) => {
        const kind = keyed(key);
        return kind.entries().map(([claim]) => claim).filter((claim) => kind.book(claim) === book);
      });
    }
    const runs = ranked(grouped, (run) => (order.book ?? []).indexOf(run.run));
    if (steps.length) runs.push({ run: ADVENTURE_BOOK_RUN, kinds: steps.map((kind) => kind.key), book });
    return { runs, unowned: [] };
  }
  if ("entries" in scope) {
    const buckets = new Map();
    const unowned = [];
    for (const claim of scope.entries) {
      const kind = kindOf(kinds, claim);
      if (!kind) {
        unowned.push(claim);
        continue;
      }
      if (!buckets.has(kind.make.run)) buckets.set(kind.make.run, { run: kind.make.run, kinds: [], ids: [] });
      const bucket = buckets.get(kind.make.run);
      if (!bucket.kinds.includes(kind.key)) bucket.kinds.push(kind.key);
      bucket.ids.push(claim);
    }
    const first = (run) => Math.min(...run.kinds.map((key) => kinds.indexOf(keyed(key))));
    return { runs: [...buckets.values()].sort((a, b) => first(a) - first(b)), unowned };
  }
  if (scope.all === true) {
    const chain = order.all ?? [];
    const stepOf = (run) => {
      const at = run.kinds.map((key) => chain.indexOf(keyed(key).chain)).filter((n) => n >= 0);
      return at.length ? Math.min(...at) : -1;
    };
    return { runs: ranked(groupRuns(kinds, (kind) => kind.make.whole ?? kind.make.run), stepOf), unowned: [] };
  }
  throw new TypeError("import kinds: a scope is {shelf}, {book}, {entries} or {all: true}");
}
