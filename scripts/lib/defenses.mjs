/**
 * What a creature's defenses do to damage dealt to it: the one place a damage
 * type meets an immunity, a resistance or a susceptibility, for a weapon's hit
 * and a spell's alike. The procedure ships; every figure it needs is read.
 *
 * Immunity prints no figure: it removes the damage and passes the save.
 * Resistance's amount fraction and its save modifier are the `defenses`
 * document's `resistanceProse` table (RR ch. 6, "Damage Type Immunity and
 * Resistance"), read like the senses' figures and null until imported. A
 * susceptibility's `factor` and `save` are the creature's own, on its band.
 * A figure that is not there sends the case to the Judge, never to a default.
 *
 * A band COVERS a type dealt when it lists the type, or lists none and sets a
 * quality flag the damage meets. The damage is extraordinary when it is marked
 * so, or when a silver weapon meets a defense's `silverFlaw`; mundane when it
 * is marked so; and UNSTATED (null) otherwise, which is never read as mundane:
 * a band whose coverage waits on the quality is the Judge's unless the outcome
 * is the same whether it covers or not. A band that sets no flag covers both
 * qualities and, listing no type, covers nothing. Damage with no type (or one that varies by weapon) is
 * covered only by a band that lists no type and sets a flag it meets.
 *
 * `defenseCoverage` classifies one hit against every source: all immune,
 * all immune-or-resistant with a resistance in it, all susceptible, or the
 * Judge's (a type met by a susceptibility and a defense at once, a type no band
 * covers beside one that is covered, an applying band that carries a `note`, a
 * figure that is blank or differs between bands). A type covered twice counts
 * once, so a fraction or a factor never applies twice. `defenseStage` and
 * `defenseSaveParts` are that classification as the stage `amountAfter` takes
 * and as the parts `saveSpec` adds. See docs/lib/MODEL.md, "Damage against
 * defenses".
 */
import { LANG_PREFIX, MODULE_ID } from "./constants.mjs";
import { getMonsterExtras } from "./senses.mjs";
import { citeOf, expectTables, getDoc, hasDoc } from "./tables.mjs";
import { consumedRows } from "./typed-modifiers.mjs";
import { locOr, numOrNull } from "./util.mjs";

/** The registered document resistance's printed figures arrive in. */
export const DEFENSES_DOC = "defenses";
/** Its table holding resistance's figures: `{fraction, saveBonus}`. */
export const RESISTANCE_TABLE = "resistanceProse";

/** The three bands a source carries, by the key `defensesField()` stores them under. */
export const DEFENSE_BAND = Object.freeze({ immune: "immunities", resist: "resistances", susceptible: "susceptibilities" });

/** What a classification answers. */
export const DEFENSE_OUTCOME = Object.freeze({ none: "none", immune: "immune", resist: "resist", susceptible: "susceptible", judge: "judge" });

/** Why a classification went to the Judge. */
export const JUDGE_WHY = Object.freeze({ mixed: "mixed", partial: "partial", note: "note", figure: "figure", quality: "quality" });

/** The key a stage and a step carry, and a save part. */
export const DEFENSE_KEY = "defense";

/** Declare the defenses table, so an import names it as missing until it lands. */
export function declareDefenseTables() {
  expectTables(DEFENSES_DOC, [RESISTANCE_TABLE]);
}

/** One figure of the resistance table, or undefined where nothing is imported. */
const printed = (key) => (hasDoc(DEFENSES_DOC) ? getDoc(DEFENSES_DOC)?.tables?.[RESISTANCE_TABLE]?.[key] : undefined);

/**
 * The page the resistance figures were read from, or null when they are the
 * Judge's own or nothing is imported (`citeOf`).
 */
export function defenseCite() {
  return citeOf(DEFENSES_DOC, RESISTANCE_TABLE);
}

/**
 * The imported figures of resistance, each null until read: `fraction`, the
 * share of the damage a resistant creature takes (above 0, at most 1), and
 * `saveBonus`, the signed modifier its saving throw gains against the damage
 * (positive helps the saver). `cite` is `defenseCite()`. The Judge's override
 * layer answers first, as everywhere in the registry.
 *
 * @returns {{fraction: number|null, saveBonus: number|null, cite: string|null}}
 */
