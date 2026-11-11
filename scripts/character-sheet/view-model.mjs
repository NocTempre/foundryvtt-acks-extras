/**
 * The character sheet's view-model — every decision about what the band, the
 * rails, the tab strip and the folded bar show, and the Equipment tab's Load
 * bar and hand places, made once, on plain data, with no Foundry in reach.
 *
 * The frame's own decisions — the bar, the heart, the AC readings, the
 * movement cell, the save cells, the party cell, the surviving tab, the pins
 * and the load bar — are `lib/frame-model.mjs`, re-exported here; this file
 * adds the cells only a character has (the grip, the light), the tab list,
 * the hands on the body map and the whole frame.
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
 *   ac        {value, shield, naked}           (the system's ac fields)
 *   move      {modes: {key: number}, pct, breakpoints: {low, mid, high}, slowed}
 *   grip      {weapons: [{name, twoHanded, canTwoHand}], shieldInHand, cleaves}
 *   light     {lit: {type, remaining, turns, reach} | null, ambient: "day"|"dark"|null,
 *              sense: {kind, range, cite} | null, blinded}   (`range` is null where
 *              the sense's radius is not imported)
 *   saves     {key: number}                    riders [{save, statuses[], name, remaining, total, clock}]
 *   saveMods  {key: number}                    (signed change in force on that save, all-save mod folded in)
 *   formation {name} | null
 *   party     {formation: {name, onScene, membersOnScene}|null, henchmen: [{onScene}],
 *              summons: [{}] on the scene, calamity: number}
 *   caster, trader (set by the sheet), pending, followers, timers, hasClass, unansweredPaths
 *   pins      string[]
 */
import { LIGHT_ICONS, TAB_ORDER, TOOL_CELLS } from "./constants.mjs";
import { num, clampPct, xpBar, hpCell, acCell, moveCell, partyCell, saveCells, resolveTab } from "../lib/frame-model.mjs";
import { groupByCast, groupBySpell } from "../lib/summons-logic.mjs";

export {
  RAIL_ROWS, signed, xpBar, hpCell, nextAcMode, acCell, slowedTone, moveCell, partyCell, saveCells, resolveTab, effectivePins, togglePin, loadBar,
} from "../lib/frame-model.mjs";

/**
 * The system data an EDITABLE field renders: the stored source, never the
 * prepared value. An active effect adds to the prepared value in memory, and
 * an input showing that value submits it back as the base on the next save —
 * once per save, compounding. A read-only figure shows the prepared value.
 */
export const storedSystem = (actor) => actor?._source?.system ?? actor?.system ?? {};

/**
 * Whether the character carries a morale score: a serving hireling, or one no
 * player owns — the Judge's own NPC. A player's character makes no morale roll
 * (RR ch. 6, Morale), so its sheet shows none.
 */
export const carriesMorale = (actor) => actor?.system?.retainer?.enabled === true || actor?.hasPlayerOwner === false;

/* -------------------------------------------- */
/*  The right rail                               */
/* -------------------------------------------- */

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
    // A reach not imported shows no figure in its place.
    const imported = lit.reach != null;
    const sub = imported ? `${num(lit.reach)}′` : "—";
    return { key: lit.type, icon: LIGHT_ICONS[lit.type] ?? LIGHT_ICONS.torch, sub, tone: "tm", pct, imported, cite: lit.cite ?? null };
  }
  if (ambient === "day") return { key: "day", icon: LIGHT_ICONS.day, sub: "∞", tone: null, pct: null };
  if (sense) {
    const icon = sense.kind === "shadowy" ? LIGHT_ICONS.shadowy : LIGHT_ICONS.lightless;
    const tone = sense.kind === "shadowy" ? null : "hi";
    // A radius not imported shows no figure in its place.
    if (sense.range == null) return { key: sense.kind, icon, sub: "—", tone, pct: null, imported: false };
    return { key: sense.kind, icon, sub: `${num(sense.range)}′`, tone, pct: null, cite: sense.cite ?? null };
  }
  return { key: "dark", icon: LIGHT_ICONS.dark, sub: "0′", tone: "bad", pct: null };
}

/* -------------------------------------------- */
/*  The party menu                               */
/* -------------------------------------------- */

/**
 * The party cell's menu, as plain items the sheet localizes and hangs under
 * the cell. An item's `key` (with `data`) is its label's lang key under the
 * sheet's root; a token row carries its name as `label` instead. `tipKey` and
 * `valueKey` are lang keys too.
 *
 * Who of the party is on the scene comes first, for every viewer. An owner
 * then gets one row per summoning spell: Cast while none of its creatures
 * stand, else Dismiss with the count standing, which covers every cast of
 * that spell. A recorded summon whose spell is no summoning spell of the
 * character (deleted, or a GM's bare summoning) is a loose cast, dismissed
 * cast by cast. A creature bound by hand carries no record and only Release
 * lets it go. Each standing summon is reached by exactly one of those three.
 * The spell-less Summon… is offered only where `bare` says the seat may make
 * one (`bareSummonAllowed`).
 * @param {object} o
 * @param {{henchmen?: object[], summons?: object[]}} o.party  `partyOf`'s facts
 * @param {{id: string, name: string}[]} [o.spells]  the character's summoning spells
 * @param {boolean} [o.owner]  the seat owns the character
 * @param {boolean} [o.bare]  the seat may summon with no spell
 * @param {object[]} [o.controlled]  the tokens Bind would take, passed through untouched
 * @param {boolean} [o.roster]  whether the roster entry shows
 * @returns {object[]}
 */
