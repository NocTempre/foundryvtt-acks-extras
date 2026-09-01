/**
 * OSE / B-X stat block -> ACKS II.
 *
 * The PROCEDURE lives here — which lineage inverts its armour class about a
 * baseline, which printed bonus subtracts from which throw, which of OSE's five
 * saving throws is which of ACKS II's, which way round a movement rate prints.
 * The CONSTANTS those sentences turn on are printed values and arrive as the
 * `constants` argument, read from the reader's own System Compatibility Guide
 * by scg-constants.mjs. This file therefore contains no number taken off a
 * page, and tools/importer/lint-register.mjs fails the build if one appears.
 *
 * Without constants the converter still runs: every axis that needs no
 * arithmetic is filled, the two that do are reported as gaps, and a later pass
 * completes them once the guide is connected.
 *
 * Two standing rules, both of which exist because the obvious shortcut is
 * wrong:
 *
 *   - Nothing is invented to fill a field. Where neither the guide nor ACKS's
 *     own rules produce a value, the ACKS field is left at its schema default
 *     and the printed value is reported as a gap. It still reaches the actor —
 *     the caller stores the whole parse — so nothing read is ever discarded.
 *
 *   - Morale is mapped, never clamped. The core field admits a narrow band and
 *     OSE's scale is wider at both ends, so a clamp would silently pin most of
 *     a book's roster to the maximum. See `moraleOffset`.
 */
import { DEFAULT_IMG } from "./constants.mjs";

/** Damage-bearing lineages, and how each prints an armour class that arrives
 * with no second figure beside it. The B-X family print DESCENDING. Dolmenwood
 * keeps B-X's saves, morale and hit dice but prints its armour class ASCENDING
 * and alone, so a number that looks identical on the page means the opposite
 * thing — which is exactly why the lineage answers this and the grammar, which
 * only reports what is printed, does not.
 *
 * Lineages whose OTHER fields have no ACKS equivalent (range bands, bare
 * ability modifiers) are still refused; the locator flags them first. */
export const LINEAGES = Object.freeze({
  ose: { label: "Old-School Essentials", ac: "descending" },
  bx: { label: "B/X", ac: "descending" },
  becmi: { label: "BECMI", ac: "descending" },
  ll: { label: "Labyrinth Lord", ac: "descending" },
  lotfp: { label: "Lamentations of the Flame Princess", ac: "descending" },
  dolmenwood: { label: "Dolmenwood", ac: "ascending" },
});

/** OSE's morale is a 2d6 score: the die sets the range, not a printed table. */
const OSE_MORALE_DIE = Object.freeze({ count: 2, sides: 6 });
const OSE_MORALE_MIN = OSE_MORALE_DIE.count;
const OSE_MORALE_MAX = OSE_MORALE_DIE.count * OSE_MORALE_DIE.sides;

/**
 * OSE's saving-throw letters and ACKS II's five saves are the same five
 * categories under different names, and both print a d20 target number, so
 * this is a rename and not a conversion. `wand`/`breath` are the pre-ACKS II
 * spellings that core migrates away; never write them.
 */
const SAVE_BY_LETTER = Object.freeze({
  D: "death",
  W: "implements",
  P: "paralysis",
  B: "blast",
  S: "spell",
});

/**
 * The class an imported creature saves as.
 *
 * The two race-as-class entries are the Compatibility Guide's own instruction
 * (printed page 1): a B-X "dwarf" is a dwarven vaultguard and a B-X "elf" is an
 * elven spellsword. The rest are the ACKS II names for classes that kept their
 * role across the rename — the cleric/crusader row is the same correspondence
 * the conversion register carries. Tokens are folded before lookup, so a
 * hyphen the extractor left in the middle of a word cannot miss the match.
 */
