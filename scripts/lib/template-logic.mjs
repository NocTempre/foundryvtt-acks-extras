/**
 * The Foundry-FREE half of the `acks-extras.template` generator: choice rolling
 * and patch resolution, split out so they import under Node and are unit-tested
 * offline (the same split as group-logic.mjs vs group.mjs).
 *
 * A template is the book's own shape for creatures it refuses to stat once
 * (characteristics by rank, age or tier) and for modifier creatures that
 * rewrite a dropped base actor. The actor's system data holds AXES, each option
 * carrying engine-ready PATCHES that were materialized from the reader's own
 * book at import time. This module never interprets book content — it only
 * selects options and merges what the importer already built:
 *
 *   choices  = chooseAxes(system, { pinned, baseValues, rng })
 *   resolved = resolveActor(system, choices.choices, { baseName })
 *
 * Per-axis precedence: PINNED (the Judge picked it) > DERIVED (read off a
 * dropped base actor) > DEFAULT (the option the axis names for an unpinned
 * generation) > ROLLED (the axis die over the printed bands, else uniform).
 * Only options available beside the choices already made are derived, defaulted
 * or rolled (`optionStands`); a pin stands whether or not the option is. A pin
 * of `ROLL_PIN` asks the axis to roll, passing over derive and default.
 *
 * An axis may take its bands per variant from a registry table (`bandsFrom`,
 * see `axisIsBanded`). The Foundry-free logic never reads the registry: it is
 * handed `bandOf(axis, option, choices) → {min, max} | null`, which
 * template-bands.mjs builds from the world's tables.
 */

import { bandDie, bracketRow } from "./tables.mjs";
import { setPath } from "./dotted-path.mjs";

/** Mulberry32 — a tiny seedable PRNG so tests are deterministic. */
export function seededRng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Roll a "NdM" die string. Unparseable → null (caller falls back to uniform). */
export function rollDie(die, rng = Math.random) {
  const m = /^(\d*)d(\d+)$/i.exec(String(die ?? "").trim());
  if (!m) return null;
  const count = Math.max(1, parseInt(m[1] || "1", 10));
  const faces = parseInt(m[2], 10);
  if (!faces) return null;
  let sum = 0;
  for (let i = 0; i < count; i++) sum += 1 + Math.floor(rng() * faces);
  return sum;
}

/**
 * Roll a die with an optional flat modifier ("1d4+1", "2d4", "3"). A bare
 * whole number is itself. Unparseable → null.
 */
export function rollDice(expr, rng = Math.random) {
  const s = String(expr ?? "").replace(/\s+/g, "");
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  const m = /^(\d*d\d+)([+-]\d+)?$/i.exec(s);
  if (!m) return null;
  const v = rollDie(m[1], rng);
  return v == null ? null : v + (m[2] ? parseInt(m[2], 10) : 0);
}

/** The faces of a "NdM" string ("1d100" → 100); null when unparseable. */
const facesOf = (die) => {
  const m = /^(\d*)d(\d+)$/i.exec(String(die ?? "").trim());
  return m ? parseInt(m[2], 10) : null;
};

/** Does a printed band {rollMin, rollMax} contain v? Open ends are open. */
const inBand = (opt, v, faces) => {
  const min = opt.rollMin ?? 1;
  const max = opt.rollMax ?? faces ?? Infinity;
  return v >= min && v <= max;
};

/**
 * Pick one option of one axis: the axis die over the options' bands when both
 * exist, else uniform. Returns
 * `{option, roll}` (roll null for uniform picks). Empty axes return null.
 */
export function rollOption(axis, rng = Math.random) {
  const options = axis?.options ?? [];
  if (!options.length) return null;
  const banded = options.some((o) => o.rollMin != null || o.rollMax != null);
  if (axis.roll && banded) {
    const v = rollDie(axis.roll, rng);
    if (v != null) {
      const hit = options.find((o) => inBand(o, v, facesOf(axis.roll)));
      if (hit) return { option: hit, roll: v };
      // A rolled value outside every band (misauthored gap): fall through.
    }
  }
  return { option: options[Math.floor(rng() * options.length)], roll: null };
}

