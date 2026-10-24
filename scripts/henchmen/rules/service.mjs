/**
 * What a hireling's record reads as — the plain decisions behind the Service
 * panel a hireling's own sheet carries and behind a row of the employer's
 * roster. Pure: every input is a plain value or a HenchmanRecord-shaped
 * object, so `tools/test-service-view.mjs` pins each decision without a world.
 * The Foundry readers that feed these are `scripts/henchmen/service-view.mjs`.
 */
import { sumPermanents, isActivePermanent, clampScore } from "./loyalty.mjs";
import { clampPct, num, signed } from "../../lib/frame-model.mjs";

/** The roster's filter keys, in strip order; each but `all` is a bucket of `bucketOf`. */
export const ROSTER_FILTERS = Object.freeze(["all", "henchmen", "mercenaries", "specialists"]);

/** The bucket a retainer category sorts into; anything unnamed is a henchman. */
export function bucketOf(category) {
  if (category === "mercenary") return "mercenaries";
  if (category === "specialist") return "specialists";
  return "henchmen";
}

/** Whether a hireling of this category keeps a loyalty score and takes a henchman's throws. */
export const keepsLoyalty = (category) => bucketOf(category) === "henchmen";

/**
 * The wage clock's reading. `lastPaid` null is a clock never started (an
 * enrolled hireling owes nothing until the engine adopts them); otherwise
 * `behind` is whole months owed, `pct` the fill of the month under way (full
 * while behind), `sinceDays` the days since the last payday and `untilDays`
 * the days until the next falls due (0 while behind, 1 at the least).
 * @param {{lastPaid: number|null, now: number, month: number, day: number}} clock
 */
export function wageClock({ lastPaid, now, month, day }) {
  if (lastPaid == null || !Number.isFinite(Number(lastPaid))) {
    return { unset: true, behind: 0, pct: 0, tone: null, sinceDays: null, untilDays: null };
  }
  const elapsed = Math.max(0, num(now) - Number(lastPaid));
  const behind = month > 0 ? Math.floor(elapsed / month) : 0;
  const into = elapsed - behind * month;
  return {
    unset: false,
    behind,
    pct: behind > 0 ? 100 : clampPct((into / month) * 100),
    tone: behind > 0 ? "neg" : null,
    sinceDays: day > 0 ? Math.floor(elapsed / day) : 0,
    untilDays: behind > 0 ? 0 : Math.max(1, Math.ceil((month - into) / day)),
  };
}

/**
 * The pieces an effective loyalty is summed from: the start at hiring, the
 * permanents still counting (and how many entries count), the employer's
 * Charisma and the employer's powers. `total` is the clamped sum.
 * @param {object} record HenchmanRecord-shaped
 * @param {{chaLoyalty?: number, baseLoyaltyBonus?: number}} mods
 */
export function loyaltyParts(record, mods = {}) {
  const permanents = record?.loyalty?.permanents ?? [];
  const start = num(record?.loyalty?.start);
  const sum = sumPermanents(permanents);
  const cha = num(mods.chaLoyalty);
  const powers = num(mods.baseLoyaltyBonus);
  return {
    start,
    permanents: sum,
    uncompensated: permanents.filter(isActivePermanent).length,
    cha,
    powers,
    total: clampScore(start + sum + cha + powers),
  };
}

/**
 * The pieces of an effective morale: the base (the record's, else the
 * sheet's), the permanents still counting, and the employer's `moraleBase`
 * powers handed in as `powers`. `total` clamps base and permanents, then
 * clamps again with the powers added, as `effectiveMoraleFor` does.
 */
export function moraleParts(record, fallbackBase = 0, powers = 0) {
  const base = num(record?.morale?.base, num(fallbackBase));
  const permanents = sumPermanents(record?.morale?.permanents ?? []);
  const bonus = num(powers);
  return { base, permanents, powers: bonus, total: clampScore(clampScore(base + permanents) + bonus) };
}

/**
 * Both permanent ledgers as rows, newest first, each carrying the
 * coordinates the compensate toggle writes back through (`track` + `index`
 * into that track's stored array). Words are left to the reader.
 */