export function defenseFigures() {
  const fraction = numOrNull(printed("fraction"));
  return {
    fraction: fraction != null && fraction > 0 && fraction <= 1 ? fraction : null,
    saveBonus: numOrNull(printed("saveBonus")),
    cite: defenseCite(),
  };
}

/* -------------------------------------------- */
/*  Sources                                      */
/* -------------------------------------------- */

/** A damage type as the bands key it: core's `variesByWeapon` is the module's `varies`. */
const typeKey = (t) => (t === "variesByWeapon" ? "varies" : t);

/** One stored band as the coverage reads it. Sets arrive as arrays; `effects` and `conditions` are not read here. */
function bandOf(raw) {
  const listed = typeof raw?.damage === "string" ? [] : Array.from(raw?.damage ?? []);
  return {
    damage: new Set(listed.filter((t) => typeof t === "string" && t).map(typeKey)),
    mundane: raw?.mundane === true,
    extraordinary: raw?.extraordinary === true,
    silverFlaw: raw?.silverFlaw === true,
    note: typeof raw?.note === "string" ? raw.note.trim() : "",
    factor: positive(raw?.factor),
    save: numOrNull(raw?.save),
  };
}

/** A figure above zero, else null. */
function positive(v) {
  const n = numOrNull(v);
  return n != null && n > 0 ? n : null;
}

/** A band that can cover damage: it lists a type or sets a quality flag. */
const reachesDamage = (b) => b.damage.size > 0 || b.mundane || b.extraordinary;

/** One source from a stored `defenses` block, or null when no band of it reaches damage. */
function sourceOf(name, raw) {
  if (!raw || typeof raw !== "object") return null;
  const bands = {};
  for (const key of Object.values(DEFENSE_BAND)) bands[key] = bandOf(raw[key]);
  return Object.values(bands).some(reachesDamage) ? { name: String(name ?? ""), bands } : null;
}

/**
 * Every defense an actor holds, each source named: the actor's own
 * `flags["acks-extras"].extras.defenses` (a monster's stat block) and the
 * bands of each owned item (an ability carries `defensesField()`). A source
 * with no band that reaches damage is left out. Reads flags only, so a token's
 * synthetic actor answers for itself.
 *
 * @returns {Array<{name: string, bands: Record<string, ReturnType<typeof bandOf>>}>}
 */
export function actorDefenses(actor) {
  const out = [];
  const own = sourceOf(actor?.name, getMonsterExtras(actor)?.defenses);
  if (own) out.push(own);
  for (const item of actor?.items ?? []) {
    const extras = item?.getFlag?.(MODULE_ID, "extras") ?? item?.flags?.[MODULE_ID]?.extras;
    const source = sourceOf(item?.name, extras?.defenses);
    if (source) out.push(source);
  }
  return out;
}

/* -------------------------------------------- */
/*  Coverage                                     */
/* -------------------------------------------- */

/**
 * The damage one hit deals, normalised: its types (a `variesByWeapon` type is
 * no type), whether it is extraordinary, whether a silver weapon dealt it.
 * The quality is three-valued: `true` extraordinary, `false` mundane, and null
 * where it is not known (a row whose mark the import could not read); it is
 * never read as mundane.
 *
 * @param {{types?: Iterable<string>, extraordinary?: boolean|null, silver?: boolean}} [damage]
 */
export function damageOf(damage = {}) {
  const types = [...new Set(Array.from(damage?.types ?? []).filter((t) => typeof t === "string" && t).map(typeKey).filter((t) => t !== "varies"))];
  const q = damage?.extraordinary;
  return { types, extraordinary: q === true ? true : q === false ? false : null, silver: damage?.silver === true };
}

/**
 * Does `band` cover `type` (null for damage with no type)? True or false, or
 * null where it depends on a quality the damage does not state: a band that
 * sets exactly one quality flag, and would cover the type if it matched. A
 * silver weapon meeting `silverFlaw` is extraordinary, stated or not.
 */
function covers(band, kind, damage, type) {
  const flagged = band.mundane || band.extraordinary;
  if (band.damage.size) {
    if (type === null || !band.damage.has(type)) return false;
  } else if (!flagged) {
    return false;
  }
  if (!flagged || (band.mundane && band.extraordinary)) return true;
  const silvered = kind !== DEFENSE_BAND.susceptible && band.silverFlaw && damage.silver;
  if (damage.extraordinary === true || silvered) return band.extraordinary;
  if (damage.extraordinary === false) return band.mundane;
  return null;
}