/**
 * The pin value that asks an axis to ROLL even though it names a default
 * (`pinned[axis.key] === ROLL_PIN`). A string no option key can be, so a pin
 * survives a select value and a stored record. It outranks derive as any pin
 * does: the axis rolls by its own rules (bands when it carries them, else
 * uniform; `rollBandedOption` under `bandsFrom`).
 */
export const ROLL_PIN = "$roll";

/**
 * Does this axis take its roll bands per variant from a registry table
 * (`axis.bandsFrom = {doc, table, by}`)? Any of the three strings filled in
 * says yes, so a half-written spec fails closed, to the default alone, and never
 * to an invented uniform roll. The schema fills every axis with blank strings,
 * and all-blank is "not banded". Written once so no caller tests the object's
 * truthiness.
 */
export function axisIsBanded(axis) {
  const from = axis?.bandsFrom;
  return !!(from && (String(from.doc ?? "").trim() || String(from.table ?? "").trim() || String(from.by ?? "").trim()));
}

/** A band as a resolver may hand it back: whole numbers, `min <= max`. */
const validBand = (band) => !!band && Number.isInteger(band.min) && Number.isInteger(band.max) && band.min <= band.max;

/**
 * Roll one axis whose options take per-variant bands (`bandsFrom`): a die over
 * the resolved bands of `options` (the available ones). The die is the axis's
 * own `roll` when it names one, else the one the variant's column of bands
 * implies (`bandDie`: as many faces as the highest band edge across every option
 * of the axis). Returns `{option, roll, die}` for a hit; `{option: null, roll,
 * die}` for a gap, which is a roll outside every band, or no die to throw
 * (`roll` and `die` null when no band and no die give one). Never the uniform
 * fallback, which would invent a distribution the page does not print. The
 * caller applies the axis's default to a gap.
 */
export function rollBandedOption(axis, options, choices, bandOf, rng = Math.random) {
  const named = String(axis?.roll ?? "").trim();
  const bands = (axis?.options ?? []).map((o) => bandOf?.(axis, o, choices)).filter(validBand);
  const die = named || bandDie(bands);
  const roll = rollDie(die, rng);
  if (roll == null) return { option: null, roll: null, die: die || null };
  const option = (options ?? []).find((o) => {
    const band = bandOf?.(axis, o, choices);
    return validBand(band) && roll >= band.min && roll <= band.max;
  });
  return { option: option ?? null, roll, die };
}

/**
 * Derive an axis choice from a dropped base actor's values. The axis says
 * which base value it reads (`derive.from`, e.g. "hd") and its cap; options
 * with numeric keys are matched to the clamped value, taking the closest
 * option that does not exceed it.
 */
export function deriveOption(axis, baseValues) {
  const from = axis?.derive?.from;
  if (!from) return null;
  const raw = baseValues?.[from];
  if (raw == null || Number.isNaN(Number(raw))) return null;
  const max = axis.derive.max ?? Infinity;
  const value = Math.min(Number(raw), max);
  const numeric = (axis.options ?? [])
    .map((o) => ({ o, n: Number(o.key) }))
    .filter((x) => !Number.isNaN(x.n))
    .sort((a, b) => a.n - b.n);
  if (!numeric.length) return null;
  let best = numeric[0].o;
  for (const { o, n } of numeric) if (n <= value) best = o;
  return best;
}

/** Does an option carry a patch of its own (merge, items or flags)? */
const hasOwnPatch = (o) =>
  Object.keys(o?.merge ?? {}).length > 0 || (o?.items ?? []).length > 0 || Object.keys(o?.flags ?? {}).length > 0;