export function partyMenuModel({ party = {}, spells = [], owner = false, bare = false, controlled = [], roster = false } = {}) {
  const items = [];
  const henchmen = party.henchmen ?? [];
  const summons = party.summons ?? [];
  for (const h of henchmen.filter((x) => x.onScene)) {
    items.push({ kind: "token", tokenId: h.tokenIds?.[0], img: h.img, label: h.name, valueKey: h.calamity ? "party.calamity" : "party.henchman", on: !!h.calamity });
  }
  for (const s of summons) items.push({ kind: "token", tokenId: s.tokenId, img: s.img, label: s.name, valueKey: "party.summon" });
  const away = henchmen.filter((x) => !x.onScene).length;
  if (away) items.push({ kind: "info", icon: "fa-solid fa-person-walking-arrow-right", key: "party.away", data: { n: away }, disabled: true });
  if (owner) {
    const byId = new Map(spells.map((s) => [s.id, s]));
    const { casts, loose, bound } = groupBySpell(summons, byId);
    const dismissals = [];
    for (const spell of [...spells].sort((a, b) => String(a.name).localeCompare(String(b.name)))) {
      const tokenIds = casts.filter((c) => c.spellId === spell.id).flatMap((c) => c.tokens.map((t) => t.tokenId));
      if (!tokenIds.length) {
        items.push({ kind: "cast", spellId: spell.id, icon: "fa-solid fa-wand-magic-sparkles", key: "party.cast", data: { name: spell.name }, tipKey: "party.castTip" });
        continue;
      }
      const row = { kind: "dismiss", spellId: spell.id, tokenIds, icon: "fa-solid fa-ghost", key: "party.dismiss", data: { name: spell.name, n: tokenIds.length }, tipKey: "party.dismissTip", tipData: { n: tokenIds.length } };
      items.push(row);
      dismissals.push(row);
    }
    for (const c of groupByCast(loose).casts) {
      const tokenIds = c.entries.map((e) => e.tokenId);
      const row = { kind: "dismiss", castId: c.castId, tokenIds, icon: "fa-solid fa-ghost", key: "party.dismiss", data: { name: c.spellName || c.name, n: tokenIds.length }, tipKey: "party.dismissTip", tipData: { n: tokenIds.length } };
      items.push(row);
      dismissals.push(row);
    }
    if (dismissals.length > 1) {
      const n = dismissals.reduce((sum, d) => sum + d.tokenIds.length, 0);
      items.push({ kind: "dismissAll", tokenIds: dismissals.flatMap((d) => d.tokenIds), icon: "fa-solid fa-ghost", key: "party.dismissAll", tipKey: "party.dismissTip", tipData: { n } });
    }
    if (bare) items.push({ kind: "summon", icon: "fa-solid fa-hand-sparkles", key: "party.summonNew" });
    if (controlled.length) items.push({ kind: "bind", tokens: controlled, icon: "fa-solid fa-wand-magic-sparkles", key: "party.bind", data: { n: controlled.length } });
    if (bound.length) {
      items.push({ kind: "release", tokenIds: bound.map((s) => s.tokenId), icon: "fa-solid fa-link-slash", key: "party.release", data: { n: bound.length }, tipKey: "party.releaseTip", tipData: { n: bound.length } });
    }
    if (roster) items.push({ kind: "roster", icon: "fa-solid fa-people-group", key: "followers.roster" });
  }
  items.push({ kind: "tab", icon: "fa-solid fa-users", key: "tab.followers" });
  return items;
}

/**
 * How many of a character's summons stand for each of its spells, by the spell
 * id their record names, with the tokens' ids: what the Magic tab shows on a
 * summoning spell's row and what its Dismiss removes.
 * @param {{tokenId: string, record: object|null}[]} summons  `partyOf`'s summons
 * @returns {Map<string, string[]>}  spell id → token ids
 */
export function standingBySpell(summons) {
  const out = new Map();
  for (const s of summons ?? []) {
    const id = s?.record?.spellId;
    if (!id) continue;
    if (!out.has(id)) out.set(id, []);
    out.get(id).push(s.tokenId);
  }
  return out;
}

/* -------------------------------------------- */
/*  The tab strip                                */
/* -------------------------------------------- */

/**
 * Which tabs exist and what each badges. Magic appears for a caster only,
 * Trade for a trader, Service for a hireling in service;
 * a count sits on Followers and Effects (how many is the reason to open
 * them), and on Service while a calamity's loyalty throw is owed; a gold
 * pending badge on Abilities and Class is a choice waiting;
 * Class goes gold (`dyn`) while the XP bar is full.
 */
export function tabList({ caster = false, trader = false, retainer = false, calamity = 0, pending = 0, followers = 0, timers = 0, full = false, hasClass = false, unansweredPaths = 0 }) {
  return TAB_ORDER.filter((k) => (k !== "magic" || caster) && (k !== "trade" || trader) && (k !== "service" || retainer)).map((key) => {
    const tab = { key };
    if (key === "abilities" && pending > 0) tab.p = pending;
    if (key === "service" && calamity > 0) tab.n = calamity;
    if (key === "class") {
      if (full && hasClass) tab.dyn = true;
      if (unansweredPaths > 0) tab.p = unansweredPaths;
    }
    if (key === "followers" && followers > 0) tab.n = followers;
    if (key === "effects" && timers > 0) tab.n = timers;
    return tab;
  });
}

/* -------------------------------------------- */
/*  The Equipment tab                            */
/* -------------------------------------------- */

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
    trader: !!snap.trader,
    retainer: !!snap.retainer,
    calamity: num(snap.pendingCalamity),
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