/** The word of a band or the Judge's case, from the lang file. */
const word = (key, fallback) => locOr(`${LANG_PREFIX}.defense.${key}`, fallback);

/** The wording of each outcome's label. */
const OUTCOME_LABEL = {
  immune: () => word("band.immunities", "Immune"),
  resist: () => word("band.resistances", "Resistant"),
  susceptible: () => word("band.susceptibilities", "Susceptible"),
  judge: () => word("band.judge", "Judge's call"),
};

/**
 * One hit's coverage by every source.
 *
 * `types` are the types dealt (none dealt is read as one untyped kind), and
 * each is covered by the bands that name it. A type covered by an immunity is
 * immune whatever else covers it, one covered by a resistance is resistant, and
 * a type covered by a susceptibility beside any other band is mixed.
 *
 * @param {Array<{name: string, bands: object}>} sources  `actorDefenses`
 * @param {{types?: Iterable<string>, extraordinary?: boolean, silver?: boolean}} damage
 * @returns {{outcome: string, why: string|null, types: string[], applying: Array<{source: string, kind: string, band: object}>, factor: number|null, save: number|null}}
 *   `applying` is each band that covers a type dealt, `factor` and `save` the susceptibility's own figures when they are one agreed value
 */
export function defenseCoverage(sources, damage) {
  const hit = damageOf(damage);
  const dealt = hit.types.length ? hit.types : [null];
  const entries = [];
  for (const source of sources ?? []) {
    for (const kind of Object.values(DEFENSE_BAND)) {
      const band = source.bands?.[kind];
      if (!band) continue;
      const sure = dealt.filter((t) => covers(band, kind, hit, t) === true);
      const unsure = dealt.filter((t) => covers(band, kind, hit, t) === null);
      if (sure.length) entries.push({ source: source.name, kind, band, types: sure, maybe: false });
      else if (unsure.length) entries.push({ source: source.name, kind, band, types: unsure, maybe: true });
    }
  }
  const definite = entries.filter((e) => !e.maybe);
  const maybes = entries.filter((e) => e.maybe);
  if (!maybes.length) return classify(definite, dealt, hit.types);
  // A band the damage's unstated quality may or may not meet: the outcome stands
  // only if it is the same whichever of them cover the hit.
  const same = (r) => [r.outcome, r.why, r.factor, r.save].join("|");
  const first = same(classify(definite, dealt, hit.types));
  let undetermined = maybes.length > MAX_UNDETERMINED;
  for (let mask = 1; !undetermined && mask < 1 << maybes.length; mask++) {
    const active = [...definite, ...maybes.filter((_, i) => mask & (1 << i))];
    if (same(classify(active, dealt, hit.types)) !== first) undetermined = true;
  }
  const all = classify(entries, dealt, hit.types);
  return undetermined ? { ...all, outcome: DEFENSE_OUTCOME.judge, why: JUDGE_WHY.quality, factor: null, save: null } : all;
}

/** How many bands of one hit may wait on its quality before the Judge is asked without trying the combinations. */
const MAX_UNDETERMINED = 8;

/** The classification of a hit against the bands in `applying`, each covering the types it names. */
function classify(applying, dealt, types) {
  const status = new Map(dealt.map((t) => [t, new Set()]));
  for (const a of applying) for (const t of a.types) status.get(t).add(a.kind);
  const base = { types, applying, factor: null, save: null };
  if (!applying.length) return { ...base, outcome: DEFENSE_OUTCOME.none, why: null };
  const judge = (why) => ({ ...base, outcome: DEFENSE_OUTCOME.judge, why });
  if (applying.some((a) => a.band.note)) return judge(JUDGE_WHY.note);

  const per = [...status.values()];
  if (per.some((s) => s.size === 0)) return judge(JUDGE_WHY.partial);
  const weak = (s) => s.has(DEFENSE_BAND.susceptible);
  if (per.some((s) => weak(s) && s.size > 1)) return judge(JUDGE_WHY.mixed);
  if (per.some(weak) && !per.every(weak)) return judge(JUDGE_WHY.mixed);
  if (per.every(weak)) {
    const figures = applying.filter((a) => a.kind === DEFENSE_BAND.susceptible).map((a) => a.band);
    const one = (key) => {
      const values = new Set(figures.map((b) => b[key]));
      return values.size === 1 ? [...values][0] : null;
    };
    return { ...base, outcome: DEFENSE_OUTCOME.susceptible, why: null, factor: one("factor"), save: one("save") };
  }
  const resisted = per.some((s) => !s.has(DEFENSE_BAND.immune));
  return { ...base, outcome: resisted ? DEFENSE_OUTCOME.resist : DEFENSE_OUTCOME.immune, why: null };
}