/**
 * Can this option be chosen beside the choices already made? An option that
 * carries no patch of its own, on an axis some cell refines, is only the key
 * of its cells, so it stands only where a cell matches it. An axis left
 * unchosen in `choices` matches any of its options. The axis's `default` is
 * always available, and so is every option of an axis no cell names.
 *
 * On a banded axis (`axisIsBanded`) an option stands only where `bandOf` (see
 * the header) holds a band for it beside `choices`, the default aside; with no
 * resolver, no table or no choice on the `by` axis yet, only the default stands.
 * The band gate comes first, so an option's own patch never defeats a blank
 * band; an option with a band then meets the cell rule above as any other.
 */
export function optionAvailable(system, axis, option, choices = {}, bandOf = null) {
  if (!option) return false;
  if (axis?.default && option.key === axis.default) return true;
  if (axisIsBanded(axis) && !validBand(bandOf?.(axis, option, choices))) return false;
  if (hasOwnPatch(option)) return true;
  const cells = (system?.cells ?? []).filter((c) => (c.by ?? []).includes(axis.key));
  if (!cells.length) return true;
  return cells.some((cell) => {
    const parts = String(cell.key ?? "").split("|");
    return (cell.by ?? []).every((axisKey, i) => {
      if (axisKey === axis.key) return parts[i] === option.key;
      const chosen = choices?.[axisKey];
      return chosen == null || chosen === "" || parts[i] === chosen;
    });
  });
}

/**
 * Does an axis offer a choice beside the choices already made? Not when at
 * most one of its options is available there (`optionAvailable`), so the sheet
 * leaves the axis out. A multi axis and an axis that derives from a base
 * always offer one.
 */
export function axisOffersChoice(system, axis, choices = {}, bandOf = null) {
  if (!axis || axis.multi || axis.derive?.from) return true;
  return (axis.options ?? []).filter((o) => optionAvailable(system, axis, o, choices, bandOf)).length > 1;
}

/**
 * Does an option stand beside the choices already made, for the sheet, the
 * variant prompt and `chooseAxes` alike? A single axis stands by
 * `optionAvailable`; a multi axis skips the cell rule and is gated by its bands
 * alone (its default aside). Either way a `carryOf` that answers `false` for
 * the option (see `carryOf` in `chooseAxes`) takes it out. An option that does
 * not stand is MARKED to a Judge and never rolled; it is not refused.
 */
export function optionStands(system, axis, option, choices = {}, { bandOf = null, carryOf = null } = {}) {
  if (!option) return false;
  const gated = axis?.multi
    ? !axisIsBanded(axis) || (axis.default && option.key === axis.default) || validBand(bandOf?.(axis, option, choices))
    : optionAvailable(system, axis, option, choices, bandOf);
  return !!gated && carryOf?.(axis, option, choices) !== false;
}

/**
 * The options of one axis as a pin control lists them, each `{key, label,
 * unavailable}`: an option that does not stand beside `choices` (`optionStands`)
 * keeps its place, takes the label `mark(label)` gives and is flagged. The
 * sheet and the variant prompt build their options here, so the words cannot
 * drift apart. `mark` takes the option's own label and returns the listed one.
 */
export function pinOptionRows(system, axis, choices = {}, { bandOf = null, carryOf = null, mark = (label) => label } = {}) {
  return (axis?.options ?? []).map((o) => {
    const unavailable = !optionStands(system, axis, o, choices, { bandOf, carryOf });
    const label = o.label || o.key;
    return { key: o.key, label: unavailable ? mark(label) : label, unavailable };
  });
}

