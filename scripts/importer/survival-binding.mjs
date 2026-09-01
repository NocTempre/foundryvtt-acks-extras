/**
 * Survival-table assembly: the raw RR ch. 6 reads → the engine-shaped
 * `survival` ruledata tables acks-extras declares.
 *
 * The recipes take four paragraphs WHOLE rather than one window per figure,
 * because every threshold on these pages is stated before the condition it
 * produces ("After two consecutive days without any food… becomes underfed")
 * and a window opens after its anchor. Finding the condition therefore eats
 * the number. So the recipe locates the paragraph and this step reads the
 * rungs out of it — the sentence patterns live here, in one place, where a
 * printing change is one edit rather than five.
 *
 * The two ladders are charged differently on purpose: hunger takes a flat
 * figure a day, thirst takes a die. Both shapes pass through untouched — the
 * reader knows which it is holding, and inventing an average for the die is
 * exactly what the registry exists to prevent. Like every binding here, no
 * value ships.
 */
import { MODULE_ID } from "./constants.mjs";
import * as services from "../lib/services.mjs";
import { hasDoc, getDoc, PRIORITY } from "../lib/tables.mjs";

/** The engine doc both halves agree on (acks-extras `expectTables`). */
export const SURVIVAL_DOC_ID = "survival";

/* ------------------------------------------------------------------ */
/*  Parsers                                                            */
/* ------------------------------------------------------------------ */

/**
 * Small counts are spelled out in this prose ("after two consecutive days"),
 * so a digit-only reader finds nothing. "A single day" is the same one.
 */
const WORD_NUMBERS = Object.freeze({
  a: 1, an: 1, single: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  twenty: 20, thirty: 30,
});

