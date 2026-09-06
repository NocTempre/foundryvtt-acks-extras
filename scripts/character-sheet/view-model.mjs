/**
 * The character sheet's view-model — every decision about what the band, the
 * rails, the tab strip and the folded bar show, and the Equipment tab's Load
 * bar and hand places, made once, on plain data, with no Foundry in reach.
 *
 * `snapshot.mjs` reads the actor into the snapshot shape this file consumes;
 * `sheet.mjs` hands the result to the templates. Keeping the decisions here
 * means the XP bar's gold state, the HP fill, the grip glyphs, the light cell's
 * reading, the condition riders and the pin store are all asserted by
 * `tools/test-character-sheet.mjs` rather than discovered in a running world.
 *
 * Shape of the snapshot (see `snapshot.mjs` for the reads behind each field):
 *   xp        {value, next, bonus}
 *   hp        {value, max}
 *   ac        {value, shield, naked}           (the system's aac fields)
 *   move      {modes: {key: number}, pct, breakpoints: {low, mid, high}, slowed}
 *   grip      {weapons: [{name, twoHanded, canTwoHand}], shieldInHand, cleaves}
 *   light     {lit: {type, remaining, turns, reach} | null, ambient: "day"|"dark"|null,
 *              sense: {kind, range} | null, blinded}
 *   saves     {key: number}                    riders [{save, statuses[], name, remaining, total, clock}]
 *   saveMods  {key: number}                    (signed change in force on that save, all-save mod folded in)
 *   formation {name} | null
 *   party     {formation: {name, onScene, membersOnScene}|null, henchmen: [{onScene}],
 *              summons: [{}] on the scene, calamity: number}
 *   caster, pending, followers, timers, hasClass, unansweredPaths
 *   pins      string[]
 */
import { SAVE_KEYS, SAVE_ICONS, MOVE_MODES, AC_MODES, LIGHT_ICONS, TAB_ORDER, TOOL_CELLS } from "./constants.mjs";

/** How many rail cells a side: the design's six. */
export const RAIL_ROWS = 6;

const clampPct = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
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
 * The grip cell: two hands, each open (free) or clenched (holding), joined on
 * one haft only for a two-handed weapon; the shield hand wears the shield.
 * The cleave count shows only while a weapon is held and the count is above
 * zero. Tone: burgundy identity when both hands close on one weapon, tint
 * when one hand holds, none when both are open.
 */
export function gripCell({ weapons = [], shieldInHand = false, cleaves = 0 }) {
  const held = weapons.length;
  const twoHanded = held === 1 && !!weapons[0].twoHanded && !shieldInHand;
  const hands = [];
  if (twoHanded) hands.push("fist", "fist");
  else {
    hands.push(held >= 1 ? "fist" : "open");
    hands.push(shieldInHand ? "shield" : held >= 2 ? "fist" : "open");
  }
  const n = num(cleaves);
  return {
    hands,
    joined: twoHanded,
    sub: held && n > 0 ? `×${n}` : "",
    tone: twoHanded ? "full" : held ? "hi" : null,
    held,
  };
}

/**
 * The light cell answers "what can I see by": blinded first, then a source
 * you carry with its reach and its burn-down as the fill, then daylight, then
 * a sense that needs no light, and finally the dark, which is explicit 0′.
 */