/**
 * Choose every axis: pinned > derived > default > rolled, among the options
 * available beside the choices already made (`optionStands`). Returns
 * `{choices: {axisKey: optionKey}, log: [{axis, option, source, roll?, unavailable?}]}`.
 * A pin is the Judge's call and stands whether or not the variant's tables give
 * the option: it is logged `source: "pinned"` with `unavailable` set (true for a
 * single axis, the keys for a multi axis) where the option does not stand, and
 * resolves to what the option's own patch and the matching cells write, which
 * may be nothing beyond its name. An unknown pinned key falls through to
 * derive/roll. Only a pin ever lands on an option that does not stand; derive,
 * default and roll choose among those that do. An axis's `default` stands in
 * for a roll, so an axis that names one never rolls, unless its pin is
 * `ROLL_PIN`. An axis key in `noRoll` never reaches the roll: where no pin,
 * derive or default settles it, it stays unchosen and logs `source: "none"`
 * (no `option` key). `ROLL_PIN` still rolls it.
 *
 * `bandOf` resolves per-variant bands for banded axes (header, `axisIsBanded`);
 * the axes an axis's `bandsFrom.by` names must come before it in axis order. A
 * banded axis rolls its die over those bands only: a roll outside every band
 * takes the default and logs `source: "gap"`, and with no default leaves the
 * axis unchosen and logs the gap (no `option` key). A multi axis never rolls
 * and takes only its availability from the bands. Without `bandOf` a banded axis
 * offers its default alone. `carryOf(axis, option, choices)` answers `false` for
 * an option the variant's tables say the choices cannot carry, and `true` or
 * null otherwise; it marks and never removes a pin.
 */
export function chooseAxes(system, { pinned = {}, baseValues = {}, rng = Math.random, bandOf = null, carryOf = null, noRoll = [] } = {}) {
  const choices = {};
  const log = [];
  for (const axis of system?.axes ?? []) {
    const banded = axisIsBanded(axis);
    const stands = (o) => optionStands(system, axis, o, choices, { bandOf, carryOf });
    const options = (axis.options ?? []).filter(stands);
    // Multi-select axes are OPT-IN add-ons: apply exactly what was pinned
    // (a known key, standing or not), never roll a default.
    if (axis.multi) {
      const pins = Array.isArray(pinned[axis.key]) ? pinned[axis.key] : pinned[axis.key] != null ? [pinned[axis.key]] : [];
      const keys = pins.filter((k) => (axis.options ?? []).some((o) => o.key === k));
      if (keys.length) {
        choices[axis.key] = keys;
        const marked = keys.filter((k) => !options.some((o) => o.key === k));
        log.push({ axis: axis.key, option: keys.join("+"), source: "pinned", ...(marked.length ? { unavailable: marked } : {}) });
      }
      continue;
    }
    let option = null;
    let source = null;
    let roll = null;
    let die = null;
    let marked = false;
    const mustRoll = pinned[axis.key] === ROLL_PIN;
    if (pinned[axis.key] != null && !mustRoll) {
      option = (axis.options ?? []).find((o) => o.key === pinned[axis.key]) ?? null;
      if (option) {
        source = "pinned";
        marked = !options.includes(option);
      }
    }
    if (!options.length && !option) continue;
    if (!option && !mustRoll) {
      option = deriveOption({ ...axis, options }, baseValues);
      if (option) source = "derived";
    }
    if (!option && axis.default && !mustRoll) {
      option = options.find((o) => o.key === axis.default) ?? null;
      if (option) source = "default";
    }
    if (!option && !mustRoll && noRoll.includes(axis.key)) {
      log.push({ axis: axis.key, source: "none" });
      continue;
    }
    if (!option && banded) {
      const r = rollBandedOption(axis, options, choices, bandOf, rng);
      roll = r.roll;
      die = r.die;
      option = r.option;
      if (option) source = "rolled";
      else {
        // A gap: the default when the axis names one, else the axis stays unchosen.
        option = axis.default ? options.find((o) => o.key === axis.default) ?? null : null;
        if (!option) {
          log.push({ axis: axis.key, source: "gap", ...(roll != null ? { roll } : {}), ...(die ? { die } : {}) });
          continue;
        }
        source = "gap";
      }
    } else if (!option) {
      const r = rollOption({ ...axis, options }, rng);
      option = r?.option ?? null;
      roll = r?.roll ?? null;
      if (option) source = roll != null ? "rolled" : "uniform";
    }
    if (!option) continue;
    choices[axis.key] = option.key;
    log.push({ axis: axis.key, option: option.key, source, ...(marked ? { unavailable: true } : {}), ...(roll != null ? { roll } : {}), ...(die ? { die } : {}) });
  }
  return { choices, log };
}

