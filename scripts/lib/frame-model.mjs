/**
 * The frame's decisions, made on plain data with no Foundry in reach: what a
 * rail cell reads and in what tone, what the band's bar says, which tab
 * survives, what is pinned. Every sheet on the frame feeds these its own
 * snapshot — the character sheet's `view-model.mjs` adds the cells only a
 * character has (grip, light) and the monster sheet its own — and
 * `tools/test-character-sheet.mjs` pins them without a running world.
 *
 * A cell's shape is what `templates/lib/frame/cell.hbs` draws: the sheet
 * turns these readings into `{key, action, attrs, cls, fill, title, icon,
 * big, img, inside, hands, joined, sub, corner, count, disabled}`.
 */
import { MODULE_ID } from "./constants.mjs";

/** How many rail cells a side: the design's six. */
export const RAIL_ROWS = 6;

/**
 * User flag holding the fold state per document id. A viewing preference
 * lives with the viewer: an observer seat can fold a sheet it cannot edit.
 */
export const FOLD_FLAG = "sheetFold";

/**
 * Document flag holding what the frame keeps ON the document: `pins` (roll,
 * timer and resource ids starred for the folded bar) and `acMode` (which AC
 * the rail cell states). The document's own data, so it is owner-written.
 */
export const SHEET_FLAG = "sheet";

/** The sheet flag as stored, `{}` where unset. */
export const sheetFlag = (doc) => doc?.getFlag?.(MODULE_ID, SHEET_FLAG) ?? {};

/** The five saving throws, in the printed order, keyed as the released system stores them. */
export const SAVE_KEYS = Object.freeze(["paralysis", "death", "blast", "implements", "spell"]);

/** The glyph each save cell wears (Font Awesome, per the character sheet's DECISIONS "the rails draw Foundry's icons"). */
export const SAVE_ICONS = Object.freeze({
  paralysis: "fa-solid fa-snowflake",
  death: "fa-solid fa-skull",
  blast: "fa-solid fa-burst",
  implements: "fa-solid fa-wand-magic",
  spell: "fa-solid fa-hat-wizard",
});

/**
 * The six movement modes the system derives, each with the glyph its rail
 * cell and its Stats row wear and the unit its figure is read in.
 */
export const MOVE_MODES = Object.freeze([
  { key: "exploration", icon: "fa-solid fa-map", unit: "perTurn" },
  { key: "combat", icon: "fa-solid fa-crosshairs", unit: "perRound" },
  { key: "chargerun", icon: "fa-solid fa-person-running", unit: "perRound" },
  { key: "expedition", icon: "fa-solid fa-person-hiking", unit: "perDay" },
  { key: "stealth", icon: "fa-solid fa-user-ninja", unit: "perRound" },
  { key: "climb", icon: "fa-solid fa-mountain", unit: "perRound" },
]);

/** The three readings of the AC cell, in cycle order. */
export const AC_MODES = Object.freeze(["shield", "armour", "none"]);

/** A fill for a track: whole, 0 to 100. */
export const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
/** A finite number, else the fallback. */
export const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
/** A figure with its sign, the minus a true minus sign: `+2`, `−1`. */
export const signed = (n) => (n >= 0 ? `+${n}` : `−${Math.abs(n)}`);

/* -------------------------------------------- */
/*  The band                                     */
/* -------------------------------------------- */

/**
 * The XP bar: how full, what it says, and whether it has gone gold.
 * "Full" is the value reaching the threshold; a character with no threshold
 * (no class row, no next-level XP recorded) shows an empty bar and never goes
 * gold, because there is nothing to advance to.
 */
export function xpBar({ value, next }) {
  const v = Math.max(0, num(value));
  const n = num(next);
  if (n <= 0) return { pct: 0, full: false, value: v, next: null };
  return { pct: clampPct((v / n) * 100), full: v >= n, value: v, next: n };
}

/* -------------------------------------------- */
/*  The right rail                               */
/* -------------------------------------------- */

/** The heart: current total inside, fill as the fraction, red at zero. */
export function hpCell({ value, max }) {
  const v = num(value);
  const m = Math.max(0, num(max));
  const pct = m > 0 ? clampPct((Math.max(0, v) / m) * 100) : 0;
  return { n: v, pct, zero: v <= 0, on: m > 0 && v >= m, tone: v <= 0 ? "bad" : null };
}

/** The next reading in the AC cycle: shield → without → unarmoured. */
export function nextAcMode(mode) {
  const i = AC_MODES.indexOf(mode);
  return AC_MODES[(i + 1) % AC_MODES.length];
}

/**
 * The AC cell: the number inside the glyph for the reading in force. A
 * character with no shield equipped has no "with the shield" reading, so
 * the shield mode collapses onto the armour one.
 */
export function acCell({ value, shield, naked }, mode = "shield") {
  const withShield = num(value);
  const shieldPart = num(shield);
  const bare = num(naked);
  const has = shieldPart > 0;
  const m = mode === "shield" && !has ? "armour" : mode;
  const n = m === "none" ? bare : m === "armour" ? withShield - shieldPart : withShield;
  return { mode: m, n, hasShield: has };
}

/** The tone the load puts on the movement cell: amber slowed, red badly so. */
export function slowedTone(pct, breakpoints) {
  const p = num(pct);
  const high = num(breakpoints?.high, 100);
  const low = num(breakpoints?.low, 0);
  if (p > high) return "bad";
  if (p > low) return "warn";
  return null;
}