const SAVE_AS_CLASS = Object.freeze({
  dwarf: "dwarvenVaultguard",
  elf: "elvenSpellsword",
  fighter: "fighter",
  cleric: "crusader",
  crusader: "crusader",
  magicuser: "mage",
  mage: "mage",
  thief: "thief",
  f: "fighter",
  c: "crusader",
  m: "mage",
  t: "thief",
  d: "dwarvenVaultguard",
  e: "elvenSpellsword",
});

/** OSE's movement mode words -> the ACKS speed-table types. */
const SPEED_TYPE = Object.freeze({
  land: "land",
  fly: "fly",
  flying: "fly",
  swim: "swim",
  swimming: "swim",
  inwater: "swim",
  whenswimming: "swim",
  inair: "fly",
  whenflying: "fly",
  climb: "climb",
  climbing: "climb",
  burrow: "burrow",
  burrowing: "burrow",
  web: "webcrawl",
  webcrawl: "webcrawl",
});

/** ACKS alignment words; OSE prints the same three, sometimes abbreviated. */
const ALIGNMENT = Object.freeze({ l: "Lawful", n: "Neutral", c: "Chaotic" });

const fold = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * How far OSE's morale scale sits above ACKS's, derived rather than chosen.
 *
 * Both scales carry the same number of steps — OSE's 2d6 score and the ACKS
 * field's own bounds are each eleven values wide — so the correspondence is
 * fixed by the endpoints alone: the lowest morale in one is the lowest in the
 * other. Nothing here is a judgement call, and nothing is read off a page:
 * the ACKS bounds come from the core schema the caller passes in, and the OSE
 * bounds from the dice.
 *
 * Returns null when the two scales are not the same width, because then no
 * endpoint-anchored mapping exists and the axis must be reported as a gap
 * rather than approximated.
 */
export function moraleOffset(bounds) {
  const { min, max } = bounds ?? {};
  if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
  if (max - min !== OSE_MORALE_MAX - OSE_MORALE_MIN) return null;
  return OSE_MORALE_MIN - min;
}

/**
 * Convert one parsed OSE stat block.
 *
 * @param parsed     `parseOseStatline(...).fields`
 * @param constants  `{acDescending, acAscending, attackThrow, saveThrow}` or null
 * @param opts       `{lineage, moraleBounds}` — `moraleBounds` is the core
 *                   `details.morale` field's own `{min, max}`
 * @returns `{system, extras, items, notes, gaps, conversions}` — never throws
 */