/**
 * Resolve a row's GENERATION sub-roll (a die the ability's prose rolls to pick
 * among outcomes it lists): roll the die (twice when flagged), pick the
 * enumerated outcome per roll. Returns `{die, twice, rolls, texts}` or null (no
 * sub, unmatched roll — graceful, the Judge reads the prose). Never recurses:
 * an outcome that itself calls for a further roll stays text.
 */
export function resolveSubRoll(sub, rng = Math.random) {
  const outcomes = Array.isArray(sub?.outcomes) ? sub.outcomes : [];
  if (!sub?.die || !outcomes.length) return null;
  const rolls = [];
  const texts = [];
  for (let i = 0; i < (sub.twice ? 2 : 1); i++) {
    const v = rollDie(sub.die, rng);
    if (v == null) return null;
    rolls.push(v);
    const hit = outcomes.find((o) => v >= (o.min ?? 1) && v <= (o.max ?? o.min ?? Infinity));
    if (hit?.text) texts.push(hit.text);
  }
  return texts.length ? { die: sub.die, twice: !!sub.twice, rolls, texts } : null;
}

/**
 * Roll the special-ability MENU: its die over the rows' bands when the menu
 * carries one, else uniform, spending `budget` slots against each row's slot
 * cost (default 1, and a cost may be fractional). Distinct rows only. Returns `{picks, rolls}` — each pick is a COPY of its
 * row, carrying `subResult` when the row's own sub-roll resolved.
 */
export function rollMenu(menu, budget, rng = Math.random) {
  const rows = menu?.rows ?? [];
  const chosen = [];
  const picks = [];
  const rolls = [];
  if (!rows.length || !(budget > 0)) return { picks, rolls };
  const costOf = (r) => (r.cost == null || r.cost === 0 ? 1 : r.cost);
  let spent = 0;
  const banded = menu.die && rows.some((r) => r.min != null || r.max != null);
  for (let attempts = 0; attempts < 60 && spent < budget; attempts++) {
    let row = null;
    if (banded) {
      const v = rollDie(menu.die, rng);
      rolls.push(v);
      row = bracketRow(rows, v) ?? null;
    } else {
      const unpicked = rows.filter((r) => !chosen.includes(r));
      if (!unpicked.length) break;
      row = unpicked[Math.floor(rng() * unpicked.length)];
    }
    if (!row || chosen.includes(row)) continue; // re-roll duplicates
    if (spent + costOf(row) > budget) continue;
    chosen.push(row);
    const subResult = resolveSubRoll(row.sub, rng);
    picks.push({ ...row, ...(subResult ? { subResult } : {}) });
    spent += costOf(row);
    // Nothing affordable remains → stop instead of burning attempts.
    if (!rows.some((r) => !chosen.includes(r) && spent + costOf(r) <= budget)) break;
  }
  return { picks, rolls };
}

const isPlain = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/**
 * A RELATIVE leaf: `{"$add": -1}` adjusts the existing numeric value instead
 * of replacing it, for a modifier template applied to a base actor. A
 * non-numeric existing value takes the delta as its value.
 */
const isRelative = (v) => isPlain(v) && Object.keys(v).length === 1 && typeof v.$add === "number";
const applyRelative = (existing, v) => {
  const base = Number(existing);
  return (Number.isFinite(base) ? base : 0) + v.$add;
};

/**
 * Merge one importer-built patch into an accumulating system object. Dotted
 * keys ("details.morale") expand; plain objects merge recursively; scalars and
 * arrays REPLACE (later axes are more specific); `{"$add": n}` leaves adjust.
 * Pure — no foundry.utils.
 */