/** The movement cell: the mode's glyph and figure, coloured when the load slows you. */
export function moveCell({ modes, pct, breakpoints }, modeKey = "exploration") {
  const mode = MOVE_MODES.find((m) => m.key === modeKey) ?? MOVE_MODES[0];
  const value = num(modes?.[mode.key]);
  return { key: mode.key, icon: mode.icon, unit: mode.unit, value, tone: slowedTone(pct, breakpoints) };
}

/**
 * The party cell: who of this character's own party is on the scene. The
 * figure is the henchmen present, with an asterisk per summon present
 * (`1**` is one henchman and two summons). It promotes to the formation when
 * the character marches in one whose party token is on the scene, and then
 * counts the formation's members present. Red while any henchman is
 * suffering a calamity. With no party and no formation the cell is a pad.
 * @param {object} party {formation: {name, onScene, membersOnScene}|null,
 *   henchmen: [{onScene}], summons: [{}] (those on the scene), calamity: number}
 */
export function partyCell({ formation = null, henchmen = [], summons = [], calamity = 0 } = {}) {
  const tone = num(calamity) > 0 ? "neg" : null;
  if (formation?.onScene) {
    const n = num(formation.membersOnScene);
    return { mode: "formation", icon: "fa-solid fa-people-line", sub: n ? String(n) : "", tone, pad: false, calamity: num(calamity) };
  }
  const hOn = henchmen.filter((h) => h.onScene).length;
  const sOn = summons.length;
  if (!henchmen.length && !sOn) {
    return { mode: "none", icon: "fa-solid fa-people-group", sub: "", tone, pad: true, calamity: num(calamity) };
  }
  return { mode: "party", icon: "fa-solid fa-people-group", sub: `${hOn}${"*".repeat(sOn)}`, tone, pad: false, calamity: num(calamity), hOn, sOn };
}

/* -------------------------------------------- */
/*  The left rail                                */
/* -------------------------------------------- */

/**
 * The five save cells. A condition riding on a save takes over the cell —
 * its clock, its fill, the save's glyph in the corner and a count when
 * several share it. A modifier in force on the save colours the cell with the
 * signed number, green helping, red hurting, split when both apply.
 */
export function saveCells({ saves = {}, riders = [], saveMods = {} }) {
  return SAVE_KEYS.map((key) => {
    const target = num(saves[key]);
    const mine = riders.filter((r) => r.save === key);
    const mod = num(saveMods[key]);
    const cell = { key, icon: SAVE_ICONS[key], target, tone: null, pct: null, sub: "", corner: null, count: 0, riders: mine };
    if (mine.length) {
      const first = mine[0];
      const total = num(first.total);
      cell.tone = "neg";
      cell.pct = total > 0 && first.remaining != null ? clampPct((num(first.remaining) / total) * 100) : 100;
      cell.sub = first.clock ?? "";
      cell.riderIcon = first.icon ?? null;
      cell.corner = SAVE_ICONS[key];
      cell.count = mine.length > 1 ? mine.length : 0;
      if (mod > 0) {
        cell.tone = "split";
        cell.sub = [signed(mod), first.clock].filter(Boolean).join(" ");
      }
      return cell;
    }
    if (mod) {
      cell.tone = mod > 0 ? "pos" : "warn";
      cell.sub = signed(mod);
      cell.pct = null;
    }
    return cell;
  });
}

/* -------------------------------------------- */
/*  The tab strip and the pins                   */
/* -------------------------------------------- */

/** Which tab survives when the current one disappears. */
export function resolveTab(active, available) {
  return available.includes(active) ? active : available[0] ?? null;
}

/** The pins the actor carries, bounded to ids that still name something. */
export function effectivePins(pins, available) {
  const have = new Set(available);
  return (Array.isArray(pins) ? pins : []).filter((id) => have.has(id));
}

/** Toggle one pin; order of pinning is the order of the bar. */
export function togglePin(pins, id) {
  const cur = Array.isArray(pins) ? [...pins] : [];
  const at = cur.indexOf(id);
  if (at !== -1) cur.splice(at, 1);
  else cur.push(id);
  return cur;
}

/* -------------------------------------------- */
/*  The load bar                                 */
/* -------------------------------------------- */

/**
 * The Load bar's two readings on one track: the burden the bearer moves
 * under, filled, and what they actually carry, as a dashed phantom running
 * on from the fill to where the true weight falls. The gap is what the
 * carrying rules are worth — a harness, a slung bow, the clothes on their
 * back — drawn so a figure lighter than the kit adds up to reads as a rule
 * working, not a miscount. No phantom when the two agree or a correction
 * runs the other way; past the maximum the phantom stops at the end of the
 * track and `capped` says it did.
 * @param {object} enc {value6, true6, max6, pct, breakpoints} in sixths
 * @returns {{pct:number, phantom:number, capped:boolean, eased6:number, ticks:number[]}}
 *   widths in percent of the track; `eased6` the sixths that do not weigh
 */
export function loadBar({ value6, true6, max6, pct, breakpoints }) {
  const m = num(max6);
  const counted = m > 0 ? clampPct((num(value6) / m) * 100) : clampPct(pct);
  const carried = m > 0 ? clampPct((num(true6) / m) * 100) : counted;
  return {
    pct: counted,
    phantom: Math.max(0, carried - counted),
    capped: m > 0 && num(true6) > m,
    eased6: Math.max(0, num(true6) - num(value6)),
    ticks: [breakpoints?.low, breakpoints?.mid, breakpoints?.high].map((n) => num(n)).filter((n) => n > 0 && n < 100),
  };
}