/** A count written either way → a number; anything else → null. */
export function parseCount(token) {
  const t = String(token ?? "").trim().toLowerCase();
  if (!t) return null;
  if (Object.hasOwn(WORD_NUMBERS, t)) return WORD_NUMBERS[t];
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * The first capture of `re` in `text`, read as a count.
 *
 * A leading article is dropped first: the page writes "after a single day"
 * as readily as "after two days", and a pattern that captures one token would
 * otherwise read the article and give up.
 */
export function countFrom(text, re) {
  const m = re.exec(String(text ?? ""));
  if (!m) return null;
  const token = String(m[1] ?? "").trim().toLowerCase();
  return parseCount(token === "a" || token === "an" ? (m[2] ?? token) : token);
}

/** A toll that may be flat ("1 CON") or rolled ("1d6 CON"): kept as it reads. */
export function parseToll(text, re) {
  const m = re.exec(String(text ?? ""));
  if (!m) return null;
  const raw = String(m[1]).replace(/\s+/g, "").toLowerCase();
  if (/^\d*d\d+$/.test(raw)) return raw;           // a die, passed through whole
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/** "one-half" | "1/2" | "50%" → 0.5. */
export function parseShare(text, re) {
  const m = re.exec(String(text ?? ""));
  if (!m) return null;
  const t = String(m[1]).trim().toLowerCase();
  const pct = /^(\d+(?:\.\d+)?)\s*%$/.exec(t);
  if (pct) return Number(pct[1]) / 100;
  const frac = /^(\d+)\s*\/\s*(\d+)$/.exec(t);
  if (frac) return Number(frac[1]) / Number(frac[2]);
  const words = { "one-half": 0.5, "one half": 0.5, half: 0.5, "one-third": 1 / 3, "two-thirds": 2 / 3, "one-quarter": 0.25 };
  if (Object.hasOwn(words, t)) return words[t];
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/** Turns → hours, the unit the exposure clock is kept in. */
const TURNS_PER_HOUR = 6;

/**
 * A duration in the exposure prose, normalized to HOURS. The page gives one
 * band in turns and the other in hours-with-turns, so a reader that took the
 * first number it saw would compare four against twenty-four.
 */
export function parseHours(text) {
  const t = String(text ?? "");
  const hours = /(\d+|[a-z-]+)\s*hours?/i.exec(t);
  if (hours) {
    const n = parseCount(hours[1]);
    if (n != null) return n;
  }
  const turns = /(\d+|[a-z-]+)\s*turns?/i.exec(t);
  if (turns) {
    const n = parseCount(turns[1]);
    if (n != null) return n / TURNS_PER_HOUR;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Assembly                                                           */
/* ------------------------------------------------------------------ */

/** The hunger ladder out of the starvation paragraph. */
export function assembleFood(paragraph) {
  const p = String(paragraph ?? "").toLowerCase();
  if (!p) return null;
  const out = {};
  const set = (key, v) => { if (v != null) out[key] = v; };

  set("hungryAfter", countFrom(p, /after\s+(\S+)\s+days?\s+with\s+less\s+than\s+full/));
  set("underfedNoFood", countFrom(p, /after\s+(\S+)\s+consecutive\s+days?\s+without\s+any\s+food/));
  set("underfedShort", countFrom(p, /or\s+(\S+)\s+consecutive\s+days?\s+with\s+an\s+average\s+of\s+half/));
  set("starvingNoFood", countFrom(p, /after\s+(\S+)\s+days?\s+of\s+being\s+underfed\s+with\s+no\s+food/));
  set("starvingShort", countFrom(p, /or\s+(\S+)\s+days?\s+(?:of\s+)?being\s+underfed\s+with\s+an\s+average/));
  set("conPerDay", parseToll(p, /loses\s+(\d+\s*d?\s*\d*)\s*con\s+each\s+day/));
  set("recoverPerDay", countFrom(p, /returns\s+at\s+a\s+rate\s+of\s+(\S+)\s+points?/));

  return Object.keys(out).length ? out : null;
}

/**
 * The thirst ladder out of the dehydration paragraph.
 *
 * The page states THREE onsets — no water, below half, below full — and the
 * engine's ration vocabulary has three levels that do not line up with them.
 * All three are carried anyway: what the reader does with `dehydratedBelowHalf`
 * is the engine's business, and dropping a printed clause here would make it
 * unrecoverable without a re-import.
 */
export function assembleWater(paragraph) {
  const p = String(paragraph ?? "").toLowerCase();
  if (!p) return null;
  const out = {};
  const set = (key, v) => { if (v != null) out[key] = v; };

  set("dehydratedNoWater", countFrom(p, /after\s+(\S+)\s*(\S+)?\s*days?\s+without\s+any\s+water/));
  set("dehydratedBelowHalf", countFrom(p, /or\s+(\S+)\s+days?\s+with\s+less\s+than\s+half/));
  set("dehydratedShort", countFrom(p, /or\s+(\S+)\s+consecutive\s+days?\s+with\s+less\s+than\s+a\s+full/));
  set("conPerDay", parseToll(p, /loses\s+(\d+\s*d?\s*\d*)\s*con\s+each\s+day/));
  set("recoverPerDay", countFrom(p, /returns\s+at\s+a\s+rate\s+of\s+(\S+)\s+points?/));

  return Object.keys(out).length ? out : null;
}

/** The cold's clock per band, in hours, plus what hypothermia costs an hour. */
export function assembleExposure(raw = {}) {
  const hoursUnprotected = {};
  for (const band of ["frigid", "cold"]) {
    const h = parseHours(raw[band]);
    if (h != null) hoursUnprotected[band] = h;
  }
  const conPerHour = parseToll(String(raw.frigid ?? raw.cold ?? ""), /loses\s+(\d+\s*d?\s*\d*)\s*con\s+each\s+hour/i);
  const out = {};
  if (Object.keys(hoursUnprotected).length) out.hoursUnprotected = hoursUnprotected;
  if (conPerHour != null) out.conPerHour = conPerHour;
  return Object.keys(out).length ? out : null;
}

/**
 * The heat band's three modifiers.
 *
 * `dehydrationDrain` is carried as a MULTIPLIER, not as the die it replaces:
 * the page states the worse toll relative to the ordinary one ("2d6 rather
 * than 1d6"), and a ratio survives a re-read of the thirst die where a copied
 * expression would silently disagree with it.
 */
export function assembleHeat(paragraph) {
  const p = String(paragraph ?? "").toLowerCase();
  if (!p) return null;
  const row = {};

  const stone = countFrom(p, /wearing\s+(\S+)\s+stone\s+or\s+more/);
  if (stone != null) row.armourStone = stone;

  const need = parseShare(p, /water\s+ration\s+is\s+increased\s+by\s+([\d.]+\s*%)/);
  if (need != null) row.waterNeed = 1 + need;

  const worse = /loses\s+(\d+)\s*d\s*(\d+)\s*con\s+each\s+day\s+rather\s+than\s+(\d+)\s*d\s*(\d+)/.exec(p);
  if (worse && worse[2] === worse[4] && Number(worse[3]) > 0) {
    row.dehydrationDrain = Number(worse[1]) / Number(worse[3]);
  }

  // The band this paragraph describes names itself in its own heading.
  const band = /\b(sweltering|frigid|cold|moderate)\b/.exec(p)?.[1] ?? "sweltering";
  return Object.keys(row).length ? { [band]: row } : null;
}

/** The Judge's provisioning shortcut: how much of a trip to carry. */
export function assembleSimplified(raw = {}) {
  const out = {};
  const share = parseShare(String(raw.carry ?? raw.food ?? ""), /last\s+(one-half|one half|half|\d+\/\d+)\s+its\s+expected\s+travel/i);
  if (share != null) out.foodShareOfTrip = share;
  const days = countFrom(String(raw.carry ?? ""), /to\s+last\s+for\s+(\S+)\s+days?/i);
  if (days != null) out.waterDays = days;
  // How often the shortcut is actually safe. It is the whole reason the
  // shortcut is offered as a shortcut rather than as the rule, so a readout
  // that shows the amounts without it is quoting a recommendation with its
  // caveat removed.
  const confidence = parseShare(String(raw.carry ?? ""), /safe\s+from[^.]*?(\d+\s*%)/i);
  if (confidence != null) out.confidence = confidence;
  return Object.keys(out).length ? out : null;
}

/**
 * The engine tables from the raw ones. Pure — the committed tests feed it
 * invented prose. Each table assembles independently, so a page that failed to
 * locate costs only its own table.
 */
export function assembleSurvivalTables(raw = {}) {
  const out = {};
  const food = assembleFood(raw.starvationProse?.paragraph);
  if (food) out.food = food;
  const water = assembleWater(raw.dehydrationProse?.paragraph);
  if (water) out.water = water;
  const exposure = assembleExposure(raw.exposureProse ?? {});
  if (exposure) out.exposure = exposure;
  const heat = assembleHeat(raw.heatProse?.paragraph);
  if (heat) out.heat = heat;
  const simplified = assembleSimplified(raw.simplifiedProse ?? {});
  if (simplified) out.simplified = simplified;
  return out;
}

/** Assemble and register, or report nothing assembled. */
export async function applySurvivalImport() {
  const svc = services.get("ruledata-import");
  if (!svc || !hasDoc(SURVIVAL_DOC_ID)) return { assembled: [] };
  const doc = getDoc(SURVIVAL_DOC_ID);
  const engine = assembleSurvivalTables(doc.tables ?? {});
  if (!Object.keys(engine).length) return { assembled: [] };
  await svc.importDoc(
    { id: SURVIVAL_DOC_ID, source: doc.source, tables: { ...(doc.tables ?? {}), ...engine } },
    { priority: PRIORITY.WORLD, source: MODULE_ID },
  );
  return { assembled: Object.keys(engine) };
}
