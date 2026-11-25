/**
 * The power ledger: divine and arcane power an actor has gained and spent, kept
 * apart from the casting pools (a rest clears those; this is not cleared by
 * one). Foundry-free: every clock reading, lifetime, permission and write is an
 * argument or a dependency, so a test or a consumer supplies its own.
 *
 * The record is `flags["acks-extras"].power = {divine: {entries}, arcane:
 * {entries, count}}`. An ENTRY is `{id, amount, day, name, img, ref, by, user}`: a
 * positive `amount` is power gained, a negative one power spent; `day` is the
 * calendar day it was written (lib `world-time` `dayOfWorldTime`), `name` and
 * `img` are the source's (a victim, a ritual), `ref` is the cast or project that
 * caused it, `by: "judge"` marks a figure set by hand (the stored value is the
 * mark; whoever pressed is `user`, a user id, blank where none was given). A gain marked `stays: true` is a permanent lot: it carries no
 * lifetime, so it never expires, and the key is written only on such a gain. A
 * spend marked `fromStays: true` draws only on the lots that stay (the minus on a
 * tag whose switch is Stays), and the key is written only on such a spend. Entries
 * append in the order they happened; a press by hand folds into the kind's last
 * entry where the same user wrote it the same day with the same sign and mark.
 *
 * Nothing here is a figure: the lifetime is an imported span (`{count, unit}`,
 * `research-tables.mjs`), converted to days by the calendar the world runs, and a
 * span that is absent, unreadable or not convertible means nothing expires. The
 * balance is a pure function of `(entries, today, span)`: spent power takes from
 * the oldest fading lot that still stands and only then from the lots that stay,
 * a fading lot expires once a whole span of days has passed since its day, and
 * nothing is written when time moves. Arcane power's
 * lifetime has a unit and no count on its page, so its count is a hand-written
 * field of the ledger (`arcane.count`), blank until set.
 */
import { powerEntry } from "../lib/bucket.mjs";

/** The two powers the ledger keeps. */
export const POWER_KIND = Object.freeze({ divine: "divine", arcane: "arcane" });

/** Every kind, in the order a strip draws them. */
export const POWER_KINDS = Object.freeze([POWER_KIND.divine, POWER_KIND.arcane]);

/** The operations a relayed request names. */
export const POWER_OP = Object.freeze({ gain: "gain", spend: "spend", undo: "undo", count: "count" });

/** The key a bucket's power row carries after `power:` (`powerEntry`'s uuid). */
export const POWER_ROW_PREFIX = "power:";

/** The units a span's word may name; any other is not a unit the ledger converts. */
const SPAN_UNITS = Object.freeze(["day", "week", "month", "year"]);

const isKind = (kind) => POWER_KINDS.includes(kind);

/** A whole number, truncated toward zero; 0 for anything that is not a finite number. */
const whole = (n) => {
  const v = Math.trunc(Number(n));
  return Number.isFinite(v) ? v : 0;
};

/** A day stamp: a finite whole number, else null (a stampless lot never expires). */
const dayOf = (n) => (n === null || n === undefined || n === "" || !Number.isFinite(Number(n)) ? null : Math.trunc(Number(n)));

/**
 * One stored entry cleaned to its shape, or null for one that moves no power.
 * `stays: true` survives only on a gain and `fromStays: true` only on a spend;
 * every other use and value of either key is dropped, so a stored entry that never
 * had the key reads as it always did. `user` is the id of the user who pressed,
 * blank where the entry has none.
 */
export function cleanEntry(raw) {
  const amount = whole(raw?.amount);
  if (!raw || typeof raw !== "object" || amount === 0 || typeof raw.id !== "string" || !raw.id) return null;
  return {
    id: raw.id,
    amount,
    day: dayOf(raw.day),
    name: String(raw.name ?? ""),
    img: String(raw.img ?? ""),
    ref: String(raw.ref ?? ""),
    by: raw.by === "judge" ? "judge" : "",
    user: typeof raw.user === "string" ? raw.user : "",
    ...(raw.stays === true && amount > 0 ? { stays: true } : {}),
    ...(raw.fromStays === true && amount < 0 ? { fromStays: true } : {}),
  };
}