export function lightCell({ lit = null, ambient = null, sense = null, blinded = false }) {
  if (blinded) return { key: "blind", icon: LIGHT_ICONS.blind, sub: "0′", tone: "bad", pct: null };
  if (lit) {
    const turns = num(lit.turns);
    const pct = turns > 0 && lit.remaining != null ? clampPct((num(lit.remaining) / turns) * 100) : null;
    return { key: lit.type, icon: LIGHT_ICONS[lit.type] ?? LIGHT_ICONS.torch, sub: `${num(lit.reach)}′`, tone: "tm", pct };
  }
  if (ambient === "day") return { key: "day", icon: LIGHT_ICONS.day, sub: "∞", tone: null, pct: null };
  if (sense) {
    const icon = sense.kind === "shadowy" ? LIGHT_ICONS.shadowy : LIGHT_ICONS.lightless;
    return { key: sense.kind, icon, sub: `${num(sense.range)}′`, tone: sense.kind === "shadowy" ? null : "hi", pct: null };
  }
  return { key: "dark", icon: LIGHT_ICONS.dark, sub: "0′", tone: "bad", pct: null };
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
/*  The tab strip                                */
/* -------------------------------------------- */

/**
 * Which tabs exist and what each badges. Magic appears for a caster only;
 * a count sits on Followers and Effects (how many is the reason to open
 * them); a gold pending badge on Abilities and Class is a choice waiting;
 * Class goes gold (`dyn`) while the XP bar is full.
 */
export function tabList({ caster = false, pending = 0, followers = 0, timers = 0, full = false, hasClass = false, unansweredPaths = 0 }) {
  return TAB_ORDER.filter((k) => k !== "magic" || caster).map((key) => {
    const tab = { key };
    if (key === "abilities" && pending > 0) tab.p = pending;
    if (key === "class") {
      if (full && hasClass) tab.dyn = true;
      if (unansweredPaths > 0) tab.p = unansweredPaths;
    }
    if (key === "followers" && followers > 0) tab.n = followers;
    if (key === "effects" && timers > 0) tab.n = timers;
    return tab;
  });
}

/** Which tab survives when the current one disappears. */
export function resolveTab(active, available) {
  return available.includes(active) ? active : available[0] ?? null;
}

/* -------------------------------------------- */
/*  Pins                                         */
/* -------------------------------------------- */

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
/*  The Equipment tab                            */
/* -------------------------------------------- */

/**
 * The Load bar's two readings on one track: the burden the character moves
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

/**
 * The hands on the body map. A weapon held in both hands has no place of its
 * own: it spans the main and off hand, so those two places fold into one row
 * carrying both labels and whatever is held. With nothing held in both hands
 * the two stay separate, each its own drop target, and the both-hands place
 * is not listed at all.
 * @param {{key:string, rows:object[]}[]} places in slot order
 * @returns {object[]} the places with the fold applied. The folded row keeps
 *   the main hand's key (a drop on it draws), carries `span` — the two hands'
 *   key, label and icon — and lists the both-hands rows first.
 */
export function bridgeHands(places) {
  const both = places.find((p) => p.key === "bothHands");
  const rest = places.filter((p) => p.key !== "bothHands");
  if (!both?.rows?.length) return rest;
  const main = rest.find((p) => p.key === "mainHand");
  const off = rest.find((p) => p.key === "offHand");
  if (!main || !off) return [...rest, both];
  const rows = [...both.rows, ...main.rows, ...off.rows];
  // What is held in both hands takes both; the row is over once the hands it
  // spans hold more equipment than two hands can.
  const equip = (both.equip ?? both.rows.length) * 2 + (main.equip ?? 0) + (off.equip ?? 0);
  const joined = {
    ...main,
    label: both.label,
    rows,
    empty: false,
    full: equip > 2,
    capacity: null,
    capacityHint: "",
    equip,
    magic: (both.magic ?? 0) + (main.magic ?? 0) + (off.magic ?? 0),
    span: [main, off].map(({ key, label, icon }) => ({ key, label, icon })),
  };
  return rest.filter((p) => p !== off).map((p) => (p === main ? joined : p));
}

/* -------------------------------------------- */
/*  The whole                                    */
/* -------------------------------------------- */

/**
 * Build the render context for the frame — band, rails, tabs, folded bar.
 * The tab panels are built by their own modules; this decides the chrome.
 * @param {object} snap the snapshot (shape above)
 * @param {object} viewer {isGM, editable, folded, activeTab, acMode, moveMode}
 */
export function buildFrameModel(snap, viewer = {}) {
  const xp = xpBar(snap.xp ?? {});
  const tabs = tabList({
    caster: !!snap.caster,
    pending: num(snap.pending),
    followers: num(snap.followers),
    timers: num(snap.timers),
    full: xp.full,
    hasClass: !!snap.hasClass,
    unansweredPaths: num(snap.unansweredPaths),
  });
  const keys = tabs.map((t) => t.key);
  const active = resolveTab(viewer.activeTab ?? "rolls", keys);
  for (const t of tabs) t.active = t.key === active;

  const rails = {
    saves: saveCells(snap),
    hp: hpCell(snap.hp ?? {}),
    ac: acCell(snap.ac ?? {}, viewer.acMode ?? snap.acMode ?? "shield"),
    move: moveCell(snap.move ?? {}, viewer.moveMode ?? "exploration"),
    grip: gripCell(snap.grip ?? {}),
    light: lightCell(snap.light ?? {}),
    formation: snap.formation ? { name: snap.formation.name } : null,
    party: partyCell(snap.party ?? {}),
    tools: TOOL_CELLS.filter((t) => !t.gmOnly || viewer.isGM),
  };
  return { xp, tabs, active, rails, folded: !!viewer.folded };
}