export function ledgerEntries(record) {
  return ["loyalty", "morale"].flatMap((track) =>
    (record?.[track]?.permanents ?? [])
      .map((entry, index) => {
        const delta = num(entry.delta);
        return {
          track,
          index,
          compensated: !!entry.compensated,
          delta,
          signed: signed(delta),
          tone: delta < 0 ? "neg" : delta > 0 ? "pos" : null,
          reason: entry.reason ?? "",
          note: entry.note ?? "",
          time: entry.time ?? null,
        };
      })
      .reverse()
  );
}

/**
 * How a share is said: `half`, `full`, `none`, or a `pct` with its figure.
 * The record stores the fraction; this only decides the word for it.
 */
export function shareKind(fraction) {
  const n = Number(fraction);
  if (!Number.isFinite(n)) return { kind: "none", pct: 0 };
  if (n === 0.5) return { kind: "half", pct: 50 };
  if (n >= 1) return { kind: "full", pct: 100 };
  if (n <= 0) return { kind: "none", pct: 0 };
  return { kind: "pct", pct: Math.round(n * 100) };
}

/**
 * The terms as the panel reads them: the wage in force (the record's agreed
 * figure, else the sheet's, else the ladder's handed in as `ladder` for a
 * henchman alone), its basis, the two shares, the signing bonus and the
 * arrears. `wageUnset` is a wage that comes to nothing, which bills nothing.
 * `wageFrom` names where the wage in force came from — `agreed`, `sheet`,
 * `ladder`, or null for none — and `sharesDefaulted` is a share the record
 * never stated, read at the default instead.
 * @param {object} record HenchmanRecord-shaped
 * @param {{sheetWage?: unknown, ladder?: number, category?: string}} given
 */
export function termsOf(record, { sheetWage = null, ladder = 0, category = "henchman" } = {}) {
  const terms = record?.terms ?? {};
  const agreed = Number(terms.wageGp ?? sheetWage);
  const wage = agreed > 0 ? agreed : keepsLoyalty(category) ? num(ladder) : 0;
  const wageFrom = agreed > 0 ? (terms.wageGp != null ? "agreed" : "sheet") : wage > 0 ? "ladder" : null;
  return {
    wage,
    wageUnset: !(wage > 0),
    wageFrom,
    sharesDefaulted: terms.treasureShare == null || terms.xpShare == null,
    basis: terms.wageBasis ?? "level",
    treasureShare: shareKind(terms.treasureShare ?? 0.5),
    xpShare: shareKind(terms.xpShare ?? 0.5),
    signingBonus: num(terms.signingBonusGp),
    arrears: num(terms.arrearsGp),
    claimedEmployerLevel: terms.claimedEmployerLevel ?? null,
  };
}

/** The six scores a hire records, in the order `rolledOf` prints them. */
export const ROLLED_SCORES = Object.freeze(["str", "int", "wil", "dex", "con", "cha"]);

/** The recorded rolls as the panel prints them: the six scores in order, or null where none was recorded. */
export function rolledOf(record) {
  const r = record?.rolled ?? {};
  const a = r.attributes ?? {};
  const keys = ROLLED_SCORES;
  const scores = keys.every((k) => a[k] == null) ? null : keys.map((k) => (a[k] == null ? "—" : String(a[k])));
  return {
    scores,
    classKey: r.classKey ?? "",
    level: r.level ?? null,
    template: r.template ?? "",
    hpRoll: r.hpRoll ?? null,
    any: !!(scores || r.classKey || r.level != null || r.template),
  };
}

/**
 * Whether this hireling takes a henchman slot: `counted`, `noSlot` (a
 * companion the record exempts) or `none` for a category that never does.
 * Mirrors the count `checkHenchmanLimit` keeps.
 */
export function slotOf(record, category = "henchman") {
  if (!keepsLoyalty(category)) return "none";
  return record?.special?.noSlot ? "noSlot" : "counted";
}

/** The Service tab's badge: one while a calamity's loyalty throw is owed, else nothing. */
export const serviceBadge = (record) => (record?.special?.pendingCalamity ? 1 : 0);

/** The rows of a roster the filter keeps; `all` keeps every row. */
export function filterRows(rows, filter = "all") {
  if (!ROSTER_FILTERS.includes(filter) || filter === "all") return rows;
  return rows.filter((r) => r.bucket === filter);
}

/** How many rows each filter would keep, keyed by filter. */
export function filterCounts(rows) {
  return Object.fromEntries(ROSTER_FILTERS.map((f) => [f, filterRows(rows, f).length]));
}