/** The names of the sources a classification's bands came from, once each. */
const namesOf = (coverage) => [...new Set(coverage.applying.map((a) => a.source).filter(Boolean))].join(", ");

/** The part of a stage or step every defense shares. */
function detail(coverage, outcome, figures, why = null) {
  return {
    key: DEFENSE_KEY,
    label: OUTCOME_LABEL[outcome](),
    band: outcome === DEFENSE_OUTCOME.judge ? "judge" : DEFENSE_BAND[outcome],
    types: [...coverage.types],
    source: namesOf(coverage),
    cite: coverage.outcome === DEFENSE_OUTCOME.susceptible ? null : (figures?.cite ?? null),
    ...(why ? { why } : {}),
  };
}

/* -------------------------------------------- */
/*  The amount                                   */
/* -------------------------------------------- */

/**
 * The stage `amountAfter` takes for this hit, or null when no defense covers
 * it. Pure over its arguments.
 *
 * - every type immune: `{factor: 0}`;
 * - every type immune or resistant, one resistant: `{factor: figures.fraction}`;
 * - every type susceptible: `{factor}` the band's own figure;
 * - anything else, or a figure that is blank: `{judge: true}`, which
 *   `amountAfter` answers with no amount.
 *
 * Every stage carries the transparency fields `{key: "defense", label, band,
 * types, source, cite}`, and a judge stage a `why`.
 *
 * @param {Array<{name: string, bands: object}>} sources  `actorDefenses`
 * @param {{types?: Iterable<string>, extraordinary?: boolean, silver?: boolean}} damage
 * @param {{fraction?: number|null, cite?: string|null}} [figures]  `defenseFigures()`
 * @returns {object|null}
 */
export function defenseStage(sources, damage, figures = {}) {
  const c = defenseCoverage(sources, damage);
  if (c.outcome === DEFENSE_OUTCOME.none) return null;
  const judge = (why) => ({ ...detail(c, DEFENSE_OUTCOME.judge, figures, why), judge: true });
  if (c.outcome === DEFENSE_OUTCOME.judge) return judge(c.why);
  if (c.outcome === DEFENSE_OUTCOME.immune) return { ...detail(c, c.outcome, figures), factor: 0 };
  const factor = c.outcome === DEFENSE_OUTCOME.resist ? numOrNull(figures?.fraction) : c.factor;
  if (factor == null) return judge(JUDGE_WHY.figure);
  return { ...detail(c, c.outcome, figures), factor };
}

/* -------------------------------------------- */
/*  A reduction per die                          */
/* -------------------------------------------- */

/** The `modifier` target of an ability row that takes an amount off each damage die. */
export const REDUCTION_TARGET = "damageReduction";

/** The item gates a reduction may name, each answered at the attack and stamped on its card (`roll-mods.mjs` registers both). */
export const REDUCTION_GATES = Object.freeze(["weaponMundane", "weaponMagical"]);

/**
 * The reductions an actor's abilities carry: a `modifier` row `{target:
 * "damageReduction", perDie: true, value, gate?: {kind}}`, the figure the
 * carrier's own, imported. `[{source, cite, per, gate}]`, `gate` the kind or
 * null; a row with no positive figure, or not per die, is left out, and a gate
 * of another kind is kept as `gate: "?"` for `reductionStage` to refuse.
 *
 * @param {object} actor
 * @param {{resolve?: Function}} [options]
 */