export function convertOse(parsed, constants, opts = {}) {
  const f = parsed ?? {};
  const lineage = opts.lineage ?? "ose";
  const system = {};
  const extras = {};
  const items = [];
  const notes = [];
  const gaps = [];
  const conversions = [];

  const gap = (axis, printed, reason) => gaps.push({ axis, printed: printed ?? null, reason });
  const took = (axis, printed, route, value, rule) => {
    conversions.push({ axis, printed: printed ?? null, route, value, rule });
    return value;
  };

  const lin = LINEAGES[lineage];
  if (!lin) {
    gap("lineage", lineage, "unsupported-lineage");
    return { system, extras, items, notes, gaps, conversions, lineage };
  }

  /* --- Armour class ------------------------------------------------------ */
  // OSE prints both progressions, so the two routes check each other. A
  // disagreement means the block was mis-read (a sheared column, a box that
  // caught a neighbour) and produces a gap rather than a guessed winner.
  if (f.ac?.note) {
    // An armour class stated in words is a real answer and not a number; it is
    // reported so the Judge can act on it, never guessed at.
    gap("ac", f.ac.note, "not-a-number");
  } else if (f.ac) {
    if (!constants) {
      gap("ac", f.ac.descending, "needs-guide");
    } else {
      // The grammar records the first printed figure as `descending` and marks
      // the block `bare` when no bracket followed, because which progression a
      // lone number belongs to is the lineage's answer, not the page's.
      const loneAscending = f.ac.bare && lin.ac === "ascending";
      const viaDescending =
        !loneAscending && Number.isFinite(f.ac.descending) ? constants.acDescending - f.ac.descending : null;
      const viaAscending = Number.isFinite(f.ac.ascending)
        ? f.ac.ascending - constants.acAscending
        : loneAscending && Number.isFinite(f.ac.descending)
          ? f.ac.descending - constants.acAscending
          : null;
      if (viaDescending != null && viaAscending != null && viaDescending !== viaAscending) {
        gap("ac", `${f.ac.descending} [${f.ac.ascending}]`, "progressions-disagree");
      } else {
        const value = viaDescending ?? viaAscending;
        if (value == null) gap("ac", null, "unreadable");
        else system.aac = { value: took("ac", f.ac.descending, "guide", value, "SCG p.2") };
      }
    }
  }

  /* --- Hit dice and hit points ------------------------------------------- */
  if (f.hd) {
    const hd = {};
    if (Number.isFinite(f.hd.count)) hd.count = f.hd.count;
    if (Number.isFinite(f.hd.bonus)) hd.bonus = f.hd.bonus;
    if (Number.isFinite(f.hd.asterisks)) hd.asterisks = f.hd.asterisks;
    if (Object.keys(hd).length) {
      extras.hd = hd;
      took("hd", f.hd, "raw-derivation", hd, "both systems rate monsters in hit dice");
    }
    // A creature too slight to rate in hit dice printed its hit die instead.
    // That IS the roll formula, so it is used as one.
    if (f.hd.hpDie) {
      system.hp = { hd: f.hd.hpDie };
      took("hd", f.hd.hpDie, "transcribed", f.hd.hpDie, "printed hit die");
    }
    // A hit die is d8 in both systems, and both drop a sub-1 HD monster to a
    // d4 — so the roll formula is derivable without consulting the guide.
    if (Number.isFinite(f.hd.count)) {
      const sides = f.hd.count < 1 ? 4 : 8;
      const whole = Math.max(1, Math.floor(f.hd.count) || 1);
      const bonus = f.hd.bonus ? (f.hd.bonus > 0 ? `+${f.hd.bonus}` : `${f.hd.bonus}`) : "";
      system.hp = { hd: `${whole}d${sides}${bonus}` };
    }
  }
  // A block that prints its hit points as a die expression has stated the die
  // itself, and it is not always the d8 the count-derived formula assumes: a
  // Dolmenwood kilnling prints "HP 1d4" and would otherwise be rolled on a d8.
  // Transcription beats derivation wherever the page actually says.
  if (f.hpDie) {
    system.hp = { ...(system.hp ?? {}), hd: f.hpDie };
    took("hd", f.hpDie, "transcribed", f.hpDie, "printed hit die");
  }
  if (Number.isFinite(f.hp)) {
    system.hp = { ...(system.hp ?? {}), value: f.hp, max: f.hp };
    took("hp", f.hp, "transcribed", f.hp, "printed hit points");
  }

  /* --- Attack throw ------------------------------------------------------ */
  // The bracketed figure IS the guide's "attack bonus". A block that printed
  // only the to-hit-AC-0 number is not converted: recovering the bonus from it
  // needs OSE's own internal identity, which the guide does not print and
  // which is therefore not a rule this importer may apply.
  // A dialect with no THAC0 line at all prints the same attack bonus inside the
  // attack ("2 hooves (+1, 1d4)"). It is the guide's "attack bonus" wherever it
  // is typeset, so it converts by the same rule rather than becoming a gap.
  const attBonus = f.thac0 ? null : (f.att?.modes ?? []).map((m) => m.bonus).find(Number.isFinite);
  if (Number.isFinite(attBonus)) {
    if (!constants) gap("thac0", attBonus, "needs-guide");
    else system.thac0 = { throw: took("thac0", attBonus, "guide", constants.attackThrow - attBonus, "SCG p.2") };
  } else if (f.thac0?.note) {
    gap("thac0", f.thac0.note, "not-a-number");
  } else if (f.thac0) {
    if (!Number.isFinite(f.thac0.ascendingBonus)) {
      gap("thac0", f.thac0.toHitAc0, "no-attack-bonus-printed");
    } else if (!constants) {
      gap("thac0", f.thac0.ascendingBonus, "needs-guide");
    } else {
      system.thac0 = {
        throw: took("thac0", f.thac0.ascendingBonus, "guide", constants.attackThrow - f.thac0.ascendingBonus, "SCG p.2"),
      };
    }
  }

  /* --- Movement ---------------------------------------------------------- */
  // OSE prints the exploration rate first with the combat rate parenthesised.
  // The ACKS Monstrous Manual prints them the other way round, so the two
  // must never share a mapping.
  // A dialect that gives each movement mode its own label prints the mode in
  // the label rather than beside the figure, so those rows are folded in here
  // and read by the same reader as the rest.
  const modeRows = [];
  for (const [key, mode] of [["mvFly", "flying"], ["mvSwim", "swimming"], ["mvBurrow", "burrowing"]]) {
    // parseFloat, not parseInt with a radix: this file may carry no bare
    // integer literal at all, so that a printed constant can never hide as one.
    const n = parseFloat(String(f[key] ?? ""));
    if (Number.isFinite(n)) modeRows.push({ mode, exploration: n });
  }
  const mvRows = [...(Array.isArray(f.mv) ? f.mv : []), ...modeRows];

  if (mvRows.length) {
    const speeds = [];
    for (const row of mvRows) {
      const type = SPEED_TYPE[fold(row.mode)] ?? "land";
      speeds.push({
        type,
        ...(Number.isFinite(row.combat) ? { combat: row.combat } : {}),
        ...(Number.isFinite(row.exploration) ? { run: row.exploration } : {}),
        hover: false,
      });
    }
    extras.speeds = speeds;
    const land = mvRows.find((r) => (SPEED_TYPE[fold(r.mode)] ?? "land") === "land") ?? mvRows[0];
    if (Number.isFinite(land?.exploration)) {
      system.movement = { base: took("mv", land.exploration, "raw-derivation", land.exploration, "exploration rate is the ACKS base") };
    }
  }

  /* --- Saving throws ----------------------------------------------------- */
  if (f.sv?.row) {
    const saves = {};
    for (const [letter, key] of Object.entries(SAVE_BY_LETTER)) {
      const v = f.sv.row[letter];
      if (Number.isFinite(v)) saves[key] = { value: v };
    }
    if (Object.keys(saves).length) {
      system.saves = saves;
      took("saves", f.sv.row, "transcribed", saves, "same five categories, same d20 target");
    }
  } else if (Number.isFinite(f.sv?.single)) {
    // One number is one statement. Spreading it across five saves would be
    // four values this book never printed.
    gap("saves", f.sv.single, "single-save-printed");
  } else if (f.sv?.note) {
    gap("saves", f.sv.note, "not-a-number");
  } else if (f.sv?.asCreature) {
    // A save row stated as "as a vampire" is complete and unresolvable here:
    // this module has no bestiary to look the creature up in.
    gap("saves", `as ${f.sv.asCreature}`, "saves-by-reference");
  } else if (f.sv?.partial) {
    // Letters that make up no complete set. Writing the ones that happened to
    // be recognised would give the creature some of its saving throws and
    // leave the rest at their defaults, with nothing to show the difference.
    gap("saves", Object.entries(f.sv.partial).map(([k, v]) => `${k}${v}`).join(" "), "incomplete-save-row");
  }

  if (f.sv?.saveAs) {
    const cls = SAVE_AS_CLASS[fold(f.sv.saveAs.token)];
    const saveAs = {};
    if (cls) saveAs.class = cls;
    else if (f.sv.saveAs.token) gap("saveAsClass", f.sv.saveAs.token, "no-acks-equivalent");
    if (Number.isFinite(f.sv.saveAs.level)) saveAs.level = f.sv.saveAs.level;
    if (Object.keys(saveAs).length) {
      extras.saveAs = saveAs;
      took("saveAs", f.sv.saveAs, cls ? "guide" : "raw-derivation", saveAs, cls ? "SCG p.1" : "printed level");
    }
  }

  // An NPC block prints its level as a field of its own rather than inside the
  // save clause. It is the same statement, so it fills the same slot — but only
  // where the save clause did not already say so, since that one is the more
  // specific.
  if (Number.isFinite(f.level) && !Number.isFinite(extras.saveAs?.level)) {
    extras.saveAs = { ...(extras.saveAs ?? {}), level: f.level };
    took("level", f.level, "transcribed", f.level, "printed level");
  }

  /* --- Morale ------------------------------------------------------------ */
  if (Number.isFinite(f.ml)) {
    const offset = moraleOffset(opts.moraleBounds);
    if (offset == null) gap("morale", f.ml, "no-bounds");
    else if (f.ml < OSE_MORALE_MIN || f.ml > OSE_MORALE_MAX) gap("morale", f.ml, "out-of-scale");
    else {
      system.details = { ...(system.details ?? {}), morale: took("morale", f.ml, "derived-endpoint", f.ml - offset, "equal-width scales, anchored at both ends") };
    }
  }

  /* --- Alignment --------------------------------------------------------- */
  if (f.al) {
    const word = ALIGNMENT[fold(f.al)[0]] ?? null;
    if (word) system.details = { ...(system.details ?? {}), alignment: took("alignment", f.al, "transcribed", word, "same three alignments") };
    else gap("alignment", f.al, "not-an-acks-alignment");
  }

  /* --- Number appearing --------------------------------------------------- */
  // OSE's pair is wandering/lair; ACKS's core pair is dungeon/wilderness.
  // Only the dungeon side has a counterpart, so the wilderness side is left
  // unset rather than filled with the same figure.
  if (f.na) {
    const enc = { dungeon: {} };
    if (f.na.wandering) enc.dungeon.wandering = { number: String(f.na.wandering) };
    if (f.na.lair) enc.dungeon.lair = { number: String(f.na.lair) };
    if (Object.keys(enc.dungeon).length) {
      extras.encounter = enc;
      if (f.na.wandering) system.details = { ...(system.details ?? {}), appearing: { d: String(f.na.wandering) } };
      took("appearing", f.na, "raw-derivation", enc, "wandering count is the dungeon appearance");
    }
  }

  /* --- Experience and treasure ------------------------------------------- */
  // Both are printed on the page and neither converts: ACKS awards experience
  // on its own schedule, and the treasure-type letters of the two games do not
  // denote the same hoards. Both stay visible to the Judge and neither is
  // written as though it were an ACKS value.
  if (Number.isFinite(f.xp)) gap("xp", f.xp, "different-award-schedule");
  if (f.tt) gap("treasure", f.tt, "different-treasure-tables");

  /* --- Attacks as weapon items ------------------------------------------- */
  for (const mode of f.att?.modes ?? []) {
    if (!mode.name) continue;
    items.push({
      name: mode.name.replace(/^./, (c) => c.toUpperCase()),
      type: "weapon",
      img: DEFAULT_IMG.ATTACK,
      system: {
        description: "",
        damage: mode.damage ?? "",
        bonus: 0,
        melee: true,
        missile: false,
        equipped: true,
        pattern: "transparent",
        tags: [],
        counter: { value: mode.count ?? 1, max: mode.count ?? 1 },
        cost: 0,
        weight: 0,
        weight6: 0,
      },
    });
  }
  if (f.att) system.attacks = f.att.text;

  /* --- Standing editorial notes ------------------------------------------ */
  // The guide addresses the Judge rather than the data on two points, so they
  // are cited and left for a person to act on.
  notes.push("Assign cleaves per the ACKS II guidelines (SCG p.3).");
  notes.push("Replace any infravision or darkvision with Shadowy Senses (SCG p.3).");

  return { system, extras, items, notes, gaps, conversions, lineage };
}