export function mergePatch(target, patch) {
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (k.includes(".")) {
      const parts = k.split(".");
      if (isRelative(v)) {
        let cur = target;
        for (const p of parts.slice(0, -1)) {
          if (typeof cur[p] !== "object" || cur[p] === null || Array.isArray(cur[p])) cur[p] = {};
          cur = cur[p];
        }
        const last = parts[parts.length - 1];
        cur[last] = applyRelative(cur[last], v);
      } else {
        setPath(target, k, structuredClone(v));
      }
    } else if (isRelative(v)) {
      target[k] = applyRelative(target[k], v);
    } else if (isPlain(v) && isPlain(target[k])) {
      mergePatch(target[k], v);
    } else {
      target[k] = structuredClone(v);
    }
  }
  return target;
}

/**
 * Resolve chosen options into one engine-ready actor payload:
 * `{name, system, items, htmlParts, art, flags, token, rollHp}`, `rollHp`
 * true where the last matching cell to write hit points asks for them rolled
 * from the resolved `hp.hd` (a cell's `rollHp`). Axis merges apply in
 * axis order, then the N-dimensional `cells` (keyed by their axes' chosen
 * option keys joined with "|"), so a 2-axis cell always outranks the 1-axis
 * rows it refines. `flags`/`token` are the actor-level channels preset options
 * carry (sheet extras and token size). A matching cell's `dropItemTypes` takes
 * every item of those types out of the payload, whichever axis or cell added
 * it.
 */
export function resolveActor(system, choices, { baseName = "", templateName = "" } = {}) {
  // The template's FIXED foundation first (printed plain rows), then axes.
  const merged = mergePatch({}, system?.base?.merge);
  const items = [];
  const htmlParts = [];
  const flags = mergePatch({}, system?.base?.flags);
  const token = {};
  let art = "";
  let tint = "";
  let rollHp = false;
  const drop = new Set();
  const chosen = [];
  for (const axis of system?.axes ?? []) {
    // A multi axis contributes EVERY selected option, in option-list order
    // (stacked add-ons); a single axis contributes exactly one.
    const raw = choices?.[axis.key];
    const keys = Array.isArray(raw) ? raw : raw != null ? [raw] : [];
    const picked = (axis.options ?? []).filter((o) => keys.includes(o.key));
    for (const option of picked) {
      chosen.push({ axis, option });
      mergePatch(merged, option.merge);
      for (const item of option.items ?? []) items.push(structuredClone(item));
      if (option.html) htmlParts.push(option.html);
      if (option.art) art = option.art;
      if (option.tint) tint = option.tint;
      // Actor-level channels (preset options are complete creatures).
      mergePatch(flags, option.flags);
      mergePatch(token, option.token);
    }
  }
  for (const cell of system?.cells ?? []) {
    const key = (cell.by ?? []).map((axisKey) => choices?.[axisKey] ?? "").join("|");
    if (key && key === cell.key) {
      mergePatch(merged, cell.merge);
      for (const item of cell.items ?? []) items.push(structuredClone(item));
      // A cell's actor-level channel: what the sheet reads beside `system`.
      mergePatch(flags, cell.flags);
      // A cell that gives a rating and no hit points asks for them rolled from
      // the rating; a later cell writing hit points of its own settles them.
      if (cell.rollHp || cell.merge?.hp) rollHp = !!cell.rollHp;
      for (const type of cell.dropItemTypes ?? []) drop.add(type);
    }
  }
  if (drop.size) items.splice(0, items.length, ...items.filter((item) => !drop.has(item?.type)));
  let name = system?.output?.nameFormat || "";
  if (name) {
    name = name.replace(/\{(\w+)\}/g, (_, key) => {
      if (key === "base") return baseName || templateName;
      const c = chosen.find((x) => x.axis.key === key);
      if (!c) return "";
      // A null nameLabel falls back to the label; the empty string is an
      // explicit "no name piece".
      return c.option.nameLabel ?? (c.option.label || c.option.key);
    });
    name = name.replace(/\s+/g, " ").trim();
  }
  if (!name) {
    const bits = chosen.map((c) => c.option.nameLabel ?? (c.option.label || c.option.key)).filter(Boolean);
    name = bits.length ? `${templateName} (${bits.join(", ")})` : templateName;
  }
  return { name, system: merged, items, htmlParts, art, tint, flags, token, rollHp };
}