/** A count of the arcane lifetime: a whole number of at least one, else null (blank). */
export function cleanCount(raw) {
  const n = raw === null || raw === undefined || raw === "" ? NaN : Math.trunc(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/**
 * The stored flag, cleaned: `{divine: {entries}, arcane: {entries, count}}`.
 * An unknown shape reads as an empty ledger, and an entry that moves nothing is dropped.
 */
export function readLedger(raw) {
  const list = (kind) => (Array.isArray(raw?.[kind]?.entries) ? raw[kind].entries : []).map(cleanEntry).filter(Boolean);
  return { divine: { entries: list(POWER_KIND.divine) }, arcane: { entries: list(POWER_KIND.arcane), count: cleanCount(raw?.arcane?.count) } };
}

/**
 * A span of `{count, unit}` as whole days. `unitDays` maps each unit word to the
 * days one of it is in the calendar the world runs; a unit it does not map, a
 * count that is not positive and a span that is absent are null, which means
 * nothing expires. A fraction of a day rounds up.
 */
export function spanDays(lifetime, unitDays) {
  const count = Number(lifetime?.count);
  const unit = String(lifetime?.unit ?? "");
  const per = Number(unitDays?.[unit]);
  if (!SPAN_UNITS.includes(unit) || !Number.isFinite(count) || !(count > 0) || !Number.isFinite(per) || !(per > 0)) return null;
  return Math.ceil(count * per);
}

/**
 * Every gain as a lot with what is left of it. Spent power takes from the lots
 * that fade before the lots that stay, each group oldest first, and only from a
 * lot that still stands on the spend's own day, so a lot that had expired by then
 * was never drawn on. A fading lot is expired once `span` whole days have passed
 * since its day (the day it is gained is day zero of it); with no span, or no
 * stamp, it never expires. A lot that stays is never expired and has no
 * `expiresDay`, whatever the span. A spend marked `fromStays` draws on the lots
 * that stay alone, oldest first, and never on a fading one.
 * @returns {Array<{id, name, img, ref, by, day, amount, left, stays, expiresDay, expired}>}
 */
export function standing(entries, today, span = null) {
  const keeps = (lot, at) => lot.stays || span === null || lot.day === null || at === null || at - lot.day < span;
  const lots = [];
  for (const e of entries ?? []) {
    if (e.amount > 0) {
      lots.push({ id: e.id, name: e.name, img: e.img, ref: e.ref, by: e.by, day: e.day, amount: e.amount, left: e.amount, stays: e.stays === true });
      continue;
    }
    let need = -e.amount;
    const order = e.fromStays ? lots.filter((l) => l.stays) : [...lots.filter((l) => !l.stays), ...lots.filter((l) => l.stays)];
    for (const lot of order) {
      if (need <= 0) break;
      if (lot.left <= 0 || !keeps(lot, e.day ?? today)) continue;
      const take = Math.min(lot.left, need);
      lot.left -= take;
      need -= take;
    }
  }
  return lots.map((lot) => ({ ...lot, expiresDay: lot.stays || span === null || lot.day === null ? null : lot.day + span, expired: !keeps(lot, today) }));
}

/** What an actor holds of one power today: the sum of what is left of every lot that has not expired. */
export const balanceOf = (entries, today, span = null) => standing(entries, today, span).reduce((n, lot) => (lot.expired ? n : n + lot.left), 0);

/** What an actor holds of one power in lots that stay: what is left of each, none of which expires. */
export const stayingBalanceOf = (entries, today, span = null) => standing(entries, today, span).reduce((n, lot) => (lot.stays && !lot.expired ? n + lot.left : n), 0);

/**
 * The next power to fade: `{day, amount, inDays}` for the soonest day a live lot
 * with something left expires, `amount` summing every such lot of that day. Null
 * when nothing stands that expires.
 */
export function nextExpiry(entries, today, span = null) {
  const live = standing(entries, today, span).filter((lot) => !lot.expired && lot.left > 0 && lot.expiresDay !== null);
  if (!live.length) return null;
  const day = Math.min(...live.map((lot) => lot.expiresDay));
  return { day, amount: live.filter((lot) => lot.expiresDay === day).reduce((n, lot) => n + lot.left, 0), inDays: today === null ? null : day - today };
}

/**
 * What a spend of `amount` comes to against a `balance`. Within the balance it
 * is as asked. Beyond it a Player is blocked and a Judge is warned: the Judge's
 * spend takes what is held (`amount`, maybe 0) and says `warn: "short"`, so the
 * ledger never goes below nothing.
 * @returns {{ok: boolean, amount?: number, warn?: string, reason?: string}}
 */
export function planSpend({ amount, balance, judge }) {
  const asked = whole(amount);
  if (asked < 1) return { ok: false, reason: "amount" };
  const held = Math.max(0, whole(balance));
  if (asked <= held) return { ok: true, amount: asked };
  return judge ? { ok: true, amount: held, warn: "short" } : { ok: false, reason: "short" };
}

/**
 * The ledger with one more entry on a kind, written after the entries it holds.
 * The entry is cleaned; one that moves nothing leaves the ledger as it was.
 */
export function withEntry(ledger, kind, entry) {
  const clean = cleanEntry(entry);
  if (!isKind(kind) || !clean) return ledger;
  return { ...ledger, [kind]: { ...ledger[kind], entries: [...ledger[kind].entries, clean] } };
}

/**
 * The entry a press by hand folds into, or null. It is the kind's last entry, and
 * only where that entry was written by hand by the same `user`, on the same `day`,
 * with the same sign and the same mark (`stays` for a gain, `fromStays` for a
 * spend). An entry with no user never folds, and no user never folds an entry.
 * @param {object[]} entries the kind's cleaned entries
 * @param {{user: string, amount: number, day: number|null, stays?: boolean, fromStays?: boolean}} press `amount` is signed
 */
export function foldTarget(entries, { user, amount, day, stays = false, fromStays = false }) {
  const last = entries?.at(-1);
  if (!last || !user || last.user !== user || last.by !== "judge" || last.day !== day) return null;
  if (last.amount > 0 !== amount > 0) return null;
  const same = amount > 0 ? (last.stays === true) === (stays === true) : (last.fromStays === true) === (fromStays === true);
  return same ? last : null;
}

/** The ledger with `amount` (signed) added to the entry of that id, which keeps its id and its day. */
export function withFolded(ledger, kind, id, amount) {
  if (!isKind(kind)) return ledger;
  return { ...ledger, [kind]: { ...ledger[kind], entries: ledger[kind].entries.map((e) => (e.id === id ? { ...e, amount: e.amount + amount } : e)) } };
}

/** The ledger without the entry of that id (the entry an undo takes back). */
export function withoutEntry(ledger, kind, id) {
  if (!isKind(kind)) return ledger;
  return { ...ledger, [kind]: { ...ledger[kind], entries: ledger[kind].entries.filter((e) => e.id !== id) } };
}

/** The ledger with arcane power's lifetime count set (`null` for blank). */
export const withArcaneCount = (ledger, count) => ({ ...ledger, arcane: { ...ledger.arcane, count: cleanCount(count) } });

/**
 * The bucket row for a power: lib's `powerEntry`, capped by the whole power held,
 * and null when nothing is held. `powerEntry` holds a quantity to its cap only
 * from a cap of one up, so a row built over no balance would count one; the
 * caller gets no row instead.
 * @param {{kind: string, name: string, balance: number, amount?: number, value?: object, fit?: string}} o
 */
export function powerRow({ kind, name, balance, amount = 1, value = null, fit = "" }) {
  const held = Math.floor(Number(balance));
  if (!isKind(kind) || !Number.isFinite(held) || held < 1) return null;
  return powerEntry({ key: kind, name, amount, balance: held, value, fit });
}

/** The kind a bucket's power row names (`power:divine`), or null for any other uuid. */
export function kindOfRow(uuid) {
  const key = String(uuid ?? "").startsWith(POWER_ROW_PREFIX) ? String(uuid).slice(POWER_ROW_PREFIX.length) : "";
  return isKind(key) ? key : null;
}

/**
 * Whether a relayed request may run, decided on who SENT it. `fromJudge` is true
 * for a request a GM's own client made (`judgeDeclares`); `owns` is whether the
 * sender owns the actor, Foundry's own test. Every operation, a hand press, an
 * undo and the arcane count included, is an owner's, and a Judge owns every actor;
 * a Player's spend over the balance is refused by `planSpend` where it runs.
 * @returns {{ok: true}|{refused: string}}
 */
export function checkPowerRequest(req, { actor, fromJudge, owns }) {
  if (!actor) return { refused: "noActor" };
  if (!isKind(req?.kind) && req?.op !== POWER_OP.count) return { refused: "kind" };
  if (!Object.values(POWER_OP).includes(req?.op)) return { refused: "op" };
  if (!fromJudge && !owns) return { refused: "owner" };
  return { ok: true };
}

/**
 * The operations on a ledger, over the dependencies of the place they run.
 * `deps`: `read(actor)` the stored flag, `write(actor, kind, next)` a direct
 * update of one kind, `canWrite(actor)`, `relay(request)` the GM's answer or
 * undefined, `today()` the calendar day, `isJudge()`, `lifetime(kind, ledger)`
 * the span in whole days or null, `newId()`, `userId()` the id of the user whose
 * client this is (the one a direct write records as having pressed).
 */
export function powerOps(deps) {
  const ledgerOf = (actor) => readLedger(deps.read(actor));
  const spanOf = (kind, ledger) => deps.lifetime?.(kind, ledger) ?? null;
  const balance = (actor, kind) => {
    const ledger = ledgerOf(actor);
    return isKind(kind) ? balanceOf(ledger[kind].entries, deps.today(), spanOf(kind, ledger)) : 0;
  };

  /**
   * Run one op here, on a ledger this client may write. `judge` is the requester's,
   * not this client's: it decides whether a short spend warns or is blocked.
   * `userId` is the id of the user who pressed, given by the caller (this client's
   * user on a direct write, the relay's attested sender on a relayed one) and never
   * read from `args`; an entry records it.
   */
  async function apply(actor, kind, op, args, judge, userId = "") {
    const ledger = ledgerOf(actor);
    const today = deps.today();
    if (op === POWER_OP.count) {
      await deps.write(actor, POWER_KIND.arcane, withArcaneCount(ledger, args.count).arcane);
      return { ok: true, count: cleanCount(args.count) };
    }
    if (!isKind(kind)) return { ok: false, reason: "kind" };
    const span = spanOf(kind, ledger);
    if (op === POWER_OP.gain) {
      const amount = whole(args.amount);
      if (amount < 1) return { ok: false, reason: "amount" };
      const by = args.by === "judge" ? "judge" : "";
      const stays = args.stays === true;
      const into = by ? foldTarget(ledger[kind].entries, { user: userId, amount, day: today, stays }) : null;
      if (into) {
        const next = withFolded(ledger, kind, into.id, amount);
        await deps.write(actor, kind, next[kind]);
        return { ok: true, id: into.id, amount, balance: balanceOf(next[kind].entries, today, span) };
      }
      const id = deps.newId();
      const next = withEntry(ledger, kind, { id, amount, day: today, name: args.name, img: args.img, ref: args.ref, by, user: userId, stays });
      await deps.write(actor, kind, next[kind]);
      return { ok: true, id, amount, balance: balanceOf(next[kind].entries, today, span) };
    }
    if (op === POWER_OP.spend) {
      const only = args.fromStays === true;
      const held = only ? stayingBalanceOf(ledger[kind].entries, today, span) : balanceOf(ledger[kind].entries, today, span);
      const planned = planSpend({ amount: args.amount, balance: held, judge });
      if (!planned.ok) return planned;
      const plan = only && planned.warn ? { ...planned, warn: "staysShort" } : planned;
      if (plan.amount === 0) return { ...plan, balance: only ? balanceOf(ledger[kind].entries, today, span) : 0 };
      const by = args.by === "judge" ? "judge" : "";
      const into = by ? foldTarget(ledger[kind].entries, { user: userId, amount: -plan.amount, day: today, fromStays: only }) : null;
      if (into) {
        const next = withFolded(ledger, kind, into.id, -plan.amount);
        await deps.write(actor, kind, next[kind]);
        return { ...plan, id: into.id, balance: balanceOf(next[kind].entries, today, span) };
      }
      const id = deps.newId();
      const next = withEntry(ledger, kind, { id, amount: -plan.amount, day: today, name: args.name, img: args.img, ref: args.ref, by, user: userId, fromStays: only });
      await deps.write(actor, kind, next[kind]);
      return { ...plan, id, balance: balanceOf(next[kind].entries, today, span) };
    }
    if (op === POWER_OP.undo) {
      const entry = ledger[kind].entries.find((e) => e.id === args.id);
      if (!entry) return { ok: false, reason: "undo" };
      if (entry.amount > 0) {
        // A gain is taken back only while none of it has been spent.
        const lot = standing(ledger[kind].entries, today, span).find((l) => l.id === entry.id);
        if (!lot || lot.left !== lot.amount) return { ok: false, reason: "spent" };
      }
      const next = withoutEntry(ledger, kind, args.id);
      await deps.write(actor, kind, next[kind]);
      return { ok: true, balance: balanceOf(next[kind].entries, today, span) };
    }
    return { ok: false, reason: "op" };
  }

  /** Run an op where the seat may write the actor, else ask the GM's client, which refuses a sender who owns nothing; `{ok: false, reason: "noGm"}` where none answers. */
  async function run(actor, kind, op, args = {}) {
    if (op !== POWER_OP.count && !isKind(kind)) return { ok: false, reason: "kind" };
    const judge = deps.isJudge();
    if (deps.canWrite(actor)) return apply(actor, kind, op, args, judge, deps.userId?.() ?? "");
    const answer = await deps.relay({ actorUuid: actor?.uuid, kind, op, args });
    return answer && typeof answer === "object" ? answer : { ok: false, reason: "noGm" };
  }

  return {
    apply,
    run,
    balance,
    /** Power gained: `{amount, name, img, ref}`; a press by hand adds `by: "judge"` (and folds into the same user's last hand gain of the day), and `stays: true` makes a lot that never expires. */
    gain: (actor, kind, args) => run(actor, kind, POWER_OP.gain, args),
    /** Power spent: a short spend blocks a Player and warns a Judge, which takes what is held. `fromStays: true` draws on the lots that stay alone (`warn: "staysShort"` where they hold less). A press by hand folds as a gain's does. */
    spend: (actor, kind, args) => run(actor, kind, POWER_OP.spend, args),
    /** An entry taken back, by its id: a spend, or a gain none of which was spent (`reason: "spent"` otherwise). */
    undo: (actor, kind, id) => run(actor, kind, POWER_OP.undo, { id }),
    /** The arcane lifetime's count, `null` to blank it. */
    setCount: (actor, count) => run(actor, POWER_KIND.arcane, POWER_OP.count, { count }),
  };
}

/**
 * The chip's model for one actor: per kind its balance, the entries newest
 * first, the next expiry and the tooltip, and the controls (the count box and
 * the `stay` switch's labels; a model of a seat that does not own the character
 * carries neither). Every control is the owner's: `owns` is whether the viewing
 * user owns the actor (Foundry's own test, true for a GM); `judge` is the GM
 * flag and is returned unchanged. A spend marked `fromStays` captions
 * itself as a removal. A lot that stays is a row with a pin and its own caption,
 * and its tooltip part says so. A row is `undoable` for an owner where it is a
 * spend or a gain none of which was spent; a gain partly spent carries
 * `undoRefused`, a line saying why, and no undo. An entry by hand is named by
 * `userName(id)` where it has a user and the name resolves. `loc(key, data)` is
 * the localizer of the ledger's lang group. `lifetimes[kind]` is
 * `{span, lifetime, cite, byHand}`: the span in days (null: nothing expires),
 * the imported `{count, unit}` for the words, the page the lifetime was read
 * from and whether a hand set it. A kind is shown to an owner always and to
 * anyone else where it has entries.
 */
export function chipModel({ ledger, today, lifetimes, loc, judge, owns = judge === true, userName = () => "" }) {
  const kinds = POWER_KINDS.map((kind) => {
    const entries = ledger[kind].entries;
    const life = lifetimes?.[kind] ?? {};
    const span = life.span ?? null;
    const lots = standing(entries, today, span);
    const balance = lots.reduce((n, lot) => (lot.expired ? n : n + lot.left), 0);
    const expiry = nextExpiry(entries, today, span);
    const words = life.lifetime && life.lifetime.count != null && life.lifetime.unit ? `${life.lifetime.count} ${life.lifetime.unit}` : "";
    const nameOf = (e) => e.name || (e.by === "judge" ? (e.user && userName(e.user)) || loc("byHand") : loc("unnamed"));
    const rows = [...entries].reverse().map((e) => {
      const lot = lots.find((l) => l.id === e.id);
      const spent = e.amount < 0;
      const off = !spent && !!lot && (lot.expired || lot.left <= 0);
      let caption = e.ref;
      if (spent && e.fromStays) caption = e.ref || loc("removedStays");
      if (!spent && lot) caption = lot.expired ? loc("expired") : lot.left <= 0 ? loc("usedUp") : lot.stays ? loc("staysCaption") : words && lot.expiresDay !== null ? loc("fadesAfter", { span: words }) : "";
      const unspentGain = !spent && !!lot && lot.left === lot.amount;
      const tag = `${spent ? "−" : "+"}${Math.abs(e.amount)}`;
      return {
        id: e.id,
        kind,
        name: nameOf(e),
        img: e.img,
        caption,
        amount: e.amount,
        tag,
        tip: loc(e.stays ? "entryTipStays" : "entryTip", { name: nameOf(e), tag, day: e.day ?? "" }),
        glyph: e.stays ? "fa-thumbtack" : e.by === "judge" ? "fa-hand" : spent ? "fa-wand-sparkles" : "fa-bolt",
        spent,
        stays: !!e.stays,
        fromStays: !!e.fromStays,
        pinned: !spent && !!lot?.stays && lot.left > 0,
        off,
        undoable: owns && (spent || unspentGain),
        undoRefused: owns && !spent && !unspentGain ? loc("undoSpent") : null,
        undoLabel: loc("undoLabel", { name: nameOf(e) }),
      };
    });
    const parts = entries.map((e) => `${nameOf(e)} ${e.amount < 0 ? "−" : "+"}${Math.abs(e.amount)}${e.stays ? ` (${loc("tipStays")})` : ""}`).join(" · ");
    const cite = life.byHand ? "" : life.cite || loc(`cite.${kind}`);
    const tail = [expiry ? loc("tipFades", { n: expiry.amount, days: expiry.inDays ?? "", day: expiry.day }) : "", life.byHand ? loc("tipByHand") : ""].filter(Boolean).join(" · ");
    const tip = `${loc("tipHead", { label: loc(`kind.${kind}`), balance })}${parts ? `: ${parts}` : `: ${loc("empty")}`}${tail ? ` · ${tail}` : ""}${cite ? ` (${cite})` : ""}`;
    const count =
      kind === POWER_KIND.arcane && owns
        ? {
            value: ledger.arcane.count ?? "",
            label: loc("countLabel"),
            tip: life.lifetime?.unit ? loc("countTipUnit", { unit: life.lifetime.unit, cite: loc("cite.arcane") }) : loc("countTip", { cite: loc("cite.arcane") }),
          }
        : null;
    const stay = owns ? { group: loc("stayGroup", { label: loc(`kind.${kind}`) }), fades: loc("fades"), stays: loc("stays"), fadesTip: loc("fadesTip"), staysTip: loc("staysTip") } : null;
    return { kind, label: loc(`kind.${kind}`), balance, expiry, tip, rows, count, stay, shown: owns || entries.length > 0, addLabel: loc("addLabel", { label: loc(`kind.${kind}`) }), removeLabel: loc("removeLabel", { label: loc(`kind.${kind}`) }), removeStaysLabel: loc("removeStaysLabel", { label: loc(`kind.${kind}`) }), empty: entries.length === 0 };
  });
  return { judge, owns, kinds, any: kinds.some((k) => k.shown), hasEntries: kinds.some((k) => !k.empty), emptyText: loc("empty") };
}