export function actorReductions(actor, options = {}) {
  const out = [];
  for (const { item, spec, value } of consumedRows(actor, REDUCTION_TARGET, options)) {
    if (spec.perDie !== true || typeof value !== "number" || !(value > 0) || spec.appliesTo === "opponent") continue;
    const kind = spec.gate?.kind ?? null;
    const cite = String(item?.getFlag?.(MODULE_ID, "cookbook")?.cite ?? item?.flags?.[MODULE_ID]?.cookbook?.cite ?? "").trim();
    out.push({ source: String(item?.name ?? ""), cite, per: value, gate: kind === null ? null : REDUCTION_GATES.includes(kind) ? kind : "?" });
  }
  return out;
}

/**
 * The stage `amountAfter` takes for the reductions that hold against this hit,
 * or null: `{stage, skipped}`. The stage is `{key: "perDie", label, band:
 * "reduction", minus, per, dice, source, cite}`, `minus` the carriers' figures
 * added times the dice the damage roll held, which `amountAfter` takes off and
 * floors at zero. A gate the stamp answers false is not news; one it cannot
 * answer (no verdict, an unregistered kind) is `skipped` with `why: "gate"`, and
 * a hit whose die count is unknown skips every reduction that would apply with
 * `why: "dice"`. Nothing is reduced on a guess.
 *
 * @param {Array<{source: string, cite: string, per: number, gate: string|null}>} reductions  `actorReductions`
 * @param {{dice?: number|null, gates?: Record<string, boolean|null>}} damage  the stamp's die count and item-gate verdicts
 */
export function reductionStage(reductions, damage = {}) {
  const skipped = [];
  const holding = [];
  for (const r of reductions ?? []) {
    const verdict = r.gate === null ? true : (r.gate === "?" ? null : (damage?.gates?.[r.gate] ?? null));
    if (verdict === true) holding.push(r);
    else if (verdict === null) skipped.push({ source: r.source, why: "gate" });
  }
  if (!holding.length) return { stage: null, skipped };
  const dice = numOrNull(damage?.dice);
  if (dice === null || dice < 1) return { stage: null, skipped: [...skipped, ...holding.map((r) => ({ source: r.source, why: "dice" }))] };
  const per = holding.reduce((sum, r) => sum + r.per, 0);
  const cites = [...new Set(holding.map((r) => r.cite).filter(Boolean))];
  const stage = {
    key: "perDie",
    label: word("band.perDie", "Reduced per die"),
    band: "reduction",
    minus: per * dice,
    per,
    dice,
    source: [...new Set(holding.map((r) => r.source).filter(Boolean))].join(", "),
    cite: cites.length ? cites.join(" · ") : null,
  };
  return { stage, skipped };
}

/* -------------------------------------------- */
/*  The save                                     */
/* -------------------------------------------- */

/**
 * What the same sources do to the saving throw against this damage, under the
 * same coverage:
 *
 * - every type immune: `auto`, a success with no roll;
 * - every type immune or resistant, one resistant: a target part of
 *   `figures.saveBonus`, or a `pending` row while it is blank;
 * - every type susceptible: a target part of the creature's `save`, or
 *   `pending` while it is blank;
 * - anything else: one `pending` row for the Judge.
 *
 * A `pending` row is `{label, value: null, when: "defense", why?}`. A part is
 * `{key: "defense", label, value, side: "target"}`; its value lowers the number
 * to roll, so a positive figure helps the saver, as every target part does.
 *
 * @returns {{parts: object[], pending: object[], auto: {label: string, source: string, types: string[]}|null}}
 */
export function defenseSaveParts(sources, damage, figures = {}) {
  const c = defenseCoverage(sources, damage);
  const out = { parts: [], pending: [], auto: null };
  if (c.outcome === DEFENSE_OUTCOME.none) return out;
  const head = detail(c, c.outcome, figures, c.why);
  const hold = (why) => out.pending.push({ label: head.label, value: null, when: "defense", ...(why ? { why } : {}) });
  if (c.outcome === DEFENSE_OUTCOME.immune) {
    out.auto = { label: head.label, source: head.source, types: head.types };
  } else if (c.outcome === DEFENSE_OUTCOME.judge) {
    hold(c.why);
  } else {
    const value = c.outcome === DEFENSE_OUTCOME.resist ? numOrNull(figures?.saveBonus) : c.save;
    if (value == null) hold(JUDGE_WHY.figure);
    else if (value !== 0) out.parts.push({ key: DEFENSE_KEY, label: head.label, value, side: "target" });
  }
  return out;
}
